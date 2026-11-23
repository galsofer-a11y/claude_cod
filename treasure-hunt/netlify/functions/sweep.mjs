// בדיקה מתוזמנת: מסיימת קבוצות שעברו 90 דקות ושולחת מיילי סיכום שממתינים.
import { createHandler } from '../../lib/app.js';
import { blobStore } from '../../lib/blob-store.js';

export default async () => {
  await createHandler({ storage: blobStore(), env: process.env }).sweep();
};

export const config = { schedule: '*/5 * * * *' };
