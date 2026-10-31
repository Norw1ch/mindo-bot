'use strict';

// Модуль «Привычки»: отметка за день, серия дней подряд, календарь

// ---------- Данные ----------
// habits.items: [{id, name, days, wd, best, old, at}] — пачками в ключах habits_0, habits_1, …
//   days — отмеченные дни числами (dayNum), только за последние KEEP_DAYS дней;
//   wd — дни недели по графику (0 — пн … 6 — вс) или пусто, если каждый день;
//   old — сколько отметок было раньше (уже не храним по дням), best — лучшая серия из старых дней

const habits = makeBucket('habits_');
const HABIT_NAME_MAX = 40;
const KEEP_DAYS = 400;
const MILESTONES = [3, 7, 14, 30, 50, 100, 365];

modules.habits = { load: (raw) => habits.load(raw) };

function isDone(h, num) {
  return h.days.includes(num);
}

// День недели дня-числа: 0 — понедельник … 6 — воскресенье
function weekdayOf(num) {
  return (new Date(num * 864e5).getUTCDay() + 6) % 7;
}

// Нужно ли выполнять привычку в этот день по графику
function isScheduled(h, num) {
  return !h.wd || h.wd.includes(weekdayOf(num));
}

// Отметить или снять день. Слишком старые дни сворачиваем в счётчики, чтобы запись не росла бесконечно
function toggleDay(h, num) {
  const i = h.days.indexOf(num);
  if (i >= 0) h.days.splice(i, 1);
  else h.days.push(num);
  h.days.sort((a, b) => a - b);
  const min = dayNum() - KEEP_DAYS;
  const old = h.days.filter((d) => d < min);
  if (old.length) {
    h.best = bestStreak(h);
    h.old = (h.old || 0) + old.length;
    h.days = h.days.filter((d) => d >= min);
  }
}

// Текущая серия: выполненные дни по графику подряд, считая назад от сегодня.
// Дни вне графика пропускаем — они серию не сбивают. Сегодня ещё не отмечено — серия жива до вечера
function streak(h) {
  const set = new Set(h.days);
  const today = dayNum();
  let n = 0;
  for (let d = today; d > today - KEEP_DAYS; d--) {
    if (!isScheduled(h, d)) continue;
    if (set.has(d)) n += 1;
    else if (d !== today) break;
  }
  return n;
}

// Лучшая серия по тем же правилам (и с учётом серий из уже свёрнутой истории)
function bestStreak(h) {
  let best = h.best || 0;
  if (!h.days.length) return best;
  const set = new Set(h.days);
  const today = dayNum();
  let run = 0;
  for (let d = h.days[0]; d <= today; d++) {
    if (!isScheduled(h, d)) continue;
    if (set.has(d)) {
      run += 1;
      best = Math.max(best, run);
    } else if (d !== today) {
      run = 0;
    }
  }
  return best;
}

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

// «Каждый день», «По будням», «По выходным» или «Пн, Ср, Пт»
function scheduleLabel(wd) {
  if (!wd) return 'Каждый день';
  const key = wd.join();
  if (key === '0,1,2,3,4') return 'По будням';
  if (key === '5,6') return 'По выходным';
  return wd.map((i) => WEEKDAYS[i]).join(', ');
}

// Серия: для ежедневных — «5 дн.», для привычек по графику — просто «5» (это разы, а не дни)
function streakText(h, n) {
  return h.wd ? `${n}` : `${n} дн.`;
}

function totalDone(h) {
  return h.days.length + (h.old || 0);
}

function confirmDeleteHabit(id) {
  return confirmDialog(`Удалить привычку «${shorten(habits.find(id).name, 40)}»?`);
}

function deleteHabitData(id) {
  habits.items = habits.items.filter((h) => h.id !== id);
  return habits.save();
}

deleters.habit = { confirm: confirmDeleteHabit, remove: deleteHabitData };

// ---------- Отображение ----------

function daysWord(n) {
  return plural(n, ['день', 'дня', 'дней']);
}

// Привычки, запланированные на сегодня: сколько выполнено и сколько всего
function habitsToday() {
  const today = dayNum();
  const planned = habits.items.filter((h) => isScheduled(h, today));
  return { done: planned.filter((h) => isDone(h, today)).length, total: planned.length };
}

// «Сегодня: 2 из 5»
function habitsSummary() {
  if (!habits.items.length) return 'Привычек пока нет';
  const { done, total } = habitsToday();
  if (!total) return 'Сегодня по графику ничего';
  return `Сегодня: ${done} из ${total}`;
}

