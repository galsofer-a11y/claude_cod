/* global L */
export const ISRAEL = [31.7, 35.1];
const OSM = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
export const GREEN = '#1f8a4c';
export const RED = '#d0312d';

export function createMap(element, { center = ISRAEL, zoom = 8 } = {}) {
  if (!window.L) {
    element.innerHTML = '<p class="notice" dir="rtl">המפה לא נטענה. בדקו את חיבור האינטרנט ורעננו את הדף.</p>';
    return null;
  }
  const map = L.map(element, { zoomSnap: 0.5, maxZoom: 20 }).setView(center, zoom);
  // מפת השבילים של ישראל כוללת סימוני שבילים בצבעים, דרכים, גדרות, מעיינות ונקודות עניין
  const israel = L.tileLayer('https://israelhiking.osm.org.il/Hebrew/Tiles/{z}/{x}/{y}.png', {
    minZoom: 7, maxNativeZoom: 16, maxZoom: 20,
    attribution: `<a href="https://israelhiking.osm.org.il">Israel Hiking Map</a> ${OSM}`,
  });
  const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxNativeZoom: 17, maxZoom: 20,
    attribution: `&copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA) ${OSM}`,
  });
  // במפת הרחובות המפורטת רואים ספסלים, גדרות ושבילים קטנים בהגדלה גבוהה
  const streets = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxNativeZoom: 19, maxZoom: 20, attribution: OSM });
  const trails = L.tileLayer('https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png', {
    maxNativeZoom: 17, maxZoom: 20,
    attribution: '&copy; <a href="https://hiking.waymarkedtrails.org">Waymarked Trails</a>',
  });

  israel.addTo(map);
  let loaded = 0, failed = 0;
  israel.on('tileload', () => loaded++);
  israel.on('tileerror', () => {
    if (!loaded && ++failed >= 6 && map.hasLayer(israel)) {
      map.removeLayer(israel);
      topo.addTo(map);
    }
  });

  L.control.layers(
    { 'שבילי ישראל': israel, 'טופוגרפית': topo, 'מפורטת (ספסלים וגדרות)': streets },
    { 'סימון שבילים': trails },
    { position: 'topright' },
  ).addTo(map);
  L.control.scale({ imperial: false }).addTo(map);

  const observer = new ResizeObserver(() => map.invalidateSize({ pan: false }));
  observer.observe(element);
  map.on('unload', () => observer.disconnect());
  return map;
}

/** נקודה במסלול: אדומה עד שנפתרה, ירוקה עם סימן הצלחה אחרי שנפתרה */
export function pointIcon(n, state) {
  const done = state === 'done';
  const skipped = state === 'skipped';
  const current = state === 'current';
  const label = done ? '✓' : n;
  const size = current ? 46 : 36;
  return L.divIcon({
    className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2],
    html: `<div class="spot ${state}" style="--s:${size}px"><b>${label}</b>${done || skipped ? `<small>${n}</small>` : ''}</div>`,
  });
}

/** קו המסלול בין הנקודות. קטע שהנקודה בסופו נפתרה נצבע בירוק ומודגש */
export function drawRoute(layer, points) {
  layer.clearLayers();
  for (let i = 1; i < points.length; i++) {
    const solved = ['done', 'skipped'].includes(points[i].state);
    const next = points[i].state === 'current';
    L.polyline([[points[i - 1].lat, points[i - 1].lng], [points[i].lat, points[i].lng]], solved
      ? { color: GREEN, weight: 7, opacity: 0.95, interactive: false }
      : { color: next ? RED : '#12362a', weight: next ? 5 : 4, opacity: 0.85, dashArray: '10 9', interactive: false }).addTo(layer);
  }
}

export const icons = {
  me: color => L.divIcon({ className: '', iconSize: [24, 24], html: `<div class="me" style="--c:${color}"></div>` }),
  dot: (color, stale) => L.divIcon({ className: '', iconSize: [18, 18], html: `<div class="dot ${stale ? 'stale' : ''}" style="--c:${color}"></div>` }),
};
