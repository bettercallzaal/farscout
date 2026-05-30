import { fetchWithBackoff } from './http.js';

// Crypto enrichment: free, no-auth market data so token/clanker findings carry
// real numbers (price, liquidity, volume, FDV) instead of vibes. Sources:
//   - Dexscreener  : token search across DEXes (free, 300 rpm, no key)
//   - DefiLlama     : protocol TVL (free, no key) [reserved for future use]
// Returns a short factual line per ticker, or [] if nothing solid. Never throws.

const TICKER_RE = /\$([a-z0-9]{2,12})\b/gi;

const fmt = (n) => {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  if (x >= 1e9) return `$${(x / 1e9).toFixed(1)}B`;
  if (x >= 1e6) return `$${(x / 1e6).toFixed(1)}M`;
  if (x >= 1e3) return `$${(x / 1e3).toFixed(1)}K`;
  return `$${x.toFixed(2)}`;
};

// Pull $TICKERS out of arbitrary text (cast bodies, topic slugs).
export function extractTickers(text, max = 3) {
  const seen = new Set();
  const out = [];
  let m;
  TICKER_RE.lastIndex = 0;
  while ((m = TICKER_RE.exec(text || '')) && out.length < max) {
    const t = m[1].toLowerCase();
    if (t.length < 2 || seen.has(t)) continue;
    // skip obvious non-tickers
    if (['the', 'usd', 'gm', 'lfg', 'wagmi'].includes(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

export function createEnrich({ fetchImpl }) {
  // Dexscreener token search -> best (highest-liquidity) pair for a ticker.
  async function dexToken(ticker) {
    try {
      const res = await fetchWithBackoff(
        fetchImpl,
        `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(ticker)}`,
        { headers: { accept: 'application/json' } },
        { retries: 1 },
      );
      if (!res || !res.ok) return null;
      const data = await res.json();
      const pairs = (data?.pairs || []).filter(
        (p) => p.baseToken?.symbol?.toLowerCase() === ticker.toLowerCase(),
      );
      if (!pairs.length) return null;
      pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
      const p = pairs[0];
      return {
        ticker: ticker.toUpperCase(),
        priceUsd: p.priceUsd,
        liquidity: p.liquidity?.usd,
        fdv: p.fdv,
        vol24: p.volume?.h24,
        change24: p.priceChange?.h24,
        chain: p.chainId,
        url: p.url,
      };
    } catch {
      return null;
    }
  }

  // Build a one-line market fact for a ticker, or null.
  async function tickerLine(ticker) {
    const d = await dexToken(ticker);
    if (!d || !d.priceUsd) return null;
    const bits = [`$${d.ticker} ~$${Number(d.priceUsd).toPrecision(3)}`];
    if (d.change24 != null) bits.push(`${Number(d.change24) >= 0 ? '+' : ''}${Number(d.change24).toFixed(1)}% 24h`);
    if (d.liquidity) bits.push(`${fmt(d.liquidity)} liq`);
    if (d.vol24) bits.push(`${fmt(d.vol24)} 24h vol`);
    if (d.fdv) bits.push(`${fmt(d.fdv)} FDV`);
    const line = `${bits.join(', ')} on ${d.chain}`;
    return d.url ? `${line} (${d.url})` : line;
  }

  // Given free text (topic + cast snippets), return up to `max` market lines.
  async function marketFacts(text, max = 3) {
    const tickers = extractTickers(text, max);
    if (!tickers.length) return [];
    const lines = await Promise.all(tickers.map((t) => tickerLine(t)));
    return lines.filter(Boolean);
  }

  return { marketFacts, tickerLine, dexToken };
}
