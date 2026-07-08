# The Newsroom RSS

> Homepage: https://newsrss.org

We just decided: The first step in fixing the world is to Be Informed. Get curated news, delivered your way: fast, personalized RSS.

The Newsroom RSS is a full-stack RSS reader: a Deno backend that fetches,
parses, and caches feeds, paired with an Alpine.js single-page app, a
service worker for offline + periodic background sync, and an embedding
pipeline that ranks items against a per-user persona.

---

## Features

### Frontend (Alpine.js SPA, `frontend/`)

- Virtualized feed rendering: 6 feeds initial, +10 per scroll via an
  IntersectionObserver sentinel with a `[Load all]` button.
- Five layout styles selected via `?s=` / `params.s`:
  `full`, `tiny`, `title`, `noimg`, `nopreview`.
- Read-later / bookmarks with per-user Deno KV persistence.
- In-app notes with Markdown editing (`#bookmarks_note`).
- **Unified View** (`?u=`): flatten all feeds' items, sort by `published`
  desc, with source favicon + per-feed badge.
- Deep-link anchors (`?a=`): jump to a feed or item on load.
- Readability-based article preview fetched on hover / scroll-into-view.
- Embedding-based persona scoring: per-item cosine similarity against
  a running mean of vectors from articles the user actually opened.
- Idle + hot reload: refresh on focus loss (1h `setInterval`) and on
  idleness (`setIdle`, 30m).
- IndexedDB + service worker (`frontend/sw.js`) with `StaleWhileRevalidate`
  for static assets, `CacheFirst` for images, `NetworkFirst` for `/api/`
  + navigations, and a Workbox `ExpirationPlugin` budget.
- Periodic Background Sync registered with tag `get-feeds`
  (min interval 4h) when the browser supports it.

### Backend (Deno, `backend/`)

- RSS fetch + parse with `parseFeed` from `deno-rss`.
- Two-tier in-memory cache (`backend/src/cache.ts`):
  - `CACHE_FEEDS:<urls>:<limit>` — 15-minute TTL on raw fetched feeds.
  - `PERMANENT_CACHE_FEEDS:<urls>:<limit>` — 7-day TTL on parsed feeds.
- Per-feed background refresh interval (`FETCH_INTERVAL`) every 15 minutes.
- Deno KV (`backend/src/kv.ts`) with optional Cloudflare KV backend
  (`PUBLISH_USE_CLOUDFLAREKV=true`), used for read-later items,
  per-user presets/settings, signatures, and profiles.
- Gemini embedding fallback (`GET /embedding`) and Gemini LLM proxy
  (`GET /llm`) with round-robin key selection across
  `GEMINI_API_KEY` (comma-separated).
- Image proxy (`GET /proxy/image`) — CORS-safe rehosting of arbitrary
  remote images with a Chrome User-Agent and a 10s `AbortSignal.timeout`.
- Full-text HTML proxy (`GET /html`) used by Readability on the client.
- Google one-tap JWT verification (`GET /api/jwt/verify`) with JWKS
  cache and signature/profile persistence to KV.

### Cross-cutting

- Client-side embedding cache: `K.embedding + <link>` in `localStorage`,
  populated by `embedSentence` from `frontend/js/module.mjs`.
- Viewed-state batched into a single `K.viewed` `localStorage` entry
  (a `{link: timestamp}` object), plus per-link `K.viewed + <link>`
  legacy keys hydrated on init into `_viewedMap`.
- Cross-tab sync via the `storage` event on `_viewedMap`.
- `pagehide` + `visibilitychange === hidden` listeners flush the
  viewed-state cache.
- Prefetch on scroll via the IntersectionObserver (`itemObserver`,
  thresholds `[0, 1.0]`, `rootMargin: '-10% 0% -10% 0%'`).
- CORS: every API response sets `Access-Control-Allow-Origin: *`,
  `Access-Control-Allow-Methods: GET, POST, OPTIONS`,
  `Access-Control-Allow-Headers: Content-Type`.

---

## Architecture overview

