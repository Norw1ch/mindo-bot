'use strict';

// «Главная»: первый экран приложения. Свои данные не хранит — показывает то, что есть в разделах

// «Суббота, 31 октября»
function todayLine() {
  const text = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  return text[0].toUpperCase() + text.slice(1);
}

views.home = () => `
  <p class="home-date">${todayLine()}</p>
  <h1>Главная</h1>`;
