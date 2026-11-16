// Character sheet and skill damage, from the summed tree + gear stats (app.js treeSum) and the game data.
// The numbers are the game's own (class base life/mana, skill damage per level: skills.json / ascendancies.json,
// regenerated with poe2_data/_tool after each patch); what the data does not have is null and shown as "—".
import { t, tn, fmt, cap } from './i18n.js';
import { weaponStats, classOf, rowReader } from './items.js';
import { SK } from './skilldata.js';

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
// A meta gem (Mortar Cannon) is not counted: the game's 10 / 5 / 6 Motes of a build with Mortar Cannon and the Cluster
// Grenade it uses (both Strength and Dexterity) count one of the two. note: the meta gem left out, not the skill in it;
// a build with a meta gem and its skills of other attributes would tell which.
// note: every Mote it can hold (a hit takes one away, they come back in seconds)
const ATTRS = ['strength', 'dexterity', 'intelligence'];
export function skillStats(b) {
  const c = (b.gems || []).map(g => SK.skills[g.name]?.constant).find(c => c?.['gem_barrier_red_grants_maximum_life_+%']);
  if (!c) return {};
  const motes = Object.fromEntries(ATTRS.map(a => [a, c.skill_specific_stat_description_mode || 0]));
  for (const g of b.gems) { if (GEM[g.name]?.tags?.includes('meta')) continue; const req = ATTRS.filter(a => GEM[g.name]?.tags?.includes(a)); for (const a of req) motes[a] += req.length === 1 ? 2 : 1; }
  const per = (id, a) => (c[id] || 0) * motes[a];
  return { 'maximum_life_+%': per('gem_barrier_red_grants_maximum_life_+%', 'strength'),
    'global_armour_evasion_energy_shield_+%': per('gem_barrier_green_grants_evasion_rating_+%', 'dexterity'),
    'life_regeneration_rate_+%': per('gem_barrier_blue_grants_life_regeneration_rate_+%', 'intelligence'),
    'mana_regeneration_rate_+%': per('gem_barrier_blue_grants_mana_regeneration_rate_+%', 'intelligence') };
}

