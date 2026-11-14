// Character sheet and skill damage, from the summed tree + gear stats (app.js treeSum) and the game data.
// Numbers that only the game install can give (class base life/mana, skill damage per level) come from
// skills.json / ascendancies.json once the data is regenerated on Windows (see the to-do notes);
// until then those values are null and the UI shows "—".
import { t, fmt } from './i18n.js';
import { weaponStats } from './items.js';

const load = f => fetch('poe2_data/available/' + f).then(r => r.json());
const [SK, ASCS, GEMS] = await Promise.all([load('skills.json'), load('ascendancies.json'), load('gems.json')]);
const GEM = Object.fromEntries(GEMS.map(g => [g.name, g]));
const CHAR = SK.character_stats || {};
const v = (sum, ...ids) => ids.reduce((t, id) => t + (sum[id] || 0), 0);
const first = (...xs) => xs.find(x => x != null) ?? null;
// monster of a given level (DefaultMonsterStats): the character panel rates armour / evasion against it
const MON = SK.monster_stats || [];
const monster = (lvl, ...cols) => { const r = MON.find(m => m.level === lvl) || MON[Math.min(lvl, MON.length) - 1]; return r && first(...cols.map(c => r[c])); };

// attribute total: class base + flat stats from tree/gear, then % increased
export function attributes(sum, ascName) {
  const base = ASCS.find(a => a.name === ascName)?.attrs || { str: 0, dex: 0, int: 0 }, out = {};
  const ids = { str: 'strength', dex: 'dexterity', int: 'intelligence' };
  const pair = { str: ['strength_and_dexterity', 'strength_and_intelligence'], dex: ['strength_and_dexterity', 'dexterity_and_intelligence'], int: ['strength_and_intelligence', 'dexterity_and_intelligence'] };
  for (const [k, id] of Object.entries(ids)) {
    const flat = base[k] + v(sum, 'base_' + id, 'additional_' + id, 'additional_all_attributes', ...pair[k].map(p => 'additional_' + p));
    out[k] = Math.floor(flat * (1 + v(sum, id + '_+%', 'all_attributes_+%') / 100));
  }
  return out;
}

