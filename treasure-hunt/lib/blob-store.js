// אחסון ב-Netlify Blobs. כל משחק הוא רשומה אחת, והשמירה מותנית ב-ETag כדי שעדכונים בו-זמניים לא ידרסו זה את זה.
import { getStore } from '@netlify/blobs';

const CODE = /^[A-Z2-9]{6}$/;
const POINT = /^[\w-]{1,40}$/;

function imageKey(code, pointId) {
  if (!CODE.test(code) || !POINT.test(pointId)) throw new Error('bad image key');
  return `${code}/${pointId}`;
}

/** options משמש לבדיקות מול שרת Blobs מקומי. ב-Netlify החיבור מוגדר אוטומטית */
export function blobStore(options = {}) {
  const games = getStore({ name: 'galmon-games', consistency: 'strong', ...options });
  const images = getStore({ name: 'galmon-images', consistency: 'strong', ...options });

  async function keysOf(store, prefix) {
    // רשומות פנימיות (כמו בדיקת התקינות) מתחילות בקו תחתון ואינן משחקים
    const { blobs } = await store.list(prefix ? { prefix } : {});
    return blobs.map(b => b.key);
  }

  return {
    async readGame(code) {
      const found = await games.getWithMetadata(code, { type: 'json' });
      if (!found) return null;
      // בלי ETag השמירה לא יכולה להיות מותנית, ועדיף להיכשל מאשר לדרוס שינויים של שחקן אחר
      if (!found.etag) throw new Error('Netlify Blobs returned no ETag');
      return { game: found.data, tag: found.etag };
    },
    async writeGame(game, tag) {
      if (tag !== null && !tag) throw new Error('missing ETag for conditional write');
      const { modified } = await games.setJSON(game.code, game, tag === null ? { onlyIfNew: true } : { onlyIfMatch: tag });
      return modified;
    },
    async listGames() {
      const keys = (await keysOf(games)).filter(key => CODE.test(key));
      const all = await Promise.all(keys.map(key => games.get(key, { type: 'json' })));
      return all.filter(Boolean);
    },
    async deleteGame(code) {
      await games.delete(code);
      await Promise.all((await keysOf(images, `${code}/`)).map(key => images.delete(key)));
    },
    /** בודק שהאחסון מחזיר ETag ודוחה שמירה מיושנת, כלומר ששמירה בו-זמנית בטוחה */
    async health() {
      const key = '_health';
      await games.setJSON(key, { at: Date.now() });
      const first = await games.getWithMetadata(key, { type: 'json' });
      if (!first?.etag) return 'no-etag';
      const fresh = await games.setJSON(key, { at: Date.now(), n: 1 }, { onlyIfMatch: first.etag });
      const stale = await games.setJSON(key, { at: Date.now(), n: 2 }, { onlyIfMatch: first.etag });
      return fresh.modified && !stale.modified ? 'ok' : 'conditional-writes-not-enforced';
    },
    async readImage(code, pointId) {
      const data = await images.get(imageKey(code, pointId), { type: 'arrayBuffer' });
      return data ? Buffer.from(data) : null;
    },
    async writeImage(code, pointId, data) {
      await images.set(imageKey(code, pointId), new Blob([data], { type: 'image/jpeg' }));
    },
    async deleteImage(code, pointId) {
      await images.delete(imageKey(code, pointId));
    },
    async copyImages(from, to) {
      for (const key of await keysOf(images, `${from}/`)) {
        const data = await images.get(key, { type: 'arrayBuffer' });
        if (data) await images.set(`${to}/${key.slice(from.length + 1)}`, new Blob([data], { type: 'image/jpeg' }));
      }
    },
    async pruneImages(game) {
      const keep = new Set(game.config.points.filter(p => p.image).map(p => `${game.code}/${p.id}`));
      await Promise.all((await keysOf(images, `${game.code}/`)).filter(key => !keep.has(key)).map(key => images.delete(key)));
    },
  };
}
