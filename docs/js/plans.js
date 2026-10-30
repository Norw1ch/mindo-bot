'use strict';

// Модуль «Планы»: разделы, планы, статусы, фильтры, «Выполненные».
// В коде и хранилище планы называются ideas — так было с первой версии, менять нельзя,
// иначе пропадут сохранённые данные

// ---------- Данные ----------
// sections: [{id, name}] — в ключе "sections"
// ideas: {id, sec, title, text, st, at, dt} — каждый план в своём ключе "i_<id>"
//   st — статус (new / wip / done), at — когда создан, dt — когда выполнен

const data = { sections: [], ideas: [] };

const SECTION_MAX = 50;
const TITLE_MAX = 80;
const IDEA_MAX = 3000; // в облаке Telegram на одну запись — до 4096 символов

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

function saveSections() {
  return store.set('sections', JSON.stringify(data.sections));
}

function saveIdea(idea) {
  return store.set('i_' + idea.id, JSON.stringify(idea));
}

async function deleteIdeaData(id) {
  await store.remove('i_' + id);
  data.ideas = data.ideas.filter((i) => i.id !== id);
}

function confirmDeleteIdea(id) {
  return confirmDialog(`Удалить план «${shorten(findIdea(id).title, 40)}»?`);
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
  const extra = count ? `\nВместе с ним удалятся планы: ${count}.` : '';
  return confirmDialog(`Удалить раздел «${s.name}»?${extra}`);
}

deleters.idea = { confirm: confirmDeleteIdea, remove: deleteIdeaData };
deleters.section = { confirm: confirmDeleteSection, remove: deleteSectionData };

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
    return `<p class="empty small">${filter === 'all' ? 'Планов пока нет' : 'Здесь пусто'}</p>`;
  }
  const p = paginate(all, route);
  const rows = p.items.map((idea, n) => `
    <div class="swipe${takeFlash(idea.id) ? ' appear' : ''}" style="--i:${n}">
      <button class="swipe-del" data-act="swipe-delete" data-kind="idea" data-id="${idea.id}">Удалить</button>
      <button class="row" data-act="open-idea" data-id="${idea.id}">
        <span class="st">${STATUS[idea.st].icon}</span>
        <span class="title">${esc(idea.title)}</span>
        ${CHEVRON}
      </button>
    </div>`).join('');
  return `<div class="page-items"><div class="group">${rows}</div></div>${pagerHtml(p)}`;
}

// «Выполненные»: все Done по порядку разделов, на странице группируются по разделам
function archiveListHtml(route) {
  const list = data.sections.flatMap((s) => filteredIdeas(s.id, 'done'));
  if (!list.length) return '<p class="empty">Здесь появятся планы со статусом ⚫ Done</p>';
  const p = paginate(list, route);

  let html = '';
  let section = null;
  let rows = [];
  const flush = () => {
    if (!section) return;
    const total = filteredIdeas(section.id, 'done').length;
    html += `
      <p class="group-head">${esc(section.name)} · ${total}</p>
      <div class="group">${rows.join('')}</div>`;
  };
  p.items.forEach((idea, n) => {
    if (!section || section.id !== idea.sec) {
      flush();
      section = findSection(idea.sec);
      rows = [];
    }
    rows.push(doneRowHtml(idea, n));
  });
  flush();
  return `<div class="page-items">${html}</div>${pagerHtml(p)}`;
}

pagers.section = ideaListHtml;
pagers.archive = archiveListHtml;

// Строка выполненного плана в «Выполненных»: ⚫, заголовок, дата выполнения
function doneRowHtml(idea, n) {
  return `
    <div class="swipe" style="--i:${n}">
      <button class="swipe-del" data-act="swipe-delete" data-kind="idea" data-id="${idea.id}">Удалить</button>
      <button class="row" data-act="open-idea" data-id="${idea.id}">
        <span class="st">${STATUS.done.icon}</span>
        <span class="title">${esc(idea.title)}</span>
        <span class="meta small">${idea.dt ? formatShort(idea.dt) : ''}</span>
        ${CHEVRON}
      </button>
    </div>`;
}

