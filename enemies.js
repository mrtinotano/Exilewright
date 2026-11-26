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
export const PLACED = ENEMIES.filter(m => m.areas?.length);   // those the game places in a zone (search)
export const enemy = id => BY_ID.get(id) || null;
// Bind Spectre: the monsters whose corpse it can bind (not Unique, with a corpse to bind, not disabled: monsters.json
// no_spectre) and the monster its Spectre is (SpectreOverrides: its own Spectre variety, else itself)
export const BINDABLE = PLACED.filter(m => !m.boss && !m.no_spectre);
export const spectreOf = id => { const m = enemy(id); return m && (enemy(m.spectre_of) || m); };
// its Spirit: the gem's base times its experience multiplier to the 0.75. note: Path of Building 2's formula (the game's
// tables do not say it); it fits 0.3.0's change, high costs lower and low ones higher than the half of the experience before
export const spectreSpirit = (id, base) => { const m = spectreOf(id); return m ? Math.floor((m.xp ?? 1) ** .75 * base) : base; };
export const monSkill = key => MON.skills?.[key] || null;   // a monster skill as the data has it (its cast time, cooldown)
// every word of the query has to appear in the name, category or areas; names that start with the query come first.
// Only monsters the game places somewhere (a zone's packs or bosses): the tables also keep NPCs, test dummies and
// monsters of leagues no longer in the game, which enemy() still finds for a player's minions
export function search(q, limit = 80) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean), first = words.join(' ');
  const rank = m => { const n = m.name.toLowerCase(); return !first ? 0 : n.startsWith(first) ? 0 : n.split(/[\s,'-]+/).some(w => w.startsWith(words[0])) ? 1 : words.every(w => n.includes(w)) ? 2 : 3; };
  const hits = PLACED.filter(m => words.every(w => m.key.includes(w)));
  return { total: hits.length, list: hits.map(m => [rank(m), m]).sort((a, b) => a[0] - b[0]).slice(0, limit).map(x => x[1]) };
}

// ---------- stats of a monster at a level (DefaultMonsterStats row × the monster's own multipliers)
// Its rarity (normal | magic | rare | unique; a boss is unique) adds "more" life, energy shield and damage
// (Mods MonsterMagic<n>, MonsterRare<n>, MonsterUnique<n>).
export const RARITIES = ['normal', 'magic', 'rare', 'unique'];
export const rarityOf = (m, r) => RARITIES.includes(r) ? r : m.boss ? 'unique' : 'normal';
// the modifiers a magic or rare monster can have (monsters.json mods), and the stats of some of them added up
export const MON_MODS = MON.mods || [];
const MOD_BY = new Map(MON_MODS.map(x => [x.id, x]));
export const addStats = list => list.reduce((s, x) => { for (const k in x) s[k] = (s[k] || 0) + x[k]; return s; }, {});   // stat objects added up
// its own stats (an aura on its enemies is not: foeAuras, its radius in metres and the stats it gives you)
export const modStats = ids => addStats((ids || []).map(id => MOD_BY.get(id)).filter(x => x && !x.aura?.foe).map(x => x.stats));
const foeAuras = ids => (ids || []).map(id => MOD_BY.get(id)).filter(x => x?.aura?.foe).map(x => ({ r: x.aura.r / 10, stats: x.stats }));
// ---------- the map: a waystone's modifiers (monsters.json map: every kind that rolls on a waystone, its rolls at the tag
// of each tier it rolls on, and each tier's name, area level and tag). A map is { tier, mods: { id: [the values of its stats] } }.
// The area gives its monsters' stats to every monster in it (map_monsters_<stat>: the monster's own <stat>, read where a
// monster modifier's are), and its players' to the character (mapPlayer). Its ground is mapGround's
export const MAP = MON.map || { tiers: [], mods: [] };
const MAP_BY = new Map(MAP.mods.map(x => [x.id, x]));
export const mapStats = map => addStats(Object.entries(map?.mods || {}).map(([id, vals]) => Object.fromEntries((MAP_BY.get(id)?.stats || []).map((s, k) => [s, +vals?.[k] || 0]))));
// the names the simulator reads a monster's stat by, where it is not the map's own
// note: "Elemental Ailment Application" is read by its id (elemental_ailment_chance) as the chance to ignite and to shock;
// the tables do not say whether freeze buildup follows it
const MAP_AS = { ...Object.fromEntries(TYPES.slice(1).map(el => [`%_all_damage_to_gain_as_${el}`, [`non_skill_base_all_damage_%_to_gain_as_${el}`]])),
  'attack_cast_and_movement_speed_+%': ['attack_and_cast_speed_+%', 'base_movement_velocity_+%'], additional_elemental_resistance: ['base_resist_all_elements_%'],
  'chance_to_poison_on_hit_%': ['base_chance_to_poison_on_hit_%'], 'chance_to_inflict_bleeding_%': ['local_chance_to_bleed_on_hit_%'], 'elemental_ailment_chance_+%': ['ignite_chance_+%', 'shock_chance_+%'],
  // Armoured, Evasive and the life gained as energy shield: the stats a rare monster's own 'of Endurance', 'of the Blur' and 'of Buffering' have
  'additional_strength_ratio_%_for_armour': ['monster_additional_strength_ratio_%_for_armour'], 'additional_dexterity_ratio_%_for_evasion': ['monster_additional_dexterity_ratio_%_for_evasion'],
  'maximum_life_%_to_add_to_maximum_energy_shield': ['base_maximum_life_%_to_gain_as_total_energy_shield'] };
// the ground a map has patches of, by the stat that words it: its kind as the scene names its own, the stat's value v
// (Ignited Ground: the fire damage it deals per 10 seconds; Chilled Ground: its magnitude) and its radius in metres
const GROUND_OF = { map_base_ground_fire_damage_to_deal_per_10_seconds: 'burning', map_ground_ice_base_magnitude: 'chilled', map_ground_lightning: 'shocked' };
let AREA = {}, GROUNDS = [];   // the stats every monster has from the map that is on, and its kinds of ground
export const mapGround = () => GROUNDS;
export function setMap(map) {
  AREA = {};
  GROUNDS = Object.entries(map?.mods || {}).flatMap(([id, vals]) => { const m = MAP_BY.get(id), type = GROUND_OF[m?.stats[0]]; return type ? [{ type, v: +vals?.[0] || 0, r: m.radius / 10 }] : []; });
  for (const [k, v] of Object.entries(mapStats(map))) { const m = k.match(/^map_monsters?_(.+)$/); if (m) for (const id of MAP_AS[m[1]] || [m[1]]) AREA[id] = (AREA[id] || 0) + v; }
}
// the players' part, as the character's own stats (calc.js): its maximum resistances and flask charges gained; its less
// recovery rate of life and energy shield and less cooldown recovery keep the map's names
export const mapPlayer = map => { const s = mapStats(map); return { 'additional_maximum_all_resistances_%': s['map_additional_player_maximum_resistances_%'] || 0, 'flask_charges_gained_+%': s['map_player_charges_gained_+%'] || 0,
  'map_player_life_and_es_recovery_speed_+%_final': s['map_player_life_and_es_recovery_speed_+%_final'] || 0, 'map_player_cooldown_speed_+%_final': s['map_player_cooldown_speed_+%_final'] || 0 }; };
// A player's minion (ally) is that monster with the allies' damage per level (DefaultMonsterStats MinionDamage)
export function enemyStats(m, level, rarity, ally = false, mods = []) {
  const rar = rarityOf(m, rarity), R = MON.rarity?.[rar] || {}, more = k => 1 + (R[k] || 0) / 100;
  // only magic and rare monsters have modifiers of their own (rare, below); the map's are on every monster that is not yours
  const has = ['magic', 'rare'].includes(rar), own = has ? modStats(mods) : {}, X = ally ? own : addStats([own, AREA]), x = k => X[k] || 0;
  const pool = Math.floor(row('life', level) * m.life), part = pool * (m.es || 0);   // part of the life pool is energy shield
  let dmg = Math.floor(row(ally ? 'ally_damage' : 'damage', level)) * m.damage * more('damage');
  if (!m.ignores_attack_speed) dmg *= m.attack_time;
  const cap = K.monster_max_resistance ?? 75, life = Math.round((pool - part) * more('life') * (1 + x('life_+%') / 100));   // a map's more Monster Life
  return {
    level, life, es: Math.round(part * more('es') + life * x('base_maximum_life_%_to_gain_as_total_energy_shield') / 100),
    // note: a modifier's "additional strength / dexterity ratio % for armour / evasion" is read by its name: added to the monster's own ratio (MonsterTypes Armour, Evasion)
    armour: Math.round(row('armour', level) * ((m.armour || 0) + x('monster_additional_strength_ratio_%_for_armour') / 100)),
    evasion: Math.round(row('evasion', level) * ((m.evasion || 0) + x('monster_additional_dexterity_ratio_%_for_evasion') / 100)),
    accuracy: Math.round(row('accuracy', level) * (1 + x('accuracy_rating_+%') / 100)),
    res: Object.fromEntries(TYPES.slice(1).map((el, i) => [el, Math.min(cap + x(`base_maximum_${el}_damage_resistance_%`),
      (m.res?.[i] || 0) + x(`base_${el}_damage_resistance_%`) + (el === 'chaos' ? 0 : x('base_resist_all_elements_%')))])),
    phys: [Math.floor(dmg * (1 - m.spread)), Math.floor(dmg * (1 + m.spread))],
    attackTime: m.attack_time, crit: m.crit * (1 + x('critical_strike_chance_+%') / 100), more: more('damage'),
    // what its hits have to reach to inflict ailments and to fill its stun and freeze bars (DefaultMonsterStats), and how much
    // less its rarity lets slows, curses and exposure work on it
    // (poise: its stun bar; ailPoise: its freeze, electrocute and pin bars, which follow its ailment threshold)
    ail: Math.floor(row('ailment', level) * (1 + x('ailment_threshold_+%') / 100)), poise: Math.floor(row('poise', level) * more('poise') * (1 + x('stun_threshold_+%') / 100)),
    ailPoise: Math.floor(row('poise', level) * more('poise') * (1 + x('ailment_threshold_+%') / 100)),
    // how much less you leech from hitting it (DefaultMonsterStats LeechResistance, permyriad; its own column for rares and uniques)
    leechRes: 1 - (1 - row(['rare', 'unique'].includes(rar) ? 'leech_rare' : 'leech', level) / 1e4) * (1 - x('life_leeched_from_-permyriad') / 1e4),
    slowEffect: more('slow') * (1 + x('monster_slow_potency_+%_final') / 100), curseEffect: x('hexproof') ? 0 : more('curse') * (1 + x('curse_effect_on_self_+%_final') / 100), expoEffect: more('exposure'), rarity: rar,
    // its modifiers': movement and action speed, life regenerated per minute, and all their stats (Headhunter's)
    move: (1 + x('base_movement_velocity_+%') / 100) * (1 - x('action_speed_-%') / 100), regen: x('life_regeneration_rate_per_minute_%'), mods: X, rare: own, foe: has ? foeAuras(mods) : [],
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
export function attackOf(m, level, key, rarity, ally = false, mods = [], si = 0) {   // si: which of the skill's stat sets (its parts)
  const st = enemyStats(m, level, rarity, ally, mods), x = k => st.mods[k] || 0, sk = MON.skills[key] && usable(MON.skills[key]) ? MON.skills[key] : null;
  const set = sk?.sets[si] || { flags: ['attack', 'melee'], eff: [1, 0, 0] }, flags = set.flags, attack = flags.includes('attack');
  const L = clamp(Math.round(level) || 1, 1, 100);
  // "effectiveness" values grow with the monster's level; literal values (interpolation 1) are used as they are
  const eff = (K.skill_effectiveness ?? 0) * (set.eff[0] ?? 1) * (1 + set.eff[1] * (L - 1)) * (1 + set.eff[2]) ** (L - 1);
  const val = (x, interp) => (interp === 3 ? x * eff : x) * st.more;   // the rarity's more damage on every value
  const hits = {}, dot = {}, incd = x('damage_+%') / 100;   // a map's increased Monster Damage, added to its own increases
  if (set.hit) for (const [el, [lo, hi, i]] of Object.entries(set.hit)) hits[el] = [val(lo, i), val(hi, i)].map(v => el === 'physical' ? v : v * (1 + incd));
  else if (attack) hits.physical = st.phys.map(x => x * (sk?.mult ?? 1));
  if (hits.physical) hits.physical = hits.physical.map(v => v * (1 + x('physical_damage_+%') / 100 + incd));
  if (hits.physical && set.convert) {   // part of the physical damage dealt as another type
    const [lo, hi] = hits.physical; let left = 1;
    for (const [el, p] of Object.entries(set.convert)) { const k = Math.min(left, p / 100); left -= k; hits[el] = [(hits[el]?.[0] || 0) + lo * k, (hits[el]?.[1] || 0) + hi * k]; }
    hits.physical = [lo * left, hi * left];
  }
  // its modifiers' damage gained as extra fire, cold, lightning or chaos (of all its hit's damage)
  const all = [0, 1].map(j => Object.values(hits).reduce((t, r) => t + r[j], 0));
  for (const el of TYPES.slice(1)) { const g = x(`non_skill_base_all_damage_%_to_gain_as_${el}`) / 100; if (g && all[1]) hits[el] = [0, 1].map(j => (hits[el]?.[j] || 0) + all[j] * g); }
  // monsters deal more elemental and chaos damage with their level (DefaultMonsterStats MoreElementalDamage / MoreChaosDamage;
  // note: read as the stats non_player_minion_{elemental,chaos}_damage_+%_final_from_monster_level by their names: not a player's minion)
  // and the skill's own more / less damage (Delirium demons' 20% less, VaalHumanoidShockRifle's 50% more projectile damage)
  const C = set.const || {}, skillMore = (1 + (C['active_skill_damage_+%_final'] || 0) / 100) * (flags.includes('projectile') ? 1 + (C['active_skill_projectile_damage_+%_final'] || 0) / 100 : 1);
  const lv = el => (el === 'physical' || ally ? 1 : 1 + row(el === 'chaos' ? 'more_chaos' : 'more_elemental', L) / 100) * skillMore;
  for (const el of Object.keys(hits)) { hits[el] = hits[el].map(x => Math.round(x * lv(el))); if (!hits[el][1]) delete hits[el]; }
  for (const [el, [x, i]] of Object.entries(set.dot || {})) { const d = val(x, i) / 60 * lv(el) * (1 + incd); if (d > 0) dot[el] = d; }   // the data is per minute
  const projectile = flags.includes('projectile') || !sk && !!m.ranged || String(key || '').startsWith('MeleeAtAnimationSpeed') && !!m.ranged;
  const area = !!set.area || flags.includes('area');
  const hasHit = Object.keys(hits).length > 0;
  // seconds between uses: the skill's own time when it has one, else the monster's attack time (with the skill's attack
  // speed multiplier) or the cast time; never faster than the cooldown
  const own = sk && sk.cast !== 1 ? sk.cast : null;
  // (and with the monster's own attack speed mods: Raging Spirit's 40% more)
  const A = m.attack_speed || {}, period = (attack ? own ?? m.attack_time / (1 + (sk?.speed || 0) / 100) / (1 + (A['attack_speed_+%'] || 0) / 100) / (1 + (A['active_skill_attack_speed_+%_final'] || 0) / 100) : sk?.cast || 1)
    / (1 + x('attack_and_cast_speed_+%') / 100) / (1 - x('action_speed_-%') / 100);   // and its modifiers' speed
  const uses = sk?.uses || 1;
  return {
    key: sk ? key : 'basic', name: sk ? sk.name || set.label || plain(key) : t('Basic attack'), description: sk?.description || '',
    attack, melee: flags.includes('melee'), hits, dot, hasHit,
    dotDur: set.const?.base_skill_effect_duration ? set.const.base_skill_effect_duration / 1000 : null,
    // stored uses (Balbala's Teleport Strike: 2) are spent one after another, each recharging over the cooldown
    period, interval: Math.max(period, (sk?.cooldown || 0) / uses), cooldown: sk?.cooldown || 0, uses,
    crit: (sk?.crit ?? m.crit ?? 0) * (1 + x('critical_strike_chance_+%') / 100), critBonus: (K.monster_crit_bonus ?? 30) + x('critical_strike_multiplier_+'), pen: x('penetrate_elemental_resistances_%'),   // a map's
    shape: projectile ? 'projectile' : !hasHit ? 'area' : attack ? (area ? 'slam' : 'melee') : area ? 'area' : 'bolt',
    // the skill's ailment chances and freeze multipliers, with its modifiers' (Poison / Bleeding on Hit: always)
    area, unblockable: !!set.unblockable, ail: addStats([set.const || {}, st.mods, { 'local_chance_to_bleed_on_hit_%': x('global_bleed_on_hit') * 100, 'base_chance_to_poison_on_hit_%': x('global_poison_on_hit') * 100 }]),
    // metres and metres per second, where the game's tables say them (else the scene uses its own)
    radius: radiusOf(set.const || {}) * Math.sqrt(1 + x('rare_monster_mod_area_of_effect_+%_final') / 100) || null,
    count: (set.const?.number_of_projectiles_override || 1) + (projectile ? x('number_of_additional_projectiles') : 0), projSpeed: (sk?.proj_speed || 0) / 10 || null,
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
// max: the most chance to evade (Tactician's 50%), the game's otherwise
export const hitChanceExact = (accuracy, evasion, max) => !evasion ? 100 : clamp((1 - .95 * evasion / (evasion + 4 * accuracy)) * 100, 100 - (max ?? K.player_max_evade ?? 95), 100);
export const hitChance = (accuracy, evasion, max) => Math.round(hitChanceExact(accuracy, evasion, max));   // as the game shows it
// chance (%) that the character's attack hits a monster (spells always hit)
export const hitRaw = (accuracy, evasion) => accuracy * 1.25 / (accuracy + evasion * .3) * 100;   // uncapped
export const playerHitChance = (accuracy, evasion) => !evasion ? 100 : !accuracy ? 5 : clamp(Math.round(hitRaw(accuracy, evasion)), 5, 100);
// fraction of a physical hit that armour removes
export const armourCut = (armour, raw, cap) => armour > 0 && raw > 0 ? Math.min(cap / 100, armour / (armour + raw * 10)) : 0;
// deflection rating of the character c (calc.js character(), its armour and evasion as they are now)
export const deflection = c => ((c.armour * c.deflect.arm + (c.evasion || 0) * c.deflect.eva) / 100 + (c.deflect.flat || 0)) * c.deflect.inc;   // flat: Forgotten Warden's
// one damage type of a hit against the character c (calc.js character()); returns what gets through
// c.takenAs: shares of a type's damage taken as another ("Physical damage from Hits taken as Fire"), each part
// mitigated as its new type. note: armour then counts against each part, not the whole hit
// pen: the hit's penetration of your elemental resistances (a map's), as yours works on a monster (enemyTakes)
// the armour a physical hit meets: yours (Tactician's at 200%), evasion as armour, armour from your energy shield
export const armourNow = c => (c.armour || 0) * (c.armourX || 1) + (c.evaPhys ? c.evasion || 0 : 0) + (c.esNow ?? c.es ?? 0) * (c.esArm || 0) / 100;
export function playerTakes(c, type, raw, isHit = true, conv = true, pen = 0) {
  const to = conv && c.takenAs?.[isHit ? 'hit' : 'dot']?.[type];
  if (to) { let left = raw, t = 0; for (const [e, p] of Object.entries(to)) { const x = raw * Math.min(p, 100) / 100; left -= x; t += playerTakes(c, e, x, isHit, false, pen); } return t + (left > 0 ? playerTakes(c, type, left, isHit, false, pen) : 0); }
  // c.physDR: additional physical damage reduction (Jade), within the same cap
  const cap = K.player_max_physical_reduction ?? 90;
  const A = (c.armour || 0) * (c.armourX || 1), pcap = Math.min(cap, c.physMax ?? cap);   // Tactician: armour at 200%, its cap
  if (type === 'physical') return isHit ? raw * (1 - Math.min(pcap / 100, armourCut(armourNow(c), raw, pcap) + (c.physDR || 0) / 100)) : raw;
  // the share of armour that applies to the type (c.armourEl) cuts its hits like physical ones, then resistances
  // note: armour taken against the hit's damage before resistances
  const ER = A * (c.armourEl?.[type] || 0) / 100 + (type !== 'chaos' ? (c.evasion || 0) * (c.evaEl || 0) / 100 + (c.esNow ?? c.es ?? 0) * (c.esEl || 0) / 100 : 0);   // and evasion's share against elements (Pathfinder), current energy shield's (Silks of Veneration)
  const AR = isHit && ER ? armourCut(ER, raw, pcap) : 0;
  const res = c.resOff === type ? 0 : c.res?.[type]?.capped || 0;
  return raw * (1 - AR) * (1 - (isHit && pen && type !== 'chaos' && res > 0 ? Math.max(res - pen, 0) : res) / 100);
}
// one damage type of the character's hit against a monster with stats st
// pen: the hit's penetration of that resistance, which lowers only a positive resistance and not below 0 (PoB2)
export function enemyTakes(st, type, raw, isHit = true, pen = 0, floor = 0) {   // floor: how low penetration can take a resistance
  // armour broken below 0 (KeywordPopups ArmourOverbreak): more physical damage taken, as much as that armour would
  // have reduced it (Path of Building 2's armourReductionF)
  if (type === 'physical') return isHit ? raw * (st.armour < 0 ? 1 + armourCut(-st.armour, raw, 100) : 1 - armourCut(st.armour, raw, K.monster_max_physical_reduction ?? 75)) : raw;
  const res = st.res[type] || 0;
  return raw * (1 - (isHit && pen && res > floor ? Math.max(res - pen, floor) : res) / 100);
}
// block applies to strikes and projectiles, not to area damage or to skills the data marks as unblockable
export const blockChance = (c, atk) => atk.unblockable || atk.area || !['melee', 'projectile'].includes(atk.shape) ? 0 : clamp((c.block || 0) * (atk.shape === 'projectile' ? 1 + (c.projBlock || 0) / 100 : 1), 0, c.blockMax ?? K.player_max_block ?? 50);

// Expected result of an attack (attackOf) of a monster (enemyStats) against the character c: what the panel lists.
// Ailments the monster could inflict, and your recovery while fighting, are not part of it.
export function versusPlayer(atk, st, c) {
  const types = TYPES.filter(el => atk.hits[el]).map(el => {
    const [lo, hi] = atk.hits[el];
    return { type: el, raw: [lo, hi], taken: [playerTakes(c, el, lo, true, true, atk.pen), playerTakes(c, el, hi, true, true, atk.pen)].map(x => Math.round(x * (1 - (c.avoidDmg?.[el] || 0) / 100))) };   // Perfidy: its chance to avoid the type
  });
  const raw = types.reduce((s, x) => s + avg(x.raw), 0), taken = types.reduce((s, x) => s + avg(x.taken), 0);
  const hit = atk.hasHit ? hitChance(st.accuracy, c.evasion, c.evadeMax) : 0, block = atk.hasHit ? blockChance(c, atk) : 0;
  const crit = clamp(atk.crit, 0, 100) / 100, critMult = 1 + atk.critBonus * (c.selfCrit ?? 1) / 100;   // less with the character's (calc.js selfCrit)
  const perUse = taken * (1 + crit * (critMult - 1)) * hit / 100 * (1 - block / 100 * (1 - (c.blockTaken || 0) / 100));   // a blocked hit deals its share you still take
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
  const crit = (dmg.crit || 0) / 100, critMult = 1 + (dmg.critBonus || 0) * (1 - (st.mods['base_self_critical_strike_multiplier_-%'] || 0) / 100) / 100;   // less with a modifier's or a map's
  const perUse = taken * (1 + crit * (critMult - 1)) * hit / 100;
  const dotTaken = TYPES.reduce((s, el) => s + (dmg.dot[el] ? enemyTakes(st, el, dmg.dot[el], false) : 0), 0);
  const dps = dmg.speed ? perUse * dmg.speed + dotTaken : dotTaken || null;
  const pool = st.life + st.es;
  return { types, raw, taken, mitigated: raw ? (1 - taken / raw) * 100 : 0, hit, perUse, dotTaken, dps, hitsToKill: perUse > 0 ? Math.ceil(pool / perUse) : null, ttk: dps > 0 ? pool / dps : null };
}
// self-check: a map's stats reach every monster that is not yours, by the names a monster's own are read by
{
  const m = ENEMIES[0], map = { tier: 1, mods: { MapMonsterLifeIncrease: [20], MapMonsterDamageAsFire: [10], MapMonstersElementalPenetration: [8], MapPlayerMaximumResists: [-4], MapSpreadChilledGround: [30], MapMonsterArmoured: [50], MapMonsterEvasive: [40], MapMonsterEnergyShield: [20] } };
  const was = enemyStats(m, 70), c = { res: { fire: { capped: 75 } } };
  setMap(map);
  const st = enemyStats(m, 70), atk = attackOf(m, 70, 'basic');
  console.assert(MAP.mods.length && Math.abs(st.life - was.life * 1.2) <= 1 && Math.abs(st.armour - was.armour - row('armour', 70) * .5) <= 1 && Math.abs(st.evasion - was.evasion - row('evasion', 70) * .4) <= 1
    && Math.abs(st.es - was.es - st.life * .2) <= 1 && enemyStats(m, 70, null, true).life === was.life && atk.hits.fire?.[1] > 0 && atk.pen === 8
    && Math.abs(playerTakes(c, 'fire', 100, true, true, atk.pen) - 33) < 1e-9 && playerTakes(c, 'fire', 100, false, true, atk.pen) === 25 && mapPlayer(map)['additional_maximum_all_resistances_%'] === -4
    && JSON.stringify(mapGround()) === '[{"type":"chilled","v":30,"r":2.6}]', 'map modifiers');
  setMap(null);
  console.assert(enemyStats(m, 70).life === was.life && !mapGround().length, 'map off');
}
console.assert(enemyTakes({ res: { fire: 30, cold: -20 } }, 'fire', 100, true, 40) === 100 && Math.abs(enemyTakes({ res: { fire: 30 } }, 'fire', 100, true, 40, -50) - 110) < 1e-9 && enemyTakes({ res: { cold: -20 } }, 'cold', 100, true, 40) === 120 && enemyTakes({ res: { cold: -20 } }, 'cold', 100, true, 40, -50) === 150, "penetration and its floor (Leopold's Applause)");
console.assert(enemyTakes({ armour: -1000, res: {} }, 'physical', 100) === 150 && enemyTakes({ armour: 1000, res: {} }, 'physical', 100) === 50, 'armour below 0 (Imploding Impacts)');
