import {serve} from "https://deno.land/std/http/server.ts";
import {exists} from "https://deno.land/std/fs/mod.ts";
import {extname} from "https://deno.land/std/path/mod.ts";
import {decode} from "https://deno.land/std@0.95.0/encoding/base64url.ts"

import {parseFeed} from "https://deno.land/x/rss/mod.ts";
import {titleCase, upperCase} from "https://deno.land/x/case/mod.ts";

const crypto = await import('node:crypto');

const head_json = {
	"Content-Type": "application/json; charset=utf-8"
};
const cors = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
};

const KV = await Deno.openKv(Deno.env.get("DENO_KV_URL"));
const CACHE = {
	MAP: new Map(),
	set: (k, v, e=60*60*24*7) => setTimeout(() => CACHE.MAP.delete(k), e*1e3) && CACHE.MAP.set(k, v),
	get: (k) => CACHE.MAP.get(k),
	del: (k) => CACHE.MAP.delete(k),
}
setInterval(() => console.log('CACHE.MAP.size:', CACHE.MAP.size), 10*60e3);

async function test() {  
	// console.log(Deno.env.get("DENO_KV_ACCESS_TOKEN"));
	// console.log(Deno.env.get("DENO_KV_URL"));
	// console.log(await KV.get(["/api/feeds","djinni"]));
	// await KV.set(['hello'], 'world');console.log(await KV.get(['hello']));
	// const myUUID = crypto.randomUUID();
	// console.log("Random UUID:", myUUID);
}

async function parseRSS(url: string, content: string) {
	try {
		if (!url) return {rss_url: url};

		if (!content) {
			// console.log('parseRSS.content', url);
			url = url.replaceAll(' ', '+');
			// console.log('parseRSS.content.server-side', url);

			if (!url.includes('http')) url = 'https://' + url;

			let key_rss = 'RSS:' + url;

			content = await Promise.any([
				new Promise((resolve, reject) => {
					let cached = CACHE.get(key_rss);
					if (cached) setTimeout(resolve, 3e3, cached);
					else reject(null);
				}),
				new Promise((resolve, reject) => {
					fetch(url, {redirect: 'follow', signal: AbortSignal.timeout(10e3)})
						.then(resp => resp.text())
						.then(text => CACHE.set(key_rss, text, 60*15) && resolve(text))
						.catch(ex => reject(null));
				}),
			]);
		} else {
			// console.log('parseRSS.content_with_url', url);
		}

		if (!content) return {rss_url: url};

		// console.log('parseRSS.content', url, content.length);

		let data = await parseFeed(content);

		data.rss_url = url;

		return data;
	} catch (error) {
		// console.error(`Error fetching or parsing ${url}:`, error.message);
		return {rss_url: url};
	}
}

