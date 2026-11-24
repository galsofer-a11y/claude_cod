import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import * as g from '../lib/game.js';
import { createApp } from '../server.js';
import { sendMail } from '../lib/mail.js';

const point = (i, extra = {}) => ({
  id: `p${i}`, lat: 32 + i / 100, lng: 35, name: `N${i}`, question: `Q${i}`, hint: `H${i}`,
  correct: `ok${i}`, wrong: [`a${i}`, `b${i}`], code: `${7350 + i}`, ...extra,
});
const at = (game, player, i, now, accuracy = 5, offset = 0) => {
  g.seen(player, now);
  g.setPosition(player, { lat: 32 + i / 100 + offset, lng: 35, accuracy }, now);
};

function setup(count = 2, teams = [0], options = {}) {
  const game = g.createGame('ABCDEF', { points: Array.from({ length: count }, (_, i) => point(i)), ...options }, 0);
  const players = teams.map((team, i) => game.players[g.join(game, { name: `n${i}`, team }, 0)]);
  g.openGame(game, 500);
  for (const team of new Set(teams)) g.startTeam(game, players[teams.indexOf(team)], 1000);
  return { game, players };
}

function vote(game, player, i, now, right = true) {
  at(game, player, i, now);
  const q = g.openPoint(game, player, now);
  return g.answer(game, player, { id: q.id, choice: q.options.findIndex(o => (o === `ok${i}`) === right) }, now);
}

function clear(game, players, i, now) {
  for (const p of players) vote(game, p, i, now);
  g.submitCode(game, players[0], { code: `${7350 + i}` }, now);
}

test('four distinct team names and colors, 6 digit password', () => {
  const game = g.createGame('ABCDEF', {}, 0);
  assert.equal(new Set(game.teams.map(t => t.name)).size, 4);
  assert.equal(new Set(game.teams.map(t => t.color)).size, 4);
  assert.match(game.access, /^\d{6}$/);
});

test('instructor codes are generated and kept', () => {
  const game = g.createGame('ABCDEF', { points: [point(0, { code: '' })] }, 0);
  const code = game.config.points[0].code;
  assert.match(code, /^\d{4}$/);
  g.updateConfig(game, { points: [{ ...game.config.points[0], code: 'bad' }] });
  assert.equal(game.config.points[0].code, code);
});

test('automatic assignment balances unlimited players', () => {
  const game = g.createGame('ABCDEF', {}, 0);
  for (let i = 0; i < 1000; i++) g.join(game, { name: `n${i}` }, 0);
  assert.deepEqual(g.publicView(game).teams.map(t => t.size), [250, 250, 250, 250]);
});

test('team clock starts only by the team, after the game opens', () => {
  const game = g.createGame('ABCDEF', { points: [point(0)] }, 0);
  const p = game.players[g.join(game, { name: 'x', team: 2 }, 0)];
  assert.throws(() => g.startTeam(game, p, 1));
  g.openGame(game, 2);
  assert.equal(game.teams[2].startedAt, null);
  g.startTeam(game, p, 5);
  assert.equal(game.teams[2].startedAt, 5);
  assert.equal(game.teams[0].startedAt, null);
});

test('riddle content needs 15 meters, fresh and accurate GPS', () => {
  const { game, players: [p] } = setup();
  assert.throws(() => g.openPoint(game, p, 2000));
  at(game, p, 0, 2000, 5, 0.00018); // כ-20 מטר
  assert.throws(() => g.openPoint(game, p, 2000), /15/);
  at(game, p, 0, 2000, 200);
  assert.throws(() => g.openPoint(game, p, 2000), /GPS/);
  at(game, p, 0, 2000, 45);
  assert.equal(g.playerView(game, p, 2000).arrived, true, 'typical phone accuracy near trees still opens');
  at(game, p, 0, 2000, 5, 0.00012); // כ-13 מטר
  assert.equal(g.openPoint(game, p, 2000).question, 'Q0');
  assert.throws(() => g.imageOf(game, p, 2000 + g.FRESH_MS + 1));
});

test('correct answer moves on every opening', () => {
  const { game, players: [p] } = setup();
  let last;
  const seen = new Set();
  for (let i = 0; i < 300; i++) {
    at(game, p, 0, 2000 + i);
    const slot = g.openPoint(game, p, 2000 + i).options.indexOf('ok0');
    assert.notEqual(slot, last);
    seen.add(slot);
    last = slot;
  }
  assert.equal(seen.size, 3);
});

test('whole team must agree before the riddle is solved', () => {
  const { game, players: [a, b] } = setup(2, [0, 0]);
  at(game, b, 0, 2000);
  assert.deepEqual(vote(game, a, 0, 2000), { correct: true, solved: false });
  assert.equal(game.teams[0].stage, 'riddle');
  assert.deepEqual(g.playerView(game, a, 2000).votes.waiting, ['n1']);
  assert.deepEqual(vote(game, b, 0, 2100), { correct: true, solved: true });
  assert.equal(game.teams[0].stage, 'task');
});

