// Character sheet and skill damage, from the summed tree + gear stats (app.js treeSum) and the game data.
// The numbers are the game's own (class base life/mana, skill damage per level: skills.json / ascendancies.json,
// regenerated with poe2_data/_tool after each patch); what the data does not have is null and shown as "—".
import { t, tn, fmt, cap, lang } from './i18n.js';
import { weaponStats, statsOf, classOf, rowReader, flaskRecovery, armourItems, pieceDef } from './items.js';
import { SK } from './skilldata.js';
import { statLinesEn } from './stats.js';
import { enemy, attackOf, attacksOf, ENEMIES, deflection, K as MON_K } from './enemies.js';

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
  'support_ignite_protection_spirit_cost_ignite_duration_on_self_+%_final': 'self_ignite_duration_+%_final', 'support_shock_protection_spirit_cost_shock_duration_on_self_+%_final': 'self_shock_duration_+%_final',
  // Mysticism, Direstrike
  'support_spell_damage_spirit_cost_spell_damage_+%_on_full_energy_shield': 'spell_damage_+%_while_es_full', 'support_attack_damage_spirit_cost_attack_damage_+%_on_low_life': 'attack_damage_+%_when_on_low_life',
  // Upwelling (the scene's, while you are not on full mana), Arbiter's Reach (its Guard's duration)
  'support_minion_damage_spirit_cost_minion_damage_+%_while_missing_mana': 'minion_damage_+%_while_missing_mana', 'support_mothers_ward_base_duration_ms': 'mothers_ward_ms' };
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
  for (const g of b.gems) { const req = ATTRS.filter(a => GEM[g.name]?.tags?.includes(a)); for (const a of req) motes[a] += req.length === 1 ? 2 : 1; }
  const per = (id, a) => (c[id] || 0) * motes[a];
  return { 'maximum_life_+%': per('gem_barrier_red_grants_maximum_life_+%', 'strength'),
    'global_armour_evasion_energy_shield_+%': per('gem_barrier_green_grants_evasion_rating_+%', 'dexterity'),
    'life_regeneration_rate_+%': per('gem_barrier_blue_grants_life_regeneration_rate_+%', 'intelligence'),
    'mana_regeneration_rate_+%': per('gem_barrier_blue_grants_mana_regeneration_rate_+%', 'intelligence') };
}

const load = f => fetch('poe2_data/available/' + f).then(r => r.json());
const [ASCS, GEMS] = await Promise.all([load('ascendancies.json'), load('gems.json')]);
// a gem by its name. Of several with one name the one you can cut stays (Spark and a unique's own triggered Spark), as
// in skills.json; of the others the first (a staff's Lightning Bolt and a unique's)
export const GEM = Object.fromEntries([...GEMS].reverse().sort((a, b) => (a.source === 'gem_cutting') - (b.source === 'gem_cutting')).map(g => [g.name, g]));
console.assert(GEM.Spark.source === 'gem_cutting' && GEM.Unleash.kind === 'support', 'GEM: the gem you can cut');
// self-check: 3 Strength Motes of its own, 2 for Berserk, which requires Strength alone, and 1 each for Mortar Cannon and
// the Cluster Grenade it uses (a skill gem of its own, as PoB2 counts it), at 2% life each
console.assert(skillStats({ gems: [{ name: 'Virtuous Barrier' }, { name: 'Berserk' }, { name: 'Mortar Cannon' }, { name: 'Cluster Grenade' }] })['maximum_life_+%'] === 14 && skillStats({ gems: [{ name: 'Virtuous Barrier' }, { name: 'Ancestral Warrior Totem' }, { name: 'Orb of Storms' }] })['life_regeneration_rate_+%'] === 25 && !Object.keys(skillStats({ gems: [{ name: 'Berserk' }] })).length, 'Virtuous Barrier Motes');
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
  if (GEM[g.name]?.specific && GEM[g.name].specific === sum['unique_jewel_specific_skill_level_+_skill']) level += v(sum, 'unique_jewel_specific_skill_level_+_level');   // Prism of Belief
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
// Atziri's Communion: no Spirit, its % of maximum life per base Spirit instead (life: that %)
export function reservation(g, sum = {}, b, life = false) {
  const st = gemStats(g, sum), id = 'base_spirit_reservation_efficiency_+%';
  const eff = (st[id] || 0) + v(sum, id, ...(GEM[g.name]?.tags || []).map(t => `reservation_efficiency_+%_of_${t}_skills`));
  const own = (st._spirit || 0) + (st.blasphemy_base_spirit_reservation_per_socketed_curse || 0) * (b?.gems || []).filter(x => x.meta === g.name).length
    + (sum.keystone_ancestral_bond ? 75 * (totem(g, sum)?.limit || 0) : 0);   // Ancestral Bond: 75 Spirit per totem, every one it can have placed
  const AC = (g.supports || []).includes("Atziri's Communion") && SK.skills["Atziri's Communion"].constant.skill_reserves_X_life_permyriad_per_spirit_instead_of_spirit;
  if (life || AC) return life && AC ? own * AC / 100 : 0;
  // Lord of the Wilds: non-minion skills 50% less efficiency; Trusted Kinship: companions 30% more, the rest 20% less
  const T = GEM[g.name]?.tags || [], more = (sum.keystone_lord_of_the_wilds && !T.includes('minion') ? .5 : 1) * (sum.keystone_2_companions ? T.includes('companion') ? 1.3 : .8 : 1);
  return Math.round(own * 100 / (100 + eff) / more * (sum.unique_spirit_reservations_are_halved ? .5 : 1));   // Matsya: 50% less
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
  const cap = MON_K.monster_max_resistance ?? 75, er = Math.min(cap + v(s, 'totem_maximum_all_elemental_resistances_%'), (st['totem_elemental_resistance_%'] || 0) + v(s, 'totem_elemental_resistance_%'));
  return {
    level,
    life: Math.round(Math.floor(monster(level, 'AllyLife') * T.life_mult) * (1 + (v(s, 'totem_life_+%') + (st['totem_life_+%'] || 0)) / 100) * (1 + v(s, 'support_totem_life_+%_final') / 100)),   // Tawhoa's Tending: more (PoB2 TotemLife MORE)
    ailment: monster(level, 'AilmentThreshold'),
    armour: monster(level, 'Armour') * (1 + 3 * (T.armour || 0) / 100), evasion: monster(level, 'Evasion'),
    regen: v(s, 'totems_regenerate_%_life_per_minute') / 60,   // % of its life a second
    // what each type of a hit on it loses: its resistances (up to the monsters' maximum, more with the tree's) and its additional physical damage reduction
    res: { physical: v(s, 'totem_additional_physical_damage_reduction_%'), chaos: Math.min(cap, st['totem_chaos_resistance_%'] || 0), fire: er, cold: er, lightning: er },
    duration: (st.base_totem_duration || 0) / 1000 * (1 + v(s, 'totem_duration_+%') / 100),
    limit: ((st.base_number_of_totems_allowed || 0) + v(s, 'number_of_additional_totems_allowed') + (['melee', 'attack'].every(x => GEM[g.name]?.tags?.includes(x)) ? v(s, 'melee_attack_skills_additional_totems_allowed') : 0)   // Ancestral Artifice
      + (T.ballista ? v(s, 'additional_ballista_totems_allowed', 'attack_skills_additional_ballista_totems_allowed') : 0)) * (s.keystone_ancestral_bond ? 2 : 1),   // Ancestral Bond: doubled
  };
}
// self-check: Mortar Cannon at gem level 18 is a level 36 totem with 2091 life and 1123 ailment threshold, as in the game
{ const m = totem({ name: 'Mortar Cannon', level: 18 }), ok = !SK.minion_level || m && m.level === 36 && m.life === 2091 && m.ailment === 1123 && m.res.fire === 55 && m.res.chaos === 25 && m.armour === 1268
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
  const R = v(sum, 'physical_damage_from_hits_%_taken_as_random_element'), P = R && (out.hit.physical ||= {});   // a random element: a third each on average
  if (R) for (const e of ['fire', 'cold', 'lightning']) P[e] = (P[e] || 0) + R / 3;
  // uniques' (of hits): elemental as chaos (Apep's Supremacy), physical as lightning (Lightning Coil), fire as physical (The Rat Cage)
  for (const [f, t, k] of [...['fire', 'cold', 'lightning'].map(e => [e, 'chaos', 'elemental_damage_taken_%_as_chaos']), ['physical', 'lightning', 'physical_damage_taken_%_as_lightning'], ['fire', 'physical', 'base_fire_hit_damage_taken_%_as_physical']])
    if (sum[k]) { const o = (out.hit[f] ||= {}); o[t] = (o[t] || 0) + sum[k]; }
  return out;
}
// the Kalguuran keystones (a timeless jewel's, Heroic Tragedy): no inherent bonus from one attribute, and 1% increased
// Energy Shield / Armour / Evasion Rating per 2 of it
const KALGUUR = { str: ['keystone_alternate_strength_bonus', 'maximum_energy_shield_+%'], dex: ['keystone_alternate_dexterity_bonus', 'physical_damage_reduction_rating_+%'],
  int: ['keystone_alternate_intelligence_bonus', 'evasion_rating_+%'] };
