// הרצה במחשב: שרת Node שמגיש את האתר ומעביר את בקשות ה-API לליבה המשותפת.
// ב-Netlify אותה ליבה רצה מתוך netlify/functions.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHandler, MAX_BODY } from './lib/app.js';
import { fileStore } from './lib/store.js';
import { SECURITY_HEADERS } from './lib/headers.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg',
};
const isLoopback = address => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function createApp({ dataDir, env = process.env, localAdmin = false, ...options }) {
  const api = createHandler({ storage: fileStore(dataDir), env, localAdmin, ...options });
  const timer = setInterval(() => api.sweep(), 15_000);
  timer.unref();

  const server = http.createServer(async (req, res) => {
    const send = (status, headers, body) => {
      res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
      res.end(body);
    };
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname.startsWith('/api/')) {
      const body = await readBody(req);
      if (!body) return send(413, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ error: 'הקובץ גדול מדי' }));
      const result = await api.handle({
        method: req.method, path: pathname, headers: req.headers, body,
        ip: req.socket.remoteAddress, secure: !!req.socket.encrypted, local: isLoopback(req.socket.remoteAddress),
      });
      return send(result.status, result.headers, result.body);
    }
    const file = path.resolve(PUBLIC, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(PUBLIC + path.sep) || !TYPES[path.extname(file)]) return send(404, { 'Content-Type': 'text/plain' }, 'Not found');
    const data = await readFile(file).catch(() => null);
    return data
      ? send(200, { 'Content-Type': TYPES[path.extname(file)], 'Cache-Control': 'no-cache' }, data)
      : send(404, { 'Content-Type': 'text/plain' }, 'Not found');
  });
  server.on('close', () => clearInterval(timer));
  return server;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  // מקומית נגיש רק מהמחשב הזה. כדי לפתוח לרשת מגדירים HOST=0.0.0.0
  const host = process.env.HOST || '127.0.0.1';
  createApp({ dataDir: process.env.DATA_DIR || path.join(ROOT, 'data'), localAdmin: isLoopback(host) || host === 'localhost' })
    .listen(port, host, () => console.log(`Galmon is running: http://localhost:${port}`))
    .on('error', error => {
      console.error(error.code === 'EADDRINUSE' ? `Port ${port} is busy. The site may already be running.` : error.message);
      process.exitCode = 1;
    });
}
