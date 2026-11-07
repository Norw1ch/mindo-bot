'use strict';

// Страница «Долги» в «Финансах»: сколько я должен и сколько должны мне, возвраты долгов

// ---------- Данные ----------
// debts.items: [{id, dir, a, who, n, t, pays}] — пачками в ключах debt_0, debt_1, …
//   dir — 'out' (я должен) или 'in' (мне должны); a — сумма долга в копейках; who — кому или за что;
//   n — комментарий; t — когда появился; pays: [{id, a, t, b}] — возвраты, b — баланс,
//   с которого списан (или на который зачислен) возврат
// Остаток нигде не хранится: сумма долга минус возвраты. Остатка нет — долг погашен

const debts = makeBucket('debt_');
const DEBT_WHO_MAX = 40;

modules.debts = { load: (raw) => debts.load(raw) };

function debtLeft(d) {
  return d.a - sum(d.pays || []);
}

function isPaid(d) {
  return debtLeft(d) <= 0;
}

// Когда долг погашен — по последнему возврату
function paidAt(d) {
  return Math.max(0, ...(d.pays || []).map((p) => p.t));
}

// Какие долги открыты на странице: я должен (по умолчанию) или мне должны
function debtDir(route) {
  return route.dir || 'out';
}

// Сколько ещё должен я (out) или должны мне (in)
function debtsTotal(dir) {
  return debts.items.filter((d) => d.dir === dir).reduce((total, d) => total + Math.max(0, debtLeft(d)), 0);
}

// Как возврат меняет баланс: вернул я — деньги ушли, вернули мне — пришли
function payDelta(d, p) {
  return d.dir === 'out' ? -p.a : p.a;
}

// Возвраты, прошедшие через баланс id (без id — через любой): [{ debt, pay }]
function debtPays(id) {
  return debts.items.flatMap((d) => (d.pays || [])
    .filter((p) => p.b && (!id || p.b === id))
    .map((p) => ({ debt: d, pay: p })));
}

function findPay(key) {
  const [debtId, payId] = key.split(':');
  const d = debts.find(debtId);
  return [d, (d.pays || []).find((p) => p.id === payId)];
}

function confirmDeleteDebt(id) {
  const d = debts.find(id);
  const linked = (d.pays || []).some((p) => p.b);
  const extra = linked ? `\n${t('Его возвраты пропадут и из истории баланса.')}` : '';
  return confirmDialog(`${t('Удалить долг «{0}»?', d.who)}${extra}`);
}

function deleteDebtData(id) {
  flash = 'total';
  debts.items = debts.items.filter((d) => d.id !== id);
  return debts.save();
}

deleters.debt = { confirm: confirmDeleteDebt, remove: deleteDebtData };
deleters.pay = {
  confirm: (key) => confirmDialog(t('Удалить возврат {0}?', formatMoney(findPay(key)[1].a))),
  remove: (key) => {
    const [d, pay] = findPay(key);
    flash = 'total';
    d.pays = d.pays.filter((p) => p !== pay);
    return debts.save();
  },
};

// ---------- Отображение ----------

const PART_ICON = '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>';
const ALL_ICON = '<path d="m5 12.5 4.5 4.5L19 7.5"/>';

// «Я должен / Мне должны»
function debtChipsHtml(route) {
  const dir = debtDir(route);
  const chip = (key, label) => `
    <button class="chip${dir === key ? ' active' : ''}" data-act="set-debt-dir" data-key="${key}">${label}</button>`;
  return `<div class="chips">${chip('out', t('Я должен'))}${chip('in', t('Мне должны'))}</div>`;
}

function debtCardHtml(route) {
  const dir = debtDir(route);
  const out = dir === 'out';
  const open = debts.items.filter((d) => d.dir === dir && !isPaid(d)).length;
  const total = formatMoney(debtsTotal(dir));
  return `
    <div class="total-card">
      <p class="total-head">${t(out ? 'Я должен' : 'Мне должны')}</p>
      <b class="total-sum${sumSize(total)}${takeFlash('total') ? ' swap' : ''}">${total}</b>
      <span class="total-sub">${open ? plural(open, ['долг', 'долга', 'долгов']) : t('Долгов нет')}</span>
    </div>`;
}

