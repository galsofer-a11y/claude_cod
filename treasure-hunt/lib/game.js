// חוקי המשחק של גלמון. ללא רשת וללא דיסק, והשעה מתקבלת כפרמטר כדי לאפשר בדיקה.
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { distance } from '../public/js/geo.js';

export const VERSION = 2;
export const RADIUS = 15;
export const WAIT_MS = 120_000;
export const LIMIT_MS = 90 * 60_000;
export const FRESH_MS = 20_000;
export const ACTIVE_MS = 45_000;
const MAX_ACCURACY = 30;
const PRESENCE_EXTRA = 25; // בזמן המתנה מאפשרים סטייה של GPS בלי לעצור את השעון
const CODE_TRIES = 5;
const CODE_WINDOW_MS = 120_000;

const COLORS = [
  ['#d7372f', '#fff', 'אדום'], ['#1769c2', '#fff', 'כחול'],
  ['#24834b', '#fff', 'ירוק'], ['#f2b705', '#1d2b24', 'צהוב'],
];
const NAMES = ['יעלי הצוק', 'שועלי המדבר', 'עיטי ההר', 'צבאי השדה', 'ינשופי הלילה', 'דורבני הוואדי', 'שפני הסלע',
  'נמרי המצוק', 'חסידות הדרך', 'זאבי הערבה', 'לטאות השמש', 'בזי הרוח', 'סלמנדרות הנחל', 'תני החורש',
  'קיפודי היער', 'דוכיפות הגיא', 'נשרי הרכס', 'צבי היבשה', 'עטלפי המערה', 'חוגלות השביל'];

export class GameError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const check = (ok, message, status) => { if (!ok) throw new GameError(message, status); };
export const id = (bytes = 18) => randomBytes(bytes).toString('base64url');
const text = (value, max) => (typeof value === 'string' ? value : '').trim().slice(0, max);
const digits = length => String(randomInt(10 ** (length - 1), 10 ** length));
export const same = (a, b) => {
  const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? ''));
  return x.length === y.length && timingSafeEqual(x, y);
};
function shuffled(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export function newCode() {
  const letters = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => letters[randomInt(letters.length)]).join('');
}

export function cleanConfig(input, previous = { points: [] }) {
  check(input && typeof input === 'object', 'פרטי המשחק אינם תקינים');
  const points = input.points ?? [];
  check(Array.isArray(points) && points.length <= 60, 'אפשר ליצור עד 60 נקודות');
  const ids = new Set();
  return {
    title: text(input.title, 60) || 'משחק גלמון',
    staggered: input.staggered === true,
    demo: input.demo === true,
    points: points.map(p => {
      const { lat, lng } = p ?? {};
      check(Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lng) && Math.abs(lng) <= 180, 'מיקום הנקודה אינו תקין');
      const pointId = typeof p.id === 'string' && /^[\w-]{1,40}$/.test(p.id) && !ids.has(p.id) ? p.id : id(6);
      ids.add(pointId);
      const old = previous.points.find(o => o.id === pointId);
      const code = text(p.code, 8);
      return {
        id: pointId, lat, lng,
        name: text(p.name, 60), question: text(p.question, 600), hint: text(p.hint, 400),
        correct: text(p.correct, 200), wrong: [text(p.wrong?.[0], 200), text(p.wrong?.[1], 200)],
        code: /^\d{3,8}$/.test(code) ? code : old?.code ?? digits(4),
        // התמונה נשמרת רק דרך העלאה, ולכן לא מקבלים אותה מהדפדפן
        image: old?.image ?? null, imageAlt: text(p.imageAlt, 200),
      };
    }),
  };
}

export function problems(game) {
  if (!game.config.points.length) return ['הוסיפו לפחות נקודה אחת על המפה'];
  return game.config.points.flatMap((p, i) => {
    if (!p.question) return [`בנקודה ${i + 1} חסרה חידה`];
    const answers = [p.correct, ...p.wrong];
    if (answers.some(a => !a)) return [`בנקודה ${i + 1} צריך למלא 3 תשובות`];
    if (new Set(answers).size < 3) return [`בנקודה ${i + 1} יש תשובות זהות`];
    if (p.image && !p.imageAlt) return [`בנקודה ${i + 1} חסר תיאור לתמונה (לנגישות)`];
    return [];
  });
}

