# Data sources

Every external API farscout touches, what it's free for, and the quirks discovered live (so you don't rediscover them). All verified 2026-05; external APIs churn - re-verify before trusting.

## Farcaster reads - Warpcast public API

Base `https://api.warpcast.com`. Free, no auth for reads.

| Endpoint | Use | Quirk |
|----------|-----|-------|
| `GET /v2/casts?fid=&limit=` | user casts | shape `{result:{casts:[...]}}`; `reactions.count`=likes, `recasts.count`=recasts, `embeds` is an object `{urls,images}` |
| `GET /v2/search-casts?q=&limit=` | cast search / grounding | works free |
| `GET /v2/following?fid=&limit=&cursor=` | follow graph | **page size capped at 50** (75/100 return HTTP 400); paginate with `next.cursor` |
| `GET /v2/user?fid=` | profile | `followingCount`, `followerCount` |

**Not free (need auth):** likes (`Authentication required`), a following/home feed, trending, mentions. That's why farscout uses follows (free) as the taste signal, not likes, and why `trendingFeed`/`mentions` are no-ops.

`haatz.quilibrium.com` (an older Neynar-compatible mirror) resolves but 404s on channels and cast-search - do not use it.

## Farcaster channels - Neynar v2

`https://api.neynar.com/v2/farcaster/feed/channels?channel_ids=` with header `api_key:`. Free tier ~300 rpm. Only used when `NEYNAR_API_KEY` is set, because **no provider offers a free unauthenticated channel feed** (Warpcast 200s with an empty list).

## Web search - free fallback chain

1. **Exa** (`https://api.exa.ai/search`, POST, `x-api-key`) - only if `EXA_API_KEY` set. Best quality, ~1000 free req/mo.
2. **Jina** (`https://s.jina.ai/?q=`) - free, no auth, 10M token pool. Returns ranked results with content. The default web search.
3. **DuckDuckGo HTML** (`https://html.duckduckgo.com/html/?q=`) - last resort, scrape-fragile (the regex is attribute-order-agnostic to survive markup shifts).

## Page reading - Jina Reader

`https://r.jina.ai/<url>` - free, no auth, returns clean LLM-ready markdown. farscout fetches a page directly first (to sniff Frame meta from raw HTML), then falls back to Jina Reader if the stripped text is thin.

## Crypto data - Dexscreener

`https://api.dexscreener.com/latest/dex/search?q=<ticker>` - free, no auth, ~300 rpm. Returns DEX pairs; farscout picks the highest-liquidity pair matching the ticker symbol and emits price / 24h change / liquidity / volume / FDV. Used to ground `$TICKER` mentions with real numbers.

Other free crypto sources worth adding (researched, not yet wired): DefiLlama (`api.llama.fi`, TVL, no auth), CoinGecko (10k/mo free key), GeckoTerminal (`api.geckoterminal.com`, pool depth, 30 rpm).

## Reasoning - OpenRouter

`https://openrouter.ai/api/v1/chat/completions`, `Authorization: Bearer`. `:free` models cost $0 but are a shared, saturated pool.

**The critical quirk:** a rate-limited free model returns **HTTP 200 with an `{error:{code:429}}` body**, not a non-2xx status. `brain.js` inspects the body. Also: model ids churn - a removed id returns 404. A ~$10 account credit lifts the free-tier rate limits dramatically without making `:free` calls cost anything.

## Memory - ZABAL Bonfire

`POST https://tnt-v2.api.bonfires.ai/knowledge_graph/episode/create`, `Authorization: Bearer`. Body: `{bonfire_id, name, episode_body, source:"text", source_description, reference_time}`. Verified live. Key in `~/.zao/zao.env`.

## Public Farcaster hubs (tried, all dead in 2026)

NodeRPC (`api.noderpc.xyz/farcaster-mainnet-hub`), Pinata hub, hoyt - all 404/unreachable when tested. The `hubCastsByFid` fallback + `normalizeHubCast` are wired and ready behind `HUB_URL`; drop in a live hub (or self-host Snapchain) and it lights up with no code change. Expected shape: `GET {hub}/v1/castsByFid?fid=&pageSize=&reverse=1` -> `{messages:[{data:{fid,timestamp,castAddBody:{text,embeds}},hash}]}`.

## Delivery - Discord

discord.js v14, gateway + REST. Slash commands registered per-guild (instant) + global (DM, ~1h propagate). DM use needs User Install enabled in the Developer Portal. Long operations (60-130s) use defer + editReply within the 15-min interaction window, DM fallback past it.
