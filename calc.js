// Character sheet and skill damage, from the summed tree + gear stats (app.js treeSum) and the game data.
// The numbers are the game's own (class base life/mana, skill damage per level: skills.json / ascendancies.json,
// regenerated with poe2_data/_tool after each patch); what the data does not have is null and shown as "—".
import { t, tn, fmt, cap, lang } from './i18n.js';
import { weaponStats, classOf, rowReader, flaskRecovery, armourItems, pieceDef } from './items.js';
import { SK } from './skilldata.js';
import { statLinesEn } from './stats.js';
import { enemy, attackOf, attacksOf, ENEMIES, deflection } from './enemies.js';

// Campaign rewards a character keeps for good. Which the campaign gives and which are a choice comes from Path of
// Building 2 (skilldata.js); the stats of each are the game's own table's, met through the wording of each line.
// b.quests: reward key -> the option taken (1 the first, 0 none). A reward not set counts from the level of its area
// on; a choice among several only once made.
const reward = rowReader(SK.quest_rewards || []);
export const QUESTS = (SK.quests || []).map(q => ({ ...q, options: q.options.map(text => ({ text, ...reward(text.split('\n').map(l => l.trim()).filter(Boolean)) })) }));
// the level the allocated passive points need, as Path of Building 2 estimates it (Build.lua EstimatePlayerProgress):
// a point per level after the first, less the passive points the quests of each act give, the act taken as reached
const ACTS = (SK.quest_points || []).reduce((A, q) => { const a = A[q.act] ||= { level: q.level, qp: A[q.act - 1].qp }; a.qp += q.points; a.level = Math.max(a.level, q.level); return A; }, [{ level: 1, qp: 0 }]);
export function requiredLevel(points) {
  let level = 1;
  for (let i = 0; i < ACTS.length; i++) {
    level = Math.min(Math.max(points + 1 - ACTS[i].qp, ACTS[i].level), 100);
    if (i === ACTS.length - 1 || level <= ACTS[i + 1].level) break;
  }
  return level;
}
console.assert(requiredLevel(0) === 1 && requiredLevel(20) === 17 && requiredLevel(123) === 100, 'requiredLevel');
export const questPick = (b, q) => b.quests?.[q.key] ?? (q.pick || (b.level || 1) < q.level ? 0 : 1);
export function questStats(b) {
  const sum = {};
  for (const q of QUESTS) for (const [k, x] of Object.entries(q.options[questPick(b, q) - 1]?.stats || {})) sum[k] = (sum[k] || 0) + x;
  return sum;
}
// self-check: every reward is worded as stats the game's table has, and those nobody chooses add up (+100 Spirit by the end)
console.assert(QUESTS.length && QUESTS.every(q => q.options.every(o => !o.missed.length)) && questStats({ level: 100 }).base_spirit === 100 && !questStats({ level: 1 }).base_spirit, 'campaign rewards');

// What the build's own skills give the character while they are on: Virtuous Barrier (Gemling Legionnaire), as the
// skill's own text has it. It holds Motes of each attribute, at most the skill's own number plus one per skill of the
// build that requires that attribute (two if it requires no other), and each kind of Mote gives its part: life,
// "Armour, Evasion and Energy Shield" in one line, life and mana regeneration.
// A meta gem and the skill it uses count once: the game's 13 / 6 / 6 Motes of a build with Ancestral Warrior Totem
// (a meta gem, Strength) and Mortar Cannon with the Cluster Grenade it uses (both Strength and Dexterity). note: the
// meta gem counted, not the skill in it; a build with a meta gem and its skills of other attributes would tell which.
// note: every Mote it can hold (a hit takes one away, they come back in seconds)
const ATTRS = ['strength', 'dexterity', 'intelligence'];
// same evaluation as the game's support type expressions (RPN): any true value left on the stack = match
function matches(expr, types) {
  const st = [];
  for (const t of expr) {
    if (t === 'OR') { const o = st.pop(); st[st.length - 1] = st.at(-1) || o; }
    else if (t === 'AND') { const o = st.pop(); st[st.length - 1] = st.at(-1) && o; }
    else if (t === 'NOT') st[st.length - 1] = !st.at(-1);
    else st.push(types.has(t));
  }
  return st.some(Boolean);
}
export const canSupport = (s, types) => !(s.exclude.length && matches(s.exclude, types)) && (!s.require.length || matches(s.require, types));
const isMeta = g => !!GEM[g?.name]?.tags?.includes('meta');
// the build's meta gems skill g can go in: those whose sockets take its types (gems.json `holds`: Mortar Cannon takes
// grenades; Ancestral Warrior Totem, attacks a totem can use)
export const metasFor = (b, g) => { const types = new Set(GEM[g?.name]?.types || []);
  return isMeta(g) || GEM[g?.name]?.kind === 'support' ? [] : (b.gems || []).filter(m => m !== g && GEM[m.name]?.holds && canSupport(GEM[m.name].holds, types)); };
// the meta gem that uses the build's i-th gem: the one it was put in (g.meta, as in the game: the skill sits in one of
// the meta gem's sockets). A build from before that field: the gem before it, with the same supports.
export const usedBy = (b, i) => { const g = b.gems?.[i]; if (!g) return null;
  if ('meta' in g) return g.meta && metasFor(b, g).find(m => m.name === g.meta) || null;
  const m = i > 0 && b.gems[i - 1];
  return m && String(m.supports || []) === String(g.supports || []) && metasFor(b, g).includes(m) ? m : null; };
// a gem used by hand: not a persistent skill (auras, heralds, persistent buffs and minions, Cast on X: on while their
// spirit is reserved) nor one placed in a meta gem (Mortar Cannon's grenade: the meta gem uses it)
export const byHand = (b, i) => { const g = b.gems?.[i]; return !!g && !(GEM[g.name]?.types || []).includes('Persistent') && !usedBy(b, i); };
// what a meta gem holds, as the game has it: its sockets hold the skills put in it and the supports, and those
// supports are the skills' (each skill in it keeps a copy, which the calculation reads). Run before every save.
export function linkMetas(b) {
  const inside = new Map();
  for (const [i, g] of (b.gems || []).entries()) {
    const m = usedBy(b, i);
    if (m) { g.meta = m.name; inside.set(m, [...inside.get(m) || [], g]); } else if (g.meta) g.meta = '';
  }
  for (const [m, list] of inside) {
    const n = Math.max(0, (m.sockets ?? 2) - list.length);
    m.supports = (m.supports || []).slice(0, n);
    for (const g of list) { g.sockets = n; g.supports = [...m.supports]; }
  }
}
// buffs a persistent skill's supports grant you while it is on (Precision, Clarity, Vitality, Herbalism: PoB2's
// GlobalEffect Buff mods), as the stats of yours they are
const GRANTS = { 'support_precision_accuracy_rating_+%': 'accuracy_rating_+%', 'support_clarity_mana_regeneration_rate_+%': 'mana_regeneration_rate_+%',
  'support_vitality_life_regeneration_rate_per_minute_%': 'life_regeneration_rate_per_minute_%', 'support_herbalism_life_recovery_+%_from_life_flasks': 'flask_life_to_recover_+%',
  // Thornskin, Warm Blooded, Cool Headed, Strong Hearted
  'support_thorns_spirit_cost_thorns_damage_+%': 'thorns_damage_+%', 'support_freeze_protection_spirit_cost_freeze_duration_on_self_+%_final': 'self_freeze_duration_+%_final',
  'support_ignite_protection_spirit_cost_ignite_duration_on_self_+%_final': 'self_ignite_duration_+%_final', 'support_shock_protection_spirit_cost_shock_duration_on_self_+%_final': 'self_shock_duration_+%_final' };
export function skillStats(b) {
  const out = motes(b);
  for (const g of b.gems || []) if (GEM[g.name]?.types?.includes('Persistent'))
    for (const n of g.supports || []) for (const [k, x] of Object.entries({ ...SK.skills[n]?.constant, ...Object.values(SK.skills[n]?.levels || {})[0] }))
      if (GRANTS[k]) out[GRANTS[k]] = (out[GRANTS[k]] || 0) + x;
  return out;
}
// what the build's Aura skills grant you (their gem's level), times "Aura Skills have increased Magnitudes" of the tree and
// gear: resistances, and Discipline's energy shield added to the total. note: the gem's supports and a skill an item
// grants are not counted
const AURA_GRANTS = { ...Object.fromEntries(['fire', 'cold', 'lightning', 'chaos'].map(e => [`base_skill_buff_${e}_damage_resistance_%_to_apply`, `base_${e}_damage_resistance_%`])),
  'base_skill_buff_total_maximum_energy_shield_+_to_apply': 'total_maximum_energy_shield_+' };
export function auraStats(b, sum) {
  const out = {}, k = 1 + v(sum, 'aura_effect_+%') / 100;
  for (const g of b.gems || []) if (GEM[g.name]?.types?.includes('Aura') && GEM[g.name].types.includes('Persistent'))
    for (const [id, x] of Object.entries(gemStats(g, sum))) if (AURA_GRANTS[id]) out[AURA_GRANTS[id]] = (out[AURA_GRANTS[id]] || 0) + x * k;
  return out;
}
function motes(b) {
  const c = (b.gems || []).map(g => SK.skills[g.name]?.constant).find(c => c?.['gem_barrier_red_grants_maximum_life_+%']);
  if (!c) return {};
  const motes = Object.fromEntries(ATTRS.map(a => [a, c.skill_specific_stat_description_mode || 0]));
  for (const [i, g] of b.gems.entries()) { if (usedBy(b, i)) continue; const req = ATTRS.filter(a => GEM[g.name]?.tags?.includes(a)); for (const a of req) motes[a] += req.length === 1 ? 2 : 1; }
  const per = (id, a) => (c[id] || 0) * motes[a];
  return { 'maximum_life_+%': per('gem_barrier_red_grants_maximum_life_+%', 'strength'),
    'global_armour_evasion_energy_shield_+%': per('gem_barrier_green_grants_evasion_rating_+%', 'dexterity'),
    'life_regeneration_rate_+%': per('gem_barrier_blue_grants_life_regeneration_rate_+%', 'intelligence'),
    'mana_regeneration_rate_+%': per('gem_barrier_blue_grants_mana_regeneration_rate_+%', 'intelligence') };
}

const load = f => fetch('poe2_data/available/' + f).then(r => r.json());
const [ASCS, GEMS] = await Promise.all([load('ascendancies.json'), load('gems.json')]);
const GEM = Object.fromEntries(GEMS.map(g => [g.name, g]));
// self-check: 3 Strength Motes of its own, 2 for Berserk, which requires Strength alone, and 1 for Mortar Cannon with the
// Cluster Grenade it uses, at 2% life each
console.assert(skillStats({ gems: [{ name: 'Virtuous Barrier' }, { name: 'Berserk' }, { name: 'Mortar Cannon' }, { name: 'Cluster Grenade' }] })['maximum_life_+%'] === 12 && skillStats({ gems: [{ name: 'Virtuous Barrier' }, { name: 'Ancestral Warrior Totem' }, { name: 'Orb of Storms' }] })['life_regeneration_rate_+%'] === 25 && !Object.keys(skillStats({ gems: [{ name: 'Berserk' }] })).length, 'Virtuous Barrier Motes');
const CHAR = SK.character_stats || {};
const v = (sum, ...ids) => ids.reduce((t, id) => t + (sum[id] || 0), 0);
const first = (...xs) => xs.find(x => x != null) ?? null;

// A gem as the character uses it: its level with what passives and gear add ("+2 to Level of all Skills with a
// Strength requirement" is strength_skill_gem_level_+: every word before _skill_gem_level_+ a tag of the gem) and what
// its quality gives (skills.json quality, and alt_quality for who has "Gem Quality grants Socketed Skills an
// additional effect": per 1000 quality, whole numbers only). _level and _quality are the ones used.
// note: the levels corrupted gems get are not counted
export function gemStats(g, sum = {}) {
  const d = SK.skills[g.name] || {}, tags = GEM[g.name]?.tags || d.tags || [], end = '_skill_gem_level_+';
  // (a support's "+1 to Level of Supported Fire Skills": supported_fire_skill_gem_level_+; supported_active_: any)
  const fits = w => w === 'all' || w === 'supported' || w === 'active' || tags.includes(w) || w === 'elemental' && ['fire', 'cold', 'lightning'].some(e => tags.includes(e));
  let level = g.level;
  for (const [k, x] of Object.entries(sum)) if (k.endsWith(end) && k.slice(0, -end.length).split('_').every(fits)) level += x;
  // Uhtred's: only with exactly no / one / two other supports modifying it
  level += v(sum, 'supported_active_skill_gem_level_+_if_' + ['no_other_supports', 'one_other_support', 'two_other_supports'][(g.supports || []).filter(Boolean).length - 1]);
  const quality = (g.quality || 0) + v(sum, 'all_skill_gem_quality_+', 'supported_active_skill_gem_quality_%');
  const st = { ...(d.constant || {}), ...(d.levels?.[level] || d.levels?.[g.level] || {}), _level: level, _quality: quality };
  for (const q of [d.quality, sum.ascendancy_gemling_enable_thaumaturgy_quality_stats && d.alt_quality])
    for (const [k, x] of Object.entries(q || {})) st[k] = (st[k] || 0) + Math.trunc(x * quality / 1000);
  const P = g.part && d.parts?.[g.part];   // a part of the gem (Earthshatter's spike): its own stats over the gem's
  // a part converting its damage itself: its conversion instead of the gem's (Elemental Sundering's fire and lightning
  // explosions, the gem's own the cold one)
  const conv = k => k.startsWith('active_skill_base_physical_damage_%_to_convert_to_');
  if (P && Object.keys(P.constant || {}).some(conv)) for (const k in st) if (conv(k)) delete st[k];
  if (P) Object.assign(st, P.constant, P.levels?.[level] || P.levels?.[g.level]);
  return st;
}
// Spirit a gem reserves: its amount over (100% + reservation efficiency), the gem's own (quality) plus what passives
// and gear give every skill or those of one of its tags (reservation_efficiency_+%_of_herald_skills).
// Blasphemy's: its amount per curse socketed in it (the build b's gems in it). note: rounded to the nearest, as Path of Building 2 does
export function reservation(g, sum = {}, b) {
  const st = gemStats(g, sum), id = 'base_spirit_reservation_efficiency_+%';
  const eff = (st[id] || 0) + v(sum, id, ...(GEM[g.name]?.tags || []).map(t => `reservation_efficiency_+%_of_${t}_skills`));
  const own = (st._spirit || 0) + (st.blasphemy_base_spirit_reservation_per_socketed_curse || 0) * (b?.gems || []).filter(x => x.meta === g.name).length;
  return Math.round(own * 100 / (100 + eff));
}
// self-check: Eternal Rage (100 spirit, 0.75% efficiency per quality as its second effect) with 6% quality and +2 levels
{ const g = { name: 'Eternal Rage', level: 15 }, sum = { 'all_skill_gem_quality_+': 6, ascendancy_gemling_enable_thaumaturgy_quality_stats: 1, 'strength_skill_gem_level_+': 2, 'spell_skill_gem_level_+': 3 };
  console.assert(reservation(g) === 100 && reservation(g, sum) === 96 && gemStats(g, sum)._level === 17 && reservation({ ...g, quality: 20 }) === 100, 'gem level and quality'); }

// monster of a given level (DefaultMonsterStats): the character panel rates armour / evasion against it
const MON = SK.monster_stats || [];
const monster = (lvl, ...cols) => { const r = MON.find(m => m.level === lvl) || MON[Math.min(lvl, MON.length) - 1]; return r && first(...cols.map(c => r[c])); };
// The panel's estimates are against a monster of level min(character, 82), likely the highest monster level; 82 is not in the data,
// fitted on game panels (Deadeye 91, Ritualist 92, Smith of Kitava 87: a monster of their own level misses by 2–8 points).
const estMonster = (lvl, ...cols) => monster(Math.min(lvl, 82), ...cols);
// "Estimated chance to Evade": chance to be hit = 1 − 0.95·evasion / (evasion + 4·accuracy), shown rounded (PoB2 monsterHitChance)
const evadeChance = (evasion, lvl) => { const a = estMonster(lvl, 'Accuracy', 'AccuracyRating'); return a ? 100 - Math.round(100 - 95 * evasion / (evasion + 4 * a)) : null; };
// "Estimated Physical Damage Reduction": armour reduces a hit by A / (A + 10·damage), max 90%, shown rounded
const armourReduction = (armour, lvl) => { const d = estMonster(lvl, 'Damage', 'PhysicalDamage', 'MonsterDamage'); return d ? Math.round(Math.min(90, 100 * armour / (armour + 10 * d))) : null; };
if (MON.length) console.assert(evadeChance(13176, 91) === 58 && evadeChance(182035, 92) === 91 && evadeChance(795, 87) === 8 && armourReduction(2441, 87) === 41, 'defence estimates vs the game panel');

// The totem a skill raises, as the game's details window shows it: a monster of the level its gem gives
// (MinionGemLevelScaling: 2 per gem level) with that level's ally life (times its variety's multiplier) and ailment
// threshold, the resistances and duration the gem sets, and its limit with the build's "+N Totems / Ballista Totems".
// Armour and evasion: that level's monster ones. note: the x4 armour of a totem whose monster type has Armour 100
// (MonsterTypes; the rest have 0) is no table's: it fits the game's two windows seen, a level 36 Mortar Cannon (1266 for
// 317 x 4 = 1268) and a level 16 Shockwave Totem (60, the table's). Against five game windows (levels 16-36) armour and
// evasion are off by up to 3 (1.5%) both ways with no rule found (the x4 ones are within 0.5 of the table before
// rounding: 1266 / 946 / 697 = 4 x 316.5 / 236.5 / 174.25); PoB2 has no base totem defences to compare: the table's shown
export function totem(g, sum = {}) {
  const T = SK.skills[g.name]?.totem; if (!T) return null;
  const s = withSupports(g, sum).sum, st = gemStats(g, s), level = SK.minion_level?.[st._level - 1];
  if (!level) return null;
  return {
    level,
    life: Math.round(Math.floor(monster(level, 'AllyLife') * T.life_mult) * (1 + (v(s, 'totem_life_+%') + (st['totem_life_+%'] || 0)) / 100) * (1 + v(s, 'support_totem_life_+%_final') / 100)),   // Tawhoa's Tending: more (PoB2 TotemLife MORE)
    ailment: monster(level, 'AilmentThreshold'),
    armour: monster(level, 'Armour') * (1 + 3 * (T.armour || 0) / 100), evasion: monster(level, 'Evasion'),
    elemental: st['totem_elemental_resistance_%'] || 0, chaos: st['totem_chaos_resistance_%'] || 0,
    duration: (st.base_totem_duration || 0) / 1000 * (1 + v(s, 'totem_duration_+%') / 100),
    limit: (st.base_number_of_totems_allowed || 0) + v(s, 'number_of_additional_totems_allowed')
      + (T.ballista ? v(s, 'additional_ballista_totems_allowed', 'attack_skills_additional_ballista_totems_allowed') : 0),
  };
}
// self-check: Mortar Cannon at gem level 18 is a level 36 totem with 2091 life and 1123 ailment threshold, as in the game
{ const m = totem({ name: 'Mortar Cannon', level: 18 }), ok = !SK.minion_level || m && m.level === 36 && m.life === 2091 && m.ailment === 1123 && m.elemental === 55 && m.chaos === 25 && m.armour === 1268
    && totem({ name: 'Shockwave Totem', level: 8 })?.armour === 60
    && totem({ name: 'Ancestral Warrior Totem', level: 15, quality: 6 }, { ascendancy_gemling_enable_thaumaturgy_quality_stats: 1 })?.life === 1807;
  console.assert(ok, 'Mortar Cannon totem', m); }

// an ascendancy, or the first of a base class that has none chosen: what they give (attributes, class_base) is the class's
const ascOf = name => ASCS.find(a => a.name === name) || ASCS.find(a => a.class === name) || {};
// attribute total: class base + flat stats from tree/gear, then % increased
export function attributes(sum, ascName) {
  const base = ascOf(ascName).attrs || { str: 0, dex: 0, int: 0 }, out = {};
  const ids = { str: 'strength', dex: 'dexterity', int: 'intelligence' };
  const pair = { str: ['strength_and_dexterity', 'strength_and_intelligence'], dex: ['strength_and_dexterity', 'dexterity_and_intelligence'], int: ['strength_and_intelligence', 'dexterity_and_intelligence'] };
  for (const [k, id] of Object.entries(ids)) {
    const flat = base[k] + v(sum, 'base_' + id, 'additional_' + id, 'additional_all_attributes', 'base_all_attributes', ...pair[k].flatMap(p => ['additional_' + p, 'base_' + p]));
    out[k] = Math.floor(flat * (1 + v(sum, id + '_+%', 'all_attributes_+%') / 100) * (1 + v(sum, 'gemling_all_attributes_+%_final') / 100));   // Gemling Legionnaire: more (less)
  }
  return out;
}

