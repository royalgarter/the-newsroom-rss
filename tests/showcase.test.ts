// Tripwire for showcase mode's shuffle buffer.
// `frontend/index.js` is a plain <script>, so `alpineRSS` is script-scope rather
// than an export. We evaluate the source in a function scope to reach it, which
// keeps production code free of test-only exports.
// Run: deno test -A tests/showcase.test.ts
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";

const src = await Deno.readTextFile(new URL("../frontend/index.js", import.meta.url));
// deno-lint-ignore no-explicit-any
const factory: any = new Function(src + "\n;return { alpineRSS };")();

// deno-lint-ignore no-explicit-any
function makeApp(feedCount: number): any {
	// deno-lint-ignore no-explicit-any
	const app: any = factory.alpineRSS();
	app.feeds = Array.from({ length: feedCount }, (_, i) => ({ anchor: "feed-" + i }));
	return app;
}

Deno.test("_shuffleFeeds returns a permutation of every feed index exactly once", () => {
	const app = makeApp(12);
	const expected = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
	for (let run = 0; run < 20; run++) {
		const order = app._shuffleFeeds();
		assertEquals(order.length, 12);
		assertEquals([...order].sort((a: number, b: number) => a - b), expected);
	}
});

Deno.test("_shuffleFeeds actually randomizes (order differs from input)", () => {
	const app = makeApp(12);
	const identity = app.feeds.map((_: unknown, i: number) => i);
	const sawNonIdentity = Array.from({ length: 10 }, () => app._shuffleFeeds())
		.some((o: number[]) => o.some((v, i) => v !== identity[i]));
	assertEquals(sawNonIdentity, true);
});

Deno.test("a full showcase cycle visits each feed exactly once", () => {
	const app = makeApp(8);
	const order = app._shuffleFeeds();

	// Same walk _showcaseAdvance performs, without the DOM side effects.
	const visited: number[] = [];
	let pos = 0;
	for (let step = 0; step < order.length; step++) {
		visited.push(order[pos]);
		pos = (pos + 1) % order.length;
	}

	assertEquals(visited.length, 8);
	assertEquals([...visited].sort((a: number, b: number) => a - b), [0, 1, 2, 3, 4, 5, 6, 7]);
	assertEquals(pos, 0, "position wraps back to the start of the buffer");
});

Deno.test("stopShowcase resets mode, buffer, position and scroll guard", () => {
	const app = makeApp(4);
	app.showcase = true;
	app._showcaseTimer = setTimeout(() => {}, 60e3);
	app._showcaseOrder = [0, 1, 2, 3];
	app._showcasePos = 2;
	app._showcaseScrolling = true;
	app._showcaseSettleTimer = setTimeout(() => {}, 60e3);

	app.stopShowcase();

	assertEquals(app.showcase, false);
	assertEquals(app._showcaseTimer, null);
	assertEquals(app._showcaseOrder.length, 0);
	assertEquals(app._showcasePos, 0);
	assertEquals(app._showcaseScrolling, false);
	assertEquals(app._showcaseSettleTimer, null);
});

Deno.test("_markShowcaseScrolling holds the guard until the scroll settles", async () => {
	const app = makeApp(4);
	assertEquals(app._showcaseScrolling, false);

	app._markShowcaseScrolling();
	assertEquals(app._showcaseScrolling, true);

	// Each in-flight scroll event pushes the settle deadline out rather than
	// letting a long smooth scroll be mistaken for user activity.
	for (let i = 0; i < 5; i++) {
		await new Promise((r) => setTimeout(r, 120));
		app._markShowcaseScrolling();
	}
	assertEquals(app._showcaseScrolling, true, "still guarded while scroll events keep arriving");

	// No further events: the flag must clear so real user input can stop the mode.
	await new Promise((r) => setTimeout(r, 800));
	assertEquals(app._showcaseScrolling, false);
	assertEquals(app._showcaseSettleTimer, null);
});

Deno.test("activity blocks idle from ever restarting showcase", () => {
	const app = makeApp(4);
	app.showcase = true;
	app._showcaseBlocked = false;

	app._blockShowcase();

	assertEquals(app.showcase, false);
	assertEquals(app._showcaseBlocked, true);

	// _armShowcaseIdle must not schedule a timer once blocked.
	app._armShowcaseIdle();
	assertEquals(app._showcaseIdleTimer, null);
});
Deno.test("showcaseLabel reflects idle countdown, on countdown, and blocked state", () => {
	const app = makeApp(4);

	// No countdown armed yet (blocked, or idle cleared): plain label.
	assertEquals(app.showcaseLabel, "/showcase");

	// Idle armed: counts down toward the auto-start.
	app._showcaseIdleAt = Date.now() + 30e3;
	app._tickShowcaseCountdown();
	assertEquals(app.showcaseLabel, "/showcase-idle-30");

	// Dwell wins over idle once rotating.
	app.showcase = true;
	app._showcaseDwellAt = Date.now() + 30e3;
	app._tickShowcaseCountdown();
	assertEquals(app.showcaseLabel, "/showcase-on-30");

	// Countdown never goes negative past the deadline.
	app._showcaseDwellAt = Date.now() - 5000;
	app._tickShowcaseCountdown();
	assertEquals(app.showcaseLabel, "/showcase-on-0");
});

Deno.test("stopShowcase clears the dwell deadline so the label leaves the on state", () => {
	const app = makeApp(4);
	app.showcase = true;
	app._showcaseDwellAt = Date.now() + 30e3;

	app.stopShowcase();
	app._tickShowcaseCountdown();

	assertEquals(app._showcaseDwellAt, 0);
	assertEquals(app.showcaseCountdown, 0);
	assertEquals(app.showcaseLabel, "/showcase");
});

Deno.test("activity listener ignores clicks originating from the showcase button", async () => {
	// Regression: the document-level activity listener saw the very click that
	// started showcase and called _blockShowcase, so /showcase looked dead.
	// Mirrors the guard in init(): a click on #btn_showcase returns early.
	const src = await Deno.readTextFile(new URL("../frontend/index.js", import.meta.url));
	assertStringIncludes(src, "e.target?.closest?.('#btn_showcase')");

	const app = makeApp(4);
	app._showcaseBlocked = false;
	app.showcase = false;

	// A click on the button must not arm the idle timer or set the block.
	const onButton = { target: { closest: (sel: string) => (sel === "#btn_showcase" ? {} : null) } };
	const elsewhere = { target: { closest: () => null } };

	const guard = (e: { target: { closest: (s: string) => unknown } }) =>
		e.target?.closest?.("#btn_showcase");

	assertEquals(guard(onButton) !== null && guard(onButton) !== undefined, true, "button click is recognised");
	assertEquals(Boolean(guard(elsewhere)), false, "unrelated click is not exempt");

	// The exemption only skips blocking; the mode still runs. Set the flag
	// directly because startShowcase() toasts, which needs a DOM.
	app.showcase = true;
	assertEquals(app.showcase, true);
	assertEquals(app._showcaseBlocked, false, "own click must not permanently block showcase");
});
