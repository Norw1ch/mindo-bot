'use strict';

// Вкладки внизу экрана и запуск приложения

// Монохромная иконка 24×24 из контуров
function icon(paths) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

// root — главный экран вкладки
const TABS = [
  {
    key: 'plans', label: 'Планы', root: { name: 'main' },
    icon: icon('<circle cx="12" cy="12" r="9"/><path d="m8.2 12.4 2.6 2.6 5-5.2"/>'),
  },
  {
    key: 'notes', label: 'Заметки', root: { name: 'notes' },
    icon: icon('<path d="M6.5 3h8l4 4v12.5a1.5 1.5 0 0 1-1.5 1.5h-10.5A1.5 1.5 0 0 1 5 19.5v-15A1.5 1.5 0 0 1 6.5 3z"/><path d="M14 3v4.5h4.5M8.5 12.5h7M8.5 16.5h5"/>'),
  },
  {
    key: 'habits', label: 'Привычки', root: { name: 'habits' },
    icon: icon('<rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8.5 3v4M15.5 3v4M4 10h16M9 15.3l2 2 4-4"/>'),
  },
  {
    key: 'money', label: 'Расходы', root: { name: 'soon', title: 'Расходы' },
    icon: icon('<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M6.5 6V5.5A2.5 2.5 0 0 1 9 3h8.5M3 10.5h18M16 15h2"/>'),
  },
  {
    key: 'lists', label: 'Списки', root: { name: 'lists' },
    icon: icon('<path d="M9.5 6.5h10M9.5 12h10M9.5 17.5h10"/><circle cx="5" cy="6.5" r="1.1"/><circle cx="5" cy="12" r="1.1"/><circle cx="5" cy="17.5" r="1.1"/>'),
  },
];

// Заглушка для вкладок, которые появятся на следующих этапах
views.soon = (route) => `
  <h1>${route.title}</h1>
  <p class="sub">Скоро</p>
  <p class="empty">Этот раздел появится на одном из следующих этапов</p>`;

async function start() {
  applyTheme();
  if (inTelegram) {
    tg.onEvent('themeChanged', applyTheme);
    tg.BackButton.onClick(back);
  }
  buildTabbar();
  try {
    await loadData();
    root.replaceChildren(); // убираем «Загрузка…»
    switchTab('plans');
    // Первый экран: строки появляются по очереди
    const first = screens[0];
    first.classList.add('intro');
    setTimeout(() => first.classList.remove('intro'), 1500);
  } catch (err) {
    root.innerHTML = `<p class="empty">Не удалось загрузить данные.<br>${esc(err.message)}</p>`;
  }
}

start();
