"use strict";

console.log("script eval begin");

const connectBtn = document.getElementById("connect-btn");
const sendBtn = document.getElementById("send-btn");
const marketsTable = document.getElementById("markets-table");

const tickerUrl = "https://poloniex.com/public?command=returnTicker";
const websocketUrl = "wss://api2.poloniex.com";

// state
let ticker;
let websocket;
let wsQueue = [];
let abortController;

function main() {
  sendBtn.disabled = false;
  sendBtn.onclick = asyncFetchTicker;
  connectBtn.disabled = false;
  connectBtn.onclick = connect;
  console.log("UI ready");
}

function wsSend(data) {
  if (!websocket || websocket.readyState !== WebSocket.OPEN) {
    wsQueue.push(data);
    console.log("queued ticker sub, length now " + wsQueue.length);
    return;
  }
  const message = JSON.stringify(data);
  console.log("sending " + message);
  websocket.send(message);
}

function subscribeTicker() {
  wsSend({ "command": "subscribe", "channel": 1002 });
}

function connect() {
  if (ticker) {
    console.log("reusing existing ticker data");
    subscribeTicker();
  } else {
    console.log("fetching ticker for the first time");
    asyncFetchTicker();    
  }

  websocket = new WebSocket(websocketUrl);
  console.log("connecting to: " + websocketUrl);

  websocket.onerror = function(evt) {
    console.log("onerror");
  };

  websocket.onclose = function(evt) {
    console.log("disconnected from: " + websocketUrl);
    onOffline();
  };

  websocket.onopen = function(evt) {
    console.log("connected to: " + websocketUrl);
    console.log("sending queue of size " + wsQueue.length);
    // drain queue, reset shared one to avoid infinite loop in disconnected state
    const queue = wsQueue;
    wsQueue = [];
    queue.forEach((req) => wsSend(req));
    onOnline();
  };

  websocket.onmessage = function(evt) {
    console.log("received: " + evt.data);
    const data = JSON.parse(evt.data);
    const channel = data[0];
    const arg2 = data[1];
    if (arg2 === 1) {
      console.log("ack for channel " + channel);
      return;
    }
  };

  onConnecting();
}

function onConnecting() {
  connectBtn.value = "Cancel connect";
  connectBtn.onclick = disconnect;
  console.log("connect button flipped to disconnect+cancel");
}

function onOnline() {
  connectBtn.value = "Disconnect";
  connectBtn.onclick = disconnect;
}

function onOffline() {
  websocket = null;
  connectBtn.value = "Connect";
  connectBtn.onclick = connect;
}

function disconnect() {
  websocket.close();
  abortController.abort();
}

// transform ticker response to key it by id and add names
function initTicker(json) {
  console.log("initializing ticker db");
  const ticker = {};
  Object.keys(json).forEach((marketName) => {
    const market = json[marketName];
    market.name = marketName;
    const [base, quote] = marketName.split("_");
    market.label = quote + "/" + base;
    ticker[market.id] = market;
  });
  console.log("initialized ticker db");
  return ticker;
}

function compareByLabel(a, b) {
  if (a.label < b.label) { return -1; }
  if (a.label > b.label) { return  1; }
  return 0;
}

function populateMarketsTable(ticker) {
  console.log("populating markets table");
  marketsTable.innerHTML = "";
  const markets = Object.keys(ticker).map((id) => ticker[id]);
  markets.sort(compareByLabel);
  markets.forEach((market) => {
    const row = marketsTable.insertRow();
    row.insertCell().appendChild(document.createTextNode(market.label));
    row.insertCell().appendChild(document.createTextNode(market.last));
  });
  console.log("finished populating markets table");
}

function asyncFetchTicker() {
  // TODO: create or update existing ticker
  const url = tickerUrl;
  abortController = new AbortController();
  fetch(url, { signal: abortController.signal })
    .then(function(response) {
      if (response.ok) {
        console.log("got response ok, reading");
        return response.json();
      } else {
        throw new Error("Failed to fetch");
      }
    })
    .then(function(json) {
      ticker = initTicker(json);
      populateMarketsTable(ticker);
      subscribeTicker();
    })
    .catch(function(e) {
      if (e.name === "AbortError") {
        console.log("aborted: " + e);
      } else {
        console.error("error fetching: " + e);
      }
    });
  console.log("fetch scheduled");
}

main();
console.log("script eval end");