```
Browser                         Backend (Deno, port 17385)
─────────                       ───────────────────────────
index.html  ── Alpine boot ──▶  handleRequest  (server.ts)
  ↓                             ├─ /api/feeds        → handleFeeds
  loadFeedsWithContent()        ├─ /api/readlater    → handleReadLater
  ├─ GET /api/feeds?is_tasks    ├─ /api/presets      → handlePresets
  └─ POST /api/feeds (batches)  ├─ /api/jwt/verify   → handleJwtVerify
                                 ├─ /embedding        → handleEmbedding
  postProcessFeeds()            ├─ /llm              → handleLLM
  ├─ anchor / short_title       ├─ /html             → handleHtml
  ├─ description cleanup        ├─ /proxy/image      → handleProxyImage
  ├─ embedding cache lookup     ├─ /                 → handleIndex
  └─ viewed-state hydration     └─ /<file>           → handleStatic
  ↓
sw.js (registered on load)
  ├─ StaleWhileRevalidate: scripts + styles
  ├─ CacheFirst: images
  ├─ NetworkFirst: /api/ + navigations (5s timeout)
  └─ periodicsync 'get-feeds' (every ~4h)
```

Frontend assets are cache-busted via `?v=1.30` query strings on
`index.js`, `index.css`, and `js/module.mjs`.

---

## Handling feeds logic

This section walks the full pipeline, end to end.

### Fetching

The frontend issues two kinds of requests:

1. `GET /api/feeds?is_tasks=true&x=<hash>&log=gettasks&sig=<sig>`
   to retrieve the user's saved task list (saved URLs + cached
   items).
2. `POST /api/feeds?type=keys&sig=<sig>&l=<limit>&x=<hash>&pioneer=<bool>`
   with a JSON body of `{ batch: [{url, ...}], keys: [{url, content?}] }`
   to fetch and parse actual feed content. Each batch is a single feed
   so failure on one URL does not block the others.

`handleFeeds` first checks if `hash` matches a preset name in
`data/preset.json`. If so, `keys` is expanded from that preset.
Otherwise, an authorized user (`authorize(hash, sig)`) gets their
saved tasks from KV (`['/api/feeds', hash]` or `['/api/feeds', hash, ver]`).
An anonymous caller gets an MD5 of `keys + Date.now()` truncated to
8 chars.

For each URL, the backend calls `fetchRSSLinks` → `parseRSS`. The
`pioneer` flag (4h stale, `STALE_THRESHOLD_HOUR`) bypasses the cache.
Otherwise the raw feed body short-circuits on a cached
`RSS:<url>` entry with a 15-minute TTL via `Promise.any`:

- a cache-hit branch that resolves after a synthetic 3s delay, and
- a `fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(...) })`
  branch that resolves on success (5s timeout for `pioneer`, 20s otherwise).

The URL is forced to `https://` and prepended with the scheme if missing.

### Parsing

`parseFeed` from `deno-rss` extracts `title`, `link`, `image`, and
`entries[]`. The frontend sends feed-level metadata back to the
client after the backend wraps each entry in `processRssItem`:

- `title` (title-cased via `case.titleCase`)
- `link` (article URL, unwrapped from Google/Bing `?url=` redirects)
- `description` (text extracted from HTML, images stripped)
- `author` (from `dc:subject` / `author.name` / hostname heuristic)
- `published` / `updated` (ISO timestamps)
- `images[]` (extracted from `media:group`, `media:content`,
  `media:thumbnail`, `attachments[]`, and inline `<meta og:image>` /
  ld+json from `HTML:<link>` cache)
- `categories[]`
- `statistics` (formatted `media:community` fields)
- `ldjson` (parsed `<script type="application/ld+json">` if present)

Image URLs are rewritten through `/proxy/image?origin=...` unless
they already contain `/proxy/image`. If no images are found, a
fallback `https://static.photos/640x360/<hash>` placeholder is used.

The fetch order is:

1. `POST /api/feeds` returns parsed feeds.
2. The frontend merges `feeds_cached` (existing items from KV) with
   freshly fetched items, deduping by `link`.
3. `postProcessFeeds` decorates each feed + item for rendering.
4. The Alpine `unifiedItems` getter (when `?u=`) flattens all feeds.

### Clustering & dedup

`rss.ts` filters items to those published within the last 31 days
(`LAST_MONTH = now - 31d`), then sorts each feed's items by
`(b.images?.length - a.images?.length)` then `published desc`. Items
across feeds are not server-side deduped; the frontend merges by
`link` when overlaying `feeds_cached` onto freshly fetched items.

