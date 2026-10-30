'use strict';

// ---------- Telegram ----------

const tg = window.Telegram ? window.Telegram.WebApp : null;
const inTelegram = Boolean(tg && tg.initData);

if (inTelegram) {
  tg.ready();
  tg.expand();
  // Чтобы прокрутка списка вниз не сворачивала приложение
  if (tg.isVersionAtLeast('7.7')) tg.disableVerticalSwipes();
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
// ideas: {id, sec, title, text, st, at, dt} — каждая идея в своём ключе "i_<id>"
//   st — статус (new / wip / done), at — когда создана, dt — когда выполнена

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
    .filter(Boolean)
    .map(normalizeIdea);
}

// Старые идеи без заголовка: первая строка текста становится заголовком, остальное — описанием
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

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function findIdea(id) {
  return data.ideas.find((i) => i.id === id);
}

// Идеи раздела по фильтру: all — активные (не Done), иначе — с этим статусом.
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

// Удаляет раздел вместе с его идеями: сначала идеи, потом сам раздел
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

// Выполняет изменение и сохранение. При ошибке перечитывает данные, чтобы экран не врал.
// after — что сделать потом: по умолчанию обновить текущий экран. Возвращает true, если сохранилось
async function commit(change, after = refresh) {
  let ok = true;
  try {
    await change();
    haptic();
  } catch (err) {
    console.error(err);
    ok = false;
    toast('Не удалось сохранить');
    await loadData().catch(() => {});
  }
  await after();
  return ok;
}

// ---------- Навигация ----------
// stack — маршруты экранов, screens — их слои на странице (по одному на маршрут).
// Новый экран выезжает справа поверх текущего, «Назад» уводит его обратно вправо.

const app = document.getElementById('app');
const stack = [{ name: 'main' }];
const screens = [];
let busy = false; // идёт переход — нажатия игнорируем

const SLIDE_MS = 500;
const SLIDE_EASE = 'cubic-bezier(.32, .72, 0, 1)';
const UNDER_SHIFT = 'translateX(-28%)'; // насколько нижний экран уходит влево
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Запускает анимацию слоя; null — если анимации выключены
function motion(el, frames) {
  if (reduceMotion || !el.animate) return null;
  return el.animate(frames, { duration: SLIDE_MS, easing: SLIDE_EASE, fill: 'forwards' });
}

async function finishAll(anims) {
  const list = anims.filter(Boolean);
  await Promise.all(list.map((a) => a.finished));
  return list;
}

function makeShade() {
  const el = document.createElement('div');
  el.className = 'shade';
  return el;
}

async function go(route) {
  if (busy) return;
  busy = true;
  closeSwipe(false);
  stack.push(route);
  const under = screens[screens.length - 1];
  const top = makeScreen(stack.length - 1);
  const shade = makeShade();
  screens.push(top);
  app.append(shade, top);
  updateBackButton();

  const anims = await finishAll([
    motion(top, [{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }]),
    motion(under, [{ transform: 'translateX(0)' }, { transform: UNDER_SHIFT }]),
    motion(shade, [{ opacity: 0 }, { opacity: 1 }]),
  ]);
  under.classList.add('covered'); // нижний слой не виден — прячем (прокрутка сохраняется)
  shade.remove();
  anims.forEach((a) => a.cancel());
  busy = false;
}

async function back() {
  if (sheetResolve) {
    closeSheet(null);
    return;
  }
  if (busy || stack.length < 2) return;
  busy = true;
  stack.pop();
  const top = screens.pop();
  const under = screens[screens.length - 1];
  refreshScreen(under, stack.length - 1); // данные могли измениться, пока он был закрыт
  under.classList.remove('covered');
  const shade = makeShade();
  top.before(shade);
  updateBackButton();

  const anims = await finishAll([
    motion(top, [{ transform: 'translateX(0)' }, { transform: 'translateX(100%)' }]),
    motion(under, [{ transform: UNDER_SHIFT }, { transform: 'translateX(0)' }]),
    motion(shade, [{ opacity: 1 }, { opacity: 0 }]),
  ]);
  top.remove();
  shade.remove();
  anims.forEach((a) => a.cancel());
  busy = false;
}

