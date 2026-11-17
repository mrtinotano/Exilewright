// The Filter tab: the player builds a loot filter rule by rule (which items, how they look and sound on the ground) and
// saves it as a .filter file in the game's folder (serve.py /filter), or downloads it. The game reads the rules top to
// bottom and the first one an item matches decides how it shows. Item classes and bases come from the game
// (poe2_data/available/filter.json, made by _tool/available.py); a .filter names them in English, the page shows them
// in its own language.
import { t, lang } from './i18n.js';

const KEY = 'exwFilter';
const RARITIES = ['Normal', 'Magic', 'Rare', 'Unique'];
// the .filter file's own words for colours and minimap shapes
const COLOURS = ['Red', 'Green', 'Blue', 'Brown', 'White', 'Yellow', 'Cyan', 'Grey', 'Orange', 'Pink', 'Purple'];
const SHAPES = ['Circle', 'Diamond', 'Hexagon', 'Square', 'Star', 'Triangle', 'Cross', 'Moon', 'Raindrop', 'Kite', 'Pentagon', 'UpsideDownHouse'];
const SHAPE_LABEL = { UpsideDownHouse: 'Upside-down house' };
const ICON_SIZES = ['Large', 'Medium', 'Small'];   // MinimapIcon 0 is the largest
// number conditions: the .filter keyword and its label; each one is "at least"
const NUMS = [['ItemLevel', 'Item level'], ['AreaLevel', 'Area level'], ['Quality', 'Quality'], ['StackSize', 'Stack size'],
  ['WaystoneTier', 'Waystone tier'], ['Sockets', 'Sockets']];
const newRule = () => ({ on: true, show: true, classes: [], bases: [], rarity: [], min: {}, text: '', border: '', bg: '', size: '',
  sound: '', volume: 300, effect: '', temp: false, icon: null });
const S = (() => {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch {}
  return { name: 'Exilewright', rest: true, rules: [], ...s };
})();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} };

const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(' ') + ' 255';
const q = s => `"${s.replace(/"/g, '')}"`;
// the rules as a .filter file
export function filterText({ name, rules, rest }) {
  const out = [`# ${name} (Exilewright)`, ''];
  for (const r of rules) {
    if (!r.on) continue;
    out.push(r.show ? 'Show' : 'Hide');
    if (r.classes.length) out.push(`\tClass == ${r.classes.map(q).join(' ')}`);
    if (r.bases.length) out.push(`\tBaseType == ${r.bases.map(q).join(' ')}`);
    if (r.rarity.length) out.push(`\tRarity ${r.rarity.join(' ')}`);
    for (const [k] of NUMS) if (r.min[k] !== undefined && r.min[k] !== '') out.push(`\t${k} >= ${+r.min[k]}`);
    if (r.size) out.push(`\tSetFontSize ${r.size}`);
    if (r.text) out.push(`\tSetTextColor ${rgb(r.text)}`);
    if (r.border) out.push(`\tSetBorderColor ${rgb(r.border)}`);
    if (r.bg) out.push(`\tSetBackgroundColor ${rgb(r.bg)}`);
    if (r.sound) out.push(`\tPlayAlertSound ${r.sound} ${r.volume}`);
    if (r.effect) out.push(`\tPlayEffect ${r.effect}${r.temp ? ' Temp' : ''}`);
    if (r.icon) out.push(`\tMinimapIcon ${r.icon.size} ${r.icon.colour} ${r.icon.shape}`);
    out.push('');
  }
  out.push(rest ? 'Show' : 'Hide', '');
  return out.join('\n');
}

