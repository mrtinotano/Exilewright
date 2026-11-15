// The loot filter for the game, made from the build: a .filter file (the game's own item filter, picked in its
// options) that makes the kind of gear the build uses stand out where it drops, with nothing to ask the planner.
// A filter sees what an item is (class, base, rarity, base defences), never its modifiers: it marks the candidates,
// and the Loot tab (Ctrl+C over the item) says which one is an upgrade.
//   - weapon and off hand: the classes of the ones the build has; with none, what the skill is used with. Wands and
//     staves that cannot roll modifiers for the skill's damage type are left out (the game data's
//     no_<type>_spell_mods tags).
//   - armour pieces: the same mix of Armour, Evasion and Energy Shield as the pieces the build has; with none, the
//     defences its passives raise, or the ones that go with the skill's attributes.
//   - amulets, rings and belts; jewels when the tree has a socket allocated; the bases of the build's unique items.
// Only Show blocks, and only conditions and actions found in a filter that loads in Path of Exile 2 (NeverSink's):
// before the blocks of another filter it restyles the build's gear and leaves everything else to that filter.
// No DOM here: loot.js is the screen.
import { GEM } from './skills.js';
import { baseOf, basesOf } from './items.js';

const MARK = 'PoE2 Planner';
export const DEFENCES = [['armour', 'BaseArmour', 'Armour'], ['evasion', 'BaseEvasion', 'Evasion'], ['energy_shield', 'BaseEnergyShield', 'Energy Shield']];
export const RARITIES = ['rare', 'magic', 'normal'];   // what a filter can mark, the most worth a look first
const PIECES = ['Helmets', 'Body Armours', 'Gloves', 'Boots'], HELD = ['Shields', 'Bucklers', 'Foci'];
const DAMAGE = ['fire', 'cold', 'lightning', 'chaos', 'physical'];
const uniq = l => [...new Set(l)];

// the weapon classes a skill is used with, as far as its gem says (mace and quarterstaff skills carry no mark of
// their own: strength skills are the maces')
function usedWith(G) {
  const has = x => (G.types || []).includes(x);
  return has('Bow') ? ['Bows'] : has('CrossbowSkill') || has('CrossbowAmmoSkill') ? ['Crossbows'] : has('Spear') ? ['Spears']
    : has('Shapeshift') ? ['Talismans'] : has('Minion') ? ['Sceptres'] : has('Spell') ? ['Wands', 'Staves']
    : has('Attack') && has('Melee') ? G.attr?.str >= 50 ? ['One Hand Maces', 'Two Hand Maces'] : ['Quarterstaves'] : [];
}

