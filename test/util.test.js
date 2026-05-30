import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize, tokenOverlap, toLines, toSlugs } from '../lib/util.js';

test('canonicalize strips case, separators, trailing s', () => {
  assert.equal(canonicalize('Mini-Apps'), 'miniapp');
  assert.equal(canonicalize('snaps'), 'snap');
  assert.equal(canonicalize('Farcaster Frames'), 'farcasterframe');
});

test('tokenOverlap scores reworded slugs high and unrelated low', () => {
  assert.ok(tokenOverlap('farcaster-frames-v2', 'frames-v2-farcaster') >= 0.6);
  assert.ok(tokenOverlap('mini-apps', 'lens-protocol') < 0.6);
});

test('toLines coerces object-shaped items to strings', () => {
  const out = toLines([{ title: 'A', detail: 'B' }, 'plain', null]);
  assert.ok(out.every((s) => typeof s === 'string'));
  assert.ok(!out.some((s) => s.includes('[object Object]')));
});

test('toSlugs drops junk and slugifies', () => {
  assert.deepEqual(toSlugs(['Farcaster Snaps', 'a', '!!!']), ['farcaster-snaps']);
});
