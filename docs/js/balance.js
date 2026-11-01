'use strict';

// Страница «Баланс» в «Финансах»: свои балансы, пополнение, снятие, переводы, история операций

// ---------- Данные ----------
// accounts.items: [{id, name, at}] — балансы, пачками в ключах acc_0, acc_1, …
// moves.items: [{id, k, acc, to, a, t, n}] — операции, пачками в ключах mov_0, mov_1, …
//   k — вид: start (начальная сумма), in (пополнение), out (снятие), move (перевод acc → to),
//   fix (поправка до точной суммы, a со знаком); a — копейки, t — когда, n — комментарий
// Сумма нигде не хранится: баланс — это его операции минус расходы, списанные с него (e.b).
// Поэтому изменённый или удалённый расход сразу отражается на балансе

const accounts = makeBucket('acc_');
const moves = makeBucket('mov_');
const ACC_NAME_MAX = 24;

modules.balance = {
  load(raw) {
    accounts.load(raw);
    moves.load(raw);
  },
};

function findAccount(id) {
  return id ? accounts.find(id) : null;
}

function accountName(id) {
  const acc = findAccount(id);
  return acc ? esc(acc.name) : '';
}

// На сколько операция меняет этот баланс
function moveDelta(m, id) {
  if (m.k === 'move') return m.to === id ? m.a : m.acc === id ? -m.a : 0;
  if (m.acc !== id) return 0;
  return m.k === 'out' ? -m.a : m.a;
}

function balanceOf(id) {
  const moved = moves.items.reduce((total, m) => total + moveDelta(m, id), 0);
  return moved - sum(expenses.items.filter((e) => e.b === id));
}

function totalBalance() {
  return accounts.items.reduce((total, acc) => total + balanceOf(acc.id), 0);
}

// Что происходило с балансом (или со всеми): операции и списанные расходы, свежие сверху
function historyItems(id) {
  return [
    ...moves.items.filter((m) => !id || m.acc === id || m.to === id),
    ...expenses.items.filter((e) => e.b && (!id || e.b === id)),
  ].sort((a, b) => b.t - a.t);
}

// С какого баланса списан последний расход — такой и предложим в следующий раз
function lastPaidFrom() {
  const paid = expenses.items.filter((e) => e.b && findAccount(e.b)).sort((a, b) => b.t - a.t);
  return paid.length ? paid[0].b : '';
}

// Строка выбора баланса в окне ввода. none — подпись пункта «без баланса», если он нужен
function accountPick(title, value, none) {
  const options = accounts.items.map((acc) => ({ key: acc.id, label: acc.name }));
  if (none) options.push({ key: 'none', label: none });
  return { title, value: value || options[0].key, options };
}

function confirmDeleteMove() {
  return confirmDialog(t('Удалить операцию?'));
}

function deleteMoveData(id) {
  flash = 'total';
  moves.items = moves.items.filter((m) => m.id !== id);
  return moves.save();
}

deleters.move = { confirm: confirmDeleteMove, remove: deleteMoveData };

// Удалить баланс: его история уходит, расходы остаются просто расходами.
// Переводы с другими балансами превращаются у них в пополнение и снятие — их суммы не меняются
async function deleteAccountData(id) {
  moves.items = moves.items.filter((m) => m.acc === id ? m.k === 'move' : true).map((m) => {
    if (m.k !== 'move' || (m.acc !== id && m.to !== id)) return m;
    const other = m.acc === id ? m.to : m.acc;
    return { id: m.id, k: m.acc === id ? 'in' : 'out', acc: other, a: m.a, t: m.t, n: m.n };
  });
  expenses.items.filter((e) => e.b === id).forEach((e) => { delete e.b; });
  accounts.items = accounts.items.filter((acc) => acc.id !== id);
  await moves.save();
  await expenses.save();
  await accounts.save();
}

// ---------- Отображение ----------

const MOVE_TITLES = {
  start: 'Начальная сумма', in: 'Пополнение', out: 'Снятие', move: 'Перевод', fix: 'Поправка суммы',
};
const MOVE_SIGNS = { start: '+', in: '+', out: '−', move: '→', fix: '=' };

// «+1 000 ₴», «−250 ₴»
function signedMoney(kop) {
  return `${kop < 0 ? '−' : '+'}${formatMoney(Math.abs(kop))}`;
}

// Лента: «Общий баланс», свои балансы и круглый плюсик
function accountChipsHtml(route) {
  const chip = (key, name) => `
    <button class="chip${(route.acc || 'all') === key ? ' active' : ''}" data-act="set-account" data-key="${key}">${name}</button>`;
  return `
    <div class="chips">
      ${chip('all', t('Общий баланс'))}
      ${accounts.items.map((acc) => chip(acc.id, esc(acc.name))).join('')}
      <button class="chip-plus" data-act="new-account" aria-label="${t('Новый баланс')}">${plusIcon()}</button>
    </div>`;
}

