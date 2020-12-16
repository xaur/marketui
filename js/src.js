"use strict";

// UI access
const autoupdateToggle = document.getElementById("autoupdate-toggle");
const connectWsBtn = document.getElementById("connect-ws-btn");
const watchMarketsBtn = document.getElementById("watch-markets-btn");
const marketsTable = document.getElementById("markets-table");
const marketsTbody = document.getElementById("markets-tbody");
let marketIdToPriceCell; // Map

const updateMarketsBtn = document.getElementById("update-markets-btn");
const updateBooksBtn = document.getElementById("update-books-btn");
const asksTbody = document.getElementById("asks-tbody");
const bidsTbody = document.getElementById("bids-tbody");
const asksTable = document.getElementById("asks-table");
const bidsTable = document.getElementById("bids-table");

// https://docs.poloniex.com/
const tickerUrl = "https://poloniex.com/public?command=returnTicker";
const orderBookUrl = "https://poloniex.com/public?command=returnOrderBook&currencyPair={pair}&depth={depth}"

// state
let markets; // Map
let marketsFetching = false;
let marketsAutoupdateEnabled = false;
let marketsAutoupdateInterval = 3000;
let marketsAutoupdateTimer;
let marketsFetchAborter;
const ws = {
  url: "wss://api2.poloniex.com",
  sock: undefined,
  queue: [],
};

const bookDepth = 100;
let booksFetching = false;
let booksFetchAborter;
let booksAutoupdateEnabled = false;
let booksAutoupdateInterval = 3000;
let booksAutoupdateTimer;

// stats
let statsHeartbeats = 0;
let statsTickerPriceChanges = 0;
let statsTickerPriceUnchanged = 0;
let statsMarketsTableLastUpdated = performance.now();

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
  const start = performance.now();

  const markets = new Map();
  for (const marketName in tickerResp) {
    const market = createMarket(tickerResp[marketName], marketName);
    markets.set(market.id, market);
    if (!market.isActive) {
      console.log("detected deactivated market:", market.label);
    }
  }

  console.log("markets Map in %.1f ms", performance.now() - start);
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

function diffOrNull(changes, additions, removals) {
  if ((changes.size === 0) && (additions.size === 0) && (removals.size === 0)) {
    return null;
  } else {
    return { changes, additions, removals };
  }
}

function marketsDiffHttp(tickerResp) {
  const start = performance.now();
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

  console.log("markets diff computed in %.1f ms", performance.now() - start);
  return diffOrNull(changes, additions, removals);
}

function compareByLabel(a, b) {
  if (a.label < b.label) { return -1; }
  if (a.label > b.label) { return  1; }
  return 0;
}

function createMarketsTable(markets) {
  const start = performance.now();

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
    const td2 = row.insertCell()
    td2.appendChild(document.createTextNode(market.last));
    priceCellIndex.set(market.id, td2);
  }

  marketIdToPriceCell = priceCellIndex;
  console.log("markets table created in %.1f ms", performance.now() - start);
}

// apply mutations in one place, also log important events
function updateMarkets(diff) {
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
}

function updateMarketsTable(diff) {
  if (!diff) {
    throw new Error("updateMarketsTable called with empty diff");
  }
  const updateStart = performance.now();
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

  const now = performance.now();
  console.log("markets table updated in %.1f ms with %d changes, "
    + "%d ms since last update", (now - updateStart), changes.size,
    (now - statsMarketsTableLastUpdated),
  );
  statsMarketsTableLastUpdated = now;
}

function diffAndUpdate(differ, data) {
  const diff = differ(data);
  if (diff) {
    updateMarkets(diff);
    updateMarketsTable(diff);
  }
}

function asyncFetchPolo(url) {
  const aborter = new AbortController();
  const start = performance.now();
  const promise = fetch(url, { signal: aborter.signal })
    .then((response) => {
      if (response.ok) {
        console.log("http response begins after %d ms, status %s",
          (performance.now() - start), response.status);
        return response.json();
      } else {
        console.log("http response not ok");
        throw new Error("Failed to fetch, status " + response.status);
      }
    })
    .then((json) => {
      console.log("http response finishes after %d ms", performance.now() - start);
      if (json.error) {
        throw new Error("Poloniex API error: " + json.error);
      }
      return json;
    })
    .catch((e) => {
      if (e.name === "AbortError") {
        console.log("fetch aborted:", url);
      } else {
        console.error("error fetching:", e);
      }
      throw e; // prevent success handlers down the promise chain
    });
  console.log("http fetch initiated");
  return { promise, aborter };
}

