require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { TextEncoder } = require('util');
const multer = require('multer');
const { marked } = require('marked');
const openKv = (process.env.PUBLISH_USE_DENOKV === 'true') ? require('@deno/kv').openKv : null;

// console.log('CLOUDFLARE_ACCOUNT_ID=' + Deno.env.get('CLOUDFLARE_ACCOUNT_ID'))
// console.log('CLOUDFLARE_API_TOKEN=' + Deno.env.get('CLOUDFLARE_API_TOKEN'))
// console.log('CLOUDFLARE_KV_NAMESPACE_ID=' + Deno.env.get('CLOUDFLARE_KV_NAMESPACE_ID'))
// console.log('GOOGLE_CLIENT_ID=' + Deno.env.get('GOOGLE_CLIENT_ID'))
// console.log('NEXT_PUBLIC_GOOGLE_CLIENT_ID=' + Deno.env.get('NEXT_PUBLIC_GOOGLE_CLIENT_ID'))
// console.log('NODE_ENV=' + Deno.env.get('NODE_ENV'))
// console.log('PUBLISH_DENO_KV_ACCESS_TOKEN=' + Deno.env.get('PUBLISH_DENO_KV_ACCESS_TOKEN'))
// console.log('PUBLISH_DENO_KV_URL=' + Deno.env.get('PUBLISH_DENO_KV_URL'))
// console.log('PUBLISH_USE_CLOUDFLAREKV=' + Deno.env.get('PUBLISH_USE_CLOUDFLAREKV'))	

const CFKV = {
	HOST: (k) => `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${process.env.CLOUDFLARE_KV_NAMESPACE_ID}/values/${k}`,
	HEADERS: {
		'Authorization': `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`
	},
	put: async (k, v, e) => {
		const form = new FormData();
		form.append('value', v);

		return fetch(CFKV.HOST(k) + `?expiration_ttl=${e || ''}`, {
			method: 'PUT',
			headers: CFKV.HEADERS,
			body: form
		}).then(r => r.json()).catch();
	},
	get: async (k) => {
		return fetch(CFKV.HOST(k), {
			method: 'GET',
			headers: CFKV.HEADERS,
		}).then(r => r.text()).catch();
	},
	del: async (k) => {
		return fetch(CFKV.HOST(k), {
			method: 'DELETE',
			headers: CFKV.HEADERS,
		}).then(r => r.json()).catch();
	},
}

const getAppVersion = async () => {
	try {
		const hash = crypto.createHash('sha1');
		const keyFiles = fs.readdirSync(__dirname).filter(x => x.includes('.js') || x.includes('.htm') || x.includes('.cs'));

		for (const fileName of keyFiles) {
			const filePath = path.join(__dirname, fileName);
			const content = await fs.promises.readFile(filePath);
			hash.update(content);
		}

		return hash.digest('hex').slice(0, 7);
	} catch (error) {
		console.error('Failed to generate version hash:', error);
		return 'unknown';
	}
};

const app = express();
const port = process.env.PORT || 7347;
const upload = multer();
const DENO_KV_SIZE_LIMIT = 65536;



const generateHtmlPage = (title, bodyContent) => {
	return `
		<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>${title} on FeatherNote</title>
			<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@1/css/pico.min.css">
			<style>
				main.container { max-width: 100%; padding: 0; }
				article { margin: 1%; white-space: pre-wrap; word-break: break-word; }
				article img { max-width: 100%; }
			</style>
		</head>
		<body>
			<main class="container">
				<article>
					${bodyContent}
				</article>
			</main>
		</body>
		</html>
	`;
};

// Create a directory for published notes if it doesn't exist
const publishedNotesDir = path.join(__dirname, 'published_notes');
if (!fs.existsSync(publishedNotesDir)) fs.mkdirSync(publishedNotesDir);

try {
	const filePath = path.join(publishedNotesDir, `uptime.json`);
	fs.writeFileSync(filePath, JSON.stringify({date: new Date()}));
} catch (ex) {console.log(ex)}

app.use(express.json()); // Middleware to parse JSON request bodies

// --- Firebase Admin SDK Init ---
const admin = require('firebase-admin');
let isFirebaseInitialized = false;

try {
	if (process.env.FIREBASE_SERVICE_ACCOUNT) {
		const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
		admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
		isFirebaseInitialized = true;
		console.log('Firebase Admin initialized via env var.');
	} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
		admin.initializeApp();
		isFirebaseInitialized = true;
		console.log('Firebase Admin initialized via GOOGLE_APPLICATION_CREDENTIALS.');
	}
} catch (e) {
	console.warn('Firebase Admin init failed:', e.message);
}

// --- Scheduled Tasks Management (CFKV Persistence) ---
let scheduledTasks = {};

