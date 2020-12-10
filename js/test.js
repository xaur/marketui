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
      if (i > 0) {
        console.log("took %d retries to get unique element %s", i + 1, el);
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

function genPairs(npairs, nbases) {
  // must be significantly greater than npairs to make fewer retries
  const nquotes = npairs * 4;
  const bases = Array.from(genTickers(nbases, 2, 3));
  const quotes = Array.from(genTickers(nquotes, 2, 8));
  const baseToQuotes = new Map(bases.map(b => [b, new Set()]));
  for (let i = 0; i < npairs; i++) {
    // take random base
    const base = randomIndexElement(bases);
    // and add a random element into its corresponding set
    addUniqueElement(baseToQuotes.get(base), () => randomIndexElement(quotes));
  }
  const pairs = [];
  for (const [base, basesquotes] of baseToQuotes) {
    for (const quote of basesquotes) {
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
    markets.set(i, {
      id: i,
      base: base,
      quote: quote,
      label: quote + "/" + base,
      isActive: true,
      last: randomFloat(30000).toFixed(8),
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
