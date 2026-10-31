'use strict';

// Модуль «Расходы»: траты по категориям, итог месяца, свои категории. Валюта — гривна

// ---------- Данные ----------
// mcats: [{id, name}] — категории, в ключе "mcats" (пока не менялись — берутся стандартные)
// expenses.items: [{id, a, c, t, n}] — пачками в ключах exp_0, exp_1, …
//   a — сумма в копейках (целое число, чтобы не было ошибок округления), c — id категории,
//   t — когда (время в мс), n — комментарий

const CURRENCY = '₴';
const DEFAULT_CATS = [
  { id: 'food', name: 'Продукты' },
  { id: 'cafe', name: 'Кафе' },
  { id: 'transport', name: 'Транспорт' },
  { id: 'health', name: 'Здоровье' },
  { id: 'clothes', name: 'Одежда' },
  { id: 'fun', name: 'Развлечения' },
  { id: 'subs', name: 'Подписки' },
  { id: 'other', name: 'Другое' },
];
const OTHER = 'other'; // «Другое» удалить нельзя — туда уходят расходы удалённых категорий
const CAT_NAME_MAX = 30;
const NOTE_MAX = 100;

let mcats = [];
const expenses = makeBucket('exp_');

modules.money = {
  load(raw) {
    mcats = parse(raw.mcats) || DEFAULT_CATS.map((c) => ({ ...c }));
    expenses.load(raw);
  },
};

function saveCats() {
  return store.set('mcats', JSON.stringify(mcats));
}

function findCat(id) {
  return mcats.find((c) => c.id === id) || mcats.find((c) => c.id === OTHER) || { id: OTHER, name: 'Другое' };
}

// «250», «99,50», «1 250.5» → копейки. Неверное — 0
function parseAmount(text) {
  const clean = String(text).replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return 0;
  const kop = Math.round(Number(clean) * 100);
  return kop > 0 && kop < 1e11 ? kop : 0;
}

function checkAmount(text) {
  return parseAmount(text) ? null : 'Введите сумму, например 250 или 99,50';
}

// 125050 → «1 250,50 ₴»
function formatMoney(kop) {
  const text = (kop / 100).toLocaleString('ru-RU', {
    minimumFractionDigits: kop % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return `${text} ${CURRENCY}`;
}

// Сумма для правки: «1250,5»
function amountText(kop) {
  return String(kop / 100).replace('.', ',');
}

// Границы месяца: offset — сдвиг от текущего (0 — этот, -1 — прошлый)
function monthRange(offset = 0) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1);
  return { start: start.getTime(), end: end.getTime(), title: monthTitle(start) };
}

// Расходы месяца (и категории, если задана), свежие сверху
function monthExpenses(offset, catId) {
  const { start, end } = monthRange(offset);
  return expenses.items
    .filter((e) => e.t >= start && e.t < end && (!catId || findCat(e.c).id === catId))
    .sort((a, b) => b.t - a.t);
}

function sum(list) {
  return list.reduce((s, e) => s + e.a, 0);
}

function confirmDeleteExpense(id) {
  const e = expenses.find(id);
  return confirmDialog(`Удалить расход ${formatMoney(e.a)} (${findCat(e.c).name})?`);
}

function deleteExpenseData(id) {
  flash = 'total'; // итог месяца сменится мягко
  expenses.items = expenses.items.filter((e) => e.id !== id);
  return expenses.save();
}

function confirmDeleteCat(id) {
  const used = expenses.items.filter((e) => e.c === id).length;
  const extra = used ? `\nРасходы из неё (${used}) перейдут в «Другое».` : '';
  return confirmDialog(`Удалить категорию «${findCat(id).name}»?${extra}`);
}

// Удалить категорию: её расходы переносим в «Другое»
async function deleteCatData(id) {
  const moved = expenses.items.filter((e) => e.c === id);
  moved.forEach((e) => { e.c = OTHER; });
  mcats = mcats.filter((c) => c.id !== id);
  if (moved.length) await expenses.save();
  await saveCats();
}

