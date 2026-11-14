// Equipment: bases, implicits and affixes from poe2_data/available/items.json (game tables + .it tag inheritance).
// Local stats (local_*) only change the item they are on; everything else is summed into the character.
import { t, tn } from './i18n.js';
import { statLines } from './stats.js';

const D = await fetch('poe2_data/available/items.json').then(r => r.json());
const BASE = Object.fromEntries(D.bases.map(b => [b.name, b]));
// uniques: unique -> mods link from poe2db, every mod matched to the game's Mods table (see _tool/uniques.py)
const UNIQUES = await fetch('poe2_data/available/unique_items.json').then(r => r.ok ? r.json() : []).catch(() => []);
const UNIQ = Object.fromEntries(UNIQUES.filter(u => BASE[u.base]).map(u => [u.name, u]));
const AFFIX = Object.fromEntries([...D.affixes.map(a => [a.id, a]),
  ...UNIQUES.flatMap(u => u.mods.map(m => [m.id, { ...m, affix: 'unique', level: '' }]))]);
export const SLOTS = { weapon: 'Weapon', offhand: 'Off Hand', helmet: 'Helmet', body: 'Body Armour', gloves: 'Gloves', boots: 'Boots', amulet: 'Amulet',
  ring1: 'Ring 1', ring2: 'Ring 2', belt: 'Belt', flask1: 'Life Flask', flask2: 'Mana Flask', charm1: 'Charm 1', charm2: 'Charm 2', charm3: 'Charm 3' };
const slotType = slot => slot.startsWith('jewel:') ? 'jewel' : slot;  // jewels go in allocated tree sockets: "jewel:<node id>"
const img = p => p ? 'poe2_data/available/img/' + p.toLowerCase().replace(/\.dds$/, '.webp') : '';
const MAX_AFFIX = 3; // rare item: up to 3 prefixes and 3 suffixes

// first spawn tag the base has decides the weight (game rule); weight 0 = cannot roll
const canRoll = (a, base) => { if (a.domain !== base.domain) return false; const t = a.spawn.find(([tag]) => base.tags.includes(tag)); return !!t && t[1] > 0; };

function rolled(item) {   // [{stat: value}] of every mod on the item, with the chosen values
  const base = BASE[item.base], out = {};
  const add = (stats, vals) => stats.forEach(([id], k) => { out[id] = (out[id] || 0) + (vals?.[k] ?? 0); });
  base.implicits.forEach((id, i) => add(D.implicits[id], item.implicits?.[i]));
  for (const m of item.mods || []) if (AFFIX[m.id]) add(AFFIX[m.id].stats, m.values);
  return out;
}

// item's own numbers after its local mods: (base + flat) × (1 + increased%)
function local(item) {
  const base = BASE[item.base], s = rolled(item), r = {};
  if (base.armour) {
    const inc = (...ids) => 1 + ids.reduce((t, id) => t + (s[`local_${id}_+%`] || 0), 0) / 100, all = 'armour_and_evasion_and_energy_shield';
    // note: Math.round, the game's exact rounding for defences isn't in the data
    r.armour = Math.round((base.armour.armour + (s.local_base_physical_damage_reduction_rating || 0)) * inc('physical_damage_reduction_rating', 'armour_and_evasion', 'armour_and_energy_shield', all));
    r.evasion = Math.round((base.armour.evasion + (s.local_base_evasion_rating || 0)) * inc('evasion_rating', 'armour_and_evasion', 'evasion_and_energy_shield', all));
    r.energy_shield = Math.round((base.armour.energy_shield + (s.local_energy_shield || 0)) * inc('energy_shield', 'armour_and_energy_shield', 'evasion_and_energy_shield', all));
    r.movement = base.armour['movement_speed_%'] / 100;
  }
  if (base.weapon) {
    const w = base.weapon, phys = 1 + (s['local_physical_damage_+%'] || 0) / 100;
    r.physical = [Math.round((w.min + (s.local_minimum_added_physical_damage || 0)) * phys), Math.round((w.max + (s.local_maximum_added_physical_damage || 0)) * phys)];
    for (const e of ['fire', 'cold', 'lightning']) if (s[`local_minimum_added_${e}_damage`]) r[e] = [s[`local_minimum_added_${e}_damage`], s[`local_maximum_added_${e}_damage`]];
    r.attacks_per_second = 1000 / w.attack_time_ms * (1 + (s['local_attack_speed_+%'] || 0) / 100);
    r.crit = w.crit + (s.local_critical_strike_chance || 0) / 100;
    r.range = w.range;
  }
  if (base.flask) r.flask = base.flask;
  return r;
}