// Подпись под названием: график и серия — «Пн, Ср, Пт · серия 3»
function habitInfoText(h) {
  const s = streak(h);
  return [h.wd ? scheduleLabel(h.wd) : '', s ? `серия ${streakText(h, s)}` : ''].filter(Boolean).join(' · ');
}

// Название, 7 точек за неделю (сегодня — последняя; дни вне графика бледнее), график и серия
function habitInfoHtml(h) {
  const today = dayNum();
  const dots = Array.from({ length: 7 }, (_, i) => {
    const d = today - 6 + i;
    const cls = `${isDone(h, d) ? ' on' : ''}${d === today ? ' today' : ''}${isScheduled(h, d) ? '' : ' off'}`;
    return `<span class="dot${cls}"></span>`;
  }).join('');
  return `
    <span class="habit-name">${esc(h.name)}</span>
    <span class="habit-meta"><span class="dots">${dots}</span><span class="habit-info">${habitInfoText(h)}</span></span>`;
}

// Обновить строку привычки на месте: точки плавно заливаются, подпись мягко меняется
function updateHabitRow(row, h) {
  const today = dayNum();
  row.querySelectorAll('.dot').forEach((dot, i) => dot.classList.toggle('on', isDone(h, today - 6 + i)));
  setText(row.querySelector('.habit-info'), habitInfoText(h));
}

function habitRowHtml(h, n) {
  const today = dayNum();
  const done = isDone(h, today);
  // Сегодня не по графику — строка приглушена (отметить всё равно можно)
  const rest = isScheduled(h, today) ? '' : ' rest';
  return `
    <div class="swipe${takeFlash(h.id) ? ' appear' : ''}" style="--i:${n}">
      <button class="swipe-del" data-act="swipe-delete" data-kind="habit" data-id="${h.id}">Удалить</button>
      <div class="row habit-row${rest}">
        <button class="habit-open" data-act="open-habit" data-id="${h.id}">${habitInfoHtml(h)}</button>
        <button class="habit-check${done ? ' checked' : ''}" data-act="toggle-habit-today" data-id="${h.id}">${CHECK}</button>
      </div>
    </div>`;
}

function statsHtml(h) {
  return `
    <div class="stat"><b data-stat="streak">${streak(h)}</b><span>Серия</span></div>
    <div class="stat"><b data-stat="best">${bestStreak(h)}</b><span>Лучшая</span></div>
    <div class="stat"><b data-stat="total">${totalDone(h)}</b><span>Всего</span></div>`;
}

// Цифры статистики меняются мягко, только те, что изменились
function updateStats(inner, h) {
  const values = { streak: streak(h), best: bestStreak(h), total: totalDone(h) };
  inner.querySelectorAll('[data-stat]').forEach((b) => setText(b, values[b.dataset.stat]));
}

// Календарь месяца: route.month — сдвиг от текущего месяца (0 — этот, -1 — прошлый)
function shownMonth(route) {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + (route.month || 0), 1);
}

// Числа месяца (сетка Пн–Вс). Всегда 6 недель (42 клетки) — высота календаря не меняется.
// month — сдвиг от текущего месяца; dayHtml(d, num, key) рисует кнопку дня
function monthCellsHtml(month, dayHtml) {
  const shown = shownMonth({ month });
  const y = shown.getFullYear();
  const m = shown.getMonth();
  const offset = (shown.getDay() + 6) % 7; // с понедельника
  const daysIn = new Date(y, m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < offset; i++) cells.push('<span></span>');
  for (let d = 1; d <= daysIn; d++) cells.push(dayHtml(d, Date.UTC(y, m, d) / 864e5, dayKey(new Date(y, m, d))));
  while (cells.length < 42) cells.push('<span class="cal-pad"></span>');
  return cells.join('');
}

function calCellsHtml(h, route) {
  const today = dayNum();
  return monthCellsHtml(route.month, (d, num) => {
    const cls = `${isDone(h, num) ? ' done' : ''}${num === today ? ' today' : ''}${isScheduled(h, num) ? '' : ' off'}`;
    return `<button class="cal-day${cls}" data-act="toggle-habit-day" data-id="${h.id}" data-day="${num}"${num > today ? ' disabled' : ''}>${d}</button>`;
  });
}

