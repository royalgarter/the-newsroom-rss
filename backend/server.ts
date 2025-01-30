import {serve} from "https://deno.land/std@0.170.0/http/server.ts";
import {extname} from "https://deno.land/std@0.170.0/path/mod.ts";
import {contentType} from "https://deno.land/std@0.170.0/media_types/mod.ts";
import {walk} from "https://deno.land/std@0.170.0/fs/walk.ts";
import {ensureFile} from "https://deno.land/std@0.170.0/fs/ensure_file.ts";
import {exists} from "https://deno.land/std@0.170.0/fs/exists.ts";
import { parseFeed } from "https://deno.land/x/rss/mod.ts";
import * as yaml from "https://deno.land/std@0.170.0/encoding/yaml.ts";

const DEFAULT_CONFIG_FILE = "./feeds.yaml";

const cors = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
};

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

async function fetchParse(url: string) {
	try {
		if (!url.includes('http')) url = 'https://' + url;

		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`HTTP error! Status: ${response.status}`);
		}
		const xmlText = await response.text();

		return await parseFeed(xmlText);
	} catch (error) {
		console.error(`Error fetching or parsing ${url}:`, error);
		return null;
	}
}

async function fetchRSSLinks({urls, limit=12}) {
	const feedUrls = (urls ? urls.split(',') : (await loadFeedsConfig())?.feeds.map(feed => feed.url)) ?? [];

	console.dir({urls, feedUrls})

	const feedResults = await Promise.all(feedUrls.map(fetchParse));

	const finalResult = feedResults.filter((result) => result !== null).map(data => {
		const items = data.entries.slice(0, limit);

		// console.dir(data)

		let head = {
			title: data.description || data.title.value,
			link: data.links?.[0],
			image: data.image?.url,
		};

		head.short = head.title.split(/[\:\,\.\-\/\|\~]/)[0].substr(0, 100).trim();

		let result = {
			...head,
			items: items.map(item => {

				try {
					if (item['media:group']) item = {...item, ...item['media:group']};

					let images = [];

					images.push(...(item?.attachments?.filter?.(x => x.mimeType.includes('image')).map(x => x.url) || []));
					images.push(...(item?.['media:content']?.filter?.(x => x.medium == 'image').map(x => x.url) || []));
					images.push(item['media:thumbnail']?.url);
					images.push(head.image);
					images.push(`https://www.google.com/s2/favicons?domain=https://${new URL(head.link).hostname}&sz=128`)

					let x = {
						title: item?.title?.value,
						author: item?.author?.name,
						link: item?.links?.[0]?.href,
						description: item?.description?.value || item?.content?.value || item?.['media:description']?.value,
						published: item?.published,
						updated: item?.updated,
						images: images.filter(x => x),
						categories: item.categories?.map(x => x.label || x.term),
					};

					if (x.description?.includes('>') && x.description?.includes('<')) {
						x.description = x.description.replace(/\<\/?[^<>]+\>/g, '');
					} 

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

	return finalResult;
}

async function handleRequest(req: Request): Promise < Response > {
	const {pathname, searchParams} = new URL(req.url);
	let params = Object.fromEntries(searchParams);

	if (pathname === "/api/feeds") {
		let {urls, limit} = params;

		urls = urls && decodeURIComponent(urls).replaceAll(' ', '+');

		const finalResult = await fetchRSSLinks({urls, limit});

		return new Response(JSON.stringify(finalResult), {
			headers: {
				...cors,
				"content-type": "application/json; charset=utf-8",
			},
		});
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

console.log('Server starting in port:8000')
serve(handleRequest, {
	port: 8000
});