// Equipment: bases, implicits and affixes from poe2_data/available/items.json (game tables + .it tag inheritance).
// Local stats (local_*) only change the item they are on; everything else is summed into the character.
import { t, tn, lang, fmt, KW } from './i18n.js';
import { statLines, statLinesEn, shownLines } from './stats.js';
import { diff, byGain, impactHtml, impactLine, impactList, impactText } from './impact.js';

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
// desecrated: also the desecrated modifiers (Abyss) its tags allow (reading an item, the item maker, the gear search)
const canRoll = (a, base, desecrated) => { if (a.desecrated ? !desecrated : a.domain !== base.domain) return false; const t = a.spawn.find(([tag]) => base.tags.includes(tag)); return !!t && t[1] > 0; };

// catalyst quality ("Quality (Lightning Modifiers): +10%", rings, amulets, jewels): the modifiers with its tag
// (Mods.ImplicitTags) are that much stronger, rounded down as the game shows them (28 -> 30). The copied text has them
// without it, and so are they kept
const boost = (item, tags, vals) => !item.catalyst || !tags?.includes(item.catalyst) || !vals ? vals
  : vals.map(v => Math.trunc(v * (1 + (item.quality || 0) / 100)));
const modVals = (item, m, vals = m.values) => boost(item, AFFIX[m.id]?.tags, vals);
function rolled(item) {   // [{stat: value}] of every mod on the item, with the chosen values
  const base = BASE[item.base], out = {};
  const add = (stats, vals) => stats.forEach(([id], k) => { out[id] = (out[id] || 0) + (vals?.[k] ?? 0); });
  base.implicits.forEach((id, i) => add(D.implicits[id], boost(item, D.implicit_tags?.[id], item.implicits?.[i])));
  for (const m of item.mods || []) if (AFFIX[m.id] && !AFFIX[m.id].radius) add(AFFIX[m.id].stats, modVals(item, m));
  for (const [id, val] of Object.entries(item.extra || {})) out[id] = (out[id] || 0) + val;   // runes, enchantments (parseItem)
  return out;
}
// A radius jewel (Time-Lost ...): its radius (local_jewel_effect_base_radius, tree units: PassiveJewelRadii "Small" is
// 1000) and what each small / notable passive allocated in it also grants -> { r, small: {stat: value}, notable }, or null
export function radiusOf(item) {
  const base = BASE[item?.base], r = base && rolled(item).local_jewel_effect_base_radius;
  if (!r) return null;
  const out = { r, small: {}, notable: {} };
  for (const m of item.mods || []) { const a = AFFIX[m.id]; if (a?.radius) a.stats.forEach(([id], k) => { out[a.radius][id] = (out[a.radius][id] || 0) + (m.values?.[k] ?? 0); }); }
  return out;
}
// the implicit that is a radius jewel's radius reads as the game shows it: "Radius: Small" (PassiveJewelRadii)
const radiusOnly = st => st.length === 1 && st[0][0] === 'local_jewel_effect_base_radius';
const radiusName = st => (D.jewel_radii || {})[st[0][1]] || String(st[0][1]);
// "Grants Skill: Level 11 Purity of Fire" in any language (grant_line) -> its level
const GRANT = Object.values(D.grant_line || {}).map(tpl => new RegExp('^' + tpl.split(/(\{[01]\})/)
  .map(x => x === '{0}' ? '.+?' : x === '{1}' ? '(\\d+)' : x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('') + '$'));
// how the game words a radius modifier in any language (ClientStrings: "Small Passive Skills in Radius also grant {0}",
// "…は{0}も付与する"): line -> [kind, the modifier's own line]
const RADIUS = Object.values(D.radius_grant).flatMap(o => Object.entries(o).map(([kind, tpl]) =>
  [kind, new RegExp('^' + tpl.split('{0}').map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(':?\\s*(.+?)\\s*') + '$')]));
const radLine = l => RADIUS.map(([kind, re]) => [kind, l.match(re)?.[1]]).find(x => x[1]);
const radLines = (a, lines, code = lang) => !a.radius ? lines : lines.map(l => (D.radius_grant[code] || D.radius_grant.en)[a.radius].replace('{0}', l));

// item's own numbers after its local mods: (base + flat) × (1 + increased%) × (1 + quality%), quality on its own as
// Path of Building 2 has it (Item.lua: armour, evasion, energy shield and a weapon's physical damage)
function local(item) {
  const base = BASE[item.base], s = rolled(item), r = {}, q = 1 + (item.quality || 0) / 100;
  if (base.armour) {
    const inc = (...ids) => 1 + ids.reduce((t, id) => t + (s[`local_${id}_+%`] || 0), 0) / 100, all = 'armour_and_evasion_and_energy_shield';
    // note: Math.round, the game's exact rounding for defences isn't in the data
    r.armour = Math.round((base.armour.armour + (s.local_base_physical_damage_reduction_rating || 0)) * inc('physical_damage_reduction_rating', 'armour_and_evasion', 'armour_and_energy_shield', all) * q);
    r.evasion = Math.round((base.armour.evasion + (s.local_base_evasion_rating || 0)) * inc('evasion_rating', 'armour_and_evasion', 'evasion_and_energy_shield', all) * q);
    r.energy_shield = Math.round((base.armour.energy_shield + (s.local_energy_shield || 0)) * inc('energy_shield', 'armour_and_energy_shield', 'evasion_and_energy_shield', all) * q);
    r.movement = base.armour['movement_speed_%'] / 100;
    // its Strength requirement with its own reduced / no requirements. note: the tree's increased / reduced ones not counted
    r.str = s.local_no_attribute_requirements ? 0 : Math.floor((base.req?.str || 0) * Math.max(0, 1 + (s['local_attribute_requirements_+%'] || 0) / 100));
  }
  if (base.weapon) {
    const w = base.weapon, phys = (1 + (s['local_physical_damage_+%'] || 0) / 100) * q;
    r.physical = [Math.round((w.min + (s.local_minimum_added_physical_damage || 0)) * phys), Math.round((w.max + (s.local_maximum_added_physical_damage || 0)) * phys)];
    for (const e of ['fire', 'cold', 'lightning']) if (s[`local_minimum_added_${e}_damage`]) r[e] = [s[`local_minimum_added_${e}_damage`], s[`local_maximum_added_${e}_damage`]];
    r.attacks_per_second = 1000 / w.attack_time_ms * (1 + (s['local_attack_speed_+%'] || 0) / 100);
    r.crit = w.crit + (s.local_critical_strike_chance || 0) / 100;
    r.range = w.range;
    r.accuracy = s.local_accuracy_rating || 0;   // its own accuracy, for attacks with it
    if (w.reload_ms) r.reload = w.reload_ms / 1000 / (1 + (s['local_reload_speed_+%'] || 0) / 100);   // crossbow, seconds
    r.leech = { life: s.local_life_leech_from_physical_damage_permyriad || 0, mana: s.local_mana_leech_from_physical_damage_permyriad || 0 };   // of its hits' physical damage
    // its own chances on hit: Maim (always on a critical hit) and Bleeding ("Causes Bleeding on Hit": always)
    r.onHit = { maim: s['local_maim_on_hit_%'] || 0, maimCrit: !!s.local_always_maim_on_crit, bleed: s.local_bleed_on_hit ? 100 : s['local_chance_to_bleed_on_hit_%'] || 0 };
    r.tags = base.tags;   // mace, bow, onehand...: what kind of weapon it is
    r.pen = Object.fromEntries(['fire', 'cold', 'lightning'].map(e => [e, (s[`local_${e}_penetration_%`] || 0) + (s['local_elemental_penetration_%'] || 0)]));   // its hits penetrate
  }
  if (base.flask) r.flask = base.flask;
  if (base.spirit) r.spirit = Math.round(base.spirit * (1 + (s['local_spirit_+%'] || 0) / 100));   // a sceptre's own Spirit
  return r;
}

// an equipped piece's own armour or evasion (Titan's Stone Skin, Amazon's Stalking Panther)
export const pieceDef = (items = {}, slot, k) => items[slot] && BASE[items[slot].base]?.armour ? local(items[slot])[k] || 0 : 0;
// main-hand weapon after its local mods (damage ranges, attacks/s, crit), null if none
export const weaponStats = (items = {}) => items.weapon && BASE[items.weapon.base]?.weapon ? local(items.weapon) : null;

// global stats the gear gives the character (stat id -> value)
export function gearStats(items = {}) {
  const sum = {};
  const add = (k, v) => { if (v) sum[k] = (sum[k] || 0) + v; };
  for (const item of Object.values(items)) {
    if (!BASE[item.base]) continue;
    for (const [k, v] of Object.entries(rolled(item))) if (!k.startsWith('local_') || k.endsWith('charm_slots')) add(k, v);   // the belt's charm slots count for the character
    const l = local(item);
    add('base_physical_damage_reduction_rating', l.armour);
    add('base_evasion_rating', l.evasion);
    add('base_maximum_energy_shield', l.energy_shield);
    add('base_movement_velocity_+%', l.movement);
    add('base_spirit_from_equipment', l.spirit);
  }
  return sum;
}

// The armour, evasion and energy shield of the equipped armour pieces (the character panel's "Item Armour"...)
export function armourItems(items = {}) {
  const out = { armour: 0, evasion: 0, energy_shield: 0, movement: 0 };   // movement: their base's movement speed penalty, %
  for (const it of Object.values(items)) if (BASE[it?.base]?.armour) { const l = local(it); for (const k in out) out[k] += l[k] || 0; }
  return out;
}
// Recovery per second of the flasks that apply their effect constantly (their own "applies its Effect constantly", or a
// body armour's "Non-Unique Life Flasks apply their Effects constantly"): amount x (1 + its own increased) x quality x
// (1 + the character's increased) x more / less, over its duration sped up by the recovery rate. Matched to the game's
// character panel, 17/11: Ultimate Life Flask with 92% increased, 25% + 32% from tree and rune, 43% less, 20% slower
// 421.3 per second there (421.6 here: note: the game's rounding of each step isn't in the data); Lavianga's Spirits 37.5
export function flaskRecovery(items = {}, sum = {}) {
  const out = { life: 0, mana: 0 };
  for (const it of Object.values(items)) {
    const f = flaskOf(it, sum);
    if (f?.always) out[f.k] += f.amount / f.time;
  }
  return out;
}
// One drink of a flask: what it recovers (life or mana) over how many seconds, as above, and its charges: the most it
// holds and what a use spends (ComponentCharges, with its own and the character's modifiers) and how much more it gains
// on kill; always: it applies its effect constantly; es: its life recovery also recovers energy shield. null for an item that is not a flask.
export function flaskOf(it, sum = {}) {
  const base = BASE[it?.base]; if (!base?.flask || base.charm) return null;
  const s = rolled(it), k = base.class === 'Life Flasks' ? 'life' : 'mana', g = id => sum[id] || 0, F = base.flask;
  const gInc = g(`flask_${k}_to_recover_+%`) + g('flask_life_and_mana_to_recover_+%');   // the character's increased
  const amount = F[k] * (1 + ((s[`local_flask_${k}_to_recover_+%`] || 0) + (s['local_flask_amount_to_recover_+%'] || 0)) / 100) * (1 + (it.quality || 0) / 100)
    * (1 + gInc / 100) * (k === 'life' ? 1 + g('unique_body_armour_life_flask_life_recovery_+%_final') / 100 : 1) * (g('keystone_oasis') ? 1.3 : 1) * (k === 'life' && g('keystone_eternal_youth') ? .5 : 1);   // Oasis: 30% more; Eternal Youth: 50% less life
  // increased Flask Effect Duration: the same recovery over a longer time
  const time = F.recovery_s * (1 + g('flask_duration_+%') / 100) / (1 + ((s['local_flask_recovery_speed_+%'] || 0) + g(`flask_${k}_recovery_rate_+%`) + g('flask_recovery_speed_+%')) / 100);
  const max = mostCharges(F, s);
  const per = Math.floor(F.per_use * (1 + ((s['local_charges_used_+%'] || 0) + g('flask_charges_used_+%') + (k === 'mana' ? g('flask_mana_charges_used_+%') : 0)) / 100));
  const gain = 1 + (g('flask_charges_gained_+%') + g(`${k}_flask_charges_gained_+%`)) / 100;
  const always = !!s.local_flask_always_drinking || k === 'life' && !it.unique && !!g('non_unique_life_flasks_always_applied_with_no_instant_recovery_only_to_you');
  return { k, amount, inc: gInc, time, max, per, gain, always, keep: g('flasks_%_chance_to_not_consume_charges'), es: k === 'life' && !!g('life_recovery_from_flasks_also_recovers_energy_shield'), img: base.img };
}
const mostCharges = (F, s) => Math.floor((F.charges + (s.local_extra_max_charges || 0)) * (1 + (s['local_max_charges_+%'] || 0) / 100));
// A charm: what sets it off (on: its implicit "used when...", local_flask_use_on_<on>), what it grants while it lasts (its
// buff and the buff's stats: UtilityFlaskBuffs) and for how long, the life, mana and guard it gives when used, and its
// charges as a flask's; null for an item that is not a charm
export function charmOf(it, sum = {}) {
  const base = BASE[it?.base]; if (!base?.charm) return null;
  const s = rolled(it), g = id => sum[id] || 0, F = base.flask;
  // increased Charm Effect: what its buff grants, rounded towards zero
  const E = 1 + g('charm_effect_+%') / 100, stats = base.charm.stats && Object.fromEntries(Object.entries(base.charm.stats).map(([k, x]) => [k, Math.trunc(x * E)]));
  return { on: Object.keys(s).find(k => k.startsWith('local_flask_use_on_'))?.slice(19), ...base.charm, ...stats && { stats },
    img: base.img, name: tn(base) || base.name, time: F.recovery_s * (1 + ((s['local_charm_duration_+%'] || 0) + g('charm_duration_+%')) / 100),
    max: mostCharges(F, s), per: Math.floor(F.per_use * (1 + ((s['local_charges_used_+%'] || 0) + g('charm_charges_used_+%')) / 100)),
    gain: (1 + g('charm_charges_gained_+%') / 100) * (1 + g('primalist_charm_charges_gained_+%_final') / 100), keep: g('charms_%_chance_to_not_consume_charges'),   // Ritualist: more charges
    life: s.charm_recover_X_life_when_used || 0, mana: s.charm_recover_X_mana_when_used || 0, guard: s.charm_gain_X_guard_for_duration || 0 };
}
// self-check: a Lesser Life Flask recovers 50 life over 3 s with 60 charges, 10 a use
{ const f = flaskOf({ base: 'Lesser Life Flask' }); console.assert(f.amount === 50 && f.time === 3 && f.max === 60 && f.per === 10 && f.k === 'life', 'flaskOf');
  const c = charmOf({ base: 'Ruby Charm' }); console.assert(c.on === 'fire_damage_taken' && c.stats['base_fire_damage_resistance_%'] === 25 && charmOf({ base: 'Ruby Charm' }, { 'charm_effect_+%': 10 }).stats['base_fire_damage_resistance_%'] === 27 && c.time === 4 && c.max === 40 && c.per === 20 && !flaskOf({ base: 'Ruby Charm' }), 'charmOf'); }

// ---------- item text, in English like Path of Building and the game's Ctrl+C copy
const RARITY = { normal: 'NORMAL', magic: 'MAGIC', rare: 'RARE', unique: 'UNIQUE' };
const linesIn = (say, stats, vals) => say(Object.fromEntries(stats.map(([id], k) => [id, vals[k]]))).flatMap(l => l.split('\n'));
// en: English, as Path of Building reads it; otherwise the page's language, as the game shows it (the .build notes)
// a trade listing's modifiers in the game's language (what the planner read of them; the rest as the site words them)
export const modsOf = l => { const p = l.item && itemParts(l.item, false); return p ? [...p.impl, ...p.expl, ...l.missed] : l.mods; };
export function itemParts(it, en = true) {
  const base = BASE[it.base];
  if (!base) return null;
  const say = en ? statLinesEn : statLines, lines = (stats, vals) => linesIn(say, stats, vals);
  const r = rarityOf(it), mods = (it.mods || []).filter(m => AFFIX[m.id]);
  const impl = base.implicits.filter(id => !radiusOnly(D.implicits[id])).flatMap((id, i) => lines(D.implicits[id], boost(it, D.implicit_tags?.[id], fixVals(D.implicits[id], it.implicits?.[i]))));
  const radius = base.implicits.map(id => D.implicits[id]).find(radiusOnly);
  const expl = mods.flatMap(m => radLines(AFFIX[m.id], lines(AFFIX[m.id].stats, modVals(it, m, filled(AFFIX[m.id].stats, m.values))), en ? 'en' : lang).map(l => en && m.kind ? `{${m.kind}}${l}` : l));
  const ilvl = Math.max(base.level, ...mods.map(m => +AFFIX[m.id].level || 0));
  const rune = it.extra ? say(it.extra).flatMap(l => l.split('\n')) : [];   // runes and enchantments (parseItem)
  const name = r === 'unique' ? (en ? it.unique : tn(UNIQ[it.unique]) || it.unique) : r === 'rare' ? it.name || (en ? 'Planned Item' : t('Planned Item')) : '';
  return { r, base: en ? base : { ...base, name: tn(base) || base.name }, impl, expl, rune, radius: radius && radiusName(radius), ilvl, name };
}
export function itemText(it) {
  const p = itemParts(it);
  if (!p) return '';
  return ['Rarity: ' + RARITY[p.r], ...p.name ? [p.name] : [], p.base.name,
    'Item Level: ' + p.ilvl, ...it.quality ? ['Quality: ' + it.quality] : [], ...p.radius ? ['Radius: ' + p.radius] : [], 'Implicits: ' + (p.rune.length + p.impl.length), ...p.rune.map(l => '{enchant}{rune}' + l), ...p.impl, ...p.expl].join('\n');   // Path of Building lists runes among its implicits
}
// the note the in-game build planner shows on a slot, in the game's Custom Text markup (<b>{…}, <rgb(r, g, b)>{…});
// colours are Path of Building's rarity / magic-mod colours, the markup has no other way to name them
const RGB = { normal: '200, 200, 200', magic: '136, 136, 255', rare: '255, 255, 119', unique: '175, 96, 37' };
export function itemNote(it, en = false) {
  const p = itemParts(it, en);
  if (!p) return '';
  const clean = l => l.replace(/[{}]/g, '');   // braces delimit the markup
  return [`<rgb(${RGB[p.r]})>{<b>{${clean([p.name, p.base.name].filter(Boolean).join('\n'))}}}`,
    ...[...p.impl, ...p.expl].map(l => `<rgb(${RGB.magic})>{${clean(l)}}`)].join('\n');
}

// reading item text back: each mod that can be on the item is written out and compared line by line with the
// numbers blanked out; the numbers of the matching lines become the mod's values. Written in English (Path of
// Building, an English game) and in the language of the page: the game copies items in the language it is played in
const NUM = /[+-]?\d+(?:\.\d+)?/g;
const skel = l => l.toLowerCase().replace(NUM, '#').replace(/\s+/g, ' ').trim();
const nums = ls => ls.join(' ').match(NUM)?.map(Number) || [];
const SAY = lang === 'en' ? [statLinesEn] : [statLinesEn, statLines];
function shapes(key, stats) {   // the mod as text at its top and bottom roll (the wording can change with the sign)
  const out = new Map();
  for (const say of SAY) for (const end of [2, 1]) {
    const v = stats.map(s => s[end]), lines = linesIn(say, stats, v), shown = nums(lines);
    out.set(lines.map(skel).join('\n'), { key, stats, lines: lines.map(skel), scale: v.map((x, k) => x && shown[k] ? shown[k] / x : 1) });
  }
  return [...out.values()];
}
function matchLines(lines, cands, family = () => null) {
  const by = new Map(), found = [], missed = [], used = new Set();
  // a modifier of several lines is looked up by any of them: the game may print them in another order than ours
  for (const c of cands) for (const l of new Set(c.lines)) (by.get(l) || by.set(l, []).get(l)).push(c);
  for (let i = 0; i < lines.length;) {
    let best = null;
    for (const c of by.get(skel(lines[i])) || []) {
      const span = lines.slice(i, i + c.lines.length), sk = span.map(skel), at = [];
      for (const l of c.lines) at.push(sk.findIndex((x, j) => x === l && !at.includes(j)));
      if (span.length < c.lines.length || at.includes(-1) || used.has(family(c.key) ?? c.key)) continue;
      const n = nums(at.map(j => span[j])), values = c.stats.map(([, lo, hi], k) => n[k] === undefined ? hi : Math.round(n[k] / c.scale[k]));
      const off = c.stats.reduce((t, [, lo, hi], k) => t + Math.max(0, Math.min(lo, hi) - values[k], values[k] - Math.max(lo, hi)), 0);
      // rolls inside the modifier's range first (two plain modifiers also read as one two-line modifier of another
      // tier, with their numbers far off its range), then the one that takes more lines, then the nearest
      const out = off > 0, bout = best?.off > 0;
      if (!best || out < bout || out === bout && (c.lines.length > best.c.lines.length || c.lines.length === best.c.lines.length && off < best.off)) best = { c, values, off };
    }
    if (best) { found.push({ key: best.c.key, values: fixVals(best.c.stats, best.values), raw: best.values, src: lines[i] }); used.add(family(best.c.key) ?? best.c.key); i += best.c.lines.length; }
    else missed.push(lines[i++]);
  }
  return { found, missed };
}
// rows of stats as a game table has them ([[stat id, value], ...] each: the quest rewards, calc.js) -> a reader of
// lines of text worded like those stats: { stats: what the lines give, missed: the lines that are none of them }.
// A line with another number than the table's is not that stat. The game words a stat that is the character's as
// "Global ..." where the line could be taken for an item's own ("30% increased Global Armour, Evasion and Energy
// Shield" is the tree's "30% increased Armour, Evasion and Energy Shield"): read without the word too
export function rowReader(rows) {
  const flat = rows.flat(), cands = flat.flatMap(([id, v], i) => shapes(i, [[id, v, v]]));
  return lines => {
    const stats = {}, missed = [];
    for (const l of lines) {
      const f = matchLines([l], cands).found[0] || matchLines([l.replace(/\bGlobal /, '')], cands).found[0];
      if (f && f.raw[0] === f.values[0]) stats[flat[f.key][0]] = (stats[flat[f.key][0]] || 0) + f.values[0]; else missed.push(l);
    }
    return { stats, missed };
  };
}
// The game's text is in the language the game is played in, so nothing here goes by a label's wording, only by shape:
// "Label: value" lines, the "--------" lines between blocks, a one word "(tag)" closing a line.
const META = /^\p{L}[\p{L}\p{M}' ()]*[:：](\s|$)|^(Corrupted|Mirrored|Unidentified|Sanctified|-+)$/u;
const TAG = /\s*\(([\p{L}\p{M}]+)\)$/u;
const TAGS = { implicit: 'implicit', rune: 'skip', enchant: 'skip', crafted: 'explicit', fractured: 'explicit', desecrated: 'explicit', augmented: 'explicit' };
const UNID = /^(Unidentified|Sin identificar|Non identifié|Nicht identifiziert|Não identificado|Неопознано)$/i;   // not English: to be confirmed in the game
// the four rarities in every language, in order (normal, magic, rare, unique): the glossary's Rarity text names each
// before its colour in brackets ("normal (gris), mágica (azul), rara (amarillo) o única (marrón)")
const RARITIES = ['normal', 'magic', 'rare', 'unique'];
const RARITY_WORDS = Object.entries(KW.Rarity || {}).filter(([k, v]) => k.startsWith('def') && typeof v === 'string')
  .map(([, d]) => [...d.matchAll(/([^\s,、，]+)\s*[(（]/g)].map(m => m[1].toLowerCase())).filter(w => w.length === 4);
// rarityWord: a rarity line's word ("Única", "Unique", "ユニーク") -> 'unique'...: the glossary's word, or one that starts as it
// does (its gender or case may differ: única / único, уникальными / уникальный), or the end of it (in Thai and
// Chinese the word before runs into it)
const rarityWord = w => {
  w = (w || '').trim().toLowerCase(); if (!w) return null;
  const like = x => { let n = 0; while (n < x.length && x[n] === w[n]) n++; return x === w || x.endsWith(w) || n >= Math.max(3, Math.min(x.length, w.length) - 2); };
  return RARITIES[RARITY_WORDS.map(ws => ws.findIndex(like)).find(i => i >= 0)] || null;
};
// corruptLine: the line that says an item is corrupted, in any language: a word of the glossary's "Corrupted Items"
// (KW.Corrupted) as the item's text words it, which may end otherwise ("Corrupto" / "Objetos corruptos", "Осквернено" /
// "Осквернённые предметы"), or part of it where it is one word ("コラプト" / "コラプトアイテム")
const CORRUPT = Object.entries(KW.Corrupted || {}).filter(([k, v]) => k.startsWith('term') && typeof v === 'string').flatMap(([, v]) => v.toLowerCase().replace(/ё/g, 'е').split(/\s+/));
const corruptLine = l => {
  l = l.trim().toLowerCase().replace(/ё/g, 'е'); if (l.length < 2 || /[\s\d:：]/.test(l)) return false;
  return CORRUPT.some(w => { let n = 0; while (n < w.length && w[n] === l[n]) n++; return w.includes(l) || n >= 2 && n >= Math.min(w.length, l.length) - 2; });
};
console.assert(['Corrupted', 'Corrupto', 'Осквернено', 'コラプト', '已汙染', 'Verderbt'].every(corruptLine) && !['Corrupted Blood', 'Corona', 'Rarity: Rare'].some(corruptLine), 'corruptLine');
const NAMED = new Map();   // every name the data has for a base (English, then the translations), in lower case
for (const k of ['name', ...new Set(D.bases.flatMap(b => Object.keys(b).filter(k => k.startsWith('name_'))))])
  for (const b of D.bases) if (b[k] && !NAMED.has(b[k].toLowerCase())) NAMED.set(b[k].toLowerCase(), b);
// every modifier of one kind of item (base.domain) and every implicit, as matchLines candidates: made once
const ANY = new Map(), once = (k, f) => ANY.get(k) || ANY.set(k, f()).get(k);
const anyOf = domain => once(domain, () => D.affixes.filter(a => a.domain === domain && !a.radius).flatMap(a => shapes(a.id, a.stats)));
const anyImplicit = () => once('implicit', () => Object.entries(D.implicits).flatMap(([id, st]) => shapes('implicit:' + id, st)));
// a belt's own charm slots, which no table gives ("Has 3 Charm Slots"): as a stat, in the words of the game
const CHARM_SLOTS = [1, 2, 3].flatMap(v => shapes('local_charm_slots', [['local_charm_slots', v, v]]));
// the item level: "Item Level: 82", in another language the one block of a single "label: number" line
const itemLevel = text => +(text.match(/^Item Level: (\d+)/m)?.[1] || text.replace(/\r/g, '').split(/\n-{4,}\n/).map(b => b.trim().split('\n'))
  .find(b => b.length === 1 && /^[^:：]+[:：]\s*\d+$/.test(b[0]))?.[0].match(/(\d+)$/)[1] || 0) || null;
// text copied from the game (Ctrl+C on an item) or from Path of Building
// -> { item, slots, missed: [lines not understood], name (as the text calls it), unidentified }, null if it is no item
export function parseItem(text) {
  const raw = text.replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean);
  let ri = raw.findIndex(l => /^Rarity:/i.test(l));
  if (ri < 0) {   // another language: the names follow the last label of the first block
    const end = raw.findIndex(l => /^-{4,}$/.test(l));
    if (end < 0) return null;
    ri = raw.slice(0, end).findLastIndex(l => META.test(l));
  }
  const head = [];
  for (let i = ri + 1; i < raw.length && head.length < 2 && !META.test(raw[i]); i++) head.push(raw[i]);
  const strip = n => n.replace(/^Superior /, '').toLowerCase();
  let u = head.map(n => UNIQ[n]).find(Boolean);
  const base = u ? BASE[u.base] : head.map(n => NAMED.get(strip(n))).find(Boolean)   // a magic item's name has the base's in it
    || [...NAMED].filter(([n]) => head.some(h => h.toLowerCase().includes(n))).sort((a, b) => b[0].length - a[0].length)[0]?.[1];
  if (!base) return null;
  // "{…}" opens a line in Path of Building (its tags) and is a whole line in the game's detailed text (the modifier's
  // name and tier), which also gives the range of each roll right after its number: "34(33-38)% increased Spirit", and
  // a note after a dash where there is one: "Used when you become Frozen — Unscalable Value". Path of Building opens a
  // rune's line with "{enchant}{rune}": closed by "(rune)" here, as the game's text has it
  const body = raw.slice(ri + 1 + head.length).map(l => l.replace(/^((?:\{[^}]*\})+)(.*)$/, (m, tags, rest) => !rest ? rest : /\{(rune|enchant)\}/.test(tags) ? rest + ' (rune)' : /\{(fractured|crafted)\}/.test(tags) ? `${rest} (${tags.match(/\{(fractured|crafted)\}/)[1]})` : rest)
    .replace(/(\d)\(-?[\d.]+--?[\d.]+\)/g, '$1').replace(/\s—\s[^—]*$/, '').trim()).filter(Boolean);
  let impl = [], expl = [];
  const tagged = new Map();   // rune and enchantment lines -> as the text has them
  const kinds = new Map();    // a fractured or crafted modifier's line -> that (the trade site asks each kind apart)
  const kindOf = (l, k) => { if (k === 'fractured' || k === 'crafted') { l = l.replace(TAG, ''); kinds.set(l, k); } return l; };
  const pi = body.findIndex(l => /^Implicits: \d+$/.test(l));
  if (pi >= 0) {   // Path of Building: "Implicits: N", then N implicit lines (its runes among them), then the rest
    const n = +body[pi].split(' ')[1], rune = l => TAGS[l.match(TAG)?.[1]] === 'skip' && !!tagged.set(l.replace(TAG, ''), l);
    impl = body.slice(pi + 1, pi + 1 + n).filter(l => !rune(l)); expl = body.slice(pi + 1 + n).filter(l => !rune(l)).map(l => kindOf(l, l.match(TAG)?.[1]));
  } else {
    // the game: implicits end in "(implicit)", runes and enchantments in "(rune)" / "(enchant)". In
    // another language the tag is another word: a block whose lines all end in the same one is taken for the
    // implicits (the last such block first, as the game lists them last; what is not one of the base's is left out),
    // and a tagged line among plain ones is a modifier like any other (crafted, fractured...)
    const blocks = [[]];
    for (const l of body) if (/^-{4,}$/.test(l)) blocks.push([]); else if (!META.test(l)) blocks.at(-1).push(l);
    // right under the names is what the item is by itself, in sentences on a flask or a charm ("Recovers 1766 Life over
    // 3 Seconds", "Currently has 75 Charges"): no modifiers there
    blocks[/^-{4,}$/.test(body[0]) ? 1 : 0] = [];
    for (const lines of blocks) {
      const tags = lines.map(l => l.match(TAG)?.[1].toLowerCase());
      const own = lines.length > 0 && tags.every(x => x && x === tags[0] && !TAGS[x]), mine = [];
      lines.forEach((l, i) => {
        const kind = own ? 'implicit' : TAGS[tags[i]] || 'explicit', line = tags[i] ? l.replace(TAG, '') : l;
        if (kind === 'skip') tagged.set(line, l); else (kind === 'explicit' ? expl : mine).push(kindOf(line, tags[i]));
      });
      impl = own ? [...mine, ...impl] : [...impl, ...mine];
    }
  }
  const item = { base: base.name, implicits: base.implicits.map(id => fixVals(D.implicits[id])), mods: [] };
  const addExtra = (stats, raw) => stats.forEach(([id], k) => { (item.extra ||= {})[id] = (item.extra[id] || 0) + raw[k]; });
  // the game: "Quality: +20% (augmented)" ("Calidad: +20% (augmented)": the only "+N% (augmented)" property, the tag
  // stays English in every language), Path of Building: "Quality: 20"
  const quality = raw.map(l => l.match(/^Quality: \+?(\d+)|^[^:]+: \+(\d+)% \(augmented\)$/)?.slice(1).find(Boolean)).find(Boolean);
  if (+quality) item.quality = +quality;
  const catalyst = raw.map(l => D.catalysts?.[l.match(/^(.+): \+\d+% \(augmented\)$/)?.[1]]).find(Boolean);   // "Quality (Lightning Modifiers)"
  if (catalyst) item.catalyst = catalyst;
  // the level of each skill it grants, in the order the game lists them (the base's own first: grantedSkills)
  const levels = raw.map(l => GRANT.map(re => +l.match(re)?.[1]).find(Boolean)).filter(Boolean);
  if (levels.length) item.grantLevels = levels;
  const own0 = base.implicits.flatMap((id, i) => shapes(i, D.implicits[id])), im = matchLines(impl, own0);
  // the game's detailed text gives implicits no tag: a plain line worded as one of the base's own is it
  const im2 = matchLines(expl, own0.filter(c => !im.found.some(f => f.key === c.key)));
  for (const f of [...im.found, ...im2.found]) item.implicits[f.key] = f.values;
  expl = im2.missed;
  // runes and enchantments count where the line is worded as a modifier the item can have, else one of any item, else
  // as what the runes themselves give (SoulCoreStats: "32% increased Life and Mana Recovery from Flasks"): the stats are
  // that one's and the number is the line's own (two runes add up in one line). The rest is left out
  const left = runesOf([...tagged.keys()], base, addExtra);
  const own = x => matchLines(expl, x.mods.flatMap(m => shapes(m.id, m.stats)));
  // reminder text "(…)", one word states ("Corrupted" in any language) and sentences closed by a full stop (how to use
  // a flask: no modifier ends in one) are not modifiers
  const noise = l => META.test(l) || UNID.test(l) || /^\(.*\)$/.test(l) || /^[\p{L}\p{M}]+$/u.test(l) || /[.。]$/.test(l);
  const rad = expl.filter(radLine).map(l => { const [kind, said] = radLine(l), line = said.replace(/\s*\bglobal\b/i, '');
    return matchLines([line], D.affixes.filter(a => a.radius === kind && canRoll(a, base, true)).flatMap(a => shapes(a.id, a.stats))).found[0] || l; });
  expl = expl.filter(l => !radLine(l));
  let ex = u ? null : matchLines(expl, D.affixes.filter(a => canRoll(a, base, true)).flatMap(a => shapes(a.id, a.stats)), id => AFFIX[id].family);
  if (ex) { ex.found.push(...rad.filter(f => typeof f !== 'string')); ex.missed.push(...rad.filter(f => typeof f === 'string')); }
  // a unique the data has no name for in this language: lines no rare item has, and every modifier of one unique of
  // this base (two at least) among them
  if (ex?.missed.some(l => !noise(l)) && head.length > 1) u = UNIQUES.filter(x => x.base === base.name)
    .map(x => ({ x, need: x.mods.filter(m => shapes(m.id, m.stats).some(s => s.lines.length)).length, got: own(x).found.length }))
    .filter(o => o.need > 1 && o.got === o.need).sort((a, b) => b.got - a.got)[0]?.x;
  if (u) {
    item.unique = u.name;
    item.mods = u.mods.map(m => ({ id: m.id, values: fixVals(m.stats) }));
    ex = own(u);
    ex.found.forEach(f => item.mods.find(m => m.id === f.key).values = f.values);
    ex.missed = [];   // flavour text and anything poe2db could not link: the unique keeps its own mods
  } else item.mods = ex.found.map(f => ({ id: f.key, values: f.raw, ...kinds.has(f.src) && { kind: kinds.get(f.src) } }));   // as the item has them (filled)
  // a line worded as no modifier the base can have (Path of Building puts any modifier on any item; an implicit the
  // data does not give the base, "Has 1 Charm Slot") is read as one of any item of its kind: a modifier, or for an
  // implicit line any base's implicit too, counted as its stats (item.extra, as runes)
  const toExtra = f => addExtra(AFFIX[f.key]?.stats || (f.key.startsWith('implicit:') ? D.implicits[f.key.slice(9)] : [[f.key]]), f.raw);
  const more = matchLines(ex.missed, [...anyOf(base.domain), ...CHARM_SLOTS], id => AFFIX[id]?.family);
  for (const f of more.found) if (AFFIX[f.key]) item.mods.push({ id: f.key, values: f.raw }); else toExtra(f);
  ex.missed = more.missed;
  const own1 = matchLines(im.missed, [...anyOf(base.domain), ...anyImplicit(), ...CHARM_SLOTS]);
  own1.found.forEach(toExtra);
  im.missed = own1.missed;
  return { item, slots: base.slots, missed: [...im.missed, ...ex.missed, ...left.map(l => tagged.get(l))].filter(l => !noise(l)),
    name: head[0] && !NAMED.has(strip(head[0])) ? head[0] : '', unidentified: raw.some(l => UNID.test(l)),
    rarity: rarityWord(raw[ri].split(/[:：]/)[1]), ilvl: itemLevel(text), corrupted: raw.some(corruptLine),
    mirrored: raw.includes('Mirrored'), sanctified: raw.includes('Sanctified'),   // note: English text only (META)
    sockets: raw.map(l => l.match(/^[^:：]+[:：]\s*(S(?:\s+S)*)\s*$/)?.[1].split(/\s+/).length).find(Boolean) || 0 };
}

// ---------- what a slot can have and what the trade site lists (gear search, trade.js)
// trade_mods.json (from Path of Building 2, _tool/pob2.py): modifier id -> [its English name, [the trade site's number of
// the stat, then lo, hi of every number the line shows] per line]. The site and the app meet on those numbers, so
// nothing here depends on how a line is worded or in which language.
const TRADE = await fetch('poe2_data/available/trade_mods.json').then(r => r.ok ? r.json() : {}).then(j => j.mods || {}).catch(() => ({}));
// a base or unique as it is when first equipped: every roll at its best
const make = name => { const u = UNIQ[name], b = BASE[u ? u.base : name];
  return b && { ...(u && { unique: u.name }), base: b.name, implicits: b.implicits.map(id => fixVals(D.implicits[id])), mods: u ? u.mods.map(m => ({ id: m.id, values: fixVals(m.stats) })) : [] }; };
export const classOf = it => BASE[it?.base]?.class;
export const TRADE_LABELS = D.trade_labels || {};   // a gem's and a waystone's property labels in each language, by the trade site's filter
export const isCorrupted = text => text.replace(/\r/g, '').split('\n').some(corruptLine);
// the skills the gear gives with no gem (a sceptre's Purity of Fire, a unique's Blink): [[gem name, slot, level the item says]]
export const grantedSkills = (items = {}) => Object.entries(items).flatMap(([slot, it]) =>
  [...BASE[it.base]?.grants || [], ...(it.mods || []).map(m => D.mod_grants?.[m.id]).filter(Boolean)].map((n, i) => [n, slot, it.grantLevels?.[i]]));
// what the off hand can hold next to a weapon: nothing with a two-handed one, but a quiver with a bow (and only with a
// bow). giant: the build has Giant's Blood, which holds two-handed axes, maces and swords in one hand
export function offhandFits(weapon, off, giant) {
  const w = BASE[weapon?.base], quiver = !!BASE[off?.base]?.tags.includes('quiver');
  if (!w) return true;
  if (quiver || w.tags.includes('bow')) return quiver && w.tags.includes('bow');
  return !bothHands(weapon, giant);
}
// a weapon that takes both hands (the game shows it in the off hand too): two-handed, not a bow (it holds a quiver), and
// not one Giant's Blood holds in one hand
export const bothHands = (weapon, giant) => { const w = BASE[weapon?.base];
  return !!w?.tags.includes('twohand') && !w.tags.includes('bow') && !(giant && /^Two Hand (Axes|Maces|Swords)$/.test(w.class)); };
// Weapon sets (the game's I and II): the set not in use waits in b.swap (its weapon and off hand) and b.wset is the one
// in use; switching trades them, so everything else only ever sees the set in hand
export const isQuiver = it => BASE[it?.base]?.class === 'Quivers';
export function swapSet(b, n) {
  if (n === (b.wset === 2 ? 2 : 1)) return;   // that set is in hand already
  const items = b.items ||= {}, other = b.swap || {};
  b.swap = { ...items.weapon && { weapon: items.weapon }, ...items.offhand && { offhand: items.offhand } };
  for (const k of ['weapon', 'offhand']) if (other[k]) items[k] = other[k]; else delete items[k];
  b.wset = b.wset === 2 ? 1 : 2;
}
// The build's saved items (b.stash), like Path of Building's item list: what leaves a slot goes there, so nothing
// equipped over is lost, and any of them can be worn again
export function keep(b, it) {
  if (!it) return;
  const list = b.stash ||= [], k = JSON.stringify(it);
  if (!list.some(x => JSON.stringify(x) === k)) list.push(structuredClone(it));
}
// `it` in `slot` (taken out of the saved items if it was there); what was there, and a weapon or off hand that cannot be
// held with it (a two-handed weapon and anything in the off hand; a quiver without a bow), go to the saved items
export function wear(b, slot, it, giant) {
  const items = b.items ||= {}, k = JSON.stringify(it);
  b.stash = (b.stash || []).filter(x => JSON.stringify(x) !== k);
  keep(b, items[slot]); items[slot] = it;
  if (items.weapon && items.offhand && !offhandFits(items.weapon, items.offhand, giant)) { const o = slot === 'weapon' ? 'offhand' : 'weapon'; keep(b, items[o]); delete items[o]; }
}
export const baseOf = it => BASE[it?.base];                           // the base of an item (name, class, tags, armour...)
export const basesOf = cls => D.bases.filter(b => b.class === cls);   // every base of an item class
export const slotClasses = slot => [...new Set(D.bases.filter(b => b.slots.includes(slot)).map(b => b.class))];
// Which stat each number of a modifier's lines is: the one with that range, as shown (reduced: negated; per second:
// stored per minute...). -> [{ hash, at: [{ k (index in stats), scale (shown / stored) } | null per number shown] }]
const SHOWN_AS = [1, -1, 1 / 60, -1 / 60, 1 / 100, -1 / 100, 1 / 10, 1 / 1000], partsOf = new Map();
function parts(id, stats) {
  if (partsOf.has(id)) return partsOf.get(id);
  const used = new Set(), near = (x, y) => Math.abs(x - y) < 0.06;
  const out = (TRADE[id] || []).slice(1).map(([hash, ...shown]) => ({ hash, at: Array.from({ length: shown.length / 2 }, (_, j) => {
    const lo = shown[2 * j], hi = shown[2 * j + 1];
    for (const r of SHOWN_AS) {
      const k = stats.findIndex(([, a, b], k) => !used.has(k) && (near(a * r, lo) && near(b * r, hi) || near(a * r, hi) && near(b * r, lo)));
      if (k >= 0) { used.add(k); return { k, scale: r }; }
    }
    return null;
  }) }));
  return partsOf.set(id, out).get(id);
}
// The explicit modifier lines of an item as the trade site searches them (the price check): its stat, the item's own
// number as the site keeps it (value, with the stat's own sign: "43% less" is -43 there, under "#% more"; 0 when the
// line has none), whether that number can roll otherwise (varies:
// a unique's fixed lines say nothing about how good this copy is) and whether it changes the item's own damage or
// defence (local). A desecrated line has no stat number of ours (the export has none): `en`, its English wording, finds
// it in the site's list.
export function priceLines(it) {
  const out = new Map();
  for (const m of it.mods || []) {
    const A = AFFIX[m.id]; if (!A) continue;
    const local = A.stats.some(([id]) => id.startsWith('local_'));
    if (A.desecrated) {
      const st = Object.fromEntries(A.stats.map(([id], k) => [id, m.values[k]])), en = statLinesEn(st);
      if (en.length === 1) out.set('d:' + en[0], { en: en[0], kind: 'desecrated', text: statLines(st).join(' / '), value: m.values.length === 1 ? m.values[0] : 0, varies: true, local });
      continue;
    }
    for (const p of parts(m.id, A.stats)) {
      const at = p.at.filter(Boolean), a = at[0], s = a && A.stats[a.k];
      const v = at.length ? at.reduce((x, y) => x + m.values[y.k] * Math.abs(y.scale), 0) / at.length : 0;   // "Adds # to #": the mean, as the site filters it
      const text = statLines(Object.fromEntries(p.at.filter(Boolean).map(x => [A.stats[x.k][0], m.values[x.k]]))).join(' / ');
      out.set(p.hash, { hash: p.hash, kind: m.kind || 'explicit', text, value: v, varies: !it.unique || !!s && s[1] !== s[2], local });
    }
  }
  return [...out.values()];
}
// Every modifier line a rare item of class `cls` can roll that the trade site can search for: the best tier of each
// affix that is one line, on the best base of each kind (a Str helmet rolls Armour, an Int one Energy Shield;
// `first`: a base to try before the rest).
// -> [{ hash (the site's stat), text (top roll), local, stats: [ids], roll (the number the site sorts by), tries: [{ bare, item }] }]
// A desecrated one has no hash (Path of Building's export has none): `en`, its English line, finds it in the site's list.
// bare = the base alone, item = the base with only this modifier: what the line is worth is the difference.
export function affixLines(cls, first) {
  const kind = b => b.tags.filter(x => !/_basetype$|^runeforged$|^default$/.test(x)).sort().join(), seen = new Set(), out = new Map();
  const bases = [BASE[first], ...D.bases.filter(b => b.class === cls).sort((a, b) => b.level - a.level)]
    .filter(b => b && b.class === cls && !seen.has(kind(b)) && seen.add(kind(b)));
  for (const base of bases) {
    const top = new Map();   // family -> its highest tier this base rolls
    for (const a of D.affixes) if (canRoll(a, base) && !(top.get(a.family)?.level >= a.level)) top.set(a.family, a);
    for (const a of top.values()) {
      const tr = TRADE[a.id]; if (tr?.length !== 2) continue;
      const [hash, ...shown] = tr[1], vals = fixVals(a.stats), his = shown.filter((_, i) => i % 2).map(Math.abs);
      const o = out.get(hash) || out.set(hash, { hash, text: statLines(Object.fromEntries(a.stats.map(([id], k) => [id, vals[k]]))).join(' / '),
        local: a.stats.some(([id]) => id.startsWith('local_')), stats: a.stats.map(([id]) => id), roll: his.reduce((x, y) => x + y, 0) / (his.length || 1), tries: [] }).get(hash);
      const bare = make(base.name);
      o.tries.push({ bare, item: { ...bare, mods: [{ id: a.id, values: vals }] } });
    }
    const des = new Map();   // the same for its desecrated modifiers: one line each
    for (const a of D.affixes) if (a.desecrated && canRoll(a, base, true) && !(des.get(a.family)?.level >= a.level)) des.set(a.family, a);
    for (const a of des.values()) {
      const vals = fixVals(a.stats), on = Object.fromEntries(a.stats.map(([id], k) => [id, vals[k]])), en = statLinesEn(on);
      if (en.length !== 1) continue;
      const o = out.get('d:' + en[0]) || out.set('d:' + en[0], { hash: null, desecrated: true, en: en[0], text: statLines(on).join(' / ') + ' · ' + t('Desecrated'),
        local: a.stats.some(([id]) => id.startsWith('local_')), stats: a.stats.map(([id]) => id), roll: vals.reduce((x, y) => x + Math.abs(y), 0) / vals.length, tries: [] }).get('d:' + en[0]);
      const bare = make(base.name);
      o.tries.push({ bare, item: { ...bare, mods: [{ id: a.id, values: vals }] } });
    }
  }
  return [...out.values()];
}
// An item as the trade site lists it -> { item, slots, missed: [lines not counted] } like parseItem, null when the app
// does not have its base. Each line comes with the site's stat and the modifiers it adds up (English name, level and
// range of each): lines: [{ text, hash, kind: 'implicit' | 'explicit' | ..., mods: [{ name, level, mags: [[min, max]] }] }]
// the stats of rune and enchantment lines on an item of `base` (add(stats, raw) for each line read) -> the lines not read
function runesOf(left, base, add) {
  const pool = f => D.affixes.filter(f).map(a => [a.id, a.stats]);
  for (const sets of [pool(a => canRoll(a, base)), pool(a => a.domain === base.domain), D.runes.map((st, i) => [i, st])]) {
    if (!left.length) break;
    const by = new Map(sets), m = matchLines(left, sets.flatMap(([k, st]) => shapes(k, st)));
    for (const f of m.found) add(by.get(f.key), f.raw);
    left = m.missed;
  }
  return left;
}
export function tradeItem({ name, base: baseName, lines, runes = [] }) {
  const u = UNIQ[name], base = BASE[u ? u.base : baseName];
  if (!base) return null;
  const item = make(u ? u.name : base.name), missed = new Set();
  runesOf(runes, base, (stats, raw) => stats.forEach(([id], k) => { (item.extra ||= {})[id] = (item.extra[id] || 0) + raw[k]; }));   // what is socketed in it (runes, soul cores, idols) and its enchantments
  // the stored value of a shown number: rounded, and with the sign the modifier has ("20% reduced" is -20)
  const stored = (n, scale, [, lo, hi]) => { const v = Math.round(n / scale), in_ = x => x >= Math.min(lo, hi) && x <= Math.max(lo, hi); return !in_(v) && in_(-v) ? -v : v; };
  const read = (id, stats, values, hash, shown) => { for (const p of parts(id, stats)) if (p.hash === hash) p.at.forEach((a, j) => { if (a && shown[j] !== undefined) values[a.k] = stored(shown[j], a.scale, stats[a.k]); }); };
  // implicits: the base's own, in its order
  const imp = lines.filter(l => l.kind === 'implicit');
  if (imp.length === base.implicits.length) imp.forEach((l, i) => { const st = D.implicits[base.implicits[i]], sc = shapes(i, st)[0].scale, n = nums([l.text]);
    item.implicits[i] = fixVals(st, st.map((s, k) => n[k] === undefined ? undefined : stored(n[k], sc[k] || 1, s))); });
  else imp.forEach(l => missed.add(l.text));
  // desecrated lines: by their wording, among the desecrated modifiers the base can have (the site gives no hash of ours)
  const des = lines.filter(l => l.kind === 'desecrated'), rest = lines.filter(l => l.kind !== 'implicit' && l.kind !== 'desecrated');
  const byText = (ls, f) => ls.length ? matchLines(ls, D.affixes.filter(f).flatMap(a => shapes(a.id, a.stats)), id => AFFIX[id].family) : { found: [], missed: [] };
  const dm = byText(des.map(l => l.text), a => a.desecrated && canRoll(a, base, true));
  dm.missed.forEach(l => missed.add(l));
  if (u) {   // a unique has its own modifiers: only their rolls are read
    for (const l of rest) { const m = u.mods.find(m => parts(m.id, m.stats).some(p => p.hash === l.hash)), on = m && item.mods.find(x => x.id === m.id);
      if (on) { read(m.id, m.stats, on.values, l.hash, nums([l.text])); on.values = fixVals(m.stats, on.values); } }
    return { item, slots: base.slots, missed: [] };
  }
  // a rare: the same modifier (name and level) can be behind several lines, and a line can add up several modifiers
  const found = new Map();
  for (const l of rest) {
    if (!l.mods?.length) { missed.add(l.text); continue; }
    const n = nums([l.text]);
    l.mods.forEach((m, i) => {
      const key = m.name + '|' + m.level;
      if (!found.has(key)) {
        const hashes = rest.filter(x => x.mods?.some(y => y.name === m.name && y.level === m.level)).map(x => x.hash);
        const fits = a => a.domain === base.domain && a.level === m.level && TRADE[a.id]?.[0] === m.name && hashes.every(h => parts(a.id, a.stats).some(p => p.hash === h));
        const a = D.affixes.find(a => fits(a) && canRoll(a, base)) || D.affixes.find(fits);
        found.set(key, a ? { a, values: fixVals(a.stats) } : null);
      }
      const f = found.get(key);
      if (!f) { missed.add(l.text); return; }
      // its part of each number: every modifier of the line gets at least its minimum, the rest goes to them in order
      const mine = n.map((total, j) => {
        const mags = l.mods.map(x => x.mags?.[j] ? [Math.min(...x.mags[j]), Math.max(...x.mags[j])] : null);
        if (l.mods.length < 2 || mags.some(x => !x)) return l.mods.length < 2 ? total : undefined;
        let left = total - mags.reduce((t, x) => t + x[0], 0), got;
        mags.forEach((x, k) => { const add = Math.max(0, Math.min(left, x[1] - x[0])); if (k === i) got = x[0] + add; left -= add; });
        return got;
      });
      read(f.a.id, f.a.stats, f.values, l.hash, mine);
    });
  }
  // the numbers as listed, not cut to the tier's range: an item keeps what it rolled before a patch changed the tier
  // ("Impregnable", level 75, 43% increased Armour; 45-50% since 18/11)
  // a line under a name the data does not have (a revealed desecrated modifier the site lists among the explicit ones,
  // "+1 to maximum number of Summoned Ballista Totems"; "+3 to Level of all Attack Skills"): by its wording, among the
  // modifiers of the item's kind
  const late = byText(rest.map(l => l.text).filter(x => missed.has(x)), a => a.domain === base.domain || a.desecrated && canRoll(a, base, true));
  late.found.forEach(f => missed.delete(f.src));
  item.mods = [...found.values()].filter(Boolean).map(f => ({ id: f.a.id, values: f.values })).concat([...dm.found, ...late.found].map(f => ({ id: f.key, values: f.raw })));
  return { item, slots: base.slots, missed: [...missed] };
}

// ---------- UI (laid out like the in-game item tooltip)
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const range = (stats, vals, path) => stats.map(([id, lo, hi], k) => lo === hi ? '' :
  `<input type="number" min="${Math.min(lo, hi)}" max="${Math.max(lo, hi)}" value="${vals?.[k] ?? hi}" data-path="${path}" data-k="${k}" title="${id}: ${lo}–${hi}">`).join('');
// a modifier's numbers as the item has them: one rolled before a patch can be off its tier's range now
const filled = (stats, vals) => stats.map(([, , hi], k) => vals?.[k] ?? hi);
const fixVals = (stats, vals) => stats.map(([, lo, hi], k) => Math.min(Math.max(vals?.[k] ?? hi, Math.min(lo, hi)), Math.max(lo, hi)));
const text = (stats, vals) => statLines(Object.fromEntries(stats.map(([id], k) => [id, vals[k]]))).map(esc).join('<br>');
const rarityOf = it => { const mods = it.mods || [], c = a => mods.filter(m => AFFIX[m.id].affix === a).length;
  return it.unique ? 'unique' : !mods.length ? 'normal' : c('prefix') <= 1 && c('suffix') <= 1 ? 'magic' : 'rare'; };
// an item for a card, in the language of the page: its names, art, own numbers and modifier lines (loot.js)
export function itemView(it) {
  const base = BASE[it?.base];
  if (!base) return null;
  const l = local(it), say = (stats, vals) => statLines(Object.fromEntries(stats.map(([id], k) => [id, vals[k]])));
  const hit = ['physical', 'fire', 'cold', 'lightning'].reduce((s, k) => s + (l[k] ? (l[k][0] + l[k][1]) / 2 : 0), 0);
  return { rarity: rarityOf(it), name: it.unique ? tn(UNIQ[it.unique]) || it.unique : '', base: tn(base) || base.name, cls: base.class, img: img(it.unique && D.unique_img[it.unique] || base.img),
    dps: hit * (l.attacks_per_second || 0),   // the weapon's own damage per second
    // its own numbers: [label, number or [from, to], decimals, unit]
    props: [['Physical Damage', l.physical], ['Fire Damage', l.fire], ['Cold Damage', l.cold], ['Lightning Damage', l.lightning],
      ['Critical Hit Chance', l.crit, 2, '%'], ['Attacks per Second', l.attacks_per_second, 2],
      ['Armour', l.armour], ['Evasion Rating', l.evasion], ['Energy Shield', l.energy_shield], ['Spirit', l.spirit]].filter(p => Array.isArray(p[1]) ? p[1][1] : p[1]),
    mods: [...statLines(it.extra || {}), ...base.implicits.flatMap((id, i) => radiusOnly(D.implicits[id]) ? [t('Radius: {0}', t(radiusName(D.implicits[id])))] : say(D.implicits[id], boost(it, D.implicit_tags?.[id], fixVals(D.implicits[id], it.implicits?.[i])))),
      ...(it.mods || []).filter(m => AFFIX[m.id]).flatMap(m => radLines(AFFIX[m.id], say(AFFIX[m.id].stats, modVals(it, m, filled(AFFIX[m.id].stats, m.values)))))] };
}
export const propText = ([, v, dec = 0, unit = '']) => Array.isArray(v) ? `${fmt(v[0])}–${fmt(v[1])}` : fmt(v, dec) + unit;
// what changes hands when `item` takes the place of `old` (null: nothing was there): [lines gained, lines lost] in the
// game's words, every modifier of both counted (the ones that only change the item's own numbers too). A stat both
// have counts by its difference, worded on the side that has more of it
export function modDiff(old, item) {
  const a = old ? rolled(old) : {}, b = rolled(item), gain = {}, lose = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k] || 0, y = b[k] || 0;
    if (x * y < 0) { lose[k] = x; gain[k] = y; }
    else if (Math.abs(y) > Math.abs(x)) gain[k] = y - x;
    else if (x !== y) lose[k] = x - y;
  }
  return [gain, lose].map(s => shownLines(s));
}
// paper doll like the in-game inventory (8x8 grid); letters are grid areas
const DOLL = ['v v . . . . u u', 'w w . h h . o o', 'w w . h h a o o', 'w w r b b s o o', 'w w . b b . o o', '. g g b b t t .', '. g g l l t t .', 'f . x y z . m .', 'f . . . . . m .'];
const AREA = { weapon: 'w', offhand: 'o', helmet: 'h', amulet: 'a', ring1: 'r', ring2: 's', body: 'b', gloves: 'g', belt: 'l', boots: 't', flask1: 'f', flask2: 'm', charm1: 'x', charm2: 'y', charm3: 'z' };
const DEFS = [['armour', 'Armour'], ['evasion', 'Evasion Rating'], ['energy_shield', 'Energy Shield']];   // an armour piece's own defences (local())
const ATTR = { str: 'Strength', dex: 'Dexterity', int: 'Intelligence' };
// why the character cannot wear a listed item yet (l.req, from the site): the levels to go, and each attribute short of
// it with the tree's increased / reduced requirements (s: the character's snapshot without the item worn there; null: not asked)
export function unmet(l, lvl, s) {
  const r = l.req || {}, out = r.lvl > lvl ? [t('Not usable yet: reach level {0} ({1} levels to go).', r.lvl, r.lvl - lvl)] : [];
  for (const k of s ? Object.keys(ATTR) : []) { const need = Math.floor((r[k] || 0) * Math.max(0, 1 + (s.reqPct || 0) / 100)), have = s[k] || 0;
    if (need > have) out.push(t('Not usable: {0} more {1} needed ({2}; you have {3} without the item worn). Respec the passive tree for it.', need - have, t(ATTR[k]), need, have)); }
  return out;
}
const prop = (k, v) => `<div class="prop">${t(k)}: <span>${v}</span></div>`;

