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
  async function askCloud(prompt) {
    for (const model of freeModels) {
      try {
        const res = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${openrouterKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] }),
        });
        if (!res.ok) continue;
        const d = await res.json();
        const text = d?.choices?.[0]?.message?.content;
        if (text) return text;
      } catch {
        // try next model
      }
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
