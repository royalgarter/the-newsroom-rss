import { parseFeed } from "https://deno.land/x/rss/mod.ts";
import { titleCase, upperCase } from "https://deno.land/x/case/mod.ts";
import CACHE from './cache.ts';
import KV from './kv.ts';

const APIKEYS = (Deno.env.get('GEMINI_API_KEY') || '').split(',').filter(x => x);
const EMBEDDED = new Map();

async function embedding(text) {
    let vector = EMBEDDED.get(text);

    if (vector) return vector;

    let apikey = APIKEYS[Math.floor(Math.random() * APIKEYS.length)];
    let result = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent', {
        method: 'POST',
        headers: {
            'x-goog-api-key': apikey,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            'model': 'models/gemini-embedding-001',
            // 'taskType': 'CLUSTERING',
            'outputDimensionality': 768,
            'content': {
                'parts': [{text}]
            }
        })
    }).then(r => r.json()).catch(e => null);

    vector = result?.embedding?.values || null;

    if (vector) EMBEDDED.set(text, vector);

    return vector;
}

async function parseRSS(url: string, content: string, pioneer: Boolean) {
	try {
		if (!url) return {rss_url: url};

		if (!content) {
			url = url.replaceAll(' ', '+').replaceAll('http://', 'https://');

			if (!url.includes('http')) url = 'https://' + url;

			let key_rss = 'RSS:' + url;

			console.time('>> parseRSS.' + url);
			content = await Promise.any([
				new Promise((resolve, reject) => {
					let cached = CACHE.get(key_rss);
					if (cached) {
						setTimeout(() => resolve(cached), 3e3);
					} else {
						reject(null);
					}
				}),
				new Promise((resolve, reject) => {
					fetch(url, {redirect: 'follow', signal: AbortSignal.timeout(pioneer ? 5e3 : 30e3)})
						.then(resp => resp.text())
						.then(text => {
							CACHE.set(key_rss, text, 60*15);
							resolve(text);
						})
						.catch(ex => {
							reject(null);
						});
				}),
			]);
			console.timeEnd('>> parseRSS.' + url);
		}

		if (!content) return {rss_url: url};

		let data = await parseFeed(content);
		data.rss_url = url;
		return data;
	} catch (error) {
		return {rss_url: url};
	}
}

