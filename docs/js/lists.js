'use strict';

// Модуль «Списки»: покупки, вещи в поездку — пункты с галочками

// ---------- Данные ----------
// lists.items: [{id, name, items: [{id, t, d}], at, up}] — хранятся пачками в ключах lists_0, lists_1, …
//   t — текст пункта, d — отмечен, at — создан, up — изменён (для порядка на вкладке)

const lists = makeBucket('lists_');
const LIST_NAME_MAX = 50;
const LITEM_MAX = 80;

modules.lists = { load: (raw) => lists.load(raw) };

// «осталось 3 из 8», «Всё отмечено», «Пусто»
function listSummary(list) {
  const total = list.items.length;
  const left = list.items.filter((i) => !i.d).length;
  if (!total) return 'Пусто';
  if (!left) return 'Всё отмечено';
  return `осталось ${left} из ${total}`;
}

function confirmDeleteList(id) {
  return confirmDialog(`Удалить список «${shorten(lists.find(id).name, 40)}»?`);
}

function deleteListData(id) {
  lists.items = lists.items.filter((l) => l.id !== id);
  return lists.save();
}

deleters.list = { confirm: confirmDeleteList, remove: deleteListData };
// Пункт удаляется сразу, без вопроса. id — «список:пункт»
deleters.litem = {
  confirm: async () => true,
  remove: (key) => {
    const [listId, itemId] = key.split(':');
    const list = lists.find(listId);
    list.items = list.items.filter((i) => i.id !== itemId);
    return lists.save();
  },
};

// ---------- Отображение ----------

function listRowHtml(list, n) {
  const left = list.items.filter((i) => !i.d).length;
  return `
    <div class="swipe${takeFlash(list.id) ? ' appear' : ''}" style="--i:${n}">
      <button class="swipe-del" data-act="swipe-delete" data-kind="list" data-id="${list.id}">Удалить</button>
      <button class="row" data-act="open-list" data-id="${list.id}">
        <span class="title-wrap">
          <span class="title">${esc(list.name)}</span>
          <span class="subtitle">${listSummary(list)}</span>
        </span>
        ${left ? `<span class="meta">${left}</span>` : ''}
        ${CHEVRON}
      </button>
    </div>`;
}

// Пункт списка: нажатие — отметить, свайп — удалить
function litemRowHtml(list, it, n) {
  return `
    <div class="swipe${takeFlash(it.id) ? ' appear' : ''}" style="--i:${n}" data-item="${it.id}">
      <button class="swipe-del" data-act="swipe-delete" data-kind="litem" data-id="${list.id}:${it.id}">Удалить</button>
      <button class="row check-row${it.d ? ' checked' : ''}" data-act="toggle-litem" data-id="${list.id}" data-item="${it.id}">
        ${CHECK}
        <span class="title wrap">${esc(it.t)}</span>
      </button>
    </div>`;
}

// ---------- Экраны ----------

views.lists = () => {
  const all = [...lists.items].sort((a, b) => b.up - a.up); // недавно изменённые сверху
  const rows = all.map(listRowHtml).join('');
  return `
    <h1>Списки</h1>
    <p class="sub">${all.length ? plural(all.length, ['список', 'списка', 'списков']) : 'Списков пока нет'}</p>
    <div class="actions">
      <button class="btn primary" data-act="new-list">➕ Новый список</button>
    </div>
    ${rows ? `<div class="group">${rows}</div>` : ''}`;
};

views.list = (route) => {
  const list = lists.find(route.id);
  if (!list) return '<p class="empty">Список не найден</p>';
  const todo = list.items.filter((i) => !i.d);
  const done = list.items.filter((i) => i.d);

  return `
    <h1>${editHtml('list-name', list.id, list.name, { placeholder: 'Название', max: LIST_NAME_MAX })}</h1>
    <p class="sub list-sub">${listSummary(list)}</p>
    <div class="group quick">
      <label class="row quick-row">
        <span class="plus">+</span>
        <input class="quick-add" data-list="${list.id}" placeholder="Добавить пункт" maxlength="${LITEM_MAX}"
          autocomplete="off" enterkeyhint="enter">
      </label>
    </div>
    <div class="group todo-group">${todo.map((it, n) => litemRowHtml(list, it, n)).join('')}</div>
    ${done.length ? `
      <p class="group-head">Отмечено · ${done.length}</p>
      <div class="group">${done.map((it, n) => litemRowHtml(list, it, n)).join('')}</div>
      <div class="group">
        <button class="row" data-act="uncheck-litems" data-id="${list.id}">Снять все отметки</button>
        <button class="row danger" data-act="clear-litems" data-id="${list.id}">Удалить отмеченные</button>
      </div>` : ''}
    <div class="group">
      <button class="row danger" data-act="delete-list" data-id="${list.id}">Удалить список</button>
    </div>`;
};

