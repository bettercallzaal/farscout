import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeMemory } from '../lib/memory.js';

function tmpFile() {
  return join(mkdtempSync(join(tmpdir(), 'fs-')), 'cache.json');
}

test('isKnown false then true after remember', async () => {
  const mem = makeMemory({ file: tmpFile(), fetchImpl: async () => ({ ok: true }) });
  await mem.load();
  assert.equal(mem.isKnown('miniapp-auth'), false);
  mem.remember('miniapp-auth');
  assert.equal(mem.isKnown('miniapp-auth'), true);
});

test('pushEpisode posts real bonfire contract on success', async () => {
  let body;
  let url;
  const fetchImpl = async (u, opts) => {
    url = u;
    body = JSON.parse(opts.body);
    return { ok: true };
  };
  const mem = makeMemory({ file: tmpFile(), bonfireKey: 'k', bonfireId: 'B1', bonfireBase: 'https://b.test', fetchImpl });
  await mem.load();
  const ok = await mem.pushEpisode('learned X', { topics: ['snaps'], source: 'farscout' });
  assert.equal(ok, true);
  assert.equal(url, 'https://b.test/knowledge_graph/episode/create');
  assert.equal(body.bonfire_id, 'B1');
  assert.equal(body.episode_body, 'learned X');
  assert.equal(body.source, 'text');
  assert.equal(body.source_description, 'farscout');
  assert.ok(body.reference_time);
});

test('pushEpisode enqueues on failure', async () => {
  const mem = makeMemory({ file: tmpFile(), bonfireKey: 'k', bonfireId: 'B1', bonfireBase: 'https://b.test', fetchImpl: async () => ({ ok: false, status: 500 }) });
  await mem.load();
  assert.equal(await mem.pushEpisode('learned X', { topic: 'snaps' }), false);
  assert.equal(mem.queueSize(), 1);
});

test('pushEpisode refuses to push secret-shaped text', async () => {
  let called = false;
  const mem = makeMemory({ file: tmpFile(), bonfireKey: 'k', bonfireId: 'B1', bonfireBase: 'https://b.test', fetchImpl: async () => { called = true; return { ok: true }; } });
  await mem.load();
  const ok = await mem.pushEpisode('my key is ghp_0123456789012345678901234567890123ab', {});
  assert.equal(ok, false);
  assert.equal(called, false);
});

test('flushQueue drains when bonfire recovers', async () => {
  const file = tmpFile();
  const down = makeMemory({ file, bonfireKey: 'k', bonfireId: 'B1', bonfireBase: 'https://b.test', fetchImpl: async () => ({ ok: false, status: 500 }) });
  await down.load();
  await down.pushEpisode('queued fact', {});
  assert.equal(down.queueSize(), 1);

  const up = makeMemory({ file, bonfireKey: 'k', bonfireId: 'B1', bonfireBase: 'https://b.test', fetchImpl: async () => ({ ok: true }) });
  await up.load();
  assert.equal(up.queueSize(), 1);
  await up.flushQueue();
  assert.equal(up.queueSize(), 0);
});
