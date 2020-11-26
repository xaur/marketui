"use strict";

var connectBtn = document.getElementById("connect-btn");
var sendBtn = document.getElementById("send-btn");
var uri = "wss://api2.poloniex.com";
var websocket;

function connect() {
  onConnecting();
  websocket = new WebSocket(uri);

  console.log("created websocket");

  websocket.onerror = function(evt) {
    console.log("onerror");
    onOffline();
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
}

function onConnecting() {
  console.log("connecting to: " + uri);
  connectBtn.value = "Cancel connect";
  connectBtn.onclick = disconnect;
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
  console.log("connected to: " + uri);
}

function onOffline() {
  websocket = null;
  sendBtn.onclick = null;
  sendBtn.disabled = true;
  connectBtn.value = "Connect";
  connectBtn.onclick = connect;
  console.log("disconnected from: " + uri);
}

function disconnect() {
  websocket.close();
}
