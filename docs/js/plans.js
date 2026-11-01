'use strict';

// Модуль «Задачи»: разделы, задачи, статусы, фильтры, «Выполненные».
// На экране это «задачи». В коде они остались планами (plans) и идеями (ideas), а в хранилище —
// ideas: так было с первых версий, менять нельзя, иначе пропадут сохранённые данные

// ---------- Данные ----------
// sections: [{id, name}] — в ключе "sections"
// ideas: {id, sec, title, text, st, at, dt, due, items} — каждый план в своём ключе "i_<id>"
//   st — статус (new / wip / done), at — когда создан, dt — когда выполнен,
//   due — срок «2026-10-30» или пусто, items — чеклист [{id, t: текст, d: отмечен}],
//   rep — повтор (day / weekdays / week / month / year), rd — число месяца для повтора,
//   cnt — сколько раз выполнен повторяющийся план

const data = { sections: [], ideas: [] };

const SECTION_MAX = 50;
const TITLE_MAX = 80;
const IDEA_MAX = 3000; // в облаке Telegram на одну запись — до 4096 символов
const ITEM_MAX = 120;  // пункт чеклиста
const RECORD_MAX = 4000; // весь план целиком (с запасом до лимита Telegram)

modules.plans = {
  load(raw) {
    data.sections = parse(raw.sections) || [];
    data.ideas = Object.keys(raw)
      .filter((k) => k.startsWith('i_'))
      .map((k) => parse(raw[k]))
      .filter(Boolean)
      .map(normalizeIdea);
  },
};

// Старые планы без заголовка: первая строка текста становится заголовком, остальное — описанием
function normalizeIdea(idea) {
  if (idea.title) return idea;
  const [first, ...rest] = idea.text.split('\n');
  if (first.length <= TITLE_MAX) {
    idea.title = first.trim();
    idea.text = rest.join('\n').trim();
  } else {
    idea.title = shorten(first, TITLE_MAX);
  }
  return idea;
}

function activeCount(sectionId) {
  return data.ideas.filter((i) => i.sec === sectionId && i.st !== 'done').length;
}

function findSection(id) {
  return data.sections.find((s) => s.id === id);
}

// Сколько планов в работе (In progress) во всех разделах
function wipCount() {
  return data.ideas.filter((i) => i.st === 'wip' && findSection(i.sec)).length;
}

function findIdea(id) {
  return data.ideas.find((i) => i.id === id);
}

// Планы раздела по фильтру: all — активные (не Done), иначе — с этим статусом.
// Новые сверху; выполненные — по дате выполнения
function filteredIdeas(sectionId, filter) {
  return data.ideas
    .filter((i) => i.sec === sectionId && (filter === 'all' ? i.st !== 'done' : i.st === filter))
    .sort((a, b) => (filter === 'done' ? (b.dt || 0) - (a.dt || 0) : b.at - a.at));
}

// Срок прошёл, а план не выполнен
function isOverdue(idea) {
  return Boolean(idea.due) && idea.st !== 'done' && idea.due < dayKey();
}

const REPEATS = {
  day: 'Каждый день',
  weekdays: 'По будням',
  week: 'Каждую неделю',
  month: 'Каждый месяц',
  year: 'Каждый год',
};

// Следующая дата повторяющегося плана — всегда после сегодняшнего дня,
// даже если план был просрочен на несколько повторов
function nextOccurrence(idea) {
  const today = dayKey();
  let next = stepRepeat(idea.due || today, idea.rep, idea.rd);
  while (next <= today) next = stepRepeat(next, idea.rep, idea.rd);
  return next;
}

// Активные планы со сроком, по порядку дат (просроченные первыми)
function datedIdeas() {
  return data.ideas
    .filter((i) => i.due && i.st !== 'done' && findSection(i.sec))
    .sort((a, b) => a.due.localeCompare(b.due) || a.at - b.at);
}

function saveSections() {
  return store.set('sections', JSON.stringify(data.sections));
}