// Название списка правится прямо на экране
editors['list-name'] = {
  required: true,
  get: (id) => lists.find(id).name,
  save: (id, value) => {
    const list = lists.find(id);
    list.name = value;
    list.up = Date.now();
    return lists.save();
  },
};

// ---------- Быстрое добавление ----------
// Enter в поле «Добавить пункт» — пункт появляется сразу под полем, клавиатура остаётся.
// Экран не перерисовываем, иначе клавиатура спрячется

async function addQuickItem(input) {
  const text = input.value.replace(/\s+/g, ' ').trim();
  if (!text) {
    input.blur(); // Enter в пустом поле — спрятать клавиатуру
    return;
  }
  const list = lists.find(input.dataset.list);
  const item = { id: newId(), t: text.slice(0, LITEM_MAX), d: false };
  list.items.unshift(item); // новые сверху — их не закроет клавиатура
  list.up = Date.now();
  input.value = '';
  flash = item.id;
  const inner = input.closest('.screen-inner');
  inner.querySelector('.todo-group').insertAdjacentHTML('afterbegin', litemRowHtml(list, item, 0));
  inner.querySelector('.list-sub').textContent = listSummary(list);
  const ok = await commit(() => lists.save(), () => {});
  if (!ok) refresh();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList.contains('quick-add')) {
    e.preventDefault();
    addQuickItem(e.target);
  }
});

// ---------- Отметка: пункт уезжает вниз ----------
// Галочка ставится сразу, а через паузу отмеченные строки схлопываются и экран перерисовывается —
// пункты оказываются в своих блоках. Если отметить несколько подряд, уедут вместе

const MOVE_DELAY = 650;
let moveTimer;

async function settleMoves(listId) {
  const route = currentRoute();
  if (route.name !== 'list' || route.id !== listId) return; // уже ушли со списка
  const rows = [...screens[screens.length - 1].querySelectorAll('.swipe.moving')];
  if (!rows.length) return;
  flash = new Set(rows.map((r) => r.dataset.item));
  await Promise.all(rows.map(collapse));
  if (currentRoute() === route) refresh();
}

// ---------- Действия ----------

Object.assign(actions, {
  'new-list': async () => {
    const res = await ask({ title: 'Новый список', fields: [{ placeholder: 'Например, «Продукты»', max: LIST_NAME_MAX }] });
    if (!res) return;
    const now = Date.now();
    const list = { id: newId(), name: res[0], items: [], at: now, up: now };
    // Сразу открываем новый список — можно добавлять пункты. Если не сохранился — просто обновляем экран
    await commit(() => {
      lists.items.push(list);
      return lists.save();
    }, () => (lists.find(list.id) ? go({ name: 'list', id: list.id }) : refresh()));
  },

  'open-list': ({ id }) => go({ name: 'list', id }),

  'toggle-litem': async ({ id, item }, el) => {
    const list = lists.find(id);
    const it = list.items.find((i) => i.id === item);
    it.d = !it.d;
    list.up = Date.now();
    el.classList.add('just');
    el.classList.toggle('checked', it.d);
    // Отметил и сразу снял — строка остаётся на месте
    el.closest('.swipe').classList.toggle('moving');
    el.closest('.screen-inner').querySelector('.list-sub').textContent = listSummary(list);
    const ok = await commit(() => lists.save(), () => {});
    if (!ok) {
      refresh();
      return;
    }
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => settleMoves(id), MOVE_DELAY);
  },

  // Снять все отметки — список снова как новый (удобно для сборов в поездку)
  'uncheck-litems': async ({ id }) => {
    const list = lists.find(id);
    const checked = list.items.filter((i) => i.d);
    flash = new Set(checked.map((i) => i.id));
    await commit(() => {
      checked.forEach((i) => { i.d = false; });
      list.up = Date.now();
      return lists.save();
    });
  },

  'clear-litems': async ({ id }) => {
    const list = lists.find(id);
    const count = list.items.filter((i) => i.d).length;
    if (!(await confirmDialog(`Удалить отмеченные пункты (${count})?`))) return;
    await commit(() => {
      list.items = list.items.filter((i) => !i.d);
      list.up = Date.now();
      return lists.save();
    });
  },

  'delete-list': async ({ id }) => {
    if (!(await confirmDeleteList(id))) return;
    await commit(() => deleteListData(id), back);
  },
});
