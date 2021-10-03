"use strict";

// ## JS utils

function callMaybe(fn, arg) {
  if (fn !== undefined) { fn(arg); }
}

function format(template, params) {
  let res = template;
  for (const key in params) {
    res = res.replace("{" + key + "}", params[key]);
  }
  return res;
}

// `PromiseLoop` repeatedly calls a function and is similar to `setInterval`,
// with notable differences:
//
// - the function must return a `Promise`
// - you must provide a `cancel` function that cancels the operation
// - the loop can be enabled or disabled
// - wait `interval` begins after the function call _completes_, in contrast
//   with `setInterval` where the delay starts immediately after the call
//   _starts_ (so it's fine if the call takes longer than `interval`)

function createPromiseLoop(props) {
  return Object.assign({ enabled: false, timer: null }, props);
}

function promiseLoop(loop) {
  loop.promiseFn()
    .finally(() => {
      // false prevents from setting new timers
      if (loop.enabled) {
        loop.timer = setTimeout(promiseLoop, loop.interval, loop);
      }
    });
}

function setPromiseLoopEnabled(loop, enabled) {
  loop.enabled = enabled;
  console.log("%s %s every %d ms",
              enabled ? "starting" : "stopping", loop.name, loop.interval);
  if (enabled) {
    promiseLoop(loop);
  } else {
    clearTimeout(loop.timer);
    loop.cancel();
  }
}

const now = () => performance.now();


// ## HTTP endpoint utils

// A wrapper around `fetch` API adding: one request at a time limit,
// cancellation, JSON decoding, error handling, logging, and perf metrics.

function createEndpoint(props) {
  return Object.assign({ fetching: false, aborter: null }, props);
}

class RequestIgnored extends Error {}

// must always return a Promise to enable chained Promise fns
function asyncFetchJson(endpoint, params) {
  if (endpoint.fetching) {
    const reason = "ignoring fetch request until existing one finishes";
    console.log(reason);
    return Promise.reject(new RequestIgnored(reason));
  }
  endpoint.fetching = true;
  endpoint.aborter = new AbortController();
  const url = format(endpoint.url, params);
  const start = now();
  const promise = fetch(url, { signal: endpoint.aborter.signal })
    .then((response) => {
      if (response.ok) {
        // start async reading and parsing as JSON
        return response.json();
      } else {
        console.log("%s response not ok", endpoint.name);
        throw new Error("Failed to fetch, status " + response.status);
      }
    })
    .finally(() => {
      console.log("%s request took %d ms", endpoint.name, now() - start);
      endpoint.fetching = false;
    });
  return promise;
}

function cancelFetch(endpoint) {
  if (endpoint.aborter) { endpoint.aborter.abort(); }
}

// suppress errors when request was gracefully skipped or aborted
function skipFetchCancels(e) {
  if (e instanceof RequestIgnored) {
    return;
  } else if (e.name === "AbortError") {
    console.log("request aborted");
    return;
  } else {
    throw e;
  }
}


// ## WebSocket endpoint utils

// This wrapper around bare `WebSocket` adds: saved connection URL, message
// queue, logging, and perf metrics. It is also specialized by encoding and
// decoding sent/received data to/from JSON.
//
// It may take a whole second to open a WebSocket. As a balance between poor UX
// from waiting for connection, and keeping an open unused connection (possibly
// wasting traffic), the socket will be opened on demand and stay open for 60
// seconds. If no outgoing messages are sent in this interval, it will be
// closed. The timeout is controlled by `noSendTimeout`. Set to `0` to disable
// auto-closing (it may still be closed for other reasons).
//
// Some ideas borrowed from:
// https://github.com/decred/dcrdex/blob/d11f1ce9/client/webserver/site/src/js/ws.js

function createWsEndpoint(url) {
  return { url: url, ws: null, queue: [],
           noSendTimeout: 60000, closeTimer: null };
}

