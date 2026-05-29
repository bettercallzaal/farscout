function parseJson(text, fallback) {
  if (!text) return fallback;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return fallback;
  try {
    return JSON.parse(m[0]);
  } catch {
    return fallback;
  }
}

// Small models sometimes return list items as objects ({title, detail}) or
// nested arrays instead of plain strings. Coerce every item to a clean line.
function toLines(arr) {
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
function toSlugs(arr) {
  return toLines(arr)
    .map((s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
    .filter((s) => s.length >= 2 && s.length <= 60);
}

// One research cycle: pull signal -> extract topics -> dedup -> research novel
// topics -> remember + push to Bonfire. Returns findings + questions for Discord.
export async function runCycle({ reader, brain, memory, channels = [], recentReplies = [] }) {
  const casts = await reader.userCasts(25);
  const channelCasts = channels.length ? await reader.channelFeed(channels, 25) : [];
  const corpus = [...casts, ...channelCasts]
    .map((c) => c.text)
    .filter(Boolean)
    .join('\n');
  if (!corpus) return { findings: [], questions: [] };

  const extract = await brain.ask(
    `Below are recent Farcaster casts. Identify the real themes/topics the author is focused on. Use lowercase-hyphenated slugs derived from the ACTUAL content - do not invent topics, do not copy this instruction. Reply ONLY JSON in this exact shape: {"topics":["theme-one","theme-two"],"summary":"one sentence"}.\n\nCASTS:\n${corpus}`,
    { tier: 'light' },
  );
  const novel = toSlugs(parseJson(extract, { topics: [] }).topics).filter((t) => !memory.isKnown(t));
  if (!novel.length) return { findings: [], questions: [] };

  const replyContext = recentReplies.length ? `\nThe operator recently told you: ${recentReplies.join(' | ')}` : '';
  const research = await brain.ask(
    `You are a Farcaster research scout for the ZAO ecosystem. For each topic, give one concrete finding as a plain sentence (a string, never an object). Then ask at most 2 short questions for the operator. Reply ONLY JSON in this exact shape: {"findings":["a full sentence","another sentence"],"questions":["short question?"]}.\nTopics: ${novel.join(', ')}${replyContext}`,
    { tier: 'heavy' },
  );
  const parsed = parseJson(research, { findings: [], questions: [] });
  const findings = toLines(parsed.findings);
  const questions = toLines(parsed.questions);

  for (const t of novel) memory.remember(t);
  for (const f of findings) {
    await memory.pushEpisode(`farscout learned (${new Date().toISOString().slice(0, 10)}): ${f}`, {
      source: 'farscout',
      topics: novel,
    });
  }

  return { findings, questions: questions.slice(0, 2) };
}