test('a member who left does not block the team', () => {
  const { game, players: [a] } = setup(2, [0, 0]);
  vote(game, a, 0, 2000);
  for (let t = 5000; t <= 2000 + g.ACTIVE_MS + 3000; t += 5000) at(game, a, 0, t);
  g.tick(game, 2000 + g.ACTIVE_MS + 3000);
  assert.equal(game.teams[0].stage, 'task');
});

test('one wrong vote locks everyone for two minutes on site', () => {
  const { game, players: [a, b] } = setup(2, [0, 0]);
  at(game, b, 0, 2000);
  vote(game, a, 0, 2000);
  assert.equal(vote(game, b, 0, 2000, false).correct, false);
  assert.deepEqual(game.teams[0].votes, {});
  assert.throws(() => vote(game, a, 0, 2100), /המתנה/);
  for (let t = 5000; t < 122000; t += 3000) { g.tick(game, t); at(game, a, 0, t); at(game, b, 0, t); }
  g.tick(game, 121999);
  assert.ok(game.teams[0].penalty);
  g.tick(game, 122000);
  assert.equal(game.teams[0].penalty, null);
});

test('wait pauses away from the point', () => {
  const { game, players: [p] } = setup();
  vote(game, p, 0, 2000, false);
  g.tick(game, 12000);
  at(game, p, 1, 12000);
  g.tick(game, 300000);
  assert.equal(game.teams[0].penalty.remaining, g.WAIT_MS - 10000);
});

test('only the instructor code completes a point, with a try limit', () => {
  const { game, players: [p] } = setup();
  assert.throws(() => g.submitCode(game, p, { code: '7350' }, 2000));
  vote(game, p, 0, 2000);
  for (let i = 0; i < 5; i++) assert.throws(() => g.submitCode(game, p, { code: '9999' }, 2000 + i), /שגוי/);
  assert.throws(() => g.submitCode(game, p, { code: '7350' }, 3000), /ניסיונות/);
  at(game, p, 0, 123_000);
  g.submitCode(game, p, { code: '7350' }, 123_000);
  assert.equal(game.teams[0].step, 1);
  const view = g.playerView(game, p, 130_000);
  assert.deepEqual(view.route.map(r => r.state), ['done', 'current']);
});

test('player view hides riddles, answers and codes', () => {
  const { game, players: [p] } = setup();
  at(game, p, 0, 2000);
  const json = JSON.stringify(g.playerView(game, p, 2000));
  for (const secret of ['ok0', 'Q0', 'H0', 'Q1', '7350', '7351']) assert.ok(!json.includes(secret), secret);
});

test('team stops after 90 minutes and game ends when all are done', () => {
  const { game, players: [a, b] } = setup(1, [0, 1]);
  clear(game, [a], 0, 5000);
  assert.equal(game.endedAt, null);
  g.tick(game, 1000 + g.LIMIT_MS + 1);
  assert.equal(game.teams[1].timedOut, true);
  assert.equal(game.endedAt, 1000 + g.LIMIT_MS);
  assert.equal(game.pendingMail, true);
  const rows = g.standings(game, game.endedAt);
  assert.deepEqual(rows.map(r => [r.id, r.done, r.rank]), [[0, 1, 1], [1, 0, 2]]);
  assert.equal(rows[1].time, g.LIMIT_MS);
  assert.ok(g.playerView(game, b, game.endedAt).results);
});

test('ranking: more points first, then faster time', () => {
  const { game, players: [a, b, c] } = setup(2, [0, 1, 2]);
  clear(game, [a], 0, 2000); clear(game, [a], 1, 9000);
  clear(game, [b], 0, 3000); clear(game, [b], 1, 4000);
  clear(game, [c], 0, 2500);
  g.endGame(game, 10000);
  assert.deepEqual(g.standings(game, 10000).map(r => r.id), [1, 0, 2]);
});

test('reset keeps the route and removes players', () => {
  const { game, players: [a] } = setup();
  clear(game, [a], 0, 2000);
  g.resetGame(game);
  assert.equal(Object.keys(game.players).length, 0);
  assert.equal(game.teams[0].step, 0);
  assert.equal(game.config.points.length, 2);
  assert.equal(g.statusOf(game), 'open');
});

