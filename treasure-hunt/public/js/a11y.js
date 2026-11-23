// תפריט נגישות, הודעת cookies, הצהרת נגישות ומדיניות פרטיות.
import { esc, modal, storage } from './util.js';
import { SITE } from './site-info.js';

const KEY = 'galmon:a11y';
const TOGGLES = [
  ['contrast', 'ניגודיות גבוהה'],
  ['links', 'הדגשת קישורים וכפתורים'],
  ['font', 'גופן קריא'],
  ['still', 'עצירת אנימציות'],
  ['mute', 'השתקת צלילים'],
];
const SIZES = [1, 1.15, 1.3, 1.5];

function apply() {
  const settings = storage.get(KEY, {});
  const html = document.documentElement;
  for (const [name] of TOGGLES) html.classList.toggle(`a11y-${name}`, !!settings[name]);
  html.style.setProperty('--text-scale', SIZES[settings.size ?? 0] ?? 1);
  html.classList.toggle('a11y-large', (settings.size ?? 0) > 0);
}

function update(change) {
  storage.set(KEY, { ...storage.get(KEY, {}), ...change });
  apply();
}

function openMenu() {
  const settings = storage.get(KEY, {});
  const size = settings.size ?? 0;
  const el = modal(`
    <h2>תפריט נגישות</h2>
    <div class="a11y-size" role="group" aria-label="גודל טקסט">
      <button class="btn" data-size="-1" ${size === 0 ? 'disabled' : ''} aria-label="הקטנת טקסט">א-</button>
      <span aria-live="polite">גודל טקסט ${Math.round(SIZES[size] * 100)}%</span>
      <button class="btn" data-size="1" ${size === SIZES.length - 1 ? 'disabled' : ''} aria-label="הגדלת טקסט">א+</button>
    </div>
    ${TOGGLES.map(([name, label]) => `
      <label class="check a11y-option"><input type="checkbox" data-toggle="${name}" ${settings[name] ? 'checked' : ''}> ${label}</label>`).join('')}
    <div class="row" style="margin-top:14px">
      <button class="btn" data-reset>איפוס הגדרות</button>
      <a class="btn" href="#/accessibility">הצהרת נגישות</a>
      <button class="btn primary" data-close>סגירה</button>
    </div>`);
  el.querySelectorAll('[data-toggle]').forEach(box => {
    box.onchange = () => update({ [box.dataset.toggle]: box.checked });
  });
  el.querySelectorAll('[data-size]').forEach(button => {
    button.onclick = () => {
      update({ size: Math.min(SIZES.length - 1, Math.max(0, size + Number(button.dataset.size))) });
      el.close();
      openMenu();
    };
  });
  el.querySelector('[data-reset]').onclick = () => { storage.set(KEY, null); apply(); el.close(); };
  el.querySelector('[data-close]').onclick = () => el.close();
  el.querySelector('a').onclick = () => el.close();
}

