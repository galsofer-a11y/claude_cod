// רשימת כל המשחקים, למנהל בלבד.
import { api, ask, blaze, esc, put, toast } from './util.js';
import { requireAdmin } from './gate.js';

const STATUS = { draft: 'בבנייה', open: 'פתוח למשחק', ended: 'הסתיים' };

/** מחיקה ואיפוס משותפים לרשימה ולמסך הניהול */
export async function resetGame(code, title) {
  if (!await ask('לאפס את המשחק?', `כל המשתתפים, התשובות והזמנים של "${title}" יימחקו. המסלול והחידות נשמרים, ואפשר לשחק מחדש.`, 'איפוס')) return false;
  await api(`/admin/games/${code}/reset`, { method: 'POST' });
  toast('המשחק אופס');
  return true;
}

export async function deleteGame(code, title) {
  if (!await ask('למחוק את המשחק?', `"${title}" יימחק לגמרי, כולל המסלול, התמונות והתוצאות. אי אפשר לשחזר.`, 'מחיקה לצמיתות')) return false;
  await api(`/admin/games/${code}`, { method: 'DELETE' });
  toast('המשחק נמחק');
  return true;
}

export function gamesList(root) {
  let dead = false, games = [];
  root.innerHTML = '<main class="admin"><p>טוענים…</p></main>';

  async function load() {
    try {
      games = await api('/admin/games');
      if (!dead) render();
    } catch (error) {
      if (error.status === 401 && await requireAdmin()) return load();
      if (!dead) toast(error.message);
    }
  }

  function render() {
    root.innerHTML = `
      <header class="admin-bar">
        <a class="brand" href="#"><img src="/logo.webp" alt="" width="40" height="40"> גלמון</a>
        <span class="grow">ניהול משחקים</span>
        <button class="btn mini light" id="logout">יציאה</button>
      </header>
      <main class="admin" tabindex="-1">
        <form id="create" class="create-game">
          <label>שם למשחק חדש<input name="title" maxlength="60" required placeholder="לדוגמה: טיול משפחתי בכרמל"></label>
          <button class="btn sun">בניית משחק חדש</button>
        </form>
        <h1>המשחקים</h1>
        <div id="list"></div>
      </main>`;
    root.querySelector('#logout').onclick = async () => {
      await api('/admin/logout', { method: 'POST' }).catch(() => {});
      location.hash = '#';
    };
    root.querySelector('#create').onsubmit = async event => {
      event.preventDefault();
      const button = event.target.querySelector('button');
      button.disabled = true;
      try {
        const game = await api('/admin/games', { method: 'POST', body: { title: new FormData(event.target).get('title') } });
        location.hash = `#/admin/${game.code}`;
      } catch (error) {
        toast(error.message);
        button.disabled = false;
      }
    };
    root.querySelector('#list').onclick = async event => {
      const button = event.target.closest('[data-do]');
      if (!button) return;
      const game = games.find(g => g.code === button.dataset.code);
      try {
        const changed = button.dataset.do === 'reset' ? await resetGame(game.code, game.title) : await deleteGame(game.code, game.title);
        if (changed) load();
      } catch (error) { toast(error.message); }
    };
    renderList();
  }

  function renderList() {
    put(root.querySelector('#list'), games.length ? `<ul class="game-list">${games.map(g => `
      <li>
        <div class="grow">
          <b>${esc(g.title)}</b>
          <small>קוד <span dir="ltr">${esc(g.code)}</span> · סיסמה <span dir="ltr">${esc(g.access)}</span> ·
            ${STATUS[g.status]} · ${g.points} נקודות · ${g.players} משתתפים</small>
        </div>
        <div class="row">
          <a class="btn mini primary" href="#/admin/${esc(g.code)}">ניהול</a>
          <button class="btn mini" data-do="reset" data-code="${esc(g.code)}">איפוס</button>
          <button class="btn mini danger" data-do="delete" data-code="${esc(g.code)}">מחיקה</button>
        </div>
      </li>`).join('')}</ul>` : `<p class="empty">${blaze('#f2b705')} עוד אין משחקים. צרו את הראשון.</p>`);
  }

  load();
  return () => { dead = true; };
}
