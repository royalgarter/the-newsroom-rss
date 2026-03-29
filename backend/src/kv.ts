const KV = await Deno.openKv(Deno.env.get('DENO_KV_URL'));


KV.safeGet = async (key) => {
    try {
        let result = await KV.get(key);
        return result;
    } catch (ex) {
        console.log(ex.message || ex)
        return null
    }
}

KV.safeSet = async (key, value) => {
    try {
        let result = await KV.set(key, value);
        return result;
    } catch (ex) {
        console.log(ex.message || ex)
        return null
    }
}

export default KV;

// Backup all KV data to database folder on startup
async function backupKvData() {
    try {
        // Ensure database directory exists
        await Deno.mkdir('database', { recursive: true });

        // Check if KV is empty and restore from latest backup if so
        const existingIter = KV.list({ prefix: [] });
        const existingKeys: string[][] = [];
        for await (const entry of existingIter) {
            existingKeys.push(entry.key);
        }

        if (existingKeys.length === 0) {
            await restoreFromLatestBackup();
        }

        const backupData: { key: string[]; value: unknown }[] = [];
        const expiredKeys: string[][] = [];
        const oversizedKeys: string[][] = [];
        const now = Math.floor(Date.now() / 1000);
        const MAX_VALUE_SIZE = 2000; // ~2KB limit (Deno KV read limit is ~2049 bytes)

        // List all entries with empty prefix to get everything
        const iter = KV.list({ prefix: [] });
        for await (const entry of iter) {
            // Check if this is a signature entry and if it's expired
            if (entry.key[0] === 'signature' && typeof entry.value === 'object' && entry.value !== null) {
                const val = entry.value as Record<string, unknown>;
                if (typeof val.exp === 'number' && val.exp < now) {
                    expiredKeys.push(entry.key);
                    console.log(`Found expired signature: ${entry.key[1]} (exp: ${val.exp})`);
                    continue; // Don't backup expired entries
                }
            }

            if (entry.key.find(k => k?.includes?.('_CACHE_'))
                || (entry.key.length > 2 && Number.isFinite(entry.key[3]))
            ) {
                await KV.delete(entry.key);
                console.log('Skipping cache/temp:', entry.key);
                continue;
            }

            // Check for oversized values
            const valueSize = new TextEncoder().encode(JSON.stringify(entry.value)).length;
            if (valueSize > MAX_VALUE_SIZE) {
                console.log(`Found oversized entry ${JSON.stringify(entry.key)} (${valueSize} bytes)`);
                oversizedKeys.push(entry.key);
                continue; // Don't backup oversized entries
            }

            backupData.push({
                key: entry.key,
                value: entry.value,
            });
        }

        // Delete expired and oversized entries
        const keysToDelete = [...expiredKeys, ...oversizedKeys];
        for (const key of keysToDelete) {
            await KV.delete(key);
        }

        if (expiredKeys.length > 0) {
            console.log(`Deleted ${expiredKeys.length} expired signature(s)`);
        }
        if (oversizedKeys.length > 0) {
            console.log(`Deleted ${oversizedKeys.length} oversized entry/entries`);
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = `database/kv-backup-${timestamp}.json`;
        await Deno.writeTextFile(backupPath, JSON.stringify(backupData, null, 2));

        console.log(`KV backup created: ${backupPath} (${backupData.length} entries)`);
    } catch (error) {
        console.error('Failed to backup KV data:', error);
    }
}

async function restoreFromLatestBackup() {
    try {
        const entries = await Deno.readDir('database');
        const backupFiles: string[] = [];

        for await (const entry of entries) {
            if (entry.isFile && entry.name.startsWith('kv-backup-') && entry.name.endsWith('.json')) {
                backupFiles.push(entry.name);
            }
        }

        if (backupFiles.length === 0) {
            console.log('No backup files found to restore from');
            return;
        }

        // Sort by filename (timestamp) and get the latest
        backupFiles.sort();
        const latestFile = backupFiles[backupFiles.length - 1];
        const latestPath = `database/${latestFile}`;

        const content = await Deno.readTextFile(latestPath);
        const backupData: { key: string[]; value: unknown }[] = JSON.parse(content);

        const MAX_VALUE_SIZE = 2000; // ~2KB limit (Deno KV read limit is ~2049 bytes)
        let restored = 0;
        let skipped = 0;

        for (const item of backupData) {
            // Skip oversized values
            const valueSize = new TextEncoder().encode(JSON.stringify(item.value)).length;
            if (valueSize > MAX_VALUE_SIZE) {
                console.log(`Skipping oversized entry ${JSON.stringify(item.key)} (${valueSize} bytes)`);
                skipped++;
                continue;
            }
            await KV.set(item.key, item.value);
            restored++;
        }

        console.log(`Restored ${restored} entries from ${latestPath}${skipped > 0 ? ` (skipped ${skipped} oversized)` : ''}`);
    } catch (error) {
        console.error('Failed to restore from backup:', error);
    }
}

// backupKvData();

// async function rollbackHamburgerFeed(feed='world', old=1, remove=2) {
// 	await KV.set(['/api/feeds', feed, 'version'], old);
// 	await KV.delete(['/api/feeds', feed, remove]);

// 	let item = await KV.get(['/api/feeds', feed, old]);
// 	await KV.set(['/api/feeds', feed], item.value);
// }


// await rollbackHamburgerFeed('world', 1, 2)