export function setupAccessibility() {
  apply();
  const button = document.createElement('button');
  button.className = 'a11y-button';
  button.setAttribute('aria-label', 'תפריט נגישות');
  button.title = 'נגישות';
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" width="28" height="28"><circle cx="12" cy="4" r="2.2" fill="currentColor"/>
    <path d="M4 7.5c2.6.8 5.3 1.2 8 1.2s5.4-.4 8-1.2l.5 1.9c-2 .6-4.1 1-6.2 1.2v3.2l2.4 7.3-1.9.6-2.4-6.6h-.8l-2.4 6.6-1.9-.6 2.4-7.3v-3.2c-2.1-.2-4.2-.6-6.2-1.2z" fill="currentColor"/></svg>`;
  button.onclick = openMenu;
  document.body.append(button);
}

export function cookieNotice() {
  if (storage.get('galmon:cookies')) return;
  const bar = document.createElement('section');
  bar.className = 'cookie-bar';
  bar.setAttribute('aria-label', 'הודעה על cookies');
  bar.innerHTML = `<p>האתר שומר בטלפון נתונים הכרחיים בלבד: את ההשתתפות שלך במשחק, את הגדרות הנגישות, ולמנהל גם עוגיית התחברות.
    אין באתר פרסומות או מעקב סטטיסטי. <a href="#/privacy">פרטים נוספים</a></p><button class="btn sun">הבנתי</button>`;
  bar.querySelector('button').onclick = () => { storage.set('galmon:cookies', Date.now()); bar.remove(); };
  bar.querySelector('a').onclick = () => {};
  document.body.append(bar);
}

const missing = value => value || '<span class="fill-in">[יש להשלים]</span>';

function page(root, title, body) {
  root.innerHTML = `
    <main class="doc" tabindex="-1">
      <a class="btn mini" href="#">חזרה לדף הבית</a>
      <h1>${title}</h1>
      ${body}
    </main>`;
  root.querySelector('main').focus();
  return () => {};
}

export function accessibilityPage(root) {
  return page(root, 'הצהרת נגישות', `
    <p>${esc(SITE.name)} רואה חשיבות בהנגשת האתר לאנשים עם מוגבלות, כדי שכל אחד ואחת יוכלו ליהנות ממשחקי הניווט בשוויון ובכבוד.
      האתר נבנה בהתאם לחוק שוויון זכויות לאנשים עם מוגבלות, התשנ"ח-1998, ולתקנות שוויון זכויות לאנשים עם מוגבלות
      (התאמות נגישות לשירות), התשע"ג-2013.</p>

    <h2>רמת הנגישות</h2>
    <p>האתר נבנה במטרה לעמוד בדרישות התקן הישראלי ת"י 5568 ברמה AA, המבוסס על הנחיות WCAG 2.0 של ארגון W3C.
      ההתאמות נבדקו בדפדפנים Chrome, Edge, Safari ו-Firefox בגרסאותיהם העדכניות, במחשב ובטלפון נייד.</p>

    <h2>התאמות הנגישות באתר</h2>
    <ul>
      <li>תפריט נגישות בכפתור הקבוע בצד המסך: הגדלת טקסט, ניגודיות גבוהה, הדגשת קישורים, גופן קריא, עצירת אנימציות והשתקת צלילים.</li>
      <li>אפשר לנווט בכל האתר במקלדת, וסימון ברור מראה היכן נמצא המיקוד.</li>
      <li>כותרות מסודרות, שפה וכיוון כתיבה מוגדרים, ותוויות לכל שדה בטופס.</li>
      <li>תיאור טקסטואלי לתמונות. מנהל שמעלה תמונה לנקודה חייב לכתוב לה תיאור.</li>
      <li>הודעות המשחק, כמו הגעה לנקודה או תשובה שגויה, מוקראות לתוכנות קורא מסך, ומלוות גם בטקסט ולא רק בצליל או בצבע.</li>
      <li>המרחק והכיוון אל הנקודה הבאה מוצגים גם כטקסט, ולא רק על גבי המפה והמצפן.</li>
      <li>האתר מותאם לטלפונים ולהגדלת תצוגה עד 200%.</li>
    </ul>

    <h2>חלקים שאינם נגישים במלואם</h2>
    <ul>
      <li>המפה האינטראקטיבית מבוססת על שירותי מפות חיצוניים, ואינה נגישה במלואה לקוראי מסך. החלופה: מרחק וכיוון כתובים בכל שלב.</li>
      <li>תמונות וחידות שמעלים מנהלי המשחקים נבדקות על ידם, ואיכות התיאור תלויה בהם.</li>
      <li>המשחק מתקיים בשטח ומחייב תנועה. התאמות במסלול עצמו, כמו נקודות נגישות לכיסא גלגלים, נעשות על ידי מארגן המשחק.</li>
    </ul>
    <p>האתר עוד לא עבר בדיקת נגישות של מורשה נגישות. אם נתקלתם בקושי, נשמח לשמוע ולתקן.</p>

    <h2>פניות בנושא נגישות</h2>
    <p>רכז/ת הנגישות: ${missing(esc(SITE.coordinator))}<br>
      טלפון: ${missing(esc(SITE.phone))}<br>
      דוא"ל: ${SITE.email ? `<a href="mailto:${esc(SITE.email)}">${esc(SITE.email)}</a>` : missing('')}</p>
    <p>כדי שנוכל לטפל בפנייה, נשמח לקבל תיאור של הבעיה, באיזה עמוד היא הופיעה, ובאיזה דפדפן ומכשיר השתמשתם.</p>
    <p class="muted">תאריך עדכון ההצהרה: ${esc(SITE.statementDate)}</p>`);
}

export function privacyPage(root) {
  return page(root, 'פרטיות ו-cookies', `
    <h2>מה נשמר בטלפון או במחשב שלך</h2>
    <ul>
      <li><b>השתתפות במשחק</b>: מזהה שחקן וסיסמת המשחק, כדי שתוכלו לחזור למשחק אחרי רענון. נשמר באחסון המקומי של הדפדפן.</li>
      <li><b>המסלול שהלכת</b>: הקו על המפה נשמר רק במכשיר שלך.</li>
      <li><b>הגדרות נגישות ואישור הודעה זו</b>.</li>
      <li><b>עוגיית התחברות למנהל</b> (galmon_admin): עוגייה הכרחית לכניסת המנהל בלבד, שתוקפה 12 שעות.</li>
    </ul>
    <p>אין באתר עוגיות פרסום או מעקב סטטיסטי. אפשר למחוק את כל הנתונים בהגדרות הדפדפן.</p>

    <h2>מה נשמר בשרת</h2>
    <ul>
      <li>שמות המשתתפים, הקבוצות, התשובות והזמנים, עד שמנהל המשחק מוחק או מאפס את המשחק.</li>
      <li>המיקום שלך בזמן המשחק מוצג למנהל המשחק ומשמש לזיהוי הגעה לנקודה. בשרת נשמר רק המיקום האחרון, והוא נמחק כשהמשחק מסתיים.</li>
      <li>בסיום כל משחק נשלח למנהל מייל עם הדירוג, שמות המשתתפים והחידות שנפתרו.</li>
    </ul>

    <h2>שירותים חיצוניים</h2>
    <p>הדפדפן טוען מפות מ-Israel Hiking Map, OpenTopoMap, OpenStreetMap ו-Waymarked Trails, גופנים מ-Google Fonts,
      את ספריית המפות Leaflet מ-unpkg ותמונות מ-Unsplash. שירותים אלה מקבלים את כתובת ה-IP ואת אזור המפה שנטען.
      כניסת המנהל נעשית דרך Google, שעשויה לשמור עוגיות לפי מדיניות הפרטיות שלה.</p>

    <h2>יצירת קשר</h2>
    <p>מפעיל האתר: ${missing(esc(SITE.owner))}. לבקשות עיון או מחיקה של מידע:
      ${SITE.email ? `<a href="mailto:${esc(SITE.email)}">${esc(SITE.email)}</a>` : missing('')}</p>`);
}