const load = f => fetch('poe2_data/available/' + f).then(r => r.json());
const [ASCS, GEMS] = await Promise.all([load('ascendancies.json'), load('gems.json')]);
const GEM = Object.fromEntries(GEMS.map(g => [g.name, g]));
// self-check: 3 Strength Motes of its own and 2 for Berserk, which requires Strength alone, at 2% life each (none for a meta gem)
console.assert(skillStats({ gems: [{ name: 'Virtuous Barrier' }, { name: 'Berserk' }, { name: 'Mortar Cannon' }] })['maximum_life_+%'] === 10 && !Object.keys(skillStats({ gems: [{ name: 'Berserk' }] })).length, 'Virtuous Barrier Motes');
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
// 317 x 4 = 1268) and a level 16 Shockwave Totem (60, the table's). The game's evasion is 1-2 lower (127 / 304 for 128 /
// 306): its rule unknown, the table's shown
export function totem(g, sum = {}) {
  const T = SK.skills[g.name]?.totem; if (!T) return null;
  const s = withSupports(g, sum).sum, st = gemStats(g, s), level = SK.minion_level?.[st._level - 1];
  if (!level) return null;
  return {
    level,
    life: Math.round(Math.floor(monster(level, 'AllyLife') * T.life_mult) * (1 + v(s, 'totem_life_+%') / 100)),
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
    && totem({ name: 'Shockwave Totem', level: 8 })?.armour === 60;
  console.assert(ok, 'Mortar Cannon totem', m); }

// attribute total: class base + flat stats from tree/gear, then % increased
export function attributes(sum, ascName) {
  const base = ASCS.find(a => a.name === ascName)?.attrs || { str: 0, dex: 0, int: 0 }, out = {};
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
  const A = ASCS.find(a => a.name === b.asc) || {}, cb = A.class_base || {}, lvl = b.level || 1, at = attributes(sum, b.asc);
  const fromAttr = k => ['Strength', 'Dexterity', 'Intelligence'].reduce((t, a, i) => t + (perAttr(a)[k] || 0) * at[['str', 'dex', 'int'][i]], 0);
  // the class's own amount (Characters row: 16 life, 30 mana) plus character.ot's amount per level, the first included
  const base = (row, perLvl) => cb[row] == null || CHAR[perLvl] == null ? null : cb[row] + lvl * CHAR[perLvl];
  const lifeBase = base('BaseMaxLife', 'life_per_level'), manaBase = base('BaseMaxMana', 'mana_per_level');
  const pct = (...ids) => 1 + v(sum, ...ids) / 100;
  const res = {};
  // the game lowers elemental resistances by the level of the area (ResistancePenaltyPerAreaLevel: none at first,
  // -60% from level 65 on). note: the area is taken to be of the character's level, like the monster the panel
  // rates armour against; an area level of its own if a character must be looked at somewhere else
  const penalty = SK.resistance_penalty?.[Math.min(lvl, SK.resistance_penalty.length) - 1] || 0;
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
    res, penalty,
    move: v(sum, 'base_movement_velocity_+%'),
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
  // life: flat regen + % of max life per minute, scaled by regeneration / recovery rate
  const lifePctRegen = v(sum, 'life_regeneration_rate_per_minute_%');
  const esRate = CHAR['energy_shield_recharge_rate_per_minute_%'] / 100 / 60;   // 750/min = 12.5%/s
  return {
    lifeRegen: lifePctRegen && c.life == null ? null
      : (v(sum, 'base_life_regeneration_rate_per_minute') + (c.life || 0) * lifePctRegen / 100) / 60 * pct('life_regeneration_rate_+%', 'life_recovery_rate_+%'),
    esRate, esDelay: CHAR.energy_shield_delay_ms / 1000 / (1 + v(sum, 'energy_shield_delay_-%') / 100),
    esRecharge: c.es * esRate * pct('energy_shield_recharge_rate_+%'),
  };
}

// Detailed list under the resistances, by section like the in-game character panel.
// Each row: [label, value text, tooltip?]. Base rates come from character.ot and GameConstants (skills.json character_stats):
// energy shield recharges 12.5% of max per second after a 4 s delay, mana regenerates 4% of max per second; the stun
// threshold starts at maximum life, the ailment threshold at half of it (PlayerAilmentThresholdLifeFactor).
export function sheet(b, sum) {
  const c = character(b, sum), at = c.attrs, pct = (...ids) => 1 + v(sum, ...ids) / 100;
  const num = fmt;
  const NO_LIFE = t('Needs the class base life (regenerate the data on Windows)'), NO_MANA = t('Needs the class base mana (regenerate the data on Windows)');
  const { lifeRegen, esRate, esDelay, esRecharge } = recovery(c, sum);
  // mana: inherent 4%/s unless a keystone removes it, plus "mana equal to X% of life"
  const manaBase = sum.no_inherent_mana_regeneration ? 0 : CHAR['character_inherent_mana_regeneration_rate_per_minute_%'] / 100 / 60;   // 240/min = 4%/s
  const manaLife = v(sum, 'regenerate_mana_equal_to_x%_of_life_per_minute');
  const manaRegen = c.mana == null || manaLife && c.life == null ? null
    : (c.mana * manaBase + (c.life || 0) * manaLife / 100 / 60) * pct('mana_regeneration_rate_+%', 'mana_recovery_rate_+%');
  // deflection (part of armour / evasion as deflection rating)
  const deflect = (c.armour * v(sum, 'base_deflection_rating_%_of_armour') + c.evasion * v(sum, 'base_deflection_rating_%_of_evasion_rating')) / 100 * pct('deflection_rating_+%');
  // thorns
  const thorns = [v(sum, 'thorns_minimum_base_physical_damage'), v(sum, 'thorns_maximum_base_physical_damage')].map(x => Math.round(x * pct('thorns_damage_+%')));
  // stun / ailment thresholds
  const stun = c.life == null ? null : (c.life + v(sum, 'stun_threshold_+') + at.str * v(sum, 'stun_threshold_+_per_strength') + at.dex * v(sum, 'stun_threshold_+_per_dexterity')
    + c.es * v(sum, 'stun_threshold_+_from_%_maximum_energy_shield') / 100) * pct('stun_threshold_+%');
  const ail = c.life == null ? null : (c.life * CHAR['ailment_threshold_life_%'] / 100 + at.dex * v(sum, 'ailment_threshold_+_per_dexterity') + c.es * v(sum, 'ailment_threshold_+_from_%_maximum_energy_shield') / 100
    + c.evasion * v(sum, 'evasion_rating_%_to_gain_as_ailment_threshold') / 100) * pct('ailment_threshold_+%');
  const opt = (label, id, unit = '%') => sum[id] ? [[label, num(sum[id], Number.isInteger(sum[id]) ? 0 : 1) + unit]] : [];
  const RES = { fire: 'Fire Resistance', cold: 'Cold Resistance', lightning: 'Lightning Resistance', chaos: 'Chaos Resistance' };
  return [
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
      ...deflect ? [['Deflection Rating', num(deflect)]] : [],
      ...opt('Damage Deflected', 'base_damage_%_deflected'),
    ]],
    ['Resistances', [...Object.entries(RES).map(([k, label]) => [label, `${c.res[k].capped}% (${t('max. {0}%', c.res[k].max)})`, c.res[k].value !== c.res[k].capped ? t('Uncapped: {0}%', c.res[k].value) : '']),
      ...c.penalty ? [['Area Penalty', c.penalty + '%', t('Elemental resistances are lower in areas of a higher level: here, an area of your level')]] : []]],
    ['Block', [
      ...c.block ? [['Block Chance', num(c.block) + '%']] : [],
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
      ...opt('Physical Damage taken Recouped as Life', 'physical_damage_taken_recouped_as_life_%'),
      ...opt('Elemental Damage taken Recouped as Life', 'elemental_damage_taken_%_recouped_as_life'),
      ...opt('Elemental Damage taken Recouped as Energy Shield', 'recoup_%_elemental_damage_as_energy_shield'),
      ...opt('Damage taken while on Low Life', 'damage_taken_+%_on_low_life'),
    ]],
    ['Damage Redirection', [
      ...opt('Damage taken from Mana before Life', 'damage_taken_goes_to_mana_%'),
      ...opt('Damage taken to Life over 4 seconds', 'damage_taken_goes_to_life_over_4_seconds_%'),
    ]],
  ];
}

