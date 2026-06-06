import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveThemes, THEME_PRESETS, KNOWN_THEMES } from '../lib/themes.js';

test('resolveThemes merges multiple themes (farcaster + gamestop)', () => {
  const r = resolveThemes(['farcaster', 'gamestop']);
  // Farcaster channels + topics present.
  assert.ok(r.channels.includes('zao'));
  assert.ok(r.standingTopics.includes('farcaster-mini-apps'));
  // GameStop subreddits + topics present.
  assert.ok(r.subreddits.includes('Superstonk'));
  assert.ok(r.standingTopics.includes('gamestop-stock'));
  // Farcaster subreddit also there.
  assert.ok(r.subreddits.includes('farcaster'));
});

test('resolveThemes is case-insensitive on theme names', () => {
  const r = resolveThemes(['Farcaster', 'GAMESTOP']);
  assert.ok(r.subreddits.includes('Superstonk'));
  assert.ok(r.channels.includes('zao'));
});

test('resolveThemes dedups case-insensitively across themes', () => {
  // Both presets are fine; ensure no dup if a sub appears twice.
  const r = resolveThemes(['gamestop', 'gamestop']);
  const lower = r.subreddits.map((s) => s.toLowerCase());
  assert.equal(new Set(lower).size, lower.length);
});

test('resolveThemes ignores unknown themes but reports them', () => {
  const r = resolveThemes(['farcaster', 'doesnotexist']);
  assert.ok(r.channels.includes('zao'));
  assert.deepEqual(r.unknown, ['doesnotexist']);
});

test('resolveThemes empty input yields empty surfaces', () => {
  const r = resolveThemes([]);
  assert.deepEqual(r.channels, []);
  assert.deepEqual(r.subreddits, []);
  assert.deepEqual(r.standingTopics, []);
});

test('KNOWN_THEMES lists the presets', () => {
  assert.deepEqual(KNOWN_THEMES.sort(), Object.keys(THEME_PRESETS).sort());
  assert.ok(KNOWN_THEMES.includes('farcaster'));
  assert.ok(KNOWN_THEMES.includes('gamestop'));
});
