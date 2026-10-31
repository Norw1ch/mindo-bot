'use strict';

// «Главная»: первый экран приложения. Свои данные не хранит — показывает то, что есть в разделах

// «Суббота, 31 октября»
function todayLine() {
  const text = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  return text[0].toUpperCase() + text.slice(1);
}

// Число с подписью. Длинная сумма пишется мельче, чтобы все три числа оставались в один ряд
function statHtml(value, label) {
  const size = value.length > 12 ? ' longer' : value.length > 8 ? ' long' : '';
  return `<div class="today-stat"><b class="${size}">${value}</b><span>${label}</span></div>`;
}

function todayCardHtml() {
  const { done, total } = habitsToday();
  const progress = total ? Math.round((done / total) * 100) : 0;
  return `
    <section class="today-card">
      <p class="today-head">Сегодня</p>
      <div class="today-stats">
        ${statHtml(`${done}/${total}`, 'привычки')}
        ${statHtml(String(wipCount()), 'в работе')}
        ${statHtml(formatMoney(todaySpent()), 'расходы')}
      </div>
      <div class="today-bar"><span style="width:${progress}%"></span></div>
    </section>`;
}

views.home = () => `
  <p class="home-date">${todayLine()}</p>
  <h1>Главная</h1>
  ${todayCardHtml()}`;
