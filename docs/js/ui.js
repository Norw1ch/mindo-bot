'use strict';

// Общая основа интерфейса: вкладки, переходы между экранами, окно ввода, свайпы,
// переключатели и страницы. Модули добавляют сюда свои экраны (views) и действия (actions)

const views = {};    // название экрана → функция, возвращающая его HTML
const actions = {};  // data-act кнопки → что сделать по нажатию
const pagers = {};   // название экрана → HTML списка с листанием (для кнопок ‹ ›)
const deleters = {}; // data-kind → { confirm(id), remove(id) } для удаления свайпом

const CHEVRON = '<svg class="chev" width="8" height="13" viewBox="0 0 8 13" aria-hidden="true">'
  + '<path d="M1.5 1.5 6.5 6.5 1.5 11.5" fill="none" stroke="currentColor" stroke-width="2"'
  + ' stroke-linecap="round" stroke-linejoin="round"/></svg>';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Что мягко подсветить при следующей отрисовке (новая строка, новое имя).
// Одно значение или Set — если новых строк сразу несколько
let flash = null;

function takeFlash(id) {
  if (flash instanceof Set) {
    if (!flash.delete(id)) return false;
    if (!flash.size) flash = null;
    return true;
  }
  if (flash !== id) return false;
  flash = null;
  return true;
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
    toast(err.userMessage || 'Не удалось сохранить'); // userMessage — понятное объяснение от модуля
    await loadData().catch(() => {});
  }
  await after();
  return ok;
}

// ---------- Вкладки и навигация ----------
// У каждой вкладки своя стопка экранов, как в iOS: stack — маршруты, screens — их слои.
// Переменные app / stack / screens всегда указывают на текущую вкладку.
// Новый экран выезжает справа поверх текущего, «Назад» уводит его обратно вправо.

const root = document.getElementById('app');
const tabbar = document.getElementById('tabbar');
const panes = {}; // вкладка → { el, stack, screens }
let currentTab = null;
let app = null;
let stack = [];
let screens = [];
let busy = false; // идёт переход — нажатия игнорируем

const SLIDE_MS = 500;
const SLIDE_EASE = 'cubic-bezier(.32, .72, 0, 1)';
const UNDER_SHIFT = 'translateX(-28%)'; // насколько нижний экран уходит влево

function currentRoute() {
  return stack[stack.length - 1];
}

function buildTabbar() {
  tabbar.innerHTML = TABS.map((t) => `
    <button class="tab" data-tab="${t.key}">${t.icon}<span>${t.label}</span></button>`).join('');
  tabbar.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    softHaptic();
    switchTab(btn.dataset.tab);
  });
}

// Переключает вкладку. Повторное нажатие на текущую — возврат к её главному экрану
function switchTab(key) {
  if (busy) return;
  flushAllEdits();
  if (key === currentTab) {
    popToRoot();
    return;
  }
  closeSwipe(false);
  let pane = panes[key];
  const first = !pane;
  if (first) {
    const tab = TABS.find((t) => t.key === key);
    const el = document.createElement('div');
    el.className = 'pane';
    root.append(el);
    pane = { el, stack: [{ ...tab.root }], screens: [] };
    panes[key] = pane;
  }
  if (currentTab) panes[currentTab].el.classList.remove('active');
  currentTab = key;
  ({ el: app, stack, screens } = pane);

  if (first) {
    const screen = makeScreen(0);
    screens.push(screen);
    app.append(screen);
    sizeEdits(screen);
  } else {
    refresh(); // данные могли измениться на другой вкладке
  }
  app.classList.add('active');
  restartAnim(app, 'tab-in');
  tabbar.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === key));
  updateBackButton();
}

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
  flushAllEdits();
  closeSwipe(false);
  stack.push(route);
  const under = screens[screens.length - 1];
  const top = makeScreen(stack.length - 1);
  const shade = makeShade();
  screens.push(top);
  app.append(shade, top);
  sizeEdits(top);
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
  if (choiceResolve) {
    closeChoice(null);
    return;
  }
  if (busy || stack.length < 2) return;
  busy = true;
  flushAllEdits(); // недописанный текст сохраняем до ухода с экрана
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