// if `delay <= 0` is passed, existing timeout will be cleared but a new one
// will not be set
function resetCloseTimer(endpoint, delay) {
  clearTimeout(endpoint.closeTimer);
  if (delay > 0) {
    endpoint.closeTimer = setTimeout(() => {
      console.log("ws auto-closing after no outgoing messages in %d ms",
                  endpoint.noSendTimeout);
      closeWs(endpoint);
    }, delay);
  } else {
    endpoint.closeTimer = null;
    console.log("ws auto-closing disabled");
  }
}

function openWs(endpoint) {
  callMaybe(endpoint.onpreopen);
  console.time("ws connected");
  console.log("ws connecting to", endpoint.url);
  const ws = new WebSocket(endpoint.url);

  ws.onerror = (evt) => {
    console.log("ws error:", evt);
    callMaybe(endpoint.onerror, evt);
  };

  // clean up any endpoint state here
  ws.onclose = (evt) => {
    console.log("ws disconnected from", endpoint.url);
    // NOTE: `endpoint.queue` is not cleared here, meaning any queued messages
    // will be sent when a new `WebSocket` is opened.
    endpoint.ws = null;
    // if current closing was not initiated by the auto-close timeout, the
    // latter will do an extra closeWs(). Clear the timeout to prevent that.
    resetCloseTimer(endpoint, 0);
    callMaybe(endpoint.onclose, evt);
  };

  ws.onopen = (evt) => {
    // todo: this timer may never complete if open fails
    console.timeEnd("ws connected");
    // copy and reset shared queue to avoid infinite loops when disconnected
    const oldQueue = endpoint.queue;
    endpoint.queue = [];

    // drain queue
    // todo: maybe drop messages that are no longer valid (e.g. duplicates)
    console.log("ws sending %d queued messages", oldQueue.length);
    for (const obj of oldQueue) { sendWs(endpoint, obj); }
    
    resetCloseTimer(endpoint, endpoint.noSendTimeout);

    callMaybe(endpoint.onopen, evt);
  };

  ws.onmessage = (evt) => {
    const obj = JSON.parse(evt.data);
    callMaybe(endpoint.onmessage, obj);
  };

  endpoint.ws = ws;
}

function sendWs(endpoint, obj) {
  const { ws, queue } = endpoint;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    queue.push(obj);
    if (queue.length > 5) {
      console.warn("ws queue size is now", queue.length);
    }
    openWs(endpoint);
    return;
  }
  const message = JSON.stringify(obj);
  console.log("ws sending:", message);
  ws.send(message);
  resetCloseTimer(endpoint, endpoint.noSendTimeout);
}

function closeWs(endpoint) {
  // will throw a null error if closed >1 time, exposing a programming error
  endpoint.ws.close();
}


// ## Poloniex API state and utils

// Code dealing with Poloniex's data model and maintaining its state.
// It is not too concerned about what data model is used by its calling code.
// This layer must have minimum performance overhead and not force unnecessary
// abstractions on the calling code.
// It must know nothing about app's UI.
// API docs: https://docs.poloniex.com/

// ### Poloniex API / HTTP

const tickerEndpoint = createEndpoint({
  name: "ticker",
  url: "https://poloniex.com/public?command=returnTicker",
});

const booksEndpoint = createEndpoint({
  name: "books",
  url: "https://poloniex.com/public?command=returnOrderBook&currencyPair={pair}&depth={depth}",
  maxDepth: 100,
});

// must always return a Promise to enable chained Promise fns
function asyncFetchPoloniex(endpoint, params) {
  return asyncFetchJson(endpoint, params)
    .then((apiResp) => {
      if (apiResp.error) {
        throw new Error("Poloniex API error: " + apiResp.error);
      }
      return apiResp;
    });
}

// ### Poloniex API / WebSocket

const POLO_WS_CHAN_ACC_NTFNS = 1000;
const POLO_WS_CHAN_TICKER = 1002;
const POLO_WS_CHAN_24H_VOLUME = 1003;
const POLO_WS_CHAN_HEARTBEAT = 1010;

const wsEndpoint = createWsEndpoint("wss://api2.poloniex.com");

// for now, cram Poloniex-specific events into this generic WS endpoint object
wsEndpoint.ontickerupdate = undefined;
wsEndpoint.ontickersubscribed = undefined;
wsEndpoint.ontickerunsubscribed = undefined;