function saveIdea(idea) {
  const json = JSON.stringify(idea);
  if (json.length > RECORD_MAX) {
    const err = new Error('record too big');
    err.userMessage = t('Слишком много текста в задаче');
    return Promise.reject(err);
  }
  return store.set('i_' + idea.id, json);
}

// Чеклист: сколько отмечено и всего
function itemsProgress(idea) {
  const items = idea.items || [];
  return { done: items.filter((i) => i.d).length, total: items.length };
}

async function deleteIdeaData(id) {
  await store.remove('i_' + id);
  data.ideas = data.ideas.filter((i) => i.id !== id);
}

function confirmDeleteIdea(id) {
  return confirmDialog(t('Удалить задачу «{0}»?', shorten(findIdea(id).title, 40)));
}

// Удаляет раздел вместе с его планами: сначала планы, потом сам раздел
async function deleteSectionData(id) {
  for (const idea of data.ideas.filter((i) => i.sec === id)) await store.remove('i_' + idea.id);
  data.ideas = data.ideas.filter((i) => i.sec !== id);
  data.sections = data.sections.filter((s) => s.id !== id);
  await saveSections();
}

function confirmDeleteSection(id) {
  const s = findSection(id);
  const count = data.ideas.filter((i) => i.sec === id).length;
  const extra = count ? `\n${t('Вместе с ним удалятся задачи: {0}.', count)}` : '';
  return confirmDialog(`${t('Удалить раздел «{0}»?', s.name)}${extra}`);
}

deleters.idea = { confirm: confirmDeleteIdea, remove: deleteIdeaData };
deleters.section = { confirm: confirmDeleteSection, remove: deleteSectionData };
// Пункт чеклиста удаляется сразу, без вопроса. id — «план:пункт»
deleters.item = {
  confirm: async () => true,
  remove: (key) => {
    const [ideaId, itemId] = key.split(':');
    const idea = findIdea(ideaId);
    idea.items = idea.items.filter((i) => i.id !== itemId);
    return saveIdea(idea);
  },
};

// ---------- Отображение ----------

// Статусы: значок и название
const STATUS = {
  new: { icon: '⚪', label: 'Not started' },
  wip: { icon: '◐', label: 'In progress' },
  done: { icon: '⚫', label: 'Done' },
};

// Сегменты переключателя статуса в карточке
const STATUS_ITEMS = Object.entries(STATUS).map(([key, s]) => (
  { key, html: `<span class="ic">${s.icon}</span>${s.label}` }
));

// Фильтры в разделе
const FILTERS = [
  { key: 'all', html: 'Все' },
  { key: 'new', html: 'Not started' },
  { key: 'wip', html: 'In progress' },
  { key: 'done', html: 'Done' },
];

// Список планов раздела: текущий фильтр и страница берутся из route
function ideaListHtml(route) {
  const filter = route.filter || 'all';
  const all = filteredIdeas(route.id, filter);
  if (!all.length) {
    return `<div class="page-items"><p class="empty small">${t(filter === 'all' ? 'Задач пока нет' : 'Здесь пусто')}</p></div>`;
  }
  const p = paginate(all, route);
  const rows = p.items.map((idea, n) => `
    <div class="swipe${takeFlash(idea.id) ? ' appear' : ''}" style="--i:${n}">
      <button class="swipe-del" data-act="swipe-delete" data-kind="idea" data-id="${idea.id}">${t('Удалить')}</button>
      <button class="row" data-act="open-idea" data-id="${idea.id}">
        <span class="st">${STATUS[idea.st].icon}</span>
        <span class="title">${esc(idea.title)}</span>
        ${itemsMeta(idea)}
        ${dueMeta(idea)}
        ${CHEVRON}
      </button>
    </div>`).join('');
  return `<div class="page-items"><div class="group">${rows}</div></div>${pagerHtml(p)}`;
}

// Прогресс чеклиста справа в строке: «2/5»
function itemsMeta(idea) {
  const { done, total } = itemsProgress(idea);
  return total ? `<span class="meta small">${done}/${total}</span>` : '';
}