const loadScheduledTasks = async () => {
	try {
		if (!process.env.CLOUDFLARE_ACCOUNT_ID) return;
		
		const data = await CFKV.get('scheduled_tasks');
		if (data) {
			try {
				const tasks = JSON.parse(data);
				Object.values(tasks).forEach(task => scheduleTaskExecution(task));
				console.log(`Loaded ${Object.keys(tasks).length} scheduled tasks from CFKV.`);
			} catch (e) {
				console.warn('No valid scheduled tasks found in CFKV or parse error.');
			}
		}
	} catch (e) {
		console.error('Failed to load scheduled tasks from CFKV:', e);
	}
};

const saveScheduledTasks = async () => {
	try {
		if (!process.env.CLOUDFLARE_ACCOUNT_ID) return;

		const serializable = {};
		for (const [id, task] of Object.entries(scheduledTasks)) {
			const { timeoutId, ...rest } = task;
			serializable[id] = rest;
		}
		await CFKV.put('scheduled_tasks', JSON.stringify(serializable));
	} catch (e) {
		console.error('Failed to save scheduled tasks to CFKV:', e);
	}
};

const executeTask = async (task) => {
	const { id, token, title, body, url } = task;
	
	if (scheduledTasks[id]) {
		clearTimeout(scheduledTasks[id].timeoutId);
		delete scheduledTasks[id];
		await saveScheduledTasks();
	}

	if (!isFirebaseInitialized) {
		console.warn(`Cannot send task ${id}: Firebase not initialized.`);
		return;
	}

	try {
		await admin.messaging().send({
			token: token,
			notification: { title, body },
			data: { url: url || '/' },
			webpush: {
				fcm_options: { link: url || '/' },
				headers: { Urgency: 'high' }
			}
		});
		console.log(`Notification sent for task ${id}: "${title}"`);
	} catch (e) {
		console.error(`Failed to send notification for task ${id}:`, e);
	}
};

const scheduleTaskExecution = (task) => {
	const now = Date.now();
	const scheduledTime = new Date(task.scheduledTime).getTime();
	const delay = Math.max(0, scheduledTime - now);
	const id = task.id || crypto.randomBytes(8).toString('hex');
	
	const timeoutId = setTimeout(() => executeTask({ ...task, id }), delay);

	scheduledTasks[id] = { ...task, id, timeoutId };
};

app.post('/api/schedule-notification', async (req, res) => {
	const { token, noteId, title, body, scheduledTime, url } = req.body;
	if (!token || !scheduledTime) {
		return res.status(400).json({ error: 'Missing token or scheduledTime' });
	}

	const task = { id: noteId, token, title, body, scheduledTime, url };
	scheduleTaskExecution(task);
	await saveScheduledTasks();

	res.json({ success: true });
});

app.get('/api/proxy', async (req, res) => {
	const urlToFetch = decodeURIComponent(req.query.url);
	if (!urlToFetch) {
		return res.status(400).json({ error: 'URL parameter is required.' });
	}

	try {
		// Use the built-in fetch in modern Node.js
		const response = await fetch(urlToFetch, {
			headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36' } // Set a user-agent
		});

		if (!response.ok) {
			// Forward the status and statusText from the target server
			return res.status(response.status).send(response.statusText);
		}

		const html = await response.text();
		res.setHeader('X-Final-Url', response.url);
		res.send(html);
	} catch (error) {
		console.error(`Proxy error for ${urlToFetch}:`, error);
		res.status(500).json({ error: 'Failed to fetch the URL through proxy.' });
	}
});

// --- Share/Publish Endpoints ---
const PUBLISHED = {};
app.post('/api/publish', async (req, res) => {
	const { title, content } = req.body;
	if (!content) {
		return res.status(400).json({ error: 'Content cannot be empty.' });
	}

	const noteId = crypto.randomBytes(8).toString('hex');
	const noteData = { title: title || 'Untitled Note', content };
	const noteString = YAML.stringify(noteData);
	const noteSize = new TextEncoder().encode(noteString).length;

	try {
		if (process.env.PUBLISH_USE_CLOUDFLAREKV === 'true') {
			const { CLOUDFLARE_KV_NAMESPACE_ID, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID } = process.env;
			if (!CLOUDFLARE_KV_NAMESPACE_ID || !CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID) {
				throw new Error('Cloudflare KV environment variables are not set.');
			}

			await CFKV.put(noteId, noteString);
		} else if (process.env.PUBLISH_USE_DENOKV === 'true' && noteSize <= DENO_KV_SIZE_LIMIT) {
			if (!process.env.PUBLISH_DENO_KV_URL || !process.env.PUBLISH_DENO_KV_ACCESS_TOKEN) {
				throw new Error('Deno KV environment variables are not set.');
			}
			const kv = await openKv(process.env.PUBLISH_DENO_KV_URL, { accessToken: process.env.PUBLISH_DENO_KV_ACCESS_TOKEN });
			await kv.set(['published_notes', noteId], noteData);
		} else {
			// Fallback to filesystem for large notes or if Deno KV is not configured
			const filePath = path.join(publishedNotesDir, `${noteId}.json`);
			if (!fs.existsSync(publishedNotesDir)) fs.mkdirSync(publishedNotesDir);
			fs.writeFile(filePath, noteString, error => {
				console.log(error);
				PUBLISHED[noteId] = noteData;
			});
		}
		res.json({ url: `/publish/${noteId}` });
	} catch (err) {
		console.error('Failed to save note:', err);
		res.status(500).json({ error: 'Failed to save note.' });
	}
});

