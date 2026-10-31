'use strict';

// «Главная»: первый экран приложения. Свои данные не хранит — показывает то, что есть в разделах

// «Суббота, 31 октября»
function todayLine() {
  const text = new Date().toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });
  return text[0].toUpperCase() + text.slice(1);
}

// Число с подписью. Длинная сумма пишется мельче, чтобы все три числа оставались в один ряд
function statHtml(value, label, cls = '') {
  const size = value.length > 12 ? ' longer' : value.length > 8 ? ' long' : '';
  return `<div class="today-stat"><b class="${size}${cls}">${value}</b><span>${label}</span></div>`;
}

function todayCardHtml() {
  const { done, total } = habitsToday();
  const progress = total ? Math.round((done / total) * 100) : 0;
  return `
    <section class="today-card">
      <p class="home-label">${t('Сегодня')}</p>
      <div class="today-stats">
        ${statHtml(`${done}/${total}`, t('привычки'))}
        ${statHtml(String(wipCount()), t('в работе'))}
        ${statHtml(formatMoney(todaySpent()), t('расходы'), takeFlash('total') ? ' swap' : '')}
      </div>
      <div class="today-bar"><span style="width:${progress}%"></span></div>
    </section>`;
}

function settingsIcon() {
  return icon('<path d="M4 7h9M18 7h2M4 17h2M11 17h9"/><circle cx="15.5" cy="7" r="2.5"/><circle cx="8.5" cy="17" r="2.5"/>');
}

function plusIcon() {
  return icon('<path d="M12 5v14M5 12h14"/>');
}

// Быстрые кнопки: форма добавления открывается прямо здесь, на главной
function quickBtnHtml(act, label) {
  return `<button class="btn quick-btn" data-act="${act}">${plusIcon()}${label}</button>`;
}

// Плитка раздела: иконка как на вкладке, название, под ним короткая сводка
function tileHtml(key, note) {
  const tab = TABS.find((t) => t.key === key);
  return `
    <button class="tile" data-act="open-tab" data-tab="${key}">
      ${tab.icon}
      <span class="tile-text"><b>${t(tab.label)}</b><span>${note}</span></span>
    </button>`;
}

function tilesHtml() {
  const { done, total } = habitsToday();
  return `
    <p class="home-label tiles-head">${t('Разделы')}</p>
    <div class="tiles">
      ${tileHtml('plans', t('{0} в работе', wipCount()))}
      ${tileHtml('notes', plural(notes.items.length, ['заметка', 'заметки', 'заметок']))}
      ${tileHtml('habits', t('{0} из {1} сегодня', done, total))}
      ${tileHtml('money', t('{0} сегодня', formatMoney(todaySpent())))}
      ${tileHtml('lists', plural(lists.items.length, ['список', 'списка', 'списков']))}
      <button class="tile add" data-act="quick-section">
        ${plusIcon()}
        <span class="tile-text"><b>${t('Новый раздел')}</b></span>
      </button>
      <button class="tile wide" data-act="open-settings">
        ${settingsIcon()}
        <span class="tile-text"><b>${t('Настройки')}</b><span>${LANGS[lang].name}</span></span>
      </button>
    </div>`;
}

// ---------- Поиск по всему ----------
// Группы идут по порядку разделов: find(query) — что нашлось, row(item, query, n) — строка результата.
// Найденное открывается здесь же, на главной: «Назад» возвращает к результатам

const SEARCH_GROUPS = [
  { label: 'Задачи', find: searchIdeas, row: searchRowHtml },
  { label: 'Заметки', find: searchNotes, row: (note, query, n) => noteRowHtml(note, n, query) },
  { label: 'Привычки', find: searchHabits, row: habitSearchRowHtml },
  { label: 'Расходы', find: searchExpenses, row: expenseSearchRowHtml },
  { label: 'Списки', find: searchLists, row: listSearchRowHtml },
];

function homeSearchHtml(route) {
  const query = (route.q || '').trim();
  if (!query) return '';
  const found = SEARCH_GROUPS.flatMap((g) => {
    const items = g.find(query);
    return items.map((item) => ({ g, item, label: `${t(g.label)} · ${items.length}` }));
  });
  if (!found.length) return `<p class="empty small">${t('Ничего не найдено')}</p>`;
  return groupedPage(found, route, (f) => ({ key: f.g.label, label: f.label }), (f, n) => f.g.row(f.item, query, n));
}

pagers.home = homeSearchHtml;

searchHandlers.home = (route, query, inner) => {
  const results = inner.querySelector('.search-results');
  if (query) results.innerHTML = homeSearchHtml(route);
  showSearchState(inner, Boolean(query));
};

views.home = (route) => {
  // Пока в поиске есть текст — вместо обычного содержимого результаты
  const searching = Boolean((route.q || '').trim());
  return `
    <p class="home-date">${todayLine()}</p>
    <h1>${t('Главная')}</h1>
    <div class="home-search">${searchHtml(route.q, t('Поиск по всему'))}</div>
    <div class="search-results paged${searching ? '' : ' hidden'}">${searching ? homeSearchHtml(route) : ''}</div>
    <div class="search-body${searching ? ' hidden' : ''}">
      ${todayCardHtml()}
      <div class="quick-btns">
        ${quickBtnHtml('quick-idea', t('Задача'))}
        ${quickBtnHtml('quick-note', t('Заметка'))}
        ${quickBtnHtml('add-expense', t('Расход'))}
      </div>
      ${tilesHtml()}
    </div>`;
};

Object.assign(actions, {
  'quick-note': async () => {
    if (await actions['new-note']()) toast(t('Заметка сохранена'));
  },

  'open-tab': ({ tab }) => {
    softHaptic();
    switchTab(tab);
  },

  // Раздел создаётся в Задачах: сразу на их главный экран, там он и появится.
  // Всё без пауз: иначе iPhone не откроет клавиатуру для окна ввода
  'quick-section': () => {
    switchTab('plans');
    resetToRoot();
    createSection();
  },
});