// main-hand weapon after its local mods (damage ranges, attacks/s, crit), null if none
export const weaponStats = (items = {}) => items.weapon && BASE[items.weapon.base]?.weapon ? local(items.weapon) : null;

// global stats the gear gives the character (stat id -> value)
export function gearStats(items = {}) {
  const sum = {};
  const add = (k, v) => { if (v) sum[k] = (sum[k] || 0) + v; };
  for (const item of Object.values(items)) {
    if (!BASE[item.base]) continue;
    for (const [k, v] of Object.entries(rolled(item))) if (!k.startsWith('local_')) add(k, v);
    const l = local(item);
    add('base_physical_damage_reduction_rating', l.armour);
    add('base_evasion_rating', l.evasion);
    add('base_maximum_energy_shield', l.energy_shield);
    add('base_movement_velocity_+%', l.movement);
  }
  return sum;
}

// ---------- UI (laid out like the in-game item tooltip)
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const range = (stats, vals, path) => stats.map(([id, lo, hi], k) => lo === hi ? '' :
  `<input type="number" min="${Math.min(lo, hi)}" max="${Math.max(lo, hi)}" value="${vals?.[k] ?? hi}" data-path="${path}" data-k="${k}" title="${id}: ${lo}–${hi}">`).join('');
const fixVals = (stats, vals) => stats.map(([, lo, hi], k) => Math.min(Math.max(vals?.[k] ?? hi, Math.min(lo, hi)), Math.max(lo, hi)));
const text = (stats, vals) => statLines(Object.fromEntries(stats.map(([id], k) => [id, vals[k]]))).map(esc).join('<br>');
const rarityOf = it => { const mods = it.mods || [], c = a => mods.filter(m => AFFIX[m.id].affix === a).length;
  return it.unique ? 'unique' : !mods.length ? 'normal' : c('prefix') <= 1 && c('suffix') <= 1 ? 'magic' : 'rare'; };
// paper doll like the in-game inventory (8x8 grid); letters are grid areas
const DOLL = ['w w . h h . o o', 'w w . h h a o o', 'w w r b b s o o', 'w w . b b . o o', '. g g b b t t .', '. g g l l t t .', 'f . x y z . m .', 'f . . . . . m .'];
const AREA = { weapon: 'w', offhand: 'o', helmet: 'h', amulet: 'a', ring1: 'r', ring2: 's', body: 'b', gloves: 'g', belt: 'l', boots: 't', flask1: 'f', flask2: 'm', charm1: 'x', charm2: 'y', charm3: 'z' };
const prop = (k, v) => `<div class="prop">${t(k)}: <span>${v}</span></div>`;