// ---------- Экраны ----------

const views = {};

const CHEVRON = '<svg class="chev" width="8" height="13" viewBox="0 0 8 13" aria-hidden="true">'
  + '<path d="M1.5 1.5 6.5 6.5 1.5 11.5" fill="none" stroke="currentColor" stroke-width="2"'
  + ' stroke-linecap="round" stroke-linejoin="round"/></svg>';

// Что мягко подсветить при следующей отрисовке (новый раздел, новое имя)
let flash = null;

function takeFlash(id) {
  if (flash !== id) return false;
  flash = null;
  return true;
}

// Статусы идей: значок и название
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

// Переключатель в стиле iOS: «таблетка» под выбранным сегментом.
// extra — дополнительные атрибуты для кнопок (например, data-id)
function segHtml(items, activeKey, act, extra = '', cls = '') {
  const k = items.findIndex((i) => i.key === activeKey);
  const buttons = items.map((i) => `
    <button class="seg-btn${i.key === activeKey ? ' active' : ''}" data-act="${act}" data-key="${i.key}"${extra}>${i.html}</button>`).join('');
  return `<div class="seg ${cls}" style="--n:${items.length};--k:${k}"><span class="seg-pill"></span>${buttons}</div>`;
}

// Плавно переносит «таблетку» на другой сегмент, не перерисовывая экран
function moveSeg(seg, key) {
  const buttons = [...seg.querySelectorAll('.seg-btn')];
  seg.style.setProperty('--k', buttons.findIndex((b) => b.dataset.key === key));
  buttons.forEach((b) => b.classList.toggle('active', b.dataset.key === key));
}

function ideaListHtml(sectionId, filter) {
  const ideas = filteredIdeas(sectionId, filter);
  if (!ideas.length) {
    return `<p class="empty small">${filter === 'all' ? 'Планов пока нет' : 'Здесь пусто'}</p>`;
  }
  const rows = ideas.map((idea, n) => `
    <div class="swipe${takeFlash(idea.id) ? ' appear' : ''}" style="--i:${n}">
      <button class="swipe-del" data-act="swipe-delete" data-kind="idea" data-id="${idea.id}">Удалить</button>
      <button class="row" data-act="open-idea" data-id="${idea.id}">
        <span class="st">${STATUS[idea.st].icon}</span>
        <span class="title">${esc(idea.title)}</span>
        ${CHEVRON}
      </button>
    </div>`).join('');
  return `<div class="group">${rows}</div>`;
}

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
    <div class="ideas">${ideaListHtml(s.id, filter)}</div>
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

// ---------- Действия по нажатию ----------

const SECTION_MAX = 50;
const TITLE_MAX = 80;
const IDEA_MAX = 3000; // в облаке Telegram на одну запись — до 4096 символов

// «Выполненные»: все Done, сгруппированные по разделам (в порядке разделов), свежие сверху
views.archive = () => {
  let total = 0;
  const blocks = data.sections.map((s) => {
    const ideas = filteredIdeas(s.id, 'done');
    if (!ideas.length) return '';
    total += ideas.length;
    return `
      <p class="group-head">${esc(s.name)} · ${ideas.length}</p>
      <div class="group">${ideas.map(doneRowHtml).join('')}</div>`;
  }).join('');

  return `
    <h1>Выполненные</h1>
    <p class="sub">${total ? plural(total, ['план', 'плана', 'планов']) : 'Пока ничего не выполнено'}</p>
    ${blocks || '<p class="empty">Здесь появятся планы со статусом ⚫ Done</p>'}`;
};

// Поля окна для идеи: заголовок и необязательное описание
function ideaFields(idea = { title: '', text: '' }) {
  return [
    { value: idea.title, placeholder: 'Заголовок', max: TITLE_MAX },
    { value: idea.text, placeholder: 'Описание — необязательно', max: IDEA_MAX, multiline: true, optional: true },
  ];
}

