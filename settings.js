// The Settings tab: the shortcuts (the price check over the game, the keys of the 3D scene), what the price check
// searches for, the language and the updates (serve.py /update). Kept in this browser (localStorage); serve.py is told the price check shortcut,
// since it is the one that sees the keyboard while the game is the window in use.
import { t, LANGS, lang, setLang } from './i18n.js';
import { STATUS, leagues } from './trade.js';

const KEY = 'exwSettings';
// the 3D scene's own keys (moving is W A S D and skills 1-9, as in the game)
const SCENE_KEYS = { roll: 'Space', corpse: 'KeyC', charges: 'KeyG', refill: 'KeyF', reset: 'KeyR' };
const SCENE_LABEL = { roll: 'Roll', corpse: 'Corpse at the cursor', charges: 'Fill charges', refill: 'Refill life and energy shield', reset: 'Reset the simulator' };
const NEEDS = 'The shortcut needs Ctrl or Alt, so it never takes a key the game uses alone. It works with the game in windowed full screen and the planner open.';
const FIXED = /^(Key[WASD]|Digit[1-9]|Escape)$/;
const DEFAULTS = { priceKey: 'Ctrl+D', league: '', state: 'available', near: 10 };   // near: the price check's ±% (trade.js priceOf)
const S = (() => {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch {}
  return { ...DEFAULTS, ...s, keys: { ...SCENE_KEYS, ...s.keys } };
})();
export const settings = () => S;
const tell = () => fetch('settings', { method: 'POST', body: JSON.stringify({ price_key: S.priceKey }) }).catch(() => {});
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} tell(); };
tell();
// how a key is shown: "Space" in the page's language, "KeyR" as "R", "Digit1" as "1"
export const keyName = code => code === 'Space' ? t('Space') : code.replace(/^Key|^Digit/, '');
// a shortcut for over the game: Ctrl and/or Alt (and Shift) with a letter, a digit or F1-F12
const comboOf = e => {
  const key = /^Key[A-Z]$|^Digit\d$/.test(e.code) ? e.code.slice(-1) : /^F([1-9]|1[0-2])$/.test(e.code) ? e.code : null;
  return key && (e.ctrlKey || e.altKey) ? [e.ctrlKey && 'Ctrl', e.shiftKey && 'Shift', e.altKey && 'Alt', key].filter(Boolean).join('+') : null;
};

// a newer version: the installed app offers to download and install it, elsewhere its release page is shown.
// -> the text to show in Settings ('' when the user was asked)
export async function update(ask, quiet) {
  let u;
  try { const r = await fetch('update'); u = await r.json(); if (!r.ok) throw Error(u.error); }
  catch (e) { return quiet ? '' : t('The updates could not be checked ({0}).', e.message); }
  if (!u.newer) return quiet ? '' : t('Exilewright {0} is the latest version.', u.version);
  if (quiet && !u.app) return '';   // run from the code: no question at every reload
  if (u.install) {
    if (await ask(t('Exilewright {0} is out (you have {1}). Download and install it? The app closes and opens again when it is done.', u.latest, u.version), t('Update')) !== 0) return '';
    const r = await fetch('update', { method: 'POST' }).catch(e => ({ ok: false, statusText: e.message }));
    return r.ok ? t('Downloading and installing Exilewright {0}…', u.latest) : t('The update could not be downloaded ({0}).', r.statusText || r.status);
  }
  if (await ask(t('Exilewright {0} is out (you have {1}). Open its page to download it?', u.latest, u.version), t('Open')) === 0) open(u.page, '_blank', 'noopener');
  return '';
}

export function initSettings(el, ask) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const opt = (v, text, on) => `<option value="${esc(v)}"${on ? ' selected' : ''}>${esc(text)}</option>`;
  let wait = null, msg = '', list = null, upd = '';   // the shortcut being set ('price' or a scene key); the leagues of the trade site; what the update check said
  leagues().then(l => { list = l; render(); }, () => { list = []; render(); });
  const cap = (k, shown) => `<button class="keycap${wait === k ? ' on' : ''}" data-cap="${k}">${wait === k ? t('Press a key…') : esc(shown)}</button>`;
  function render() {
    const leagueList = list?.length ? list : [S.league || 'Standard'];
    el.innerHTML = `<div class="opt settings">
      <section><h3>${t('Price check over the game')}</h3>
        <p class="note">${t('Hold the pointer over an item in the game and press the shortcut: the planner copies the item (one Ctrl+C, as if you pressed it) and shows next to the pointer what the same item costs on the official trade site.')}</p>
        <div class="optrow"><label>${t('Shortcut')} ${cap('price', S.priceKey)}</label>
          <label>${t('League')} <select data-s="league">${leagueList.map(l => opt(l, l, l === (S.league || leagueList[0]))).join('')}</select></label>
          <label>${t('Seller')} <select data-s="state">${Object.entries(STATUS).map(([k, v]) => opt(k, t(v), k === S.state)).join('')}</select></label>
          <label>${t('Numbers within (±%)')} <input type="number" data-s="near" min="0" max="100" step="1" value="${+S.near}"></label></div>
        <p class="note">${t(NEEDS)}</p>
      </section>
      <section><h3>${t('Simulator keys')}</h3>
        <p class="note">${t('W A S D move and 1-9 use the skills, as in the game.')}</p>
        <div class="keys">${Object.keys(SCENE_KEYS).map(k => `<label>${t(SCENE_LABEL[k])} ${cap(k, keyName(S.keys[k]))}</label>`).join('')}</div>
        <div class="optrow"><button data-do="defaults">${t('Default keys')}</button></div>
      </section>
      <section><h3>${t('Language')}</h3>
        <div class="optrow"><select data-lang>${Object.entries(LANGS).map(([k, name]) => opt(k, name, k === lang)).join('')}</select></div>
      </section>
      <section><h3>${t('Updates')}</h3>
        <div class="optrow"><button data-do="update">${t('Check for updates')}</button></div>
        ${upd ? `<p class="note">${esc(upd)}</p>` : ''}
      </section>
      ${msg ? `<p class="opterr">${esc(msg)}</p>` : ''}
    </div>`;
  }
  addEventListener('keydown', e => {
    if (!wait || el.hidden) return;
    e.preventDefault(); e.stopPropagation();
    if (/^(Control|Shift|Alt|Meta)/.test(e.code)) return;   // a modifier alone: wait for the key that comes with it
    msg = '';
    if (e.code !== 'Escape') {
      if (wait === 'price') { const c = comboOf(e); if (c) { S.priceKey = c; save(); } else msg = t(NEEDS); }
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
    else if (d.dataset.do === 'update') { upd = t('Checking…'); update(ask).then(m => { upd = m; render(); }); }
    render();
  };
  el.onchange = e => {
    if ('lang' in e.target.dataset) return setLang(e.target.value);
    const k = e.target.dataset.s;
    if (k) { S[k] = e.target.type === 'number' ? Math.min(100, Math.max(0, +e.target.value || 0)) : e.target.value; save(); render(); }
  };
  return render;
}