// Сразу к главному экрану вкладки: промежуточные экраны убираем, верхний уезжает как при «Назад»
async function popToRoot() {
  if (busy || stack.length < 2) return;
  while (stack.length > 2) {
    stack.splice(stack.length - 2, 1);
    screens.splice(screens.length - 2, 1)[0].remove();
  }
  await back();
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
  sizeEdits(el);
  el.scrollTop = y;
  openSwipe = null;
}

// Обновляет текущий (верхний) экран после изменений
function refresh() {
  refreshScreen(screens[screens.length - 1], stack.length - 1);
}

function updateBackButton() {
  if (!inTelegram) return;
  if (stack.length > 1 || sheetResolve || choiceResolve) tg.BackButton.show();
  else tg.BackButton.hide();
}

// Перезапускает анимацию появления блока (класс cls)
function restartAnim(el, cls) {
  el.classList.remove('list-swap', 'page-next', 'page-prev', 'tab-in');
  void el.offsetWidth; // без этого анимация с тем же классом не повторится
  el.classList.add(cls);
}

// Обрезать по вертикали, не обрезая боковой въезд страницы (в старых браузерах — просто обрезать)
const CLIP_Y = window.CSS && CSS.supports('overflow-y', 'clip') ? 'clip' : 'hidden';

// Меняет содержимое блока: новое появляется с анимацией cls, а высота блока плавно
// перетекает от старой к новой — то, что ниже, не прыгает
function swapContent(box, html, cls) {
  const from = box.offsetHeight; // если прошлая анимация ещё идёт — это её текущая высота
  if (box.heightAnim) box.heightAnim.cancel();
  box.innerHTML = html;
  restartAnim(box, cls);
  const to = box.offsetHeight;
  if (from === to || reduceMotion || !box.animate) return;

  box.style.overflowY = CLIP_Y;
  const anim = box.animate(
    [{ height: from + 'px' }, { height: to + 'px' }],
    { duration: 450, easing: 'cubic-bezier(.2, .9, .3, 1)' },
  );
  box.heightAnim = anim;
  const done = () => {
    if (box.heightAnim !== anim) return; // уже началась новая анимация
    box.heightAnim = null;
    box.style.overflowY = '';
  };
  anim.finished.then(done, done);
}

// Плавно схлопывает строку списка
function collapse(el) {
  el.style.height = el.offsetHeight + 'px';
  void el.offsetHeight; // фиксируем высоту, чтобы анимация пошла от неё
  el.classList.add('removing');
  return wait(380);
}

// ---------- Переключатель (сегменты) ----------

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

// ---------- Страницы по 8 ----------

const PAGE_SIZE = 8;

// Кусок списка для текущей страницы. Если страница вышла за край (например, после удаления) — поправляет
function paginate(list, route) {
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const page = Math.min(route.page || 0, pages - 1);
  route.page = page;
  return { items: list.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), page, pages };
}

// ‹  1 / 3  › — только если страниц больше одной
function pagerHtml({ page, pages }) {
  if (pages < 2) return '';
  return `
    <div class="pager">
      <button class="pager-btn prev" data-act="set-page" data-dir="-1"${page === 0 ? ' disabled' : ''}>${CHEVRON}</button>
      <span class="pager-info">${page + 1} / ${pages}</span>
      <button class="pager-btn" data-act="set-page" data-dir="1"${page === pages - 1 ? ' disabled' : ''}>${CHEVRON}</button>
    </div>`;
}

// Список с группами и листанием: на каждой странице заголовки групп строятся заново.
// groupOf(item) → { key, label } (label — готовый HTML), rowOf(item, n) → HTML строки
function groupedPage(list, route, groupOf, rowOf) {
  const p = paginate(list, route);
  let html = '';
  let group = null;
  let rows = [];
  const flush = () => {
    if (group) html += `<p class="group-head">${group.label}</p><div class="group">${rows.join('')}</div>`;
  };
  p.items.forEach((item, n) => {
    const g = groupOf(item);
    if (!group || g.key !== group.key) {
      flush();
      group = g;
      rows = [];
    }
    rows.push(rowOf(item, n));
  });
  flush();
  return `<div class="page-items">${html}</div>${pagerHtml(p)}`;
}

