// שליחת מייל סיכום דרך SMTP (למשל Gmail עם סיסמת אפליקציה), ללא ספריות חיצוניות.
import net from 'node:net';
import tls from 'node:tls';
import { randomBytes } from 'node:crypto';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ESCAPES[c]);
const b64 = value => Buffer.from(value, 'utf8').toString('base64');
const header = value => `=?UTF-8?B?${b64(value)}?=`;
const clean = value => String(value).replace(/[\r\n<>]/g, '');

function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const two = n => String(n).padStart(2, '0');
  return `${s >= 3600 ? `${Math.floor(s / 3600)}:` : ''}${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`;
}

export function summaryMail(game, rows) {
  const cell = 'padding:8px 10px;border-bottom:1px solid #c5d3c0;text-align:right';
  const table = rows.map(r => `<tr>
    <td style="${cell};font-weight:700">${r.rank}</td>
    <td style="${cell}"><b style="color:${esc(r.color)}">■</b> ${esc(r.name)}<br><small>${r.players.map(esc).join(', ')}</small></td>
    <td style="${cell};font-weight:700;font-size:18px">${r.score}</td>
    <td style="${cell}">${r.done} / ${r.total}</td>
    <td style="${cell}">${clock(r.time)}${r.timedOut ? ' (נגמר הזמן)' : r.finished ? '' : ' (לא סיימה)'}</td>
    <td style="${cell}">${r.riddlePoints} / ${r.taskPoints} / ${r.timeBonus}</td>
    <td style="${cell}">${r.taskAverage ?? '–'}</td>
    <td style="${cell}">${r.riddles}</td><td style="${cell}">${r.wrong}</td></tr>`).join('');
  const details = rows.map(r => `<h3 style="margin:18px 0 6px">${esc(r.name)}</h3><ol style="margin:0;padding-right:20px">${
    r.details.map(d => `<li>${esc(d.name || `נקודה ${d.number}`)}: ${d.riddle ? 'חידה נפתרה' : 'חידה לא נפתרה'}, ${
      d.task ? `משימה הושלמה, ציון ${d.taskScore ?? '–'}` : d.skipped ? 'דילוג של המנהל' : 'משימה לא הושלמה'}</li>`).join('')}</ol>`).join('');
  return {
    subject: `גלמון: סיכום המשחק "${game.config.title}"`,
    html: `<!doctype html><html lang="he" dir="rtl"><body style="font-family:Arial,sans-serif;color:#172620">
      <h1 style="color:#12362a">סיכום משחק: ${esc(game.config.title)}</h1>
      <p>קוד משחק ${esc(game.code)}. ${rows.length ? `השתתפו ${rows.length} קבוצות.` : 'אף קבוצה לא התחילה לשחק.'}</p>
      ${rows.length ? `<table style="border-collapse:collapse;width:100%"><tr style="background:#12362a;color:#fff">
        <th style="${cell}">מקום</th><th style="${cell}">קבוצה</th><th style="${cell}">ניקוד</th><th style="${cell}">נקודות</th>
        <th style="${cell}">זמן</th><th style="${cell}">חידות / משימות / זמן</th><th style="${cell}">ציון משימות ממוצע</th>
        <th style="${cell}">חידות</th><th style="${cell}">טעויות</th></tr>${table}</table>
      <p style="font-size:13px;color:#52655b">הניקוד: 100 לכל חידה שנפתרה פחות 20 על כל טעות (לפחות 40), ציון המדריך למשימה כפול 10, ו-2 נקודות לכל דקה שנשארה למי שסיים את המסלול.</p>${details}` : ''}
      <p style="color:#52655b;font-size:12px">נשלח אוטומטית מאתר גלמון.</p></body></html>`,
  };
}

function message({ from, to, subject, html }) {
  const body = b64(html).replace(/.{1,76}/g, '$&\r\n');
  return [
    `From: ${header('גלמון')} <${clean(from)}>`, `To: <${clean(to)}>`, `Subject: ${header(subject)}`,
    `Date: ${new Date().toUTCString()}`, `Message-ID: <${randomBytes(12).toString('hex')}@galmon>`,
    'MIME-Version: 1.0', 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', body,
  ].join('\r\n');
}

export function sendMail({ host, port, secure = true, user, pass, from, to, subject, html }) {
  const steps = [
    [null, 220], ['EHLO galmon', 250],
    ...(user ? [['AUTH LOGIN', 334], [b64(user), 334], [b64(pass), 235]] : []),
    [`MAIL FROM:<${clean(from)}>`, 250], [`RCPT TO:<${clean(to)}>`, 250], ['DATA', 354],
    [`${message({ from, to, subject, html })}\r\n.`, 250], ['QUIT', 221],
  ];
  return new Promise((resolve, reject) => {
    const socket = secure ? tls.connect({ host, port, servername: host }) : net.connect(port, host);
    let buffer = '', step = 0, done = false;
    const fail = error => { if (!done) { done = true; socket.destroy(); reject(error); } };
    socket.setTimeout(20_000, () => fail(new Error('SMTP timeout')));
    socket.on('error', fail);
    socket.on('close', () => fail(new Error('SMTP connection closed')));
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      let match;
      // תשובה מסתיימת בשורה שבה אחרי הקוד יש רווח ולא מקף
      while ((match = buffer.match(/^(\d{3}) [^\r\n]*\r?\n/m))) {
        const end = match.index + match[0].length;
        const reply = buffer.slice(0, end);
        buffer = buffer.slice(end);
        const code = Number(match[1]);
        if (code !== steps[step][1]) return fail(new Error(`SMTP ${reply.trim().slice(0, 200)}`));
        step++;
        if (step === steps.length) {
          done = true;
          socket.end();
          return resolve();
        }
        socket.write(`${steps[step][0]}\r\n`);
      }
    });
  });
}
