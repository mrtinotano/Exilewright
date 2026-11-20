// Behaviour profile of every skill for the 3D scene.
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
  chainRange: 4,        // m of a chain (keywords.json Chain: 4 m, a projectile's 6 m: calc.js shape)
  fuse: 1.4,           // s grenade fuse
  orbFuse: 2.6,        // s of an orb that detonates after a time
  orbBlast: 2.4,       // m base blast when the data only gives the per-level bonus radius
  lifetime: 8,         // s of objects without duration in the data
  groundTime: 8,       // s of ground effects without duration in the data
  curseDelay: 0.9, curseTime: 9,
  ignite: 4, poison: 3, bleed: 5,
  freezeHits: 3, breakHits: 3,
  dot: 0.35,           // hits per second of each damage over time effect
  consume: 2,          // extra hits when a skill consumes a state and its data gives no number for it
  energy: 4,           // ailments a meta gem needs to trigger
  corpseTime: 14, respawn: 2.5,
  heraldR: 2.4,
  body: 0.35,          // m radius of a dummy
  channelTick: 0.16, channelHit: 0.4,   // s between the hits of a channelled skill and how hard each one is
  stormArea: 3,        // m over which a storm / rain with a small impact radius scatters its impacts
  meteor: 1.0,         // s a delayed impact takes to land when the data gives no time
  snap: 3,             // m around the cursor where a single-target skill looks for its target
  pickup: 0.6,         // m from a Remnant at which walking over it collects it (the data gives only the +% to it)
  totemArea: 3, totemTime: 12, minionTime: 14,
};

export const ELEMENTS = ['fire', 'cold', 'lightning', 'chaos', 'physical'];
// Ailment each element inflicts on hit, and the state a payoff looks for.
export const AILMENT = { fire: 'ignite', cold: 'freeze', lightning: 'shock', chaos: 'poison', physical: 'bleed' };
export const STATE = {
  ignite: 'Ignite', chill: 'Chill', freeze: 'Freeze', shock: 'Shock', poison: 'Poison', bleed: 'Bleeding',
  armour: 'Broken Armour', stun: 'Heavy Stun', curse: 'Curse', mark: 'Mark', expo: 'Exposure', electrocute: 'Electrocution', pin: 'Pinned', maim: 'Maimed',
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
  dot: 'Damage over time', buff: 'Buff', area: 'Area (cursor)', meteor: 'Delayed impact', beam: 'Line', volcano: 'Lingering area', snap: 'Area (cursor)', ember: 'Projectile', banner: 'Aura', solaris: 'Delayed impact', calamity: 'Buff', apocalypse: 'Buff', chayula: 'Buff', runes: 'Hazard', magma: 'Projectile', sigil: 'Buff', spite: 'Area', oil: 'Projectile', parry: 'Melee area', shield: 'Melee area', triskelion: 'Buff', disengage: 'Melee area', devour: 'Strike', vines: 'Lingering area', cross: 'Melee area', unearth: 'Cone', domain: 'Lingering area', galvanic: 'Buff', twister: 'Projectile',
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
  'Volcano': { kind: 'volcano', stages: true, ownStages: true },
  'Snap': { kind: 'snap', consumes: ['freeze', 'shock', 'ignite'] },
  'Ember Fusillade': { kind: 'ember' },
  'Skyfall': { kind: 'meteor' },
  'Spear of Solaris': { kind: 'solaris' },
  'Walking Calamity': { kind: 'calamity' },
  'Conductive Runes': { kind: 'runes' },
  'Rolling Magma': { kind: 'magma' }, Twister: { kind: 'twister' },
  'Apocalypse': { kind: 'apocalypse' },
  'Archon of Chayula': { kind: 'chayula' },
  'War Banner': { kind: 'banner' }, 'Defiance Banner': { kind: 'banner' }, 'Dread Banner': { kind: 'banner' }, 'Rite of Restoration': { kind: 'sigil' }, 'Shattering Spite': { kind: 'spite' }, 'Oil Barrage': { kind: 'oil' }, Parry: { kind: 'parry' }, 'Raise Shield': { kind: 'shield' }, 'Triskelion Cascade': { kind: 'triskelion' }, Disengage: { kind: 'disengage' }, Devour: { kind: 'devour' }, 'Thrashing Vines': { kind: 'vines' }, 'Cross Slash': { kind: 'cross' }, Unearth: { kind: 'unearth' }, 'Toxic Domain': { kind: 'domain' }, 'Galvanic Field': { kind: 'galvanic' },
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

  // Elemental Infusions: the one the skill leaves behind (Frost Bomb, Orb of Storms, Living Bomb) and the ones it can
  // consume (Ice Nova, Arc, Firestorm's three...), as its description says them
  const desc = gem?.description || '';
  const leaves = desc.match(/leav(?:es|ing) behind an? (?:\[(Cold|Fire|Lightning)\] \[ElementalInfusion|\[ElementalInfusion\|(Cold|Fire|Lightning) Infusion\])/)?.slice(1).find(Boolean)?.toLowerCase() || null;
  const infuses = /Consume\]? all three types of \[ElementalInfusion/.test(desc) ? ['fire', 'cold', 'lightning'] : [...desc.matchAll(/Consumes?\]? an? \[(?:(Cold|Fire|Lightning)\] \[ElementalInfusion|(Verisium)Infusion)/g)].map(m => (m[1] || m[2]).toLowerCase());
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
    culls: /\[CullingStrike\|Cull(?:ing)?\] (?:enemies|range)/i.test(desc), leaves, infuses, stages: has('GainsStages', 'PerfectTiming'), perfect: has('PerfectTiming'),
    slams: has('Slam'), plant: has('Plant'), wind: has('Wind'), fan: has('Slam') && has('Projectile'), ballista: has('TotemsAreBallistae'),
    // a buff that makes the next skill repeat: Barrage (bow / crossbow attacks) or Unleash (spells)
    repeats: has('ModifiesNextSkill') && !els.length ? (tag('dexterity') ? 'barrageable' : tag('intelligence') ? 'unleashable' : null) : null,
    detonator: has('Detonator') || tag('detonator'),
    detonates: has('DetonatesAfterTime'),
    chains: has('Chains') || tag('chaining'),
    explodes: radius && ['projectile', 'rain', 'grenade'].includes(kind),
    fissure: has('CreatesFissure'),
    absorbs: has('InteractsWithElementalGround'),
    crystal: has('IceCrystal'),
    object: has('ObjectDurability'), earthen: has('CanCreateStoneElementals'),
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

