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
export function enemyStats(m, level) {
  const total = Math.floor(row('life', level) * m.life), es = Math.round(total * (m.es || 0));   // part of the life pool is energy shield
  let dmg = Math.floor(row('damage', level)) * m.damage;
  if (!m.ignores_attack_speed) dmg *= m.attack_time;
  const cap = K.monster_max_resistance ?? 75;
  return {
    level, life: total - es, es,
    armour: Math.round(row('armour', level) * (m.armour || 0)), evasion: Math.round(row('evasion', level) * (m.evasion || 0)),
    accuracy: Math.round(row('accuracy', level)),
    res: Object.fromEntries(TYPES.slice(1).map((el, i) => [el, Math.min(cap, m.res?.[i] || 0)])),
    phys: [Math.floor(dmg * (1 - m.spread)), Math.floor(dmg * (1 + m.spread))],
    attackTime: m.attack_time, crit: m.crit,
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
export function attackOf(m, level, key) {
  const st = enemyStats(m, level), sk = MON.skills[key] && usable(MON.skills[key]) ? MON.skills[key] : null;
  const set = sk?.sets[0] || { flags: ['attack', 'melee'], eff: [1, 0, 0] }, flags = set.flags, attack = flags.includes('attack');
  const L = clamp(Math.round(level) || 1, 1, 100);
  // "effectiveness" values grow with the monster's level; literal values (interpolation 1) are used as they are
  const eff = (K.skill_effectiveness ?? 0) * (set.eff[0] ?? 1) * (1 + set.eff[1] * (L - 1)) * (1 + set.eff[2]) ** (L - 1);
  const val = (x, interp) => interp === 3 ? x * eff : x;
  const hits = {}, dot = {};
  if (set.hit) for (const [el, [lo, hi, i]] of Object.entries(set.hit)) hits[el] = [val(lo, i), val(hi, i)];
  else if (attack) hits.physical = st.phys.map(x => x * (sk?.mult ?? 1));
  if (hits.physical && set.convert) {   // part of the physical damage dealt as another type
    const [lo, hi] = hits.physical; let left = 1;
    for (const [el, p] of Object.entries(set.convert)) { const k = Math.min(left, p / 100); left -= k; hits[el] = [(hits[el]?.[0] || 0) + lo * k, (hits[el]?.[1] || 0) + hi * k]; }
    hits.physical = [lo * left, hi * left];
  }
  for (const el of Object.keys(hits)) { hits[el] = hits[el].map(Math.round); if (!hits[el][1]) delete hits[el]; }
  for (const [el, [x, i]] of Object.entries(set.dot || {})) { const d = val(x, i) / 60; if (d > 0) dot[el] = d; }   // the data is per minute
  const projectile = flags.includes('projectile') || !sk && !!m.ranged || String(key || '').startsWith('MeleeAtAnimationSpeed') && !!m.ranged;
  const area = !!set.area || flags.includes('area');
  const hasHit = Object.keys(hits).length > 0;
  // seconds between uses: the skill's own time when it has one, else the monster's attack time (with the skill's attack
  // speed multiplier) or the cast time; never faster than the cooldown
  const own = sk && sk.cast !== 1 ? sk.cast : null;
  const period = attack ? own ?? m.attack_time / (1 + (sk?.speed || 0) / 100) : sk?.cast || 1;
  return {
    key: sk ? key : 'basic', name: sk ? sk.name || set.label || plain(key) : t('Basic attack'), description: sk?.description || '',
    attack, hits, dot, hasHit,
    dotDur: set.const?.base_skill_effect_duration ? set.const.base_skill_effect_duration / 1000 : null,
    interval: Math.max(period, sk?.cooldown || 0), cooldown: sk?.cooldown || 0,
    crit: sk?.crit ?? m.crit ?? 0, critBonus: K.monster_crit_bonus ?? 30,
    shape: projectile ? 'projectile' : !hasHit ? 'area' : attack ? (area ? 'slam' : 'melee') : area ? 'area' : 'bolt',
    area, unblockable: !!set.unblockable,
    // metres and metres per second, where the game's tables say them (else the scene uses its own)
    radius: (set.const?.active_skill_base_area_of_effect_radius || 0) / 10 || null, projSpeed: (sk?.proj_speed || 0) / 10 || null,
    reach: (m.range || 10) / 10,   // metres, for melee attacks
  };
}

// ---------- the game's defence formulas
const avg = r => (r[0] + r[1]) / 2;
// chance (%) that a monster with this accuracy hits a character with this evasion
export const hitChanceExact = (accuracy, evasion) => !evasion ? 100 : clamp((1 - .95 * evasion / (evasion + 4 * accuracy)) * 100, 100 - (K.player_max_evade ?? 95), 100);
export const hitChance = (accuracy, evasion) => Math.round(hitChanceExact(accuracy, evasion));   // as the game shows it
// chance (%) that the character's attack hits a monster (spells always hit)
export const playerHitChance = (accuracy, evasion) => !evasion ? 100 : !accuracy ? 5 : clamp(Math.round(accuracy * 1.25 / (accuracy + evasion * .3) * 100), 5, 100);
// fraction of a physical hit that armour removes
export const armourCut = (armour, raw, cap) => armour > 0 && raw > 0 ? Math.min(cap / 100, armour / (armour + raw * 10)) : 0;
// one damage type of a hit against the character c (calc.js character()); returns what gets through
export function playerTakes(c, type, raw, isHit = true) {
  if (type === 'physical') return isHit ? raw * (1 - armourCut(c.armour, raw, K.player_max_physical_reduction ?? 90)) : raw;
  return raw * (1 - (c.res?.[type]?.capped || 0) / 100);
}
// one damage type of the character's hit against a monster with stats st
export function enemyTakes(st, type, raw, isHit = true) {
  if (type === 'physical') return isHit ? raw * (1 - armourCut(st.armour, raw, K.monster_max_physical_reduction ?? 75)) : raw;
  return raw * (1 - (st.res[type] || 0) / 100);
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
    return { type: el, raw: [lo, hi], taken: [enemyTakes(st, el, lo), enemyTakes(st, el, hi)].map(Math.round) };
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
