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

function findSection(id) {
  return data.sections.find((s) => s.id === id);
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function saveSections() {
  return store.set('sections', JSON.stringify(data.sections));
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
  const extra = count ? `\nВместе с ним удалятся идеи: ${count}.` : '';
  return confirmDialog(`Удалить раздел «${s.name}»?${extra}`);
}

// Выполняет изменение и сохранение. При ошибке перечитывает данные, чтобы экран не врал.
// after — что сделать потом: по умолчанию обновить текущий экран
async function commit(change, after = refresh) {
  try {
    await change();
    haptic();
  } catch (err) {
    console.error(err);
    toast('Не удалось сохранить');
    await loadData().catch(() => {});
  }
  await after();
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

views.main = () => {
  const rows = data.sections.map((s, n) => `
    <div class="swipe${takeFlash(s.id) ? ' appear' : ''}" style="--i:${n}">
      <button class="swipe-del" data-act="swipe-delete" data-id="${s.id}">Удалить</button>
      <button class="row" data-act="open-section" data-id="${s.id}">
        <span class="title">${esc(s.name)}</span>
        <span class="meta">${activeCount(s.id)}</span>
        ${CHEVRON}
      </button>
    </div>`).join('');

  return `
    <h1>Журнал идей</h1>
    <p class="sub">${data.sections.length ? 'Выбери раздел' : 'Разделов пока нет'}</p>
    ${rows ? `<div class="group">${rows}</div>` : ''}
    <div class="actions">
      <button class="btn primary" data-act="new-section">➕ Новый раздел</button>
      <button class="btn" data-act="open-archive">🗄 Архив Done</button>
    </div>`;
};

views.section = (route) => {
  const s = findSection(route.id);
  if (!s) return '<p class="empty">Раздел не найден</p>';

  return `
    <h1${takeFlash(s.id) ? ' class="swap"' : ''}>${esc(s.name)}</h1>
    <p class="sub">Идей пока нет</p>
    <div class="actions">
      <button class="btn primary" data-act="add-idea">➕ Добавить идею</button>
    </div>
    <div class="group">
      <button class="row" data-act="rename-section" data-id="${s.id}">Переименовать</button>
      <button class="row danger" data-act="delete-section" data-id="${s.id}">Удалить раздел</button>
    </div>`;
};

// ---------- Действия по нажатию ----------

const SECTION_MAX = 50;

const actions = {
  'back': back,

  'open-section': ({ id }) => go({ name: 'section', id }),

  'new-section': async () => {
    const name = await ask({ title: 'Новый раздел', placeholder: 'Название', max: SECTION_MAX });
    if (!name) return;
    const id = newId();
    flash = id;
    await commit(() => {
      data.sections.push({ id, name });
      return saveSections();
    });
  },

  'rename-section': async ({ id }) => {
    const s = findSection(id);
    const name = await ask({ title: 'Переименовать раздел', value: s.name, max: SECTION_MAX });
    if (!name || name === s.name) return;
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

  // Удаление свайпом на главном экране
  'swipe-delete': async ({ id }, el) => {
    if (!(await confirmDeleteSection(id))) {
      closeSwipe();
      return;
    }
    openSwipe = null;
    await collapse(el.closest('.swipe'));
    await commit(() => deleteSectionData(id));
  },

  // Заглушки: появятся на следующих этапах
  'add-idea': () => toast('Будет на следующем этапе'),
  'open-archive': () => toast('Будет на следующем этапе'),
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
const sheetInput = document.getElementById('sheet-input');
let sheetResolve = null;
let sheetMultiline = false;
let sheetTimer;

// Показывает окно ввода. Возвращает введённый текст или null при отмене
function ask({ title, value = '', placeholder = '', max = 50, multiline = false }) {
  clearTimeout(sheetTimer);
  closeSwipe();
  document.getElementById('sheet-title').textContent = title;
  sheetInput.value = value;
  sheetInput.placeholder = placeholder;
  sheetInput.maxLength = max;
  sheetInput.rows = multiline ? 6 : 1;
  sheetMultiline = multiline;
  sheet.classList.remove('closing');
  sheet.classList.add('open');
  sheetInput.focus();
  return new Promise((resolve) => {
    sheetResolve = resolve;
    updateBackButton();
  });
}

function closeSheet(result) {
  sheet.classList.add('closing'); // окно плавно уменьшается и исчезает
  sheetInput.blur();
  sheetTimer = setTimeout(() => sheet.classList.remove('open', 'closing'), 260);
  const resolve = sheetResolve;
  sheetResolve = null;
  updateBackButton();
  if (resolve) resolve(result);
}

function saveSheet() {
  const text = sheetInput.value.trim();
  if (!text) {
    toast('Пусто');
    return;
  }
  closeSheet(text);
}

document.getElementById('sheet-save').addEventListener('click', saveSheet);
document.getElementById('sheet-cancel').addEventListener('click', () => closeSheet(null));
// Нажатие на затемнённый фон — отмена
sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(null); });
// В однострочном поле Enter сохраняет
sheetInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !sheetMultiline) {
    e.preventDefault();
    saveSheet();
  }
});

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