// Заголовок со стрелками и дни недели стоят на месте, перелистывается только сетка чисел
function calendarHtml(h, route) {
  return `
    <div class="cal-head">
      <button class="pager-btn prev" data-act="habit-month" data-dir="-1">${CHEVRON}</button>
      <span class="cal-title">${monthTitle(shownMonth(route))}</span>
      <button class="pager-btn" data-act="habit-month" data-dir="1"${(route.month || 0) >= 0 ? ' disabled' : ''}>${CHEVRON}</button>
    </div>
    <div class="cal-week">${WEEKDAYS.map((d) => `<span>${d}</span>`).join('')}</div>
    <div class="cal-viewport"><div class="cal-grid">${calCellsHtml(h, route)}</div></div>`;
}

// ---------- Перелистывание месяцев: стрелками и свайпом ----------
// Двигаются только сетки чисел (сдвиг — самая плавная анимация для телефона), высота не меняется.
// Свайп: сетка едет за пальцем, соседний месяц выглядывает с края. Отпустил дальше четверти ширины
// или смахнул быстро — перелистнулось, иначе мягко вернулось. В будущее не листается — только «резинка»

const CAL_MS = 520;
const CAL_EASE = 'cubic-bezier(.25, .8, .25, 1)';
const CAL_COMPLETE = 0.25; // какую долю ширины протянуть, чтобы перелистнуть
const CAL_FLICK = 0.4;     // скорость (пикселей в мс) короткого смахивания

// Откуда календарь берёт месяц и числа. Календарь выбора даты задаёт свой источник в cal.source,
// иначе это календарь привычки на текущем экране
const habitCalSource = {
  get month() { return currentRoute().month || 0; },
  set month(value) { currentRoute().month = value; },
  cells: (month) => calCellsHtml(habits.find(currentRoute().id), { month }),
};

function calSource(cal) {
  return cal.source || habitCalSource;
}

function canGo(month, dir) {
  return dir < 0 || month + dir <= 0;
}

// Начать перелистывание в сторону dir (1 — следующий месяц, -1 — прошлый): соседняя сетка встаёт рядом
function calPeek(cal, dir) {
  const src = calSource(cal);
  const viewport = cal.querySelector('.cal-viewport');
  const p = { cal, dir, viewport, old: viewport.querySelector('.cal-grid'), fresh: null, width: viewport.offsetWidth || 320 };
  if (canGo(src.month, dir)) {
    p.fresh = document.createElement('div');
    p.fresh.className = 'cal-grid sliding';
    p.fresh.innerHTML = src.cells(src.month + dir);
    p.fresh.style.transform = `translateX(${dir > 0 ? 100 : -100}%)`;
    viewport.append(p.fresh);
  }
  cal.pager = p;
  return p;
}

// Сдвинуть обе сетки на dx пикселей (во время свайпа)
function calMove(p, dx) {
  p.old.style.transform = `translateX(${dx}px)`;
  if (p.fresh) p.fresh.style.transform = `translateX(calc(${p.dir > 0 ? 100 : -100}% + ${dx}px))`;
}

// Довести перелистывание до конца (complete) или вернуть на место; duration — сколько осталось ехать
function calSettle(p, complete, duration = CAL_MS) {
  const go = complete && p.fresh;
  const opts = { duration, easing: CAL_EASE, fill: 'forwards' };
  const anims = reduceMotion || !p.old.animate ? [] : [
    p.old.animate([{ transform: p.old.style.transform || 'translateX(0)' },
      { transform: go ? `translateX(${p.dir > 0 ? -100 : 100}%)` : 'translateX(0)' }], opts),
    p.fresh && p.fresh.animate([{ transform: p.fresh.style.transform },
      { transform: go ? 'translateX(0)' : `translateX(${p.dir > 0 ? 100 : -100}%)` }], opts),
  ].filter(Boolean);

  if (go) {
    // Месяц сменился — заголовок и стрелку обновляем сразу, мягким проявлением (без размытия)
    const src = calSource(p.cal);
    src.month += p.dir;
    const title = p.cal.querySelector('.cal-title');
    title.textContent = monthTitle(shownMonth(src));
    if (title.animate && !reduceMotion) title.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 300, easing: 'ease-out' });
    p.cal.querySelector('[data-dir="1"]').disabled = src.month >= 0;
    softHaptic();
  }

  p.finish = () => {
    if (p.cal.pager !== p) return;
    p.cal.pager = null;
    if (go) {
      p.old.remove();
      p.fresh.classList.remove('sliding');
      p.fresh.style.transform = '';
    } else {
      if (p.fresh) p.fresh.remove();
      p.old.style.transform = '';
    }
    anims.forEach((a) => a.cancel());
  };
  if (anims.length) anims[0].onfinish = p.finish;
  else p.finish();
}

