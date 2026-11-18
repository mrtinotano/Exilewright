// The Settings tab: the shortcuts (the price check over the game, the keys of the 3D scene), what the price check
// searches for, the equipment comparison (loot.js draws it: `loot`, put after the price check),
// the app's window (serve.py /settings: with Windows, only in the notification area), the language, and the update notice in the top bar (serve.py /update). Kept in this browser (localStorage); serve.py is told the price check shortcut,
// since it is the one that sees the keyboard while the game is the window in use.
import { t, LANGS, lang, setLang } from './i18n.js';
import { STATUS, leagues } from './trade.js';

const KEY = 'exwSettings';
// the 3D scene's own keys (moving is W A S D and skills 1-9, as in the game)
const SCENE_KEYS = { roll: 'Space', corpse: 'KeyC', charges: 'KeyG', refill: 'KeyF', reset: 'KeyR' };
const SCENE_LABEL = { roll: 'Roll', corpse: 'Corpse at the cursor', charges: 'Fill charges', refill: 'Refill life and energy shield', reset: 'Reset the simulator' };
const NEEDS = 'The shortcut needs Ctrl or Alt, so it never takes a key the game uses alone. It works with the game in windowed full screen and the planner open.';
const FIXED = /^(Key[WASD]|Digit[1-9]|Escape)$/;
const DEFAULTS = { priceKey: 'Ctrl+D', wornKey: 'Alt+D', league: '', state: 'available', near: 10, deep: false };   // near, deep: the price check's ±% and thorough search (trade.js priceOf)
const S = (() => {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch {}
  return { ...DEFAULTS, ...s, keys: { ...SCENE_KEYS, ...s.keys } };
})();
export const settings = () => S;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
let wait = null;   // the shortcut being set ('price', 'worn' or a scene key)
const cap = (k, shown) => `<button class="keycap${wait === k ? ' on' : ''}" data-cap="${k}">${wait === k ? t('Press a key…') : esc(shown)}</button>`;
// the shortcut that takes an item as worn: in the comparison's section (loot.js draws it)
export const wornRow = () => `<div class="lworn"><p class="note">${t('Put an item on in the game, hold the pointer over it and press the shortcut: the comparison takes it as what the character wears.')}</p>
  <div class="optrow"><label>${t('Shortcut')} ${cap('worn', S.wornKey)}</label></div></div>`;
const tell = () => fetch('settings', { method: 'POST', body: JSON.stringify({ price_key: S.priceKey, worn_key: S.wornKey }) }).catch(() => {});
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} tell(); };
tell();
// how a key is shown: "Space" in the page's language, "KeyR" as "R", "Digit1" as "1"
export const keyName = code => code === 'Space' ? t('Space') : code.replace(/^Key|^Digit/, '');
// a shortcut for over the game: Ctrl and/or Alt (and Shift) with a letter, a digit or F1-F12
const comboOf = e => {
  const key = /^Key[A-Z]$|^Digit\d$/.test(e.code) ? e.code.slice(-1) : /^F([1-9]|1[0-2])$/.test(e.code) ? e.code : null;
  return key && (e.ctrlKey || e.altKey) ? [e.ctrlKey && 'Ctrl', e.shiftKey && 'Shift', e.altKey && 'Alt', key].filter(Boolean).join('+') : null;
};

// a newer version, looked for when the app opens and whenever its window comes back to the front (at most every 10
// minutes: GitHub answers 60 asks an hour): a line in the top bar with a button that installs it (the installed app)
// or opens its page (the portable one). Run from the code: nothing
export function watchUpdates(el) {
  let last = 0, busy = false;
  const look = async () => {
    if (busy || Date.now() - last < 600e3) return;
    last = Date.now();
    const u = await fetch('update').then(r => r.ok ? r.json() : null).catch(() => null);
    if (busy || !u?.newer || !u.app) return;
    el.hidden = false;
    el.innerHTML = `${esc(t('Exilewright {0} is out', u.latest))} <button>${t(u.install ? 'Update' : 'Open')}</button>`;
    el.querySelector('button').onclick = async () => {
      if (!u.install) return open(u.page, '_blank', 'noopener');
      busy = true;
      el.textContent = t('Downloading and installing Exilewright {0}…', u.latest);
      const r = await fetch('update', { method: 'POST' }).catch(e => ({ ok: false, statusText: e.message }));
      if (!r.ok) { busy = false; el.textContent = t('The update could not be downloaded ({0}).', r.statusText || r.status); }
    };
  };
  look();
  addEventListener('focus', look);
}

