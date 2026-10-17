/**
Minimal zero-dependency static file server for the built web app (dist/web).
Usage: node scripts/serve-web.mjs [port]
*/
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

const root = resolve('dist/web');
const port = Number(process.argv[2] ?? 8080);

const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.json': 'application/json',
    '.woff2': 'font/woff2',
};

createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const requested = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const filePath = join(root, requested);

    // Prevent path traversal outside the served folder
    if (!filePath.startsWith(root + sep) && filePath !== root) {
        response.writeHead(403).end('Forbidden');
        return;
    }

    try {
        const data = await readFile(filePath);
        const type = contentTypes[extname(filePath)] ?? 'application/octet-stream';
        // Dev server: always serve the freshly built files. Content-hashed assets (fonts)
        // can be served with long-cache headers — exactly what a production static host
        // should do for them.
        const cache = requested.startsWith('fonts/')
            ? 'public, max-age=31536000, immutable'
            : 'no-store';
        response.writeHead(200, { 'content-type': type, 'cache-control': cache }).end(data);
    } catch {
        response.writeHead(404).end('Not found');
    }
}).listen(port, () => {
    console.log(`Serving ${root} on http://localhost:${port}`);
});
