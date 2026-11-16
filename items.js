// Equipment: bases, implicits and affixes from poe2_data/available/items.json (game tables + .it tag inheritance).
// Local stats (local_*) only change the item they are on; everything else is summed into the character.
import { t, tn, lang, fmt } from './i18n.js';
import { statLines, statLinesEn, shownLines } from './stats.js';
import { diff, impactHtml, impactLine, impactText } from './impact.js';

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
  for (const [id, val] of Object.entries(item.extra || {})) out[id] = (out[id] || 0) + val;   // runes, enchantments (parseItem)
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
    r.tags = base.tags;   // mace, bow, onehand...: what kind of weapon it is
  }
  if (base.flask) r.flask = base.flask;
  if (base.spirit) r.spirit = Math.round(base.spirit * (1 + (s['local_spirit_+%'] || 0) / 100));   // a sceptre's own Spirit
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
    add('base_spirit_from_equipment', l.spirit);
  }
  return sum;
}

// ---------- item text, in English like Path of Building and the game's Ctrl+C copy
const RARITY = { normal: 'NORMAL', magic: 'MAGIC', rare: 'RARE', unique: 'UNIQUE' };
const linesIn = (say, stats, vals) => say(Object.fromEntries(stats.map(([id], k) => [id, vals[k]]))).flatMap(l => l.split('\n'));
const enLines = (stats, vals) => linesIn(statLinesEn, stats, vals);
function itemParts(it) {
  const base = BASE[it.base];
  if (!base) return null;
  const r = rarityOf(it), mods = (it.mods || []).filter(m => AFFIX[m.id]);
  const impl = base.implicits.flatMap((id, i) => enLines(D.implicits[id], fixVals(D.implicits[id], it.implicits?.[i])));
  const expl = mods.flatMap(m => enLines(AFFIX[m.id].stats, fixVals(AFFIX[m.id].stats, m.values)));
  const ilvl = Math.max(base.level, ...mods.map(m => +AFFIX[m.id].level || 0));
  return { r, base, impl, expl, ilvl, name: r === 'unique' ? it.unique : r === 'rare' ? 'Planned Item' : '' };
}
export function itemText(it) {
  const p = itemParts(it);
  if (!p) return '';
  return ['Rarity: ' + RARITY[p.r], ...p.name ? [p.name] : [], p.base.name,
    'Item Level: ' + p.ilvl, 'Implicits: ' + p.impl.length, ...p.impl, ...p.expl].join('\n');
}
// the note the in-game build planner shows on a slot, in the game's Custom Text markup (<b>{…}, <rgb(r, g, b)>{…});
// colours are Path of Building's rarity / magic-mod colours, the markup has no other way to name them
const RGB = { normal: '200, 200, 200', magic: '136, 136, 255', rare: '255, 255, 119', unique: '175, 96, 37' };
export function itemNote(it) {
  const p = itemParts(it);
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
  for (const c of cands) (by.get(c.lines[0]) || by.set(c.lines[0], []).get(c.lines[0])).push(c);
  for (let i = 0; i < lines.length;) {
    let best = null;
    for (const c of by.get(skel(lines[i])) || []) {
      const span = lines.slice(i, i + c.lines.length);
      if (span.length < c.lines.length || c.lines.some((l, j) => l !== skel(span[j])) || used.has(family(c.key) ?? c.key)) continue;
      const n = nums(span), values = c.stats.map(([, lo, hi], k) => n[k] === undefined ? hi : Math.round(n[k] / c.scale[k]));
      const off = c.stats.reduce((t, [, lo, hi], k) => t + Math.max(0, Math.min(lo, hi) - values[k], values[k] - Math.max(lo, hi)), 0);
      // rolls inside the modifier's range first (two plain modifiers also read as one two-line modifier of another
      // tier, with their numbers far off its range), then the one that takes more lines, then the nearest
      const out = off > 0, bout = best?.off > 0;
      if (!best || out < bout || out === bout && (c.lines.length > best.c.lines.length || c.lines.length === best.c.lines.length && off < best.off)) best = { c, values, off };
    }
    if (best) { found.push({ key: best.c.key, values: fixVals(best.c.stats, best.values), raw: best.values }); used.add(family(best.c.key) ?? best.c.key); i += best.c.lines.length; }
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
const NAMED = new Map();   // every name the data has for a base (English, then the translations), in lower case
for (const k of ['name', ...new Set(D.bases.flatMap(b => Object.keys(b).filter(k => k.startsWith('name_'))))])
  for (const b of D.bases) if (b[k] && !NAMED.has(b[k].toLowerCase())) NAMED.set(b[k].toLowerCase(), b);
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
  const body = raw.slice(ri + 1 + head.length).map(l => l.replace(/^((?:\{[^}]*\})+)(.*)$/, (m, tags, rest) => rest && /\{(rune|enchant)\}/.test(tags) ? rest + ' (rune)' : rest)
    .replace(/(\d)\(-?[\d.]+--?[\d.]+\)/g, '$1').replace(/\s—\s[^—]*$/, '').trim()).filter(Boolean);
  let impl = [], expl = [];
  const tagged = new Map();   // rune and enchantment lines -> as the text has them
  const pi = body.findIndex(l => /^Implicits: \d+$/.test(l));
  if (pi >= 0) {   // Path of Building: "Implicits: N", then N implicit lines (its runes among them), then the rest
    const n = +body[pi].split(' ')[1], rune = l => TAGS[l.match(TAG)?.[1]] === 'skip' && !!tagged.set(l.replace(TAG, ''), l);
    impl = body.slice(pi + 1, pi + 1 + n).filter(l => !rune(l)); expl = body.slice(pi + 1 + n).filter(l => !rune(l));
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
        if (kind === 'skip') tagged.set(line, l); else (kind === 'explicit' ? expl : mine).push(line);
      });
      impl = own ? [...mine, ...impl] : [...impl, ...mine];
    }
  }
  const item = { base: base.name, implicits: base.implicits.map(id => fixVals(D.implicits[id])), mods: [] };
  const own0 = base.implicits.flatMap((id, i) => shapes(i, D.implicits[id])), im = matchLines(impl, own0);
  // the game's detailed text gives implicits no tag: a plain line worded as one of the base's own is it
  const im2 = matchLines(expl, own0.filter(c => !im.found.some(f => f.key === c.key)));
  for (const f of [...im.found, ...im2.found]) item.implicits[f.key] = f.values;
  expl = im2.missed;
  // runes and enchantments count where the line is worded as a modifier the item can have, else one of any item: the
  // stats are that modifier's and the number is the line's own (two runes add up in one line). The rest is left out
  let left = [...tagged.keys()];
  for (const pool of [a => canRoll(a, base), a => a.domain === base.domain]) {
    if (!left.length) break;
    const m = matchLines(left, D.affixes.filter(pool).flatMap(a => shapes(a.id, a.stats)));
    for (const f of m.found) AFFIX[f.key].stats.forEach(([id], k) => { (item.extra ||= {})[id] = (item.extra[id] || 0) + f.raw[k]; });
    left = m.missed;
  }
  const own = x => matchLines(expl, x.mods.flatMap(m => shapes(m.id, m.stats)));
  // reminder text "(…)", one word states ("Corrupted" in any language) and sentences closed by a full stop (how to use
  // a flask: no modifier ends in one) are not modifiers
  const noise = l => META.test(l) || UNID.test(l) || /^\(.*\)$/.test(l) || /^[\p{L}\p{M}]+$/u.test(l) || /[.。]$/.test(l);
  let ex = u ? null : matchLines(expl, D.affixes.filter(a => canRoll(a, base)).flatMap(a => shapes(a.id, a.stats)), id => AFFIX[id].family);
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
  } else item.mods = ex.found.map(f => ({ id: f.key, values: f.values }));
  return { item, slots: base.slots, missed: [...im.missed, ...ex.missed, ...left.map(l => tagged.get(l))].filter(l => !noise(l)),
    name: head[0] && !NAMED.has(strip(head[0])) ? head[0] : '', unidentified: raw.some(l => UNID.test(l)) };
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
// what the off hand can hold next to a weapon: nothing with a two-handed one, but a quiver with a bow (and only with a
// bow). giant: the build has Giant's Blood, which holds two-handed axes, maces and swords in one hand
export function offhandFits(weapon, off, giant) {
  const w = BASE[weapon?.base], quiver = !!BASE[off?.base]?.tags.includes('quiver');
  if (!w) return true;
  if (quiver || w.tags.includes('bow')) return quiver && w.tags.includes('bow');
  return !w.tags.includes('twohand') || !!giant && /^Two Hand (Axes|Maces|Swords)$/.test(w.class);
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
// Every modifier line a rare item of class `cls` can roll that the trade site can search for: the best tier of each
// affix that is one line, on the best base of each kind (a Str helmet rolls Armour, an Int one Energy Shield;
// `first`: a base to try before the rest).
// -> [{ hash (the site's stat), text (top roll), local, stats: [ids], roll (the number the site sorts by), tries: [{ bare, item }] }]
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
  }
  return [...out.values()];
}
// An item as the trade site lists it -> { item, slots, missed: [lines not counted] } like parseItem, null when the app
// does not have its base. Each line comes with the site's stat and the modifiers it adds up (English name, level and
// range of each): lines: [{ text, hash, kind: 'implicit' | 'explicit' | ..., mods: [{ name, level, mags: [[min, max]] }] }]
export function tradeItem({ name, base: baseName, lines }) {
  const u = UNIQ[name], base = BASE[u ? u.base : baseName];
  if (!base) return null;
  const item = make(u ? u.name : base.name), missed = new Set();
  // the stored value of a shown number: rounded, and with the sign the modifier has ("20% reduced" is -20)
  const stored = (n, scale, [, lo, hi]) => { const v = Math.round(n / scale), in_ = x => x >= Math.min(lo, hi) && x <= Math.max(lo, hi); return !in_(v) && in_(-v) ? -v : v; };
  const read = (id, stats, values, hash, shown) => { for (const p of parts(id, stats)) if (p.hash === hash) p.at.forEach((a, j) => { if (a && shown[j] !== undefined) values[a.k] = stored(shown[j], a.scale, stats[a.k]); }); };
  // implicits: the base's own, in its order
  const imp = lines.filter(l => l.kind === 'implicit');
  if (imp.length === base.implicits.length) imp.forEach((l, i) => { const st = D.implicits[base.implicits[i]], sc = shapes(i, st)[0].scale, n = nums([l.text]);
    item.implicits[i] = fixVals(st, st.map((s, k) => n[k] === undefined ? undefined : stored(n[k], sc[k] || 1, s))); });
  else imp.forEach(l => missed.add(l.text));
  const rest = lines.filter(l => l.kind !== 'implicit');
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
  item.mods = [...found.values()].filter(Boolean).map(f => ({ id: f.a.id, values: fixVals(f.a.stats, f.values) }));
  return { item, slots: base.slots, missed: [...missed] };
}

