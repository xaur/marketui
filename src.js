"use strict";

var connectBtn = document.getElementById("connect-btn");
var sendBtn = document.getElementById("send-btn");
var websocket;

function connect() {
  console.log("connecting");
  updateConnectBtn("Cancel connect", disconnect);

  websocket = new WebSocket("ws://echo.websocket.org/");

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
    console.log("onopen");
    updateConnectBtn("Disconnect", disconnect);
    sendBtn.onclick = function() {
      websocket.send("Hey hey heey");
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
  updateConnectBtn("Connect", connect);
}