async function fetchRSSLinks({urls, limit=12}) {
	if (!urls) return [];

	let feeds = [];

	// console.log('urls', urls, urls.length)

	if (Array.isArray(urls)) {
		feeds = await Promise.allSettled(
			urls
			.filter(({url}) => url)
			.map(({url, content}) => parseRSS(url, content))
		);
	}

	if (typeof urls == 'string') {
		// const feedUrls = (urls ? urls.split(',') : (await loadFeedsConfig())?.feeds.map(feed => feed.url)) ?? [];
		const feedUrls = urls.split(',');

		// console.dir({urls, feedUrls})

		feeds = await Promise.allSettled(feedUrls.map(parseRSS));
	}

	feeds = feeds.map(p => p.value).filter(x => x);

	const SPLIT = /[\:\,\.\-\_\/\|\~]/;
	const REGEX_IMAGE = /<meta[^>]*property=["']\w+:image["'][^>]*content=["']([^"']*)["'][^>]*>/i;

	let render = Array(feeds.length).fill(null);
	// console.log('render')
	await Promise.allSettled(feeds.map((data, order) => new Promise(resolveFeed => {
		(async () => {
			const items = data.entries?.slice(0, limit) || [];

			// console.dir(data)

			let head = {
				title: data.description || data.title?.value || data.rss_url,
				link: data.links?.[0] || data.rss_url,
				rss_url: data.rss_url,
				image: data.image?.url,
				order,
			};

			head.short = head.title.split(SPLIT)[0].substr(0, 100).trim();
			head.title = upperCase(new URL(head.link).hostname.split('.').slice(-2, -1)[0]) + ` > ` + head.title;

			// console.dir({head});

			let rss_items = [];
			// console.log('rss_items', head.rss_url)
			await Promise.allSettled(items.map(item => new Promise(resolveItem => {
				(async () => {
					try {
						if (item['media:group']) item = {...item, ...item['media:group']};

						let images = [];

						images.push(...(item?.attachments?.filter?.(x => x.mimeType.includes('image')).map(x => x.url) || []));
						images.push(...(item?.['media:content']?.filter?.(x => x.medium == 'image').map(x => x.url) || []));
						images.push(item['media:thumbnail']?.url);
						images.push(item['media:content']?.url);

						// console.dir(images)
						let link = item?.links?.[0]?.href;
						let url = new URL(link).searchParams.get('url');

						if (link.includes('news.google.com/rss/articles/')) {
							let ggnews = await fetch(`https://feed.newsrss.org/api/feeds/decode-ggnews`
								+ `?url=${encodeURIComponent(link)}`
								+ `&source=${encodeURIComponent(item?.source?.url)}`
								+ `&title=${encodeURIComponent(item?.title?.value)}`, {
								headers: head_json, redirect: 'follow', signal: AbortSignal.timeout(10e3)
							}).then(res => res.json()).catch(null);

							if (ggnews?.data?.originUrl) {
								link = ggnews.data.originUrl;
								images = [];
							}
						}

						if (link.includes('bing.com/news') && url) {
							link = url;
							images = [];
						}

						if (link && (images.filter(x => x).length == 0)) { try {
							let key_image = 'HTML_IMAGE:' + link;

							let image_og = CACHE.get(key_image);

							if (!image_og) {
								let html = await fetch(link, { redirect: 'follow', signal: AbortSignal.timeout(3e3) })
												.then(resp => resp.text()).catch(null);

								image_og = (html || '')?.match(REGEX_IMAGE)?.[1];
							}

							if (image_og) {
								CACHE.set(key_image, image_og);
								images.push(image_og);
							}
						} catch {} }
						// console.dir(images)

						if (images.filter(x => x).length == 0) {
							images.push(`https://www.google.com/s2/favicons?domain=https://${new URL(link).hostname}&sz=256`)
							images.push(head.image);
						}

						let x = {
							link,
							title: item?.title?.value,
							author: item?.author?.name || item?.['dc:subject'] || new URL(link).host.split('.').slice(-3).filter(x => !x.includes('www')).sort((a,b)=>b.length-a.length)[0],
							description: item?.description?.value || item?.content?.value || item?.['media:description']?.value || '',
							published: item?.published,
							updated: item?.updated,
							images: images.filter(x => x && (typeof x == 'string')),
							categories: item?.categories?.map?.(x => x.label || x.term),
							link_author: item?.author?.url || item?.author?.uri,
							source: item?.source?.url,
							statistics: Object.entries(item?.['media:community']?.['media:statistics'] || {})?.map(([k, v]) => `${titleCase(k)}: ${v}`).join(', ').trim(),
						};

						// console.dir({x_images: x.images[0]});
						// console.dir({item, x});

						rss_items.push(x);
					} catch (ex) { console.error(ex); } finally { resolveItem() }
				})().catch(ex => resolveItem());
			})));
			// console.log('rss_items', head.rss_url, rss_items.length)

			let result = {
				...head,
				items: rss_items
						.filter(x => x)
						.sort((a, b) => (b.images?.length - a.images?.length) || (b.published - a.published)),
			};

			render[order] = result;
		})().catch(console.error).finally(resolveFeed);
	})));

	render = render.filter(x => x);
	// console.log(' render:', render.map(x => [x?.order, x?.rss_url, x?.items?.length].join()).join(' '))
	return render;
}

function upsertBookmark(items, newItem) {
	const index = items.findIndex(item => item.link === newItem.link);
	if (index !== -1) {
		items[index] = { ...items[index], ...newItem, updatedAt: new Date().toISOString() };
	} else {
		items.push({ ...newItem, addedAt: new Date().toISOString() });
	}
	return items;
}

function decodeJWT(token) {
	try {
		// console.log('decodeJWT', token)
		const base64Url = token.split('.')[1];
		const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
		const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
			return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
		}).join(''));

		return JSON.parse(jsonPayload);
	} catch { return {}}
}

