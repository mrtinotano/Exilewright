// Character sheet laid out like the in-game character panel, and the skill info window (in-game gem tooltip).
import { t, tn, fmt, lang as LANG } from './i18n.js';
import { statLines, shownLines } from './stats.js';
import { character, sheet, skill, reservation, DMG_NAME, QUESTS, questPick } from './calc.js';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const n = x => fmt(x == null ? x : Math.round(x));
const f = (x, d = 2) => fmt(x, d);
const sign = x => (x > 0 ? '+' : '') + x;
const NO_BASE = 'The class base life/mana is missing: it comes from regenerating the data on Windows';

// small line icons standing in for the game's panel art (not in the extracted data yet)
const ICON = {
  life: '<path d="M12 20s-7-4.4-7-9.5A3.8 3.8 0 0 1 12 8a3.8 3.8 0 0 1 7 2.5C19 15.6 12 20 12 20z"/>',
  es: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M12 7v10M8 11h8"/>',
  mana: '<path d="M12 3c3 4 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 3-7 6-11z"/>',
  spirit: '<circle cx="12" cy="12" r="3.5"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/>',
  armour: '<path d="M6 4h12l1 6-3 10H8L5 10z"/><path d="M9 4v6h6V4"/>',
  evasion: '<path d="M4 16c4 0 6-8 10-8M7 20c4 0 7-9 13-9M4 9c3 0 4-4 8-5"/>',
  block: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M12 3v18"/>',
  fire: '<path d="M12 21c-4 0-6-3-6-6 0-4 4-6 4-11 3 2 4 5 4 7 1-1 1.5-2 1.5-3 2 2 2.5 4.5 2.5 7 0 3-2 6-6 6z"/>',
  cold: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.5L12 7l2.5-2.5M9.5 19.5L12 17l2.5 2.5"/>',
  lightning: '<path d="M13 2L5 13h6l-1 9 8-12h-6z"/>',
  chaos: '<path d="M12 12a2 2 0 1 1 2 2 4 4 0 1 1-4-4 6 6 0 1 1 6 6 8 8 0 1 1-8-8"/>',
};
const ico = k => `<svg class="cp-ico ${k}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">${ICON[k]}</svg>`;