function balanceCardHtml(route) {
  const acc = findAccount(route.acc);
  const total = formatMoney(acc ? balanceOf(acc.id) : totalBalance());
  const count = historyItems(route.acc).length;
  const note = acc
    ? (count ? plural(count, ['операция', 'операции', 'операций']) : t('Операций пока нет'))
    : (accounts.items.length ? plural(accounts.items.length, ['баланс', 'баланса', 'балансов']) : t('Нажми ＋, чтобы добавить первый баланс'));
  const dots = icon('<circle cx="6" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="18" cy="12" r="1"/>');
  return `
    <div class="total-card">
      ${acc ? `<button class="more-btn" data-act="acc-menu" aria-label="${t('Настройки')}">${dots}</button>` : ''}
      <p class="total-head">${acc ? esc(acc.name) : t('Общий баланс')}</p>
      <b class="total-sum${sumSize(total)}${takeFlash('total') ? ' swap' : ''}">${total}</b>
      <span class="total-sub">${note}</span>
    </div>`;
}

// Пополнить, Снять и — если есть между чем — Перевод
function balanceActionsHtml() {
  if (!accounts.items.length) return '';
  const button = (act, path, label) => `
    <button class="btn quick-btn" data-act="${act}">${icon(path)}${label}</button>`;
  return `
    <div class="quick-btns bal-actions">
      ${button('bal-add', '<path d="M12 5v14M5 12h14"/>', t('Пополнить'))}
      ${button('bal-take', '<path d="M5 12h14"/>', t('Снять'))}
      ${accounts.items.length > 1 ? button('bal-transfer', '<path d="M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4"/>', t('Перевод')) : ''}
    </div>`;
}

function moveRowHtml(m, route, n) {
  const acc = route.acc;
  const where = m.k === 'move' ? `${accountName(m.acc)} → ${accountName(m.to)}` : acc ? '' : accountName(m.acc);
  const note = [where, m.n ? esc(m.n) : ''].filter(Boolean).join(' · ');
  // Перевод не меняет общий баланс: в общей истории — просто сумма, без знака
  const amount = m.k === 'move' && !acc ? formatMoney(m.a) : signedMoney(moveDelta(m, acc || m.acc));
  return `
    <div class="swipe${takeFlash(m.id) ? ' appear' : ''}" style="--i:${n}">
      <button class="swipe-del" data-act="swipe-delete" data-kind="move" data-id="${m.id}">${t('Удалить')}</button>
      <div class="row static">
        ${avatar(MOVE_SIGNS[m.k])}
        <span class="title-wrap">
          <span class="title">${t(MOVE_TITLES[m.k])}</span>
          ${note ? `<span class="subtitle">${note}</span>` : ''}
        </span>
        <span class="meta amount">${amount}</span>
      </div>
    </div>`;
}

function spentRowHtml(e, route) {
  const cat = findCat(e.c);
  const note = [route.acc ? '' : accountName(e.b), e.n ? esc(e.n) : ''].filter(Boolean).join(' · ');
  return `
    <button class="row" data-act="open-expense" data-id="${e.id}">
      ${avatar(cat.name)}
      <span class="title-wrap">
        <span class="title">${esc(cat.name)}</span>
        ${note ? `<span class="subtitle">${note}</span>` : ''}
      </span>
      <span class="meta amount">${signedMoney(-e.a)}</span>
    </button>`;
}

// История по дням с листанием
function historyHtml(route) {
  const list = historyItems(route.acc);
  if (!list.length) return '';
  return groupedPage(list, route, (item) => {
    const key = dayKey(new Date(item.t));
    return { key, label: dayLabelLong(key) };
  }, (item, n) => (item.k ? moveRowHtml(item, route, n) : spentRowHtml(item, route)));
}

function balancePageHtml(route) {
  return `
    ${accountChipsHtml(route)}
    <div class="total-box paged">${balanceCardHtml(route)}</div>
    ${balanceActionsHtml()}
    <div class="ops-box paged">${historyHtml(route)}</div>`;
}

// ---------- Действия ----------

function moveFields() {
  return [
    { placeholder: t('Сумма, {0}', CURRENCY), max: 14, inputmode: 'decimal', check: checkAmount },
    { placeholder: t('Комментарий — необязательно'), max: NOTE_MAX, optional: true },
  ];
}

function saveMove(move) {
  const route = currentRoute();
  route.page = 0;
  flash = new Set([move.id, 'total']);
  return commit(() => {
    moves.items.push(move);
    return moves.save();
  });
}

