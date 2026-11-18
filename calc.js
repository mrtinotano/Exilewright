// Character sheet and skill damage, from the summed tree + gear stats (app.js treeSum) and the game data.
// The numbers are the game's own (class base life/mana, skill damage per level: skills.json / ascendancies.json,
// regenerated with poe2_data/_tool after each patch); what the data does not have is null and shown as "—".
import { t, tn, fmt, cap, lang } from './i18n.js';
import { weaponStats, classOf, rowReader, flaskRecovery, armourItems } from './items.js';
import { SK } from './skilldata.js';
import { enemy, attackOf, attacksOf } from './enemies.js';

// Campaign rewards a character keeps for good. Which the campaign gives and which are a choice comes from Path of
// Building 2 (skilldata.js); the stats of each are the game's own table's, met through the wording of each line.
// b.quests: reward key -> the option taken (1 the first, 0 none). A reward not set counts from the level of its area
// on; a choice among several only once made.
const reward = rowReader(SK.quest_rewards || []);
export const QUESTS = (SK.quests || []).map(q => ({ ...q, options: q.options.map(text => ({ text, ...reward(text.split('\n').map(l => l.trim()).filter(Boolean)) })) }));
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
export function skillStats(b) {
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
// note: levels a support adds to its skill and those for corrupted gems are not counted
export function gemStats(g, sum = {}) {
  const d = SK.skills[g.name] || {}, tags = GEM[g.name]?.tags || [], end = '_skill_gem_level_+';
  const fits = w => w === 'all' || tags.includes(w) || w === 'elemental' && ['fire', 'cold', 'lightning'].some(e => tags.includes(e));
  let level = g.level;
  for (const [k, x] of Object.entries(sum)) if (k.endsWith(end) && k.slice(0, -end.length).split('_').every(fits)) level += x;
  const quality = (g.quality || 0) + v(sum, 'all_skill_gem_quality_+');
  const st = { ...(d.constant || {}), ...(d.levels?.[level] || d.levels?.[g.level] || {}), _level: level, _quality: quality };
  for (const q of [d.quality, sum.ascendancy_gemling_enable_thaumaturgy_quality_stats && d.alt_quality])
    for (const [k, x] of Object.entries(q || {})) st[k] = (st[k] || 0) + Math.trunc(x * quality / 1000);
  return st;
}
// Spirit a gem reserves: its amount over (100% + reservation efficiency), the gem's own (quality) plus what passives
// and gear give every skill or those of one of its tags (reservation_efficiency_+%_of_herald_skills).
// note: rounded to the nearest, as Path of Building 2 does
export function reservation(g, sum = {}) {
  const st = gemStats(g, sum), id = 'base_spirit_reservation_efficiency_+%';
  const eff = (st[id] || 0) + v(sum, id, ...(GEM[g.name]?.tags || []).map(t => `reservation_efficiency_+%_of_${t}_skills`));
  return Math.round((st._spirit || 0) * 100 / (100 + eff));
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
    life: Math.round(Math.floor(monster(level, 'AllyLife') * T.life_mult) * (1 + (v(s, 'totem_life_+%') + (st['totem_life_+%'] || 0)) / 100)),
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
    const flat = base[k] + v(sum, 'base_' + id, 'additional_' + id, 'additional_all_attributes', ...pair[k].flatMap(p => ['additional_' + p, 'base_' + p]));
    out[k] = Math.floor(flat * (1 + v(sum, id + '_+%', 'all_attributes_+%') / 100));
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

export function character(b, sum) {
  const A = ascOf(b.asc), cb = A.class_base || {}, lvl = b.level || 1, at = attributes(sum, b.asc);
  const fromAttr = k => ['Strength', 'Dexterity', 'Intelligence'].reduce((t, a, i) => t + (perAttr(a)[k] || 0) * at[['str', 'dex', 'int'][i]], 0);
  // the class's own amount (Characters row: 16 life, 30 mana) plus character.ot's amount per level, the first included
  const base = (row, perLvl) => cb[row] == null || CHAR[perLvl] == null ? null : cb[row] + lvl * CHAR[perLvl];
  const lifeBase = base('BaseMaxLife', 'life_per_level'), manaBase = base('BaseMaxMana', 'mana_per_level');
  const pct = (...ids) => 1 + v(sum, ...ids) / 100;
  const res = {};
  // the game lowers elemental resistances by the level of the area (ResistancePenaltyPerAreaLevel: none at first,
  // -60% from level 65 on): the area level the build sets (b.zone), else one of the character's level
  const penalty = SK.resistance_penalty?.[Math.min(b.zone || lvl, SK.resistance_penalty.length) - 1] || 0;
  for (const [k, others] of Object.entries({ fire: ['cold', 'lightning', 'chaos'], cold: ['fire', 'lightning', 'chaos'], lightning: ['fire', 'cold', 'chaos'], chaos: ['fire', 'cold', 'lightning'] })) {
    const combos = others.flatMap(o => [`${k}_and_${o}_damage_resistance_%`, `${o}_and_${k}_damage_resistance_%`]);
    const val = v(sum, `base_${k}_damage_resistance_%`, ...combos, ...(k === 'chaos' ? [] : ['base_resist_all_elements_%']))
      + (k === 'chaos' || sum[`${k}_resist_unaffected_by_area_penalties`] ? 0 : penalty);
    const max = CHAR['base_maximum_all_resistances_%'] + v(sum, `base_maximum_${k}_damage_resistance_%`, 'additional_maximum_all_resistances_%', ...(k === 'chaos' ? [] : ['additional_maximum_all_elemental_resistances_%']));
    res[k] = { value: val, max, capped: Math.min(val, max) };
  }
  const defInc = 'global_armour_evasion_energy_shield_+%';
  const armour = Math.round(v(sum, 'base_physical_damage_reduction_rating') * pct('physical_damage_reduction_rating_+%', 'evasion_and_physical_damage_reduction_rating_+%', defInc));
  const evasion = Math.round((v(sum, 'base_evasion_rating') + (CHAR.base_evasion_rating || 0)) * pct('evasion_rating_+%', 'evasion_and_physical_damage_reduction_rating_+%', defInc));
  return {
    level: lvl, attrs: at,
    life: lifeBase == null ? null : Math.round((lifeBase + v(sum, 'base_maximum_life') + fromAttr('life')) * pct('maximum_life_+%', 'maximum_life_mana_and_energy_shield_+%')),
    mana: manaBase == null ? null : Math.round((manaBase + v(sum, 'base_maximum_mana') + fromAttr('mana')) * pct('maximum_mana_+%', 'maximum_life_mana_and_energy_shield_+%')),
    // what gear gives ("+30 to Spirit", a sceptre's own) is its own stat: one passive turns it off
    spirit: Math.round((first(cb.BaseSpirit, CHAR.base_spirit, 0) + v(sum, 'base_spirit') + (sum.cannot_gain_spirit_from_equipment ? 0 : v(sum, 'base_spirit_from_equipment'))) * pct('spirit_+%')),
    // spirit reserved by the build's persistent skills
    reserved: (b.gems || []).reduce((t, g) => t + reservation(g, sum), 0),
    es: Math.round(v(sum, 'base_maximum_energy_shield') * pct('maximum_energy_shield_+%', defInc, 'maximum_life_mana_and_energy_shield_+%')),
    armour, evasion, armourPct: armourReduction(armour, lvl), evadePct: evadeChance(evasion, lvl),
    block: v(sum, 'additional_block_%', 'block_%'),
    charges: Object.fromEntries(['frenzy', 'power', 'endurance'].map(c => [c, (CHAR[`max_${c}_charges`] || 0) + v(sum, `max_${c}_charges`)])),
    res, penalty,
    // the armour's movement penalty is apart from the increases (the game's panel, 17/11: 25% boots, -4% body armour: +20.0%)
    move: (1 + (v(sum, 'base_movement_velocity_+%') - armourItems(b.items).movement) / 100) * (1 + armourItems(b.items).movement / 100) * 100 - 100,
    attackSpeed: v(sum, 'attack_speed_+%', 'attack_and_cast_speed_+%'),
    castSpeed: v(sum, 'base_cast_speed_+%', 'attack_and_cast_speed_+%'),
    critInc: v(sum, 'critical_strike_chance_+%'),
    critBonus: 100 + v(sum, 'base_critical_strike_multiplier_+'),  // documented game rule: every character has +100% base critical damage bonus
    // character.ot: accuracy per level above the first
    accuracy: Math.round(((CHAR.accuracy_rating_per_level || 0) * (lvl - 1) + v(sum, 'accuracy_rating') + fromAttr('accuracy')) * pct('accuracy_rating_+%')),
    missingBase: lifeBase == null,
  };
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
  return {
    lifeRegen: lifePctRegen && c.life == null ? null
      : (v(sum, 'base_life_regeneration_rate_per_minute') + (c.life || 0) * lifePctRegen / 100) / 60 * pct('life_regeneration_rate_+%', 'life_recovery_rate_+%'),
    esRate, esDelay: CHAR.energy_shield_delay_ms / 1000 / (1 + v(sum, 'energy_shield_delay_-%') / 100),
    esRecharge: c.es * esRate * pct('energy_shield_recharge_rate_+%'),
    manaRegen: c.mana == null || manaLife && c.life == null ? null
      : (c.mana * manaBase + (c.life || 0) * manaLife / 100 / 60) * pct('mana_regeneration_rate_+%', 'mana_recovery_rate_+%'),
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
  const allAil = v(sum, 'base_all_ailment_duration_on_self_+%'), eleAil = v(sum, 'self_elemental_status_duration_-%');
  const IMMUNE = { ignite: ['immune_to_ignite', 'base_immune_to_ignite'], chill: ['immune_to_chill', 'base_immune_to_chill'], shock: ['immune_to_shock', 'base_immune_to_shock'],
    freeze: ['immune_to_freeze', 'base_immune_to_freeze'], bleed: ['immune_to_bleeding'], poison: ['immune_to_poison', 'cannot_be_poisoned'], stun: ['base_cannot_be_stunned'] };
  const avoid = {}, dur = {};
  for (const [a, ids] of Object.entries(IMMUNE)) {
    const el = ELEM_AIL.includes(a);
    avoid[a] = ids.some(k => sum[k]) ? 100 : Math.min(100, v(sum, `base_avoid_${a}_%`, `avoid_${a}_%`) + (el ? v(sum, 'avoid_all_elemental_status_%') : 0));
    dur[a] = el ? Math.max(0, 1 - (v(sum, `base_self_${a}_duration_-%`) + eleAil - allAil) / 100)
      : Math.max(0, 1 + (v(sum, `self_${a}_duration_+%`) + allAil) / 100) * (1 + v(sum, `self_${a}_duration_+%_final`) / 100);
  }
  dur.stun = pct('stun_duration_on_self_+%') / pct('base_stun_recovery_+%');   // as Path of Building 2: longer stuns, divided by stun recovery
  const eff = { chill: pct('chilled_effect_on_self_+%', 'shocked_chilled_effect_on_self_+%'), shock: pct('shocked_effect_on_self_+%', 'shocked_chilled_effect_on_self_+%'), ignite: pct('ignite_effect_on_self_+%') };
  return { stun, ail, freeze, avoid, dur, eff };
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
  const base = (CHAR.base_maximum_rage || 0) + v(sum, 'maximum_rage'), any = !!rg || !!sum.maximum_rage || Object.values(gain).some(x => x > 0);
  return {
    base: any ? base : 0, gain, delay: (CHAR.rage_loss_delay_ms + v(sum, 'rage_loss_delay_ms_+')) / 1000, loss: sum.no_inherent_rage_loss ? 0 : CHAR.rage_loss_per_minute / 60,
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
  const deflect = (c.armour * v(sum, 'base_deflection_rating_%_of_armour') + c.evasion * v(sum, 'base_deflection_rating_%_of_evasion_rating')) / 100 * pct('deflection_rating_+%');
  // thorns
  const thorns = [v(sum, 'thorns_minimum_base_physical_damage'), v(sum, 'thorns_maximum_base_physical_damage')].map(x => Math.round(x * pct('thorns_damage_+%')));
  // stun / ailment thresholds
  const { stun, ail } = ailmentDefence(c, sum);
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
  // armour against elements: the % of it that applies to each (passives, and the body armour's own grants)
  const applies = { fire: v(sum, 'base_armour_%_applies_to_fire_damage'), cold: v(sum, 'base_armour_%_applies_to_cold_damage'), lightning: v(sum, 'base_armour_%_applies_to_lightning_damage', 'base_armour_applies_to_lightning_damage') };
  const ele = v(sum, 'armour_%_applies_to_fire_cold_lightning_damage', 'body_armour_grants_armour_%_applies_to_fire_cold_lightning_damage');
  const vs = Object.fromEntries([...Object.entries(applies).map(([e, x]) => [e, Math.round(c.armour * (x + ele) / 100)]),
    ['chaos', Math.round(c.armour * v(sum, 'base_armour_%_applies_to_chaos_damage', 'body_armour_grants_base_armour_applies_to_chaos_damage') / 100)]]);
  const asOne = vs.fire === vs.cold && vs.cold === vs.lightning;   // the game shows one "Elemental" row then
  const lvl = Math.min(b.level || 1, 82);
  const cut = x => x ? armourReduction(x, lvl) : 0;
  // block: its cap is character.ot's 50% plus "maximum Block chance"
  const blockMax = (CHAR['object_inherent_base_maximum_block_%_from_ot'] || 0) + v(sum, 'additional_maximum_block_%');
  // runic ward: flat ward, and the share of maximum life some modifiers grant as ward, scaled by increased ward
  const ward = (v(sum, 'base_maximum_ward') + (c.life || 0) * v(sum, 'maximum_life_%_to_gain_as_total_ward') / 100) * pct('maximum_ward_+%');
  // ailment durations on you: the ailment's own, the elemental ones' and all ailments' ("reduced" stats count down)
  const allAil = v(sum, 'base_all_ailment_duration_on_self_+%'), eleAil = v(sum, 'self_elemental_status_duration_-%');
  const selfDur = e => v(sum, `base_self_${e}_duration_-%`) + eleAil - allAil;
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
    'damage_%_deflected': deflect && (CHAR['damage_%_deflected'] || 0) + v(sum, 'base_damage_%_deflected'),
    'block_%': c.block && [c.block, blockMax], 'maximum_ward': ward,
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
export const DMG_NAME = { physical: '{0} physical', fire: '{0} fire', cold: '{0} cold', lightning: '{0} lightning', chaos: '{0} chaos' };
// Sum of "<prefix>_<suffix>" stats that apply to a skill with these tags (generic ones always). The prefix may be
// several words: every one has to fit (attack_area_damage_+%: attacks with an area; one_handed_melee_attack_speed_+%).
// Damage types are added per type by the caller, and what is the minions' is not the character's.
function inc(sum, suffix, tags) {
  let t = 0;
  for (let [k, val] of Object.entries(sum)) {
    // "damage_+%_with_two_handed_weapons" / "..._with_bow_skills": the qualifier is one more prefix word
    const w = k.match(/^(.*)_with_([a-z_]+?)_(?:weapons|skills)$/); if (w) k = `${w[2]}_${w[1]}`;
    if (!k.endsWith(suffix)) continue;
    const pre = k.slice(0, -suffix.length).replace(/_skill_$|_$/, '').replace(/^base_(?=.)/, '').replace(/(one|two)_handed/, '$1hand');
    if (pre === '' || pre === 'base' || pre === 'global' || pre.split('_').every(w => tags.includes(w) && !DMG.includes(w) && w !== 'minion' && w !== 'companion')) t += val;
  }
  return t;
}
console.assert(inc({ 'damage_+%_with_two_handed_weapons': 40, 'damage_+%_with_bow_skills': 5 }, 'damage_+%', ['attack', 'twohand']) === 40, 'inc: _with_ stats');
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
const plainMore = (k, name) => { const own = name.toLowerCase().replace(/[^a-z ]/g, '').split(' '); return k.split('_').every(w => PLAIN.has(w) || own.some(o => o === w || o === w + 's' || o + 's' === w)); };
export function withSupports(g, sum) {
  const all = { ...sum }, fin = {}, mods = [], finals = {};
  for (const n of g.supports || []) {
    const p = n && SK.supports?.[n], d = n && SK.skills[n]; if (!p && !d) continue;
    if (p) mods.push(...(p.mods || []).filter(m => !m[4]));
    const lv = d?.levels?.[Object.keys(d?.levels || {})[0]] || {};
    for (const [k, val] of Object.entries(p ? p.stats || {} : { ...(d.constant || {}), ...lv })) {
      if (k.startsWith('_') || typeof val !== 'number') continue;
      if (!k.endsWith('_final')) all[k] = (all[k] || 0) + val;
      else if (plainMore(k, n)) fin[k] = (fin[k] || 0) + val;
    }
    // every "more" of the support as the game's tables have it, for the rules calc.js reads by name (ailments())
    for (const [k, val] of Object.entries({ ...(d?.constant || {}), ...lv })) if (k.includes('_final') && typeof val === 'number') finals[k] = (finals[k] || 0) + val;
  }
  return { sum: all, fin, mods, finals };
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
export function skill(g, b, treeGear) {
  const G = GEM[g.name] || {}, d = SK.skills[g.name] || {}, own = G.tags || [];
  // a meta gem's supports are for the skills it uses (Mortar Cannon's, for its Cluster Grenade): not for the gem itself,
  // as the game's details window shows (Mortar Cannon with Multishot II: 1 s, not 1.25 s)
  const { sum, fin, mods, finals } = own.includes('meta') ? { sum: treeGear, fin: {}, mods: [], finals: {} } : withSupports(g, treeGear);
  const st = gemStats(g, sum);
  // a totem that is not a meta gem uses the gem's own attack or spell itself (Shockwave Totem's quake, Artillery
  // Ballista's bolts, Dark Effigy's spell: available.py lays that part over the totem)
  const ownTotem = !own.includes('meta') && d.totem || null, gt = G.types || [];
  const attack = gt.includes('Attack') || !!ownTotem && gt.includes('SummonsAttackTotem'), spell = gt.includes('Spell') || !!ownTotem && !attack && own.includes('spell');
  // flags of a support mod this skill meets: "hit" for its hits, "dot" for its damage over time, else what the skill is
  const has = dot => f => f === 'hit' ? !dot : f === 'dot' ? dot : f === 'attack' ? attack : f === 'spell' || f === 'cast' ? spell : own.includes(f);
  const hit = has(false), dmgMods = t => ['Damage', cap(t) + 'Damage', ...(t === 'physical' || t === 'chaos' ? [] : ['ElementalDamage'])];
  const out = { attack, spell, stats: st, castTime: d.cast_time_ms ?? null, hits: {}, dot: {}, avg: null, speed: null, crit: null, critBonus: null, dps: null, reason: null };
  const w = attack ? weaponStats(b.items) : null;
  // the weapons the skill is used with (ActiveSkills.WeaponRequirements; a shield skill names what the off hand holds)
  if (w && d.weapons && !['weapon', 'offhand'].some(s => d.weapons.includes(classOf(b.items[s])))) return { ...out, reason: 'This skill cannot be used with the weapon in hand' };
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
    const step = (x, f) => f < 1 ? Math.ceil(x * f) : Math.floor(x * f), raw = baseCost * supMult + v(sum, 'base_mana_cost_+');
    const inc1 = 1 + (inc(sum, 'mana_cost_+%', tags) - v(sum, 'base_mana_cost_-%') + v(sum, 'base_cost_+%')) / 100;
    const more1 = (1 + (v(sum, 'mana_cost_+%_final') + (finals['mana_cost_+%_final'] || 0)) / 100) * (1 + v(sum, 'gemling_skill_cost_+%_final') / 100), eff = 1 + v(sum, 'base_mana_cost_efficiency_+%') / 100;
    out.cost = perSec ? Math.max(0, raw * inc1 * more1 / eff) : Math.max(0, Math.round(step(step(Math.floor(raw), inc1), more1) / eff));
    out.costPerSecond = perSec;
  } else out.cost = 0;
  if (!d.levels) out.reason = 'The skill damage data is missing (regenerate the data on Windows)';
  else if (attack && !w) out.reason = 'Equip a weapon to calculate the attack damage';
  // base damage per type
  const mult = attack ? (st._base_multiplier ?? 10000) / 10000 : 1;
  const base = {};
  for (const t of DMG) {
    let lo = 0, hi = 0;
    if (attack && w) {
      const r = t === 'physical' ? w.physical : w[t];
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
  const all = [0, 1].map(i => DMG.reduce((s, t) => s + base[t][i], 0));
  for (const t of DMG) {
    const extra = mod(mods, 'BASE', ['DamageGainAs' + cap(t)], hit) / 100;
    base[t] = mods.some(m => m[0] === 'DealNo' + cap(t)) ? [0, 0] : [base[t][0] + all[0] * extra, (base[t][1] + all[1] * extra) * mod(mods, 'MORE', [`Max${cap(t)}Damage`], hit)];
  }
  // a totem's grenade: "increased Grenade Damage" does not count (the game's window, 16/11: the same 4311-9885 without
  // two Grenade Damage nodes; Volatile Grenades' fuse is not in it either), the grenade cooldown ones do (10.99 s)
  const dmgTags = byTotem ? [...tags.filter(x => x !== 'grenade'), 'totem'] : tags;
  // supports whose damage the game's window shows otherwise than their stats (and Path of Building 2) say: measured
  const measured = (g.supports || []).reduce((x, n) => x * (MEASURED_MORE[n] || 1), 1);
  const scale = (t, dot = false) => (1 + v(st, 'active_skill_damage_+%_final') / 100) * more(fin, 'damage_+%', tags, t) * mod(mods, 'MORE', dmgMods(t), has(dot)) * metaDmg * measured * (1 + rage * (100 + rageEffect) / 1e4)
    * (1 + (inc(sum, 'damage_+%', dmgTags) + perTotem + v(sum, `${t}_damage_+%`) + (t !== 'physical' && t !== 'chaos' ? v(sum, 'elemental_damage_+%') : 0) + mod(mods, 'INC', dmgMods(t), has(dot))) / 100);
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
  if (attack && w) out.speed = w.attacks_per_second * (1 + (inc(sum, 'attack_speed_+%', spTags) + v(sum, 'attack_and_cast_speed_+%', 'skill_speed_+%') + speedInc + perTotemSpeed) / 100) * (1 + v(st, 'active_skill_attack_speed_+%_final') / 100) * more(fin, 'attack_speed_+%', tags) * speedMods * metaSpeed;
  else if (d.cast_time_ms) out.speed = 1000 / d.cast_time_ms * (1 + (inc(sum, 'cast_speed_+%', tags) + v(sum, 'attack_and_cast_speed_+%', 'skill_speed_+%') + speedInc) / 100) * more(fin, 'cast_speed_+%', tags) * speedMods;
  // cooldown: the gem's own (quality), the tree's and gear's for its tags (grenade_skill_cooldown_speed_+%) and the
  // supports' recovery rate (Payload -70%); uses: the gem's plus "+N Cooldown Uses" (grenade_skill_cooldown_count_+).
  // The game's window: Cluster Grenade 10 s at -9% (16 + 45 - 70) = 10.99 s, 2 uses
  if (st._cooldown_ms) {
    out.cooldown = st._cooldown_ms / (1 + (v(st, 'base_cooldown_speed_+%') + inc(sum, 'cooldown_speed_+%', tags) + mod(mods, 'INC', ['CooldownRecovery'], hit)) / 100);
    out.uses = (st._stored_uses || 1) + inc(sum, 'cooldown_count_+', tags);
    out.useTime = out.speed && 1 / out.speed;   // the game's "Attack time", apart from the cooldown
    if (out.speed) out.speed = Math.min(out.speed, 1000 / out.cooldown);
  }
  // crit: base chance from weapon / skill row, increased by tree and gear; +100% damage bonus is the game's base
  const baseCrit = attack && w ? w.crit : first(st._spell_crit != null ? st._spell_crit / 100 : null, st.base_critical_strike_chance != null ? st.base_critical_strike_chance / 100 : null);
  if (baseCrit != null) {
    out.crit = mods.some(m => m[0] === 'NeverCrit') ? 0 : Math.min(100, baseCrit * (1 + (inc(sum, 'critical_strike_chance_+%', tags) + mod(mods, 'INC', ['CritChance'], hit)) / 100) * mod(mods, 'MORE', ['CritChance'], hit));
    out.critBonus = (100 + inc(sum, 'critical_strike_multiplier_+', tags) + mod(mods, 'INC', ['CritMultiplier'], hit) + mod(mods, 'BASE', ['CritMultiplier'], hit)) * mod(mods, 'MORE', ['CritMultiplier'], hit);
  }
  // the rules of the skill's other parts (its second hit, the explosion...) and the on / off rules of the gem and its
  // supports (never_freeze, always_ignite, base_consume_enemy_shock_on_hit: available.py)
  const flags = new Set([...(d.flags || []), ...(g.supports || []).flatMap(n => SK.skills[n]?.flags || [])]);
  const part = { ...(d.part || {}), ...(d.part_levels?.[st._level] || {}) };
  // (a 0 the main part carries for a stat of the other part does not hide it: Falling Thunder's damage per power charge)
  out.ail = ailments({ ...part, ...Object.fromEntries(Object.entries(st).filter(([k, x]) => x || !(k in part))) }, sum, finals, own, flags);
  out.curse = gt.includes('AppliesCurse') ? curseOf(st, sum) : null;
  out.mark = gt.includes('Mark') ? markOf(st) : null;
  // what the 3D scene draws from the gem itself, with what supports and the tree add: chains, projectiles, the time a
  // grenade or bomb takes to go off, a curse's delay and length, a totem's life. note: no duration modifiers yet
  const sec = k => st[k] ? st[k] / 1000 : null;
  out.shape = { chains: v(st, 'number_of_chains') + v(sum, 'number_of_chains'),
    projectiles: st.base_number_of_projectiles ? st.base_number_of_projectiles + v(sum, 'number_of_additional_projectiles') + v(st, 'number_of_additional_projectiles') : null,
    detonate: sec('base_skill_detonation_time'), curseDelay: sec('curse_delay_duration_ms'), duration: sec('base_skill_effect_duration'), totem: sec('base_totem_duration') };
  // a minion gem: the hits are its minion's (the DPS one minion's)
  const mn = out.minion = SK.minions[g.name] ? minionOf(g, st, sum, fin) : null;
  if (mn) {
    const ty = Object.values(mn.hits);
    Object.assign(out, { hits: mn.hits, speed: mn.speed, crit: mn.crit, critBonus: mn.critBonus, reason: null, avg: ty.length ? ty.reduce((t, [lo, hi]) => t + (lo + hi) / 2, 0) : null });
  }
  if (flags.has('global_cannot_crit')) out.crit = 0;
  if (out.avg != null && out.speed) {
    const c = (out.crit || 0) / 100;
    out.dps = out.avg * (1 + c * (out.critBonus || 0) / 100) * out.speed;
  } else if (!out.reason && out.avg == null && !Object.keys(out.dot).length) out.reason = 'This skill does not deal direct damage';
  return out;
}

// What the hits of a skill do with ailments, from the gem's own stats, its supports' and the tree's and gear's (sum): base
// chances (bleeding and poison need one: the game's glossary), "increased" (inc) and "more" (more) chance, buildup, effect
// and duration. The 3D scene rolls them against each enemy's thresholds (scene.js). Conditional ones (vs marked, wet,
// electrocuted enemies...) are left out.
function ailments(st, sum, finals, tags, flags = new Set()) {
  const all = k => (st[k] || 0) + (sum[k] || 0) + (finals[k] || 0), F = k => flags.has(k);
  const keys = [...new Set([...Object.keys(st), ...Object.keys(sum), ...Object.keys(finals)])];
  // more damage when consuming a state (Glacial Cascade, Biting Frost), against one (Siege Cascade vs immobilised), per
  // charge spent (Spiral Volley): [state, %, unique-only / non-unique-only / any]
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
  const melee = tags.includes('melee'), proj = tags.includes('projectile');
  return {
    bleed: all('base_chance_to_inflict_bleeding_%'), poison: all('base_chance_to_poison_on_hit_%'),
    igniteChance: scale(['ignite_chance_+%'], /(ignite_chance|chance_to_ignite)_\+%_final$/), shockChance: scale(['shock_chance_+%'], /(shock_chance|chance_to_shock)_\+%_final$/),
    freeze: scale(['hit_damage_freeze_multiplier_+%'], 'hit_damage_freeze_multiplier_+%_final'),
    // the character's own 50% more from physical and melee hits (character.ot) is added by the scene
    stun: scale(['hit_damage_stun_multiplier_+%', ...(melee ? ['melee_hit_damage_stun_multiplier_+%'] : []), ...(proj ? ['projectile_hit_damage_stun_multiplier_+%'] : [])], 'hit_damage_stun_multiplier_+%_final'),
    shockEffect: scale(['shock_effect_+%'], 'shock_effect_+%_final'), chillEffect: scale(['chill_effect_+%'], 'chill_effect_+%_final'),
    igniteEffect: scale(['base_ignite_effect_+%'], 'ignite_effect_+%_final'), poisonEffect: scale(['base_poison_effect_+%'], 'poison_effect_+%_final'),
    bleedEffect: scale(['base_bleeding_effect_+%'], 'bleeding_effect_+%_final'),
    shockTime: scale(['shock_duration_+%', 'ignite_shock_chill_duration_+%'], 'shock_duration_+%_final'),
    chillTime: scale(['chill_duration_+%', 'ignite_shock_chill_duration_+%'], 'chill_duration_+%_final'),
    freezeTime: scale(['freeze_duration_+%'], 'freeze_duration_+%_final'),
    igniteTime: scale(['ignite_duration_+%', 'ignite_shock_chill_duration_+%'], 'damaging_ailment_duration_+%_final'),
    bleedTime: scale(['base_bleed_duration_+%'], 'damaging_ailment_duration_+%_final'), poisonTime: scale(['base_poison_duration_+%'], 'damaging_ailment_duration_+%_final'),
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
    // Electrocute and Pin build up only from skills that say so
    electrocute: F('base_lightning_damage_can_electrocute') || keys.some(k => /electrocutes_as_though_dealt_damage/.test(k)) ? scale(['hit_damage_electrocute_multiplier_+%'], /electrocutes_as_though_dealt_damage_\+%_final$/) : 0,
    pin: F('base_all_damage_can_pin') || keys.some(k => /pins_as_though_dealt_damage/.test(k)) ? more(/pins_as_though_dealt_damage_\+%_final$/) : 0,
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
function minionOf(g, st, sum, fin) {
  const m = enemy(SK.minions[g.name][0]), level = SK.minion_level?.[st._level - 1];
  const key = m && attacksOf(m)[0].key;   // none of its skills deals damage (Skeletal Cleric heals): no hits of its own
  if (!level || !key || key === 'basic') return null;
  const a = attackOf(m, level, key, 'normal', true), ms = { ...SK.minion_intrinsic };
  for (const src of [sum, st]) for (const [k, x] of Object.entries(src)) { const to = SK.minion_stats?.[k]; if (to && typeof x === 'number') ms[to] = (ms[to] || 0) + x; }
  const tags = ['minion', a.attack ? 'attack' : 'spell', ...(a.shape === 'melee' || a.shape === 'slam' ? ['melee'] : []), ...(a.shape === 'projectile' ? ['projectile'] : []), ...(a.area ? ['area'] : [])];
  // added damage, then physical converted and gained as other types, as for the character
  const added = (t, i) => v(ms, `global_${i ? 'maximum' : 'minimum'}_added_${t}_damage`) + (a.attack ? v(ms, `attack_${i ? 'maximum' : 'minimum'}_added_${t}_damage`) : 0);
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
  return { name: m.name, level, hits, speed: Math.min(speed / a.period, a.cooldown ? 1 / a.cooldown : Infinity),
    crit: Math.min(100, a.crit * (1 + inc(ms, 'critical_strike_chance_+%', tags) / 100)),
    critBonus: a.critBonus + v(ms, 'base_critical_hit_damage_bonus') + inc(ms, 'critical_strike_multiplier_+', tags) };
}
// self-check: a gem level 20 Raise Zombie raises a level 40 zombie: 204 x 0.75 ± 30% = 107-198 physical every 1.25 s, crit
// bonus 30 + 70; Raging Spirits' 40% more attack speed and 70% of physical as fire (the gem's), and 20% more damage from the tree
if (SK.minions['Raise Zombie']) {
  const z = skill({ name: 'Raise Zombie', level: 20, supports: [] }, { gems: [], items: {} }, {}), r = skill({ name: 'Raging Spirits', level: 20, supports: [] }, { gems: [], items: {} }, { 'minion_damage_+%': 20 });
  console.assert(z.minion?.level === 40 && z.hits.physical?.join() === '107,198' && Math.abs(z.speed - .8) < 1e-9 && z.critBonus === 100
    && r.hits.fire?.join() === '96,144' && r.hits.physical?.join() === '41,62' && Math.abs(r.speed - 1.4) < 1e-9, 'minion damage', z, r);
}

function markOf(st) {
  const k = re => Object.keys(st).find(x => re.test(x)), as = k(/_mark_damage_buff_damage_%_to_gain_as_\w+$/);
  return { crit: st.enemy_additional_critical_strike_multiplier_against_self || 0,
    freeze: st[k(/mark_hit_damage_freeze_multiplier_\+%/)] || 0, electrocute: st[k(/mark_hit_damage_electrocute_multiplier_\+%/)] || 0,
    gain: as && st[as] ? { el: as.match(/_as_(\w+)$/)[1], pct: st[as], time: (st.base_secondary_skill_effect_duration || 0) / 1000 } : null };
}
// A curse on an enemy: what its gem's level gives (lower resistances and armour, less damage dealt, slower actions), times
// "increased Curse effect" of the tree, gear and supports; the scene lowers it on rarer monsters (enemies.js curseEffect)
function curseOf(st, sum) {
  const res = Object.fromEntries(['fire', 'cold', 'lightning', 'chaos'].map(e => [e, (st[`base_skill_buff_${e}_damage_resistance_%_to_apply`] || 0) + (e !== 'chaos' ? st['base_skill_buff_all_elements_resistance_%_to_apply'] || 0 : 0)]));
  return { res, armour: st['base_skill_buff_total_armour_-_to_grant'] || 0, damage: st['base_skill_buff_damage_+%_final_to_apply'] || 0,
    speed: st['base_skill_debuff_action_speed_+%_final_to_inflict'] || 0, maxLevel: st.skill_curses_cannot_apply_to_targets_above_level || null,
    effect: 1 + (v(sum, 'curse_effect_+%') + (st['curse_effect_+%'] || 0)) / 100 };
}
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
// self-check: mana cost. Orb of Storms 20 costs 129; Shock Conduction II's x1.2 makes it 154 (154.8 down), 10% reduced
// 139 (138.6 up), 25% cost efficiency 111; Runic Tempering costs per second, not rounded
{ const b = { gems: [], items: {} }, orb = sum => skill({ name: 'Orb of Storms', level: 20, supports: ['Shock Conduction II'] }, b, sum).cost;
  console.assert(skill({ name: 'Orb of Storms', level: 20 }, b, {}).cost === 129 && orb({}) === 154 && orb({ 'base_mana_cost_-%': 10 }) === 139 && orb({ 'base_mana_cost_-%': 10, 'base_mana_cost_efficiency_+%': 25 }) === 111
    && skill({ name: 'Runic Tempering', level: 20 }, b, {}).costPerSecond === true, 'mana cost'); }

export function snapshot(b, sum) {
  const c = character(b, sum), r = recovery(c, sum), R = c.res;
  return { life: c.life, es: c.es, mana: c.mana, spirit: c.spirit, armour: c.armour, evasion: c.evasion, block: c.block,
    fire: R.fire.capped, cold: R.cold.capped, lightning: R.lightning.capped, chaos: R.chaos.capped, ...c.attrs,
    lifeRegen: r.lifeRegen, esRecharge: r.esRecharge, move: c.move, accuracy: c.accuracy,
    dps: (b.gems || []).map(g => [tn(GEM[g.name]) || g.name, skill(g, b, sum).dps]) };
}
