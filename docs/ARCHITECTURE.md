# Architecture

How farscout is put together, why, and how data flows through it. Read this before changing the engine.

## One-paragraph summary

farscout is a single Node.js process. A timer (`lib/cadence.js`) fires a research cycle (`runCycle` in `lib/research.js`). Each cycle reads Farcaster (`lib/reader.js`), picks what's worth researching (`lib/triage.js`), grounds each topic in real sources (`lib/search.js` + `lib/enrich.js`), reasons over those sources with a free LLM (`lib/brain.js`), checks its own output (`lib/verify.js`), remembers what it learned (`lib/memory.js`), and delivers to the operator over Discord (`lib/discord.js`). `index.js` wires it all together and owns the loop, the Discord command surface, and on-disk state.

## Design principles

1. **Free first.** Every default path costs $0. Paid keys (Exa, OpenRouter credit) are optional accelerants, never required.
2. **Grounded, not generative.** A finding must cite a real source URL or it is dropped. The LLM synthesizes over fetched sources; it does not free-associate from training data. This is the single most important invariant - see `toFindingStrings` in `lib/research.js`.
3. **Dependency injection everywhere.** Every module that does I/O takes an injected `fetchImpl` (and `now` for memory). This makes everything unit-testable with `node:test` and no network, and makes modules reusable outside this bot.
4. **Factory functions, not classes.** `makeReader(...)`, `makeSearch(...)`, `makeMemory(...)`, `createEnrich(...)`, `makeBrain(...)`, `makeDiscord(...)`. They return a plain object of methods over a closure. No `this`, no inheritance.
5. **Fail soft.** A single bad fetch, a rate-limited model, a malformed LLM JSON response - none of these should crash a cycle. Helpers return `[]`/`null`/`fallback` and the cycle continues. The only thing that should hard-fail is missing required config at boot (`requireConfig`).
6. **Opt-in depth.** Expensive quality passes (perspectives, reflect, verify) default OFF in `researchTopic`'s signature (so unit tests are deterministic and cheap) but default ON in the live loop via env. See "Quality passes" below.

## Data flow (one cycle)

```
                         index.js: tick()
                               |
              lib/research.js: runCycle()
                               |
        +----------------------+-----------------------+
        |                                              |
  gatherSignal()                                 (standing topics)
  reader.userCasts / channelFeed /                     |
  trendingFeed / mentions / watchedFidsCasts           |
        |                                              |
        +----------------------+-----------------------+
                               |
                  brain.ask(tier:light)  -> topic slugs
                               |
                  triage.triage()  -> top N novel topics
                               |
                  for each topic: researchTopic()
                               |
        +----------------------+----------------------------+
        | [perspectives] anglesFor() -> 3 angle queries     |
        | gatherSources():                                  |
        |   search.searchCasts + search.webSearch           |
        |   search.fetchUrl (+ Jina reader, frame detect)   |
        |   enrich.marketFacts ($ticker -> Dexscreener)     |
        |                                                   |
        | synthesize():                                     |
        |   brain.ask(tier:light)  -> claims+cites          |
        |   brain.ask(tier:heavy)  -> findings              |
        | toFindingStrings()  -> cite-or-drop               |
        |                                                   |
        | [reflect] gapQuery() -> fetch more -> re-synth    |
        | [verify]  verifyFindings() -> drop/tag            |
        +----------------------+----------------------------+
                               |
                memory.remember + memory.recordMention
                memory.pushEpisode -> Bonfire
                               |
                index.js: formatResult() -> discord.deliver()
                               |
                cadence.nextInterval() -> persist state -> setTimeout
```

## The brain router (`lib/brain.js`)

Two tiers, two backends:

- **tier `light`** - cheap, fast calls (topic extraction, claim extraction, angle generation, gap query, verify). Goes to the model rotation.
- **tier `heavy`** - the synthesis call. Same rotation but conceptually the "thinking" step; lead the model list with your strongest free model.