function makeTeams() {
  const names = shuffled(NAMES);
  return COLORS.map(([color, ink, colorName], i) => ({
    id: i, name: names[i], color, ink, colorName, route: [], step: 0, stage: 'riddle', votes: {},
    log: [], penalty: null, startedAt: null, finishedAt: null, timedOut: false, codeFails: [],
  }));
}

export function createGame(code, config, now) {
  return {
    version: VERSION, code, access: digits(6), createdAt: now, openedAt: null, endedAt: null,
    config: cleanConfig(config), players: {}, teams: makeTeams(), mail: null, pendingMail: false,
  };
}

/** משחק שנשמר בגרסה קודמת: שומרים את המסלול ומאפסים את ההתקדמות. */
export function upgrade(game, now) {
  if (game.version === VERSION) return game;
  const fresh = createGame(game.code, { ...game.config, points: [] }, now);
  fresh.config = cleanConfig({ ...game.config, points: game.config?.points ?? [] });
  return fresh;
}

export const statusOf = game => (game.endedAt ? 'ended' : game.openedAt ? 'open' : 'draft');
const members = (game, team) => Object.values(game.players).filter(p => p.team === team.id);
const activeMembers = (game, team, now) => members(game, team).filter(p => now - p.seenAt < ACTIVE_MS);
const pointById = (game, pointId) => game.config.points.find(p => p.id === pointId);
const target = (game, team) => pointById(game, team.route[team.step]);
const started = game => game.teams.some(t => t.startedAt);

export function requirePlayer(game, token) {
  const player = typeof token === 'string' && Object.hasOwn(game.players, token) ? game.players[token] : null;
  check(player, 'צריך להצטרף למשחק מחדש', 401);
  return player;
}

export function checkAccess(game, access) {
  check(same(String(access ?? '').trim(), game.access), 'הסיסמה למשחק שגויה', 403);
}

function fresh(position, now) {
  return !!position && now - position.time < FRESH_MS;
}

function near(point, position, now, extra = 0) {
  return fresh(position, now) && position.accuracy <= MAX_ACCURACY + extra && distance(position, point) <= RADIUS + extra;
}

function buildRoutes(game) {
  const ids = game.config.points.map(p => p.id);
  for (const team of game.teams) {
    const shift = game.config.staggered ? Math.floor(team.id * ids.length / game.teams.length) : 0;
    team.route = [...ids.slice(shift), ...ids.slice(0, shift)];
  }
}

// ---- זמן ----

export function tick(game, now) {
  if (statusOf(game) !== 'open') return false;
  let changed = false;
  for (const team of game.teams) changed = tickTeam(game, team, now) || changed;
  return changed;
}

function tickTeam(game, team, now) {
  if (!team.startedAt || team.finishedAt) return false;
  if (now >= team.startedAt + LIMIT_MS) {
    finish(game, team, team.startedAt + LIMIT_MS, true);
    return true;
  }
  let changed = false;
  const wait = team.penalty;
  if (wait) {
    const point = target(game, team);
    let until = 0;
    for (const p of members(game, team)) {
      const pos = p.position;
      if (pos && pos.accuracy <= MAX_ACCURACY + PRESENCE_EXTRA && distance(pos, point) <= RADIUS + PRESENCE_EXTRA) {
        until = Math.max(until, pos.time + FRESH_MS);
      }
    }
    wait.remaining -= Math.max(0, Math.min(now, until) - wait.at);
    wait.at = now;
    wait.counting = until > now;
    if (wait.remaining <= 0) {
      team.penalty = null;
      changed = true;
    }
  }
  // חבר קבוצה שהתנתק לא מעכב את ההסכמה
  if (team.stage === 'riddle' && !team.penalty && agreed(game, team, now)) {
    solveRiddle(game, team, now);
    changed = true;
  }
  return changed;
}

function agreed(game, team, now) {
  const voters = activeMembers(game, team, now);
  return voters.length > 0 && voters.every(p => team.votes[p.id]);
}

function solveRiddle(game, team, now) {
  const voters = members(game, team).filter(p => team.votes[p.id]).map(p => p.name);
  team.log.push({ point: team.route[team.step], kind: 'riddle', correct: true, time: now, players: voters });
  team.stage = 'task';
  team.votes = {};
}

