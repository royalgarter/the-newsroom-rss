// Tripwire for [Preview] / [Share] hardening.
// Run: deno test -A tests/preview-share.test.ts
import { assertEquals, assertStringIncludes, assert } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.45/deno-dom-wasm.ts";

// deno-lint-ignore no-explicit-any
const g: any = globalThis;
g.DOMParser = DOMParser;
g.location = new URL("https://newsrss.org/");
const toasts: string[] = [];
const box = { classList: { add() {}, remove() {} }, set textContent(m: string) { toasts.push(m); } };
g.document = { getElementById: () => box };

const src = await Deno.readTextFile(new URL("../frontend/index.js", import.meta.url));
// deno-lint-ignore no-explicit-any
const f: any = new Function(src + "\n;return { alpineRSS, sanitizeArticle, safeHttpUrl, fetchArticle };")();

Deno.test("sanitizeArticle strips handlers, iframes, scripts and javascript: urls", () => {
	const out = f.sanitizeArticle(
		`<p onclick="x()">hi</p><img src="x" onerror="alert(1)"><img src="https://a.b/c.png" alt="ok">` +
		`<iframe srcdoc="<script>alert(1)</script>"></iframe><script>alert(1)</script>` +
		`<a href="javascript:alert(1)">bad</a><a href="https://ok.com/">good</a><input onfocus="x()">`,
	);
	for (const bad of ["onclick", "onerror", "iframe", "script", "javascript:", "onfocus", "<input"]) {
		assert(!out.includes(bad), `leaked ${bad}: ${out}`);
	}
	assertStringIncludes(out, 'src="https://a.b/c.png"');
	assertStringIncludes(out, 'href="https://ok.com/"');
	assertStringIncludes(out, "bad");
});

Deno.test("safeHttpUrl accepts http(s) only", () => {
	assertEquals(f.safeHttpUrl("https://a.com/x"), "https://a.com/x");
	assertEquals(f.safeHttpUrl("javascript:alert(1)"), null);
	assertEquals(f.safeHttpUrl("data:text/html,hi"), null);
});

Deno.test("prefetchContent clears state when the network fails", async () => {
	g.fetch = () => Promise.reject(new TypeError("offline"));
	const app = f.alpineRSS();
	const store = new Map();
	app.storageGet = (k: string) => store.get(k);
	app.storageSet = (k: string, v: unknown) => store.set(k, v);
	assertEquals(await f.fetchArticle("https://a.com/x", app), null);
	assertEquals(store.size, 0, "transient failure must not mark host as noClientFetch");
	assertEquals(await f.fetchArticle("not a url", app), null);
});

Deno.test("shareItem toasts the real outcome and never opens a tab", async () => {
	g.window = { open: () => { throw new Error("must not open a tab"); } };
	const app = f.alpineRSS();

	toasts.length = 0;
	await app.shareItem({ link: "javascript:alert(1)" });
	assertStringIncludes(toasts[0], "invalid");

	Object.defineProperty(g, "navigator", { value: { clipboard: { writeText: () => Promise.reject(new Error("denied")) } }, configurable: true });
	toasts.length = 0;
	await app.shareItem({ link: "https://a.com/x" });
	assertStringIncludes(toasts[0], "Copy failed");

	Object.defineProperty(g, "navigator", { value: { clipboard: { writeText: () => Promise.resolve() } }, configurable: true });
	toasts.length = 0;
	await app.shareItem({ link: "https://a.com/x", article: { content: "<p>x</p>" } });
	assertStringIncludes(toasts[0], "Copied: https://newsrss.org/?f=single_view&u=");
});

Deno.test("fetchArticle falls back to /html proxy when direct fetch is blocked (CORS)", async () => {
	const seen: string[] = [];
	g.Readability = class { parse() { return { title: "T", content: "<p>body</p>" }; } };
	g.fetch = (u: string) => {
		seen.push(String(u));
		return String(u).startsWith("/html") ? Promise.resolve(new Response("<html><body><p>x</p></body></html>")) : Promise.reject(new TypeError("CORS"));
	};
	const app = f.alpineRSS();
	app.storageGet = () => undefined;
	app.storageSet = () => {};
	const art = await f.fetchArticle("https://www.theguardian.com/a", app);
	assertEquals(art?.content, "<p>body</p>");
	assert(seen.some((u) => u.startsWith("/html?u=")));
});
