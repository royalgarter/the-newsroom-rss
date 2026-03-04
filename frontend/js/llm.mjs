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

export async function generateContent(prompt, apiKey) {
    if (apiKey) {
        // Call Google API directly from browser
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
        let result = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                'contents': [{
                    'parts': [{ text: prompt }]
                }]
            })
        }).then(r => r.json()).catch(e => {
            console.error('Direct Gemini API Error:', e);
            return null;
        });

        return result?.candidates?.[0]?.content?.parts?.[0]?.text || null;
    }

    // Fallback to server bridge if no API key in settings
    let headers = {
        'Content-Type': 'application/json'
    };
    let text = await fetch(`/llm?prompt=${encodeURIComponent(prompt)}`, {
        headers: headers,
    }).then(r => r.json()).catch(e => null);

    return text;
}

