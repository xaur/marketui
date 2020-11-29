"use strict";

console.log("script eval start");

const connectBtn = document.getElementById("connect-btn");
const fetchMarketsBtn = document.getElementById("fetch-markets-btn");
const marketsTable = document.getElementById("markets-table");

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

function initUi() {
  fetchMarketsBtn.disabled = false;
  fetchMarketsBtn.onclick = (e) => asyncFetchMarkets();
  connectBtn.disabled = false;
  connectBtn.onclick = connect;
  console.log("UI ready");
}

function wsSend(data) {
  if (!ws.sock || ws.sock.readyState !== WebSocket.OPEN) {
    ws.queue.push(data);
    console.log("markets subscription queued, queue size is now " + ws.queue.length);
    return;
  }
  const message = JSON.stringify(data);
  console.log("sending: " + message);
  ws.sock.send(message);
}

function subscribeMarkets() {
  wsSend({ "command": "subscribe", "channel": 1002 });
}

function connect() {
  console.log("connect starting");
  if (markets) {
    console.log("reusing existing markets data");
    subscribeMarkets();
  } else {
    console.log("fetching markets data for the first time");
    asyncFetchMarkets().then(function(markets) {
      if (markets) {
        // only subscribe to updates if markets db was populated
        subscribeMarkets();
      }
    });    
  }

  console.log("connecting to " + ws.url);
  ws.sock = new WebSocket(ws.url);

  ws.sock.onerror = (evt) => { console.log("websocket error: " + evt); };
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
  console.log("connected to " + ws.url);
  console.log("sending " + ws.queue.length + " queued messages");
  // drain queue, reset shared one to avoid infinite loop in disconnected state
  const queue = ws.queue;
  ws.queue = [];
  queue.forEach((req) => wsSend(req));

  connectBtn.value = "Disconnect";
  connectBtn.onclick = disconnect;
}

function onDisconnected(evt) {
  console.log("disconnected from " + ws.url);
  ws.sock = null;
  connectBtn.value = "Connect";
  connectBtn.onclick = connect;
}

function onMessage(evt) {
  console.log("received: " + evt.data);
  const data = JSON.parse(evt.data);
  const channel = data[0];
  const arg2 = data[1];
  if (arg2 === 1) {
    console.log("server acked subscription to channel " + channel);
    return;
  }
}

function disconnect() {
  ws.sock.close();
  abortController.abort();
}

// transform ticker response to key it by id and add display names
function initMarkets(json) {
  console.log("markets db initializing");
  const markets = {};
  Object.keys(json).forEach((marketName) => {
    const market = json[marketName];
    market.name = marketName;
    const [base, quote] = marketName.split("_");
    market.label = quote + "/" + base;
    markets[market.id] = market;
  });
  console.log("markets db initialized");
  return markets;
}

function compareByLabel(a, b) {
  if (a.label < b.label) { return -1; }
  if (a.label > b.label) { return  1; }
  return 0;
}

function populateMarketsTable(markets) {
  console.log("markets table populating");
  marketsTable.innerHTML = "";
  const marketsArr = Object.keys(markets).map((id) => markets[id]);
  marketsArr.sort(compareByLabel);
  marketsArr.forEach((market) => {
    const row = marketsTable.insertRow();
    row.insertCell().appendChild(document.createTextNode(market.label));
    row.insertCell().appendChild(document.createTextNode(market.last));
  });
  console.log("markets table populated");
}

function asyncFetchMarkets() {
  // TODO: create or update existing markets
  const url = tickerUrl;
  console.log("ticker fetch initiating " + url);
  abortController = new AbortController();
  const promise = fetch(url, { signal: abortController.signal })
    .then(function(response) {
      if (response.ok) {
        console.log("ticker response reading (" + response.status + ")");
        return response.json();
      } else {
        console.log("ticker response not ok");
        throw new Error("Failed to fetch ticker, status " + response.status);
      }
    })
    .then(function(json) {
      if (json.error) {
        throw new Error("Poloniex API error: " + json.error);
      }
      markets = initMarkets(json);
      populateMarketsTable(markets);
      return markets;
    })
    .catch(function(e) {
      if (e.name === "AbortError") {
        console.log("aborted: " + e);
      } else {
        console.error("error fetching: " + e);
      }
    });
  console.log("ticker fetch initiated");
  return promise;
}

initUi();
console.log("script eval finish");
