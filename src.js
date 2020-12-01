"use strict";

const log = console.log;

// UI access
const connectBtn = document.getElementById("connect-btn");
const watchMarketsBtn = document.getElementById("watch-markets-btn");
const marketsTable = document.getElementById("markets-table");
const marketIdToPriceCell = {};

// https://docs.poloniex.com/
const tickerUrl = "https://poloniex.com/public?command=returnTicker";

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
let statsMarketsTableLastUpdated = performance.now();

// convert ticker data we care about
function trackedMarket(tickerItem) {
  return {
    isActive: (tickerItem.isFrozen !== "1"),
    last: tickerItem.last,
  }
}

function createMarket(tickerItem, name) {
  const mi = trackedMarket(tickerItem);
  mi.id = tickerItem.id;
  mi.name = name;
  const [base, quote] = name.split("_");
  mi.label = quote + "/" + base;
  return mi;
}

// transform ticker response: key it by market id and add display names
function createMarkets(tickerResp) {
  const start = performance.now();

  const markets = {};
  for (const marketName of Object.keys(tickerResp)) {
    const market = createMarket(tickerResp[marketName], marketName);
    markets[market.id] = market;
    if (!market.isActive) {
      log("detected deactivated market: " + market.label);
    }
  }

  log("markets created in " + (performance.now() - start) + " ms");

  return markets;
}

function isEmpty(obj) {
  for (const prop in obj) { return false; }
  return true;
}

function addMarketChanges(changed, mid, market, update) {
  for (const key in update) {
    const o = market[key];
    const n = update[key];
    if (n !== o) {
      if (!changed[mid]) { changed[mid] = {}; } // init
      changed[mid][key] = [o, n];
    }
  }
}

function changesOrNull(changed, added, removed) {
  if (isEmpty(changed) && isEmpty(added) && isEmpty(removed)) {
    return null;
  } else {
    return { changed, added, removed };
  }
}

function marketsChangesHttp(tickerResp) {
  const start = performance.now();

  const changed = {}, added = {}, removed = {};
  const oldIds = new Set(Object.keys(markets));

  // compute keyset difference along the way
  for (const marketName of Object.keys(tickerResp)) {
    const tickerItem = tickerResp[marketName];
    const mid = tickerItem.id;
    const market = markets[mid];
    if (market) { // exists, possibly changed item
      const ttd = trackedMarket(tickerItem);
      addMarketChanges(changed, mid, market, ttd);
      oldIds.delete(String(mid)); // using string ids for now
    } else { // added item
      added[mid] = createMarket(tickerItem, marketName);
    }
  }

  for (const id of oldIds) { // deleted items
    removed[id] = markets[id];
  }

  log("markets change computed in " + (performance.now() - start) + " ms");

  return changesOrNull(changed, added, removed);
}

function compareByLabel(a, b) {
  if (a.label < b.label) { return -1; }
  if (a.label > b.label) { return  1; }
  return 0;
}

function createMarketsTable(markets) {
  const start = performance.now();

  marketsTable.innerHTML = "";
  const marketsArr = Object.keys(markets).map((id) => markets[id]);
  marketsArr.sort(compareByLabel);
  for (const market of marketsArr) {
    const row = marketsTable.insertRow();
    if (!market.isActive) {
      row.classList.add("inactive");
    }
    row.insertCell().appendChild(document.createTextNode(market.label));
    const td2 = row.insertCell()
    td2.appendChild(document.createTextNode(market.last));
    marketIdToPriceCell[market.id] = td2;
  }

  log("markets table created in " + (performance.now() - start) + " ms");
}

// apply mutations in one place, also log important events
function updateMarkets(changes) {
  for (const mid in changes.changed) {
    const market = markets[mid];
    const mchange = changes.changed[mid];
    for (const key in mchange) {
      const [o, n] = mchange[key];
      market[key] = n;
      if (key === "isActive") {
        if (n === true) {
          log("market activated: " + market.label);
        } else {
          log("market deactivated: " + market.label);
        }
      }
    }
  }
  for (const mid in changes.added) {
    const newMarket = changes.added[mid];
    markets[mid] = newMarket;
    log("market added: " + JSON.stringify(newMarket));
  }
  for (const mid in changes.removed) {
    delete markets[mid];
    log("market removed: " + JSON.stringify(changes.removed[mid]));
  }
}