app.get('/publish/:noteId', async (req, res) => {
	const { noteId } = req.params;

	try {
		let note = null;

		if (process.env.PUBLISH_USE_CLOUDFLAREKV === 'true') {
			const { CLOUDFLARE_KV_NAMESPACE_ID, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID } = process.env;
			if (!CLOUDFLARE_KV_NAMESPACE_ID || !CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID) {
				throw new Error('Cloudflare KV environment variables are not set.');
			}

			const value = await CFKV.get(noteId);
			if (value) {
				note = YAML.parse(value);
			}
		}

		// First, try to fetch from Deno KV if it's enabled
		if (!note && process.env.PUBLISH_USE_DENOKV === 'true') {
			if (!process.env.PUBLISH_DENO_KV_URL || !process.env.PUBLISH_DENO_KV_ACCESS_TOKEN) {
				throw new Error('Deno KV environment variables are not set.');
			}
			const kv = await openKv(process.env.PUBLISH_DENO_KV_URL, { accessToken: process.env.PUBLISH_DENO_KV_ACCESS_TOKEN });
			const result = await kv.get(['published_notes', noteId]);
			if (result.value) {
				note = result.value;
			}
		}

		// If not found in Deno KV, or if Deno KV is not enabled, try the filesystem
		if (!note) {
			const filePath = path.join(publishedNotesDir, `${noteId}.json`);
			if (fs.existsSync(filePath)) {
				const data = fs.readFileSync(filePath, 'utf8');
				note = YAML.parse(data);
			} else {
				note = PUBLISHED[noteId];
			}
		}

		// If note is still not found, return 404
		if (!note) {
			return res.status(404).send('Note not found.');
		}

		const htmlContent = marked.parse(note.content);
		res.send(generateHtmlPage(note.title, `<h1>${note.title}</h1>\n${htmlContent}`));
	} catch (err) {
		console.error('Failed to retrieve note:', err);
		res.status(500).send('Failed to retrieve note.');
	}
});

app.get('/about', (req, res) => {
	const readmePath = path.join(__dirname, '..', 'README.md');
	fs.readFile(readmePath, 'utf8', (err, markdown) => {
		if (err) {
			console.error('Failed to read README.md:', err);
			return res.status(500).send('Could not load about page.');
		}
		const htmlContent = marked.parse(markdown);
		res.set('Cache-Control', 'public, max-age=604800'); // 1 week
		res.send(generateHtmlPage('About FeatherNote', htmlContent));
	});
});

// Route for the main application page
app.get('/', (req, res) => HTML_INDEX ? res.send(HTML_INDEX) : res.sendFile(path.join(__dirname, 'index.html')) );

// Serve static files from the 'src' directory
app.use(express.static(path.join(__dirname), { maxAge: '7d' }));

// Handle shared content from PWA
app.post('/share', upload.none(), (req, res) => {
	// The service worker will handle this, but we have a server-side route as a fallback.
	console.log('Shared content received on server (POST):', req.body);
	const { title, url, text } = req.body;
	const redirectUrl = `/?title=${encodeURIComponent(title || '')}&url=${encodeURIComponent(url || '')}&text=${encodeURIComponent(text || '')}`;
	res.redirect(redirectUrl);
});

app.get('/share', (req, res) => {
	console.log('Shared content received on server (GET):', req.query);
	const { title, url, text } = req.query;
	const redirectUrl = `/?title=${encodeURIComponent(title || '')}&url=${encodeURIComponent(url || '')}&text=${encodeURIComponent(text || '')}`;
	res.redirect(redirectUrl);
});

app.get('/api/version', (req, res) => {
	res.json({ version: appVersion || 'unknown' });
});

let appVersion;
let HTML_INDEX = fs.readFileSync(path.join(__dirname, 'index.html'), {encoding: 'utf8'});
(async () => {
	appVersion = await getAppVersion();
	await loadScheduledTasks();

	if (process.argv[2] === '--version') {
		console.log(appVersion);
		process.exit(0);
	}

	const readmePath = path.join(__dirname, '..', 'README.md');
	const readmeMarkdown = fs.readFileSync(readmePath, 'utf8');
	const introMarkdown = readmeMarkdown.split('## Philosophy')[0];
	const welcomeHtml = marked.parse(introMarkdown);

	HTML_INDEX = (HTML_INDEX || '')
					.replaceAll?.('___VERSION___', appVersion)
					.replaceAll?.('___GOOGLE_CLIENT_ID___', process.env.GOOGLE_CLIENT_ID)
					.replace('<!--WELCOME_CONTENT-->', welcomeHtml);

	app.listen(port, () => {
		console.log(`Server openned: http://localhost:${port}`);
		console.log()
		console.log(`Versioning url: http://localhost:${port}/?v=${appVersion}`);
	});
})();


