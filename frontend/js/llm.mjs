export async function embeddingText(text) {
	let vector = await fetch(`/embedding?text=${encodeURIComponent(text)}`, {
		headers: {
			'Content-Type': 'application/json'
		},
	}).then(r => r.json()).catch(e => null);

	return vector;
}