export function character(b, sum) {
  const A = ascOf(b.asc), cb = A.class_base || {}, lvl = b.level || 1, at = attributes(sum, b.asc);
  for (const [a, [k, to]] of Object.entries(KALGUUR)) if (sum[k]) sum = { ...sum, [to]: (sum[to] || 0) + Math.floor((at[a] || 0) / 2) };
  if (sum['local_all_attributes_-_per_level']) for (const k of ['str', 'dex', 'int']) at[k] = Math.max(0, (at[k] || 0) - lvl * sum['local_all_attributes_-_per_level']);   // Greymake
  const fromAttr = k => ['Strength', 'Dexterity', 'Intelligence'].reduce((t, a, i) => t + (sum[KALGUUR[['str', 'dex', 'int'][i]][0]] ? 0 : (perAttr(a)[k] || 0) * at[['str', 'dex', 'int'][i]]), 0) * (sum.gemling_double_basic_attribute_bonuses ? 2 : 1);   // Gemling: doubled
  // the class's own amount (Characters row: 16 life, 30 mana) plus character.ot's amount per level, the first included
  const base = (row, perLvl) => cb[row] == null || CHAR[perLvl] == null ? null : cb[row] + lvl * CHAR[perLvl];
  const lifeBase = base('BaseMaxLife', 'life_per_level'), manaBase = base('BaseMaxMana', 'mana_per_level');
  const pct = (...ids) => 1 + v(sum, ...ids) / 100;
  const res = {}, SN = supportsOf((b.gems || []).flatMap(g => g.supports || []));   // the red / green / blue supports socketed in your skills (Gemling)
  // the tree's stats under a count of socketed supports of a colour, with a Quarterstaff or per 10 Intelligence, as the
  // stat they are then (Gem Enthusiast, Unnatural Resilience, Unbothering Cold, Conductive Embrace, One with the River, The Winter Owl)
  for (const [k, n, to] of [['maximum_life_+%_if_10_red_supports_socketed', SN.str >= 10, 'maximum_life_+%'], ['maximum_mana_+%_if_10_blue_supports_socketed', SN.int >= 10, 'maximum_mana_+%'],
    ['maximum_fire_resistance_+%_if_at_least_5_red_supports_socketed', SN.str >= 5, 'base_maximum_fire_damage_resistance_%'], ['maximum_cold_resistance_+%_if_at_least_5_blue_supports_socketed', SN.int >= 5, 'base_maximum_cold_damage_resistance_%'],
    ['maximum_lightning_resistance_+%_if_at_least_5_green_supports_socketed', SN.dex >= 5, 'base_maximum_lightning_damage_resistance_%'],
    ['armour_evasion_energy_shield_+%_while_wielding_quarterstaff', classOf(b.items?.weapon) === 'Quarterstaves', 'global_armour_evasion_energy_shield_+%'], ['evasion_+%_per_10_intelligence', Math.floor((at.int || 0) / 10), 'evasion_rating_+%']])
    if (sum[k] && n) sum = { ...sum, [to]: (sum[to] || 0) + sum[k] * n };
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
    if (k === 'chaos' ? sum.zero_chaos_resistance : sum.your_elemental_resistances_do_not_exist) val = 0;   // Glimpse of Chaos; Veil of the Night
    const perSup = sum[`maximum_${k}_resistance_+1_per_X_corresponding_support`];
    const max = sum['override_maximum_damage_resistance_%'] || CHAR['base_maximum_all_resistances_%'] + v(sum, `base_maximum_${k}_damage_resistance_%`, 'additional_maximum_all_resistances_%', ...(k === 'chaos' ? [] : ['additional_maximum_all_elemental_resistances_%']))
      + ((k === 'cold' || k === 'lightning') && sum.modifiers_to_maximum_fire_resistance_apply_to_maximum_cold_and_lightning_resistance ? v(sum, 'base_maximum_fire_damage_resistance_%') : 0)
      + (perSup ? Math.floor(SN[{ fire: 'str', cold: 'int', lightning: 'dex' }[k]] / perSup) : 0)   // Gemling: fire per red, cold per blue, lightning per green supports
      + (k !== 'chaos' && Math.min(SN.str, SN.dex, SN.int) >= 5 ? v(sum, 'additional_maximum_all_elemental_resistances_%_if_at_least_5_red_green_blue_supports_socketed') : 0)
      + (sum.maximum_block_modifiers_apply_to_maximum_resistances_instead ? v(sum, 'additional_maximum_block_%') : 0);   // Saffell's Frame
    res[k] = { value: val, max, capped: Math.min(val, max) };
  }
  const defInc = 'global_armour_evasion_energy_shield_+%';
  // the equipped shield's / focus's own defences, increased ("from Equipped Shield / Focus")
  const oc = classOf(b.items?.offhand), offX = k => pieceDef(b.items, 'offhand', k) * (/^(Shields|Bucklers)$/.test(oc) ? v(sum, 'shield_armour_evasion_energy_shield_+%') : oc === 'Foci' && k === 'energy_shield' ? v(sum, 'energy_shield_from_focus_+%') : 0) / 100;
  const WH = pct('witchhunter_armour_evasion_+%_final'), EV = pct('master_of_elements_evasion_rating_+%_final');   // Witchhunter: less armour and evasion; Invoker: less evasion
  // what the tree gives from one equipped piece's own defences: increased ("from Equipped Helmet / Body Armour"), or
  // another defence per point of it ("+1 to Evasion Rating per 1 Item Armour on Equipped Gloves"), and Armour from the
  // Strength requirements of the boots, gloves and helmet
  const P = (s, k) => pieceDef(b.items, s, k);
  const pieceA = P('body', 'armour') * v(sum, 'body_armour_+%') / 100 + P('boots', 'energy_shield') * v(sum, 'armour_+_per_1_boots_energy_shield') + Math.floor(['boots', 'gloves', 'helmet'].reduce((t, s) => t + P(s, 'str'), 0) * v(sum, 'armour_+_from_%_strength_requirements_from_boots_gloves_helmets') / 100);
  const pieceE = P('body', 'evasion') * v(sum, 'body_armour_evasion_rating_+%') / 100 + P('gloves', 'armour') * v(sum, 'evasion_rating_+_per_1_armour_on_gloves') + P('helmet', 'energy_shield') * v(sum, 'evasion_rating_+_per_1_helmet_energy_shield');
  const perEva = v(sum, 'maximum_energy_shield_+1_per_x_body_armour_evasion_rating');
  const pieceS = P('helmet', 'energy_shield') * v(sum, 'energy_shield_from_helmet_+%') / 100 + Math.floor(P('helmet', 'armour') / 8) * v(sum, 'energy_shield_+_per_8_helmet_armour') + (perEva ? Math.floor(P('body', 'evasion') / perEva) : 0);
  // Skin of the Loyal: armour / evasion / energy shield / ailment threshold increased by an uncapped resistance
  const UR = (k, r) => sum[k] ? res[r].value / 100 : 0, urA = UR('armour_increased_by_uncapped_fire_resistance', 'fire'), urE = UR('evasion_rating_increased_by_uncapped_lightning_resistance', 'lightning'), urS = UR('energy_shield_increased_by_uncapped_cold_resistance', 'cold');
  const evasion0 = Math.round((v(sum, 'base_evasion_rating') + offX('evasion') + pieceE + (CHAR.base_evasion_rating || 0)) * (pct('evasion_rating_+%', 'evasion_and_physical_damage_reduction_rating_+%', defInc) + urE) * WH * EV);
  // "Gain 10% of Evasion Rating as extra Armour": of the evasion after its increases, not raised by the armour's
  const armour0 = Math.round((v(sum, 'base_physical_damage_reduction_rating') + offX('armour') + pieceA + (at.str || 0) * v(sum, 'gain_armour_equal_to_strength')) * (pct('physical_damage_reduction_rating_+%', 'evasion_and_physical_damage_reduction_rating_+%', defInc) + urA) * WH + evasion0 * v(sum, 'evasion_rating_%_to_gain_as_armour') / 100);   // Facebreaker: +1 armour per Strength
  // The Sunken Vessel: all armour converted to evasion
  const SV = !!sum.converts_all_armour_to_evasion_rating, armour = SV ? 0 : armour0, evasion = evasion0 + (SV ? armour0 : 0);
  // armour against elements: the % of it that applies to each (passives, and the body armour's own grants)
  const ele = v(sum, 'armour_%_applies_to_fire_cold_lightning_damage', 'body_armour_grants_armour_%_applies_to_fire_cold_lightning_damage');
  const armourEl = { fire: v(sum, 'base_armour_%_applies_to_fire_damage') + ele, cold: v(sum, 'base_armour_%_applies_to_cold_damage') + ele,
    lightning: v(sum, 'base_armour_%_applies_to_lightning_damage', 'base_armour_applies_to_lightning_damage') + ele,
    chaos: v(sum, 'base_armour_%_applies_to_chaos_damage', 'body_armour_grants_base_armour_applies_to_chaos_damage') };
  // deflection: its % of armour and of evasion as deflection rating, its increases, and how much less a deflected hit deals
  const deflect = { arm: v(sum, 'base_deflection_rating_%_of_armour'), eva: v(sum, 'base_deflection_rating_%_of_evasion_rating'), inc: pct('deflection_rating_+%'),
    less: (CHAR['damage_%_deflected'] || 0) + v(sum, 'base_damage_%_deflected'), lessCrit: v(sum, 'base_damage_%_deflected_vs_crit') };   // and more of a deflected critical hit
  const esInc = pct('maximum_energy_shield_+%', defInc, 'maximum_life_mana_and_energy_shield_+%') + urS;
  // accuracy: the increased with the main hand's kind of weapon (one_handed_melee_, bow_, spear_...) and while dual wielding
  const mw = weaponStats(b.items), mwTags = mw ? [...weaponTags(mw), ...(mw.tags || []).includes('ranged') ? [] : ['melee']] : [];
  const accInc = 1 + (inc(sum, 'accuracy_rating_+%', mwTags) + (mw && weaponStats({ weapon: b.items?.offhand }) ? v(sum, 'accuracy_rating_while_dual_wielding_+%') : 0)) / 100;
  const worn = armourItems(b.items), blockInc = 1 + (v(sum, 'block_chance_+%') + Math.floor(worn.armour / 100) * v(sum, 'block_chance_+X%_per_100_base_armour_on_armours')) / 100;
  const c = {
    level: lvl, attrs: at, armourEl, deflect,
    // stun / ailment threshold from the gear: the lowest of the helmet's (boots') evasion and armour, a share of the armour
    // items' armour. note: the passives' value (2) is not in their text: taken as "on"
    stunGear: (sum['stun_threshold_+_from_lowest_of_base_helmet_evasion_rating_and_armour'] ? Math.min(P('helmet', 'armour'), P('helmet', 'evasion')) : 0) + armourItems(b.items).armour * v(sum, 'add_%_base_armour_on_equipment_to_stun_threshold') / 100,
    ailGear: sum['ailment_threshold_+_from_lowest_of_base_boots_evasion_rating_and_armour'] ? Math.min(P('boots', 'armour'), P('boots', 'evasion')) : 0,
    life: lifeBase == null ? null : Math.round((lifeBase + v(sum, 'base_maximum_life') + Math.floor(at.dex / 4) * v(sum, 'X_life_per_4_dexterity') + fromAttr('life') * (sum.keystone_giants_blood ? .5 : 1)) * pct('maximum_life_+%', 'maximum_life_mana_and_energy_shield_+%') * pct('titan_maximum_life_+%_final') * pct('oracle_maximum_life_+%_final')),   // Titan: more; Oracle: less
    mana: manaBase == null ? null : Math.round((manaBase + v(sum, 'base_maximum_mana') + fromAttr('mana')) * pct('maximum_mana_+%', 'maximum_life_mana_and_energy_shield_+%') * pct('oracle_maximum_mana_+%_final')),
    // what gear gives ("+30 to Spirit", a sceptre's own) is its own stat: one passive turns it off
    spirit: sum.spirit_does_not_exist ? 0 : Math.round((first(cb.BaseSpirit, CHAR.base_spirit, 0) + v(sum, 'base_spirit') + (sum.cannot_gain_spirit_from_equipment ? 0 : v(sum, 'base_spirit_from_equipment'))) * pct('spirit_+%')),
    // spirit reserved by the build's persistent skills
    reserved: (b.gems || []).reduce((t, g) => t + reservation(g, sum, b), 0),
    es: Math.round((v(sum, 'base_maximum_energy_shield') + offX('energy_shield') + pieceS + P('body', 'energy_shield') * v(sum, 'maximum_energy_shield_from_body_armour_+%') / 100) * esInc + v(sum, 'total_maximum_energy_shield_+')),
    armour, evasion, armourPct: armourReduction(armour, lvl), evadePct: evadeChance(evasion, lvl),
    evaDouble: !!sum.double_evasion_rating_if_you_havent_been_hit_recently,   // Hyrri's Ire: doubled while not hit recently (the scene checks it)
    // the increases they have, and the tree's increased armour / evasion while you are in a state (the scene checks it)
    armourInc: pct('physical_damage_reduction_rating_+%', 'evasion_and_physical_damage_reduction_rating_+%', defInc), evasionInc: pct('evasion_rating_+%', 'evasion_and_physical_damage_reduction_rating_+%', defInc), esInc,
    defWhile: DEF_WHILE.filter(([k]) => sum[k]).map(([k, to, cv]) => ({ to, cv, val: sum[k] })),
    speedWhile: SPEED_WHILE.filter(([k]) => sum[k]).map(([k, to, cv]) => ({ to, cv, val: sum[k] })),
    moveWhile: MOVE_WHILE.filter(([k, cv]) => sum[k] && (cv === 'Green10' ? SN.dex >= 10 : cv || weaponStats({ weapon: b.items?.offhand }))).map(([k, cv]) => ({ cv: cv === 'Green10' ? null : cv, val: sum[k] })),
    // block: the shield's own chance (Renly's Training: its value instead) and what adds to it (Stone of Lazhwar with a
    // focus), increased by the tree's and by Ironbound's per 100 armour of your armour items; rounded as Path of Building 2
    // does. The tree's increased while you are in a state: the scene checks it
    block: sum.cannot_block ? 0 : Math.round((v(sum, 'additional_block_%', 'block_%') + (/^(Shields|Bucklers)$/.test(oc) ? sum['block_chance_from_equipped_shield_is_%'] || worn.block : 0) + (oc === 'Foci' ? v(sum, 'additional_block_chance_%_while_holding_focus') : 0)) * blockInc),
    blockInc, blockWhile: BLOCK_WHILE.filter(([k]) => sum[k]).map(([k, cv]) => ({ cv, val: sum[k] })),
    avoidDmg: Object.fromEntries(DMG.map(e => [e, v(sum, `avoid_${e}_damage_%`)])),   // Perfidy: its chance to avoid a type of a hit's damage
    takenAs: takenAs(sum), physDR: v(sum, 'base_additional_physical_damage_reduction_%'),   // The Hollow Mask
    // Tactician's Stay Light, Use Cover: armour defends at 200%, evade and physical reduction capped at 50%; Pathfinder's
    // share of evasion that also grants elemental damage reduction (as armour does)
    armourX: sum.double_armour_effect ? 2 : 1,
    // "Defend with X% of Armour" against a kind of hit (the scene checks it), and the chance to defend with 200% of it
    defendWith: { crit: v(sum, 'defend_with_%_armour_against_critical_strikes'), projAttack: v(sum, 'defend_with_%_armour_against_ranged_attacks'),
      far: v(sum, 'defend_with_%_armour_against_hits_from_distance_greater_than_6m'), notLowES: v(sum, 'defend_with_%_of_armour_while_not_on_low_energy_shield'), haveES: v(sum, 'defend_with_%_armour_while_you_have_energy_shield'), double: v(sum, 'chance_to_double_armour_effect_on_hit_%') }, evadeMax: sum['maximum_chance_to_evade_is_50%'] ? 50 : null, physMax: sum['maximum_physical_damage_reduction_is_50%'] ? 50 : null,
    evaPhys: !!sum.evasion_rating_also_reduces_physical_damage,   // Invoker: armour and evasion together against physical
    esArm: v(sum, 'current_energy_shield_%_as_physical_damage_reduction'), esEl: v(sum, 'current_energy_shield_%_as_elemental_damage_reduction'),   // Disciple of Varashta: its share of your current energy shield added to armour against physical
    evaEl: v(sum, 'elemental_damage_reduction_%_from_evasion_rating'),
    // the cap (character.ot's, raised by "maximum Block chance", or Turtle Charm's own) and the share of a blocked hit you still take
    blockMax: sum.maximum_block_chance_override || (CHAR['object_inherent_base_maximum_block_%_from_ot'] || 0) + (sum.maximum_block_modifiers_apply_to_maximum_resistances_instead ? 0 : v(sum, 'additional_maximum_block_%')), blockTaken: v(sum, 'base_block_%_damage_taken'),
    charges: Object.fromEntries(['frenzy', 'power', 'endurance'].map(c => [c, (CHAR[`max_${c}_charges`] || 0) + v(sum, `max_${c}_charges`)])),
    // how long each lasts (times the base) and the chance to gain one more when you gain one
    chargeTime: Object.fromEntries(['frenzy', 'power', 'endurance'].map(c => [c, 1 + v(sum, 'charge_duration_+%', `${c}_charge_duration_+%`, `base_${c}_charge_duration_+%`) / 100])),
    delayHit: { less: v(sum, 'chronomancer_damage_taken_+%_final'), later: v(sum, 'chronomancer_take_%_of_hit_damage_4_seconds_after_being_hit') },   // Chronomancer
    chargeMore: Object.fromEntries(['frenzy', 'power', 'endurance'].map(c => [c, v(sum, `chance_to_gain_1_more_${c}_charge_%`)])),
    chargeFill: Object.fromEntries(['frenzy', 'power', 'endurance'].map(c => [c, v(sum, `gain_maximum_${c}_charges_on_${c}_charge_gained_%_chance`)])),   // the chance to gain the most of that kind
    res, penalty,
    // the armour's movement penalty is apart from the increases (the game's panel, 17/11: 25% boots, -4% body armour: +20.0%)
    move: (1 + (v(sum, 'base_movement_velocity_+%') - worn.movement) / 100) * (1 + (sum.ignore_armour_movement_penalties ? 0 : worn.movement) / 100) * 100 - 100,   // Momentum: no penalty
    attackSpeed: v(sum, 'attack_speed_+%', 'attack_and_cast_speed_+%'),
    castSpeed: v(sum, 'base_cast_speed_+%', 'attack_and_cast_speed_+%'),
    critInc: v(sum, 'critical_strike_chance_+%'),
    critBonus: sum.no_critical_strike_multiplier ? 0 : sum.critical_strike_multiplier_is_250 ? 250 : 100 + v(sum, 'base_critical_strike_multiplier_+'),  // documented game rule: every character has +100% base critical damage bonus
    // character.ot: accuracy per level above the first
    accuracy: Math.round(((CHAR.accuracy_rating_per_level || 0) * (lvl - 1) + v(sum, 'accuracy_rating') + (mw?.accuracy || 0) + fromAttr('accuracy') + (sum.gain_accuracy_rating_equal_to_intelligence ? at.int : 0) + (sum.gain_accuracy_rating_equal_to_strength ? at.str : 0)) * accInc * (sum.accuracy_rating_is_doubled ? 2 : 1)), accuracyInc: accInc,
    // the tree's increased accuracy in a state, its accuracy against Bleeding enemies (the scene checks them on each attack)
    accWhen: ACC_WHEN.filter(([k]) => sum[k]).map(([k, cv, en]) => ({ cond: en ? { type: 'ActorCondition', actor: 'enemy', var: cv } : { type: 'Condition', var: cv }, val: sum[k] })), accBleed: v(sum, 'accuracy_rating_vs_bleeding_enemies') * accInc * (sum.accuracy_rating_is_doubled ? 2 : 1),
    accCrit: v(sum, 'accuracy_rating_+%_equal_to_%_attack_critical_strike_chance'),   /* Pinpoint Shot: increased accuracy, its share of the attack's critical hit chance */ lances: v(sum, 'spear_skills_inflict_bloodstone_lance_on_hit'),
    // the most accuracy your attacks lose with distance (KeywordPopups Accuracy: up to 90% less), unless something says they do not
    accuracyFalloff: v(sum, 'accuracy_is_unaffected_by_distance', 'deadeye_accuracy_unaffected_by_range', 'main_hand_accuracy_is_unaffected_by_distance',
      'base_main_hand_accuracy_is_unaffected_by_distance', 'local_weapon_accuracy_is_unaffected_by_distance') ? 0 : 90 * pct('accuracy_range_penalty_+%', 'distance_scaled_accuracy_rating_penalty_+%'),
    missingBase: lifeBase == null,
    // thorns (keywords.json: a Hit of yours, not an attack nor a spell, dealt back to an enemy whose melee attack hits you):
    // its base with its increases (thornsX, for thorns a buff adds), its crit, the build's ailments on hits
    // runic ward: flat ward, and the share of maximum life some modifiers grant as ward, scaled by increased ward
    // Plants Overgrow: a chance as each is created (passives), a chance as it enters your Presence (items), that Presence's
    // radius in metres (character.ot, its area scaled like calc's sheet)
    arcaneSurge: { crit: v(sum, 'gain_arcane_surge_on_crit_%_chance'), effect: pct('arcane_surge_effect_on_self_+%'), always: !!sum.base_should_have_arcane_surge_from_stat, missing: v(sum, 'arcane_surge_effect_on_self_+%_per_10%_missing_mana') },   // its chance on a critical hit, its effect on you; Stormweaver's: always, more effect per 10% missing mana
    overgrow: { now: v(sum, 'chance_for_plants_to_be_overgrown_%'), near: v(sum, 'chance_%_for_plants_to_overgrow_when_entering_your_presence'),
      r: CHAR.base_presence_radius * Math.sqrt(pct('presence_area_+%')) * (sum.unique_double_presence_radius ? 2 : 1) / 10, archon: v(sum, 'chance_%_to_gain_archon_of_nature_on_overgrowing_plant'),
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
    // Amanamu's Defiance (keystone_amanamus_defiance): 20% of the life hits take prevented, 150% of it lost over 4 seconds (its text's numbers)
    amanamu: sum.keystone_amanamus_defiance ? { prevent: 20, lose: 150 } : null,
    // the other Abyss keystones (their text's numbers): Tecrod's Brutality, 1 life a second per 16 life spent in the
    // past 4 seconds; Kurgal's Ambition, mana regeneration Overflows; Kulemak's Sovereignty, 1% more damage per 2 total
    // Power of your Undead minions
    tecrod: sum.keystone_tecrods_brutality ? { per: 16, secs: 4 } : null, kurgal: !!sum.keystone_kurgals_ambition, kulemak: sum.keystone_kulemaks_sovereignty ? 2 : 0,
    ulaman: !!sum.keystone_ulamans_vision,   // Ulaman's Vision: each projectile Forks or Chains once more, or Chains from terrain, or cannot collide
    headhunter: sum.gain_rare_monster_mods_on_kill_ms ? 60 : 0,   // Headhunter: its text's 60 seconds
    esLowMore: v(sum, 'djinn_ascendancy_energy_shield_recharge_rate_+%_final_on_low_energy_shield'),   // The Fourth Teaching: more recharge rate on low energy shield
    pinStop: v(sum, 'pin_stops_enemies') > 0,   // Tactician's Right Where We Want Them: Pinned enemies cannot perform actions
    totemWall: v(sum, 'damage_removed_from_your_nearest_totem_before_life_or_es_%'),   // Warbringer's Wooden Wall
    implode: !!sum.fully_broken_armour_and_sundered_armour_you_inflict_applies_to_all_damage,   // Warbringer's Imploding Impacts: Fully Broken Armour increases all hit damage taken
    cry: { debil: !!sum.warcries_debilitate_enemies_for_1_second, weak: v(sum, 'warcries_inflict_x_critical_weakness_on_enemies'), noIgnite: !!sum.remove_ignite_on_warcry, more: v(sum, 'warcry_empowers_next_x_melee_attacks'), min: sum.warcries_have_minimum_10_power ? 10 : 0 },   // the tree's warcries
    minionRegen: v(sum, 'life_and_mana_regeneration_rate_+%_for_each_minion_in_your_presence_capped'),
    bellow: { free: !!sum.warcries_bypass_cooldown, corpse: v(sum, 'corpses_in_your_area_of_effect_explode_dealing_%_maximum_life_physical_damage_on_warcry') },   // Warbringer's Warcaller's Bellow
    chargeGen: [v(sum, 'generate_x_charges_for_life_flasks_per_minute'), v(sum, 'generate_x_charges_for_mana_flasks_per_minute'), v(sum, 'generate_x_charges_for_charms_per_minute')],   // life / mana flask and charm charges a minute
    watch: v(sum, 'totems_nearby_enemies_damage_taken_+%'),   // Watchtowers: each totem's increased damage taken for the enemies in its Presence
    blast: { cursed: v(sum, 'explode_cursed_enemies_for_25%_life_as_chaos_on_kill_chance_%'), allyCursed: v(sum, 'allies_in_presence_have_explode_cursed_enemies_for_25%_life_as_chaos_on_kill_chance_%'), any: v(sum, 'witchhunter_chance_to_explode_enemies_for_100%_of_life_as_physical'),
      burning: v(sum, 'explode_burning_enemies_for_10%_life_as_fire_on_kill_chance_%'), empowered: v(sum, 'explode_enemies_for_10%_life_as_fire_on_kill_with_empowered_attacks_chance_%') },   // Lich's Rupture the Soul (a quarter of their life as chaos), Witchhunter's Zealous Inquisition (all of it as physical)
    // Shaman's Reactive Growth / Avatar of Evolution: Adaptations to the highest elemental type of each hit you take (KeywordPopups Adaptation: 3 at a time, no duration unless one is given)
    adapt: sum.gain_X_adaptation_matching_type_when_hit_by_elemental_damage ? { gain: sum.gain_X_adaptation_matching_type_when_hit_by_elemental_damage, max: v(sum, 'base_max_adaptations') || 3,
      per: v(sum, 'ascendancy_druid_shaman_elemental_damage_taken_+%_final_per_matching_adaptation') * (sum.double_adaptation_effect ? 2 : 1), less: v(sum, 'ascendancy_shaman_reactive_growth_elemental_damage_taken_+%_final'), dur: v(sum, 'adaptation_duration_ms') / 1000 || Infinity } : null,
    lifeReserved: v(sum, 'life_reserved_by_stat_only_for_midnight_bargain_and_infernalist_%') + (b.gems || []).reduce((t, g) => t + reservation(g, sum, b, true), 0),   // Infernalist's Beidat's Gaze and Atziri's Communion: their share of life reserved
    presCd: v(sum, 'enemies_in_presence_cooldown_recovery_+%'),   // the increased (reduced) cooldown recovery of enemies in your Presence
    presExpo: !!sum.enemies_in_presence_have_exposure,   // Shaman's Turning of the Seasons
    // Blood Mage's Sanguine Tides: life flask charges per 2% of life spent (its text), a hit while the life flask is full consuming its share of the charges
    // for its share of damage gained as physical per charge, for its duration; flasks recover no life
    parryRange: v(sum, 'active_block_maximum_distance_+%'),   // increased Parry Range
    offerEff: v(sum, 'offering_spells_effect_+%'),
    lowFlask: v(sum, 'life_recovery_+%_from_flasks_while_on_low_life'),   // increased life recovery from flasks used on Low Life
    tides: sum.blood_mage_life_flask_buff_duration_ms ? { gain: v(sum, 'gain_X_life_flask_charges_per_4%_life_spent'), use: v(sum, 'blood_mage_life_flask_buff_%_charges_to_consume'),
      per: v(sum, 'blood_mage_life_flask_buff_%_damage_to_gain_as_physical_per_charge_consumed'), dur: sum.blood_mage_life_flask_buff_duration_ms / 1000, dry: !!sum.base_life_flasks_do_not_recover_life } : null,
    shot: [v(sum, 'deadeye_projectile_damage_+%_final_max_as_distance_travelled_decreases'), v(sum, 'deadeye_projectile_damage_+%_final_max_as_distance_travelled_increases')],   // Deadeye's Point Blank / Far Shot: projectile hits' more damage by how far they have travelled
    sands: !!sum['chronomancer_grant_cast_speed_+%'],   // Chronomancer's Quicksand Hourglass: Sands of Time
    frenzyX: v(sum, 'chance_%_to_double_effect_of_removing_frenzy_charges'),   // Deadeye's Thrilling Chase: chance to double what consuming a frenzy charge gives
    cover: !!sum.enemy_hits_against_you_have_distance_based_accuracy_falloff,   // Tactician's Stay Light, Use Cover: enemies' accuracy falls off with distance, as yours
    whisper: v(sum, 'ascendancy_whispers_of_the_flesh_cursed_enemies_have_at_least_life_reserved_%'),   // Blood Mage's Whispers of the Flesh: that share of a Cursed enemy's life reserved
    // Infernalist's Seething Body: Elemental Archon on casting a spell on High Infernal Flame, kept while on it, lost on reaching the most (SK.archon_time: the Archon keyword's time and recovery)
    earch: sum.gain_elemental_archon_when_you_cast_a_spell_while_on_high_infernal_flame || sum['gain_archon_elemental_after_spending_100%_of_your_maximum_mana'] ? { mana: !!sum['gain_archon_elemental_after_spending_100%_of_your_maximum_mana'], cast: !!sum.gain_elemental_archon_when_you_cast_a_spell_while_on_high_infernal_flame, time: SK.archon_time[0] * pct('archon_duration_+%'), delay: sum.archon_no_recovery_period ? 0 : SK.archon_time[1] / pct('archon_delay_expires_x%_faster'),
      keep: !!sum.elemental_archon_does_not_expire_while_on_high_infernal_flame, full: !!sum.lose_elemental_archone_on_reaching_full_infernal_flame } : null,
    elixir: !!sum.life_flask_effects_are_not_removed_at_full_life,   // Pathfinder's Enduring Elixirs
    tailwind: sum.gain_tailwind_stack_on_skill_use ? { lose: !!sum.lose_all_tailwind_when_hit } : null,   // Deadeye's Gathering Winds: a Tailwind stack on each skill use
    // the Amazon's Predatory Instinct: Revealed Weaknesses, its more damage against an enemy with an Open Weakness; In for the Kill: movement and skill speed against them
    weakness: sum.bloodlust_reveal_weakness || sum.unique_reveal_weakness ? { more: v(sum, 'damage_+%_final_against_bloodlusting_enemies'), move: v(sum, 'movement_speed_+%_against_bloodlusting_enemies'), speed: v(sum, 'skill_speed_+%_against_bloodlusting_enemies'),
      rareOnly: !sum.bloodlust_reveal_weakness, recoupL: v(sum, 'recoup_%_of_damage_taken_from_enemies_with_open_weakness_as_life'), recoupLE: v(sum, 'recoup_%_of_damage_taken_from_enemies_with_open_weakness_as_life_and_energy_shield') } : null,   // The Master's Reach: against rare and unique enemies, its damage taken from them recouped
    charmMana: v(sum, 'drain_%_max_mana_to_activate_expended_charms'),   // Ritualist's Mind Phylacteries: that share of maximum mana for a charm without the charges
    // the tree: Thirst for Power / Endurance's chance of one more charge; Harness the Elements' increased damage per elemental ailment
    // on the enemy; Deep Freeze's cold resistance of the Frozen; Urgent Call's life and mana on a warcry; Ancestral Alacrity's attack
    // and cast speed after summoning a totem; First Sting's poison magnitude on the not yet Poisoned
    more1: { power: v(sum, 'chance_to_gain_1_more_power_charge_%'), endurance: v(sum, 'chance_to_gain_1_more_endurance_charge_%') }, perAil: v(sum, 'damage_+%_per_enemy_elemental_ailment'),
    frozenRes: v(sum, 'freeze_applies_cold_resistance_+'), ignitedRes: v(sum, 'ignites_apply_fire_resistance_+'), expoExtra: v(sum, 'exposure_you_inflict_lowers_affected_resistance_by_extra_%'),
    markedAcc: v(sum, 'marked_enemy_accuracy_rating_+%'), avoidDeath: v(sum, 'chance_to_avoid_death_%'), offerHeal: v(sum, 'recover_%_life_when_you_create_an_offering'), chaosLoss: v(sum, 'lose_%_of_life_and_energy_shield_when_you_use_a_chaos_skill'), flaskLifeCost: v(sum, 'skill_mana_costs_converted_to_life_costs_%_during_life_flask'), gloryLife: v(sum, 'recover_%_maximum_life_per_glory_consumed'), moveProj: v(sum, 'projectile_attacks_%_chance_to_fire_2_additional_projectiles_while_moving'),
    mountOk: mwTags.includes('bow') || mwTags.includes('spear'), cullBow: !!sum.bow_attacks_have_culling_strike && mwTags.includes('bow'),   // Rhoa Mount: mounted only while wielding a Bow or Spear
    axeOns: mwTags.includes('axe') ? v(sum, 'chance_to_gain_onslaught_on_kill_with_axes_%') : 0, meleeProj: v(sum, 'melee_strike_range_+_if_youve_dealt_projectile_attack_hit_recently') / 10, forkMelee: v(sum, 'projectiles_fork_chance_%_if_youve_dealt_melee_hit_recently'),
    surrArea: v(sum, 'surrounded_area_of_effect_+%'), rollSurr: v(sum, 'dodge_roll_travel_distance_+_while_surrounded') / 10, echoSpeed: v(sum, 'cast_speed_+%_per_spell_echoed_recently_up_to_30%'), igniteFire: v(sum, 'permanent_fire_damage_+%_per_second_of_ignite_up_to_10%'),
    flaskGuard: v(sum, 'gain_%_of_expected_recovery_over_1_second_as_guard_on_life_flask_use'), blockDaze: v(sum, 'daze_enemies_on_block_with_shield_raised_chance_%'), invokeMax: v(sum, 'invocation_skill_maximum_energy_+%'),
    invokeHalf: v(sum, 'invocation_spell_chance_to_cost_half_energy_%'), trigRefund: v(sum, 'trigger_skills_refund_half_energy_spent_chance_%'),
    resummon: { base: (CHAR.global_resummon_time_ms || 0) / 1000, speed: 1 + v(sum, 'minion_resummon_speed_+%') / 100 },   // Reviving Minions: their delay (character stats), faster with the tree
    // Spirit Walker's Vivid Stampede: a Vivid Wisp every so many metres moved (its tenths), up to its most; The Mórrigan's
    // Guidance's more damage and Shock magnitude per leap and Wisps when it ends; Sacred Unity's leap toward enemies within its angle
    vivid: sum.vivid_stag_maximum_stag_wisps_allowed ? { max: sum.vivid_stag_maximum_stag_wisps_allowed, per: v(sum, 'vivid_stag_metres_travled_per_wisp_gain') / 10, more: v(sum, 'vivid_stag_damage_%_final_per_cascade'),
      shock: v(sum, 'vivid_stag_shock_effect_%_final_per_cascade'), onEnd: v(sum, 'ascendancy_vivid_stag_gain_wisps_on_end'), home: v(sum, 'ascendancy_vivid_stag_home_in_on_enemies_within_X_angle_in_front') } : null,
    lament: { life: v(sum, 'consume_X_life_instead_of_last_crossbow_bolt'), load: v(sum, 'chance_to_load_a_bolt_on_killing_an_enemy_%') },   // The Last Lament
    olro: v(sum, 'local_maximum_added_lightning_damage_equal_to_total_monster_power_of_enemies_hit_in_past_20_seconds_up_to_X'),   // Olrovasara: its most
    bloodHit: v(sum, '%_of_physical_hit_damage_you_deal_causes_additional_blood_loss'),   // Atziri's Acuity
    regrow: sum.base_maximum_fragile_regrowth ? { max: sum.base_maximum_fragile_regrowth, gain: v(sum, 'gain_x_fragile_regrowth_per_second'), life: v(sum, 'life_regeneration_rate_per_minute_%_per_fragile_regrowth'), mana: v(sum, 'mana_regeneration_rate_+%_per_fragile_regrowth'), lose: !!v(sum, 'lose_all_fragile_regrowth_when_hit') } : null,   // Dustbloom
    prowess: v(sum, 'gain_druidic_prowess_per_X_rage_spent'),   // Amor Mandragora
    volCold: v(sum, 'volatility_physical_damage_taken_%_as_cold'),   // Dream Fragments
    molten: v(sum, 'local_%_chance_to_trigger_molten_shower_on_hit_with_this_weapon_per_25_strength') * Math.floor((at.str || 0) / 25),   // Brutus' Lead Sprinkler: its chance per 25 Strength
    furyGround: v(sum, 'unique_boots_secondary_ground_ignite_while_moving_base_fire_damage_%_of_life'),   // Birth of Fury
    lethal: { pct: v(sum, 'consume_%_of_maximum_life_flask_charges_on_bow_attack'), add: v(sum, 'bow_attacks_deal_added_physical_damage_equal_to_x%_of_life_flask_recovery_amount') },   // The Lethal Draw
    allyRegen: v(sum, 'allies_in_presence_life_regeneration_rate_per_minute_equal_to_your_maximum_life_%'), allyRegenOwn: v(sum, 'allies_in_presence_life_regeneration_rate_per_minute_equal_to_their_maximum_life_%'), allyRegenBase: v(sum, 'base_life_regeneration_rate_per_minute') * v(sum, 'total_base_life_regeneration_rate_per_minute_%_granted_to_allies_in_your_presence') / 100,   // Allies in your Presence regenerate life per minute: its % of your maximum life, Sacred Flame's of their own, Guiding Palm's share of your base life regeneration
    stunDecay: v(sum, 'heavy_stun_poise_decay_rate_+%'), reviveCmd: v(sum, 'revive_persistent_minion_%_chance_when_you_use_a_command_skill'),
    // Archon of Undeath: the tree's chances to gain it; Puppet Master: the tree's (Surpassing) chance of a stack, its more stacks, their duration and effect
    debilShield: v(sum, 'debilitate_enemies_within_X_metres_while_active_blocking'),   // Debilitate in front of you while your Shield is raised (metres)
    undeath: { cmd: v(sum, 'chance_%_to_gain_archon_of_undeath_on_using_command_skill'), offer: v(sum, 'chance_%_to_gain_archon_of_undeath_when_you_create_an_offering') },
    puppet: { ch: v(sum, 'surpassing_chance_%_to_gain_1_puppeteer_stack_on_using_command_skill'), max: v(sum, 'max_puppet_master_stacks_+'), dur: pct('puppet_master_duration_+%'), eff: pct('puppet_master_effect_+%') }, tempMinion: v(sum, 'temporary_minion_limit_+'), totemRange: v(sum, 'totem_placement_range_+%'),
    orbLimit: v(sum, 'orb_skill_limit_+'), elLimit: v(sum, 'elemental_skill_limit_+'), fissureLimit: v(sum, 'fissure_skills_limit_+'),
    splash: sum.melee_splash ? 100 : mwTags.includes('mace') ? v(sum, 'your_mace_strike_melee_splash_chance_%') : 0, volMinion: v(sum, 'gain_X_volatility_on_persistent_minion_death'), reviveLife: v(sum, 'you_gain_%_life_when_one_of_your_minions_is_revived'),
    bannerBack: v(sum, 'on_banner_expiry_recover_%_of_required_glory'), bannerLinger: v(sum, 'banner_buff_lingers_for_X_seconds_after_leaving_area'), shockBack: v(sum, 'reapply_enemy_shock_on_consuming_enemy_shock_chance_%'), rareGlory: v(sum, 'gain_1_glory_every_X_seconds_per_rare_unique_monster_in_presence'), shockSpread: v(sum, 'shock_enemies_in_150cm_radius_on_shock_chance_%'),
    volRefresh: v(sum, 'volatility_refresh_%_chance'), remnantTwice: v(sum, 'created_remnants_have_%_chance_to_duplicate_pick_up_results'), hazArmour: v(sum, 'enemies_affected_by_your_hazards_recently_have_+%_armour'), revertRage: v(sum, 'consume_rage_when_reverting_to_recover_x%_maximum_life_per_rage'),
    remnantPick: { life: v(sum, 'remnant_recover_%_life_on_pickup'), mana: v(sum, 'remnant_recover_%_mana_on_pickup') }, cryHeal: v(sum, 'restore_life_and_mana_on_warcry_%'), totemSpeed: v(sum, 'attack_and_cast_speed_+%_on_placing_totem'), firstPoison: v(sum, 'poison_effect_+%_vs_non_poisoned_enemies'),
    brew: !!sum.life_mana_flasks_restore_mana_life,   // Amazon's Azmeri Brew: life flasks also recover mana, mana flasks life
    storm: v(sum, 'trigger_elemental_storm_on_crit') > 0,   // the Stormweaver's Elemental Storm on spell critical hits
    get ward() { return (v(sum, 'base_maximum_ward') + (this.life || 0) * v(sum, 'maximum_life_%_to_gain_as_total_ward') / 100) * pct('maximum_ward_+%'); },
    thorns: { hits: { physical: [v(sum, 'thorns_minimum_base_physical_damage'), v(sum, 'thorns_maximum_base_physical_damage')].map(x => Math.round(x * thornsX)), fire: [v(sum, 'thorns_minimum_base_fire_damage'), v(sum, 'thorns_maximum_base_fire_damage')].map(x => Math.round(x * thornsX)) },
      crit: v(sum, 'base_thorns_critical_strike_chance'), critBonus: 100 + v(sum, 'base_critical_strike_multiplier_+', 'base_thorns_critical_strike_multiplier_+'), ignoreArmour: v(sum, 'thorns_damage_has_%_chance_to_ignore_armour'), lifeShift: v(sum, 'gain_physical_thorns_damage_equal_to_x%_of_maximum_life_while_shapeshifted'), ail: ailments({}, sum, {}, []), thornsX },
  };
  // Blood Mage: more life, the body armour's own energy shield; Infernalist: mana, energy shield and Spirit per so much of
  // your maximum life; Invoker: Spirit per evasion and energy shield on the body armour. note: added to the totals, after
  // their increases (the game's order is not in the data)
  const per = (k, n) => n ? Math.floor(k / n) : 0;
  if (c.life != null) c.life += Math.round(pieceDef(b.items, 'body', 'energy_shield') * v(sum, 'gain_%_life_from_body_es') / 100);
  if (c.life != null) { if (c.mana != null) c.mana += per(c.life, sum['ascendancy_beidats_gaze_mana_+_per_X_maximum_life']); c.es += per(c.life, sum['ascendancy_beidats_hand_energy_shield_+_per_X_maximum_life']); c.spirit += per(c.life, sum['ascendancy_beidats_will_spirit_+_per_X_maximum_life']); }
  // Fleshcrafting, Enhanced Barrier: that share of maximum life converted to maximum energy shield
  const LC = c.life != null && Math.min(100, v(sum, 'maximum_life_%_to_convert_to_maximum_energy_shield')); if (LC) { const k = Math.round(c.life * LC / 100); c.life -= k; c.es += k; }
  // uniques: life or mana as extra energy shield (Atziri's Disdain, The Everlasting Gaze), mana as armour (Waveshaper),
  // energy shield equal to a share of Strength (Geofri's Sanctuary)
  c.es += Math.round((c.life || 0) * v(sum, 'maximum_life_%_to_gain_as_maximum_energy_shield') / 100 + (c.mana || 0) * v(sum, 'mana_%_to_gain_as_energy_shield') / 100);
  const MA = Math.round((c.mana || 0) * v(sum, 'mana_%_to_gain_as_armour') / 100); if (MA) { c.armour += MA; c.armourPct = armourReduction(c.armour, lvl); }
  // Flesh Crucible's less life, mana, defences and Spirit
  const VS = k => 1 + v(sum, `vivisection_${k}_+%_final`) / 100;
  if (c.life != null) c.life = Math.round(c.life * VS('maximum_life')); if (c.mana != null) c.mana = Math.round(c.mana * VS('maximum_mana')); c.spirit = Math.round(c.spirit * VS('spirit'));
  if (VS('armour_evasion_energy_shield') !== 1) { for (const k of ['armour', 'evasion', 'es']) c[k] = Math.round(c[k] * VS('armour_evasion_energy_shield')); c.armourPct = armourReduction(c.armour, lvl); c.evadePct = evadeChance(c.evasion, lvl); }
  // Immaculate Adherence: maximum energy shield converted to maximum Divinity (its increased, less per corrupted item equipped); no energy shield
  const toDiv = sum['convert_100%_energy_shield_to_divinity'];
  if (toDiv) { const nC = Object.values(b.items || {}).filter(it => it?.corrupted).length; c.divinity = Math.round(c.es * Math.max(0, 1 + (v(sum, 'maximum_divinity_+%') + v(sum, 'maximum_divinity_+%_per_equipped_corrupted_item') * nC) / 100)); c.divCost = !!sum.skills_cost_divinity_instead_of_mana_or_life; }
  if (toDiv || sum.cannot_have_current_energy_shield) c.es = 0;
  // resistances per equipped item with a modifier to another one (Safrin's Resolve, Eshtera's Path, Zaida's Longevity).
  // note: a modifier to all elemental resistances is not counted as one to each
  for (const [k, of, to] of [['cold_and_lightning_resist_+_per_equipped_item_with_a_fire_resistance_mod', 'fire', ['cold', 'lightning']], ['fire_and_cold_resist_+_per_equipped_item_with_a_lightning_resistance_mod', 'lightning', ['fire', 'cold']], ['fire_and_lightning_resist_+_per_equipped_item_with_a_cold_resistance_mod', 'cold', ['fire', 'lightning']]]) {
    if (!sum[k]) continue;
    const n = Object.values(b.items || {}).filter(it => Object.keys(statsOf(it)).some(id => id.includes(of) && /_resistance_%$/.test(id) && !id.includes('maximum'))).length;
    for (const e of to) { const r = c.res[e]; r.value += n * sum[k]; r.capped = Math.min(r.value, r.max); }
  }
  // uniques' more Global Evasion Rating and Energy Shield
  const HW = pct('hand_wraps_evasion_rating_and_energy_shield_+%_final'); if (HW !== 1) { c.evasion = Math.round(c.evasion * HW); c.evadePct = evadeChance(c.evasion, lvl); c.es = Math.round(c.es * HW); }
  // Queen of the Forest: its movement speed alone, 25% and 1% per so much evasion, up to 75% (its text's numbers)
  const QF = sum['movement_speed_is_only_base_+1%_per_x_evasion_rating']; if (QF) c.move = Math.min(75, 25 + Math.floor(c.evasion / QF));
  // Decree of Loyalty: 1% of maximum life to twice as much armour per 1% chaos resistance above 0%
  const DL = c.life != null && Math.min(100, Math.max(0, c.res.chaos.capped) * v(sum, 'maximum_life_%_to_convert_to_twice_as_much_armour_per_1%_chaos_resistance'));
  if (DL) { const k = Math.round(c.life * DL / 100); c.life -= k; c.armour += 2 * k; c.armourPct = armourReduction(c.armour, lvl); }
  const GS = sum['unique_body_armour_maximum_energy_shield_override_is_%_of_strength']; if (GS) c.es = Math.round(at.str * GS / 100);
  // thorns from your maximum life (Cat O' Nine Tails: physical) and mana (Icetomb: cold), the scene's of its current maximum
  c.thorns.life = ['gain_minimum_physical_thorns_damage_equal_to_x%_of_maximum_life', 'gain_maximum_physical_thorns_damage_equal_to_x%_of_maximum_life'].map(k => v(sum, k));
  c.thorns.manaCold = v(sum, 'added_thorns_cold_base_damage_%_of_maximum_mana');
  // the critical damage bonus of hits against you, as a share: the Oracle's and the Smith's less; Gemling's Gem Studded none
  // while red supports are the most socketed in your skills
  if (sum.lightning_resistance_does_not_apply_to_lighting_damage) c.resOff = 'lightning';   // Doryani's Prototype
  c.selfCrit = sum.self_take_no_extra_damage_from_critical_strikes || sum.no_self_critical_strike_multiplier_if_red_support_count_highest && SN.str && SN.str >= SN.dex && SN.str >= SN.int ? 0 : Math.max(0, 1 - v(sum, 'base_self_critical_strike_multiplier_-%', 'body_armour_grants_x_base_self_critical_strike_multiplier_-%') / 100);
  // Shaman's Sacred Flow: Spirit per charm slot (the belt's, the Ritualist's more) with no charm in it
  c.emptyCharms = Math.max(0, Math.min(3, v(sum, 'local_charm_slots', 'local_additional_charm_slots', 'num_charm_slots')) - ['charm1', 'charm2', 'charm3'].filter(k => b.items?.[k]).length);
  c.spirit += v(sum, 'spirit_+_per_empty_charm_slot') * c.emptyCharms;
  c.spirit += per(pieceDef(b.items, 'body', 'evasion'), sum['+1_spirit_per_X_evasion_rating_on_body_armour']) + per(pieceDef(b.items, 'body', 'energy_shield'), sum['+1_spirit_per_X_energy_shield_on_body_armour']);
  // Acolyte of Chayula's Embrace the Darkness: no Spirit; maximum Darkness, its base and per level, with its increases (per 1% chaos
  // resistance too); damage taken is reserved from it before life or energy shield, each reservation lasting its time
  // keystones, as their texts say: Chaos Inoculation (maximum life 1, immune to chaos damage and bleeding), Eldritch Battery
  // (maximum energy shield converted to maximum mana), Blood Magic (no mana), Iron Reflexes (evasion converted to armour),
  // Resolute Technique (accuracy doubled), Lord of the Wilds (50% less Spirit)
  // the tree's immunities on a condition of your gear: the helmet's higher armour or evasion, the colour most of your
  // socketed supports have, a body armour worn (Unaffected by Damaging Ailments: as immune here); and those of a state
  // (the scene's: an Archon buff, shapeshifted, dodge rolling, leeching mana)
  { const H = k => P('helmet', k), N = SN.str + SN.dex + SN.int, most = a => N > 0 && SN[a] > N / 2, dmgAil = !!(sum.body_armour_grants_unaffected_by_damaging_ailments && b.items?.body);
    c.immuneIf = { bleed: dmgAil || !!sum.base_unaffected_by_bleeding || !!sum.immune_to_bleeding_if_helmet_grants_higher_armour_than_evasion && H('armour') > H('evasion'),
      poison: dmgAil || !!sum.immune_to_poison_if_helmet_grants_higher_evasion_than_armour && H('evasion') > H('armour'), ignite: dmgAil || !!sum.immune_to_ignite_if_majority_red_supports_socketed && most('str'),
      chill: !!sum.immune_to_chill_if_majority_blue_supports_socketed && most('int'), shock: !!sum.immune_to_shock_if_majority_green_supports_socketed && most('dex'), maim: !!sum.immune_to_maim };
    const when = o => Object.entries(o).flatMap(([k, a]) => sum[k] ? a : []);
    c.immuneWhen = { archon: when({ immune_to_bleeding_while_archon: ['bleed'], immune_to_freeze_chill_while_archon: ['freeze', 'chill'], immune_to_shock_while_archon: ['shock'] }),
      shift: when({ immune_to_bleeding_while_shapeshifted: ['bleed'], immune_to_maim_while_shapeshifted: ['maim'] }), roll: when({ unaffected_by_chill_during_dodge_roll: ['chill'] }), leech: when({ unaffected_by_chill_while_mana_leeching: ['chill'] }) }; }
  if (sum.keystone_chaos_inoculation) { c.life = 1; c.res.chaos = { ...c.res.chaos, capped: 100, immune: true }; c.bleedImmune = true; }
  if (sum.keystone_eldritch_battery && c.mana != null) { c.mana += c.es; c.es = 0; }
  if (sum.keystone_blood_magic && c.mana != null) c.mana = 0;
  if (sum.keystone_iron_reflexes) { c.armour += c.evasion; c.evasion = 0; c.armourPct = armourReduction(c.armour, lvl); c.evadePct = 0; }
  if (sum.base_cannot_evade) c.evadePct = c.evadeMax = 0;   // Bramblejack: no chance to evade with whatever evasion (the hits roll against evadeMax; what is worked out from the evasion still counts it)
  if (sum.resolute_technique) c.accuracy *= 2;
  if (sum.keystone_lord_of_the_wilds) c.spirit = Math.round(c.spirit / 2);
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
  const esD = k => (1 + v(sum, 'energy_shield_delay_-%') / 100) / (1 + v(sum, 'energy_shield_delay_-%', k) / 100);   // the start of the recharge under a condition, against always
  const umag = 1 + Math.floor((c.mana || 0) / 100) * v(sum, 'unholy_might_granted_magnitude_+%_per_100_maximum_mana') / 100;   // Lich: the Unholy Might you have and grant
  const recMore = 1 + v(sum, 'map_player_life_and_es_recovery_speed_+%_final') / 100;   // a map's less Recovery Rate of Life and Energy Shield (the simulator's)
  const lifeInc = pct('life_regeneration_rate_+%', 'life_recovery_rate_+%'), manaInc = pct('mana_regeneration_rate_+%', 'mana_recovery_rate_+%') * (sum.keystone_mana_shield ? .5 : 1) * (sum.keystone_kurgals_ambition ? .5 : 1);   // Mind Over Matter, Kurgal's Ambition: 50% less
  return {
    recMore,
    // Titanrot Cataphract: none; Mask of the Stitched Demon: per maximum energy shield
    lifeRegen: sum.no_life_regeneration ? 0 : lifePctRegen && c.life == null ? null
      : (v(sum, 'base_life_regeneration_rate_per_minute') + (c.es || 0) * v(sum, 'life_regeneration_per_minute_per_maximum_energy_shield') + (c.life || 0) * lifePctRegen / 100) / 60 * lifeInc * recMore,
    // enemies' elemental resistances: ignored by your critical hits (Beacon of Azis; Choir of the Storm: lightning), none in
    // your Presence (The Coming Calamity), resisted by their lowest (Leopold's Applause; in your Presence: Sacred Flame)
    critIgnoreRes: sum.critical_strikes_ignore_elemental_resistances ? ['fire', 'cold', 'lightning'] : sum.critical_strikes_ignore_lightning_resistance ? ['lightning'] : null,
    presence: { blind: !!sum.enemies_in_presence_are_blinded, intim: !!sum.enemies_in_presence_are_intimidated, hinder: !!sum.base_enemies_in_your_presence_are_hindered },   // Sandstorm Visage, Perfidy, Amor Mandragora
    noResNear: !!sum.enemies_in_presence_have_no_elemental_resistances, lowestRes: !!sum.elemental_damage_resisted_by_lowest_elemental_resistance, lowestResNear: !!sum.enemies_in_presence_elemental_damage_resisted_by_lowest_elemental_resistance,
    leechOver: !!sum.life_leech_can_overcap_life, leechToEs: !!sum.life_leech_excess_goes_to_energy_shield,   // Couture of Crimson; Soul Tether (the scene plays them)
    minionRage: { dmg: v(sum, 'minion_damage_+%_per_rage'), speed5: v(sum, 'minion_attack_speed_+%_per_five_rage'), hit: v(sum, 'minion_damage_+%_if_enemy_hit_recently') },   // the tree's: your Rage, your hits
    armourPerRage: v(sum, 'armour_+%_per_rage'), evasionPerRage: v(sum, 'evasion_rating_+%_per_rage'), defPerTotem: v(sum, 'armour_and_evasion_rating_+%_per_active_totem_in_presence'), movePerFrenzy: v(sum, 'movement_velocity_+%_per_frenzy_charge'),   // Horns of Bynden; Darkray Vectors
    lifeToEs: !!sum.regenerate_energy_shield_instead_of_life,   // Ligurium Talisman, Soul Tether: life regeneration applied to energy shield instead (the scene plays it)
    manaNoCrit: !!sum.no_mana_regeneration_if_not_crit_recently,   // Nightscale: none unless you crit recently (the scene checks it)
    lightResNear: !!sum.enemies_in_presence_lightning_resist_equal_to_yours, onsKill: v(sum, 'onslaught_buff_duration_on_kill_ms') / 1000,   // Doryani's Prototype; Death Rush
    skillLife: v(sum, 'lose_x_life_when_you_use_skill'), rageCritTaken: v(sum, 'gain_x_rage_when_taken_crit'),   // Crown of Thorns; Bristleboar
    esOnManaFlask: !!sum.start_energy_shield_recharge_when_you_use_a_mana_flask, lowCap: !!sum.cannot_recover_above_low_life_except_flasks,   // Bitterbloom; Cat O' Nine Tails
    luckySurr: !!sum.attack_damage_is_lucky_if_surrounded,   // Empire's Grasp
    critShocked: v(sum, 'critical_bonus_+%_final_while_shocked'), critChilled: v(sum, 'enemy_hit_critical_strike_chance_+%_against_self_while_chilled'), critTaken: v(sum, 'base_enemy_critical_strike_chance_+%_against_self'),   // Berek's Respite; Berek's Grip
    chillTaken: !!sum.enemies_chilled_by_hits_take_damage_increased_by_chill_effect, witherForever: !!sum.wither_never_expires,   // Asphyxia's Wrath; Cospri's Will
    frozenTaken: v(sum, 'frozen_monsters_take_increased_damage'), noEleAil: !!sum.cannot_inflict_elemental_ailments,   // Taryn's Shiver; Plaguefinger
    blindPoison: !!sum.blind_on_poison_inflicted, flaskUnbleed: !!sum.remove_bleed_on_life_flask_use,   // Murkshaft; Zerphi's Genesis
    poisonKill: v(sum, 'recover_permyriad_maximum_life_per_poison_on_enemy_on_kill') / 100, killTwice: !!sum.on_kill_effects_occur_twice,   // Snakebite; Killjoy
    regenPulse: sum.life_recovery_from_regeneration_is_not_applied ? v(sum, 'recover_1_life_per_x_life_regeneration_per_minute_every_4_seconds') || Infinity : 0,   // Igniferis
    manaRegenOnly: !!sum.cannot_recover_mana_except_regeneration,   // Indigon
    // Guiding Palms: their Guided Shrine's Daemon; Palm of the Dreamer: Dreaming Gloom Shrine (enemies you kill explode)
    daemons: ['fire', 'cold', 'lightning'].filter(e => sum[`has_unique_${e}_shrine_effect`]), gloom: !!sum.has_unique_chaos_shrine_effect,
    areaKilled: v(sum, 'skill_area_of_effect_+%_if_enemy_killed_recently'), poisonFrenzy: v(sum, 'poison_duration_+%_if_consumed_frenzy_charge_recently'),   // Quecholli; Snakebite
    noManaLeech: !!sum.base_cannot_leech_mana,   // Lochtonial Caress
    shrineEvery: sum.local_gain_shrine_buff_every_10_seconds ? 10 : 0,   // The Hammer of Faith: a random lesser Shrine buff every 10 s (its stat's name)
    redflare: !!sum.gain_power_charge_per_second_if_have_not_lost_power_charge_recently, stunPerRage: v(sum, 'stun_threshold_+%_per_rage'),   // Redflare Conduit; Wings of Caelyn
    projBlock: v(sum, 'block_chance_+%_against_projectiles'), luckyBlock: !!sum.base_block_chance_luck, luckyDeflLow: !!sum.deflect_chance_is_lucky_while_on_low_life, deflMove: v(sum, 'deflection_rating_+%_while_moving'), deflSurr: v(sum, 'deflection_rating_+%_while_surrounded'),   // Rondel de Ezo, Svalinn, The Auspex, Atziri's Step; the tree's
    noLightStun: !!sum.cannot_be_light_stunned, noStunDeflected: !!sum.cannot_be_light_stunned_by_deflected_hits, loseRage: !!sum.lose_all_rage_on_reaching_maximum_rage, onsAlways: !!sum.base_should_have_onslaught_from_stat,   // Eye of Chayula, Atziri's Step, Hateforge, Thrillsteel
    perHit: { life: v(sum, 'base_life_gain_per_target'), mana: v(sum, 'mana_gain_per_target') },   // The Lethal Draw, Thief's Torment: per enemy hit with attacks
    leechChaos: !!sum.life_leech_recovers_based_on_your_chaos_damage_instead_of_physical_damage, leechLightning: !!sum.life_leech_also_recovers_based_on_lightning_damage, manaLeechCrit: v(sum, 'mana_leech_amount_+%_if_crit_recently'),   // Spire of Ire, The Ordained, Nightscale
    leechEs: !!sum.convert_all_life_leech_to_energy_shield_leech, manaLeechEs: !!sum.mana_leech_applies_recovery_to_energy_shield_also, recoupEs: !!sum.life_recoup_also_applies_to_energy_shield, esKeep: !!sum.energy_shield_recharge_is_not_interrupted_if_recharge_begaen_recently,   // Essentia Sanguis, Sacrosanctum, Prayers for Rain
    chillPois: !!sum.all_damage_taken_chills_you_while_poisoned, chillBleed: !!sum.all_damage_taken_chills_you_while_bleeding, energyX2: !!sum.energy_generation_is_doubled,   // Icefang Orbit, Venopuncture, Seeing Stars
    igniteChaos: !!sum.base_ignite_deals_chaos_instead, witherFire: !!sum.wither_inflicted_also_does_fire, witherIgn: !!sum.enemies_you_ignite_wither_does_not_expire, bleedFire: !!sum.bleed_damage_applies_as_fire_instead_of_physical, bleedSelfFire: !!sum.bleeding_damage_on_self_taken_as_fire_instead,   // Blackflame, Blistering Bond
    thornsAny: !!sum.thorns_proc_off_any_hit, noSprint: !!sum.cannot_sprint, gambleMove: v(sum, 'maximum_random_movement_velocity_+%_when_hit'), noCurseDelay: !!sum.unique_no_curse_delay, curseIgnore: !!sum.curse_ignores_curse_limit,   // Crown of the Pale King, Shankgonne, Gamblesprint, Windscream, Liminal Coil
    cullMark: !!sum.culling_strike_vs_marked_enemy, cullHeavy: !!sum.heavy_stuns_have_culling_strike,   // the tree's Culling Strike
    foeRegen: { bleed: !!sum.bleeding_enemies_cannot_regenerate_life, broken: !!sum.broken_armour_enemies_cannot_regenerate_life, pres: v(sum, 'enemies_in_presence_life_regeneration_+%'), cursed: v(sum, 'enemies_cursed_by_you_have_life_regeneration_rate_+%') },
    luckyLow: !!sum.damage_with_hits_is_lucky_vs_enemies_on_low_life, luckyHeavy: !!sum.damage_with_hits_is_lucky_vs_heavy_stunned_enemies, frozenNoRes: !!sum.hits_ignore_elemental_resistances_vs_frozen_enemies,
    noEvade: { heavy: !!sum.hits_cannot_be_evaded_vs_heavy_stunned_enemies, pin: !!sum.pinned_enemies_cannot_evade_your_attacks }, noCrit: { pin: !!sum.pinned_enemies_cannot_crit, mark: !!sum.marked_enemies_cannot_deal_critical_strikes },
    oneDmgAil: !!sum.cannot_have_more_than_1_damaging_ailment, igniteSelf: !!sum.ignites_reflected_to_self, armBreakTaken: v(sum, 'armour_break_taken_+%'),
    groundTaken: { fire: v(sum, 'enemies_in_chilled_ground_take_+%_fire_damage'), cold: v(sum, 'enemies_in_ignited_ground_take_+%_cold_damage') },
    cullRecent: v(sum, 'culling_strike_threshold_+%_if_culled_recently'), cullImmob: v(sum, 'culling_strike_threshold_+%_vs_immobilised_enemies'), cullRare: v(sum, 'culling_strike_threshold_+%_vs_rare_or_unique_monsters'), brokeShatter: !!sum.shatter_on_kill_if_fully_broken_armour, freezeFull: !!sum.local_always_freeze_on_full_life,   // Deathblow, Sculpted Suffering, Winter's Bite
    chillAll: !!sum.base_all_damage_taken_can_chill, chillReversed: !!sum.chill_effect_is_reversed, sprintNoSlow: !!sum.slows_have_no_potency_on_you_while_sprinting, spellNoPierce: !!sum.projectiles_from_spells_cannot_pierce, energyFullMana: v(sum, 'energy_generated_+%_on_full_mana'),   // Sierran Inheritance, Ab Aeterno, Snakepit, Idle Hands
    critPierce: v(sum, 'projectiles_crit_chance_+%_for_each_time_they_have_pierced'), spellCritPer: v(sum, 'spell_crit_bonus_+%_per_spell_crit_recently'), noImmob: !!sum.cannot_immobilise_enemies, lioneye: v(sum, 'unique_bow_attacks_repeat_x_times_when_no_enemies_in_your_presence'), thornsLeech: v(sum, 'base_life_leech_from_all_thorns_damage_permyriad'),   // Drillneck, Seed of Cataclysm, The Prisoner's Manacles, Lioneye's Glare, Belly of the Beast
    auspex: !!sum.enemies_in_your_presence_gain_a_stack_of_gruelling_madness_every_second, gmMinion: v(sum, 'minion_chance_to_apply_gruelling_madness_on_hit_%'), gmHit: v(sum, 'local_inflict_x_stacks_of_gruelling_madness_on_hit'), gmPower: !!sum.monsters_in_your_presence_have_additional_power_equal_to_their_gruelling_madness_stacks,   // Gruelling Madness: The Auspex, The Raven's Flock, Sadist's Mercy
    ordained: !!sum.manifest_a_fragment_of_divinity_in_your_presence_every_4_seconds,   // The Ordained: a Fragment of Divinity every 4 s
    wendigo: sum.enemies_in_presence_are_blinded_by_the_wendigo && sum.the_wendigo_manifests_every_x_seconds ? { every: sum.the_wendigo_manifests_every_x_seconds, faster: v(sum, 'the_wendigo_manifests_+%_faster_per_enemy_power_in_your_presence'), rand: v(sum, 'the_wendigo_manifestation_delay_randomisation_ms') / 1000 } : null,   // Vestige of Darkness
    enduChaos: v(sum, 'self_chaos_damage_taken_per_minute_per_endurance_charge') / 60, chillShatter: !!sum.chills_from_your_hits_cause_shattering,   // Nebuloch; Polcirkeln
    thornsCrit: !!sum.deal_thorns_damage_on_melee_crit, igniteHurt: v(sum, 'fire_damage_taken_when_enemy_ignited'),   // Dreadfist; Fireflower
    esRate, esDelay: Math.max(0, (sum.energy_shield_recharge_delay_override_ms || CHAR.energy_shield_delay_ms) - v(sum, 'energy_shield_recharge_starts_X_ms_sooner')) / 1000 / (1 + v(sum, 'energy_shield_delay_-%') / 100),   // Disciple of Varashta: sooner
    // energy shield recharge, none with Zealot's Oath, Scarred Faith or Eternal Youth (life recharges instead, at the same rate of its maximum)
    esRecharge: sum.keystone_zealots_oath || sum.keystone_alternate_es_recovery || sum.keystone_eternal_youth ? 0 : c.es * esRate * recMore * pct('energy_shield_recharge_rate_+%', ...(sum.additive_modifiers_to_mana_regeneration_also_apply_to_energy_shield_recharge_rate ? ['mana_regeneration_rate_+%'] : [])),
    // energy shield recharge starting sooner when not on full life: a factor on the delay, with its other increases
    esDelayHurt: esD('energy_shield_delay_-%_when_not_on_full_life'),
    esDelayStun: esD('energy_shield_delay_-%_if_stunned_recently'), esDelayArchon: esD('energy_shield_delay_-%_while_affected_by_archon'),
    archonRes: v(sum, 'archon_grants_all_elemental_resistance_+%'), fireMaxIgnited: v(sum, 'base_maximum_fire_damage_resistance_%_while_ignited'),   // Archon buffs also grant it
    // while Shapeshifted: factors on the energy shield delay and recharge, accuracy and life leech with their other
    // increases, armour applied to elemental damage, more maximum Rage
    shift: (k => k.some(x => sum[x]) ? { esDelay: esD('energy_shield_delay_-%_while_shapeshifted'),
      esRecharge: pct('energy_shield_recharge_rate_+%', 'energy_shield_recharge_rate_+%_while_shapeshifted') / pct('energy_shield_recharge_rate_+%'), acc: v(sum, 'accuracy_rating_+%_while_shapeshifted'),
      leech: v(sum, 'life_leech_amount_+%_while_shapeshifted'), armourEl: v(sum, 'x%_of_armour_applies_to_elemental_damage_while_shapeshifted'), rage: v(sum, 'maximum_rage_+_while_shapeshifted'),
      maxRes: { fire: v(sum, 'maximum_fire_damage_resistance_+%_while_shapeshifted'), cold: v(sum, 'maximum_cold_damage_resistance_+%_while_shapeshifted'), lightning: v(sum, 'maximum_lightning_damage_resistance_+%_while_shapeshifted') } } : null)(
      ['energy_shield_delay_-%_while_shapeshifted', 'energy_shield_recharge_rate_+%_while_shapeshifted', 'accuracy_rating_+%_while_shapeshifted', 'life_leech_amount_+%_while_shapeshifted', 'x%_of_armour_applies_to_elemental_damage_while_shapeshifted', 'maximum_rage_+_while_shapeshifted', ...['fire', 'cold', 'lightning'].map(e => `maximum_${e}_damage_resistance_+%_while_shapeshifted`)]),
    shiftMore: { surge: v(sum, 'gain_arcane_surge_on_reverting_if_you_were_shapeshifted_x_seconds'), intim: v(sum, 'enemies_you_heavy_stun_while_shapeshifted_are_intimidated_for_x_seconds') },   // the tree's on reverting / heavy stunning while Shapeshifted
    presWither: v(sum, 'inflict_withered_for_x_seconds_on_unwithered_enemies_when_they_enter_your_presence'), parryNoCrit: !!sum.parry_cannot_be_critically_hit_during_parry,
    parryNext: { ranged: v(sum, 'parry_successfully_parrying_melee_attack_gives_damage_+%_to_your_next_ranged_attack'), melee: v(sum, 'parry_successfully_parrying_projectile_gives_damage_+%_to_your_next_melee_attack') },
    totemCast: v(sum, 'totems_spells_cast_speed_+%_per_active_totem'),
    lifeRecharge: sum.keystone_eternal_youth || sum.base_life_recharges_like_energy_shield ? (c.life || 0) * esRate * recMore * pct('energy_shield_recharge_rate_+%') : 0,
    // keystones the scene plays: Zealot's Oath (excess life regeneration to energy shield), Vaal Pact, Mind Over Matter, Scarred Faith
    zealot: !!sum.keystone_zealots_oath, vaal: !!sum.keystone_vaal_pact, mom: !!sum.keystone_mana_shield, scarred: !!sum.keystone_alternate_es_recovery,
    manaRegen: sum.no_mana_regeneration ? 0 : c.mana == null || manaLife && c.life == null ? null
      : (c.mana * manaBase + (c.life || 0) * manaLife / 100 / 60) * manaInc,
    // their increases, and the tree's regeneration while you are in a state (the scene checks it)
    lifeInc, manaInc,
    recPerMissing: v(sum, 'life_recovery_rate_+%_per_5%_missing_life'),
    critFromHit: v(sum, 'gain_additional_crit_chance_from_%_chance_to_hit_over_100'),
    witheredDeal: v(sum, 'withered_enemies_deal_+%_damage'), witherMag: v(sum, 'withered_magnitude_+%'),   // the Withered you inflict
    // enemies you curse: their chaos resistance, Hindered (15% reduced movement speed), and your curses' increased
    // magnitudes once half of their duration has expired
    cursed: { chaos: v(sum, 'enemies_chaos_resistance_%_while_cursed'), hinder: sum['enemies_you_curse_have_15%_hinder'] ? 15 : 0, half: v(sum, 'while_curse_is_50%_expired_curse_effect_+%') },
    // increased damage taken by enemies you Mark, Electrocute, Freeze (cold) and per Incision (physical); your Ancestrally
    // Boosted attacks' increased damage and area; your minions' and companions' increased movement speed
    takenTree: { mark: v(sum, 'marked_enemy_damage_taken_+%'), electro: v(sum, 'electrocuted_enemy_damage_taken_+%'), frozenCold: v(sum, 'freeze_applies_cold_damage_taken_+%'),
      incision: v(sum, 'incision_you_inflict_applies_%_increased_physical_damage_taken') },
    ancBoost: { dmg: v(sum, 'ancestral_boosted_attack_damage_+%'), area: v(sum, 'ancestral_boosted_area_of_effect_+%') },
    minionMove: v(sum, 'minion_movement_speed_+%'), companionMove: v(sum, 'companion_movement_speed_%'), companionOns: v(sum, 'companion_onslaught_on_kill_%'), compShiftOns: !!sum.companions_in_presence_have_onslaught_while_you_are_shapeshifted, compLeech: !!sum.life_leeched_from_hits_also_leeches_same_amount_to_companions, tameUnique: !!sum.tame_beast_can_target_unique_beasts,
    blindEffect: v(sum, 'blind_effect_+%'), blindCrit: v(sum, 'enemies_you_blind_have_critical_strike_chance_+%'),   // and the critical hit chance of enemies you Blind
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
    eternal: !!sum.your_life_cannot_change_while_you_have_energy_shield, manaDegen: v(sum, 'mana_degeneration_%_per_minute_not_in_grace', 'mana_degeneration_per_minute_%'),
    lifeDegen: v(sum, 'life_degeneration_%_per_minute_not_in_grace'), esDegen: v(sum, 'energy_shield_lost_per_minute_%'),   // uniques' loss of a share of maximum life / energy shield a second
    // Low Life, Low Mana and Full Mana at other shares (Coward's Legacy, Idle Hands), and on Low Life by your mana / Low Mana by your life (Serpent's Lesson)
    thresh: { lowLife: v(sum, 'low_life_threshold_%_override'), lowMana: v(sum, 'low_mana_threshold_%_override'), fullMana: v(sum, 'full_mana_threshold_%_override'),
      lifeByMana: v(sum, 'unique_you_count_as_on_low_life_while_at_%_of_maximum_mana_or_below'), manaByLife: v(sum, 'unique_you_count_as_on_low_mana_while_at_%_of_maximum_health_or_below') }, buffTime: v(sum, 'buff_time_passed_+%_only_buff_category'),
    upwell: v(sum, 'minion_damage_+%_while_missing_mana'), motherWard: v(sum, 'mothers_ward_ms'),   // Upwelling; Arbiter's Reach
    volatility: v(sum, 'gain_X_volatility_on_inflicting_elemental_ailment'), volOnKill: v(sum, 'volatility_on_kill_%_chance'), volOnStun: v(sum, 'volatility_when_stunned_%_chance'), charmAnother: v(sum, 'charms_%_chance_on_use_to_use_another_charm_without_consuming_charges'), volImmune: !!sum.immune_to_volatility_damage, volMax: v(sum, 'maximum_volatility_allowed'), flaskRage: v(sum, 'rage_gained_on_life_flask_use'), pierceBroken: !!sum.projectiles_pierce_enemies_with_fully_broken_armour, minionWither: v(sum, 'minions_have_%_chance_to_inflict_wither_on_hit'), ancStun: v(sum, 'next_attack_is_ancestrally_boosted_for_x_seconds_on_heavy_stunning_unique_or_rare_enemy'), immIntim: v(sum, 'enemies_intimidated_x_seconds_when_pinned_heavy_stunned_frozen_or_electrocuted'), aggOld: v(sum, 'aggravate_bleeding_older_than_ms_on_hit') / 1000, stunBlind: !!sum.blind_enemies_when_they_stun_you, volDot: v(sum, 'chaos_damage_over_time_+%_per_volatility'), volCrit: v(sum, 'volatility_critical_strike_chance_+%_to_grant'), volFuse: Math.max(0, 1 + v(sum, 'volatility_detonation_delay_+%') / 100),   // Acolyte of Chayula
    hinderTime: 1 + v(sum, 'hinder_duration_+%') / 100, dazeMag: 1 + v(sum, 'daze_magnitude_+%') / 100,   // the Hinder and Daze you inflict
    unluckyDmg: sum.damage_taken_from_hits_is_unlucky ? 100 : v(sum, 'enemy_extra_damage_rolls_chance_%'),   // chance for hits' damage against you to be Unlucky (Oracle: always)
    // uniques: enemies' damage Lucky (+) / Unlucky (-) while on Low Life (The Barrow Dweller), of a type (The Sunken Vessel,
    // The Burrower); more / less damage taken while on Low Life, while not hit recently (The Dancing Mirage)
    dmgRolls: { low: v(sum, 'enemy_extra_damage_rolls_when_on_low_life'), physical: v(sum, 'enemies_extra_damage_rolls_with_physical_damage'), lightning: v(sum, 'enemies_extra_damage_rolls_with_lightning_damage') },
    takenWhile: [['hand_wraps_damage_taken_+%_final_on_low_life', 'LowLife'], ['damage_taken_+%_if_not_hit_recently_final', 'NotHitRecently']].filter(([k]) => sum[k]).map(([k, cv]) => ({ cv, val: sum[k] })),
    unluckyCrit: !!sum.critical_chance_vs_self_is_unlucky,   // Oracle
    manaFirst: !!sum.hit_damage_remove_from_mana_before_life_while_mana_higher_than_life,
    curseLimit: 1 + v(sum, 'number_of_additional_curses_allowed') + (sum.keystone_hex_master ? 1 : 0), curseForever: !!sum.curses_never_expire,   // Lich
    parryMag: v(sum, 'parried_magnitude_+%'), parryTime: 1 + v(sum, 'parry_skill_effect_duration_+%') / 100, debuffTime: v(sum, 'debuff_time_passed_+%'),   // the Parried debuff you inflict; how fast debuffs on you expire
    pain: !!sum.keystone_pain_attunement, unwavering: !!sum.keystone_unwavering_stance, bulwark: !!sum.keystone_bulwark, glancing: !!sum.keystone_glancing_blows, heart: !!sum.keystone_heartstopper, equilibrium: !!sum.keystone_elemental_equilibrium, actMove: { inc: v(sum, 'movement_speed_penalty_+%_while_performing_action'), fire: v(sum, 'movement_speed_penalty_+%_while_performing_fire_skills'), cold: v(sum, 'movement_speed_penalty_+%_while_performing_cold_skills'), more: v(sum, 'deadeye_movement_speed_penalty_+%_final_while_performing_action') }, ancestral: !!sum.keystone_ancestral_bond, ritual: !!sum.keystone_auto_invocation, resonance: !!sum.keystone_charge_cycle, conduit: sum.keystone_conduit ? 'all' : sum.endurance_only_conduit ? 'endurance' : null,   // keystones the scene plays
    regenWhile: REGEN_WHILE.filter(([k]) => sum[k]).map(([k, to, cv, x = 1]) => ({ to, cv, val: sum[k] * x })),
    // what a kill recovers: flat life, a share of your maximum mana, of your life when it was Poisoned, the chance for all your life
    killRecover: { life: v(sum, 'base_life_gained_on_enemy_death'), lifePct: v(sum, 'recover_%_maximum_life_on_kill'), mana: v(sum, 'recover_%_maximum_mana_on_kill'), manaFlat: v(sum, 'base_mana_gained_on_enemy_death'), poisoned: v(sum, 'recover_%_maximum_life_on_killing_poisoned_enemy'),
      full: v(sum, 'recover_maximum_life_on_enemy_killed_chance_%') },
    // what an event recovers: consuming a power charge (% of maximum mana) or an endurance charge (% of life), a block
    // (flat life), using your mana flask (% of life) or a charm (% of mana), heavily stunning a rare or unique enemy (% of
    // life), being stunned (% of life over a second)
    // uniques: Onslaught (4 s) and a Power Charge on hit, a Power Charge on a critical hit; physical damage taken from hits
    // (attack ones, projectile attack ones) lower by a flat amount; a chance to avoid projectiles
    // uniques' on hit: Intimidate, Withered (spells), fire Exposure, Daze (attacks), Blind on Chilled enemies, Aggravated
    // Bleeding (attacks); the elemental resistances of enemies you Ignite or Chill, the fire resistance of those in your Presence
    uHit: { intim: v(sum, 'chance_to_intimidate_on_hit_%'), wither: v(sum, 'spells_have_x%_chance_inflict_withered_on_hit'), fireExpo: v(sum, 'base_inflict_fire_exposure_on_hit_%_chance'),
      daze: v(sum, 'local_weapon_daze_chance_%'), blindChilled: v(sum, 'blind_chilled_enemies_on_hit_%'), aggr: v(sum, 'local_aggravate_bleeding_on_hit_chance_%') },
    igChillRes: v(sum, 'ignites_and_chill_apply_elemental_resistance_+'), presFireRes: v(sum, 'enemies_in_presence_have_fire_resistance_%'),
    // uniques the scene plays: physical damage taken from the mana you pay (Scold's Bridle); Dodge Roll distance (metres)
    // without / after one recently, its speed and Guard from missing energy shield (Lioneye's Glare, Decree of Flight);
    // energy shield recharge and Runic Ward on kill; missing life recovered before a hit (Defiance of Destiny); Keeper of
    // the Arc's less damage from hits (every other 5 s); fire resistance and evasion on Low Life; more armour per 1% of your
    // energy shield (The Mutable Star); on casting a spell life leeched or sacrificed for energy shield, on attacking for
    // Runic Ward (Lifesprig, Demon Stitcher); Guard from a mana flask (Glowswarm); damage taken per elemental ailment type (Yoke of Suffering)
    // The Unleashed's hit damage bypassing energy shield below half of it, Forgotten Warden's deflection per 50 missing
    // energy shield, The Black Doubt's mana sacrificed for life off full life (a second), ailments you receive when hit (Coat of Red, Apep's Supremacy, The Infinite Pursuit)
    uDef: { bypass: v(sum, 'hit_damage_bypass_energy_shield_%_when_below_half_energy_shield'), deflMissing: v(sum, '+_deflection_rating_per_50_missing_maximum_energy_shield'), doubt: v(sum, 'unique_body_armour_black_doubt_drain_%_mana_to_recover_life_until_full_and_dot_bypasses_es'),
      recvBleed: v(sum, 'receive_bleeding_chance_%_when_hit'), recvPoison: v(sum, 'chance_to_be_poisoned_%'), recvAil: 1 + v(sum, 'chance_to_be_inflicted_with_an_ailment_+%') / 100, resPower: v(sum, 'resist_all_elements_%_per_power_charge'), manaHurt: v(sum, 'skills_deal_you_x%_of_mana_cost_as_physical_damage'), rollFresh: v(sum, 'dodge_roll_travel_distance_+_if_not_dodge_rolled_recently') / 10, rollAgain: v(sum, 'dodge_roll_travel_distance_+_if_dodge_rolled_recently') / 10,
      rollSpeed: v(sum, 'dodge_roll_speed_+%'), rollGuard: v(sum, 'gain_guard_equal_to_%_of_your_missing_energy_shield_for_4_seconds_on_dodge_roll'), esKill: v(sum, 'energy_shield_recharges_on_kill_%'), wardKill: v(sum, 'ward_%_gained_on_kill'),
      beforeHit: v(sum, 'missing_life_%_gained_as_life_before_hit'), alt: v(sum, 'has_trickster_alternating_damage_taken_+%_final'), fireLow: v(sum, 'fire_damage_resistance_%_when_on_low_life'), evaLow: v(sum, 'evasion_rating_+_when_on_low_life'),
      esArmour: v(sum, 'armour_+%_final_vs_hits_per_1%_current_energy_shield'), spellLeech: v(sum, 'life_leech_%_maximum_life_on_spell_cast'), wardenDefl: v(sum, 'companion_takes_%_damage_from_deflected_hits_before_you'), spellES: v(sum, 'sacrifice_%_maximum_life_to_gain_as_es_on_spell_cast'),
      attackWard: v(sum, 'sacrifice_%_maximum_life_to_gain_half_as_much_ward_on_attack'), flaskGuard: v(sum, 'using_mana_flask_grants_%_recovery_amount_as_guard_for_4s'), yoke: v(sum, 'elemental_ailment_types_apply_damage_taken_+%') },
    // uniques on an event: Critical Weakness from spell critical hits and on parrying, Volatility on critical hits, your
    // thorns on melee hits (Prized Pain), melee physical damage taken dealt back (Bramblejack), curses spreading when the
    // cursed enemy dies (Veilpiercer: to how many)
    empKeep: v(sum, 'chance_for_exerted_attacks_to_not_reduce_count_%'), limit: v(sum, 'base_limit_+'),   // Serle's Grit; Idol of Uldurn
    hate: { cd: v(sum, 'gain_1_random_charge_on_reaching_maximum_rage_no_more_than_once_every_X_ms') / 1000, ward: v(sum, 'ward_%_to_recover_on_reaching_maximum_rage') },   // Hateforge
    ccAt: v(sum, 'crowd_control_effects_are_triggered_at_%_poise_threshold_instead'),   // Sine Aequo
    // uniques on blocking: a Poison as though dealing that base chaos damage (Lycosidae), damage blocked recouped as mana
    // (Alkem Eira), Corrupted Blood (Bloodbarrier: its share of your maximum life a minute, for its time)
    uBlock: { cull: !!sum.culling_strike_enemies_on_block, intim: v(sum, 'intimidate_enemy_on_block_for_duration_ms') / 1000, poison: v(sum, 'poison_as_though_dealing_X_damage_on_block'), mana: v(sum, 'damage_blocked_%_recouped_as_mana'),
      blood: v(sum, 'unique_blood_barrier_corrupted_blood_base_physical_damage_per_minute_as_%_of_maximum_life') / 100, bloodTime: v(sum, 'unique_blood_barrier_corrupted_blood_duration_ms') / 1000 },
    zerphi: { toFlask: v(sum, 'charm_charges_used_%_granted_to_life_flasks'), toCharm: v(sum, 'life_flask_charges_used_%_granted_to_charms') },   // Zerphi's Genesis: charges spent passed on
    // Liminal Coil: curses at zero magnitude, spells gaining as extra chaos / physical per curse on the target; Heatshiver: cold as extra fire per 1% Chill
    coil: sum['coil_of_undoing_curse_magnitude_+%_final'] || sum['spells_gain_%_of_damage_as_extra_chaos_per_curse_on_target'] ? { zero: v(sum, 'coil_of_undoing_curse_magnitude_+%_final'), chaos: v(sum, 'spells_gain_%_of_damage_as_extra_chaos_per_curse_on_target'), phys: v(sum, 'spells_gain_%_of_damage_as_extra_phys_per_curse_on_target') } : null,
    enemyChaos: v(sum, 'enemies_in_presence_non_skill_base_all_damage_%_to_gain_as_chaos'), redblade: v(sum, 'unique_redblade_banner_enemies_in_presence_monster_power_+%_final'), bloodPrice: v(sum, 'unique_blood_price_enemies_in_presence_have_at_least_%_life_reserved'), diadem: v(sum, 'consume_nearby_corpse_every_3_seconds_to_recover_%_maximum_life'), perfectWin: v(sum, 'perfect_timing_window_ms_+%'), griefIgnite: v(sum, 'ignite_as_though_dealing_X_damage_in_your_presence'),
    heatshiver: v(sum, 'non_skill_cold_damage_%_to_gain_as_fire_per_1%_chill_effect_on_enemy'),
    uEv: { spellWeak: v(sum, 'apply_X_stacks_of_critical_weakness_on_critical_hit_with_spells'), parryWeak: v(sum, 'apply_X_stacks_of_critical_weakness_on_parry'), volCrit: v(sum, 'instability_on_critical_%_chance'),
      thornsMelee: v(sum, 'melee_attack_deal_thorns_damage_chance_%_on_hit'), reflect: v(sum, 'melee_physical_damage_taken_%_to_deal_to_attacker'), hexSpread: v(sum, 'transfer_hexes_to_X_nearby_enemies_on_kill'), overkill: v(sum, 'overkill_damage_%_as_physical_to_nearby_enemies') },
    onsHit: v(sum, 'base_onlsaught_on_hit_%_chance'), powerHit: v(sum, 'add_power_charge_on_skill_hit_%'), powerCrit: v(sum, 'add_power_charge_on_critical_strike_%'),
    flatTaken: { phys: v(sum, 'physical_damage_taken_+'), attack: v(sum, 'physical_attack_damage_taken_+'), proj: v(sum, 'physical_ranged_attack_damage_taken_+') }, avoidProj: v(sum, 'base_avoid_projectiles_%_chance'),
    recoverOn: { power: v(sum, 'recover_x%_of_maximum_mana_when_you_consume_a_power_charge'), endurance: v(sum, 'recover_%_life_per_endurance_charge_consumed'),
      block: v(sum, 'recover_X_life_on_block'), blockPct: v(sum, 'recover_%_of_maximum_life_on_block'), manaFlask: v(sum, 'recover_%_maximum_life_on_mana_flask_use'), charm: v(sum, 'recover_%_maximum_mana_on_charm_use'),
      stunRare: v(sum, 'recover_%_life_on_heavy_stunning_rare_or_unique_enemy'), stunned: v(sum, 'regenerate_%_life_over_1_second_when_stunned') },
    // Recoup (keywords.json): shares of the damage a hit dealt you recovered over 8 seconds, faster with recoup speed
    recoup: { perRage: v(sum, 'x%_damage_taken_recouped_as_life_per_5_rage'), phys: v(sum, 'physical_damage_taken_recouped_as_life_%'), el: v(sum, 'elemental_damage_taken_%_recouped_as_life'), deflect: v(sum, 'deflected_hit_damage_taken_%_recouped_as_life'),
      all: v(sum, 'damage_taken_goes_to_life_over_4_seconds_%'), lme: v(sum, 'damage_taken_goes_to_life_mana_es_over_4_seconds_%'), prevented: v(sum, 'physical_damage_prevented_recouped_as_life_%'), channel: v(sum, 'x%_of_damage_taken_while_channelling_recouped_as_life'),
      es: v(sum, 'recoup_%_elemental_damage_as_energy_shield'), mana: v(sum, 'damage_taken_goes_to_mana_%'), totem: v(sum, 'recoup_%_of_damage_taken_by_your_totems_as_life'), time: 8 / pct('recoup_speed_+%'),
      scarred: sum.keystone_alternate_es_recovery ? 5 : 0 },   // Scarred Faith: 5% of physical damage prevented as energy shield per enemy Power
  };
}
// What ailments do to you: your ailment threshold (half your life, PlayerAilmentThresholdLifeFactor, plus what adds to it)
// and stun threshold, the freeze threshold a monster's cold hits fill, the chance to avoid each one (immunity: 100), how
// long it lasts on you (the reduced durations, as the panel's) and how strong (increased effect on you).
// note: the freeze threshold is taken as the stun threshold plus "freeze threshold" modifiers: the tables give none of its own
const ELEM_AIL = ['ignite', 'chill', 'shock', 'freeze'];
export function ailmentDefence(c, sum) {
  const at = c.attrs || {}, pct = (...ids) => 1 + v(sum, ...ids) / 100;
  const esStun = v(sum, 'stun_threshold_based_on_%_energy_shield_instead_of_life');   // Asceticism: a share of energy shield instead of life
  const stun = c.life == null ? null : ((esStun ? (c.es || 0) * esStun / 100 : c.life) + (c.stunGear || 0) + v(sum, 'stun_threshold_+') + (at.str || 0) * v(sum, 'stun_threshold_+_per_strength') + (at.dex || 0) * v(sum, 'stun_threshold_+_per_dexterity')
    + c.es * v(sum, 'stun_threshold_+_from_%_maximum_energy_shield') / 100) * pct('stun_threshold_+%');
  const ail = c.life == null ? null : (c.life * CHAR['ailment_threshold_life_%'] / 100 + (c.ailGear || 0) + (at.dex || 0) * v(sum, 'ailment_threshold_+_per_dexterity') + c.es * v(sum, 'ailment_threshold_+_from_%_maximum_energy_shield') / 100
    + c.evasion * v(sum, 'evasion_rating_%_to_gain_as_ailment_threshold') / 100) * pct('ailment_threshold_+%');
  const freeze = stun == null ? null : (stun + v(sum, 'freeze_threshold_+') + c.es * v(sum, 'freeze_threshold_+_from_maximum_energy_shield', 'gain_%_maximum_energy_shield_as_freeze_threshold_+') / 100) * pct('freeze_threshold_+%');
  // electrocute builds up against the elemental ailment threshold (KeywordPopups AilmentThreshold)
  const electrocute = ail == null ? null : (ail + v(sum, 'electrocute_threshold_+')) * pct('electrocute_threshold_+%') * pct('electrocute_threshold_+%_final');
  const allAil = v(sum, 'base_all_ailment_duration_on_self_+%'), eleAil = v(sum, 'self_elemental_status_duration_-%');
  const IMMUNE = { ignite: ['immune_to_ignite', 'base_immune_to_ignite', 'base_cannot_be_ignited'], chill: ['immune_to_chill', 'base_immune_to_chill', 'base_cannot_be_chilled_or_frozen'], shock: ['immune_to_shock', 'base_immune_to_shock', 'base_cannot_be_shocked'],
    freeze: ['immune_to_freeze', 'base_immune_to_freeze', 'base_cannot_be_chilled_or_frozen'], bleed: ['immune_to_bleeding'], poison: ['immune_to_poison', 'cannot_be_poisoned'], stun: ['base_cannot_be_stunned'], electrocute: ['base_cannot_be_electrocuted', 'cannot_be_electrocuted'] };
  const avoid = {}, dur = {};
  for (const [a, ids] of Object.entries(IMMUNE)) {
    const el = ELEM_AIL.includes(a);
    avoid[a] = ids.some(k => sum[k]) || c.immuneIf?.[a] ? 100 : Math.min(100, v(sum, `base_avoid_${a}_%`, `avoid_${a}_%`) + (el ? v(sum, 'avoid_all_elemental_status_%') : 0));
    dur[a] = (el ? Math.max(0, 1 - (v(sum, `base_self_${a}_duration_-%`) + eleAil - allAil) / 100)
      : Math.max(0, 1 + (v(sum, `self_${a}_duration_+%`) + allAil) / 100)) * (1 + v(sum, `self_${a}_duration_+%_final`) / 100);
  }
  dur.stun = pct('stun_duration_on_self_+%') / pct('base_stun_recovery_+%');   // as Path of Building 2: longer stuns, divided by stun recovery
  dur.electrocute = Math.max(0, 1 - v(sum, 'base_self_electrocute_duration_-%', 'self_electrocute_duration_-%') / 100) * pct('combined_electrocute_duration_on_self_+%_final');
  const eff = { chill: pct('chilled_effect_on_self_+%', 'chill_effectiveness_on_self_+%', 'shocked_chilled_effect_on_self_+%'), shock: pct('shocked_effect_on_self_+%', 'shocked_chilled_effect_on_self_+%'), ignite: pct('ignite_effect_on_self_+%'), bleed: pct('base_bleeding_magnitude_+%_on_self'), electrocute: pct('hit_damage_electrocute_multiplier_+%_on_self'), slow: sum.slows_have_no_potency_on_you ? 0 : pct('base_slow_potency_+%') };   // Pathfinder: unaffected by slows
  // the increased stun threshold that counts only in a state, with the always-on one it adds to (the scene's)
  const stunIf = { inc: v(sum, 'stun_threshold_+%'), notRecent: v(sum, 'stun_threshold_+%_when_not_stunned_recently'), channel: v(sum, 'stun_threshold_+%_while_channelling'), full: v(sum, 'stun_threshold_+%_when_on_full_life'), emp: v(sum, 'stun_threshold_+%_during_empowered_attacks'), shift: v(sum, 'stun_threshold_+%_while_shapeshifted'), surr: v(sum, 'stun_and_ailment_threshold_+%_while_surrounded'), parry: v(sum, 'parry_stun_threshold_+%_during_parry'), perHit: v(sum, 'stun_threshold_+%_for_each_time_hit_recently_up_to_100%') };
  return { stun, ail, freeze, electrocute, avoid, dur, eff, stunIf };
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
  const axe = W && weaponTags(W).includes('axe') ? v(sum, 'maximum_rage_+_while_wielding_axe') : 0;
  const base = ((CHAR.base_maximum_rage || 0) + v(sum, 'maximum_rage', 'natures_sustenance_additional_maximum_rage') + axe) * (sum.keystone_druidic_rage ? 2 : 1),   // Primal Hunger: 100% more
    any = !!rg || !!sum.maximum_rage || !!axe || !!regenPct || fromSupport || Object.values(gain).some(x => x > 0);
  return {
    base: any ? base : 0, noEffect: !!sum.keystone_druidic_rage, gain, regenPct, cost: v(sum, 'natures_sustenance_added_rage_cost'), spellPer2: v(sum, 'ascendancy_shaman_spell_damage_+%_final_per_2_rage'), delay: (CHAR.rage_loss_delay_ms + v(sum, 'rage_loss_delay_ms_+')) / 1000 / (1 + v(sum, 'rage_loss_delay_recovery_rate_+%') / 100), loss: sum.no_inherent_rage_loss ? 0 : CHAR.rage_loss_per_minute / 60 * Math.max(0, 1 + v(sum, 'rage_decay_speed_+%') / 100),   // its loss faster or slower, and its start
    glory: v(sum, 'max_rage_+_if_glory_skill_used_in_last_20_seconds'), fill: v(sum, 'gain_max_rage_on_rage_gain_from_hit_%_chance'),   // the tree's
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
    'presence_radius': sum['presence_area_+%'] && Math.round(CHAR.base_presence_radius * Math.sqrt(pct('presence_area_+%')) * (sum.unique_double_presence_radius ? 2 : 1)),
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
  immobilised_enemies: 'Immobilised', heavy_stunned_enemies: 'HeavyStunned', stunned_enemies: 'Stunned', rare_or_unique_enemy: 'RareOrUnique', unique_enemies: 'Unique',
  enemies_on_full_life: 'FullLife', enemies_on_low_life: 'LowLife', enemies_with_fully_broken_armour: 'ArmourFullyBroken',
  enemies_affected_by_ailments: 'Ailing', enemies_affected_by_status_ailments: 'Ailing', blinded_enemies: 'Blinded', dazed_enemies: 'Dazed', hindered_enemies: 'Hindered',
  rare_and_unique_enemies: 'RareOrUnique', enemies_further_than_6m_distance: 'Further6m', enemies_within_2m_distance: 'Within2m', marked_enemies: 'Marked', exposed: 'Exposed', demons: 'Demon', undead: 'Undead' };
// [stat, a(rmour) / e(vasion) / s (energy shield), the scene's condition]
const DEF_WHILE = [['parry_evasion_rating_+%_during_parry', 'e', 'Parrying'], ['armour_+%_if_consumed_endurance_charge_recently', 'a', 'ConsumedEnduranceRecently'], ['energy_shield_+%_if_consumed_power_charge_recently', 's', 'ConsumedPowerRecently'], ['evasion_rating_+%_if_consumed_frenzy_charge_recently', 'e', 'ConsumedFrenzyRecently'],
  ['global_armour_evasion_energy_shield_while_in_presence_of_companion_+%', 'aes', 'CompanionInPresence'], ['armour_+%_while_stationary', 'a', 'Still'], ['evasion_rating_+%_if_energy_shield_recharge_started_in_past_2_seconds', 'e', 'ESRechargePast2'],
  ['armour_+%_while_bleeding', 'a', 'Bleeding'], ['armour_+%_while_ignited', 'a', 'Ignited'], ['armour_+%_while_surrounded', 'a', 'Surrounded'], ['evasion_rating_+%_while_surrounded', 'e', 'Surrounded'],
  ['armour_evasion_+%_while_leeching', 'ae', 'Leeching'], ['evasion_+%_if_hit_recently', 'e', 'BeenHitRecently'], ['armour_+%_if_have_been_hit_recently', 'a', 'BeenHitRecently'],
  ['evasion_rating_+%_if_have_not_been_hit_recently', 'e', 'NotHitRecently'], ['armour_+%_if_you_havent_been_hit_recently', 'a', 'NotHitRecently'], ['evasion_rating_+%_while_moving', 'e', 'Moving'], ['armour_and_evasion_on_low_life_+%', 'ae', 'LowLife'],
  ['evasion_rating_+%_if_sprinting', 'e', 'Sprinting'], ['armour_evasion_energy_shield_+%_while_channelling', 'ae', 'Channelling'], ['evasion_rating_+%_if_you_have_hit_an_enemy_recently', 'e', 'HitRecently'],
  ['armour_+%_if_hit_enemy_with_melee_attack_recently', 'a', 'HitMeleeRecently'], ['evasion_rating_+%_while_you_have_energy_shield', 'e', 'HaveEnergyShield'],
  ['evasion_rating_+%_if_you_dodge_rolled_recently', 'e', 'DodgeRolledRecently'], ['evasion_rating_+%_when_on_full_life', 'e', 'FullLife'], ['evasion_rating_+%_when_on_low_life', 'e', 'LowLife'], ['armour_+%_while_shapeshifted', 'a', 'Shapeshifted']];
// the tree's attack (a) / cast (c) speed while you are in a state: [stat, a / c / ac, the scene's condition]. note: not
// counted "per Enemy in Close Range" (the game data has no distance for it), against Bloodlusting
// enemies, Parry's own speed after a Parry
const SPEED_WHILE = [['parry_attack_speed_+%_if_youve_parried_recently', 'a', 'ParriedRecently'], ['attack_and_cast_speed_+%_while_affected_by_a_mana_flask', 'ac', 'ManaFlaskEffect'], ['attack_speed_+%_during_flask_effect', 'a', 'FlaskEffect'],
  ['attack_speed_+%_if_enemy_killed_recently', 'a', 'KilledRecently'], ['attack_speed_+%_if_have_been_hit_recently', 'a', 'BeenHitRecently'],
  ['attack_speed_+%_if_have_crit_recently', 'a', 'CritRecently'], ['cast_speed_+%_if_have_crit_recently', 'c', 'CritRecently'],
  ['attack_speed_+%_if_rare_or_unique_enemy_nearby', 'a', 'RareOrUniqueInPresence'], ['attack_speed_+%_if_you_have_not_attacked_recently', 'a', 'NotAttackedRecently'],
  ['attack_speed_+%_while_in_presence_of_companion', 'a', 'CompanionInPresence'], ['attack_speed_+%_while_leeching', 'a', 'Leeching'],
  ['attack_speed_+%_while_not_on_low_mana', 'a', 'NotLowMana'], ['attack_speed_+%_while_surrounded', 'a', 'Surrounded'],
  ['cast_speed_+%_for_4_seconds_on_attack', 'c', 'AttackedRecently'], ['cast_speed_+%_if_you_have_used_a_mana_flask_recently', 'c', 'ManaFlaskRecently'],
  ['cast_speed_+%_when_on_full_life', 'c', 'FullLife'], ['cast_speed_+%_when_on_low_life', 'c', 'LowLife'], ['cast_speed_+%_while_chilled', 'c', 'Chilled'],
  ['cast_speed_+%_while_ignited', 'c', 'Ignited'], ['cast_speed_+%_while_on_full_mana', 'c', 'FullMana'], ['attack_speed_+%_while_on_full_mana', 'a', 'FullMana'], ['skill_speed_+%_if_consumed_frenzy_charge_recently', 'ac', 'ConsumedFrenzyRecently'], ['skill_speed_+%_while_shapeshifted', 'ac', 'Shapeshifted']];
// the tree's movement speed while you are in a state: [stat, the scene's condition; none: dual wielding, known here].
// 'Green10': 10 green supports socketed, known here. note: not counted against Bloodlusting enemies (the scene's have
// none), the penalties while performing an action
const MOVE_WHILE = [['movement_speed_+%_while_dual_wielding'], ['movement_speed_+%_if_pinned_enemy_recently', 'PinnedRecently'], ['movement_speed_+%_while_using_charm', 'UsingCharm'],
  ['parry_movement_speed_+%_if_youve_parried_recently', 'ParriedRecently'], ['movement_speed_+%_if_10_green_supports_socketed', 'Green10'], ['movement_speed_+%_if_enemy_killed_recently', 'KilledRecently'], ['movement_speed_+%_while_surrounded', 'Surrounded'],
  ['movement_speed_+%_while_you_have_energy_shield', 'HaveEnergyShield'], ['movement_speed_+%_for_4_seconds_on_block', 'BlockedPast4'], ['movement_speed_+%_if_used_a_mark_recently', 'MarkRecently'], ['archon_grants_movement_speed_+%', 'Archon'],
  ['movement_velocity_+%_when_on_full_life', 'FullLife'], ['movement_speed_+%_while_affected_by_ailment', 'Ailing']];   // Foxshade, The Infinite Pursuit
// the tree's regeneration while you are in a state: [stat, L (life % of the maximum per minute) / l (life regeneration
// rate) / m (mana regeneration rate), the scene's condition]. note: the "recovery rate" ones count for regeneration
// only, not flasks; not counted "per 5% missing life"
const REGEN_WHILE = [['life_regeneration_rate_+%_while_ignited', 'l', 'Ignited'], ['life_regeneration_per_minute_%_while_ignited', 'L', 'Ignited'], ['life_regeneration_rate_+%_while_moving', 'l', 'Moving'],
  ['life_regeneration_rate_+%_while_on_low_life', 'l', 'LowLife'], ['life_regeneration_rate_+%_while_stationary', 'l', 'Still'],
  ['life_regeneration_rate_+%_while_using_life_flask', 'l', 'LifeFlaskEffect'], ['life_recovery_rate_while_in_presence_of_companion_+%', 'l', 'CompanionInPresence'],
  ['life_regeneration_rate_per_minute_%_if_have_been_hit_recently', 'L', 'BeenHitRecently'], ['life_regeneration_rate_per_minute_%_if_used_life_flask_in_past_10_seconds', 'L', 'LifeFlaskPast10'],
  ['life_regenerate_rate_per_second_%_while_totem_active', 'L', 'TotemActive', 60],   // per second: x60 to the minute's
  ['life_regeneration_rate_per_minute_%_when_on_low_life', 'L', 'LowLife'], ['life_regeneration_rate_per_minute_%_while_affected_by_damaging_ailment', 'L', 'DamagingAilment'],
  ['life_regeneration_rate_per_minute_%_while_stationary', 'L', 'Still'], ['life_regeneration_rate_per_minute_%_while_surrounded', 'L', 'Surrounded'],
  ['mana_recovery_rate_+%_while_affected_by_a_mana_flask', 'm', 'ManaFlaskEffect'], ['mana_regeneration_rate_+%_on_full_life', 'm', 'FullLife'],
  ['mana_regeneration_rate_+%_while_moving', 'm', 'Moving'], ['mana_regeneration_rate_+%_while_not_on_low_mana', 'm', 'NotLowMana'],
  ['mana_regeneration_rate_+%_while_shocked', 'm', 'Shocked'], ['mana_regeneration_rate_+%_while_stationary', 'm', 'Still'],
  ['mana_regeneration_rate_+%_if_enemy_shocked_recently', 'm', 'ShockedEnemyRecently'], ['life_regeneration_rate_+%_while_shapeshifted', 'l', 'Shapeshifted'], ['mana_regeneration_rate_+%_while_shapeshifted', 'm', 'Shapeshifted'],
  ['mana_regeneration_rate_+%_if_crit_recently', 'm', 'CritRecently']];   // Nightscale
// "damage_+%_<state>" while you are in it: [the stat's end, the scene's condition]
const WHILE = { while_surrounded: 'Surrounded', while_moving: 'Moving', while_in_presence_of_companion: 'CompanionInPresence', while_ally_in_presence: 'AllyInPresence',
  while_you_have_arcane_surge: 'ArcaneSurge', when_on_full_life: 'FullLife', when_on_low_life: 'LowLife', while_leeching: 'Leeching', while_life_leeching: 'LifeLeeching',
  if_have_crit_in_past_8_seconds: 'CritPast8', while_es_full: 'FullEnergyShield', while_totem_active: 'TotemActive', while_affected_by_a_herald: 'HeraldOn',
  if_youve_dealt_projectile_attack_hit_recently: 'HitProjectileRecently', if_youve_dealt_melee_hit_recently: 'HitMeleeRecently', if_consumed_frenzy_charge_recently: 'ConsumedFrenzyRecently',
  while_ignited: 'Ignited', if_enemy_chilled_recently: 'ChilledEnemyRecently', if_enemy_ignited_recently: 'IgnitedEnemyRecently', if_enemy_shocked_recently: 'ShockedEnemyRecently',
  if_you_have_consumed_a_corpse_recently: 'ConsumedCorpseRecently', when_no_remaining_life_flask_uses: 'NoLifeFlaskUses', if_been_heavy_stunned_recently: 'HeavyStunnedRecently',
  during_flask_effect: 'FlaskEffect', while_using_charm: 'UsingCharm', for_4_seconds_on_crit: 'CritRecently', for_4_seconds_on_cast: 'CastRecently', if_minion_died_recently: 'MinionDiedRecently',
  if_triggered_skill_recently: 'TriggeredRecently', while_shapeshifted: 'Shapeshifted', if_youve_shapeshifted_to_animal_recently: 'ShapeshiftedRecently', if_youve_reverted_recently: 'RevertedRecently',
  ...Object.fromEntries(['Ice', 'Ash', 'Thunder', 'Plague', 'Blood'].map(h => [`while_affected_by_herald_of_${h.toLowerCase()}`, `HeraldOf${h}`])) };
// the tree's critical hit chance (crit) / damage bonus (critBonus) while you, or the enemy (e), are in a state
const CRIT_WHILE = [['critical_strike_chance_+%_if_enemy_killed_recently', 'crit', 'KilledRecently'], ['critical_strike_chance_+%_if_have_not_crit_recently', 'crit', 'NotCritRecently'],
  ['critical_strike_chance_against_enemies_on_full_life_+%', 'crit', 'FullLife', 'e'], ['critical_strike_multiplier_+_if_have_not_dealt_critical_strike_recently', 'critBonus', 'NotCritRecently'],
  ['critical_strike_multiplier_+_if_have_dealt_non_crit_recently', 'critBonus', 'NonCritRecently'], ['critical_strike_multiplier_vs_enemies_on_full_life_+', 'critBonus', 'FullLife', 'e'],
  ['critical_strike_multiplier_+_if_gained_power_charge_recently', 'critBonus', 'PowerGainedRecently'], ['critical_hit_damage_bonus_+%_if_consumed_power_charge_recently', 'critBonus', 'ConsumedPowerRecently'],
  ['critical_hit_chance_+%_vs_humanoids', 'crit', 'Humanoid', 'e'], ['critical_strike_chance_+%_while_shapeshifted', 'crit', 'Shapeshifted'], ['critical_strike_chance_+%_if_youve_shapeshifted_to_animal_recently', 'crit', 'ShapeshiftedRecently'],
  ['critical_strike_chance_+%_if_triggered_skill_recently', 'crit', 'TriggeredRecently'], ['critical_hit_chance_+%_against_enemies_entered_your_presence_recently', 'crit', 'EnteredPresenceRecently', 'e'],
  // of projectiles only (their texts): the fifth is the tag the skill has to have
  ['critical_hit_damage_bonus_+%_vs_enemies_within_2m_distance', 'critBonus', 'Within2m', 'e', 'projectile'], ['critical_hit_damage_bonus_+%_vs_enemies_further_than_6m_distance', 'critBonus', 'Further6m', 'e', 'projectile']];
// the tree's increased accuracy while you, or the enemy (e), are in a state (Close Range: 2 m, as the damage's)
const ACC_WHEN = [['accuracy_rating_+%_while_surrounded', 'Surrounded'], ['accuracy_rating_+%_while_moving', 'Moving'], ['accuracy_rating_+%_vs_enemies_in_close_range', 'Within2m', 'e'], ['accuracy_rating_+%_vs_rare_or_unique_enemy', 'RareOrUnique', 'e']];
// the tree's increased block chance while you are in a state
const BLOCK_WHILE = [['block_chance_+%_while_surrounded', 'Surrounded'], ['block_chance_+%_if_blocked_with_active_block_recently', 'RaisedBlockRecently']];
// the tree's increased area while you are in a state (the scene's, at each use)
const AREA_WHILE = [['area_of_effect_+%_while_totem_active', 'TotemActive'], ['area_of_effect_+%_while_you_have_arcane_surge', 'ArcaneSurge'], ['area_of_effect_+%_if_have_stunned_an_enemy_recently', 'StunnedEnemyRecently']];
export const DMG_NAME = { physical: '{0} physical', fire: '{0} fire', cold: '{0} cold', lightning: '{0} lightning', chaos: '{0} chaos' };
// Sum of "<prefix>_<suffix>" stats that apply to a skill with these tags (generic ones always). The prefix may be
// several words: every one has to fit (attack_area_damage_+%: attacks with an area; one_handed_melee_attack_speed_+%).
// Damage types are added per type by the caller, and what is the minions' is not the character's.
const REKEY = new Map();   // a stat's id as inc() reads it, worked out once: it is asked for every stat of the build at every sum
function rekey(k) {
  let r = REKEY.get(k);
  // "damage_+%_with_two_handed_weapons" / "..._with_bow_skills": the qualifier is one more prefix word;
  // "damage_vs_enemies_on_low_life_+%", "attack_damage_vs_bleeding_enemies_+%": the same as "..._damage_+%_vs_..."
  if (r === undefined) REKEY.set(k, r = k.replace(/^(.*)_with_([a-z_]+?)_(?:weapons|skills)$/, '$2_$1').replace(/^(.*damage)_(vs|against)_(\w+)_\+%$/, '$1_+%_$2_$3'));
  return r;
}
export function inc(sum, suffix, tags) {
  let t = 0;
  for (const key in sum) {
    const k = rekey(key);
    if (!k.endsWith(suffix)) continue;
    const pre = k.slice(0, -suffix.length).replace(/_skill_$|_$/, '').replace(/^base_(?=.)/, '').replace(/(one|two)_handed/, '$1hand').replace(/^channelled$/, 'channelling');
    if (pre === '' || pre === 'base' || pre === 'global' || pre.split('_').every(w => tags.includes(w) && !DMG.includes(w) && w !== 'minion' && w !== 'companion')) t += sum[key];
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
  const LR = treeGear['light_radius_additive_modifiers_apply_to_area_%_value'];   // Cornathaum: increased Light Radius as area of effect at its share
  if (LR) treeGear = { ...treeGear, 'base_skill_area_of_effect_+%': v(treeGear, 'base_skill_area_of_effect_+%') + v(treeGear, 'light_radius_+%') * LR / 100 };
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
  const wild = !!sum.keystone_wildsurge_incantation && spell && (own.includes('storm') || own.includes('plant'));   // Wildsurge Incantation: 50% more damage, 50% less cost, 75% less duration
  // flags of a support mod this skill meets: "hit" for its hits, "dot" for its damage over time, else what the skill is
  const has = dot => f => f === 'hit' ? !dot : f === 'dot' ? dot : f === 'attack' ? attack : f === 'spell' || f === 'cast' ? spell : own.includes(f);
  const hit = has(false), dmgMods = t => ['Damage', cap(t) + 'Damage', ...(t === 'physical' || t === 'chaos' ? [] : ['ElementalDamage'])];
  const out = { attack, spell, stats: st, sum, finals, sup: supOwn, castTime: d.cast_time_ms ?? null, hits: {}, dot: {}, avg: null, speed: null, crit: null, critBonus: null, dps: null, reason: null };
  // an empty main hand, for a skill used unarmed (WeaponRequirements ''): the class's own unarmed attack (Characters:
  // MinDamage-MaxDamage physical, WeaponSpeed ms, MaxAttackDistance; unarmed_base_critical_strike_chance)
  const cb = ascOf(b.asc).class_base, bare = attack && !b.items?.weapon && d.weapons?.includes('') && cb?.WeaponSpeed;
  // Hollow Palm Technique: with both hands empty a Quarterstaff skill attacks unarmed, its physical damage by the skill's
  // level (pob2.json hollow_palm: Path of Building 2's Misc.lua), 1% more attack speed per 75 evasion and +0.1% critical
  // hit chance per 10 energy shield of the equipped armour
  const HP = SK.hollow_palm, palm = attack && sum.keystone_hollow_palm_technique && !b.items?.weapon && !b.items?.offhand && d.weapons?.includes('Quarterstaves') && cb?.WeaponSpeed && HP?.length;
  const pw = palm && armourItems(b.items), lv = palm && Math.min(HP.length, Math.max(1, st._level || g.level || 1));
  const w = palm ? { physical: [...HP[lv - 1]], attacks_per_second: 1000 / cb.WeaponSpeed * (1 + Math.floor(pw.evasion / 75) / 100),
    crit: (CHAR.unarmed_base_critical_strike_chance || 0) / 100 + Math.floor(pw.energy_shield / 10) * .1, range: cb.MaxAttackDistance }
    : attack ? weaponStats(b.items) || (bare ? { physical: [cb.MinDamage, cb.MaxDamage], attacks_per_second: 1000 / cb.WeaponSpeed, crit: (CHAR.unarmed_base_critical_strike_chance || 0) / 100, range: cb.MaxAttackDistance } : null) : null;
  // unarmed (no weapon in the main hand): the uniques' unarmed critical chance, strike range, more damage per Strength
  // and fire damage gained per Intelligence (Northpaw, Thunderfist, Facebreaker)
  const unarmed = attack && !!w && !b.items?.weapon, FB = unarmed && (sum['unique_facebreaker_unarmed_attack_damage_+1%_final_per_X_strength'] || sum['non_skill_unarmed_damage_to_gain_as_fire_1%_per_X_intelligence']) && character(b, sum).attrs;
  const perX = (a, k) => FB && sum[k] ? Math.floor((FB[a] || 0) / sum[k]) : 0;
  // Dance with Death: 25% more skill speed with the off hand empty and a one-handed martial weapon in the main hand
  const dwd = sum.keystone_dance_with_death && !b?.items?.offhand && w && weaponTags(w).includes('onehand') && !/^(Wands|Sceptres)$/.test(classOf(b.items.weapon)) ? 1.25 : 1;
  // Amazon: physical damage added to attacks with the weapon, a share of the weapon's own accuracy
  const accPhys = w?.accuracy && v(sum, 'real_weapon_attack_added_physical_damage_%_of_weapon_item_accuracy') * w.accuracy / 100;
  if (accPhys) w.physical = w.physical.map(x => x + accPhys);
  // the weapons the skill is used with (ActiveSkills.WeaponRequirements; a shield skill names what the off hand holds)
  if (w && !bare && !palm && d.weapons && !['weapon', 'offhand'].some(s => d.weapons.includes(classOf(b.items[s])))) return { ...out, reason: 'This skill cannot be used with the weapon in hand' };
  // the skill a meta totem uses (Mortar Cannon's Cluster Grenade: the gem right after it, with the same supports, as a
  // Path of Building group comes in) is a totem's ballista attack: "increased Ballista / Totem Damage" count, "per active
  // Totem in your Presence" once, for that totem, and the meta gem's own -50% more damage. The game's window with one
  // Mortar Cannon placed, no Rage (16/11): 2.7% under this. Your Rage is not the totem's (below). note: the gem before it,
  // a link of its own if a build breaks it
  // g may be a copy with other supports (the Optimizer's): the build's gem of that name then
  const gi = (b.gems || []).indexOf(g), meta = usedBy(b, gi >= 0 ? gi : (b.gems || []).findIndex(x => x.name === g.name)), byTotem = meta && SK.skills[meta.name]?.totem || ownTotem;
  const tags = [...(w ? [...own, ...weaponTags(w)] : own), ...(byTotem?.ballista ? ['ballista'] : []), ...(g.name === 'Parry' ? ['parry'] : []),
    ...(GEM[meta?.name]?.tags?.includes('invocation') ? ['invocation'] : [])];   // passives for a weapon type count for attacks made with it; the ones for Invocated spells, for the spell an Invocation holds
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
  const rage = out.rage = attack && !byTotem && R.regen && !R.noEffect ?   // your Rage: not a totem's attacks
    (CHAR.base_maximum_rage || 0) + v(sum, 'maximum_rage') + (R.berserk?.max || 0) : 0;
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
    const more1 = (1 + (v(sum, 'mana_cost_+%_final') + (finals['mana_cost_+%_final'] || 0)) / 100) * (1 + v(sum, 'gemling_skill_cost_+%_final') / 100) * (sum.keystone_eldritch_battery ? 2 : 1), eff = 1 + (v(sum, 'base_mana_cost_efficiency_+%') + effAll + (own.includes('spell') ? v(sum, 'base_spell_mana_cost_efficiency_+%') : 0)
      + (own.includes('mark') ? v(sum, 'base_mana_cost_efficiency_+%_of_mark_skills') : 0) + (own.includes('command') ? v(sum, 'base_mana_cost_efficiency_+%_of_command_skills') : 0)) / 100;
    const moreCost = (1 + (finals['support_inspiration_cost_+%_final'] || 0) / 100) * (wild ? .5 : 1);   // Wildsurge Incantation: 50% less   // Efficiency: "more Cost", every resource
    // Lifetap: part of the mana cost converted to a life cost (PoB2 CalcOffence: that part of the cost before modifiers,
    // rounded, with the generic and the life cost modifiers; the mana cost keeps the rest, rounded down)
    const toLife = sum.keystone_blood_magic ? 1 : Math.min(100, v(sum, 'base_skill_cost_life_instead_of_mana_%') + (own.includes('spell') ? v(sum, 'spells_cost_life_instead_of_mana_%') : 0)) / 100;   // Blood Magic: all of it
    out.manaEff = eff;   // its mana cost efficiency (Uhtred's Rite adds to it in the scene)
    out.cost = perSec ? Math.max(0, raw * inc1 * more1 * moreCost / eff) : Math.max(0, Math.round(step(step(step(Math.floor(raw), inc1), more1), moreCost) / eff));
    if (toLife) {
      const life = perSec ? raw * toLife : Math.round(Math.floor(raw) * toLife), inc2 = 1 + (v(sum, 'base_cost_+%') + v(sum, 'base_life_cost_+%')) / 100, more2 = (1 + (finals['blood_magic_skill_life_cost_+%_final'] || 0) / 100) * (sum.keystone_tecrods_brutality ? 1.2 : 1);   // Tecrod's Brutality: 20% more
      const eff2 = 1 + (effAll + v(sum, 'base_life_cost_efficiency_+%')) / 100;
      out.lifeCost = perSec ? Math.max(0, life * inc2 * more2 * moreCost / eff2) : Math.max(0, Math.round(step(step(step(life, inc2), more2), moreCost) / eff2));
      out.cost = perSec ? out.cost * (1 - toLife) : Math.floor(out.cost * (1 - toLife));
    }
    // uniques' extra costs: life equal to a share of the mana cost (The Covenant, Prized Pain), a share of maximum life for
    // non-channelling spells (Rathpith Globe), of maximum mana for attacks (Mind of the Council)
    const RL = spell && !own.includes('channelling') && v(sum, 'base_life_cost_+_with_non_channelling_spells_%_maximum_life'), AM = attack && v(sum, 'attacks_base_mana_cost_+_%_of_maximum_mana'), pc = (RL || AM) && character(b, sum);
    const extraLife = out.cost * v(sum, 'base_skill_gain_life_cost_%_of_mana_cost') / 100 + (RL ? (pc.life || 0) * RL / 100 : 0);
    if (extraLife) out.lifeCost = (out.lifeCost || 0) + (perSec ? extraLife : Math.round(extraLife));
    if (AM) out.cost += perSec ? (pc.mana || 0) * AM / 100 : Math.round((pc.mana || 0) * AM / 100);
    // Paquate's Pact: a % of maximum life more for each use or trigger of the skill Recently, up to the stat's own cap
    const pact = Object.keys(sum).find(k => k.startsWith('support_corrupting_cry_%_life_cost_per_supported_skill'));
    if (pact) out.lifePerRecent = { pct: sum[pact], max: +pact.match(/up_to_(\d+)%/)[1] };
    out.costPerSecond = perSec;
  } else out.cost = 0;
  // a shield skill attacks with the shield (PoB2's off-hand pass): its own off-hand damage (off_hand_weapon_*), plus its
  // added damage per 15 (5) of the shield's armour / evasion (whole steps, PoB2's PerStat); a shield has no attack time,
  // so the skill's own, and its own critical chance
  const SH = { armour: 'armour', evasion: 'evasion', evasion_rating: 'evasion', armour_and_evasion_rating: 'both' };
  const shield = attack && d.weapons?.some(x => x === 'Shields' || x === 'Bucklers') && d.weapons.includes(classOf(b.items?.offhand)) && armourItems({ offhand: b.items?.offhand });
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
  // uniques' attack damage added from your maximum life (Bursting Decay) or mana (Mind of the Council, Twisted Empyrean)
  const POOL = [['physical', 'life', 'attack_added_physical_damage_%_of_maximum_life', 'attack_added_physical_damage_%_of_maximum_life'], ['lightning', 'mana', '', 'attack_maximum_added_lightning_damage_%_of_maximum_mana'],
    ['cold', 'mana', 'local_attacks_have_added_min_cold_damage_equal_to_%_of_maximum_mana', 'local_attacks_have_added_max_cold_damage_equal_to_%_of_maximum_mana']];
  const pool = attack && POOL.some(r => sum[r[3]]) && character(b, sum);
  const IB = attack && w && !unarmed && sum['main_hand_attacks_with_this_weapon_maximum_added_physical_damage_per_1%_block_chance'] && (character(b, sum).block || 0);   // Ironbound: per 1% block chance
  for (const t of DMG) {
    let lo = 0, hi = 0;
    for (const [k, of, mn, mx] of pool ? POOL.filter(r => r[0] === t) : []) { const p = (pool[of] || 0) / 100; lo += p * v(sum, mn); hi += p * v(sum, mx); }
    if (t === 'physical' && IB) { lo += IB * v(sum, 'main_hand_attacks_with_this_weapon_minimum_added_physical_damage_per_1%_block_chance'); hi += IB * v(sum, 'main_hand_attacks_with_this_weapon_maximum_added_physical_damage_per_1%_block_chance'); }
    if (attack && (w || nonWeapon || shield)) {   // a non-weapon attack needs no weapon in hand
      const r = shield ? [(st[`off_hand_weapon_minimum_${t}_damage`] || 0) + shieldAdd(t, 0), (st[`off_hand_weapon_maximum_${t}_damage`] || 0) + shieldAdd(t, 1)]
        : nonWeapon ? [st[`main_hand_weapon_minimum_${t}_damage`] || 0, st[`main_hand_weapon_maximum_${t}_damage`] || 0] : t === 'physical' ? w.physical : w[t];
      if (r) { lo += r[0]; hi += r[1]; }
      lo += v(sum, `attack_minimum_added_${t}_damage`); hi += v(sum, `attack_maximum_added_${t}_damage`);
      if (unarmed && tags.includes('melee')) { lo += v(sum, `attack_minimum_added_melee_${t}_damage_while_unarmed`); hi += v(sum, `attack_maximum_added_melee_${t}_damage_while_unarmed`); }   // Thunderfist
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
  // the gear's conversions (Blueflame Bracers' fire to cold, Painter's Servant's elemental, Original Sin's elemental to
  // chaos, Twisted Empyrean's mace fire, Fury of the King's bear physical, Kaltenhalt's parry), after the skill's: each
  // type's damage is converted once (note: a type converted on to another, Valako's Vice, is not chained), scaled down past 100%
  const ELE = ['fire', 'cold', 'lightning'], cvOf = (f, t) => f === t ? 0 : v(sum, `non_skill_base_${f}_damage_%_to_convert_to_${t}`) + (ELE.includes(f) ? v(sum, `non_skill_base_elemental_damage_%_to_convert_to_${t}`) : 0)
    + (f === 'fire' && t === 'cold' && tags.includes('mace') ? v(sum, 'unique_mace_fire_damage_with_mace_skills_%_to_convert_to_cold') : 0)
    + (f === 'physical' && t === 'fire' && tags.includes('bear') ? v(sum, 'non_skill_physical_damage_%_to_convert_to_fire_with_bear_skills') : 0)
    + (f === 'physical' && t === 'cold' && tags.includes('parry') ? v(sum, 'parry_physical_damage_%_to_convert_to_cold') : 0)
    + (f === 'physical' && t === 'fire' ? st['ancestral_cry_non_skill_physical_to_fire_convert_%'] || 0 : 0);   // Ancestral Cry's
  const cvFrom = { ...base };
  for (const f of DMG) {
    const tot = DMG.reduce((s, t) => s + cvOf(f, t), 0), k = tot && Math.min(1, 100 / tot) / 100;
    if (tot) for (const t of DMG) base[t] = base[t].map((x, i) => x + cvFrom[f][i] * (t === f ? -tot * k : cvOf(f, t) * k));
  }
  // Avatar of Fire: 75% of every other type converted to fire, and no non-fire damage dealt; Blackflame Covenant: a fire
  // spell's fire converted to chaos, which counts for its Ignite (a chaos one)
  const avatar = !!sum.keystone_avatar_of_fire, blackflame = !!sum.keystone_fire_spells_become_chaos_spells && spell && own.includes('fire');
  if (avatar) for (const t of DMG) if (t !== 'fire') base[t] = base[t].map((x, i) => (base.fire[i] += x * .75, x * .25));
  if (blackflame) { base.chaos = base.chaos.map((x, i) => x + base.fire[i]); base.fire = [0, 0]; }
  out.blackflame = blackflame;
  // supports: "gain X% of damage as extra <type>" adds to that type, "deal no <type> damage" removes it, and some
  // only raise the top of the range (Heft)
  // and the tree's, gear's and supports' game stats "gain X% of <all / elemental / a type of> damage as extra <type>"
  // (non_skill_base_fire_damage_%_to_gain_as_chaos: Xoph's Pyre; _with_spells / _with_attacks only for those), of the
  // damage after conversion
  const pre = { ...base }, all = [0, 1].map(i => DMG.reduce((s, t) => s + pre[t][i], 0));
  const SRC = { all: DMG, elemental: ['fire', 'cold', 'lightning'], ...Object.fromEntries(DMG.map(t => [t, [t]])) }, end = spell ? '_with_spells' : attack ? '_with_attacks' : null;
  const gain = (src, t, k = `non_skill_base_${src}_damage_%_to_gain_as_${t}`) => v(sum, k) + (end ? v(sum, k + end) : 0) + v(st, `active_skill_base_${src}_damage_%_to_gain_as_${t}`)
    + (src === 'all' && t !== 'physical' && t !== 'chaos' ? v(sum, 'non_skill_base_all_damage_%_to_gain_as_random_element') / 3 : 0)   // Shaman: a random element, a third each on average
    + (src === 'physical' && ELE.includes(t) && attack && w && weaponTags(w).includes('twohand') ? v(sum, 'local_non_skill_physical_damage_%_to_gain_as_each_element_with_attacks_while_have_this_two_handed_hand_weapon') : 0)   // Doomfletch
    + (src !== 'all' ? 0 : t === 'physical' ? (spell && out.lifeCost > 0 ? v(sum, 'spells_gain_%_physical_damage_if_they_cost_life') : 0)   // Atziri's Rule: spells that cost life
      : t === 'chaos' ? Math.floor((out.lifeCost || 0) / 3) * v(sum, 'non_skill_all_damage_%_to_gain_as_chaos_per_3_life_cost')   // The Burden of Shadows
      : t === 'fire' ? perX('int', 'non_skill_unarmed_damage_to_gain_as_fire_1%_per_X_intelligence') + (sum['non_skill_all_damage_%_to_gain_as_fire_+_per_1%_attack_block_chance'] ? (character(b, sum).block || 0) * sum['non_skill_all_damage_%_to_gain_as_fire_+_per_1%_attack_block_chance'] : 0) : 0);   // Chernobog's Pillar
  for (const t of DMG) {
    const extra = mod(mods, 'BASE', ['DamageGainAs' + cap(t)], hit) / 100;
    const from = [0, 1].map(i => Object.entries(SRC).reduce((x, [src, ts]) => x + gain(src, t) / 100 * ts.reduce((y, u) => y + pre[u][i], 0), 0));
    base[t] = mods.some(m => m[0] === 'DealNo' + cap(t)) || avatar && t !== 'fire' ? [0, 0] : [base[t][0] + all[0] * extra + from[0], (base[t][1] + all[1] * extra + from[1]) * mod(mods, 'MORE', [`Max${cap(t)}Damage`], hit)];
  }
  // a totem's grenade: "increased Grenade Damage" does not count (the game's window, 16/11: the same 4311-9885 without
  // two Grenade Damage nodes; Volatile Grenades' fuse is not in it either), the grenade cooldown ones do (10.99 s)
  const dmgTags = byTotem ? [...tags.filter(x => x !== 'grenade'), 'totem'] : tags;
  // "<type>_<kind>_damage_+%" (the tree's Attack Cold Damage, Physical Damage with Bows): that type's damage with skills of that kind
  const typed = Object.fromEntries(DMG.map(t => [t, {}]));
  for (const k in sum) { const m = k.match(/^(physical|fire|cold|lightning|chaos)_(\w+_damage_\+%)$/); if (m) typed[m[1]][m[2]] = sum[k]; }
  // supports whose damage the game's window shows otherwise than their stats (and Path of Building 2) say: measured
  const measured = (g.supports || []).reduce((x, n) => x * (MEASURED_MORE[n] || 1), 1);
  // "increased Spell Damage with Spells that cost Life": a spell with a life cost (Lifetap, Blood Magic)
  // the tree's increased damage per attribute, maximum mana or block chance (the character's own, with this skill's supports)
  const PA = [['damage_+%_per_15_strength', c => c.attrs.str / 15], ['damage_+%_per_5_of_your_lowest_attribute', c => Math.min(c.attrs.str || 0, c.attrs.dex || 0, c.attrs.int || 0) / 5],
    ['damage_+%_per_1%_block_chance', c => c.block], ...spell ? [['spell_damage_+%_per_10_strength', c => c.attrs.str / 10], ['spell_damage_+%_per_100_maximum_mana', c => c.mana / 100]] : []].filter(([k]) => sum[k]);
  const ch = PA.length && character(b, sum), perAttr = PA.reduce((t, [k, f]) => t + Math.floor(f(ch) || 0) * sum[k], 0);
  const trigSpell = spell && (gt.includes('Triggered') || meta && !byTotem) ? v(sum, 'triggered_spell_spell_damage_+%') : 0;   // Invoker: spells a meta skill or another triggers
  // Crown of Eyes: the increases to spell damage count for attacks; Chober Chaber: the minions' increases count for you
  const borrowed = (attack && sum.additive_spell_damage_modifiers_apply_to_attack_damage ? inc(sum, 'damage_+%', [...dmgTags, 'spell']) - inc(sum, 'damage_+%', dmgTags) : 0)
    + (sum.minion_damage_increases_and_reductions_also_affects_you ? v(sum, 'minion_damage_+%') : 0);
  const compInc = sum.companion_damage_increases_and_reductions_also_affects_you ? v(sum, 'companion_damage_+%') : 0;   // the tree's: your Companion's increased damage yours too
  const incOf = (t, dot = false) => inc(sum, 'damage_+%', dmgTags) + compInc + borrowed + perTotem + perAttr + trigSpell + (spell && out.lifeCost > 0 ? v(sum, 'spell_damage_+%_with_spells_that_cost_life') : 0) + (attack && /^(Shields|Bucklers)$/.test(classOf(b.items?.offhand)) ? v(sum, 'attack_skills_damage_+%_while_holding_shield') : 0) + (dual ? v(sum, 'damage_while_dual_wielding_+%') : 0) + (spell && (weaponStats(b.items)?.tags || []).includes('weapon') && !weaponStats(b.items).tags.includes('ranged') ? v(sum, 'spell_damage_+%_while_wielding_melee_weapon') : 0) + v(sum, `${t}_damage_+%`) + inc(typed[t], 'damage_+%', dmgTags) + (t !== 'physical' && t !== 'chaos' ? v(sum, 'elemental_damage_+%') + (attack ? v(sum, 'elemental_damage_with_attack_skills_+%') : 0) : 0) + mod(mods, 'INC', dmgMods(t), has(dot));
  const dual = w && weaponStats({ weapon: b.items?.offhand });   // a weapon in each hand
  const scale = (t, dot = false) => (1 + v(st, 'active_skill_damage_+%_final') / 100) * (1 + (dual ? v(st, 'active_skill_damage_+%_final_while_dual_wielding') : 0) / 100) * more(fin, 'damage_+%', tags, t) * mod(mods, 'MORE', dmgMods(t), has(dot)) * metaDmg * measured * (1 + perX('str', 'unique_facebreaker_unarmed_attack_damage_+1%_final_per_X_strength') / 100) * (wild ? 1.5 : 1) * (1 + rage * (100 + rageEffect) / 1e4)
    * (1 + incOf(t, dot) / 100);
  const noEl = !!sum.deal_no_elemental_damage;   // Splinter of Lorrata
  for (const t of DMG) {
    const [lo, hi] = noEl && ['fire', 'cold', 'lightning'].includes(t) ? [0, 0] : base[t];
    if (hi) out.hits[t] = [Math.round(lo * mult * scale(t)), Math.round(hi * mult * scale(t))];
    // damage over time of the skill itself (Contagion, burning ground...), per second
    const perMin = st[`base_${t}_damage_to_deal_per_minute`];
    if (perMin) out.dot[t] = perMin / 60 * scale(t, true);
  }
  // Ignite of a hit with fire damage: GameConstants' share of it per second, for its base duration. note: no
  // ignite magnitude or duration modifiers yet (none on the build it was checked with, 163-354.4/s as the game)
  const igFrom = blackflame ? out.hits.chaos : out.hits.fire;
  if (igFrom && CHAR['ignite_%_per_second']) out.ignite = { chaos: blackflame || !!sum.base_ignite_deals_chaos_instead || undefined, perSecond: igFrom.map(x => x * CHAR['ignite_%_per_second'] / 100), duration: CHAR.ignite_duration_s };
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
    + (tags.includes('channelling') ? v(sum, 'skill_speed_+%_with_channelling_skills') : 0) + (tags.includes('warcry') ? v(sum, 'warcry_speed_+%') : 0) + (tags.includes('mark') ? v(sum, 'mark_use_speed_+%') : 0)   // Warcry Speed: its use time
    + (byTotem ? v(sum, attack ? 'totem_skill_attack_speed_+%' : 'totem_skill_cast_speed_+%') : 0);   // attacks / spells used by totems
  const per = attack && (v(sum, 'attack_speed_+%_per_25_dex') || v(sum, 'attack_speed_+%_per_200_accuracy_rating')) && character(b, sum);
  const atkSp = tagSp + (/^(Shields|Bucklers)$/.test(classOf(b.items?.offhand)) ? v(sum, 'attack_speed_+%_while_holding_shield') : 0) + (dual ? v(sum, 'attack_speed_while_dual_wielding_+%') : 0)
    + (per ? Math.floor((per.attrs?.dex || 0) / 25) * v(sum, 'attack_speed_+%_per_25_dex') + Math.floor((per.accuracy || 0) / 200) * v(sum, 'attack_speed_+%_per_200_accuracy_rating') : 0);
  if (attack && (w || shield || flaskThrow)) out.speed = (shield ? 1000 / (d.cast_time_ms || 1000) : flaskThrow ? 1000 / st.main_hand_base_weapon_attack_duration_ms : w.attacks_per_second) * (1 + (inc(sum, 'attack_speed_+%', spTags) + v(sum, 'attack_and_cast_speed_+%', 'skill_speed_+%') + (sum.additive_modifiers_to_minion_attack_speed_also_affect_you ? v(sum, 'minion_attack_speed_+%', 'minion_attack_and_cast_speed_+%') : 0) + speedInc + perTotemSpeed + atkSp) / 100) * (1 + v(st, 'active_skill_attack_speed_+%_final') / 100) * (1 + (dual ? v(st, 'active_skill_attack_speed_+%_final_while_dual_wielding') : 0) / 100) * more(fin, 'attack_speed_+%', tags) * speedMods * metaSpeed * dwd;
  else if (d.cast_time_ms) out.speed = 1000 / d.cast_time_ms * (1 + (inc(sum, 'cast_speed_+%', tags) + v(sum, 'attack_and_cast_speed_+%', 'skill_speed_+%') + speedInc + tagSp + (tags.includes('cold') ? v(sum, 'cast_speed_for_cold_skills_+%') : 0)) / 100) * more(fin, 'cast_speed_+%', tags) * speedMods * dwd;
  if (byTotem && out.speed) out.speed *= 1 + v(sum, 'ascendency_tactician_totem_skill_speed_+%_final') / 100;   // Tactician's Cannons, Ready!: more skill speed of totems' skills
  // crossbow: the clip's bolts (gem + Double Barrel's), fired then reloaded, as PoB2's CalcOffence: the weapon's reload time
  // over (1 + increased reload and attack speed) x the "more" ones; bolts a shot keeps (Ammo Conservation) stretch the clip
  const bolts = attack && w?.reload && v(st, 'base_number_of_crossbow_bolts') + v(sum, 'support_double_barrel_number_of_crossbow_bolts_+');
  if (bolts && out.speed) {
    const reloadMore = Object.entries({ ...finals, 'active_skill_reload_speed_+%_final': v(st, 'active_skill_reload_speed_+%_final') })
      .reduce((m, [k, x]) => { const sign = k.match(/reload_speed_([+-])%_final$/)?.[1]; return sign ? m * (1 + (sign === '-' ? -x : x) / 100) : m; }, 1);
    const reload = (1 - Math.min(100, v(sum, '%_chance_for_crossbow_reload_to_be_instant')) / 100) * w.reload / ((1 + (inc(sum, 'attack_speed_+%', spTags) + v(sum, 'attack_and_cast_speed_+%', 'skill_speed_+%', 'reload_speed_+%') + speedInc + atkSp) / 100) * speedMods * reloadMore);
    // the tree's chance not to use a bolt "if you've reloaded recently": a reload at least every 4 seconds counts it
    const keep = Math.min((v(sum, 'crossbow_attack_%_chance_to_not_consume_ammo') + (bolts / out.speed + reload <= 4 ? v(sum, 'crossbow_attack_%_chance_to_not_consume_ammo_if_reloaded_recently') : 0)) / 100, 1), shots = bolts / (1 - keep);
    out.clip = { bolts, reload, keep, fire: out.speed };   // fire: shots per second between reloads
    out.speed = keep >= 1 ? out.speed : shots / (shots / out.speed + reload);
  }
  // cooldown: the gem's own (quality), the tree's and gear's for its tags (grenade_skill_cooldown_speed_+%) and the
  // supports' recovery rate (Payload -70%); uses: the gem's plus "+N Cooldown Uses" (grenade_skill_cooldown_count_+).
  // Uhtred's Constellation adds its uses to a skill that is not instant
  // The game's window: Cluster Grenade 10 s at -9% (16 + 45 - 70) = 10.99 s, 2 uses
  if (st._cooldown_ms) {
    out.cooldown = Math.max(0, st._cooldown_ms + v(sum, 'unique_cooldown_modifier_ms')) / (1 + (v(st, 'base_cooldown_speed_+%') + inc(sum, 'cooldown_speed_+%', tags) + mod(mods, 'INC', ['CooldownRecovery'], hit) + (GEM[g.name]?.types?.includes('CommandsMinions') ? v(sum, 'minion_command_skill_cooldown_speed_+%') : 0)) / 100) / mod(mods, 'MORE', ['CooldownRecovery'], hit);
    // Second Wind: less recovery rate, twice the uses (support_double_number_of_cooldown_uses)
    out.uses = ((st._stored_uses || 1) + inc(sum, 'cooldown_count_+', tags) + (d.cast_time_ms ? v(sum, 'support_added_cooldown_count_if_not_instant') : 0)) * ((g.supports || []).some(n => SK.skills[n]?.flags?.includes('support_double_number_of_cooldown_uses')) ? 2 : 1);
    out.useTime = out.speed && 1 / out.speed;   // the game's "Attack time", apart from the cooldown
    if (out.speed) out.speed = Math.min(out.speed, 1000 / out.cooldown);
  }
  // crit: base chance from weapon / skill row, increased by tree and gear; +100% damage bonus is the game's base
  const baseCrit = (shield || flaskThrow) && st._attack_crit ? st._attack_crit / 100 : attack && w ? (sum.override_weapon_base_critical_strike_chance && !unarmed ? sum.override_weapon_base_critical_strike_chance / 100 : w.crit) + (unarmed && tags.includes('melee') ? v(sum, 'base_melee_critical_strike_chance_while_unarmed_%') : 0) : first(spell && sum.base_spell_critical_strike_chance_override_permyriad ? sum.base_spell_critical_strike_chance_override_permyriad / 100 : null, st._spell_crit != null ? st._spell_crit / 100 : null, st.base_critical_strike_chance != null ? st.base_critical_strike_chance / 100 : null);
  if (baseCrit != null) {
    const addCrit = inc(sum, 'additional_critical_strike_chance_permyriad', tags) / 100;   // the tree's "+% to Critical Hit Chance" of attacks, of Herald skills: added to the base chance
    out.crit = mods.some(m => m[0] === 'NeverCrit') || sum.resolute_technique ? 0 : Math.min(sum['maximum_critical_strike_chance_is_%_from_support_garukhans_resolve'] || 100, (baseCrit + addCrit) * (1 + (inc(sum, 'critical_strike_chance_+%', tags) + (tags.includes('ballista') ? v(sum, 'ballista_critical_hit_chance_+%') : 0) + (attack && dual ? v(sum, 'critical_strike_chance_while_dual_wielding_+%') : 0) + mod(mods, 'INC', ['CritChance'], hit)) / 100) * mod(mods, 'MORE', ['CritChance'], hit));
    if (attack && sum['attack_crit_chance_override_%'] && out.crit) out.crit = sum['attack_crit_chance_override_%'];   // Maligaro's Virtuosity: the attacks' chance is that
    out.critBonus = sum.no_critical_strike_multiplier || attack && w?.noCritBonus ? 0 : sum.critical_strike_multiplier_is_250 ? 250 : (100 + (attack && w?.critBonus || 0) + inc(sum, 'critical_strike_multiplier_+', tags) + (tags.includes('ballista') ? v(sum, 'ballista_critical_damage_+%') : 0) + (attack && tags.includes('dagger') ? v(sum, 'critical_strike_multiplier_with_dagger_+') : 0) + (sum['critical_damage_+%_per_50_current_life'] ? Math.floor(character(b, sum).life / 50) * sum['critical_damage_+%_per_50_current_life'] : 0) + mod(mods, 'INC', ['CritMultiplier'], hit) + mod(mods, 'BASE', ['CritMultiplier'], hit)) * mod(mods, 'MORE', ['CritMultiplier'], hit) * (1 + v(sum, 'infernalist_critical_strike_multiplier_+%_final') / 100);   // Infernalist: more
  }
  // supports' damage and crit that count only under a condition (PoB2's tags, pob2.py): the 3D scene checks it on each hit
  // (scene.js when()). w: what one point of it is worth to that damage type, 1 for "more", 1 / (1 + the skill's
  // increased) for "increased"; cap: the support's own most (Dauntless 45%, Burgeon 40%) or most stacks (Arakaali's 40).
  // The "more damage against a state" calc.js already reads (ailments: vs, consume) are not repeated here
  const critInc = inc(sum, 'critical_strike_chance_+%', tags) + (tags.includes('ballista') ? v(sum, 'ballista_critical_hit_chance_+%') : 0) + mod(mods, 'INC', ['CritChance'], hit);
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
  // the tree's damage of one type gained as extra damage of another against an enemy in a state (the scene's, on each hit)
  for (const [k, from, to, cv] of [['physical_damage_%_to_gain_as_lightning_vs_electrocuted', 'physical', 'lightning', 'Electrocuted'],
    ['physical_damage_%_to_gain_as_fire_vs_heavy_stunned', 'physical', 'fire', 'HeavyStunned'], ['non_skill_cold_damage_%_to_gain_as_fire_vs_frozen_enemies', 'cold', 'fire', 'Frozen']])
    if (sum[k]) out.when.push({ cond: [{ type: 'ActorCondition', actor: 'enemy', var: cv }], val: sum[k], what: 'gain', from, to });
  const per5 = v(sum, 'critical_strike_chance_+%_per_5_rage');   // Prototype Seventeen: increased crit per 5 Rage
  if (per5) out.when.push({ cond: [{ type: 'Multiplier', var: 'Rage', div: 5 }], val: per5, what: 'crit', w: critW });
  // the tree's "Every (10) Rage also grants increased Fire / Physical / Spell Damage"
  for (const [k, div, ty, ok] of [['fire_damage_+%_per_rage', 1, 'fire', true], ['physical_damage_+%_per_10_rage', 10, 'physical', true], ['spell_damage_+%_per_rage', 1, null, tags.includes('spell')]])
    if (ok && sum[k]) out.when.push({ cond: [{ type: 'Multiplier', var: 'Rage', div }], val: sum[k], what: 'damage', w: ty ? Object.fromEntries(SRC[ty].map(t => [t, out.incW[t]])) : out.incW });
  // the tree's and gear's increased damage against an enemy in a state ("attack_damage_+%_vs_maimed_enemies",
  // "hit_damage_+%_vs_chilled_enemies"...), for the skills its prefix fits; the scene checks the state on each hit
  for (const [s, cv] of Object.entries(VS_STATE)) for (const sep of ['vs', 'against', 'to']) {
    const val = inc(sum, `damage_+%_${sep}_${s}`, [...dmgTags, 'hit']), cond = [{ type: 'ActorCondition', actor: 'enemy', var: cv }];
    if (val) out.when.push({ cond, val, what: 'damage', w: out.incW });
    // and its critical hit chance / damage bonus ("critical_strike_chance_+%_vs_shocked_enemies")
    const cc = inc(sum, `critical_strike_chance_+%_${sep}_${s}`, tags), cb = inc(sum, `critical_strike_multiplier_+_${sep}_${s}`, tags);
    if (cc) out.when.push({ cond, val: cc, what: 'crit', w: critW });
    if (cb) out.when.push({ cond, val: cb, what: 'critBonus', w: cbW });
  }
  // and while you are in a state ("attack_damage_+%_while_surrounded", "melee_damage_+%_when_on_full_life")
  // what Archon buffs also grant (the tree): increased critical hit chance and damage bonus while you have one
  const AC = v(sum, 'archon_grants_critical_strike_chance_+%'), AB = v(sum, 'archon_grants_base_critical_strike_multiplier_+');
  if (AC) out.when.push({ cond: [{ type: 'Condition', var: 'Archon' }], val: AC, what: 'crit', w: critW });
  if (AB) out.when.push({ cond: [{ type: 'Condition', var: 'Archon' }], val: AB, what: 'critBonus', w: cbW });
  // Excoriate (melee), Elemental Armament III (attacks): more damage per elemental ailment on the enemy hit
  const EA = (tags.includes('melee') ? finals['support_elemental_assault_melee_damage_+%_final_per_elemental_ailment_on_target'] || 0 : 0) + (attack ? finals['support_elemental_armament_attack_damage_+%_final_per_elemental_ailment_on_target'] || 0 : 0);
  if (EA) out.when.push({ cond: [{ type: 'Multiplier', var: 'ElementalAilments' }], val: EA, what: 'damage', w: Object.fromEntries(DMG.map(t => [t, 1])) });
  const XP = v(sum, 'critical_hit_damage_+%_against_enemies_exited_your_presence_recently'); if (XP) out.when.push({ cond: [{ type: 'ActorCondition', actor: 'enemy', var: 'ExitedPresenceRecently' }], val: XP, what: 'critBonus', w: cbW });
  // the tree's per recent use: elemental penetration per Glory skill used in the last 6 s; increased damage per Glory consumed
  // in the last 6 s (attacks, up to 100%), per Combo the skill consumes (up to 40%), per Hazard triggered recently (up to 50%)
  const by = (k, cv, cap, ok = true) => { const x = ok && v(sum, k); if (x) out.when.push({ cond: [{ type: 'Multiplier', var: cv }], val: x, cap, what: 'damage', w: out.incW }); };
  by('%_attack_damage_per_glory_consumed_for_6_seconds_up_to_100', 'GloryConsumedPast6', 100, attack); by('combo_finisher_damage_+%_up_to_40%', 'ComboConsumed', 40);
  by('damage_+%_per_recently_triggered_hazard_up_to_50%', 'HazardsTriggeredRecently', 50); by('damage_+%_per_warcry_used_recently', 'WarcriesRecently'); by('damage_+%_per_different_warcry_used_recently', 'DifferentWarcriesRecently'); by('gain_attack_damage_+%_for_each_your_minion_in_presence_capped', 'MinionPresenceCount', 80, attack);   // its text: up to 80%
  const GP = v(sum, 'damage_penetrates_x%_of_elemental_resistances_per_glory_skill_used_in_last_6_seconds');
  if (GP) for (const el of ['fire', 'cold', 'lightning']) out.when.push({ cond: [{ type: 'Multiplier', var: 'GlorySkillsUsedPast6' }], val: GP, what: 'pen', el });
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
  { const MV = sum['passive_tree_mace_damage_+%_final_vs_heavy_stunned_enemies'], MW = MV && attack && weaponStats(b.items); if (MW && weaponTags(MW).includes('mace')) out.when.push({ cond: [{ type: 'ActorCondition', actor: 'enemy', var: 'HeavyStunned' }], val: MV, what: 'damage', w: Object.fromEntries(DMG.map(t => [t, 1])) }); }   // the tree's more mace damage against Heavy Stunned enemies
  if (sum['gain_fire_damage_+%_per_endurance_charge_consumed_recently']) out.when.push({ cond: [{ type: 'Multiplier', var: 'EnduranceConsumedRecently' }], val: sum['gain_fire_damage_+%_per_endurance_charge_consumed_recently'], what: 'damage', w: Object.fromEntries(SRC.fire.map(t => [t, out.incW[t]])) });   // increased fire damage per Endurance Charge consumed Recently
  const CR = inc(sum, 'damage_+%_at_close_range', [...dmgTags, 'hit']); if (CR) out.when.push({ cond: [{ type: 'ActorCondition', actor: 'enemy', var: 'Within2m' }], val: CR, what: 'damage', w: out.incW });   // the tree's at Close Range (2 m, as the stun buildup's)
  // the tree's crit chance against an enemy with no elemental ailment
  const NE = v(sum, 'critical_strike_chance_+%_vs_enemies_without_elemental_status_ailments'); if (NE) out.when.push({ cond: [{ type: 'Multiplier', var: 'ElementalAilments', neg: true }], val: NE, what: 'crit', w: critW });
  out.areaWhile = AREA_WHILE.filter(([k]) => sum[k]).map(([k, cv]) => ({ cv, val: sum[k] }));
  out.areaIgnited = attack ? v(sum, 'attack_area_of_effect_+%_per_enemy_ignited_last_8_seconds') : 0;   // its text: up to 40%
  for (const [k, what, cv, en, need] of CRIT_WHILE) if (sum[k] && (!need || tags.includes(need))) out.when.push({ cond: [en ? { type: 'ActorCondition', actor: 'enemy', var: cv } : { type: 'Condition', var: cv }], val: sum[k], what,
    w: what === 'crit' ? critW : cbW });
  // the build's penetration of the enemy's elemental resistances, by its hits (the supports', the tree's); the attacks' own.
  // and the weapon's own ("Attacks with this Weapon Penetrate X% Fire Resistance"). note: not counted "while Shapeshifted"
  // (the scene has none)
  out.pen = Object.fromEntries(['fire', 'cold', 'lightning'].map(e => [e, v(sum, `base_reduce_enemy_${e}_resistance_%`, 'reduce_enemy_elemental_resistance_%', 'base_penetrate_elemental_resistances_%')
    + (attack ? v(sum, 'base_attack_damage_penetrates_elemental_resist_%') + (w?.pen?.[e] || 0) : 0)]));
  if (d.totem && d.cast_time_ms) out.placeTime = d.cast_time_ms / 1000 / (1 + v(sum, 'summon_totem_cast_speed_+%') / 100);   // placing the totem: the gem's cast time, faster with totem placement speed
  out.projSpeed = 1 + (v(sum, 'base_projectile_speed_+%') + (spell ? v(sum, 'spell_skill_projectile_speed_+%') : 0) + (tags.includes('crossbow') ? v(sum, 'projectile_speed_+%_with_crossbow_skills') : 0)) / 100;   // increased projectile speed (the scene's projectiles)
  for (const el of ['fire', 'cold', 'lightning']) if (sum['penetrate_elemental_resistance_%_while_shapeshifted']) out.when.push({ cond: [{ type: 'Condition', var: 'Shapeshifted' }], val: sum['penetrate_elemental_resistance_%_while_shapeshifted'], what: 'pen', el });
  if (sum['damage_+%_vs_immobilised_enemies_while_shapeshifted']) out.when.push({ cond: [{ type: 'Condition', var: 'Shapeshifted' }, { type: 'ActorCondition', actor: 'enemy', var: 'Immobilised' }], val: sum['damage_+%_vs_immobilised_enemies_while_shapeshifted'], what: 'damage', w: out.incW });
  if (sum['lightning_penetration_%_while_on_low_mana']) out.when.push({ cond: [{ type: 'Condition', var: 'LowMana' }], val: sum['lightning_penetration_%_while_on_low_mana'], what: 'pen', el: 'lightning' });
  // "increased Spell Damage if you've consumed an Elemental Infusion Recently"
  const infSpell = spell ? v(sum, 'spell_damage_+%_if_have_consumed_infusion_recently') : 0;
  if (infSpell) out.when.push({ cond: [{ type: 'Condition', var: 'ConsumedInfusionRecently' }], val: infSpell, what: 'damage', w: out.incW });
  // the rules of the skill's other parts (its second hit, the explosion...) and the on / off rules of the gem and its
  // supports (never_freeze, always_ignite, base_consume_enemy_shock_on_hit: available.py)
  const flags = new Set([...(d.flags || []), ...(g.supports || []).flatMap(n => SK.skills[n]?.flags || [])]);
  const part = out.part = { ...(d.part || {}), ...(d.part_levels?.[st._level] || {}) };   // the skill's other part's stats (Supercharged Slam's Aftershocks)
  // (a 0 the main part carries for a stat of the other part does not hide it: Falling Thunder's damage per power charge)
  out.ail = ailments({ ...part, ...Object.fromEntries(Object.entries(st).filter(([k, x]) => x || !(k in part))) }, sum, Object.fromEntries(Object.entries(finals).filter(([k]) => !twice.has(k))), tags, flags);   // a stat with _final inside its name (…_final_vs_frozen_enemies) once, already in sum
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
  // ones added (curses' and marks' own too, Banners', Hazards', Grenades', chaos skills', minions' and Offerings'), times each support's more (Persistence, Swift Affliction, Limit...), as PoB2
  // (SkillStatMap: Duration INC / MORE) and the game texts say; detonation and totem time their own increased
  const sec = (k, m = 1) => st[k] ? st[k] / 1000 * m : null, both = (...k) => v(st, ...k) + v(sum, ...k);
  const durMore = Math.max(0, 1 + (both('skill_effect_duration_+%') + (curse ? v(sum, 'base_curse_duration_+%', 'curse_skill_effect_duration_+%') : 0)
    + (mark ? v(sum, 'mark_skill_duration_+%') : 0) + ['banner', 'hazard', 'grenade'].reduce((t, x) => t + (own.includes(x) ? v(sum, `${x}_duration_+%`, `${x}_skill_duration_+%`) : 0), 0)
    + (own.includes('chaos') ? v(sum, 'chaos_skill_effect_duration_+%') : 0) + (own.includes('minion') ? v(sum, 'base_minion_duration_+%') : 0) + (GEM[g.name]?.types?.includes('Offering') ? v(sum, 'offering_duration_+%') : 0)) / 100) * (1 + (own.includes('plant') ? v(sum, 'plant_skill_effect_duration_+%_final_from_archon_of_nature') : 0) / 100) * (wild ? .25 : 1) * Object.entries(finals).reduce((m, [k, x]) => /skill_effect(?:_and_damaging_ailment)?_duration_\+%_final$/.test(k) ? m * (1 + x / 100) : m, 1);
  out.shape = { chains: (both('number_of_chains') + (attack ? v(sum, 'attacks_num_of_additional_chains') : 0) + (own.includes('lightning') ? v(sum, 'lightning_skill_additional_chains') : 0)) * (1 + (finals['support_dominus_grasp_chain_count_+%_final'] || 0) / 100),   // Dominus' Grasp: 100% more times
    ground: 1 + v(sum, 'ground_effect_duration_+%') / 100,   // Persistent / Lasting Ground
    projectiles: st.base_number_of_projectiles ? st.base_number_of_projectiles + both('number_of_additional_projectiles') + (own.includes('grenade') ? v(sum, 'grenade_skill_number_of_additional_projectiles') : 0) : null,   // Cluster Bombs
    // the tree's chances for more projectiles: "Surpassing" (each full 100% one more, the rest a chance), with bow
    // attacks too; spells' chance for 2 more
    // the tree's chance for another Aftershock with Mace Slams or Shapeshift Slams (as "your_slam_aftershock_chance_%", by the scene)
    aftershock: own.includes('slam') ? v(sum, 'slam_aftershock_chance_%') + (tags.includes('mace') && attack ? v(sum, 'your_mace_slam_aftershock_chance_%') : 0) + (own.includes('shapeshift') ? v(sum, 'shapeshift_slam_skill_aftershock_chance_%') : 0) : 0,
    extraProj: st.base_number_of_projectiles || own.includes('projectile') ? { chance: v(sum, 'chance_to_fire_1_additional_projectile_%_with_rollover') + (attack && tags.includes('bow') ? v(sum, 'chance_to_fire_1_additional_projectile_%_with_rollover_with_bow_attacks') : 0),
      two: spell ? v(sum, 'spell_skills_fire_2_additional_projectiles_final_chance_%') : 0 } : null,
    detonate: sec('base_skill_detonation_time', (1 + v(sum, 'grenade_fuse_duration_+%', 'skill_detonation_time_+%') / 100) * (1 + (finals['support_fast_forward_detonation_time_+%_final'] || 0) / 100)), curseDelay: sec('curse_delay_duration_ms', (1 + v(sum, 'curse_delay_+%') / 100) * (sum.keystone_hex_master ? 2 : 1)),
    duration: sec('base_skill_effect_duration', durMore), totem: sec('base_totem_duration', 1 + v(sum, 'totem_duration_+%') / 100),
    // Pierce, Fork and Chain as PoB2 counts them (CalcOffence, SkillStatMap) and the glossary orders them: a projectile
    // pierces, else forks (the first time it hits), else chains; chaining reaches 6 m from a projectile, 4 m otherwise
    // (Orb of Storms' own distance), more with increased chaining range. The less damage after piercing or forking
    pierce: flags.has('cannot_pierce') ? 0 : flags.has('always_pierce') ? Infinity : both('projectile_base_number_of_targets_to_pierce')
      + (gt.includes('Bow') ? both('arrow_base_number_of_targets_to_pierce') : 0) + both('base_chance_to_pierce_%', 'pierce_%') / 100,
    forks: flags.has('projectiles_cannot_fork') || !(flags.has('projectiles_fork') || both('projectiles_fork') || gt.includes('Bow') && both('arrows_fork')) ? 0 : Math.min(2, 1 + both('number_of_additional_forks_base')),
    pierceForked: gt.includes('Bow') && both('arrows_always_pierce_after_forking') > 0,   // Slivertongue: arrows fork, then pierce every enemy
    chainRange: (st.arc_chain_distance ? st.arc_chain_distance / 10 : gt.includes('Projectile') ? 6 : 4) * (1 + both('chaining_range_+%') / 100),
    pierceMore: finals['support_pierce_projectile_damage_+%_final_if_pierced_enemy'] || 0, perPierce: finals['support_pierce_damage_+%_final_per_pierced_target'] || 0,
    forkMore: finals['support_fork_forked_projectile_damage_+%_final'] || 0, bolts: sec('orb_of_storms_base_bolt_frequency_ms'), maxBolts: st.orb_of_storms_maximum_number_of_hits || null,
    extraTargets: st.lightning_arrow_maximum_number_of_extra_targets || 0, split: both('projectile_number_to_split'),
    // reach, in the game's tenths of a metre: a melee attack's is its weapon's range plus "+0.2 metres to Melee Strike
    // Range" (melee_range_+); a dashing strike's its own (base_melee_dash_range), a blink's its distance
    reach: tags.includes('melee') && w ? (w.range + both('melee_range_+') + (unarmed ? v(sum, 'melee_range_+_while_unarmed') : 0)) / 10 : null, dash: st.base_melee_dash_range ? st.base_melee_dash_range / 10 : null,
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
  const TO = totem(g, treeGear); out.totemLife = TO?.life; out.totemRegen = TO?.regen; out.totemRes = TO?.res;   // Tawhoa's Tending's explosion; its regeneration
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
  // speed, area, resistances). note: their movement speed is not counted (minions move at their monster's speed here)
  const msum = mid && GEM[g.name]?.types?.includes('Companion') ? companion(sum) : sum;
  // Spirit Walker's The Catha's Balance: Companions gain added Attack damage equal to a share of your main hand Weapon's damage;
  // Tactician's aura the same for every Ally in your Presence
  const cw = (msum !== sum && v(sum, 'weapon_damage_%_granted_to_companions')) + v(sum, 'aura_grant_%_base_main_hand_attack_damage_to_nearby_allies'), W = cw && weaponStats(b.items);
  const wAdd = W ? Object.fromEntries(DMG.filter(t => W[t]).map(t => [t, W[t].map(x => x * cw / 100)])) : null;
  const gsum = mid && (flags.has('minions_are_gigantic') || flags.has('companions_are_gigantic')) ? { ...msum, minions_are_gigantic: 1 } : msum;   // Hulking Minions, Tangmazu's Thurible
  const mn = out.minion = mid ? minionOf(st, gsum, { ...fin, 'support_minion_damage_with_non_command_skills_+%_final': finals['support_minion_damage_with_non_command_skills_+%_final'] }, mid, attributes(sum, b?.asc), wAdd) : null;
  out.minionLife = mid ? minionLife(st, gsum, mid, finals) : null;
  if (mn) out.ail = { ...out.ail, stun: out.ail.stun * (1 + mn.stun / 100), breakPct: out.ail.breakPct + mn.breakPct };   // the tree's Minions' Stun buildup and Armour Break
  out.minionUndead = !!mid && enemy(mid)?.category === 'Undead';   // monsters.json category (Kulemak's Sovereignty)
  if (mn && msum !== sum && sum['companion_chance_to_poison_on_hit_%']) out.ail = { ...out.ail, poison: (out.ail.poison || 0) + sum['companion_chance_to_poison_on_hit_%'] };   // the tree's Companions' chance to Poison
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
  const pinAll = F('base_all_damage_can_pin') || all('base_all_damage_can_pin') > 0 || tags.includes('attack') && all('local_all_damage_can_pin') > 0 || tags.includes('projectile') && all('all_projectile_damage_can_pin') > 0 || keys.some(k => /pins_as_though_dealt_damage/.test(k));
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
  const never = a => F('never_' + a) || (F('active_skill_never_freeze_shock_ignite') || F('cannot_inflict_elemental_ailments')) && ['freeze', 'shock', 'ignite'].includes(a);   // Excoriate, Elemental Armament III
  const skip = /mark_|debuff|_from_ot|from_current_poise|_vs_|against_|_per_|_when_|_while_|_if_|consume/;
  const more = end => keys.filter(k => !(k in sum) || k in st || k in finals).filter(k => (typeof end === 'string' ? k.endsWith(end) : end.test(k)) && !skip.test(k)).reduce((m, k) => m * (1 + all(k) / 100), 1);
  const scale = (incs, end) => (1 + incs.reduce((t, k) => t + all(k), 0) / 100) * more(end);
  const FA = 1 + all('damaging_ailments_deal_damage_+%_faster') / 100, FB = FA + all('faster_burn_%') / 100, FBl = FA + all('faster_bleed_%') / 100;   // Fast Acting Toxins (all three), Burnout, Searing Heat (ignites): damaging ailments deal their damage faster (more a second, over a shorter time)
  // Tactician's Suppressing Fire: more Immobilisation buildup (freeze, electrocute, pin)
  const SF = 1 + all('ascendancy_tactician_suppressing_fire_hit_damage_immobilisation_multiplier_+%_final') / 100;
  // buildup of the skill's tags or weapon (melee_, projectile_, quarterstaff_, mace_, ballista_, hazard_, parry_...)
  const tagInc = k => inc(sum, k, tags) - (sum[k] || 0) - (sum['base_' + k] || 0);
  const ailInc = all('ailment_chance_+%') + tagInc('ailment_chance_+%'), stunInc = all('hit_damage_stun_multiplier_+%') + tagInc('hit_damage_stun_multiplier_+%');
  // with critical hits: more of the ailments' magnitude, with their other increased ([increased, the critical ones])
  const critX = (incs, ...c) => { const i = incs.reduce((t, k) => t + all(k), 0), x = c.reduce((t, k) => t + all(k), 0); return x ? (1 + (i + x) / 100) / (1 + i / 100) : 1; };
  const dmgI = ['ailment_effect_+%', 'base_damaging_ailment_effect_+%'], nonI = ['ailment_effect_+%', 'non_damaging_ailment_effect_+%'];
  const critAil = { ignite: critX(['base_ignite_effect_+%', ...dmgI], 'critical_hit_damaging_ailment_effect_+%'), poison: critX(['base_poison_effect_+%', ...dmgI], 'critical_hit_damaging_ailment_effect_+%', 'critical_hit_poison_effect_+%'),
    bleed: critX(['base_bleeding_effect_+%', ...dmgI], 'critical_hit_damaging_ailment_effect_+%', 'critical_hit_bleeding_effect_+%'),
    shock: critX(['shock_effect_+%', ...nonI], 'non_damaging_ailment_effect_+%_with_critical_strikes'), chill: critX(['chill_effect_+%', ...nonI], 'non_damaging_ailment_effect_+%_with_critical_strikes') };
  return {
    critAil: Object.values(critAil).some(x => x !== 1) ? critAil : null,
    bleedIncision: critX(['base_bleeding_effect_+%', ...dmgI], 'bleeding_effect_+%_when_consuming_incision'),   // a bleed that consumes Incision
    bleed: all('base_chance_to_inflict_bleeding_%'), bleedCrit: all('bleed_on_crit_%') + (tags.includes('attack') ? all('bleed_on_crit_%_with_attacks') : 0), bleedFull: all('bleed_chance_+%_vs_full_life_enemy'),
    incision: all('apply_X_incision_on_hit'), incChance: tags.includes('attack') ? [all('chance_to_inflict_incision_on_attack_hit_%'), all('chance_to_inflict_10_incision_on_attack_hit_%')] : [0, 0], incFx: 1 + all('incision_effect_+%') / 100,   // attack hits' chance to apply one, or ten; each one's increased effect
    incEff: all('support_incision_bleeding_effect_+%_final_per_incision_consumed_recently_up_to_30%'), poison: all('base_chance_to_poison_on_hit_%') + (tags.includes('attack') ? all('local_poison_on_hit_%') : 0), poisonFirst: all('base_chance_to_poison_on_hit_%_vs_non_poisoned_enemies'), poisonCrit: tags.includes('dagger') ? all('chance_to_poison_on_critical_strike_with_dagger_%') : 0,
    // Maim on hit (the Maim support, the tree), against poisoned enemies, on fully breaking armour, for a while after Pin ends
    maim: F('global_maim_on_hit') || all('global_maim_on_hit') ? 100 : all('maim_on_hit_%'), maimCrit: false,
    maimPoisoned: all('maim_on_hit_%_vs_poisoned_enemies'), maimBleeding: all('maim_bleeding_enemies_on_hit_%'),
    maimMore: all('spearfield_maim_slows_an_additional_%'),   // Spearfield's maims slow more
    maimOnBreak: all('maim_enemy_on_full_armour_break') > 0, maimAfterPin: all('enemies_are_maimed_for_x_seconds_after_becoming_unpinned'),
    // increased chance to inflict Ailments (the skill's tags': projectile_, one_handed_attack_) counts for bleeding, poison,
    // ignite and shock (PoB2 CalcOffence AilmentChance); more against rare or unique enemies, shock against electrocuted
    ailChance: 1 + ailInc / 100, ailRare: (1 + (ailInc + all('ailment_chance_+%_vs_rare_or_unique_enemy')) / 100) / (1 + ailInc / 100),
    shockElectro: (1 + (ailInc + all('shock_chance_+%') + all('shock_chance_+%_vs_electrocuted_enemies')) / 100) / (1 + (ailInc + all('shock_chance_+%')) / 100),
    igniteChance: (1 + (all('ignite_chance_+%') + ailInc) / 100) * more(/(ignite_chance|chance_to_ignite)_\+%_final$/) * (all('chance_to_ignite_is_doubled') ? 2 : 1), shockChance: (1 + (all('shock_chance_+%') + ailInc) / 100) * more(/(shock_chance|chance_to_shock)_\+%_final$/) * more(/shock_as_though_damage_\+%_final$/),   // shocks as though dealing more damage (Stormcaller Arrow); Candlemaker: its ignite chance doubled
    freeze: (1 + (all('hit_damage_freeze_multiplier_+%') + all('hit_damage_immobilisation_multiplier_+%') + tagInc('hit_damage_freeze_multiplier_+%') + tagInc('hit_damage_immobilisation_multiplier_+%')) / 100) * more('hit_damage_freeze_multiplier_+%_final') * SF,
    immob: (1 + (all('hit_damage_immobilisation_multiplier_+%') + tagInc('hit_damage_immobilisation_multiplier_+%')) / 100) * SF,   // increased Immobilisation buildup: freeze, electrocute, pin
    // the character's own 50% more from physical and melee hits (character.ot) is added by the scene
    stun: (1 + stunInc / 100) * more('hit_damage_stun_multiplier_+%_final'),
    // more of it if you've Shapeshifted to an Animal form Recently, against enemies within 2 m; elemental ailment chance after Shapeshifting
    stunShift: (1 + (stunInc + all('hit_damage_stun_multiplier_+%_if_youve_shapeshifted_to_animal_recently')) / 100) / (1 + stunInc / 100),
    stunClose: (1 + (stunInc + all('hit_damage_stun_multiplier_+%_vs_enemies_at_close_range')) / 100) / (1 + stunInc / 100),
    stunLow: (1 + (stunInc + all('hit_damage_stun_multiplier_+%_vs_enemies_on_low_life')) / 100) / (1 + stunInc / 100), stunShifted: (1 + (stunInc + all('hit_damage_stun_multiplier_+%_while_shapeshifted')) / 100) / (1 + stunInc / 100),
    elShock: (1 + (all('hit_damage_electrocute_multiplier_+%') + all('hit_damage_electrocute_multiplier_+%_vs_shocked_enemies')) / 100) / (1 + all('hit_damage_electrocute_multiplier_+%') / 100),
    ailShift: (1 + (ailInc + all('elemental_ailment_chance_+%_if_youve_shapeshifted_to_animal_recently')) / 100) / (1 + ailInc / 100),
    // "increased Magnitude of Ailments you inflict" counts for each, of Damaging Ailments for ignite, poison and bleeding, of Non-Damaging ones for shock and chill
    shockEffect: scale(['shock_effect_+%', 'ailment_effect_+%', 'non_damaging_ailment_effect_+%'], 'shock_effect_+%_final') * (1 + all('stormweaver_shock_effect_+%_final') / 100), chillEffect: scale(['chill_effect_+%', 'ailment_effect_+%', 'non_damaging_ailment_effect_+%'], 'chill_effect_+%_final') * (1 + all('stormweaver_chill_effect_+%_final') / 100),   // Stormweaver: less
    igniteEffect: scale(['base_ignite_effect_+%', 'ailment_effect_+%', 'base_damaging_ailment_effect_+%'], /(?:ignite|(?<!non_)damaging_ailment)_effect_\+%_final$/) * FB, poisonEffect: scale(['base_poison_effect_+%', 'ailment_effect_+%', 'base_damaging_ailment_effect_+%'], /(?:poison|(?<!non_)damaging_ailment)_effect_\+%_final$/) * FA,   // Shattering Spite: all three
    bleedEffect: scale(['base_bleeding_effect_+%', 'ailment_effect_+%', 'base_damaging_ailment_effect_+%'], /(?:bleeding|(?<!non_)damaging_ailment)_effect_\+%_final$/) * FBl * (sum.keystone_crimson_assault ? 1.5 : 1),
    bleedBase: sum.keystone_crimson_assault ? 1 : null, bleedAgg: !!(sum.keystone_crimson_assault || sum.aggravate_inflicted_bleeding),   // Crimson Assault: 50% more, a 1 second base duration, always Aggravated (Apron of Emiran: Aggravated)
    shockTime: scale(['shock_duration_+%', 'ignite_shock_chill_duration_+%', 'base_elemental_status_ailment_duration_+%'], 'shock_duration_+%_final'),
    chillTime: scale(['chill_duration_+%', 'ignite_shock_chill_duration_+%', 'base_elemental_status_ailment_duration_+%'], 'chill_duration_+%_final'),
    freezeTime: scale(['freeze_duration_+%', 'base_elemental_status_ailment_duration_+%'], 'freeze_duration_+%_final'), pinTime: (1 + all('pin_duration_+%') / 100) * (1 + all('support_pin_pin_duration_+%_final') / 100),
    igniteTime: scale(['ignite_duration_+%', 'ignite_shock_chill_duration_+%', 'base_elemental_status_ailment_duration_+%'], 'damaging_ailment_duration_+%_final') / FB,
    bleedTime: scale(['base_bleed_duration_+%'], 'damaging_ailment_duration_+%_final') / FBl,   // and Bleeding's own faster
    poisonTime: scale(['base_poison_duration_+%'], /(?:damaging_ailment|_poison)_duration_\+%_final$/) / FA * (1 + all('pathfinder_poison_duration_+%_final') / 100),   // Overwhelming Toxicity's less (the tree's)   // Escalating Poison's less
    // Armour Break: a flat amount per hit and / or a share of the physical damage dealt
    breakFlat: all('apply_X_armour_break_on_hit'), breakPct: all('armour_break_physical_damage_%_dealt_as_armour_break'),
    breakMore: scale(['armour_break_amount_+%'], 'armour_break_amount_+%_final'),
    // more of it against enemies with an ailment (its increased with the others), Fully Broken Armour's effect and duration
    breakAil: (1 + (all('armour_break_amount_+%') + all('armour_break_amount_+%_vs_enemies_affected_by_ailments')) / 100) / (1 + all('armour_break_amount_+%') / 100),
    brokenEff: 1 + all('broken_armour_and_sundered_armour_debuff_effect_+%') / 100, brokenTime: 1 + all('armour_break_and_sundered_armour_duration_+%') / 100,
    // what every hit of a player has (character.ot): more heavy stun buildup from physical damage and melee hits, and
    // more Armour Break against normal and magic monsters
    stunPhys: 1 + (CHAR['physical_hit_damage_stun_multiplier_+%_final_from_ot'] || 0) / 100,
    stunMelee: tags.includes('melee') ? 1 + (CHAR['melee_hit_damage_stun_multiplier_+%_final_from_ot'] || 0) / 100 : 1,
    breakNormal: 1 + (CHAR['object_inherent_armour_break_amount_+%_final_against_normal_monsters'] || 0) / 100,
    breakMagic: 1 + (CHAR['object_inherent_armour_break_amount_+%_final_against_magic_monsters'] || 0) / 100,
    never: { freeze: never('freeze'), shock: never('shock'), ignite: never('ignite'), stun: F('cannot_stun'), armour: F('cannot_break_armour'), bleed: F('cannot_cause_bleeding') },
    always: { freeze: F('always_freeze'), shock: F('always_shock'), ignite: F('always_ignite'), stun: F('always_stun') },
    alwaysHit: F('global_always_hit'),
    // Impale: its chance on hit (any hit, attacks', spells'), its magnitude more and how many it applies; whether the skill extracts them
    impale: { chance: all('impale_on_hit_%_chance') + all(tags.includes('attack') ? 'attacks_impale_on_hit_%_chance' : 'spells_impale_on_hit_%_chance'),
      mag: scale(['impale_magnitude_+%', ...tags.includes('spell') ? ['spell_impale_magnitude_+%'] : []], 'active_skill_impale_magnitude_+%_final'), n: 1 + all('number_of_additional_impaled_debuffs_to_apply'), keep: F('cannot_consume_impale'), crit: F('critical_hits_always_apply_impale'), critKeep: F('critical_hits_cannot_consume_impale') },   // Dreadfist: critical hits always Impale
    // electrocute and pin from the skill, or from the build's "<type> damage can electrocute / pin" (uniques, passives)
    electrocute: F('base_lightning_damage_can_electrocute') || all('base_lightning_damage_can_electrocute') + all('base_chaos_damage_can_electrocute') + (tags.includes('attack') ? all('all_attack_damage_can_electrocute') + all('local_all_damage_can_electrocute') : 0) > 0 || keys.some(k => /electrocutes_as_though_dealt_damage/.test(k)) ? scale(['hit_damage_electrocute_multiplier_+%'], /electrocutes_as_though_dealt_damage_\+%_final$/) : 0,
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
    * Object.entries(ms).filter(([k]) => /^max(imum)?_life_\+%_final/.test(k)).reduce((t, [, x]) => t * (1 + x / 100), 1)
    * (sum.keystone_kulemaks_sovereignty && m.category === 'Undead' ? .75 : 1) * (ms.is_gigantic ? 1 + GIGANTIC / 100 : 1));   // Kulemak's Sovereignty: Undead minions 25% less
}
const GIGANTIC = 20;   // note: keywords.json Gigantic: 20% more maximum life, 20% more damage (and size: the scene's)
// "Companions gain X% of Damage as extra Chaos / Cold" have no "Minions" twin: the companion's own stat ("minion:")
const OWN = { 'companion_%_damage_as_chaos': 'minion:non_skill_base_all_damage_%_to_gain_as_chaos', 'companion_%_damage_as_cold': 'minion:non_skill_base_all_damage_%_to_gain_as_cold' };
const companion = sum => { const out = { ...sum }; for (const [k, x] of Object.entries(sum)) if (k.startsWith('companion_')) { const m = OWN[k] || 'minion_' + k.slice(10); out[m] = (out[m] || 0) + x; } return out; };
// the tree's minion stats the game's table does not list, as their minion_area_of_effect_+% twin
const MS_ALSO = { 'minion_skill_area_of_effect_+%': 'base_skill_area_of_effect_+%', ...Object.fromEntries(['fire', 'cold', 'lightning'].map(e => [`minion_${e}_damage_resistance_%`, `base_${e}_damage_resistance_%`])) };
// the build's and the gem's stats that are the minion's (SK.minion_stats: "minion_x" -> its "x"), added to `ms`
function minionStats(st, sum, ms) {
  // what Allies in your Presence get. ponytail: counted always (a minion is near you most of the time); the scene's presence check if it matters
  for (const [k, to] of [['allies_in_presence_damage_+%', 'damage_+%'], ['allies_in_presence_attack_speed_+%', 'attack_speed_+%'], ['allies_in_presence_cast_speed_+%', 'base_cast_speed_+%'], ['allies_in_presence_critical_strike_chance_+%', 'critical_strike_chance_+%'],
    ['allies_in_presence_damage_%_to_gain_as_fire', 'non_skill_base_all_damage_%_to_gain_as_fire'], ['allies_in_presence_non_skill_base_all_damage_%_to_gain_as_chaos', 'non_skill_base_all_damage_%_to_gain_as_chaos'],   // Sacred Flame, Evergrasping Ring
    ['allies_in_presence_critical_strike_multiplier_+', 'critical_strike_multiplier_+']]) if (sum[k]) ms[to] = (ms[to] || 0) + sum[k];   // Fixation of Yix
  for (const src of [sum, st]) for (const [k, x] of Object.entries(src)) { const to = SK.minion_stats?.[k] || MS_ALSO[k] || src === sum && k.startsWith('minion:') && k.slice(7); if (to && typeof x === 'number') ms[to] = (ms[to] || 0) + x; }   // "minion:<stat>": the minion's own (Necromantic Talisman's amulet)
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
  // "gain X% of Damage as extra <type>" (Companions'), of the damage after conversion
  const pre = DMG.map(t => base[t]), all = [0, 1].map(i => pre.reduce((x, r) => x + r[i], 0));
  for (const t of DMG) { const g = v(ms, `non_skill_base_all_damage_%_to_gain_as_${t}`); if (g) base[t] = base[t].map((x, i) => x + all[i] * g / 100); }
  const ec = v(ms, 'non_skill_base_elemental_damage_%_to_gain_as_chaos'); if (ec) base.chaos = base.chaos.map((x, i) => x + (pre[1][i] + pre[2][i] + pre[3][i]) * ec / 100);   // Forbidden Path: of their elemental damage
  const scale = t => (1 + (inc(ms, 'damage_+%', tags) + v(ms, `${t}_damage_+%`) + (t !== 'physical' && t !== 'chaos' ? v(ms, 'elemental_damage_+%') : 0)) / 100)
    * (1 + v(ms, 'damage_+%_final_for_minion') / 100) * (1 + v(st, 'active_skill_minion_damage_+%_final') / 100) * more(fin, 'damage_+%', tags, t)
    * (1 + (fin['support_minion_damage_with_non_command_skills_+%_final'] || 0) / 100) * (ms.is_gigantic ? 1 + GIGANTIC / 100 : 1);   // Commandment: none with its own attacks
  const hits = {};
  for (const t of DMG) if (base[t][1]) hits[t] = base[t].map(x => Math.round(x * scale(t)));
  const both = v(sum, 'minion_attack_and_cast_speed_+%') + v(ms, 'skill_speed_+%');
  const speed = a.attack ? (1 + (inc(ms, 'attack_speed_+%', tags) + both) / 100) * (1 + v(ms, 'attack_speed_+%_final_for_minions') / 100) : 1 + (inc(ms, 'cast_speed_+%', tags) + both) / 100;
  const period = st.living_lightning_beam_attack_time_ms ? st.living_lightning_beam_attack_time_ms / 1000 : a.period;   // Living Lightning: its beam's attack time
  // its resistances: the monster's own (up to the monsters' maximum, more with its maximum) and what the build gives minions
  const res = Object.fromEntries(['fire', 'cold', 'lightning', 'chaos'].map((e, i) => [e, Math.min((MON_K.monster_max_resistance ?? 75) + (e === 'chaos' ? 0 : v(ms, `base_maximum_${e}_damage_resistance_%`, 'additional_maximum_all_elemental_resistances_%')),
    (m.res?.[i] || 0) + v(ms, `base_${e}_damage_resistance_%`) + (e === 'chaos' ? 0 : v(ms, 'base_resist_all_elements_%')))]));
  res.physical = v(ms, 'base_additional_physical_damage_reduction_%');
  // what keeps it alive, for the scene: life regenerated a minute and damage taken Recouped (both %, with its life
  // recovery rate), its share of life as extra energy shield; its Stun buildup and Armour Break
  const rec = 1 + v(ms, 'life_recovery_rate_+%') / 100;
  return { name: m.name, level, hits, res, gigantic: !!ms.is_gigantic, regen: v(ms, 'life_regeneration_rate_per_minute_%') * rec, recoup: v(ms, 'damage_taken_goes_to_life_over_4_seconds_%') * rec,
    es: v(ms, 'maximum_life_%_to_gain_as_maximum_energy_shield'), stun: v(ms, 'hit_damage_stun_multiplier_+%'), breakPct: v(ms, 'armour_break_physical_damage_%_dealt_as_armour_break'),
    speed: Math.min(speed / period, a.cooldown ? (1 + v(ms, 'base_cooldown_speed_+%') / 100) / a.cooldown : Infinity),
    crit: Math.min(100, a.crit * (1 + inc(ms, 'critical_strike_chance_+%', tags) / 100)),
    critBonus: a.critBonus + v(ms, 'base_critical_hit_damage_bonus') + inc(ms, 'critical_strike_multiplier_+', tags) };
}
// self-check: a gem level 20 Raise Zombie raises a level 40 zombie: 204 x 0.75 ± 30% = 107-198 physical every 1.25 s, crit
// bonus 30 + 70; Raging Spirits' 40% more attack speed and 70% of physical as fire (the gem's), and 20% more damage from the tree
if (SK.minions['Raise Zombie']) {
  const z = skill({ name: 'Raise Zombie', level: 20, supports: [] }, { gems: [], items: {} }, {}), r = skill({ name: 'Raging Spirits', level: 20, supports: [] }, { gems: [], items: {} }, { 'minion_damage_+%': 20 });
  console.assert(z.minion?.level === 40 && z.hits.physical?.join() === '107,198' && Math.abs(z.speed - .8) < 1e-9 && z.critBonus === 100
    && r.hits.fire?.join() === '96,144' && r.hits.physical?.join() === '41,62' && Math.abs(r.speed - 1.4) < 1e-9, 'minion damage', z, r);
  // Gigantic (the tree's, Hulking Minions): 20% more damage and life; the tree's physical damage reduction, regeneration and Recoup are the minion's
  const G = s => skill({ name: 'Raise Zombie', level: 20, supports: s ? ['Hulking Minions'] : [] }, { gems: [], items: {} }, s ? {} : { minions_are_gigantic: 1, 'minion_additional_physical_damage_reduction_%': 12, 'minion_life_regeneration_rate_per_minute_%': 180, 'minion_life_recovery_rate_+%': -10, 'minion_damage_taken_%_recouped_as_their_life': 15 }), g = G(), h = G(1);
  console.assert([g, h].every(x => x.minion.gigantic && Math.abs(x.dps - z.dps * 1.2) < z.dps * .01 && Math.abs(x.minionLife - z.minionLife * 1.2) <= 1) && g.minion.res.physical === 12 && g.minion.regen === 162 && g.minion.recoup === 13.5 && !z.minion.gigantic, 'gigantic minions', g.minion, h.minion);
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
    speed: st['base_skill_debuff_action_speed_+%_final_to_inflict'] || 0, expire: st['base_temporal_chains_other_buff_time_passed_+%_to_apply'] || 0, maxLevel: st.skill_curses_cannot_apply_to_targets_above_level || null,
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
    reqPct: v(sum, 'global_item_attribute_requirements_+%'), glovesFree: !!sum.ignore_attribute_requirements_for_gloves,   // the Equipment card's requirements
    reqFree: !!sum.global_equipment_no_attribute_requirements, noStrMelee: !!sum.ignore_strength_requirements_of_melee_weapons_and_skills, giant: !!sum.keystone_giants_blood,   // Giant's Blood: triple on martial weapons
    satisfy: [sum.dexterity_can_satisfy_strength_and_intelligence_requirements_of_melee_weapons_and_skills && 'dex', sum.strength_can_satisfy_dexterity_and_intelligence_requirements_of_melee_weapons_and_skills && 'str'].filter(Boolean),   // Jarngreipr: of melee weapons
    dps: (b.gems || []).map(g => [tn(GEM[g.name]) || g.name, skill(g, b, sum).dps]) };
}
// "You cannot evade": the evasion stays, its chance does not (after another change to the evasion too)
if (MON.length) { const b = { asc: 'Warrior', level: 80, nodes: [], gems: [] }, sum = { base_evasion_rating: 5000, 'vivisection_armour_evasion_energy_shield_+%_final': -10 }, a = character(b, sum), z = character(b, { ...sum, base_cannot_evade: 1 });
  console.assert(a.evadePct > 0 && a.evadeMax == null && z.evasion === a.evasion && z.evadePct === 0 && z.evadeMax === 0, 'cannot evade'); }
// Thaumaturgical Infusion: maximum cold resistance per blue support, lightning per green
if (GEMS.length) { const of = a => GEMS.filter(g => g.kind === 'support' && g.attr?.[a] > 0 && Object.values(g.attr).filter(Boolean).length === 1).slice(0, 3).map(g => g.name);
  const mx = (a, e) => character({ asc: 'Warrior', level: 1, nodes: [], gems: [{ name: 'Spark', supports: of(a) }] }, { [`maximum_${e}_resistance_+1_per_X_corresponding_support`]: 3 }).res[e].max;
  console.assert(mx('int', 'cold') === mx('dex', 'cold') + 1 && mx('dex', 'lightning') === mx('int', 'lightning') + 1 && mx('str', 'fire') === mx('int', 'fire') + 1, 'support colours'); }
{ const c = { life: 1000, es: 400 }, sum = { 'life_regeneration_rate_per_minute_%': 60 }, a = recovery(c, sum), b = recovery(c, { ...sum, 'map_player_life_and_es_recovery_speed_+%_final': -40 });
  console.assert(a.lifeRegen === 10 && Math.abs(b.lifeRegen - 6) < 1e-9 && Math.abs(b.esRecharge - a.esRecharge * .6) < 1e-9 && b.recMore === .6, "a map's less recovery rate"); }
