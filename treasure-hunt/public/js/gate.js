// חלונות הכניסה: סיסמת משחק לשחקנים, וחשבון Google למנהל.
import { api, esc, modal, storage, toast } from './util.js';

export const accessKey = code => `galmon:access:${code}`;

/** מבקש קוד משחק (אם חסר) וסיסמה. מחזיר את פרטי המשחק אחרי בדיקה בשרת, או null */
export function enterGame(code = null) {
  return new Promise(resolve => {
    const el = modal(`
      <h2>כניסה למשחק</h2>
      <p>את קוד המשחק והסיסמה מקבלים ממנהל המשחק.</p>
      <form id="enter-form">
        ${code ? `<p>קוד המשחק: <b dir="ltr">${esc(code)}</b></p>` : `
        <label>קוד המשחק<input class="code" name="code" maxlength="6" minlength="6" required autocomplete="off" autocapitalize="characters"></label>`}
        <label>סיסמה<input class="code" name="access" inputmode="numeric" maxlength="6" minlength="6" required autocomplete="off"></label>
        <p class="error" id="enter-error" role="alert"></p>
        <div class="row"><button class="btn primary">כניסה</button><button class="btn" type="button" data-cancel>ביטול</button></div>
      </form>`);
    let result = null;
    el.querySelector('[data-cancel]').onclick = () => el.close();
    el.addEventListener('close', () => resolve(result));
    el.querySelector('form').onsubmit = async event => {
      event.preventDefault();
      const data = new FormData(event.target);
      const gameCode = (code ?? data.get('code').trim().toUpperCase());
      const access = data.get('access').trim();
      const error = el.querySelector('#enter-error');
      const button = event.target.querySelector('button');
      if (!/^[A-Z2-9]{6}$/.test(gameCode)) {
        error.textContent = 'קוד המשחק מורכב מ-6 אותיות באנגלית וספרות';
        return;
      }
      button.disabled = true;
      try {
        const info = await api(`/games/${gameCode}/enter`, { method: 'POST', body: { access } });
        storage.set(accessKey(gameCode), access);
        result = { code: gameCode, access, info };
        el.close();
      } catch (e) {
        error.textContent = e.message;
        button.disabled = false;
      }
    };
  });
}

let googleScript = null;
function loadGoogle() {
  googleScript ??= new Promise((resolve, reject) => {
    const script = Object.assign(document.createElement('script'), { src: 'https://accounts.google.com/gsi/client', async: true });
    script.onload = resolve;
    script.onerror = () => { googleScript = null; reject(new Error('לא הצלחנו לטעון את הכניסה של Google')); };
    document.head.append(script);
  });
  return googleScript;
}

export async function isAdmin() {
  try { return (await api('/admin/session')).admin; } catch { return false; }
}

/** חלון כניסת מנהל. מחזיר true אחרי כניסה מוצלחת */
export async function adminLogin() {
  const site = await api('/site').catch(() => ({}));
  return new Promise(resolve => {
    let ok = false;
    const el = modal(`
      <h2>כניסת מנהל</h2>
      <p>בניית משחקים וניהולם פתוחים רק לחשבון המנהל.</p>
      <div id="google-button" class="google-button"></div>
      ${site.localAdmin ? '<button class="btn primary wide" id="local-login">כניסת מנהל מקומית (רק במחשב הזה)</button>' : ''}
      ${!site.googleClientId && !site.localAdmin ? '<p class="notice">כניסה עם Google עוד לא הוגדרה באתר. ההוראות נמצאות בקובץ README.</p>' : ''}
      <p class="error" id="login-error" role="alert"></p>
      <button class="btn" data-cancel>ביטול</button>`);
    el.querySelector('[data-cancel]').onclick = () => el.close();
    el.addEventListener('close', () => resolve(ok));
    const error = el.querySelector('#login-error');
    const done = async request => {
      try {
        await request();
        ok = true;
        el.close();
      } catch (e) {
        error.textContent = e.message;
      }
    };

    el.querySelector('#local-login')?.addEventListener('click', () => done(() => api('/admin/local', { method: 'POST' })));

    if (site.googleClientId) {
      loadGoogle().then(() => {
        if (!el.isConnected) return;
        google.accounts.id.initialize({
          client_id: site.googleClientId,
          callback: ({ credential }) => done(() => api('/admin/google', { method: 'POST', body: { credential } })),
        });
        google.accounts.id.renderButton(el.querySelector('#google-button'), { theme: 'filled_blue', size: 'large', text: 'signin_with', locale: 'he' });
      }).catch(e => { error.textContent = e.message; });
    }
  });
}

export async function requireAdmin() {
  if (await isAdmin()) return true;
  if (await adminLogin()) return true;
  toast('הכניסה בוטלה');
  location.hash = '#';
  return false;
}