deleters.expense = { confirm: confirmDeleteExpense, remove: deleteExpenseData };
deleters.mcat = { confirm: confirmDeleteCat, remove: deleteCatData };

// ---------- Отображение ----------

// Серый кружок с первой буквой — вместо цветных значков
function avatar(name) {
  return `<span class="avatar">${esc(name.trim()[0] || '·').toUpperCase()}</span>`;
}

function expenseRowHtml(e, n) {
  const cat = findCat(e.c);
  return `
    <div class="swipe${takeFlash(e.id) ? ' appear' : ''}" style="--i:${n}">
      <button class="swipe-del" data-act="swipe-delete" data-kind="expense" data-id="${e.id}">Удалить</button>
      <button class="row" data-act="open-expense" data-id="${e.id}">
        ${avatar(cat.name)}
        <span class="title-wrap">
          <span class="title">${esc(cat.name)}</span>
          ${e.n ? `<span class="subtitle">${esc(e.n)}</span>` : ''}
        </span>
        <span class="meta amount">${formatMoney(e.a)}</span>
      </button>
    </div>`;
}

// Расходы по дням с листанием. route.catId — только одна категория
function expenseListHtml(route) {
  const list = monthExpenses(route.month || 0, route.catId);
  if (!list.length) return '<p class="empty small">Расходов пока нет</p>';
  return groupedPage(list, route, (e) => {
    const key = dayKey(new Date(e.t));
    return { key, label: dayLabelLong(key) };
  }, expenseRowHtml);
}

// Итоги по категориям: сумма и полоска для сравнения
function catsBreakdownHtml(offset) {
  const list = monthExpenses(offset);
  const byCat = new Map();
  list.forEach((e) => {
    const id = findCat(e.c).id;
    byCat.set(id, (byCat.get(id) || 0) + e.a);
  });
  if (!byCat.size) return '';
  const rows = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const max = rows[0][1];
  return `
    <p class="group-head">По категориям</p>
    <div class="group">${rows.map(([id, total]) => {
      const cat = findCat(id);
      return `
        <button class="row" data-act="open-mcat" data-id="${id}">
          ${avatar(cat.name)}
          <span class="title-wrap">
            <span class="title">${esc(cat.name)}</span>
            <span class="cat-bar"><span style="width:${Math.max(3, (total / max) * 100)}%"></span></span>
          </span>
          <span class="meta amount">${formatMoney(total)}</span>
          ${CHEVRON}
        </button>`;
    }).join('')}</div>`;
}

// Карточка месяца: «‹ Октябрь 2026 ›», итог, по категориям, список
function monthHtml(route) {
  const offset = route.month || 0;
  const list = monthExpenses(offset);
  return `
    <div class="page-items">
      <div class="total-card">
        <div class="cal-head">
          <button class="pager-btn prev" data-act="money-month" data-dir="-1">${CHEVRON}</button>
          <span class="cal-title">${monthRange(offset).title}</span>
          <button class="pager-btn" data-act="money-month" data-dir="1"${offset >= 0 ? ' disabled' : ''}>${CHEVRON}</button>
        </div>
        <b class="total-sum${takeFlash('total') ? ' swap' : ''}">${formatMoney(sum(list))}</b>
        <span class="total-sub">${list.length ? plural(list.length, ['расход', 'расхода', 'расходов']) : 'Расходов нет'}</span>
      </div>
      ${catsBreakdownHtml(offset)}
      ${list.length ? '<p class="group-head">Расходы</p>' : ''}
      <div class="paged">${list.length ? expenseListHtml(route) : ''}</div>
    </div>`;
}

pagers.money = expenseListHtml;
pagers.mcat = expenseListHtml;

// ---------- Экраны ----------

views.money = (route) => `
  <h1>Расходы</h1>
  <div class="actions">
    <button class="btn primary" data-act="add-expense">➕ Добавить расход</button>
  </div>
  <div class="month-box paged">${monthHtml(route)}</div>
  <div class="group">
    <button class="row" data-act="open-mcats"><span class="title">Категории</span><span class="meta">${mcats.length}</span>${CHEVRON}</button>
  </div>`;