wsEndpoint.onmessage = (obj) => {
  if (obj.error) {
    throw new Error("Poloniex WS API error: " + obj.error);
  }

  const [chanobj, seq] = obj;

  // normalize channel id to integer to workaround an API bug where unsubscribe
  // acknowledgements contain channel id as a string instead of an integer
  // (2021-10-02)
  const channel = Number(chanobj);
  if (!Number.isInteger(channel)) {
    throw new Error("not an integer channel id: " + chanobj);
  }

  switch (channel) {
    case POLO_WS_CHAN_HEARTBEAT:
      bumpWsHeartbeatMetrics();
      break;
    case POLO_WS_CHAN_TICKER:
      if (seq === 1) {
        console.log("ws ticker updates subscribed");
        callMaybe(wsEndpoint.ontickersubscribed);
      } else if (seq === 0) {
        console.log("ws ticker updates unsubscribed");
        callMaybe(wsEndpoint.ontickerunsubscribed);
      } else {
        callMaybe(wsEndpoint.ontickerupdate, obj);
      }
      break;
    case POLO_WS_CHAN_ACC_NTFNS:
      console.warn("ws Account Notifications messages are not supported yet:",
                   JSON.stringify(obj));
      break;
    case POLO_WS_CHAN_24H_VOLUME:
      console.warn("ws 24 Hour Exchange Volume messages are not supported yet:",
                   JSON.stringify(obj));
      break;
    default:
      console.warn("received data of unknown type:", JSON.stringify(obj));
      break;
  }
};

function setSubscriptionEnabledWs(channel, enabled) {
  const command = enabled ? "subscribe" : "unsubscribe";
  sendWs(wsEndpoint, { "command": command, "channel": channel });
}

function disconnect() {
  closeWs(wsEndpoint);
  cancelFetch(tickerEndpoint);
}

// #### Poloniex API / WebSocket / metrics

let metWsHeartbeats = 0;
let metWsTickerPriceChanges = 0;
let metWsTickerPriceUnchanged = 0;

function bumpWsHeartbeatMetrics() {
  metWsHeartbeats += 1;
  if (metWsHeartbeats % 10 === 0) {
    console.log("ws heartbeats: %d", metWsHeartbeats);
  }
}

function bumpWsTickerPriceMetrics(prevPrice, lastPrice) {
  if (prevPrice === lastPrice) {
    metWsTickerPriceUnchanged += 1;
    if (metWsTickerPriceUnchanged % 500 === 0) {
      console.log("ws ticker price unchanged: %d", metWsTickerPriceUnchanged);
    }
  } else {
    metWsTickerPriceChanges += 1;
    if (metWsTickerPriceChanges % 50 === 0) {
      console.log("ws ticker price changes: %d", metWsTickerPriceChanges);
    }
  }
}


// ## Data model

// State and utils for app's own data model. Also and converters to/from
// Poloniex's data model.
// Consider this a "normalized" data model that does not care (too much) about
// exchange specifics and is optimized for app's features (change highlighting,
// caching, etc).
// This code must know nothing about the UI (but may define callbacks).

// ### Data model / markets / state

let markets; // Map (Number -> Market)
// Ownership of `selectedMarketId` is a bit controversial at this point.
// The "markets model" does not have a concept of "selected" (yet), but the
// widgets (markets table, book tables, document title) read and write it.
// Keep it in the "markets model" for now.
let selectedMarketId; // Number
let onmarketsupdate; // function, event handler
let onmarketsreset; // function, event handler

const marketsLoop = createPromiseLoop({
  name: "marketsLoop",
  interval: 10000,
  promiseFn: asyncUpdateMarkets,
  cancel: () => cancelFetch(tickerEndpoint),
});

// ### Data model / markets / methods

function isMarketId(id) {
  return Number.isInteger(id);
}

function marketId(str) {
  // todo: rework to not use the sloppy parseInt that does "1a" => 1
  const i = Number.parseInt(str);
  if (!isMarketId(i)) {
    throw new Error("not a market id: " + str);
  }
  return i;
}

