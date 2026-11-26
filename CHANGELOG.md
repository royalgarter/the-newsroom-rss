## 2026-11-26 — fix feedsByUrl TDZ crash

- [x] **#1 `feedsByUrl` declared before use** — `const` sat after the cached-feeds loop that read it, so every load threw `ReferenceError` and feeds never rendered.
- [x] **#2 README + cache-bust 1.43 -> 1.44** (`index.html`, `sw.js`).

---

## 2026-11-22 — render perf with many feeds

Decisions (confirmed with user): minimal plan; deep-reactivity change deferred.

- [x] **#1 Skip already-processed feeds in `postProcessFeeds`** — streaming made it O(N²); now signature-guarded (55 -> 10 runs for 10 feeds).
- [x] **#2 `appendFeed` Map lookup** — O(1) by `rss_url`.
- [ ] **#3 Key item rows by `item.link`** — SKIPPED: duplicate links within one feed would give duplicate Alpine keys. Needs dedupe first.
- [x] **#4 Tripwire** — `tests/showcase.test.ts`.
- [x] **#5 README + cache-bust 1.42 -> 1.43.**
- TODO: `feed.loadMore` filters `item.url == x.url` (always undefined) so it drops every new item.

---

## 2026-11-22 — showcase blurred backdrop

Decisions (confirmed with user): canvas downscale blur (no CSS `filter`, §6); pool = loaded thumbs with `naturalWidth >= 1000`, any feed; showcase only, fixed behind page; no hi-res image found -> keep previous backdrop, else plain page bg.

- [x] **#1 README** — document backdrop under Showcase mode.
- [x] **#2 `<canvas id="showcase_bg">`** — `fixed inset-0 -z-10 pointer-events-none`, `x-show="showcase"`, `aria-hidden`.
- [x] **#3 `_pickShowcaseBackdrop` / `_paintShowcaseBackdrop`** — random hi-res pick, draw 32x18 cover-fit + black wash, called each `_showcaseAdvance`.
- [x] **#4 Tripwire** — `tests/showcase.test.ts`: pick only from `>= SHOWCASE_BG_MIN_WIDTH`, null when none.
- [x] **#5 Rebuild tailwind, bump cache-bust 1.41 -> 1.42** (`index.html`, `sw.js`, README).

---