const actions = {
  'back': back,

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

  // Удаление свайпом: раздела на главном экране или идеи в разделе
  'swipe-delete': async ({ id, kind }, el) => {
    const isIdea = kind === 'idea';
    const ok = isIdea ? await confirmDeleteIdea(id) : await confirmDeleteSection(id);
    if (!ok) {
      closeSwipe();
      return;
    }
    openSwipe = null;
    await collapse(el.closest('.swipe'));
    await commit(() => (isIdea ? deleteIdeaData(id) : deleteSectionData(id)));
  },

  'add-idea': async ({ id }) => {
    const res = await ask({ title: 'Новый план', fields: ideaFields() });
    if (!res) return;
    const [title, text] = res;
    const idea = { id: newId(), sec: id, title, text, st: 'new', at: Date.now() };
    flash = idea.id;
    // Новый план — Not started. Если открыт фильтр, где его не видно, переключаемся на «Все»
    const route = stack[stack.length - 1];
    if (route.filter === 'wip' || route.filter === 'done') route.filter = 'all';
    await commit(() => {
      data.ideas.push(idea);
      return saveIdea(idea);
    });
  },

  'open-idea': ({ id }) => go({ name: 'idea', id }),

  // Фильтр в разделе: таблетка переезжает, список мягко обновляется
  'set-filter': ({ key }, el) => {
    const route = stack[stack.length - 1];
    if ((route.filter || 'all') === key) return;
    route.filter = key;
    closeSwipe(false);
    moveSeg(el.closest('.seg'), key);
    const box = el.closest('.screen-inner').querySelector('.ideas');
    box.innerHTML = ideaListHtml(route.id, key);
    box.classList.remove('list-swap');
    void box.offsetWidth; // перезапуск анимации
    box.classList.add('list-swap');
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
};

document.addEventListener('click', (e) => {
  if (suppressClick) {
    suppressClick = false; // это был свайп или закрытие кнопки, а не нажатие
    return;
  }
  const el = e.target.closest('[data-act]');
  if (!el || busy) return;
  const action = actions[el.dataset.act];
  if (action) action(el.dataset, el);
});

// ---------- Свайп влево для удаления ----------

const SWIPE_OPEN = 96; // насколько сдвигается строка, чтобы открыть кнопку
let openSwipe = null;  // строка с открытой кнопкой
let drag = null;       // текущее движение пальцем
let pendingClose = false;
let suppressClick = false;

// Сдвигает строку на x пикселей; кнопка проявляется по мере сдвига
function setSwipe(wrap, x, animate) {
  const row = wrap.querySelector('.row');
  const del = wrap.querySelector('.swipe-del');
  // p — насколько открыта кнопка (0…1). Кнопка начинает проявляться после 15% сдвига,
  // а s сглаживает разгон и торможение
  const p = Math.min(1, Math.max(0, (-x / SWIPE_OPEN - 0.15) / 0.85));
  const s = p * p * (3 - 2 * p);
  row.classList.toggle('settling', animate);
  del.classList.toggle('settling', animate);
  row.style.transform = x ? `translateX(${x}px)` : '';
  del.style.opacity = s;
  del.style.transform = `translateX(${(1 - s) * 24}px) scale(${0.85 + 0.15 * s})`;
}

function closeSwipe(animate = true) {
  if (openSwipe) setSwipe(openSwipe, 0, animate);
  openSwipe = null;
}

document.addEventListener('pointerdown', (e) => {
  const onDelete = e.target.closest('.swipe-del');
  // Если кнопка уже открыта, тап в другом месте только закрывает её
  pendingClose = Boolean(openSwipe && !onDelete);
  suppressClick = pendingClose;
  const wrap = e.target.closest('.swipe');
  if (!wrap || onDelete || busy) return;
  drag = {
    wrap, id: e.pointerId, x0: e.clientX, y0: e.clientY, x: 0,
    base: wrap === openSwipe ? -SWIPE_OPEN : 0, active: false,
  };
});

document.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x0;
  const dy = e.clientY - drag.y0;
  if (!drag.active) {
    // Ждём, пока станет понятно направление: вбок — свайп, вверх-вниз — прокрутка
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    if (Math.abs(dy) >= Math.abs(dx)) {
      drag = null;
      return;
    }
    drag.active = true;
    drag.wrap.querySelector('.row').classList.add('dragging');
    pendingClose = false;
    if (openSwipe && openSwipe !== drag.wrap) closeSwipe();
    try { drag.wrap.setPointerCapture(e.pointerId); } catch { /* не страшно */ }
  }
  let x = Math.min(0, drag.base + dx);
  // За пределом кнопки строка тянется туже, как резинка
  if (x < -SWIPE_OPEN) x = -SWIPE_OPEN + (x + SWIPE_OPEN) / 3;
  drag.x = x;
  setSwipe(drag.wrap, x, false);
});

