// צלצולים קצרים שנוצרים בדפדפן, בלי קובצי שמע.
import { storage } from './util.js';

let context = null;

/** דפדפנים מאפשרים צליל רק אחרי לחיצה, לכן קוראים לזה מתוך לחיצה */
export function unlockSound() {
  try {
    context ??= new (window.AudioContext || window.webkitAudioContext)();
    if (context.state === 'suspended') context.resume();
  } catch { /* אין תמיכה בשמע */ }
}

function tone(frequency, start, length, volume, type = 'sine') {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + length + 0.05);
}

export function chime(kind) {
  if (!context || storage.get('galmon:a11y', {}).mute) return;
  const t = context.currentTime + 0.03;
  if (kind === 'arrive') {
    // שני צלילים רכים: הגעתם לנקודה
    tone(659.25, t, 0.7, 0.2);
    tone(987.77, t + 0.22, 1.1, 0.16);
  } else if (kind === 'correct') {
    // ארפג'יו עולה: תשובה נכונה
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, t + i * 0.11, 0.8, 0.14, 'triangle'));
  } else if (kind === 'done') {
    [783.99, 1046.5, 1318.5].forEach((f, i) => tone(f, t + i * 0.16, 1, 0.12, 'triangle'));
  } else if (kind === 'wrong') {
    tone(311.13, t, 0.35, 0.12);
    tone(233.08, t + 0.25, 0.6, 0.12);
  }
}
