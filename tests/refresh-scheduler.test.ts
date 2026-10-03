// Tripwire for the refresh scheduler's deadline/queue logic.
//
// Regression: `_refreshAt` was re-armed only on the non-pending branch of the
// `loading` watcher, so once a deadline was missed (guaranteed after the laptop
// sleeps — `setInterval` is suspended, `Date.now()` is not) the queued refresh
// re-queued itself on the next tick and `/api/feeds` was hit in a tight loop
// for the rest of the session.
//
// `frontend/index.js` is a plain <script>, so `alpineRSS` is script-scope rather
// than an export. We evaluate the source in a function scope to reach it, which
// keeps production code free of test-only exports.
// Run: deno test -A tests/refresh-scheduler.test.ts
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";

const src = await Deno.readTextFile(new URL("../frontend/index.js", import.meta.url));
// deno-lint-ignore no-explicit-any
const factory: any = new Function(src + "\n;return { alpineRSS };" )();

const REFRESH_INTERVAL_MS = 15 * 60e3;

Deno.test("a deadline missed while loading refreshes exactly once, then re-arms", () => {
	// deno-lint-ignore no-explicit-any
	const app: any = factory.alpineRSS();

	let loads = 0;
	// Stands in for loadFeedsWithContent: starts a load and leaves it in flight.
	// Returns a promise like the real async method, so `.catch()` on the call site
	// behaves the same.
	app.loadFeedsWithContent = () => {
		loads++;
		app.loading = true;
		return Promise.resolve();
	};

	const t0 = Date.now();
	app._refreshAt = t0 - 1; // laptop woke up past the deadline

	app._tickRefresh(t0); // fires the refresh
	assertEquals(loads, 1);
	assertEquals(app.loading, true);

	app._tickRefresh(t0); // still loading -> queue one
	app._tickRefresh(t0);
	assertEquals(app._refreshPending, true);
	assertEquals(loads, 1, "a queued refresh must not fire while a load is in flight");

	app.loading = false;
	app._onLoadSettled(); // runs the queued refresh and re-arms the countdown
	assertEquals(loads, 2);

	// The regression: with `_refreshAt` left stale, every following tick saw a
	// passed deadline and queued another load, forever.
	for (let t = t0; t < t0 + 60; t++) {
		app.loading = false;
		app._tickRefresh(t);
	}
	assertEquals(app._refreshPending, false);
	assertEquals(loads, 2, "no refresh may fire before the re-armed deadline");

	// Re-armed a full interval out, so exactly one more refresh happens.
	const afterRearm = app._refreshAt;
	assertEquals(afterRearm - (t0 + 60) > REFRESH_INTERVAL_MS - 1000, true);
	app.loading = false;
	app._tickRefresh(afterRearm);
	assertEquals(loads, 3);
});

Deno.test("hidden feeds re-arm the deadline instead of spinning at 1Hz", () => {
	// deno-lint-ignore no-explicit-any
	const app: any = factory.alpineRSS();

	let calls = 0;
	// Bookmarks / share-target view: the load returns before touching `loading`, so
	// the `loading` watcher — the only other re-arm path — never runs.
	app.loadFeedsWithContent = () => {
		calls++;
		return Promise.resolve();
	};

	const t0 = Date.now();
	app.is_hide_feeds = true;
	app._refreshAt = t0 - 1;

	for (let t = t0; t < t0 + 60; t += 1000) app._tickRefresh(t);
	assertEquals(calls, 0, "a load would be a no-op while the feeds are hidden");
	assertEquals(app._refreshPending, false);

	app.is_hide_feeds = false;
	app._tickRefresh(app._refreshAt);
	assertEquals(calls, 1, "the re-armed deadline fires once the feeds come back");
});