function debtRowHtml(d, n) {
  const paid = isPaid(d);
  const returned = sum(d.pays || []);
  let note;
  if (paid) note = t('Погашен {0}', formatDate(paidAt(d)));
  else if (returned) note = t('Возвращено {0} из {1}', formatMoney(returned), formatMoney(d.a));
  else note = d.n ? esc(d.n) : t('С {0}', formatDate(d.t));
  return `
    <div class="swipe${takeFlash(d.id) ? ' appear' : ''}" style="--i:${n}">
      <button class="swipe-del" data-act="swipe-delete" data-kind="debt" data-id="${d.id}">${t('Удалить')}</button>
      <button class="row${paid ? ' paid' : ''}" data-act="open-debt" data-id="${d.id}">
        ${avatar(d.who)}
        <span class="title-wrap">
          <span class="title">${esc(d.who)}</span>
          <span class="subtitle">${note}</span>
        </span>
        <span class="meta amount">${formatMoney(paid ? d.a : debtLeft(d))}</span>
        ${CHEVRON}
      </button>
    </div>`;
}

// Сначала активные (свежие сверху), потом погашенные (недавно погашенные сверху), с листанием
function debtListHtml(route) {
  const dir = debtDir(route);
  const mine = debts.items.filter((d) => d.dir === dir);
  if (!mine.length) return `<p class="empty small">${t('Нажми ＋, чтобы записать долг')}</p>`;
  const open = mine.filter((d) => !isPaid(d)).sort((a, b) => b.t - a.t);
  const paid = mine.filter(isPaid).sort((a, b) => paidAt(b) - paidAt(a));
  return groupedPage([...open, ...paid], route, (d) => (isPaid(d)
    ? { key: 'paid', label: `${t('Погашенные')} · ${paid.length}` }
    : { key: 'open', label: t('Активные') }), debtRowHtml);
}

// Всё, что под лентой «Я должен / Мне должны»: сумма и список
function debtBlockHtml(route) {
  return `
    ${debtCardHtml(route)}
    <div class="paged">${debtListHtml(route)}</div>`;
}

function debtsPageHtml(route) {
  return `
    ${debtChipsHtml(route)}
    <div class="debt-box paged">${debtBlockHtml(route)}</div>`;
}

// Возврат в истории баланса: нажал — открылся долг
function debtHistoryRowHtml({ debt, pay }, route) {
  const out = debt.dir === 'out';
  const note = [t(out ? 'Возврат долга' : 'Мне вернули долг'), route.acc ? '' : accountName(pay.b)]
    .filter(Boolean).join(' · ');
  return `
    <button class="row" data-act="open-debt" data-id="${debt.id}">
      ${avatar(debt.who)}
      <span class="title-wrap">
        <span class="title">${esc(debt.who)}</span>
        <span class="subtitle">${note}</span>
      </span>
      <span class="meta amount">${signedMoney(payDelta(debt, pay))}</span>
    </button>`;
}

function payRowHtml(d, p, n) {
  return `
    <div class="swipe${takeFlash(p.id) ? ' appear' : ''}" style="--i:${n}">
      <button class="swipe-del" data-act="swipe-delete" data-kind="pay" data-id="${d.id}:${p.id}">${t('Удалить')}</button>
      <div class="row static">
        <span class="title-wrap">
          <span class="title">${dayLabel(dayKey(new Date(p.t)))}</span>
          <span class="subtitle">${accountName(p.b) || t('Без баланса')}</span>
        </span>
        <span class="meta amount">${formatMoney(p.a)}</span>
      </div>
    </div>`;
}

