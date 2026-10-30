'use strict';

// Резервная копия: все данные приложения одним текстом — скопировать, скачать файлом, восстановить

const BACKUP_APP = 'mindo';
const STORE_LIMIT = 1024; // столько записей даёт облако Telegram одному пользователю
const KEY_RE = /^[A-Za-z0-9_-]{1,128}$/; // какие названия записей разрешает Telegram

// Текст копии: {app, v, at, data: {запись: значение, …}}
function backupText() {
  return JSON.stringify({ app: BACKUP_APP, v: 1, at: Date.now(), data: lastRaw });
}

function downloadText(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

// Восстановить из текста копии: проверить, спросить, заменить данные и перезапустить приложение
async function restoreBackup(text) {
  const backup = parse(String(text).trim());
  if (!backup || backup.app !== BACKUP_APP || !backup.data || typeof backup.data !== 'object') {
    toast('Это не похоже на копию «Мои планы»');
    return;
  }
  const entries = Object.entries(backup.data)
    .filter(([key, value]) => KEY_RE.test(key) && typeof value === 'string' && value.length <= 4096);
  if (!entries.length || entries.length > STORE_LIMIT) {
    toast('Копия повреждена');
    return;
  }
  const question = `Восстановить копию от ${formatDate(backup.at)}?\nТекущие данные будут заменены.`;
  if (!(await confirmDialog(question))) return;

  toast('Восстанавливаю…');
  try {
    const current = await store.loadAll();
    const keep = new Set(entries.map(([key]) => key));
    for (const key of Object.keys(current)) {
      if (!keep.has(key)) await store.remove(key);
    }
    for (const [key, value] of entries) {
      if (current[key] !== value) await store.set(key, value);
    }
  } catch (err) {
    console.error(err);
    toast('Не удалось восстановить — попробуй ещё раз');
    return;
  }
  toast('Копия восстановлена');
  await wait(800);
  window.location.reload(); // проще всего показать восстановленные данные — перезапустить
}

// ---------- Экран ----------

views.backup = () => {
  const used = Object.keys(lastRaw).length;
  return `
    <h1>Резервная копия</h1>
    <p class="sub">Планы, заметки, списки, привычки и расходы</p>
    <div class="card">
      <p class="idea-text muted">Всё хранится в облаке Telegram. На всякий случай сохрани копию:
      нажми «Скопировать копию» и вставь текст в «Избранное» Telegram.</p>
    </div>
    <div class="group">
      <button class="row" data-act="backup-copy"><span class="title">Скопировать копию</span></button>
      <button class="row" data-act="backup-download"><span class="title">Скачать файлом</span></button>
    </div>
    <div class="group">
      <button class="row" data-act="backup-paste"><span class="title">Восстановить из текста</span></button>
      <label class="row">
        <span class="title">Восстановить из файла</span>
        <input type="file" class="restore-file" accept=".json,application/json,text/plain" hidden>
      </label>
    </div>
    <p class="group-head">Хранилище</p>
    <div class="group">
      <div class="row static"><span class="title">Записей занято</span><span class="meta">${used} из ${STORE_LIMIT}</span></div>
    </div>`;
};

// Выбран файл копии — читаем и восстанавливаем
document.addEventListener('change', async (e) => {
  if (!e.target.classList.contains('restore-file') || !e.target.files.length) return;
  const text = await e.target.files[0].text();
  e.target.value = ''; // чтобы тот же файл можно было выбрать ещё раз
  await restoreBackup(text);
});

Object.assign(actions, {
  // Перед открытием перечитываем хранилище — копия будет свежей
  'open-backup': async () => {
    try {
      await loadData();
    } catch {
      toast('Не удалось прочитать данные');
      return;
    }
    go({ name: 'backup' });
  },

  // Копируем сразу по нажатию: телефоны разрешают буфер обмена только в момент нажатия
  'backup-copy': async () => {
    const ok = await copyText(backupText());
    toast(ok ? 'Скопировано — вставь в «Избранное» Telegram' : 'Не удалось скопировать — попробуй «Скачать файлом»');
    if (ok) softHaptic();
  },

  'backup-download': () => {
    try {
      downloadText(`mindo-backup-${dayKey()}.json`, backupText());
      toast('Файл сохранён');
    } catch {
      toast('Скачивание здесь не работает — используй «Скопировать копию»');
    }
  },

  'backup-paste': async () => {
    const res = await ask({
      title: 'Вставь текст копии',
      fields: [{ placeholder: 'Длинный текст, начинается с {"app":"mindo"…', max: 5000000, multiline: true }],
    });
    if (res) await restoreBackup(res[0]);
  },
});
