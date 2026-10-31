'use strict';

// «Главная»: первый экран приложения. Свои данные не хранит — показывает то, что есть в разделах

// «Суббота, 31 октября»
function todayLine() {
  const text = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  return text[0].toUpperCase() + text.slice(1);
}

// Число с подписью. Длинная сумма пишется мельче, чтобы все три числа оставались в один ряд
function statHtml(value, label, cls = '') {
  const size = value.length > 12 ? ' longer' : value.length > 8 ? ' long' : '';
  return `<div class="today-stat"><b class="${size}${cls}">${value}</b><span>${label}</span></div>`;
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
        ${statHtml(formatMoney(todaySpent()), 'расходы', takeFlash('total') ? ' swap' : '')}
      </div>
      <div class="today-bar"><span style="width:${progress}%"></span></div>
    </section>`;
}

// Быстрые кнопки: форма добавления открывается прямо здесь, на главной
function quickBtnHtml(act, label) {
  return `<button class="btn quick-btn" data-act="${act}">${icon('<path d="M12 5v14M5 12h14"/>')}${label}</button>`;
}

views.home = () => `
  <p class="home-date">${todayLine()}</p>
  <h1>Главная</h1>
  ${todayCardHtml()}
  <div class="quick-btns">
    ${quickBtnHtml('quick-idea', 'Идея')}
    ${quickBtnHtml('quick-note', 'Заметка')}
    ${quickBtnHtml('add-expense', 'Расход')}
  </div>`;

Object.assign(actions, {
  'quick-note': async () => {
    if (await actions['new-note']()) toast('Заметка сохранена');
  },
});
