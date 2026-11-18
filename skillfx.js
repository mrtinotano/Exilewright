// Behaviour profile of every skill for the 3D scene, and the synergies between the skills of a build.
// Everything is derived from the game's own gem tags and ActiveSkillTypes (gems.json) plus the geometry in skills.json.
// What the data does not express lives in two clearly separated places: NAMED (a few iconic interactions) and
// SIM (simulation defaults: the data has no damage, cast time, fuse time or ailment chance, so the scene counts
// life in abstract "hits" and uses these values). The UI labels them as simulation, never as game numbers.

export const SIM = {
  castTime: 0.42,      // s between uses
  meleeRange: 2.8,     // m reach of strikes and slams
  dashRange: 7,        // m reach of strikes that move you to the target
  castRange: 14,       // m a targeted spell can be placed away from you
  travelRange: 9,      // m of a leap / dash / blink
  throwRange: 10,      // m of a grenade throw
  projSpeed: 16,       // m/s when the data has no projectile speed
  projRange: 15,       // m when the data has no range
  area: 1.6,           // m radius when the data has none
  cone: 55,            // degrees of a cone when not set by hand
  wall: 7,             // m length of a wall
  chains: 4, chainRange: 4.5,
  fuse: 1.4,           // s grenade fuse
  orbFuse: 2.6,        // s of an orb that detonates after a time
  orbBlast: 2.4,       // m base blast when the data only gives the per-level bonus radius
  lifetime: 8,         // s of objects without duration in the data
  groundTime: 8,       // s of ground effects without duration in the data
  curseDelay: 0.9, curseTime: 9,
  ignite: 4, poison: 3, bleed: 5,
  freezeHits: 3, breakHits: 3,
  dot: 0.35,           // hits per second of each damage over time effect
  consume: 2,          // extra hits when a payoff consumes its state
  maxCharges: 3,
  energy: 4,           // ailments a meta gem needs to trigger
  corpseTime: 14, respawn: 2.5,
  heraldR: 2.4,
  body: 0.35,          // m radius of a dummy
  shockTaken: 0.2, curseTaken: 0.3, brokenTaken: 0.2,   // extra damage taken (as a fraction of the hit)
  chargeMult: 0.5,     // extra damage per charge spent
  channelTick: 0.16, channelHit: 0.4,   // s between the hits of a channelled skill and how hard each one is
  stormArea: 3,        // m over which a storm / rain with a small impact radius scatters its impacts
  meteor: 1.0,         // s a delayed impact takes to land when the data gives no time
  snap: 3,             // m around the cursor where a single-target skill looks for its target
  totemArea: 3, totemTime: 12, minionTime: 14,
};

export const ELEMENTS = ['fire', 'cold', 'lightning', 'chaos', 'physical'];
// Ailment each element inflicts on hit, and the state a payoff looks for.
export const AILMENT = { fire: 'ignite', cold: 'freeze', lightning: 'shock', chaos: 'poison', physical: 'bleed' };
export const STATE = {
  ignite: 'Ignite', chill: 'Chill', freeze: 'Freeze', shock: 'Shock', poison: 'Poison', bleed: 'Bleeding',
  armour: 'Broken Armour', stun: 'Heavy Stun', curse: 'Curse', mark: 'Mark', expo: 'Exposure',
};
export const GROUND = {
  burning: 'Ignited Ground', chilled: 'Chilled Ground', shocked: 'Shocked Ground', oil: 'Oil', gas: 'Gas cloud',
  jagged: 'Jagged Ground', caustic: 'Caustic Ground', consecrated: 'Consecrated Ground',
};
export const GROUND_EL = { burning: 'fire', chilled: 'cold', shocked: 'lightning', gas: 'chaos', caustic: 'chaos' };
export const KIND = {
  projectile: 'Projectile', chain: 'Chaining bolt', rain: 'Falls on the cursor', grenade: 'Grenade', orb: 'Orb', wall: 'Wall',
  curse: 'Curse', mark: 'Mark', warcry: 'Warcry', herald: 'Herald', aura: 'Persistent buff', meta: 'Meta trigger',
  minion: 'Minions', raise: 'Minions from corpses', totem: 'Totem', travel: 'Travel', nova: 'Nova', slam: 'Slam',
  strike: 'Strike', sweep: 'Melee area', wave: 'Fissure wave', cone: 'Cone', zone: 'Lingering area', storm: 'Storm',
  dot: 'Damage over time', buff: 'Buff', area: 'Area (cursor)', meteor: 'Delayed impact', beam: 'Line',
};
export const CHARGE = { frenzy: 'Frenzy', power: 'Power', endurance: 'Endurance' };

