import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithBackoff, htmlToText, isPublicHttpUrl } from '../lib/http.js';

test('retries on 429 then succeeds', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return { ok: false, status: 429, headers: { get: () => null } };
    return { ok: true, status: 200, headers: { get: () => null } };
  };
  const res = await fetchWithBackoff(fetchImpl, 'https://x', {}, { retries: 2, baseDelay: 1 });
  assert.equal(res.status, 200);
  assert.equal(calls, 2);
});

test('returns last response after exhausting retries on 500', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return { ok: false, status: 500, headers: { get: () => null } }; };
  const res = await fetchWithBackoff(fetchImpl, 'https://x', {}, { retries: 1, baseDelay: 1 });
  assert.equal(res.status, 500);
  assert.equal(calls, 2);
});

test('rethrows network errors after retries', async () => {
  const fetchImpl = async () => { throw new Error('dns'); };
  await assert.rejects(fetchWithBackoff(fetchImpl, 'https://x', {}, { retries: 1, baseDelay: 1 }), /dns/);
});

test('htmlToText strips tags and scripts', () => {
  assert.equal(htmlToText('<script>bad()</script><p>Hello <b>world</b></p>'), 'Hello world');
});

test('isPublicHttpUrl blocks SSRF targets', () => {
  for (const bad of [
    'http://localhost/x',
    'http://127.0.0.1/x',
    'https://169.254.169.254/latest/meta-data/',
    'http://10.0.0.5/x',
    'http://192.168.1.1/x',
    'http://172.16.0.1/x',
    'http://[::1]/x',
    'http://foo.local/x',
    'file:///etc/passwd',
    'ftp://example.com/x',
    'not a url',
  ]) {
    assert.equal(isPublicHttpUrl(bad), false, bad);
  }
});

test('isPublicHttpUrl allows public https', () => {
  assert.equal(isPublicHttpUrl('https://warpcast.com/x'), true);
  assert.equal(isPublicHttpUrl('http://8.8.8.8/x'), true);
});
