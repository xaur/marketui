"use strict";

const log = console.log;

log("script eval start");

// UI access
const connectBtn = document.getElementById("connect-btn");
const fetchMarketsBtn = document.getElementById("fetch-markets-btn");
const marketsTable = document.getElementById("markets-table");
const marketIdToPriceCell = {};

// https://docs.poloniex.com/
const tickerUrl = "https://poloniex.com/public?command=returnTicker";

// state
let markets;
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

function initUi() {
  fetchMarketsBtn.disabled = false;
  fetchMarketsBtn.onclick = (e) => asyncFetchMarkets();
  connectBtn.disabled = false;
  connectBtn.onclick = connect;
  log("UI ready");
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

  log("connecting to " + ws.url);
  ws.sock = new WebSocket(ws.url);

  ws.sock.onerror = (evt) => { log("websocket error: " + evt); };
  ws.sock.onclose = onDisconnected;
  ws.sock.onopen = onConnected;
  ws.sock.onmessage = onMessage;

  onConnecting();
}

function onConnecting() {
  connectBtn.value = "Cancel connect";
  connectBtn.onclick = disconnect;
}

function onConnected(evt) {
  log("connected to " + ws.url);
  log("sending " + ws.queue.length + " queued messages");
  // drain queue, reset shared one to avoid infinite loop in disconnected state
  const queue = ws.queue;
  ws.queue = [];
  queue.forEach((req) => wsSend(req));

  connectBtn.value = "Disconnect";
  connectBtn.onclick = disconnect;
}

function onDisconnected(evt) {
  log("disconnected from " + ws.url);
  ws.sock = null;
  connectBtn.value = "Connect";
  connectBtn.onclick = connect;
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
    updateMarkets(data);
  } else {
    log("WARN got data we didn't subscribe for: " + data);
  }
}

function disconnect() {
  ws.sock.close();
  abortController.abort();
}

// transform ticker response to key it by id and add display names
function initMarkets(json) {
  log("markets db initializing");
  const markets = {};
  Object.keys(json).forEach((marketName) => {
    const market = json[marketName];
    market.name = marketName;
    const [base, quote] = marketName.split("_");
    market.label = quote + "/" + base;
    markets[market.id] = market;
  });
  log("markets db initialized");
  return markets;
}

function updateMarkets(updates) {
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

function compareByLabel(a, b) {
  if (a.label < b.label) { return -1; }
  if (a.label > b.label) { return  1; }
  return 0;
}

function createMarketsTable(markets) {
  log("markets table creating");
  marketsTable.innerHTML = "";
  const marketsArr = Object.keys(markets).map((id) => markets[id]);
  marketsArr.sort(compareByLabel);
  marketsArr.forEach((market) => {
    const row = marketsTable.insertRow();
    row.insertCell().appendChild(document.createTextNode(market.label));
    const td2 = row.insertCell()
    td2.appendChild(document.createTextNode(market.last));
    marketIdToPriceCell[market.id] = td2;
  });
  log("markets table created");
}

function asyncFetchMarkets() {
  const url = tickerUrl;
  log("ticker fetch initiating " + url);
  abortController = new AbortController();
  const promise = fetch(url, { signal: abortController.signal })
    .then(function(response) {
      if (response.ok) {
        log("ticker response reading (" + response.status + ")");
        return response.json();
      } else {
        log("ticker response not ok");
        throw new Error("Failed to fetch ticker, status " + response.status);
      }
    })
    .then(function(json) {
      if (json.error) {
        throw new Error("Poloniex API error: " + json.error);
      }
      markets = initMarkets(json);
      createMarketsTable(markets);
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

initUi();
log("script eval finish");