export function initFilter(el) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const opt = (v, text, on) => `<option value="${esc(v)}"${on ? ' selected' : ''}>${esc(text)}</option>`;
  let D = null, msg = '', err = false;
  const shown = x => x[`name_${lang}`] || x.name;
  const clsName = n => shown(D.classes.find(c => c.name === n) || { name: n });
  const baseName = n => shown(D.bases.find(b => b.name === n) || { name: n });
  // a base typed in the page's language (or in English) -> its English name for the file
  const baseOf = text => (D.bases.find(b => shown(b) === text || b.name === text) || {}).name || text.trim();
  fetch('poe2_data/available/filter.json').then(r => r.json()).then(d => { D = d; render(); });

  const chip = (k, i, text) => `<span class="fchip">${esc(text)}<button data-del="${k}" data-i="${i}" title="${t('Remove')}">×</button></span>`;
  const colour = (k, r) => `<label><input type="checkbox" data-use="${k}"${r[k] ? ' checked' : ''}> ${t({ text: 'Text', border: 'Border', bg: 'Background' }[k])}
    <input type="color" data-f="${k}" value="${r[k] || { text: '#ffffff', border: '#ffffff', bg: '#000000' }[k]}"${r[k] ? '' : ' disabled'}></label>`;
  const label = r => `<span class="flabel" style="color:${r.text || '#c8c8c8'};background:${r.bg || 'rgba(0,0,0,.7)'};border-color:${r.border || 'transparent'};font-size:${Math.round((+r.size || 32) / 2.2)}px">${esc(r.bases[0] ? baseName(r.bases[0]) : r.classes[0] ? clsName(r.classes[0]) : t('Item'))}</span>`;
  function card(r, i) {
    const pick = r.classes.length ? D.bases.filter(b => r.classes.includes(b.class)) : D.bases;
    return `<section class="frule${r.on ? '' : ' off'}" data-r="${i}">
      <div class="optrow"><b>${i + 1}</b>
        <label><input type="checkbox" data-f="on"${r.on ? ' checked' : ''}> ${t('On')}</label>
        <select data-f="show">${opt(1, t('Show'), r.show)}${opt(0, t('Hide'), !r.show)}</select>
        ${label(r)}
        <span class="fgrow"></span>
        <button data-do="up"${i ? '' : ' disabled'} title="${t('Move up')}">↑</button><button data-do="down"${i < S.rules.length - 1 ? '' : ' disabled'} title="${t('Move down')}">↓</button>
        <button data-do="copy" title="${t('Duplicate')}">⧉</button><button data-do="del" title="${t('Remove')}">×</button></div>
      <div class="optrow"><span class="fk">${t('Item class')}</span>${r.classes.map((c, j) => chip('classes', j, clsName(c))).join('')}
        <select data-add="classes"><option value="">${t('Add…')}</option>${D.classes.filter(c => !r.classes.includes(c.name)).map(c => opt(c.name, shown(c))).sort().join('')}</select></div>
      <div class="optrow"><span class="fk">${t('Base type')}</span>${r.bases.map((b, j) => chip('bases', j, baseName(b))).join('')}
        <input data-add="bases" list="fb${i}" placeholder="${t('Type a name and press Enter')}"><datalist id="fb${i}">${pick.map(b => `<option value="${esc(shown(b))}">`).join('')}</datalist></div>
      <div class="optrow"><span class="fk">${t('Rarity')}</span>${RARITIES.map(x => `<label><input type="checkbox" data-rar="${x}"${r.rarity.includes(x) ? ' checked' : ''}> ${t(x)}</label>`).join('')}</div>
      <div class="optrow">${NUMS.map(([k, l]) => `<label>${t(l)} ≥ <input type="number" min="0" max="100" data-min="${k}" value="${r.min[k] ?? ''}"></label>`).join('')}</div>
      <div class="optrow"><span class="fk">${t('Look')}</span>${colour('text', r)}${colour('border', r)}${colour('bg', r)}
        <label>${t('Text size')} <input type="number" min="18" max="45" data-f="size" value="${r.size}" placeholder="32"></label></div>
      <div class="optrow"><span class="fk">${t('Drop')}</span>
        <label>${t('Sound')} <select data-f="sound"><option value="">${t('None')}</option>${Array.from({ length: 16 }, (_, k) => opt(k + 1, k + 1, +r.sound === k + 1)).join('')}</select></label>
        <label>${t('Volume')} <input type="number" min="0" max="300" data-f="volume" value="${r.volume}"></label>
        <label>${t('Light beam')} <select data-f="effect"><option value="">${t('None')}</option>${COLOURS.map(c => opt(c, t(c), r.effect === c)).join('')}</select></label>
        <label><input type="checkbox" data-f="temp"${r.temp ? ' checked' : ''}> ${t('Only while it falls')}</label></div>
      <div class="optrow"><span class="fk">${t('Minimap icon')}</span>
        <select data-icon="size"><option value="">${t('None')}</option>${ICON_SIZES.map((s, k) => opt(k, t(s), r.icon?.size === k)).join('')}</select>
        ${r.icon ? `<select data-icon="colour">${COLOURS.map(c => opt(c, t(c), r.icon.colour === c)).join('')}</select>
          <select data-icon="shape">${SHAPES.map(s => opt(s, t(SHAPE_LABEL[s] || s), r.icon.shape === s)).join('')}</select>` : ''}</div>
    </section>`;
  }
  function render() {
    if (!D) { el.innerHTML = `<p class="note">${t('Loading…')}</p>`; return; }
    el.innerHTML = `<div class="opt filter">
      <p class="note">${t('The game reads the rules from the top and the first one an item matches decides how it shows. An empty condition matches every item.')}</p>
      ${S.rules.map(card).join('')}
      <div class="optrow"><button data-do="add">${t('Add rule')}</button>
        <label>${t('Every other item')} <select data-s="rest">${opt(1, t('Show'), S.rest)}${opt(0, t('Hide'), !S.rest)}</select></label></div>
      <section><div class="optrow"><label>${t('File name')} <input data-s="name" value="${esc(S.name)}" maxlength="60"></label>
        <button data-do="write">${t('Save to the game folder')}</button><button data-do="download">${t('Download')}</button></div>
        <p class="note">${t('In the game: Options, Game, Item Filter, and pick it from the list.')}</p>
        ${msg ? `<p class="${err ? 'opterr' : 'optmsg'}">${esc(msg)}</p>` : ''}
        <details><summary>${t('The file')}</summary><pre class="ftext">${esc(filterText(S))}</pre></details></section>
    </div>`;
  }
  const done = () => { save(); render(); };
  const ruleOf = e => S.rules[+e.target.closest('[data-r]')?.dataset.r];
  async function write(overwrite) {
    const res = await fetch('filter', { method: 'POST', body: JSON.stringify({ name: S.name, text: filterText(S), overwrite }) }).catch(() => null);
    const body = res && await res.text();
    if (res?.status === 409 && confirm(t('{0} already exists in the game folder. Replace it?', S.name + '.filter'))) return write(true);
    err = !res?.ok;
    msg = res?.ok ? t('Saved: {0}', body) : res?.status === 409 ? '' : t('It could not be saved: {0}', body || t('the planner is not running'));
    render();
  }
  el.onclick = e => {
    const d = e.target.closest('[data-do],[data-del]');
    if (!d) return;
    const r = ruleOf(e), i = S.rules.indexOf(r);
    if (d.dataset.del) r[d.dataset.del].splice(+d.dataset.i, 1);
    else switch (d.dataset.do) {
      case 'add': S.rules.push(newRule()); break;
      case 'del': S.rules.splice(i, 1); break;
      case 'copy': S.rules.splice(i + 1, 0, structuredClone(r)); break;
      case 'up': case 'down': { const j = i + (d.dataset.do === 'up' ? -1 : 1); [S.rules[i], S.rules[j]] = [S.rules[j], S.rules[i]]; break; }
      case 'write': msg = ''; return write(false);
      case 'download': {
        const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([filterText(S)])), download: S.name + '.filter' });
        a.click(); URL.revokeObjectURL(a.href); return;
      }
    }
    done();
  };
  el.onchange = e => {
    const x = e.target, ds = x.dataset, r = ruleOf(e);
    if (ds.s) { S[ds.s] = ds.s === 'rest' ? x.value === '1' : x.value.replace(/[<>:"/\\|?*]/g, '').trim() || 'Exilewright'; return done(); }
    if (!r) return;
    if (ds.add === 'classes' && x.value) r.classes.push(x.value);
    else if (ds.add === 'bases') return;
    else if (ds.rar) r.rarity = RARITIES.filter(k => k === ds.rar ? x.checked : r.rarity.includes(k));
    else if (ds.min) r.min[ds.min] = x.value;
    else if (ds.use) r[ds.use] = x.checked ? x.parentElement.querySelector('input[type=color]').value : '';
    else if (ds.icon) r.icon = ds.icon === 'size' ? (x.value === '' ? null : { colour: 'White', shape: 'Circle', ...r.icon, size: +x.value }) : { ...r.icon, [ds.icon]: x.value };
    else if (ds.f) r[ds.f] = x.type === 'checkbox' ? x.checked : ds.f === 'show' ? x.value === '1' : x.type === 'number' ? (x.value === '' ? '' : +x.value) : x.value;
    done();
  };
  el.onkeydown = e => {
    if (e.key !== 'Enter' || e.target.dataset.add !== 'bases' || !e.target.value.trim()) return;
    const r = ruleOf(e), b = baseOf(e.target.value);
    if (!r.bases.includes(b)) r.bases.push(b);
    done();
    el.querySelector(`[data-r="${S.rules.indexOf(r)}"] [data-add=bases]`)?.focus();
  };
  return render;
}
