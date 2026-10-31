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

// Кружок для отметки (чеклист в плане, пункты списков); галочка «рисуется» при отметке
const CHECK = '<span class="check"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6.5 12.5 3.5 3.5 7.5-8"/></svg></span>';

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
  if (datePopShown) {
    closeDatePop(); // сначала закрываем календарь: введённая сумма не должна пропасть
    return;
  }
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

// То же без анимации — когда вкладка только что открыта и перехода всё равно не видно
function resetToRoot() {
  while (stack.length > 1) {
    stack.pop();
    screens.pop().remove();
  }
  screens[0].classList.remove('covered');
  refresh();
  updateBackButton();
}

// ---------- «Назад» свайпом от левого края (как в iOS) ----------
// Палец у левого края ведёт вправо — верхний экран едет за пальцем, предыдущий выглядывает из-под него
// и светлеет. Отпустил дальше трети ширины или смахнул быстро — экран закрывается, иначе возвращается

const EDGE_ZONE = 28;       // ширина полосы у левого края, откуда начинается жест
const EDGE_COMPLETE = 0.33; // какую долю ширины протянуть, чтобы закрыть экран
const EDGE_FLICK = 0.5;     // скорость (пикселей в мс), при которой хватит короткого смахивания
let edge = null;

function edgeAllowed() {
  return stack.length > 1 && !busy && !sheetResolve && !choiceResolve;
}

document.addEventListener('touchstart', (e) => {
  if (e.touches.length !== 1 || !edgeAllowed()) return;
  const touch = e.touches[0];
  if (touch.clientX > EDGE_ZONE) return;
  edge = {
    x0: touch.clientX, y0: touch.clientY, dx: 0, v: 0,
    lastX: touch.clientX, lastT: e.timeStamp, active: false,
  };
}, { passive: true });

document.addEventListener('touchmove', (e) => {
  if (!edge) return;
  const touch = e.touches[0];
  const dx = touch.clientX - edge.x0;
  const dy = touch.clientY - edge.y0;
  if (!edge.active) {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    // Не вправо, а вверх-вниз или влево — это не жест «назад»
    if (dx <= 0 || Math.abs(dy) > Math.abs(dx)) {
      edge = null;
      return;
    }
    startEdgeDrag();
  }
  e.preventDefault(); // пока тянем — экран не прокручивается
  edge.v = (touch.clientX - edge.lastX) / Math.max(1, e.timeStamp - edge.lastT);
  edge.lastX = touch.clientX;
  edge.lastT = e.timeStamp;
  edge.dx = Math.max(0, dx);
  setEdgeProgress();
}, { passive: false });

document.addEventListener('touchend', finishEdgeDrag);
document.addEventListener('touchcancel', finishEdgeDrag);

function startEdgeDrag() {
  busy = true; // пока тянем — нажатия не обрабатываем
  flushAllEdits();
  closeSwipe(false);
  edge.active = true;
  edge.top = screens[screens.length - 1];
  edge.under = screens[screens.length - 2];
  edge.width = app.clientWidth || window.innerWidth;
  refreshScreen(edge.under, stack.length - 2); // данные могли измениться, пока он был закрыт
  edge.under.classList.remove('covered');
  edge.shade = makeShade();
  edge.top.before(edge.shade);
}

// Экран за пальцем: верхний сдвигается, нижний выезжает из-под него, затемнение уходит
function setEdgeProgress() {
  const p = Math.min(1, edge.dx / edge.width);
  edge.top.style.transform = `translateX(${edge.dx}px)`;
  edge.under.style.transform = `translateX(${-28 * (1 - p)}%)`;
  edge.shade.style.opacity = String(1 - p);
}