// Заголовок чеклиста: «Чеклист · 2 из 5» и полоска прогресса
function checklistHead(idea) {
  const { done, total } = itemsProgress(idea);
  if (!total) return `<p class="group-head">${t('Чеклист')}</p>`;
  return `
    <p class="group-head with-bar">
      <span class="ch-label">${t('Чеклист · {0} из {1}', done, total)}</span>
      <span class="bar"><span style="width:${(done / total) * 100}%"></span></span>
    </p>`;
}

// Чеклист в карточке: пункты (нажатие — отметить, свайп — удалить) и «Добавить пункт»
function checklistHtml(idea) {
  const rows = (idea.items || []).map((it, n) => `
    <div class="swipe${takeFlash(it.id) ? ' appear' : ''}" style="--i:${n}">
      <button class="swipe-del" data-act="swipe-delete" data-kind="item" data-id="${idea.id}:${it.id}">${t('Удалить')}</button>
      <button class="row check-row${it.d ? ' checked' : ''}" data-act="toggle-item" data-id="${idea.id}" data-item="${it.id}">
        ${CHECK}
        <span class="title wrap">${esc(it.t)}</span>
      </button>
    </div>`).join('');
  return `
    <div class="checklist">
      ${checklistHead(idea)}
      <div class="group">
        ${rows}
        <button class="row add-row" data-act="add-items" data-id="${idea.id}">
          <span class="plus">+</span>
          <span class="title">${t('Добавить пункт')}</span>
        </button>
      </div>
    </div>`;
}

// Срок справа в строке: «Завтра», «5 нояб.»; просроченный — красным
function dueMeta(idea) {
  if (!idea.due || idea.st === 'done') return '';
  return `<span class="meta small${isOverdue(idea) ? ' late' : ''}">${idea.rep ? '↻ ' : ''}${dayLabel(idea.due)}</span>`;
}

// «Выполненные»: все Done по порядку разделов, на странице группируются по разделам
function archiveListHtml(route) {
  const list = data.sections.flatMap((s) => filteredIdeas(s.id, 'done'));
  if (!list.length) return `<p class="empty">${t('Здесь появятся задачи со статусом ⚫ Done')}</p>`;
  return groupedPage(list, route, (idea) => {
    const s = findSection(idea.sec);
    return { key: s.id, label: `${esc(s.name)} · ${filteredIdeas(s.id, 'done').length}` };
  }, doneRowHtml);
}

// Строка плана со сроком: статус, заголовок, под ним раздел; withDue — показывать дату справа
function agendaRowHtml(idea, withDue) {
  const section = findSection(idea.sec);
  return `
    <button class="row" data-act="open-idea" data-id="${idea.id}">
      <span class="st">${STATUS[idea.st].icon}</span>
      <span class="title-wrap">
        <span class="title">${esc(idea.title)}</span>
        <span class="subtitle">${section ? esc(section.name) : ''}</span>
      </span>
      ${withDue ? dueMeta(idea) : (idea.rep ? '<span class="meta small">↻</span>' : '')}
      ${CHEVRON}
    </button>`;
}

// «Все сроки»: группы «Просрочено», «Сегодня», «Завтра», «Пятница, 7 ноября»…
function agendaListHtml(route) {
  const list = datedIdeas();
  if (!list.length) return `<p class="empty">${t('Задай срок в карточке задачи — она появится здесь')}</p>`;
  const today = dayKey();
  return groupedPage(list, route, (idea) => (idea.due < today
    ? { key: 'late', label: t('Просрочено') }
    : { key: idea.due, label: dayLabelLong(idea.due) }
  ), (idea) => agendaRowHtml(idea, idea.due < today));
}

// Блок «Сегодня» на главном экране: просроченные и сегодняшние планы.
// Если сроков нет ни у одного плана — блока нет
function todayBlockHtml() {
  const dated = datedIdeas();
  if (!dated.length) return '';
  const today = dayKey();
  const now = dated.filter((i) => i.due <= today);
  const rows = now.map((idea) => agendaRowHtml(idea, idea.due < today)).join('');
  return `
    <p class="group-head">${t('Сегодня')} · ${formatDate(Date.now())}</p>
    <div class="group">
      ${rows || `<div class="row static"><span class="title muted">${t('На сегодня ничего')}</span></div>`}
      <button class="row" data-act="open-agenda">
        <span class="title">${t('Все сроки')}</span>
        <span class="meta">${dated.length}</span>
        ${CHEVRON}
      </button>
    </div>`;
}

