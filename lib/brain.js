// Hybrid model router. Default: OpenRouter free models (rotated on failure).
// When a Mac Ollama tunnel is reachable, heavy/private tiers route there first.
export function makeBrain({ openrouterKey, freeModels, ollamaUrl, ollamaModel = 'llama3.1', fetchImpl }) {
  async function ollamaReachable() {
    if (!ollamaUrl) return false;
    try {
      const res = await fetchImpl(`${ollamaUrl}/api/tags`, { method: 'GET' });
      return res.ok;
    } catch {
      return false;
    }
  }
  async function askOllama(prompt) {
    try {
      const res = await fetchImpl(`${ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: ollamaModel, stream: false, messages: [{ role: 'user', content: prompt }] }),
      });
      if (!res.ok) return null;
      const d = await res.json();
      return d?.message?.content ?? null;
    } catch {
      return null;
    }
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // OpenRouter free models are a shared, heavily rate-limited pool. Critically,
  // a rate-limited model returns HTTP 200 with an {error:{code:429}} body (not a
  // non-2xx status), so we must inspect the body, not just res.ok. At any instant
  // only some models answer; the rest 429. So we rotate through all models, and
  // if a whole pass comes up empty we retry a few rounds with a short backoff -
  // converting transient saturation into eventual success (fine for this bot's
  // idle cadence; /dig just waits a few extra seconds).
  async function askCloud(prompt, rounds = 3) {
    for (let round = 0; round < rounds; round += 1) {
      for (const model of freeModels) {
        try {
          const res = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${openrouterKey}`, 'content-type': 'application/json' },
            body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] }),
          });
          if (!res.ok) continue;
          const d = await res.json();
          if (d?.error) continue; // 200-with-error-body (e.g. upstream 429)
          const text = d?.choices?.[0]?.message?.content;
          if (text) return text;
        } catch {
          // try next model
        }
      }
      if (round < rounds - 1) await wait(800 * (round + 1)); // 0.8s, 1.6s between rounds
    }
    return null;
  }
  return {
    async ask(prompt, { tier = 'light' } = {}) {
      if ((tier === 'heavy' || tier === 'private') && (await ollamaReachable())) {
        const local = await askOllama(prompt);
        if (local) return local;
      }
      const cloud = await askCloud(prompt);
      if (cloud) return cloud;
      if (await ollamaReachable()) return askOllama(prompt);
      return null;
    },
  };
}