### Caching

`backend/src/cache.ts` is a thin `Map`-backed wrapper with per-key
TTL timers:

```ts
const CACHE = {
  MAP: new Map(),
  TIMER: new Map(),
  get: (k) => CACHE.MAP.get(k),
  del: (k) => CACHE.MAP.delete(k),
  set: (k, v, e=60*60*24*7) => { /* e in seconds; lazy eviction */ },
}
```

`saveFeedCache` writes the same `feeds` array into three layers:

| Layer | Key | TTL |
|---|---|---|
| 0 | `CACHE_FEEDS:<urls>:<limit>` | 15 minutes |
| 1 | `PERMANENT_CACHE_FEEDS:<urls>:<limit>` | 7 days |
| 2 | `CACHE_KV` (truncated to `limit` items, `f.items.slice(0, limit)`) | n/a |

Hot reads return within 3 seconds via the `Promise.any` race in
`parseRSS`. Cold reads populate the cache on success. Stale entries
are evicted lazily by `setTimeout(..., e*1e3)` when they expire.

### Client post-processing

`postProcessFeeds({limit, auto_fetch_content, show_viewed})` runs
per feed:

- Sets `feed.anchor` (sanitized `rss_url`), `feed.short_title`
  (hostname heuristic), `feed.favicon_url`
  (`https://www.google.com/s2/favicons?domain=...&sz=128`), and
  `feed.tags` (from `tasks` or derived from URL host).
- For each item:
  - `linkToItemMap.set(item.link, item)` for O(1) lookup by the
    intersection observer.
  - `item.viewed` lookup from `_viewedMap` (in-memory batched cache),
    falling back to `localStorage[K.viewed + item.link]`.
  - `description` HTML stripped to plain text via
    `new DOMParser().parseFromString(html, 'text/html').documentElement.textContent`,
    then normalized whitespace and truncated to 400 chars.
  - `image_thumb` set from `item.images[0]`.
  - `published_formatted` / `title_formatted` (decoded HTML, 150
    chars) / `description_formatted` (decoded, 300 chars) /
    `author_formatted` (20 chars).
  - `item.anchor` (sanitized `link`).
  - Embedding lookup from `localStorage[K.embedding + link]`; if
    missing and `window.embedSentence` is loaded, embed
    `${title} - ${description}` (cached on success).
  - `item.toggleReadmore` / `item.prefetchContent` / `item.updatePersona`
    are attached per item.
- Filters out viewed items when `feed.items.length > limit` and
  `!show_viewed`, then sets `item.disable = (idx >= limit)` so
  Alpine `x-show` collapses them; `feed.loadMore()` clears `disable`.

### Lazy rendering

`visibleFeeds` is an Alpine getter that slices `feeds` by
`visibleFeedsLimit` (default 6):

```js
get visibleFeeds() { return this.feeds.slice(0, this.visibleFeedsLimit); }
```

The sentinel at the bottom of the feed list (`#anchor_jump` area)
calls `loadMoreFeeds()` via `x-intersect`, which is guarded by
`_loadingMore` and coalesced with `requestAnimationFrame` +
`$nextTick`. The new limit is `Math.min(visibleFeedsLimit + 10, feeds.length)`.
A `[Load all]` button sets `visibleFeedsLimit = feeds.length` directly.

### Viewed-state tracking

An item is marked viewed when it has been in full viewport for at
least `TRIGGER.LIMIT` (12 seconds):

```js
const itemObserver = new IntersectionObserver((entries) => {
  /* ... */
}, { threshold: [0, 1.0], rootMargin: '-10% 0% -10% 0%' });
```

`triggerIntersect('full', link)` records `trig.tic`;
`triggerIntersect('leave', link)` records `trig.toc` and, when
`trig.toc - trig.tic` exceeds `TRIGGER.LIMIT`, writes
`viewedItemsCache[link] = <iso timestamp>` and patches
`item.viewed`.

`saveViewedItemsCache` flushes the cache:

- On a 5-second `setInterval`.
- On `pagehide` (browser back/close).
- On `visibilitychange === hidden` (tab switch).

