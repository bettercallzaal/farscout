import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEnrich, extractTickers } from '../lib/enrich.js';

test('extractTickers pulls cashtags, dedups, skips noise', () => {
  const t = extractTickers('gm $CLANKER and $clanker mooning, also $USD and $gm', 5);
  assert.deepEqual(t, ['clanker']);
});

test('marketFacts builds a grounded line from Dexscreener', async () => {
  const fetchImpl = async (url) => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({
      pairs: [{
        baseToken: { symbol: 'CLANKER' },
        priceUsd: '1.2345',
        liquidity: { usd: 2_500_000 },
        fdv: 80_000_000,
        volume: { h24: 1_200_000 },
        priceChange: { h24: 12.3 },
        chainId: 'base',
        url: 'https://dexscreener.com/base/0xabc',
      }],
    }),
  });
  const enrich = createEnrich({ fetchImpl });
  const lines = await enrich.marketFacts('what about $clanker today', 3);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /\$CLANKER/);
  assert.match(lines[0], /\+12\.3% 24h/);
  assert.match(lines[0], /\$2\.5M liq/);
  assert.match(lines[0], /dexscreener\.com\/base/);
});

test('marketFacts returns empty when no ticker matches the pair', async () => {
  const fetchImpl = async () => ({
    ok: true, status: 200, headers: { get: () => null },
    json: async () => ({ pairs: [{ baseToken: { symbol: 'OTHER' }, priceUsd: '1' }] }),
  });
  const enrich = createEnrich({ fetchImpl });
  assert.deepEqual(await enrich.marketFacts('$clanker', 3), []);
});

test('marketFacts never throws on network error', async () => {
  const fetchImpl = async () => { throw new Error('down'); };
  const enrich = createEnrich({ fetchImpl });
  assert.deepEqual(await enrich.marketFacts('$clanker', 3), []);
});