function dateLine(idea) {
  const done = idea.st === 'done' && idea.dt ? ` · выполнен ${formatDate(idea.dt)}` : '';
  return `Создан ${formatDate(idea.at)}${done}`;
}

// ---------- Экраны ----------

views.main = () => {
  const rows = data.sections.map((s, n) => `
    <div class="swipe${takeFlash(s.id) ? ' appear' : ''}" style="--i:${n}">
      <button class="swipe-del" data-act="swipe-delete" data-kind="section" data-id="${s.id}">Удалить</button>
      <button class="row" data-act="open-section" data-id="${s.id}">
        <span class="title">${esc(s.name)}</span>
        <span class="meta">${activeCount(s.id)}</span>
        ${CHEVRON}
      </button>
    </div>`).join('');

  return `
    <h1>Мои планы</h1>
    <p class="sub">${data.sections.length ? 'Выбери раздел' : 'Разделов пока нет'}</p>
    ${rows ? `<div class="group">${rows}</div>` : ''}
    <div class="actions">
      <button class="btn primary" data-act="new-section">➕ Новый раздел</button>
      <button class="btn" data-act="open-archive">🗄 Выполненные</button>
    </div>`;
};

views.section = (route) => {
  const s = findSection(route.id);
  if (!s) return '<p class="empty">Раздел не найден</p>';

  const filter = route.filter || 'all';
  const active = filteredIdeas(s.id, 'all').length;

  return `
    <h1${takeFlash(s.id) ? ' class="swap"' : ''}>${esc(s.name)}</h1>
    <p class="sub">${active ? plural(active, ['план', 'плана', 'планов']) + ' в работе' : 'Активных планов нет'}</p>
    <div class="actions">
      <button class="btn primary" data-act="add-idea" data-id="${s.id}">➕ Новый план</button>
    </div>
    ${segHtml(FILTERS, filter, 'set-filter')}
    <div class="paged">${ideaListHtml(route)}</div>
    <div class="group">
      <button class="row" data-act="rename-section" data-id="${s.id}">Переименовать</button>
      <button class="row danger" data-act="delete-section" data-id="${s.id}">Удалить раздел</button>
    </div>`;
};

views.idea = (route) => {
  const idea = findIdea(route.id);
  if (!idea) return '<p class="empty">План не найден</p>';
  const section = findSection(idea.sec);
  const swap = takeFlash(idea.id) ? ' swap' : '';
  const text = idea.text
    ? `<p class="idea-text">${esc(idea.text)}</p>`
    : '<p class="idea-text none">Без описания</p>';

  return `
    <h1 class="${swap}">${esc(idea.title)}</h1>
    <p class="sub">${section ? esc(section.name) : ''}</p>
    ${segHtml(STATUS_ITEMS, idea.st, 'set-status', ` data-id="${idea.id}"`, 'big')}
    <div class="card${swap}">
      ${text}
      <p class="date">${dateLine(idea)}</p>
    </div>
    <div class="actions restore${idea.st === 'done' ? '' : ' hidden'}">
      <button class="btn primary" data-act="restore-idea" data-id="${idea.id}">↺ Вернуть в работу</button>
    </div>
    <div class="group">
      <button class="row" data-act="edit-idea" data-id="${idea.id}">Изменить</button>
      <button class="row danger" data-act="delete-idea" data-id="${idea.id}">Удалить план</button>
    </div>`;
};

// «Выполненные»: все Done, сгруппированные по разделам (в порядке разделов), свежие сверху
views.archive = (route) => {
  const total = data.ideas.filter((i) => i.st === 'done').length;
  return `
    <h1>Выполненные</h1>
    <p class="sub">${total ? plural(total, ['план', 'плана', 'планов']) : 'Пока ничего не выполнено'}</p>
    <div class="paged">${archiveListHtml(route)}</div>`;
};

