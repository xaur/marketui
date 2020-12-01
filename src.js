"use strict";

const log = console.log;

log("script eval start");

// UI access
const connectBtn = document.getElementById("connect-btn");
const watchMarketsBtn = document.getElementById("watch-markets-btn");
const marketsTable = document.getElementById("markets-table");
const marketIdToPriceCell = {};

// https://docs.poloniex.com/
const tickerUrl = "https://poloniex.com/public?command=returnTicker";

// state
let markets;
let marketsUpdateEnabled = false;
let marketsUpdateInterval = 3000;
let marketsTimeout;
let abortController;
const ws = {
  url: "wss://api2.poloniex.com",
  sock: undefined,
  queue: [],
};

// stats
let statsHeartbeats = 0;
let statsTickerPriceChanges = 0;
let statsTickerPriceUnchanged = 0;
let statsMarketsTableLastUpdated = performance.now();

// convert ticker data we care about
function trackedTickerData(tickerItem) {
  return {
    isActive: (tickerItem.isFrozen !== "1"),
    last: tickerItem.last,
  }
}

function toMarketItem(tickerItem, name) {
  const mi = trackedTickerData(tickerItem);
  mi.id = tickerItem.id;
  mi.name = name;
  const [base, quote] = name.split("_");
  mi.label = quote + "/" + base;
  return mi;
}

// transform ticker response: key it by market id and add display names
function initMarkets(tickerResp) {
  console.time("markets db initialized");
  log("markets db initializing");
  const markets = {};
  Object.keys(tickerResp).forEach((marketName) => {
    const market = toMarketItem(tickerResp[marketName], marketName);
    markets[market.id] = market;
  });
  console.timeEnd("markets db initialized");
  return markets;
}

function isEmpty(obj) {
  for (const prop in obj) { return false; }
  return true;
}

function addMarketChanges(changed, mid, market, update) {
  for (const key in update) {
    const o = market[key];
    const n = update[key];
    if (n !== o) {
      if (!changed[mid]) { changed[mid] = {}; } // init
      changed[mid][key] = [o, n];
      market[key] = n;
    }
  }
}

function updateMarkets(tickerResp) {
  console.time("markets db updated");
  const changed = {}, added = {}, removed = {};
  const oldIds = new Set(Object.keys(markets));

  // compute keyset difference along the way
  Object.keys(tickerResp).forEach((marketName) => {
    const tickerItem = tickerResp[marketName];
    const mid = tickerItem.id;
    const market = markets[mid];
    if (market) { // exists, possibly changed item
      const ttd = trackedTickerData(tickerItem);
      addMarketChanges(changed, mid, market, ttd);
      oldIds.delete(String(mid)); // using string ids for now
    } else { // added item
      const newMarket = toMarketItem(tickerItem, marketName);
      markets[mid] = newMarket;
      added[mid] = newMarket;
    }
  });

  for (const id of oldIds) { // deleted items
    removed[id] = markets[id];
    delete markets[id];
  }

  console.timeEnd("markets db updated");

  if (isEmpty(changed) && isEmpty(added) && isEmpty(removed)) {
    return null;
  } else {
    return { changed, added, removed };
  }
}

function compareByLabel(a, b) {
  if (a.label < b.label) { return -1; }
  if (a.label > b.label) { return  1; }
  return 0;
}

function createMarketsTable(markets) {
  console.time("markets table created");
  log("markets table creating");
  marketsTable.innerHTML = "";
  const marketsArr = Object.keys(markets).map((id) => markets[id]);
  marketsArr.sort(compareByLabel);
  marketsArr.forEach((market) => {
    const row = marketsTable.insertRow();
    if (!market.isActive) {
      log("detected frozen market: " + market.label);
      row.classList.add("inactive");
    }
    row.insertCell().appendChild(document.createTextNode(market.label));
    const td2 = row.insertCell()
    td2.appendChild(document.createTextNode(market.last));
    marketIdToPriceCell[market.id] = td2;
  });
  console.timeEnd("markets table created");
}

