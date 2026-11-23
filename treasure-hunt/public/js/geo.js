// משותף לשרת ולדפדפן
const rad = d => d * Math.PI / 180;

export function distance(a, b) {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 12742000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearing(a, b) {
  const p1 = rad(a.lat), p2 = rad(b.lat), l = rad(b.lng - a.lng);
  const deg = Math.atan2(Math.sin(l) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(l)) * 180 / Math.PI;
  return (deg + 360) % 360;
}

const WINDS = ['צפון', 'צפון-מזרח', 'מזרח', 'דרום-מזרח', 'דרום', 'דרום-מערב', 'מערב', 'צפון-מערב'];
export const windName = deg => WINDS[Math.round(deg / 45) % 8];