// ---------- Поиск ----------

// Планы, где запрос есть в заголовке, описании или пунктах чеклиста.
// Сначала активные, потом выполненные; внутри — новые сверху
function searchIdeas(query) {
  const q = norm(query);
  const has = (text) => norm(text || '').includes(q);
  return data.ideas
    .filter((i) => findSection(i.sec) && (has(i.title) || has(i.text) || (i.items || []).some((it) => has(it.t))))
    .sort((a, b) => (a.st === 'done') - (b.st === 'done') || b.at - a.at);
}

// Строка результата: найденное выделено; под заголовком раздел и кусочек текста с совпадением
function searchRowHtml(idea, query) {
  const section = findSection(idea.sec);
  let found = '';
  if (!norm(idea.title).includes(norm(query))) {
    const item = (idea.items || []).find((it) => norm(it.t).includes(norm(query)));
    found = snippet(idea.text || '', query) || (item ? `☐ ${highlight(item.t, query)}` : '');
  }
  return `
    <button class="row" data-act="open-idea" data-id="${idea.id}">
      <span class="st">${STATUS[idea.st].icon}</span>
      <span class="title-wrap">
        <span class="title">${highlight(idea.title, query)}</span>
        <span class="subtitle">${esc(section.name)}${found ? ' · ' + found : ''}</span>
      </span>
      ${CHEVRON}
    </button>`;
}

function searchListHtml(route) {
  const query = (route.q || '').trim();
  if (!query) return '';
  const list = searchIdeas(query);
  if (!list.length) return `<p class="empty small">${t('Ничего не найдено')}</p>`;
  const p = paginate(list, route);
  const rows = p.items.map((idea) => searchRowHtml(idea, query)).join('');
  return `
    <p class="group-head">${t('Найдено')} · ${list.length}</p>
    <div class="page-items"><div class="group">${rows}</div></div>${pagerHtml(p)}`;
}

searchHandlers.main = (route, query, inner) => {
  const results = inner.querySelector('.search-results');
  if (query) results.innerHTML = searchListHtml(route);
  showSearchState(inner, Boolean(query));
};

pagers.main = searchListHtml;
pagers.section = ideaListHtml;
pagers.archive = archiveListHtml;
pagers.agenda = agendaListHtml;

// Строка выполненного плана в «Выполненных»: ⚫, заголовок, дата выполнения
function doneRowHtml(idea, n) {
  return `
    <div class="swipe" style="--i:${n}">
      <button class="swipe-del" data-act="swipe-delete" data-kind="idea" data-id="${idea.id}">${t('Удалить')}</button>
      <button class="row" data-act="open-idea" data-id="${idea.id}">
        <span class="st">${STATUS.done.icon}</span>
        <span class="title">${esc(idea.title)}</span>
        <span class="meta small">${idea.dt ? formatShort(idea.dt) : ''}</span>
        ${CHEVRON}
      </button>
    </div>`;
}

function dateLine(idea) {
  const done = idea.st === 'done' && idea.dt ? ` · ${t('выполнена {0}', formatDate(idea.dt))}` : '';
  const times = idea.cnt ? ` · ${t('сделано {0}', plural(idea.cnt, ['раз', 'раза', 'раз']))}` : '';
  return `${t('Создана {0}', formatDate(idea.at))}${done}${times}`;
}

// Повторяющийся план «выполнен»: таблетка доезжает до Done, план переезжает на следующую дату,
// чеклист сбрасывается, затем таблетка плавно возвращается на Not started
async function completeRecurring(idea, seg) {
  moveSeg(seg, 'done');
  const next = nextOccurrence(idea);
  const ok = await commit(() => {
    idea.st = 'new';
    idea.dt = null;
    idea.due = next;
    idea.cnt = (idea.cnt || 0) + 1;
    (idea.items || []).forEach((i) => { i.d = false; });
    return saveIdea(idea);
  }, () => {});
  if (!ok) {
    refresh();
    return;
  }
  toast(t('Готово! Следующий раз — {0}', dayLabel(next).toLowerCase()));
  await wait(650);
  const route = currentRoute();
  if (route.name !== 'idea' || route.id !== idea.id) return; // уже ушли с карточки
  moveSeg(seg, 'new');
  await wait(520);
  flash = 'due:' + idea.id;
  refresh();
}

