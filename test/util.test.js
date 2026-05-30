import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize, tokenOverlap, toLines, toSlugs, parseJson } from '../lib/util.js';

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

test('parseJson recovers when the model rambles after the JSON', () => {
  const raw = '{"findings":[{"text":"x","cite":1}],"questions":["y?"]} ... wait, that might be wrong, let me reconsider';
  const out = parseJson(raw, { findings: [] });
  assert.equal(out.findings[0].text, 'x');
  assert.equal(out.questions[0], 'y?');
});

test('parseJson strips markdown fences', () => {
  const raw = '```json\n{"ok":true,"n":42}\n```';
  assert.deepEqual(parseJson(raw, {}), { ok: true, n: 42 });
});

test('parseJson handles nested braces via brace-matching', () => {
  const raw = 'here you go: {"a":{"b":1},"c":2} trailing junk {not json}';
  assert.deepEqual(parseJson(raw, {}), { a: { b: 1 }, c: 2 });
});
