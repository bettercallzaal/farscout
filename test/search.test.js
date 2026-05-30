import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSearch, detectFrame } from '../lib/search.js';

const okJson = (body) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body });

test('searchCasts normalizes results with warpcast urls', async () => {
  const fetchImpl = async () => okJson({ result: { casts: [{ text: 'about frames', author: { username: 'bob' }, hash: '0xabcdef1234' }] } });
  const search = makeSearch({ base: 'https://h.test', fetchImpl });
  const hits = await search.searchCasts('frames');
  assert.equal(hits[0].source, 'farcaster');
  assert.match(hits[0].url, /warpcast\.com\/bob/);
  assert.equal(hits[0].snippet, 'about frames');
});

test('webSearch uses exa when key present', async () => {
  let hitExa = false;
  const fetchImpl = async (url) => {
    if (url.includes('exa.ai')) { hitExa = true; return okJson({ results: [{ title: 'T', url: 'https://e.com', text: 'snip' }] }); }
    return okJson({});
  };
  const search = makeSearch({ base: 'https://h.test', fetchImpl, exaKey: 'k' });
  const hits = await search.webSearch('miniapps');
  assert.ok(hitExa);
  assert.equal(hits[0].url, 'https://e.com');
  assert.equal(hits[0].source, 'web');
});

test('fetchUrl marks unreachable pages FAILED', async () => {
  const fetchImpl = async () => { throw new Error('dns'); };
  const search = makeSearch({ base: 'https://h.test', fetchImpl });
  const r = await search.fetchUrl('https://nope.invalid');
  assert.equal(r.status, 'FAILED');
});

test('fetchUrl detects a mini app frame', async () => {
  const html = '<meta property="fc:frame" content="vNext"><meta property="og:title" content="My App">';
  const fetchImpl = async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => html });
  const search = makeSearch({ base: 'https://h.test', fetchImpl });
  const r = await search.fetchUrl('https://app.xyz');
  assert.equal(r.status, 'FULL');
  assert.equal(r.frame.title, 'My App');
});

test('detectFrame returns null for plain pages', () => {
  assert.equal(detectFrame('<html><body>hi</body></html>'), null);
});