function updateMarketsTable(changes) {
  if (!changes) {
    log("WARN updateMarketsTable called with empty changes");
    return;
  }
  const updateStart = performance.now();

  const changed = changes.changed;

  // we have to update the DOM in two parts because we have to trigger a reflow
  // between removing and adding CSS classes, in order to restart any running
  // CSS animations. Clearing and adding styles in separate loops allows to do
  // just one expensive reflow between them.

  // part 1: clear change styling from changed cells
  const changeClearStart = performance.now();
  const changedKeys = Object.keys(changed);
  changedKeys.forEach((mid) => {
    marketIdToPriceCell[mid].classList.remove("changed", "positive", "negative");
  });
  const changeClearTime = performance.now() - changeClearStart;

  // HACK: trigger a synchronous (!) reflow to restart possibly running CSS
  // animations, thanks to https://css-tricks.com/restart-css-animation/
  // more on what triggers reflows here:
  // https://gist.github.com/paulirish/5d52fb081b3570c81e3a
  const reflowStart = performance.now();
  void marketsTable.offsetWidth; // you're googling 'void' now aren't you? ;)
  const reflowTime = performance.now() - reflowStart;

  // part 2: apply change styling to changed cells
  const changeAddStart = performance.now();
  changedKeys.forEach((mid) => {
    const marketChange = changed[mid];
    const td = marketIdToPriceCell[mid];

    const priceChange = marketChange["last"];
    if (priceChange) {
      const [o, n] = priceChange;
      td.firstChild.nodeValue = n;
      if (Number(n) > Number(o)) {
        td.classList.add("changed", "positive");
      } else {
        td.classList.add("changed", "negative");
      }
    }

    const isActiveChange = marketChange["isActive"];
    if (isActiveChange) {
      const [o, n] = isActiveChange;
      if (n === true) {
        log("market unfrozen: " + markets[mid].label);
        td.parentNode.classList.remove("inactive");
      } else {
        log("market frozen: " + markets[mid].label);
        td.parentNode.classList.add("inactive");
      }
    }
  });
  const changeAddTime = performance.now() - changeAddStart;

  if (Object.keys(changes.added).length > 0) {
    log("market additions detected: " + JSON.stringify(changes.added));
  }
  if (Object.keys(changes.removed).length > 0) {
    log("market removals detected: " + JSON.stringify(changes.removed));
  }

  const now = performance.now();
  log("markets table updated with " + changedKeys.length + " changes in "
      + (now - updateStart) + " ms (clear " + changeClearTime + " ms, reflow "
      + reflowTime + " ms, add " + changeAddTime + " ms), "
      + (now - statsMarketsTableLastUpdated) + " ms since last time");
  statsMarketsTableLastUpdated = now;
}

function asyncFetchMarkets() {
  const url = tickerUrl;
  log("ticker fetch initiating " + url);
  abortController = new AbortController();
  console.time("ticker fetch");
  const promise = fetch(url, { signal: abortController.signal })
    .then(function(response) {
      console.timeLog("ticker fetch");
      if (response.ok) {
        log("ticker response " + response.status + ", reading");
        return response.json();
      } else {
        log("ticker response not ok");
        throw new Error("Failed to fetch ticker, status " + response.status);
      }
    })
    .then(function(json) {
      console.timeEnd("ticker fetch");
      if (json.error) {
        throw new Error("Poloniex API error: " + json.error);
      }
      if (markets) {
        const changes = updateMarkets(json);
        if (changes) { updateMarketsTable(changes); }
      } else {
        markets = initMarkets(json);
        createMarketsTable(markets);
      }
      return markets;
    })
    .catch(function(e) {
      if (e.name === "AbortError") {
        log("aborted: " + e);
      } else {
        console.error("error fetching: " + e);
      }
    });
  log("ticker fetch initiated");
  return promise;
}

function fetchMarketsLoop() {
  asyncFetchMarkets().then(function(markets) {
    if (marketsUpdateEnabled) {
      log("scheduling markets update");
      marketsTimeout = setTimeout(fetchMarketsLoop, marketsUpdateInterval);
    }
  });
}

function toggleMarketsUpdating() {
  if (marketsUpdateEnabled) {
    log("markets updating stopping");
    marketsUpdateEnabled = false;   // prevent fetchMarketsLoop from setting new timeouts
    clearTimeout(marketsTimeout);   // cancel pending timeouts
    abortController.abort();        // cancel active fetches
    watchMarketsBtn.value = "Watch markets";
  } else {
    log("markets updating starting");
    marketsUpdateEnabled = true;
    fetchMarketsLoop();
    watchMarketsBtn.value = "Unwatch markets";
  }
}

function wsSend(data) {
  if (!ws.sock || ws.sock.readyState !== WebSocket.OPEN) {
    ws.queue.push(data);
    log("markets subscription queued, queue size is now " + ws.queue.length);
    return;
  }
  const message = JSON.stringify(data);
  log("sending: " + message);
  ws.sock.send(message);
}

