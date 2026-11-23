import { PHOTOS } from './util.js';
import { adminLogin, enterGame, isAdmin } from './gate.js';

export function home(root) {
  root.innerHTML = `
    <main>
      <section class="hero" style="--photo:url('${PHOTOS.hikers}')">
        <div class="hero-brand">
          <img class="logo" src="/logo.webp" alt="הלוגו של גלמון: מצפן עם תיבת אוצר, שביל ונחל ביער" width="1240" height="1240">
          <div class="hero-title">
            <h1>גלמון</h1>
            <p class="tagline">משחקי ניווט וחפש את המטמון בשבילים</p>
          </div>
        </div>
        <div class="hero-actions">
          <button class="btn sun big" id="enter">כניסה למשחק</button>
          <button class="btn light big" id="admin">כניסת מנהל</button>
        </div>
        <p class="hero-note">צפייה באתר פתוחה לכולם. כדי לשחק צריך קוד משחק וסיסמה מהמנהל.</p>
      </section>
      <section class="stages" aria-label="מהלך המשחק">
        <article class="stage"><img src="${PHOTOS.valley}" alt="מטיילת עם תרמיל בעמק ירוק" loading="lazy">
          <div><h2>מנווטים</h2><p>על מפת שבילים מסומנות כל הנקודות לפי הסדר. המצפן מכוון ליעד הבא.</p></div></article>
        <article class="stage"><img src="${PHOTOS.forest}" alt="שביל ביער" loading="lazy">
          <div><h2>פותרים</h2><p>במרחק 15 מטר מהנקודה נפתחת חידה עם תמונה ורמז. כל הקבוצה צריכה לבחור את אותה תשובה.</p></div></article>
        <article class="stage"><img src="${PHOTOS.ridge}" alt="מטייל על רכס הרים" loading="lazy">
          <div><h2>מוצאים</h2><p>מוצאים את המעטפה, מבצעים את המשימה עם המדריך, וממשיכים. יש לכם 90 דקות.</p></div></article>
      </section>
    </main>
    <footer class="site-footer">
      <a href="#/accessibility">הצהרת נגישות</a> · <a href="#/privacy">פרטיות ו-cookies</a> ·
      צילומים: <a href="https://unsplash.com" target="_blank" rel="noopener">Unsplash</a>
    </footer>`;

  root.querySelector('#enter').onclick = async () => {
    const entered = await enterGame();
    if (entered) location.hash = `#/join/${entered.code}`;
  };
  root.querySelector('#admin').onclick = async () => {
    if (await isAdmin() || await adminLogin()) location.hash = '#/admin';
  };
  return () => {};
}