function endDrag() {
  if (drag && drag.active) {
    suppressClick = true;
    drag.wrap.querySelector('.row').classList.remove('dragging');
    const open = drag.x < -SWIPE_OPEN / 2;
    setSwipe(drag.wrap, open ? -SWIPE_OPEN : 0, true);
    if (open && openSwipe !== drag.wrap) softHaptic();
    openSwipe = open ? drag.wrap : null;
  } else if (pendingClose) {
    closeSwipe();
  }
  pendingClose = false;
  drag = null;
}

document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);

// Плавно схлопывает строку списка
function collapse(el) {
  el.style.height = el.offsetHeight + 'px';
  void el.offsetHeight; // фиксируем высоту, чтобы анимация пошла от неё
  el.classList.add('removing');
  return wait(380);
}

// ---------- Отрисовка ----------

function screenHtml(index) {
  const route = stack[index];
  // Вне Telegram показываем свою кнопку «Назад», в Telegram — встроенную
  const backLink = !inTelegram && index > 0
    ? '<button class="back" data-act="back">← Назад</button>' : '';
  return `<div class="screen-inner">${backLink}${views[route.name](route)}</div>`;
}

function makeScreen(index) {
  const el = document.createElement('section');
  el.className = 'screen';
  el.innerHTML = screenHtml(index);
  return el;
}

// Перерисовывает слой, не сбрасывая прокрутку
function refreshScreen(el, index) {
  const y = el.scrollTop;
  el.innerHTML = screenHtml(index);
  el.scrollTop = y;
  openSwipe = null;
}

// Обновляет текущий (верхний) экран после изменений
function refresh() {
  refreshScreen(screens[screens.length - 1], stack.length - 1);
}

function updateBackButton() {
  if (!inTelegram) return;
  if (stack.length > 1 || sheetResolve) tg.BackButton.show();
  else tg.BackButton.hide();
}

// ---------- Окно ввода и подтверждение ----------

const sheet = document.getElementById('sheet');
const sheetFields = document.getElementById('sheet-fields');
let sheetInputs = [];
let sheetResolve = null;
let sheetTimer;

// Показывает окно ввода с полями fields: [{ value, placeholder, max, multiline, optional }].
// Возвращает массив введённых строк или null при отмене
function ask({ title, fields }) {
  clearTimeout(sheetTimer);
  closeSwipe();
  document.getElementById('sheet-title').textContent = title;
  sheetInputs = fields.map((f) => {
    const el = document.createElement('textarea');
    el.value = f.value || '';
    el.placeholder = f.placeholder || '';
    el.maxLength = f.max || 50;
    el.rows = f.multiline ? 6 : 1;
    el.dataset.multiline = f.multiline ? '1' : '';
    el.dataset.optional = f.optional ? '1' : '';
    el.addEventListener('keydown', onSheetKey);
    // Однострочное поле растёт по высоте, если текст длинный
    if (!f.multiline) el.addEventListener('input', () => autoGrow(el));
    return el;
  });
  sheetFields.replaceChildren(...sheetInputs);
  sheet.classList.remove('closing');
  sheet.classList.add('open');
  sheetInputs.forEach((el) => { if (!el.dataset.multiline) autoGrow(el); });
  sheetInputs[0].focus();
  return new Promise((resolve) => {
    sheetResolve = resolve;
    updateBackButton();
  });
}

