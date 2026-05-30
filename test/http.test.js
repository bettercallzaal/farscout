import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithBackoff, htmlToText } from '../lib/http.js';

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
