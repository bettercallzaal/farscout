# Changelog

Notable changes to farscout. Dates are when the work landed on `main`. Newest first.

## 2026-06-06

- **X / Twitter source.** New `lib/x.js`. Scraping a GIVEN post is free + reliable via X's public syndication CDN (`tweet-result`, the no-auth endpoint react-tweet uses) - `fetchXPost`/`normalizeTweet` map a tweet into the cast shape (favorite_count->likes, retweet_count->recasts). New `/x <url|id>` command scrapes a post and researches it. `lib/search.js` `fetchUrl` is now X-aware: any `x.com/status` link (in casts, Reddit posts, or web results) is hydrated via the CDN instead of hitting a login wall. Search/timeline go through Nitter (`searchX`/`timeline`) and are OFF by default - no free X search API exists and 2026 public instances are mostly dead - wired behind `NITTER_BASE` like `HUB_URL`. Themes gained X handles; config: `X_ENABLED`, `WATCH_X_HANDLES`, `NITTER_BASE`, `X_USER_AGENT`. 16 new tests.
- **Themes (multi-domain coverage).** New `lib/themes.js` with named theme presets that bundle Farcaster channels + subreddits + standing topics per domain. `THEMES` env (default `farcaster,gamestop`) selects which to run; `resolveThemes` merges them into one deduped watch set, and explicit `WATCH_*`/`STANDING_TOPICS` merge on top. Ships `farcaster` and `gamestop` presets (Superstonk/GME/gamestop subs + GME standing topics). New `/themes` Discord command shows the live set. 6 new tests.
- **Reddit source (read surface + grounding).** New `lib/reddit.js` reads the free, no-auth Reddit JSON API: `subredditFeed` (watched subreddits, parallel to Farcaster channels) and `userPosts` (watched redditors). Posts are normalized into the cast shape (score->likes, comments->recasts) so they feed the same engagement-ranked topic loop with no special-casing. `lib/search.js` gains `searchReddit`, making Reddit threads citable grounding sources. Config: `WATCH_SUBREDDITS`, `WATCH_REDDITORS`, `REDDIT_ENABLED` (default on), `REDDIT_USER_AGENT`, `REDDIT_API_BASE`. Farcaster is untouched - Reddit is purely additive. 12 new tests (93 total). Reddit needs a descriptive User-Agent or it 429s; NSFW dropped by default.

## 2026-05-31

- **Documentation set.** Added `docs/` (ARCHITECTURE, API, OPERATIONS, CONFIGURATION, DATA-SOURCES, SECURITY, EXTENDING, TESTING, TROUBLESHOOTING, GLOSSARY) + `CONTRIBUTING.md` + this changelog. README rewritten as the full pick-up-later / build-on-top guide.
- **Real Discord slash commands.** `/brief /ask /dig /now /digest /pause /resume` registered natively (per-guild instant + global for DM). 3s-defer then editReply/followUp with DM fallback for long runs. Text `/cmd` fallback retained. Operator-only.
- **`/brief` flagship.** Curated digest of what the accounts you follow are talking about, weighted to your follow graph, rotated for coverage across days. `/ask` grounded Q&A added.
- **Follow-graph reader.** `reader.followingFids` paginates the free Warpcast follow graph (page size 50). Likes aren't free-readable, so follows are the taste signal.
- **Fixes:** `state/` dir auto-created before writes (was crashing on fresh clone); `followingFids` page size 100->50 (100 returned 400); `watchedFidsCasts` batched to avoid rate-limit-to-zero on wide bursts.

## 2026-05-30

- **Roadmap features (doc 774).** Reflection/gap pass, self-eval/verify pass, perspective decomposition, temporal memory + storyline tracking + recency decay, weekly storyline digest, hub-read fallback (off by default - public hubs unreachable). All free, opt-in in code, default-on in the live loop.
- **Sharper synthesis (free).** Two-pass extract-then-synthesize, insight-demanding prompt, wider sourcing, model list led by the largest verified-live free models. Hardened `parseJson` (brace-matching, fence-stripping) for small models that ramble after the JSON.
- **Crypto enrichment.** `lib/enrich.js` injects live Dexscreener token data ($price/liq/vol/FDV) as citable sources.
- **Jina grounding.** Web search + page reading via Jina (`s.jina.ai`/`r.jina.ai`), replacing fragile DuckDuckGo scraping.
- **Novelty triage.** `lib/triage.js` scores topics by traction + novelty before researching.
- **OpenRouter hardening.** Detect HTTP-200-with-`{error:429}` body; rotate + retry the free-model pool. Refreshed live model list.
- **Deployed to VPS.** systemd `--user` service on `187.77.3.104`, 24/7, linger + auto-restart. Verified live end-to-end.

## 2026-05-29

- **v1 built.** Warpcast read layer (migrated off the dead HAATZ host), grounding stack, two-pass research engine, Bonfire memory with fuzzy dedup, adaptive Discord cadence, security hardening (SSRF guard with encoded-IP + redirect coverage, per-fetch timeout, secret guard).
- **Initial scaffold.** HAATZ reader, hybrid brain (OpenRouter + Ollama), Bonfire memory, adaptive Discord loop, design spec + implementation plan.
