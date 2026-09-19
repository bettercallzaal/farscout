# farscout

A free, mostly-autonomous Farcaster research scout for the ZAO ecosystem. Built to be a **foundation other ZABAL / ZAO tools build on top of** - the research engine, the grounding stack, the memory layer, and the Discord surface are all modular and reusable.

It reads Farcaster (your casts, your follow graph, watched builders via the free no-auth Warpcast API; channels too with a free Neynar key), grounds every topic in real sources (Farcaster cast search + web search + live token data) before reasoning with OpenRouter free-tier models (or a local Ollama when reachable), remembers what it learns in the ZABAL Bonfire knowledge graph, and talks with you in Discord via real slash commands on an engagement-scaled cadence.

Findings are grounded in real sources, never the model's stale memory - a finding that cannot cite a source URL is dropped. It has a standing watch on Farcaster Mini Apps, Frames, and Snaps.

- **Repo:** github.com/bettercallzaal/farscout
- **Live:** systemd service `farscout.service` on the ZAO cowork VPS `31.97.148.88` (`/home/zaal/migrated-cowork/farscout`), 24/7, auto-restart, survives reboots.
- **Status (2026-05-31):** 29 commits, 11 lib modules, ~1500 LOC, 81 unit tests passing (run on the VPS - see Gotchas), 3 runtime deps.

---

## Quick start

```bash
cp .env.example .env   # then fill it in (see Env keys)
npm install
npm test               # 81 unit tests (needs Node 22 - see Gotchas)
npm run bootstrap      # one-time: seed Bonfire with baseline FC knowledge
npm start              # run the live loop
```

Minimum to run: `DISCORD_TOKEN`, `DISCORD_USER_ID`, `FARCASTER_FID`, and EITHER `OPENROUTER_API_KEY` (+ `FREE_MODEL_IDS`) OR `OLLAMA_TUNNEL_URL`. Bonfire keys optional (memory degrades to local-only).

---

## How it works

```
tick -> read Farcaster (own casts + channels + watched FIDs)
        + read Reddit (watched subreddits + watched redditors)
        + read X (watched handles, if a Nitter instance is configured)
     -> rank by engagement -> extract topics (light model) + standing topics
     -> NOVELTY TRIAGE (traction + novelty + token-signal; dedup; top 3)
     -> per topic: GROUND (cast search + Reddit search + X search + web search + URL/Jina-reader fetch
                           + $ticker market data + Frame/Mini-App detect)
     -> [perspectives] decompose into market/tech/social angles
     -> TWO-PASS SYNTHESIS (extract claims [light] -> synthesize insights [heavy])
     -> [reflect] name the biggest gap, fetch more, re-synthesize once
     -> cite-or-drop (a finding with no real source index is discarded)
     -> [verify] fact-check vs sources; drop contradicted, tag weak [unverified]
     -> deliver to Discord -> push learnings to Bonfire -> set cadence -> persist
```

`[bracketed]` stages are free quality passes, toggled by env (`PERSPECTIVES`/`REFLECT`/`VERIFY`, default ON).

### Module map (this is the build-on-top surface)