// ---------- Экраны ----------

views.main = (route) => {
  const rows = data.sections.map((s, n) => `
    <div class="swipe${takeFlash(s.id) ? ' appear' : ''}" style="--i:${n}">
      <button class="swipe-del" data-act="swipe-delete" data-kind="section" data-id="${s.id}">${t('Удалить')}</button>
      <button class="row" data-act="open-section" data-id="${s.id}">
        <span class="title">${esc(s.name)}</span>
        <span class="meta">${activeCount(s.id)}</span>
        ${CHEVRON}
      </button>
    </div>`).join('');

  const today = todayBlockHtml();
  // Если есть блок «Сегодня», у разделов тоже свой заголовок — чтобы было понятно, где что
  const sections = rows
    ? `${today ? `<p class="group-head">${t('Разделы')}</p>` : ''}<div class="group">${rows}</div>`
    : '';

  // Пока в поиске есть текст — вместо обычного содержимого результаты
  const searching = Boolean((route.q || '').trim());

  return `
    <h1>${t('Мои задачи')}</h1>
    <p class="sub">${t(data.sections.length ? 'Выбери раздел' : 'Разделов пока нет')}</p>
    ${data.ideas.length ? searchHtml(route.q, t('Поиск по задачам')) : ''}
    <div class="search-results paged${searching ? '' : ' hidden'}">${searching ? searchListHtml(route) : ''}</div>
    <div class="search-body${searching ? ' hidden' : ''}">
      ${today}
      ${sections}
      <div class="actions">
        <button class="btn primary" data-act="new-section">➕ ${t('Новый раздел')}</button>
        <button class="btn" data-act="open-archive">🗄 ${t('Выполненные')}</button>
      </div>
    </div>`;
};

views.section = (route) => {
  const s = findSection(route.id);
  if (!s) return `<p class="empty">${t('Раздел не найден')}</p>`;

  const filter = route.filter || 'all';
  const active = filteredIdeas(s.id, 'all').length;

  return `
    <h1${takeFlash(s.id) ? ' class="swap"' : ''}>${esc(s.name)}</h1>
    <p class="sub">${active ? t('{0} в работе', plural(active, ['задача', 'задачи', 'задач'])) : t('Активных задач нет')}</p>
    <div class="actions">
      <button class="btn primary" data-act="add-idea" data-id="${s.id}">➕ ${t('Новая задача')}</button>
    </div>
    ${segHtml(FILTERS.map((f) => ({ ...f, html: t(f.html) })), filter, 'set-filter')}
    <div class="paged">${ideaListHtml(route)}</div>
    <div class="group">
      <button class="row" data-act="rename-section" data-id="${s.id}">${t('Переименовать')}</button>
      <button class="row danger" data-act="delete-section" data-id="${s.id}">${t('Удалить раздел')}</button>
    </div>`;
};

