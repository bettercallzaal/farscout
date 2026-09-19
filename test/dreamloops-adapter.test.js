import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DreamLoopsAdapter, makeDreamLoopsAdapter } from '../lib/dreamloops-adapter.js';

const testDir = join(tmpdir(), `farscout-dl-test-${Date.now()}`);

test('DreamLoopsAdapter - disabled by default', async () => {
  const adapter = new DreamLoopsAdapter({ enabled: false });
  assert.equal(adapter.enabled, false);
  assert.equal(adapter.hasResearched('test-topic'), false);
  adapter.markResearched('test-topic');
  assert.equal(adapter.hasResearched('test-topic'), false); // Still false when disabled
});

test('DreamLoopsAdapter - when disabled, markResearched is a no-op', async () => {
  const adapter = new DreamLoopsAdapter({ enabled: false });
  adapter.markResearched('topic-1');
  adapter.markResearched('topic-2');
  const state = adapter.getState();
  assert.equal(state.researched_topics.length, 0);
  assert.equal(state.last_topics.length, 0);
  assert.equal(state.run_count, 0);
});

test('DreamLoopsAdapter - when disabled, recordRun is a no-op', async () => {
  const adapter = new DreamLoopsAdapter({ enabled: false });
  adapter.recordRun();
  adapter.recordRun();
  const state = adapter.getState();
  assert.equal(state.run_count, 0);
  assert.equal(state.last_run_at, null);
});

test('DreamLoopsAdapter - when enabled, tracks researched topics', async () => {
  const adapter = new DreamLoopsAdapter({ enabled: true, stateDir: testDir });
  adapter.markResearched('mini-apps');
  adapter.markResearched('zora');
  const state = adapter.getState();
  assert.ok(state.researched_topics.includes('mini-apps'));
  assert.ok(state.researched_topics.includes('zora'));
  assert.equal(state.researched_topics.length, 2);
});

test('DreamLoopsAdapter - when enabled, dedup check works', async () => {
  const adapter = new DreamLoopsAdapter({ enabled: true, stateDir: testDir });
  assert.equal(adapter.hasResearched('solana'), false);
  adapter.markResearched('solana');
  assert.equal(adapter.hasResearched('solana'), true);
});

test('DreamLoopsAdapter - when enabled, tracks run count and timestamp', async () => {
  const adapter = new DreamLoopsAdapter({ enabled: true, stateDir: testDir });
  const before = Date.now();
  adapter.recordRun();
  const after = Date.now();
  const state = adapter.getState();
  assert.equal(state.run_count, 1);
  assert.ok(state.last_run_at >= before && state.last_run_at <= after);
});

test('DreamLoopsAdapter - maintains last_topics queue', async () => {
  const adapter = new DreamLoopsAdapter({ enabled: true, stateDir: testDir });
  adapter.markResearched('topic-1');
  adapter.markResearched('topic-2');
  adapter.markResearched('topic-3');
  const state = adapter.getState();
  assert.deepEqual(state.last_topics, ['topic-3', 'topic-2', 'topic-1']);
});

test('DreamLoopsAdapter - caps last_topics at 100', async () => {
  const adapter = new DreamLoopsAdapter({ enabled: true, stateDir: testDir });
  for (let i = 0; i < 110; i++) {
    adapter.markResearched(`topic-${i}`);
  }
  const state = adapter.getState();
  assert.equal(state.last_topics.length, 100);
  // Newest topics should be at the front
  assert.equal(state.last_topics[0], 'topic-109');
  // Oldest topics should be dropped
  assert.equal(state.last_topics[99], 'topic-10');
});

test('DreamLoopsAdapter - persists state to disk when enabled', async () => {
  await mkdir(testDir, { recursive: true }).catch(() => {});
  const adapter = new DreamLoopsAdapter({ enabled: true, stateDir: testDir });
  adapter.markResearched('frame-1');
  adapter.markResearched('frame-2');
  adapter.recordRun();
  adapter.recordRun();
  await adapter.save();

  // Create a new adapter and load the state
  const adapter2 = new DreamLoopsAdapter({ enabled: true, stateDir: testDir });
  await adapter2.load();
  const state = adapter2.getState();
  assert.ok(state.researched_topics.includes('frame-1'));
  assert.ok(state.researched_topics.includes('frame-2'));
  assert.equal(state.run_count, 2);
});

test('DreamLoopsAdapter - load gracefully handles missing state file', async () => {
  const adapter = new DreamLoopsAdapter({ enabled: true, stateDir: join(testDir, 'missing') });
  await adapter.load(); // Should not throw
  const state = adapter.getState();
  assert.equal(state.researched_topics.length, 0);
  assert.equal(state.run_count, 0);
});

test('DreamLoopsAdapter - load gracefully handles invalid JSON', async () => {
  await mkdir(testDir, { recursive: true }).catch(() => {});
  const adapter = new DreamLoopsAdapter({ enabled: true, stateDir: testDir });
  await writeFile(adapter.stateFile, 'not valid json');
  await adapter.load(); // Should not throw
  const state = adapter.getState();
  assert.equal(state.researched_topics.length, 0);
  assert.equal(state.run_count, 0);
});

test('makeDreamLoopsAdapter factory respects DREAMLOOPS_ENABLED env var', () => {
  const origEnv = process.env.DREAMLOOPS_ENABLED;
  try {
    process.env.DREAMLOOPS_ENABLED = 'true';
    const adapter = makeDreamLoopsAdapter({ stateDir: testDir });
    assert.equal(adapter.enabled, true);

    process.env.DREAMLOOPS_ENABLED = 'false';
    const adapter2 = makeDreamLoopsAdapter({ stateDir: testDir });
    assert.equal(adapter2.enabled, false);
  } finally {
    process.env.DREAMLOOPS_ENABLED = origEnv;
  }
});

test('makeDreamLoopsAdapter factory defaults to false when env var unset', () => {
  const origEnv = process.env.DREAMLOOPS_ENABLED;
  try {
    delete process.env.DREAMLOOPS_ENABLED;
    const adapter = makeDreamLoopsAdapter({ stateDir: testDir });
    assert.equal(adapter.enabled, false);
  } finally {
    process.env.DREAMLOOPS_ENABLED = origEnv;
  }
});

// Cleanup
test.after(async () => {
  try {
    await rm(testDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});