// ---------- UI (laid out like the in-game item tooltip)
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const range = (stats, vals, path) => stats.map(([id, lo, hi], k) => lo === hi ? '' :
  `<input type="number" min="${Math.min(lo, hi)}" max="${Math.max(lo, hi)}" value="${vals?.[k] ?? hi}" data-path="${path}" data-k="${k}" title="${id}: ${lo}–${hi}">`).join('');
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
    mods: [...statLines(it.extra || {}), ...base.implicits.flatMap((id, i) => say(D.implicits[id], fixVals(D.implicits[id], it.implicits?.[i]))),
      ...(it.mods || []).filter(m => AFFIX[m.id]).flatMap(m => say(AFFIX[m.id].stats, fixVals(AFFIX[m.id].stats, m.values)))] };
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
const DOLL = ['w w . h h . o o', 'w w . h h a o o', 'w w r b b s o o', 'w w . b b . o o', '. g g b b t t .', '. g g l l t t .', 'f . x y z . m .', 'f . . . . . m .'];
const AREA = { weapon: 'w', offhand: 'o', helmet: 'h', amulet: 'a', ring1: 'r', ring2: 's', body: 'b', gloves: 'g', belt: 'l', boots: 't', flask1: 'f', flask2: 'm', charm1: 'x', charm2: 'y', charm3: 'z' };
const prop = (k, v) => `<div class="prop">${t(k)}: <span>${v}</span></div>`;

