import { blaze, clock, esc } from './util.js';

const DEFAULT_SCORING = { riddle: 100, wrongPenalty: 20, riddleMin: 40, taskMax: 10, taskFactor: 10, minuteBonus: 2 };

function attempt(a) {
  const when = clock(a.at);
  const who = (a.players ?? []).map(esc).join(', ');
  if (a.kind === 'skip') return `<span class="attempt skip">${when}: המנהל דילג על הנקודה</span>`;
  if (a.kind === 'task') return `<span class="attempt yes">${when}: המשימה הושלמה${a.score ? `, ציון המדריך ${a.score}` : ''}</span>`;
  if (a.correct) return `<span class="attempt yes">${when}: החידה נפתרה (${who})</span>`;
  return `<span class="attempt">${when}: ${who} בחר/ה „${esc(a.answer)}”, תשובה שגויה</span>`;
}

function status(r) {
  if (r.finished) return 'סיימה את המסלול';
  if (r.timedOut) return 'נגמרו 90 הדקות';
  return r.playing ? 'עדיין במסלול' : 'המשחק נעצר';
}

export function scoringRules(s = DEFAULT_SCORING) {
  return `<details class="route" data-key="scoring"><summary>איך מחושב הניקוד?</summary>
    <ul class="scoring-rules">
      <li><b>חידה:</b> ${s.riddle} נקודות לכל חידה שנפתרה, פחות ${s.wrongPenalty} על כל תשובה שגויה באותה נקודה (לפחות ${s.riddleMin}).</li>
      <li><b>משימה:</b> המדריך נותן ציון 1 עד ${s.taskMax} על עבודת צוות, עמידה בזמנים ועידוד. כל נקודת ציון שווה ${s.taskFactor} נקודות.</li>
      <li><b>זמן:</b> קבוצה שסיימה את כל המסלול מקבלת ${s.minuteBonus} נקודות על כל דקה שנשארה מתוך 90.</li>
      <li>הדירוג לפי הניקוד הכולל. בשוויון, הקבוצה המהירה יותר מדורגת גבוה יותר.</li>
    </ul></details>`;
}

export function resultsTable(rows, { highlight = null, scoring = DEFAULT_SCORING } = {}) {
  if (!rows.length) return '<p>עוד אין קבוצות שהתחילו לשחק.</p>';

  const board = rows.map(r => `
    <tr class="${r.rank <= 3 ? `top top-${r.rank}` : ''} ${r.id === highlight ? 'mine' : ''}">
      <td class="rank" data-label="מקום"><span>${r.rank}</span></td>
      <td class="name"><span class="team">${blaze(r.color)}<span><b>${esc(r.name)}</b><small>${r.players.map(esc).join(', ')}</small></span></span></td>
      <td class="score-total" data-label="ניקוד"><b>${r.score}</b>
        <small>חידות ${r.riddlePoints} · משימות ${r.taskPoints} · זמן ${r.timeBonus}</small></td>
      <td class="score" data-label="נקודות"><b>${r.done}</b><small> מתוך ${r.total}</small>
        <span class="bar" aria-hidden="true"><i style="width:${r.total ? Math.round(r.done / r.total * 100) : 0}%"></i></span></td>
      <td class="time" data-label="זמן"><b>${clock(r.time)}</b><small>${status(r)}</small></td>
      <td data-label="ציון משימות">${r.taskAverage ?? '–'}<small> ממוצע</small></td>
      <td data-label="חידות">${r.riddles}<small> נפתרו · ${r.wrong} טעויות</small>${r.skipped ? `<small> · ${r.skipped} דילוגים</small>` : ''}</td>
    </tr>`).join('');

  const routes = rows.filter(r => r.details).map(r => `
    <details class="route" data-key="route-${r.id}">
      <summary>${blaze(r.color)} הנקודות של ${esc(r.name)}: ${r.riddles} חידות נפתרו מתוך ${r.total}</summary>
      <ol>${r.details.map(d => `
        <li><b>${d.task ? '✓' : d.skipped ? '–' : '✗'} נקודה ${d.number}${d.name ? `, ${esc(d.name)}` : ''}${d.taskScore ? ` · ציון משימה ${d.taskScore}` : ''}</b>
          ${d.question ? `<div>${esc(d.question)}</div>` : ''}
          ${d.attempts.map(attempt).join('') || '<span class="attempt skip">הקבוצה לא הגיעה לנקודה</span>'}
          ${d.correct && !d.riddle ? `<span class="small">התשובה הנכונה: ${esc(d.correct)}</span>` : ''}
        </li>`).join('')}</ol>
    </details>`).join('');

  return `
    <table class="board">
      <caption class="sr-only">דירוג הקבוצות לפי ניקוד</caption>
      <thead><tr><th scope="col">מקום</th><th scope="col">קבוצה</th><th scope="col">ניקוד</th><th scope="col">נקודות</th>
        <th scope="col">זמן</th><th scope="col">ציון משימות</th><th scope="col">חידות</th></tr></thead>
      <tbody>${board}</tbody>
    </table>
    ${scoringRules(scoring)}
    ${routes}`;
}