Each flush merges the pending cache into a single batched
`localStorage[K.viewed]` entry (a `{link: ts}` object) and updates
the in-memory `_viewedMap`. `_viewedMap` is also synced cross-tab
via `window.addEventListener('storage', ...)` so changes from other
tabs appear immediately.

### Embedding & persona

When `window.embedder` (a Transformers.js pipeline loaded in
`frontend/js/module.mjs`) is loaded and `this.persona.vector` exists,
each item's title is embedded (cached via `K.embedding + link`).
Cosine similarity between the item vector and the persona vector is
rendered as `item.author` (e.g. `"0.42"`).

Reading an item (`toggleReadmore`) calls `item.updatePersona()`,
which embeds `item.title` and updates `this.persona` via a running
mean:

```js
let newVector = updateMeanVector(this.persona.vector, this.persona.count, item.vector);
this.persona = { vector: newVector, count: this.persona.count + 1 };
```

The persona itself is persisted to `localStorage[K.persona]`.

### Unified view (`?u=`)

`unifiedItems` is a memoized Alpine getter that:

1. Builds a cheap signature over `feeds.length`, per-feed item counts,
   and last-item `link`.
2. Returns `_unifiedCache` if the signature is unchanged.
3. Otherwise flattens all feeds' items, attaching `feed_favicon` and
   `feed_title` (the part before ` > `), filtering `item.hidden_by_cluster`
   / `item.disable` / `item.is_note`, and sorting by `published` desc.

### Presets

`GET /api/presets` returns the list of categories. `GET /api/presets?category=<name>`
returns the URLs for that category from `data/preset.json`. The
frontend reads presets on demand via `params.topic` / `tasks`,
expands them into the `keys` list sent to `/api/feeds`, and treats
the resulting feeds as read-only (Settings are locked in topic view).

---

## URL parameters

| Param | Purpose |
|---|---|
| `?u=1` | Enable Unified View — merge all feeds into one sorted list |
| `?s=tiny\|full\|title\|noimg\|nopreview` | Layout style |
| `?l=<n>` | Items per feed (default `12`, `K.LIMIT`) |
| `?a=<anchor>` | Scroll to feed/item anchor on load |
| `?k=<gemini-key>` | Gemini API key (client-side embedder fallback) |
| `?x=<hash>` | Per-user KV partition (`params.x`, alias for `hash`) |
| `?topic=<name>` | Load a preset by name (read-only mode) |
| `?f=bookmarks` | Hide main feeds, show only read-later |
| `?f=single_view` | Single-item view (combined with `?u=<link>`) |
| `?mode=u\|f\|uf` | Combined mode flag (sets `s=tiny` and/or `u=true`) |
| `?v=<n>` | Hash version for KV task lookup |

---

## API endpoints

### `GET|POST /api/feeds`

Fetch and parse RSS feeds.

- **GET query params**: `u=<csv>` (URL-encoded, comma-separated feed URLs),
  `l=<n>` (items per feed, default `12`, max `100`; presets force `100`),
  `x=<hash>` (KV partition), `v=<ver>` (hash version), `sig=<signature>`
  (KV signature), `cachy=no_cache` (skip `CACHE_FEEDS` and re-fetch),
  `pioneer=<bool>` (bypass cache, use 5s timeouts), `is_tasks=true`
  (return saved tasks + cached items), `is_tasks_only=true`,
  `type=keys`.
- **POST body**:
  ```json
  {
    "keys": [{ "url": "https://example.com/feed.xml" }],
    "batch": [{ "url": "https://example.com/feed.xml", "content": "<raw xml>" }],
    "update": true,
    "settings": { "k": "<gemini-key>", "s": "full", "l": 12 }
  }
  ```
- **Response (normal)**:
  ```json
  {
    "feeds": [
      {
        "title": "BBC > Home",
        "link": "https://www.bbc.co.uk/",
        "rss_url": "https://feeds.bbci.co.uk/news/rss.xml",
        "image": "/proxy/image?origin=...",
        "order": 0,
        "short": "...",
        "items": [
          {
            "link": "https://www.bbc.co.uk/news/article-1",
            "title": "Article title",
            "author": "BBC",
            "description": "Plain-text excerpt",
            "published": "2025-01-01T12:00:00.000Z",
            "updated": "2025-01-01T12:00:00.000Z",
            "images": ["/proxy/image?origin=..."],
            "categories": ["World"],
            "statistics": ""
          }
        ],
        "cache": "CACHE"
      }
    ],
    "hash": "abcd1234",
    "settings": { "k": "...", "s": "full", "l": 12 }
  }
  ```