// jewelSockets(): [{id, label}] of the allocated jewel sockets in the tree
// snapOf(items): calc.js snapshot() of the build if it wore `items` (what each candidate would change)
// trade: { can(slot), money() -> [[currency, name]], go(slot, max, currency) }: the search for one like the item worn or better
export function initItems(el, getBuild, changed, jewelSockets, snapOf, giant, trade) {
  const types = [...Object.keys(SLOTS), 'jewel'];
  // base / unique picker per slot type: uniques first, in the game's unique colour, each with its art
  const lists = Object.fromEntries(types.map(s => [s, [
    ...Object.values(UNIQ).filter(u => BASE[u.base].slots.includes(s)).sort((a, b) => a.name.localeCompare(b.name))
      .map(u => ({ v: u.name, cls: 'unique', name: tn(u), sub: t('Unique') + ' · ' + (tn(BASE[u.base]) || u.base), img: D.unique_img[u.name] || BASE[u.base].img })),
    ...D.bases.filter(b => b.slots.includes(s)).sort((a, b) => a.level - b.level)
      .map(b => ({ v: b.name, cls: 'normal', name: tn(b), sub: (tn(b) !== b.name ? b.name + ' · ' : '') + t('lv {0}', b.level), img: b.img })),
  ].map(o => ({ ...o, key: (o.name + ' ' + o.sub + ' ' + o.v).toLowerCase(),
    html: `<li class="${o.cls}" data-base="${esc(o.v)}"><img src="${img(o.img)}" alt="" loading="lazy"><span>${esc(o.name)}<small>${esc(o.sub)}</small>` }))]));
  // what the build would gain or lose with `it` in `slot`, against how it is now; kept until the next render
  let now;
  const gains = new Map();
  const gain = (slot, it, key) => { const k = slot + ' ' + key;
    if (!gains.has(k)) gains.set(k, diff(now, snapOf({ ...getBuild().items, [slot]: it })));
    return gains.get(k); };
  const pickList = (slot, q = '') => { q = q.trim().toLowerCase();
    return lists[slotType(slot)].filter(o => !q || o.key.includes(q)).map(o => `${o.html}<span data-g="${esc(o.v)}"></span></span></li>`).join('') || `<li class="note">${t('No results')}</li>`; };
  // each candidate's gains are a whole calculation of the build: filled in a few at a time after the panel shows, not
  // before (the bases and uniques to pick, the saved items, what each affix to add would change)
  let fillRun = 0;
  const fillOne = s => {
    if (s.dataset.g != null) s.outerHTML = impactLine(gain(s.closest('.picklist').dataset.slot, make(s.dataset.g), s.dataset.g));
    else if (s.dataset.stash != null) { const i = +s.dataset.stash, it = (getBuild().stash || [])[i], to = it && whereTo(it); s.outerHTML = to ? impactLine(gain(to, it, 'stash' + i), 3) : ''; }
    else { const slot = s.parentElement.dataset.slot, it = getBuild().items?.[slot], a = AFFIX[s.value]; delete s.dataset.add; if (!it || !a) return;
      const does = impactText(gain(slot, { ...it, mods: [...it.mods || [], { id: a.id, values: fixVals(a.stats) }] }, '+' + a.id)); if (does) s.textContent += ' → ' + does; }
  };
  function fillGains() {
    const run = ++fillRun, todo = [...el.querySelectorAll('.picklist [data-g], [data-stash], option[data-add]')];
    const next = () => { if (run !== fillRun) return;
      for (const s of todo.splice(0, 4)) fillOne(s);
      if (todo.length) setTimeout(next); };
    setTimeout(next);
  }

  function card(slot, title, it) {
    const base = it && BASE[it.base];
    if (!base) return `<section class="item"><h3>${title}</h3><input data-slot="${slot}" data-act="filter" placeholder="${t('Search base or unique…')}" autocomplete="off"><ul class="picklist" data-slot="${slot}">${pickList(slot)}</ul></section>`;
    const uniq = it.unique && UNIQ[it.unique], l = local(it), mods = it.mods || [];
    const count = a => mods.filter(m => AFFIX[m.id].affix === a).length;
    const rarity = rarityOf(it), rest = { ...getBuild().items };
    delete rest[slot];
    const families = new Set(mods.map(m => AFFIX[m.id].family)), desecrated = mods.some(m => AFFIX[m.id].desecrated);
    // one desecrated modifier per item (the game: "This item already has a Desecrated Modifier.")
    const options = uniq ? [] : D.affixes.filter(a => canRoll(a, base, true) && !families.has(a.family) && count(a.affix) < MAX_AFFIX && !(a.desecrated && desecrated))
      .sort((a, b) => a.affix.localeCompare(b.affix) || String(a.family).localeCompare(String(b.family)) || a.level - b.level);
    const props = [
      l.physical && prop('Physical Damage', l.physical.join('–')),
      ...['fire', 'cold', 'lightning'].filter(e => l[e]).map(e => prop({ fire: 'Fire Damage', cold: 'Cold Damage', lightning: 'Lightning Damage' }[e], l[e].join('–'))),
      l.crit && prop('Critical Hit Chance', l.crit.toFixed(2) + '%'), l.attacks_per_second && prop('Attacks per Second', l.attacks_per_second.toFixed(2)),
      l.armour && prop('Armour', l.armour), l.evasion && prop('Evasion Rating', l.evasion), l.energy_shield && prop('Energy Shield', l.energy_shield),
      l.movement && prop('Base Movement Speed', l.movement + '%'),
      (base.armour || base.weapon) && prop('Quality', `<input type="number" min="0" step="1" class="qual" data-slot="${slot}" data-act="quality" value="${it.quality || 0}">%`),
      l.flask?.life && prop('Recovers Life', t('{0} over {1} s', l.flask.life, l.flask.recovery_s)), l.flask?.mana && prop('Recovers Mana', t('{0} over {1} s', l.flask.mana, l.flask.recovery_s)),
    ].filter(Boolean).join('');
    // the attributes the base needs (AttributeRequirements), its own "reduced Attribute Requirements" counted, against the
    // character's without it (its own attributes do not count), with the tree's increased / reduced ones and its gloves' "ignore"
    const without = snapOf(rest), rp = mods.reduce((t, m) => t + AFFIX[m.id].stats.reduce((x, [id], k) => x + (id === 'local_attribute_requirements_+%' ? m.values[k] : 0), 0), 0);
    const free = without?.glovesFree && base.class === 'Gloves' || mods.some(m => AFFIX[m.id].stats.some(([id]) => id === 'local_no_attribute_requirements'));
    const short = free ? [] : Object.entries(base.req || {}).map(([k, x]) => [k, Math.floor(x * Math.max(0, 1 + (rp + (without?.reqPct || 0)) / 100))]).filter(([k, x]) => (without?.[k] || 0) < x);
    const reqs = short.length ? `<div class="ddn">${esc(short.map(([k, x]) => t('Requires {0} {1} (you have {2})', x, t(ATTR[k]), without?.[k] || 0)).join(' · '))}</div>` : '';
    const impl = base.implicits.map((id, i) => `<div class="mod">${radiusOnly(D.implicits[id]) ? esc(t('Radius: {0}', t(radiusName(D.implicits[id])))) : text(D.implicits[id], fixVals(D.implicits[id], it.implicits?.[i]))} ${range(D.implicits[id], it.implicits?.[i], `${slot}.i.${i}`)}</div>`).join('');
    const expl = mods.map((m, i) => { const a = AFFIX[m.id]; return `<div class="mod">${radLines(a, [text(a.stats, fixVals(a.stats, m.values))]).join('')} ${range(a.stats, m.values, `${slot}.m.${i}`)}${uniq ? '' : `<small title="${t(a.affix === 'prefix' ? 'Prefix level {0}' : 'Suffix level {0}', a.level)}">${a.affix === 'prefix' ? 'P' : 'S'}${a.level}</small><button data-slot="${slot}" data-i="${i}" data-act="del">✕</button>`}</div>`; }).join('')
      + (uniq ? uniq.unmatched.filter(Boolean).map(x => `<div class="mod off" title="${t('poe2db lists it but it does not exactly match any game mod: not added')}">${esc(x)} ${t('(unmatched)')}</div>`).join('') : '');
    return `<section class="item"><h3>${title} <button data-slot="${slot}" data-act="copy" title="${t('Copy the item as text (Path of Building, trade sites)')}">⧉</button> <button data-slot="${slot}" data-act="clear">✕</button></h3>
      <div class="tip ${rarity}"><div class="head">${uniq ? `${esc(tn(uniq))}<br>${esc(tn(base))}` : esc(tn(base))}</div>
        <div class="body"><div class="prop">${esc(base.class)} · ${t('level {0}', base.level)}</div>${reqs}${props}${impl ? '<hr>' + impl : ''}${expl ? '<hr>' + expl : ''}
        ${options.length ? `<hr><select data-slot="${slot}" data-act="add"><option value="">${t('+ Affix ({0}/{1} P, {2}/{1} S)', count('prefix'), MAX_AFFIX, count('suffix'))}</option>${options.map(a => {
          return `<option value="${a.id}" data-add>${a.affix === 'prefix' ? 'P' : 'S'} ${t('lv {0}', a.level)}${a.desecrated ? ' · ' + t('Desecrated') : ''} · ${esc(radLines(a, statLines(Object.fromEntries(a.stats.map(([id, lo, hi]) => [id, hi])))).join(' / '))}</option>`; }).join('')}</select>` : ''}
      </div></div>${impactHtml(t('What this item adds'), diff(without, now))}${trade?.can(slot) ? `<div class="imp likebuy"><div class="imph">${t('Gear on the trade site')}</div>
        <div class="likelines"><small>${t('Modifiers it must have, at least as high as yours')}</small>${priceLines(it).filter(l => l.varies && l.text).map(l => { const k = String(l.hash ?? 'd:' + l.en);
          return `<label><input type="checkbox" data-act="likeline" data-k="${esc(k)}"${buy.skip.has(k) ? '' : ' checked'}> ${esc(l.text)}</label>`; }).join('')}</div><div class="likerow"><label>${t('Price up to')} <input type="number" min="0" data-act="likemax" value="${esc(buy.max)}" placeholder="—"></label>
        <select data-act="likecur" title="${esc(t('Currency of the price'))}">${trade.money().map(([c, n]) => `<option value="${esc(c)}"${c === buy.cur ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>
        </div><div class="likego"><label><input type="checkbox" data-act="likebase"${buy.base ? ' checked' : ''}> ${t('Only this base')}</label><label title="${esc(t('Leaves out what the character cannot wear yet.'))}"><input type="checkbox" data-act="likelvl"${buy.lvl ? ' checked' : ''}> ${t('Usable at its level')}</label><label title="${esc(t('Leaves out what the character cannot wear yet.'))}"><input type="checkbox" data-act="likeattr"${buy.attr ? ' checked' : ''}> ${t('Usable with its attributes')}</label><button data-act="like" data-slot="${slot}"${better?.slot === slot && !better.res ? ' disabled' : ''}>${t('Find a better one on the trade site')}</button></div>${better?.slot === slot ? betterHtml(slot) : ''}</div>` : ''}</section>`;
  }

  let sel = 'weapon', msg = '';
  const buy = { max: '', cur: '', base: false, lvl: true, attr: true, skip: new Set() };   // skip: the worn item's lines not asked (by their key)   // the price typed for the trade search
  // where a saved item goes: the selected slot if it fits there, else the first free slot it fits, else the first it fits
  const whereTo = it => { const slots = BASE[it.base]?.slots || [], items = getBuild().items || {};
    return slots.includes(slotType(sel)) ? sel : slots.includes('jewel') ? null : slots.find(s => !items[s]) || slots[0] || null; };
  // the items found better than the one worn (trade.find): best first, each with its price, what it changes and Equip
  let better = null;   // { slot, text (while searching), res }
  function betterHtml(slot) {
    const { text, res } = better;
    if (!res) return `<p class="note" data-busy>${esc(text)}</p>`;
    if (res.error) return `<p class="opterr">${esc(res.error)}</p>`;
    const B = getBuild(), worn = B.items?.[slot], wl = worn && BASE[worn.base] ? local(worn) : {}, { [slot]: _, ...rest } = B.items || {};
    const lvl = B.level > 1 ? B.level : 101, s0 = B.level > 1 ? snapOf(rest) : null, s = s0?.glovesFree && slotType(slot) === 'gloves' ? null : s0;   // no character yet: nothing to check
    return `<div class="stash">${res.found.map((l, i) => { const base = BASE[l.item.base], u = l.item.unique && UNIQ[l.item.unique], L = base ? local(l.item) : {}, rows = gain(slot, { ...l.item, extra: worn?.extra || {} }, 'buy' + i);
      // the piece's own armour, evasion and energy shield against the worn one's (yours → its, the change and its share of yours)
      const defs = DEFS.filter(([k]) => L[k] || wl[k]).map(([k, name]) => { const d = (L[k] || 0) - (wl[k] || 0);
        return `<span>${t(name)}: ${wl[k] && d ? `${wl[k]} → ` : ''}<b>${L[k] || 0}</b>${d ? ` <i class="${d > 0 ? 'dup' : 'ddn'}">${d > 0 ? '+' : '−'}${Math.abs(d)}${wl[k] ? ` (${d > 0 ? '+' : '−'}${fmt(Math.abs(d) / wl[k] * 100, Math.abs(d) / wl[k] < .1 ? 1 : 0)}%)` : ''}</i>` : ''}</span>`; }).join('');   // and its share of the worn one's
      const order = byGain(rows);   // most improved first
      // its base's own modifiers (implicits) apart from the rest by a line, as the game shows them, under its name and base
      const P = itemParts(l.item, false), div = x => `<div>${esc(x)}</div>`;
      const mods = P ? P.impl.map(div).join('') + (P.impl.length && P.expl.length + l.missed.length ? '<div class="bsep"></div>' : '') + [...P.expl, ...l.missed].map(div).join('') : l.mods.map(div).join('');
      // what is socketed (runes, soul cores, idols) and enchanted, one stat a line with its socket, below the changes (which
      // leave it out: the listed item counted with yours): what yours has that this one lacks (lost, as a negative; "of your
      // <slot>"), what this one brings, and its empty sockets. note: the socket is the stat's place among the item's
      // socketed stats (the site and the item keep no socket per stat)
      const A = worn?.extra || {}, Z = l.item.extra || {}, KA = Object.keys(A), KZ = Object.keys(Z), line = (k, x) => statLines({ [k]: x }).join(', ');
      const yours = n => t('Socket {0} of your {1}', n, t(SLOTS[slot] || slot)), alone = [];
      for (const [K, X, Y, sign, cls, where] of [[KA, A, Z, -1, 'ddn', yours], [KZ, Z, A, 1, 'dup', n => t('Socket {0}', n)]]) for (const k of K) if (X[k] !== Y[k])
        alone.push(`<div class="${cls}">${esc(`${line(k, sign * X[k])} (${where(K.indexOf(k) + 1)})`)}</div>`);
      const sock = alone.join('')
        + Array.from({ length: Math.max(0, (l.sockets || 0) - KZ.length) }, (_, n) => `<div class="sempty">${esc(t('Empty (Socket {0})', KZ.length + n + 1))}</div>`).join('');
      return `<div class="stashit buyit ${l.rarity}"><div class="buyl"><img src="${img(u && D.unique_img[u.name] || base?.img)}" alt="">${l.price ? `<span class="buyp">${trade.price(l.price)}</span>` : ''}<button data-act="wearbuy" data-i="${i}">${t('Equip')}</button><a class="buysite" href="${esc(trade.item(res.league, l, res.body?.query?.status?.option))}" target="_blank" rel="noopener">${t('Trade')}</a></div>
        <span><b>${esc(l.name || P?.base.name || l.base)}</b>${l.name && P ? `<div class="bbase">${esc(P.base.name)}</div>` : ''}${defs ? `<div class="bdefs">${defs}</div>` : ''}<div class="bmods">${mods}</div>${impactList(order, true)}${sock ? `<div class="bsock">${sock}</div>` : ''}${unmet(l, lvl, s).map(x => `<div class="ddn">${esc(x)}</div>`).join('')}</span></div>`; }).join('')
      || `<p class="note">${t('Nothing listed matches. Try another league, a higher price or "Any" seller.')}</p>`}</div>
      ${res.need ? `<p class="note">${res.full ? t('{0} listed have all {1} of the modifiers (the first ones); the others have at least {2} of them.', res.full, res.of, res.need) : t('None listed has all {1} of the modifiers: these have at least {0} of them.', res.need, res.of)}</p>` : ''}
      ${res.left ? `<p class="note">${t('{0} of the modifiers are not on the trade site: left out of the search.', res.left)}</p>` : ''}
      <a class="golink" href="${esc(trade.site(res.league, res.body))}" target="_blank" rel="noopener">${t('Open this search on the trade site')}</a>`;
  }
  function stashHtml() {
    const list = getBuild().stash || [];
    return `<h3>${t('Saved items')}</h3>${list.length ? `<div class="stash">${list.map((it, i) => {
      const base = BASE[it.base], u = it.unique && UNIQ[it.unique], to = base && whereTo(it);
      return base ? `<div class="stashit ${rarityOf(it)}"><img src="${img(u && D.unique_img[u.name] || base.img)}" alt="">
        <span><b>${esc(it.name || tn(u || base))}</b><small>${esc(it.name || u ? tn(base) : base.class)}</small>${to ? `<span data-stash="${i}"></span>` : ''}</span>
        <button data-act="wear" data-i="${i}"${to ? '' : ' disabled'} title="${esc(to ? t(SLOTS[slotType(to)] || 'Jewel') : t('Select an allocated jewel socket first.'))}">${t('Equip')}</button>
        <button data-act="drop" data-i="${i}" title="${t('Remove')}">✕</button></div>` : '';
    }).join('')}</div>` : `<p class="note">${t('Items you replace or take off are kept here, to wear them again.')}</p>`}`;
  }
  function render() {
    const items = getBuild().items ||= {};
    for (const [slot, it] of Object.entries(items)) {  // data can change between patches: drop what no longer exists
      if (!BASE[it.base] || it.unique && !UNIQ[it.unique]) delete items[slot];
      else it.mods = (it.mods || []).filter(m => AFFIX[m.id]);
    }
    now = snapOf(items); gains.clear();
    const g = gearStats(items), charms = (g.local_charm_slots || 0) + (g.local_additional_charm_slots || 0) + (g.num_charm_slots || 0);
    const sockets = jewelSockets(), names = Object.fromEntries(Object.entries(SLOTS).map(([k, x]) => [k, t(x)]));
    sockets.forEach(j => names['jewel:' + j.id] = t('Jewel') + ' · ' + j.label);
    if (!names[sel]) sel = 'weapon';
    // a weapon that takes both hands shows in the off hand too, dimmed, as in the game (picking it there picks the weapon)
    const both = !items.offhand && bothHands(items.weapon, giant?.());
    const cell = (slot, area) => {
      const ghost = both && slot === 'offhand', at = ghost ? 'weapon' : slot, it = items[at], base = it && BASE[it.base], u = it?.unique && UNIQ[it.unique];
      return `<div class="cell ${base ? rarityOf(it) : ''}${ghost ? ' ghost' : ''}${slot === sel ? ' sel' : ''}" data-pick="${at}" style="grid-area:${area}" title="${esc(names[slot] + (base ? ': ' + tn(u || base) : ''))}">${
        base ? `<img src="${img(u && D.unique_img[u.name] || base.img)}" alt="">` : `<span>${names[slot]}</span>`}</div>`;
    };
    const set = getBuild().wset === 2 ? 2 : 1, tabs = area => `<div class="wsets" style="grid-area:${area}">${[1, 2].map(n =>
      `<button data-act="wset" data-n="${n}"${n === set ? ' class="on"' : ''} title="${esc(t('Weapon set {0}', n))}">${n === 1 ? 'I' : 'II'}</button>`).join('')}</div>`;
    el.innerHTML = `<div class="inv"><div><div class="doll" style="grid-template-areas:${DOLL.map(r => `'${r}'`).join(' ')}">${
      Object.keys(SLOTS).map(s => cell(s, AREA[s])).join('')}${tabs('v')}${tabs('u')}</div>
      <h3>${t('Jewels ({0} sockets allocated on the tree)', sockets.length)}</h3>
      <div class="jewels">${sockets.map(j => cell('jewel:' + j.id, 'auto')).join('') || `<p class="note">${t('Allocate jewel sockets on the tree to add jewels.')}</p>`}</div>
      <p class="note">${t('Charm slots from your gear mods: {0}. The belt base slot is not in the game data.', charms)}</p>
      <textarea class="pasteItem" data-act="paste" rows="2" placeholder="${t('Paste an item here: Ctrl+C on it in the game, or copied from Path of Building')}"></textarea>
      <p class="note" data-msg>${msg}</p>${stashHtml()}</div>
      <div class="editor">${card(sel, names[sel], items[sel])}</div></div>`;
    fillGains();
  }

  el.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.act === 'filter') { el.querySelector(`.picklist[data-slot="${t.dataset.slot}"]`).innerHTML = pickList(t.dataset.slot, t.value); fillGains(); }
    if (t.dataset.act === 'paste' && t.value.trim()) paste(t.value);
  });
  const put = (slot, it) => wear(getBuild(), slot, it, giant?.());
  // a pasted item goes in the selected slot if it fits there, else the first free slot it fits
  function paste(text) {
    const r = parseItem(text);
    if (!r) { msg = t('That is not item text, or the planner does not have its base.'); render(); msg = ''; return; }
    const items = getBuild().items ||= {}, fits = s => r.slots.includes(slotType(s));
    const slot = fits(sel) ? sel : r.slots.includes('jewel') ? null : r.slots.find(s => !items[s]) || r.slots[0];
    if (!slot) { msg = t('Select an allocated jewel socket first.'); render(); msg = ''; return; }
    put(slot, r.name ? { ...r.item, name: r.name } : r.item); sel = slot;
    msg = r.missed.length ? t('Not understood ({0}): {1}', r.missed.length, esc(r.missed.join(' · '))) : t('Item added.');
    changed(); render(); msg = '';
  }
  // choosing a base or unique: unique names never collide with base names, so one lookup covers both
  function equip(slot, name) {
    const it = make(name);
    if (!it) return;
    put(slot, it);
    changed(); render();
  }
  el.addEventListener('change', e => {
    const t = e.target, items = getBuild().items ||= {}, slot = t.dataset.slot;
    if (t.dataset.act === 'likemax') { buy.max = t.value; return; }
    if (t.dataset.act === 'likecur') { buy.cur = t.value; return; }
    if (t.dataset.act === 'likebase') { buy.base = t.checked; return; }
    if (t.dataset.act === 'likelvl' || t.dataset.act === 'likeattr') { buy[t.dataset.act.slice(4)] = t.checked; return; }
    if (t.dataset.act === 'likeline') { buy.skip[t.checked ? 'delete' : 'add'](t.dataset.k); return; }
    if (t.dataset.act === 'filter') {  // Enter / blur with an exact name still works
      const o = lists[slotType(slot)].find(o => o.v.toLowerCase() === t.value.trim().toLowerCase() || o.name.toLowerCase() === t.value.trim().toLowerCase());
      if (o) equip(slot, o.v);
      return;
    } else if (t.dataset.act === 'quality') {
      const q = Math.max(0, Math.round(+t.value) || 0);
      if (q) items[slot].quality = q; else delete items[slot].quality;
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
    if (t.dataset.act === 'like') {
      const me = better = { slot: t.dataset.slot, text: '…' };   // the search's own text comes with its first step
      render();
      trade.find(me.slot, buy.max, buy.cur, buy.base, [...buy.skip], { lvl: buy.lvl, attr: buy.attr }, text => { me.text = text; const o = el.querySelector('[data-busy]'); if (o) o.textContent = text; })
        .then(res => { if (better === me) { me.res = res; render(); } });
      return;
    }
    if (t.dataset.act === 'wearbuy') { const it = better?.res?.found[+t.dataset.i]?.item; if (!it) return; put(better.slot, structuredClone(it)); sel = better.slot; better = null; changed(); render(); return; }
    if (t.dataset.act === 'copy') { navigator.clipboard.writeText(itemText(items[t.dataset.slot])); t.textContent = '✓'; return; }
    if (t.dataset.act === 'clear') { keep(getBuild(), items[t.dataset.slot]); delete items[t.dataset.slot]; }
    else if (t.dataset.act === 'wear') { const it = getBuild().stash?.[+t.dataset.i], to = it && whereTo(it); if (!to) return; put(to, it); sel = to; }
    else if (t.dataset.act === 'drop') getBuild().stash.splice(+t.dataset.i, 1);
    else if (t.dataset.act === 'wset') swapSet(getBuild(), +t.dataset.n);
    else if (t.dataset.act === 'del') items[t.dataset.slot].mods.splice(+t.dataset.i, 1);
    else return;
    changed(); render();
  });
  return render;
}

// self-check, a rare as the game copies it (detailed text): two plain modifiers, not the two-line one of another tier
console.assert(parseItem('Rarity: Rare\nWoe Crusher\nOmen Sceptre\n--------\nSpirit: 134 (augmented)\n--------\nItem Level: 80\n--------\n{ Prefix Modifier "Viscount\'s" (Tier: 6) }\n34(33-38)% increased Spirit\n{ Prefix Modifier "Blue" (Tier: 1) — Mana }\n+159(150-164) to maximum Mana')
  ?.item.mods.map(m => m.values).join() === '34,159', 'parseItem: detailed item text');
// ...and a flask: what it is by itself and how to use it are not modifiers nobody understood
console.assert(parseItem('Rarity: Magic\nVitiating Ultimate Life Flask of the Perpetual\n--------\nRecovers 1766 (augmented) Life over 3 Seconds\nCurrently has 75 Charges\n--------\nItem Level: 65\n--------\n{ Suffix Modifier "of the Perpetual" (Tier: 2) }\n57(55-62)% increased Charges gained\n--------\nRight click to drink. Refill at Wells or by killing monsters.')
  ?.missed.length === 0, 'parseItem: a flask');
// ...and gloves as Path of Building writes them: the rune counts (among its "Implicits"), its Bonded lines do not
console.assert(parseItem('Rarity: RARE\nBrood Vise\nGold Gloves\nQuality: 0\nSockets: S\nRune: Greater Desert Rune\nLevelReq: 59\nImplicits: 3\n{enchant}{rune}Bonded: +20 to maximum Life\n{enchant}{rune}Bonded: +20 to maximum Mana\n{enchant}{rune}+18% to Fire Resistance\n+40 to maximum Energy Shield')
  ?.item.extra?.['base_fire_damage_resistance_%'] === 18, 'parseItem: a rune in Path of Building text');
// ...and written back the same way (a build exported to Path of Building keeps its runes)
{ const g = parseItem('Rarity: RARE\nBrood Vise\nGold Gloves\nImplicits: 1\n{enchant}{rune}+18% to Fire Resistance\n+40 to maximum Energy Shield').item;
  console.assert(parseItem(itemText(g))?.item.extra?.['base_fire_damage_resistance_%'] === 18 && /^\{enchant\}\{rune\}\+18% to Fire Resistance$/m.test(itemText(g)), 'itemText: runes', itemText(g)); }
{ const g = parseItem('Rarity: RARE\nBrood Vise\nGold Gloves\nImplicits: 0\n{fractured}+40 to maximum Energy Shield').item;   // a fractured modifier stays one
  console.assert(g.mods[0]?.kind === 'fractured' && /^\{fractured\}\+40 to maximum Energy Shield$/m.test(itemText(g)) && priceLines(g)[0]?.kind === 'fractured', 'parseItem: fractured', g.mods); }
// ...and a rune no modifier is worded like
console.assert(parseItem('Rarity: Rare\nWoe Mantle\nGold Gloves\n--------\nItem Level: 70\n--------\n32% increased Life and Mana Recovery from Flasks (rune)')
  ?.item.extra?.['flask_life_and_mana_to_recover_+%'] === 32, 'parseItem: a rune of its own wording');
// ...and quality, a multiplier of its own on the item's defences
{ const r = parseItem('Rarity: Rare\nWoe Mantle\nGold Gloves\n--------\nQuality: +20% (augmented)\nEnergy Shield: 48 (augmented)\n--------\nItem Level: 70'), base = r && BASE[r.item.base].armour.energy_shield;
  console.assert(r?.item.quality === 20 && local(r.item).energy_shield === Math.round(base * 1.2), 'parseItem: quality'); }
{ // a skill the item grants, and its level as the game words it (English and Spanish)
  const g = l => grantedSkills({ weapon: parseItem(`Item Class: Sceptres\nRarity: Normal\nShrine Sceptre\n--------\n${l}\n--------\nItem Level: 40`)?.item })[0];
  console.assert(String(g('Grants Skill: Level 11 Impurity')) === 'Impurity,weapon,11' && g('Otorga la habilidad: Impureza nivel 9')?.[2] === 9, 'grantedSkills', g('Grants Skill: Level 11 Impurity')); }
{ // catalyst quality: the game's own ring (checked in game: lightning resistance +50, not the copied 28 + 19)
  const r = parseItem('Item Class: Rings\nRarity: Rare\nRapture Gyre\nTopaz Ring\n--------\nQuality (Lightning Modifiers): +10% (augmented)\n--------\nItem Level: 49\n--------\n{ Implicit Modifier — Elemental, Lightning, Resistance — 10% Increased }\n+28(20-30)% to Lightning Resistance\n--------\n{ Prefix Modifier "Healthy" (Tier: 7) — Life }\n+21(20-29) to maximum Life\n{ Prefix Modifier "Coursing" (Tier: 3) — Damage, Elemental, Lightning — 10% Increased }\n19(18-22)% increased Lightning Damage\n{ Suffix Modifier "of the Storm" (Tier: 6) — Elemental, Lightning, Resistance — 10% Increased }\n+19(16-20)% to Lightning Resistance'), s = r && rolled(r.item);
  console.assert(s?.['base_lightning_damage_resistance_%'] === 50 && s['lightning_damage_+%'] === 20 && s.base_maximum_life === 21 && String(r.item.mods[2]?.values) === '19', 'parseItem: catalyst', s); }
{ // ...and the off hand: none next to a crossbow, a quiver next to a bow only
  const of = cls => ({ base: D.bases.find(b => b.class === cls)?.name });
  console.assert(!offhandFits(of('Crossbows'), of('Sceptres')) && !offhandFits(of('Crossbows'), of('Quivers')) && offhandFits(of('Bows'), of('Quivers')) && offhandFits(of('Wands'), of('Sceptres')), 'offhandFits');
}
// ...and a modifier of several lines the game prints in another order than its stats (Noble's: base lines first)
{ const k = parseItem("Item Class: Body Armours\nRarity: Magic\nNoble's Wolfskin Mantle\n--------\nItem Level: 65\n--------\n+8 to Armour\n+5 to maximum Energy Shield\n15% increased Armour and Energy Shield");
  console.assert(!k.missed.length && String(k.item.mods[0]?.values) === '15,8,5', 'hybrid modifier out of order', k); }
// ...and a radius jewel as the game copies it: its line read as a small passives' modifier, not one of its own
{ const j = parseItem('Item Class: Jewels\nRarity: Magic\nSharpened Time-Lost Ruby\n--------\nRadius: Small\n--------\nItem Level: 62\n--------\nSmall Passive Skills in Radius also grant 2(1-2)% increased Global Physical Damage');
  console.assert(!j.missed.length && radiusOf(j.item)?.r === 1000 && radiusOf(j.item).small['physical_damage_+%'] === 2 && !gearStats({ 'jewel:1': j.item })['physical_damage_+%']
    && /^Small Passive Skills in Radius also grant 2% increased Physical Damage$/m.test(itemText(j.item)), 'radius jewel', j); }
// ...and a desecrated line of a trade listing, read by its wording; the gear search offers the base's desecrated ones too
console.assert(tradeItem({ base: 'Jungle Tiara', lines: [{ text: '+15% to Lightning and Chaos Resistances', kind: 'desecrated', mods: [] }] })?.item.mods[0]?.values[0] === 15
  && affixLines('Helmets').some(o => o.desecrated && o.en), 'desecrated: trade listing and gear search');
