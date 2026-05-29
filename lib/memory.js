import { readFile, writeFile } from 'node:fs/promises';

// Durable memory = ZABAL Bonfire knowledge graph. Local JSON cache holds
// dedup keys + a retry queue for episodes that failed to push.
// Bonfire write contract (confirmed against ~/.claude/skills/meeting/scripts/bonfire-episode.sh):
//   POST {base}/knowledge_graph/episode/create
//   Authorization: Bearer <key>
//   { bonfire_id, name, episode_body, source: "text", source_description, reference_time }

// Minimal secret guard mirroring the meeting skill - never ship key-shaped text to the graph.
const SECRET_RE = /sk-ant-[A-Za-z0-9_-]{20,}|sk-(proj-|cp-)?[A-Za-z0-9_-]{30,}|ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{60,}|-----BEGIN ([A-Z]+ )?PRIVATE KEY-----|0x[0-9a-fA-F]{64}|xox[bpaors]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}/;

export function makeMemory({ file, bonfireKey = '', bonfireId = '', bonfireBase = '', fetchImpl }) {
  let state = { episodeHashes: [], queue: [] };
  const known = new Set();
  let seq = 0;

  async function persist() {
    await writeFile(file, JSON.stringify(state, null, 2));
  }

  async function post(text, meta) {
    const payload = {
      bonfire_id: bonfireId,
      name: meta.name || `farscout:${meta.topics?.join('-') || 'note'}:${Date.now()}-${seq++}`,
      episode_body: text,
      source: 'text',
      source_description: meta.source || 'farscout',
      reference_time: new Date().toISOString(),
    };
    const res = await fetchImpl(`${bonfireBase}/knowledge_graph/episode/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bonfireKey}` },
      body: JSON.stringify(payload),
    });
    return res.ok;
  }

  return {
    async load() {
      try {
        state = JSON.parse(await readFile(file, 'utf8'));
      } catch {
        state = { episodeHashes: [], queue: [] };
      }
      state.episodeHashes ??= [];
      state.queue ??= [];
      for (const h of state.episodeHashes) known.add(h);
    },
    isKnown(key) {
      return known.has(key);
    },
    remember(key) {
      if (!known.has(key)) {
        known.add(key);
        state.episodeHashes.push(key);
      }
    },
    queueSize() {
      return state.queue.length;
    },
    async pushEpisode(text, meta = {}) {
      if (SECRET_RE.test(text)) return false; // never push secrets
      try {
        if (await post(text, meta)) {
          await persist();
          return true;
        }
      } catch {
        // fall through to queue
      }
      state.queue.push({ text, meta });
      await persist();
      return false;
    },
    async flushQueue() {
      const pending = state.queue.splice(0);
      for (const item of pending) {
        let ok = false;
        try {
          ok = await post(item.text, item.meta);
        } catch {
          ok = false;
        }
        if (!ok) {
          state.queue.push(item);
          break; // stop on first failure; retry next cycle
        }
      }
      await persist();
    },
    async save() {
      await persist();
    },
  };
}
