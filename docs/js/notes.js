'use strict';

// Модуль «Заметки»: быстрые записи, закрепление, поиск

// ---------- Данные ----------
// notes.items: [{id, title, text, pin, at, up}] — хранятся пачками в ключах notes_0, notes_1, …
//   pin — закреплена, at — создана, up — изменена

const notes = makeBucket('notes_');
const NOTE_TITLE_MAX = 80;
const NOTE_TEXT_MAX = 3000;

modules.notes = { load: (raw) => notes.load(raw) };

// Свежие сверху
function sortedNotes(list) {
  return [...list].sort((a, b) => b.up - a.up);
}

function confirmDeleteNote(id) {
  return confirmDialog(`Удалить заметку «${shorten(notes.find(id).title, 40)}»?`);
}

function deleteNoteData(id) {
  notes.items = notes.items.filter((n) => n.id !== id);
  return notes.save();
}

deleters.note = { confirm: confirmDeleteNote, remove: deleteNoteData };

// ---------- Отображение ----------

// Строка заметки: заголовок, под ним время изменения и начало текста.
// query — подсветить найденное (в поиске)
function noteRowHtml(note, n, query) {
  let preview = (note.text || '').replace(/\s+/g, ' ').trim();
  preview = query ? (snippet(note.text || '', query) || esc(preview)) : esc(preview);
  return `
    <div class="swipe${takeFlash(note.id) ? ' appear' : ''}" style="--i:${n}">
      <button class="swipe-del" data-act="swipe-delete" data-kind="note" data-id="${note.id}">Удалить</button>
      <button class="row" data-act="open-note" data-id="${note.id}">
        <span class="title-wrap">
          <span class="title">${query ? highlight(note.title, query) : esc(note.title)}</span>
          <span class="subtitle">${whenLabel(note.up)}${preview ? ' · ' + preview : ''}</span>
        </span>
        ${CHEVRON}
      </button>
    </div>`;
}

// Незакреплённые заметки с листанием (закреплённые показываются отдельно, без листания)
function notesListHtml(route) {
  const others = sortedNotes(notes.items.filter((n) => !n.pin));
  if (!others.length) return '';
  const p = paginate(others, route);
  const head = notes.items.some((n) => n.pin) ? '<p class="group-head">Заметки</p>' : '';
  const rows = p.items.map((note, n) => noteRowHtml(note, n)).join('');
  return `${head}<div class="page-items"><div class="group">${rows}</div></div>${pagerHtml(p)}`;
}

function notesSearchHtml(route) {
  const query = (route.q || '').trim();
  const q = norm(query);
  const list = sortedNotes(notes.items.filter((n) => norm(n.title).includes(q) || norm(n.text || '').includes(q)));
  if (!list.length) return '<p class="empty small">Ничего не найдено</p>';
  const p = paginate(list, route);
  const rows = p.items.map((note, n) => noteRowHtml(note, n, query)).join('');
  return `
    <p class="group-head">Найдено · ${list.length}</p>
    <div class="page-items"><div class="group">${rows}</div></div>${pagerHtml(p)}`;
}

// Листание: в поиске — результаты, иначе — обычный список
pagers.notes = (route) => ((route.q || '').trim() ? notesSearchHtml(route) : notesListHtml(route));

searchHandlers.notes = (route, query, inner) => {
  const results = inner.querySelector('.search-results');
  if (query) results.innerHTML = notesSearchHtml(route);
  showSearchState(inner, Boolean(query));
};

// ---------- Экраны ----------

views.notes = (route) => {
  const total = notes.items.length;
  const searching = Boolean((route.q || '').trim());
  const pinned = sortedNotes(notes.items.filter((n) => n.pin));
  const pinnedHtml = pinned.length
    ? `<p class="group-head">Закреплённые</p><div class="group">${pinned.map((note, n) => noteRowHtml(note, n)).join('')}</div>`
    : '';

  return `
    <h1>Заметки</h1>
    <p class="sub">${total ? plural(total, ['заметка', 'заметки', 'заметок']) : 'Заметок пока нет'}</p>
    <div class="actions">
      <button class="btn primary" data-act="new-note">➕ Новая заметка</button>
    </div>
    ${total ? searchHtml(route.q, 'Поиск по заметкам') : ''}
    <div class="search-results paged${searching ? '' : ' hidden'}">${searching ? notesSearchHtml(route) : ''}</div>
    <div class="search-body${searching ? ' hidden' : ''}">
      ${pinnedHtml}
      <div class="paged">${notesListHtml(route)}</div>
    </div>`;
};

views.note = (route) => {
  const note = notes.find(route.id);
  if (!note) return '<p class="empty">Заметка не найдена</p>';

  // Заголовок и текст правятся прямо здесь — нажал и пишешь
  return `
    <h1>${editHtml('note-title', note.id, note.title, { placeholder: 'Заголовок', max: NOTE_TITLE_MAX })}</h1>
    <p class="sub">${note.pin ? 'Закреплена · ' : ''}Изменена ${formatDate(note.up)}</p>
    <div class="card">
      ${editHtml('note-text', note.id, note.text, {
        placeholder: 'Текст заметки…', max: NOTE_TEXT_MAX, multiline: true, cls: 'idea-text',
      })}
    </div>
    <div class="group">
      <button class="row" data-act="pin-note" data-id="${note.id}">${note.pin ? 'Открепить' : 'Закрепить'}</button>
      <button class="row" data-act="copy-note" data-id="${note.id}">Скопировать текст</button>
      <button class="row danger" data-act="delete-note" data-id="${note.id}">Удалить заметку</button>
    </div>`;
};

// Правка заголовка и текста заметки на месте (см. editHtml в ui.js)
editors['note-title'] = {
  required: true,
  get: (id) => notes.find(id).title,
  save: (id, value) => {
    const note = notes.find(id);
    note.title = value;
    note.up = Date.now();
    return notes.save();
  },
};
editors['note-text'] = {
  get: (id) => notes.find(id).text || '',
  save: (id, value) => {
    const note = notes.find(id);
    note.text = value;
    note.up = Date.now();
    return notes.save();
  },
};

// ---------- Действия ----------

function noteFields(note = { title: '', text: '' }) {
  return [
    { value: note.title, placeholder: 'Заголовок', max: NOTE_TITLE_MAX },
    { value: note.text, placeholder: 'Текст', max: NOTE_TEXT_MAX, multiline: true, optional: true },
  ];
}

Object.assign(actions, {
  'new-note': async () => {
    const res = await ask({ title: 'Новая заметка', fields: noteFields() });
    if (!res) return;
    const [title, text] = res;
    const now = Date.now();
    const note = { id: newId(), title, text, pin: false, at: now, up: now };
    flash = note.id;
    currentRoute().page = 0; // новая — первая в списке
    return commit(() => {
      notes.items.push(note);
      return notes.save();
    });
  },

  'open-note': ({ id }) => go({ name: 'note', id }),

  'pin-note': async ({ id }) => {
    const note = notes.find(id);
    const ok = await commit(() => {
      note.pin = !note.pin;
      return notes.save();
    });
    if (ok) toast(note.pin ? 'Закреплено' : 'Откреплено');
  },

  'copy-note': async ({ id }) => {
    const note = notes.find(id);
    const ok = await copyText(note.text ? `${note.title}\n\n${note.text}` : note.title);
    toast(ok ? 'Скопировано' : 'Не удалось скопировать');
    if (ok) softHaptic();
  },

  'delete-note': async ({ id }) => {
    if (!(await confirmDeleteNote(id))) return;
    await commit(() => deleteNoteData(id), back);
  },
});
