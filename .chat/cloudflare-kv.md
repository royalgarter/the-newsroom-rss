# Cloudflare KV Migration Plan

## Objective
Migrate the existing Deno OpenKV usage to Cloudflare KV transparently when the environment variable `PUBLISH_USE_CLOUDFLAREKV=true` is set.

## Key Files & Context
- `backend/src/kv.ts`: Current Deno KV initialization and helper methods.
- `package.json` / `deno.jsonc`: Project execution environment.

## Implementation Steps

1. **Modify `backend/src/kv.ts`:**
   - Add a check for `Deno.env.get('PUBLISH_USE_CLOUDFLAREKV') === 'true'`.
   - **If true:** Initialize a custom Cloudflare KV interface that implements:
     - `serializeKey(key)`: Converts Deno's array-based keys (e.g., `['profile', hash]`) into string keys joining with `:` (e.g., `"profile:hash"`).
     - `serializeValue(value)` / `deserializeValue(value)`: Stringifies JS objects on PUT and parses them back on GET.
     - `get(key)`: Issues a `GET` request to the Cloudflare API (`/values/:key`). Returns `{ key, value: parsed_value }`.
     - `set(key, value)`: Issues a `PUT` request to the Cloudflare API. Returns `{ ok: true }`.
     - `delete(key)`: Issues a `DELETE` request to the Cloudflare API. Returns `{ ok: true }`.
     - `list(options)`: Implements a basic async generator to query the Cloudflare API `keys` endpoint, mapping the resulting keys back to arrays and dynamically fetching values to preserve Deno's `list` behavior (used by the backup function).
   - **If false:** Fall back to the original `await Deno.openKv(Deno.env.get('DENO_KV_URL'))`.
   - Ensure the existing `safeGet` and `safeSet` decorators remain intact and function correctly for both implementations.

2. **Error Handling & Variables:**
   - Ensure missing environment variables (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_KV_NAMESPACE_ID`) trigger an explicit console error when Cloudflare KV is activated.

## Verification & Testing
1. Execute the project locally to confirm Deno KV remains fully operational by default.
2. Draft a standalone `backend/test/kv.test.ts` to mock the HTTP responses and verify the Cloudflare KV wrapper logic (serialization, `fetch` configurations, error states) cleanly passes without requiring a live Cloudflare environment.

## Post-Approval Task
Upon successful testing, this plan document will be persisted to `.chat/cloudflare-kv.md` to adhere to the project's internal `GEMINI.md` workflow guidelines.