// What one attribute point gives, read from the game's own attribute text (ClientStrings <Attr>Description), e.g.
// "+2 [Life|maximum Life] per ..." -> {life: 2}. note: text format checked only once the data is regenerated
function perAttr(attr) {
  const t = SK.attribute_text?.[attr] || '', out = {};
  for (const [k, re] of [['life', /\+(\d+) (?:to )?\[?(?:Life\|)?maximum Life/i], ['mana', /\+(\d+) (?:to )?\[?(?:Mana\|)?maximum Mana/i], ['accuracy', /\+(\d+) (?:to )?\[?Accuracy/i]]) {
    const m = t.match(re); if (m) out[k] = +m[1];
  }
  return out;
}

export function character(b, sum) {
  const A = ASCS.find(a => a.name === b.asc) || {}, cb = A.class_base || {}, lvl = b.level || 1, at = attributes(sum, b.asc);
  const fromAttr = k => ['Strength', 'Dexterity', 'Intelligence'].reduce((t, a, i) => t + (perAttr(a)[k] || 0) * at[['str', 'dex', 'int'][i]], 0);
  // class base + per level: Characters row first, else character.ot (whichever this patch has)
  const base = (row, stat, perLvlRow, perLvlStat) => {
    const b0 = first(cb[row], CHAR[stat]); if (b0 == null) return null;
    return b0 + (lvl - 1) * (first(cb[perLvlRow], CHAR[perLvlStat]) || 0);
  };
  const lifeBase = base('BaseMaxLife', 'base_maximum_life', 'LifePerLevel', 'maximum_life_per_level');
  const manaBase = base('BaseMaxMana', 'base_maximum_mana', 'ManaPerLevel', 'maximum_mana_per_level');
  const pct = (...ids) => 1 + v(sum, ...ids) / 100;
  const res = {};
  for (const [k, others] of Object.entries({ fire: ['cold', 'lightning', 'chaos'], cold: ['fire', 'lightning', 'chaos'], lightning: ['fire', 'cold', 'chaos'], chaos: ['fire', 'cold', 'lightning'] })) {
    const combos = others.flatMap(o => [`${k}_and_${o}_damage_resistance_%`, `${o}_and_${k}_damage_resistance_%`]);
    const val = v(sum, `base_${k}_damage_resistance_%`, ...combos, ...(k === 'chaos' ? [] : ['base_resist_all_elements_%']));
    // 75%: the game's default cap (character.ot when present)
    const max = first(CHAR[`base_maximum_${k}_damage_resistance_%`], 75) + v(sum, `base_maximum_${k}_damage_resistance_%`, 'additional_maximum_all_resistances_%', ...(k === 'chaos' ? [] : ['additional_maximum_all_elemental_resistances_%']));
    res[k] = { value: val, max, capped: Math.min(val, max) };
  }
  const defInc = 'global_armour_evasion_energy_shield_+%';
  const armour = Math.round(v(sum, 'base_physical_damage_reduction_rating') * pct('physical_damage_reduction_rating_+%', 'evasion_and_physical_damage_reduction_rating_+%', defInc));
  const evasion = Math.round(v(sum, 'base_evasion_rating') * pct('evasion_rating_+%', 'evasion_and_physical_damage_reduction_rating_+%', defInc));
  const mDmg = monster(lvl, 'Damage', 'PhysicalDamage', 'MonsterDamage'), mAcc = monster(lvl, 'Accuracy', 'AccuracyRating');
  // documented game formulas: armour reduces a hit by A / (A + 10·damage), max 90%;
  // chance to be hit = 1.25·accuracy / (accuracy + (evasion/5)^0.9), between 5% and 100% (so evade max 95%)
  const armourPct = mDmg ? Math.min(90, 100 * armour / (armour + 10 * mDmg)) : null;
  const evadePct = mAcc ? 100 - Math.min(100, Math.max(5, 125 * mAcc / (mAcc + (evasion / 5) ** 0.9))) : null;
  return {
    level: lvl, attrs: at,
    life: lifeBase == null ? null : Math.round((lifeBase + v(sum, 'base_maximum_life') + fromAttr('life')) * pct('maximum_life_+%', 'maximum_life_mana_and_energy_shield_+%')),
    mana: manaBase == null ? null : Math.round((manaBase + v(sum, 'base_maximum_mana') + fromAttr('mana')) * pct('maximum_mana_+%', 'maximum_life_mana_and_energy_shield_+%')),
    spirit: Math.round((first(cb.BaseSpirit, CHAR.base_spirit, 0) + v(sum, 'base_spirit')) * pct('spirit_+%')),
    // spirit reserved by the build's persistent skills (gem data, per level)
    reserved: (b.gems || []).reduce((t, g) => { const d = SK.skills[g.name]; return t + (first(d?.levels?.[g.level]?._spirit, d?.constant?._spirit) || 0); }, 0),
    es: Math.round(v(sum, 'base_maximum_energy_shield') * pct('maximum_energy_shield_+%', defInc, 'maximum_life_mana_and_energy_shield_+%')),
    armour, evasion, armourPct, evadePct,
    block: v(sum, 'additional_block_%', 'block_%'),
    res,
    move: v(sum, 'base_movement_velocity_+%'),
    attackSpeed: v(sum, 'attack_speed_+%', 'attack_and_cast_speed_+%'),
    castSpeed: v(sum, 'base_cast_speed_+%', 'attack_and_cast_speed_+%'),
    critInc: v(sum, 'critical_strike_chance_+%'),
    critBonus: 100 + v(sum, 'base_critical_strike_multiplier_+'),  // documented game rule: every character has +100% base critical damage bonus
    accuracy: Math.round((v(sum, 'accuracy_rating') + fromAttr('accuracy')) * pct('accuracy_rating_+%')),
    missingBase: lifeBase == null,
  };
}

// Detailed list under the resistances, by section like the in-game character panel.
// Each row: [label, value text, tooltip?]. Base rates come from character.ot when the regenerated data has them,
// else these documented game rules: energy shield recharges 12.5% of max per second after a 4 s delay,
// mana regenerates 4% of max per second, stun and ailment thresholds start at maximum life.
export function sheet(b, sum) {
  const c = character(b, sum), at = c.attrs, pct = (...ids) => 1 + v(sum, ...ids) / 100;
  const num = fmt;
  const NO_LIFE = t('Needs the class base life (regenerate the data on Windows)'), NO_MANA = t('Needs the class base mana (regenerate the data on Windows)');
  // life: flat regen + % of max life per minute, scaled by regeneration / recovery rate
  const lifePctRegen = v(sum, 'life_regeneration_rate_per_minute_%');
  const lifeRegen = lifePctRegen && c.life == null ? null
    : (v(sum, 'base_life_regeneration_rate_per_minute') + (c.life || 0) * lifePctRegen / 100) / 60 * pct('life_regeneration_rate_+%', 'life_recovery_rate_+%');
  // energy shield recharge
  const esRate = first(CHAR['energy_shield_recharge_rate_per_minute_%'], 750) / 100 / 60;   // 750/min = 12.5%/s
  const esDelay = first(CHAR.energy_shield_delay_ms, 4000) / 1000 / (1 + v(sum, 'energy_shield_delay_-%') / 100);
  const esRecharge = c.es * esRate * pct('energy_shield_recharge_rate_+%');
  // mana: inherent 4%/s unless a keystone removes it, plus "mana equal to X% of life"
  const manaBase = sum.no_inherent_mana_regeneration ? 0 : first(CHAR['mana_regeneration_rate_per_minute_%'], 240) / 100 / 60;   // 240/min = 4%/s
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
  const ail = c.life == null ? null : (c.life + at.dex * v(sum, 'ailment_threshold_+_per_dexterity') + c.es * v(sum, 'ailment_threshold_+_from_%_maximum_energy_shield') / 100
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
      ['Estimated Physical Damage Reduction', c.armourPct == null ? '—' : num(c.armourPct) + '%', t('Against a hit from a monster of your level')],
    ]],
    ['Evasion', [
      ['Evasion Rating', num(c.evasion)],
      ['Estimated Chance to Evade', c.evadePct == null ? '—' : num(c.evadePct) + '%', t('Against an attack from a monster of your level')],
      ...deflect ? [['Deflection Rating', num(deflect)]] : [],
      ...opt('Damage Deflected', 'base_damage_%_deflected'),
    ]],
    ['Resistances', Object.entries(RES).map(([k, label]) => [label, `${c.res[k].capped}% (${t('max. {0}%', c.res[k].max)})`, c.res[k].value !== c.res[k].capped ? t('Uncapped: {0}%', c.res[k].value) : ''])],
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
// Sum of "<prefix>_<suffix>" stats that apply to a skill with these tags (generic ones always)
function inc(sum, suffix, tags) {
  let t = 0;
  for (const [k, val] of Object.entries(sum)) {
    if (!k.endsWith(suffix)) continue;
    const pre = k.slice(0, -suffix.length).replace(/_skill_$|_$/, '');
    if (pre === '' || pre === 'base' || pre === 'global' || tags.includes(pre) && !DMG.includes(pre) && pre !== 'minion' && pre !== 'companion') t += val;
  }
  return t;
}

// Stats of the supports socketed in a skill (their first level: supports have one level per tier).
// "..._+%_final" stats are separate "more" multipliers (fin); every other stat joins the tree + gear sum for this skill only.
export function withSupports(g, sum) {
  const all = { ...sum }, fin = {};
  for (const n of g.supports || []) {
    const d = n && SK.skills[n]; if (!d) continue;
    const lv = d.levels?.[Object.keys(d.levels || {})[0]] || {};
    for (const [k, val] of Object.entries({ ...(d.constant || {}), ...lv })) {
      if (k.startsWith('_') || typeof val !== 'number') continue;
      const o = k.endsWith('_final') ? fin : all; o[k] = (o[k] || 0) + val;
    }
  }
  return { sum: all, fin };
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
  const G = GEM[g.name] || {}, d = SK.skills[g.name] || {}, tags = G.tags || [];
  const { sum, fin } = withSupports(g, treeGear);
  const st = { ...(d.constant || {}), ...(d.levels?.[g.level] || {}) };
  const attack = (G.types || []).includes('Attack'), spell = (G.types || []).includes('Spell');
  const out = { attack, spell, stats: st, castTime: d.cast_time_ms ?? null, hits: {}, avg: null, speed: null, crit: null, critBonus: null, dps: null, reason: null };
  const w = attack ? weaponStats(b.items) : null;
  if (!d.levels) out.reason = 'The skill damage data is missing (regenerate the data on Windows)';
  else if (attack && !w) out.reason = 'Equip a weapon to calculate the attack damage';
  // base damage per type
  const mult = attack ? (first(st._base_multiplier, st._damage_effectiveness) ?? 10000) / 10000 : 1;
  for (const t of DMG) {
    let lo = 0, hi = 0;
    if (attack && w) {
      const r = t === 'physical' ? w.physical : w[t];
      if (r) { lo += r[0]; hi += r[1]; }
      lo += v(sum, `attack_minimum_added_${t}_damage`); hi += v(sum, `attack_maximum_added_${t}_damage`);
    }
    lo += first(st[`spell_minimum_base_${t}_damage`], st[`attack_minimum_added_${t}_damage`], st[`minimum_base_${t}_damage`], 0);
    hi += first(st[`spell_maximum_base_${t}_damage`], st[`attack_maximum_added_${t}_damage`], st[`maximum_base_${t}_damage`], 0);
    if (!hi) continue;
    const k = mult * (1 + v(st, 'active_skill_damage_+%_final') / 100) * more(fin, 'damage_+%', tags, t) * (1 + (inc(sum, 'damage_+%', tags) + v(sum, `${t}_damage_+%`) + (t !== 'physical' && t !== 'chaos' ? v(sum, 'elemental_damage_+%') : 0)) / 100);
    out.hits[t] = [Math.round(lo * k), Math.round(hi * k)];
  }
  const types = Object.values(out.hits);
  if (types.length) out.avg = types.reduce((t, [lo, hi]) => t + (lo + hi) / 2, 0);
  // uses per second
  if (attack && w) out.speed = w.attacks_per_second * (1 + (inc(sum, 'attack_speed_+%', tags) + v(sum, 'attack_and_cast_speed_+%')) / 100) * (1 + v(st, 'active_skill_attack_speed_+%_final') / 100) * more(fin, 'attack_speed_+%', tags);
  else if (d.cast_time_ms) out.speed = 1000 / d.cast_time_ms * (1 + (inc(sum, 'cast_speed_+%', tags) + v(sum, 'attack_and_cast_speed_+%')) / 100) * more(fin, 'cast_speed_+%', tags);
  if (st._cooldown_ms && out.speed) out.speed = Math.min(out.speed, 1000 / st._cooldown_ms);
  // crit: base chance from weapon / skill row, increased by tree and gear; +100% damage bonus is the game's base
  const baseCrit = attack && w ? w.crit : first(st._spell_crit != null ? st._spell_crit / 100 : null, st.base_critical_strike_chance != null ? st.base_critical_strike_chance / 100 : null);
  if (baseCrit != null) {
    out.crit = Math.min(100, baseCrit * (1 + inc(sum, 'critical_strike_chance_+%', tags) / 100));
    out.critBonus = 100 + inc(sum, 'critical_strike_multiplier_+', tags);
  }
  if (out.avg != null && out.speed) {
    const c = (out.crit || 0) / 100;
    out.dps = out.avg * (1 + c * (out.critBonus || 0) / 100) * out.speed;
  } else if (!out.reason && out.avg == null) out.reason = 'This skill does not deal direct damage';
  return out;
}
