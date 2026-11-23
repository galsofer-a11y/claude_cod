// כל פעולות ה-API, בלי תלות בשרת. אותו קוד רץ במחשב (server.js) וב-Netlify (netlify/functions).
import * as rules from './game.js';
import { createAuth } from './auth.js';
import { sendMail, summaryMail } from './mail.js';

export const MAX_BODY = 4 * 1024 * 1024;
const MAX_JSON = 512 * 1024;
const SAVE_EVERY_MS = 10_000;   // שחקן שעומד במקום נשמר לכל היותר פעם ב-10 שניות
const ACCESS_TRIES = 20;
const ACCESS_WINDOW_MS = 10 * 60_000;
const CODE = /^[A-Z2-9]{6}$/;
const IMAGE = Symbol('image');
const API_HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

const fail = (message, status = 400) => { throw new rules.GameError(message, status); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function json(body, limit = MAX_JSON) {
  if (body.length > limit) fail('המידע גדול מדי', 413);
  if (!body.length) return {};
  try {
    const value = JSON.parse(body.toString('utf8'));
    if (value && typeof value === 'object') return value;
  } catch { /* מטופל בשורה הבאה */ }
  return fail('בקשה לא תקינה');
}

export function createHandler({ storage, env = {}, clock = Date.now, mailer = sendMail, fetchImpl = fetch, localAdmin = false }) {
  // כתובת המנהל מוגדרת רק בהגדרות האירוח, כדי שלא תופיע בקוד
  const adminEmail = (env.ADMIN_EMAIL || '').trim().toLowerCase();
  const mailTo = env.MAIL_TO || adminEmail;
  const auth = createAuth({ clientId: env.GOOGLE_CLIENT_ID || '', adminEmail, secret: env.SESSION_SECRET, fetchImpl, clock });
  const googleReady = !!(env.GOOGLE_CLIENT_ID && env.SESSION_SECRET && adminEmail);
  const localLogin = localAdmin && !env.GOOGLE_CLIENT_ID;
  const smtp = env.SMTP_USER && env.SMTP_PASS && mailTo ? {
    host: env.SMTP_HOST || 'smtp.gmail.com', port: Number(env.SMTP_PORT) || 465, secure: env.SMTP_SECURE !== 'false',
    user: env.SMTP_USER, pass: env.SMTP_PASS.replace(/\s/g, ''), from: env.SMTP_USER, to: mailTo,
  } : null;

  /**
   * קורא משחק, מריץ עליו שינוי ושומר רק אם אף אחד אחר לא שמר בינתיים.
   * fn מחזירה [תוצאה, האם לשמור]. בהתנגשות קוראים מחדש ומנסים שוב.
   */
  async function mutate(code, fn) {
    if (!CODE.test(code)) fail('לא מצאנו משחק עם הקוד הזה', 404);
    for (let attempt = 0; attempt < 10; attempt++) {
      const found = await storage.readGame(code);
      if (!found) fail('לא מצאנו משחק עם הקוד הזה', 404);
      const game = rules.upgrade(found.game, clock());
      const [result, dirty] = await fn(game);
      if (!dirty && game === found.game) return { result, game };
      if (await storage.writeGame(game, found.tag)) return { result, game };
      await sleep(15 + Math.random() * 40 * (attempt + 1));
    }
    return fail('השרת עמוס כרגע. נסו שוב בעוד רגע', 503);
  }

  async function create(config) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const game = rules.createGame(rules.newCode(), config, clock());
      if (await storage.writeGame(game, null)) return game;
    }
    return fail('לא הצלחנו ליצור משחק. נסו שוב', 503);
  }

  /** שולח את מייל הסיכום פעם אחת בלבד, גם אם כמה בקשות מגיעות יחד */
  async function deliver(code) {
    const { result: claimed, game } = await mutate(code, g => {
      if (!g.pendingMail) return [false, false];
      g.pendingMail = false;
      g.mail = { status: smtp ? 'sending' : 'skipped', at: clock() };
      return [true, true];
    });
    if (!claimed || !smtp) return;
    let mail;
    try {
      await mailer({ ...smtp, ...summaryMail(game, rules.standings(game, clock())) });
      mail = { status: 'sent', at: clock() };
    } catch (error) {
      console.error(`Mail for ${code} failed: ${error.message}`);
      mail = { status: 'error', at: clock(), error: error.message.slice(0, 200) };
    }
    await mutate(code, g => { g.mail = mail; return [null, true]; });
  }

  /** בודק סיום 90 דקות ומיילים שממתינים, גם כשאף אחד לא שולח בקשות */
  async function sweep() {
    for (const game of await storage.listGames()) {
      try {
        if (rules.statusOf(game) === 'open') await mutate(game.code, g => [null, rules.tick(g, clock())]);
        await deliver(game.code);
      } catch (error) {
        console.error(`Sweep ${game.code}: ${error.message}`);
      }
    }
  }

  async function admin(req, parts, out) {
    const route = `${req.method} ${parts.join('/')}`;
    if (route === 'GET session') {
      const session = auth.session(req.headers);
      return { admin: !!session, email: session?.email ?? null };
    }
    if (req.method !== 'GET' && req.headers['x-galmon'] !== '1') fail('בקשה לא מורשית', 403);

    if (route === 'POST google' || route === 'POST local') {
      if (!auth.allow(`login:${req.ip}`, 10, 10 * 60_000)) fail('יותר מדי ניסיונות. נסו שוב בעוד כמה דקות', 429);
      let email;
      if (route === 'POST local') {
        if (!localLogin || !req.local) fail('כניסה מקומית אינה זמינה', 403);
        email = adminEmail || 'local';
      } else {
        if (!googleReady) fail('כניסת Google לא הוגדרה עד הסוף באתר (ראו README)', 503);
        email = await auth.verifyGoogle(json(req.body, 8192).credential).catch(() => null);
        if (!email) fail('החשבון הזה אינו חשבון המנהל', 403);
      }
      out.cookie = auth.login(email, req.secure);
      return { admin: true, email };
    }
    if (route === 'POST logout') {
      out.cookie = auth.logout();
      return { admin: false };
    }

    if (!auth.session(req.headers)) fail('צריך להיכנס כמנהל', 401);
    if (route === 'GET games') {
      return (await storage.listGames()).map(rules.adminSummary).sort((a, b) => b.createdAt - a.createdAt);
    }
    if (route === 'POST games') return rules.adminSummary(await create(json(req.body)));

    const code = String(parts[1] ?? '').toUpperCase();
    if (parts[0] !== 'games' || !CODE.test(code)) fail('המשחק לא נמצא', 404);
    const sub = `${req.method} ${parts.slice(2).join('/')}`;
    const change = async (fn, write = true) => {
      const { result } = await mutate(code, g => {
        const now = clock();
        const ticked = rules.tick(g, now);
        const value = fn(g, now);
        return [value ?? rules.adminView(g, now), write || ticked];
      });
      return result;
    };

    if (parts[2] === 'images' && parts[3]) {
      const pointId = parts[3];
      const editable = (g, needImage) => {
        const point = g.config.points.find(p => p.id === pointId);
        if (!point) fail('הנקודה לא נמצאה. שמרו את המסלול ונסו שוב', 404);
        if (needImage && !point.image) fail('אין תמונה', 404);
        return point;
      };
      if (req.method === 'GET') {
        await change(g => { editable(g, true); return true; }, false);
        const image = await storage.readImage(code, pointId);
        if (!image) fail('אין תמונה', 404);
        return { [IMAGE]: image };
      }
      const locked = g => {
        if (rules.statusOf(g) === 'ended' || g.teams.some(t => t.startedAt)) fail('אי אפשר לערוך אחרי שקבוצה התחילה', 409);
      };
      if (req.method === 'PUT') {
        const data = req.body;
        if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8 || data[2] !== 0xff) fail('אפשר להעלות רק תמונת JPEG');
        await change(g => { locked(g); editable(g); return true; }, false);
        await storage.writeImage(code, pointId, data);
        return change(g => { locked(g); editable(g).image = rules.id(4); });
      }
      if (req.method === 'DELETE') {
        const view = await change(g => { locked(g); editable(g).image = null; });
        await storage.deleteImage(code, pointId);
        return view;
      }
    }

    switch (sub) {
      case 'GET ': return change(() => null, false);
      case 'PUT ': {
        const config = json(req.body);
        const view = await change(g => { rules.updateConfig(g, config); });
        await storage.pruneImages({ code, config: view.config });
        return view;
      }
      case 'DELETE ': await storage.deleteGame(code); return { deleted: true };
      case 'POST open': return change((g, now) => { rules.openGame(g, now); });
      case 'POST end': {
        const view = await change((g, now) => { rules.endGame(g, now); });
        await deliver(code);
        return view;
      }
      case 'POST reset': return change(g => { rules.resetGame(g); });
      case 'POST access': return change(g => { rules.newAccess(g); });
      case 'POST skip': {
        const { team } = json(req.body, 1024);
        const view = await change((g, now) => { rules.skipPoint(g, team, now); });
        await deliver(code);
        return view;
      }
      case 'POST mail': {
        await change(g => { g.pendingMail = true; });
        await deliver(code);
        return change(() => null, false);
      }
      case 'POST copy': {
        const { result: source } = await mutate(code, g => [g, false]);
        const copy = await create({ ...source.config, points: [] });
        copy.config = structuredClone(source.config);
        await storage.copyImages(code, copy.code);
        await mutate(copy.code, g => { g.config = copy.config; return [null, true]; });
        return rules.adminSummary(copy);
      }
      default: return fail('הפעולה לא נמצאה', 404);
    }
  }

  async function player(req, parts) {
    const code = String(parts[1] ?? '').toUpperCase();
    if (parts[0] !== 'games') fail('הפעולה לא נמצאה', 404);
    const route = `${req.method} ${parts.slice(2).join('/')}`;
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    const body = json(req.body, 8192);

    if (route === 'POST enter' || route === 'POST join') {
      const { result } = await mutate(code, g => {
        const now = clock();
        const fails = (g.accessFails ?? []).filter(t => now - t < ACCESS_WINDOW_MS);
        if (fails.length >= ACCESS_TRIES) fail('יותר מדי ניסיונות שגויים. נסו שוב בעוד כמה דקות', 429);
        if (!rules.accessOk(g, body.access)) {
          g.accessFails = [...fails, now];
          return [{ denied: true }, true];
        }
        if (route === 'POST enter') return [rules.publicView(g), false];
        return [{ token: rules.join(g, body, now) }, true];
      });
      if (result.denied) fail('הסיסמה למשחק שגויה', 403);
      return result;
    }

    const action = parts.slice(3).join('/');
    const { result, game } = await mutate(code, g => {
      const now = clock();
      const p = rules.requirePlayer(g, token);
      const ticked = rules.tick(g, now);
      const moved = rules.setPosition(p, body.position, now);
      // שומרים מיקום רק כשזז או כשעבר זמן, כדי לחסוך כתיבות
      const due = moved || now - (p.savedAt ?? 0) >= SAVE_EVERY_MS;
      if (due) {
        p.savedAt = now;
        rules.seen(p, now);
      }
      switch (`${req.method} ${action}`) {
        case 'POST ': return [rules.playerView(g, p, now), ticked || due];
        case 'POST start': rules.startTeam(g, p, now); return [rules.playerView(g, p, now), true];
        case 'POST point': return [rules.openPoint(g, p, now), true];
        case 'POST image': return [{ pointId: rules.imageOf(g, p, now) }, ticked || due];
        case 'POST answer': {
          const answer = rules.answer(g, p, body, now);
          return [{ ...answer, view: rules.playerView(g, p, now) }, true];
        }
        case 'POST code': {
          rules.submitCode(g, p, body, now);
          return [{ view: rules.playerView(g, p, now) }, true];
        }
        case 'POST leave': rules.leave(g, token); return [{}, true];
        default: return fail('הפעולה לא נמצאה', 404);
      }
    });
    if (game.pendingMail) await deliver(code);
    if (result.pointId) {
      const image = await storage.readImage(code, result.pointId);
      if (!image) fail('התמונה לא נמצאה', 404);
      return { [IMAGE]: image };
    }
    return result;
  }

  /** req: { method, path, headers (אותיות קטנות), body: Buffer, ip, secure, local } */
  async function handle(req) {
    const out = {};
    try {
      const parts = req.path.replace(/^\/api\//, '').split('/').filter(Boolean).map(decodeURIComponent);
      let result;
      if (parts[0] === 'site') result = { googleClientId: googleReady ? env.GOOGLE_CLIENT_ID : null, localAdmin: localLogin, mail: !!smtp };
      else if (parts[0] === 'health') {
        // מראה אילו הגדרות קיימות, בלי לחשוף את הערכים שלהן
        if (!auth.allow(`health:${req.ip}`, 6, 60_000)) fail('נסו שוב בעוד דקה', 429);
        result = {
          settings: {
            ADMIN_EMAIL: !!adminEmail, SESSION_SECRET: !!env.SESSION_SECRET, GOOGLE_CLIENT_ID: !!env.GOOGLE_CLIENT_ID,
            SMTP_USER: !!env.SMTP_USER, SMTP_PASS: !!env.SMTP_PASS,
          },
          storage: await storage.health().catch(error => `error: ${error.message.slice(0, 120)}`),
        };
      }
      else if (parts[0] === 'admin') result = await admin(req, parts.slice(1), out);
      else result = await player(req, parts);
      const headers = { ...API_HEADERS, ...(out.cookie && { 'Set-Cookie': out.cookie }) };
      if (result?.[IMAGE]) return { status: 200, headers: { ...headers, 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=600' }, body: result[IMAGE] };
      return { status: 200, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(result) };
    } catch (error) {
      const known = error instanceof rules.GameError;
      if (!known) console.error(error);
      return {
        status: known ? error.status : 500,
        headers: { ...API_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ error: known ? error.message : 'אירעה תקלה בשרת' }),
      };
    }
  }

  return { handle, sweep };
}
