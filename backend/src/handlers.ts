import { extname } from "https://deno.land/std/path/mod.ts";
import { exists } from "https://deno.land/std/fs/mod.ts";
import { fetchRSSLinks, saveFeedCache } from './rss.ts';
import { authorize, verifyJwt } from './auth.ts';
import CACHE from './cache.ts';
import KV from './kv.ts';
const crypto = await import('node:crypto');

const head_json = {
	"Content-Type": "application/json; charset=utf-8"
};
const cors = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
};

const response = (data, options) => {
    return new Response(data, options);
}

const FETCH_INTERVAL = {};

export async function handleFeeds(req: Request) {
    const { searchParams } = new URL(req.url);
    let params = Object.fromEntries(searchParams);
    let { u: urls = '', l: limit, x: hash, v: ver, sig, pioneer, cachy } = params;

    let feeds = [], data = null;

    if (req.method == 'GET') {
        urls = decodeURIComponent(urls).split(',');
        let v = urls.filter(x => x).map(x => ({ url: x }));
        data = { keys: v, batch: v };
    }

    if (req.method == 'POST') {
        data = await req.json();
    }

    let { keys, batch, update } = data;

    if (!keys?.length) {
        keys = batch || [];
    }

    if (hash && !keys?.length) {
        let authorized = await authorize(hash, sig);
        if (authorized.public || authorized.valid) {
            let tasks = (ver && (await KV.get(['/api/feeds', hash, ver]))?.value) || (await KV.get(['/api/feeds', hash]))?.value || [];
            keys = tasks;
        }
    }

    keys = keys.filter(x => x.url);
    hash = hash || crypto.createHash('md5').update(JSON.stringify(keys) + Date.now()).digest("hex").slice(0, 8);
    let saved = update ? batch : ((batch?.length ? batch : keys) || null);

    if (update && saved) {
        let v = (await KV.get(['/api/feeds', hash, 'version']))?.value || '0';
        v = (~~v) + 1;
        let save_obj = saved.map((x, order) => ({ order, ...x }));
        KV.set(['/api/feeds', hash], save_obj);
        KV.set(['/api/feeds', hash, v], save_obj);
        KV.set(['/api/feeds', hash, 'version'], v);
        console.log('saved', saved.length, '/api/feeds', hash, v, save_obj);
    }

    if (params.is_tasks) {
        feeds = saved.map((x, order) => ({ order, ...x }));
    } else {
        let query_feeds = { urls: keys, limit, pioneer };
        let key_feeds = 'CACHE_FEEDS:' + query_feeds.urls.map(x => x.url).join(':') + ':' + limit;
        let key_feeds_permanent = 'PERMANENT_' + key_feeds;
        let feeds_permanent = CACHE.get(key_feeds_permanent) || (await KV.get([key_feeds_permanent]))?.value;
        feeds = CACHE.get(key_feeds);

        if (!FETCH_INTERVAL[key_feeds]) {
            FETCH_INTERVAL[key_feeds] = setInterval(query_feeds => {
                fetchRSSLinks(query_feeds).then(feeds => {
                    if (!feeds?.length) return;
                    feeds.forEach(f => f.cache = 'CACHE');
                    CACHE.set(key_feeds, feeds, 60 * 15);
                    feeds.forEach(f => f.cache = 'CACHE_PERMANENT');
                    CACHE.set(key_feeds_permanent, feeds, 60 * 60 * 24 * 7);
                }).catch(console.log);
            }, 15 * 60e3, query_feeds);
        }

        if (cachy == 'no_cache') {
            feeds = (await fetchRSSLinks(query_feeds)) || feeds || feeds_permanent;
        } else if (!feeds?.length) {
            if (!feeds_permanent?.length) {
                feeds = await fetchRSSLinks(query_feeds);
                saveFeedCache({ feeds, key_feeds, key_feeds_permanent })
            } else {
                feeds = feeds_permanent;
                fetchRSSLinks(query_feeds)
                    .then(fs => saveFeedCache({ feeds: fs, key_feeds, key_feeds_permanent }))
                    .catch(e => console.dir({ query_feeds, e }))
            }
        } else {
            fetchRSSLinks(query_feeds)
                .then(fs => saveFeedCache({ feeds: fs, key_feeds, key_feeds_permanent }))
                .catch(e => console.dir({ query_feeds, e }))
        }
    }

    return response(JSON.stringify({ feeds, hash }), {
        headers: {
            ...cors, ...head_json,
            "Cache-Control": "public, max-age=300"
        },
    });
}