// convert ticker data we care about
function marketUpdate(tickerItem) {
  return {
    isActive: (tickerItem.isFrozen !== "1"),
    last: tickerItem.last,
  }
}

function createMarket(tickerItem, name) {
  const m = marketUpdate(tickerItem);
  m.id = tickerItem.id;
  const [base, quote] = name.split("_");
  m.base = base;
  m.quote = quote;
  m.label = quote + "/" + base;
  return m;
}

// transform ticker response: key it by market id and add display names
function createMarkets(tickerResp) {
  const start = now();

  const markets = new Map();
  const deactivated = [];
  for (const marketName in tickerResp) {
    const market = createMarket(tickerResp[marketName], marketName);
    markets.set(market.id, market);
    if (!market.isActive) {
      deactivated.push(market.label);
    }
  }

  if (deactivated.length > 0) {
    console.log("detected deactivated markets:", deactivated.join(", "));
  }

  console.log("markets Map created in %.1f ms", now() - start);
  return markets;
}

function marketChange(market, update) {
  let change = null;
  for (const key in update) {
    const o = market[key];
    const n = update[key];
    if (n !== o) {
      if (!change) { change = {}; }
      change[key] = [o, n];
    }
  }
  return change;
}

// allow simple checks for empty diffs like `if (diff) ...`
function marketsDiff(changes, additions, removals) {
  if ((changes.size === 0) && (additions.size === 0) && (removals.size === 0)) {
    return null;
  } else {
    return { changes, additions, removals };
  }
}

function marketsDiffHttp(markets, tickerResp) {
  const start = now();
  const changes = new Map(), additions = new Map(), removals = new Map();
  const oldIds = new Set(markets.keys());

  // compute keyset difference along the way
  for (const marketName in tickerResp) {
    const tickerItem = tickerResp[marketName];
    const mid = tickerItem.id;
    const market = markets.get(mid);
    if (market) { // exists, possibly changed item
      const c = marketChange(market, marketUpdate(tickerItem));
      if (c) { changes.set(mid, c); }
      oldIds.delete(mid);
    } else { // added item
      additions.set(mid, createMarket(tickerItem, marketName));
    }
  }

  for (const id of oldIds) { // deleted items
    removals.set(id, markets.get(id));
  }

  console.log("markets diff computed in %.1f ms", now() - start);
  return marketsDiff(changes, additions, removals);
}

function marketsDiffWs(markets, updates) {
  const changes = new Map(), additions = new Map(), removals = new Map();
  // updates look like: [ <chan id>, null,
  // [ <pair id>, "<last trade price>", "<lowest ask>", "<highest bid>",
  //   "<percent change in last 24 h>", "<base currency volume in last 24 h>",
  //   "<quote currency volume in last 24 h>", <is frozen>,
  //   "<highest trade price in last 24 h>", "<lowest trade price in last 24 h>"
  // ], ... ]
  for (let i = 2; i < updates.length; i++) {
    const update = updates[i];
    const mid = update[0];

    const marketUpd = {
      isActive: (update[7] !== 1),
      last: update[1],
    };

    const market = markets.get(mid);
    if (!market) { // added market
      const newMarket = {
        id: mid,
        label: "UNKNOWN/UNKNOWN",
        base: "UNKNOWN",
        quote: "UNKNOWN",
        last: marketUpd.last,
        isActive: marketUpd.isActive,
      };
      additions.set(mid, newMarket);
      continue;
    }

    bumpWsTickerPriceMetrics(market.last, marketUpd.last);
    const c = marketChange(market, marketUpd);
    if (c) { changes.set(mid, c); }
  }

  if (updates.length > 2 + 1) {
    console.warn("got more than 1 ticker update:", (updates.length - 2));
  }
  return marketsDiff(changes, additions, removals);
}

