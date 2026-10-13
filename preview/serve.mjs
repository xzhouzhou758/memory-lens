// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Dev-only static server for the standalone preview (mock data, no Luker).
//   node preview/serve.mjs [--port 4173] [--cytoscape <path to cytoscape.min.js>]
// Binds to 127.0.0.1 only; serves files from the extension directory and
// maps /lib/cytoscape.min.js to Luker's bundled copy.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const port = Number(arg('--port', process.env.PORT || 4173));

// Cytoscape is not vendored (Luker ships it). Look for a Luker checkout:
// --cytoscape <file>, $LUKER_DIR, or the usual install locations relative
// to this folder (inside Luker's third-party dir, or a sibling checkout).
async function findCytoscape() {
    const explicit = arg('--cytoscape', '');
    const candidates = [
        explicit,
        process.env.LUKER_DIR && path.join(process.env.LUKER_DIR, 'public/lib/cytoscape.min.js'),
        path.resolve(root, '../../../../lib/cytoscape.min.js'), // public/scripts/extensions/third-party/memory-lens
        path.resolve(root, '../Luker/public/lib/cytoscape.min.js'),
        path.resolve(root, '../refs/Luker/public/lib/cytoscape.min.js'),
    ].filter(Boolean).map(p => path.resolve(p));
    for (const candidate of candidates) {
        try {
            await fs.access(candidate);
            return candidate;
        } catch { /* try next */ }
    }
    return '';
}
const cytoscapePath = await findCytoscape();

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

const server = http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://localhost');
        let file;
        if (url.pathname === '/lib/cytoscape.min.js') {
            if (!cytoscapePath) throw new Error('cytoscape not found');
            file = cytoscapePath;
        } else {
            const rel = decodeURIComponent(url.pathname === '/' ? '/preview/index.html' : url.pathname);
            file = path.resolve(root, `.${rel}`);
            if (!file.startsWith(root + path.sep)) {
                res.writeHead(403).end('forbidden');
                return;
            }
        }
        const body = await fs.readFile(file);
        res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
        res.end(body);
    } catch {
        res.writeHead(404).end('not found');
    }
});

server.listen(port, '127.0.0.1', () => {
    console.log(`Memory Lens preview: http://127.0.0.1:${port}/preview/index.html`);
    if (!cytoscapePath) {
        console.warn('Cytoscape not found: the graph view will be empty. Pass --cytoscape <path> or set LUKER_DIR to a Luker checkout.');
    }
});
