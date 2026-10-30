'use strict';

// Основа: Telegram, хранилище, загрузка данных модулей и мелкие помощники

// ---------- Telegram ----------

const tg = window.Telegram ? window.Telegram.WebApp : null;
const inTelegram = Boolean(tg && tg.initData);

if (inTelegram) {
  tg.ready();
  tg.expand();
  // Чтобы прокрутка списка вниз не сворачивала приложение
  if (tg.isVersionAtLeast('7.7')) tg.disableVerticalSwipes();
}

// ---------- Хранилище ----------
// В Telegram данные лежат в облаке Telegram, в обычном браузере — в localStorage (для просмотра)

const useCloud = inTelegram && tg.isVersionAtLeast('6.9');
const LS_PREFIX = 'mindo:';

function cloudCall(method, ...args) {
  return new Promise((resolve, reject) => {
    tg.CloudStorage[method](...args, (err, result) => (err ? reject(new Error(err)) : resolve(result)));
  });
}

const store = {
  async loadAll() {
    const out = {};
    if (!useCloud) {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith(LS_PREFIX)) out[key.slice(LS_PREFIX.length)] = localStorage.getItem(key);
      }
      return out;
    }
    const keys = await cloudCall('getKeys');
    // Читаем порциями, чтобы не упереться в лимиты Telegram
    for (let i = 0; i < keys.length; i += 100) {
      Object.assign(out, await cloudCall('getItems', keys.slice(i, i + 100)));
    }
    return out;
  },
  async set(key, value) {
    if (useCloud) await cloudCall('setItem', key, value);
    else localStorage.setItem(LS_PREFIX + key, value);
  },
  async remove(key) {
    if (useCloud) await cloudCall('removeItem', key);
    else localStorage.removeItem(LS_PREFIX + key);
  },
};

// ---------- Модули ----------
// Каждый модуль (планы, заметки, …) регистрирует здесь load(raw) — как разобрать свои данные
// из общего хранилища. raw — все ключи и значения сразу

const modules = {};

async function loadData() {
  const raw = await store.loadAll();
  Object.values(modules).forEach((m) => m.load(raw));
}

function parse(value) {
  try { return JSON.parse(value); } catch { return null; }
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ---------- Мелочи ----------

function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Обрезает длинный текст до n символов (для вопросов «Удалить …?»)
function shorten(text, n) {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > n ? line.slice(0, n - 1) + '…' : line;
}

// 1 план, 2 плана, 5 планов
function plural(n, [one, few, many]) {
  const d = n % 10;
  const dd = n % 100;
  const word = d === 1 && dd !== 11 ? one : d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? few : many;
  return `${n} ${word}`;
}

// «30 октября», а для прошлых лет — «30 октября 2025 г.»
function formatDate(ms) {
  const date = new Date(ms);
  const opts = { day: 'numeric', month: 'long' };
  if (date.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return date.toLocaleDateString('ru-RU', opts);
}

// Короткая дата для списков: «30 окт.»
function formatShort(ms) {
  return new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

// ---------- Дни ----------
// Сроки храним строкой «2026-10-30» по местному времени — так их легко сравнивать

function dayKey(date = new Date()) {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

function keyToDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(key, n) {
  const date = keyToDate(key);
  date.setDate(date.getDate() + n);
  return dayKey(date);
}

// Следующая дата повтора после key. rep: day / weekdays / week / month / year.
// anchor — «родное» число месяца: после 28 февраля месячный повтор вернётся на 31-е
function stepRepeat(key, rep, anchor) {
  const date = keyToDate(key);
  if (rep === 'month' || rep === 'year') {
    const y = date.getFullYear() + (rep === 'year' ? 1 : 0);
    const m = date.getMonth() + (rep === 'month' ? 1 : 0);
    const last = new Date(y, m + 1, 0).getDate(); // дней в том месяце
    return dayKey(new Date(y, m, Math.min(anchor || date.getDate(), last)));
  }
  if (rep === 'week') {
    date.setDate(date.getDate() + 7);
  } else {
    date.setDate(date.getDate() + 1);
    // По будням — пропускаем субботу (6) и воскресенье (0)
    while (rep === 'weekdays' && (date.getDay() === 0 || date.getDay() === 6)) date.setDate(date.getDate() + 1);
  }
  return dayKey(date);
}

// Коротко: «Сегодня», «Завтра», «Вчера», иначе «5 нояб.»
function dayLabel(key) {
  const today = dayKey();
  if (key === today) return 'Сегодня';
  if (key === addDays(today, 1)) return 'Завтра';
  if (key === addDays(today, -1)) return 'Вчера';
  const date = keyToDate(key);
  const opts = { day: 'numeric', month: 'short' };
  if (date.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return date.toLocaleDateString('ru-RU', opts);
}

// Подробно, для заголовков: «Сегодня», «Завтра», иначе «Пятница, 7 ноября»
function dayLabelLong(key) {
  const today = dayKey();
  if (key === today) return 'Сегодня';
  if (key === addDays(today, 1)) return 'Завтра';
  const date = keyToDate(key);
  const opts = { weekday: 'long', day: 'numeric', month: 'long' };
  if (date.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  const text = date.toLocaleDateString('ru-RU', opts);
  return text[0].toUpperCase() + text.slice(1);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let toastTimer;
function toast(text) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

// Лёгкая вибрация (только в Telegram)
function haptic() {
  if (inTelegram && tg.isVersionAtLeast('6.1')) tg.HapticFeedback.impactOccurred('light');
}

// Самая мягкая вибрация — переключения, открытие кнопки свайпа
function softHaptic() {
  if (inTelegram && tg.isVersionAtLeast('6.1')) tg.HapticFeedback.selectionChanged();
}

function confirmDialog(text) {
  return new Promise((resolve) => {
    if (inTelegram && tg.isVersionAtLeast('6.2')) tg.showConfirm(text, resolve);
    else resolve(window.confirm(text));
  });
}

function applyTheme() {
  const dark = inTelegram
    ? tg.colorScheme === 'dark'
    : window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  if (inTelegram) {
    const bg = dark ? '#000000' : '#f2f2f7';
    try {
      tg.setBackgroundColor(bg);
      tg.setHeaderColor(bg);
    } catch { /* старая версия Telegram — оставляем как есть */ }
  }
}