// apply mutations in one place, also log important events
function updateMarkets(markets, diff) {
  if (!diff) {
    return;
  }
  for (const [mid, marketChange] of diff.changes) {
    const market = markets.get(mid);
    for (const key in marketChange) {
      const [o, n] = marketChange[key];
      market[key] = n;
      if (key === "isActive") {
        if (n === true) {
          console.log("market activated:", market.label);
        } else {
          console.log("market deactivated:", market.label);
        }
      }
    }
  }
  for (const [mid, newMarket] of diff.additions) {
    markets.set(mid, newMarket);
    console.log("market added:", JSON.stringify(newMarket));
  }
  for (const [mid, removedMarket] of diff.removals) {
    markets.delete(mid);
    console.log("market removed:", JSON.stringify(removedMarket));
  }
  // assuming `diff` was checked earler to be not empty
  callMaybe(onmarketsupdate, { markets, diff, aggregateMetrics: true });
}

// mutate the global var in one place
function resetMarkets(newMarkets) {
  markets = newMarkets;
  callMaybe(onmarketsreset, markets);
}

// must always return a Promise to enable chained Promise fns
function asyncUpdateMarkets() {
  return asyncFetchPoloniex(tickerEndpoint)
    .then((tickerResp) => {
      if (markets) {
        updateMarkets(markets, marketsDiffHttp(markets, tickerResp));
      } else {
        resetMarkets(createMarkets(tickerResp));
      }
      // no return, not passing data further
    })
    .catch(skipFetchCancels);
}

// consume Poloniex API event and produce data model event
wsEndpoint.ontickerupdate = (tickerUpdate) => {
  if (!markets) {
    throw new Error("markets data not initialized");
  }
  updateMarkets(markets, marketsDiffWs(markets, tickerUpdate));
};

function enableMarketsUpdateWs() {
  console.log("ws subscribing to market updates");
  if (!markets) {
    console.log("fetching markets data for the first time");
    // Trigger markets fetch, schedule another attempt and return.
    // If markets fetch fails, subscription will not happen and the user will
    // need to try again.
    // In the future, a better solution should retry the fetch until it
    // succeeds or is canceled.
    asyncUpdateMarkets()
      .then(enableMarketsUpdateWs);
    return;
  }
  // only subscribe to updates if markets db exists and can be written to
  setSubscriptionEnabledWs(POLO_WS_CHAN_TICKER, true);
}

function disableMarketsUpdateWs() {
  setSubscriptionEnabledWs(POLO_WS_CHAN_TICKER, false);
}

// ### Data model / books / state

let onbooksupdate; // function, event handler

const booksLoop = createPromiseLoop({
  name: "booksLoop",
  interval: 3000,
  promiseFn: asyncUpdateSelectedBooks,
  cancel: () => cancelFetch(booksEndpoint),
});

// ### Data model / books / methods

function asyncFetchBooks(market, depth = booksEndpoint.maxDepth) {
  const pair = market.base + "_" + market.quote;
  return asyncFetchPoloniex(booksEndpoint, { pair: pair, depth: depth })
    .then((booksResp) => {
      booksResp.market = market;
      return booksResp;
    });
}

// must always return a Promise to enable chained Promise fns
function asyncFetchSelectedBooks() {
  if (!isMarketId(selectedMarketId)) {
    const reason = "skipping books update until a market is selected";
    return Promise.reject(new RequestIgnored(reason));
  }
  const market = markets.get(selectedMarketId);
  return asyncFetchBooks(market);
}

// must always return a Promise to enable chained Promise fns
function asyncUpdateSelectedBooks() {
  return asyncFetchSelectedBooks()
    .then((books) => {
      callMaybe(onbooksupdate, books);
      // no return, not passing data further
    })
    .catch(skipFetchCancels);
}


// ## UI management

// ### UI / markets / state

const marketsTable = document.getElementById("markets-table");
const marketsTbody = document.getElementById("markets-tbody");
let marketIdToPriceCell; // Map (Number -> HTMLTableCellElement)

let metMarketsTableLastUpdated; // DOMHighResTimeStamp
let metMarketsTableUpdates = 0; // count
let metMarketsTableUpdateDuration = 0; // ms
let metMarketsTableChanges = 0; // count
let metMarketsTableSinceLastReport = 0; // ms
let metMarketsTableReportEvery = 10000; // ms

const updateMarketsBtn = document.getElementById("update-markets-btn");

// ### UI / markets / methods