| File | Role | Reuse it for |
|------|------|--------------|
| `index.js` | Orchestrator: boot, Discord command surface, tick loop, digest, cadence persistence | the wiring example |
| `config.js` | Env config + `requireConfig` (Ollama-OR-OpenRouter validation) | add new env knobs here |
| `lib/reader.js` | Warpcast reads (`/v2/casts`, `/v1/channel-casts` via Neynar, `followingFids` graph, watched FIDs), `normalizeCast`, `castWeight`, hub fallback | any Farcaster read |
| `lib/reddit.js` | Reddit reads on the free no-auth JSON API: `subredditFeed`, `userPosts`, `normalizePost` into the cast shape (score->likes, comments->recasts) | any Reddit read |
| `lib/x.js` | X / Twitter: `fetchXPost` (single post via the free syndication CDN, no auth), `makeX` timeline/search via optional Nitter, `normalizeTweet` into the cast shape | scraping a given X post |
| `lib/search.js` | Grounding: cast search, Reddit search, X search, web search (Exa -> Jina -> DuckDuckGo chain), `fetchUrl` (+ Jina Reader, + X syndication hydration), `detectFrame` | any grounded lookup |
| `lib/enrich.js` | Crypto enrichment: `extractTickers`, Dexscreener `marketFacts` (price/liq/vol/FDV) | any token-aware feature |
| `lib/triage.js` | Novelty triage: `scoreTopic`, `triage` (traction + novelty + dedup) | ranking what to work on |
| `lib/research.js` | `gatherSignal`, `gatherSources`, `researchTopic` (two-pass + reflect + verify + perspectives), `runCycle` | the research engine |
| `lib/brief.js` | `buildBrief` - curated digest from your follow graph, rotated for coverage | the flagship pattern |
| `lib/brain.js` | Model router: Ollama (if tunnel) else OpenRouter free-model rotation + body-429 handling + retry | any LLM call |
| `lib/memory.js` | Bonfire episode push + fuzzy `isKnown` dedup + temporal `storylines` + bounded retry queue + secret guard | persistent agent memory |
| `lib/verify.js` | Self-eval: label findings entailed/contradicted/unsupported, drop/tag | groundedness checks |
| `lib/http.js` | `fetchWithBackoff` (429/5xx + timeout), `isPublicHttpUrl` SSRF guard, `htmlToText` | any outbound fetch |
| `lib/util.js` | `parseJson` (brace-matching, fence-stripping), `toLines`, `toSlugs`, `canonicalize`, `tokenOverlap` | robust LLM-JSON parsing |
| `lib/cadence.js` | Adaptive interval (30 min floor, 24 h ceiling, 6 h start) | engagement-scaled timing |
| `lib/themes.js` | Named theme bundles (channels + subreddits + standing topics); `resolveThemes` merges several into one watch set | covering multiple domains at once |

Every module takes an injected `fetchImpl` (dependency injection) so it's unit-testable with `node:test` and reusable outside this bot.

### Themes (multi-domain coverage)

A **theme** is a named bundle of read surfaces + standing topics for one domain. `THEMES` (default `farcaster,gamestop`) selects which to run; `resolveThemes` in `lib/themes.js` merges them into one deduped watch set, and explicit `WATCH_*`/`STANDING_TOPICS` env values merge on top.

| Theme | Farcaster channels | Subreddits | X handles | Standing topics |
|-------|--------------------|-----------|-----------|-----------------|
| `farcaster` | zao, dev, miniapps | farcaster | farcaster_xyz, dwr | farcaster-mini-apps, farcaster-frames-v2, farcaster-snaps |
| `gamestop` | (none) | Superstonk, GME, gamestop | GameStop, gstopcorp | gamestop-stock, gamestop-crypto-wallet, gamestop-nft-marketplace |

(X handles only feed the loop if `NITTER_BASE` is set; the `/x` command and X-link hydration work regardless.)

Add a theme by dropping a preset into `THEME_PRESETS`. `/themes` shows the live set.

---

## Discord commands (real slash commands)

Registered as native Discord slash commands (show in the `/` picker with descriptions + argument fields). Plain-text `/cmd` in DM still works as a fallback.

| Command | What |
|---------|------|
| `/brief` | Curated digest of what the accounts **you follow** are talking about (the flagship) |
| `/ask <question>` | Grounded answer with sources via the full research pipeline |
| `/dig <topic>` | Deep on-demand research on any topic |
| `/x <url\|id>` | Scrape a given X / Twitter post (free, no auth) and research it grounded on the post |
| `/now` | Run a research cycle immediately |
| `/themes` | Show the active themes and the channels/subreddits/topics they watch |
| `/digest` | Send the weekly storyline digest now |
| `/pause` / `/resume` | Stop / resume the autonomous cycle |

Any normal (non-slash) message counts as engagement and tightens the cadence. Findings arrive with clickable source links; the weekly digest leads with recurring "storylines" (topics that recurred across the window) before raw findings.

---

## The all-free tool stack