// Iconic behaviour the tags and types do not carry.
const NAMED = {
  'Comet': { kind: 'meteor' },
  'Hammer of the Gods': { kind: 'meteor' },
  'Lightning Bolt': { kind: 'meteor', delay: 0.25 },
  'Hexblast': { consumes: ['curse'] },
  'Spark': { count: 4, wander: true },
  'Ice Nova': { from: 'Frostbolt' },
  'Contagion': { spread: true },
  'Living Bomb': { kind: 'mark', bomb: true },
  'Flicker Strike': { dash: true },
  'Cluster Grenade': { cluster: 4 },
  'Earthquake': { aftershock: true },
};

export function profile(gem, d = {}) {
  const T = new Set(gem?.types || []), G = new Set(gem?.tags || []), name = gem?.name || '';
  const has = (...a) => a.some(x => T.has(x)), tag = (...a) => a.some(x => G.has(x)), N = NAMED[name] || {};
  const els = ELEMENTS.filter(e => G.has(e));
  const el = els.find(e => e !== 'physical') || els[0] || (tag('attack') ? 'physical' : 'arcane');
  const attack = tag('attack'), spell = tag('spell'), radius = d.radius != null, dur = d.duration_ms ? d.duration_ms / 1000 : 0;
  const channel = has('Channel'), corpse = has('TargetsDestructibleCorpses');

  let kind = N.kind
    || (has('Triggers') && has('Meta') ? 'meta'
    : has('ModifiesNextSkill') ? 'buff'
    : has('SummonsTotem') ? 'totem'
    : has('CreatesMinion') && !has('Offering') ? (corpse ? 'raise' : 'minion')
    : has('Herald') ? 'herald'
    : has('Persistent') ? 'aura'
    : has('AppliesCurse') ? 'curse'
    : has('Mark') ? 'mark'
    : has('Warcry') ? 'warcry'
    : has('Wall') ? 'wall'
    : has('Orb') ? 'orb'
    : has('Grenade') ? 'grenade'
    : has('Rain', 'GroundTargetedProjectile') ? 'rain'
    : has('Travel') || has('Movement', 'Jumping') && !has('MeleeSingleTarget') ? 'travel'
    : has('Slam') ? 'slam'
    : has('Chains') && !d.projectile_speed ? 'chain'
    : has('Projectile') || tag('projectile') || d.projectile ? 'projectile'
    : has('Nova') ? 'nova'
    : has('MeleeSingleTarget') ? 'strike'
    : has('Storm') ? 'storm'
    : has('Hazard', 'Plant') ? 'zone'
    : has('CreatesFissure') ? 'wave'
    : tag('melee') || attack && channel ? 'sweep'
    : has('DamageOverTime') && spell && !has('CreatesGroundEffect') ? 'dot'
    : channel && radius ? 'cone'
    : radius && (tag('sustained') || has('CreatesGroundEffect', 'CreatesGroundRune')) && dur ? 'zone'
    : !radius && (tag('buff') || has('EmpowersOtherSkill', 'ModifiesNextSkill', 'Instant', 'Guard', 'CommandsMinions', 'Offering')) ? 'buff'
    : 'area');

  const ground = has('CreatesGroundEffect', 'CausesBurning')
    ? (/Oil/.test(name) ? 'oil' : G.has('chaos') && G.has('fire') ? 'gas' : G.has('fire') ? 'burning' : G.has('cold') ? 'chilled'
      : G.has('lightning') ? 'shocked' : G.has('chaos') ? 'caustic' : attack || G.has('physical') ? 'jagged' : 'consecrated')
    : null;

  const consumes = [...(N.consumes || [])];
  has('SkillConsumesFreeze') && consumes.push('freeze');
  has('SkillConsumesShock') && consumes.push('shock');
  has('SkillConsumesIgnite') && consumes.push('ignite');
  has('SkillConsumesBleeding') && consumes.push('bleed');
  has('ConsumesFullyBrokenArmour') && consumes.push('armour');
  // A payoff with no explicit consumption benefits from the ailment of its element.
  const bonus = tag('payoff') && !consumes.length && AILMENT[el] && kind !== 'herald' ? [AILMENT[el]] : [];

  const spend = ['Frenzy', 'Power', 'Endurance'].filter(c => has(`SkillConsumes${c}ChargesOnUse`)).map(c => c.toLowerCase());
  const a = gem?.attr || {};
  const gain = has('GeneratesCharges') ? ((a.int || 0) >= (a.dex || 0) && (a.int || 0) >= (a.str || 0) ? 'power' : (a.dex || 0) >= (a.str || 0) ? 'frenzy' : 'endurance') : null;

  // Which ailments the hits of this skill inflict. Bleeding, poison and Armour Break need a stat of the skill that gives them
  // (the game's glossary: damage alone never bleeds or poisons); the tree and gear can add them too (calc.js ailments()).
  const stat = k => Object.values(d.levels || {}).some(l => l[k]) || !!d.constant?.[k];
  const breaks = stat('apply_X_armour_break_on_hit') || stat('armour_break_physical_damage_%_dealt_as_armour_break');
  const applies = [];
  if (!['curse', 'mark', 'aura', 'herald', 'meta', 'buff'].includes(kind) || N.bomb) {
    G.has('fire') && applies.push('ignite');
    G.has('cold') && applies.push('chill', 'freeze');
    G.has('lightning') && applies.push('shock');
    stat('base_chance_to_poison_on_hit_%') && applies.push('poison');
    stat('base_chance_to_inflict_bleeding_%') && applies.push('bleed');
    breaks && applies.push('armour');
  }

  return {
    name, kind, el, els, attack, spell, dur, applies, consumes, bonus, ground, spend, gain, corpse, channel,
    toggle: ['herald', 'aura', 'meta', 'minion'].includes(kind),
    stages: has('GainsStages', 'PerfectTiming'), perfect: has('PerfectTiming'),
    plant: has('Plant'), wind: has('Wind'), fan: has('Slam') && has('Projectile'), ballista: has('TotemsAreBallistae'),
    // a buff that makes the next skill repeat: Barrage (bow / crossbow attacks) or Unleash (spells)
    repeats: has('ModifiesNextSkill') && !els.length ? (tag('dexterity') ? 'barrageable' : tag('intelligence') ? 'unleashable' : null) : null,
    detonator: has('Detonator') || tag('detonator'),
    detonates: has('DetonatesAfterTime'),
    chains: has('Chains') || tag('chaining'),
    explodes: radius && ['projectile', 'rain', 'grenade'].includes(kind),
    fissure: has('CreatesFissure'),
    absorbs: has('InteractsWithElementalGround'),
    crystal: has('IceCrystal'),
    object: has('ObjectDurability'),
    rainy: has('Rain'),
    spiral: has('ProjectileSpiral'),
    dotHit: has('DamageOverTime') && !has('CreatesGroundEffect'),
    empowers: has('EmpowersOtherSkill', 'ModifiesNextSkill'),
    needsCharges: has('RequiresCharges'),
    barrageable: has('Barrageable'), unleashable: has('Unleashable'), triggerable: has('Triggerable') && !has('Persistent'),
    presence: has('AffectsPresence', 'Aura'),
    melee: tag('melee'), nova: has('Nova') || tag('nova'),
    jump: has('Jumping'), blink: has('Travel', 'Movement') && spell, dash: N.dash || has('Movement') && has('MeleeSingleTarget'),
    ranged: /Sniper|Arsonist|Mage|Archer|Cleric|Brute/.test(name) ? !/Brute/.test(name) : tag('projectile'),
    radiusBonus: d.radius ? d.radius['1'] === 0 : false,
    ...N,
  };
}