// jewelSockets(): [{id, label}] of the allocated jewel sockets in the tree
// snapOf(items): calc.js snapshot() of the build if it wore `items` (what each candidate would change)
export function initItems(el, getBuild, changed, jewelSockets, snapOf) {
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
    return lists[slotType(slot)].filter(o => !q || o.key.includes(q)).map(o => `${o.html}${impactLine(gain(slot, make(o.v), o.v))}</span></li>`).join('') || `<li class="note">${t('No results')}</li>`; };

  function card(slot, title, it) {
    const base = it && BASE[it.base];
    if (!base) return `<section class="item"><h3>${title}</h3><input data-slot="${slot}" data-act="filter" placeholder="${t('Search base or unique…')}" autocomplete="off"><ul class="picklist" data-slot="${slot}">${pickList(slot)}</ul></section>`;
    const uniq = it.unique && UNIQ[it.unique], l = local(it), mods = it.mods || [];
    const count = a => mods.filter(m => AFFIX[m.id].affix === a).length;
    const rarity = rarityOf(it), rest = { ...getBuild().items };
    delete rest[slot];
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
    return `<section class="item"><h3>${title} <button data-slot="${slot}" data-act="copy" title="${t('Copy the item as text (Path of Building, trade sites)')}">⧉</button> <button data-slot="${slot}" data-act="clear">✕</button></h3>
      <div class="tip ${rarity}"><div class="head">${uniq ? `${esc(tn(uniq))}<br>${esc(tn(base))}` : esc(tn(base))}</div>
        <div class="body"><div class="prop">${esc(base.class)} · ${t('level {0}', base.level)}</div>${props}${impl ? '<hr>' + impl : ''}${expl ? '<hr>' + expl : ''}
        ${options.length ? `<hr><select data-slot="${slot}" data-act="add"><option value="">${t('+ Affix ({0}/{1} P, {2}/{1} S)', count('prefix'), MAX_AFFIX, count('suffix'))}</option>${options.map(a => {
          const does = impactText(gain(slot, { ...it, mods: [...mods, { id: a.id, values: fixVals(a.stats) }] }, '+' + a.id));
          return `<option value="${a.id}">${a.affix === 'prefix' ? 'P' : 'S'} ${t('lv {0}', a.level)} · ${esc(statLines(Object.fromEntries(a.stats.map(([id, lo, hi]) => [id, hi]))).join(' / '))}${does ? ' → ' + esc(does) : ''}</option>`; }).join('')}</select>` : ''}
      </div></div>${impactHtml(t('What this item adds'), diff(snapOf(rest), now))}</section>`;
  }

  let sel = 'weapon', msg = '';
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
    const cell = (slot, area) => {
      const it = items[slot], base = it && BASE[it.base], u = it?.unique && UNIQ[it.unique];
      return `<div class="cell ${base ? rarityOf(it) : ''}${slot === sel ? ' sel' : ''}" data-pick="${slot}" style="grid-area:${area}" title="${esc(names[slot] + (base ? ': ' + tn(u || base) : ''))}">${
        base ? `<img src="${img(u && D.unique_img[u.name] || base.img)}" alt="">` : `<span>${names[slot]}</span>`}</div>`;
    };
    el.innerHTML = `<div class="inv"><div><div class="doll" style="grid-template-areas:${DOLL.map(r => `'${r}'`).join(' ')}">${
      Object.keys(SLOTS).map(s => cell(s, AREA[s])).join('')}</div>
      <h3>${t('Jewels ({0} sockets allocated on the tree)', sockets.length)}</h3>
      <div class="jewels">${sockets.map(j => cell('jewel:' + j.id, 'auto')).join('') || `<p class="note">${t('Allocate jewel sockets on the tree to add jewels.')}</p>`}</div>
      <p class="note">${t('Charm slots from your gear mods: {0}. The belt base slot is not in the game data.', charms)}</p>
      <textarea class="pasteItem" data-act="paste" rows="2" placeholder="${t('Paste an item here: Ctrl+C on it in the game, or copied from Path of Building')}"></textarea>
      <p class="note" data-msg>${msg}</p></div>
      <div class="editor">${card(sel, names[sel], items[sel])}</div></div>`;
  }

  el.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.act === 'filter') el.querySelector(`.picklist[data-slot="${t.dataset.slot}"]`).innerHTML = pickList(t.dataset.slot, t.value);
    if (t.dataset.act === 'paste' && t.value.trim()) paste(t.value);
  });
  // a pasted item goes in the selected slot if it fits there, else the first free slot it fits
  function paste(text) {
    const r = parseItem(text);
    if (!r) { msg = t('That is not item text, or the planner does not have its base.'); render(); msg = ''; return; }
    const items = getBuild().items ||= {}, fits = s => r.slots.includes(slotType(s));
    const slot = fits(sel) ? sel : r.slots.includes('jewel') ? null : r.slots.find(s => !items[s]) || r.slots[0];
    if (!slot) { msg = t('Select an allocated jewel socket first.'); render(); msg = ''; return; }
    items[slot] = r.item; sel = slot;
    msg = r.missed.length ? t('Not understood ({0}): {1}', r.missed.length, esc(r.missed.join(' · '))) : t('Item added.');
    changed(); render(); msg = '';
  }
  // choosing a base or unique: unique names never collide with base names, so one lookup covers both
  function equip(slot, name) {
    const it = make(name);
    if (!it) return;
    (getBuild().items ||= {})[slot] = it;
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
    if (t.dataset.act === 'copy') { navigator.clipboard.writeText(itemText(items[t.dataset.slot])); t.textContent = '✓'; return; }
    if (t.dataset.act === 'clear') delete items[t.dataset.slot];
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
{ // ...and the off hand: none next to a crossbow, a quiver next to a bow only
  const of = cls => ({ base: D.bases.find(b => b.class === cls)?.name });
  console.assert(!offhandFits(of('Crossbows'), of('Sceptres')) && !offhandFits(of('Crossbows'), of('Quivers')) && offhandFits(of('Bows'), of('Quivers')) && offhandFits(of('Wands'), of('Sceptres')), 'offhandFits');
}
