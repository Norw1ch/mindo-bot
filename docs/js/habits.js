'use strict';

// Модуль «Привычки»: отметка за день, серия дней подряд, календарь

// ---------- Данные ----------
// habits.items: [{id, name, days, best, old, at}] — пачками в ключах habits_0, habits_1, …
//   days — отмеченные дни числами (dayNum), только за последние KEEP_DAYS дней;
//   old — сколько отметок было раньше (уже не храним по дням), best — лучшая серия из старых дней

const habits = makeBucket('habits_');
const HABIT_NAME_MAX = 40;
const KEEP_DAYS = 400;
const MILESTONES = [3, 7, 14, 30, 50, 100, 365];

modules.habits = { load: (raw) => habits.load(raw) };

function isDone(h, num) {
  return h.days.includes(num);
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

// Текущая серия: дни подряд до сегодня. Если сегодня ещё не отмечено, серия жива со вчерашнего дня
function streak(h) {
  const set = new Set(h.days);
  let d = dayNum();
  if (!set.has(d)) d -= 1;
  let n = 0;
  while (set.has(d)) {
    n += 1;
    d -= 1;
  }
  return n;
}

function bestStreak(h) {
  let best = h.best || 0;
  let run = 0;
  let prev = null;
  for (const d of h.days) {
    run = prev !== null && d === prev + 1 ? run + 1 : 1;
    prev = d;
    best = Math.max(best, run);
  }
  return best;
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

// «Сегодня: 2 из 5»
function habitsSummary() {
  const today = dayNum();
  const done = habits.items.filter((h) => isDone(h, today)).length;
  return habits.items.length ? `Сегодня: ${done} из ${habits.items.length}` : 'Привычек пока нет';
}

// Название, 7 точек за неделю (сегодня — последняя) и серия
function habitInfoHtml(h) {
  const today = dayNum();
  const dots = Array.from({ length: 7 }, (_, i) => {
    const d = today - 6 + i;
    return `<span class="dot${isDone(h, d) ? ' on' : ''}${d === today ? ' today' : ''}"></span>`;
  }).join('');
  const s = streak(h);
  return `
    <span class="habit-name">${esc(h.name)}</span>
    <span class="habit-meta"><span class="dots">${dots}</span>${s ? `серия ${s} дн.` : ''}</span>`;
}

function habitRowHtml(h, n) {
  const done = isDone(h, dayNum());
  return `
    <div class="swipe${takeFlash(h.id) ? ' appear' : ''}" style="--i:${n}">
      <button class="swipe-del" data-act="swipe-delete" data-kind="habit" data-id="${h.id}">Удалить</button>
      <div class="row habit-row">
        <button class="habit-open" data-act="open-habit" data-id="${h.id}">${habitInfoHtml(h)}</button>
        <button class="habit-check${done ? ' checked' : ''}" data-act="toggle-habit-today" data-id="${h.id}">${CHECK}</button>
      </div>
    </div>`;
}

function statsHtml(h) {
  return `
    <div class="stat"><b>${streak(h)}</b><span>Серия</span></div>
    <div class="stat"><b>${bestStreak(h)}</b><span>Лучшая</span></div>
    <div class="stat"><b>${totalDone(h)}</b><span>Всего</span></div>`;
}

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

// Календарь месяца: route.month — сдвиг от текущего месяца (0 — этот, -1 — прошлый)
function calendarHtml(h, route) {
  const now = new Date();
  const shown = new Date(now.getFullYear(), now.getMonth() + (route.month || 0), 1);
  const y = shown.getFullYear();
  const m = shown.getMonth();
  const today = dayNum();
  const offset = (shown.getDay() + 6) % 7; // с понедельника
  const daysIn = new Date(y, m + 1, 0).getDate();
  let title = shown.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(' г.', '');
  title = title[0].toUpperCase() + title.slice(1);

  const cells = [];
  for (let i = 0; i < offset; i++) cells.push('<span></span>');
  for (let d = 1; d <= daysIn; d++) {
    const num = Date.UTC(y, m, d) / 864e5;
    const cls = `${isDone(h, num) ? ' done' : ''}${num === today ? ' today' : ''}`;
    cells.push(`<button class="cal-day${cls}" data-act="toggle-habit-day" data-id="${h.id}" data-day="${num}"${num > today ? ' disabled' : ''}>${d}</button>`);
  }
  return `
    <div class="page-items">
      <div class="cal-head">
        <button class="pager-btn prev" data-act="habit-month" data-dir="-1">${CHEVRON}</button>
        <span class="cal-title">${title}</span>
        <button class="pager-btn" data-act="habit-month" data-dir="1"${(route.month || 0) >= 0 ? ' disabled' : ''}>${CHEVRON}</button>
      </div>
      <div class="cal-week">${WEEKDAYS.map((d) => `<span>${d}</span>`).join('')}</div>
      <div class="cal-grid">${cells.join('')}</div>
    </div>`;
}

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
    <div class="cal paged">${calendarHtml(h, route)}</div>
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
  if (isDone(h, dayNum()) && MILESTONES.includes(s)) toast(`Серия ${daysWord(s)} подряд!`);
}

Object.assign(actions, {
  'new-habit': async () => {
    const res = await ask({ title: 'Новая привычка', fields: [{ placeholder: 'Например, «Зарядка»', max: HABIT_NAME_MAX }] });
    if (!res) return;
    const habit = { id: newId(), name: res[0], days: [], best: 0, old: 0, at: Date.now() };
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
    el.closest('.row').querySelector('.habit-open').innerHTML = habitInfoHtml(h);
    el.closest('.screen-inner').querySelector('.habits-sub').textContent = habitsSummary();
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
    el.closest('.screen-inner').querySelector('.stats').innerHTML = statsHtml(h);
    const ok = await commit(() => habits.save(), () => {});
    if (!ok) refresh();
    else if (Number(day) === dayNum()) cheer(h);
  },

  // Листание месяцев: новый месяц въезжает справа или слева
  'habit-month': ({ dir }, el) => {
    const route = currentRoute();
    route.month = (route.month || 0) + Number(dir);
    const box = el.closest('.cal');
    swapContent(box, calendarHtml(habits.find(route.id), route), Number(dir) > 0 ? 'page-next' : 'page-prev');
    softHaptic();
  },

  'delete-habit': async ({ id }) => {
    if (!(await confirmDeleteHabit(id))) return;
    await commit(() => deleteHabitData(id), back);
  },
});
