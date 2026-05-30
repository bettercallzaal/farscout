// Novelty triage: score candidate topics so the scout researches the
// high-signal ones and skips noise. Free, no LLM - pure heuristics over the
// corpus + memory we already have. Higher score = more worth researching.

import { canonicalize, tokenOverlap } from './util.js';

// How many distinct casts in the corpus mention this topic's tokens.
function mentionCount(topic, corpusLines) {
  const keys = topic.split('-').filter((k) => k.length >= 3);
  if (!keys.length) return 0;
  let n = 0;
  for (const line of corpusLines) {
    const l = line.toLowerCase();
    if (keys.some((k) => l.includes(k))) n += 1;
  }
  return n;
}

// Score one topic. memory.isKnown gives recency/dedup; corpus gives traction.
// Returns { topic, score, reason }.
export function scoreTopic(topic, { corpusLines, memory, standing = false }) {
  let score = 0;
  const reasons = [];

  // Standing watch topics always clear the bar (we always want fresh coverage).
  if (standing) {
    score += 2;
    reasons.push('standing');
  }

  // Traction: multiple casts referencing it = the network cares.
  const mentions = mentionCount(topic, corpusLines);
  if (mentions >= 3) {
    score += 3;
    reasons.push(`${mentions} mentions`);
  } else if (mentions === 2) {
    score += 2;
    reasons.push('2 mentions');
  } else if (mentions === 1) {
    score += 1;
  }

  // Novelty: unseen topic is more interesting than one we just covered.
  const known = memory?.isKnown?.(topic);
  if (!known) {
    score += 2;
    reasons.push('novel');
  } else {
    score -= 3;
    reasons.push('seen recently');
  }

  // A $ticker topic is a concrete, enrichable signal - nudge it up.
  if (/\$[a-z0-9]/i.test(topic) || /-token$|-coin$|clanker/i.test(topic)) {
    score += 1;
    reasons.push('token');
  }

  return { topic, score, reason: reasons.join(', ') || 'low signal' };
}

// Rank candidates, drop near-duplicates, return the top `max` above `minScore`.
export function triage(candidates, { corpusLines = [], memory, standingSet = new Set(), max = 3, minScore = 1 } = {}) {
  const scored = candidates.map((t) =>
    scoreTopic(t, { corpusLines, memory, standing: standingSet.has(t) }),
  );
  scored.sort((a, b) => b.score - a.score);

  const picked = [];
  for (const s of scored) {
    if (s.score < minScore) continue;
    // collapse near-duplicates already picked this round
    const dup = picked.some(
      (p) => canonicalize(p.topic) === canonicalize(s.topic) || tokenOverlap(p.topic, s.topic) >= 0.8,
    );
    if (dup) continue;
    picked.push(s);
    if (picked.length >= max) break;
  }
  return picked;
}