| Layer | Tool | Free? | Auth | Endpoint example |
|-------|------|-------|------|------------------|
| Farcaster read | Warpcast API | yes | no | `GET https://api.warpcast.com/v2/casts?fid=19640&limit=25` |
| Cast search | Warpcast | yes | no | `GET /v2/search-casts?q=clanker&limit=8` |
| Follow graph | Warpcast | yes | no | `GET /v2/following?fid=19640&limit=50` (cap 50/page) |
| Channels (optional) | Neynar v2 | free key | yes | `GET https://api.neynar.com/v2/farcaster/feed/channels?channel_ids=zao` |
| Reddit read | Reddit JSON | yes | no | `GET https://www.reddit.com/r/ethereum/hot.json?limit=25` |
| Reddit search | Reddit JSON | yes | no | `GET https://www.reddit.com/search.json?q=farcaster&limit=8` |
| X post scrape | X syndication CDN | yes | no | `GET https://cdn.syndication.twimg.com/tweet-result?id=<id>&token=<t>` |
| X search/timeline | Nitter | yes* | no | `GET <nitter>/search/rss?q=gme` (needs a live instance; off by default) |
| Web search | Jina `s.jina.ai` | 10M tokens | no | `GET https://s.jina.ai/?q=farcaster+mini+apps` |
| Page read | Jina `r.jina.ai` | shared | no | `GET https://r.jina.ai/https://docs.farcaster.xyz/` |
| Crypto data | Dexscreener | yes | no | `GET https://api.dexscreener.com/latest/dex/search?q=clanker` |
| Reasoning | OpenRouter `:free` | yes* | yes | model `openai/gpt-oss-120b:free` |
| Memory | ZABAL Bonfire | ZAO key | yes | `POST https://tnt-v2.api.bonfires.ai/knowledge_graph/episode/create` |
| Delivery | Discord (discord.js) | yes | bot token | slash + DM |

\* OpenRouter free models are a shared, rate-limited pool. A one-time ~$10 credit lifts `:free` limits and kills most 429s; findings still cost ~$0.

\* X search/timeline needs a live Nitter instance (`NITTER_BASE`) - there is no free X search API and 2026 public instances are mostly dead, so it ships OFF. Scraping a *given* post (the `/x` command, and auto-hydrating any `x.com/status` link that turns up in casts/Reddit/web results) uses the no-auth syndication CDN and always works.

---

## Env keys

| Key | Notes |
|-----|-------|
| `DISCORD_TOKEN` | Developer Portal -> your app -> Bot -> Reset Token. Enable Message Content intent (for text fallback). |
| `DISCORD_USER_ID` | Your Discord user id (Developer Mode -> right-click name -> Copy User ID). DM the bot once so it can DM you back. |
| `THEMES` | Comma-list of domains to cover. Default `farcaster,gamestop`. Each theme bundles channels + subreddits + standing topics (see `lib/themes.js`). Known: `farcaster`, `gamestop`. Pick a subset or list your own; `WATCH_*`/`STANDING_TOPICS` below merge on top. |
| `FARCASTER_FID` | Your Farcaster FID (number; on your Warpcast profile). Seeds the whole loop + `/brief`. |
| `OPENROUTER_API_KEY` | openrouter.ai -> Keys. Add ~$10 credit to lift free-model rate limits. |
| `FREE_MODEL_IDS` | Comma-list of OpenRouter `:free` ids to rotate. Live-good set: `openai/gpt-oss-120b:free,z-ai/glm-4.5-air:free,moonshotai/kimi-k2.6:free,nvidia/nemotron-3-super-120b-a12b:free,openai/gpt-oss-20b:free,meta-llama/llama-3.3-70b-instruct:free` |
| `OLLAMA_TUNNEL_URL` | Optional. Public URL of a local Ollama (cloudflared/ngrok to `:11434`). Set this OR OpenRouter. On the VPS leave blank (no Ollama there). |
| `WATCH_CHANNELS` | Comma-list of channel ids, e.g. `zao,dev,miniapps`. Merges with the active themes' channels. |
| `WATCH_FIDS` | Optional. Comma-list of builder FIDs to track. |
| `STANDING_TOPICS` | Always-researched topics, merged with the active themes' standing topics. Themes already cover the defaults. |
| `NEYNAR_API_KEY` | Optional free tier. Enables `WATCH_CHANNELS` (Warpcast has no free channel feed). Without it, channels are skipped. |
| `WATCH_SUBREDDITS` | Comma-list of subreddits to read each cycle, e.g. `ethereum,CryptoCurrency,farcaster`. Free, no auth. Empty = no Reddit read surface. |
| `WATCH_REDDITORS` | Optional. Comma-list of Reddit usernames to track (their recent submissions). |
| `REDDIT_ENABLED` | Reddit on by default. Set to `0` to disable Reddit reads AND Reddit grounding entirely. |
| `REDDIT_USER_AGENT` | Reddit throttles generic User-Agents (HTTP 429); a descriptive default is set. Override if you like. |
| `REDDIT_API_BASE` | Override the Reddit base (default `https://www.reddit.com`). |
| `X_ENABLED` | X on by default. Scraping a given post (`/x`, link hydration) is free + reliable. Set `0` to disable X entirely. |
| `WATCH_X_HANDLES` | Comma-list of X handles to read each cycle. Only active with `NITTER_BASE` set; merges with the active themes' handles. |
| `NITTER_BASE` | Point at a working Nitter instance to enable X search + timeline reads. Off by default (no free X search API; 2026 public instances mostly dead). |
| `X_USER_AGENT` | UA for X/Nitter requests; a descriptive default is set. |
| `EXA_API_KEY` | Optional. Better web grounding; blank = Jina then DuckDuckGo. |
| `BONFIRE_API_KEY`, `BONFIRE_ID` | From `~/.zao/zao.env`. Memory layer; degrades to local-only if absent. |
| `HUB_URL` | Optional public Farcaster hub HTTP base for a free user-cast fallback. OFF by default - the 2026 public hubs tested (NodeRPC, Pinata) were unreachable. |
| `BRIEF_SAMPLE_MAX` | Follows to load + rotate for `/brief` (default 150). |
| `PERSPECTIVES` / `REFLECT` / `VERIFY` | Quality passes, default ON. Set to `0` to disable any. |
| `DIGEST_INTERVAL_MS` | Weekly digest cadence (default 7 days). |

