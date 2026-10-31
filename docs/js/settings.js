'use strict';

// Настройки: язык интерфейса и резервная копия. Открываются с главной

views.settings = () => `
  <h1>${t('Настройки')}</h1>
  <div class="group">
    <button class="row" data-act="pick-lang">
      <span class="title">${t('Язык')}</span>
      <span class="meta${takeFlash('lang') ? ' swap' : ''}">${LANGS[lang].name}</span>
      ${CHEVRON}
    </button>
    <button class="row" data-act="open-backup"><span class="title">${t('Резервная копия')}</span>${CHEVRON}</button>
  </div>`;

Object.assign(actions, {
  'open-settings': () => go({ name: 'settings' }),

  // Названия языков всегда на своём языке: так свой легко найти, даже если текущий непонятен
  'pick-lang': async () => {
    const options = Object.entries(LANGS).map(([key, l]) => ({ key, label: l.name, checked: key === lang }));
    const picked = await choose({ title: t('Язык'), options });
    if (!picked || picked === lang) return;
    setLang(picked);
    localizeCats();
    flash = 'lang';
    await commit(() => store.set(LANG_KEY, picked), relabelApp);
  },
});
