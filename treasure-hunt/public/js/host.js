/* global L */
import { api, ask, blaze, clock, esc, people, put, shareText, toast } from './util.js';
import { createMap, drawRoute, icons, pointIcon } from './map.js';
import { resultsTable } from './results.js';
import { requireAdmin } from './gate.js';
import { deleteGame, resetGame } from './admin.js';

const SAVE_DELAY = 700;
const POLL_MS = 5000;
const PLACE_ZOOM = 14; // מרחוק אי אפשר לסמן נקודה במדויק
const IMAGE_SIZE = 1600;

const complete = p => {
  const answers = [p.correct, ...p.wrong].map(a => a.trim());
  return !!p.question.trim() && answers.every(Boolean) && new Set(answers).size === 3 && (!p.image || !!p.imageAlt.trim());
};

async function shrink(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, IMAGE_SIZE / Math.max(bitmap.width, bitmap.height));
  const canvas = Object.assign(document.createElement('canvas'), {
    width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale),
  });
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82));
}

export function host(root, code) {
  const base = `/admin/games/${code}`;
  const call = (path = '', options = {}) => api(`${base}${path}`, options);

  let dead = false, view, config, map, pointLayer, routeLayer, peopleLayer;
  let tab = 'build', clockOffset = 0, mappedKey = '';
  let saveTimer, pollTimer, clockTimer, clickTimer;
  let saving = Promise.resolve(true), edits = 0, savedEdits = 0;
  const $ = selector => root.querySelector(selector);
  const editable = () => view.status !== 'ended' && !view.locked;

  root.innerHTML = '<main class="admin"><p>טוענים את המשחק…</p></main>';
  load();

  async function load() {
    try {
      const data = await call();
      if (dead) return;
      view = data;
      config = structuredClone(data.config);
      if (!editable() || (data.status === 'open' && !data.problems.length)) tab = 'manage';
      mount();
      receive(data);
      pollTimer = setTimeout(poll, POLL_MS);
      clockTimer = setInterval(updateClocks, 1000);
    } catch (error) {
      if (error.status === 401 && await requireAdmin()) return load();
      if (!dead) root.innerHTML = `<main class="admin"><h1>לא ניתן לפתוח את המשחק</h1><p>${esc(error.message)}</p><a class="btn" href="#/admin">לרשימת המשחקים</a></main>`;
    }
  }

  function mount() {
    root.innerHTML = `
      <div class="host">
        <header>
          <a class="brand" href="#/admin"><img src="/logo.webp" alt="" width="36" height="36"> כל המשחקים</a>
          <nav class="tabs" role="tablist" aria-label="מצב עבודה">
            <button role="tab" data-tab="build">בניית המסלול</button>
            <button role="tab" data-tab="manage">ניהול המשחק</button>
          </nav>
          <span class="save-state" id="save-state" role="status"></span>
        </header>
        <div class="host-map">
          <div class="map" id="map" role="application" aria-label="מפת המסלול. לחיצה על המפה מוסיפה נקודה"></div>
          <div class="map-tools">
            <button class="btn mini" id="grow" aria-pressed="false">הגדלת מפה</button>
            <button class="btn mini" id="locate">המיקום שלי</button>
            <button class="btn mini" id="fit">כל הנקודות</button>
          </div>
        </div>
        <main class="side" tabindex="-1">
          <section id="build"></section>
          <section id="manage" hidden></section>
        </main>
      </div>`;

    root.querySelectorAll('[data-tab]').forEach(button => {
      button.onclick = () => { tab = button.dataset.tab; showTab(); };
    });
    renderBuilder();
    map = createMap($('#map'));
    if (map) {
      routeLayer = L.layerGroup().addTo(map);
      pointLayer = L.layerGroup().addTo(map);
      peopleLayer = L.layerGroup().addTo(map);
      map.on('click', ({ latlng }) => {
        if (!editable() || tab !== 'build') return;
        clearTimeout(clickTimer);
        // ממתינים לראות שזו אינה לחיצה כפולה להגדלה
        clickTimer = setTimeout(() => {
          if (map.getZoom() >= PLACE_ZOOM) return addPoint(latlng.lat, latlng.lng);
          map.setView(latlng, Math.min(PLACE_ZOOM, map.getZoom() + 3));
          toast(map.getZoom() >= PLACE_ZOOM ? 'עכשיו לחצו על המקום המדויק של הנקודה' : 'מתקרבים. לחצו שוב על אזור הטיול');
        }, 280);
      });
      map.on('dblclick', () => clearTimeout(clickTimer));
      drawPoints();
      fit();
    }
    $('#fit').onclick = fit;
    $('#grow').onclick = () => {
      const grown = root.querySelector('.host').classList.toggle('map-full');
      $('#grow').setAttribute('aria-pressed', grown);
      $('#grow').textContent = grown ? 'הקטנת מפה' : 'הגדלת מפה';
    };
    $('#locate').onclick = () => {
      if (!navigator.geolocation) return toast('הדפדפן אינו תומך במיקום');
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => !dead && map?.setView([coords.latitude, coords.longitude], 17),
        () => toast('לא קיבלנו מיקום. אשרו הרשאת מיקום או גררו את המפה'),
        { enableHighAccuracy: true, timeout: 15000 },
      );
    };
    showTab();
  }

  function showTab() {
    if (!editable()) tab = 'manage';
    $('#build').hidden = tab !== 'build';
    $('#manage').hidden = tab !== 'manage';
    root.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === tab));
  }

  // ---- בניית המסלול ----

  function renderBuilder() {
    if (!editable()) {
      $('#build').innerHTML = '<p class="notice">אחרי שקבוצה התחילה לשחק אי אפשר לשנות את המסלול. כדי לערוך, אפסו את המשחק.</p>';
      return;
    }
    $('#build').innerHTML = `
      <label>שם המשחק<input id="title" maxlength="60" value="${esc(config.title)}"></label>
      <h2>נקודות המסלול</h2>
      <p class="muted">לחצו על המפה כדי להוסיף נקודה. הסדר ברשימה הוא סדר הניווט. אפשר לגרור נקודה כדי לדייק.
        השחקנים יוכלו לפתוח את החידה רק במרחק ${view.radius} מטר ממנה.</p>
      <button class="btn mini" id="add-here">הוספת נקודה במקום שבו אני עומד/ת</button>
      <ol class="points" id="points"></ol>
      <h3>הגדרות</h3>
      <label class="check"><input type="checkbox" id="staggered" ${config.staggered ? 'checked' : ''}>
        <span>כל קבוצה מתחילה מנקודה אחרת במסלול, כדי שלא ילכו זו אחר זו. מתאים למסלול מעגלי.</span></label>
      <label class="check"><input type="checkbox" id="demo" ${config.demo ? 'checked' : ''}>
        <span>מצב תרגול: משחקים מהמחשב ומזיזים את השחקן בלחיצה על המפה. לא לסמן במשחק אמיתי.</span></label>
      <div class="row">
        <button class="btn mini" id="export">שמירת גיבוי לקובץ</button>
        <label class="btn mini" style="margin:0">טעינת גיבוי<input id="import" type="file" accept=".json" hidden></label>
      </div>
      <button class="btn primary wide" id="next" style="margin-top:16px">המשך לפתיחת המשחק</button>`;

    $('#title').oninput = event => { config.title = event.target.value; changed(); };
    $('#staggered').onchange = event => { config.staggered = event.target.checked; changed(); };
    $('#demo').onchange = event => { config.demo = event.target.checked; changed(); };
    $('#next').onclick = () => { tab = 'manage'; showTab(); scrollTo(0, 0); };
    $('#add-here').onclick = addHere;
    $('#export').onclick = exportFile;
    $('#import').onchange = importFile;

    const list = $('#points');
    list.oninput = event => {
      const field = event.target.dataset.field;
      if (!field) return;
      const item = event.target.closest('[data-id]');
      const point = config.points.find(p => p.id === item.dataset.id);
      if (field === 'wrong0' || field === 'wrong1') point.wrong[Number(field.at(-1))] = event.target.value;
      else point[field] = event.target.value;
      item.querySelector('.point-name').textContent = point.name || `נקודה ${config.points.indexOf(point) + 1}`;
      markState(item, point);
      changed();
    };
    list.onchange = event => {
      if (event.target.dataset.upload !== undefined) uploadImage(event.target);
    };
    list.onclick = async event => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const id = button.closest('[data-id]').dataset.id;
      const points = config.points;
      const index = points.findIndex(p => p.id === id);
      const { action } = button.dataset;
      if (action === 'show') return map?.setView([points[index].lat, points[index].lng], 18);
      if (action === 'remove-image') return removeImage(id);
      if (action === 'delete') {
        if (!await ask('למחוק את הנקודה?', 'החידה, התמונה והתשובות של הנקודה יימחקו.', 'מחיקה') || dead) return;
        config.points = config.points.filter(p => p.id !== id);
      } else {
        const other = index + (action === 'up' ? -1 : 1);
        if (other < 0 || other >= points.length) return;
        [points[index], points[other]] = [points[other], points[index]];
      }
      pointsChanged();
    };
    renderPoints();
  }

  function markState(item, point) {
    const state = item.querySelector('.state');
    state.textContent = complete(point) ? 'מוכנה' : 'חסרים פרטים';
    state.classList.toggle('ok', complete(point));
  }

  function imageBlock(p) {
    return p.image
      ? `<figure class="point-image"><img src="/api${base}/images/${esc(p.id)}?v=${esc(p.image)}" alt="${esc(p.imageAlt)}">
          <figcaption><button class="btn mini danger" data-action="remove-image">הסרת התמונה</button></figcaption></figure>
        <label>תיאור התמונה (חובה, לנגישות)<input data-field="imageAlt" maxlength="200" value="${esc(p.imageAlt)}" placeholder="לדוגמה: עץ אלון גדול ליד ספסל אבן"></label>`
      : `<label class="upload">תמונה לנקודה (לא חובה)<input type="file" accept="image/*" data-upload></label>`;
  }

  function renderPoints(openId) {
    const list = $('#points');
    if (!list) return;
    const opened = new Set([...list.querySelectorAll('details[open]')].map(d => d.parentElement.dataset.id));
    if (openId) { opened.clear(); opened.add(openId); }
    const last = config.points.length - 1;

    list.innerHTML = config.points.map((p, i) => `
      <li class="point" data-id="${esc(p.id)}">
        <details ${opened.has(p.id) ? 'open' : ''}>
          <summary><span class="num">${i + 1}</span><span class="point-name">${esc(p.name || `נקודה ${i + 1}`)}</span>
            <span class="state ${complete(p) ? 'ok' : ''}">${complete(p) ? 'מוכנה' : 'חסרים פרטים'}</span></summary>
          <div class="point-body">
            <label>שם הנקודה (לא חובה)<input data-field="name" maxlength="60" value="${esc(p.name)}" placeholder="לדוגמה: המעיין"></label>
            <label>החידה<textarea data-field="question" maxlength="600" rows="3">${esc(p.question)}</textarea></label>
            <div class="image-slot">${imageBlock(p)}</div>
            <label>רמז למקום המעטפה<textarea data-field="hint" maxlength="400" rows="2" placeholder="לדוגמה: מתחת לאבן השטוחה, שלושה צעדים מהעץ">${esc(p.hint)}</textarea></label>
            <label class="correct">התשובה הנכונה<input data-field="correct" maxlength="200" value="${esc(p.correct)}"></label>
            <label>תשובה שגויה ראשונה<input data-field="wrong0" maxlength="200" value="${esc(p.wrong[0])}"></label>
            <label>תשובה שגויה שנייה<input data-field="wrong1" maxlength="200" value="${esc(p.wrong[1])}"></label>
            <label>קוד המדריך לנקודה<input data-field="code" inputmode="numeric" maxlength="8" value="${esc(p.code)}" dir="ltr">
              <small class="muted">המדריך מקליד אותו בטלפון של הקבוצה אחרי שהמשימה הושלמה. 3 עד 8 ספרות.</small></label>
            <p class="small muted">סדר התשובות מתערבב בכל פתיחה של החידה.</p>
            <div class="row">
              <button class="btn mini" data-action="show">הצגה במפה</button>
              <button class="btn mini" data-action="up" ${i === 0 ? 'disabled' : ''}>הקדמה</button>
              <button class="btn mini" data-action="down" ${i === last ? 'disabled' : ''}>דחייה</button>
              <button class="btn mini danger" data-action="delete">מחיקה</button>
            </div>
          </div>
        </details>
      </li>`).join('') || '<li class="empty">עוד אין נקודות. התקרבו במפה לאזור הטיול ולחצו על המקום הראשון.</li>';
  }

  async function uploadImage(input) {
    const file = input.files[0];
    const id = input.closest('[data-id]').dataset.id;
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast('בחרו קובץ תמונה');
    input.disabled = true;
    $('#save-state').textContent = 'מעלים תמונה…';
    try {
      if (!await save()) throw new Error('המסלול לא נשמר');
      const blob = await shrink(file);
      const data = await call(`/images/${encodeURIComponent(id)}`, { method: 'PUT', raw: blob, type: 'image/jpeg' });
      if (dead) return;
      config.points.find(p => p.id === id).image = data.config.points.find(p => p.id === id)?.image ?? null;
      refreshImage(id);
      $('#save-state').textContent = 'התמונה נשמרה. הוסיפו לה תיאור';
    } catch (error) {
      toast(error.message);
      input.disabled = false;
      $('#save-state').textContent = '';
    }
  }

  async function removeImage(id) {
    try {
      const data = await call(`/images/${encodeURIComponent(id)}`, { method: 'DELETE' });
      config.points.find(p => p.id === id).image = null;
      if (!dead) { refreshImage(id); receive(data); }
    } catch (error) { toast(error.message); }
  }

  function refreshImage(id) {
    const item = root.querySelector(`.point[data-id="${CSS.escape(id)}"]`);
    const point = config.points.find(p => p.id === id);
    if (!item || !point) return;
    item.querySelector('.image-slot').innerHTML = imageBlock(point);
    markState(item, point);
  }

  function openPoint(id) {
    if (!editable()) return;
    tab = 'build';
    showTab();
    renderPoints(id);
    root.querySelector(`.point[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function addPoint(lat, lng) {
    if (config.points.length >= 60) return toast('אפשר ליצור עד 60 נקודות');
    const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    config.points.push({ id, lat, lng, name: '', question: '', hint: '', correct: '', wrong: ['', ''], code: '', image: null, imageAlt: '' });
    pointsChanged();
    openPoint(id);
  }

  function addHere(event) {
    if (!navigator.geolocation) return toast('הדפדפן אינו תומך במיקום');
    const button = event.currentTarget;
    button.disabled = true;
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      if (dead) return;
      button.disabled = false;
      if (coords.accuracy > 20) return toast(`דיוק המיקום נמוך (${Math.round(coords.accuracy)} מ׳). נסו שוב בשטח פתוח`);
      addPoint(coords.latitude, coords.longitude);
      map?.setView([coords.latitude, coords.longitude], 18);
    }, () => {
      button.disabled = false;
      toast('לא קיבלנו מיקום. אשרו הרשאת מיקום');
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  }

  function exportFile() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' }));
    Object.assign(document.createElement('a'), { href: url, download: `galmon-${code}.json` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importFile(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.points)) throw new Error('not a game file');
      if (!await ask('לטעון את הגיבוי?', 'המסלול הנוכחי יוחלף במסלול שבקובץ. תמונות אינן נשמרות בגיבוי.', 'טעינה') || dead) return;
      clearTimeout(saveTimer);
      await saving;
      const result = await call('', { method: 'PUT', body: data });
      config = structuredClone(result.config);
      renderBuilder();
      receive(result);
      fit();
    } catch (error) {
      toast(error.status ? error.message : 'זה אינו קובץ גיבוי תקין');
    }
  }

  // ---- שמירה אוטומטית ----

  function pointsChanged() {
    renderPoints();
    drawPoints();
    changed();
  }

  function changed() {
    edits++;
    $('#save-state').textContent = 'שומרים…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_DELAY);
  }

  function save() {
    clearTimeout(saveTimer);
    saving = saving.then(async () => {
      if (edits === savedEdits) return true;
      const sent = edits;
      try {
        const data = await call('', { method: 'PUT', body: config });
        savedEdits = sent;
        if (dead) return true;
        // קודים חדשים שהשרת יצר נכנסים לטופס
        for (const p of data.config.points) {
          const local = config.points.find(x => x.id === p.id);
          if (local && !local.code) {
            local.code = p.code;
            const input = root.querySelector(`.point[data-id="${CSS.escape(p.id)}"] [data-field=code]`);
            if (input && !input.value) input.value = p.code;
          }
        }
        receive(data);
        if (edits === sent) $('#save-state').textContent = 'הכול נשמר';
        return true;
      } catch (error) {
        if (dead) return false;
        $('#save-state').textContent = `לא נשמר: ${error.message}`;
        if (!error.status) saveTimer = setTimeout(save, 5000);
        return false;
      }
    });
    return saving;
  }

  // ---- מפה ----

  function drawPoints() {
    if (!map) return;
    pointLayer.clearLayers();
    const points = editable() ? config.points : view.config.points;
    drawRoute(routeLayer, points.map(p => ({ ...p, state: 'todo' })));
    points.forEach((point, i) => {
      const at = [point.lat, point.lng];
      const circle = L.circle(at, { radius: view.radius, color: '#12362a', weight: 1, fillOpacity: 0.12, interactive: false }).addTo(pointLayer);
      L.marker(at, { icon: pointIcon(i + 1, 'todo'), draggable: editable(), title: point.name || `נקודה ${i + 1}` })
        .on('click', () => openPoint(point.id))
        .on('drag', event => circle.setLatLng(event.latlng))
        .on('dragend', event => {
          ({ lat: point.lat, lng: point.lng } = event.target.getLatLng());
          drawRoute(routeLayer, config.points.map(p => ({ ...p, state: 'todo' })));
          changed();
        })
        .addTo(pointLayer);
    });
  }

  function drawPeople() {
    if (!map) return;
    peopleLayer.clearLayers();
    for (const person of view.positions) {
      const team = view.teams[person.team];
      L.marker([person.lat, person.lng], { icon: icons.dot(team.color, person.stale), zIndexOffset: 500 })
        .bindTooltip(`${esc(person.name)}, ${esc(team.name)}${person.stale ? ' (מיקום לא עדכני)' : ''}`)
        .addTo(peopleLayer);
    }
  }

  function fit() {
    const points = editable() ? config.points : view.config.points;
    if (map && points.length) map.fitBounds(points.map(p => [p.lat, p.lng]), { padding: [45, 45], maxZoom: 17 });
  }

  // ---- ניהול המשחק ----

  function receive(data) {
    view = data;
    clockOffset = data.now - Date.now();
    const key = `${data.status}:${editable()}`;
    if (mappedKey !== key) {
      const first = mappedKey === '';
      const wasEditable = mappedKey.endsWith('true');
      mappedKey = key;
      if (!first && wasEditable !== editable()) {
        // אחרי איפוס חוזרים לערוך את המסלול השמור בשרת
        if (editable()) config = structuredClone(data.config);
        renderBuilder();
      }
      drawPoints();
      showTab();
    }
    drawPeople();
    renderManage();
  }

  function shareBlock() {
    const link = `${location.origin}/#/join/${code}`;
    const local = ['localhost', '127.0.0.1'].includes(location.hostname);
    return `<div class="share">
      <div class="share-codes">
        <div><span>קוד משחק</span><strong class="code-big">${code}</strong></div>
        <div><span>סיסמה</span><strong class="code-big">${esc(view.access)}</strong></div>
      </div>
      <input readonly value="${esc(link)}" aria-label="קישור הצטרפות">
      <div class="row">
        <button class="btn sun" data-do="share">שיתוף ההזמנה</button>
        <button class="btn mini light" data-do="access">החלפת סיסמה</button>
      </div>
      ${local ? '<p class="notice">הכתובת הזו עובדת רק במחשב הזה. כדי לשחק בטלפונים צריך להעלות את האתר לכתובת HTTPS, כמוסבר בקובץ README.</p>' : ''}
    </div>`;
  }

  function codesBlock() {
    const points = view.config.points;
    if (!points.length) return '';
    return `<details class="codes" data-key="codes"><summary>קודי המדריכים לפי נקודה</summary>
      <table class="codes-table"><thead><tr><th scope="col">#</th><th scope="col">נקודה</th><th scope="col">קוד</th></tr></thead>
      <tbody>${points.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.name || `נקודה ${i + 1}`)}</td><td dir="ltr"><b>${esc(p.code)}</b></td></tr>`).join('')}</tbody></table>
      <button class="btn mini" data-do="print">הדפסה</button></details>`;
  }

  function teamLine(t) {
    if (!t.players.length) return `<li>${blaze(t.color)}<span class="grow"><b>${esc(t.name)}</b><small>ממתינה למשתתפים</small></span></li>`;
    let state = 'עוד לא לחצה על התחלה';
    if (t.startedAt) {
      state = t.finishedAt ? (t.timedOut ? 'נגמרו 90 הדקות' : 'סיימה את המסלול') : `נקודה ${t.step + 1} מתוך ${t.total}, ${t.stage === 'task' ? 'במשימה' : 'בחידה'}`;
      if (t.wait !== null) state += `, בהמתנה (${clock(t.wait)})`;
    }
    const time = t.startedAt ? `<b class="team-clock" data-start="${t.startedAt}" data-end="${t.finishedAt ?? ''}"></b>` : '';
    const skip = t.startedAt && !t.finishedAt && view.status === 'open' ? `<button class="btn mini" data-do="skip" data-team="${t.id}">דילוג</button>` : '';
    return `<li>${blaze(t.color)}<span class="grow"><b>${esc(t.name)}</b><small>${state}</small>
      <small>${people(t.players.length)}: ${t.players.map(esc).join(', ')}</small></span>${time}${skip}</li>`;
  }

  function mailLine() {
    const mail = view.mail;
    if (!mail) return '';
    const text = {
      sent: 'מייל הסיכום נשלח', sending: 'שולחים את מייל הסיכום…',
      skipped: 'מייל הסיכום לא נשלח כי שליחת מיילים לא הוגדרה (ראו README)', error: `שליחת המייל נכשלה: ${esc(mail.error)}`,
    }[mail.status];
    return `<p class="notice">${text} ${mail.status !== 'sending' ? '<button class="btn mini" data-do="mail">שליחה חוזרת</button>' : ''}</p>`;
  }

  function renderManage() {
    const { status, teams, problems, results, config: saved } = view;
    const joined = teams.reduce((sum, t) => sum + t.players.length, 0);
    let html = `<h1 class="game-title">${esc(saved.title)}</h1>`;

    if (status === 'draft') {
      html += `${shareBlock()}
        <ul class="team-list">${teams.map(teamLine).join('')}</ul>
        ${problems.length ? `<p class="notice">${esc(problems[0])}</p>` : ''}
        ${saved.demo ? '<p class="notice">מצב תרגול פעיל. בטלו אותו לפני משחק אמיתי.</p>' : ''}
        <button class="btn sun wide" data-do="open" ${problems.length ? 'disabled' : ''}>פתיחת המשחק</button>
        <p class="small muted">אחרי הפתיחה כל קבוצה מתחילה את השעון שלה בלחיצה על "התחל משחק". לכל קבוצה ${view.limit / 60000} דקות.</p>`;
    } else if (status === 'open') {
      html += `${shareBlock()}
        <h2>הקבוצות</h2>
        <ul class="team-list">${teams.map(teamLine).join('')}</ul>
        <p class="small muted">דילוג מיועד לתקלה, למשל נקודה חסומה. הוא לא נחשב נקודה שהושלמה בדירוג.</p>
        ${results.length ? `<h2>דירוג ביניים</h2>${resultsTable(results)}` : ''}
        <button class="btn danger wide" data-do="end" style="margin-top:20px" ${joined ? '' : 'disabled'}>סיום המשחק לכולם</button>`;
    } else {
      html += `<h2>הדירוג הסופי</h2>${resultsTable(results)}${mailLine()}
        <button class="btn primary wide" data-do="copy" style="margin-top:20px">משחק חדש עם אותו מסלול</button>`;
    }
    html += `${codesBlock()}
      <section class="danger-zone" aria-label="איפוס ומחיקה">
        <button class="btn danger" data-do="reset">איפוס המשחק ומשחק מחדש</button>
        <button class="btn danger" data-do="delete">מחיקת המשחק</button>
      </section>`;

    put($('#manage'), html);
    $('#manage').onclick = manageClick;
    updateClocks();
  }

  async function manageClick(event) {
    const button = event.target.closest('[data-do]');
    if (!button) return;
    const action = button.dataset.do;
    try {
      if (action === 'share') {
        return await shareText(`הוזמנתם למשחק גלמון "${view.config.title}"\nכניסה: ${location.origin}/#/join/${code}\nסיסמה: ${view.access}`, view.config.title);
      }
      if (action === 'print') return print();
      if (action === 'reset') {
        if (await resetGame(code, view.config.title) && !dead) receive(await call());
        return;
      }
      if (action === 'delete') {
        if (await deleteGame(code, view.config.title)) location.hash = '#/admin';
        return;
      }
      if (action === 'copy') {
        const game = await call('/copy', { method: 'POST' });
        location.hash = `#/admin/${game.code}`;
        return;
      }
      let body;
      if (action === 'open') {
        if (!await save()) return toast('השינויים עוד לא נשמרו');
        if (!await ask('לפתוח את המשחק?', 'הקבוצות יוכלו להתחיל לשחק. אחרי שקבוצה תתחיל, לא יהיה אפשר לערוך את המסלול.', 'פתיחה')) return;
      } else if (action === 'access') {
        if (!await ask('להחליף סיסמה?', 'משתתפים חדשים יצטרכו את הסיסמה החדשה. מי שכבר הצטרף ממשיך לשחק.', 'החלפה')) return;
      } else if (action === 'skip') {
        body = { team: Number(button.dataset.team) };
        if (!await ask('לדלג על הנקודה?', `${view.teams[body.team].name} יעברו לנקודה הבאה בלי שהנקודה תיחשב.`, 'דילוג')) return;
      } else if (action === 'end') {
        if (!await ask('לסיים לכולם?', 'המשחק ייעצר, הדירוג הסופי יוצג ומייל הסיכום יישלח. אי אפשר לבטל.', 'סיום המשחק')) return;
      }
      button.disabled = true;
      const data = await call(`/${action}`, { method: 'POST', body });
      if (!dead) receive(data);
    } catch (error) {
      button.disabled = false;
      toast(error.message);
    }
  }

  function updateClocks() {
    const now = Date.now() + clockOffset;
    root.querySelectorAll('.team-clock').forEach(el => {
      const end = Number(el.dataset.end) || Math.min(now, Number(el.dataset.start) + view.limit);
      el.textContent = clock(end - Number(el.dataset.start));
    });
  }

  async function poll() {
    try {
      const data = await call();
      if (!dead) receive(data);
    } catch (error) {
      if (error.status === 404 && !dead) { toast('המשחק נמחק'); location.hash = '#/admin'; return; }
    }
    if (!dead) pollTimer = setTimeout(poll, POLL_MS);
  }

  const beforeUnload = event => { if (edits !== savedEdits) event.preventDefault(); };
  addEventListener('beforeunload', beforeUnload);

  return () => {
    if (edits !== savedEdits) save();
    dead = true;
    clearTimeout(pollTimer);
    clearTimeout(clickTimer);
    clearInterval(clockTimer);
    removeEventListener('beforeunload', beforeUnload);
    map?.remove();
  };
}