// Карточка долга: сколько осталось, возвраты, подпись и комментарий правятся прямо здесь
views.debt = (route) => {
  const d = debts.find(route.id);
  if (!d) return `<p class="empty">${t('Долг не найден')}</p>`;
  const out = d.dir === 'out';
  const paid = isPaid(d);
  const returned = sum(d.pays || []);
  const left = formatMoney(paid ? d.a : debtLeft(d));
  const head = paid ? t('Долг погашен') : t(out ? 'Осталось вернуть' : 'Осталось получить');
  let note;
  if (paid) note = t('Погашен {0}', formatDate(paidAt(d)));
  else if (returned) note = t('Возвращено {0} из {1}', formatMoney(returned), formatMoney(d.a));
  else note = t('С {0}', formatDate(d.t));
  const pays = [...(d.pays || [])].sort((a, b) => b.t - a.t);
  const labels = out ? [t('Вернуть часть'), t('Вернуть всё')] : [t('Получить часть'), t('Получить всё')];
  return `
    ${headHtml(t(out ? 'Я должен' : 'Мне должны'), editHtml('debt-who', d.id, d.who, {
      placeholder: t(out ? 'Кому или за что' : 'Кто или за что'), max: DEBT_WHO_MAX,
    }))}
    <div class="total-card">
      <p class="total-head">${head}</p>
      <b class="total-sum${sumSize(left)}${takeFlash('total') ? ' swap' : ''}">${left}</b>
      <span class="total-sub">${note}</span>
    </div>
    ${paid ? '' : `
    <div class="quick-btns bal-actions">
      <button class="btn quick-btn" data-act="debt-pay" data-id="${d.id}">${icon(PART_ICON)}${labels[0]}</button>
      <button class="btn quick-btn" data-act="debt-pay" data-id="${d.id}" data-all="1">${icon(ALL_ICON)}${labels[1]}</button>
    </div>`}
    <div class="card">
      ${editHtml('debt-note', d.id, d.n, { placeholder: t('Комментарий…'), max: NOTE_MAX })}
    </div>
    ${pays.length ? `
      <p class="group-head">${t('Возвраты')}</p>
      <div class="group">${pays.map((p, n) => payRowHtml(d, p, n)).join('')}</div>` : ''}
    <div class="group">
      <button class="row" data-act="debt-amount" data-id="${d.id}">
        <span class="title">${t('Сумма долга')}</span>
        <span class="meta${takeFlash('amount:' + d.id) ? ' swap' : ''}">${formatMoney(d.a)}</span>
        ${CHEVRON}
      </button>
      <button class="row" data-act="debt-date" data-id="${d.id}">
        <span class="title">${t('Дата')}</span>
        <span class="meta${takeFlash('date:' + d.id) ? ' swap' : ''}">${dayLabel(dayKey(new Date(d.t)))}</span>
        ${CHEVRON}
      </button>
    </div>
    <div class="group">
      <button class="row danger" data-act="delete-debt" data-id="${d.id}">${t('Удалить долг')}</button>
    </div>`;
};

editors['debt-who'] = {
  required: true,
  get: (id) => debts.find(id).who,
  save: (id, value) => {
    debts.find(id).who = value;
    return debts.save();
  },
};
editors['debt-note'] = {
  get: (id) => debts.find(id).n || '',
  save: (id, value) => {
    debts.find(id).n = value;
    return debts.save();
  },
};

// ---------- Действия ----------

// Вернуть (или получить) часть или весь остаток. Деньги — с выбранного баланса или на него
async function askPay(d, all) {
  const out = d.dir === 'out';
  const left = debtLeft(d);
  const titles = out ? [t('Вернуть часть'), t('Вернуть всё')] : [t('Получить часть'), t('Получить всё')];
  const res = await ask({
    title: titles[all ? 1 : 0],
    fields: [{
      value: all ? amountText(left) : '',
      placeholder: t('Сумма, {0}', CURRENCY),
      max: 14,
      inputmode: 'decimal',
      check: (text) => checkAmount(text) || (parseAmount(text) > left ? t('Больше, чем осталось: {0}', formatMoney(left)) : null),
    }],
    date: dayKey(),
    picks: accounts.items.length
      ? [accountPick(t(out ? 'Откуда списать' : 'Куда зачислить'), lastPaidFrom(), t(out ? 'Не списывать' : 'Не зачислять'))]
      : [],
  });
  if (!res) return;
  const [amount, day, picked] = res;
  const pay = { id: newId(), a: parseAmount(amount), t: dayMoment(day) };
  if (picked && picked !== 'none') pay.b = picked;
  const closes = pay.a >= left;
  flash = new Set([pay.id, 'total']);
  const ok = await commit(() => {
    d.pays = [...(d.pays || []), pay];
    return debts.save();
  }, refresh, closes ? null : haptic);
  if (ok && closes) {
    successHaptic();
    toast(t('Долг погашен'));
  }
}