function finish(game, team, at, timedOut) {
  team.finishedAt = at;
  team.timedOut = timedOut;
  team.penalty = null;
  const playing = game.teams.filter(t => members(game, t).length);
  if (playing.length && playing.every(t => t.finishedAt)) {
    game.endedAt = Math.max(...playing.map(t => t.finishedAt));
    game.pendingMail = true;
  }
}

function advance(game, team, now) {
  team.step++;
  team.stage = 'riddle';
  team.votes = {};
  team.penalty = null;
  team.codeFails = [];
  for (const p of members(game, team)) p.asked = null;
  if (team.step >= team.route.length) finish(game, team, now, false);
}

// ---- פעולות מנהל ----

export function updateConfig(game, config) {
  check(statusOf(game) !== 'ended', 'המשחק הסתיים. אפסו אותו כדי לערוך', 409);
  check(!started(game), 'אי אפשר לערוך מסלול אחרי שקבוצה התחילה. אפסו את המשחק כדי לערוך', 409);
  const next = cleanConfig(config, game.config);
  if (statusOf(game) === 'open') {
    const missing = problems({ config: next });
    check(!missing.length, missing[0]);
  }
  game.config = next;
  if (statusOf(game) === 'open') buildRoutes(game);
}

export function openGame(game, now) {
  check(statusOf(game) === 'draft', 'המשחק כבר נפתח', 409);
  const missing = problems(game);
  check(!missing.length, missing[0]);
  buildRoutes(game);
  game.openedAt = now;
}

export function endGame(game, now) {
  check(statusOf(game) === 'open', 'המשחק אינו פעיל', 409);
  for (const team of game.teams) {
    if (team.startedAt && !team.finishedAt) {
      team.finishedAt = Math.min(now, team.startedAt + LIMIT_MS);
      team.penalty = null;
    }
  }
  game.endedAt = now;
  game.pendingMail = true;
}

/** מוחק שחקנים ותוצאות ומשאיר את המסלול, כדי לשחק שוב. */
export function resetGame(game) {
  game.players = {};
  game.teams = makeTeams();
  game.endedAt = null;
  game.mail = null;
  game.pendingMail = false;
  if (game.openedAt) buildRoutes(game);
}

export function newAccess(game) {
  game.access = digits(6);
}

export function skipPoint(game, teamId, now) {
  check(statusOf(game) === 'open', 'המשחק אינו פעיל', 409);
  const team = game.teams[[0, 1, 2, 3].indexOf(teamId)];
  check(team?.startedAt && !team.finishedAt, 'אי אפשר לדלג עבור הקבוצה הזו');
  team.log.push({ point: team.route[team.step], kind: 'skip', time: now });
  advance(game, team, now);
}

// ---- פעולות שחקן ----

export function join(game, input, now) {
  check(statusOf(game) !== 'ended', 'המשחק כבר הסתיים', 409);
  const name = text(input.name, 30);
  check(name, 'כתבו שם');
  const open = game.teams.filter(t => !t.finishedAt);
  let team;
  if (input.team === null || input.team === undefined) {
    const least = Math.min(...open.map(t => members(game, t).length));
    team = shuffled(open.filter(t => members(game, t).length === least))[0];
  } else {
    team = open.find(t => t.id === input.team);
  }
  check(team, 'הקבוצה אינה פתוחה להצטרפות');
  const token = id();
  game.players[token] = { id: id(6), name, team: team.id, joinedAt: now, seenAt: now };
  return token;
}

export function leave(game, token) {
  const player = requirePlayer(game, token);
  check(!game.teams[player.team].startedAt, 'אי אפשר להחליף קבוצה אחרי שהיא התחילה', 409);
  delete game.players[token];
}

export function seen(player, now) {
  player.seenAt = now;
}

export function setPosition(player, fix, now) {
  const { lat, lng, accuracy, age = 0 } = fix ?? {};
  if (![lat, lng, accuracy, age].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || accuracy < 0) return;
  player.position = { lat, lng, accuracy, time: now - Math.max(0, age) };
}

export function startTeam(game, player, now) {
  check(statusOf(game) === 'open', 'המנהל עוד לא פתח את המשחק', 409);
  const team = game.teams[player.team];
  check(!team.startedAt, 'הקבוצה כבר התחילה', 409);
  team.startedAt = now;
}

