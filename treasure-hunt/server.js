import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as rules from './lib/game.js';
import { createStore } from './lib/store.js';
import { createAuth } from './lib/auth.js';
import { sendMail, summaryMail } from './lib/mail.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const MAX_JSON = 512 * 1024;
const MAX_IMAGE = 4 * 1024 * 1024;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg',
};
const GOOGLE = 'https://accounts.google.com/gsi/';
const HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  'Cache-Control': 'no-cache',
  'Content-Security-Policy': [
    "default-src 'self'", `script-src 'self' https://unpkg.com ${GOOGLE}client`,
    `style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com ${GOOGLE}style`,
    'font-src https://fonts.gstatic.com', "img-src 'self' data: blob: https:", `connect-src 'self' ${GOOGLE}`,
    `frame-src ${GOOGLE}`, "frame-ancestors 'self'", "base-uri 'none'", "form-action 'self'",
  ].join('; '),
};
const fail = (message, status = 400) => { throw new rules.GameError(message, status); };
const IMAGE = Symbol('image');

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) fail('הקובץ או המידע גדולים מדי', 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseJson(buffer) {
  if (!buffer.length) return {};
  try {
    const body = JSON.parse(buffer.toString('utf8'));
    if (body && typeof body === 'object') return body;
  } catch { /* מטופל בשורה הבאה */ }
  return fail('בקשה לא תקינה');
}

const isLoopback = address => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);

