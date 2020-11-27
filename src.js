"use strict";

const connectBtn = document.getElementById("connect-btn");
const sendBtn = document.getElementById("send-btn");
const marketsTable = document.getElementById("markets-table");

const tickerUrl = "https://poloniex.com/public?command=returnTicker";
const websocketUrl = "wss://api2.poloniex.com";

// state
let websocket;
let abortController;

sendBtn.disabled = false;
sendBtn.onclick = function() { asyncFetchTicker(tickerUrl); };

function connect() {
  asyncFetchTicker(tickerUrl);
  websocket = new WebSocket(websocketUrl);
  console.log("connecting to: " + websocketUrl);

  websocket.onerror = function(evt) {
    console.log("onerror");
  };

  websocket.onclose = function(evt) {
    console.log("onclose");
    onOffline();
  };

  websocket.onopen = function(evt) {
    console.log("onopen");
    onOnline();
  };

  websocket.onmessage = function(evt) {
    console.log("onmessage: " + evt.data);
  };

  onConnecting();
}

function onConnecting() {
  connectBtn.value = "Cancel connect";
  connectBtn.onclick = disconnect;
  console.log("connect button flipped to disconnect+cancel");
}

function onOnline() {
  /* sendBtn.onclick = function() {
    // subscribe to 24h trading volume updates sent every ~20 sec
    const message = { "command": "subscribe", "channel": 1003 };
    websocket.send(JSON.stringify(message));
  }
  sendBtn.disabled = false; */
  connectBtn.value = "Disconnect";
  connectBtn.onclick = disconnect;
  console.log("connected to: " + websocketUrl);
}

function onOffline() {
  websocket = null;
  /* sendBtn.onclick = null;
  sendBtn.disabled = true; */
  connectBtn.value = "Connect";
  connectBtn.onclick = connect;
  console.log("disconnected from: " + websocketUrl);
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

function asyncFetchTicker(url) {
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
      const ticker = initTicker(json);
      populateMarketsTable(ticker);
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
