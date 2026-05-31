# Glossary

Terms used across farscout's code and docs.

**Brief** - the flagship `/brief` output: a curated digest of what the accounts you follow are talking about, weighted to your follow graph. Built by `lib/brief.js`.

**Brain** - the LLM router (`lib/brain.js`). `brain.ask(prompt, {tier})` abstracts over OpenRouter free models and a local Ollama.

**Cadence** - the adaptive interval between autonomous cycles (`lib/cadence.js`). Tightens when you engage, relaxes (toward 24h) when you go quiet.

**Cite-or-drop** - the grounding invariant: a finding that can't be mapped to a real source URL is discarded. The core anti-hallucination rule.

**Cycle / tick** - one autonomous research pass (`runCycle`). Read -> triage -> ground -> synthesize -> verify -> remember -> deliver.

**Enrichment** - adding live token market data (Dexscreener) to ground `$TICKER` mentions with real numbers. `lib/enrich.js`.

**Engagement** - any non-command message you send the bot. Sets a flag that tightens cadence (you replied -> come back sooner).

**FID** - Farcaster ID, the numeric account identifier. `FARCASTER_FID` is yours.

**Finding** - one grounded insight string, ending in its source URL. The unit of output.

**Frame / Mini App** - Farcaster's in-feed interactive embeds (`fc:frame`/`fc:miniapp` meta tags). `detectFrame` spots them.

**Grounding** - gathering real sources (casts, web pages, market data) for a topic *before* the LLM writes, so output is anchored in reality. `lib/search.js` + `gatherSources`.

**Hub** - a Farcaster protocol node exposing raw casts over HTTP/gRPC. farscout has a `HUB_URL` fallback but the 2026 public hubs tested were dead.

**Novelty triage** - scoring candidate topics by traction + novelty before spending research budget. `lib/triage.js`.

**Perspectives** - decomposing a topic into market/tech/social angle queries to broaden sourcing. Optional pass.

**Reflect / gap pass** - after a first synthesis, asking "what's missing?", fetching more sources, re-synthesizing once. Optional pass.

**Standing topics** - topics always researched each cycle regardless of the feed (default: mini-apps, frames-v2, snaps).

**Storyline** - a topic that has recurred >= 3 times within a 30-day window. Surfaced in the weekly digest. Temporal memory tracks it.

**Two-pass synthesis** - pass 1 (cheap model) extracts claims+citations from sources; pass 2 (strong model) synthesizes insights across them. The quality lever for small free models.

**Verify / self-eval** - labeling each finding entailed/contradicted/unsupported against its sources; dropping contradicted, tagging weak. `lib/verify.js`. Optional pass.

**Warpcast API** - `api.warpcast.com`, the free no-auth Farcaster read API farscout uses. (HAATZ was the original, now-dead, source.)

**ZABAL Bonfire** - the ZAO ecosystem's knowledge-graph memory at `tnt-v2.api.bonfires.ai`. farscout's durable memory.