export function createApp({
  dataDir, clock = Date.now, env = process.env, mailer = sendMail, fetchImpl = fetch, localAdmin = false,
}) {
  const store = createStore(dataDir, clock());
  // כתובת המנהל מוגדרת רק בהגדרות האירוח, כדי שלא תופיע בקוד
  const adminEmail = (env.ADMIN_EMAIL || '').trim().toLowerCase();
  const mailTo = env.MAIL_TO || adminEmail;
  const auth = createAuth({ clientId: env.GOOGLE_CLIENT_ID || '', adminEmail, fetchImpl, clock });
  const smtp = env.SMTP_USER && env.SMTP_PASS && mailTo ? {
    host: env.SMTP_HOST || 'smtp.gmail.com', port: Number(env.SMTP_PORT) || 465, secure: env.SMTP_SECURE !== 'false',
    user: env.SMTP_USER, pass: env.SMTP_PASS.replace(/\s/g, ''), from: env.SMTP_USER, to: mailTo,
  } : null;
  const trustProxy = env.TRUST_PROXY === '1' || !!env.RENDER;
  // כניסת מנהל בלי Google מותרת רק כשאין Google והאתר פתוח למחשב הזה בלבד
  const localLogin = localAdmin && !auth.clientId;

  const ipOf = req => (trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '') || req.socket.remoteAddress;
  const secureOf = req => req.socket.encrypted || (trustProxy && req.headers['x-forwarded-proto'] === 'https');

  async function mail(game) {
    game.pendingMail = false;
    if (!smtp) {
      game.mail = { status: 'skipped', at: clock() };
      return store.save(game);
    }
    game.mail = { status: 'sending', at: clock() };
    store.save(game);
    try {
      await mailer({ ...smtp, ...summaryMail(game, rules.standings(game, clock())) });
      game.mail = { status: 'sent', at: clock() };
    } catch (error) {
      console.error(`Mail for ${game.code} failed: ${error.message}`);
      game.mail = { status: 'error', at: clock(), error: error.message.slice(0, 200) };
    }
    store.save(game);
  }

  function settle(game) {
    if (rules.tick(game, clock())) store.save(game);
    if (game.pendingMail) mail(game);
  }

  // סיום 90 דקות ושליחת מייל קורים גם כשאף אחד לא שולח בקשות
  const timer = setInterval(() => store.all().forEach(settle), 15_000);
  timer.unref();

  function add(config, now) {
    let code;
    do code = rules.newCode(); while (store.get(code));
    const game = rules.createGame(code, config, now);
    store.add(game);
    store.save(game);
    return game;
  }

  async function adminApi(req, res, parts) {
    const route = `${req.method} ${parts.join('/')}`;
    if (route === 'GET session') {
      const session = auth.session(req);
      return { admin: !!session, email: session?.email ?? null };
    }
    if (req.method !== 'GET' && req.headers['x-galmon'] !== '1') fail('בקשה לא מורשית', 403);

    if (route === 'POST google' || route === 'POST local') {
      if (!auth.allow(`login:${ipOf(req)}`, 10, 10 * 60_000)) fail('יותר מדי ניסיונות. נסו שוב בעוד כמה דקות', 429);
      let email = null;
      if (route === 'POST local') {
        if (!localLogin || !isLoopback(req.socket.remoteAddress)) fail('כניסה מקומית אינה זמינה', 403);
        email = auth.adminEmail || 'local';
      } else {
        email = await auth.verifyGoogle(parseJson(await readBody(req, 8192)).credential).catch(() => null);
        if (!email) fail('החשבון הזה אינו חשבון המנהל', 403);
      }
      res.setHeader('Set-Cookie', auth.login(email, secureOf(req)));
      return { admin: true, email };
    }
    if (route === 'POST logout') {
      res.setHeader('Set-Cookie', auth.logout(req));
      return { admin: false };
    }

    if (!auth.session(req)) fail('צריך להיכנס כמנהל', 401);
    const now = clock();
    if (route === 'GET games') {
      store.all().forEach(settle);
      return store.all().map(rules.adminSummary).sort((a, b) => b.createdAt - a.createdAt);
    }
    if (route === 'POST games') return rules.adminSummary(add(parseJson(await readBody(req, MAX_JSON)), now));

    const game = parts[0] === 'games' ? store.get(String(parts[1]).toUpperCase()) : null;
    if (!game) fail('המשחק לא נמצא', 404);
    settle(game);
    const sub = `${req.method} ${parts.slice(2).join('/')}`;
    const view = () => { store.save(game); return rules.adminView(game, clock()); };

    if (parts[2] === 'images' && parts[3]) {
      const point = game.config.points.find(p => p.id === parts[3]);
      if (!point) fail('הנקודה לא נמצאה. שמרו את המסלול ונסו שוב', 404);
      if (req.method === 'GET') {
        if (!point.image) fail('אין תמונה', 404);
        return { [IMAGE]: await store.readImage(game.code, point.id) };
      }
      if (rules.statusOf(game) === 'ended' || game.teams.some(t => t.startedAt)) fail('אי אפשר לערוך אחרי שקבוצה התחילה', 409);
      if (req.method === 'PUT') {
        const data = await readBody(req, MAX_IMAGE);
        if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8 || data[2] !== 0xff) fail('אפשר להעלות רק תמונת JPEG');
        store.writeImage(game.code, point.id, data);
        point.image = rules.id(4);
        return view();
      }
      if (req.method === 'DELETE') {
        store.removeImage(game.code, point.id);
        point.image = null;
        return view();
      }
    }

    switch (sub) {
      case 'GET ': return rules.adminView(game, now);
      case 'PUT ':
        rules.updateConfig(game, parseJson(await readBody(req, MAX_JSON)));
        store.pruneImages(game);
        return view();
      case 'DELETE ': store.remove(game.code); return { deleted: true };
      case 'POST open': rules.openGame(game, now); return view();
      case 'POST end': rules.endGame(game, now); settle(game); return view();
      case 'POST reset': rules.resetGame(game); return view();
      case 'POST access': rules.newAccess(game); return view();
      case 'POST skip': rules.skipPoint(game, parseJson(await readBody(req, 1024)).team, now); settle(game); return view();
      case 'POST mail': await mail(game); return view();
      case 'POST copy': {
        const copy = add({ ...game.config, points: [] }, now);
        copy.config = structuredClone(game.config);
        store.copyImages(game.code, copy.code);
        store.save(copy);
        return rules.adminSummary(copy);
      }
      default: return fail('הפעולה לא נמצאה', 404);
    }
  }

  async function playerApi(req, parts) {
    const game = parts[0] === 'games' ? store.get(String(parts[1]).toUpperCase()) : null;
    if (!game) fail('לא מצאנו משחק עם הקוד הזה', 404);
    const now = clock();
    const route = `${req.method} ${parts.slice(2).join('/')}`;
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    settle(game);

    if (route === 'POST enter' || route === 'POST join') {
      if (!auth.allow(`access:${ipOf(req)}:${game.code}`, 12, 10 * 60_000)) fail('יותר מדי ניסיונות. נסו שוב בעוד כמה דקות', 429);
      const body = parseJson(await readBody(req, 4096));
      rules.checkAccess(game, body.access);
      if (route === 'POST enter') return rules.publicView(game);
      const joined = { token: rules.join(game, body, now) };
      store.save(game);
      return joined;
    }

    const player = rules.requirePlayer(game, token);
    rules.seen(player, now);
    const team = game.teams[player.team];
    const done = value => { settle(game); store.save(game); return value; };

    switch (route) {
      case 'POST me': {
        rules.setPosition(player, parseJson(await readBody(req, 4096)).position, now);
        settle(game);
        return rules.playerView(game, player, now);
      }
      case 'GET me/image': {
        const pointId = rules.imageOf(game, player, now);
        return { [IMAGE]: await store.readImage(game.code, pointId) };
      }
      case 'POST me/start': rules.startTeam(game, player, now); return done(rules.playerView(game, player, now));
      case 'POST me/point': return done(rules.openPoint(game, player, now));
      case 'POST me/answer': {
        const result = rules.answer(game, player, parseJson(await readBody(req, 1024)), now);
        return done({ ...result, view: rules.playerView(game, player, now) });
      }
      case 'POST me/code': {
        if (!auth.allow(`code:${ipOf(req)}`, 30, 10 * 60_000)) fail('יותר מדי ניסיונות', 429);
        const stepBefore = team.step;
        rules.submitCode(game, player, parseJson(await readBody(req, 1024)), now);
        return done({ advanced: team.step > stepBefore, view: rules.playerView(game, player, now) });
      }
      case 'POST me/leave': rules.leave(game, token); return done({});
      default: return fail('הפעולה לא נמצאה', 404);
    }
  }

  const server = http.createServer(async (req, res) => {
    const send = (status, type, data, extra = {}) => {
      res.writeHead(status, { ...HEADERS, 'Content-Type': type, ...extra });
      res.end(data);
    };
    try {
      const { pathname } = new URL(req.url, 'http://localhost');
      if (pathname.startsWith('/api/')) {
        const parts = pathname.slice(5).split('/').filter(Boolean).map(decodeURIComponent);
        let result;
        if (parts[0] === 'site') result = { googleClientId: auth.clientId || null, localAdmin: localLogin, mail: !!smtp };
        else if (parts[0] === 'admin') result = await adminApi(req, res, parts.slice(1));
        else result = await playerApi(req, parts);
        if (result?.[IMAGE]) return send(200, 'image/jpeg', result[IMAGE], { 'Cache-Control': 'private, max-age=600' });
        return send(200, 'application/json; charset=utf-8', JSON.stringify(result));
      }
      const file = path.resolve(PUBLIC, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!file.startsWith(PUBLIC + path.sep) || !TYPES[path.extname(file)]) return send(404, 'text/plain', 'Not found');
      const data = await readFile(file).catch(() => null);
      return data ? send(200, TYPES[path.extname(file)], data) : send(404, 'text/plain', 'Not found');
    } catch (error) {
      const known = error instanceof rules.GameError;
      const missing = error.code === 'ENOENT';
      if (!known && !missing) console.error(error);
      const status = known ? error.status : missing ? 404 : 500;
      send(status, 'application/json; charset=utf-8', JSON.stringify({ error: known ? error.message : missing ? 'הקובץ לא נמצא' : 'אירעה תקלה בשרת' }));
    }
  });
  server.on('close', () => clearInterval(timer));
  return server;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  // מקומית נגיש רק מהמחשב הזה. באירוח מגדירים HOST=0.0.0.0
  const host = process.env.HOST || (process.env.RENDER ? '0.0.0.0' : '127.0.0.1');
  createApp({ dataDir: process.env.DATA_DIR || path.join(ROOT, 'data'), localAdmin: isLoopback(host) || host === 'localhost' })
    .listen(port, host, () => console.log(`Galmon is running: http://localhost:${port}`))
    .on('error', error => {
      console.error(error.code === 'EADDRINUSE' ? `Port ${port} is busy. The site may already be running.` : error.message);
      process.exitCode = 1;
    });
}