// ---------- Правка прямо на экране ----------
// Поле <textarea class="inline-edit" data-edit="тип" data-id="…">: нажал — печатаешь, сохраняется само
// через паузу в наборе и при уходе с поля. Модуль задаёт editors[тип]:
//   get(id) — текущее значение, save(id, value) — записать (сначала меняет данные, потом сохраняет),
//   required — пустым быть нельзя (вернём прежнее)

const editors = {};
const editTimers = new Map(); // поле → таймер отложенного сохранения
const EDIT_DELAY = 700;

function editValue(el) {
  // В однострочных полях переносы превращаем в пробелы
  return el.dataset.multiline ? el.value.trim() : el.value.replace(/\s+/g, ' ').trim();
}

// final — поле покинули: пустой обязательный текст откатываем к прежнему
async function flushEdit(el, final) {
  clearTimeout(editTimers.get(el));
  editTimers.delete(el);
  const editor = editors[el.dataset.edit];
  const { id } = el.dataset;
  const value = editValue(el);
  if (value === editor.get(id)) return;
  if (!value && editor.required) {
    if (final) {
      el.value = editor.get(id);
      autoGrow(el);
      toast('Заголовок не может быть пустым');
    }
    return;
  }
  try {
    await editor.save(id, value);
  } catch (err) {
    console.error(err);
    toast(err.userMessage || 'Не удалось сохранить');
    await loadData().catch(() => {});
    refresh();
  }
}

// Сохранить всё недописанное — перед переходами
function flushAllEdits() {
  [...editTimers.keys()].forEach((el) => flushEdit(el, true));
}

// Подогнать высоту полей под текст (после того, как экран попал на страницу)
function sizeEdits(screen) {
  screen.querySelectorAll('.inline-edit').forEach(autoGrow);
}

document.addEventListener('input', (e) => {
  const el = e.target;
  if (!el.classList.contains('inline-edit')) return;
  autoGrow(el);
  clearTimeout(editTimers.get(el));
  editTimers.set(el, setTimeout(() => flushEdit(el, false), EDIT_DELAY));
});
document.addEventListener('focusout', (e) => {
  if (e.target.classList.contains('inline-edit')) flushEdit(e.target, true);
});
// Enter в однострочном поле (заголовке) убирает клавиатуру
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList.contains('inline-edit') && !e.target.dataset.multiline) {
    e.preventDefault();
    e.target.blur();
  }
});

// HTML поля правки. multiline — многострочное (описание), иначе однострочное (заголовок)
function editHtml(type, id, value, { placeholder = '', max = 80, multiline = false, cls = '' } = {}) {
  return `<textarea class="inline-edit ${cls}" data-edit="${type}" data-id="${id}" rows="1"
    maxlength="${max}" placeholder="${placeholder}"${multiline ? ' data-multiline="1"' : ''}
    enterkeyhint="${multiline ? 'enter' : 'done'}">${esc(value || '')}</textarea>`;
}

// ---------- Строка поиска ----------
// Поле с лупой и «Отменой». Модуль задаёт onSearch(route, query, inner) — что показать.
// Поиск обновляет экран на месте, чтобы не терялся фокус и клавиатура

const SEARCH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"'
  + ' stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>';

const searchHandlers = {}; // название экрана → onSearch(route, query, inner)

function searchHtml(query, placeholder) {
  return `
    <div class="search${query ? ' active' : ''}">
      <label class="search-field">
        ${SEARCH_ICON}
        <input type="search" class="search-input" placeholder="${placeholder}" value="${esc(query || '')}"
          enterkeyhint="search" autocomplete="off" autocorrect="off" spellcheck="false">
      </label>
      <button class="search-cancel" data-act="search-cancel">Отмена</button>
    </div>`;
}

function runSearch(input) {
  const route = currentRoute();
  route.q = input.value;
  route.page = 0;
  searchHandlers[route.name](route, route.q.trim(), input.closest('.screen-inner'));
}

document.addEventListener('input', (e) => {
  if (e.target.classList.contains('search-input')) runSearch(e.target);
});
// «Отмена» выезжает, когда поле в фокусе или в нём есть текст
document.addEventListener('focusin', (e) => {
  if (e.target.classList.contains('search-input')) e.target.closest('.search').classList.add('active');
});
document.addEventListener('focusout', (e) => {
  const input = e.target;
  if (!input.classList.contains('search-input')) return;
  // С задержкой — иначе «Отмена» начнёт уезжать прямо из-под пальца, пока его нажимают
  setTimeout(() => {
    if (!input.value && document.activeElement !== input) input.closest('.search').classList.remove('active');
  }, 200);
});
// Enter прячет клавиатуру — результаты и так уже на экране
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList.contains('search-input')) e.target.blur();
});

