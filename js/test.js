function randomInt(min, max) {
  const imin = Math.ceil(min);
  const imax = Math.floor(max);
  // [min, max) aka the minimum is inclusive and the maximum is exclusive
  return Math.floor(Math.random() * (max - min) + min);
}

function randomFloat(max) {
  return Math.random() * max;
}

function randomIndexElement(arr) {
  return arr[randomInt(0, arr.length)];
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

function randomLetter() {
  return randomIndexElement(ALPHABET);
}

function randomTicker(minlen = 2, maxlen = 8) {
  const len = randomInt(minlen, maxlen + 1);
  const letters = [];
  for (let i = 0; i < len; i++) {
    letters.push(randomLetter());
  }
  return letters.join("");
}

function addUniqueElement(set, genfn) {
  const retries = 10;
  for (let i = 0; i < retries; i++) {
    const el = genfn();
    if (!set.has(el)) {
      if (i > 1) {
        console.log("took %d tries to get unique element %s", i + 1, el);
      }
      set.add(el);
      return el;
    }
  }
  throw new Error("could no get a unique element in %d retries", retries);
}

function genTickers(n, minlen, maxlen) {
  const tickers = new Set();
  for (let i = 0; i < n; i++) {
    addUniqueElement(tickers, () => randomTicker(minlen, maxlen));
  }
  return tickers;
}

function genPairs(npairs, nquotes) {
  // must be significantly greater than npairs to make fewer retries
  const nbases = npairs * 4;
  const bases = Array.from(genTickers(nbases, 2, 8));
  const quotes = Array.from(genTickers(nquotes, 2, 3));
  const quoteToBases = new Map(quotes.map(q => [q, new Set()]));
  for (let i = 0; i < npairs; i++) {
    // take random quote
    const quote = randomIndexElement(quotes);
    // and add a random base into its corresponding set
    addUniqueElement(quoteToBases.get(quote), () => randomIndexElement(bases));
  }
  const pairs = [];
  for (const [quote, basesSet] of quoteToBases) {
    for (const base of basesSet) {
      pairs.push([base, quote]);
    }
  }
  return pairs;
}

function genMarkets(nmarkets) {
  const pairs = genPairs(nmarkets, 8);
  const markets = new Map();
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    const [base, quote] = pair;
    const id = base + "_" + quote;
    markets.set(id, {
      id: id,
      base: base,
      quote: quote,
      label: base + "/" + quote,
      isActive: true,
      last: randomFloat(20000).toFixed(8),
    });
  }
  return markets;
}

function randomChangeFloat(float, ratio) {
  const changeRandomizer = Math.random() * 2 - 1; // [-1, 1)
  const maxChange = float * ratio;
  const change = maxChange * changeRandomizer;
  return float + change;
}

function genMarketsDiff(markets) {
  // must be much lower than markets to have fewer retries
  const nchanges = Math.floor(markets.size / 4);
  const changes = new Map(), additions = new Map(), removals = new Map();

  const mids = Array.from(markets.keys());

  const midsToChange = new Set();
  for (let i = 0; i < nchanges; i++) {
    addUniqueElement(midsToChange, () => randomIndexElement(mids));
  }

  for (const mid of midsToChange) {
    const mkt = markets.get(mid);
    const o = mkt.last;
    const n = randomChangeFloat(parseFloat(mkt.last), 0.02).toFixed(8);
    changes.set(mid, {
      last: [o, n],
    });
  }

  return { changes, additions, removals };
}

function genOrderBook(spot, maxDepth, side) {
  let lowest, highest, direction;
  if (side === "bids") {
    highest = spot;
    lowest = highest / 50;
    direction = -1;
  } else if (side === "asks") {
    lowest = spot;
    highest = lowest * 4;
    direction = 1;
  } else { throw new Error("wrong side"); }
  const depth = randomInt(0, maxDepth);
  const priceStep = direction * (highest - lowest) / depth;
  const sizeFactor = randomInt(1, 20000);
  const book = [];
  for (let i = 0, price = spot; i < depth; i++) {
    price += priceStep;
    const size = Math.random() * sizeFactor;
    // need string for price and float for size
    book.push([price.toFixed(8), parseFloat(size.toFixed(8))]);
  }
  return book;
}

function genOrderBooks(spot, maxDepth) {
  return {
    asks: genOrderBook(spot, maxDepth, "asks"),
    bids: genOrderBook(spot, maxDepth, "bids"),
  }
}

function goTestMode() {
  // globals used: updateMarketsBtn, markets, createMarketsTable, updateMarketsTable
  updateMarketsBtn.onclick = (e) => {
    if (markets) {
      const diff = genMarketsDiff(markets);
      updateMarketsTable(diff);
    } else {
      markets = genMarkets(200);
      createMarketsTable(markets);
    }
  };
  console.log("'%s' button redirected to simulation code", updateMarketsBtn.value);

  // globals used: asyncFetchBooks2, markets, booksEndpoint, createTable, asksTbody, bidsTbody
  asyncFetchBooks2 = (market) => {
    const last = parseFloat(market.last);
    const books = genOrderBooks(last, booksEndpoint.maxDepth);
    createTable(asksTbody, books.asks, [1, 0]);
    createTable(bidsTbody, books.bids);
    return Promise.reject(new RequestIgnored("local testing, no need a request"));
  };
  console.log("'%s' function redirected to simulation code", "asyncFetchBooks2");
}