async function finishEdgeDrag() {
  if (!edge) return;
  const g = edge;
  edge = null;
  if (!g.active) return;
  const p = Math.min(1, g.dx / g.width);
  const complete = p > EDGE_COMPLETE || g.v > EDGE_FLICK;
  // Доезжаем оставшееся расстояние: чем меньше осталось, тем быстрее
  const rest = complete ? 1 - p : p;
  const opts = { duration: Math.max(180, 420 * rest), easing: 'cubic-bezier(.2, .9, .3, 1)', fill: 'forwards' };
  const anims = reduceMotion || !g.top.animate ? [] : [
    g.top.animate([{ transform: g.top.style.transform }, { transform: complete ? 'translateX(100%)' : 'translateX(0)' }], opts),
    g.under.animate([{ transform: g.under.style.transform }, { transform: complete ? 'translateX(0)' : UNDER_SHIFT }], opts),
    g.shade.animate([{ opacity: g.shade.style.opacity }, { opacity: complete ? 0 : 1 }], opts),
  ];
  await Promise.all(anims.map((a) => a.finished));
  g.top.style.transform = '';
  g.under.style.transform = '';
  g.shade.remove();
  if (complete) {
    stack.pop();
    screens.pop();
    g.top.remove();
    softHaptic();
  } else {
    g.under.classList.add('covered'); // передумал — нижний экран снова прячем
  }
  anims.forEach((a) => a.cancel());
  updateBackButton();
  busy = false;
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
// перетекает от старой к новой — то, что ниже, не прыгает.
// Старое содержимое не пропадает мгновенно: его «призрак» плавно уезжает и гаснет поверх нового
// (page-next — влево, page-prev — вправо, иначе просто гаснет)
function swapContent(box, html, cls) {
  const from = box.offsetHeight; // если прошлая анимация ещё идёт — это её текущая высота
  if (box.heightAnim) box.heightAnim.cancel();
  box.querySelectorAll('.swap-ghost').forEach((g) => g.remove()); // прошлый призрак, если не успел уйти

  let ghost = null;
  if (!reduceMotion && box.animate) {
    ghost = document.createElement('div');
    ghost.className = 'swap-ghost';
    ghost.innerHTML = box.innerHTML;
  }
  box.innerHTML = html;
  restartAnim(box, cls);
  if (ghost) {
    box.append(ghost);
    const shift = cls === 'page-next' ? '-40px' : cls === 'page-prev' ? '40px' : '0px';
    const out = ghost.animate(
      [{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: `translateX(${shift})` }],
      { duration: 320, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'forwards' },
    );
    out.onfinish = () => ghost.remove();
  }
  const to = box.offsetHeight;
  if (from === to || reduceMotion || !box.animate) return;

  box.style.overflowY = CLIP_Y;
  const anim = box.animate(
    [{ height: from + 'px' }, { height: to + 'px' }],
    { duration: 500, easing: 'cubic-bezier(.2, .9, .3, 1)' },
  );
  box.heightAnim = anim;
  const done = () => {
    if (box.heightAnim !== anim) return; // уже началась новая анимация
    box.heightAnim = null;
    box.style.overflowY = '';
  };
  anim.finished.then(done, done);
}

// Мягко меняет текст: старый исчезает, новый проявляется с лёгким размытием (класс .swap)
function setText(el, text) {
  if (!el || el.textContent === String(text)) return;
  el.textContent = text;
  el.classList.remove('swap');
  void el.offsetWidth; // перезапуск анимации
  el.classList.add('swap');
}

// Плавно показывает или прячет блок: растёт или сворачивается по высоте и проявляется или гаснет,
// поэтому то, что ниже, съезжает мягко, а не скачком. delay — пауза перед началом
function revealBlock(el, show, delay = 0) {
  clearTimeout(el.revealTimer);
  el.revealTimer = setTimeout(() => {
    const visible = !el.classList.contains('hidden');
    if (visible === show) return;
    if (el.revealAnim) el.revealAnim.cancel();
    if (reduceMotion || !el.animate) {
      el.classList.toggle('hidden', !show);
      return;
    }
    if (show) el.classList.remove('hidden');
    const height = `${el.offsetHeight}px`;
    const margin = window.getComputedStyle ? window.getComputedStyle(el).marginTop : '0px';
    const open = { height, marginTop: margin, opacity: 1, transform: 'none' };
    const closed = { height: '0px', marginTop: '0px', opacity: 0, transform: 'scale(0.96)' };
    el.style.overflow = 'hidden';
    const anim = el.animate(show ? [closed, open] : [open, closed], {
      duration: show ? 480 : 340,
      easing: show ? 'cubic-bezier(.2, .9, .3, 1)' : 'cubic-bezier(.4, 0, .2, 1)',
    });
    el.revealAnim = anim;
    anim.onfinish = () => {
      el.revealAnim = null;
      el.style.overflow = '';
      if (!show) el.classList.add('hidden');
    };
  }, delay);
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
//   required — пустым быть нельзя (вернём прежнее),
//   valid(value) / invalidText — проверка (например, сумма); пока набираешь, неготовое значение пропускаем

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
  const empty = !value && editor.required;
  const invalid = value && editor.valid && !editor.valid(value);
  if (empty || invalid) {
    // Пока печатаешь — ждём; ушёл с поля — возвращаем прежнее значение
    if (final) {
      el.value = editor.get(id);
      autoGrow(el);
      toast(empty ? 'Пустым оставить нельзя — вернул прежнее' : editor.invalidText);
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

// Сохранить всё недописанное — перед переходами. Уход с поля сам сохраняет текст
// (и добавляет недописанный пункт списка), а оставшиеся отложенные правки дописываем
function flushAllEdits() {
  const active = document.activeElement;
  if (isTyping(active)) active.blur();
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
// Поля, при которых показываем «Готово»: правка на месте и быстрое добавление пунктов
function isTyping(el) {
  return Boolean(el && el.classList && (el.classList.contains('inline-edit') || el.classList.contains('quick-add')));
}

document.addEventListener('focusout', (e) => {
  if (!isTyping(e.target)) return;
  if (e.target.classList.contains('inline-edit')) flushEdit(e.target, true);
  // Прячем «Готово» с задержкой: если фокус перешёл в соседнее поле, кнопка останется
  doneTimer = setTimeout(() => doneBtn.classList.remove('show'), 150);
});

// Кнопка «Готово»: сохранить и спрятать клавиатуру. Пока правишь — висит в правом верхнем углу
const doneBtn = document.getElementById('done-btn');
let doneTimer;

// Держим кнопку в видимой части экрана: на iPhone с клавиатурой страница может сдвигаться вверх
function placeDoneBtn() {
  const vv = window.visualViewport;
  doneBtn.style.top = `${(vv ? vv.offsetTop : 0) + 12}px`;
}
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', placeDoneBtn);
  window.visualViewport.addEventListener('scroll', placeDoneBtn);
}

document.addEventListener('focusin', (e) => {
  if (!isTyping(e.target)) return;
  clearTimeout(doneTimer);
  placeDoneBtn();
  doneBtn.classList.add('show');
});
// Нажатие не забирает фокус у поля — иначе кнопка начала бы исчезать прямо под пальцем
doneBtn.addEventListener('pointerdown', (e) => e.preventDefault());
doneBtn.addEventListener('click', () => {
  const el = document.activeElement;
  if (!isTyping(el)) return;
  const editing = el.classList.contains('inline-edit');
  el.blur(); // уход с поля сохраняет текст
  softHaptic();
  if (editing) toast('Сохранено');
});
// Enter в однострочном поле (заголовке) убирает клавиатуру
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList.contains('inline-edit') && !e.target.dataset.multiline) {
    e.preventDefault();
    e.target.blur();
  }
});

// HTML поля правки. multiline — многострочное (описание), иначе однострочное (заголовок).
// inputmode: 'decimal' — цифровая клавиатура (для сумм)
function editHtml(type, id, value, { placeholder = '', max = 80, multiline = false, cls = '', inputmode = '' } = {}) {
  return `<textarea class="inline-edit ${cls}" data-edit="${type}" data-id="${id}" rows="1"
    maxlength="${max}" placeholder="${placeholder}"${multiline ? ' data-multiline="1"' : ''}
    ${inputmode ? `inputmode="${inputmode}"` : ''}
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
  if (e.clientX <= EDGE_ZONE && edgeAllowed()) return; // у левого края — это жест «назад», а не свайп строки
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

// ---------- Панель вкладок прячется, пока открыта клавиатура ----------
// Иначе при появлении клавиатуры Telegram уменьшает экран, и панель прыгает на край клавиатуры.
// Причины спрятать: 'sheet' — открыто окно ввода, 'typing' — курсор в каком-то поле.
// Показываем обратно с задержкой — когда клавиатура уже уехала

const tabbarHiders = new Set();
const TABBAR_FALLBACK = 500; // если телефон не сообщил, что клавиатура уехала, — показываем через столько
let tabbarTimer;
let tabbarPending = false;

// Видимая высота экрана; без клавиатуры она максимальная — запоминаем её
function viewHeight() {
  return window.visualViewport ? window.visualViewport.height : window.innerHeight;
}
let fullHeight = viewHeight();

function keyboardGone() {
  return viewHeight() >= fullHeight - 80;
}

function showTabbarNow() {
  clearTimeout(tabbarTimer);
  tabbarPending = false;
  if (!tabbarHiders.size) document.body.classList.remove('no-tabbar');
}

function hideTabbar(reason) {
  clearTimeout(tabbarTimer);
  tabbarPending = false;
  tabbarHiders.add(reason);
  document.body.classList.add('no-tabbar');
}

// Вернуть панель, как только клавиатура уехала (следим за высотой экрана), но не позже TABBAR_FALLBACK
function releaseTabbar(reason) {
  tabbarHiders.delete(reason);
  clearTimeout(tabbarTimer);
  tabbarPending = true;
  // Короткая пауза — вдруг фокус сразу перейдёт в соседнее поле
  setTimeout(() => {
    if (tabbarPending && !tabbarHiders.size && keyboardGone()) showTabbarNow();
  }, 60);
  tabbarTimer = setTimeout(showTabbarNow, TABBAR_FALLBACK);
}

let lastWidth = window.innerWidth;

function onViewportResize() {
  const h = viewHeight();
  // Запоминаем только наибольшую высоту (без клавиатуры). Повернули телефон — запоминаем заново
  if (window.innerWidth !== lastWidth) {
    lastWidth = window.innerWidth;
    fullHeight = h;
  } else if (h > fullHeight) {
    fullHeight = h;
  }
  if (tabbarPending && !tabbarHiders.size && keyboardGone()) showTabbarNow();
  fitSheet();
}
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', onViewportResize);
}
window.addEventListener('resize', onViewportResize);

// Поле, при котором появляется клавиатура (а не выбор файла или даты)
function opensKeyboard(el) {
  return Boolean(el && el.matches && el.matches('textarea, input:not([type="file"]):not([type="date"])'));
}

document.addEventListener('focusin', (e) => {
  if (opensKeyboard(e.target)) hideTabbar('typing');
});
document.addEventListener('focusout', (e) => {
  if (opensKeyboard(e.target)) releaseTabbar('typing');
});

// ---------- Окно ввода ----------

const sheet = document.getElementById('sheet');
const sheetFields = document.getElementById('sheet-fields');
let sheetInputs = [];
let sheetDate = null; // строка «Дата», если она есть в окне
let sheetResolve = null;
let sheetTimer;

// Показывает окно ввода с полями fields: [{ value, placeholder, max, multiline, optional, inputmode, check }].
// inputmode: 'decimal' — цифровая клавиатура; check(value) — вернуть текст ошибки, если значение не подходит.
// date: '2026-10-31' — добавить под полями строку «Дата» с этим днём; выбранный день будет последним в ответе.
// Возвращает массив введённых строк или null при отмене
function ask({ title, fields, date }) {
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
    if (f.inputmode) el.inputMode = f.inputmode;
    el.check = f.check;
    el.addEventListener('keydown', onSheetKey);
    // Однострочное поле растёт по высоте, если текст длинный
    if (!f.multiline) el.addEventListener('input', () => autoGrow(el));
    return el;
  });
  sheetDate = date ? dateField(date) : null;
  sheetFields.replaceChildren(...sheetInputs, ...(sheetDate ? [sheetDate] : []));
  hideTabbar('sheet');
  sheetInputs.forEach((el) => { if (!el.dataset.multiline) autoGrow(el); });
  // Место окна выбираем, пока оно скрыто: оно сразу появляется там, где и останется
  sheetPad = Math.round(fullHeight * 0.12);
  sheet.classList.remove('closing');
  placeSheet();
  void sheet.offsetWidth;
  sheet.classList.add('open');
  focusInPlace(sheetInputs[0]);
  return new Promise((resolve) => {
    sheetResolve = resolve;
    updateBackButton();
  });
}

function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

// Окно ввода стоит над клавиатурой и не двигается вместе с ней. Высота клавиатуры меняется, например
// при переходе от цифр к буквам, поэтому место выбираем сразу с запасом под самую высокую.
// Если окно всё же не поместилось — поднимаем его ровно настолько, насколько нужно, и вниз
// до закрытия не возвращаем; если места совсем мало — делаем ниже многострочное поле
let sheetPad = 0;
const SHEET_GAP = 12;        // зазор до края видимой области
const KEYBOARD_SHARE = 0.5;  // какую часть экрана держим свободной под клавиатуру

function placeSheet() {
  const visible = viewHeight();
  const box = sheet.querySelector('.sheet-box');
  const multi = sheetInputs.find((el) => el.dataset.multiline);
  if (multi) multi.style.maxHeight = '';
  const boxHeight = box.offsetHeight;
  const lowest = Math.min(visible, fullHeight * (1 - KEYBOARD_SHARE)) - SHEET_GAP;
  const overflow = sheetPad + boxHeight - lowest;
  if (overflow > 0) {
    sheetPad = Math.max(SHEET_GAP, sheetPad - overflow);
    const still = sheetPad + boxHeight - lowest;
    if (still > 0 && multi) multi.style.maxHeight = `${Math.max(64, multi.offsetHeight - still)}px`;
  }
  sheet.style.paddingTop = `${sheetPad}px`;
  if (datePopShown) placeDatePop(sheetPad, visible);
}

function fitSheet() {
  if (sheet.classList.contains('open') && !sheet.classList.contains('closing')) placeSheet();
}

// ---------- iPhone не должен двигать страницу, пока открыто окно ввода ----------
// При нажатии на поле iPhone сам прокручивает страницу, чтобы показать его. Окно и так стоит над
// клавиатурой, а эта прокрутка дёргает экран и уводит курсор с поля. Поэтому фокус ставим сами:
// на миг уводим поле далеко вверх, туда прокручивать незачем, и возвращаем до отрисовки кадра
const FOCUS_TRICK = 'translateY(-2000px)';
const TAP_SLOP = 10; // палец сдвинулся дальше — это уже не нажатие, а прокрутка текста в поле
let sheetTap = null;

function focusInPlace(el) {
  el.style.transform = FOCUS_TRICK;
  el.focus({ preventScroll: true });
  el.setSelectionRange(el.value.length, el.value.length);
  requestAnimationFrame(() => { el.style.transform = ''; });
}

sheetFields.addEventListener('touchstart', (e) => {
  const touch = e.touches[0];
  sheetTap = { x: touch.clientX, y: touch.clientY };
}, { passive: true });

sheetFields.addEventListener('touchmove', (e) => {
  const touch = e.touches[0];
  if (sheetTap && Math.hypot(touch.clientX - sheetTap.x, touch.clientY - sheetTap.y) > TAP_SLOP) sheetTap = null;
}, { passive: true });

sheetFields.addEventListener('touchend', (e) => {
  const el = e.target;
  // Нажатие по уже активному полю оставляем телефону: так ставят курсор внутри текста
  if (!sheetTap || !sheetInputs.includes(el) || el === document.activeElement) return;
  e.preventDefault(); // без этого телефон сам поставит фокус и прокрутит страницу
  closeDatePop();
  focusInPlace(el);
});

// Запасной вариант: если страница всё же сдвинулась — сразу возвращаем на место
function holdPage() {
  if (sheetResolve && (window.scrollY || (window.visualViewport && window.visualViewport.offsetTop))) window.scrollTo(0, 0);
}
window.addEventListener('scroll', holdPage);
if (window.visualViewport) window.visualViewport.addEventListener('scroll', holdPage);

// Enter в однострочном поле — к следующему полю или сохранить; Ctrl+Enter — сохранить всегда
function onSheetKey(e) {
  if (e.key !== 'Enter') return;
  const el = e.target;
  const force = e.ctrlKey || e.metaKey;
  if (el.dataset.multiline && !force) return; // обычный перенос строки
  e.preventDefault();
  const next = sheetInputs[sheetInputs.indexOf(el) + 1];
  if (next && !force) focusInPlace(next);
  else saveSheet();
}

function closeSheet(result) {
  closeDatePop();
  sheet.classList.add('closing'); // окно плавно уменьшается и исчезает
  sheetInputs.forEach((el) => el.blur());
  releaseTabbar('sheet');
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
    focusInPlace(missing);
    return;
  }
  // Проверка значений (например, что сумма — это число)
  for (let i = 0; i < sheetInputs.length; i++) {
    const problem = sheetInputs[i].check && values[i] && sheetInputs[i].check(values[i]);
    if (problem) {
      toast(problem);
      focusInPlace(sheetInputs[i]);
      return;
    }
  }
  closeSheet(sheetDate ? [...values, sheetDate.value] : values);
}

document.getElementById('sheet-save').addEventListener('click', saveSheet);
document.getElementById('sheet-cancel').addEventListener('click', () => closeSheet(null));
sheet.addEventListener('click', (e) => {
  // Строка «Дата» открывает и закрывает календарь; нажатие мимо открытого календаря — закрывает его
  if (e.target.closest('.sheet-date')) {
    if (datePopShown) closeDatePop();
    else openDatePop();
  } else if (datePopShown) {
    if (!e.target.closest('.date-pop')) closeDatePop();
  } else if (e.target === sheet) {
    closeSheet(null); // нажатие на затемнённый фон — отмена
  }
});

// ---------- Выбор даты в окне ввода ----------
// Календарь поверх окна. Листается так же, как календарь привычек: стрелками и свайпом.
// Будущие дни недоступны

const datePop = document.getElementById('date-pop');
const DATE_POP_GAP = 8;      // зазор между строкой «Дата» и календарём
const DATE_PICK_PAUSE = 220; // чтобы успеть увидеть выбранный день, прежде чем календарь закроется
let datePopTimer;
let datePopShown = false;

function dateField(key) {
  const el = document.createElement('button');
  el.className = 'sheet-date';
  el.value = key;
  el.innerHTML = `<span>Дата</span><span class="date-pill">${fullDate(key)}</span>`;
  return el;
}

function dateCellsHtml(month, selected) {
  const today = dayKey();
  return monthCellsHtml(month, (d, num, key) => {
    const cls = `${key === selected ? ' done' : ''}${key === today ? ' today' : ''}`;
    return `<button class="cal-day${cls}"${key > today ? ' disabled' : ` data-key="${key}"`}>${d}</button>`;
  });
}

function datePopHtml(src) {
  return `
    <div class="cal-head">
      <span class="cal-title">${monthTitle(shownMonth(src))}</span>
      <span class="date-arrows">
        <button class="pager-btn prev" data-dir="-1">${CHEVRON}</button>
        <button class="pager-btn" data-dir="1"${src.month >= 0 ? ' disabled' : ''}>${CHEVRON}</button>
      </span>
    </div>
    <div class="cal-week">${WEEKDAYS.map((d) => `<span>${d}</span>`).join('')}</div>
    <div class="cal-viewport"><div class="cal-grid">${src.cells(src.month)}</div></div>`;
}

function openDatePop() {
  clearTimeout(datePopTimer);
  sheetInputs.forEach((el) => el.blur()); // клавиатура закрыла бы календарь
  datePop.source = {
    month: monthOffset(sheetDate.value),
    cells: (month) => dateCellsHtml(month, sheetDate.value),
  };
  datePop.innerHTML = datePopHtml(datePop.source);
  datePopShown = true;
  fitSheet();
  void datePop.offsetWidth; // сначала встаём на место, потом проявляемся — иначе календарь прилетел бы сверху
  datePop.classList.add('open');
}

function closeDatePop() {
  clearTimeout(datePopTimer);
  if (!datePopShown) return;
  datePopShown = false;
  calFinishRunning(datePop);
  datePop.classList.remove('open');
}

// Календарь стоит под строкой «Дата», а если не помещается — выше, в пределах видимой области
function placeDatePop(pad, visible) {
  const boxTop = sheet.querySelector('.sheet-box').getBoundingClientRect().top;
  const under = pad + sheetDate.getBoundingClientRect().bottom - boxTop + DATE_POP_GAP;
  const lowest = visible - datePop.offsetHeight - SHEET_GAP;
  datePop.style.top = `${Math.max(SHEET_GAP, Math.min(under, lowest))}px`;
}

datePop.addEventListener('click', (e) => {
  const arrow = e.target.closest('[data-dir]');
  const day = e.target.closest('[data-key]');
  if (arrow) slideCalendar(datePop, Number(arrow.dataset.dir));
  if (!day) return;
  datePop.querySelectorAll('.cal-day.done').forEach((el) => el.classList.remove('done'));
  day.classList.add('done', 'just');
  sheetDate.value = day.dataset.key;
  setText(sheetDate.querySelector('.date-pill'), fullDate(day.dataset.key));
  softHaptic();
  clearTimeout(datePopTimer);
  datePopTimer = setTimeout(closeDatePop, DATE_PICK_PAUSE);
});

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
