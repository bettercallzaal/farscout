import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDreamLoopsAdapter } from '../lib/dreamloops-adapter.js';

test('Flag gate: adapter is inert when DREAMLOOPS_ENABLED is unset (default OFF)', () => {
  const origEnv = process.env.DREAMLOOPS_ENABLED;
  try {
    // Simulate unset (default behavior)
    delete process.env.DREAMLOOPS_ENABLED;
    const adapter = makeDreamLoopsAdapter();

    // All operations should be no-ops
    assert.equal(adapter.enabled, false);
    adapter.markResearched('test-topic');
    assert.equal(adapter.hasResearched('test-topic'), false);
    adapter.recordRun();
    const state = adapter.getState();
    assert.deepEqual(state, {
      researched_topics: [],
      last_topics: [],
      run_count: 0,
      last_run_at: null,
    });
  } finally {
    process.env.DREAMLOOPS_ENABLED = origEnv;
  }
});

test('Flag gate: DREAMLOOPS_ENABLED=false makes adapter inert', () => {
  const origEnv = process.env.DREAMLOOPS_ENABLED;
  try {
    process.env.DREAMLOOPS_ENABLED = 'false';
    const adapter = makeDreamLoopsAdapter();

    // All operations should be no-ops
    assert.equal(adapter.enabled, false);
    adapter.markResearched('topic-1');
    adapter.markResearched('topic-2');
    adapter.recordRun();
    const state = adapter.getState();
    assert.deepEqual(state, {
      researched_topics: [],
      last_topics: [],
      run_count: 0,
      last_run_at: null,
    });
  } finally {
    process.env.DREAMLOOPS_ENABLED = origEnv;
  }
});

test('Flag gate: DREAMLOOPS_ENABLED=true activates tracking', () => {
  const origEnv = process.env.DREAMLOOPS_ENABLED;
  try {
    process.env.DREAMLOOPS_ENABLED = 'true';
    const adapter = makeDreamLoopsAdapter();

    assert.equal(adapter.enabled, true);
    adapter.markResearched('topic-1');
    adapter.markResearched('topic-2');
    adapter.recordRun();
    const state = adapter.getState();
    assert.ok(state.researched_topics.includes('topic-1'));
    assert.ok(state.researched_topics.includes('topic-2'));
    assert.equal(state.run_count, 1);
  } finally {
    process.env.DREAMLOOPS_ENABLED = origEnv;
  }
});

test('Flag gate: promise that when OFF, farscout behavior is unchanged', () => {
  const origEnv = process.env.DREAMLOOPS_ENABLED;
  try {
    delete process.env.DREAMLOOPS_ENABLED; // Default OFF

    // Create adapter in its default (disabled) state
    const adapter = makeDreamLoopsAdapter();

    // Scenario 1: Run 100 topics through the adapter - all should report as "not researched"
    const topics = Array.from({ length: 100 }, (_, i) => `topic-${i}`);
    for (const topic of topics) {
      adapter.markResearched(topic);
      // Even though we marked it, hasResearched should return false (inert)
      assert.equal(adapter.hasResearched(topic), false);
    }

    // Scenario 2: Multiple runs - run_count should stay 0
    for (let i = 0; i < 50; i++) {
      adapter.recordRun();
    }
    const state = adapter.getState();
    assert.equal(state.run_count, 0, 'run_count must be 0 when disabled');

    // Scenario 3: State file should remain empty when disabled
    const finalState = adapter.getState();
    assert.deepEqual(finalState.researched_topics, []);
    assert.deepEqual(finalState.last_topics, []);
    assert.equal(finalState.run_count, 0);
    assert.equal(finalState.last_run_at, null);
  } finally {
    process.env.DREAMLOOPS_ENABLED = origEnv;
  }
});
