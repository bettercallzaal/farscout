import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextInterval, FLOOR_MS, CEIL_MS, START_MS } from '../lib/cadence.js';

test('engaged halves interval down to floor', () => {
  assert.equal(nextInterval(START_MS, true), START_MS / 2);
  assert.equal(nextInterval(FLOOR_MS, true), FLOOR_MS);
  assert.equal(nextInterval(FLOOR_MS * 2, true), FLOOR_MS);
});

test('silent doubles interval up to ceiling', () => {
  assert.equal(nextInterval(START_MS, false), START_MS * 2);
  assert.equal(nextInterval(CEIL_MS, false), CEIL_MS);
  assert.equal(nextInterval(CEIL_MS / 2 + 1, false), CEIL_MS);
});

test('defaults', () => {
  assert.equal(FLOOR_MS, 30 * 60 * 1000);
  assert.equal(CEIL_MS, 24 * 60 * 60 * 1000);
  assert.equal(START_MS, 6 * 60 * 60 * 1000);
});