async function handleRequest(req: Request) {
	const {pathname, searchParams} = new URL(req.url);

	const localpath = `./frontend${pathname}`;

	let params = Object.fromEntries(searchParams);
	let {u: urls='', l: limit, x: hash, v: ver, sig} = params;

	// console.log(pathname, params);
	const response = (data, options) => {
		// console.log(pathname, 'responsed');
		return new Response(data, options);
	}

	if (pathname === "/api/feeds") {
		let feeds = [], data = null;

		if (req.method == 'GET') {
			urls = decodeURIComponent(urls).split(',');

			let v = urls.filter(x => x).map(x => ({url: x}));
			data = {keys: v, batch: v};
		}

		if (req.method == 'POST') {
			data = await req.json();
		}

		// console.dir({data})

		let {keys, batch, update} = data;

		if (!keys?.length) {
			// console.log('fallback keys = batch')
			keys = batch || [];
		}

		if (sig) {
			let profile = await KV.set(['signature', sig])?.value;
			console.dir({feeds_profile: profile})
		}

		if (!keys?.length && hash) {
			let kv_keys = (ver && (await KV.get([pathname, hash, ver]))?.value) || (await KV.get([pathname, hash]))?.value;
			console.log('fallback keys = KV', kv_keys, kv_keys?.length);
			keys = kv_keys || [];
		}

		keys = keys.filter(x => x.url);

		// console.log('post', hash, keys.map(x => x.url), keys.map(x => x.content?.length))

		// console.dir({keys})

		hash = hash || crypto.createHash('md5').update(JSON.stringify(keys) + Date.now()).digest("hex").slice(0, 8);

		let saved = update ? batch : ((batch?.length ? batch : keys) || null);

		// console.log({update, saved})

		if (update && saved) {
			let v = (await KV.get([pathname, hash, 'version']))?.value || '0';

			v = (~~v) + 1;

			let save_obj = saved.map((x, order) => ({order, ...x}));

			KV.set([pathname, hash], save_obj);
			KV.set([pathname, hash, v], save_obj);
			KV.set([pathname, hash, 'version'], v);

			console.log('saved', saved.length, pathname, hash, v, save_obj);
		}

		if (params.is_tasks) {
			// console.log('is_tasks')
			feeds = saved.map((x, order) => ({order, ...x}));
		} else {
			// feeds = await fetchRSSLinks({urls: keys, limit});

			let key_feeds = 'FEEDS:' + JSON.stringify({keys, limit});
			feeds = CACHE.get(key_feeds);

			if (!feeds?.length) {
				feeds = await fetchRSSLinks({urls: keys, limit});

				if (feeds.length) CACHE.set(key_feeds, feeds, 60*5);
			}
		}

		return response(JSON.stringify({feeds, hash}), {
			headers: { ...cors, ...head_json },
		});
	}

	if (pathname === "/api/readlater") {

		if (req.method === 'GET') {
			// Retrieve read later items for the user
			const items = await KV.get([pathname, hash]);
			return response(JSON.stringify(items?.value || []), {
				headers: { ...cors, ...head_json },
			});
		} else if (req.method === 'POST') {
			// Add or update read later items
			try {
				const data = await req.json();

				hash = hash || data.x || 'default';

				const {item} = data || {};

				console.dir({share_target: hash, item});

				if (!item?.image_thumb || !item?.description) {
					const REGEX_TITLE = /<meta[^>]*property=["']\w+:title["'][^>]*content=["']([^"']*)["'][^>]*>/i;
					const REGEX_IMAGE = /<meta[^>]*property=["']\w+:image["'][^>]*content=["']([^"']*)["'][^>]*>/i;
					const REGEX_DESC = /<meta[^>]*property=["']\w+:description["'][^>]*content=["']([^"']*)["'][^>]*>/i;

					let html = '';
					try {
						html = await fetch(item.link, { redirect: 'follow', signal: AbortSignal.timeout(3e3) })
									.then(resp => resp.text()).catch(null) || '';
					} catch {}

					item.title = html.match(REGEX_TITLE)?.[1] || item.title ;
					item.description = html.match(REGEX_DESC)?.[1] || item.description ;
					item.image_thumb = html.match(REGEX_IMAGE)?.[1] || item.image_thumb ;
				}

				const existingItems = (await KV.get([pathname, hash]))?.value || [];

				const updatedItems = item ? upsertBookmark(existingItems, item) : existingItems;

				await KV.set([pathname, hash], updatedItems);

				return response(JSON.stringify({ success: true, items: updatedItems, data}), {
					headers: { ...cors, ...head_json },
				});
			} catch (error) {
				return response(JSON.stringify({ error }), {
					status: 400,
					headers: { ...cors, ...head_json },
				});
			}
		} else if (req.method === 'DELETE') {
			try {
				const data = await req.json();

				hash = hash || data.x || 'default';

				const existingItems = (await KV.get([pathname, hash]))?.value || [];

				// Remove item with matching URL if it exists
				const updatedItems = data.link ?
					existingItems.filter(item => item.link !== data.link) :
					existingItems;

				await KV.set([pathname, hash], updatedItems);

				return response(JSON.stringify({ success: true, items: updatedItems }), {
					headers: { ...cors, ...head_json },
				});
			} catch (error) {
				console.log(error);

				return response(JSON.stringify({ error }), {
					status: 400,
					headers: { ...cors, ...head_json },
				});
			}
		} else {
			return response(JSON.stringify({ error: 'Method not allowed' }), {
				status: 405,
				headers: { ...cors, ...head_json },
			});
		}
	}

	if (pathname === "/api/jwt/verify") {
		let jwt = decodeURIComponent(params.jwt || '') || '';

		if (!jwt) return response(JSON.stringify({error: 'E403_jwt'}), {status: 403});

		try {
			let verified = false;
			let profile = decodeJWT(jwt);
			let jwks = (await fetch('https://www.googleapis.com/oauth2/v3/certs').then(r => r.json()).catch(null))?.keys;

			// split the token into it's parts for verifcation
			const [headerb64, payloadb64, signatureb64] = jwt.split(".")
			const encoder = new TextEncoder()
			const data = encoder.encode(headerb64 + '.' + payloadb64)
			const signature = decode(signatureb64);

			for (let jwk of jwks) {
				const key = await crypto.subtle.importKey(
					"jwk",
					jwk,
					{name: "RSASSA-PKCS1-v1_5", hash: "SHA-256"},
					true,
					["verify"],
				);

				let flag = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, data);
				// console.dir({jwk, flag});
				
				verified = verified || flag;
			}
			// console.dir({verified, profile})

			signature = new TextDecoder().decode(signature);
			console.dir({signature})

			KV.set(['signature', signature], profile);
			
			verified = verified 
				&& (profile.iss?.includes('accounts.google.com'))
				&& (profile.aud == '547832701518-ai09ubbqs2i3m5gebpmkt8ccfkmk58ru.apps.googleusercontent.com')
				&& (new Date((profile.exp||1)*1e3) > Date.now());

			// console.dir({verified})

			return response(JSON.stringify({verified, jwt, signature, ...profile}));
		} catch (error) {
			console.log(error)
			return response(JSON.stringify({error}), {status: 403});
		}
	}

	if (pathname === "/html") {
		if (!urls) return response(JSON.stringify({error: 'E_urls_missing'}));

		let link = decodeURIComponent(urls);
		let key_link = 'HTML:' + link;

		try {
			let html = CACHE.get(key_link);

			// if (html) console.log(' cached:', link);

			if (!html) {
				let response = await fetch(link, {redirect: 'follow', signal: AbortSignal.timeout(20e3)});
				html = await response?.text?.();

				CACHE.set(key_link, html);
			}

			if (!html) return response(JSON.stringify({error: 'E403_html'}), {status: 403});

			return response(html, {
				headers: {
					"Content-Type": "text/html",
					"Cache-Control": "public, max-age=604800",
				}
			});
		} catch {
			return response('', {status: 403});
		}
	}

	if (pathname === "/") {
		return response(await Deno.readTextFile("./frontend/index.html"), {
			headers: {
				"Content-Type": "text/html; charset=utf-8",
				"Cache-Control": "public, max-age=604800",
			}
		});
	}

	if (await exists(localpath)) {
		return response(await Deno.readFile(localpath), {
			headers: {
				"Content-Type": `${extname(localpath) ?? "text/plain"}; charset=utf-8`,
				"Cache-Control": "public, max-age=604800",
			}
		})
	}

	return response(JSON.stringify({error: 'E404'}), {status: 404});
}

const port = 17385;try {port = process.env.PORT || 17385} catch{}
serve(handleRequest, {port});

// console.dir({port});
// const ping = () => fetch(`http://localhost:80`).then().catch().finally(() => setTimeout(ping, 5*60e3));ping();