views.idea = (route) => {
  const idea = findIdea(route.id);
  if (!idea) return `<p class="empty">${t('Задача не найдена')}</p>`;
  const section = findSection(idea.sec);

  // Заголовок и описание правятся прямо здесь — нажал и пишешь
  return `
    <h1>${editHtml('idea-title', idea.id, idea.title, { placeholder: t('Заголовок'), max: TITLE_MAX })}</h1>
    <p class="sub">${section ? esc(section.name) : ''}</p>
    ${segHtml(STATUS_ITEMS, idea.st, 'set-status', ` data-id="${idea.id}"`, 'big')}
    <div class="card">
      ${editHtml('idea-text', idea.id, idea.text, {
        placeholder: t('Добавить описание…'), max: IDEA_MAX, multiline: true, cls: 'idea-text',
      })}
      <p class="date">${dateLine(idea)}</p>
    </div>
    <div class="actions restore${idea.st === 'done' ? '' : ' hidden'}">
      <button class="btn primary" data-act="restore-idea" data-id="${idea.id}">↺ ${t('Вернуть в работу')}</button>
    </div>
    ${checklistHtml(idea)}
    <div class="group">
      <button class="row" data-act="set-due" data-id="${idea.id}">
        <span class="title">${t('Срок')}</span>
        <span class="meta${isOverdue(idea) ? ' late' : ''}${takeFlash('due:' + idea.id) ? ' swap' : ''}">${idea.due ? dayLabel(idea.due) : t('Не задан')}</span>
        ${CHEVRON}
      </button>
      <button class="row" data-act="set-repeat" data-id="${idea.id}">
        <span class="title">${t('Повтор')}</span>
        <span class="meta${takeFlash('rep:' + idea.id) ? ' swap' : ''}">${t(idea.rep ? REPEATS[idea.rep] : 'Нет')}</span>
        ${CHEVRON}
      </button>
    </div>
    <div class="group">
      <button class="row danger" data-act="delete-idea" data-id="${idea.id}">${t('Удалить задачу')}</button>
    </div>`;
};

// Правка заголовка и описания плана на месте (см. editHtml в ui.js)
editors['idea-title'] = {
  required: true,
  get: (id) => findIdea(id).title,
  save: (id, value) => {
    const idea = findIdea(id);
    idea.title = value;
    return saveIdea(idea);
  },
};
editors['idea-text'] = {
  get: (id) => findIdea(id).text || '',
  save: (id, value) => {
    const idea = findIdea(id);
    idea.text = value;
    return saveIdea(idea);
  },
};

// «Выполненные»: все Done, сгруппированные по разделам (в порядке разделов), свежие сверху
views.archive = (route) => {
  const total = data.ideas.filter((i) => i.st === 'done').length;
  return `
    <h1>${t('Выполненные')}</h1>
    <p class="sub">${total ? plural(total, ['задача', 'задачи', 'задач']) : t('Пока ничего не выполнено')}</p>
    <div class="paged">${archiveListHtml(route)}</div>`;
};

// «Все сроки»: активные планы с датой, сгруппированные по дням
views.agenda = (route) => {
  const n = datedIdeas().length;
  return `
    <h1>${t('Сроки')}</h1>
    <p class="sub">${n ? t('{0} с датой', plural(n, ['задача', 'задачи', 'задач'])) : t('Нет задач со сроком')}</p>
    <div class="paged">${agendaListHtml(route)}</div>`;
};

// ---------- Действия ----------

// Поля окна для плана: заголовок и необязательное описание
function ideaFields(idea = { title: '', text: '' }) {
  return [
    { value: idea.title, placeholder: t('Заголовок'), max: TITLE_MAX },
    { value: idea.text, placeholder: t('Описание — необязательно'), max: IDEA_MAX, multiline: true, optional: true },
  ];
}

// Новый раздел: спросить название, сохранить, вернуть его id (или null при отмене)
async function createSection() {
  const res = await ask({ title: t('Новый раздел'), fields: [{ placeholder: t('Название'), max: SECTION_MAX }] });
  if (!res) return null;
  const [name] = res;
  const id = newId();
  flash = id;
  const ok = await commit(() => {
    data.sections.push({ id, name });
    return saveSections();
  });
  return ok ? id : null;
}

// Выбор раздела в меню снизу; внизу — «Новый раздел…». Разделов нет — сразу создаём первый
async function pickSection(title) {
  if (!data.sections.length) return createSection();
  const options = data.sections.map((s) => ({ key: s.id, label: s.name }));
  options.push({ key: '__new', label: `＋ ${t('Новый раздел')}…` });
  const picked = await choose({ title, options });
  if (picked === '__new') return createSection();
  return picked;
}

// Новый план (Not started) в разделе. Возвращает true, если сохранился
function createIdea(sec, title, text) {
  const idea = { id: newId(), sec, title, text, st: 'new', at: Date.now() };
  flash = idea.id;
  return commit(() => {
    data.ideas.push(idea);
    return saveIdea(idea);
  });
}

