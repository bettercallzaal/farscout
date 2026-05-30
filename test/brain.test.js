import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBrain } from '../lib/brain.js';

test('cloud tier rotates to next free model on failure', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push(JSON.parse(opts.body).model);
    if (calls.length === 1) return { ok: false, status: 429, json: async () => ({}) };
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'answer' } }] }) };
  };
  const brain = makeBrain({ openrouterKey: 'k', freeModels: ['m1', 'm2'], ollamaUrl: '', fetchImpl });
  const out = await brain.ask('q', { tier: 'light' });
  assert.equal(out, 'answer');
  assert.deepEqual(calls, ['m1', 'm2']);
});

test('heavy tier prefers ollama when reachable', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/api/tags')) return { ok: true, json: async () => ({ models: [{ name: 'llama' }] }) };
    if (url.endsWith('/api/chat')) return { ok: true, json: async () => ({ message: { content: 'local' } }) };
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'cloud' } }] }) };
  };
  const brain = makeBrain({ openrouterKey: 'k', freeModels: ['m1'], ollamaUrl: 'http://mac.test', ollamaModel: 'llama', fetchImpl });
  assert.equal(await brain.ask('q', { tier: 'heavy' }), 'local');
});

test('heavy tier falls back to cloud when ollama unreachable', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/api/tags')) throw new Error('refused');
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'cloud' } }] }) };
  };
  const brain = makeBrain({ openrouterKey: 'k', freeModels: ['m1'], ollamaUrl: 'http://mac.test', fetchImpl });
  assert.equal(await brain.ask('q', { tier: 'heavy' }), 'cloud');
});

test('returns null when everything fails', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const brain = makeBrain({ openrouterKey: 'k', freeModels: ['m1'], ollamaUrl: '', fetchImpl });
  assert.equal(await brain.ask('q'), null);
});

test('skips a 200 response that carries an error body (upstream 429)', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    // First model: HTTP 200 but rate-limited in the body. Second: real content.
    if (calls === 1) return { ok: true, json: async () => ({ error: { code: 429, message: 'rate-limited' } }) };
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'answer' } }] }) };
  };
  const brain = makeBrain({ openrouterKey: 'k', freeModels: ['m1', 'm2'], ollamaUrl: '', fetchImpl });
  assert.equal(await brain.ask('q', { tier: 'light' }), 'answer');
  assert.equal(calls, 2);
});
