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

const TRACKED_TICKER_CHANGES = new Set(["last", "isFrozen"]);

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

// mutate ticker response item into our market item
function toMarketItem(tickerItem, name) {
  tickerItem.name = name;
  const [base, quote] = name.split("_");
  tickerItem.label = quote + "/" + base;
}

// transform ticker response: key it by market id and add display names
function initMarkets(tickerResp) {
  console.time("markets db initialized");
  log("markets db initializing");
  const markets = {};
  Object.keys(tickerResp).forEach((marketName) => {
    const market = tickerResp[marketName];
    toMarketItem(market, marketName);
    markets[market.id] = market;
  });
  console.timeEnd("markets db initialized");
  return markets;
}

// ugly: changes carry only tracked fields while added and removed have all
// todo: reduce markets db to what we care about
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
      for (const key in tickerItem) {
        const o = market[key];
        const n = tickerItem[key];
        if (TRACKED_TICKER_CHANGES.has(key) && n !== o) {
          if (!changed[mid]) { changed[mid] = {}; } // init
          changed[mid][key] = [o, n];
        }
        market[key] = tickerItem[key];
      }
    } else { // added item
      toMarketItem(tickerItem, marketName);
      markets[mid] = tickerItem;
      added[mid] = tickerItem;
    }
    oldIds.delete(String(mid)); // using string ids for now
  });

  for (const id of oldIds) { // deleted items
    removed[id] = markets[id];
    delete markets[id];
  }

  console.timeEnd("markets db updated");
  log("detected " + Object.keys(changed).length +
      " markets with changes to tracked fields: " +
      JSON.stringify(changed));
  return { changed, added, removed };
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
    if (market.isFrozen === "1") {
      log("detected frozen market: " + market.label);
      row.classList.add("frozen");
    }
    row.insertCell().appendChild(document.createTextNode(market.label));
    const td2 = row.insertCell()
    td2.appendChild(document.createTextNode(market.last));
    marketIdToPriceCell[market.id] = td2;
  });
  console.timeEnd("markets table created");
}

function updateMarketsTable(changes) {
  console.time("markets table updated");
  marketsTable.querySelectorAll(".changed").forEach((el) => {
    el.classList.remove("changed", "positive", "negative");
  });
  Object.keys(changes.changed).forEach((mid) => {
    const marketChange = changes.changed[mid];
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

    const isFrozen = marketChange["isFrozen"];
    if (isFrozen) {
      const [o, n] = isFrozen;
      if (n === "1") {
        td.parentNode.classList.add("frozen");
      } else {
        td.parentNode.classList.remove("frozen");
      }
    }
  });
  if (Object.keys(changes.added).length > 0) {
    log("market additions detected: " + JSON.stringify(changes.added));
  }
  if (Object.keys(changes.removed).length > 0) {
    log("market removals detected: " + JSON.stringify(changes.removed));
  }
  console.timeEnd("markets table updated");
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
        updateMarketsTable(changes);
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

// todo: separate computations of changes and updating of table
function updateMarketsWs(updates) {
  // updates look like: [ <chan id>, null,
  // [ <pair id>, "<last trade price>", "<lowest ask>", "<highest bid>",
  //   "<percent change in last 24 h>", "<base currency volume in last 24 h>",
  //   "<quote currency volume in last 24 h>", <is frozen>,
  //   "<highest trade price in last 24 h>", "<lowest trade price in last 24 h>"
  // ], ... ]
  for (let i = 2; i < updates.length; i++) {
    const [mid, lastPrice] = updates[i];
    const market = markets[mid];
    const prevPrice = market.last;
    if (prevPrice === lastPrice) {
      statsTickerPriceUnchanged += 1;
      if (statsTickerPriceUnchanged % 200 === 0) {
        log("ticker price unchanged: " + statsTickerPriceUnchanged);
      }
    } else {
      statsTickerPriceChanges += 1;
      if (statsTickerPriceChanges % 10 === 0) {
        log("ticker price changes: " + statsTickerPriceChanges);
      }
      market.last = lastPrice;
      marketIdToPriceCell[mid].firstChild.nodeValue = lastPrice;
      log(market.label + " " + prevPrice + " to " + lastPrice);
    }
  }
  if (updates.length > 2 + 1) {
    log("got more than 1 ticker update: " + (updates.length - 2));
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
    updateMarketsWs(data);
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
  watchMarketsBtn.disabled = false;
  watchMarketsBtn.onclick = toggleMarketsUpdating;
  connectBtn.disabled = false;
  connectBtn.onclick = connect;
  log("UI ready");
}

initUi();
log("script eval finish");
