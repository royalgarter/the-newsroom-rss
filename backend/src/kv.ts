const KV = await Deno.openKv(Deno.env.get("DENO_KV_URL"));

export default KV;
