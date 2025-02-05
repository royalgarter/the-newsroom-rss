import {serve} from "https://deno.land/std@0.170.0/http/server.ts";
import {extname} from "https://deno.land/std@0.170.0/path/mod.ts";
import {contentType} from "https://deno.land/std@0.170.0/media_types/mod.ts";
import {walk} from "https://deno.land/std@0.170.0/fs/walk.ts";
import {ensureFile} from "https://deno.land/std@0.170.0/fs/ensure_file.ts";
import {exists} from "https://deno.land/std@0.170.0/fs/exists.ts";
import { parseFeed } from "https://deno.land/x/rss/mod.ts";
import { titleCase, upperCase } from "https://deno.land/x/case/mod.ts";
import * as yaml from "https://deno.land/std@0.170.0/encoding/yaml.ts";

const crypto = await import('node:crypto');

const DEFAULT_CONFIG_FILE = "./feeds.yaml";

const cors = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
};

const KV = await Deno.openKv();

async function test() {
	// await KV.set(['hello'], 'world');console.log(await KV.get(['hello']));
	// const myUUID = crypto.randomUUID();
	// console.log("Random UUID:", myUUID);
}

async function loadFeedsConfig() {
	try {
		const fileExt = extname(DEFAULT_CONFIG_FILE);
		const fileContent = await Deno.readTextFile(DEFAULT_CONFIG_FILE);

		if (fileExt === ".json") {
			return JSON.parse(fileContent)
		}
		if (fileExt === ".yaml" || fileExt === ".yml") {
			return yaml.parse(fileContent)
		}
		throw new Error(`Unsupported config file extension: ${fileExt}`)

	} catch (error) {
		console.error("Failed to load config:", error);
		return {feeds: []};
	}
}

async function fetchParse(url: string, content: string) {
	try {
		if (!url) return null;

		if (!content) {
			url = url.replaceAll(' ', '+');
			// console.log('fetchParse.content.server-side', url);

			if (!url.includes('http')) url = 'https://' + url;

			const response = await fetch(url);
			if (!response.ok) {
				throw new Error(`HTTP error! Status: ${response.status}`);
			}
			content = await response.text();	
		}

		// console.log('fetchParse.content', content.length);

		let data = await parseFeed(content);

		data.rss_url = url;

		return data;
	} catch (error) {
		// console.error(`Error fetching or parsing ${url}:`, error.message);
		return null;
	}
}

async function fetchRSSLinks({urls, limit=12}) {
	if (!urls) return [];

	let feeds = [];

	if (Array.isArray(urls)) {
		feeds = await Promise.all(
			urls.map(async ({url, content}) => {
				if (!url) return null;

				return await fetchParse(url, content);
			})
		);

		feeds = feeds.filter(x => x);
	}

	if (typeof urls == 'string') {
		// const feedUrls = (urls ? urls.split(',') : (await loadFeedsConfig())?.feeds.map(feed => feed.url)) ?? [];
		const feedUrls = urls.split(',');

		// console.dir({urls, feedUrls})

		feeds = await Promise.all(feedUrls.map(fetchParse));	
	}

	const render = feeds.filter(x => x).map(data => {
		const items = data.entries.slice(0, limit);

		// console.dir(data)

		const SPLIT = /[\:\,\.\-\_\/\|\~]/;

		let head = {
			title: data.description || data.title.value,
			link: data.links?.[0] || data.rss_url,
			rss_url: data.rss_url,
			image: data.image?.url,
		};

		head.short = head.title.split(SPLIT)[0].substr(0, 100).trim();
		head.title = upperCase(new URL(head.link).hostname.split('.').slice(-2, -1)[0]) + ` > ` + head.title;

		// console.dir({head});
		
		let result = {
			...head,
			items: items.map(item => {

				try {
					if (item['media:group']) item = {...item, ...item['media:group']};

					let images = [];

					images.push(...(item?.attachments?.filter?.(x => x.mimeType.includes('image')).map(x => x.url) || []));
					images.push(...(item?.['media:content']?.filter?.(x => x.medium == 'image').map(x => x.url) || []));
					images.push(item['media:thumbnail']?.url);
					images.push(`https://www.google.com/s2/favicons?domain=https://${new URL(head.link).hostname}&sz=256`)
					images.push(head.image);

					let x = {
						title: item?.title?.value,
						author: item?.author?.name || item?.['dc:subject'] || '',
						description: item?.description?.value || item?.content?.value || item?.['media:description']?.value,
						published: item?.published,
						updated: item?.updated,
						images: images.filter(x => x),
						categories: item?.categories?.map?.(x => x.label || x.term),
						link: item?.links?.[0]?.href,
						link_author: item?.author?.url || item?.author?.uri,
						statistics: Object.entries(item?.['media:community']?.['media:statistics'] || {})?.map(([k, v]) => `${titleCase(k)}: ${v}`).join(', ').trim(),
					};

					// console.dir({item, x});

					return x;
				} catch (ex) {
					console.log(ex);

					return null;
				}
				
			}).filter(x => x)
		};

		return result;
	})

	return render;
}

async function handleRequest(req: Request) {
	const {pathname, searchParams} = new URL(req.url);

	let params = Object.fromEntries(searchParams);
	let {urls='', limit, hash} = params;

	// console.dir({params})

	if (pathname === "/api/feeds") {
		let finalResult = [];

		if (req.method == 'GET') {
			urls = decodeURIComponent(urls);

			finalResult = await fetchRSSLinks({urls, limit});
		}

		if (req.method == 'POST') {
			let data = await req.json();

			if (hash && !data?.length) {
				data = (await KV.get([pathname, hash]))?.value || [];
			} 
			
			let keys = data.filter(x => x.url).map(x => ({url: x.url}));

			if (!hash) {
				hash = crypto.createHash('md5').update(JSON.stringify(keys)).digest("hex").slice(0, 6);
			}

			KV.set([pathname, hash], keys);

			finalResult = await fetchRSSLinks({urls: data, limit});

			finalResult?.forEach?.(x => x.hash = hash);
		}

		return new Response(JSON.stringify(finalResult), {
			headers: {
				...cors,
				"content-type": "application/json; charset=utf-8",
			},
		});
	}

	if (pathname === "/html") {
		if (!urls) return new Response(JSON.stringify({error: 'E_urls_missing'}));

		urls = decodeURIComponent(urls);

		try {
			let response = await fetch(urls, {
				redirect: "follow",
			});
			let html = await response?.text?.();

			if (!html) return new Response(JSON.stringify({error: 'E403_html'}), {status: 403});

			return new Response(html, {
				headers: {
					"content-type": "text/html",
				}
			});
		} catch {
			return new Response('', {status: 403});
		}
	}

	if (pathname === "/") {
		return new Response(await Deno.readTextFile("./frontend/index.html"), {
			headers: {
				"content-type": "text/html; charset=utf-8",
			}
		});
	}

	const filePath = `./frontend${pathname}`;
	if (await exists(filePath)) {
		const fileExt = extname(filePath)
		return new Response(await Deno.readFile(filePath), {
			headers: {
				"content-type": `${contentType(fileExt) ?? "text/plain"}; charset=utf-8`,
			}
		})
	}

	return new Response(JSON.stringify({error: 'E404'}), {status: 404});
}

const port = process.env.PORT || 17385;

serve(handleRequest, {port});