// Расходы одной категории за выбранный месяц
views.mcat = (route) => {
  const cat = findCat(route.catId);
  const list = monthExpenses(route.month || 0, cat.id);
  return `
    <h1>${esc(cat.name)}</h1>
    <p class="sub">${monthRange(route.month || 0).title} · ${formatMoney(sum(list))}</p>
    <div class="paged">${expenseListHtml(route)}</div>`;
};

views.expense = (route) => {
  const e = expenses.find(route.id);
  if (!e) return '<p class="empty">Расход не найден</p>';
  const cat = findCat(e.c);
  return `
    <h1>${editHtml('exp-amount', e.id, amountText(e.a), { placeholder: 'Сумма', max: 14, inputmode: 'decimal' })}</h1>
    <p class="sub">Сумма в ${CURRENCY} — нажми, чтобы изменить</p>
    <div class="card">
      ${editHtml('exp-note', e.id, e.n, { placeholder: 'Комментарий…', max: NOTE_MAX })}
    </div>
    <div class="group">
      <button class="row" data-act="exp-cat" data-id="${e.id}">
        <span class="title">Категория</span>
        <span class="meta${takeFlash('cat:' + e.id) ? ' swap' : ''}">${esc(cat.name)}</span>
        ${CHEVRON}
      </button>
      <button class="row" data-act="exp-date" data-id="${e.id}">
        <span class="title">Дата</span>
        <span class="meta${takeFlash('date:' + e.id) ? ' swap' : ''}">${dayLabel(dayKey(new Date(e.t)))}</span>
        ${CHEVRON}
      </button>
    </div>
    <div class="group">
      <button class="row danger" data-act="delete-expense" data-id="${e.id}">Удалить расход</button>
    </div>`;
};

// Управление категориями: добавить, переименовать (нажатием), удалить свайпом
views.mcats = () => {
  const rows = mcats.map((c, n) => {
    const row = `
      <button class="row" data-act="rename-mcat" data-id="${c.id}">
        ${avatar(c.name)}
        <span class="title">${esc(c.name)}</span>
      </button>`;
    // «Другое» удалить нельзя — у неё нет свайпа
    if (c.id === OTHER) return row;
    return `
      <div class="swipe${takeFlash(c.id) ? ' appear' : ''}" style="--i:${n}">
        <button class="swipe-del" data-act="swipe-delete" data-kind="mcat" data-id="${c.id}">Удалить</button>
        ${row}
      </div>`;
  }).join('');
  return `
    <h1>Категории</h1>
    <p class="sub">Нажми, чтобы переименовать; свайп влево — удалить</p>
    <div class="actions">
      <button class="btn primary" data-act="new-mcat">➕ Новая категория</button>
    </div>
    <div class="group">${rows}</div>`;
};

editors['exp-amount'] = {
  required: true,
  valid: (value) => parseAmount(value) > 0,
  invalidText: 'Неверная сумма — вернул прежнюю',
  get: (id) => amountText(expenses.find(id).a),
  save: (id, value) => {
    expenses.find(id).a = parseAmount(value);
    return expenses.save();
  },
};
editors['exp-note'] = {
  get: (id) => expenses.find(id).n || '',
  save: (id, value) => {
    expenses.find(id).n = value;
    return expenses.save();
  },
};

// ---------- Действия ----------

// Новая категория: спросить название, сохранить, вернуть её id (или null при отмене)
async function createCat() {
  const res = await ask({ title: 'Новая категория', fields: [{ placeholder: 'Например, «Спорт»', max: CAT_NAME_MAX }] });
  if (!res) return null;
  const cat = { id: newId(), name: res[0] };
  mcats.splice(Math.max(0, mcats.findIndex((c) => c.id === OTHER)), 0, cat); // перед «Другое»
  try {
    await saveCats();
  } catch (err) {
    toast(err.userMessage || 'Не удалось сохранить');
    await loadData().catch(() => {});
    return null;
  }
  return cat.id;
}