// Прошлое перелистывание ещё идёт — завершаем его сразу, чтобы не было каши
function calFinishRunning(cal) {
  if (cal.pager && cal.pager.finish) cal.pager.finish();
  else if (cal.pager) cal.pager = null;
}

// Стрелки ‹ ›
function slideCalendar(cal, dir) {
  calFinishRunning(cal);
  if (!canGo(calSource(cal).month, dir)) return;
  calSettle(calPeek(cal, dir), true);
}

// Свайп по календарю
let calDrag = null;

document.addEventListener('touchstart', (e) => {
  const viewport = e.target && e.target.closest ? e.target.closest('.cal-viewport') : null;
  if (!viewport || e.touches.length !== 1 || busy) return;
  const touch = e.touches[0];
  if (touch.clientX <= EDGE_ZONE) return; // у самого края — это жест «назад»
  calDrag = {
    cal: viewport.closest('.cal'), x0: touch.clientX, y0: touch.clientY,
    lastX: touch.clientX, lastT: e.timeStamp, v: 0, dx: 0, p: null,
  };
}, { passive: true });

document.addEventListener('touchmove', (e) => {
  if (!calDrag) return;
  const touch = e.touches[0];
  const dx = touch.clientX - calDrag.x0;
  const dy = touch.clientY - calDrag.y0;
  if (!calDrag.p) {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    if (Math.abs(dy) > Math.abs(dx)) { // вверх-вниз — это прокрутка экрана
      calDrag = null;
      return;
    }
    calFinishRunning(calDrag.cal);
  }
  e.preventDefault();
  // Тянем влево — следующий месяц, вправо — прошлый. Сменил направление — сосед меняется
  const dir = dx < 0 ? 1 : -1;
  if (!calDrag.p || calDrag.p.dir !== dir) {
    if (calDrag.p && calDrag.p.fresh) calDrag.p.fresh.remove();
    calDrag.p = calPeek(calDrag.cal, dir);
  }
  calDrag.v = (touch.clientX - calDrag.lastX) / Math.max(1, e.timeStamp - calDrag.lastT);
  calDrag.lastX = touch.clientX;
  calDrag.lastT = e.timeStamp;
  // В будущее нельзя — сетка тянется туго, как резинка
  calDrag.dx = calDrag.p.fresh ? dx : dx / 4;
  calMove(calDrag.p, calDrag.dx);
}, { passive: false });

function endCalDrag() {
  if (!calDrag) return;
  const d = calDrag;
  calDrag = null;
  if (!d.p) return;
  const share = Math.abs(d.dx) / d.p.width;
  const flick = Math.abs(d.v) > CAL_FLICK && Math.sign(d.v) === Math.sign(d.dx);
  const complete = Boolean(d.p.fresh) && (share > CAL_COMPLETE || flick);
  // Доезжаем оставшееся расстояние: чем меньше осталось, тем быстрее
  const rest = complete ? 1 - Math.min(1, share) : Math.min(1, share);
  calSettle(d.p, complete, Math.max(220, CAL_MS * rest));
}

document.addEventListener('touchend', endCalDrag);
document.addEventListener('touchcancel', endCalDrag);

// ---------- Экраны ----------

views.habits = () => {
  const rows = [...habits.items].sort((a, b) => a.at - b.at).map(habitRowHtml).join('');
  return `
    <h1>Привычки</h1>
    <p class="sub habits-sub">${habitsSummary()}</p>
    <div class="actions">
      <button class="btn primary" data-act="new-habit">➕ Новая привычка</button>
    </div>
    ${rows ? `<div class="group">${rows}</div>` : ''}`;
};

views.habit = (route) => {
  const h = habits.find(route.id);
  if (!h) return '<p class="empty">Привычка не найдена</p>';
  return `
    <h1>${editHtml('habit-name', h.id, h.name, { placeholder: 'Название', max: HABIT_NAME_MAX })}</h1>
    <p class="sub">С ${formatDate(h.at)}</p>
    <div class="stats">${statsHtml(h)}</div>
    <div class="cal">${calendarHtml(h, route)}</div>
    <div class="group">
      <button class="row" data-act="habit-days" data-id="${h.id}">
        <span class="title">Дни</span>
        <span class="meta${takeFlash('wd:' + h.id) ? ' swap' : ''}">${scheduleLabel(h.wd)}</span>
        ${CHEVRON}
      </button>
    </div>
    <div class="group">
      <button class="row danger" data-act="delete-habit" data-id="${h.id}">Удалить привычку</button>
    </div>`;
};