// What the filter marks for build b.
//   gears: the sets of items to go by, the one that counts most first (the build's equipment, then what is worn):
//   each question is answered by the first set that can; gem: the skill of b to go by, or null;
//   tree: the summed stats of b's passives without gear; sockets: how many jewel sockets the tree has allocated.
// -> { weapons: [class], only: { class: [base names] } (classes of which only some bases are marked), cut: the damage
//      types those bases roll spell modifiers for, armour: [class], defs: [[armour, evasion, energy shield]] (true:
//      the base has it, false: it has none, null: either), jewellery: [class], jewels, uniques: [{ name, base }],
//      from: { weapons, defs } ('gear', 'skill', 'tree' or '': nothing to go by) }
export function filterPlan({ b, gears, gem, tree = {}, sockets = 0 }) {
  const sets = gears.map(g => Object.entries(g || {}).map(([slot, it]) => ({ slot, it, base: baseOf(it) })).filter(x => x.base));
  const first = f => { for (const s of sets) { const l = f(s); if (l.length) return l; } return []; };
  const G = gem && GEM[gem.name] || null, from = { weapons: '', defs: '' };

  let weapons = first(s => uniq(s.filter(x => x.slot === 'weapon').map(x => x.base.class)));
  if (weapons.length) from.weapons = 'gear';
  else for (const x of [G, ...b.gems.map(g => GEM[g.name])]) {
    if (!x || x.kind === 'support' || !(weapons = usedWith(x)).length) continue;
    from.weapons = 'skill'; break;
  }
  const held = first(s => uniq(s.filter(x => x.slot === 'offhand').map(x => x.base.class)));
  const twoHands = weapons.length > 0 && weapons.every(c => basesOf(c).some(x => x.tags.includes('twohand')));
  if (weapons.includes('Bows')) held.push('Quivers');
  weapons = uniq([...weapons, ...held.filter(c => !HELD.includes(c))]);

  // spells: a wand or staff of another damage type cannot roll the modifiers the skill wants most
  const cut = G && (G.types || []).includes('Spell') ? DAMAGE.filter(d => (G.tags || []).includes(d)) : [], only = {};
  if (cut.length) for (const c of weapons) {
    // Runeforged and Runemastered bases are in no filter known to load: left out, so no name can keep ours from loading
    const all = basesOf(c).filter(x => !/^Rune(forged|mastered) /.test(x.name)), ok = all.filter(x => !cut.every(d => x.tags.includes(`no_${d}_spell_mods`)));
    if (ok.length && ok.length < all.length) only[c] = ok.map(x => x.name);
  }

  const has = x => DEFENCES.map(([k]) => x.armour[k] > 0);
  let defs = first(s => uniq(s.filter(x => x.base.armour && [...PIECES, ...HELD].includes(x.base.class)).map(x => JSON.stringify(has(x.base))))
    .map(k => JSON.parse(k)).filter(k => k.some(Boolean)));
  if (defs.length) from.defs = 'gear';
  else {   // no piece to go by: every base without a defence the build has no use for
    const v = (...ids) => ids.some(id => tree[id] > 0), both = 'evasion_and_physical_damage_reduction_rating_+%';
    let use = [v('physical_damage_reduction_rating_+%', both), v('evasion_rating_+%', both), v('maximum_energy_shield_+%')];
    if (use.some(Boolean)) from.defs = 'tree';
    else if (G?.attr) { use = [G.attr.str > 0, G.attr.dex > 0, G.attr.int > 0]; if (use.some(Boolean)) from.defs = 'skill'; }
    if (from.defs) defs = [use.map(u => u ? (use.filter(Boolean).length === 1 ? true : null) : false)];
  }
  // the off hand: the kind the build has; with none and a hand free, the ones (shield, buckler, focus) with its defences
  const fits = x => x.armour && defs.some(d => d.every((v, i) => v == null || x.armour[DEFENCES[i][0]] > 0 === v) && d.some((v, i) => v !== false && x.armour[DEFENCES[i][0]] > 0));
  const armour = !defs.length ? [] : [...PIECES, ...(held.some(c => HELD.includes(c)) ? held.filter(c => HELD.includes(c))
    : weapons.length && !twoHands ? HELD.filter(c => basesOf(c).some(fits)) : [])];

  const uniques = uniq(sets.flat().filter(x => x.it.unique).map(x => x.it.unique + '\n' + x.base.name)).map(x => { const [name, base] = x.split('\n'); return { name, base }; });
  return { weapons, only, cut, armour, defs, jewellery: ['Amulets', 'Rings', 'Belts'], jewels: sockets > 0, uniques, from };
}

// How each kind looks on the ground: the game's own colour for the name inside a frame of the planner's colour, so
// the build's gear reads as one family; rares get a beam and a mark on the map, the build's uniques a sound too.
const LOOK = {
  unique: ['SetFontSize 45', 'SetTextColor 255 255 255 255', 'SetBorderColor 255 140 0 255', 'SetBackgroundColor 140 60 0 255', 'PlayEffect Orange', 'MinimapIcon 0 Orange Star', 'PlayAlertSound 6 300'],
  rare: ['SetFontSize 42', 'SetTextColor 255 255 119 255', 'SetBorderColor 0 240 190 255', 'SetBackgroundColor 0 70 60 255', 'PlayEffect Cyan', 'MinimapIcon 1 Cyan Diamond'],
  magic: ['SetFontSize 38', 'SetTextColor 136 136 255 255', 'SetBorderColor 0 240 190 255', 'SetBackgroundColor 0 45 40 240', 'PlayEffect Cyan Temp'],
  normal: ['SetFontSize 34', 'SetTextColor 200 200 200 255', 'SetBorderColor 0 150 120 255', 'SetBackgroundColor 0 30 28 220'],
};
// the file is kept to plain ASCII: names come from the game's data, the build's name loses its accents
const ascii = s => String(s || '').normalize('NFD').replace(/[^\x20-\x7e]/g, '').trim();
const quoted = l => l.map(x => `"${x}"`).join(' ');
const cap = s => s[0].toUpperCase() + s.slice(1);

