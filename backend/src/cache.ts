const CACHE = {
	MAP: new Map(),
	TIMER: new Map(),

	get: (k) => CACHE.MAP.get(k),
	del: (k) => CACHE.MAP.delete(k),
	set: (k, v, e=60*60*24*7) => {
		// console.log('set_cache', k, e);

		CACHE.MAP.set(k, v);

		let oldtime = CACHE.TIMER.get(k)
		if (oldtime) clearTimeout(oldtime);

		let newtime = setTimeout(() => CACHE.MAP.delete(k), e*1e3);
		CACHE.TIMER.set(k, newtime);
	},
}
setInterval(() => console.log('CACHE.MAP.size:', CACHE.MAP.size), 10*60e3);

export default CACHE;