// editable in place: name (input), base class and ascendancy (each row opens its list); level follows the tree
export function renderChar(el, b, sum, { asc, cls, points, pending, classes = [], ascOptions = [], picking = null, ascLabel = x => x, clsLabel = x => x }) {
  const c = character(b, sum), R = c.res;
  const questsOpen = el.querySelector('.cp-quests')?.open;   // drawn anew at every change: stays as it was left
  const reward = o => [...statLines(o.stats), ...o.missed.map(l => `${l} (${t('Not understood: it is not counted')})`)].map(esc).join(' · ');
  const box = (k, label, val, title = '') => `<div class="cp-box ${k}"${title ? ` title="${esc(t(title))}"` : ''}>${ico(k)}<small>${t(label)}</small><b>${val}</b></div>`;
  const pctOr = (p, raw, what) => p != null ? Math.round(p) + '%' : n(raw);
  const res = (k, label) => `<div class="cp-res ${k}" title="${t('Maximum {0}%', R[k].max)}">${ico(k)}<span>${t(label)}</span><b>${R[k].capped}% <i>(${R[k].value}%)</i></b></div>`;
  const all = { ...sum }; delete all.display_passive_attribute_text;
  el.innerHTML = `<div class="cp">
    <input class="cp-name" data-act="name" value="${esc(b.name)}" title="${t('Build name')}" spellcheck="false">
    <div class="cp-top">
      <div class="cp-id">
        <button class="cp-pick${picking === 'cls' ? ' open' : ''}" data-pick="cls" title="${t('Base class')}">${esc(cls ? clsLabel(cls) : '—')}</button>
        <button class="cp-pick${picking === 'asc' ? ' open' : ''}" data-pick="asc" title="${t('Ascendancy')}">${esc(asc ? ascLabel(asc) : '—')}</button>
        <div title="${t('Goes up on its own as you allocate tree points: {0} passive points (1 per level)', points)}. ${t('Type your character\'s level to set it yourself; leave it empty to follow the tree again.')}">${t('Level {0}', `<input class="cp-lvl" type="number" min="1" max="100" data-act="level" value="${b.lvl || ''}" placeholder="${c.level}">`)}</div>
      </div>
      <div class="cp-portrait" title="${esc(asc ? ascLabel(asc) : '')}">${esc((asc ? ascLabel(asc) : '?')[0])}</div>
      <div class="cp-id cp-attr"><div class="str"><span>${t('Strength')}</span><b>${n(c.attrs.str)}</b></div><div class="dex"><span>${t('Dexterity')}</span><b>${n(c.attrs.dex)}</b></div><div class="int"><span>${t('Intelligence')}</span><b>${n(c.attrs.int)}</b></div></div>
    </div>
    ${picking ? `<div class="cp-classes">${(picking === 'cls' ? classes : ascOptions).map(k => `<button data-${picking}="${esc(k)}" class="${k === (picking === 'cls' ? cls : asc) ? 'on' : ''}">${esc(picking === 'cls' ? clsLabel(k) : ascLabel(k))}</button>`).join('')}</div>` : ''}
    <div class="cp-row4">${box('life', 'Life', n(c.life), c.life == null ? NO_BASE : '')}${box('es', 'Energy Shield', n(c.es))}${box('mana', 'Mana', n(c.mana), c.mana == null ? NO_BASE : '')}${box('spirit', 'Spirit', c.reserved ? `${n(c.spirit - c.reserved)}<small>/${n(c.spirit)}</small>` : n(c.spirit), c.reserved ? t('{0} reserved by your skills', c.reserved) : '')}</div>
    <div class="cp-row3">${box('armour', 'Armour', pctOr(c.armourPct, c.armour), c.armourPct != null ? t('Estimated physical damage reduction against a hit from a monster of your level ({0} armour)', n(c.armour)) : 'The per-level monster table is missing (it comes from regenerating the data on Windows): showing the armour value')}${box('evasion', 'Evasion', pctOr(c.evadePct, c.evasion), c.evadePct != null ? t('Chance to evade an attack from a monster of your level ({0} evasion)', n(c.evasion)) : 'The per-level monster table is missing (it comes from regenerating the data on Windows): showing the evasion value')}${box('block', 'Block', c.block + '%')}</div>
    <h4>${t('Resistances')}</h4>
    <div class="cp-resists">${res('fire', 'Fire')}${res('cold', 'Cold')}${res('lightning', 'Lightning')}${res('chaos', 'Chaos')}</div>
    <div class="cp-list">${sheet(b, sum).map(([h, rows]) => `<details${rows.length ? ' open' : ''}><summary>${t(h)}</summary>${rows.map(([k, val, tip]) => `<div${tip ? ` title="${esc(tip)}"` : ''}><span>${t(k)}</span><b>${val}</b></div>`).join('')}</details>`).join('')}</div>
    ${pending ? `<p class="cp-note">${t('{0} attributes not chosen (right click on the tree).', pending)}</p>` : ''}
    ${c.missingBase ? `<p class="cp-note">${t(NO_BASE)}.</p>` : ''}
    <details class="cp-quests"${questsOpen ? ' open' : ''}><summary title="${t('What the quests of the campaign leave on the character for good. Counted from the level of each one\'s area; a choice only once you make it.')}">${t('Campaign rewards')}</summary>${QUESTS.map(q => {
      const on = questPick(b, q), key = esc(q.key);
      return `<label title="${esc(`${q.act}: ${q.area} — ${q.info}`)}">` + (q.pick
        ? `<select data-quest="${key}"><option value="0">—</option>${q.options.map((o, i) => `<option value="${i + 1}"${on === i + 1 ? ' selected' : ''}>${reward(o)}</option>`).join('')}</select>`
        : `<input type="checkbox" data-quest="${key}"${on ? ' checked' : ''}> ${reward(q.options[0])}`) + '</label>';
    }).join('')}</details>
    <details><summary>${t('All modifiers')}</summary><div class="cp-all">${statLines(all).sort().map(esc).join('<br>') || '—'}</div></details>
  </div>`;
}

