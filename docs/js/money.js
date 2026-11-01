
'use strict';

// Модуль «Финансы», страница «Расходы»: траты по категориям, итог за период, свои категории.
// Страница «Баланс» — в balance.js. Валюта — гривна

// ---------- Данные ----------
// mcats: [{id, name}] — категории, в ключе "mcats" (пока не менялись — берутся стандартные)
// expenses.items: [{id, a, c, t, n}] — пачками в ключах exp_0, exp_1, …
//   a — сумма в копейках (целое число, чтобы не было ошибок округления), c — id категории,
//   t — когда (время в мс), n — комментарий, b — с какого баланса списан (если списан)

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
    localizeCats();
    expenses.load(raw);
  },
};

// Стандартные категории показываем на выбранном языке, а переименованные — как есть
function localizeCats() {
  mcats.forEach((c) => {
    const std = DEFAULT_CATS.find((d) => d.id === c.id);
    if (std && allSpellings(std.name).includes(c.name)) c.name = t(std.name);
  });
}

function saveCats() {
  return store.set('mcats', JSON.stringify(mcats));
}

function findCat(id) {
  return mcats.find((c) => c.id === id) || mcats.find((c) => c.id === OTHER) || { id: OTHER, name: t('Другое') };
}

// «250», «99,50», «1 250.5» → копейки. Неверное — 0
function parseAmount(text) {
  const clean = String(text).replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return 0;
  const kop = Math.round(Number(clean) * 100);
  return kop > 0 && kop < 1e11 ? kop : 0;
}

function checkAmount(text) {
  return parseAmount(text) ? null : t('Введите сумму, например 250 или 99,50');
}

// 125050 → «1 250,50 ₴»
function formatMoney(kop) {
  const text = (kop / 100).toLocaleString(locale(), {
    minimumFractionDigits: kop % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return `${text.replace('-', '−')} ${CURRENCY}`;
}

// Сумма для правки: «1250,5»
function amountText(kop) {
  return String(kop / 100).replace('.', lang === 'en' ? '.' : ',');
}

// ---------- Периоды ----------
// route.period — ключ из PERIODS (по умолчанию этот месяц). Свой период: route.from и route.to —
// первый и последний день включительно

const PERIODS = [
  { key: 'month', label: 'Этот месяц', head: 'В этом месяце вы потратили' },
  { key: 'last', label: 'Прошлый месяц', head: 'В прошлом месяце вы потратили' },
  { key: 'week', label: '7 дней', head: 'За 7 дней вы потратили' },
  { key: 'yesterday', label: 'Вчера', head: 'Вчера вы потратили' },
  { key: 'today', label: 'Сегодня', head: 'Сегодня вы потратили' },
  { key: 'all', label: 'Всё время', head: 'За всё время вы потратили' },
  { key: 'custom', label: 'Свой период', head: 'За выбранный период вы потратили' },
];

function periodOf(route) {
  return PERIODS.find((p) => p.key === route.period) || PERIODS[0];
}

// Границы месяца: offset — сдвиг от текущего (0 — этот, -1 — прошлый)
function monthRange(offset = 0) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1);
  return { start: start.getTime(), end: end.getTime() };
}

// Свой период; пока даты не выбраны — с начала месяца по сегодня
function customRange(route) {
  const today = dayKey();
  return { from: route.from || `${today.slice(0, 8)}01`, to: route.to || today };
}

function periodRange(route) {
  const today = dayKey();
  const dayStart = (key, shift = 0) => keyToDate(addDays(key, shift)).getTime();
  const { from, to } = customRange(route);
  return {
    month: () => monthRange(0),
    last: () => monthRange(-1),
    week: () => ({ start: dayStart(today, -6), end: dayStart(today, 1) }),
    yesterday: () => ({ start: dayStart(today, -1), end: dayStart(today) }),
    today: () => ({ start: dayStart(today), end: dayStart(today, 1) }),
    all: () => ({ start: 0, end: Infinity }),
    custom: () => ({ start: dayStart(from), end: dayStart(to, 1) }),
  }[periodOf(route).key]();
}

// Подпись периода: «Этот месяц» или «14 окт. 2026 г. — 31 окт. 2026 г.»
function periodName(route) {
  const period = periodOf(route);
  if (period.key !== 'custom') return t(period.label);
  const { from, to } = customRange(route);
  return `${fullDate(from)} — ${fullDate(to)}`;
}