export async function handleReadLater(req: Request) {
    const { searchParams } = new URL(req.url);
    let params = Object.fromEntries(searchParams);
    let { x: hash, sig } = params;

    let data = {};
    try { data = (req.method != 'GET') ? await req.json?.() : {}; } catch { };

    sig = sig || data.sig || '';
    hash = hash || data.x || 'default';

    let authorized = await authorize(hash, sig);

    if (!authorized?.valid) {
        return response(JSON.stringify([]), {
            status: 401,
            headers: { ...cors, ...head_json },
        });
    }

    const pathname = "/api/readlater";

    if (req.method === 'GET') {
        const items = await getBookmarks([pathname, hash]);
        return response(JSON.stringify(items?.value || []), {
            headers: { ...cors, ...head_json },
        });
    } else if (req.method === 'POST') {
        try {
            const { item } = data || {};
            item.title = decodeURIComponent(item?.title || '')?.split(/[\.\n]/)?.[0];
            item.link = item?.link?.split(/\s/)?.filter(x => x).find(x => x.startsWith('http') || x.includes('://') || ~x.search(/[^.]+\.[^.]+\//)) || item.link;

            if (!item?.image_thumb || !item?.description) {
                const REGEX_TITLE = /<meta[^>]*property=["']\w+:title["'][^>]*content=["']([^"']*)["'][^>]*>/i;
                const REGEX_IMAGE = /<meta[^>]*property=["']\w+:image["'][^>]*content=["']([^"']*)["'][^>]*>/i;
                const REGEX_DESC = /<meta[^>]*property=["']\w+:description["'][^>]*content=["']([^"']*)["'][^>]*>/i;

                let key_html = 'HTML:' + item.link;
                let html = CACHE.get(key_html);
                try {
                    html = html || (await fetch(item.link, { redirect: 'follow', signal: AbortSignal.timeout(10e3) })
                        .then(resp => resp.text()).catch(null)) || '';
                    if (html) CACHE.set(key_html, html);
                } catch { }

                item.title = html?.match(REGEX_TITLE)?.[1] || item.title;
                item.description = html?.match(REGEX_DESC)?.[1] || item.description;
                item.image_thumb = html?.match(REGEX_IMAGE)?.[1] || item.image_thumb;
            }

            const existingItems = (await getBookmarks([pathname, hash]))?.value || [];
            const updatedItems = item ? upsertBookmark(existingItems, item) : existingItems;
            updatedItems.forEach(x => { x.skip_article = (x.link != item.link) });
            await saveBookmarks([pathname, hash], updatedItems);

            return response(JSON.stringify({ success: true, items: updatedItems, data }), {
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
            const existingItems = (await getBookmarks([pathname, hash]))?.value || [];
            const updatedItems = data.link ?
                existingItems.filter(item => item.link !== data.link) :
                existingItems;
            await KV.delete([pathname, hash, data.link]);
            updatedItems.forEach(x => { x.skip_article = true });
            await saveBookmarks([pathname, hash], updatedItems);
            return response(JSON.stringify({ success: true, items: updatedItems }), {
                headers: { ...cors, ...head_json },
            });
        } catch (error) {
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

export async function handleJwtVerify(req: Request) {
    const { searchParams } = new URL(req.url);
    let params = Object.fromEntries(searchParams);
    let jwt = decodeURIComponent(params.jwt || '') || '';
    const profile = await verifyJwt(jwt);
    if (profile.error) {
        return response(JSON.stringify({error: profile.error}), {status: 403});
    }
    return response(JSON.stringify(profile));
}

export async function handleHtml(req: Request) {
    const { searchParams } = new URL(req.url);
    let params = Object.fromEntries(searchParams);
    let { u: urls = '', pioneer } = params;

    if (!urls) return response(JSON.stringify({ error: 'E_urls_missing' }));

    let link = decodeURIComponent(urls);
    let key_html = 'HTML:' + link;

    try {
        let html = CACHE.get(key_html);

        if (!html) {
            let response = await fetch(link, { redirect: 'follow', signal: AbortSignal.timeout(pioneer ? 5e3 : 20e3) }).catch(() => null);
            html = await response?.text?.();
            CACHE.set(key_html, html);
        }

        if (!html) return response(JSON.stringify({ error: 'E403_html' }), { status: 403 });

        return response(html, {
            headers: {
                "Content-Type": "text/html",
                "Cache-Control": "public, max-age=604800",
            }
        });
    } catch {
        return response('', { status: 403 });
    }
}

export async function handleStatic(req: Request) {
    const { pathname } = new URL(req.url);
    const localpath = `./frontend${pathname}`;

    if (await exists(localpath)) {
        return response(await Deno.readFile(localpath), {
            headers: {
                "Content-Type": `${extname(localpath) ?? "text/plain"}; charset=utf-8`,
                "Cache-Control": "public, max-age=604800",
            }
        })
    }
    return null;
}

export async function handleIndex(req: Request) {
    const { pathname } = new URL(req.url);
    if (pathname === "/") {
        return response(await Deno.readTextFile("./frontend/index.html"), {
            headers: {
                "Content-Type": "text/html; charset=utf-8",
                "Cache-Control": "public, max-age=604800",
            }
        });
    }
    return null;
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

async function saveBookmarks(kvkeys, updatedItems) {
	let items = updatedItems.map(x => ({...x, article: undefined, skip_article: undefined}));
	let articles = updatedItems.filter(x => (!x?.skip_article) && x?.article?.content)
								.map(x => ({link: x.link, article: x.article}));

	await KV.set(kvkeys, items);

	for (let a of articles) {
		delete a.article.title;
		KV.set([...kvkeys, a.link], a.article).then();
	}
}

async function getBookmarks(kvkeys) {
	let items = (await KV.get(kvkeys)) || {value: []};

	await Promise.allSettled(
		Object.keys(items?.value || {}).map(i =>
			KV.get([...kvkeys, items.value[i].link]).then(a => {items.value[i].article = a?.value})
		)
	)
	
	return items;
}