async function processRssItem(item, head, pioneer) {
    try {
        if (item['media:group']) item = { ...item, ...item['media:group'] };

        let images = [];

        images.push(...(item?.attachments?.filter?.(x => x.mimeType.includes('image')).map(x => x.url) || []));
        images.push(...(item?.['media:content']?.filter?.(x => x.medium == 'image').map(x => x.url) || []));
        images.push(item['media:thumbnail']?.url);
        images.push(item['media:content']?.url);

        let link = item?.links?.[0]?.href;
        let url = new URL(link).searchParams.get('url');

        if (link.includes('news.google.com/rss/articles/')) {
            let key_gnews = 'GOOGLE_NEWS:' + link;
            let gn_link = CACHE.get(key_gnews);

            if (gn_link) {
                link = gn_link;
                images = [];
            } else {
                let ggnews = await fetch(`https://feed.newsrss.org/api/feeds/decode-ggnews`
                    + `?url=${encodeURIComponent(link)}`
                    + `&source=${encodeURIComponent(item?.source?.url)}`
                    + `&title=${encodeURIComponent(item?.title?.value)}`, {
                    headers: { "Content-Type": "application/json; charset=utf-8" }, redirect: 'follow', signal: AbortSignal.timeout(pioneer ? 5e3 : 10e3)
                }).then(res => res.json()).catch(null);

                if (ggnews?.data?.originUrl) {
                    link = ggnews.data.originUrl;
                    images = [];
                    CACHE.set(key_gnews, link);
                }
            }
        }

        if (link.includes('bing.com/news') && url) {
            link = url;
            images = [];
        }

        images = images.filter(x => x);

        if (link && (images.length == 0)) {
            try {
                let key_html = 'HTML:' + link;
                let key_image = 'HTML_IMAGE:' + link;

                let image_og = CACHE.get(key_image);

                if (!image_og) {
                    let html = CACHE.get(key_html) || (await fetch(link, { redirect: 'follow', signal: AbortSignal.timeout(5e3) })
                        .then(resp => resp.text()).catch(_ => null));

                    const REGEX_IMAGE = /<meta[^>]*property=["']\w+:image["'][^>]*content=["']([^"']*)["'][^>]*>/;
                    image_og = (html || '')?.match(REGEX_IMAGE)?.[1];

                    if (html) CACHE.set(key_html, html);
                }

                if (image_og) {
                    images.push(image_og);
                    CACHE.set(key_image, image_og);
                }
            } catch (ex) { console.error(ex) }
        }

        if (images.length == 0) {
            images.push(`https://www.google.com/s2/favicons?domain=https://${new URL(link).hostname}&sz=256`)
            images.push(head.image);
        }

        // console.log('processRssItem', link, images);

        let processed = {
            link,
            title: item?.title?.value,
            author: item?.author?.name || item?.['dc:subject'] || new URL(link).host.split('.').slice(-3).filter(x => !x.includes('www')).sort((a, b) => b.length - a.length)[0],
            description: item?.description?.value || item?.content?.value || item?.['media:description']?.value || '',
            published: item?.published,
            updated: item?.updated,
            images: images.filter(x => x && (typeof x == 'string')),
            categories: item?.categories?.map?.(x => x.label || x.term),
            link_author: item?.author?.url || item?.author?.uri,
            source: item?.source?.url,
            statistics: Object.entries(item?.['media:community']?.['media:statistics'] || {})?.map(([k, v]) => `${titleCase(k)}: ${v}`).join(', ').trim(),
        };

        processed.embedding = await embedding([processed.title, processed.description].join('-')).catch(e => null);

        return processed;
    } catch (ex) {
        console.error(ex);
        return null;
    }
}

export async function fetchRSSLinks({urls, limit=12, pioneer=false}) {
    if (!urls) return [];

    let feeds = [];

    if (Array.isArray(urls)) {
        feeds = await Promise.allSettled(
            urls
            .filter(({url}) => url)
            .map(({url, content}) => parseRSS(url, content, pioneer))
        );
    }

    if (typeof urls == 'string') {
        const feedUrls = urls.split(',');
        feeds = await Promise.allSettled(feedUrls.map(url => parseRSS(url, null, pioneer)));
    }

    feeds = feeds.map(p => p.value).filter(x => x);

    const LAST_MONTH = new Date(Date.now() - 31*24*60*60e3);

    let render = Array(feeds.length).fill(null);
    await Promise.allSettled(feeds.map((data, order) => new Promise(resolveFeed => {
        (async () => {
            // console.time('>> postParseRSS.' + data.rss_url);

            const items = data.entries?.slice(0, limit) || [];

            let head = {
                title: data.description || data.title?.value || data.rss_url,
                link: data.links?.[0] || data.rss_url,
                rss_url: data.rss_url,
                image: data.image?.url,
                order,
            };

            const SPLIT = /[\:\,\.\/\|\~]/;
            head.short = head.title.substr(0, 100).trim();
            head.title = upperCase(new URL(head.link).hostname.split('.').slice(-2, -1)[0]) + ` > ` + head.title;

            const rss_items = await Promise.allSettled(items.map(item => processRssItem(item, head, pioneer)));

            let result = {
                ...head,
                items: rss_items
                        .map(p => p.value)
                        .filter(x => x)
                        .filter(x => x.published && (new Date(x.published) > LAST_MONTH))
                        .sort((a, b) => (b.images?.length - a.images?.length) || (b.published - a.published)),
            };

            render[order] = result;

            // console.timeEnd('>> postParseRSS.' + data.rss_url);
        })().catch(console.error).finally(resolveFeed);
    })));

    render = render.filter(x => x);
    return render;
}

export async function saveFeedCache({limit=6, feeds, key_feeds, key_feeds_permanent}) {
	if (!feeds?.length) return;

    limit = Math.min(Math.max(limit || 6, 6), 24);

	feeds = feeds.filter(x => x?.items?.length);

	/* LAYER: 0 */
	if (!key_feeds) return;
	feeds.forEach(f => f.cache = 'CACHE');
	CACHE.set(key_feeds, feeds, 60*15);
	
	/* LAYER: 1 */
	if (!key_feeds_permanent) return;
	feeds.forEach(f => f.cache = 'CACHE_PERMANENT');
	CACHE.set(key_feeds_permanent, feeds, 60*60*24*7);
	
	/* LAYER: 2 */
	feeds.forEach(f => {
		f.cache = 'CACHE_KV';
		f.items = f.items.slice(0, limit);
	});
	KV.set([key_feeds_permanent], feeds).catch(() => {});
}