function compareByLabel(a, b) {
  if (a.label < b.label) { return -1; }
  if (a.label > b.label) { return  1; }
  return 0;
}

function createMarketsTable(markets) {
  const start = now();

  marketsTbody.innerHTML = "";
  const marketsArr = Array.from(markets.values());
  marketsArr.sort(compareByLabel);
  const priceCellIndex = new Map();
  for (const market of marketsArr) {
    const row = marketsTbody.insertRow();
    row.dataset.id = market.id; // String = Number
    if (!market.isActive) {
      row.classList.add("inactive");
    }
    row.insertCell().appendChild(document.createTextNode(market.label));
    const td2 = row.insertCell();
    td2.appendChild(document.createTextNode(market.last));
    priceCellIndex.set(market.id, td2);
  }

  marketIdToPriceCell = priceCellIndex;

  metMarketsTableLastUpdated = now();
  console.log("markets table created in %.1f ms", now() - start);
}

function bumpMarketsTableMetrics(updateStart, changesCount, aggregate) {
  const noww = now();
  const updateDur = noww - updateStart;
  const sinceLastUpd = noww - metMarketsTableLastUpdated;
  metMarketsTableLastUpdated = noww;

  if (aggregate) {
    metMarketsTableUpdates += 1;
    metMarketsTableUpdateDuration += updateDur;
    metMarketsTableChanges += changesCount;
    metMarketsTableSinceLastReport += sinceLastUpd;
    if (metMarketsTableSinceLastReport > metMarketsTableReportEvery) {
      const avgBU = metMarketsTableSinceLastReport / metMarketsTableUpdates;
      console.log("markets table: a total of %.1f ms spent while applying %d"
                  + " updates with %d changes, avg %.1f ms between updates,"
                  + " %d ms since last report",
                  metMarketsTableUpdateDuration, metMarketsTableUpdates,
                  metMarketsTableChanges, avgBU, metMarketsTableSinceLastReport);
      metMarketsTableUpdates = 0;
      metMarketsTableUpdateDuration = 0;
      metMarketsTableChanges = 0;
      metMarketsTableSinceLastReport = 0;
    }
  } else {
    console.log("markets table updated in %.1f ms with %d changes,"
                + " %d ms since last update",
                updateDur, changesCount, sinceLastUpd);
  }
}

function updateMarketsTable(diff, aggregateMetrics) {
  if (!diff) {
    throw new Error("updateMarketsTable called with empty diff");
  }
  const updateStart = now();
  const changes = diff.changes;

  // we have to update the DOM in two parts because we have to trigger a reflow
  // between removing and adding CSS classes, in order to restart any running
  // CSS animations. Clearing and adding styles in separate loops allows to do
  // just one expensive reflow between them.

  // part 1: clear change styling from changed cells
  for (const mid of changes.keys()) {
    marketIdToPriceCell.get(mid).parentNode.classList
      .remove("changed", "positive", "negative");
  }

  // HACK: trigger a synchronous (!) reflow to restart possibly running CSS
  // animations, thanks to https://css-tricks.com/restart-css-animation/
  // more on what triggers reflows here:
  // https://gist.github.com/paulirish/5d52fb081b3570c81e3a
  void marketsTbody.offsetWidth; // you're googling 'void' now aren't you? ;)

  // part 2: apply change styling to changed cells
  for (const [mid, marketChange] of changes) {
    const td = marketIdToPriceCell.get(mid);

    const priceChange = marketChange.last;
    if (priceChange) {
      const [o, n] = priceChange;
      td.firstChild.nodeValue = n;
      if (Number(n) > Number(o)) {
        td.parentNode.classList.add("changed", "positive");
      } else {
        td.parentNode.classList.add("changed", "negative");
      }
    }

    const isActiveChange = marketChange.isActive;
    if (isActiveChange) {
      const [o, n] = isActiveChange;
      if (n === true) {
        td.parentNode.classList.remove("inactive");
      } else {
        td.parentNode.classList.add("inactive");
      }
    }
  }

  bumpMarketsTableMetrics(updateStart, changes.size, aggregateMetrics);
}

