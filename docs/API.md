# API reference

Module-by-module reference for everything exported under `lib/`. Every I/O module takes an injected `fetchImpl` so it is testable without network. Signatures are descriptive, not TypeScript.

---

## lib/reader.js

`makeReader({ base, fid, fetchImpl, neynarKey?, hubUrl? }) -> reader`

Farcaster reads via the free Warpcast API. `base` is usually `https://api.warpcast.com`.

| Method | Returns | Notes |
|--------|---------|-------|
| `userCasts(limit=25)` | `[cast]` | The operator's casts (`/v2/casts?fid=`). Falls back to `hubCastsByFid` if Warpcast returns nothing and `hubUrl` is set. |
| `channelFeed(channels, limit=25)` | `[cast]` (tagged `.channel`) | Per-channel via Neynar (`/v2/farcaster/feed/channels`). No-op without `neynarKey` - Warpcast has no free channel feed. Fans out concurrently. |
| `watchedFidsCasts(fids, limit=10)` | `[cast]` | Casts from specific FIDs. Batched (5 concurrent) to avoid Warpcast rate-limiting a wide burst. |
| `followingFids(max=150)` | `[fid]` | The operator's follow graph, paginated (page size 50 - 100 returns 400). One manual retry per page for transient 400s. |
| `trendingFeed()` / `mentions()` | `[]` | No-ops - need an authed Warpcast token. Kept as explicit stubs so the cycle code can call them unconditionally. |

Helpers (also exported):
- `normalizeCast(raw) -> { text, author, hash, timestamp, embeds:[url], reactions:{likes,recasts} }` - Warpcast `reactions.count` = likes, `recasts.count` = recasts, `embeds` is an object (`{urls,images}`) not an array.
- `normalizeHubCast(msg)` - same shape from a Farcaster hub protobuf-JSON message.
- `castWeight(cast) -> number` - `likes + 2*recasts`, used for engagement ranking.

---

## lib/search.js

`makeSearch({ base, fetchImpl, neynarKey?, exaKey? }) -> search`

| Method | Returns | Notes |
|--------|---------|-------|
| `searchCasts(query, limit=10)` | `[{title,url,snippet,source}]` | Warpcast `/v2/search-casts`. |
| `webSearch(query, limit=5)` | `[{title,url,snippet,source}]` | Exa (if `exaKey`) -> Jina `s.jina.ai` -> DuckDuckGo HTML, first non-empty wins. |
| `fetchUrl(url)` | `{url,status,text,frame}` | `status` is `FULL`/`FAILED`/`BLOCKED`. Direct fetch then Jina Reader if thin. SSRF-guarded, no redirect follow. `frame` is the detected Frame/Mini-App meta or null. |

Helper (exported): `detectFrame(html) -> {isMiniApp,image,title} | null` - sniffs `fc:frame`/`fc:miniapp` meta tags.

---

## lib/enrich.js

`createEnrich({ fetchImpl }) -> enrich`

Crypto enrichment via Dexscreener (free, no key).

| Method | Returns | Notes |
|--------|---------|-------|
| `marketFacts(text, max=3)` | `[string]` | Extracts `$TICKER`s from text, returns one grounded market line each (price, 24h change, liquidity, vol, FDV) with a Dexscreener URL. Never throws. |
| `tickerLine(ticker)` | `string | null` | One market line for one ticker. |
| `dexToken(ticker)` | `{...} | null` | Raw best-pair data. |

Helper (exported): `extractTickers(text, max=3) -> [string]` - pulls cashtags, dedups, skips noise (`the`, `usd`, `gm`...).

---

## lib/triage.js

Novelty triage - score candidate topics so the cycle spends its budget on what matters.

- `scoreTopic(topic, { corpusLines, memory, standing }) -> { topic, score, reason }` - scores by corpus traction (mention count), novelty vs memory, standing-topic bonus, token-signal bonus.
- `triage(candidates, { corpusLines, memory, standingSet, max=3, minScore=1 }) -> [{topic,score,reason}]` - ranks, drops below `minScore`, dedups near-duplicates, returns top `max`.

---

## lib/research.js

The engine.

- `researchTopic({ brain, search, topic, seedUrls?, replyContext?, enrich?, perspectives?, reflect?, verify? }) -> { findings:[string], questions:[string], frames:[{url,title,isMiniApp}] }`
  - Each finding string ends with its source URL in parens (cite-or-drop).
  - `perspectives`/`reflect`/`verify` default `false` (test-deterministic).
