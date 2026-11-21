import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
const VIEWER = fileURLToPath(new URL('../viewer-dist/', import.meta.url));
const DATA_FILES = new Set(['graph.json', 'descriptions.json', 'diff.json']);
const NAME = /^[\w.-]+$/;
const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
};
const send = (response, status, body, type = 'text/plain; charset=utf-8') => {
    response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    response.end(body);
};
const sendFile = (response, path) => {
    if (!existsSync(path) || !statSync(path).isFile())
        return send(response, 404, 'Not found');
    send(response, 200, readFileSync(path), TYPES[extname(path)] ?? 'application/octet-stream');
};
/** A viewer asset, kept inside viewer-dist whatever the request says. */
const viewerAsset = (rest) => {
    const path = normalize(join(VIEWER, rest || 'index.html'));
    return path.startsWith(VIEWER) ? path : join(VIEWER, 'index.html');
};
const escape = (value) => value.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] ?? char);
const indexPage = (maps) => {
    const projects = readdirSync(maps)
        .filter((name) => NAME.test(name) && existsSync(join(maps, name, 'graph.json')))
        .map((name) => {
        const graph = JSON.parse(readFileSync(join(maps, name, 'graph.json'), 'utf8'));
        const described = existsSync(join(maps, name, 'descriptions.json'));
        return { name, graph, described };
    })
        .sort((a, b) => a.name.localeCompare(b.name));
    const rows = projects
        .map(({ name, graph, described }) => `<li><a href="p/${encodeURIComponent(name)}/">${escape(name)}</a><span>${graph.parts.length} parts, ${graph.files.length} files${described ? '' : ', not described yet'} · ${escape(graph.source.sha?.slice(0, 9) ?? '')} · ${escape(graph.generatedAt.slice(0, 16).replace('T', ' '))}</span></li>`)
        .join('');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sinopia maps</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;padding:24px 16px;background:#f8fafc;color:#0f172a}h1{font-size:20px;margin:0 0 16px}ul{list-style:none;padding:0;margin:0;max-width:640px}li{background:#fff;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:8px;padding:12px 14px}a{color:#1d4ed8;font-weight:600;text-decoration:none;display:block}span{color:#64748b;font-size:13px}</style></head>
<body><h1>Sinopia maps</h1><ul>${rows || '<li>No maps yet.</li>'}</ul></body></html>`;
};
/**
 * Serves the prebuilt viewer and map data over plain HTTP: one map at / with
 * `data`, or every map under `maps` at /p/<name>/ with an index at /.
 */
export const serve = ({ host, port, data, maps }) => {
    if (!existsSync(join(VIEWER, 'index.html'))) {
        throw new Error(`The viewer isn't built (${VIEWER}); run pnpm build in sinopia.`);
    }
    const server = createServer((request, response) => {
        const url = new URL(request.url ?? '/', 'http://map');
        const path = decodeURIComponent(url.pathname);
        if (data) {
            const file = /^\/data\/([\w.-]+)$/.exec(path)?.[1];
            if (file)
                return DATA_FILES.has(file) ? sendFile(response, join(data, file)) : send(response, 404, 'Not found');
            return sendFile(response, viewerAsset(path.slice(1)));
        }
        if (maps) {
            if (path === '/')
                return send(response, 200, indexPage(maps), TYPES['.html']);
            const match = /^\/p\/([^/]+)(\/.*)?$/.exec(path);
            const name = match?.[1];
            if (!match || !name || !NAME.test(name))
                return send(response, 404, 'Not found');
            const rest = match[2] ?? '';
            if (rest === '') {
                response.writeHead(302, { Location: `/p/${encodeURIComponent(name)}/` });
                return response.end();
            }
            const file = /^\/data\/([\w.-]+)$/.exec(rest)?.[1];
            if (file)
                return DATA_FILES.has(file) ? sendFile(response, join(maps, name, file)) : send(response, 404, 'Not found');
            return sendFile(response, viewerAsset(rest.slice(1)));
        }
        send(response, 500, 'Nothing to serve');
    });
    server.listen(port, host, () => {
        console.log(`Serving ${data ? 'the map' : `maps in ${maps}`} at http://${host}:${port}/`);
    });
    return server;
};
