const VERSION = 'v2';

function alpineHead() { return {
	title: 'The Newsroom RSS',
	description: 'We just decided: The first step in fixing the world is to Be Informed. Get curated news, delivered your way: fast, personalized RSS.',
	host: 'https://newsrss.org',
}};

function alpineRSS() { return {
	title: 'The Newsroom RSS',
	version: VERSION,

	dark: false,
	ready: false,
	pioneer: false,

	burger_open: false,
	burger_sub_cat_open: true,

	readlater: {},

	feeds: [],
	is_hide_feeds: false,

	loading: false,
	loadingPercent: 0,
	loadingFraction: '1/10',
	loadingBookmarks: false,

	linkToItemMap: new Map(),
	viewedItemsCache: {},

	debug: null,
	params: {
		l: 6,
		s: 'full',
	},

	input: '',
	tasks: [],
	drag: null,
	drop: null,

	noteTitle: '',
	noteContent: '',
	editingNote: null,
	editedTitle: '',
	editedContent: '',
	easyMDE: null,

	addNote() {
		if (!this.noteTitle.trim()) {
			this.noteTitle = 'note_at_' + new Date().toLocaleString().replace(/\W+/g, '-');
		}

		let description = (this.easyMDE?.value() || this?.noteContent || document.getElementById('noteContent')?.value || '').trim();

		if (!this.noteTitle.trim() || !description) {
			toast('Please enter a title and content for the note.');
			return;
		}

		const newNote = {
			link: `/#note_${Date.now()}`,
			title: this.noteTitle.trim(),
			description: description.substr(0, 200),
			published: new Date().toISOString(),
			saved_at: new Date().toISOString(),
			read_later: false,
			is_note: true, // Flag to identify it as a note
			title_formatted: this.decodeHTML(this.noteTitle.trim()).substr(0, 150),
			published_formatted: this.timeSince(new Date()),
			article: {content: description}
		};

		let readLaterItems = this.storageGet(this.K.readlater) || [];
		readLaterItems.unshift(newNote); // Add to the beginning of the list

		this.readlater = { items: readLaterItems };
		this.storageSet(this.K.readlater, readLaterItems);

		this.saveReadLater(newNote).then(_ => this.loadReadLaterItems());

		this.noteTitle = '';
		this.noteContent = '';

		this.easyMDE?.toTextArea?.();
		easyMDE = null;

		toast('Note saved successfully.');
	},

	addNoteMarkdown() {
		this.easyMDE = this.easyMDE || new EasyMDE({
			element: document.getElementById('noteContent'),
			lineNumbers: true,
			unorderedListStyle: "-",
			spellChecker: false,
			nativeSpellcheck: false,
		});
	},

	editNote(note, is_markdown) {
		note.loading = true;
		fetch(`/api/readlater?x=${this.params.x}&sig=${this?.profile?.signature || ''}&link=${encodeURIComponent(note.link)}`)
			.then(r => r.json())
			.then(article => {
				note.loading = false;
				note.article = article;

				note.description = note.article.content;

				this.editingNote = note;
				this.editedTitle = note.title;
				this.editedContent = note.description;
			})
			.catch(e => note.loading = false)
	},

	updateNote() {
		let description = (this.easyMDE?.value() || this?.editedContent || document.getElementById('editedContent')?.value || '').trim();

		if (!this.editedTitle.trim() || !description) {
			toast('Please enter a title and content for the note.');
			return;
		}

		let readLaterItems = this.storageGet(this.K.readlater) || [];
		const index = readLaterItems.findIndex(item => item.link === this.editingNote.link);

		if (index !== -1) {
			readLaterItems[index].read_later = false;
			readLaterItems[index].title = this.editedTitle.trim();
			readLaterItems[index].description = description.substr(0, 200);
			readLaterItems[index].title_formatted = this.decodeHTML(this.editedTitle.trim()).substr(0, 150);
			readLaterItems[index].article = {content: description}

			this.readlater = { items: readLaterItems };
			this.storageSet(this.K.readlater, readLaterItems);

			this.saveReadLater(readLaterItems[index]).then(_ => this.loadReadLaterItems());
		}

		this.editingNote = null;
		this.editedTitle = '';
		this.editedContent = '';

		this.easyMDE?.toTextArea?.();
		this.easyMDE = null;

		toast('Note updated successfully.');
	},

	updateNoteMarkdown() {
		this.easyMDE = this.easyMDE || new EasyMDE({
			element: document.getElementById('editedContent'),
			lineNumbers: true,
			unorderedListStyle: "-",
			spellChecker: false,
			nativeSpellcheck: false,
		});
	},

	is_noimg: false,

	review_feed: null,

	style() { return {...this.style_flags[this.params?.s || 'full'], s: this.params?.s}; },
	style_flags: {
		full: {title: 1, desc: 1, img: 1, preview: 1},
		tiny: {title: 1, desc: 0, img: 0, preview: 0},
		title: {title: 1, desc: 0, img: 1, preview: 0},
		noimg: {title: 1, desc: 1, img: 0, preview: 1},
		nopreview: {title: 1, desc: 1, img: 1, preview: 0},
	},

	google: null,
	profile: null,
	persona: null,
	editor_options: null,

	modal_showed: false,
	modal_result: null,
	modal_title: 'title',
	modal_text: 'text',
	modal_ok: 'OK',
	modal_cancel: 'Cancel',
	modal_callback: null,
	modalShow(title, text, ok='OK', cancel='Cancel', callback=console.log) {
		this.modal_title = title;
		this.modal_text = text;
		this.modal_ok = ok;
		this.modal_cancel = cancel;
		this.modal_callback = callback;
		this.modal_showed = true;
	},
	modalCallback(e) {
		this.modal_result = e;
		this.modal_callback?.(e);
		this.modal_showed = false;
	},

	K: {
		LIMIT: 6,

		DEFAULTS: [
			`https://news.google.com/rss?hl=${navigator.language}`,
			'https://feeds.bbci.co.uk/news/rss.xml',
			'https://feeds.nbcnews.com/feeds/topstories',
			'https://www.business-standard.com/rss/latest.rss',
			'https://feeds.npr.org/1128/rss.xml',
			'https://www.espn.com/espn/rss/news',
		],

		CATEGORIES: [
			{"name": "Top Stories", "desc": "This is the main, curated feed highlighting the most important news of the moment."},
			{"name": "World", "desc": "International news from across the globe."},
			{"name": "Local", "desc": "News specific to your current location or a location you specify."},
			{"name": "Business", "desc": "Financial news, market updates, and business trends."},
			{"name": "Technology", "desc": "Coverage of the tech industry, gadgets, and innovation."},
			{"name": "Entertainment", "desc": "News about movies, music, celebrities, and pop culture."},
			{"name": "Sports", "desc": "Coverage of various sports, including scores, highlights, and analysis."},
			{"name": "Science", "desc": "News and discoveries in the world of science."},
			{"name": "Health", "desc": "Articles about health, medicine, and wellness."},
			{"name": "Crypto", "desc": "Breaking news about Bitcoin, Blockchain, Crypto Currency, Tokens, DeFi."},
			{"name": "AI", "desc": "Latest artificial intelligence news and insights. Explore industry trends from the frontline of AI."},
		],

		embedding: VERSION + '_embedding_',
		viewed: VERSION + '_viewed_',
		tasks: VERSION + '_tasks_',
		feeds: VERSION + '_feeds_',
		cache: VERSION + '_cache_',
		hash: VERSION + '_hash_',
		style: VERSION + '_style_',
		profile: VERSION + '_profile_',
		readlater: VERSION + '_readlater_',

		noClientFetch: VERSION + '_ncf_',

		persona: VERSION + '_persona_',
	},

	TRIGGER: {
		LIMIT: 12e3, // time to read article
	},

	CACHE: {},

	storageSet(key, val) {
		return localStorage.setItem(key, JSON.stringify(val));
	},
	storageGet(key) {
		return JSON.parse(localStorage.getItem(key) || null);
	},
	storageDel(key) {
		return localStorage.removeItem(key);
	},

	theTitle() {
		const BREAKS = [
			"We'll be right back...",
			"We'll be back in a moment...",
			"We'll be back in 30s...",
			"Back in 5s! 5... 4... 3... 2...",
			"More after the break...",
			"Stay with us...",
		];

		const capitalize = s => s && String(s[0]).toUpperCase() + String(s).slice(1);

		let now = new Date();

		let hour = now.getHours();

		if (this.loading) return BREAKS[Math.floor(Math.random()*BREAKS.length)];

		if (hour >= 20 && hour <=21) {
			if (!this.dark) this.toggleDarkMode();

			return 'News Night' + (this.params?.x ? ` with Mc${capitalize(this.params.x)}` : '');
		}

		return 'The Newsroom' + (this.params?.x ? ` #${this.params.x}` : ' RSS');
	},

	async testLLM() {
		let list_sentences = [
			'Will it snow tomorrow?',
			'Recently a lot of hurricanes have hit the US',
			'Global warming is real',

			'An apple a day, keeps the doctors away',
			'Eating strawberries is healthy',

			'what is your age?',
			'How old are you?',
			'How are you?',

			'The dog bit Johnny',
			'Johnny bit the dog',

			'The cat ate the mouse',
			'The mouse ate the cat',
		];
		this.get_embeddings(list_sentences, (embeddings) => {
			let matrix = this.cosine_similarity_matrix(embeddings);

			console.log(embeddings)
			console.log(matrix)
		});
	},
	get_embeddings(list_sentences, callback) {
		use.load().then(model => {
			model.embed(list_sentences).then(embeddings => {
				callback(embeddings?.arraySync?.());
			});
		});
	},
	dot(a, b) {
		var hasOwnProperty = Object.prototype.hasOwnProperty;
		var sum = 0;
		for (var key in a) {
			if (hasOwnProperty.call(a, key) && hasOwnProperty.call(b, key)) {
				sum += a[key] * b[key]
			}
		}
		return sum
	},
	similarity(a, b) {
		var magnitudeA = Math.sqrt(this.dot(a, a));
		var magnitudeB = Math.sqrt(this.dot(b, b));
		if (magnitudeA && magnitudeB)
			return this.dot(a, b) / (magnitudeA * magnitudeB);
		else return false
	},
	cosine_similarity_matrix(matrix) {
		let cosine_similarity_matrix = [];
		for (let i = 0; i < matrix.length; i++) {
			let row = [];
			for (let j = 0; j < i; j++) {
				row.push(cosine_similarity_matrix[j][i]);
			}
			row.push(1);
			for (let j = (i + 1); j < matrix.length; j++) {
				row.push(this.similarity(matrix[i], matrix[j]));
			}
			cosine_similarity_matrix.push(row);
		}
		return cosine_similarity_matrix;
	},
	calculateMeanVector(vectors) {
		if (!vectors || vectors.length === 0) {
			return null; // Handle empty input
		}

		const numVectors = vectors.length;
		const vectorLength = vectors[0].length;

		// Check for consistent vector lengths and valid data types
		for (let i = 1; i < numVectors; i++) {
			if (vectors[i].length !== vectorLength) {
				return null; // Handle inconsistent vector lengths
			}
		}

		for (let i = 0; i < numVectors; i++) {
			for (let j = 0; j < vectorLength; j++) {
				if (typeof vectors[i][j] !== 'number' || isNaN(vectors[i][j])) {
					return null; // Handle non-numeric data
				}
			}
		}

		// Calculate the sum of each component
		const sumVector = new Array(vectorLength).fill(0);
		for (let i = 0; i < numVectors; i++) {
			for (let j = 0; j < vectorLength; j++) {
				sumVector[j] += vectors[i][j];
			}
		}

		// Calculate the mean for each component
		const meanVector = sumVector.map(sum => sum / numVectors);

		return meanVector;
	},
	updateMeanVector(mean, numVectors, newVector, weight=1) {
		if (!mean || numVectors <= 0 || !newVector ) {
			console.log('Handle invalid input')
			return null;
		}

		const vectorLength = mean.length;

		if (newVector.length !== vectorLength) {
			console.log('Handle inconsistent vector lengths', newVector.length, vectorLength, mean)
			return null;
		}

		// Check for valid data types (numbers) in mean and newVector
		for (let i = 0; i < vectorLength; i++) {
			if (typeof mean[i] !== 'number' || isNaN(mean[i])
				|| typeof newVector[i] !== 'number' || isNaN(newVector[i])) {
				console.log('Handle non-numeric data')
				return null;
			}
		}

		const newNumVectors = numVectors + weight;
		const updatedMean = mean.map((meanComponent, index) => {
			return ((meanComponent * numVectors) + (newVector[index] * weight)) / newNumVectors;
		});

		return updatedMean;
	},

	initializeIntersectionObservers() {
		return console.log('initializeIntersectionObservers.disabled');

		// const feedObserver = new IntersectionObserver((entries, observer) => {
		// 	entries.forEach(entry => {
		// 		if (entry.isIntersecting) {
		// 			const feedIndex = parseInt(entry.target.dataset.feedIndex, 10);
		// 			const feed = this.feeds[feedIndex];
		// 			if (feed) {
		// 				feed.items.forEach(item => item.prefetchContent?.());
		// 				if (this.feeds[feedIndex + 1]) {
		// 					this.feeds[feedIndex + 1].items.forEach(item => item.prefetchContent?.());
		// 				}
		// 			}
		// 			observer.unobserve(entry.target);
		// 		}
		// 	});
		// }, { threshold: 0.1 });

		const itemObserver = new IntersectionObserver((entries) => {
			entries.forEach(entry => {
				const link = entry.target.dataset.link;
				if (entry.isIntersecting) {
					if (entry.intersectionRatio >= 1.0) {
						this.triggerIntersect('full', link);
					} else {
						this.triggerIntersect('enter', link);
					}
				} else {
					this.triggerIntersect('leave', link);
				}
			});
		}, { threshold: [0, 1.0], rootMargin: '-10% 0% -10% 0%' });

		this.$watch('feeds', () => {
			this.$nextTick(() => {
				// document.querySelectorAll('.rss-feed').forEach((el, index) => {
				// 	el.dataset.feedIndex = index;
				// 	feedObserver.observe(el);
				// });
				document.querySelectorAll('.rss-item').forEach(el => {
					const link = el.querySelector('a.rss-title')?.href;
					if (link) {
						el.dataset.link = link;
						itemObserver.observe(el);
					}
				});
			});
		});

		// Save viewed items every 5 seconds
		setInterval(() => {
			this.saveViewedItemsCache();
		}, 5e3);
	},
	triggerIntersect(type, link) {
		if (!link) return console.log('ELINK');

		let trig = this.TRIGGER[link] || {};
		let now = new Date();
		const item = this.linkToItemMap.get(link);

		switch (type) {
			case 'full':
				trig.tic = Math.min(now, trig.tic || now);
				if (!this.loading && window.innerWidth <= 640 && item) {
					const url = new URL(location.href);
					url.searchParams.set('a', item.anchor || item.link);
					history.replaceState(null, '', url.toString());
				}
			break;
			case 'leave':
				trig.toc = Math.max(now, trig.toc || now);

				if (trig.tic && trig.toc) {
					let delta = trig.toc - trig.tic;
					trig.sum = trig.sum || 0;
					trig.sum += delta;

					if (trig.sum > this.TRIGGER.LIMIT) {
						const viewedAt = now.toString().split(' GMT').shift();
						this.viewedItemsCache[link] = viewedAt;
						if (item) {
							item.viewed = viewedAt;
						}
					} else {
						trig.tic = trig.toc;
					}
				}
			break;
		}

		this.TRIGGER[link] = trig;
	},

	// Periodically save viewed items from cache to localStorage
	saveViewedItemsCache() {
		for (const link in this.viewedItemsCache) {
			if (Object.hasOwnProperty.call(this.viewedItemsCache, link)) {
				this.storageSet(this.K.viewed + link, this.viewedItemsCache[link]);
			}
		}
		this.viewedItemsCache = {}; // Clear cache after saving
	},

	async saveReadLater(item, is_remove) {
		if (!item || !item.link) return;

		item.read_later = !item.read_later;

		try {
			let readLaterItems = this.storageGet(this.K.readlater) || [];

			// console.log(readLaterItems, item.read_later)

			if (!is_remove && item.read_later) {
				// Save to local storage first for immediate feedback

				let obj = {
					link: item.link,
					title: item.title,
					description: item.description,
					published: item.published,
					image_thumb: item.image_thumb,
					feed_title: this.feeds.find(f => f.items.includes(item))?.title || '',
					saved_at: new Date().toISOString(),
					read_later: item.read_later,
					is_note: item.is_note,
					article: {
						title: item.article?.title,
						content: item.article?.content,
					}
				}

				obj.published_formatted = this.timeSince(new Date(obj.published || undefined));
				obj.title_formatted = this.decodeHTML(obj.title).substr(0, 150);
				obj.description_formatted = obj.description ? this.decodeHTML(obj.description) : '';
				obj.author_formatted_short = obj.author?.toString().substr(0, 12).trim();

				let idx = readLaterItems.findIndex(i => i.link === item.link);
				if (idx < 0) {
					readLaterItems.push(obj);
				} else {
					readLaterItems[idx] = {...readLaterItems[idx], ...obj};
				}

				readLaterItems.sort((a, b) => b.saved_at.localeCompare(a.saved_at));
				this.readlater = {items: readLaterItems};
				this.storageSet(this.K.readlater, readLaterItems);

				// console.dir({obj})

				// Save to Deno KV
				if (this.params.x) {
					await fetch('/api/readlater', {
						method: 'POST',
						headers: {"content-type": "application/json"},
						body: JSON.stringify({
							action: 'save',
							x: this.params.x,
							sig: this?.profile?.signature || '',
							item: obj,
						})
					}).catch(err => console.error('Failed to save to KV:', err));
				}
			} else {
				// Remove from local storage
				let THIS = this;
				THIS.modalShow('Confirm', `[Irreversible Action] Remove bookmark:  ${item.link}`, null, null, (e) => {
					if (!e) return;

					readLaterItems = readLaterItems.filter(i => i.link !== item.link);
					readLaterItems.sort((a, b) => b.saved_at.localeCompare(a.saved_at));
					readLaterItems.forEach(x => x.read_later = true);

					THIS.readlater = {items: readLaterItems};
					THIS.storageSet(THIS.K.readlater, readLaterItems);

					// Remove from Deno KV
					if (THIS.params.x) {
						fetch('/api/readlater', {
							method: 'DELETE',
							headers: {"content-type": "application/json"},
							body: JSON.stringify({
								x: THIS.params.x,
								sig: THIS?.profile?.signature || '',
								link: item.link
							})
						}).then().catch(err => console.error('Failed to remove from KV:', err));
					}
				});
			}
		} catch (error) {
			console.error("Error saving read later item:", error);
			item.read_later = !item.read_later; // Revert the state if there's an error
		}
	},

	async loadReadLaterItems() {
		if (this.loadingBookmarks) return;

		this.loadingBookmarks = true;
		// console.log('loadReadLaterItems')

		// Load from local storage first
		let readLaterItems = this.storageGet(this.K?.readlater) || this.readlater?.items || [];

		// If user is identified, try to load from Deno KV
		try {
			let hamburger_cates = [...new Set([...document.querySelectorAll('#menu_burger ul li a')].map(x => new URL(x.href).searchParams.get('x')))] || [];

			if (this.params.x && !hamburger_cates.includes(this.params.x)) {
				const response = await fetch(`/api/readlater?x=${this.params.x}&sig=${this?.profile?.signature || ''}`);
				if (response.ok) {
					const kvItems = await response.json();

					// Merge items from KV with local storage, prioritizing KV
					if (Array.isArray(kvItems)) {
						// Remove local items that aren't in KV
						readLaterItems = kvItems;

						// Update local storage
						this.storageSet(this.K.readlater, readLaterItems);
					}
				} else {
					this.loadingBookmarks = false;
				}
			}
		} catch (error) {
			console.error("Error loading read later items from KV:", error);
			this.loadingBookmarks = false;
		}

		readLaterItems.sort((a, b) => b.saved_at.localeCompare(a.saved_at));
		readLaterItems.forEach(item => {
			if (item.published) item.published_formatted = this.timeSince(new Date(item.published));
			item.title_formatted = this.decodeHTML(item.title).substr(0, 150);
			item.description_formatted = (item.description ? this.decodeHTML(item.description) : '').substr(0, 1000);
			item.author_formatted_short = item.author?.toString().substr(0, 12).trim();

			item.loadArticle = (is_toggle) => {
				let found = this.readlater.items.find(x => x.link == item.link);

				if (!found) return;

				if (found.article?.content) {
					found.loading = false;
					// if (is_toggle) found.read_more = !found.read_more;
					return;
				}

				if (found.loading) return;

				found.loading = true;
				fetch(`/api/readlater?x=${this.params.x}&sig=${this?.profile?.signature || ''}&link=${encodeURIComponent(found.link)}`)
					.then(r => r.json())
					.then(article => {
						found.loading = false;
						found.article = article;
						// if (is_toggle) found.read_more = !found.read_more;
					})
					.catch(e => found.loading = false)
			}
		});
		this.readlater = {items: readLaterItems};

		// Mark items in feeds as read_later if they're in the readLaterItems list
		this.feeds.forEach(feed => {
			feed.items.forEach(item => {
				item.read_later = readLaterItems.some(savedItem => savedItem.link === item.link);

				if (item?.article?.content?.search?.(/\{.*error.*E40.*\}/) >= 0) item.article = null;
			});
		});

		this.loadingBookmarks = false;

		console.log('loadReadLaterItems done');

		toast('Bookmarks loaded');
	},

	async loadFeedsWithContent({limit=this.K.LIMIT, limit_adjust=this.K.LIMIT, init_urls, force_update}) {
		return this.loadFeedsWithContentV2({limit, limit_adjust, init_urls, force_update});

		if (this.is_hide_feeds) return;

		if (this.loading && !force_update) return;

		this.loading = true;

		console.log('loadFeedsWithContent', limit, limit_adjust);

		try {
			this.loadingPercent = 0;
			let step = 0;

			let urls = init_urls || (this.params?.u?.length ? this.params?.u?.split(',') : this.tasks?.map(x => x.url));

			let sig = this?.profile?.signature || '';

			// console.time('>> load.tasks')
			let resp_tasks = force_update ? null : await fetch(`/api/feeds?is_tasks=true&x=${this.params.x || ''}&log=gettasks&sig=${sig}`, {
				method: 'GET',
				headers: {"content-type": "application/json"},
				signal: AbortSignal.timeout(20e3),
			})
			.then(resp => resp.json())
			.catch(null);
			// console.timeEnd('>> load.tasks')
			toast('RSS list loaded');

			if (resp_tasks?.feeds?.length) {
				this.tasks = resp_tasks?.feeds;
				urls = resp_tasks?.feeds?.map?.(x => x.url) || urls;
			} else if (!this.feeds?.length && this.tasks?.length) {
				urls = this.tasks.map(x => x.url);
			} else if (!this.tasks?.length) {
				urls = this.K.DEFAULTS;
			} else {
			}

			step = 0.2 / (urls?.length || 1);
			// console.time('>> load.rss_client_side')
			let data = urls?.length ? await Promise.allSettled(urls.map(url => new Promise(resolve => {
				if (force_update) {
					this.loadingPercent += step;
					return resolve({url});
				}

				let key_nofetch = this.K.noClientFetch + new URL(url).hostname;

				if (this.pioneer || this.storageGet(key_nofetch)) {
					this.loadingPercent += step;
					return resolve({url});
				}

				// console.time('>> load.rss_client_side.url.' + url);
				try {
					fetch(url.replaceAll(' ', '+'), {redirect: 'follow', signal: AbortSignal.timeout(3e3)})
						.then(resp => resp.text())
						.then(content => resolve({url, content}))
						.catch(ex => {
							this.storageSet(key_nofetch, true);

							this.loadingPercent += step;
							resolve({url});
						})
				} catch (ex) {
					this.storageSet(key_nofetch, true);
					this.loadingPercent += step;
					resolve({url})
				}

				// console.timeEnd('>> load.rss_client_side.url.' + url);
			}))) : [];
			// console.timeEnd('>> load.rss_client_side');
			toast('RSS list prefetched');

			data = data.map(x => x.value);

			// console.dir({urls, data})

			if (!this.params?.x && data.length) {
				let hash_local = await this.digest(JSON.stringify(data) + Date.now());
				this.params.x = hash_local.slice(0, 6);
				this.storageSet(this.K.hash, this.params.x);
			}

			// console.log('datas:', data.length);
			// console.time('>> load.feeds')
			step = 0.8 / (data?.length || 1);
			let limit_adjusted = parseInt(limit) + parseInt(limit_adjust);
			let batch = data.map(x => ({url: x.url}));
			let parallel = await Promise.allSettled(
				(force_update || !data?.length)
				? [
					fetch([
						`/api/feeds?type=batch`,
						`&sig=${sig}`,
						`&l=${limit_adjusted}`,
						`&x=${this.params.x || ''}`,
					].join(''), {
						method: 'POST',
						headers: {"content-type": "application/json"},
						signal: AbortSignal.timeout(60e3),
						body: JSON.stringify({batch: data, update: force_update}),
					})
					.then(resp => resp.json())
					.catch(null)
					.finally(() => this.loadingPercent += step)
				]
				: data.map((item, idx) => {
					// console.time('>> load.feed.item.' + item?.url);

					let fetch_url = [
						`/api/feeds?type=keys`,
						`&sig=${sig}`,
						`&l=${limit_adjusted}`,
						`&x=${this.params.x || ''}`,
						`&pioneer=${this.pioneer || ''}`,
					].join('');

					let fetch_opts = {
						method: 'POST',
						headers: {"content-type": "application/json"},
						signal: AbortSignal.timeout(60e3),
						body: JSON.stringify({batch, keys: [item]}),
					};

					let fetchReceiveJSON = async (json, skipCheck, tryCount=0) => {
						// console.timeEnd('>> load.feed.item.' + item?.url);
						// console.log('json', json.feeds[0]);
						if (this.skipCheckOldPublished) return json;

						let newfeed = json?.feeds?.[0];

						let found = newfeed && this.feeds.find(f => f.rss_url == newfeed?.rss_url);

						let last_published = newfeed.items?.filter(x => x.published)?.map(x => x.published)?.sort()?.pop();

						// console.log('last_published', last_published, item.url)

						if (skipCheck) this.skipCheckOldPublished = true;

						console.log('>> load.feed.item.stale_check', skipCheck, last_published, (new Date(last_published).getTime() < (Date.now() - 60e3*60*8)));

						if ( !skipCheck && last_published && (new Date(last_published).getTime() < (Date.now() - 60e3*60*8)) ) {
							toast('Stale detected, refresh up-to-date feeds', 10e3);

							setTimeout(() => {
								if (found) found.loading = true;
								this.loading = true;
								fetch(fetch_url, fetch_opts)
									.then(resp => resp.json())
									.then(json => fetchReceiveJSON(json, tryCount > 2, tryCount++))
									.catch(null)
									.finally(_ => {
										if (found) found.loading = false;
										this.loading = false;
										this.skipCheckOldPublished = true;
									});
							}, 10e3);
						}

						if (found) {
							found.items = newfeed.items;
							found.postProcessItems?.();
						}

						return json;
					}

					return fetch(fetch_url, fetch_opts)
					.then(resp => resp.json())
					.then(json => fetchReceiveJSON(json, false, 0))
					.catch(null)
					.finally(() => this.loadingPercent += step)
				})
			);
			// console.timeEnd('>> load.feeds')
			// console.log('feeds:', parallel);

			let respFeeds = parallel.filter(p => p.status == 'fulfilled').map(p => p.value?.feeds || [])
							.flat().filter(x => x);

			console.log('respFeeds:', respFeeds.length);

			// console.dir({respFeeds})

			// console.time('>> load.feeds.postprocess')

			if (this.feeds?.length && !respFeeds?.length) {
				this.loading = false;
				this.loadingPercent = 1;
				return console.log("EEMPTYRESPFEEDS");
			}

			// merge articles
			respFeeds.forEach(feed => {
				let curFeed = this.feeds?.find?.(f => f.rss_url == feed.rss_url);

				if (!curFeed) return;

				feed.items.forEach(item => {
					let curItem = curFeed.items?.find?.(x => x.link == item.link);

					if (!curItem?.article) return;

					item.viewed = curItem.viewed;
					item.article = curItem.article;
				});
			});


			this.feeds = respFeeds;
			this.linkToItemMap.clear(); // Clear the map before repopulating

			this.loadingPercent = 1;

			let hash_server = parallel.find(p => p.status == 'fulfilled')?.value?.hash;
			if (hash_server && !this.params.topic) {
				const url = new URL(location);
				url.searchParams.delete("u");
				url.searchParams.set("x", hash_server);
				history.replaceState({}, "", url);
				this.params.x = hash_server;
				this.storageSet(this.K.hash, this.params.x);
			}

			if (!this.feeds.length) return console.log("EEMPTYFEEDS");

			let {count} = this.postProcessFeeds({limit, auto_fetch_content: true}) || {};
			this.loading = false;
			this.pioneer = false;

			if (this.params.x) {
				this.storageSet(this.K.feeds + this.params.x, this.feeds);
				this.storageDel(this.K.feeds);
			} else {
				this.storageSet(this.K.feeds, this.feeds);
			}

			if (limit_adjust == 0 && count > 0) {
				await this.loadFeedsWithContent({limit, limit_adjust: count});
			}

			this.tasks = data.map((x, i) => ({url: x.url, order: i, checked: false}));

			if (this.params.x) {
				this.storageSet(this.K.tasks + this.params.x, this.tasks);
				this.storageDel(this.K.tasks);
			} else {
				this.storageSet(this.K.tasks, this.tasks);
			}

			// console.timeEnd('>> load.feeds.postprocess')

			// console.log(this.tasks);

			// console.log('...clustering')
			// let arrays = [], links = [];
			// this.feeds.forEach(feed => feed.items.forEach(item => {
			// 	if (!item.embedding) return;

			// 	arrays.push(item.embedding);
			// 	links.push(item.link);
			// }));

			// if (!this.loading && arrays.length && arrays?.[0]?.length) {
			// 	this.cluster = hclust(arrays, 'cosine');
			// 	let last = this.cluster.pop();
			// 	let i1 = last.elements[0];
			// 	let i2 = last.elements[1];
			// 	console.dir({cluster: this.cluster});
			// 	console.log('cluster:', last.distance, links[i1], links[i2])
			// }

		} catch (error) {
			console.error("Error fetching feeds:", error);
			this.debug = "Failed to load feeds. Please check the server logs for more details";
			this.loading = false;
			this.loadingPercent = 1;
		} finally {
			toast('Feeds loaded');
			console.log('loadFeedsWithContent.done');
			Alpine.$data(document.querySelector('#anchor_jump'))?.refresh?.();
		}
	},

	/**
	 * This is an optimized version of loadFeedsWithContent, designed to be a drop-in replacement.
	 *
	 * Key Improvements:
	 * 1.  **Robust State Management:** Fixes a critical bug where task metadata (like tags) was overwritten on every refresh. The new version safely merges new data, preserving user customizations.
	 * 2.  **Optimized Network Requests:** In the individual-feed fetch strategy, the request body is now minimal and correct, sending only the necessary data for each feed instead of the entire feed list in every call.
	 * 3.  **Simplified and Predictable Loading:** The complex client-side pre-fetch and recursive loading logic have been removed. This results in a more linear, predictable, and maintainable code flow.
	 * 4.  **Cleaner Asynchronous Code:** The logic for handling stale feeds is integrated more cleanly into the Promise-based flow for each feed request.
	 */
	async loadFeedsWithContentV2({limit = this.K.LIMIT, limit_adjust = 0, init_urls, force_update}) {
		// 1. Guard clauses
		if (this.is_hide_feeds) return;
		if (this.loading && !force_update) return;
		this.loading = true;
		this.loadingPercent = 0;
		console.log('loadFeedsWithContentV2', {limit, limit_adjust, force_update});

		let hash = this.params.topic || this.params.x || '';
		try {
			// 2. Determine URLs to fetch (from tasks api or local state)
			let urls = this.params.topic ? [] : (init_urls || (this.params?.u?.length ? this.params?.u?.split(',') : this.tasks?.map(x => x.url)));

			if (force_update || !urls?.length) {
				const sig = this?.profile?.signature || '';
				const resp_tasks = await fetch(`/api/feeds?is_tasks=true&x=${hash}&log=gettasks&sig=${sig}`, {
					method: 'GET',
					headers: {"content-type": "application/json"},
					signal: AbortSignal.timeout(20e3),
				}).then(r => r.json()).catch(null);
				if (resp_tasks?.feeds?.length) {
					this.tasks = resp_tasks.feeds;
					urls = this.tasks.map(x => x.url);
				} else if (!urls?.length) {
					urls = this.K.DEFAULTS;
				}
			}
			this.loadingPercent = 0.1;
			toast('RSS list loaded');

			// 3. Individual Fetch Loop
			const sig = this?.profile?.signature || '';
			const limit_adjusted = parseInt(limit) + parseInt(limit_adjust || this.K.LIMIT);
			const step = 0.8 / (urls?.length || 1);

			const parallel = await Promise.allSettled(
				urls.map(url => new Promise((resolve, reject) => {
					const fetch_url = `/api/feeds?type=keys&sig=${sig}&l=${limit_adjusted}&x=${hash}`;
					const fetch_opts = {
						method: 'POST',
						headers: {"content-type": "application/json"},
						signal: AbortSignal.timeout(60e3),
						body: JSON.stringify({ keys: [{url}] }), // OPTIMIZED: only send the key we're fetching
					};

					const handleStaleCheckAndResolve = (json) => {
						if (this.skipCheckOldPublished) {
							this.loadingPercent += step;
							return resolve(json);
						}

						const newfeed = json?.feeds?.[0];
						if (!newfeed) {
							this.loadingPercent += step;
							return resolve(json);
						}

						const last_published = newfeed.items?.filter(x => x.published)?.map(x => x.published)?.sort()?.pop();
						const isStale = last_published && (new Date(last_published).getTime() < (Date.now() - 60e3 * 60 * 8));

						if (isStale) {
							toast(`Stale feed detected: ${new URL(url).hostname}. Refreshing...`);
							// Fire-and-forget a refresh, but don't let it block the initial render
							setTimeout(() => {
								fetch(fetch_url, { ...fetch_opts, body: JSON.stringify({ keys: [{url}], update: true }) })
									.then(r => r.json())
									.then(refreshedJson => {
										const refreshedFeed = refreshedJson?.feeds?.[0];
										if (!refreshedFeed) return;

										const index = this.feeds.findIndex(f => f.rss_url === refreshedFeed.rss_url);
										if (index !== -1) {
											this.feeds[index] = refreshedFeed;
											this.feeds[index].postProcessItems?.();
											toast(`Feed ${new URL(url).hostname} updated.`);
										}
									})
									.catch(e => console.error('Stale refresh failed for', url, e));
							}, 3e3); // 3s delay
						}

						this.loadingPercent += step;
						resolve(json);
					};

					fetch(fetch_url, fetch_opts)
						.then(resp => {
							if (!resp.ok) throw new Error(`HTTP error! status: ${resp.status}`);
							return resp.json();
						})
						.then(handleStaleCheckAndResolve)
						.catch(err => {
							console.error('Feed fetch failed for', url, err);
							this.loadingPercent += step;
							reject(err); // Reject the promise for this feed
						});
				}))
			);

			// 4. Process the response
			const respFeeds = parallel.filter(p => p.status === 'fulfilled' && p.value)
								.map(p => p.value.feeds || [])
								.flat()
								.filter(x => x);

			if (!respFeeds.length && !this.feeds.length) {
				 console.log("EEMPTYRESPFEEDS - No feeds returned and no existing feeds.");
				 this.loading = false;
				 this.loadingPercent = 1;
				 return;
			}

			// Merge new data into existing feeds to preserve state (like read articles)
			respFeeds.forEach(feed => {
				const curFeed = this.feeds?.find?.(f => f.rss_url == feed.rss_url);
				if (!curFeed) return;

				feed.items.forEach(item => {
					const curItem = curFeed.items?.find?.(x => x.link == item.link);
					if (curItem?.article) {
						item.article = curItem.article;
					}
					if (curItem?.viewed) {
						item.viewed = curItem.viewed;
					}
				});
			});

			this.feeds = respFeeds;
			this.linkToItemMap.clear();

			// Update user hash if provided by server
			let hash_server = parallel.find(p => p.status == 'fulfilled')?.value?.hash;
			if (hash_server && !this.params.topic) {
				const url = new URL(location);
				url.searchParams.delete("u");
				url.searchParams.set("x", hash_server);
				history.replaceState({}, "", url);
				this.params.x = hash_server;
				this.storageSet(this.K.hash, this.params.x);
			}

			if (!this.feeds.length) {
				console.log("EEMPTYFEEDS - No feeds to display.");
				this.loading = false;
				this.loadingPercent = 1;
				return;
			}

			// 5. Post-process and save
			const {count} = this.postProcessFeeds({ limit, auto_fetch_content: true }) || {};
			this.pioneer = false;

			if (this.params.topic) return;

			// Save feeds and tasks to local storage
			const storageKey = this.params.x ? this.K.feeds + this.params.x : this.K.feeds;
			this.storageSet(storageKey, this.feeds);
			if (this.params.x) this.storageDel(this.K.feeds);

			// Update tasks state without losing metadata
			const taskUrls = new Set(this.tasks.map(t => t.url));
			urls.forEach((url, i) => {
				if (!taskUrls.has(url)) {
					this.tasks.push({ url, order: this.tasks.length, checked: false });
				}
			});
			const tasksStorageKey = this.params.x ? this.K.tasks + this.params.x : this.K.tasks;
			this.storageSet(tasksStorageKey, this.tasks);
			if (this.params.x) this.storageDel(this.K.tasks);

			if (limit_adjust == 0 && count > 0) {
				await this.loadFeedsWithContentV2({limit, limit_adjust: count});
				return;
			}

			this.loadingPercent = 1;

		} catch (error) {
			console.error("Error in loadFeedsWithContentV2:", error);
			this.debug = "Failed to load feeds. Please check the console for more details.";
		} finally {
			this.loading = false;
			toast('Feeds loaded');
			console.log('loadFeedsWithContentV2.done');
			Alpine.$data(document.querySelector('#anchor_jump'))?.refresh?.();
		}
	},

	async digest(txt, algo='SHA-256') {
		return Array.from(
			new Uint8Array(await crypto.subtle.digest(algo, new TextEncoder().encode(txt))),
			(byte) => byte.toString(16).padStart(2, '0')
		).join('');
	},

	isElementInViewport(el) {
		if (typeof jQuery === "function" && el instanceof jQuery) {
			el = el[0];
		}

		let rect = el.getBoundingClientRect();

		return (
			rect.top >= 0 &&
			rect.left >= 0 &&
			rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) && /* or $(window).height() */
			rect.right <= (window.innerWidth || document.documentElement.clientWidth) /* or $(window).width() */
		);
	},

	decodeHTML(html) {
		var txt = document.createElement('textarea');
		txt.innerHTML = html;
		let decoded = txt.value;
		delete txt;
		return decoded || '';
	},

	timeSince(date) {
		if (!date) return '';

		date = Math.min(Date.now() - 60e3, date);

		let seconds = Math.floor((new Date() - date) / 1000);

		if (isNaN(seconds)) return '';

		let interval = seconds / 31536000;

		if (interval > 1) {
			return Math.floor(interval) + " yr";
		}
		interval = seconds / 2592000;
		if (interval > 1) {
			return Math.floor(interval) + " mth";
		}
		interval = seconds / 86400;
		if (interval > 1) {
			return Math.floor(interval) + " day";
		}
		interval = seconds / 3600;
		if (interval > 1) {
			return Math.floor(interval) + " hr";
		}
		interval = seconds / 60;
		if (interval > 1) {
			return Math.floor(interval) + " min";
		}
		return Math.floor(seconds) + " sec";
	},

	postProcessFeeds({limit=this.K.LIMIT, auto_fetch_content=false, show_viewed}) {
		if (this.is_hide_feeds) return;

		let count = 1;

		if (!this.feeds?.length) return {count};

		const anchorling = str => (str?.replace(/([^a-zA-Z0-9]|https?)/gi, '-').replace(/\-+/g, '-').replace(/(^\-|\-$)/g, '').toLowerCase() || '');

		this.feeds.forEach((feed, feedIdx) => {
			// feed.anchor = feed.title?.replace(/[^a-zA-Z0-9]/gi,'').toLowerCase();
			feed.short_title = new URL(feed.rss_url).host.split('.').slice(-3).filter(x => !x.includes('www')).sort((a,b) => b.length-a.length)[0];
			feed.favicon_url = 'https://www.google.com/s2/favicons?domain=' + new URL(feed.link).hostname +'&sz=128';
			feed.anchor = anchorling(feed?.rss_url);

			feed.tags = this.tasks?.find(t => t.url == feed.rss_url)?.tags || [
				new URL(feed.rss_url).host.split('.').slice(-3).filter(x => !x.includes('www')).sort((a,b) => b.length-a.length)[0]
			];

			if (!feed?.items?.length) return;

			let len_full = feed.items.length;

			feed.toggleTag = (tag) => {
				if (typeof tag != 'string') return;

				tag = tag.toLowerCase().replace(/[^\sA-Za-z0-9]/g, '').replace(/\s+/g, '_');

				if (feed.tags.includes(tag))
					feed.tags = feed.tags.filter(x => x != tag);
				else
					feed.tags.push(tag);

				for (let t of this.tasks) {
					if (t.url != feed.rss_url) continue;

					t.tags = feed.tags;
				}

				this.storageSet(this.K.tasks, this.tasks);

				fetch(`/api/feeds?is_tasks=true&x=${this.params.x || ''}&log=updatetags`, {
						method: 'POST',
						headers: {"content-type": "application/json"},
						signal: AbortSignal.timeout(20e3),
						body: JSON.stringify({batch: this.tasks, update: true}),
					})
					.then(resp => resp.json())
					.then(console.log)
					.catch(null)

				// this.loadFeedsWithContent({limit, force_update: true, init_urls: this.tasks?.map(x => x.url)})
				// 	.then().catch();
			}

			feed.postProcessItems = (is_load_more) => {
				// console.log('viewed_0.1', feed.items.length, limit)

				feed.items.forEach((item, idx) => {
					item.read_more = false;
					item.prefetching = false;
					item.read_later = false;

					this.linkToItemMap.set(item.link, item);
					item.viewed = this.storageGet(this.K.viewed + item.link);

					if (item.description?.includes('<') || ~item.description?.search(/\&\w+\;/)) {
						item.description = new DOMParser().parseFromString(item.description, "text/html")?.documentElement.textContent;
					}

					item.description = item.description
						?.replace(/<\/?\[^>]*\>/g, '\n\n')
						.replace(/\n\n+/g, '\n\n')
						.replace(/\s+/g, ' ')
						.substr(0, 400)
						.trim()
					|| '';

					let img0 = item.images?.[0];

					item.image_thumb = (feed.link && img0 && img0.startsWith('/'))
						? (new URL(feed.link).origin.replace('http:', 'https:') + img0)
						: img0;

					item.published_formatted = (this.timeSince(new Date(item.published)) + ' ago')
											|| new Date(item.published).toString().split(' GMT').shift()
											|| (item.categories?.join(', ') || item.statistics || feed.short).substr(0, 30).trim();
					item.title_formatted = this.decodeHTML(item.title).substr(0, 150);
					item.description_formatted = item.description ? this.decodeHTML(item.description) : '';
					item.author_formatted = item.author?.toString().substr(0, 20).trim();
					item.anchor = anchorling(item?.link);

					/*item.vector = this.storageGet(this.K.embedding + item.link);
					if (!item.vector) {
						embeddingText(`${item.title} - ${item.description}`).then(vector => {
							if (!vector) return;
							item.vector = vector;
							this.storageSet(this.K.embedding + item.link, vector);
						});
					}*/

					item.toggleReadmore = (force_flag) => item.prefetchContent().then(_ => {
						item.read_more = force_flag || (!item.read_more);

						if (item.read_more) {
							feed.read_more_item = item;
							feed.read_more = true;
							feed.article = item.article;

							feed.items.filter(x => x.link != item.link).forEach(x => x.read_more = false);

							item.viewed = new Date().toString().split(' GMT').shift();

							this.storageSet(this.K.viewed + item.link, item.viewed);

							setTimeout(() => {
								let fa = document.querySelector('#rss-feed-article-' + feedIdx);

								if (!fa) return;

								if (window.getComputedStyle(fa).display == 'none') return;

								fa.scrollIntoView(true)
							}, 0.1e3)

							function removeBrokenImages() {
								let doms = [...document.querySelectorAll('p.rss-article-content img')]
									.filter(x => x.complete && (x.naturalHeight == 0));

								doms.forEach(x => x.remove());

								if (doms.length > 0) setTimeout(removeBrokenImages, 300);
							}
							setTimeout(removeBrokenImages, 300);

							item.updatePersona?.();
						} else {
							feed.read_more = false;
							feed.read_more_item.read_more = false;

							setTimeout(() => {
								let ia = document.querySelector(`a[href="${item.link}"]`);

								if (window.getComputedStyle(ia).display == 'none') return;

								ia.scrollIntoView(true)
							}, 0.1e3)
						}
					}).catch(_ => null);

					item.prefetchContent = async () => {
						if (!this.style()?.preview) return;

						// console.log('prefetchContent', item.title);

						if (!auto_fetch_content || item.article?.content || item.prefetching) return;
						item.prefetching = true;
						feed.loading = true;

						let resp = null;
						let opts = {redirect: 'follow'};
						let key_nofetch = this.K.noClientFetch + new URL(item.link).hostname;

						let noClientFetch = this.storageGet(key_nofetch);
						// console.time('>> fetch.html.' + item.link);
						try {

							resp = noClientFetch
									? await fetch(`/html?u=${encodeURIComponent(item.link)}`, opts).catch(null)
									: await fetch(item.link, opts).catch(() => {
										this.storageSet(key_nofetch, true);
										return null;
									});
						} catch (ex) {
							this.storageSet(key_nofetch, true);
							resp = await fetch(`/html?u=${encodeURIComponent(item.link)}`, opts).catch(null);
						}
						// console.timeEnd('>> fetch.html.' + item.link);

						// item.prefetching = false;

						feed.loading = false;

						if (!resp || resp?.status >= 400) return (item.no_article = true);/*console.log(item.link, resp)*/;

						let html = await resp?.text?.().catch(null);

						if (!html) return (item.no_article = true);

						let doc = new DOMParser().parseFromString(html, "text/html");
						item.article = new Readability(doc).parse();

						let content = item.article?.content;
						if (content?.length) {
							item.article.content = cleanContent(content);
						}

						// if (feed.items.filter(item => item.prefetching && item.article).length == feed.items.length) {
						// 	let feedNext = this.feeds[feedIdx + 1];

						// 	if (feedNext && !feedNext.prefetching) {
						// 		feedNext.items.forEach(item => item?.prefetchContent?.());
						// 	}
						// }
					};

					// if (feedIdx <= 1) {
					// 	item.prefetchContent();
					// 	this.triggerIntersect('full', item.link);
					// }

					item.updatePersona = async () => {
						item.vector = item.vector || await this.embedSentence(item.title);

						// console.log('updatePersona', item.vector)

						if (item.vector) {
							// console.log('currentPersona', this.persona);

							if (!Array.isArray(this.persona?.vector) || (item.vector.length != this.persona.vector.length)) {
								this.persona = {vector: item.vector, count: 1};
								this.storageSet(this.K.persona, this.persona);
							} else {
								let similarity = this.similarity(item.vector, this.persona.vector);
								console.log('similarity', similarity);

								let newVector = this.updateMeanVector(this.persona.vector, this.persona.count, item.vector);
								// console.log('newVector', newVector);

								if (newVector) {
									this.persona = 	{vector: newVector, count: this.persona.count + 1};
									this.storageSet(this.K.persona, this.persona);
								}
							}

							// console.log('updatePersona', this.persona);
						}
					};

					this.embedSentence(item.title).then(v => {
						if (!v) return;

						item.vector = v;

						if (Array.isArray(this.persona?.vector)) {
							let similarity = this.similarity(item.vector, this.persona.vector);

							item.author = similarity ? Number(similarity).toFixed(2) : item.author;
						}
					});
				});

				// console.log('viewed_0', feed.items.length, limit)
				if ((feed.items.length > limit) && !show_viewed) {
					// console.log('viewed_1', feed.items.length)
					let unviewed_items = feed.items.filter(item => {
						let viewed = this.storageGet(this.K.viewed + item.link);
						if (viewed) return false;

						return true;
					});

					if (unviewed_items.length > limit) feed.items = unviewed_items;

					// console.log('viewed_2', feed.items.length)
				}

				// feed.items = feed.items.slice(0, limit);
				feed.items.forEach((item, idx) => {
					// console.log('is_load_more', is_load_more, idx, limit);

					item.disable = (!is_load_more) && (idx >= limit);
				});
			};

			feed.loadMore = () => {
				auto_fetch_content = true;
				show_viewed = true;

				feed.items.forEach(x => x.disable = false);

				this.loading = true;
				feed.loading = true;
				fetch(`/api/feeds?l=${feed.items.length*2}&x=${this.params.x || ''}&cachy=no_cache`, {
					method: 'POST',
					headers: {"content-type": "application/json"},
					signal: AbortSignal.timeout(20e3),
					body: JSON.stringify({keys: [{url: feed.rss_url}]}),
				})
				.then(resp => resp.json())
				.then(resp => {
					let new_items = resp?.feeds?.[0]?.items
						?.filter(x => !feed.items.find(item => item.url == x.url));

					if (!new_items?.length) return;

					feed.items = [...feed.items, ...new_items];
					feed.postProcessItems(true);
					// feed.items.forEach(x => x.prefetchContent?.());
				})
				.catch(null)
				.finally(_ => {
					this.loading = false;
					feed.loading = false;
				});
			};

			feed.postProcessItems();

			let len_filter = feed.items.length;
			// console.dir({len_full, len_filter, limit})
			count = Math.max(count, Math.abs(len_full - len_filter));
		});

		// setTimeout(() => {
		// 	let hrefs = [...document.querySelectorAll('a.rss-thumb,a.rss-title')]
		// 		.filter(x => this.isElementInViewport(x))
		// 		.map(a => a.href)
		// 		.filter(x => x);
		// 	// console.log('hrefs', hrefs);

		// 	this.feeds?.forEach?.(feed => feed.items?.filter?.(x => hrefs.includes(x.link)).forEach(x => x.prefetchContent?.()));
		// }, 0.5e3);

		if (!this.loading && this.params.a) {
			toast('Go to: ' + this.params.a);
			let found = document.querySelector(`[href*="${this.params.a}"]`) || document.querySelector(`[name*="${this.params.a}"]`);
			if (found) found.scrollIntoView({ behavior: 'smooth' });
		}

		toast('Feeds prefetched');
		return {count};
	},

	async reviewTask() {
		try {
			let urls = this.input?.split(',').map(x => {
				let url = new URL(x.trim()).toString();

				return {url};
			});

			let data = await fetch(`/api/feeds?l=6`, {
				method: 'POST',
				headers: {"content-type": "application/json"},
				signal: AbortSignal.timeout(20e3),
				body: JSON.stringify({keys: urls}),
			})
			.then(resp => resp.json())
			.catch(null);

			if (!data) return;

			// console.log({data});
			this.review_feed = data.feeds[0];

			console.log({review_feed: this.review_feed});
		} catch (ex) {
			console.log(ex.message);
		}
	},

	saveTasks(noReload) {
		let encodedUrls = this.tasks?.map?.(x => encodeURIComponent(x.url)).join(',');

		let limit = ~~(this.params?.l || this.K.LIMIT);

		this.storageSet(this.K.hash, this.params.x);
		this.storageSet(this.K.style, this.params.s);

		const url = new URL(location);
		Object.entries(this.params).forEach( ([k, v]) => {
			url.searchParams.set(k, v);
		});
		console.log('url:', url.toString());
		history.replaceState({}, "", url.toString());

		this.loading = noReload ? false : true;
		this.storageDel(this.K.feeds);
		this.storageSet(this.K.tasks, this.tasks);

		if (this.params.x) {
			this.storageSet(this.K.tasks + this.params.x, this.tasks);
			this.storageDel(this.K.tasks);
		}

		// window.scrollTo({ top: 0, behavior: 'smooth' });

		(async () => {
			await fetch(`/api/feeds?is_tasks=true&x=${this.params.x || ''}&log=savetasks`, {
				method: 'POST',
				headers: {"content-type": "application/json"},
				body: JSON.stringify({batch: this.tasks, update: true}),
			});

			await this.loadFeedsWithContent({limit, force_update: true, init_urls: this.tasks?.map(x => x.url)})

			if (noReload) return toast('RSS Feeds saved');

			console.log('saveTasks done');
			this.loading = false;
			this.loadingPercent = 1;
			window.open(`/?l=${limit}&x=${this.params.x||''}&s=${this.params.s||''}`, '_self')
		})();
	},

	addNewTask() {
		try {
			this.input?.split(',').forEach(x => {
				let url = new URL(x.trim()).toString();

				let found = this.tasks.find(x => x?.url == url);

				if (found) return;

				this.tasks.push({ url, order: this.tasks.length, checked: false });
			});

			this.storageSet(this.K.tasks, this.tasks);
			if (this.params.x) {
				this.storageSet(this.K.tasks + this.params.x, this.tasks);
				this.storageDel(this.K.tasks);
			}

			this.input = '';
			this.review_feed = null;

			this.saveTasks(true);
		} catch (ex) {
			console.error(ex.message);
		}
	},

	importDefaults() {
		try {
			this.tasks.push(...this.K.DEFAULTS.map((x, i) => ({url: x, order: i, checked: false})));

			if (this.params.x) {
				this.storageSet(this.K.tasks + this.params.x, this.tasks);
			} else {
				this.storageSet(this.K.tasks, this.tasks);
			}
		} catch (ex) {
			console.error(ex.message);
		}
	},

	clearAllTasks() {
		this.input = '';
		this.tasks = [];
		this.storageDel(this.K.tasks, '');
		this.storageDel(this.K.tasks + this.params.x, '');
	},

	exportTasks() {
		let encodedUrls = this.tasks?.map?.(x => x.url).join(',\n');
		let filename = `${this.params.x || 'feeds'}.csv`;

		const blob = new Blob([encodedUrls], {type: 'text/csv'});

		if(window.navigator.msSaveOrOpenBlob) {
			window.navigator.msSaveBlob(blob, filename);
		} else {
			const elem = window.document.createElement('a');
			elem.href = window.URL.createObjectURL(blob);
			elem.download = filename;
			document.body.appendChild(elem);
			elem.click();
			document.body.removeChild(elem);
		}
	},

	async embedSentence(text) {
		if (!window.embedder) return null;
		const vector = await window.embedder(text, { pooling: 'mean', normalize: true });
		return vector?.data;
	},

	toggleDarkMode() {
		if (document.documentElement.classList.contains('dark')) {
			document.documentElement.classList.remove('dark')
			localStorage.setItem('theme', 'light');
			this.dark = false;
		} else {
			document.documentElement.classList.add('dark')
			localStorage.setItem('theme', 'dark');
			this.dark = true;
		}
	},

	async clickedProfile() {
		let THIS = this;

		if (google.accounts && !THIS.profile?.email) {
			google.accounts.id.prompt();
			return;
		}

		THIS.modalShow('Confirm', 'Backed to anonymous', null, null, (e) => {
			if (!e) return;

			google?.accounts.id.revoke(THIS.profile.email);

			toast('Backed to anonymous');

			THIS.profile = null;
			THIS.storageDel(THIS.K.profile);

			THIS.digest(JSON.stringify(THIS.tasks) + Date.now())
				.then(hash_local => {
					THIS.params.x = hash_local.slice(0, 6);
					THIS.storageSet(THIS.K.hash, THIS.params.x);
				})
				.catch()
		});
	},

	async init() {
		// console.log('init')

		let THIS = this;

		let savedHash = this.storageGet(this.K.hash);

		if ( localStorage.getItem('theme') === 'dark' ||
			 (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)
		) {
			document.documentElement.classList.add('dark');
			this.dark = true;
		} else {
			document.documentElement.classList.remove('dark');
			this.dark = false;
		}

		// window.onscroll = (e) => {
		// 	this.loading_scroll = this.loading;
		// 	this.loading = true;
		// };
		// window.onscrollend  = (e) => {
		// 	this.loading = this.loading_scroll;
		// };

		this.$watch('params.s', value => {
			const url = new URL(location.href);
			url.searchParams.set('s', this.params.s);
			history.replaceState(null, '', url.toString());
		});

		this.$watch('loading', value => {
			this.title = this.theTitle();
		});

		this.$watch('modal_showed', value => {
			if (this.modal_showed) this.modal_result = null;
		});

		this.$watch('loadingPercent', value => {
			// console.log('loadingPercent:', value);

			const SCALE = 10;
			let v = value * SCALE;
			for (let i = 0; i < SCALE; i++) {
				if (i < v && (i + 1) > v) {
					this.loadingFraction = (i + 1) + '/' + SCALE;
				}
			}
		});

		this.$watch('feeds', (value, oldValue) => {
			// console.log('$watch.feeds', oldValue?.length, value?.length)

			if (oldValue.length != value.length) {
				Alpine.$data(document.querySelector('#anchor_jump'))?.refresh?.();
				Alpine.$data(document.querySelector('#menu_burger'))?.refresh?.();
			}

		})

		try {
			let {country} = await fetch('https://api.country.is/').then(r => r.json()).catch(_ => ({}));

			fetch(location.origin + '/feeds.json').then(r => r.json()).then(feedsByCountry => {
				let locale = new Intl.Locale(navigator.language);
				locale.name = locale.region ? new Intl.DisplayNames(['en'], {type:'region'}).of(locale.region) : locale.language;

				console.dir({feedsByCountry, country, locale});

				let region = locale.region.toUpperCase();
				let language = locale.language.toUpperCase();
				let name = locale.name.toUpperCase();

				// /*DEBUG*/country = 'CA';

				let found = feedsByCountry.find(x => country && (country == x.country))
					|| feedsByCountry.find(x => region == x.country)
					|| feedsByCountry.find(x => (language == x.country) || navigator.language.includes(x.country))
					|| feedsByCountry.find(x => stringSimilarity(name, x.name) >= 0.8 || stringSimilarity(name, x.country) >= 0.5)
				;

				if (found?.feeds?.length) {
					this.K.DEFAULTS = found.feeds.slice(0, 10);
				}
			}).catch(console.log)
		} catch {}

		this.profile = this.storageGet(this.K.profile) || {};
		this.params = Object.fromEntries(new URLSearchParams(location.search));
		this.params.x = this.params.x || this.profile.username || this.storageGet(this.K.hash);
		this.params.s = this.params.s || this.storageGet(this.K.style) || 'full';

		if (!savedHash || !this.params?.x || (savedHash !== this.params.x)) this.pioneer = true;

		let limit = this.params.l || this.K.LIMIT;
		this.params.l = ~~limit;

		this.ready = true;
		this.loading = true;

		if (this.params.f == 'bookmarks' || location.hash?.includes('#bookmark') || location.hash?.includes('#note_')) this.is_hide_feeds = true;

		// Web Share API: GET
		if (this.params.url || this.params.text || this.params.title) {
			// this.debug = JSON.stringify(this.params);

			this.is_hide_feeds = true;

			console.log('share_target', this.params);

			toast('Shared: ' + JSON.stringify(this.params));

			let share_url = this.params.url;
			if (!share_url && this.params.text.includes('http')) share_url = decodeURIComponent(this.params.text);
			if (!share_url && this.params.title.includes('http')) share_url = decodeURIComponent(this.params.title);

			share_url = share_url?.split(/\s/)?.[0]?.filter?.(x => x)?.find?.(x => x.startsWith('http') || x.includes('://') || ~x.search(/[^.]+\.[^.]+\//)) || share_url;

			const REGEX_TITLE = /<meta[^>]*property=["']\w+:title["'][^>]*content=["']([^"']*)["'][^>]*>/i;
			const REGEX_IMAGE = /<meta[^>]*property=["']\w+:image["'][^>]*content=["']([^"']*)["'][^>]*>/i;
			const REGEX_DESC = /<meta[^>]*property=["']\w+:description["'][^>]*content=["']([^"']*)["'][^>]*>/i;

			let html = '', item = {};
			try {
				let fetch_opts = { redirect: 'follow', signal: AbortSignal.timeout(3e3) };

				toast('Fetching: ' + share_url);

				try { html = await fetch(share_url, fetch_opts).then(r => r.text()).catch(null); } catch (ex) {}
				try { html = html || await fetch(`/html?u=${encodeURIComponent(share_url)}`, fetch_opts).then(r => r.text()).catch(null); } catch (ex) {}
				html = html || '';

				let doc = new DOMParser().parseFromString(html, "text/html");
				item.article = new Readability(doc).parse();

				// console.dir(item.article)

				let content = item.article?.content;
				if (content?.length) {
					item.article.content = cleanContent(content);

					if (item?.article?.content?.search?.(/\{.*error.*E404.*\}/) >= 0) item.article = null;
				}
			} catch (ex) {console.log('html.ex', ex)}

			item = {
				link: share_url,
				title: this.params.title || html.match(REGEX_TITLE)?.[1] || share_url,
				description: this.params.text || html.match(REGEX_DESC)?.[1] || '',
				feed_title: this.params.title || html.match(REGEX_TITLE)?.[1] || '',
				image_thumb: html.match(REGEX_IMAGE)?.[1],
				saved_at: new Date().toISOString(),
				read_later: false,
				article: item.article,
			};

			toast('Saving: ' + item.title);

			// this.debug = JSON.stringify(item);

			await this.saveReadLater(item);
			await this.loadReadLaterItems();
			toast('Bookmarked: ' + item.title);

			const url = new URL(location);
			url.searchParams.delete("url");
			url.searchParams.delete("text");
			url.searchParams.delete("title");
			history.replaceState({}, "", url);

			Alpine.$data(document.querySelector('#expander_settings')).expanded = false;
			Alpine.$data(document.querySelector('#expander_declarations')).expanded = false;
			Alpine.$data(document.querySelector('#expander_readlater')).expanded = true;

			let found = this.readlater?.items?.find(x => (x.link == share_url) || (x.saved_at == item.saved_at));
			if (found) found.read_more = true;
		}

		// Single View
		if ('single_view' == this.params.f  && this.params.u) {
			let url = new URL(this.params.u);

			this.feeds = [{
				link: `${url.protocol}//${url.hostname}`,
				rss_url: `${url.protocol}//${url.hostname}`,
				title: url.hostname,
				items: [{
					link: this.params.u,
					author: url.hostname,
					title: url.pathname,
					description: this.params.u,
				}],
			}];

			await this.postProcessFeeds({limit: 1, auto_fetch_content: true});

			let item0 = this.feeds[0].items[0];

			await item0.prefetchContent?.();
			let tried = 10;
			let prefetched = setInterval(() => {
				if (tried <= 0) clearInterval(prefetched);
				tried--;

				if (!item0.article.content) return;

				item0.title = item0.article.title || item0.title;

				item0.toggleReadmore(true);

				clearInterval(prefetched);
			}, 500);


			this.loading = false;
			return;
		}


		if (location.hash?.includes('#note_')) {
			await this.loadReadLaterItems();

			let note = this.readlater.items.find(x => x.link.includes(location.hash));

			if (note) this.editNote(note);

			return;
		}

		this.profile = this.storageGet(this.K.profile) || {};

		this.storageSet(this.K.style, this.params.s);
		// console.log('inited params', this.params)

		this.tasks = this.storageGet(this.K.tasks) || [];
		// console.log('inited tasks_0', this.tasks.length)

		if (this.params.x)
			this.tasks = this.storageGet(this.K.tasks + this.params.x) || this.tasks;
		// console.log('inited tasks', this.tasks.length)

		if (!this.is_hide_feeds) {
			Alpine.$data(document.querySelector('#expander_settings')).expanded = !this.tasks?.length && !location.hash?.includes?.('note');

			!this.tasks?.length && !location.hash?.includes?.('note')

			this.feeds = this.storageGet(this.K.feeds) || [];
			// console.log('inited feeds_0', this.feeds.length, this.params.x, this.storageGet(this.K.feeds + this.params.x))

			if (this.params.x && this.storageGet(this.K.feeds + this.params.x))
				this.feeds = this.storageGet(this.K.feeds + this.params.x) || this.feeds;

			this.loadReadLaterItems();
			this.postProcessFeeds({limit});
			// console.log('inited feeds', this.feeds.length)
		}

		this.loading = false;

		this.loadFeedsWithContent({limit})
			.then(done => {
				if (!this.tasks?.length) {
					this.tasks = this.K.DEFAULTS.map((x, i) => ({url: x, order: i, checked: false}));
					console.log('default tasks', this.tasks.length)
				}

				this.loadReadLaterItems();
			})
			.catch(null);
		// console.log('inited contents')

		this.initializeIntersectionObservers();

		if (this.storageGet(this.K.persona)) {
			this.persona = this.storageGet(this.K.persona);

			// console.log('init', this.persona)

			if (typeof this.persona.vector == 'object') {
				this.persona.vector = Object.values(this.persona.vector);
			}
		}
		// console.log('inited persona')

		Object.entries({...localStorage})
			.filter(
				([k, v]) => ( k.includes(this.K.viewed) && (new Date(v) < new Date(Date.now() - 24*60*60e3)) )
						|| ( Number(k.split('_').shift().replace('v', '')) < Number(VERSION.replace('v', '')) )
			)
			.forEach( ([k, v]) => localStorage.removeItem(k) )
		;
		// console.log('inited old localStorage')

		window.addEventListener('params-x-changed', function(event) {
			// console.log('params-x-changed', event?.detail);

			let detail = event.detail;

			if (!detail) return;

			let x = detail.x || Object.fromEntries(new URLSearchParams(location.search))?.x;

			if (!x) return;

			let is_reload = THIS.params.x && (x != THIS.params.x)

			THIS.params.x = x;
			THIS.storageSet(THIS.K.hash, THIS.params.x);

			THIS.profile = detail.profile;
			THIS.storageSet(THIS.K.profile, THIS.profile);

			const url = new URL(location);
			url.searchParams.set("x", x);
			history.replaceState({}, "", url);

			if (document.querySelector('#img-profile').src != detail.profile?.picture) {
				document.querySelector('#img-profile').src = detail.profile?.picture;
			}

			if (is_reload) {
				location = url.toString();
				location.reload();
			}
		});

		setInterval(() => {
			if (document.hasFocus()) return;

			this.loadFeedsWithContent({limit});
		}, 60 * 60e3);

		setIdle(
			30 * 60e3,
			() => {
				toast("Idling...");
				this.loadFeedsWithContent({limit});
			},
			() => {
				toast("Reactive...");
				this.loadFeedsWithContent({limit});
			}
		);

		// this.modalShow('Hello', 'World')

		// setInterval(async () => {
		// 	const vector2 = await window.embedder?.('this is text', { pooling: 'mean', normalize: true })
		// 	console.log('vector2', vector2);
		// }, 10e3);
	},
}};

navigator?.serviceWorker?.register?.('./sw.js');

function handleGoogle1TapSignin(response) {
	let jwt = response?.credential;

	if (!jwt) return;

	fetch('/api/jwt/verify?jwt=' + encodeURIComponent(jwt))
		.then(r => r.json())
		.then(profile => {
			if (!profile) return console.log('EPROFILENULL');

			if (!profile.verified) return console.dir(profile);

			let username = profile.username || profile?.email.replace('gmail.com', '').replace(/[\@\.]/g, '');

			if (!username) return console.log('EUSERNAMENULL');

			toast('Syncing with ' + username);

			window.dispatchEvent(new CustomEvent('params-x-changed', {
				detail: { x: username, profile },
			}));
		})
		.catch(null);
}

function setIdle(idleTimeout, onIdle, onActive) {
	let idle = false;
	let timeoutId;

	const resetIdleTimer = () => {
		if (idle) {
			idle = false;
			onActive?.();
		}
		clearTimeout(timeoutId);
		timeoutId = setTimeout(goIdle, idleTimeout);
	};

	const goIdle = () => {
		idle = true;
		onIdle?.();
	};

	[ 'mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel' ].forEach((event) =>
		document.addEventListener(event, resetIdleTimer)
	);

	resetIdleTimer();

	return {
		reset: resetIdleTimer,
		isIdle: () => idle
	};
}

function cleanContent(content='') {
	return content.trim()
		.replace(/<(?!img|table|th|td|tr|p|i|ul|li|h1|h2|h3|h4|h5|h6)[^>]+>/gi, '\n').replace(/<\s*\/\s*[^>]*>/gi, '\n')
		.replace(/\n\n+/gi, '\n\n').trim().replace(/\n\n+/gi, '<br>')
		.replace(/^(\<br\>)+/gi, '').replace(/(\<br\>)+$/gi, '')
		.replace(/(\<br\>\s*\n*)+/gi, '<br>')
		.replace(/\s+/gi, ' ');
}

function stringSimilarity(s1, s2) {
	const m = s1.length;
	const n = s2.length;

	// If one or both strings are empty
	if (m === 0) return n === 0 ? 1 : 0; // Similarity is 1 if both empty, 0 if one is empty.
	if (n === 0) return 0;

	// Create DP table (m+1 rows, n+1 columns)
	const matrix = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

	// Initialize first row and column
	for (let i = 0; i <= m; i++) matrix[i][0] = i;
	for (let j = 0; j <= n; j++) matrix[0][j] = j;

	// Fill the table
	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			const cost = (s1[i - 1] === s2[j - 1]) ? 0 : 1;
			matrix[i][j] = Math.min(
				matrix[i - 1][j] + 1,      // deletion
				matrix[i][j - 1] + 1,      // insertion
				matrix[i - 1][j - 1] + cost // substitution or match
			);
		}
	}

	const distance = matrix[m][n];
	const maxLength = Math.max(m, n);

	// Calculate similarity: 1 - (distance / max_length)
	// Handle case where max_length is 0 (both empty strings, already handled but defensive)
	return maxLength === 0 ? 1 : 1 - (distance / maxLength);
}

function toast(message, timeout=3e3) {
	// console.log('> TOAST:', message);

	const toastBox = document.getElementById('toast');
	const toastMsg = document.getElementById('toast-message');

	toastMsg.textContent = message;

	toastBox.classList.remove('opacity-0');
	toastBox.classList.add('opacity-95');

	setTimeout(() => {
		toastBox.classList.remove('opacity-95');
		toastBox.classList.add('opacity-0');
	}, timeout);
}