// Пополнить или снять. На «Общем балансе» сначала спрашиваем, какой именно
async function askMove(k, title) {
  const id = currentRoute().acc;
  const res = await ask({
    title,
    fields: moveFields(),
    date: dayKey(),
    picks: id ? [] : [accountPick(t('Баланс'), lastPaidFrom())],
  });
  if (!res) return;
  const [amount, note, day, picked] = res;
  await saveMove({ id: newId(), k, acc: id || picked, a: parseAmount(amount), t: dayMoment(day), n: note });
}

// Сколько на самом деле: 0 — тоже правильный ответ
function exactAmount(text) {
  return text.trim() === '0' ? 0 : parseAmount(text);
}

function checkExact(text) {
  return text.trim() === '0' || parseAmount(text) ? null : t('Введите сумму, например 250 или 0');
}

Object.assign(actions, {
  // Лента балансов: итог и история меняются на месте, лента не прыгает к началу
  'set-account': ({ key }, el) => {
    const route = currentRoute();
    const id = key === 'all' ? null : key;
    if ((route.acc || null) === id) return;
    const order = ['all', ...accounts.items.map((acc) => acc.id)];
    const dir = order.indexOf(key) > order.indexOf(route.acc || 'all') ? 'page-next' : 'page-prev';
    route.acc = id;
    route.page = 0;
    const chips = el.closest('.chips');
    chips.querySelectorAll('.chip').forEach((chip) => chip.classList.toggle('active', chip === el));
    centerChip(chips, true);
    const inner = el.closest('.screen-inner');
    swapContent(inner.querySelector('.total-box'), balanceCardHtml(route), dir);
    swapContent(inner.querySelector('.ops-box'), historyHtml(route), dir);
    softHaptic();
  },

  // Новый баланс: название своё, сумма — сколько там уже есть
  'new-account': async () => {
    const res = await ask({
      title: t('Новый баланс'),
      fields: [
        { placeholder: t('Название'), max: ACC_NAME_MAX },
        { placeholder: t('Сколько там сейчас, {0} — необязательно', CURRENCY), max: 14, inputmode: 'decimal', optional: true, check: checkAmount },
      ],
    });
    if (!res) return;
    const acc = { id: newId(), name: res[0], at: Date.now() };
    const start = parseAmount(res[1]);
    const route = currentRoute();
    route.acc = acc.id;
    route.page = 0;
    flash = 'total';
    await commit(async () => {
      accounts.items.push(acc);
      await accounts.save();
      if (!start) return;
      moves.items.push({ id: newId(), k: 'start', acc: acc.id, a: start, t: acc.at, n: '' });
      await moves.save();
    });
  },

  'bal-add': () => askMove('in', t('Пополнить')),
  'bal-take': () => askMove('out', t('Снять')),

  'bal-transfer': async () => {
    const from = currentRoute().acc || accounts.items[0].id;
    const to = accounts.items.find((acc) => acc.id !== from).id;
    const res = await ask({
      title: t('Перевод'),
      fields: moveFields(),
      picks: [accountPick(t('Откуда'), from), accountPick(t('Куда'), to)],
    });
    if (!res) return;
    const [amount, note, source, target] = res;
    if (source === target) {
      toast(t('Выбери разные балансы'));
      return;
    }
    await saveMove({ id: newId(), k: 'move', acc: source, to: target, a: parseAmount(amount), t: Date.now(), n: note });
  },

  // Меню баланса: точная сумма, название, удаление
  'acc-menu': async () => {
    const route = currentRoute();
    const acc = findAccount(route.acc);
    const picked = await choose({
      title: acc.name,
      options: [
        { key: 'exact', label: t('Указать точную сумму') },
        { key: 'rename', label: t('Переименовать') },
        { key: 'delete', label: t('Удалить баланс'), danger: true },
      ],
    });
    if (picked === 'exact') {
      const now = balanceOf(acc.id);
      const res = await ask({
        title: t('Сколько на самом деле'),
        fields: [{ value: amountText(Math.max(now, 0)), placeholder: t('Сумма, {0}', CURRENCY), max: 14, inputmode: 'decimal', check: checkExact }],
      });
      if (!res) return;
      const delta = exactAmount(res[0]) - now;
      if (delta) await saveMove({ id: newId(), k: 'fix', acc: acc.id, a: delta, t: Date.now(), n: '' });
    } else if (picked === 'rename') {
      const res = await ask({ title: t('Переименовать'), fields: [{ value: acc.name, max: ACC_NAME_MAX }] });
      if (!res || res[0] === acc.name) return;
      await commit(() => {
        acc.name = res[0];
        return accounts.save();
      });
    } else if (picked === 'delete') {
      const question = `${t('Удалить баланс «{0}»?', acc.name)}\n${t('История его операций удалится, а расходы останутся.')}`;
      if (!(await confirmDialog(question))) return;
      route.acc = null;
      route.page = 0;
      await commit(() => deleteAccountData(acc.id));
    }
  },
});