- **Response (`is_tasks=true`)**: `{ feeds, feeds_cached, hash, settings }`.

### `GET|POST|DELETE /api/readlater`

Per-user bookmark CRUD, gated by `authorize(hash, sig)`.

- **GET** `/api/readlater?x=<hash>&sig=<sig>` — list bookmarks.
- **GET** `/api/readlater?x=<hash>&sig=<sig>&link=<url>` — return
  the stored article body for one bookmark (reassembles chunked
  content).
- **POST** with body `{ x, sig, action, item }` — upsert a bookmark.
  If `item.image_thumb` or `item.description` is missing, the server
  fetches the URL into `HTML:<link>` cache and extracts og meta.
- **DELETE** with body `{ x, sig, link }` — remove a bookmark and
  its chunked article content.
- **401** when `authorize` returns `{valid: false}`.

### `GET /api/presets`

- `GET /api/presets` — returns `{ categories: [...] }` from
  `data/preset.json`.
- `GET /api/presets?category=<name>` — returns
  `{ category, urls: [...] }` or `404 { error: 'Category not found' }`.

### `GET /api/jwt/verify`

Verifies a Google one-tap JWT. Query: `?jwt=<token>`.
- `200`: `{ username, email, picture, jti, signature, verified, ... }`.
- `403`: `{ error: 'E403_jwt' }` or `{ error: <details> }`.

### `GET /embedding`

Server-side Gemini embedding fallback. Query: `?text=<url-encoded>`.
- `200`: JSON-encoded `number[]` (768-dim vector).
- `401`: `{ error: 'No API key available' }`.

Uses `gemini-embedding-001` with `outputDimensionality: 768`,
`taskType: 'CLUSTERING'`. Honors `x-goog-api-key` request header
before falling back to `GEMINI_API_KEY` round-robin.

### `GET /llm`

Server-side Gemini LLM proxy. Query: `?prompt=<url-encoded>`.
- `200`: JSON-encoded string (first candidate text).
- `401`: `{ error: 'No API key available' }`.

Uses `gemini-2.0-flash:generateContent`. Same API-key handling as
`/embedding`.

### `GET /html`

Server-side HTML proxy used by Readability. Query: `?u=<url>`.
- `200`: raw `text/html`, `Cache-Control: public, max-age=604800`.
- `403`: empty body or `{ error: 'E403_html' }`.

`pioneer=true` uses a 5s timeout; otherwise 20s.

### `GET /proxy/image`

CORS-safe image rehosting. Query: `?origin=<url>`.
- `200`: image bytes with the upstream `Content-Type`,
  `Cache-Control: public, max-age=604800, immutable`.
- `400`: `{ error: 'Origin URL missing' }`.
- Upstream error code is propagated.

Fetches with a Chrome User-Agent, `redirect: 'follow'`, and
`AbortSignal.timeout(10s)`.

### `GET /`

Serves the SPA shell (`frontend/index.html`) with
`Cache-Control: public, max-age=604800`.

### Static assets

`GET /<file>` is routed through `handleStatic`, which reads from
`./frontend/<file>` first then `./data/<file>`. MIME types are
mapped via `extname`. Static responses carry
`Cache-Control: public, max-age=604800`.

`GET /sw.js`, `/index.css`, `/index.js`, `/js/module.mjs`,
`/manifest.json`, `/favicon.ico`, `/tos.html`, `/privacy.html`,
`/default-profile-64x64.png`, `/components/*.html` are all served
this way.

---

## Setup & running

### Prerequisites