function asyncFetchMarkets() {
  if (marketsFetching) {
    const reason = "ignoring markets fetch request until existing one finishes";
    console.log(reason);
    return Promise.reject(reason);
  }
  marketsFetching = true;
  const {promise, aborter} = asyncFetchPolo(tickerUrl);
  marketsFetchAborter = aborter;
  const updated = promise.then((json) => {
    if (markets) {
      diffAndUpdate(marketsDiffHttp, json);
    } else {
      markets = createMarkets(json);
      createMarketsTable(markets);
    }
    // return a true-ish value to signal downstream consumers that no error
    // took place
    return markets;
  })
  .finally(() => {
    marketsFetching = false;
  });
  return updated;
}

function asyncFetchMarketsNoerr() {
  return asyncFetchMarkets().catch(() => {}); // silence errors
}

function marketsAutoupdateLoop() {
  asyncFetchMarketsNoerr().then(() => {
    if (marketsAutoupdateEnabled) {
      console.log("scheduling markets update in %d ms", marketsAutoupdateInterval);
      marketsAutoupdateTimer = setTimeout(marketsAutoupdateLoop, marketsAutoupdateInterval);
    }
  });
}

function setMarketsAutoupdate(enabled) {
  marketsAutoupdateEnabled = enabled;     // false prevents marketsAutoupdateLoop from setting new timers
  if (marketsAutoupdateEnabled) {
    console.log("starting markets autoupdate");
    marketsAutoupdateLoop();
    watchMarketsBtn.value = "unwatch http";
  } else {
    console.log("stopping markets autoupdate");   
    clearTimeout(marketsAutoupdateTimer); // cancel pending timers
    marketsFetchAborter.abort();          // cancel active fetches
    watchMarketsBtn.value = "watch http";
  }
}

function wsSend(data) {
  if (!ws.sock || ws.sock.readyState !== WebSocket.OPEN) {
    ws.queue.push(data);
    if (ws.queue.length > 5) {
      console.warn("ws queue size is now", ws.queue.length);
    }
    return;
  }
  const message = JSON.stringify(data);
  console.log("ws sending:", message);
  ws.sock.send(message);
}

function subscribeMarkets() {
  wsSend({ "command": "subscribe", "channel": 1002 });
}

function onDisconnected(evt) {
  console.log("ws disconnected from", ws.url);
  ws.sock = null;
  connectWsBtn.value = "connect ws";
  connectWsBtn.onclick = connect;
}

function disconnect() {
  ws.sock.close();
  marketsFetchAborter.abort();
}

function onConnected(evt) {
  console.timeEnd("ws connected");
  console.log("ws sending %d queued messages", ws.queue.length);
  // copy and reset shared queue to avoid infinite loops when disconnected
  const queue = ws.queue;
  ws.queue = [];

  for (const req of queue) { wsSend(req); } // drain queue

  connectWsBtn.value = "disconnect ws";
  connectWsBtn.onclick = disconnect;
}

function updateTickerStatsWs(prevPrice, lastPrice) {
  if (prevPrice === lastPrice) {
    statsTickerPriceUnchanged += 1;
    if (statsTickerPriceUnchanged % 400 === 0) {
      console.log("ws ticker price unchanged: %d", statsTickerPriceUnchanged);
    }
  } else {
    statsTickerPriceChanges += 1;
    if (statsTickerPriceChanges % 40 === 0) {
      console.log("ws ticker price changes: %d", statsTickerPriceChanges);
    }
  }
}

function marketsDiffWs(updates) {
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
    }

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

    updateTickerStatsWs(market.last, marketUpd.last);
    const c = marketChange(market, marketUpd);
    if (c) { changes.set(mid, c); }
  }

  if (updates.length > 2 + 1) {
    console.warn("got more than 1 ticker update:", (updates.length - 2));
  }
  return diffOrNull(changes, additions, removals);
}

function updateHeartbeatStatsWs() {
  statsHeartbeats += 1;
  if (statsHeartbeats % 10 === 0) {
    console.log("ws heartbeats: %d", statsHeartbeats);
  }
}

function onMessage(evt) {
  const data = JSON.parse(evt.data);
  const [channel, seq] = data;
  if (channel === 1010) {
    updateHeartbeatStatsWs();
  } else if (channel === 1002) {
    if (seq === 1) {
      console.log("ws ticker subscription server ack");
      return;
    }
    diffAndUpdate(marketsDiffWs, data);
  } else {
    console.warn("received data we didn't subscribe for:", JSON.stringify(data));
  }
}

function onConnecting() {
  connectWsBtn.value = "cancel connect ws";
  connectWsBtn.onclick = disconnect;
}

