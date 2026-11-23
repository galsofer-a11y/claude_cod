import { blaze, clock, esc } from './util.js';

function attempt(a) {
  const when = clock(a.at);
  const who = (a.players ?? []).map(esc).join(', ');
  if (a.kind === 'skip') return `<span class="attempt skip">${when}: המנהל דילג על הנקודה</span>`;
  if (a.kind === 'task') return `<span class="attempt yes">${when}: המשימה הושלמה, המדריך אישר</span>`;
  if (a.correct) return `<span class="attempt yes">${when}: החידה נפתרה (${who})</span>`;
  return `<span class="attempt">${when}: ${who} בחר/ה „${esc(a.answer)}”, תשובה שגויה</span>`;
}

function status(r) {
  if (r.finished) return 'סיימה את המסלול';
  if (r.timedOut) return 'נגמרו 90 הדקות';
  return r.playing ? 'עדיין במסלול' : 'המשחק נעצר';
}

export function resultsTable(rows, { highlight = null } = {}) {
  if (!rows.length) return '<p>עוד אין קבוצות שהתחילו לשחק.</p>';

  const board = rows.map(r => `
    <tr class="${r.rank <= 3 ? `top top-${r.rank}` : ''} ${r.id === highlight ? 'mine' : ''}">
      <td class="rank" data-label="מקום"><span>${r.rank}</span></td>
      <td class="name"><span class="team">${blaze(r.color)}<span><b>${esc(r.name)}</b><small>${r.players.map(esc).join(', ')}</small></span></span></td>
      <td class="score" data-label="נקודות"><b>${r.done}</b><small> מתוך ${r.total}</small>
        <span class="bar" aria-hidden="true"><i style="width:${r.total ? Math.round(r.done / r.total * 100) : 0}%"></i></span></td>
      <td class="time" data-label="זמן"><b>${clock(r.time)}</b><small>${status(r)}</small></td>
      <td data-label="חידות">${r.riddles}<small> נפתרו</small></td>
      <td data-label="טעויות">${r.wrong}${r.skipped ? `<small> · ${r.skipped} דילוגים</small>` : ''}</td>
    </tr>`).join('');

  const routes = rows.filter(r => r.details).map(r => `
    <details class="route" data-key="route-${r.id}">
      <summary>${blaze(r.color)} החידות של ${esc(r.name)}: ${r.riddles} מתוך ${r.total} נפתרו</summary>
      <ol>${r.details.map(d => `
        <li><b>${d.task ? '✓' : d.skipped ? '–' : '✗'} נקודה ${d.number}${d.name ? `, ${esc(d.name)}` : ''}</b>
          ${d.question ? `<div>${esc(d.question)}</div>` : ''}
          ${d.attempts.map(attempt).join('') || '<span class="attempt skip">הקבוצה לא הגיעה לנקודה</span>'}
          ${d.correct && !d.riddle ? `<span class="small">התשובה הנכונה: ${esc(d.correct)}</span>` : ''}
        </li>`).join('')}</ol>
    </details>`).join('');

  return `
    <table class="board">
      <caption class="sr-only">דירוג הקבוצות</caption>
      <thead><tr><th scope="col">מקום</th><th scope="col">קבוצה</th><th scope="col">נקודות</th><th scope="col">זמן</th><th scope="col">חידות</th><th scope="col">טעויות</th></tr></thead>
      <tbody>${board}</tbody>
    </table>
    <p class="small muted">הדירוג: קודם מספר הנקודות שהושלמו, ואז זמן הסיום המהיר ביותר. בשוויון מלא, פחות טעויות.</p>
    ${routes}`;
}