- `runCycle({ reader, brain, memory, search, enrich?, channels, watchFids, standingTopics, recentReplies, perspectives?, reflect?, verify? }) -> { findings, questions, frames }`
  - The full per-tick pipeline. Calls `researchTopic` per triaged topic, remembers, pushes episodes.

---

## lib/brief.js

`buildBrief({ reader, brain, follows, cursor=0, max=10 }) -> { text, items, themes, nextCursor, sampled, reason? }`

The flagship. Rotates a window of `follows` (starting at `cursor`), reads their recent casts, ranks by engagement, synthesizes the `max` most notable items + theme tags. `reason` is set (and `text` empty) when there's nothing to report. Persist `nextCursor` to spread coverage across runs.

---

## lib/brain.js

`makeBrain({ openrouterKey, freeModels, ollamaUrl?, ollamaModel?, fetchImpl }) -> brain`

- `ask(prompt, { tier='light' }) -> string | null`
  - `tier` `heavy`/`private` try Ollama first when `ollamaUrl` is reachable; otherwise OpenRouter free-model rotation (3 rounds, body-429 aware). Returns null only if every path fails.

---

## lib/memory.js

`makeMemory({ file, bonfireKey?, bonfireId?, bonfireBase?, fetchImpl, now? }) -> memory`

| Method | Notes |
|--------|-------|
| `load()` | Read `state/cache.json`, hydrate dedup set + topic index. Caps `episodeHashes` to 5000. |
| `isKnown(key)` | Fuzzy: exact / canonical / token-overlap >= 0.8. Recency decay - a topic last seen > 30d ago returns false (novel again). |
| `remember(key)` | Add to dedup set (LRU evict at 5000). |
| `recordMention(key, ts?)` | Temporal: bump count + last-seen for storyline tracking. |
| `mentionInfo(key)` | `{label,count,first,last} | null`. |
| `storylines(now?)` | Topics mentioned >= 3x within 30d, most-recurring first. |
| `pushEpisode(text, meta?)` | Post to Bonfire; secret-guarded; queues on failure. |
| `flushQueue()` | Retry queued episodes. |
| `queueSize()` | Pending retry count. |

Helper (exported): `canonicalize(topic)` - lowercase, strip separators, drop trailing `s`.

---

## lib/verify.js

`verifyFindings({ brain, findings, sourceBlock }) -> [string]`

Self-eval. Labels each finding entailed/contradicted/unsupported against the sources; drops contradicted, tags unsupported `[unverified]`, leaves entailed clean. Fail-open: on a brain error or empty verdicts it returns findings unchanged. A real all-contradicted verdict does drop everything (sources disagreed).

---

## lib/http.js

- `fetchWithBackoff(fetchImpl, url, opts={}, { retries=3, baseDelay=400, timeoutMs=12000 }) -> Response` - retries 429/5xx with backoff + jitter; per-attempt `AbortSignal.timeout`; rethrows network errors after retries.
- `isPublicHttpUrl(raw) -> boolean` - SSRF allowlist: blocks loopback, link-local, RFC1918, CGNAT, cloud-metadata, multicast; handles decimal/octal/hex IPv4, IPv4-mapped IPv6, trailing-dot FQDN, userinfo.
- `htmlToText(html, maxLen=4000) -> string` - strip tags/scripts/entities to rough text.

---

## lib/util.js

- `parseJson(text, fallback)` - tolerant LLM-JSON parse: strips ```` ``` ```` fences, brace-matches the first balanced object (ignores trailing reasoning small models append).
- `toLines(arr)` - coerce list items (objects/nested) to clean strings.
- `toSlugs(arr)` - lowercase-hyphenated topic slugs, drop junk.
- `canonicalize(topic)` / `tokenOverlap(a,b)` - dedup primitives (also used by memory).

---

## lib/cadence.js

- `nextInterval(current, engaged) -> ms` - halve on engagement, double on silence, clamped 30min-24h.
- Constants: `FLOOR_MS`, `CEIL_MS`, `START_MS`.

---

## lib/discord.js

`makeDiscord({ token, userId, onCommand }) -> discord`

`onCommand(name, arg, say)` is your handler; `say(text)` routes to the slash interaction or DM. Also exports the `COMMANDS` catalog (drives both slash registration and text fallback).

| Method | Notes |
|--------|-------|
| `start()` | Login, await ready, register slash commands. |
| `deliver(text)` | Proactive DM (autonomous output, boot msg, digest). Chunks at 1900 chars. |
| `consumeEngagement()` | Read+reset the engaged flag. |
| `recentReplies()` / `clearReplies()` | Operator's recent non-command messages (fed to research as context). |