function connect() {
  console.log("connect starting");
  if (markets) {
    console.log("reusing existing markets data");
    subscribeMarkets();
  } else {
    console.log("fetching markets data for the first time");
    asyncFetchMarkets().then((markets) => {
      // todo: if markets promise gets rejected, subscription never happens
      if (markets) {
        // only subscribe to updates if markets db was populated
        subscribeMarkets();
      }
    });
  }

  console.time("ws connected");
  console.log("ws connecting to", ws.url);
  ws.sock = new WebSocket(ws.url);

  ws.sock.onerror = (e => console.log("ws error:", e));
  ws.sock.onclose = onDisconnected;
  ws.sock.onopen = onConnected;
  ws.sock.onmessage = onMessage;

  onConnecting();
}

function format(template, params) { // sigh ES6
  let res = template;
  for (const key in params) {
    res = res.replace("{" + key + "}", params[key]);
  }
  return res;
}

function createTable(tbody, rows, order = [0, 1]) {
  tbody.innerHTML = "";
  for (const row of rows) {
    const tr = tbody.insertRow();
    for (const ci of order) {
      tr.insertCell().appendChild(document.createTextNode(parseFloat(row[ci]).toFixed(8)));
    }
  }
}

function setTickers(table, quote) {
  table.querySelectorAll("th.quote-ticker").forEach(el => {
    el.firstChild.nodeValue = quote;
  });
}

function asyncFetchOrderBooks(marketId, depth = bookDepth) {
  if (booksFetching) {
    const reason = "ignoring book fetch request until existing one finishes";
    console.log(reason);
    return Promise.reject(reason);
  }
  const m = markets.get(marketId);
  const pair = m.base + "_" + m.quote;
  const url = format(orderBookUrl, { pair: pair, depth: depth });
  booksFetching = true;
  console.log("fetching book for %s (%d), depth %d", pair, marketId, depth);
  const {promise, aborter} = asyncFetchPolo(url);
  booksFetchAborter = aborter;
  const processed = promise.then(json => {
    createTable(asksTbody, json.asks, [1, 0]);
    createTable(bidsTbody, json.bids);
    setTickers(asksTable, m.quote);
    setTickers(bidsTable, m.quote);
  })
  .finally(() => {
    booksFetching = false;
    updateBooksBtn.disabled = false;
  });
  return processed;
}

function asyncFetchBooksNoerr(marketId) {
  return asyncFetchOrderBooks(marketId).catch(() => {});
}

function marketsTableClick(e) {
  const tr = event.target.closest("tr");
  const midstr = tr.dataset.id;
  marketsTable.dataset.selectedMarketId = midstr; // String = String
  marketsTbody.querySelectorAll(".row-selected").forEach(el =>
    el.classList.remove("row-selected"));
  tr.classList.add("row-selected");

  const mid = parseInt(midstr);
  console.log("selected market", mid);
  asyncFetchBooksNoerr(mid);
}

function asyncUpdateSelectedBooks() {
  const midstr = marketsTable.dataset.selectedMarketId;
  if (!midstr) {
    console.log("skipping books update until a market is selected");
    return Promise.resolve(null);
  }
  const mid = parseInt(midstr);
  return asyncFetchBooksNoerr(mid);
}

function booksAutoupdateLoop() {
  asyncUpdateSelectedBooks().finally(() => {
    if (booksAutoupdateEnabled) {
      console.log("scheduling books update in %d ms", booksAutoupdateInterval);
      booksAutoupdateTimer = setTimeout(booksAutoupdateLoop, booksAutoupdateInterval);
    }
  });
}

function setBooksAutoupdate(enabled) {
  booksAutoupdateEnabled = enabled;     // false prevents booksAutoupdateLoop from setting new timers
  if (enabled) {
    console.log("starting books autoupdate");
    booksAutoupdateLoop();
  } else {
    console.log("stopping books autoupdate");
    clearTimeout(booksAutoupdateTimer); // cancel pending timers
    booksFetchAborter.abort();          // cancel active fetches
  }
}

function autoupdateToggleClick(e) {
  const enable = e.target.checked;
  setMarketsAutoupdate(enable);
  setBooksAutoupdate(enable);
}

function initUi() {
  updateMarketsBtn.disabled = false;
  updateMarketsBtn.onclick = (e => asyncFetchMarketsNoerr());

  updateBooksBtn.onclick = (e => asyncUpdateSelectedBooks());

  watchMarketsBtn.disabled = false;
  watchMarketsBtn.onclick = (e => setMarketsAutoupdate(!marketsAutoupdateEnabled));
  connectWsBtn.disabled = false;
  connectWsBtn.onclick = connect;
  marketsTbody.onclick = marketsTableClick;

  autoupdateToggle.onclick = autoupdateToggleClick;
}

initUi();