// ---------- skill info window (like the in-game gem tooltip)
const TAGS = { attack: 'Attack', spell: 'Spell', area: 'AoE', projectile: 'Projectile', melee: 'Melee', strike: 'Strike', slam: 'Slam',
  duration: 'Duration', fire: 'Fire', cold: 'Cold', lightning: 'Lightning', chaos: 'Chaos', physical: 'Physical', minion: 'Minion', nova: 'Nova', aura: 'Aura',
  buff: 'Buff', curse: 'Curse', warcry: 'Warcry', channelling: 'Channelling', totem: 'Totem', trap: 'Trap', movement: 'Movement',
  travel: 'Travel', persistent: 'Persistent', bow: 'Bow', crossbow: 'Crossbow', ammunition: 'Ammunition', grenade: 'Grenade', sustained: 'Sustained',
  payoff: 'Payoff', invocation: 'Invocation', meta: 'Meta', herald: 'Herald', companion: 'Companion', shapeshift: 'Shapeshift', barrage: 'Barrage',
  remnant: 'Remnant', detonator: 'Detonator', hazard: 'Hazard', critical: 'Critical', chaining: 'Chaining', mark: 'Mark', stance: 'Stance', storm: 'Storm' };
const HIDDEN_TAGS = new Set(['grants_active_skill', 'strength', 'dexterity', 'intelligence', 'repeatable', 'support', 'gem']);

export function skillTip(G, g, b, sum, geo) {
  const s = skill(g, b, sum), st = s.stats, G2 = geo?.(g) || {};
  const tags = (G.tags || []).filter(t => !HIDDEN_TAGS.has(t)).map(x => TAGS[x] ? t(TAGS[x]) : x.replace(/_/g, ' ')).join(', ');
  const visible = Object.fromEntries(Object.entries(st).filter(([k]) => !k.startsWith('_')));
  const lines = shownLines(visible, g.name);
  const cost = st._cost && Object.entries(st._cost).map(([k, val]) => t(/life/i.test(k) ? '{0} life' : /es|energy/i.test(k) ? '{0} energy shield' : '{0} mana', val)).join(', ');
  const props = [
    ['Level', st._level],
    st._quality && ['Quality', st._quality + '%'],
    cost && ['Cost', cost],
    st._spirit && ['Reservation', t('{0} spirit', reservation(g, sum))],
    s.attack ? st._base_multiplier && ['Attack damage', t('{0}% of base damage', f(st._base_multiplier / 100, 0))] : null,
    !s.attack && G.types?.includes('Spell') && ['Cast time', s.castTime ? f(s.castTime / 1000) + ' s' : '—'],
    s.crit != null && ['Critical hit chance', f(s.crit) + '%'],
    st._cooldown_ms && ['Cooldown time', f(st._cooldown_ms / 1000) + ' s'],
    G2.radiusFromData && ['Radius', f(G2.radius, 1) + ' m'],
    G2.speed && ['Projectile speed', f(G2.speed, 1) + ' m/s'],
  ].filter(Boolean);
  const hits = Object.entries(s.hits).map(([k, [lo, hi]]) => t(DMG_NAME[k], `${n(lo)}–${n(hi)}`)).join('<br>');
  return `<div class="th">${esc(tn(G) || G.name)}<small>${esc(tags)}</small></div>
    <div class="gp">${props.map(([k, val]) => `<div>${t(k)}: <span>${val}</span></div>`).join('')}</div>
    ${G['description_' + LANG] || G.description ? `<div class="gd">${esc(G['description_' + LANG] || G.description)}</div>` : ''}
    ${lines.length ? `<div class="tb">${lines.map(esc).join('<br>')}</div>` : ''}
    <div class="gc"><div class="gch">${t('With your tree and gear')}</div>
      ${hits ? `<div>${t('Damage per hit')}:<br><span>${hits}</span></div>` : ''}
      ${s.speed ? `<div>${t(s.attack ? 'Attacks per second' : 'Uses per second')}: <span>${f(s.speed)}</span></div>` : ''}
      ${s.crit != null ? `<div>${t('Critical')}: <span>${f(s.crit)}% · ${t('+{0}% damage', s.critBonus)}</span></div>` : ''}
      <div class="dps">DPS: <span>${s.dps != null ? f(s.dps, 1) : '—'}</span></div>
      ${s.reason ? `<div class="tf">${esc(t(s.reason))}</div>` : ''}</div>`;
}
