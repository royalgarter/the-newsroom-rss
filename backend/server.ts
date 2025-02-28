import {serve} from "https://deno.land/std@0.170.0/http/server.ts";
import {extname} from "https://deno.land/std@0.170.0/path/mod.ts";
import {contentType} from "https://deno.land/std@0.170.0/media_types/mod.ts";
import {walk} from "https://deno.land/std@0.170.0/fs/walk.ts";
import {ensureFile} from "https://deno.land/std@0.170.0/fs/ensure_file.ts";
import {exists} from "https://deno.land/std@0.170.0/fs/exists.ts";
import { parseFeed } from "https://deno.land/x/rss/mod.ts";
import { titleCase, upperCase } from "https://deno.land/x/case/mod.ts";
import * as yaml from "https://deno.land/std@0.170.0/encoding/yaml.ts";

import { OAuth2Client } from "jsr:@cmd-johnson/oauth2-client";
const client_info = {
	clientId: Deno.env.get('GOOGLE_CLIENT_ID'),
	clientSecret: Deno.env.get('GOOGLE_CLIENT_SECRET'),
	authorizationEndpointUri: "https://accounts.google.com/o/oauth2/auth",
	tokenUri: "https://oauth2.googleapis.com/token",
	redirectUri: Deno.env.get('GOOGLE_CLIENT_REDIRECT_URI'),
	defaults: {
		scope: "https://www.googleapis.com/auth/userinfo.profile",
	},
};
// const client_info = {
// 	clientId: GOOGLE_CLIENT.web.client_id,
// 	clientSecret: GOOGLE_CLIENT.web.client_secret,
// 	authorizationEndpointUri: GOOGLE_CLIENT.web.auth_uri,
// 	tokenUri: GOOGLE_CLIENT.web.token_uri,
// 	redirectUri: GOOGLE_CLIENT.web.redirect_uris[0],
// 	defaults: {
// 		scope: "https://www.googleapis.com/auth/userinfo",
// 	},
// };
console.dir(client_info)
const oauth2Client  = new OAuth2Client(client_info);


const crypto = await import('node:crypto');

const cors = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
};

const KV = await Deno.openKv(Deno.env.get("DENO_KV_URL"));
const CACHE = {
	MAP: new Map(),
	set: (k, v, e=60*60*24*7) => setTimeout(CACHE.MAP.delete, e*1e3, k) && CACHE.MAP.set(k, v),
	get: (k) => CACHE.MAP.get(k),
	del: (k) => CACHE.MAP.delete(k),
}
setInterval(() => console.log('CACHE.MAP.size:', CACHE.MAP.size), 60*60e3);

async function test() {
	// console.log(Deno.env.get("DENO_KV_ACCESS_TOKEN"));
	// console.log(Deno.env.get("DENO_KV_URL"));
	// console.log(await KV.get(["/api/feeds","djinni"]));
	// await KV.set(['hello'], 'world');console.log(await KV.get(['hello']));
	// const myUUID = crypto.randomUUID();
	// console.log("Random UUID:", myUUID);
}

function handleCredentialResponse(response) {
	// Decode the JWT token
	const responsePayload = decodeJwtResponse(response.credential);

	console.log("ID: " + responsePayload.sub);
	console.log('Full Name: ' + responsePayload.name);
	console.log('Given Name: ' + responsePayload.given_name);
	console.log('Family Name: ' + responsePayload.family_name);
	console.log("Image URL: " + responsePayload.picture);
	console.log("Email: " + responsePayload.email);
}

function decodeJwtResponse(token) {
	const base64Url = token.split('.')[1];
	const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
	const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
		return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
	}).join(''));

	return JSON.parse(jsonPayload);
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
						.then(text => CACHE.set(key_rss, text) && resolve(text))
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
							images.push(`https://www.google.com/s2/favicons?domain=https://${new URL(head.link).hostname}&sz=256`)
							images.push(head.image);
						}

						let x = {
							title: item?.title?.value,
							author: item?.author?.name || item?.['dc:subject'] || '',
							description: item?.description?.value || item?.content?.value || item?.['media:description']?.value || '',
							published: item?.published,
							updated: item?.updated,
							images: images.filter(x => x && (typeof x == 'string')),
							categories: item?.categories?.map?.(x => x.label || x.term),
							link: item?.links?.[0]?.href,
							link_author: item?.author?.url || item?.author?.uri,
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
	console.log(' render:', render.map(x => [x?.order, x?.rss_url, x?.items?.length].join()).join(' '))
	return render;
}

async function handleRequest(req: Request) {
	const {pathname, searchParams} = new URL(req.url);

	const localpath = `./frontend${pathname}`;

	let params = Object.fromEntries(searchParams);
	let {u: urls='', l: limit, x: hash, v: ver} = params;

	// console.log(pathname, params);
	const response = (data, options) => {
		// console.log(pathname, 'responsed');
		return new Response(data, options);
	}

	if (pathname === "/api/feeds") {
		let feeds = [], data = null;

		if (req.method == 'GET') {
			urls = decodeURIComponent(urls).split(',');

			let v = urls.map(x => ({url: x}));
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

		if (!keys?.length && hash) {
			let kv_keys = (ver && (await KV.get([pathname, hash, ver]))?.value) || (await KV.get([pathname, hash]))?.value;
			console.log('fallback keys = KV', kv_keys, kv_keys.length);
			keys = kv_keys || [];
		}

		keys = keys.filter(x => x.url);

		// console.log('post', hash, keys.map(x => x.url), keys.map(x => x.content?.length))

		// console.dir({keys})

		hash = hash || crypto.createHash('md5').update(JSON.stringify(keys) + Date.now()).digest("hex").slice(0, 8);

		let saved = update ? batch : ((batch?.length ? batch : keys) || null);

		if (update && saved) {
			let v = (await KV.get([pathname, hash, 'version']))?.value || '0';

			v = (~~v) + 1;

			let save_obj = saved.map((x, order) => ({url: x.url, order}));
			
			KV.set([pathname, hash], save_obj);
			KV.set([pathname, hash, v], save_obj);
			KV.set([pathname, hash, 'version'], v);

			console.log('saved', saved.length, pathname, hash, v, save_obj);
		}

		feeds = await fetchRSSLinks({urls: keys, limit});

		return response(JSON.stringify({feeds, hash}), {
			headers: {
				...cors,
				"Content-Type": "application/json; charset=utf-8",
			},
		});
	}

	if (pathname === "/api/auth/google") {
		try {
			const body = await req.json();

			console.dir({pathname: body});

			const { credential } = body;
			
			const ticket = await client.verifyIdToken({
				idToken: credential,
				audience: GOOGLE_CLIENT.web.client_id,
			});
			
			const payload = ticket.getPayload();
			
			if (!payload) {
				return response(JSON.stringify({error: 'E:Invalid token'}), {status: 400});
			}
	
			const { sub: googleId, email, name, picture } = payload;
		
			return response(JSON.stringify({
				user: {
					googleId,
					email,
					name,
					picture
				}
			}), {
				headers: {
					"Content-Type": "application/json; charset=utf-8",
				},
			});
		} catch (error) {
			console.error('Google authentication error:', error);
			return response(JSON.stringify({error: 'E:Authentication failed'}), {status: 401});
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
