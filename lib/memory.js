import { readFile, writeFile } from 'node:fs/promises';
import { canonicalize, tokenOverlap } from './util.js';

// Durable memory = ZABAL Bonfire knowledge graph. Local JSON cache holds
// dedup keys + a retry queue for episodes that failed to push.
// Bonfire write contract (confirmed against ~/.claude/skills/meeting/scripts/bonfire-episode.sh):
//   POST {base}/knowledge_graph/episode/create
//   Authorization: Bearer <key>
//   { bonfire_id, name, episode_body, source: "text", source_description, reference_time }

// Minimal secret guard mirroring the meeting skill - never ship key-shaped text to the graph.
const SECRET_RE = /sk-ant-[A-Za-z0-9_-]{20,}|sk-(proj-|cp-)?[A-Za-z0-9_-]{30,}|ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{60,}|-----BEGIN ([A-Z]+ )?PRIVATE KEY-----|0x[0-9a-fA-F]{64}|xox[bpaors]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}/;

// Cap dedup memory (#8): bounds cache-file size AND the per-check fuzzy scan,
// which is O(n) over this set. Oldest keys age out first.
const MAX_HASHES = 5000;
// Bound the offline retry queue so a long Bonfire outage cannot OOM the process.
const MAX_QUEUE = 500;

// Temporal memory (#4): how many distinct days a topic must appear on before it
// counts as a "storyline" worth a rollup callout.
const STORYLINE_MIN = 3;
// A topic mention older than this (days) no longer counts toward an active storyline.
const STORYLINE_WINDOW_DAYS = 30;

export function makeMemory({ file, bonfireKey = '', bonfireId = '', bonfireBase = '', fetchImpl, now = () => Date.now() }) {
  // topics: { [canonicalSlug]: { label, count, first, last } } - temporal index.
  let state = { episodeHashes: [], queue: [], topics: {} };
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
      state.topics ??= {};
      if (state.episodeHashes.length > MAX_HASHES) state.episodeHashes = state.episodeHashes.slice(-MAX_HASHES);
      for (const h of state.episodeHashes) known.add(h);
    },
    // Temporal tracking (#4): record that a topic was researched now. Counts
    // distinct mentions over time so storylines ("3rd time this month") surface.
    recordMention(key, ts = now()) {
      const c = canonicalize(key);
      const t = (state.topics[c] ??= { label: key, count: 0, first: ts, last: ts });
      t.label = key;
      t.count += 1;
      t.last = ts;
      t.first ??= ts;
    },
    mentionInfo(key) {
      return state.topics[canonicalize(key)] || null;
    },
    // Active storylines: topics mentioned >=STORYLINE_MIN times within the window,
    // most-mentioned first. Powers the weekly rollup (#5).
    storylines(nowTs = now()) {
      const cutoff = nowTs - STORYLINE_WINDOW_DAYS * 86400000;
      return Object.values(state.topics)
        .filter((t) => t.count >= STORYLINE_MIN && t.last >= cutoff)
        .sort((a, b) => b.count - a.count)
        .map((t) => ({ label: t.label, count: t.count, first: t.first, last: t.last }));
    },
    // Fuzzy dedup (#5): exact, canonical, or strong token overlap with a prior key.
    // Threshold 0.8 (#6): catches reorderings/plurals (overlap ~1.0) without
    // collapsing a narrower subtopic into a broader known one (e.g. mini-apps-auth
    // vs mini-apps = 0.67, kept distinct so the subtopic still gets researched).
    isKnown(key) {
      const c = canonicalize(key);
      // Recency decay (#4): a topic last researched > window ago is "novel
      // again" - the network may have moved, worth a fresh look. Checked BEFORE
      // the known-set short-circuit so a tracked-but-stale topic actually decays.
      const info = state.topics[c];
      if (info && now() - info.last > STORYLINE_WINDOW_DAYS * 86400000) return false;
      if (known.has(key)) return true;
      for (const k of known) {
        if (canonicalize(k) === c) return true;
        if (tokenOverlap(k, key) >= 0.8) return true;
      }
      return false;
    },
    remember(key) {
      if (!known.has(key)) {
        known.add(key);
        state.episodeHashes.push(key);
        if (state.episodeHashes.length > MAX_HASHES) {
          const evicted = state.episodeHashes.shift();
          known.delete(evicted);
        }
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
      if (state.queue.length >= MAX_QUEUE) state.queue.shift(); // drop oldest
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
