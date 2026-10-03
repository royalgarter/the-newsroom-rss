@README.md

> Read this `README.md` to understand the long-term project goals.

---

## 0. Before You Start: Document Map

Identify the domain and read the corresponding documentation before implementing any request. Never edit code from memory or assumption.

| Request touches... | Read first |
| --- | --- |
| DB schema, system design, API routes overview | `docs/architecture.md` |
| Business rules, acceptance criteria, edge cases | `docs/requirements.md` |
| UI/UX, layout, interaction patterns | `docs/design_guidelines.md` |
| Open business decisions | `QUESTIONS.md` |
| What is shipped vs stubbed | `FEATURES.md`, `PRODUCTION_READY.md` |

Fall back to `docs/architecture.md` for orientation if a request spans no specific rows.

---

# Coding Guidelines

Behavioral guidelines to ensure high-quality, maintainable, and minimalistic code. Bias toward caution over speed.

## 1. Development Workflow & Planning

* **Plan First:** Draft multi-step plans with verifiable success criteria in `.plan/<feature_name>.md` prior to implementation. Loop until verified.
* **Think Before Coding:** State assumptions explicitly. Present multiple interpretations if they exist.
* **Proactive Minimal Payload:** Ship the minimal working version first for complex requests and question the complexity. If the user insists, build it without debate. Explicitly state omitted elements.
* **Clarify & Push Back:** Stop and ask if a request is ambiguous. Suggest simpler approaches.
* **Goal-Driven Execution:** Transform tasks into concrete, verifiable goals.

### 1.1 The Execution Ladder

Stop at the first true statement:

1. Does this need to be built at all? No? Skip it.
2. Does it already exist in this codebase? Reuse the helper, util, or pattern.
3. Does the standard library do it? Use it.
4. Does a native platform feature cover it? Use it.
5. Does an already-installed dependency solve it? Use it.
6. Can this be one line? Do it.
7. Only then write the minimum code that works.

## 2. Simplicity & Minimalism

* **Minimum Viable Code:** Write only what is required to solve the problem. Default to the edge-case-correct option for ties.
* **No Speculation:** Zero unrequested features, single-use abstractions, or speculative flexibility.
* **Boundary Definition (When not to be lazy):** Never cut validation, error handling, security, accessibility, or data-loss protection. Never skip understanding; blind edits are prohibited.
* **Clean Logic:** Keep core logic linear and push implementation details to the edges. Boring beats clever.
* **Vanilla JS First:** Strictly avoid new frameworks or heavy libraries.

## 3. Surgical & Iterative Changes

* **Iterate:** Implement step-by-step. Ban sweeping modifications. Touch the fewest files possible.
* **Minimal Footprint:** Every modified line must trace directly to the task. The shortest working diff wins.
* **Do not Fix Unbroken Things:** Never refactor adjacent code or reformat unrelated lines. Tag pre-existing issues with `TODO:`.
* **Preserve Code (Deprecate):** Never delete unused code outright. Comment it out and tag as `DEPRECATED`.
* **Debug:** Fix root causes, not symptoms. Grep every caller end-to-end before editing. Fix the routing bottleneck once.
* **Testing:** Non-trivial logic requires exactly one runnable check (a tripwire). No bloated suites. Trivial one-liners require zero tests.

## 4. Coding Best Practices