export function initSettings(el, loot) {
  const opt = (v, text, on) => `<option value="${esc(v)}"${on ? ' selected' : ''}>${esc(text)}</option>`;
  let msg = '', list = null, win = {};   // the leagues of the trade site; the app's window (serve.py /settings)
  leagues().then(l => { list = l; render(); }, () => { list = []; render(); });
  const winSet = body => fetch('settings', body && { method: 'POST', body: JSON.stringify(body) }).then(r => r.json()).then(v => { win = v; render(); }, () => {});
  winSet();
  const check = (k, text) => `<label><input type="checkbox" data-w="${k}"${win[k] ? ' checked' : ''}> ${t(text)}</label>`;
  function render() {
    const leagueList = list?.length ? list : [S.league || 'Standard'];
    el.innerHTML = `<div class="opt settings">
      <section><h3>${t('Price check over the game')}</h3>
        <p class="note">${t('Hold the pointer over an item in the game and press the shortcut: the planner copies the item (one Ctrl+C, as if you pressed it) and shows next to the pointer what the same item costs on the official trade site.')}</p>
        <div class="optrow"><label>${t('Shortcut')} ${cap('price', S.priceKey)}</label>
          <label>${t('League')} <select data-s="league">${leagueList.map(l => opt(l, l, l === (S.league || leagueList[0]))).join('')}</select></label>
          <label>${t('Seller')} <select data-s="state">${Object.entries(STATUS).map(([k, v]) => opt(k, t(v), k === S.state)).join('')}</select></label>
          <label>${t('Numbers within (±%)')} <input type="number" data-s="near" min="0" max="100" step="1" value="${+S.near}"></label>
          <label><input type="checkbox" data-s="deep"${S.deep ? ' checked' : ''}> ${t('Thorough search')}</label></div>
        <p class="note">${t('When nothing is within the %: each modifier alone is searched up to 30%, then with one of them left out. It takes more searches (and seconds).')}</p>
        <p class="note">${t(NEEDS)}</p>
      </section>
      <section><h3>${t('Simulator keys')}</h3>
        <p class="note">${t('W A S D move and 1-9 use the skills, as in the game.')}</p>
        <div class="keys">${Object.keys(SCENE_KEYS).map(k => `<label>${t(SCENE_LABEL[k])} ${cap(k, keyName(S.keys[k]))}</label>`).join('')}</div>
        <div class="optrow"><button data-do="defaults">${t('Default keys')}</button></div>
      </section>
      <section><h3>${t('General')}</h3>
        ${win.app || win.startup ? `<div class="optrow">
          ${win.startup ? check('on', 'Open with Windows') : ''}
          ${win.app ? check('tray', 'Only in the notification area (click its icon to open the window)') : ''}</div>` : ''}
        <div class="optrow"><label>${t('Language')} <select data-lang>${Object.entries(LANGS).map(([k, name]) => opt(k, name, k === lang)).join('')}</select></label></div>
      </section>
      ${msg ? `<p class="opterr">${esc(msg)}</p>` : ''}
    </div>`;
    el.querySelector('section').after(loot);
    const w = loot.querySelector('.lworn');
    if (w) w.outerHTML = wornRow();
  }
  addEventListener('keydown', e => {
    if (!wait || el.hidden) return;
    e.preventDefault(); e.stopPropagation();
    if (/^(Control|Shift|Alt|Meta)/.test(e.code)) return;   // a modifier alone: wait for the key that comes with it
    msg = '';
    if (e.code !== 'Escape') {
      if (wait === 'price' || wait === 'worn') {
        const c = comboOf(e), other = wait === 'price' ? 'wornKey' : 'priceKey';
        if (c) { if (S[other] === c) S[other] = S[wait + 'Key']; S[wait + 'Key'] = c; save(); } else msg = t(NEEDS);
      }
      else if (FIXED.test(e.code) || e.ctrlKey || e.altKey || e.metaKey) msg = t('That key is taken: W A S D, 1-9 and Esc stay as they are.');
      else { const other = Object.keys(S.keys).find(k => k !== wait && S.keys[k] === e.code); if (other) S.keys[other] = S.keys[wait]; S.keys[wait] = e.code; save(); }
    }
    wait = null; render();
  }, true);
  el.onclick = e => {
    const d = e.target.closest('[data-cap],[data-do]');
    if (!d) return;
    if (d.dataset.cap) { wait = wait === d.dataset.cap ? null : d.dataset.cap; msg = ''; }
    else if (d.dataset.do === 'defaults') { S.keys = { ...SCENE_KEYS }; save(); }
    render();
  };
  el.onchange = e => {
    if ('lang' in e.target.dataset) return setLang(e.target.value);
    if (e.target.dataset.w) return winSet({ [e.target.dataset.w]: e.target.checked });
    const k = e.target.dataset.s;
    if (k) { S[k] = e.target.type === 'number' ? Math.min(100, Math.max(0, +e.target.value || 0)) : e.target.type === 'checkbox' ? e.target.checked : e.target.value; save(); render(); }
  };
  return render;
}