// jewelSockets(): [{id, label}] of the allocated jewel sockets in the tree
export function initItems(el, getBuild, changed, jewelSockets = () => []) {
  const types = [...Object.keys(SLOTS), 'jewel'];
  // base / unique picker per slot type: uniques first, in the game's unique colour, each with its art
  const lists = Object.fromEntries(types.map(s => [s, [
    ...Object.values(UNIQ).filter(u => BASE[u.base].slots.includes(s)).sort((a, b) => a.name.localeCompare(b.name))
      .map(u => ({ v: u.name, cls: 'unique', name: u.name, sub: t('Unique') + ' · ' + (tn(BASE[u.base]) || u.base), img: D.unique_img[u.name] || BASE[u.base].img })),
    ...D.bases.filter(b => b.slots.includes(s)).sort((a, b) => a.level - b.level)
      .map(b => ({ v: b.name, cls: 'normal', name: tn(b), sub: (tn(b) !== b.name ? b.name + ' · ' : '') + t('lv {0}', b.level), img: b.img })),
  ].map(o => ({ ...o, key: (o.name + ' ' + o.sub + ' ' + o.v).toLowerCase(),
    html: `<li class="${o.cls}" data-base="${esc(o.v)}"><img src="${img(o.img)}" alt="" loading="lazy"><span>${esc(o.name)}<small>${esc(o.sub)}</small></span></li>` }))]));
  const pickList = (slot, q = '') => { q = q.trim().toLowerCase(); return lists[slotType(slot)].filter(o => !q || o.key.includes(q)).map(o => o.html).join('') || `<li class="note">${t('No results')}</li>`; };

  function card(slot, title, it) {
    const base = it && BASE[it.base];
    if (!base) return `<section class="item"><h3>${title}</h3><input data-slot="${slot}" data-act="filter" placeholder="${t('Search base or unique…')}" autocomplete="off"><ul class="picklist" data-slot="${slot}">${pickList(slot)}</ul></section>`;
    const uniq = it.unique && UNIQ[it.unique], l = local(it), mods = it.mods || [];
    const count = a => mods.filter(m => AFFIX[m.id].affix === a).length;
    const rarity = rarityOf(it);
    const families = new Set(mods.map(m => AFFIX[m.id].family));
    const options = uniq ? [] : D.affixes.filter(a => canRoll(a, base) && !families.has(a.family) && count(a.affix) < MAX_AFFIX)
      .sort((a, b) => a.affix.localeCompare(b.affix) || String(a.family).localeCompare(String(b.family)) || a.level - b.level);
    const props = [
      l.physical && prop('Physical Damage', l.physical.join('–')),
      ...['fire', 'cold', 'lightning'].filter(e => l[e]).map(e => prop({ fire: 'Fire Damage', cold: 'Cold Damage', lightning: 'Lightning Damage' }[e], l[e].join('–'))),
      l.crit && prop('Critical Hit Chance', l.crit.toFixed(2) + '%'), l.attacks_per_second && prop('Attacks per Second', l.attacks_per_second.toFixed(2)),
      l.armour && prop('Armour', l.armour), l.evasion && prop('Evasion Rating', l.evasion), l.energy_shield && prop('Energy Shield', l.energy_shield),
      l.movement && prop('Base Movement Speed', l.movement + '%'),
      l.flask?.life && prop('Recovers Life', t('{0} over {1} s', l.flask.life, l.flask.recovery_s)), l.flask?.mana && prop('Recovers Mana', t('{0} over {1} s', l.flask.mana, l.flask.recovery_s)),
    ].filter(Boolean).join('');
    const impl = base.implicits.map((id, i) => `<div class="mod">${text(D.implicits[id], fixVals(D.implicits[id], it.implicits?.[i]))} ${range(D.implicits[id], it.implicits?.[i], `${slot}.i.${i}`)}</div>`).join('');
    const expl = mods.map((m, i) => { const a = AFFIX[m.id]; return `<div class="mod">${text(a.stats, fixVals(a.stats, m.values))} ${range(a.stats, m.values, `${slot}.m.${i}`)}${uniq ? '' : `<small title="${t(a.affix === 'prefix' ? 'Prefix level {0}' : 'Suffix level {0}', a.level)}">${a.affix === 'prefix' ? 'P' : 'S'}${a.level}</small><button data-slot="${slot}" data-i="${i}" data-act="del">✕</button>`}</div>`; }).join('')
      + (uniq ? uniq.unmatched.filter(Boolean).map(x => `<div class="mod off" title="${t('poe2db lists it but it does not exactly match any game mod: not added')}">${esc(x)} ${t('(unmatched)')}</div>`).join('') : '');
    return `<section class="item"><h3>${title} <button data-slot="${slot}" data-act="clear">✕</button></h3>
      <div class="tip ${rarity}"><div class="head">${uniq ? `${esc(uniq.name)}<br>${esc(base.name)}` : esc(tn(base))}</div>
        <div class="body"><div class="prop">${esc(base.class)} · ${t('level {0}', base.level)}</div>${props}${impl ? '<hr>' + impl : ''}${expl ? '<hr>' + expl : ''}
        ${options.length ? `<hr><select data-slot="${slot}" data-act="add"><option value="">${t('+ Affix ({0}/{1} P, {2}/{1} S)', count('prefix'), MAX_AFFIX, count('suffix'))}</option>${options.map(a =>
          `<option value="${a.id}">${a.affix === 'prefix' ? 'P' : 'S'} ${t('lv {0}', a.level)} · ${esc(statLines(Object.fromEntries(a.stats.map(([id, lo, hi]) => [id, hi]))).join(' / '))}</option>`).join('')}</select>` : ''}
      </div></div></section>`;
  }

  let sel = 'weapon';
  function render() {
    const items = getBuild().items ||= {};
    for (const [slot, it] of Object.entries(items)) {  // data can change between patches: drop what no longer exists
      if (!BASE[it.base] || it.unique && !UNIQ[it.unique]) delete items[slot];
      else it.mods = (it.mods || []).filter(m => AFFIX[m.id]);
    }
    const g = gearStats(items), charms = (g.local_charm_slots || 0) + (g.local_additional_charm_slots || 0) + (g.num_charm_slots || 0);
    const sockets = jewelSockets(), names = Object.fromEntries(Object.entries(SLOTS).map(([k, x]) => [k, t(x)]));
    sockets.forEach(j => names['jewel:' + j.id] = t('Jewel') + ' · ' + j.label);
    if (!names[sel]) sel = 'weapon';
    const cell = (slot, area) => {
      const it = items[slot], base = it && BASE[it.base], u = it?.unique && UNIQ[it.unique];
      return `<div class="cell ${base ? rarityOf(it) : ''}${slot === sel ? ' sel' : ''}" data-pick="${slot}" style="grid-area:${area}" title="${esc(names[slot] + (base ? ': ' + (u ? u.name : tn(base)) : ''))}">${
        base ? `<img src="${img(u && D.unique_img[u.name] || base.img)}" alt="">` : `<span>${names[slot]}</span>`}</div>`;
    };
    el.innerHTML = `<div class="inv"><div><div class="doll" style="grid-template-areas:${DOLL.map(r => `'${r}'`).join(' ')}">${
      Object.keys(SLOTS).map(s => cell(s, AREA[s])).join('')}</div>
      <h3>${t('Jewels ({0} sockets allocated on the tree)', sockets.length)}</h3>
      <div class="jewels">${sockets.map(j => cell('jewel:' + j.id, 'auto')).join('') || `<p class="note">${t('Allocate jewel sockets on the tree to add jewels.')}</p>`}</div>
      <p class="note">${t('Charm slots from your gear mods: {0}. The belt base slot is not in the game data.', charms)}</p></div>
      <div class="editor">${card(sel, names[sel], items[sel])}</div></div>`;
  }

  el.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.act === 'filter') el.querySelector(`.picklist[data-slot="${t.dataset.slot}"]`).innerHTML = pickList(t.dataset.slot, t.value);
  });
  // choosing a base or unique: unique names never collide with base names, so one lookup covers both
  function equip(slot, name) {
    const items = getBuild().items ||= {};
    if (UNIQ[name]) {
      const u = UNIQ[name], b = BASE[u.base];
      items[slot] = { unique: u.name, base: b.name, implicits: b.implicits.map(id => fixVals(D.implicits[id])), mods: u.mods.map(m => ({ id: m.id, values: fixVals(m.stats) })) };
    } else if (BASE[name]) {
      const b = BASE[name];
      items[slot] = { base: b.name, implicits: b.implicits.map(id => fixVals(D.implicits[id])), mods: [] };
    } else return;
    changed(); render();
  }
  el.addEventListener('change', e => {
    const t = e.target, items = getBuild().items ||= {}, slot = t.dataset.slot;
    if (t.dataset.act === 'filter') {  // Enter / blur with an exact name still works
      const o = lists[slotType(slot)].find(o => o.v.toLowerCase() === t.value.trim().toLowerCase() || o.name.toLowerCase() === t.value.trim().toLowerCase());
      if (o) equip(slot, o.v);
      return;
    } else if (t.dataset.act === 'add' && t.value) {
      items[slot].mods.push({ id: t.value, values: fixVals(AFFIX[t.value].stats) });
    } else if (t.dataset.path) {
      const [s, kind, i] = t.dataset.path.split('.'), it = items[s];
      const stats = kind === 'i' ? D.implicits[BASE[it.base].implicits[i]] : AFFIX[it.mods[i].id].stats;
      const arr = kind === 'i' ? it.implicits[i] : it.mods[i].values;
      arr[+t.dataset.k] = +t.value;
      if (kind === 'i') it.implicits[i] = fixVals(stats, arr); else it.mods[i].values = fixVals(stats, arr);
    } else return;
    changed(); render();
  });
  el.addEventListener('click', e => {
    const t = e.target, items = getBuild().items || {}, pick = t.closest('[data-pick]');
    if (pick) { sel = pick.dataset.pick; render(); return; }
    const opt = t.closest('[data-base]');
    if (opt) { equip(opt.closest('.picklist').dataset.slot, opt.dataset.base); return; }
    if (t.dataset.act === 'clear') delete items[t.dataset.slot];
    else if (t.dataset.act === 'del') items[t.dataset.slot].mods.splice(+t.dataset.i, 1);
    else return;
    changed(); render();
  });
  return render;
}
