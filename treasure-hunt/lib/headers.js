// כותרות אבטחה לדפי האתר. אותם ערכים מופיעים גם ב-netlify.toml, ובדיקה מוודאת שהם זהים.
const GOOGLE = 'https://accounts.google.com/gsi/';

export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  'Content-Security-Policy': [
    "default-src 'self'", `script-src 'self' https://unpkg.com ${GOOGLE}client`,
    `style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com ${GOOGLE}style`,
    'font-src https://fonts.gstatic.com', "img-src 'self' data: blob: https:", `connect-src 'self' ${GOOGLE}`,
    `frame-src ${GOOGLE}`, "frame-ancestors 'self'", "base-uri 'none'", "form-action 'self'",
  ].join('; '),
};
