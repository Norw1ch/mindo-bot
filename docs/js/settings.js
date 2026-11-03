'use strict';

// Настройки: язык интерфейса, переходы между экранами и резервная копия. Открываются с главной

const ANIM_STYLES = [{ key: 'classic', html: 'Классические' }, { key: 'new', html: 'Новые' }];

views.settings = () => `
  ${headHtml(t('Язык, анимации и резервная копия'), t('Настройки'))}
  <div class="group">
    <button class="row" data-act="pick-lang">
      <span class="title">${t('Язык')}</span>
      <span class="meta${takeFlash('lang') ? ' swap' : ''}">${LANGS[lang].name}</span>
      ${CHEVRON}
    </button>
    <button class="row" data-act="open-backup"><span class="title">${t('Резервная копия')}</span>${CHEVRON}</button>
  </div>
  <p class="group-head">${t('Анимации')}</p>
  ${segHtml(ANIM_STYLES.map((s) => ({ ...s, html: t(s.html) })), animStyle, 'set-anim', '', 'anim-seg')}
  <p class="foot-note">${t('Как открываются экраны и переключаются вкладки')}</p>`;

Object.assign(actions, {
  'open-settings': () => go({ name: 'settings' }),

  // Переходы: таблетка переезжает, следующий же экран откроется по-новому
  'set-anim': async ({ key }, el) => {
    if (animStyle === key) return;
    moveSeg(el.closest('.seg'), key);
    softHaptic();
    setAnim(key);
    const ok = await commit(() => store.set(ANIM_KEY, key), () => {}, null);
    if (!ok) refresh();
  },

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
