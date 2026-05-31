# Changelog

Notable changes to farscout. Dates are when the work landed on `main`. Newest first.

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