---

## Deploy (current production = ZAO cowork VPS)

Live on `31.97.148.88` as a systemd `--user` service. Ops:

```bash
ssh zaal@31.97.148.88                         # key: ~/.ssh/id_ed25519
systemctl --user status farscout.service       # state
journalctl --user -u farscout.service -f       # logs
# deploy a pushed change:
cd /home/zaal/migrated-cowork/farscout && git pull && systemctl --user restart farscout.service
```

`loginctl enable-linger root` is set so it survives reboots; `Restart=on-failure` auto-recovers crashes. Reasoning is OpenRouter (cloud) - no Ollama on the box.

Alternative free host (bot-hosting.net): runtime Node.js, startup file `index.js`, set env in the panel, `npm install` + `npm run bootstrap` once, claim daily coins. Fits the 256MB tier (no local LLM).

---

## STATUS - what's built (2026-05-31)

Everything below is live on the VPS and covered by tests.

**Core engine**
- Warpcast read layer (own casts, channels via Neynar, follow graph, watched FIDs) + engagement ranking + embed/reaction extraction
- Grounding stack: cast search + web search (Exa -> Jina -> DuckDuckGo fallback chain) + Jina Reader page fetch + Frame/Mini-App detection
- Two-pass synthesis (extract claims -> synthesize insights), cite-or-drop grounding contract
- Reflection/gap pass, self-eval/verify pass, perspective decomposition (all free, toggleable)
- Novelty triage (traction + novelty + token signal), fuzzy dedup, temporal memory + storyline tracking + recency decay
- Crypto enrichment (Dexscreener live token data injected as citable sources)
- Model router with OpenRouter free-pool rotation + HTTP-200-with-error-body (429) handling + retry; Ollama path for local
- Bonfire knowledge-graph memory (verified live writes) + bounded retry queue + secret guard
- Robust LLM-JSON parsing (brace-matching, fence-stripping) - small models ramble after the JSON
- Security: SSRF guard (blocks loopback/RFC1918/cloud-metadata/encoded-IP/redirect bypass), per-fetch timeout, bounded state

**Surfaces**
- Discord: real slash commands (`/brief /ask /dig /now /digest /pause /resume`) + text fallback; operator-only; 3s-defer then editReply/followUp with DM fallback for long (60-130s) runs
- `/brief` flagship: curated digest weighted to your follow graph, rotated for coverage over days
- Weekly storyline digest; adaptive engagement cadence

**Infra**
- Live 24/7 on VPS via systemd; 81 tests; 8+ merged PRs; research doc 774 in ZAO library (`research/farcaster/774-...`)

---

## TODO - what to build next (the build-on-top roadmap)

Ranked by leverage. All free unless noted.