* **Self-Documenting Code:** Code must explain itself. Omit comments if a senior developer can deduce the logic.
* **Functional & Stateless:** Default to functional, immutable, and stateless patterns.
* **Control Flow:** Enforce early returns. Ban deep nesting.
* **DRY (Don't Repeat Yourself):** Eradicate duplication via reusable components.
* **Constants:** Prefer constants over functions.

## 4.1 AQL Is Not JavaScript

Query strings passed to `query`/`rawQuery` are AQL, not JS. Only `${...}` holes are JavaScript;
everything around them is parsed by ArangoDB, which has a much smaller operator set.

* **No `??`.** ArangoDB has no nullish-coalescing operator — `FOR tn IN (t.tenders ?? [])` fails to
  parse (`errorNum 1501: syntax error, unexpected ?`) and the endpoint 500s on every call. Write
  `(t.tenders != null ? t.tenders : [])`, the form already used in `voice_shared.ts`.
* **No `?.`, no `...` spread, no `===`.** Use `!= null` guards, `APPEND`/`MERGE`, and `==`.
  Backticks quote *identifiers* in AQL, not strings — build strings with `CONCAT`.
* `??` *inside* `${...}` is fine — that is JS running before the query is built (`customers.ts`,
  `ledger.ts` do this).
* **Parse-check anything non-trivial before shipping it.** `POST /_api/query` only parses, never
  runs, so it is safe against the live database:

```bash
curl -s -u root:"$ARANGO_ROOT_PASSWORD" -X POST "$ARANGO_HOST/_db/_system/_api/query" \
  -d '{"query":"FOR t IN TICKETS FILTER t.x == @p RETURN t","bindVars":{"p":"v"}}'
```

A syntax error only surfaces at request time, so a query on a rarely-hit path (error recovery,
refund, reconciliation) can ship broken and stay broken — cover those paths with a test that
asserts the response comes from *after* the query.

## 5. Formatting & Naming Conventions

* **Strict Formatting:**
* **Indentation:** Tabs only.
* **Semicolons:** Mandatory.
* **Braces:** One True Brace Style (1TBS).

* **Naming Conventions:**
* `camelCase`: Variables and functions. Make them instantly readable.
* `UPPER_SNAKE_CASE`: Constants and globals.
* `_prefix`: Internal or private functions.

## 6. HTML & CSS Design Philosophy

* **Utilitarian UI/UX:** Enforce a deeply clean, low-effect minimalist design.
* **Strict Standard Utilities:** Use predefined utility classes exclusively. NEVER use arbitrary, custom, or bracketed values.
* **Zero Costly Effects:** Ban purely cosmetic or performance-heavy CSS properties.

## 7. Deployment

* **Ship to prod:** Execute `deno task remote:deploy`. This pulls `main` on the VPS and rebuilds via `docker-compose up -d --build`. Work must be pushed to `origin/main` first. Never deploy uncommitted changes.

## 8. Project Structure & Environment

* **Zero-Build Architecture:** Ban build systems, bundlers, and transpilers.
* **Native Quick Start:** Serve natively via vanilla Node.js, Deno, or Bun.
* **Browser-Native ES Modules:** Enforce native browser standards for frontend JS.
* **Flat & Shallow Directories:** Maintain a strictly flat folder structure.
* **Minimal Dependencies:** Ban bloated `package.json` files and massive `node_modules`.

---

## Documentation Location

All documentation and architecture diagrams reside in `docs/`.

**Agent Modification Policy:** Request user approval before editing any file in `docs/`. Append a `[YY-MM-DD]` comment to all approved edits.

---

# CRITICAL IMPORTANT: MANDATORY AGENT DIRECTIVE

Before modifying codebase logic, databases, routes, or assets:

1. You MUST read this entire `/README.md` document first.
2. You MUST update this `/README.md` file reflecting any intended schema, color palette, or logic shifts BEFORE modifying the active code.
3. Ensure no custom UI for API keys is generated. Rely strictly on standard `.env.example` configurations.
4. Do not delete or rename this file. Maintain all architectural transparency to ensure subsequent agents scale the project with absolute consistency.
5. After receiving a task, always plan first and ask clarifying questions. Upon approval, draft the plan and to-do list into `TODO.md`, and prepare unit tests in `tests/`. Update `TODO.md` synchronously as items are finished.
6. After completing `TODO.md`, request final approval. Once verified, dump the completed items into a new section in `CHANGELOG.md` and wipe `TODO.md` clean.
7. **Communication Protocol:** You MUST adopt this exact concise, decisive, and fluff-free tone in all summaries, questions, and chat interactions with the user. Stop guessing; state the facts.

---
