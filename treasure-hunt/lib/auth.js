// כניסת מנהל עם חשבון Google, עוגיית התחברות והגבלת ניסיונות.
import { randomBytes } from 'node:crypto';

const SESSION_MS = 12 * 60 * 60_000;
const COOKIE = 'galmon_admin';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

export function createAuth({ clientId, adminEmail, fetchImpl = fetch, clock = Date.now }) {
  const sessions = new Map();
  const attempts = new Map();

  function cookieOf(req) {
    for (const part of (req.headers.cookie ?? '').split(';')) {
      const [name, ...value] = part.trim().split('=');
      if (name === COOKIE) return value.join('=');
    }
    return null;
  }

  return {
    adminEmail,
    clientId,

    session(req) {
      const token = cookieOf(req);
      const session = token && sessions.get(token);
      if (!session) return null;
      if (session.expires < clock()) {
        sessions.delete(token);
        return null;
      }
      return session;
    },

    login(email, secure) {
      const token = randomBytes(24).toString('base64url');
      sessions.set(token, { email, expires: clock() + SESSION_MS });
      return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}${secure ? '; Secure' : ''}`;
    },

    logout(req) {
      sessions.delete(cookieOf(req));
      return `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
    },

    /** בודק את אסימון ההתחברות מול Google ומחזיר את כתובת המייל אם היא של המנהל */
    async verifyGoogle(credential) {
      if (!clientId || typeof credential !== 'string' || credential.length > 4096) return null;
      const response = await fetchImpl(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return null;
      const info = await response.json();
      const email = String(info.email ?? '').toLowerCase();
      const valid = info.aud === clientId && ISSUERS.has(info.iss) && String(info.email_verified) === 'true' &&
        Number(info.exp) * 1000 > clock() && !!adminEmail && email === adminEmail;
      return valid ? email : null;
    },

    /** true אם עוד מותר לנסות. מונע ניחוש סיסמאות וקודים */
    allow(key, max, windowMs) {
      const now = clock();
      const recent = (attempts.get(key) ?? []).filter(t => now - t < windowMs);
      if (attempts.size > 20_000) attempts.clear();
      if (recent.length >= max) {
        attempts.set(key, recent);
        return false;
      }
      recent.push(now);
      attempts.set(key, recent);
      return true;
    },
  };
}