Object.assign(actions, {
  // «Я должен / Мне должны»: сумма и список меняются на месте
  'set-debt-dir': ({ key }, el) => {
    const route = currentRoute();
    if (debtDir(route) === key) return;
    route.dir = key;
    route.page = 0;
    el.closest('.chips').querySelectorAll('.chip').forEach((chip) => chip.classList.toggle('active', chip === el));
    swapContent(el.closest('.screen-inner').querySelector('.debt-box'), debtBlockHtml(route));
    softHaptic();
  },

  // Новый долг: сумма, кому (или кто) и за что, комментарий и дата
  'new-debt': async () => {
    const route = currentRoute();
    const dir = debtDir(route);
    const out = dir === 'out';
    const res = await ask({
      title: t(out ? 'Я должен' : 'Мне должны'),
      fields: [
        { placeholder: t('Сумма, {0}', CURRENCY), max: 14, inputmode: 'decimal', check: checkAmount },
        { placeholder: t(out ? 'Кому или за что' : 'Кто или за что'), max: DEBT_WHO_MAX },
        { placeholder: t('Комментарий — необязательно'), max: NOTE_MAX, optional: true },
      ],
      date: dayKey(),
    });
    if (!res) return;
    const [amount, who, note, day] = res;
    const debt = { id: newId(), dir, a: parseAmount(amount), who, n: note, t: dayMoment(day), pays: [] };
    route.page = 0;
    flash = new Set([debt.id, 'total']);
    await commit(() => {
      debts.items.push(debt);
      return debts.save();
    });
  },

  'open-debt': ({ id }) => go({ name: 'debt', id }),

  'debt-pay': ({ id, all }) => askPay(debts.find(id), Boolean(all)),

  // Сумма долга: меньше уже возвращённого — нельзя
  'debt-amount': async ({ id }) => {
    const d = debts.find(id);
    const returned = sum(d.pays || []);
    const res = await ask({
      title: t('Сумма долга'),
      fields: [{
        value: amountText(d.a),
        placeholder: t('Сумма, {0}', CURRENCY),
        max: 14,
        inputmode: 'decimal',
        check: (text) => checkAmount(text) || (parseAmount(text) < returned ? t('Уже возвращено {0} — меньше нельзя', formatMoney(returned)) : null),
      }],
    });
    if (!res || parseAmount(res[0]) === d.a) return;
    flash = new Set(['amount:' + id, 'total']);
    await commit(() => {
      d.a = parseAmount(res[0]);
      return debts.save();
    });
  },

  // Когда появился долг: сегодня, вчера или любой прошедший день
  'debt-date': async ({ id }) => {
    const d = debts.find(id);
    const today = dayKey();
    const picked = await choose({
      title: t('Дата'),
      options: [
        { key: today, label: t('Сегодня') },
        { key: addDays(today, -1), label: t('Вчера') },
        { label: t('Выбрать дату…'), date: dayKey(new Date(d.t)) },
      ],
    });
    if (!picked || picked === dayKey(new Date(d.t))) return;
    if (picked > today) {
      toast(t('Дата не может быть в будущем'));
      return;
    }
    flash = 'date:' + id;
    await commit(() => {
      d.t = keyToDate(picked).setHours(12);
      return debts.save();
    });
  },

  'delete-debt': async ({ id }) => {
    if (!(await confirmDeleteDebt(id))) return;
    await commit(() => deleteDebtData(id), back);
  },
});
