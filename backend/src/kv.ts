const KV = await Deno.openKv(Deno.env.get('DENO_KV_URL'));

export default KV;

async function rollbackHamburgerFeed(feed='world', old=1, remove=2) {
	await KV.set(['/api/feeds', feed, 'version'], old);
	await KV.delete(['/api/feeds', feed, remove]);

	let item = await KV.get(['/api/feeds', feed, old]);
	await KV.set(['/api/feeds', feed], item.value);
}


await rollbackHamburgerFeed('world', 1, 2)

