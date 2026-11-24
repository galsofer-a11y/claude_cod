/* global L */
import { PHOTOS, api, ask, blaze, clock, esc, meters, modal, people, put, storage, toast } from './util.js';
import { bearing, distance, windName } from './geo.js';
import { createMap, drawRoute, icons, pointIcon, ISRAEL } from './map.js';
import { compassSvg, paintCompass, requestCompass, trackHeading } from './compass.js';
import { resultsTable } from './results.js';
import { accessKey, enterGame } from './gate.js';
import { chime, unlockSound } from './sound.js';

const POLL_MS = 5000; // מאוזן בין עדכון מהיר לבין מכסת השימוש של השרת
const GPS_REFRESH_MS = 8000;
const TRAIL_STEP_M = 4;
const TRAIL_MAX_POINTS = 4000;
const GPS_OPTIONS = { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 };

export function player(root, code) {
  const sessionKey = `galmon:player:${code}`;
  let token = storage.get(sessionKey);
  let access = storage.get(accessKey(code));

  let dead = false, info = null, view = null, screenName = '';
  let fix = null, trail = [], demo = false, gpsError = '', watchId = null, lastRefresh = 0;
  let map = null, layers = null, fittedFor = '', heading = null;
  let clockOffset = 0, generation = 0, syncing = null, syncAgain = false;
  let box = null, wakeLock = null, pollTimer, secondTimer;

  const $ = selector => root.querySelector(selector);
  const serverNow = () => Date.now() + clockOffset;
  // כל פעולה שולחת גם את המיקום, כדי שהשרת יבדוק את המרחק מהנקודה בזמן אמת
  const position = () => fix && { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, age: Date.now() - fix.at };
  const call = (path = '', body = {}) => api(`/games/${code}/me${path}`, { method: 'POST', token, body: { position: position(), ...body } });
  const unlock = () => unlockSound();
  document.addEventListener('pointerdown', unlock);

  root.innerHTML = '<main class="sheet"><p>טוענים…</p></main>';
  if (token) resume();
  else showJoin();

  // ---- כניסה והצטרפות ----

  async function showJoin() {
    stopTracking();
    removeMap();
    screenName = 'join';
    try {
      if (!access) throw Object.assign(new Error(''), { status: 403 });
      info = await api(`/games/${code}/enter`, { method: 'POST', body: { access } });
    } catch (error) {
      if (dead) return;
      if (error.status === 403) {
        storage.set(accessKey(code), null);
        root.innerHTML = `<main class="join-page" style="--photo:url('${PHOTOS.valley}')"></main>`;
        const entered = await enterGame(code);
        if (dead) return;
        if (!entered) { location.hash = '#'; return; }
        access = entered.access;
        return showJoin();
      }
      root.innerHTML = `<main class="sheet"><h1>לא הצלחנו לפתוח את המשחק</h1><p>${esc(error.message)}</p><a class="btn" href="#">לדף הבית</a></main>`;
      return;
    }
    if (dead) return;
    root.innerHTML = `<main class="join-page" style="--photo:url('${PHOTOS.valley}')"><div class="sheet" id="join-step" tabindex="-1"></div></main>`;
    if (info.status === 'ended') {
      $('#join-step').innerHTML = `<h1>${esc(info.title)}</h1><p>המשחק הזה כבר הסתיים.</p><a class="btn" href="#">לדף הבית</a>`;
    } else {
      permissionStep();
    }
  }

  function permissionStep() {
    $('#join-step').innerHTML = `
      <img class="sheet-logo" src="/logo.webp" alt="" width="96" height="96">
      <p class="muted" style="margin:0">הוזמנתם למשחק</p>
      <h1>${esc(info.title)}</h1>
      <h2 class="step-title">קודם כול, אישור מיקום</h2>
      <p>המיקום משמש להצגתך על המפה, לכיוון אל הנקודה הבאה ולזיהוי ההגעה. במהלך המשחק גם המנהל רואה אותו.</p>
      <button class="btn primary wide" id="allow">אישור מיקום והמשך</button>
      <p class="error" id="gps-message" role="alert" style="margin-top:10px"></p>
      ${info.demo ? '<button class="btn wide" id="simulate">תרגול בלי מיקום אמיתי</button>' : ''}`;

    $('#allow').onclick = () => {
      requestCompass();
      unlockSound();
      if (!window.isSecureContext) {
        $('#gps-message').textContent = 'שיתוף מיקום עובד רק בכתובת מאובטחת (HTTPS). פנו למנהל המשחק.';
        return;
      }
      demo = false;
      $('#allow').disabled = true;
      $('#allow').textContent = 'מחפשים את המיקום שלך…';
      $('#gps-message').textContent = '';
      stopGps();
      startGps();
    };
    const simulate = $('#simulate');
    if (simulate) simulate.onclick = () => { demo = true; stopGps(); nameStep(); };
  }

  function nameStep() {
    screenName = 'name';
    const open = info.teams.filter(t => !t.finished);
    $('#join-step').innerHTML = `
      <p class="muted" style="margin:0">${demo ? 'מצב תרגול' : 'המיקום אושר'}</p>
      <h1>${esc(info.title)}</h1>
      <form id="name-form">
        <label>איך קוראים לך?<input name="name" required maxlength="30" autocomplete="given-name"></label>
        <fieldset class="team-options">
          <legend>לאיזו קבוצה להצטרף?</legend>
          <label class="team-option any"><input type="radio" name="team" value="any" checked>${blaze('#8ea295')}<span>שהאתר יבחר עבורי<small>שיבוץ מאוזן בין הקבוצות</small></span></label>
          ${open.map(t => `<label class="team-option"><input type="radio" name="team" value="${t.id}">${blaze(t.color)}
            <span>${esc(t.name)}<small>${esc(t.colorName)}, ${people(t.size)}${t.started ? ', כבר במסלול' : ''}</small></span></label>`).join('')}
        </fieldset>
        <button class="btn sun wide">הצטרפות לקבוצה</button>
      </form>`;
    $('#join-step').focus();

    $('#name-form').onsubmit = async event => {
      event.preventDefault();
      const data = new FormData(event.target);
      const button = event.target.querySelector('button');
      const team = data.get('team') === 'any' ? null : Number(data.get('team'));
      requestCompass();
      button.disabled = true;
      try {
        const joined = await api(`/games/${code}/join`, { method: 'POST', body: { access, name: data.get('name'), team } });
        token = joined.token;
        storage.set(sessionKey, token);
        storage.set(`${sessionKey}:demo`, demo);
        if (dead) return;
        screenName = '';
        trail = [];
        storage.set(`${sessionKey}:trail`, trail);
        remember();
        startTicking();
        await sync();
      } catch (error) {
        toast(error.message);
        button.disabled = false;
      }
    };
  }

  function resume() {
    demo = storage.get(`${sessionKey}:demo`, false);
    trail = storage.get(`${sessionKey}:trail`, []);
    if (demo && trail.length) fix = { lat: trail.at(-1)[0], lng: trail.at(-1)[1], accuracy: 5, at: Date.now() };
    if (!demo) startGps();
    startTicking();
    sync();
  }

  function forget() {
    generation++;
    token = null;
    view = null;
    storage.set(sessionKey, null);
    storage.set(`${sessionKey}:trail`, null);
  }

  // ---- מיקום ----

  function startGps() {
    if (!navigator.geolocation) return onGpsError({ code: 2 });
    if (watchId === null) watchId = navigator.geolocation.watchPosition(onGps, onGpsError, GPS_OPTIONS);
  }

  function stopGps() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  function onGps({ coords }) {
    if (dead || demo) return;
    gpsError = '';
    if (coords.speed > 0.8 && Number.isFinite(coords.heading)) heading?.moved(coords.heading);
    move({ lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy });
    if (screenName === 'join' && root.querySelector('#allow')) nameStep();
  }

  function onGpsError(error) {
    if (dead || demo) return;
    gpsError = error.code === 1
      ? 'הגישה למיקום חסומה. אשרו מיקום בהגדרות הדפדפן ורעננו את הדף.'
      : 'אין קליטת מיקום. ודאו שהמיקום בטלפון פועל וצאו לשטח פתוח.';
    const button = root.querySelector('#allow');
    if (button) {
      stopGps();
      button.disabled = false;
      button.textContent = 'ניסיון נוסף';
      $('#gps-message').textContent = gpsError;
    }
    paint();
  }

  function move(next) {
    const previous = fix;
    fix = { ...next, at: Date.now() };
    if (previous && distance(previous, fix) > Math.max(5, Math.min(previous.accuracy, fix.accuracy) / 2)) {
      heading?.moved(bearing(previous, fix));
    }
    if (token) remember();
    paint();
  }

  function remember() {
    if (!fix || fix.accuracy > 50) return;
    const last = trail.at(-1);
    if (last && distance({ lat: last[0], lng: last[1] }, fix) < TRAIL_STEP_M) return;
    trail.push([fix.lat, fix.lng]);
    if (trail.length > TRAIL_MAX_POINTS) trail.shift();
    storage.set(`${sessionKey}:trail`, trail);
  }

  function simulateMove(lat, lng) {
    move({ lat, lng, accuracy: 5 });
    sync();
  }

  // ---- סנכרון ----

  function startTicking() {
    stopTicking();
    heading ??= trackHeading(paintDirection);
    pollTimer = setInterval(sync, POLL_MS);
    secondTimer = setInterval(everySecond, 1000);
    lockScreen();
  }

  function stopTicking() {
    clearInterval(pollTimer);
    clearInterval(secondTimer);
  }

  function stopTracking() {
    stopTicking();
    stopGps();
    heading?.stop();
    heading = null;
    wakeLock?.release().catch(() => {});
    wakeLock = null;
  }

  function sync() {
    if (dead || !token) return Promise.resolve();
    if (syncing) {
      syncAgain = true;
      return syncing;
    }
    syncing = runSync().finally(() => { syncing = null; });
    return syncing;
  }

  async function runSync() {
    do {
      syncAgain = false;
      const sent = generation;
      if (demo && fix) fix.at = Date.now();
      try {
        const data = await call();
        if (dead) return;
        if (sent === generation) receive(data);
        const offline = root.querySelector('#offline');
        if (offline) offline.hidden = true;
      } catch (error) {
        if (dead) return;
        if (error.status === 401 || error.status === 404) {
          forget();
          box?.el.close();
          toast(error.status === 404 ? 'המשחק נמחק' : 'המשחק אופס. הצטרפו מחדש');
          if (error.status === 404) { location.hash = '#'; return; }
          await showJoin();
          return;
        }
        const offline = root.querySelector('#offline');
        if (offline) {
          // מבדילים בין בעיית קליטה לבין תקלה בשרת, כדי שיהיה ברור מה לבדוק
          offline.textContent = error.status ? `תקלה בשרת (${error.message}). מנסים שוב…` : 'אין חיבור לשרת. בדקו את הקליטה. מנסים שוב…';
          offline.hidden = false;
        }
        return;
      }
    } while (syncAgain && !dead && token);
  }

  function receive(data) {
    const before = view;
    view = { ...data, receivedAt: Date.now() };
    clockOffset = data.now - Date.now();
    const sameTarget = before?.target && data.target && before.target.id === data.target.id;

    if (data.target && data.arrived && !(sameTarget && before.arrived)) {
      chime('arrive');
      navigator.vibrate?.(200);
      toast(`הגעתם לנקודה ${data.target.n}! לחצו עליה כדי לפתוח את החידה`);
    }
    if (sameTarget && before.stage === 'riddle' && data.stage === 'task') {
      chime('correct');
      toast('כל הקבוצה ענתה נכון! עכשיו מחפשים את המעטפה');
    }
    if (data.wait && !before?.wait) {
      chime('wrong');
      toast(data.wait.by ? `${data.wait.by} בחר/ה תשובה שגויה. שתי דקות המתנה לכל הקבוצה` : 'תשובה שגויה. שתי דקות המתנה');
    }
    if (before?.target && data.target && !sameTarget) {
      chime('done');
      toast('הנקודה הושלמה! הנקודה הבאה מסומנת במפה');
    }
    if (before && !before.startedAt && data.startedAt) toast('יצאתם לדרך! השעון פועל');

    if (box) {
      if (!data.target || data.target.id !== box.point || data.finishedAt) box.el.close();
      else refreshBox();
    }

    const next = data.finishedAt || data.status === 'ended' ? 'results' : 'map';
    if (next !== screenName) {
      screenName = next;
      if (next === 'results') mountResults();
      else mountGame();
    }
    if (next === 'results') paintResults();
    else paint();
  }

  // ---- מסך המשחק ----

  function mountGame() {
    removeMap();
    root.innerHTML = `
      <div class="play" style="--c:${view.team.color};--i:${view.team.ink}">
        <header>
          ${blaze(view.team.color)}
          <div class="who"><strong>${esc(view.team.name)}</strong><span id="who-line"></span></div>
          <div class="clock" aria-live="off"><b id="clock">00:00</b><span id="left"></span></div>
          <div class="progress" id="progress" role="progressbar" aria-valuemin="0" hidden>
            <span class="progress-text" id="progress-text"></span><span class="progress-bar"><i id="progress-fill"></i></span>
          </div>
        </header>
        <div class="play-map">
          <div class="map" id="map" role="application" aria-label="מפת המסלול"></div>
          <div class="banner" id="banner" role="status" hidden></div>
          <div class="map-tools">
            <button class="btn mini" id="grow" aria-pressed="false">הגדלת מפה</button>
            <button class="btn mini" id="center-me">איפה אני</button>
            <button class="btn mini" id="center-target">אל היעד</button>
          </div>
        </div>
        <section class="panel" aria-label="ניווט">
          <p class="small" id="offline" role="status" hidden>אין חיבור לשרת. מנסים להתחבר שוב…</p>
          <div class="lobby" id="lobby" hidden></div>
          <div id="running" hidden>
            <div class="nav">
              <div class="compass" id="compass" role="img">${compassSvg()}</div>
              <div class="nav-info">
                <span id="target-name"></span>
                <span class="dist" id="distance"></span>
                <span id="direction"></span>
                <small id="compass-mode"></small>
                <button class="btn mini" id="enable-compass" hidden>הפעלת המצפן</button>
                ${demo ? '<button class="btn mini" id="jump">תרגול: הגעה ליעד</button>' : ''}
              </div>
            </div>
            <div class="waiting" id="waiting" role="timer" hidden><b id="countdown"></b><span id="wait-text"></span></div>
            <button class="btn sun wide action" id="open-point"></button>
          </div>
        </section>
      </div>`;

    $('#enable-compass').onclick = requestCompass;
    $('#open-point').onclick = openPoint;
    $('#center-me').onclick = () => (fix ? map?.setView([fix.lat, fix.lng], 18) : toast('עוד אין מיקום'));
    $('#center-target').onclick = () => view.target && map?.setView([view.target.lat, view.target.lng], 18);
    $('#grow').onclick = () => {
      const grown = root.querySelector('.play').classList.toggle('map-full');
      $('#grow').setAttribute('aria-pressed', grown);
      $('#grow').textContent = grown ? 'הקטנת מפה' : 'הגדלת מפה';
    };
    if (demo) $('#jump').onclick = () => view.target && simulateMove(view.target.lat + 0.00003, view.target.lng);

    map = createMap($('#map'), { center: fix ? [fix.lat, fix.lng] : ISRAEL, zoom: fix ? 16 : 8 });
    if (!map) return;
    layers = {
      route: L.layerGroup().addTo(map),
      points: L.layerGroup().addTo(map),
      trail: L.polyline([], { color: view.team.color, weight: 4, opacity: 0.8, interactive: false }).addTo(map),
      radius: null, accuracy: null, me: null, routeState: '',
    };
    if (demo) map.on('click', event => simulateMove(event.latlng.lat, event.latlng.lng));
  }

  function paint() {
    if (screenName !== 'map' || !view) return;
    const running = !!view.startedAt && view.status === 'open';

    $('#who-line').textContent = `${view.name}, ${view.title}`;
    $('#lobby').hidden = running;
    $('#running').hidden = !running;
    $('#center-target').hidden = !running;
    $('#progress').hidden = !running;

    const banner = $('#banner');
    const message = demo ? 'מצב תרגול: לחיצה על המפה מזיזה אותך'
      : gpsError || (!fix ? 'מחפשים את המיקום שלך…' : fix.accuracy > 30 ? `דיוק המיקום נמוך (${Math.round(fix.accuracy)} מ׳). צאו לשטח פתוח` : '');
    banner.textContent = message;
    banner.hidden = !message;

    if (running) {
      const done = view.route.filter(r => r.state === 'done').length;
      $('#progress').setAttribute('aria-valuemax', view.total);
      $('#progress').setAttribute('aria-valuenow', done);
      $('#progress').setAttribute('aria-label', `פתרתם ${done} מתוך ${view.total} נקודות`);
      $('#progress-text').textContent = `${done} מתוך ${view.total} נקודות`;
      $('#progress-fill').style.width = `${view.total ? done / view.total * 100 : 0}%`;

      $('#target-name').textContent = `נקודה ${view.target.n}${view.target.name ? `: ${view.target.name}` : ''}`;
      $('#distance').textContent = fix ? meters(distance(fix, view.target)) : '…';
      const button = $('#open-point');
      button.disabled = !view.arrived;
      button.textContent = !view.arrived ? `החידה תיפתח במרחק ${view.radius} מטר מהנקודה`
        : view.stage === 'task' ? 'המשימה והקוד מהמדריך' : 'הגעתם! לפתיחת החידה';
      $('#waiting').hidden = !view.wait;
      paintCountdown();
      paintDirection();
    } else {
      const members = view.team.players.map(esc).join(', ');
      put($('#lobby'), `<h2 class="lobby-title">${esc(view.team.name)}</h2>
        <p>בקבוצה: ${members}</p>
        ${view.canStart
          ? `<button class="btn sun wide" id="start">התחל משחק</button>
             <p class="small">הלחיצה מפעילה את השעון לכל הקבוצה. יש לכם ${view.limit / 60000} דקות. כדאי לחכות שכל חברי הקבוצה יצטרפו.</p>`
          : '<p>ממתינים שמנהל המשחק יפתח את המשחק.</p>'}
        <button class="btn mini" id="change-team">החלפת שם או קבוצה</button>`);
      $('#change-team').onclick = changeTeam;
      const start = $('#start');
      if (start) start.onclick = startTeam;
    }
    paintMap();
    paintClock();
  }

  async function startTeam(event) {
    unlockSound();
    requestCompass();
    if (!await ask('להתחיל את המשחק?', 'השעון של הקבוצה יתחיל לרוץ, וכל הנקודות יופיעו במפה.', 'התחל משחק') || dead) return;
    event.target.disabled = true;
    try {
      receive(await call('/start'));
    } catch (error) {
      toast(error.message);
      sync();
    }
  }

  async function changeTeam() {
    if (!await ask('להחליף שם או קבוצה?', 'תצאו מהקבוצה הנוכחית ותצטרפו מחדש.', 'החלפה') || dead) return;
    try {
      await call('/leave');
      forget();
      await showJoin();
    } catch (error) { toast(error.message); }
  }

  function paintMap() {
    if (!map) return;
    layers.trail.setLatLngs(trail);

    if (fix) {
      const at = [fix.lat, fix.lng];
      if (!layers.me) {
        layers.accuracy = L.circle(at, { radius: fix.accuracy, color: view.team.color, weight: 1, fillOpacity: 0.08, interactive: false }).addTo(map);
        layers.me = L.marker(at, { icon: icons.me(view.team.color), interactive: false, keyboard: false, zIndexOffset: -100 }).addTo(map);
      }
      layers.accuracy.setLatLng(at).setRadius(fix.accuracy);
      layers.me.setLatLng(at);
    }

    const route = view.startedAt ? view.route ?? [] : [];
    const state = route.map(r => r.state).join() + (view.target?.id ?? '');
    if (layers.routeState !== state) {
      layers.routeState = state;
      drawRoute(layers.route, route);
      layers.points.clearLayers();
      layers.radius = null;
      for (const r of route) {
        const current = r.state === 'current';
        if (current) {
          layers.radius = L.circle([r.lat, r.lng], { radius: view.radius, color: '#d0312d', dashArray: '6 6', fillOpacity: 0.1, interactive: false }).addTo(layers.points);
        }
        const label = `נקודה ${r.n}${r.name ? `, ${r.name}` : ''}: ${{ done: 'נפתרה', skipped: 'דילוג', current: 'היעד הנוכחי', todo: 'עוד לא נפתרה' }[r.state]}`;
        L.marker([r.lat, r.lng], { icon: pointIcon(r.n, r.state), zIndexOffset: current ? 1000 : 0, title: label, alt: label })
          .on('click', () => (current ? openPoint() : toast(r.state === 'todo' ? `נקודה ${r.n} עוד לפניכם. היעד עכשיו הוא נקודה ${view.target?.n}` : `נקודה ${r.n} כבר הושלמה`)))
          .addTo(layers.points);
      }
    }

    // ממרכזים רק ביעד חדש או בקליטה ראשונה, כדי לא להפריע לגלילת המפה
    const target = view.target;
    const fitKey = `${target?.id ?? ''}:${!!fix}:${route.length}`;
    if (fittedFor !== fitKey && (fix || target)) {
      fittedFor = fitKey;
      const around = [fix, target].filter(Boolean).map(p => [p.lat, p.lng]);
      map.fitBounds(around, { padding: [70, 70], maxZoom: 18, animate: false });
    }
  }

  function paintDirection() {
    if (screenName !== 'map' || !view?.target || !heading) return;
    const direction = heading.read();
    const toTarget = fix ? bearing(fix, view.target) : null;
    paintCompass($('#compass'), direction.value, toTarget);
    $('#direction').textContent = fix ? `הכיוון הכללי: ${windName(toTarget)}` : 'ממתינים למיקום';
    $('#compass-mode').textContent = {
      sensor: 'החזיקו את הטלפון אופקי ולכו עם החץ',
      movement: 'החץ לפי כיוון ההליכה שלך',
      north: 'החץ לפי צפון המפה',
    }[direction.source];
    $('#enable-compass').hidden = direction.source === 'sensor' || typeof window.DeviceOrientationEvent?.requestPermission !== 'function';
  }

  function paintClock() {
    const el = root.querySelector('#clock');
    if (!el) return;
    if (!view.startedAt) {
      el.textContent = clock(0);
      $('#left').textContent = `${view.limit / 60000} דקות למשחק`;
      return;
    }
    const end = view.finishedAt ?? Math.min(serverNow(), view.startedAt + view.limit);
    el.textContent = clock(end - view.startedAt);
    const left = view.startedAt + view.limit - end;
    $('#left').textContent = `נותרו ${clock(left)}`;
    $('#left').classList.toggle('urgent', left < 10 * 60000);
  }

  function paintCountdown() {
    if (!view?.wait) return;
    const { remaining, counting } = view.wait;
    const left = remaining - (counting ? Date.now() - view.receivedAt : 0);
    const text = clock(Math.ceil(Math.max(0, left) / 1000) * 1000);
    $('#countdown').textContent = text;
    $('#waiting').classList.toggle('paused', !counting);
    $('#wait-text').textContent = counting
      ? 'תשובה שגויה. כל הקבוצה ממתינה במקום, ואז אפשר לנסות שוב.'
      : 'ההמתנה נעצרה. חזרו אל הנקודה כדי שהשעון ימשיך.';
    const boxCount = box?.el.querySelector('#box-countdown');
    if (boxCount) boxCount.textContent = text;
    if (left <= 0) sync();
  }

  function everySecond() {
    if (dead || !view) return;
    if (screenName !== 'map') return;
    paintClock();
    paintCountdown();
    paintDirection();
    // watchPosition שותק כשעומדים במקום, למשל בזמן המתנה
    if (!demo && watchId !== null && Date.now() - lastRefresh > GPS_REFRESH_MS) {
      lastRefresh = Date.now();
      navigator.geolocation.getCurrentPosition(onGps, () => {}, { ...GPS_OPTIONS, maximumAge: 0 });
    }
  }

  // ---- חלון הנקודה: חידה, מעטפה ומשימה ----

  async function openPoint() {
    if (box || !view?.target) return;
    unlockSound();
    await sync();
    if (dead || box || !view?.target) return;
    if (!view.arrived) {
      return toast(fix ? `עוד ${meters(distance(fix, view.target))}. החידה נפתחת במרחק ${view.radius} מטר מהנקודה` : 'מחכים לקליטת המיקום');
    }
    try {
      const data = await call('/point');
      if (dead || box || view.target?.id !== data.point) return;
      const el = modal(`
        <h2>נקודה ${data.number}${data.name ? `: ${esc(data.name)}` : ''}</h2>
        ${data.image ? '<figure class="riddle-image"><div class="image-wait">טוענים תמונה…</div></figure>' : ''}
        <h3 class="box-label">החידה</h3>
        <p class="question">${esc(data.question)}</p>
        ${data.hint ? `<div class="hint"><b>רמז למקום המעטפה:</b> ${esc(data.hint)}</div>` : ''}
        <div id="box-action" aria-live="polite"></div>
        <button class="btn" data-close>חזרה למפה</button>`);
      box = { el, point: data.point, data, url: null };
      el.addEventListener('close', () => {
        if (box?.url) URL.revokeObjectURL(box.url);
        if (box?.el === el) box = null;
      });
      el.querySelector('[data-close]').onclick = () => el.close();
      el.querySelector('#box-action').addEventListener('click', boxClick);
      el.querySelector('#box-action').addEventListener('submit', submitCode);
      refreshBox();
      if (data.image) loadImage(el, data);
    } catch (error) { toast(error.message); }
  }

  async function loadImage(el, data) {
    try {
      const blob = await api(`/games/${code}/me/image`, { method: 'POST', token, body: { position: position() }, blob: true });
      if (!box || box.el !== el) return;
      box.url = URL.createObjectURL(blob);
      el.querySelector('.riddle-image').innerHTML = `<img src="${box.url}" alt="${esc(data.imageAlt)}">`;
    } catch {
      el.querySelector('.riddle-image').innerHTML = '<p class="small">התמונה לא נטענה.</p>';
    }
  }

  /** מעדכן רק את אזור הפעולה, כדי לא לאבד הקלדה */
  function refreshBox() {
    if (!box) return;
    const area = box.el.querySelector('#box-action');
    const { data } = box;
    let html;
    if (view.stage === 'task') {
      html = `<div class="success"><b>החידה נפתרה!</b> מצאו את המעטפה לפי הרמז, הציגו אותה למדריך ובצעו את המשימה שהוא יסביר.
        בסיום המדריך יקליד כאן את קוד הנקודה.</div>
        <form class="code-form">
          <label>קוד המדריך<input name="code" class="code" inputmode="numeric" autocomplete="off" maxlength="8" required></label>
          <button class="btn sun">אישור המשימה</button>
        </form>`;
    } else if (view.wait) {
      html = `<div class="waiting"><b id="box-countdown">${clock(view.wait.remaining)}</b><span>תשובה שגויה. כל הקבוצה ממתינה במקום לפני ניסיון נוסף.</span></div>`;
    } else if (view.votes?.mine) {
      html = `<div class="success"><b>בחרת תשובה.</b> ${view.votes.waiting.length
        ? `ממתינים שגם ${view.votes.waiting.map(esc).join(', ')} יבחרו. כל הקבוצה צריכה לבחור את אותה תשובה.`
        : 'בודקים את תשובות הקבוצה…'}</div>`;
    } else if (!data.options || box.stale) {
      html = '<button class="btn primary wide" data-reload>להצגת התשובות</button>';
    } else {
      const done = view.votes?.done ?? [];
      html = `<p class="small">כל חברי הקבוצה צריכים לבחור את אותה תשובה. מספיקה תשובה שגויה אחת, וכל הקבוצה ממתינה 2 דקות.</p>
        ${done.length ? `<p class="small">כבר בחרו: ${done.map(esc).join(', ')}</p>` : ''}
        <div class="options" role="group" aria-label="תשובות">${data.options.map((option, i) => `
          <button class="option" data-choice="${i}"><span class="num">${'אבג'[i]}</span><span>${esc(option)}</span></button>`).join('')}</div>`;
    }
    if (view.wait) box.stale = true;
    if (area.querySelector('.code-form') && view.stage === 'task') return;
    put(area, html);
    if (view.stage === 'task') area.querySelector('input')?.focus();
  }

  async function boxClick(event) {
    if (event.target.closest('[data-reload]')) {
      try {
        box.data = await call('/point');
        box.stale = false;
        refreshBox();
      } catch (error) { toast(error.message); }
      return;
    }
    const button = event.target.closest('[data-choice]');
    if (!button || !box) return;
    const choice = Number(button.dataset.choice);
    const el = box.el;
    el.querySelectorAll('[data-choice]').forEach(b => { b.disabled = true; });
    generation++;
    try {
      const { correct, solved, view: next } = await call('/answer', { id: box.data.id, choice });
      generation++;
      if (dead) return;
      if (correct && !solved) toast('בחרת. ממתינים לשאר הקבוצה');
      if (correct && solved) chime('correct');
      receive(next);
    } catch (error) {
      generation++;
      toast(error.message);
      if (box?.el === el) {
        box.stale = true;
        sync();
      }
    }
  }

  async function submitCode(event) {
    event.preventDefault();
    const form = event.target;
    const button = form.querySelector('button');
    button.disabled = true;
    generation++;
    try {
      const { view: next } = await call('/code', { code: new FormData(form).get('code') });
      generation++;
      if (!dead) receive(next);
    } catch (error) {
      generation++;
      toast(error.message);
      button.disabled = false;
      form.querySelector('input').select();
    }
  }

  // ---- סיכום המשחק ----

  function mountResults() {
    removeMap();
    stopGps(); // אין יותר צורך במיקום
    root.innerHTML = `
      <header class="results-hero" style="--photo:url('${PHOTOS.ridge}')">
        <img src="/logo.webp" alt="" width="90" height="90">
        <h1>סיכום המשחק</h1>
        <p id="results-summary"></p>
      </header>
      <main class="results" tabindex="-1">
        <div class="summary-cards" id="summary-cards"></div>
        <h2 id="results-title"></h2>
        <div id="results"></div>
        <a class="btn" href="#" style="margin-top:20px">לדף הבית</a>
      </main>`;
  }

  function paintResults() {
    const ended = view.status === 'ended';
    const mine = view.results.find(r => r.id === view.team.id);
    const time = (view.finishedAt ?? view.now) - (view.startedAt ?? view.now);
    $('#results-summary').textContent = mine?.finished ? `${view.team.name} מצאו את כל המעטפות!`
      : view.timedOut ? `${view.team.name}: נגמרו 90 הדקות` : `${view.team.name}: המשחק הסתיים`;
    put($('#summary-cards'), mine ? `
      <div class="card"><span>זמן סופי</span><b>${clock(view.startedAt ? time : 0)}</b></div>
      <div class="card"><span>נקודות שהושלמו</span><b>${mine.done} מתוך ${mine.total}</b></div>
      <div class="card"><span>חידות שנפתרו</span><b>${mine.riddles}</b></div>
      <div class="card"><span>מקום</span><b>${mine.rank} מתוך ${view.results.length}</b></div>
      <div class="card wide"><span>החידות שפתרתם</span>
        <ul>${mine.details.map(d => `<li>${d.riddle ? '✓' : '✗'} נקודה ${d.number}${d.name ? `, ${esc(d.name)}` : ''}${d.question ? `: ${esc(d.question)}` : ''}</li>`).join('')}</ul></div>`
      : '<p>הקבוצה שלך לא התחילה לשחק.</p>');
    $('#results-title').textContent = ended ? 'הדירוג הסופי' : 'דירוג זמני, עד שכל הקבוצות יסיימו';
    put($('#results'), resultsTable(view.results, { highlight: view.team.id }));
    if (ended) stopTracking();
  }

  function removeMap() {
    map?.remove();
    map = null;
    layers = null;
    fittedFor = '';
  }

  async function lockScreen() {
    try {
      if (!document.hidden) wakeLock = await navigator.wakeLock?.request('screen');
    } catch { /* אין תמיכה או שהסוללה חלשה */ }
  }

  function onVisible() {
    if (document.hidden || !token || dead || !heading) return;
    lockScreen();
    lastRefresh = 0;
    sync();
  }
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    dead = true;
    document.removeEventListener('visibilitychange', onVisible);
    document.removeEventListener('pointerdown', unlock);
    stopTracking();
    removeMap();
  };
}
