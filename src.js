"use strict";

var connectBtn = document.getElementById("connect-btn");
var sendBtn = document.getElementById("send-btn");
var websocket;

function connect() {
  console.log("connecting");
  updateConnectBtn("Cancel connect", disconnect);

  var uri = "wss://api2.poloniex.com";
  websocket = new WebSocket(uri);

  console.log("created websocket");

  websocket.onerror = function(evt) {
    console.log("onerror");
    updateConnectBtn("Connect", connect);
  };

  websocket.onclose = function(evt) {
    console.log("onclose");
    updateConnectBtn("Connect", connect);
  };

  websocket.onopen = function(evt) {
    console.log("onopen, connected to " + uri);
    updateConnectBtn("Disconnect", disconnect);
    sendBtn.onclick = function() {
      // subscribe to 24h trading volume updates sent every ~20 sec
      var message = { "command": "subscribe", "channel": 1003 };
      websocket.send(JSON.stringify(message));
    }
    sendBtn.disabled = false;
  };

  websocket.onmessage = function(evt) {
    console.log("onmessage: " + evt.data);
  };
}

function updateConnectBtn(label, onclick) {
  connectBtn.value = label;
  connectBtn.onclick = onclick;
}

function disconnect() {
  sendBtn.onclick = null;
  sendBtn.disabled = true;
  websocket.close();
  websocket = null;
}
