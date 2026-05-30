import { parseJson, toLines, toSlugs } from './util.js';
import { castWeight } from './reader.js';

const MAX_TOPICS = 3;

const safe = async (p) => {
  try {
    return (await p) || [];
  } catch {
    return [];
  }
};

// Pull every read surface, rank by engagement, return a weighted corpus + embeds.
async function gatherSignal({ reader, channels, watchFids }) {
  const [casts, channelCasts, trending, mentions, watched] = await Promise.all([
    safe(reader.userCasts?.(25)),
    channels.length ? safe(reader.channelFeed?.(channels, 20)) : [],
    safe(reader.trendingFeed?.(20)),
    safe(reader.mentions?.(15)),
    watchFids.length ? safe(reader.watchedFidsCasts?.(watchFids, 10)) : [],
  ]);
  const all = [...casts, ...channelCasts, ...trending, ...mentions, ...watched];
  all.sort((a, b) => castWeight(b) - castWeight(a)); // engagement weighting (#4)
  const top = all.slice(0, 60);
  const corpus = top
    .map((c) => `[likes ${c.reactions?.likes || 0} recasts ${c.reactions?.recasts || 0}] ${c.text}`)
    .filter((l) => l.trim().length > 18)
    .join('\n');
  const embedUrls = [...new Set(top.flatMap((c) => c.embeds || []))];
  return { corpus, embedUrls };
}

// Grounding (#1/#2): collect real sources for a topic before the model writes.
async function gatherSources({ search, topic, seedUrls = [] }) {
  if (!search) return { sources: [], frames: [] };
  const [castHits, webHits] = await Promise.all([
    safe(search.searchCasts(topic, 5)),
    safe(search.webSearch(topic, 4)),
  ]);
  const sources = [...castHits, ...webHits].filter((s) => s && s.url);
  const toFetch = [...seedUrls, ...sources.map((s) => s.url)].slice(0, 3);
  const fetched = await Promise.all(
    toFetch.map((u) => Promise.resolve(search.fetchUrl(u)).catch(() => ({ url: u, status: 'FAILED', frame: null }))),
  );
  const frames = fetched
    .filter((f) => f && f.frame)
    .map((f) => ({ url: f.url, title: f.frame.title, isMiniApp: f.frame.isMiniApp }));
  for (const f of fetched) {
    const src = sources.find((s) => s.url === f.url);
    if (src && f.status === 'FULL' && f.text) src.snippet = f.text.slice(0, 400);
  }
  return { sources: sources.slice(0, 8), frames };
}

// Research one topic against its sources. Each finding is a string ending in its
// source URL; findings the model can't cite to a source are dropped (#1).
export async function researchTopic({ brain, search, topic, seedUrls = [], replyContext = '' }) {
  const { sources, frames } = await gatherSources({ search, topic, seedUrls });
  if (!sources.length) return { findings: [], questions: [], frames };
  const sourceBlock = sources
    .map((s, i) => `[${i + 1}] ${s.title} (${s.url})\n    ${s.snippet || '(no snippet)'}`)
    .join('\n');
  const research = await brain.ask(
    `You are a Farcaster research scout for the ZAO ecosystem. Using ONLY the SOURCES below, write 1-2 concrete findings about "${topic}". Each finding MUST be a plain factual sentence grounded in a source, and include which source number it came from. If the sources are empty or irrelevant, return no findings - never invent. Add at most 1 short question for the operator. Reply ONLY JSON in this exact shape: {"findings":[{"text":"a full sentence","cite":1}],"questions":["short question?"]}.${replyContext}\n\nSOURCES:\n${sourceBlock}`,
    { tier: 'heavy' },
  );
  const parsed = parseJson(research, { findings: [], questions: [] });
  const findings = (Array.isArray(parsed.findings) ? parsed.findings : [])
    .map((f) => {
      const text = typeof f === 'string' ? f : f?.text;
      const cite = typeof f === 'object' ? Number(f.cite) : NaN;
      const src = sources[cite - 1] || sources[0];
      if (!text || typeof text !== 'string') return '';
      const url = src?.url || '';
      return url ? `${text.trim()} (${url})` : '';
    })
    .filter(Boolean);
  const questions = toLines(parsed.questions).slice(0, 1);
  return { findings, questions, frames };
}

// One full cycle: signal -> extract topics (+ standing) -> dedup -> ground +
// research each -> remember + push to Bonfire. Returns findings/questions/frames.
export async function runCycle({
  reader,
  brain,
  memory,
  search,
  channels = [],
  watchFids = [],
  standingTopics = [],
  recentReplies = [],
}) {
  const { corpus, embedUrls } = await gatherSignal({ reader, channels, watchFids });
  if (!corpus && !standingTopics.length) return { findings: [], questions: [], frames: [] };

  let candidates = [];
  if (corpus) {
    const extract = await brain.ask(
      `Below are recent Farcaster casts (with engagement counts). Identify the real themes/topics being discussed, weighting toward higher likes/recasts. Use lowercase-hyphenated slugs derived from the ACTUAL content - do not invent topics, do not copy this instruction. Reply ONLY JSON in this exact shape: {"topics":["theme-one","theme-two"],"summary":"one sentence"}.\n\nCASTS:\n${corpus}`,
      { tier: 'light' },
    );
    candidates = toSlugs(parseJson(extract, { topics: [] }).topics);
  }
  // Standing watch topics (#2): miniapps/frames/snaps always covered.
  candidates = [...toSlugs(standingTopics), ...candidates];

  const novel = [];
  for (const t of candidates) {
    if (novel.length >= MAX_TOPICS) break;
    if (!memory.isKnown(t) && !novel.includes(t)) novel.push(t);
  }
  if (!novel.length) return { findings: [], questions: [], frames: [] };

  const replyContext = recentReplies.length
    ? `\nThe operator recently told you: ${recentReplies.join(' | ')}`
    : '';

  const findings = [];
  const questions = [];
  const frames = [];
  const day = new Date().toISOString().slice(0, 10);
  for (const topic of novel) {
    const seedUrls = embedUrls
      .filter((u) => u.toLowerCase().includes(topic.split('-')[0]))
      .slice(0, 2);
    const res = await researchTopic({ brain, search, topic, seedUrls, replyContext });
    findings.push(...res.findings);
    questions.push(...res.questions);
    frames.push(...res.frames);
    memory.remember(topic);
    for (const f of res.findings) {
      await memory.pushEpisode(`farscout learned (${day}): ${f}`, { source: 'farscout', topics: [topic] });
    }
  }

  return { findings, questions: questions.slice(0, 2), frames };
}
