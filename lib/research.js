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
    `Summarize what this Farcaster operator and their channels are focused on. Reply ONLY JSON: {"topics":["kebab-topic"],"summary":"..."}.\n\n${corpus}`,
    { tier: 'light' },
  );
  const { topics = [] } = parseJson(extract, { topics: [] });
  const novel = topics.filter((t) => t && !memory.isKnown(t));
  if (!novel.length) return { findings: [], questions: [] };

  const replyContext = recentReplies.length ? `\nOperator recently said: ${recentReplies.join(' | ')}` : '';
  const research = await brain.ask(
    `You are a Farcaster research scout for the ZAO ecosystem. Research these novel topics and report concisely. Reply ONLY JSON: {"findings":["one fact per item"],"questions":["max 2 short questions for the operator"]}.\nTopics: ${novel.join(', ')}${replyContext}`,
    { tier: 'heavy' },
  );
  const { findings = [], questions = [] } = parseJson(research, { findings: [], questions: [] });

  for (const t of novel) memory.remember(t);
  for (const f of findings) {
    await memory.pushEpisode(`farscout learned (${new Date().toISOString().slice(0, 10)}): ${f}`, {
      source: 'farscout',
      topics: novel,
    });
  }

  return { findings, questions: questions.slice(0, 2) };
}
