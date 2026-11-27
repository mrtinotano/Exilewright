// 3D test room. 1 unit = 1 metre (PoE: 10 game units = 1 m).
// From the game: radius, projectile speed / range / collision and duration (geo() in app.js), the gem tags and skill types that
// decide how every skill behaves and what it combines with (skillfx.js), the enemies (life, energy shield, armour, evasion,
// resistances and the damage of their attacks at the chosen level: enemies.js) and the damage and speed of your skills (calc.js),
// each mitigated with the game's own formulas.
// Ailments follow the game's rules (GameConstants, each enemy's ailment threshold and poise, the skill's own modifiers: afflict()),
// and each gem's own chains, projectiles and times (calc.js shape). Consumed states, more damage against a state, charges spent,
// curses, marks and exposure use the skill's own stats (calc.js ailments(), curseOf(), markOf()), and totems and minions the
// damage calc.js gives their attack (minionOf()). Not in the game data: what consuming a state does when the skill gives no
// number for it, a minion whose skills deal no damage of their own, and how an enemy attack looks and reaches you. Those are the SIM defaults of
// skillfx.js and the shapes of enemies.js; a number that includes one of them is drawn with "~".
// Click to move (or W A S D, chosen in Settings: settings.js), the skill bar on the game's keys for each, Space roll, 1 / 2 flasks,
// Alt-drag orbit, wheel zoom, C corpse, G charges, V refill, X reset (all but the bar can be changed), and a controller when one is seen.
import * as THREE from 'three';
import { t, esc, tn, fmt, cap } from './i18n.js';
import { K as GAME, enemy, monSkill, addStats, MON_MODS, modStats, mapGround, enemyStats, attackOf, attacksOf, hitChance, hitRaw, playerHitChance, playerTakes, enemyTakes, blockChance, deflection, armourNow } from './enemies.js';
import { SIM, AILMENT, STATE, GROUND, GROUND_EL, KIND, CHARGE, profile } from './skillfx.js';
import { css, createFx, buildArena, ROOM, makeDummy, makeMinion, makeTotem, makeEffigy, makeBanner, makeWings } from './scenefx.js';
import { makeHumanoid, clipOf } from './humanoid.js';
import { settings, keyName, slotKeys, slotName } from './settings.js';
import { armourItems } from './items.js';
import { statLines } from './stats.js';
import { SK } from './skilldata.js';
import { onSet, accLoss } from './calc.js';

const TAU = Math.PI * 2, rnd = (a = 1, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), ease = k => 1 - (1 - k) ** 3;
function segDist(p, a, b) {
  const vx = b.x - a.x, vz = b.z - a.z, k = clamp(((p.x - a.x) * vx + (p.z - a.z) * vz) / (vx * vx + vz * vz || 1), 0, 1);
  return Math.hypot(p.x - a.x - vx * k, p.z - a.z - vz * k);
}
const noLeech = () => ({ life: { left: 0, rate: 0 }, mana: { left: 0, rate: 0 } });
const ailOf = els => els.flatMap(e => e === 'cold' ? ['chill', 'freeze'] : AILMENT[e] ? [AILMENT[e]] : []);
const ONCE = new Set(['buff', 'splinters', 'warcry', 'mark', 'curse', 'orb', 'wall', 'totem', 'raise', 'triskelion', 'sigil', 'banner', 'galvanic', 'cstaff', 'feast', 'tempest', 'pain', 'bone', 'mantra', 'demon', 'soul', 'drain', 'trift', 'pinnacle', 'tfreeze', 'iron', 'sacrifice', 'agony', 'temper', 'jade']);   // one use per key press
const NOHIT = new Set(['meditate', 'march', 'temper', 'hollow', 'banner', 'calamity', 'apocalypse', 'chayula', 'curse', 'mark', 'aura', 'herald', 'meta', 'buff', 'warcry', 'minion', 'raise', 'field', 'triskelion', 'sigil', 'parry', 'shield', 'reprieve', 'galvanic', 'cstaff', 'feast', 'tempering', 'tempest', 'pain', 'bone', 'mantra', 'demon', 'soul', 'drain', 'trift', 'pinnacle', 'tfreeze', 'iron', 'sacrifice', 'agony', 'jade', 'wardbound']);
const AREAL = new Set(['area', 'hexblast', 'nova', 'slam', 'rain', 'grenade', 'orb', 'curse', 'warcry', 'zone', 'storm', 'dot', 'meteor', 'wave', 'sweep', 'cone']);
const PIP = { ignite: 'fire', chill: 'cold', freeze: 'ice', shock: 'lightning', poison: 'poison', bleed: 'blood', armour: 'dust', stun: 'white', expo: 'gold', curse: 'curse', mark: 'mark', electrocute: 'lightning', pin: 'dust', maim: 'blood', blind: 'white' };
// The game's ailment rules (GameConstants in monsters.json), and the few its tables do not hold: the glossary's (keywords.json)
const GC = GAME.game || {};
const GRUEL = { slow: 15, pot: 10, max: 10, decay: 2 };   // KeywordPopups GruellingMadness: the first slows movement 15%, each more +10% slow potency of debuffs, at most 10, one lost every 2 s without more
const DIVINE = { every: 4, time: 10 };   // The Ordained's Fragments of Divinity: one every 4 s (its text), each lasting 10 s (KeywordPopups DivineFragment)
const BROKEN = { time: 12, taken: 20, player: 4 };   // note: keywords.json ArmourBreak: Fully Broken for 12 s, +20% physical damage taken from hits; a player's 4 s, without it
const WARD_REGEN = 5;                     // note: keywords.json Ward: Runic Ward regenerates 5% a second by default
const EXPO = { time: 4, res: 20 };        // note: keywords.json Exposure: -20% elemental resistances for 4 s by default
const DMG_AIL = ['bleed', 'ignite', 'poison'];   // keywords.json DamagingAilments
const CHILL_MIN = 30;                     // note: keywords.json Chill: a chill under 30% is ignored
const ANCESTRAL = { slam: 30, area: 25, strike: 2 };   // note: keywords.json Ancestral Boost: a Slam 30% more damage, 25% increased area; a Strike 2 additional enemies
const MAIM = { move: 30, evasion: 15, time: 4 };   // note: keywords.json Maim: 30% slower movement, 15% reduced evasion, 4 s
const FAERIE = { pct: 2, time: 8, max: 10 };   // note: keywords.json FaerieFire: 2% of damage gained as a random element per stack, 8 s, up to 10
const BLIND = { less: 20, time: 4 };   // note: keywords.json Blind: 20% less accuracy and evasion, 4 s
const VOLATILITY = { fuse: 4, dmg: 100, power: 1, time: 10, every: .1, max: 200 };   // note: keywords.json Volatility
const UNHOLY = 30;   // note: keywords.json Unholy Might: 30% of all damage as extra chaos
const PERFECTION = { time: 10, max: 4, more: 5 };   // keywords.json PerfectionBuff: 10 s, up to 4 stacks, 5% more damage each
const TASALIO = { more: 10, max: 5, win: 30 };   // Tasalio's Rhythm (its text): 10% more damage and a 30% shorter Perfect Timing window per stack, up to 5
const JAGGED = { slow: 20 };   // keywords.json Jagged Ground: slows enemies in its area by 20%
const WASTING = { regen: 50, time: 6 };   // KeywordPopups AbyssalWasting: 50% less life regeneration rate for 6 seconds
const EVERLASTING = { res: 5, time: 4 };   // KeywordPopups EverlastingSacrifice: +5% to all maximum resistances for 4 seconds
const HINDER = { slow: 30, time: 4 };   // keywords.json Hinder: 30% slower movement for 4 seconds
const DAZE = { time: 8, stun: 50 };   // keywords.json Daze: lasts 8 seconds, 50% more stun buildup
const WEAK = { per: .5, max: 20, time: 4 };   // keywords.json CriticalWeakness: +0.5% critical hit chance per stack, up to 20, 4 seconds each
const TAILWIND = { move: 1, speed: 2, evasion: 10, deflect: 1, max: 10 };   // KeywordPopups Tailwind, per stack: increased movement speed, skill speed and evasion, damage of deflected hits prevented
const DEBIL = { slow: 20, less: 10, time: 1 };   // KeywordPopups Debilitate: reduced movement speed and damage dealt, its seconds
const UARCHON = { more: 25, cd: 200, limit: 100 }, PUPPET = { cmdSpeed: 10, cmdMove: 10, cmdDmg: 10, move: 2, speed: 3, time: 8, max: 5 };   // KeywordPopups UndeadArchon (more minion damage, command cooldown recovery, temporary minion limit) and PuppetMaster (per stack)
const EARCHON = { more: 25, ail: 100 }, HIGH_FLAME = .65;   // KeywordPopups ElementalArchon: 25% more elemental spell damage, 100% more freeze buildup, flammability and shock chance; HighInfernalFlame: 65% or more
const ONSLAUGHT = { speed: 20, move: 10, time: 4 };   // keywords.json Onslaught: 20% increased skill speed, 10% increased movement speed, 4 s unless specified
const INTIM = 10;   // keywords.json Intimidate: 10% increased damage taken and 10% reduced damage dealt
// note: KeywordPopups Runefather's Challenge: +5 Power (BuffTemplates AncientsChallenge), each Runefather's Boast +1 to Armour,
// to Evasion Rating and to Stun Threshold; Corrupted Blood: up to 10 of them on each target
const RUNEFATHER = 5, BLOOD_MAX = 10;
// note: KeywordPopups Soul Eater: each eaten Soul 1% increased Skill Speed, up to 50, one lost every 0.5 s once 4 s pass without
// eating; Fear Incarnate: 10% increased Culling Strike threshold each for 10 s (refreshed), up to 20; Overencumbered: Slows by 10%, stacking
const SOUL = { speed: 1, max: 50, every: .5, wait: 4 }, FEAR = { cull: 10, time: 10, max: 20 }, OVERENC = 10;
// note: KeywordPopups Finality: 100% increased Critical Hit Chance with Final Strikes, Strike skills skip to their Final Strike, no
// Combo gained meanwhile; Explosive Rhythm: 10% increased Cooldown Recovery Rate of Grenade skills each; Explosive Fervour: 15%
// increased Attack Speed per different Grenade skill used Recently, Grenade skills ignore their cooldown and fire one more
// projectile, Grenades explode on any impact. Redemption's text: all Rhythm removed at 10 for 10 seconds of Fervour
const FINALITY = 100, RHYTHM = { cd: 10, max: 10 }, FERVOUR = { speed: 15, time: 10 };
// note: KeywordPopups Spectral Fire: the target takes no damage from Ignite, which feeds it instead; when it expires or the target dies
// it explodes, dealing all it absorbed to the enemies within 1.8 m, the target too; damage modifiers do not apply to the explosion
const SPECTRAL = 1.8;
// Dark Whispers (KeywordPopups DarkWhispers): increased Curse magnitudes each, their maximum, how long they last since the last
// one gained, and the share of life, mana and energy shield each takes when they expire, over that many seconds
const WHISPER = { mag: 4, max: 10, time: 8, loss: 3, over: 4 };
const SURROUNDED = { n: 5, r: 3 };   // keywords.json Surrounded: at least 5 enemies within 3 metres of you
const ARCANE = { cast: 15, regen: 20 };   // note: Arcane Surge's increased cast speed and more mana regeneration, PoB2's (CalcDefence): not in the game data here
const CRUSH = 15;   // keywords.json Crushed: 15% less physical damage reduction, possibly below 0
const INCISION = { per: 10, max: 10, cap: 30 };   // keywords.json Incision: 10% chance to bleed per stack, up to 10; the support's "up to 30%"
const IMPALE = { pct: 30, max: 60 };   // keywords.json Impale: 30% of the hit's physical damage, up to 60 on a target
const CHALICE = { charges: 2, rec: 30 };   // keywords.json OverflowingChalice: flasks gain 2 charges a second, 30% increased recovery
const WITHER = { per: 5, max: 10 };   // note: keywords.json Withered: 5% increased chaos damage taken, up to 10 times
const TRINITY_MAX = 100;   // note: keywords.json Affinity: a maximum of 100 of each type
const CULL = { normal: 35, magic: 20, rare: 10, unique: 5 };   // note: keywords.json CullingStrike: the life % at or below which a hit kills
const SLOW_FLOOR = .25;                   // note: keywords.json Slow: monsters cannot be slowed below 25% of their speed
const CHARGE_TIME = 15;                   // note: keywords.json Charges: they last 15 s
const IMMUNE = 1;                         // note: keywords.json Consume: a consumed ailment cannot be inflicted again for 1 s
const GROUND_TIME = { burning: 4, chilled: 6, shocked: 6 };   // note: keywords.json Ignited / Chilled / Shocked Ground, in s
const ELEM = ['fire', 'cold', 'lightning'];
const DUR = { ignite: GAME.ignite_duration || SIM.ignite, chill: GC.BaseChillDuration, shock: GC.BaseShockDuration, freeze: GC.FreezeDuration,
  poison: GAME.poison_duration || SIM.poison, bleed: GAME.bleed_duration || SIM.bleed, armour: BROKEN.time, stun: GAME.heavy_stun_ms / 1000, expo: EXPO.time,
  electrocute: GC.ElectrocuteDuration / 1000, pin: GC.PinDuration };
const GFX = { burning: ['fire', 'patch'], chilled: ['cold', 'patch'], shocked: ['lightning', 'patch'], oil: [0x050403, 'patch', true], gas: ['gas', 'patch'],
  jagged: [0x070605, 'cracks', true], caustic: ['poison', 'patch'], consecrated: ['holy', 'rune'] };
const GAIL = { burning: 'ignite', chilled: 'chill', shocked: 'shock', gas: 'poison', caustic: 'poison' };
const CHC = { frenzy: 'poison', power: 'arcane', endurance: 'fire' };

// api: { build(), geo(g), playerSpeed(), info(g) → { gem, data, label, icon }, onSelect(i), sheet() → calc.js character() + recovery(),
//        damage(g) → calc.js skill(), usedBy(i) → the meta gem that uses gem i, byHand(i) → gem i is used by hand, reserve(g) → the spirit gem g reserves (calc.js), onPlacing(on) }
// what the simulator cannot know, shown behind its "!" button
const NOT_KNOWN = [
  "Flight and travel times the data does not give (mortars, thrown and falling skills): the simulator uses its own.",
  "Ranges and shapes the data does not give (cast, throw and leap range, cone angle, an area without a radius): default values, marked as simulated.",
  "How monsters move, aim and choose when to attack: their AI is not in the game's files. By default the enemies do not attack.",
  "Collision and hit detection: enemies are circles on flat ground, with no walls or line of sight.",
  "Interactions the game does not describe exactly, such as whether a shock over a shock sets off triggers, or when a field's first pulse happens.",
  "Animations, server timing and latency: each use takes the skill's attack or cast time, with nothing else in between.",
  "The order in which effects that happen at once are applied, and the game's rounding.",
  "A few supports whose damage the game's windows show otherwise than their stats: measured in the game, not read from its files.",
];
export function initScene(el, api) {
  // ---------- renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  const dom = renderer.domElement; el.prepend(dom);
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(42, 1, .1, 400);
  const fx = createFx(scene), arena = buildArena(scene, fx), player = makeHumanoid(fx), pp = player.group.position;
  scene.add(player.group);
  const size = { w: 0, h: 0 };
  let composer = null;
  // bloom: the effects are drawn brighter than white so they glow. Without the add-ons the scene still renders.
  Promise.all(['EffectComposer', 'RenderPass', 'UnrealBloomPass', 'OutputPass'].map(n => import(`three/addons/postprocessing/${n}.js`))).then(([E, R, U, O]) => {
    const c = new E.EffectComposer(renderer, new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 }));
    c.addPass(new R.RenderPass(scene, cam));
    c.addPass(new U.UnrealBloomPass(new THREE.Vector2(256, 256), .5, .55, .92));
    c.addPass(new O.OutputPass());
    composer = c; size.w = 0;
  }).catch(e => console.warn('scene: post-processing unavailable', e));

  // ---------- state
  const tpl = { mon: null, level: 1, attack: null, rarity: null, mods: [] };   // the enemy the next click places
  let divine = [];   // Fragments of Divinity lying in your Presence: { p, until, dec }
  const me = { life: 0, es: 0, maxL: 0, maxE: 0, widow: 0, hurt: -9, safe: 0, recoup: [], known: false, mana: 0, maxM: 0, rage: 0, raged: -99, heat: 0,
    st: {}, mag: {}, burn: {}, flam: [], leech: noLeech(), bar: {}, lock: {}, stuns: [], calm: 0, tick: .5, by: null, fl: [null, null], drink: [], cc: [null, null, null], cu: [], guard: 0, ward: 0, jade: 0, maxW: 0, runes: [], mimics: [], fuel: {}, fuelAt: {}, inf: {}, infUsed: -99, glory: {}, gloryAt: {}, aff: { fire: 0, cold: 0, lightning: 0 }, affAt: {}, arctic: 0, travAt: {}, voltAt: {}, rifts: [], incs: [], bark: [], trav: 0, wind: 0, sealAt: {}, fallen: [], grim: 0 };   // your pools: life and energy shield against their attacks, mana for your skills, Rage; the ailments their hits put on you
  const camS = { yaw: 0, pitch: .93, dist: 16 }, camT = V(), cursor = V(0, 0, 6);
  const keys = {}, mouse = new THREE.Vector2(), ray = new THREE.Raycaster(), plane = new THREE.Plane(V(0, 1, 0), 0);
  const stats = { kills: 0, dealt: 0, taken: 0, deaths: 0 }, charges = { frenzy: 0, power: 0, endurance: 0 }, chargeAt = {}, tog = {};
  let sel = 0, time = 0, shake = 0, facing = 0, castAt = -9, cd = 0, rollCd = 0, orbit = false, placing = false, walk = false, goal = null;   // goal: where a click on the ground sends you
  const rains = {};   // Rain of Arrows: the latest rain of each skill
  let archonAt = -Infinity, dummies = [], objs = [], grounds = [], hazards = [], timers = [], empower = [], buffs = [], logs = [], fissures = [], clog = [], frags = [], byS = {}, hover = null, lastHit = null, topD = null, surges = [];
  let held = null, charge = null, move = null, toastT = 0, hudT = 0;

  // ---------- HUD
  const hud = el.querySelector('#hud') || el.appendChild(Object.assign(document.createElement('div'), { id: 'hud' }));
  const div = (cls, into = el) => into.appendChild(Object.assign(document.createElement('div'), { className: cls }));
  // laid out like the game's screen: your effects top left, the keys and statistics behind a button top right, life
  // (and energy shield) in the left orb and mana in the right one with their numbers over them, the skills by the mana orb
  const top = div('s-top'), col = div('s-col', top), buffEl = div('s-buffs', col), badEl = div('s-buffs', col), help = top.appendChild(Object.assign(document.createElement('button'), { className: 's-help', textContent: '?' }));
  help.title = t('Keys and statistics of the simulator'); hud.hidden = true; el.appendChild(hud);
  help.onclick = () => { hud.hidden = !hud.hidden; help.classList.toggle('on', !hud.hidden); };
  // how far to trust it: what the game's files and Path of Building 2 give, and what nothing can tell (NOT_KNOWN)
  const warn = top.appendChild(Object.assign(document.createElement('button'), { className: 's-help', textContent: '!', title: t('About the simulator') }));
  const note = el.appendChild(Object.assign(document.createElement('div'), { className: 's-note', hidden: true }));
  note.innerHTML = `<b>${t('About the simulator')}</b><p>${t("The simulator uses the game's own data (skills, supports, monsters, game constants) and Path of Building 2's formulas, but not all of the game's internal workings can be known: it may not be 100% accurate. Use it to compare, and check in the game what matters.")}</p>`
    + `<p>${t('What cannot be checked:')}</p><ul>${NOT_KNOWN.map(x => `<li>${t(x)}</li>`).join('')}</ul>`;
  warn.onclick = () => { note.hidden = !note.hidden; warn.classList.toggle('on', !note.hidden); };
  // the combat log: the last hits by skill and enemy, what hit you and what you avoided, with the damage of each skill
  const logBtn = top.appendChild(Object.assign(document.createElement('button'), { className: 's-help', textContent: '≡', title: t('Combat log') }));
  const clogEl = el.appendChild(Object.assign(document.createElement('div'), { className: 's-note s-clog', hidden: true }));
  logBtn.onclick = () => { clogEl.hidden = !clogEl.hidden; logBtn.classList.toggle('on', !clogEl.hidden); };
  // pause: time stands still (skills, buffs, enemies, the stats) and the frame stays, to look at it calmly; "Game Paused"
  // over the scene meanwhile (the game's texts)
  let paused = false;
  const pauseBtn = top.appendChild(Object.assign(document.createElement('button'), { className: 's-help' }));
  const pauseShow = () => { pauseBtn.textContent = paused ? '▶' : '⏸'; pauseBtn.title = t(paused ? 'Resume Game' : 'Pause'); pauseBtn.classList.toggle('on', paused); el.classList.toggle('paused', paused); el.dataset.paused = t('Game Paused'); };
  pauseBtn.onclick = () => { paused = !paused; pauseShow(); }; pauseShow();
  clogEl.onclick = e => { if (e.target.dataset.clear != null) { clog = []; byS = {}; } };
  // a line per source and target: what they do within a second of their last line adds to it (damage over time ticks)
  const record = (k, src, tgt, n = 0, c = 'gold') => {
    const l = clog.slice(-8).find(l => l.k === k && l.src === src && l.tgt === tgt && time - l.at < 1);
    if (l) { l.n += n; l.x++; l.at = time; return; }
    clog.push({ k, src, tgt, n, c, x: 1, at: time }); if (clog.length > 150) clog.shift();
  };
  const logEl = div('s-log'), lifeEl = div('s-life'), manaEl = div('s-mana'), bar = div('s-bar'), tipEl = div('s-tip'), toastEl = div('s-toast');
  tipEl.hidden = true;
  const pickEl = div('s-pick'); pickEl.hidden = true;
  const tgtEl = div('s-target');
  const shown = new Map(), put = (node, html) => { if (shown.get(node) !== html) { shown.set(node, html); node.innerHTML = html; } };
  const say = (text, c = 'gold') => {
    const l = logs[logs.length - 1];
    if (l && l.text === text && time - l.at < 2.5) { l.n++; l.at = time; }
    else { logs.push({ text, c: css(c), at: time, n: 1 }); if (logs.length > 7) logs.shift(); }
  };
  const toast = text => { toastEl.textContent = text; toastEl.classList.add('on'); toastT = 2.2; };
  const later = (sec, fn) => { timers.push({ s: sec, fn }); };
  const hand = () => player.hand(V());
  // the character of the build (calc.js): defences, accuracy and recovery
  let shC = { at: -9, v: {} };
  // The Hammer of Faith's lesser Shrine buff and the modifiers Headhunter took from rare monsters, while they last, and the
  // auras of monster modifiers you are within (Temporal Bubble, Executioner's Presence, flask drain)
  const shrineOn = () => {
    if (me?.hh) me.hh = me.hh.filter(h => h.until > time);
    const foe = dummies.flatMap(d => d.dead || !d.stat?.foe ? [] : d.stat.foe.filter(a => dist(d.pos, pp) <= a.r).map(a => a.stats));
    const L = [me?.shrineBuff?.until > time && me.shrineBuff.stats, ...(me?.hh || []).map(h => h.stats), ...foe, ...embank()].filter(Boolean);
    return L.length ? addStats(L) : null;
  };
  // Tactician's Strategic Embankments (KeywordPopups TacticianTotemBuff, BuffDefinitions tactician_*_aura): each kind of
  // totem of yours you are within the Presence of gives you its aura, once. note: the totem's Presence is yours here
  const EMBANK = { 'Artillery Ballista': { 'skill_speed_+%': 20 }, 'Siege Ballista': { 'tactician_artillery_ballista_aura_damage_+%_final_vs_immobilised_enemies': 25 },
    'Mortar Cannon': { 'non_skill_base_all_damage_%_to_gain_as_fire': 25 }, 'Shockwave Totem': { 'base_skill_area_of_effect_+%': 30 }, 'Ancestral Warrior Totem': { 'glory_generation_+%': 40 },
    'Dark Effigy': { 'damage_over_time_+%': 40 }, 'Spell Totem': { 'critical_strike_chance_+%': 50 } };
  const embank = () => shC.v.embank ? [...new Set(objs.filter(o => o.embank && !o.dead && dist(o.pos, pp) <= (shC.v.overgrow?.r || 4)).map(o => o.embank))].map(k => EMBANK[k]) : [];
  const sheet = () => { if (time - shC.at > .5) shC = { at: time, v: api.sheet?.(shrineOn()) || {} }; return shC.v; };
  const short = n => n < 99999.5 ? fmt(Math.round(n)) : n < 999950 ? fmt(n / 1e3, 1) + 'k' : fmt(n / 1e6, 2) + 'M';
  const NUMC = el => el === 'physical' ? '#f2ead8' : css(el);

  // ---------- skills of the build
  const profs = new Map(), cache = new Map();
  // Nature's Archon (calc.js character() overgrow: its time; its stats from the game, api.archon) and a plant gem with them
  const archonOn = () => time - archonAt < sheet().overgrow.archonTime, archonG = new WeakMap();
  // Archon of Undeath (an Archon: its time, recovery and effect as Nature's): gained, it Revives your fallen persistent
  // minions. note: all of them, the game's Undead only; Puppet Master: its stacks now (their effect as a count)
  const isCmd = S => !!api.info(S.g || {})?.gem?.types?.includes('CommandsMinions'), uarch = () => time < (me.uarch ?? -9);
  const pup = () => (me.pup = (me.pup || []).filter(at => at > time)).length * sheet().puppet.eff;
  const tmpN = n => (n + sheet().tempMinion) * (uarch() ? 1 + UARCHON.limit / 100 : 1);   // Archon of Undeath: more temporary minion limit
  function undeathGo() {
    const G = sheet().overgrow; if (uarch() || time < (me.uarchOff ?? -9)) return;
    me.uarch = time + G.archonTime; me.uarchOff = me.uarch + G.archonDelay; buffs.push({ label: t('Archon of Undeath'), c: css('chaos'), s: G.archonTime });
    say(t('{0} active', t('Archon of Undeath')), 'chaos'); if (me.fallen?.length) reviveFallen(Infinity);
  }
  const withArchon = g => { const e = sheet().overgrow.archonEffect; if (archonG.get(g)?.e !== e) archonG.set(g, { e, g: { ...g, add: Object.fromEntries(Object.entries(api.archon || {}).map(([k, x]) => [k, Math.floor(x * e)])) } }); return archonG.get(g).g; };   // with its increased effect on you
  const prof = (g, inf) => { let P = profs.get(g.name); if (!P) profs.set(g.name, P = profile(inf.gem || { name: g.name }, inf.data || {})); return P; };
  function base(i) {
    const g = api.build().gems[i]; if (!g) return null;
    const c = cache.get(i); if (c && c.g === g && time - c.at < .5) return c.S;
    const inf = api.info(g), BA = banner('banner_attack_speed_+%'), g1 = archonOn() && inf.gem?.tags?.includes('plant') ? withArchon(g) : g;
    // Sands of Time (KeywordPopups Chronobuff): 60% increased skill speed scaling down to 1% over 10 seconds and back up, the
    // area of effect the other way round, from 1% to 60%
    const a0 = g1.add || {}, ST = sheet().sands && 1 + 59 * Math.abs(time % 20 - 10) / 10, add = { ...a0, ...(BA && { 'attack_speed_+%': BA }), ...(ST && { 'skill_speed_+%': (a0['skill_speed_+%'] || 0) + ST, 'base_skill_area_of_effect_+%': (a0['base_skill_area_of_effect_+%'] || 0) + 61 - ST }) };
    // and the Shrine buff's; Quecholli's area if you killed recently; Snakebite's poison duration after consuming a frenzy charge
    const SB = { ...shrineOn() }, SH = sheet(); if (SH.areaKilled && meIs.KilledRecently()) SB['base_skill_area_of_effect_+%'] = (SB['base_skill_area_of_effect_+%'] || 0) + SH.areaKilled;
    if (SH.poisonFrenzy && meIs.ConsumedFrenzyRecently()) SB['base_poison_duration_+%'] = SH.poisonFrenzy;
    const FZ = SH.durFrozen && (me.froze = (me.froze || []).filter(at => time - at <= 8)).length; if (FZ) SB['skill_effect_duration_+%'] = Math.min(40, SH.durFrozen * FZ);   // Blessing of the Moon: skill effect duration per enemy Frozen in the last 8 seconds, up to 40% (its text's)
    // Hysseg's Claw: increased damage per minion of yours; The Dark Defiler: damage gained as chaos per Undead one
    const MN = (SH.perMinion || SH.chaosUndead) && objs.filter(o => o.minion && !o.dead);
    if (MN?.length && SH.perMinion) SB['damage_+%'] = (SB['damage_+%'] || 0) + SH.perMinion * MN.length;
    if (MN?.length && SH.chaosUndead) SB['non_skill_base_all_damage_%_to_gain_as_chaos'] = (SB['non_skill_base_all_damage_%_to_gain_as_chaos'] || 0) + SH.chaosUndead * MN.filter(o => o.undead).length;
    for (const [k, n] of Object.entries(SB)) add[k] = (add[k] || 0) + n;
    const g2 = BA || ST || Object.keys(SB).length ? { ...g1, add } : g1, G = api.geo(g2), dmg = api.damage?.(g2) || null, P0 = prof(g, inf), dur = dmg?.shape?.duration, P = dur ? { ...P0, dur } : P0;   // the level's skill effect duration with the build's modifiers
    const R = P.radiusBonus ? SIM.orbBlast + G.radius : G.radius;
    let els = P.els.length ? [...P.els] : P.attack ? ['physical'] : [], ail = [...P.applies], col = P.el;
    // gas and oil only burn once something sets them alight
    if (P.ground === 'gas' || P.ground === 'oil') { els = els.filter(e => e !== 'fire'); ail = ail.filter(a => a !== 'ignite'); col = P.ground === 'gas' ? 'gas' : 'dust'; }
    const tags = inf.gem?.tags || [];
    const S = { i, g, P, G, kind: P.kind, name: g.name, label: inf.label, el: col, els, ail, mult: dmg?.attack ? 1 + banner('attack_damage_+%_final') / 100 : P.spell ? (1 + (me.ley?.more || 0) / 100) * (1 + banner('circle_of_power_spell_damage_+%_final') / 100) : 1, gm: 1, spent: 0, R, A: R || SIM.area, aoe: P.aoe ?? (P.explodes || tags.includes('area')), spear: inf.gem?.types?.includes('Spear'), shape: !!inf.gem?.types?.includes('Shapeshift'), dmg, chaos: tags.includes('chaos'), elemental: tags.some(x => ['fire', 'cold', 'lightning'].includes(x)) };
    cache.set(i, { g, at: time, S }); return S;
  }
  const setBuff = b => { buffs = buffs.filter(x => x.label !== b.label); buffs.push(b); };
  const moreProj = S => { const E = sh(S).extraProj; if (!E) return 0; const p = Math.random() * 100;   // calc.js shape extraProj
    return Math.floor(E.chance / 100) + (p < E.chance % 100 ? 1 : 0) + (Math.random() * 100 < E.two ? 2 : 0); };
  const sh = S => S.dmg?.shape || {}, durOf = S => sh(S).duration || (S.dmg?.stats?.base_skill_effect_duration || 0) / 1000;   // the gem's own chains, projectiles and times (calc.js)
  const mk = i => { const b = base(i); return b && { ...b, els: [...b.els], ail: [...b.ail] }; };
  const byName = name => api.build().gems.findIndex(g => g.name === name);
  // What is used by hand gets a slot (calc.js byHand); persistent skills are on while their spirit is reserved, so the
  // scene turns them on in the build's order while the build's Spirit covers them (the game starts none it cannot reserve)
  const always = g => (api.info(g).gem?.types || []).includes('Persistent'), unpaid = new Set();
  // a Banner too: on while its Spirit is reserved, building its Glory, and placed by hand
  const slots = () => api.build().gems.flatMap((g, i) => api.byHand(i) || (api.info(g).gem?.types || []).some(x => x === 'Banner' || x === 'PersistentShowsCastTime') || ['Iron Ward', 'Grim Feast', 'Rhoa Mount', 'Convalescence'].includes(g.name) || /Djinn$/.test(SK.minions[g.name]?.[0] || '') ? [i] : []);   // Temporal Rift, Iron Ward, Grim Feast (its Grim Resurrection), Rhoa Mount (mounting), a djinn (its own Command): on, and used
  // the skill bar, as the game's: left, middle and right mouse button, then Q W E R T (Q E R T F moving with W A S D), each
  // with the skill put on it (click its slot to choose); a skill new to the build takes the first free slot, as in the game.
  // Move is one of them, on left click to begin with: a skill put there replaces it, and you walk only with the slot that
  // has Move. -> gem index, MOVED (-1) or null
  const MOVE = '@move', MOVED = -1, moveImg = `<img src="${esc(api.moveIcon || '')}" alt="" draggable="false" onerror="this.remove()">`;
  function barNow() {
    const gems = api.build().gems, own = slots(), names = own.map(i => gems[i].name), B = api.bar?.() || {};
    const s = slotKeys().map((_, k) => B.slots?.[k] ?? null), seen = [...(B.seen || [])];
    const free = () => s.findIndex(x => !x || x !== MOVE && !names.includes(x));
    let change = !B.slots;
    if (!seen.includes(MOVE)) {   // once per bar: Move on left click, what was there to a free slot
      seen.push(MOVE); change = true;
      if (!s.includes(MOVE)) { const was = s[0]; s[0] = MOVE; const k = free(); if (was && k >= 0) s[k] = was; }
    }
    for (const n of names) if (!seen.includes(n)) { seen.push(n); change = true; const k = free(); if (k >= 0) s[k] = n; }
    if (change) api.setBar?.({ slots: s, seen });
    return s.map(n => n === MOVE ? MOVED : n ? (own.find(i => gems[i].name === n) ?? null) : null);
  }
  // a skill already on another slot swaps with the one here, as in the game
  function setSlot(k, name) { barNow(); const B = api.bar?.(); if (!B) return; const s = [...B.slots], j = name ? s.indexOf(name) : -1; if (j >= 0 && j !== k) s[j] = s[k]; s[k] = name; api.setBar({ ...B, slots: s }); hudT = 0; }
  // a slot's key: a mouse with its button lit, or the letter
  const MOUSE = ['M5 1v5H1V5a4 4 0 0 1 4-4z', 'M4.2 2.4h1.6v2.8H4.2z', 'M5 1v5h4V5a4 4 0 0 0-4-4z'];
  const keyLabel = k => { const c = slotKeys()[k]; return padOn ? PAD_NAME[k] : c[0] === 'm' ? `<svg class="s-mouse" viewBox="0 0 10 14"><rect x="1" y="1" width="8" height="12" rx="4" fill="none" stroke="currentColor"/><path d="${MOUSE[+c[1]]}" fill="currentColor"/></svg>` : keyName(c); };
  // A controller, when the browser sees one (Gamepad API, standard layout): the left stick moves, the right stick aims, else
  // the nearest enemy is the target, as the game's controller does; its buttons use the bar's slots, roll and drink.
  // note: the game's default controller binds are in its executable, not in its files: this layout is the simulator's.
  const PAD = { 0: 0, 2: 1, 3: 2, 5: 3, 7: 4, 4: 5, 6: 6, 11: 7 }, PAD_NAME = ['A', 'X', 'Y', 'RB', 'RT', 'LB', 'LT', 'RS'];
  let padOn = false, padWas = [], steer = null;   // steer: where W A S D or the stick move you this frame
  const tilt = (x, y) => Math.hypot(x, y) > .25;
  const inputOf = on => { if (padOn !== on) { padOn = on; hudT = 0; } };
  // a direction on the screen (x right, y up) on the ground, as the camera sees it
  const onGround = (x, y) => { const s = Math.sin(camS.yaw), c = Math.cos(camS.yaw), wx = c * x - s * y, wz = -s * x - c * y, l = Math.hypot(wx, wz); return l ? { x: wx / l, z: wz / l } : null; };
  function pad() {
    const g = [...(navigator.getGamepads?.() || [])].find(Boolean); if (!g || el.hidden) return null;
    const b = g.buttons.map(x => x.pressed), [lx = 0, ly = 0, rx = 0, ry = 0] = g.axes;
    if (b.some(Boolean) || tilt(lx, ly) || tilt(rx, ry)) inputOf(true);
    b.forEach((on, n) => {
      if (on === !!padWas[n]) return;
      const k = PAD[n], key = 'pad' + n;
      if (!on) unhold(key);
      else if (k != null) useSlot(k, key); else if (n === 1) roll(); else if (n === 14 || n === 15) drink(n - 14);
    });
    padWas = b;
    return { move: tilt(lx, ly) ? onGround(lx, -ly) : null, aim: tilt(rx, ry) ? onGround(rx, -ry) : null };
  }
  const gemBy = n => api.build().gems.find(g => g.name === n);
  const labelOf = name => { const g = api.build().gems.find(g => g.name === name); return g ? api.info(g).label : name; };
  const NONE = { P: profile(null), name: '', label: '', el: 'physical', els: [], ail: [], mult: 1, src: 'none' };
  // Flameblast: its stages (the charge's share of its most), each its radius more and its more damage
  // note: the scene's charge fills them in its 1.6 s, not one per cast time
  const blast = S => Math.round((S.stage || 0) * S.dmg.stats.flameblast_maximum_stages);
  const stageR = S => S.stage == null ? S.A : S.dmg?.stats?.flameblast_maximum_stages ? S.A + blast(S) * S.dmg.stats['vaal_flameblast_radius_+_per_stage'] / 10
    : S.R ? S.A * (.4 + .8 * S.stage) : S.A * (1 + 2 * S.stage);
  const meleeR = S => (sh(S).reach ?? SIM.meleeRange) + (time - (me.projHit ?? -99) <= 8 ? sheet().meleeProj || 0 : 0);   // the weapon's reach (calc.js shape), else the scene's; the tree's more after a projectile attack hit in the past 8 s
  // to the dummy's edge; a strike with a dash range of its own (Killing Palm, Ice Strike...) dashes to an enemy farther than melee
  // a melee skill steps to a target just past its weapon's reach (its melee_conditional_step_distance)
  const stepR = S => (S.dmg?.stats?.melee_conditional_step_distance || 0) / 10;
  const strikeR = S => (S.P.dash ? sh(S).dash ?? SIM.dashRange : Math.max(meleeR(S) + stepR(S), sh(S).dash || 0)) + SIM.body;
  const inCone = (c, a0, half, p) => { const da = Math.atan2(p.z - c.z, p.x - c.x) - a0; return Math.abs(Math.atan2(Math.sin(da), Math.cos(da))) <= half; };
  const coneHalf = S => (S.cone / 2 || (S.kind === 'cone' ? SIM.cone / 2 : 65)) * Math.PI / 180;   // S.cone: the data's angle (Deadly Resolve)
  function aim(S, p) {
    const max = S.kind === 'grenade' ? SIM.throwRange : S.kind === 'travel' ? sh(S).travel ?? SIM.travelRange : S.kind === 'slam' ? meleeR(S) : SIM.castRange * (S.kind === 'totem' ? 1 + sheet().totemRange / 100 : 1);   // the tree's increased totem placement range
    let dx = p.x - pp.x, dz = p.z - pp.z, l = Math.hypot(dx, dz);
    if (l < .001) { dx = Math.sin(facing); dz = Math.cos(facing); l = 0; } else { dx /= l; dz /= l; }
    const k = S.src ? l : Math.min(l, max);
    S.dx = dx; S.dz = dz; S.from = { x: pp.x, z: pp.z }; S.at = { x: pp.x + dx * k, z: pp.z + dz * k };
  }

  // ---------- enemies: monsters of the game placed with a click, with their stats at the chosen level (enemies.js)
  // sources the damage of the build does not describe (a totem or minion with its own damage hits as 'totemHit' / 'minionHit')
  const APPROX = new Set(['minion', 'totem', 'ground', 'mark', 'herald', 'none']);
  const MAXE = 60;
  function arm(d, level, key, rarity = tpl.rarity, mods = tpl.mods) {
    const m = d.mon, list = attacksOf(m), fresh = d.level !== level || d.rarity !== rarity || d.modKey !== mods.join();
    d.level = level; d.rarity = rarity; d.modKey = mods.join(); d.stat = enemyStats(m, level, rarity, false, mods); d.atk = attackOf(m, level, list.some(a => a.key === key) ? key : list[0].key, rarity, false, mods);
    d.col = Object.entries(d.atk.hasHit ? d.atk.hits : d.atk.dot).map(([el, x]) => [el, x[1] ?? x]).sort((x, y) => y[1] - x[1])[0]?.[0] || 'physical';
    d.max = Math.max(1, d.stat.life); d.maxEs = d.stat.es;
    if (fresh) { d.life = d.max; d.es = d.maxEs; }
    d.sig = ''; d.wind = null;
  }
  function place(x, z, m = tpl.mon, level = tpl.level) {
    if (!m) return null;
    if (dummies.length >= MAXE) { toast(t('The scene holds up to {0} enemies', MAXE)); return null; }
    const fig = makeDummy(fx, { kind: m.category, scale: m.boss ? 1.45 : 1 });
    fig.group.position.set(x, 0, z); fig.group.rotation.y = Math.atan2(pp.x - x, pp.z - z); scene.add(fig.group);
    const d = { fig, pos: fig.group.position, home: { x, z }, aggro: false, mon: m, sc: fig.scale, st: {}, burn: {}, frz: 0, brk: 0, flam: [], bar: {}, lock: {}, imm: {}, calm: 0, mag: {}, curse: null, mark: null, dots: [], impales: [], slows: [], dead: false, corpse: 0, back: 0, fall: 0,
      flash: 0, wob: 0, lunge: 0, tick: rnd(.5), ph: rnd(TAU), sig: '', by: null, expo: null, wind: null, wait: rnd(.6, 1.2) };
    arm(d, level, tpl.attack); dummies.push(d);
    fx.ring(d.pos, 1.3 * d.sc, .3, 'gold', .4, { a: .6 });
    fx.emit(12, { p: { x, y: .2, z }, r: .5, v: 1, up: 1, life: .6, size: .5, grow: 2, c: 'dust', smoke: true, a: .35 });
    hudT = 0; return d;
  }
  // what an enemy carries from the fight: states, ailment bars, curse and mark, damage over time
  const clean = d => { d.impales = []; d.burnX = null; d.slows = []; d.gm = d.riven = d.erod = d.spears = d.rfc = d.spectral = null; d.blood = 0; d.dazed = d.smelt = d.attr = d.vile = d.wasting = d.inc = d.halt = d.crushed = d.intim = 0; d.agony = null; d.weak = []; d.shards = null; d.pustule = null; d.st = {}; d.burn = {}; d.dots = []; d.curse = d.mark = d.hexes = d.focusMax = d.mag2 = d.burn2 = d.gaps = null; d.frz = d.brk = 0; d.flam = []; d.bar = {}; d.lock = {}; d.imm = {}; d.mag = {}; d.cut = 0; };
  const restore = d => {
    const f = d.fig; d.pos.set(d.home.x, 0, d.home.z); d.aggro = false; d.dead = false; d.life = d.max; d.es = d.maxEs; d.fall = d.corpse = d.back = d.lances = d.ignSec = 0; d.by = null; d.sig = ''; d.wind = null; d.wait = rnd(.6, 1.2);
    clean(d);
    f.upper.rotation.set(0, 0, 0); f.group.visible = f.plate.visible = true;
  };
  function wipe() { dummies.forEach(d => d.fig.dispose()); dummies = []; hudT = 0; }
  function heal() { const c = sheet(); me.maxL = c.life || 0; me.maxE = c.es || 0; me.maxM = c.mana || 0; me.life = me.maxL; me.es = me.maxE; me.mana = me.maxM; me.rage = me.boast = me.rhythm = me.fervour = me.finality = 0; me.hexes = me.prev = me.whisp = me.drain = null; me.manaLog = null; me.armCut = me.armBroken = 0; me.hurt = -9; me.widow = 0; me.esHurt = me.esRech = null; me.ward = me.maxW = c.ward || 0;
    Object.assign(me, { wounds: [], slams: 0, owls: 0, owlT: 0, mount: 0, mountUntil: 0, flame: 0, vol: 0, volPower: null, jade: 0, jadeIn: null, seeds: 0, locust: 0, pinn: null, iron: 0, heat: 0, angAt: time, requiem: 0, fpAt: null, sight: 0, kaom: null, calamity: null, chayula: null, demon: null, rifts: [], incs: [], bark: [], arctic: 0, wind: 0, travAt: {}, voltAt: {}, st: {}, mag: {}, burn: {}, flam: [], leech: noLeech(), bar: {}, lock: {}, stuns: [], fl: [null, null], drink: [], cc: [null, null, null], cu: [], guard: 0, quill: undefined, runes: [], mimics: [], fuel: {}, fuelAt: {}, inf: {}, infUsed: -99, glory: {}, gloryAt: {}, aff: { fire: 0, cold: 0, lightning: 0 }, affAt: {}, sealAt: {} }); }
  // Rage (calc.js rageOf): Berserk's part only while it is on; gaining any holds off its loss for the delay
  const shifted = () => (me.form || me.demon) && sheet().shift;   // the tree's while Shapeshifted (calc.js recovery shift)
  const rageMax = () => { const R = sheet().rage; return R?.base ? R.base + (R.berserk && tog[R.berserk.name] ? R.berserk.max : 0) + (shifted()?.rage || 0) + (time - (me.gloryUsed ?? -99) <= 20 ? R.glory || 0 : 0) : 0; };   // the tree's more if you used a Glory skill in the last 20 s
  // Rage gained at its most builds Glory (Walking Calamity), one per Rage: note: the data gives no rate
  const spendEmp = E => !(Math.random() * 100 < (sheet().empKeep || 0) + (E.keep || 0)) && --E.uses <= 0;   // an empowered attack used (Serle's Grit, Arctic Howl's quality: its chance not to count)
  // Hateforge on reaching maximum Rage: a random Charge (once every its time), Runic Ward
  const rageFull = () => { const H = sheet().hate; if (H?.cd && time - (me.hateAt ?? -99) >= H.cd) { me.hateAt = time; gainCharge(['frenzy', 'power', 'endurance'][Math.floor(Math.random() * 3)], t('Rage')); } if (H?.ward && me.maxW) me.ward = Math.min(me.maxW, me.ward + me.maxW * H.ward / 100); };
  function gainRage(n) { const M = rageMax(); if (!(n > 0) || !M) return; if (me.rage < M && me.rage + n >= M) rageFull(); const over = Math.max(0, me.rage + n - Math.max(M, me.rage)); me.rage = Math.min(M, me.rage + n); me.raged = time; if (over) for (const S of gloryOf()) if (S.name === 'Walking Calamity') gloryAdd(S, over); if (me.rage >= M && sheet().loseRage) me.rage = 0; }   // Hateforge: all of it lost at the top
  // your death, by an enemy or by your own life loss: everything restored
  function died(by) { stats.deaths++; player.fall(); say(t('{0} killed you', by), 'blood'); toast(t('You died: life and energy shield restored')); fx.ring(pp, .3, 2.6, 'blood', .5); heal(); me.safe = 2; }
  function reset() {
    objs = objs.filter(o => o.keep || (o.remove(), false));
    grounds.forEach(g => g.decal.remove()); grounds = [];
    hazards.forEach(h => h.decal.remove()); hazards = [];
    divine.forEach(f => f.dec.remove()); divine = [];
    frags.forEach(f => f.dec.remove()); frags = [];
    timers = []; empower = []; buffs = []; fissures = []; surges = []; archonAt = -Infinity; charge = held = move = null; for (const m of bst) fx.drop(m); bst = []; pp.y = 0; me.pup = []; me.uarch = me.uarchOff = -9;
    for (const k in charges) charges[k] = 0;
    stats.kills = stats.dealt = stats.taken = stats.deaths = 0; clog = []; byS = {}; lastHit = null; dummies.forEach(restore); heal(); hudT = 0;
  }
  const nearest = (p, n, ok) => dummies.filter(e => !e.dead && ok(e)).sort((a, b) => dist(a.pos, p) - dist(b.pos, p)).slice(0, n);   // the n living enemies nearest p
  function near(p, r, ok) {
    let best = null, bd = r;
    for (const d of dummies) if (!d.dead && (!ok || ok(d))) { const k = dist(d.pos, p); if (k <= bd) { bd = k; best = d; } }
    return best;
  }
  const inside = (c, R) => dummies.filter(d => !d.dead && dist(d.pos, c) <= R + SIM.body * d.sc);
  const has = (d, s) => s === 'curse' ? !!d.curse : s === 'mark' ? !!d.mark
    : s === 'immobilised' ? ['freeze', 'stun', 'electrocute', 'pin'].some(k => d.st[k] > 0) : d.st[s] > 0;
  const markOff = d => { const M = d.mark; d.mark = null; trigger(M.S, 'mark', d); if (M.bomb) bombed(M, d.pos); };   // a Mark activated
  const uniqueMore = (d, pct) => d.stat.rarity === 'unique' ? 1 + (pct || 0) / 100 : 1;   // a "more if created from a Unique" stat
  const consume = (d, S, s) => { clear(d, s); d.imm[s] = IMMUNE; pay(d, S, s, true); };   // a state consumed
  const clear = (d, s) => { if (s === 'curse') d.curse = d.hexes = null; else if (s === 'mark') d.mark = null; else d.st[s] = 0; };
  const chest = d => V(d.pos.x, 1.2 * d.sc, d.pos.z);
  const over = d => ({ x: d.pos.x, y: 2.05 * d.sc + 1.05, z: d.pos.z });   // above the name plate
  // floating number of what a hit or a tick removed
  const floatN = (d, n, el, o = {}) => {
    if (Math.round(n) < 1) return;
    fx.num({ x: d.pos.x + rnd(-.25, .25), y: (o.low ? 1.25 : 1.7) * d.sc, z: d.pos.z }, (o.sim ? '~' : '') + short(n) + (o.crit ? '!' : ''), NUMC(el), o.crit ? .64 : o.low ? .34 : .46, !!o.crit);
  };

  // ---------- combat rules
  const maxC = c => sheet().charges?.[c] || 0;   // the build's maximum (calc.js character())
  // a charge a skill grants, with its supports' chance of one more (Charge Profusion: "when you gain a Charge")
  function chargeBy(type, S) {
    gainCharge(type, S.label); const M = S.dmg?.more || {};
    if (Math.random() * 100 < (sheet().more1?.[type] || 0)) gainCharge(type, S.label);   // Thirst for Power / Endurance
    if (Math.random() * 100 < M.one) gainCharge(type, S.label);
    if (Math.random() * 100 < M.random) gainCharge(['frenzy', 'power', 'endurance'][Math.floor(Math.random() * 3)], S.label);
    // Empowered Sparks: a power charge generated empowers your next attacks to trigger its Sparks (no expiry in the data)
    const E = type === 'power' && S.dmg?.trig?.find(T => T.stats?.support_empower_X_attacks_with_spark_on_power_charge_gain), X = E && S.dmg.trig.find(T => T.support === E.support && T.hits?.lightning);
    if (X) { const A = asTrig(S, X); empower = empower.filter(e => e.type !== 'spark'); empower.push({ type: 'spark', uses: E.stats.support_empower_X_attacks_with_spark_on_power_charge_gain, X: A, label: A.label, name: S.name, el: 'lightning' }); }
  }
  // Combo now: lost after the delay without gaining any, the longest among your skills that count it (Tempest Bell's own
  // 8 s, a support's 4 or 6 s, longer with Flow), whichever skill built it
  const comboNow = () => time - (me.comboAt ?? -99) > (api.build().gems.reduce((m, g, j) => Math.max(m, base(j)?.dmg?.combo?.decay || 0), 0) || 4) ? 0 : me.combo || 0;
  // Arcane Surge: its increased cast speed (useTime) and more mana regeneration (vitals), by its effect on you
  const surge = () => { const A = sheet().arcaneSurge; return time < me.surgeUntil || A?.always ? (A?.effect || 1) + (A?.missing || 0) * Math.floor(Math.max(0, 1 - me.mana / (me.maxM || 1)) * 10) / 100 : 0; };
  function arcaneSurge(s) {
    if (!(s > 0)) return; me.surgeUntil = Math.max(me.surgeUntil || 0, time + s);
    setBuff({ label: api.info({ name: 'Arcane Surge' })?.label || 'Arcane Surge', name: 'Arcane Surge', c: css('arcane'), s: me.surgeUntil - time });
  }
  // Resonance: each kind of charge gained as the next one; Conduit: allies in your Presence get it instead (theirs are
  // not played: you get none), only Endurance with the Mercenary notable
  const RESONANCE = { frenzy: 'power', endurance: 'frenzy', power: 'endurance' };
  function gainCharge(type, by) {
    if (sheet().resonance) type = RESONANCE[type] || type;
    if (sheet().conduit === 'all' || sheet().conduit === 'endurance' && type === 'endurance') return;
    if (type === 'power' && time < me.noPower) return;   // Flicker Strike: none gained during it
    chargeAt[type] = time;   // gaining one refreshes them all
    if (charges[type] >= maxC(type)) return;
    charges[type]++;
    if (type === 'power' && charges.power >= maxC('power') && sheet().redflare) { charges.power = 0; me.powerLost = time; return suffer('shock', 4, { mag: GC.BaseShockMagnitude }); }   // Redflare Conduit: at the most, all lost and Shocked 4 s
    if (charges[type] < maxC(type) && Math.random() * 100 < (sheet().chargeMore?.[type] || 0)) charges[type]++;   // the chance of one more
    if (Math.random() * 100 < (sheet().chargeFill?.[type] || 0)) charges[type] = maxC(type);   // the chance of all of them
    fx.glow({ x: pp.x, y: 1.5, z: pp.z }, 1.8, CHC[type], .45);
    say(t('+1 {0} charge ({1})', t(CHARGE[type]), by), CHC[type]);
  }
  // n: damage in life points, already past the enemy's armour and resistances. Energy shield first, then life.
  // noEs: bleeding and poison, which bypass energy shield (keywords.json)
  function damage(d, n, S, quiet, noEs) {
    if (d.dead || !(n > 0)) return;
    if (d.visage) { d.flash = .18; return damage(d.visage, n * d.share / 100, S, quiet, noEs); }
    const got = Math.min(n, d.life + (noEs ? 0 : d.es)), src = S?.label || '?', B = byS[src] ||= { n: 0, x: 0 };
    stats.dealt += got; B.n += got; B.x++; lastHit = d; record('hit', src, d.mon.name, got, css(S?.el || 'physical'));
    d.flash = .18; if (!quiet) d.wob = Math.min(1, d.wob + .25 + 2 * Math.min(1, n / (d.max + d.maxEs)));
    const e = noEs ? 0 : Math.min(d.es, n); d.es -= e; d.life -= n - e;
    if (d.life <= 0) { ash(d, -d.life, S); const TO = S?.src !== 'trample' && sheet().uEv?.overkill; if (TO) for (const e of inside(d.pos, 2)) if (e !== d) damage(e, takes(e, 'physical', -d.life * TO / 100), { ...S, src: 'trample' }); kill(d, S, quiet); }   // Trampletoe: its share of the overkill as physical within 2 m
  }
  // Herald of Ash: an attack (not a herald's) that overkills an enemy by its share of its maximum life explodes there,
  // its area Burning the other enemies in it for its share of the overkill per minute, for its duration
  function ash(d, over, S) {
    const H = S?.P?.attack && S.src !== 'herald' && onS('Herald of Ash'), st = H && H.dmg.stats;
    if (!st || over < d.max * st['herald_of_ash_overkill_threshold_%'] / 100) return;
    const p = { x: d.pos.x, z: d.pos.z }; pop(p, H.A, 'fire'); say(t('{0} explodes on the kill', H.label), 'fire');
    for (const e of inside(p, H.A)) if (e !== d) {
      const v = { s: durOf(H), name: H.name, label: H.label, S: H, el: 'fire', dps: takes(e, 'fire', over * st['herald_of_ash_burning_%_overkill_damage_per_minute'] / 100 / 60, false) };
      const o = e.dots.find(x => x.name === H.name); if (o) Object.assign(o, v); else e.dots.push(v);
    }
  }
  function pay(d, S, s, consumed) {
    const c = PIP[s];
    fx.ring(d.pos, .2, 1.6, c, .4); fx.emit(18, { p: chest(d), v: 4, up: 2, life: .5, size: .2, c, c2: 'white', drag: 1.5 });
    fx.text(over(d), (consumed ? '− ' : '+ ') + t(STATE[s]), css(c));
    say(consumed ? t('{0} consumes {1}', S.label, t(STATE[s])) : t('{0} hits harder: {1}', S.label, t(STATE[s])), c);
  }
  // One hit of the skill context S on the enemy d. o: { mult, noPay }
  // The number is the skill's own damage (calc.js) rolled between its minimum and maximum, with its crit chance, after the enemy's
  // armour and resistances, times what the skill's stats give: a consumed state, more damage against a state, charges spent.
  // A multiplier of the scene (stages, channelling, a consumed state the data gives no number for) marks it "~", like the hits
  // whose damage the data does not give (minions, totems, an attack without a weapon...): those take 1/8 of the pool.
  const falloff = d => accLoss(dist(pp, d.pos));   // accuracy's loss with distance (calc.js accLoss)
  function hit(d, S, o = {}) {
    if (d.dead) return false;
    const FF = S.dmg?.stats?.[FROSTFLAME];   // Frostflame Nova: its wave touches only the Ignited, and deals them no damage (afflict)
    if (FF != null && !(d.st.ignite > 0)) return false;
    if (S.dmg?.stats?.['time_rip_damage_share_%']) ripVisage(d, S);
    // Temper Weapon: an Empowered attack Combusts on its first hit (its chance): its own hit, fire, in its area around the enemy
    const CB = S.combust; if (CB && !CB.done && Math.random() * 100 < CB.T.dmg.stats['imbue_weapon_combust_trigger_chance_%']) { CB.done = true; const c = { x: d.pos.x, z: d.pos.z }; later(.05, () => boom(c, CB.T.A, CB.T)); }
    d.aggro = true;   // hit, it comes at you
    // a gem with no hits of its own hits with the skill laid over it (calc.js hitAs: Temper Weapon's Combust, Volcanic Steps)
    const P = S.P, D = S.dmg && !Object.keys(S.dmg.hits || {}).length && S.dmg.hitAs || S.dmg, own = !APPROX.has(S.src), A = own ? D?.ail : null;
    const real = own && !!D && Object.keys(D.hits).length > 0, raw = {};
    let overHit = 0;   // Amazon: a share of the chance to hit over 100% as critical hit chance
    if (own && (D ? D.attack : P.attack) && !A?.alwaysHit) {   // attacks roll your accuracy against its evasion; spells always hit
      // player attacks lose accuracy with distance (falloff), from you to the target; not your minions' and totems' own attacks
      // the tree's increased accuracy in a state and its accuracy against Bleeding enemies: your own attacks'
      const c = sheet(), mine = !/minion|totem/.test(S.src), far = mine ? falloff(d) : 0, accIn = mine ? (c.accWhen || []).reduce((t, w) => t + (condN(w.cond, d, S) ? w.val : 0), 0) : 0;
      const acc = (c.accuracy + (mine && c.accBleed && has(d, 'bleed') ? c.accBleed : 0)) * (S.accX || 1) * (1 + (banner('banner_accuracy_+%') + (shifted()?.acc || 0) + (c.accCrit || 0) * (D?.crit || 0) / 100 + accIn) / 100 / (c.accuracyInc || 1)) * (1 - far * (c.accuracyFalloff || 0) / 100);
      const evNow = d.stat.evasion * (d.st.maim > 0 ? 1 - MAIM.evasion / 100 : 1) * (d.st.blind > 0 ? 1 - blindLess() / 100 : 1) * (c.hazEvasion && time - (d.hazAt ?? -99) <= RECENT ? Math.max(0, 1 + c.hazEvasion / 100) : 1);   // Shredding Contraptions: of the enemies your Hazards affected recently
      if (acc > 0 && c.critFromHit) overHit = Math.max(0, hitRaw(acc, evNow) - 100) * c.critFromHit / 100;
      const DZ = d.dazed > time && S.g?.supports?.includes('Dazzle'); if (DZ) later(0, () => { d.dazed = 0; });   // Dazzle: it always hits a Dazed enemy, and Consumes the Daze
      const NE = c.noEvade, sure = DZ || NE?.heavy && d.st.stun > 0 || NE?.pin && d.st.pin > 0;   // the tree's: Heavy Stunned or Pinned enemies cannot evade your hits
      if (acc > 0 && d.stat.evasion > 0 && !sure && !(D?.sum?.cannot_miss_against_full_life_enemies && d.life >= d.max) && Math.random() * 100 >= playerHitChance(acc, evNow)) { fx.text(over(d), t('Miss'), '#9a968c', .3); return false; }   // Heightened Accuracy II: never on full life
    }
    if (S.spear && !S.src && sheet().lances) d.lances = Math.min(30, (d.lances || 0) + 1);   // Atziri's Contempt: a Bloodstone Lance, up to 30 (note: its text)
    // m: the scene's multipliers; g, gp: the game's (on the whole hit, on its physical part); stunX: the consumed state's stun
    let riven, m = (o.mult ?? 1) * S.mult, g = S.gm ?? 1, gp = 1, stunX = (o.stunX ?? 1) * (S.stunX || 1);
    if (real && !S.src && me.hexes) g *= Math.max(0, 1 + onMe(C => C.damage) / 100);   // a curse on you (Enfeeble): less damage dealt
    // Kulemak's Sovereignty: your hits 1% more per 2 total Power of your Undead minions (a minion's is a normal monster's)
    const KU = !S.src && sheet().kulemak; if (KU) g *= 1 + Math.floor(objs.filter(x => x.minion && x.undead && !x.dead).length * POWER.normal / KU) / 100;
    const FH = S.first && !S.first.has(d) && D?.stats?.['eye_of_winter_first_hit_damage_+%_final'];   // Eye of Winter: each enemy's first hit of the use
    if (FH) { S.first.add(d); g *= 1 + FH / 100; }
    if (d.erod?.until > time) g *= 1 + d.erod.taken / 100;   // an Electrocuting Rod's increased damage taken
    const WB = !S.src && D?.stats?.['wind_blast_damage_+%_final_from_distance']; if (WB) g *= 1 + WB * Math.min(1, Math.max(0, (4 - dist(d.pos, pp)) / 2.5)) / 100;   // Wind Blast's quality: its more within 1.5 m, down to none at 4 m (its text)
    const WM = d.mark?.wolf; if (WM) g *= 1 + Math.min(WM.cap, WM.per * [pp, ...objs.filter(o => o.minion && !o.dead).map(o => o.pos)].filter(p => dist(p, d.pos) <= 6).length) / 100;   // Predator's Mark: per its enemies within 6 m (you and your minions; its text), up to its cap
    const ESP = D?.stats?.['earthshatter_damage_+%_final_per_spike']; if (ESP) g *= 1 + ESP * objs.filter(o => o.earth && !o.dead && o.name === S.name).length / 100;   // Earthshatter's quality: more per spike of it
    if (real && D.attack && S.src !== 'minionHit') g *= rageX(D);
    if ((sheet().parrySpell ? P?.spell : D?.attack) && time < d.parried?.until) g *= 1 + d.parried.more / 100;   // Parried (Nocturne: more Spell damage taken instead)
    if (real && !S.src && sheet().uEv?.soulHit && openWeak(d)) eatSoul();   // The Master's Reach: a Soul when you Hit an enemy with an Open Weakness
    if (real && D.offhand && sheet().runefather?.off) d.rfc = true;   // Eyes of the Runefather: off-hand Hits inflict Runefather's Challenge
    // Savage Fury, while on and not in its frenzy: Fury on an attack's hit, once per use, up to its most
    const SF = !S.src && P.attack && !S.wildGot && tog['Savage Fury'] && !(time < me.wildUntil) && onS('Savage Fury')?.dmg.stats;
    if (SF) { S.wildGot = true; me.wild = Math.min(SF.wild_beast_maximum_energy, (me.wild || 0) + SF.wild_beast_energy_per_hit); }
    // His Winnowing Flame: its sweep consumes an enemy's Ignite for its pillars of flame (up to its most per use), each that
    // share of the Ignite's remaining damage as fire. note: the pillar's area is not in the data (the enemy alone), nor
    // an aggravated Ignite's extra pillars
    const WF = !S.src && D?.stats?.unique_pillar_of_flame_consume_ignite_to_create_X_pillars, WS = WF && SK.skills[S.name]?.part;
    if (WS && d.st.ignite > 0 && (S.pillars = (S.pillars || 0) + WF) <= D.stats.flame_pillar_unique_maximum_pillars_per_skill_use) {
      const n = (d.burn.ignite?.dps || 0) * d.st.ignite * WS['unique_flame_pillar_fire_damage_equal_to_%_of_remaining_ignite_damage'] / 100, c = { x: d.pos.x, z: d.pos.z };
      clear(d, 'ignite'); fx.pillar(c, .4, 2.6, 'fire', .5, 1); later(.1, () => lifeBlast(c, 0, S, 'fire', n));
    }
    if (!o.noPay) {
      const C = A?.consume || {}, uniq = d.stat.rarity === 'unique';
      for (const s of new Set([...P.consumes, ...Object.keys(C)])) if (has(d, s)) {
        consume(d, S, s);
        const c = C[s];
        // High Velocity Rounds: against Fully Broken Armour its own stronger damage (its part), and Riven Armour for its duration
        const RV = s === 'armour' && D?.parts?.HighVelocityRoundsArmourBrokenPlayer;
        if (RV) { g *= RV.avg / D.avg; riven = RV.stats; continue; }
        if (!c) { m += SIM.consume; continue; }
        g *= 1 + ((c.any || 0) + (c[uniq ? 'unique' : 'non_unique'] || 0)) / 100; stunX *= 1 + (c.stun || 0) / 100;
      }
      if (A) { for (const [s, pct, u, phys] of A.vs) if (has(d, s) && (u == null || u === uniq)) { if (phys) gp *= 1 + pct / 100; else g *= 1 + pct / 100; } }
      else for (const s of P.bonus) if (has(d, s)) { m += SIM.consume / 2; pay(d, S, s, false); }
    }
    if (real && !S.src && (S.name === 'Detonate Living' && !d.dead && underCull(d, S) ? detonate(d, S) : cull(d, S))) return true;
    const M = d.mark;
    fx.emit(5, { p: chest(d), v: 2.5, up: 1, life: .3, size: .12, c: S.el, c2: 'white', drag: 2 });
    let total = 0, top = S.el, best = 0, crit = false;
    // Witchhunter: enemies have Focus, a share of their maximum life, your hits drain it; No Mercy: up to its more
    // damage by the share of Focus they miss
    const FO = !S.src && sheet().focus; if (FO && d.focusMax == null) d.focusMax = d.focus = d.max * FO.life / 100;
    if (real) {
      // a mark adds to the critical damage bonus; the buff of a consumed Freezing / Voltaic Mark adds damage as extra cold / lightning
      const W = when(D, d, S);
      const pc = (D.crit || 0) * W.crit * regulate('power', 'charge_mastery_crit_chance_+%_final_with_power_charges') + weakOf(d) + overHit; crit = Math.random() * 100 < pc * (!S.src && time < me.volPower?.until ? 1 + (sheet().volCrit || 0) * me.volPower.n / 100 : 1) * (o.pierced && sheet().critPierce ? 1 + sheet().critPierce * o.pierced / 100 : 1)   // Drillneck: more crit chance per pierce
        * (o.went > 3.5 && D.arrowCrit ? 1 + D.arrowCrit * Math.min(1, (o.went - 3.5) / 3.5) * (D.critW || 1) / 100 : 1);   // Sniper: an arrow's increased crit chance, none within 3.5 metres up to all of it at 7 (as Far Shot's)
      if (S.P.spell && !S.src && sheet().spellCritPer) { me.spellCrits = (me.spellCrits || []).filter(at => time - at <= RECENT); W.critBonus *= Math.max(0, 1 + sheet().spellCritPer * me.spellCrits.length / 100); if (crit) me.spellCrits.push(time); }   // Seed of Cataclysm: less bonus per spell crit recently
      // Oracle's Forced Outcome, Inevitable Critical Hits (KeywordPopups): a hit that could crit re-rolls until it does, its less
      // critical damage bonus for each re-roll
      const IC = !crit && pc > 0 && D.sum?.['oracle_hits_eventually_crit_with_critical_strike_multiplier_+%_final_per_failed_roll'];
      if (IC) { let n = 1; while (n < 99 && !(Math.random() * 100 < pc)) n++; crit = true; W.critBonus *= Math.max(0, 1 + IC * n / 100); }
      // Trephina: always a critical hit against a Heavy Stunned enemy; Nebuloch: an attack consumes an Endurance Charge to crit
      if (!crit && D.attack && !S.src) { if (D.sum?.local_always_crit_heavy_stunned_enemies && d.st.stun > 0) crit = true; else if (D.sum?.attack_consume_endurance_charge_to_always_crit && charges.endurance > 0) { charges.endurance--; chargesSpent(1, 'endurance'); crit = true; } }
      if (S.diamond) { crit = true; W.critBonus *= 1 + S.diamond / 100; }   // Cadiro's Gambit's Diamond Arrows
      if (crit) (me.critAt ||= {})[S.name] = time; else me.nonCritAt = time;
      if (crit && D.sum?.critical_strikes_ignore_positive_elemental_resistances) for (const e of ELEM) W.pen[e] = Infinity;   // Invoker: a critical hit ignores non-negative elemental resistances
      // Shocking Leap: the first critical hit of a supported leap's use leaves its Shocked Ground there
      const SL = crit && !S.src && !S.leapt && S.dmg?.sum?.support_shocking_leap_shocked_ground_radius;
      if (SL) { S.leapt = true; ground('shocked', { x: d.pos.x, z: d.pos.z }, SL / 10, S.dmg.sum.support_shocking_leap_shocked_ground_duration_ms / 1000, S); }
      // Pain Attunement: 30% less critical damage bonus on full life, 30% more on low life
      const PAIN = (sheet().pain && S.src !== 'minionHit' ? lowLife() ? 1.3 : me.life >= me.maxL ? .7 : 1 : 1) * (1 - (d.stat?.mods?.['base_self_critical_strike_multiplier_-%'] || 0) / 100);   // and a monster modifier's less critical damage bonus against it
      const cm = crit ? 1 + ((D.critBonus || 0) * W.critBonus * PAIN * (S.src !== 'minionHit' && me.st.shock > 0 ? 1 + (sheet().critShocked || 0) / 100 : 1) + (M?.D?.crit || 0)) / 100 : 1, B = S.src === 'minionHit' ? [] : buffs.filter(b => b.gain && !(b.gain.attack && !S.P.attack)).map(b => b.gain);   // a crit starts Inexorable Critical again
      // The Spring Hare: its chance for your hits' damage to be Lucky (rolled twice, the higher)
      // and the tree's chance for lightning damage to be Lucky
      const mine = !/minion/.test(S.src || ''), LK = mine && (Math.random() * 100 < (D.sum?.['chance_for_extra_damage_roll_%'] || 0) || D.attack && (sheet().luckySurr || D.sum?.attack_damage_is_lucky_if_surrounded) && meIs.Surrounded() || sheet().luckyLow && d.life <= d.max * LOW || sheet().luckyHeavy && d.st.stun > 0), LL = mine && Math.random() * 100 < (D.sum?.['chance_for_extra_damage_roll_with_lightning_damage_%'] || 0), LS = mine && crit && S.P.spell && Math.random() * 100 < (D.sum?.['spell_critical_hit_chance_%_for_lucky_damage'] || 0);   // Seed of Cataclysm: spell damage with critical hits
      const MM = D.attack && D.sum?.local_damage_roll_always_min_or_max;   // Skysliver: the least or the most of each type
      for (const el in D.hits) { const [lo, hi] = D.hits[el]; raw[el] = (lo + (MM ? Math.round(Math.random()) : LK || LS || LL && el === 'lightning' ? Math.max(Math.random(), Math.random()) : Math.random()) * (hi - lo)) * m * g * (el === 'physical' ? gp : 1) * cm * (W.dmg[el] ?? 1); }
      // gained as extra damage of another type against an enemy in a state: of the hit's damage after its modifiers, not
      // scaled again by the other type's (as Unholy Might below)
      for (const [from, to, p] of W.gain) if (raw[from]) raw[to] = (raw[to] || 0) + raw[from] * p / 100;
      if (FO?.mercy && d.focusMax > 0) for (const e in raw) raw[e] *= 1 + FO.mercy * (1 - d.focus / d.focusMax) / 100;
      // Lich: Unholy Might while not on Low Mana, its share of all damage as extra chaos (keywords.json UnholyMight) by
      // its magnitude. note: gained from the hit's damage after its modifiers, not scaled again by chaos modifiers
      const tot = Object.values(raw).reduce((t, x) => t + x, 0);   // both gain from the hit before either
      if (!S.src && time < me.volPower?.until) raw.chaos = (raw.chaos || 0) + tot * me.volPower.n * VOLATILITY.power / 100;   // Volatile Power
      const CO = !S.src && S.P.spell && sheet().coil, nC = CO && [d.curse, ...(d.hexes || [])].filter(Boolean).length;   // Liminal Coil: spells gain as extra chaos / physical per curse on the target
      if (nC) { raw.chaos = (raw.chaos || 0) + tot * CO.chaos * nC / 100; raw.physical = (raw.physical || 0) + tot * CO.phys * nC / 100; }
      const HV = !S.src && raw.cold && d.st.chill > 0 && sheet().heatshiver; if (HV) raw.fire = (raw.fire || 0) + raw.cold * (d.mag.chill || 0) * HV / 100;   // Heatshiver: per 1% Chill magnitude on it
      const LM = meIs.LowMana(), UM = !S.src ? !LM && (sheet().unholy || (time < me.umUntil ? 1 : 0)) : S.src === 'minionHit' && (!LM && (sheet().allyUnholy || (time < me.mumUntil ? 1 : 0)) || sheet().minionUnholy); if (UM) raw.chaos = (raw.chaos || 0) + tot * UNHOLY / 100 * UM;   // Unholy Might (and Necromantic Conduit's for your minions, as though they were in your Presence)
      const MX = /^minion/.test(S.src || '') || isCmd(S) ? (uarch() ? 1 + UARCHON.more * sheet().overgrow.archonEffect / 100 : 1) * (isCmd(S) ? 1 + PUPPET.cmdDmg * pup() / 100 : 1) : 1; if (MX !== 1) for (const e in raw) raw[e] *= MX;   // Archon of Undeath, Puppet Master. note: its increased command damage as more here
      if (time < me.chayula?.until && !S.src) for (const e of ['physical', 'chaos']) if (raw[e]) raw[e] *= 1 + me.chayula.more / 100;   // Archon of Chayula
      if (time < me.unbound?.until && !S.src) for (const e of ELEM) if (raw[e]) raw[e] *= me.unbound.more;   // Unbound
      if (!S.src && openWeak(d)) for (const e in raw) raw[e] *= 1 + sheet().weakness.more / 100;   // Predatory Instinct
      const PA = sheet().perAil, na = PA && ['ignite', 'chill', 'freeze', 'shock', 'electrocute'].filter(a => d.st[a] > 0).length;   // Harness the Elements: per elemental ailment on it (KeywordPopups ElementalAilments)
      if (na) for (const e in raw) raw[e] *= 1 + PA * na / 100 * (D?.incW?.[e] ?? 1);
      if (S.P.spell && !S.src && time < me.earch) { for (const e of ELEM) if (raw[e]) raw[e] *= 1 + EARCHON.more / 100; delete raw.physical; delete raw.chaos; }   // Elemental Archon: no non-elemental spell damage
      if (time < me.pinn?.until) for (const e of ELEM) if (raw[e]) raw[e] *= 1 + me.pinn.more / 100;   // Pinnacle of Power
      // Elemental Conflux: while on, its more damage of its element (confluxLook)
      const EC = S.src !== 'minionHit' && onS('Elemental Conflux');
      if (EC && me.conflux && raw[me.conflux.el]) raw[me.conflux.el] *= 1 + EC.dmg.stats['skill_elemental_conflux_active_element_damage_+%_final'] / 100;
      const SO = S.P.spell && !S.src && objs.find(o => o.soul && !o.dead)?.soul;   // Soul Offering
      if (SO) for (const e in raw) raw[e] *= 1 + SO['power_offering_buff_spell_damage_+%'] * SO._x / 100;
      const CL = d.boils > 0 && D?.sum?.['ascendancy_ritualist_damage_+%_final_vs_enemies_affected_by_blood_boil']; if (CL) for (const e in raw) raw[e] *= 1 + CL / 100;   // Corrupted Lifeforce: more damage against an enemy with Blood Boils
      const DC = S.P.spell && !S.src && sheet().rage?.spellPer2; if (DC) for (const e in raw) raw[e] *= 1 + Math.floor(me.rage / 2) * DC / 100;   // Druidic Champion: more spell damage per 2 Rage
      if (S.P.spell && !S.src && demon()) for (const e in raw) raw[e] *= 1 + demon() * me.demon.st['demon_form_spell_damage_+%_final_per_stack'] / 100;   // Demon Form
      const AF = !S.src && time < me.kaom?.until && me.kaom.S.dmg?.stats?.['gem_quality_ancestral_cry_global_fire_damage_granted_+%_final']; if (AF && raw.fire) raw.fire *= 1 + AF / 100;   // Ancestral Cry's quality: more fire damage while you embody Kaom
      const CM = S.comp && d.mark && sheet().compMarked; if (CM) for (const e in raw) raw[e] *= 1 + CM / 100;   // Sylvan's Effigy: your Companions' increased damage to your Marked targets. note: as a factor
      const VK = !S.src && d.vile >= 1 && sheet().vile; if (VK) for (const e in raw) raw[e] *= 1 + Math.min(200, VK * Math.floor(d.vile)) / 100;   // The Vile Knight: increased hit damage per second, up to 200% (its text's). note: as a factor
      const AT = d.attr >= 1 && attr();   // Attrition
      if (AT) for (const e in raw) raw[e] *= 1 + AT['skill_attrition_hit_damage_+%_final_vs_rare_or_unique_enemy_per_second_ever_in_presence_up_to_max'] * Math.floor(d.attr) / 100;
      // Vorana's Siege: more against an Isolated enemy, none of its allies within 6 m (keywords.json Isolated)
      const VS = S.dmg?.sum?.['support_voranas_siege_hit_damage_+%_final_vs_isolated_enemies'];
      if (VS && !dummies.some(e => e !== d && !e.dead && dist(e.pos, d.pos) <= 6)) for (const e in raw) raw[e] *= 1 + VS / 100;
      // Lightning Conduit: more damage to a shocked enemy, per 5% more damage it takes from the shock
      const LC = has(d, 'shock') && S.dmg?.stats?.['lightning_conduit_damage_+%_final_per_5%_increased_damage_taken_from_shock'];
      if (LC) for (const e in raw) raw[e] *= 1 + LC * (shocked(d) - 1) * 20 / 100;
      if (S.chaosX && raw.chaos) raw.chaos *= S.chaosX;   // Profanity
      if (S.P.attack && !S.src && raw.physical) briarStore(raw.physical);
      const CS = cstaff(S);   // Charged Staff: its added lightning per stack
      if (CS) { const st = CS.S.dmg.stats, lo = st.charged_staff_attack_minimum_added_lightning_damage_per_stack, hi = st.charged_staff_attack_maximum_added_lightning_damage_per_stack; raw.lightning = (raw.lightning || 0) + CS.n * (lo + Math.random() * (hi - lo)) * m * cm; }
      // Trinity: more elemental damage per 30 Affinity of any type (its text; the stat's name says 50); a hit dealing
      // elemental damage gains Affinity of its highest elemental type and loses some of the others
      const TR = !S.src && trinity();
      if (TR) {
        const TC = TR['trinity_%_physical_damage_to_convert_to_random_element_granted'];   // its quality: a share of the physical converted to a random element
        if (TC && raw.physical) { const e = ELEM[Math.floor(Math.random() * 3)], x = raw.physical * Math.min(100, TC) / 100; raw.physical -= x; raw[e] = (raw[e] || 0) + x; }
        const k = 1 + TR['trinity_damage_+%_final_to_grant_per_50_resonance'] * Math.floor((me.aff.fire + me.aff.cold + me.aff.lightning) / 30) / 100, top = ELEM.filter(e => raw[e] > 0).sort((a, b) => raw[b] - raw[a])[0];
        for (const e of ELEM) if (raw[e]) raw[e] *= k;
        if (top) for (const e of ELEM) { if (e === top) { me.aff[e] = Math.min(TRINITY_MAX, me.aff[e] + TR.trinity_resonance_to_grant); me.affAt[e] = time; } else me.aff[e] = Math.max(0, me.aff[e] - TR.trinity_loss_per_hit); }
      }
      // shares of all damage gained as extra damage of a type, each of the damage before any of them: the buffs'; Mantra
      // of Destruction's Empowered attack and its Purple Flames (per stack) as chaos; Mana Tempest, Charged Shots, Volt
      // Thrill of the Kill, Archmage, Ambrosia and an Electrocuting Arrow's rod (its quality) as lightning
      const MT = empowered(S), TK = S.P.attack && time < me.thrill?.until && me.thrill.X;
      const SG = !S.src && sheet().tides, LF = SG && flasks()[0];   // Sanguine Tides: a hit while the life flask is full
      if (LF && flaskLeft(0) >= LF.max) { const n = Math.floor(LF.max * SG.use / 100); me.fl[0] -= n; me.tides = { pct: n * SG.per, until: time + SG.dur }; }
      const G = [...B, { el: 'chaos', pct: (S.mantra?.pct || 0) + (!S.src && time < me.purple?.until ? me.purple.n * me.purple.pct : 0) },
        { el: 'lightning', pct: (MT ? MT.dmg.stats['non_skill_base_all_damage_%_to_gain_as_lightning_with_spells_from_buff'] : 0) + (S.charged || 0) + (S.breath || 0) + (S.volt || 0) + (TK?.['support_thrill_of_the_kill_buff_grant_%_added_lightning_attack_damage'] || 0)
          + (archmage(S)?.['archmage_all_damage_%_to_gain_as_lightning_to_grant_to_non_channelling_spells_per_100_max_mana'] * Math.floor(me.maxM / 100) || 0) + (S.ambrosia || 0) + (d.erod?.until > time ? d.erod.X : 0) }, { el: 'fire', pct: S.fireGain }, { el: ELEM[Math.floor(Math.random() * 3)], pct: FAERIE.pct * (d.ff?.filter(u => u > time).length || 0) }, { el: 'physical', pct: time < me.tides?.until ? me.tides.pct : 0 }, ...(S.gains || []), { el: 'cold', pct: time < me.verglas?.[S.name]?.until ? me.verglas[S.name].pct : 0 }, { el: 'fire', pct: S.heated && S.dmg.stats['active_skill_all_damage_%_as_fire_if_heat_is_consumed'] }];   // Detonating Arrow's stages
      const all = Object.values(raw).reduce((t, v) => t + v, 0); for (const b of G) if (b.pct) raw[b.el] = (raw[b.el] || 0) + all * b.pct / 100;
      if (crit) gainBuff(S, 'crit');
      if (!S.src) { if (crit) trigger(S, 'crit', d); trigger(S, 'hit', d); harbinger(d, S, false); swarm(d, false); }
      if (!S.src && has(d, 'ignite')) trigger(S, 'ignitedHit', d);
      // Impale: an attack hit extracts the strongest on the enemy, added to its physical damage; a hit may Impale (its
      // number of them) for a share of its physical damage times its magnitude, up to their most on the enemy
      const IP = A?.impale, ph = raw.physical || 0;
      if (D.attack && d.impales.length && !IP?.keep && !(crit && IP?.critKeep)) raw.physical = ph + d.impales.splice(d.impales.indexOf(Math.max(...d.impales)), 1)[0];
      if (ph && (Math.random() * 100 < IP?.chance || crit && IP?.crit)) { d.impales.push(...Array(IP.n).fill(ph * IMPALE.pct / 100 * IP.mag)); d.impales.splice(0, d.impales.length - IMPALE.max); }
      const dealt = {}, TIA = S.src === 'thorns' && Math.random() * 100 < (D.ignoreArmour || 0) || Math.random() * 100 < (D.sum?.['hits_ignore_enemy_monster_physical_damage_reduction_%_chance'] || 0);   // the tree's chance for Thorns to ignore armour; Brutality III's for hits
      const INV = Math.random() * 100 < (D.sum?.['treat_enemy_resistances_as_negated_on_elemental_damage_hit_%_chance'] || 0);   // the tree's chance to treat elemental resistances as inverted
      const ZR = crit && !S.src ? sheet().critIgnoreRes : null;   // Beacon of Azis, Choir of the Storm: your critical hits ignore those resistances
      // Riven Armour (keywords.json RivenArmour): it stores 5% of the physical damage of the hit that inflicts it, before
      // mitigation; your later attack hits on that enemy gain as much added physical damage, and its armour breaks no further
      if (!S.src && S.P.attack && d.riven?.until > time) { raw.physical = (raw.physical || 0) + d.riven.mag; if (d.riven.hits && --d.riven.hits <= 0) d.riven = null; }   // Broken Stance: gone after its hits
      if (riven) d.riven = { until: time + riven.base_skill_effect_duration / 1000, mag: (raw.physical || 0) * riven['exploit_debuff_attack_damage_to_convert_to_magnitude_%'] / 100 };
      // Vaulting Impact: Broken Stance on a Dazed enemy (keywords.json BrokenStance: its share of the hit's physical damage
      // added to your later attack hits), removed after its hits (its quality's more). note: its 60 s duration is not
      // extracted (its "Vs Dazed" stat set's): it lasts until its hits
      // Fangs of Frost: a hit on a Parried enemy Consumes the Parried debuff (its quality: a chance not to) for its frost
      // burst (its part) where it stands and Chilled Ground for that part's duration
      const FoF = !S.src && time < d.parried?.until && D?.parts?.FangsOfFrostBurstPlayer && partOf(S, 'FangsOfFrostBurstPlayer');
      if (FoF) { if (!(Math.random() * 100 < (D.stats['chance_to_not_consume_parried_%'] || 0))) d.parried = null; const c = { x: d.pos.x, z: d.pos.z }; later(0, () => { boom(c, FoF.A, FoF); ground('chilled', c, FoF.A, durOf(FoF), FoF); }); }
      // Electrocuting Arrow: its hit attaches its Electrocuting Rod for its duration (all lightning damage then builds
      // Electrocution; removed when Electrocuted); hits against the target gain its quality's extra lightning, and it
      // takes its Gemling quality's increased damage
      if (!S.src && S.name === 'Electrocuting Arrow') d.erod = { until: time + durOf(S), X: D.stats['electrocuting_arrow_%_damage_gained_as_extra_lightning_on_debuffed_target'] || 0, taken: D.stats['electrocuting_arrow_damage_taken_+%'] || 0 };
      if (!S.src && S.name === 'Pounce' && D.part?.['skill_wolf_mark_damage_taken_+%_per_nearby_enemy']) pounceMark(d, S);
      if (!S.src && S.P.attack) manifest(d);
      if (!S.src && S.P.detonator && d.spears) spearsOff(d, S); else if (!S.src && S.name === 'Rapid Assault') spearheads(d, S);
      const BS = !S.src && D?.part?.broken_stance_hit_limit;
      if (BS && d.dazed > time && !(d.riven?.until > time)) { d.riven = { until: Infinity, hits: BS + (D.stats.broken_stance_hit_limit || 0), mag: (raw.physical || 0) * D.part['exploit_debuff_attack_damage_to_convert_to_magnitude_%'] / 100 }; d.dazed = 0; fx.text(over(d), t('Broken Stance'), css('gold'), .3); }
      const EI = !S.src && has(d, 'immobilised') ? 1 + (shrineOn()?.['tactician_artillery_ballista_aura_damage_+%_final_vs_immobilised_enemies'] || 0) / 100 : 1;   // Siege Ballista's Embankment
      for (const el in raw) { const got = dealt[el] = FF != null ? 0 : takes(d, el, raw[el], true, TIA ? 100 : D?.stats?.['enemy_phys_reduction_%_penalty_vs_hit'], W.pen[el], INV, ZR) * EI; total += got; if (got > best) { best = got; top = el; } }
      // Lightning Conduit consumes the shock it hit: the first consumed, its additional bolts fall among the enemies in its area
      if (LC && !S.src) clear(d, 'shock');
      const LX = LC && !S.src && !S.conduit && S.dmg.stats.lightning_conduit_x_additional_strikes_if_consumed_a_shock;
      if (LX) { S.conduit = true; const L = inside(S.at, S.A); L.length || L.push(d);
        for (let k = 0; k < LX; k++) { const e = L[k % L.length]; later(.1 * (k + 1), () => { if (!e.dead) { fx.bolt(V(e.pos.x, 12, e.pos.z), V(e.pos.x, 0, e.pos.z), S.el, .2, .06, .5); hit(e, { ...S, src: 'conduit' }); } }); } }
      // Font of Blood, Font of Mana: a totem's hit leeches its share of its physical damage to you within its radius
      const FT = /totem/.test(S.src || '') && dealt.physical && S.dmg?.sum;
      if (FT) for (const [r, k, R] of [['life', 'allies_in_font_of_blood_radius_leech_%_of_my_physical_damage_as_life', 'font_of_blood_radius'], ['mana', 'allies_in_font_of_mana_radius_leech_%_of_my_physical_damage_as_mana', 'font_of_mana_radius']])
        if (FT[k] && objs.some(o => o.totemOf && !o.dead && dist(o.pos, pp) <= FT[R] / 10)) leechIn(r, dealt.physical * FT[k] / 100);
      if (!/minion|totem/.test(S.src || '')) { leech(D, dealt, total, d); const BH = sheet().bloodHit; if (BH && dealt.physical) d.blood = (d.blood || 0) + dealt.physical * BH / 100; }   // Atziri's Acuity: its share of your hits' physical damage as Blood Loss
    } else total = (d.max + d.maxEs) / 8 * m * g * shocked(d);
    // a mark that grants a charge (Sniper's Mark) is consumed by your critical hit
    if (M?.gain && d.mark === M && crit && own) {
      d.mark = null; trigger(M.S, 'mark', d); fx.ring(d.pos, .3, 1.5, 'mark', .35);
      say(t('{0} consumes {1}', S.label, M.label), 'mark'); gainCharge(M.gain, M.label);
    }
    floatN(d, total, top, { sim: !real || Math.abs(m - 1) > .001, crit });
    if (!S.src) remnantOn('hit', d, crit);
    if (!S.src && P.attack) { if (P.kind === 'projectile') me.projHit = time; if (P.melee) me.meleeHit = time; }   // for Pursuit and Retreat
    if (!S.src) me.hitAt = time;   // you have hit an enemy recently
    if (!S.src && S.P.spell && Math.random() * 100 < (S.dmg?.sum?.['spells_chance_to_hinder_on_hit_%'] || 0)) d.slows.push({ until: time + HINDER.time * (sheet().hinderTime || 1), pct: -HINDER.slow * slowK(S) });   // the tree's chance to Hinder with spells
    // Rain of Blades: its blades (its chance) fall where the enemy is after its delay, hitting in its area for the attack's
    // damage at its own base multiplier. note: the attack's modifiers are kept (the weapon's base alone is not told apart)
    const RB = !S.src && P.attack && P.kind === 'projectile' && time < me.blades?.until && me.blades.S, RS = RB && RB.dmg.stats;
    if (RB && D && Math.random() * 100 < RS['triggered_rain_of_blades_%']) {
      const c = { x: d.pos.x, z: d.pos.z }, X = { ...S, name: RB.name, label: RB.label, A: RB.A, src: 'blades', dmg: { ...D, hits: scale(D.hits, RS._base_multiplier / (D.stats?._base_multiplier || 10000)), trig: [] } };
      later(RS.rain_of_blades_fall_delay_ms / 1000, () => { pop(c, RB.A, 'dust'); boom(c, RB.A, X); });
    }
    // Crackling Palm, Gelid Palm (Thunderfist): your unarmed melee attack hits call down their bolts (palmBolt)
    if (!S.src && P.attack && P.melee && D?.unarmed) for (const n of ['Crackling Palm', 'Gelid Palm']) { const X = onS(n); if (X) palmBolt(X, d); }
    // Rage: "Only one Hit every 0.5 seconds can cause you to gain Rage" (keywords.json); the tree's gains and the skill's
    // supports' (calc.js onHit); a crit can cost it (Prototype Seventeen); Combo from Strikes; a perfectly timed hit's charge
    const H = real ? D.onHit : null;
    if (!S.src && time - (me.rageHit ?? -9) >= .5) {
      const G = sheet().rage?.gain, n = (P.spell ? 3 * prowess().length : 0) + (G?.hit || 0) + (P.attack ? G?.attack || 0 : 0) + (P.melee ? (G?.melee || 0) + (H ? H.rage + H.ragePct * rageMax() / 100 : 0) : 0);
      if (n > 0) { me.rageHit = time; gainRage(n); if (Math.random() * 100 < (sheet().rage?.fill || 0)) me.rage = rageMax(); }   // the tree's chance to gain all of it
    }
    if (real) { const n = S.src === 'minionHit' ? sheet().gmMinion : !S.src ? S.dmg?.sum?.['chance_to_apply_gruelling_madness_on_hit_%'] : 0; if (Math.random() * 100 < (n || 0)) madness(d); if (!S.src && S.P.attack) madness(d, sheet().gmHit); }   // Gruelling Madness on hit
    if (!S.src && real && crit && S.P.melee && sheet().thornsCrit) later(.02, () => retaliate(d));   // Dreadfist: your Thorns damage to enemies you critically hit with melee
    if (!S.src && real) { const O = sheet(); if (Math.random() * 100 < (O.onsHit || 0)) me.onsUntil = time + ONSLAUGHT.time; if (Math.random() * 100 < (O.powerHit || 0) + (crit ? O.powerCrit || 0 : 0)) gainCharge('power', S.label); }   // uniques' Onslaught and Power Charge on hit
    if (!S.src && real && S.dmg?.attack) { const O = sheet(), PH = O.perHit || {}, pl = (PH.life || 0) + (meIs.CritRecently() ? PH.lifeCrit || 0 : 0) + (d.curse ? PH.lifeCursed || 0 : 0), pm = (PH.mana || 0) + (d.curse ? PH.manaCursed || 0 : 0); if (pl || pm) { me.life = gain(me.life, me.maxL, pl); me.mana = gain(me.mana, me.maxM, pm); }   // The Lethal Draw, Thief's Torment
      if (O.olro) me.olro = [...(me.olro || []).filter(u => u.until > time), { v: pow(d), until: time + 20 }];   // Olrovasara: the enemy's Power for 20 s
      if (Math.random() * 100 < (O.molten || 0)) { const j = api.build().gems.findIndex(g => g.name === 'Molten Shower'); if (j >= 0) later(.05, () => use(j, { at: { x: d.pos.x, z: d.pos.z }, src: 'meta' })); } }   // Brutus' Lead Sprinkler: hits trigger its Molten Shower
    if (!S.src && H) {
      if (crit && H.loseRageOnCrit) me.rage = Math.max(0, me.rage - rageMax() * H.loseRageOnCrit / 100);
      if (S.perfect && Math.random() * 100 < H.perfectEndurance) chargeBy('endurance', S);
      if (D.combo?.strike && !(time < me.finality)) { me.combo = comboNow() + 1 + (D.combo.more || 0) + (Math.random() * 100 < D.combo.extra ? 1 : 0); me.comboAt = time; }
    }
    const full = d.life >= d.max; d.by = S;
    if (full && own && D?.sum?.decimating_strike) { damage(d, d.max * rnd(.05, .3), S, true, true); fx.text(over(d), t('Decimating Strike'), css('physical'), .36); }   // Decimating Strike (KeywordPopups): a hit on a full life enemy removes 5-30% of its life before its damage
    damage(d, total, S);
    if (FO && d.focusMax > 0) { d.focus = Math.max(0, d.focus - total * FO.drain / 100); d.focusAt = time; }
    if (crit && own && S.name !== 'Midnight Zenith') zenith(d);
    if (crit && !S.src && Math.random() * 100 < (sheet().arcaneSurge?.crit || 0)) arcaneSurge(SK.skills['Arcane Surge'].constant.support_arcane_surge_base_duration_ms / 1000);   // the tree's chance (note: the support's duration)
    if (Math.random() * 100 < D?.stats?.['%_chance_to_apply_hounded_by_wisps_on_hit']) d.ff = [...(d.ff || []).filter(u => u > time).slice(1 - FAERIE.max), time + FAERIE.time];   // Azmerian Swarms: a Swarm's hit inflicts Faerie Fire
    if (!S.src && sheet().wasting) d.wasting = time + WASTING.time;   // Grip of Kulemak: Abyssal Wasting on hit
    if (own && !D?.sum?.cannot_inflict_blind && Math.random() * 100 < (S.P.attack ? (D?.stats?.['attacks_chance_to_blind_on_hit_%'] || 0) + (D?.sum?.['attacks_chance_to_blind_on_hit_%'] || 0) : 0) + (D?.sum?.['global_chance_to_blind_on_hit_%'] || 0) + (D?.stats?.['global_chance_to_blind_on_hit_%'] || 0)) { if (!(d.st.blind > 0)) fx.text(over(d), t(STATE.blind), css(PIP.blind), .36); d.st.blind = BLIND.time; }   // Blind (Flash Grenade); not with Blindside
    const UH = own && sheet().uHit, r = p => Math.random() * 100 < p;   // uniques' on hit (Intimidate and Withered for their text's 4 s)
    const UE = own && sheet().uEv;   // uniques: Critical Weakness from spell crits, Volatility on crits, thorns on melee hits
    if (!S.src && crit && sheet().tailwind?.crit && time - (me.tailAt ?? -9) >= 1) { me.tailAt = time; me.tail = Math.min(TAILWIND.max, (me.tail || 0) + 1); }   // The Black Insignia: Tailwind on Critical Hit, once a second
    if (UE) { if (crit && S.P.spell) weaken(d, UE.spellWeak); if (crit && r(UE.volCrit)) gainVol(1); if (S.P.melee && S.P.attack && r(UE.thornsMelee)) retaliate(d); }
    if (!S.src && r(D?.stats?.['inflict_exposure_on_hit_%_chance'] || 0)) expo(d, (S.els || []).filter(e => ELEM.includes(e)));   // Molten Blast's quality: Exposure of its elements
    if (S.src === 'minionHit' && r(sheet().minionWither || 0)) withers(d, 4);   // the tree's: your minions' chance to Wither (for the 4 s its text has elsewhere)
    if (UH) { if (r(UH.intim)) d.intim = Math.max(d.intim || 0, time + 4); if (S.P.spell && r(UH.wither)) withers(d, 4); if (r(UH.fireExpo)) expo(d, ['fire']); if (r(D?.wHit?.daze)) daze(d, DAZE.time, S);
      // Fairgraves' Curse: an attack's hit leaves Spectral Fire for its time (note: a new one keeps what it had absorbed)
      if (S.P.attack && !S.src && UH.spectral && !d.dead) { if (!d.spectral) fx.text(over(d), t('Spectral Fire'), css('fire'), .32); d.spectral = { until: time + UH.spectral / 1000, n: d.spectral?.n || 0, S }; } if (d.st.chill > 0 && r(UH.blindChilled)) d.st.blind = BLIND.time; }
    if (own && S.name === 'Blood Hunt' && !S.src) bloodHunt(S, d);
    // Titan's Crushing Impacts: your hits are Crushing Blows, a Heavy Stun on an enemy Primed for Stun (keywords.json CrushingBlow)
    if (own && D?.sum?.crushing_blow && !/minion/.test(S.src || '') && !SHOCKWAVE[S.name] && (d.bar.stun || 0) >= PRIMED[d.stat.rarity]) { d.bar.stun = 0; d.lock.stun = GC.HeavyStunModifierDuration; inflict(d, 'stun', S, 1, null, { dur: DUR.stun }); }
    if (own && !S.src) { if (SHOCKWAVE[S.name]) wingBlast(S, d); if (S.vb) discharge(S.vb, d); if (P.melee && me.lunar?.until > time) moonbeams(d); }
    if (own && d.curse?.name === 'Repulsion' && S.name !== 'Repulsion' && S.src !== 'repulsion') repulse(d);
    if (d.agony && S.src !== 'agony' && (d.agony.n += total * d.agony.pct / 100) >= d.life) agonyEnds(d);   // Inevitable Agony
    // Shattering Palm: its hit coats the enemies in its area with shards; once they take its threshold of damage, they
    // shatter in its explosion. note: how long the shards last is not in the data, until they shatter here
    if (d.shards && (d.shards.left -= total) <= 0) { const X = partOf(d.shards.S, 'ShatteringPalmExplosionPlayer'); d.shards = null; boom({ x: d.pos.x, z: d.pos.z }, X.A, { ...X, src: 'trigger' }); }
    const SP = !S.src && S.dmg?.stats?.shattering_palm_debuff_damage_threshold;
    if (SP) for (const e of inside(d.pos, S.A)) e.shards = { S, left: SP };
    // Living Bomb: its seed bursts once the damage dealt to the enemy reaches its share of the enemy's ailment threshold
    if (M?.bomb && d.mark === M && S.src !== 'mark' && (M.hits += total) >= d.stat.ail * M.S.dmg.stats['living_bomb_damage_threshold_%_of_ailment_threshold'] / 100) { d.mark = null; trigger(M.S, 'mark', d); later(.05, () => bombed(M, d.pos)); }
    // Fulmination: a use's first hit on a shocked enemy in your Presence also hits the other shocked enemies there, for its
    // less damage. note: its most other enemies is not in the data, all of them here
    const FU = !S.src && !S.fulm && has(d, 'shock') && dist(d.pos, pp) <= sheet().overgrow.r && onS('Fulmination')?.dmg.stats;
    if (FU) { S.fulm = true; for (const e of inside(pp, sheet().overgrow.r)) if (e !== d && has(e, 'shock')) hit(e, { ...S, src: 'fulmination' }, { mult: 1 + FU['skill_wrath_aura_shared_damage_+%_to_other_shocked_enemies_in_presence'] / 100 }); }
    if (!S.src && time < me.chayula?.until && Math.random() * 100 < me.chayula.wither) withers(d, 4);   // its "for 4 seconds"
    // Withering Touch: its chance per 100% of the enemy's ailment threshold dealt as chaos, for its duration
    const WT = !S.src && raw.chaos && S.dmg?.sum?.['withered_on_hit_chance_%_for_every_100%_target_ailment_threshold_dealt_as_chaos_damage'];
    weaken(d, S.dmg?.stats?.apply_X_stacks_of_critical_weakness_on_hit);   // Kelari, the Tainted Sands
    const CR = !S.src && S.dmg?.sum?.support_knights_ferocity_crush_on_hit_ms; if (CR) d.crushed = Math.max(d.crushed || 0, time + CR / 1000);   // Styrn's Ferocity: Crushes on hit
    const AW = !S.src && S.dmg?.stats?.apply_x_wither_on_hit;   // Chaos Bolt: its Withered stacks on hit, for its duration
    for (let k = 0; k < AW; k++) withers(d, S.dmg.stats.active_skill_withered_base_duration_ms / 1000);
    if (WT && Math.random() * 100 < WT * raw.chaos / Math.max(1, d.stat.ail)) withers(d, S.dmg.sum.support_withered_base_duration_ms / 1000);
    if (!S.src) { thornHit(S, d); const H = real ? Object.keys(raw) : S.els; if (D?.attack ?? P.attack) glory(d, 'attack_hit'); if (H.some(e => ELEM.includes(e))) glory(d, 'elemental_hit'); if (H.includes('chaos')) glory(d, 'chaos_hit'); }
    if (d.dead) return true;
    const wasHeavy = d.st.stun > 0;
    if (real) afflict(d, S, raw, { crit, stunX, full }); else for (const a of S.ail) if (!A?.never?.[a]) inflict(d, a, S);
    if (real && !S.src && !wasHeavy && d.st.stun > 0 && sheet().cullHeavy && cull(d, S, true)) return true;   // the tree's: a hit that Heavy Stuns has Culling Strike
    const OX = crit && !S.src && D?.sum?.daze_self_on_critical_hit_for_X_ms; if (OX) { if (!(time < me.dazed)) say(t('Daze'), 'gold'); me.dazed = time + OX / 1000; }   // Overextend: a critical hit Dazes you
    if (crit && d.st.ignite > 0 && Math.random() * 100 < (D?.sum?.['refresh_ignite_duration_on_critical_strike_chance_%'] || 0)) d.st.ignite = Math.max(d.st.ignite, d.full?.ignite ?? DUR.ignite);   // Eternal Flame III: a critical hit refreshes its Ignite
    if (P.dotHit) dot(d, S);
    event('hit', d.pos, S, d); if (P.melee) event('melee_hit', d.pos, S, d); if (crit) { event('crit', d.pos, S, d); if (!S.src) { if (P.melee) expression(d, S); if (P.spell) storm(d, S, raw); } }
    return true;
  }
  // The supports' bonuses that count only under a condition (calc.js when, PoB2's tags), checked on this hit: the
  // enemy's state and life, yours (low life is the game's 35%: DefaultLowStatusThresholdPercent), your charges and
  // Rage, how far it is, how long you stood still or channelled, what you hit recently. A condition the scene does not
  // have (combo, blind...) is not met. Each counts its points (stacks, quarter seconds...) up to the support's own most
  const LOW = (GAME.low_pct ?? 35) / 100;
  // Low Life / Low Mana at the uniques' shares instead, or by the other pool (Serpent's Lesson)
  const TH = () => sheet().thresh || {}, lowLife = () => me.life <= me.maxL * (TH().lowLife / 100 || LOW) || TH().lifeByMana > 0 && me.mana <= me.maxM * TH().lifeByMana / 100;
  const lowMana = () => me.mana <= me.maxM * (TH().lowMana / 100 || LOW) || TH().manaByLife > 0 && me.life <= me.maxL * TH().manaByLife / 100;
  // "Recently refers to the past 4 seconds" (keywords.json); the crossbow bolts reloaded and the skills used lately
  const RECENT = 4, reloads = [], used = [], reloaded = secs => reloads.reduce((t, r) => t + (time - r.t <= secs ? r.n : 0), 0);
  const minionsNear = () => objs.filter(o => o.minion && !o.dead && dist(o.pos, pp) <= sheet().overgrow.r).length;   // your minions within your Presence
  const inPresence = ok => objs.some(o => !o.dead && ok(o) && dist(o.pos, pp) <= sheet().overgrow.r);   // a minion of yours within your Presence
  const vsAil = (A, a, w, d, S) => (A.ailVs || []).reduce((m, [x, y, on, k]) => x === a && y === w && condN({ actor: 'enemy', var: on }, d, S) ? m * k : m, 1);
  function condN(c, d, S) {
    const v = c.var, en = c.actor === 'enemy', st = k => has(d, k), lifeK = x => x.life / Math.max(1, x.max);
    const hind = en && !!d.slows?.some(x => x.until > time && x.pct < 0);
    const is = en ? { LowLife: lifeK(d) <= LOW, FullLife: d.life >= d.max, Frozen: st('freeze'), Bleeding: st('bleed'), Poisoned: st('poison'), Ignited: st('ignite'), Burning: st('ignite'),
      Shocked: st('shock'), Chilled: st('chill'), Electrocuted: st('electrocute'), Pinned: st('pin'), Maimed: st('maim'), Blinded: st('blind'), Immobilised: st('immobilised'), HeavyStunned: st('stun'),
      Ailing: ['ignite', 'chill', 'freeze', 'shock', 'electrocute', 'poison', 'bleed'].some(st), ArmourFullyBroken: st('armour'), Dazed: d.dazed > time,
      Stunned: st('stun') || d.lstun > time, Unique: d.stat.rarity === 'unique', RareOrUnique: ['rare', 'unique'].includes(d.stat.rarity), Hindered: hind,
      Further6m: dist(pp, d.pos) > 6, Within2m: dist(pp, d.pos) <= 2, Marked: !!d.mark, Exposed: d.st.expo > 0, Cursed: !!d.curse, Slowed: st('chill') || st('maim') || hind, Beast: d.mon?.category === 'Beast', Construct: d.mon?.category === 'Construct', Demon: d.mon?.category === 'Demon', Undead: d.mon?.category === 'Undead', ExitedPresenceRecently: time - (d.leftAt ?? -99) <= RECENT, EnteredPresenceRecently: time - (d.enterAt ?? -99) <= RECENT, InPresence: dist(pp, d.pos) <= sheet().overgrow.r, Humanoid: d.mon?.category === 'Humanoid' }
      : { FullMana: me.mana >= me.maxM * .9,   // Zenith: "above 90% of your Maximum Mana"; the rest of your states: meIs
        FullEnergyShield: me.maxE > 0 && me.es >= me.maxE, HaveMaximumRage: rageMax() > 0 && me.rage >= rageMax(), Moved2m: (S.moved || 0) >= 2,
        Stationary: (S.still || 0) > 0, Channelling: !!charge, EnemyHigherLifePercent: lifeK(d) > me.life / Math.max(1, me.maxL),
        HitProjectileRecently: time - (me.projHit ?? -99) <= (c.secs || RECENT), HitMeleeRecently: time - (me.meleeHit ?? -99) <= (c.secs || RECENT), PerfectTiming: !!S.perfect, ConsumedInfusionRecently: time - me.infUsed <= RECENT };
    const ge = (me.gloryEaten || []).filter(x => time - x.t <= 6);   // the Glory consumed in the last 6 s
    const count = { Rage: me.rage, CursesOnSelf: hexN(), ComboStacks: comboNow(), FrenzyCharge: charges.frenzy, PowerCharge: charges.power, EnduranceCharge: charges.endurance, Charges: charges.frenzy + charges.power + charges.endurance,
      StationarySeconds: S.still || 0, ChannellingTime: charge?.s || 0, PoisonStacks: st('poison') ? 1 : 0, ElementalAilments: EL_AIL.filter(st).length,
      BoltsReloadedPastSixSeconds: reloaded(6), BoltsReloadedPastEightSeconds: reloaded(8), SecondsSinceInevitableCrit: time - (me.critAt?.[S.name] ?? 0),
      DifferentElementalSkillUsedRecently: new Set(used.filter(u => u.elemental && time - u.t <= RECENT).map(u => u.name)).size, MinionPresenceCount: minionsNear(),
      EnduranceConsumedRecently: (me.spentLog || []).reduce((t, x) => t + (x.c === 'endurance' && time - x.t <= RECENT ? x.n : 0), 0),
      GloryConsumedPast6: ge.reduce((t, x) => t + x.n, 0), GlorySkillsUsedPast6: ge.length,
      ComboConsumed: S.comboSpent || 0, HazardsTriggeredRecently: (me.hazTrig || []).filter(t => time - t <= RECENT).length,
      WarcriesRecently: used.filter(u => u.warcry && time - u.t <= RECENT).length, DifferentWarcriesRecently: new Set(used.filter(u => u.warcry && time - u.t <= RECENT).map(u => u.name)).size };
    let n;
    if (c.type === 'ActorCondition' || c.type === 'Condition') n = (v in is ? is[v] : !en && meIs[v]?.()) ? 1 : 0;
    else if (c.type === 'MultiplierThreshold') n = v === 'Rage' && S.enraged || v in count && count[v] >= (c.threshold || 0) ? 1 : 0;
    else if (c.type === 'Multiplier') n = v in count ? Math.floor(count[v] / (c.div || 1)) : 0;
    else if (c.type === 'DistanceRamp') {   // [distance in tenths of a metre, share] points, as PoB2 has them (Longshot: "7m+")
      const x = dist(pp, d.pos) * 10, R = c.ramp; n = x <= R[0][0] ? R[0][1] : R[R.length - 1][1];
      for (let i = 1; i < R.length; i++) if (x > R[i - 1][0] && x <= R[i][0]) n = R[i - 1][1] + (R[i][1] - R[i - 1][1]) * (x - R[i - 1][0]) / (R[i][0] - R[i - 1][0]);
    } else return 0;
    return c.neg ? +!n : n;
  }
  function when(D, d, S) {
    const W = { dmg: {}, crit: S.critX || 1, critBonus: 1, pen: { ...D.pen }, gain: [] };   // Potential's consumed power charge
    for (const w of D.when || []) {
      let n = w.cond.reduce((t, c) => t * condN(c, d, S), 1);
      if (!n) continue;
      const p = w.val * Math.min(n, w.stacks || Infinity), pct = w.cap == null ? p : p < 0 ? Math.max(w.cap, p) : Math.min(w.cap, p);
      if (w.what === 'damage') for (const el in w.w) W.dmg[el] = (W.dmg[el] ?? 1) * (1 + pct / 100 * w.w[el]);
      else if (w.what === 'pen') W.pen[w.el] = (W.pen[w.el] || 0) + pct;   // penetration adds up
      else if (w.what === 'gain') W.gain.push([w.from, w.to, pct]);   // damage of a type gained as extra of another
      else W[w.what] *= 1 + pct / 100 * w.w;
    }
    return W;
  }
  // Leech (keywords.json): a share of the damage the hit dealt (calc.js leech), as if it dealt at most 40,000 with the
  // same ratios, less the monster's leech resistance, recovered over one second (faster with leech rate). Only one
  // instance recovers at a time: a new one is added to what is left (note: how the game joins them is not in the data)
  function leech(D, dealt, total, d) {
    const k = Math.min(1, GAME.leech_max_damage / (total || 1)) * (1 - (d.stat.leechRes || 0));
    const SH = sheet(), ofL = (r, x) => r !== 'life' ? x.of : [...x.of.map(e => e === 'physical' && SH.leechChaos ? 'chaos' : e), ...(SH.leechLightning ? ['lightning'] : [])];   // Spire of Ire: chaos instead of physical; The Ordained: lightning as well
    for (const r of ['life', 'mana']) {
      const SL = r === 'life' && shifted()?.leech || 0, x = D.leech?.[r], n = x && (ofL(r, x).reduce((t, e) => t + (dealt[e] || 0), 0) * x.phys + total * x.all) / 100 * (x.more + SL / 100) * k * (r === 'mana' && SH.manaLeechCrit && meIs.CritRecently() ? 1 + SH.manaLeechCrit / 100 : 1);   // more life leeched while Shapeshifted
      if (!(n > 0) || r === 'mana' && sheet().noManaLeech) continue;   // Lochtonial Caress: no mana leech
      const VP = r === 'life' && sheet().vaal, q = me.leech[r]; q.left += n * (VP ? 1.5 : 1); q.rate = q.left * x.rate * (VP ? .33 : 1); q.keep = r === 'life' && (D.leech.keep || VP);   // Vaal Pact: 50% more, 67% less quickly, not removed on full life
      if (r === 'life' && SH.compLeech) for (const o of objs) { const s = o.companion && !o.dead && o.segs?.[0]; if (s) s.life = Math.min(s.max, s.life + n); }   // the tree's: your Companions leech the same. note: at once here
    }
    // Mark of Siphoning: the enemy it marks has you leech its share of the physical attack damage it takes from your hits
    const MS = D.attack && dealt.physical && d.mark?.S?.dmg?.sum;
    if (MS) for (const r of ['life', 'mana']) { const n = dealt.physical * (MS[`marked_enemies_leech_physical_attack_damage_taken_as_${r}_to_you_permyriad`] || 0) / 10000 * k; if (n > 0) leechIn(r, n); }
  }
  // Damaging ailments deal, per second, a share of the hit that inflicted them (the game's base values: monsters.json constants),
  // after the enemy's resistances. Without that hit (grounds, minions, missing damage) they use the scene value, drawn with "~".
  const AIL_DOT = { ignite: ['fire', ['fire']], bleed: ['physical', ['physical']], poison: ['chaos', ['physical', 'chaos']] };
  function ailDps(d, a, raw, S) {   // Blackflame Covenant: a fire spell's Ignite deals chaos
    const [el0, from] = AIL_DOT[a], el = a === 'ignite' && (S?.dmg?.blackflame || !S?.src && sheet().igniteChaos) ? 'chaos' : a === 'bleed' && !S?.src && sheet().bleedFire ? 'fire' : el0,   /* Blackflame; Blistering Bond */ base = raw ? from.reduce((s, e) => s + (raw[e] || 0), 0) : 0, per = GAME[a + '_per_minute'];
    return base > 0 && per ? { dps: defence(d, el, base * per / 6000, false), raw: base * per / 6000, sim: false, el } : { dps: (d.max + d.maxEs) * SIM.dot / 8, sim: true, el };
  }
  // o (from afflict): the game's duration, magnitude (shock, chill) and effect (damaging ailments) of this one;
  // without it (minions, grounds, skills without damage data) freeze and armour break take the scene's hit counts
  // the supports' buffs of damage gained as extra of an element, on freezing (Ice Bite), killing a shocked enemy
  // (Innervate) or a crit (Blazing Critical, attacks only): calc.js gains
  function gainBuff(S, on) {
    for (const G of S?.dmg?.gains || []) if (G.on === on) {
      const label = api.info({ name: G.name })?.label || G.name;
      setBuff({ label, name: G.name, c: css(G.el), s: G.time, gain: G, sup: true });
    }
  }
  // a support's triggered skill (calc.js trig) as a skill of the scene, its hits scaled where the scene knows its base
  const scale = (hits, f) => Object.fromEntries(Object.entries(hits).map(([e, [lo, hi]]) => [e, [lo * f, hi * f]]));
  function asTrig(S, T, hits = T.hits) {
    const inf = api.info({ name: T.id }), els = Object.keys(Object.keys(hits).length ? hits : T.dot || {}), G = api.geo({ name: T.id, level: S.g?.level || 1, supports: [] });   // with the build's area
    return { ...S, name: T.id, label: inf.label, P: prof({ name: T.id }, inf), G, A: G.radius || SIM.area, dmg: { ...T, hits, trig: [] }, src: 'trigger', el: els.find(e => e !== 'physical') || els[0], els, ail: ailOf(els), mult: 1, gm: 1, spent: 0, stage: null };
  }
  // the explosions supports set off when an enemy dies (calc.js onKill: the triggered skill's own stats), their damage a
  // share of that monster's maximum life, through its resistances: Fiery Death (ignited by the skill, its chance), Bone
  // Shrapnel (killed while pinned), Frozen Spite (killed while frozen: ice fragments that land and burst)
  function deathBlast(d, frozen, S) {
    // the triggered skill as calc has it (a base of 100, through the build's modifiers), scaled to that share of life
    const p = { x: d.pos.x, z: d.pos.z }, blast = (q, key, from, once) => {
      const T = from.dmg.trig.find(t => t.stats?.[key]), x = d.max * T.stats[key] / 1e4, X = asTrig(from, T, scale(T.hits, x));
      boom(q, X.A, { ...X, once });
    };
    for (const T of d.ignBy?.dmg?.onKill || []) if (T['corpse_explosion_monster_life_%'] && d.st.ignite > 0 && Math.random() * 100 < (T['chance_to_trigger_fiery_death_on_ignited_enemy_death_%'] ?? 100))
      later(.05, () => blast(p, 'corpse_explosion_monster_life_%', d.ignBy));
    for (const T of S?.dmg?.onKill || []) {
      if (T['support_bone_shrapnel_physical_damage_equal_to_%_monster_life'] && d.st.pin > 0)
        later(.05, () => blast(p, 'support_bone_shrapnel_physical_damage_equal_to_%_monster_life', S));
      const cold = T['support_frozen_spite_%_enemy_maximum_life_dealt_as_cold_damage'];
      const once = new Set();
      if (cold && frozen) for (let k = 0; k < (T.base_number_of_projectiles || 1); k++) {
        const a = Math.random() * Math.PI * 2, r = rnd(T.ice_fragment_min_chunk_distance || 0, T.ice_fragment_max_chunk_distance || 0) / 10, q = { x: p.x + Math.sin(a) * r, z: p.z + Math.cos(a) * r };
        frag(q, (T.active_skill_base_area_of_effect_radius || 10) / 10, (T.base_skill_detonation_time || 0) / 1000, at => blast(at, 'support_frozen_spite_%_enemy_maximum_life_dealt_as_cold_damage', S, once));
      }
    }
  }
  // A support's triggered skill (calc.js trig: its damage at the supported gem's level) set off by the supported skill,
  // with its own cooldown and stored uses, as its game texts say: Coursing Current chains from the enemy a hit shocks;
  // Static Shocks pulses where it shocked (its pulse delay, duration, area, most targets per pulse and active ones);
  // Electromagnetism consumes the shock of every enemy within its radius when at least that many are shocked there
  // (not already in a rift) for a Shocking Rift: its pulses, interval (faster per shock consumed) and more damage per
  // pulse performed; Volcanic Eruption, on a strike hitting an ignited enemy: its projectiles land around it
  // (min / max distance) and burst (note: their flight time is not in the data, the scene's delayed-impact time);
  // Voltaic Fulmination (Eonyr's Thunder): an enemy killed while electrocuted explodes after its delay, a share of its
  // maximum life (PoB2: corpseExplosionLifeMultiplier) as lightning; Mana Flare: a crit consumes that share of your
  // current mana as fire damage around the enemy; Elemental Discharge: a hit consumes the enemy's ignite, freeze and
  // shock for damage of those elements only. Their base damage scaled from calc.js's (100 for a share, Int for Discharge).
  // Decaying Hex: each enemy a curse curses gets Profane Decay (chaos over time); Corrupting Cry: each enemy a warcry
  // reaches gets that many Corrupted Blood debuffs (up to 10, keywords.json); Battershout: a warcry consumes the Fully
  // Broken Armour of each enemy it reaches for a burst of that share of the broken armour; Haemocrystals: a hit
  // consumes bleeding for crystals around the enemy (up to the most allowed) that burst after their duration, each that
  // share of the bleeding's remaining damage; Charged Mark: a mark that activates leaves Shocked Ground where it was.
  // Smash to Smithereens: a heavy stun triggers its burst around the enemy, its fire breaking armour (its share).
  // Fan the Flames: a hit on an ignited enemy bursts on it and in a cone behind it (note: the cone's angle is not in the
  // data, the scene's own); II spreads that enemy's ignite to the others in it (note: as it burns on the first one).
  // note: Corrupted Blood's debuffs share one duration, refreshed (the game times each one)
  const trigReady = {}, fields = { static: [], rift: [] }, crystals = [];
  // a triggered skill's cooldown and stored uses: false while none is left
  const spend = T => { if (!T.cooldown) return true; const r = trigReady[T.id] = (trigReady[T.id] || []).filter(at => at > time); return r.length < (T.uses || 1) && r.push(time + T.cooldown / 1000) > 0; };
  const KINDS = [['base_number_of_living_lightning_allowed', null], ['shocking_rift_number_of_pulses', 'rift'], ['grounding_shocks_pulse_delay_ms', 'static'],
    ['chance_to_trigger_volcanic_eruption', 'erupt'], ['number_of_chains', 'current'], ['triggered_by_support_electrocute_lineage_%', 'fulminate'],
    ['support_mana_flare_%_of_current_mana_consumed', 'flare'], ['spell_minimum_base_cold_damage_as_%_of_intelligence', 'discharge'],
    ['base_chaos_damage_to_deal_per_minute', 'decay'], ['add_buff_to_target_skill_number_of_corrupted_blood_debuffs_to_inflict', 'cry'],
    ['support_battershout_physical_damage_equal_to_%_of_broken_armour', 'batter'], ['support_haemocrystals_physical_damage_equal_to_%_of_remaining_bleed_damage', 'crystal'],
    ['chance_to_trigger_shocked_ground_on_mark_activated_%', 'charged'], ['trigger_on_heavy_stun_%', 'smash'], ['triggered_by_support_fan_the_flames_%', 'fan']];
  const ON = { rift: 'shock', static: 'shock', current: 'shock', erupt: 'ignitedHit', fulminate: 'electrocuteKill', flare: 'crit', discharge: 'hit',
    decay: 'curse', cry: 'warcry', batter: 'warcry', crystal: 'hit', charged: 'mark', smash: 'heavyStun', fan: 'ignitedHit' };
  const DISCHARGE = { ignite: 'fire', freeze: 'cold', shock: 'lightning' };
  function trigger(S, on, d) {
    if (on === 'mark' && d) weaken(d, S?.dmg?.sum?.apply_X_critical_weakness_on_consuming_mark || 0);   // Deadeye's Bullseye: Critical Weakness on consuming a Mark
    if (on === 'mark' && S?.called && Math.random() * 100 < (SK.skills['Called Shots'].meta_support?.['your_marks_spread_to_a_nearby_enemies_on_consume_%_chance'] || 0)) later(.1, () => { const e = unmarked(d.pos, CALLED.spread)[0]; if (e) markOn(e, S); });
    for (const T of S?.dmg?.trig || []) {
      const ts = T.stats || {}, U = T.support, kind = KINDS.find(([k]) => ts[k])?.[1];
      if (!kind || T.reason && kind !== 'charged' || ON[kind] !== on) continue;   // Charged Mark only leaves ground
      const gone = kind === 'discharge' && Object.keys(DISCHARGE).filter(a => has(d, a));
      if (gone && !gone.length || kind === 'batter' && !has(d, 'armour') || kind === 'crystal' && !has(d, 'bleed')) continue;
      const near4 = kind === 'rift' && dummies.filter(e => !e.dead && !e.inRift && has(e, 'shock') && dist(e.pos, d.pos) <= U.try_consuming_shock_to_trigger_shocking_rift_in_radius_on_shocking_enemy / 10);
      if (near4 && near4.length < U.consume_shock_of_X_enemies_to_trigger_shocking_rift) continue;
      if (!spend(T)) continue;
      me.trigAt = time;   // "if you've Triggered a Skill Recently"
      let f = 1, hits = T.hits;
      if (kind === 'fulminate') f = d.max * (ts.skill_specific_stat_description_mode || 0) / 1e4;
      if (kind === 'flare') { const used = me.mana * ts['support_mana_flare_%_of_current_mana_consumed'] / 100; me.mana -= used; f = used / 100; }
      if (kind === 'batter') { clear(d, 'armour'); f = d.stat.armour * ts['support_battershout_physical_damage_equal_to_%_of_broken_armour'] / 1e4; }
      if (kind === 'crystal') { f = (d.burn.bleed?.dps || 0) * d.st.bleed * ts['support_haemocrystals_physical_damage_equal_to_%_of_remaining_bleed_damage'] / 1e4; clear(d, 'bleed'); }
      if (gone) { for (const a of gone) clear(d, a); hits = Object.fromEntries(gone.map(a => DISCHARGE[a]).filter(e => T.hits[e]).map(e => [e, T.hits[e]])); }
      const X = asTrig(S, T, scale(hits, f));
      const c = { x: d.pos.x, z: d.pos.z }, R = X.G.radius || (ts.active_skill_base_area_of_effect_radius || 0) / 10, dur = sh(X).duration || ts.base_skill_effect_duration / 1000;   // with the build's area
      say(X.label, X.el);
      if (kind === 'fulminate') later((ts.explosion_delay_ms || 0) / 1000, () => boom(c, R, X));
      else if (kind === 'flare' || kind === 'discharge' || kind === 'batter' || kind === 'smash') boom(c, R, X);
      else if (kind === 'decay' || kind === 'cry') {
        const o = d.dots.find(o => o.name === T.id), n = kind === 'cry' ? Math.min(10, (o?.stacks || 0) + ts.add_buff_to_target_skill_number_of_corrupted_blood_debuffs_to_inflict) : 1;
        dot(d, { ...X, mult: n, P: { ...X.P, dur } }).stacks = n;
      } else if (kind === 'charged') ground('shocked', c, R, dur, X);
      else if (kind === 'crystal') for (let k = 0; k < (U.consume_bleed_to_create_X_haemocrystals || 1) + (d.burn.bleed?.agg ? U.haemocrystals_X_additional_crystals_on_consuming_aggravated_bleed || 0 : 0); k++) {   // Haemocrystals: more for an aggravated one
        if (crystals.length >= (U.support_haemocrystals_maximum_allowed_crystals || Infinity)) break;
        const a = Math.random() * Math.PI * 2, r = Math.random() * ts.support_haemocrystals_crystal_creation_radius / 10, q = { x: c.x + Math.sin(a) * r, z: c.z + Math.cos(a) * r };
        crystals.push(q); fx.ring(q, .1, .35, 'blood', .3);
        later(dur, () => { crystals.splice(crystals.indexOf(q), 1); boom(q, R, X); });
      }
      else if (kind === 'current') { const e = near(d.pos, sh(X).chainRange || SIM.chainRange, e => e !== d); if (e) chain(chest(d), e, X, (sh(X).chains || 1) - 1, new Set([d])); }
      else if (kind === 'erupt') for (let k = 0; k < (ts.base_number_of_projectiles || 1); k++) {
        const a = Math.random() * Math.PI * 2, r = rnd(ts.skill_mortar_minimum_projectile_distance, ts.skill_mortar_maximum_projectile_distance) / 10, q = { x: c.x + Math.sin(a) * r, z: c.z + Math.cos(a) * r };
        later(SIM.meteor, () => boom(q, R, X));
      } else if (kind === 'fan') {
        const l = dist(d.pos, pp) || 1, dx = (d.pos.x - pp.x) / l, dz = (d.pos.z - pp.z) / l, from = { x: c.x - dx * .1, z: c.z - dz * .1 }, W = { ...X, kind: 'cone', from, dx, dz, R };
        const B = T.id.endsWith('Two') && d.st.ignite > 0 && d.burn.ignite, left = d.st.ignite;
        K.sweep(W);
        if (B) for (const e of inside(from, R)) if (e !== d && !(e.imm.ignite > 0) && inCone(from, Math.atan2(dz, dx), coneHalf(W), e.pos) && !(e.st.ignite > 0 && e.burn.ignite?.dps >= B.dps)) { e.burn.ignite = B; e.st.ignite = left; }
      } else {   // a field that pulses: Static Shocks, Shocking Rift
        const F = fields[kind], max = ts.maximum_grounding_shocks_allowed || ts.number_of_shocking_rifts_allowed, me2 = { dead: false, in: near4 || [] };
        if (F.length >= max) { const old = F.shift(); old.dead = true; old.in.forEach(e => e.inRift = false); }
        F.push(me2);
        const gap = kind === 'rift' ? ts.shocking_rift_pulse_interval_ms / 1000 / (1 + (ts['shocking_rift_speed_+%_per_shock_consumed'] || 0) * near4.length / 100) : ts.grounding_shocks_pulse_delay_ms / 1000;
        const pulses = kind === 'rift' ? ts.shocking_rift_number_of_pulses : Math.floor((sh(X).duration || ts.base_skill_effect_duration / 1000) / gap);
        if (near4) for (const e of near4) { if (Math.random() * 100 >= (sheet().shockBack || 0)) e.st.shock = 0; e.inRift = true; }   // the tree's chance to reapply it
        const pulse = k => {
          if (me2.dead) return;
          if (k >= pulses) { me2.dead = true; me2.in.forEach(e => e.inRift = false); F.splice(F.indexOf(me2), 1); return; }
          let n = 0; fx.ring(c, .2, R, 'lightning', .3);
          const more = 1 + (ts['shocking_rift_damage_+%_final_per_pulse_performed'] || 0) * k / 100;
          for (const e of dummies) if (!e.dead && dist(e.pos, c) <= R + SIM.body && n < (ts.grounding_shocks_maximum_targets_per_aoe || Infinity) && hit(e, X, { mult: more })) n++;
          later(gap, () => pulse(k + 1));
        };
        pulse(0);
      }
    }
  }
  const AGGRAVATED = 2;   // "100% extra damage" (keywords.json Aggravate)
  const DRAINED = ['ignite', 'chill', 'freeze', 'shock', 'electrocute', 'poison', 'bleed'];   // the ailments Drain Ailments can Consume
  const DERANGE = 'support_shield_sacrifice_damage_over_time_+%_final_per_100_intelligence';
  const FROSTFLAME = 'active_skill_hit_damage_freeze_multiplier_+permyriad_final_per_1%_of_target_ailment_threshold_being_dealt_by_ignite_per_second';
  // the increased Slow Magnitude of the debuffs a skill inflicts (Hinder, Maim, its slowing zones): the tree's and its supports' (Slow Potency)
  // note: not chill, an ailment
  const madness = (d, n = 1) => { if (n > 0) d.gm = { n: Math.min(GRUEL.max, (d.gm?.n || 0) + n), at: time }; };
  const slowK = S => 1 + ((S?.dmg?.sum?.['base_debuff_slow_magnitude_+%'] || 0) + (S?.haz ? S.dmg.sum['hazard_base_debuff_slow_magnitude_+%'] || 0 : 0)) / 100;   // and a Hazard's
  function inflict(d, a, S, k = 1, raw = null, o = null) {
    if (d.dead || d.imm[a] > 0 || sheet().noEleAil && !S.src && ['ignite', 'chill', 'freeze', 'shock'].includes(a)) return;   // Plaguefinger: no elemental ailments of yours
    if (sheet().noImmob && !/minion|totem/.test(S?.src || '') && ['freeze', 'stun', 'electrocute', 'pin'].includes(a)) return;   // The Prisoner's Manacles: cannot Immobilise
    if (a === 'poison' && !S.src && sheet().blindPoison && !S.dmg?.sum?.cannot_inflict_blind) d.st.blind = BLIND.time;   // Murkshaft: Blind when you poison
    if (o) { if (a === 'chill' && d.st.freeze > 0) return; if (a === 'freeze') d.st.chill = 0; }
    else if (a === 'freeze') {   // freeze builds up over several cold hits
      if (d.st.freeze > 0) return;
      d.frz += k * (d.mark?.els.includes('cold') ? 2 : 1);
      if (d.frz < SIM.freezeHits) return;
      d.frz = 0; d.st.chill = 0;
    } else if (a === 'armour') {
      if (d.st.armour > 0 || (d.brk += k) < SIM.breakHits) return;
      d.brk = 0;
    } else if (a === 'chill' && d.st.freeze > 0) return;
    if (AIL_DOT[a]) {   // a real value replaces a simulated one; otherwise the strongest stays
      const v = ailDps(d, a, raw, S), w = d.st[a] > 0 && d.burn[a];
      const CM = !S.src && me.st[a] > 0 && S.dmg?.finals?.['support_ailment_effect_+%_final_while_afflicted_by_relevant_ailment'];   // Commiserate: more magnitude of an ailment you have yourself, which it removes from you
      if (CM) { v.dps *= 1 + CM / 100; me.st[a] = 0; delete me.burn[a]; delete me.mag[a]; }
      if (o?.eff) v.dps *= o.eff;
      const FB = S.stage != null && S.dmg?.stats?.['gem_quality_flameblast_damaging_ailment_effect_per_stage_+%_final']; if (FB) v.dps *= 1 + FB * blast(S) / 100;   // Flameblast's quality: more magnitude per stage
      if (critHit === S) v.dps *= S.dmg.ail?.critAil?.[a] || 1;   // inflicted by a critical hit (afflict)
      // Pathfinder's Overwhelming Toxicity, the tree's "+1 of your Poisons at the same time": two of your poisons at once,
      // the weaker kept with its own time (burn2). ponytail: a third or more counts as the second
      if (a === 'poison' && w && !w.sim && !v.sim && S.dmg?.ail?.noPoisonLimit) d.burnX = [...(d.burnX || []).filter(p => p.until > time), { v: v.dps > w.dps ? w : v, until: time + (v.dps > w.dps ? d.st.poison : o?.dur ?? DUR.poison) }];   // Splinter of Lorrata: every one of its Poisons, each with its own time
      else if (a === 'poison' && w && !w.sim && !v.sim && (S.dmg?.sum?.double_number_of_poison_you_can_inflict || S.dmg?.sum?.number_of_additional_poison_stacks > 0)) { const lo = v.dps > w.dps ? w : v, t = lo === w ? d.st.poison : o?.dur ?? DUR.poison; if (!(d.burn2?.until > time && d.burn2.v.dps >= lo.dps)) d.burn2 = { v: lo, until: time + t }; }
      if (!w || w.sim && !v.sim || w.sim === v.sim && v.dps > w.dps) d.burn[a] = v;
      const CB = a === 'poison' && !v.sim && d.stat.armour > 0 && !(d.st.armour > 0) && S.dmg?.sum?.['armour_break_for_%_of_poison_damage_over_poison_duration'];   // Corrosion: Armour Break of its % of the poison's damage. note: at once here, not over its duration
      if (CB) { d.cut = (d.cut || 0) + v.dps * (o?.dur ?? DUR.poison) * CB / 100; if (d.cut >= d.stat.armour) { d.cut = 0; inflict(d, 'armour', S, 1, null, { dur: BROKEN.time }); } }
      if (a === 'ignite' && !S.src && !v.sim && sheet().igniteSelf) suffer('ignite', o?.dur ?? DUR.ignite, { dot: { dps: v.raw * (o?.eff || 1), el: v.el } });   // the tree's: your ignites reflected to you
    }
    if (a === 'maim') o = { ...o, mag: (o?.mag ?? MAIM.move) * slowK(S) };   // the skill's increased Slow Magnitude of the debuffs it inflicts
    if (o?.mag && critHit === S && S.dmg.ail?.critAil?.[a]) o = { ...o, mag: o.mag * S.dmg.ail.critAil[a] };   // a shock / chill from a critical hit
    if (a === 'bleed') d.red = S.dmg?.sum?.['bleeding_monsters_attack_speed_+%'] != null && S.dmg.sum;   // See Red: they move and attack faster while bleeding
    if (a === 'ignite' && !S.src && !(time < me.earch) && time >= (me.earch ?? -99) + SK.archon_time[1] && Math.random() * 100 < (S.dmg?.sum?.['gain_archon_elemental_when_you_ignite_enemy_chance_%'] || 0)) earchGo(sheet().earch || { time: SK.archon_time[0] });   // Arbiter's Ignition: Elemental Archon
    if (a === 'stun' && !S.src && sheet().ancStun && ['rare', 'unique'].includes(d.stat.rarity)) me.ancNext = time + sheet().ancStun;   // the tree's: the next attack within its seconds is Ancestrally Boosted
    if (a === 'freeze') d.frozeBy = S;   // Brittle Armour
    if (a === 'shock' && S.dmg?.sum?.['support_stormfire_targets_shocked_by_this_take_%_of_damage_from_ignite_as_lightning_damage']) d.stormfire = S.dmg.sum['support_stormfire_targets_shocked_by_this_take_%_of_damage_from_ignite_as_lightning_damage'];   // Stormfire
    // Wildfire: the ignite spreads to the enemies within its radius, never twice to one (keywords.json AilmentSpread)
    // note: at once, its delay is not in the data
    const WF = a === 'ignite' && (S.dmg?.sum?.support_ignite_proliferation_radius || S.dmg?.stats?.active_skill_ignite_proliferation_radius || !S.src && S.dmg?.sum?.ignite_proliferation_radius_15 && 15);   // (The Searing Touch: your Ignites, within 1.5 metres)   // or the skill's own (Phantasmal Arrow's explosion)
    if (WF) { const seen = o?.spread || new Set([d]); for (const e of dummies) if (!e.dead && !seen.has(e) && dist(e.pos, d.pos) <= WF / 10) { seen.add(e); inflict(e, 'ignite', S, k, raw, { ...o, spread: seen }); } }
    const FX = a === 'freeze' && S.dmg?.sum?.chilling_ice_create_chilled_ground_on_freeze_base_duration_ms; if (FX) ground('chilled', { x: d.pos.x, z: d.pos.z }, S.dmg.sum.chilling_ice_freezing_area_base_radius / 10, FX / 1000, S);   // Frost Nexus
    const BV = a === 'freeze' && !S.src && S.dmg?.sum?.supported_skill_grants_shatter_fang_to_you_and_allies_in_presence_for_base_X_ms_on_freeze; if (BV) me.fang = { pct: Math.floor(me.rage / 2), until: time + BV / 1000 };   // Bhatair's Vengeance: 1% of damage as cold per 2 Rage you have then, for its time
    const PM = a === 'stun' && S.dmg?.sum?.['support_stunning_magic_grant_spell_damage_+%_buff_on_heavy_stunning']; if (PM) me.pmag = { inc: PM, until: time + S.dmg.sum.support_stunning_magic_buff_duration_ms / 1000 };   // Practical Magic
    const US = a === 'armour' && S.dmg?.sum?.['support_demolisher_physical_damage_taken_+%_on_fully_armour_breaking_up_to_20%']; if (US) d.smelt = Math.min(20, (d.smelt || 0) + US);   // Uruk's Smelting: increased physical damage taken, for good, up to 20%
    if (!S.src && sheet().immIntim && ['pin', 'stun', 'freeze', 'electrocute'].includes(a)) d.intim = Math.max(d.intim || 0, time + sheet().immIntim);   // the tree's: Intimidated when you Immobilise them
    if (a === 'stun' && !S.src && (me.form || me.demon) && sheet().shiftMore?.intim) d.intim = Math.max(d.intim || 0, time + sheet().shiftMore.intim);   // the tree's: Intimidated when you Heavy Stun it Shapeshifted
    if (a === 'ignite' && !S.src && sheet().igniteHurt) hurt(playerTakes(sheet(), 'fire', sheet().igniteHurt, true));   // Fireflower: fire damage taken when you ignite
    const fresh = !(d.st[a] > 0), left = d.st[a] || 0; if (a === 'bleed' && fresh) d.bleedAt = time; d.st[a] = Math.max(d.st[a] || 0, o?.dur ?? DUR[a]); d.by = S; if (o?.dur) (d.full ||= {})[a] = o.dur; (me.inflAt ||= {})[a] = time; if (a === 'ignite') d.ignAt = time; if (a === 'stun' && S && !S.src && Math.random() * 100 < (sheet().uEv?.powerStun || 0)) gainCharge('power', S.label);
    // Stormweaver's Strike Twice / Heavy Snows: a second shock / chill of yours at once, kept with its own time (mag2), the two adding up
    const two = o?.mag && !fresh && (a === 'shock' || a === 'chill') && S.dmg?.sum?.[`can_apply_additional_${a}`];
    if (two) { const M = d.mag[a] || 0, lo = Math.min(M, o.mag), keep = M <= o.mag ? left : o.dur ?? DUR[a]; if (!(d.mag2?.[a]?.until > time && d.mag2[a].mag >= lo)) (d.mag2 ||= {})[a] = { mag: lo, until: time + keep }; }
    if (o?.mag) d.mag[a] = fresh ? o.mag : Math.max(d.mag[a] || 0, o.mag);   // the strongest shock / chill stays
    else if (fresh) delete d.mag[a];
    if (a === 'shock') trigger(S, 'shock', d);   // a shock over a shock is shocking the enemy too
    if (a === 'shock' && !o?.spread && !/minion/.test(S.src || '') && Math.random() * 100 < (sheet().shockSpread || 0)) for (const e of inside(d.pos, 1.5)) if (e !== d) inflict(e, 'shock', S, k, raw, { ...o, spread: true });   // the tree's shock on those within 1.5 m
    if (!fresh) return;
    if (!S.src && EL_AIL.includes(a) && !(time < me.unbound?.until)) { const i = byName('Unbound Avatar'), UA = i >= 0 && base(i)?.dmg?.stats; if (UA) me.fury = Math.min(UA.ailment_bearer_required_stacks_to_use, (me.fury || 0) + 1); }   // Unbound Fury
    // Acolyte of Chayula's Inner Turmoil: Volatility on inflicting an elemental ailment (once every its interval, up to its most)
    const VG = !S.src && EL_AIL.includes(a) && sheet().volatility;
    if (VG && time - (me.volAt ?? -99) >= VOLATILITY.every) gainVol(VG);
    // Invoker's I am the Blizzard / I am the Thunder: Chilled Ground on freezing an enemy, its chance of Shocked Ground on
    // shocking one, where it is (keywords.json: 6 s). note: the ground's area is not in the data: the scene's
    const GS = !/minion/.test(S.src || '') && S.dmg?.sum, GK = GS && (a === 'freeze' ? GS.create_chilling_ground_on_freeze && 'chilled' : a === 'shock' && Math.random() * 100 < (GS['chance_%_to_create_shocking_ground_on_shock'] || 0) && 'shocked');
    if (GK && S.src !== 'ground') ground(GK, { x: d.pos.x, z: d.pos.z }, SIM.area, GROUND_TIME[GK], { ...S, src: 'ground' });   // not again from its own ground
    siphon(a, d); if (!S.src) glory(d, a === 'stun' ? 'heavy_stun' : a); if (a === 'stun') houndBlow(d, true);
    // Martial Artist's Mountain's Teachings: its Surpassing chance per enemy Power on Immobilising (freeze, heavy stun,
    // electrocute, pin), up to its most, for its duration
    const MT = !S.src && ['freeze', 'stun', 'electrocute', 'pin'].includes(a) && sheet().mountain;
    if (MT) { const n = MT.chance * pow(d) / 100, got = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
      if (got) { me.mount = Math.min(MT.max, (time < me.mountUntil ? me.mount : 0) + got); me.mountUntil = time + MT.dur; } }
    // Combat Frenzy: a frenzy charge on freezing, electrocuting or pinning an enemy, once every its cooldown
    const CF = ['freeze', 'electrocute', 'pin'].includes(a) && onS('Combat Frenzy');
    if (CF && time - (me.cfAt ?? -99) >= CF.dmg.stats.skill_combat_frenzy_x_ms_cooldown / 1000) { me.cfAt = time; gainCharge('frenzy', CF.label); }
    // Breachlord's Rift: freezing or electrocuting breaks its share of the enemy's armour (the tree: pinning, heavy stunning)
    const FE = 'support_break_%_armour_on_freeze_or_electrocute', BR = d.stat.armour > 0 && !(d.st.armour > 0)
      && S.dmg?.sum?.[{ freeze: FE, electrocute: FE, pin: 'break_%_armour_on_pin', stun: 'armour_break_%_of_armour_on_heavy_stunning' }[a]];   // and the tree's on Pinning and Heavy Stunning
    if (BR && (d.cut = (d.cut || 0) + d.stat.armour * BR / 100) >= d.stat.armour) { d.cut = 0; inflict(d, 'armour', S, 1, null, {}); }
    const MD = d.mark?.D;   // Freezing / Voltaic Mark: the state it builds up consumes it and grants you its buff
    if (MD?.gain && (a === 'freeze' && MD.freeze || a === 'electrocute' && MD.electrocute)) {
      const M = d.mark; d.mark = null; trigger(M.S, 'mark', d); buffs = buffs.filter(b => !b.gain || b.sup);
      buffs.push({ label: M.label, name: M.name, c: css(MD.gain.el), s: MD.gain.time, gain: MD.gain }); say(t('{0} consumes {1}', S.label, M.label), 'mark');
    }
    if (a === 'freeze') gainBuff(S, 'freeze');
    if (a === 'ignite') { d.ignBy = S; if (!S?.src) gainRage(S?.dmg?.sum?.gain_X_rage_on_ignite_hit || 0); }   // Fiery Death: the enemies the supported skill ignites
    const p = chest(d);
    if (a === 'pin' && !S?.src) me.pinAt = time;   // "if you've Pinned an enemy Recently"
    if (a === 'freeze' && !S?.src && sheet().durFrozen) (me.froze ||= []).push(time);   // Blessing of the Moon: the enemies you have Frozen in the last 8 seconds
    if (a === 'freeze') { fx.text(over(d), t(STATE[a]), css('ice'), .36); fx.emit(22, { p, r: .3, v: 1.6, up: 1, life: .6, size: .16, c: 'ice', c2: 'white', g: 5 }); fx.ring(d.pos, .2, 1.1, 'ice', .35); }
    else if (a === 'stun') { fx.text(over(d), t(STATE[a]), '#f2ead8', .36); fx.ring(d.pos, .2, 1.2, 'white', .3); d.wind = null; if (!S.src) remnantOn('stun', d); }
    else if (a === 'armour') { fx.text(over(d), t(STATE[a]), css('dust'), .34); fx.emit(16, { p, v: 3, up: 2, life: .6, size: .1, c: 0xb0a898, g: 12, k: 1.2 }); }
    else if (a === 'electrocute' || a === 'pin' || a === 'maim') { fx.text(over(d), t(STATE[a]), css(PIP[a]), .36); fx.ring(d.pos, .2, 1.1, PIP[a], .3); if (a === 'electrocute') d.wind = d.erod = null; }
    else if (a === 'shock') fx.emit(8, { p, r: .3, v: 2.4, life: .2, size: .14, c: 'lightning', c2: 'white', k: 3 });
    else if (a === 'ignite') fx.emit(8, { p, r: .25, v: .5, up: 2.2, life: .5, size: .32, c: 'fire', c2: 'ember' });
    event(a, d.pos, S, d);
  }
  // Exposure lowers the resistances of its elements by its magnitude (the glossary's when the source gives none); the strongest stays
  const expo = (d, els, mag = EXPO.res, dur = DUR.expo) => {
    const old = d.st.expo > 0 && d.expo;
    d.expo = { els: [...new Set([...(old ? old.els : []), ...els])], mag: Math.max(old ? old.mag : 0, Math.abs(mag)) };
    d.st.expo = Math.max(d.st.expo || 0, dur);
  };
  const expoMag = S => (S.dmg?.ail?.expo.skill ?? EXPO.res) * (S.dmg?.ail?.expo.effect ?? 1);   // the skill's own (Oil, Frost Bomb)
  // shocked enemies take more damage from everything (BaseShockMagnitude, or the shock's own)
  const mag2 = (d, a) => d.mag2?.[a]?.until > time ? d.mag2[a].mag : 0;   // a second shock / chill (Strike Twice, Heavy Snows)
  const tookInc = d => shocked(d) + (d.curse ? (sheet().cursed?.taken || 0) / 100 : 0);   // and what an enemy you cursed takes increased (a glove's, Shackles of the Wretched's Runeforged)
  const shocked = d => d.st.shock > 0 ? 1 + ((d.mag.shock ?? GC.BaseShockMagnitude) + mag2(d, 'shock')) / 100 : 1;
  // what the enemy takes of r damage of a type now: armour lowered by Armour Break (none when fully broken, which also adds
  // physical damage taken) and by a curse, resistance lowered by exposure and curses (both less on rarer monsters), then by the hit's penetration, and shock
  // Intimidated, they take more. note: as a factor of its own, not added to the other increases
  // the curses on an enemy: the latest (d.curse) and those still on from before (d.hexes), up to your curse limit;
  // their effects add up
  // (the tree's increased magnitudes once half of a curse's duration has expired. note: as a factor of its own)
  // Shackles of the Wretched: a curse you inflict is on you too (me.hexes, by its name), with the effect and the duration of
  // curses on you, as many as your curse limit (the oldest goes); onMe: what those on you add up to (lower resistances and
  // armour, less damage dealt, slower actions)
  // free: Soul Mantle's, whatever the curse limit and with no Shackles
  const hexMe = (name, C, s, x = 1, free) => {
    const R = sheet().selfCurse; if (!C || !free && !R?.reflect) return;
    const live = Object.entries(me.hexes || {}).filter(([n, h]) => n !== name && time < h.until), lim = live.filter(([, h]) => !h.free);
    me.hexes = Object.fromEntries([...live.filter(([, h]) => h.free), ...free || sheet().curseIgnore ? lim : lim.slice(-((sheet().curseLimit || 1) - 1) || Infinity), [name, { until: time + s * R.time, C, k: (C.effect ?? 1) * x * R.effect, free }]]);
  };
  // the Consecrated Ground you stand on, if any (Gifts from Above: you have it around you while stationary. note: its
  // radius is not in the data: it is under you alone)
  const holyAt = () => grounds.find(g => g.type === 'consecrated' && !g.dead && dist(g, pp) <= g.r) || sheet().holyStill && !walk && !move && {};
  // the enemy's curse moves among its older ones (up to your curse limit) to make room for a new one called name
  const hexOld = (d, name, ign) => d.hexes = [d.curse, ...(d.hexes || [])].filter(u => u && u.name !== name).slice(0, ign || sheet().curseIgnore ? Infinity : (sheet().curseLimit || 1) - 1);
  const hexN = () => Object.values(me.hexes || {}).filter(h => time < h.until).length;
  const uncurse = () => { const k = Object.keys(me.hexes || {}).find(n => time < me.hexes[n].until); if (k) { delete me.hexes[k]; fx.ring(pp, .2, 1.2, 'gold', .35); } };   // one of the curses on you
  const onMe = f => Object.values(me.hexes || {}).reduce((t, h) => t + (time < h.until ? (f(h.C) || 0) * h.k : 0), 0) * (holyAt() ? .5 : 1);   // on Consecrated Ground, 50% reduced effect (keywords.json)
  const curseFx = (d, f) => [d.curse, ...(d.hexes || [])].reduce((t, u) => t + (u ? (f(u.C) || 0) * (u.k || 0) * (u.full && u.s <= u.full / 2 ? 1 + (sheet().cursed?.half || 0) / 100 : 1) * (me.whisp ? 1 + me.whisp.n * WHISPER.mag / 100 / (u.C?.inc || 1) : 1) : 0), 0);
  // Watchtowers: each totem of yours its increased damage taken on the enemies in its Presence (note: your Presence's radius)
  const watched = d => { const s = sheet(), k = s.watch; return k ? 1 + k * objs.filter(o => o.totemOf && !o.dead && dist(o.pos, d.pos) <= s.overgrow.r).length / 100 : 1; };
  // the tree's increased damage taken by enemies you Mark, Electrocute, Freeze (cold) and per Incision on them (physical).
  // note: as a factor of its own, as Intimidate's
  const treeTaken = (d, el) => { const T = sheet().takenTree; return T ? 1 + ((d.mark ? T.mark : 0) + (d.st.electrocute > 0 ? T.electro : 0) + (el === 'cold' && d.st.freeze > 0 ? T.frozenCold : 0) + (el === 'physical' ? T.incision * (d.inc || 0) : 0) + (sheet().uDef?.yoke || 0) * ['ignite', 'chill', 'freeze', 'shock', 'electrocute'].filter(a => d.st[a] > 0).length) / 100 : 1; };   // Yoke of Suffering: per elemental ailment type on them
  // the tree's: enemies on Chilled Ground take more fire damage, on Ignited Ground more cold
  const groundX = (d, el) => { const GT = sheet().groundTaken?.[el], k = el === 'fire' ? 'chilled' : 'burning'; return GT && grounds.some(g => !g.dead && g.type === k && dist(g, d.pos) <= g.r) ? 1 + GT / 100 : 1; };
  function takes(d, el, r, isHit = true, ow, pen, inv, zero) { return defence(d, el, r, isHit, ow, pen, inv, zero) * groundX(d, el) * (d.st.chill > 0 && sheet().chillTaken ? 1 + (d.mag.chill || 0) / 100 : 1) * (d.st.freeze > 0 ? 1 + (sheet().frozenTaken || 0) / 100 : 1) * tookInc(d) * (d.intim > time ? 1 + INTIM / 100 : 1) * watched(d) * treeTaken(d, el); }
  function defence(d, el, r, isHit = true, ow = 0, pen = 0, inv, zero) {
    let st = d.stat; const CA = curseFx(d, C => C?.armour), SE = sheet(), near = () => dist(d.pos, pp) <= SE.overgrow.r;
    // Leopold's Applause (in your Presence: Sacred Flame): elemental damage resisted by its lowest elemental resistance;
    // The Coming Calamity: none in your Presence; a critical hit's ignored ones (zero)
    if (el === 'lightning' && SE.lightResNear && near()) st = { ...st, res: { ...st.res, lightning: SE.res?.lightning?.capped || 0 } };   // Doryani's Prototype: equal to yours
    if (ELEM.includes(el) && (SE.lowestRes || SE.lowestResNear && near())) st = { ...st, res: { ...st.res, [el]: Math.min(...ELEM.map(e => st.res[e] || 0)) } };
    if (ELEM.includes(el) && (zero?.includes(el) || SE.noResNear && near())) st = { ...st, res: { ...st.res, [el]: 0 } };
    if (isHit && ELEM.includes(el) && d.st.freeze > 0 && SE.frozenNoRes && st.res[el] > 0) st = { ...st, res: { ...st.res, [el]: 0 } };   // the tree's: hits ignore a Frozen enemy's non-negative elemental resistances
    if (inv && ELEM.includes(el)) st = { ...st, res: { ...st.res, [el]: -(st.res[el] || 0) } };   // its elemental resistance treated as inverted
    if (el === 'physical' && sheet().hazArmour && time - (d.hazAt ?? -99) <= RECENT) st = { ...st, armour: st.armour * (1 + sheet().hazArmour / 100) };   // the tree's armour of the enemies your Hazards affected recently
    if (el === 'physical' && (d.cut > 0 || d.st.armour > 0 || CA)) st = { ...st, armour: d.st.armour > 0 ? -(d.over || 0) : Math.max(0, st.armour - d.cut - CA) };   // Imploding Impacts: below 0 while Fully Broken
    const low = (d.st.expo > 0 && d.expo?.els.includes(el) ? (d.expo.mag + (sheet().expoExtra || 0)) * st.expoEffect : 0) - (el === 'fire' && d.st.ignite > 0 ? sheet().ignitedRes || 0 : 0) - (ELEM.includes(el) && (d.st.ignite > 0 || d.st.chill > 0) ? sheet().igChillRes || 0 : 0) - (el === 'fire' && dist(d.pos, pp) <= sheet().overgrow.r ? sheet().presFireRes || 0 : 0) - curseFx(d, C => C?.res[el]) - (el === 'cold' && d.st.freeze > 0 ? sheet().frozenRes || 0 : 0) - (el === 'chaos' && d.curse ? sheet().cursed?.chaos || 0 : 0);   // Deep Freeze: the Frozen's cold resistance; the tree's chaos resistance of enemies you curse
    if (low) st = { ...st, res: { ...st.res, [el]: st.res[el] - low } };
    const W = (el === 'chaos' || el === 'fire' && sheet().witherFire) && d.wither ? (d.wither = d.wither.filter(u => u.until > time)).reduce((t, u) => t + u.pct, 0) : 0;
    const crush = isHit && el === 'physical' && d.crushed > time ? r * CRUSH / 100 : 0;   // Crushed: less physical damage reduction
    const got = enemyTakes(st, el, r, isHit, pen, SE.penFloor), over = el === 'physical' ? (r - got) * ow / 100 : 0;   // High Velocity Rounds: Overwhelm, its share of the reduction ignored
    return (got + over + crush) * (el === 'physical' ? 1 + (d.smelt || 0) / 100 : 1) * (isHit && (el === 'physical' || sheet().implode || sheet().brokenEl.includes(el)) && d.st.armour > 0 ? 1 + (BROKEN.taken + (time < d.sunder?.until ? d.sunder.pct : 0)) * (d.brokenX || 1) / 100 : 1) * (1 + W / 100) * (d.jag > time ? 1 + d.jagPct / 100 : 1) * (el === 'fire' && d.ignSec ? 1 + Math.min(10, d.ignSec * (sheet().igniteFire || 0)) / 100 : 1);   // the tree's fire damage taken per second ever Ignited
  }
  // Withered for s seconds, its chaos damage taken (Wither's own, else keywords.json's), up to its most at once
  function withers(d, s, pct = WITHER.per) { if (sheet().witherForever || sheet().witherIgn && d.st.ignite > 0) s = 1e9; const w = d.wither = (d.wither || []).filter(u => u.until > time); w.push({ until: time + s, pct: pct * (1 + (sheet().witherMag || 0) / 100) });   /* the tree's increased Withered magnitude */ if (w.length > WITHER.max) w.shift(); }
  // What one hit does with ailments, as the game rolls it: its damage before the enemy's mitigation (raw, per type) against the
  // enemy's Elemental Ailment Threshold (chance to shock, flammability for ignite, chill magnitude) and poise (freeze and heavy
  // stun buildup), with GameConstants' rules, the skill's modifiers (calc.js ailments()) and the enemy's rarity. Bleeding and
  // poison need a chance of their own; Armour Break, an amount the skill or the build gives.
  // The skill's own on / off rules (never / always freeze, shock, ignite, stun...) come first. Electrocute and Pin build up
  // like freeze, only from skills that say so. o: { crit, stunX } of the hit.
  // note: freeze buildup is measured against poise, as Path of Building 2 does (the glossary says Ailment Threshold)
  // the build's "<type> damage can <ailment>" (uniques): [its ailments, the types it adds]; Olroth's Hubris' physical
  // contributing to freeze buildup (its text; its stat is its added physical damage)
  const EXTRA = { physical_damage_can_ignite_freeze_shock: [['ignite', 'freeze', 'shock'], ['physical']], physical_damage_from_hits_also_contributes_to_chill_and_freeze: [['chill', 'freeze'], ['physical']],
    'added_physical_damage_%_ward_cost': [['freeze'], ['physical']], chaos_damage_can_freeze: [['freeze'], ['chaos']], chaos_damage_can_shock: [['shock'], ['chaos']], base_chaos_damage_can_ignite: [['ignite'], ['chaos']],   // Tul's Stillness, Esh's Radiance, Xoph's Pyre
    base_chaos_damage_can_electrocute: [['electrocute'], ['chaos']], elemental_damage_also_contributes_to_flammability_ignite_chill_freeze_and_shock: [['ignite', 'chill', 'freeze', 'shock'], ['fire', 'cold', 'lightning']],
    elemental_damage_can_inflict_bleeding: [['bleed'], ['fire', 'cold', 'lightning']], fire_damage_can_inflict_bleeding: [['bleed'], ['fire']] };
  // Acolyte of Chayula's Unravelling (KeywordPopups UnravellingBuff): your chaos damage also contributes to Freeze buildup,
  // to Flammability and Ignite, or to Shock chance, one of them at random, changing every its interval
  const unravel = SU => { const X = SU.unravelling_cycling_buff_every_x_ms; if (!X) return null; if (!(time < me.unravel?.until)) me.unravel = { until: time + X / 1000, a: ['freeze', 'ignite', 'shock'][Math.floor(rnd(3))] }; return me.unravel.a; };
  let critHit = null;   // the skill whose critical hit is inflicting ailments now
  // ponytail: a hit with no ailment table of its own inflicts none; seen once from a minion's hit (27/11), its source not found
  function afflict(d, S, raw, o = {}) { if (!S.dmg?.ail) return; critHit = o.crit ? S : null; try { afflict0(d, S, raw, o); } finally { critHit = null; } }
  function afflict0(d, S, raw, o = {}) {
    const A = S.dmg.ail, N = A.never, AL = A.always, E = A.expo, thr = Math.max(1, d.stat.ail * awe(d, 'ailment')), x = e => raw[e] || 0, UB = !S.src && time < me.unbound?.until && me.unbound, roll = c => Math.random() * 100 < c, eroll = c => roll(c * (UB ? UB.chance : 1));
    const ex = (els, ms) => ms && expo(d, els, EXPO.res * E.effect, ms / 1000);
    if (roll((S.dmg.stats?.['base_chance_to_daze_%'] || 0) + (S.dmg.sum?.['base_chance_to_daze_%'] || 0) + (S.P.projectile && dist(d.pos, pp) > 6 ? S.dmg.sum?.['projectile_daze_chance_%_vs_enemies_further_than_6m'] || 0 : 0))) daze(d, DAZE.time, S);   // Wind Blast, Siphoning Strike; the tree's projectiles from further than 6 m
    // the damage of the hit that counts for an ailment: its own type's, every type's with "all damage can <ailment>" (the
    // build's; Pinnacle of Power's buff: every Elemental Ailment, BuffDefinitions elemental_power; all damage to bleeding /
    // poisoned enemies contributing to chill), and the types the build's "<type> damage can <ailment>" add (EXTRA)
    const SU = S.dmg.sum || {}, PN = !S.src && time < me.pinn?.until, allD = Object.values(raw).reduce((t, v) => t + v, 0);
    const can = a => PN && a !== 'electrocute' || SU[`all_damage_can_${a}`] || S.P.attack && SU[`local_all_damage_can_${a}`] || a === 'ignite' && SU.you_and_allies_in_presence_all_damage_can_ignite
      || a === 'electrocute' && S.P.attack && SU.all_attack_damage_can_electrocute
      || a === 'chill' && (SU.all_damage_to_bleeding_enemies_contributes_to_chill && has(d, 'bleed') || SU.all_damage_to_poisoned_enemies_contributes_to_chill && has(d, 'poison'));
    const adds = a => [...Object.entries(EXTRA).flatMap(([k, [as, es]]) => SU[k] && as.includes(a) ? es : []), ...a === 'ignite' && S.dmg.blackflame ? ['chaos'] : [], ...!S.src && a === unravel(SU) ? ['chaos'] : []], TD = SU.unique_fire_damage_shocks && { ignite: 'cold', shock: 'fire', freeze: 'lightning', chill: '-' }, xa = (a, e) => can(a) ? allD : [...new Set([TD?.[a] ?? e, ...adds(a)])].reduce((t, k) => t + x(k), 0);
    // Frostflame Nova on an Ignited enemy: the Ignite's duration starts over, its Freeze buildup is more per 1% of the
    // enemy's ailment threshold the Ignite deals a second, and no other Ignite takes until that one ends
    const FF = S.dmg.stats?.[FROSTFLAME], FFm = FF != null ? 1 + FF / 10000 * (d.burn.ignite?.dps || 0) / thr * 100 : 1;
    if (FF != null) { d.st.ignite = Math.max(d.st.ignite, d.full?.ignite || DUR.ignite); d.noIgn = time + d.st.ignite; }
    const EAx = S.P.spell && !S.src && time < me.earch ? 1 + EARCHON.ail / 100 : 1;   // Elemental Archon: more Flammability, Shock chance and Freeze buildup
    // the tree's ailments against a state of this enemy (calc.js ailVs): more magnitude ('eff') or duration ('dur')
    const VS = (a, w) => vsAil(A, a, w, d, S), IC = d.mon?.category === 'Construct' ? A.immobConstruct || 1 : 1;
    const AR = (['rare', 'unique'].includes(d.stat.rarity) ? A.ailRare || 1 : 1) * (!S.src && meIs.ShapeshiftedRecently() ? A.ailShift || 1 : 1) * (d.st.expo > 0 ? A.ailExpo || 1 : 1), AC = (A.ailChance || 1) * AR;   // the tree's increased chance to inflict ailments (bleeding, poison; ignite and shock have it in theirs)
    if (xa('ignite', 'fire') && (S.els.includes('fire') || can('ignite') || adds('ignite').length) && !N.ignite && !(d.noIgn > time)) {   // flammability: each hit adds some for a while, the total is the chance to ignite
      // Incendiary Shot: its ignite lasts longer for each of its pellets that hit this enemy
      const PH = S.dmg.stats['ignite_duration_+%_per_shotgun_pellet_hit'], pellets = PH ? 1 + PH * (S.pellets ??= new Map()).set(d, (S.pellets.get(d) || 0) + 1).get(d) / 100 : 1;
      d.flam.push({ v: xa('ignite', 'fire') / thr * GC.IgniteChanceMultiplier * A.igniteChance * EAx * AR, s: GC.BaseFlammabilityDuration });
      // Frostfire: on a Frozen enemy its more ignite effect (more still on a unique), Consuming the Freeze
      const FF = d.st.freeze > 0 && SU['ignite_effect_+%_final_against_frozen_enemies'] ? (1 + SU['ignite_effect_+%_final_against_frozen_enemies'] / 100) * (d.stat.rarity === 'unique' ? 1 + (SU['support_frostfire_ignite_effect_+%_final_vs_frozen_unique_enemies'] || 0) / 100 : 1) : 1;
      if (AL.ignite || eroll(d.flam.reduce((t, f) => t + f.v, 0))) { if (FF > 1) clear(d, 'freeze'); inflict(d, 'ignite', S, 1, { ...raw, fire: xa('ignite', 'fire') }, { dur: DUR.ignite * A.igniteTime * pellets * VS('ignite', 'dur'), eff: FF * A.igniteEffect * VS('ignite', 'eff') * (S.heated ? 1 + (S.dmg.stats['ignite_effect_+%_final_if_heat_is_consumed'] || 0) / 100 : 1) }); ex(['fire'], E.onIgnite); if (SU.inflict_cold_exposure_on_ignite) expo(d, ['cold'], EXPO.res * E.effect); }   // Blessed Bonds: cold exposure on ignite   // Incendiary Shot's Heat
    }
    const W = d.wet?.until > time ? d.wet : null;   // Thunderstorm's drench
    // hand wraps: "Projectiles have x% chance to Shock", on top of the chance the damage gives
    if (xa('shock', 'lightning') && !N.shock && (AL.shock || eroll((xa('shock', 'lightning') / thr * GC.ShockChanceMultiplier + (S.P.projectile && SU['projectile_shock_chance_%'] || 0)) * A.shockChance * EAx * AR * (d.st.electrocute > 0 ? A.shockElectro || 1 : 1) * (1 + (W?.shock || 0) / 100) * (1 + (me.galv?.dmg.stats['galvanic_field_shock_chance_+%_final'] || 0) / 100) * (1 + (me.thrill?.until > time && me.thrill.X['support_thrill_of_the_kill_buff_shock_chance_+%'] || 0) / 100)))) {
      const so = { dur: DUR.shock * A.shockTime * VS('shock', 'dur'), mag: GC.BaseShockMagnitude * A.shockEffect * VS('shock', 'eff') * (S.shockX || 1) }; inflict(d, 'shock', S, 1, raw, so); ex(['lightning'], E.onShock); if (SU.inflict_fire_exposure_on_shock) expo(d, ['fire'], EXPO.res * E.effect);   // S.shockX: Vivid Stampede's more per leap
      if (me.galv) galvanic(d);
      // Shock Conduction: its chance to shock each other enemy within its radius too
      const SCn = S.dmg.sum?.['support_%_chance_to_shock_nearby_enemy_on_shock'];
      if (SCn) for (const e of inside(d.pos, S.dmg.sum.shock_nearby_enemy_base_area_of_effect_radius / 10)) if (e !== d && roll(SCn)) inflict(e, 'shock', S, 1, raw, so);
    }
    if (xa('chill', 'cold') || xa('freeze', 'cold')) {
      const mag = Math.min(SU.elementalist_chill_maximum_magnitude_override || GC.ChillMaxEffect, GC.ChillEffectMultiplier * xa('chill', 'cold') * A.chillDamage / thr * A.chillEffect * VS('chill', 'eff'));
      if (mag >= CHILL_MIN && !N.chill) inflict(d, 'chill', S, 1, raw, { dur: DUR.chill * A.chillTime * VS('chill', 'dur'), mag });   // the most: Heavy Snows' override, else the game's
      if (!N.freeze) AL.freeze || !S.src && S.P.attack && d.life >= d.max && sheet().freezeFull ? inflict(d, 'freeze', S, 1, null, { dur: DUR.freeze * A.freezeTime }) : build(d, 'freeze', xa('freeze', 'cold') * GC.FreezeDamageScale * A.freeze * IC * rimeOn(d) * FFm * EAx * (UB ? UB.build : 1) * (1 + (d.mark?.D?.freeze || 0) / 100) * (1 + (W?.freeze || 0) / 100) * (S.freezeEmp || 1), S, A);
      if (o.crit) ex(['cold'], E.onColdCrit);
    }
    if (o.crit && SU.inflict_lightning_exposure_on_crit) expo(d, ['lightning'], EXPO.res * E.effect);   // Blessed Bonds: lightning exposure on a critical hit
    const EZ = A.electrocute || ((d.enerv > time || d.erod?.until > time) && x('lightning') ? A.electrocuteIf : 0);   // Enervating Nova's, an Electrocuting Rod's
    if (EZ) build(d, 'electrocute', (A.electrocute ? xa('electrocute', 'lightning') : x('lightning')) * GC.ElectrocuteDamageScale * EZ * (A.immob || 1) * IC * (UB ? UB.build : 1) * (1 + (d.mark?.D?.electrocute || 0) / 100) * (d.st.shock > 0 ? A.elShock || 1 : 1), S, A);
    const wasPinned = d.st.pin > 0;
    // Lockdown: its most more Pin buildup on enemies within 2 m of you (its text). note: how it falls off past 2 m is not
    // in the data (nor in PoB2): none there
    const LK = !S.src && dist(pp, d.pos) <= 2 ? 1 + (S.dmg?.finals?.['support_lockdown_distance_based_pin_damage_+%_final'] || 0) / 100 : 1;
    if (SU.cannot_pin);   // Bone Shrapnel: its skill cannot Pin
    else if (A.pin) build(d, 'pin', (A.pinPhys ? x('physical') : allD) * GC.PinDamageScale * A.pin * LK * IC, S, A);
    else if (o.crit && S.P.spell && SU.physical_spell_damage_can_pin_on_critical_hit && x('physical')) build(d, 'pin', x('physical') * GC.PinDamageScale * (A.immob || 1) * IC, S, A);   // Bone Chains
    const all = Object.entries(raw).reduce((t, [e, v]) => t + v * (e === 'physical' ? A.stunPhys : 1), 0);
    const STX = (!S.src && meIs.ShapeshiftedRecently() ? A.stunShift || 1 : 1) * (!S.src && dist(pp, d.pos) <= 2 ? A.stunClose || 1 : 1) * (d.life <= d.max * LOW ? A.stunLow || 1 : 1) * (!S.src && meIs.Shapeshifted() ? A.stunShifted || 1 : 1) * (o.crit ? A.stunCrit || 1 : 1) * (S.stunEmp || 1);   // the tree's stun buildup after Shapeshifting, within 2 m, on Low Life ones, while Shapeshifted; an Empowered attack's
    if (!N.stun) AL.stun || o.full && S.P.attack && SU.local_always_heavy_stun_on_full_life ? inflict(d, 'stun', S, 1, null, { dur: DUR.stun }) :
      build(d, 'stun', (all - x('cold')) * A.stunMelee * GC.HeavyStunDamageScale * A.stun * STX * (o.stunX || 1), S, A);   // Marohi Erqi: on full life; cold damage builds up no Heavy Stun (keywords.json Cold)
    // Light Stun (keywords.json): the hit's chance, its damage (more from physical and melee, as its heavy stun buildup)
    // against the enemy's maximum life, 100% at all of it, none under the least chance (GameConstants); it cannot act for
    // its length (monster.ot)
    const LS = Math.min(100, all * A.stunMelee * A.stun * STX * (o.stunX || 1) / Math.max(1, d.max) * 100);
    if (!N.stun && !SU.cannot_cause_stun_but_allow_stun_buildup && !(d.st.stun > 0) && LS >= GAME.light_stun_min && roll(LS)) {
      d.lstun = time + GAME.light_stun_ms / 1000; fx.ring(d.pos, .2, .8, 'white', .2, { a: .5 });
      if (!S.src) { vanguard(S, false); remnantOn('stun', d); }
    }
    // Incision: each stack on the enemy adds to the chance to bleed it; bleeding it removes them, and the support's bleeding
    // is more effective per Incision removed recently
    if (xa('bleed', 'physical') && !N.bleed && roll(A.bleed * AC * (o.full ? 1 + A.bleedFull / 100 : 1) + INCISION.per * (A.incFx || 1) * (d.inc || 0) + (o.crit ? A.bleedCrit || 0 : 0))) {
      const cut = d.inc > 0; me.incs = me.incs.filter(u => time - u.t <= RECENT); if (d.inc) { me.incs.push({ t: time, n: d.inc }); d.inc = 0; }
      const ri = me.incs.reduce((t, u) => t + u.n, 0);
      inflict(d, 'bleed', S, 1, { ...raw, physical: xa('bleed', 'physical') }, { dur: (A.bleedBase ?? DUR.bleed) * A.bleedTime * VS('bleed', 'dur'), eff: A.bleedEffect * VS('bleed', 'eff') * (1 + Math.min(INCISION.cap, A.incEff * ri) / 100) * (1 + (S.concoct || 0) / 100) * (cut ? A.bleedIncision || 1 : 1) * (d.st.poison > 0 ? 1 + (S.dmg?.sum?.['mixed_maladies_bleed_effect_+%_final_vs_poisoned'] || 0) / 100 : 1) });   // Concoct; the tree's against Incision; Admixture against the Poisoned
    }
    const IN = (A.incision || 0) + (roll(A.incChance?.[0]) ? 1 : 0) + (roll(A.incChance?.[1]) ? 10 : 0);
    if (IN) d.inc = Math.min(INCISION.max, (d.inc || 0) + IN);
    // Aggravate (keywords.json): the attack's chance on hit (Rake, Bleeding Concoction), Herald of Blood's explosion's
    // chance, Rusted Spikes' chance when the hit Pins aggravate the bleeding the enemy has, treated as moving for the rest
    // of it: its damage doubled (AGGRAVATED), as a moving enemy's is (tickDummy)
    const st0 = S.dmg?.stats || {}, AG = (S.P.attack ? (st0['base_aggravate_bleeding_on_attack_hit_chance_%'] || 0) + (S.dmg?.sum?.['base_aggravate_bleeding_on_attack_hit_chance_%'] || 0) + (S.dmg?.wHit?.aggr || 0) : 0) + (S.aggX || 0)
      + (S.P.attack && sheet().aggOld && time - (d.bleedAt ?? time) > sheet().aggOld ? 100 : 0)   /* the tree's: bleeding older than its seconds (since it began) */
      + (!wasPinned && d.st.pin > 0 ? S.dmg?.sum?.['aggravate_bleeding_on_pin_chance_%'] || 0 : 0) + (d.curse && S.dmg?.sum?.aggravate_bleeding_when_inflicted_vs_cursed_enemy ? 100 : 0) + (d.st.pin > 0 && SU.aggravate_bleeding_when_inflicted_vs_pinned_enemy ? 100 : 0) + (A.bleedAgg ? 100 : 0) + (S.P.attack && o.crit ? S.dmg?.sum?.['aggravate_bleeding_on_attack_crit_chance_%'] || 0 : 0) + (S.empd ? S.dmg?.sum?.['aggravate_bleeding_on_exerted_attack_hit_chance_%'] || 0 : 0) + (d.jag > time ? S.dmg?.sum?.['aggravate_bleeding_when_inflicted_vs_enemies_on_jagged_ground_chance_%'] || 0 : 0);   // Blood Mage's Blood Barbs: on Cursed enemies; the tree's on attack critical hits
    if (AG && d.st.bleed > 0 && d.burn.bleed && !d.burn.bleed.agg && roll(AG)) { d.burn.bleed.agg = true; fx.text(over(d), t('Aggravated Bleeding'), css('blood'), .32);
      if (S.dmg?.wHit?.aggIgn && d.st.ignite > 0 && d.burn.ignite && !d.burn.ignite.agg) { d.burn.ignite.agg = true; fx.text(over(d), t('Aggravated Ignite'), css('fire'), .32); } }   // Saitha's Spear: the Ignites on the target too
    // Tacati's Ire: its poison deals its damage faster per Rage you have (as much damage over a shorter time)
    const PF = 1 + (S.dmg?.sum?.['faster_poison_%_per_current_rage'] || 0) * me.rage / 100;
    // Escalating Toxins: Poison lasts longer per Poison you inflicted Recently, with its other increased duration
    const PR = A.poisonRecent, PD = PR ? (1 + (PR.inc + Math.min(100, PR.per * (me.poisAt = (me.poisAt || []).filter(u => time - u <= RECENT)).length)) / 100) / (1 + PR.inc / 100) : 1;
    if (!N.poison && xa('poison', 'physical') + x('chaos') && roll((A.poison + (d.st.poison > 0 ? 0 : A.poisonFirst || 0) + (o.crit ? A.poisonCrit || 0 : 0)) * AC)) inflict(d, 'poison', S, 1, can('poison') ? { physical: allD } : raw, { dur: DUR.poison * A.poisonTime * VS('poison', 'dur') * PD / PF, eff: (A.poisonEffect + (d.st.poison > 0 ? 0 : (sheet().firstPoison || 0) / 100)) * VS('poison', 'eff') * PF * (d.st.bleed > 0 ? 1 + (S.dmg?.sum?.['mixed_maladies_poison_effect_+%_final_vs_bleeding'] || 0) / 100 : 1) }), me.poisAt?.push(time);   // Admixture, Poison III against the Bleeding
    if (roll(A.maim + (d.st.poison > 0 ? A.maimPoisoned : 0) + (d.st.bleed > 0 ? A.maimBleeding : 0)) || o.crit && A.maimCrit) inflict(d, 'maim', S, 1, null, { dur: MAIM.time, mag: MAIM.move + (A.maimMore || 0) });
    if (A.maimAfterPin && d.st.pin > 0) d.unpin = { s: A.maimAfterPin, S };   // maimed for a while once this Pin ends
    if (E.hit) expo(d, ELEM, E.hit * E.effect, (E.hitMs || DUR.expo * 1000) / 1000);
    const brk = N.armour ? 0 : (A.breakFlat + (S.breakAdd || 0) + x('physical') * (A.breakPct + (S.breakPct || 0) + (time < d.parried?.until ? S.dmg.sum?.['armour_break_physical_damage_%_dealt_as_armour_break_vs_parried_enemies'] || 0 : 0) + (d.st.freeze > 0 ? d.frozeBy?.dmg?.sum?.['freeze_applies_%_physical_damage_taken_as_armour_break'] || 0 : 0)) / 100 + x('chaos') * (S.dmg.sum?.['chaos_damage_%_dealt_as_armour_break'] || 0) / 100 + x('fire') * (S.dmg.stats?.['armour_break_fire_damage_%_dealt_as_armour_break'] || 0) / 100
      + (d.crushed > time ? x('physical') * (S.dmg.sum?.['crushed_target_%_physical_damage_taken_as_armour_break'] || 0) / 100 : 0)
      + x('physical') * (d.mark?.S?.dmg?.sum?.['marked_target_%_physical_damage_taken_as_armour_break'] || 0) / 100   // Mark for Death: hits on the enemy its Mark is on
      + (S.P.spell && o.crit ? x('physical') * (S.dmg.sum?.['armour_break_equal_to_%_physical_damage_dealt_on_critical_strike_with_spells'] || 0) / 100 : 0)
      + ['physical', 'fire', 'cold', 'lightning', 'chaos'].reduce((t, e) => t + x(e), 0) * ((S.dmg.sum?.['armour_break_damage_%_dealt_as_armour_break'] || 0) + (S.final ? S.chain0?.sum?.['final_strike_attack_damage_%_dealt_as_armour_break'] || 0 : 0) + (S.P.attack ? S.dmg.sum?.['local_armour_break_damage_%_dealt_as_armour_break'] || 0 : 0)) / 100) * A.breakMore * (A.breakAil && [...EL_AIL, 'bleed', 'poison'].some(a => d.st[a] > 0) ? A.breakAil : 1);   // Anvil's Weight: a share of all its damage; Tumult's consumed frenzy charge; Uul-Netol's Embrace's share of chaos, Smash to Smithereens' of fire; Styrn's Ferocity's share of physical against the Crushed
    // Warbringer's Imploding Impacts: Armour Break on a Fully Broken enemy takes its armour below 0, as far as its armour (KeywordPopups ArmourOverbreak)
    const rb = brk * (d.stat.rarity === 'normal' ? A.breakNormal : d.stat.rarity === 'magic' ? A.breakMagic : 1);
    if (brk > 0 && d.st.armour > 0 && sheet().overbreak) d.over = Math.min(d.stat.armour, (d.over || 0) + rb);
    if (brk > 0 && d.stat.armour > 0 && !(d.st.armour > 0) && !(d.riven?.until > time)) {
      if (!S.src && Math.random() * 100 < (S.dmg.onHit?.breakEndurance || 0)) chargeBy('endurance', S);   // Armour Break II, Break Endurance
      d.cut = (d.cut || 0) + rb;
      if (d.cut >= d.stat.armour) { if (S.name === 'Armour Piercing Rounds') aprShatter(d); d.cut = d.over = 0; d.brokenX = A.brokenEff || 1; inflict(d, 'armour', S, 1, raw, { dur: BROKEN.time * (A.brokenTime || 1) }); scavenge(d); daze(d, S.dmg.sum?.support_daze_break_duration_ms / 1000, S); if (A.maimOnBreak) inflict(d, 'maim', S, 1, null, { dur: MAIM.time }); }
    }
  }
  // freeze, heavy stun, electrocute and pin bars: buildup as a % of the enemy's poise; after one fills, it is harder to fill
  // again for a while (GameConstants <name>ThresholdModifier / <name>ModifierDuration)
  const BAR = { freeze: 'Freeze', stun: 'HeavyStun', electrocute: 'Electrocute', pin: 'Pin' };
  // Overwhelming Presence: the enemies in your Presence have its less stun and ailment thresholds
  const awe = (d, k) => { const D = onS('Overwhelming Presence')?.dmg, st = D?.stats; return st && dist(d.pos, pp) <= sheet().overgrow.r ? 1 + st[`skill_overwhelming_pressure_aura_enemy_${k}_threshold_+%`] * (1 + (D.sum['aura_effect_+%'] || 0) / 100) / 100 : 1; };   // its magnitude with the build's aura effect
  // Daze: for its time the enemy takes more stun buildup
  const daze = (d, s, S) => { if (!(s > 0) || S && [S.name, ...(S.g?.supports || [])].some(n => flagOf(n, 'cannot_daze'))) return;   /* S: the skill that would Daze: not Vaulting Impact, nor one with Dazzle */ if (d.riven?.hits) return; if (!(d.dazed > time)) fx.text(over(d), t('Daze'), css('gold'), .3); d.dazed = Math.max(d.dazed || 0, time + s); };
  function build(d, a, n, S, A) {
    if (!(n > 0) || d.st[a] > 0 || d.imm[a] > 0) return;
    if (a === 'stun' && d.dazed > time) n *= 1 + DAZE.stun * (sheet().dazeMag || 1) / 100;
    const G = BAR[a], hard = d.lock[a] > 0 ? 1 + GC[G + 'ThresholdModifier'] / 100 : 1;
    d.bar[a] = (d.bar[a] || 0) + n / (Math.max(1, (a === 'stun' ? d.stat.poise : d.stat.ailPoise) * awe(d, a === 'stun' ? 'stun' : 'ailment')) * hard) * 100; d.calm = 0;
    if (a === 'stun' && S.dmg?.sum?.cannot_cause_stun_but_allow_stun_buildup) { d.bar.stun = Math.min(d.bar.stun, 100); return; }   // Brink: it builds up, and the hit of another skill Stuns
    if (d.bar[a] < (['freeze', 'electrocute', 'pin'].includes(a) && sheet().ccAt || 100)) return;   // Sine Aequo: Immobilised at its share of the buildup
    d.bar[a] = 0; d.lock[a] = GC[G + 'ModifierDuration'];
    inflict(d, a, S, 1, null, { dur: a === 'freeze' ? DUR.freeze * A.freezeTime * vsAil(A, 'freeze', 'dur', d, S) : a === 'pin' ? DUR.pin * (A.pinTime || 1) : DUR[a] });
    if (a === 'stun' && !S.src) trigger(S, 'heavyStun', d);   // Smash to Smithereens
    // Impact Shockwave: an Aftershock (keywords.json: the same damage) on the other enemies within its radius of the one it Heavy Stuns
    const IW = a === 'stun' && !S.src && !S.shockwave && S.dmg?.sum?.support_impact_shockwave_base_non_slam_aftershock_on_heavy_stun_radius;
    if (IW) { const c = { x: d.pos.x, z: d.pos.z }; say(t('Aftershock of {0}', S.label), S.el); fx.explode(c, IW / 10, S.el, { soft: true }); for (const e of inside(c, IW / 10)) if (e !== d) hit(e, { ...S, shockwave: true }); }
    if (a === 'stun' && ['rare', 'unique'].includes(d.stat.rarity)) { gainPct('life', recOn('stunRare')); if (sheet().endOnStunRare) gainCharge('endurance', S.label); }   // Cranial Impact
    const H = a === 'stun' && !S.src && S.dmg?.onHit;   // Enduring Impact: endurance charges on heavy stunning
    if (H) for (let k = d.stat.rarity === 'unique' ? H.stunEnduranceUnique : Math.random() * 100 < H.stunEndurance ? 1 : 0; k > 0; k--) chargeBy('endurance', S);
    if (a === 'stun' && !S.src) vanguard(S, true);
  }
  // Vanguard: stunning with a supported skill grants its Guard per 10 Strength for its duration, more on a heavy stun
  function vanguard(S, heavy) {
    const U = S.dmg?.sum || {}, per = (U.gain_X_guard_on_stun_per_10_strength || 0) + (heavy ? U.gain_X_guard_on_heavy_stun_per_10_strength || 0 : 0);
    const g = per * Math.floor((sheet().attrs?.str || 0) / 10);
    guardFor(g, U.guard_on_stun_guard_duration_ms / 1000);
  }
  // damage over time of the skill itself (Contagion, Essence Drain...): its value per second from the game data, after resistances
  function dotOf(d, S) {
    const list = S.dmg && !APPROX.has(S.src) ? Object.entries(S.dmg.dot) : [];
    if (!list.length) return { dps: (d.max + d.maxEs) * SIM.dot / 8, sim: true, el: S.el };
    let dps = 0, el = list[0][0], best = 0;
    // Derange: its more damage over time per 100 Intelligence
    const DR = 1 + (S.dmg.finals?.[DERANGE] || 0) * Math.floor((sheet().attrs?.int || 0) / 100) / 100;
    for (const [e, v] of list) { const got = defence(d, e, v * S.mult * DR, false); dps += got; if (got > best) { best = got; el = e; } }
    return { dps, sim: Math.abs(S.mult - 1) > .001, el };
  }
  function dot(d, S) {
    const o = d.dots.find(o => o.name === S.name), s = S.P.dur || durOf(S) || 5, v = dotOf(d, S);
    // Drain Ailments: a spell's damage over time Consumes an ailment of the enemy (one at random) for its more damage
    const DA = S.P.spell && S.dmg?.finals?.['support_drained_ailment_damage_over_time_+%_final_if_ailment_consumed'], on = DA ? DRAINED.filter(a => has(d, a)) : [];
    if (on.length) { consume(d, S, on[Math.floor(Math.random() * on.length)]); v.dps *= 1 + DA / 100; }
    if (o) Object.assign(o, v, { s, S, spreads: 0 }); else d.dots.push({ s, name: S.name, label: S.label, spread: !!S.P.spread, chaos: S.els.includes('chaos'), S, ...v });
    d.by = S; return d.dots.find(o => o.name === S.name);
  }
  // Pounce: its Mark goes on the highest Rarity enemy its leap hits (one Mark per use: a hit of the same use on a rarer
  // one moves it), the Mark gem socketed in it instead of Predator's Mark; its Wolf Minions leap to it at once
  function pounceMark(d, S) {
    const on = dummies.find(e => e.mark?.pounce === time && !e.dead); if (on && (on === d || POWER[on.stat.rarity] >= POWER[d.stat.rarity])) return;
    if (!on) for (const o of objs) if (o.minion && !o.dead && /Wolf/.test(o.ofS)) { const q = around(d.pos, 1.2); o.pos.set(q.x, 0, q.z); }
    for (const e of dummies) if (e.mark?.pounce != null) e.mark = null;   // one at a time (number_of_marks_allowed_per_type)
    const SM = api.build().gems.map((g, i) => g.meta === 'Pounce' && base(i)).find(x => x?.kind === 'mark');
    if (SM) markOn(d, SM); else wolfMark(d, S); if (d.mark) d.mark.pounce = time;
  }
  // Predator's Mark Activating as its enemy dies: Summon Wolf, Wolf Minions that follow you as long as they live (calc.js
  // out.wolf), one more for a unique enemy (its rare's: none), up to its limit (the Gemling quality's more)
  function wolfCall(M, d) {
    const W = M.S.dmg?.wolf, P = M.S.dmg.part, st = M.S.dmg.stats; if (!W) return;
    const n = 1 + (P['skill_cross_slash_triggered_summon_+_wolves_if_' + d.stat.rarity] || 0), S = { ...M.S, src: undefined, name: 'Summon Wolf', label: t('Summon Wolf'), dmg: W };
    for (let k = 0; k < n; k++) { limit(o => o.kind === S.name, P.number_of_wolves_allowed + (st.number_of_wolves_allowed ?? st._mods?.number_of_wolves_allowed ?? 0), S); minion(S, around(d.pos, 1), Infinity, { kind: S.name, look: wolfLook(WOLFC, 1.2, wolfIn) }); }
  }
  // Predator's Mark (Pounce's own part): increased damage taken per enemy near it (hit), 8 s (the scene's mark default, as in its data)
  function wolfMark(d, S) {
    const P = S.dmg.part, st = S.dmg.stats, k = "skill_wolf_mark_damage_taken_+%_";
    d.mark = { at: time, s: 8, els: [], label: t("Predator's Mark"), name: "Predator's Mark", hits: 0, R: S.A, S: { ...S, src: 'mark' }, wolf: { per: P[k + 'per_nearby_enemy'] + (st[k + 'per_nearby_enemy'] || 0), cap: P[k + 'cap'] + (st[k + 'cap'] || 0) } };
    fx.ring(d.pos, 2.2, .5, 'mark', .4);
  }
  function markOn(d, S) {
    // Living Bomb, Untether: up to their most seeds at a time, the oldest gives way (and the Marks that have a limit of marked targets)
    const LB = S.dmg?.stats?.living_bomb_base_number_of_bombs_allowed ?? S.dmg?.stats?.number_of_marks_allowed_per_type;
    if (LB) { const on = dummies.filter(e => e !== d && e.mark?.name === S.name).sort((a, b) => a.mark.at - b.mark.at); while (on.length >= LB) on.shift().mark = null; }
    d.mark = { at: time, s: sh(S).duration || S.P.dur || 8, els: S.P.els, label: S.label, name: S.name, D: S.dmg?.mark, gain: S.P.gain, bomb: S.P.bomb, hits: 0, R: S.A, S: { ...S, src: 'mark', ail: ailOf(S.P.els) }, hound: S.dmg?.stats?.['hunters_mark_%_of_phys_damage_over_time_as_build_up'] != null && S };
    if (MARK_RUNE[S.name]) fx.glow(runeAt(d), .8, HM.flash, .15, 3);   // its own flash as it lands
    else { fx.ring(d.pos, 2.2, .5, 'mark', .4); fx.bolt(hand(), V(d.pos.x, 2, d.pos.z), 'mark', .15, .02, .1); }
  }
  // Called Shots: while it is on, every five seconds a Mark placed in it marks its number of unmarked enemies within its
  // radius, the nearest; a consumed one passes (its meta_support's chance) to the nearest unmarked enemy within 3 m of
  // that one. note: the five seconds and the 3 m are poe2db's text, not in the app's data; the "at most once every few
  // seconds" of the passing is not either, so it is not limited
  const CALLED = { every: 5, spread: 3 };
  const unmarked = (p, r) => dummies.filter(e => !e.dead && !e.mark && dist(e.pos, p) <= r).sort((a, b) => dist(a.pos, p) - dist(b.pos, p));
  function called() {
    const CS = onS('Called Shots'); if (!CS || time - (me.calledAt ?? -99) < CALLED.every) return;
    me.calledAt = time;
    api.build().gems.forEach((g, i) => { const S = g.meta === 'Called Shots' && base(i); if (S?.kind === 'mark') for (const d of unmarked(pp, CS.A).slice(0, CS.dmg.stats.deadeye_meta_marks_number_of_enemies_to_mark)) markOn(d, { ...S, called: CS }); });
  }
  // Things that react to what happens: meta gems fill their energy, persistent buffs grant charges.
  function metaWants(P) {
    if (/Dodge/.test(P.name)) return ['dodge'];
    if (/Minion Death/.test(P.name)) return ['miniondeath'];
    if (P.els.length) return [...new Set(P.els.flatMap(e => e === 'cold' ? ['freeze'] : AILMENT[e] ? [AILMENT[e]] : []))];
    return ['hit'];
  }
  // the skills a meta gem triggers: the spells put in it (Feral Invocation: its Shapeshifting attacks; Thundergod's Wrath: its
  // Lightning spells, the only ones it takes)
  const trigsOf = T => api.build().gems.flatMap((g, j) => { const b = api.usedBy(j) === T.g && base(j); return b && !NOHIT.has(b.kind) && (T.manaPer ? b.P.attack && api.info(g).gem?.types?.includes('Shapeshift') : b.P.triggerable && b.P.spell) ? [j] : []; });
  // Energy (keywords.json): a meta gem with its gains in the data (Cast on X, Invocations) gains its centienergy per Power (per block: Cast on Block)
  // of the enemy (Feral Invocation: per its mana spent), more by its increased energy; its maximum is 1 per its ms of the
  // triggered skill's use time, at which it triggers it. note: each spell put in it fills its own Energy to its own maximum
  // (keywords.json: "its own Energy count"); the buff shows the first one's. An Invocation stores up to its maximum and triggers when used, as
  // many times as its energy covers. Modifiers to its total use time count as though double (keywords.json Energy): the
  // whole of them, increased and more together, against its base cast time
  const spendRage = n => { me.rage -= n; (me.rageSpent ||= []).push([time, n]);   // what was spent Recently: Primal Hunger
    const DP = sheet().prowess; if (DP) for (me.dpRage = (me.dpRage || 0) + n; me.dpRage >= DP; me.dpRage -= DP) me.dp = [...prowess(), time + 10].slice(-3); };   // Amor Mandragora: Druidic Prowess per X Rage spent (KeywordPopups' text: 10 s each, up to 3)
  const prowess = () => (me.dp || []).filter(u => u > time);   // Druidic Prowess: 10% increased skill speed and 3 Rage on spell hits a stack (its keyword's text)
  function gainEnergy(T, n) {   // the spells it triggers
    if (T.cap && sheet().ritual) return;   // Ritual Cadence: an Invocation gains no Energy, it triggers on its own (the frame loop)
    const js = trigsOf(T), x = n * T.more * (1 + ((me.mana >= me.maxM ? sheet().energyFullMana || 0 : 0) + (meIs.CritRecently() ? sheet().energyCrit || 0 : 0)) / 100);   // Idle Hands: more on full mana; Evocational Practitioner: after a Critical Hit
    for (const j of js) {
      const D = base(j).dmg, b = D?.castTime && 1000 / D.castTime, u = D?.useTime ? 1 / D.useTime : D?.speed, a = D?.addT || 0, u0 = u && a ? 1 / (1 / u - a) : u,   // its use time, not its cooldown; its added total time (Comet's) apart
        ms = u0 ? 1000 * ((b ? 1 / (b * Math.max(.1, 2 * u0 / b - 1)) : 1 / u0) + 2 * a) : 1000 * SIM.castTime;
      T.N[j] = ms / T.perMs; T.E[j] = Math.min(T.cap || T.N[j], (T.E[j] || 0) + x);
    }
    energyOf(T, js);
  }
  const energyOf = (T, js) => { T.energy = T.E[js[0]] || 0; T.need = T.N[js[0]] || 0; };
  function metaFire(T, js, at = near(pp, 30)?.pos || { x: pp.x, z: pp.z }) {   // a meta gem triggers these spells
    say(t('{0} triggers {1}', T.label, [...new Set(js)].map(j => base(j).label).join(', ')), T.el);
    if (CAST_ON[T.name]) metaTrig(T.name); else fx.glow({ x: pp.x, y: 2.2, z: pp.z }, 1.4, T.el, .4);
    js.forEach((j, q) => later(.12 + q * .25, () => use(j, { at: { x: at.x, z: at.z }, src: 'meta', rand: T.rand })));
  }
  function invoke(T) {
    const js = trigsOf(T), go = [];
    for (const j of js) while (T.E[j] >= T.N[j]) { T.E[j] -= T.N[j] * (Math.random() * 100 < (sheet().invokeHalf || 0) ? .5 : 1); go.push(j); }   // the tree's chance a spell costs half
    energyOf(T, js);
    if (!go.length) return toast(t('{0} needs {1} Energy', T.label, Math.ceil(T.need)));
    metaFire(T, go);
  }
  // The Cast on X family's look (each one's SkillArtVariations: activate_<kind>.epk as it is turned on, crit_activate.ao
  // and <kind>_surge.ao as it triggers): turned on, your skin flashes in its activation's colour (activation<kind>_skin,
  // its colour look-up's top: lightning 0.75 / 0.87 / 2.5, INT 0.17 / 0.36 / 3, DEX 0.39 / 2 / 0.3, STR 2 / 0.25 / 0.25,
  // elemental 1.26 / 1 / 2, necro 1.36 / 2 / 1.2, energy shield 0.7 / 1.34 / 2) with a lens flare and strings for
  // 0.12-0.75 s; lightning's core adds 16 bolts out of your chest for 0.09-0.45 s, elemental's 4 flames for 0.25-0.65 s
  // (activationFire 2 / 0.91 / 0.3) and 6 cold shards for 0.45-1.1 s (activationCold 0.9 / 1.34 / 2). As it triggers, a
  // star flare for 0.2 s and a ring for 0.35 s (trigger_activate: crit_star, crit_ring, boosted 1 / 1 / 2) and its
  // surge's trail rising round you (lightning_trail boosted 1 / 1.2 / 1.4; chaos_trail the chaos theme's 0.63 / 0.38 / 1;
  // fire_trail boosted 1.4 / 1.2 / 1 with flames for 0.25-0.35 s; necro_trail 0.7 / 1 / 0.73).
  // note: the skin's flash is a glow on you; the trail rises in a bolt (its path is surge.ast's bones)
  const SKIN = { silver: 0x9daaff, lightning: 0x4d59ff, INT: 0x0e1fff, DEX: 0x32ff26, STR: 0xff2020, elemental: 0xa180ff, necro: 0xadff99, eshield: 0x59abff, fire: 0xff7426, cold: 0x73abff };
  const SURGE = { lightning: 0xb6daff, chaos: 0xa262ff, fire: 0xffccaa, necro: 0xb3ffba }, STAR = 0x8080ff;
  const CAST_ON = { 'Cast on Block': ['lightning', 'lightning'], 'Cast on Charm Use': ['lightning', 'lightning'], "Thundergod's Wrath": ['lightning', 'lightning'],
    'Cast on Critical': ['INT', 'chaos'], 'Cast on Dodge': ['DEX', 'chaos'], 'Cast on Elemental Ailment': ['elemental', 'fire'], 'Cast on Minion Death': ['necro', 'necro'],
    'Barrier Invocation': ['eshield', 'chaos'], 'Elemental Invocation': ['elemental', 'chaos'], "Reaper's Invocation": ['STR', 'chaos'], Spellslinger: ['eshield', 'chaos'] };
  // other persistent skills with an activation of this family and nothing else: Charge Regulation (charge_mastery_activation:
  // activate_silver.epk, activationSilver_skin 1.23 / 1.33 / 2), Combat Frenzy (combat_frenzy_activation: activate_DEX.epk)
  const ACTIVATE = { 'Charge Regulation': 'silver', 'Combat Frenzy': 'DEX' };
  function metaOn(k) {
    const a = CAST_ON[k]?.[0] || ACTIVATE[k], col = SKIN[a], c = V(pp.x, 1.2, pp.z);
    fx.flash(pp, col, 8, .3, 5); fx.glow(c, 1.6, col, .35, 2.5);
    fx.emit(24, { p: c, r: .35, h: 1, v: 1.6, life: .75, size: .05, c: col, c2: 'white', k: 2.4, drag: 2 });   // its strings
    if (a === 'lightning') for (let j = 0; j < 16; j++) { const q = rnd(TAU); fx.bolt(c, V(c.x + Math.cos(q) * 1.3, c.y + rnd(-.7, .9), c.z + Math.sin(q) * 1.3), col, rnd(.09, .45), .03); }
    if (a === 'elemental') {
      fx.emit(4, { p: c, r: .3, v: 1.2, up: 1, life: .65, size: .35, grow: 1.6, c: SKIN.fire, k: 2.2, drag: 2 });
      fx.emit(6, { p: c, r: .3, v: 2, up: .5, life: 1.1, size: .08, c: SKIN.cold, k: 2.2, g: 4, drag: 1 });
    }
  }
  function metaTrig(k) {
    const s = CAST_ON[k][1], col = SURGE[s], c = { x: pp.x, y: 1.3, z: pp.z };
    fx.glow(c, 1.4, STAR, .2, 3); fx.ring(pp, .2, 1.1, STAR, .35, { a: .7, y: 1.3 });
    fx.bolt(V(pp.x + .45, 0, pp.z), V(pp.x - .2, 2.4, pp.z + .2), col, .3, .035, s === 'lightning' ? .32 : .08);
    fx.emit(10, { p: { x: pp.x, y: .2, z: pp.z }, r: .5, v: .2, up: 4, life: .4, size: .05, c: col, k: 2.4, drag: 1 });
    if (s === 'fire') fx.emit(8, { p: { x: pp.x, y: .5, z: pp.z }, r: .4, v: .4, up: 2, life: .35, size: .25, grow: 1.5, c: col, k: 2, drag: 1 });   // its flames
  }
  function event(type, p, S, d, n) {   // n: how much of it, where the gain is not per the enemy's Power
    if (S.src === 'meta') return;
    for (const k in tog) {
      const T = tog[k];
      if (T.kind === 'meta' && (T.per ? T.per[type] : T.wants.includes(type))) {
        let js = trigsOf(T);
        if (T.per) { gainEnergy(T, T.per[type] / 100 * (n ?? pow(d)) * (1 + (S.dmg?.stats?.['active_skill_energy_generated_+%_final'] || 0) / 100));   /* the skill's own less Energy generated (Flame Wall, Incinerate) */ if (T.cap) continue; js = js.filter(j => T.E[j] >= T.N[j]); if (!js.length) continue;
          for (const j of js) T.E[j] -= T.N[j] * (Math.random() * 100 < (sheet().trigRefund || 0) ? .5 : 1);   // the tree's half of it refunded
          energyOf(T, trigsOf(T)); }
        else { if (!js.length || ++T.energy < T.need) continue; T.energy = 0; js = js.slice(0, 1); }
        metaFire(T, js, p);
      }
    }
  }
  // Culling Strike: a skill that culls (its description), or any of yours with Culling Strike (Rare and Unique enemies);
  // checked before the hit's damage, the threshold raised by its +%. A cull recovers Life Drain's and Soul Drain's % of your
  // maximum life and mana
  const underCull = (d, S) => d.life + d.es <= (d.max + d.maxEs) * CULL[d.stat.rarity || 'normal'] * (1 + ((gst(S)['culling_strike_threshold_+%'] || 0) + (time - (me.culledAt ?? -99) <= RECENT ? sheet().cullRecent || 0 : 0) + (time < me.cullUp?.until ? me.cullUp.inc : 0) + (time < me.fear?.until ? me.fear.n * FEAR.cull : 0) + (has(d, 'immobilised') ? sheet().cullImmob || 0 : 0) + (['rare', 'unique'].includes(d.stat.rarity) ? sheet().cullRare || 0 : 0)) / 100) / 100;   // the tree's: against Immobilised, Rare or Unique enemies
  // Culling Strike II: its increased threshold for 20 seconds after culling with it (the seconds: its text)
  const cullUp = S => { const n = S.dmg?.sum?.['support_culling_strike_threshold_+%_on_cull_for_seconds_from_code']; if (n) me.cullUp = { inc: n, until: time + 20 }; };
  const cullable = (d, S) => {
    const r = d.stat.rarity || 'normal';
    return !d.dead && (S.P.culls || !S.src && (S.P.attack && sheet().cullBow || sheet().cullMark && d.mark || sheet().cullBeast && d.mon?.category === 'Beast' && meIs.CompanionInPresence()) || S.P.attack && (gst(S).local_cull_frozen_enemies_on_hit && d.st.freeze > 0 || gst(S).local_culling_strike_vs_bleeding_enemies && has(d, 'bleed')) || (r === 'rare' || r === 'unique') && (S.g?.supports?.some(n => /^Culling Strike/.test(n)) || gst(S)['kill_enemy_on_hit_if_under_10%_life'] || d.attr >= attr()?.skill_attrition_culling_strike_at_x_or_more_stacks)) && underCull(d, S);
  };
  // Detonate Living: its hit on an enemy under the Culling Strike threshold kills it, which explodes (its part) with its
  // permillage of the monster's life as physical. note: the game lets it target only such enemies; here any hit, the
  // others take its own small hit
  // a share of a monster's life dealt as one element over an area, as it is (no bonus of the scene's or the build's)
  const spectralBlow = d => { const sp = d.spectral; d.spectral = null; if (sp.n > 0) { pop(d.pos, SPECTRAL, 'fire'); lifeBlast(d.pos, SPECTRAL, { ...sp.S, label: t('Spectral Fire'), mult: 1, gm: 1, dmg: { ...sp.S.dmg, attack: false, crit: 0 } }, 'fire', sp.n); } };   // (no hit roll, no critical hit: not the attack's)
  const lifeBlast = (c, R, X, el, n) => n > 0 && area(c, R, { ...X, el, els: [el], ail: [], src: 'corpse', dmg: { ...X.dmg, hits: { [el]: [n, n] } } }, { noPay: true, noTouch: true });
  // Rapid Assault: its use leaves a spearhead in each enemy its final stab hits (its quality: a chance of another), up
  // to its limit, for its final hit's duration; a Detonator hit explodes them (its detonation part, at the enemy), and
  // Thunderous Leap may leave Shocked Ground there (its quality; keywords.json: 6 s; the area the scene's)
  function spearheads(d, S) {
    const st = S.dmg.parts?.RapidAssaultFinalHitPlayer?.stats; if (!st || d.spearBy === S) return; d.spearBy = S;
    const n = 1 + (Math.random() * 100 < (S.dmg.stats['rapid_assault_%_chance_to_attach_additional_spear'] || 0)), until = time + st.base_skill_effect_duration / 1000;
    d.spears = [...(d.spears || []).filter(u => u.until > time), ...Array.from({ length: n }, () => ({ until, S }))].slice(-st.rapid_assault_attached_spear_limit);
  }
  function spearsOff(d, S) {
    const c = { x: d.pos.x, z: d.pos.z }, list = d.spears.filter(u => u.until > time); d.spears = null;
    for (const u of list) { const X = partOf(u.S, 'RapidAssaultDetonation'); if (X) later(.05, () => boom(c, X.A, { ...X, src: 'detonate' })); }
    if (list.length) say(t('{0} detonates {1}', S.label, list[0].S.label) + ` ×${list.length}`, 'gold');
    if (list.length && Math.random() * 100 < (S.dmg?.stats?.['thunderous_leap_%_chance_for_shocked_ground_when_detonating'] || 0)) ground('shocked', c, SIM.area, GROUND_TIME.shocked, { ...S, src: 'ground' });
  }
  // Detonate Living's look (supports/RunicSupports/DetonateLiving). Cast, runes are pulled into your hand for 0.62-1.38 s
  // (0.07 / 0.37 / 1) with sparks and a curl (0.42 / 0.88 / 1), a wave goes from it for 0.5-0.7 s (0.16 / 0.6 / 1) and
  // the enemy is wrapped in ribbons for 0.75 s with a ring under it for 1 s. An enemy it detonates (explode.ao) flashes
  // for 0.15 s, then a sphere for 0.4 s, 128 sparks for 0.1-0.3 s, a ring for 0.45 s (0.2 / 0.18 / 0.15), dust for
  // 0.75-1.5 s (0.24 grey by 0.16 / 0.33 / 1), embers for 0.75-2 s, its runic liquid (0 / 0.47 / 1) bursting for 0.5 s,
  // flung for 4-6 s and pooled for 4.75-5.25 s, gibs for 3-7 s, a glowing mark for 4 s and blood (0.54 / 0.01 / 0.01)
  // splashed for 8-12 s; none (whiff.ao) a flash for 0.2 s, a ring for 0.25 s, 5 ribbons for 0.45-0.85 s, 15 runes
  // floating for 1-3 s, a curl of smoke for 1-3 s and sparks for 0.35-1.25 s. note: the counts, speeds and sizes are the
  // scene's; its blurs are left out
  const DLIV = { glow: 0x6be0ff, deep: 0x125eff, wave: 0x2999ff, ring: 0x332e26, dust: 0x0a143d, liquid: 0x0078ff, blood: 0x8a0303 };
  function dlCast(c) {
    const H = hand(), l = dist(c, pp) || 1, to = { x: c.x - (c.x - pp.x) / l * .5, z: c.z - (c.z - pp.z) / l * .5 }, q = { x: c.x, y: 1, z: c.z };
    fx.emit(12, { p: H, r: .6, v: .1, life: 1, size: .07, c: DLIV.deep, c2: DLIV.glow, k: 2.4, drag: 1 });
    fx.emit(8, { p: H, r: .1, v: 1.2, up: .4, life: .6, size: .04, c: DLIV.glow, c2: 'white', k: 2.4, drag: 2 });
    fx.strip(H, to, .5, DLIV.wave, .5, { a: .5, k: 1.8, y: H.y });
    for (let i = 0; i < 4; i++) { const a = rnd(TAU); fx.streak(V(c.x + Math.cos(a) * .4, rnd(.3, 1.6), c.z + Math.sin(a) * .4), V(c.x - Math.sin(a) * .4, rnd(.3, 1.6), c.z + Math.cos(a) * .4), DLIV.wave, .75, .03, .6); }
    fx.ring(c, .2, 1.1, DLIV.glow, 1, { a: .6, tex: 'outline' }); fx.glow(q, .6, DLIV.glow, .3, 2);
  }
  function dlWhiff(c) {
    const q = { x: c.x, y: 1, z: c.z };
    fx.glow(q, .9, DLIV.deep, .2, 2.4);
    later(.1, () => {
      fx.ball(q, .5, DLIV.glow, .25, 2.2);
      for (let i = 0; i < 5; i++) { const a = rnd(TAU); fx.streak(V(q.x, q.y, q.z), V(q.x + Math.cos(a) * .8, q.y + rnd(-.3, .5), q.z + Math.sin(a) * .8), DLIV.glow, rnd(.45, .85), .025, .5); }
      fx.emit(10, { p: q, r: .2, v: 2, up: .5, life: .8, size: .04, c: DLIV.glow, c2: 'white', k: 2.4, g: 2, drag: 1.5 });
    });
    fx.emit(15, { p: q, r: .6, v: .2, up: .3, life: 2, size: .09, c: DLIV.deep, c2: DLIV.glow, k: 2, drag: 1 });
    fx.emit(4, { p: q, r: .3, v: .2, up: .6, life: 2, size: .4, grow: 1.6, c: DLIV.wave, smoke: true, a: .25, drag: 1 });
  }
  function dlBlast(c, R) {
    const q = { x: c.x, y: .9, z: c.z }, g = { x: c.x, z: c.z };
    fx.glow(q, R * .8, DLIV.glow, .15, 3); fx.flash(q, DLIV.glow, 30 + R * 10, .2, 6 + R * 3);
    later(.1, () => {
      fx.emit(24, { p: q, r: .2, v: 1.5, up: 1, life: 1.4, size: .04, c: DLIV.glow, c2: 'white', k: 2.2, g: 1, drag: 1.2 });
      fx.emit(10, { p: q, r: .2, v: 4, up: 3, life: 5, size: .08, c: DLIV.liquid, c2: DLIV.glow, k: 1.6, g: 9, drag: .4 });
      fx.disc(g, R * .4, DLIV.glow, 4, { a: .3, hold: .6, k: 1.4 }); fx.disc(g, R * .45, DLIV.liquid, 5, { a: .45, tex: 'patch', hold: .8, y: .03 });
    });
    later(.15, () => {
      fx.ball(q, R * .45, DLIV.glow, .4, 1.8); fx.ball(q, R * .3, DLIV.liquid, .5, 1.2); shake = Math.max(shake, Math.min(.4, R * .08));
      fx.emit(128, { p: q, r: .2, v: R * 4, up: 1, life: .2, size: .04, c: DLIV.glow, c2: 'white', k: 2.6, drag: 3 });
      fx.emit(4, { p: q, r: .4, v: 1, up: .5, life: 1.1, size: R * .5, grow: 1.6, c: DLIV.dust, smoke: true, a: .5, drag: 1.5 });
      fx.emit(14, { p: q, r: .3, v: 3, up: 2.5, life: 5, size: .09, c: DLIV.blood, g: 9, drag: .5 });
      fx.disc(g, R * .5, DLIV.blood, 10, { a: .6, tex: 'patch', hold: .8, y: .02 });
    });
    later(.2, () => fx.ring(g, R * .2, R, DLIV.ring, .45, { a: .8, y: .3 }));
  }
  function detonate(d, S) {
    const X = partOf(S, 'DetonateLivingExplodePlayer'), c = { x: d.pos.x, z: d.pos.z }, n = d.max * (X?.dmg.stats.corpse_explosion_monster_life_permillage_physical || 0) / 1000;
    me.culledAt = time; cullUp(S); if (sheet().uEv?.fearCull) me.fear = { n: Math.min(FEAR.max, (time < me.fear?.until ? me.fear.n : 0) + sheet().uEv.fearCull), until: time + FEAR.time };   /* Horror's Flight */ fx.text(over(d), t('Culling Strike'), css('blood'), .4); damage(d, d.life + d.es, S);
    if (X) later(.05, () => { dlBlast(c, X.A); area(c, X.A, { ...X, mult: S.mult, src: 'detonate' }); lifeBlast(c, X.A, X, 'physical', n); });
    return true;
  }
  function cull(d, S, any = false) {
    if (!(any ? !d.dead && underCull(d, S) : cullable(d, S))) return false; const X = gst(S);
    // Thrill of the Kill: culling a shocked enemy, its buff: its share of attack damage as extra lightning and its shock chance
    const TS = X.support_thrill_of_the_kill_buff_base_duration_ms / 1000;
    if (TS && d.st.shock > 0) { me.thrill = { X, until: time + TS }; setBuff({ label: api.info({ name: S.g.supports.find(n => /^Thrill of the Kill/.test(n)) }).label, c: css('lightning'), s: TS }); }
    me.culledAt = time; cullUp(S); if (sheet().uEv?.fearCull) me.fear = { n: Math.min(FEAR.max, (time < me.fear?.until ? me.fear.n : 0) + sheet().uEv.fearCull), until: time + FEAR.time };   /* Horror's Flight */ fx.text(over(d), t('Culling Strike'), css('blood'), .4); damage(d, d.life + d.es, S);
    me.life = Math.min(me.maxL, me.life + me.maxL * (X['recover_%_maximum_life_on_cull'] || 0) / 100 + (X.active_skill_life_gained_on_cull || 0)); me.mana = Math.min(me.maxM, me.mana + me.maxM * (X['recover_%_maximum_mana_on_cull'] || 0) / 100);
    return true;
  }
  // Bloodhound's Mark: the marked enemy heavily stunned, or killed after enough blood loss (its % of the stun threshold),
  // consumes it for Blood Explosion there, its more damage and area up to its most from the buildup
  // Bloodhound's Mark's look (BuffVisualOrbs HuntersMarkOrb: curses_02/marks mark_hunter): its rune over the marked enemy
  // (mark_runes HuntersMark, red 1 / 0.07 / 0.09), a red flash as it lands (mark_hunter_surge 0.15 s, 1 / 0.15 / 0.15),
  // and as it ends a red core for 0.2 s with 32 sparks and embers for 1-3 s (mark_hunter_break); its Blood Explosion
  // (HuntersMarkExplosion: mark_hunter_explode): a flash for 0.15 s (2 / 0.24 / 0.1), a red ring for 0.25 s (up to
  // 2 / 0.22 / 0.04), 32 spikes of blood for 0.2-0.3 s (2 / 0.27 / 0.1), a burst of blood for 0.5 s, 32 puffs of blood
  // mist for 1-3 s (0.1 / 0 / 0) and 16 ribbons of blood for 10 s (0.03 / 0 / 0). note: the burst's colour, the embers'
  // and the rune's height over the head are the scene's; its ribbons are drawn as blood falling and staining the ground
  const HM = { rune: 0xff1218, flash: 0xff2626, core: 0xff0d0d, spark: 0xff8080, ember: 0xb01010, blast: 0xff1f0d, ring: 0xff1c05, spike: 0xff2213, burst: 0x5a0000, mist: 0x1a0000, ribbon: 0x0b0000 };
  const MARK_RUNE = { "Bloodhound's Mark": ['huntersmark', HM.rune] };   // each Mark's own rune (curses_02/marks/mark_runes)
  const runeAt = d => d.fig.rune.getWorldPosition(V(0, 0, 0));
  function hmBreak(d) {
    const at = runeAt(d); fx.glow(at, 1.6, HM.core, .2, 3);
    fx.emit(32, { p: at, r: .1, v: 3, life: .1, size: .04, c: HM.spark, k: 2.5, drag: 2 });
    fx.emit(10, { p: at, r: .2, v: .6, up: .3, life: 2, size: .05, c: HM.ember, k: 1.6, g: -.2, drag: 1 });
  }
  function hmBlast(c, R) {
    const at = { x: c.x, y: .8, z: c.z };
    fx.flash(c, HM.blast, 10, .15, 5); fx.glow(at, R * 1.2, HM.blast, .15, 3); fx.ring(c, .2, R, HM.ring, .25, { a: .9 }); fx.ball(at, R * .5, HM.burst, .5, 1.4);
    for (let i = 0; i < 32; i++) { const a = rnd(TAU), l = R * rnd(.4, 1); fx.strip(c, { x: c.x + Math.sin(a) * l, z: c.z + Math.cos(a) * l }, .1, HM.spike, .25, { a: .8, k: 1.4, y: .07 }); }
    fx.emit(32, { p: at, r: R * .3, v: R * .8, up: .4, life: 2, size: .7, grow: 1.6, c: HM.mist, smoke: true, a: .7, drag: 1.2 });
    fx.emit(16, { p: { x: c.x, y: 1.4, z: c.z }, r: .2, v: R * 1.2, up: 4, life: 1.4, size: .1, c: HM.ribbon, smoke: true, a: .95, g: 12, drag: .3 });
    fx.disc(c, R * .8, HM.ribbon, 10, { dark: true, a: .85, tex: 'patch', hold: .8, y: .03 });
    shake = Math.max(shake, Math.min(.5, R * .09));
  }
  function houndBlow(d, full) {
    const M = d.mark, X = M?.hound; if (!X) return; const st = X.dmg.stats, k = full ? 1 : Math.min(1, (d.bar.stun || 0) / 100);
    if (!full && (d.bar.stun || 0) < st['hunters_mark_%_of_max_threshold_to_trigger_explosion_on_death']) return;
    d.mark = null; say(M.label, 'blood'); hmBreak(d);
    const c = { x: d.pos.x, z: d.pos.z }, R = M.R * Math.sqrt(1 + st['hunters_mark_explosion_area_of_effect_+%_final_from_buildup'] * k / 100);
    hmBlast(c, R); area(c, R, { ...X, mult: X.mult * (1 + st['hunters_mark_buildup_%_as_explosion_damage_+%_final'] * k / 100) });
  }
  // Blood Hunt: its hit on an enemy with at least its Blood Loss (keywords.json BloodLoss: the physical damage over time
  // it has taken) consumes it and its bleeding in a blood explosion (its part), the area larger by its % per its amount
  // consumed, up to 500%, and the enemies in it losing its % of that Blood Loss as life
  // Blood Hunt's look: its spear's trail (MeleeTrails BloodHuntTrail: spear_bloodhunt bloodHunt_Slash, dark red 0.3 / 0 / 0
  // with a red edge 2 / 0.38 / 0.25), its hit (PunctureOnHitEffect: spear_dash hit_stab, a red spike and flash for 0.2 s,
  // 1 / 0.51 / 0.2 at its core, and 8 embers for 0.5-1 s) and its blood explosion (PunctureWave: bloodHunt_SpearField):
  // spears of blood bursting out for 0.75-1 s (BH_spearProxy, up to 4 / 0.62 / 0.4), a dark ring for 1 s, a dark red
  // blast for 0.62 s (windUp_Blast 0.26 / 0 / 0), 64 grey smoke puffs round it for 2.5-3 s and 48 splats of blood
  // for 3.75-4 s (bloodSplat 0.12 / 0 / 0). note: the number of spears is the scene's; its wind wave and blur are not drawn
  const BH = { trail: 0x4d0000, edge: 0xff3120, spike: 0xff8233, ember: 0x7d0404, spear: 0xff2819, ring: 0x2a0505, blast: 0x410000, smoke: 0x1f1f1f, splat: 0x3a0000 };
  function bhStab(d, dx, dz) {
    const a = { x: pp.x, z: pp.z }, b = { x: d.pos.x + dx * .3, z: d.pos.z + dz * .3 }, at = { x: d.pos.x, y: 1.1, z: d.pos.z };
    fx.strip(a, b, .35, BH.trail, .3, { dark: true, a: .8, y: 1 }); fx.strip(a, b, .08, BH.edge, .25, { y: 1.01 });
    fx.flash(d.pos, BH.spike, 8, .2, 4); fx.glow(at, 1.2, BH.spike, .2, 3);
    fx.emit(8, { p: at, r: .2, v: 3, life: .75, size: .07, c: BH.spike, c2: BH.ember, k: 2, drag: 1 });
  }
  function bhBlast(c, R) {
    const at = { x: c.x, y: .3, z: c.z };
    fx.ring(c, .2, R, BH.ring, 1, { a: .8 }); fx.ball(at, R * .6, BH.blast, .62, 1.4);
    for (let i = 0; i < 12; i++) { const a = i / 12 * TAU + rnd(-.2, .2), l = R * rnd(.6, 1), q = { x: c.x + Math.sin(a) * l, z: c.z + Math.cos(a) * l }; fx.strip(c, q, .24, BH.ember, .9, { dark: true, a: .9 }); fx.strip(c, q, .05, BH.spear, .6, { a: .5, k: 1.2, y: .07 }); }
    fx.emit(64, { p: at, r: R * .3, v: R * 1.2, up: .3, life: 2.75, size: .6, grow: 2, c: BH.smoke, smoke: true, a: .45, drag: 1.5 });
    fx.emit(48, { p: at, r: .2, v: R * 1.8, up: 3, life: 1.2, size: .12, c: BH.splat, smoke: true, a: .95, g: 12, drag: .3 });
    fx.disc(c, R * .9, BH.splat, 3.9, { dark: true, a: .9, tex: 'patch', hold: .7, y: .03 });
    shake = Math.max(shake, Math.min(.5, R * .09));   // as an explosion's
  }
  // Bone Blast: its circle of ritual inscriptions lasts its duration, then bone spikes erupt from the enemies in it, a
  // hit each. Its look (BoneBlastIndicator: wand_boneblast boneBlast_Zone; BoneBlastExplode: boneBlast.epk): green runes
  // for its duration (boneBlast_Runes 1.2 / 3 / 1.7) with dark wisps rising (prepare_boneBlast darkness); as it ends a green
  // wave rising for 0.6 s (boneBlast_apply waveUp 1.2 / 4 / 1.86) and on each enemy its skin glowing green (boneBlast_Glow_Skin
  // 1.8 / 3 / 2.15), bone spikes pinning it for 1 s (pinSpikes boneHinder: bone lit green 1 / 2 / 1.29), blood gushing and
  // embers for 1.5-4 s. note: the runes are the scene's rune texture (the game draws its own), the spikes' number and the
  // bone's and embers' colours are the scene's; the dark wave and its blood ribbons (10 s) are not drawn
  const BBL = { rune: 0x66ff91, wave: 0x4dff77, skin: 0x99ffb7, glow: 0x80ffa4, bone: 0xe6d6b0, dark: 0x020604, blood: 0x5a0006 };
  const BONE = { bone: 0xd8ccb0, glow: 0x7affb8 };   // the necromancer's bone (bone_ringwall_02 boneStake01, its green 0.6 / 1.25 / 0.9)
  function boneBlast(S) {
    const c = S.at, R = S.A, D = S.P.dur || 1, dec = fx.decal(c, R, 'rune', BBL.rune, { a: .85, k: 1.6, spin: .4 });
    fx.emit(6, { p: c, r: R * .6, v: .2, up: .6, life: 1, size: .5, grow: 2, c: BBL.dark, smoke: true, a: .6, drag: 1 });
    later(D, () => {
      dec.remove(); fx.pillar(c, R, 1.6, BBL.wave, .6, .7);
      for (const d of inside(c, R)) {
        const p = { x: d.pos.x, z: d.pos.z };
        fx.glow({ x: p.x, y: 1.1, z: p.z }, .9, BBL.skin, .5, 1.4); fx.spikes(p, .45, { n: 6, h: 1.5, w: .09, c: BBL.bone, dark: true, glow: BBL.glow, dur: 1, inner: 0 });
        fx.emit(8, { p: { x: p.x, y: 1, z: p.z }, r: .2, v: 1.5, up: 2, life: 1, size: .1, c: BBL.blood, smoke: true, a: .9, g: 10, drag: .4 });
        fx.emit(10, { p: { x: p.x, y: .8, z: p.z }, r: .4, h: .8, v: .4, up: .5, life: 2.7, size: .05, c: BBL.glow, k: 1.6, drag: 1 });
        hit(d, S);
      }
    });
  }
  function bloodHunt(S, d) {
    const st = S.dmg.stats, X = partOf(S, 'BloodHuntExplosionPlayer'), xs = X?.dmg.stats, n = d.blood || 0;
    if (!X || n < st.blood_hunt_X_blood_loss_consumed_to_explode) return;
    d.blood = 0; clear(d, 'bleed'); delete d.burn.bleed;
    const c = { x: d.pos.x, z: d.pos.z }, R = X.A * Math.sqrt(1 + Math.min(500, xs['blood_hunt_skill_area_of_effect_+%_final_per_X_blood_loss_consumed_up_to_500%'] * Math.floor(n / xs['blood_hunt_X_blood_loss_consumed_for_skill_area_of_effect_+%_final'])) / 100);
    bhBlast(c, R); area(c, R, { ...X, mult: S.mult });
    for (const e of inside(c, R)) damage(e, n * xs['blood_hunt_explosion_%_blood_loss_to_deal_as_life_loss'] / 100, X, false, true);
  }
  // Wing Blast, Boneshatter: its hit Heavy Stuns an enemy Primed for it (keywords.json PrimedStun), which releases its
  // shockwave (its part; more from a Unique enemy); Wing Blast's has its chance to grant you a Power Charge.
  // note: Wing Blast's knockback and leap back are not simulated
  const SHOCKWAVE = { 'Wing Blast': ['WingBlastStunExplosionPlayer', 'wing_blast_shockwave_damage_+%_final_if_created_from_unique'], Boneshatter: ['BoneshatterShockwavePlayer', 'boneshatter_damage_+%_final_if_created_from_unique'] };
  // Boneshatter's look: its weapon surging with warm energy as it strikes (heavy_strike_SB: heavy_strike_charge
  // vibrationEnergy 15 / 8 / 3, 0.4 s); its shockwave (TraumaStrikeShockwave: supports/aftershock physical_aftershock) a
  // pale ring for 0.35 s (emissive 15 / 10.7 / 8.8), a warm burst for 0.3 s (45 / 25.3 / 16.9), a blur for 0.5 s and
  // 32 puffs of grey dust for 1.5-2.5 s (0.5 / 0.48 / 0.47). note: the shards thrown out along the ring are the scene's
  const BSH = { surge: 0xff8833, ring: 0xffb596, oomph: 0xff8f60, dust: 0x807c79 };
  function bsSurge(d) {
    const at = { x: d.pos.x, y: 1.1, z: d.pos.z };
    fx.glow(at, 1, BSH.surge, .4, 2.5); fx.emit(10, { p: at, r: .15, v: 2.5, life: .4, size: .08, c: BSH.surge, c2: BSH.ring, k: 2.2, drag: 2 });
  }
  function bsBlast(c, R) {
    const at = { x: c.x, y: .5, z: c.z };
    fx.ring(c, .3, R, BSH.ring, .35, { k: 3 }); fx.flash(c, BSH.oomph, 10, .3, 5); fx.glow(at, R * 1.1, BSH.oomph, .3, 3); fx.ball(at, R * .45, BSH.ring, .5, 1.2);
    for (let k = 0; k < 24; k++) { const a = k / 24 * TAU + rnd(.15), r0 = R * rnd(.2, .45), r1 = R * rnd(.75, 1.05); fx.strip({ x: c.x + Math.sin(a) * r0, z: c.z + Math.cos(a) * r0 }, { x: c.x + Math.sin(a) * r1, z: c.z + Math.cos(a) * r1 }, .07, BSH.ring, .35, { y: .1 }); }
    fx.emit(32, { p: at, r: R * .5, v: R * .8, up: .6, life: 2, size: .6, grow: 2.2, c: BSH.dust, smoke: true, a: .5, drag: 1.2 });
    fx.emit(20, { p: at, r: .3, v: R * 3, up: 2, life: .6, size: .1, c: 0xe8dcc4, g: 8, drag: .8 });   // bone splinters
    shake = Math.max(shake, Math.min(.5, R * .09));
  }
  function wingBlast(S, d) {
    if ((d.bar.stun || 0) < PRIMED[d.stat.rarity]) return;
    const [id, uq] = SHOCKWAVE[S.name], st = S.dmg.stats, X = partOf(S, id), c = { x: d.pos.x, z: d.pos.z };
    d.bar.stun = 0; d.lock.stun = GC.HeavyStunModifierDuration; inflict(d, 'stun', S, 1, null, { dur: DUR.stun });
    if (X) { const Y = { ...X, mult: S.mult * uniqueMore(d, X.dmg.stats[uq]), src: 'shockwave' }; if (S.name === 'Boneshatter') { bsBlast(c, X.A); area(c, X.A, Y); } else { fx.ring(c, .3, X.A, 'white', .35); boom(c, X.A, Y); } }
    if (Math.random() * 100 < st['wing_blast_chance_to_gain_power_charge_on_stun_%']) gainCharge('power', S.label);
  }
  // Repulsion: its curse inflicts its Fragility; a hit of yours on the cursed enemy removes it for an explosion there
  // (its own damage and area) with more stun buildup per Fragility, and that enemy cannot be cursed by it for its time.
  // note: its knockback is not simulated
  function repulse(d) {
    const RS = d.curse.S, st = RS.dmg.stats, c = { x: d.pos.x, z: d.pos.z };
    d.curse = d.hexes?.pop() || null; d.noRepulse = time + st.repulsion_curse_when_detonated_prevent_curse_for_X_ms / 1000;
    fx.ring(c, .3, RS.A, 'gold', .4);
    const D = granted('Repulsion Wave', RS.g?.level), X = D && { ...asTrig(RS, { ...D, id: 'Repulsion Wave' }), label: RS.label, src: 'repulsion' }; if (!X) return;
    later(.05, () => boom(c, RS.A, X, { stunX: 1 + st['curse_repulsion_shockwave_hit_damage_stun_multiplier_+%_final_per_fragility_on_special_object'] * st.curse_repulsion_applies_X_fragility / 100 }));
  }
  // Voltaic Barrier: a projectile of yours through its wall is energised; its hit discharges the part's chaining
  // lightning to up to its most other enemies within its radius of the one hit, each beam chaining its number of times
  function discharge(X, d) {
    const n = X.dmg.stats.voltaic_barrier_trigger_maximum_number_of_extra_targets, seen = new Set([d]);
    for (const e of nearest(d.pos, n, e => e !== d && dist(e.pos, d.pos) <= X.A)) chain(chest(d), e, { ...X, src: 'discharge' }, chainsOf(X), seen);
  }
  // Lunar Blessing: it spends all your Rage, its buff longer by its time per Rage spent, gaining its % of all damage as
  // extra cold. While on, a melee hit of yours calls down Moonbeams (its part) after its delay: the first on the enemy
  // hit, its extra ones on enemies within its secondary radius, each its time apart.
  // note: one volley at a time here (its same-target prevention is 0); the werewolf form itself is not simulated
  function lunar(S) {
    const st = S.dmg.stats, n = me.rage, dur = durOf(S) + n * st.skill_lunar_blessing_extend_buff_by_X_ms_per_rage / 1000;
    me.rage = 0; me.lunar = { until: time + dur, S, busy: 0 };
    setBuff({ label: S.label, name: 'lunar', c: css('cold'), s: dur, gain: { el: 'cold', pct: st['wolf_lunar_blessing_all_damage_%_to_gain_as_cold_damage'] } });
    fx.ring(pp, .3, S.A, 'cold', .5); fx.pillar(pp, .5, 4, 'cold', .5, 2); say(t('{0} active', S.label), 'cold');
  }
  function moonbeams(d) {
    const L = me.lunar, X = partOf(L.S, 'WolfLunarBlessingBeamAttackPlayer'); if (!X || time < L.busy) return;
    const xs = X.dmg.stats, wait = xs.wolf_lunar_blessing_beam_attack_delay_ms / 1000, step = xs.wolf_lunar_blessing_beam_attack_delay_between_beams_ms / 1000, R2 = radOf(X, 'secondary');
    L.busy = time + wait + step * xs.wolf_lunar_blessing_beam_attack_extra_beams_to_trigger;
    for (let k = 0; k <= xs.wolf_lunar_blessing_beam_attack_extra_beams_to_trigger; k++) later(wait + k * step, () => {
      const e = k ? nearest(d.pos, 9, e => dist(e.pos, d.pos) <= R2)[Math.floor(rnd(3))] || d : d; if (e.dead) return;
      const c = { x: e.pos.x, z: e.pos.z }; fx.streak(V(c.x, 9, c.z), V(c.x, .1, c.z), 'cold', .2, .1, 1); boom(c, X.A, { ...X, mult: L.S.mult, src: 'moonbeam' }, { soft: true });
    });
  }
  // Harbinger of Madness: an enemy your melee hits kill (no more than once every its time) and a Rare or Unique one your
  // melee attacks hit (its chance) give an Unstable Apparition that charges the nearest other enemy and explodes in its
  // area: its damage, more per the Power of that enemy, plus its share of a slain one's life as physical
  // note: the build's modifiers to its damage are not applied
  function harbinger(d, S, slain) {
    const H = onS('Harbinger of Madness'), st = H?.dmg?.stats; if (!st || S?.src || !S?.P.melee) return;
    if (slain ? time - (me.harbAt ?? -9) < st.skill_grants_spawn_harbinger_of_madness_orb_on_melee_kill_once_per_timer_ms / 1000
      : !(S.dmg?.attack && POWER[d.stat.rarity] >= POWER.rare && Math.random() * 100 < st['unique_chance_to_spawn_harbinger_of_madness_orb_on_hitting_rare_or_unique_enemy_with_melee_attacks_%'])) return;
    if (slain) me.harbAt = time;
    const k = 1 + st['harbinger_of_madness_damage_+%_final_per_power_of_source_enemy'] * pow(d) / 100, add = slain ? d.max * st['harbinger_of_madness_additional_damage_from_%_source_enemy_life'] / 100 : 0;
    const X = { ...H, mult: 1, dmg: { ...H.dmg, hits: { physical: [st.secondary_minimum_base_physical_damage * k + add, st.secondary_maximum_base_physical_damage * k + add] } } };
    const from = { x: d.pos.x, z: d.pos.z }, e = near(from, 12, e => e !== d), to = e ? { x: e.pos.x, z: e.pos.z } : around(from, 3);
    lob(fx.orb('chaos', .2), V(from.x, 1, from.z), V(to.x, .4, to.z), .5, .5, () => boom(to, X.A, X), { trail: 'chaos' });
  }
  // Azmerian Swarms: killing an enemy with an Elemental Ailment (its chance), or hitting a Rare or Unique one with one (its
  // chance), summons a Swarm for its duration, up to its most; their hits deal their more damage per type of Elemental
  // Ailment on the target
  // Its look (fluttermoth: swarm_start / swarm_idle / attack_hit / debuff .pet, Wisp_Colour.fxgraph): each swarm a cloud
  // of 33 to 44 dark moths (BlackMoth, lit in its wisp colour) round a glowing core with flares (1 / 0.85 / 0.79 to
  // 1 / 0.22 / 0.07) and sparks, the wisp colour one of the shader's four (0.12 / 0.52 / 1, 1 / 1 / 0.14, 0.85 / 0.15 / 1,
  // 1 / 0.38 / 0.15); summoned in a surge, its hit a flash on the enemy with 3 to 6 moths and sparks, and an enemy with
  // Faerie Fire wears 44 to 56 moths round its chest and head. note: the shader picks the colour at random by area, one
  // per swarm here (the Faerie Fire's: the swarm's that inflicted it last)
  const MOTH = { wing: 0x3f2928, wisps: [0x1f85ff, 0xffff24, 0xd926ff, 0xff6126], flareA: 0xffd9c9, flareB: 0xff3812 };
  const moths = (() => {
    const N = 900, g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, .03, -.1, 0, .05, -.08, 0, -.02, 0, 0, .03, .1, 0, .05, .08, 0, -.02,
      0, 0, 0, -.07, 0, -.02, -.035, 0, -.08, 0, 0, 0, .07, 0, -.02, .035, 0, -.08], 3));   // fore and hind wings
    const m = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), N), W = new THREE.Color(MOTH.wing);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), P = new THREE.Vector3(), S1 = new THREE.Vector3(), clouds = new Set();
    m.count = 0; m.frustumCulled = false; scene.add(m);
    return {
      add(o) { o.c = W.clone().lerp(new THREE.Color(o.col), .3); o.seed = Array.from({ length: o.n }, () => [rnd(TAU), rnd(-1, 1), rnd(.6, 1.6) * (Math.random() < .5 ? 1 : -1), rnd(.35, 1), rnd(TAU)]); clouds.add(o); return o; },
      update() {
        let i = 0;
        for (const o of clouds) {
          if (o.done()) { clouds.delete(o); continue; }
          const c = o.at(), k = o.grow ? Math.min(1, (time - o.from) / o.grow) : 1;
          for (const [a, y, w, l, f] of o.seed) {
            if (i >= N) break;
            const ang = a + time * w * 2, rr = o.r * l * k;
            P.set(c.x + Math.cos(ang) * rr, c.y + y * o.r * .6 * k + Math.sin(time * 3 + f) * .07, c.z + Math.sin(ang) * rr);
            Q.setFromEuler(E.set(Math.sin(time * 2 + f) * .4, -ang - Math.sign(w) * Math.PI / 2, 0, 'YXZ'));
            m.setMatrixAt(i, M.compose(P, Q, S1.set((.2 + .8 * Math.abs(Math.cos(time * 26 + f))) * .75, .75, .75)));   // wings beating
            m.setColorAt(i++, o.c);
          }
        }
        m.count = i; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
      } };
  })();
  function mothLook(col) {
    let cloud;
    return {
      start(f, p) {
        f.group.children.forEach(c => { c.visible = false; });
        fx.glow({ x: p.x, y: 1, z: p.z }, 1.8, col, .45, 2.2); later(.2, () => fx.glow({ x: p.x, y: 1, z: p.z }, 1, MOTH.flareA, .3, 2.4));
        fx.emit(20, { p: { x: p.x, y: 1, z: p.z }, r: .2, v: 2.2, life: .45, size: .07, c: col, c2: 'white', k: 2.2, drag: 2.5 });
      },
      tick(dt, e) {
        const c = { x: e.pos.x, y: 1, z: e.pos.z };
        cloud ||= moths.add({ n: 33 + Math.floor(rnd(12)), r: .6, col, from: time, grow: .4, at: () => ({ x: e.pos.x, y: 1, z: e.pos.z }), done: () => e.dead });
        if (Math.random() < dt * 10) fx.glow(c, rnd(.35, .55), col, .18, 2.2);
        if (Math.random() < dt * 5) fx.emit(1, { p: c, r: .25, v: .3, life: 1, size: .07, c: MOTH.flareA, c2: MOTH.flareB, k: 2.2, drag: 1 });
        if (Math.random() < dt * 6) fx.emit(1, { p: c, r: .5, v: .2, up: .3, life: .8, size: .05, c: col, c2: 'white', k: 2.4, drag: 1 });
      },
      hit(e, d) {
        const q = chest(d), end = time + .7;
        d.ffCol = col; fx.glow(q, 1.1, MOTH.flareB, .25, 2.4); fx.glow(q, .6, MOTH.flareA, .15, 2.6);
        fx.emit(10, { p: q, r: .2, v: 2, life: .4, size: .06, c: col, c2: 'white', k: 2.4, drag: 2 });
        moths.add({ n: 3 + Math.floor(rnd(4)), r: .5, col, from: time, grow: .5, at: () => q, done: () => time > end });
      } };
  }
  // Azmerian Wolf's look (packleader: PackleaderWolf .mat, skin_01.epk, primalwisps_body_01 / wolfwispy_paws / spawnin
  // .pet): a grey wolf (its fur's colour 0.46 / 0.43 / 0.42) lit by its spirit's blue (custom_lookupcolor up to
  // 0.36 / 0.6 / 1), blue wisps drifting off its body and paws (0.07 / 0.6 / 1 to 0.08 / 0.29 / 0.8), summoned in blue
  // smoke (0.19 / 0.47 / 1). The wolf is Quaternius' (wolf.glb, CC0) with its walk, gallop and bite.
  // note: its size is not in the data (1.6 m long here)
  const PACK = { fur: 0x756e6c, light: 0xb0a9a5, spirit: 0x5c99ff, wispA: 0x1299ff, wispB: 0x144acc, smoke: 0x3078ff };
  const wolfGlb = fetch('wolf.glb').then(r => r.arrayBuffer()), gltfL = import('three/addons/loaders/GLTFLoader.js').then(m => new m.GLTFLoader());
  const packIn = p => { fx.emit(24, { p: { x: p.x, y: .4, z: p.z }, r: .6, v: .6, up: 1.2, life: .9, size: .5, grow: 1.6, c: PACK.smoke, smoke: true, a: .5, drag: 1 }); fx.glow({ x: p.x, y: .6, z: p.z }, 1.6, PACK.spirit, .4, 2); };
  function wolfLook(P = PACK, len = 1.6, summon = packIn) {   // P: its colours (wisps only with P.wispA), len: its length in metres
    let mx, acts, cur, last, bite = 0;
    const play = n => { if (!acts || cur === n) return; acts[n].reset().fadeIn(.15).play(); acts[cur]?.fadeOut(.15); cur = n; };
    return {
      start(f, p) {
        f.group.children.forEach(c => { c.visible = false; }); summon(p);
        Promise.all([wolfGlb, gltfL]).then(([buf, L]) => L.parse(buf.slice(0), '', g => {
          const m = g.scene;
          m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; if (/^Main/.test(o.material.name)) { o.material = o.material.clone(); o.material.color.set(o.material.name === 'Main_Light' ? P.light : P.fur); o.material.emissive.set(P.spirit); o.material.emissiveIntensity = .06; } } });
          const bb = () => { const b = new THREE.Box3(); m.updateMatrixWorld(true); m.traverse(o => o.isBone && b.expandByPoint(o.getWorldPosition(V()))); return b; };   // by its bones (a skinned mesh's own box is not where it is drawn)
          const b = bb(); m.scale.multiplyScalar(len / Math.max(b.max.x - b.min.x, b.max.z - b.min.z)); m.position.y = -bb().min.y; f.group.add(m);
          mx = new THREE.AnimationMixer(m); acts = Object.fromEntries(['Idle', 'Walk', 'Gallop', 'Attack'].map(n => [n, mx.clipAction(g.animations.find(a => a.name === n))]));
          acts.Attack.setLoop(THREE.LoopOnce); play('Idle');
        }));
      },
      tick(dt, e) {
        mx?.update(dt);
        const v = last ? dist(e.pos, last) / dt : 0; last = { x: e.pos.x, z: e.pos.z };
        if (time > bite) play(v > 3 ? 'Gallop' : v > .3 ? 'Walk' : 'Idle');
        if (P.wispA && Math.random() < dt * 14) fx.emit(1, { p: { x: e.pos.x, y: rnd(.35, .85), z: e.pos.z }, r: .45, v: .15, up: .5, life: .9, size: .07, c: P.wispA, c2: P.wispB, k: 2.2, drag: 1 });
        if (P.wispA && Math.random() < dt * 8) fx.emit(1, { p: { x: e.pos.x, y: .06, z: e.pos.z }, r: .4, v: .1, up: .3, life: .6, size: .18, grow: 1.5, c: P.wispA, smoke: true, a: .45, drag: 1 });
      },
      hit() { bite = time + .55; if (cur !== 'Attack') acts?.[cur]?.fadeOut(.1); cur = null; play('Attack'); } };
  }
  // Summon Wolf's and Wolf Pack's wolf (WolfCompanionPlayerSummoned: WolfCompanion.ao, WolfCompanion.sm, WolfCompanionc.mat):
  // its fur's colour (the middle of its texture 79 / 68 / 62, its lightest 5% 149 / 144 / 143), 1.2 m long (its mesh is
  // 225 units long at its 108% size, the Azmerian Wolf's 317 at 1.6 m), fading in (wolf_fadein.epk). note: the fade
  // is a faint puff of dust here
  const WOLFC = { fur: 0x4f443e, light: 0x95908f, spirit: 0 };
  const wolfIn = p => fx.emit(12, { p: { x: p.x, y: .3, z: p.z }, r: .5, v: .4, up: .6, life: .7, size: .4, grow: 1.5, c: 0x6a625e, smoke: true, a: .35, drag: 1 });
  // Cackling Companions' look (HyenaCompanionPlayerSummoned: HyenaArmour.sm, HyenaMonster .mat; HandoftheClan spawn.ao,
  // monster_spawn_IN_smoke.pet; wolfhowl.ao decoytotem_midline.pet): a hyena in its fur's light grey (the lightest 5% of
  // its texture, 124 / 112 / 107: its mean 64 / 54 / 52 is the ground's), 1 m long (its mesh is 197 units long, the
  // Azmerian Wolf's 317), emerging in near-black smoke (0.009 / 0.01 / 0.013) with grey
  // dust (0.22) and debris; 0.81 s in it whoops (its emerge whoop event), Hindering the enemies near it (keywords.json
  // Hinder), and its howl's ring grows for 0.5 s from 0.93 s (ring.mat: tan 0.61 / 0.4 / 0.25, its highlight
  // 1.9 / 0.56 / 0.19), 1100 units across: 2.8 m round at the wolf's scale. Its bite Maims 25% of the time
  // (HyenaCompanionMelee maim_on_hit_%). The hyena is the scene's wolf (wolf.glb, Quaternius CC0) in its colour.
  // note: the whoop Hinders within its howl's ring (the data gives no radius); its belly is its fur's colour too
  const HYE = { fur: 0x7c706b, light: 0x7c706b, spirit: 0, smoke: 0x030304, dust: 0x707070, ring: 0x9b6540, hi: 0xff4b19, R: 2.8 };
  function hyenaLook(S) {
    const MC = monSkill('HyenaCompanionMelee')?.sets[0].const['maim_on_hit_%'] || 0;
    const L = wolfLook(HYE, 1, p => {
      fx.emit(18, { p: { x: p.x, y: .3, z: p.z }, r: .5, v: .5, up: 1, life: 1, size: .45, grow: 1.6, c: HYE.smoke, smoke: true, a: .8, drag: 1 });
      fx.ring(p, .2, 1, HYE.dust, .5, { a: .5 }); fx.emit(12, { p: { x: p.x, y: .1, z: p.z }, r: .5, v: .8, up: .3, life: 1, size: .35, grow: 1.5, c: HYE.dust, smoke: true, a: .45, drag: 1.5 });
      fx.emit(25, { p: { x: p.x, y: .1, z: p.z }, r: .4, v: 2, up: 2.5, life: .9, size: .05, c: HYE.dust, g: 10, drag: .5 });   // its debris
    });
    let whoop = 0;
    return { ...L,
      tick(dt, e) {
        L.tick(dt, e);
        if (whoop === 0 && e.s >= .81) { whoop = 1; for (const d of inside(e.pos, HYE.R)) d.slows.push({ until: time + HINDER.time * (sheet().hinderTime || 1), pct: -HINDER.slow * slowK(S) }); }
        if (whoop === 1 && e.s >= .93) { whoop = 2; fx.ring(e.pos, .2, HYE.R, HYE.ring, .5, { a: .45, y: .5 }); fx.ring(e.pos, .1, HYE.R * .8, HYE.hi, .5, { a: .25, y: .5 }); }
      },
      hit(e, d) { L.hit(e, d); if (Math.random() * 100 < MC) inflict(d, 'maim', S, 1, null, { dur: MAIM.time }); } };
  }
  const ffs = new Map();
  function faerieLook() {
    for (const d of dummies) if (!ffs.has(d) && !d.dead && d.ff?.some(u => u > time))
      ffs.set(d, moths.add({ n: 44 + Math.floor(rnd(13)), r: .45 * (d.sc || 1), col: d.ffCol || MOTH.wisps[3], at: () => ({ x: d.pos.x, y: 1.45 * (d.sc || 1), z: d.pos.z }),
        done: () => { const x = d.dead || !dummies.includes(d) || !d.ff?.some(u => u > time); if (x) ffs.delete(d); return x; } }));
  }
  function swarm(d, slain) {
    const W = onS('Azmerian Swarms'), st = W?.dmg?.stats; if (!st || !EL_AIL.some(a => d.st[a] > 0)) return;
    const pc = slain ? st['skill_grants_%_chance_to_summon_azmerian_swarm_on_kill_affected_by_elemental_ailment'] : POWER[d.stat.rarity] >= POWER.rare ? st['skill_grants_%_chance_to_summon_azmerian_swarm_on_hitting_unique_or_rare_enemy_affected_by_elemental_ailment'] : 0;
    if (!(Math.random() * 100 < pc)) return;
    limit(o => o.kind === W.name, st.max_azmerian_swarms);
    minion(W, around(d.pos, 1), durOf(W), { kind: W.name, look: mothLook(MOTH.wisps[Math.floor(rnd(4))]), more: e => 1 + EL_AIL.filter(a => e.st[a] > 0).length * st['minion_damage_+%_final_per_different_elemental_ailment_on_target'] / 100 });
  }
  // Moment of Vulnerability: its hit on an enemy Primed for Stun, Electrocution or Freeze (keywords.json: its share of the
  // bar by rarity) leaves a visage of it there for as long as that immobilisation would last; its share of the damage
  // the visage takes is dealt to the enemy too. The enemy cannot be ripped again for its delay
  // note: the visage stands still and takes no damage of its own, it only passes the share on
  function ripVisage(d, S) {   // (not visage, Abyssal Apparition's figure below: one declaration hid the other)
    const st = S.dmg.stats, a = !d.visage && !(d.ripAt > time) && ['stun', 'electrocute', 'freeze'].find(a => (d.bar[a] || 0) >= PRIMED[d.stat.rarity]);
    if (!a) return;
    d.ripAt = time + st.rip_from_time_immunity_duration_ms / 1000;
    const v = place(d.pos.x + rnd(-1, 1), d.pos.z + rnd(-1, 1), d.mon, d.level); if (!v) return;
    Object.assign(v, { visage: d, share: st['time_rip_damage_share_%'], until: time + DUR[a] * (a === 'freeze' ? S.dmg.ail.freezeTime : 1) });
  }
  const onsl = () => time < me.wildUntil || time < me.onsUntil || !!sheet().onsAlways || me.cu.some(u => u?.c.ons);   // Onslaught (Savage Fury's frenzy, the tree's on kill)
  function kill(d, S, dot) {   // dot: damage over time did it, not a hit
    if (d.spectral) spectralBlow(d);
    const HS = d.curse && sheet().uEv?.hexSpread; if (HS) for (const e of inside(d.pos, 3).filter(e => e !== d && !e.curse).slice(0, HS)) e.curse = { ...d.curse };   // Veilpiercer: the curse spreads to that many enemies within its text's 3 m
    const KU = sheet().uDef || {}; if (Math.random() * 100 < (KU.esKill || 0)) me.hurt = -99; if (KU.wardKill && me.maxW) me.ward = Math.min(me.maxW, me.ward + me.maxW * KU.wardKill / 100);   // uniques: energy shield recharge starts, Runic Ward
    if (S && !S.src && S.P?.attack && Math.random() * 100 < (sheet().axeOns || 0)) me.onsUntil = time + ONSLAUGHT.time;   // with an axe
    if (/^minion/.test(S?.src) && S.g && api.info(S.g).gem?.types?.includes('Companion') && Math.random() * 100 < (sheet().companionOns || 0)) me.compOns = time + ONSLAUGHT.time;   // the tree's: your Companions' Onslaught on kill
    // Behead: killing a rare, one (two) of its modifiers for its time, as Headhunter's
    { const BH = S && d.stat.rarity === 'rare' && (S.dmg?.sum?.support_executioner_gain_two_rare_monster_mod_on_kill_ms ? 2 : S.dmg?.sum?.support_executioner_gain_one_rare_monster_mod_on_kill_ms ? 1 : 0), ids = BH ? (d.modKey || '').split(',').filter(Boolean).sort(() => Math.random() - .5).slice(0, BH) : [];
      if (ids.length) { (me.hh ||= []).push({ stats: modStats(ids), until: time + (S.dmg.sum.support_executioner_gain_two_rare_monster_mod_on_kill_ms || S.dmg.sum.support_executioner_gain_one_rare_monster_mod_on_kill_ms) / 1000 }); shC.at = -99; } }
    d.dead = true; stats.kills++; if (S) me.killAt = time; if (S && d.st.shock > 0) me.es = Math.min(me.maxE, me.es + me.maxE * (S.dmg?.sum?.['support_recover_%_maximum_energy_shield_killing_shocked_enemies'] || 0) / 100);   /* Shock Siphon */ if (S && Math.random() * 100 < (sheet().volOnKill || 0)) { gainVol(1); }   /* Volatility on kill */ record('kill', S?.label || '?', d.mon.name); if (!S?.src) gainRage(sheet().rage?.gain.kill);
    // Headhunter: a rare monster you kill gives you its modifiers for the text's seconds
    const HH = S && !S.src && sheet().headhunter; if (HH && d.stat.rarity === 'rare' && Object.keys(d.stat.rare).length) { (me.hh ||= []).push({ stats: d.stat.rare, until: time + HH }); shC.at = -99; setBuff({ label: `${t('Headhunter')}: ${d.mon.name}`, c: css('gold'), s: HH }); }
    houndBlow(d, false); harbinger(d, S, true); if (!S?.src) swarm(d, true); popBoils(d);
    // Killing Palm, Cull the Weak: an enemy they kill grants their charges by its rarity
    const kr = { unique: 'unique', rare: 'rare' }[d.stat.rarity] || 'normal_and_magic';
    const KG = S && !S.src ? ['power', 'frenzy'].filter(c => S.dmg?.stats?.[`skill_grant_X_${c}_charges_against_${kr}_monsters`]) : [];
    for (const c of KG) for (let k = S.dmg.stats[`skill_grant_X_${c}_charges_against_${kr}_monsters`]; k > 0; k--) chargeBy(c, S);
    const r = d.stat.rarity || 'normal';   // the kill refills your flasks
    if (sheet().uEv?.soulEater && dist(d.pos, pp) <= sheet().overgrow.r) eatSoul();   // Zerphi's Serape: the Souls of enemies that die in your Presence
    if (d.rfc && sheet().runefather?.max) me.boast = Math.min(sheet().runefather.max, (me.boast || 0) + Math.floor(pow(d)));   // Eyes of the Runefather: a Boast per Power of a challenged enemy you kill
    if (Math.random() * 100 < (sheet().lament?.load || 0)) for (const k in clips) clips[k]++;   // The Last Lament: a bolt loaded into all crossbow skills (note: one already full is not shown as over its clip)
    // Bounty: a killing blow of a supported skill grants its more flask and charm charges
    const BY = !S?.src && S?.dmg?.sum || {}, bk = k => 1 + (BY[`support_${k}_charges_gained_+%_final_from_killing_blow`] || 0) / 100;
    killCharges(d, bk);
    if (r === 'rare' || r === 'unique') charmUse('killing_rare_or_unique_enemy');
    const st = d.st, p = { x: d.pos.x, z: d.pos.z }, frozen = st.freeze > 0 || st.chill > 0 && sheet().chillShatter || S && st.armour > 0 && sheet().brokeShatter, M = d.mark, f = d.fig;
    // Crushing Fear: an enemy it kills is crushed into its shockwave (its part, its secondary radius), more damage and area
    // per the enemy's power (note: the stats say per power of a culled enemy; here of any it kills)
    const CF = S && !S.src && partOf(S, 'CrushingFearNovaPlayer');
    if (CF) {
      const cs = CF.dmg.stats, pw = pow(d), A = radOf(CF) * Math.sqrt(1 + cs['crushing_fear_area_of_effect_+%_final_per_power_of_culled_enemy'] * pw / 100);
      cfDrain(p); later(.1, () => { cfNova(p, A); area(p, A, { ...CF, gm: (CF.gm ?? 1) * (1 + cs['crushing_fear_damage_+%_final_per_power_of_culled_enemy'] * pw / 100) }); });
    }
    if (st.shock > 0) gainBuff(S, 'shockKill');
    // Earthbound: Spark triggered from where a Shocked enemy you kill was, away from you. note: the triggered Spark's own
    // numbers are not in the data: it is the build's Spark ("Add" on the Skills tab), at no cost
    const EB = st.shock > 0 && S && !S.src && sheet().sparkKill && base(byName('Spark'));
    if (EB) { const l = dist(p, pp) || 1; me.trigAt = time; later(.05, () => K.projectile({ ...EB, from: p, dx: (p.x - pp.x) / l, dz: (p.z - pp.z) / l })); }
    if (st.electrocute > 0) trigger(S, 'electrocuteKill', d);
    // Bursting Fen Toad: its chance on a kill for a toad that leaps about and explodes in its area, always Poisoning
    const FT = S?.src ? -1 : byName('Bursting Fen Toad'), T = FT >= 0 && base(FT);
    if (T && Math.random() * 100 < T.dmg.stats['trigger_toad_spawn_chance_%']) fenToad(T, p);
    deathBlast(d, frozen, S);
    // the tree's explosions on kill: a cursed enemy for a quarter of its maximum life as chaos, any for all of it as physical.
    // Zealous Inquisition's chance doubled against Undead and Demons (its text). note: their radius is not in the data (a herald's here)
    const XB = S && sheet().blast, R = () => Math.random() * 100, XK = XB && (d.curse && R() < XB.cursed + (/^minion/.test(S.src) ? XB.allyCursed : 0) ? [.25, 'chaos'] : R() < XB.any * (['Undead', 'Demon'].includes(d.mon?.category) ? 2 : 1) ? [1, 'physical']
      : (d.st.ignite > 0 && R() < XB.burning) || (S.empd && R() < XB.empowered) ? [.1, 'fire'] : R() < XB.phys10 ? [.1, 'physical'] : null);   // a Burning one, or killed by an Empowered attack: a tenth as fire
    if (XK) later(.05, () => { pop(p, SIM.heraldR, XK[1] === 'physical' ? 'blood' : XK[1]); lifeBlast(p, SIM.heraldR, S, XK[1], d.max * XK[0]); });
    if (S && sheet().gloom) later(.05, () => { pop(p, SIM.heraldR, 'chaos'); lifeBlast(p, SIM.heraldR, S, 'chaos', d.max * .25); });   // Palm of the Dreamer's Gloom Shrine: explode_enemies_for_25%_life_as_chaos_on_kill_chance_% (100). note: its radius is the scene's
    // Cannibalism, on a persistent buff that is up: life recovered on kill
    for (const g of api.build().gems) if (tog[g.name]) me.life = Math.min(me.maxL, me.life + me.maxL * (api.damage?.(g)?.lifeOnKill || 0) / 100);
    // the tree's recovery on kill (calc.js killRecover)
    const KR = S && sheet().killRecover;   // none while the sheet is not there yet
    // Killjoy: on-kill effects twice; Snakebite: its % of maximum life per poison on the enemy; Indigon: no mana
    const TW = sheet().killTwice || has(d, 'bleed') && Math.random() * 100 < (S?.dmg?.sum?.['on_kill_effect_occur_twice_chance_%_vs_bleeding_enemies'] || 0);   // Tear: on a Bleeding enemy
    if (KR) for (let k = TW ? 2 : 1; k > 0; k--) { me.life = Math.min(me.maxL, Math.random() * 100 < KR.full ? me.maxL : me.life + KR.life + me.maxL * KR.lifePct / 100 + (has(d, 'poison') ? me.maxL * (KR.poisoned + sheet().poisonKill * (d.burn2?.until > time ? 2 : 1)) / 100 : 0)); if (!sheet().manaRegenOnly) me.mana = Math.max(0, Math.min(me.maxM, me.mana + me.maxM * KR.mana / 100 + KR.manaFlat)); }   // Blessed Bonds' flat mana (Bluetongue's a loss)
    if (S && sheet().onsKill) me.onsUntil = Math.max(me.onsUntil || 0, time + sheet().onsKill);   // Death Rush: Onslaught on kill
    // heralds: an enemy that dies with the ailment of their element explodes
    for (const k in tog) {
      const T = tog[k], a = T.kind === 'herald' && !['Herald of Ash', 'Herald of Plague'].includes(k) && (k !== 'Herald of Thunder' || S?.P?.attack) && AILMENT[T.P.el];   // Herald of Ash: ash(); Herald of Thunder: attack kills
      if (a && st[a] > 0) { const bl = d.blood; later(.1, () => herald(T, p, bl)); }   // its Blood Loss, before the corpse is cleaned
    }
    // Herald of Plague: a poisoned enemy killed spreads its poison to the enemies within its radius, its chance to Hinder them
    const hs = st.poison > 0 && onS('Herald of Plague')?.dmg.stats;
    if (hs) for (const e of inside(p, hs.herald_of_agony_poison_spread_on_kill_radius_base_magnitude_to_grant / 10)) {
      e.st.poison = Math.max(e.st.poison || 0, st.poison); e.burn.poison = { ...d.burn.poison }; fx.bolt(V(p.x, 1, p.z), chest(e), 'poison', .2, .03, .4);
      if (Math.random() * 100 < hs['hinder_chance_%_on_spreading_poioson']) e.slows.push({ until: time + HINDER.time * (sheet().hinderTime || 1), pct: -HINDER.slow * slowK(onS('Herald of Plague')) });
    }
    if (M?.bomb) { trigger(M.S, 'mark', d); later(.06, () => { say(t('{0} explodes on the kill', M.label), 'mark'); bombed(M, p); }); }
    if (M?.wolf) wolfCall(M, d);
    const sp = d.dots.find(o => o.spread);
    if (sp) {   // Contagion spreads itself, the curses and the other chaos debuffs on it to the enemies within its radius, refreshing
      // their durations; its own deals its more damage for each time it has spread, up to its most. Its look: wisps
      // bursting for 1-3 s and the rot on the ground (contagionWisps_death, deathGroundRot), wisps to each one it reaches
      // with a flash on its skin (contagionWisps_spread)
      const carry = d.dots.filter(o => o.spread || o.chaos), hexes = [...(d.hexes || [])].reverse().concat(d.curse || []), list = inside(p, sp.S.A).filter(e => e !== d), from = V(p.x, 1, p.z);
      fx.emit(14, { p: from, r: .4, v: .8, up: .6, life: rnd(1, 3), size: .24, c: CONTAGION.wisp, k: 1.8, drag: 1 }); rotAt(p);
      for (const e of list) { wisps(from, chest(e), 8); later(.25, () => ctFlash(chest(e)));
        for (const o of carry) {
          const x = e.dots.find(x => x.name === o.name), s = durOf(o.S) || o.S.P.dur || 5, v = dotOf(e, o.S), CS = o.spread && o.S.dmg?.stats, n = (o.spreads || 0) + 1;
          if (x) { x.s = s; continue; }
          if (CS?.['contagion_spread_magnitude_+%_final']) v.dps *= 1 + Math.min(CS['contagion_maximum_spread_magnitude_+%_final'], CS['contagion_spread_magnitude_+%_final'] * n) / 100;
          e.dots.push({ ...o, s, ...v, spreads: o.spread ? n : o.spreads }); }
        for (const u of hexes) { hexOld(e, u.name); e.curse = { ...u, s: u.full }; }
        e.by = S; }
      if (list.length) say(t('{0} spreads to {1} enemies', sp.label, list.length), 'chaos');
    }
    if (S.P.gain && !S.P.corpse && !S.src && !KG.length && !['aura', 'mark'].includes(S.P.kind)) chargeBy(S.P.gain, S);   // not on top of its own (Killing Palm's)
    event('kill', p, S); if (S?.P?.melee && !dot) event('melee_kill', p, S, d);   // Reaper's Invocation: per its Power
    if (!S?.src) remnantOn('kill', d);
    if (S?.mantra) { const M = S.mantra, n = Math.min(10, (time < me.purple?.until ? me.purple.n : 0) + 1); me.purple = { n, pct: M.flame, until: time + M.flameFor }; setBuff({ label: t('Purple Flame of Chayula'), name: 'purple', c: css('chaos'), s: M.flameFor }); }   // up to 10 (keywords.json)
    const RP = !S?.src && S?.P?.melee && d.st.bleed > 0 && S.dmg?.sum?.['create_life_remnant_on_melee_kill_bleeding_enemy_%'];
    if (RP && Math.random() * 100 < RP) remnant({ ...S, name: 'Rip' }, around(d.pos, S.dmg.sum.rip_support_life_remnant_creation_radius / 10));
    if (Math.random() * 100 < (S?.dmg?.sum?.['create_verisium_remmant_on_kill_enemy_%'] || 0)) infRemnant('verisium', p, { dur: (S.dmg.sum.base_remnant_duration_ms || 0) / 1000 });   // Runic Extraction
    hatch(p);
    clean(d); d.sig = ''; d.wind = null; d.life = d.es = 0;
    f.ice.visible = f.curse.visible = f.mark.visible = f.rune.visible = f.blood.visible = f.plate.visible = false; f.sack.emissive.setRGB(0, 0, 0);
    if (frozen) {   // frozen enemies shatter: no corpse
      fx.shatter(p); f.group.visible = false; d.corpse = 0; d.back = SIM.respawn;
    } else if (S && !S.src && !dot && sheet().killDestroys) { pop(p, .8, 'blood'); f.group.visible = false; d.corpse = 0; d.back = SIM.respawn;   // hand wraps: "Enemies killed by your Hits are destroyed": no corpse either
    } else { d.corpse = SIM.corpseTime; d.fall = 0; }
  }
  function herald(T, p, blood = 0) {
    const i = byName(T.name), b = i >= 0 && mk(i); if (!b) return;
    const S = { ...b, src: 'herald', ail: ailOf(T.P.els) };
    say(t('{0} explodes on the kill', T.label), T.el);
    // Herald of Blood, Herald of the Royal Queen: its % of the Blood Loss the enemy took, as physical that nothing scales,
    // over its area, with its chance to Aggravate the bleeding it inflicts (hit)
    const BL = b.dmg?.stats?.['skill_herald_bleeding_enemies_explode_for_%_blood_loss_as_unscalable_physical_damage'];
    if (BL) { pop(p, b.A, 'blood'); return lifeBlast(p, b.A, { ...S, aggX: b.dmg.stats['skill_herald_of_blood_explosion_aggravate_bleeding_chance_%'] }, 'physical', blood * BL / 100); }
    if (T.P.el === 'lightning') {   // bolts on the enemies around instead of one blast
      nearest(p, b.dmg?.stats?.herald_of_thunder_storm_max_hits ?? 3, e => dist(e.pos, p) <= 7).forEach((e, k) => later(k * .08, () => {
        fx.bolt(V(e.pos.x + rnd(-1.5, 1.5), 13, e.pos.z + rnd(-1.5, 1.5)), V(e.pos.x, 0, e.pos.z), 'lightning', .22, .07, .5); pop(e.pos, 1.1, 'lightning'); area(e.pos, 1.1, S);
      }));
    } else boom(p, SIM.heraldR, S);
  }
  const revive = d => { restore(d); fx.ring(d.pos, 1.2 * d.sc, .3, 'gold', .4, { a: .5 }); };
  const corpses = (p, r) => dummies.filter(d => d.corpse > 0 && dist(d.pos, p) <= r);
  const corpseAt = (p, r) => { let best = null, bd = r; for (const d of dummies) if (d.corpse > 0) { const k = dist(d.pos, p); if (k <= bd) { bd = k; best = d; } } return best; };
  function eat(d, c) {
    d.corpse = 0; d.back = SIM.respawn; d.fig.group.visible = false;
    if (c) { fx.emit(26, { p: { x: d.pos.x, y: .4, z: d.pos.z }, r: .5, v: 1.5, up: 3, life: .8, size: .22, c, c2: 'blood' }); fx.ring(d.pos, 1.3, .2, c, .4); }   // c: its colour, none for a skill's own look
  }
  // Detonate Dead's look (witch_detonate_dead, necromancer_detonatedead; its tutorial video). Cast, flames at your hand;
  // the corpse swells through its delay (bloatCorpse_Skin_FIRE: Corpse_Bloating, by 0.55 of its size), glowing; then it
  // bursts (core_explosion_01.ao, explosion_01.ao): an orange light (2.18 / 0.62 / 0.21) for 0.1-0.15 s with a 0.1 s
  // shake, a flash for 0.15 s, 32 flames for 0.23-0.67 s (1 / 0.8 / 0.54), a sphere for 0.25-0.35 s (1 / 0.74 / 0.57), a
  // ring for 0.4 s (1.2 / 0.78 / 0.48) and its core ring for 0.65 s (1 / 0.69 / 0.54), dark smoke for 0.77-1.23 s,
  // shrapnel (0.42 / 0.39 / 0.35) and blood from 0.05-0.08 s, a smoke wave from 0.06 s for 1.3 s, fire on the ground for
  // 1-4 s, 64 embers for 4.2-5.8 s and the ground scorched for 7 s. note: the flames at your hand and the corpse's glow
  // are not in the data (the explosion's flames here); the counts, speeds and sizes are the scene's
  const DDEAD = { light: 0xff4818, flame: 0xffcc8a, sphere: 0xffbd91, ring: 0xffa666, core: 0xffb08a, smoke: 0x333333, gib: 0x6b6359, scorch: 0x050505 };
  function ddBloat(c, w) {
    const d = c.d, f = d?.fig, q = { x: c.x, y: .35, z: c.z };
    fx.emit(14, { p: hand(), r: .2, v: .6, up: 1, life: .4, size: .25, grow: 1.4, c: DDEAD.flame, c2: DDEAD.light, k: 2.2, drag: 1.5 });
    fx.glow(q, 1.2, DDEAD.light, w, 2); fx.emit(10, { p: q, r: .4, v: .3, up: .6, life: w, size: .2, c: DDEAD.flame, c2: DDEAD.light, k: 2, drag: 1 });
    if (!f) return () => {};
    const s0 = f.group.scale.x; f.group.visible = true;
    for (let i = 1; i < 8; i++) later(w * i / 8, () => f.group.scale.setScalar(s0 * (1 + .55 * i / 7)));
    return () => { f.group.scale.setScalar(s0); if (!d.corpse) f.group.visible = false; };
  }
  function ddBlast(c, R) {
    const q = { x: c.x, y: .5, z: c.z }, g = { x: c.x, z: c.z };
    fx.flash(q, DDEAD.light, 40 + R * 10, .15, 8 + R * 3); shake = Math.max(shake, Math.min(.5, R * .09));
    fx.glow(q, R * .9, 'white', .15, 3); fx.ball(q, R * .45, DDEAD.sphere, .3, 1.8);
    fx.emit(32, { p: q, r: .3, v: R * 2.2, up: 1, life: .45, size: .6, grow: 1.6, c: DDEAD.flame, c2: DDEAD.light, k: 2.4, drag: 2.5 });
    fx.ring(g, .2, R * .8, DDEAD.ring, .4, { a: .8, y: .5 }); fx.ring(g, .1, R, DDEAD.core, .65, { a: .6 });
    fx.emit(8, { p: q, r: .4, v: 1, up: .8, life: 1, size: R * .5, grow: 1.8, c: DDEAD.smoke, smoke: true, a: .5, drag: 1 });
    later(.05, () => fx.emit(16, { p: q, r: .2, v: 5, up: 3, life: 1.2, size: .07, c: DDEAD.gib, g: 9, drag: .5 }));
    later(.06, () => fx.ring(g, R * .3, R * 1.1, DDEAD.smoke, 1.3, { a: .4 }));
    later(.08, () => fx.emit(12, { p: q, r: .2, v: 3, up: 2.5, life: 1.5, size: .08, c: 'blood', g: 9, drag: .6 }));
    fx.emit(Math.ceil(R * 8), { p: { x: c.x, y: .1, z: c.z }, r: R * .7, v: .3, up: .6, life: 2.5, size: .25, c: DDEAD.flame, c2: DDEAD.light, k: 2, drag: 1 });
    fx.emit(64, { p: q, r: R * .5, v: 1.5, up: 1.5, life: 5, size: .04, c: DDEAD.light, c2: 'white', k: 2.4, g: 1, drag: 1.2 });
    fx.disc(g, R, DDEAD.scorch, 7, { dark: true, a: .7, tex: 'patch', hold: .8, y: .02 });
  }
  // Corpse skills act on a corpse near the cursor; without one they do nothing.
  function useCorpse(S) {
    const d = corpseAt(S.at, Math.max(S.A, SIM.snap));
    if (!d) { toast(t('{0} needs a corpse: kill an enemy or press C', S.label)); return null; }
    const p = { x: d.pos.x, z: d.pos.z, life: d.max, d }; me.corpseAt = time;   // life: the corpse's monster's
    if (!(Math.random() * 100 < (S.dmg?.sum?.['base_chance_to_not_consume_corpse_%'] || 0))) eat(d, S.P.ground === 'gas' ? GAS.bloat : S.el);   // the tree's chance to not destroy it
    flaskGain(0, S.dmg?.sum?.support_grants_X_life_flask_charges_on_using_corpse || 0); flaskGain(1, S.dmg?.sum?.support_grants_X_mana_flask_charges_on_using_corpse || 0);   // Gorge
    if (S.P.gain) chargeBy(S.P.gain, S);
    return p;
  }

  // A Sceptre's aura as the game's (aura_<name>.ao: aura_zone.pet, looping each second): a thin broken ring at your feet
  // in its colour (its AuraMesh: Noise_006 masking it, turning) and sparks streaking up off it, 32 a second for 0.35-1.5 s.
  // Discipline's blue (aura_discipline: disciplineBase 0.15 / 0.59 / 1, its sparks 0.03 / 0.12 / 1). note: the ring's size
  // (about 1 m, as the game shows it) and its texture (the noise read round a circle) are the scene's; the counts, speeds
  // and sizes too
  const AURA_LOOK = { Discipline: { base: 0x2696ff, spark: 0x081fff } }, AURA_R = 1;
  const auraD = {};
  // Elemental Conflux: while on, one element at random, again every its duration. Its look (reservation_elementalconflux,
  // its element's .ao, 1.3 m up on you): on changing a flash for 0.45-0.65 s (lightning's 0.12-0.25
  // s and bolts for 0.08-0.4 s) and 256 sparks for 0.25-1 s (confluxBurst), then its halo while it lasts (confluxActive:
  // fire's for 0.7 s, cold's for 2 s, lightning's bolts for 0.08-0.65 s and glow for 0.15-0.75 s). note: the sizes, the
  // number of sparks and the halo's rate are the scene's; its ring as it is about to change (confluxPrepare) left out
  const CONFLUX = { fire: { halo: 0xff991f, spark: 0xff7814, life: .7 }, cold: { halo: 0x8cbaff, spark: 0x66b3ff, life: 2 },
    lightning: { halo: 0x3045ff, spark: 0x1445ff, bolt: 0x4059ff, life: .45 } };
  function confluxLook(dt) {
    const CF = onS('Elemental Conflux'); if (!CF) return;
    const q = V(pp.x, 1.3, pp.z);
    if (!(time < me.conflux?.until)) {
      const el = ELEM[Math.floor(Math.random() * ELEM.length)], L = CONFLUX[el];
      me.conflux = { el, until: time + durOf(CF), halo: 0 };
      fx.glow(q, 1.6, L.halo, L.bolt ? rnd(.12, .25) : rnd(.45, .65), 2.6); fx.flash(q, L.halo, 20, .3, 6);
      fx.emit(96, { p: q, r: .2, v: 3, up: .5, life: rnd(.25, 1), size: .04, c: L.spark, c2: 'white', k: 2.4, drag: 2 });
      if (L.bolt) for (let i = 0; i < 6; i++) { const a = rnd(TAU); fx.bolt(q.clone(), V(q.x + Math.cos(a) * 1.2, rnd(.3, 2), q.z + Math.sin(a) * 1.2), L.bolt, rnd(.08, .4), .03); }
    }
    const C = me.conflux, L = CONFLUX[C.el];
    if ((C.halo -= dt) > 0) return;
    C.halo = L.life / 2;
    fx.glow(q, .9, L.halo, L.bolt ? rnd(.15, .75) : L.life, 2.2);
    if (L.bolt) for (let i = 0; i < 2; i++) { const a = rnd(TAU), h = rnd(.6, 1.9); fx.bolt(V(pp.x + Math.cos(a) * .35, h, pp.z + Math.sin(a) * .35), V(pp.x - Math.cos(a) * .35, h + rnd(-.4, .4), pp.z - Math.sin(a) * .35), L.bolt, rnd(.08, .65), .015, .12); }
  }
  function auraLook(dt) {
    for (const k in AURA_LOOK) {
      const L = AURA_LOOK[k], on = !!tog[k];
      if (on && !auraD[k]) auraD[k] = fx.decal(pp, AURA_R, artTex('aura_ring', 'particles/fxlib/tileables/aura_ring_006'), L.base, { a: .9, k: 2.4, spin: .4 });
      const D = auraD[k]; if (!D) continue;
      if (!on) { D.remove(); delete auraD[k]; continue; }
      D.move(pp);
      if (Math.random() < dt * 32) { const a = rnd(TAU), p = V(pp.x + Math.cos(a) * AURA_R * .88, .05, pp.z + Math.sin(a) * AURA_R * .88); fx.streak(p, V(p.x, .6, p.z), L.spark, rnd(.35, 1.5), .012, .15); }
    }
  }
  // Crackling Palm, Gelid Palm: an unarmed melee attack hit calls down a bolt on the enemy, no more than its number every
  // its delay, hitting the enemies within its radius for its own damage. Crackling Palm's look (thunder_bolt.ao: its
  // lightning_bolt ribbons falling from 15 m above for 0.35-0.55 s, impact.pet: a flash 0.12 s, sparks, rings and a ring out
  // to its area 0.35-0.55 s, small bolts drawn in for 0.4-0.8 s; their Lightning Color 0.05 / 0.06 / 0.2, the flash
  // 2.3 / 3.11 / 15); Gelid Palm's is its element's
  const TFIST = { bolt: 0x404cff, flash: 0x2735ff, ring: 0x3340ff, hand: 0x3126ff };
  function palmBolt(X, d) {
    const st = X.dmg?.stats || {}, k = 'palm' + X.name, L = me[k] = (me[k] || []).filter(t0 => time - t0 < st.thunderfist_bolt_delay_ms / 1000);
    if (L.length >= st.thunderfist_number_of_bolts_delays) return;
    L.push(time);
    const c = { x: d.pos.x, z: d.pos.z }, C = X.name === 'Crackling Palm' ? TFIST : { bolt: X.el, flash: X.el, ring: X.el };
    for (let j = 0; j < 3; j++) fx.bolt(V(c.x + rnd(-.3, .3), 15, c.z + rnd(-.3, .3)), V(c.x, 0, c.z), C.bolt, rnd(.35, .55), j ? .05 : .09, .5);
    later(.1, () => {
      fx.glow({ x: c.x, y: .4, z: c.z }, 1.8, C.flash, .12, 3);
      fx.emit(24, { p: { x: c.x, y: .2, z: c.z }, r: .2, v: 6, up: 2, life: rnd(.2, .4), size: .05, c: C.ring, c2: 'white', k: 2.6, drag: 2 });
      fx.ring(c, .2, X.A, C.ring, rnd(.35, .55), { a: .8 });
      for (let j = 0; j < 8; j++) { const a = rnd(TAU), r = rnd(.5, 1) * X.A; fx.bolt(V(c.x + Math.cos(a) * r, .1, c.z + Math.sin(a) * r), V(c.x, .3, c.z), C.bolt, rnd(.4, .8), .025, .25); }
      area(c, X.A, { ...X, src: 'palm' });
    });
  }
  // the hands while Crackling Palm is on (thunderfist_ambient.epk: lightning_hand_pt, small bolts about the hands and drops
  // of lightning, 0.15-0.4 s; 3.85 / 3 / 20)
  function palmLook(dt) {
    if (!tog['Crackling Palm']) return;
    const a = V(), b = V(); player.palms(a, b);
    for (const h of [a, b]) {
      if (Math.random() < dt * 30) fx.bolt(h.clone().add(V(rnd(-.08, .08), rnd(-.08, .08), rnd(-.08, .08))), h.clone().add(V(rnd(-.12, .12), rnd(-.12, .12), rnd(-.12, .12))), TFIST.hand, rnd(.2, .4), .01, .06);
      if (Math.random() < dt * 10) fx.emit(1, { p: h, r: .05, v: .1, up: -1, life: rnd(.15, .25), size: .06, c: TFIST.hand, c2: 'white', k: 2.6 });
      if (Math.random() < dt * 8) fx.glow(h, .35, TFIST.hand, rnd(.15, .3), 2.4);
    }
  }
  // Every enemy in a circle, plus whatever lies there and reacts (grenades, crystals, rods, gas, oil).
  // S.once: the enemies already hit by one of the Ice Fragments made with this one, which only one of can damage
  // (KeywordPopups IceFragment)
  function area(c, R, S, o = {}) {
    let n = 0;
    for (const d of dummies) if (!d.dead && !S.once?.has(d) && dist(d.pos, c) <= R + SIM.body && hit(d, S, o)) { S.once?.add(d); n++; }
    if (!o.noTouch) touch(c, R, S);
    return n;
  }
  const stays = g => g.S?.dmg?.sum?.ground_effects_cannot_trigger;   // Persistent Ground III: its Ground Surfaces only end when their duration expires
  function touch(c, R, S) {
    for (const o of objs) if (o.touch && !o.dead && o !== S.self && dist(o.pos, c) <= R + (o.r || 0)) o.touch(S);
    const fire = S.els.includes('fire');
    if (!fire && !S.P.detonator) return;
    for (const g of grounds) {
      if (g.dead || stays(g) || dist(g, c) > R + g.r) continue;
      if (g.type === 'gas') {
        g.dead = true; say(t('{0}: the gas cloud explodes', S.label), 'fire');
        // Decompose's: its explosion part after its delay, and its permillage of the corpse's life as chaos damage
        const X = partOf(g.S, 'CorpsewadeCorpseCloudExplosionPlayer'), gs = g.S.dmg?.stats || {}, n = (g.corpse || 0) * (gs.corpse_explosion_monster_life_permillage_chaos || 0) / 1000;
        later(X ? (gs.explosion_delay_ms || 0) / 1000 : .08, () => {
          gasIgnite(g, g.r); area(g, g.r, X ? { ...X, mult: g.S.mult, src: 'cloud' } : { ...g.S, els: ['fire'], el: 'fire', ail: ['ignite'], src: 'ground' });
          lifeBlast(g, g.r, g.S, 'chaos', n);
        });
      } else if (g.type === 'oil' && fire) {
        g.dead = true; say(t('{0}: the oil catches fire', S.label), 'fire');
        fx.explode(g, g.r, 'fire', { soft: true }); ground('burning', g, g.r, GROUND_TIME.burning, { ...g.S, els: ['fire'], el: 'fire', ail: ['ignite'], src: 'ground' });
      }
    }
  }
  // Bleeding Concoction's flask (MiscProjectileMod BleedingConcoctionProjectile: ascendancy_classes/pathfinder flask_blood_proj,
  // a mana flask tinted red 1 / 0 / 0, trailing blood) bursting into blood (FlaskExplodePhys: explosion_blood.pet): a red
  // core ring for 0.65 s, a sphere of blood for 0.75 s, blood splashing up in ribbons for 0.5-1.5 s and sprayed out for
  // 2-2.5 s, and its stain on the ground for 4.5-7.5 s
  const BLD = { flask: 0xd0000a, core: 0xff1010, blood: 0x8a0008, dark: 0x4a0004, stain: 0x5a0006 };
  function bloodBurst(c, R) {
    const at = { x: c.x, y: .3, z: c.z };
    fx.flash(c, BLD.core, 6, .2, 5); fx.ring(c, .2, R, BLD.core, .65, { a: .8 }); fx.ball(at, R * .5, BLD.dark, .75, 1.4);
    fx.emit(40, { p: at, r: .2, v: R * 1.5, up: 5, life: 1.5, size: .2, c: BLD.blood, smoke: true, a: .95, g: 12, drag: .3 });   // the splash
    fx.emit(Math.min(120, 30 + R * R * 8), { p: at, r: .2, v: R * 2.2, up: 3, life: 2.2, size: .08, c: BLD.blood, c2: BLD.dark, k: 1.2, g: 9, drag: .3 });   // the spray
    fx.disc(c, R * .9, BLD.stain, 6, { dark: true, a: .9, tex: 'patch', hold: .7, y: .03 });
  }
  // Acidic Concoction: its flask Consumes the Poisons of each enemy it hits, which bursts there (its secondary radius,
  // more area per Poison consumed): the enemies in the burst lose its % of the expected remaining damage of the
  // strongest Poison consumed (its description: Life lost, not a hit). note: the tree's increased area is not on the burst
  function acidBurst(S, c, R) {
    const X = S.dmg.part || {}, pct = X['poison_concoction_poison_burst_physical_damage_equal_to_%_of_strongest_active_poison'];
    if (!pct) return;
    for (const d of dummies) {
      if (d.dead || dist(d.pos, c) > R + SIM.body || !(d.st.poison > 0) || !d.burn.poison) continue;
      const n = 1 + (d.burn2?.until > time ? 1 : 0) + (d.burnX || []).filter(q => q.until > time).length, lose = d.burn.poison.dps * d.st.poison * pct / 100;
      d.st.poison = 0; delete d.burn.poison; d.burn2 = null; d.burnX = [];
      const p = { x: d.pos.x, z: d.pos.z }, r = radOf(S) * Math.sqrt(1 + n * (X['poisonous_concoction_area_of_effect_+%_final_per_active_poison_consumed'] || 0) / 100);
      fx.acidBurst(p, r);
      for (const e of inside(p, r)) damage(e, lose, S, false, true);
    }
  }
  function boom(c, R, S, o = {}) {
    fx.explode(c, R, S.el, o);
    if (R > 1.4 && !o.soft) shake = Math.max(shake, Math.min(.5, R * .09));
    return area(c, R, S, o);
  }
  // Decompose's gas (corpse_cloud: Toxic Grenade's art, crossbow_toxic_grenade). The corpse it consumes bloats green
  // (detonateDead_POISON: bloatCorpse_Skin_GCHAOS's glow 0.54 / 0.9 / 0.1); the cloud bursts out (toxic_explosion.pet: a
  // flash for 0.2 s, 0.96 / 1 / 0.14, a sphere for 1 s, a ring for 1.2 s and splashes for 0.3-0.5 s, 0.88 / 1 / 0, a wave
  // at 0.07 s for 0.55 s, 0.97 / 1 / 0.09) with a yellow ring on the ground for 3 s (toxic_gas_ring: 1 / 0.93 / 0.29) and
  // its smoke billows for 1.5-2.5 s, then hangs for 4.5-5.5 s (toxic_smoke: its albedo 0.11 / 0.11 / 0.06, brightened
  // here as the scene's smoke is unlit). Ignited (ignite_explosion.pet), the gas flashes white, then orange (its colour
  // curve: 7.4 / 8 / 7.2 at 0.02, 3 / 0.71 / 0.21 at 0.08, dark from 0.5), with an orange wave for 1 s (1 / 0.37 / 0.1),
  // flames for 0.15-0.2 s (1 / 0.51 / 0.3) and 512 embers for 1.5-4 s (1 / 0.4 / 0.17). note: the counts, speeds and
  // sizes are the scene's
  const GAS = { bloat: 0x8ae61a, flash: 0xf5ff24, burst: 0xdfff00, wave: 0xf8ff17, ring: 0xffed4a, smoke: 0x8c8c4d, white: 0xfffaf0, hot: 0xff3b12, fire: 0xff5e1a, flame: 0xff824d, ember: 0xff6b2c, char: 0x080808 };
  function gasBurst(c, R) {
    const q = { x: c.x, y: .6, z: c.z };
    fx.glow(q, R * .9, GAS.flash, .2, 2.4); fx.ball(q, R * .5, GAS.burst, 1, 1.2); fx.ring(c, .2, R, GAS.burst, 1.2, { a: .5 });
    later(.07, () => fx.ring(c, R * .3, R * 1.2, GAS.wave, .55, { a: .4, y: .5 }));
    fx.emit(14, { p: q, r: .2, v: 3, up: 2, life: .4, size: .12, c: GAS.burst, g: 9, drag: 1 });
    fx.ring(c, R * .95, R, GAS.ring, 3, { a: .6 });
    fx.emit(Math.ceil(R * 6), { p: { x: c.x, y: .4, z: c.z }, r: R * .6, v: 1.2, up: .4, life: 2, size: 1, grow: 1.8, c: GAS.smoke, smoke: true, a: .3, drag: 1.5 });
  }
  function gasIgnite(c, R) {
    const q = { x: c.x, y: .7, z: c.z };
    fx.glow(q, R * 1.1, GAS.white, .08, 3); later(.03, () => fx.glow(q, R * .9, GAS.hot, .35, 2.4));
    fx.disc(c, R * 1.1, GAS.fire, 1, { a: .7 }); fx.flash(c, GAS.fire, 30 + R * 15, .4, 8 + R * 3);
    fx.emit(Math.ceil(R * 20), { p: q, r: R * .8, v: 2, up: 1.5, life: .2, size: .45, c: GAS.flame, c2: GAS.fire, k: 2.4 });
    fx.emit(Math.ceil(R * 25), { p: q, r: R * .7, v: 3, up: 2.5, life: 2.5, size: .05, c: GAS.ember, k: 2.2, g: 1.5, drag: 1 });
    fx.emit(Math.ceil(R * 5), { p: q, r: R * .6, v: .8, up: 1, life: 1.2, size: 1, grow: 1.6, c: GAS.char, smoke: true, a: .45, drag: 1 });
    shake = Math.max(shake, Math.min(.5, R * .09));
  }
  // Dark Effigy's look (chaos_dark_effigy; its tutorial video). Its totem rises in a violet wave (dark_effigy_start:
  // summon_wave for 1 s, 0.76 / 0.7 / 1, and 128 embers for 0.5-1.2 s, 0.66 / 0.6 / 1) and stands in its ground glow
  // (effigy_ground, 0.74 / 0.7 / 1) with violet ribbons rising for 3-4 s (0.72 / 0.7 / 1) and embers for 1.5-4 s. Each
  // volley (spellcast_burst_01) a surge on it (cast_surge) and its mortars fired from 0.48 s to 0.83 s of its 1 s, each
  // trailing (Forbidden Rite's FR_trail: 2.5 m for 0.5 s, 0.68 / 0.5 / 1 in a dark envelope 0.52 / 0.45 / 0.6). Its
  // impact (impact.pet): a flash for 0.1-0.18 s (0.38 / 0.24 / 1), a shockwave sphere for 0.35 s (0.76 / 0.65 / 1), a ring
  // for 1 s (0.79 / 0.67 / 1), sparks for 0.2-0.4 s (0.68 / 0.4 / 1), 32 embers for 3.2-4.8 s (0.48 / 0.28 / 1), a swirl
  // for 0.5-1 s, a dark splash on the ground for 5 s (0.22 / 0.17 / 0.31) and a light for 0.16-0.25 s (0.47 / 0.4 / 1).
  // note: the counts, speeds and sizes are the scene's
  const DEFF = { wave: 0xc2b3ff, ember: 0xa999ff, ground: 0xbdb3ff, ribbon: 0xb8b3ff, trail: 0xad80ff, smoke: 0x857399, core: 0x613dff, shock: 0xc2a6ff, ring: 0xc9abff, spark: 0xad66ff, hot: 0x7a47ff, splash: 0x382b4f, light: 0x7866ff };
  // the enemies it bombards: afflicted by a chaos damage over time debuff (a chaos skill's, or Poison's)
  const chaosDotOn = d => !d.dead && (d.st.poison > 0 || d.dots.some(o => o.chaos && o.s > 0));
  function deRise(c) {
    fx.ring(c, .2, 1.6, DEFF.wave, 1, { a: .7 }); fx.glow({ x: c.x, y: 1, z: c.z }, 1.4, DEFF.wave, .6, 2);
    fx.emit(40, { p: { x: c.x, y: .2, z: c.z }, r: .5, v: 1.5, up: 3, life: .9, size: .06, c: DEFF.ember, c2: 'white', k: 2.4, drag: 1.2 });
  }
  function deIdle(e, dt) {
    if ((e.gd = (e.gd || 0) - dt) <= 0) { e.gd = 1; fx.disc(e.pos, .9, DEFF.ground, 1.1, { a: .3 }); }
    if (Math.random() < dt * 3) fx.emit(1, { p: { x: e.pos.x, y: .3, z: e.pos.z }, r: .3, v: .1, up: .6, life: 3.5, size: .18, c: DEFF.ribbon, smoke: true, a: .35, drag: .5 });
    if (Math.random() < dt * 8) fx.emit(1, { p: { x: e.pos.x, y: .5, z: e.pos.z }, r: .4, v: .2, up: .5, life: 2.5, size: .04, c: DEFF.ember, k: 2.2, drag: .5 });
  }
  function deImpact(p, r) {
    const q = { x: p.x, y: .5, z: p.z };
    fx.glow(q, r * .9, DEFF.core, .15, 2.6); fx.ball(q, r * .6, DEFF.shock, .35, 1.6); fx.ring(p, r * .2, r * 1.2, DEFF.ring, 1, { a: .7 });
    fx.emit(12, { p: q, r: .1, v: 6, up: 1, life: .3, size: .05, c: DEFF.spark, c2: 'white', k: 2.6, drag: 3 });
    fx.emit(16, { p: q, r: r * .4, v: 1, up: 1.5, life: 4, size: .04, c: DEFF.hot, k: 2.2, drag: 1.5 });
    fx.emit(8, { p: q, r: r * .6, v: -1.5, life: .7, size: .25, c: DEFF.smoke, smoke: true, a: .5 });   // its swirl drawn in
    fx.disc(p, r * .8, DEFF.splash, 5, { a: .55, hold: .8 }); fx.flash(p, DEFF.light, 25, .25, r * 6);
  }
  // its volley: a mortar at each enemy in its radius it bombards (one and its additional projectiles), fired from 0.48 s
  // to 0.83 s of its use (spellcast_burst_01's proj_fire_start, proj_fire_end), at its projectile speed, bursting in
  // its impact radius (its secondary radius, scaled as its area)
  function effigyVolley(S, e, R, every) {
    const st = S.dmg.stats, r = R * st.active_skill_base_secondary_area_of_effect_radius / st.active_skill_base_area_of_effect_radius, v = (S.G?.speed || SIM.projSpeed) * (S.dmg.projSpeed || 1);
    const list = dummies.filter(d => dist(d.pos, e.pos) <= R && chaosDotOn(d)).slice(0, 1 + (st.number_of_additional_projectiles || 0));
    fx.glow({ x: e.pos.x, y: 1.8, z: e.pos.z }, .9, DEFF.trail, every * .8, 2);   // its surge
    list.forEach((d, i) => later(every * (.48 + .35 * i / list.length), () => {
      const to = { x: d.pos.x, z: d.pos.z }, l = dist(to, e.pos);
      lob(fx.orb(DEFF.trail, .12), V(e.pos.x, 1.8, e.pos.z), V(to.x, .1, to.z), l / v, l * .3, () => { deImpact(to, r); area(to, r, S); }, { trail: DEFF.trail });
    }));
  }
  // Cull The Weak's look (spear_frenzystab; its tutorial video). Its lunge (frenzied_lunge.atl: weaponCharge.ao) gathers
  // wind about the spear, 24 ribbons for 0.5 s (0.63 / 1 / 0.38) and a gust off the blade for 0.12 s (0.46 / 1 / 0.2); its
  // stab (stabStrike.ao) a pale sonic boom for 0.25 s, a spike cone for 0.25 s (0.63 / 1 / 0.25) and a wind cone for
  // 0.17 s (0.86 / 1 / 0.3) from 0.04-0.08 s, a warm core at 0.1 s for 0.13 s (1 / 0.85 / 0.55). Its hit (hitImpact)
  // spikes for 0.06-0.13 s (0.84 / 1 / 0.5), a wave back for 0.1-0.2 s (0.91 / 1 / 0.35) and embers for 0.4-1.2 s (0.53 /
  // 1 / 0.3); a cull (culling_impact.ao: frenzyImpact) the same, brighter, with a 0.075 s shake. note: the counts,
  // speeds and sizes are the scene's
  const CTW = { wind: 0xa1ff61, gust: 0x75ff33, boom: 0xe6ecf2, spike: 0xa0ff40, cone: 0xdbff4d, core: 0xffd98c, hit: 0xd6ff80, wave: 0xe8ff59, ember: 0x87ff4d };
  function ctwLunge(a, b) {
    const l = dist(a, b) || 1, dx = (b.x - a.x) / l, dz = (b.z - a.z) / l;
    fx.strip(a, b, .35, CTW.boom, .25, { a: .4, k: 1.4, y: 1 });
    for (let i = 0; i < 8; i++) { const k = i / 7, q = { x: a.x + (b.x - a.x) * k, y: 1, z: a.z + (b.z - a.z) * k }; fx.emit(3, { p: q, r: .25, h: .3, v: .8, dir: V(dx * 2, 0, dz * 2), life: .5, size: .06, c: CTW.wind, c2: 'white', k: 1.8, drag: 2 }); }
    fx.emit(6, { p: { x: b.x, y: 1.1, z: b.z }, r: .1, dir: V(dx * 4, 0, dz * 4), v: 1, life: .12, size: .1, c: CTW.gust, k: 2.2, drag: 3 });
  }
  function ctwStab(from, dx, dz) {
    const q = { x: from.x + dx * .4, y: 1.05, z: from.z + dz * .4 }, tip = V(from.x + dx * 2.2, 1.05, from.z + dz * 2.2);
    fx.ring(q, .1, .9, CTW.boom, .25, { a: .5, y: 1.05 });
    later(.04, () => fx.streak(V(q.x, q.y, q.z), tip, CTW.spike, .25, .09, 1.6));
    later(.08, () => fx.strip(q, tip, .35, CTW.cone, .17, { a: .4, k: 1.4, y: 1.05 }));
    later(.1, () => fx.glow(tip, .45, CTW.core, .13, 2));
  }
  function ctwHit(p, culled) {
    const q = { x: p.x, y: 1, z: p.z }, k = culled ? 1.4 : 1;
    fx.glow(q, .4 * k, CTW.hit, .13, 2); fx.emit(culled ? 12 : 7, { p: q, r: .1, v: 4 * k, life: .1, size: .07, c: CTW.hit, c2: 'white', k: 2.6, drag: 3 });   // its spikes
    fx.ring(q, .1, .8 * k, CTW.wave, .2, { a: .6, y: 1 }); fx.emit(culled ? 16 : 9, { p: q, r: .15, v: 2, up: .6, life: .9, size: .05, c: CTW.ember, k: 2.2, g: 2, drag: 1.5 });
    if (culled) shake = Math.max(shake, .1);
  }
  // Killing Palm, Crushing Fear, Cull The Weak: the enemies around you they can Cull are highlighted (their description),
  // a blue soul over each (monk_killingpalm culling_indicator.ao: cullSoul.pet's core 0.35 / 0.65 / 4, its flames rising
  // 0.33 / 0.45 / 1, its sparks 1 / 1.25 / 3 for 1.85-3.5 s, a white flash for 0.32 s as it shows). note: how far around
  // you is not in the data: the skill's dash range here
  const CSOUL = { core: 0x1729ff, flame: 0x5373ff, spark: 0x556bff };
  let cullHL = { at: -9, S: null };
  const cullSkill = () => { if (time - cullHL.at > .5) { const j = api.build().gems.findIndex(g => /Culled\] will be highlighted/.test(api.info(g).gem?.description || '')); cullHL = { at: time, S: j >= 0 && base(j) }; } return cullHL.S; };
  function cullSoul(d, dt) {
    const S = cullSkill(), on = !!S && !d.dead && dist(d.pos, pp) <= (S.dmg?.stats?.base_melee_dash_range || 0) / 10 && cullable(d, S), q = { x: d.pos.x, y: 2.1 * d.sc, z: d.pos.z };
    if (on && !d.souled) { fx.glow(q, 1.1, 'white', .32, 2); fx.emit(6, { p: q, r: .2, v: .8, up: .4, life: 2.5, size: .05, c: CSOUL.spark, c2: 'white', k: 2, drag: 1.5 }); }
    d.souled = on; if (!on) return;
    if (Math.random() < dt * 16) fx.emit(1, { p: q, r: .12, v: .1, life: .5, size: .6, c: CSOUL.core, c2: CSOUL.flame, k: 2.4 });
    if (Math.random() < dt * 20) fx.emit(1, { p: q, r: .2, v: .15, up: 1.1, life: .6, size: .18, c: CSOUL.flame, c2: CSOUL.spark, k: 1.8, drag: .5 });
  }
  // Crushing Fear's look (Horror's Flight: uniques/ChokingMists). Its dash (grdDash_start, EPK_Body): pale wind swirling
  // over the ground for 0.3-0.4 s (0.45 / 0.45 / 0.45), a sonic boom for 0.12-0.3 s (0.71 / 0.6 / 0.9), glass shards
  // falling off you to lie for 2.5-4.5 s, blue motes for 0.5-1.85 s (0.1 / 0.11 / 1) and feathers for 2-3 s (their
  // texture's mean 84 / 54 / 54); its hit (Charged_Impact: conversionImpact) violet sparks and embers for 0.5-2 s (0.46
  // / 0.22 / 1), feathers and a 0.1 s shake. A kill (EmotionDrain) draws violet ribbons out of the enemy for 0.3-0.7 s
  // (0.76 / 0.56 / 1); its shockwave (Shattering_Blastwave: shatterblast) a dark sphere for 0.35 s, a flash for 0.2 s
  // (0.56 / 0.32 / 1), streaks for 0.25 s (0.26 / 0.2 / 1), a violet ring for 0.75 s (0.42 / 0.24 / 1.14 to 0.93 / 0.9 / 1)
  // and flames for 0.3-0.4 s (0.23 / 0.11 / 1) from 0.03 s, its push wave at 0.08 s (0.48 / 0.32 / 1), a lilac light ring
  // and sphere at 0.1 s for 0.5-0.65 s (0.74 / 0.6 / 1), glass shards flung for 1-2 s (0.76 / 0.56 / 0.76) and more on the
  // ground for 3-4 s, blue embers for 1-2 s and the glassy cracks it leaves for 4.5 s (VFX_FrozenLake02: 77 / 95 / 109).
  // note: the counts, speeds and sizes are the scene's; its blurs and distortions are left out
  const CFEAR = { wind: 0x737373, boom: 0xb599e6, mote: 0x1a1cff, glass: 0xc28fc2, feather: 0x543636, spark: 0x7538ff, ribbon: 0xc28fff, flash: 0x8f52ff, streak: 0x4233ff, ring: 0x5e36ff, ringHot: 0xede6ff, flame: 0x3b1cff, push: 0x7a52ff, light: 0xbd99ff, crack: 0x4d5f6d, dark: 0x0a0614 };
  const feathers = (p, n, r) => fx.emit(n, { p, r, h: .6, v: .5, life: 2.5, size: .09, c: CFEAR.feather, smoke: true, a: .9, g: .6, drag: 2 });
  function cfDash(a, b) {
    const n = Math.ceil(dist(a, b) * 3);
    fx.emit(24, { p: { x: a.x, y: .1, z: a.z }, r: .4, v: 1.8, up: .2, life: .35, size: .4, grow: 1.8, c: CFEAR.wind, smoke: true, a: .25, drag: 2, flat: true });
    fx.ring({ x: a.x, z: a.z }, .1, .9, CFEAR.boom, .2, { a: .5, y: 1 }); fx.strip(a, b, .25, CFEAR.boom, .25, { a: .35, k: 1.6, y: 1 });
    for (let i = 0; i <= n; i++) {
      const q = { x: a.x + (b.x - a.x) * i / n, y: .7, z: a.z + (b.z - a.z) * i / n };
      fx.emit(2, { p: q, r: .3, h: .8, v: .6, life: 1.2, size: .05, c: CFEAR.mote, k: 2.4, drag: 1.5 });
      fx.emit(1, { p: q, r: .25, h: .6, v: .5, life: 3.5, size: .07, c: CFEAR.glass, c2: 'white', k: 1.2, g: 9 });
      feathers(q, 1, .25);
    }
  }
  function cfHit(p) {
    const q = { x: p.x, y: 1, z: p.z };
    fx.glow(q, .6, CFEAR.spark, .12, 2.2); fx.emit(14, { p: q, r: .15, v: 3, up: .8, life: 1.2, size: .05, c: CFEAR.spark, c2: 'white', k: 2.4, g: 2, drag: 1.8 });
    feathers(q, 5, .2); shake = Math.max(shake, .12);
  }
  const cfDrain = p => { for (let i = 0; i < 3; i++) { const a = rnd(TAU); fx.streak(V(p.x + Math.cos(a) * .35, .4, p.z + Math.sin(a) * .35), V(p.x, 1.7, p.z), CFEAR.ribbon, rnd(.3, .7), .05, .9); } };
  function cfNova(p, R) {
    const g = { x: p.x, z: p.z }, c = { x: p.x, y: .8, z: p.z }, f = { x: p.x, y: .1, z: p.z }, o = V(c.x, c.y, c.z);
    fx.emit(6, { p: c, r: .2, v: .4, life: .35, size: R * .5, grow: 1.5, c: CFEAR.dark, smoke: true, a: .7 });
    fx.glow(c, R * .45, CFEAR.flash, .2, 2); fx.flash(p, CFEAR.flash, 30 + R * 10, .3, 8 + R * 3); shake = Math.max(shake, Math.min(.5, R * .09));
    for (let i = 0; i < 8; i++) { const a = rnd(TAU); fx.streak(o, V(c.x + Math.cos(a) * R * .8, c.y + rnd(-.3, .3), c.z + Math.sin(a) * R * .8), CFEAR.streak, .25, .04, 1.2); }
    fx.emit(30, { p: c, r: .3, v: R * 2.5, up: 3, life: 1.5, size: .07, c: CFEAR.glass, c2: 'white', k: 1.3, g: 9, drag: .6 });
    fx.emit(30, { p: c, r: .3, v: R * 1.5, up: 1.5, life: 1.5, size: .05, c: CFEAR.mote, c2: CFEAR.light, k: 2.4, drag: 1.5 });
    later(.03, () => { fx.ring(g, R * .2, R, CFEAR.ring, .75, { a: .9 }); fx.ring(g, R * .1, R * .9, CFEAR.ringHot, .4, { a: .3 }); fx.emit(40, { p: f, r: R * .6, v: 1, up: 2.5, life: .35, size: .3, c: CFEAR.flame, c2: CFEAR.ring, k: 2.4, drag: 2 }); });
    later(.08, () => fx.ring(g, R * .3, R * 1.1, CFEAR.push, .2, { a: .6 }));
    later(.1, () => {
      fx.ring(g, .2, R * .8, CFEAR.light, .5, { a: .6, y: .8 }); fx.ball(c, R * .4, CFEAR.light, .65, .6);
      fx.emit(20, { p: f, r: R * .7, v: .3, life: 3.5, size: .06, c: CFEAR.glass, c2: 'white', k: 1, g: 9, flat: true });
      fx.disc(g, R * .9, CFEAR.crack, 4.5, { tex: 'cracks', a: .6, hold: .7, k: 1 });
    });
  }
  // small impact without the full explosion
  function pop(p, r, c) {
    fx.disc(p, r, c, .28, { a: .6 }); fx.ring(p, r * .3, r, c, .3); fx.flash(p, c, 12, .2, 5);
    fx.emit(Math.min(24, 6 + r * 8), { p: { x: p.x, y: .2, z: p.z }, r: r * .5, v: r * 2.2, up: 2, life: .4, size: .16, c, c2: 'white', drag: 1.5, g: 4 });
  }
  // a chain hits each enemy once, each with the damage of the first (a support's less damage is in calc.js), and
  // reaches as far as calc.js shape says
  // Arc's look (its tutorial video; arc_purple's textures: lightning_ball 8f66ff, spark3 863bfd, up_c 6f2cff): crackling
  // violet sparks on you and at your hand as it leaves (suck_in), a jagged violet bolt of a few strands with a white core
  // to each enemy (line, cyl_mid), sparks bursting off each and small bolts crackling around it for a moment
  const ARC = { core: 0x8f66ff, spark: 0x863bfd, glow: 0x6f2cff };
  function arcLook(from, to, first) {
    if (first) { fx.glow(from, 1.3, ARC.glow, .25, 2.6); fx.emit(12, { p: { x: pp.x, y: 1, z: pp.z }, r: .7, h: 1.4, v: 2, life: .22, size: .12, c: ARC.spark, c2: 'white', k: 3, drag: 2 }); }
    fx.bolt(from, to, ARC.core, .24, .1, .45); fx.bolt(from, to, ARC.spark, .2, .045, .75); fx.bolt(from, to, 'white', .13, .02, .3);
    fx.flash(to, ARC.core, 12, .2, 6); fx.glow(to, 1.2, ARC.glow, .3, 2.4);
    fx.emit(10, { p: to, r: .35, v: 2.6, life: .3, size: .12, c: ARC.spark, c2: 'white', k: 3, drag: 2 });
    for (let k = 0; k < 3; k++) later(.08 + k * .1, () => { const a = V(to.x + rnd(-.45, .45), to.y + rnd(-.6, .5), to.z + rnd(-.45, .45)), b = V(to.x + rnd(-.45, .45), to.y + rnd(-.6, .5), to.z + rnd(-.45, .45)); fx.bolt(a, b, ARC.spark, .1, .03, .5); });
  }
  const chainsOf = X => X.dmg.shape?.chains ?? X.dmg.stats.number_of_chains ?? 0;   // its chains with their modifiers (calc.js shape), else the gem's
  function chain(from, d, S, n, seen = new Set(), mult = 1) {
    const to = chest(d), R = sh(S).chainRange || SIM.chainRange;
    if (!seen.size && S.els?.includes('lightning') && Math.random() * 100 < (S.dmg?.sum?.['lightning_skill_additional_chain_chance_%'] || 0)) n++;   // the tree's chance for Lightning skills to chain once more
    if (S.name === 'Arc' && S.el === 'lightning') arcLook(from, to, !seen.size); else if (S.expr) exBolt(from, to); else { fx.bolt(from, to, S.el, .18); fx.flash(to, S.el, 12, .2, 6); }
    const cst = S.dmg?.stats || {}, RC = cst['active_skill_projectile_damage_+%_final_for_each_remaining_chain'] || 0;   // Arc's quality: more per chain it has left
    seen.add(d); hit(d, S, { mult: mult * (1 + (S.perChain || 0) * (S.chained || 0) / 100) * (1 + RC * Math.max(0, n) / 100) });   // Crescendo Arrows: per time it has Chained
    const free = d.curse && flagOf(S.name, 'always_chain_from_cursed_enemies');   // Coiling Bolts: through any number of Cursed targets
    if (n <= 0 && !free) return;
    later(.07, () => {
      // a lightning rod within reach takes the bolt and pulses over its whole area
      if (S.els.includes('lightning')) for (const o of objs) if (o.rod && !o.dead && !seen.has(o) && o !== S.self && dist(o.pos, d.pos) <= R) { seen.add(o); fx.bolt(to, V(o.pos.x, 1.7, o.pos.z), S.el, .18); o.pulse(S); break; }
      const e = near(d.pos, R, e => !seen.has(e));
      if (e) chain(to, e, S.perChain ? { ...S, chained: (S.chained || 0) + 1 } : S, free ? n : n - 1, seen, mult);
    });
  }
  // Rime: an enemy in the chilled ground of a skill it supports builds up freeze as though dealing its less damage
  const rimeOn = d => 1 + (grounds.find(g => !g.dead && g.type === 'chilled' && dist(g, d.pos) <= g.r && g.S?.dmg?.sum?.['chilled_ground_applies_%_freeze_multiplier_taken'])?.S.dmg.sum['chilled_ground_applies_%_freeze_multiplier_taken'] || 0) / 100;
  function ground(type, c, r, dur, S, grow) {   // grow: its area +per% a second, up to +max% (Creeping Chill)
    const EG = S?.dmg?.sum?.['support_ground_effect_area_of_effect_+%_final_per_second']; if (EG && !grow) grow = { per: EG, max: S.dmg.sum['support_ground_effect_area_of_effect_+%_final_per_second_max'] };   // Encroaching Ground
    if (grounds.length >= 40) grounds[0].dead = true;
    const [col, tex, dark] = GFX[type];
    const decal = fx.decal(c, r, tex, col, { a: dark ? .85 : .5, dark, k: 1.2, pulse: dark ? 0 : 5, y: .031 + (grounds.length % 20) * .0005 });
    const g = { type, x: c.x, z: c.z, r, r0: r, age: 0, grow, s: (dur || GROUND_TIME[type] || SIM.groundTime) * (S ? sh(S).ground || 1 : 1) * (type === 'jagged' ? 1 + (S?.dmg?.sum?.['jagged_ground_duration_+%'] || 0) / 100 : 1), tick: .2, S, decal, dead: false }; grounds.push(g); return g;
  }
  function groundFx(g) {
    const p = { x: g.x, y: .05, z: g.z }, r = g.r * .9;
    if (g.type === 'burning') fx.emit(1, { p, r, v: .2, up: 2, life: .6, size: .4, c: 'fire', c2: 'ember' });
    else if (g.type === 'chilled') fx.emit(1, { p, r, v: .1, up: .5, life: 1, size: .22, c: 'ice', k: 1.2 });
    else if (g.type === 'shocked') fx.emit(2, { p, r, v: 1.5, life: .2, size: .14, c: 'lightning', c2: 'white', k: 3 });
    else if (g.type === 'gas') fx.emit(1, { p, r, h: .8, v: .15, up: .15, life: 5, size: 1.1, grow: 1.6, c: GAS.smoke, smoke: true, a: .2 });   // its smoke hanging (Decompose's look)
    else if (g.type === 'caustic') fx.emit(1, { p, r, v: .1, up: .7, life: .9, size: .2, c: 'poison' });
    else if (g.type === 'consecrated') fx.emit(1, { p, r, v: .1, up: .8, life: .8, size: .5, c: 0xffa74c, k: 1.4, a: .5 });   // its warm wisps rising (ground_effects holy cyl.pet: smoke_whisp, 0.8 s)
  }
  // S with element e added, as the one it now deals most (got: the one it picked up)
  const astral = S => S.P.nova && S.g?.supports?.includes('Astral Projection');
  const withEl = (S, e) => ({ ...S, els: [...new Set([...S.els, e])], el: e, ail: [...new Set([...S.ail, ...ailOf([e])])], got: e });
  // its pct % of all its hit damage gained as element e (a Whirlwind's, a twister's from the ground or Whirlwind it took)
  const gainAs = (A, e, pct) => { const H = A.dmg.hits, all = Object.values(H).reduce((a, h) => [a[0] + h[0], a[1] + h[1]], [0, 0]), h = H[e] || [0, 0];
    return { ...withEl(A, e), dmg: { ...A.dmg, hits: { ...H, [e]: [h[0] + all[0] * pct / 100, h[1] + all[1] * pct / 100] } } }; };
  // A wind skill picks up the elemental ground it passes over.
  // Berek's Pass, The Taming: it counts as boosted by those grounds already. note: a wind skill takes several grounds here
  // (Eye of Winter's per type), so The Taming's "multiple" changes nothing
  function absorb(S, at, r) {
    const WE = sheet().windAs?.find(e => !S.els.includes(e)); if (WE) return withEl(S, WE);   // one a time, as a ground (its caller may gain its damage)
    const g = grounds.find(g => !g.dead && !stays(g) && GROUND_EL[g.type] && !S.els.includes(GROUND_EL[g.type]) && dist(g, at) <= r + g.r * .6);
    if (!g) return S;
    const e = GROUND_EL[g.type]; g.dead = true;
    say(t('{0} absorbs {1} and gains {2}', S.label, t(GROUND[g.type]), t(cap(e))), e);
    fx.ring(at, g.r, .3, e, .45); fx.emit(30, { p: { x: g.x, y: .2, z: g.z }, r: g.r, v: .5, up: 3, life: .7, size: .25, c: e, c2: 'white' });
    // Catalysing Elements: boosted by the ground, the skill sets off Catalysing Discharge of its element where you are,
    // that part's own damage (calc.js trig parts), its cooldown
    const k = `TriggeredCatalysingDischarge${cap(e)}Player`, T = !S.src && S.dmg?.trig?.find(T => T.parts?.[k]), D = T && T.parts[k];
    if (D && spend(T)) { const X = asTrig(S, { ...T, ...D, id: T.id }, D.hits); say(X.label, e); boom(at, X.A, X); }
    return withEl(S, e);
  }

  // ---------- things that live in the scene for a while
  function thing(mesh, dur, o = {}) {
    scene.add(mesh);
    const e = { pos: mesh.position, r: 0, dead: false, s: 0, dur, ...o,
      update(dt) { e.s += dt; o.tick?.(dt, e); if (e.s >= e.dur && !e.dead) { e.dead = true; o.end?.(e); } },
      remove() { fx.drop(mesh); o.off?.(e); } };
    objs.push(e); return e;
  }
  const holder = c => { const g = new THREE.Group(); g.position.set(c.x, 0, c.z); return g; };
  // Overgrowth (keywords.json): never from the plant's own skill; Thunderstorm's area, a passive's chance as the plant is
  // created, an item's as it enters your Presence (calc.js character() overgrow). Accelerated Growth then explodes there
  // after its delay, its own damage and area (calc.js trig)
  function overgrow(o) {
    if (o.overgrown || o.dead) return; o.overgrown = true; const S = o.plant, st = S.dmg?.stats || {};
    // an Overgrown plant's own bonuses (its stats "when wet"): more damage, a larger area
    o.more = 1 + (st['plant_skill_damage_+%_final_when_wet'] || 0) / 100;
    o.R *= Math.sqrt(1 + (st['vine_arrow_area_of_effect_+%_final_when_wet'] ?? st['awakened_forest_area_of_effect_+%_final_when_wet'] ?? 0) / 100);
    fx.ring(o.c, .2, o.R, 'poison', .5); fx.emit(14, { p: { x: o.c.x, y: .1, z: o.c.z }, r: o.R * .8, v: .4, up: 2, life: .8, size: .25, c: 'poison' });
    say(t('{0} is Overgrown', S.label), 'poison');
    const G = sheet().overgrow;   // a chance for Nature's Archon, not while one is on or during its recovery
    if (time - archonAt >= G.archonTime + G.archonDelay && Math.random() * 100 < G.archon) {
      archonAt = time; buffs.push({ label: t("Nature's Archon"), img: api.archonIcon, c: css('poison'), s: G.archonTime }); say(t('{0} active', t("Nature's Archon")), 'poison');
    }
    const T = S.dmg.trig?.find(x => x.stats?.['triggered_by_support_explosive_growth_%']); if (!T || !spend(T)) return;
    const X = asTrig(S, T); later(T.stats.support_explosive_growth_explosion_delay_X_ms / 1000, () => boom(o.c, X.A, X));
  }
  // as a plant is created: the passives' chance (certain under Nature's Archon), the item's if it is in your Presence;
  // the item's again each time it enters your Presence
  function planted(e) {
    const G = sheet().overgrow; e.inP = dist(pp, e.c) <= G.r;
    if (Math.random() * 100 < G.now + (archonOn() ? api.archon['chance_for_plants_to_be_overgrown_%'] : 0) || e.inP && Math.random() * 100 < G.near) overgrow(e);
  }
  function presence(e) { const G = sheet().overgrow, inP = dist(pp, e.c) <= G.r; if (inP !== e.inP && (e.inP = inP) && Math.random() * 100 < G.near) overgrow(e); }
  // Toxic Growth: its Pustules land around the impact (its secondary radius), each hitting where it lands, then burst
  // after their detonation time with the burst part's damage (calc.js parts)
  const PUSTULE = new THREE.SphereGeometry(.28, 8, 6);
  function pustules(S, c) {
    const st = S.dmg.stats, n = sh(S).projectiles || 1, spread = (st.active_skill_base_secondary_area_of_effect_radius || 0) / 10, X = partOf(S, Object.keys(S.dmg.parts || {})[0]);
    for (let k = 0; k < n; k++) {
      const a = rnd(TAU), r = Math.sqrt(rnd()) * spread, q = { x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r };
      boom(q, S.A, S, { soft: true, noPay: k > 0 });
      limit(o => o.plant && o.name === S.name, st.number_of_poisonbloom_arrow_bloom_allowed, S);   // Toxic Growth: up to its most pustules
      const m = new THREE.Mesh(PUSTULE, new THREE.MeshStandardMaterial({ color: 0x5f8a2a, emissive: 0x1d3008, roughness: .6 })); m.position.set(q.x, .25, q.z);
      // Overgrown, a Pustule grows as though dealing its poison per minute: stored, it detonates faster and harder (as poisoned)
      planted(thing(m, sh(S).detonate || SIM.lifetime, { name: S.name, plant: S, c: q, R: S.A, stored: 0,
        tick: (dt, e) => { presence(e); if (e.overgrown) e.s += stores(st, e, (st.pustules_grow_as_though_dealing_X_poison_damage_per_minute_when_wet || 0) / 60, dt); },
        end: e => { if (X) { const B = burst(st, e.stored); say(t('{0} detonates', S.label), 'poison'); boom(q, X.A + B.r, { ...X, mult: X.mult * B.more }); } } }));
    }
  }
  // ---------- Remnants (keywords.json Remnant): your persistent skills drop them where their condition is met, for their
  // duration; walking over one collects it. Its effect +%, chance for one more, delay and pickup range are the gem's stats
  // with its supports' (Remnant Potency, Harmonic / Magnetic Remnants); Selfless Remnants gives it to your allies instead
  const REMNANT = {
    'Lingering Illusion': { c: 'arcane', get: (s, k, S) => gainCharge('power', S.label) },   // its copy's Remnant
    'Life Remnants': { c: 'blood', kill: s => s['life_remnants_chance_to_spawn_orb_on_killing_enemy_%'], every: s => s.life_remnants_spawn_remnant_on_hit_vs_enemy_every_X_ms,
      get: (s, k) => { me.life = overflow(me.life, me.maxL, s.life_remnants_gain_per_globe * k); } },
    'Mana Remnants': { c: 'lightning', ail: true, kill: s => s['mana_remnants_chance_to_spawn_orb_on_killing_enemy_with_elemental_ailment_%'], crit: true,
      every: s => s.mana_remnants_spawn_remnant_on_crit_vs_elemental_ailment_enemy_every_X_ms, get: (s, k) => { me.mana = gain(me.mana, me.maxM, s.mana_remnants_mana_gain_per_globe * k); } },
    'Sanguine Revelry': { c: 'fire', bleed: true, kill: s => s['sanguine_revelry_%_change_to_create_remnant_on_killing_bleeding_enemy'], every: s => s.create_furious_remnant_when_hitting_bleeding_enemies_once_every_x_ms,
      get: (s, k) => { gainRage(s.sanguine_revelry_rage_gain_per_pickup * k);   // the life by the Rage you have once it is granted
        me.life = gain(me.life, me.maxL, me.maxL * (s['sanguine_revelry_remnant_restore_%_permyriad_of_max_life_per_5_current_rage'] || 0) / 1e6 * k * Math.floor(me.rage / 5)); } },
    'Remnants of Kalguur': { c: 'gold', kill: s => s['ward_remnants_chance_to_spawn_orb_on_killing_enemy_%'], stun: s => s['ward_remnants_chance_to_spawn_remnant_on_stun_%'],
      stunCd: s => s.ward_remnants_spawn_remnant_on_stun_cooldown_ms, get: (s, k) => { me.ward = overflow(me.ward, me.maxW, s.ward_remnants_gain_per_globe * k); } },
    // Into the Breach, Wildwood's Gifts: while on, a Flame of Chayula / an Ancient Bloom appears within its spawn radius of
    // you every its interval, one of their kinds (keywords.json FlamesOfChayula, AncientBlooms): the Flames leech their %
    // of your maximum life or mana, or grant their % of damage as extra chaos, stacking; the Blooms grant their charges to
    // your charms, your mana flask or your life flask
    // note: the chaos buff's 8 s and 10 stacks are the keyword's text; which kind appears is random here
    'Into the Breach': { spawn: s => s.breach_flame_spawn_rate_ms, kinds: [
      { c: 'blood', get: (s, k) => leechIn('life', me.maxL * s['breach_flame_life_leech_%'] / 100 * k) },
      { c: 'cold', get: (s, k) => leechIn('mana', me.maxM * s['breach_flame_mana_leech_%'] / 100 * k) },
      { c: 'chaos', get: (s, k) => { const n = Math.min(10, (buffs.find(b => b.name === 'chayulaFlame')?.n || 0) + 1); setBuff({ label: t('Flame of Chayula'), name: 'chayulaFlame', n, c: css('chaos'), s: 8, gain: { el: 'chaos', pct: n * s['breach_flame_chaos_addition_%'] * k } }); } }] },
    "Wildwood's Gifts": { spawn: s => s.breach_flame_spawn_rate_ms, kinds: [
      { c: 'gold', get: (s, k) => charms().forEach((f, n) => { if (f) me.cc[n] = Math.min(f.max, charmLeft(n) + s.ancient_gifts_charm_charges_restored * k); }) },
      { c: 'cold', get: (s, k) => flaskGain(1, s.ancient_gifts_mana_flask_charges_restored * k) },
      { c: 'blood', get: (s, k) => flaskGain(0, s.ancient_gifts_life_flask_charges_restored * k) }] },
    // Rip: a killing blow of a supported melee attack on a bleeding enemy, its chance for a Blood Remnant within its radius;
    // collected, its faster life regeneration for its duration
    // Grim Feast: a Reviving minion slain in your Presence (its chance) leaves a Grim Remnant storing its % of the minion's
    // maximum life; collected, it adds to the life you hold, up to its most (see grim)
    'Grim Feast': { c: 'chaos', get: (s, k, S) => { me.grim = Math.min(s.grim_remnant_max_health_stored, me.grim + S.store * k); } },
    Rip: { c: 'blood', get: (s, k, S) => { const su = S.dmg.sum; me.rip = { rate: su['rip_support_life_regeneration_rate_+%'] * k, until: time + su.rip_support_buff_base_duration / 1000 }; } },
  };
  const leechIn = (r, n) => { const q = me.leech[r]; q.left += n; q.rate = q.left; };   // over one second, as Leech
  const flaskGain = (n, k) => { const f = flasks()[n]; if (f) me.fl[n] = Math.min(f.max, flaskLeft(n) + k); };
  // the flask and charm charges a kill grants (by its rarity and Power), with Bounty's more (bk); Devour's quality on a corpse it consumes
  function killCharges(d, bk = () => 1) {
    const r = d.stat.rarity || 'normal';
    flasks().forEach((f, n) => { if (f) me.fl[n] = Math.min(f.max, flaskLeft(n) + pow(d) * FLASK_GAIN[r] * f.gain * bk(n ? 'mana_flask' : 'life_flask') + (Math.random() * 100 < f.killCharge)); });   // and its own chance of a charge (Nascent Hope)
    charms().forEach((f, n) => { if (f) me.cc[n] = Math.min(f.max, charmLeft(n) + pow(d) * CHARM_GAIN * f.gain * bk('charm') + (Math.random() * 100 < f.killCharge)); });
  }
  const OVERFLOW = 1.5;   // keywords.json Overflow: "can be recovered up to 1.5 times that maximum"
  const gain = (v, max, n) => Math.max(v, Math.min(max, v + n)), overflow = (v, max, n) => gain(v, max * OVERFLOW, n);   // what is already above the top stays
  const EL_AIL = ['ignite', 'chill', 'freeze', 'shock', 'electrocute'];   // keywords.json ElementalAilments
  const ORB = new THREE.SphereGeometry(.22, 10, 8), remnantAt = {};
  const remnantSkills = () => api.build().gems.flatMap((g, i) => REMNANT[g.name] && tog[g.name] ? [base(i)] : []).filter(S => S?.dmg?.stats);
  // the gem's stats and, of the Remnant ones, what its supports, the tree and gear add (calc.js sum)
  const rstats = S => { const s = { ...S.dmg.stats }; for (const [k, x] of Object.entries(S.dmg.sum || {})) if (/remnant/.test(k) && typeof x === 'number') s[k] = (s[k] || 0) + x; return s; };
  function remnant(S, p) {
    const s = rstats(S), R = REMNANT[S.name], n = 1 + (Math.random() * 100 < (s['chance_%_to_create_additional_remnant'] || 0) ? 1 : 0);
    const reach = SIM.pickup * (1 + (s['remnant_pickup_range_+%'] || 0) / 100);
    const drop = (V, c, again) => { const m = new THREE.Mesh(ORB, new THREE.MeshBasicMaterial({ color: fx.color(V.c, 2.2), fog: false }));
      m.position.set(c.x, .5, c.z);
      thing(m, (s.base_remnant_duration_ms || SIM.lifetime * 1000) / 1000, { name: S.name, c,
        tick(dt, e) { m.position.y = .5 + Math.sin(e.s * 4) * .08; if (dist(pp, c) <= reach) { e.dead = true; collect(S, V, c); if (!again && s.remnants_you_create_reappear_X_ms_after_being_collected) later(s.remnants_you_create_reappear_X_ms_after_being_collected / 1000, () => drop(V, c, true)); } } });   // Stormweaver's reappearing once
    };
    const only = ['red', 'blue', 'purple'].findIndex(c => s[`can_only_spawn_${c}_flame_of_chayula_remnants`]);   // Acolyte of Chayula's Choice of Life / Mana / Power: every Flame is that one
    for (let j = 0; j < n; j++) drop(R.kinds ? R.kinds[only >= 0 && S.name === 'Into the Breach' ? only : Math.floor(rnd(R.kinds.length))] : R, j ? around(p, SIM.pickup) : { x: p.x, z: p.z });
  }
  // Explosive Transmutation, while on: picking up a Remnant explodes there, its part of the Remnant's element (an
  // Infusion's, or a skill's Remnant of an element's colour). ponytail: other Remnants (life, mana...) set off none
  function transmute(c, el) { const S = onS('Explosive Transmutation'), X = S && partOf(S, `ExplosiveTransmutation${cap(el)}Player`); if (X?.dmg) boom(c, X.A, X); }
  function collect(S, R, c) {
    transmute(c, R.c);
    const s = rstats(S), k = 1 + (s['remnant_effect_+%'] || 0) / 100;
    fx.ring(c, .15, .8, R.c, .3); fx.emit(10, { p: { x: c.x, y: .5, z: c.z }, r: .2, v: 1.2, up: 1.5, life: .5, size: .14, c: R.c, c2: 'white' });
    if (s.remnants_affect_allies_in_presence_instead) return say(t('{0}: the Remnant affects your allies', S.label), R.c);   // the scene's minions have no life of their own
    const RP = sheet().remnantPick; me.life = Math.min(me.maxL, me.life + me.maxL * RP.life / 100); me.mana = Math.min(me.maxM, me.mana + me.maxM * RP.mana / 100);   // the tree's life and mana on collecting one
    later((s.remnant_delay_X_ms || 0) / 1000, () => { R.get(s, k, S); if (Math.random() * 100 < (sheet().remnantTwice || 0)) R.get(s, k, S); hudT = 0; fx.glow({ x: pp.x, y: 1.2, z: pp.z }, .9, R.c, .35); });
  }
  // a hit of yours (each skill no more than once in its time; Mana Remnants on a critical hit on an enemy with an elemental
  // ailment, Sanguine Revelry on a bleeding one), a kill (its chance, under the same condition), a heavy stun (Kalguur's
  // chance, its cooldown)
  function remnantOn(type, d, crit) {
    for (const S of remnantSkills()) {
      const R = REMNANT[S.name], s = rstats(S); if (R.spawn) continue;
      const ok = (!R.ail || EL_AIL.some(a => d.st[a] > 0)) && (!R.bleed || d.st.bleed > 0);
      if (type === 'hit') { const ms = R.every?.(s); if (ok && ms && (!R.crit || crit) && time - (remnantAt[S.name] ?? -99) >= ms / 1000) { remnantAt[S.name] = time; remnant(S, d.pos); } }
      else if (type === 'kill') { if (ok && Math.random() * 100 < (R.kill?.(s) || 0)) remnant(S, d.pos); }
      else if (R.stun && time - (remnantAt[S.name] ?? -99) >= (R.stunCd(s) || 0) / 1000 && Math.random() * 100 < (R.stun(s) || 0)) { remnantAt[S.name] = time; remnant(S, d.pos); }
    }
  }
  // ---------- Elemental Infusions (keywords.json ElementalInfusion): Remnants some skills leave (skillfx leaves); walking
  // over one grants the Infusion for 20 s (its increased duration) or until a skill consumes it, up to the most of each
  // kind, with its chance of one more (calc.js infusion). A skill that can consume one does on use (skillfx infuses),
  // its own kind first, else a Verisium one; its chance not to remove it, the power charge it may grant
  const chanAt = {}, chan0 = {}, chanInf = {}, fus = {};   // chan0: when a channelling started (and whether Empowered: Flame Breath); fus: Ember Fusillade's Embers
  const INF_TIME = 20, INF_C = { fire: 'fire', cold: 'cold', lightning: 'lightning', verisium: 'gold' };   // note: keywords.json "for 20 seconds"
  const infNow = el => (me.inf[el] = (me.inf[el] || []).filter(x => x > time));
  const EQUILIBRIUM = { fire: 'lightning', lightning: 'cold', cold: 'fire' };   // Elemental Equilibrium: the Infusion Remnant you create instead
  function infRemnant(el, p, o = {}) {   // o: its pickup range +% (Siphon Elements), its duration (Runic Extraction's)
    if (sheet().equilibrium) el = EQUILIBRIUM[el] || el;
    const c = { x: p.x, z: p.z }, m = new THREE.Mesh(ORB, new THREE.MeshBasicMaterial({ color: fx.color(INF_C[el], 2.2), fog: false })), reach = SIM.pickup * (1 + (o.range || 0) / 100); m.position.set(c.x, .5, c.z);
    thing(m, o.dur || SIM.lifetime, { name: 'infusion', c, tick(dt, e) { m.position.y = .5 + Math.sin(e.s * 4) * .08; if (dist(pp, c) <= reach) { e.dead = true; infGain(el, c); transmute(c, el); } } });
  }
  // Siphon Elements, while on: a chance of a Remnant of that kind when you freeze (per Power of the enemy), ignite a
  // target not ignited or shock one not shocked
  const SIPHON = { freeze: ['cold', 'freezing'], ignite: ['fire', 'igniting'], shock: ['lightning', 'shocking'] };
  function siphon(a, d) {
    const g = tog['Siphon Elements'] && gemBy('Siphon Elements'), st = g && api.damage?.(g)?.stats, [el, v] = SIPHON[a] || []; if (!st || !el) return;
    if (Math.random() * 100 < (st[`infusion_remnants_%_chance_to_spawn_${el}_infusion_on_${v}_an_enemy`] || 0) * (a === 'freeze' ? pow(d) : 1))
      infRemnant(el, d.pos, { range: st['remnant_pickup_range_+%'] });
  }
  const bombed = (M, p) => { boom(p, M.R, M.S); if (M.S.P.leaves) infRemnant(M.S.P.leaves, p); };   // Living Bomb's seed
  function infGain(el, c, k = 1) {
    const I = sheet().infusion, max = el === 'verisium' ? Math.max(...Object.values(I.max)) : I.max[el], q = infNow(el);
    const until = time + INF_TIME * I.time * k; q.push(until); if (Math.random() * 100 < I.more) q.push(until);
    q.sort((a, b) => a - b); while (q.length > max) q.shift();
    fx.ring(c, .15, .8, INF_C[el], .3); fx.glow({ x: pp.x, y: 1.2, z: pp.z }, .9, INF_C[el], .35); hudT = 0;
  }
  function infTake(S, el) {
    const I = sheet().infusion;
    for (const k of [el, 'verisium']) {
      const q = infNow(k); if (!q.length) continue;
      if (Math.random() * 100 >= I.keep) q.shift();
      me.infUsed = time; if (I.power) chargeBy('power', S); hudT = 0;
      say(t('{0} consumes {1}', S.label, api.infusion?.(k)?.name || k), INF_C[k]); return true;
    }
    return false;
  }
  // Earthshatter's look (warrior_earthshatter; its tutorial video). Its slam has no impact of its own (its art is none):
  // its fissure starts with 32 sparks for 0.1-0.2 s (start_midup: 1 / 0.51 / 0.3), dust for 2 s (0.19) and rocks lying
  // for 4-8 s (start_fwdline), jagged rock along it. Its spike (spike_01): a cluster of 47 grey spikes for its duration
  // (Spike_01), rising with 2 streaks up for 0.7 s (summon_01: 1 / 0.79 / 0.7), a ring for 0.3 s (0.3 / 0.2 / 0.09),
  // dust and rocks, sinking with dust and rocks (submerge_01). Shattered (shockwave_01): a blast down for 0.13 s (8 /
  // 2.65 / 1.45), a flash for 0.28 s from 0.04 s, a ring for 0.3 s from 0.08 s, a wave for 0.55 s from 0.07 s, smoke for
  // 1.3 s from 0.06 s, dust up and away for 2 s, embers for 1.85-3.5 s, rocks lying for 6-10 s and its crater for 5 s.
  // note: its fissure's length and its spikes' size are the scene's (not in its data), as are the counts and speeds
  const ESH = { spark: 0xff824d, dust: 0x303030, rock: 0x45423f, spike: 0x5c5853, streak: 0xffc9b3, ring: 0xffab4d, blast: 0xff542e, ember: 0xff7a3d };
  const ES_CONE = new THREE.ConeGeometry(.12, 1, 5);
  function esSpikes() {
    const g = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ color: ESH.spike, roughness: .8, flatShading: true });
    for (let i = 0; i < 47; i++) {
      const a = rnd(TAU), d = rnd(.7), m = new THREE.Mesh(ES_CONE, mat), h = rnd(.8, 2) * (1 - d * .6);
      m.scale.set(1, h, 1); m.position.set(Math.cos(a) * d, h * .45, Math.sin(a) * d); m.rotation.set(Math.sin(a) * d * .9, 0, -Math.cos(a) * d * .9); m.castShadow = true; g.add(m);
    }
    return g;
  }
  function esStep(p, first) {
    const q = { x: p.x, y: .1, z: p.z };
    if (first) fx.emit(32, { p: q, r: .2, v: 3, up: 1.5, life: .15, size: .04, c: ESH.spark, c2: 'white', k: 2.4, drag: 2 });
    fx.spikes(p, .45, { n: 4, h: .6, w: .1, dur: .9, dark: true, c: ESH.spike });
    fx.emit(5, { p: q, r: .3, v: .6, up: .5, life: 2, size: .4, grow: 1.6, c: ESH.dust, smoke: true, a: .35, drag: 1.5 });
    fx.emit(4, { p: q, r: .2, v: 1.5, up: 2, life: 6, size: .07, c: ESH.rock, smoke: true, a: .9, g: 9, drag: .4 });
  }
  function esRise(c) {
    const q = { x: c.x, y: .2, z: c.z };
    for (let i = 0; i < 2; i++) fx.streak(V(c.x, 0, c.z), V(c.x + rnd(-.2, .2), 2.4, c.z + rnd(-.2, .2)), ESH.streak, .7, .05, 1.2);
    fx.ring(c, .2, 1.2, ESH.ring, .3, { a: .7 }); shake = Math.max(shake, .15);
    fx.emit(28, { p: q, r: .5, v: 1.2, up: .8, life: 2, size: .5, grow: 1.6, c: ESH.dust, smoke: true, a: .35, drag: 1.5 });
    fx.emit(10, { p: q, r: .3, v: 2, up: 2.5, life: 6, size: .08, c: ESH.rock, smoke: true, a: .9, g: 9, drag: .4 });
  }
  function esShatter(c, R) {
    const q = { x: c.x, y: .6, z: c.z };
    fx.glow(q, R, ESH.blast, .13, 3); later(.04, () => fx.glow(q, R * .8, ESH.ring, .28, 2.2)); shake = Math.max(shake, Math.min(.5, R * .15));
    later(.08, () => fx.ring(c, .2, R * 1.2, ESH.ring, .3, { a: .8 })); later(.07, () => fx.ring(c, R * .3, R * 1.4, ESH.streak, .55, { a: .4, y: .4 }));
    later(.06, () => fx.emit(20, { p: { x: c.x, y: .1, z: c.z }, r: .3, v: R * 3, up: .1, life: 1.3, size: .5, grow: 1.8, c: ESH.dust, smoke: true, a: .35, drag: 2, flat: true }));
    later(.1, () => { fx.emit(28, { p: q, r: .4, v: 1, up: 1.5, life: 2, size: .5, grow: 1.6, c: ESH.dust, smoke: true, a: .35, drag: 1.2 }); fx.emit(28, { p: q, r: .4, v: 3, up: .3, life: 2, size: .4, grow: 1.6, c: ESH.dust, smoke: true, a: .3, drag: 1.5 }); });
    fx.emit(24, { p: q, r: .3, v: 4, up: 3, life: 2.5, size: .04, c: ESH.ember, c2: 'white', k: 2.4, g: 2, drag: 1 });
    fx.emit(24, { p: q, r: .3, v: 5, up: 3, life: 8, size: .09, c: ESH.spike, smoke: true, a: .95, g: 9, drag: .3 });
    later(.1, () => fx.disc(c, R * 1.1, 0x0a0806, 5, { dark: true, tex: 'cracks', a: .85, hold: .6, y: .032 }));
  }
  // earthen objects (Earthshatter's spikes, Forge Hammer's hammer, Shield Wall's walls): up to the skill's limit, the oldest
  // goes; for its duration
  // up to a limit: the oldest of the objects f picks gives way
  // S: the skill, for the tree's more of it (Orb skills', Elemental skills')
  const limit = (f, max, S) => { const T = S && max && sheet(); if (T) max += (T.limit || 0) + (S.kind === 'orb' ? T.orbLimit : 0) + (S.els?.some(e => ELEM.includes(e)) ? T.elLimit : 0);
    const mine = objs.filter(o => f(o) && !o.dead); while (max && mine.length >= max) mine.shift().dead = true; };
  const SPEAR = new THREE.CylinderGeometry(.03, .03, 1.3, 5), SPEAR_M = new THREE.MeshStandardMaterial({ color: 0x8a8070, metalness: .6, roughness: .5 });
  const EARTH = { spike: new THREE.ConeGeometry(.35, 1.6, 6), hammer: new THREE.BoxGeometry(.7, .5, .4) };
  function earth(S, c, max, spike) {
    limit(o => o.earth && o.name === S.name, max, S);
    const m = spike ? esSpikes() : new THREE.Mesh(EARTH.hammer, new THREE.MeshStandardMaterial({ color: 0x3a3430, emissive: S.els.includes('fire') ? 0x5a1a04 : 0, roughness: .9, flatShading: true }));
    m.position.set(c.x, spike ? 0 : .35, c.z); m.rotation.set(spike ? 0 : .5, rnd(TAU), 0); m.castShadow = true;
    if (spike) esRise(c); else pop(c, .6, 'dust');
    const e = thing(m, S.P.dur || SIM.lifetime, { r: .4, name: S.name, earth: S, near: p => dist(p, c), off: () => { if (spike && !e.gone) esStep(c); },   // its spike sinks
      // a warcry near it shatters it: the spike's explosion, or the hammer's Molten Fissures in a spiral (calc.js parts)
      shatter() {
        e.dead = true; if (spike) e.gone = true; else pop(c, 1, 'dust'); const X = partOf(S, spike ? 'EarthshatterSpikePlayer' : 'ForgeHammerFissurePlayer'); if (!X) return;
        say(t('{0} shatters', S.label), X.el);
        if (spike) { esShatter(c, X.A); return area(c, X.A, X); }
        const n = S.dmg.stats.base_number_of_fissures || 1, a0 = rnd(TAU);
        for (let k = 0; k < n; k++) later(k * .08, () => fissure(X, c, a0 + k * TAU / n, 5, X.A, 1, { dur: X.dmg.stats.base_skill_effect_duration / 1000, max: S.dmg.stats.forge_hammer_base_maximum_number_of_fissures }));
      } });
  }
  // the hammer flies back to you at its speed, hitting each enemy within its area on the way once (ponytail: the path
  // to where you stand when it leaves; follow you if it matters)
  function recall(S, h) {
    const X = partOf(S, 'ForgeHammerRecallPlayer'), from = { x: h.pos.x, z: h.pos.z }, to = { x: pp.x, z: pp.z }, seen = new Set(), len = dist(from, to);
    h.dead = true; say(t('{0} returns', S.label), S.el); if (!X) return;
    nextCdX = 1 + (X.dmg.stats['supplementary_stat_container_attack_speed_+%_final'] || 0) / 100;
    const m = new THREE.Mesh(EARTH.hammer, new THREE.MeshStandardMaterial({ color: 0x3a3430, emissive: 0x5a1a04, roughness: .9, flatShading: true }));
    m.position.set(from.x, 1, from.z);
    thing(m, len / ((S.dmg.stats.forge_hammer_hammer_speed || 300) / 10), { tick(dt, e) {
      const k = Math.min(1, e.s / e.dur), p = { x: from.x + (to.x - from.x) * k, z: from.z + (to.z - from.z) * k };
      m.position.set(p.x, 1, p.z); m.rotation.x += dt * 14;
      for (const d of inside(p, X.A)) if (!seen.has(d)) { seen.add(d); hit(d, X); }
    } });
  }
  // a Toxic Pustule stores the poison dealt to its enemy; poisoned, its time runs out faster (1% per its amount of the
  // poison per minute); it bursts for 1% more damage per its amount stored and +0.1 m per its amount, up to their most
  // (Poison Spores' explosion stats, as their names read)
  function pustule(d, dt) {
    const U = d.pustule, st = U.st, pd = d.st.poison > 0 && d.burn.poison ? d.burn.poison.dps : 0;
    U.left -= dt + stores(st, U, pd, dt);
    if (Math.random() < dt * 6) fx.emit(1, { p: { x: d.pos.x, y: 1.5 * d.sc, z: d.pos.z }, r: .2, v: .2, up: .5, life: .6, size: .22, c: 'poison' });
    if (U.left > 0) return;
    d.pustule = null;
    const B = burst(st, U.stored);
    say(t('{0} detonates', U.X.label), 'poison'); boom({ x: d.pos.x, z: d.pos.z }, U.X.A + B.r, { ...U.X, mult: U.X.mult * B.more });
  }
  // stores the poison per second pd for dt; returns the extra time it runs out
  function stores(st, U, pd, dt) { U.stored += pd * dt; return dt * pd * 60 / (st['toxic_pustule_duration_expires_1%_faster_per_x_stored_poison_damage_multiplied_by_sixty'] || Infinity) / 100; }
  const burst = (st, n) => ({ more: 1 + Math.min(st['toxic_pustule_max_burst_damage_+%_final_from_stored_poison'] || 0, n / (st['toxic_pustule_burst_1%_more_damage_per_x_stored_poison'] || Infinity)) / 100,
    r: Math.min(st['toxic_pustule_max_additional_burst_base_radius_+'] || 0, n / (st['toxic_pustule_burst_base_radius_+1_per_x_stored_poison'] || Infinity)) / 10 });
  // Shockchain Arrow: its hit on an enemy with a lightning ailment releases its shockwave (its explosion part) there and
  // consumes the Shock, then chains its more times on to such enemies near, each releasing a shockwave; after the last it
  // lodges there as a Lightning Rod (up to its most). Its homing: shoot()
  const litUp = e => has(e, 'shock') || has(e, 'electrocute');   // an enemy with a lightning ailment
  function shockchain(S, d) {
    const X = partOf(S, 'ShockchainArrowExplosionPlayer'); if (!X) return;
    const st = S.dmg.stats, lit = litUp, seen = new Set([d]), wave = e => { boom({ x: e.pos.x, z: e.pos.z }, X.A, X); clear(e, 'shock'); };
    let at = d, n = lit(d) ? st.shockchain_arrow_X_additional_chains_on_first_hitting_shocked_or_electrocuted_enemy : 0;
    if (n) wave(d);
    for (; n > 0; n--) {
      const e = near(at.pos, sh(S).chainRange || SIM.chainRange, e => !seen.has(e) && lit(e)); if (!e) break;
      seen.add(e); fx.bolt(chest(at), chest(e), 'lightning', .18); hit(e, S); wave(e); at = e;
    }
    limit(o => o.rod && o.name === S.name, st.number_of_lightning_rods_allowed, S); rod(S, { x: at.pos.x, z: at.pos.z });
  }
  // Lightning Spear: where it hits it bursts, its bolts (its secondary part's projectiles) striking as many other enemies
  // in its area; with a Frenzy Charge spent it first splits into its more copies, each hitting another enemy there and
  // bursting too. note: the bolts strike at once (their flight is a look only)
  function spearBurst(S, d) {
    const X = partOf(S, 'LightningSpearSecondaryProjectilePlayer'); if (!X) return;
    const copies = nearest(d.pos, S.spent ? S.dmg.stats.lightning_spear_additional_number_to_split_when_charged : 0, e => e !== d && dist(e.pos, d.pos) <= S.A);
    for (const e of copies) { fx.bolt(chest(d), chest(e), S.el, .18); hit(e, S); }
    for (const c of [d, ...copies]) for (const e of nearest(c.pos, sh(X).projectiles || 1, e => e !== c && dist(e.pos, c.pos) <= S.A)) { fx.bolt(chest(c), chest(e), 'lightning', .18); hit(e, X); }
  }
  // the part a consumed Infusion of that kind brings (Spark's cold-infused sparks, Comet's blast, Firestorm's ice and
  // lightning bolts, Fireball's firebolts...): the one named after it, else the skill's one infused or secondary part
  const infPart = (S, el) => { const ks = Object.keys(S.dmg?.parts || {}), E = cap(el);
    const k = ks.find(k => k.includes(E + 'Infus')) || ks.find(k => /Infus/.test(k) && !/(Cold|Fire|Lightning)Infus/.test(k)) || ks.find(k => /Secondary|Ground|Beam/.test(k));
    return k && partOf(S, k); };
  const flagOf = (n, f) => !!SK.skills[n]?.flags?.includes(f);   // a flag of the skill or support called n (skills.json)
  const lasts = S => S.dmg?.sum?.support_number_of_additional_uses_before_expiry || 0;   // Durability: the additional Hits its object lasts
  const radOf = (X, k = 'secondary') => (X.dmg.stats[`active_skill_base_${k}_area_of_effect_radius`] || 10) / 10;   // a part's other radius, m
  // a part of the skill with its own damage (calc.js parts), as a skill of the scene
  const partOf = (S, id) => { const D = S.dmg?.parts?.[id], els = Object.keys(D?.hits || {}), r = D?.stats.active_skill_base_area_of_effect_radius; return D && { ...S, dmg: { ...D, trig: [] }, A: r < 0 ? Math.max(.1, S.A + r / 10) : (r || 10) / 10, el: els.find(e => e !== 'physical') || els[0], els, ail: ailOf(els), mult: 1, gm: 1 }; };
  // Shield Wall: its wall of earth in segments (its secondary radius each), each with its life; enemies on their way to
  // you attack the one in front of them. Your Slams and warcries shatter them all; each explodes around itself, more
  // when slammed, less within its first 0.5 s when enemies break it
  function shieldWall(S, a, b, c, dur) {
    const st = S.dmg.stats, r = (st.active_skill_base_secondary_area_of_effect_radius || 10) / 10, len = dist(a, b), n = Math.max(1, Math.round(len / (2 * r))), g = holder(c), born = time;
    limit(o => o.earth && o.name === S.name, st.base_number_of_shield_walls_allowed, S);
    const segs = Array.from({ length: n }, (_, i) => {
      const k = (i + .5) / n, p = { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k };
      const m = new THREE.Mesh(new THREE.BoxGeometry(len / n * .95, 1.3, .45), new THREE.MeshStandardMaterial({ color: 0x6b5a48, roughness: .95, flatShading: true }));
      m.position.set(p.x - c.x, .65, p.z - c.z); m.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x); m.castShadow = true; g.add(m); pop(p, .5, 'dust');
      return { p, r, m, life: st.shield_wall_maximum_life || 1, hurt(n) { if ((this.life -= n) <= 0) blow(this, time - born < .5 ? 1 + (st['shield_wall_damage_+%_final_for_first_500_ms_when_not_killed_by_self'] || 0) / 100 : 1); } };
    });
    const blow = (q, mult) => { if (q.life === -1) return; q.life = -1; q.m.visible = false; pop(q.p, r, 'dust'); boom(q.p, r, { ...S, mult: S.mult * mult }); if (segs.every(x => x.life === -1)) e.dead = true; };
    const e = thing(g, dur, { name: S.name, earth: S, segs, a, b, near: p => segDist(p, a, b),
      shatter(how) { say(t('{0} shatters', S.label), 'dust'); for (const q of segs) blow(q, how === 'slam' ? 1 + (st['shield_wall_damage_+%_final_when_slammed'] || 0) / 100 : 1); } });
  }
  // the Shield Wall segment between enemy d and you, the nearest
  const wallIn = d => { let best = null, k = dist(d.pos, pp);
    for (const o of objs) if (o.segs && !o.dead && !(o.rhoa && me.mounted)) for (const q of o.segs) if (q.life > 0 && dist(d.pos, q.p) < k && (o.decoy || segDist(q.p, d.pos, pp) < q.r + SIM.body)) { best = q; k = dist(d.pos, q.p); }
    return best; };
  // Lingering Illusion: while it is on, a roll leaves a copy of you where it began, for its duration, with its share of
  // your maximum life; enemies nearer to it than to you attack it, and one they destroy drops its Remnant (a power charge)
  function illusion(S, p) {
    const st = S.dmg.stats, f = makeMinion(fx, 'arcane'); f.group.position.set(p.x, 0, p.z);
    const q = { p, r: .3, life: Math.max(1, me.maxL * st['lingering_illusion_clone_base_maximum_life_%_of_owner_maximum_life'] / 100),
      hurt(n) { if (q.life > 0 && (q.life -= n) <= 0) { e.dead = true; pop(p, .6, 'arcane'); remnant(S, p); } } };
    const e = thing(f.group, durOf(S), { name: S.name, decoy: true, segs: [q] });
  }
  // Mirage Archer (a dodge roll), Mirage Deadeye (a ranged projectile attack of yours): a Mirage where you stood that uses
  // the ranged attacks placed in it, in turn, for its duration, with its less damage, once every its cooldown (skills.json
  // meta_skill, meta_support)
  // A djinn (Disciple of Varashta's Ruzhan, Kelari and Navira) acts only on Command: its own gem, used while it is out,
  // Commands its first skill, and a Command gem the skill of its name (calc.js cmd: the skill's cast time, and the hits and
  // ailments of each of its parts, of the djinn's damage; monsters.json: each part's area and stats). Each damaging part
  // hits its area at your target, the later ones a moment after and over no less than the first one's (the knives'
  // eruption, the runes' tornado, the wave of lava); a part of several projectiles is fired from the djinn in two volleys
  // that explode in the next part's area (Ruzhan's Fury).
  // Kelari's Deception leaves a clone for its duration, which explodes when it is used again, with its more damage per use
  // in a row; Navira's Fracturing hits the enemies standing on Chilled Ground within its radius of her; Navira's Well
  // starts your energy shield's recharge at once; a Command to Navira grants her gem's increased mana regeneration for
  // her wave's duration (Navira's Calming); Ruzhan deals his gem's more damage per damaging skill you used Recently.
  // note: not in the data, so left out: the delay of Ruzhan's Brand (it explodes as it is placed), how many runes Ruzhan's
  // Trap spreads and knives Kelari's Brutality throws (one hit each over the area), the stages of Kelari's Judgment
  // (one), what Navira's Embrace absorbs, Navira's Oasis, the recharge rate of Navira's Well, whether Navira's Fracturing
  // uses up the ground (it stays)
  const damaging = S => Object.keys({ ...S.dmg?.hits, ...S.dmg?.dot }).length > 0;
  const djMore = st => 1 + (st['djinn_damage_+%_final_per_number_of_damaging_skills_my_parent_has_used_recently'] || 0) * used.filter(u => u.dmg && !u.cmd && time - u.t <= RECENT).length / 100;   // Ruzhan's
  function djinnCast(S) {
    const C = S.dmg.cmd, e = objs.find(o => o.minion && o.ofS === C.owner && !o.dead), key = C.key, sets = monSkill(key).sets, at = { x: S.at.x, z: S.at.z };
    if (!e) return toast(t('{0} needs a minion', S.label));
    const ost = onS(C.owner)?.dmg?.stats || {}, rad = s => (s?.const?.active_skill_base_area_of_effect_radius || s?.const?.active_skill_base_secondary_area_of_effect_radius || 0) / 10, r0 = rad(sets[0]);
    const part = i => { const h = C.hits[i] || {}, els = Object.keys(h); return els.length ? { ...S, src: 'minionHit', els, el: els[0], aoe: true, A: rad(sets[i + 1]) || SIM.area, dmg: { ...S.dmg, hits: h, ail: C.ail[i], stats: ost, trig: [] }, mult: S.mult * djMore(ost) } : null; };
    const CL = key === 'ExplosiveTeleportSandDjinn' && me.djClone, seq = CL && !CL.dead ? CL.n + 1 : 0;
    if (C.owner === 'Navira, the Last Mirage') { me.navira = { until: time + monSkill('PassiveTriggeredManaWaveWaterDjinn').sets[0].const.base_skill_effect_duration / 1000, v: ost['water_djinn_mana_wave_mana_regeneration_rate_+%'] || 0 }; fx.ring(e.pos, .3, 2.5, 'cold', .5); }
    later(C.cast, () => {
      if (e.dead) return;
      if (key === 'ESRechargeForceRestartWaterDjinn') { me.esEarly = 1e9; fx.pillar(pp, .5, 2.6, 'arcane', .4, 2); }
      if (seq) { const X = part(0); boom({ x: CL.pos.x, z: CL.pos.z }, r0, { ...X, mult: X.mult * (1 + sets[0].const['djinn_damage_+%_final_per_teleport_in_sequence'] * seq / 100) }); CL.dead = true; }
      sets.forEach((s, i) => { const X = part(i), n = s.const?.base_number_of_projectiles; if (!X) return;
        if (n > 1) { for (let k = 0; k < n; k++) later(k < n / 2 ? 0 : .35, () => { const a = Math.atan2(at.x - e.pos.x, at.z - e.pos.z) + rnd(-.35, .35); shoot(X, { x: e.pos.x, z: e.pos.z }, Math.sin(a), Math.cos(a)); }); return; }
        later(i * .4, () => { if (key === 'ChilledGroundBurstWaterDjinn') { for (const d of inside(e.pos, r0)) if (grounds.some(g => !g.dead && g.type === 'chilled' && dist(g, d.pos) <= g.r)) { fx.explode(d.pos, 1, X.el, {}); hit(d, X); } } else boom(at, Math.max(rad(s), r0) || SIM.area, X); }); });
      if (key === 'ExplosiveTeleportSandDjinn') { const f = makeMinion(fx, 'physical'); f.group.position.set(at.x, 0, at.z); me.djClone = thing(f.group, sets[0].const.base_skill_effect_duration / 1000, { name: S.name }); me.djClone.n = seq; }
      if (key === 'MeteorFireDjinn') { e.pos.x = at.x; e.pos.z = at.z; }   // Ruzhan's Reckoning: he teleports there
    });
    say(S.label, S.el);
  }
  // Ruzhan's Zealotry: when you use a damaging skill yourself he Strikes the enemies near your target, inflicting Exposure,
  // once every its cooldown. note: its area is not in the data (the scene's)
  function zealotry(S) {
    const Z = onS('Ruzhan, the Blazing Sword'), K = Z?.dmg?.cmd?.strike, e = K?.hits && objs.find(o => o.minion && o.ofS === Z.name && !o.dead);
    if (!e || time < me.zealAt || !damaging(S) || S.dmg.cmd) return;
    me.zealAt = time + K.cooldown; const els = Object.keys(K.hits), at = { x: S.at.x, z: S.at.z };
    later(monSkill(K.key).cast, () => { boom(at, SIM.area, { ...Z, src: 'minionHit', els, el: els[0], at, dmg: { ...Z.dmg, hits: K.hits, trig: [] }, mult: djMore(Z.dmg.stats) }); for (const d of inside(at, SIM.area)) expo(d, ELEM); });
  }
  function mirage(name) {
    const M = onS(name), D = M && SK.skills[name], X = D && Object.values(D.meta_skill)[0];
    const js = M ? api.build().gems.map((_, j) => j).filter(j => api.usedBy(j) === M.g && base(j)?.dmg?.speed) : [];
    if (!js.length || time < me.mirAt?.[name]) return;
    (me.mirAt ||= {})[name] = time + X.constant._cooldown_ms / 1000;
    const p = { x: pp.x, z: pp.z }, f = makeMinion(fx, 'arcane'), more = 1 + D.meta_support['support_lingering_mirage_damage_+%_final'] / 100; f.group.position.set(p.x, 0, p.z);
    let wait = .3, k = 0;
    // ponytail: the Mirage attacks from where it stands by moving you there for the use (aim reads your position), as Hollow Form's images
    thing(f.group, (X.levels[M.g.level] || X.levels[1]).base_skill_effect_duration / 1000, { name, tick(dt) {
      if ((wait -= dt) > 0) return; const j = js[k++ % js.length], d = near(p, SIM.projRange); wait = 1 / base(j).dmg.speed; if (!d) return;
      const o = { x: pp.x, z: pp.z }; pp.x = p.x; pp.z = p.z; use(j, { at: { x: d.pos.x, z: d.pos.z }, src: 'meta', more }); pp.x = o.x; pp.z = o.z; } });
  }
  // Abyssal Apparition (the Lich's): a damaging spell you cast consumes a Power Charge and an Apparition casts that spell
  // too, with its less damage (skills.json). Not channelled, cooldown, triggered or item-granted spells, nor those that
  // already consume a Power Charge (its text). Its look is the game's: a dark figure with its yellow-green glow (the
  // apparition's material, AO_Glow 0.81 1 0.23) that fades out in about a second (apparition_fade's emitter).
  // note: where it stands and how long it waits to cast are not in the data: beside you, a step back, a quarter second
  const ABYSS = 0xcfff3b;
  function apparition(i, S) {
    const j = byName('Abyssal Apparition'), P = S.P, src = api.info(S.g).gem?.source;
    if (j < 0 || !P.spell || P.channel || S.dmg?.cooldown || !damaging(S) || P.spend.includes('power') || P.spendOne || !(charges.power > 0) || ['item_base', 'unique_item', 'item_mod'].includes(src)) return;
    charges.power--; chargesSpent(1, 'power');
    const D = SK.skills['Abyssal Apparition'], g = api.build().gems[j], more = 1 + ((D.levels[g.level] || D.levels[1])['damage_+%_final_from_lich_apparition_cloned_skill'] || 0) / 100;
    const p = { x: pp.x - S.dz * 1.4 - S.dx * .7, z: pp.z + S.dx * 1.4 - S.dz * .7 }, at = { ...S.at }, halo = new THREE.Mesh(new THREE.TorusGeometry(.2, .018, 6, 28), fx.glowMat(ABYSS, 2.4, .9));
    halo.position.set(0, 1.78, -.12);
    visage(p, at, { name: 'Abyssal Apparition', c: ABYSS, body: 0x3a3c42, glow: .09, a: .92, dark: 0x26272b, halo, back: { x: -S.dx, z: -S.dz } },
      () => use(i, { at, src: 'apparition', here: true, more }), P, S);
  }
  // a figure of you at p facing at (Abyssal Apparition, Align Fate's visage): it appears in its colour, casts after a
  // quarter second (by moving you there for the use, as mirage()) and fades out by 1.4 s. o: c (glow colour), body,
  // glow (its emissive), a (opacity), dark (second spark colour), halo (a mesh over its head), back (where its fade
  // blows), spawn (its own appearing instead of the sparks and ring)
  function visage(p, at, o, cast, P, S) {
    const G = makeHumanoid(fx), halo = o.halo; if (o.look) G.setLook(o.look);
    G.group.position.set(p.x, 0, p.z); G.group.rotation.y = Math.atan2(at.x - p.x, at.z - p.z); if (halo) G.group.add(halo);
    let wait = .25;
    const dye = a => G.group.traverse(m => { if (!m.isMesh || m === halo || !m.material?.color) return;
      if (!m.userData.dyed) { m.userData.dyed = true; m.material = m.material.clone(); m.material.color.set(o.body); m.material.emissive?.set(o.c); m.material.emissiveIntensity = o.glow; m.castShadow = false; }
      m.material.transparent = true; m.material.opacity = a; });
    if (o.spawn) o.spawn(p);
    else { fx.emit(24, { p: { x: p.x, y: .2, z: p.z }, r: .5, h: 1.6, v: 1.2, up: 1.5, life: .4, size: .22, c: o.c, c2: o.dark, k: 1.6, drag: 2 }); fx.ring(p, .2, 1.1, o.c, .35, { a: .6 }); }
    thing(G.group, 1.4, { name: o.name,
      tick(dt, e) {
        G.update(dt, {}); const a = e.s < .15 ? e.s / .15 : e.s > .9 ? Math.max(0, (1.4 - e.s) / .5) : 1; dye(o.a * a); if (halo) halo.material.opacity = .9 * a;
        if (Math.random() < a * .25) fx.emit(1, { p: { x: p.x, y: rnd(.2, 1.7), z: p.z }, r: .45, v: .4, up: .8, life: .35, size: .1, c: o.c, k: 1.4, drag: 1 });
        if (wait > 0 && (wait -= dt) <= 0) {
          G.act(clipOf(P, S.kind, G.family()), .5);
          const q = { x: pp.x, z: pp.z }; pp.x = p.x; pp.z = p.z; cast(); pp.x = q.x; pp.z = q.z;
        }
        if (e.s > .9 && Math.random() < .5) fx.emit(2, { p: { x: p.x, y: rnd(.3, 1.6), z: p.z }, r: .35, dir: V(o.back?.x || 0, .6, o.back?.z || 0), v: 1.5, life: .3, size: .2, c: o.c, k: 1.6, drag: 1.5 });   // the fade's ribbons
      },
      off() { G.dispose(); halo?.geometry.dispose(); } });
  }
  // Skittering Stone: enough enemies killed within its radius of an earthen object of the supported skill shatter it,
  // releasing its stones (calc.js minionOf: the game's monster), each for its duration, up to its most
  function hatch(p) {
    for (const o of objs) {
      const T = !o.dead && o.earth && o.earth.dmg?.trig?.find(T => T.stats?.['triggered_by_support_hatching_elementals_%']), U = T?.support;
      if (!T?.minion || o.near(p) > U.support_hatching_elementals_base_radius / 10 || (o.kills = (o.kills || 0) + 1) < U.support_hatching_elementals_hatch_after_X_deaths_in_radius) continue;
      o.kills = 0; if (Math.random() * 100 >= (U['support_chance_to_trigger_hatching_elementals_%'] ?? 100)) continue;
      o.dead = true; const at = o.a ? { x: (o.a.x + o.b.x) / 2, z: (o.a.z + o.b.z) / 2 } : { x: o.pos.x, z: o.pos.z }, X = asTrig(o.earth, T, T.minion.hits);
      X.dmg = { ...X.dmg, ...T.minion }; X.P = { ...X.P, ranged: false }; pop(at, 1, 'dust'); say(t('{0} shatters', o.earth.label), 'dust');
      const room = T.stats.maximum_hatching_elementals_allowed - objs.filter(x => x.kind === T.id && !x.dead).length;
      for (let k = Math.min(T.stats.support_hatching_elementals_number_of_elementals_per_hatch, room); k > 0; k--) minion(X, around(at, 1), T.shape?.duration || T.stats.base_skill_effect_duration / 1000, { kind: T.id });
    }
  }
  // Artillery Ballista (its bolt: Rain, Area, ProjectileNoCollision; crossbow_ripwire_ballista): the totem looses its
  // salvo skyward with an orange flash, sparks and a puff of grey steam at its muzzle (muzzle_flash: cone 1 / 0.65 / 0.45,
  // sparks 1 / 0.39 / 0.39, steam 0.3 / 0.29 / 0.27, a small screen shake); each bolt falls on a spot of its own around
  // the target with an orange head and a pale salmon trail (proj_head 0.8 / 0.41 / 0.26, ripwire_trail 1 / 0.66 / 0.58)
  // and hits its area there, flinging orange embers (spear_embers 1 / 0.38 / 0.24). A look only, around them: the volley
  // loosed skyward (onACT_clusterFire: at least 64 arrows in a 7.5° cone) and the rain of bolts that falls with them
  // (rain_of_death: at least 32 Arrow meshes in a filled circle, falling fast, leaning 0.18 to 0.43 rad, stuck in the
  // ground for 10 to 15 s). note: how far apart the bolts land is not in the data (within the bolt's radius of the
  // target here), nor the parameter that raises those counts (the least of each here); flight time and height are the
  // scene's
  const ART = { flash: 0xffa673, spark: 0xff6363, steam: 0x4d4a45, head: 0xff8254, trail: 0xffa894, ember: 0xff613d, bolt: 0x4a3828 };
  function artillery(TS, e, d, n, R) {
    const top = V(e.pos.x, 1.5, e.pos.z);
    fx.glow(top, 1.1, ART.flash, .15, 2); fx.emit(10, { p: top, up: 3, r: .1, v: 1.5, life: .25, size: .06, c: ART.spark, c2: 'white', k: 2.4, drag: 2 });
    fx.emit(4, { p: top, up: .8, r: .15, v: .3, life: 1.2, size: .45, grow: 1.6, c: ART.steam, smoke: true, a: .4, drag: 1 });
    shake = Math.max(shake, .06);
    fx.emit(64, { p: top, dir: V(0, 14, 0), v: 1.8, life: .3, size: .05, c: ART.trail, c2: 'white', k: 2 });
    const c = { x: d.pos.x, z: d.pos.z }; later(.8, () => rain.fall(c, R, 32));
    for (let i = 0; i < n; i++) later(i * .07, () => {
      const a = rnd(TAU), l = Math.sqrt(Math.random()) * R, to = V(d.pos.x + Math.cos(a) * l, 0, d.pos.z + Math.sin(a) * l), m = fx.arrow(ART.head);
      m.children[0].material.color.copy(fx.color(ART.bolt, 2.6)); m.children[1].scale.setScalar(.35);
      lob(m, top.clone(), to, .8, 6, () => {
        area(to, R, TS);
        fx.emit(8, { p: { x: to.x, y: .15, z: to.z }, r: .1, v: 2.5, up: 1.5, life: .35, size: .06, c: ART.ember, c2: 'white', k: 2.2, drag: 2, g: 6 });
        fx.glow({ x: to.x, y: .3, z: to.z }, .8, ART.flash, .12, 1.8);
      }, { trail: ART.trail, aim: true });
    });
  }
  const rain = (() => {
    const N = 512, m = new THREE.InstancedMesh(new THREE.CylinderGeometry(.012, .012, .8, 5).translate(0, .4, 0), new THREE.MeshStandardMaterial({ color: ART.bolt, roughness: .8 }), N);
    const L = Array.from({ length: N }, () => ({ end: -1 })), M = new THREE.Matrix4(), Z = new THREE.Matrix4().makeScale(0, 0, 0), Q = new THREE.Quaternion(), E = new THREE.Euler(), P = new THREE.Vector3(), S1 = new THREE.Vector3();
    for (let i = 0; i < N; i++) m.setMatrixAt(i, Z);
    m.frustumCulled = false; scene.add(m); let next = 0;
    return {
      fall(c, R, n) {
        for (let k = 0; k < n; k++, next = (next + 1) % N) { const a = rnd(TAU), l = Math.sqrt(Math.random()) * R; L[next] = { x: c.x + Math.cos(a) * l, z: c.z + Math.sin(a) * l, at: time + rnd(.35), end: time + rnd(10, 15), rx: rnd(.18, .43), ry: rnd(TAU) }; }
      },
      update() {
        for (let i = 0; i < N; i++) {
          const b = L[i]; if (b.end < 0) continue;
          const k = (time - b.at) / .12;
          if (time >= b.end || k < 0) { m.setMatrixAt(i, Z); if (time >= b.end) b.end = -1; continue; }
          if (k >= 1 && !b.hit) { b.hit = true; fx.emit(2, { p: { x: b.x, y: .1, z: b.z }, v: 1.5, up: 1, life: .25, size: .05, c: ART.ember, c2: 'white', k: 2.2, g: 6 }); }
          P.set(b.x, Math.max(0, 1 - k) * 3 - .1, b.z); Q.setFromEuler(E.set(b.rx, b.ry, 0, 'YXZ'));
          m.setMatrixAt(i, M.compose(P, Q, S1.set(1, Math.min(1, b.end - time), 1)));   // sinking away in its last second
        }
        m.instanceMatrix.needsUpdate = true;
      } };
  })();
  function lob(mesh, from, to, dur, h, land, o = {}) {
    mesh.position.copy(from); scene.add(mesh); let k = 0;
    const e = { pos: mesh.position, dead: false,
      update(dt) {
        k = Math.min(1, k + dt / dur);
        mesh.position.set(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k + Math.sin(k * Math.PI) * h, from.z + (to.z - from.z) * k);
        if (o.spin) mesh.rotation.x += dt * 9;
        if (o.aim) mesh.lookAt(from.x + (to.x - from.x) * (k + .01), from.y + (to.y - from.y) * (k + .01) + Math.sin((k + .01) * Math.PI) * h, from.z + (to.z - from.z) * (k + .01));   // pointing the way it flies
        o.each?.(dt);
        if (o.drip && Math.random() < dt * 40) fx.emit(1, { p: mesh.position, v: .2, life: .7, size: .09, c: o.drip, g: 9 });   // a flask spilling its liquid as it flies (liquid_spill trails)
        if (o.trail) fx.emit(o.big ? 4 : 1, { p: mesh.position, v: .5, life: o.big ? .6 : .3, size: o.big ? .6 : .16, c: o.trail, c2: 'white', drag: 1 });
        if (k >= 1) { e.dead = true; land(); }
      },
      remove() { fx.drop(mesh); } };
    objs.push(e); return e;
  }
  // A Hazard a support leaves: it arms after arm s, then hits the first enemy to step in its area and is gone (unless it
  // rearms: the tree's chance), for dur s;
  // o.early: its damage +% final if set off within its first 0.5 s (Brambleslam's, "when not killed by self")
  // o.reach: how near an enemy sets it off (else its area); o.delay: it goes off that long after (Conductive Runes);
  // o.set(p): as it is set off; o.boom(p): its own explosion's look;
  // o.more(t): its damage multiplier t s after arming (Ice Shards); o.mesh: what stands there; o.then(p): after it goes off
  function hazardAt(X, p, dur, o = {}) {
    const arm = o.arm || 0, hold = Math.max(arm, X.dmg?.sum?.hazards_cant_trigger_x_seconds_after_creation || 0), c = o.c || 'dust', reach = o.reach || X.A, g = holder(p);   // Controlled Hazard: not set off before its seconds
    const decal = fx.decal(p, reach, 'patch', c, { a: .8, k: 1 }); if (o.mesh) g.add(o.mesh);
    const e = thing(g, dur, { name: X.name, hazard: true,
      tick() {
        if (e.set || e.s < hold || !dummies.some(d => !d.dead && dist(d.pos, p) <= reach + SIM.body)) return;
        const S2 = { ...X, haz: true, mult: X.mult * (e.s < .5 && o.early ? 1 + o.early / 100 : 1) * (o.more?.(e.s - arm) ?? 1) }; e.set = true; me.hazTrig = [...(me.hazTrig || []).filter(t => time - t <= RECENT), time];   // the Hazards triggered recently
        o.set?.(p);
        later(o.delay || 0, () => { if (Math.random() * 100 < (X.dmg?.sum?.['hazard_rearm_%_chance'] || 0)) e.set = false; else e.dead = true; for (const d of inside(p, X.A)) d.hazAt = time; area(p, X.A, S2); o.then?.(p);
          if (o.boom) o.boom(p); else fx.emit(10, { p: { x: p.x, y: .2, z: p.z }, r: X.A, v: 1.5, up: 1, life: .3, size: .1, c, c2: 'white' }); });
      },
      off: () => decal.remove() });
  }
  const around = (c, r) => { const a = rnd(TAU), k = rnd(r); return { x: c.x + Math.sin(a) * k, z: c.z + Math.cos(a) * k }; };
  // Surges (keywords.json Surge): consuming a charge (Elemental Surge, Chaotic Surge) or reloading (Gemini Surge, cold and
  // fire in turn) triggers that skill to give your weapon its Surges, up to its most of each kind, for its duration. A
  // non-melee projectile attack consumes one of each kind: its projectiles (Gemini Surge's: its number per use; not the
  // ones that split or fork) burst at the end of their flight with that skill's hit of the kind (its part, else its own).
  // note: the level of the triggered skill is not in the data: the attack's own
  const SURGE_OF = { fire: 'Elemental Surge', cold: 'Elemental Surge', lightning: 'Elemental Surge', chaos: 'Chaotic Surge' };
  // a skill the build is granted (not one of its gems), as calc.js has it: the same object each time, for app.js's cache
  const grants = {}, granted = (name, level = 1, part) => api.damage?.(grants[name + level + part] ??= { name, level, supports: [], part });
  function surgeGain(name, el, n) {
    const st = n > 0 && granted(name)?.stats; if (!st) return;
    surges = surges.filter(s => s.until > time);
    for (let have = surges.filter(s => s.name === name && s.el === el).length; n > 0 && have < st.maximum_number_of_instilling_stacks; n--, have++)
      surges.push({ name, el, until: time + st.base_skill_effect_duration / 1000 });
    const L = ESURGE[el], q = hand(); if (L && name !== 'Gemini Surge') { fx.ball(q, .12, L.crystal, .3, 2.4); fx.glow(q, .6, L.gain, .5, 2.2); }   // its gain on your weapon (Elemental Surge's look)
    hudT = 0;
  }
  // charges of a type consumed: the surges they grant, when (for "if you've consumed a ... Charge Recently") and what the
  // tree recovers for each (calc.js recoverOn: mana for a power charge, life for an endurance charge)
  const chargesSpent = (n, c) => {
    if (!(n > 0)) return; const U = sheet().surge?.charge || {}; for (const el in U) surgeGain(SURGE_OF[el], el, U[el] * n);
    (me.spentAt ||= {})[c] = time; if (c === 'power') me.powerLost = time; (me.spentLog = (me.spentLog || []).filter(x => time - x.t <= RECENT)).push({ t: time, n, c });   // how many Recently
    if (c === 'power') gainPct('mana', recOn('power') * n); if (c === 'endurance') gainPct('life', recOn('endurance') * n);
  };
  // the tree's recovery on an event (calc.js recoverOn), a % of your maximum life / mana
  const recOn = k => sheet().recoverOn?.[k] || 0;
  const gainPct = (k, pct) => { if (pct > 0) { const top = k === 'life' ? me.maxL : me.maxM; me[k] = Math.min(top, me[k] + top * pct / 100); } };
  const gemini = () => { const U = sheet().surge?.reload, el = (me.gem = !me.gem) ? 'cold' : 'fire'; if (U) surgeGain('Gemini Surge', el, U[el]); };
  function surgeTake() {
    const took = [], G = granted('Gemini Surge')?.stats.surge_can_apply_to_X_number_of_projectiles_per_skill_use;
    surges = surges.filter(s => s.until > time && (took.some(o => o.name === s.name && o.el === s.el) || !took.push({ ...s, n: s.name === 'Gemini Surge' ? G : Infinity })));
    return took;
  }
  function surgeBlast(S, s, p) {
    const D = granted(s.name, S.g?.level); if (!D) return;
    const B = asTrig(S, { ...D, id: s.name }), id = Object.keys(D.parts || {}).find(k => k.toLowerCase().includes(s.el)), X = id ? { ...partOf(B, id), A: B.A } : B;
    if (s.name === 'Gemini Surge') { fx.ring(p, .2, X.A, s.el, .3); boom(p, X.A, X); return; }
    if (s.el === 'chaos') chaosBurst(p, X.A); else elemBurst(p, X.A, s.el);
    area(p, X.A, X);
  }
  // Chaotic Surge's look (instilling_chaos: ChaosInfusionProjectile infusion_CHAOS.epk on the projectile, ChaosInfusionExplosion
  // spear_discharge chaos_AoE.ao where it ends): the projectile trails violet strings for 0.35-1.2 s and a ribbon for 0.4-0.55 s
  // (strings_CHAOS 1.7 / 1.05 / 7, quickRibbon_CHAOS 2.25 / 1.2 / 8, their colour look-ups' tops); its burst (aoe_chaos.pet)
  // a flash and a push wave for 0.2 s (impactFlash_Chaos 0.21 / 0.13 / 0.79, windPushWave_Chaos 0.1 / 0.05 / 0.49), streaks
  // for 0.25 s (0.26 / 0.2 / 1), a ring for 0.5 s (Vibrance 0.76 / 0.65 / 1), flames for 0.3-0.4 s (0.16 / 0.08 / 0.71), a dark
  // sphere for 0.35 s and 64 embers for 0.5-1.5 s. note: the embers' colour is their texture's: the ring's here
  const CSURGE = { flash: 0x442aff, wave: 0x341aff, streak: 0x4233ff, ring: 0xc2a6ff, flame: 0x391dff, string: 0x3e26ff, ribbon: 0x4826ff };
  function chaosBurst(p, R) {
    const c = { x: p.x, y: .6, z: p.z };
    fx.flash(c, CSURGE.flash, 10, .2, 5); fx.glow(c, R * 1.2, CSURGE.flash, .2, 2.5); fx.ring(p, .2, R, CSURGE.wave, .2, { a: .6 });
    fx.ring(p, .3, R * .9, CSURGE.ring, .5, { a: .8, y: .3 }); fx.glow(c, R * .6, 0x05020c, .35, 1);   // its dark sphere
    fx.emit(10, { p: c, r: .2, v: R * 4, up: .3, life: .25, size: .12, c: CSURGE.streak, k: 2.4, drag: 3 });   // its streaks
    fx.emit(8, { p: c, r: R * .3, v: .6, up: 1.2, life: .35, size: .45, grow: 1.6, c: CSURGE.flame, k: 2.2, drag: 1 });
    fx.emit(64, { p: c, r: R * .3, v: R * 1.5, up: 1.5, life: 1, size: .05, c: CSURGE.ring, k: 2.4, g: 2, drag: 1.5 });
  }
  // Elemental Surge's look (instilling_X: XInfusionProjectile infusion_X.epk on the projectile, XInfusionExplosion
  // spear_discharge X_AoE.ao where it ends; no tutorial video). Gaining a Surge (InstilledX on your weapon,
  // skill_charges/elemental_infusion X_charge.pet): a crystal for 0.3 s and a glow for 0.5 s (fire 1 / 0.26 / 0.1 and 1 /
  // 0.48 / 0.1, cold 0.6 / 0.76 / 1 and 0.7 / 0.82 / 1, lightning 0.15 / 0.24 / 1, chaos 0.18 / 0.01 / 1 and 0.24 / 0.08 /
  // 1). The projectile trails strings for 0.35-1.2 s and a ribbon for 0.4-0.55 s (fire 1 / 0.48 / 0.15 and 1 / 0.33 / 0.1,
  // cold 0.4 / 0.6 / 1 and 0.45 / 0.67 / 1, lightning 0.15 / 0.24 / 1 and 0.2 / 0.28 / 1; chaos CSURGE's). Its burst: fire
  // (aoe_fire) a flash for 0.2 s (1 / 0.64 / 0.3), a ring for 0.25 s from 0.1 s (1 / 0.65 / 0.24), flames for 0.22-0.68 s
  // from 0.12 s (1 / 0.38 / 0.11), a wave of fire for 0.45-0.8 s from 0.15 s (1 / 0.51 / 0.31), a push wave for 0.2 s from
  // 0.18 s (1 / 0.33 / 0.1) and sparks for 1-2 s (1 / 0.28 / 0.08); cold (aoe_cold) a flash (0.5 / 0.78 / 1), icy strings
  // for 0.12-1.65 s (0.7 / 0.91 / 1), a cold sphere for 0.6-0.8 s (0.65 / 0.77 / 1), its push wave (0.52 / 0.81 / 1), crystal
  // dust for 1.5-2.5 s and dust for 1-1.5 s (0.37 / 0.39 / 0.46); lightning (aoe_light) a flash (0.4 / 0.6 / 1), bolts for
  // 0.06-0.28 s from 0.15 s (0.12 / 0.16 / 1), sparks for 0.15 s (0.1 / 0.19 / 1), its push wave (0.3 / 0.5 / 1) and a shock
  // wave for 0.09-0.25 s from 0.22 s. note: the trail its weapon leaves swinging while it has Surges is not drawn; counts,
  // sizes and speeds are the scene's
  const ESURGE = { fire: { crystal: 0xff421a, gain: 0xff7a1a, string: 0xff7a26, ribbon: 0xff541a, flash: 0xffa34d, ring: 0xffa63d, flame: 0xff611c, wave: 0xff824f, push: 0xff541a, spark: 0xff4714 },
    cold: { crystal: 0x99c2ff, gain: 0xb3d1ff, string: 0x6699ff, ribbon: 0x73abff, flash: 0x80c7ff, ice: 0xb3e8ff, sphere: 0xa6c4ff, push: 0x85cfff, dust: 0x5e6375 },
    lightning: { crystal: 0x263dff, gain: 0x263dff, string: 0x263dff, ribbon: 0x3347ff, flash: 0x6699ff, bolt: 0x1f29ff, spark: 0x1a30ff, push: 0x4d80ff },
    chaos: { crystal: 0x2e03ff, gain: 0x3d14ff, string: CSURGE.string, ribbon: CSURGE.ribbon } };
  function elemBurst(p, R, el) {
    const L = ESURGE[el], c = { x: p.x, y: .6, z: p.z };
    fx.flash(c, L.flash, 12, .2, 5); fx.glow(c, R * 1.1, L.flash, .2, 2.5);
    later(.18, () => fx.ring(p, .2, R, L.push, .2, { a: .6 }));
    if (el === 'fire') {
      later(.1, () => fx.ring(p, .3, R * .9, L.ring, .25, { a: .8, y: .3 }));
      later(.12, () => fx.emit(10, { p: c, r: R * .4, v: .6, up: 1.4, life: rnd(.22, .68), size: .4, grow: 1.6, c: L.flame, c2: L.ring, k: 2.2, drag: 1 }));
      later(.15, () => fx.emit(12, { p: { x: p.x, y: .2, z: p.z }, r: .2, v: R * 2.5, up: .3, life: rnd(.45, .8), size: .3, c: L.wave, k: 2.2, drag: 3, flat: true }));
      later(.05, () => fx.emit(48, { p: c, r: .2, v: R * 2.5, up: 2, life: rnd(1, 2), size: .04, c: L.spark, c2: 'white', k: 2.6, g: 5, drag: 1.5 }));
    } else if (el === 'cold') {
      later(.1, () => fx.ball(c, R * .45, L.sphere, rnd(.6, .8), 1.8));
      later(.1, () => fx.emit(24, { p: c, r: .2, v: R * 3, up: 1, life: rnd(.12, 1.65), size: .06, c: L.ice, c2: 'white', k: 2.4, drag: 2.5 }));
      later(.2, () => fx.emit(24, { p: c, r: R * .4, v: .5, up: .3, life: rnd(1.5, 2.5), size: .05, c: L.ice, c2: 'white', g: .5, drag: 1 }));
      later(.15, () => fx.emit(6, { p: { x: p.x, y: .15, z: p.z }, r: R * .4, v: 1, up: .4, life: rnd(1, 1.5), size: .7, grow: 1.8, c: L.dust, smoke: true, a: .35, drag: 1.5 }));
    } else {
      for (let i = 0; i < 6; i++) later(.15 + rnd(.1), () => { const a = rnd(TAU); fx.bolt(V(p.x, .6, p.z), V(p.x + Math.cos(a) * R * rnd(.5, 1), rnd(.1, 1), p.z + Math.sin(a) * R * rnd(.5, 1)), L.bolt, rnd(.06, .28), .03, .25); });
      later(.12, () => fx.emit(24, { p: c, r: .2, v: R * 3, up: 1, life: .15, size: .05, c: L.spark, c2: 'white', k: 2.6, drag: 2 }));
      later(.22, () => fx.ring(p, .2, R * .8, L.bolt, rnd(.09, .25), { a: .7, y: .5 }));
    }
  }
  // Elemental Expression's look (its elemental_strike effects, with the Invoker's materials; no tutorial video). Fiery
  // Explosion (fire_explode.ao, midline.pet): a flash for 0.12 s, a column of flame for 0.6 s (1 / 0.58 / 0.16), tufts of
  // flame for 0.4-0.8 s, a ring of dark smoke for 1.25-1.75 s, 128 sparks for 0.15-0.55 s and more for 1.5-2.5 s (1 / 0.28 /
  // 0.08), embers for 2-4 s (1 / 0.46 / 0.18) and its scorch on the ground for 4 s. Arcing Bolt (lightning_bolt.ao,
  // line2.pet): two ribbons of lightning for 0.35-0.55 s (0.05 / 0.06 / 0.2) with forks for 0.1-0.4 s (0.06 / 0.06 / 0.11);
  // at each it hits (lightning_impact.ao, end2.pet) a flash for 0.25 s, a sphere for 0.7 s, a ring for 0.4 s, sparkles for
  // 0.7-2.1 s, smoke for 2-4 s and the ground cracked for 5 s (0.23 / 0.25 / 1). Icy Wave (ElementalStrikeColdProjectile,
  // rig.ao, line2.pet): shimmering ice for 1.85-2.15 s, smoke kicked up for 0.4-1 s (0.51 / 0.55 / 0.62) and snow for 2-4 s
  // along its way. note: white where its colour is its texture's; counts, speeds and sizes are the scene's
  const EXPR = { flame: 0xff9429, spark: 0xff4714, ember: 0xff752e, smoke: 0x080808, scorch: 0x140804, bolt: 0x404dff, fork: 0x8c8cff, crack: 0x3b40ff, flash: 0xc8d0ff, kick: 0x828c9e, ice: 0xdff0ff };
  function exFire(c, R) {
    const q = { x: c.x, y: .5, z: c.z }, g = { x: c.x, y: .1, z: c.z };
    fx.glow(q, R * .7, EXPR.flame, .12, 3); fx.flash(q, EXPR.flame, 30 + R * 15, .3, 8 + R * 3); shake = Math.max(shake, Math.min(.4, R * .1));
    later(.02, () => fx.pillar(c, R * .35, 2.5, EXPR.flame, .6, 2.4));
    fx.emit(30, { p: q, r: R * .4, v: 1, up: 2, life: .6, size: .4, c: EXPR.flame, c2: EXPR.spark, k: 2.4, drag: 2 });
    fx.emit(16, { p: g, r: .3, v: R * 2, up: .1, life: 1.5, size: .6, grow: 1.8, c: EXPR.smoke, smoke: true, a: .5, drag: 2, flat: true });
    fx.emit(64, { p: q, r: .2, v: R * 3, up: 2, life: .35, size: .04, c: EXPR.spark, c2: 'white', k: 2.4, drag: 2 });
    later(.02, () => fx.emit(16, { p: q, r: .3, v: R * 1.5, up: 3, life: 2, size: .04, c: EXPR.spark, c2: 'white', k: 2.4, g: 6, drag: 1 }));
    fx.emit(12, { p: q, r: R * .5, v: .5, up: 1, life: 3, size: .05, c: EXPR.ember, c2: 'white', k: 2.4, drag: 1 });
    fx.disc(c, R, EXPR.scorch, 4, { dark: true, tex: 'cracks', a: .8, hold: .6, y: .033 });
  }
  function exBolt(from, to) {
    for (let j = 0; j < 2; j++) fx.bolt(from, to, EXPR.bolt, rnd(.35, .55), j ? .03 : .06, .4);
    for (let k = 0; k < 3; k++) { const m = from.clone().lerp(to, rnd(.2, .8)); fx.bolt(m, V(m.x + rnd(-.8, .8), m.y + rnd(-.5, .5), m.z + rnd(-.8, .8)), EXPR.fork, rnd(.1, .4), .015, .2); }
    const g = { x: to.x, z: to.z };
    fx.glow(to, 1, EXPR.flash, .25, 2.6); fx.flash(to, EXPR.bolt, 14, .25, 6); fx.ball(to, .5, EXPR.bolt, .7, 2); fx.ring(g, .2, 1.2, EXPR.bolt, .4, { a: .7 });
    fx.emit(10, { p: to, r: .3, v: 1.5, up: 1, life: 1.4, size: .04, c: EXPR.fork, c2: 'white', k: 2.4, drag: 1.5 });
    fx.emit(5, { p: { x: to.x, y: .1, z: to.z }, r: .4, v: .4, up: .4, life: 3, size: .6, grow: 1.6, c: EXPR.kick, smoke: true, a: .25, drag: 1.5 });
    fx.disc(g, .8, EXPR.crack, 5, { tex: 'cracks', a: .7, hold: .7, k: 1.5 });
  }
  // Elemental Expression (the Invoker's): a melee critical hit triggers it, within its cooldown: a fiery explosion at the
  // enemy, a bolt of lightning chaining from it or a wave of icy projectiles toward it, each as likely as your Strength,
  // Dexterity and Intelligence (the wave's spread: a look only). note: the level of the triggered skill is not in the data: the attack's own
  function expression(d, S) {
    const D = sheet().expression && granted('Elemental Expression', S.g?.level);
    if (!D || !spend({ id: 'Elemental Expression', cooldown: D.cooldown, uses: D.uses })) return;
    const a = sheet().attrs || {}, r = Math.random() * ((a.str || 0) + (a.dex || 0) + (a.int || 0)), el = r < a.str ? 'Fire' : r < a.str + a.dex ? 'Lightning' : 'Cold';
    const X = partOf(asTrig(S, { ...D, id: 'Elemental Expression' }), `ElementalExpression${el}Player`); if (!X) return;
    X.expr = el;   // its look (exFire, exBolt, shoot)
    if (el === 'Fire') { exFire(d.pos, X.A); area(d.pos, X.A, X); }
    else if (el === 'Lightning') chain(V(pp.x, 1.2, pp.z), d, X, chainsOf(X));
    else { const a0 = Math.atan2(d.pos.x - pp.x, d.pos.z - pp.z), n = X.dmg.stats.base_number_of_projectiles; for (let k = 0; k < n; k++) { const q = a0 + (k - (n - 1) / 2) * .25; shoot(X, pp, Math.sin(q), Math.cos(q)); } }
  }
  // Elemental Storm's look (stormweaver/elemental_storm.ao, its element's storm_X.pet, looping; no tutorial video): its core
  // of torn rings spinning a turn a second for 1-1.5 s (fire 1 / 0.37 / 0.1 through 1 / 0.72 / 0.61, cold 0.5 / 0.7 / 1
  // through 0.79 / 0.87 / 1, lightning 0.1 / 0.19 / 1 through 0.61 / 0.65 / 1), ribbons whirling round it for 1.4-2 s (fire's
  // flames, cold's 0.5 / 0.55 / 1; lightning's are bolts for 0.5-0.7 s, 0.4 / 0.4 / 1), 128 embers circling it 1.5 m out at
  // 4.2-5.2 rad/s for 1.5-4 s, and as it starts a wave for 0.5 s from 0.35 s (fire 1 / 0.37 / 0.1, cold 0.4 / 0.64 /
  // 1, lightning 0.15 / 0.24 / 1). note: its ring's width and height, how fast its embers rise and its ribbons' rate are the scene's
  const ESTORM = { fire: { core: 0xff5e1a, hi: 0xffb89c, ribbon: 0xff5e1a, wave: 0xff5e1a }, cold: { core: 0x80b3ff, hi: 0xc9deff, ribbon: 0x808cff, wave: 0x66a3ff },
    lightning: { core: 0x1a30ff, hi: 0x9ca6ff, ribbon: 0x6666ff, wave: 0x263dff, bolt: true } };
  const STORM_ARC = new THREE.TorusGeometry(1, .09, 6, 32, 2.4).rotateX(Math.PI / 2);
  // its storm is a ring round its area spinning low over the ground (as the game's): its core's torn rings (8, each
  // spinning and fading in and out over its life, at its own radius and height in the ring) and its 128 embers circling it,
  // built in the storm's holder g; stormLook moves them
  function stormBody(el, g, R) {
    const L = ESTORM[el], arcs = [], n = 128, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), em = [];
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(STORM_ARC, fx.glowMat(i % 4 ? L.core : L.hi, 1, 0)); g.add(m);
      arcs.push({ m, life: rnd(1.2, 1.5), age: rnd(1.2) }); stormArc(arcs[i], R);
    }
    for (let i = 0; i < n; i++) em.push({ a: rnd(TAU), w: rnd(4.2, 5.2), y: rnd(.1, .7), life: rnd(1.5, 4), age: rnd(4) });
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: .09, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    pts.userData.own = true; g.add(pts);
    return { arcs, em, pos, col, geo, R, L, c: fx.color(L.core, 2) };
  }
  function stormArc(A, R) { const r = R * rnd(.7, 1); A.m.position.y = rnd(.15, .6); A.m.scale.set(r, rnd(.8, 1.6), r); A.m.rotation.y = rnd(TAU); }
  function stormLook(c, dt, B) {
    const { L, R } = B;
    for (const A of B.arcs) {
      if ((A.age += dt) > A.life) { A.age = 0; A.life = rnd(1.2, 1.5); stormArc(A, R); }
      A.m.rotation.y -= TAU * dt; A.m.material.opacity = Math.sin(Math.PI * A.age / A.life) * .5;
    }
    B.em.forEach((E, i) => {
      if ((E.age += dt) > E.life) { E.age = 0; E.life = rnd(1.5, 4); E.y = rnd(.1, .4); E.a = rnd(TAU); }
      E.a += E.w * dt; E.y += .2 * dt; const f = Math.sin(Math.PI * E.age / E.life);
      B.pos.set([Math.cos(E.a) * 1.5, E.y, Math.sin(E.a) * 1.5], i * 3); B.col.set([B.c.r * f, B.c.g * f, B.c.b * f], i * 3);
    });
    B.geo.attributes.position.needsUpdate = B.geo.attributes.color.needsUpdate = true;
    const at = (a, r, h) => V(c.x + Math.cos(a) * r, h, c.z + Math.sin(a) * r);
    if (L.bolt) { if (Math.random() < dt * 13) { const a = rnd(TAU); fx.bolt(at(a, R * rnd(.7, 1), rnd(.2, .8)), at(a + rnd(.6, 1.2), R * rnd(.7, 1), rnd(.2, .8)), L.ribbon, rnd(.5, .7), .03, .2); } }
    else for (let n = dt * 30; n > 0; n--) if (n >= 1 || Math.random() < n) { const a = rnd(TAU), r = R * rnd(.7, 1);
      fx.emit(1, { p: at(a, r, rnd(.15, .7)), dir: V(-Math.sin(a) * r * 4, .2, Math.cos(a) * r * 4), life: rnd(.5, .8), size: .22, c: L.ribbon, c2: L.hi, k: 2.2, drag: 3 }); }
  }
  // Elemental Sundering's look (spear_extract_elements; its tutorial video). Where the spear is plunged (spear_surge,
  // ground_decal): its ribbons for 0.8-0.9 s from 0.3 s (fire 1 / 0.47 / 0.08, cold, lightning), cracked glowing ground for
  // 2 s (1 / 0.48 / 0.1), a flash of spikes for 0.2 s (0.65 / 0.79 / 1), rocks for 2-4 s, dust for 0.8-1.6 s, bolts for
  // 0.15-0.55 s and 64 embers for 1.5-2 s; its pulse (ground_wave) a ring for 0.4 s (1 / 0.51 / 0.15 through 0.15 / 0.24 /
  // 1) and cold smoke for 1 s from 0.1 s (0.36 / 0.4 / 0.46). Each ailment it consumes charges the enemy (charge_X: a glow
  // for 1 s and 16 ribbons for 1-1.1 s; fire 1 / 0.37 / 0.1, cold 0.7 / 0.82 / 1, lightning 0.15 / 0.24 / 1), then it
  // explodes (explosion_X, lightning's elemental_discharge lightning_aoe): a flash for 0.15 s, a wave for 0.45-0.5 s, a ring
  // for 0.3 s and a sphere for 0.5 s, cold with 128 flakes of snow for 1.5-2.5 s, fire with 128 sparks for 1-2 s, lightning
  // with 64 sparks for 1.5-3 s and 32 bolts dropping for 0.15-0.55 s. note: the explosion at the end of its 1 s charge, as
  // in the video (the data gives no delay: the ailment is kept meanwhile, elemental_sundering_pause_ailment); counts per
  // second, sizes and speeds are the scene's
  const SUND = { fire: { glow: 0xff5e1a, ribbon: 0xff7814, flash: 0xff7033, ring: 0xff8f26, spark: 0xff4714 }, cold: { glow: 0xb3d1ff, ribbon: 0xb3d1ff, flash: 0x99c2ff, ring: 0xb3d1ff, spark: 0xe0edff },
    lightning: { glow: 0x263dff, ribbon: 0x263dff, flash: 0x2129ff, ring: 0x333bff, spark: 0x99a6ff, bolt: 0x404dff }, ground: 0xff7a1a, spike: 0xa6c9ff, smoke: 0x5c6675, wave: 0xff8226 };
  function sunderPulse(c, R) {
    const q = { x: c.x, y: .3, z: c.z };
    later(.3, () => { for (const el of ['fire', 'cold', 'lightning']) fx.emit(2, { p: q, r: .1, v: 1, up: 3, life: rnd(.8, .9), size: .2, c: SUND[el].ribbon, c2: 'white', k: 2.2, drag: 2 }); });
    fx.disc(c, 1.2, SUND.ground, 2, { tex: 'cracks', a: .8, hold: .5, k: 1.4 });
    later(.05, () => fx.spikes(c, .6, { n: 7, h: .7, w: .06, c: SUND.spike, dur: .2 }));
    fx.emit(8, { p: q, r: .2, v: 2.5, up: 4, life: rnd(2, 4), size: .1, c: 'dust', c2: 0x6b5f50, g: 12, drag: .5, k: 1 });
    fx.emit(8, { p: { x: c.x, y: .1, z: c.z }, r: .3, v: 1.2, up: .8, life: rnd(.8, 1.6), size: .8, grow: 2, c: 'dust', smoke: true, a: .4, drag: 1.2 });
    for (let i = 0; i < 4; i++) { const a = rnd(TAU); fx.bolt(V(c.x, .1, c.z), V(c.x + Math.cos(a) * rnd(.4, 1), rnd(.1, .6), c.z + Math.sin(a) * rnd(.4, 1)), SUND.lightning.bolt, rnd(.15, .55), .02, .2); }
    fx.emit(64, { p: q, r: .2, v: 2, up: 2, life: rnd(1.5, 2), size: .04, c: SUND.ground, c2: 'white', k: 2.4, drag: 1.5 });
    fx.ring(c, .3, R, SUND.wave, .4, { a: .8 }); fx.ring(c, .2, R * .9, SUND.lightning.glow, .4, { a: .5 });
    later(.1, () => fx.emit(6, { p: { x: c.x, y: .15, z: c.z }, r: R * .5, v: R, life: 1, size: 1.2, grow: 1.8, c: SUND.smoke, smoke: true, a: .3, drag: 1.5, flat: true }));
  }
  function sunderCharge(d, el) {
    const L = SUND[el];
    fx.glow(chest(d), .7, L.glow, 1, 2);
    for (let i = 0; i < 16; i++) later(i / 16, () => { if (!d.dead) fx.emit(1, { p: chest(d), r: .35, v: .6, up: 1.2, life: rnd(1, 1.1), size: .16, c: L.ribbon, c2: 'white', k: 2.4, drag: 2 }); });
  }
  function sunderBlast(p, R, el) {
    const L = SUND[el], q = { x: p.x, y: .6, z: p.z };
    fx.glow(q, R * .9, L.flash, .15, 3); fx.flash(q, L.flash, 30 + R * 12, .3, 8 + R * 3); shake = Math.max(shake, Math.min(.35, R * .1));
    fx.ring(p, R * .2, R, L.ring, .5, { a: .8 }); later(.05, () => fx.ring(p, .1, R * .7, L.ring, .3, { k: 2.6 })); fx.ball(q, R * .45, L.glow, .5, 2);
    if (el === 'cold') fx.emit(128, { p: q, r: R * .4, v: R * 1.5, up: 1, life: rnd(1.5, 2.5), size: .05, c: L.spark, c2: 'white', g: 1, drag: 1.5 });
    else if (el === 'fire') later(.05, () => fx.emit(128, { p: q, r: .2, v: R * 3, up: 2.5, life: rnd(1, 2), size: .04, c: L.spark, c2: 'white', k: 2.6, g: 5, drag: 1.5 }));
    else {
      fx.emit(64, { p: q, r: .3, v: R * 2, up: 1.5, life: rnd(1.5, 3), size: .04, c: L.spark, c2: 'white', k: 2.4, drag: 1.5 });
      for (let i = 0; i < 32; i++) later(rnd(.2), () => { const a = rnd(TAU), r = R * rnd(.1, .9), x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r; fx.bolt(V(x, rnd(2, 3), z), V(x, .05, z), L.bolt, rnd(.15, .55), .03, .25); });
    }
  }
  // Elemental Storm (the Stormweaver's Tempest Caller): a spell critical hit triggers it, within its cooldown: a stationary
  // storm at the enemy for its duration, of the hit's highest elemental damage type (none from a hit with no elemental
  // damage), hitting the enemies in its area every its interval (stormLook)
  function storm(d, S, raw) {
    const el = ['fire', 'cold', 'lightning'].reduce((a, e) => (raw[e] || 0) > (raw[a] || 0) ? e : a, 'fire');
    const D = raw[el] > 0 && sheet().storm && granted('Elemental Storm', S.g?.level);
    if (!D || !spend({ id: 'Elemental Storm', cooldown: D.cooldown, uses: D.uses })) return;
    const T = asTrig(S, { ...D, id: 'Elemental Storm' }), X = partOf(T, `ElementalStorm${cap(el)}Player`); if (!X) return;
    const c = { x: d.pos.x, z: d.pos.z }, st = D.stats; let tk = 0;
    const g = holder(c), B = stormBody(el, g, T.A), W = B.L.wave;
    later(.35, () => { fx.ring(c, T.A * .2, T.A, W, .5, { a: .7 }); fx.glow({ x: c.x, y: .6, z: c.z }, T.A * .8, W, .5, 2.2); });   // its wave as it starts
    thing(g, st.base_skill_effect_duration / 1000, { tick(dt) { stormLook(c, dt, B); if ((tk -= dt) <= 0) { tk = st.tornado_base_damage_interval_ms / 1000; area(c, T.A, X); } } });
  }
  // Bursting Fen Toad's toad (exploding_poison_toad: Murkshaft UniqueExplodingToadHeld, GiantUglyToadCritter): it
  // emerges, hops at 0.79, 1.25 and 1.8 s and bursts at 2.1 s (its animation's hop and contact events), swelling first
  // (frog_swellpop). Its burst (frog_explode: FE_burst_midline): green rings for 0.4 and 0.6 s (FE_glowring 0.69 / 1 /
  // 0.2), a yellow-green nova ring for 0.6 s (vibrance 1.83 / 2 / 0.96), a blur for 0.25 s, blood sprayed for 0.6-1.1 s
  // and murky splashes for 1.5-2.5 s (explode_splash translucency 0.62 / 0.56 / 0.12). note: the toad is a figure of the
  // scene's in the mean colour of its texture (116 / 101 / 79 sRGB), where each hop lands too
  const FEN = { skin: 0x74654f, eye: 0xc8d850, ring: 0xb0ff33, nova: 0xebff7a, splash: 0x9e8e1f, blood: 0x5a0006 }, TOAD = new THREE.SphereGeometry(1, 12, 8);
  function fenToad(T, p) {
    const g = holder(p), skin = new THREE.MeshStandardMaterial({ color: FEN.skin, roughness: .7, emissive: FEN.nova, emissiveIntensity: 0 });
    const body = new THREE.Mesh(TOAD, skin); body.scale.set(.2, .13, .25); body.position.y = .13; body.castShadow = true; g.add(body);
    for (const s of [-1, 1]) { const e = new THREE.Mesh(TOAD, new THREE.MeshStandardMaterial({ color: FEN.eye, roughness: .3 })); e.scale.setScalar(.045); e.position.set(s * .09, .22, .14); g.add(e); }
    fx.emit(8, { p: { x: p.x, y: .1, z: p.z }, r: .2, v: .8, up: 1.2, life: .6, size: .08, c: FEN.splash, smoke: true, a: .8, g: 8 });   // it emerges (frog_splash)
    let from = p, to = p, t0 = 0;
    for (const h of [.79, 1.25, 1.8]) later(h, () => { from = { x: g.position.x, z: g.position.z }; to = around(from, .7); t0 = time; g.rotation.y = Math.atan2(to.x - from.x, to.z - from.z); });
    thing(g, 2.1, { tick(dt, e) {
      const k = Math.min(1, (time - t0) / .35); g.position.set(from.x + (to.x - from.x) * k, Math.sin(k * Math.PI) * .35, from.z + (to.z - from.z) * k);
      const sw = Math.max(0, (e.s - 1.85) / .25); g.scale.setScalar(1 + sw * .6); skin.emissiveIntensity = sw * 1.5;   // swelling
    }, end: () => {
      const q = { x: g.position.x, z: g.position.z }, c = { x: q.x, y: .3, z: q.z }, R = T.A;
      fx.ring(q, .1, R * .7, FEN.ring, .4, { a: .8 }); fx.ring(q, .2, R, FEN.ring, .6, { a: .5 }); fx.ring(q, .3, R, FEN.nova, .6, { k: 2.4 }); fx.glow(c, R, FEN.nova, .25, 2.5);
      fx.emit(18, { p: c, r: .1, v: 3, up: 2.5, life: .85, size: .09, c: FEN.blood, smoke: true, a: .9, g: 10, drag: .4 });
      fx.emit(24, { p: c, r: .2, v: R * 2, up: 2, life: 2, size: .12, c: FEN.splash, smoke: true, a: .85, g: 9, drag: .6 });
      area(q, R, { ...T, src: 'toad' });
    } });
  }
  // Doedre's Undoing: the curse's area stays for the curse's duration (up to its most areas), cursing the enemies that
  // enter it, and spawns Witchtoads in it at its interval (up to its most at once); a toad leaps at an enemy and explodes
  // there (Dark Consequences: its part, at the curse's level). note: how close an enemy must be for a toad to leap and how
  // long the leap takes are not in the data: in the area, half a second
  function doedre(S, c, R, curseOn) {
    const su = S.dmg.sum, D = granted("Doedre's Undoing", S.g?.level, 'ChaosFrogExplosionPlayer'); if (!D) return;
    const X = asTrig(S, { ...D, id: "Doedre's Undoing" }), toads = [], dec = fx.decal(c, R, 'rune', 'curse', { a: .45, spin: .4 }); let tk = 0;
    X.A = (D.stats.active_skill_base_area_of_effect_radius || 10) / 10;
    limit(o => o.doedre, su.maximum_curse_zones_allowed, S);
    thing(holder(c), sh(S).duration || SIM.curseTime, { name: S.name, doedre: true,
      tick(dt) {
        for (const d of inside(c, R)) if (d.curse?.label !== S.label) curseOn(d, true);
        for (const q of toads) {
          if (q.jump) continue;
          if (Math.random() < dt * 3) fx.emit(1, { p: { x: q.p.x, y: .15, z: q.p.z }, v: .3, up: 1, life: .5, size: .25, c: 'chaos' });
          const d = near(c, R); if (!d) continue;
          q.jump = true; const p = { x: d.pos.x, z: d.pos.z }; fx.bolt(V(q.p.x, .3, q.p.z), V(p.x, .3, p.z), 'chaos', .5);
          later(.5, () => { boom(p, X.A, X); toads.splice(toads.indexOf(q), 1); });
        }
        if ((tk -= dt) > 0 || toads.length >= su.max_toads_per_doedre_cursed_ground) return;
        tk = su.doedre_cursed_ground_toad_spawn_interval_ms / 1000; toads.push({ p: around(c, R * .8) });
      },
      off: () => dec.remove() });
  }
  // Caltrops: a projectile of the supported skill that reaches the end of its flight leaves its caltrops within its
  // secondary radius, for its duration
  function caltrops(S, at) {
    const T = !S.src && S.dmg?.trig?.find(T => T.stats?.['triggered_by_caltrops_support_%']), ts = T?.stats; if (!T) return;
    const X = asTrig(S, T), dur = sh(X).duration || ts.base_skill_effect_duration / 1000;
    for (let k = 0; k < (sh(X).projectiles || ts.base_number_of_projectiles || 1); k++) hazardAt(X, around(at, ts.active_skill_base_secondary_area_of_effect_radius / 10), dur);
  }
  // Earthquake's look (quake_slam; its tutorial video). Its slam (quakeslam_one, quakeslam_second): a flash for 0.28 s
  // (flash: 0.53 / 0.45 / 0.33), a pulse for 0.4 s (0.37 / 0.3 / 0.27), dirt flung for 1 s (0.27 / 0.26 / 0.25), a ring of
  // dust for 0.4-0.55 s (smoke: 0.51 / 0.41 / 0.33), bits for 0.6 s (0.29 / 0.25 / 0.21) and smoke for 0.7 s (wisp: 0.24 /
  // 0.2 / 0.18). Its Jagged Ground puffs each second (marker cyl.pet: dust, dirt and a pulse for 1 s, 0.48 / 0.43 / 0.32).
  // Its Aftershock (quakeslamshockwave, quakespike): a flash for 0.28 s, a pulse for 0.4 s, a burst for 0.2 s (0.35 / 0.3 /
  // 0.19), rocks for 1 s, a wave for 0.4 s, bits for 0.6 s, smoke for 1.7 s, the ground cracked for 2.7 s from 0.06 s and
  // spikes of rock bursting up with rubble for 0.8 s. note: its distortions are left out; the shakes' strength, the
  // number of spikes, counts, speeds and sizes are the scene's
  const EQK = { flash: 0xffd99e, pulse: 0xffcfba, dirt: 0x45423f, dust: 0x82694f, bitz: 0x4a4036, wisp: 0x3d332e, mark: 0xffe6a8, burst: 0xffdb8a, crack: 0x0a0806 };
  function eqHit(c, R) {
    const q = { x: c.x, y: .4, z: c.z };
    fx.glow(q, R * .6, EQK.flash, .28, 2.2); fx.ring(c, .2, R, EQK.pulse, .4, { a: .5 }); shake = Math.max(shake, Math.min(.5, R * .09));
    fx.emit(Math.ceil(R * 6), { p: q, r: .3, v: 3, up: 3, life: 1, size: .08, c: EQK.dirt, smoke: true, a: .9, g: 9, drag: .4 });
    fx.emit(16, { p: { x: c.x, y: .1, z: c.z }, r: .3, v: R * 2, up: .1, life: .5, size: .5, grow: 1.8, c: EQK.dust, smoke: true, a: .35, drag: 2, flat: true });
    fx.emit(12, { p: q, r: .2, v: R * 2.5, up: 1, life: .6, size: .1, c: EQK.bitz, smoke: true, a: .8, drag: 2 });
    fx.emit(6, { p: q, r: R * .3, v: .5, up: .6, life: .7, size: .6, grow: 1.8, c: EQK.wisp, smoke: true, a: .4, drag: 1.5 });
  }
  function eqMark(c, r) {
    fx.glow({ x: c.x, y: .1, z: c.z }, r * .4, EQK.mark, 1, 1.4);
    fx.emit(2, { p: { x: c.x, y: .1, z: c.z }, r: r * .5, v: .3, up: .6, life: .7, size: .4, grow: 1.6, c: EQK.dust, smoke: true, a: .3, drag: 1.5 });
    fx.emit(3, { p: { x: c.x, y: .1, z: c.z }, r: r * .5, v: .5, up: 1.5, life: .4, size: .05, c: EQK.dirt, smoke: true, a: .9, g: 9 });
  }
  function eqAfter(c, R) {
    const q = { x: c.x, y: .5, z: c.z };
    fx.glow(q, R * .9, EQK.flash, .28, 2.4); fx.glow(q, R * .5, EQK.burst, .2, 2.6); fx.ring(c, .2, R * 1.1, EQK.pulse, .4, { a: .6 }); shake = Math.max(shake, Math.min(.6, R * .12));
    later(.06, () => fx.disc(c, R, EQK.crack, 2.7, { dark: true, tex: 'cracks', a: .85, hold: .6, y: .034 }));
    fx.spikes({ x: c.x, z: c.z }, R * .7, { n: 7, h: rnd(1, 1.6), w: .3, dur: .8, dark: true, c: EQK.dirt });
    fx.emit(Math.ceil(R * 10), { p: q, r: R * .4, v: 4, up: 4, life: 1, size: .1, c: EQK.dirt, smoke: true, a: .9, g: 9, drag: .3 });
    fx.emit(20, { p: { x: c.x, y: .1, z: c.z }, r: .3, v: R * 2.5, up: .1, life: .4, size: .5, grow: 1.8, c: EQK.dust, smoke: true, a: .4, drag: 2, flat: true });
    fx.emit(16, { p: q, r: .3, v: R * 2.5, up: 1.2, life: .6, size: .12, c: EQK.bitz, smoke: true, a: .8, drag: 2 });
    fx.emit(Math.ceil(R * 4), { p: q, r: R * .5, v: 1.2, up: 1.2, life: 1.7, size: .9, grow: 1.8, c: EQK.wisp, smoke: true, a: .45, drag: 1.2 });
  }
  // A Slam reaching the ground: it sets off the Crater fissures it reaches; Brambleslam leaves its brambles in the slam's
  // area (where in it the data does not say), Hazards that arm and deal less if set off early, and Maim; its cooldown
  function slammed(S, c, R) {
    quake(c, R);
    for (const o of objs) if (o.volcano && !o.dead && dist(o.pos, c) <= R + o.r) o.volcano();   // a Volcano slammed sprays again
    const T = !S.src && S.dmg?.trig?.find(T => T.stats?.['triggered_by_briarpatch_support_on_slam_%']), ts = T?.stats; if (!T) return;
    if (!spend(T)) return;
    const X = asTrig(S, T), dur = sh(X).duration || ts.base_skill_effect_duration / 1000; say(X.label, X.el);
    for (let k = 0; k < (T.support.create_X_briar_thorns_on_slam || 1); k++) hazardAt(X, around(c, R), dur, { arm: ts.briarpatches_arming_time_ms / 1000, early: ts['hazard_damage_+%_final_for_first_500_ms_when_not_killed_by_self'], c: 'poison' });
  }
  const tint = (m, c) => m.traverse(x => { if (x.material) x.material.color.copy(fx.color(c, x.isSprite ? 1.5 : 3)); });
  // Frost Darts: a dart that hits a chilled or frozen enemy drops chunks of ice that hit where they land (its mortar part);
  // with a Cold Infusion consumed each dart lodges in the enemy and explodes (its explosion part), creating its mortars
  // note: how long a dart stays lodged and where the chunks land the data does not say: half a second, around the enemy
  function darts(S, d) {
    const M = partOf(S, 'FrostDartsIceMortarPlayer'); if (!M) return;
    const mortar = () => { const q = around(d.pos, 1.2); lob(fx.orb('ice', .1), V(d.pos.x, 1.4, d.pos.z), V(q.x, .1, q.z), .4, 1.5, () => boom(q, M.A, M, { soft: true })); };
    if (has(d, 'chill') || has(d, 'freeze')) mortar();
    const X = S.infs?.includes('cold') && partOf(S, 'FrostDartsExplodePlayer');
    if (X) later(.5, () => { if (d.dead) return; boom(d.pos, X.A, X); for (let k = X.dmg.stats.frost_darts_explode_creates_X_mortars || 0; k > 0; k--) mortar(); });
  }
  // Snipe released with Perfect Timing: its arrow explodes where it lands (its part); a direct hit on a Frozen enemy
  // Consumes the Freeze for its enhanced explosion instead (its other part, more from a Unique)
  function snipeBlast(S, d, p, mult) {
    if (d) hit(d, S, { mult });
    const fr = d && !d.dead && has(d, 'freeze'), X = partOf(S, fr ? 'SnipeFrozenExplosionPlayer' : 'SnipeExplosionPlayer');
    if (fr) consume(d, S, 'freeze');
    pop(p, X.A, X.el); boom(p, X.A, { ...X, gm: (X.gm ?? 1) * (fr ? uniqueMore(d, X.dmg.stats['snipe_damage_+%_final_if_created_from_unique']) : 1) }, { noPay: true });
  }
  // Fragmentation Rounds: a bolt reaching a Frozen enemy Consumes the Freeze for an explosion of shrapnel around it (its
  // part, more from a Unique). Its bolts burst the Ice Crystals they reach (shoot)
  function shrapnel(S, d) {
    const X = has(d, 'freeze') && partOf(S, 'FragmentationRoundsFreezeShatterPlayer'); if (!X) return;
    consume(d, S, 'freeze'); const p = { x: d.pos.x, z: d.pos.z };
    pop(p, X.A, 'ice'); boom(p, X.A, { ...X, gm: (X.gm ?? 1) * uniqueMore(d, X.dmg.stats['frag_rounds_damage_+%_final_if_created_from_unique']) }, { noPay: true });
  }
  // Ice Fragments lying on the ground till they explode after their detonation time: { p, R, go (its explosion), dec }.
  // Kept so a skill can set them off sooner (Cross Slash pulls them in)
  function frag(p, R, delay, go) {
    const F = { p, R, go, dec: fx.decal(p, R, 'patch', 'cold', { a: .6, k: 1 }) };
    F.off = () => { if (!frags.includes(F)) return; frags = frags.filter(f => f !== F); F.dec.remove(); pop(F.p, F.R, 'ice'); F.go(F.p); };
    frags.push(F); later(delay, F.off);
  }
  // Ice-Tipped Arrows, Escape Shot: where an empowered (its) projectile hits, its number of ice fragments scatter forward
  // in its cone, each landing between its least and most distance, and explode after its detonation time (its fragment part)
  // the fragments' hit: the attack's, all its physical as cold (their part converts all of it), at their part's multiplier over the attack's own (note: the
  // data has them as a spell part, with no weapon damage of their own)
  function fragsOf(S, X) {
    const H = { ...S.dmg.hits }; if (H.physical) { const c = H.cold || [0, 0]; H.cold = [c[0] + H.physical[0], c[1] + H.physical[1]]; delete H.physical; }
    return { ...X, dmg: { ...X.dmg, hits: scale(H, X.dmg.stats._base_multiplier / (S.dmg.stats?._base_multiplier || 10000)) }, els: ['cold'], el: 'cold', ail: ailOf(['cold']) };
  }
  function iceFrags(X, p, a0) {
    const st = X.dmg.stats, n = st.base_number_of_projectiles, cone = st.ballistic_ice_chunk_cone_angle / 10 * Math.PI / 180, once = new Set();
    for (let k = 0; k < n; k++) {
      const a = a0 + (n > 1 ? k / (n - 1) - .5 : 0) * cone, r = rnd(st.ice_fragment_min_chunk_distance, st.ice_fragment_max_chunk_distance) / 10, to = { x: p.x + Math.sin(a) * r, z: p.z + Math.cos(a) * r };
      lob(fx.orb('cold', .1), new THREE.Vector3(p.x, .8, p.z), new THREE.Vector3(to.x, .1, to.z), .3, .6, () =>
        frag(to, X.A, Math.max(0, st.base_skill_detonation_time / 1000 - .3), q => boom(q, X.A, { ...X, once }, { noPay: true })));
    }
  }
  // Armour Piercing Rounds' look (crossbow_armour_piercing: muzzle_rapid, rapid_shot, rapid_trail, rapid_impact and
  // rapid_pierce, riven_debuff): a pale blue flash at the crossbow's muzzle with an orange-red ring and pale sparks
  // (MF_rapidFlash 0.75 / 0.81 / 1, MF_rapidRing 1 / 0.36 / 0.21), each bolt a pale blue head (0.56 / 0.72 / 1) trailing a
  // thin red-orange streak (rapid_trail 1 / 0.41 / 0.28, boosted red); where it hits an orange flash (1 / 0.47 / 0.37),
  // orange embers and glinting steel pieces flung out (steelPieces), a pale blue flash when it pierces (1.12 / 1.23 / 1.5);
  // the armour it Fully Breaks shatters in a golden burst with floating shards (riven_shatter 1 / 0.58 / 0.15,
  // riven_floating_shards 1 / 0.88 / 0.79 by 1 / 0.63 / 0.25)
  // Crossbow Shot's bolt (crossbow_basic: PowerShotDefaultBolt, bolt_basic.ao power_01 and impact_power_01): at the muzzle
  // a warm head (power_head 1 / 0.63 / 0.39 by 1.2 / 1.2 / 1) and a gust for 0.1-0.35 s, pale wind swirling over the ground
  // for 0.5 s (grdWind); the bolt trails a warm streak for 0.6 s (power_shot.trl, power_shot_trail 1 / 0.78 / 0.36); where it
  // hits a flash for 0.05 s (1 / 0.63 / 0.47 by 1.2 / 1.1 / 1), embers for 0.4-1.2 s (1.15 / 0.79 / 0.63 by 1.25 / 1.2 / 1),
  // 4 puffs of smoke for 0.5-0.8 s (0.3 / 0.29 / 0.27) and a shimmering ring for 0.2 s; piercing, its own flash (1 / 0.69
  // / 0.47) and sparks for 0.15-0.3 s (1 / 0.71 / 0.51). note: the gusts and shimmer are distortions, drawn faint here
  const XBOLT = { head: 0xffa163, trail: 0xffc75c, wind: 0x736f6a, flash: 0xff9463, ember: 0xffa870, smoke: 0x4d4a45, ring: 0xffa06b, spark: 0xffa66c, shoot: xbMuzzle, hit: xbHit };
  function xbMuzzle(dx, dz) {
    const H = hand(), q = { x: H.x + dx * .3, y: H.y, z: H.z + dz * .3 };
    fx.glow(q, .35, XBOLT.head, .1, 1.8); fx.ring(q, .05, .5, XBOLT.wind, .35, { a: .3, y: q.y });
    fx.emit(10, { p: { x: pp.x, y: .1, z: pp.z }, r: .3, v: 1.6, up: .2, life: .5, size: .35, grow: 1.8, c: XBOLT.wind, smoke: true, a: .18, drag: 2, flat: true });
  }
  function xbHit(p, through) {
    const q = { x: p.x, y: 1.05, z: p.z };
    fx.glow(q, .8, through ? XBOLT.head : XBOLT.flash, .05, 2.6);
    fx.emit(through ? 5 : 8, { p: q, r: .1, v: 2.6, up: .8, life: .8, size: .05, c: XBOLT.ember, c2: 'white', k: 2.2, drag: 1.5, g: 3 });
    if (through) return void fx.emit(8, { p: q, dir: V(0, .2, 0), r: .05, v: 4, life: .25, size: .05, c: XBOLT.spark, c2: 'white', k: 2.4, drag: 3 });
    later(.025, () => fx.emit(4, { p: q, r: .15, v: .6, up: .4, life: .65, size: .4, grow: 2, c: XBOLT.smoke, smoke: true, a: .4, drag: 1.5 }));
    later(.05, () => fx.ring(q, .1, .7, XBOLT.ring, .2, { a: .5, y: q.y }));
  }
  // Bow Shot's arrow (default_ranged: DefaultArrow, base_arrow_attack arrow_base): its head glowing warm (basic_arrow_head
  // up to 1 / 0.61 / 0.25), a pale trail (basic_arrow_trail 0.35 / 0.32 / 0.3), stuck where it hits (arrow_base_stuck);
  // its shaft the mean colour of its texture (basearrow_clr: 87 / 79 / 72)
  const BOW = { shaft: 0x574f48, head: 0xff9c40, trail: 0x8f8780 };
  // Chaos Bolt's look (weapon_granted_chaosbolt: WandProjectileChaosbolt, chaosbolt_projectile.ao): a bolt trailing its
  // ribbon (chaosbolt_main.trl, main_trail.mat: Vibrance 0.77 / 0.56 / 1.25) and purple embers (chaosbolt.pet,
  // chaos_embers_R.mat: Vibrance 1.04 / 0.75 / 1.5) for 0.2-0.7 s; its impact is a sound only (no effect of its own)
  const CBOLT = { trail: 0x9e73ff, ember: 0xb07fff };
  // Coiling Bolts' look (coiling_bolts: WitchboltPhysical / WitchboltChaos, CoilOfUndoing ProjPhys.ao / ProjChaos.ao): each
  // bolt trails its ribbon (physbolt_main.trl, PhysMain_Trail's colour look-up top 1 / 0.92 / 0.7; chaosbolt_main.trl,
  // ChaosMain_Trail's 1.4 / 0.56 / 2) and embers for 0.5-0.75 s (PhysImpact_Embers 1 / 0.57 / 0.29, ChaosImpact_Embers
  // 0.59 / 0.21 / 1); each hit a spike for 0.2 s, two loose spirals for 0.2-0.35 s (the physical's 1 / 0.92 / 0.7, the
  // chaos' 0.77 / 0.56 / 1) and embers for 0.3-0.5 s. note: the spirals as a ring
  const COIL = { physical: { trail: 0xffebb3, ember: 0xff914a, spiral: 0xffebb3 }, chaos: { trail: 0xb347ff, ember: 0x9636ff, spiral: 0xc48fff } };
  function coilHit(p, L) {
    const c = { x: p.x, y: p.y, z: p.z };
    fx.glow(c, .9, L.spiral, .2, 2.6); fx.ring(c, .1, .6, L.spiral, .3, { a: .8, y: p.y });
    fx.emit(10, { p: c, r: .1, v: 2, life: .4, size: .05, c: L.ember, k: 2.4, drag: 2 });
  }
  const APR = { muzzle: 0xbfcfff, ring: 0xff5c36, head: 0xabdcff, trail: 0xff3e24, flash: 0xff784f, ember: 0xff825c, steel: 0xff4d1f, pierce: 0x9fbfff, shatter: 0xff9426, shard: 0xff8c33, shoot: aprMuzzle, hit: aprHit };
  function aprMuzzle(dx, dz) {
    const H = hand(), q = { x: H.x + dx * .3, y: H.y, z: H.z + dz * .3 };
    fx.glow(q, .3, APR.muzzle, .08, 1.5); fx.glow(q, .45, APR.ring, .1, 1.6);
    fx.emit(5, { p: q, dir: V(dx * 4, .3, dz * 4), r: .05, v: 1.5, life: .18, size: .05, c: APR.muzzle, c2: 'white', k: 2.5, drag: 3 });
  }
  function aprHit(p, through) {
    const q = { x: p.x, y: 1.05, z: p.z };
    fx.glow(q, .7, through ? APR.pierce : APR.flash, .12, 2.5);
    fx.emit(6, { p: q, r: .1, v: 3, up: .6, life: .3, size: .06, c: APR.ember, c2: 'white', k: 2.4, drag: 2, g: 4 });
    fx.emit(4, { p: q, r: .1, v: 2.4, up: 1, life: .45, size: .05, c: APR.steel, c2: 'white', k: 1.8, g: 9 });
  }
  function aprShatter(d) {
    const q = { x: d.pos.x, y: 1.1, z: d.pos.z };
    fx.glow(q, 2.4, APR.shatter, .35, 3);
    for (let i = 0; i < 12; i++) { const a = rnd(TAU), l = rnd(.6, 1.3); fx.streak(V(q.x, q.y, q.z), V(q.x + Math.cos(a) * l, q.y + rnd(-.5, .9), q.z + Math.sin(a) * l), APR.shatter, rnd(.15, .25), rnd(.02, .04), rnd(.5, 1)); }
    fx.emit(14, { p: q, r: .3, v: 1.2, up: .4, life: 1.2, size: .07, c: APR.shard, c2: 'white', k: 2, drag: 1.5 });
  }
  // Ball Lightning's look (lightning_balllightning: ball_lightning.pet, ballLightning_Beam.pet, ballLightning_Trail.trl,
  // infusion_FIRE*.pet): a white-hot core in a violet-blue glow (core 0.2 / 0.3 / 1, center 0.2 / 0.28 / 1) wrapped in
  // arcs crackling over its sphere (lightningSphere 0.25 / 0.33 / 1, ribbonBolt 0.14 / 0.18 / 1, bolt ribbons 0.08 / 0.12
  // / 1), a blue trail behind it (0.28 / 0.35 / 1); at each of its hits a beam to every enemy in its area (3D_LightningBeam
  // 0.17 / 0.25 / 1). With a Fire Infusion consumed: a charge of flames and sparks at your hand (aoeFlash 1 / 0.47 / 0.16,
  // charge flames 1 / 0.53 / 0.29, sparks 1 / 0.29 / 0.07), orange fire ribbons round the ball (1 / 0.55 / 0.23) and where
  // it ends a fiery blast: a ring (aoeRingBG 1 / 0.65 / 0.24), a wave of fire (1 / 0.51 / 0.31), sparks (1 / 0.28 / 0.08),
  // a flash (stunOomph 1 / 0.45 / 0.1) and a gust (windPushWave 1 / 0.33 / 0.1)
  const BALL = { core: 0xdde4ff, glow: 0x3347ff, sphere: 0x4054ff, arc: 0x242eff, deep: 0x141eff, trail: 0x4759ff, beam: 0x2b3fff,
    flash: 0xff7729, flame: 0xff874a, spark: 0xff4a11, ribbon: 0xff8c3a, ring: 0xffa53c, wave: 0xff814f, oomph: 0xff731a, gust: 0xff541a };
  function ballOrb(m) {
    m.userData.core.material.color.copy(fx.color(BALL.core, 2.6)); m.userData.core.scale.setScalar(.24);
    m.userData.glow.material.color.copy(fx.color(BALL.glow, 1.1)); m.userData.glow.scale.setScalar(2.4);
  }
  function ballTrail(m, fi) {
    const p = m.position, r = .6;
    m.userData.glow.scale.setScalar(rnd(2.2, 2.6));
    for (let i = 0; i < 4; i++) {   // arcs over its sphere
      const a = rnd(TAU), b = rnd(TAU), q = new THREE.Vector3(p.x + Math.cos(a) * Math.cos(b) * r, p.y + Math.sin(b) * r, p.z + Math.sin(a) * Math.cos(b) * r);
      fx.bolt(p.clone(), q, i % 2 ? BALL.arc : BALL.sphere, .1, .04, .22);
    }
    if (Math.random() < .25) { const a = rnd(TAU), l = rnd(.7, 1.1); fx.bolt(p.clone(), new THREE.Vector3(p.x + Math.cos(a) * l, p.y + rnd(-.5, .3), p.z + Math.sin(a) * l), BALL.deep, .1, .02, .3); }
    fx.emit(2, { p, r: .15, v: .3, life: .35, size: .16, c: BALL.trail, c2: BALL.core, k: 2.4, drag: 2 });
    if (fi) fx.emit(2, { p, r: .35, v: .8, up: .6, life: .4, size: .26, c: BALL.ribbon, c2: 'ember', k: 1.8, drag: 2 });
  }
  function ballZap(p, R) {
    for (const d of inside(p, R)) { const q = chest(d); fx.bolt(p.clone(), q, BALL.beam, .16, .05, .3); fx.bolt(p.clone(), q, BALL.core, .1, .02, .3); fx.glow(q, .8, BALL.sphere, .14, 2.6); }
  }
  function ballCharge() {
    const H = hand();
    fx.glow(H, 1.4, BALL.flash, .25, 2.6);
    fx.emit(10, { p: H, r: .15, v: .8, up: .8, life: .4, size: .24, c: BALL.flame, c2: 'ember', k: 1.8, drag: 2 });
    fx.emit(12, { p: H, r: .1, v: 3, life: .35, size: .06, c: BALL.spark, c2: 'white', k: 2.4, drag: 2.5 });
  }
  function ballBlast(p, R) {
    const q = { x: p.x, y: .5, z: p.z };
    fx.glow(q, R * 1.6, BALL.oomph, .35, 1.6);
    fx.ring(p, .3, R, BALL.ring, .5, { k: 2.4 }); fx.ring(p, .2, R * 1.2, BALL.gust, .4, { a: .5 });
    fx.emit(28, { p: { x: p.x, y: .3, z: p.z }, r: R * .4, v: R * 1.6, flat: true, up: .8, life: .6, size: .45, grow: 1.5, c: BALL.wave, c2: 'ember', k: 1.6, drag: 2 });
    fx.emit(36, { p: q, r: R * .3, v: R * 2.5, up: 2, life: .5, size: .08, c: BALL.spark, c2: 'white', k: 2.4, drag: 2, g: 5 });
    shake = Math.max(shake, Math.min(.5, R * .09));
  }
  // Electrocuting Arrow's look (bow_electrocuting_rod; its tutorial video). Its arrow glows blue (lightning_arrow_skin:
  // 0.2 / 0.23 / 1) with bolts of lightning behind it for 0.35-0.65 s (bck_line: 0.03 / 0.04 / 0.15). Its explosion
  // (rodLodging_AoE): a flash for 0.12 s (0.16 / 0.24 / 1), a ring for 0.25 s from 0.1 s (0.24 / 0.36 / 1), a wave of
  // wind for 0.28 s from 0.11 s (0.25 / 0.37 / 1), arrows bursting out for 0.2-0.3 s from 0.12 s (0.24 / 0.32 / 1) and a
  // nova of lightning for 0.09-0.45 s. Its rod stays stuck in the enemy, glowing (rod_mode), lightning streaking along
  // its body for 0.15-0.55 s (electrocute_bodyline: 0.04 / 0.04 / 0.12). note: its skin's blue glow and its blurs are
  // left out; the counts, speeds and sizes are the scene's
  const EAR = { glow: 0x333aff, bolt: 0x3344ff, flash: 0x293dff, ring: 0x3d5cff, wind: 0x405eff, arrow: 0x3d52ff, zap: 0x5555ff };
  function eaBlast(c, R) {
    const q = { x: c.x, y: .8, z: c.z };
    fx.glow(q, R * .8, EAR.flash, .12, 3); fx.flash(q, EAR.flash, 30 + R * 10, .15, 6 + R * 3);
    later(.1, () => fx.ring(c, .2, R, EAR.ring, .25, { a: .9, y: .5 })); later(.11, () => fx.ring(c, R * .3, R * 1.2, EAR.wind, .28, { a: .4 }));
    later(.12, () => {
      for (let i = 0; i < 10; i++) { const a = rnd(TAU); fx.streak(V(q.x, q.y, q.z), V(q.x + Math.cos(a) * R, q.y + rnd(-.3, .4), q.z + Math.sin(a) * R), EAR.arrow, rnd(.2, .3), .03, .5); }
      for (let i = 0; i < 6; i++) { const a = rnd(TAU); fx.bolt(V(q.x, q.y, q.z), V(q.x + Math.cos(a) * R * .8, rnd(.2, 1.4), q.z + Math.sin(a) * R * .8), EAR.zap, rnd(.09, .45), .03); }
    });
  }
  function eaRods(dt) {
    for (const d of dummies) {
      const on = !d.dead && d.erod?.until > time;
      if (on && !d.erodM) { d.erodM = fx.arrow(EAR.glow); d.erodM.children[1].scale.setScalar(.35); d.fig.group.add(d.erodM); d.erodM.position.set(0, 1.2, 0); d.erodM.rotation.set(-.9, rnd(TAU), 0); }   // in its figure, gone with it
      if (!d.erodM) continue;
      if (!on) { fx.drop(d.erodM); d.erodM = null; continue; }
      if (Math.random() < dt * 10) { const h = rnd(.3, 1.8) * d.sc, a = rnd(TAU); fx.bolt(V(d.pos.x + Math.cos(a) * .25, h, d.pos.z + Math.sin(a) * .25), V(d.pos.x - Math.cos(a) * .25, h + rnd(-.5, .5), d.pos.z - Math.sin(a) * .25), EAR.zap, rnd(.15, .55), .015, .12); }
    }
  }
  // Detonating Arrow's look (bow_detonating_arrow; its tutorial video). Channelled, a fire head grows on the arrow's tip
  // (surge_charge: 1.2 / 0.82 / 0.47) with flames from 0.3 s (1.28 / 0.79 / 0.34) and embers from 0.5 s; at its maximum
  // stages it ignites (surge_ignited): a flash for 0.1-0.15 s (1 / 0.44 / 0.2), its head brighter (3 / 1.59 / 0.9), 3
  // rings for 0.2-0.31 s (0.5 / 0.41 / 0.28), a cone for 0.48-0.54 s (0.26 / 0.14 / 0.06) and wind for 0.5 s (0.45). Its
  // arrow's head is its stages' (base 1.2 / 0.82 / 0.47; mid 1.2 / 0.53 / 0.24 with embers; charged 3 / 1.59 / 0.9 with
  // fire licks, 3 / 1.21 / 0.45), and at its maximum it explodes (explosion.pet): a flash for 0.2 s (6 / 3.9 / 1.2), a
  // ring of flames for 0.3 s (3 / 1.32 / 0.6), 16 flames for 0.2-0.55 s, a ring from 0.1 s for 0.35 s (0.5 / 0.35 / 0.25)
  // and embers for 1.5-4 s. note: the mid head from any stage short of the maximum (when the game shows it is not in the
  // data); its shimmer and the charged arrow's scorched path are left out; the counts, speeds and sizes are the scene's
  const DARR = { base: { head: 0xffae64 }, mid: { head: 0xff7033, ember: 0xff9e45 }, charged: { head: 0xff874d, ember: 0xff6626, lick: true },
    flame: 0xff9e45, lit: 0xff7033, ring: 0x806947, cone: 0x42240f, wind: 0x737373, flash: 0xffa633, burst: 0xff7033, wave: 0x80593f };
  function daCharge(c, k, dt) {
    const h = hand(), q = V(h.x + Math.sin(facing) * .6, h.y, h.z + Math.cos(facing) * .6);
    if (Math.random() < dt * 30) fx.emit(1, { p: q, r: .03, v: .1, life: .15, size: .12 + k * .2, c: k >= 1 ? DARR.charged.head : DARR.base.head, c2: 'white', k: 2.4 });
    if (c.s > .3 && Math.random() < dt * 12) fx.emit(1, { p: q, r: .08, v: .4, up: .6, life: .5, size: .1, c: DARR.flame, k: 2, drag: 1 });
    if (c.s > .5 && Math.random() < dt * 8) fx.emit(1, { p: q, r: .1, v: .5, up: 1, life: 2, size: .03, c: DARR.flame, c2: 'white', k: 2.4, g: 1, drag: 1 });
    if (k < 1 || c.lit) return;
    c.lit = true; fx.glow(q, .9, DARR.lit, .15, 2.6); fx.emit(8, { p: q, r: .1, v: 1.2, up: .5, life: .5, size: .15, c: DARR.flame, k: 2, drag: 1.5 });
    for (let i = 0; i < 3; i++) later(.03 + i * .04, () => fx.ring(q, .1, .6 + i * .2, DARR.ring, .25, { a: .7, y: q.y }));
    const to = V(q.x + Math.sin(facing) * 1.2, q.y, q.z + Math.cos(facing) * 1.2); later(.02, () => fx.strip(q, to, .5, DARR.cone, .5, { a: .6, y: q.y }));
    fx.emit(24, { p: { x: pp.x, y: .1, z: pp.z }, r: .6, v: 2, up: .2, life: .5, size: .3, grow: 1.6, c: DARR.wind, smoke: true, a: .25, drag: 2, flat: true });
  }
  function daBlast(c, R) {
    const q = { x: c.x, y: .8, z: c.z };
    fx.glow(q, R * .9, DARR.flash, .2, 3); fx.flash(q, DARR.flash, 30 + R * 10, .2, 6 + R * 3); shake = Math.max(shake, Math.min(.5, R * .09));
    fx.ring(c, .2, R * .8, DARR.burst, .3, { a: .9, y: .6 });
    fx.emit(16, { p: q, r: .3, v: R * 2, up: 1.5, life: .4, size: .5, grow: 1.5, c: DARR.flame, c2: DARR.burst, k: 2.4, drag: 2.5 });
    later(.1, () => fx.ring(c, R * .3, R, DARR.wave, .35, { a: .8 }));
    fx.emit(30, { p: q, r: .3, v: R * 1.5, up: 2, life: 2.8, size: .04, c: DARR.flame, c2: 'white', k: 2.4, g: 2, drag: 1 });
  }
  function shoot(S, from, dx, dz, o = {}) {
    // Shockchain Arrow homes in on enemies with a lightning ailment: a fresh arrow flies at the nearest such one ahead within
    // its range. ponytail: aimed when fired, the game's turn rate is in none of the data; steer per frame if it ever is
    const HM = !o.forked && !o.back && S.dmg?.stats?.shockchain_arrow_X_additional_chains_on_first_hitting_shocked_or_electrocuted_enemy
      && near(from, o.range || S.G.range || SIM.projRange, e => litUp(e) && inCone(from, Math.atan2(dz, dx), Math.PI / 2, e.pos));
    if (HM) { const l = dist(HM.pos, from) || 1; dx = (HM.pos.x - from.x) / l; dz = (HM.pos.z - from.z) / l; }
    const G = S.G, P = S.P, speed = o.speed || G.speed || SIM.projSpeed, slow = !o.speed && (speed < 5.5 || P.spiral || P.wind);
    const cr = Math.max(.15, G.collision || 0), m = P.attack && !P.wind ? fx.arrow(S.el) : fx.orb(S.el, slow ? .26 : .14);
    let left = o.range || (G.speed ? G.range : SIM.projRange), pulse = .2, cur = S, a0 = Math.atan2(dx, dz), trail = 0, spd = speed * (o.speed ? 1 : S.dmg?.projSpeed || 1), burn = 0, spd0 = spd;
    // Ball Lightning: its hits on the enemies around it at its frequency; with a Fire Infusion consumed it slows down over
    // time, leaves Ignited Ground at its interval and explodes where it ends (its infused parts)
    const bst = S.dmg?.stats || {}, every = bst.ball_lightning_base_hit_frequency_ms / 1000, fi = S.infs?.includes('fire') && bst.ball_lightning_infused_acceleration != null;
    const BG = fi && partOf(S, 'BallLightningIgnitedGround'), BX = fi && partOf(S, 'BallLightningInfusedExplosionPlayer');
    const FR = S.dmg?.parts?.FragmentationRoundsFreezeShatterPlayer;   // Fragmentation Rounds: its bolts burst the Ice Crystals they reach
    // Eye of Winter: the Eye hits nothing; it releases its shard projectiles in a spiral, evenly along its flight, and each
    // enemy's first shard hit of the use deals its more damage (hit). note: the shards' speed and range are the scene's
    const EW = P.spiral && !o.shard && bst['eye_of_winter_first_hit_damage_+%_final'] != null, EN = EW ? sh(S).projectiles || bst.base_number_of_projectiles : 0, gap = EW && left / EN;
    let shot = 0, shardT = 0; if (EW) cur = { ...S, first: new Set() };
    m.position.set(from.x, 1.1, from.z); m.rotation.y = a0; scene.add(m);
    if (every) { ballOrb(m); if (fi && !S.src) ballCharge(); }
    const BW = S.name === 'Bow Shot'; if (BW) { m.children[0].material.color.copy(fx.color(BOW.shaft, 1)); m.children[1].material.color.copy(fx.color(BOW.head, 1.2)); m.children[1].scale.setScalar(.3); }
    const CB = S.name === 'Chaos Bolt'; if (CB) tint(m, CBOLT.trail);
    const DA = S.name === 'Detonating Arrow' && DARR[S.detonate ? 'charged' : S.fireGain ? 'mid' : 'base']; if (DA) m.children[1].material.color.copy(fx.color(DA.head, 2));
    const CO = S.name === 'Coiling Bolts' && (S.dmg?.parts ? COIL.physical : COIL.chaos); if (CO) tint(m, CO.trail);   // the skill's own bolt is the physical one, its part the chaos one
    const XS = S.name === 'Crossbow Shot', AP = S.name === 'Armour Piercing Rounds', ROUND = XS ? XBOLT : AP && APR; let xp = XS && m.position.clone();   // a crossbow's bolt: its colours, muzzle and hit
    if (ROUND) { tint(m, ROUND.trail); m.children[1].material.color.copy(fx.color(ROUND.head, 1.5)); m.children[1].scale.setScalar(.3); if (!o.forked && !o.split && !o.back) ROUND.shoot(dx, dz); }
    // Pierce, then Fork, then Chain (calc.js shape): a fractional pierce is a chance, rolled per projectile. The forks
    // part at an angle the data does not give (a look only); they keep the targets already hit and the less damage
    // Ulaman's Vision: each projectile you fire does one of these at random: Fork once more (0), Chain once more (1), Chain
    // from terrain once more (2: the scene has no terrain, so nothing), cannot collide with targets (3: it flies through them)
    const first = !S.src && !o.forked && !o.split && !o.back && !o.shard, UL = first && sheet().ulaman ? Math.floor(Math.random() * 4) : -1;
    // Cadiro's Gambit: each arrow you fire is one of its six kinds at random (KeywordPopups UniqueArrowModifier*): Crescendo
    // (0) Chains 6 more times, 60% increased damage per time it has Chained; Splintering (1) Splits toward 6 targets;
    // Reversing (2) Pierces all targets and Returns; Diamond (3) always crits, 60% increased critical damage bonus; Covetous
    // (4) more rarity (nothing here); Blunt (5) 600% increased Stun buildup. note: the increases as factors of their own
    const CG = first && P.attack && sheet().cadiro ? Math.floor(Math.random() * 6) : -1;   // a split or forked one is the same arrow (cur keeps its kind)
    cur = { ...cur, ...{ 0: { perChain: 60, addChains: (cur.addChains || 0) + 6 }, 3: { diamond: 60 }, 5: { stunX: (cur.stunX || 1) * 7 } }[CG] };
    const D0 = UL === 0 ? { ...sh(S), forks: (sh(S).forks || 0) + 1 } : sh(S), D = CG === 1 ? { ...D0, split: 6 } : CG === 2 ? { ...D0, pierce: Infinity } : D0, seen = new Set(o.seen), forked = o.forked || 0, surged = o.split || forked ? [] : (S.surges || []).filter(s => s.n-- > 0);
    const pierceN = S.P.spell && sheet().spellNoPierce ? 0 : Math.floor(D.pierce || 0) + (Math.random() < (D.pierce || 0) % 1 ? 1 : 0);
    let pierced = o.pierced || 0, brokeP = false;   // brokeP: it has pierced a target whose armour was fully broken (Ironbound)
    // Point Blank / Far Shot (their text): all of the first's more within the first 3.5 metres, scaling down to none at 7;
    // the second's none within 3.5 scaling up to all of it at 7
    const left0 = left, went = () => (o.went || 0) + left0 - left, PB = sheet().shot, far = () => { const k = Math.min(1, Math.max(0, (went() - 3.5) / 3.5)); return PB ? 1 + (PB[0] * (1 - k) + PB[1] * k) / 100 : 1; };
    const how = x => ({ mult: mult(), went: went(), ...x });   // a hit of this projectile: its damage and how far it has flown
    const mult = () => far() * (pierced ? (1 + (D.pierceMore || 0) / 100) * Math.max(0, 1 + (D.perPierce || 0) * pierced / 100) : 1) * (forked ? 1 + (D.forkMore || 0) / 100 : 1);
    const end = hitD => {
      q.dead = true; const p = { x: m.position.x, z: m.position.z }; if (BW && hitD) fx.stuck({ ...p, y: 1 }, BOW.shaft); for (const s of surged) surgeBlast(cur, s, p);
      if (cur.detonate) { daBlast(p, cur.detonate); area(p, cur.detonate, { ...cur, detonate: 0 }); }   // Detonating Arrow at maximum stages
      const RS = cur.P.attack && !o.back && cur.dmg?.sum, DR = RS?.attack_projectiles_return_after_piercing_X_times, IB = brokeP && RS?.arrow_projectiles_return_if_they_have_pierced_a_fully_armour_broken_target, RC = !o.back && !o.shard && Math.random() * 100 < (cur.dmg?.stats?.['projectile_return_%_chance'] || 0); if (DR && pierced >= DR || IB || RC || CG === 2) { const l = dist(pp, m.position) || 1; shoot(cur, m.position, (pp.x - m.position.x) / l, (pp.z - m.position.z) / l, { speed, range: l, pierced, back: true }); }   // Ironbound: so if it pierced a target with fully broken armour. Drillneck: it returns to you after piercing that many times
      const SC = hitD && (has(hitD, 'shock') && cur.dmg?.sum?.always_chain_from_shocked_enemies || hitD.curse && flagOf(cur.name, 'always_chain_from_cursed_enemies')) ? 1 : 0;   // Stormchain: it always chains from a Shocked enemy it first hits (once, at least)
      if ((P.chains || cur.addChains || SC || UL === 1 && !P.explodes && !S.aoe) && hitD) {   // an exploding one explodes rather than chains here
        chain(m.position.clone(), hitD, cur, Math.max(SC, (D.chains || 0) + (cur.addChains || 0) + (UL === 1 ? 1 : 0)), seen, mult());
        // Lightning Arrow: bolts from the one hit to the nearest others in its area ("up to 2 extra targets")
        const by = chest(hitD);
        for (const e of nearest(hitD.pos, D.extraTargets || 0, e => !seen.has(e) && dist(e.pos, hitD.pos) <= S.A)) {
          seen.add(e); fx.bolt(by, chest(e), cur.el, .18); hit(e, cur, { mult: mult() });
        }
      }
      else if (cur.perfect && cur.dmg?.parts?.SnipeExplosionPlayer) snipeBlast(cur, hitD, p, mult());
      else if (P.explodes || S.aoe) {
        // Phantasmal Arrow: the arrow hits and sticks, and explodes after its duration (its explosion part)
        const PX = partOf(cur, 'PhantasmalArrowExplosionPlayer');
        if (PX) { if (hitD) hit(hitD, cur, how()); later(durOf(cur), () => boom(p, PX.A, PX)); } else boom(p, S.A, cur);
        const X = cur.infs?.includes('fire') && infPart(cur, 'fire'), n = X && sh(X).projectiles;   // Fireball: a ring of smaller firebolts
        if (n) for (let k = 0; k < n; k++) shoot({ ...X, aoe: false, P: { ...X.P, explodes: false }, infs: [] }, p, Math.sin(k * TAU / n), Math.cos(k * TAU / n), { range: Math.max(1, (X.G.range || SIM.projRange) + (X.dmg.stats.projectile_maximum_range_override || 0) / 10) });
      }
      else if (hitD) { hit(hitD, cur, how()); touch(p, .5, cur); if (!CB && !CO) fx.flash(m.position, cur.el, 8, .15, 4); darts(cur, hitD); spearBurst(cur, hitD); }
      else fx.emit(6, { p: m.position, v: 1.5, life: .3, size: .14, c: cur.el });
    };
    const q = { pos: m.position, r: cr, dead: false, proj: true, name: S.name,
      update(dt) {
        if (P.wander) { a0 += rnd(-1, 1) * 9 * dt; dx = Math.sin(a0); dz = Math.cos(a0); m.rotation.y = a0; }
        if (fi) spd = Math.max(.3, spd * (1 + bst.ball_lightning_infused_acceleration / 100 * dt));
        let stepLeft = Math.min(left, spd * dt); left -= fi ? Math.min(left, spd0 * dt) : stepLeft; trail += stepLeft; shardT += stepLeft;   // note: slowed by its Fire Infusion it still dissipates when it would have flown its range (its lifetime is not in the data; the game's video shows it so)
        while (stepLeft > 0 && !q.dead) {
          const s = Math.min(.3, stepLeft); stepLeft -= s; m.position.x += dx * s; m.position.z += dz * s;
          if (!cur.fired) for (const w of objs) if (w.wall && w.fire && !w.dead && segDist(m.position, w.a, w.b) < .45) {   // through a wall of fire
            // its added fire damage: Flame Wall's own hit as calc.js has it (note: with Flame Wall's modifiers, not the projectile's)
            const add = w.S?.dmg?.hits?.fire, H = cur.dmg?.hits, F = H?.fire || [0, 0];
            cur = { ...cur, els: [...new Set([...cur.els, 'fire'])], el: 'fire', ail: [...new Set([...cur.ail, 'ignite'])], fired: true, ...(add && H ? { dmg: { ...cur.dmg, hits: { ...H, fire: [F[0] + add[0], F[1] + add[1]] } } } : {}) }; tint(m, 'fire');
            say(t('{0} gains fire through {1}', S.label, w.label), 'fire'); break;
          }
          if (!cur.vb) for (const w of objs) if (w.volt && !w.dead && segDist(m.position, w.a, w.b) < .45) { cur = { ...cur, vb: { ...w.volt, mult: w.S.mult } }; tint(m, 'lightning'); say(t('{0} is energised by {1}', S.label, w.label), 'lightning'); break; }
          if (cur.P.attack && !cur.copied) for (const w of objs) if (w.copy && !w.dead && dist(w.pos, m.position) <= w.R) { w.spit(cur, mult()); q.dead = true; break; }
          if (q.dead) break;
          if (cur.P.spell) for (const w of objs) if (w.mirror && !w.dead && dist(w.pos, m.position) <= cr + w.r) w.shatter(cur, o);
          if (FR) for (const w of objs) if (w.ice && !w.dead && dist(w.pos, m.position) <= cr + w.r) w.touch(cur);
          for (const d of dummies) if (!EW && UL !== 3 && !d.dead && !seen.has(d) && dist(d.pos, m.position) <= cr + SIM.body) {
            seen.add(d); shrapnel(cur, d); if (ROUND) ROUND.hit(m.position, pierced < pierceN); if (CO) coilHit(m.position, CO); if (cur.icetip) iceFrags(cur.icetip, { x: d.pos.x, z: d.pos.z }, a0);
            // Split: its first hit splits it toward that many other enemies around; the split ones split no more
            const N = !o.split && (D.split || 0) + (empowered(S)?.dmg.stats.mana_tempest_empowered_spells_split_to_X_additional_targets || 0);   // Mana Tempest
            if (N) {
              o.split = true;
              for (const e of nearest(d.pos, N, e => e !== d && dist(e.pos, d.pos) <= left)) { const l = dist(e.pos, m.position) || 1; shoot(cur, m.position, (e.pos.x - m.position.x) / l, (e.pos.z - m.position.z) / l, { speed, range: left, seen: [d], split: true }); }
            }
            if (slow) hit(d, cur);
            else if (pierced < pierceN || forked && D.pierceForked || d.st.ignite > 0 && cur.dmg?.sum?.always_pierce_burning_enemies || d.st.ignite > 0 && Math.random() * 100 < (cur.dmg?.sum?.['chance_to_pierce_ignited_enemy_%'] || 0) || !cur.src && dist(d.pos, pp) <= 3 && Math.random() * 100 < (cur.dmg?.sum?.['projectile_chance_to_piece_vs_enemies_within_3m_distance_of_player'] || 0) || !cur.src && d.st.armour > 0 && sheet().pierceBroken) { brokeP ||= d.st.armour > 0; hit(d, cur, how({ pierced })); pierced++; fx.flash(m.position, cur.el, 6, .12, 3); }   // the tree's chance to Pierce enemies within 3 m of you
            else if (forked < (D.forks || 0) || !forked && Math.random() * 100 < (d.st.freeze > 0 ? cur.dmg?.sum?.['chance_to_fork_from_frozen_enemy_%'] || 0 : 0) + (cur.dmg?.sum?.['projectile_chance_to_fork_%'] || 0)) {   // Flamepierce (above), Freezefork: on Ignited / Frozen enemies
              hit(d, cur, how({ pierced })); q.dead = true; fx.flash(m.position, cur.el, 8, .15, 4);
              const fk = Math.random() * 100 < (cur.dmg?.sum?.['chance_to_fork_extra_projectile_%'] || 0) ? [-1, 0, 1] : [-1, 1];   // the tree's chance for one more when forking
              for (const s of fk) { const a = a0 + s * .5; shoot(cur, m.position, Math.sin(a), Math.cos(a), { speed, range: left, seen, pierced, forked: forked + 1, went: went() }); }
              break;
            }
            else { end(d); break; }
          }
        }
        if (q.dead) return;
        for (; EW && shardT >= gap && shot < EN; shardT -= gap) { const a = a0 + shot++ * 2.4; shoot({ ...cur, P: { ...cur.P, spiral: false, absorbs: false } }, m.position, Math.sin(a), Math.cos(a), { speed: SIM.projSpeed, shard: true }); }
        for (const s of surged) { const L = s.name !== 'Gemini Surge' && ESURGE[s.el]; if (L) { fx.emit(1, { p: m.position, r: .06, v: .2, life: rnd(.35, 1.2), size: .05, c: L.string, k: 2.4 }); fx.emit(1, { p: m.position, r: .02, v: .05, life: rnd(.4, .55), size: .1, c: L.ribbon, k: 2.2 }); } }   // Elemental and Chaotic Surge's
        const TB = CO || (CB && CBOLT);
        if (TB) { fx.trail(m.position, TB.trail, slow); fx.emit(1, { p: m.position, r: .05, v: .3, life: CO ? .62 : .45, size: .05, c: TB.ember, k: 2.4 }); }
        else if (XS) { fx.strip(xp, m.position, .07, XBOLT.trail, .6, { a: .7, k: 2, y: m.position.y }); xp = m.position.clone(); } else if (AP) fx.emit(3, { p: m.position, r: .02, v: .05, life: .22, size: .08, c: APR.trail, c2: APR.ring, k: 2.4 }); else if (BW) fx.emit(2, { p: m.position, r: .01, v: .05, life: .2, size: .06, c: BOW.trail, k: 1 }); else if (every) ballTrail(m, fi); else fx.trail(m.position, cur.el, slow);
        if (S.expr && Math.random() < dt * 40) { const p = m.position; fx.emit(1, { p, r: .1, v: .2, life: 2, size: .12, c: EXPR.ice, c2: 'white', k: 2, drag: 1 }); fx.emit(1, { p, r: .2, v: .3, up: .2, life: 3, size: .03, c: 'white', g: 1, drag: 1 }); fx.emit(1, { p: { x: p.x, y: .1, z: p.z }, r: .2, v: .5, up: .3, life: .7, size: .4, grow: 1.6, c: EXPR.kick, smoke: true, a: .3, drag: 1.5 }); }   // Elemental Expression's Icy Wave
        if (DA?.ember) fx.emit(DA.lick ? 3 : 1, { p: m.position, r: .06, v: .3, life: DA.lick ? .5 : 1.2, size: DA.lick ? .14 : .04, c: DA.ember, c2: 'white', k: 2.4, drag: 1 });
        if (slow) {
          if (P.absorbs && !S.dmg?.parts?.WhirlwindLanceStormPlayer) { const n = absorb(cur, m.position, Math.max(S.R, .6)), EG = bst['eye_of_winter_damage_%_to_gain_as_element_per_ground_effect_type']; if (n !== cur) { cur = EG ? gainAs(n, n.got, EG) : n; tint(m, cur.el); } }
          if (P.ground && trail > 1.4) { trail = 0; ground(P.ground, m.position, .8, 4, cur); }
          if (S.R && (pulse -= dt) <= 0) { pulse = every || .35; if (every) ballZap(m.position, S.R); else fx.ring(m.position, .2, S.R, cur.el, .3, { a: .6 }); area(m.position, S.R, cur, { mult: every ? 1 : .5 }); }
          if (BG && (burn -= dt) <= 0) { burn = bst.ball_lightning_infused_burning_ground_interval_ms / 1000; ground('burning', m.position, radOf(BG, 'tertiary'), BG.dmg.shape?.duration || 4, BG); }
        }
        if (left <= 0) { end(null); caltrops(S, m.position); if (BX) { const p = { x: m.position.x, z: m.position.z }; ballBlast(p, radOf(BX)); area(p, radOf(BX), BX); } }
      },
      remove() { fx.drop(m); } };
    objs.push(q); return q;
  }
  // Warbringer's Ancestral Spirits: one of the four Karui spirits (MonsterVarieties' Ancestral Spirit Turtle, Jade Hulk,
  // Jadecaster and Warhorn: minion_*.ao), a pale blue see-through spectre (spectreSkin_01.mat: RGB 0.45 / 0.84 / 1)
  // trailing ghost ribbons (ghostRibbons.pet), called by a beam from its totem (spawn_beam.ao), each with its own blow:
  // the Hulk's slam in jade debris (debris_r.mat: 0.22 / 1 / 0.3), the Jadecaster's jade projectile, the Warhorn's blow
  // of its horn, the Turtle's bite and its bubble (turtle_aura.mat). note: which one a totem calls is not in the data:
  // one at random here; their own skills' effects (the bubble, the horn's buff, the jade prison) are not simulated
  const SPECTRE = 0x73d6ff, JADE = 0x38ff4d, SPIRIT_SIZE = { hulk: 1.5, caster: 1, horn: 1.25, turtle: 1 };
  function spectre(f, kind, p, from, list = []) {
    f.group.traverse(m => { if (m.isMesh) m.visible = false; });
    const plate = f.group.children.find(m => m.isSprite), sz = SPIRIT_SIZE[kind] ?? 1, born = time;
    let G = null, shell = null;
    const skin = m => { m.color.set(0x9fe2ff); m.emissive?.set(SPECTRE); m.emissiveIntensity = .55; m.transparent = true; m.opacity = .55; m.depthWrite = false; };
    if (kind === 'turtle') {   // its shell, head and legs
      shell = new THREE.Group(); const m = new THREE.MeshStandardMaterial(); skin(m);
      const s = new THREE.Mesh(new THREE.SphereGeometry(.55, 16, 10, 0, TAU, 0, Math.PI / 2), m); s.scale.y = .75; s.position.y = .18; shell.add(s);
      const h = new THREE.Mesh(new THREE.SphereGeometry(.16, 10, 8), m); h.position.set(0, .28, .62); shell.add(h);
      for (const [x, z] of [[.35, .3], [-.35, .3], [.35, -.3], [-.35, -.3]]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(.08, .1, .22, 6), m); l.position.set(x, .1, z); shell.add(l); }
      f.group.add(shell); if (plate) plate.position.y = 1.2;
    } else { G = makeHumanoid(fx); G.group.scale.setScalar(sz); f.group.add(G.group); if (plate) plate.position.y = 1.95 * sz; }
    // called: a beam from the totem, a flare where it stands
    if (from) fx.bolt(V(from.x, 1.3, from.z), V(p.x, .9, p.z), SPECTRE, .35, .06, 0);
    fx.glow({ x: p.x, y: 1, z: p.z }, 1.6 * sz, SPECTRE, .4, 2); fx.ring(p, .2, 1.2 * sz, SPECTRE, .4, { a: .6 });
    const bubble = q => fx.ball({ x: q.x, y: .6, z: q.z }, 1.3, SPECTRE, .9, .6);
    if (kind === 'turtle') bubble(p);
    if (kind === 'bound') for (let i = 0; i < 18; i++) { const a = i / 18 * TAU; fx.emit(1, { p: { x: p.x + Math.cos(a) * .9 * sz, y: .1, z: p.z + Math.sin(a) * .9 * sz }, up: 1.4, v: .2, life: .8, size: .16, grow: 1.4, c: SPECTRE, c2: 'white', k: 1.6, drag: 1 }); }   // a Spectre's: a ring of ribbons (spectreSummon_ringRibbons)
    // a Spectre: one of its monster's skills at a time (calc.js out.spectre), its range by that skill's shape
    let last = { x: p.x, z: p.z }, cur = null;
    const ready = {}, pick = () => { if (cur) return cur; const R = list.filter(c => time >= (ready[c.key] ?? 0)); return cur = R[Math.floor(Math.random() * R.length)] || null; }, far = c => !!c && c.shape !== 'melee' && c.shape !== 'slam';
    return {
      stop: () => kind === 'bound' && list.length ? far(pick()) ? 7 : 1.1 : null,
      tick(dt, e) {
        const moving = Math.hypot(e.pos.x - last.x, e.pos.z - last.z) > 1e-3; last = { x: e.pos.x, z: e.pos.z };
        const fade = kind === 'bound' && time - born < .8 ? (time - born) / .8 : 1;   // a Spectre fades in (MainSkinFADE)
        if (G) { G.update(dt, { moving, speed: 4 }); G.group.traverse(m => { if (m.isMesh && m.material && !m.userData.dyed) { m.userData.dyed = true; m.material = m.material.clone(); skin(m.material); m.castShadow = false; } if (m.isMesh && m.userData.dyed) m.material.opacity = .55 * fade; }); }
        else shell.position.y = moving ? Math.abs(Math.sin(e.s * 8)) * .04 : 0;
        if (Math.random() < dt * 14) fx.emit(1, { p: { x: e.pos.x, y: rnd(.3, 1.6) * (G ? sz : .5), z: e.pos.z }, r: .3 * sz, up: .5, v: .4, life: .55, size: .14, c: SPECTRE, k: 1.4, drag: 1 });   // its ghost ribbons
      },
      blow(e, d, MX, k) {
        const dx = (d.pos.x - e.pos.x) / k, dz = (d.pos.z - e.pos.z) / k;
        const c = kind === 'bound' && pick();
        if (c) {   // its skill's hits, in its element's colour, reaching as the skill does; its next use after its own time
          cur = null; const els = Object.keys(c.hits).sort((a, b) => c.hits[b][1] - c.hits[a][1]), X = { ...MX, dmg: { ...MX.dmg, hits: c.hits, crit: c.crit, critBonus: c.critBonus }, el: els[0], els }, R = c.radius || 1.5;
          if (c.shape === 'projectile') { G.act('fire', .5); for (let n = 0; n < (c.count || 1); n++) { const a = (n - ((c.count || 1) - 1) / 2) * .18, ca = Math.cos(a), sa = Math.sin(a); shoot(X, e.pos, dx * ca - dz * sa, dx * sa + dz * ca, { speed: c.projSpeed || 14, range: 13 }); } }
          else if (c.shape === 'bolt') { G.act('fire', .5); fx.bolt(V(e.pos.x, 1.3 * sz, e.pos.z), V(d.pos.x, 1, d.pos.z), X.el, .25, .05, 0); hit(d, X); }
          else if (c.shape === 'area' || c.shape === 'slam') { G.act(c.shape === 'slam' ? 'slam' : 'fire', .6); fx.ring(d.pos, .2, R, X.el, .4, { a: .7 }); fx.disc(d.pos, R, X.el, .3, { a: .35 }); area(d.pos, R, X); }
          else { G.act('punch', .4); fx.sector(e.pos, dx, dz, 1.3 * sz, .8, X.el, .18, { a: .6 }); hit(d, X); }
          if (c.cooldown) ready[c.key] = time + c.cooldown;   // a skill with a cooldown waits it out; meanwhile its others
          return c.cooldown ? c.period : 1 / (c.speed || 1);
        }
        if (kind === 'caster') { G.act('fire', .5); shoot({ ...MX, el: JADE }, e.pos, dx, dz, { speed: 14, range: 13 }); return; }
        if (kind === 'hulk') {
          G.act('slam', .6); fx.ring(d.pos, .2, 1.6, JADE, .4, { a: .7 });
          fx.emit(18, { p: { x: d.pos.x, y: .2, z: d.pos.z }, r: .5, v: 2.5, up: 3, life: .6, size: .16, c: JADE, c2: 0x1f6b2e, k: 1.2, g: 8 });
        } else if (kind === 'horn') { G.act('shout', .6); fx.ring(e.pos, .3, 3, SPECTRE, .55, { a: .55 }); fx.emit(16, { p: { x: e.pos.x, y: 1.6, z: e.pos.z }, r: .2, v: 2.5, flat: true, life: .5, size: .18, c: SPECTRE, c2: 'white', drag: 1.5 }); }
        else if (kind === 'turtle') { fx.sector(e.pos, dx, dz, 1.1, .7, SPECTRE, .2, { a: .7 }); if (Math.random() < .3) bubble(e.pos); }
        else G.act('punch', .4);
        if (G) fx.sector(e.pos, dx, dz, 1.3 * sz, .8, kind === 'hulk' ? JADE : SPECTRE, .18, { a: .6 });
        hit(d, MX);
      },
      off() { G?.dispose(); },
    };
  }
  function minion(S, p, life, o = {}) {
    // a minion with the damage of its own (calc.js minionOf) attacks at its speed; else the scene's half hit every 1.1 / 1.5 s.
    // o.attacks: it is gone after that many; o.chains: its hit chains to that many more enemies. With its life (calc.js
    // minionLife) enemies nearer to it than to you attack it (a decoy, as Lingering Illusion), and it dies at none left.
    // its resistances and physical damage reduction take their share off enemy hits (calc.js minionOf), its extra energy
    // shield is lost before its life, it regenerates and Recoups (over 8 seconds: keywords.json Recoup) what the tree
    // gives minions, and a Gigantic one is 20% bigger. note: its armour and evasion are not counted, and its energy
    // shield does not recharge (a monster's recharge is not in the data)
    // a Spectre (Bind Spectre's monster, chosen in the Skills tab: the gem becomes "Spectre: <monster>"): a pale blue
    // see-through ghost of it (necromancer_spectre/raiseSpectre_Skin: spectreSkin_01 0.45 / 0.84 / 1, spectre()) trailing
    // ghost ribbons, summoned in a ring of ribbons and fading in (MainSkinFADE), its hits and life its monster's at the
    // gem's level (calc.js minionOf), using each of its monster's skills (spectre().blow). note: its ghost is a humanoid
    // (the scene's monsters are training dummies); its warp to you (spectre_warping) is not simulated
    if (S.name === 'Spectre: {0}') o = { ...o, spirit: 'bound' };
    const f = makeMinion(fx, S.el), real = !!S.dmg?.minion && Object.keys(S.dmg.hits).length > 0, comp = !!S.g && !!api.info(S.g).gem?.types?.includes('Companion'), MS = real ? { ...S, src: 'minionHit', comp } : { ...S, src: 'minion', mult: .5 * S.mult, comp }, ranged = o.spirit ? o.spirit === 'caster' : S.P.ranged;
    f.group.position.set(p.x, 0, p.z); scene.add(f.group); if (S.dmg?.minion?.gigantic) f.group.scale.multiplyScalar(1.2);
    const SP = o.spirit && spectre(f, o.spirit, p, o.from, S.dmg?.spectre);
    if (o.look) o.look.start(f, p); else if (!SP) { fx.ring(p, .2, 1, S.el, .4); fx.emit(14, { p: { x: p.x, y: .2, z: p.z }, r: .4, v: .6, up: 2.5, life: .6, size: .2, c: S.el }); }
    let wait = rnd(.3, 1), sw = 0;
    const e = { pos: f.group.position, fig: f, r: .3, dead: false, keep: life === Infinity, s: 0, minion: true, kind: o.kind, ofS: S.name, undead: !!S.dmg?.minionUndead, rhoa: S.name === 'Rhoa Mount', companion: !!S.g && !!api.info(S.g).gem?.types?.includes('Companion'), skeleton: !!S.g && !!api.info(S.g).gem?.types?.includes('CreatesSkeletonMinion'),
      update(dt) {
        e.s += dt; wait -= dt; sw = Math.max(0, sw - dt * 4); f.arm.rotation.x = -1 - Math.sin(sw * Math.PI) * 1.2; SP?.tick(dt, e); o.look?.tick(dt, e);
        if (e.s >= life) { e.dead = true; return; }
        if (e.rhoa && me.mounted) { e.pos.x = pp.x; e.pos.z = pp.z; f.group.rotation.y = facing; return; }   // ridden: under you, no attacks
        if (e.regen) { const q = e.segs[0]; if (q.life > 0) q.life = Math.min(q.max, q.life + q.max * e.regen / 6000 * dt); }
        if (e.rc?.length) { const q = e.segs[0]; for (const r of e.rc) { const x = Math.min(r.left, r.rate * dt); r.left -= x; if (q.life > 0) q.life = Math.min(q.max, q.life + x); } e.rc = e.rc.filter(r => r.left > 1e-6); }
        const SA = sheet(), q0 = e.segs?.[0], AR = (SA.allyRegen || 0) * me.maxL + (SA.allyRegenOwn || 0) * (q0?.max || 0) + (SA.allyRegenBase || 0) * 100; if (AR && q0?.life > 0 && dist(e.pos, pp) <= SA.overgrow.r) q0.life = Math.min(q0.max, q0.life + AR / 6000 * dt);   // the tree's, in your Presence
        // Infernal Hound: it Ignites the enemies within its radius as though dealt its % of its maximum life as base fire
        // damage (every half second here)
        const IB = S.dmg?.stats?.['infernal_familiar_minion_burns_for_%_max_life'];
        if (IB && L > 0 && (e.burnT = (e.burnT ?? 0) - dt) <= 0) { e.burnT = .5; for (const d of inside(e.pos, S.dmg.stats.infernal_familiar_minion_burn_radius / 10)) inflict(d, 'ignite', MS, 1, { fire: L * IB / 100 }); }
        // Infernal Legion: it burns, taking its % of its maximum life as fire a minute, and Ignites the enemies within its
        // radius as Infernal Hound does
        const IL = S.dmg?.sum?.['support_minions_ignite_for_%_max_life'];
        if (IL && L > 0 && q0?.life > 0) {
          q0.hurt(q0.max * (S.dmg.sum['minion_fire_damage_%_of_maximum_life_taken_per_minute'] || 0) / 6000 * dt * (1 - (q0.res?.fire || 0) / 100));
          const CB = S.dmg.sum.minion_cathas_brilliance_blind_aura_radius;   // Catha's Brilliance: it Blinds those within its radius too
          if ((e.ilT = (e.ilT ?? 0) - dt) <= 0) { e.ilT = .5; for (const d of inside(e.pos, S.dmg.sum.infernal_legion_minion_burning_effect_radius / 10)) inflict(d, 'ignite', MS, 1, { fire: L * IL / 100 }); if (CB) for (const d of inside(e.pos, CB / 10)) d.st.blind = Math.max(d.st.blind || 0, BLIND.time); }
        }
        // Minion Instability: reduced to Low Life it explodes for its % of its maximum life as fire (once, until healed above). note: the explosion's area is the scene's
        const MI = S.dmg?.sum?.['explode_on_low_life_%_maximum_life_to_deal'], low = q0 && q0.life > 0 && q0.life <= q0.max * LOW;
        if (MI && low && !e.blew) { const x = q0.max * MI / 100; boom({ x: e.pos.x, z: e.pos.z }, SIM.area, { ...MS, dmg: { ...S.dmg, hits: { fire: [x, x] }, trig: [] }, els: ['fire'], el: 'fire', mult: 1, src: 'trigger' }); }
        if (q0) e.blew = low;
        const d = near(e.pos, ranged ? 12 : 9), goal = d ? d.pos : pp, k = dist(goal, e.pos), stop = d ? SP?.stop?.() ?? (ranged ? 7 : 1.1) : 2.4;
        if (k > .05) f.group.rotation.y = Math.atan2(goal.x - e.pos.x, goal.z - e.pos.z);
        const ON = e.companion && (time < (me.compOns ?? -9) || sheet().compShiftOns && (me.form || me.demon) && dist(e.pos, pp) <= sheet().overgrow.r);   // Companions' Onslaught (the tree's on kill)
        // (a hair past where it stops: walking exactly up to it leaves it a rounding error short, never in reach)
        if (k > stop + 1e-6) { const v = Math.min(k - stop, 5.5 * (o.speed || 1) * (1 + ((sheet().minionMove || 0) + (e.companion ? sheet().companionMove || 0 : 0) + (ON ? ONSLAUGHT.move : 0) + PUPPET.move * pup()) / 100) * dt);   /* the tree's increased minion / companion movement speed */ e.pos.x += (goal.x - e.pos.x) / k * v; e.pos.z += (goal.z - e.pos.z) / k * v; e.pos.y = Math.abs(Math.sin(e.s * 9)) * .05; }
        else if (d && wait <= 0 && !S.dmg?.cmd) {   // (a djinn acts only on Command: djinnCast)
          // note: Skeletal Reaver's Enrage (its Command: Rage on hit, life lost over time, 3% attack speed per Rage) is not
          // simulated: the Rage a hit gives them and the life they lose are not in the data
          // Muster: more per different kind of persistent minion you have; Upwelling's increased damage while you are not on full mana (as more here); Crazed Minions: more if it Revived Recently
          const MU = S.dmg?.sum?.['support_varied_troops_damage_+%_final_per_different_persistent_ominion'], UW = me.mana < me.maxM ? sheet().upwell || 0 : 0;
          const PO = painOn(e), NC = (1 + (S.dmg?.finals?.['support_minion_damage_with_non_command_skills_+%_final'] || 0) / 100) * (time - (e.revAt ?? -99) <= RECENT ? 1 + (S.dmg?.finals?.['support_crazed_minions_minion_damage_+%_final_if_revived_recently'] || 0) / 100 : 1) * (MU ? 1 + MU * new Set(objs.filter(x => x.minion && x.keep && !x.dead).map(x => x.ofS)).size / 100 : 1) * (1 + UW / 100) * (1 + ((sheet().minionRage?.dmg || 0) * me.rage + (meIs.HitRecently() ? sheet().minionRage?.hit || 0 : 0)) / 100), MX = PO || NC !== 1 ? { ...MS, mult: MS.mult * (PO ? 1 + PO['pain_offering_damage_+%'] * PO._x / 100 : 1) * NC } : MS;   // Commandment: no damage with its own attacks
          wait = (real && S.dmg.speed ? 1 / S.dmg.speed : ranged ? 1.5 : 1.1) / (1 + (PO?.['pain_offering_attack_and_cast_speed_+%'] || 0) * (PO?._x || 1) / 100) / (ON ? 1 + ONSLAUGHT.speed / 100 : 1) / (1 + PUPPET.speed * pup() / 100) / (1 + (e.lg || 0) / 100) / (1 + (sheet().minionRage?.speed5 || 0) * Math.floor(me.rage / 5) / 100); sw = 1;   // Tecrod's Revenge: faster while undying
          if (SP) { const w = SP.blow(e, d, MX, k); if (w) wait = w; }
          else if (ranged) shoot(MX, e.pos, (d.pos.x - e.pos.x) / k, (d.pos.z - e.pos.z) / k, { speed: 14, range: 13 });
          else if (o.chains) chain(V(e.pos.x, 1, e.pos.z), d, MX, o.chains);
          else { if (o.look) o.look.hit(e, d); else fx.sector(e.pos, d.pos.x - e.pos.x, d.pos.z - e.pos.z, 1.3, .8, S.el, .16, { a: .7 }); hit(d, o.more ? { ...MX, mult: MX.mult * o.more(d) } : MX); }
          if (o.attacks && --o.attacks <= 0) e.dead = true;
        }
      },
      remove() {
        if (SP) fx.emit(16, { p: { x: e.pos.x, y: .8, z: e.pos.z }, r: .4, v: 1.2, up: 1.5, life: .7, size: .16, c: SPECTRE, k: 1.4, drag: 1 }); else fx.emit(16, { p: { x: e.pos.x, y: .8, z: e.pos.z }, r: .3, v: 1.5, up: 1, life: .6, size: .14, c: 0xd8d0b8, g: 8, k: 1 }); SP?.off(); f.dispose();
        if (e.keep && e.slain) event('miniondeath', e.pos, MS, null, 1);   // Cast on Minion Death: a Persistent Minion killed (its text)
        if (e.keep && e.slain) fallen(S, e);
        if (e.slain) { me.minionDiedAt = time; const H = sheet().uDef?.minionDeath; if (H) hurt(H, 0, 'physical'); }   /* Heartbound Loop: physical damage taken on Minion death */   // the tree's "if one of your Minions has died Recently"
        // Deathmarch: on death it heals the allied minions within its radius for its % of its life (their ailments: minions have none here)
        const DM = e.slain && S.dmg?.sum?.['minion_on_death_heal_nearby_minions_for_%_of_life_and_remove_ailments'];
        if (DM) for (const o of objs) if (o !== e && o.minion && !o.dead && o.segs?.[0]?.max && dist(o.pos, e.pos) <= S.dmg.sum.minion_on_death_heal_radius / 10) o.segs[0].life = Math.min(o.segs[0].max, o.segs[0].life + L * DM / 100);
      } };
    const L = S.dmg?.minionLife;
    // Spirit Walker's Sacred Unity: the Bear Spirit (Wild Protector) takes its share of your damage before you, as Loyalty, and regenerates its life
    const SU = S.dmg?.sum || {}, FN = S.dmg?.finals || {}, bear = S.name === 'Wild Protector';
    if (L > 0) Object.assign(e, { decoy: true, recoupLoyal: SU['loyalty_%_of_redirected_damage_recouped_as_life_for_owner'] || 0, loyal: (SU['companion_takes_%_damage_before_you_from_support'] || 0) + (bear && SU['ascendancy_bear_companion_takes_%_damage_before_you'] || 0) + (e.companion && SU['companion_takes_%_damage_before_you'] || 0),   /* the tree's Trusted Partner */
      regen: (bear && SU['ascendancy_bear_companion_life_regeneration_rate_per_minute_%'] || 0) + (S.dmg?.minion?.regen || 0), rc: [], segs: [{ p: e.pos, r: .3, life: L, max: L, es: L * (S.dmg?.minion?.es || 0) / 100, esMax: L * (S.dmg?.minion?.es || 0) / 100, res: S.dmg?.minion?.res, hurt(n) { if (time < e.immune) return;   // a Skeleton a Skeletal Cleric Revived (its quality)
      // Bone Offering: while its spike stands its shield takes its less damage from hits; a hit above its % of the minion's
      // maximum life is absorbed whole and the shield explodes (after that, its quality's less damage). note: the
      // explosion's damage is not in its data
      const B = objs.find(o => o.bone && !o.dead);
      if (B) { if (e.shot !== B && n > L * B.bone['bone_offering_hit_threshold_%_of_maximum_life'] / 100) { e.shot = B; fx.ring(e.pos, .2, 1.2, BOF.ring, .3); fx.emit(16, { p: { x: e.pos.x, y: .8, z: e.pos.z }, r: .3, v: 3, up: 1.5, life: 1, size: .12, c: BOF.bone, smoke: true, a: .95, g: 10, drag: .5 }); return; }
        n *= 1 + (e.shot === B ? B.bone['bone_offering_damage_taken_+%_final_after_shield_loss'] || 0 : B.bone['bone_offering_damage_taken_+%_final']) / 100; }
      if (time < e.guard?.until) { const G = Math.min(e.guard.n, n); e.guard.n -= G; n -= G; }   // Arbiter's Reach: its Guard takes it first
      n *= (o.taken || 1) * (1 + (FN['feeding_frenzy_minion_damage_taken_+%_final'] || 0) / 100) * (1 + (FN['support_minion_defensive_stance_minion_damage_taken_+%_final'] || 0) / 100);   // an Empowered Zombie's less damage taken; Feeding Frenzy's more, Meat Shield's less
      if (this.es > 0) { const k = Math.min(this.es, n); this.es -= k; n -= k; }
      const RC = S.dmg?.minion?.recoup; if (RC && n > 0) e.rc.push({ left: n * RC / 100, rate: n * RC / 800 });
      if (sheet().flaskUndying && lifeFlaskOn()) n = Math.min(n, this.life - 1);   // Umbilicus Immortalis: it cannot die while your life flask is in effect
      fx.emit(4, { p: { x: e.pos.x, y: .8, z: e.pos.z }, r: .2, v: 1, life: .3, size: .1, c: 0xc03030 }); if (this.life > 0 && (this.life -= n) <= 0) {
        // Last Gasp, Tecrod's Revenge: a persistent one fights on for its time at 0 life, then dies
        const LG = e.keep && SU.support_last_gasp_duration_ms; if (LG) { this.life = 0; e.lg = SU['support_last_gasp_attack_and_cast_speed_+%_while_undying'] || 0; later(LG / 1000, () => { e.dead = e.slain = true; }); } else e.dead = e.slain = true; } } }] });
    objs.push(e); return e;
  }
  // Plague Bearer: while on, stores its % of the poison damage you deal, up to its most; used again, it unleashes the
  // stored damage around you, its area larger by its % per percent of its most it holds (its incubation)
  // note: the nova deals the stored amount as one chaos hit (how the game turns it into a hit is not in its data)
  function plagueStore(n) { const st = onS('Plague Bearer')?.dmg.stats; if (st) me.plague = Math.min(st.plague_bearer_maximum_stored_poison_damage, (me.plague || 0) + n * st['plague_bearer_gains_%_of_damage_from_inflicted_poisons'] / 100); }
  function plague(S) {
    const st = S.dmg.stats, n = me.plague || 0, R = S.A * Math.sqrt(1 + n / st.plague_bearer_maximum_stored_poison_damage * st['plague_bearer_nova_area_+%_final_per_incubation_%']);
    me.plague = 0; fx.ring(pp, .2, R, 'poison', .55); say(S.label, 'poison');
    if (n > 0) area(pp, R, { ...S, el: 'chaos', els: ['chaos'], dmg: { ...S.dmg, hits: { chaos: [n, n] } } });
  }
  // Briarpatch: while on, stores its permyriad of the physical attack damage you deal, up to its most; a spell you cast
  // spends it on its Thorny Ground at the spell's target (its area, duration and limit), once per its creation delay,
  // hitting the enemies that move in it for the stored damage. note: how often it hits is not in its data (the scene's half second)
  // Its look (create_briarpatch: briarpatchWave; grd_briarpatch01): a dark wave spreading for 1.3 s (blackBG_Wave
  // 0.028 / 0.035 / 0), a blur ring for 0.6 s and yellow-green spores for 0.35-2 s (waveSpores 3.72 / 5 / 1.36); its
  // ground mud (groundZone_thorns_01: mud_01) bristling with thorny vines (briarpatchGRD_01 thorns, 0.85 / 0.45 / 0.28
  // through its look-up, from 0.04 / 0.06 / 0.02 at their roots). note: the vines are cones of one brown between those,
  // their number, the mud's round edge and how much darker it is drawn (the game's lit by the scene) are the scene's
  const BRI = { wave: 0x070900, spore: 0xbeff45, thorn: 0x6b4630, mud: 0x707070 };
  function briarStore(n) { const st = onS('Briarpatch')?.dmg.stats; if (st) me.briar = Math.min(st.briarpatch_maximum_stored_physical_damage, (me.briar || 0) + n * st.briarpatch_stores_permyriad_of_physical_damage_dealt / 1e4); }
  function briar(by) {
    const S = onS('Briarpatch'), st = S?.dmg.stats, n = me.briar || 0; if (!st || !n || time < me.briarAt) return;
    me.briar = 0; me.briarAt = time + st.briarpatch_ground_creation_delay_ms / 1000; limit(o => o.briar, st.base_briarpatch_ground_limit, S);
    const c = { ...by.at }, X = { ...S, el: 'physical', els: ['physical'], dmg: { ...S.dmg, hits: { physical: [n, n] } } }, dec = fx.decal(c, S.A, artTex('mud', 'particles/fxlib/pbr/mud_01_clr'), BRI.mud, { a: .9, dark: true });
    fx.disc(c, S.A, BRI.wave, 1.3, { dark: true, a: .8 }); fx.ring(c, .2, S.A, BRI.spore, .6, { a: .35 });
    fx.emit(30, { p: { x: c.x, y: .2, z: c.z }, r: S.A * .7, v: .6, up: .8, life: 1.2, size: .06, c: BRI.spore, k: 2, drag: 1 });
    fx.spikes(c, S.A, { n: Math.round(14 + S.A * 12), h: .6, w: .035, c: BRI.thorn, dark: true, dur: durOf(S), inner: 0 });
    let tk = 0; say(S.label, 'dust');
    thing(holder(c), durOf(S), { briar: 1, off: () => dec.remove(), tick(dt) {
      if ((tk -= dt) > 0) return; tk = .5;
      for (const d of inside(c, S.A)) { const moved = d.bp && dist(d.bp, d.pos) > .05; d.bp = { x: d.pos.x, z: d.pos.z }; if (moved) { hit(d, X); fx.emit(5, { p: { x: d.pos.x, y: .3, z: d.pos.z }, r: .2, v: 1.5, up: 1, life: .5, size: .05, c: BRI.thorn, g: 6 }); } }
    } });
  }
  // Pain Offering: skewers your nearest minion on a bone spike; the minions within its area attack and cast faster and
  // deal more damage for its duration. note: its increased speed and damage are applied as more here
  const painOn = m => objs.find(o => o.pain && !o.dead && dist(o.pos, m.pos) <= o.R)?.pain;
  function rod(S, c) {   // Lightning Rod: stays planted and pulses over its area whenever lightning reaches it
    const g = holder(c), R = S.A, range = fx.decal(c, R, 'outline', S.el, { a: .3, rot: 0 });
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, 1.8, 6), new THREE.MeshBasicMaterial({ color: fx.color(S.el, 2.4), fog: false }));
    pin.position.y = .9; pin.userData.own = true; g.add(pin);
    const tip = fx.orb(S.el, .07); tip.position.y = 1.8; g.add(tip);
    let last = -9;
    const e = thing(g, S.P.dur || SIM.lifetime, { r: .3, rod: true, name: S.name, chained: 0,
      pulse(by) {
        if (time - last < .5 || by.src === 'rod') return; last = time;
        if (++e.chained >= (S.dmg?.stats?.lightning_rod_number_of_chains_allowed || Infinity) + lasts(S)) e.dead = true;   // gone after its most chains to it. note: every lightning that reaches it counts
        say(t('{0} pulses: struck by {1}', S.label, by.label), S.el);
        fx.bolt(V(c.x, 11, c.z), V(c.x, 1.8, c.z), S.el, .2, .06, .4); fx.ring(c, .3, R, S.el, .4, { k: 2.8 }); fx.flash(c, S.el, 30, .3, 9);
        fx.emit(30, { p: { x: c.x, y: .4, z: c.z }, v: R * 3, flat: true, life: .3, size: .16, c: S.el, c2: 'white', drag: 2, k: 3 });
        area(c, R, { ...S, self: e, src: 'rod' });
      },
      touch(by) { if (by.els.includes('lightning') && by.name !== S.name) e.pulse(by); },
      off: () => range.remove() });
    pop(c, 1, S.el); area(c, 1, { ...S, self: e }, { noTouch: true });
    if (Math.random() * 100 < (S.dmg?.stats?.['lightning_rod_%_chance_for_additional_burst_on_landing'] || 0)) later(.25, () => { pop(c, 1, S.el); area(c, 1, { ...S, self: e }, { noTouch: true }); });   // its quality: another burst where it lands
  }
  const ICE = new THREE.ConeGeometry(.32, 1.5, 5);
  // life: a crystal with its own (Midnight Zenith's) takes the average of each hit's damage and bursts at none left
  // (note: what its defences take off is not in the data); else any hit bursts it
  const avgHit = by => Object.values(by.dmg?.hits || {}).reduce((t, [a, b]) => t + (a + b) / 2, 0) * (by.mult ?? 1);
  // an Ice Crystal's life: its skill's (Frost Wall, Grim Pillars, Frozen Locus), increased and more (Icicle, Glacier)
  const crystalLife = S => (S.dmg?.stats?.frost_wall_maximum_life || 0) * (1 + ((S.dmg?.sum?.['ice_crystal_maximum_life_+%'] || 0) + (S.dmg?.sum?.['ice_crystal_maximum_life_+%_per_5%_cold_resistance'] || 0) * Math.floor((sheet().res?.cold?.capped || 0) / 5)) / 100)   // Eventide Petals: per 5% cold resistance
    * Object.entries(S.dmg?.finals || {}).reduce((m, [k, x]) => k.endsWith('ice_crystal_maximum_life_+%_final') ? m * (1 + x / 100) : m, 1);
  // Comet's look (comet: comet_meteor ice_Comet.ao and comet_impact impactAoE.ao; with a Fire Infusion consumed, their
  // _Infusion ones): a chunk of ice shards falls through its fall time (contact at 0.47 s of its animation) with a trail
  // (cometTrail vibrance 0.38 / 0.53 / 1.02), a helix (emissive 8.55 / 13.2 / 25) and sparks (boost 1 / 1.1 / 2); where it
  // lands, a flash for 0.22 s (0.5 / 3 / 12), spikes for 0.32 s (0.85 / 1.25 / 2), an instant ring for 0.22 s (0.77 / 0.9 / 1),
  // a wave for 0.55 s (0.5 / 0.73 / 1), sparks for 0.85-1.5 s (2 / 5 / 12), 64 puffs of grey smoke for 4 s (0.225 / 0.23 /
  // 0.248), ice shards, snow for 3.75-6.25 s (0.875 / 0.93 / 1), its crater for 3 s and its frost for 8 s (ice_blast 0.8 /
  // 0.92 / 1), the screen shaking for 1.25 s. Infused: fire ribbons round the chunk for 0.55 s (5 / 2.75 / 1.13); where it
  // lands a core for 0.65 s (1 / 0.69 / 0.54), fire tufts for 0.65-1 s (1 / 0.53 / 0.29), burning ground for 1-4 s
  // (grd_fire 1 / 0.23 / 0.07) and embers for 2.4-3.6 s.
  // note: its path (fallingRIG.ast) is a slanted drop; the shards are a burst. Its jump back when targeting within its
  // range_backflip_conditional_distance is not simulated: the distance is its animation's
  const COMET = { body: 0xbfe8ff, helix: 0x5786ff, trail: 0x5f84ff, spark: 0x808cff, flash: 0x0b40ff, spike: 0x6ca0ff, ring: 0xc4e6ff, wave: 0x80b9ff, hot: 0x2a6aff,
    smoke: 0x393b3f, snow: 0xdfedff, frost: 0xcceaff, ribbon: 0xff8c3a, core: 0xffb08a, tuft: 0xff874a, burn: 0xff3b12 };
  function comet(c, R, S, delay, inf) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(.75, 0), new THREE.MeshStandardMaterial({ color: COMET.body, emissive: COMET.helix, emissiveIntensity: .5, roughness: .1, flatShading: true }));
    m.scale.set(1, 1.4, 1); m.rotation.z = -2.53;   // its chunk's tilt (cometchunk offset)
    const fly = Math.min(.47, delay), from = V(c.x + 4, 14, c.z - 3);
    later(delay - fly, () => {
      const e = lob(m, from, V(c.x, .3, c.z), fly, 0, () => cometHit(c, R, S, inf)), up = e.update;
      e.update = dt => { up(dt); const q = m.position; fx.trail(q, COMET.trail, true); fx.emit(3, { p: q, r: .3, v: 2, life: .37, size: .07, c: COMET.spark, k: 2.4, drag: 2 });
        fx.emit(1, { p: q, r: .4, v: .6, life: .5, size: .3, c: COMET.helix, k: 2, drag: 1 });   // its helix
        if (inf) fx.emit(2, { p: q, r: .35, v: .8, life: .45, size: .25, c: COMET.ribbon, k: 2.2, drag: 1 }); };   // its fire ribbons
    });
  }
  function cometHit(c, R, S, inf) {
    const p = { x: c.x, y: .4, z: c.z };
    fx.flash(p, COMET.flash, 12, .22, R * 1.5); fx.glow(p, R * 1.1, COMET.spike, .32, 2.6); fx.ring(c, .2, R, COMET.ring, .22, { a: .9 }); fx.ring(c, .3, R * 1.15, COMET.wave, .55, { a: .6, y: .3 });
    fx.shards(c, R * .8); fx.emit(30, { p, r: .3, v: R * 4, up: 2, life: 1.2, size: .06, c: COMET.hot, k: 2.4, g: 4, drag: 2.5 });   // its sparks
    fx.emit(64, { p: { x: c.x, y: .2, z: c.z }, r: R * .5, v: R * .8, up: .5, life: 4, size: .8, grow: 2, c: COMET.smoke, smoke: true, a: .35, drag: 1.5 });
    fx.emit(40, { p: { x: c.x, y: 1.5, z: c.z }, r: R * .8, v: .3, up: .2, life: 5, size: .05, c: COMET.snow, k: 2, g: .3, drag: 1 });   // its snow
    fx.disc(c, R * .45, 0x080a0e, 3, { dark: true, a: .7, hold: .7 }); fx.disc(c, R, COMET.frost, 8, { a: .3, hold: .8, k: 1, tex: 'soft' });   // its crater and frost
    if (inf) {
      fx.glow(p, R * .9, COMET.core, .65, 2.6); fx.emit(10, { p, r: R * .4, v: 1, up: 1.4, life: .9, size: .5, grow: 1.6, c: COMET.tuft, k: 2.2, drag: 1 });
      fx.emit(16, { p: { x: c.x, y: .1, z: c.z }, r: R * .7, v: .2, up: .8, life: 2.5, size: .35, c: COMET.burn, k: 2.2, drag: 1 });   // its burning ground
      fx.emit(24, { p, r: R * .5, v: 3, up: 3, life: 3, size: .05, c: COMET.tuft, k: 2.4, g: 3, drag: 1.5 });   // its embers
    }
    area(c, R, S); shake = Math.max(shake, .5);
  }
  // Consecrate's look (consecrate_nova.ao: holyWave, lightBeams on its ring of 24 bones): a wave out to its area for 1 s
  // with a glowing ring for 0.4 s (ringGlow boost 1 / 1 / 0.55), beams of light rising round it for 0.1-0.35 s and sparks
  // hanging in the air for 1-8 s (waveSparks boost 4 / 2.5 / 1); its Consecrated Ground is the holy ground's (below).
  // note: the beams' colour is their vertex colour, not in the files: the ring's
  const CONSEC = { ring: 0xffff8c, spark: 0xffa040 };
  function consecrate(c, R) {
    fx.ring(c, .2, R, CONSEC.ring, .4, { k: 2.4 }); fx.ring(c, .3, R * 1.05, 'holy', 1, { a: .35, y: .1 });
    for (let k = 0; k < 24; k++) { const a = k / 24 * TAU, q = { x: c.x + Math.cos(a) * R, y: 0, z: c.z + Math.sin(a) * R };
      later(k / 24 * .2, () => fx.emit(1, { p: q, r: .05, v: .1, up: 6, life: rnd(.1, .35), size: .25, c: CONSEC.ring, k: 2.4, drag: 1 })); }   // its beams
    fx.emit(30, { p: { x: c.x, y: .6, z: c.z }, r: R * .8, v: .4, up: .2, life: 4, size: .05, c: CONSEC.spark, k: 2.4, drag: 4 });   // its sparks hanging
  }
  // Contagion (chaos_contagion .ao/.pet): a single enemy at the cursor (its description); pale violet wisps from your hand
  // to it (contagionWisps_cast: 12, for 0.75-1.2 s; their texture's violet, the lookup's 0.36 / 0.2 / 1), a dark violet rot on the ground under
  // it from 0.3 s (castGroundRot 0.075 / 0 / 0.35, 2-2.5 s), its skin flashing violet (contagion_skin 0.36 / 0.2 / 1
  // x 0.45) with wisps for 0.88-1.05 s; while it is on, the skin stays violet and wisps ooze from it for 3-4 s
  // (contagionWisps_OOZE). note: with no enemy there it lands at the cursor and afflicts none
  const CONTAGION = { wisp: 0x5c33ff, skin: [.36 * .45, .2 * .45, .45], rot: 0x130059 };
  const wisps = (a, b, n) => { for (let i = 0; i < n; i++) { const t = (i + rnd()) / n, y = a.y + (b.y - a.y) * t;
    later(t * .25, () => fx.emit(1, { p: { x: a.x + (b.x - a.x) * t, y, z: a.z + (b.z - a.z) * t }, r: .1, v: .2, up: .3, life: rnd(.75, 1.2), size: .22, c: CONTAGION.wisp, k: 1.8, drag: 1 })); } };
  const ctFlash = q => fx.glow(q, .9, CONTAGION.wisp, .4, 1.6);
  const rotAt = p => { const m = fx.decal(p, .9, 'patch', CONTAGION.rot, { dark: true, a: .8 }); later(rnd(2, 2.5), () => m.remove()); };
  function contagion(S) {
    const d = near(S.at, SIM.snap), q = d ? chest(d) : V(S.at.x, .3, S.at.z);
    wisps(hand(), q, 12); later(.3, () => rotAt(d ? { ...d.pos } : S.at));
    if (!d) return;
    dot(d, S); d.wob = .5;
    for (const e of nearest(d.pos, S.dmg?.stats?.contagion_number_of_additional_targets || 0, e => e !== d && dist(e.pos, d.pos) <= S.A)) { dot(e, S); wisps(hand(), chest(e), 6); }   // its quality's more targets: the nearest in its area
    later(.25, () => { ctFlash(q); fx.emit(8, { p: q, r: .3, v: .4, up: .5, life: rnd(.88, 1.05), size: .2, c: CONTAGION.wisp, k: 1.8, drag: 1 }); });
  }
  function crystal(S, p, dur, B = S, life = crystalLife(S)) {   // B: the skill its burst is (Grim Pillars' explosion part)
    const full = life;
    const m = new THREE.Mesh(ICE, new THREE.MeshStandardMaterial({ color: 0xbfe8ff, emissive: 0x2a6f9f, roughness: .1, transparent: true, opacity: .85, flatShading: true }));
    m.position.set(p.x, .75, p.z); m.rotation.set(rnd(-.15, .15), rnd(TAU), rnd(-.15, .15)); m.scale.setScalar(.01); m.castShadow = true;
    fx.emit(8, { p: { x: p.x, y: .2, z: p.z }, r: .3, v: 1, up: 2, life: .5, size: .16, c: 'ice' });
    const h = rnd(.8, 1.2);
    const e = thing(m, dur, { r: .4, name: S.name, ice: true,
      tick(dt, e) { const s = ease(Math.min(1, e.s * 5)); m.scale.set(s, s * h, s); },
      touch(by) {   // hit by anything: it bursts, and the burst reaches the next crystals
        // a skill that Consumes Freeze shatters it at once: its more damage and area if Shattered (keywords.json IceCrystals)
        const SH = (by.P?.consumes?.includes('freeze') || by.dmg?.ail?.consume?.freeze) && (B.dmg?.stats || {}), XA = SH ? Math.sqrt(1 + (SH['ice_crystal_shatter_detonation_area_of_effect_+%_final'] || 0) / 100) : 1, XM = SH ? 1 + (SH['ice_crystal_shatter_detonation_damage_+%_final'] || 0) / 100 : 1;
        if (!SH && !by.breaks && life > 0 && (life -= avgHit(by)) > 0) return;   // by.breaks: destroyed outright (Vruun's Aftermath)
        e.dead = true;
        // burst in its first half second it deals its less damage (Frost Wall's own stat, Glacial Bolt's wall part's)
        const EK = 'ice_crystals_damage_+%_final_for_first_500_ms_when_not_killed_by_self', EA = e.s < .5 ? 1 + (S.dmg?.stats?.[EK] ?? Object.values(S.dmg?.parts || {}).find(q => q.stats?.[EK])?.stats[EK] ?? 0) / 100 : 1;
        const VG = by.dmg?.sum?.['support_crystalshatter_buff_damage_%_gained_as_extra_cold_per_2000_crystal_life'];   // Verglas: the destroying skill's cold gain, per 2000 of the crystal's life
        if (VG) (me.verglas ||= {})[by.name] = { pct: VG * Math.floor(full / 2000), until: time + by.dmg.sum.support_crystalshatter_buff_duration / 1000 };
        later(rnd(.04, .14), () => { if (by.src !== 'crystal') say(t('{0}: the ice crystals explode ({1})', S.label, by.label), 'ice'); const IC = S.dmg?.sum?.['ice_crystal_explosion_impale_chance_%'], BD = IC && B.dmg ? { ...B.dmg, ail: { ...B.dmg.ail, impale: { n: 1, mag: 1, ...B.dmg.ail?.impale, chance: (B.dmg.ail?.impale?.chance || 0) + IC } } } : B.dmg; boom(p, B.A * XA, { ...B, dmg: BD, mult: (B.mult || 1) * XM * EA, self: e, src: 'crystal' });   // Crystalline Shards: its chance to Impale
          const X = S.infs?.includes('lightning') && partOf(S, 'FrostWallInfusedPlayer');   // Frost Wall's Lightning Infusion: another explosion
          if (X) boom(p, radOf(X), { ...X, self: e, src: 'crystal' }); });
      },
      end: () => fx.emit(14, { p: { x: p.x, y: .7, z: p.z }, r: .2, h: .6, v: 2, life: .6, size: .14, c: 'ice', g: 9 }) });
  }
  // Tornado's own: up to its limit; it pulls the enemies inside toward its centre (its strength every interval) and deals
  // its damage over time to them while they are in it, with its damage of each absorbed element on top
  // note: an absorbed element's damage per second scales as the skill's physical one does
  // a zone's slow on the enemies standing in it, kept while they stay (one per enemy in its map)
  function standSlow(map, c, R, pct, keep) {
    for (const d of inside(c, R)) { let v = map.get(d); if (!v || !d.slows.includes(v)) { map.set(d, v = { pct }); d.slows.push(v); } v.until = time + keep; }
  }
  // Chayula's Will's wind: its dark core and violet wind (alpha, as smoke), pale violet flames and embers whirling up it,
  // debris and dust pulled in at its foot
  function chayulaWind(L, p, R, s) {
    for (let i = 0; i < 5; i++) {
      const a = s * 9 + i * 1.26 + rnd(.6), h = rnd(3.6), rr = .2 + h * .32 * (R / 3 + .3);
      fx.emit(1, { p: { x: p.x + Math.cos(a) * rr * .6, y: h, z: p.z + Math.sin(a) * rr * .6 }, dir: V(-Math.sin(a) * 2.5, .8, Math.cos(a) * 2.5), life: .6, size: .8 + h * .2, grow: 1.5, c: i < 2 ? L.core : L.wind, smoke: true, a: .75 });
      if (i < 3) fx.emit(1, { p: { x: p.x + Math.cos(a + 1) * rr, y: h, z: p.z + Math.sin(a + 1) * rr }, dir: V(-Math.sin(a + 1) * 4, 1.4, Math.cos(a + 1) * 4), life: .45, size: .32, c: L.flame, c2: L.string, k: 2.2 });
    }
    if (Math.random() < .5) fx.emit(1, { p: { x: p.x, y: rnd(.2, 3), z: p.z }, r: R * .5, up: 2, v: .5, life: .6, size: .08, c: L.flame, c2: 'white', k: 2.4 });
    if (Math.random() < .3) { const a = rnd(TAU); fx.emit(1, { p: { x: p.x + Math.cos(a) * R, y: .1, z: p.z + Math.sin(a) * R }, dir: V(-Math.cos(a) * 3, .8, -Math.sin(a) * 3), life: .45, size: .1, c: 0x3a3030, c2: 'dust', g: 2 }); }
  }
  function vortex(S, c, R, dur, o = {}) {   // Tornado: drifts towards the enemies and takes the element of the ground it crosses
    const g = holder(c), ts = S.dmg?.stats || {}, pull = ts['tornado_pull_strength_%'], DOT = Object.keys(S.dmg?.dot || {}).length > 0; let cur = S, tk = .2, pt = 0;
    limit(x => x.vortex && x.name === S.name, ts.number_of_tornados_allowed ?? ts.base_number_of_tornado_shots_allowed);
    // Tornado Shot's: it stays where it lands and Hinders the enemies standing in it; your arrows, spears and bolts that reach
    // it are sucked in and it spits a ring of copies (its number, range and less damage) that are not copied again, up to
    // its most times
    const cs = o.copy, hold = new Map(), L = o.look, SP = L && fx.decal(c, R * .7, 'rune', L.spiral, { a: .4, spin: -3 });
    const e = thing(g, dur, { name: S.name, vortex: true, R, off: () => SP?.remove(), copy: cs && { left: cs.tornado_shot_number_of_hits_allowed + lasts(S) },
      spit(C, k) {
        const n = cs.base_number_of_projectiles, a0 = rnd(TAU), p = { x: g.position.x, z: g.position.z };
        if (--e.copy.left <= 0) e.dur = e.s;
        for (let i = 0; i < n; i++) { const a = a0 + i * TAU / n; shoot({ ...C, copied: true, mult: C.mult * k * (1 + cs['tornado_shot_projectile_damage_+%_final'] / 100) }, p, Math.sin(a), Math.cos(a), { range: cs.tornado_shot_projectile_range / 10 }); }
      },
      tick(dt, e) {
        const p = g.position, col = cur.el === 'physical' ? 'dust' : cur.el;
        if (L) { SP.move(p); chayulaWind(L, p, R, e.s); } else for (let i = 0; i < 3; i++) {
          const a = e.s * 9 + i * 2.1 + rnd(.6), h = rnd(3.4), rr = .2 + h * .28 * (R / 3 + .3);
          fx.emit(1, { p: { x: p.x + Math.cos(a) * rr, y: h, z: p.z + Math.sin(a) * rr }, dir: V(-Math.sin(a) * 3.5, 1.2, Math.cos(a) * 3.5), life: .45, size: .34, c: col, c2: 'white', k: cur.el === 'physical' ? 1.1 : 2.2 });
        }
        if (cs) standSlow(hold, p, R, -HINDER.slow * slowK(S), .3);
        const d = !o.dir && !cs && near(p, o.seek || 9), v = o.speed || 1.3;
        if (o.dir) { const a = o.dir + Math.sin(e.s * 4.3) * .9; p.x += Math.sin(a) * v * dt; p.z += Math.cos(a) * v * dt; }   // erratically forward (its wander is not in the data)
        else if (d) { const k = dist(d.pos, p); if (k > .3) { p.x += (d.pos.x - p.x) / k * v * dt; p.z += (d.pos.z - p.z) / k * v * dt; } }
        if (S.P.absorbs) { const A = absorb(cur, p, R), TG = ts['twister_gain_%_elemental_damage_of_corresponding_type']; if (A !== cur) cur = TG ? gainAs(cur, A.got, TG) : A; }
        if (pull && (pt -= dt) <= 0) { pt = ts.tornado_pull_interval_ms / 1000; for (const d of inside(p, R)) { d.pos.x += (p.x - d.pos.x) * pull / 100; d.pos.z += (p.z - d.pos.z) * pull / 100; } }
        if (DOT) {
          const ph = ts.base_physical_damage_to_deal_per_minute, scale = ph ? (S.dmg.dot.physical || 0) / (ph / 60) : 1, P = { ...cur.P, dur: .25 };
          for (const d of inside(p, R)) {
            dot(d, { ...cur, P });
            for (const el of cur.els) if (!S.els.includes(el)) dot(d, { ...cur, P, name: cur.name + el, els: [el], dmg: { ...cur.dmg, dot: { [el]: ts.active_skill_base_elemental_damage_to_deal_per_minute / 60 * scale } } });
          }
        }
        if ((tk -= dt) <= 0) { tk = DOT ? .4 : o.every || .4; if (!L) fx.ring(p, R * .3, R, col, .35, { a: .45 }); if (!DOT) area(p, R, { ...cur, self: e }, { mult: o.mult ?? .4 }); }
      } });
  }
  // Landing a jump: Xibaqua's Rending sets off the corpses within its secondary radius (up to its most) after its delay, each
  // for that share of its life as fire in its area; Crater opens its fissures, a hit of its own each (their length and
  // spread the slam's: the data gives none) that last its duration
  function landed(S, c) {
    const HD = S.dmg?.sum?.support_holy_descent_consecrated_ground_on_landing_radius;   // Holy Descent: Consecrated Ground where you land
    if (HD) ground('consecrated', c, HD / 10, S.dmg.sum.support_holy_descent_consecrated_ground_base_duration_ms / 1000, S);
    for (const T of S.dmg?.trig || []) {
      const ts = T.stats || {};
      if (ts.corpse_explosion_monster_life_permillage_fire) {
        const wait = (ts.explosion_delay_ms || 0) / 1000;
        for (const d of corpses(c, ts.active_skill_base_secondary_area_of_effect_radius / 10).slice(0, ts.detonate_on_landing_maximum_number_of_corpses_to_detonate)) {
          const p = { x: d.pos.x, z: d.pos.z }, X = asTrig(S, T, scale(T.hits, d.max * ts.corpse_explosion_monster_life_permillage_fire / 1e5));
          eat(d, 'fire'); fx.telegraph(p, X.A, 'fire', wait); later(wait, () => boom(p, X.A, X));
        }
      }
      const n = T.support?.support_fissure_on_landing_create_X_fissures_on_impact;
      if (n) { const X = asTrig(S, T), a0 = Math.atan2(S.dx, S.dz); say(X.label, X.el); for (let j = 0; j < n; j++) fissure(X, c, a0 + (j - (n - 1) / 2) * .5, 5, X.A, 1, { dur: sh(X).duration || T.stats.base_skill_effect_duration / 1000, max: T.stats.support_fissure_on_landing_maximum_fissure_count }); }
    }
  }
  // o.dur: a fissure that lasts (Crater's), up to o.max of them (the oldest gives way). A Slam that reaches one sets off an
  // Aftershock along it, as keywords.json MoltenFissure has it (the rule the game states for its long-lasting fissures):
  // its damage again to those on it, on to the fissures it crosses, each at most once per 0.2 s
  function fissure(S, from, ang, len, r = .8, mult = .5, o = {}) {
    // more fissures fanned beside the first: Upheaval and Kaom's Madness's additional ones, the tree's chance of another.
    // ponytail: once per use, its fissures within 0.5 s
    const AF = !o.branch && !o.extra && !(time - (S.fissAt ?? -9) < .5) && (S.dmg?.sum?.base_number_of_additional_fissures || 0) + (Math.random() * 100 < (S.dmg?.sum?.['skill_additional_fissure_chance_%'] || 0));
    if (AF) { S.fissAt = time; for (let k = 1; k <= AF; k++) later(.08 * k, () => fissure(S, from, ang + (k % 2 ? 1 : -1) * .5 * Math.ceil(k / 2), len, r, mult, { ...o, extra: true })); }
    const dx = Math.sin(ang), dz = Math.cos(ang), b = { x: from.x + dx * len, z: from.z + dz * len }, seen = new Set();   // each enemy once
    const decal = fx.strip(from, b, .9, 0x070605, o.dur || 4, { dark: true, tex: 'beam', a: .9, y: .033 });
    if (o.dur) {
      const mine = fissures.filter(f => f.S.name === S.name);
      if (mine.length >= o.max + sheet().fissureLimit) { const old = mine[0]; old.decal.t = old.decal.dur; fissures.splice(fissures.indexOf(old), 1); }
      fissures.push({ a: { x: from.x, z: from.z }, b, S, r, mult, decal, end: time + o.dur, next: 0 });
    }
    for (let k = 1; k <= len; k++) later(k * .06, () => {
      const p = { x: from.x + dx * k, z: from.z + dz * k };
      if (o.own) esStep(p, k === 1); else { pop(p, r, S.el); fx.pillar(p, .25, 1.6, S.el, .25, 2.4); }
      for (const d of dummies) if (!d.dead && !seen.has(d) && dist(d.pos, p) <= r + SIM.body) { seen.add(d); hit(d, S, { mult, noPay: true }); }
    });
    // Branching Fissures: its number of secondary fissures off this one, with its less area and damage
    // note: where they branch, their angle and length are not in its data: evenly along it, alternating sides at 45°, half its length
    const BF = !o.branch && S.dmg?.finals, n = BF && S.dmg.sum?.number_of_branching_fissures || 0;
    for (let k = 1; k <= n; k++) { const f = len * k / (n + 1), q = { x: from.x + dx * f, z: from.z + dz * f };
      later(f * .06, () => fissure(S, q, ang + (k % 2 ? 1 : -1) * Math.PI / 4, len / 2, r * Math.sqrt(1 + BF['branching_fissure_area_of_effect_+%_final'] / 100), mult * (1 + BF['branching_fissure_damage_+%_final'] / 100), { branch: true })); }
  }
  const ccw = (p, q, r) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  const crosses = (f, g) => [segDist(g.a, f.a, f.b), segDist(g.b, f.a, f.b), segDist(f.a, g.a, g.b), segDist(f.b, g.a, g.b)].some(k => k < .3)
    || ccw(f.a, f.b, g.a) * ccw(f.a, f.b, g.b) < 0 && ccw(g.a, g.b, f.a) * ccw(g.a, g.b, f.b) < 0;
  function quake(c, R) { for (const f of [...fissures]) if (segDist(c, f.a, f.b) <= R) aftershock(f); }
  function aftershock(f) {
    if (time < f.next || !fissures.includes(f)) return; f.next = time + .2;
    say(t('Aftershock of {0}', f.S.label), f.S.el); fx.strip(f.a, f.b, f.r * 2, f.S.el, .3, { a: .8 });
    for (const d of dummies) if (!d.dead && segDist(d.pos, f.a, f.b) <= f.r + SIM.body) hit(d, f.S, { mult: f.mult, noPay: true });
    for (const g of fissures) if (g !== f && time >= g.next && crosses(f, g)) later(.05, () => aftershock(g));
  }
  // Armour Breaker's look (heavy_strike_02: heavy_strike_SB, SWING_2H, HIT, grdPoof .pet): orange energy shaking on your
  // weapon as you swing (vibrationEnergy 1 / 0.53 / 0.2, its shine 1 / 0.69 / 0.35), an orange arc on the swing
  // (coneImpactSwing 1 / 0.55 / 0.25), and on the hit a flash burst (1 / 0.4 / 0.2), orange spikes shattering out of it
  // (spikeShatter 1 / 0.38 / 0.08), a shockwave ring and a puff of dust blown along the ground
  const BREAK = { energy: 0xff8733, shine: 0xffb059, swing: 0xff8c40, flash: 0xff6633, spike: 0xff6114 };
  function breakLook(d, dx, dz) {
    const H = hand(), q = V(d.pos.x, 1, d.pos.z);
    fx.glow(H, .9, BREAK.energy, .25, 2.2); fx.emit(6, { p: H, r: .08, v: .8, life: .25, size: .07, c: BREAK.shine, k: 2, drag: 2 });
    fx.arc(pp, dx, dz, 2, .95, BREAK.swing);
    fx.glow(q, 1.6, BREAK.flash, .2, 2.4); fx.ring(d.pos, .2, 1.4, BREAK.flash, .3, { a: .7 });
    for (let i = 0; i < 10; i++) { const a = rnd(TAU); fx.streak(q.clone(), V(q.x + Math.cos(a) * 1.2, q.y + rnd(-.4, .6), q.z + Math.sin(a) * 1.2), BREAK.spike, .18, .025, .6); }
    fx.emit(10, { p: { x: d.pos.x, y: .15, z: d.pos.z }, dir: V(dx * 3, .3, dz * 3), r: .3, v: 1.5, life: .7, size: .4, grow: 1.8, c: 'dust', smoke: true, a: .4, drag: 1.5 });
  }
  // (Axe Slash and Dagger Stab, the axes' and daggers' default attacks: none of this, as the game's: its default_attack
  // melee trails are empty and they have none of their own, only the swing or stab and the hit)
  function slash(S, dx, dz, r = 2, half = .95) {
    fx.arc(pp, dx, dz, r, half, S.el); fx.sector(pp, dx, dz, r, half, S.el, .2, { a: .25, grow: true });
    fx.emit(8, { p: { x: pp.x + dx, y: 1.1, z: pp.z + dz }, dir: V(dx * 4, 0, dz * 4), v: 2, life: .25, size: .16, c: S.el, c2: 'white', drag: 2 });
  }

  // ---------- how each kind of skill plays out. S carries the aim: S.from, S.at, S.dx, S.dz.
  // a storm's area and its strikes' radius: the larger and the smaller of its two radii (Firestorm's area is its
  // secondary, Thunderstorm's its main); with one, the scene's area around strikes of that radius
  const stormGeo = S => { const r2 = S.G?.radius2; return r2 ? { Z: Math.max(S.A, r2), R: Math.min(S.A, r2) } : { Z: Math.max(S.A * 2.4, SIM.stormArea), R: S.A }; };
  const K = {
    projectile(S) {
      const X = S.infs?.length && !S.P.explodes && infPart(S, S.infs[0]);   // Spark: many sparks in a circle (its part's number)
      if (X && X.dmg.stats.base_number_of_projectiles) S = { ...X, circle: true };
      { const SS = S.P.spell && !S.src && S.dmg?.sum, WS = SS?.['spell_skill_%_chance_to_fire_8_additional_projectiles_in_nova_per_wildshard_stack'], N = SS && (SS.spell_projectile_skills_fire_X_additional_projectiles_in_a_circle || (Math.random() * 100 < (SS['spell_skill_%_chance_to_fire_8_additional_projectiles_in_nova'] || 0) + (WS ? WS * (me.wildshard || 0) : 0) ? 8 : 0)); if (N) { S = { ...S, circle: true, addProj: (S.addProj || 0) + N }; if (WS) me.wildshard = 0; } }   // Sire of Shards, Seed of Cataclysm: spells' additional projectiles in a circle; Sione's Temper: its chance per Wildshard, all lost on the circle
      const n = S.P.single ? 1 : (sh(S).projectiles || S.P.count || 1) + S.spent * 2 + (S.addProj || 0) + moreProj(S), a0 = Math.atan2(S.dx, S.dz), spread = S.circle ? TAU / n : S.P.wander ? .45 : .13, h = hand();
      for (let i = 0; i < n; i++) { const a = a0 + (i - (n - 1) / 2) * spread; shoot(S, S.from, Math.sin(a), Math.cos(a)); }
      const CB = partOf(S, 'CoilingBoltsChaosPlayer'); if (CB) shoot(CB, S.from, Math.sin(a0 + spread), Math.cos(a0 + spread));   // Coiling Bolts: its Chaos projectile, fired with its Physical one
      if (!['Armour Piercing Rounds', 'Crossbow Shot', 'Bow Shot'].includes(S.name)) fx.glow(h, .9, S.el, .2);   // its own muzzle flash (aprMuzzle, xbMuzzle); Bow Shot's arrow has none (arrow_base)
    },
    chain(S) {
      const d = near(S.at, SIM.snap) || near(S.at, 6, e => dist(e.pos, S.from) <= SIM.castRange), h = hand(), n = (sh(S).chains || 0) + (S.addChains || 0);   // Arc's chains from a Lightning Infusion
      if (d) { chain(h, d, S, n); shockchain(S, d); }
      else { fx.bolt(h, V(S.at.x, .1, S.at.z), S.el, .18); pop(S.at, .6, S.el); touch(S.at, .6, S); }
    },
    rain(S) {
      const P = S.P, c = S.at, R = S.A, h = hand(), FT = S.dmg?.stats?.throw_flask_effects_type;   // a Concoction's flask (4: Acidic's acid)
      // a Concoction's projectiles (Multishot) each a flask of its own, landing apart in a fan as a grenade's (note: the spread is the scene's)
      const fn = FT && !S.one ? sh(S).projectiles || 1 : 1;
      if (fn > 1) { const o = pp, dx = c.x - o.x, dz = c.z - o.z; for (let k = 0; k < fn; k++) { const a = (k - (fn - 1) / 2) * .25, cs = Math.cos(a), sn = Math.sin(a); K.rain({ ...S, one: true, at: { x: o.x + dx * cs + dz * sn, z: o.z + dz * cs - dx * sn } }); } return; }
      const FC = FT === 4 ? 'acid' : FT === 3 ? BLD.flask : S.el;   // Bleeding Concoction (type 3): its red flask
      const shot = land => lob(FT ? fx.flask(FC) : P.attack ? fx.arrow(S.el) : fx.orb(S.el, .13), h, V(c.x, .1, c.z), .42, 3.2, land, FT ? { spin: true, drip: FC } : { trail: S.el });
      // Tornado Shot: its shot's hit (PoB2's main part) and its tornado (its own part) where it lands
      // note: its secondary radius taken as the tornado's
      const TX = partOf(S, 'Tornado');
      if (TX) return shot(() => { boom(c, R, S); vortex(TX, c, radOf(TX), durOf(TX), { copy: TX.dmg.stats }); });
      if (P.object) return shot(() => rod(S, c));
      // Electrocuting Arrow: its arrow flies low at its speed, blue with lightning behind it, and explodes as its own (eaBlast)
      if (S.name === 'Electrocuting Arrow') {
        const l = Math.max(.1, dist(h, c)), ux = (c.x - h.x) / l, uz = (c.z - h.z) / l, m = fx.arrow(EAR.glow);
        return lob(m, h, V(c.x, .6, c.z), l / ((S.G?.speed || SIM.projSpeed) * (S.dmg?.projSpeed || 1)), .3, () => { eaBlast(c, R); area(c, R, S); }, { aim: true,
          each: dt => { if (Math.random() < dt * 30) { const k = rnd(.5, 1.2); fx.bolt(V(m.position.x - ux * k, m.position.y + rnd(-.1, .1), m.position.z - uz * k), m.position.clone(), EAR.bolt, rnd(.18, .32), .02, .15); } } });
      }
      // Escape Shot: you leap back from your aim its arrow's distance, and the arrow hits where you stood (its area, its
      // Chill and Freeze), its Ice Fragments scattering on from there (iceFrags)
      if (P.jump) {
        const o = { x: pp.x, z: pp.z }, l = (S.dmg?.stats?.projectile_distance_override || 20) / 10;
        move = { from: o, to: { x: o.x - S.dx * l, z: o.z - S.dz * l }, k: 0, dur: .3, h: 1, S, seen: new Set() };
        return later(.15, () => lob(fx.arrow(S.el), hand(), V(o.x, .1, o.z), .2, 1, () => { boom(o, R, S); if (S.icetip) iceFrags(S.icetip, o, Math.atan2(S.dx, S.dz)); }, { trail: S.el }));
      }
      if (P.detonates && P.plant) return shot(() => pustules(S, c));
      if (P.detonates) {   // pods that burst after a moment (or at once when a detonator reaches them)
        return shot(() => {
          for (let i = 0; i < 3; i++) {
            const a = rnd(TAU), r = i ? rnd(.6, 1.6) : 0, p = { x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r }, m = fx.orb(S.el, .16); m.position.set(p.x, .2, p.z);
            const e = thing(m, (sh(S).detonate || SIM.fuse) + i * .15, { r: .3, name: S.name,
              tick(dt, e) { m.userData.core.scale.setScalar(.16 * (1 + e.s / e.dur)); },
              touch(by) { if (!S.dmg?.sum?.skill_grenade_detonate_only_at_end_of_duration && (by.P.detonator || by.els.includes('fire'))) e.s = e.dur; },   // Long Fuse: only at the end of its time
              end: e => boom(p, R, { ...S, self: e }) });
          }
        });
      }
      if (P.rainy && S.R >= 1.5) {   // a volley goes up and comes down over the whole area
        fx.streak(h, V(h.x + S.dx * 2, 15, h.z + S.dz * 2), S.el, .25, .04, 2); fx.telegraph(c, R, S.el, .5);
        // Rain of Arrows: its arrows (more per frenzy charge spent by its multiplier), its delay between them and the
        // radius of each, each a hit of its own; else the scene's volley
        // one rain at a time (its own limit): a new one ends the arrows the last has left to fall
        const rs = S.dmg?.stats || {}, RA = rs.rain_of_arrows_delay_per_arrow, ar = RA ? radOf(S) : .75, id = {};
        if (rs.base_number_of_arrow_rains_allowed === 1) rains[S.name] = id;
        const n = RA ? Math.round((sh(S).projectiles || rs.base_number_of_projectiles) * (1 + S.spent * rs.rain_of_arrows_projectile_count_multiplier_per_frenzy_charge / 100)) : 22 + S.spent * 8;
        for (let i = 0; i < n; i++) later(.42 + i * (RA ? RA / 1000 : .034), () => {
          if (rains[S.name] && rains[S.name] !== id) return;
          const a = rnd(TAU), r = Math.sqrt(rnd()) * R, q = { x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r };
          const fall = .13 / (1 + (rs['rain_of_arrows_arrow_speed_+%'] || 0) / 100);   // its quality: arrows fall faster
          fx.streak(V(q.x + 1.5, 12, q.z - 1), V(q.x, 0, q.z), S.el, fall, .025, 1.6);
          later(fall, () => { fx.ring(q, .1, ar, S.el, .25, { a: .3 }); fx.stuck(q, S.el); area(q, ar, S, { mult: RA ? 1 : .5, noTouch: i % 4 > 0 }); });   // arrows left stuck in the ground
        });
        return;
      }
      shot(() => {
        if (FT > 2) shake = Math.max(shake, Math.min(.5, R * .09));   // Bleeding's and Acidic's own bursts (the others' is boom's)
        if (FT === 4) { fx.acid(c, R); area(c, R, S); return acidBurst(S, c, R); }
        if (FT === 3) { bloodBurst(c, R); return area(c, R, S); }
        if (P.plant && P.dur) return K.zone({ ...S, at: c });
        boom(c, R, S); if (P.ground) ground(P.ground, c, R, P.dur, S);
        // Explosive Concoction: its smaller flasks (its part, its number) thrown at the Ignited enemies nearest the explosion
        // note: how near is not in the data: the scene's projectile range
        const EC = partOf(S, 'ExplosiveConcoctionSecondPlayer');
        if (EC) later(.05, () => { for (const d of nearest(c, EC.dmg.stats.explosive_concoction_number_of_secondary_projectiles, e => e.st.ignite > 0 && dist(e.pos, c) <= SIM.projRange)) {
          const q = { x: d.pos.x, z: d.pos.z }; lob(fx.orb(EC.el, .09), V(c.x, .6, c.z), V(q.x, .1, q.z), .35, 1.6, () => boom(q, EC.A, EC), { trail: EC.el });
        } });
      });
    },
    grenade(S) {
      // its projectiles land apart in a fan (note: the spread is the scene's projectiles'), one more in Explosive Fervour
      const n = S.one ? 1 : (sh(S).projectiles || 1) + (time < me.fervour ? 1 : 0), o = S.origin || pp, dx = S.at.x - o.x, dz = S.at.z - o.z;
      if (n > 1) { for (let k = 0; k < n; k++) { const a = (k - (n - 1) / 2) * .13, cs = Math.cos(a), sn = Math.sin(a); K.grenade({ ...S, one: true, at: { x: o.x + dx * cs + dz * sn, z: o.z + dz * cs - dx * sn } }); } return; }
      const P = S.P, c = S.at;
      const CL = partOf(S, 'ClusterGrenadeMiniPlayer');
      lob(CL ? clusterShell(.11) : fx.orb(S.el, .11), S.origin ? V(S.origin.x, 1.5, S.origin.z) : hand(), V(c.x, .15, c.z), .55, 2.6, () => {
        if (P.ground === 'oil' || P.ground === 'gas') {   // bursts where it lands and leaves its ground: no fuse
          fx.explode(c, S.A, S.el, { soft: true });
          for (const d of inside(c, S.A)) { if (P.ground === 'oil') expo(d, ELEM, expoMag(S)); else inflict(d, 'poison', S); d.wob = .6; }
          ground(P.ground, c, S.A, P.dur, S);
          return;
        }
        const m = CL ? clusterShell(.12) : fx.orb(S.el, .12); m.position.set(c.x, .15, c.z);
        const blow = (e, again) => {
          if (!again && Math.random() * 100 < (S.dmg?.sum?.['grenade_skill_%_chance_to_explode_twice'] || 0)) later(.3, () => blow(e, true));   // the tree's second activation
          const X = { ...S, self: e };
          if (CL) { clusterMain(c, S.A); area(c, S.A, X); clusterMinis(S, CL, c, e); } else boom(c, S.A, X);
        };
        thing(m, time < me.fervour ? .05 : sh(S).detonate || (/Flash/.test(S.name) ? .7 : SIM.fuse), { r: .25, name: S.name,   // (Explosive Fervour: it explodes where it lands)
          tick(dt, e) { if (CL) return clusterFuse(m, dt); m.userData.glow.scale.setScalar(.7 + Math.sin(e.s * (6 + e.s * 9)) ** 2 * 1.3); },
          touch(by) { if (by.P.detonator && !this.dead) { this.dead = true; say(t('{0} detonates {1}', by.label, S.label), 'fire'); later(.06, () => blow(this)); } },
          end: e => blow(e) });
      }, { spin: true, trail: CL ? CGR.ember : S.el });
    },
    orb(S) {
      const P = S.P, c = S.at, R = S.A, dur = P.detonates ? sh(S).detonate || SIM.orbFuse : P.dur || SIM.lifetime;
      // one at a time (Frost Bomb: its limit); Frost Bomb's exposure grows each pulse (its compounding magnitude) up to its cap
      const st = S.dmg?.stats || {}, cmp = st.active_skill_all_elemental_exposure_compounding_magnitude, eff = S.dmg?.ail?.expo.effect ?? 1;
      limit(o => o.orbOf === S.name, st.base_maximum_number_of_frost_bombs || st.orb_of_storms_base_maximum_number_of_orbs || st.solar_orb_base_maximum_number_of_orbs || 1, S);   // Frost Bomb, Orb of Storms, Solar Orb: their most
      const m = fx.orb(S.el, .3), range = fx.decal(c, R, 'outline', S.el, { a: .35, rot: 0 }); m.position.set(c.x, 1.3, c.z);
      fx.ring(c, .2, 1.4, S.el, .4);
      let tk = .4;
      const e = thing(m, dur, { r: R, orbOf: S.name, name: S.name, bolts: 0,
        tick(dt, e) {
          m.position.y = 1.3 + Math.sin(e.s * 3) * .08; if (P.detonates) m.userData.core.scale.setScalar(.3 * (1 + e.s / dur * .7));
          if ((tk -= dt) > 0) return;
          if (P.detonates) { tk = .6; fx.ring(c, .3, R, S.el, .5, { a: .55 }); for (const d of inside(c, R)) { if (!(d.level > st.frost_bomb_exposure_does_not_apply_to_enemies_of_level_higher_than_X)) expo(d, ELEM, cmp && d.st.expo > 0 && d.expo ? Math.min(st.active_skill_all_elemental_exposure_compounding_magnitude_cap * eff, d.expo.mag + cmp * eff) : expoMag(S)); inflict(d, 'chill', S); } }   // pulses of exposure, then the blast
          else if (P.chains) { tk = sh(S).bolts || .9; e.zap(); }
          else { tk = (st.solar_orb_base_pulse_frequency_ms || 1000) / 1000; fx.ring(c, .3, R, S.el, .5); area(c, R, { ...S, self: e, src: 'orb' }, { mult: st.solar_orb_base_pulse_frequency_ms ? 1 : .5 }); }   // Solar Orb: its whole hit every its pulse interval
        },
        end: e => { if (P.detonates) boom(c, R, { ...S, self: e }); },
        off: () => { range.remove(); if (P.leaves) infRemnant(P.leaves, c); } });   // Frost Bomb's, Orb of Storms' Infusion
      if (P.chains) e.zap = extra => {
        const d = near(c, R); if (!d) return;
        if (extra) say(t('{0} fires an extra bolt', S.label), S.el);
        chain(V(c.x, m.position.y, c.z), d, { ...S, self: e, src: 'orb' }, sh(S).chains ?? 2);
        if (++e.bolts >= (sh(S).maxBolts || Infinity)) e.dead = true;   // "Orb expires after firing 6 bolts"
      };
    },
    wall(S) {
      const P = S.P, c = S.at, L = (sh(S).wall || SIM.wall) / 2, px = -S.dz, pz = S.dx, dur = P.dur || SIM.lifetime;   // across the aim
      const a = { x: c.x - px * L, z: c.z - pz * L }, b = { x: c.x + px * L, z: c.z + pz * L };
      if (P.crystal) {
        // Creeping Chill: the cast consumes its power charges if it can for Chilled Ground around each crystal, its area
        // growing by its share a second up to its most (area: the radius by its square root); its chill the scene's ground's
        const T = S.dmg?.trig?.find(T => T.stats?.['support_creeping_chill_cold_damage_equal_to_%_ice_crystal_maximum_life']), need = T?.support.support_creeping_chill_consume_X_power_charges_to_trigger_on_ice_crystals || 1;
        const X = T && charges.power >= need && (charges.power -= need, chargesSpent(need, 'power'), asTrig(S, T));
        if (X) say(X.label, X.el);
        for (let i = 0; i < 6; i++) { const k = i / 5, p = { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k }; later(i * .04, () => { crystal(S, p, dur); if (X) ground('chilled', p, X.A, 0, X, { per: X.dmg.stats['active_skill_ground_effect_area_of_effect_+%_final_per_second'], max: X.dmg.stats['active_skill_ground_effect_area_of_effect_+%_final_per_second_max'] }); }); }
        for (const d of dummies) if (!d.dead && segDist(d.pos, a, b) <= .7 + SIM.body) hit(d, S);
        return;
      }
      const fire = S.els.includes('fire'); let tk = 0;
      if (P.earthen) { fx.strip(a, b, 1.2, S.el, dur, { a: .6 }); return shieldWall(S, a, b, c, dur); }
      // its own limit (Flame Wall's 3); a wall with damage over time burns those in it (its damage per second), else hits
      limit(o => o.wall && o.name === S.name, S.dmg?.stats?.number_of_allowed_firewalls, S);
      // Voltaic Barrier: its own limit, its hits every its interval (not the scene's lesser ones), and it energises the
      // projectiles fired through it (discharge)
      const VS = S.dmg?.stats?.voltaic_barrier_damage_interval_ms, volt = VS && partOf(S, 'VoltaicBarrierTriggeredChainLightningPlayer');
      if (VS) limit(o => o.wall && o.name === S.name, S.dmg.stats.voltaic_barrier_active_actions_limit, S);
      const strip = fx.strip(a, b, 1.2, S.el, dur, { a: .6 }), burns = Object.keys(S.dmg?.dot || {}).length > 0;
      thing(holder(c), dur, { wall: true, fire, volt, a, b, name: S.name, label: S.label, S,
        tick(dt, e) {
          for (let i = Math.ceil(dt * (fire ? 40 * L : 100)); i > 0; i--) { const k = rnd(); fx.emit(1, { p: { x: a.x + (b.x - a.x) * k, y: .05, z: a.z + (b.z - a.z) * k }, v: .3, up: fire ? 1.8 : 2.2, life: fire ? .8 : .6, size: fire ? .8 : .5, grow: fire ? .4 : .2, k: fire ? 1.6 : undefined, c: S.el, c2: fire ? 'ember' : 'white', drag: .5 }); }   // fire: a dense curtain, as Flame Wall's
          if ((tk -= dt) > 0) return; tk = burns ? .2 : VS ? VS / 1000 : .5;
          for (const d of dummies) if (!d.dead && segDist(d.pos, a, b) <= .7 + SIM.body) burns ? dot(d, { ...S, P: { ...S.P, dur: .3 } }) : hit(d, { ...S, self: e }, { mult: VS ? 1 : .3, noPay: true });
        }, off: () => { strip.dur = Math.min(strip.dur, strip.t); } });   // a wall over the limit goes
    },
    curse(S) {
      const c = S.at, R = S.A;
      const wait = sheet().noCurseDelay ? 0 : sh(S).curseDelay || SIM.curseDelay;
      const L = CURSE_LOOK[S.name];
      if (L) hexArea(L, c, R, wait); else fx.telegraph(c, R, 'curse', wait);
      later(wait, () => {
        if (!L) { fx.disc(c, R, 'curse', .7, { tex: 'rune', a: .8, spin: 1 }); fx.ring(c, R * .3, R, 'curse', .5); }
        const C = S.dmg?.curse; let n = 0;
        const curseOn = (d, quiet) => {
          if (d.noRepulse > time && S.name === 'Repulsion') return;
          if (C?.maxLevel && d.level > C.maxLevel) { if (!quiet) say(t('{0} cannot curse enemies above level {1}', S.label, C.maxLevel), 'curse'); return; }
          n++;
          const s = sheet().curseForever ? Infinity : (sh(S).duration || SIM.curseTime) * (S.curseX || 1);   // Lich: curses never expire
          hexOld(d, S.name, S.dmg?.sum?.curse_ignores_curse_limit);
          if (sheet().cursed?.hinder) d.slows.push({ until: time + s, pct: -sheet().cursed.hinder * slowK(S) });   // the tree's: Hindered while cursed
          d.curse = { s, full: s, label: S.label, name: S.name, S, C, k: (C?.effect ?? 1) * d.stat.curseEffect * (1 + (sheet().coil?.zero || 0) / 100) }; hexMe(S.name, C, s); trigger(S, 'curse', d); if (L) { const q = { x: d.pos.x, y: 2.05 * d.sc + .9, z: d.pos.z }; fx.ball(q, .2, L.orb, 2, .5); fx.glow(q, .9, L.glow ?? L.orb, .35, 2.4); } else fx.emit(6, { p: chest(d), r: .3, v: .4, up: -1, life: .6, size: .2, c: 'curse' });
        };
        inside(c, R).forEach(d => curseOn(d));
        if (n) say(t('{0}: {1} enemies cursed', S.label, n), 'curse');
        if (S.dmg?.sum?.max_toads_per_doedre_cursed_ground) doedre(S, c, R, curseOn);
        // Burning Inscription: the curse's Runic Inscription, as it expires, leaves Ignited Ground (its area and time),
        // igniting by a base of that share of your maximum mana through the build's modifiers
        const T = S.dmg?.trig?.find(T => T.stats?.['support_burning_runes_base_fire_damage_equal_to_%_maximum_mana']);
        if (T) { const X = asTrig(S, T, scale(T.hits, me.maxM * T.stats['support_burning_runes_base_fire_damage_equal_to_%_maximum_mana'] / 1e4)); X.raw = Object.fromEntries(Object.entries(X.dmg.hits).map(([e, [lo, hi]]) => [e, (lo + hi) / 2])); say(X.label, X.el); ground('burning', c, X.A, sh(X).duration || T.stats.base_skill_effect_duration / 1000, X); }
      });
    },
    mark(S) {
      const d = near(S.at, SIM.snap); if (!d) return toast(t('No enemy at the cursor'));
      for (const e of dummies) if (e.mark && !e.mark.S.called) e.mark = null;   // one mark at a time (besides Called Shots')
      markOn(d, S); say(t('{0} marks the target', S.label), 'mark');
    },
    warcry(S) {
      const CY = sheet().cry || {}; if (CY.noIgnite) { me.st.ignite = 0; delete me.burn.ignite; }   // the tree's: a warcry removes your Ignite
      const CH = !S.echoK && sheet().cryHeal; if (CH) { me.life = Math.min(me.maxL, me.life + me.maxL * CH / 100); me.mana = Math.min(me.maxM, me.mana + me.maxM * CH / 100); }   // Urgent Call
      if (S.name === 'Lunar Blessing') return lunar(S);
      // Echoing Cry: it Echoes its times after its delay, its area larger each time (its description: "grows larger")
      const ES = !S.echoK && S.dmg?.sum || {}, EN = ES.base_warcry_echo_X_times;
      for (let k = 1; k <= (EN || 0); k++) later(k * ES.warcry_echo_delay_ms_from_support / 1000, () => K.warcry({ ...S, echoK: k, from: { x: pp.x, z: pp.z }, A: S.A * Math.sqrt(1 + (ES['warcry_echo_area_of_effect_+%_final_per_repeat'] || 0) * k / 100) }));
      const c = S.from, R = S.A, col = S.P.els.length ? S.el : 'gold';
      // Warcaller's Bellow: the corpses in its area explode for their share of their life as physical damage. note: the
      // explosion's area is not in the data: the scene's
      const BC = !S.echoK && sheet().bellow.corpse;
      if (BC) for (const d of corpses(c, R)) { const p = { x: d.pos.x, z: d.pos.z }, x = d.max * BC / 100; eat(d, 'blood'); boom(p, SIM.area, { ...S, dmg: { ...S.dmg, hits: { physical: [x, x] }, trig: [] }, els: ['physical'], el: 'physical', mult: 1, src: 'trigger' }); }
      if (S.name === 'Arctic Howl') howlLook(c, R);
      else { fx.ring(c, .5, R, col, .55, { k: 2.8 }); fx.ring(c, .3, R * .7, 'white', .4, { a: .5 }); fx.emit(40, { p: { x: c.x, y: .3, z: c.z }, v: R * 2, flat: true, life: .4, size: .2, c: col, c2: 'white', drag: 1.5 }); }
      shake = Math.max(shake, .22);
      const list = inside(c, R);
      for (const o of [...objs]) if (o.earth && o.shatter && !o.dead && !o.segs && o.near(c) <= R) o.shatter('warcry');   // earthen objects near it
      // Vruun's Aftermath: it destroys the Ice Crystals and Ice Fragments in its area; five or more, and it Empowers its additional attacks
      const VR = S.dmg?.sum?.support_warcries_empower_x_additional_per_5_total_ice_crystals_or_fragments_destroyed; let gone = 0;
      if (VR) { for (const o of [...objs]) if (o.ice && !o.dead && dist(o.pos, c) <= R) { o.touch({ ...S, breaks: true }); gone++; } for (const F of [...frags]) if (dist(F.p, c) <= R) { F.off(); gone++; } }
      // a damaging Warcry hits (Seismic Cry, Arctic Howl); Seismic Cry Heavy Stuns the enemies Primed for Stun and Arctic
      // Howl Freezes those Primed for Freeze (their descriptions; keywords.json PrimedStun)
      const real = Object.keys(S.dmg?.hits || {}).length > 0, PR = { 'Seismic Cry': 'stun', 'Arctic Howl': 'freeze' }[S.name];
      for (const d of list) { d.wob = 1; if (real) hit(d, S);   // one that does not hit inflicts no ailment (Ancestral Cry's fire: none)
        if (PR && !d.dead && (d.bar[PR] || 0) >= PRIMED[d.stat.rarity]) { d.bar[PR] = 0; if (PR === 'stun') d.lock.stun = GC.HeavyStunModifierDuration; inflict(d, PR, S, 1, null, { dur: DUR[PR] }); }
        trigger(S, 'warcry', d); daze(d, S.dmg.sum?.support_dazed_cry_duration_ms / 1000); if (CY.debil) d.debil = time + DEBIL.time; if (CY.weak) weaken(d, CY.weak); }   // Dazing Cry; the tree's Debilitate and Critical Weakness
      // the attacks it Empowers: one per its Power of the enemies in its area, up to its cap (else the scene's 2); a Slam
      // performs Seismic Cry's additional Aftershocks
      const ws = S.dmg?.stats || {}, per = ws.warcry_empowers_per_X_monster_power, pw = Math.max(CY.min || 0, list.reduce((n, d) => n + pow(d), 0) * (1 + (S.dmg?.finals?.['support_echoing_cry_warcry_monster_power_+%_final'] || 0) / 100) * (1 + (S.dmg?.sum?.['warcry_monster_power_+%'] || 0) / 100)), mp = Math.min(ws.warcry_empowers_per_X_monster_power_mp_cap, pw), FG = ws.shielding_cry_grant_X_guard_per_5_mp, uses = (per ? Math.floor(mp / per) : 2) + (CY.more || 0) + (Math.random() * 100 < (S.dmg?.sum?.['chance_to_gain_3_additional_exerted_attacks_%'] || 0) ? 3 : 0) + (gone >= 5 ? VR : 0);
      // Arctic Howl: its Empowered attacks gain its cold damage per 5 Power (up to its cap) instead, a Slam leaving Chilled
      // Ground for its secondary duration
      // note: that added damage as the gem gives it, without your modifiers
      const wc = ws.wolf_warcry_empowered_attack_cold_damage_min_per_5_power_up_to_cap, k5 = wc && Math.floor(mp / 5), IC = ws['infernal_cry_exerted_attack_all_damage_%_to_gain_as_fire_%'];
      gainRage(Math.floor(pw / 5) * S.dmg?.sum?.warcry_grant_X_rage_per_5_power);   // Raging Cry: its Rage per 5 Power of the enemies in its area
      // Ferocious Roar: its Rage per Power of the enemies in its area (centirage); its Empowered attacks Break its Armour
      const FR = ws.warcry_grant_break_X_armour_on_hit; gainRage(pw * (ws.bear_warcry_gain_X_centirage_per_enemy_power || 0) / 100);
      if (FR && uses) { empower = empower.filter(e => e.type !== 'break'); empower.push({ type: 'break', label: S.label, name: S.name, uses, s: 12, n: FR }); say(`${S.label} ×${uses}`, 'dust'); }
      else if (wc && uses) { empower = empower.filter(e => e.type !== 'cold'); empower.push({ type: 'cold', label: S.label, name: S.name, uses, keep: ws._mods?.['chance_for_exerted_attacks_to_not_reduce_count_%'], s: 12, add: [wc * k5, ws.wolf_warcry_empowered_attack_cold_damage_max_per_5_power_up_to_cap * k5], chill: (ws.base_secondary_skill_effect_duration || 0) / 1000 }); say(t('{0} gains {1} from {2}', t('Attack'), t('Cold'), S.label) + ` ×${uses}`, 'cold'); }
      // Infernal Cry: its Empowered melee attacks gain its share of all their damage as fire
      else if (IC && uses) { empower = empower.filter(e => e.type !== 'fire'); empower.push({ type: 'fire', label: S.label, name: S.name, uses, s: durOf(S), pct: IC }); say(t('{0} gains {1} from {2}', t('Attack'), t('Fire'), S.label) + ` ×${uses}`, 'fire'); }
      else if (S.P.empowers && uses && !FG && !S.dmg?.stats?.ancestral_cry_triggers_shockwave_every_X_units_travelled) {   /* Ancestral Cry boosts through Kaom (below) */ empower = empower.filter(e => e.type !== 'echo'); empower.push({ type: 'echo', label: S.label, name: S.name, uses, s: 12, slam: ws.seismic_cry_slam_skill_additional_aftershocks || 0, slamX: 1 + (ws['seismic_cry_slam_skill_aftershock_damage_+%_final'] || 0) / 100 }); say(t('{0}: your next melee attacks repeat as an aftershock', S.label) + ` ×${uses}`, 'gold'); }
      // Fortifying Cry: its Guard per 5 Power of the enemies in its area (up to its cap); its Empowered melee attacks (one
      // per its Power, up to its cap) trigger its Shield Wave where they land. note: any melee attack, not only shield ones
      if (FG) {
        const g = FG * Math.floor(Math.min(pw, ws.shielding_cry_grant_X_guard_per_5_mp_mp_cap) / 5) * (1 + (ws['fortifying_cry_guard_gained_+%_final'] || 0) / 100), n = Math.floor(Math.min(pw, ws.shielding_cry_an_additional_empowered_attack_per_X_mp_mp_cap) / ws.shielding_cry_an_additional_empowered_attack_per_X_mp);
        guardFor(g, durOf(S));
        if (n) { empower = empower.filter(e => e.type !== 'wave'); empower.push({ type: 'wave', label: S.label, name: S.name, uses: n, s: durOf(S), X: { ...partOf(S, 'FortifyingCryShockwavePlayer'), mult: S.mult } }); }
      }
      if (S.P.gain && list.length) chargeBy(S.P.gain, S);
      // Ancestral Cry: you embody Kaom for its duration (its more per endurance charge, which it removes): Volcanic Steps
      // every so far you travel (its shockwave), your melee Strikes and Slams Ancestrally Boosted, a Strike triggering
      // Volcanic Eruption (its projectile part)
      const st = S.dmg?.stats || {}, every = st.ancestral_cry_triggers_shockwave_every_X_units_travelled;
      if (every) {
        const n = charges.endurance; charges.endurance = 0; chargesSpent(n, 'endurance');
        me.kaom = { S, walked: 0, every: every / 10, more: st.ancestral_cry_empowered_attacks_strike_X_additional_enemies || 0, X: partOf(S, 'AncestralCryProjectilePlayer'),
          until: time + durOf(S) * (1 + (st['ancestral_cry_duration_+%_final_per_removable_endurance_charge'] || 0) * n / 100) };
        setBuff({ label: S.label, name: S.name, c: css('fire'), s: me.kaom.until - time });
        // its look (ancestral_cry.ao: fire_flare, energy_streak and karui_sigil .mat's red-orange): a flare on you, streaks of
        // fire bursting out and Karui sigils rising in a ring around you (ancestral_runes_circle.pet: 1.2 s)
        fx.glow({ x: pp.x, y: 1.2, z: pp.z }, 2.4, KAOM_GLOW, .45, 3);
        fx.emit(40, { p: { x: pp.x, y: 1, z: pp.z }, r: .2, v: R * 3, flat: true, life: .35, size: .35, grow: 2, c: 'fire', c2: 'white', k: 2, drag: 1 });
        for (let k = 0; k < 16; k++) { const a = k / 16 * TAU; fx.emit(3, { p: { x: pp.x + Math.cos(a) * 1.3, y: .1, z: pp.z + Math.sin(a) * 1.3 }, r: .1, up: 2.2, v: .2, life: 1.2, size: .4, c: 'fire', c2: 'ember', k: 2.4, drag: .5 }); }
      }
    },
    toggle(S) {   // heralds, persistent buffs, meta gems, minions and manual auras stay on until used again
      const k = S.name;
      if (tog[k]?.cap) return invoke(tog[k]);   // an Invocation: used, it spends its energy
      if (tog[k] && k === 'Plague Bearer') return plague(S);   // Plague Bearer: used, it unleashes
      if (tog[k] && k === 'Grim Feast') return grim(S);   // Grim Feast: used, Grim Resurrection
      if (tog[k] && k === 'Convalescence') return convalesce(S);   // Convalescence: used, its Recharge and Buff
      if (tog[k] && k === 'Rhoa Mount') return mount(S);   // Rhoa Mount: used again, you mount or dismount it
      if (tog[k] && k === 'Savage Fury' && me.wild > 0) return frenzy(S);   // Savage Fury: used with Fury, its frenzy
      if (tog[k]) { untoggle(k); say(t('{0} off', S.label), 'dust'); return; }
      const T = tog[k] = { name: k, kind: S.kind, P: S.P, g: S.g, label: S.label, el: S.el, energy: 0, need: 0, E: {}, N: {}, last: -9, R: 0, objs: [] };
      if (S.kind === 'meta') {
        T.wants = metaWants(S.P); T.need = T.wants[0] === 'hit' ? SIM.energy * 3 : SIM.energy;
        const st = gst(S), su = S.dmg?.sum || {}, per = Object.fromEntries(Object.entries(st).flatMap(([k, v]) => { const m = k.match(/_gain_X_centienergy(?:_per_monster_power)?_on_(\w+)$/); return m ? [[m[1], v]] : []; }));
        // those whose gain is not per Power (their texts): Cast on Dodge per metre rolled, Spellslinger per 0.1 s of the base
        // cast time of the spells you cast, Cast on Charm Use per charge used, Barrier Invocation 1 per its energy shield lost to
        // an enemy's hit, Cast on Minion Death 50 by the minion's Power (note: its Power is not in the data: 1)
        for (const [ev, v] of [['dodge', st.cast_on_dodge_roll_gain_X_centienergy_per_unit_travelled_while_dodge_rolling], ['cast', st.spellslinger_invocation_gain_X_centienergy_per_10ms_base_cast_time * 10], ['charm', st.cast_on_using_charm_gain_X_centienergy_per_charm_charge_used_on_using_charm],
          ['eshit', 100 / st.barrier_invocation_gain_1_energy_per_X_energy_shield_damage_taken_when_hit], ['miniondeath', 1e4 / st['cast_on_minion_death_gain_1_energy_per_X_minion_relative_defensiveness_%']]]) if (v) per[ev] = v;
        if (st['support_randomise_higher_damage_+%_final'] != null) T.rand = st;
        if (Object.keys(per).length || st.feral_invocation_gain_1_energy_per_X_mana_spent) Object.assign(T, { per, perMs: st.generic_ongoing_trigger_1_maximum_energy_per_Xms_total_cast_time || 10, more: (1 + ((S.dmg?.stats?.['energy_generated_+%'] || 0) + (su['energy_generated_+%'] || 0)) / 100) * (1 + (st['ascendancy_energy_generated_+%_final'] || 0) / 100) * (sheet().energyX2 ? 2 : 1),   /* Invoker: more */ cap: (st.generic_ongoing_trigger_maximum_energy || 0) * (1 + ((sheet().invokeMax || 0) + (su['skill_maximum_energy_+%'] || 0)) / 100), manaPer: st.feral_invocation_gain_1_energy_per_X_mana_spent });
        if (per.hit && st.cast_lightning_spell_on_hit_gain_X_centienergy_per_monster_power_on_hit) { per.melee_hit = per.hit; delete per.hit; }   // Thundergod's Wrath: on Melee Hit (its text)
        if (T.per) gainEnergy(T, 0);   // its maximum from the start (the buff shows its Energy as a % of it)
      }
      else if (S.kind === 'minion' && !S.dmg?.stats?.skill_raging_spirits_max_per_action && !S.dmg?.stats?.max_azmerian_swarms && !S.dmg?.stats?.maximum_corpse_beetles_allowed && !S.dmg?.stats?.base_number_of_verisium_runes_allowed) for (let i = 0; i < (k === 'Rhoa Mount' || k === 'Spectre: {0}' || S.dmg.cmd ? 1 : S.dmg.stats?.skill_wolf_pack_size || S.dmg.stats?.skill_hyena_cackle_size || S.dmg.stats?.skill_desired_amount_override || 2); i++) T.objs.push(minion(S, { x: pp.x + rnd(-1.5, 1.5), z: pp.z + rnd(-1.5, 1.5) }, Infinity, k === 'Azmerian Wolf' ? { look: wolfLook() } : k === 'Wolf Pack' ? { look: wolfLook(WOLFC, 1.2, wolfIn) } : k === 'Cackling Companions' ? { look: hyenaLook(S) } : {}));
      // (Alchemist's Boon, Align Fate: nothing on you while they are on, as the game's: only what they do, fx.boon, visage)
      else if (S.kind === 'herald') T.decal = fx.decal(pp, .9, 'rune', S.el, { a: .7, spin: 1.5 });
      else if (!NOMARK.has(k)) { T.R = S.kind === 'field' ? S.A : S.R; T.decal = fx.decal(pp, T.R || 1.1, T.R ? 'outline' : 'ring', S.el, { a: .45, rot: 0 }); }
      if (SILENT.has(k)) return;   // always on while equipped, nothing of them seen on you (the wolf: its own summoning, wolfLook; Barkskin: its bark, Berserk: its Rage, kaomLook)
      if (k === 'Blasphemy') { const d = fx.decal(pp, Math.max(S.A, 1.5), artTex('blasSymbol', 'particles/supports/blasphemy/textures/blasphemy_bc1'), 0x1f2bff, { a: .9, k: 1.8, spin: .8 }); later(.8, () => d.remove()); fx.pillar(pp, .6, 2.6, 0x1f2bff, .5, 2); }   // its symbol (BLAS)
      else if (CAST_ON[k] || ACTIVATE[k]) metaOn(k);
      else { fx.ring(pp, .3, 2, S.el, .5); fx.pillar(pp, .5, 2.6, S.el, .35, 2); }
      say(t('{0} on', S.label), S.el);
    },
    // Raise Zombie: for its duration, up to its limit; without a corpse it consumes a Power Charge for an Empowered Zombie
    // (its more hit damage, less damage taken and more movement speed) and two more
    raise(S) {
      const r = Math.max(S.A, SIM.snap), list = corpses(S.at, r).slice(0, S.R ? 4 : 1 + S.spent);
      const st = S.dmg?.stats || {}, life = durOf(S) || SIM.minionTime, ef = 1 + (st['raise_zombie_empowerment_effect_+%'] || 0) / 100, emp = st['power_charged_zombie_hit_damage_+%_final'];   // its quality: the empowerment's effect
      const raise = (X, p, o) => { limit(o => o.kind === S.name, st.base_number_of_zombies_allowed); minion(X, p, life, { kind: S.name, ...o }); };
      const E = { taken: 1 - st['power_charged_zombie_damage_taken_-%_final'] * ef / 100, speed: 1 + st['power_charged_zombie_movement_speed_+%_final'] * ef / 100 };
      if (!list.length && emp != null && charges.power > 0) { charges.power--; chargesSpent(1, 'power'); for (let k = 0; k < 3; k++) raise(k ? S : { ...S, mult: S.mult * (1 + emp * ef / 100) }, around(S.at, 1), k ? {} : E); return say(t('{0}: {1} raised from corpses', S.label, 3), S.el); }
      if (!list.length) return toast(t('{0} needs a corpse: kill an enemy or press C', S.label));
      for (const d of list) { const p = { x: d.pos.x, z: d.pos.z }; eat(d, S.el); raise(S, p); }
      say(t('{0}: {1} raised from corpses', S.label, list.length), S.el);
    },
    // A totem uses its gem's own attack or spell (Shockwave Totem, Artillery Ballista), or a meta totem the gem in it (Mortar
    // Cannon's Cluster Grenade), with the damage and speed calc.js gives it as the totem's; up to the build's totem limit.
    // Without that damage it hits for the scene's share, drawn "~".
    totem(S) {
      const j = api.build().gems.findIndex((_, j) => api.usedBy(j) === S.g), F = j >= 0 && mk(j) || S, real = Object.keys(F.dmg?.hits || {}).length > 0;
      // Splinter Totem: one totem at a time, splintering after its actions into smaller ones, up to its times, each
      // splinter with its less damage, area and skill speed. Greatwood (Cirel's Cultivation): its more damage and
      // increased area per other totem within its radius, up to its most
      // note: how many totems one splinters into is not in the data; 2 here
      const su = S.dmg?.sum || {}, SPL = su.support_splinter_totem_X_times, gen = S.gen || 0, less = k => (1 + (su[k] || 0) / 100) ** gen;
      const mine = objs.filter(o => o.totemOf === S.name && !o.dead);
      if (SPL) { if (!gen) mine.forEach(o => o.die()); } else if (mine.length >= (F.dmg?.totems || 2)) mine[0].die();
      const DE = S.name === 'Dark Effigy', c = S.at, f = DE ? makeEffigy(fx, DEFF.core) : makeTotem(fx, S.el, S.P.ballista, S.name === 'Artillery Ballista'), TS0 = { ...F, src: real ? 'totemHit' : 'totem', mult: F.mult * (S.totemMult || 1) * less('support_splinter_totem_damage_+%_final_each_splinter') }, R0 = (F.R || S.R || SIM.totemArea) * Math.sqrt(less('support_splinter_totem_area_of_effect_+%_final_each_splinter')), far = S.P.ballista || S.P.ranged;
      const every = (real && F.dmg.speed ? 1 / F.dmg.speed : far ? 1 : 1.3) / less('support_splinter_totem_skill_speed_+%_final_each_splinter');
      if (gen) f.group.scale.setScalar(.8 ** gen);
      let acts = 0;
      const GT = su.support_greatwood_number_of_active_totems_in_base_radius_to_track, gwN = () => GT ? Math.min(su.support_greatwood_maximum_number_of_active_totems_in_radius_for_effects, objs.filter(o => o.totemOf && o !== e && !o.dead && dist(o.pos, e.pos) <= GT / 10).length) : 0;
      const GR = su['support_greatwood_life_regeneration_rate_per_minute_%_per_totem_in_radius'] || 0;
      f.group.position.set(c.x, 0, c.z); f.group.rotation.y = facing; scene.add(f.group);
      // Ancestral Warrior Totem (its tutorial video; ancestor_totem's spectre .mat): the totem glows the spirits' pale blue,
      // and each use conjures a spirit warrior beside it, towards the enemy, that uses the socketed Mace skill once (as
      // you would, from where it stands) and fades. note: where the warrior stands is not in the data: up to 1.5 m out
      const AW = S.name === 'Ancestral Warrior Totem' && real && j >= 0;
      if (AW) f.group.traverse(m => { if (m.isMesh && m.material?.emissive) { m.material = m.material.clone(); m.material.emissive.set(SPECTRE); m.material.emissiveIntensity = .12; } });
      if (DE) deRise(c); else { fx.ring(c, .2, 1.3, S.el, .4); fx.emit(18, { p: { x: c.x, y: .1, z: c.z }, r: .5, v: 1.5, up: 1.5, life: .6, size: .5, grow: 2, c: 'dust', smoke: true, a: .4 }); }
      let wait = .5;
      me.totemAt = time;
      const e = { pos: f.group.position, fig: f, r: .4, dead: false, s: 0, shot: time, totemOf: S.name, embank: EMBANK[S.name] ? S.name : F.P?.spell ? 'Spell Totem' : null,
        update(dt) {
          e.s += dt; if (e.s > (sh(S).totem || SIM.totemTime) * (S.totemTime || 1)) { e.die(); return; }
          const sg = e.segs?.[0], rg = sg && (S.dmg.totemRegen || 0) + (GR && gwN() * GR / 60); if (rg) sg.life = Math.min(sg.max, sg.life + sg.max * rg / 100 * dt);   // the tree's totem life regeneration; Greatwood's per other totem in its radius
          if (AW && Math.random() < dt * 12) fx.emit(1, { p: { x: e.pos.x, y: rnd(.4, 2), z: e.pos.z }, r: .35, up: .5, v: .3, life: .6, size: .14, c: SPECTRE, k: 1.4, drag: 1 });   // its ghostly wisps
          if (DE) deIdle(e, dt);
          if ((wait -= dt) > 0) return;
          if (sheet().totemOnShot && !(me.shotAt > e.shot)) return;   // Cannons, Ready!: it only uses its skill when you fire an Attack Projectile (once for each, no faster than it can)
          const d = DE ? near(e.pos, R0, chaosDotOn) : near(e.pos, far ? 12 : R0 + 1); if (!d) { wait = .2; return; }
          e.shot = time; wait = every / (F.P?.spell && sheet().totemCast ? 1 + sheet().totemCast * objs.filter(o => o.totemOf && !o.dead).length / 100 : 1);   // the tree's totem cast speed per summoned totem
          const k = dist(d.pos, e.pos) || 1, a0 = f.group.rotation.y = Math.atan2(d.pos.x - e.pos.x, d.pos.z - e.pos.z), n = far ? sh(F).projectiles || 1 : 1;
          const gw = gwN();
          const TS = gw ? { ...TS0, mult: TS0.mult * (1 + gw * su['damage_+%_final_per_totem_in_radius_from_support_greatwood'] / 100) } : TS0, R = R0 * Math.sqrt(1 + gw * (su['area_of_effect_+%_per_totem_in_radius_from_support_greatwood'] || 0) / 100);
          if (DE) effigyVolley(TS, e, R, every);
          else if (F.kind === 'grenade') K.grenade({ ...TS, origin: { x: e.pos.x, z: e.pos.z }, at: { x: d.pos.x, z: d.pos.z } });
          else if (S.name === 'Artillery Ballista') artillery(TS, e, d, n, R);
          else if (far) for (let i = 0; i < n; i++) { const a = a0 + (i - (n - 1) / 2) * .12; shoot(TS, e.pos, Math.sin(a), Math.cos(a), { speed: 22, range: 13 }); }
          else if (AW) {
            const l = Math.max(.6, Math.min(1.5, k - 1)), q = { x: e.pos.x + (d.pos.x - e.pos.x) / k * l, z: e.pos.z + (d.pos.z - e.pos.z) / k * l }, at = { x: d.pos.x, z: d.pos.z };
            fx.bolt(V(e.pos.x, 1.3, e.pos.z), V(q.x, .9, q.z), SPECTRE, .25, .05, 0);
            visage(q, at, { name: S.label, c: SPECTRE, body: 0xcfefff, glow: .7, a: .6, back: { x: 0, z: 0 }, look: api.look?.() }, () => use(j, { at, src: 'totemHit', here: true, more: TS.mult / (F.mult || 1) }), F.P, F);
          }
          else { fx.ring(e.pos, .3, R, S.el, .4); fx.disc(e.pos, R, S.el, .3, { a: .35 }); area(e.pos, R, TS, real ? {} : { mult: .6 }); }
          if (SPL && gen < SPL && ++acts >= su.support_splinter_totem_splinter_after_X_actions) { e.die(); for (let i = 0; i < 2; i++) K.totem({ ...S, at: around(e.pos, 1.2), gen: gen + 1 }); }
        },
        // Tawhoa's Tending: on death it explodes for that share of the totem's life (calc.js totemLife) in its area
        die() {
          { const SM = !e.dead && sheet().soulCurse, X = SM?.[Math.floor(Math.random() * SM.length)]; if (X) hexMe(X.name, X.C, X.s, 1, true); }   // Soul Mantle
          e.dead = true; if (e.spirit) e.spirit.dead = true; const T = S.dmg?.trig?.find(T => T.stats?.['base_physical_damage_equal_to_%_of_totem_life']);   // its Ancestral Spirit dies with it
          if (T && S.dmg.totemLife) { const X = asTrig(S, T, scale(T.hits, S.dmg.totemLife * T.stats['base_physical_damage_equal_to_%_of_totem_life'] / 1e4)), p = { x: e.pos.x, z: e.pos.z }; say(X.label, X.el); boom(p, X.A, X); }
        },
        remove() { fx.emit(14, { p: { x: e.pos.x, y: .8, z: e.pos.z }, r: .3, v: 1.4, up: 1, life: .6, size: .14, c: 0x5c4026, g: 8, k: 1 }); f.dispose(); } };
      // its life (calc.js totemLife): enemies nearer to it than to you attack it, and it dies at none left
      const TL = S.dmg?.totemLife * (S.totemLife || 1) * less('support_splinter_totem_maximum_life_+%_final_each_splinter');   // Spell Totem: more per Endurance Charge consumed; Splinter Totem: less each time it splintered
      if (TL > 0) Object.assign(e, { decoy: true, segs: [{ p: e.pos, r: .4, life: TL, max: TL, res: S.dmg.totemRes, hurt(n) { if (e.dead) return; const RC = sheet().recoup, g = n * (RC?.totem || 0) / 100; if (g) me.recoup.push({ k: 'life', left: g, rate: g / RC.time }); if (this.life > 0 && (this.life -= n) <= 0) sheet().lastTremor ? later(sheet().lastTremor, () => e.dead || e.die()) : e.die(); } }] });   /* Unnamed Heartwood: it dies that long after its life is gone */   /* Watchtowers: its share of the damage your totems take recouped as your life */
      objs.push(e);
      // Warbringer's Answered Call: summoning a totem triggers Ancestral Spirits (the build's gem), an Ancestral Spirit
      // minion for its duration that dies with that totem (its description)
      const AJ = sheet().defender ? api.build().gems.findIndex(g => g.name === 'Ancestral Spirits') : -1, AS = AJ >= 0 && base(AJ);
      if (AS?.dmg) e.spirit = minion(AS, around(c, 1.4), durOf(AS) || Infinity, { kind: AS.name, spirit: ['turtle', 'hulk', 'caster', 'horn'][Math.floor(rnd(4))], from: c });   // no duration in the data: as long as the totem
    },
    travel(S) {
      // Shield Charge: it crashes into the first enemy on its path and stops there, its more damage from the distance
      // travelled (up to its most at its full range), its final cone part too; it runs on its extra distance past where
      // you aimed (note: as a straight run on, its slowing down is not simulated)
      const SE = (S.dmg?.stats?.shield_charge_extra_distance || 0) / 10;
      const P = S.P, to = SE ? { x: S.at.x + S.dx * SE, z: S.at.z + S.dz * SE } : S.at, from = { x: pp.x, z: pp.z }, far = S.dmg?.stats?.['base_additional_damage_from_distance_+%_final'], crash = far != null;
      me.leapK = Math.min(1, dist(from, to) / (sh(S).travel ?? SIM.travelRange));   // the share of its range it travels (useTime: Leap Slam's and Molten Crash's seconds added by distance)
      const land = (at = to) => {
        const k = Math.min(1, dist(from, at) / ((sh(S).travel ?? SIM.travelRange) + SE)), Y = crash ? { ...S, mult: S.mult * (1 + far * k / 100) } : S, X = partOf(S, 'ShieldChargeFinalConePlayer');
        // fully charged (its whole range run): its more stun buildup
        const FS = k >= 1 && S.dmg?.stats?.['shield_charge_hit_damage_stun_multiplier_when_fully_charged_+%_final'], so = FS ? { stunX: 1 + FS / 100 } : {};
        if (S.R || P.attack) boom(at, S.A, Y, so); else fx.ring(at, .2, 1.6, S.el, .4);
        if (X) boom(at, X.A, { ...X, mult: Y.mult }, so);
        if (P.ground) ground(P.ground, at, S.A, P.dur, S);
        if (P.slams) slammed(S, at, S.A);
        if (P.jump) landed(S, at);
        // Stampede: its leaping slam at the end (its part), setting off the Jagged Ground within it, each exploding
        const SS = partOf(S, 'StampedeSlamPlayer');
        if (SS) { boom(at, SS.A, { ...SS, mult: S.mult }); slammed(SS, at, SS.A); for (const g of grounds) if (!g.dead && !stays(g) && g.type === 'jagged' && dist(g, at) <= SS.A + g.r) { g.dead = true; boom(g, g.r, S, { soft: true }); } }
        // Molten Crash: its Molten Fissures (its part, up to its limit, lasting its duration), one more for the Rage it
        // consumes on landing if you have it, then its second slam setting them off
        // note: one fissure without Rage is the description's plural read at its least; their length is not in the data
        const ms = S.dmg?.stats, mc = ms?.molten_crash_max_number_of_fissures;
        if (mc) {
          const X = partOf(S, 'MoltenCrashFissurePlayer') || S, cost = ms.molten_crash_optionally_consume_X_rage_for_fissures, more = me.rage >= cost ? ms.molten_crash_number_of_additional_fissures_from_rage_consumption : 0;
          if (more) spendRage(cost);
          const n = 1 + more, a0 = Math.atan2(S.dx, S.dz);
          for (let j = 0; j < n; j++) fissure(X, at, a0 + (j - (n - 1) / 2) * .5, 5, X.A, 1, { dur: sh(S).duration || ms.base_skill_effect_duration / 1000, max: mc });
          later(.3, () => { boom(at, S.A, Y); slammed(S, at, S.A); });
        }
      };
      if (P.blink && !P.jump) {
        fx.pillar(from, .5, 3, S.el, .3); fx.emit(20, { p: { x: from.x, y: 1, z: from.z }, r: .3, v: 2, life: .4, size: .2, c: S.el, c2: 'white' });
        fx.bolt(V(from.x, 1, from.z), V(to.x, 1, to.z), S.el, .2, .05, .15);
        pp.x = to.x; pp.z = to.z; fx.pillar(to, .6, 3.5, S.el, .35); land();
      } else move = { from, to, k: 0, dur: P.jump ? .45 : .22, h: P.jump ? 2.6 : 0, S, land, seen: new Set(), crash, jag: S.dmg?.stats?.skill_jagged_ground_base_duration_ms / 1000, step: 0 };
    },
    nova(S) {
      const P = S.P; let c = S.src && !S.here ? S.at : S.from;   // here: cast as by hand where it stands (an Abyssal Apparition)
      if (P.from) { const q = objs.find(o => o.proj && o.name === P.from && !o.dead); if (q) { c = { x: q.pos.x, z: q.pos.z }; say(t('{0} erupts from {1}', S.label, labelOf(P.from)), S.el); } }
      const R = stageR(S), dur = Math.min(.5, .12 + R * .045);
      if (S.name === 'Consecrate') { consecrate(c, R); ground('consecrated', c, R, durOf(S), S); return; }   // only its ground, for its duration
      // Elemental Sundering: its pulse deals nothing; it Consumes the Freeze, Shock and Ignite of the enemies in it, nearest
      // first, each an explosion of that element around the enemy (the cold one the gem's, the others its parts), up to its
      // most, with its more damage from a Unique; each ailment is kept while the enemy charges and consumed as it explodes
      // note: its pulse's radius is PoB2's (Skills/act_dex.lua ElementalSunderingPlayer "Pulse": 50), scaled as its explosion's;
      // the ailments of allies and corpses are not in the scene
      // Bone Cage: its ring of bone spikes around you (up to its rings, a new one ends the last) for its duration; a spike an
      // enemy touches breaks (its chance: 100%), hitting and Pinning the enemies within its secondary radius
      // note: its spikes stand side by side around the ring, their number the scene's (the data gives none)
      // Its look (RingOfBoneSpike: bone_ringwall_02 boneRing_Spike_01, its mainSpike01 and xtraSpike): a bundle of bone stakes
      // on each stretch of the ring (bone 0.3 / 0.24 / 0.11) lit green as they emerge (boneStake01 0.6 / 1.25 / 0.9), with
      // necromantic embers for 1.5-4 s; a spike that breaks stabs (RingOfBoneSpikeExplosion: spear_wall spear_explode, dust)
      // and pins the enemies it hits (ring_of_bone_pinned: bonePin.epk pinSpikes, bone spikes in their body for 2-3 s and
      // blood splashing for 1.5-2 s). note: the stakes in a bundle (spread along its stretch), their sizes and how the green fades are the scene's
      const BC = S.dmg?.stats?.ring_of_bone_maximum_number_of_rings;
      if (BC) {
        const r = radOf(S), n = Math.max(3, Math.round(Math.PI * R / r)), g = holder(c), mat = new THREE.MeshStandardMaterial({ color: BONE.bone, roughness: .6, flatShading: true, emissive: BONE.glow, emissiveIntensity: 1 });
        limit(o => o.cage && o.name === S.name, BC, S);
        const spikes = Array.from({ length: n }, (_, k) => {
          const a = k * TAU / n, m = new THREE.Group(), p = { x: c.x + Math.sin(a) * R, z: c.z + Math.cos(a) * R };
          m.position.set(Math.sin(a) * R, 0, Math.cos(a) * R); m.rotation.y = a; m.scale.setScalar(.01); g.add(m);
          for (let j = 0, w = TAU * R / n, nj = Math.max(4, Math.round(w / .18)); j < nj; j++) { const s = new THREE.Mesh(EARTH.spike, mat); s.position.set((j / (nj - 1) - .5) * w + rnd(-.05, .05), .4, rnd(-.12, .12));   // the stakes spread along its stretch of the ring
            s.rotation.set(rnd(-.35, .35), 0, rnd(-.35, .35)); s.scale.setScalar(j ? rnd(.25, .4) : .5); s.castShadow = true; m.add(s); }
          fx.emit(3, { p: { x: p.x, y: .4, z: p.z }, r: .25, h: .5, v: .3, up: .5, life: 2.7, size: .05, c: BONE.glow, k: 1.6, drag: 1 });
          return { m, p };
        });
        const e = thing(g, durOf(S), { name: S.name, cage: true,
          tick(dt, e) {
            const k = Math.max(.01, ease(Math.min(1, e.s / .2))); mat.emissiveIntensity = .25 + .75 * Math.max(0, 1 - e.s / .75);
            for (const s of spikes) if (s.m.scale.setScalar(k), s.m.visible && inside(s.p, .2).length) {
              s.m.visible = false; pop(s.p, r, 'dust'); fx.spikes(s.p, .35, { n: 5, h: 1, w: .07, c: BONE.bone, dark: true, glow: BONE.glow, dur: .5 });
              for (const d of inside(s.p, r)) { const q = { x: d.pos.x, y: .7, z: d.pos.z }; fx.spikes(q, .3, { n: 4, h: .6, w: .05, c: BONE.bone, dark: true, dur: 2.5, inner: 0 }); fx.emit(6, { p: q, r: .2, v: 1.2, up: 1.5, life: 1.7, size: .08, c: BBL.blood, smoke: true, a: .9, g: 10, drag: .4 }); }
              area(s.p, r, { ...S, self: e });
            }
          } });
        return;
      }
      const ES = S.dmg?.stats?.elemental_sundering_number_of_explosion_allowed;
      if (ES) {
        const st = S.dmg.stats, pr = 5 * S.A / (st.active_skill_base_area_of_effect_radius / 10), by = { freeze: S, ignite: partOf(S, 'ElementalSunderingFirePlayer'), shock: partOf(S, 'ElementalSunderingLightningPlayer') };
        sunderPulse(c, pr); let n = ES;
        for (const d of inside(c, pr).sort((p, q) => dist(p.pos, c) - dist(q.pos, c))) for (const s of ['freeze', 'shock', 'ignite']) if (n > 0 && has(d, s)) {
          n--; d.st[s] = Math.max(d.st[s], 1.05);   // kept while it charges (elemental_sundering_pause_ailment), consumed as it explodes
          const X = by[s], el = { freeze: 'cold', shock: 'lightning', ignite: 'fire' }[s], gm = uniqueMore(d, st['elemental_sundering_damage_+%_final_if_created_from_unique']);
          sunderCharge(d, el);
          later(1, () => { consume(d, S, s); const p = { x: d.pos.x, z: d.pos.z }; sunderBlast(p, X.A, el); area(p, X.A, { ...X, gm: (X.gm ?? 1) * gm }, { noPay: true }); });   // where the enemy is by then
        }
        return;
      }
      fx.ring(c, .2, R, S.el, dur + .15, { k: 2.8 }); fx.disc(c, R, S.el, dur + .25, { a: S.el === 'cold' || S.el === 'lightning' ? .15 : .35 }); fx.flash(c, S.el, 30 + R * 10, .35, 6 + R * 2);   // cold and lightning: the shards and forks below are their look
      if (S.el === 'cold') fx.shards(c, R, dur); else if (S.el === 'lightning') fx.forks(c, R);
      fx.emit(Math.min(120, 20 + R * 14), { p: { x: c.x, y: .4, z: c.z }, v: R / dur * .8, flat: true, life: dur, size: .22, c: S.el, c2: 'white', drag: .5 });
      // Enervating Nova: none within its secondary radius; beyond it, more damage with distance up to its most at the edge
      // (linear: note: the curve is not in the data), and the enemies hit can be Electrocuted by any lightning damage for
      // its duration (afflict)
      const EN = S.dmg?.stats?.['new_shock_nova_distance_based_damage_+%_final'], r2 = EN != null && Math.min(R * .9, S.G?.radius2 || radOf(S));
      for (const d of inside(c, R)) {   // the wave reaches the near ones first
        const dd = dist(d.pos, c); if (EN != null && dd < r2) continue;
        later(dd / R * dur, () => { if (EN == null) return hit(d, S); if (hit(d, S, { mult: 1 + EN / 100 * clamp((dd - r2) / (R - r2), 0, 1) })) d.enerv = time + durOf(S); });
      }
      later(dur * .5, () => touch(c, R, S));
      if (P.ground) later(dur, () => ground(P.ground, c, R, Math.min(P.dur || GROUND_TIME[P.ground] || SIM.groundTime, 8), S));
      const X = S.infs?.includes('cold') && infPart(S, 'cold');   // Ice Nova: a patch of Chilled Ground
      if (X) later(dur, () => { boom(c, X.A, X, { soft: true }); ground('chilled', c, X.A, GROUND_TIME.chilled, X); });
    },
    slam(S) {
      // Supercharged Slam: a stage per its share of the channel, each its more damage (its own area, not the scene's growth)
      const SC = S.dmg?.stats?.channelled_slam_max_stages, cs = SC ? Math.round((S.stage || 0) * SC) : 0;
      if (SC) S = { ...S, mult: S.mult * (1 + cs * S.dmg.stats['channelled_slam_damage_+%_final_per_stage'] / 100) };
      const P = S.P, c = S.at, R = SC ? S.A : stageR(S);
      later(.12, () => {
        // Sunder: a sequence of its areas in front of you, each larger by its step, up to its number of enemies in each
        // releasing its shockwave (its part); a hit on fully broken armour Sunders it (its more physical damage taken)
        const SW = S.dmg?.stats?.sunder_wave_max_steps, SPK = S.dmg?.stats?.spike_slam_max_spikes;
        if (SW) { const ss = S.dmg.stats, X = partOf(S, 'SunderShockwavePlayer'), XR = X && radOf(X); for (let k = 0; k < SW; k++) later(k * .12, () => {
          const r = R + k * ss['sunder_wave_radius_+_per_step'] / 10, q = { x: c.x + S.dx * R * 1.8 * k, z: c.z + S.dz * R * 1.8 * k };
          const there = inside(q, r);
          for (const d of there) if (d.st.armour > 0) d.sunder = { pct: ss.sunder_armor_break_extra_magnitude, until: time + durOf(S) };
          if (X) for (const d of there.slice(0, ss.sunder_shockwave_limit_per_cascade)) boom({ x: d.pos.x, z: d.pos.z }, XR, X, { soft: true });
          boom(q, r, S);
        }); }
        else if (P.aftershock) { eqHit(c, R); area(c, R, S); }
        else if (!SPK) boom(c, R, S);   // Earthshatter: its fissure is its hit
        // Supercharged Slam: an Aftershock per stage, each its delay later and its radius larger per previous one
        const ps = S.dmg?.part || {};
        for (let k = 1; k <= cs; k++) later(k * ps.aftershock_delay_ms / 1000, () => boom(c, R + k * ps['aftershock_radius_+_per_previous_aftershock'] / 10, S));
        // Tremors (and Titan's Earthbreaker): its independent chances for one, two and three more Aftershocks, each the slam's damage in its area after it (keywords.json)
        // Reverberate: those chances increased per 250 ms of its attack time
        const TR = !S.src && S.dmg?.sum, RV = TR ? 1 + (TR['chance_to_aftershock_+%_per_250_ms_attack_time'] || 0) * Math.floor((S.dmg.speed ? 1 / S.dmg.speed : 0) / .25) / 100 : 1, n = TR ? [['support_slam_chance_for_one_additional_aftershock_%', 1], ['support_slam_chance_for_two_additional_aftershocks_%', 2], ['support_slam_chance_for_three_additional_aftershocks_%', 3], ['your_slam_aftershock_chance_%', 1]].reduce((n, [w, k]) => n + (Math.random() * 100 < (TR[w] || 0) * RV ? k : 0), 0) + (Math.random() * 100 < (sh(S).aftershock || 0) * RV ? 1 : 0) : 0;
        // the tree's increased Aftershock area of the Slams you use yourself
        const AR = TR ? Math.sqrt(1 + (TR['your_aftershock_area_of_effect_+%'] || 0) / 100) : 1;
        for (let k = 1; k <= n; k++) later(.42 * k, () => { say(t('Aftershock of {0}', S.label), S.el); boom(c, R * AR, S); });
        // Titan's Mountain Splitter: every third Slam you use yourself that doesn't create Fissures, its Aftershocks ahead and to
        // each side of the slam (one each). note: their delay is not in its data: at once, the slam's damage and area
        const MS = S.slamN && S.slamN % 3 === 0 && S.dmg?.sum?.num_cascade_aftershocks_every_third_slam && !Object.keys(S.dmg.stats).some(k => k.includes('fissure'));
        if (MS) for (const a of [0, Math.PI / 2, -Math.PI / 2]) { const q = Math.atan2(S.dx, S.dz) + a; boom({ x: c.x + Math.sin(q) * 2 * R, z: c.z + Math.cos(q) * 2 * R }, R, S, { soft: true }); }
        // Tectonic Slams: its Aftershocks ahead and to each side of the slam, at once, with its less damage and area
        const TC = !S.src && S.dmg?.sum?.number_of_dual_cascade_aftershocks;
        if (TC) {
          const su = S.dmg.sum, r = R * Math.sqrt(1 + su['aftershock_area_of_effect_+%_final_from_support_dual_cascade_aftershocks'] / 100), W = { ...S, mult: S.mult * (1 + su['aftershock_damage_+%_final_from_support_dual_cascade_aftershocks'] / 100) };
          for (const a of [0, Math.PI / 2, -Math.PI / 2]) for (let k = 1; k <= TC; k++) { const q = Math.atan2(S.dx, S.dz) + a, l = R + r * (2 * k - 1); boom({ x: c.x + Math.sin(q) * l, z: c.z + Math.cos(q) * l }, r, W, { soft: true }); }
        }
        // Furious Slam: its pair of shockwaves after its delay, each its angle off your aim, its spacing of its area away;
        // with its Rage to spend, its enraged part instead, larger, leaving Jagged Ground for its duration
        const FS = S.dmg?.stats?.bear_slam_spend_X_rage_for_stronger_slam;
        if (FS) {
          const st = S.dmg.stats, X = !S.src && me.rage >= FS && partOf(S, 'FuriousSlamEnragedPlayer'), W = X ? { ...X, mult: S.mult } : S, r = X ? X.A : R, a0 = Math.atan2(S.dx, S.dz), off = st.cascade_aftershock_angle_offset_override * Math.PI / 180, gap = r * 2 * st['cascade_aftershock_spacing_area_%_override'] / 100;
          if (X) spendRage(FS);
          for (const sgn of [-1, 1]) later(st.aftershock_delay_ms / 1000, () => { const a = a0 + sgn * off, q = { x: c.x + Math.sin(a) * gap, z: c.z + Math.cos(a) * gap }; boom(q, r, W); if (X) ground('jagged', q, r, durOf(X), W); });
        }
        slammed(S, c, R); if (S.chillFor) ground('chilled', c, R, S.chillFor, S); if (!P.aftershock && !SPK) fx.disc(c, R * 1.1, 0x0a0806, 5, { dark: true, tex: 'cracks', a: .85, hold: .6, y: .032, spin: 0 });
        // Starborn Onslaught: its fissures, lasting its duration up to its limit, and its stars falling one after another
        // (its first delay, its delay) between its inner and outer radius around the impact (its explosion part)
        // note: the branching of its fissures is not drawn
        const st = S.dmg?.stats || {}, stars = st.empyrean_descent_number_of_explosions, X = stars && partOf(S, 'StarbornOnslaughtExplosions');
        if (stars) for (let k = 0; k < (st.base_number_of_fissures || 1); k++) fissure(S, c, Math.atan2(S.dx, S.dz) + k * TAU / st.base_number_of_fissures, 5, .8, .5, { dur: sh(S).duration || st.base_skill_effect_duration / 1000, max: st.volcanic_fissure_base_maximum_number_of_fissures });
        // Fury of the Mountain: each pound a Molten Fissure off at random within its cone in front of you, lasting its
        // duration up to its most (note: one per pound, the data gives no number; their length is the scene's)
        else if (st.fury_of_the_mountain_base_maximum_number_of_fissures) { const h = st.bear_fury_of_the_mountain_front_facing_cone_angle * Math.PI / 360; fissure(S, c, Math.atan2(S.dx, S.dz) + rnd(-h, h), 5, S.A, 1, { dur: durOf(S), max: st.fury_of_the_mountain_base_maximum_number_of_fissures }); }
        else if (SPK) fissure(S, c, Math.atan2(S.dx, S.dz), 5, R, 1, { own: true });   // Earthshatter: one fissure, its area, its damage
        else if (P.fissure) for (let j = -1; j <= 1; j++) fissure(S, c, Math.atan2(S.dx, S.dz) + j * .5, 5);
        if (X) for (let k = 0; k < stars; k++) later((st.empyrean_descent_secondary_explosions_initial_delay_ms + k * st.empyrean_descent_secondary_explosions_delay_ms) / 1000, () => {
          const a = rnd(TAU), r = rnd(st.empyrean_descent_secondary_explosions_inner_radius / 10, st.empyrean_descent_secondary_explosions_outer_radius / 10), q = V(c.x + Math.sin(a) * r, 0, c.z + Math.cos(a) * r);
          fx.streak(V(q.x + 2, 13, q.z - 1.5), q, 'cold', .16, .07, 1.8); later(.16, () => { pop(q, X.A, 'cold'); area(q, X.A, X); });
        });
        // the earthen object it leaves: Earthshatter's spike where its fissure ends, Forge Hammer's hammer where it lands
        if (P.earthen) { const spike = !!st.spike_slam_max_spikes; later(spike ? .3 : 0, () => earth(S, spike ? { x: c.x + S.dx * 5, z: c.z + S.dz * 5 } : c, spike ? st.spike_slam_max_spikes : st.forge_hammer_maximum_hammers, spike)); }   // the spike as its fissure ends
        // Earthquake: its Jagged Ground (its tertiary radius and duration, up to its most patches, never on one of its own)
        // erupts at its end in its Aftershock part, its radius its own per level added to the slam's (2.4-3 m at gem levels
        // 1-20 in the game's 0.3.0 notes; Path of Building's too), grown as the slam's by its increased area
        if (P.aftershock) {
          const r = st.active_skill_base_tertiary_area_of_effect_radius / 10 || R, dur = st.skill_jagged_ground_base_duration_ms / 1000, X = partOf(S, 'EarthquakeAftershockPlayer') || S, QR = X === S ? r : S.A * (1 + X.dmg.stats.active_skill_base_area_of_effect_radius / st.active_skill_base_area_of_effect_radius), mine = grounds.filter(g => !g.dead && g.quake === S.name);
          if (mine.length < (st.base_number_of_earthquakes_allowed || 1) && !mine.some(g => dist(g, c) < g.r + r)) {
            ground('jagged', c, r, dur, S).quake = S.name; for (let k = 1; k < dur; k++) later(k, () => eqMark(c, r));
            later(dur, () => { say(t('Aftershock of {0}', S.label), S.el); eqAfter(c, QR); area(c, QR, { ...X, mult: S.mult }); });
          }
        } else if (P.ground) ground(P.ground, c, R * 1.15, P.dur, S);
        if (P.fan && S.spent) { const a0 = Math.atan2(S.dx, S.dz), n = 1 + S.spent * 2; for (let i = 0; i < n; i++) { const a = a0 + (i - (n - 1) / 2) * .22; shoot({ ...S, aoe: false, P: { ...P, explodes: false } }, c, Math.sin(a), Math.cos(a), { speed: 20, range: 11 }); } }
      });
    },
    strike(S) {
      const P = S.P, reach = strikeR(S), FL = S.dmg?.stats?.flicker_strike_additional_flickers_from_power_charges, n = S.times || (FL ? 1 + S.spent * FL : P.dash ? Math.max(1, S.spent) : 1);   // Flicker Strike: its more strikes per Power Charge
      const first = S.src ? near(S.at, 1) : near(S.at, SIM.snap, e => dist(e.pos, pp) <= reach);
      if (!first) return slash(S, S.dx, S.dz);   // nothing in reach: swings at the air
      if (flagOf(S.name, 'cannot_gain_power_charges_during_skill')) me.noPower = time + n * .13;   // Flicker Strike, for its strikes
      const go = (d, k) => {
        if (d.dead) return;
        const past = dist(d.pos, pp) - meleeR(S) - SIM.body;
        if (P.dash || past > 0) {   // strikes that carry you to the target, or step to it
          const a = Math.atan2(pp.x - d.pos.x, pp.z - d.pos.z) + (k ? rnd(-2, 2) : 0), q = { x: d.pos.x + Math.sin(a) * 1.1, z: d.pos.z + Math.cos(a) * 1.1 };
          if (S.name === 'Crushing Fear') cfDash(pp, q); else if (S.name === 'Cull The Weak') ctwLunge(pp, q); else if (P.dash || past > stepR(S)) fx.bolt(V(pp.x, 1, pp.z), V(q.x, 1, q.z), S.el, .2, .04, .1);
          pp.x = q.x; pp.z = q.z;
        }
        const dx = d.pos.x - pp.x, dz = d.pos.z - pp.z, l = Math.hypot(dx, dz) || 1;
        facing = Math.atan2(dx, dz); castAt = time; me.act = actMove(S); if (S.name === 'Blood Hunt') bhStab(d, dx / l, dz / l); else if (S.name === 'Cull The Weak') ctwStab(pp, dx / l, dz / l); else if (!['Axe Slash', 'Dagger Stab'].includes(S.name)) slash(S, dx / l, dz / l); if (S.name === 'Boneshatter') bsSurge(d); if (S.name === 'Crushing Fear') cfHit(d.pos); if (S.name === 'Armour Breaker' && !S.src) breakLook(d, dx / l, dz / l);
        if (S.R) { pop(d.pos, S.R, S.el); area(d.pos, S.R, S); } else { hit(d, S); touch(d.pos, .6, S); if (!S.src && Math.random() * 100 < (sheet().splash || 0)) for (const e of inside(d.pos, 1.5)) if (e !== d) hit(e, { ...S, src: 'splash' }); }   // Splash Damage: a hit to the others within 1.5 m (keywords.json)
        if (S.name === 'Cull The Weak') ctwHit(d.pos, d.dead);   // after its hit: culled or not
        if (k + 1 < n) later(.13, () => go(near(d.pos, 6, e => e !== d) || d, k + 1));
      };
      // Staggering Palm: its strike Heavy Stuns an enemy Primed for Stun (keywords.json PrimedStun) and, if it did, dashes on
      // to strike the others Primed within its dash range; each one it Heavy Stuns grants its buff for its duration, up to
      // its most: your Quarterstaff attacks also fire its projectile (its part)
      const SP = !S.src && S.dmg?.stats?.staggering_palm_buff_max_duration_ms, primed = d => !d.dead && (d.bar.stun || 0) >= PRIMED[d.stat.rarity];
      const palm = (d, k) => {
        const pr = primed(d), was = d.st.stun > 0; go(d, k);
        if (pr && !d.dead && !(d.st.stun > 0)) { d.bar.stun = 0; d.lock.stun = GC.HeavyStunModifierDuration; inflict(d, 'stun', S, 1, null, { dur: DUR.stun }); }
        if (was || !(d.st.stun > 0)) return false;
        me.palm = { X: partOf(S, 'StaggeringPalmProjectilePlayer'), until: Math.min(time + SP / 1000, Math.max(time, me.palm?.until || 0) + durOf(S)) };
        setBuff({ label: S.label, name: S.name, c: css('physical'), s: me.palm.until - time }); return true;
      };
      const shocked0 = first.st.shock > 0;
      if (!SP) go(first, 0);
      else if (palm(first, 0)) dummies.filter(e => e !== first && primed(e) && dist(e.pos, pp) <= (S.dmg.stats.base_melee_dash_range || 0) / 10).forEach((e, k) => later((k + 1) * .13, () => palm(e, k + 1)));
      // Primal Strikes: its first two attacks on a shocked enemy refresh the shock and conjure a charging spirit (its stag
      // part); its final consumes the shock for its stampede of them, its more damage, a volley every its delay apart
      const W = S.chain0 && partOf({ ...S, dmg: S.chain0 }, 'PrimalStrikesStagWavePlayer');
      if (W && shocked0) {
        const ws = S.chain0.stats, len = W.A, half = radOf(W), m = S.final ? 1 + ws['primal_strikes_stag_stampede_damage_+%_final'] / 100 : 1;
        first.st.shock = S.final ? 0 : Math.max(first.st.shock, DUR.shock);
        const k = S.final ? S.dmg.stats.primal_strikes_number_of_stags : ws.primal_strikes_number_of_stags, gap = ws.primal_strikes_stag_volley_spacing / 10;
        for (let j = 0; j < k; j++) later(j * ws.primal_strikes_stag_volley_delay_ms / 1000, () => {
          const o = (j - (k - 1) / 2) * gap, a = { x: pp.x - S.dz * o, z: pp.z + S.dx * o }, b = { x: a.x + S.dx * len, z: a.z + S.dz * len };
          fx.strip(a, b, half * 2, 'lightning', .45, { a: .6 });
          for (const d of dummies) if (!d.dead && segDist(d.pos, a, b) <= half + SIM.body) later(dist(d.pos, a) / len * .35, () => hit(d, { ...W, mult: S.mult * m }));
        });
      }
      // Killing Palm: its target culled, it dashes on to strike the other cullable enemies within its dash range
      if (S.name === 'Killing Palm' && first.dead) dummies.filter(e => cullable(e, S) && dist(e.pos, pp) <= (S.dmg?.stats?.base_melee_dash_range || 0) / 10).forEach((e, k) => later((k + 1) * .13, () => go(e, k + 1)));
      // Ancestrally Boosted: it targets its additional enemies in reach too; Kaom's Strikes trigger Volcanic Eruption, its
      // projectiles landing between their least and most distance around the target
      for (const e of dummies.filter(e => !e.dead && e !== first && dist(e.pos, pp) <= reach + SIM.body).slice(0, S.addTargets || 0)) { const l = dist(e.pos, pp) || 1; slash(S, (e.pos.x - pp.x) / l, (e.pos.z - pp.z) / l); hit(e, S); }
      const X = S.kaom?.X, xs = X?.dmg.stats;
      if (X) for (let k = sh(X).projectiles || xs.base_number_of_projectiles || 1; k > 0; k--) {
        const a = rnd(TAU), r = rnd(xs.skill_mortar_minimum_projectile_distance / 10, xs.skill_mortar_maximum_projectile_distance / 10), q = { x: first.pos.x + Math.sin(a) * r, z: first.pos.z + Math.cos(a) * r };
        lob(fx.orb('fire', .15), V(first.pos.x, 1, first.pos.z), V(q.x, .1, q.z), .45, 2, () => boom(q, X.A, X), { trail: 'fire' });
      }
    },
    sweep(S) {
      const half = coneHalf(S), R = S.R || meleeR(S), c = S.from, a0 = Math.atan2(S.dz, S.dx), ch = S.P.channel;
      if (!S.own) fx.sector(c, S.dx, S.dz, R, half, S.el, ch ? .22 : .35, { grow: !ch, a: ch ? .2 : .7 });   // own: the skill draws its own look
      if (!S.own) fx.emit(ch ? 7 : 24, { p: { x: c.x + S.dx * .8, y: 1, z: c.z + S.dz * .8 }, dir: V(S.dx * R * 2.2, .2, S.dz * R * 2.2), v: R * half * 1.1, life: .42, size: .32, c: S.el, c2: 'white', drag: .9 });
      if (ch) fx.emit(36, { p: { x: c.x + S.dx * .6, y: 1, z: c.z + S.dz * .6 }, r: .1, dir: V(S.dx * R * 1.7, .3, S.dz * R * 1.7), v: R * half * 1.3, life: .5, size: .2, grow: 4, k: 1.6, c: S.el, c2: S.el === 'fire' ? 'ember' : 'white', drag: .8 });   // a jet widening from the hand, as Incinerate's
      for (const d of inside(c, R)) if (inCone(c, a0, half, d.pos) && hit(d, S) && S.parries) d.parried = S.parries;
      touch({ x: c.x + S.dx * R * .55, z: c.z + S.dz * R * .55 }, R * .5, S);
      // Incinerate's Fire Infusion: Ignited Ground in front of you as its channelling starts (its ground part)
      const X = S.fresh && S.infs?.includes('fire') && infPart(S, 'fire');
      if (X) ground('burning', { x: c.x + S.dx * R * .6, z: c.z + S.dz * R * .6 }, radOf(X), X.dmg.shape?.duration || GROUND_TIME.burning, X);
    },
    wave(S) {
      const R = S.A, c = S.from;
      if (R > 3) {   // one long wave from you
        const b = { x: c.x + S.dx * R, z: c.z + S.dz * R };
        fx.strip(c, b, 2.4, S.el, .5, { a: .8 });
        fx.emit(50, { p: { x: c.x, y: .3, z: c.z }, r: .8, dir: V(S.dx * R * 2.4, .5, S.dz * R * 2.4), v: 1.5, life: .45, size: .3, c: S.el, c2: 'white', drag: .6 });
        for (const d of dummies) if (!d.dead && segDist(d.pos, c, b) <= 1.2 + SIM.body) later(dist(d.pos, c) / R * .3, () => hit(d, S));
        later(.15, () => touch({ x: (c.x + b.x) / 2, z: (c.z + b.z) / 2 }, R / 2, S));
      } else if (S.dmg?.stats?.upheaval_number_of_spikes) {   // Glacial Cascade: its bursts from its offset over its length,
        // closer together at first (its ease-in), each larger by its radius per stage, the last its final spike (its part)
        const gs = S.dmg.stats, n = gs.upheaval_number_of_spikes, off = gs.cascade_attack_starting_distance_offset / 10, len = gs.cascade_attack_base_total_distance / 10, X = partOf(S, 'GlacialCascadeLastSpikePlayer');
        for (let i = 1; i <= n; i++) later(i * .07, () => {
          const k = off + (len - off) * (i / n) ** (gs['cascade_attack_ease_in_exponent_%'] / 100), p = { x: c.x + S.dx * k, z: c.z + S.dz * k }, last = i === n && X;
          fx.pillar(p, R * .5, 1.5 + i * .25, S.el, .3, 2.4); boom(p, last ? X.A : R + i * gs['cascade_attack_radius_per_stage_+1_per_100'] / 1000, last || S, { soft: !last });
        });
      } else {   // eruptions that walk away from you; the last one is the big one
        const n = 6, st = Math.max(1, R * 2);
        for (let i = 1; i <= n; i++) later(i * .09, () => {
          const p = { x: c.x + S.dx * st * i, z: c.z + S.dz * st * i }, last = i === n;
          fx.pillar(p, R * .5, 1.5 + i * .25, S.el, .3, 2.4); boom(p, R * (last ? 1.8 : 1 + i * .08), S, { soft: !last, noPay: !last, mult: last ? 1 : .5 });
        });
      }
    },
    storm(S) {
      // Morgana's Tempest: the storm moves from you to the target at its speed (its more), one more allowed, with its less
      // damage and area
      const su = S.src ? {} : S.dmg?.sum || {}, sf = S.dmg?.finals || {}, MV = su.support_storm_base_movement_speed && su.support_storm_base_movement_speed / 10 * (1 + (sf['support_approaching_storms_movement_speed_+%_final'] || 0) / 100), to = S.at;
      const P = S.P, c = MV ? { x: pp.x, z: pp.z } : S.at, st = S.dmg?.stats || {}, dur = sh(S).duration || Math.min(P.dur || 4, 10), shrink = MV ? Math.sqrt(1 + (sf['support_approaching_storms_area_of_effect_+%_final'] || 0) / 100) : 1;
      if (P.wind) return vortex(S, c, S.A, dur);
      // its own limit, impact interval (and variance), fall time and re-hit interval on one enemy (Firestorm, Icestorm,
      // Thunderstorm); the scene's when a storm gives none
      const max = Object.entries(st).find(([k]) => /_max(?:imum)?_number_of_storms$/.test(k))?.[1] || 2, every = (st.fire_storm_fireball_delay_ms ?? st.lightning_storm_hit_frequency_ms ?? 170) / 1000,
        vary = (st.lightning_storm_hit_frequency_variance_ms || 0) / 1000, fall = (st.firestorm_fall_time_ms ?? 160) / 1000,
        again = (st.rain_hit_delay_ms ?? st.lightning_storm_hit_prevention_duration_ms ?? 0) / 1000, hitAt = new Map();
      limit(o => o.stormOf === S.name, max + (su['support_storm_skill_limit_+'] || 0), S);
      // Firestorm's consumed Infusions: Fire, a larger area and more frequent bolts; Cold and Lightning, their own bolts too
      const fi = S.infs?.includes('fire'), G0 = stormGeo(S), Z = (G0.Z + (fi ? (st['firestorm_secondary_radius_+_if_consumed_fire_infusion'] || 0) / 10 : 0)) * shrink, R = G0.R * shrink;
      const extra = (S.infs || []).filter(e => e !== 'fire').map(e => infPart(S, e)).filter(Boolean);
      const out = fx.decal(c, Z, 'outline', S.el, { a: .2, rot: 0 }), bolt = S.els.includes('lightning');
      // Thunderstorm drenches the enemies in it: more shock chance and freeze buildup against them while they stay
      const ws = st['thunderstorm_wet_debuff_shock_chance_on_+%_final'], wet = ws != null && { shock: ws, freeze: st['thunderstorm_wet_debuff_hit_damage_freeze_multiplier_+%_final'] || 0 };
      // Icestorm: the chill and freeze of the enemies in front of you are consumed, each improving its bolts (per chill;
      // per Power of the frozen enemy): the next bolts are its improved part, a larger area
      // note: "in front of you" the data does not size: within cast range, on the side of the target
      const IX = st.firestorm_improved_bolts_per_chill_consumed != null && partOf(S, 'IcestormEmpoweredPlayer'); let imp = 0;
      if (IX) for (const d of dummies) if (!d.dead && dist(d.pos, pp) <= SIM.castRange && (d.pos.x - pp.x) * (c.x - pp.x) + (d.pos.z - pp.z) * (c.z - pp.z) > 0) {
        if (d.st.freeze > 0) { clear(d, 'freeze'); imp += (st.firestorm_improved_bolts_per_monster_power_of_freeze_consumed || 0) * pow(d); }
        if (d.st.chill > 0) { clear(d, 'chill'); imp += st.firestorm_improved_bolts_per_chill_consumed; }
      }
      let tk = 0;
      thing(holder(c), dur, { stormOf: S.name, name: S.name,
        tick(dt, e) {   // impacts scattered over the area for as long as it lasts; plants in it Overgrow (its description)
          if (MV) { const l = dist(c, to), v = Math.min(l, MV * dt); if (l > .01) { c.x += (to.x - c.x) / l * v; c.z += (to.z - c.z) / l * v; out.move(c); } }
          for (const o of objs) if (o.plant && dist(o.c, c) <= Z) overgrow(o);
          if (wet) for (const d of inside(c, Z)) if (!(d.level > (st.thunderstorm_wet_debuff_cannot_apply_to_targets_above_level || Infinity))) d.wet = { ...wet, until: time + .2 };   // not above its level limit (none at 0)
          if ((tk -= dt) > 0) return; tk = (every + rnd(-vary, vary)) / (fi ? 1 + (st['firestorm_bolt_frequency_+%_if_consumed_fire_infusion'] || 0) / 100 : 1);
          for (const X of extra) { const q2 = around(c, Z); fx.bolt(V(q2.x, 12, q2.z), V(q2.x, 0, q2.z), X.el, .18, .05, .4); later(fall, () => { pop(q2, X.A, X.el); area(q2, X.A, { ...X, self: e }); }); }
          const a = rnd(TAU), r = Math.sqrt(rnd()) * Z, q = V(c.x + Math.cos(a) * r, 0, c.z + Math.sin(a) * r);
          if (bolt) fx.bolt(V(q.x + rnd(-1, 1), 12, q.z + rnd(-1, 1)), q, S.el, .2, .06, .5); else fx.streak(V(q.x + 2, 13, q.z - 1.5), q, S.el, .16, .07, 1.8);
          const B = imp > 0 && imp-- ? IX : S, BR = B === S ? R : B.A;
          later(bolt ? 0 : fall, () => {
            pop(q, BR, S.el);
            for (const d of inside(q, BR)) if (time - (hitAt.get(d) ?? -99) >= again) { hitAt.set(d, time); hit(d, { ...B, self: e }); }
            touch(q, BR, { ...B, self: e });
          });
        },
        off: () => out.remove() });
    },
    zone(S) {
      if (S.name === 'Bone Blast') return boneBlast(S);
      const P = S.P, R = S.A, dur = P.plant && P.dur || Math.min(P.dur || SIM.groundTime, 12); let c = S.at;   // a plant lasts its own duration (Nature's Archon's 200% more)
      // Spearfield: its spears burst out of the ground in front of you across its area, up to its most (the oldest give
      // way); each stays its duration or explodes when an enemy touches it, hitting around it (its secondary radius) with
      // its less damage within its first 0.5 s, and Maims (its additional slow)
      // note: one spear per its spacing across its radius (our reading of spear_wall_cm_per_spear), in the half circle ahead
      const SF = S.dmg?.stats?.spear_wall_maximum_active_spears;
      if (SF) {
        const st = S.dmg.stats, X = { ...S, A: radOf(S) }, a0 = Math.atan2(S.dx, S.dz), from = S.from, n = Math.round(R * 100 / st.spear_wall_cm_per_spear);
        for (let k = 0; k < n; k++) {
          const a = a0 + rnd(-Math.PI / 2, Math.PI / 2), r = Math.sqrt(rnd(.04, 1)) * R, p = { x: from.x + Math.sin(a) * r, z: from.z + Math.cos(a) * r };
          const m = new THREE.Mesh(SPEAR, SPEAR_M); m.position.y = .55; m.rotation.set(rnd(-.25, .25), 0, rnd(-.25, .25));
          later(r / R * .25, () => { limit(o => o.hazard && o.name === S.name, SF, S); pop(p, .3, 'dust'); hazardAt(X, p, durOf(S), { reach: .25, mesh: m, early: st['hazard_damage_+%_final_for_first_500_ms_when_not_killed_by_self'],
            then: q => { for (const d of inside(q, X.A)) inflict(d, 'maim', S, 1, null, { dur: MAIM.time, mag: MAIM.move + st['spearfield_maim_slows_an_additional_%'] }); } }); });
        }
        return;
      }
      if (P.corpse) { c = useCorpse(S); if (!c) return; }
      if (P.ground === 'gas') gasBurst(c, R); else fx.ring(c, .2, R, S.el, .45);
      // its ground grows its % a second up to its most (Decompose); a cloud made of a corpse keeps that monster's life
      const zs = S.dmg?.stats || {}, gr = zs['active_skill_ground_effect_area_of_effect_+%_final_per_second'];
      if (P.ground) { ground(P.ground, c, R, dur, S, gr && { per: gr, max: zs['active_skill_ground_effect_area_of_effect_+%_final_per_second_max'] }).corpse = c.life; area(c, R, S, { mult: .5 }); return; }
      const dec = fx.decal(c, R, P.plant ? 'cracks' : 'rune', S.el, { a: .55, spin: P.plant ? 0 : .3 }); let tk = 0;
      if (P.plant) limit(o => o.plant && o.name === S.name, S.dmg?.stats?.number_of_vine_arrow_pod_allowed, S);
      limit(o => o.name === S.name && !o.plant, S.dmg?.stats?.ritual_of_power_maximum_number_of_rituals ?? S.dmg?.stats?.number_of_poison_cloud_allowed, S);   // Profane Ritual, Decompose: up to their most
      // Vine Arrow: its plant's vines latch onto the enemies in their radius (its flower part): its chaos damage over time
      // and slow; a hit of yours that Poisons the plant stores that poison, the vines dealing its share of it (the
      // part's less, its quality's more) as chaos per second for the poison's duration
      const VX = partOf(S, 'VineArrowFlowerPlayer'), vs = VX?.dmg.stats || {}, vk = 'poison_vine_arrow_vine_stored_poison_damage_+%_final';
      const z = thing(holder(c), dur, { name: S.name, plant: P.plant && S, c, R,
        tick(dt, e) {
          if (e.plant) presence(e);
          if (Math.random() < dt * R * 8) fx.emit(1, { p: { x: c.x, y: .05, z: c.z }, r: R * .9, v: .2, up: 1.4, life: .7, size: .22, c: S.el });
          if ((tk -= dt) > 0) return; tk = .5;
          if (!VX) return area(c, e.R, { ...S, self: e, mult: S.mult * (e.more || 1) }, { mult: .25, noPay: e.s > .6, noTouch: true });
          const PS = e.poison?.until > time ? e.poison.dps * (1 + (vs[vk] || 0) / 100) * (1 + (S.dmg.stats[vk] || 0) / 100) : 0;
          for (const d of inside(c, VX.A * e.R / R)) {
            const o = dot(d, { ...VX, mult: VX.mult * (e.more || 1), P: { ...VX.P, dur: .6 } }); if (PS) o.dps += defence(d, 'chaos', PS * (e.more || 1), false);
            d.slows.push({ until: time + .6, pct: (vs['active_skill_base_slow_debuff_movement_speed_+%_final'] || 0) * slowK(S) });
          }
        },
        touch(by) {   // a hit of yours that can Poison: its chance, the poison of its average physical and chaos damage
          const A = by.dmg?.ail; if (!VX || by.src || !(Math.random() * 100 < (A?.poison || 0))) return;
          const H = by.dmg.hits || {}, n = ['physical', 'chaos'].reduce((t, el) => t + (H[el] ? (H[el][0] + H[el][1]) / 2 : 0), 0) * (by.mult ?? 1) * GAME.poison_per_minute / 6000;
          if (n > (this.poison?.until > time ? this.poison.dps : 0)) this.poison = { dps: n, until: time + DUR.poison * (A.poisonTime || 1) };
        },
        off: () => dec.remove() });
      if (z.plant) planted(z);
    },
    dot(S) {
      if (S.P.spread) return contagion(S);
      const R = S.A; let c = S.at;
      if (S.P.corpse) { c = useCorpse(S); if (!c) return; }
      fx.disc(c, R, S.el, .6, { tex: 'patch', a: .7 }); fx.ring(c, .2, R, S.el, .45);
      fx.emit(30, { p: { x: c.x, y: .3, z: c.z }, r: R * .8, v: .6, up: 1.6, life: 1, size: .3, c: S.el, c2: 'poison' });
      for (const d of inside(c, R)) { dot(d, S); d.wob = .5; }
      touch(c, R, S);
    },
    // Animus Splinters: a short-lived copy of you that uses one of its Socketed Skills once and vanishes. Its look
    // (falselife .epk/.pet): on you a shimmer with blue rune embers and wisps (falselife_activate); beside you a blur and
    // curls of blue (false_life_spawn) out of which the copy steps, deep blue with pale cyan light (falselife_skin,
    // falselife_spectre_skin: RGB up to 0.42 / 0.88 / 1), and fades in its wisps (flaselife_wisps). note: where the copy
    // stands and which skill it uses when it holds two are not in the data: beside you, one of them at random
    splinters(S) {
      const js = api.build().gems.map((_, j) => j).filter(j => api.usedBy(j) === S.g && base(j)); if (!js.length) return;
      const j = js[Math.floor(rnd(js.length))], b = base(j), d = near(pp, 30), at = d ? { x: d.pos.x, z: d.pos.z } : { ...S.at };
      const a = Math.atan2(at.x - pp.x, at.z - pp.z) + (rnd(1) < .5 ? 1 : -1) * Math.PI / 2, p = { x: pp.x + Math.sin(a) * 1.5, z: pp.z + Math.cos(a) * 1.5 };
      fx.glow({ x: pp.x, y: 1.1, z: pp.z }, 1.8, SPLINTER, .4, 2); fx.emit(18, { p: { x: pp.x, y: .3, z: pp.z }, r: .4, h: 1.5, up: 1.4, v: .3, life: .8, size: .13, c: SPLINTER, c2: 0x0b2cff, k: 2, drag: 1 });
      fx.bolt(V(pp.x, 1.1, pp.z), V(p.x, 1, p.z), SPLINTER, .25, .04, 0);
      visage(p, at, { name: S.name, c: SPLINTER, body: 0x8fe6ff, glow: .85, a: .55, dark: 0x0b2cff, back: { x: 0, z: 0 }, look: api.look?.(),
        spawn: q => { fx.ball({ x: q.x, y: 1, z: q.z }, 1.1, SPLINTER, .35, 1.5); fx.glow({ x: q.x, y: 1.2, z: q.z }, 2, SPLINTER, .45, 2.2);
          fx.emit(26, { p: { x: q.x, y: .3, z: q.z }, r: .6, h: 1.6, v: 1.4, life: .5, size: .2, grow: 1.5, c: SPLINTER, c2: 'white', k: 1.6, drag: 2.5 });
          fx.emit(14, { p: { x: q.x, y: .1, z: q.z }, r: .5, up: 2, v: .3, life: .9, size: .12, c: 0x2a5bff, c2: SPLINTER, k: 2, drag: 1 }); } },
        () => use(j, { at, src: 'meta' }), b.P, b);
    },
    buff(S) {
      const P = S.P, st = S.dmg?.stats || {};
      if (P.corpse && !useCorpse(S)) return;
      // Animus Exchange: it sacrifices up to its life (leaving you 1) for its share as Runic Ward, which can Overflow
      const AX = st['animus_exchange_gain_%_maximum_life_spent_as_ward'];
      if (AX) { const n = Math.max(0, Math.min(st.animus_exchange_spend_up_to_X_life, me.life - 1)); me.life -= n; me.ward = overflow(me.ward, me.maxW, n * AX / 100);
        // its look (animusexchange .mat's Runic Ward blue, RGB 0.07 / 0.37 / 1): sparks at your wrist (onact_wrist.pet), a
        // Kalguuran rune on the ground under you in a wave of blue (surge.pet), runes rising off you and your skin glowing
        // blue for a moment (animusexchange_runicgain.epk's skin pass)
        const H = hand(); fx.emit(12, { p: { x: H.x, y: H.y, z: H.z }, r: .15, v: 1, life: .4, size: .1, c: WARD, c2: 'white', k: 2, drag: 2 });
        const RN = fx.decal(pp, 1.4, 'rune', WARD, { a: .85, spin: .8 }); later(.5, () => RN.remove());
        fx.ring(pp, .3, 1.6, WARD, .5, { a: .7 }); fx.emit(24, { p: { x: pp.x, y: .3, z: pp.z }, r: .4, h: 1.6, up: 1.6, v: .4, life: .9, size: .16, c: WARD, c2: 'white', k: 2, drag: 1 });
        fx.num({ x: pp.x - .5, y: 1.4, z: pp.z }, '−' + short(n), css('blood'), .46); fx.num({ x: pp.x + .5, y: 1.7, z: pp.z }, '+' + short(n * AX / 100), '#5a9bff', .52, true);   // what it paid and what it gave
        me.skin = { at: time, hex: WARD, dur: 1.5 }; return say(`${S.label}: +${Math.round(n * AX / 100)} ${t('Runic Ward')}`, WARD); }
      // Hollow Shell: its pulse spends all your Runic Ward (on top of its cost) for its share of it as Guard, for its duration
      // (the higher Guard stays, up to 200% of your life), on you no more than once every its per-target cooldown
      const HS = st['skill_hollow_shell_spent_ward_%_to_grant_as_guard'];
      if (HS) { const w = (S.wardPaid || 0) + me.ward; spendWard(me.ward);
        if (time < me.hollowAt) return; me.hollowAt = time + st.hollow_shell_per_target_cooldown_ms / 1000;
        const g = w * HS / 100; fx.ring(pp, .3, S.A, 'holy', .45); guardFor(g, durOf(S)); return say(`${S.label}: ${Math.round(g)}`, 'holy'); }
      // Refutation: spends all your Runic Ward; for its duration you Block every blockable hit and Parry its attacker
      // (activeBlock), with its less Stun Threshold, less by its more per 10 Ward spent (hurt)
      if (st['runic_fortress_stun_threshold_+%_final'] != null) { const w = me.ward; spendWard(w); me.refute = { until: time + durOf(S), st, stun: (1 + st['runic_fortress_stun_threshold_+%_final'] / 100) * (1 + Math.floor(w / 10) * (st['runic_fortress_stun_threshold_+%_final_per_10_ward_spent'] || 0) / 100) }; return say(t('{0} active', S.label), 'gold'); }
      // Rain of Blades: for its duration its blades fall on the enemies your projectile attacks hit (hit)
      if (st['triggered_rain_of_blades_%'] != null) { me.blades = { until: time + durOf(S), S }; return say(t('{0} active', S.label), 'gold'); }
      // Emergency Reload: every clip reloaded, and your crossbow ammunition's bolts deal its more damage for its duration (use)
      const ER = st['emergency_reload_damage_+%_final'];
      if (ER) { for (const k in clips) delete clips[k]; me.ereload = { until: time + durOf(S), more: 1 + ER / 100 }; setBuff({ label: S.label, name: S.name, c: css('gold'), s: durOf(S) }); return say(t('{0} active', S.label), 'gold'); }
      if (S.name === 'Barrage') barrageReady(S.spent > 0); else { fx.ring(pp, 1.8, .3, S.el, .4); fx.pillar(pp, .5, 2.6, S.el, .35, 2); }
      // Barrage: repeats from its stats (else the scene's 2, one more per charge spent: Unleash), each with its less damage
      // Ice-Tipped Arrows: its number of your next projectile attacks are empowered, for its duration (icetip)
      const IT = partOf(S, 'IceTippedArrowsIceFragmentPlayer');
      if (IT) { const uses = S.dmg.stats.shearing_bolts_number_of_empowered_attacks; empower = empower.filter(e => e.type !== 'icetip'); empower.push({ type: 'icetip', label: S.label, name: S.name, el: 'cold', uses, s: durOf(S), X: IT, cv: S.dmg.stats['shearing_bolts_non_skill_base_physical_damage_%_to_convert_to_cold'] }); say(t('{0} active', S.label) + ` ×${uses}`, 'cold'); }
      else if (P.repeats) { const st = S.dmg?.stats || {}, n = (st.empower_barrage_base_number_of_barrage_repeats ?? 2) + (st.empower_barrage_number_of_barrage_repeats_per_frenzy_charge ?? 1) * S.spent;
        empower = empower.filter(e => e.type !== 'repeat'); empower.push({ type: 'repeat', flag: P.repeats, n, charged: S.spent > 0, less: st['empower_barrage_damage_-%_final_with_repeated_projectiles'] || 0, cd: st['empower_barrage_cooldown_%_of_attack_time'], max: st.empowered_barrage_maximum_cooldown_ms / 1000, label: S.label, name: S.name, s: sh(S).duration || 12 }); say(t('{0}: your next skill repeats {1} times', S.label, n), 'gold'); }
      else if (P.empowers && P.els.length) { empower = empower.filter(e => e.type !== 'infuse'); empower.push({ type: 'infuse', el: P.els[0], label: S.label, name: S.name, s: 12 }); say(t('{0}: your next attack gains {1}', S.label, t(cap(P.els[0]))), P.els[0]); }
      else { setBuff({ label: S.label, name: S.name, c: css(S.el), s: P.dur || 6 }); say(t('{0} active', S.label), S.el); }
    },
    area(S) {
      const P = S.P, R = S.A; let c = S.at;
      if (P.corpse) { c = useCorpse(S); if (!c) return; }
      // Detonate Dead: the corpse explodes after its delay, its spell damage and its permillage of the corpse's
      // monster's life as physical
      const cs = S.dmg?.stats || {}, CP = c.life && cs.corpse_explosion_monster_life_permillage_physical;
      if (CP) {
        const n = c.life * CP / 1000, w = (cs.explosion_delay_ms || 0) / 1000, off = ddBloat(c, w);
        return later(w, () => { off(); ddBlast(c, R); area(c, R, S); lifeBlast(c, R, S, 'physical', n); });
      }
      if (P.stages && !P.els.length && P.dur) {   // a rune on the ground that only buffs (Sigil of Power)
        const dec = fx.decal(pp, R, 'rune', S.el, { a: .6, spin: .25 });
        thing(holder(pp), P.dur, { off: () => dec.remove() });
        setBuff({ label: S.label, name: S.name, c: css(S.el), s: P.dur }); say(t('{0} active', S.label), S.el);
        return;
      }
      if (P.consumes.length && S.R >= 6) {   // strikes only the enemies that carry the state, wherever they stand in range
        const list = inside(S.from, R).filter(d => P.consumes.some(s => has(d, s)));
        fx.ring(S.from, .3, R, S.el, .5, { a: .4 });
        if (!list.length) return toast(t('{0} finds nothing to consume ({1})', S.label, P.consumes.map(s => t(STATE[s])).join(', ')));
        list.forEach((d, k) => later(k * .03, () => {
          if (S.els.includes('lightning')) fx.bolt(V(d.pos.x + rnd(-1, 1), 12, d.pos.z + rnd(-1, 1)), V(d.pos.x, 0, d.pos.z), S.el, .22, .07, .5); else fx.pillar(d.pos, .5, 5, S.el, .3);
          pop(d.pos, 1, S.el); hit(d, S);
        }));
        return;
      }
      if (S.R >= 6 && !S.src) c = S.from;
      if (S.name === 'Detonate Living') { const at = me.culledAt; dlCast(c); area(c, R, S); if (me.culledAt === at) dlWhiff(c); return; }   // a whiff when it detonates none
      boom(c, R, S);
      if (P.ground) ground(P.ground, c, R, Math.min(P.dur || GROUND_TIME[P.ground] || SIM.groundTime, 10), S);
    },
    meteor(S) {
      const CM = S.name === 'Comet', X = S.infs?.includes('fire') && infPart(S, 'fire'); if (X) S = X;   // Comet: a devastating blast of ice and fire
      const P = S.P, R = S.A, fall = S.dmg?.stats?.comet_fall_time_ms, delay = fall ? fall / 1000 : P.delay ?? (P.dur && P.dur <= 4 ? P.dur : SIM.meteor);
      const d = P.attack ? near(S.at, SIM.snap) : null, c = d ? { x: d.pos.x, z: d.pos.z } : S.at;
      if (CM) return comet(c, R, S, delay, !!X);
      fx.telegraph(c, R, S.el, delay);
      // Skyfall: where it lands, its Temporary Minions (more with a Verisium Infusion consumed: its infused part's),
      // up to its limit, for its duration
      const st = S.dmg?.stats || {}, VM = st.verisium_comet_number_of_minions_to_create;
      if (VM) later(delay, () => {
        const n = VM + (S.infs?.includes('verisium') ? partOf(S, 'SkyfallInfusedPlayer')?.dmg.stats.verisium_comet_number_of_minions_to_create || 0 : 0);
        for (let k = 0; k < n; k++) { limit(o => o.kind === S.name, tmpN(st.base_number_of_verisium_octopus_minions_allowed)); minion(S, around(c, R), durOf(S), { kind: S.name }); }
      });
      if (S.els.includes('lightning') && !S.els.includes('fire')) return later(delay, () => { fx.bolt(V(c.x + 1, 17, c.z - 1), V(c.x, 0, c.z), S.el, .28, .13, .6); boom(c, R, S); });
      const fly = Math.min(.4, delay);
      later(delay - fly, () => lob(fx.orb(S.el, clamp(R * .3, .3, .9)), V(c.x + 6, 24, c.z - 5), V(c.x, .3, c.z), fly, 0, () => { boom(c, R, S); shake = .5; }, { trail: S.el, big: true }));
    },
    // Ember Fusillade: each cast conjures an Ember over you, up to its most, and starts the time of all of them again; when
    // it runs out the whole Fusillade launches, one after another (its delay): the first at the enemy last targeted, the
    // next at different ones within its targeting radius, each exploding in its area with its more damage per Ember fired
    // before it. A Lightning Infusion consumed makes the Fusillade's impacts send beams that Chain (its beam part)
    ember(S) {
      const st = S.dmg?.stats || {}; let F = fus[S.name];
      if (!F || !objs.includes(F.e)) {
        const g = new THREE.Group();
        F = fus[S.name] = { g, n: 0, beam: false, e: thing(g, Infinity, { name: S.name, tick(dt, e) {
          g.position.set(pp.x, 0, pp.z); g.rotation.y += dt * 1.5;
          if (time < F.at) return; e.dead = true;
          const first = near(F.at0, SIM.snap) || near(pp, SIM.castRange), seen = new Set(), every = (st.blazing_cluster_delay_between_projectiles_ms || 100) / 1000, R2 = (st.blazing_cluster_subsequent_targeting_radius || 0) / 10;
          const X = F.beam && partOf(F.S, 'EmberFusilladeBeamPlayer');
          for (let k = 0; k < F.n; k++) later(k * every, () => {
            const d = k && first ? dummies.find(e => !e.dead && !seen.has(e) && dist(e.pos, first.pos) <= R2) || first : first; if (d) seen.add(d);
            const to = d ? { x: d.pos.x, z: d.pos.z } : around(pp, 4), Y = { ...F.S, mult: F.S.mult * (1 + (st['ember_fusillade_damage_+%_final_per_ember_fired'] || 0) * k / 100) };
            lob(fx.orb('fire', .16), V(pp.x, 2.4, pp.z), V(to.x, .2, to.z), .35, 1.2, () => {
              boom(to, S.A, Y);
              const e2 = X && near(to, 6); if (e2) chain(V(to.x, 1, to.z), e2, X, sh(X).chains || 0);
            }, { trail: 'fire' });
          });
        } }) };
      }
      if (F.n < (st.blazing_cluster_maximum_number_of_projectiles_allowed || 1)) {
        const m = fx.orb('fire', .16), a = F.n * 1.3; m.position.set(Math.sin(a) * .8, 2.4 + (F.n % 3) * .15, Math.cos(a) * .8); F.g.add(m); F.n++;
      }
      F.at = time + (sh(S).duration || 1.3); F.at0 = { x: S.at.x, z: S.at.z }; F.S = S; if (S.infs?.includes('lightning')) F.beam = true;
    },
    // Snap: consumes the freeze, shock or ignite of the enemy at the cursor for a blast of that element (its cold hit, or
    // its lightning / fire part), more from a unique; it leaves that kind's Infusion Remnant (its chance of one more) and
    // spreads, after its delay, to the enemies within its secondary radius with the same ailment, consuming theirs; those
    // do not spread further (its proliferation depth of 2)
    snap(S) {
      const st = S.dmg?.stats || {}, A = S.P.consumes, d = near(S.at, SIM.snap, e => A.some(a => e.st[a] > 0));
      if (!d) return toast(t('{0} finds nothing to consume ({1})', S.label, A.map(a => t(STATE[a])).join(', ')));
      const a = A.find(a => d.st[a] > 0), el = SIPHON[a][0], X = a === 'freeze' ? S : partOf(S, `Snap${cap(el)}Player`) || S, spread = S.G?.radius2 || S.A * 2;
      const blast = (e, depth) => {
        if (e.dead || !(e.st[a] > 0)) return; clear(e, a);
        const Y = { ...X, mult: X.mult * uniqueMore(e, st['snap_damage_+%_final_if_created_from_unique']) };
        fx.pillar(e.pos, .4, 3, el, .3); boom(e.pos, S.A, Y);
        if (depth === 1) { infRemnant(el, e.pos); if (Math.random() * 100 < (st['chance_%_to_spawn_another_infusion_remnant'] || 0)) infRemnant(el, around(e.pos, SIM.pickup)); }
        if (depth < (st.snap_maximum_proliferation_depth || 1)) for (const o of dummies) if (o !== e && !o.dead && o.st[a] > 0 && dist(o.pos, e.pos) <= spread)
          later(((st.snap_proliferation_base_delay_ms || 0) + rnd(st.snap_proliferation_delay_range_ms || 0)) / 1000, () => blast(o, depth + 1));
      };
      blast(d, 1);
    },
    // Volcano: channelled, a stage each cast time (its % of it) up to its most; on release it rises at the target and
    // erupts with its more damage and its additional projectiles per stage after the first, then sprays its
    // projectiles every interval for its duration (and when slammed: its slam part); its own limit. Each projectile
    // lands within its secondary radius and hits there (its projectile part, a smaller area).
    // note: the data gives no base number of projectiles: one per spray, as a skill without one has
    volcano(S) {
      const st = S.dmg?.stats || {}, c = S.at, step = (S.dmg?.speed ? 1 / S.dmg.speed : SIM.castTime) * (st['volcano_gain_stage_every_%_of_cast_time'] || 100) / 100;
      const n = Math.min(st.volcano_maximum_number_of_stages || 1, 1 + Math.floor((S.held || 0) / step)), X = partOf(S, 'VolcanoProjectilePlayer'), XS = partOf(S, 'VolcanoSlamPlayer');
      const one = sh(X || S).projectiles || 1, spread = S.G?.radius2 || 3;
      limit(o => o.volcano && o.name === S.name, st.volcano_base_number_of_geysers_allowed || 1, S);
      const spray = (k, Y) => { for (let j = 0; j < k; j++) { const a = rnd(TAU), r = Math.sqrt(rnd()) * spread, q = { x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r };
        lob(fx.orb('fire', .14), V(c.x, 1.2, c.z), V(q.x, .1, q.z), .5, 2.4, () => boom(q, Y.A, { ...Y, mult: S.mult }, { soft: true }), { trail: 'fire' }); } };
      fx.text({ x: c.x, y: 2.4, z: c.z }, t('Stage {0}', n), css('fire'));
      boom(c, S.A, { ...S, mult: S.mult * (1 + (st['volcano_initial_explosion_damage_+%_final_per_additional_stage'] || 0) * (n - 1) / 100) }); shake = .3;
      if (X) spray(one + (st.volcano_initial_explosion_number_of_additional_projectiles_per_additional_stage || 0) * (n - 1), X);
      const dec = fx.decal(c, S.A, 'cracks', 'fire', { a: .7 }), every = (st.volcano_fires_projectiles_every_x_ms || 500) / 1000; let tk = every;
      thing(holder(c), sh(S).duration || 8, { name: S.name, r: S.A,
        volcano: () => XS && later((st.volcano_delay_between_slams_ms || 0) / 1000, () => spray(one, XS)),
        tick(dt) { if (Math.random() < dt * 6) fx.emit(1, { p: { x: c.x, y: .4, z: c.z }, r: S.A * .5, v: .4, up: 2, life: .8, size: .3, c: 'fire', c2: 'ember' });
          if (X && (tk -= dt) <= 0) { tk = every; spray(one, X); } },
        off: () => dec.remove() });
    },
    // Fragments Of The Past: a Verisium volcano at the target, its own limit, hitting its area on the eruption; it fires its
    // Ice Fragments (their part's number) every its interval for its duration, and its additional ones on the eruption.
    // A fragment lands between its least and most distance of the volcano, on the nearest enemy there if one is (its
    // auto-aim), and detonates after its time over its area. note: the cone the fragments fly in is not followed
    fragments(S) {
      const st = S.dmg?.stats || {}, c = S.at, X = partOf(S, 'FragmentsOfThePastFragmentPlayer'), xs = X?.dmg?.stats || {}, n = sh(X || S).projectiles || 1;
      const lo = (xs.ice_fragment_min_chunk_distance || 0) / 10, hi = (xs.ice_fragment_max_chunk_distance || 0) / 10, wait = (xs.base_skill_detonation_time || 0) / 1000;
      limit(o => o.fragments, st.base_number_of_ice_volcanos_allowed, S);
      const fire = k => { for (let j = 0; j < k; j++) {
        const d = near(c, hi), a = rnd(TAU), r = lo + Math.sqrt(rnd()) * (hi - lo), q = d && dist(d.pos, c) >= lo ? { x: d.pos.x, z: d.pos.z } : { x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r };
        lob(fx.orb('cold', .14), V(c.x, 1.2, c.z), V(q.x, .1, q.z), .5, 2.4, () => { const m = fx.decal(q, .35, 'ring', 'cold', { a: .8 }); later(wait, () => { m.remove(); boom(q, X.A, { ...X, mult: S.mult }, { soft: true }); }); }, { trail: 'cold' }); } };
      boom(c, S.A, S); fx.pillar(c, .4, 2.4, 'gold', .5, 2);
      if (X) fire(n + (st.ice_volcano_eruption_additional_ice_fragment_projectiles || 0));
      const dec = fx.decal(c, S.A, 'cracks', 'gold', { a: .7 }), every = st.ice_volcano_fires_projectiles_every_x_ms / 1000; let tk = every;
      thing(holder(c), durOf(S), { name: S.name, fragments: true, r: S.A,
        tick(dt) { if (Math.random() < dt * 6) fx.emit(1, { p: { x: c.x, y: .4, z: c.z }, r: S.A * .5, v: .4, up: 2, life: .8, size: .3, c: 'cold', c2: 'gold' });
          if (X && (tk -= dt) <= 0) { tk = every; fire(n); } },
        off: () => dec.remove() });
    },
    beam(S) {
      const L = S.R || 10, c = S.from, b = { x: c.x + S.dx * L, z: c.z + S.dz * L };   // note: 1 m wide, the scene's: the data gives no width
      fx.strip(c, b, 1, S.el, .35); fx.bolt(V(c.x, 1.1, c.z), V(b.x, 1.1, b.z), S.el, .2, .05, 0);
      for (const d of dummies) if (!d.dead && segDist(d.pos, c, b) <= .5 + SIM.body) hit(d, S);
      touch({ x: (c.x + b.x) / 2, z: (c.z + b.z) / 2 }, L / 2, S);
    },
  };
  K.cone = K.sweep;
  K.herald = K.aura = K.meta = K.minion = K.field = K.toggle;
  // Spear of Solaris: the spear lands at the target and hits its area, then its skybeam pulses there (its pulse part: its
  // number of pulses, its delay) over Ignited Ground that expands to its +% area by the skill's end (its ground part)
  K.solaris = S => {
    const c = { x: S.at.x, z: S.at.z }, X = partOf(S, 'SpearOfSolarisPulsePlayer'), Y = partOf(S, 'SpearOfSolarisGroundPlayer');
    lob(fx.arrow(S.el), hand(), V(c.x, .1, c.z), .5, 4, () => {
      boom(c, S.A, S); shake = .4; if (!X) return;
      const xs = X.dmg.stats, n = xs.solaris_spear_number_of_pulses || 1, every = (xs.solaris_spear_pulse_delay_ms || 200) / 1000, dur = n * every;
      const gx = Y?.dmg.stats['solaris_spear_ground_expands_to_+%_final_by_skill_end'] || 0; if (Y) ground('burning', c, X.A, dur, Y, { per: gx / dur, max: gx });
      for (let k = 0; k < n; k++) later(k * every, () => { fx.pillar(c, X.A * .4, 14, 'gold', .2); boom(c, X.A, X, { soft: true }); });
    }, { trail: 'fire' });
  };
  // Walking Calamity: for its duration meteors fall on the enemies around you at its interval, more often per enemy in its
  // area after the first (its +% each, up to its cap), every so many a large one (its part) not on the same enemy within
  // its time; you gain its % of damage as fire and its Rage regeneration
  // note: without Bear form in the scene, its effects are never suppressed; a small meteor's area the data does not give: 1 m
  // note: The Stars Answer (Runeseeker's Call) is not simulated: how long its Starfall lasts is in none of the data
  K.calamity = S => {
    const st = S.dmg?.stats || {}, dur = durOf(S), L = partOf(S, 'WalkingCalamityMeteorLargePlayer'), last = new Map(); let tk = 0, n = 0;
    me.calamity = { until: time + dur, rage: st.walking_calamity_base_rage_regeneration_per_minute || 0 };
    setBuff({ label: S.label, name: S.name, c: css('fire'), s: dur, sup: true, gain: { el: 'fire', pct: st['walking_calamity_non_skill_base_all_damage_%_to_gain_as_fire'] || 0 } });
    fx.ring(pp, .3, S.A, 'fire', .6); shake = .3;
    thing(holder(pp), dur, { name: S.name, tick(dt) {
      if ((tk -= dt) > 0) return;
      const ins = inside(pp, S.A), more = Math.min(st['walking_calamity_meteor_frequency_+%_cap'] || 0, Math.max(0, ins.length - (st.walking_calamity_ignore_first_x_enemies_for_frequency_increase || 0)) * (st['walking_calamity_meteor_frequency_+%_per_enemy_in_walking_calamity_radius'] || 0));
      tk = (st.walking_calamity_spawn_meteor_every_ms || 150) / 1000 / (1 + more / 100);
      const big = L && ++n % (st.walking_calamity_large_meteor_every || Infinity) === 0, pick = ins.filter(d => !big || time - (last.get(d) ?? -99) >= st.walking_calamity_large_meteor_same_target_prevention_duration_ms / 1000);
      const d = pick[Math.floor(rnd(pick.length))], q = d ? { x: d.pos.x, z: d.pos.z } : around(pp, S.A), X = big ? L : S, r = big ? L.A : 1;
      if (big && d) last.set(d, time);
      fx.streak(V(q.x + 2, 13, q.z - 1.5), V(q.x, 0, q.z), 'fire', big ? .3 : .14, .07, 1.8); later(.16, () => { pop(q, r, 'fire'); area(q, r, X); });
    } });
  };
  // Apocalypse: for its duration, at its interval, one of its Elemental skills around an enemy near you: its Hailstorm
  // (its bolts at random intervals within its least and most, each in its secondary radius), its meteor (its fire part,
  // after its time to impact) or its static field (its lightning part's pulses, then its final strike).
  // Its look (unleash_the_elements .ao/.pet/.mat): on the cast fire and embers pulled in to you, snow and bolts of
  // lightning on you, the ground under you cracked and glowing and your skin lit orange (onact_charge_skin: 1 / 0.53 /
  // 0.2); the world darkened in a warm tint while it lasts (environmentdarkening: 1 / 0.69 / 0.54); hailstones falling
  // in pale blue trails, bursting in a cyan ring of frost and snow (cold: 0.62 / 0.79 / 1, ring 0.65 / 1 / 1); a burning
  // meteor out of the sky in a trail of flame, its blast leaving a glowing crater, smoke and debris (fire: 1 / 0.45 /
  // 0.11); a blue marker pulsing on the ground with sparks, then a bolt out of the sky and a blue shockwave (lightning:
  // beam 0.15 / 0.24 / 1, shockwave 0.24 / 0.48 / 1)
  const APO = { skin: 0xff8833, ice: 0x9ec9ff, frost: 0xa6ffff, fire: 0xff731c, bolt: 0x3d6bff, wave: 0x3d7aff, flash: 0xc2c9ff, smoke: 0x3a3028 };
  K.apocalypse = S => {
    const st = S.dmg?.stats || {}, dur = durOf(S), F = partOf(S, 'ApocalypseFirePlayer'), L = partOf(S, 'ApocalypseLightningPlayer'), LF = partOf(S, 'ApocalypseLightningFinalStrikePlayer');
    const r2 = S.G?.radius2 || .8; let tk = 0;
    setBuff({ label: S.label, name: S.name, c: css('lightning'), s: dur });
    me.apo = { until: time + dur }; me.skin = { at: time, hex: APO.skin, dur: 1 };
    const G = fx.decal(pp, 2.4, 'cracks', APO.fire, { a: .85 }); later(1.2, () => G.remove());
    fx.glow({ x: pp.x, y: 1.1, z: pp.z }, 3, APO.fire, .5, 3);
    for (let k = 0; k < 24; k++) { const a = k / 24 * TAU, q = { x: pp.x + Math.cos(a) * 3, y: rnd(.2, 1.4), z: pp.z + Math.sin(a) * 3 }; fx.emit(1, { p: q, dir: V(-Math.cos(a), .15, -Math.sin(a)), v: 5, life: .55, size: .3, c: 'fire', c2: 'ember', k: 2, drag: .5 }); }
    fx.emit(16, { p: { x: pp.x, y: 2.4, z: pp.z }, r: .9, v: .3, life: .9, size: .1, c: 0xd8ecff, c2: 'white', g: 2 });
    for (let k = 0; k < 3; k++) later(k * .12, () => fx.bolt(V(pp.x + rnd(-1.2, 1.2), 7, pp.z + rnd(-1.2, 1.2)), V(pp.x, 1.2, pp.z), APO.bolt, .18, .06, .4));
    const one = [
      c => { let w = 0; for (let k = 0; k < (st.unleash_blizzard_number_of_bolts || 1); k++) { w += rnd(st.unleash_blizzard_minimum_bolt_frequency_ms, st.unleash_blizzard_maximum_bolt_frequency_ms) / 1000; const q = around(c, 2);
        later(w, () => lob(fx.orb('ice', .13), V(q.x + 1.2, 11, q.z - .9), V(q.x, .1, q.z), .3, 0, () => {
          fx.ring(q, .1, r2 * 1.6, APO.frost, .35, { a: .8 }); const D = fx.decal(q, r2 * 1.3, 'patch', APO.ice, { a: .55 }); later(.8, () => D.remove());
          fx.emit(10, { p: { x: q.x, y: .2, z: q.z }, r: r2 * .5, v: 2, up: 1.2, life: .45, size: .14, c: 0xe6f6ff, c2: APO.frost, drag: 2, g: 3 }); area(q, r2, S); }, { trail: APO.ice })); } },
      F && (c => { const w = F.dmg.stats.unleash_meteor_time_till_impact_ms / 1000, fly = Math.min(.45, w); fx.telegraph(c, F.A, 'fire', w);
        later(w - fly, () => lob(fx.orb('fire', .5), V(c.x + 5, 22, c.z - 4), V(c.x, .3, c.z), fly, 0, () => {
          pop(c, F.A, 'fire'); boom(c, F.A, F); shake = .4; fx.glow({ x: c.x, y: 1, z: c.z }, F.A * 2.5, APO.fire, .35, 3);
          const D = fx.decal(c, F.A * .9, 'cracks', APO.fire, { a: .8 }); later(1.4, () => D.remove());
          fx.emit(18, { p: { x: c.x, y: .3, z: c.z }, r: F.A * .4, v: F.A * 1.6, flat: true, life: .9, size: .5, grow: 2, c: APO.smoke, drag: 2 });
          fx.emit(14, { p: { x: c.x, y: .3, z: c.z }, r: .5, v: 3, up: 4, life: .8, size: .14, c: 0x5a4030, c2: 'fire', g: 10 }); }, { trail: 'fire', big: true })); }),
      L && (c => { const n = L.dmg.stats.unleash_static_field_number_of_pluses || 1, w = L.dmg.stats.unleash_static_field_time_till_final_strike_ms / 1000, dec = fx.decal(c, L.A, 'ring', APO.bolt, { a: .6, pulse: 9 });
        for (let k = 0; k < n; k++) later(k * w / n, () => { fx.ring(c, .2, L.A, APO.bolt, .4, { a: .7 }); fx.emit(6, { p: { x: c.x, y: .2, z: c.z }, r: L.A * .6, v: 1.5, up: 1, life: .3, size: .1, c: APO.flash, c2: 'white', drag: 2 }); area(c, L.A, L); });
        later(w, () => { dec.remove(); fx.bolt(V(c.x, 16, c.z), V(c.x, 0, c.z), APO.bolt, .3, .2, .5); fx.bolt(V(c.x + .3, 16, c.z - .2), V(c.x, 0, c.z), APO.flash, .25, .07, .7);
          fx.ring(c, .3, L.A * 1.7, APO.wave, .4, { a: .8 }); fx.glow({ x: c.x, y: 1, z: c.z }, L.A * 1.3, APO.bolt, .3, 2.4); if (LF) area(c, L.A, LF); }); }),
    ].filter(Boolean);
    thing(holder(pp), dur, { name: S.name, tick(dt) {
      if ((tk -= dt) > 0) return; tk = st.unleash_the_elements_base_trigger_frequency_ms / 1000 / (1 + (st['unleash_the_elements_trigger_frequency_+%'] || 0) / 100);   // its quality's more often
      const d = near(pp, S.A); if (d) one[Math.floor(rnd(one.length))]({ x: d.pos.x, z: d.pos.z });
    } });
  };
  // Archon of Chayula: for its duration you are his Archon: more physical and chaos damage, its chance to Wither on hit, and
  // at its interval Chayula's Will, a chaos tornado that seeks the enemies within its secondary radius at its speed and
  // hits in its area at its interval.
  // Its look (archonofchayula .mat/.pet/.ao): on taking the form a violet flash and flames on you, sparks of pink and a
  // pulse of pale pink and violet (buff_apply: flash 0.74 / 0.35 / 1, sparks 1 / 0.23 / 0.54, growcore 1 / 0.7 / 0.98 and
  // 0.52 / 0.25 / 1); while it lasts your skin glows magenta, your eyes too, with ribbons of chaos rising off you (buff
  // skin pass 0.98 / 0.41 / 1, ribbons and strings 1 / 0.23 / 1); the tornado a near-black core in a dark violet wind
  // (0.01 / 0 / 0.03, 0.28 / 0.2 / 0.44) with pale violet Breach flames and embers on it (0.78 / 0.65 / 1), a violet
  // spiral on the ground under it (0.37 / 0.14 / 1), debris and dust pulled in at its foot
  const CHAYULA = { skin: 0xfa69ff, string: 0xff3bff, flash: 0xbd59ff, spark: 0xff3b8a, pulse: 0xffb3fa, violet: 0x8540ff,
    core: 0x030008, wind: 0x47336f, flame: 0xc7a6ff, spiral: 0x5e24ff };
  K.chayula = S => {
    const st = S.dmg?.stats || {}, dur = durOf(S); let tk = 0;
    me.chayula = { until: time + dur, more: st['archon_of_chayula_physical_and_chaos_damage_+%_final'] || 0, wither: st['archon_of_chayula_withered_on_hit_for_4_seconds_%_chance'] || 0 };
    setBuff({ label: S.label, name: S.name, c: css('chaos'), s: dur });
    fx.glow({ x: pp.x, y: 1.1, z: pp.z }, 3.2, CHAYULA.flash, .5, 3);
    fx.emit(20, { p: { x: pp.x, y: .2, z: pp.z }, r: .35, h: 1.6, up: 2, v: .6, life: .6, size: .3, c: CHAYULA.flash, c2: CHAYULA.string, k: 2, drag: 1 });
    fx.emit(24, { p: { x: pp.x, y: 1.1, z: pp.z }, r: .3, v: 4, life: .45, size: .09, c: CHAYULA.spark, c2: 'white', k: 2.4, drag: 2 });
    fx.ring(pp, .3, 2.6, CHAYULA.pulse, .45, { a: .75 }); later(.1, () => fx.ring(pp, .3, 3.4, CHAYULA.violet, .5, { a: .6 }));
    thing(holder(pp), dur, { name: S.name, tick(dt, e) {
      if ((tk -= dt) > 0) return; tk = st.archon_of_chayula_spawn_chaos_tornado_interval_ms / 1000;
      vortex(S, { x: pp.x, z: pp.z }, S.A, e.dur - e.s, { speed: st.archon_chayula_storm_movement_speed / 10, every: st.archon_of_chayula_tornado_attack_interval_ms / 1000, mult: 1, seek: S.G?.radius2 || 9, look: CHAYULA });
    } });
  };
  // Conductive Runes: its Runes in a cone in front of you (its cone angle, out to its placing set's radius, which your
  // area grows as the explosion's) up to its limit, each arming after its time and going off its activation time after
  // an enemy steps on it (its secondary radius), exploding in its area.
  // Its look (rune_hazard: hazard_trap.ao, hazard_explosion.ao, hazard_wave.ao): a blue wave over the cone as you cast for
  // 1.3-1.5 s (hazard_wave_decal 0 / 0.18 / 1), each rune its glyph on a stone patch (hazard_trap_rune 0.17 / 0.36 / 1,
  // decal 0.2 / 0.5 / 1); stepped on, a priming wave for 0.4 s and embers; its explosion a flash for 0.2 s (0.36 / 0.72 /
  // 0.99), a sphere for 0.35 s (0.19 / 0.51 / 1), lightning dropping on it for 0.1-0.5 s and three rings for 0.35-0.4 s
  // (Lightning Color 0.039 / 0.056 / 0.18), 20 embers for 0.6-2.6 s and debris for 1-3 s (0.71 / 1.23 / 2), 16 puffs of smoke
  // for 1-2 s, its glyph rising for 1 s (0.12 / 0.49 / 0.99) and a crack left for 7.5-12.5 s.
  // note: where in the cone each rune lands is not in the data: spread evenly over it
  const RUNE = { wave: 0x002eff, glyph: 0x2b5cff, flash: 0x5cb8ff, sphere: 0x3082ff, bolt: 0x3750ff, ember: 0x5a9dff, rise: 0x1f7eff, smoke: 0x2c2c2c };
  function runeBoom(p, R) {
    const c = { x: p.x, y: .4, z: p.z };
    fx.flash(c, RUNE.flash, 10, .2, R * 3); fx.glow(c, R * 1.2, RUNE.sphere, .35, 2.6); fx.bolt(V(p.x + rnd(-.3, .3), 7, p.z + rnd(-.3, .3)), V(p.x, 0, p.z), RUNE.bolt, .3, .06);
    for (let k = 0; k < 3; k++) fx.ring(p, .1, R * (.7 + k * .15), RUNE.bolt, .35 + k * .025, { a: .8, y: .1 + k * .1 });
    fx.emit(20, { p: c, r: .2, v: R * 2, up: 2, life: 1.6, size: .05, c: RUNE.ember, k: 2.4, g: 3, drag: 1.5 }); fx.emit(8, { p: c, r: .2, v: R * 2.5, up: 3, life: 2, size: .08, c: RUNE.ember, g: 9, drag: .5 });   // its embers and debris
    fx.emit(16, { p: { x: p.x, y: .2, z: p.z }, r: R * .4, v: .6, up: .8, life: 1.5, size: .5, grow: 1.8, c: RUNE.smoke, smoke: true, a: .35, drag: 1 });
    fx.disc(p, R * .5, RUNE.rise, 1, { y: .5, a: .8 }); fx.disc(p, R * .6, 0x060608, 10, { dark: true, a: .5, hold: .8 });   // its glyph rising, its crack
  }
  K.runes = S => {
    const st = S.dmg?.stats || {}, n = st.rune_hazard_number_of_runes_to_create || 1, half = (st.rune_hazard_cone_angle || 60) / 2 * Math.PI / 180, a0 = Math.atan2(S.dx, S.dz);
    const PR = (st._placement_radius || 0) / (st.active_skill_base_area_of_effect_radius || 1) * S.A || SIM.castRange * .6;   // its placing radius grown as its area is
    fx.sector(pp, S.dx, S.dz, PR, half, RUNE.wave, 1.4, { a: .5, grow: true });
    for (let k = 0; k < n; k++) {
      limit(o => o.hazard && o.name === S.name, st.rune_hazard_base_number_of_runes_allowed, S);
      const a = a0 + rnd(-half, half), r = PR * Math.sqrt(Math.random()), p = { x: pp.x + Math.sin(a) * r, z: pp.z + Math.cos(a) * r };
      hazardAt(S, p, durOf(S), { arm: st.rune_hazard_arming_time_ms / 1000, delay: st.rune_hazard_detonate_time_ms / 1000, reach: S.G?.radius2, c: RUNE.glyph,
        set: q => { fx.ring(q, .1, .6, RUNE.glyph, .4, { a: .8 }); fx.emit(6, { p: { x: q.x, y: .2, z: q.z }, r: .2, v: .3, up: 1, life: 1, size: .05, c: RUNE.ember, k: 2.4 }); },   // primed
        boom: q => runeBoom(q, S.A) });
    }
  };
  // Rolling Magma: a ball of magma lobbed at the target (within its least and most distance) that hits its area where it
  // lands and bounces forward its Chains times (its bounce range each), its impacts setting off Molten Fissures and
  // Volcanos as a Slam does
  K.magma = S => {
    const st = S.dmg?.stats || {}, l = Math.hypot(S.at.x - pp.x, S.at.z - pp.z) || 1, k = clamp(l, st.magma_orb_target_distance_absolute_minimum / 10, st.magma_orb_target_distance_absolute_maximum / 10);
    const bounce = (from, to, left) => lob(fx.orb('fire', .25), V(from.x, from.y ?? 1.2, from.z), V(to.x, .2, to.z), .35, 1.4, () => {
      pop(to, S.A, 'fire'); boom(to, S.A, { ...S, mult: S.mult * (1 + (st['active_skill_damage_+%_final_per_time_chained'] || 0) * (N - left) / 100) }); slammed(S, to, S.A);   // its quality's more per bounce
      if (left > 0) bounce({ x: to.x, y: .2, z: to.z }, { x: to.x + S.dx * st.magma_orb_base_bounce_range / 10, z: to.z + S.dz * st.magma_orb_base_bounce_range / 10 }, left - 1);
    }, { trail: 'fire' });
    const N = sh(S).chains ?? st.number_of_chains ?? 0; bounce({ x: pp.x, z: pp.z }, { x: pp.x + S.dx * k, z: pp.z + S.dz * k }, N);
  };
  // Twister: twisters (its projectiles, spread) moving forward erratically at its speed for its duration, hitting
  // those within every its re-hit interval, Blinding them; one passing over elemental ground, or made from an elemental
  // Whirlwind it consumed, gains its share of its damage as that element
  // Whirling Slash: its slash kicks up a Whirlwind around you (its storm part), one more stage for each use while it is up,
  // up to its most, its area growing per stage; enemies in it are Slowed. Leaving it collapses it: its hit there, more
  // damage per stage. Whirlwind Lance: one where its spear lands, at its most stages (one more with a Frenzy Charge
  // spent), for its duration, up to its most at a time; entering it collapses it. A Whirlwind over elemental ground
  // gains its share of all its damage as that element. Twister consumes one
  // note: the first slash is its first stage; its larger area and more damage count the stages after it (the data does
  // not say);
  // Blind and the knockback are not simulated
  function whirl(S) {
    const WS = partOf(S, 'WhirlingSlashSandstormPlayer'), lance = !WS, W = WS || partOf(S, 'WhirlwindLanceStormPlayer'), st = W?.dmg.stats; if (!W) return;
    const top = st.sandstorm_swipe_max_stages;
    if (!lance) { const o = objs.find(o => o.whirl && !o.lance && !o.dead); if (o) { o.stage = Math.min(top, o.stage + 1); return; } }
    const c = lance ? { ...S.at } : { x: pp.x, z: pp.z }, slow = new Map();
    // its share of all its damage as the element it picked up (the slash's own, from the ground under you)
    const WG = st['windstorm_gain_all_damage_%_as_corresponding_element_if_empowered'], X0 = S.got ? gainAs(W, S.got, WG) : W;
    const make = () => {
      if (lance) limit(o => o.whirl && o.lance, st.windstorm_base_maximum_number_of_storms, S);
      const e = thing(holder(c), lance ? durOf(W) : Infinity, { whirl: true, lance, stage: lance ? top + (S.spent ? 1 : 0) : 1, c, out: !lance || dist(pp, c) > W.A, X: X0,
        R: () => W.A + st['sandstorm_swipe_storm_radius_+_per_stage'] * (e.stage - 1) / 10,
        tick(dt) {
          const R = e.R(); fx.emit(2, { p: { x: c.x + rnd(-R, R), y: rnd(1.5), z: c.z + rnd(-R, R) }, r: .3, v: 2, life: .5, size: .4, c: e.X.el === 'physical' ? 'dust' : e.X.el, smoke: true, a: .3 });
          standSlow(slow, c, R, st['active_skill_base_slow_debuff_movement_speed_+%_final'] * slowK(S), .1);
          const A = absorb(e.X, c, R); if (A !== e.X) e.X = gainAs(e.X, A.got, WG);
          const there = dist(pp, c) <= R; if (!there) e.out = true;
          if (lance ? there && e.out : !there) { e.dead = true; boom(c, R, e.X, { mult: 1 + st['sandstorm_swipe_storm_damage_+%_final_per_stage'] * (e.stage - 1) / 100 }); }
        } });
    };
    if (lance) later(dist(pp, c) / (S.G?.speed || SIM.projSpeed), make); else make();
  }
  // Hexblast: detonates the curses of the enemies in its area that have run at least half their duration, up to its most
  // explosions: each its hit in its secondary area around that enemy, the curse removed
  K.hexblast = S => {
    const st = S.dmg.stats, r = S.A * st.active_skill_base_secondary_area_of_effect_radius / st.active_skill_base_area_of_effect_radius;
    fx.ring(S.at, .3, S.A, 'curse', .35);
    for (const d of inside(S.at, S.A).filter(d => d.curse && d.curse.s <= d.curse.full / 2).slice(0, st.hexblast_maximum_number_of_explosions)) { const m = 1 + (st['hexblast_damage_+%_final_per_second_remaining_curse_duration'] || 0) * Math.floor(d.curse.s) / 100; d.curse = d.hexes?.pop() || null; boom({ x: d.pos.x, z: d.pos.z }, r, { ...S, mult: S.mult * m }); }   // its quality's more per second the curse had left
  };
  // Volatile / Bitter Dead: consumes its corpses (up to its number) where you aim, each a core for its duration that seeks
  // the nearest enemy, its aura part chilling (Bitter) or igniting (Volatile) those around it - the aura deals no damage,
  // its hit only the size of that ailment - and explodes at its end (its explosion part). Bitter Dead's explosion leaves a
  // rune (its rune part) that deals its cold damage over time to the enemies on it for its duration.
  // note: the core's speed, how often its aura reaches and the rune's tick are not in the data: 3 m/s, 0.5 s, 0.25 s; the
  // rune's less action speed (bitter_dead_action_speed_+%_final_for_rune) is not simulated
  // Bitter Dead's look (Metadata/Effects/Spells/supports/RunicSupports/BitterDead): a pale blue sphere wreathed in blue
  // flames over a rune tile, a blue flash with snow, and the rune glyph (MaskedRuneRarePower) glowing on the ground
  const BD = { core: 0xa8d4ff, flame: 0x6be0ff, deep: 0x268fed, ring: 0x48beff, snow: 0xdfeeff };
  // a texture of the game (poe2_data/available/img/art) as fx texture k, loaded once; its name for fx.decal
  const artTex = (k, f) => (fx.T[k] ||= Object.assign(new THREE.TextureLoader().load(`poe2_data/available/img/art/${f}.webp`), { colorSpace: THREE.SRGBColorSpace }), k);
  K.volatile = S => {
    const ks = Object.keys(S.dmg.parts || {}), X = partOf(S, ks.find(k => /Explosion/.test(k))), U = partOf(S, ks.find(k => /ChillAura|IgniteAura/.test(k))), R = partOf(S, ks.find(k => /RuneAura/.test(k)));
    const list = corpses(S.at, Math.max(S.A, SIM.snap)).slice(0, S.dmg.stats.volatile_dead_base_number_of_corpses_to_consume);
    if (!list.length) return toast(t('{0} needs a corpse: kill an enemy or press C', S.label));
    const bitter = !!R, ail = U && (U.el === 'cold' ? 'chill' : 'ignite');
    // the aura: only its ailment, by its hit's size
    const UA = U && { ...U, dmg: { ...U.dmg, ail: { ...U.dmg.ail, never: Object.fromEntries(Object.keys(U.dmg.ail.never).map(k => [k, k !== ail])) } } };
    if (bitter) { fx.decal(S.at, S.A, 'patch', BD.snow, { a: .35, k: 1 }).remove(); artTex('bitterRune', 'models/effects/supports/runicsupports/markofrepulsion/tex/maskedrunerarepower'); artTex('bitterTile', 'microtransactions/misc/uniques/endurfaeddr/tex/kalguuran_runetile'); }
    for (const d of list) {
      eat(d, bitter ? BD.deep : S.el); const m = fx.orb(bitter ? BD.core : S.el, .3); m.position.set(d.pos.x, 1, d.pos.z); let tk = 0;
      const tile = bitter && fx.decal(m.position, .9, 'bitterTile', BD.flame, { a: .7, spin: .6 });
      if (bitter) { m.userData.core.material.color.set(BD.core); m.userData.glow.material.color.set(BD.deep); m.userData.glow.scale.setScalar(1.3); }   // pale blue, not white-hot
      thing(m, durOf(S), { name: S.name,
        tick(dt) {
          const p = m.position, e = near(p, 15); if (e) { const k = dist(e.pos, p); if (k > .5) { p.x += (e.pos.x - p.x) / k * 3 * dt; p.z += (e.pos.z - p.z) / k * 3 * dt; } }
          if (tile) { tile.move(p); fx.emit(2, { p: { x: p.x, y: .85, z: p.z }, r: .22, v: .2, up: 1.4, life: .45, size: .24, grow: .3, c: BD.flame, c2: BD.deep, k: 1.6, drag: 2 }); }
          if ((tk -= dt) <= 0 && UA) { tk = .5; fx.ring(p, .2, U.A, bitter ? BD.ring : S.el, .3, { a: .4 });
            for (const d of inside(p, U.A)) { const [lo, hi] = U.dmg.hits[U.el] || [0, 0]; afflict(d, UA, { [U.el]: rnd(lo, hi) }); } }
        },
        end() {
          const c = { x: m.position.x, z: m.position.z }; tile?.remove();
          if (bitter) { fx.flash(c, BD.ring, 10, .25, 6); fx.ring(c, .3, X?.A || 2, BD.ring, .4, { a: .8 }); fx.disc(c, X?.A || 2, BD.deep, .3, { a: .45 });
            fx.emit(40, { p: { x: c.x, y: 1, z: c.z }, r: .4, v: 4, up: 2, life: .9, size: .14, c: BD.snow, c2: BD.flame, g: 4, drag: 1 }); }
          if (X) bitter ? area(c, X.A, X) : boom(c, X.A, X);   // Bitter Dead: its own look above, not the generic cold blast
          if (R) { const g = fx.decal(c, R.A, 'bitterRune', BD.flame, { a: .9, k: 1.6, pulse: 3 }); let rt = 0;
            thing(holder(c), durOf(R), { name: R.name,
              tick(dt) {
                fx.emit(1, { p: { x: c.x, y: .05, z: c.z }, r: R.A * .8, v: .05, up: 1.2, life: .9, size: .18, grow: .5, c: BD.flame, k: 1.2, drag: .5 });
                if ((rt -= dt) <= 0) { rt = .25; for (const d of inside(c, R.A)) dot(d, { ...R, P: { ...R.P, dur: .3 } }); }
              },
              end: () => g.remove() }); }
        } });
    }
  };
  // Grim Pillars: its pillars of ice erupt in a ring around you (its area), each hitting the enemies at it (its secondary
  // area), up to its most; your hits break them for its explosion part. Frozen Locus: one Ice Crystal where you aim (its
  // reach), its strike hitting around it; breaking it explodes with the strike. note: Frozen Locus's leap back is not
  // simulated; enemies do not attack the crystals
  // Hollow Form: channelled, fleeting images of you near the target, each performing a socketed melee attack (another of
  // your melee attacks, neither channelled nor conditional) once at the enemy closest to it, with its less damage; a set
  // per the attack's use time at its less attack speed, a Power Charge consumed adds its images
  K.hollow = S => {
    const st = S.dmg.stats, j = api.build().gems.findIndex((g, j) => { const b = g.name !== S.name && base(j); return b && b.P.melee && b.P.attack && !b.P.channel && !api.info(g).gem?.types?.includes('HasUsageCondition'); });
    if (j < 0 || time - (me.hollowAt ?? -9) < useTime(base(j)) / (1 + st['mantra_of_illusions_triggered_skill_attack_speed_+%_final'] / 100)) return;
    me.hollowAt = time;
    const mc = costOf(base(j)).cost * st['mantra_of_illusions_cloned_skill_mana_cost_%'] / 100;   // an image spends its share of the socketed skill's cost
    for (let k = 1 + (S.spent ? st.mantra_of_illusions_bonus_illusions_when_consuming_power_charge : 0); k > 0 && me.mana >= mc; k--) {
      payMana(mc);
      const p = around(S.at, 1.5), f = makeMinion(fx, 'arcane'); f.group.position.set(p.x, 0, p.z); thing(f.group, .7, { name: S.name });
      // ponytail: the image attacks from where it stands by moving you there for the use (aim reads your position)
      later(.1 * k, () => { const d = nearest(p, 1, () => true)[0], o = { x: pp.x, z: pp.z }; pp.x = p.x; pp.z = p.z;
        use(j, { at: d ? { x: d.pos.x, z: d.pos.z } : S.at, src: 'meta', more: 1 + st['mantra_of_illusions_triggered_skill_damage_+%_final'] / 100 }); pp.x = o.x; pp.z = o.z; });
    }
  };
  K.pillars = S => {
    const st = S.dmg.stats, n = st.grim_pillars_number_of_pillars_to_create || 1, X = partOf(S, 'GrimPillarsExplodePlayer');
    const r = n > 1 ? S.A : 0, c = n > 1 ? pp : around(S.at, 0), hr = n > 1 ? st.active_skill_base_secondary_area_of_effect_radius / 10 : S.A;
    for (let k = 0; k < n; k++) {
      limit(o => o.ice && o.name === S.name, st.base_number_of_grim_pillars_allowed ?? st.base_number_of_frozen_locus_allowed, S);
      const a = k * TAU / n, p = { x: c.x + Math.sin(a) * r, z: c.z + Math.cos(a) * r };
      crystal(S, p, durOf(S), X || S); for (const d of inside(p, hr)) hit(d, S);
    }
  };
  K.twister = S => {
    const st = S.dmg?.stats || {}, W = objs.find(o => o.whirl && !o.dead && dist(o.c, pp) <= o.R()), n = (sh(S).projectiles || 1) + (W ? W.stage : 0) + (Math.random() * 100 < (st['twister_%_chance_for_additional_twister'] || 0) ? 1 : 0);   // its quality's chance for one more
    if (W) W.dead = true;   // it consumes the Whirlwind: one more twister per stage, more damage per stage
    const mult = W ? 1 + st['twister_damage_+%_final_per_whirling_slash_stage'] * W.stage / 100 : 1, a0 = Math.atan2(S.dx, S.dz), spread = (st.minimum_per_projectile_spread_angle_degrees || 15) * Math.PI / 180;
    const T = W?.X.got ? gainAs(S, W.X.got, st['twister_gain_%_elemental_damage_of_corresponding_type']) : S;
    for (let k = 0; k < n; k++) vortex(T, { x: pp.x, z: pp.z }, S.A, durOf(S), { dir: a0 + (k - (n - 1) / 2) * spread, speed: st.twister_base_movement_speed / 10, every: st.twister_hit_interval_ms / 1000, mult });
  };
  // Banners as the game's (reservation_banners). Defiance Banner (banner_Defensive.ao, aura_defiance.ao): its pennant
  // quartered grey and dark blue (BannerSkillDefensive_colour) on its pole's wood (BannerSkillPole_colour), unrolling as
  // it is placed (unroll_01) in dust and rock debris (placeBanner.pet: 0.14 / 0.11 / 0.07, brightened here as the scene's
  // smoke is unlit; sparks 1 / 0.78 / 0.57), spikes of light at 0.06 s for 0.25 s (placeDefiance_Impact: 0.75 / 0.8 / 1),
  // a shimmering wave for 1 s and its ring for 0.3 s (0.8 / 0.84 / 1); its Aura a pale blue glow over its area (0.7 / 0.8
  // / 1) and, at its foot, its sign on the ground and sparks for 0.06-0.75 s (0.5 / 0.61 / 1). Dread Banner (banner_dread.ao,
  // aura_dread.ao): its own pennant (BannerSkillDread_colour: a gold tower on dark blue), 2.48 m tall to Defiance's 2.18 m
  // (their bounding boxes); its spikes of light 1 / 0.59 / 0.51, its ring 1 / 0.53 / 0.45, its Aura 1 / 0.59 / 0.5 and its
  // sparks 1 / 0.51 / 0.4. note: the counts, speeds and sizes are the scene's
  const BANNERS = { 'Defiance Banner': { quarters: ['#6b675f', '#272b37'], trim: '#3e3b34', pole: 0x524638, aura: 0xb3ccff, spark: 0x809cff, flash: 0xbfccff, ring: 0xccd6ff },
    'Dread Banner': { img: fx.T[artTex('banner_dread', 'models/effects/bannerskill/bannerskilldread')], tall: 1.14, pole: 0x524638, aura: 0xff9680, spark: 0xff8266, flash: 0xff9582, ring: 0xff8773 } };
  function bannerPlace(c, R, L) {
    const q = { x: c.x, y: .15, z: c.z };
    fx.emit(14, { p: q, r: .3, v: 2, up: .8, life: .9, size: .4, grow: 1.6, c: 0x4a3a24, smoke: true, a: .45, drag: 2 });
    fx.emit(8, { p: q, r: .2, v: 2.5, up: 2.5, life: .8, size: .06, c: 0x5c5248, g: 9 }); fx.emit(10, { p: q, r: .2, v: 3, up: 2, life: .6, size: .05, c: 0xffc791, k: 2.2, g: 4 });
    fx.ring(c, .2, R * .5, L.ring, .3, { a: .5 }); later(.03, () => fx.ring(c, .3, R, L.aura, 1, { a: .15 }));
    later(.06, () => {
      fx.glow({ x: c.x, y: 1.4, z: c.z }, .8, L.flash, .25, 2);
      for (let i = 0; i < 8; i++) { const a = i * TAU / 8; fx.streak(V(c.x, 1.3, c.z), V(c.x + Math.sin(a) * 1.2, 1.3 + rnd(-.5, .8), c.z + Math.cos(a) * 1.2), L.flash, .25, .03, 1.4); }
    });
  }
  function bannerAura(e, L, dt) {
    if ((e.pulse = (e.pulse || 0) - dt) <= 0) { e.pulse = 1; fx.disc(e.c, e.R, L.aura, 1.1, { a: .03 }); fx.disc(e.c, .9, L.aura, 1.1, { a: .2 }); }
    if (Math.random() < dt * 20) fx.emit(1, { p: { x: e.c.x, y: .1, z: e.c.z }, r: .6, v: .4, up: 1.2, life: .5, size: .04, c: L.spark, k: 2.4 });
  }
  // a Banner: placed where you stand for its duration, its Aura granting you its buff while you are within its area
  // (its base_skill_buff_<stat>_to_apply, and Refraction's Refractive Plating), one of each Banner at a time. Refraction
  // III: the enemies in its area have its Exposure per 1000 of your armour, up to 80% (its text)
  K.banner = S => {
    // its buff with the increased Aura Magnitudes of auras and of Banners
    const AE = 1 + ((S.dmg?.sum?.['aura_effect_+%'] || 0) + (S.dmg?.sum?.['banner_aura_effect_+%'] || 0)) / 100;
    const st = S.dmg?.stats || {}, su = S.dmg?.sup || {}, give = Object.fromEntries(Object.entries(st).flatMap(([k, v]) => { const m = k.match(/^base_skill_buff_(.+)_to_apply$/); return m ? [[m[1], v * AE]] : []; }));
    for (const k of ['%_armour_to_apply_to_elemental_damage', 'deflection_rating_%_of_evasion_rating']) if (su['support_tempered_valour_' + k]) give[k] = su['support_tempered_valour_' + k];
    if (S.dmg?.sum?.['base_banner_resist_all_elements_%_to_apply']) give['resist_all_elements_%'] = S.dmg.sum['base_banner_resist_all_elements_%_to_apply'] * AE;   // the tree's resistances from Banners
    const RX = su['support_tempered_valour_banner_applies_%_elemental_exposure_per_1000_armour'];
    const BN = 1 + (S.dmg?.sum?.number_of_additional_banners_allowed || 0), BO = objs.filter(o => o.banner && o.name === S.name && !o.dead);   // the tree's +N placed Banners
    if (!S.dmg?.sum?.unlimited_banners_allowed) BO.slice(0, Math.max(0, BO.length - BN + 1)).forEach(o => o.dead = true);   /* Tactician: any number */
    const L = BANNERS[S.name], c = { x: pp.x, z: pp.z }, g = holder(c), R = S.A, ring = fx.decal(c, R, 'outline', L ? L.aura : 'gold', { a: L ? .15 : .35, rot: 0 }), t0 = time;
    let flag, M;
    if (L) { M = makeBanner(fx, L); M.group.rotation.y = facing; g.add(M.group); bannerPlace(c, R, L); }
    else {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(.04, .05, 3.2), new THREE.MeshStandardMaterial({ color: 0x6a5a3a })); pole.position.y = 1.6;
      flag = new THREE.Mesh(new THREE.BoxGeometry(.04, 1.1, .8), new THREE.MeshStandardMaterial({ color: fx.color(S.el === 'physical' ? 'gold' : S.el, 1), emissive: 0x201000 })); flag.position.set(0, 2.5, .42);
      g.add(pole, flag); fx.ring(c, .2, R, 'gold', .5);
    }
    say(t('{0} active', S.label), 'gold');
    const e = thing(g, durOf(S), { name: S.name, banner: give, R, c, off: () => { ring.remove(); M?.dispose(); const B = sheet().bannerBack, N = gloryNeed(S); if (B) me.glory[S.name] = Math.min(N, (me.glory[S.name] || 0) + N * B / 100); }, tick(dt) {   // the tree's Glory back on its expiry
      if (L) { M.hang.scale.y = Math.min(1, (time - t0) / .4); M.hang.rotation.x = Math.sin(time * 2) * .05; bannerAura(e, L, dt); } else flag.rotation.y = Math.sin(time * 2) * .15;   // its pennant unrolls (unroll_01)
      if (RX) { const x = Math.min(80, RX * Math.floor(withCharms(sheet()).armour / 1000)); if (x) for (const d of inside(c, R)) expo(d, ELEM, x, .5); } } });
  };
  // Leylines: while it is on, a leyline of its ground units (its least distance apart) across its reveal radius around
  // you; standing over one with Runic Ward, your spells deal its more damage and the Ward drains at its rate; running
  // out of it dissipates them for its reappearance time
  // note: how many leylines there are and how they lie is not in the data; one straight line through you here
  // Blood Boil: while it is on, each enemy in your Presence gains a boil every its interval; one that dies with boils
  // pops after its delay, Corrupted Blood (its % of that enemy's life a minute, physical) on the enemies in its area,
  // larger per boil. note: whose life it takes is not in the data, the scene takes the slain enemy's
  function boils() {
    const S = onS('Blood Boil'), st = S?.dmg?.stats; if (!st) return;
    for (const d of inside(pp, sheet().overgrow.r)) if ((d.boilAt ??= time) + st.blood_boil_application_interval_ms / 1000 <= time) { d.boilAt = time; d.boils = (d.boils || 0) + 1; d.boilS = S; }
  }
  // Attrition: while it is on, every second a Rare or Unique enemy has ever spent in your Presence is a stack, up to its
  // most; your hits deal its more damage per stack to it, and from its stacks on they have Culling Strike against it
  const attr = () => onS('Attrition')?.dmg.stats;
  function attrition(dt) {
    const st = attr(), VK = sheet().vile; if (st || VK) for (const d of inside(pp, sheet().overgrow.r)) if (['rare', 'unique'].includes(d.stat.rarity)) {
      if (st) d.attr = Math.min(st.skill_attrition_presence_max_seconds, (d.attr || 0) + dt);
      if (VK) d.vile = (d.vile || 0) + dt;   // The Vile Knight: every second ever in your Presence
    }
  }
  // Critical Weakness: each stack adds critical hit chance to hits against the enemy. Malice: while on, a stack every its
  // interval on the enemies in your Presence, for its duration
  const weakOf = d => (d.weak = (d.weak || []).filter(u => u > time)).length * WEAK.per;
  // Revealed Weaknesses (KeywordPopups RevealWeakness): segments of the enemy's life bar, 45% of it in all, at random; while its
  // life is within one it has an Open Weakness. note: how many segments is not in the data (three of 15% here)
  const openWeak = d => { const W = sheet().weakness; if (!d || !W || d.dead || W.rareOnly && !/rare|unique/.test(d.stat.rarity || '')) return false; d.gaps ||= [0, 1, 2].map(k => { const a = k / 3 + Math.random() * (1 / 3 - .15); return [a, a + .15]; }); const f = d.life / d.max; return d.gaps.some(([a, b]) => f >= a && f < b); };
  const weaken = (d, n, s = WEAK.time) => { weakOf(d); for (let k = 0; k < n; k++) d.weak.push(time + s); d.weak.sort((a, b) => a - b); d.weak.splice(0, d.weak.length - WEAK.max); };
  function malice() {
    const S = onS('Malice'), st = S?.dmg?.stats; if (!st || time - (me.maliceAt ?? -99) < st.critical_chance_against_aura_apply_brittle_every_x_ms / 1000) return;
    me.maliceAt = time; for (const d of inside(pp, sheet().overgrow.r)) weaken(d, 1, durOf(S));
  }
  // Blood Boil's look (BuffVisuals blood_boil_buff: ritualist/blood_boil blood_boil_debuff.epk, its blistered skin red
  // 1 / 0.04 / 0.03; MiscAnimated BloodBoilNova: blood_mist_explode.pet): the boiling enemy's body blistered red, and where
  // the boils pop a red flash for 0.4 s, dark red smoke rising and over the ground for 1.8-2.2 s and a mist of blood for
  // 1-3 s. note: its body redder with more boils is the scene's (when the game's larger blisters show is not in the
  // data); the ring of its blur is not drawn
  const BOIL = { skin: [.35, .013, .009], flash: 0xff1a0a, smoke: 0x2a0202, mist: 0x8a0006 };
  function boilPop(p, R) {
    const at = { x: p.x, y: .6, z: p.z };
    fx.flash(p, BOIL.flash, 10, .4, 5);
    fx.emit(8, { p: at, r: R * .3, v: R * .8, up: .8, life: 2, size: 1, grow: 1.8, c: BOIL.smoke, smoke: true, a: .7, drag: 1 });
    fx.disc(p, R, BOIL.smoke, 2, { dark: true, a: .6, tex: 'patch', hold: .4 });
    fx.emit(32, { p: at, r: R * .4, h: .8, v: R * 1.2, up: .5, life: 2, size: .35, grow: 1.5, c: BOIL.mist, smoke: true, a: .6, drag: 1.2 });
  }
  function popBoils(d) {
    const n = d.boils, S = d.boilS; d.boils = 0; d.boilAt = null; if (!n) return;
    const st = S.dmg.stats, p = { x: d.pos.x, z: d.pos.z }, dps = d.max * st['blood_boil_%_health_as_corrupted_blood_damage_per_minute'] / 6000;
    later(st.blood_boil_explosion_delay_ms / 1000, () => {
      const R = S.A * Math.sqrt(1 + n * st['blood_boil_explosion_area_+%_final_per_boil'] / 100); boilPop(p, R);
      for (const e of inside(p, R)) dot(e, { ...S, mult: 1, els: ['physical'], dmg: { ...S.dmg, dot: { physical: dps } }, P: { ...S.P, dur: durOf(S) } });
    });
  }
  function leylines(dt) {
    const L = onS('Leylines')?.dmg?.stats, Y = me.ley ||= { units: [], back: 0 }, clear = () => { Y.units.forEach(u => u.decal.remove()); Y.units = []; Y.more = 0; };
    if (!L) return clear();
    const rev = L.skill_leylines_reveal_radius / 10, r = L.active_skill_base_area_of_effect_radius / 10, gap = L.skill_leylines_minimum_distance_between_leyline_ground_units / 10;
    if (Y.units.length && dist(Y.c, pp) > rev) clear();
    if (!Y.units.length && time >= Y.back) {
      const a = rnd(TAU); Y.c = { x: pp.x, z: pp.z };
      for (let k = -rev; k <= rev; k += gap) { const p = { x: pp.x + Math.sin(a) * k, z: pp.z + Math.cos(a) * k }; Y.units.push({ ...p, decal: fx.decal(p, r, 'patch', 'cold', { a: .35, k: 1 }) }); }
    }
    Y.more = me.ward > 0 && Y.units.some(u => dist(u, pp) <= r) ? L['skill_leylines_spell_damage_+%_final'] : 0;
    if (Y.more && (me.ward -= L.skill_leylines_ward_degeneration_per_minute / 60 * dt) <= 0) { me.ward = 0; clear(); Y.back = time + L.skill_leylines_respawn_time_ms / 1000; }
  }
  // Rite of Restoration, Sigil of Power: its Sigil (its limit, its duration); standing in it you regenerate its life and
  // have its more armour, evasion and energy shield per stage (Sigil of Power: its more spell damage per stage); the mana you spend in it gains a stage for each its % of your maximum,
  // at most one a second, up to its most
  // note: that it starts at its first stage is not in the data
  K.sigil = S => {
    const st = S.dmg?.stats || {}, c = { x: pp.x, z: pp.z }, R = S.A, g = holder(c), ring = fx.decal(c, R, 'outline', 'gold', { a: .4, rot: 0 }), glow = fx.decal(c, R, 'patch', 'gold', { a: .12, k: 1 });
    limit(o => o.sigil && o.name === S.name, st.base_number_of_sigil_of_power_allowed, S);
    const AE = st['sacred_ground_armour_evasion_energy_shield_+%_final_per_stage'] || 0;
    const give = n => ({ 'armour_evasion_+%_final': n * AE, 'energy_shield_+%_final': n * AE, life_regeneration_per_minute: n * (st.sacred_ground_life_regeneration_for_allies_per_minute_per_stage || 0),
      'circle_of_power_spell_damage_+%_final': n * (st['circle_of_power_spell_damage_+%_final_per_stage'] || 0) });   // Sigil of Power: its more spell damage per stage (base)
    fx.ring(c, .2, R, 'gold', .5); say(t('{0} active', S.label), 'gold');
    const e = thing(g, durOf(S), { name: S.name, sigil: true, banner: give(1), R, c, stage: 1, paid: 0, at: time, off: () => { ring.remove(); glow.remove(); },
      spend(n) {
        e.paid += n; if (e.stage >= st.circle_of_power_max_stages || time - e.at < st.circle_of_power_minimum_time_between_stage_increases_ms / 1000 || e.paid < me.maxM * st['base_circle_of_power_mana_%_spend_per_upgrade'] / 100) return;
        e.paid = 0; e.at = time; e.banner = give(++e.stage); fx.ring(c, .3, R, 'gold', .4); say(`${S.label}: ${t('Stage {0}', e.stage)}`, 'gold');
      } });
  };
  // Shattering Spite: the Bloodstone Lances on each enemy within its share of your Presence's area are destroyed, each
  // enemy's exploding around it for its more damage per lance; from 5 lances its increased area per lance, from 10 its
  // life leech of the physical attack damage
  K.spite = S => {
    const st = S.dmg?.stats || {}, R = sheet().overgrow.r * Math.sqrt(st['shattering_spite_%_of_presence_radius'] / 100), L = st['shattering_spite_life_leech_%_with_10_lances'];
    fx.ring(pp, .3, R, 'blood', .5);
    for (const d of inside(pp, R)) {
      const n = d.lances || 0; if (!n) continue; d.lances = 0;
      const p = { x: d.pos.x, z: d.pos.z }, A = S.A * (n >= 5 ? Math.sqrt(1 + st['shattering_spite_area_+%_per_lance_with_at_least_5_lances'] * n / 100) : 1), lf = S.dmg.leech?.life;
      const dmg = n >= 10 ? { ...S.dmg, leech: { ...S.dmg.leech, life: { all: 0, more: 1, rate: 1, of: ['physical'], ...lf, phys: (lf?.phys || 0) + L } } } : S.dmg;
      pop(p, A, 'blood'); boom(p, A, { ...S, dmg, mult: S.mult * (1 + st['damage_per_bloodstone_lance_+%_final'] * n / 100) });
    }
  };
  // Oil Barrage: its projectiles one after another across its spread arc to where you aim, each hitting its area where it
  // lands and leaving Oil Ground; with a Power Charge to consume (one every its interval while you keep using it) the
  // electrified oil instead (its empowered part), with no ground
  // note: its secondary explosions are not simulated (where they happen is not in the data)
  K.oil = S => {
    const st = S.dmg?.stats || {}, n = sh(S).projectiles || st.base_number_of_projectiles || 1, arc = (st.barrage_base_spread_arc_override || 0) * Math.PI / 180, a0 = Math.atan2(S.dx, S.dz), l = Math.max(st['minimum_projectile_target_distance_+'] / 10 || 0, dist(S.at, pp));
    if (!(time < me.oilUntil) && charges.power > 0) { charges.power--; chargesSpent(1, 'power'); me.oilUntil = time + st.electric_spit_empowered_channel_consume_power_charge_per_X_ms / 1000; }
    const E = time < me.oilUntil && partOf(S, 'OilBarrageEmpoweredPlayer'), X = E ? { ...E, mult: S.mult } : S;
    for (let k = 0; k < n; k++) later(k * .08, () => {
      const a = a0 + (n > 1 ? k / (n - 1) - .5 : 0) * arc, q = { x: pp.x + Math.sin(a) * l, z: pp.z + Math.cos(a) * l };
      lob(fx.orb(E ? 'lightning' : 'dust', .12), hand(), V(q.x, .1, q.z), .4, 2.4, () => { boom(q, X.A, X); if (!E) ground('oil', q, X.A, X.P.dur, X); }, { trail: E ? 'lightning' : 'dust' });
    });
  };
  K.meditate = () => fx.ring(pp, .2, .9, 'holy', .25, { a: .4 });   // its recharge: update
  K.parry = S => { me.parry = { S, until: time + PARRY_WAIT }; fx.ring(pp, .3, .9, 'white', .3, { a: .5 }); };
  // Eyes of the Runefather: Runefather's Challenge on the enemies in front of you when you raise it, no more than once every 2 seconds (its text)
  K.shield = S => { const RF = sheet().runefather?.r;
    if (RF && !(time < me.raised?.until) && time - (me.rfAt ?? -9) >= 2) { me.rfAt = time; for (const d of dummies) if (!d.dead && dist(d.pos, pp) <= RF && (d.pos.x - pp.x) * Math.sin(facing) + (d.pos.z - pp.z) * Math.cos(facing) > 0) d.rfc = true; }
    me.raised = { ...me.raised, S, until: time + SIM.channelTick * 2 }; };
  // Runic Reprieve: channelled (from at least its share of your maximum Runic Ward), its bubble around you (struck)
  K.reprieve = S => {
    const st = S.dmg.stats, on = time < me.reprieve?.until;
    if (!on && me.ward < me.maxW * st['rune_ward_requires_%_maximum_ward_to_perform'] / 100) return toast(t('Not enough Runic Ward for {0}', S.label));
    me.reprieve = { st, S, until: time + SIM.channelTick * 2 }; if (!on) fx.ring(pp, .3, 1.2, 'holy', .4, { a: .5 });
  };
  // Triskelion Cascade: your next Cascadable spell is empowered (its less damage and area), centred on you, for its duration
  // and its share of the empowered spell's cast time is added to its cooldown (use(): lengthen)
  K.triskelion = S => {
    const st = S.dmg?.stats || {}; empower = empower.filter(e => e.type !== 'trisk');
    empower.push({ type: 'trisk', n: st.number_of_triskelion_cascades_for_next_skill, mult: 1 + st['triskelion_cascade_next_skill_damage_+%_final'] / 100, area: Math.sqrt(1 + st['triskelion_cascade_next_skill_area_of_effect_+%_final'] / 100), cd: st['triskelion_cascade_cooldown_%_of_cast_time'] || 0, label: S.label, name: S.name, s: durOf(S) });
    fx.ring(pp, .3, 1.8, 'fire', .45); say(t('{0} active', S.label), 'fire');
  };
  // Hollow Focus: while it is on, a bell appears near you every its interval, up to its most, lasting its secondary
  // duration, brought back near you past its recall distance. Your hits on one set off its shockwave around it (at most
  // once every its cooldown), Heavy Stunning the enemies there Primed for Stun; its hits beyond its limit destroy it
  // note: the Primed for Stun thresholds are keywords.json PrimedStun's text
  const PRIMED = { normal: 40, magic: 50, rare: 60, unique: 70 }, BELL = new THREE.ConeGeometry(.28, .55, 10, 1, true);
  // Withering Presence: while on, every its interval it Withers the enemies in your Presence, for its duration
  function withering(dt) {
    const S = onS('Withering Presence'); if (!S || (me.witherIn = (me.witherIn ?? 0) - dt) > 0) return;
    me.witherIn = S.dmg.stats.skill_withering_presence_frequency_ms / 1000; for (const d of inside(pp, sheet().overgrow.r)) withers(d, durOf(S));
  }
  function bells(dt) {
    const S = onS('Hollow Focus'), st = S?.dmg?.stats; if (!st) return;
    for (const o of objs) if (o.bell && !o.dead && dist(o.pos, pp) > st.bell_distance_limit_for_recall / 10) { const q = around(pp, 2); o.pos.set(q.x, 0, q.z); }
    if ((me.bellIn = (me.bellIn ?? 0) - dt) > 0) return;
    me.bellIn = st.base_cooldown_modifiable_repeat_interval_ms / 1000; limit(o => o.bell, st.spectral_bells_maximum_active_bells);
    const g = holder(around(pp, 2)), m = new THREE.Mesh(BELL, new THREE.MeshStandardMaterial({ color: 0xd8c690, emissive: 0x3a3020, side: THREE.DoubleSide })); m.position.y = 1.4; g.add(m);
    let hits = 0, next = 0;
    const e = thing(g, st.base_secondary_skill_effect_duration / 1000, { name: S.name, bell: true, r: .4, tick(dt) { m.rotation.z = Math.sin(time * 3) * .2; },
      touch(by) {
        if (by.src || by.name === S.name || time < next) return; next = time + st.bell_shockwave_cooldown_ms / 1000;
        const p = { x: e.pos.x, z: e.pos.z }; fx.ring(p, .3, S.A, 'gold', .35); boom(p, S.A, { ...S, self: e }, { soft: true });
        for (const d of inside(p, S.A)) if ((d.bar.stun || 0) >= PRIMED[d.stat.rarity]) { d.bar.stun = 0; d.lock.stun = GC.HeavyStunModifierDuration; inflict(d, 'stun', S, 1, null, { dur: DUR.stun }); }
        if (++hits >= st.bell_hit_limit + lasts(S)) e.dead = true;
      } });
  }
  // Jade (Jade Heritage): a stack every its interval while you have no Guard, up to its most. Encase in Jade consumes
  // them all for its Guard, its % of your maximum life per stack, for its duration
  function jade(dt) {
    const J = sheet().jade; if (!J || me.guard > 0 || me.jade >= J.max) return;
    if ((me.jadeIn = (me.jadeIn ?? J.every / 1000) - dt) > 0) return;
    me.jadeIn = J.every / 1000; me.jade++;
  }
  K.jade = S => {
    const n = me.jade; me.jade = 0; if (!n) return;
    const g = me.maxL * n * S.dmg.stats['maximum_life_%_damage_absorbed_per_jade_consumed'] / 100;
    guardFor(g, durOf(S));
    fx.glow({ x: pp.x, y: 1.2, z: pp.z }, 1.2, 'cold', .5); say(t('{0}: {1} Jade consumed', S.label, n), 'cold');
  };
  // Wardbound Minions: it spends all your Runic Ward (its cost with it), one caster per its Ward spent, up to its most,
  // each for its duration and at most its number of casts
  K.wardbound = S => {
    const st = S.dmg.stats, n = Math.min(Math.floor(((st._cost?.Ward || 0) + me.ward) / st.wardbound_minions_summon_minion_for_every_X_runic_ward_spent), st.base_number_of_wardbound_minions_allowed);
    spendWard(me.ward);
    for (let k = 0; k < n; k++) { limit(o => o.kind === S.name, tmpN(st.base_number_of_wardbound_minions_allowed)); minion(S, around(pp, 2), durOf(S), { kind: S.name, attacks: st.wardbound_minion_maximum_number_of_casts }); }
  };
  // Queen's Procession: while it is on and you sprint, the swarm hits everything in its area every its interval, its more
  // damage per Swarm's Advance; a use that hits grants one (up to its most) and hits you for its self damage. note: losing
  // them all 4 s after the sprint ends is poe2db's text (the data has no number for it)
  function locusts(S, dt) {
    const st = S.dmg.stats; me.locustAt = time;
    if ((me.locustIn = (me.locustIn ?? 0) - dt) > 0) return;
    me.locustIn = st.base_cooldown_modifiable_repeat_interval_ms / 1000; fx.ring(pp, .3, S.A, 'physical', .3, { a: .5 });
    if (!area({ x: pp.x, z: pp.z }, S.A, { ...S, mult: S.mult * (1 + (me.locust || 0) * st['locust_dash_damage_+%_final_per_stack'] / 100) })) return;
    me.locust = Math.min(st.maximum_locust_stacks, (me.locust || 0) + 1);
    hurt(rnd(st.active_skill_minimum_physical_self_damage_to_take, st.active_skill_maximum_physical_self_damage_to_take), 0, 'physical', false, null);
  }
  // Midnight Zenith: while it is on, your critical hits on Rare and Unique enemies grant its petals, and a killing one its
  // Power's (midnight_star_gain_ice_seeds_equal_to_enemy_power_on_kill_with_critical_hit); at its number they are consumed
  // for its crystals within its radius of that enemy, up to its most, each with its life and cold explosion: its Crystal
  // stat set, which the game's tables leave out, is PoB2's (Skills/other.lua MidnightStarPlayer: pob2.json stat_sets, a
  // part of the skill in skilldata.js). Its crits give no petals
  function zenith(d) {
    const S = onS('Midnight Zenith'); if (!S) return;
    const st = S.dmg.stats, need = st.midnight_star_attempt_to_consume_x_ice_seeds_to_create_an_ice_crystal_each_time_you_gain_ice_seeds;
    const n = (/rare|unique/.test(d.stat.rarity) ? st.midnight_star_gain_x_ice_seeds_when_you_critically_hit_a_rare_or_unique_enemy : 0) + (d.dead ? pow(d) : 0);
    if (!n || (me.seeds = (me.seeds || 0) + n) < need) return;
    me.seeds -= need;
    const X = partOf(S, 'Crystal'), xs = X?.dmg.stats; if (!X) return;
    for (let k = 0; k < st.unique_nattblom_crystals_per_trigger; k++) { limit(o => o.ice && o.name === S.name, xs.midnight_star_max_ice_crystals, S); crystal(S, around(d.pos, st.unique_nattblom_crystal_radius / 10), durOf(X), X, xs.frost_wall_maximum_life); }
  }
  // Mirror of Refraction: while it is on, a mirror appears in your Presence every its interval, up to its most, for its
  // duration. A spell projectile that hits one shatters it, copying the projectile in a nova of its number around it;
  // the copies can shatter other mirrors in turn
  const MIRROR = new THREE.BoxGeometry(.5, .9, .05);
  // Savage Fury's frenzy: its duration per Fury released, its more damage (by its level) and Onslaught, losing its % of
  // your maximum life per minute (not below 1). note: the animal form it forces you into is not simulated
  function frenzy(S) {
    const F = SK.skills[S.name].parts.SavageFuryActivePlayer, lv = F.levels[S.g?.level || 1] || {}, d = me.wild * F.constant.base_skill_effect_duration / 1000;
    me.wildUntil = time + d; me.wildMore = 1 + (lv['wild_beast_damage_+%_final'] || 0) / 100; me.wildLoss = F.constant['wild_beast_life_lost_%_per_minute_nonlethal']; me.wild = 0;
    setBuff({ label: S.label, name: S.name, c: css('blood'), s: d }); say(t('{0} active', S.label), 'blood');
  }
  // Align Fate: while it is on, a visage of you every its delay (more often per Spell it could cast, and by your cooldown
  // recovery) casts one of your Spells (by hand, not channelled, without a cooldown) at the nearest enemy; casting that
  // Spell yourself before the next visage Empowers it for its more damage (use)
  const NOMARK = new Set(["Alchemist's Boon", 'Align Fate', 'Archmage', 'Arctic Armour', 'Attrition', 'Azmerian Swarms', 'Barkskin', 'Berserk', 'Black Powder Blitz', 'Blasphemy', 'Blink', 'Blood Boil', 'Called Shots', 'Charge Regulation', 'Combat Frenzy', 'Convalescence', 'Crackling Palm', 'Defiance Banner', 'Dread Banner', 'Elemental Conflux']);   // persistent skills with nothing of theirs on you in the game (K.toggle; Elemental Conflux: its element's burst, confluxLook)
  const SILENT = new Set(['Attrition', 'Azmerian Swarms', 'Azmerian Wolf', 'Barkskin', 'Berserk', 'Cackling Companions', 'Called Shots', 'Elemental Conflux', 'Spectre: {0}']);   // persistent skills with no flash of theirs as they are turned on (K.toggle; Elemental Conflux: its element's burst, confluxLook)
  // Animus Splinters' cost: Runic Ward, its share of the total base costs of the skills socketed in it
  // (meta_skill_base_costs_equals_%...; its CostTypes: Ward). note: those skills' costs as the build has them
  const SPLINTER = 0x58c8ff, splinterCost = S => (S.dmg?.stats?.['meta_skill_base_costs_equals_%_total_base_costs_from_all_socketed_skills'] ?? 100) / 100
    * api.build().gems.reduce((n, _, j) => { const b = api.usedBy(j) === S.g && base(j); return n + (b ? (b.dmg?.cost || 0) + (b.dmg?.lifeCost || 0) : 0); }, 0);
  const FATE = 0x8fb4ff;   // Align Fate's blue (imageGlow_Skin.mat's RGB multiplier 0.94 / 1.28 / 2.5)
  function fate() {
    const F = onS('Align Fate'), st = F?.dmg?.stats; if (!st) return;
    const ok = [...api.build().gems.keys()].filter(j => { const b = api.byHand(j) && base(j); return b && b.P.spell && !b.P.channel && !b.dmg?.cooldown && !NOHIT.has(b.kind); });
    if (!ok.length || time < (me.fateAt ??= time)) return;
    me.fateAt = time + st.base_cooldown_modifiable_repeat_interval_ms / 1000 / (1 + st['spellflux_frequency_+%_final_per_socketed_valid_spell'] * ok.length / 100) / (1 + (F.dmg.sum?.['cooldown_speed_+%'] || 0) / 100);
    const j = ok[Math.floor(rnd(ok.length))], b = base(j);
    empower = empower.filter(e => e.type !== 'fate'); empower.push({ type: 'fate', spell: b.name, label: F.label, mult: 1 + st['spellflux_spell_damage_+%_final_if_matching_flux_cast'] / 100 });
    // its visage (spell_flux_clone.epk): a pale blue see-through you (imageBase_Skin / imageGlow_Skin.mat's blue) that
    // appears in a shimmering wave and a flare (spellFlux_Spawn.pet: 0.4 s), casts and fades in blue wisps. note: where
    // it appears is not in the data: a random spot 1.5-2.5 m around you
    const d = near(pp, 30), a = rnd(TAU), r = rnd(1.5, 2.5), p = { x: pp.x + Math.cos(a) * r, z: pp.z + Math.sin(a) * r }, at = d ? { x: d.pos.x, z: d.pos.z } : { x: p.x + Math.cos(a), z: p.z + Math.sin(a) };
    visage(p, at, { name: F.name, c: FATE, body: 0xa6c9ff, glow: .6, a: .5, back: { x: 0, z: 0 },
      spawn: q => { fx.ball({ x: q.x, y: 1, z: q.z }, 1, FATE, .4, .5); fx.glow({ x: q.x, y: 1.3, z: q.z }, 1.8, FATE, .45, 1.8); fx.emit(30, { p: { x: q.x, y: .2, z: q.z }, r: .45, h: 1.6, v: .8, up: 1, life: .6, size: .16, c: FATE, c2: 'white', k: 1.8, drag: 2 }); } },
      () => use(j, { at, src: 'meta' }), b.P, b);
  }
  function mirrors(dt) {
    const S = onS('Mirror of Refraction'), st = S?.dmg?.stats; if (!st) return;
    if ((me.mirrorIn = (me.mirrorIn ?? 0) - dt) > 0) return;
    me.mirrorIn = st.base_cooldown_modifiable_repeat_interval_ms / 1000; limit(o => o.mirror, st.base_mirror_of_refraction_limit);
    const g = holder(around(pp, sheet().overgrow.r * .8)), m = new THREE.Mesh(MIRROR, new THREE.MeshStandardMaterial({ color: 0xbfe3ff, emissive: 0x204060, metalness: .9, roughness: .1 }));
    m.position.y = 1; g.add(m);
    const e = thing(g, st.base_skill_effect_duration / 1000, { name: S.name, mirror: true, r: .35, tick() { m.rotation.y = time * .8; },
      shatter(by, o) {
        e.dead = true; const p = { x: e.pos.x, z: e.pos.z }, n = st.base_number_of_projectiles; fx.flash(V(p.x, 1, p.z), 'white', 10, .2, 5);
        for (let k = 0; k < n; k++) shoot(by, p, Math.sin(k * TAU / n), Math.cos(k * TAU / n), { seen: o.seen });
      } });
  }
  // Bonestorm: channelled, it conjures bone spikes (note: one per the scene's channel tick, the data has no rate), up to
  // its most; released, they fly at the enemies within its target length of the target, each exploding in its part.
  // Power Charges consumed widen the explosions: its + radius, and its more area per charge past the first
  // Its look (bone_spearvolley: boneSpear_Main; BoneSpikePlayer: boneSpear_Projectiles): while channelled its bone spears
  // assemble behind you, each lit green as it appears (boneSpear_ObjectAssemble: vibrance 0.875 / 1 / 0.94) with
  // necromantic embers (bonespear_tracker_startflash, 1.5-4 s); released they fly at 27 m/s (BoneSpikePlayer 2700) and
  // shatter where they land (bonespear_impactshatter: bone shards for 2-3.5 s, sparks, dust for 1-1.85 s); with Power
  // Charges a blue burst (powerCharge_AoE: a ring 0.15 / 0.18 / 0.3 for 0.3 s, a flash for 0.28 s, dark dust for 2 s, a
  // shockwave for 0.57 s, blue sparks for 0.65-2 s). note: the spears' shape, where they stand behind you and how their
  // green fades are the scene's
  const BST = { bone: 0xe6d6b8, glow: 0x9fffbe, ember: 0x8cffc5, ring: 0x7a96ff, spark: 0xa8b8ff, dust: 0x2f2f2f }, BSPEAR = new THREE.ConeGeometry(.05, 1.2, 5).rotateX(Math.PI / 2);
  let bst = [];
  function bstGrow(S, s) {   // one spear per channel tick, up to its most, standing behind you towards the cursor
    const n = Math.min(S.dmg?.stats?.base_number_of_allowed_bone_storm_projectiles || 1, Math.max(1, Math.floor(s / SIM.channelTick)));
    while (bst.length < n) {
      const m = new THREE.Mesh(BSPEAR, new THREE.MeshStandardMaterial({ color: BST.bone, roughness: .5, emissive: BST.glow, emissiveIntensity: 1.5 }));
      m.userData = { at: time, o: { x: rnd(-1.1, 1.1), y: 1 + rnd(-.5, .7), z: -.6 - rnd(.7) } }; scene.add(m); bst.push(m);
    }
    const fx0 = Math.sin(facing), fz = Math.cos(facing);
    for (const m of bst) {
      const o = m.userData.o, x = pp.x + fz * o.x + fx0 * o.z, z = pp.z - fx0 * o.x + fz * o.z;
      m.position.set(x, o.y, z); m.lookAt(x + fx0, o.y, z + fz); m.material.emissiveIntensity = Math.max(.3, 1.5 * (1 - (time - m.userData.at) / .5));
      if (time - m.userData.at < .02) fx.emit(5, { p: m.position, r: .3, v: .3, up: .4, life: 2.7, size: .05, c: BST.ember, k: 1.8, drag: 1 });
    }
    return n;
  }
  K.bonestorm = S => {
    const st = S.dmg.stats, X = partOf(S, 'BonestormExplosionPlayer') || S, xs = X.dmg?.stats || {};
    const n = bstGrow(S, Math.max(S.held || 0, SIM.channelTick));
    const r = S.spent ? (X.A + (xs['bone_spear_power_charged_aoe_+'] || 0) / 10) * Math.sqrt(1 + (S.spent - 1) * (xs['bone_spear_power_charged_aoe_+%_final_per_additional_power_charge'] || 0) / 100) : X.A;
    const foes = nearest(S.at, n, d => dist(d.pos, S.at) <= (st.bone_spear_target_rectangle_length || 0) / 10);
    const sp = bst.splice(0); for (const m of sp.splice(n)) fx.drop(m);
    for (let k = 0; k < n; k++) later(k * .04, () => {
      const d = foes[k % (foes.length || 1)], q = d && !d.dead ? { x: d.pos.x, z: d.pos.z } : around(S.at, 1);
      const m = sp[k], from = m.position.clone(), to = V(q.x, .3, q.z);
      lob(m, from, to, Math.max(.05, from.distanceTo(to) / 27), 0, () => { fx.drop(m); bstHit(q, r, S.spent); area(q, r, { ...X, mult: S.mult }, { noPay: k > 0 }); }, { aim: true, trail: BST.ember });
    });
  };
  function bstHit(q, r, power) {
    const at = { x: q.x, y: .4, z: q.z };
    fx.emit(14, { p: at, r: .15, v: 3, up: 2.5, life: 2.5, size: .09, c: BST.bone, g: 10, drag: .4, smoke: true, a: .95 });   // the spear shattered
    fx.emit(10, { p: at, r: .1, v: 4, life: .2, size: .07, c: 0xffffff, c2: BST.bone, k: 2.5, drag: 2 });
    fx.emit(6, { p: at, r: .3, v: .5, up: .4, life: 1.4, size: .5, grow: 1.6, c: 0x5a5650, smoke: true, a: .45, drag: 1 });
    if (!power) return;
    fx.ring(q, .2, r, BST.ring, .3, { k: 2.5 }); fx.flash(q, BST.spark, 8, .28, 5); fx.ball(at, r * .5, BST.ring, .57, 1.2);
    fx.emit(28, { p: at, r: r * .5, v: r * 1.2, up: .5, life: 2, size: .7, grow: 2, c: BST.dust, smoke: true, a: .6, drag: 1.2 });
    fx.emit(24, { p: at, r: .3, v: r * 2.5, up: 1.5, life: 1.3, size: .07, c: BST.spark, c2: 0xffffff, k: 2.2, drag: 1 });
    shake = Math.max(shake, Math.min(.4, r * .08));
  }
  // Explosive Spear: its spear lodges where it lands (up to its most) and explodes in its part at the end of its
  // detonation time, or at once when Detonated; a Frenzy Charge consumed explodes it on landing in its infused part: a
  // cross of its arms (its radius long, its secondary width), with Ignited Ground (its tertiary radius, its duration).
  // On the way it pierces the enemies it passes through, its hit on each (with the projectile's reach, as shoot's)
  K.espear = S => {
    const st = S.dmg.stats, c = { x: S.at.x, z: S.at.z }, X = partOf(S, 'ExplosiveSpearExplodePlayer') || S, I = S.spent && partOf(S, 'ExplosiveSpearInfusedExplodePlayer');
    const a = { x: pp.x, z: pp.z }, len = dist(a, c) || 1, cr = Math.max(.15, S.G.collision || 0);
    for (const d of dummies) if (!d.dead && segDist(d.pos, a, c) <= cr + SIM.body * d.sc) later(dist(d.pos, a) / len * .35, () => hit(d, S));
    lob(fx.arrow(S.el), hand(), V(c.x, .1, c.z), .35, 1.2, () => {
      if (I) {
        const is = I.dmg.stats, L = I.A, w = is.active_skill_base_secondary_area_of_effect_radius / 10, a0 = Math.atan2(S.dx, S.dz);
        for (const a of [a0, a0 + Math.PI / 2]) {
          const u = { x: Math.sin(a) * L, z: Math.cos(a) * L }, p = { x: c.x - u.x, z: c.z - u.z }, q = { x: c.x + u.x, z: c.z + u.z };
          fx.strip(p, q, w * 2, 'fire', .4, { a: .8 }); for (const d of dummies) if (!d.dead && segDist(d.pos, p, q) <= w) hit(d, I);
        }
        return ground('burning', c, is.active_skill_base_tertiary_area_of_effect_radius / 10, durOf(I), I);
      }
      limit(o => o.espear, st.base_number_of_remote_spear_mines_allowed, S);
      const m = fx.arrow(S.el); m.position.set(c.x, .4, c.z); m.rotation.x = -1.1;
      const e = thing(m, st.base_skill_detonation_time / 1000, { name: S.name, espear: true, r: .4, touch(by) { if (by.P.detonator && by.name !== S.name) e.s = e.dur; }, end: () => { pop(c, X.A, 'fire'); boom(c, X.A, X); } });
    });
  };
  // Tempest Bell: dropped at the target (its impact hit), it stays its duration, up to its most; your hits on it set off
  // its shockwave part around it (at most once every its cooldown, up to its hit limit), each elemental ailment it has
  // taken adding its % of the damage as that element. note: a hit of an element is an ailment of it on the bell (its
  // ailment threshold is not simulated), and knockback's larger shockwave area is not
  K.tbell = S => {
    const st = S.dmg.stats, X = partOf(S, 'TempestBellShockwavePlayer'), xs = X?.dmg?.stats || {}, c = { x: S.at.x, z: S.at.z }, ail = new Set();
    boom(c, S.A, S); limit(o => o.tbell, st.base_number_of_tempest_bells_allowed);
    const g = holder(c), m = new THREE.Mesh(BELL, new THREE.MeshStandardMaterial({ color: 0x9fb8d8, emissive: 0x1a2a40, side: THREE.DoubleSide })); m.scale.setScalar(3); m.position.y = .8; g.add(m);
    let hits = 0, next = 0;
    const e = thing(g, durOf(S), { name: S.name, tbell: true, r: .8,
      touch(by) {
        if (!X || by.name === S.name || time < next) return; next = time + xs.bell_shockwave_cooldown_ms / 1000;
        for (const el of ['fire', 'cold', 'lightning']) if (by.els.includes(el)) ail.add(el);
        fx.ring(c, .3, X.A, 'ice', .35); boom(c, X.A, { ...X, self: e, mult: X.mult * (1 + (st['tempest_bell_damage_+%_final_per_time_hit'] || 0) * hits / 100), gains: [...ail].map(el => ({ el, pct: xs['tempest_bell_physical_damage_%_as_elemental_per_ailment'] })) }, { soft: true });   // its quality's more per hit it has taken
        if (++hits >= st.bell_hit_limit + lasts(S)) e.dead = true;
      } });
  };
  // Disengage's look (spear_disengage; its tutorial video). Its cone (area.ao, not scaled by its radius): 16 spikes
  // shooting out over 0.15 s in a 0.12 turn arc ahead of you to 5 m, then 10 m, each for 0.15-0.35 s, lit orange by a
  // glow for 0.12 s (1 / 0.34 / 0.2); 32 puffs of smoke for 3 s from 1 m out to 12 m in a 0.37-0.15 turn arc, 16 rocks
  // lying for 7-9 s 2 m ahead and 32 sparks for 0.8-1.2 s (disengage_dust: 1 / 0.3 / 0.15). A Parried enemy's shockwave
  // (shockwave.ao): a flash for 0.35 s from 0.04 s, a ring for 0.3 s from 0.08 s (1 / 0.58 / 0.2), a wave of smoke for
  // 1.3 s from 0.06 s (0.2), 64 sparks for 2-3 s and a 0.125 s shake. note: its ground decal, its blurs and the spear's
  // trail are left out; the shake's strength, the spikes' length, counts, speeds and sizes are the scene's
  const DISG = { spike: 0x4a4542, glow: 0xff5733, spark: 0xff4d26, smoke: 0x5c5c5c, ring: 0xff9433 };
  function disCone(c, dx, dz) {
    const a0 = Math.atan2(dz, dx), at = (r, s) => V(c.x + Math.cos(a0 + s) * r, .3, c.z + Math.sin(a0 + s) * r);
    fx.glow(at(1, 0), 1, DISG.glow, .12, 2.4);
    for (let i = 0; i < 16; i++) later(i * .01, () => {
      const s = rnd(-1, 1) * .12 * Math.PI, r = (5 + 5 * i / 15) * rnd(.8, 1), tip = at(r, s);
      fx.streak(at(r * .3, s), tip, DISG.glow, rnd(.15, .35), .02, 1.2);
      fx.emit(2, { p: tip, r: .2, v: 2, up: 1.5, life: 1, size: .04, c: DISG.spark, c2: 'white', k: 2.4, g: 3, drag: 1.5 });
    });
    for (let i = 0; i < 32; i++) later(i * .2 / 32, () => {
      const k = i / 31, p = at(1 + 11 * k * rnd(.2, 1), rnd(-1, 1) * (.37 - .22 * k) * Math.PI);
      fx.emit(1, { p: { ...p, y: .2 }, r: .3, v: .5, up: .4, life: 3, size: .6, grow: 1.8, c: DISG.smoke, smoke: true, a: .3, drag: 1.5 });
    });
    for (let i = 0; i < 16; i++) fx.emit(1, { p: at(rnd(2), rnd(-1, 1) * .15 * Math.PI), r: .1, v: 1, up: 2, life: 8, size: .07, c: DISG.spike, smoke: true, a: .9, g: 9, drag: .4 });
  }
  function disWave(p, R) {
    const q = { x: p.x, y: .6, z: p.z };
    later(.04, () => fx.glow(q, 1.2, 'white', .35, 2.4));
    later(.06, () => fx.emit(20, { p: { x: p.x, y: .1, z: p.z }, r: .3, v: R * 2, up: .1, life: 1.3, size: .5, grow: 2, c: DISG.smoke, smoke: true, a: .35, drag: 1.5, flat: true }));
    later(.08, () => fx.ring(p, .2, R, DISG.ring, .3, { a: .9 }));
    fx.emit(64, { p: q, r: .2, v: 3, up: 2, life: 2.5, size: .04, c: DISG.spark, c2: 'white', k: 2.4, g: 4, drag: 1 });
    shake = Math.max(shake, .15);
  }
  // Disengage: its cone of spearpoints in front of you (its radius, its angle) as you leap back its path distance; each
  // Parried enemy it hits has the debuff consumed for its shockwave part and grants you its Frenzy Charges
  K.disengage = S => {
    const st = S.dmg?.stats || {}, c = { x: pp.x, z: pp.z }, R = st.disengage_cone_radius / 10, X = partOf(S, 'DisengageShockwavePlayer'), half = coneHalf({ cone: st.disengage_cone_angle });
    const parried = inside(c, R).filter(d => time < d.parried?.until && inCone(c, Math.atan2(S.dz, S.dx), half, d.pos));
    K.sweep({ ...S, from: c, R, cone: st.disengage_cone_angle, own: true }); disCone(c, S.dx, S.dz);
    for (const d of parried) { d.parried = null; if (X) for (let k = Math.random() * 100 < (st['disengage_%_chance_for_additional_shockwave'] || 0) ? 2 : 1; k > 0; k--) { const q = { x: d.pos.x, z: d.pos.z }; disWave(q, X.A); area(q, X.A, X); } for (let k = st.consume_parry_debuff_on_hit_to_gain_X_frenzy_charges; k > 0; k--) chargeBy('frenzy', S); }
    const l = st.leap_maximum_allowed_path_distance / 10;
    move = { from: c, to: { x: c.x - S.dx * l, z: c.z - S.dz * l }, k: 0, dur: .3, h: 1.2, S, seen: new Set() };
  };
  // Devour's look (wyvern_devour; its tutorial video). Its leap (landing_AoE_01 flying_Up_01) raises dust for 1-2 s (0.22)
  // and 8 puffs of powder for 0.5-3 s (0.51) with a 0.1 s shake; its landing (shockwave_01) dust, 16 puffs, rocks for 4-8 s
  // and a ring for 0.3 s (0.75 / 0.69 / 0.56) with a 0.3 s shake. Each corpse it devours (bloodChomp_01, corpseDevour)
  // gushes 32 drops of blood for 2-8 s, spills more from 0.5 s and leaves bones (0.3 / 0.24 / 0.11) and gibs from 0.6 s, when
  // it is gone; blood drips off your head for 4 s after (bloodStain). note: the wyvern you shift into is not drawn (the
  // scene has no model of it); the blood is red blood's (Bloodgibs: 0.54 / 0.01 / 0.01; the game's is the monster's
  // type); the shakes' strength, counts, speeds and sizes are the scene's
  const DEVOUR = { dust: 0x383838, powder: 0x828282, ring: 0xbfb08f, bone: 0x4d3d1c, blood: 0x8a0303 };
  function dvDust(p, n, R) {
    fx.emit(n * 2, { p: { x: p.x, y: .1, z: p.z }, r: R * .5, v: 1.5, up: .3, life: 1.5, size: .5, grow: 1.8, c: DEVOUR.dust, smoke: true, a: .35, drag: 1.5, flat: true });
    later(.04, () => fx.emit(n, { p: { x: p.x, y: .2, z: p.z }, r: R * .3, v: 1, up: 1, life: 1.75, size: .15, c: DEVOUR.powder, smoke: true, a: .5, g: .5, drag: 1 }));
  }
  function dvLand(p, R) {
    dvDust(p, 16, R); fx.ring(p, .2, R, DEVOUR.ring, .3, { a: .8 }); shake = Math.max(shake, .3);
    later(.1, () => fx.emit(12, { p: { x: p.x, y: .2, z: p.z }, r: R * .4, v: 2.5, up: 2.5, life: 6, size: .1, c: DEVOUR.dust, smoke: true, a: .9, g: 9, drag: .3 }));
  }
  function dvEat(d, corpse) {   // corpse: one it consumes (a culled enemy is left)
    const q = { x: d.pos.x, y: .4, z: d.pos.z };
    if (corpse) { eat(d); d.fig.group.visible = true; later(.6, () => { if (!d.corpse) d.fig.group.visible = false; }); }
    fx.emit(32, { p: q, r: .2, v: 2, up: 2, life: 5, size: .07, c: DEVOUR.blood, smoke: true, a: .9, g: 9, drag: .4 });
    later(.5, () => { fx.emit(12, { p: q, r: .3, v: 1, up: .6, life: 5, size: .09, c: DEVOUR.blood, smoke: true, a: .9, g: 9, drag: .6 }); fx.disc(q, .8, DEVOUR.blood, 8, { dark: true, a: .9, tex: 'patch', hold: .8, y: .02 }); });
    later(.6, () => fx.emit(10, { p: q, r: .3, v: 1.5, up: 2, life: 5, size: .08, c: DEVOUR.bone, g: 9, drag: .4 }));
    for (let i = 0; i < 16; i++) later(.6 + i / 4, () => fx.emit(1, { p: { x: pp.x, y: 1.7, z: pp.z }, r: .12, v: .1, life: 1, size: .05, c: DEVOUR.blood, smoke: true, a: .9, g: 9 }));
  }
  // Devour: a corpse or a Cullable enemy (culled) at the target and up to its number of other corpses within its area
  // there, each restoring its life and granting a Power Charge; one beyond your reach and within its dash range you leap
  // to, hitting its area where you land
  // note: over how long its life is regenerated is not in the data; at once here
  K.devour = S => {
    const st = S.dmg?.stats || {}, C = { ...S, P: { ...S.P, culls: true } }, e = corpseAt(S.at, SIM.snap) || near(S.at, SIM.snap, d => cullable(d, C));
    if (!e) return toast(t('{0} needs a corpse: kill an enemy or press C', S.label));
    const p = { x: e.pos.x, z: e.pos.z }, l = dist(p, pp), reach = meleeR(S) + SIM.body;
    me.leapK = l <= reach ? 0 : Math.min(1, (l - reach) / (st.base_melee_dash_range / 10));   // the share of its dash range it travels (useTime)
    const eatAll = () => [e, ...corpses(p, S.A).filter(d => d !== e).slice(0, st.wyvern_devour_max_extra_corpses_to_consume)].forEach(d => {
      const was = d.corpse > 0; if (!was && !cull(d, C)) return;
      dvEat(d, was);
      me.life = gain(me.life, me.maxL, st.wyvern_devour_life_restoration); chargeBy('power', S); if (Math.random() * 100 < (st['wyvern_devour_flask_charm_charge_gain_chance_%'] || 0)) killCharges(d);   // its quality: charges as though killing it
    });
    if (l <= reach) eatAll();
    else if (l <= reach + st.base_melee_dash_range / 10) { dvDust(pp, 8, 1); shake = Math.max(shake, .15); move = { from: { x: pp.x, z: pp.z }, to: p, k: 0, dur: .35, h: 1.6, S, seen: new Set(), land: at => { dvLand(at, S.A); area(at, S.A, S); eatAll(); } }; }
  };
  // Thrashing Vines: its growth area at the target (its limit, its duration), a vine crashing in it every its share of the
  // cast time, onto an enemy in it if there is one, hitting its secondary area
  K.vines = S => {
    const st = S.dmg?.stats || {}, c = { ...S.at }, R = S.A, r = radOf(S), every = (S.dmg?.speed ? 1 / S.dmg.speed : SIM.castTime) * st['awakened_forest_spawn_vines_per_X%_cast_time'] / 100;
    const was = objs.find(o => o.forest && o.name === S.name && !o.dead && dist(o.c, c) <= R); if (was) { was.s = 0; return; }   // sustained: the same area goes on
    limit(o => o.forest && o.name === S.name, st.base_number_of_awakened_forests_allowed, S);
    const ring = fx.decal(c, R, 'outline', 'poison', { a: .35, rot: 0 }); let k = 0;
    planted(thing(holder(c), durOf(S), { name: S.name, forest: true, plant: S, c, R, off: () => ring.remove(), tick(dt, e) {
      presence(e);
      if ((k -= dt) > 0) return; k = every;
      const d = near(c, e.R), q = d ? { x: d.pos.x, z: d.pos.z } : around(c, e.R);
      fx.pillar(q, r * .4, 2.4, 'poison', .3, 2); later(.2, () => boom(q, r, { ...S, mult: S.mult * (e.more || 1) }, { soft: true }));
    } }));
  };
  // Cross Slash: two gouges, its length long and its width wide, each from its offset to one side of you across your aim to
  // the other side, its angle apart, crossing at their middles; each hits on its own, as its claws touch the ground
  // (cross_slash.atl: contact at 0.21 of its 0.75 s), while you leap back (its move: 4.5 m over the use). A Marked enemy hit
  // by both has its Mark activated and takes the shockwave (its part) after its delay. The Ice Fragments within its search
  // radius are pulled into where the gouges cross and explode at once. note: the overshoot of their pull is a look the data
  // does not explain. Its look (claw_slash_01.ao: crossSlash.pet): on each gouge three claw lines glowing for 1 s
  // (clawSlash_Glow 1 / 0.72 / 0.43), cracks lit orange for 2.5-4 s (clawSlash_Cracks 1 / 0.64 / 0.3), sparks drifting for
  // 0.75-4 s (clawSlash_Sparks 5 / 3.88 / 2.12) and dust (0.17) for 1-1.5 s; your claws glowing as you strike, here your hands
  // (onACT_PounceClawGlow 1.25 / 0.93 / 0.5, 0.42 s)
  const CLIP_OF = { 'Cross Slash': 'gouge' };   // a skill's own move of the figure (humanoid.js MOVES), over clipOf's
  const GOUGE = { glow: 0xffb86e, crack: 0xffa34d, spark: 0xffc66c, dust: 0x2b2b2b, claw: 0xffbe66, dark: 0x1c120c };
  K.cross = S => {
    const st = S.dmg?.stats || {}, c = { x: pp.x, z: pp.z }, w = radOf(S), a0 = Math.atan2(S.dx, S.dz), half = st.wolf_cross_slash_angle / 2 * Math.PI / 180, off = st.wolf_cross_slash_offset / 10;
    const X = partOf(S, 'WolfCrossSlashMarkConsumedPlayer'), both = new Map(), T = S.dmg?.useTime || (S.dmg?.speed ? 1 / S.dmg.speed : SIM.castTime), m = off / Math.tan(half), mid = { x: c.x + S.dx * m, z: c.z + S.dz * m };
    { const L = V(), R = V(); player.palms(L, R); for (const h of [L, R]) fx.glow(h, .5, GOUGE.claw, .42, 2.6); }
    later(T * .21 / .75, () => {
      const pulled = frags.filter(F => dist(F.p, mid) <= st.ice_chunk_refire_search_radius / 10);   // those lying there as it strikes, not those its own kills make
      for (const sgn of [-1, 1]) {
        const a = { x: c.x + Math.cos(a0) * off * sgn, z: c.z - Math.sin(a0) * off * sgn }, q = a0 - sgn * half, b = { x: a.x + Math.sin(q) * S.A, z: a.z + Math.cos(q) * S.A };
        fx.strip(a, b, w * .8, GOUGE.dark, rnd(2.5, 4), { dark: true, a: .55, y: .05 });
        fx.strip(a, b, w * .5, GOUGE.crack, rnd(2.5, 4), { a: .35, k: 1.4, y: .055 });
        for (const k of [-1, 0, 1]) { const o = { x: Math.cos(q) * w / 3 * k, z: -Math.sin(q) * w / 3 * k }; fx.strip({ x: a.x + o.x, z: a.z + o.z }, { x: b.x + o.x, z: b.z + o.z }, .12, GOUGE.glow, 1, { a: 1, k: 3, y: .07 }); }
        for (let k = 0; k < 10; k++) { const f = rnd(0, 1), p = { x: a.x + (b.x - a.x) * f, y: .1, z: a.z + (b.z - a.z) * f };
          fx.emit(3, { p, r: w / 3, v: 1.2, up: 1.4, life: rnd(.75, 4), size: .05, c: GOUGE.spark, c2: 'white', k: 2.4, drag: 1.5 });
          fx.emit(1, { p, r: w / 3, v: .3, up: .4, life: rnd(1, 1.5), size: .7, grow: 1.5, c: GOUGE.dust, smoke: true, a: .35, drag: 1 }); }
        for (const d of dummies) if (!d.dead && segDist(d.pos, a, b) <= w / 2 + SIM.body) { hit(d, S); both.set(d, (both.get(d) || 0) + 1); }
      }
      for (const [d, n] of both) if (n === 2 && d.mark && !d.dead) { markOff(d); if (X) later(st.wolf_pounce_mark_shockwave_delay_ms / 1000, () => boom({ x: d.pos.x, z: d.pos.z }, X.A, X)); }
      for (const F of pulled.filter(F => frags.includes(F))) {
        frags = frags.filter(f => f !== F); F.dec.remove();
        lob(fx.orb('cold', .1), new THREE.Vector3(F.p.x, .3, F.p.z), new THREE.Vector3(mid.x, .1, mid.z), .2, .5, () => { pop(mid, F.R, 'ice'); F.go(mid); });
      }
    });
    move = { from: c, to: { x: c.x - S.dx * 4.5, z: c.z - S.dz * 4.5 }, k: 0, dur: T, h: .6, S, seen: new Set(), own: true };   // its own clip in the air (CLIP_OF), not the leap's
  };
  // Unearth: its cone of bone spikes in front of you (its radius, its angle); each corpse in it becomes a Bone Construct
  // for its duration, up to its limit
  // note: larger corpses making more than one construct is not simulated
  K.unearth = S => {
    const st = S.dmg?.stats || {}, c = { x: pp.x, z: pp.z }, half = coneHalf({ cone: st.bone_cone_angle }), a0 = Math.atan2(S.dz, S.dx);
    K.sweep({ ...S, from: c, R: S.A, cone: st.bone_cone_angle });
    for (const d of corpses(c, S.A).filter(d => inCone(c, a0, half, d.pos))) {
      const p = { x: d.pos.x, z: d.pos.z }; eat(d, S.el);
      limit(o => o.kind === S.name, tmpN(st.base_number_of_skeletal_constructs_allowed)); minion(S, p, durOf(S), { kind: S.name });
    }
  };
  // Toxic Domain: its Toxic Bloom around you for its duration; in it you regenerate its life and your skills cost more
  // and your projectile attacks attach its Toxic Pustules (thornHit)
  K.domain = S => {
    const st = S.dmg?.stats || {}, c = { x: pp.x, z: pp.z }, ring = fx.decal(c, S.A, 'patch', 'poison', { a: .3, k: 1 });
    limit(o => o.banner && o.name === S.name, 1);
    thing(holder(c), durOf(S), { name: S.name, banner: { life_regeneration_per_minute: st['toxic_domain_healing_per_minute_+'], 'toxic_domain_mana_cost_+%': st['toxic_domain_mana_cost_+%'] }, domain: S, R: S.A, c, linger: (st.toxic_domain_buff_linger_duration_ms || 0) / 1000, off: () => ring.remove() });
    fx.ring(c, .2, S.A, 'poison', .45); say(t('{0} active', S.label), 'poison');
  };
  // Ice Shards: each bolt of its clip strikes the ground at the target (its hit there) and leaves a shard, up to the
  // shards' limit, that arms after its time and explodes (its part) when an enemy comes within its detection radius;
  // armed longer, more damage, up to its more after its bonus delay. note: the data has no time a shard lasts (the
  // scene's) nor how its more grows (here evenly over the delay), and the bolt's hit covers the scene's half metre
  K.shards = S => {
    const X = partOf(S, 'IceShardsShardPlayer'), xs = X?.dmg.stats, c = around(S.at, .5); if (!X) return;
    fx.streak(hand(), V(c.x, .1, c.z), 'cold', .1, .04, 1); boom(c, .5, S, { soft: true });
    limit(o => o.hazard && o.name === S.name, xs.permafrost_shard_limit, S);
    hazardAt({ ...X, mult: S.mult }, c, SIM.lifetime, { arm: xs.permafrost_shard_arming_time_ms / 1000, reach: xs.permafrost_shard_detection_base_area_of_effect_radius / 10, c: 'cold',
      more: t => 1 + xs['permafrost_shard_damage_+%_final_after_1_second'] / 100 * Math.min(1, t / (xs.permafrost_shard_bonus_damage_delay_ms / 1000)) });
  };
  // Stormblast Bolts: its bolts land within its secondary radius of the target, each hitting its area there, and lie there
  // charged for its duration (up to its most); a detonator explodes them in its part
  K.stormblast = S => {
    const st = S.dmg.stats, X = partOf(S, 'StormblastBoltsExplosionPlayer') || S, R = radOf(S, 'secondary');
    for (let k = 0; k < (sh(S).projectiles || 1); k++) {
      const c = around(S.at, R);
      later(k * st.siege_cascade_fall_time_ms / 1000, () => {
        limit(o => o.stormblast, st.stormblast_bolts_maximum_active_bolt_count, S);
        const m = fx.orb('lightning', .12); m.position.set(c.x, .3, c.z); fx.streak(V(c.x, 6, c.z), V(c.x, .3, c.z), 'lightning', .1, .04, 1);
        boom(c, S.A, S, { soft: true, noPay: k > 0 });
        thing(m, durOf(S), { name: S.name, stormblast: true, r: .3,
          touch(by) { if (by.P.detonator && !this.dead) { this.dead = true; pop(c, X.A, 'lightning'); boom(c, X.A, { ...X, mult: S.mult }); } } });
      });
    }
  };
  // Storm Lance: the spear lands at the target (its area), lodges and zaps an enemy within its secondary radius every
  // its frequency for its duration; a detonator unleashes its volley of bolts and ends it. With a frenzy charge spent:
  // its infused part, faster and shorter, that detonates itself at the end and leaves Shocked Ground (its third radius,
  // its second duration). A projectile: the first enemy on its way stops it, and it lands there
  K.lance = S => {
    const I = S.spent && partOf(S, 'StormLanceInfusedPlayer'), X = I ? { ...I, mult: S.mult } : S, st = X.dmg.stats, R = radOf(S);
    const way = dummies.filter(d => !d.dead && segDist(d.pos, pp, S.at) <= SIM.body + Math.max(.15, S.G.collision || 0)).sort((a, b) => dist(a.pos, pp) - dist(b.pos, pp))[0], c = way ? { x: way.pos.x, z: way.pos.z } : { ...S.at };
    limit(o => o.lanceOf === S.name, S.dmg.stats.base_number_of_overcharged_spears_allowed, S);
    lob(fx.arrow('lightning'), hand(), V(c.x, .1, c.z), .35, 1.2, () => {
      boom(c, S.A, X); const m = fx.orb('lightning', .14); m.position.set(c.x, 1.2, c.z);
      let tk = 0;
      const blow = e => { e.dead = true; const list = inside(c, R); for (let k = 0; k < st.overcharged_spear_detonate_number_of_beams && list.length; k++) chain(m.position.clone(), list[k % list.length], { ...X, self: e }, 0);
        if (I) ground('shocked', c, radOf(I, 'tertiary'), I.dmg.stats.base_secondary_skill_effect_duration / 1000, X); };
      thing(m, durOf(X), { lanceOf: S.name, name: S.name, r: .5,
        tick(dt, e) { if ((tk -= dt) > 0) return; tk = st.overcharged_spear_base_frequency_ms / 1000; const d = near(c, R); if (d) chain(m.position.clone(), d, { ...X, self: e }, 0); },
        touch(by) { if (by.P.detonator && !this.dead) { say(t('{0} detonates {1}', by.label, S.label), 'lightning'); blow(this); } },
        end: e => { if (I) blow(e); } });
    }, { trail: 'lightning' });
  };
  // Mana Tempest: its storm where you cast it; while you are in it, or for its linger after you leave, your mana-costing
  // spells gain its share of their damage as lightning. It drains its % of your maximum mana a second plus its % of the
  // mana you spend in it, added to that each second; it ends once you are out past its linger or out of mana.
  // Its empowered spells' projectiles split toward its additional targets (shoot). note: other spells' split is not simulated
  // Archmage: while it is on, your non-channelling spells cost its share of your maximum mana more and gain its share of
  // their damage as lightning per 100 maximum mana
  const archmage = S => S.P.spell && !S.P.channel && !S.src && onS('Archmage')?.dmg.stats;
  // its look on each spell it empowers (addedSurge_archmage.pet, nothing on you otherwise): a surge of mana blue from your
  // hand along the cast, its lightning (manapower_lightning: 0.25 / 0.35 / 1), ribbons (manapower_ribbons: 0.08 / 0.14 /
  // 1) and mana dust (manadust: 0.13 / 0.21 / 1)
  const ARCHMAGE = { bolt: 0x4059ff, ribbon: 0x1424ff, dust: 0x2236ff };
  function archLook(S) {
    const H = hand(), e = V(H.x + S.dx * 1.3, H.y, H.z + S.dz * 1.3);
    fx.glow(H, 1.4, ARCHMAGE.bolt, .3, 2.8); fx.bolt(H, e, ARCHMAGE.bolt, .22, .08, .5); fx.bolt(H, e, ARCHMAGE.ribbon, .25, .05, .8); fx.bolt(H, e, 'white', .12, .02, .35);
    fx.emit(22, { p: H, dir: V(S.dx, .1, S.dz), v: 3.2, life: .35, size: .1, c: ARCHMAGE.dust, c2: 'white', k: 2.5, drag: 2 });
    fx.emit(8, { p: H, r: .25, v: 1.2, life: .5, size: .2, c: ARCHMAGE.ribbon, k: 2, drag: 1.5 });
  }
  const empowered = S => S.P.spell && !S.src && S.dmg?.cost > 0 && tempest() || null;   // a mana-costing spell of yours in its storm
  const tempest = () => { const o = me.tempest; return o && !o.dead && (dist(o.c, pp) <= o.R || time - o.outAt < o.linger) && o.S; };
  K.tempest = S => {
    const st = S.dmg.stats, c = { x: pp.x, z: pp.z }, ring = fx.decal(c, S.A, 'outline', 'lightning', { a: .45, rot: .3 });
    if (me.tempest) me.tempest.dead = true;
    fx.ring(c, .2, S.A, 'lightning', .5); say(t('{0} active', S.label), 'lightning');
    me.tempest = thing(holder(c), Infinity, { S, c, R: S.A, per: 0, outAt: time, linger: st.mana_tempest_effects_linger_X_ms / 1000, off: () => ring.remove(),
      spend(n) { this.per += n * st['mana_tempest_mana_cost_%_to_add_to_cost_per_second'] / 100; },
      tick(dt, e) {
        if (dist(c, pp) <= e.R) e.outAt = time;
        me.mana -= (me.maxM * (st._cost?.ManaPercentPerSecond || 0) / 100 + e.per) * dt;
        if (me.mana <= 0 || time - e.outAt >= e.linger) { me.mana = Math.max(0, me.mana); e.dead = true; }
      } });
  };
  // Feast of Flesh: consumes up to its number of corpses around you; each recovers its life and mana over its recovery duration
  K.feast = S => {
    const st = S.dmg?.stats || {}, list = corpses(pp, S.A).slice(0, st.feast_of_flesh_number_of_corpses), T = st.feast_of_flesh_recovery_duration / 1000;
    if (!list.length) return toast(t('{0} needs a corpse: kill an enemy or press C', S.label));
    for (const d of list) eat(d, 'blood');
    const L = list.length * st.feast_of_flesh_recover_X_life_per_corpse_consumed / T, M = list.length * st.feast_of_flesh_recover_X_mana_per_corpse_consumed / T;
    thing(holder(pp), T, { tick: dt => { me.life = gain(me.life, me.maxL, L * dt); me.mana = gain(me.mana, me.maxM, M * dt); } });
    fx.ring(pp, .2, S.A, 'blood', .5); say(`${S.label}: ${list.length}`, 'blood');
  };
  // Temper Weapon: each strike of the hammer Empowers its number of your next melee attacks, up to its most
  // note: each use is one strike (the channel's strike rate is not in the data)
  K.temper = S => {
    const st = S.dmg.stats; let E = empower.find(e => e.type === 'temper');
    if (!E) empower.push(E = { type: 'temper', label: S.label, name: S.name, el: 'fire', uses: 0, T: S });
    E.uses = Math.min(st.imbue_weapon_max_exerts, E.uses + st.temper_weapon_empowers_per_strike); fx.pillar(pp, .4, 2, 'fire', .3); say(`${S.label}: ${E.uses}`, 'fire');
  };
  // Mantra of Destruction: its Empowered melee attacks (its number) gain its share of damage as extra chaos; each kill
  // with one grants a Purple Flame of Chayula (keywords.json: its share as extra chaos, stacking up to 10) for its secondary duration
  K.mantra = S => {
    const st = S.dmg.stats; empower = empower.filter(e => e.type !== 'mantra');
    empower.push({ type: 'mantra', label: S.label, name: S.name, uses: st.skill_empowers_next_x_melee_attacks, s: durOf(S), pct: st['mantra_of_destruction_grant_all_damage_%_to_gain_as_chaos_with_attacks'], flame: st['mantra_of_destruction_purple_flame_all_damage_%_gained_as_chaos'], flameFor: st.base_secondary_skill_effect_duration / 1000 });
    say(t('{0} active', S.label), 'chaos');
  };
  // an Offering (tag: its kind) skewers your nearest minion on its spike for its duration, up to its limit
  function offer(S, tag, max) {
    const m = objs.filter(o => o.minion && !o.dead).sort((a, b) => dist(a.pos, pp) - dist(b.pos, pp))[0];
    if (!m) return toast(t('{0} needs a Minion', S.label));
    const c = { x: m.pos.x, z: m.pos.z }, ring = tag !== 'bone' && fx.decal(c, S.A, 'outline', 'blood', { a: .4, rot: 0 }); m.dead = true;
    limit(o => o[tag], max);
    if (Math.random() * 100 < sheet().undeath.offer) undeathGo();   // the tree's chance of Archon of Undeath
    const OH = sheet().offerHeal; if (OH) me.life = Math.min(me.maxL, me.life + me.maxL * OH / 100);   // the tree's life recovered when you create an Offering
    // Guatelitzi's Ablation: a Power Charge every its interval while the Offering stands; when it ends, its share of your
    // life and mana a second for as long as it stood
    const GA = S.dmg?.sum || {}, PC = GA.supported_offerings_grant_you_a_powercharge_every_x_ms / 1000, RG = GA['recover_%_life_and_mana_per_minute_for_supported_offering_lifetime'] / 6000;
    // its buff effect (_x): the tree's increased, Sacrificial Offering's; Danse Macabre's when a second skeletal minion is there to go too
    const DM = S.dmg?.sup?.['offering_spells_effect_+%_if_consumed_additional_skeleton'], m2 = DM && objs.find(o => o.minion && !o.dead && o.skeleton); if (m2) m2.dead = true;
    const X = 1 + ((GA['offering_spells_effect_+%'] || 0) + (m2 ? DM : 0)) / 100;
    const g = holder(c), L = tag === 'bone' && boneOffer(c, g, S.A); if (!L) fx.pillar(c, .3, 2.2, 'blood', .5, 2);
    thing(g, durOf(S), { [tag]: { ...S.dmg.stats, _x: X }, R: S.A, off: () => { if (ring) ring.remove(); if (L) L.off(); },
      tick(dt, e) { if (L) L.tick(dt, e); if (PC && Math.floor(e.s / PC) > Math.floor((e.s - dt) / PC)) gainCharge('power', S.label); },
      end(e) { if (RG) for (const [k, M] of [['life', me.maxL], ['mana', me.maxM]]) me.recoup.push({ k, left: M * RG * e.s, rate: M * RG }); } }); say(t('{0} active', S.label), 'blood');
  }
  // Bone Offering's look (its spike: OfferingSpike, BoneOfferingSpike.ao): a bone spike with its skeleton's bones on it
  // (offeringBONE_spire bone01, bone tinted 1 / 0.64 / 0.2) over green necromantic energy rising from the ground while it
  // stands (offeringGroundBase necroEnergySpire 0.55 / 1 / 0.77, its wisps), a surge as it is made (offeringSurge: a pale
  // flash 1.13 / 1.14 / 1.5 for 0.14 s, a green burst up for 0.65 s, embers for 0.5-2.25 s; Offering_AoE: a ring for
  // 0.5 s) and green wisps bursting as it ends (offeringEnd); your minions' bone armour while it stands
  // (bone_armour_buff_effect: boneArmor, 16 + 8 bone pieces round each), bursting when a shield breaks (boneArmor_Explode:
  // a ring 0.8 / 0.68 / 0.44 for 0.3 s, shrapnel and bone debris). note: the spike's and the pieces' shapes, sizes and
  // how they circle are the scene's (cones and shards)
  const BOF = { bone: 0xd8ccb0, energy: 0x8cffc5, flash: 0xc0c2ff, ring: 0xffd9a0 };
  function boneOffer(c, g, R) {
    const mat = new THREE.MeshStandardMaterial({ color: BOF.bone, roughness: .6, flatShading: true }), sp = new THREE.Mesh(EARTH.spike, mat);
    sp.position.y = 1.15; sp.scale.set(.45, 1.45, .45); sp.castShadow = true; g.add(sp);
    for (let k = 0; k < 6; k++) { const a = k / 6 * TAU + rnd(.4), s = new THREE.Mesh(EARTH.spike, mat); s.position.set(Math.sin(a) * .35, .3 + rnd(.6), Math.cos(a) * .35); s.rotation.set(Math.cos(a) * .7, 0, -Math.sin(a) * .7); s.scale.setScalar(rnd(.15, .25)); g.add(s); }   // its skeleton's bones
    const base = fx.decal(c, 1, 'disc', BOF.energy, { a: .45, pulse: 3 }), at = { x: c.x, y: .5, z: c.z }, armour = new Map();
    fx.flash(c, BOF.flash, 8, .14, 5); fx.glow({ x: c.x, y: 1.4, z: c.z }, 2, BOF.flash, .14, 2.5); fx.pillar(c, .6, 3.5, BOF.energy, .65, 1.6); fx.ring(c, .2, R, BOF.energy, .5, { a: .6 });
    fx.emit(60, { p: at, r: .3, h: 1.5, v: 2.5, up: 1, life: 1.4, size: .05, c: BOF.energy, c2: BOF.flash, k: 2, drag: 1.5 });
    return {
      tick(dt, B) {
        if (Math.random() < dt * 10) fx.emit(1, { p: c, r: .45, v: .1, up: 1.6, life: 1.8, size: .06, c: BOF.energy, k: 1.6, drag: .5 });   // its wisps rising
        for (const m of objs) if (m.minion && !m.dead && m.fig && m.shot !== B && !armour.has(m)) {   // a minion's bone armour
          const a = new THREE.Group(); a.position.y = .9;
          for (let k = 0; k < 8; k++) { const s = new THREE.Mesh(EARTH.spike, mat), q = k / 8 * TAU; s.position.set(Math.sin(q) * .42, rnd(-.4, .4), Math.cos(q) * .42); s.rotation.set(rnd(TAU), rnd(TAU), rnd(TAU)); s.scale.setScalar(.08); a.add(s); }
          m.fig.group.add(a); armour.set(m, a);
        }
        for (const [m, a] of armour) if (m.dead || m.shot === B) { m.fig.group.remove(a); armour.delete(m); } else a.rotation.y += dt * 1.5;
      },
      off() { base.remove(); for (const [m, a] of armour) m.fig.group.remove(a); fx.emit(24, { p: at, r: .3, h: 1.2, v: 2, life: .5, size: .06, c: BOF.energy, k: 2, drag: 1 }); },
    };
  }
  K.pain = S => offer(S, 'pain', S.dmg.stats.base_number_of_pain_offerings_allowed);
  // Soul Offering: while its spike stands, your spells deal its more damage. note: its increased spell damage is applied as more
  K.soul = S => offer(S, 'soul', S.dmg.stats.base_number_of_power_offerings_allowed);
  // Bone Offering: a minion becomes its bone spike for its duration, up to its limit; see minion's hurt
  // note: the scene's spike is not attacked (its life is not in the data), so its shields last its duration
  K.bone = S => offer(S, 'bone', S.dmg.stats.base_number_of_bone_offerings_allowed);
  // Grim Feast: a slain persistent minion waits to be Revived; in your Presence, while Grim Feast is on, it leaves its
  // Grim Remnant. Used again (Grim Resurrection), the life you hold Revives the dead minions, oldest first, up to that
  // much total life of theirs; it is all consumed. note: the game's own Revive after a delay is not in the data
  // (PoB2 MinionRevivalTimeBase), so the scene's minions come back only this way or by using their skill again
  const volBlow = () => { if (!sheet().volImmune) { const VN = me.vol * VOLATILITY.dmg, VC = VN * Math.min(100, sheet().volCold || 0) / 100; hurt(VN - VC + (VC ? playerTakes(sheet(), 'cold', VC, false) : 0), 0, VC ? 'cold' : 'physical', false, null); }   /* Dream Fragments: its share taken as cold */
    me.volPower = { n: me.vol, until: time + VOLATILITY.time }; me.vol = Math.random() * 100 < (sheet().volRefresh || 0) ? me.vol : 0; me.volAt = time; };   // Volatility explodes (keywords.json Volatility)
  const gainVol = n => { me.vol = Math.min(sheet().volMax || VOLATILITY.max, (me.vol || 0) + n); me.volAt = time; };   // Volatility on you, up to its most, its fuse anew
  function fallen(S, e) {
    me.fallen.push({ name: S.name, life: e.segs[0].max });
    const EH = me.maxM * (S.dmg?.sum?.['recoup_mana_%_on_minion_death'] || 0) / 100, RT = sheet().recoup?.time || 8; if (EH > 0) me.recoup.push({ k: 'mana', left: EH, rate: EH / RT });   // Essence Harvest: its % of your maximum mana Recouped
    const RS = sheet().resummon, SC = S.dmg?.minionUndead ? onS('Sacrifice')?.dmg.stats['harvester_minion_resummon_speed_+%_final'] || 0 : 0;   // Sacrifice: undead ones Revive more slowly
    const FR = RS.friends && e.companion && objs.every(o => !o.minion || o.dead || o.companion) ? RS.friends : 0;   // Lifelong Friend: faster if all your minions are Companions
    if (RS.base) me.reviveAt = time + (S.dmg?.stats?.minion_base_resummon_time_ms / 1000 || RS.base) / (RS.speed + FR) / (1 + SC / 100);   // they all Revive after its delay, anew at each death (keywords.json Reviving Minions)
    if (sheet().volMinion) gainVol(sheet().volMinion);   // the tree's Volatility on a persistent minion's death
    const G = onS('Grim Feast'), s = G && rstats(G);
    if (s && dist(pp, e.pos) <= sheet().overgrow.r && Math.random() * 100 < s['grim_remnant_chance_to_spawn_orb_on_minion_death_in_presence_%']) remnant({ ...G, store: e.segs[0].max * s['grim_remnant_health_stored_in_globe_%'] / 100 }, e.pos);
  }
  // Kelari's Malediction, while on: every its secondary duration it Consumes a corpse in your Presence for its Corpse
  // Beetles (its description mode's number), while fewer than its most (its quality's more); a Beetle rushes the
  // nearest enemy and explodes (its monster's Sandblast, once). ponytail: Commanded at once, the scene has no Command for them
  function beetles() {
    const S = onS("Kelari's Malediction"), st = S?.dmg.stats; if (!st || time < (me.kmAt ?? 0)) return;
    const T = tog[S.name], c = corpses(pp, sheet().overgrow.r)[0]; me.kmAt = time + st.base_secondary_skill_effect_duration / 1000;
    if (!c || T.objs.filter(o => !o.dead).length >= st.maximum_corpse_beetles_allowed) return;
    eat(c, S.el); for (let k = 0; k < st.skill_specific_stat_description_mode; k++) T.objs.push(minion(S, around(c.pos, 1), Infinity, { kind: S.name, attacks: 1 }));
  }
  // Verisium Manifestations, while on: an attack hit of yours spends its Runic Ward cost (its cost efficiency) to summon a
  // Verisium Manifestation by the enemy for its duration (its quality's more), up to its limit (its Gemling quality's
  // more), its cooldown between. ponytail: its stored uses not counted, one per cooldown
  function manifest(d) {
    const S = onS('Verisium Manifestations'), st = S?.dmg.stats; if (!st || time < (me.vmAt ?? 0)) return;
    const cost = (st._cost?.Ward || 0) / (1 + (S.dmg.sum?.['base_ward_cost_efficiency_+%'] || 0) / 100); if (me.ward < cost) return;
    spendWard(cost); me.vmAt = time + (st._cooldown_ms || 0) / 1000;
    limit(o => o.kind === S.name && !o.dead, st.base_number_of_verisium_runes_allowed, S); minion(S, around(d.pos, 1.5), durOf(S), { kind: S.name });
  }
  // Skeletal Cleric: each Cleric Revives a fallen Skeleton every its Revive Skeleton's cooldown and use time (its
  // monster's skill), next to it; its quality: the Revived one immune to damage for its time
  function clerics() {
    const C = onS('Skeletal Cleric'), RV = C && monSkill('ResurrectSkeletonClericMinion'), every = (RV?.cooldown || 0) + (RV?.cast || 0); if (!every) return;
    for (const o of tog[C.name].objs) {
      if (o.dead || time < (o.revNext ??= time + every)) continue;
      const i = me.fallen.findIndex(f => api.info(onS(f.name)?.g || {})?.gem?.types?.includes('CreatesSkeletonMinion')); if (i < 0) continue;
      const [f] = me.fallen.splice(i, 1), X = onS(f.name); o.revNext = time + every; fx.ring(o.pos, 1.2, .3, 'gold', .4, { a: .5 });
      tog[f.name].objs.push(Object.assign(minion(X, around(o.pos, 1.5), Infinity), { revAt: time, immune: time + (C.dmg.stats.skeletal_cleric_revived_skeletons_immune_for_X_ms || 0) / 1000 }));
    }
  }
  // the fallen minions Revived, in their order, up to n total maximum life of theirs
  function reviveFallen(n) {
    let used = 0, k = 0;
    me.fallen = me.fallen.filter(f => { const X = onS(f.name); if (!X || f.life > n - used) return !!X; used += f.life; k++; tog[f.name].objs.push(Object.assign(minion(X, around(pp, 1.5), Infinity), { revAt: time })); return false; });
    me.life = Math.min(me.maxL, me.life + me.maxL * k * sheet().reviveLife / 100);   // the tree's life per minion Revived
    return { used, k };
  }
  function grim(S) {
    const { k } = reviveFallen(me.grim); me.grim = 0;
    fx.ring(pp, .3, 2, 'chaos', .5); say(t('{0}: {1} Revived', S.label, k), 'chaos');
  }
  // Wind Serpent's Fury: its spear thrust in a line in front of you (its area long, its secondary radius wide), then for
  // each Frenzy Charge it consumed a Wind Serpent (its part) along it, one after another. note: the knockback is not
  // simulated, nor a serpent's own path (the data gives none): they follow the thrust's line
  K.serpent = S => {
    const c = S.from, b = { x: c.x + S.dx * S.A, z: c.z + S.dz * S.A }, w = S.G.radius2 || 1, X = partOf(S, 'WindSerpentsFurySnakePlayer');
    const thrust = T => { fx.strip(c, b, w * 2, T.el, .4, { a: .7 }); for (const d of dummies) if (!d.dead && segDist(d.pos, c, b) <= w + SIM.body) hit(d, T); };
    thrust(S); if (X) for (let k = 1; k <= S.spent; k++) later(.2 * k, () => thrust(X));
  };
  // Eternal March: it spends up to its most Runic Ward to Revive your fallen minions, the most powerful first, with total
  // maximum life up to its multiple of the ward spent
  K.march = S => {
    const st = S.dmg.stats, x = st['skill_eternal_march_life_per_ward_spent_%'] / 100;
    me.fallen.sort((a, b) => b.life - a.life);
    const { used, k } = reviveFallen(Math.min(me.ward, st.skill_eternal_march_maximum_ward_cost) * x);
    if (used) spendWard(used / x);
    fx.ring(pp, .3, 2, 'holy', .5); say(t('{0}: {1} Revived', S.label, k), 'holy');
  };
  // Entangle: a fissure crawling from you toward your aim, its radius long, hitting along it; a plant lasting its duration,
  // up to its most at once. Every its interval a vine (its part) lashes at an enemy within the part's radius of it, up to
  // their most at once, hitting and slowing it per vine for the vine's duration. Overgrown: more vines, and its duration
  // runs slower
  K.entangle = S => {
    const st = S.dmg.stats, X = partOf(S, 'EntangleVinePlayer'), xs = X.dmg.stats, ang = Math.atan2(S.dx, S.dz), a = { x: pp.x, z: pp.z }, b = { x: a.x + Math.sin(ang) * S.A, z: a.z + Math.cos(ang) * S.A }, dur = durOf(S);
    limit(o => o.entangle && o.name === S.name, st.base_number_of_entangle_roots_allowed, S);
    fissure(S, a, ang, S.A, radOf(S), 1, { dur, max: st.base_number_of_entangle_roots_allowed });
    let k = 0, vines = [];
    planted(thing(holder(a), dur, { name: S.name, entangle: true, plant: S, c: { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, R: S.A / 2, tick(dt, e) {
      presence(e); if (e.overgrown) e.s += dt * st['entangle_duration_speed_+%_when_wet'] / 100;
      if ((k -= dt) > 0) return; k = st.entangle_apply_vines_every_X_ms / 1000;
      vines = vines.filter(v => v.until > time);
      if (vines.length >= xs.entangle_vines_maximum_number_of_vines_allowed + (e.overgrown ? xs.entangle_vines_additional_number_of_vines_allowed_when_wet : 0)) return;
      const d = dummies.filter(d => !d.dead && segDist(d.pos, a, b) <= X.A + SIM.body).sort((p, q) => p.slows.length - q.slows.length)[0]; if (!d) return;
      const v = { until: time + xs.entangle_vine_duration_ms / 1000, pct: xs['entangle_base_movement_speed_+%_final_per_applied_stack'] * slowK(S) }; vines.push(v); d.slows.push(v);
      fx.streak(V(d.pos.x, 0, d.pos.z), V(d.pos.x, 1.2, d.pos.z), 'poison', .14, .05, .6); hit(d, X);
    } }));
  };
  // Tame Beast: its wisps engulf the Rare Beast nearest your aim, Hindering it by its % for its duration. note: capturing
  // the beast is not simulated
  K.tame = S => {
    const [d] = nearest(S.at, 1, e => e.mon.category === 'Beast' && (e.stat.rarity === 'rare' || sheet().tameUnique && e.stat.rarity === 'unique'));   // the tree's: Unique Beasts too
    if (!d) return;
    d.slows.push({ until: time + durOf(S), pct: -S.dmg.stats['tame_beast_hinder_%'] * slowK(S) }); fx.ring(d.pos, .2, 1, 'poison', .5, { a: .5 });
  };
  // Temporal Rift: an afterimage of you every its interval, up to its most (vitals); used, you go back to the oldest, with
  // the life, mana and energy shield you had then
  K.trift = S => {
    const o = me.rifts[0]; if (!o) return; fx.ring(pp, .2, 1.5, S.el, .4);
    pp.x = o.x; pp.z = o.z; Object.assign(me, { life: o.life, mana: o.mana, es: o.es }); me.rifts = [];
    fx.ring(pp, 1.5, .2, S.el, .4); say(t('{0} active', S.label), S.el);
  };
  // Mana Drain: Leeches its amount of mana from the enemy at your aim, at its leech rate, and Hinders it
  K.drain = S => {
    const st = S.dmg.stats, d = near(S.at, 2); if (!d) return;
    fx.streak(chest(d), V(pp.x, 1.2, pp.z), 'lightning', .4, .05, 1);
    const q = me.leech.mana; q.left += st.mana_drain_base_mana_leech_amount * (1 - (d.stat.leechRes || 0)); q.rate = q.left * (1 + st['base_mana_leech_rate_+%'] / 100);
    d.slows.push({ until: time + HINDER.time * (sheet().hinderTime || 1), pct: -HINDER.slow * slowK(S) });
  };
  // Ancestral Cry's Kaom (ancestralcrykaom*.ao: Kaom's skin on you): the figure a fifth larger, its skin dark red
  // glowing as embers (warcry_ancestral's red-orange) and sparks rising off it, while it lasts
  const KAOM_SKIN = new THREE.Color(0x6e2414), KAOM_GLOW = 0xff5a1e, KG = new THREE.Color(KAOM_GLOW);
  // Barkskin's look (reservation_barkskin barkSkin_Skin.mat, on its buff while it is on): the game's bark texture laid
  // over you triplanar, growing out from your chest (its sphere mask), coloured by its look-up (0.63 / 0.41 / 0.2 from a
  // fifth of the texture's brightness up, darker below; sRGB, as linear here) with a yellow-green glow flowing through its
  // cracks (scrolling caustic noise, 0.67 / 1 / 0.2 by 1.9). note: the bark's tiling and the glow's strength are the scene's
  const barkTex = new THREE.TextureLoader().load('poe2_data/available/img/art/particles/fxlib/pbr/bark_clr.webp');
  barkTex.wrapS = barkTex.wrapT = THREE.RepeatWrapping; barkTex.colorSpace = THREE.SRGBColorSpace;
  const barkU = { barkK: { value: 0 }, barkT: { value: 0 }, barkMap: { value: barkTex }, demK: { value: 0 }, demS: { value: 0 }, demO: { value: 0 } };   // and Demon Form's skin
  function barkSkin(M) {
    M.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, barkU);
      sh.vertexShader = 'varying vec3 vBark, vBarkN;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vBark = position; vBarkN = normal;');
      sh.fragmentShader = 'uniform float barkK, barkT, demK, demS, demO; uniform sampler2D barkMap; varying vec3 vBark, vBarkN;\n' + sh.fragmentShader
        .replace('#include <map_fragment>', `#include <map_fragment>
          vec3 bw = pow(abs(normalize(vBarkN)), vec3(4.)); bw /= bw.x + bw.y + bw.z; vec3 bp = vBark * 2.2;
          vec3 bark = texture2D(barkMap, bp.zy).rgb * bw.x + texture2D(barkMap, bp.xz).rgb * bw.y + texture2D(barkMap, bp.xy).rgb * bw.z;
          float bl = pow(dot(bark, vec3(.333)), 1. / 2.2), bm = smoothstep(barkK * 1.35, barkK * 1.35 - .12, length(vBark - vec3(0., 1.1, 0.)));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.36, .14, .03) * smoothstep(0., .21, bl) * (.15 + 1.6 * smoothstep(.2, .5, bl)), bm);
          float dd = length(vBark - vec3(0., 1.1, 0.)), dm = smoothstep(demK * 1.35, demK * 1.35 - .12, dd);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.047, .04, .044), dm);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float bf = .5 + .5 * sin(vBark.y * 7. + vBark.x * 3. - barkT * 1.6);
          totalEmissiveRadiance = mix(totalEmissiveRadiance, vec3(.42, 1., .03) * 1.9 * .5 * bf * smoothstep(.3, .22, bl), bm);
          float fr = pow(1. - clamp(dot(normal, normalize(vViewPosition)), 0., 1.), 1.2), de = smoothstep(.1, 0., abs(dd - demK * 1.35 + .06));
          totalEmissiveRadiance = mix(totalEmissiveRadiance, vec3(0.), dm) + vec3(1., .09, .03) * (de * 2.5 * step(.001, demK) + fr * fr * fr * dm * demS * .8) + vec3(1., .35, .15) * fr * demO * (1. - dm) * 3.;`);
    };
    M.needsUpdate = true;
  }
  let kaomK = 0, apoK = 0, barkK = 0;
  // Demon Form's look (infernalist_demonform; DemonForm.ao: InfernalistAscendancyForm with its wings). As you shift,
  // darkness is drawn into you for 0.45-0.75 s (transform_IN: 0.6 / 0.5 / 1 by 0.45), your human skin burns away at its
  // edges (humanOut_Skin: 1 / 0.35 / 0.15) and the demon's spreads out from your chest (its sphere mask), dark (its
  // texture's mean 61 / 57 / 59) with a red burning edge (1 / 0.09 / 0.03), its wings (68 / 50 / 59) growing with it;
  // their blast (wingBlast: a bright dome for 1.5 s, 0.92 / 0.88 / 1; wind waves for 0.25-0.35 s, 0.24 / 0.23 / 0.26; a
  // ring of smoke for 2-2.5 s, 0.08) and darkness left about you for 0.35-1.15 s (transform_Remains). In it, its wings
  // beat (idle_01: two flaps 1.02 s apart), wisps of darkness and red embers rise off you (demonWisps_Idle: 1-1.25 s,
  // 0.5-2 s; 1 / 0.24 / 0.21) and its red glow at your edges grows with your Demonflame (GameplayDrivenMultiplier). As
  // you revert (transform_deactivate) blood gushes out of you (shift_BLOOD, 10 s). note: the wisps' colour is not in the
  // data (darkness here); the wings' blast is at your shift here; the counts, speeds and sizes are the scene's
  const DEMON = { wing: 0x44323b, dark: 0x453873, violet: 0x9980ff, ember: 0xff3d36, blast: 0xebe0ff, wind: 0x7a7684, smoke: 0x333333, blood: 0x8a0008, stain: 0x5a0006, flap: 1.02 };
  let demK = 0, wings = null;
  function demonIn(grow) {
    const c = { x: pp.x, y: 1.1, z: pp.z };
    barkU.demO.value = 1;
    for (let i = 0; i < 28; i++) { const a = rnd(TAU), r = rnd(1.2, 2), y = rnd(.2, 2.2); fx.emit(1, { p: { x: pp.x + Math.cos(a) * r, y, z: pp.z + Math.sin(a) * r }, dir: V(-Math.cos(a) * r * 1.6, (c.y - y) * 1.6, -Math.sin(a) * r * 1.6), v: .1, life: .6, size: .35, c: DEMON.dark, smoke: true, a: .6 }); }
    for (let i = 0; i < 8; i++) { const a = rnd(TAU), r = rnd(1.2, 2); fx.streak(V(pp.x + Math.cos(a) * r, rnd(.2, 2.2), pp.z + Math.sin(a) * r), V(c.x, c.y, c.z), DEMON.violet, rnd(.45, .75), .015, .35); }
    later(.02, () => { fx.ball({ x: pp.x, y: 0, z: pp.z }, 1.4, DEMON.blast, 1.5, .05); fx.emit(60, { p: { x: pp.x, y: .15, z: pp.z }, r: .5, v: 3, life: 2.2, size: .5, grow: 2, c: DEMON.smoke, smoke: true, a: .4, drag: 1.5, flat: true }); });
    later(.06, () => { for (let i = 0; i < 3; i++) later(i * .04, () => fx.ring(pp, .3, 2.4, DEMON.wind, .3, { a: .5, y: 1 })); });
    later(grow, () => fx.emit(16, { p: c, r: .4, h: 1.6, v: .3, up: .4, life: .75, size: .4, grow: 1.4, c: DEMON.dark, smoke: true, a: .5, drag: 1 }));
  }
  function demonBlood() {
    const c = { x: pp.x, y: 1.1, z: pp.z };
    fx.emit(14, { p: c, r: .25, h: .5, v: 1.4, up: 1.2, life: 1.2, size: .08, c: DEMON.blood, g: 9, drag: .6 });
    fx.disc({ x: pp.x, z: pp.z }, .6, DEMON.stain, 10, { dark: true, a: .9, tex: 'patch', hold: .8, y: .03 });
  }
  function demonLook(dt) {
    const on = !!me.demon, k = demK = clamp(demK + (on ? dt / me.demon.grow : -dt * 2), 0, 1), M = me.demon?.max;
    barkU.demK.value = k; barkU.demS.value = on ? Math.min(1, demon() / (M < Infinity ? M : 10)) : 0; barkU.demO.value = Math.max(0, barkU.demO.value - dt / (.45 * (me.demon?.grow || 1)));
    if (k && !wings) { wings = makeWings(DEMON.wing); player.chest.add(wings.group); wings.group.position.set(0, .14, -.12); }
    if (!wings) return k;
    if (!k) { wings.dispose(); wings = null; return 0; }
    const f = Math.sin(time * TAU / DEMON.flap);
    wings.group.scale.setScalar(Math.max(1e-3, k));
    for (const [w, s] of [[wings.R, 1], [wings.L, -1]]) { w.rotation.y = s * (.45 + .3 * f); w.rotation.z = s * .12 * f; }
    if (on && Math.random() < dt * 8) fx.emit(1, { p: { x: pp.x, y: rnd(.4, 1.8), z: pp.z }, r: .35, v: .15, up: .8, life: 1.1, size: .3, grow: 1.4, c: DEMON.dark, smoke: true, a: .4, drag: 1 });
    if (on && Math.random() < dt * 12) fx.emit(1, { p: { x: pp.x, y: rnd(.3, 1.8), z: pp.z }, r: .4, v: .3, up: 1, life: 1.25, size: .05, c: DEMON.ember, c2: 'white', k: 2.4, drag: 1 });
    return k;
  }
  // (and a skill's glow on your skin for a moment, w: me.skin = { at, hex, dur }: Animus Exchange's Runic Ward blue for
  // 1.5 s, Apocalypse's orange for 1 s; note: how long is not in the data)
  // Arctic Howl's look (werewolf_warcry: warCry_01.pet, tundraHunter_buff.epk, exertedPower_01): its howl a wave of
  // pale blue going out over its area with an echo after it (warCry_Wave 0.7 / 0.82 / 1) and a ring of snow blown out
  // (waveSnow, its glow 0.35 / 0.4 / 0.4), your skin lit pale blue for a moment and a flare of glitter on you (buffApply
  // skin 0.7 / 0.82 / 1, glitter 0.45 / 0.67 / 1), frost on the enemies it reaches; while it Empowers your attacks your
  // skin and paws glow pale blue with glitter and mist ribbons round you (wolfPackBuff skin and paws 0.7 / 0.85 / 1,
  // ribbons 0.94 / 0.96 / 1), and each Empowered attack leaves a trail of mist (exertedMist 0.7 / 0.87 / 1)
  const HOWL = { wave: 0xb3d1ff, snow: 0xc8d0d6, glitter: 0x73abff, skin: 0xb3d9ff, mist: 0xeef5ff, trail: 0xb3deff };
  function howlLook(c, R) {
    me.skin = { at: time, hex: HOWL.skin, dur: .8 };
    for (let k = 0; k < 3; k++) later(k * .14, () => fx.ring(c, .4, R * (1 - k * .12), HOWL.wave, .6, { a: .75 - k * .2, k: 2 }));
    fx.emit(60, { p: { x: c.x, y: .25, z: c.z }, r: .4, v: R * 1.6, flat: true, life: .9, size: .35, grow: 1.6, c: HOWL.snow, smoke: true, a: .55, drag: 1.4 });
    fx.glow({ x: pp.x, y: 1.4, z: pp.z }, 2.2, HOWL.wave, .35, 2);
    fx.emit(14, { p: { x: pp.x, y: 1.2, z: pp.z }, r: .5, h: .8, v: .6, life: 1.2, size: .08, c: HOWL.glitter, c2: 'white', k: 2.4, drag: 1 });
    for (const d of inside(c, R)) fx.emit(5, { p: { x: d.pos.x, y: .9, z: d.pos.z }, r: .35, h: 1, v: .3, up: .3, life: 1, size: .3, grow: 1.5, c: HOWL.mist, smoke: true, a: .45, drag: 1 });
  }
  function howlTrail(S) {
    const H = hand(), to = S.at || { x: pp.x + S.dx * 2, z: pp.z + S.dz * 2 };
    for (let i = 0; i < 16; i++) { const k = i / 15; fx.emit(1, { p: { x: H.x + (to.x - H.x) * k, y: H.y + (1 - H.y) * k, z: H.z + (to.z - H.z) * k }, r: .12, v: .3, life: .6, size: .36, grow: 1.6, c: HOWL.trail, smoke: true, a: .7, drag: 1.5 }); }
    fx.emit(8, { p: { x: to.x, y: 1, z: to.z }, r: .3, v: 1.2, up: .4, life: .7, size: .4, grow: 1.6, c: HOWL.mist, smoke: true, a: .55, drag: 1.5 });   // its frost bursting where it lands
    fx.emit(10, { p: { x: to.x, y: 1, z: to.z }, r: .3, v: 2, life: .5, size: .08, c: HOWL.glitter, c2: 'white', k: 2.4, drag: 2 });
  }
  // Barrage's look (bow_barrage: exert_buff / exert_buff_charges.pet on your bow or spear, buff_flash_pass.mat, muzzle.pet):
  // readying it a green flash over you (0.36 / 1 / 0.2) and a swirl of pale green round your weapon, which glows on while
  // it Empowers (its core, glow and ring 0.75 / 1 / 0.55; 0.66 / 1 / 0.4 with Frenzy Charges consumed); each shot of the
  // Empowered attack green ribbons and sparks at your weapon (0.66 / 1 / 0.4, 0.72 / 1 / 0.5)
  const BARRAGE = { flash: 0x5cff33, core: 0xbfff8c, charged: 0xa8ff66, ribbon: 0xa8ff66, spark: 0xb8ff80 };
  function barrageReady(ch) {
    const H = hand(), c = ch ? BARRAGE.charged : BARRAGE.core;
    me.skin = { at: time, hex: BARRAGE.flash, dur: .5 };
    fx.glow(H, 1.1, c, .4, 2.4);
    for (let i = 0; i < 18; i++) { const a = i / 18 * TAU; later(i * .012, () => { const q = hand(); fx.emit(1, { p: { x: q.x + Math.cos(a) * .35, y: q.y + Math.sin(a) * .18, z: q.z + Math.sin(a) * .35 }, dir: V(-Math.sin(a) * 1.5, .3, Math.cos(a) * 1.5), life: .4, size: .12, c, c2: 'white', k: 2.4, drag: 2 }); }); }
  }
  function barrageMuzzle() {
    const H = hand();
    fx.glow(H, 1, BARRAGE.ribbon, .2, 2.6);
    fx.emit(10, { p: H, r: .08, v: 3, life: .3, size: .07, c: BARRAGE.spark, c2: 'white', k: 2.6, drag: 3 });
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; fx.emit(1, { p: { x: H.x + Math.cos(a) * .2, y: H.y + Math.sin(a) * .2, z: H.z }, dir: V(-Math.sin(a) * 2, Math.cos(a) * 2, 0), life: .3, size: .16, c: BARRAGE.ribbon, k: 2.2, drag: 2 }); }
  }
  // Berserk's look (berserk_reservation has none: Rage's look while you are berserking, BuffVisualsArtVariations rage ->
  // rage_berserk_override, reservation_bloodrage/rage_override.epk): while it is on and you have Rage, a red glow over you
  // (rage_buff_pass 1 / 0.08 / 0.02 x25 through caustic noise), red ribbons off your upper body (rage_buff.pet: rage_ribbons
  // 1 / 0.05 / 0.02), orange embers off your body (bloodRage_Xtra: rage_XTRA_R 1 / 0.32 / 0.1) and ribbons of blood
  // (bloodRage_Blood: bloodRibbons_R, its subsurface 0.23 / 0 / 0). note: Rage's own look without Berserk is not drawn yet
  const BERSERK = { skin: 0xff1405, ribbon: 0xff0d05, ember: 0xff501a, blood: 0x3b0000 };
  function berserkLook() {
    const rg = tog.Berserk && me.rage > 0 ? Math.min(1, me.rage / Math.max(1, rageMax())) : 0; if (!rg) return 0;
    const at = y => ({ x: pp.x, y, z: pp.z });
    if (Math.random() < .15 + .3 * rg) fx.emit(1, { p: at(rnd(1.2, 1.6)), r: .3, v: .2, up: .8, life: 1.6, size: .1, grow: 1.4, c: BERSERK.ribbon, c2: BERSERK.skin, k: 1.8, drag: 1 });
    if (Math.random() < .3 + .6 * rg) fx.emit(1, { p: at(rnd(.3, 1.7)), r: .3, v: .3, up: .5, life: 2, size: .05, c: BERSERK.ember, c2: 'white', k: 2.4, drag: 1.5 });
    if (Math.random() < .25 * rg) fx.emit(1, { p: at(rnd(.8, 1.6)), r: .3, v: .4, up: .6, life: 1.2, size: .1, c: BERSERK.blood, smoke: true, a: .9, g: 5 });
    return (.2 + .2 * rg) * (.8 + .2 * Math.sin(time * 9));
  }
  // Convalescence, used while it is on (and your Energy Shield is not full): your Energy Shield starts Recharging at once
  // and its Buff, for its duration (its quality's more), keeps hits from interrupting that Recharge (hurt); the Buff
  // ends at full Energy Shield. Its look (reservation_convalescence): used (burst.ao, convalescence_burst.epk), a flash
  // (burst_Flash 0.7 / 0.82 / 1, 0.25 s), a blurred sphere (0.5 s from 0.05 s), 64 strings of light (burst_Strings
  // 0.45 / 0.67 / 1, 0.35-2 s from 0.085 s), your skin lit (burstPower_Skin 0.35 / 0.67 / 1), flares (burst_LensFlare
  // 0.3 / 0.69 / 1, 0.3 s) and sparks (burst_Sparks 0.2 / 0.69 / 1, 0.12-0.75 s from 0.065 s); while its Buff lasts
  // (recover_es.epk), pale blue ribbons wind round your chest (esBarrier: es_Ribbons 0.5 / 0.87 / 1, 1 s each) and
  // flares rise off you (energyShield_Sustain: 0.25-0.4 s). note: its sizes are the scene's
  const CONV = { flash: 0xb3d1ff, string: 0x73abff, skin: 0x59abff, flare: 0x4dafff, spark: 0x33b0ff, ribbon: 0x80dfff };
  function convalesce(S) {
    const c = { x: pp.x, y: 1.1, z: pp.z }, dur = durOf(S);
    me.esHurt = me.esStop = -99; me.conv = time + dur; setBuff({ label: S.label, name: S.name, c: '#80dfff', s: dur });
    fx.glow(c, 1.6, CONV.flash, .25, 3); me.skin = { at: time, dur: .6, hex: CONV.skin };
    fx.emit(8, { p: c, r: .4, v: .2, up: 3, life: .3, size: .12, c: CONV.flare, c2: 'white', k: 2.6 });
    later(.05, () => fx.glow(c, 1.1, CONV.string, .5, 1.6));
    later(.065, () => fx.emit(20, { p: c, r: .2, v: 3.5, up: 1, life: .45, size: .04, c: CONV.spark, c2: 'white', k: 2.6, drag: 2 }));
    later(.085, () => fx.emit(64, { p: c, r: .3, v: 2.2, up: .6, life: 1.2, size: .05, c: CONV.string, c2: 'white', k: 2.4, drag: 2 }));
  }
  function convLook(dt) {
    if (!(time < me.conv)) return;
    if (me.es >= me.maxE) { me.conv = 0; buffs = buffs.filter(b => b.name !== 'Convalescence'); return; }
    for (const k of [0, Math.PI]) { const a = time * 5 + k; fx.emit(2, { p: { x: pp.x + Math.cos(a) * .45, y: 1.2 + Math.sin(time * 3 + k) * .2, z: pp.z + Math.sin(a) * .45 }, r: .02, v: 0, up: .05, life: .6, size: .11, c: CONV.ribbon, c2: 'white', k: 3, drag: 1 }); }
    if (Math.random() < dt * 6) fx.emit(1, { p: { x: pp.x, y: rnd(.6, 1.6), z: pp.z }, r: .35, v: .1, up: 1.5, life: .3, size: .1, c: CONV.flare, c2: 'white', k: 2.4 });
  }
  const WARD = 0x125eff, WG = new THREE.Color();
  function kaomLook(dt) {
    const on = me.kaom && time < me.kaom.until, k = kaomK = Math.max(0, Math.min(1, kaomK + (on ? dt * 4 : -dt * 2))), sk = me.skin, ch = time < (me.chayula?.until ?? -9);
    let w = sk ? Math.max(0, 1 - (time - sk.at) / sk.dur) : 0;
    const bz = berserkLook(); convLook(dt); palmLook(dt); auraLook(dt); confluxLook(dt); eaRods(dt);
    if (w) WG.set(sk.hex); else if (ch) { w = .6; WG.set(CHAYULA.skin); }   // Archon of Chayula's
    else if (bz) { w = bz; WG.set(BERSERK.skin); }   // Berserk: red over you while you have Rage
    const BR = empower.find(e => e.type === 'repeat' && e.name === 'Barrage');   // Barrage Empowering: your weapon glows
    if (BR) { const H = hand(), c = BR.charged ? BARRAGE.charged : BARRAGE.core; fx.emit(2, { p: H, r: .15, v: .2, up: .15, life: .4, size: .13, c, c2: 'white', k: 2.4, drag: 1 }); if (Math.random() < .25) fx.glow(H, .7, c, .2, 2); }
    const howl = empower.some(e => e.type === 'cold');   // Arctic Howl Empowering your attacks
    if (!w && howl) { w = .3; WG.set(HOWL.skin); }
    if (howl) {
      if (Math.random() < .4) fx.emit(1, { p: { x: pp.x, y: rnd(.3, 1.8), z: pp.z }, r: .45, v: .15, up: .2, life: 1.4, size: .06, c: HOWL.glitter, c2: 'white', k: 2.2, drag: 1 });
      if (Math.random() < .15) fx.emit(1, { p: { x: pp.x, y: rnd(.2, 1.2), z: pp.z }, r: .5, v: .2, up: .4, life: 1.6, size: .35, grow: 1.5, c: HOWL.mist, smoke: true, a: .25, drag: 1 });
      if (Math.random() < .3) { const H = hand(); fx.emit(1, { p: { x: H.x, y: H.y, z: H.z }, r: .05, v: .1, life: .4, size: .1, c: HOWL.wave, k: 2, drag: 1 }); }
    }
    if (ch) {
      for (const s of [-1, 1]) { const q = player.eye(V(), s); fx.emit(1, { p: q, v: 0, life: .05, size: .13, c: CHAYULA.skin, c2: 'white', k: 3 }); }
      if (Math.random() < .5) fx.emit(1, { p: { x: pp.x, y: rnd(.3, 1.7), z: pp.z }, r: .3, up: 1.4, v: .25, life: .8, size: .14, c: CHAYULA.string, c2: CHAYULA.violet, k: 2, drag: 1 });
    }
    const bk = barkK = Math.max(0, Math.min(1, barkK + (onS('Barkskin') ? dt : -dt * 2)));   // grows over you in a second
    const dk = demonLook(dt);
    if (!k && !w && !bk && !dk && !player.kaomed) return;
    player.kaomed = k > 0 || w > 0 || bk > 0 || dk > 0; barkU.barkK.value = bk; barkU.barkT.value = time; player.group.scale.setScalar(1 + .2 * k);
    player.group.traverse(m => { if (!m.isSkinnedMesh || !m.material?.emissive) return; const M = m.material, u = M.userData;
      if (!u.c0) { u.c0 = M.color.clone(); u.e0 = M.emissive.clone(); u.i0 = M.emissiveIntensity; } if (!u.bark) { u.bark = true; barkSkin(M); }
      M.color.copy(u.c0).lerp(KAOM_SKIN, k).lerp(WG, w * .6); M.emissive.copy(u.e0).lerp(KG, k).lerp(WG, w); M.emissiveIntensity = u.i0 * (1 - Math.max(k, w)) + k * (.22 + .08 * Math.sin(time * 7)) + w * .9; });
    if (w && Math.random() < w * .5) fx.emit(1, { p: { x: pp.x, y: rnd(.3, 1.8), z: pp.z }, r: .3, up: 1, v: .2, life: .7, size: .12, c: WG.getHex(), k: 1.8, drag: 1 });   // its runes, embers rising off you
    if (k && Math.random() < k * .6) fx.emit(1, { p: { x: pp.x, y: rnd(.3, 2), z: pp.z }, r: .35, up: 1.2, v: .3, life: .6, size: .12, c: 'fire', c2: 'ember', k: 1.6, drag: 1 });
  }
  // Demon Form: a shapeshift until used again, a skill that isn't a spell is used or you reach 1 Life; a Demonflame
  // each second in it (up to Demonic Possession's most, 10 in its description; no most with Mastered Darkness), each its more spell damage and its Life lost per minute; its cast speed
  const demonCast = b => me.demon && b.P.spell ? 1 + me.demon.st['demon_form_grants_cast_speed_+%'] / 100 : 1;   // its increased cast speed. note: as more here
  const demon = () => me.demon ? Math.min(me.demon.max, Math.floor(time - me.demon.at)) : 0;
  const demonOff = () => { say(t('{0} off', me.demon.label), 'dust'); (cdReady[me.demon.name] ||= []).push(time + me.demon.cd / 1000); me.demon = null; demonBlood(); };
  K.demon = S => { if (me.demon) return demonOff(); const sm = S.dmg.sum || {}; me.demon = { st: S.dmg.stats, at: time, label: S.label, name: S.name, max: sm.demon_form_has_no_max_stacks ? Infinity : sm.max_demon_form_stacks || 10, grow: useTime(S), cd: S.dmg.cooldown || 0 }; demonIn(me.demon.grow); say(t('{0} on', S.label), 'fire'); };
  // Inevitable Agony: the enemies in its area record its share of the damage hits deal them, for its duration; once it
  // ends, or once what it recorded could kill them, they lose that much life at once
  K.agony = S => {
    const pct = S.dmg.stats['curse_pain_synchronisation_base_recorded_damage_%_to_apply'], until = time + durOf(S);
    for (const d of inside(S.at, S.A)) d.agony = { S, pct, until, n: 0 };
    fx.ring(S.at, .3, S.A, 'chaos', .5);
  };
  function agonyEnds(d) { const A = d.agony; d.agony = null; if (A.n > 0) { fx.ring(d.pos, .2, 1.2, 'chaos', .4); damage(d, A.n, { ...A.S, src: 'agony' }, false, true); } }
  // Ritual Sacrifice: a Rare (or Unique) monster's corpse at the cursor is consumed, else you stab yourself for its share
  // of your life; either way its buff, for its duration: the monster's modifiers, or a single random monster modifier
  // (as Headhunter's, shrineOn)
  K.sacrifice = S => {
    const d = corpseAt(S.at, Math.max(S.A, SIM.snap)), rare = d && POWER[d.stat.rarity] >= POWER.rare;
    if (rare) eat(d, 'blood'); else { me.life = Math.max(1, me.life - me.maxL * S.dmg.stats['head_hunt_%_life_to_remove_on_self_stab'] / 100); fx.emit(10, { p: { x: pp.x, y: 1.1, z: pp.z }, v: 1.5, up: 1, life: .4, size: .14, c: 'blood' }); }
    const own = MON_MODS.filter(x => !x.aura?.foe), one = own[Math.floor(Math.random() * own.length)];
    (me.hh ||= []).push({ stats: rare ? d.stat.rare : one?.stats || {}, until: time + durOf(S) }); shC.at = -99;
    setBuff({ label: S.label, name: S.name, c: css('blood'), s: durOf(S) });
  };
  // Iron Ward: while on, it stores its share of the physical damage your armour mitigates, up to its most; used, a nova of
  // that stored damage, its area more by how full it is. note: the stored damage as it is, not scaled by the skill's modifiers
  K.iron = S => {
    const st = S.dmg.stats, n = me.iron || 0; if (!n) return toast(t('{0}: nothing stored', S.label));
    const R = S.A * Math.sqrt(1 + st['warding_steel_area_of_effect_+%_final_per_charge_%'] * n / st.warding_steel_maximum_stored_mitigated_physical_damage);
    me.iron = 0; boom({ x: pp.x, z: pp.z }, R, { ...S, els: ['physical'], el: 'physical', dmg: { ...S.dmg, hits: { physical: [n, n] } } });
  };
  // Time Freeze: time stops for the enemies in its area, for its duration, halved for each time it was stopped for them
  // within its resistance duration (its text). note: their ailments do not pause here
  K.tfreeze = S => {
    const dur = durOf(S), RD = S.dmg.stats.time_freeze_resistance_duration_ms / 1000;
    for (const d of inside(pp, S.A)) { d.tfz = (d.tfz || []).filter(u => time - u <= RD); d.halt = time + dur / 2 ** d.tfz.length; d.tfz.push(time); }
    fx.ring(pp, .3, S.A, 'white', .7, { k: 2 }); say(t('{0} active', S.label), 'white');
  };
  // Pinnacle of Power: for its duration per power charge consumed, its more elemental damage per charge, and its
  // elemental ailments from every damage type (afflict)
  K.pinnacle = S => {
    const st = S.dmg.stats, n = S.spent, dur = n * st.elemental_power_buff_duration_per_power_charge_ms / 1000;
    me.pinn = { until: time + dur, more: n * st['elemental_power_elemental_damage_+%_final_per_power_charge'] }; setBuff({ label: S.label, name: S.name, c: css('gold'), s: dur });
  };
  // Cluster Grenade (crossbow_cluster_grenade): its grenade lands and burns its fuse (grenade_match.pet: sparks for
  // 0.12-0.45 s; grenade_cluster.mat Vibrance 4 / 2.6 / 2), then explodes (main_explode.pet: a fireball for 0.35 s,
  // emissive 24 / 13.92 / 9.6; a ring for 0.2 s, 1 / 0.58 / 0.4; 256 sparks for 0.1-0.3 s; 64 shards for 0.75-1.25 s, hot
  // (1 / 0.34 / 0.2) then grey (0.2 / 0.2 / 0.22); 64 embers for 1-2 s, 1 / 0.37 / 0.1) and throws its mini grenades
  // (ClusterGrenadeMiniPlayer: its number, its radius, its detonation time, its damage), each a hot shell
  // (secondary_shell 1 / 0.44 / 0.2) that explodes (secondary_explode.pet: a fireball for 0.25 s, 24 / 6.29 / 2.4; a flash
  // for 0.1 s, 1 / 0.71 / 0.5; 32 flames for 0.25-0.4 s, 1 / 0.53 / 0.29; 16 dark smoke puffs for 0.5-1.5 s; 128 sparks,
  // 64 embers for 1.5-4 s and a scorch for 4 s). note: the sparks' colour is their texture's, the embers' here
  const CGR = { body: 0xffa680, ember: 0xff5e1a, ball: 0xffb999, ring: 0xff9466, hot: 0xff5733, shard: 0x323437, shell: 0xff7033, mball: 0xff4319, flash: 0xffb580, flame: 0xff874a, smoke: 0x080606, scorch: 0x0a0605 };
  const clusterShell = r => { const m = fx.orb(CGR.body, r); m.userData.core.material.color.set(CGR.shell); return m; };
  const clusterFuse = (m, dt) => { if (Math.random() < dt * 60) fx.emit(1, { p: { x: m.position.x, y: m.position.y + .12, z: m.position.z }, r: .03, v: .8, up: 1, life: rnd(.12, .45), size: .04, c: CGR.ember, c2: CGR.flash, k: 2.6, g: 3 }); };
  function clusterMain(c, R) {
    const q = { x: c.x, y: .5, z: c.z };
    fx.ball(q, R * .8, CGR.ball, .35, 3); fx.flash(c, CGR.ball, 30 + R * 22, .3, 8 + R * 3); fx.ring(c, .2, R, CGR.ring, .2, { a: .8 });
    fx.emit(80, { p: q, r: .2, v: R * 5, up: 2, life: .2, size: .05, c: CGR.flash, c2: CGR.ember, k: 2.8, drag: 2.5 });   // its sparks
    fx.emit(64, { p: q, r: .2, v: R * 2.2, up: 4, life: 1, size: .07, c: CGR.hot, c2: CGR.shard, g: 9, drag: .6 });   // its shards
    fx.emit(64, { p: q, r: R * .3, v: R * 1.2, up: 2, life: 1.5, size: .04, c: CGR.ember, k: 2.4, g: 1, drag: 1.2 });
    shake = Math.max(shake, Math.min(.5, R * .09));
  }
  function clusterMini(c, R) {
    const q = { x: c.x, y: .35, z: c.z };
    fx.ball(q, R * .8, CGR.mball, .25, 3); fx.flash(c, CGR.flash, 12 + R * 10, .1, 4 + R * 2); fx.ring(c, .15, R, CGR.ring, .2, { a: .7 });
    fx.emit(10, { p: q, r: R * .3, v: .6, up: 1.5, life: .33, size: .3, grow: 1.6, c: CGR.flame, k: 2.2, drag: 1 });
    fx.emit(40, { p: q, r: .1, v: R * 5, up: 2, life: .2, size: .04, c: CGR.flash, c2: CGR.ember, k: 2.8, drag: 2.5 });
    fx.emit(16, { p: q, r: R * .4, v: .4, up: .8, life: 1, size: .55, grow: 2, c: CGR.smoke, smoke: true, a: .7, drag: 1 });
    fx.emit(24, { p: q, r: R * .4, v: R, up: 1.5, life: 2.7, size: .035, c: CGR.ember, k: 2.4, g: 1, drag: 1.5 });
    fx.disc(c, R, CGR.scorch, 4, { dark: true, a: .75, hold: .6, y: .03 });
  }
  // its mini grenades (the gem: "a ring of mini Grenades that explode when they come to a stop"): their number, radius
  // and detonation time from their part (the radius with the build's area modifiers as the grenade's own); thrown out in
  // a ring, each its angle off by up to its angle variance (70 degrees) and as far as the grenade's secondary radius plus
  // up to its distance variance, at its speed (ClusterGrenadeMini 600), slowing evenly to a stop where it explodes, or
  // at its detonation time if that comes first. note: the variance and the speed read in centimetres (3 m, 6 m/s), as the
  // tutorial video shows them landing 2-6.5 m out and bursting 1-2.25 s after the grenade; it bounces once on its way
  function clusterMinis(S, CL, c, e) {
    const st = CL.dmg.stats, k = S.A / (S.dmg.stats.active_skill_base_area_of_effect_radius / 10), A = CL.A * k, R2 = radOf(S) * k, n = st.base_number_of_projectiles;
    const fuse = st.base_skill_detonation_time / 1000 * (sh(S).detonate || 2) / (S.dmg.stats.base_skill_detonation_time / 1000), X = { ...CL, A, self: e };
    const a0 = rnd(TAU), v = 6;
    for (let i = 0; i < n; i++) {
      const a = a0 + i * TAU / n + rnd(-.5, .5) * st.projectile_angle_variance * Math.PI / 180, r = R2 + rnd(st.projectile_distance_variance / 100);
      const at = f => V(c.x + Math.cos(a) * r * f, .08, c.z + Math.sin(a) * r * f), T = Math.min(fuse, 2 * r / v), q = at(1);   // evenly slowing: 3/4 of the way in the first half
      const done = () => { clusterMini(q, A); area(q, A, X); };
      lob(clusterShell(.06), V(c.x, .5, c.z), at(.75), T / 2, .9, () => lob(clusterShell(.06), at(.75), q, T / 2, .25, done, { spin: true }), { spin: true });
    }
  }
  // Charged Staff: consumes all power charges for stacks, up to your maximum power charges; using it again while it lasts
  // adds to its stacks and duration (its duration per charge with the build's skill effect duration)
  const cstaff = S => S.P.attack && S.kind !== 'cstaff' && !S.src && time < me.cstaff?.until && me.cstaff;   // not its own use
  // its look (monk_energyblades): while it lasts an energy blade at each end of the staff (charged_staff_buff.epk:
  // charged_buff.pet blade_main_R, Vibrance 0.5 / 0.55 / 1) dropping little bolts for 0.2-0.4 s (blade_dropbolt 0.0247 /
  // 0.0287 / 0.1237); each shockwave (energy_slash.ao) an upright wave sweeping out over the cone (slash_wave.pet
  // wave_main_rec, 0.5 / 0.55 / 1 and wave_trail 0.4 / 0.46 / 1), 32 bolts dropping for 0.2-0.4 s and 64 embers for 1-2.5 s
  // off its curve. note: the wave's mesh as the scene's crescents swept out in 0.3 s (its particle lives 1.1 s); its
  // ground decal sits below the ground (Offset Y -200) and is not drawn
  const CSTAFF = { blade: 0x808cff, trail: 0x6675ff, bolt: 0x333bff }, csA = V(), csB = V();
  function cstaffWave(p, dx, dz, R, half) {
    const a0 = Math.atan2(dz, dx);
    fx.sector(p, dx, dz, R, half, CSTAFF.trail, .5, { grow: true, a: .35 });
    for (let k = 1; k <= 4; k++) later(k * .075, () => {
      const r = R * k / 4; fx.arc(p, dx, dz, r, half, CSTAFF.blade);
      for (let i = -2; i <= 2; i++) { const q = a0 + half * i / 2, c = { x: p.x + Math.cos(q) * r, y: 1, z: p.z + Math.sin(q) * r };
        fx.emit(2, { p: c, r: .2, v: .8, life: rnd(.2, .4), size: .06, c: CSTAFF.bolt, c2: CSTAFF.blade, k: 3, g: 4 });
        fx.emit(3, { p: c, r: .3, v: .4, up: .6, life: rnd(1, 2.5), size: .04, c: CSTAFF.blade, k: 2.4, g: 1, drag: 1.2 }); }
    });
  }
  function cstaffBlades(dt) {
    if (!(time < me.cstaff?.until) || player.family() !== 'qstaff') return;
    player.ends(csA, csB);
    for (const q of [csA, csB]) { fx.glow(q, .35, CSTAFF.blade, .06, 2.4); if (Math.random() < dt * 12) fx.emit(1, { p: q, r: .05, v: .5, life: rnd(.2, .4), size: .05, c: CSTAFF.bolt, c2: CSTAFF.blade, k: 3, g: 3 }); }
  }
  K.cstaff = S => {
    const on = time < me.cstaff?.until, n = S.spent;
    me.cstaff = { S, n: Math.min(maxC('power'), (on ? me.cstaff.n : 0) + n), until: (on ? me.cstaff.until : time) + n * S.dmg.stats.charged_staff_buff_duration_per_stack_ms / 1000 * (sh(S).durMore || 1) };
    setBuff({ label: S.label, name: S.name, c: css('lightning'), s: me.cstaff.until - time }); say(`${S.label}: ${me.cstaff.n}`, 'lightning');
  };
  // Galvanic Field: a buff that raises your shock chance; shocking an enemy consumes it to attach its orb to that enemy,
  // which fires a chaining bolt at an enemy within its secondary radius every beam delay until it expires
  // note: the buff's own duration is not in its data, it lasts until a shock consumes it
  K.galvanic = S => { me.galv = S; say(t('{0} active', S.label), 'lightning'); };
  function galvanic(d) {
    const S = me.galv, st = S.dmg.stats, m = fx.orb('lightning', .2); me.galv = null;
    limit(o => o.galvOf, st.galvanic_field_maximum_number_of_spheres, S);
    let tk = 0;
    thing(m, durOf(S), { galvOf: 1, name: S.name, tick(dt, e) {
      if (d.dead) { e.dead = true; return; }
      m.position.set(d.pos.x, 2.4, d.pos.z); if ((tk -= dt) > 0) return;
      const q = near(d.pos, radOf(S)); if (!q) return;
      tk = st.base_galvanic_field_beam_delay_ms / 1000; chain(m.position.clone(), q, { ...S, self: e, src: 'orb' }, chainsOf(S));
    } });
  }
  // what the Banners you stand in grant: their buff's stat, summed
  const banner = k => { const by = {}; for (const o of objs) if (o.banner && !o.dead && (dist(o.c, pp) <= o.R ? (o.inAt = time, true) : time - (o.inAt ?? -99) <= (o.linger || sheet().bannerLinger || 0)) && o.banner[k]) by[o.name] = o.name in by ? Math.max(by[o.name], o.banner[k]) : o.banner[k]; return Object.values(by).reduce((n, x) => n + x, 0); };   // the same Banner twice (Tactician's any number) does not add up
  function untoggle(k) { const T = tog[k]; if (!T) return; T.decal?.remove(); T.objs.forEach(o => { o.dead = true; }); delete tog[k]; }

  // ---------- using a skill
  // what a use costs: mana (a channel's for one tick, or `held` s), and life
  function costOf(S, held) {
    const AM = archmage(S), per = S.dmg?.costPerSecond ? held ?? SIM.channelTick : 1, LP = S.dmg?.lifePerRecent;
    // mana cost efficiency during a mana flask (Uhtred's Rite; attacks': Lavianga's Brew) and on Low Mana (Mental Toughness);
    // of skills from Corrupted gems during any flask (Zerphi's Genesis)
    const CS = S.dmg?.sum || {}, UE = (me.drink[1] ? (CS['base_mana_cost_efficiency_+%_during_mana_flask'] || 0) + (S.P?.attack ? CS['attack_mana_cost_efficiency_+%_during_mana_flask'] || 0 : 0) : 0) + (lowMana() ? CS['base_mana_cost_efficiency_+%_while_on_low_mana'] || 0 : 0) + (S.g?.corrupted && (me.drink[0] || me.drink[1]) ? CS['corrupted_skills_have_+%_increased_skill_cost_efficiency_during_flask_effect'] || 0 : 0), ue = S.dmg?.manaEff || 1;
    const mana = (S.dmg?.cost || 0) * per * (S.costX || 1) * (1 + (sheet().uDef?.indigonCost || 0) * spent200() / 100) * (UE ? ue / (ue + UE / 100) : 1) * (1 + banner('toxic_domain_mana_cost_+%') / 100) + (AM ? me.maxM * AM.archmage_max_mana_permyriad_to_add_to_non_channelled_spell_mana_cost / 1e4 : 0);
    const toLife = me.drink[0] ? mana * Math.min(100, sheet().flaskLifeCost || 0) / 100 : 0;   // the tree's share of mana costs paid with life during a life flask
    return { cost: mana - toLife, life: (S.dmg?.lifeCost || 0) * per + toLife + (LP ? me.maxL * Math.min(LP.max, LP.pct * used.filter(u => u.name === S.name && time - u.t <= RECENT).length) / 100 : 0) };
  }
  // The Flesh Poppet: shapeshifting to an animal form, a random modifier of each enemy in your Presence for its time (its
  // text: the stat / 100 seconds), as Headhunter's; those of the shapeshift before are lost
  function poppet() {
    const T = sheet().poppet; if (!T) return;
    me.hh = (me.hh || []).filter(h => !h.poppet);
    for (const d of inside(pp, sheet().overgrow.r)) { const ids = (d.modKey || '').split(',').filter(Boolean); if (ids.length) me.hh.push({ stats: modStats([ids[Math.floor(rnd(ids.length))]]), until: time + T, poppet: true }); }
    shC.at = -99;
  }
  // the game's weapon swap: Combo is lost (KeywordPopups Combo), not with Martial Master
  function swap() { const n = api.swapSet(); if (!sheet().comboKeep) me.combo = 0; fx.ring(pp, 1.2, .3, 'gold', .3); say(t('Weapon set {0}', n), 'gold'); }
  function use(i, o = {}) {
    const b = api.build(); if (!o.src && api.swapSet && !onSet(b, b.gems[i])) swap();   // a skill of the other weapon set (Used with weapon set) swaps to it, as the game's
    let S = mk(i); if (!S) return false;
    const P = S.P, auto = !!o.src;
    if (!auto && stuck()) return false;   // frozen or heavily stunned, you cannot act
    if (!auto && S.kind === 'warcry' && sheet().uDef?.noWarcry) { toast(statLines({ cannot_use_warcries: 1 })[0] || S.label); return false; }   // The Empty Roar: Cannot use Warcries
    if (!auto && me.mounted && S.name !== 'Rhoa Mount' && !mountable(S)) { toast(t('{0} cannot be used while mounted', S.label)); return false; }
    // Forge Hammer: used again while its hammer is lodged, it recalls it (its Recall part, its more attack speed) and its
    // cooldown starts over
    const lodged = !auto && S.dmg?.stats?.forge_hammer_maximum_hammers && objs.find(o => o.earth && o.name === S.name && !o.dead);
    if (lodged) { recall(S, lodged); cdReady[S.name] = []; return true; }
    // a skill with a cooldown is used while one of its uses is left (Second Wind doubles them); each recharges over it
    // Righteous Descent consumes a Fragment of Divinity near you or the target to be Empowered (ActiveSkills): its Boosted part,
    // its life and mana recovered over 2 s, no cooldown used. note: how near is not in the data, here within its area
    const FD = !auto && S.name === 'Righteous Descent' && divine.find(f => dist(f.p, pp) <= S.A || dist(f.p, o.at || cursor) <= S.A), FB = FD && partOf(S, 'RighteousDescentPlayerBoosted');
    if (FB) { divine = divine.filter(f => f !== FD || f.dec.remove()); fx.ring(FD.p, .2, 1.2, 'lightning', .35); S = { ...FB, label: S.label, g: S.g }; const st = FB.dmg.stats || {};
      for (const [k, M, r] of [['life', me.maxL, 'recover_%_of_life_over_2_seconds_when_consuming_a_divine_fragment'], ['mana', me.maxM, 'recover_%_of_mana_over_2_seconds_when_consuming_a_divine_fragment']]) { const n = M * (st[r] || 0) / 100; if (n) me.recoup.push({ k, left: n, rate: n / 2 }); } }
    // Demon Form (ManualCooldownConsumption): used again in it, it reverts you; its cooldown starts as you revert (demonOff), not as you shift. note: without cooldown recovery there
    if (!auto && S.name === 'Demon Form' && me.demon) { demonOff(); return true; }
    const C = !auto && !FB && !(S.kind === 'warcry' && sheet().bellow.free) && !(S.kind === 'grenade' && time < me.fervour) /* Explosive Fervour: no cooldown */ && S.dmg?.cooldown, ready = C && (cdReady[S.name] = (cdReady[S.name] || []).filter(at => at > time));
    // one whose game text says a charge can bypass its cooldown (Ice-Tipped Arrows a Frenzy Charge, Fortifying Cry an
    // Endurance Charge: the charge its types say it consumes) spends one instead of waiting
    // (its only use of charges: none spent otherwise)
    const gi = C && api.info(S.g).gem, byCharge = /cooldown can be bypassed/.test(gi?.description || ''), wait = C && ready.length >= (S.dmg.uses || 1);
    // Enraged Warcry: a Warcry spends its Rage instead of the Endurance Charge
    const ER = wait && byCharge && S.dmg?.sum?.warcry_bypass_cooldown_spending_X_rage_instead_of_endurance_charge, RG = ER && me.rage >= ER;
    const BY = !ER && wait && byCharge && Object.keys(charges).find(c => gi.types?.includes(`SkillConsumes${c[0].toUpperCase() + c.slice(1)}ChargesOnUse`) && charges[c]);
    if (wait && !BY && !RG) return false;
    if (BY) { charges[BY]--; chargesSpent(1, BY); say(t('{0} spends {1} charges', S.label, 1), 'gold'); }
    if (RG) { spendRage(ER); say(`${S.label}: −${ER} ${t('Rage')}`, 'blood'); }
    Object.assign(S, o); if (o.more) S.mult *= o.more;
    if (S.dmg?.clip && time < me.ereload?.until) S.mult *= me.ereload.more;   // Emergency Reload's empowered bolts
    if (time < me.wildUntil) S.mult *= me.wildMore;   // Savage Fury's frenzy
    aim(S, o.at || cursor);
    if (!auto && astral(S)) S.from = { ...S.at };   // Astral Projection: the Nova where you aim, not around you
    // Fluke, Ixchel's Torment: a skill its meta gem triggers has its damage (and area: Ixchel's) somewhere between its less and more
    // note: Ixchel's projectile speed is not simulated; a triggered skill has no cost here to recover a share of
    if (S.rand) { const pick = k => { const hi = S.rand[`support_randomise_higher_${k}_+%_final`]; return hi == null ? 1 : 1 + rnd(S.rand[`support_randomise_lower_${k}_+%_final`], hi) / 100; }; S.mult *= pick('damage'); S.A *= Math.sqrt(pick('aoe')); }
    // Heat (keywords.json): Rapid Shot's bolts build it on your crossbow up to its most; a skill that consumes its amount on
    // use gains its fire (Explosive, Cluster Grenade) or its more ignite effect (Incendiary Shot). note: the Heat a bolt
    // builds and the time maximum Heat stops you are not in the data: one a use, no stop
    const HS = S.dmg?.stats || {}, HC = HS.consume_X_heat_on_skill_use;
    if (!S.src && HS.maximum_number_of_crossbow_heat_stacks) { me.heat = Math.min(HS.maximum_number_of_crossbow_heat_stacks, me.heat + 1); me.heatAt = time; }
    S.heated = !S.src && HC > 0 && me.heat >= HC; if (S.heated) me.heat -= HC;
    S.surges = !S.src && S.P.attack && !S.P.melee && S.P.ranged && surges.length ? surgeTake() : null;
    // Uhtred's Constellation: more damage per different skill with a cooldown used in the last 8 seconds
    const UC = S.dmg?.sum?.['support_uhtred_damage_+%_final_per_different_cooldown_skill_in_last_8_seconds'];
    if (UC) S.mult *= 1 + UC * new Set(used.filter(u => u.cd && time - u.t <= 8).map(u => u.name)).size / 100;
    const VB = S.dmg?.sum?.['support_djinn_lineage_damage_+%_final_per_different_command_in_last_8_seconds']; if (VB) S.mult *= 1 + VB * new Set(used.filter(u => u.cmd && time - u.t <= 15).map(u => u.name)).size / 100;   // Varashta's Blessing: per different Command skill used in the last 15 s (its text)
    S.mantra = null; S.leapt = S.conduit = S.fulm = false;   // a Mantra of Destruction Empowerment, a Shocking Leap ground: for this use only
    if (!auto) {
      if (me.demon && !S.P.spell && S.kind !== 'demon') demonOff();
      // Cadence: each use a stack of its more attack speed (useTime); a use at its most stacks makes the skill unusable
      // for its time, and they are lost. note: how long a stack lasts is not in its data, they last until then
      const CD = S.dmg?.sum?.support_measured_speed_maximum_stacks, cad = CD && ((me.cad ||= {})[S.name] ||= { n: 0, off: 0 });
      if (cad && time < cad.off) return false;
      if (cad && ++cad.n > CD) { cad.n = 0; cad.off = time + S.dmg.sum.support_measured_speed_disabled_ms / 1000; say(t('{0} off', S.label), 'dust'); return false; }
      // Dauntless: not until you have stood still for its time
      const DS = S.dmg?.sum?.skill_cannot_be_used_unless_stationary_for_X_ms;
      if (DS && time - (me.movedAt ?? -99) < DS / 1000) { toast(`${S.label}: ${t('Supported Skills cannot be used unless you have been stationary for {0} seconds', DS / 1000)}`); return false; }
      // Requiem: your weapon passively accumulates Anguish (its amount per minute) up to its requirement; used when full,
      // the skill fires freely for its active time
      const RS = S.dmg?.stats, RQ = RS?.rapidshot_requiem_base_buff_count_requirement;
      if (RQ && time >= me.requiem) {
        const ang = Math.floor(Math.min(RQ, (time - me.angAt) * RS.rapidshot_requiem_number_of_stacks_per_minute / 60));
        if (ang < RQ) { toast(`${S.label}: ${t('Anguish')} ${ang}/${RQ}`); return false; }
        const d = RS.rapidshot_requiem_active_duration_ms / 1000; me.angAt = me.requiem = time + d; setBuff({ label: S.label, name: S.name, c: css('cold'), s: d });
      }
      if (S.kind === 'pinnacle' && charges.power < maxC('power')) { toast(t('{0} needs {1} charges and has {2}', S.label, maxC('power'), charges.power)); return false; }   // Pinnacle of Power: only at your most power charges
      if (P.needsCharges && P.spend.length && !P.spend.some(c => charges[c] > 0)) { toast(t('{0} needs {1} charges (press G)', S.label, t(CHARGE[P.spend[0]]))); return false; }
      const ch = S.dmg?.ail?.charge || {};
      // Inhibitor: the skill consumes no charges nor Infusions, and deals its more damage per kind of either you have
      const inhib = S.dmg?.sum?.['support_inhibitor_damage_+%_final_per_charge_type_or_infusion_type'];
      if (inhib) S.mult *= 1 + inhib * (Object.values(charges).filter(Boolean).length + Object.keys(me.inf).filter(e => infNow(e).length).length) / 100;
      // the Infusions it can consume: one of each kind it names (Firestorm all three)
      // (a channelled skill once as its channelling starts, keeping them while it goes on: Incinerate)
      const going = P.channel && time - (chanAt[S.name] ?? -9) <= SIM.channelTick * 2; if (P.channel) chanAt[S.name] = time;
      S.infs = going ? chanInf[S.name] || [] : !inhib && P.infuses.length ? P.infuses.filter(e => infTake(S, e)) : [];
      if (P.channel && !going) { chanInf[S.name] = S.infs; S.fresh = true; chan0[S.name] = { t: time }; }
      if (going && sheet().chanUncurse && !chan0[S.name].unc && time - chan0[S.name].t >= 2) { chan0[S.name].unc = true; for (let k = sheet().chanUncurse; k > 0; k--) uncurse(); }   // Draiocht Cleansing: after channelling for 2 seconds
      const st = S.dmg?.stats || {}, arc = st['arc_damage_+%_final_from_infusion_consumption'], fs = st['firestorm_damage_+%_if_consumed_fire_infusion'];
      S.addChains = 0;
      if (arc && S.infs.includes('lightning')) { S.mult *= 1 + arc / 100; S.addChains = st.arc_chains_gained_from_infusion_consumption || 0; }
      if (fs && S.infs.includes('fire')) S.mult *= 1 + fs / 100 * (S.dmg.incW?.fire ?? 1);   // "increased", against the skill's own
      // Flame Breath: it consumes its Power Charge as its channelling starts, Empowered for all of it: its share of damage
      // gained as lightning, its less Rage a second
      const FE = st['wyvern_devour_empowered_flame_breath_base_all_damage_%_to_gain_as_lightning'];
      if (!inhib && !byCharge && !(FE && going)) for (const c of P.spend) if (charges[c]) { const n = P.spendOne ? 1 : charges[c], as = n + (c === 'power' && S.dmg?.staffPower || 0); S.gm *= 1 + ((ch[c]?.per || 0) * as + (ch[c]?.when || 0)) / 100; S.spent += as; chargesSpent(n, c); charges[c] -= n; }   // as: One with the Storm, a Quarterstaff skill's power charges count as one more
      if (S.spent) { say(t('{0} spends {1} charges', S.label, S.spent), 'gold'); }
      if (S.spent && st.spiral_volley_X_chains_per_frenzy_charge_consumed) S.addChains += S.spent * st.spiral_volley_X_chains_per_frenzy_charge_consumed;   // Spiral Volley: its chains per frenzy charge consumed (its more damage: ch's)
      if (FE) { if (!going) chan0[S.name].emp = S.spent > 0; if (chan0[S.name]?.emp) S.breath = FE; }
      // Profanity: consumes up to its number of corpses within its distance of you, its more chaos damage if it did (I) or per corpse (II)
      const PF = !auto && S.dmg?.sum, PN = PF?.skill_consume_up_to_X_corpses_on_use, eaten = PN ? corpses(pp, PF.skill_consume_corpse_within_X_units_on_use / 10).slice(0, PN) : [];
      for (const d of eaten) eat(d, 'chaos');
      S.chaosX = eaten.length && 1 + ((PF['support_chaos_damage_+%_final_if_corpse_consumed_on_use'] || 0) + eaten.length * (PF['support_chaos_damage_+%_final_per_corpse_consumed_on_use'] || 0)) / 100;
      // Detonating Arrow: its share of damage as extra fire per stage; at maximum stages the arrow explodes at the end of its
      // flight (its explosion part: the arrow's damage as area damage in its secondary radius)
      const DA = st.detonating_arrow_max_number_of_stages, DN = DA && S.stage != null ? Math.round(S.stage * DA) : 0;
      S.fireGain = DN * (st['detonating_arrow_all_damage_%_to_gain_as_fire_per_stage'] || 0); S.detonate = DA && DN >= DA ? S.G?.radius2 || 0 : 0;
      if (S.stage != null && !P.ownStages) { S.mult *= st.flameblast_maximum_stages ? 1 + blast(S) * st['charged_blast_spell_damage_+%_final_per_stack'] / 100 : DA ? 1 : 1 + 2 * S.stage; if (S.perfect) { if (!S.dmg?.parts?.SnipeExplosionPlayer) { S.mult *= 1.5; S.aoe = true; } fx.text({ x: pp.x, y: 2.6, z: pp.z }, t('Perfect timing!'), css('gold')); } }
      if (P.channel && !P.stages) S.mult *= SIM.channelHit;
      if (time < me.perf?.until) S.mult *= 1 + PERFECTION.more * me.perf.n / 100;   // Perfection: all your skills
      if (P.spell && time < me.pmag?.until) S.mult *= 1 + me.pmag.inc / 100;   // Practical Magic's increased spell damage. note: as more here
      if (time < me.fang?.until && me.fang.pct) S.gains = [...(S.gains || []), { el: 'cold', pct: me.fang.pct }];   // Bhatair's Vengeance. note: yours only, not your allies'
      { const I = P.spell && !S.src && sheet().uDef?.indigon, ts = I ? Object.keys(S.dmg?.hits || {}) : []; if (ts.length) S.mult *= 1 + I * spent200() / 100 * ts.reduce((t, k) => t + (S.dmg.incW?.[k] ?? 1), 0) / ts.length; }   // Indigon
      { const SU = S.dmg?.sum || {};
        // Minion Pact: drains its % of your life from a minion that has it all, for its more damage
        const MP = !S.src && SU['support_minion_pact_user_life_%_removed_from_nearby_minion'], need = me.maxL * MP / 100, PM = MP && objs.find(o => o.minion && !o.dead && o.segs?.[0]?.life >= need);
        if (PM) { PM.segs[0].life -= need; S.mult *= 1 + (S.dmg.finals?.['support_minion_pact_damage_+%_final'] || 0) / 100; }
        // Atziri's Impatience: its % of your maximum life, mana and energy shield lost on use
        const AI = !S.src && SU['lose_%_of_life_es_and_mana_when_skill_is_used']; if (AI) { me.life = Math.max(1, me.life - me.maxL * AI / 100); me.mana = Math.max(0, me.mana - me.maxM * AI / 100); me.es = Math.max(0, me.es - me.maxE * AI / 100); }
        // Atalui's Bloodletting: its % of damage as extra physical per 20 of its life cost, up to 40%
        const AB = SU['gain_%_of_damage_as_physical_per_20_life_cost_up_to_40_%']; if (AB) S.gains = [...(S.gains || []), { el: 'physical', pct: Math.min(40, AB * Math.floor(costOf(S).life / 20)) }];
        // Window of Opportunity II: on Perfect Timing, deflection rating of its % of your evasion for 8 s
        const WO = S.perfect && SU['gain_%_of_evasion_as_deflection_rating_on_perfect_timing_for_8_seconds']; if (WO) me.woo = { pct: WO, until: time + 8 };
        // Retaliate, Spar: more damage / stun buildup the fuller your Heavy Stun bar
        const RP = !S.src && (me.bar.stun || 0) / 100;
        if (RP) { S.mult *= 1 + (SU['support_max_attack_damage_+%_final_from_current_poise'] || 0) * RP / 100; S.stunX = (S.stunX || 1) * (1 + (SU['support_hit_damage_stun_multiplier_+%_final_from_current_poise'] || 0) * RP / 100); }
        // Uhtred's Rite: Overflowing Chalice for its time per second of cooldown; more damage during your life flask
        const UC = !S.src && S.dmg?.cooldown && SU.support_uhtreds_chalice_buff_on_skill_use_duration_ms_per_1000_ms_cooldown; if (UC) me.chalice = Math.max(me.chalice || 0, time + UC / 1000 * S.dmg.cooldown / 1000);
        if (me.drink[0] && SU['support_uhtreds_chalice_damage_+%_final_during_life_flask']) S.mult *= 1 + SU['support_uhtreds_chalice_damage_+%_final_during_life_flask'] / 100; }
      if (S.dmg?.sum?.gain_X_tasalios_perfection_on_perfect_timing) S.mult *= 1 + TASALIO.more * (me.tasalio || 0) / 100;
      if (P.spell && S.dmg?.sum?.gain_X_wildshard_stacks_on_cast) me.wildshard = (me.wildshard || 0) + S.dmg.sum.gain_X_wildshard_stacks_on_cast;   // Sione's Temper
      facing = Math.atan2(S.dx, S.dz); castAt = time; me.act = actMove(S); goal = null; walk = false;
      if (!auto) { const T = S.dmg?.speed > 0 ? 1 / S.dmg.speed : SIM.castTime; me.actEnd = time + T; player.act(CLIP_OF[S.name] || clipOf(P, S.kind, player.family()), T); player.setColor(S.el); }   // what you use yourself is what the figure plays
      if (P.absorbs) S = absorb(S, pp, 1);
      // what was waiting for this skill: an element from a buff, the aftershock of a warcry, the repeats of Barrage / Unleash
      // Triskelion Cascade, Barrage: their share of the empowered skill's use time added to their last use's cooldown (up to its most)
      const lengthen = (E, S) => { const R = cdReady[E.name]; if (E.cd && R?.length && S.dmg?.speed > 0) R[R.length - 1] += Math.min(E.max || Infinity, E.cd / 100 / S.dmg.speed); };
      const hits = !NOHIT.has(S.kind), tally = () => empower.reduce((t, e) => t + 1 + (e.uses || 0), 0), had = tally();
      { const LD = sheet().lethal, F = flasks()[0], need = F && F.max * (LD?.pct || 0) / 100; if (LD?.pct && P.attack && hits && S.dmg && flaskLeft(0) >= need && api.info(S.g)?.gem?.types?.includes('Bow')) { me.fl[0] = flaskLeft(0) - need; const h = S.dmg.hits.physical || [0, 0], n = F.amount * LD.add / 100; S.dmg = { ...S.dmg, hits: { ...S.dmg.hits, physical: [h[0] + n, h[1] + n] } }; } }   // The Lethal Draw: bow attacks spend life flask charges for added physical damage
      { const OV = sheet().olro, n = OV && P.attack && hits && S.dmg ? Math.min(OV, (me.olro || []).reduce((t, u) => t + (u.until > time ? u.v : 0), 0)) : 0; if (n) { const h = S.dmg.hits.lightning || [0, 0]; S.dmg = { ...S.dmg, hits: { ...S.dmg.hits, lightning: [h[0], h[1] + n] } }; } }   // Olrovasara: maximum added lightning damage from the Power of the enemies hit in the past 20 s
      const noCry = flagOf(S.name, 'cannot_be_empowered_by_warcries');   // Resonating Shield
      for (let k = empower.length - 1; k >= 0; k--) {
        const E = empower[k];
        if (noCry && ['break', 'cold', 'fire', 'echo', 'wave'].includes(E.type)) continue;   // those a warcry leaves (K.warcry)
        if (E.type === 'infuse' && P.attack && hits) {
          S.els = [...new Set([...S.els, E.el])]; S.el = E.el; S.ail = [...new Set([...S.ail, ...ailOf([E.el])])]; empower.splice(k, 1);
          say(t('{0} gains {1} from {2}', S.label, t(cap(E.el)), E.label), E.el);
        } else if (E.type === 'cold' && P.attack && hits && S.dmg) {
          const h = S.dmg.hits.cold || [0, 0]; S.dmg = { ...S.dmg, hits: { ...S.dmg.hits, cold: [h[0] + E.add[0], h[1] + E.add[1]] } }; S.els = [...new Set([...S.els, 'cold'])]; if (P.slams) S.chillFor = E.chill;
          howlTrail(S);
          if (spendEmp(E)) empower.splice(k, 1);
        } else if (E.type === 'fire' && P.attack && P.melee && hits && S.dmg) { Object.assign(S, gainAs(S, 'fire', E.pct)); if (spendEmp(E)) empower.splice(k, 1); }
        else if (E.type === 'break' && P.attack && hits) { S.breakAdd = E.n; if (spendEmp(E)) empower.splice(k, 1); }
        else if (E.type === 'echo' && P.attack && P.melee && hits) { S.echo = E.label; S.echoN = 1 + (P.slams ? E.slam : 0); S.echoX = P.slams ? E.slamX : 1; if (spendEmp(E)) empower.splice(k, 1); }
        else if (E.type === 'repeat' && P[E.flag]) { S.rep = E.n + (S.P.attack && sheet().lioneye && !inside(pp, sheet().overgrow.r).length ? sheet().lioneye : 0); S.repBy = E.label; S.repX = 1 - E.less / 100; S.barrage = E.name === 'Barrage'; empower.splice(k, 1); lengthen(E, S); }
        else if (E.type === 'trisk' && P.spell && api.info(S.g).gem?.types?.includes('Cascadable')) { S.trisk = E; S.at = { x: pp.x, z: pp.z }; S.mult *= E.mult; S.A *= E.area; empower.splice(k, 1);
          lengthen(E, S); say(`${E.label}: ${S.label}`, 'fire'); }
        else if (E.type === 'fate' && !auto && S.name === E.spell) { S.mult *= E.mult; empower.splice(k, 1); say(`${E.label}: ${S.label}`, FATE); fx.glow({ x: pp.x, y: 1.2, z: pp.z }, 2.4, FATE, .6, 2.4); fx.ring(pp, .3, 1.5, FATE, .5); fx.emit(20, { p: { x: pp.x, y: .3, z: pp.z }, r: .4, h: 1.4, up: 1.4, life: .7, size: .14, c: FATE, c2: 'white', k: 1.8, drag: 1.5 }); }
        else if (E.type === 'mantra' && P.attack && P.melee && hits) { S.mantra = E; if (spendEmp(E)) empower.splice(k, 1); }
        else if (E.type === 'temper' && P.attack && P.melee && hits) { S.combust = { T: E.T }; if (spendEmp(E)) empower.splice(k, 1); }
        else if (E.type === 'wave' && P.attack && P.melee && hits) { const c = { ...S.at }; later(.15, () => boom(c, E.X.A, E.X)); if (spendEmp(E)) empower.splice(k, 1); }
        // Ice-Tipped Arrows: its share of the attack's physical damage as cold (note: all of the hit's physical, its
        // modifiers kept: the weapon's base alone is not told apart here), its fragments on each hit (iceFrags)
        else if (E.type === 'icetip' && P.attack && P.ranged && hits && S.dmg) {
          const H = { ...S.dmg.hits }, ph = H.physical, cv = (E.cv ?? 100) / 100;
          if (ph) { const c = H.cold || [0, 0]; H.cold = [c[0] + ph[0] * cv, c[1] + ph[1] * cv]; H.physical = [ph[0] * (1 - cv), ph[1] * (1 - cv)]; if (cv >= 1) delete H.physical; }
          const { els, el, ail } = withEl(S, 'cold'); Object.assign(S, { els, el, ail, dmg: { ...S.dmg, hits: H } });
          S.icetip = fragsOf(S, E.X);
          say(t('{0} gains {1} from {2}', S.label, t('Cold'), E.label), 'cold'); if (spendEmp(E)) empower.splice(k, 1);
        }
        else if (E.type === 'bounty' && S.kind === 'projectile') { S.addProj = E.add; S.G = { ...S.G, speed: (S.G?.speed || SIM.projSpeed) * (1 + E.speed / 100) }; empower.splice(k, 1); say(`${E.label}: ${S.label}`, 'gold'); }
        else if (E.type === 'spark' && P.attack) { K.projectile({ ...E.X, from: S.from, dx: S.dx, dz: S.dz, P: { ...E.X.P, wander: true } }); if (spendEmp(E)) empower.splice(k, 1); }
      }
      // Empowered (it took something waiting for it): Premeditation's more damage, Unerring Power's less cost and more Accuracy
      // Mountain's Teachings: an attack you use benefits from it and loses one
      // Lich: a spell Sacrifices its share of your maximum energy shield (if you have it all) for its more damage, and
      // consumes a Power Charge if it can for its more damage
      const LI = P.spell && !S.src && !auto && sheet().lich;
      if (!S.src && !auto && sheet().tailwind?.use) me.tail = Math.min(TAILWIND.max, (me.tail || 0) + 1);   // Gathering Winds
      const EA = !S.src && sheet().earch; if (EA && P.attack && !api.info(S.g)?.gem?.types?.includes('Instant')) me.earch = Math.min(me.earch || 0, time);   // a non-instant attack removes Elemental Archon
      if (EA?.cast && P.spell && !(time < me.earch) && time >= (me.earch ?? -99) + EA.delay && me.flame >= me.maxM * HIGH_FLAME) earchGo(EA);
      if (LI?.sac) { const n = me.maxE * LI.sac / 100; if (n > 0 && me.es >= n) { me.es -= n; S.mult *= 1 + LI.sacMore / 100; if (!LI.keep) me.esStop = time; } }   // the Sacrifice interrupts its recharge, unless Eldritch Empowerment
      if (LI?.power && charges.power > 0) { charges.power--; chargesSpent(1, 'power'); S.mult *= 1 + LI.power / 100; }
      if (P.attack && !S.src && !auto && time < me.mountUntil && me.mount > 0) { S.mult *= 1 + sheet().mountain.attack / 100; if (--me.mount <= 0) me.mountUntil = 0; }
      const EF = P.attack && S.dmg?.sum?.['empowered_attack_physical_damage_%_to_gain_as_fire'], ph = S.dmg?.hits?.physical;   // the tree's: Empowered attacks' physical damage gained as extra fire
      if (tally() < had || P.attack && !S.src && S.kind !== 'totem' && sheet().uDef?.allEmp) { S.empd = true; const F = S.dmg?.finals || {};
        const VP = S.dmg?.sum?.gain_X_volatility_on_empowered_skill_use; if (VP) gainVol(VP);   // Volatile Power
        if (EF && ph) { S.dmg = { ...S.dmg, hits: { ...S.dmg.hits, fire: ph.map((x, i) => (S.dmg.hits.fire?.[i] || 0) + x * EF / 100) } }; const { els, ail } = withEl(S, 'fire'); Object.assign(S, { els, ail }); }
        S.mult *= 1 + (F['support_empowered_damage_+%_final'] || 0) / 100;
        // the tree's: an Empowered attack's stun / freeze buildup, and its damage gained as extra cold (Hail)
        const SM = P.attack ? S.dmg?.sum || {} : {}; S.stunEmp = 1 + (SM['empowered_attack_hit_damage_stun_multiplier_+%'] || 0) / 100; S.freezeEmp = 1 + (SM['hit_damage_freeze_multiplier_+%_with_empowered_attacks'] || 0) / 100;
        const HL = SM['non_skill_base_all_damage_%_to_gain_as_cold_with_empowered_attacks'], HH = HL && S.dmg.hits;
        if (HH) { const n = Math.max(...Object.values(HH).map(x => x.length)), add = Array.from({ length: n }, (_, i) => Object.values(HH).reduce((t, x) => t + (x[i] || 0), 0) * HL / 100);
          S.dmg = { ...S.dmg, hits: { ...HH, cold: add.map((x, i) => (HH.cold?.[i] || 0) + x) } }; const { els, ail } = withEl(S, 'cold'); Object.assign(S, { els, ail }); }
        const EA = P.attack && S.dmg?.sum?.['empowered_attack_damage_+%'], ts = EA ? Object.keys(S.dmg.hits) : [];   /* the tree's increased damage of Empowered Attacks */
        if (ts.length) S.mult *= 1 + EA / 100 * ts.reduce((t, k) => t + (S.dmg.incW?.[k] ?? 1), 0) / ts.length;
        S.costX = 1 + (F['support_discount_skill_cost_+%_final_if_empowered'] || 0) / 100; S.accX = 1 + (F['support_discount_accuracy_rating_+%_final_if_empowered'] || 0) / 100; }
      // Escape Shot: its arrow makes its Ice Fragments where it hits (its fragment part, iceFrags)
      const ES = !S.icetip && partOf(S, 'EscapeShotIceFragmentPlayer'); if (ES) S.icetip = fragsOf(S, ES);
      // Unleash (Zarokh's Revolt): a spell gains a Seal every its % of its cast time (sooner with increased Seal gain frequency), up to its most; casting it breaks them,
      // each repeating it its times with its less damage. Salvo: a Seal every its interval, each an additional projectile.
      // Tul's Avalanche: a Seal every its number of hits you block, each an Echo of the skill
      const SU = S.dmg?.sum, SL = !auto && SU?.base_maximum_seals_for_skill;
      if (SL) {
        const XB = SU.skill_gain_seal_every_x_hits_blocked, every = (SU.base_skill_seal_gain_interval_ms ? SU.base_skill_seal_gain_interval_ms / 1000 : SU['support_%_of_total_cast_time_as_base_skill_seal_gain_interval'] / 100 / (S.dmg.speed || 1 / SIM.castTime)) / (1 + (SU['seal_gain_frequency_+%'] || 0) / 100);
        const n = Math.min(SL, XB ? Math.floor(((me.blockN || 0) - (me.sealBlk?.[S.name] ?? 0)) / XB) : Math.floor((time - (me.sealAt[S.name] ?? -Infinity)) / every));
        me.sealAt[S.name] = time; (me.sealBlk ||= {})[S.name] = me.blockN || 0;
        if (n > 0 && SU.skill_rapid_fire_repeats_per_broken_seal) { S.rep = (S.rep || 0) + n * SU.skill_rapid_fire_repeats_per_broken_seal; S.repBy = t('Seal') + ` ×${n}`; S.repX = 1 + (S.dmg.finals?.['support_spell_rapid_fire_repeat_use_damage_+%_final'] || 0) / 100; }
        if (n > 0) { S.addProj = (S.addProj || 0) + n * (SU.skill_additional_projectiles_per_seal_broken || 0); S.sealEcho = n * (SU.skill_echoes_per_seal_broken || 0); S.A *= Math.sqrt(1 + n * (SU['skill_area_of_effect_+%_per_broken_seal'] || 0) / 100); }   /* Expand: its increased area per Seal broken */
      }
      // Fist of Kalguur: a Slam spends a share of its cost as Ward for a Runic Boost (Empowered): part of its damage
      // gained as physical, and its rune on the first enemy it hits
      const FK = P.slams && S.dmg?.trig?.find(T => T.stats?.['triggered_by_fist_of_kalguur_support_%']), wc = FK && (S.dmg.cost || 0) * FK.support['support_slam_spend_%_supported_skill_cost_as_ward_for_runic_boost'] / 100;
      if (FK && me.ward >= wc) {
        spendWard(wc); const g = FK.support['runic_boosted_attack_damage_%_gained_as_physical'] / 100, H = S.dmg.hits, sum = j => Object.values(H).reduce((a, h) => a + h[j], 0), ph = H.physical || [0, 0];
        S.dmg = { ...S.dmg, hits: { ...H, physical: [ph[0] + sum(0) * g, ph[1] + sum(1) * g] } }; S.rune = FK;
      }
    }
    // Glory: its requirement to use; spent on use, unless its chance not to (or to keep 40% of it)
    const GN = !auto && gloryNeed(S);
    if (GN) {
      if ((me.glory[S.name] || 0) < GN) { toast(t('{0} needs {1} Glory', S.label, Math.ceil(GN))); return false; }
      const st = gst(S);
      const g0 = me.glory[S.name] || 0; me.gloryUsed = time;
      if (!(Math.random() * 100 < (st['chance_to_not_consume_glory_%'] || 0))) me.glory[S.name] = Math.random() * 100 < (st['chance_to_retain_40%_of_glory_on_use_%'] || 0) ? GN * .4 : 0;
      me.gloryEaten = [...(me.gloryEaten || []).filter(x => time - x.t <= 6), { t: time, n: g0 - me.glory[S.name] }];   // the Glory consumed in the last 6 s, a use each
      const GL = sheet().gloryLife * (g0 - me.glory[S.name]); if (GL > 0) me.life = Math.min(me.maxL, me.life + me.maxL * GL / 100);   // the tree's life per Glory consumed
      hudT = 0;
    }
    const KA = !auto && P.melee && time < me.kaom?.until && me.kaom;
    if (!auto && P.projectile && meIs.HitMeleeRecently() && Math.random() * 100 < (sheet().forkMelee || 0)) S = { ...S, dmg: { ...S.dmg, shape: { ...sh(S), forks: (sh(S).forks || 0) + 1 } } };   // the tree's Fork after a melee hit. ponytail: rolled per use, not per projectile
    if (!auto && P.attack && me.wisps > 0) stampede(S);   // Vivid Stampede: an attack expends all Vivid Wisps
    if (!auto && P.attack && P.projectile && (walk || move) && Math.random() * 100 < sheet().moveProj) S = { ...S, dmg: { ...S.dmg, shape: { ...sh(S), projectiles: (sh(S).projectiles || 1) + 2 } } };   // the tree's two more projectiles while moving
    // Titan's Ancestral Empowerment: every second Slam you use yourself is Ancestrally Boosted
    // (and Mountain Splitter's every third, at the slam: S.slamN)
    if (!auto && P.melee && time < me.styrn?.until && !api.info(S.g || {})?.gem?.types?.includes('ActiveBlock')) S.mult *= 1 + me.styrn.more / 100;   // Styrn's Mountain: the melee skills that do not raise a shield, if you Blocked with its skill Recently
    const PX = !auto && P.attack && me.parryNext?.[P.melee ? 'melee' : 'ranged']; if (PX) { S.mult *= 1 + PX / 100; me.parryNext = null; }   // a parry's increased damage to this attack (note: as a factor of its own)
    const RU = !auto && S.dmg?.sum?.support_ruthless_big_hit_max_count;   // Ruthless: every that many uses of it, its more Stun buildup
    if (RU && ((me.ruth ||= {})[S.name] = (me.ruth[S.name] || 0) + 1) % RU === 0) S.stunEmp = (S.stunEmp || 1) * (1 + (S.dmg.finals?.['support_ruthless_big_hit_stun_damage_+%_final'] || 0) / 100);
    // Surge of the Tide: while Shapeshifted every second Slam, and every second Strike, you use is Ancestrally Boosted
    // note: its Slams are counted with all of yours
    const ST = !auto && (me.form || me.demon) && S.dmg?.sum?.ancestral_slam_strike_every_other_strike_or_slam_while_shapeshifted;
    S.slamN = !auto && P.slams ? me.slams = (me.slams || 0) + 1 : 0; const AE = S.slamN && S.slamN % 2 === 0 && (S.dmg?.sum?.ancestral_slam_every_other_slam || ST);
    // Ancestrally Boosted: its more damage and increased area, with the tree's increased ones (note: its damage as a factor)
    const AB = sheet().ancBoost || {};
    const AN = !auto && P.attack && time < me.ancNext; if (AN) me.ancNext = 0;
    // Fist of War: a Slam is Ancestrally Boosted every its interval; Ancestral Call: a Strike; Ancestral Aid: its Strike,
    // always (it needs its Blocked hits to be used)
    // note: Fist of War III's "very powerful" Boost has no number in the data: the keyword's
    const BS = S.dmg?.sum || {}, BI = !auto && (P.slams ? BS.ancestral_slam_interval_duration : S.kind === 'strike' && BS.ancestral_call_spirit_strike_interval_ms);
    const BT = BI && time - ((me.ancAt ||= {})[S.name] ?? -Infinity) >= BI / 1000, BO = BT || !auto && S.kind === 'strike' && (BS.ancestral_aid_required_count_of_recent_blocks > 0 || !!ST && (me.strikes = (me.strikes || 0) + 1) % 2 === 0);
    if (BT) me.ancAt[S.name] = time;
    // the tree's increased area while you are in a state, and per enemy you Ignited in the last 8 s (up to 40%)
    const AW = (S.dmg?.areaWhile || []).reduce((t, w) => t + (meIs[w.cv]?.() ? w.val : 0), 0) + Math.min(40, (S.dmg?.areaIgnited || 0) * dummies.filter(d => time - (d.ignAt ?? -99) <= 8).length);
    if (AW) S.A *= Math.sqrt(1 + AW / 100);
    if (KA && P.slams || AE || AN || BO && P.slams) { S.mult *= (1 + ANCESTRAL.slam / 100) * (1 + (AB.dmg || 0) / 100); S.A *= Math.sqrt(1 + (ANCESTRAL.area + (AB.area || 0)) / 100); }
    else if (KA && S.kind === 'strike') { S.addTargets = KA.more; S.kaom = KA; }
    else if (BO) S.addTargets = ANCESTRAL.strike;
    // Echoing Cry: usable once you have travelled its distance since its last use
    const MV = !auto && S.dmg?.sum?.skill_unusable_until_moved_X_distance;
    const left = MV && MV / 10 - (me.trav - (me.travAt[S.name] ?? -Infinity));
    if (left > 0) { toast(t('{0}: move {1} m first', S.label, Math.ceil(left))); return false; }
    if (MV) me.travAt[S.name] = me.trav;
    const CB = S.dmg?.combo;
    if (!auto && CB?.need && comboNow() < CB.need) { toast(t('{0} needs {1} Combo', S.label, CB.need)); return false; }   // Combo Finisher
    const CV = !auto && S.dmg?.sum?.skill_conditional_requires_X_volatility;   // Catharsis: usable only with its Volatility on you
    if (CV && (me.vol || 0) < CV) { toast(t('Not enough Volatility for {0}', S.label)); return false; }
    // Vruun's Inevitability: it expends the Combo your other melee attacks built (up to its most), its increased area each
    const VA = S.dmg?.sum?.['area_of_effect_+%_per_combo_stack'];
    if (!auto && (CB?.need || VA)) { S.comboSpent = Math.min(comboNow(), VA && S.dmg.sum.skill_maximum_number_of_combo_stacks || Infinity); me.esEarly = (me.esEarly || 0) + S.comboSpent * (CB?.esSooner || 0); me.combo = 0;   /* it spends the Combo; Martial Adept: energy shield recharge sooner per Combo spent */
      // Duality: its Guard for 0.5 seconds, and Finality for its time, per Combo expended
      const DG = S.dmg.sum?.unique_gain_x_guard_for_500_ms_per_combo_lost_using_skills, DF = S.dmg.sum?.gain_finality_for_x_ms_per_combo_lost_using_skills;
      if (S.comboSpent && DG) guardFor(DG, .5 * S.comboSpent);
      if (S.comboSpent && DF) me.finality = time + DF / 1000 * S.comboSpent;
      if (VA) S.A *= Math.sqrt(1 + S.comboSpent * VA / 100);
      // Ailith's Chimes: its Surpassing chance of a Power Charge per Combo expended (over 100%: one for sure, the rest for one more)
      for (let c = S.comboSpent * (S.dmg.sum?.['chance_%_to_gain_power_charges_per_combo_spent'] || 0); c > 0; c -= 100) if (Math.random() * 100 < c) gainCharge('power', S.label);
    }
    // Ancestral Aid: usable once you have Blocked its number of hits since its last use
    const AA = !auto && S.dmg?.sum?.ancestral_aid_required_count_of_recent_blocks, AK = AA && (me.blockN || 0) - (me.aidAt?.[S.name] ?? 0);
    if (AA && AK < AA) { toast(t('{0} needs {1} Blocked Hits', S.label, AA - AK)); return false; }
    if (AA) (me.aidAt ||= {})[S.name] = me.blockN;
    // as in the game, a skill the weapon in hand cannot use is not used (calc.js skill)
    if (!auto && S.name === 'Convalescence' && tog[S.name] && me.es >= me.maxE) { toast(t('{0} cannot be used while Energy Shield is full', S.label)); return false; }   // its text
    if (S.dmg?.reason === 'This skill cannot be used with the weapon in hand') { toast(`${S.label}: ${t(S.dmg.reason)}`); return false; }
    if (!auto && me.maxM && !tog[S.name]) {
      let { cost, life } = costOf(S, o.held);
      if (sheet().divCost) { me.div ??= sheet().divinity || 0; if (cost + life > me.div) { toast(t('Not enough Divinity for {0}', S.label) + ` (${Math.ceil(cost + life)})`); return false; } me.div -= cost + life; cost = life = 0; }   // Immaculate Adherence: skills cost Divinity instead of mana or life
      if (cost > me.mana && !sheet().flame) { toast(t('Not enough mana for {0}', S.label) + ` (${Math.ceil(cost)})`); return false; }
      // a Runic Ward cost (Conductive Runes); Scouring Flame, Runic Extraction, Olroth's Conviction: its share of the life
      // and mana cost as Runic Ward too; Olroth's Hubris: its share of your maximum Ward more, added physical and
      // cold damage of their shares of it (its physical counts for freeze: afflict). note: added as they are, not scaled by the skill's modifiers
      const OH = S.dmg?.sum, WC = ((S.dmg?.stats?._cost?.Ward || 0) + me.maxW * (OH?.['base_ward_cost_+_%_of_maximum_ward'] || 0) / 100 + (cost + life) * (OH?.['base_skill_ward_cost_as_%_of_life_and_mana_cost'] || 0) / 100 + (S.kind === 'splinters' ? splinterCost(S) : 0)) / (1 + (OH?.['base_ward_cost_efficiency_+%'] || 0) / 100);   // Runic Ward cost efficiency (Explosive Transmutation's Gemling quality)
      if (WC > me.ward) { toast(t('Not enough Runic Ward for {0}', S.label)); return false; }
      if (WC) { spendWard(WC); S.wardPaid = WC; }
      // Derange: an Energy Shield cost equal to your Intelligence
      const DR = S.dmg?.finals?.[DERANGE] != null && (sheet().attrs?.int || 0);
      if (DR > me.es) { toast(t('Not enough Energy Shield for {0}', S.label) + ` (${Math.ceil(DR)})`); return false; }
      if (DR) me.es -= DR;
      // a thrown flask (the Concoctions): its charges from your Mana Flask
      const FT = !S.src && S.dmg?.stats?.flask_throw_base_charges_used;
      if (FT && flaskLeft(1) < FT) { toast(t('Not enough Flask charges for {0}', S.label)); return false; }
      if (FT) me.fl[1] -= FT;
      if (OH?.['added_physical_damage_%_ward_cost']) { const H = { ...S.dmg.hits }; for (const [el, k] of [['physical', 'added_physical_damage_%_ward_cost'], ['cold', 'added_cold_damage_%_ward_cost']]) H[el] = (H[el] || [0, 0]).map(v => v + WC * OH[k] / 100); S.dmg = { ...S.dmg, hits: H }; }
      if (life && life >= me.life) { toast(t('Not enough life for {0}', S.label)); return false; }   // a life cost cannot kill you
      const RC = sheet().rage?.cost; if (RC && me.rage < RC) { toast(t('Not enough Rage for {0}', S.label)); return false; }   // Furious Wellspring: Rage cost on every skill
      // Rampage, Flame Breath: its Rage a second while it channels, none for its first seconds; an Empowered Flame Breath's less
      const RT = S.dmg?.stats || {}, C0 = P.channel && chan0[S.name], RPS = C0 && time - C0.t >= (RT.channelled_skill_suppress_ongoing_rage_cost_for_first_X_ms || 0) / 1000 ? (RT._cost?.RagePerSecond || 0) * (o.held ?? SIM.channelTick) * (C0.emp ? 1 + RT['wyvern_devour_empowered_flame_breath_rage_consumption_+%'] / 100 : 1) : 0;
      if (RPS && me.rage < RPS) { toast(t('Not enough Rage for {0}', S.label)); return false; }
      // Incinerate's fuel: it needs its least to start and burns one second per second channelled
      const FS = S.dmg?.stats, fuel = FS?.incinerate_maximum_fuel, F = me.fuel[S.name] || 0;
      if (fuel && (F <= 0 || !fueling(S.name) && F < FS.incinerate_minimum_fuel_to_use / 1000)) { toast(t('Not enough fuel for {0}', S.label)); return false; }
      // its stages: one every its interval channelled, up to its most, each its more damage; its cone's angle
      if (fuel) {
        if (!fueling(S.name)) me.fuelFrom = time;
        me.fuel[S.name] = F - (o.held ?? SIM.channelTick); me.fuelAt[S.name] = time; S.cone = FS.incinerate_cone_angle;
        S.mult *= 1 + Math.min(FS.incinerate_maximum_stages, Math.floor((time - me.fuelFrom) * 1000 / FS.incinerate_gain_stage_every_x_ms)) * FS['incinerate_damage_+%_final_per_stage'] / 100;
      }
      // Charged Shots: every its number of uses, its share of the cost back and its share of damage as extra lightning
      const CH = S.dmg?.sum?.support_charged_shots_applies_every_X_shots;
      const shot = CH && ((me.shots ||= {})[S.name] = (me.shots[S.name] || 0) + 1) % CH === 0;
      S.charged = shot && S.dmg.sum['support_charged_shots_%_damage_to_gain_as_lightning'];
      payMana(cost * (shot ? 1 - S.dmg.sum['support_charged_shots_recover_%_mana_cost_on_use'] / 100 : 1)); me.life -= life + (sheet().skillLife || 0); if (life > 0 && sheet().tecrod) (me.spent ||= []).push({ t: time, n: life }); if (me.life <= 0) died(S.label); if (RC) spendRage(RC); if (RPS) spendRage(RPS); if (cost > 0) for (const o of objs) if (o.spend && !o.dead && dist(o.c, pp) <= o.R) o.spend(cost); gainRage(sheet().rage?.gain.use); if (life > 0) { gloryPaid('life', life, S.name); if (sheet().tides && me.maxL > 0) flaskGain(0, sheet().tides.gain * life / (me.maxL * .02)); }   // Sanguine Tides: charges per 2% of life spent
      // Arcane Surge (support): once its skills have spent its share of your maximum mana, Arcane Surge for its duration
      const AS = S.dmg?.sum?.['support_arcane_surge_gain_buff_on_%_of_maximum_mana_use_threshold'];
      if (AS && cost > 0 && (me.surgeMana = (me.surgeMana || 0) + cost) >= me.maxM * AS / 100) { me.surgeMana = 0; arcaneSurge(S.dmg.sum.support_arcane_surge_base_duration_ms / 1000); }
      // Concoct / Ambrosia: the use consumes their share of your life / mana flask's most charges, for their more bleeding
      // effect / damage gained as lightning per charge consumed
      const flaskUse = (n, k, per) => { const f = flasks()[n], U = S.dmg?.sum || {}; if (!f || !U[k]) return 0; const c = Math.floor(Math.min(flaskLeft(n), f.max * U[k] / 100)); me.fl[n] -= c; return c * (U[per] || 0); };
      S.concoct = flaskUse(0, 'consume_%_of_maximum_life_flask_charges_on_skill_use', 'support_concoct_bleed_effect_+%_final_per_life_flask_charge_consumed');
      S.ambrosia = flaskUse(1, 'consume_%_of_maximum_mana_flask_charges_on_skill_use', 'gain_%_damage_as_lighting_per_mana_flask_charge_consumed');
      if (cost > 0) { fuelUp(S, cost); for (const k in tog) { const T = tog[k]; if (T.manaPer) gainEnergy(T, cost / T.manaPer); } }   // Feral Invocation
    }
    // Extraction, Sacrificial Offering, Guatelitzi's Ablation: their share of your life Sacrificed on use (not damage, and
    // never below 1: keywords.json Sacrifice). note: of maximum life, as the Lich's and the uniques' Sacrifices here
    const sacL = !S.src && !auto && S.dmg?.sum?.['sacrifice_%_life_on_skill_use']; if (sacL) me.life -= Math.max(0, Math.min(me.life - 1, me.maxL * sacL / 100));
    if (CV) volBlow();   // Catharsis: the skill detonates the Volatility on you
    // how far you moved and how long you stood still before this use (Momentum, Dauntless); Rageforged's Rage spent
    S.moved = me.walked || 0; S.still = time - (me.movedAt ?? -99); me.walked = 0;
    if (!auto && S.dmg?.enrage && me.rage >= S.dmg.enrage) { if (!(Math.random() * 100 < (S.dmg.sum?.['rage_skip_consume_chance_%'] || 0))) spendRage(S.dmg.enrage); S.enraged = true; }   // Rageforged II: its chance to keep the Rage
    // charges the supports consume on use (calc.js onUse): one each, all of them for Rally; Perpetual Charge may keep
    // them, Heightened Charges may double what they give; Medved's Felling costs life per 5 Rage
    const U = !auto && S.dmg?.onUse; nextCdX = 1;
    if (U) {
      const take = (c, every) => { const n = every ? charges[c] : Math.min(1, charges[c]); if (!n) return 0; if (!(Math.random() * 100 < U.keep + (c === 'power' ? U.keepPower || 0 : 0))) charges[c] -= n; chargesSpent(n, c); return (n + (c === 'power' && S.dmg?.staffPower || 0)) * (Math.random() * 100 < U.double + (c === 'frenzy' ? sheet().frenzyX || 0 : 0) ? 2 : 1); };   // Deadeye's Thrilling Chase: frenzy charges' too
      let n;
      if (U.speed && (n = take('frenzy'))) nextCdX = 1 + U.speed * n / 100;
      if (U.breakPct && (n = take('frenzy'))) S.breakPct = U.breakPct * n;
      if (U.crit && (n = take('power'))) S.critX = 1 + U.crit * n / 100;
      if (U.curse && (n = take('power'))) S.curseX = 1 + U.curse * n / 100;
      if (U.lifePerEndurance && (n = take('endurance', true))) me.life = Math.min(me.maxL, me.life + me.maxL * U.lifePerEndurance * n / 100);
      if (U.lifePerCooldown && C) me.life = Math.min(me.maxL, me.life + me.maxL * U.lifePerCooldown * C / 1000 / 100);   // Second Wind III
      if (U.lifePer5Rage) me.life = Math.max(1, me.life - me.maxL * U.lifePer5Rage * Math.floor(me.rage / 5) / 100);
    }
    // Explosive Rhythm: its increased cooldown recovery of Grenade skills, with the skill's own increased
    const RH = S.kind === 'grenade' && me.rhythm ? RHYTHM.cd * me.rhythm / Math.max(1, 100 + (S.dmg?.cdInc || 0)) : 0;
    if (C && !BY && !RG && S.name !== 'Demon Form') ready.push(time + C / 1000 / (1 + RH) / (uarch() && isCmd(S) ? 1 + UARCHON.cd * sheet().overgrow.archonEffect / 100 : 1));   // Archon of Undeath: more command cooldown recovery
    // Redemption: an Explosive Rhythm every that many Grenade skills you use (none in Explosive Fervour); at their most they are all removed for it
    const RD = !auto && S.kind === 'grenade' && !(time < me.fervour) && S.dmg?.sum?.gain_stack_of_disorderly_conduct_every_x_grenade_skills_used;
    if (RD && (me.gren = (me.gren || 0) + 1) % RD === 0 && (me.rhythm = (me.rhythm || 0) + 1) >= RHYTHM.max) { me.rhythm = 0; me.fervour = time + FERVOUR.time; }
    for (let k = !auto && S.dmg?.stats?.verisium_infusion_skill_number_of_verisium_infusion_to_grant || 0; k > 0; k--) infGain('verisium', pp, 1 + (S.dmg.stats['verisium_infusion_duration_+%'] || 0) / 100);   // Powered by Verisium (its quality: their duration)
    // Unbound Avatar: usable at its Unbound Fury, which it consumes to make you Unbound for its duration: its more elemental
    // damage, elemental ailment chance and freeze / electrocute buildup
    const UF = !auto && S.dmg?.stats?.ailment_bearer_required_stacks_to_use;
    if (UF) {
      if ((me.fury || 0) < UF) { toast(t('{0} needs {1} Unbound Fury', S.label, UF)); return false; }
      const st = S.dmg.stats; me.fury = 0;
      me.unbound = { until: time + durOf(S), more: 1 + st['ailment_bearer_elemental_damage_+%_final'] / 100, chance: 1 + st['unbound_ailment_elemental_ailment_chance_+%_final'] / 100, build: 1 + st['unbound_ailment_hit_damage_elemental_immobilisation_multiplier_+%_final'] / 100 };
    }
    // Spell Totem: it consumes its number of Power and Endurance Charges in any combination, for its more damage per Power
    // Charge and its more totem duration per Endurance Charge
    // note: which it takes first is the player's choice; Power Charges first here
    const NC = !auto && !sheet().ancestral && S.dmg?.stats?.active_skill_requires_X_power_or_endurance_charges;   // Ancestral Bond: no charge requirement
    if (NC) {
      const have = charges.power + charges.endurance; if (have < NC) { toast(t('{0} needs {1} charges and has {2}', S.label, NC, have)); return false; }
      const p = Math.min(NC, charges.power), st = S.dmg.stats; charges.power -= p; charges.endurance -= NC - p; chargesSpent(p, 'power'); chargesSpent(NC - p, 'endurance');
      S.totemMult = 1 + p * st['spell_totem_damage_+%_final_per_power_charge_consumed'] / 100; S.totemTime = 1 + (NC - p) * st['spell_totem_totem_duration_+%_final_per_endurance_charge_consumed'] / 100; S.totemLife = 1 + (NC - p) * (st['spell_totem_maximum_life_+%_final_per_endurance_charge_consumed'] || 0) / 100;
    }
    // Spectral Volley: a supported projectile attack you use deals its less damage and leaves a Spectral Projectile, up to
    // its most; they all fire, with their more damage, one every its delay, once none has been created for its duration
    // note: one Spectral Projectile per use here
    const SV = !auto && P.attack && P.kind === 'projectile' && S.dmg?.sum?.support_spectral_arrows_maximum_spectral_arrows;
    if (SV) {
      const su = S.dmg.sum;
      me.spectral = { S: { ...S, mult: S.mult * (1 + su['support_spectral_arrows_damage_+%_final_with_spectral_projectiles'] / 100) }, n: Math.min(SV, (me.spectral?.n || 0) + 1), at: time, wait: su.support_spectral_arrows_base_duration_ms / 1000, every: su.support_spectral_arrows_delay_between_projectiles_ms / 1000 };
      S.mult *= 1 + su['support_spectral_arrows_damage_+%_final_with_non_spectral_projectiles'] / 100; fx.glow({ x: pp.x, y: 2.4, z: pp.z }, .6, 'holy', .3);
    }
    // an attack chain (Ice Strike, Tempest Flurry, Primal Strikes): its uses in quick succession step through it, the last
    // being its final part (its first), Tempest Flurry's third striking three times
    // note: "quick succession" has no time in the data; SEQ_GAP s here
    if (!auto && S.dmg?.parts && S.dmg.stats?.statset_index_for_final_animation_combo_index != null) {
      const len = S.dmg.stats.statset_index_for_third_animation_combo_index != null ? 4 : 3, q = (me.seq ||= {})[S.name], live = q && time - q.at < SEQ_GAP;
      // Crescendo: the Final Strike can be used twice in succession; Crescendo III: it is Ancestrally Boosted
      const again = !!(live && q.n === len && !q.again && S.dmg.sum?.repeat_last_step_of_combo_attack), n = again || time < me.finality ? len : live ? q.n % len + 1 : 1;   // (Finality: straight to the Final Strike)
      me.seq[S.name] = { n, at: time, again }; S.chain0 = S.dmg;
      if (n === len && S.dmg.sum?.final_strike_is_ancestrally_boosted) S.addTargets = ANCESTRAL.strike;
      if (n === len && S.dmg.stats?.final_strike_number_of_spirit_strikes) S.addTargets = (S.addTargets || 0) + S.dmg.stats.final_strike_number_of_spirit_strikes;   // Tempest Flurry's quality: its Final Strike's more targets
      if (n === len) { const X = partOf(S, Object.keys(S.dmg.parts)[0]); Object.assign(S, { dmg: X.dmg, el: X.el, els: X.els, ail: X.ail, final: true }); say(t('{0}: Final Strike', S.label), S.el);
        if (time < me.finality) S.critX = (S.critX || 1) * (1 + FINALITY * (X.dmg.critW ?? 1) / 100); }   // Finality's increased Critical Hit Chance, with the skill's own increased
      else if (len === 4 && n === 3) S.times = 3;
    }
    // Volt: its Voltaic Charge from how far you moved since its last use (its gain a metre, up to its most), spent for
    // its share of damage as extra lightning per 10
    const su = S.dmg?.sum, VO = !auto && su?.support_static_charge_maximum_charge;
    S.volt = VO && Math.floor(Math.min(VO, (me.trav - (me.voltAt[S.name] ?? 0)) * su.support_static_charge_charge_gain_per_metre) / 10) * su['support_static_charge_%_damage_gained_as_lightning_per_10_charge'];
    if (VO) me.voltAt[S.name] = me.trav;
    const run = S.name === 'Bind Spectre' ? () => toast(t('{0}: choose its monster in the Skills tab', S.label)) : S.dmg?.cmd && (!P.toggle || tog[S.name]) ? djinnCast : K[S.kind] || K.area;
    run(S); whirl(S);
    if (!auto) zealotry(S);
    if (archmage(S)) archLook(S);
    if (!auto) apparition(i, S);
    // Olroth's Conviction: the skill uses it Empowers, and that many more. note: not an Echoing Cry's later ones
    if (!auto && P.spell && S.dmg?.castTime) event('cast', pp, S, null, S.dmg.castTime / 100);   // Spellslinger
    if (!auto && P.attack && P.ranged && P.projectile) mirage('Mirage Deadeye');
    // Staggering Palm's buff: your Quarterstaff attacks also fire its projectile
    if (!auto && P.attack && time < me.palm?.until && me.palm.X && S.name !== 'Staggering Palm' && SK.skills[S.name]?.weapons?.includes('Quarterstaves')) shoot({ ...me.palm.X, mult: S.mult }, { x: pp.x, z: pp.z }, S.dx, S.dz);
    const OC = S.dmg?.sum?.support_empowers_x_additional_other_skills; if (OC) for (const e of empower) if (e.name === S.name && e.uses && !e.oc) { e.uses += OC; e.oc = true; }
    // Raging Spirits: a fire spell you use yourself also summons them, one per its radius of the spell's area, up to its
    // most per use and its limit, for its duration
    const RS = !auto && S.P.spell && S.els.includes('fire') && onS('Raging Spirits'), rs = RS && RS.dmg.stats;
    if (RS) for (let k = Math.min(rs.skill_raging_spirits_max_per_action, Math.max(1, Math.floor(S.A * 10 / rs.skill_raging_spirit_per_x_radius))); k > 0; k--) {
      limit(o => o.kind === RS.name, tmpN(rs.base_number_of_raging_spirits_allowed)); minion(RS, around(pp, 1), durOf(RS), { kind: RS.name });
    }
    if (!auto && (P.slams || S.kind === 'warcry' || S.name === 'Shield Charge')) for (const o of [...objs]) if (o.segs && o.shatter && !o.dead) o.shatter(P.slams ? 'slam' : 'warcry');
    // Trickster's Shard: a spell you cast leaves a Fractured Mimic where you cast it, for its duration; at their limit they
    // all cast their spells, with their less damage, and are gone
    const TS = !auto && S.P.spell && S.dmg?.trig?.find(T => T.stats?.support_tricksters_shard_maximum_active_mimics);
    if (TS) {
      const M = me.mimics = me.mimics.filter(m => m.until > time), less = 1 + TS.support['skill_used_by_fractured_mimic_spell_damage_+%_final'] / 100;
      M.push({ S: { ...S, mult: S.mult * less }, run, until: time + (TS.shape?.duration || TS.stats.base_skill_effect_duration / 1000) }); fx.ring(S.from, .2, .8, S.el, .5);
      if (M.length >= TS.stats.support_tricksters_shard_maximum_active_mimics) { say(api.info({ name: TS.id }).label, S.el); for (const m of M.splice(0)) m.run(m.S); }
    }
    // a Command skill: the tree's chance of Archon of Undeath and of Puppet Master stacks (a Surpassing chance: one per 100%,
    // then the rest's chance), each lasting on its own; at their most a new one replaces the oldest
    if (!auto && isCmd(S)) {
      if (Math.random() * 100 < sheet().undeath.cmd) undeathGo();
      // Kurgal's Leash: Unholy Might for its time, on you and on your minions. ponytail: all your minions', not only the commanded skill's
      const KL = S.dmg?.sum || {}; if (KL.gain_unholy_might_for_X_ms_on_command) me.umUntil = time + KL.gain_unholy_might_for_X_ms_on_command / 1000; if (KL.minion_gain_unholy_might_for_X_ms_on_command) me.mumUntil = time + KL.minion_gain_unholy_might_for_X_ms_on_command / 1000;
      const P = sheet().puppet; for (let n = Math.floor(P.ch / 100) + (Math.random() * 100 < P.ch % 100 ? 1 : 0); n > 0; n--) { pup(); if (me.pup.length >= PUPPET.max + P.max) me.pup.shift(); me.pup.push(time + PUPPET.time * P.dur); }
    }
    // a Command skill (keywords.json Minion Commands): the tree's chance to Revive a random fallen persistent minion
    if (!auto && me.fallen.length && isCmd(S) && Math.random() * 100 < sheet().reviveCmd) { me.fallen.unshift(...me.fallen.splice(Math.floor(Math.random() * me.fallen.length), 1)); reviveFallen(me.fallen[0].life); }
    // Shapeshifting: a Shapeshift skill turns you into its form (Demon Form is no animal), any other you use reverts you
    const HB = !auto && S.shape && S.dmg?.sum?.support_hide_of_helbrym_soak_duration_ms;   // Helbrym's Hide (keywords.json HelbrymsComposure)
    if (HB) { const U = S.dmg.sum, C = me.helb = { until: time + HB / 1000, n: 0 }; later(HB / 1000, () => { guardFor(C.n * U['support_hide_of_helbrym_gain_guard_from_%_of_damage_taken'] / 100, U.support_hide_of_helbrym_guard_duration_ms / 1000); gainRage(C.n * U['support_hide_of_helbrym_gain_rage_from_%_of_damage_taken'] / 100); }); }
    if (!auto && S.shape) { if (me.form !== S.name && S.name !== 'Demon Form') { me.shiftAt = time; poppet(); } me.form = S.name; } else if (!auto && me.form && !['totem', 'minion', 'raise'].includes(S.kind)) { const SV = sheet().shiftMore?.surge; if (SV && time - (me.shiftAt ?? time) >= SV) arcaneSurge(SK.skills['Arcane Surge'].constant.support_arcane_surge_base_duration_ms / 1000); me.form = null; me.revertAt = time; const RV = sheet().revertRage; if (RV && me.rage > 0) { me.life = Math.min(me.maxL, me.life + me.maxL * RV * me.rage / 100); me.rage = 0; } }   // all Rage consumed for life on reverting
    const CL = S.chaos && sheet().chaosLoss; if (CL) { me.life = Math.max(1, me.life - me.maxL * CL / 100); me.es = Math.max(0, me.es - me.maxE * CL / 100); }   // the tree's life and energy shield lost using a Chaos skill
    { const U = sheet().uDef || {}, q = me.leech.life;   // uniques on casting a spell / attacking: life leeched, life sacrificed for energy shield (Runic Ward at half)
      if (S.P.spell && U.spellLeech) { q.left += me.maxL * U.spellLeech / 100; q.rate = q.left; }
      const SAC = (S.P.spell ? U.spellES || 0 : 0) + (S.P.attack ? U.attackWard || 0 : 0), n = Math.min(me.life - 1, me.maxL * SAC / 100);
      if (n > 0) { me.life -= n; if (S.P.spell && U.spellES) me.es = Math.min(me.maxE, me.es + n); else if (me.maxW) me.ward = Math.min(me.maxW, me.ward + n / 2); } }
    if (!auto) { const T = S.dmg?.useTime || (S.dmg?.speed ? 1 / S.dmg.speed : SIM.castTime); me.use = { S, until: time + T, k: Math.floor(T / .25) }; }   // the skill you are using, for its use time; k: per 250 ms of it (Energy Barrier, Unyielding...)
    used.push({ name: S.name, elemental: S.elemental, cd: !!S.dmg?.cooldown, spell: !!S.P.spell, attack: !!S.P.attack && S.kind !== 'totem', gren: S.kind === 'grenade', mark: S.kind === 'mark', warcry: S.kind === 'warcry', cmd: isCmd(S), dmg: damaging(S), t: time }); while (used[0]?.t < time - 15) used.shift(); if (S.P.attack && S.P.projectile && S.kind !== 'totem') me.shotAt = time;   // the last 15 s (Varashta's Blessing; Uhtred's Constellation: 8 s); placing a totem is not attacking
    // Dusk Vigil: casting a spell yourself triggers Ember Fusillade (the build's gem, as Earthbound's Spark: its own numbers are not in the data)
    if (S.P.spell && !auto && sheet().duskVigil && S.name !== 'Ember Fusillade') { const j = byName('Ember Fusillade'); if (j >= 0) later(.05, () => use(j, { src: 'meta' })); }
    if (S.echo) for (let k = 1; k <= S.echoN; k++) later(.42 * k, () => { say(t('Aftershock of {0} ({1})', S.label, S.echo), 'gold'); shake = Math.max(shake, .25); run({ ...S, mult: S.mult * .7 * (S.echoX || 1), echo: null, spent: 0 }); });
    // Triskelion Cascade: the empowered spell cascades from you to its areas along three arms, its number on each
    if (S.trisk) for (let a = 0; a < 3; a++) for (let k = 1; k <= S.trisk.n; k++) { const q = a * TAU / 3 + facing, r = S.A * 2 * k; later(k * .12, () => run({ ...S, trisk: null, at: { x: pp.x + Math.sin(q) * r, z: pp.z + Math.cos(q) * r } })); }
    // Jagged Ground: a slam consumes its Endurance Charges for Jagged Ground in its area for its duration
    const JG = !auto && P.slams && su?.support_consume_X_endurance_charges_on_use;
    if (JG && charges.endurance >= JG) { charges.endurance -= JG; chargesSpent(JG, 'endurance'); later(.12, () => ground('jagged', S.at, S.A, su.support_jagged_ground_base_duration_ms / 1000, S)); }
    if (!auto && P.spell) briar(S);
    // Charged Staff: your attacks while it lasts also send its lightning shockwave in its cone ahead
    const CW = cstaff(S) && partOf(me.cstaff.S, 'ChargedStaffShockwavePlayer');
    if (CW) { const a0 = Math.atan2(S.dz, S.dx), half = CW.dmg.stats.charged_staff_cone_angle * Math.PI / 360; cstaffWave(pp, S.dx, S.dz, CW.A, half); for (const d of inside(pp, CW.A)) if (inCone(pp, a0, half, d.pos)) hit(d, { ...CW, mult: S.mult }); }
    // Spell Echo: the spell echoes its number of times at the same target after it, the echo with its increased area
    // note: the delay of an echo is not in its data, the scene's quarter second
    const SE = (S.dmg?.sum?.support_spell_echo_number_of_echo_cascades || 0) + (S.sealEcho || 0) + (Math.random() * 100 < (S.dmg?.stats?.['base_spell_%_chance_to_echo'] || 0) ? 1 : 0);   // and Tul's Avalanche's per Seal broken; Comet's and Skyfall's quality: a chance of one
    if (SE) echoed();
    if (SE) for (let k = 1; k <= SE; k++) later(.25 * k, () => run({ ...S, A: S.A * Math.sqrt(1 + (S.dmg.sum['echoed_spell_area_of_effect_+%'] || 0) / 100) }));
    // Spell Cascade: the spell also lands on either side of its target along a random axis, its number on each side, in its smaller area
    const SC = S.dmg?.sum?.support_spell_cascade_number_of_cascades_per_side;
    if (SC) { const q = Math.random() * TAU, A = S.A * Math.sqrt(1 + S.dmg.sum['support_spell_cascade_area_of_effect_+%_for_cascade'] / 100); for (const sd of [1, -1]) for (let k = 1; k <= SC; k++) { const r = sd * (S.A + A * (2 * k - 1)); later(k * .12, () => run({ ...S, A, at: { x: S.at.x + Math.sin(q) * r, z: S.at.z + Math.cos(q) * r } })); } }
    // Chronomancer's Now and Again: a repeatable (Unleashable) spell you use yourself its chance to Repeat once, a Cascadable
    // one its chance to Echo once (as Spell Echo's)
    const NA = !auto && S.P.spell && S.dmg?.sum, NT = NA && S.g && api.info(S.g).gem?.types || [];
    if (NT.includes('Unleashable') && Math.random() * 100 < (NA['ascendancy_spell_deja_vu_spell_%_chance_to_reoccur_an_additional_time'] || 0)) { S.rep = (S.rep || 0) + 1; S.repBy ||= S.label; S.repX ||= 1; }
    if (NT.includes('Cascadable') && Math.random() * 100 < (NA['ascendancy_spell_deja_vu_skill_echo_chance_%'] || 0)) { echoed(); later(.25, () => run({ ...S, rep: 0 })); }
    if (S.rep) { say(t('{0} repeats {1} times ({2})', S.label, S.rep, S.repBy), 'gold'); if (S.barrage) barrageMuzzle(); for (let k = 1; k <= S.rep; k++) later(k * .16, () => { player.act(clipOf(P, S.kind, player.family()), .16); if (S.barrage) barrageMuzzle(); run({ ...S, rep: 0, mult: S.mult * S.repX, from: { x: pp.x, z: pp.z } }); }); }
    // an Orb of Storms nearby answers your spells with a bolt of its own ("when you cast a Spell near the Orb")
    if (!auto && S.P.spell) for (const ob of objs) if (ob.zap && !ob.dead && ob.name !== S.name && dist(ob.pos, pp) <= ob.r) ob.zap(true);
    return true;
  }
  // Glory (keywords.json): each skill that requires it builds its own, up to what it requires, from its Glorious actions:
  // the Power of the enemy (its % of it) once every 0.5 s per enemy, not while that skill is active (but a Banner), or
  // its % of the Ward or of the life you spend; it loses 2 a second after 15 s without gaining any, and is spent on use
  const SEQ_GAP = 2, PARRY_WAIT = 1, GLORY_EVERY = .5, GLORY_IDLE = 15, GLORY_LOSS = 2;
  const trinity = () => onS('Trinity')?.dmg?.stats;
  const gst = S => ({ ...S?.dmg?.finals, ...S?.dmg?.sum, ...S?.dmg?.stats }), spendWard = n => { me.ward -= n; gloryPaid('ward', n); };
  const gloryNeed = S => { const st = gst(S), n = st.active_skill_requires_X_glory; return n ? n * (1 + (st['support_glory_required_+%_final'] || 0) / 100) : 0; };
  const gloryOf = () => slots().map(base).filter(S => S && gloryNeed(S));
  function gloryAdd(S, n) {
    if (!(n > 0) || (/Banner/.test(S.name) ? !tog[S.name] : objs.some(o => o.name === S.name && !o.dead))) return;   // a Banner builds it while its Spirit is reserved
    const max = gloryNeed(S), v = me.glory[S.name] || 0; if (v >= max) return;
    me.glory[S.name] = Math.min(max, v + n * (1 + ((S.dmg?.sum?.['glory_generation_+%'] || 0) + (/Banner/.test(S.name) && S.dmg?.sum?.['glory_generation_+%_for_banners'] || 0)) / 100)); me.gloryAt[S.name] = time; hudT = 0;   // with the tree's increased Glory generation
  }
  function glory(d, ev) {
    for (const S of gloryOf()) {
      // its % of the enemy's Power, or a hundredth of its number whatever the enemy (Spear of Solaris' Ignite and Shock)
      const st = gst(S), mp = st[`active_skill_generates_mp_%_glory_per_${ev}`] || 0, flat = st[`active_skill_hundred_times_generates_glory_per_${ev}`] || 0;
      const seen = d.gloryAt ||= {}; if (!mp && !flat || time - (seen[S.name] ?? -9) < GLORY_EVERY) continue;
      seen[S.name] = time; gloryAdd(S, (mp * pow(d) + flat) / 100);
    }
  }
  // the Ward or life spent: Skyfall's % of the Ward, Zerphi's Infamy's of the life spent on other skills
  function gloryPaid(what, n, by) { for (const S of gloryOf()) if (S.name !== by) { const st = gst(S); gloryAdd(S, n * (st[`active_skill_generates_%_of_${what}_spent_as_glory`] || 0) / 100); } }
  // Incinerate gains its fuel from the mana spent on any other skill (its ms per mana), up to its most, not while it is used
  const fueling = n => time - (me.fuelAt[n] ?? -9) <= SIM.channelTick * 2;
  function fuelUp(S, mana) {
    for (const g of api.build().gems) {
      const st = g.name !== S.name && !fueling(g.name) && api.damage?.(g)?.stats, k = st?.incinerate_fuel_gain_per_mana_spent;
      if (k) me.fuel[g.name] = Math.min(st.incinerate_maximum_fuel / 1000, (me.fuel[g.name] || 0) + mana * k / 1000);
    }
  }
  function fire(i) {
    const b = base(i);
    if (b && use(i)) { cd = b.P.channel && !b.P.stages ? SIM.channelTick : useTime(b); player.pace(cd); } else { cd = .3; held = null; }
  }
  // seconds between uses: the attack / cast speed of the build when calc.js knows it, else the scene default
  let nextCdX = 1;   // Ferocity: more skill speed for the use that consumed a frenzy charge
  // a crossbow fires its clip at its firing rate and reloads when the last bolt is gone (Ammo Conservation may keep one)
  const clips = {}, cdReady = {};
  const useTime = b => {
    if (b.kind === 'totem' && b.dmg?.placeTime) return b.dmg.placeTime;
    const c = b.dmg?.clip, sp = c ? c.fire : b.dmg?.useTime ? 1 / b.dmg.useTime : b.dmg?.speed;   // with a cooldown: its own speed, the uses limit it
    let t = (sp > 0 ? clamp(1 / sp, .15, 3) : SIM.castTime) / nextCdX / regulate('frenzy', 'charge_mastery_skill_speed_+%_with_frenzy_charges') / (1 + (me.cad?.[b.name]?.n || 0) * (b.dmg?.sum?.['support_measured_speed_attack_speed_+%_final_per_stack'] || 0) / 100)
      / demonCast(b) / (isCmd(b) ? 1 + PUPPET.cmdSpeed * pup() / 100 : 1)   /* Demon Form, Puppet Master. note: as more here */
      // Onslaught (Savage Fury's frenzy). note: the game adds it to your increased skill speed, a factor of its own here
      / (time - (me.totemAt ?? -99) <= RECENT ? 1 + (sheet().totemSpeed || 0) / 100 : 1) /* Ancestral Alacrity. note: as more here */ / (onsl() ? 1 + ONSLAUGHT.speed / 100 : 1) / (1 + (me.tail || 0) * TAILWIND.speed / 100) / (1 + souls() * SOUL.speed / 100) / (time < me.fervour && b.P.attack ? 1 + FERVOUR.speed * new Set(used.filter(u => u.gren && time - u.t <= RECENT).map(u => u.name)).size / 100 : 1) /* Explosive Fervour. note: as more here */ / (openWeak(topD) ? 1 + sheet().weakness.speed / 100 : 1) /* In for the Kill: against your target with an Open Weakness */ / (b.P.spell ? 1 + ARCANE.cast * surge() / 100 : 1) / speedWhile(b)
      // Medved's Felling: its attack speed per 5 Rage. note: the game adds it to the skill's increased attack speed, a factor of its own here
      / (1 + Math.floor(me.rage / 5) * (b.dmg?.sum?.['supported_skill_attack_speed_+%_per_5_rage'] || 0) / 100)
      // Rapid Casting III: its cast speed per different spell you cast in the last eight seconds
      / (1 + new Set(used.filter(u => u.spell && time - u.t <= 8).map(u => u.name)).size * (b.P.spell && b.dmg?.sum?.['cast_speed_+%_per_num_unique_spells_cast_in_last_8_seconds'] || 0) / 100);
    const LL = sheet().lament?.life;   // The Last Lament: life sacrificed to not consume the last bolt
    if (c && !(Math.random() < c.keep) && (clips[b.name] = (clips[b.name] ?? c.bolts) - 1) <= 0 && !(LL && me.life > LL && (me.life -= LL, clips[b.name] = 1))) { clips[b.name] = c.bolts; t += c.reload; reloads.push({ t: time + t, n: c.bolts }); gemini(); while (reloads[0]?.t < time - 8) reloads.shift(); }
    // "up to +X seconds to Total Attack Time based on distance travelled" (Leap Slam, Molten Crash, Devour): by the share of
    // its range it just travelled; Devour's less attack speed on a near target, more on a far one
    // note: a leap's range is the scene's; Devour's near and far are not in the data: near within reach, far when it dashes
    const bs = b.dmg?.stats || {}, BD = bs.skill_added_attack_time_by_distance_ms, DV = bs[me.leapK ? 'wyvern_devour_far_target_attack_speed_+%_final' : 'wyvern_devour_near_target_attack_speed_+%_final'];
    if (DV) t /= 1 + DV / 100;
    if (BD) t += BD / 1000 * (me.leapK || 0);
    return t;
  };
  function press(i, key) {
    const b = slots().includes(i) && base(i); if (!b || move) return;   // what has a slot: by hand, Banners, Temporal Rift, Iron Ward
    held = null;
    if (b.P.stages && b.P.channel) { charge = { i, s: 0 }; held = { i, key }; return; }   // charge while held, release to fire
    if (b.P.toggle || b.kind === 'field') { use(i); return; }
    if (ONCE.has(b.kind)) { if (cd <= 0 && use(i)) { cd = useTime(b); player.pace(cd); } return; }
    held = { i, key };
    if (cd <= 0) fire(i);
  }
  function release() {
    const c = charge; charge = null; held = null;
    const RS = me.raised; me.raised = null;   // Raise Shield: its Shield Bash when released soon after a block
    if (RS && time - (RS.blocked ?? -9) <= RS.S.dmg.stats.raise_shield_base_retaliation_duration_ms / 1000 && near(pp, meleeR(RS.S) + SIM.body)) K.sweep({ ...RS.S, from: { x: pp.x, z: pp.z }, parries: sheet().raiseParry && { more: RS.S.dmg.stats['base_parry_buff_damage_taken_+%_final_to_apply'] * (1 + (sheet().parryMag || 0) / 100), until: time + sheet().raiseParry * (sheet().parryTime || 1) } });   // Bastion of Light: Parried on Hit
    const P = c && base(c.i)?.P; if (!P) return;
    // Assailum, Tasalio's Rhythm: a longer Perfect Timing window; each stack of the Rhythm a shorter one. note: its 30% shorter as less
    const SU = base(c.i).dmg?.sum || {}, TR = SU.gain_X_tasalios_perfection_on_perfect_timing, win = .2 * (1 + ((sheet().perfectWin || 0) + (SU['perfect_timing_window_ms_+%'] || 0) + flaskOn('perfectWin')) / 100) * (TR ? (1 - TASALIO.win / 100) ** (me.tasalio || 0) : 1);
    const perfect = P.perfect && Math.abs(c.s - 1) < win;
    if (perfect) flasks().forEach((f, n) => f?.onPerfect && drink(n, true));   // Opportunity: used when you release a skill with Perfect Timing
    if (use(c.i, { stage: Math.min(1, c.s / (P.perfect ? 1 : 1.6)), perfect, held: c.s })) { cd = useTime(base(c.i)); player.pace(cd); }
    // Perfection, Tasalio's Rhythm: a stack on Perfect Timing, all lost on failing one
    if (P.perfect && perfect) { const PF = SU.gain_X_perfection_on_successful_perfect_timing; if (PF) me.perf = { n: Math.min(PERFECTION.max, (time < me.perf?.until ? me.perf.n : 0) + PF), until: time + PERFECTION.time }; if (TR) me.tasalio = Math.min(TASALIO.max, (me.tasalio || 0) + TR); }
    else if (P.perfect) { me.perf = null; me.tasalio = 0; }
  }
  // keep: selecting with the number keys does not stop placing enemies
  function select(i, tell = true, keep = false) { if (!api.build().gems[i]) return; sel = i; hudT = 0; if (placing && !keep) setPlacing(false); if (tell) api.onSelect?.(i); }
  function setPlacing(on) { placing = !!on && !!tpl.mon; dom.style.cursor = placing ? 'cell' : ''; hudT = 0; api.onPlacing?.(placing); }

  // ---------- input
  const typing = e => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
  const aimMouse = e => { const r = dom.getBoundingClientRect(); mouse.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); };
  // the cursor on the ground; over the body of an enemy it aims at that enemy, as clicking a monster does in the game
  const bodyA = V(0, 0, 0), bodyB = V(0, 0, 0);
  const pick = (ground = placing) => {
    ray.setFromCamera(mouse, cam); ray.ray.intersectPlane(plane, cursor);
    if (ground) return null;
    let best = null, near = Infinity;
    for (const d of dummies) {
      if (d.dead) continue;
      bodyA.set(d.pos.x, .25, d.pos.z); bodyB.set(d.pos.x, 1.75 * d.sc, d.pos.z);
      if (ray.ray.distanceSqToSegment(bodyA, bodyB) > (.42 * d.sc) ** 2) continue;
      const k = cam.position.distanceToSquared(bodyA); if (k < near) { near = k; best = d; }
    }
    if (best) cursor.set(best.pos.x, 0, best.pos.z);
    return best;
  };
  // a slot's key pressed: Move walks to the cursor while it is held, a skill is used
  let walkKey = null;
  const useSlot = (k, key) => { const i = barNow()[k]; if (i == null) return; if (i === MOVED) { walk = true; walkKey = key; goal = { x: cursor.x, z: cursor.z }; return; } select(i, true, true); press(i, key); };
  const unhold = key => { if (held?.key === key) release(); if (walkKey === key) { walk = false; walkKey = null; } };
  addEventListener('keydown', e => {
    if (el.hidden || typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const c = e.code; inputOf(false);
    const K = settings().keys;
    if (c === K.roll) e.preventDefault();
    keys[c] = true;
    if (e.repeat) return;
    if (slotKeys().includes(c)) useSlot(slotKeys().indexOf(c), c);
    else if (c === K.reset) reset();
    else if (c === K.lifeFlask || c === K.manaFlask) drink(c === K.lifeFlask ? 0 : 1);
    else if (c === 'Escape') { setPlacing(false); closePick(); }
    else if (c === K.refill) { heal(); fx.ring(pp, 1.6, .3, 'holy', .4); say(t('Life and energy shield refilled'), 'holy'); }
    else if (c === K.corpse) {   // the enemy at the cursor becomes a corpse, for the skills that need one
      const d = near(cursor, 4);
      if (d) { d.st.freeze = 0; kill(d, { ...NONE, label: t('You') }); say(t('Corpse made: skills that need a corpse can use it'), 'gold'); }
      else toast(t('Point at an enemy to turn it into a corpse'));
    }
    else if (c === K.charges) { for (const k in charges) { charges[k] = maxC(k); chargeAt[k] = time; } fx.ring(pp, 1.8, .3, 'gold', .4); say(t('Charges filled'), 'gold'); }
    else if (c === K.swap && api.swapSet) swap();
    else if (c === K.roll) roll();
  });
  const rollHeld = () => keys[settings().keys.roll] || padWas[1];
  // the roll: where W A S D or the stick move you, else toward the cursor, as the game's
  // Vivid Stampede: a Stag for each Wisp expended leaps forward (toward the nearest enemy within Sacred Unity's angle),
  // its shockwave each time it lands, its number of them, with The Mórrigan's Guidance's more damage and Shock magnitude
  // per leap; past its last it leaves Shocked Ground for its duration. Its cooldown between uses.
  // note: the granted skill's level is not in the data: 20, as Primal Bounty's; its spacing read as the gap between
  // shockwaves (each leap its diameter plus that), the Stags fanned out
  function stampede(S) {
    const VS = sheet().vivid, D = VS && time >= (me.vividAt ?? -9) && granted('Vivid Stampede', 20); if (!D) return;
    const st = D.stats, X = { ...asTrig(S, { ...D, id: 'Vivid Stampede' }), src: 'vivid' }, n = me.wisps, legs = st.vivid_stag_cascade_number_of_damaging_areas || 1, step = 2 * X.A + (st.vivid_stag_spacing || 0) / 10;
    me.wisps = 0; me.vividAt = time + (st._cooldown_ms || 0) / 1000; say(X.label + (n > 1 ? ` ×${n}` : ''), 'lightning');
    const half = (VS.home || 0) * Math.PI / 360, ang = d => Math.atan2(d.pos.x - pp.x, d.pos.z - pp.z);
    const aim = half && near(pp, legs * step, d => inCone(pp, Math.PI / 2 - facing, half, d.pos)), a0 = aim ? ang(aim) : facing, o = { x: pp.x, z: pp.z };
    for (let j = 0; j < n; j++) { const a = a0 + (j - (n - 1) / 2) * .3;
      for (let k = 0; k < legs; k++) later(.1 + k * .15, () => { const c = { x: o.x + Math.sin(a) * step * (k + 1), z: o.z + Math.cos(a) * step * (k + 1) };
        fx.ring(c, .2, X.A, 'lightning', .3); area(c, X.A, { ...X, mult: X.mult * (1 + VS.more * k / 100), shockX: 1 + VS.shock * k / 100 });
        if (k === legs - 1) ground('shocked', c, X.A, (st.base_skill_effect_duration || 0) / 1000, { ...X, src: 'ground' }); }); }
    if (VS.onEnd) later(.1 + legs * .15, () => { me.wisps = Math.min(VS.max, (me.wisps || 0) + VS.onEnd); });   // The Mórrigan's Guidance
  }
  // Rhoa Mount (its description): used again you mount the Rhoa (after its cast time) while wielding a Bow or Spear, or
  // dismount; mounted, only Bow, thrown Spear and Mark skills are usable and the Rhoa neither attacks nor is hit.
  // note: the Heavy Stun buildup from being Hit while mounted and the Rhoa's own movement speed are not in the data: none, yours
  const mountable = S => { const T = api.info(S.g).gem?.tags || []; return T.includes('bow') || T.includes('mark') || T.includes('spear') && T.includes('projectile'); };
  function mount(S) {
    if (me.mounted) { me.mounted = false; say(t('{0}: dismounted', S.label), 'dust'); return; }
    if (!sheet().mountOk) { toast(t('{0} needs a Bow or a Spear', S.label)); return; }
    castAt = time; later(S.dmg?.speed ? 1 / S.dmg.speed : 1, () => { if (tog[S.name] && sheet().mountOk) { me.mounted = true; say(t('{0}: mounted', S.label), 'gold'); } });
  }
  const OWL = { every: 4, max: 3, proj: 2 };   // Primal Bounty's Owl Feathers (step, roll)
  // Blink's look (MiscEffectPacks BlinkTeleportCharacterEffect: reservation_blink dodge_blink.epk, on you where you vanish and
  // where you appear): a blue flash at your core for 0.1 s (blinkCore_Flash, its colour 1.6 / 5.07 / 10), blue sparks off
  // your body for 0.5-1 s (chronoSparks 7.2 / 9.53 / 38), your body lit blue as it warps (warpSkin 0.89 / 3.85 / 8) and a
  // light shake (coreFX). note: its shimmer of the air (blinkSoundBoom) is not drawn
  const BLK = { flash: 0x2981ff, spark: 0x3040ff, skin: 0x1c7aff };
  function blinkFx(a, b) {
    for (const p of [a, b]) {
      fx.flash(p, BLK.flash, 8, .12, 5); fx.glow({ x: p.x, y: 1.1, z: p.z }, 1.4, BLK.skin, .25, 2.5);
      fx.emit(6, { p: { x: p.x, y: .3, z: p.z }, r: .3, h: 1.4, v: 1.2, up: .4, life: .75, size: .08, c: BLK.spark, c2: BLK.flash, k: 2, drag: 1 });
    }
    shake = Math.max(shake, .15);
  }
  // A curse's own look (curses_02), Despair's (despair_aoe.ao, despair_surge_wave.ao, orbs/despair.ao): cast, a surge
  // goes out of your hand toward its area for 0.6-1 s (0.8 / 0.6 / 1); its area its runes on the ground for its delay
  // (curse_runes despair_area, hex_despair_ring 4 / 1 / 15), a ring widening from half its area to all of it over 1.5 s,
  // the ground darkened for 2 s (black_shockwave) and sparkles rising for 1 s (hex_despair_sparkles 1.8 / 1.25 / 8);
  // each enemy it curses its symbol over its head while cursed (curse_runes despair, in its orb's colour), shown
  // with a violet orb for 2 s (hex_despair_orb 3.5 / 1 / 8). note: its dark wave is left out; the counts, speeds and sizes are the scene's.
  // Elemental Weakness's (elemental_weakness_aoe.ao, eleweakness_surge_wave.ao, orbs/elemental_weakness.ao; its tutorial
  // video): its runes (eleweakness_area, elementalweakness) three colours by the game's colour mask (color_msk, its
  // material's 1.25 / 0.25 / 0.025, 0.1 / 0.25 / 1, 0.35 / 0.45 / 1), baked into their pictures; its surge 1 / 0.58 / 0.4,
  // its orb fire (1 / 0.12 / 0.005) in a cold glow (0.35 / 0.4 / 0.8); no sparkles. note: its widening ring in the mask's
  // blue (0.1 / 0.25 / 1), the colour of most of its runes' ring
  const CURSE_LOOK = { Despair: { rune: 'despair', ring: 0x4412ff, spark: 0x3928ff, orb: 0x7020ff, wave: 0xcc99ff },
    'Elemental Weakness': { rune: 'elementalweakness', area: 'eleweakness_area', tint: 0xffffff, ring: 0x1a40ff, orb: 0xff1f01, glow: 0x5966cc, sym: 0xffffff, wave: 0xff9466 } };
  const curseTex = r => artTex('curse_' + r, `particles/curses_02/area/curse_runes/${r}_dxt1`);
  function hexArea(L, c, R, wait) {
    const H = hand(), l = dist(c, pp) || 1, dx = (c.x - pp.x) / l, dz = (c.z - pp.z) / l, to = { x: H.x + dx * 1.4, z: H.z + dz * 1.4 };
    fx.strip(H, to, .45, L.wave, .8, { a: .45, k: 1.6, y: H.y });
    for (let i = 0; i < 3; i++) fx.streak(V(H.x, H.y, H.z), V(to.x - dz * (i - 1) * .25, H.y + (i - 1) * .2, to.z + dx * (i - 1) * .25), L.wave, rnd(.6, .8), .02, .5);
    const D = fx.decal(c, R, curseTex(L.area || L.rune + '_area'), L.tint ?? L.ring, { a: .9, k: 2.2, rot: 0 }); later(Math.max(wait, .8), () => D.remove());
    fx.ring(c, R * .5, R, L.ring, 1.5, { a: .8, tex: 'outline' }); fx.disc(c, R, 0x000000, 2, { dark: true, a: .35 });
    if (L.spark) fx.emit(24, { p: { x: c.x, y: .1, z: c.z }, r: R * .9, v: .2, up: 1.5, life: 1, size: .06, c: L.spark, c2: 'white', k: 2.2, drag: 1 });
  }
  // Blasphemy's look (Metadata/Effects/Spells/supports/blasphemy, art/particles/supports/blasphemy): each curse in it a
  // ring of its own runes on the ground round you, as wide as its area, in its colour (its aura_<curse> mat's albedo),
  // turning slowly; turned on, its symbol (blasphemy_BC1, its base rune colour 0.7 / 1 / 6) surges round you.
  // note: Elemental Weakness's ring is three colours by a mask in the game (1.25 / 0.25 / 0.025, 0.1 / 0.25 / 1,
  // 0.35 / 0.45 / 1): one, their mean, here; a curse without its own ring (Repulsion) shows its area's outline
  const BLAS = { 'Temporal Chains': ['temporalchains', 0xc42bff], Enfeeble: ['enfeeble', 0xe3ff5c], Despair: ['despair', 0x8040ff],
    'Elemental Weakness': ['eleweak', 0xd678ff], Vulnerability: ['vulnerability', 0xff3333] };
  const blasRing = S => { const c = BLAS[S.name]; return c ? fx.decal(pp, S.A, artTex('blas_' + c[0], `particles/supports/blasphemy/textures/runes/${c[0]}_aura_dxt1`), c[1], { a: .8, k: 1.4, spin: .2 }) : fx.decal(pp, S.A, 'outline', S.el, { a: .45, rot: 0 }); };
  // Black Powder Blitz's look (Shankgonne: Metadata/Effects/misc/Uniques/boots/shankgonne, its dodge timeline
  // shankgonnedodge.atl): the round's blast where you leave (cannon_fire: a flash, a ring of smoke, sparks, embers, debris,
  // a scorch), smoke and fire trailing your foot through the leap, the cannon leg glowing for 3.9 s, and sparks with a
  // puff of smoke at your footsteps (cannon_ball_footsteps, canon_spark)
  const BP = { flash: 0xffb08a, spark: 0xff4714, ember: 0xff874a, fire: 0xffa370, glow: 0xff5e1f, smoke: 0x2c2c2c, trail: 0x070605, wave: 0xff3810, debris: 0x3a3028, scorch: 0x140c08, glowFor: 3.93 };
  function powderBlast(c, R) {
    fx.flash(c, BP.flash, 30, .25, 8); fx.ring(c, .3, R, BP.wave, .45, { a: .6 });
    const at = { x: c.x, y: .3, z: c.z };
    fx.emit(30, { p: at, r: .3, v: R * 4, up: 2.5, life: .5, size: .1, c: BP.spark, c2: BP.ember, g: 6, drag: 1.5, k: 2.5 });
    fx.emit(14, { p: at, r: .4, v: 2, up: 4, life: 1.2, size: .08, c: BP.ember, g: 4, drag: .8 });
    fx.emit(10, { p: at, r: .3, v: 3, up: 4, life: .9, size: .1, c: BP.debris, smoke: true, a: .9, g: 12 });
    fx.emit(12, { p: { x: c.x, y: .2, z: c.z }, r: R * .6, v: R * 1.5, up: .6, life: 1.4, size: 1, grow: 2, c: BP.smoke, smoke: true, a: .5, drag: 1.5 });
    const sc = fx.decal(c, R * .8, 'cracks', BP.scorch, { dark: true, a: .7 }); later(2, () => sc.remove());
    shake = Math.max(shake, Math.min(.5, R * .09));
  }
  let powderStep = 0;
  function roll() {
    if (move || rollCd > 0 || stuck() || sheet().unwavering) return;   // Unwavering Stance: cannot Dodge Roll or Sprint
    const fx0 = cursor.x - pp.x, fz0 = cursor.z - pp.z, l = Math.hypot(fx0, fz0);
    const dx = steer ? steer.x : l > .1 ? fx0 / l : Math.sin(facing), dz = steer ? steer.z : l > .1 ? fz0 / l : Math.cos(facing);
    // Blink, Black Powder Blitz (on): the dodge is its teleport / its leap as far as it travels, once every its cooldown
    // (the roll meanwhile); Black Powder Blitz's round explodes where you leave (it Blinds and Ignites: its stats; a Detonator)
    const DR = ['Blink', 'Black Powder Blitz'].map(onS).find(X => X && sh(X).travel && !(time < me.leapAt?.[X.name]));
    const UD = sheet().uDef || {}, L = DR ? sh(DR).travel : 3.6 + (UD.rollDist || 0) + (meIs.Surrounded() ? sheet().rollSurr || 0 : 0) + (time - (me.rollAt ?? -99) <= RECENT ? UD.rollAgain || 0 : UD.rollFresh || 0);   // the tree's more while Surrounded; Lioneye's Glare
    if (UD.rollGuard && me.maxE > me.es) guardFor((me.maxE - me.es) * UD.rollGuard / 100, 4);   // Decree of Flight
    move = { from: { x: pp.x, z: pp.z }, to: { x: pp.x + dx * L, z: pp.z + dz * L }, k: 0, dur: .3 / (1 + (UD.rollSpeed || 0) / 100), h: .25, roll: true }; rollCd = .7; me.rollAt = time; me.actEnd = 0;   /* a roll ends the action */ me.sprint = null; if (UD.overEnc) me.overEnc = { n: (time < me.overEnc?.until ? me.overEnc.n : 0) + 1, until: time + 4 };   /* Ab Aeterno: Overencumbered for 4 seconds (its text), stacking */ facing = Math.atan2(dx, dz); charge = held = goal = null;
    if (DR) { (me.leapAt ||= {})[DR.name] = time + (DR.dmg.cooldown || 0) / 1000; if (DR.P.spell) move.dur = .06;
      // Black Powder Blitz: a leap (its timeline lands at 0.52 s; note: its height, 1 m, is the scene's), the round's blast
      const BX = DR.name === 'Black Powder Blitz'; if (BX) { Object.assign(move, { dur: .52, h: 1, powder: true }); me.powderGlow = time + BP.glowFor; fx.emit(8, { p: { x: pp.x, y: 1.2, z: pp.z }, r: .3, v: .4, up: .8, life: 1, size: .6, grow: 1.5, c: 0x343839, smoke: true, a: .45 }); }
      if (DR.name === 'Blink') { move.blink = true; blinkFx(move.from, move.to); }   // a teleport: no roll
      if (Object.keys(DR.dmg.hits).length) { if (BX) { powderBlast(move.from, DR.A); area(move.from, DR.A, { ...DR, mult: 1 }); } else boom(move.from, DR.A, { ...DR, mult: 1 }); } }
    if (!move.blink) fx.emit(10, { p: { x: pp.x, y: .1, z: pp.z }, r: .3, v: 1, up: .6, life: .6, size: .5, grow: 2, c: 'dust', smoke: true, a: .35 });   // a teleport kicks up no dust
    later(move.dur, () => event('dodge', near(pp, 30)?.pos || pp, NONE, null, L));   // Cast on Dodge: its Energy per metre rolled, all of it once rolled
    for (const k in clips) { const X = onS(k), n = X?.dmg?.sum?.crossbow_load_x_bolts_on_dodge; if (n && X.dmg.clip) clips[k] = Math.min(X.dmg.clip.bolts, clips[k] + n); }   // Ratha's Assault: bolts loaded when you Dodge
    const LI = onS('Lingering Illusion'); if (LI) illusion(LI, { x: pp.x, z: pp.z });
    mirage('Mirage Archer');
    // Primal Bounty: the dodge expends an Owl Feather (up to its number more with The Mhacha's Gift, each 100% more
    // Empowerment effect) to empower your next projectile skill: its additional projectiles and faster flight
    // note: 2 additional projectiles is poe2db's (Primal_Bounty), not in the data; the granted skill's level is not in
    // the data either: 20
    const OW = sheet().owl, PB = OW && me.owls > 0 && granted('Primal Bounty', 20)?.stats;
    if (PB) {
      const label = api.info({ name: 'Primal Bounty' }).label;
      const n = Math.min(me.owls, OW.stack >= 2 ? OW.stack + 1 : 1); me.owls -= n;
      empower = empower.filter(e => e.type !== 'bounty');
      empower.push({ type: 'bounty', label, name: 'Primal Bounty', el: 'gold', s: PB.owl_feather_buff_timer_ms / 1000, add: OWL.proj * n, speed: PB['multishot_empowered_projectile_speed_+%'] * n });
      say(t('{0} active', label) + (n > 1 ? ` ×${n}` : ''), 'gold');
    }
    // Trail of Caltrops: its number of drops, the first at its share of the dodge and the others at its interval after it
    const TC = onS('Trail of Caltrops'), st = TC?.dmg.stats;
    if (TC) Object.assign(move, { TC, drops: Array.from({ length: st.caltrops_on_dodge_X_triggers }, (_, k) => (st['caltrops_on_dodge_first_trigger_at_%_dodge'] + k * st['caltrops_on_dodge_trigger_interval_%_dodge']) / 100) });
  }
  addEventListener('keyup', e => { keys[e.code] = false; unhold(e.code); if (e.key === 'Alt' && !el.hidden) e.preventDefault(); });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; orbit = walk = false; if (held) release(); });
  dom.addEventListener('mousemove', e => {
    aimMouse(e); inputOf(false); hover = pick();
    if (orbit) { camS.yaw -= e.movementX * .006; camS.pitch = clamp(camS.pitch + e.movementY * .005, .35, 1.45); }
  });
  dom.addEventListener('mousedown', e => {
    aimMouse(e); closePick();
    if (e.button === 1) e.preventDefault();   // no auto-scroll
    if (e.altKey) { orbit = true; e.preventDefault(); return; }
    if (e.button === 0 && tpl.mon && (placing || e.ctrlKey)) { pick(true); place(cursor.x, cursor.z); return; }
    pick();
    if (e.button <= 2) useSlot(e.button, 'm' + e.button);   // left click too: Move walks, as in the game, a skill there is used
  });
  addEventListener('mouseup', e => { unhold('m' + e.button); orbit = false; });
  dom.addEventListener('contextmenu', e => e.preventDefault());
  dom.addEventListener('wheel', e => { e.preventDefault(); camS.dist = clamp(camS.dist * (1 + Math.sign(e.deltaY) * .1), 8, 42); }, { passive: false });
  // clicking a slot opens the list of the skills to put on it, as in the game
  bar.addEventListener('mousedown', e => {
    const f = e.target.closest('[data-f]'); if (f) { e.preventDefault(); e.stopPropagation(); return drink(+f.dataset.f); }
    const b = e.target.closest('[data-k]'); if (!b) return;
    e.preventDefault(); e.stopPropagation(); openPick(+b.dataset.k);
  });
  function openPick(k) {
    if (!pickEl.hidden && +pickEl.dataset.k === k) return closePick();
    const gems = api.build().gems, cur = barNow()[k], slot = bar.querySelector(`[data-k="${k}"]`); if (!slot) return;
    put(pickEl, `<button data-pick="${MOVE}" title="${esc(t('Move'))}"${cur === MOVED ? ' class="on"' : ''}>${moveImg}</button>` + slots().map(i => { const inf = api.info(gems[i]); return `<button data-pick="${i}" title="${esc(inf.label)}"${i === cur ? ' class="on"' : ''}>${inf.icon ? `<img src="${esc(inf.icon)}" alt="" draggable="false">` : esc(inf.label.slice(0, 3))}</button>`; }).join('')
      + `<button data-pick="" title="${esc(t('Empty'))}">✕</button>`);
    pickEl.dataset.k = k; pickEl.hidden = false; tipEl.hidden = true;
    const r = slot.getBoundingClientRect(), box = el.getBoundingClientRect(), w = pickEl.offsetWidth;
    pickEl.style.left = clamp(r.left - box.left + r.width / 2 - w / 2, 6, box.width - w - 6) + 'px';
    pickEl.style.bottom = (box.bottom - r.top + 8) + 'px';
  }
  function closePick() { pickEl.hidden = true; }
  pickEl.addEventListener('mousedown', e => {
    e.stopPropagation(); const b = e.target.closest('[data-pick]'); if (!b) return;
    const p = b.dataset.pick; e.preventDefault(); setSlot(+pickEl.dataset.k, p === '' ? null : p === MOVE ? MOVE : api.build().gems[+p].name); closePick();
  });

  // ---------- target reticle: the real area of the selected skill, where it would land
  const ret = {
    circle: new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), fx.glowMat('white', 1.2, .6, fx.T.outline)),
    strip: new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(.5, 0, 0), fx.glowMat('white', 1.2, .3, fx.T.beam)),
    sector: new THREE.Mesh(new THREE.BufferGeometry(), fx.glowMat('white', 1, .22, fx.T.disc)), half: 0,
  };
  for (const m of [ret.circle, ret.strip, ret.sector]) { m.renderOrder = 3; m.visible = false; scene.add(m); }
  let pk = null;
  function peek() {
    const b = base(sel); if (!b) return null;
    if (pk?.b !== b) pk = { b, S: { ...b } };
    aim(pk.S, cursor); pk.S.stage = charge && charge.i === sel ? Math.min(1, charge.s / (b.P.perfect ? 1 : 1.6)) : null;
    return pk.S;
  }
  function reticle() {
    ret.circle.visible = ret.strip.visible = ret.sector.visible = false;
    if (placing) {   // where the enemy will stand
      const m = ret.circle, r = (tpl.mon.boss ? 1.45 : 1) * .6 * (1 + Math.sin(time * 6) * .06);
      m.visible = true; m.position.set(cursor.x, .07, cursor.z); m.scale.set(r, 1, r); m.material.color.copy(fx.color('gold', 1.5)); return;
    }
    const S = peek(); if (!S) return;
    const c = S.at, P = S.P, col = fx.color(S.el, 1.3);
    const circle = (p, r) => { const m = ret.circle; m.visible = true; m.position.set(p.x, .07, p.z); m.scale.set(r, 1, r); m.material.color.copy(col); };
    const strip = (p, dx, dz, len, w) => { const m = ret.strip; m.visible = true; m.position.set(p.x, .07, p.z); m.rotation.y = Math.atan2(-dz, dx); m.scale.set(len, 1, w); m.material.color.copy(col); };
    const sector = (r, half) => {
      const m = ret.sector; if (ret.half !== half) { ret.half = half; m.geometry.dispose(); m.geometry = new THREE.CircleGeometry(1, 32, -half, 2 * half).rotateX(-Math.PI / 2); }
      m.visible = true; m.position.set(pp.x, .07, pp.z); m.rotation.y = Math.atan2(-S.dz, S.dx); m.scale.set(r, 1, r); m.material.color.copy(col);
    };
    switch (S.kind) {
      case 'projectile': strip(pp, S.dx, S.dz, S.G.speed ? S.G.range : SIM.projRange, Math.max(.3, (S.G.collision || 0) * 2)); break;
      case 'chain': case 'mark': { const d = near(cursor, SIM.snap); if (d) circle(d.pos, .7); break; }
      case 'nova': case 'warcry': circle(astral(S) ? c : pp, S.kind === 'nova' ? stageR(S) : S.A); break;
      case 'aura': case 'herald': if (S.R) circle(pp, S.R); break;
      case 'field': circle(pp, S.A); break;
      case 'meta': case 'minion': case 'buff': case 'chayula': case 'apocalypse': break;   // not aimed: Archon of Chayula's tornadoes come from you, Apocalypse's skills fall around enemies near you
      case 'strike': { const reach = strikeR(S), d = near(cursor, SIM.snap, e => dist(e.pos, pp) <= reach); if (d) circle(d.pos, S.R || .7); else sector(2, .95); break; }
      case 'sweep': case 'cone': sector(S.R || meleeR(S), coneHalf(S)); break;
      case 'beam': strip(pp, S.dx, S.dz, S.R || 10, 1); break;
      case 'wave': S.A > 3 ? strip(pp, S.dx, S.dz, S.A, 2.4) : strip(pp, S.dx, S.dz, Math.max(1, S.A * 2) * 6 + S.A, Math.max(.6, S.A * 2)); break;
      case 'wall': { const L = sh(S).wall || SIM.wall; strip({ x: c.x + S.dz * L / 2, z: c.z - S.dx * L / 2 }, -S.dz, S.dx, L, .6); break; }
      case 'storm': circle(c, P.wind ? S.A : stormGeo(S).Z); break;
      case 'slam': circle(c, stageR(S)); break;
      case 'totem': circle(c, P.ballista || P.ranged ? .6 : S.R || SIM.totemArea); break;
      case 'raise': circle(c, Math.max(S.A, SIM.snap)); break;
      case 'area': circle(S.R >= 6 ? pp : c, S.A); break;
      default: circle(c, S.A);
    }
  }

  // ---------- HUD text
  // Moving while using a skill: a skill with its "movement speed while performing" (most channelled ones: 70% less) lets
  // you move at that speed while you use it, the penalty raised by the tree's (all, fire, cold skills; Deadeye's more)
  // and its supports' more penalty (Mobility, Deliberation); any other stops you (null)
  const PERFORM = 'movement_speed_+%_final_while_performing_action';
  // Rhoa Mount: mounted, any skill lets you move, its penalty lowered by the gem's (and the tree's) reduced penalty
  const actMove = S => { const a = actMove0(S), R = me.mounted && onS('Rhoa Mount')?.dmg, k = 'rhoa_movement_speed_penalty_+%_final_while_performing_action';
    const pen = (R ? Math.max(0, 1 + ((R.stats?.[k] || 0) + (R.sum?.[k] || 0)) / 100) : 1) * (isCmd(S) ? Math.max(0, 1 - PUPPET.cmdMove * pup() / 100) : 1);   // Puppet Master: less command penalty
    return pen !== 1 ? 1 - (1 - (a ?? 0)) * pen : a; };
  function actMove0(S) {
    const st = S?.dmg?.stats || {}, f = S?.dmg?.finals || {}, P = st[PERFORM]; if (P == null) return null;
    const A = sheet().actMove || {}, more = ['support_mobility_movement_speed_penalty_+%_final_while_performing_action', 'support_deliberation_movement_speed_penalty_+%_final_while_performing_action']
      .reduce((m, k) => m * (1 + ((st[k] || 0) + (f[k] || 0)) / 100), 1 + (A.more || 0) / 100);
    if (S.kind === 'shield' && A.none) return 1;   // Feathered Fortress: no penalty while your Shield is raised
    const pen = -P * (1 + ((A.inc || 0) + (S.els?.includes('fire') ? A.fire || 0 : 0) + (S.els?.includes('cold') ? A.cold || 0 : 0) + (S.kind === 'shield' ? A.shield || 0 : 0)) / 100) * more;
    return Math.max(0, 1 - pen / 100);
  }
  // still performing the last skill: its use time (else the scene's action time); one without a movement speed while
  // performing it (movement_speed_+%_final_while_performing_action) roots you meanwhile (me.act null)
  const acting = () => time - castAt <= .3 || time < (me.actEnd ?? 0);
  let spdC = { at: -9, v: 0 };
  const spd = () => { if (time - spdC.at > .5) spdC = { at: time, v: api.playerSpeed(banner('movement_speed_+%') + (onsl() ? ONSLAUGHT.move : 0)
    + (sheet().moveWhile || []).reduce((t, w) => t + (!w.cv || meIs[w.cv]?.() ? w.val : 0), 0) + (me.tail || 0) * TAILWIND.move + (openWeak(topD) ? sheet().weakness.move : 0) + charges.frenzy * sheet().movePerFrenzy + (me.gamble || 0)) }; return spdC.v; };   // the tree's while you are in a state (calc.js MOVE_WHILE); Darkray Vectors: per Frenzy Charge
  function drawHud() {
    const gems = api.build().gems, names = gems.map(g => g.name);
    for (const k in tog) if (!names.includes(k)) untoggle(k);
    let free = sheet().spirit ?? Infinity;
    gems.forEach((g, i) => {
      if (!always(g)) return;
      if (g.enabled === false || !onSet(api.build(), g)) { untoggle(g.name); return; }   // turned off in the Skills tab, or of the other weapon set
      const r = api.reserve(g), fits = r <= free;
      if (fits) { free -= r; unpaid.delete(g.name); if (!tog[g.name]) { const S = mk(i); if (S) K.toggle(S); } }
      else if (!unpaid.has(g.name)) { unpaid.add(g.name); untoggle(g.name); say(t('{0} stays off: it reserves {1} Spirit and {2} is left', api.info(g).label, r, free), 'dust'); }
    });
    const list = slots(), at = barNow();
    if (!list.includes(sel)) sel = at.find(i => i >= 0) ?? list[0] ?? 0;
    put(bar, `<span class="s-belt">${flaskHtml(0)}${flaskHtml(1)}${[0, 1, 2].map(charmHtml).join('')}</span>` + (list.length ? at.map((i, k) => {
      if (i == null) return `<button class="s-slot none" data-k="${k}"><b>${keyLabel(k)}</b></button>`;
      if (i === MOVED) return `<button class="s-slot" data-k="${k}" title="${esc(t('Move'))}">${moveImg}<b>${keyLabel(k)}</b></button>`;
      const g = gems[i], inf = api.info(g), P = prof(g, inf), B = base(i), GN = gloryNeed(B), gl = GN && Math.floor(me.glory[g.name] || 0);
      const poor = B && me.maxM && !tog[g.name] && !sheet().flame && costOf(B).cost > me.mana;   // not enough mana for it: greyed, as in the game
      return `<button class="s-slot${i === sel ? ' on' : ''}${tog[g.name] ? ' act' : ''}${GN && gl < GN || poor ? ' dim' : ''}" data-k="${k}" data-i="${i}" style="--c:${css(P.el)}">${inf.icon ? `<img src="${esc(inf.icon)}" alt="" draggable="false" onerror="this.remove()">` : ''}<span>${esc(inf.label.slice(0, 3))}</span>${GN ? `<i class="gl" title="${esc(t('Glory'))}">${gl}/${Math.ceil(GN)}</i>` : ''}<b>${keyLabel(k)}</b></button>`;
    }).join('') : `<span class="note">${t(gems.length ? 'No skill of the build is used by hand: they are always on.' : 'Add skills in the Skills tab.')}</span>`));
    put(buffEl, effects()); put(badEl, ailing());
    put(logEl, logs.filter(l => time - l.at < 9).map(l => `<div style="--c:${l.c}"${time - l.at > 5 ? ' class="old"' : ''}>${esc(l.text)}${l.n > 1 ? ` ×${l.n}` : ''}</div>`).join(''));
    keysText(); clogHtml(); targetHtml();
    // your life and energy shield (the left orb, energy shield as its ring), mana and the Spirit left unreserved (the right
    // one, with Rage), as the game shows them
    const c = sheet(), rm = rageMax(), pct = (a, b) => (b > 0 ? clamp(a / b, 0, 1) * 100 : 0).toFixed(1), row = (k, a, b) => `<div><span>${k}</span><b>${a}/${b}</b></div>`;
    put(lifeEl, `<div class="s-vtxt">${me.known ? row(t('Life'), short(Math.max(0, Math.ceil(me.life))), short(me.maxL)) : `<div><span>${t('Life unknown: the class base life is missing in the data')}</span></div>`}`
      + `${me.maxE > 0 ? row(t('Shield'), short(Math.max(0, Math.ceil(me.es))), short(me.maxE)) : ''}${me.maxW > 0 ? row(t('Ward'), short(Math.max(0, Math.floor(me.ward))), short(me.maxW)) : ''}</div>`
      + `<div class="s-orb"><i style="height:${pct(me.life, me.maxL)}%"></i>${me.maxE > 0 ? `<u style="--p:${pct(me.es, me.maxE)}%"></u>` : ''}${me.maxW > 0 ? wardRune(pct(me.ward, me.maxW)) : ''}</div>`);
    put(manaEl, `<div class="s-vtxt">${me.maxM ? row(t('Mana'), short(Math.max(0, Math.floor(me.mana))), short(me.maxM)) : ''}${c.spirit ? row(t('Spirit'), short(Math.max(0, free)), short(c.spirit)) : ''}`
      + `${rm ? row(t('Rage'), short(Math.floor(me.rage)), short(rm)) : ''}</div><div class="s-orb"><i style="height:${pct(me.mana, me.maxM)}%"></i></div>`);
    if (!tipEl.hidden && tipEl.dataset.i != null) showTip(+tipEl.dataset.i);
  }
  // what the cursor over a skill of the bar shows: its kind and elements, area, projectiles, duration and what it consumes
  function tipOf(i) {
    const S = mk(i); if (!S) return '';
    const G = S.G, P = S.P, rows = [];
    const per = x => S.dmg.costPerSecond ? fmt(x, 1) + '/s' : short(x);
    if (S.dmg?.cost || S.dmg?.lifeCost) rows.push(`${t('Cost')} ${[S.dmg.cost && `${per(S.dmg.cost)} ${t('Mana')}`, S.dmg.lifeCost && `${per(S.dmg.lifeCost)} ${t('Life')}`].filter(Boolean).join(' · ')}`);
    if (S.R) rows.push(`${t('radius')} ${S.R.toFixed(2)} m`);
    else if (AREAL.has(S.kind) || S.kind === 'projectile' && S.aoe) rows.push(`${t('radius')} ${SIM.area.toFixed(2)} m (${t('simulated')})`);
    if (S.kind === 'projectile') rows.push(G.speed ? `${G.speed.toFixed(1)} m/s · ${t('range')} ${G.range.toFixed(1)} m` : `${SIM.projSpeed} m/s · ${t('range')} ${SIM.projRange} m (${t('simulated')})`);
    if (P.dur) rows.push(`${t('duration')} ${P.dur.toFixed(1)} s`);
    const notes = [...P.consumes.map(s => t('Consumes {0}', t(STATE[s]))), ...P.bonus.map(s => t('Payoff: {0}', t(STATE[s])))];
    if (P.corpse) notes.push(t('Needs a corpse'));
    P.spend.forEach(c => notes.push(t('Spends {0} charges', t(CHARGE[c]))));
    return `<b style="color:${css(S.el)}">${esc(S.label)}</b><span>${t(KIND[S.kind === 'field' ? 'aura' : S.kind] || S.kind)}${P.els.length ? ' · ' + P.els.map(e => t(cap(e))).join(' / ') : ''}</span>`
      + rows.map(r => `<span>${r}</span>`).join('') + (notes.length ? `<small>${notes.map(esc).join(' · ')}</small>` : '');
  }
  function showTip(i) {
    if (!pickEl.hidden) return;
    const slot = bar.querySelector(`[data-i="${i}"]`); if (!slot) { tipEl.hidden = true; return; }
    put(tipEl, tipOf(i)); tipEl.dataset.i = i; tipEl.hidden = false;
    const r = slot.getBoundingClientRect(), box = el.getBoundingClientRect(), w = tipEl.offsetWidth;
    tipEl.style.left = clamp(r.left - box.left + r.width / 2 - w / 2, 6, box.width - w - 6) + 'px';
    tipEl.style.bottom = (box.bottom - r.top + 8) + 'px';
  }
  bar.addEventListener('mouseover', e => { const b = e.target.closest('[data-i]'); if (b) showTip(+b.dataset.i); });
  bar.addEventListener('mouseleave', () => { tipEl.hidden = true; delete tipEl.dataset.i; });
  // your buffs as the game shows them, top left: its icon (the game's buff art, else the skill's), the count in its
  // corner, the seconds left under it, its name over it; a minion skill's, the life of its minions under it, as the game's
  // your Runic Ward on the life orb, as the game's HUD: its rune (orb_wardbg / orb_wardfill), lit from the bottom as far
  // as the ward is full. note: how the game lights a part-full rune is not in the data: bottom up as the orb's fill
  const wardRune = p => `<span class="s-ward"><img src="${esc(api.wardOrb?.('bg') || '')}" alt="" draggable="false" onerror="this.remove()"><img src="${esc(api.wardOrb?.('fill') || '')}" alt="" draggable="false" onerror="this.remove()" style="clip-path:inset(${(100 - p).toFixed(1)}% 0 0 0)"></span>`;
  const one = (img, c, title, n, s, bad, hp) =>`<span class="s-buff${bad ? ' bad' : ''}" style="--c:${c}" title="${esc(title)}">${img ? `<img src="${esc(img)}" alt="" draggable="false" onerror="this.remove()">` : `<i>${esc(title.slice(0, 2))}</i>`}${n ? `<em>${n}</em>` : ''}${hp != null ? `<b class="hp" style="--hp:${(hp * 100).toFixed(1)}%"></b>` : ''}${s != null ? `<small>${Math.ceil(s)}s</small>` : ''}</span>`;
  function effects() {
    const b = [], icon = n => { const g = gemBy(n), inf = g && api.info(g); return inf ? inf.buff || inf.icon : ''; };
    for (const c in charges) if (charges[c]) b.push(one(api.chargeIcon?.(c), css(CHC[c]), `${t(CHARGE[c])} ${charges[c]}/${maxC(c)}`, charges[c]));
    for (const e in me.inf) { const q = infNow(e), I = api.infusion?.(e); if (q.length) b.push(one(I?.icon, css(INF_C[e]), I?.name || e, q.length, q[0] - time)); }
    for (const k in tog) { const T = tog[k], Q = (T.objs || []).filter(o => !o.dead && o.segs).map(o => o.segs[0]); b.push(one(icon(k), css(T.el), T.kind === 'meta' ? `${T.label}: ${Math.floor(T.energy)}/${Math.ceil(T.need)}` : T.label, T.kind === 'meta' ? `${Math.floor(100 * T.energy / (T.need || 1))}%` : k === 'Trinity' ? ELEM.map(e => Math.floor(me.aff[e])).join('/') : k === 'Arctic Armour' ? Math.floor(me.arctic) : k === 'Wind Dancer' ? Math.floor(me.wind) : '', null, false, Q.length ? Q.reduce((t, q) => t + Math.max(0, q.life), 0) / Q.reduce((t, q) => t + q.max, 0) : null)); }   // a meta gem: its Energy as a % of its maximum, as the game shows it (the Energy itself in its tooltip); Trinity: its Affinity, fire / cold / lightning
    const sg = {}; for (const s of surges) if (s.until > time) (sg[s.name + s.el] ??= { s, n: 0 }).n++;
    for (const { s, n } of Object.values(sg)) { const I = api.info({ name: s.name }); b.push(one(I.icon, css(s.el), `${I.label}: ${t(s.el[0].toUpperCase() + s.el.slice(1))}`, n, s.until - time)); }
    if (sheet().owl) { const I = api.info({ name: 'Primal Bounty' }); b.push(one(I.icon, css('gold'), I.label, me.owls || 0)); }   // its Owl Feathers
    for (const E of empower) b.push(one(icon(E.name), css(E.el || 'gold'), E.label, E.uses > 1 ? E.uses : '', E.s));
    for (const B of buffs) b.push(one(B.img || icon(B.name), B.c, B.label, '', B.s));
    if (pup()) b.push(one(null, css('chaos'), t('Puppet Master'), me.pup.length, Math.max(...me.pup) - time));
    if (me.demon) b.push(one(icon(me.demon.name), css('fire'), me.demon.label, demon()));
    if (me.jade) b.push(one(icon('Encase in Jade'), css('cold'), t('Jade'), me.jade));
    if (me.boast) b.push(one(null, css('physical'), t("Runefather's Boast"), me.boast));
    if (souls()) b.push(one(null, css('chaos'), t('Soul Eater'), souls()));
    if (me.whisp) b.push(one(null, css('chaos'), t('Dark Whispers'), me.whisp.n, me.whisp.until - time));
    for (const [n, h] of Object.entries(me.hexes || {})) if (time < h.until) { const I = api.info({ name: n }); b.push(one(I?.icon, css('chaos'), I?.label || n, 0, isFinite(h.until) ? h.until - time : null, true)); }   // the curses on you
    if (time < me.finality) b.push(one(null, css('lightning'), t('Finality'), 0, me.finality - time));
    if (me.rhythm) b.push(one(null, css('fire'), t('Explosive Rhythm'), me.rhythm));
    if (time < me.fervour) b.push(one(null, css('fire'), t('Explosive Fervour'), 0, me.fervour - time));
    if (time < me.fear?.until) b.push(one(null, css('blood'), t('Fear Incarnate'), me.fear.n, me.fear.until - time));
    if (time < me.overEnc?.until) b.push(one(null, css('dust'), t('Overencumbered'), me.overEnc.n, me.overEnc.until - time, true));
    if (me.locust) b.push(one(icon("Queen's Procession"), css('physical'), t("Swarm's Advance"), me.locust));
    if (me.heat) b.push(`<span class="s-txt" style="--c:${css('fire')}">${t('Heat')} ${Math.floor(me.heat)}</span>`);
    if (seen()) b.push(one(icon('Future-Past'), css('gold'), api.info({ name: 'Future-Past' }).label));
    if (me.ghost >= 1) b.push(one(icon('Ghost Dance'), css('ice'), t('Ghost Shroud'), Math.floor(me.ghost)));
    if (me.aegis > 0) b.push(one(icon('Sorcery Ward'), css('arcane'), api.info({ name: 'Sorcery Ward' }).label, Math.round(me.aegis)));
    for (const u of me.cu) if (u) b.push(one(u.c.icon, css('gold'), u.c.name, '', u.s));
    if (charge) { const P = base(charge.i)?.P, k = Math.min(1, charge.s / (P?.perfect ? 1 : 1.6)); b.push(`<span class="s-txt" style="--c:${P?.perfect && Math.abs(charge.s - 1) < .2 ? '#fff' : css('gold')}">${t('Charging {0}%', Math.round(k * 100))}</span>`); }
    return b.join('');
  }
  // the ailments on you, under them with a red frame: the game's icon, its magnitude and the seconds left. A buildup (freeze,
  // electrocute) is that icon in grey filling up in colour from the bottom, its % under it
  const filling = (a, img, p) => `<span class="s-buff bad fill" title="${esc(t(STATE[a]))} ${Math.floor(p)}%"><img src="${esc(img)}" alt="" draggable="false">`
    + `<img src="${esc(img)}" alt="" draggable="false" style="clip-path:inset(${(100 - p).toFixed(1)}% 0 0 0)"><small>${Math.floor(p)}%</small></span>`;
  const ailing = () => Object.keys(me.st).filter(a => me.st[a] > 0 && a !== 'stun')
    .map(a => one(api.ailmentIcon?.(a), css(PIP[a]), t(STATE[a]) + (me.mag[a] ? ` ${Math.round(me.mag[a])}%` : ''), '', me.st[a], true)).join('')
    + Object.keys(me.bar).filter(a => me.bar[a] >= 1).map(a => filling(a, api.ailmentIcon?.(a), me.bar[a])).join('');
  function keysText() {
    const W = settings().input === 'wasd', mv = barNow().indexOf(MOVED);
    const text = [t('Movement speed: {0} m/s', spd().toFixed(2)), W ? t('W A S D: move') : mv < 0 ? t('Move is not on the bar: click a slot to put it there') : t('{0}: move to the cursor while held', slotName(slotKeys()[mv])),
      t('Mouse buttons and {0}: use their skill at the cursor (hold to repeat) · click a slot of the bar to change its skill', slotKeys().slice(3).map(keyName).join(' ')),
      t('Alt+drag: orbit · Wheel: zoom · {0}: roll', keyName(settings().keys.roll)),
      t('{0} / {1}: life and mana flask', keyName(settings().keys.lifeFlask), keyName(settings().keys.manaFlask)),
      t('{0}: corpse at the cursor · {1}: fill charges · {2}: refill life · {3}: reset', ...['corpse', 'charges', 'refill', 'reset'].map(k => keyName(settings().keys[k]))),
      !tpl.mon ? t('Pick an enemy in the Enemies panel to place it') : placing ? t('Click: place {0} · Esc: stop placing', tpl.mon.name) : t('Ctrl+click: place {0}', tpl.mon.name),
      t('Damage dealt: {0} · Kills: {1}', short(stats.dealt), stats.kills), t('Damage taken: {0} · Deaths: {1}', short(stats.taken), stats.deaths)].join('\n');
    if (hud.textContent !== text) hud.textContent = text;
  }

  // ---------- frame
  function tickDummy(d, dt) {
    const f = d.fig, st = d.st;
    if (d.visage) { if (time > d.until || d.visage.dead) { f.dispose(); dummies.splice(dummies.indexOf(d), 1); } return; }
    if (d.dead) {
      if (d.corpse > 0) {
        d.fall = Math.min(1, d.fall + dt * 3.5); f.upper.rotation.x = -1.42 * ease(d.fall); f.upper.rotation.z = 0;
        if ((d.corpse -= dt) <= 0) { d.back = 1; f.group.visible = false; fx.emit(10, { p: { x: d.pos.x, y: .2, z: d.pos.z }, r: .5, v: .5, up: 1, life: .7, size: .5, grow: 2, c: 'dust', smoke: true, a: .35 }); }
      } else if ((d.back -= dt) <= 0) revive(d);
      return;
    }
    if (st.pin > 0 && st.pin <= dt && d.unpin) { inflict(d, 'maim', d.unpin.S, 1, null, { dur: d.unpin.s }); d.unpin = null; }
    if (st.ignite > 0) d.ignSec = (d.ignSec || 0) + dt;   // the seconds it was ever Ignited
    const TX = 1 + curseFx(d, C => C?.expire) / 100;   // Temporal Chains: its other effects expire more slowly
    for (const k in st) if (st[k] > 0) st[k] -= dt * TX;
    for (const k in d.lock) d.lock[k] -= dt;
    for (const k in d.imm) d.imm[k] -= dt;
    for (let i = d.flam.length - 1; i >= 0; i--) if ((d.flam[i].s -= dt) <= 0) d.flam.splice(i, 1);
    // the bars empty after a while without buildup (monster.ot poise decay)
    if (d.focusMax > 0 && time - (d.focusAt ?? -99) > sheet().focus?.delay) d.focus = Math.min(d.focusMax, d.focus + d.focusMax * sheet().focus.decay / 100 / 60 * dt);   // drained Focus comes back after its delay
    if ((d.calm += dt) * 1000 > GAME.poise_decay_delay_ms) for (const k in d.bar) d.bar[k] = Math.max(0, d.bar[k] - GAME.poise_decay_per_second * dt);
    if (d.curse && (d.curse.s -= dt) <= 0) { const KC = d.curse.S?.dmg?.sum?.apply_unaffected_by_pacifying_curses_for_x_ms_on_curse_expiry; if (KC) d.noPac = time + KC / 1000; d.curse = d.hexes?.pop() || null; }   // Kalisa's Crescendo: not Pacified again for its time
    if (d.hexes?.length) d.hexes = d.hexes.filter(u => (u.s -= dt) > 0);
    if (d.mark && !(d.mark.hound && st.bleed > 0) && (d.mark.s -= dt) <= 0) {   // Bloodhound's Mark lasts while they bleed
      if (d.mark.hound) hmBreak(d); if (d.mark.bomb) markOff(d); else d.mark = null; }
    for (let i = d.dots.length - 1; i >= 0; i--) if ((d.dots[i].s -= dt) <= 0) d.dots.splice(i, 1);
    if (d.pustule) pustule(d, dt);
    if (d.spectral && time >= d.spectral.until) spectralBlow(d);
    if ((d.tick -= dt) <= 0) {   // damage over time: ignite, poison, bleeding and the skills' own, one number per tick
      d.tick = .5; let n = 0, past = 0, sim = false, el = 'chaos', best = 0;
      const VD = 1 + (sheet().volDot || 0) * (me.vol || 0) / 100;   // increased chaos damage over time per Volatility on you. note: as more here
      const add = (v, noEs) => { const k = v.dps * (v.agg ? AGGRAVATED : 1) * tookInc(d) * (v.el === 'chaos' ? VD : 1); n += k; if (noEs) past += k; sim ||= v.sim; if (v.dps > best) { best = v.dps; el = v.el; } };
      // bleeding deals its extra damage while the enemy moves, as aggravated (keywords.json Bleeding): moved since the last tick
      const mov = d.lastAt && dist(d.pos, d.lastAt) > .05; d.lastAt = { x: d.pos.x, z: d.pos.z };
      for (const a in AIL_DOT) if (st[a] > 0 && d.burn[a]) {
        if (a === 'ignite' && d.spectral) d.spectral.n += (d.burn[a].raw ?? d.burn[a].dps) * (d.burn[a].agg ? AGGRAVATED : 1) * .5;   // Spectral Fire: fed instead (before the enemy's resistance: the explosion's targets')
        else add(a === 'bleed' && mov ? { ...d.burn[a], agg: true } : d.burn[a], a !== 'ignite'); }
      if (d.burn2?.until > time) add(d.burn2.v, true); for (const p of d.burnX || []) if (p.until > time) add(p.v, true);   // a second poison (Overwhelming Toxicity)
      if (st.shock > 0 && st.ignite > 0 && d.stormfire && d.burn.ignite?.raw) add({ dps: defence(d, 'lightning', d.burn.ignite.raw * d.stormfire / 100, false), el: 'lightning' });   // Stormfire: its share of the ignite as lightning too
      if (st.poison > 0 && d.burn.poison) plagueStore(d.burn.poison.dps * shocked(d) * .5);
      const HM = d.mark?.hound; if (HM && st.bleed > 0 && d.burn.bleed) build(d, 'stun', d.burn.bleed.dps * .5 * HM.dmg.stats['hunters_mark_%_of_phys_damage_over_time_as_build_up'] / 100, HM, {});
      d.dots.forEach(v => add(v));
      d.blood = (d.blood || 0) + ((st.bleed > 0 && d.burn.bleed?.dps || 0) + d.dots.reduce((t, v) => t + (v.el === 'physical' ? v.dps : 0), 0)) * shocked(d) * .5;   // Blood Loss
      if (n > 0) {
        const fl = d.flash; floatN(d, n * .5, el, { sim, low: true });
        damage(d, past * .5, d.by || NONE, true, true); if (!d.dead) damage(d, (n - past) * .5, d.by || NONE, true); d.flash = fl; if (d.dead) return;
      }
    }
    d.flash = Math.max(0, d.flash - dt); d.wob = Math.max(0, d.wob - dt * 2.2);
    const frozen = st.freeze > 0, ct = d.dots.some(v => v.spread), e = f.sack.emissive, xd = d.dots.some(v => v.el !== 'physical'), pd = d.dots.length && !xd;   // a physical one (Corrupted Blood) has nothing on the body in the game (BuffVisuals corrupted_blood): its blood as Bleeding's
    if (!frozen) { let a = Math.atan2(pp.x - d.pos.x, pp.z - d.pos.z) - f.group.rotation.y; a = Math.atan2(Math.sin(a), Math.cos(a)); f.group.rotation.y += a * Math.min(1, dt * 5); }   // they watch you
    d.lunge = Math.max(0, d.lunge - dt * 3.2);
    f.upper.rotation.x = frozen ? 0 : Math.sin(time * 22 + d.ph) * d.wob * .16 + Math.sin(d.lunge * Math.PI) * .42; f.upper.rotation.z = frozen ? 0 : Math.cos(time * 17 + d.ph) * d.wob * .1;
    // over its head: its Mark's rune, else its curse's symbol (one with its own look: no ring under it then)
    const MR = d.mark && MARK_RUNE[d.mark.name], CK = d.curse && CURSE_LOOK[d.curse.name], CL = !MR && CK, RN = MR ? [artTex('rune_' + MR[0], `particles/curses_02/marks/mark_runes/${MR[0]}`), MR[1]] : CL ? [curseTex(CL.rune), CL.sym ?? CL.orb] : null;
    f.ice.visible = frozen; f.curse.visible = !!d.curse && !CK; f.mark.visible = !!d.mark && !MR; f.rune.visible = !!RN;
    if (RN) { const m = f.rune.material, T = fx.T[RN[0]]; if (m.map !== T) { m.map = T; m.color.set(RN[1]).multiplyScalar(2.5); m.needsUpdate = true; } m.opacity = .8 + Math.sin(time * 4) * .2; }
    if (d.curse) f.curse.rotation.y += dt * .8;
    if (d.mark) { f.mark.rotation.y += dt * 2.5; f.mark.scale.setScalar(1 + Math.sin(time * 5) * .08); }
    const nb = Math.min(10, d.dots.reduce((n, v) => n + (v.el === 'physical' ? v.stacks || 1 : 0), 0)); f.blood.visible = nb > 0;   // Corrupted Blood's orbs, one a debuff
    f.blood.children.forEach((o, i) => { const a = time * 1.6 + i / nb * Math.PI * 2; o.visible = i < nb; o.position.set(Math.cos(a) * .45, Math.sin(time * 3 + i) * .05, Math.sin(a) * .45); });
    if (d.flash > 0) e.setRGB(.9, .3, .2).multiplyScalar(d.flash / .18);
    else if (st.ignite > 0) e.setRGB(.45, .13, 0); else if (st.shock > 0) e.setRGB(.12, .15, .4); else if (ct) e.setRGB(...CONTAGION.skin); else if (st.poison > 0 || xd) e.setRGB(.1, .28, .04);
    else if (st.chill > 0) e.setRGB(.05, .2, .35); else if (d.boils > 0) e.setRGB(...BOIL.skin).multiplyScalar(Math.min(1, .4 + d.boils * .15)); else e.setRGB(0, 0, 0);
    const p = { x: d.pos.x, y: .9 * d.sc, z: d.pos.z };
    cullSoul(d, dt);
    if (st.ignite > 0 && Math.random() < dt * 22) fx.emit(1, { p, r: .25, h: .8, v: .2, up: 1.8, life: .5, size: .32, c: 'fire', c2: 'ember' });
    if (st.shock > 0 && Math.random() < dt * 9) fx.emit(2, { p, r: .3, h: 1, v: 1.6, life: .18, size: .13, c: 'lightning', c2: 'white', k: 3 });
    if (st.poison > 0 && Math.random() < dt * 8) fx.emit(1, { p, r: .3, h: .8, v: .1, up: .8, life: .9, size: .16, c: 'poison' });
    if (ct && Math.random() < dt * 3) fx.emit(1, { p, r: .3, h: .8, v: .1, up: .2, life: rnd(3, 4), size: .18, c: CONTAGION.wisp, k: 1.6, drag: 1 });   // Contagion's oozing wisps
    if ((st.bleed > 0 || pd) && Math.random() < dt * 8) fx.emit(1, { p, r: .25, h: .6, v: .3, life: .6, size: .1, c: 'blood', g: 9, k: 1.2 });
    if ((st.chill > 0 || frozen) && Math.random() < dt * 6) fx.emit(1, { p, r: .4, h: 1.2, v: .1, up: -.3, life: 1, size: .12, c: 'ice' });
    if (xd && Math.random() < dt * 9) fx.emit(1, { p, r: .3, h: 1, v: .2, up: .7, life: .8, size: .2, c: 'chaos' });
    const top = d === topD, loss = (d.blood || 0) / d.max, sig = top ? 'top' : Math.ceil(d.life / d.max * 48) + ':' + (d.maxEs ? Math.ceil(d.es / d.maxEs * 48) : '') + ':' + Math.ceil(loss * 48);
    if (sig !== d.sig) { d.sig = sig; f.draw(top ? {} : { life: d.life / d.max, es: d.maxEs ? d.es / d.maxEs : null, loss }); }
  }

  // ---------- the enemies attack: the chosen attack at their level against your defences (enemies.js)
  // From the game: the damage per type, the crit chance and the seconds between uses of the attack, and your evasion, block, armour,
  // resistances, life regeneration and energy shield recharge; the projectile's speed and the area's radius where the tables have them.
  // Fixed by the scene: the wind-up, the reach, and how each shape
  // (strike, slam, projectile, area, bolt) is drawn. Enemies walk at you at their MovementSpeed (MonsterVarieties, in the
  // units of your own speed) once you come within their aggro range (MaxAgroRange) or hit them, until you are in their reach;
  // not while pinned or winding up, slowed by chill and curses as everything they do. Reset puts them back where they were placed.
  const REACH = { projectile: 14, area: 11, bolt: 11 };
  const reachOf = d => REACH[d.atk.shape] || Math.max(d.atk.reach + .8, 2.2) * d.sc;
  const above = () => ({ x: pp.x, y: 2.5, z: pp.z });
  const GREY = '#c8c0b0';
  function clogHtml() {
    if (clogEl.hidden) return;
    const tot = Object.values(byS).reduce((a, b) => a + b.n, 0) || 1, xN = l => l.x > 1 ? ` (×${l.x})` : '', line = l => l.k === 'hit' ? `${esc(l.src)} → ${esc(l.tgt)}: <b>${short(l.n)}</b>${xN(l)}`
      : l.k === 'kill' ? esc(t('{0} kills {1}', l.src, l.tgt)) : l.k === 'taken' ? `${esc(l.src)} → ${esc(t('You'))}: <b>−${short(l.n)}</b>${xN(l)}` : `${esc(l.src)}: ${esc(l.tgt)}`;
    put(clogEl, `<b>${t('Combat log')}</b> <button class="s-clr" data-clear>${t('Reset')}</button><table>`
      + Object.entries(byS).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${short(v.n)}</td><td>${v.x}×</td><td>${(v.n / tot * 100).toFixed(1)}%</td></tr>`).join('')
      + `</table><p>${t('Damage taken: {0} · Deaths: {1}', short(stats.taken), stats.deaths)}</p>`
      + clog.slice(-60).reverse().map(l => `<div style="--c:${l.c}"><small>${l.at.toFixed(1)}s</small> ${line(l)}</div>`).join(''));
  }
  // the top bar's name colour by rarity
  const RARE = { normal: '#c8c8c8', magic: '#8888ff', rare: '#ffff77', unique: '#af6025' };
  // the enemy whose bar shows at the top, as in the game: a boss in the fight first, else the one under the cursor, else
  // the last one hit (name, life, shield); its own small bar above it is hidden
  function targetHtml() {
    const boss = dummies.find(e => !e.dead && !e.visage && e.mon.boss && e.aggro);
    const d = topD = boss || (hover && !hover.dead ? hover : lastHit && !lastHit.dead ? lastHit : null);
    tgtEl.hidden = !d; if (!d) return;
    const p = (a, b) => (b > 0 ? clamp(a / b, 0, 1) * 100 : 0).toFixed(1);
    // its states as the game's icons under its bar (BuffDefinitions' icons, skills.json ailment_icons): its ailments, an
    // Exposure, its Armour Break building up or its armour Fully Broken
    const st = ['ignite', 'chill', 'freeze', 'shock', 'electrocute', 'poison', 'bleed', 'maim', 'blind'].filter(a => d.st[a] > 0);
    if (d.st.expo > 0 && d.expo) st.push(d.expo.els.length === 1 && ['fire', 'cold', 'lightning'].includes(d.expo.els[0]) ? 'expo_' + d.expo.els[0] : 'expo');
    if (d.st.armour > 0) st.push('armour'); else if (d.cut > 0) st.push('armourBreak');
    const icons = st.map(a => api.ailmentIcon?.(a)).filter(Boolean).map(s => `<img src="${esc(s)}">`).join('');
    put(tgtEl, `<div style="color:${RARE[d.stat.rarity] || RARE.normal}">${esc(d.mon.name)}</div><div class="s-tbar"><i style="width:${p(d.life, d.max)}%"></i>${d.blood > 0 ? `<b style="left:${p(d.life, d.max)}%;width:${p(Math.min(d.blood, d.max - d.life), d.max)}%"></b>` : ''}${d.maxEs > 0 ? `<u style="width:${p(d.es, d.maxEs)}%"></u>` : ''}<span>${short(Math.ceil(d.life + d.es))}/${short(d.max + d.maxEs)}</span></div>${icons ? `<div class="s-ticons">${icons}</div>` : ''}<small>${t('Lv. {0}', d.level)}</small>`);
  }
  // Infernalist's Pyromantic Pact: a mana cost adds its share as Infernal Flame instead (up to your maximum mana); at the
  // most you take its share of your maximum life and energy shield as fire damage and lose its share of the Flame
  // as your energy shield recharge begins: Elemental Archon, when not on its delay (Archon of the Blizzard). -> the time
  const recharging = () => { const EA = sheet().earch; if (EA?.recharge && !(time < me.earch) && time >= (me.earch ?? -99) + EA.delay) earchGo(EA); return time; };
  function earchGo(EA) { me.earch = time + EA.time; buffs.push({ label: t('Elemental Archon'), c: css('fire'), s: EA.time, earch: true }); say(t('{0} active', t('Elemental Archon')), 'fire'); }
  // Indigon: per 200 mana Spent Recently, increased Spell damage and increased Cost of Skills (note: the cost's as more)
  function spent200() { const L = me.manaLog || []; while (L.length && time - L[0][0] > RECENT) L.shift(); return Math.floor(L.reduce((t, x) => t + x[1], 0) / 200); }
  function payMana(n) {
    if (n > 0 && (sheet().uDef?.indigon || sheet().uDef?.indigonCost)) (me.manaLog ||= []).push([time, n]);
    const MH = sheet().uDef?.manaHurt; if (MH && n > 0) hurt(n * MH / 100, 0, 'physical');   // Scold's Bridle
    const EA = sheet().earch; if (EA?.mana && me.maxM > 0 && (me.spent = (me.spent || 0) + n) >= me.maxM && !(time < me.earch) && time >= (me.earch ?? -99) + EA.delay) { me.spent = 0; earchGo(EA); }   // Elemental Archon after spending your maximum mana
    me.spentM = (me.spentM || 0) + n;   // the mana spent (Melting Maelstrom)
    const F = sheet().flame; if (!F) { me.mana -= n; return; }
    me.flame = (me.flame || 0) + n * F.ratio / 100;
    if (me.maxM > 0 && me.flame >= me.maxM) { if (sheet().earch?.full) me.earch = Math.min(me.earch || 0, time); me.flame -= me.maxM * F.lose / 100; hurt((me.maxL + me.maxE) * F.hit / 100, 0, 'fire', false, null); }
  }
  function hurt(n, chaos, el, crit, d, hit = false, noEs = false) {
    if (!(n > 0)) return;
    if (noEs && sheet().uDef?.dotEs) noEs = false;   // Decree of Loyalty: damage over time cannot bypass your energy shield
    if (hit) player.flinch(Math.min(1, .3 + 4 * n / (me.maxL || 1)));
    if (time < me.helb?.until) me.helb.n += n;   // Helbrym's Composure stores the damage taken
    // Unyielding (attacks), Unbending (spells): a share of the damage taken while you use it Recouped, per 250 ms of its use time
    if (time < me.use?.until) { const A = me.use.S, U = A.dmg?.sum || {}, RT = sheet().recoup?.time || 8;
      for (const [r, w, ok] of [['life', 'damage_taken_%_recouped_as_life_while_performing_attack_per_250_ms_attack_time', A.P?.attack], ['mana', 'damage_taken_%_recouped_as_mana_while_performing_spell_per_250_ms_cast_time', A.P?.spell]])
        if (ok && U[w]) { const x = n * U[w] * me.use.k / 100; me.recoup.push({ k: r, left: x, rate: x / RT }); } }
    if (me.st.shock > 0) { const k = 1 + me.mag.shock / 100; n *= k; chaos *= k; }   // shocked, you take more damage
    if (hit && sheet().regrow?.lose) me.regrow = 0;   // Dustbloom: all Fragile Regrowth lost when hit
    if (hit && sheet().tailwind?.lose) me.tail = 0;   // Gathering Winds: all Tailwind lost when hit
    stats.taken += n; me.hurt = time; if (sheet().gambleMove) me.gamble = Math.random() * sheet().gambleMove; if (!(sheet().esKeep && time - (me.esRech ?? -99) <= RECENT) && !(time < me.conv)) me.esHurt = time, me.esRech = null, me.esEarly = 0; if (held && base(held.i)?.kind === 'meditate') held = null; shake = Math.min(.45, shake + .1); gainRage((sheet().rage?.gain.hurt || 0) + (hit ? flaskOn('rageHit') : 0));   // Blood of the Warrior: Rage when Hit during its effect
    const c = el === 'physical' ? 'blood' : el; record('taken', d?.mon.name || '?', '', n, css(c));
    if (Math.round(n) >= 1) fx.num({ x: pp.x + rnd(-.2, .2), y: 2.2, z: pp.z }, '−' + short(n) + (crit ? '!' : ''), css(c), crit ? .62 : .46, !!crit);
    fx.emit(6, { p: { x: pp.x, y: 1.1, z: pp.z }, v: 2.2, up: 1, life: .3, size: .12, c, c2: 'white', drag: 2 });
    if (!me.known) return;   // without the class base life there is no pool to empty: the numbers still show what gets through
    if (me.guard > 0) { const g = Math.min(me.guard, n), k = 1 - g / n; me.guard -= g; n *= k; chaos *= k; }   // a charm's guard takes it before anything
    // Loyalty: its share of a hit's damage taken from the life of the Companion of the skill it supports, before you
    const LY = d && objs.find(o => o.loyal && !o.dead && o.segs[0].life > 0);
    // Warbringer's Wooden Wall: its share taken from the life of your nearest totem, before you
    const TW = sheet().totemWall, TT = TW && objs.filter(o => o.totemOf && !o.dead && o.segs?.[0].life > 0).sort((a, b) => dist(a.pos, pp) - dist(b.pos, pp))[0];
    for (const [o, p] of [[LY, LY?.loyal], [TT, TW]]) if (o) { const k = p / 100; o.segs[0].hurt(n * k); if (o.recoupLoyal) me.recoup.push({ k: 'life', left: n * k * o.recoupLoyal / 100, rate: n * k * o.recoupLoyal / 100 / (sheet().recoup?.time || 8) }); n *= 1 - k; chaos *= 1 - k; }   // Romira's Requital: its % of what the companion takes Recouped as your life
    // Darkness: the damage is reserved from what is left of it before energy shield and life, each part back after its time
    const DK = sheet().darkness; if (DK) { me.dark = (me.dark || []).filter(u => u.until > time); const k = Math.min(n, DK - me.dark.reduce((t, u) => t + u.v, 0)); if (k > 0) { me.dark.push({ v: k, until: time + sheet().darkFor }); chaos *= 1 - k / n; n -= k; } }
    // energy shield takes the damage first; chaos damage removes twice as much of it
    const BY = hit && me.es < me.maxE / 2 ? (sheet().uDef?.bypass || 0) / 100 : 0;   // The Unleashed: that share of the hit bypasses energy shield below half of it
    // noEs: bypassing energy shield (bleeding, The Black Doubt's damage over time)
    const other = (n - chaos) * (1 - BY), es0 = me.es; let e = noEs ? 0 : Math.min(me.es, other), left = other - e + (n - chaos) * BY; me.es -= e;
    e = noEs ? 0 : Math.min(me.es, chaos * 2); me.es -= e; left += chaos - e / 2;
    // Barkskin: the energy shield enemy hits take gives its share as armour for its duration, stacking
    if (d && es0 > me.es) event('eshit', pp, NONE, null, es0 - me.es);   // Barrier Invocation
    const BK = d && es0 > me.es && onS('Barkskin');
    if (BK) me.bark.push({ until: time + durOf(BK), v: (es0 - me.es) * BK.dmg.stats['barkskin_armour_to_gain_as_%_of_energy_shield_lost_to_enemy_hits'] / 100 });
    // Oracle's Harmony Within: from mana before life while mana is higher than life; Mind Over Matter: always
    if ((sheet().manaFirst && me.mana > me.life || sheet().mom) && me.mana > 0) { const m = Math.min(me.mana, left); me.mana -= m; left -= m; }
    // Blood Mage's Grasping Wounds: its share of the life a hit takes is lost over 4 seconds instead
    const GW = hit && sheet().wounds; if (GW && left > 0) { me.wounds.push({ rate: left * GW / 400, until: time + 4 }); left *= 1 - GW / 100; }
    // Amanamu's Defiance (Undying Hate's keystone): its share of the life a hit takes is prevented, then that times its loss is lost over 4 seconds
    const AD = hit && sheet().amanamu; if (AD && left > 0) { const p = left * AD.prevent / 100; me.wounds.push({ rate: p * AD.lose / 400, until: time + 4 }); left -= p; }
    const life0 = me.life; if (!(sheet().eternal && es0 > 0)) me.life -= left;   // Lich's Eternal Life: life cannot change while you have energy shield
    // Runic Ward (keywords.json): damage that would take your life to 0 leaves you at 1, the ward taking the rest
    if (me.life < 1 && me.ward >= 1 - me.life) { spendWard(1 - me.life); me.life = 1; }
    if (me.life < 1 && time < me.sight) me.life = 1;   // Future-Past's Sight Beyond Sight
    if (me.life <= 0 && hit && Math.random() * 100 < (sheet().avoidDeath || 0)) me.life = 1;   // the tree's chance to Avoid Death from Hits
    if (sheet().widowFor && me.life < life0) { me.widow += life0 - me.life; me.widowAt = time; }   // Widow's Reign: the life the damage took is reserved (vitals)
    if (me.life <= 0) died(d?.mon.name || '?');
  }
  // The attack of the enemy d reaches you: evade (its accuracy against your evasion), block, crit, then armour and resistances
  // Thorns (keywords.json): a melee attack that hits you is dealt your thorns back, a Hit of yours (calc.js character
  // thorns: its damage, crit, the build's ailments), with the cold thorns Nature's Exchange adds (by your thorns increases).
  // Quill Burst: after you retaliate, the supported skill's next hits (its count) burst for your thorns around the target.
  // Morrigan's Insight: the supported skill's hit on a frozen enemy consumes the freeze for Nature's Exchange (its cooldown):
  // its Guard and cold thorns for its duration
  const THORN_P = profile({ name: 'Thorns', tags: ['physical'] }, {});
  // Scavenged Plating: while on, fully breaking an enemy's armour grants stacks by its rarity (its text: 1, 2, 5, 10)
  // for its duration; each stack is its more armour and its physical thorns
  const PLATES = { normal: 1, magic: 2, rare: 5, unique: 10 }, plating = () => onS('Scavenged Plating')?.dmg.stats;
  const plates = () => (me.plates = (me.plates || []).filter(p => p.until > time)).reduce((n, p) => n + p.n, 0);
  function scavenge(d) { const S = onS('Scavenged Plating'); if (S) { (me.plates ||= []).push({ n: PLATES[d.stat.rarity] || 1, until: time + durOf(S) }); say(`${S.label}: ${plates()}`, 'dust'); } }
  function thornsOf() {
    const T = sheet().thorns || { hits: {} }, N = buffs.find(b => b.thorns), hits = { ...T.hits }, SP = plating(), n = SP && plates();
    if (N) hits.cold = N.thorns.map((x, k) => x * (T.thornsX || 1) + (T.hits.cold?.[k] || 0));
    if (T.life?.[1]) hits.physical = [0, 1].map(k => (hits.physical?.[k] || 0) + me.maxL * T.life[k] / 100 * (T.thornsX || 1));   // a share of maximum life (mana) as physical (cold) thorns
    if (T.manaCold) hits.cold = [0, 1].map(k => (hits.cold?.[k] || 0) + me.maxM * T.manaCold / 100 * (T.thornsX || 1));
    if (T.lifeShift && shifted()) hits.physical = [0, 1].map(k => (hits.physical?.[k] || 0) + me.maxL * T.lifeShift / 100 * (T.thornsX || 1));   // the tree's physical thorns from your life while Shapeshifted
    if (me.runes && T.perRune?.[1]) hits.physical = [0, 1].map(k => (hits.physical?.[k] || 0) + me.runes * T.perRune[k] * (T.thornsX || 1));   // Serle's Grit: per Runic Plate of Runic Tempering
    if (n) hits.physical = [0, 1].map(k => (hits.physical?.[k] || 0) + n * SP[k ? 'scavenged_plating_thorns_maximum_physical_damage' : 'scavenged_plating_thorns_minimum_physical_damage'] * (T.thornsX || 1));
    // Crackling Barrier: while you channel the skill it supports, its share of your maximum mana as lightning thorns
    const ci = held?.i ?? charge?.i, cb = ci != null ? base(ci) : null, CB = cb?.P.channel && cb.dmg?.sum?.['return_%_of_maximum_mana_as_lightning_damage_to_attacker_while_channelling'];
    if (CB) { const x = me.maxM * CB / 100 * (T.thornsX || 1); hits.lightning = [0, 1].map(k => (hits.lightning?.[k] || 0) + x); }
    return Object.values(hits).some(([, hi]) => hi > 0) ? { ...T, hits } : null;
  }
  // the Guiding Palms' Guided Shrines (Shrines.dat UniqueGuidingPalm*Shrine, monsters.json): a Daemon of yours that marks an
  // enemy within its aggro range every its marking skill's time (cooldown) and strikes it with its damaging skill, at your
  // level. note: it strikes from you (it is not drawn following you) and its skills' ailment chances are not played
  const DAEMON = { fire: ['Fire', 'GTShrineFirePlayer', 'GSShrineFirePlayer'], cold: ['Cold', 'GTShrineColdPlayer', 'MPSShrineColdPlayer'], lightning: ['Lightning', 'GTShrineLightningPlayer', 'GSShrineLightningPlayer'] };
  function daemons() {
    for (const el of sheet().daemons || []) {
      const [n, mark, key] = DAEMON[el], m = enemy(`Metadata/Monsters/Daemon/Shrines/Shrine${n}DaemonPlayer`), G = monSkill(mark); if (!m || !G) continue;
      if (time - (me.daemonAt?.[el] ?? -99) < Math.max(G.cast || 1, (G.cooldown || 0) / (G.uses || 1))) continue;
      const d = near(pp, (m.aggro || 105) / 10); if (!d) continue;
      (me.daemonAt ||= {})[el] = time; const a = attackOf(m, sheet().level || 1, key, 'normal', true), X = { ...thornX({ hits: a.hits, crit: a.crit }, m.name), name: 'Daemon' };
      later(.3, () => a.area ? area(d.pos, X.A, X, { noPay: true, noTouch: true }) : hit(d, X, { noPay: true }));
      fx.ring(d.pos, .2, X.A, el, .4);
    }
  }
  const thornX = (D, label) => { const els = Object.keys(D.hits).filter(e => D.hits[e][1] > 0); return { name: 'Thorns', label, P: THORN_P, G: {}, A: SIM.area, dmg: { attack: false, dot: {}, trig: [], ...D }, src: 'thorns', el: els.find(e => e !== 'physical') || els[0], els, ail: [], mult: 1, gm: 1, spent: 0 }; };
  // Arctic Armour: while on, a stage every its interval you stand still, up to its most; a melee hit you take removes one
  // for a burst of ice at the attacker, its cold damage per stage the barrier had
  // note: that damage as the gem gives it, without your spell modifiers
  const onS = n => { const i = tog[n] ? byName(n) : -1; return i >= 0 ? base(i) : null; }, arcticS = () => onS('Arctic Armour');
  // Wind Dancer: while on, a stage every its interval up to its most, its more evasion each; a hit you take consumes them
  // all for its burst around you, its more damage and area per stage
  function windDance() {
    const S = onS('Wind Dancer'), n = Math.floor(me.wind); if (!S || !n) return;
    const st = S.dmg.stats; me.wind = 0;
    boom({ x: pp.x, z: pp.z }, S.A * Math.sqrt(1 + st['wind_dancer_area_of_effect_+%_final_per_stage'] * n / 100), { ...S, mult: S.mult * (1 + st['wind_dancer_damage_+%_final_per_stage'] * n / 100) });
  }
  // Its look (cold_arcticarmour: arcticBarrier.pet, armorSurge.ao): a ring of small glassy ice shards around you at
  // chest height (its wispy ring's radius 0.9 m and height 1.25 m), fuller with each stage (the barrier's 512 shards at
  // its most; note: how many each stage shows is not in the data, an even share here), frost powder drifting off it (0.94 / 0.96 / 1) and a wispy ring of mist round you (0.85 / 0.9 / 1, its glow
  // 0.49 / 0.72 / 1); a stage lost sends its shards falling to the ground (FallingState) with a glow where you were hit
  // (HitGlow) and a surge of two trails to the attacker (surgeTrail 0.59 / 0.62 / 0.71), bursting in ice on it
  const ARCTIC = { shard: 0xd8e2ea, powder: 0xeff5ff, wisp: 0xd9e6ff, glow: 0x7db8ff, trail: 0x979eb5 };
  const shell = (() => {
    const g = new THREE.Group(), N = 512, m = new THREE.InstancedMesh(new THREE.TetrahedronGeometry(.022, 0).scale(1, 1.4, .6),
      new THREE.MeshStandardMaterial({ color: ARCTIC.shard, emissive: ARCTIC.glow, emissiveIntensity: .25, roughness: .05, metalness: .2, transparent: true, opacity: .55, depthWrite: false }), N);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), E = new THREE.Euler(), S1 = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < N; i++) {   // scattered through a ring round you, each turned any way (i / N round it: an even fill)
      const a = i * 2.39996 + rnd(.3), r = .9 + rnd(-.22, .22) * (1 - Math.abs(rnd(-1, 1)) * .5);
      P.set(Math.cos(a) * r, 1.1 + rnd(-.3, .3) * (1 - Math.abs(r - .9) / .3), Math.sin(a) * r);
      m.setMatrixAt(i, M.compose(P, Q.setFromEuler(E.set(rnd(TAU), rnd(TAU), rnd(TAU))), S1.setScalar(rnd(.6, 1.4))));
    }
    m.count = 0; m.frustumCulled = false; g.add(m); scene.add(g); return { g, m, N };
  })();
  function arcticLook(dt) {
    const AA = arcticS()?.dmg.stats, n = AA ? Math.floor(me.arctic) : 0, k = n ? Math.round(shell.N * n / AA.maximum_number_of_arctic_armour_stationary_stacks) : 0;
    shell.m.count = k; shell.g.visible = !!AA; if (!AA) return;
    shell.g.position.set(pp.x, 0, pp.z); shell.g.rotation.y += dt * .25;
    if (k && Math.random() < .4 + k / 300) { const a = rnd(TAU), y = rnd(.85, 1.35); fx.emit(1, { p: { x: pp.x + Math.cos(a) * .9, y, z: pp.z + Math.sin(a) * .9 }, r: .15, v: .1, up: -.05, life: 1.8, size: .05, c: ARCTIC.powder, k: .9, drag: 1 }); }   // the powder glinting in the ring
    if (Math.random() < .5) { const a = time * 1.3 + rnd(TAU); fx.emit(1, { p: { x: pp.x + Math.cos(a) * .9, y: rnd(.5, 1.25), z: pp.z + Math.sin(a) * .9 }, dir: V(-Math.sin(a) * .5, .05, Math.cos(a) * .5), life: 1, size: .45, grow: 1.4, c: ARCTIC.wisp, c2: ARCTIC.wisp, k: .22, drag: .5 }); }
  }
  function arctic(d) {
    const S = arcticS(), n = Math.floor(me.arctic); if (!S || !n || d.dead) return;
    const st = S.dmg.stats; me.arctic--;
    const lost = Math.min(40, Math.round(shell.N / st.maximum_number_of_arctic_armour_stationary_stacks));
    for (let i = 0; i < lost; i++) { const a = rnd(TAU); fx.emit(1, { p: { x: pp.x + Math.cos(a) * .9, y: rnd(.85, 1.35), z: pp.z + Math.sin(a) * .9 }, r: .15, v: 1, up: .5, life: .8, size: .04, c: ARCTIC.shard, c2: 'white', k: 1.1, g: 9 }); }   // its shards falling out of the ring
    fx.glow({ x: pp.x + (d.pos.x - pp.x) * .2, y: 1.2, z: pp.z + (d.pos.z - pp.z) * .2 }, 1, ARCTIC.glow, .25, 1.3);
    for (const s of [-1, 1]) { const o = V(-(d.pos.z - pp.z), 0, d.pos.x - pp.x).setLength(.25 * s); fx.bolt(V(pp.x + o.x, 1.2, pp.z + o.z), V(d.pos.x, 1, d.pos.z), ARCTIC.trail, .3, .025, .2); }
    fx.emit(10, { p: { x: d.pos.x, y: 1, z: d.pos.z }, r: .3, v: 2.5, up: 1, life: .5, size: .12, c: ARCTIC.shard, c2: 'white', k: 2, g: 6 });
    hit(d, { ...S, dmg: { ...S.dmg, hits: { cold: [st.arctic_armour_minimum_added_cold_damage_per_stack * n, st.arctic_armour_maximum_added_cold_damage_per_stack * n] } } }, { noPay: true });
  }
  // Runic Tempering: channelled, a Runic Plate each use time up to its most; while you have plates, a hit you take is
  // its less, each its number of hits breaks a plate, and the backlash deals your thorns in its area around the
  // attacker, once per its cooldown
  K.tempering = S => {
    if ((me.runeT = (me.runeT || 0) + SIM.channelTick) < useTime(S)) return;
    me.runeT = 0; me.runeS = S; me.runes = Math.min(S.dmg.stats.runic_tempering_max_runes, (me.runes || 0) + 1); say(`${S.label}: ${me.runes}`, 'dust');
  };
  function tempered(d) {
    const S = me.runeS, st = S?.dmg.stats; if (!(me.runes > 0)) return 1;
    if ((me.runeHits = (me.runeHits || 0) + 1) >= st.runic_tempering_hit_per_rune) { me.runeHits = 0; me.runes--; }
    const D = thornsOf();
    if (D && !(time < me.runeCd)) { me.runeCd = time + st.runic_tempering_backlash_cooldown_ms / 1000; fx.ring(d.pos, .2, S.A, 'dust', .4); area(d.pos, S.A, thornX(D, S.label), { noPay: true }); }
    return 1 + st['runic_tempering_damage_taken_+%_final'] / 100;
  }
  // Valako's Charge: the lightning damage you take builds charge; at its threshold it all goes into a chaining bolt (its cooldown)
  function valako(n) {
    const i = byName("Valako's Charge"), S = i >= 0 && mk(i), st = S && S.dmg?.stats;
    if (!st || (me.valako = (me.valako || 0) + n) < st.cast_on_damage_taken_threshold || !spend({ id: S.name, cooldown: S.dmg.cooldown, uses: S.dmg.uses })) return;
    const X = partOf(S, 'ValakosChargeArcPlayer'), e = near(pp, sh(X).chainRange || SIM.chainRange); me.valako = 0; say(S.label, 'lightning');
    if (e) chain(V(pp.x, 1.2, pp.z), e, { ...X, src: 'trigger' }, (sh(X).chains || 1) - 1);
  }
  function retaliate(d) {
    const D = thornsOf(); if (!D || d.dead) return;
    fx.emit(10, { p: { x: pp.x, y: 1, z: pp.z }, dir: V(d.pos.x - pp.x, 0, d.pos.z - pp.z), v: 3, life: .25, size: .1, c: 'dust', c2: 'white', drag: 2 });
    hit(d, thornX(D, t('Thorns')), { noPay: true }); me.quill = me.barbs = 0;
    if (sheet().thornsLeech) leechIn('life', Object.values(D.hits).reduce((t, [a, b]) => t + (a + b) / 2, 0) * sheet().thornsLeech / 10000);   // Belly of the Beast: life leech from thorns
  }
  function thornHit(S, d) {
    // Barbs: after you retaliate, the supported skill's next hits (its count) deal your thorns damage to the enemy
    // (Barbs III: twice)
    const B2 = S.dmg?.sum?.deal_thorns_damage_twice_on_hit_for_X_hits_after_thorns_trigger, BB = S.dmg?.sum?.deal_thorns_damage_on_hit_for_X_hits_after_thorns_trigger || B2, BD = BB && me.barbs < BB && thornsOf();
    if (BD) { me.barbs++; for (let k = 1; k <= (B2 ? 2 : 1); k++) later(.02 * k, () => !d.dead && hit(d, thornX(BD, t('Thorns')), { noPay: true })); }
    for (const T of S.dmg?.trig || []) {
      // Runeforged Blades: a hit on Fully Broken Armour consumes it for a nova of its projectiles, which cannot hit that
      // enemy, for its Ward cost
      if (T.stats?.['triggered_by_support_rune_forged_blades_%'] && d.st.armour > 0 && me.ward >= T.wardCost) {
        spendWard(T.wardCost); clear(d, 'armour');
        const X = asTrig(S, T), n = sh(X).projectiles || T.stats.base_number_of_projectiles; say(X.label, 'physical');
        for (let k = 0; k < n; k++) { const a = k * TAU / n; shoot(X, d.pos, Math.sin(a), Math.cos(a), { seen: [d] }); }
      }
      // Living Lightning: a hit dealing lightning creates one (up to its limit, for its duration, its cooldown and stored
      // uses), its own attack (calc.js minionOf), chaining, gone after its most attacks
      const LL = T.stats?.['chance_to_trigger_living_lightning_on_lightning_damage_%'];
      if (LL && T.minion && S.els.includes('lightning') && Math.random() * 100 < LL && objs.filter(x => x.kind === T.id && !x.dead).length < T.stats.base_number_of_living_lightning_allowed && spend(T)) {
        const X = asTrig(S, T, T.minion.hits); X.dmg = { ...X.dmg, ...T.minion }; X.P = { ...X.P, ranged: false };
        minion(X, around(d.pos, 1.5), T.shape?.duration || T.stats.base_skill_effect_duration / 1000, { kind: T.id, attacks: T.stats.living_lightning_maximum_number_of_attacks, chains: T.shape?.chains ?? T.stats.number_of_chains });
      }
      // Poison Spores: a hit attaches a Toxic Pustule to the enemy (its chance, cooldown), which detonates after its time
      // (calc.js trig parts: the explosion); the poison on that enemy is stored in it (dot ticks in update)
      const PS = T.stats?.['triggered_pustule_from_poison_spores_on_hit_chance_%'], PX = PS && T.parts?.TriggeredPoisonSporesExplosion;
      if (PX && !d.pustule && Math.random() * 100 < PS && spend(T)) {
        const st = PX.stats; d.pustule = { X: asTrig(S, { ...T, ...PX, id: T.id }, PX.hits), st, left: PX.shape?.detonate ?? st.base_skill_detonation_time / 1000, stored: 0 };
        say(d.pustule.X.label, 'poison');
      }
      // Fist of Kalguur: the boosted slam's first hit on an enemy leaves its rune there (up to its limit, the oldest goes),
      // erupting as an aftershock after its duration; its cooldown
      if (S.rune === T && spend(T)) {
        S.rune = null; const X = asTrig(S, T), at = { x: d.pos.x, z: d.pos.z }, R = me.runes, lim = T.support.base_number_of_runic_aftershocks_allowed || 1;
        R.push(at); if (R.length > lim) R.shift(); say(X.label, 'physical');
        later(T.shape?.duration || T.stats.base_skill_effect_duration / 1000, () => { const k = R.indexOf(at); if (k < 0) return; R.splice(k, 1); boom(at, X.A, X); });
      }
      const n = T.support?.trigger_spiked_gauntlets_for_X_hits_after_thorns_trigger, D = n && me.quill < n && thornsOf();
      if (D && !spend(T)) continue;
      if (D) { me.quill++; const Q = asTrig(S, T), X = { ...thornX(D, Q.label), name: T.id, A: Q.A }; say(Q.label, 'dust'); later(.05, () => boom({ x: d.pos.x, z: d.pos.z }, X.A, X)); }
      const g = T.stats?.morrigan_ward_gain_X_guard;
      if (g && d.st.freeze > 0 && spend(T)) {
        d.st.freeze = 0; const label = api.info({ name: T.id }).label, dur = T.shape?.duration || T.stats.base_skill_effect_duration / 1000;
        me.guard = Math.max(me.guard, Math.min(g, 2 * (me.maxL || 0)));   // keywords.json Guard: the higher one stays, up to 200% of your life
        buffs = buffs.filter(b => !b.thorns); buffs.push({ label, name: S.name, c: css('cold'), s: dur, thorns: [T.stats.morrigan_ward_thorns_minimum_base_cold_damage, T.stats.morrigan_ward_thorns_maximum_base_cold_damage] });
        say(t('{0} consumes {1}', label, t(STATE.freeze)), 'cold');
      }
    }
    // Toxic Domain: while you are in its Bloom your projectile attacks attach a Toxic Pustule (its chance), bursting after
    // its detonation time for Toxic Domain's own attack damage, storing the poison like Poison Spores' (pustule)
    const TD = S.P.attack && S.P.projectile && !d.pustule && objs.find(o => o.domain && !o.dead && dist(o.c, pp) <= o.R)?.domain;
    if (TD && Math.random() * 100 < TD.dmg.stats['toxic_domain_pustule_chance_%']) { d.pustule = { X: TD, st: TD.dmg.stats, left: TD.dmg.stats.base_skill_detonation_time / 1000, stored: 0 }; say(TD.label, 'poison'); }
  }
  // Deadly Resolve: a stage per its time channelling the supported skill (up to its most, for its duration: one timer for all,
  // ponytail: each stage's own timer if it matters); an enemy's hit expends one for a slash at it, its cone and cooldown, 1%
  // more damage per its armour
  function resolveGain(dt) {
    const B = held && base(held.i), T = B?.P.channel && B.dmg?.trig?.find(T => T.support?.gain_dangerous_resolve_stack_per_X_ms_channeling), U = T?.support;
    if (!T) { me.resolve = 0; return; }
    if ((me.resolve = (me.resolve || 0) + dt) < U.gain_dangerous_resolve_stack_per_X_ms_channeling / 1000) return;
    me.resolve = 0; let E = empower.find(e => e.type === 'resolve');
    if (!E) { const X = asTrig(B, T); empower.push(E = { type: 'resolve', uses: 0, X, label: X.label, name: B.name, next: 0 }); }
    E.uses = Math.min(U.maximum_dangerous_resolve_stacks, E.uses + 1); E.s = U.dangerous_resolve_stack_duration_ms / 1000; E.cd = U.dangerous_resolve_explosion_cooldown_ms / 1000;
  }
  function resolve(d) {
    const E = !d.dead && empower.find(e => e.type === 'resolve' && time >= e.next); if (!E) return;
    E.next = time + E.cd; if (spendEmp(E)) empower.splice(empower.indexOf(E), 1);
    const X = E.X, l = dist(d.pos, pp) || 1, k = 1 + Math.floor((sheet().armour || 0) / X.dmg.stats['dangerous_resolve_attack_damage_+1%_final_per_X_armour']) / 100;
    say(X.label, X.el); K.sweep({ ...X, mult: k, from: { x: pp.x, z: pp.z }, dx: (d.pos.x - pp.x) / l, dz: (d.pos.z - pp.z) / l, R: X.A, cone: X.dmg.stats.dangerous_resolve_cone_angle });
  }
  // Active Block: a readied Parry blocks the next blockable hit from within its distance (for projectiles or not) and
  // retaliates with its sweep, the enemy Parried for its duration (its more attack damage taken); a raised Shield blocks
  // every one, and released within its retaliation time after one it bashes the enemies close to you
  // note: how long a readied Parry waits for a hit is not in the data; PARRY_WAIT s here
  function blockU(d) {   // the uniques' effects of a block (calc.js uBlock). note: the blocked damage recouped is the hit's average
    const U = sheet().uBlock; if (!U || d.dead) return;
    if (U.poison) inflict(d, 'poison', thornX({ hits: {} }, t('Blocked')), 1, { chaos: U.poison }, {});
    if (U.intim) d.intim = Math.max(d.intim || 0, time + U.intim);   // Wulfsbane
    if (U.cull && underCull(d, {})) { fx.text(over(d), t('Culling Strike'), css('blood'), .4); damage(d, d.life + d.es, thornX({ hits: {} }, t('Blocked'))); return; }   // Doomgate
    if (U.mana) { const n = avgHit({ dmg: d.atk }) * U.mana / 100, RT = sheet().recoup?.time || 8; me.recoup.push({ k: 'mana', left: n, rate: n / RT }); }
    if (U.blood) { const v = { s: U.bloodTime, name: 'Bloodbarrier', label: t('Corrupted Blood'), S: thornX({ hits: {} }, t('Corrupted Blood')), el: 'physical', dps: takes(d, 'physical', me.maxL * U.blood / 60, false) }; const o = d.dots.filter(x => x.name === v.name); if (o.length < BLOOD_MAX) d.dots.push(v); else Object.assign(o.reduce((a, x) => x.s < a.s ? x : a), v); }
    if (U.enfeeble && Math.random() * 100 < U.enfeeble.chance) { const E = U.enfeeble;   // Rondel de Ezo: cursed with Enfeeble, as a curse of yours
      hexOld(d, 'Enfeeble');
      d.curse = { s: SIM.curseTime, full: SIM.curseTime, label: api.info({ name: 'Enfeeble' }).label, name: 'Enfeeble', C: E.C, k: E.C.effect * d.stat.curseEffect * (1 + (sheet().coil?.zero || 0) / 100) }; hexMe('Enfeeble', E.C, SIM.curseTime); }
  }
  const blocked = d => { blockU(d); me.blockAt = time; me.blockN = (me.blockN || 0) + 1; me.life = Math.min(me.maxL, me.life + recOn('block') + me.maxL * recOn('blockPct') / 100); fx.ring(pp, .4, 1.1, 'white', .25, { a: .6 }); fx.text(above(), t('Blocked'), GREY, .32); event('block', pp, {}); record('avoid', d.mon.name, t('Blocked'), 0, GREY); };   // Cast / Curse on Block: its energy per block
  // Charge Regulation: while on, each kind of charge you have grants its buff (frenzy: its skill speed, power: its more
  // critical hit chance, endurance: its more armour, evasion and energy shield), and it consumes one of each every its interval.
  // note: its increased skill speed is applied as more here
  const regulate = (c, k) => { const v = charges[c] > 0 && onS('Charge Regulation')?.dmg.stats[k]; return 1 + (v || 0) / 100; };
  function regulation() {
    const st = onS('Charge Regulation')?.dmg.stats; if (!st) { me.regAt = null; return; }
    if (time - (me.regAt ??= time) < st.consume_frenzy_power_and_endurance_charge_every_x_ms / 1000) return;
    me.regAt = time; for (const c of ['frenzy', 'power', 'endurance']) if (charges[c] > 0) { charges[c]--; chargesSpent(1, c); }
  }
  // Magma Barrier: while on, its increased block chance (withCharms), and its lava fills over its charge-up time; a
  // block with your shield raised once it is full spends it on Magma Spray, its cone toward the attacker, and an
  // Endurance Charge
  const magma = () => onS('Magma Barrier');
  function spray(d) {
    const S = magma(); if (!S || !(me.lava >= 1)) return;
    me.lava = 0; const l = dist(d.pos, pp) || 1, dx = (d.pos.x - pp.x) / l, dz = (d.pos.z - pp.z) / l, half = S.dmg.stats.igneous_shield_explosion_angle_degrees * Math.PI / 360;
    fx.sector(pp, dx, dz, S.A, half, 'fire', .35, { grow: true, a: .7 }); for (const e of inside(pp, S.A)) if (inCone(pp, Math.atan2(dz, dx), half, e.pos)) hit(e, S);
    chargeBy('endurance', S); say(S.label, 'fire');
  }
  const wouldTake = (c, a) => Object.fromEntries(Object.entries(a.hits).map(([el, [lo, hi]]) => [el, playerTakes(c, el, lo + Math.random() * (hi - lo), true, true, a.pen)]));   // a hit's damage as it would be after your defences
  function activeBlock(d, a) {
    if (frozen() || me.st.stun > 0) return false;   // not while Stunned or Frozen (keywords.json Block)
    const P = time < me.parry?.until && me.parry.S, R = time < me.raised?.until && me.raised, RF = time < me.refute?.until && me.refute.st;
    if (RF) { weaken(d, sheet().uEv?.parryWeak || 0); me.parryAt = time; d.parried = { more: RF['base_parry_buff_damage_taken_+%_final_to_apply'] * (1 + (sheet().parryMag || 0) / 100), until: time + RF.base_parry_duration_ms / 1000 * (sheet().parryTime || 1) }; blocked(d); return true; }
    if (!P && !R) return false;
    if (P) {
      const st = P.dmg.stats, far = (a.shape === 'projectile' ? st.base_maximum_active_block_distance_for_projectiles : st.base_maximum_active_block_distance_for_non_projectiles) / 10 * (1 + (sheet().parryRange || 0) / 100), l = dist(d.pos, pp) || 1;
      if (l > far + SIM.body * d.sc) return false;
      const PN = sheet().parryNext; if (PN) me.parryNext = a.shape === 'projectile' ? PN.melee && { melee: PN.melee } : a.melee && PN.ranged ? { ranged: PN.ranged } : me.parryNext;   // the tree's: your next attack of the other kind
      me.parry = null; K.sweep({ ...P, from: { x: pp.x, z: pp.z }, dx: (d.pos.x - pp.x) / l, dz: (d.pos.z - pp.z) / l });
      me.parryAt = time; d.parried = { more: st['base_parry_buff_damage_taken_+%_final_to_apply'] * (1 + (sheet().parryMag || 0) / 100), until: time + st.base_parry_duration_ms / 1000 * (sheet().parryTime || 1) };
    } else { R.blocked = me.rblockAt = time; spray(d); if (Math.random() * 100 < (sheet().blockDaze || 0)) daze(d, DAZE.time); }   // the tree's Daze on blocking with a raised shield
    const SM = (P || R.S).dmg?.sum?.['knights_legacy_non_active_blocking_melee_skill_damage_+%_final_to_grant_if_active_blocked_with_supported_skills_recently']; if (SM) me.styrn = { more: SM, until: time + RECENT };   // Styrn's Mountain
    // the stun of a hit you block yourself (keywords.json Block, HeavyStunPlayer): Heavy Stun buildup, and behind a raised
    // shield its Light Stun too (Raise Shield's own light stun threshold while blocking)
    blocked(d); { const est = wouldTake(sheet(), a); ailed(d, est, est, P ? 'heavy' : true, P || R.S); } return true;
  }
  const seen = () => { const st = onS('Future-Past')?.dmg.stats; return !!st && time - me.fpAt >= st.base_skill_effect_duration / 1000; };   // Future-Past's Foresight
  // Kalisa's Crescendo: an enemy in the final share of its curse's duration is Pacified and deals no damage (keywords.json Pacify)
  const pacified = d => { const C = d.curse, P = C?.S?.dmg?.sum?.['curse_pacify_for_final_%_of_duration']; return P && C.s <= C.full * P / 100 && !(time < d.noPac); };
  // your defences as they are now: the sheet's with what the fight changes (buffs, charges, states, broken armour)
  function defNow() {
    let c = { ...withCharms(sheet()), esNow: me.es };   // your current energy shield (Disciple of Varashta's armour from it)
    if (time < me.woo?.until && c.deflect) c = { ...c, deflect: { ...c.deflect, flat: (c.deflect.flat || 0) + (c.evasion || 0) * me.woo.pct / 100 / (c.deflect.inc || 1) } };   // Window of Opportunity II: as flat rating
    me.bark = me.bark.filter(b => b.until > time);   // Barkskin's armour, up to your armour items' own
    if (me.cu.some(u => u?.c.armour2)) c = { ...c, armourX: (c.armourX || 1) * 2 };   // For Utopia: defend with 200% of Armour during its effect
    if (me.tail) c = { ...c, evasion: (c.evasion || 0) * (1 + me.tail * TAILWIND.evasion / 100 / (c.evasionInc || 1)), deflect: c.deflect && { ...c.deflect, less: 100 - (100 - c.deflect.less) * (1 - me.tail * TAILWIND.deflect / 100) } };   // Tailwind (its increased evasion added to yours)
    { const AA = arcticS()?.dmg.stats, AI = AA && Math.floor(me.arctic) * (AA['arctic_armour_armour_granted_+%_per_stage'] || 0); if (AI) c = { ...c, armour: (c.armour || 0) * (1 + AI / 100 / (c.armourInc || 1)) }; }   // Arctic Armour's quality: increased armour per stage
    if (me.jade) c = { ...c, physDR: (c.physDR || 0) + me.jade * c.jade.dr };   // Jade: its additional physical damage reduction a stack
    if (c.fireMaxIgnited && me.st.ignite > 0) { const F = c.res.fire, max = F.max + c.fireMaxIgnited; c = { ...c, res: { ...c.res, fire: { ...F, max, capped: Math.min(F.value, max) } } }; }   // the tree's maximum fire resistance while Ignited
    if (c.archonRes && meIs.Archon()) c = { ...c, res: { ...c.res, ...Object.fromEntries(ELEM.map(e => [e, { ...c.res[e], capped: Math.min(c.res[e].max, c.res[e].value + c.archonRes) }])) } };   // Archon buffs' elemental resistances
    { const U = sheet().uDef || {}, low = lowLife();   // uniques: fire resistance and evasion on Low Life, more armour per 1% of your energy shield
      if (low && U.fireLow) { const F = c.res.fire, value = F.value + U.fireLow; c = { ...c, res: { ...c.res, fire: { ...F, value, capped: Math.min(value, F.max) } } }; }
      if (low && U.evaLow) c = { ...c, evasion: (c.evasion || 0) + U.evaLow * (c.evasionInc || 1) };
      if (time < me.ever) c = { ...c, res: Object.fromEntries(Object.entries(c.res).map(([e, r]) => { const max = r.max + EVERLASTING.res; return [e, r.immune || r.max == null ? r : { ...r, max, capped: Math.min(r.value, max) }]; })) };   // Everlasting Sacrifice
      if (U.resPower && charges.power) c = { ...c, res: { ...c.res, ...Object.fromEntries(ELEM.map(e => { const value = c.res[e].value + U.resPower * charges.power; return [e, { ...c.res[e], value, capped: Math.min(value, c.res[e].max) }]; })) } };   // Adonia's Ego: per Power Charge
      if (U.deflMissing && me.maxE > me.es && c.deflect) c = { ...c, deflect: { ...c.deflect, flat: Math.floor((me.maxE - me.es) / 50) * U.deflMissing } };
      if (U.esArmour && me.maxE > 0) c = { ...c, armourX: (c.armourX || 1) * (1 + me.es / me.maxE * U.esArmour) }; }
    if (me.bark.length) c = { ...c, armour: (c.armour || 0) + Math.min(armourItems(api.build().items).armour, me.bark.reduce((t, b) => t + b.v, 0)) };
    if (me.armCut || time < me.armBroken) c = { ...c, armour: time < me.armBroken ? 0 : Math.max(0, (c.armour || 0) - me.armCut) };   // your armour a monster modifier broke
    const DFW = (c.deflMove && meIs.Moving() ? c.deflMove : 0) + (c.deflSurr && meIs.Surrounded() ? c.deflSurr : 0);   // increased deflection rating while moving, while Surrounded
    if (DFW && c.deflect) c = { ...c, deflect: { ...c.deflect, inc: c.deflect.inc + DFW / 100 } };
    return c;
  }
  function struck(d) {
    if (pacified(d)) return;
    const a = d.atk; let c = defNow();
    if (d.dead || me.safe > 0 || !a.hasHit) return;
    // Future-Past: after its Hindsight (its duration) Hinekora's Foresight keeps the roll from avoiding hits; a hit while
    // rolling restores your life first and grants Sight Beyond Sight (its secondary duration: you cannot die), then
    // Hindsight again. note: her copy (foresight_clone_duration_ms) is a look the scene does not have
    const FP = onS('Future-Past'), foresight = seen();
    if (move && !move.S && (!a.area || move.roll && sheet().uDef?.rollAll) && !foresight && !sheet().bulwark) return fx.text(above(), t('Dodged'), GREY, .32), record('avoid', d.mon.name, t('Dodged'), 0, GREY);   // the dodge roll avoids strikes and projectiles
    if (move && !move.S && foresight) { me.life = me.maxL; me.sight = time + FP.dmg.stats.base_secondary_skill_effect_duration / 1000; me.fpAt = time; say(FP.label, 'gold'); fx.glow({ x: pp.x, y: 1.2, z: pp.z }, 1.2, 'gold', .5); }
    if (!a.unblockable && activeBlock(d, a)) return;
    // Runic Reprieve's bubble Blocks the hit: you take its share of the damage, also taken off your Runic Ward, and are not
    // Light Stunned by it (nor its ailments here); it builds up Heavy Stun as any hit you block yourself
    const RR = !a.unblockable && time < me.reprieve?.until && me.reprieve.st;
    if (RR) { blocked(d); const est = wouldTake(c, a); ailed(d, est, est, 'heavy', me.reprieve.S); }
    const HC = hitChance(d.stat.accuracy * (d.st.blind > 0 ? 1 - blindLess() / 100 : 1) * (d.mark ? 1 + (c.markedAcc || 0) / 100 : 1) * (c.cover ? 1 - falloff(d) * .9 : 1), (c.evasion || 0) * (me.st.maim > 0 ? 1 - MAIM.evasion / 100 : 1), c.evadeMax), evd = () => Math.random() * 100 >= HC;
    if (!RR && !heavyStunned() && evd() && (!c.glancing || evd()))   /* Glancing Blows: evading is Unlucky */ return fx.text(above(), t('Evaded'), GREY, .32), record('avoid', d.mon.name, t('Evaded'), 0, GREY);
    if (a.shape === 'projectile' && Math.random() * 100 < (c.avoidProj || 0)) return fx.text(above(), t('Avoided'), GREY, .32), record('avoid', d.mon.name, t('Avoided'), 0, GREY);   // The Sunken Vessel
    const BR = () => Math.random() * 100 < blockChance(c, a), BL = !RR && !frozen() && !(me.st.stun > 0) && (BR() || c.luckyBlock && BR());   // not while Stunned or Frozen (keywords.json Block); Turtle Charm: a blocked hit still deals its share
    if (BL) {   // you still take the stun of a blocked hit (keywords.json Block): its damage as it would be after your defences
      blocked(d);
      if (!c.blockTaken) { const est = wouldTake(c, a); return ailed(d, est, est, true); }
    }
    // Seraph's Heart: while the buff it supports is on, its chance for the hit to treat your resistances as 90%
    const SH = 'support_seraphs_heart_enemy_hits_%_chance_to_treat_all_resistances_as_90%', SR = Object.keys(tog).map(onS).find(S => S?.dmg?.sum?.[SH]);
    if (SR && Math.random() * 100 < SR.dmg.sum[SH]) c = { ...c, res: Object.fromEntries(Object.entries(c.res || {}).map(([e, r]) => [e, { ...r, capped: 90 }])) };
    // Deflect (keywords.json): its chance like evasion's, your deflection rating against their accuracy; a deflected hit
    // deals its less damage
    const DF = c.deflect && deflection(c), DHC = hitChance(d.stat.accuracy * (d.st.blind > 0 ? 1 - blindLess() / 100 : 1), DF), dfl = DF > 0 && !heavyStunned() && (Math.random() * 100 >= DHC || (c.glancing || c.luckyDeflLow && lowLife()) && Math.random() * 100 >= DHC);   // Glancing Blows: deflecting is Lucky
    if (dfl) me.dflAt = time, fx.text(above(), t('Deflected'), GREY, .32);
    // a curse that lowers their damage (Enfeeble)
    // Oracle's The Lesser Harm: critical chance against you and damage of hits are Unlucky (rolled twice, the better for you)
    const OR = sheet(), roll = () => !(OR.noCrit?.pin && d.st.pin > 0 || OR.noCrit?.mark && d.mark || OR.parryNoCrit && time < (me.parry?.until ?? -9)) && Math.random() * 100 < a.crit * (d.st.blind > 0 ? 1 + (OR.blindCrit || 0) / 100 : 1) * (me.st.chill > 0 ? 1 + (OR.critChilled || 0) / 100 : 1) * (1 + (OR.critTaken || 0) / 100), crit = roll() && (!OR.unluckyCrit || roll()), cm = (OR.bulwark && move?.roll ? .7 : 1) * (dfl ? 1 - (c.deflect.less + (crit ? c.deflect.lessCrit || 0 : 0)) / 100 : 1) * (crit ? 1 + a.critBonus * (c.selfCrit ?? 1) / 100 : 1) * (1 + curseFx(d, C => C?.damage) / 100) * (d.intim > time ? 1 - INTIM / 100 : 1) * (RR ? RR['rune_ward_block_%_damage_taken'] / 100 : 1) * (BL ? c.blockTaken / 100 : 1) * Math.max(0, 1 + (OR.witheredDeal || 0) * (d.wither || []).filter(u => u.until > time).length / 100) * (d.debil > time ? 1 - DEBIL.less / 100 : 1) * (1 + (d.mark?.S?.dmg?.stats?.['gem_quality_marked_enemy_damage_dealt_+%_final'] || 0) / 100);   // Sniper's Mark's quality: the Marked one deals less; and Intimidated ones; Withered ones per Wither on them; Debilitated ones
    if (crit) gainRage(OR.rageCritTaken);   // Bristleboar: Rage when critically hit
    const AD = OR.adapt; if (AD) me.adapt = (me.adapt || []).filter(u => u.until > time);
    // "Defend with X% of Armour" against this hit: a critical one, a projectile attack, from further than 6 m, while your
    // energy shield is not low (as Low Life: below its share of the most), or its chance for 200%. note: several multiply
    const DW = OR.defendWith; if (DW) { const x = [[DW.crit, crit], [DW.projAttack, a.attack && a.shape === 'projectile'], [DW.far, dist(d.pos, pp) > 6], [DW.notLowES, me.maxE > 0 && me.es >= me.maxE * LOW], [DW.haveES, me.es > 0], [DW.double && 200, Math.random() * 100 < DW.double]]
      .reduce((m, [p, ok]) => p && ok ? m * p / 100 : m, 1); if (x !== 1) c = { ...c, armourX: (c.armourX || 1) * x }; }
    { const U = OR.uDef || {}; if (U.beforeHit) me.life = Math.min(me.maxL, me.life + (me.maxL - me.life) * U.beforeHit / 100); }   // Defiance of Destiny
    let total = 0, chaos = 0, top = d.col, best = 0; const raw = {}, dealt = {}, IW = onS('Iron Ward')?.dmg.stats;
    me.struck = [...(me.struck || []).filter(at => time - at <= RECENT), time];   // the times you were Hit Recently
    const UL = Math.random() * 100 < (OR.unluckyDmg || 0);   // the hit's damage Unlucky
    const DR = OR.dmgRolls || {}, rollOf = el => { const n = (DR[el] || 0) + (lowLife() ? DR.low || 0 : 0) + (el === 'lightning' ? me.cu.reduce((t, u) => t + (u?.c.lightRoll || 0), 0) : 0); return UL || n < 0 ? Math.min(Math.random(), Math.random()) : n > 0 ? Math.max(Math.random(), Math.random()) : Math.random(); };   // Lucky: the higher of two rolls
    const TW = (OR.takenWhile || []).reduce((m, w) => meIs[w.cv]() ? m * (1 + w.val / 100) : m, 1);   // more / less damage taken in a state (before this hit counts)
    const ALT = OR.uDef?.alt && Math.floor(time / 5) % 2 === 0 ? 1 + OR.uDef.alt / 100 : 1;   // Keeper of the Arc: less damage from hits every other 5 s (heart(): over time the other 5 s)
    const FT = OR.flatTaken || {}, flat = (FT.phys || 0) + (a.attack ? FT.attack || 0 : 0) + (a.attack && a.shape === 'projectile' ? FT.proj || 0 : 0);   // uniques' "-10 Physical Damage taken from Hits" (note: taken off before your defences)
    const SE = sheet(), EG = SE.enemyChaos && dist(d.pos, pp) <= SE.overgrow.r ? SE.enemyChaos / 100 : 0;   // Evergrasping Ring: enemies in your Presence gain extra chaos
    const AH = EG ? { ...a.hits, chaos: [0, 1].map(k => (a.hits.chaos?.[k] || 0) + Object.values(a.hits).reduce((t, h) => t + h[k], 0) * EG) } : a.hits;
    for (const el in AH) {
      if (Math.random() * 100 < (OR.avoidDmg?.[el] || 0)) continue;   // Perfidy: that type of the hit avoided
      const [lo, hi] = AH[el]; let got = playerTakes(c, el, raw[el] = Math.max(0, (lo + rollOf(el) * (hi - lo)) * cm * ALT + (el === 'physical' ? flat : 0)), true, true, a.pen) * TW;
      if (me.aegis > 0 && (ELEM.includes(el) || SE.wardAll)) { const k = Math.min(me.aegis, got); me.aegis -= k; got -= k; me.aegisAt = time; }   // Sorcery Ward (Ceremonial Ablution: physical and chaos too)
      if (el === 'physical' && IW) me.iron = Math.min(IW.warding_steel_maximum_stored_mitigated_physical_damage, (me.iron || 0) + (raw[el] - got) * IW['warding_steel_gains_%_of_damage_from_mitigated_physical_damage'] / 100);   // Iron Ward
      if (AD && ELEM.includes(el)) got *= (1 + AD.less / 100) * (1 + AD.per * me.adapt.filter(u => u.el === el).length / 100);   // Adaptations: less of a type per matching one
      dealt[el] = got; total += got; if (el === 'chaos') chaos += got; if (got > best) { best = got; top = el; }
    }
    if (me.ghost >= 1) { me.ghost--; me.ghostAt = time; }   // Ghost Dance
    // a monster modifier's Armour Break: its share of the physical damage it deals; at all of your armour, Fully Broken
    const AB = a.ail?.['armour_break_physical_damage_%_dealt_as_armour_break'];
    if (AB && dealt.physical > 0 && !(time < me.armBroken) && sheet().armour > 0 && (me.armCut = (me.armCut || 0) + dealt.physical * AB / 100 * (1 + (sheet().armBreakTaken || 0) / 100)) >= sheet().armour) { me.armCut = 0; me.armBroken = time + BROKEN.player; say(t('Broken Armour'), 'physical'); }
    const AE = AD && ELEM.filter(e => dealt[e] > 0).sort((x, y) => dealt[y] - dealt[x])[0];   // adapt to the hit's highest elemental type, the oldest Adaptations giving way
    if (AE) { for (let k = 0; k < AD.gain; k++) me.adapt.push({ el: AE, until: time + AD.dur }); me.adapt = me.adapt.slice(-AD.max); }
    if (dealt.lightning > 0) valako(dealt.lightning);
    const RF2 = a.shape !== 'projectile' && dealt.physical > 0 && sheet().uEv?.reflect; if (RF2) { const x = dealt.physical * RF2 / 100; hit(d, thornX({ hits: { physical: [x, x] } }, t('Thorns')), { noPay: true }); }   // Bramblejack: melee physical damage taken dealt back
    // Chronomancer: less damage taken now, and its share of the hit taken 4 seconds later (its stat's own delay)
    // Mountain's Teachings: its less damage taken from a hit dealing at most its share of your maximum life after mitigation
    // (KeywordPopups MountainsTeachings); the hit loses one
    const MO = time < me.mountUntil && me.mount > 0 && sheet().mountain; if (MO && --me.mount <= 0) me.mountUntil = 0;
    { const FW = dfl && sheet().uDef?.wardenDefl, o = FW && objs.find(o => o.companion && !o.dead && o.segs?.[0].life > 0); if (o) { const k = FW / 100; o.segs[0].hurt(total * k); total *= 1 - k; chaos *= 1 - k; } }   // Forgotten Warden: its share of a deflected hit from your Companion's life first
    const RT = tempered(d), DH = sheet().delayHit, k = (1 + (DH?.less || 0) / 100) * (MO && total <= me.maxL * MO.upTo / 100 ? 1 + MO.taken / 100 : 1); hurt(total * RT * k, chaos * RT * k, top, crit, d, true);
    if (DH?.later) later(4, () => !(me.safe > 0) && hurt(total * RT * DH.later / 100, chaos * RT * DH.later / 100, top, false, d, true));
    // Recoup: its shares of what the hit dealt you (of the physical damage your armour prevented), over its time
    const RC = sheet().recoup, el = ELEM.reduce((t, e) => t + (dealt[e] || 0), 0);
    const add = (k, n) => n > 0 && me.recoup.push({ k, left: n, rate: n / (RC?.time || 8) }, ...(k === 'life' && sheet().recoupEs ? [{ k: 'es', left: n, rate: n / (RC?.time || 8) }] : [])), W = sheet().weakness;
    if ((W?.recoupL || W?.recoupLE) && openWeak(d)) { add('life', total * (W.recoupL + W.recoupLE) / 100); add('es', total * W.recoupLE / 100); }   // The Master's Reach: damage taken from an enemy with an Open Weakness
    { const p = Math.max(0, (raw.chaos || 0) - (dealt.chaos || 0)) * me.cu.reduce((t, u) => t + (u?.c.bangle || 0), 0) / 100; add('life', p); add('mana', p); }   // Forsaken Bangle: the chaos damage prevented, during its effect
    if (RC) { add('life', ((dealt.physical || 0) * RC.phys + el * RC.el + total * (RC.all + RC.lme + flasks().reduce((t, f, n) => t + (f?.recoup && me.drink[n] ? f.recoup : 0), 0) + Math.floor((me.rage || 0) / 5) * (RC.perRage || 0) + (dfl ? RC.deflect : 0) + (meIs.Channelling() ? RC.channel : 0))) * RT / 100
      + Math.max(0, (raw.physical || 0) - (dealt.physical || 0)) * RC.prevented / 100); add('es', (el * RC.es + total * RC.lme) * RT / 100 + Math.max(0, (raw.physical || 0) - (dealt.physical || 0)) * RC.scarred * pow(d) / 100); add('mana', total * RT * (RC.mana + RC.lme) / 100); }
    if (RR) { me.ward = Math.max(0, me.ward - total * RT); return; }
    if (me.sprint) { me.sprint = null; if (!sheet().noFall) suffer('stun', sheet().ailments?.heavy || DUR.stun, { heavy: true }); }   // hit while sprinting, you fall over (SprintTutorialContent)
    if (me.safe > 0) return;   // not after the hit killed you
    resolve(d); if (a.melee || sheet().thornsAny) retaliate(d); if (a.melee) arctic(d); windDance(); ailed(d, raw, dealt);
    for (const el of ['fire', 'cold', 'lightning', 'chaos']) if (raw[el] > 0) charmUse(el + '_damage_taken'), (me.hitEl ||= {})[el] = time;   // and the types you were Hit with Recently (Adaptive Skin)
  }
  // What their hits do to you: GameConstants' ailment rules, from the hit's damage before your defences, against your
  // ailment, freeze and stun thresholds (calc.js ailmentDefence()), with the player's own durations (GameConstants <name>Player),
  // your chance to avoid each one and the chances of the monster's skill. Bleeding and poison need a chance of the skill.
  // Ignite, bleeding and poison deal their share of the hit per second (monsters.json constants); the strongest stays.
  // Heavy stun builds up from every hit, more from physical and melee ones (monster.ot), and lasts your own heavy stun time (character.ot).
  const PL = GAME.player || {};
  const heavyStunned = () => me.st.stun > 0 && time < me.heavyEnd;   // you neither Evade nor Deflect then (keywords.json HeavyStunPlayer)
  const frozen = () => me.st.freeze > 0, stuck = () => frozen() || me.st.stun > 0 || me.st.electrocute > 0, slowed = () => (me.st.chill > 0 && sheet().ailments.eff.slow !== 0 && !(me.sprint && sheet().sprintNoSlow) ? 1 - me.mag.chill / 100 * (sheet().chillReversed ? -1 : 1) : 1) * (1 - (shrineOn()?.['action_speed_-%'] || 0) / 100) * (time < me.overEnc?.until && !(me.sprint && sheet().sprintNoSlow) ? Math.max(0, 1 - OVERENC * me.overEnc.n * sheet().ailments.eff.slow / 100) : 1) * (me.hexes ? Math.max(.1, 1 + onMe(C => C.speed) * sheet().ailments.eff.slow / 100) : 1) /* Temporal Chains on you: a slow */,   // Pathfinder: unaffected by slows
    maimed = () => me.st.maim > 0 ? 1 - MAIM.move * sheet().ailments.eff.slow / 100 : 1;   // maim slows only your movement, as much as the Slow Potency of debuffs on you
  function suffer(a, s, o = {}) {
    if (immune(a) || sheet().oneDmgAil && DMG_AIL.includes(a) && DMG_AIL.some(k => me.st[k] > 0)) return;   // the tree's: no damaging ailment while you have one
    if (time < me.prev?.[a]) return;   // Shackles of the Wretched: not again for its time after one
    if (sheet().ailPrevent?.[a]) (me.prev ||= {})[a] = time + sheet().ailPrevent[a] / 1000;
    if (a === 'stun') { me.stunAt = time; if (o.heavy) { me.heavyAt = time; me.heavyEnd = time + s; } if (Math.random() * 100 < (sheet().volOnStun || 0)) { gainVol(1); } const EB = time < me.use?.until && me.use.S.dmg?.sum?.support_no_energy_shield_recharge_delay_for_duration_ms_on_stunned; if (EB) me.ebarT = time + EB / 1000; }   // "if you haven't been Stunned Recently"; Volatility when Stunned; Energy Barrier: stunned while using it, no recharge delay for its time
    const fresh = !(me.st[a] > 0); me.st[a] = Math.max(me.st[a] || 0, s);
    if (fresh && a === 'stun' && recOn('stunned')) { const n = me.maxL * recOn('stunned') / 100; me.recoup.push({ k: 'life', left: n, rate: n }); }   // over a second
    if (o.mag) me.mag[a] = fresh ? o.mag : Math.max(me.mag[a] || 0, o.mag);
    if (o.dot && (fresh || o.dot.dps > (me.burn[a]?.dps || 0))) me.burn[a] = o.dot;
    if (!fresh) return;
    if (a === 'freeze' || a === 'stun' || a === 'electrocute') { held = charge = goal = null; walk = false; }   // they stop what you are doing
    if (a === 'freeze') { me.st.chill = 0; fx.emit(22, { p: { x: pp.x, y: 1, z: pp.z }, r: .3, v: 1.6, up: 1, life: .6, size: .16, c: 'ice', c2: 'white', g: 5 }); }
    fx.text(above(), t(a === 'stun' ? (o.heavy ? 'Heavy Stun' : 'Light Stun') : STATE[a]), css(PIP[a]), .34); fx.ring(pp, .2, 1, PIP[a], .3); hudT = 0;
    charmUse(a === 'stun' ? 'stunned' : a === 'maim' ? 'affected_by_slow' : 'affected_by_' + a);   // maim is a slow (its BuffDefinitions text)
  }
  function ailed(d, raw, dealt, stunOnly = false, blockS) {
    const D = sheet().ailments, A = d.atk.ail, x = e => raw[e] || 0, roll = c => Math.random() * 100 < c;
    if (!D?.ail || !me.known) return;
    const thr = Math.max(1, D.ail) * (1 + banner('ailment_threshold_+%_final') / 100) * (1 + (charge && base(charge.i)?.dmg?.sum?.['support_steadfast_ailment_threshold_+%_final_while_channelling'] || 0) / 100) /* Steadfast II, while channelling it */, more = (inc, fin) => (1 + (A[inc] || 0) / 100) * (1 + (A[fin] || 0) / 100), can = a => !immune(a) && !roll(D.avoid[a]);
    const dot = (a, el, base) => ({ dps: base * GAME[a + '_per_minute'] / 6000, el });
    me.by = d;
    // freeze and electrocute build up against their thresholds; once one fills, it is harder to fill again for a while
    // (GameConstants <name>ThresholdModifier / <name>ModifierDuration, the player's where the game has its own)
    const build = (a, n, cap, dur, o) => {
      if (!(n > 0) || !cap || me.st[a] > 0) return;
      const G = BAR[a], rule = k => PL[G + k] ?? GC[G + k];
      me.bar[a] = (me.bar[a] || 0) + n / (cap * (me.lock[a] > 0 ? 1 + rule('ThresholdModifier') / 100 : 1)) * 100; me.calm = 0;
      if (me.bar[a] < 100) return;
      me.bar[a] = 0; me.lock[a] = rule('ModifierDuration');
      if (can(a)) suffer(a, dur, o);
    };
    if (stunOnly) return stunNow();   // a blocked hit: only its stun (keywords.json Block)
    // a monster modifier's: all damage of its hits counts for ignite / chill, its hits always ignite / shock
    const all = Object.values(raw).reduce((t, n) => t + n, 0), IG = A.all_damage_can_ignite ? all : x('fire');
    if (IG) {   // flammability: each hit adds some for a while, the total is the chance to ignite you
      me.flam.push({ v: IG / thr * GC.IgniteChanceMultiplier * more('ignite_chance_+%', 'active_skill_ignite_chance_+%_final'), s: PL.BaseFlammabilityDuration });
      if ((A.always_ignite || roll(me.flam.reduce((t, f) => t + f.v, 0))) && can('ignite')) suffer('ignite', DUR.ignite * D.dur.ignite, { dot: dot('ignite', 'fire', IG * D.eff.ignite) });
    }
    // a skill that shocks / chills as though dealing more damage (active_skill_<ailment>_as_though_damage_+%_final)
    const though = a => 1 + (A[`active_skill_${a}_as_though_damage_+%_final`] || 0) / 100;
    if (x('lightning') && (A.always_shock || roll(x('lightning') * though('shock') / thr * GC.ShockChanceMultiplier * more('shock_chance_+%', 'active_skill_shock_chance_+%_final'))) && can('shock'))
      suffer('shock', PL.BaseShockDuration * D.dur.shock, { mag: GC.BaseShockMagnitude * D.eff.shock });
    const SC = sheet(), CX = SC.chillAll || SC.chillPois && me.st.poison > 0 || SC.chillBleed && me.st.bleed > 0 || A.all_damage_can_chill ? all : x('cold');   // Icefang Orbit, Venopuncture: all damage taken chills you while poisoned / bleeding
    if (CX && !frozen()) {
      const mag = Math.max(A['chill_minimum_slow_%'] || 0, Math.min(GC.ChillMaxEffect, GC.ChillEffectMultiplier * CX * though('chill') / thr * D.eff.chill));   // a modifier's least chill
      if (mag >= CHILL_MIN && can('chill')) suffer('chill', PL.BaseChillDuration * D.dur.chill, { mag });
      build('freeze', roll(A['base_chance_to_freeze_%'] || 0) ? Infinity : x('cold') * PL.FreezeDamageScale * more('hit_damage_freeze_multiplier_+%', 'active_skill_hit_damage_freeze_multiplier_+%_final'),
        D.freeze, PL.FreezeDuration * D.dur.freeze * more('freeze_duration_+%'));
    }
    // electrocute, only from the skills that say so (GSPerennialKingGlassSwordFenceZap), against your ailment threshold
    const E = A['active_skill_electrocutes_as_though_dealt_damage_+%_final'];
    if (E != null) build('electrocute', x('lightning') * GC.ElectrocuteDamageScale * (1 + E / 100) * D.eff.electrocute, D.electrocute, PL.ElectrocuteDuration / 1000 * D.dur.electrocute);
    // Plain hits cannot heavily stun a player (KeywordPopups HeavyStunPlayer), they can light stun you (LightStun): the
    // damage dealt (more from physical and melee hits, monster.ot) against your stun threshold, 100% at all of it, none
    // under the least chance; each stun of the last few seconds raises your threshold (character.ot)
    stunNow();
    function stunNow() {
      const melee = d.atk.melee, X = (melee ? 1 + GAME.stun_melee / 100 : 1) * (1 + ((A['hit_damage_stun_multiplier_+%'] || 0) + (melee ? A['melee_hit_damage_stun_multiplier_+%'] || 0 : 0)) / 100)
        * (1 + (A['active_skill_hit_damage_stun_multiplier_+%_final'] || 0) / 100) * (time < me.dazed ? 1 + DAZE.stun / 100 : 1),   // Dazed: more stun buildup (keywords.json Daze)
        hard = Object.entries(dealt).reduce((t, [e, v]) => t + v * (e === 'physical' ? 1 + GAME.stun_physical / 100 : 1), 0) * X;
      me.stuns = me.stuns.filter(at => time - at < GAME.player_light_stun_repeat_ms / 1000);
      // the tree's increased stun threshold if you haven't been stunned recently / while channelling, added to its always-on one
      const stunIf = D => { const I = D.stunIf; if (!I) return 1; const x = (time - (me.stunAt ?? -99) > RECENT ? I.notRecent : 0) + (charge ? I.channel : 0) + (me.life >= me.maxL ? I.full || 0 : 0) + (time < me.parry?.until ? I.parry || 0 : 0) + (time < me.use?.until && me.use.S.empd ? I.emp || 0 : 0) + (meIs.Shapeshifted() ? I.shift || 0 : 0) + (meIs.Surrounded() ? I.surr || 0 : 0) + Math.min(100, (I.perHit || 0) * (me.struck?.length || 0)) + (I.perStun || 0) * me.stuns.length;   // per time you were Hit Recently, up to 100%; per time Stunned Recently
        return x ? (1 + (I.inc + x) / 100) / (1 + I.inc / 100) : 1; };
      // a hit you block yourself (shield raised, parry, Runic Reprieve) builds up Heavy Stun on you (keywords.json HeavyStunPlayer):
      // its damage but the cold (keywords.json Cold) at the player's scale (GameConstants), against your stun threshold with the
      // skill's own (Parry's less, Runic Reprieve's increased) and Unbreakable's and Styrn's Mountain's more while using it
      if (blockS) { const own = blockS.dmg?.stats || {}, U = blockS.dmg?.sum || {}, f = k => 1 + (k || 0) / 100;
        build('stun', (hard - (dealt.cold || 0) * X) * PL.HeavyStunDamageScale, D.stun * stunIf(D) * f(own['stun_threshold_+%_final_while_performing_action']) * f(own['active_skill_stun_threshold_+%_while_performing_action']) * f(U['support_stability_heavy_stun_threshold_+%_final_while_performing_action']) * f(U['support_knights_legacy_heavy_stun_threshold_+%_final_while_performing_action']), (D.heavy || DUR.stun) * D.dur.stun, { heavy: true });
        if (stunOnly === 'heavy') return; }
      // with your Shield raised: Raise Shield's own more light stun threshold, doubled by Dionadair; Runefather's Boasts add theirs
      const RSH = time < me.raised?.until ? (sheet().raisedStun || 1) * (1 + (me.raised.S.dmg?.stats?.['active_block_light_stun_threshold_+%_final'] || 0) / 100) : 1;
      const stunChance = D.stun ? Math.min(100, hard / ((D.stun + (me.boast || 0) * (1 + (D.stunIf?.inc || 0) / 100)) * RSH * (1 + me.rage * (sheet().stunPerRage || 0) / 100) * (time < me.mountUntil ? 1 + sheet().mountain.stun / 100 : 1) * (time < me.refute?.until ? Math.max(0, me.refute.stun) : 1) * stunIf(D) * (1 + GAME.player_light_stun_repeat_pct * me.stuns.length / 100) * (time < me.use?.until ? (1 + (me.use.S.dmg?.sum?.['support_unbreakable_light_stun_threshold_+%_final_while_performing_action'] || 0) / 100) * (1 + (me.use.S.dmg?.stats?.['active_skill_stun_threshold_+%_while_performing_action'] || 0) / 100) /* the skill's own while using it: Rolling Slam, Furious Slam */ : 1) * (charge ? 1 + (base(charge.i)?.dmg?.sum?.['support_steadfast_stun_threshold_+%_final_while_channelling'] || 0) / 100 : 1)) * 100) : 0;   // more threshold with Mountain's Teachings
      if (!frozen() && !sheet().unwavering && !sheet().noLightStun && !(sheet().noStunDeflected && me.dflAt === time) && !(sheet().noStunRecent && time - (me.stunAt ?? -99) <= RECENT) && !(sheet().noStunCalm && me.struck.length < 2) && stunChance >= GAME.player_light_stun_min && roll(stunChance) && can('stun')) {
        if (sheet().stunBlind) d.st.blind = Math.max(d.st.blind || 0, BLIND.time);   // the tree's: Blind the enemy that stuns you
        me.stuns.push(time); suffer('stun', GAME.player_light_stun_ms / 1000 * D.dur.stun * (1 + (A['base_stun_duration_+%'] || 0) / 100));
      }
    }
    if (x('physical') && roll(((A['local_chance_to_bleed_on_hit_%'] || 0) + (A['main_hand_local_chance_to_bleed_on_hit_%'] || 0)) * (sheet().uDef?.recvAil || 1) + (sheet().uDef?.recvBleed || 0)) && can('bleed') && !(sheet().noBleedDeflected && me.dflAt === time)) suffer('bleed', DUR.bleed * D.dur.bleed, { dot: dot('bleed', sheet().bleedSelfFire ? 'fire' : 'physical', x('physical') * (D.eff.bleed ?? 1)) });
    // maim on hit (the skill's or its main hand weapon's chance, with its increased chance)
    const maim = ((A['maim_on_hit_%'] || 0) + (A['main_hand_local_maim_on_hit_%'] || 0)) * (1 + (A['maim_chance_+%'] || 0) / 100);
    if (roll(maim) && can('maim') && !(sheet().noMaimDeflected && me.dflAt === time)) suffer('maim', MAIM.time);
    const pois = (A['base_chance_to_poison_on_hit_%'] || 0) + (A[d.atk.attack ? 'chance_to_poison_on_hit_with_attacks_%' : 'spells_chance_to_poison_on_hit_%'] || 0);
    if ((x('physical') || x('chaos')) && roll(pois * (sheet().uDef?.recvAil || 1) + (sheet().uDef?.recvPoison || 0)) && can('poison')) suffer('poison', DUR.poison * D.dur.poison, { dot: dot('poison', 'chaos', x('physical') + x('chaos')) });
  }
  // Flasks, as the game's: the build's life flask and mana flask (items.js flaskOf()), on 1 and 2, together before the skills.
  // One that applies its effect constantly recovers all the time and is not drunk.
  // A drink spends its charges and recovers its amount over its time; drinking again replaces the one in progress (note:
  // the tables do not say what a second drink does). Kills refill them, as the glossary (KeywordPopups Flask, Power) says:
  // half the monster's power for a normal one, all of it for a magic one, twice it for rare and unique ones, the power being
  // the rarity's 1 / 2 / 5 times the monster's own, and 20 for a unique (note: a monster's own power is not in the tables:
  // the glossary's average, 1, is used). Dying and refilling fill them, as a checkpoint or a well does.
  const pow = d => (POWER[d?.stat.rarity || 'normal'] || 1) * (sheet().redblade && d && dist(d.pos, pp) <= sheet().overgrow.r ? 1 + sheet().redblade / 100 : 1) + (sheet().gmPower && d?.gm && dist(d.pos, pp) <= sheet().overgrow.r ? d.gm.n : 0) + (d?.rfc ? RUNEFATHER : 0);   // a monster's Power (Redblade Banner: more in your Presence; Runefather's Challenge: more)
  const POWER = { normal: 1, magic: 2, rare: 5, unique: 20 }, FLASK_GAIN = { normal: .5, magic: 1, rare: 2, unique: 2 };
  const flasks = () => sheet().flasks || [];
  const souls = () => { const s = me.souls; return s ? Math.max(0, s.n - Math.max(0, Math.floor((time - s.at - SOUL.wait) / SOUL.every))) : 0; };
  const eatSoul = () => { me.souls = { n: Math.min(SOUL.max, souls() + 1), at: time }; hudT = 0; };
  // a life flask's recovery on your allies too (Nurturing Guardian: your Companions; Umbilicus Immortalis: your minions, which
  // cannot die while one is in effect: lifeFlaskOn), one that applies constantly as well
  const flaskAllies = got => { const c = sheet(); if (c.flaskCompanions || c.flaskMinions) for (const o of objs) { const s = (c.flaskMinions ? o.minion : o.companion) && !o.dead && o.segs?.[0]; if (s) s.life = Math.min(s.max, s.life + got); } };
  const lifeFlaskOn = () => me.drink.some(D => D?.k === 'life') || flasks().some(f => f?.always && f.k === 'life');
  const flaskOn = k => flasks().reduce((t, f, n) => t + (f && me.drink[n] ? +f[k] || 0 : 0), 0);   // what the flasks in effect give (a unique's own)
  const flaskLeft = n => { const f = flasks()[n]; if (!f) return 0; return me.fl[n] = Math.min(me.fl[n] ?? f.max, f.max); };
  const flaskName = n => t(n ? 'Mana Flask' : 'Life Flask');
  const flaskHeal = (f, n, B = sheet().brew, dry = sheet().tides?.dry) => {   // life (and energy shield, when the build says so) or mana; with Azmeri Brew a flask recovers both
    if ((f.k === 'mana' || B) && !sheet().manaRegenOnly) me.mana = (f.over ? overflow : gain)(me.mana, me.maxM, n);   // Indigon: none but regeneration   // Uhtred's Chalice: over maximum mana during its effect
    if (f.k === 'mana' && !B || dry) return;   // Sanguine Tides: flasks recover no life
    if (!sheet().vaal) me.life = (f.overLife ? overflow : gain)(me.life, me.maxL, n); if (f.es) me.es = gain(me.es, me.maxE, n);   // Vaal Pact: no life; The Gnashing Sash: over maximum life
  };
  // Guard for s seconds, the higher one kept, up to 200% of your maximum life (keywords.json Guard)
  function guardFor(g, s) { g = Math.min(g, 2 * ((sheet().uDef?.guardEs ? me.maxE : me.maxL) || 0));   /* Decree of Flight: of maximum energy shield instead */ if (g > me.guard) { me.guard = g; later(s, () => { if (me.guard === g) me.guard = 0; }); } }
  function drink(n, auto) {   // auto: used by itself (Opportunity, on Perfect Timing), which a flask that cannot be used manually needs
    const f = flasks()[n];
    if (auto ? !f || flaskLeft(n) < f.per : f?.noManual) return auto || toast(`${flaskName(n)}: ${statLines({ local_flask_cannot_be_used_manually: 1 })[0]}`);
    if (!f) return toast(t('{0}: nothing equipped', flaskName(n)));
    if (f.always) return toast(t('{0} applies its effect constantly', flaskName(n)));
    if (flaskLeft(n) < f.per) return toast(t('{0} needs {1} charges and has {2}', flaskName(n), f.per, Math.floor(me.fl[n])));
    if (!(Math.random() * 100 < f.keep)) { me.fl[n] -= f.per; const Z = !n && sheet().zerphi?.toCharm; if (Z) charms().forEach((c, k) => { if (c) me.cc[k] = Math.min(c.max, charmLeft(k) + f.per * Z / 100); }); }   // the tree's chance to not consume charges; Zerphi's Genesis
    // increased life recovery when used on Low Life, and of any flask while a Charm is active (Efficient Alchemy), with the other increased. ponytail: as it is drunk; per tick if a charm ending mid-flask matters
    const LL = (1 + (f.inc + (f.k === 'life' && lowLife() ? sheet().lowFlask || 0 : 0) + (me.cu.some(Boolean) ? sheet().flaskCharm || 0 : 0)) / 100) / (1 + f.inc / 100);
    const OC = time < me.chalice && !f.es ? (1 + (f.inc + CHALICE.rec) / 100) / (1 + f.inc / 100) : 1;   // Overflowing Chalice's increased recovery
    me.drink[n] = { k: f.k, es: f.es, over: f.over, overLife: f.overLife, rate: f.amount * LL * OC / f.time, s: f.time, ...f.nova && { m0: me.spentM || 0, nt: 3 } }; (me.drankAt ||= [])[n] = time; if (n) gainPct('life', recOn('manaFlask')); if (n && sheet().flaskUncurse) uncurse(); if (n && sheet().uDef?.flaskGuard) guardFor(f.amount * sheet().uDef.flaskGuard / 100, 4);   // Glowswarm
    if (n && sheet().esOnManaFlask) me.esEarly = 1e9;   // Bitterbloom: a mana flask starts energy shield recharge
    if (f.k === 'life') gainRage(sheet().flaskRage);   // the tree's Rage on using a life flask
    if (f.k === 'life' && sheet().flaskUnbleed) me.st.bleed = 0;   // Zerphi's Genesis: a life flask removes Bleeding
    if (f.k === 'life' && sheet().flaskGuard) guardFor(me.drink[n].rate * sheet().flaskGuard / 100, 4);   // the tree's Guard of its recovery a second, for 4 s
    if (f.instant || f.instantLow && (f.k === 'life' ? lowLife() : lowMana())) { flaskHeal(me.drink[n], f.amount * LL); me.drink[n].s = 0; }   // Belly of the Beast; Birthright Buckle on Low Life / Low Mana
    fx.ring(pp, .3, 1.2, f.k === 'life' ? 'blood' : 'arcane', .4); hudT = 0;
    if (onS("Alchemist's Boon")) for (const o of objs) if (o.minion && !o.dead && dist(o.pos, pp) <= sheet().overgrow.r) fx.boon({ x: pp.x, z: pp.z }, () => o.pos, f.k);   // Alchemist's Boon: the flask's recovery spreading to your allies in your Presence
  }
  // Charms, as the game's: the build's (items.js charmOf()), after the flasks. Each one is used by itself when what its
  // implicit says happens (you become ignited, frozen, stunned..., take fire damage, kill a rare or unique enemy) and it has
  // the charges, and grants its buff while it lasts: immunity to that ailment (removing it) or its resistance. Kills refill
  // them with half the monster's power (the glossary's KeywordPopups Charm). note: Silver Charm's slows are not the scene's
  // chill: it is used when you are maimed
  const CHARM_GAIN = .5, IMMUNE_TO = { utility_charm_freeze_immunity: 'freeze', utility_charm_bleeding_immunity: 'bleed', utility_charm_poison_immunity: 'poison',
    utility_charm_ignite_immunity: 'ignite', utility_charm_shock_immunity: 'shock', utility_charm_stun_immunity: 'stun', utility_charm_slow_immunity: 'maim' };
  const charms = () => sheet().charms || [];
  const charmLeft = n => { const f = charms()[n]; if (!f) return 0; return me.cc[n] = Math.min(me.cc[n] ?? f.max, f.max); };
  const immune = a => { const W = sheet().immuneWhen, has = (k, on) => on && W?.[k]?.includes(a);
    return a === 'bleed' && sheet().bleedImmune || !!sheet().immuneIf?.[a] || me.cu.some(u => u && IMMUNE_TO[u.c.buff] === a) || has('archon', meIs.Archon()) || has('shift', me.form) || has('roll', move?.roll) || has('leech', me.leech.mana.left > 0); };   // the tree's, in their state
  function charmUse(on) {
    charms().forEach((f, n) => {
      const CM = me.maxM * (sheet().charmMana || 0) / 100, lack = f && charmLeft(n) < f.per;   // Mind Phylacteries: mana instead of the missing charges
      if (!f || f.on !== on || me.cu[n] || lack && !(CM > 0 && me.mana >= CM)) return;
      if (lack) me.mana -= CM; else if (!(Math.random() * 100 < f.keep)) { event('charm', pp, NONE, null, f.per); me.cc[n] -= f.per; flaskGain(0, f.per * (sheet().zerphi?.toFlask || 0) / 100); }
      useCharm(f, n);
      // the tree's chance to use another charm without consuming its charges
      const m = Math.random() * 100 < (sheet().charmAnother || 0) ? charms().findIndex((g, j) => g && j !== n && !me.cu[j]) : -1;
      if (m >= 0) useCharm(charms()[m], m);
    });
  }
  function useCharm(f, n) {
    me.cu[n] = { c: f, s: f.time }; gainPct('mana', recOn('charm'));
    if (f.igGround) ground('burning', { x: pp.x, z: pp.z }, SIM.area, 4, { el: 'fire', els: ['fire'], ail: ['ignite'], src: 'ground', label: f.name, raw: { fire: me.maxL * f.igGround / 100 } });   // Beira's Anguish: Ignited Ground for 4 s (note: its radius is not in the data: the scene's)
    if (f.life) flaskHeal({ k: 'life' }, f.life, false, false); if (f.mana) flaskHeal({ k: 'mana' }, f.mana, false, false); if (f.guard) me.guard = f.guard;
    const [LF, MF] = flasks(); if (f.lifeOfMana && MF) flaskHeal({ k: 'life' }, MF.amount * f.lifeOfMana / 100, false, false); if (f.manaOfLife && LF) flaskHeal({ k: 'mana' }, LF.amount * f.manaOfLife / 100, false, false);   // Arakaali's Gift
    if (f.charge) gainCharge(f.charge, f.name); if (f.rageMax) gainRage(rageMax()); if (f.esStart) me.esHurt = me.esStop = -99;   // Breath of the Mountains, Valako's Roar, Ngamahu's Chosen, Nascent Hope
    if (f.holy) ground('consecrated', { x: pp.x, z: pp.z }, ...f.holy);   // Sanguis Heroum
    const a = IMMUNE_TO[f.buff]; if (a) { me.st[a] = 0; delete me.burn[a]; delete me.mag[a]; me.bar[a] = 0; }
    say(t('{0} used', f.name), 'gold'); fx.ring(pp, .3, 1.3, 'gold', .4); hudT = 0;
  }
  // the attack damage your Rage adds now (berserk's effect while it is on), and against what the skill's numbers assume
  const rageNow = () => { const R = sheet().rage; return R?.noEffect ? 0 : me.rage * (100 + (R?.berserk && tog[R.berserk.name] ? R.berserk.effect : 0)) / 100; };
  const rageX = D => (1 + rageNow() / 100) / (1 + (D.rage || 0) * (100 + (D.rageEffect || 0)) / 1e4);
  // what buffs and ailments change right now, for the side panel (app.js onLive): each as [now, without them]
  // (null: the build cannot change it). Recovery: regeneration and the constant flasks, with the flasks being drunk;
  // damage over time: your ignite, bleeding and poison and the ground you stand in, after resistances and shock, as vitals() and tickHazards() deal it
  function live() {
    const c = sheet(), w = defNow(), act = stuck() ? 0 : slowed(), gain = buffs.find(b => b.gain)?.gain, R = c.rage;
    const rate = (k, on) => (on ? me.drink : flasks().filter(f => f?.always).map(f => ({ k: f.k, rate: f.amount / f.time }))).reduce((t, D) => t + (D?.k === k ? D.rate : 0), 0);
    const RG = regenNow(c), rec = k => { const own = RG[k] + rate(k); return [own + rate(k, true), own]; };
    let dot = 0;
    for (const a in me.burn) if (me.st[a] > 0) dot += playerTakes(w, me.burn[a].el, me.burn[a].dps, false);
    if (charges.endurance && w.enduChaos) dot += playerTakes(w, 'chaos', charges.endurance * w.enduChaos, false);   // Nebuloch: chaos damage a second per Endurance Charge
    if (!(me.safe > 0)) for (const h of hazards) if (dist(h, pp) <= h.r) for (const el in h.dot) dot += playerTakes(w, el, h.dot[el], false);
    const bz = R?.berserk, raging = bz && tog[bz.name] && me.rage > 0 && time - me.raged <= R.delay;
    return {
      res: ['fire', 'cold', 'lightning', 'chaos'].map(e => [e, w.res?.[e]?.capped ?? 0, c.res?.[e]?.capped ?? 0]),
      move: [spd() * act * maimed(), spd()], action: [act * 100, 100], taken: [me.st.shock > 0 ? me.mag.shock : 0, 0],
      life: rec('life'), mana: rec('mana'), dot: [dot * (me.st.shock > 0 ? 1 + me.mag.shock / 100 : 1), 0],
      // your defences now against what the sheet has (Barkskin, Tailwind, Jade, a broken armour, Maim...): a melee hit's block
      armour: [armourNow(w), armourNow({ ...c, esNow: me.maxE })], evasion: [(w.evasion || 0) * (me.st.maim > 0 ? 1 - MAIM.evasion / 100 : 1), c.evasion || 0],
      deflect: c.deflect && (deflection(w) || deflection(c)) ? [deflection(w), deflection(c)] : null, block: w.block || c.block ? [blockChance(w, { shape: 'melee' }), blockChance(c, { shape: 'melee' })] : null,
      physDR: w.physDR || c.physDR ? [w.physDR || 0, c.physDR || 0] : null,
      rage: rageMax() ? [rageNow(), 0] : null, ward: me.maxW ? [me.ward, 0] : null, guard: me.guard > 0 || charms().some(f => f?.guard) ? [me.guard, 0] : null,
      berserk: bz ? { v: [raging ? me.maxL * bz.lifePerRage / 100 * me.rage : 0, 0], name: api.info(api.build().gems.find(g => g.name === bz.name) || { name: bz.name }).label } : null,
      demon: me.demon ? { v: [demon() * me.demon.st.demon_form_life_loss_per_minute_per_stack / 60, 0], name: me.demon.label } : null,   // Demon Form's Life lost per Demonflame
      // the share of its damage per second a skill you use deals now: action speed, Rage on attacks, a mark's buff, Demon Form on spells (not a
      // totem's or a minion's, nor one a meta gem uses: those act by themselves)
      dps: i => { const S = base(i), D = S?.dmg; return D && api.byHand(i) && !['totem', 'minion', 'raise'].includes(S.kind) ? act * (D.attack ? rageX(D) : 1) * (gain ? 1 + gain.pct / 100 : 1) * (me.demon && S.P.spell ? (1 + demon() * me.demon.st['demon_form_spell_damage_+%_final_per_stack'] / 100) * demonCast(S) : 1) : 1; },
    };
  }
  // your resistances with those of the charms in use
  const meIs = { Archon: () => archonOn() || time < (me.earch || 0) || uarch(), CompanionInPresence: () => inPresence(o => o.companion), Still: () => !walk && !move, Bleeding: () => me.st.bleed > 0, Ignited: () => me.st.ignite > 0,
    Surrounded: () => inside(pp, SURROUNDED.r * Math.sqrt(1 + (sheet().surrArea || 0) / 100)).length >= SURROUNDED.n + (sheet().surrN || 0), Leeching: () => me.leech.life.left > 0 || me.leech.mana.left > 0, BeenHitRecently: () => time - me.hurt <= RECENT,
    NotHitRecently: () => time - me.hurt > RECENT, Moving: () => walk || !!move, Sprinting: () => !!me.sprint, Channelling: () => !!(held && base(held.i)?.P.channel || charge),
    HitRecently: () => time - (me.hitAt ?? -99) <= RECENT, HitMeleeRecently: () => time - (me.meleeHit ?? -99) <= RECENT, HaveEnergyShield: () => me.es > 0,
    DodgeRolledRecently: () => time - (me.rollAt ?? -99) <= RECENT, FullLife: () => me.life >= me.maxL, LowLife: lowLife,
    FullMana: () => me.mana >= me.maxM * (TH().fullMana || 100) / 100, NotLowMana: () => !lowMana(), LowMana: lowMana, Chilled: () => me.st.chill > 0, FlaskEffect: () => me.drink.some(Boolean),
    ManaFlaskEffect: () => !!me.drink[1], ManaFlaskRecently: () => time - (me.drankAt?.[1] ?? -99) <= RECENT,
    LifeFlaskEffect: () => !!me.drink[0], LifeFlaskPast10: () => time - (me.drankAt?.[0] ?? -99) <= 10, Shocked: () => me.st.shock > 0,
    DamagingAilment: () => ['ignite', 'bleed', 'poison'].some(a => me.st[a] > 0), Ailing: () => meIs.DamagingAilment() || ['chill', 'shock', 'freeze'].some(a => me.st[a] > 0), KilledRecently: () => time - (me.killAt ?? -99) <= RECENT,
    CritRecently: () => Object.values(me.critAt || {}).some(at => time - at <= RECENT), NotCritRecently: () => !meIs.CritRecently(),
    CritPast8: () => Object.values(me.critAt || {}).some(at => time - at <= 8), NonCritRecently: () => time - (me.nonCritAt ?? -99) <= RECENT,
    LifeLeeching: () => me.leech.life.left > 0, Cursed: () => hexN() > 0, TotemActive: () => objs.some(o => o.totemOf && !o.dead), HeraldOn: () => Object.values(tog).some(T => T.kind === 'herald'),
    PowerGainedRecently: () => time - (chargeAt.power ?? -99) <= RECENT, BlockedPast4: () => time - (me.blockAt ?? -99) <= 4, RaisedBlockRecently: () => time - (me.rblockAt ?? -99) <= RECENT, PinnedRecently: () => time - (me.pinAt ?? -99) <= RECENT, Parrying: () => time < (me.parry?.until ?? -9), ParriedRecently: () => time - (me.parryAt ?? -99) <= RECENT, UsingCharm: () => me.cu.some(Boolean),
    ConsumedCorpseRecently: () => time - (me.corpseAt ?? -99) <= RECENT, HeavyStunnedRecently: () => time - (me.heavyAt ?? -99) <= RECENT, TriggeredRecently: () => time - (me.trigAt ?? -99) <= RECENT,
    NoLifeFlaskUses: () => !!flasks()[0] && flaskLeft(0) < flasks()[0].per,
    Shapeshifted: () => !!me.form || !!me.demon, ShapeshiftedRecently: () => time - (me.shiftAt ?? -99) <= RECENT, RevertedRecently: () => time - (me.revertAt ?? -99) <= RECENT,
    ConsumedFrenzyRecently: () => time - (me.spentAt?.frenzy ?? -99) <= RECENT, ConsumedPowerRecently: () => time - (me.spentAt?.power ?? -99) <= RECENT, ConsumedEnduranceRecently: () => time - (me.spentAt?.endurance ?? -99) <= RECENT,
    ...Object.fromEntries([['chill', 'Chilled'], ['ignite', 'Ignited'], ['shock', 'Shocked']].map(([a, n]) => [n + 'EnemyRecently', () => time - (me.inflAt?.[a] ?? -99) <= RECENT])),
    ...Object.fromEntries(['Ice', 'Ash', 'Thunder', 'Plague', 'Blood'].map(h => [`HeraldOf${h}`, () => !!tog[`Herald of ${h}`]])), MarkRecently: () => used.some(u => u.mark && time - u.t <= RECENT), AllyInPresence: () => inPresence(o => o.minion), ArcaneSurge: () => surge() > 0,
    RareOrUniqueInPresence: () => inside(pp, sheet().overgrow.r).some(d => ['rare', 'unique'].includes(d.stat.rarity)),
    StunnedEnemyRecently: () => time - (me.inflAt?.stun ?? -99) <= RECENT, ESRechargePast2: () => me.esRech != null && time - me.esRech <= 2,
    AttackedRecently: () => used.some(u => u.attack && time - u.t <= RECENT), CastRecently: () => used.some(u => u.spell && time - u.t <= RECENT), MinionDiedRecently: () => time - (me.minionDiedAt ?? -99) <= RECENT, NotAttackedRecently: () => !used.some(u => u.attack && u.t < time && time - u.t <= RECENT) };
  // the tree's attack / cast speed while you are in a state (calc.js SPEED_WHILE). note: the game adds it to the skill's
  // increased speed, a factor of its own here
  // the tree's life and mana regeneration per second while you are in a state (calc.js REGEN_WHILE)
  const blindLess = () => BLIND.less * (1 + (sheet().blindEffect || 0) / 100);   // your Blind on enemies, with its increased effect
  const regenNow = c => {
    // the tree's increased life and mana regeneration per minion in your Presence, up to 40% (its text)
    const MR = c.minionRegen ? Math.min(40, c.minionRegen * minionsNear()) : 0, R = (c.regenWhile || []).filter(w => meIs[w.cv]?.()), sum = k => R.reduce((t, w) => t + (w.to === k ? w.val : 0), (k === 'l' || k === 'm' ? MR : 0) + (k === 'm' && time < me.navira?.until ? me.navira.v : 0) /* Navira's Calming */), li = c.lifeInc || 1, l = (sum('l') + Math.floor(Math.max(0, 1 - me.life / me.maxL) * 20) * (c.recPerMissing || 0)) / 100;   /* Ritualist: per 5% missing life */
    const FR = c.regrow ? Math.floor(me.regrow || 0) : 0;   // Dustbloom's Fragile Regrowth
    return { life: (c.lifeRegen || 0) * (1 + l / li) + me.maxL * (sum('L') + FR * (c.regrow?.life || 0)) / 100 / 60 * (li + l) * (c.recMore ?? 1), mana: (c.manaNoCrit && !meIs.CritRecently() ? 0 : c.manaRegen || 0) * (1 + (sum('m') + FR * (c.regrow?.mana || 0)) / 100 / (c.manaInc || 1)) - me.maxM * (c.manaDegen || 0) / 100 / 60 };   // Lich: lose a share of maximum mana a second
  };
  const echoed = () => me.echoed = [...(me.echoed || []).filter(at => time - at <= RECENT), time];   // the spells Echoed recently
  const speedWhile = b => 1 + prowess().length / 10 + ((sheet().speedWhile || []).filter(w => w.to.includes(b.P.spell ? 'c' : 'a') && meIs[w.cv]?.()).reduce((t, w) => t + w.val, 0) + (b.P.spell || !sheet().speedClose ? 0 : sheet().speedClose * inside(pp, 2).length) + (b.P.spell ? Math.min(30, (sheet().echoSpeed || 0) * (me.echoed || []).filter(at => time - at <= RECENT).length) : 0)) / 100;   // and per spell Echoed recently
  function withCharms(c) {
    const MB = magma()?.dmg.stats['skill_igneous_shield_grants_block_chance_+%']; if (MB) c = { ...c, block: (c.block || 0) * (1 + MB / 100) };
    const BW = (c.blockWhile || []).reduce((t, w) => t + (meIs[w.cv]?.() ? w.val : 0), 0); if (BW) c = { ...c, block: (c.block || 0) * (1 + BW / 100 / (c.blockInc || 1)) };   // the tree's increased block chance while in a state
    const AE = banner('armour_evasion_+%_final'), PL = plates() * (plating()?.['scavenged_plating_armour_+%_final_per_stack'] || 0), MR = banner('additional_maximum_all_elemental_resistances_%'), BR = banner('resist_all_elements_%'), WE = Math.floor(me.wind) * (onS('Wind Dancer')?.dmg.stats['wind_dancer_evasion_rating_+%_final_per_stage'] || 0);
    const CR = regulate('endurance', 'charge_mastery_armour_evasion_energy_shield_+%_final_with_endurance_charges');
    const RA = banner('%_armour_to_apply_to_elemental_damage') + (shifted()?.armourEl || 0), RE = banner('deflection_rating_%_of_evasion_rating');   // Refractive Plating; the tree's while Shapeshifted
    if ((RA || RE) && c.armourEl) c = { ...c, armourEl: Object.fromEntries(Object.entries(c.armourEl).map(([e, x]) => [e, x + (e === 'chaos' ? 0 : RA)])), deflect: c.deflect && { ...c.deflect, eva: c.deflect.eva + RE } };
    // the tree's maximum resistances while Shapeshifted, and of the elements you were Hit with Recently (Adaptive Skin)
    const SR = shifted()?.maxRes, AR = e => (SR?.[e] || 0) + (c.adaptRes && e !== 'chaos' && time - (me.hitEl?.[e] ?? -99) <= RECENT ? c.adaptRes : 0);
    if ((SR || c.adaptRes) && c.res) c = { ...c, res: Object.fromEntries(Object.entries(c.res).map(([e, r]) => [e, AR(e) ? { ...r, max: r.max + AR(e), capped: Math.min(r.max + AR(e), r.value) } : r])) };
    if (AE || MR || BR || WE || PL || CR > 1) c = { ...c, armour: c.armour * (1 + AE / 100) * (1 + PL / 100) * CR, evasion: (c.evasion || 0) * (1 + AE / 100) * (1 + WE / 100) * CR, res: (MR || BR) && c.res ? Object.fromEntries(Object.entries(c.res).map(([e, r]) => [e, e === 'chaos' ? r : { ...r, max: r.max + MR, value: r.value + BR, capped: Math.min(r.max + MR, r.value + BR) }])) : c.res };
    // the tree's increased armour / evasion while you are in a state, added to the increases they have
    const DW = (c.defWhile || []).filter(w => meIs[w.cv]?.()), inc = k => DW.reduce((t, w) => t + (w.to.includes(k) ? w.val : 0), 0);
    if (c.evaDouble && meIs.NotHitRecently()) c = { ...c, evasion: (c.evasion || 0) * 2 };   // Hyrri's Ire
    if (me.boast) c = { ...c, armour: c.armour + me.boast * (c.armourInc || 1), evasion: (c.evasion || 0) + me.boast * (c.evasionInc || 1) };   // Runefather's Boasts, with your increases
    // the curses on you (Shackles of the Wretched): their lower resistances and armour
    if (me.hexes) c = { ...c, armour: Math.max(0, c.armour - onMe(C => C.armour)), res: c.res && Object.fromEntries(Object.entries(c.res).map(([e, r]) => { const x = onMe(C => C.res?.[e]); return [e, x ? { ...r, value: r.value + x, capped: Math.min(r.max, r.value + x) } : r]; })) };
    if (c.armourPerRage) c = { ...c, armour: c.armour * (1 + c.armourPerRage * rageNow() / 100 / (c.armourInc || 1)) };   // Horns of Bynden: increased armour per Rage
    // the tree's: every Rage grants increased evasion; increased armour and evasion per totem in your Presence
    const ER = (c.evasionPerRage || 0) * rageNow(), DT = (c.defPerTotem || 0) * objs.filter(o => o.totemOf && !o.dead && dist(o.pos, pp) <= sheet().overgrow.r).length;
    if (c.armourFrozen && me.st.freeze > 0) c = { ...c, armour: c.armour + c.armourFrozen * (c.armourInc || 1) };   // Flesh Withstands: flat Armour while Frozen, with your increases
    if (DW.length || ER || DT) c = { ...c, armour: c.armour * (1 + (inc('a') + DT) / 100 / (c.armourInc || 1)), evasion: (c.evasion || 0) * (1 + (inc('e') + ER + DT) / 100 / (c.evasionInc || 1)) };
    // Unabating, Untouchable: increased armour / evasion while you use it, per 250 ms of its attack time
    const UA = time < me.use?.until ? me.use.S.dmg?.sum || {} : {}, UAa = (UA['armour_+%_while_performing_action_per_250_ms_attack_time'] || 0) * (me.use?.k || 0), UAe = (UA['evasion_+%_while_performing_action_per_250_ms_attack_time'] || 0) * (me.use?.k || 0);
    if (UAa || UAe) c = { ...c, armour: c.armour * (1 + UAa / 100 / (c.armourInc || 1)), evasion: (c.evasion || 0) * (1 + UAe / 100 / (c.evasionInc || 1)) };
    const add = {};
    for (const u of me.cu) if (u) for (const [k, v] of Object.entries(u.c.stats)) { const m = k.match(/^base_(\w+)_damage_resistance_%$/); if (m) add[m[1]] = (add[m[1]] || 0) + v; }
    if (!Object.keys(add).length || !c.res) return c;
    const res = { ...c.res };
    for (const el in add) if (res[el]) { const value = res[el].value + add[el]; res[el] = { ...res[el], value, capped: Math.min(res[el].max, value) }; }
    return { ...c, res };
  }
  // a charm on the belt: its art darkened above its charges, lit while it is in use
  function charmHtml(n) {
    const f = charms()[n]; if (!f) return '';
    const left = charmLeft(n);
    return `<span class="s-flask s-charm${me.cu[n] ? ' act' : ''}${left < f.per ? ' low' : ''}" title="${esc(f.name)} ${Math.floor(left)}/${f.max}">`
      + `${f.img ? `<img src="${esc(f.img)}" alt="" draggable="false" onerror="this.remove()">` : ''}<i style="height:${(100 - left / f.max * 100).toFixed(1)}%"></i></span>`;
  }
  // a flask on the bar: its art darkened above the charges it has, its key under it
  function flaskHtml(n) {
    const f = flasks()[n], key = `<b>${padOn ? (n ? '▶' : '◀') : esc(keyName(settings().keys[n ? 'manaFlask' : 'lifeFlask']))}</b>`;
    if (!f) return `<button class="s-flask none" data-f="${n}" title="${esc(t('{0}: nothing equipped', flaskName(n)))}">${key}</button>`;
    const left = flaskLeft(n);
    return `<button class="s-flask${me.drink[n] || f.always ? ' act' : ''}${left < f.per ? ' low' : ''}" data-f="${n}" title="${esc(flaskName(n))} ${Math.floor(left)}/${f.max}">`
      + `${f.img ? `<img src="${esc(f.img)}" alt="" draggable="false" onerror="this.remove()">` : ''}<i style="height:${(100 - left / f.max * 100).toFixed(1)}%"></i>${key}</button>`;
  }
  // the map's ground (enemies.js mapGround): one patch of each kind it has, of the game's radius, each 8 m from the middle
  // of the room (the simulator's own layout: an area has several). Laid again when the map changes; Reset leaves them
  const MAP_AT = { burning: [-7, -4], chilled: [7, -4], shocked: [0, 8] };
  let patches = [];
  function lay() {
    patches.forEach(p => p.decal.remove());
    patches = mapGround().map(g => { const [x, z] = MAP_AT[g.type], [col, tex] = GFX[g.type]; return { ...g, x, z, tick: 0, decal: fx.decal({ x, z }, g.r, tex, col, { a: .5, k: 1.2, pulse: 5, y: .03 }) }; });
  }
  // ground left by a skill that deals damage over time: it hurts while you stand in it
  function hazard(d, p) {
    const list = Object.entries(d.atk.dot).sort((x, y) => y[1] - x[1]); if (!list.length) return;
    if (hazards.length >= 30) hazards.shift().decal.remove();
    const el = list[0][0], r = 2.2;
    hazards.push({ x: p.x, z: p.z, r, s: d.atk.dotDur || 3, tick: .25, d, dot: { ...d.atk.dot }, el, decal: fx.decal(p, r, 'patch', el, { a: .55, k: 1.2, pulse: 5, y: .04 }) });
  }
  // its projectiles (number_of_projectiles_override), fanned out as yours; one use hits you once (shot.hit)
  function volley(d) {
    const from = chest(d), a0 = Math.atan2(pp.x - from.x, pp.z - from.z), n = d.atk.count, shot = { hit: false };
    for (let i = 0; i < n; i++) { const a = a0 + (i - (n - 1) / 2) * .13; bullet(d, Math.sin(a), Math.cos(a), shot); }
  }
  function bullet(d, dx, dz, shot) {
    const a = d.atk, c = d.col, from = chest(d), l = Math.hypot(pp.x - from.x, pp.z - from.z) || 1;
    const m = a.attack ? fx.arrow(c) : fx.orb(c, .2); m.position.set(from.x, Math.min(from.y, 1.3), from.z); m.rotation.y = Math.atan2(dx, dz); scene.add(m);
    let left = a.hasHit ? 18 : l;   // a skill without a hit lands where you stood
    const land = () => { q.dead = true; if (a.area || !a.hasHit) fx.explode(m.position, 1.4, c, { soft: true }); hazard(d, m.position); };
    const q = { pos: m.position, r: 0, dead: false,
      update(dt) {
        let s = Math.min(left, (a.projSpeed || 15) * dt); left -= s;
        while (s > 0 && !q.dead) {
          const k = Math.min(.3, s); s -= k; m.position.x += dx * k; m.position.z += dz * k;
          if (a.hasHit && !shot.hit && dist(m.position, pp) <= .55) { shot.hit = true; struck(d); land(); }
        }
        if (q.dead) return;
        fx.emit(1, { p: m.position, v: .3, life: .3, size: .15, c, c2: 'white', drag: 1 });
        if (left <= 0) { if (a.hasHit) q.dead = true; else land(); }
      },
      remove() { fx.drop(m); } };
    objs.push(q);
  }
  function strike(d) {
    const a = d.atk, c = d.col, sc = d.sc;
    d.lunge = 1;
    if (a.shape === 'melee') {
      const R = reachOf(d);
      d.wind = { s: Math.min(.35, a.interval * .4), land() {
        const dx = pp.x - d.pos.x, dz = pp.z - d.pos.z, l = Math.hypot(dx, dz) || 1;
        fx.sector(d.pos, dx / l, dz / l, R, .7, c, .22, { a: .5 });
        if (l <= R + .3) { struck(d); hazard(d, pp); }
      } };
    } else if (a.shape === 'slam' || a.shape === 'area') {   // telegraphed on the ground where you stand: walk out of it
      const slam = a.shape === 'slam', p = { x: pp.x, z: pp.z }, R = a.radius || (slam ? 1.8 * sc : 2.5), w = slam ? clamp(a.interval * .45, .4, .7) : .8;
      fx.telegraph(p, R, c, w);
      d.wind = { s: w, land() {
        if (a.hasHit) { fx.explode(p, R, c, { soft: true }); if (slam) shake = Math.min(.45, shake + .1); if (dist(p, pp) <= R) struck(d); }
        hazard(d, p);
      } };
    } else if (a.shape === 'projectile') d.wind = { s: .2, land() { volley(d); } };
    else {   // bolt: a spell that strikes you directly
      fx.emit(10, { p: chest(d), r: .3, v: .6, up: 1, life: .5, size: .2, c, c2: 'white' });
      d.wind = { s: .5, land() { const to = V(pp.x, 1.1, pp.z); fx.bolt(chest(d), to, c, .18, .05, .3); fx.glow(to, 1.2, c, .25); struck(d); hazard(d, pp); } };
    }
  }
  function think(d, dt) {
    if (d.dead) return;
    // a modifier's life regeneration (per minute); the tree's: none while Bleeding or Fully Broken, its +% in your Presence or Cursed
    const FR = sheet().foeRegen, RG = FR && (FR.bleed && d.st.bleed > 0 || FR.broken && d.st.armour > 0) ? 0 : d.stat.regen * (1 + ((dist(d.pos, pp) <= sheet().overgrow.r ? FR?.pres || 0 : 0) + (d.curse ? FR?.cursed || 0 : 0)) / 100);
    if (RG > 0 && d.life < d.max) d.life = Math.min(d.max, d.life + d.max * RG / 6000 * dt * (d.wasting > time ? 1 - WASTING.regen / 100 : 1));   // Abyssal Wasting
    if (d.curse && sheet().whisper) d.life = Math.min(d.life, d.max * (1 - sheet().whisper / 100));   // Whispers of the Flesh: a Cursed enemy's life reserved. note: its less life regeneration is not applied
    if (sheet().presExpo && dist(d.pos, pp) <= sheet().overgrow.r) expo(d, ELEM, EXPO.res, .5);   // Turning of the Seasons: Exposure (the glossary's) while in your Presence
    if (d.st.freeze > 0 || d.st.stun > 0 || d.lstun > time || d.st.electrocute > 0 || d.halt > time || d.st.pin > 0 && sheet().pinStop) { d.wind = null; return; }   // frozen, stunned, electrocuted and time-stopped enemies cannot act
    // chill and a curse's slower actions (Temporal Chains) slow everything they do
    let k = (d.st.chill > 0 ? 1 - ((d.mag.chill ?? CHILL_MIN) + mag2(d, 'chill')) * d.stat.slowEffect / 100 : 1) * (1 + curseFx(d, C => C?.speed) / 100)
      * (sheet().apex && dist(d.pos, pp) <= sheet().overgrow.r ? 1 + sheet().apex * d.stat.slowEffect / 100 : 1);   // Chronomancer's Apex of the Moment: Slowed in your Presence (KeywordPopups Slow: everything they do)
    if (k < 1) dt *= Math.max(SLOW_FLOOR, k);
    if (d.gm && time - d.gm.at >= GRUEL.decay) { d.gm.at = time; if (!--d.gm.n) d.gm = null; }
    const GP = d.gm ? 1 + GRUEL.pot * (d.gm.n - 1) / 100 : 1;   // Gruelling Madness: more slow potency per stack after the first
    // Maim slows only their movement, a slow too: with chill, never under SLOW_FLOOR of their speed
    const ks = Math.max(SLOW_FLOOR, Math.min(1, k)), VS = (d.slows = d.slows.filter(u => u.until > time)).reduce((t, u) => t + u.pct, 0);   // its slows: Entangle's vines, Hinder
    const maim = Math.max(SLOW_FLOOR / ks, (d.st.maim > 0 ? 1 - (d.mag.maim ?? MAIM.move) * d.stat.slowEffect * GP / 100 : 1) * (1 + VS * d.stat.slowEffect * GP / 100) * (d.debil > time ? 1 - DEBIL.slow / 100 : 1) * (d.gm ? Math.max(0, 1 - GRUEL.slow * d.stat.slowEffect * GP / 100) : 1));   // and Debilitate
    const SR = d.st.bleed > 0 && d.red;
    d.wait -= dt * (SR ? 1 + SR['bleeding_monsters_attack_speed_+%'] / 100 : 1);
    if (d.wind) { if ((d.wind.s -= dt) <= 0) { const w = d.wind; d.wind = null; w.land(); } return; }
    if (me.safe > 0) return;
    const far = dist(d.pos, pp), R = reachOf(d), v = (d.mon.speed || 0) / 10 * d.stat.move * maim * (SR ? 1 + SR['bleeding_monsters_movement_velocity_+%'] / 100 : 1);
    if (far <= (d.mon.aggro || 0) / 10) d.aggro = true;
    const q = d.aggro && wallIn(d);   // a Shield Wall in the way: it walks to it and attacks it
    if (q) {
      const k = dist(d.pos, q.p), stop = q.r + SIM.body;
      if (k > stop && v > 0 && !(d.st.pin > 0) && !api.still?.()) { const m = Math.min(k - stop, v * dt) / k; d.pos.x += (q.p.x - d.pos.x) * m; d.pos.z += (q.p.z - d.pos.z) * m; }
      else if (d.wait <= 0 && k <= R + q.r && api.fight?.()) { d.wait = Math.max(.25, d.atk.period); d.lunge = 1; q.hurt(Object.entries(d.atk.hits || {}).reduce((t, [el, [lo, hi]]) => t + (lo + hi) / 2 * (1 - (q.res?.[el] || 0) / 100), 0)); }   // less its resistance (a minion's: calc.js minionOf)
      return;
    }
    if (d.aggro && v > 0 && far > R * .8 && !(d.st.pin > 0) && !api.still?.()) {
      const k = Math.min(far - R * .7, v * dt) / far; d.pos.x += (pp.x - d.pos.x) * k; d.pos.z += (pp.z - d.pos.z) * k;
      for (const o of dummies) {   // they do not walk into each other
        if (o === d || o.dead) continue;
        const dx = d.pos.x - o.pos.x, dz = d.pos.z - o.pos.z, l = Math.hypot(dx, dz), min = SIM.body * 2 * Math.max(d.sc, o.sc);
        if (l < min && l > 1e-3) { d.pos.x += dx / l * (min - l); d.pos.z += dz / l * (min - l); }
      }
    }
    if (d.wait > 0 || dist(d.pos, pp) > R || !api.fight?.()) return;   // they attack only when asked (Enemies attack)
    // with stored uses it strikes at its own speed while one is left; each used one recharges over the cooldown
    const A = d.atk, used = (d.ready = (d.ready || []).filter(at => at > time)).length; const SG = grounds.find(g => !g.dead && dist(g, d.pos) <= g.r && g.S?.dmg?.finals?.['ground_effects_apply_cooldown_speed_+%_final'])?.S.dmg.finals['ground_effects_apply_cooldown_speed_+%_final'] || 0;   // Persistent Ground III's Suppressive Ground: its less cooldown recovery rate for an enemy on it
    d.ready.push(time + A.cooldown / Math.max(.01, 1 + (dist(d.pos, pp) <= sheet().overgrow.r ? sheet().presCd : 0) / 100) / Math.max(.01, 1 + SG / 100));   // the tree's on enemies in your Presence
    d.wait = Math.max(.25, A.period, used + 1 < A.uses ? 0 : Math.min(...d.ready) - time); strike(d);
  }
  // your pools follow the build; life regenerates and the energy shield recharges after its delay without damage
  function vitals(dt) {
    const c = sheet(), L = c.life || 0, E = (c.es || 0) * (1 + banner('energy_shield_+%_final') / 100) * regulate('endurance', 'charge_mastery_armour_evasion_energy_shield_+%_final_with_endurance_charges')
      * (1 + (c.defWhile || []).filter(w => w.to.includes('s') && meIs[w.cv]?.()).reduce((t, w) => t + w.val, 0) / 100 / (c.esInc || 1)); me.known = c.life != null;   // the tree's increased energy shield while in a state (DEF_WHILE)
    if (L !== me.maxL) { me.life = me.maxL ? me.life / me.maxL * L : L; me.maxL = L; }
    if (me.widow && time - me.widowAt >= c.widowFor) me.widow = 0;   // Widow's Reign: what damage took of your life is reserved until none takes life for its time
    if (c.lifeReserved || me.widow) me.life = Math.min(me.life, me.maxL * (1 - (c.lifeReserved || 0) / 100) - me.widow);   // the reserved life cannot be filled (with none, life may Overflow)
    for (const a in me.st) if (me.st[a] > 0 && immune(a)) { me.st[a] = 0; delete me.burn[a]; }   // a state that makes you immune ends the ailment
    if (c.everlasting && me.maxE > 0 && me.es >= me.maxE) { me.es = 0; me.ever = time + EVERLASTING.time; setBuff({ label: statLines({ keystone_everlasting_sacrifice: 1 })[0] || 'Everlasting Sacrifice', name: 'ever', c: css('arcane'), s: EVERLASTING.time }); }   // Everlasting Sacrifice: at full energy shield, all of it Sacrificed
    if (me.mounted && (!c.mountOk || !tog['Rhoa Mount'])) me.mounted = false;   // no Bow or Spear, or Rhoa Mount off: on foot
    if (E !== me.maxE) { me.es = me.maxE ? me.es / me.maxE * E : E; me.maxE = E; }
    const W = c.ward || 0; if (W !== me.maxW) { me.ward = me.maxW ? me.ward / me.maxW * W : W; me.maxW = W; }
    if (me.ward < W && !(time < me.reprieve?.until)) me.ward = Math.min(W, me.ward + W * WARD_REGEN / 100 * dt);   // none while Runic Reprieve is on; overflowed ward stays
    if (me.heat && time - me.heatAt > c.heat.delay) me.heat = Math.max(0, me.heat - dt / c.heat.rate);   // Heat cools off
    leylines(dt); bells(dt); withering(dt); mirrors(dt); fate(); jade(dt); if (me.locust && !me.sprint && time - me.locustAt > 4) me.locust = 0; boils(); attrition(dt); malice(); regulation();
    if (time < me.wildUntil) me.life = Math.max(1, me.life - me.maxL * me.wildLoss / 100 / 60 * dt);   // Savage Fury's frenzy
    const TRF = onS('Temporal Rift')?.dmg?.stats;
    if (TRF && time - (me.riftAt ?? -99) >= TRF.temporal_rift_snapshot_interval / 1000) {
      me.riftAt = time; me.rifts.push({ x: pp.x, z: pp.z, life: me.life, mana: me.mana, es: me.es }); if (me.rifts.length > TRF.temporal_rift_maximum_snapshots) me.rifts.shift();
    }
    // Time of Need: while on, every its interval (a "modifiable" one: shorter by your cooldown recovery rate) it heals its
    // life and removes your elemental ailments
    const TND = onS('Time of Need')?.dmg, TN = TND?.stats;
    if (TN && time - (me.needAt ??= time) >= TN.base_cooldown_modifiable_repeat_interval_ms / 1000 / Math.max(.01, 1 + ((TND.sum?.['cooldown_speed_+%'] || 0) + (TN['base_cooldown_speed_+%'] || 0)) / 100)) {
      me.needAt = time; me.life = Math.min(me.maxL, me.life + TN.skill_time_of_need_gain_x_life);
      for (const a of EL_AIL) { me.st[a] = 0; delete me.burn[a]; delete me.mag[a]; }
      fx.ring(pp, 1.5, .2, 'gold', .5); hudT = 0;
    }
    // Sorcery Ward: a barrier of its share of your armour and evasion taking the elemental damage of hits, back to full its
    // delay after it last took damage. Ghost Dance: a Ghost Shroud every its interval, up to its most; one is consumed when
    // you are hit, and having lost one recently you regenerate its share of your evasion as energy shield
    if (!onS('Future-Past')) me.fpAt = null; else me.fpAt ??= time;   // its Hindsight from when it is on
    // Blasphemy: while it is on, the curses socketed in it curse the enemies within their own area around you, at its less
    // effect, each a curse of its own up to your curse limit. note: its own radius in the data (1 m) is not used: the
    // curse's; a curse from it takes a free place only, not one of another curse (the game's order is not in the data)
    called();
    const BL = onS('Blasphemy'), BK = BL && 1 + BL.dmg.stats['support_blasphemy_curse_effect_+%_final'] / 100, blOn = new Set(); me.blas ||= {};
    if (BL) api.build().gems.forEach((g, i) => {
      const S = g.meta === 'Blasphemy' && base(i), C = S?.dmg?.curse; if (!S) return;
      blOn.add(S.name); const R = me.blas[S.name] ||= blasRing(S); R.move(pp); R.set(S.A);
      const ign = S.dmg?.sum?.curse_ignores_curse_limit, lim = ign || sheet().curseIgnore ? Infinity : sheet().curseLimit || 1;
      for (const d of inside(pp, S.A)) if (!(C?.maxLevel && d.level > C.maxLevel) && !(S.name === 'Repulsion' && d.noRepulse > time)) {
        const all = [d.curse, ...(d.hexes || [])].filter(Boolean), on = all.find(u => u.name === S.name), k = (C?.effect ?? 1) * BK * d.stat.curseEffect;
        if (on?.blas) { on.s = .2; on.k = k; } else if (!on && all.length < lim) { hexOld(d, S.name, ign); d.curse = { s: .2, label: S.label, name: S.name, S, C, k, blas: true }; } else continue;
        hexMe(S.name, C, .2, BK);
      }
    });
    for (const k in me.blas) if (!blOn.has(k)) { me.blas[k].remove(); delete me.blas[k]; }
    // Her Declaration: while the buff it supports is on, an enemy that enters your Presence is Intimidated for its duration
    const HK = 'support_mothers_declaration_intimidate_enemies_when_they_enter_your_presence_base_duration_ms', HD = Object.keys(tog).map(onS).find(S => S?.dmg?.sum?.[HK]);
    // the tree's Debilitate and Blind (Bastion of Light) in front of your raised Shield, each within its metres
    const DB = sheet().debilShield, BS = sheet().blindShield, WP = sheet().raisedExpo; if ((DB || BS || WP) && time < (me.raised?.until ?? -9)) for (const d of dummies) if (!d.dead && (d.pos.x - pp.x) * Math.sin(facing) + (d.pos.z - pp.z) * Math.cos(facing) > 0) {
      if (dist(d.pos, pp) <= DB) d.debil = time + DEBIL.time; if (dist(d.pos, pp) <= BS) d.st.blind = Math.max(d.st.blind || 0, BLIND.time); if (dist(d.pos, pp) <= WP) expo(d, ELEM); }   // Window to Paradise: Elemental Exposure
    for (const d of dummies) { const inP = !d.dead && dist(d.pos, pp) <= sheet().overgrow.r; if (HD && inP && !d.inPres) d.intim = Math.max(d.intim || 0, time + HD.dmg.sum[HK] / 1000); const PW = sheet().presWither; if (PW && inP && !d.inPres && !d.wither?.some(u => u.until > time)) withers(d, PW); if (sheet().presAggr && inP && !d.inPres && d.st.bleed > 0 && d.burn.bleed && !d.burn.bleed.agg) { d.burn.bleed.agg = true; fx.text(over(d), t('Aggravated Bleeding'), css('blood'), .32); }   /* Beetlebite */ if (d.inPres && !inP) d.leftAt = time; if (inP && !d.inPres) d.enterAt = time; d.inPres = inP; }   // the tree's: Withered on entering your Presence
    daemons();
    divine = divine.filter(f => f.until > time || f.dec.remove());
    if (sheet().ordained && time - (me.fragAt ?? -9) >= DIVINE.every) { me.fragAt = time; const p = around(pp, sheet().overgrow.r); divine.push({ p, until: time + DIVINE.time, dec: fx.decal(p, .35, 'rune', 'lightning', { a: .8, spin: 1 }) }); }
    // Vestige of Darkness: the Bodach manifests every its seconds (faster per Power of the enemies in your Presence, a random
    // delay more), Blinding the enemies in your Presence
    const WG = sheet().wendigo; if (WG && time >= (me.wendigoAt ?? 0)) { const ins = inside(pp, sheet().overgrow.r); me.wendigoAt = time + WG.every / (1 + WG.faster * ins.reduce((t, d) => t + pow(d), 0) / 100) + Math.random() * WG.rand; for (const d of ins) d.st.blind = Math.max(d.st.blind || 0, BLIND.time); if (ins.length) fx.ring(pp, .3, sheet().overgrow.r, 'curse', .5, { a: .4 }); }
    if (sheet().auspex && time - (me.auspexAt ?? -9) >= 1) { me.auspexAt = time; for (const d of inside(pp, sheet().overgrow.r)) madness(d); }   // The Auspex: 1 Gruelling Madness each second in your Presence
    // The Hammer of Faith: every its interval a random lesser (non-damaging) Shrine's buff for that Shrine's duration (skills.json lesser_shrines)
    const HF = sheet().shrineEvery, LS = SK.lesser_shrines || [];
    if (HF && LS.length && time - (me.shrineAt ?? -99) >= HF) { me.shrineAt = time; const r = LS[Math.floor(Math.random() * LS.length)]; me.shrineBuff = { stats: r.stats, until: time + r.duration }; setBuff({ label: tn(r), c: css('gold'), s: r.duration }); shC.at = -99; }
    // uniques: enemies in your Presence Blinded (Sandstorm Visage), Intimidated (Perfidy), Hindered (Amor Mandragora), while they are in it
    const PS = sheet().presence || {};
    if (PS.blind || PS.intim || PS.hinder) for (const d of dummies) if (d.inPres) {
      if (PS.blind) d.st.blind = Math.max(d.st.blind || 0, .25); if (PS.intim) d.intim = Math.max(d.intim || 0, time + .25);
      if (PS.hinder) { const h = d.presSlow ||= { pct: -HINDER.slow }; if (!d.slows.includes(h)) d.slows.push(h); h.until = time + .25; }
    }
    { const G2 = sheet().uDef?.glory2; if (G2 && time - (me.glory2At ?? 0) >= 2) { me.glory2At = time; for (const S of gloryOf()) gloryAdd(S, G2); } }   // Fury of the King: skills which require Glory generate some every 2 seconds
    if (PS.weak && time - (me.presWeakAt ?? -99) >= 1) { me.presWeakAt = time; for (const d of dummies) if (d.inPres && !d.dead) weaken(d, 1, PS.weak); }   // Sandstorm Visage: every second, Critical Weakness for its seconds
    // Healing Runes: while the buff it supports is on, every its interval you lose up to its % of your maximum Ward and
    // heal its % of what you lost, split between your minions not on full life. note: who counts as nearby is not in
    // its data (the scene's: all your minions; you are not healed), nor whether Ward is lost with none to heal (here it is not)
    const HR = Object.keys(tog).map(onS).find(S => S?.dmg?.sum?.support_healing_runes_healing_pulse_interval_ms)?.dmg.sum;
    if (HR && time - (me.runesAt ?? -99) >= HR.support_healing_runes_healing_pulse_interval_ms / 1000) {
      me.runesAt = time; const hurt = objs.filter(o => o.minion && !o.dead && o.segs?.[0].life < o.segs[0].max), w = Math.min(me.ward, me.maxW * HR['support_healing_runes_maximum_ward_spent_per_pulse_%'] / 100);
      if (hurt.length && w > 0) { me.ward -= w; for (const o of hurt) { const g = o.segs[0]; g.life = Math.min(g.max, g.life + w * HR['support_healing_runes_healing_per_ward_spent_%'] / 100 / hurt.length); fx.glow({ x: o.pos.x, y: 1, z: o.pos.z }, .6, 'gold', .3); } }
    }
    // Ravenous Swarm: while it is on and an enemy is in its area, a swarm emerges from you at its interval, for its
    // duration, up to its most (the oldest gives way). note: the cooldown rate that speeds it up is not in the scene
    const RS = onS('Ravenous Swarm'), rs = RS?.dmg.stats;
    if (rs && near(pp, RS.A) && time - (me.swarmAt ?? -99) >= rs.base_cooldown_modifiable_repeat_interval_ms / 1000) {
      me.swarmAt = time; limit(o => o.kind === RS.name, tmpN(rs.ravenous_swarm_maximum_swarm_count)); minion(RS, around(pp, 1), durOf(RS), { kind: RS.name });
    }
    const SW = onS('Sorcery Ward')?.dmg.stats, GD = onS('Ghost Dance')?.dmg.stats;
    if (!SW) me.aegis = 0; else if (time - (me.aegisAt ?? -99) >= SW.aegis_recharge_delay_ms / 1000) me.aegis = ((c.armour || 0) + (c.evasion || 0)) * SW['aegis_unique_shield_max_value_from_%_armour_evasion'] / 100;
    if (!GD) me.ghost = 0; else {
      me.ghost = Math.min(GD.ghost_dance_max_stacks, (me.ghost || 0) + dt * 1000 / GD.base_cooldown_modifiable_repeat_interval_ms);
      if (time - (me.ghostAt ?? -99) <= RECENT) me.es = gain(me.es, me.maxE, (c.evasion || 0) * GD['skill_base_ghost_dance_grants_%_evasion_as_es_regeneration_per_minute_if_have_lost_ghost_dance_shroud_recently'] / 100 / 60 * dt);
    }
    me.wounds = (me.wounds || []).filter(w => w.until > time); for (const w of me.wounds) me.life -= w.rate * dt; if (me.life <= 0 && me.known) died('?');   // Grasping Wounds
    if (me.demon) { me.life -= demon() * me.demon.st.demon_form_life_loss_per_minute_per_stack / 60 * dt; if (me.life <= 1) { me.life = 1; demonOff(); } }
    // Primal Bounty (Spirit Walker, OWL): an Owl Feather every 4 s (its % faster), up to 3 ("Gain a Primal Owl Feather every
    // 4 seconds, up to a maximum of 3", stat_texts owl_feather_max_bonus_to_stack)
    const OW = sheet().owl; if (OW) { me.owlT = (me.owlT || 0) + dt * (1 + OW.faster / 100); if (me.owlT >= OWL.every) { me.owlT = 0; if ((me.owls || 0) < OWL.max) { me.owls = (me.owls || 0) + 1; hudT = 0; } } }
    const MB = magma()?.dmg.stats; me.lava = MB ? Math.min(1, (me.lava || 0) + dt * 1000 / (MB.igneous_shield_charge_up_time_ms * (1 + MB['igneous_shield_charge_up_time_+%'] / 100))) : 0;
    for (const S of remnantSkills()) { const R = REMNANT[S.name], s = rstats(S); if (R.spawn && time - (remnantAt[S.name] ?? -99) >= R.spawn(s) / 1000) { remnantAt[S.name] = time; remnant(S, around(pp, s.breach_flame_spawn_radius / 10)); } }   // Flames, Blooms
    const SP = me.spectral; if (SP && time - SP.at >= SP.wait) { me.spectral = null; for (let k = 0; k < SP.n; k++) later(k * SP.every, () => { const X = { ...SP.S, spent: 0 }; aim(X, near(pp, 15)?.pos ?? { x: pp.x + SP.S.dx, z: pp.z + SP.S.dz }); K.projectile(X); }); }   // Spectral Volley
    const LR = banner('life_regeneration_per_minute'); if (LR) me.life = gain(me.life, me.maxL, LR / 60 * dt);
    // Consecrated Ground: on it you regenerate 5% of your maximum life a second (keywords.json), more by its effect (Consecrate)
    const CG = holyAt();
    if (CG) me.life = gain(me.life, me.maxL, me.maxL * .05 * (1 + (CG.S?.dmg?.stats?.['consecrated_ground_effect_+%'] || 0) / 100) * dt);
    // Gloomform: a Smoke Cloud of its radius around you while stationary; the enemies standing in it are Blinded (KeywordPopups SmokeCloud)
    if (sheet().smoke && !walk && !move) for (const d of inside(pp, sheet().smoke)) d.st.blind = Math.max(d.st.blind || 0, .2);
    // Dread Banner's flask charges, Alchemist's Boon's while it is on
    const FC = banner('flask_charge_per_min') + (onS("Alchemist's Boon")?.dmg.stats.skill_alchemists_boon_generate_x_charges_for_any_flask_per_minute || 0); const GN = sheet().chargeGen || [];
    const RG2 = sheet().griefIgnite; if (RG2 && time - (me.griefAt ?? -9) >= 1) { me.griefAt = time; const X = thornX({ hits: {} }, 'Radiant Grief'); for (const d of inside(pp, sheet().overgrow.r)) inflict(d, 'ignite', X, 1, { fire: RG2 }, {}); }   // Radiant Grief: enemies in your Presence Ignited as though dealt its base fire damage (note: once a second here)
    const FD = shrineOn()?.generate_x_charges_for_any_flask_per_minute || 0;   // a monster's aura draining them
    flasks().forEach((f, n) => { const g = FC + FD + (GN[n] || 0) + (f?.regen || 0); if (f && g) me.fl[n] = Math.max(0, Math.min(f.max, flaskLeft(n) + g / 60 * dt)); });   // with the tree's per flask, a flask's own (Sanguis Heroum)
    if (GN[2]) charms().forEach((f, n) => { if (f) me.cc[n] = Math.min(f.max, charmLeft(n) + GN[2] / 60 * dt); });   // and per charm
    const WD = onS('Wind Dancer')?.dmg.stats; if (WD) me.wind = Math.min(WD.wind_dancer_maximum_number_of_stages, me.wind + dt * 1000 / WD.wind_dancer_stages_gained_every_x_ms);
    const AA = arcticS()?.dmg.stats; if (AA && time - (me.movedAt ?? -99) > .1) me.arctic = Math.min(AA.maximum_number_of_arctic_armour_stationary_stacks, me.arctic + dt * 1000 / AA.base_active_skill_buff_stack_gain_frequency_ms);
    const TR = trinity(); if (TR) for (const e of ELEM) if (time - (me.affAt[e] ?? -99) > TR.trinity_resonance_decay_delay_ms / 1000) me.aff[e] = Math.max(0, me.aff[e] - TR.trinity_resonance_loss_per_second * dt);
    for (const S of gloryOf()) if (/Banner/.test(S.name) && S.dmg?.sum?.banners_gain_X_glory_per_second) gloryAdd(S, S.dmg.sum.banners_gain_X_glory_per_second * dt);   /* Tactician: Banners gain Glory every second */
    for (const n in me.glory) if (time - (me.gloryAt[n] ?? -99) > GLORY_IDLE) me.glory[n] = Math.max(0, me.glory[n] - GLORY_LOSS * dt);
    me.safe = Math.max(0, me.safe - dt);
    const VS = sheet().vivid; if (VS) { me.vmov = (me.vmov || 0) + Math.hypot(pp.x - (me.vp?.x ?? pp.x), pp.z - (me.vp?.z ?? pp.z)); me.vp = { x: pp.x, z: pp.z };   // a Vivid Wisp per its metres moved
      if (me.vmov >= VS.per) { me.wisps = Math.min(VS.max, (me.wisps || 0) + Math.floor(me.vmov / VS.per)); me.vmov %= VS.per; } }
    if (me.fallen.length && time >= me.reviveAt) { me.reviveAt = Infinity; reviveFallen(Infinity); }
    beetles(); clerics();
    const RU = sheet().rareGlory; if (RU) { me.rg = (me.rg || 0) + dt * dummies.filter(d => !d.dead && ['rare', 'unique'].includes(d.stat.rarity) && dist(d.pos, pp) <= sheet().overgrow.r).length / RU; if (me.rg >= 1) { for (const S of gloryOf()) gloryAdd(S, Math.floor(me.rg)); me.rg %= 1; } }   // Glory per rare or unique monster in your Presence
    const DX = 1 + (sheet().debuffTime || 0) / 100;   // debuffs on you expire faster (the tree's Debuff Expiry Rate)
    for (const a in me.st) if (me.st[a] > 0) me.st[a] -= dt * DX;
    for (const a in me.lock) me.lock[a] -= dt;
    // Volatility explodes after its fuse: its physical damage to you per stack (none if immune), then Volatile Power
    if (me.vol > 0 && time - me.volAt >= VOLATILITY.fuse * (sheet().volFuse ?? 1)) volBlow();
    if (me.flame > 0) me.flame = Math.max(0, me.flame - me.maxM * (sheet().flame?.decay || 0) / 100 / 60 * dt);   // Infernal Flame lost over time
    // Seething Body: Elemental Archon does not expire on High Infernal Flame
    if (sheet().earch?.keep && time < me.earch && me.flame >= me.maxM * HIGH_FLAME) { me.earch = Math.max(me.earch, time + .2); const B = buffs.find(b => b.earch); if (B) B.s = Math.max(B.s, .2); }
    if (!(time < me.earch) && buffs.some(b => b.earch)) buffs = buffs.filter(b => !b.earch);   // Elemental Archon lost early (an attack, the most Flame)
    for (let i = me.flam.length - 1; i >= 0; i--) if ((me.flam[i].s -= dt) <= 0) me.flam.splice(i, 1);
    if (time < me.chalice) { flaskGain(0, CHALICE.charges * dt); flaskGain(1, CHALICE.charges * dt); }   // Overflowing Chalice
    // Arbiter's Reach: every 6 s, Guard of 10% of your maximum life on the allies in your Presence for its time (its stat text)
    const MW = sheet().motherWard; if (MW && time >= (me.mwAt ?? -99) + 6) { me.mwAt = time; for (const o of objs) if (o.minion && !o.dead && dist(o.pos, pp) <= sheet().overgrow.r) o.guard = { n: me.maxL * .1, until: time + MW / 1000 }; }
    // your freeze and stun bars empty after a while without buildup (character.ot poise decay)
    // your Heavy Stun bar does not empty while you block yourself (keywords.json HeavyStunPlayer), nor for the skill's own time after
    { const G = [me.raised, me.parry, me.reprieve].find(x => time < x?.until); if (G) me.poiseHold = time + (G.S?.dmg?.stats?.active_skill_heavy_stun_decay_after_action_delay_ms || 0) / 1000; }
    if ((me.calm += dt) * 1000 > GAME.player_poise_decay_delay_ms) for (const a in me.bar) if (a !== 'stun' || !(time < me.poiseHold)) me.bar[a] = Math.max(0, me.bar[a] - GAME.player_poise_decay_per_second * dt * (a === 'stun' ? 1 + (sheet().stunDecay + (time - (me.parryAt ?? -99) <= RECENT ? sheet().stunDecayParry : 0)) / 100 : 1));   // the tree's Heavy Stun buildup emptying faster (Resolute Reprisal: if you Parried Recently)
    if ((me.tick -= dt) <= 0) {   // ignite, bleeding and poison after your resistances (bleeding ignores armour), one number per tick
      me.tick = .5; let n = 0, chaos = 0, worst = 'fire', best = 0, bled = 0, bEl = 'physical';
      // bleeding: its extra damage while you move, and it bypasses energy shield (keywords.json Bleeding)
      for (const a in me.burn) if (me.st[a] > 0) {
        const B = me.burn[a], got = playerTakes(withCharms(c), B.el, B.dps, false) * .5 * (a === 'bleed' && time - (me.movedAt ?? -9) < .5 && !sheet().uDef?.noBleedMove ? AGGRAVATED : 1);
        if (a === 'bleed') { bled += got; bEl = B.el; continue; }
        n += got; if (B.el === 'chaos') chaos += got; if (got > best) { best = got; worst = B.el; }
      }
      if (bled > 0) hurt(bled * heart(), 0, bEl, false, me.by, false, true);
      // Grinning Immolation: ignited after dealing a critical hit, its % of your maximum life and energy shield as fire a second
      const GI = c.grin && meIs.CritRecently() ? playerTakes(withCharms(c), 'fire', (me.maxL + me.maxE) * c.grin / 100, false) * .5 : 0;
      if (GI) { n += GI; if (GI > best) worst = 'fire'; }
      if (n > 0) { const k = heart(); hurt(n * k, chaos * k, worst, false, me.by, false, !!c.uDef?.doubt); }
    }
    const p = { x: pp.x, y: .9, z: pp.z }, S = me.st;
    if (S.ignite > 0 && Math.random() < dt * 22) fx.emit(1, { p, r: .25, h: .8, v: .2, up: 1.8, life: .5, size: .32, c: 'fire', c2: 'ember' });
    if (S.shock > 0 && Math.random() < dt * 9) fx.emit(2, { p, r: .3, h: 1, v: 1.6, life: .18, size: .13, c: 'lightning', c2: 'white', k: 3 });
    if (S.poison > 0 && Math.random() < dt * 8) fx.emit(1, { p, r: .3, h: .8, v: .1, up: .8, life: .9, size: .16, c: 'poison' });
    if (S.bleed > 0 && Math.random() < dt * 8) fx.emit(1, { p, r: .25, h: .6, v: .3, life: .6, size: .1, c: 'blood', g: 9, k: 1.2 });
    if (S.stun > 0 && Math.random() < dt * 10) fx.emit(1, { p: { x: pp.x, y: 2.1, z: pp.z }, r: .35, v: .4, life: .5, size: .14, c: 'white', c2: 'gold' });
    if ((S.chill > 0 || S.freeze > 0) && Math.random() < dt * (S.freeze > 0 ? 20 : 6)) fx.emit(1, { p, r: .4, h: 1.2, v: .1, up: -.3, life: 1, size: .12, c: 'ice' });
    // Executioner's Presence: life and energy shield cannot recover above its share of their maximum (what they were is kept)
    const CAP = shrineOn()?.['cannot_recover_life_or_energy_shield_above_%'];
    if (CAP) { me.life = Math.min(me.life, Math.max(me.capL ?? me.life, L * CAP / 100)); me.es = Math.min(me.es, Math.max(me.capE ?? me.es, E * CAP / 100)); }
    me.capL = me.life; me.capE = me.es;
    const RG = regenNow(c), RL = c.lowCap ? L * LOW : L, PU = c.regenPulse;   // Cat O' Nine Tails: recovery other than flasks only up to Low Life
    if (PU && RG.life > 0 && time - (me.pulseAt ?? -9) >= 4) { me.pulseAt = time; me.life = Math.min(RL, me.life + RG.life * 60 / PU); }   // Igniferis: no regeneration, its life every 4 s instead
    // Rip's faster regeneration; Zealot's Oath: what would go over maximum life goes to energy shield; Vaal Pact: no life but from leech
    const LG = RG.life > 0 && !c.vaal && !PU ? RG.life * (time < me.rip?.until ? 1 + me.rip.rate / 100 : 1) * (c.surgeLife ? 1 + ARCANE.regen * surge() / 100 : 1) * dt : 0, LI = Math.max(0, Math.min(LG, RL - me.life));
    if (c.lifeToEs) me.es = Math.min(E, me.es + LG); else { me.life += LI; if (c.zealot && LG > LI && me.es < E) me.es = Math.min(E, me.es + LG - LI); }   // Ligurium Talisman: all of it to energy shield
    if (c.uDef?.doubt && me.life < L) { const m = Math.min(me.mana, L - me.life, (c.mana || 0) * c.uDef.doubt / 100 * dt); me.mana -= m; me.life += m; }   // The Black Doubt (its damage over time bypassing energy shield: hurt())
    if (c.lifeDegen) me.life = Math.max(1, me.life - L * c.lifeDegen / 6000 * dt);   // uniques' loss of maximum life a second (note: it stops at 1 here)
    if (c.esDegen) me.es = Math.max(0, me.es - E * c.esDegen / 6000 * dt);
    if (c.furyGround && (walk || move) && time - (me.furyAt ?? -9) >= .5) { me.furyAt = time; ground('burning', { x: pp.x, z: pp.z }, .8, 8, { el: 'fire', els: ['fire'], ail: ['ignite'], src: 'ground', label: 'Birth of Fury', raw: { fire: L * c.furyGround / 100 } }); }   // Birth of Fury: Ignited Ground while moving, 8 s (note: its radius is not in the data)
    if (c.shockTrail && (walk || move) && time - (me.wakeAt ?? -9) >= .5) { me.wakeAt = time; ground('shocked', { x: pp.x, z: pp.z }, .8, 8, { el: 'lightning', els: ['lightning'], ail: ['shock'], src: 'ground', label: 'Wake of Destruction' }); }   // Wake of Destruction: Shocked Ground while moving, 8 s (note: its radius is not in the data: Birth of Fury's here)
    if (c.divinity) me.div = Math.min(c.divinity, (me.div ?? c.divinity) + c.divinity * .25 * dt);   // Divinity regenerates 25% a second (KeywordPopups Divinity)
    if (c.regrow) me.regrow = Math.min(c.regrow.max, (me.regrow || 0) + c.regrow.gain * dt);   // Dustbloom: Fragile Regrowth a second, up to its most
    if (c.bloodPrice) for (const d of inside(pp, c.overgrow.r)) d.life = Math.min(d.life, d.max * (1 - c.bloodPrice / 100));   // Blood Price: enemies in your Presence keep that share reserved
    if (c.diadem && time - (me.diademAt ?? -9) >= 3) { const d = corpseAt(pp, c.overgrow.r); if (d) { me.diademAt = time; eat(d, 'blood'); me.life = Math.min(L, me.life + L * c.diadem / 100); } }   // The Devouring Diadem (note: "nearby" is not in the game's data: your Presence here)
    // leech recovers at its rate and is removed when the pool is full (Life Leech III's life leech is not)
    for (const [r, top] of [['life', RL], ['mana', c.mana || 0]]) {
      const q = me.leech[r], rk = r === 'life' ? c.recMore ?? 1 : 1; if (!(q.left > 0) || r === 'mana' && c.manaRegenOnly) continue;   // Indigon: no mana leech   // rk: a map's less recovery rate of life (leech, recoup and flasks below: slower, the same in all)
      if (r === 'life' && c.leechEs || r === 'mana' && c.manaLeechEs) { const n = Math.min(q.left, q.rate * rk * dt); if (me.es < E) me.es = Math.min(E, me.es + n); if (r === 'life') { q.left -= n; if (me.es >= E) q.left = 0; continue; } }   // Essentia Sanguis: life leech as energy shield leech, mana leech recovering it as well
      // Couture of Crimson: life leech Overflows; Soul Tether: what goes over maximum life to energy shield
      const cap = r === 'life' && c.leechOver ? top * OVERFLOW : top, toES = r === 'life' && c.leechToEs && me.es < E;
      if (me[r] >= cap && !q.keep && !toES) { q.left = 0; continue; }
      const n = Math.min(q.left, q.rate * rk * dt), room = Math.max(0, cap - me[r]); q.left -= n; me[r] = Math.min(cap, me[r] + n); if (toES && n > room) me.es = Math.min(E, me.es + n - room);
    }
    // Meditate: while you channel it your energy shield recharges at its more rate, without the delay, and can Overflow;
    // a hit ends it (hurt), as does a full Overflow
    const MD = held && base(held.i)?.kind === 'meditate' && base(held.i).dmg?.stats?.['meditate_energy_shield_recharge_rate_+%_final'];
    if (typeof MD === 'number' && E) { me.es = Math.min(E * OVERFLOW, me.es + (c.esRecharge || 0) * (1 + MD / 100) * dt); if (me.es >= E * OVERFLOW) held = null; }
    else if (c.lifeRecharge && !c.vaal && me.life < RL && time - me.hurt >= (c.esDelay ?? 4)) me.life = Math.min(RL, me.life + c.lifeRecharge * dt);   // Eternal Youth
    else if (me.es < E && (time < (me.ebarT ?? -99) || time - Math.max(me.esHurt ?? me.hurt, me.esStop ?? -99) + (me.esEarly || 0) >= (c.esDelay ?? 4) * (shifted()?.esDelay || 1) * (me.life < me.maxL ? c.esDelayHurt || 1 : 1) * (time - (me.stunAt ?? -99) <= RECENT ? c.esDelayStun || 1 : 1) * (meIs.Archon() ? c.esDelayArchon || 1 : 1))) me.esRech ??= recharging(), me.es = Math.min(E, me.es + (c.esRecharge || 0) * (shifted()?.esRecharge || 1) * (me.es <= E * LOW ? 1 + (c.esLowMore || 0) / 100 : 1) * dt);
    // mana regenerates; Rage regenerates from its gem while that is on, is lost once the delay passes without gaining
    // any, and Berserk costs life per Rage while Rage is not being lost
    const M = c.mana || 0;
    if (M !== me.maxM) { me.mana = me.maxM ? me.mana / me.maxM * M : M; me.maxM = M; }
    const MM = c.kurgal ? M * OVERFLOW : M;
    if (RG.mana > 0 && me.mana < MM) me.mana = Math.min(MM, me.mana + RG.mana * (c.surgeLife ? 1 : 1 + ARCANE.regen * surge() / 100) * dt);   // Kurgal's Ambition: it Overflows; Sanguimantic Rituals: Arcane Surge's goes to life regeneration
    else if (RG.mana < 0) me.mana = Math.max(0, me.mana + RG.mana * dt);   // more lost than regenerated (Lich)
    // Tecrod's Brutality: life a second for the life skills cost in its last seconds
    if (c.tecrod) { me.spent = (me.spent || []).filter(x => time - x.t <= c.tecrod.secs); const TR = me.spent.reduce((s, x) => s + x.n, 0) / c.tecrod.per; if (TR > 0 && !c.vaal) me.life = Math.min(RL, me.life + TR * dt); }
    // Veilpiercer: a Dark Whisper a second while a Cursed enemy is in your Presence; when they expire, their loss over time
    if (c.whispers) {
      if (!dummies.some(d => !d.dead && d.curse && dist(d.pos, pp) <= c.overgrow.r)) me.whispT = 0;
      else if ((me.whispT = (me.whispT || 0) + dt) >= 1) { me.whispT -= 1; me.whisp = { n: Math.min(WHISPER.max, (me.whisp?.n || 0) + c.whispers), until: time + WHISPER.time }; }
      if (me.whisp && time >= me.whisp.until) { for (const [k, M] of [['life', me.maxL], ['mana', me.maxM], ['es', me.maxE]]) { const n = M * WHISPER.loss * me.whisp.n / 100; if (n > 0) (me.drain ||= []).push({ k, left: n, rate: n / WHISPER.over }); } me.whisp = null; }
    }
    if (me.drain) me.drain = me.drain.filter(R => { const n = Math.min(R.left, R.rate * dt); R.left -= n; me[R.k] = Math.max(R.k === 'life' ? 1 : 0, me[R.k] - n); return R.left > 0; });   // note: this loss does not kill here
    me.recoup = me.recoup.filter(R => { const n = R.k === 'life' && c.vaal ? 0 : Math.min(R.left, R.rate * (R.k === 'mana' ? 1 : c.recMore ?? 1) * dt), top = R.k === 'life' ? L : R.k === 'mana' ? me.maxM : c.scarred ? Math.min(E, c.armour || 0) : E;   /* Vaal Pact; Scarred Faith: not above armour */ R.left -= n; me[R.k] = Math.min(Math.max(me[R.k], top), me[R.k] + n); return R.left > 0; });   // Recoup
    me.drink.forEach((D, n) => {   // a flask recovers its amount over its time
      if (!D) return; const got = D.rate * (D.k === 'life' ? c.recMore ?? 1 : 1) * Math.min(D.s, dt); D.s -= dt;   // a life flask recovers less a second for its time
      flaskHeal(D, got); const F = flasks()[n] || {};
      const AB = D.k === 'life' && onS("Alchemist's Boon")?.dmg.stats['recovery_from_flasks_applies_to_allies_in_presence_%'];   // Alchemist's Boon: its share to your minions in your Presence
      if (AB) for (const o of objs) { const s = o.minion && !o.dead && dist(o.pos, pp) <= sheet().overgrow.r && o.segs?.[0]; if (s) s.life = Math.min(s.max, s.life + got * AB / 100); }
      if (D.k === 'life') flaskAllies(got);
      if (F.wardRegen && me.maxW) me.ward = gain(me.ward, me.maxW, me.maxW * F.wardRegen / 6000 * dt);   // Olroth's Resolve: maximum Runic Ward a second during its effect
      if (F.noWard && !(me.ward > 0)) me.life = Math.max(1, me.life - L * F.noWard / 6000 * dt);   // Uhtred's Chalice: life lost while you have no Runic Ward
      if (F.nova && (D.nt -= dt) <= 0) { D.nt += 3; const m = (me.spentM || 0) - D.m0; D.m0 = me.spentM || 0; if (m > 0) for (const e of inside(pp, 3)) damage(e, takes(e, 'chaos', m * F.nova / 100), { src: 'flask', label: flaskName(n), el: 'chaos' }); fx.ring(pp, 3, .4, 'chaos', .4); }   // Melting Maelstrom: the mana spent in those 3 s as chaos to enemies within 3 m
      if (D.s <= 0 || D.k === 'life' && me.life >= L && !sheet().elixir && !F.keepFull) { me.drink[n] = null; if (F.wardGuard && me.ward > 0) guardFor(me.ward * F.wardGuard / 100, F.wardGuardMs / 1000); if (F.endChaos) { const x = me.mana * F.endChaos / 100; hurt(x, x, 'chaos'); } }   // when its effect ends (a life flask's when your life is full, unless Enduring Elixirs): Olroth's Guard of current Runic Ward, Melting Maelstrom's chaos damage to you
    });
    for (const f of flasks()) if (f?.always) { flaskHeal(f, f.amount / f.time * dt); if (f.k === 'life') flaskAllies(f.amount / f.time * dt); }   // one that applies its effect constantly recovers all the time
    me.cu.forEach((u, n) => { if (u && (u.s -= dt) <= 0) { me.cu[n] = null; if (u.c.guard) me.guard = 0; } });
    const R = c.rage, top = rageMax();
    if (!top) { me.rage = 0; return; }
    if (R.regen && tog[R.regen.name]) gainRage(R.regen.perSec * dt);
    if (R.regenPct) gainRage(R.regenPct * top * dt);   // Furious Wellspring: its share of maximum Rage a second
    // Primal Hunger: 1 Rage a second per 4 spent Recently
    if (R.noEffect) { me.rageSpent = (me.rageSpent || []).filter(x => time - x[0] <= RECENT); gainRage(Math.floor(me.rageSpent.reduce((t, x) => t + x[1], 0) / 4) * dt); }
    if (time < me.calamity?.until) gainRage(me.calamity.rage / 60 * dt);
    if (time - me.raged > R.delay && !flaskOn('noRageLoss')) me.rage = Math.max(0, me.rage - R.loss * dt);   // (Blood of the Warrior: no inherent loss during its effect)
    me.rage = Math.min(me.rage, top);
    if (R.berserk && tog[R.berserk.name] && me.known && me.rage > 0 && time - me.raged <= R.delay) {
      me.life -= me.maxL * R.berserk.lifePerRage / 100 * me.rage * dt;
      if (me.life <= 0) died(api.info(api.build().gems.find(g => g.name === R.berserk.name)).label);
    }
  }
  function tickHazards(dt) {
    // the map's patches, on you while you stand on one, as your own ground is on enemies: Ignited Ground ignites you (the
    // fire damage it deals per 10 seconds, a second), Chilled Ground chills by its magnitude, Shocked Ground shocks at the
    // game's base magnitude; with your own ailment effects, durations and chances to avoid them
    // note: the Flammability the glossary says Ignited Ground builds up before it ignites is not simulated
    for (const p of patches) {
      if (Math.random() < dt * (3 + p.r * p.r * 3)) groundFx(p);
      if ((p.tick -= dt) > 0) continue;
      p.tick = .5;
      const D = sheet().ailments, a = GAIL[p.type];
      if (me.safe > 0 || !me.known || !D?.ail || dist(p, pp) > p.r || Math.random() * 100 < (D.avoid[a] || 0)) continue;
      if (a === 'ignite') { me.by = { mon: { name: t('Ignited Ground') } }; suffer(a, DUR.ignite * D.dur.ignite, { dot: { dps: p.v / 10 * D.eff.ignite, el: 'fire' } }); }   // what its damage is named after
      else if (a === 'shock') suffer(a, .6, { mag: GC.BaseShockMagnitude * D.eff.shock });
      else if (!frozen()) suffer(a, .6, { mag: Math.min(GC.ChillMaxEffect, p.v * D.eff.chill) });
    }
    for (let i = hazards.length - 1; i >= 0; i--) {
      const h = hazards[i]; h.s -= dt; h.tick -= dt;
      if (h.s <= 0) { h.decal.remove(); hazards.splice(i, 1); continue; }
      if (Math.random() < dt * 9) fx.emit(1, { p: { x: h.x + rnd(-h.r, h.r) * .65, y: .1, z: h.z + rnd(-h.r, h.r) * .65 }, v: .2, up: 1, life: .7, size: .26, c: h.el });
      if (h.tick > 0) continue;
      h.tick = .5;
      if (me.safe > 0 || dist(h, pp) > h.r) continue;
      const c = withCharms(sheet()); let n = 0, chaos = 0;
      for (const el in h.dot) { const got = playerTakes(c, el, h.dot[el], false) * .5; n += got; if (el === 'chaos') chaos += got; }
      const k = heart(); hurt(n * k, chaos * k, h.el, false, h.d, false, !!c.uDef?.doubt);
    }
  }
  // Heartstopper: 50% less damage over time for a second after it starts, 50% more after (its start: none in the tick before)
  // Keeper of the Arc: less damage over time taken every other 5 s, the ones without its less damage from hits
  function heart() {
    const S = sheet(), KA = S.uDef?.alt && Math.floor(time / 5) % 2 ? 1 + S.uDef.alt / 100 : 1;
    if (!S.heart) return KA;
    if (!(time - (me.dotLast ?? -99) <= .6)) me.dotStart = time;
    me.dotLast = time; return KA * (time - me.dotStart <= 1 ? .5 : 1.5);
  }
  function step(dt) {
    // movement: a roll or a dash, else W A S D or the stick (not while a skill is being used: note: the game's own lock is
    // the skill's animation, the scene's the .3 s its cast pose lasts), else to the point clicked
    let moving = false;
    const P = pad(), wasd = settings().input === 'wasd' && !held && (keys.KeyW || keys.KeyA || keys.KeyS || keys.KeyD);
    steer = P?.move || (wasd ? onGround((keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0), (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0)) : null);
    if (move) {
      const m = move; m.k = Math.min(1, m.k + dt / m.dur); moving = true;
      // Trail of Caltrops: its caltrops (its projectiles) within its secondary radius of you, for its duration
      while (m.drops?.[0] <= m.k) { m.drops.shift(); const S = m.TC; for (let k = 0; k < (sh(S).projectiles || S.dmg.stats.base_number_of_projectiles || 1); k++) { limit(o => o.hazard && o.name === S.name, S.dmg.stats.maximum_caltrops_allowed, S); hazardAt(S, around(pp, radOf(S)), durOf(S)); } }   // up to its most caltrops
      pp.x = m.from.x + (m.to.x - m.from.x) * m.k; pp.z = m.from.z + (m.to.z - m.from.z) * m.k; pp.y = Math.sin(m.k * Math.PI) * m.h;
      if (m.powder) {   // the trail off your foot: dark smoke and fire
        fx.emit(2, { p: { x: pp.x, y: pp.y + .3, z: pp.z }, r: .08, v: .2, up: .3, life: .7, size: .35, grow: 1.6, c: BP.trail, smoke: true, a: .6 });
        fx.emit(2, { p: { x: pp.x, y: pp.y + .3, z: pp.z }, r: .06, v: .3, up: .4, life: .25, size: .22, c: BP.fire, c2: BP.glow, k: 1.8, drag: 2 });
      }
      if (m.S) {
        fx.emit(2, { p: { x: pp.x, y: pp.y + .8, z: pp.z }, r: .3, v: .5, life: .35, size: .3, c: m.S.el, c2: 'white' });
        if (m.jag && (m.step -= dt) <= 0) { m.step = .06; ground('jagged', pp, m.S.A, m.jag, m.S); }   // Stampede's footsteps (note: their spacing is the scene's)
        if (!m.h) for (const d of dummies) if (!d.dead && !m.seen.has(d) && dist(d.pos, pp) <= 1 + SIM.body) { if (m.crash) { m.k = 1; m.to = { x: pp.x, z: pp.z }; break; } m.seen.add(d); hit(d, m.S, { mult: .6, noPay: true }); }
      }
      if (m.k >= 1) { pp.y = 0; move = null; m.land?.(m.to); if (m.roll && rollHeld() && !sheet().noSprint) { me.sprint = { at: time }; say(t('Sprinting'), 'gold'); } }
    } else if (me.sprint) {
      // Sprint: after a roll, while its key stays held (at least its least time), toward W A S D / the stick or the cursor,
      // turning at its turn rate, faster by its movement speed (character.ot, plus the tree's and gear's); using a skill ends it
      const C = sheet().sprint, go = steer || (() => { const x = cursor.x - pp.x, z = cursor.z - pp.z, l = Math.hypot(x, z); return l > .3 ? { x: x / l, z: z / l } : null; })();
      if (castAt > me.sprint.at || stuck() || (!rollHeld() && time - me.sprint.at >= C.min / 1000)) me.sprint = null;
      else {
        const QP = onS("Queen's Procession"), qs = QP?.dmg.stats;
        if (go) { let da = Math.atan2(go.x, go.z) - facing; da = Math.atan2(Math.sin(da), Math.cos(da)); const turn = (qs?.locust_sprint_turn_rate || C.turn) * Math.PI / 180 * dt; facing += clamp(da, -turn, turn); }
        const v = spd() * (1 + C.speed / 100) * slowed() * maimed() * dt; pp.x += Math.sin(facing) * v; pp.z += Math.cos(facing) * v; moving = true; goal = null;
        if (QP) locusts(QP, dt);
      }
    } else if (steer && (!charge || me.act != null) && !stuck()) {   // channelling: moving only if the skill lets you
      goal = null;
      if (!acting() || me.act != null) { const v = spd() * slowed() * maimed() * (acting() ? me.act : 1) * dt; pp.x += steer.x * v; pp.z += steer.z * v; moving = true; if (time - castAt > .45) facing = Math.atan2(steer.x, steer.z); }
    } else if (goal && !charge && !stuck()) {   // to the point clicked, following the cursor while the button is held
      if (walk) goal = { x: cursor.x, z: cursor.z };
      const mx = goal.x - pp.x, mz = goal.z - pp.z, l = Math.hypot(mx, mz), v = Math.min(l, spd() * slowed() * maimed() * (acting() ? me.act ?? 0 : 1) * dt);
      if (l > .15) { pp.x += mx / l * v; pp.z += mz / l * v; moving = true; if (time - castAt > .45) facing = Math.atan2(mx, mz); } else if (!walk) goal = null;
    }
    const far = Math.hypot(pp.x, pp.z); if (far > ROOM) { pp.x *= ROOM / far; pp.z *= ROOM / far; }   // the room's wall
    const step = Math.hypot(pp.x - (me.lastX ?? pp.x), pp.z - (me.lastZ ?? pp.z)); me.lastX = pp.x; me.lastZ = pp.z;
    if (step > 1e-4) { me.walked = (me.walked || 0) + step; me.trav += step; me.movedAt = time; }
    const KA = me.kaom; if (KA && time < KA.until && (KA.walked += step) >= KA.every) {
      KA.walked = 0;   // a Volcanic Step: a wave of fire on the ground from your feet, flames rising (hires_shockwave, fire_flare .mat)
      const c = { x: pp.x, z: pp.z }, R = KA.S.A; fx.ring(c, .3, R, 'fire', .4, { a: .7 }); fx.emit(30, { p: { x: c.x, y: .15, z: c.z }, r: .3, v: R * 2.2, flat: true, life: .4, size: .22, c: 'fire', c2: 'ember', drag: 1.5 });
      fx.emit(14, { p: { x: c.x, y: .1, z: c.z }, r: .4, up: 2.4, v: .8, life: .45, size: .3, c: 'fire', c2: 'ember', k: 1.8, drag: 1.5 }); area(c, R, KA.S, { soft: true }); }
    // Corpsewade: Decompose (the build's, as the boots grant it) triggered every its distance travelled, on a corpse near
    // you. note: how near is not in the data: the scene's targeting reach around you
    const CW = step > 1e-4 && sheet().corpsewade ? byName('Decompose') : -1;
    if (CW >= 0 && (me.cwWalked = (me.cwWalked || 0) + step) >= (base(CW)?.dmg?.stats?.trigger_on_X_units_travelled || Infinity) / 10) { me.cwWalked = 0; const d = corpseAt(pp, SIM.snap); if (d) use(CW, { at: { x: d.pos.x, z: d.pos.z }, src: 'meta' }); }
    kaomLook(dt); arcticLook(dt); rain.update(); faerieLook(); moths.update(); apoK = Math.max(0, Math.min(1, apoK + (time < (me.apo?.until ?? -9) ? dt * 2 : -dt))); arena.dim(apoK);
    let da = facing - player.group.rotation.y; da = Math.atan2(Math.sin(da), Math.cos(da)); player.group.rotation.y += da * Math.min(1, dt * 16);

    // camera and cursor
    camT.lerp(pp, 1 - Math.exp(-dt * 9)); shake = Math.max(0, shake - dt * 1.8);
    const cp = Math.cos(camS.pitch);
    cam.position.set(camT.x + Math.sin(camS.yaw) * cp * camS.dist + rnd(-shake, shake) * .4, Math.sin(camS.pitch) * camS.dist + rnd(-shake, shake) * .4, camT.z + Math.cos(camS.yaw) * cp * camS.dist);
    cam.lookAt(camT.x, 1, camT.z); cam.updateMatrixWorld();
    pick();
    if (padOn) {   // with the controller, the cursor is where the right stick points, else on the nearest enemy, else ahead
      const d = !P?.aim && near(pp, 20), a = P?.aim || { x: Math.sin(facing), z: Math.cos(facing) };
      if (d) cursor.set(d.pos.x, 0, d.pos.z); else cursor.set(pp.x + a.x * 8, 0, pp.z + a.z * 8);
    }

    // casting
    cd -= dt * slowed(); rollCd -= dt;
    if (charge) {
      charge.s += dt; castAt = time; me.act = actMove(base(charge.i)); facing = Math.atan2(cursor.x - pp.x, cursor.z - pp.z);
      const b = base(charge.i), h = hand();
      if (b?.name === 'Bonestorm') bstGrow(b, charge.s);
      else if (b?.name === 'Detonating Arrow') daCharge(charge, Math.min(1, charge.s / 1.6), dt);
      else if (b) fx.emit(2, { p: { x: h.x + rnd(-1, 1), y: h.y + rnd(-.6, .6), z: h.z + rnd(-1, 1) }, dir: V(0, 0, 0), v: .3, life: .3, size: .16 + Math.min(1, charge.s) * .16, c: b.el, c2: 'white' });
    } else if (held && !move && cd <= 0) fire(held.i);

    // the world
    for (let i = timers.length - 1; i >= 0; i--) { const x = timers[i]; if ((x.s -= dt) <= 0) { timers.splice(i, 1); x.fn(); } }
    for (let i = objs.length - 1; i >= 0; i--) { const o = objs[i]; if (!o.dead) o.update(dt); if (o.dead) { o.remove(); objs.splice(objs.indexOf(o), 1); } }
    for (let i = grounds.length - 1; i >= 0; i--) {
      const g = grounds[i]; g.s -= dt; g.tick -= dt;
      if (g.grow) { g.age += dt; g.r = g.r0 * Math.sqrt(1 + Math.min(g.grow.max, g.grow.per * g.age) / 100); g.decal.set(g.r); }
      if (g.dead || g.s <= 0) { g.decal.remove(); grounds.splice(i, 1); continue; }
      if (Math.random() < dt * (3 + g.r * g.r * 3)) groundFx(g);
      if (g.tick > 0) continue;
      g.tick = .5;
      // Jagged Ground slows the enemies standing in it, more with increased Jagged Ground effect, and they take its increased damage (Spike Pit)
      if (g.type === 'jagged') { const U = g.S?.dmg?.sum || {}, T = U['jagged_ground_enemy_damage_taken_+%'];
        standSlow(g.slow ||= new Map(), g, g.r, -JAGGED.slow * (1 + (U['jagged_ground_effect_+%'] || 0) / 100) * slowK(g.S), .6);
        if (T) for (const d of inside(g, g.r)) { d.jag = time + .6; d.jagPct = T; } }
      const a = GAIL[g.type]; if (!a) continue;
      for (const d of dummies) if (!d.dead && dist(d.pos, g) <= g.r + SIM.body) inflict(d, a, g.S, 1, g.S?.raw);   // raw: a ground with a damage of its own (Burning Inscription)
    }
    vitals(dt); tickHazards(dt);
    for (const c in charges) if (charges[c] && time - (chargeAt[c] ?? time) > CHARGE_TIME * (sheet().chargeTime?.[c] || 1)) { charges[c] = 0; if (c === 'power') me.powerLost = time; }   // with the build's charge duration
    if (sheet().redflare && time - (me.powerLost ?? -99) > RECENT && time - (me.redflareAt ?? -9) >= 1) { me.redflareAt = time; gainCharge('power', 'Redflare Conduit'); }   // a power charge every second if none lost Recently (Redflare Conduit)
    for (const d of dummies) { tickDummy(d, dt); think(d, dt); if (d.agony && time >= d.agony.until) agonyEnds(d); }
    for (const o of objs) { const q = o.fig?.draw && o.segs?.[0]; if (!q) continue; const sig = Math.ceil(q.life / q.max * 48) + ':' + (q.esMax ? Math.ceil(q.es / q.esMax * 48) : ''); if (sig !== o.sig) { o.sig = sig; o.fig.draw({ life: q.life / q.max, es: q.esMax ? q.es / q.esMax : null }); } }   // your minions' and totems' life over them, as the enemies'
    for (const k in tog) {
      const T = tog[k]; T.decal?.move(pp);
      // Ritual Cadence: an Invocation triggers its spell every 2 seconds (its Energy no longer does). note: its invoked
      // spells' 50% less Energy is not played: with no Energy gained there is none to spend
      if (T.cap && sheet().ritual && time - T.last >= 2) { const js = trigsOf(T); T.last = time;
        if (js.length) metaFire(T, js); }
      if (T.kind === 'herald' && Math.random() < dt * 14) { const a = time * 3 + rnd(TAU); fx.emit(1, { p: { x: pp.x + Math.cos(a) * .8, y: rnd(.2, 1.8), z: pp.z + Math.sin(a) * .8 }, v: .1, up: .8, life: .6, size: .16, c: T.el }); }
      if (T.kind === 'field') for (const d of dummies) if (!d.dead && dist(d.pos, pp) <= T.R + SIM.body) d.flash = Math.max(d.flash, .06);
    }
    for (let i = empower.length - 1; i >= 0; i--) if (empower[i].s != null && (empower[i].s -= dt) <= 0) empower.splice(i, 1);
    resolveGain(dt);
    fissures = fissures.filter(f => f.end > time);
    for (let i = buffs.length - 1; i >= 0; i--) if ((buffs[i].s -= dt * (1 + (sheet().buffTime || 0) / 100)) <= 0) buffs.splice(i, 1);   // the tree's Buff Expiry Rate

    // Shankgonne: the cannon leg glowing after its shot; sparks and smoke at your footsteps (note: one each 0.3 s walking)
    if (time < me.powderGlow) fx.emit(1, { p: { x: pp.x, y: pp.y + .35, z: pp.z }, r: .05, v: .1, up: .3, life: .25, size: .18, c: BP.glow, k: 1.5 });
    if (moving && !move && (powderStep -= dt) <= 0 && onS('Black Powder Blitz')) { powderStep = .3; const p = { x: pp.x, y: .05, z: pp.z };
      fx.emit(6, { p, r: .1, v: 1.5, up: 1.2, life: .3, size: .06, c: BP.spark, c2: BP.ember, k: 2.5, g: 6, drag: 1.5 }); fx.emit(2, { p, r: .1, v: .4, up: .2, life: .6, size: .3, grow: 1.5, c: BP.smoke, smoke: true, a: .35 }); }
    cstaffBlades(dt);
    player.update(dt, { moving: moving && !move, speed: spd(), hold: !!held, charge: charge ? Math.min(1, charge.s / (base(charge.i)?.P.perfect ? 1 : 1.6)) : null,
      roll: move?.roll && !move.powder && !move.blink ? move.k : null, leap: move && !move.own && (move.powder || !move.roll && move.h) ? move.k : null, dash: move && !move.own && !move.roll && !move.h ? move.k : null });
    reticle(); arena.update(dt, pp); fx.update(dt);
    if (toastT > 0 && (toastT -= dt) <= 0) toastEl.classList.remove('on');
    if ((hudT -= dt) <= 0) { hudT = .12; drawHud(); api.onLive?.(live()); player.setLook(api.look?.()); }   // the build's weapon in the figure's hands
  }
  const clock = new THREE.Clock(); let lastErr = '';
  renderer.setAnimationLoop(() => {
    if (el.hidden) { clock.getDelta(); return; }
    const dt = Math.min(clock.getDelta(), .05), w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    if (w !== size.w || h !== size.h) {
      size.w = w; size.h = h; renderer.setSize(w, h, false); composer?.setSize(w, h);
      cam.aspect = w / h; cam.updateProjectionMatrix(); fx.setViewport(dom.height, cam.fov);
    }
    if (!paused) {
      time += dt;
      const LL = sheet().eternal && me.es > 0 ? me.life : null;
      try { step(dt); if (LL != null) me.life = LL; } catch (e) { if (e.message !== lastErr) { lastErr = e.message; console.error('scene:', e); } }
    }
    composer ? composer.render(dt) : renderer.render(scene, cam);
  });

  lay();
  return {
    select: i => select(i, false),
    selected: () => sel,
    // the key of the bar a skill of the build is on (html), '' when on none
    keyOf: i => { const k = barNow().indexOf(i); return k >= 0 ? keyLabel(k) : ''; },
    reset,
    // the enemy the next click places: { id → monster of enemies.js, level, attack, rarity, modifiers }. The ones of that monster already in the scene follow it.
    enemy(mon, level, attack, rarity, mods) {
      tpl.mon = mon || null; tpl.level = clamp(Math.round(+level) || 1, 1, 100); tpl.attack = attack || null; tpl.rarity = rarity || null; tpl.mods = mods || []; hudT = 0;
      if (!tpl.mon) return setPlacing(false);
      for (const d of dummies) if (d.mon === tpl.mon) arm(d, tpl.level, tpl.attack);
    },
    // the map changed (enemies.js setMap): every enemy takes its stats again, the living ones at full life
    remap() {
      for (const d of dummies) { arm(d, d.level, d.atk.key, d.rarity, d.modKey ? d.modKey.split(',') : []); if (!d.dead) { d.life = d.max; d.es = d.maxEs; } }
      lay(); shC.at = -99; hudT = 0;
    },
    placing: on => on == null ? placing : setPlacing(on),
    clear: wipe,
    count: () => dummies.length,
  };
}
