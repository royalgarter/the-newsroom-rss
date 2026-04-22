import { handleFeeds, handleReadLater, handleJwtVerify, handleHtml, handleStatic, handleIndex, handleEmbedding, handleLLM, handlePresets, handleProxyImage } from './src/handlers.ts';

async function handleRequest(req: Request) {
    const { pathname } = new URL(req.url);

    if (pathname === "/api/feeds") {
        return handleFeeds(req);
    }

    if (pathname === "/api/readlater") {
        return handleReadLater(req);
    }

    if (pathname === "/api/presets") {
        return handlePresets(req);
    }

    if (pathname === "/proxy/image") {
        return handleProxyImage(req);
    }

    if (pathname === "/api/jwt/verify") {
        return handleJwtVerify(req);
    }

    if (pathname === "/html") {
        return handleHtml(req);
    }

    if (pathname === "/embedding") {
        return handleEmbedding(req);
    }

    if (pathname === "/llm") {
        return handleLLM(req);
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

const PORT = Number(Deno.env.get('PORT')) || 17385;
console.log(`Server starting on port ${PORT}`);
Deno.serve({ port: PORT }, handleRequest);
