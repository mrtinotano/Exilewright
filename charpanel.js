// Character sheet laid out like the in-game character panel, and the skill info window (in-game gem tooltip).
import { t, esc, tn, fmt, lang as LANG, kwHtml } from './i18n.js';
import { statLines, shownLines } from './stats.js';
import { character, sheet, skill, reservation, DMG_NAME, QUESTS, questPick, tributeOf } from './calc.js';

const n = x => fmt(x == null ? x : Math.round(x));
const f = (x, d = 2) => fmt(x, d);
const sign = x => (x > 0 ? '+' : '') + x;
const NO_BASE = 'The class base life/mana is missing: it comes from regenerating the data on Windows';

// the game's panel icons (images.py: img/panel)
const ico = k => `<img class="cp-ico ${k}" src="poe2_data/available/img/panel/${k}.webp" alt="">`;

// editable in place: name (input), base class and ascendancy (each row opens its list); level follows the tree
export function renderChar(el, b, sum, { asc, cls, points, need, pending, classes = [], ascOptions = [], picking = null, portrait = '', ascLabel = x => x, clsLabel = x => x }) {
  const c = character(b, sum), R = c.res;
  const questsOpen = el.querySelector('.cp-quests')?.open;   // drawn anew at every change: stays as it was left
  const reward = o => [...statLines(o.stats), ...o.missed.map(l => `${l} (ⓘ ${t('Not understood: it is not counted')})`)].map(esc).join(' · ');   // ⓘ: the app's own notice (.disc in index.html), in words alone: an option of a list takes no markup
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
        <div class="cp-level${b.lvl && b.lvl < need ? ' over' : ''}" title="${t('Auto: the level your {0} passive points need, counting the passive points quests give in each act (as Path of Building 2 estimates it). Manual: the level you type.', points)}${b.lvl && b.lvl < need ? ' ' + t('The allocated points need level {0}.', need) : ''}">${t('Level {0}', `<input class="cp-lvl" type="number" min="1" max="100" data-act="level" value="${b.lvl || ''}" placeholder="${c.level}">`)}<button class="cp-auto" data-act="lvlmode">${t(b.lvl ? 'Manual' : 'Auto')}</button></div>
      </div>
      <div class="cp-portrait" title="${esc(asc ? ascLabel(asc) : '')}"${portrait ? ` style="background-image:url('poe2_data/available/img/${esc(portrait)}')"` : ''}>${portrait ? '' : esc((asc ? ascLabel(asc) : '?')[0])}</div>
      <div class="cp-id cp-attr"><div class="str"><span>${t('Strength')}</span><b>${n(c.attrs.str)}</b></div><div class="dex"><span>${t('Dexterity')}</span><b>${n(c.attrs.dex)}</b></div><div class="int"><span>${t('Intelligence')}</span><b>${n(c.attrs.int)}</b></div>${tributeOf(sum) ? `<div><span>${t('Tribute')}</span><b>${n(tributeOf(sum))}</b></div>` : ''}</div>
    </div>
    ${picking ? `<div class="cp-classes">${(picking === 'cls' ? classes : ascOptions).map(k => `<button data-${picking}="${esc(k)}" class="${k === (picking === 'cls' ? cls : asc) ? 'on' : ''}">${esc(picking === 'cls' ? clsLabel(k) : ascLabel(k))}</button>`).join('')}</div>` : ''}
    <div class="cp-row4">${box('life', 'Life', n(c.life), c.life == null ? NO_BASE : '')}${box('es', 'Energy Shield', n(c.es))}${box('mana', 'Mana', n(c.mana), c.mana == null ? NO_BASE : '')}${box('spirit', 'Spirit', c.reserved ? `${n(c.spirit - c.reserved)} <i>/ ${n(c.spirit)}</i>` : n(c.spirit), c.reserved ? t('{0} reserved by your skills', c.reserved) : '')}</div>
    <div class="cp-row3">${box('armour', 'Armour', pctOr(c.armourPct, c.armour), c.armourPct != null ? t('Estimated physical damage reduction against a hit from a monster of your level, 82 at most ({0} armour)', n(c.armour)) : 'The per-level monster table is missing (it comes from regenerating the data on Windows): showing the armour value')}${box('evasion', 'Evasion', pctOr(c.evadePct, c.evasion), c.evadePct != null ? t('Chance to evade an attack from a monster of your level, 82 at most ({0} evasion)', n(c.evasion)) : 'The per-level monster table is missing (it comes from regenerating the data on Windows): showing the evasion value')}${box('block', 'Block', c.block + '%')}</div>
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
  const s = skill(g, b, sum), st = s.stats, G2 = geo?.(g) || {}, sp = reservation(g, sum, b);
  const tags = (G.tags || []).filter(t => !HIDDEN_TAGS.has(t)).map(x => TAGS[x] ? t(TAGS[x]) : x.replace(/_/g, ' ')).join(', ');
  const lines = shownLines(st, g.name);
  const cost = st._cost && Object.entries(st._cost).map(([k, val]) => t(/life/i.test(k) ? '{0} life' : /es|energy/i.test(k) ? '{0} energy shield' : '{0} mana', val)).join(', ');
  const props = [
    ['Level', st._level],
    st._quality && ['Quality', st._quality + '%'],
    cost && ['Cost', cost],
    sp && ['Reservation', t('{0} spirit', sp)],
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
    ${G['description_' + LANG] || G.description ? `<div class="gd">${kwHtml(G['description_' + LANG] || G.description)}</div>` : ''}
    ${lines.length ? `<div class="tb">${lines.map(esc).join('<br>')}</div>` : ''}
    <div class="gc"><div class="gch">${t('With your tree and gear')}</div>
      ${hits ? `<div>${t('Damage per hit')}:<br><span>${hits}</span></div>` : ''}
      ${s.speed ? `<div>${t(s.attack ? 'Attacks per second' : 'Uses per second')}: <span>${f(s.speed)}</span></div>` : ''}
      ${s.crit != null ? `<div>${t('Critical')}: <span>${f(s.crit)}% · ${t('+{0}% damage', s.critBonus)}</span></div>` : ''}
      <div class="dps">DPS: <span>${s.dps != null ? f(s.dps, 1) : '—'}</span></div>
      ${s.reason ? `<div class="tf">${esc(t(s.reason))}</div>` : ''}</div>`;
}