// Показывает один из двух блоков (обычное содержимое или результаты) с мягким появлением
function showSearchState(inner, searching) {
  const results = inner.querySelector('.search-results');
  const body = inner.querySelector('.search-body');
  const was = !results.classList.contains('hidden');
  results.classList.toggle('hidden', !searching);
  body.classList.toggle('hidden', searching);
  if (was !== searching) restartAnim(searching ? results : body, 'list-swap');
}

// ---------- Общие действия ----------

Object.assign(actions, {
  'back': back,

  // Листание страниц: новая страница въезжает справа (вперёд) или слева (назад)
  'set-page': ({ dir }, el) => {
    const route = currentRoute();
    route.page = (route.page || 0) + Number(dir);
    closeSwipe(false);
    const box = el.closest('.paged');
    swapContent(box, pagers[route.name](route), Number(dir) > 0 ? 'page-next' : 'page-prev');
    softHaptic();
    // Если начало списка ушло вверх за экран — плавно поднимаемся к нему
    if (box.getBoundingClientRect().top < 0) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  // «Отмена» в поиске: очистить, спрятать клавиатуру, вернуть обычный экран
  'search-cancel': (data, el) => {
    const input = el.closest('.search').querySelector('.search-input');
    input.value = '';
    input.blur();
    el.closest('.search').classList.remove('active');
    runSearch(input);
  },

  // Удаление свайпом: что именно удалять — решает модуль по data-kind
  'swipe-delete': async ({ id, kind }, el) => {
    const deleter = deleters[kind];
    if (!(await deleter.confirm(id))) {
      closeSwipe();
      return;
    }
    openSwipe = null;
    await collapse(el.closest('.swipe'));
    await commit(() => deleter.remove(id));
  },
});

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

// ---------- Окно ввода ----------

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

// ---------- Меню выбора снизу (как в iOS) ----------

const choice = document.getElementById('choice');
const choiceOpts = document.getElementById('choice-opts');
let choiceResolve = null;
let choiceTimer;

// options: [{ key, label, danger, checked }] или { label, date: '2026-10-30' } — пункт с календарём.
// checked — отметить пункт галочкой (текущий выбор).
// Возвращает key выбранного пункта, выбранную дату или null при отмене
function choose({ title, options }) {
  clearTimeout(choiceTimer);
  closeSwipe();
  document.getElementById('choice-title').textContent = title;
  choiceOpts.innerHTML = options.map((o) => (o.date !== undefined
    // Невидимое поле даты поверх пункта: нажатие открывает системный календарь
    ? `<label class="choice-opt">${esc(o.label)}<input type="date" class="choice-date" value="${o.date}"></label>`
    : `<button class="choice-opt${o.danger ? ' danger' : ''}" data-key="${o.key}">${esc(o.label)}${o.checked ? '<span class="choice-check">✓</span>' : ''}</button>`)).join('');
  choice.classList.remove('closing');
  choice.classList.add('open');
  return new Promise((resolve) => {
    choiceResolve = resolve;
    updateBackButton();
  });
}

function closeChoice(result) {
  if (!choiceResolve) return;
  choice.classList.add('closing'); // меню плавно уезжает вниз
  choiceTimer = setTimeout(() => choice.classList.remove('open', 'closing'), 320);
  const resolve = choiceResolve;
  choiceResolve = null;
  updateBackButton();
  resolve(result);
}

choice.addEventListener('click', (e) => {
  const opt = e.target.closest('button.choice-opt');
  if (opt) closeChoice(opt.dataset.key);
  else if (e.target === choice || e.target.id === 'choice-cancel') closeChoice(null);
  else if (e.target.classList.contains('choice-date')) {
    // На компьютере календарь сам не открывается — просим явно
    try { e.target.showPicker(); } catch { /* телефон откроет сам */ }
  }
});
choice.addEventListener('change', (e) => {
  if (e.target.classList.contains('choice-date') && e.target.value) closeChoice(e.target.value);
});
