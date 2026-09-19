// Copyright (C) 2026 Flashforge Health contributors
// SPDX-License-Identifier: AGPL-3.0-only
// A static-only origin for local preview or a future public tunnel.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { PUBLIC_CSP, PUBLIC_IMAGE } from './static-home.mjs';

const page = new URL('../static-site/index.html', import.meta.url);
const port = Number(process.env.STATIC_PORT || 8080);
const headers = { 'Cache-Control': 'no-store', 'Content-Security-Policy': `${PUBLIC_CSP}; frame-ancestors 'none'`, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' };
const server = http.createServer(async (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { ...headers, Allow: 'GET, HEAD' }); res.end(); return; }
  const image = req.url.startsWith('/images/') && PUBLIC_IMAGE.test(req.url.slice(8)) ? req.url.slice(8) : null;
  if (!image && !['/', '/index.html'].includes(req.url)) { res.writeHead(404, headers); res.end(); return; }
  try {
    const body = await readFile(image ? new URL(`../static-site/images/${image}`, import.meta.url) : page);
    res.writeHead(200, { ...headers, 'Cache-Control': image ? 'public, max-age=31536000, immutable' : 'no-store', 'Content-Type': image ? 'image/webp' : 'text/html; charset=utf-8', 'Content-Length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    if (image) { res.writeHead(404, headers); res.end(); return; }
    res.writeHead(503, { ...headers, 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '60' });
    res.end(req.method === 'HEAD' ? undefined : 'Snapshot unavailable. Try again in one minute.');
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Static Home page: http://localhost:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
