"use strict";

var connectBtn = document.getElementById("connect-btn");
var sendBtn = document.getElementById("send-btn");

var tickerUrl = "https://poloniex.com/public?command=returnTicker";
var websocketUrl = "wss://api2.poloniex.com";

// state
var websocket;
var ticker;
var abortController;

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
  sendBtn.onclick = function() {
    // subscribe to 24h trading volume updates sent every ~20 sec
    var message = { "command": "subscribe", "channel": 1003 };
    websocket.send(JSON.stringify(message));
  }
  sendBtn.disabled = false;
  connectBtn.value = "Disconnect";
  connectBtn.onclick = disconnect;
  console.log("connected to: " + websocketUrl);
}

function onOffline() {
  websocket = null;
  sendBtn.onclick = null;
  sendBtn.disabled = true;
  connectBtn.value = "Connect";
  connectBtn.onclick = connect;
  console.log("disconnected from: " + websocketUrl);
}

function disconnect() {
  websocket.close();
  abortController.abort();
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
      console.log("read json: " + json);
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