function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

// Enter в однострочном поле — к следующему полю или сохранить; Ctrl+Enter — сохранить всегда
function onSheetKey(e) {
  if (e.key !== 'Enter') return;
  const el = e.target;
  const force = e.ctrlKey || e.metaKey;
  if (el.dataset.multiline && !force) return; // обычный перенос строки
  e.preventDefault();
  const next = sheetInputs[sheetInputs.indexOf(el) + 1];
  if (next && !force) next.focus();
  else saveSheet();
}

function closeSheet(result) {
  sheet.classList.add('closing'); // окно плавно уменьшается и исчезает
  sheetInputs.forEach((el) => el.blur());
  sheetTimer = setTimeout(() => sheet.classList.remove('open', 'closing'), 260);
  const resolve = sheetResolve;
  sheetResolve = null;
  updateBackButton();
  if (resolve) resolve(result);
}

function saveSheet() {
  // В однострочных полях переносы строк превращаем в пробелы
  const values = sheetInputs.map((el) => (
    el.dataset.multiline ? el.value.trim() : el.value.replace(/\s+/g, ' ').trim()
  ));
  const missing = sheetInputs.find((el, i) => !el.dataset.optional && !values[i]);
  if (missing) {
    toast('Пусто');
    missing.focus();
    return;
  }
  closeSheet(values);
}

document.getElementById('sheet-save').addEventListener('click', saveSheet);
document.getElementById('sheet-cancel').addEventListener('click', () => closeSheet(null));
// Нажатие на затемнённый фон — отмена
sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(null); });

function confirmDialog(text) {
  return new Promise((resolve) => {
    if (inTelegram && tg.isVersionAtLeast('6.2')) tg.showConfirm(text, resolve);
    else resolve(window.confirm(text));
  });
}

// ---------- Мелочи ----------

function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Обрезает длинный текст до n символов (для вопросов «Удалить …?»)
function shorten(text, n) {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > n ? line.slice(0, n - 1) + '…' : line;
}

// 1 идея, 2 идеи, 5 идей
function plural(n, [one, few, many]) {
  const d = n % 10;
  const dd = n % 100;
  const word = d === 1 && dd !== 11 ? one : d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? few : many;
  return `${n} ${word}`;
}

// «30 октября», а для прошлых лет — «30 октября 2025 г.»
function formatDate(ms) {
  const date = new Date(ms);
  const opts = { day: 'numeric', month: 'long' };
  if (date.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return date.toLocaleDateString('ru-RU', opts);
}

// Короткая дата для списков: «30 окт.»
function formatShort(ms) {
  return new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let toastTimer;
function toast(text) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

// Лёгкая вибрация (только в Telegram)
function haptic() {
  if (inTelegram && tg.isVersionAtLeast('6.1')) tg.HapticFeedback.impactOccurred('light');
}

// Самая мягкая вибрация — когда открывается кнопка свайпа
function softHaptic() {
  if (inTelegram && tg.isVersionAtLeast('6.1')) tg.HapticFeedback.selectionChanged();
}

function applyTheme() {
  const dark = inTelegram
    ? tg.colorScheme === 'dark'
    : window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  if (inTelegram) {
    const bg = dark ? '#000000' : '#f2f2f7';
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
    // Первый экран: плавно проявляется, строки появляются по очереди
    const first = makeScreen(0);
    first.classList.add('intro');
    screens.push(first);
    app.replaceChildren(first);
    setTimeout(() => first.classList.remove('intro'), 1500);
    updateBackButton();
  } catch (err) {
    app.innerHTML = `<p class="empty">Не удалось загрузить данные.<br>${esc(err.message)}</p>`;
  }
}

start();