function atPoint(game, player, now) {
  check(statusOf(game) === 'open', 'המשחק אינו פעיל', 409);
  const team = game.teams[player.team];
  check(team.startedAt, 'הקבוצה עוד לא התחילה', 409);
  tickTeam(game, team, now);
  check(!team.finishedAt, 'הקבוצה כבר סיימה', 409);
  const point = target(game, team);
  check(fresh(player.position, now), 'מחכים לקליטת מיקום עדכני', 409);
  check(near(point, player.position, now), `החידה נפתחת רק במרחק ${RADIUS} מטר מהנקודה`, 409);
  return { team, point };
}

export function openPoint(game, player, now) {
  const { team, point } = atPoint(game, player, now);
  const result = {
    point: point.id, number: team.step + 1, name: point.name, stage: team.stage,
    question: point.question, hint: point.hint,
    image: point.image ? `${point.id}-${point.image}` : null, imageAlt: point.imageAlt,
  };
  if (team.stage === 'riddle') {
    // התשובה הנכונה לעולם לא מופיעה פעמיים ברצף באותו מקום
    const position = shuffled([0, 1, 2].filter(i => i !== player.lastSlot))[0];
    const options = shuffled(point.wrong);
    options.splice(position, 0, point.correct);
    player.lastSlot = position;
    player.asked = { id: id(6), point: point.id, options };
    Object.assign(result, { id: player.asked.id, options });
  }
  return result;
}

export function imageOf(game, player, now) {
  const { point } = atPoint(game, player, now);
  check(point.image, 'אין תמונה בנקודה הזו', 404);
  return point.id;
}

export function answer(game, player, input, now) {
  const { team, point } = atPoint(game, player, now);
  check(team.stage === 'riddle', 'החידה כבר נפתרה', 409);
  check(!team.penalty, 'צריך לסיים את ההמתנה', 409);
  check(!team.votes[player.id], 'כבר בחרת תשובה', 409);
  const asked = player.asked;
  check(asked && asked.id === input.id && asked.point === point.id, 'החידה התעדכנה, פתחו אותה שוב', 409);
  check([0, 1, 2].includes(input.choice), 'בחרו תשובה');
  const choice = asked.options[input.choice];
  player.asked = null;

  if (choice !== point.correct) {
    // מספיק שחבר אחד טועה, וכל הקבוצה ממתינה
    team.log.push({ point: point.id, kind: 'riddle', correct: false, time: now, players: [player.name], answer: choice });
    team.penalty = { remaining: WAIT_MS, at: now, counting: true, by: player.name };
    team.votes = {};
    for (const p of members(game, team)) p.asked = null;
    return { correct: false };
  }
  team.votes[player.id] = true;
  if (agreed(game, team, now)) solveRiddle(game, team, now);
  return { correct: true, solved: team.stage === 'task' };
}

export function submitCode(game, player, input, now) {
  const { team, point } = atPoint(game, player, now);
  check(team.stage === 'task', 'קודם צריך לפתור את החידה', 409);
  team.codeFails = team.codeFails.filter(t => now - t < CODE_WINDOW_MS);
  check(team.codeFails.length < CODE_TRIES, 'יותר מדי ניסיונות. המתינו שתי דקות ונסו שוב', 429);
  if (!same(String(input.code ?? '').trim(), point.code)) {
    team.codeFails.push(now);
    throw new GameError('הקוד שגוי. בקשו מהמדריך להקליד אותו שוב');
  }
  team.log.push({ point: point.id, kind: 'task', time: now, players: [player.name] });
  advance(game, team, now);
}

// ---- תצוגות ----

export function standings(game, now, detailsFor = () => true, reveal = true) {
  const rows = game.teams.filter(t => t.startedAt && members(game, t).length).map(team => {
    const of = kind => team.log.filter(l => l.kind === kind);
    const end = team.finishedAt ?? Math.min(now, team.startedAt + LIMIT_MS);
    return {
      id: team.id, name: team.name, color: team.color, ink: team.ink,
      players: members(game, team).map(p => p.name),
      done: of('task').length,
      riddles: of('riddle').filter(l => l.correct).length,
      wrong: of('riddle').filter(l => !l.correct).length,
      skipped: of('skip').length,
      total: team.route.length,
      finished: !!team.finishedAt && !team.timedOut && team.step >= team.route.length,
      timedOut: team.timedOut,
      playing: !team.finishedAt,
      time: end - team.startedAt,
      details: !detailsFor(team) ? null : team.route.map((pointId, i) => {
        const point = pointById(game, pointId);
        const log = team.log.filter(l => l.point === pointId);
        const visible = reveal || log.length > 0;
        return {
          number: i + 1, name: point.name,
          question: visible ? point.question : '',
          correct: reveal ? point.correct : null,
          riddle: log.some(l => l.kind === 'riddle' && l.correct),
          task: log.some(l => l.kind === 'task'),
          skipped: log.some(l => l.kind === 'skip'),
          attempts: log.map(({ point: _, time, ...rest }) => ({ ...rest, at: time - team.startedAt })),
        };
      }),
    };
  });
  rows.sort((a, b) => b.done - a.done || a.time - b.time || a.wrong - b.wrong);
  return rows.map((row, i) => ({ ...row, rank: i + 1 }));
}

