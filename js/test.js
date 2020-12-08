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

function addRandomElement(set, genfn) {
  for (let i = 0; i < 10; i++) {
    const el = genfn();
    if (!set.has(el)) {
      if (i > 0) {
        console.log("took %d attempts to generate unique element %s", i + 1, el);
      }
      set.add(el);
      return el;
    }
  }
  throw new Error("could no generate a new unique element in a given set");
}

function genTickers(n, minlen, maxlen) {
  const tickers = new Set();
  for (let i = 0; i < n; i++) {
    addRandomElement(tickers, () => randomTicker(minlen, maxlen));
  }
  return tickers;
}

function genPairs(npairs, nbases, nquotes) {
  const bases = Array.from(genTickers(nbases, 2, 3));
  const quotes = Array.from(genTickers(nquotes, 2, 8));
  const baseToQuotes = new Map(bases.map(b => [b, new Set()]));
  for (let i = 0; i < npairs; i++) {
    // take random base
    const base = randomIndexElement(bases);
    // and add a random element into its corresponding set
    addRandomElement(baseToQuotes.get(base), () => randomIndexElement(quotes));
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
  const pairs = genPairs(nmarkets, 8, 300);
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
