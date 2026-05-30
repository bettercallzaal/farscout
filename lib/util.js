// Shared coercion + dedup helpers.

export function parseJson(text, fallback) {
  if (!text) return fallback;
  // Strip markdown code fences small models love to add.
  let t = String(text).replace(/```(?:json)?/gi, '');
  // Try the greedy first-brace-to-last-brace span.
  const greedy = t.match(/\{[\s\S]*\}/);
  if (greedy) {
    try {
      return JSON.parse(greedy[0]);
    } catch {
      // fall through to brace-matching - the model likely rambled AFTER the JSON
    }
  }
  // Brace-matching: parse the first complete balanced {...} object, ignoring any
  // trailing reasoning the model appended ("...wait, that" etc).
  const start = t.indexOf('{');
  if (start === -1) return fallback;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < t.length; i += 1) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(t.slice(start, i + 1));
        } catch {
          return fallback;
        }
      }
    }
  }
  return fallback;
}

// Small models sometimes return list items as objects ({title, detail}) or
// nested arrays instead of plain strings. Coerce every item to a clean line.
export function toLines(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((item) => {
      if (item == null) return '';
      if (typeof item === 'string') return item.trim();
      if (typeof item === 'object') {
        const v = item.text ?? item.finding ?? item.fact ?? item.question ?? item.title ?? item.summary;
        if (typeof v === 'string') return v.trim();
        return Object.values(item).filter((x) => typeof x === 'string').join(' - ').trim();
      }
      return String(item).trim();
    })
    .filter(Boolean);
}

// Topic slugs must be lowercase-hyphenated strings; drop anything malformed.
export function toSlugs(arr) {
  return toLines(arr)
    .map((s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
    .filter((s) => s.length >= 2 && s.length <= 60);
}

// Fuzzy dedup (#5): collapse "mini-apps" / "Mini Apps" / "miniapp" to one key.
export function canonicalize(topic) {
  return String(topic || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .replace(/s$/, '');
}

function sigTokens(s) {
  return new Set(
    String(s || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3)
      .map((w) => w.replace(/s$/, '')),
  );
}

// Jaccard overlap of significant tokens - catches reworded slugs.
export function tokenOverlap(a, b) {
  const ta = sigTokens(a);
  const tb = sigTokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / (ta.size + tb.size - inter);
}