Object.assign(actions, {
  'open-section': ({ id }) => go({ name: 'section', id }),

  'new-section': () => createSection(),

  'rename-section': async ({ id }) => {
    const s = findSection(id);
    const res = await ask({ title: t('Переименовать раздел'), fields: [{ value: s.name, max: SECTION_MAX }] });
    if (!res || res[0] === s.name) return;
    const [name] = res;
    flash = id;
    await commit(() => {
      s.name = name;
      return saveSections();
    });
  },

  // Удаление с экрана раздела
  'delete-section': async ({ id }) => {
    if (!(await confirmDeleteSection(id))) return;
    await commit(() => deleteSectionData(id), back); // потом возвращаемся на главный экран
  },

  'add-idea': async ({ id }) => {
    const res = await ask({ title: t('Новая задача'), fields: ideaFields() });
    if (!res) return;
    const [title, text] = res;
    // Новый план — Not started, он первый в списке. Если открыт фильтр, где его не видно,
    // переключаемся на «Все»; в любом случае — на первую страницу
    const route = currentRoute();
    if (route.filter === 'wip' || route.filter === 'done') route.filter = 'all';
    route.page = 0;
    await createIdea(id, title, text);
  },

  // С главной: сначала текст, потом раздел
  'quick-idea': async () => {
    const res = await ask({ title: t('Новая задача'), fields: ideaFields() });
    if (!res) return;
    const sec = await pickSection(t('Раздел'));
    if (!sec) {
      toast(t('Задача не сохранена — не выбран раздел'));
      return;
    }
    if (await createIdea(sec, res[0], res[1])) toast(t('Задача в разделе «{0}»', shorten(findSection(sec).name, 24)));
  },

  'open-idea': ({ id }) => go({ name: 'idea', id }),

  // Фильтр в разделе: таблетка переезжает, список мягко обновляется
  // Новый список въезжает с той стороны, куда переключили (вправо по фильтрам — справа)
  'set-filter': ({ key }, el) => {
    const route = currentRoute();
    const old = route.filter || 'all';
    if (old === key) return;
    const order = FILTERS.map((f) => f.key);
    route.filter = key;
    route.page = 0;
    closeSwipe(false);
    moveSeg(el.closest('.seg'), key);
    softHaptic();
    const box = el.closest('.screen-inner').querySelector('.paged');
    afterSegMove(() => swapContent(box, ideaListHtml(route), order.indexOf(key) > order.indexOf(old) ? 'page-next' : 'page-prev'));
  },

  // Статус в карточке: сохраняем сразу, экран не перерисовываем, чтобы таблетка плавно переехала
  'set-status': async ({ id, key }, el) => {
    const idea = findIdea(id);
    if (!idea || idea.st === key) return;
    if (key === 'done' && idea.rep) {
      await completeRecurring(idea, el.closest('.seg'));
      return;
    }
    const inner = el.closest('.screen-inner');
    moveSeg(el.closest('.seg'), key);
    const ok = await commit(() => {
      idea.st = key;
      idea.dt = key === 'done' ? Date.now() : null;
      return saveIdea(idea);
    }, () => {});
    if (!ok) {
      refresh();
      return;
    }
    setText(inner.querySelector('.date'), dateLine(idea));
    // «Вернуть в работу» — только у выполненных. Раскрывается чуть позже, когда таблетка уже доехала
    const restore = inner.querySelector('.restore');
    if (key === 'done') {
      revealBlock(restore, true, 220);
      successHaptic();
      toast(t('Перенесено в «Выполненные»'));
    } else {
      revealBlock(restore, false);
    }
  },

  // Вернуть выполненный план в работу (◐) и уйти назад — в «Выполненные» или в раздел
  'restore-idea': async ({ id }) => {
    const idea = findIdea(id);
    const ok = await commit(() => {
      idea.st = 'wip';
      idea.dt = null;
      return saveIdea(idea);
    }, back);
    if (ok) toast(t('Возвращено в работу'));
  },

  'delete-idea': async ({ id }) => {
    if (!(await confirmDeleteIdea(id))) return;
    await commit(() => deleteIdeaData(id), back); // потом возвращаемся в раздел
  },

  'open-archive': () => go({ name: 'archive' }),

  'open-agenda': () => go({ name: 'agenda' }),

  // Добавить пункты чеклиста: каждая строка — отдельный пункт
  'add-items': async ({ id }) => {
    const idea = findIdea(id);
    const res = await ask({
      title: t('Новые пункты'),
      fields: [{ placeholder: t('Каждая строка — отдельный пункт'), max: 2000, multiline: true }],
    });
    if (!res) return;
    const items = res[0].split('\n')
      .map((line) => line.trim().slice(0, ITEM_MAX))
      .filter(Boolean)
      .map((t) => ({ id: newId() + Math.random().toString(36).slice(2, 4), t, d: false }));
    if (!items.length) return;
    flash = new Set(items.map((i) => i.id));
    await commit(() => {
      idea.items = [...(idea.items || []), ...items];
      return saveIdea(idea);
    });
  },

  // Отметить пункт: кружок заливается на месте, заголовок и полоска обновляются без перерисовки
  'toggle-item': async ({ id, item }, el) => {
    const idea = findIdea(id);
    const it = idea.items.find((i) => i.id === item);
    it.d = !it.d;
    el.classList.add('just');
    el.classList.toggle('checked', it.d);
    const box = el.closest('.checklist');
    const { done, total } = itemsProgress(idea);
    setText(box.querySelector('.ch-label'), t('Чеклист · {0} из {1}', done, total));
    box.querySelector('.bar span').style.width = `${(done / total) * 100}%`;
    const ok = await commit(() => saveIdea(idea), () => {});
    if (!ok) {
      refresh();
      return;
    }
    if (it.d && done === total && idea.st !== 'done') toast(t('Все пункты готовы — можно отметить ⚫ Done'));
  },

  // Срок: быстрые варианты, календарь или «Убрать срок»
  'set-due': async ({ id }) => {
    const idea = findIdea(id);
    const today = dayKey();
    const options = [
      { key: today, label: t('Сегодня') },
      { key: addDays(today, 1), label: t('Завтра') },
      { key: addDays(today, 7), label: t('Через неделю') },
      { label: t('Выбрать дату…'), date: idea.due || today },
    ];
    if (idea.due) options.push({ key: 'none', label: t('Убрать срок'), danger: true });
    const picked = await choose({ title: t('Срок'), options });
    if (!picked) return;
    const due = picked === 'none' ? null : picked;
    if (due === (idea.due || null)) return;
    flash = 'due:' + id;
    // Повтор без срока не работает — убирая срок, выключаем и повтор
    const stopRepeat = !due && idea.rep;
    await commit(() => {
      idea.due = due;
      if (stopRepeat) idea.rep = null;
      if (due && idea.rep) idea.rd = keyToDate(due).getDate();
      return saveIdea(idea);
    });
    if (stopRepeat) toast(t('Повтор выключен'));
  },

  // Повтор: каждый день / по будням / неделю / месяц / год
  'set-repeat': async ({ id }) => {
    const idea = findIdea(id);
    const options = [
      { key: 'none', label: t('Не повторять'), checked: !idea.rep },
      ...Object.entries(REPEATS).map(([key, label]) => ({ key, label: t(label), checked: idea.rep === key })),
    ];
    const picked = await choose({ title: t('Повтор'), options });
    if (!picked) return;
    const rep = picked === 'none' ? null : picked;
    if (rep === (idea.rep || null)) return;
    flash = rep && !idea.due ? new Set(['rep:' + id, 'due:' + id]) : 'rep:' + id;
    const needDue = Boolean(rep && !idea.due); // у повтора должен быть срок — ставим «сегодня»
    await commit(() => {
      idea.rep = rep;
      if (needDue) idea.due = dayKey();
      if (rep) idea.rd = keyToDate(idea.due).getDate();
      return saveIdea(idea);
    });
    if (needDue) toast(t('Срок — сегодня'));
  },
});
