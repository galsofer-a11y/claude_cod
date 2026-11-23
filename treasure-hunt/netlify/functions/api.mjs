// כל בקשות /api/* באתר שב-Netlify עוברות לכאן.
import { createHandler, MAX_BODY } from '../../lib/app.js';
import { blobStore } from '../../lib/blob-store.js';

let api;

export default async (request, context) => {
  api ??= createHandler({ storage: blobStore(), env: process.env });
  const body = ['GET', 'HEAD'].includes(request.method) ? Buffer.alloc(0) : Buffer.from(await request.arrayBuffer());
  if (body.length > MAX_BODY) {
    return Response.json({ error: 'הקובץ גדול מדי' }, { status: 413 });
  }
  const result = await api.handle({
    method: request.method,
    path: new URL(request.url).pathname,
    headers: Object.fromEntries(request.headers),
    body,
    ip: context.ip,
    secure: true,
    local: false,
  });
  return new Response(result.body, { status: result.status, headers: result.headers });
};

export const config = { path: '/api/*' };
