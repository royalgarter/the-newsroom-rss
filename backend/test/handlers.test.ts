import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { handleIndex, handleStatic } from "../src/handlers.ts";

const fileUrl = (path: string) => new Request(`http://localhost${path}`);

Deno.test("handleIndex revalidates HTML with ETag instead of a week-long cache", async () => {
	const first = await handleIndex(fileUrl("/"));
	assertEquals(first!.status, 200);
	assertEquals(first!.headers.get("Cache-Control"), "no-cache");
	const etag = first!.headers.get("ETag");
	assertEquals(etag !== null && etag.startsWith('W/"'), true);

	const revalidated = await handleIndex(new Request("http://localhost/", {
		headers: { "If-None-Match": etag! },
	}));
	assertEquals(revalidated!.status, 304);
	assertEquals(revalidated!.body, null);
});

Deno.test("handleStatic sends no charset on binary types", async () => {
	const png = await handleStatic(fileUrl("/default-profile-64x64.png"));
	assertEquals(png!.headers.get("Content-Type"), "image/png");

	const ico = await handleStatic(fileUrl("/favicon.ico"));
	assertEquals(ico!.headers.get("Content-Type"), "image/x-icon");
});

Deno.test("handleStatic keeps charset and week-long cache on versioned JS assets", async () => {
	const js = await handleStatic(fileUrl("/index.js"));
	assertEquals(js!.headers.get("Content-Type"), "text/javascript; charset=utf-8");
	assertEquals(js!.headers.get("Cache-Control"), "public, max-age=604800");
});

Deno.test("handleStatic revalidates .html with ETag", async () => {
	const first = await handleStatic(fileUrl("/index.html"));
	assertEquals(first!.headers.get("Cache-Control"), "no-cache");
	const etag = first!.headers.get("ETag")!;

	const revalidated = await handleStatic(new Request("http://localhost/index.html", {
		headers: { "If-None-Match": etag },
	}));
	assertEquals(revalidated!.status, 304);
});