1. **Watch + alert** - `/watch <token|person|topic>` -> farscout pings you ONLY when something notable changes (price move, that account ships, topic spikes). Turns it from a scheduled digest into a real scout. Needs: a watchlist in state, a per-tick diff against last-seen, an alert threshold. Highest-value next feature.
2. **Action bridge** - turn a finding into action: draft a cast reply, spin a `/zao-research` deep doc, generate a `/socials` post, or share to a ZAO channel. Connects insight to real workflow. Needs: a `/act <finding#>` command + per-target formatters.
3. **DM slash propagation** - server slash commands work; DM needs **User Install** enabled in the Developer Portal (Installation -> User Install -> add `applications.commands` scope -> open install link) and up to 1h global propagation. Code is done; this is a portal toggle.
4. **Speed/depth tuning** - full pipeline (perspectives x reflect x verify) is ~90-130s. Make `/dig`/`/ask` fast (shallow) while the autonomous loop runs deep; or parallelize the angle passes. Polish.
5. **Curated post -> publish** - the `/brief` output is post-ready; add a one-tap path to push it as a cast / `/socials` post (extension of the action bridge).
6. **NodeRPC / hub reads** - if a live public Farcaster hub appears, `HUB_URL` lights up free channel/trending reads with no Neynar key (reader.js already has the fallback wired).
7. **Likes-based taste** - Warpcast likes need auth (not free-readable). If a Neynar/auth path is added, weight `/brief` by likes too, not just follows.

---

## HANDOFF NOTES (pick-up context, read before resuming)

**Mental model:** farscout is a working, deployed, free research scout. The last work session converted text commands to real Discord slash commands and shipped the `/brief` flagship (curated digest from your follow graph). It runs live on the VPS. The next natural build is **watch+alert** (TODO #1).

**Decisions + why (don't re-litigate):**
- **Warpcast public API, not HAATZ** - `haatz.quilibrium.com` resolves but 404s on channels/search. Warpcast `/v2/*` is free + complete for reads. Likes need auth (not free); follows are the taste signal instead.
- **No free following-feed exists** - `/brief` rotates a sample of the follow graph each run (cursor in `state.briefCursor`) so coverage builds over days. `/v2/following` caps page size at 50 (100 -> 400).
- **OpenRouter needs ~$10 credit** - free models are a shared pool; without credit ~1/6 respond, with it they're reliable. A rate-limited model returns HTTP 200 with an `{error:{code:429}}` body, so brain.js inspects the body, not just `res.ok`.
- **Two-pass + biggest free model (gpt-oss-120b)** is the quality lever that turned "restates the cast" into real synthesis.
- **Quality passes are opt-in in code, default-ON in the live loop** via env - keeps unit tests deterministic while the deployed bot runs deep.
- **Hub fallback shipped OFF** - NodeRPC/Pinata/hoyt all unreachable in 2026; wired but gated behind `HUB_URL` rather than faking a working integration.

**Gotchas / friction (so you don't re-discover them):**
- **Run tests on the VPS (Node 22), not a Node 23 mac.** discord.js's bundled undici throws `util.deepClone is not a function` / `GatewayIntentBits not found` on Node 23, which breaks any test that imports a discord-touching module. `ssh zaal@31.97.148.88 'cd /home/zaal/migrated-cowork/farscout && node --test'` is the source of truth.
- **`saveCadence`/`memory.persist` mkdir the `state/` dir** - a fresh clone has no `state/`; without the mkdir the process crashed on first write (fixed, but if you add a new state file, keep the pattern).
- **One bot instance per token** - running farscout locally + on the VPS with the same `DISCORD_TOKEN` makes them fight over the Discord gateway. Pick one.
- **Slash commands**: per-guild register is instant; global (DM/user-install) takes ~1h to propagate and needs User Install enabled.

**Git state:** branch `main`, HEAD `d095392`, pushed, clean. VPS is on the same HEAD, `active`, 0 restarts.

**Live verify after any change:**
```bash
ssh zaal@31.97.148.88 'cd /home/zaal/migrated-cowork/farscout && git pull && node --test && systemctl --user restart farscout.service && sleep 6 && systemctl --user is-active farscout.service'
```

---

## Docs

- Research doc: ZAO library `research/farcaster/774-farscout-autonomous-research-scout/`
- Design spec: `docs/superpowers/specs/2026-05-29-farscout-design.md`
- Implementation plan: `docs/superpowers/plans/2026-05-29-farscout.md`