// What one attribute point gives, read from the game's own attribute text (ClientStrings <Attr>Description):
// "1 [Strength|Strength] = +2 Life", "1 [Dexterity|Dexterity] = +8 [Accuracy|Accuracy]" -> {life: 2}, {accuracy: 8}
function perAttr(attr) {
  const t = SK.attribute_text?.[attr] || '', out = {};
  for (const [k, re] of [['life', /\+(\d+) \[?Life/], ['mana', /\+(\d+) \[?Mana/], ['accuracy', /\+(\d+) \[?Accuracy/]]) {
    const m = t.match(re); if (m) out[k] = +m[1];
  }
  return out;
}

// "<type> damage (from hits / hit and dot) taken as <type>": { hit: { physical: { fire: 10 } }, dot: {...} }
function takenAs(sum) {
  const out = { hit: {}, dot: {} };
  for (const [k, x] of Object.entries(sum)) { const m = x && k.match(/^(physical|fire|cold|lightning|chaos)_(hit_and_dot_damage|damage_from_hits)_%_taken_as_(fire|cold|lightning|chaos)$/); if (!m) continue;
    for (const w of m[2] === 'damage_from_hits' ? ['hit'] : ['hit', 'dot']) { const o = (out[w][m[1]] ||= {}); o[m[3]] = (o[m[3]] || 0) + x; } }
  return out;
}
export function character(b, sum) {
  const A = ascOf(b.asc), cb = A.class_base || {}, lvl = b.level || 1, at = attributes(sum, b.asc);
  const fromAttr = k => ['Strength', 'Dexterity', 'Intelligence'].reduce((t, a, i) => t + (perAttr(a)[k] || 0) * at[['str', 'dex', 'int'][i]], 0) * (sum.gemling_double_basic_attribute_bonuses ? 2 : 1);   // Gemling: doubled
  // the class's own amount (Characters row: 16 life, 30 mana) plus character.ot's amount per level, the first included
  const base = (row, perLvl) => cb[row] == null || CHAR[perLvl] == null ? null : cb[row] + lvl * CHAR[perLvl];
  const lifeBase = base('BaseMaxLife', 'life_per_level'), manaBase = base('BaseMaxMana', 'mana_per_level');
  const pct = (...ids) => 1 + v(sum, ...ids) / 100;
  const res = {}, SN = supportsOf((b.gems || []).flatMap(g => g.supports || []));   // the red / green / blue supports socketed in your skills (Gemling)
  // the game lowers elemental resistances by the level of the area (ResistancePenaltyPerAreaLevel: none at first,
  // -60% from level 65 on): taken as the character's level
  const thornsX = pct('thorns_damage_+%');
  const penalty = SK.resistance_penalty?.[Math.min(lvl, SK.resistance_penalty.length) - 1] || 0;
  for (const [k, others] of Object.entries({ fire: ['cold', 'lightning', 'chaos'], cold: ['fire', 'lightning', 'chaos'], lightning: ['fire', 'cold', 'chaos'], chaos: ['fire', 'cold', 'lightning'] })) {
    const combos = others.flatMap(o => [`${k}_and_${o}_damage_resistance_%`, `${o}_and_${k}_damage_resistance_%`]);
    // Smith of Kitava: modifiers to fire resistance grant cold and lightning resistance at their share, and to maximum fire resistance too
    const fromFire = k === 'cold' || k === 'lightning' ? v(sum, 'base_fire_damage_resistance_%', ...['cold', 'lightning', 'chaos'].flatMap(o => [`fire_and_${o}_damage_resistance_%`, `${o}_and_fire_damage_resistance_%`])) : 0;
    let val = v(sum, `base_${k}_damage_resistance_%`, ...combos, ...(k === 'chaos' ? [] : ['base_resist_all_elements_%'])) + fromFire * v(sum, 'modifiers_to_fire_resistance_also_apply_to_cold_lightning_resistance_at_%_value') / 100
      + (k === 'chaos' || sum[`${k}_resist_unaffected_by_area_penalties`] ? 0 : penalty);
    if (k === 'chaos' && sum.chaos_damage_resistance_is_doubled) val *= 2;   // Acolyte of Chayula
    const perSup = sum[`maximum_${k}_resistance_+1_per_X_corresponding_support`];
    const max = CHAR['base_maximum_all_resistances_%'] + v(sum, `base_maximum_${k}_damage_resistance_%`, 'additional_maximum_all_resistances_%', ...(k === 'chaos' ? [] : ['additional_maximum_all_elemental_resistances_%']))
      + ((k === 'cold' || k === 'lightning') && sum.modifiers_to_maximum_fire_resistance_apply_to_maximum_cold_and_lightning_resistance ? v(sum, 'base_maximum_fire_damage_resistance_%') : 0)
      + (perSup ? Math.floor(SN[{ fire: 'str', cold: 'dex', lightning: 'int' }[k]] / perSup) : 0);   // Gemling: red / green / blue supports
    res[k] = { value: val, max, capped: Math.min(val, max) };
  }
  const defInc = 'global_armour_evasion_energy_shield_+%';
  const WH = pct('witchhunter_armour_evasion_+%_final'), EV = pct('master_of_elements_evasion_rating_+%_final');   // Witchhunter: less armour and evasion; Invoker: less evasion
  const armour = Math.round(v(sum, 'base_physical_damage_reduction_rating') * pct('physical_damage_reduction_rating_+%', 'evasion_and_physical_damage_reduction_rating_+%', defInc) * WH);
  const evasion = Math.round((v(sum, 'base_evasion_rating') + (CHAR.base_evasion_rating || 0)) * pct('evasion_rating_+%', 'evasion_and_physical_damage_reduction_rating_+%', defInc) * WH * EV);
  // armour against elements: the % of it that applies to each (passives, and the body armour's own grants)
  const ele = v(sum, 'armour_%_applies_to_fire_cold_lightning_damage', 'body_armour_grants_armour_%_applies_to_fire_cold_lightning_damage');
  const armourEl = { fire: v(sum, 'base_armour_%_applies_to_fire_damage') + ele, cold: v(sum, 'base_armour_%_applies_to_cold_damage') + ele,
    lightning: v(sum, 'base_armour_%_applies_to_lightning_damage', 'base_armour_applies_to_lightning_damage') + ele,
    chaos: v(sum, 'base_armour_%_applies_to_chaos_damage', 'body_armour_grants_base_armour_applies_to_chaos_damage') };
  // deflection: its % of armour and of evasion as deflection rating, its increases, and how much less a deflected hit deals
  const deflect = { arm: v(sum, 'base_deflection_rating_%_of_armour'), eva: v(sum, 'base_deflection_rating_%_of_evasion_rating'), inc: pct('deflection_rating_+%'),
    less: (CHAR['damage_%_deflected'] || 0) + v(sum, 'base_damage_%_deflected') };
  const esInc = pct('maximum_energy_shield_+%', defInc, 'maximum_life_mana_and_energy_shield_+%');
  const c = {
    level: lvl, attrs: at, armourEl, deflect,
    life: lifeBase == null ? null : Math.round((lifeBase + v(sum, 'base_maximum_life') + fromAttr('life')) * pct('maximum_life_+%', 'maximum_life_mana_and_energy_shield_+%') * pct('titan_maximum_life_+%_final') * pct('oracle_maximum_life_+%_final')),   // Titan: more; Oracle: less
    mana: manaBase == null ? null : Math.round((manaBase + v(sum, 'base_maximum_mana') + fromAttr('mana')) * pct('maximum_mana_+%', 'maximum_life_mana_and_energy_shield_+%') * pct('oracle_maximum_mana_+%_final')),
    // what gear gives ("+30 to Spirit", a sceptre's own) is its own stat: one passive turns it off
    spirit: Math.round((first(cb.BaseSpirit, CHAR.base_spirit, 0) + v(sum, 'base_spirit') + (sum.cannot_gain_spirit_from_equipment ? 0 : v(sum, 'base_spirit_from_equipment'))) * pct('spirit_+%')),
    // spirit reserved by the build's persistent skills
    reserved: (b.gems || []).reduce((t, g) => t + reservation(g, sum, b), 0),
    es: Math.round(v(sum, 'base_maximum_energy_shield') * esInc + v(sum, 'total_maximum_energy_shield_+')),
    armour, evasion, armourPct: armourReduction(armour, lvl), evadePct: evadeChance(evasion, lvl),
    // the increases they have, and the tree's increased armour / evasion while you are in a state (the scene checks it)
    armourInc: pct('physical_damage_reduction_rating_+%', 'evasion_and_physical_damage_reduction_rating_+%', defInc), evasionInc: pct('evasion_rating_+%', 'evasion_and_physical_damage_reduction_rating_+%', defInc), esInc,
    defWhile: DEF_WHILE.filter(([k]) => sum[k]).map(([k, to, cv]) => ({ to, cv, val: sum[k] })),
    speedWhile: SPEED_WHILE.filter(([k]) => sum[k]).map(([k, to, cv]) => ({ to, cv, val: sum[k] })),
    moveWhile: MOVE_WHILE.filter(([k, cv]) => sum[k] && (cv || weaponStats({ weapon: b.items?.offhand }))).map(([k, cv]) => ({ cv, val: sum[k] })),
    block: v(sum, 'additional_block_%', 'block_%') + (/^(Shields|Bucklers)$/.test(classOf(b.items?.offhand)) ? v(sum, 'block_chance_from_equipped_shield_is_%') : 0),   // Renly's Training: the shield's base chance (note: a shield's own is not in the data)
    takenAs: takenAs(sum),
    // Tactician's Stay Light, Use Cover: armour defends at 200%, evade and physical reduction capped at 50%; Pathfinder's
    // share of evasion that also grants elemental damage reduction (as armour does)
    armourX: sum.double_armour_effect ? 2 : 1, evadeMax: sum['maximum_chance_to_evade_is_50%'] ? 50 : null, physMax: sum['maximum_physical_damage_reduction_is_50%'] ? 50 : null,
    evaPhys: !!sum.evasion_rating_also_reduces_physical_damage,   // Invoker: armour and evasion together against physical
    esArm: v(sum, 'current_energy_shield_%_as_physical_damage_reduction'),   // Disciple of Varashta: its share of your current energy shield added to armour against physical
    evaEl: v(sum, 'elemental_damage_reduction_%_from_evasion_rating'),
    // the cap (character.ot's, raised by "maximum Block chance", or Turtle Charm's own) and the share of a blocked hit you still take
    blockMax: sum.maximum_block_chance_override || (CHAR['object_inherent_base_maximum_block_%_from_ot'] || 0) + v(sum, 'additional_maximum_block_%'), blockTaken: v(sum, 'base_block_%_damage_taken'),
    charges: Object.fromEntries(['frenzy', 'power', 'endurance'].map(c => [c, (CHAR[`max_${c}_charges`] || 0) + v(sum, `max_${c}_charges`)])),
    // how long each lasts (times the base) and the chance to gain one more when you gain one
    chargeTime: Object.fromEntries(['frenzy', 'power', 'endurance'].map(c => [c, 1 + v(sum, 'charge_duration_+%', `${c}_charge_duration_+%`, `base_${c}_charge_duration_+%`) / 100])),
    delayHit: { less: v(sum, 'chronomancer_damage_taken_+%_final'), later: v(sum, 'chronomancer_take_%_of_hit_damage_4_seconds_after_being_hit') },   // Chronomancer
    chargeMore: Object.fromEntries(['frenzy', 'power', 'endurance'].map(c => [c, v(sum, `chance_to_gain_1_more_${c}_charge_%`)])),
    res, penalty,
    // the armour's movement penalty is apart from the increases (the game's panel, 17/11: 25% boots, -4% body armour: +20.0%)
    move: (1 + (v(sum, 'base_movement_velocity_+%') - armourItems(b.items).movement) / 100) * (1 + armourItems(b.items).movement / 100) * 100 - 100,
    attackSpeed: v(sum, 'attack_speed_+%', 'attack_and_cast_speed_+%'),
    castSpeed: v(sum, 'base_cast_speed_+%', 'attack_and_cast_speed_+%'),
    critInc: v(sum, 'critical_strike_chance_+%'),
    critBonus: 100 + v(sum, 'base_critical_strike_multiplier_+'),  // documented game rule: every character has +100% base critical damage bonus
    // character.ot: accuracy per level above the first
    accuracy: Math.round(((CHAR.accuracy_rating_per_level || 0) * (lvl - 1) + v(sum, 'accuracy_rating') + (weaponStats(b.items)?.accuracy || 0) + fromAttr('accuracy') + (sum.gain_accuracy_rating_equal_to_intelligence ? at.int : 0)) * pct('accuracy_rating_+%')), accuracyInc: pct('accuracy_rating_+%'), lances: v(sum, 'spear_skills_inflict_bloodstone_lance_on_hit'),
    // the most accuracy your attacks lose with distance (KeywordPopups Accuracy: up to 90% less), unless something says they do not
    accuracyFalloff: v(sum, 'accuracy_is_unaffected_by_distance', 'deadeye_accuracy_unaffected_by_range', 'main_hand_accuracy_is_unaffected_by_distance',
      'base_main_hand_accuracy_is_unaffected_by_distance', 'local_weapon_accuracy_is_unaffected_by_distance') ? 0 : 90 * pct('accuracy_range_penalty_+%'),
    missingBase: lifeBase == null,
    // thorns (keywords.json: a Hit of yours, not an attack nor a spell, dealt back to an enemy whose melee attack hits you):
    // its base with its increases (thornsX, for thorns a buff adds), its crit, the build's ailments on hits
    // runic ward: flat ward, and the share of maximum life some modifiers grant as ward, scaled by increased ward
    // Plants Overgrow: a chance as each is created (passives), a chance as it enters your Presence (items), that Presence's
    // radius in metres (character.ot, its area scaled like calc's sheet)
    arcaneSurge: { crit: v(sum, 'gain_arcane_surge_on_crit_%_chance'), effect: pct('arcane_surge_effect_on_self_+%'), always: !!sum.base_should_have_arcane_surge_from_stat, missing: v(sum, 'arcane_surge_effect_on_self_+%_per_10%_missing_mana') },   // its chance on a critical hit, its effect on you; Stormweaver's: always, more effect per 10% missing mana
    overgrow: { now: v(sum, 'chance_for_plants_to_be_overgrown_%'), near: v(sum, 'chance_%_for_plants_to_overgrow_when_entering_your_presence'),
      r: CHAR.base_presence_radius * Math.sqrt(pct('presence_area_+%')) / 10, archon: v(sum, 'chance_%_to_gain_archon_of_nature_on_overgrowing_plant'),
      // an Archon's time, then its recovery before another (SK.archon_time: the game's Archon keyword); its increased
      // duration, its recovery's faster expiry
      archonTime: SK.archon_time[0] * pct('archon_duration_+%'), archonDelay: SK.archon_time[1] / pct('archon_delay_expires_x%_faster'), archonEffect: pct('archon_effect_on_you_+%') },
    // Elemental Infusions (keywords.json): the most of each kind (Verisium's: the most of any one), their duration,
    // the chances of one more on collecting, of not removing it when consumed, and what consuming one grants
    heat: { delay: CHAR.heat_base_delay_before_decay_ms / 1000, rate: CHAR.heat_base_decay_rate_ms / 1000 },   // crossbow Heat: held a while, then lost one at a time
    infusion: { max: Object.fromEntries(['fire', 'cold', 'lightning'].map(e => [e, (CHAR.base_maximum_infusions || 0) + v(sum, `maximum_${e}_infusion_stacks`, 'additional_maximum_infusion_stacks')])),
      time: pct('infusion_duration_+%'), more: v(sum, 'additional_infusion_gain_chance_%') + v(sum, 'chance_%_for_extra_infusion_on_infused_remnant_pickup'),
      keep: v(sum, 'chance_to_not_consume_infusion_%'), power: v(sum, 'gain_a_power_charge_when_you_consume_an_elemental_infusion') > 0 },
    // Surges (keywords.json Surge): those consuming a charge gives (the Amazon's Elemental Surge, Chaotic Surge's unique)
    // and those reloading gives (Gemini Surge's unique, alternately cold and fire)
    surge: { charge: Object.fromEntries(['fire', 'cold', 'lightning', 'chaos'].map(e => [e, v(sum, `gain_X_instilling_${e}_when_charge_is_consumed`, `gain_X_instilling_${e}_when_any_charge_is_consumed`)])),
      reload: { fire: v(sum, 'gain_X_instilling_fire_on_reload'), cold: v(sum, 'gain_X_instilling_cold_on_reload') } },
    expression: v(sum, 'trigger_wild_strike_on_attack_crit') > 0,   // the Invoker's Elemental Expression on melee critical hits
    grin: v(sum, 'infernalist_burn_life_and_es_%_per_second_if_crit_recently'),   // Infernalist's Grinning Immolation: ignited after your critical hits
    wounds: v(sum, 'lose_%_of_life_loss_over_4_seconds_instead'),   // Blood Mage's Grasping Wounds: that share of life lost from hits is lost over 4 seconds instead
    esLowMore: v(sum, 'djinn_ascendancy_energy_shield_recharge_rate_+%_final_on_low_energy_shield'),   // The Fourth Teaching: more recharge rate on low energy shield
    pinStop: v(sum, 'pin_stops_enemies') > 0,   // Tactician's Right Where We Want Them: Pinned enemies cannot perform actions
    totemWall: v(sum, 'damage_removed_from_your_nearest_totem_before_life_or_es_%'),   // Warbringer's Wooden Wall
    implode: !!sum.fully_broken_armour_and_sundered_armour_you_inflict_applies_to_all_damage,   // Warbringer's Imploding Impacts: Fully Broken Armour increases all hit damage taken
    bellow: { free: !!sum.warcries_bypass_cooldown, corpse: v(sum, 'corpses_in_your_area_of_effect_explode_dealing_%_maximum_life_physical_damage_on_warcry') },   // Warbringer's Warcaller's Bellow
    chargeGen: [v(sum, 'generate_x_charges_for_life_flasks_per_minute'), v(sum, 'generate_x_charges_for_mana_flasks_per_minute'), v(sum, 'generate_x_charges_for_charms_per_minute')],   // life / mana flask and charm charges a minute
    watch: v(sum, 'totems_nearby_enemies_damage_taken_+%'),   // Watchtowers: each totem's increased damage taken for the enemies in its Presence
    blast: { cursed: v(sum, 'explode_cursed_enemies_for_25%_life_as_chaos_on_kill_chance_%'), any: v(sum, 'witchhunter_chance_to_explode_enemies_for_100%_of_life_as_physical') },   // Lich's Rupture the Soul (a quarter of their life as chaos), Witchhunter's Zealous Inquisition (all of it as physical)
    // Shaman's Reactive Growth / Avatar of Evolution: Adaptations to the highest elemental type of each hit you take (KeywordPopups Adaptation: 3 at a time, no duration unless one is given)
    adapt: sum.gain_X_adaptation_matching_type_when_hit_by_elemental_damage ? { gain: sum.gain_X_adaptation_matching_type_when_hit_by_elemental_damage, max: v(sum, 'base_max_adaptations') || 3,
      per: v(sum, 'ascendancy_druid_shaman_elemental_damage_taken_+%_final_per_matching_adaptation') * (sum.double_adaptation_effect ? 2 : 1), less: v(sum, 'ascendancy_shaman_reactive_growth_elemental_damage_taken_+%_final'), dur: v(sum, 'adaptation_duration_ms') / 1000 || Infinity } : null,
    presExpo: !!sum.enemies_in_presence_have_exposure,   // Shaman's Turning of the Seasons
    // Blood Mage's Sanguine Tides: life flask charges per 2% of life spent (its text), a hit while the life flask is full consuming its share of the charges
    // for its share of damage gained as physical per charge, for its duration; flasks recover no life
    tides: sum.blood_mage_life_flask_buff_duration_ms ? { gain: v(sum, 'gain_X_life_flask_charges_per_4%_life_spent'), use: v(sum, 'blood_mage_life_flask_buff_%_charges_to_consume'),
      per: v(sum, 'blood_mage_life_flask_buff_%_damage_to_gain_as_physical_per_charge_consumed'), dur: sum.blood_mage_life_flask_buff_duration_ms / 1000, dry: !!sum.base_life_flasks_do_not_recover_life } : null,
    shot: [v(sum, 'deadeye_projectile_damage_+%_final_max_as_distance_travelled_decreases'), v(sum, 'deadeye_projectile_damage_+%_final_max_as_distance_travelled_increases')],   // Deadeye's Point Blank / Far Shot: projectile hits' more damage by how far they have travelled
    sands: !!sum['chronomancer_grant_cast_speed_+%'],   // Chronomancer's Quicksand Hourglass: Sands of Time
    frenzyX: v(sum, 'chance_%_to_double_effect_of_removing_frenzy_charges'),   // Deadeye's Thrilling Chase: chance to double what consuming a frenzy charge gives
    cover: !!sum.enemy_hits_against_you_have_distance_based_accuracy_falloff,   // Tactician's Stay Light, Use Cover: enemies' accuracy falls off with distance, as yours
    whisper: v(sum, 'ascendancy_whispers_of_the_flesh_cursed_enemies_have_at_least_life_reserved_%'),   // Blood Mage's Whispers of the Flesh: that share of a Cursed enemy's life reserved
    // Infernalist's Seething Body: Elemental Archon on casting a spell on High Infernal Flame, kept while on it, lost on reaching the most (SK.archon_time: the Archon keyword's time and recovery)
    earch: sum.gain_elemental_archon_when_you_cast_a_spell_while_on_high_infernal_flame ? { time: SK.archon_time[0] * pct('archon_duration_+%'), delay: sum.archon_no_recovery_period ? 0 : SK.archon_time[1] / pct('archon_delay_expires_x%_faster'),
      keep: !!sum.elemental_archon_does_not_expire_while_on_high_infernal_flame, full: !!sum.lose_elemental_archone_on_reaching_full_infernal_flame } : null,
    elixir: !!sum.life_flask_effects_are_not_removed_at_full_life,   // Pathfinder's Enduring Elixirs
    tailwind: sum.gain_tailwind_stack_on_skill_use ? { lose: !!sum.lose_all_tailwind_when_hit } : null,   // Deadeye's Gathering Winds: a Tailwind stack on each skill use
    // the Amazon's Predatory Instinct: Revealed Weaknesses, its more damage against an enemy with an Open Weakness; In for the Kill: movement and skill speed against them
    weakness: sum.bloodlust_reveal_weakness ? { more: v(sum, 'damage_+%_final_against_bloodlusting_enemies'), move: v(sum, 'movement_speed_+%_against_bloodlusting_enemies'), speed: v(sum, 'skill_speed_+%_against_bloodlusting_enemies') } : null,
    charmMana: v(sum, 'drain_%_max_mana_to_activate_expended_charms'),   // Ritualist's Mind Phylacteries: that share of maximum mana for a charm without the charges
    // the tree: Thirst for Power / Endurance's chance of one more charge; Harness the Elements' increased damage per elemental ailment
    // on the enemy; Deep Freeze's cold resistance of the Frozen; Urgent Call's life and mana on a warcry; Ancestral Alacrity's attack
    // and cast speed after summoning a totem; First Sting's poison magnitude on the not yet Poisoned
    more1: { power: v(sum, 'chance_to_gain_1_more_power_charge_%'), endurance: v(sum, 'chance_to_gain_1_more_endurance_charge_%') }, perAil: v(sum, 'damage_+%_per_enemy_elemental_ailment'),
    frozenRes: v(sum, 'freeze_applies_cold_resistance_+'), cryHeal: v(sum, 'restore_life_and_mana_on_warcry_%'), totemSpeed: v(sum, 'attack_and_cast_speed_+%_on_placing_totem'), firstPoison: v(sum, 'poison_effect_+%_vs_non_poisoned_enemies'),
    brew: !!sum.life_mana_flasks_restore_mana_life,   // Amazon's Azmeri Brew: life flasks also recover mana, mana flasks life
    storm: v(sum, 'trigger_elemental_storm_on_crit') > 0,   // the Stormweaver's Elemental Storm on spell critical hits
    get ward() { return (v(sum, 'base_maximum_ward') + (this.life || 0) * v(sum, 'maximum_life_%_to_gain_as_total_ward') / 100) * pct('maximum_ward_+%'); },
    thorns: { hits: { physical: [v(sum, 'thorns_minimum_base_physical_damage'), v(sum, 'thorns_maximum_base_physical_damage')].map(x => Math.round(x * thornsX)) },
      crit: v(sum, 'base_thorns_critical_strike_chance'), critBonus: 100 + v(sum, 'base_critical_strike_multiplier_+'), ail: ailments({}, sum, {}, []), thornsX },
  };
  // Blood Mage: more life, the body armour's own energy shield; Infernalist: mana, energy shield and Spirit per so much of
  // your maximum life; Invoker: Spirit per evasion and energy shield on the body armour. note: added to the totals, after
  // their increases (the game's order is not in the data)
  const per = (k, n) => n ? Math.floor(k / n) : 0;
  if (c.life != null) c.life += Math.round(pieceDef(b.items, 'body', 'energy_shield') * v(sum, 'gain_%_life_from_body_es') / 100);
  if (c.life != null) { if (c.mana != null) c.mana += per(c.life, sum['ascendancy_beidats_gaze_mana_+_per_X_maximum_life']); c.es += per(c.life, sum['ascendancy_beidats_hand_energy_shield_+_per_X_maximum_life']); c.spirit += per(c.life, sum['ascendancy_beidats_will_spirit_+_per_X_maximum_life']); }
  // Fleshcrafting, Enhanced Barrier: that share of maximum life converted to maximum energy shield
  const LC = c.life != null && Math.min(100, v(sum, 'maximum_life_%_to_convert_to_maximum_energy_shield')); if (LC) { const k = Math.round(c.life * LC / 100); c.life -= k; c.es += k; }
  // the critical damage bonus of hits against you, as a share: the Oracle's and the Smith's less; Gemling's Gem Studded none
  // while red supports are the most socketed in your skills
  c.selfCrit = sum.no_self_critical_strike_multiplier_if_red_support_count_highest && SN.str && SN.str >= SN.dex && SN.str >= SN.int ? 0 : Math.max(0, 1 - v(sum, 'base_self_critical_strike_multiplier_-%', 'body_armour_grants_x_base_self_critical_strike_multiplier_-%') / 100);
  // Shaman's Sacred Flow: Spirit per charm slot (the belt's, the Ritualist's more) with no charm in it
  c.emptyCharms = Math.max(0, Math.min(3, v(sum, 'local_charm_slots', 'local_additional_charm_slots', 'num_charm_slots')) - ['charm1', 'charm2', 'charm3'].filter(k => b.items?.[k]).length);
  c.spirit += v(sum, 'spirit_+_per_empty_charm_slot') * c.emptyCharms;
  c.spirit += per(pieceDef(b.items, 'body', 'evasion'), sum['+1_spirit_per_X_evasion_rating_on_body_armour']) + per(pieceDef(b.items, 'body', 'energy_shield'), sum['+1_spirit_per_X_energy_shield_on_body_armour']);
  // Acolyte of Chayula's Embrace the Darkness: no Spirit; maximum Darkness, its base and per level, with its increases (per 1% chaos
  // resistance too); damage taken is reserved from it before life or energy shield, each reservation lasting its time
  if (sum.base_darkness) { c.spirit = 0; c.darkness = Math.round((sum.base_darkness + v(sum, 'darkness_per_level') * lvl) * (pct('maximum_darkness_+%') + v(sum, 'maximum_darkness_+%_per_capped_chaos_damage_resistance') * Math.max(0, c.res.chaos.capped) / 100)); c.darkFor = v(sum, 'base_darkness_refresh_rate_ms') / 1000; }
  return c;
}

// Life regeneration and energy shield recharge per second of a character() result: shared by the sheet below and by
// the 3D scene, where the enemies hit the character.
export function recovery(c, sum) {
  const pct = (...ids) => 1 + v(sum, ...ids) / 100;
  // mana: inherent 4%/s unless a keystone removes it, plus "mana equal to X% of life"
  const manaBase = sum.no_inherent_mana_regeneration ? 0 : CHAR['character_inherent_mana_regeneration_rate_per_minute_%'] / 100 / 60;   // 240/min = 4%/s
  const manaLife = v(sum, 'regenerate_mana_equal_to_x%_of_life_per_minute');
  // life: flat regen + % of max life per minute, scaled by regeneration / recovery rate
  const lifePctRegen = v(sum, 'life_regeneration_rate_per_minute_%');
  const esRate = CHAR['energy_shield_recharge_rate_per_minute_%'] / 100 / 60;   // 750/min = 12.5%/s
  const umag = 1 + Math.floor((c.mana || 0) / 100) * v(sum, 'unholy_might_granted_magnitude_+%_per_100_maximum_mana') / 100;   // Lich: the Unholy Might you have and grant
  const lifeInc = pct('life_regeneration_rate_+%', 'life_recovery_rate_+%'), manaInc = pct('mana_regeneration_rate_+%', 'mana_recovery_rate_+%');
  return {
    lifeRegen: lifePctRegen && c.life == null ? null
      : (v(sum, 'base_life_regeneration_rate_per_minute') + (c.life || 0) * lifePctRegen / 100) / 60 * lifeInc,
    esRate, esDelay: Math.max(0, CHAR.energy_shield_delay_ms - v(sum, 'energy_shield_recharge_starts_X_ms_sooner')) / 1000 / (1 + v(sum, 'energy_shield_delay_-%') / 100),   // Disciple of Varashta: sooner
    esRecharge: c.es * esRate * pct('energy_shield_recharge_rate_+%'),
    manaRegen: c.mana == null || manaLife && c.life == null ? null
      : (c.mana * manaBase + (c.life || 0) * manaLife / 100 / 60) * manaInc,
    // their increases, and the tree's regeneration while you are in a state (the scene checks it)
    lifeInc, manaInc,
    recPerMissing: v(sum, 'life_recovery_rate_+%_per_5%_missing_life'),
    critFromHit: v(sum, 'gain_additional_crit_chance_from_%_chance_to_hit_over_100'),
    blindEffect: v(sum, 'blind_effect_+%'),
    // Martial Artist's Mountain's Teachings (Way of the Mountain)
    mountain: sum.stone_skin_maximum_stacks ? { chance: v(sum, 'chance_%_to_gain_one_stone_skin_stack_on_immobilising'), max: sum.stone_skin_maximum_stacks, dur: v(sum, 'stone_skin_duration_ms') / 1000,
      attack: v(sum, 'stone_skin_grants_attack_damage_+%_final_you_use_yourself'), taken: v(sum, 'stone_skin_grants_damage_taken_+%_final'), stun: v(sum, 'stone_skin_grants_stun_threshold_+%_final'), upTo: v(sum, 'stone_skin_grants_damage_reduction_life_threshold_%') || 100 } : null,
    // Witchhunter's Witchbane: enemies' Focus (a share of their maximum life) your hits drain, coming back after its delay; No Mercy
    focus: sum['%_maximum_life_as_focus'] ? { life: sum['%_maximum_life_as_focus'], drain: v(sum, 'drain_focus_%_of_damage_dealt_on_hit'), decay: v(sum, 'focus_decay_%_per_minute'), delay: v(sum, 'focus_decay_delay_ms') / 1000,
      mercy: v(sum, 'witchhunter_up_to_damage_+%_final_against_targets_with_missing_focus') } : null,
    // Infernalist's Pyromantic Pact: Infernal Flame instead of mana
    flame: sum['infernal_flame_instead_of_mana_at_%_ratio'] ? { ratio: sum['infernal_flame_instead_of_mana_at_%_ratio'], decay: v(sum, 'lose_%_of_max_infernal_flame_per_minute'), hit: v(sum, 'hit_for_%_max_life_es_on_max_infernal_flame'), lose: v(sum, 'lose_%_of_infernal_flame_on_reaching_max') } : null,
    // Lich: Unholy Might's magnitude (per 100 maximum mana), its spells' Sacrifice and Power Charge, Eternal Life, mana lost a second
    unholy: sum.grant_unholy_might_to_self_while_not_on_low_mana ? umag : 0,
    allyUnholy: sum.allies_in_presence_have_unholy_might_while_you_not_on_low_mana ? umag : 0,   // Necromantic Conduit: your allies in your Presence too
    lich: { sac: v(sum, 'spells_sacrifice_%_of_your_energy_shield'), sacMore: v(sum, 'ascendancy_lich_spell_damage_+%_final_when_sacrificing_energy_shield'), power: v(sum, 'ascendancy_lich_spells_consume_power_charges_for_spell_damage_+%_final'), keep: !!sum.sacrificing_energy_shield_does_not_interrupt_recharge },
    eternal: !!sum.your_life_cannot_change_while_you_have_energy_shield, manaDegen: v(sum, 'mana_degeneration_%_per_minute_not_in_grace'), buffTime: v(sum, 'buff_time_passed_+%_only_buff_category'),
    volatility: v(sum, 'gain_X_volatility_on_inflicting_elemental_ailment'), volOnKill: v(sum, 'volatility_on_kill_%_chance'), volImmune: !!sum.immune_to_volatility_damage,   // Acolyte of Chayula
    unluckyDmg: !!sum.damage_taken_from_hits_is_unlucky, unluckyCrit: !!sum.critical_chance_vs_self_is_unlucky,   // Oracle
    manaFirst: !!sum.hit_damage_remove_from_mana_before_life_while_mana_higher_than_life,
    curseLimit: 1 + v(sum, 'number_of_additional_curses_allowed'), curseForever: !!sum.curses_never_expire,   // Lich
    parryMag: v(sum, 'parried_magnitude_+%'), debuffTime: v(sum, 'debuff_time_passed_+%'),   // the Parried debuff's magnitude you inflict; how fast debuffs on you expire
    regenWhile: REGEN_WHILE.filter(([k]) => sum[k]).map(([k, to, cv]) => ({ to, cv, val: sum[k] })),
    // what a kill recovers: flat life, a share of your maximum mana, of your life when it was Poisoned, the chance for all your life
    killRecover: { life: v(sum, 'base_life_gained_on_enemy_death'), lifePct: v(sum, 'recover_%_maximum_life_on_kill'), mana: v(sum, 'recover_%_maximum_mana_on_kill'), poisoned: v(sum, 'recover_%_maximum_life_on_killing_poisoned_enemy'),
      full: v(sum, 'recover_maximum_life_on_enemy_killed_chance_%') },
    // what an event recovers: consuming a power charge (% of maximum mana) or an endurance charge (% of life), a block
    // (flat life), using your mana flask (% of life) or a charm (% of mana), heavily stunning a rare or unique enemy (% of
    // life), being stunned (% of life over a second)
    recoverOn: { power: v(sum, 'recover_x%_of_maximum_mana_when_you_consume_a_power_charge'), endurance: v(sum, 'recover_%_life_per_endurance_charge_consumed'),
      block: v(sum, 'recover_X_life_on_block'), manaFlask: v(sum, 'recover_%_maximum_life_on_mana_flask_use'), charm: v(sum, 'recover_%_maximum_mana_on_charm_use'),
      stunRare: v(sum, 'recover_%_life_on_heavy_stunning_rare_or_unique_enemy'), stunned: v(sum, 'regenerate_%_life_over_1_second_when_stunned') },
    // Recoup (keywords.json): shares of the damage a hit dealt you recovered over 8 seconds, faster with recoup speed
    recoup: { phys: v(sum, 'physical_damage_taken_recouped_as_life_%'), el: v(sum, 'elemental_damage_taken_%_recouped_as_life'), deflect: v(sum, 'deflected_hit_damage_taken_%_recouped_as_life'),
      all: v(sum, 'damage_taken_goes_to_life_over_4_seconds_%'), prevented: v(sum, 'physical_damage_prevented_recouped_as_life_%'), channel: v(sum, 'x%_of_damage_taken_while_channelling_recouped_as_life'),
      es: v(sum, 'recoup_%_elemental_damage_as_energy_shield'), mana: v(sum, 'damage_taken_goes_to_mana_%'), totem: v(sum, 'recoup_%_of_damage_taken_by_your_totems_as_life'), time: 8 / pct('recoup_speed_+%') },
  };
}
// What ailments do to you: your ailment threshold (half your life, PlayerAilmentThresholdLifeFactor, plus what adds to it)
// and stun threshold, the freeze threshold a monster's cold hits fill, the chance to avoid each one (immunity: 100), how
// long it lasts on you (the reduced durations, as the panel's) and how strong (increased effect on you).
// note: the freeze threshold is taken as the stun threshold plus "freeze threshold" modifiers: the tables give none of its own
const ELEM_AIL = ['ignite', 'chill', 'shock', 'freeze'];
export function ailmentDefence(c, sum) {
  const at = c.attrs || {}, pct = (...ids) => 1 + v(sum, ...ids) / 100;
  const stun = c.life == null ? null : (c.life + v(sum, 'stun_threshold_+') + (at.str || 0) * v(sum, 'stun_threshold_+_per_strength') + (at.dex || 0) * v(sum, 'stun_threshold_+_per_dexterity')
    + c.es * v(sum, 'stun_threshold_+_from_%_maximum_energy_shield') / 100) * pct('stun_threshold_+%');
  const ail = c.life == null ? null : (c.life * CHAR['ailment_threshold_life_%'] / 100 + (at.dex || 0) * v(sum, 'ailment_threshold_+_per_dexterity') + c.es * v(sum, 'ailment_threshold_+_from_%_maximum_energy_shield') / 100
    + c.evasion * v(sum, 'evasion_rating_%_to_gain_as_ailment_threshold') / 100) * pct('ailment_threshold_+%');
  const freeze = stun == null ? null : (stun + v(sum, 'freeze_threshold_+') + c.es * v(sum, 'freeze_threshold_+_from_maximum_energy_shield') / 100) * pct('freeze_threshold_+%');
  // electrocute builds up against the elemental ailment threshold (KeywordPopups AilmentThreshold)
  const electrocute = ail == null ? null : (ail + v(sum, 'electrocute_threshold_+')) * pct('electrocute_threshold_+%') * pct('electrocute_threshold_+%_final');
  const allAil = v(sum, 'base_all_ailment_duration_on_self_+%'), eleAil = v(sum, 'self_elemental_status_duration_-%');
  const IMMUNE = { ignite: ['immune_to_ignite', 'base_immune_to_ignite'], chill: ['immune_to_chill', 'base_immune_to_chill'], shock: ['immune_to_shock', 'base_immune_to_shock'],
    freeze: ['immune_to_freeze', 'base_immune_to_freeze'], bleed: ['immune_to_bleeding'], poison: ['immune_to_poison', 'cannot_be_poisoned'], stun: ['base_cannot_be_stunned'], electrocute: ['base_cannot_be_electrocuted', 'cannot_be_electrocuted'] };
  const avoid = {}, dur = {};
  for (const [a, ids] of Object.entries(IMMUNE)) {
    const el = ELEM_AIL.includes(a);
    avoid[a] = ids.some(k => sum[k]) ? 100 : Math.min(100, v(sum, `base_avoid_${a}_%`, `avoid_${a}_%`) + (el ? v(sum, 'avoid_all_elemental_status_%') : 0));
    dur[a] = (el ? Math.max(0, 1 - (v(sum, `base_self_${a}_duration_-%`) + eleAil - allAil) / 100)
      : Math.max(0, 1 + (v(sum, `self_${a}_duration_+%`) + allAil) / 100)) * (1 + v(sum, `self_${a}_duration_+%_final`) / 100);
  }
  dur.stun = pct('stun_duration_on_self_+%') / pct('base_stun_recovery_+%');   // as Path of Building 2: longer stuns, divided by stun recovery
  dur.electrocute = Math.max(0, 1 - v(sum, 'base_self_electrocute_duration_-%', 'self_electrocute_duration_-%') / 100) * pct('combined_electrocute_duration_on_self_+%_final');
  const eff = { chill: pct('chilled_effect_on_self_+%', 'chill_effectiveness_on_self_+%', 'shocked_chilled_effect_on_self_+%'), shock: pct('shocked_effect_on_self_+%', 'shocked_chilled_effect_on_self_+%'), ignite: pct('ignite_effect_on_self_+%'), electrocute: pct('hit_damage_electrocute_multiplier_+%_on_self'), slow: sum.slows_have_no_potency_on_you ? 0 : pct('base_slow_potency_+%') };   // Pathfinder: unaffected by slows
  return { stun, ail, freeze, electrocute, avoid, dur, eff };
}
// self-check: 2000 life gives a 1000 ailment threshold and a 2000 stun / freeze threshold; immunity is 100% avoid
{ const a = ailmentDefence({ life: 2000, es: 0, evasion: 0, attrs: {} }, { immune_to_freeze: 1, 'base_avoid_shock_%': 30, 'avoid_all_elemental_status_%': 10, 'self_elemental_status_duration_-%': 50 });
  console.assert(a.ail === 1000 && a.stun === 2000 && a.freeze === 2000 && a.avoid.freeze === 100 && a.avoid.shock === 40 && a.avoid.poison === 0 && a.dur.chill === .5 && a.dur.bleed === 1 && a.dur.stun === 1 && a.avoid.stun === 0, 'ailmentDefence'); }
// Rage of the build: GameConstants' 30 at most plus "maximum Rage" and what Berserk grants (its Gemling quality), lost at
// 300 a minute once 4 s pass without gaining any. regen: the gem that regenerates it (Eternal Rage, per second, level
// and quality counted); berserk: its "increased Rage effect" and the life it costs per Rage per second while Rage is not
// being lost; gain: Rage the build gains on hit / on attack or melee hit / on kill / when hit / on skill use
const RAGE_GAIN = { hit: ['gain_x_rage_on_hit', 'base_gain_x_rage_on_hit'], attack: ['gain_x_rage_on_attack_hit'], melee: ['gain_x_rage_on_melee_hit'], kill: ['gain_rage_on_kill'], hurt: ['gain_x_rage_when_hit'], use: ['gain_x_rage_on_skill_use'] };
export function rageOf(b, sum) {
  const find = k => (b.gems || []).find(x => Object.values(SK.skills[x.name]?.levels || {})[0]?.[k] != null || SK.skills[x.name]?.constant?.[k] != null);
  const rg = find('ceaseless_rage_base_rage_regeneration_per_minute'), bz = find('skill_base_rage_effect_+%_to_apply');
  const bs = bz ? gemStats(bz, sum) : {};
  const gain = Object.fromEntries(Object.entries(RAGE_GAIN).map(([k, ids]) => [k, v(sum, ...ids)]));
  const W = weaponStats(b.items); if (W && weaponTags(W).includes('axe')) gain.hit += v(sum, 'gain_x_rage_on_hit_with_axes');   // with an axe in hand
  const fromSupport = (b.gems || []).some(x => (x.supports || []).some(n => ['gain_x_rage_on_melee_hit', 'gain_x%_of_maximum_rage_on_melee_hit'].some(k => SK.skills[n]?.constant?.[k])));   // Rage I-III, Medved's
  // Shaman's Furious Wellspring: more maximum Rage, its % of maximum Rage regenerated a second (with your mana regeneration
  // rate's modifiers) and its Rage cost on every skill; Druidic Champion: more spell damage per 2 Rage
  const regenPct = v(sum, 'base_rage_regeneration_rate_per_minute_%') / 6000 * (sum.mana_regeneration_rate_modifiers_apply_to_rage_regeneration ? 1 + v(sum, 'mana_regeneration_rate_+%') / 100 : 1);
  const base = (CHAR.base_maximum_rage || 0) + v(sum, 'maximum_rage', 'natures_sustenance_additional_maximum_rage'), any = !!rg || !!sum.maximum_rage || !!regenPct || fromSupport || Object.values(gain).some(x => x > 0);
  return {
    base: any ? base : 0, gain, regenPct, cost: v(sum, 'natures_sustenance_added_rage_cost'), spellPer2: v(sum, 'ascendancy_shaman_spell_damage_+%_final_per_2_rage'), delay: (CHAR.rage_loss_delay_ms + v(sum, 'rage_loss_delay_ms_+')) / 1000, loss: sum.no_inherent_rage_loss ? 0 : CHAR.rage_loss_per_minute / 60,
    regen: rg && { name: rg.name, perSec: (gemStats(rg, sum).ceaseless_rage_base_rage_regeneration_per_minute + v(sum, 'base_rage_regeneration_per_minute')) / 60 },
    berserk: bz && { name: bz.name, effect: bs['skill_base_rage_effect_+%_to_apply'] || 0, max: bs['berserk_maximum_rage_granted_+'] || 0, lifePerRage: (bs['skill_base_life_loss_%_per_minute_per_rage_while_not_losing_rage_to_apply'] || 0) / 60 },
  };
}
// self-check: Eternal Rage 15 regenerates 225 a minute (3.75/s), Berserk 17 with 6% quality grants +2 and 59% effect
{ const r = rageOf({ gems: [{ name: 'Eternal Rage', level: 15 }, { name: 'Berserk', level: 17, quality: 6 }] }, { ascendancy_gemling_enable_thaumaturgy_quality_stats: 1 });
  console.assert(r.base === 30 && r.regen.perSec === 3.75 && r.berserk.max === 2 && r.berserk.effect === 59 && r.delay === 4 && r.loss === 5 && r.berserk.lifePerRage === .1, 'rageOf'); }

// Detailed list under the resistances, by section like the in-game character panel.
// Each row: [label, value text, tooltip?]. Base rates come from character.ot and GameConstants (skills.json character_stats):
// energy shield recharges 12.5% of max per second after a 4 s delay, mana regenerates 4% of max per second; the stun
// threshold starts at maximum life, the ailment threshold at half of it (PlayerAilmentThresholdLifeFactor).
export function sheet(b, sum) {
  const c = character(b, sum), at = c.attrs, pct = (...ids) => 1 + v(sum, ...ids) / 100;
  const num = fmt;
  const NO_LIFE = t('Needs the class base life (regenerate the data on Windows)'), NO_MANA = t('Needs the class base mana (regenerate the data on Windows)');
  const { lifeRegen, esRate, esDelay, esRecharge, manaRegen } = recovery(c, sum);
  const esRegen = v(sum, 'base_energy_shield_regeneration_rate_per_minute') / 60 * pct('energy_shield_regeneration_rate_+%', 'energy_shield_recovery_rate_+%');
  // deflection (part of armour / evasion as deflection rating)
  const deflect = deflection(c);
  // thorns
  const thorns = [v(sum, 'thorns_minimum_base_physical_damage'), v(sum, 'thorns_maximum_base_physical_damage')].map(x => Math.round(x * pct('thorns_damage_+%')));
  // stun / ailment thresholds
  const { stun, ail, dur } = ailmentDefence(c, sum);
  const used = new Set(), opt = (label, id, unit = '%') => used.add(id) && sum[id] ? [[label, num(sum[id], Number.isInteger(sum[id]) ? 0 : 1) + unit]] : [];
  const RES = { fire: 'Fire Resistance', cold: 'Cold Resistance', lightning: 'Lightning Resistance', chaos: 'Chaos Resistance' };
  const own = [
    ['Life', [
      ['Maximum Life', num(c.life), c.life == null ? NO_LIFE : ''],
      ['Total Life Recovery per second', num(lifeRegen, 1)],
      ['Life Recovery per second from Regeneration', num(lifeRegen, 1)],
    ]],
    ['Energy Shield', [
      ['Maximum Energy Shield', num(c.es)],
      ['Energy Shield Recharge per second', num(esRecharge, 1), t('{0}% of maximum per second', num(esRate * 100 * pct('energy_shield_recharge_rate_+%'), 1))],
      ...c.es ? [['Recharge Delay', num(esDelay, 1) + ' s', t('Time without taking damage before recharge starts')]] : [],
    ]],
    ['Mana', [
      ['Maximum Mana', num(c.mana), c.mana == null ? NO_MANA : ''],
      ['Mana Recovery per second from Regeneration', num(manaRegen, 1)],
    ]],
    ['Armour', [
      ['Armour', num(c.armour)],
      ['Estimated Physical Damage Reduction', c.armourPct == null ? '—' : num(c.armourPct) + '%', t('Against a hit from a monster of your level (82 at most)')],
    ]],
    ['Evasion', [
      ['Evasion Rating', num(c.evasion)],
      ['Estimated Chance to Evade', c.evadePct == null ? '—' : num(c.evadePct) + '%', t('Against an attack from a monster of your level (82 at most)')],
    ]],
    ['Resistances', [...Object.entries(RES).map(([k, label]) => [label, `${c.res[k].capped}% (${t('max. {0}%', c.res[k].max)})`, c.res[k].value !== c.res[k].capped ? t('Uncapped: {0}%', c.res[k].value) : '']),
      ...c.penalty ? [['Area Penalty', c.penalty + '%', t('Elemental resistances are lower in areas of a higher level: here, an area of your level')]] : []]],
    ['Block', [
      ...opt('Life gained on Block', 'life_gained_on_block', ''), ...opt('Mana gained on Block', 'mana_gained_on_block', ''), ...opt('Energy Shield gained on Block', 'energy_shield_gained_on_block', ''),
    ]],
    ['Thorns', thorns[1] ? [['Total Thorns Damage', `${num(thorns[0])} – ${num(thorns[1])}`], ['Physical Thorns Damage', `${num(thorns[0])} – ${num(thorns[1])}`],
      ...opt('Thorns Critical Hit Chance', 'base_thorns_critical_strike_chance')] : []],
    ['Stun Protection', [
      ['Stun Threshold', num(stun), stun == null ? NO_LIFE : t('Amount of damage from a hit above which it can stun you')],
      ...opt('Increased Stun Recovery', 'base_stun_recovery_+%'),
    ]],
    ['Ailment Protection', [
      ['Ailment Threshold', num(ail), ail == null ? NO_LIFE : ''],
      ...opt('Ailment Duration on you', 'base_all_ailment_duration_on_self_+%'),
    ]],
    ['Damage Taken', [
      ...opt('Elemental Damage taken Recouped as Energy Shield', 'recoup_%_elemental_damage_as_energy_shield'),
      ...opt('Damage taken while on Low Life', 'damage_taken_+%_on_low_life'),
    ]],
  ];
  const flask = flaskRecovery(b.items, sum), esFlask = sum.life_recovery_from_flasks_also_recovers_energy_shield ? flask.life : 0;
  const worn = armourItems(b.items);
  // Rage: once the build has some (a gem that regenerates it, or more maximum Rage): GameConstants' 30, loss delay and
  // loss per minute, plus maximum Rage and Berserk's Gemling quality (the game's panel, 17/11: 30 + 14 + 2 = 46)
  const R = rageOf(b, sum), rage = R.base && R.base + (R.berserk?.max || 0);
  const most = (base, ...ids) => (CHAR[base] || 0) + v(sum, ...ids);
  const vs = Object.fromEntries(Object.entries(c.armourEl).map(([e, x]) => [e, Math.round(c.armour * x / 100)]));
  const asOne = vs.fire === vs.cold && vs.cold === vs.lightning;   // the game shows one "Elemental" row then
  const lvl = Math.min(b.level || 1, 82);
  const cut = x => x ? armourReduction(x, lvl) : 0;
  // block: its cap is character.ot's 50% plus "maximum Block chance"
  const blockMax = (CHAR['object_inherent_base_maximum_block_%_from_ot'] || 0) + v(sum, 'additional_maximum_block_%');
  // ailment durations on you: the ailment's own, the elemental ones' and all ailments' ("reduced" stats count down)
  const allAil = v(sum, 'base_all_ailment_duration_on_self_+%'), eleAil = v(sum, 'self_elemental_status_duration_-%');
  const selfDur = e => 100 - 100 * dur[e];   // % shorter (ailmentDefence)
  const bypass = v(sum, 'base_all_damage_bypass_energy_shield_%'), fromMana = v(sum, 'elemental_damage_removed_from_mana_before_life_%');
  const manaFirst = v(sum, 'base_damage_removed_from_mana_before_life_%');
  return panel(own, sum, used, {
    // note: the game's totals, 17/11: Energy Shield's is its flasks' (421.3) without the recharge, Life's and Mana's are
    // their regeneration alone, without their constantly applied flasks
    'energy_shield_recovery_per_minute': (esRegen + esFlask) * 60, 'mana_recovery_per_minute': manaRegen * 60,
    'total_energy_shield_recovery_per_minute_from_regeneration': esRegen * 60, 'total_energy_shield_recovery_per_minute_from_flasks': esFlask * 60,
    'total_life_recovery_per_minute_from_flasks': flask.life * 60, 'total_mana_recovery_per_minute_from_flasks': flask.mana * 60,
    'base_armour_on_equipped_armour_items': worn.armour, 'base_evasion_rating_on_equipped_armour_items': worn.evasion,
    'base_maximum_energy_shield_on_equipped_armour_items': worn.energy_shield,
    'virtual_maximum_rage': rage, 'virtual_rage_loss_delay_ms': rage && R.delay * 1000, 'virtual_inherent_rage_loss_per_minute': rage && R.loss * 60,
    'virtual_maximum_power_charges': most('max_power_charges', 'max_power_charges'), 'virtual_maximum_frenzy_charges': most('max_frenzy_charges', 'max_frenzy_charges'),
    'virtual_maximum_endurance_charges': most('max_endurance_charges', 'max_endurance_charges'),
    ...Object.fromEntries(['fire', 'cold', 'lightning'].map(e => [`virtual_maximum_${e}_infusion_stacks`, most('base_maximum_infusions', `maximum_${e}_infusion_stacks`, 'additional_maximum_infusion_stacks')])),
    'movement_velocity_+permyriad': c.move * 100,
    'display_armour_applying_to_fire': vs.fire, 'display_armour_applying_to_cold': vs.cold, 'display_armour_applying_to_lightning': vs.lightning,
    'display_armour_applying_to_chaos': vs.chaos, 'display_estimated_maximum_chaos_damage_reduction_against_hits_%': cut(vs.chaos),
    ...Object.fromEntries(['fire', 'cold', 'lightning'].map(e => [`display_estimated_maximum_${e}_damage_reduction_against_hits_%`, cut(vs[e])])),
    // note: the chance to deflect is worked out like the chance to evade, the deflection rating against the attacker's
    // accuracy (the game's own description of Deflection); a deflected hit takes GameConstants' 40% less, plus modifiers
    'deflection_rating': Math.round(deflect), 'chance_to_deflect_%_estimate': deflect && evadeChance(deflect, lvl),
    'damage_%_deflected': deflect && c.deflect.less,
    'block_%': c.block && [c.block, blockMax], 'maximum_ward': c.ward,
    'combined_bleeding_duration_on_self_+%': v(sum, 'self_bleed_duration_+%') + allAil, 'combined_poison_duration_on_self_+%': v(sum, 'self_poison_duration_+%') + allAil,
    'display_self_ignite_duration': selfDur('ignite'), 'display_self_freeze_duration': selfDur('freeze'), 'display_self_shock_duration': selfDur('shock'),
    'self_chill_duration_-%': v(sum, 'base_self_chill_duration_-%') + eleAil - allAil,
    ...Object.fromEntries(['physical', 'fire', 'cold', 'lightning', 'chaos'].map(e => [`${e}_damage_bypass_energy_shield_%`, bypass + v(sum, `base_${e}_damage_bypass_energy_shield_%`)])),
    // from Mana before Life: each type's is the general one plus its own (the game shows the general row alone when they match)
    ...Object.fromEntries(['physical', 'fire', 'cold', 'lightning', 'chaos'].map(e => [`${e}_damage_removed_from_mana_before_life_%`, manaFirst + (e === 'physical' || e === 'chaos' ? 0 : fromMana)])),
    // presence: character.ot's radius, its area scaled as an area of effect (the radius grows with the square root)
    'presence_radius': sum['presence_area_+%'] && Math.round(CHAR.base_presence_radius * Math.sqrt(pct('presence_area_+%'))),
    'self_critical_strike_multiplier_+%': -v(sum, 'base_self_critical_strike_multiplier_-%', 'body_armour_grants_x_base_self_critical_strike_multiplier_-%'),
  }, new Set([...fromMana ? [] : ['PhysicalDamageRemovedFromManaBeforeLife', 'FireDamageRemovedFromManaBeforeLife', 'ColdDamageRemovedFromManaBeforeLife',
    'LightningDamageRemovedFromManaBeforeLife', 'ChaosDamageRemovedFromManaBeforeLife'], ...asOne ? ['ArmourVsFire', 'ArmourVsCold', 'ArmourVsLightning', 'EstimateFireReductionVsHits', 'EstimateColdReductionVsHits', 'EstimateLightningReductionVsHits'] : ['ArmourVsElemental', 'EstimateElementalReductionVsHits']]));
}

// The rest of the game's character panel (char_panel.json, from its CharacterPanelStats table), in its order and
// words: a row is shown when its stat is one of `derived` or the tree and gear give it, as it is or as its base_ /
// non-virtual_ stat. note: the game also adds buffs and conditions to those stats; the planner leaves them out.
const PANEL = await fetch('poe2_data/available/char_panel.json').then(r => r.json()).catch(() => ({ sections: [], rows: [] }));
const SHOWN = new Set(['FlatValue', 'PercentageValue', 'PercentModifier', 'PercentModifierFinal', 'Seconds', 'PercentageValueWithMax']);
function panel(own, sum, used, derived, hide) {
  const value = r => {
    const id = r.stat;
    if (id in derived) return derived[id];
    const bare = id.replace(/^(virtual|combined)_/, '');
    // a total (Maximum Life...) is not the sum of its modifiers: only a % row looks under the base_ / non-virtual_ name
    const k = (r.mode.startsWith('Percent') ? [id, 'base_' + id, bare, 'base_' + bare] : [id]).find(k => sum[k] && !used.has(k));
    return k && sum[k];
  };
  const text = (r, both) => {   // both: the value, or [value, second value] ("{0}% (max {1}%)")
    let [x, y] = Array.isArray(both) ? both : [both];
    for (const f of r.fn) x = f === 'PerMinuteToPerSecond' ? x / 60 : f === 'Negate' ? -x : f === 'DivideByOneHundred1dp' ? x / 100 : f.startsWith('Milliseconds') ? x / 1000 : x;
    const [pos, neg] = PANEL.formats[r.mode][lang] || PANEL.formats[r.mode].en;
    const less = r.mode === 'PercentModifierFinal' && x < 0;
    return (less ? neg : pos).replace('{1}', fmt(y)).replace(/\{0(:\+d)?\}/, (m, sign) => (sign && x > 0 ? '+' : '') + fmt(less ? -x : x, r.fn.some(f => f.endsWith('1dp')) || !Number.isInteger(x) ? 1 : 0));
  };
  const out = PANEL.sections.map(s => {
    const mine = own.find(([h]) => h === s.name);
    const rows = PANEL.rows.filter(r => r.section === s.id && SHOWN.has(r.mode) && !hide.has(r.id)).map(r => [r, value(r)]).filter(([, x]) => x).map(([r, x]) => [tn(r), text(r, x)]);
    return mine ? [mine[0], [...mine[1], ...rows]] : [tn(s), rows];
  }).filter(([, rows]) => rows.length);   // as the game: a section with nothing to show is left out
  return [...out, ...own.filter(([h]) => !PANEL.sections.some(s => s.name === h))];
}

const DMG = ['physical', 'fire', 'cold', 'lightning', 'chaos'];
// the enemy states of "damage against <state> enemies" stats, as the scene's conditions (scene.js condN) name them
const VS_STATE = { frozen_enemies: 'Frozen', maimed_enemies: 'Maimed', burning_enemies: 'Burning', chilled_enemies: 'Chilled', ignited_enemies: 'Ignited',
  shocked_enemies: 'Shocked', poisoned_enemies: 'Poisoned', bleeding_enemies: 'Bleeding', electrocuted_enemies: 'Electrocuted', pinned_enemies: 'Pinned',
  immobilised_enemies: 'Immobilised', heavy_stunned_enemies: 'HeavyStunned', rare_or_unique_enemy: 'RareOrUnique', unique_enemies: 'Unique',
  enemies_on_full_life: 'FullLife', enemies_on_low_life: 'LowLife', enemies_with_fully_broken_armour: 'ArmourFullyBroken',
  enemies_affected_by_ailments: 'Ailing', enemies_affected_by_status_ailments: 'Ailing', blinded_enemies: 'Blinded', dazed_enemies: 'Dazed', hindered_enemies: 'Hindered',
  enemies_further_than_6m_distance: 'Further6m', enemies_within_2m_distance: 'Within2m', marked_enemies: 'Marked', exposed: 'Exposed' };
// [stat, a(rmour) / e(vasion), the scene's condition]. note: an Energy Shield part is not counted, nor "while
// Shapeshifted" (the scene has none)
const DEF_WHILE = [['armour_+%_if_consumed_endurance_charge_recently', 'a', 'ConsumedEnduranceRecently'], ['energy_shield_+%_if_consumed_power_charge_recently', 's', 'ConsumedPowerRecently'], ['evasion_rating_+%_if_consumed_frenzy_charge_recently', 'e', 'ConsumedFrenzyRecently'],
  ['global_armour_evasion_energy_shield_while_in_presence_of_companion_+%', 'ae', 'CompanionInPresence'], ['armour_+%_while_stationary', 'a', 'Still'],
  ['armour_+%_while_bleeding', 'a', 'Bleeding'], ['armour_+%_while_ignited', 'a', 'Ignited'], ['armour_+%_while_surrounded', 'a', 'Surrounded'], ['evasion_rating_+%_while_surrounded', 'e', 'Surrounded'],
  ['armour_evasion_+%_while_leeching', 'ae', 'Leeching'], ['evasion_+%_if_hit_recently', 'e', 'BeenHitRecently'], ['armour_+%_if_have_been_hit_recently', 'a', 'BeenHitRecently'],
  ['evasion_rating_+%_if_have_not_been_hit_recently', 'e', 'NotHitRecently'], ['armour_+%_if_you_havent_been_hit_recently', 'a', 'NotHitRecently'], ['evasion_rating_+%_while_moving', 'e', 'Moving'],
  ['evasion_rating_+%_if_sprinting', 'e', 'Sprinting'], ['armour_evasion_energy_shield_+%_while_channelling', 'ae', 'Channelling'], ['evasion_rating_+%_if_you_have_hit_an_enemy_recently', 'e', 'HitRecently'],
  ['armour_+%_if_hit_enemy_with_melee_attack_recently', 'a', 'HitMeleeRecently'], ['evasion_rating_+%_while_you_have_energy_shield', 'e', 'HaveEnergyShield'],
  ['evasion_rating_+%_if_you_dodge_rolled_recently', 'e', 'DodgeRolledRecently'], ['evasion_rating_+%_when_on_full_life', 'e', 'FullLife']];
// the tree's attack (a) / cast (c) speed while you are in a state: [stat, a / c / ac, the scene's condition]. note: not
// counted "per Enemy in Close Range" (the game data has no distance for it), "while Shapeshifted", against Bloodlusting
// enemies, Parry's own speed after a Parry
const SPEED_WHILE = [['attack_and_cast_speed_+%_while_affected_by_a_mana_flask', 'ac', 'ManaFlaskEffect'], ['attack_speed_+%_during_flask_effect', 'a', 'FlaskEffect'],
  ['attack_speed_+%_if_enemy_killed_recently', 'a', 'KilledRecently'], ['attack_speed_+%_if_have_been_hit_recently', 'a', 'BeenHitRecently'],
  ['attack_speed_+%_if_have_crit_recently', 'a', 'CritRecently'], ['cast_speed_+%_if_have_crit_recently', 'c', 'CritRecently'],
  ['attack_speed_+%_if_rare_or_unique_enemy_nearby', 'a', 'RareOrUniqueInPresence'], ['attack_speed_+%_if_you_have_not_attacked_recently', 'a', 'NotAttackedRecently'],
  ['attack_speed_+%_while_in_presence_of_companion', 'a', 'CompanionInPresence'], ['attack_speed_+%_while_leeching', 'a', 'Leeching'],
  ['attack_speed_+%_while_not_on_low_mana', 'a', 'NotLowMana'], ['attack_speed_+%_while_surrounded', 'a', 'Surrounded'],
  ['cast_speed_+%_for_4_seconds_on_attack', 'c', 'AttackedRecently'], ['cast_speed_+%_if_you_have_used_a_mana_flask_recently', 'c', 'ManaFlaskRecently'],
  ['cast_speed_+%_when_on_full_life', 'c', 'FullLife'], ['cast_speed_+%_when_on_low_life', 'c', 'LowLife'], ['cast_speed_+%_while_chilled', 'c', 'Chilled'],
  ['cast_speed_+%_while_ignited', 'c', 'Ignited'], ['cast_speed_+%_while_on_full_mana', 'c', 'FullMana'], ['skill_speed_+%_if_consumed_frenzy_charge_recently', 'ac', 'ConsumedFrenzyRecently']];
// the tree's movement speed while you are in a state: [stat, the scene's condition; none: dual wielding, known here].
// note: not counted against Bloodlusting enemies, "if you've Pinned an enemy Recently", while using a Charm, Parry's own,
// "if 10 green supports are socketed", the penalties while performing an action
const MOVE_WHILE = [['movement_speed_+%_while_dual_wielding'], ['movement_speed_+%_if_enemy_killed_recently', 'KilledRecently'], ['movement_speed_+%_while_surrounded', 'Surrounded'],
  ['movement_speed_+%_while_you_have_energy_shield', 'HaveEnergyShield'], ['movement_speed_+%_for_4_seconds_on_block', 'BlockedPast4'], ['movement_speed_+%_if_used_a_mark_recently', 'MarkRecently']];
// the tree's regeneration while you are in a state: [stat, L (life % of the maximum per minute) / l (life regeneration
// rate) / m (mana regeneration rate), the scene's condition]. note: the "recovery rate" ones count for regeneration
// only, not flasks; not counted "per 5% missing life", "while Shapeshifted"
const REGEN_WHILE = [['life_regeneration_rate_+%_while_ignited', 'l', 'Ignited'], ['life_regeneration_rate_+%_while_moving', 'l', 'Moving'],
  ['life_regeneration_rate_+%_while_on_low_life', 'l', 'LowLife'], ['life_regeneration_rate_+%_while_stationary', 'l', 'Still'],
  ['life_regeneration_rate_+%_while_using_life_flask', 'l', 'LifeFlaskEffect'], ['life_recovery_rate_while_in_presence_of_companion_+%', 'l', 'CompanionInPresence'],
  ['life_regeneration_rate_per_minute_%_if_have_been_hit_recently', 'L', 'BeenHitRecently'], ['life_regeneration_rate_per_minute_%_if_used_life_flask_in_past_10_seconds', 'L', 'LifeFlaskPast10'],
  ['life_regeneration_rate_per_minute_%_when_on_low_life', 'L', 'LowLife'], ['life_regeneration_rate_per_minute_%_while_affected_by_damaging_ailment', 'L', 'DamagingAilment'],
  ['life_regeneration_rate_per_minute_%_while_stationary', 'L', 'Still'], ['life_regeneration_rate_per_minute_%_while_surrounded', 'L', 'Surrounded'],
  ['mana_recovery_rate_+%_while_affected_by_a_mana_flask', 'm', 'ManaFlaskEffect'], ['mana_regeneration_rate_+%_on_full_life', 'm', 'FullLife'],
  ['mana_regeneration_rate_+%_while_moving', 'm', 'Moving'], ['mana_regeneration_rate_+%_while_not_on_low_mana', 'm', 'NotLowMana'],
  ['mana_regeneration_rate_+%_while_shocked', 'm', 'Shocked'], ['mana_regeneration_rate_+%_while_stationary', 'm', 'Still'],
  ['mana_regeneration_rate_+%_if_enemy_shocked_recently', 'm', 'ShockedEnemyRecently']];
// "damage_+%_<state>" while you are in it: [the stat's end, the scene's condition]
const WHILE = { while_surrounded: 'Surrounded', while_moving: 'Moving', while_in_presence_of_companion: 'CompanionInPresence', while_ally_in_presence: 'AllyInPresence',
  while_you_have_arcane_surge: 'ArcaneSurge', when_on_full_life: 'FullLife', when_on_low_life: 'LowLife', while_leeching: 'Leeching', while_life_leeching: 'LifeLeeching',
  if_have_crit_in_past_8_seconds: 'CritPast8', while_es_full: 'FullEnergyShield', while_totem_active: 'TotemActive', while_affected_by_a_herald: 'HeraldOn',
  if_youve_dealt_projectile_attack_hit_recently: 'HitProjectileRecently', if_youve_dealt_melee_hit_recently: 'HitMeleeRecently', if_consumed_frenzy_charge_recently: 'ConsumedFrenzyRecently',
  while_ignited: 'Ignited', if_enemy_chilled_recently: 'ChilledEnemyRecently', if_enemy_ignited_recently: 'IgnitedEnemyRecently', if_enemy_shocked_recently: 'ShockedEnemyRecently',
  ...Object.fromEntries(['Ice', 'Ash', 'Thunder', 'Plague', 'Blood'].map(h => [`while_affected_by_herald_of_${h.toLowerCase()}`, `HeraldOf${h}`])) };
// the tree's critical hit chance (crit) / damage bonus (critBonus) while you, or the enemy (e), are in a state
const CRIT_WHILE = [['critical_strike_chance_+%_if_enemy_killed_recently', 'crit', 'KilledRecently'], ['critical_strike_chance_+%_if_have_not_crit_recently', 'crit', 'NotCritRecently'],
  ['critical_strike_chance_against_enemies_on_full_life_+%', 'crit', 'FullLife', 'e'], ['critical_strike_multiplier_+_if_have_not_dealt_critical_strike_recently', 'critBonus', 'NotCritRecently'],
  ['critical_strike_multiplier_+_if_have_dealt_non_crit_recently', 'critBonus', 'NonCritRecently'], ['critical_strike_multiplier_vs_enemies_on_full_life_+', 'critBonus', 'FullLife', 'e'],
  ['critical_strike_multiplier_+_if_gained_power_charge_recently', 'critBonus', 'PowerGainedRecently']];
export const DMG_NAME = { physical: '{0} physical', fire: '{0} fire', cold: '{0} cold', lightning: '{0} lightning', chaos: '{0} chaos' };
// Sum of "<prefix>_<suffix>" stats that apply to a skill with these tags (generic ones always). The prefix may be
// several words: every one has to fit (attack_area_damage_+%: attacks with an area; one_handed_melee_attack_speed_+%).
// Damage types are added per type by the caller, and what is the minions' is not the character's.
function inc(sum, suffix, tags) {
  let t = 0;
  for (let [k, val] of Object.entries(sum)) {
    // "damage_+%_with_two_handed_weapons" / "..._with_bow_skills": the qualifier is one more prefix word
    const w = k.match(/^(.*)_with_([a-z_]+?)_(?:weapons|skills)$/); if (w) k = `${w[2]}_${w[1]}`;
    // "damage_vs_enemies_on_low_life_+%", "attack_damage_vs_bleeding_enemies_+%": the same as "..._damage_+%_vs_..."
    const vs = k.match(/^(.*damage)_(vs|against)_(\w+)_\+%$/); if (vs) k = `${vs[1]}_+%_${vs[2]}_${vs[3]}`;
    if (!k.endsWith(suffix)) continue;
    const pre = k.slice(0, -suffix.length).replace(/_skill_$|_$/, '').replace(/^base_(?=.)/, '').replace(/(one|two)_handed/, '$1hand');
    if (pre === '' || pre === 'base' || pre === 'global' || pre.split('_').every(w => tags.includes(w) && !DMG.includes(w) && w !== 'minion' && w !== 'companion')) t += val;
  }
  return t;
}
console.assert(inc({ 'damage_+%_with_two_handed_weapons': 40, 'damage_+%_with_bow_skills': 5 }, 'damage_+%', ['attack', 'twohand']) === 40, 'inc: _with_ stats');
console.assert(inc({ 'attack_damage_vs_bleeding_enemies_+%': 7, 'damage_vs_enemies_on_low_life_+%': 3 }, 'damage_+%_vs_bleeding_enemies', ['attack']) === 7 && !inc({ 'damage_vs_enemies_on_low_life_+%': 3 }, 'damage_+%', []), 'inc: _vs_ stats');
// what the stat ids call the weapon an attack is made with (item base tags; warstaff is the quarterstaff)
const WEAPON = ['mace', 'bow', 'crossbow', 'spear', 'sword', 'axe', 'dagger', 'flail', 'claw', 'talisman', 'onehand', 'twohand'];
const weaponTags = w => (w.tags || []).map(x => x === 'warstaff' ? 'quarterstaff' : x).filter(x => x === 'quarterstaff' || WEAPON.includes(x));

// Stats of the supports socketed in a skill (their first level: supports have one level per tier).
// Where Path of Building 2 says what a stat does (SK.supports[name].mods: [name, MORE|INC|BASE|FLAG, value, flags,
// conditional], e.g. Damage MORE 25 for hits) that reading is used, except the conditional ones (enemy on low life, a
// buff being up...): the app cannot assume them. Of the other stats, "..._+%_final" are separate "more" multipliers
// (fin) and the rest join the tree + gear sum for this skill only. A "more" whose id says something else than the
// support's name and words the calculation knows (..._distance_based_pin_damage: Pin buildup, not damage;
// ..._randomise_higher_damage; ..._detonation_damage) is left out: it is not a plain multiplier of the skill.
const PLAIN = new Set(['support', 'damage', 'attack', 'cast', 'speed', 'spell', 'projectile', 'melee', 'area', 'of', 'effect', 'and', 'minion', 'skill', 'hit', 'ailment', 'elemental', '+%', 'final', ...DMG]);
// the PoB2 mod names calc.js reads (mod(), dmgMods, DealNo..., NeverCrit)
const USED = /^(?:(?:Physical|Fire|Cold|Lightning|Chaos|Elemental)?Damage|Speed|CooldownRecovery|CritChance|CritMultiplier|DamageGainAs\w+|Max\w+Damage|DealNo\w+|NeverCrit)$/;
// or one the game's own text says is that and nothing else: "Supported Skills deal 35% less Damage" (Tremors'
// support_unstable_earth_damage_+%_final), "Supported Grenade Skills deal...", "Hazards created by Supported Skills deal..."
// (or speed: Tectonic Slams' "Supported Skills have 15% less Attack Speed")
const PLAIN_TEXT = /^(?:Supported (?:\w+ )?Skills|Hazards created by Supported Skills) (?:deal|have) \d+% (?:more|less) (?:damage|attack speed|cast speed)$/i;
const plainText = k => /(?:damage|attack_speed|cast_speed)_\+%_final$/.test(k) &&   // only the endings more() reads
  PLAIN_TEXT.test(statLinesEn({ [k]: 10 })[0] || '');
const plainMore = (k, name) => { const own = name.toLowerCase().replace(/[^a-z ]/g, '').split(' '); return k.split('_').every(w => PLAIN.has(w) || own.some(o => o === w || o === w + 's' || o + 's' === w)); };
// wset: the weapon set in hand, for the mods only there (Rigwald's Ferocity)
export function withSupports(g, sum, wset) {
  const all = { ...sum }, fin = {}, mods = [], finals = {}, twice = new Set(), own = {};
  for (const n of g.supports || []) {
    const p = n && SK.supports?.[n], d = n && SK.skills[n]; if (!p && !d) continue;
    const inSet = m => m[4].every(c => c.type === 'Condition' && c.var === 'WeaponSet' + (wset === 2 ? 2 : 1));
    if (p) mods.push(...(p.mods || []).filter(m => !m[4] || inSet(m)));
    const lv = d?.levels?.[Object.keys(d?.levels || {})[0]] || {}, game = { ...(d?.constant || {}), ...lv };
    // the game's stats, except those PoB2 reads as a mod used here (or only under a condition): Bleed II's bleed chance,
    // Fire Mastery's level, which PoB2 reads as mods the app has no use for or does not have. A condition of PoB2's
    // where the game's text has none ("Supported Skills deal 50% more Damage": Zerphi's Infamy) does not count
    const read = new Set((p?.mods || []).filter(m => m[4] ? !plainText(m[5]) : USED.test(m[0])).map(m => m[5]));
    for (const [k, val] of Object.entries({ ...game, ...(p?.stats || {}) })) {
      if (read.has(k) || k.startsWith('_') || typeof val !== 'number') continue;
      if (!k.endsWith('_final')) { all[k] = (all[k] || 0) + val; if (k.includes('_final')) twice.add(k); }
      else if (plainMore(k, n) || plainText(k)) fin[k] = (fin[k] || 0) + val;
    }
    // every "more" of the support as the game's tables have it, for the rules calc.js reads by name (ailments()), and
    // all its stats (own: those under a condition PoB2 reads too, for the simulator, Refraction's Refractive Plating)
    for (const [k, val] of Object.entries({ ...(d?.constant || {}), ...lv })) if (typeof val === 'number') {
      own[k] = (own[k] || 0) + val; if (k.includes('_final')) finals[k] = (finals[k] || 0) + val; }
  }
  return { sum: all, fin, mods, finals, twice, own };
}
// true when the data says what this support does to the numbers the app calculates
export const supportKnown = name => !!SK.supports?.[name] || !!SK.skills[name]?.levels;
// support mods called one of <names> whose flags this use of the skill meets (has): product of the MORE ones, sum of the others
function mod(mods, kind, names, has) {
  let m = kind === 'MORE' ? 1 : 0;
  for (const [n, k, val, flags] of mods) if (k === kind && names.includes(n) && flags.every(has)) m = kind === 'MORE' ? m * (1 + val / 100) : m + val;
  return m;
}
// product of the support "more" multipliers ending in <suffix>_final that fit this skill: the stat id may name a damage
// type, skill tag or minion; if it names one this skill / damage type does not have, it does not apply
function more(fin, suffix, tags, type) {
  let m = 1;
  for (const [k, val] of Object.entries(fin)) {
    if (!k.endsWith(suffix + '_final')) continue;
    const words = k.slice(0, -(suffix + '_final').length).split('_');
    if (words.includes('empowered')) continue;   // only on an Empowered use (Premeditation): the scene applies it then
    if (DMG.some(d => words.includes(d) && d !== type) || words.includes('minion') && !tags.includes('minion')) continue;
    if (['spell', 'attack', 'projectile', 'melee', 'area'].some(x => words.includes(x) && !tags.includes(x))) continue;
    m *= 1 + val / 100;
  }
  return m;
}

// Hit, speed, crit and DPS of one gem of the build. Everything null-safe: missing data -> dps null + reason.
// Multishot II says 25% less damage (GrantedEffectStatSets support_multiple_damage_+%_final -25, PoB2 too), but in the
// game it takes 26% off: Cluster Grenade of Mortar Cannon, one totem, no Berserk (18/11) gives 4306-9367 without it and
// 3186-6932 with it, x0.740 for every damage type. Multishot I (35% less) the same way: 2756-5995, x0.640
const MEASURED_MORE = { 'Multishot I': 0.64 / 0.65, 'Multishot II': 0.74 / 0.75 };
// support gems by colour (their main attribute), of one skill or every skill of the build
const supportsOf = list => {
  const n = { str: 0, dex: 0, int: 0 };
  for (const s of list) { const a = GEM[s] && Object.entries(GEM[s].attr || {}).sort((x, y) => y[1] - x[1])[0]; if (a?.[1]) n[a[0]]++; }
  return n;
};
function gemlingOf(g, sum, b) {
  const red = v(sum, 'skills_gain_damage_+%_per_sockted_or_adjacent_red_support_gem'), green = v(sum, 'skills_gain_skill_speed_+%_per_sockted_or_adjacent_green_support_gem');
  const blue = v(sum, 'skills_gain_critical_strike_chance_+%_per_sockted_or_adjacent_blue_support_gem'), cost = v(sum, 'skill_cost_+%_final_if_blue_support_count_highest'), lich = v(sum, 'lich_mana_cost_+%_final_if_you_have_no_energy_shield');
  if (!red && !green && !blue && !cost && !lich) return null;
  const n = supportsOf(g.supports || []);
  const costMore = (n.int && n.int >= n.str && n.int >= n.dex ? 1 + cost / 100 : 1) * (lich && !character(b, sum).es ? 1 + lich / 100 : 1);
  return { 'damage_+%': red * n.str, 'skill_speed_+%': green * n.dex, 'critical_strike_chance_+%': blue * n.int, 'gemling_skill_cost_+%_final': (costMore - 1) * 100 };
}
export function skill(g, b, treeGear) {
  // a buff the scene has on (g.add: Nature's Archon's stats), added to what the tree and gear give
  // and Gemling Legionnaire: per red / green / blue (strength / dexterity / intelligence) support socketed in the skill,
  // and less cost when blue supports are the most; Lich: more mana cost with no maximum energy shield
  for (const x of [g.add, gemlingOf(g, treeGear, b)]) if (x) { treeGear = { ...treeGear }; for (const [k, n] of Object.entries(x)) treeGear[k] = (treeGear[k] || 0) + n; }
  const d = SK.skills[g.name] || {}, G = GEM[g.name] || (d.triggered_by ? d : {}), own = G.tags || [];   // a support's triggered skill: its own types
  // a meta gem's supports are for the skills it uses (Mortar Cannon's, for its Cluster Grenade): not for the gem itself,
  // as the game's details window shows (Mortar Cannon with Multishot II: 1 s, not 1.25 s)
  const { sum, fin, mods, finals, twice = new Set(), own: supOwn = {} } = own.includes('meta') ? { sum: treeGear, fin: {}, mods: [], finals: {} } : withSupports(g, treeGear, b?.wset);
  const st = { ...gemStats(g, sum), ...g.base };   // g.base: a triggered skill's base damage that comes from elsewhere (out.trig)
  // a totem that is not a meta gem uses the gem's own attack or spell itself (Shockwave Totem's quake, Artillery
  // Ballista's bolts, Dark Effigy's spell: available.py lays that part over the totem)
  const ownTotem = !own.includes('meta') && d.totem || null, gt = G.types || [];
  // a warcry's part with damage (Fortifying Cry's shockwave, Ancestral Cry's projectiles, Lunar Blessing's Moonbeams) is
  // an attack with the weapon (PoB2's baseFlags attack), though the warcry itself is not
  const attack = gt.includes('Attack') || !!ownTotem && gt.includes('SummonsAttackTotem') || !!g.part && gt.includes('Warcry'), spell = gt.includes('Spell') || !!ownTotem && !attack && own.includes('spell');
  // flags of a support mod this skill meets: "hit" for its hits, "dot" for its damage over time, else what the skill is
  const has = dot => f => f === 'hit' ? !dot : f === 'dot' ? dot : f === 'attack' ? attack : f === 'spell' || f === 'cast' ? spell : own.includes(f);
  const hit = has(false), dmgMods = t => ['Damage', cap(t) + 'Damage', ...(t === 'physical' || t === 'chaos' ? [] : ['ElementalDamage'])];
  const out = { attack, spell, stats: st, sum, finals, sup: supOwn, castTime: d.cast_time_ms ?? null, hits: {}, dot: {}, avg: null, speed: null, crit: null, critBonus: null, dps: null, reason: null };
  // an empty main hand, for a skill used unarmed (WeaponRequirements ''): the class's own unarmed attack (Characters:
  // MinDamage-MaxDamage physical, WeaponSpeed ms, MaxAttackDistance; unarmed_base_critical_strike_chance)
  const cb = ascOf(b.asc).class_base, bare = attack && !b.items?.weapon && d.weapons?.includes('') && cb?.WeaponSpeed;
  const w = attack ? weaponStats(b.items) || (bare ? { physical: [cb.MinDamage, cb.MaxDamage], attacks_per_second: 1000 / cb.WeaponSpeed, crit: (CHAR.unarmed_base_critical_strike_chance || 0) / 100, range: cb.MaxAttackDistance } : null) : null;
  // Amazon: physical damage added to attacks with the weapon, a share of the weapon's own accuracy
  const accPhys = w?.accuracy && v(sum, 'real_weapon_attack_added_physical_damage_%_of_weapon_item_accuracy') * w.accuracy / 100;
  if (accPhys) w.physical = w.physical.map(x => x + accPhys);
  // the weapons the skill is used with (ActiveSkills.WeaponRequirements; a shield skill names what the off hand holds)
  if (w && !bare && d.weapons && !['weapon', 'offhand'].some(s => d.weapons.includes(classOf(b.items[s])))) return { ...out, reason: 'This skill cannot be used with the weapon in hand' };
  // the skill a meta totem uses (Mortar Cannon's Cluster Grenade: the gem right after it, with the same supports, as a
  // Path of Building group comes in) is a totem's ballista attack: "increased Ballista / Totem Damage" count, "per active
  // Totem in your Presence" once, for that totem, and the meta gem's own -50% more damage. The game's window with one
  // Mortar Cannon placed, no Rage (16/11): 2.7% under this. note: Rage is not counted; the gem before it, a link of
  // its own if a build breaks it
  // g may be a copy with other supports (the Optimizer's): the build's gem of that name then
  const gi = (b.gems || []).indexOf(g), meta = usedBy(b, gi >= 0 ? gi : (b.gems || []).findIndex(x => x.name === g.name)), byTotem = meta && SK.skills[meta.name]?.totem || ownTotem;
  const tags = [...(w ? [...own, ...weaponTags(w)] : own), ...(byTotem?.ballista ? ['ballista'] : [])];   // passives for a weapon type count for attacks made with it
  // "per active Totem" counts each one: all the build may place (the game's windows, 16/11: one Mortar Cannon x1.0183
  // damage, two x1.0366)
  const totems = out.totems = byTotem && attack ? (totem(meta || g, treeGear)?.limit || 1) : 0;
  const perTotem = totems * v(sum, 'attack_damage_+%_per_active_totem_in_presence');
  const perTotemSpeed = totems * v(sum, 'totems_attack_speed_+%_per_active_totem');
  // and the meta gem's own support part slows it and lowers its damage (Mortar Cannon: -50% more attack speed and damage;
  // the game's window, 1.79 s, has them). Its +100% cooldown recovery is not in that window (10.99 s fits without)
  const metaFinal = end => meta && byTotem ? 1 + Object.entries(SK.skills[meta.name].meta_support || {}).reduce((t, [k, x]) => t + (k.endsWith(end) ? x : 0), 0) / 100 : 1;
  const metaSpeed = metaFinal('attack_speed_+%_final'), metaDmg = metaFinal('ballista_damage_+%_final');
  // Rage: 1% more attack damage per point (measured in the game, 16/11: 44 Rage made every damage type of Cluster Grenade
  // x1.440; the value is in no table, only the stat attack_damage_final_permyriad_from_rage). note: full Rage (30 of
  // GameConstants + "maximum Rage") when a gem of the build regenerates it (Eternal Rage), else none. Berserk's "increased
  // Rage effect" (gem level and quality) scales that bonus, and its Gemling alt quality grants maximum Rage: the game's
  // window with Berserk 17, 6% quality (59%, +2 Rage: 46), 16/11, gives x1.730 (46 x 1.59% = x1.731)
  const R = rageOf(b, treeGear);
  const rage = out.rage = attack && R.regen ? (CHAR.base_maximum_rage || 0) + v(sum, 'maximum_rage') + (R.berserk?.max || 0) : 0;
  const rageEffect = out.rageEffect = R.berserk?.effect || 0;
  // mana per use (per second for a channelled skill), as Path of Building 2 works it out (CalcOffence): the gem's cost at
  // its level times its supports' cost multipliers (floored to 4 digits), plus flat cost, then increased / reduced (up
  // when reduced, down when increased), more / less the same way, over cost efficiency; an upfront cost is whole
  const supMult = own.includes('meta') ? 1 : Math.floor((g.supports || []).reduce((x, n) => x * ({ ...SK.skills[n]?.constant, ...Object.values(SK.skills[n]?.levels || {})[0] }._cost_multiplier ?? 100) / 100, 1) * 1e4) / 1e4;
  const perSec = st._cost?.ManaPerSecond != null, baseCost = (perSec ? st._cost.ManaPerSecond : st._cost?.Mana) || 0;
  if (baseCost && !sum.no_mana_cost) {
    // cost efficiency, of every cost (Deep Trance) and of attacks (Price of Freedom): with the mana cost's own, and the life cost's
    const effAll = v(sum, 'base_skill_cost_efficiency_+%') + (own.includes('attack') ? v(sum, 'base_attack_skill_cost_efficiency_+%') : 0);
    const step = (x, f) => f < 1 ? Math.ceil(x * f) : Math.floor(x * f), raw = baseCost * supMult + v(sum, 'base_mana_cost_+');
    const inc1 = 1 + (inc(sum, 'mana_cost_+%', tags) - v(sum, 'base_mana_cost_-%') + v(sum, 'base_cost_+%')) / 100;
    const more1 = (1 + (v(sum, 'mana_cost_+%_final') + (finals['mana_cost_+%_final'] || 0)) / 100) * (1 + v(sum, 'gemling_skill_cost_+%_final') / 100), eff = 1 + (v(sum, 'base_mana_cost_efficiency_+%') + effAll + (own.includes('spell') ? v(sum, 'base_spell_mana_cost_efficiency_+%') : 0)
      + (own.includes('mark') ? v(sum, 'base_mana_cost_efficiency_+%_of_mark_skills') : 0) + (own.includes('command') ? v(sum, 'base_mana_cost_efficiency_+%_of_command_skills') : 0)) / 100;
    const moreCost = 1 + (finals['support_inspiration_cost_+%_final'] || 0) / 100;   // Efficiency: "more Cost", every resource
    // Lifetap: part of the mana cost converted to a life cost (PoB2 CalcOffence: that part of the cost before modifiers,
    // rounded, with the generic and the life cost modifiers; the mana cost keeps the rest, rounded down)
    const toLife = Math.min(100, v(sum, 'base_skill_cost_life_instead_of_mana_%')) / 100;
    out.cost = perSec ? Math.max(0, raw * inc1 * more1 * moreCost / eff) : Math.max(0, Math.round(step(step(step(Math.floor(raw), inc1), more1), moreCost) / eff));
    if (toLife) {
      const life = perSec ? raw * toLife : Math.round(Math.floor(raw) * toLife), inc2 = 1 + v(sum, 'base_cost_+%') / 100, more2 = 1 + (finals['blood_magic_skill_life_cost_+%_final'] || 0) / 100;
      const eff2 = 1 + (effAll + v(sum, 'base_life_cost_efficiency_+%')) / 100;
      out.lifeCost = perSec ? Math.max(0, life * inc2 * more2 * moreCost / eff2) : Math.max(0, Math.round(step(step(step(life, inc2), more2), moreCost) / eff2));
      out.cost = perSec ? out.cost * (1 - toLife) : Math.floor(out.cost * (1 - toLife));
    }
    // Paquate's Pact: a % of maximum life more for each use or trigger of the skill Recently, up to the stat's own cap
    const pact = Object.keys(sum).find(k => k.startsWith('support_corrupting_cry_%_life_cost_per_supported_skill'));
    if (pact) out.lifePerRecent = { pct: sum[pact], max: +pact.match(/up_to_(\d+)%/)[1] };
    out.costPerSecond = perSec;
  } else out.cost = 0;
  // a shield skill attacks with the shield (PoB2's off-hand pass): its own off-hand damage (off_hand_weapon_*), plus its
  // added damage per 15 (5) of the shield's armour / evasion (whole steps, PoB2's PerStat); a shield has no attack time,
  // so the skill's own, and its own critical chance
  const SH = { armour: 'armour', evasion: 'evasion', evasion_rating: 'evasion', armour_and_evasion_rating: 'both' };
  const shield = attack && d.weapons?.some(x => x === 'Shields' || x === 'Bucklers') && d.weapons.includes(classOf(b.items.offhand)) && armourItems({ offhand: b.items.offhand });
  const shieldAdd = (t, i) => Object.entries(st).reduce((n, [k, x]) => {
    const m = k.match(new RegExp(`^off_hand_${i ? 'maximum' : 'minimum'}_added_${t}_damage_per_(\\d+)_shield_(\\w+)$`)), D = m && SH[m[2]];
    return D ? n + x * Math.floor((D === 'both' ? shield.armour + shield.evasion : shield[D]) / m[1]) : n; }, 0);
  // a thrown flask (the Concoctions): with empty hands (PoB2's weaponTypes "None"), its own damage (main_hand_weapon_*),
  // attack time and critical chance
  const flaskThrow = attack && d.weapons?.includes('') && st.main_hand_base_weapon_attack_duration_ms;
  const nonWeapon = attack && (d.types || gt).includes('NonWeaponAttack') || flaskThrow;   // Deadly Resolve, Fan the Flames, Conductive Runes: their own damage, not the weapon's (PoB2: main_hand_weapon_* as base)
  if (!d.levels) out.reason = 'The skill damage data is missing (regenerate the data on Windows)';
  else if (attack && !w && !nonWeapon && !shield) out.reason = 'Equip a weapon to calculate the attack damage';
  // base damage per type
  // "Attack damage of this skill is 20% of Default Attack Damage" (Volcanic Eruption): PoB2's baseMultiplier too
  const mult = attack ? (st._base_multiplier ?? (st['active_skill_has_%_standard_scaling_attack_damage'] ?? 100) * 100) / 10000 : 1;
  const base = {};
  for (const t of DMG) {
    let lo = 0, hi = 0;
    if (attack && (w || nonWeapon || shield)) {   // a non-weapon attack needs no weapon in hand
      const r = shield ? [(st[`off_hand_weapon_minimum_${t}_damage`] || 0) + shieldAdd(t, 0), (st[`off_hand_weapon_maximum_${t}_damage`] || 0) + shieldAdd(t, 1)]
        : nonWeapon ? [st[`main_hand_weapon_minimum_${t}_damage`] || 0, st[`main_hand_weapon_maximum_${t}_damage`] || 0] : t === 'physical' ? w.physical : w[t];
      if (r) { lo += r[0]; hi += r[1]; }
      lo += v(sum, `attack_minimum_added_${t}_damage`); hi += v(sum, `attack_maximum_added_${t}_damage`);
    }
    lo += first(st[`spell_minimum_base_${t}_damage`], st[`attack_minimum_added_${t}_damage`], st[`minimum_base_${t}_damage`], 0);
    hi += first(st[`spell_maximum_base_${t}_damage`], st[`attack_maximum_added_${t}_damage`], st[`maximum_base_${t}_damage`], 0);
    base[t] = [lo, hi];
  }
  // the skill's own conversion (Lightning Arrow: 80% of physical to lightning); converted damage scales as its new type
  for (const t of DMG.slice(1)) {
    const p = Math.min(100, st[`active_skill_base_physical_damage_%_to_convert_to_${t}`] || 0) / 100;
    if (p) for (const i of [0, 1]) base[t][i] += base.physical[i] * p;
  }
  const kept = 1 - Math.min(1, DMG.slice(1).reduce((s, t) => s + (st[`active_skill_base_physical_damage_%_to_convert_to_${t}`] || 0), 0) / 100);
  base.physical = base.physical.map(x => x * kept);
  // supports: "gain X% of damage as extra <type>" adds to that type, "deal no <type> damage" removes it, and some
  // only raise the top of the range (Heft)
  // and the tree's, gear's and supports' game stats "gain X% of <all / elemental / a type of> damage as extra <type>"
  // (non_skill_base_fire_damage_%_to_gain_as_chaos: Xoph's Pyre; _with_spells / _with_attacks only for those), of the
  // damage after conversion
  const pre = { ...base }, all = [0, 1].map(i => DMG.reduce((s, t) => s + pre[t][i], 0));
  const SRC = { all: DMG, elemental: ['fire', 'cold', 'lightning'], ...Object.fromEntries(DMG.map(t => [t, [t]])) }, end = spell ? '_with_spells' : attack ? '_with_attacks' : null;
  const gain = (src, t, k = `non_skill_base_${src}_damage_%_to_gain_as_${t}`) => v(sum, k) + (end ? v(sum, k + end) : 0) + v(st, `active_skill_base_${src}_damage_%_to_gain_as_${t}`)
    + (src === 'all' && t !== 'physical' && t !== 'chaos' ? v(sum, 'non_skill_base_all_damage_%_to_gain_as_random_element') / 3 : 0);   // Shaman: a random element, a third each on average
  for (const t of DMG) {
    const extra = mod(mods, 'BASE', ['DamageGainAs' + cap(t)], hit) / 100;
    const from = [0, 1].map(i => Object.entries(SRC).reduce((x, [src, ts]) => x + gain(src, t) / 100 * ts.reduce((y, u) => y + pre[u][i], 0), 0));
    base[t] = mods.some(m => m[0] === 'DealNo' + cap(t)) ? [0, 0] : [base[t][0] + all[0] * extra + from[0], (base[t][1] + all[1] * extra + from[1]) * mod(mods, 'MORE', [`Max${cap(t)}Damage`], hit)];
  }
  // a totem's grenade: "increased Grenade Damage" does not count (the game's window, 16/11: the same 4311-9885 without
  // two Grenade Damage nodes; Volatile Grenades' fuse is not in it either), the grenade cooldown ones do (10.99 s)
  const dmgTags = byTotem ? [...tags.filter(x => x !== 'grenade'), 'totem'] : tags;
  // supports whose damage the game's window shows otherwise than their stats (and Path of Building 2) say: measured
  const measured = (g.supports || []).reduce((x, n) => x * (MEASURED_MORE[n] || 1), 1);
  // "increased Spell Damage with Spells that cost Life": a spell with a life cost (Lifetap, Blood Magic)
  // the tree's increased damage per attribute, maximum mana or block chance (the character's own, with this skill's supports)
  const PA = [['damage_+%_per_15_strength', c => c.attrs.str / 15], ['damage_+%_per_5_of_your_lowest_attribute', c => Math.min(c.attrs.str || 0, c.attrs.dex || 0, c.attrs.int || 0) / 5],
    ['damage_+%_per_1%_block_chance', c => c.block], ...spell ? [['spell_damage_+%_per_10_strength', c => c.attrs.str / 10], ['spell_damage_+%_per_100_maximum_mana', c => c.mana / 100]] : []].filter(([k]) => sum[k]);
  const ch = PA.length && character(b, sum), perAttr = PA.reduce((t, [k, f]) => t + Math.floor(f(ch) || 0) * sum[k], 0);
  const trigSpell = spell && (gt.includes('Triggered') || meta && !byTotem) ? v(sum, 'triggered_spell_spell_damage_+%') : 0;   // Invoker: spells a meta skill or another triggers
  const incOf = (t, dot = false) => inc(sum, 'damage_+%', dmgTags) + perTotem + perAttr + trigSpell + (spell && out.lifeCost > 0 ? v(sum, 'spell_damage_+%_with_spells_that_cost_life') : 0) + v(sum, `${t}_damage_+%`) + (t !== 'physical' && t !== 'chaos' ? v(sum, 'elemental_damage_+%') + (attack ? v(sum, 'elemental_damage_with_attack_skills_+%') : 0) : 0) + mod(mods, 'INC', dmgMods(t), has(dot));
  const dual = w && weaponStats({ weapon: b.items.offhand });   // a weapon in each hand
  const scale = (t, dot = false) => (1 + v(st, 'active_skill_damage_+%_final') / 100) * (1 + (dual ? v(st, 'active_skill_damage_+%_final_while_dual_wielding') : 0) / 100) * more(fin, 'damage_+%', tags, t) * mod(mods, 'MORE', dmgMods(t), has(dot)) * metaDmg * measured * (1 + rage * (100 + rageEffect) / 1e4)
    * (1 + incOf(t, dot) / 100);
  for (const t of DMG) {
    const [lo, hi] = base[t];
    if (hi) out.hits[t] = [Math.round(lo * mult * scale(t)), Math.round(hi * mult * scale(t))];
    // damage over time of the skill itself (Contagion, burning ground...), per second
    const perMin = st[`base_${t}_damage_to_deal_per_minute`];
    if (perMin) out.dot[t] = perMin / 60 * scale(t, true);
  }
  // Ignite of a hit with fire damage: GameConstants' share of it per second, for its base duration. note: no
  // ignite magnitude or duration modifiers yet (none on the build it was checked with, 163-354.4/s as the game)
  if (out.hits.fire && CHAR['ignite_%_per_second']) out.ignite = { perSecond: out.hits.fire.map(x => x * CHAR['ignite_%_per_second'] / 100), duration: CHAR.ignite_duration_s };
  const types = Object.values(out.hits);
  if (types.length) out.avg = types.reduce((t, [lo, hi]) => t + (lo + hi) / 2, 0);
  // uses per second
  // fired by a totem, its speed counts what totems' attacks get (Totem Attack Speed, Urgent Totems): the game's 1.79 s
  // of Mortar Cannon's grenade is 1.40 x (1 - 5% + 14% ballista + 4% totem + 20% Urgent) x 0.75 x 0.8 x 0.5
  const spTags = byTotem ? [...tags, 'totem'] : tags, spHit = byTotem ? f => f === 'totem' || hit(f) : hit;
  // a support's "increased Speed" adds to the tree's and gear's (Urgent Totems' 20% with the tree's 13%: the game's 1.79 s);
  // and "Totems have X% increased Attack Speed per active Totem" for each (Ancestral Unity's 4%; the game's windows,
  // 16/11: 1.75 s with one, 1.61 s with two right after placing them, as 4 + 4 + Carved Earth's 6% on placing gives).
  // note: "on placing a Totem" buffs not counted (they wear off)
  const speedInc = mod(mods, 'INC', ['Speed'], spHit), speedMods = mod(mods, 'MORE', ['Speed'], spHit);
  // the tree's speed with skills of a kind (Lightning, Elemental, Cold, channelling skills) and, for attacks, while
  // holding a shield, dual wielding, per 25 Dexterity or per 200 Accuracy
  const tagSp = (tags.includes('lightning') ? v(sum, 'attack_and_cast_speed_+%_with_lightning_skills') : 0) + (tags.some(x => x === 'fire' || x === 'cold' || x === 'lightning') ? v(sum, 'attack_and_cast_speed_+%_with_elemental_skills') : 0)
    + (tags.includes('channelling') ? v(sum, 'skill_speed_+%_with_channelling_skills') : 0) + (tags.includes('warcry') ? v(sum, 'warcry_speed_+%') : 0)   // Warcry Speed: its use time
    + (byTotem ? v(sum, attack ? 'totem_skill_attack_speed_+%' : 'totem_skill_cast_speed_+%') : 0);   // attacks / spells used by totems
  const per = attack && (v(sum, 'attack_speed_+%_per_25_dex') || v(sum, 'attack_speed_+%_per_200_accuracy_rating')) && character(b, sum);
  const atkSp = tagSp + (/^(Shields|Bucklers)$/.test(classOf(b.items?.offhand)) ? v(sum, 'attack_speed_+%_while_holding_shield') : 0) + (dual ? v(sum, 'attack_speed_while_dual_wielding_+%') : 0)
    + (per ? Math.floor((per.attrs?.dex || 0) / 25) * v(sum, 'attack_speed_+%_per_25_dex') + Math.floor((per.accuracy || 0) / 200) * v(sum, 'attack_speed_+%_per_200_accuracy_rating') : 0);
  if (attack && (w || shield || flaskThrow)) out.speed = (shield ? 1000 / (d.cast_time_ms || 1000) : flaskThrow ? 1000 / st.main_hand_base_weapon_attack_duration_ms : w.attacks_per_second) * (1 + (inc(sum, 'attack_speed_+%', spTags) + v(sum, 'attack_and_cast_speed_+%', 'skill_speed_+%') + speedInc + perTotemSpeed + atkSp) / 100) * (1 + v(st, 'active_skill_attack_speed_+%_final') / 100) * (1 + (dual ? v(st, 'active_skill_attack_speed_+%_final_while_dual_wielding') : 0) / 100) * more(fin, 'attack_speed_+%', tags) * speedMods * metaSpeed;
  else if (d.cast_time_ms) out.speed = 1000 / d.cast_time_ms * (1 + (inc(sum, 'cast_speed_+%', tags) + v(sum, 'attack_and_cast_speed_+%', 'skill_speed_+%') + speedInc + tagSp + (tags.includes('cold') ? v(sum, 'cast_speed_for_cold_skills_+%') : 0)) / 100) * more(fin, 'cast_speed_+%', tags) * speedMods;
  if (byTotem && out.speed) out.speed *= 1 + v(sum, 'ascendency_tactician_totem_skill_speed_+%_final') / 100;   // Tactician's Cannons, Ready!: more skill speed of totems' skills
  // crossbow: the clip's bolts (gem + Double Barrel's), fired then reloaded, as PoB2's CalcOffence: the weapon's reload time
  // over (1 + increased reload and attack speed) x the "more" ones; bolts a shot keeps (Ammo Conservation) stretch the clip
  const bolts = attack && w?.reload && v(st, 'base_number_of_crossbow_bolts') + v(sum, 'support_double_barrel_number_of_crossbow_bolts_+');
  if (bolts && out.speed) {
    const reloadMore = Object.entries({ ...finals, 'active_skill_reload_speed_+%_final': v(st, 'active_skill_reload_speed_+%_final') })
      .reduce((m, [k, x]) => { const sign = k.match(/reload_speed_([+-])%_final$/)?.[1]; return sign ? m * (1 + (sign === '-' ? -x : x) / 100) : m; }, 1);
    const reload = w.reload / ((1 + (inc(sum, 'attack_speed_+%', spTags) + v(sum, 'attack_and_cast_speed_+%', 'skill_speed_+%', 'reload_speed_+%') + speedInc + atkSp) / 100) * speedMods * reloadMore);
    const keep = Math.min(v(sum, 'crossbow_attack_%_chance_to_not_consume_ammo') / 100, 1), shots = bolts / (1 - keep);
    out.clip = { bolts, reload, keep, fire: out.speed };   // fire: shots per second between reloads
    out.speed = keep >= 1 ? out.speed : shots / (shots / out.speed + reload);
  }
  // cooldown: the gem's own (quality), the tree's and gear's for its tags (grenade_skill_cooldown_speed_+%) and the
  // supports' recovery rate (Payload -70%); uses: the gem's plus "+N Cooldown Uses" (grenade_skill_cooldown_count_+).
  // Uhtred's Constellation adds its uses to a skill that is not instant
  // The game's window: Cluster Grenade 10 s at -9% (16 + 45 - 70) = 10.99 s, 2 uses
  if (st._cooldown_ms) {
    out.cooldown = st._cooldown_ms / (1 + (v(st, 'base_cooldown_speed_+%') + inc(sum, 'cooldown_speed_+%', tags) + mod(mods, 'INC', ['CooldownRecovery'], hit)) / 100) / mod(mods, 'MORE', ['CooldownRecovery'], hit);
    // Second Wind: less recovery rate, twice the uses (support_double_number_of_cooldown_uses)
    out.uses = ((st._stored_uses || 1) + inc(sum, 'cooldown_count_+', tags) + (d.cast_time_ms ? v(sum, 'support_added_cooldown_count_if_not_instant') : 0)) * ((g.supports || []).some(n => SK.skills[n]?.flags?.includes('support_double_number_of_cooldown_uses')) ? 2 : 1);
    out.useTime = out.speed && 1 / out.speed;   // the game's "Attack time", apart from the cooldown
    if (out.speed) out.speed = Math.min(out.speed, 1000 / out.cooldown);
  }
  // crit: base chance from weapon / skill row, increased by tree and gear; +100% damage bonus is the game's base
  const baseCrit = (shield || flaskThrow) && st._attack_crit ? st._attack_crit / 100 : attack && w ? w.crit : first(spell && sum.base_spell_critical_strike_chance_override_permyriad ? sum.base_spell_critical_strike_chance_override_permyriad / 100 : null, st._spell_crit != null ? st._spell_crit / 100 : null, st.base_critical_strike_chance != null ? st.base_critical_strike_chance / 100 : null);
  if (baseCrit != null) {
    out.crit = mods.some(m => m[0] === 'NeverCrit') ? 0 : Math.min(sum['maximum_critical_strike_chance_is_%_from_support_garukhans_resolve'] || 100, baseCrit * (1 + (inc(sum, 'critical_strike_chance_+%', tags) + mod(mods, 'INC', ['CritChance'], hit)) / 100) * mod(mods, 'MORE', ['CritChance'], hit));
    out.critBonus = (100 + inc(sum, 'critical_strike_multiplier_+', tags) + (sum['critical_damage_+%_per_50_current_life'] ? Math.floor(character(b, sum).life / 50) * sum['critical_damage_+%_per_50_current_life'] : 0) + mod(mods, 'INC', ['CritMultiplier'], hit) + mod(mods, 'BASE', ['CritMultiplier'], hit)) * mod(mods, 'MORE', ['CritMultiplier'], hit) * (1 + v(sum, 'infernalist_critical_strike_multiplier_+%_final') / 100);   // Infernalist: more
  }
  // supports' damage and crit that count only under a condition (PoB2's tags, pob2.py): the 3D scene checks it on each hit
  // (scene.js when()). w: what one point of it is worth to that damage type, 1 for "more", 1 / (1 + the skill's
  // increased) for "increased"; cap: the support's own most (Dauntless 45%, Burgeon 40%) or most stacks (Arakaali's 40).
  // The "more damage against a state" calc.js already reads (ailments: vs, consume) are not repeated here
  const critInc = inc(sum, 'critical_strike_chance_+%', tags) + mod(mods, 'INC', ['CritChance'], hit);
  out.incW = Object.fromEntries(DMG.map(t => [t, 1 / (1 + incOf(t) / 100)]));   // what one point of increased damage is worth per type
  const critW = 1 / (1 + critInc / 100), cbW = 100 / (out.critBonus || 100);   // what one point of increased crit chance / crit damage bonus is worth
  out.when = (g.supports || []).flatMap(n => (SK.supports?.[n]?.mods || []).map(m => [m, SK.skills[n]?.constant || {}]))
    .filter(([[name, kind, , fl, cond, stat]]) => Array.isArray(cond) && /^(?:(?:Physical|Elemental)?Damage|CritChance|CritMultiplier)$/.test(name) && /^(?:MORE|INC)$/.test(kind)
      && fl.every(hit) && !/consume_enemy_|damage_\+%_final_(?:vs|against)_\w+_enemies$/.test(stat))
    .map(([[name, kind, val, , cond0, stat], c]) => {
      const secs = +stat.match(/past_(\d+)_seconds/)?.[1] || undefined, cond = cond0.map(x => ({ ...x, secs }));   // Pursuit III: "in the past 2 seconds"
      const types = name === 'PhysicalDamage' ? ['physical'] : name === 'ElementalDamage' ? ['fire', 'cold', 'lightning'] : DMG;
      // PoB2's limit: on the total % ("limitTotal": Dauntless 45, Burgeon 40, Arakaali's 40; Inexorable Critical II's own per stat) or on the stacks (Culmination's 10)
      const lim = c[stat.replace(/_per_\w+$/, '_cap')] ?? Object.entries(c).find(([k]) => /_cap$|max(?:imum)?_(?:number_of_)?(?:\w+_)?stacks$/.test(k))?.[1], total = cond.some(x => x.limitTotal || x.limitNegTotal);
      return { cond, val, cap: total ? lim : undefined, stacks: total ? undefined : lim, what: /Damage$/.test(name) ? 'damage' : name === 'CritChance' ? 'crit' : 'critBonus',
        w: /Damage$/.test(name) ? Object.fromEntries(types.map(t => [t, kind === 'MORE' ? 1 : out.incW[t]])) : kind === 'MORE' ? 1 : name === 'CritChance' ? critW : cbW };
    });
  const per5 = v(sum, 'critical_strike_chance_+%_per_5_rage');   // Prototype Seventeen: increased crit per 5 Rage
  if (per5) out.when.push({ cond: [{ type: 'Multiplier', var: 'Rage', div: 5 }], val: per5, what: 'crit', w: critW });
  // the tree's and gear's increased damage against an enemy in a state ("attack_damage_+%_vs_maimed_enemies",
  // "hit_damage_+%_vs_chilled_enemies"...), for the skills its prefix fits; the scene checks the state on each hit
  for (const [s, cv] of Object.entries(VS_STATE)) for (const sep of ['vs', 'against']) {
    const val = inc(sum, `damage_+%_${sep}_${s}`, [...dmgTags, 'hit']), cond = [{ type: 'ActorCondition', actor: 'enemy', var: cv }];
    if (val) out.when.push({ cond, val, what: 'damage', w: out.incW });
    // and its critical hit chance / damage bonus ("critical_strike_chance_+%_vs_shocked_enemies")
    const cc = inc(sum, `critical_strike_chance_+%_${sep}_${s}`, tags), cb = inc(sum, `critical_strike_multiplier_+_${sep}_${s}`, tags);
    if (cc) out.when.push({ cond, val: cc, what: 'crit', w: critW });
    if (cb) out.when.push({ cond, val: cb, what: 'critBonus', w: cbW });
  }
  // and while you are in a state ("attack_damage_+%_while_surrounded", "melee_damage_+%_when_on_full_life")
  for (const [s, cv] of Object.entries(WHILE)) {
    const val = inc(sum, `damage_+%_${s}`, [...dmgTags, 'hit']), cond = [{ type: 'Condition', var: cv }];
    if (val) out.when.push({ cond, val, what: 'damage', w: out.incW });
    // of a type ("fire_damage_+%_while_ignited", "elemental_damage_+%_if_enemy_chilled_recently"): that type's damage only
    for (const ty of [...DMG, 'elemental']) {
      const x = v(sum, `${ty}_damage_+%_${s}`);
      if (x) out.when.push({ cond, val: x, what: 'damage', w: Object.fromEntries(SRC[ty].map(t => [t, out.incW[t]])) });
    }
  }
  if (sum['titan_damage_+%_final_against_heavy_stunned_enemies']) out.when.push({ cond: [{ type: 'ActorCondition', actor: 'enemy', var: 'HeavyStunned' }], val: sum['titan_damage_+%_final_against_heavy_stunned_enemies'], what: 'damage', w: Object.fromEntries(DMG.map(t => [t, 1])) });   // Titan's Crushing Impacts: more
  for (const [k, what, cv, en] of CRIT_WHILE) if (sum[k]) out.when.push({ cond: [en ? { type: 'ActorCondition', actor: 'enemy', var: cv } : { type: 'Condition', var: cv }], val: sum[k], what,
    w: what === 'crit' ? critW : cbW });
  // the build's penetration of the enemy's elemental resistances, by its hits (the supports', the tree's); the attacks' own.
  // note: not counted "while Shapeshifted" (the scene has none) nor the weapon's local penetration
  out.pen = Object.fromEntries(['fire', 'cold', 'lightning'].map(e => [e, v(sum, `base_reduce_enemy_${e}_resistance_%`, 'reduce_enemy_elemental_resistance_%', 'base_penetrate_elemental_resistances_%')
    + (attack ? v(sum, 'base_attack_damage_penetrates_elemental_resist_%') : 0)]));
  if (d.totem && d.cast_time_ms) out.placeTime = d.cast_time_ms / 1000 / (1 + v(sum, 'summon_totem_cast_speed_+%') / 100);   // placing the totem: the gem's cast time, faster with totem placement speed
  out.projSpeed = 1 + (v(sum, 'base_projectile_speed_+%') + (spell ? v(sum, 'spell_skill_projectile_speed_+%') : 0) + (tags.includes('crossbow') ? v(sum, 'projectile_speed_+%_with_crossbow_skills') : 0)) / 100;   // increased projectile speed (the scene's projectiles)
  if (sum['lightning_penetration_%_while_on_low_mana']) out.when.push({ cond: [{ type: 'Condition', var: 'LowMana' }], val: sum['lightning_penetration_%_while_on_low_mana'], what: 'pen', el: 'lightning' });
  // "increased Spell Damage if you've consumed an Elemental Infusion Recently"
  const infSpell = spell ? v(sum, 'spell_damage_+%_if_have_consumed_infusion_recently') : 0;
  if (infSpell) out.when.push({ cond: [{ type: 'Condition', var: 'ConsumedInfusionRecently' }], val: infSpell, what: 'damage', w: out.incW });
  // the rules of the skill's other parts (its second hit, the explosion...) and the on / off rules of the gem and its
  // supports (never_freeze, always_ignite, base_consume_enemy_shock_on_hit: available.py)
  const flags = new Set([...(d.flags || []), ...(g.supports || []).flatMap(n => SK.skills[n]?.flags || [])]);
  const part = out.part = { ...(d.part || {}), ...(d.part_levels?.[st._level] || {}) };   // the skill's other part's stats (Supercharged Slam's Aftershocks)
  // (a 0 the main part carries for a stat of the other part does not hide it: Falling Thunder's damage per power charge)
  out.ail = ailments({ ...part, ...Object.fromEntries(Object.entries(st).filter(([k, x]) => x || !(k in part))) }, sum, Object.fromEntries(Object.entries(finals).filter(([k]) => !twice.has(k))), own, flags);   // a stat with _final inside its name (…_final_vs_frozen_enemies) once, already in sum
  if (attack && w?.onHit) { const H = w.onHit; out.ail.bleed += H.bleed; out.ail.maim += H.maim; out.ail.maimCrit = H.maimCrit; }   // the weapon's own chances
  // "Attacks ... Maim on Hit": none for other skills; a skill whose own description says its hits Maim (Spearfield,
  // Artillery Ballista: "[Maim|Maiming]"; not one that Maims with its final hit only, Rapid Assault, nor a minion's)
  if (!attack) out.ail.maim = out.ail.maimPoisoned = out.ail.maimBleeding = 0;
  if (/\[Maim/.test(G.description || '') && !/final[^.]*\[Maim/.test(G.description) && !own.includes('minion')) out.ail.maim = 100;
  const curse = gt.includes('AppliesCurse'), mark = gt.includes('Mark');
  out.curse = curse ? curseOf(st, sum, finals) : null;
  out.mark = mark ? markOf(st, 1 + (v(sum, 'mark_effect_+%') + (st['mark_effect_+%'] || 0)) / 100) : null;
  // what the 3D scene draws from the gem itself, with what supports and the tree add: chains, projectiles, the time a
  // grenade or bomb takes to go off, a curse's delay and length, a totem's life. Skill effect duration: the increased
  // ones added (curses' and marks' own too), times each support's more (Persistence, Swift Affliction, Limit...), as PoB2
  // (SkillStatMap: Duration INC / MORE) and the game texts say; detonation and totem time their own increased
  const sec = (k, m = 1) => st[k] ? st[k] / 1000 * m : null, both = (...k) => v(st, ...k) + v(sum, ...k);
  const durMore = Math.max(0, 1 + (both('skill_effect_duration_+%') + (curse ? v(sum, 'base_curse_duration_+%', 'curse_skill_effect_duration_+%') : 0)
    + (mark ? v(sum, 'mark_skill_duration_+%') : 0)) / 100) * (1 + (own.includes('plant') ? v(sum, 'plant_skill_effect_duration_+%_final_from_archon_of_nature') : 0) / 100) * Object.entries(finals).reduce((m, [k, x]) => /skill_effect(?:_and_damaging_ailment)?_duration_\+%_final$/.test(k) ? m * (1 + x / 100) : m, 1);
  out.shape = { chains: both('number_of_chains') * (1 + (finals['support_dominus_grasp_chain_count_+%_final'] || 0) / 100),   // Dominus' Grasp: 100% more times
    ground: 1 + v(sum, 'ground_effect_duration_+%') / 100,   // Persistent / Lasting Ground
    projectiles: st.base_number_of_projectiles ? st.base_number_of_projectiles + both('number_of_additional_projectiles') : null,
    detonate: sec('base_skill_detonation_time', (1 + v(sum, 'grenade_fuse_duration_+%', 'skill_detonation_time_+%') / 100) * (1 + (finals['support_fast_forward_detonation_time_+%_final'] || 0) / 100)), curseDelay: sec('curse_delay_duration_ms'),
    duration: sec('base_skill_effect_duration', durMore), totem: sec('base_totem_duration', 1 + v(sum, 'totem_duration_+%') / 100),
    // Pierce, Fork and Chain as PoB2 counts them (CalcOffence, SkillStatMap) and the glossary orders them: a projectile
    // pierces, else forks (the first time it hits), else chains; chaining reaches 6 m from a projectile, 4 m otherwise
    // (Orb of Storms' own distance), more with increased chaining range. The less damage after piercing or forking
    pierce: flags.has('cannot_pierce') ? 0 : flags.has('always_pierce') ? Infinity : both('projectile_base_number_of_targets_to_pierce')
      + (gt.includes('Bow') ? both('arrow_base_number_of_targets_to_pierce') : 0) + both('base_chance_to_pierce_%', 'pierce_%') / 100,
    forks: flags.has('projectiles_cannot_fork') || !(flags.has('projectiles_fork') || both('projectiles_fork')) ? 0 : Math.min(2, 1 + both('number_of_additional_forks_base')),
    chainRange: (st.arc_chain_distance ? st.arc_chain_distance / 10 : gt.includes('Projectile') ? 6 : 4) * (1 + both('chaining_range_+%') / 100),
    pierceMore: finals['support_pierce_projectile_damage_+%_final_if_pierced_enemy'] || 0, perPierce: finals['support_pierce_damage_+%_final_per_pierced_target'] || 0,
    forkMore: finals['support_fork_forked_projectile_damage_+%_final'] || 0, bolts: sec('orb_of_storms_base_bolt_frequency_ms'), maxBolts: st.orb_of_storms_maximum_number_of_hits || null,
    extraTargets: st.lightning_arrow_maximum_number_of_extra_targets || 0, split: both('projectile_number_to_split'),
    // reach, in the game's tenths of a metre: a melee attack's is its weapon's range plus "+0.2 metres to Melee Strike
    // Range" (melee_range_+); a dashing strike's its own (base_melee_dash_range), a blink's its distance
    reach: tags.includes('melee') && w ? (w.range + both('melee_range_+')) / 10 : null, dash: st.base_melee_dash_range ? st.base_melee_dash_range / 10 : null,
    travel: (st.blink_travel_distance || st.black_powder_blitz_travel_distance || 0) / 10 || null,
    wall: st.wall_maximum_length ? st.wall_maximum_length / 10 * (1 + both('wall_maximum_length_+%') / 100) : null };   // "Wall length is {0} metres"; Ahn's Citadel's increased
  // Leech (keywords.json Life / Mana Leech): a share of the hit's damage, in % (the stats are permyriad), recovered over one
  // second: of an attack's physical damage (supports, gear, the weapon's own), of a spell's whole damage; increased leech
  // amount and leech rate; Life Leech III's leech is not removed at full life
  const leechOf = r => {
    const phys = attack ? (both(`base_${r}_leech_from_physical_attack_damage_permyriad`) + (w?.leech?.[r] || 0)) / 100 : 0;
    const all = spell ? both(`base_${r}_leech_from_all_spell_damage_permyriad`) / 100 : 0;
    // the Amazon's Mystic Harvest: life leech of the elemental damage too; Acolyte of Chayula's Sap of Nightmares: leech of the chaos damage too
    const of = ['physical', ...(r === 'life' && sum.life_leech_also_recovers_based_on_elemental_damage_types ? ['fire', 'cold', 'lightning'] : []), ...(sum.leech_also_recovers_based_on_chaos_damage_as_well ? ['chaos'] : [])];
    return phys || all ? { phys, of, all, more: 1 + v(sum, `base_${r}_leech_amount_+%`) / 100, rate: 1 + v(sum, `base_${r}_leech_rate_+%`) / 100 } : null;
  };
  out.enrage = v(sum, 'support_rageforged_consumes_X_rage_to_enrage_skill_use');   // Rageforged: Rage spent on a use to enrage it
  // what the skill's hits and uses do with Rage, charges and Combo (its supports' stats; the tree's Rage gains are
  // the character's: rageOf). onHit: Rage on melee hit (Rage I-III; Medved's Felling: % of maximum), endurance charges
  // on breaking armour, on heavy stunning, on a perfectly timed hit; crit per 5 Rage and Rage lost on crit (Prototype
  // Seventeen). onUse: a charge consumed for more skill speed (Ferocity), crit chance (Potential), armour break (Tumult),
  // curse duration (Abiding Hex), all endurance charges for life (Rally); the chance to keep them (Perpetual Charge) or
  // double the benefit (Heightened Charges), life lost per 5 Rage (Medved's). more: an extra charge (Charge Profusion)
  // (read from the supports' own stats: PoB2 reads some as conditional mods, which leave them out of sum)
  const sup = k => (g.supports || []).reduce((t, n) => t + (SK.skills[n]?.constant?.[k] || 0), 0), all2 = k => sup(k) + v(treeGear, k);
  out.onHit = { rage: sup('gain_x_rage_on_melee_hit'), ragePct: all2('gain_x%_of_maximum_rage_on_melee_hit'),
    breakEndurance: all2('chance_to_gain_endurance_charge_on_armour_break_%'), stunEndurance: all2('chance_to_gain_endurance_charge_on_heavy_stunning_non_unique_enemy_%'),
    stunEnduranceUnique: all2('gain_x_endurance_charges_on_heavy_stunning_unique_enemy'), perfectEndurance: all2('chance_to_gain_endurance_charge_on_perfect_timing_hit_%'),
    loseRageOnCrit: all2('lose_%_of_maximum_rage_on_dealing_critical_strike') };
  out.onUse = { speed: all2('skill_consume_frenzy_charge_to_gain_skill_speed_+%_final'), crit: all2('skill_consume_power_charge_to_gain_critical_strike_chance_+%_final'),
    breakPct: all2('skill_consume_frenzy_charge_to_armour_break_for_%_of_physical_damage'), curse: all2('support_consume_power_charge_to_gain_curse_duration_+%_final'),
    lifePerEndurance: all2('consume_endurance_charges_on_use_to_recover_%_maximum_life_per_charge'), keep: all2('charge_skip_consume_chance_%'),
    double: all2('chance_%_to_double_effect_of_removing_charges'), lifePer5Rage: all2('lose_x%_of_life_per_5_rage_on_supported_skill_use'),
    lifePerCooldown: all2('restore_%_life_on_skill_use_per_1000_ms_cooldown') };
  // buffs of damage gained as extra of an element for a while, and life on kill (Cannibalism)
  const buffOf = (name, pct, el, ms, on, attack) => (g.supports || []).includes(name) && { name, pct: sup(pct), el, time: sup(ms) / 1000, on, attack };
  out.gains = [...['Ice Bite I', 'Ice Bite II'].map(n => buffOf(n, 'support_ice_bite_buff_grant_%_added_cold_attack_damage', 'cold', 'support_ice_bite_base_buff_duration', 'freeze')),
    buffOf('Innervate', 'support_innervate_buff_grant_%_added_lightning_attack_damage', 'lightning', 'support_innervate_buff_base_duration_ms', 'shockKill'),
    buffOf('Blazing Critical', 'support_blazing_crits_gain_%_fire_damage_with_attacks_on_critical_hit', 'fire', 'support_blazing_crits_base_duration_ms', 'crit', true)].filter(Boolean);
  out.lifeOnKill = sup('support_cannibalism_recover_%_maximum_life_on_kill');
  // the skills its supports set off (Coursing Current, Static Shocks, Electromagnetism, Volcanic Eruption...), at this
  // gem's level (PoB2: granted skills inherit the level of the skill the support is on), with the tree's and gear's modifiers
  // Base damage that is not in the skill's levels: Elemental Discharge's, a share of your Intelligence (PoB2's PercentStat
  // Int); Mana Flare's (of the mana it consumes), Voltaic Fulmination's (of the enemy's maximum life), Battershout's (of its
  // broken armour), Haemocrystals' (of the bleeding consumed) and the death explosions' (of the monster's life) known only in the scene, so a base of 100 there to scale
  const intel = attributes(treeGear, b.asc).int, unit = el => ({ [`spell_minimum_base_${el}_damage`]: 100, [`spell_maximum_base_${el}_damage`]: 100 });
  const baseOf = c => ({ ...Object.fromEntries(Object.entries(c).flatMap(([k, x]) => { const m = k.match(/^spell_(minimum|maximum)_base_(\w+)_damage_as_%_of_intelligence$/); return m ? [[`spell_${m[1]}_base_${m[2]}_damage`, x * intel / 100]] : []; })),
    ...(c['support_mana_flare_%_of_current_mana_consumed'] || c['support_burning_runes_base_fire_damage_equal_to_%_maximum_mana'] ? unit('fire') : {}), ...(c['triggered_by_support_electrocute_lineage_%'] ? unit('lightning') : {}),
    ...(c['support_battershout_physical_damage_equal_to_%_of_broken_armour'] || c['support_haemocrystals_physical_damage_equal_to_%_of_remaining_bleed_damage'] || c['support_bone_shrapnel_physical_damage_equal_to_%_monster_life'] ? unit('physical') : {}),
    ...(c['corpse_explosion_monster_life_%'] || c.corpse_explosion_monster_life_permillage_fire ? unit('fire') : {}), ...(c['base_physical_damage_equal_to_%_of_totem_life'] ? unit('physical') : {}), ...(c['support_frozen_spite_%_enemy_maximum_life_dealt_as_cold_damage'] ? unit('cold') : {}) });
  out.totemLife = totem(g, treeGear)?.life;   // Tawhoa's Tending's explosion
  // the parts an earthen object deals when it shatters (Earthshatter's spike, Forge Hammer's fissures) or a plant when it
  // bursts (Toxic Growth's Pustules), as the skill
  if (d.parts && !g.part) out.parts = Object.fromEntries(Object.keys(d.parts).map(p => [p, skill({ ...g, part: p }, b, treeGear)]));
  out.trig = (g.supports || []).flatMap(n => Object.keys(SK.skills[n]?.triggers || {}).filter(id => SK.skills[id]?.triggered_by)
    .map(id => maimsBy(n, { ...skill({ name: id, level: g.level, supports: [], base: baseOf(SK.skills[id].constant || {}) }, b, treeGear), id, support: SK.skills[n].constant || {}, wardCost: SK.skills[id].levels?.[g.level]?._cost?.Ward || 0,
      parts: Object.fromEntries(Object.keys(SK.skills[id].parts || {}).map(p => [p, skill({ name: id, level: g.level, supports: [], part: p }, b, treeGear)])) })));   // Runeforged Blades: its cost in Runic Ward; its other parts (Catalysing Discharge per element)
  // the skills supports set off on a kill (Fiery Death, Bone Shrapnel, Frozen Spite): their own stats and the support's
  out.onKill = (g.supports || []).flatMap(n => Object.values(SK.skills[n]?.triggers || {}).map(t => ({ ...SK.skills[n].constant, ...t })));
  out.more = { one: all2('chance_to_gain_1_more_charge_%'), random: all2('chance_to_gain_1_more_random_charge_%') };
  // Combo (keywords.json): built by Strikes, lost after the skill's delay without gaining any (Flow: slower), what it
  // needs to be used (Combo Finisher), the chance of one more (Practiced Combo)
  out.combo = { strike: own.includes('strike') || attack && !!all2('can_gain_combo_from_any_attack_hit'), more: all2('additional_combo_gain_on_hit'), esSooner: -all2('add_X_ms_to_energy_shield_recharge_delay_per_combo_spent') / 1000, decay: all2('base_combo_stacks_decay_delay_ms') / 1000 / Math.max(.01, 1 + all2('combo_falloff_speed_+%') / 100),
    need: all2('support_combo_finisher_required_number_of_combo_stacks'), extra: all2('additional_combo_gain_chance_%') };
  out.leech = { life: leechOf('life'), mana: leechOf('mana'), keep: !!v(sum, 'life_leech_from_source_not_removed_at_full_life') };
  // a minion gem: the hits are its minion's (the DPS one minion's)
  // a support's skill that creates a minion (Living Lightning, Skittering Stone): the game's monster of its name summoned by the player
  const mid = SK.minions[g.name]?.[0] || (d.types?.includes('CreatesMinion') ? ENEMIES.find(m => m.en === d.name && m.id.endsWith('PlayerSummoned'))?.id : null);
  // a Companion also takes the build's "Companions have..." stats, as their "Minions have..." twin (damage, life, attack
  // speed, area, resistances). note: the ones with no such twin (damage as chaos / cold, movement speed) are not counted
  const msum = mid && GEM[g.name]?.types?.includes('Companion') ? companion(sum) : sum;
  // Spirit Walker's The Catha's Balance: Companions gain added Attack damage equal to a share of your main hand Weapon's damage
  const cw = msum !== sum && v(sum, 'weapon_damage_%_granted_to_companions'), W = cw && weaponStats(b.items);
  const wAdd = W ? Object.fromEntries(DMG.filter(t => W[t]).map(t => [t, W[t].map(x => x * cw / 100)])) : null;
  const mn = out.minion = mid ? minionOf(st, msum, fin, mid, attributes(sum, b?.asc), wAdd) : null;
  out.minionLife = mid ? minionLife(st, msum, mid, finals) : null;
  if (mn) {
    const ty = Object.values(mn.hits);
    Object.assign(out, { hits: mn.hits, speed: mn.speed, crit: mn.crit, critBonus: mn.critBonus, reason: null, avg: ty.length ? ty.reduce((t, [lo, hi]) => t + (lo + hi) / 2, 0) : null });
  }
  if (flags.has('global_cannot_crit')) out.crit = 0;
  if (out.avg != null && out.speed) {
    const c = (out.crit || 0) / 100, cb = (out.critBonus || 0) / 100, IC = c > 0 && c < 1 && sum['oracle_hits_eventually_crit_with_critical_strike_multiplier_+%_final_per_failed_roll'];
    // Oracle's Inevitable Critical Hits: the hits that fail re-roll until they crit, its less bonus per re-roll (as the scene: up to 99 re-rolls)
    let k = 1 + c * cb;
    if (IC) { k = c * (1 + cb); let q = 1 - c; for (let n = 1; n < 99; n++, q *= 1 - c) k += q * c * (1 + cb * Math.max(0, 1 + IC * n / 100)); k += q * (1 + cb * Math.max(0, 1 + IC * .99)); }
    out.dps = out.avg * k * out.speed;
  } else if (!out.reason && out.avg == null && !Object.keys(out.dot).length) out.reason = 'This skill does not deal direct damage';
  return out;
}

// What the hits of a skill do with ailments, from the gem's own stats, its supports' and the tree's and gear's (sum): base
// chances (bleeding and poison need one: the game's glossary), "increased" (inc) and "more" (more) chance, buildup, effect
// and duration. The 3D scene rolls them against each enemy's thresholds (scene.js). Conditional ones (vs marked, wet,
// electrocuted enemies...) are left out.
// a support's triggered skill whose hits the support's description says Maim (Brambleslam's brambles)
const maimsBy = (n, T) => { if (/\[Maim/.test(GEM[n]?.description || '') && T.ail) T.ail = { ...T.ail, maim: 100 }; return T; };
function ailments(st, sum, finals, tags, flags = new Set()) {
  const all = k => (st[k] || 0) + (sum[k] || 0) + (finals[k] || 0), F = k => flags.has(k);
  const keys = [...new Set([...Object.keys(st), ...Object.keys(sum), ...Object.keys(finals)])];
  // more damage when consuming a state (Glacial Cascade, Biting Frost), against one (Siege Cascade vs immobilised), per
  // charge spent (Spiral Volley): [state, %, unique-only / non-unique-only / any]
  const pinAll = F('base_all_damage_can_pin') || all('base_all_damage_can_pin') > 0 || tags.includes('projectile') && all('all_projectile_damage_can_pin') > 0 || keys.some(k => /pins_as_though_dealt_damage/.test(k));
  const consume = {}, vs = [], STATE_OF = { fully_broken_armour: 'armour', heavy_stunned: 'stun', frozen: 'freeze', bleeding: 'bleed', poisoned: 'poison',
    ignited: 'ignite', shocked: 'shock', chilled: 'chill', electrocuted: 'electrocute', pinned: 'pin', immobilised: 'immobilised', cursed: 'curse', marked: 'mark' };
  for (const k of keys) {
    let m = k.match(/consume_enemy_(freeze|shock|ignite|fully_broken_armour)_to_gain_(damage|hit_damage_stun_multiplier)(?:_against_(unique|non_unique))?_\+%(?:_final)?$/);
    if (m) { const c = consume[STATE_OF[m[1]] || m[1]] ||= {}, key = m[2] === 'damage' ? m[3] || 'any' : 'stun'; c[key] = (c[key] || 0) + all(k); continue; }
    m = k.match(/damage_\+%_final_(?:vs|against)_(\w+?)(_unique|_non_unique)?_enemies$/);
    if (m && STATE_OF[m[1]]) vs.push([STATE_OF[m[1]], all(k), m[2] ? m[2] === '_unique' : null, /physical/.test(k)]);
  }
  for (const s of ['freeze', 'shock']) if (F(`base_consume_enemy_${s}_on_hit`)) consume[s] ||= {};
  const sumOf = re => keys.filter(k => re.test(k)).reduce((t, k) => t + all(k), 0);
  const never = a => F('never_' + a) || F('active_skill_never_freeze_shock_ignite') && ['freeze', 'shock', 'ignite'].includes(a);
  const skip = /mark_|debuff|_from_ot|from_current_poise|_vs_|against_|_per_|_when_|_while_|_if_|consume/;
  const more = end => keys.filter(k => !(k in sum) || k in st || k in finals).filter(k => (typeof end === 'string' ? k.endsWith(end) : end.test(k)) && !skip.test(k)).reduce((m, k) => m * (1 + all(k) / 100), 1);
  const scale = (incs, end) => (1 + incs.reduce((t, k) => t + all(k), 0) / 100) * more(end);
  const FA = 1 + all('damaging_ailments_deal_damage_+%_faster') / 100, FB = FA + all('faster_burn_%') / 100;   // Fast Acting Toxins (all three), Burnout, Searing Heat (ignites): damaging ailments deal their damage faster (more a second, over a shorter time)
  // Tactician's Suppressing Fire: more Immobilisation buildup (freeze, electrocute, pin)
  const SF = 1 + all('ascendancy_tactician_suppressing_fire_hit_damage_immobilisation_multiplier_+%_final') / 100;
  const melee = tags.includes('melee'), proj = tags.includes('projectile');
  return {
    bleed: all('base_chance_to_inflict_bleeding_%'), bleedCrit: all('bleed_on_crit_%'), bleedFull: all('bleed_chance_+%_vs_full_life_enemy'),
    incision: all('apply_X_incision_on_hit'), incEff: all('support_incision_bleeding_effect_+%_final_per_incision_consumed_recently_up_to_30%'), poison: all('base_chance_to_poison_on_hit_%'),
    // Maim on hit (the Maim support, the tree), against poisoned enemies, on fully breaking armour, for a while after Pin ends
    maim: F('global_maim_on_hit') || all('global_maim_on_hit') ? 100 : all('maim_on_hit_%'), maimCrit: false,
    maimPoisoned: all('maim_on_hit_%_vs_poisoned_enemies'), maimBleeding: all('maim_bleeding_enemies_on_hit_%'),
    maimMore: all('spearfield_maim_slows_an_additional_%'),   // Spearfield's maims slow more
    maimOnBreak: all('maim_enemy_on_full_armour_break') > 0, maimAfterPin: all('enemies_are_maimed_for_x_seconds_after_becoming_unpinned'),
    igniteChance: scale(['ignite_chance_+%'], /(ignite_chance|chance_to_ignite)_\+%_final$/), shockChance: scale(['shock_chance_+%'], /(shock_chance|chance_to_shock)_\+%_final$/) * more(/shock_as_though_damage_\+%_final$/),   // shocks as though dealing more damage (Stormcaller Arrow)
    freeze: scale(['hit_damage_freeze_multiplier_+%', 'hit_damage_immobilisation_multiplier_+%'], 'hit_damage_freeze_multiplier_+%_final') * SF, immob: (1 + all('hit_damage_immobilisation_multiplier_+%') / 100) * SF,   // increased Immobilisation buildup: freeze, electrocute, pin
    // the character's own 50% more from physical and melee hits (character.ot) is added by the scene
    stun: scale(['hit_damage_stun_multiplier_+%', ...(melee ? ['melee_hit_damage_stun_multiplier_+%'] : []), ...(proj ? ['projectile_hit_damage_stun_multiplier_+%'] : [])], 'hit_damage_stun_multiplier_+%_final'),
    // "increased Magnitude of Ailments you inflict" counts for each, of Damaging Ailments for ignite, poison and bleeding, of Non-Damaging ones for shock and chill
    shockEffect: scale(['shock_effect_+%', 'ailment_effect_+%', 'non_damaging_ailment_effect_+%'], 'shock_effect_+%_final') * (1 + all('stormweaver_shock_effect_+%_final') / 100), chillEffect: scale(['chill_effect_+%', 'ailment_effect_+%', 'non_damaging_ailment_effect_+%'], 'chill_effect_+%_final') * (1 + all('stormweaver_chill_effect_+%_final') / 100),   // Stormweaver: less
    igniteEffect: scale(['base_ignite_effect_+%', 'ailment_effect_+%', 'base_damaging_ailment_effect_+%'], /(?:ignite|(?<!non_)damaging_ailment)_effect_\+%_final$/) * FB, poisonEffect: scale(['base_poison_effect_+%', 'ailment_effect_+%', 'base_damaging_ailment_effect_+%'], /(?:poison|(?<!non_)damaging_ailment)_effect_\+%_final$/) * FA,   // Shattering Spite: all three
    bleedEffect: scale(['base_bleeding_effect_+%', 'ailment_effect_+%', 'base_damaging_ailment_effect_+%'], /(?:bleeding|(?<!non_)damaging_ailment)_effect_\+%_final$/) * FA,
    shockTime: scale(['shock_duration_+%', 'ignite_shock_chill_duration_+%', 'base_elemental_status_ailment_duration_+%'], 'shock_duration_+%_final'),
    chillTime: scale(['chill_duration_+%', 'ignite_shock_chill_duration_+%', 'base_elemental_status_ailment_duration_+%'], 'chill_duration_+%_final'),
    freezeTime: scale(['freeze_duration_+%', 'base_elemental_status_ailment_duration_+%'], 'freeze_duration_+%_final'),
    igniteTime: scale(['ignite_duration_+%', 'ignite_shock_chill_duration_+%', 'base_elemental_status_ailment_duration_+%'], 'damaging_ailment_duration_+%_final') / FB,
    bleedTime: scale(['base_bleed_duration_+%'], 'damaging_ailment_duration_+%_final') / FA, poisonTime: scale(['base_poison_duration_+%'], /(?:damaging_ailment|_poison)_duration_\+%_final$/) / FA * (1 + all('pathfinder_poison_duration_+%_final') / 100),   // Overwhelming Toxicity's less (the tree's)   // Escalating Poison's less
    // Armour Break: a flat amount per hit and / or a share of the physical damage dealt
    breakFlat: all('apply_X_armour_break_on_hit'), breakPct: all('armour_break_physical_damage_%_dealt_as_armour_break'),
    breakMore: scale(['armour_break_amount_+%'], 'armour_break_amount_+%_final'),
    // what every hit of a player has (character.ot): more heavy stun buildup from physical damage and melee hits, and
    // more Armour Break against normal and magic monsters
    stunPhys: 1 + (CHAR['physical_hit_damage_stun_multiplier_+%_final_from_ot'] || 0) / 100,
    stunMelee: melee ? 1 + (CHAR['melee_hit_damage_stun_multiplier_+%_final_from_ot'] || 0) / 100 : 1,
    breakNormal: 1 + (CHAR['object_inherent_armour_break_amount_+%_final_against_normal_monsters'] || 0) / 100,
    breakMagic: 1 + (CHAR['object_inherent_armour_break_amount_+%_final_against_magic_monsters'] || 0) / 100,
    never: { freeze: never('freeze'), shock: never('shock'), ignite: never('ignite'), stun: F('cannot_stun'), armour: F('cannot_break_armour'), bleed: F('cannot_cause_bleeding') },
    always: { freeze: F('always_freeze'), shock: F('always_shock'), ignite: F('always_ignite'), stun: F('always_stun') },
    alwaysHit: F('global_always_hit'),
    // Impale: its chance on hit (any hit, attacks', spells'), its magnitude more and how many it applies; whether the skill extracts them
    impale: { chance: all('impale_on_hit_%_chance') + all(tags.includes('attack') ? 'attacks_impale_on_hit_%_chance' : 'spells_impale_on_hit_%_chance'),
      mag: scale(['impale_magnitude_+%'], 'active_skill_impale_magnitude_+%_final'), n: 1 + all('number_of_additional_impaled_debuffs_to_apply'), keep: F('cannot_consume_impale') },
    // electrocute and pin from the skill, or from the build's "<type> damage can electrocute / pin" (uniques, passives)
    electrocute: F('base_lightning_damage_can_electrocute') || all('base_lightning_damage_can_electrocute') + all('base_chaos_damage_can_electrocute') + (tags.includes('attack') ? all('all_attack_damage_can_electrocute') : 0) > 0 || keys.some(k => /electrocutes_as_though_dealt_damage/.test(k)) ? scale(['hit_damage_electrocute_multiplier_+%'], /electrocutes_as_though_dealt_damage_\+%_final$/) : 0,
    electrocuteIf: scale(['hit_damage_electrocute_multiplier_+%'], /electrocutes_as_though_dealt_damage_\+%_final$/),   // on an enemy any lightning can electrocute (Enervating Nova)
    pin: pinAll || all('base_physical_damage_can_pin') > 0 ? more(/pins_as_though_dealt_damage_\+%_final$/) * (1 + (all('hit_damage_pin_multiplier_+%') + all('hit_damage_immobilisation_multiplier_+%')) / 100) : 0, pinPhys: !pinAll,   // physical alone: a unique's
    chillDamage: more(/chill_as_though_damage_\+%_final$/),
    consume, vs,
    charge: Object.fromEntries(['frenzy', 'power', 'endurance'].map(c => [c, { per: sumOf(new RegExp(`damage_\\+%_final_per_${c}_charge(?:_consumed)?$`)), when: sumOf(new RegExp(`damage_\\+%_final_when_(?:${c}_charges_consumed|charged)$`)) }])),
    // Exposure the hits inflict (Primal Strikes, Exposing Cry, Frost Bomb, Oil Grenade) and the supports' on ignite / shock /
    // cold critical hit; its magnitude: the skill's, else the game's default (scene.js), times "increased Exposure effect"
    expo: { hit: all('all_exposure_on_hit_magnitude') || null, hitMs: all('all_exposure_on_hit_for_duration_ms') || null,
      skill: all('active_skill_all_elemental_exposure_magnitude') || all('skill_base_oil_exposure_-_to_total_elemental_resistance') || null,
      onIgnite: all('inflict_exposure_for_x_ms_on_ignite') || null, onShock: all('inflict_exposure_for_x_ms_on_shock') || null,
      onColdCrit: all('inflict_exposure_for_x_ms_on_cold_crit') || null, effect: 1 + all('exposure_effect_+%') / 100 },
  };
}
// A mark on an enemy: more critical damage it takes (Sniper's Mark), more freeze / electrocute buildup against it
// (Freezing / Voltaic Mark), and the buff you gain when that state fills and consumes it: damage gained as extra
// cold / lightning for its secondary duration
// The minion a minion gem raises (pob2.json: which monster) at the level its gem gives (MinionGemLevelScaling), hitting
// with its first skill that deals damage (enemies.js attackOf, with the allies' damage per level), and what it gets of
// the build: the game's MinionStats turns the owner's stats (tree, gear, the gem's, its supports') into the minion's
// ("minion_damage_+%" -> "damage_+%"), and every player minion has PlayerMinionIntrinsicStats (+70% critical damage
// bonus). note: "Minions have X% increased Attack and Cast Speed" (no MinionStats row) counts for both; the rows for one
// kind of minion (zombies, skeletons) do not (available.py)
// A minion's maximum life: the allies' life at its level (DefaultMonsterStats AllyLife: the gem's level x 2, MinionLevel)
// times its monster's (MonsterVarieties LifeMultiplier), then the build's increases ("Minions have #% increased maximum
// Life", minion_maximum_life_+%) and every "more" the gem and its supports give minions; as PoB2's CalcDefence for minions
// (floor(monsterAllyLifeTable[level] * minionData.life)). note: no game window checked against it yet
function minionLife(st, sum, id, finals = {}) {
  const m = enemy(id), level = SK.minion_level?.[st._level - 1]; if (!m || !level) return null;
  const ms = minionStats(st, { ...sum, ...finals }, {});   // a support's "more" life too (Loyalty, Minion Mastery)
  return Math.round(Math.floor(monster(level, 'AllyLife') * m.life) * (1 + v(sum, 'minion_maximum_life_+%') / 100)
    * Object.entries(ms).filter(([k]) => /^max(imum)?_life_\+%_final/.test(k)).reduce((t, [, x]) => t * (1 + x / 100), 1));
}
const companion = sum => { const out = { ...sum }; for (const [k, x] of Object.entries(sum)) if (k.startsWith('companion_')) { const m = 'minion_' + k.slice(10); out[m] = (out[m] || 0) + x; } return out; };
// the build's and the gem's stats that are the minion's (SK.minion_stats: "minion_x" -> its "x"), added to `ms`
function minionStats(st, sum, ms) {
  for (const src of [sum, st]) for (const [k, x] of Object.entries(src)) { const to = SK.minion_stats?.[k]; if (to && typeof x === 'number') ms[to] = (ms[to] || 0) + x; }
  return ms;
}
function minionOf(st, sum, fin, id, at = {}, wAdd = null) {
  const m = enemy(id), level = SK.minion_level?.[st._level - 1];
  const key = m && attacksOf(m)[0].key;   // none of its skills deals damage (Skeletal Cleric heals): no hits of its own
  if (!level || !key || key === 'basic') return null;
  const a = attackOf(m, level, key, 'normal', true), ms = minionStats(st, sum, { ...SK.minion_intrinsic });
  // Ancestral Spirits, Manifest Weapon, Supporting Fire, Azmerian Swarms: 1% increased minion damage, attack speed and area
  // per their amount of your Strength / Dexterity
  for (const [k, to, a] of [['minion_1%_damage_+%_per_X_player_strength', 'damage_+%', 'str'], ['active_skill_minion_1%_attack_speed_+%_per_X_player_dexterity', 'attack_speed_+%', 'dex'],
    ['minion_1%_area_of_effect_+%_per_X_player_dexterity', 'base_skill_area_of_effect_+%', 'dex']]) if (st[k]) ms[to] = (ms[to] || 0) + Math.floor((at[a] || 0) / st[k]);
  const tags = ['minion', a.attack ? 'attack' : 'spell', ...(a.shape === 'melee' || a.shape === 'slam' ? ['melee'] : []), ...(a.shape === 'projectile' ? ['projectile'] : []), ...(a.area ? ['area'] : [])];
  // added damage, then physical converted and gained as other types, as for the character
  const added = (t, i) => v(ms, `global_${i ? 'maximum' : 'minimum'}_added_${t}_damage`) + (a.attack ? v(ms, `attack_${i ? 'maximum' : 'minimum'}_added_${t}_damage`) + (wAdd?.[t]?.[i] || 0) : 0);
  const base = Object.fromEntries(DMG.map(t => [t, [0, 1].map(i => (a.hits[t]?.[i] || 0) + added(t, i))]));
  const conv = t => v(ms, `non_skill_base_physical_damage_%_to_convert_to_${t}`, `active_skill_base_physical_damage_%_to_convert_to_${t}`);
  const phys = base.physical, kept = 1 - Math.min(1, DMG.slice(1).reduce((x, t) => x + conv(t), 0) / 100);
  for (const t of DMG.slice(1)) base[t] = base[t].map((x, i) => x + phys[i] * (conv(t) + v(ms, `non_skill_base_physical_damage_%_to_gain_as_${t}`)) / 100);
  base.physical = phys.map(x => x * kept);
  const scale = t => (1 + (inc(ms, 'damage_+%', tags) + v(ms, `${t}_damage_+%`) + (t !== 'physical' && t !== 'chaos' ? v(ms, 'elemental_damage_+%') : 0)) / 100)
    * (1 + v(ms, 'damage_+%_final_for_minion') / 100) * (1 + v(st, 'active_skill_minion_damage_+%_final') / 100) * more(fin, 'damage_+%', tags, t);
  const hits = {};
  for (const t of DMG) if (base[t][1]) hits[t] = base[t].map(x => Math.round(x * scale(t)));
  const both = v(sum, 'minion_attack_and_cast_speed_+%') + v(ms, 'skill_speed_+%');
  const speed = a.attack ? (1 + (inc(ms, 'attack_speed_+%', tags) + both) / 100) * (1 + v(ms, 'attack_speed_+%_final_for_minions') / 100) : 1 + (inc(ms, 'cast_speed_+%', tags) + both) / 100;
  const period = st.living_lightning_beam_attack_time_ms ? st.living_lightning_beam_attack_time_ms / 1000 : a.period;   // Living Lightning: its beam's attack time
  return { name: m.name, level, hits, speed: Math.min(speed / period, a.cooldown ? 1 / a.cooldown : Infinity),
    crit: Math.min(100, a.crit * (1 + inc(ms, 'critical_strike_chance_+%', tags) / 100)),
    critBonus: a.critBonus + v(ms, 'base_critical_hit_damage_bonus') + inc(ms, 'critical_strike_multiplier_+', tags) };
}
// self-check: a gem level 20 Raise Zombie raises a level 40 zombie: 204 x 0.75 ± 30% = 107-198 physical every 1.25 s, crit
// bonus 30 + 70; Raging Spirits' 40% more attack speed and 70% of physical as fire (the gem's), and 20% more damage from the tree
if (SK.minions['Raise Zombie']) {
  const z = skill({ name: 'Raise Zombie', level: 20, supports: [] }, { gems: [], items: {} }, {}), r = skill({ name: 'Raging Spirits', level: 20, supports: [] }, { gems: [], items: {} }, { 'minion_damage_+%': 20 });
  console.assert(z.minion?.level === 40 && z.hits.physical?.join() === '107,198' && Math.abs(z.speed - .8) < 1e-9 && z.critBonus === 100
    && r.hits.fire?.join() === '96,144' && r.hits.physical?.join() === '41,62' && Math.abs(r.speed - 1.4) < 1e-9, 'minion damage', z, r);
  // life: a level 2 zombie (gem level 1) has floor(83 x 0.7) = 58, as PoB2's (RaisedZombie life 0.7); 50% increased: 87
  const l = n => skill({ name: 'Raise Zombie', level: 1, supports: [] }, { gems: [], items: {} }, n ? { 'minion_maximum_life_+%': n } : {}).minionLife;
  console.assert(l() === 58 && l(50) === 87, 'minion life', l(), l(50));
  // a Companion takes "Companions have #% increased Damage / maximum Life"; a zombie does not
  const w = n => skill({ name: n, level: 10, supports: [] }, { gems: [], items: {} }, { 'companion_damage_+%': 100, 'companion_maximum_life_+%': 50 }), w0 = skill({ name: 'Azmerian Wolf', level: 10, supports: [] }, { gems: [], items: {} }, {});
  console.assert(Math.abs(w('Azmerian Wolf').dps - 2 * w0.dps) < 1e-6 && w('Azmerian Wolf').minionLife === Math.round(w0.minionLife * 1.5) && w('Raise Zombie').minionLife === 620, 'companion stats');
}

// its effects times "increased Effect of your Mark Skills" (eff)
function markOf(st, eff = 1) {
  const k = re => Object.keys(st).find(x => re.test(x)), as = k(/_mark_damage_buff_damage_%_to_gain_as_\w+$/);
  return { crit: (st.enemy_additional_critical_strike_multiplier_against_self || 0) * eff,
    freeze: (st[k(/mark_hit_damage_freeze_multiplier_\+%/)] || 0) * eff, electrocute: (st[k(/mark_hit_damage_electrocute_multiplier_\+%/)] || 0) * eff,
    gain: as && st[as] ? { el: as.match(/_as_(\w+)$/)[1], pct: st[as] * eff, time: (st.base_secondary_skill_effect_duration || 0) / 1000 } : null };
}
// A curse on an enemy: what its gem's level gives (lower resistances and armour, less damage dealt, slower actions), times
// "increased Curse effect" of the tree, gear and supports; the scene lowers it on rarer monsters (enemies.js curseEffect)
function curseOf(st, sum, finals = {}) {
  const res = Object.fromEntries(['fire', 'cold', 'lightning', 'chaos'].map(e => [e, (st[`base_skill_buff_${e}_damage_resistance_%_to_apply`] || 0) + (e !== 'chaos' ? st['base_skill_buff_all_elements_resistance_%_to_apply'] || 0 : 0)]));
  return { res, armour: st['base_skill_buff_total_armour_-_to_grant'] || 0, damage: st['base_skill_buff_damage_+%_final_to_apply'] || 0,
    speed: st['base_skill_debuff_action_speed_+%_final_to_inflict'] || 0, maxLevel: st.skill_curses_cannot_apply_to_targets_above_level || null,
    effect: (1 + (v(sum, 'curse_effect_+%') + (st['curse_effect_+%'] || 0)) / 100) * (1 + (finals['support_atziri_curse_effect_+%_final'] || 0) / 100) };   // Atziri's Allure: less
}
// self-check: Purity of Fire at level 10 grants +31% fire resistance, 50% more with 50% increased aura magnitudes
{ const a = auraStats({ gems: [{ name: 'Purity of Fire', level: 10 }] }, { 'aura_effect_+%': 50 }); console.assert(a['base_fire_damage_resistance_%'] === 46.5, 'aura grants', a); }
// self-check: a support's "more" chance multiplies the gem's own, "increased" ones add up
{ const a = ailments({ 'active_skill_ignite_chance_+%_final': 50 }, { 'ignite_chance_+%': 20 }, { 'support_ignition_chance_to_ignite_+%_final': 100 }, []);
  console.assert(Math.abs(a.igniteChance - 1.2 * 1.5 * 2) < 1e-9 && a.bleed === 0 && a.stun === 1, 'ailment modifiers', a); }
// ...Glacial Cascade's second part: much more damage when it consumes a freeze, more on unique enemies; it never freezes
{ const a = skill({ name: 'Glacial Cascade', level: 10, supports: [] }, { gems: [], items: {} }, {}).ail;
  console.assert(a.consume.freeze.unique > a.consume.freeze.non_unique && a.never.freeze && !a.never.shock, 'consume bonus and never_freeze', a); }
// ...and Elemental Weakness lowers every elemental resistance, not chaos
{ const c = skill({ name: 'Elemental Weakness', level: 10, supports: [] }, { gems: [], items: {} }, {}).curse;
  console.assert(c.res.fire < 0 && c.res.fire === c.res.cold && c.res.chaos === 0 && c.effect === 1, 'curse', c); }
// ...a totem uses its gem's own spell (Dark Effigy) or attack (Shockwave Totem: an attack, so it needs a weapon)
{ const e = skill({ name: 'Dark Effigy', level: 10, supports: [] }, { gems: [], items: {} }, {}), w = skill({ name: 'Shockwave Totem', level: 10, supports: [] }, { gems: [], items: {} }, {});
  console.assert(e.hits.chaos?.[1] > 0 && e.totems === 0 && w.attack && w.reason === 'Equip a weapon to calculate the attack damage', 'totem skills', e, w); }

// The numbers impact.js compares before and after a change: the panel's (resistances capped, as shown) and each skill's DPS
// self-check: Multishot II in Mortar Cannon slows its grenades, not the cannon (the game: use time 1 s)
// ...and Cluster Grenade's cooldown in the game's window: 10.99 s, 2 uses (quality 16%, Payload, 45% from the tree, +1 use)
{ const c = skill({ name: 'Cluster Grenade', level: 17, quality: 16, supports: ['Payload'] }, { gems: [], items: {} }, { 'grenade_skill_cooldown_speed_+%': 45, 'grenade_skill_cooldown_count_+': 1 });
  console.assert(Math.round(c.cooldown) === 10989 && c.uses === 2, 'cooldown and uses', c); }
console.assert(skill({ name: 'Mortar Cannon', level: 18, supports: ['Multishot II'] }, { gems: [], items: {} }, {}).speed === 1, 'meta gem supports');
// self-check: mana cost. Orb of Storms 20 costs 129 (Efficiency I's 30% less: 91, up; Lifetap: 129 life instead); Shock Conduction II's x1.2 makes it 154 (154.8 down), 10% reduced
// 139 (138.6 up), 25% cost efficiency 111; Runic Tempering costs per second, not rounded
{ const b = { gems: [], items: {} }, orb = sum => skill({ name: 'Orb of Storms', level: 20, supports: ['Shock Conduction II'] }, b, sum).cost;
  console.assert(skill({ name: 'Orb of Storms', level: 20 }, b, {}).cost === 129 && orb({}) === 154 && orb({ 'base_mana_cost_-%': 10 }) === 139 && orb({ 'base_mana_cost_-%': 10, 'base_mana_cost_efficiency_+%': 25 }) === 111
    && skill({ name: 'Runic Tempering', level: 20 }, b, {}).costPerSecond === true
    && skill({ name: 'Orb of Storms', level: 20, supports: ['Efficiency I'] }, b, {}).cost === 91 && skill({ name: 'Orb of Storms', level: 20, supports: ['Lifetap'] }, b, {}).lifeCost === 129, 'mana cost'); }

export function snapshot(b, sum) {
  const c = character(b, sum), r = recovery(c, sum), R = c.res;
  return { life: c.life, es: c.es, mana: c.mana, spirit: c.spirit, armour: c.armour, evasion: c.evasion, block: c.block,
    fire: R.fire.capped, cold: R.cold.capped, lightning: R.lightning.capped, chaos: R.chaos.capped, ...c.attrs,
    lifeRegen: r.lifeRegen, esRecharge: r.esRecharge, move: c.move, accuracy: c.accuracy,
    dps: (b.gems || []).map(g => [tn(GEM[g.name]) || g.name, skill(g, b, sum).dps]) };
}
