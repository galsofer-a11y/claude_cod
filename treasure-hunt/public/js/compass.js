import { windName } from './geo.js';

const SENSOR_FRESH_MS = 3000;
const MOVEMENT_FRESH_MS = 10000;

/** iOS מאפשר לבקש חיישן כיוון רק מתוך לחיצה, לכן קוראים לזה לפני כל await. */
export function requestCompass() {
  const request = window.DeviceOrientationEvent?.requestPermission;
  if (typeof request !== 'function') return;
  request.call(window.DeviceOrientationEvent).catch(() => {});
}

export function trackHeading(onChange) {
  let sensor = null, movement = null;

  function onOrientation(event) {
    let heading;
    if (typeof event.webkitCompassHeading === 'number' && event.webkitCompassAccuracy >= 0) {
      heading = event.webkitCompassHeading;
    } else if (event.absolute && typeof event.alpha === 'number') {
      heading = 360 - event.alpha;
    } else {
      return; // ערך יחסי בלבד אינו מצביע לצפון
    }
    const rotation = screen.orientation?.angle ?? window.orientation ?? 0;
    sensor = { value: (heading + rotation + 360) % 360, time: Date.now() };
    onChange();
  }

  const events = ['deviceorientationabsolute', 'deviceorientation'];
  events.forEach(name => addEventListener(name, onOrientation));

  return {
    moved(heading) { movement = { value: heading, time: Date.now() }; },
    read() {
      if (sensor && Date.now() - sensor.time < SENSOR_FRESH_MS) return { value: sensor.value, source: 'sensor' };
      if (movement && Date.now() - movement.time < MOVEMENT_FRESH_MS) return { value: movement.value, source: 'movement' };
      return { value: 0, source: 'north' };
    },
    stop() { events.forEach(name => removeEventListener(name, onOrientation)); },
  };
}

export const compassSvg = () => `
  <svg viewBox="0 0 120 120" aria-hidden="true">
    <circle cx="60" cy="60" r="57" fill="#0b271d" stroke="#f2b705" stroke-width="3"/>
    <g class="ring" fill="#dce7d5" font-family="Assistant, Arial" font-size="13" font-weight="700" text-anchor="middle">
      ${Array.from({ length: 16 }, (_, i) => `<path d="M60 5v${i % 4 ? 4 : 7}" stroke="#dce7d5" transform="rotate(${i * 22.5} 60 60)"/>`).join('')}
      <text x="60" y="25" fill="#ff8070">צ</text><text x="101" y="64">מז</text>
      <text x="60" y="105">ד</text><text x="19" y="64">מע</text>
    </g>
    <g class="needle"><path d="M60 30 77 78 60 67 43 78Z" fill="#f2b705"/><path d="M60 30v37L43 78Z" fill="#fff" opacity=".55"/></g>
  </svg>`;

// הזווית נצברת כדי שהמחט לא תסתובב סיבוב שלם במעבר מ-359 ל-0
function rotate(element, degrees) {
  const previous = Number(element.dataset.angle ?? 0);
  const next = previous + (((degrees - previous) % 360 + 540) % 360 - 180);
  element.dataset.angle = next;
  element.style.transform = `rotate(${next}deg)`;
}

export function paintCompass(container, heading, targetBearing) {
  rotate(container.querySelector('.ring'), -heading);
  const needle = container.querySelector('.needle');
  needle.style.visibility = targetBearing === null ? 'hidden' : 'visible';
  if (targetBearing !== null) rotate(needle, targetBearing - heading);
  container.setAttribute('aria-label', targetBearing === null ? 'מצפן' : `היעד בכיוון ${windName(targetBearing)}`);
}