// Новый расход должен быть виден: не попал в выбранный период — показываем его месяц
function showExpenseDay(route, day) {
  const time = keyToDate(day).setHours(12);
  const { start, end } = periodRange(route);
  if (time >= start && time < end) return;
  const offset = monthOffset(day);
  if (offset === 0 || offset === -1) {
    route.period = offset ? 'last' : 'month';
    return;
  }
  const first = new Date(time);
  first.setDate(1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  Object.assign(route, { period: 'custom', from: dayKey(first), to: dayKey(last) });
}

// Расходы периода (и категории, если задана), свежие сверху
function periodExpenses(route, catId) {
  const { start, end } = periodRange(route);
  return expenses.items
    .filter((e) => e.t >= start && e.t < end && (!catId || findCat(e.c).id === catId))
    .sort((a, b) => b.t - a.t);
}

function sum(list) {
  return list.reduce((s, e) => s + e.a, 0);
}

// Когда записать событие выбранного дня: сегодня — сейчас, другой день — полдень
function dayMoment(day) {
  return day === dayKey() ? Date.now() : keyToDate(day).setHours(12);
}

// Сумма расходов за сегодня, в копейках
function todaySpent() {
  const today = dayKey();
  return sum(expenses.items.filter((e) => dayKey(new Date(e.t)) === today));
}

function confirmDeleteExpense(id) {
  const e = expenses.find(id);
  return confirmDialog(t('Удалить расход {0} ({1})?', formatMoney(e.a), findCat(e.c).name));
}

function deleteExpenseData(id) {
  flash = 'total'; // итог периода сменится мягко
  expenses.items = expenses.items.filter((e) => e.id !== id);
  return expenses.save();
}

function confirmDeleteCat(id) {
  const used = expenses.items.filter((e) => e.c === id).length;
  const extra = used ? `\n${t('Расходы из неё ({0}) перейдут в «Другое».', used)}` : '';
  return confirmDialog(`${t('Удалить категорию «{0}»?', findCat(id).name)}${extra}`);
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
      <button class="swipe-del" data-act="swipe-delete" data-kind="expense" data-id="${e.id}">${t('Удалить')}</button>
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
  const list = periodExpenses(route, route.catId);
  if (!list.length) return `<p class="empty small">${t('Расходов пока нет')}</p>`;
  return groupedPage(list, route, (e) => {
    const key = dayKey(new Date(e.t));
    return { key, label: dayLabelLong(key) };
  }, expenseRowHtml);
}

// Поиск по всему: по категории, комментарию и сумме («1 250» найдёт 1250). Свежие сверху
function searchExpenses(query) {
  const q = norm(query);
  const amount = q.replace(/\s/g, '').replace(',', '.');
  return expenses.items
    .filter((e) => norm(findCat(e.c).name).includes(q) || norm(e.n || '').includes(q) || String(e.a / 100).includes(amount))
    .sort((a, b) => b.t - a.t);
}

function expenseSearchRowHtml(e, query) {
  const cat = findCat(e.c);
  const note = e.n ? ` · ${snippet(e.n, query) || esc(e.n)}` : '';
  return `
    <button class="row" data-act="open-expense" data-id="${e.id}">
      ${avatar(cat.name)}
      <span class="title-wrap">
        <span class="title">${highlight(cat.name, query)}</span>
        <span class="subtitle">${dayLabel(dayKey(new Date(e.t)))}${note}</span>
      </span>
      <span class="meta amount">${formatMoney(e.a)}</span>
    </button>`;
}

// Итоги по категориям: сумма и полоска для сравнения
function catsBreakdownHtml(route) {
  const list = periodExpenses(route);
  const byCat = new Map();
  list.forEach((e) => {
    const id = findCat(e.c).id;
    byCat.set(id, (byCat.get(id) || 0) + e.a);
  });
  if (!byCat.size) return '';
  const rows = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const max = rows[0][1];
  return `
    <p class="group-head">${t('По категориям')}</p>
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

// Лента периодов: все не влезают в ширину экрана, она листается в сторону
function chipsHtml(route) {
  const active = periodOf(route).key;
  const calendar = icon('<rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8.5 3v4M15.5 3v4M4 10h16"/>');
  return `
    <div class="chips">${PERIODS.map((p) => `
      <button class="chip${p.key === active ? ' active' : ''}" data-act="set-period" data-key="${p.key}">
        ${p.key === 'custom' ? calendar : ''}${t(p.label)}
      </button>`).join('')}
    </div>`;
}

// Две даты своего периода: с какого дня и по какой
function rangeHtml(route) {
  const { from, to } = customRange(route);
  return `
    <button class="date-pill" data-act="pick-range" data-end="from">${fullDate(from)}</button>
    <span class="range-dash">—</span>
    <button class="date-pill" data-act="pick-range" data-end="to">${fullDate(to)}</button>`;
}

// Длинная сумма в карточке пишется мельче
function sumSize(text) {
  return text.length > 13 ? ' longer' : text.length > 9 ? ' long' : '';
}

// Карточка итога периода
function totalHtml(route) {
  const list = periodExpenses(route);
  const total = formatMoney(sum(list));
  return `
    <div class="total-card">
      <p class="total-head">${t(periodOf(route).head)}</p>
      <b class="total-sum${sumSize(total)}${takeFlash('total') ? ' swap' : ''}">${total}</b>
      <span class="total-sub">${list.length ? plural(list.length, ['расход', 'расхода', 'расходов']) : t('Расходов нет')}</span>
    </div>`;
}

// По категориям и список за период
function periodHtml(route) {
  const list = periodExpenses(route);
  return `
    <div class="page-items">
      ${catsBreakdownHtml(route)}
      ${list.length ? `<p class="group-head">${t('Расходы')}</p>` : ''}
      <div class="paged">${list.length ? expenseListHtml(route) : ''}</div>
    </div>`;
}

// Период сменился: итог и списки меняются мягко, кнопка между ними стоит на месте
function swapPeriod(inner, route) {
  swapContent(inner.querySelector('.total-box'), totalHtml(route));
  swapContent(inner.querySelector('.month-box'), periodHtml(route));
}

// Поля дат появляются и прячутся одним сдвигом: всё, что ниже, едет единым блоком, а страница
// не пересчитывается в каждом кадре — иначе на телефоне движение дёргается.
// Поля занимают своё место всё движение и убираются, только когда блок под ними доехал
const RANGE_MS = 420;

function toggleRange(inner, show) {
  const card = inner.querySelector('.range-card');
  const rest = inner.querySelector('.after-range');
  if (reduceMotion || !rest.animate) {
    card.classList.toggle('hidden', !show);
    return;
  }
  // Прошлое движение могло не закончиться — продолжаем с того места, где блоки сейчас
  const nowTop = rest.getBoundingClientRect().top;
  const nowOpacity = card.classList.contains('hidden') ? 0 : Number(window.getComputedStyle(card).opacity);
  (card.rangeAnims || []).forEach((a) => a.cancel());
  card.classList.add('hidden');
  const closedTop = rest.getBoundingClientRect().top;
  card.classList.remove('hidden');
  const openTop = rest.getBoundingClientRect().top;

  const opts = { duration: RANGE_MS, easing: SLIDE_EASE, fill: 'forwards' };
  const anims = [
    rest.animate([
      { transform: `translateY(${nowTop - openTop}px)` },
      { transform: `translateY(${show ? 0 : closedTop - openTop}px)` },
    ], opts),
    card.animate([{ opacity: nowOpacity }, { opacity: show ? 1 : 0 }], opts),
  ];
  card.rangeAnims = anims;
  anims[0].onfinish = () => {
    card.rangeAnims = null;
    if (!show) card.classList.add('hidden');
    anims.forEach((a) => a.cancel());
  };
}

pagers.money = (route) => (finView(route) === 'balance' ? historyHtml(route) : expenseListHtml(route));
pagers.mcat = expenseListHtml;

// ---------- Экраны ----------

// Две страницы «Финансов» на одной вкладке
const FIN_VIEWS = [{ key: 'balance', html: 'Баланс' }, { key: 'expenses', html: 'Расходы' }];

// Какая страница открыта; при входе в раздел — «Баланс»
function finView(route) {
  return route.view || 'balance';
}

views.money = (route) => `
  ${segHtml(FIN_VIEWS.map((v) => ({ ...v, html: t(v.html) })), finView(route), 'set-fin-view', '', 'fin-seg')}
  <div class="fin-body paged">${finBodyHtml(route)}</div>`;

function finBodyHtml(route) {
  return finView(route) === 'balance' ? balancePageHtml(route) : expensesPageHtml(route);
}

const expensesPageHtml = (route) => `
  ${chipsHtml(route)}
  <div class="range-card${periodOf(route).key === 'custom' ? '' : ' hidden'}">${rangeHtml(route)}</div>
  <div class="after-range">
    <div class="total-box paged">${totalHtml(route)}</div>
    <div class="actions total-action">
      <button class="btn primary" data-act="add-expense">➕ ${t('Добавить расход')}</button>
    </div>
    <div class="month-box paged">${periodHtml(route)}</div>
    <div class="group">
      <button class="row" data-act="open-mcats"><span class="title">${t('Категории')}</span><span class="meta">${mcats.length}</span>${CHEVRON}</button>
    </div>
  </div>`;

// Расходы одной категории за выбранный период
views.mcat = (route) => {
  const cat = findCat(route.catId);
  const list = periodExpenses(route, cat.id);
  return `
    <h1>${esc(cat.name)}</h1>
    <p class="sub">${periodName(route)} · ${formatMoney(sum(list))}</p>
    <div class="paged">${expenseListHtml(route)}</div>`;
};

views.expense = (route) => {
  const e = expenses.find(route.id);
  if (!e) return `<p class="empty">${t('Расход не найден')}</p>`;
  const cat = findCat(e.c);
  return `
    <h1>${editHtml('exp-amount', e.id, amountText(e.a), { placeholder: t('Сумма'), max: 14, inputmode: 'decimal' })}</h1>
    <p class="sub">${t('Сумма в {0} — нажми, чтобы изменить', CURRENCY)}</p>
    <div class="card">
      ${editHtml('exp-note', e.id, e.n, { placeholder: t('Комментарий…'), max: NOTE_MAX })}
    </div>
    <div class="group">
      <button class="row" data-act="exp-cat" data-id="${e.id}">
        <span class="title">${t('Категория')}</span>
        <span class="meta${takeFlash('cat:' + e.id) ? ' swap' : ''}">${esc(cat.name)}</span>
        ${CHEVRON}
      </button>
      <button class="row" data-act="exp-date" data-id="${e.id}">
        <span class="title">${t('Дата')}</span>
        <span class="meta${takeFlash('date:' + e.id) ? ' swap' : ''}">${dayLabel(dayKey(new Date(e.t)))}</span>
        ${CHEVRON}
      </button>
      ${accounts.items.length ? `<button class="row" data-act="exp-account" data-id="${e.id}">
        <span class="title">${t('Откуда списать')}</span>
        <span class="meta${takeFlash('acc:' + e.id) ? ' swap' : ''}">${accountName(e.b) || t('Не списывать')}</span>
        ${CHEVRON}
      </button>` : ''}
    </div>
    <div class="group">
      <button class="row danger" data-act="delete-expense" data-id="${e.id}">${t('Удалить расход')}</button>
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
        <button class="swipe-del" data-act="swipe-delete" data-kind="mcat" data-id="${c.id}">${t('Удалить')}</button>
        ${row}
      </div>`;
  }).join('');
  return `
    <h1>${t('Категории')}</h1>
    <p class="sub">${t('Нажми, чтобы переименовать; свайп влево — удалить')}</p>
    <div class="actions">
      <button class="btn primary" data-act="new-mcat">➕ ${t('Новая категория')}</button>
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
  const res = await ask({ title: t('Новая категория'), fields: [{ placeholder: t('Например, «Спорт»'), max: CAT_NAME_MAX }] });
  if (!res) return null;
  const cat = { id: newId(), name: res[0] };
  mcats.splice(Math.max(0, mcats.findIndex((c) => c.id === OTHER)), 0, cat); // перед «Другое»
  try {
    await saveCats();
  } catch (err) {
    toast(err.userMessage || t('Не удалось сохранить'));
    await loadData().catch(() => {});
    return null;
  }
  return cat.id;
}

// Выбор категории в меню снизу; внизу — «Новая категория…»
async function pickCat(title, current) {
  const options = mcats.map((c) => ({ key: c.id, label: c.name, checked: c.id === current }));
  options.push({ key: '__new', label: `＋ ${t('Новая категория')}…` });
  const picked = await choose({ title, options });
  if (picked === '__new') return createCat();
  return picked;
}

Object.assign(actions, {
  // Сначала сумма (цифровая клавиатура) и дата (по умолчанию сегодня), потом категория
  'add-expense': async () => {
    const res = await ask({
      title: t('Новый расход'),
      fields: [
        { placeholder: t('Сумма, {0}', CURRENCY), max: 14, inputmode: 'decimal', check: checkAmount },
        { placeholder: t('Комментарий — необязательно'), max: NOTE_MAX, optional: true },
      ],
      date: dayKey(),
      picks: accounts.items.length ? [accountPick(t('Откуда списать'), lastPaidFrom() || 'none', t('Не списывать'))] : [],
    });
    if (!res) return;
    const catId = await pickCat(t('Категория'), null);
    if (!catId) {
      toast(t('Расход не сохранён — не выбрана категория'));
      return;
    }
    const day = res[2];
    const expense = { id: newId(), a: parseAmount(res[0]), c: catId, t: dayMoment(day), n: res[1] };
    if (res[3] && res[3] !== 'none') expense.b = res[3];
    flash = new Set([expense.id, 'total']); // новая строка появляется, итог мягко меняется
    const route = currentRoute();
    showExpenseDay(route, day);
    route.page = 0;
    const ok = await commit(() => {
      expenses.items.push(expense);
      return expenses.save();
    });
    if (ok) toast(`${formatMoney(expense.a)} · ${findCat(catId).name}`);
  },

  // Переключатель «Расходы / Баланс». Под страницей ничего нет — высоту не анимируем
  'set-fin-view': ({ key }, el) => {
    const route = currentRoute();
    if (finView(route) === key) return;
    route.view = key;
    route.page = 0;
    moveSeg(el.closest('.seg'), key);
    softHaptic();
    const box = el.closest('.screen-inner').querySelector('.fin-body');
    afterSegMove(() => swapContent(box, finBodyHtml(route), { smoothHeight: false, done: () => sizeEdits(box) }));
  },

  // Лента периодов: пилюля и список меняются на месте, лента не прыгает к началу
  'set-period': ({ key }, el) => {
    const route = currentRoute();
    const old = periodOf(route).key;
    if (old === key) return;
    route.period = key;
    route.page = 0;
    const chips = el.closest('.chips');
    chips.querySelectorAll('.chip').forEach((chip) => chip.classList.toggle('active', chip === el));
    centerChip(chips, true);
    const inner = el.closest('.screen-inner');
    if (key === 'custom' || old === 'custom') toggleRange(inner, key === 'custom');
    swapPeriod(inner, route);
    softHaptic();
  },

  // Дата своего периода. Начало не может быть позже конца: вторая дата подтягивается следом
  'pick-range': ({ end }, el) => {
    const route = currentRoute();
    const range = customRange(route);
    const card = el.closest('.range-card');
    openDatePop({
      value: range[end],
      anchor: el,
      onPick: (key) => {
        range[end] = key;
        if (range.from > range.to) range[end === 'from' ? 'to' : 'from'] = key;
        Object.assign(route, range, { page: 0 });
        const [fromPill, toPill] = card.querySelectorAll('.date-pill');
        setText(fromPill, fullDate(range.from));
        setText(toPill, fullDate(range.to));
        swapPeriod(card.closest('.screen-inner'), route);
      },
    });
  },

  'open-mcat': ({ id }) => {
    const { period, from, to } = currentRoute();
    go({ name: 'mcat', catId: id, period, from, to });
  },
  'open-expense': ({ id }) => go({ name: 'expense', id }),
  'open-mcats': () => go({ name: 'mcats' }),

  'exp-cat': async ({ id }) => {
    const e = expenses.find(id);
    const catId = await pickCat(t('Категория'), e.c);
    if (!catId || catId === e.c) return;
    flash = 'cat:' + id;
    await commit(() => {
      e.c = catId;
      return expenses.save();
    });
  },

  // С какого баланса списан расход: баланс пересчитается сам
  'exp-account': async ({ id }) => {
    const e = expenses.find(id);
    const { title, value, options } = accountPick(t('Откуда списать'), e.b || 'none', t('Не списывать'));
    const picked = await choose({ title, options: options.map((o) => ({ ...o, checked: o.key === value })) });
    if (!picked || picked === value) return;
    flash = 'acc:' + id;
    await commit(() => {
      if (picked === 'none') delete e.b;
      else e.b = picked;
      return expenses.save();
    });
  },

  // Дата: сегодня, вчера или любой день в календаре. Время ставим на полдень этого дня
  'exp-date': async ({ id }) => {
    const e = expenses.find(id);
    const today = dayKey();
    const picked = await choose({
      title: t('Дата'),
      options: [
        { key: today, label: t('Сегодня') },
        { key: addDays(today, -1), label: t('Вчера') },
        { label: t('Выбрать дату…'), date: dayKey(new Date(e.t)) },
      ],
    });
    if (!picked || picked === dayKey(new Date(e.t))) return;
    if (picked > today) {
      toast(t('Расход не может быть в будущем'));
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
    const res = await ask({ title: t('Переименовать категорию'), fields: [{ value: cat.name, max: CAT_NAME_MAX }] });
    if (!res || res[0] === cat.name) return;
    flash = id;
    await commit(() => {
      cat.name = res[0];
      return saveCats();
    });
  },
});