editors['habit-name'] = {
  required: true,
  get: (id) => habits.find(id).name,
  save: (id, value) => {
    habits.find(id).name = value;
    return habits.save();
  },
};

// ---------- Действия ----------

// Поздравление на круглых сериях
function cheer(h) {
  const s = streak(h);
  if (!isDone(h, dayNum()) || !MILESTONES.includes(s)) return;
  toast(`Серия ${h.wd ? plural(s, ['раз', 'раза', 'раз']) : daysWord(s)} подряд!`);
}

// Выбор дней недели в меню снизу: кружки Пн–Вс, «Каждый день» и «Готово».
// Возвращает null — каждый день, массив дней — по графику, undefined — отмена
async function pickDays(current) {
  const chosen = new Set(current || [0, 1, 2, 3, 4, 5, 6]);
  const result = choose({ title: 'В какие дни', options: [{ key: 'ok', label: 'Готово' }] });
  const chips = WEEKDAYS.map((d, i) => `<button class="day-chip${chosen.has(i) ? ' on' : ''}" data-wd="${i}">${d}</button>`).join('');
  document.getElementById('choice-opts').insertAdjacentHTML('afterbegin', `
    <div class="day-pick">
      <div class="day-chips">${chips}</div>
      <button class="day-all">Каждый день</button>
    </div>`);
  if ((await result) !== 'ok') return undefined;
  const wd = [...document.querySelectorAll('.day-chip.on')].map((b) => Number(b.dataset.wd));
  return wd.length === 7 ? null : wd;
}

// Нажатия внутри выбора дней: включить/выключить день (хотя бы один остаётся), «Каждый день» — все
document.addEventListener('click', (e) => {
  const chip = e.target.closest('.day-chip');
  if (chip) {
    const on = document.querySelectorAll('.day-chip.on').length;
    if (chip.classList.contains('on') && on === 1) return; // последний день не выключаем
    chip.classList.toggle('on');
    softHaptic();
  } else if (e.target.closest('.day-all')) {
    document.querySelectorAll('.day-chip').forEach((b) => b.classList.add('on'));
    softHaptic();
  }
});

Object.assign(actions, {
  'new-habit': async () => {
    const res = await ask({ title: 'Новая привычка', fields: [{ placeholder: 'Например, «Зарядка»', max: HABIT_NAME_MAX }] });
    if (!res) return;
    // Сразу спрашиваем дни; «Отмена» здесь — значит каждый день
    const wd = await pickDays(null);
    const habit = { id: newId(), name: res[0], days: [], wd: wd || null, best: 0, old: 0, at: Date.now() };
    flash = habit.id;
    await commit(() => {
      habits.items.push(habit);
      return habits.save();
    });
  },

  'open-habit': ({ id }) => go({ name: 'habit', id }),

  // Кружок в строке: отметить сегодня, не перерисовывая экран
  'toggle-habit-today': async ({ id }, el) => {
    const h = habits.find(id);
    toggleDay(h, dayNum());
    const done = isDone(h, dayNum());
    el.classList.add('just');
    el.classList.toggle('checked', done);
    updateHabitRow(el.closest('.row'), h);
    setText(el.closest('.screen-inner').querySelector('.habits-sub'), habitsSummary());
    const ok = await commit(() => habits.save(), () => {});
    if (!ok) refresh();
    else cheer(h);
  },

  // День в календаре: отметить или снять (можно и прошлые — если забыл)
  'toggle-habit-day': async ({ id, day }, el) => {
    const h = habits.find(id);
    toggleDay(h, Number(day));
    el.classList.add('just');
    el.classList.toggle('done', isDone(h, Number(day)));
    updateStats(el.closest('.screen-inner'), h);
    const ok = await commit(() => habits.save(), () => {});
    if (!ok) refresh();
    else if (Number(day) === dayNum()) cheer(h);
  },

  // Стрелки ‹ ›: старый месяц уезжает в сторону, новый въезжает с другой
  'habit-month': ({ dir }, el) => slideCalendar(el.closest('.cal'), Number(dir)),

  // Поменять график: каждый день или выбранные дни недели
  'habit-days': async ({ id }) => {
    const h = habits.find(id);
    const wd = await pickDays(h.wd);
    if (wd === undefined || (wd || []).join() === (h.wd || []).join()) return;
    flash = 'wd:' + id;
    await commit(() => {
      h.wd = wd;
      return habits.save();
    });
  },

  'delete-habit': async ({ id }) => {
    if (!(await confirmDeleteHabit(id))) return;
    await commit(() => deleteHabitData(id), back);
  },
});