function updateMarketsTable(changes) {
  if (!changes) {
    throw new Error("updateMarketsTable called with empty changes");
  }
  const updateStart = performance.now();

  const changed = changes.changed;

  // we have to update the DOM in two parts because we have to trigger a reflow
  // between removing and adding CSS classes, in order to restart any running
  // CSS animations. Clearing and adding styles in separate loops allows to do
  // just one expensive reflow between them.

  // part 1: clear change styling from changed cells
  const changedKeys = Object.keys(changed);
  for (const mid of changedKeys) {
    marketIdToPriceCell[mid].classList.remove("changed", "positive", "negative");
  }

  // HACK: trigger a synchronous (!) reflow to restart possibly running CSS
  // animations, thanks to https://css-tricks.com/restart-css-animation/
  // more on what triggers reflows here:
  // https://gist.github.com/paulirish/5d52fb081b3570c81e3a
  void marketsTable.offsetWidth; // you're googling 'void' now aren't you? ;)

  // part 2: apply change styling to changed cells
  for (const mid of changedKeys) {
    const marketChange = changed[mid];
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

    const isActiveChange = marketChange["isActive"];
    if (isActiveChange) {
      const [o, n] = isActiveChange;
      if (n === true) {
        td.parentNode.classList.remove("inactive");
      } else {
        td.parentNode.classList.add("inactive");
      }
    }
  }

  const now = performance.now();
  log("markets table updated with " + changedKeys.length + " changes in "
      + (now - updateStart) + " ms, "
      + (now - statsMarketsTableLastUpdated) + " ms since last time");
  statsMarketsTableLastUpdated = now;
}