Backend selection:
- If `ollamaUrl` is set and reachable, `heavy`/`private` tiers try Ollama first (local, unlimited, private).
- Otherwise (and as fallback) it rotates the OpenRouter `freeModels` list.

The OpenRouter rotation has one critical subtlety: **a rate-limited free model returns HTTP 200 with an `{error:{code:429}}` body**, not a non-2xx status. So `askCloud` inspects `d.error`, not just `res.ok`, and retries the whole rotation up to 3 rounds with short backoff. Without this, the first saturated model silently yields "no content" and the whole call returns null.

## Grounding (`lib/search.js`)

Source-gathering for a topic, in a fallback chain so it degrades free-first:

- **Cast search**: Warpcast `/v2/search-casts` (free, no auth, on-topic).
- **Web search**: Exa (if key) -> Jina `s.jina.ai` (free, no auth, returns content) -> DuckDuckGo HTML scrape (last resort).
- **Page fetch** (`fetchUrl`): direct fetch first (so we can sniff `fc:frame`/`fc:miniapp` meta from raw HTML), then if the stripped text is thin, Jina Reader `r.jina.ai` for clean article markdown.

Everything outbound goes through `fetchWithBackoff` (retry + timeout) and `fetchUrl` is gated by `isPublicHttpUrl` (SSRF guard) with `redirect: 'manual'` (no public->private redirect bypass). See `docs/SECURITY.md`.

## Memory (`lib/memory.js`)

Two layers:
- **Durable**: ZABAL Bonfire knowledge graph. Each finding becomes an episode (`pushEpisode`). Failed pushes go to a bounded retry queue, flushed next cycle.
- **Local**: a JSON cache (`state/cache.json`) holding dedup keys (`episodeHashes`) and a temporal topic index (`topics`).

Dedup is fuzzy (`isKnown`): exact -> canonical (`mini-apps` == `miniapp`) -> token-overlap Jaccard >= 0.8. Temporal tracking (`recordMention`/`storylines`) counts how often a topic recurs over a 30-day window, powering the weekly storyline digest and a **recency decay** - a topic last seen beyond the window becomes "novel again" so the scout re-checks evolving stories.

A `SECRET_RE` guard refuses to push key-shaped text to the graph.

## State + persistence

All on-disk state lives in `state/` (gitignored):
- `state/cadence.json` - interval, briefCursor, digestLog, lastDigestAt, plus the whole runtime state object.
- `state/cache.json` - memory dedup keys + temporal topic index + retry queue.

`saveCadence` and `memory.persist` both `mkdir -p` the dir first (a fresh clone has no `state/`).

## The Discord surface (`lib/discord.js`)

`makeDiscord` returns `{ start, deliver, consumeEngagement, recentReplies, clearReplies }`. It handles:
- **Slash commands** - registered on ready (per-guild instant + global for DM). `interactionCreate` defers within 3s, then edits/follows-up within 15min; long runs (60-130s) fit, and if the interaction token expires it falls back to a DM.
- **Text fallback** - `messageCreate` still parses `/cmd arg` in DM during the transition.
- **Engagement** - any non-command message from the operator sets `engaged`, which tightens cadence.

`onCommand(name, arg, say)` is the bridge to `index.js`; `say` routes a reply to the active slash interaction or to DM.

## Why a single process (not microservices)

It's a personal-scale scout: one operator, a handful of cycles a day, ~38MB RAM. A single Node process on a shared VPS is the right size. The modularity is for *code reuse* (other ZABAL tools importing `lib/*`), not for horizontal scale. If it ever needs scale, the read/ground/reason/remember split is already clean enough to pull apart.

## See also

- `docs/API.md` - every module's exported functions.
- `docs/DATA-SOURCES.md` - the external APIs and their quirks.
- `docs/SECURITY.md` - the SSRF guard, prompt-injection posture, secret handling.
- `docs/EXTENDING.md` - how to build a new feature on top.