// The filter's text for a plan. min: the lowest rarity marked ('rare', 'magic' or 'normal').
export function filterText(plan, { name = '', min = 'magic' } = {}) {
  const out = [], rar = RARITIES.slice(0, Math.max(0, RARITIES.indexOf(min)) + 1);
  const block = (title, conds, look) => out.push([`Show # ${MARK}: ${title}`, ...[...conds, ...LOOK[look]].map(l => '\t' + l)].join('\n'));
  const each = (title, conds) => { for (const r of rar) block(`${title}, ${r}`, [`Rarity ${cap(r)}`, ...conds], r); };
  // a filter cannot tell one unique from another of the same base: every unique of those bases is marked
  if (plan.uniques.length) block('bases of the unique items of the build', ['Rarity Unique', `BaseType == ${quoted(uniq(plan.uniques.map(u => u.base)))}`], 'unique');
  const free = plan.weapons.filter(c => !plan.only[c]);
  if (free.length) each('weapons', [`Class == ${quoted(free)}`]);
  for (const c in plan.only) each(`${c.toLowerCase()} that roll ${plan.cut.join(' / ')} spell modifiers`, [`Class == "${c}"`, `BaseType == ${quoted(plan.only[c])}`]);
  for (const d of plan.defs) each(`armour (${DEFENCES.filter((_, i) => d[i] !== false).map(x => x[2]).join(d.includes(null) ? ' or ' : ' and ')})`,
    [`Class == ${quoted(plan.armour)}`, ...DEFENCES.flatMap(([, cond], i) => d[i] == null ? [] : [`${cond} ${d[i] ? '> 0' : '0'}`])]);
  each('jewellery', [`Class == ${quoted(plan.jewellery)}`]);
  if (plan.jewels) each('jewels', ['Class == "Jewels"']);
  return [`#>>> ${MARK}: ${ascii(name) || 'Unnamed'}`,
    '# Made by the planner from the build: the kind of gear it uses stands out where it drops.',
    "# A filter cannot see an item's modifiers: copy the item (Ctrl+C over it) for the planner's verdict.",
    '# The planner rewrites everything from the line above to the "#<<<" line; the rest of the file is left alone.',
    '', out.join('\n\n'), '', `#<<< ${MARK}`, ''].join('\n');
}

const SECTION = new RegExp(`^#>>> ${MARK}[^\\n]*\\n[\\s\\S]*?^#<<< ${MARK}[^\\n]*(\\n|$)`, 'gm');
export const isFilter = text => /^[ \t]*(Show|Hide)\b/m.test(text);
// Ours before the blocks of another filter (the first block an item matches decides how it looks), in place of the
// section a planner put there before. Keeps the file's line endings.
export function mergeFilter(theirs, ours) {
  const rest = theirs.replace(/^\uFEFF/, '').replace(SECTION, '').replace(/^\s+/, ''), text = ours + '\n' + rest;
  return rest.includes('\r\n') ? text.replace(/\r?\n/g, '\r\n') : text;
}
const fileSafe = s => (ascii(s) || 'Unnamed').replace(/[\\/:*?"<>|]/g, '-');
// the file's name (the game lists filters by it); other: the name of the filter ours was added to
export function filterFileName(b, other) {
  const own = fileSafe(b.name), base = other ? other.replace(/\.filter$/i, '') : '';
  return (!base ? own : base.endsWith(' + ' + own) ? base : `${base} + ${own}`) + '.filter';
}