function subscribeMarkets() {
  wsSend({ "command": "subscribe", "channel": 1002 });
}

function onDisconnected(evt) {
  log("disconnected from " + ws.url);
  ws.sock = null;
  connectBtn.value = "Connect";
  connectBtn.onclick = connect;
}

function disconnect() {
  ws.sock.close();
  abortController.abort();
}

function onConnected(evt) {
  console.timeEnd("websocket connected");
  log("sending " + ws.queue.length + " queued messages");
  // drain queue, reset shared one to avoid infinite loop in disconnected state
  const queue = ws.queue;
  ws.queue = [];
  queue.forEach((req) => wsSend(req));

  connectBtn.value = "Disconnect";
  connectBtn.onclick = disconnect;
}

function updateMarketsWs(updates) {
  const changed = {}, added = {}, removed = {};
  // updates look like: [ <chan id>, null,
  // [ <pair id>, "<last trade price>", "<lowest ask>", "<highest bid>",
  //   "<percent change in last 24 h>", "<base currency volume in last 24 h>",
  //   "<quote currency volume in last 24 h>", <is frozen>,
  //   "<highest trade price in last 24 h>", "<lowest trade price in last 24 h>"
  // ], ... ]
  for (let i = 2; i < updates.length; i++) {
    const update = updates[i];
    const mid = update[0];

    const trackedData = {
      isActive: (update[7] !== 1),
      last: update[1],
    }

    const market = markets[mid];
    if (!market) { // added market
      const newMarket = {
        id: mid,
        name: "UNKNOWN_" + mid,
        label: "UNKNOWN/UNKNOWN",
        last: trackedData.last,
        isActive: trackedData.isActive,
      };
      added[mid] = newMarket;
      markets[mid] = newMarket;
      continue;
    }

    addMarketChanges(changed, mid, market, trackedData);

    const prevPrice = market.last;
    const lastPrice = trackedData.last;
    if (prevPrice === lastPrice) {
      statsTickerPriceUnchanged += 1;
      if (statsTickerPriceUnchanged % 400 === 0) {
        log("ticker price unchanged: " + statsTickerPriceUnchanged);
      }
    } else {
      statsTickerPriceChanges += 1;
      if (statsTickerPriceChanges % 40 === 0) {
        log("ticker price changes: " + statsTickerPriceChanges);
      }
    }
  }

  if (updates.length > 2 + 1) {
    log("ODD got more than 1 ticker update: " + (updates.length - 2));
  }

  if (isEmpty(changed) && isEmpty(added) && isEmpty(removed)) {
    return null;
  } else {
    return { changed, added, removed };
  }
}

function onMessage(evt) {
  const data = JSON.parse(evt.data);
  const [channel, seq] = data;
  if (channel === 1010) {
    statsHeartbeats += 1;
    if (statsHeartbeats % 10 === 0) { 
      log("heartbeats: " + statsHeartbeats);
    }
  } else if (channel === 1002) {
    if (seq === 1) {
      log("ticker subscription server ack");
      return;
    }
    const changes = updateMarketsWs(data);
    if (changes) { updateMarketsTable(changes); }
  } else {
    log("WARN got data we didn't subscribe for: " + data);
  }
}

function onConnecting() {
  connectBtn.value = "Cancel connect";
  connectBtn.onclick = disconnect;
}

function connect() {
  log("connect starting");
  if (markets) {
    log("reusing existing markets data");
    subscribeMarkets();
  } else {
    log("fetching markets data for the first time");
    asyncFetchMarkets().then(function(markets) {
      if (markets) {
        // only subscribe to updates if markets db was populated
        subscribeMarkets();
      }
    });    
  }

  console.time("websocket connected");
  log("connecting to " + ws.url);
  ws.sock = new WebSocket(ws.url);

  ws.sock.onerror = (evt) => { log("websocket error: " + evt); };
  ws.sock.onclose = onDisconnected;
  ws.sock.onopen = onConnected;
  ws.sock.onmessage = onMessage;

  onConnecting();
}

function initUi() {
  const updateBtn = document.getElementById("update-markets-btn");
  updateBtn.disabled = false;
  updateBtn.onclick = (e => asyncFetchMarkets());
  watchMarketsBtn.disabled = false;
  watchMarketsBtn.onclick = toggleMarketsUpdating;
  connectBtn.disabled = false;
  connectBtn.onclick = connect;
  log("UI ready");
}

initUi();
log("script eval finish");