// ---------- Действия ----------

// Поля окна для плана: заголовок и необязательное описание
function ideaFields(idea = { title: '', text: '' }) {
  return [
    { value: idea.title, placeholder: 'Заголовок', max: TITLE_MAX },
    { value: idea.text, placeholder: 'Описание — необязательно', max: IDEA_MAX, multiline: true, optional: true },
  ];
}

Object.assign(actions, {
  'open-section': ({ id }) => go({ name: 'section', id }),

  'new-section': async () => {
    const res = await ask({ title: 'Новый раздел', fields: [{ placeholder: 'Название', max: SECTION_MAX }] });
    if (!res) return;
    const [name] = res;
    const id = newId();
    flash = id;
    await commit(() => {
      data.sections.push({ id, name });
      return saveSections();
    });
  },

  'rename-section': async ({ id }) => {
    const s = findSection(id);
    const res = await ask({ title: 'Переименовать раздел', fields: [{ value: s.name, max: SECTION_MAX }] });
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
    const res = await ask({ title: 'Новый план', fields: ideaFields() });
    if (!res) return;
    const [title, text] = res;
    const idea = { id: newId(), sec: id, title, text, st: 'new', at: Date.now() };
    flash = idea.id;
    // Новый план — Not started, он первый в списке. Если открыт фильтр, где его не видно,
    // переключаемся на «Все»; в любом случае — на первую страницу
    const route = currentRoute();
    if (route.filter === 'wip' || route.filter === 'done') route.filter = 'all';
    route.page = 0;
    await commit(() => {
      data.ideas.push(idea);
      return saveIdea(idea);
    });
  },

  'open-idea': ({ id }) => go({ name: 'idea', id }),

  // Фильтр в разделе: таблетка переезжает, список мягко обновляется
  'set-filter': ({ key }, el) => {
    const route = currentRoute();
    if ((route.filter || 'all') === key) return;
    route.filter = key;
    route.page = 0;
    closeSwipe(false);
    moveSeg(el.closest('.seg'), key);
    const box = el.closest('.screen-inner').querySelector('.paged');
    swapContent(box, ideaListHtml(route), 'list-swap');
  },

  // Статус в карточке: сохраняем сразу, экран не перерисовываем, чтобы таблетка плавно переехала
  'set-status': async ({ id, key }, el) => {
    const idea = findIdea(id);
    if (!idea || idea.st === key) return;
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
    inner.querySelector('.date').innerHTML = dateLine(idea);
    // Кнопка «Вернуть в работу» видна только у выполненных
    inner.querySelector('.restore').classList.toggle('hidden', key !== 'done');
    if (key === 'done') toast('Перенесено в «Выполненные»');
  },

  // Вернуть выполненный план в работу (◐) и уйти назад — в «Выполненные» или в раздел
  'restore-idea': async ({ id }) => {
    const idea = findIdea(id);
    const ok = await commit(() => {
      idea.st = 'wip';
      idea.dt = null;
      return saveIdea(idea);
    }, back);
    if (ok) toast('Возвращено в работу');
  },

  'edit-idea': async ({ id }) => {
    const idea = findIdea(id);
    const res = await ask({ title: 'Изменить план', fields: ideaFields(idea) });
    if (!res) return;
    const [title, text] = res;
    if (title === idea.title && text === idea.text) return;
    flash = id;
    await commit(() => {
      idea.title = title;
      idea.text = text;
      return saveIdea(idea);
    });
  },

  'delete-idea': async ({ id }) => {
    if (!(await confirmDeleteIdea(id))) return;
    await commit(() => deleteIdeaData(id), back); // потом возвращаемся в раздел
  },

  'open-archive': () => go({ name: 'archive' }),
});
