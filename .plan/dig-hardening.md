# /dig hardening (many feeds / many items)

Problems found in `digestNews` (frontend/index.js) and `generateContent` (frontend/js/llm.mjs):
1. `allItems.slice(0, 100)` takes the first feed's items first -> later feeds never appear when there are many feeds.
2. No dedupe (same story across feeds), no recency order, no prompt size budget.
3. LLM output pasted into `x-html` modal after regex markdown -> XSS from feed titles/prompt injection. LLM URLs can be hallucinated.
4. `generateContent` swallows every HTTP error as `null` -> UI says "check API key" for 429/500/safety block/truncation; no timeout; server fallback uses GET query string (URL length).
5. Re-run costs a full API call even if feeds unchanged.

Plan (frontend only, no new deps):
- `_selectDigestItems`: dedupe by link/title, newest-first per feed, round-robin across feeds, cap by count + char budget.
- Prompt: items numbered `[n]`; model cites `[Title](#n)`; URLs resolved locally from the numbered list. Feed text sanitized and fenced as data.
- Render: escape HTML first, then markdown; only ids that exist -> http(s) links.
- `generateContent`: timeout, one retry on 429/5xx, typed errors, block/truncation detection, refuses oversized GET fallback.
- `digestNews`: specific error toasts, coverage line ("N stories from M of X feeds"), cache by selection hash.
Verify: deno test tests/dig.test.ts (pure helpers).
