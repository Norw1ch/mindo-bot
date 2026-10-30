'use strict';

// ---------- Telegram ----------

const tg = window.Telegram ? window.Telegram.WebApp : null;
const inTelegram = Boolean(tg && tg.initData);

if (inTelegram) {
  tg.ready();
  tg.expand();
}

// ---------- Хранилище ----------
// В Telegram данные лежат в облаке Telegram, в обычном браузере — в localStorage (для просмотра)

const useCloud = inTelegram && tg.isVersionAtLeast('6.9');
const LS_PREFIX = 'mindo:';

function cloudCall(method, ...args) {
  return new Promise((resolve, reject) => {
    tg.CloudStorage[method](...args, (err, result) => (err ? reject(new Error(err)) : resolve(result)));
  });
}

const store = {
  async loadAll() {
    const out = {};
    if (!useCloud) {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith(LS_PREFIX)) out[key.slice(LS_PREFIX.length)] = localStorage.getItem(key);
      }
      return out;
    }
    const keys = await cloudCall('getKeys');
    // Читаем порциями, чтобы не упереться в лимиты Telegram
    for (let i = 0; i < keys.length; i += 100) {
      Object.assign(out, await cloudCall('getItems', keys.slice(i, i + 100)));
    }
    return out;
  },
  async set(key, value) {
    if (useCloud) await cloudCall('setItem', key, value);
    else localStorage.setItem(LS_PREFIX + key, value);
  },
  async remove(key) {
    if (useCloud) await cloudCall('removeItem', key);
    else localStorage.removeItem(LS_PREFIX + key);
  },
};

// ---------- Данные ----------
// sections: [{id, name}] — в ключе "sections"
// ideas: {id, sec, text, st, at} — каждая идея в своём ключе "i_<id>"

const data = { sections: [], ideas: [] };

function parse(value) {
  try { return JSON.parse(value); } catch { return null; }
}

async function loadData() {
  const raw = await store.loadAll();
  data.sections = parse(raw.sections) || [];
  data.ideas = Object.keys(raw)
    .filter((k) => k.startsWith('i_'))
    .map((k) => parse(raw[k]))
    .filter(Boolean);
}

function activeCount(sectionId) {
  return data.ideas.filter((i) => i.sec === sectionId && i.st !== 'done').length;
}

// ---------- Навигация ----------
// Стек экранов: последний — текущий. «Назад» убирает верхний.

const stack = [{ name: 'main' }];

function go(route) {
  stack.push(route);
  render();
}

function back() {
  if (stack.length > 1) {
    stack.pop();
    render();
  }
}

// ---------- Экраны ----------

const views = {};

views.main = () => {
  const rows = data.sections.map((s) => `
    <button class="row" data-act="open-section" data-id="${s.id}">
      <span class="title">${esc(s.name)}</span>
      <span class="meta">${activeCount(s.id)}</span>
    </button>`).join('');

  return `
    <h1>Журнал идей</h1>
    <p class="sub">${data.sections.length ? 'Выбери раздел' : 'Разделов пока нет'}</p>
    ${rows ? `<div class="list">${rows}</div>` : ''}
    <div class="actions">
      <button class="btn" data-act="new-section">➕ Новый раздел</button>
      <button class="btn quiet" data-act="open-archive">🗄 Архив Done</button>
    </div>`;
};

// ---------- Действия по нажатию ----------

const actions = {
  'back': back,
  // Заглушки: появятся на следующих этапах
  'open-section': () => toast('Будет на следующем этапе'),
  'new-section': () => toast('Будет на следующем этапе'),
  'open-archive': () => toast('Будет на следующем этапе'),
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const action = actions[el.dataset.act];
  if (action) action(el.dataset, el);
});

// ---------- Отрисовка ----------

const app = document.getElementById('app');

function render() {
  const route = stack[stack.length - 1];
  // Вне Telegram показываем свою кнопку «Назад», в Telegram — встроенную
  const backLink = !inTelegram && stack.length > 1
    ? '<button class="back" data-act="back">← Назад</button>' : '';
  app.innerHTML = backLink + views[route.name](route);
  window.scrollTo(0, 0);

  if (inTelegram) {
    if (stack.length > 1) tg.BackButton.show();
    else tg.BackButton.hide();
  }
}

// ---------- Мелочи ----------

function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

let toastTimer;
function toast(text) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

function applyTheme() {
  const dark = inTelegram
    ? tg.colorScheme === 'dark'
    : window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  if (inTelegram) {
    const bg = dark ? '#0f0f0f' : '#ffffff';
    try {
      tg.setBackgroundColor(bg);
      tg.setHeaderColor(bg);
    } catch { /* старая версия Telegram — оставляем как есть */ }
  }
}

// ---------- Запуск ----------

async function start() {
  applyTheme();
  if (inTelegram) {
    tg.onEvent('themeChanged', applyTheme);
    tg.BackButton.onClick(back);
  }
  try {
    await loadData();
    render();
  } catch (err) {
    app.innerHTML = `<p class="empty">Не удалось загрузить данные.<br>${esc(err.message)}</p>`;
  }
}

start();
