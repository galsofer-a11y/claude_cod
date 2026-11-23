import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BlobsServer } from '@netlify/blobs/server';
import { createHandler } from '../lib/app.js';
import { fileStore } from '../lib/store.js';
import { blobStore } from '../lib/blob-store.js';
import { SECURITY_HEADERS } from '../lib/headers.js';

const point = i => ({ id: `p${i}`, lat: 32 + i / 100, lng: 35, name: '', question: `Q${i}`, hint: '', correct: `ok${i}`, wrong: [`a${i}`, `b${i}`], code: `${7350 + i}` });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'galmon-store-'));

/** מריץ משחק עם כמה שחקנים שעונים בדיוק באותו רגע, ובודק שאף הצבעה לא אבדה */
async function concurrentGame(storage) {
  const api = createHandler({ storage, env: {}, localAdmin: true });
  const call = async (url, { method = 'POST', body, token, cookie } = {}) => {
    const res = await api.handle({
      method, path: `/api${url}`, body: Buffer.from(body ? JSON.stringify(body) : ''), ip: '1', secure: false, local: true,
      headers: { 'x-galmon': '1', ...(token && { authorization: `Bearer ${token}` }), ...(cookie && { cookie }) },
    });
    const data = JSON.parse(res.body);
    if (res.status !== 200) throw new Error(`${url}: ${data.error}`);
    return [data, res.headers['Set-Cookie']];
  };
  const [, cookie] = await call('/admin/local');
  const session = cookie.split(';')[0];
  const [{ code, access }] = await call('/admin/games', { body: { points: [point(0)] }, cookie: session });
  await call(`/admin/games/${code}/open`, { cookie: session });
  const here = { position: { lat: 32, lng: 35, accuracy: 4 } };

  const tokens = await Promise.all(Array.from({ length: 6 }, (_, i) => call(`/games/${code}/join`, { body: { access, name: `n${i}`, team: 0 } }).then(([r]) => r.token)));
  assert.equal(new Set(tokens).size, 6);
  await call(`/games/${code}/me/start`, { token: tokens[0], body: here });
  await Promise.all(tokens.map(t => call(`/games/${code}/me`, { token: t, body: here })));
  const questions = await Promise.all(tokens.map(t => call(`/games/${code}/me/point`, { token: t, body: here }).then(([q]) => q)));
  const answers = await Promise.all(tokens.map((t, i) => call(`/games/${code}/me/answer`, {
    token: t, body: { ...here, id: questions[i].id, choice: questions[i].options.indexOf('ok0') },
  }).then(([a]) => a)));
  assert.ok(answers.every(a => a.correct));
  assert.equal(answers.filter(a => a.solved).length, 1, 'exactly one vote completes the riddle');
  const [view] = await call(`/games/${code}/me`, { token: tokens[0], body: here });
  assert.equal(view.stage, 'task');
}