test('SMTP client sends the summary', async t => {
  const lines = [];
  const server = net.createServer(socket => {
    socket.write('220 hi\r\n');
    let data = false;
    socket.on('data', chunk => {
      for (const line of chunk.toString().split('\r\n').filter(Boolean)) {
        lines.push(line);
        if (data) { if (line === '.') { data = false; socket.write('250 queued\r\n'); } continue; }
        if (line.startsWith('EHLO')) socket.write('250-hello\r\n250 OK\r\n');
        else if (line === 'DATA') { data = true; socket.write('354 go\r\n'); }
        else if (line === 'QUIT') socket.end('221 bye\r\n');
        else socket.write('250 ok\r\n');
      }
    });
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => server.close());
  await sendMail({ host: '127.0.0.1', port: server.address().port, secure: false, from: 'a@x.test', to: 'b@x.test', subject: 'סיכום', html: '<p>שלום</p>' });
  assert.ok(lines.includes('RCPT TO:<b@x.test>'));
});

test('HTTP: passwords, admin, full point, image privacy, mail', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'galmon-test-'));
  const sent = [];
  const server = createApp({ dataDir: dir, localAdmin: true, env: { SMTP_USER: 'u@x.test', SMTP_PASS: 'p', ADMIN_EMAIL: 'Boss@x.test' }, mailer: async m => sent.push(m) });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => { server.close(); server.closeAllConnections(); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let cookie = '';
  const call = async (url, { method = 'GET', body, token, raw, admin = true } = {}) => {
    const headers = { 'X-Galmon': admin ? '1' : '', Cookie: cookie, ...(token && { Authorization: `Bearer ${token}` }) };
    const r = await fetch(`${base}${url}`, { method, headers, body: raw ?? (body && JSON.stringify(body)) });
    if (r.headers.get('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    const type = r.headers.get('content-type');
    return [r.status, type.includes('json') ? await r.json() : await r.arrayBuffer()];
  };

  assert.equal((await call('/admin/games'))[0], 401);
  assert.equal((await call('/admin/local', { method: 'POST', admin: false }))[0], 403);
  assert.equal((await call('/admin/local', { method: 'POST' }))[0], 200);
  const [, { code, access }] = await call('/admin/games', { method: 'POST', body: { title: 'T', points: [point(0)] } });
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  assert.equal((await call(`/admin/games/${code}/images/p0`, { method: 'PUT', raw: Buffer.from('nope') }))[0], 400);
  const [, withImage] = await call(`/admin/games/${code}/images/p0`, { method: 'PUT', raw: jpeg });
  assert.ok(withImage.config.points[0].image);
  await call(`/admin/games/${code}`, { method: 'PUT', body: { ...withImage.config, points: [{ ...withImage.config.points[0], imageAlt: 'עץ' }] } });
  assert.equal((await call(`/admin/games/${code}/open`, { method: 'POST' }))[0], 200);

  assert.equal((await call(`/games/${code}/enter`, { method: 'POST', body: { access: '000000' } }))[0], 403);
  assert.equal((await call(`/games/${code}/enter`, { method: 'POST', body: { access } }))[0], 200);
  const [, { token }] = await call(`/games/${code}/join`, { method: 'POST', body: { access, name: 'P' } });
  const here = { position: { lat: 32, lng: 35, accuracy: 4 } };
  assert.equal((await call(`/games/${code}/me/image`, { method: 'POST', token, body: here }))[0], 409);
  await call(`/games/${code}/me/start`, { method: 'POST', token });
  assert.equal((await call(`/games/${code}/me/image`, { method: 'POST', token, body: { position: { lat: 32.01, lng: 35, accuracy: 4 } } }))[0], 409);
  const [imageStatus, image] = await call(`/games/${code}/me/image`, { method: 'POST', token, body: here });
  assert.equal(imageStatus, 200);
  assert.equal(Buffer.from(image).length, jpeg.length);
  const [, q] = await call(`/games/${code}/me/point`, { method: 'POST', token, body: here });
  assert.equal(q.hint, 'H0', JSON.stringify(q));
  await call(`/games/${code}/me/answer`, { method: 'POST', token, body: { ...here, id: q.id, choice: q.options.indexOf('ok0') } });
  const [, done] = await call(`/games/${code}/me/code`, { method: 'POST', token, body: { ...here, code: '7350' } });
  assert.equal(done.view.status, 'ended');
  await new Promise(r => setTimeout(r, 50));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'boss@x.test');
  assert.ok(sent[0].html.includes('T'));
  assert.ok(!fs.readFileSync(path.join(dir, `${code}.json`), 'utf8').includes('"accuracy"'));
  assert.equal(done.view.results[0].done, 1);

  assert.equal((await call(`/admin/games/${code}/reset`, { method: 'POST' }))[0], 200);
  assert.equal((await call(`/games/${code}/me`, { method: 'POST', token }))[0], 401);
  assert.equal((await call(`/admin/games/${code}`, { method: 'DELETE' }))[0], 200);
  assert.ok(!fs.existsSync(path.join(dir, `${code}.json`)));
  assert.equal((await fetch(`${base.replace('/api', '')}/%2e%2e%2fserver.js`)).status, 404);
});

test('arrival explains why a riddle does not open yet', () => {
  const { game, players: [p] } = setup();
  const view = () => g.playerView(game, p, 2000).arrival;
  assert.equal(g.playerView(game, p, 2000).arrival.reason, 'stale');
  at(game, p, 0, 2000, 5, 0.0003); // כ-33 מטר
  assert.deepEqual([view().reason, view().meters], ['far', 33]);
  at(game, p, 0, 2000, 5, 0.00001); // כ-1 מטר
  assert.deepEqual([view().reason, view().meters], ['ok', 1]);
  at(game, p, 0, 2000, 500);
  assert.equal(view().reason, 'accuracy');
});