// Выбор категории в меню снизу; внизу — «Новая категория…»
async function pickCat(title, current) {
  const options = mcats.map((c) => ({ key: c.id, label: c.name, checked: c.id === current }));
  options.push({ key: '__new', label: '＋ Новая категория…' });
  const picked = await choose({ title, options });
  if (picked === '__new') return createCat();
  return picked;
}

Object.assign(actions, {
  // Сначала сумма (цифровая клавиатура) и дата (по умолчанию сегодня), потом категория
  'add-expense': async () => {
    const res = await ask({
      title: 'Новый расход',
      fields: [
        { placeholder: `Сумма, ${CURRENCY}`, max: 14, inputmode: 'decimal', check: checkAmount },
        { placeholder: 'Комментарий — необязательно', max: NOTE_MAX, optional: true },
      ],
      date: dayKey(),
    });
    if (!res) return;
    const catId = await pickCat('Категория', null);
    if (!catId) {
      toast('Расход не сохранён — не выбрана категория');
      return;
    }
    const day = res[2];
    // Другой день — полдень, как при смене даты у готового расхода
    const time = day === dayKey() ? Date.now() : keyToDate(day).setHours(12);
    const expense = { id: newId(), a: parseAmount(res[0]), c: catId, t: time, n: res[1] };
    flash = new Set([expense.id, 'total']); // новая строка появляется, итог мягко меняется
    const route = currentRoute();
    route.month = monthOffset(day); // показываем месяц, в который попал расход
    route.page = 0;
    const ok = await commit(() => {
      expenses.items.push(expense);
      return expenses.save();
    });
    if (ok) toast(`${formatMoney(expense.a)} · ${findCat(catId).name}`);
  },

  'money-month': ({ dir }, el) => {
    const route = currentRoute();
    route.month = (route.month || 0) + Number(dir);
    route.page = 0;
    swapContent(el.closest('.month-box'), monthHtml(route), Number(dir) > 0 ? 'page-next' : 'page-prev');
    softHaptic();
  },

  'open-mcat': ({ id }) => go({ name: 'mcat', catId: id, month: currentRoute().month || 0 }),
  'open-expense': ({ id }) => go({ name: 'expense', id }),
  'open-mcats': () => go({ name: 'mcats' }),

  'exp-cat': async ({ id }) => {
    const e = expenses.find(id);
    const catId = await pickCat('Категория', e.c);
    if (!catId || catId === e.c) return;
    flash = 'cat:' + id;
    await commit(() => {
      e.c = catId;
      return expenses.save();
    });
  },

  // Дата: сегодня, вчера или любой день в календаре. Время ставим на полдень этого дня
  'exp-date': async ({ id }) => {
    const e = expenses.find(id);
    const today = dayKey();
    const picked = await choose({
      title: 'Дата',
      options: [
        { key: today, label: 'Сегодня' },
        { key: addDays(today, -1), label: 'Вчера' },
        { label: 'Выбрать дату…', date: dayKey(new Date(e.t)) },
      ],
    });
    if (!picked || picked === dayKey(new Date(e.t))) return;
    if (picked > today) {
      toast('Расход не может быть в будущем');
      return;
    }
    const date = keyToDate(picked);
    date.setHours(12);
    flash = 'date:' + id;
    await commit(() => {
      e.t = date.getTime();
      return expenses.save();
    });
  },

  'delete-expense': async ({ id }) => {
    if (!(await confirmDeleteExpense(id))) return;
    await commit(() => deleteExpenseData(id), back);
  },

  'new-mcat': async () => {
    const id = await createCat();
    if (!id) return;
    flash = id;
    refresh();
  },

  'rename-mcat': async ({ id }) => {
    const cat = findCat(id);
    const res = await ask({ title: 'Переименовать категорию', fields: [{ value: cat.name, max: CAT_NAME_MAX }] });
    if (!res || res[0] === cat.name) return;
    flash = id;
    await commit(() => {
      cat.name = res[0];
      return saveCats();
    });
  },
});