function marketsTableClick(e) {
  const tr = event.target.closest("tr");
  selectedMarketId = marketId(tr.dataset.id); // mutate global
  marketsTbody.querySelectorAll(".row-selected")
    .forEach((el) => el.classList.remove("row-selected"));
  tr.classList.add("row-selected");
  const market = markets.get(selectedMarketId);
  setDocTitle(market.label, market.last);
  asyncUpdateSelectedBooks();
}

// ### UI / books / state

const asksWidget = document.getElementById("asks-widget");
const asksTable = document.getElementById("asks-table");
const asksTbody = document.getElementById("asks-tbody");
const bidsWidget = document.getElementById("bids-widget");
const bidsTable = document.getElementById("bids-table");
const bidsTbody = document.getElementById("bids-tbody");
const updateBooksBtn = document.getElementById("update-books-btn");

// ### UI / books / methods

function createTable(tbody, rows, order = [0, 1]) {
  tbody.innerHTML = "";
  for (const row of rows) {
    const tr = tbody.insertRow();
    for (const ci of order) {
      tr.insertCell().appendChild(
        document.createTextNode(parseFloat(row[ci]).toFixed(8)));
    }
  }
}

function setTickers(table, quote) {
  table.querySelectorAll("th.quote-ticker")
    .forEach((el) => {
      el.firstChild.nodeValue = quote;
    });
}

function updateBooksUi(books) {
  asksWidget.scrollTop = 0;
  bidsWidget.scrollTop = 0;
  createTable(asksTbody, books.asks, [1, 0]);
  createTable(bidsTbody, books.bids);
  setTickers(asksTable, books.market.quote);
  setTickers(bidsTable, books.market.quote);
  updateBooksBtn.disabled = false;
}

// ### UI / other / state

const autoupdateToggle = document.getElementById("autoupdate-toggle");
const marketsWsBtn = document.getElementById("markets-ws-btn");

// ### UI / other / methods

function setDocTitle(marketLabel, price) {
  document.title = price + " " + marketLabel;
}

function updateDocTitle(diff) {
  const selMarketChange = diff.changes.get(selectedMarketId);
  if (selMarketChange) {
    const priceChange = selMarketChange.last;
    if (priceChange) {
      const [o, n] = priceChange;
      setDocTitle(markets.get(selectedMarketId).label, n);
    }
  }
}

function autoupdateToggleClick(e) {
  const enable = e.target.checked;
  setPromiseLoopEnabled(marketsLoop, enable);
  setPromiseLoopEnabled(booksLoop, enable);
}


// ## Putting it all together

function initUi() {
  updateMarketsBtn.disabled = false;
  updateMarketsBtn.onclick = (e) => {
    asyncUpdateMarkets();
  };

  updateBooksBtn.onclick = (e) => {
    asyncUpdateSelectedBooks();
  };

  // generic WS endpoint events
  wsEndpoint.onpreopen = () => {
    marketsWsBtn.value = "cancel connect ws";
    marketsWsBtn.onclick = disconnect;
  };
  wsEndpoint.onclose = () => {
    marketsWsBtn.value = "markets ws on";
    marketsWsBtn.onclick = enableMarketsUpdateWs;
  };

  // Poloniex WS endpoint events
  wsEndpoint.ontickersubscribed = () => {
    marketsWsBtn.value = "markets ws off";
    marketsWsBtn.onclick = disableMarketsUpdateWs;
  };
  wsEndpoint.ontickerunsubscribed = () => {
    marketsWsBtn.value = "markets ws on";
    marketsWsBtn.onclick = enableMarketsUpdateWs;
  };

  // consume data model events and update UI

  onmarketsreset = createMarketsTable;

  onmarketsupdate = ({ markets, diff, aggregateMetrics }) => {
    updateMarketsTable(diff, aggregateMetrics);
    updateDocTitle(diff);
  };

  onbooksupdate = updateBooksUi;

  marketsWsBtn.disabled = false;
  marketsWsBtn.onclick = enableMarketsUpdateWs;

  marketsTbody.onclick = marketsTableClick;

  autoupdateToggle.onclick = autoupdateToggleClick;
}

initUi();
