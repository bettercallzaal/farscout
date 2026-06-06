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

test('searchReddit returns threads as citable sources with reddit.com urls', async () => {
  let seen;
  const fetchImpl = async (url, opts) => {
    seen = { url, ua: opts.headers?.['user-agent'] };
    return okJson({ data: { children: [
      { data: { subreddit: 'farcaster', title: 'Mini apps are taking off', selftext: 'long body', permalink: '/r/farcaster/comments/x/mini/' } },
    ] } });
  };
  const search = makeSearch({ base: 'https://h.test', fetchImpl, redditUserAgent: 'UA-Z' });
  const hits = await search.searchReddit('mini apps');
  assert.match(seen.url, /reddit\.com\/search\.json\?q=mini%20apps/);
  assert.equal(seen.ua, 'UA-Z');
  assert.equal(hits[0].source, 'reddit');
  assert.equal(hits[0].url, 'https://www.reddit.com/r/farcaster/comments/x/mini/');
  assert.match(hits[0].title, /^r\/farcaster:/);
});

test('searchReddit is a no-op when reddit is disabled', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return okJson({}); };
  const search = makeSearch({ base: 'https://h.test', fetchImpl, redditEnabled: false });
  assert.deepEqual(await search.searchReddit('anything'), []);
  assert.equal(called, false);
});

test('searchReddit fails soft on a non-ok response', async () => {
  const fetchImpl = async () => ({ ok: false, status: 429, headers: { get: () => null }, json: async () => ({}) });
  const search = makeSearch({ base: 'https://h.test', fetchImpl });
  assert.deepEqual(await search.searchReddit('x'), []);
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

test('fetchUrl blocks SSRF targets without fetching', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return okJson({}); };
  const search = makeSearch({ base: 'https://h.test', fetchImpl });
  const r = await search.fetchUrl('http://169.254.169.254/latest/meta-data/');
  assert.equal(r.status, 'BLOCKED');
  assert.equal(called, false);
});

test('fetchUrl does not follow redirects (SSRF via 3xx)', async () => {
  // redirect:'manual' makes a 3xx come back non-ok; fetchUrl must not follow it.
  const fetchImpl = async (url, opts) => {
    assert.equal(opts.redirect, 'manual');
    return { ok: false, status: 302, headers: { get: () => 'http://169.254.169.254/' }, text: async () => '' };
  };
  const search = makeSearch({ base: 'https://h.test', fetchImpl });
  const r = await search.fetchUrl('https://public.example/redir');
  assert.equal(r.status, 'FAILED');
});

test('duckSearch parses results when href precedes class', async () => {
  const html = '<a href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fdocs.farcaster.xyz%2Fframes" class="result__a">Frames docs</a>';
  const fetchImpl = async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => html });
  const search = makeSearch({ base: 'https://h.test', fetchImpl }); // no exaKey -> duck path
  const hits = await search.webSearch('frames');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].url, 'https://docs.farcaster.xyz/frames');
  assert.equal(hits[0].title, 'Frames docs');
});

test('detectFrame returns null for plain pages', () => {
  assert.equal(detectFrame('<html><body>hi</body></html>'), null);
});
