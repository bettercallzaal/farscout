import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeReader } from '../lib/reader.js';

test('userCasts hits correct path and returns casts', async () => {
  let seen;
  const fetchImpl = async (url) => {
    seen = url;
    return { ok: true, json: async () => ({ casts: [{ hash: '0x1', text: 'gm' }] }) };
  };
  const reader = makeReader({ base: 'https://h.test', fid: '99', fetchImpl });
  const casts = await reader.userCasts(10);
  assert.match(seen, /\/v2\/farcaster\/feed\/user\/casts\?fid=99&limit=10/);
  assert.equal(casts[0].text, 'gm');
});

test('non-ok without neynar key returns empty', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const reader = makeReader({ base: 'https://h.test', fid: '99', fetchImpl });
  assert.deepEqual(await reader.userCasts(10), []);
});

test('neynar failover used on non-ok', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url.startsWith('https://h.test')) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, json: async () => ({ casts: [{ text: 'from neynar' }] }) };
  };
  const reader = makeReader({ base: 'https://h.test', fid: '99', fetchImpl, neynarKey: 'k' });
  const casts = await reader.userCasts(5);
  assert.equal(casts[0].text, 'from neynar');
  assert.ok(urls.some((u) => u.startsWith('https://api.neynar.com')));
});

test('channelFeed empty channels returns empty without fetch', async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return { ok: true, json: async () => ({}) };
  };
  const reader = makeReader({ base: 'https://h.test', fid: '1', fetchImpl });
  assert.deepEqual(await reader.channelFeed([]), []);
  assert.equal(called, false);
});
