"use strict";

console.log("script eval begin");

const connectBtn = document.getElementById("connect-btn");
const sendBtn = document.getElementById("send-btn");
const marketsTable = document.getElementById("markets-table");

// https://docs.poloniex.com/
const tickerUrl = "https://poloniex.com/public?command=returnTicker";

// state
let ticker;
let abortController;
const ws = {
  url: "wss://api2.poloniex.com",
  sock: undefined,
  queue: [],
};

function main() {
  sendBtn.disabled = false;
  sendBtn.onclick = asyncFetchTicker;
  connectBtn.disabled = false;
  connectBtn.onclick = connect;
  console.log("UI ready");
}

function wsSend(data) {
  if (!ws.sock || ws.sock.readyState !== WebSocket.OPEN) {
    ws.queue.push(data);
    console.log("queued ticker sub, length now " + ws.queue.length);
    return;
  }
  const message = JSON.stringify(data);
  console.log("sending " + message);
  ws.sock.send(message);
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

  console.log("connecting to: " + ws.url);
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
  console.log("connect button flipped to disconnect+cancel");
}

function onConnected(evt) {
  console.log("connected to: " + ws.url);
  console.log("sending queue of size " + ws.queue.length);
  // drain queue, reset shared one to avoid infinite loop in disconnected state
  const queue = ws.queue;
  ws.queue = [];
  queue.forEach((req) => wsSend(req));

  connectBtn.value = "Disconnect";
  connectBtn.onclick = disconnect;
}

function onDisconnected(evt) {
  console.log("disconnected from: " + ws.url);
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
    console.log("ack for channel " + channel);
    return;
  }
}

function disconnect() {
  ws.sock.close();
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
  console.log("initiating fetch of " + url);
  abortController = new AbortController();
  fetch(url, { signal: abortController.signal })
    .then(function(response) {
      if (response.ok) {
        console.log("response ok, status " + response.status + ", reading");
        return response.json();
      } else {
        console.log("response not ok, throwing");
        throw new Error("Failed to fetch, status " + response.status);
      }
    })
    .then(function(json) {
      if (json.error) {
        throw new Error("Poloniex API error: " + json.error);
      }
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
  console.log("initiated fetch");
}

main();
console.log("script eval end");