// Chips shown on each skill card: [text, css class, argument]; text and argument are translated by the caller.
export function chips(P) {
  const c = [[KIND[P.kind] || P.kind, 'k']];
  P.els.forEach(e => c.push([e[0].toUpperCase() + e.slice(1), e]));
  P.channel && c.push([P.stages ? 'Channelled: charge and release' : 'Channelled', '']);
  P.chains && P.kind !== 'chain' && c.push(['Chains', '']);
  P.explodes && c.push(['Explodes on impact', '']);
  P.applies.forEach(s => c.push(['Inflicts {0}', 'a', STATE[s]]));
  P.ground && c.push([GROUND[P.ground], 'g']);
  P.fissure && c.push(['Fissures', 'g']);
  P.consumes.forEach(s => c.push(['Consumes {0}', 'p', STATE[s]]));
  P.bonus.forEach(s => c.push(['Payoff: {0}', 'p', STATE[s]]));
  P.detonator && c.push(['Detonator', 'p']);
  P.absorbs && c.push(['Absorbs elemental ground', 'p']);
  P.corpse && c.push(['Needs a corpse', 'w']);
  P.spend.forEach(s => c.push(['Spends {0} charges', 'c', CHARGE[s]]));
  P.gain && c.push(['Generates {0} charges', 'c', CHARGE[P.gain]]);
  P.empowers && c.push(['Empowers other skills', 'c']);
  return c;
}