const teamSummary = (game, team) => ({
  id: team.id, name: team.name, color: team.color, ink: team.ink, colorName: team.colorName,
  players: members(game, team).map(p => p.name), started: !!team.startedAt, finished: !!team.finishedAt,
});

export function publicView(game) {
  return {
    code: game.code, title: game.config.title, status: statusOf(game), demo: game.config.demo,
    count: game.config.points.length,
    teams: game.teams.map(t => {
      const { players, ...team } = teamSummary(game, t);
      return { ...team, size: players.length };
    }),
  };
}

export function playerView(game, player, now) {
  const team = game.teams[player.team];
  const status = statusOf(game);
  const view = {
    now, status, title: game.config.title, demo: game.config.demo, name: player.name,
    team: teamSummary(game, team), startedAt: team.startedAt, finishedAt: team.finishedAt,
    timedOut: team.timedOut, limit: LIMIT_MS, radius: RADIUS,
    canStart: status === 'open' && !team.startedAt,
  };
  if (team.startedAt) {
    Object.assign(view, {
      step: Math.min(team.step, team.route.length), total: team.route.length,
      route: team.route.map((pointId, i) => {
        const p = pointById(game, pointId);
        const skipped = team.log.some(l => l.point === pointId && l.kind === 'skip');
        const state = i < team.step ? (skipped ? 'skipped' : 'done') : i === team.step && !team.finishedAt ? 'current' : 'todo';
        return { n: i + 1, lat: p.lat, lng: p.lng, name: p.name, state };
      }),
    });
  }
  if (team.startedAt && !team.finishedAt && status === 'open') {
    const point = target(game, team);
    const active = activeMembers(game, team, now);
    Object.assign(view, {
      target: { id: point.id, n: team.step + 1, lat: point.lat, lng: point.lng, name: point.name },
      stage: team.stage,
      arrived: near(point, player.position, now),
      wait: team.penalty && { remaining: team.penalty.remaining, counting: team.penalty.counting, by: team.penalty.by },
      votes: team.stage === 'riddle' ? {
        mine: !!team.votes[player.id],
        done: members(game, team).filter(p => team.votes[p.id]).map(p => p.name),
        waiting: active.filter(p => !team.votes[p.id]).map(p => p.name),
      } : null,
    });
  }
  if (team.finishedAt || status === 'ended') {
    const ended = status === 'ended';
    view.results = standings(game, now, t => ended || t === team, ended);
  }
  return view;
}

export function adminSummary(game) {
  return {
    code: game.code, title: game.config.title, status: statusOf(game), access: game.access,
    createdAt: game.createdAt, points: game.config.points.length,
    players: Object.keys(game.players).length, mail: game.mail,
  };
}

export function adminView(game, now) {
  return {
    now, code: game.code, access: game.access, status: statusOf(game), config: game.config,
    openedAt: game.openedAt, endedAt: game.endedAt, problems: problems(game), mail: game.mail,
    locked: started(game), limit: LIMIT_MS, radius: RADIUS,
    teams: game.teams.map(t => ({
      ...teamSummary(game, t), step: t.step, total: t.route.length, stage: t.stage,
      startedAt: t.startedAt, finishedAt: t.finishedAt, timedOut: t.timedOut,
      wait: t.penalty?.remaining ?? null,
    })),
    positions: Object.values(game.players).filter(p => p.position).map(p => ({
      name: p.name, team: p.team, lat: p.position.lat, lng: p.position.lng, stale: !fresh(p.position, now),
    })),
    results: standings(game, now),
  };
}