- [Deno](https://deno.land/) (>= 1.40, with `--unstable-kv`).
- [Node.js](https://nodejs.org/) + npm (only for Tailwind CSS).

### Install

```bash
git clone <repository-url>
cd the-newsroom-rss
npm run tailwind:install     # install @tailwindcss/cli (no-save)
deno task tailwind           # build frontend/index.css from frontend/style.css
deno task start              # run backend/server.ts with .env
```

`deno task start` resolves to:

```bash
deno run --unstable-kv --allow-net --allow-read --allow-write \
  --allow-env --env-file=.env backend/server.ts
```

For development (auto-build Tailwind then run):

```bash
deno task local              # tailwind build + deno task start
```

### Environment variables

Create a `.env` file at the repo root (already gitignored):

```bash
DENO_KV_URL=                  # optional; defaults to local KV
PORT=17385                    # default
GEMINI_API_KEY=key1,key2,...  # optional; round-robin across keys
```

Optional Cloudflare KV backend:

```bash
PUBLISH_USE_CLOUDFLAREKV=true
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_API_TOKEN=...
CLOUDFLARE_KV_NAMESPACE_ID=...
```

On startup, `kv.ts` also writes a backup to `database/kv-backup-<ts>.json`
and restores from the latest backup if the KV is empty.

### Preset management

```bash
deno task update-preset       # refresh data/preset.json
deno task check-preset        # health-check all preset URLs
deno task check-preset-full   # backup then health-check
```

---

## Caching strategy

The backend uses two storage tiers:

| Tier | Module | TTL | Use |
|---|---|---|---|
| In-memory `Map` | `backend/src/cache.ts` | 15 min raw feed / 7 days parsed feed | Hot reads, dedup across requests |
| Deno KV | `backend/src/kv.ts` | persistent | Read-later, per-user presets, settings, profiles, signatures, chunked article bodies |

Hot reads return within 3 seconds via the `Promise.any` race in
`parseRSS` (cached branch resolves on a 3-second timer; fetch
branch resolves as soon as the upstream returns). Cold reads
populate both tiers on success.

`FETCH_INTERVAL[key_feeds]` is a `setInterval` (15 minutes) that
refreshes each feed key in the background; entries are tagged
`cache: 'CACHE'` (15 min) or `cache: 'CACHE_PERMANENT'` (7 days).

Raw HTML fetched for `/html` and the read-later metadata scrape
is cached under `HTML:<url>` with the default 7-day TTL.

---

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `17385` | HTTP port for `Deno.serve` |
| `DENO_KV_URL` | unset (local KV) | Remote Deno KV endpoint |
| `GEMINI_API_KEY` | unset | Comma-separated Gemini keys; round-robin on `/embedding` and `/llm` |
| `PUBLISH_USE_CLOUDFLAREKV` | `false` | Use Cloudflare KV instead of Deno KV |
| `CLOUDFLARE_ACCOUNT_ID` | unset | Required when `PUBLISH_USE_CLOUDFLAREKV=true` |
| `CLOUDFLARE_API_TOKEN` | unset | Required when `PUBLISH_USE_CLOUDFLAREKV=true` |
| `CLOUDFLARE_KV_NAMESPACE_ID` | unset | Required when `PUBLISH_USE_CLOUDFLAREKV=true` |
| `CLOUDFLARE_BROWSER_RENDERING_ACCOUNT` | unset | (verify) Optional Cloudflare Browser Rendering account for `media:group` HTML fetches |
| `CLOUDFLARE_BROWSER_RENDERING_BEARER` | unset | (verify) Optional Cloudflare Browser Rendering bearer token |

---

## Notes

The persona-based personalization works as follows: when the user
opens an article, its title is embedded via the client-side
Transformers.js pipeline; the running mean of those vectors becomes
`this.persona.vector`. Each feed item is then scored by cosine
similarity against that vector, and the score is rendered as a
tag on the item card. This lets the reader surface more of what
they actually engage with, without sending a clickstream to a
third party.

The project takes its name and inspiration from Aaron Sorkin's
*The Newsroom* — Will McAvoy's insistence that doing news better
is the first step toward an informed public. The aim is the same:
"do it better" for RSS reading. Personalization should be local,
caching should be aggressive, the UI should be fast on cold loads,
and the entire thing should work offline.

---

## Contributing

Issues and pull requests are welcome. Keep changes scoped; the
project favors minimal diffs over architectural rewrites.

## License

[MIT](LICENSE)

---

> _"In the Information Age, ignorance is a choice.", "It's not the news, it's how you get the news.", "We just decided to try to do it better." — Will McAvoy, The Newsroom by Aaron Sorkin_
