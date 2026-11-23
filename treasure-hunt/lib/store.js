// אחסון במחשב: כל משחק בקובץ JSON והתמונות בתיקייה. מיקומי השחקנים נשארים בזיכרון בלבד.
// לאחסון ב-Netlify ראו blob-store.js. לשניהם אותו ממשק.
import fs from 'node:fs';
import path from 'node:path';

const CODE = /^[A-Z2-9]{6}$/;
const POINT = /^[\w-]{1,40}$/;

function writeSafely(file, data) {
  try {
    fs.writeFileSync(`${file}.tmp`, data);
    fs.renameSync(`${file}.tmp`, file);
  } catch {
    // OneDrive ואנטי-וירוס נועלים לפעמים את הקובץ לרגע
    fs.writeFileSync(file, data);
  }
}

export function fileStore(dir) {
  const imagesDir = path.join(dir, 'images');
  fs.mkdirSync(imagesDir, { recursive: true });
  const games = new Map(); // code -> { game, rev }

  for (const file of fs.readdirSync(dir)) {
    if (!/^[A-Z2-9]{6}\.json$/.test(file)) continue;
    try {
      const game = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      games.set(game.code, { game, rev: 1 });
    } catch (error) {
      console.error(`Cannot load ${file}: ${error.message}`);
    }
  }

  const imageDir = code => {
    if (!CODE.test(code)) throw new Error('bad code');
    return path.join(imagesDir, code);
  };
  const imageFile = (code, pointId) => {
    if (!POINT.test(pointId)) throw new Error('bad point');
    return path.join(imageDir(code), `${pointId}.jpg`);
  };
  const persist = game => {
    const body = JSON.stringify(game, (key, value) => (key === 'position' && value?.lat !== undefined ? undefined : value));
    try {
      writeSafely(path.join(dir, `${game.code}.json`), body);
    } catch (error) {
      console.error(`Cannot save ${game.code}: ${error.message}`);
    }
  };

  return {
    async readGame(code) {
      const entry = games.get(code);
      return entry ? { game: structuredClone(entry.game), tag: String(entry.rev) } : null;
    },
    /** שמירה מותנית: נכשלת אם מישהו שמר בינתיים (tag שונה), או אם tag ריק והמשחק כבר קיים */
    async writeGame(game, tag) {
      const entry = games.get(game.code);
      if (tag === null ? entry : !entry || String(entry.rev) !== tag) return false;
      games.set(game.code, { game: structuredClone(game), rev: (entry?.rev ?? 0) + 1 });
      persist(game);
      return true;
    },
    async listGames() {
      return [...games.values()].map(e => structuredClone(e.game));
    },
    async deleteGame(code) {
      games.delete(code);
      fs.rmSync(path.join(dir, `${code}.json`), { force: true });
      fs.rmSync(imageDir(code), { recursive: true, force: true });
    },
    async health() {
      return 'ok';
    },
    async readImage(code, pointId) {
      return fs.promises.readFile(imageFile(code, pointId)).catch(() => null);
    },
    async writeImage(code, pointId, data) {
      fs.mkdirSync(imageDir(code), { recursive: true });
      writeSafely(imageFile(code, pointId), data);
    },
    async deleteImage(code, pointId) {
      fs.rmSync(imageFile(code, pointId), { force: true });
    },
    async copyImages(from, to) {
      if (fs.existsSync(imageDir(from))) fs.cpSync(imageDir(from), imageDir(to), { recursive: true });
    },
    /** מוחק תמונות של נקודות שכבר אינן במסלול */
    async pruneImages(game) {
      const keep = new Set(game.config.points.filter(p => p.image).map(p => `${p.id}.jpg`));
      if (!fs.existsSync(imageDir(game.code))) return;
      for (const file of fs.readdirSync(imageDir(game.code))) {
        if (!keep.has(file)) fs.rmSync(path.join(imageDir(game.code), file), { force: true });
      }
    },
  };
}