test('file store: simultaneous answers are never lost', async () => {
  const dir = tmp();
  const store = fileStore(dir);
  // מוסיפים השהיה אקראית כדי שהבקשות ישתלבו זו בזו כמו בשרת אמיתי
  const slow = { ...store, readGame: async code => { const r = await store.readGame(code); await new Promise(res => setTimeout(res, Math.random() * 15)); return r; } };
  await concurrentGame(slow);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Netlify Blobs store: conditional writes, images and simultaneous answers', async t => {
  const dir = tmp();
  const server = new BlobsServer({ directory: dir, token: 'test-token' });
  const { port } = await server.start();
  t.after(async () => { await server.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  const url = `http://localhost:${port}`;
  // שרת הבדיקה המקומי אינו אטומי ומחזיר ETag רק בכתיבה. השכבה הזו מתנהגת כמו Netlify האמיתי:
  // כל רשומה מקבלת גרסה, קריאה מחזירה אותה, וכתיבה מותנית נבדקת ונכתבת בלי שכתיבה אחרת תיכנס באמצע.
  const versions = new Map();
  let queue = Promise.resolve();
  const realLike = (input, init = {}) => {
    const key = String(input.url ?? input).split('?')[0];
    const method = (init.method ?? input.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers ?? input.headers);
    if (method === 'PUT' || method === 'DELETE') {
      const run = queue.then(async () => {
        const ifMatch = headers.get('if-match');
        const ifNoneMatch = headers.get('if-none-match');
        if ((ifMatch && versions.get(key) !== ifMatch) || (ifNoneMatch === '*' && versions.has(key))) {
          return new Response(null, { status: 412 });
        }
        headers.delete('if-match');
        headers.delete('if-none-match');
        const response = await fetch(input, { ...init, headers });
        if (!response.ok) return response;
        if (method === 'DELETE') { versions.delete(key); return response; }
        const etag = `"${Math.random().toString(36).slice(2)}"`;
        versions.set(key, etag);
        const out = new Headers(response.headers);
        out.set('etag', etag);
        return new Response(response.body, { status: response.status, headers: out });
      });
      queue = run.catch(() => {});
      return run;
    }
    return queue.then(async () => {
      const response = await fetch(input, init);
      if (method !== 'GET' || !response.ok || !versions.has(key)) return response;
      const out = new Headers(response.headers);
      out.set('etag', versions.get(key));
      return new Response(response.body, { status: response.status, headers: out });
    });
  };
  const raw = blobStore({ siteID: 'test-site', token: 'test-token', edgeURL: url, uncachedEdgeURL: url });
  await raw.writeGame({ code: 'QQQQQQ', config: { points: [] } }, null);
  await assert.rejects(raw.readGame('QQQQQQ'), /ETag/, 'refuses to work without ETags');
  const store = blobStore({ siteID: 'test-site', token: 'test-token', edgeURL: url, uncachedEdgeURL: url, fetch: realLike });

  const game = { code: 'ABCDEF', config: { points: [] }, n: 1 };
  assert.equal(await store.writeGame(game, null), true);
  assert.equal(await store.writeGame(game, null), false, 'create refuses an existing game');
  const first = await store.readGame('ABCDEF');
  assert.equal(await store.writeGame({ ...game, n: 2 }, first.tag), true);
  assert.equal(await store.writeGame({ ...game, n: 3 }, first.tag), false, 'stale write is rejected');
  assert.equal((await store.readGame('ABCDEF')).game.n, 2);
  assert.equal(await store.health(), 'ok');
  assert.ok((await store.listGames()).every(g => /^[A-Z2-9]{6}$/.test(g.code)), 'health record is not listed as a game');

  await store.writeImage('ABCDEF', 'p1', Buffer.from([0xff, 0xd8, 0xff, 1]));
  assert.deepEqual([...await store.readImage('ABCDEF', 'p1')], [0xff, 0xd8, 0xff, 1]);
  await store.copyImages('ABCDEF', 'GHJKLM');
  assert.ok(await store.readImage('GHJKLM', 'p1'));
  await store.pruneImages({ code: 'GHJKLM', config: { points: [] } });
  assert.equal(await store.readImage('GHJKLM', 'p1'), null);
  await store.deleteGame('ABCDEF');
  assert.equal(await store.readGame('ABCDEF'), null);
  assert.equal(await store.readImage('ABCDEF', 'p1'), null);

  await concurrentGame(store);
});

test('netlify.toml has the same security headers as the local server', () => {
  const toml = fs.readFileSync(new URL('../../netlify.toml', import.meta.url), 'utf8');
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) assert.ok(toml.includes(`${name} = ${JSON.stringify(value)}`), name);
});

test('health check reports settings without revealing values', async () => {
  const dir = tmp();
  const api = createHandler({ storage: fileStore(dir), env: { ADMIN_EMAIL: 'a@b.test', SESSION_SECRET: 'top-secret-value' } });
  const res = await api.handle({ method: 'GET', path: '/api/health', headers: {}, body: Buffer.alloc(0), ip: '1' });
  assert.ok(!res.body.includes('top-secret-value') && !res.body.includes('a@b.test'));
  assert.deepEqual(JSON.parse(res.body), { settings: { ADMIN_EMAIL: true, SESSION_SECRET: true, GOOGLE_CLIENT_ID: false, SMTP_USER: false, SMTP_PASS: false }, storage: 'ok' });
  fs.rmSync(dir, { recursive: true, force: true });
});
