// כניסת מנהל עם חשבון Google. ההתחברות נשמרת בעוגייה חתומה, כך שאין צורך בזיכרון משותף בין שרתים.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const SESSION_MS = 12 * 60 * 60_000;
const COOKIE = 'galmon_admin';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

export function createAuth({ clientId, adminEmail, secret, fetchImpl = fetch, clock = Date.now }) {
  const key = secret || randomBytes(32).toString('hex');
  const attempts = new Map();
  const sign = value => createHmac('sha256', key).update(value).digest('base64url');

  function cookieOf(headers) {
    for (const part of (headers.cookie ?? '').split(';')) {
      const [name, ...value] = part.trim().split('=');
      if (name === COOKIE) return value.join('=');
    }
    return null;
  }

  return {
    adminEmail,
    clientId,

    session(headers) {
      const [payload, signature] = (cookieOf(headers) ?? '').split('.');
      if (!payload || !signature) return null;
      const expected = Buffer.from(sign(payload));
      const given = Buffer.from(signature);
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
      try {
        const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        return session.expires > clock() ? session : null;
      } catch {
        return null;
      }
    },

    login(email, secure) {
      const payload = Buffer.from(JSON.stringify({ email, expires: clock() + SESSION_MS })).toString('base64url');
      return `${COOKIE}=${payload}.${sign(payload)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}${secure ? '; Secure' : ''}`;
    },

    logout: () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`,

    /** בודק את אסימון ההתחברות מול Google ומחזיר את כתובת המייל אם היא של המנהל */
    async verifyGoogle(credential) {
      if (!clientId || typeof credential !== 'string' || credential.length > 4096) return null;
      const response = await fetchImpl(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`, {
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) return null;
      const info = await response.json();
      const email = String(info.email ?? '').toLowerCase();
      const valid = info.aud === clientId && ISSUERS.has(info.iss) && String(info.email_verified) === 'true' &&
        Number(info.exp) * 1000 > clock() && !!adminEmail && email === adminEmail;
      return valid ? email : null;
    },

    /** true אם עוד מותר לנסות. הגבלה בזיכרון של השרת הנוכחי בלבד */
    allow(name, max, windowMs) {
      const now = clock();
      const recent = (attempts.get(name) ?? []).filter(t => now - t < windowMs);
      if (attempts.size > 20_000) attempts.clear();
      if (recent.length >= max) return false;
      recent.push(now);
      attempts.set(name, recent);
      return true;
    },
  };
}
