// כל משחק נשמר בקובץ JSON, והתמונות בתיקייה נפרדת. מיקומי השחקנים נשארים בזיכרון בלבד.
import fs from 'node:fs';
import path from 'node:path';
import { upgrade } from './game.js';

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

export function createStore(dir, now = Date.now()) {
  const images = path.join(dir, 'images');
  fs.mkdirSync(images, { recursive: true });
  const games = new Map();

  for (const file of fs.readdirSync(dir)) {
    if (!/^[A-Z2-9]{6}\.json$/.test(file)) continue;
    try {
      const game = upgrade(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')), now);
      games.set(game.code, game);
    } catch (error) {
      console.error(`Cannot load ${file}: ${error.message}`);
    }
  }

  const imageDir = code => {
    if (!CODE.test(code)) throw new Error('bad code');
    return path.join(images, code);
  };
  const imageFile = (code, pointId) => {
    if (!POINT.test(pointId)) throw new Error('bad point');
    return path.join(imageDir(code), `${pointId}.jpg`);
  };

  return {
    get: code => games.get(code),
    all: () => [...games.values()],
    add: game => games.set(game.code, game),
    save(game) {
      const body = JSON.stringify(game, (key, value) => (key === 'position' && value?.lat !== undefined ? undefined : value));
      try {
        writeSafely(path.join(dir, `${game.code}.json`), body);
      } catch (error) {
        console.error(`Cannot save ${game.code}: ${error.message}`);
      }
    },
    remove(code) {
      games.delete(code);
      fs.rmSync(path.join(dir, `${code}.json`), { force: true });
      fs.rmSync(imageDir(code), { recursive: true, force: true });
    },
    readImage: (code, pointId) => fs.promises.readFile(imageFile(code, pointId)),
    writeImage(code, pointId, data) {
      fs.mkdirSync(imageDir(code), { recursive: true });
      writeSafely(imageFile(code, pointId), data);
    },
    removeImage: (code, pointId) => fs.rmSync(imageFile(code, pointId), { force: true }),
    copyImages(from, to) {
      if (fs.existsSync(imageDir(from))) fs.cpSync(imageDir(from), imageDir(to), { recursive: true });
    },
    /** מוחק תמונות של נקודות שכבר אינן במסלול */
    pruneImages(game) {
      const keep = new Set(game.config.points.filter(p => p.image).map(p => `${p.id}.jpg`));
      if (!fs.existsSync(imageDir(game.code))) return;
      for (const file of fs.readdirSync(imageDir(game.code))) {
        if (!keep.has(file)) fs.rmSync(path.join(imageDir(game.code), file), { force: true });
      }
    },
  };
}
