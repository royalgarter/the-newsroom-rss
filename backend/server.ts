import { serve } from "https://deno.land/std/http/server.ts";
import { handleFeeds, handleReadLater, handleJwtVerify, handleHtml, handleStatic, handleIndex } from './src/handlers.ts';

async function handleRequest(req: Request) {
    const { pathname } = new URL(req.url);

    if (pathname === "/api/feeds") {
        return handleFeeds(req);
    }

    if (pathname === "/api/readlater") {
        return handleReadLater(req);
    }

    if (pathname === "/api/jwt/verify") {
        return handleJwtVerify(req);
    }

    if (pathname === "/html") {
        return handleHtml(req);
    }

    if (pathname === "/") {
        return handleIndex(req);
    }

    const staticFileResponse = await handleStatic(req);
    if (staticFileResponse) {
        return staticFileResponse;
    }

    return new Response(JSON.stringify({ error: 'E404' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
}

const port = 17385; try { port = process.env.PORT || 17385 } catch { }
serve(handleRequest, { port });