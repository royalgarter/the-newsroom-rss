
importScripts('https://cdn.jsdelivr.net/npm/minisearch@7.1.1/dist/umd/index.min.js');
importScripts('/js/tiny-tfidf.min.js');

self.onmessage = async function(e) {
	const { items, method } = e.data;
	let result;
	
	if (method === 'minisearch') {
		result = clusterWithMiniSearch(items);
	} else if (method === 'tfidf') {
		result = clusterWithTFIDF(items);
	} else if (method === 'gemini') {
		result = clusterWithGemini(items);
	}
	
	self.postMessage(result);
};

function clusterWithMiniSearch(items) {
	const stats = { method: 'minisearch', clusters: 0, hidden: 0 };
	const miniSearch = new MiniSearch({
		fields: ['title', 'description'],
		storeFields: ['link'],
		searchOptions: {
			boost: { title: 2 },
			fuzzy: 0.2,
			prefix: true,
			combineWith: 'OR'
		}
	});

	miniSearch.addAll(items.map((item, idx) => ({
		id: idx,
		title: item.title,
		description: item.description,
		link: item.link
	})));

	const processed = new Set();
	const SIMILARITY_RATIO = 0.2;
	const clusterMap = {};

	for (let i = 0; i < items.length; i++) {
		if (processed.has(i)) continue;
		
		const item = items[i];
		const query = (item.title + item.description) || item.title.replace(/[^\w\s]/g, '').split(/\s+/)
						.filter(word => word.length > 3)
						.join(' ');
		
		if (!query) continue;

		const selfResults = miniSearch.search(query);
		const maxScore = selfResults.find(r => r.id === i)?.score || selfResults[0]?.score || 1;

		const results = miniSearch.search(query, {
			filter: (result) => !processed.has(result.id)
		});

		const currentClusterIndices = [i];
		processed.add(i);

		results.forEach(res => {
			if (res.score > (maxScore * SIMILARITY_RATIO) && res.id !== i) {
				currentClusterIndices.push(res.id);
				processed.add(res.id);
			}
		});

		if (currentClusterIndices.length > 1) {
			const clusterData = applyCluster(items, currentClusterIndices);
			clusterMap[clusterData.primaryIdx] = clusterData.relatedSources;
			stats.clusters++;
			stats.hidden += clusterData.relatedSources.length;
		}
	}

	return { clusterMap, stats };
}

function clusterWithTFIDF(items) {
	const stats = { method: 'tfidf', clusters: 0, hidden: 0 };
	const corpus = new TinyTFIDF.Corpus(
		items.map((_, i) => i.toString()),
		items.map(item => `${item.title} ${item.description}`)
	);

	const processed = new Set();
	const SIMILARITY_THRESHOLD = 0.33;
	const clusterMap = {};

	for (let i = 0; i < items.length; i++) {
		if (processed.has(i)) continue;
		
		const currentClusterIndices = [i];
		processed.add(i);

		for (let j = i + 1; j < items.length; j++) {
			if (processed.has(j)) continue;

			const vecA = corpus.getDocumentVector(i.toString());
			const vecB = corpus.getDocumentVector(j.toString());
			const similarity = TinyTFIDF.Similarity.cosineSimilarity(vecA, vecB);

			if (similarity > SIMILARITY_THRESHOLD) {
				currentClusterIndices.push(j);
				processed.add(j);
			}
		}

		if (currentClusterIndices.length > 1) {
			const clusterData = applyCluster(items, currentClusterIndices);
			clusterMap[clusterData.primaryIdx] = clusterData.relatedSources;
			stats.clusters++;
			stats.hidden += clusterData.relatedSources.length;
		}
	}

	return { clusterMap, stats };
}

function clusterWithGemini(items) {
	const stats = { method: 'gemini', clusters: 0, hidden: 0 };
	const itemsWithVector = items.filter(x => x.vector);
	if (itemsWithVector.length < 2) return { clusterMap: {}, stats };

	// Map indices of items with vectors back to original indices
	itemsWithVector.forEach((item, idx) => item._originalIdx = items.indexOf(item));

	const vectorSize = itemsWithVector[0].vector.length;
	itemsWithVector.forEach(item => {
		let mag = 0;
		for (let v of item.vector) mag += v * v;
		mag = Math.sqrt(mag) || 1;
		item.normVec = new Float32Array(vectorSize);
		for (let k = 0; k < vectorSize; k++) item.normVec[k] = item.vector[k] / mag;
	});

	const SIMILARITY_THRESHOLD = 0.15;
	const MIN_SIMILARITY = 1 - SIMILARITY_THRESHOLD;
	const processed = new Set();
	const clusterMap = {};

	for (let i = 0; i < itemsWithVector.length; i++) {
		if (processed.has(i)) continue;
		
		const currentClusterIndices = [itemsWithVector[i]._originalIdx];
		processed.add(i);
		const vecA = itemsWithVector[i].normVec;

		for (let j = i + 1; j < itemsWithVector.length; j++) {
			if (processed.has(j)) continue;

			const vecB = itemsWithVector[j].normVec;
			let dotProduct = 0;
			for (let k = 0; k < vectorSize; k++) dotProduct += vecA[k] * vecB[k];
			
			if (dotProduct > MIN_SIMILARITY) {
				currentClusterIndices.push(itemsWithVector[j]._originalIdx);
				processed.add(j);
			}
		}

		if (currentClusterIndices.length > 1) {
			const clusterData = applyCluster(items, currentClusterIndices);
			clusterMap[clusterData.primaryIdx] = clusterData.relatedSources;
			stats.clusters++;
			stats.hidden += clusterData.relatedSources.length;
		}
	}

	return { clusterMap, stats };
}

function applyCluster(items, indices) {
	// Sort items in cluster by date (earliest first)
	indices.sort((a, b) => new Date(items[a].published) - new Date(items[b].published));

	const primaryIdx = indices[0];
	const relatedSources = indices.slice(1).map(idx => {
		const item = items[idx];
		return {
			idx: idx,
			title: item.title,
			link: item.link,
			source: item.author || item.hostname
		};
	});
	
	return { primaryIdx, relatedSources };
}
