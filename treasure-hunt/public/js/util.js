const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ESCAPES[c]);

const photo = (id, width = 1600) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${width}&q=72`;
export const PHOTOS = {
  hikers: photo('1551632811-561732d1e306', 2000),
  valley: photo('1501555088652-021faa106b9b'),
  forest: photo('1441974231531-c6227db76b6e'),
  ridge: photo('1533240332313-0db49b459ad6'),
};

export const blaze = color => `<i class="blaze" style="--c:${esc(color)}" aria-hidden="true"></i>`;

export function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const two = n => String(n).padStart(2, '0');
  const tail = `${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`;
  return s >= 3600 ? `${Math.floor(s / 3600)}:${tail}` : tail;
}

export const meters = m => (m < 1000 ? `${Math.round(m)} מ׳` : `${(m / 1000).toFixed(m < 10000 ? 2 : 0)} ק״מ`);
export const people = n => (n === 1 ? 'משתתף אחד' : `${n} משתתפים`);

/** קריאה לשרת. בקשות מנהל נשלחות עם כותרת שמונעת זיוף בקשות מאתר אחר */
export async function api(path, { method = 'GET', body, token, raw, type, blob } = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: {
        'X-Galmon': '1',
        ...(body && { 'Content-Type': 'application/json' }),
        ...(type && { 'Content-Type': type }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: raw ?? (body && JSON.stringify(body)),
      signal: AbortSignal.timeout?.(20000),
    });
  } catch {
    throw new Error('אין חיבור לשרת. בדקו את הקליטה');
  }
  if (response.ok && blob) return response.blob();
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || 'אירעה תקלה'), { status: response.status });
  return data;
}

export const storage = {
  get(key, fallback = null) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try {
      if (value === null || value === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch { /* גלישה פרטית */ }
  },
};

/** מחליף HTML רק כשהשתנה, ושומר אילו אזורים היו פתוחים. */
export function put(element, html) {
  if (!element || element._html === html) return;
  const open = new Set([...element.querySelectorAll('details[open][data-key]')].map(d => d.dataset.key));
  element.innerHTML = html;
  element._html = html;
  element.querySelectorAll('details[data-key]').forEach(d => { if (open.has(d.dataset.key)) d.open = true; });
}

let toastTimer;
export function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 4000);
}

export function modal(html, { label } = {}) {
  const el = document.createElement('dialog');
  el.innerHTML = html;
  const heading = el.querySelector('h2');
  if (heading) {
    heading.id ||= `dialog-${Math.random().toString(36).slice(2, 8)}`;
    el.setAttribute('aria-labelledby', heading.id);
  } else if (label) {
    el.setAttribute('aria-label', label);
  }
  document.body.append(el);
  el.addEventListener('close', () => el.remove());
  el.showModal();
  return el;
}

export function ask(title, message, okLabel) {
  return new Promise(resolve => {
    const el = modal(`<h2>${esc(title)}</h2><p>${esc(message)}</p>
      <div class="row"><button class="btn primary" data-ok>${esc(okLabel)}</button><button class="btn" data-no>ביטול</button></div>`);
    el.querySelector('[data-ok]').onclick = () => { resolve(true); el.close(); };
    el.querySelector('[data-no]').onclick = () => el.close();
    el.addEventListener('close', () => resolve(false));
  });
}

export async function shareText(text, title) {
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ title, text }); } catch { /* המשתמש סגר את חלון השיתוף */ }
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('הועתק');
  } catch {
    toast('לא הצלחנו להעתיק. סמנו את הטקסט והעתיקו');
  }
}
