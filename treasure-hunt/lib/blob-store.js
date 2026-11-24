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
  // ב-Netlify הרשאת הגישה לאחסון ניתנת לכל בקשה בנפרד ופגה אחרי זמן קצר,
  // ולכן פותחים את החיבור מחדש בכל פעולה ולא שומרים אותו בין בקשות
  const open = name => getStore({ name, consistency: 'strong', ...options });
  const stores = { get games() { return open('galmon-games'); }, get images() { return open('galmon-images'); } };

  async function keysOf(store, prefix) {
    // רשומות פנימיות (כמו בדיקת התקינות) מתחילות בקו תחתון ואינן משחקים
    const { blobs } = await store.list(prefix ? { prefix } : {});
    return blobs.map(b => b.key);
  }

  return {
    async readGame(code) {
      const found = await stores.games.getWithMetadata(code, { type: 'json' });
      if (!found) return null;
      // בלי ETag השמירה לא יכולה להיות מותנית, ועדיף להיכשל מאשר לדרוס שינויים של שחקן אחר
      if (!found.etag) throw new Error('Netlify Blobs returned no ETag');
      return { game: found.data, tag: found.etag };
    },
    async writeGame(game, tag) {
      if (tag !== null && !tag) throw new Error('missing ETag for conditional write');
      const { modified } = await stores.games.setJSON(game.code, game, tag === null ? { onlyIfNew: true } : { onlyIfMatch: tag });
      return modified;
    },
    async listGames() {
      const keys = (await keysOf(stores.games)).filter(key => CODE.test(key));
      const all = await Promise.all(keys.map(key => stores.games.get(key, { type: 'json' })));
      return all.filter(Boolean);
    },
    async deleteGame(code) {
      await stores.games.delete(code);
      await Promise.all((await keysOf(stores.images, `${code}/`)).map(key => stores.images.delete(key)));
    },
    /** בודק שהאחסון מחזיר ETag ודוחה שמירה מיושנת, כלומר ששמירה בו-זמנית בטוחה */
    async health() {
      const key = '_health';
      await stores.games.setJSON(key, { at: Date.now() });
      const first = await stores.games.getWithMetadata(key, { type: 'json' });
      if (!first?.etag) return 'no-etag';
      const fresh = await stores.games.setJSON(key, { at: Date.now(), n: 1 }, { onlyIfMatch: first.etag });
      const stale = await stores.games.setJSON(key, { at: Date.now(), n: 2 }, { onlyIfMatch: first.etag });
      return fresh.modified && !stale.modified ? 'ok' : 'conditional-writes-not-enforced';
    },
    async readImage(code, pointId) {
      const data = await stores.images.get(imageKey(code, pointId), { type: 'arrayBuffer' });
      return data ? Buffer.from(data) : null;
    },
    async writeImage(code, pointId, data) {
      await stores.images.set(imageKey(code, pointId), new Blob([data], { type: 'image/jpeg' }));
    },
    async deleteImage(code, pointId) {
      await stores.images.delete(imageKey(code, pointId));
    },
    async copyImages(from, to) {
      for (const key of await keysOf(stores.images, `${from}/`)) {
        const data = await stores.images.get(key, { type: 'arrayBuffer' });
        if (data) await stores.images.set(`${to}/${key.slice(from.length + 1)}`, new Blob([data], { type: 'image/jpeg' }));
      }
    },
    async pruneImages(game) {
      const keep = new Set(game.config.points.filter(p => p.image).map(p => `${game.code}/${p.id}`));
      await Promise.all((await keysOf(stores.images, `${game.code}/`)).filter(key => !keep.has(key)).map(key => stores.images.delete(key)));
    },
  };
}
