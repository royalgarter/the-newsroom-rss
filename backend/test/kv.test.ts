import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";

// Set environment variables for Cloudflare KV before importing KV module
Deno.env.set('PUBLISH_USE_CLOUDFLAREKV', 'true');
Deno.env.set('CLOUDFLARE_ACCOUNT_ID', 'test_account');
Deno.env.set('CLOUDFLARE_API_TOKEN', 'test_token');
Deno.env.set('CLOUDFLARE_KV_NAMESPACE_ID', 'test_namespace');

// Import KV dynamically
const { default: KV } = await import('../src/kv.ts');

Deno.test("Cloudflare KV - get success", async () => {
	const originalFetch = globalThis.fetch;
	try {
		globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
			const url = input.toString();
			assertEquals(url, "https://api.cloudflare.com/client/v4/accounts/test_account/storage/kv/namespaces/test_namespace/values/profile%3Aabc");
			assertEquals(init?.method, "GET");
			assertEquals((init?.headers as any)?.["Authorization"], "Bearer test_token");
			
			return new Response(JSON.stringify({ username: "test_user" }), { status: 200 });
		};

		const result = await KV.get(['profile', 'abc']);
		assertEquals(result.value, { username: "test_user" });
	} finally {
		globalThis.fetch = originalFetch;
	}
});

Deno.test("Cloudflare KV - get 404 (not found)", async () => {
	const originalFetch = globalThis.fetch;
	try {
		globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
			return new Response("", { status: 404 });
		};

		const result = await KV.get(['profile', 'non_existent']);
		assertEquals(result.value, null);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

Deno.test("Cloudflare KV - set success", async () => {
	const originalFetch = globalThis.fetch;
	try {
		globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
			const url = input.toString();
			assertEquals(url, "https://api.cloudflare.com/client/v4/accounts/test_account/storage/kv/namespaces/test_namespace/values/profile%3Aabc");
			assertEquals(init?.method, "PUT");
			assertEquals(init?.body, JSON.stringify({ username: "test_user" }));
			assertEquals((init?.headers as any)?.["Authorization"], "Bearer test_token");
			assertEquals((init?.headers as any)?.["Content-Type"], "text/plain; charset=utf-8");

			return new Response(JSON.stringify({ success: true }), { status: 200 });
		};

		const result = await KV.set(['profile', 'abc'], { username: "test_user" });
		assertEquals(result.ok, true);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

Deno.test("Cloudflare KV - delete success", async () => {
	const originalFetch = globalThis.fetch;
	try {
		globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
			const url = input.toString();
			assertEquals(url, "https://api.cloudflare.com/client/v4/accounts/test_account/storage/kv/namespaces/test_namespace/values/profile%3Aabc");
			assertEquals(init?.method, "DELETE");
			assertEquals((init?.headers as any)?.["Authorization"], "Bearer test_token");

			return new Response(JSON.stringify({ success: true }), { status: 200 });
		};

		const result = await KV.delete(['profile', 'abc']);
		assertEquals(result.ok, true);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

Deno.test("Cloudflare KV - list success", async () => {
	const originalFetch = globalThis.fetch;
	try {
		let fetchCallCount = 0;
		globalThis.fetch = async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
			fetchCallCount++;
			const url = input.toString();
			if (fetchCallCount === 1) {
				assertEquals(url, "https://api.cloudflare.com/client/v4/accounts/test_account/storage/kv/namespaces/test_namespace/keys?limit=1000&prefix=profile%3A");
				return new Response(JSON.stringify({
					success: true,
					result: [
						{ name: "profile:user1" },
						{ name: "profile:user2" }
					],
					result_info: { cursor: "" }
				}), { status: 200 });
			} else if (fetchCallCount === 2) {
				assertEquals(url, "https://api.cloudflare.com/client/v4/accounts/test_account/storage/kv/namespaces/test_namespace/values/profile%3Auser1");
				return new Response(JSON.stringify({ id: 1 }), { status: 200 });
			} else if (fetchCallCount === 3) {
				assertEquals(url, "https://api.cloudflare.com/client/v4/accounts/test_account/storage/kv/namespaces/test_namespace/values/profile%3Auser2");
				return new Response(JSON.stringify({ id: 2 }), { status: 200 });
			}
			throw new Error("Unexpected fetch call");
		};

		const results = [];
		for await (const entry of KV.list({ prefix: ['profile'] })) {
			results.push(entry);
		}

		assertEquals(results.length, 2);
		assertEquals(results[0], { key: ["profile", "user1"], value: { id: 1 } });
		assertEquals(results[1], { key: ["profile", "user2"], value: { id: 2 } });
	} finally {
		globalThis.fetch = originalFetch;
	}
});