function asyncFetchMarkets() {
  const url = tickerUrl;
  abortController = new AbortController();
  const start = performance.now();
  const promise = fetch(url, { signal: abortController.signal })
    .then(function(response) {
      if (response.ok) {
        log("http ticker response begins after " + (performance.now() - start)
            + " ms, status " + response.status);
        return response.json();
      } else {
        log("http ticker response not ok");
        throw new Error("Failed to fetch ticker, status " + response.status);
      }
    })
    .then(function(json) {
      log("http ticker finishes after " + (performance.now() - start) + " ms");
      if (json.error) {
        throw new Error("Poloniex API error: " + json.error);
      }
      if (markets) {
        const changes = marketsChangesHttp(json);
        if (changes) {
          updateMarkets(changes);
          updateMarketsTable(changes);
        }
      } else {
        markets = createMarkets(json);
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
  log("http ticker fetch initiated");
  return promise;
}

function fetchMarketsLoop() {
  asyncFetchMarkets().then(function(markets) {
    if (marketsUpdateEnabled) {
      log("scheduling markets update in " + marketsUpdateInterval + " ms");
      marketsTimeout = setTimeout(fetchMarketsLoop, marketsUpdateInterval);
    }
  });
}

function toggleMarketsUpdating() {
  if (marketsUpdateEnabled) {
    log("stopping markets updates");
    marketsUpdateEnabled = false;   // prevent fetchMarketsLoop from setting new timeouts
    clearTimeout(marketsTimeout);   // cancel pending timeouts
    abortController.abort();        // cancel active fetches
    watchMarketsBtn.value = "Watch markets";
  } else {
    log("starting markets updates");
    marketsUpdateEnabled = true;
    fetchMarketsLoop();
    watchMarketsBtn.value = "Unwatch markets";
  }
}

function wsSend(data) {
  if (!ws.sock || ws.sock.readyState !== WebSocket.OPEN) {
    ws.queue.push(data);
    if (ws.queue.length > 5) {
      log("WARN ws queue size is now " + ws.queue.length);
    }
    return;
  }
  const message = JSON.stringify(data);
  log("ws sending: " + message);
  ws.sock.send(message);
}

function subscribeMarkets() {
  wsSend({ "command": "subscribe", "channel": 1002 });
}

function onDisconnected(evt) {
  log("ws disconnected from " + ws.url);
  ws.sock = null;
  connectBtn.value = "Connect";
  connectBtn.onclick = connect;
}

function disconnect() {
  ws.sock.close();
  abortController.abort();
}

function onConnected(evt) {
  console.timeEnd("ws connected");
  log("ws sending " + ws.queue.length + " queued messages");
  // copy and reset shared queue to avoid infinite loops when disconnected
  const queue = ws.queue;
  ws.queue = [];

  for (const req of queue) { wsSend(req); } // drain queue

  connectBtn.value = "Disconnect";
  connectBtn.onclick = disconnect;
}

function updateTickerStatsWs(prevPrice, lastPrice) {
  if (prevPrice === lastPrice) {
    statsTickerPriceUnchanged += 1;
    if (statsTickerPriceUnchanged % 400 === 0) {
      log("ws ticker price unchanged: " + statsTickerPriceUnchanged);
    }
  } else {
    statsTickerPriceChanges += 1;
    if (statsTickerPriceChanges % 40 === 0) {
      log("ws ticker price changes: " + statsTickerPriceChanges);
    }
  }
}

function marketsChangesWs(updates) {
  const changed = {}, added = {}, removed = {};
  // updates look like: [ <chan id>, null,
  // [ <pair id>, "<last trade price>", "<lowest ask>", "<highest bid>",
  //   "<percent change in last 24 h>", "<base currency volume in last 24 h>",
  //   "<quote currency volume in last 24 h>", <is frozen>,
  //   "<highest trade price in last 24 h>", "<lowest trade price in last 24 h>"
  // ], ... ]
  for (let i = 2; i < updates.length; i++) {
    const update = updates[i];
    const mid = update[0];

    const trackedData = {
      isActive: (update[7] !== 1),
      last: update[1],
    }

    const market = markets[mid];
    if (!market) { // added market
      const newMarket = {
        id: mid,
        name: "UNKNOWN_" + mid,
        label: "UNKNOWN/UNKNOWN",
        last: trackedData.last,
        isActive: trackedData.isActive,
      };
      added[mid] = newMarket;
      markets[mid] = newMarket;
      continue;
    }

    updateTickerStatsWs(market.last, trackedData.last);
    addMarketChanges(changed, mid, market, trackedData);
  }

  if (updates.length > 2 + 1) {
    log("UNUSUAL got more than 1 ticker update: " + (updates.length - 2));
  }

  return changesOrNull(changed, added, removed);
}

function updateHeartbeatStatsWs() {
  statsHeartbeats += 1;
  if (statsHeartbeats % 10 === 0) { 
    log("ws heartbeats: " + statsHeartbeats);
  }
}

function onMessage(evt) {
  const data = JSON.parse(evt.data);
  const [channel, seq] = data;
  if (channel === 1010) {
    updateHeartbeatStatsWs();
  } else if (channel === 1002) {
    if (seq === 1) {
      log("ws ticker subscription server ack");
      return;
    }
    const changes = marketsChangesWs(data);
    if (changes) {
      updateMarkets(changes);
      updateMarketsTable(changes);
    }
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

  console.time("ws connected");
  log("ws connecting to " + ws.url);
  ws.sock = new WebSocket(ws.url);

  ws.sock.onerror = (evt) => { log("ws error: " + evt); };
  ws.sock.onclose = onDisconnected;
  ws.sock.onopen = onConnected;
  ws.sock.onmessage = onMessage;

  onConnecting();
}

function initUi() {
  const updateBtn = document.getElementById("update-markets-btn");
  updateBtn.disabled = false;
  updateBtn.onclick = (e => asyncFetchMarkets());
  watchMarketsBtn.disabled = false;
  watchMarketsBtn.onclick = toggleMarketsUpdating;
  connectBtn.disabled = false;
  connectBtn.onclick = connect;
}

initUi();
