'use strict';

// «Главная»: первый экран приложения. Свои данные не хранит — показывает то, что есть в разделах

// «Суббота, 31 октября»
function todayLine() {
  const text = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
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
      <p class="home-label">Сегодня</p>
      <div class="today-stats">
        ${statHtml(`${done}/${total}`, 'привычки')}
        ${statHtml(String(wipCount()), 'в работе')}
        ${statHtml(formatMoney(todaySpent()), 'расходы', takeFlash('total') ? ' swap' : '')}
      </div>
      <div class="today-bar"><span style="width:${progress}%"></span></div>
    </section>`;
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
      <span class="tile-text"><b>${tab.label}</b><span>${note}</span></span>
    </button>`;
}

function tilesHtml() {
  const { done, total } = habitsToday();
  return `
    <p class="home-label tiles-head">Разделы</p>
    <div class="tiles">
      ${tileHtml('plans', `${wipCount()} в работе`)}
      ${tileHtml('notes', plural(notes.items.length, ['заметка', 'заметки', 'заметок']))}
      ${tileHtml('habits', `${done} из ${total} сегодня`)}
      ${tileHtml('money', `${formatMoney(todaySpent())} сегодня`)}
      ${tileHtml('lists', plural(lists.items.length, ['список', 'списка', 'списков']))}
      <button class="tile add" data-act="quick-section">
        ${plusIcon()}
        <span class="tile-text"><b>Новый раздел</b></span>
      </button>
    </div>`;
}

// ---------- Поиск по всему ----------
// Группы идут по порядку разделов: find(query) — что нашлось, row(item, query, n) — строка результата.
// Найденное открывается здесь же, на главной: «Назад» возвращает к результатам

const SEARCH_GROUPS = [
  { label: 'Планы', find: searchIdeas, row: searchRowHtml },
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
    return items.map((item) => ({ g, item, label: `${g.label} · ${items.length}` }));
  });
  if (!found.length) return '<p class="empty small">Ничего не найдено</p>';
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
    <h1>Главная</h1>
    <div class="home-search">${searchHtml(route.q, 'Поиск по всему')}</div>
    <div class="search-results paged${searching ? '' : ' hidden'}">${searching ? homeSearchHtml(route) : ''}</div>
    <div class="search-body${searching ? ' hidden' : ''}">
      ${todayCardHtml()}
      <div class="quick-btns">
        ${quickBtnHtml('quick-idea', 'Идея')}
        ${quickBtnHtml('quick-note', 'Заметка')}
        ${quickBtnHtml('add-expense', 'Расход')}
      </div>
      ${tilesHtml()}
    </div>`;
};

Object.assign(actions, {
  'quick-note': async () => {
    if (await actions['new-note']()) toast('Заметка сохранена');
  },

  'open-tab': ({ tab }) => {
    softHaptic();
    switchTab(tab);
  },

  // Раздел создаётся в Планах: сразу на их главный экран, там он и появится.
  // Всё без пауз: иначе iPhone не откроет клавиатуру для окна ввода
  'quick-section': () => {
    switchTab('plans');
    resetToRoot();
    createSection();
  },
});