// Synergies between the skills of a build: [{ a, b, text, args }] with a/b = gem indexes (b may be null).
// `list` = [{ label, P }] in build order.
export function synergies(list) {
  const out = [], seen = new Set();
  const add = (a, b, text, ...args) => { const k = a + '|' + b + '|' + text; if (!seen.has(k)) { seen.add(k); out.push({ a, b, text, args }); } };
  const hits = P => !['curse', 'mark', 'aura', 'herald', 'meta', 'buff', 'warcry', 'minion', 'raise'].includes(P.kind);
  list.forEach((A, i) => list.forEach((B, j) => {
    if (i === j) return;
    const a = A.P, b = B.P;
    // A sets a state up, B cashes it in.
    for (const s of [...b.consumes, ...b.bonus]) {
      const sets = s === 'curse' ? a.kind === 'curse' : a.applies.includes(s);
      if (sets) add(i, j, b.consumes.includes(s) ? '{0} inflicts {2} → {1} consumes it for a bigger hit' : '{0} inflicts {2} → {1} hits those enemies harder', A.label, B.label, STATE[s]);
    }
    if (b.detonator && a.kind === 'grenade') add(i, j, '{1} detonates the grenades of {0} at once', A.label, B.label);
    if (b.detonator && a.ground === 'gas') add(i, j, '{1} detonates the gas cloud of {0}', A.label, B.label);
    if (b.els.includes('fire') && hits(b) && a.ground === 'gas' && !b.detonator) add(i, j, 'Fire from {1} explodes the gas cloud of {0}', A.label, B.label);
    if (b.els.includes('fire') && hits(b) && a.ground === 'oil') add(i, j, 'Fire from {1} sets the oil of {0} ablaze', A.label, B.label);
    if (b.absorbs && GROUND_EL[a.ground]) add(i, j, '{1} absorbs the {2} left by {0} and gains its element', A.label, B.label, GROUND[a.ground]);
    if (a.kind === 'curse' && hits(b) && a.els.some(e => (b.els.length ? b.els : [b.el]).includes(e))) add(i, j, '{0}: cursed enemies take more damage from {1}', A.label, B.label);
    if (a.kind === 'orb' && a.detonates && hits(b) && b.els.includes(a.el)) add(i, j, '{0} applies exposure with each pulse → {1} hits those enemies harder', A.label, B.label);
    if (a.kind === 'mark' && a.gain && hits(b)) add(i, j, '{1} consumes {0}: a heavier hit and a {2} charge', A.label, B.label, CHARGE[a.gain]);
    if (a.kind === 'herald' && b.applies.includes(AILMENT[a.el])) add(i, j, '{1} inflicts {2} → kills trigger the explosion of {0}', A.label, B.label, STATE[AILMENT[a.el]]);
    if (a.gain && b.spend.includes(a.gain)) add(i, j, '{0} generates {2} charges → {1} spends them', A.label, B.label, CHARGE[a.gain]);
    if (a.empowers && a.kind === 'warcry' && b.attack && b.melee && hits(b)) add(i, j, '{0} empowers {1}: it repeats as an aftershock', A.label, B.label);
    if (a.repeats && b[a.repeats]) add(i, j, '{0} makes {1} repeat', A.label, B.label);
    if (a.empowers && a.kind === 'buff' && a.els.length && b.attack && hits(b)) add(i, j, '{0} infuses the next use of {1} with its element', A.label, B.label);
    if (a.kind === 'meta' && b.triggerable && b.spell && hits(b) && (!a.els.length || list.some(X => X.P.applies.includes(AILMENT[a.els[0]])))) add(i, j, '{0} casts {1} by itself when it fills its energy', A.label, B.label);
    if (a.corpse && b.kind === 'minion') add(i, j, '{0} can use the corpses of your enemies and of {1}', A.label, B.label);
    if (a.name === 'Frostbolt' && b.from === 'Frostbolt') add(i, j, '{1} cast near a {0} erupts from the projectile', A.label, B.label);
    if (a.kind === 'wall' && a.els.includes('fire') && b.kind === 'projectile') add(i, j, 'Projectiles of {1} fired through {0} gain fire', A.label, B.label);
    if (a.crystal && hits(b)) add(i, null, 'The ice crystals of {0} explode when your skills hit them', A.label);
    if (a.object && a.els.includes('lightning') && b.chains && b.els.includes('lightning')) add(i, j, 'Lightning of {1} chains to {0}, which pulses over its whole area', A.label, B.label);
    if (a.kind === 'orb' && a.chains && b.els.includes('lightning') && hits(b)) add(i, j, '{0} fires an extra bolt when you use {1} next to it', A.label, B.label);
    if (a.spread && b.dotHit && b.els.includes('chaos')) add(i, j, '{0} spreads on death together with {1}', A.label, B.label);
  }));
  list.forEach((A, i) => {
    if (A.P.corpse && !list.some(B => B.P.kind === 'minion')) add(i, null, '{0} needs corpses: kill dummies first (or press C)', A.label);
    if (A.P.needsCharges && !list.some(B => A.P.spend.includes(B.P.gain))) add(i, null, '{0} needs charges and nothing in the build generates them (press G in the scene)', A.label);
  });
  return out;
}
