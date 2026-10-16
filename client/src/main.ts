import '../styles/app.css';
import { ApiError, api } from './api';
import { BoardApp } from './board';
import { renderLogin } from './login';
import { t } from './i18n';

const mount = document.getElementById('root');
if (!mount) throw new Error('#root missing');

async function openBoard(): Promise<void> {
  mount!.replaceChildren(loading());
  const snapshot = await api.board();
  new BoardApp(mount!, snapshot);
}

function loading(): HTMLElement {
  const div = document.createElement('div');
  div.className = 'boot';
  div.textContent = t('common.loading');
  return div;
}

async function start(): Promise<void> {
  try {
    await api.me();
    await openBoard();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      renderLogin(mount!, () => { void openBoard(); });
      return;
    }
    mount!.replaceChildren(errorScreen());
  }
}

function errorScreen(): HTMLElement {
  const div = document.createElement('div');
  div.className = 'boot boot-error';
  div.textContent = t('login.error');
  return div;
}

void start();
