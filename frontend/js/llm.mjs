export async function embeddingText(text, apiKey) {
	if (apiKey) {
		// Call Google API directly from browser
		const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`;
		let result = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				'model': 'models/gemini-embedding-001',
				'taskType': 'CLUSTERING',
				'content': {
					'parts': [{ text }]
				}
			})
		}).then(r => r.json()).catch(e => {
			console.error('Direct Gemini API Error:', e);
			return null;
		});

		return result?.embedding?.values || null;
	}

	// Fallback to server bridge if no API key in settings
	let headers = {
		'Content-Type': 'application/json'
	};
	let vector = await fetch(`/embedding?text=${encodeURIComponent(text)}`, {
		headers: headers,
	}).then(r => r.json()).catch(e => null);

	return vector;
}

const LLM_TIMEOUT_MS = 60000;
const LLM_GET_MAX_CHARS = 6000; // server bridge is a GET; keep the URL under common proxy limits
const LLM_RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

// Throws Error with `.code`: 'network' | 'timeout' | 'auth' | 'rate' | 'server' | 'blocked' | 'empty' | 'too_large'.
// Returns { text, truncated }.
export async function generateContent(prompt, apiKey, { signal } = {}) {
	const fail = (code, message) => Object.assign(new Error(message), { code });

	if (!apiKey && encodeURIComponent(prompt).length > LLM_GET_MAX_CHARS) {
		throw fail('too_large', 'Prompt too large for the server bridge; add a Gemini API key in settings.');
	}

	const request = () => {
		const timeout = AbortSignal.timeout(LLM_TIMEOUT_MS);
		const merged = signal ? AbortSignal.any([signal, timeout]) : timeout;
		if (apiKey) {
			return fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
				body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
				signal: merged,
			});
		}
		return fetch(`/llm?prompt=${encodeURIComponent(prompt)}`, { signal: merged });
	};

	let response;
	for (let attempt = 0; ; attempt++) {
		try {
			response = await request();
		} catch (e) {
			if (signal?.aborted) throw e;
			throw e?.name === 'TimeoutError' ? fail('timeout', 'The AI took too long to answer.') : fail('network', 'Network error reaching the AI.');
		}
		if (response.ok || !LLM_RETRY_STATUS.has(response.status) || attempt >= 1) break;
		await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
	}

	if (!response.ok) {
		if ([400, 401, 403].includes(response.status)) throw fail('auth', 'The AI rejected the request. Check your Gemini API key in settings.');
		if (response.status === 429) throw fail('rate', 'AI rate limit reached. Try again in a minute.');
		throw fail('server', `AI service error (${response.status}).`);
	}

	const body = await response.json().catch(() => null);
	// Server bridge returns the bare text; direct API returns candidates.
	if (typeof body === 'string') return { text: body, truncated: false };
	if (body?.promptFeedback?.blockReason) throw fail('blocked', 'The AI declined to summarize this content.');
	const candidate = body?.candidates?.[0];
	const text = candidate?.content?.parts?.map(p => p.text || '').join('').trim();
	if (!text) throw fail('empty', 'The AI returned nothing.');
	return { text, truncated: candidate.finishReason === 'MAX_TOKENS' };
}

// DEPRECATED: replaced by hardened generateContent above (swallowed all HTTP errors as null, no timeout).
// export async function generateContent(prompt, apiKey) {
//     if (apiKey) {
//         // Call Google API directly from browser
//         const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`;
//         let result = await fetch(url, {
//             method: 'POST',
//             headers: {
//                 'Content-Type': 'application/json'
//             },
//             body: JSON.stringify({
//                 'contents': [{
//                     'parts': [{ text: prompt }]
//                 }]
//             })
//         }).then(r => r.json()).catch(e => {
//             console.error('Direct Gemini API Error:', e);
//             return null;
//         });
// 
//         return result?.candidates?.[0]?.content?.parts?.[0]?.text || null;
//     }
// 
//     // Fallback to server bridge if no API key in settings
//     let headers = {
//         'Content-Type': 'application/json'
//     };
//     let text = await fetch(`/llm?prompt=${encodeURIComponent(prompt)}`, {
//         headers: headers,
//     }).then(r => r.json()).catch(e => null);
// 
//     return text;
// }
