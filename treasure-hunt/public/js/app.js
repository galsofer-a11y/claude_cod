import { home } from './home.js';
import { gamesList } from './admin.js';
import { host } from './host.js';
import { player } from './player.js';
import { accessibilityPage, cookieNotice, privacyPage, setupAccessibility } from './a11y.js';

const root = document.getElementById('app');
let cleanup = () => {};

function route() {
  cleanup();
  document.querySelectorAll('dialog').forEach(d => d.close());
  const [screen, code = ''] = location.hash.replace(/^#\/?/, '').split('/');
  const safeCode = /^[A-Z2-9]{6}$/i.test(code) ? code.toUpperCase() : null;

  if (screen === 'join' && safeCode) cleanup = player(root, safeCode);
  else if (screen === 'admin' && safeCode) cleanup = host(root, safeCode);
  else if (screen === 'admin') cleanup = gamesList(root);
  else if (screen === 'accessibility') cleanup = accessibilityPage(root);
  else if (screen === 'privacy') cleanup = privacyPage(root);
  else cleanup = home(root);
  scrollTo(0, 0);
}

document.querySelector('.skip').onclick = event => {
  event.preventDefault();
  (root.querySelector('main, h1') ?? root).focus?.();
  root.focus();
};

setupAccessibility();
cookieNotice();
addEventListener('hashchange', route);
route();
