// Enemies of the training scene: the game's monsters, their stats at a level, the attacks they can use against the
// character, and the game's defence formulas in both directions.
// Data: poe2_data/available/monsters.json (poe2_data/_tool/available.py, from the game's own tables).
// The formulas are the game's, as Path of Building 2 implements them. What the data does not have (the area radius of
// most skills, animation timing, reach of ranged skills) is decided by scene.js and shown there as simulated.
import { t, tn } from './i18n.js';

const MON = await fetch('poe2_data/available/monsters.json').then(r => r.json()).catch(() => null) || { tables: {}, constants: {}, monsters: [], skills: {} };
export const K = MON.constants || {};
export const TYPES = ['physical', 'fire', 'cold', 'lightning', 'chaos'];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const row = (tab, level) => MON.tables[tab]?.[clamp(Math.round(level) || 1, 1, 100) - 1] ?? 0;

// what a normal monster of a level hits with (DefaultMonsterStats row, no monster multiplier): the yardstick for defences
export const typical = level => ({ damage: Math.floor(row('damage', level)), accuracy: Math.round(row('accuracy', level)) });

// ---------- list and search
const shared = {}, plain = id => id.replace(/_+$/, '').replace(/([a-z])([A-Z0-9])/g, '$1 $2');   // a game id as words
// the name in the page's language (name_<code> from the game's tables); the English one still finds the monster
for (const m of MON.monsters) { m.en = m.name; m.name = tn(m); shared[m.name] = (shared[m.name] || 0) + 1; }
for (const m of MON.monsters) {
  // several monsters share a name (three "Vaal Guard"): the tail of the game id tells them apart
  if (shared[m.name] > 1) m.variant = plain(m.id.split('/').pop());
  m.key = [m.name, m.en, m.variant, m.category, m.category && t(m.category), m.boss ? 'boss ' + t('Boss') : '', ...(m.areas || [])].join(' ').toLowerCase();
}
export const ENEMIES = [...MON.monsters].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
const BY_ID = new Map(ENEMIES.map(m => [m.id, m]));
export const enemy = id => BY_ID.get(id) || null;
// every word of the query has to appear in the name, category or areas; names that start with the query come first
export function search(q, limit = 80) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean), first = words.join(' ');
  const rank = m => { const n = m.name.toLowerCase(); return !first ? 0 : n.startsWith(first) ? 0 : n.split(/[\s,'-]+/).some(w => w.startsWith(words[0])) ? 1 : words.every(w => n.includes(w)) ? 2 : 3; };
  const hits = ENEMIES.filter(m => words.every(w => m.key.includes(w)));
  return { total: hits.length, list: hits.map(m => [rank(m), m]).sort((a, b) => a[0] - b[0]).slice(0, limit).map(x => x[1]) };
}

// ---------- stats of a monster at a level (DefaultMonsterStats row × the monster's own multipliers)
// Its rarity (normal | magic | rare | unique; a boss is unique) adds "more" life, energy shield and damage
// (Mods MonsterMagic<n>, MonsterRare<n>, MonsterUnique<n>).
export const RARITIES = ['normal', 'magic', 'rare', 'unique'];
export const rarityOf = (m, r) => RARITIES.includes(r) ? r : m.boss ? 'unique' : 'normal';
// A player's minion (ally) is that monster with the allies' damage per level (DefaultMonsterStats MinionDamage)
export function enemyStats(m, level, rarity, ally = false) {
  const R = MON.rarity?.[rarityOf(m, rarity)] || {}, more = k => 1 + (R[k] || 0) / 100;
  const pool = Math.floor(row('life', level) * m.life), part = pool * (m.es || 0);   // part of the life pool is energy shield
  let dmg = Math.floor(row(ally ? 'ally_damage' : 'damage', level)) * m.damage * more('damage');
  if (!m.ignores_attack_speed) dmg *= m.attack_time;
  const cap = K.monster_max_resistance ?? 75, rar = rarityOf(m, rarity);
  return {
    level, life: Math.round((pool - part) * more('life')), es: Math.round(part * more('es')),
    armour: Math.round(row('armour', level) * (m.armour || 0)), evasion: Math.round(row('evasion', level) * (m.evasion || 0)),
    accuracy: Math.round(row('accuracy', level)),
    res: Object.fromEntries(TYPES.slice(1).map((el, i) => [el, Math.min(cap, m.res?.[i] || 0)])),
    phys: [Math.floor(dmg * (1 - m.spread)), Math.floor(dmg * (1 + m.spread))],
    attackTime: m.attack_time, crit: m.crit, more: more('damage'),
    // what its hits have to reach to inflict ailments and to fill its stun and freeze bars (DefaultMonsterStats), and how much
    // less its rarity lets slows, curses and exposure work on it
    ail: Math.floor(row('ailment', level)), poise: Math.floor(row('poise', level) * more('poise')),
    // how much less you leech from hitting it (DefaultMonsterStats LeechResistance, permyriad; its own column for rares and uniques)
    leechRes: row(['rare', 'unique'].includes(rar) ? 'leech_rare' : 'leech', level) / 1e4,
    slowEffect: more('slow'), curseEffect: more('curse'), expoEffect: more('exposure'), rarity: rar,
  };
}

// ---------- attacks
// A skill is offered when it deals damage the data describes: hit or damage-over-time values, or an attack (which uses
// the monster's own physical damage). Curses, buffs, summons and the skills exported without values are left out.
const usable = s => { const x = s?.sets?.[0]; return !!x && !x.no_damage && !!(x.hit || x.dot || x.flags.includes('attack')); };
export function attacksOf(m) {
  const seen = {}, list = [];
  for (const id of m.skills || []) {
    const s = MON.skills[id]; if (!usable(s)) continue;
    const name = s.name || s.sets[0].label || plain(id); seen[name] = (seen[name] || 0) + 1;
    list.push({ key: id, name: seen[name] > 1 ? `${name} (${seen[name]})` : name });
  }
  // monsters whose skills were not exported still hit with their basic attack
  if (!list.length) list.push({ key: 'basic', name: t('Basic attack') });
  return list;
}

// Values of one attack of a monster at a level: damage per type before your defences, use interval, crit, and how it
// reaches you (shape: melee | slam | projectile | area | bolt).
export function attackOf(m, level, key, rarity, ally = false) {
  const st = enemyStats(m, level, rarity, ally), sk = MON.skills[key] && usable(MON.skills[key]) ? MON.skills[key] : null;
  const set = sk?.sets[0] || { flags: ['attack', 'melee'], eff: [1, 0, 0] }, flags = set.flags, attack = flags.includes('attack');
  const L = clamp(Math.round(level) || 1, 1, 100);
  // "effectiveness" values grow with the monster's level; literal values (interpolation 1) are used as they are
  const eff = (K.skill_effectiveness ?? 0) * (set.eff[0] ?? 1) * (1 + set.eff[1] * (L - 1)) * (1 + set.eff[2]) ** (L - 1);
  const val = (x, interp) => (interp === 3 ? x * eff : x) * st.more;   // the rarity's more damage on every value
  const hits = {}, dot = {};
  if (set.hit) for (const [el, [lo, hi, i]] of Object.entries(set.hit)) hits[el] = [val(lo, i), val(hi, i)];
  else if (attack) hits.physical = st.phys.map(x => x * (sk?.mult ?? 1));
  if (hits.physical && set.convert) {   // part of the physical damage dealt as another type
    const [lo, hi] = hits.physical; let left = 1;
    for (const [el, p] of Object.entries(set.convert)) { const k = Math.min(left, p / 100); left -= k; hits[el] = [(hits[el]?.[0] || 0) + lo * k, (hits[el]?.[1] || 0) + hi * k]; }
    hits.physical = [lo * left, hi * left];
  }
  // monsters deal more elemental and chaos damage with their level (DefaultMonsterStats MoreElementalDamage / MoreChaosDamage;
  // note: read as the stats non_player_minion_{elemental,chaos}_damage_+%_final_from_monster_level by their names: not a player's minion)
  // and the skill's own more / less damage (Delirium demons' 20% less, VaalHumanoidShockRifle's 50% more projectile damage)
  const C = set.const || {}, skillMore = (1 + (C['active_skill_damage_+%_final'] || 0) / 100) * (flags.includes('projectile') ? 1 + (C['active_skill_projectile_damage_+%_final'] || 0) / 100 : 1);
  const lv = el => (el === 'physical' || ally ? 1 : 1 + row(el === 'chaos' ? 'more_chaos' : 'more_elemental', L) / 100) * skillMore;
  for (const el of Object.keys(hits)) { hits[el] = hits[el].map(x => Math.round(x * lv(el))); if (!hits[el][1]) delete hits[el]; }
  for (const [el, [x, i]] of Object.entries(set.dot || {})) { const d = val(x, i) / 60 * lv(el); if (d > 0) dot[el] = d; }   // the data is per minute
  const projectile = flags.includes('projectile') || !sk && !!m.ranged || String(key || '').startsWith('MeleeAtAnimationSpeed') && !!m.ranged;
  const area = !!set.area || flags.includes('area');
  const hasHit = Object.keys(hits).length > 0;
  // seconds between uses: the skill's own time when it has one, else the monster's attack time (with the skill's attack
  // speed multiplier) or the cast time; never faster than the cooldown
  const own = sk && sk.cast !== 1 ? sk.cast : null;
  // (and with the monster's own attack speed mods: Raging Spirit's 40% more)
  const A = m.attack_speed || {}, period = attack ? own ?? m.attack_time / (1 + (sk?.speed || 0) / 100) / (1 + (A['attack_speed_+%'] || 0) / 100) / (1 + (A['active_skill_attack_speed_+%_final'] || 0) / 100) : sk?.cast || 1;
  const uses = sk?.uses || 1;
  return {
    key: sk ? key : 'basic', name: sk ? sk.name || set.label || plain(key) : t('Basic attack'), description: sk?.description || '',
    attack, melee: flags.includes('melee'), hits, dot, hasHit,
    dotDur: set.const?.base_skill_effect_duration ? set.const.base_skill_effect_duration / 1000 : null,
    // stored uses (Balbala's Teleport Strike: 2) are spent one after another, each recharging over the cooldown
    period, interval: Math.max(period, (sk?.cooldown || 0) / uses), cooldown: sk?.cooldown || 0, uses,
    crit: sk?.crit ?? m.crit ?? 0, critBonus: K.monster_crit_bonus ?? 30,
    shape: projectile ? 'projectile' : !hasHit ? 'area' : attack ? (area ? 'slam' : 'melee') : area ? 'area' : 'bolt',
    area, unblockable: !!set.unblockable, ail: set.const || {},   // the skill's ailment chances and freeze multipliers
    // metres and metres per second, where the game's tables say them (else the scene uses its own)
    radius: radiusOf(set.const || {}), count: set.const?.number_of_projectiles_override || 1, projSpeed: (sk?.proj_speed || 0) / 10 || null,
    reach: (m.range || 10) / 10,   // metres, for melee attacks
  };
}

// the radius of a monster skill's area, in metres: its base radius (and flat radius) in game units, scaled by the square root
// of its increased and more area, and by its more radius, in whole game units as the player's (geo() in app.js)
const radiusOf = C => {
  const base = C.active_skill_base_area_of_effect_radius ? C.active_skill_base_area_of_effect_radius + (C['active_skill_base_radius_+'] || 0) : 0;   // a flat radius alone adds to no radius the tables give
  const area = (1 + (C['base_skill_area_of_effect_+%'] || 0) / 100) * (1 + (C['active_skill_area_of_effect_+%_final'] || 0) / 100);
  return Math.floor(base * Math.sqrt(Math.max(0, area)) * (1 + (C['active_skill_area_of_effect_radius_+%_final'] || 0) / 100)) / 10 || null;
};
// ---------- the game's defence formulas
const avg = r => (r[0] + r[1]) / 2;
// chance (%) that a monster with this accuracy hits a character with this evasion
export const hitChanceExact = (accuracy, evasion) => !evasion ? 100 : clamp((1 - .95 * evasion / (evasion + 4 * accuracy)) * 100, 100 - (K.player_max_evade ?? 95), 100);
export const hitChance = (accuracy, evasion) => Math.round(hitChanceExact(accuracy, evasion));   // as the game shows it
// chance (%) that the character's attack hits a monster (spells always hit)
export const playerHitChance = (accuracy, evasion) => !evasion ? 100 : !accuracy ? 5 : clamp(Math.round(accuracy * 1.25 / (accuracy + evasion * .3) * 100), 5, 100);
// fraction of a physical hit that armour removes
export const armourCut = (armour, raw, cap) => armour > 0 && raw > 0 ? Math.min(cap / 100, armour / (armour + raw * 10)) : 0;
// deflection rating of the character c (calc.js character(), its armour and evasion as they are now)
export const deflection = c => (c.armour * c.deflect.arm + (c.evasion || 0) * c.deflect.eva) / 100 * c.deflect.inc;
// one damage type of a hit against the character c (calc.js character()); returns what gets through
export function playerTakes(c, type, raw, isHit = true) {
  // c.physDR: additional physical damage reduction (Jade), within the same cap
  const cap = K.player_max_physical_reduction ?? 90;
  if (type === 'physical') return isHit ? raw * (1 - Math.min(cap / 100, armourCut(c.armour, raw, cap) + (c.physDR || 0) / 100)) : raw;
  // the share of armour that applies to the type (c.armourEl) cuts its hits like physical ones, then resistances
  // note: armour taken against the hit's damage before resistances
  const AR = isHit && c.armourEl?.[type] ? armourCut(c.armour * c.armourEl[type] / 100, raw, cap) : 0;
  return raw * (1 - AR) * (1 - (c.res?.[type]?.capped || 0) / 100);
}
// one damage type of the character's hit against a monster with stats st
// pen: the hit's penetration of that resistance, which lowers only a positive resistance and not below 0 (PoB2)
export function enemyTakes(st, type, raw, isHit = true, pen = 0) {
  if (type === 'physical') return isHit ? raw * (1 - armourCut(st.armour, raw, K.monster_max_physical_reduction ?? 75)) : raw;
  const res = st.res[type] || 0;
  return raw * (1 - (isHit && pen && res > 0 ? Math.max(res - pen, 0) : res) / 100);
}
// block applies to strikes and projectiles, not to area damage or to skills the data marks as unblockable
export const blockChance = (c, atk) => atk.unblockable || atk.area || !['melee', 'projectile'].includes(atk.shape) ? 0 : clamp(c.block || 0, 0, K.player_max_block ?? 50);

// Expected result of an attack (attackOf) of a monster (enemyStats) against the character c: what the panel lists.
// Ailments the monster could inflict, and your recovery while fighting, are not part of it.
export function versusPlayer(atk, st, c) {
  const types = TYPES.filter(el => atk.hits[el]).map(el => {
    const [lo, hi] = atk.hits[el];
    return { type: el, raw: [lo, hi], taken: [playerTakes(c, el, lo), playerTakes(c, el, hi)].map(Math.round) };
  });
  const raw = types.reduce((s, x) => s + avg(x.raw), 0), taken = types.reduce((s, x) => s + avg(x.taken), 0);
  const hit = atk.hasHit ? hitChance(st.accuracy, c.evasion) : 0, block = atk.hasHit ? blockChance(c, atk) : 0;
  const crit = clamp(atk.crit, 0, 100) / 100, critMult = 1 + atk.critBonus / 100;
  const perUse = taken * (1 + crit * (critMult - 1)) * hit / 100 * (1 - block / 100);
  const dots = TYPES.filter(el => atk.dot[el]).map(el => ({ type: el, raw: atk.dot[el], taken: playerTakes(c, el, atk.dot[el], false) }));
  const dotTaken = dots.reduce((s, x) => s + x.taken, 0);
  const dps = perUse / atk.interval + dotTaken;
  // chaos damage removes twice as much energy shield
  const all = taken + dotTaken, chaos = ((types.find(x => x.type === 'chaos') ? avg(types.find(x => x.type === 'chaos').taken) : 0) + (dots.find(x => x.type === 'chaos')?.taken || 0)) / (all || 1);
  const pool = c.life == null ? null : c.life + (c.es || 0) / (1 + chaos);
  return { types, dots, raw, taken, mitigated: raw ? (1 - taken / raw) * 100 : 0, hit, block, crit: crit * 100, critTaken: taken * critMult, maxTaken: types.reduce((s, x) => s + x.taken[1], 0) * critMult,
    dotTaken, dps, pool, ttd: pool != null && dps > 0 ? pool / dps : null };
}

// Expected result of one of the character's skills (calc.js skill()) against a monster: average hit after its armour
// and resistances, chance to hit (attacks roll accuracy against its evasion), damage per second and time to kill.
export function versusEnemy(dmg, st, accuracy) {
  const types = TYPES.filter(el => dmg.hits[el]).map(el => {
    const [lo, hi] = dmg.hits[el];
    return { type: el, raw: [lo, hi], taken: [enemyTakes(st, el, lo, true, dmg.pen?.[el]), enemyTakes(st, el, hi, true, dmg.pen?.[el])].map(Math.round) };
  });
  if (!types.length && !Object.keys(dmg.dot).length) return null;
  const raw = types.reduce((s, x) => s + avg(x.raw), 0), taken = types.reduce((s, x) => s + avg(x.taken), 0);
  const hit = dmg.attack ? playerHitChance(accuracy, st.evasion) : 100;
  const crit = (dmg.crit || 0) / 100, critMult = 1 + (dmg.critBonus || 0) / 100;
  const perUse = taken * (1 + crit * (critMult - 1)) * hit / 100;
  const dotTaken = TYPES.reduce((s, el) => s + (dmg.dot[el] ? enemyTakes(st, el, dmg.dot[el], false) : 0), 0);
  const dps = dmg.speed ? perUse * dmg.speed + dotTaken : dotTaken || null;
  const pool = st.life + st.es;
  return { types, raw, taken, mitigated: raw ? (1 - taken / raw) * 100 : 0, hit, perUse, dotTaken, dps, hitsToKill: perUse > 0 ? Math.ceil(pool / perUse) : null, ttk: dps > 0 ? pool / dps : null };
}