const DMG = ['physical', 'fire', 'cold', 'lightning', 'chaos'];
export const DMG_NAME = { physical: '{0} physical', fire: '{0} fire', cold: '{0} cold', lightning: '{0} lightning', chaos: '{0} chaos' };
// Sum of "<prefix>_<suffix>" stats that apply to a skill with these tags (generic ones always). The prefix may be
// several words: every one has to fit (attack_area_damage_+%: attacks with an area; one_handed_melee_attack_speed_+%).
// Damage types are added per type by the caller, and what is the minions' is not the character's.
function inc(sum, suffix, tags) {
  let t = 0;
  for (const [k, val] of Object.entries(sum)) {
    if (!k.endsWith(suffix)) continue;
    const pre = k.slice(0, -suffix.length).replace(/_skill_$|_$/, '').replace(/^base_(?=.)/, '').replace(/(one|two)_handed/, '$1hand');
    if (pre === '' || pre === 'base' || pre === 'global' || pre.split('_').every(w => tags.includes(w) && !DMG.includes(w) && w !== 'minion' && w !== 'companion')) t += val;
  }
  return t;
}
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
  const all = { ...sum }, fin = {}, mods = [];
  for (const n of g.supports || []) {
    const p = n && SK.supports?.[n], d = n && SK.skills[n]; if (!p && !d) continue;
    if (p) mods.push(...(p.mods || []).filter(m => !m[4]));
    const lv = d?.levels?.[Object.keys(d?.levels || {})[0]] || {};
    for (const [k, val] of Object.entries(p ? p.stats || {} : { ...(d.constant || {}), ...lv })) {
      if (k.startsWith('_') || typeof val !== 'number') continue;
      if (!k.endsWith('_final')) all[k] = (all[k] || 0) + val;
      else if (plainMore(k, n)) fin[k] = (fin[k] || 0) + val;
    }
  }
  return { sum: all, fin, mods };
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
export function skill(g, b, treeGear) {
  const G = GEM[g.name] || {}, d = SK.skills[g.name] || {}, own = G.tags || [];
  // a meta gem's supports are for the skills it uses (Mortar Cannon's, for its Cluster Grenade): not for the gem itself,
  // as the game's details window shows (Mortar Cannon with Multishot II: 1 s, not 1.25 s)
  const { sum, fin, mods } = own.includes('meta') ? { sum: treeGear, fin: {}, mods: [] } : withSupports(g, treeGear);
  const st = gemStats(g, sum);
  const attack = (G.types || []).includes('Attack'), spell = (G.types || []).includes('Spell');
  // flags of a support mod this skill meets: "hit" for its hits, "dot" for its damage over time, else what the skill is
  const has = dot => f => f === 'hit' ? !dot : f === 'dot' ? dot : f === 'attack' ? attack : f === 'spell' || f === 'cast' ? spell : own.includes(f);
  const hit = has(false), dmgMods = t => ['Damage', cap(t) + 'Damage', ...(t === 'physical' || t === 'chaos' ? [] : ['ElementalDamage'])];
  const out = { attack, spell, stats: st, castTime: d.cast_time_ms ?? null, hits: {}, dot: {}, avg: null, speed: null, crit: null, critBonus: null, dps: null, reason: null };
  const w = attack ? weaponStats(b.items) : null;
  // the weapons the skill is used with (ActiveSkills.WeaponRequirements; a shield skill names what the off hand holds)
  if (w && d.weapons && !['weapon', 'offhand'].some(s => d.weapons.includes(classOf(b.items[s])))) return { ...out, reason: 'This skill cannot be used with the weapon in hand' };
  const tags = w ? [...own, ...weaponTags(w)] : own;   // passives for a weapon type count for attacks made with it
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
  const scale = (t, dot = false) => (1 + v(st, 'active_skill_damage_+%_final') / 100) * more(fin, 'damage_+%', tags, t) * mod(mods, 'MORE', dmgMods(t), has(dot))
    * (1 + (inc(sum, 'damage_+%', tags) + v(sum, `${t}_damage_+%`) + (t !== 'physical' && t !== 'chaos' ? v(sum, 'elemental_damage_+%') : 0) + mod(mods, 'INC', dmgMods(t), has(dot))) / 100);
  for (const t of DMG) {
    const [lo, hi] = base[t];
    if (hi) out.hits[t] = [Math.round(lo * mult * scale(t)), Math.round(hi * mult * scale(t))];
    // damage over time of the skill itself (Contagion, burning ground...), per second
    const perMin = st[`base_${t}_damage_to_deal_per_minute`];
    if (perMin) out.dot[t] = perMin / 60 * scale(t, true);
  }
  const types = Object.values(out.hits);
  if (types.length) out.avg = types.reduce((t, [lo, hi]) => t + (lo + hi) / 2, 0);
  // uses per second
  const speedMods = (1 + mod(mods, 'INC', ['Speed'], hit) / 100) * mod(mods, 'MORE', ['Speed'], hit);
  if (attack && w) out.speed = w.attacks_per_second * (1 + (inc(sum, 'attack_speed_+%', tags) + v(sum, 'attack_and_cast_speed_+%', 'skill_speed_+%')) / 100) * (1 + v(st, 'active_skill_attack_speed_+%_final') / 100) * more(fin, 'attack_speed_+%', tags) * speedMods;
  else if (d.cast_time_ms) out.speed = 1000 / d.cast_time_ms * (1 + (inc(sum, 'cast_speed_+%', tags) + v(sum, 'attack_and_cast_speed_+%', 'skill_speed_+%')) / 100) * more(fin, 'cast_speed_+%', tags) * speedMods;
  if (st._cooldown_ms && out.speed) out.speed = Math.min(out.speed, 1000 / st._cooldown_ms);
  // crit: base chance from weapon / skill row, increased by tree and gear; +100% damage bonus is the game's base
  const baseCrit = attack && w ? w.crit : first(st._spell_crit != null ? st._spell_crit / 100 : null, st.base_critical_strike_chance != null ? st.base_critical_strike_chance / 100 : null);
  if (baseCrit != null) {
    out.crit = mods.some(m => m[0] === 'NeverCrit') ? 0 : Math.min(100, baseCrit * (1 + (inc(sum, 'critical_strike_chance_+%', tags) + mod(mods, 'INC', ['CritChance'], hit)) / 100) * mod(mods, 'MORE', ['CritChance'], hit));
    out.critBonus = (100 + inc(sum, 'critical_strike_multiplier_+', tags) + mod(mods, 'INC', ['CritMultiplier'], hit) + mod(mods, 'BASE', ['CritMultiplier'], hit)) * mod(mods, 'MORE', ['CritMultiplier'], hit);
  }
  if (out.avg != null && out.speed) {
    const c = (out.crit || 0) / 100;
    out.dps = out.avg * (1 + c * (out.critBonus || 0) / 100) * out.speed;
  } else if (!out.reason && out.avg == null && !Object.keys(out.dot).length) out.reason = 'This skill does not deal direct damage';
  return out;
}

// The numbers impact.js compares before and after a change: the panel's (resistances capped, as shown) and each skill's DPS
// self-check: Multishot II in Mortar Cannon slows its grenades, not the cannon (the game: use time 1 s)
console.assert(skill({ name: 'Mortar Cannon', level: 18, supports: ['Multishot II'] }, { gems: [], items: {} }, {}).speed === 1, 'meta gem supports');

export function snapshot(b, sum) {
  const c = character(b, sum), r = recovery(c, sum), R = c.res;
  return { life: c.life, es: c.es, mana: c.mana, spirit: c.spirit, armour: c.armour, evasion: c.evasion, block: c.block,
    fire: R.fire.capped, cold: R.cold.capped, lightning: R.lightning.capped, chaos: R.chaos.capped, ...c.attrs,
    lifeRegen: r.lifeRegen, esRecharge: r.esRecharge, move: c.move, accuracy: c.accuracy,
    dps: (b.gems || []).map(g => [tn(GEM[g.name]) || g.name, skill(g, b, sum).dps]) };
}
