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
import { t, fmt, cap } from './i18n.js';
import { K as GAME, enemyStats, attackOf, attacksOf, hitChance, playerHitChance, playerTakes, enemyTakes, blockChance, deflection } from './enemies.js';
import { SIM, AILMENT, STATE, GROUND, GROUND_EL, KIND, CHARGE, profile } from './skillfx.js';
import { css, createFx, buildArena, makePlayer, makeDummy, makeMinion, makeTotem } from './scenefx.js';
import { settings, keyName, slotKeys, slotName } from './settings.js';
import { armourItems } from './items.js';
import { SK } from './skilldata.js';

const TAU = Math.PI * 2, rnd = (a = 1, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), ease = k => 1 - (1 - k) ** 3;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function segDist(p, a, b) {
  const vx = b.x - a.x, vz = b.z - a.z, k = clamp(((p.x - a.x) * vx + (p.z - a.z) * vz) / (vx * vx + vz * vz || 1), 0, 1);
  return Math.hypot(p.x - a.x - vx * k, p.z - a.z - vz * k);
}
const noLeech = () => ({ life: { left: 0, rate: 0 }, mana: { left: 0, rate: 0 } });
const ailOf = els => els.flatMap(e => e === 'cold' ? ['chill', 'freeze'] : AILMENT[e] ? [AILMENT[e]] : []);
const ONCE = new Set(['buff', 'warcry', 'mark', 'curse', 'orb', 'wall', 'totem', 'raise', 'triskelion', 'sigil', 'banner', 'galvanic', 'cstaff', 'feast', 'tempest', 'pain', 'bone', 'mantra', 'demon', 'soul', 'drain', 'trift', 'pinnacle', 'tfreeze', 'iron', 'sacrifice', 'agony', 'temper', 'jade']);   // one use per key press
const NOHIT = new Set(['temper', 'hollow', 'banner', 'calamity', 'apocalypse', 'chayula', 'curse', 'mark', 'aura', 'herald', 'meta', 'buff', 'warcry', 'minion', 'raise', 'field', 'triskelion', 'sigil', 'parry', 'shield', 'galvanic', 'cstaff', 'feast', 'tempering', 'tempest', 'pain', 'bone', 'mantra', 'demon', 'soul', 'drain', 'trift', 'wither', 'pinnacle', 'tfreeze', 'iron', 'sacrifice', 'agony', 'jade', 'wardbound']);
const AREAL = new Set(['area', 'hexblast', 'nova', 'slam', 'rain', 'grenade', 'orb', 'curse', 'warcry', 'zone', 'storm', 'dot', 'meteor', 'wave', 'sweep', 'cone']);
const PIP = { ignite: 'fire', chill: 'cold', freeze: 'ice', shock: 'lightning', poison: 'poison', bleed: 'blood', armour: 'dust', stun: 'white', expo: 'gold', curse: 'curse', mark: 'mark', electrocute: 'lightning', pin: 'dust', maim: 'blood', blind: 'white' };
// The game's ailment rules (GameConstants in monsters.json), and the few its tables do not hold: the glossary's (keywords.json)
const GC = GAME.game || {};
const BROKEN = { time: 12, taken: 20 };   // note: keywords.json ArmourBreak: Fully Broken for 12 s, +20% physical damage taken from hits
const WARD_REGEN = 5;                     // note: keywords.json Ward: Runic Ward regenerates 5% a second by default
const EXPO = { time: 4, res: 20 };        // note: keywords.json Exposure: -20% elemental resistances for 4 s by default
const CHILL_MIN = 30;                     // note: keywords.json Chill: a chill under 30% is ignored
const ANCESTRAL = { slam: 30, area: 25 };   // note: keywords.json Ancestral Boost: a Slam 30% more damage, 25% increased area
const MAIM = { move: 30, evasion: 15, time: 4 };   // note: keywords.json Maim: 30% slower movement, 15% reduced evasion, 4 s
const BLIND = { less: 20, time: 4 };   // note: keywords.json Blind: 20% less accuracy and evasion, 4 s
const HINDER = { slow: 30, time: 4 };   // keywords.json Hinder: 30% slower movement for 4 seconds
const DAZE = { time: 8, stun: 50 };   // keywords.json Daze: lasts 8 seconds, 50% more stun buildup
const WEAK = { per: .5, max: 20, time: 4 };   // keywords.json CriticalWeakness: +0.5% critical hit chance per stack, up to 20, 4 seconds each
const INTIM = 10;   // keywords.json Intimidate: 10% increased damage taken and 10% reduced damage dealt
const CRUSH = 15;   // keywords.json Crushed: 15% less physical damage reduction, possibly below 0
const INCISION = { per: 10, max: 10, cap: 30 };   // keywords.json Incision: 10% chance to bleed per stack, up to 10; the support's "up to 30%"
const IMPALE = { pct: 30, max: 60 };   // keywords.json Impale: 30% of the hit's physical damage, up to 60 on a target
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
  const fx = createFx(scene), arena = buildArena(scene, fx), player = makePlayer(fx), pp = player.group.position;
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
  const tpl = { mon: null, level: 1, attack: null, rarity: null };   // the enemy the next click places
  const me = { life: 0, es: 0, maxL: 0, maxE: 0, hurt: -9, safe: 0, known: false, mana: 0, maxM: 0, rage: 0, raged: -99, heat: 0,
    st: {}, mag: {}, burn: {}, flam: [], leech: noLeech(), bar: {}, lock: {}, stuns: [], calm: 0, tick: .5, by: null, fl: [null, null], drink: [], cc: [null, null, null], cu: [], guard: 0, ward: 0, jade: 0, maxW: 0, runes: [], mimics: [], fuel: {}, fuelAt: {}, inf: {}, infUsed: -99, glory: {}, gloryAt: {}, aff: { fire: 0, cold: 0, lightning: 0 }, affAt: {}, arctic: 0, travAt: {}, voltAt: {}, rifts: [], incs: [], bark: [], trav: 0, wind: 0, sealAt: {}, fallen: [], grim: 0 };   // your pools: life and energy shield against their attacks, mana for your skills, Rage; the ailments their hits put on you
  const camS = { yaw: 0, pitch: .93, dist: 21 }, camT = V(), cursor = V(0, 0, 6);
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
  const sheet = () => { if (time - shC.at > .5) shC = { at: time, v: api.sheet?.() || {} }; return shC.v; };
  const short = n => n < 99999.5 ? fmt(Math.round(n)) : n < 999950 ? fmt(n / 1e3, 1) + 'k' : fmt(n / 1e6, 2) + 'M';
  const NUMC = el => el === 'physical' ? '#f2ead8' : css(el);

  // ---------- skills of the build
  const profs = new Map(), cache = new Map();
  // Nature's Archon (calc.js character() overgrow: its time; its stats from the game, api.archon) and a plant gem with them
  const archonOn = () => time - archonAt < sheet().overgrow.archonTime, archonG = new WeakMap();
  const withArchon = g => { if (!archonG.has(g)) archonG.set(g, { ...g, add: api.archon }); return archonG.get(g); };
  const prof = (g, inf) => { let P = profs.get(g.name); if (!P) profs.set(g.name, P = profile(inf.gem || { name: g.name }, inf.data || {})); return P; };
  function base(i) {
    const g = api.build().gems[i]; if (!g) return null;
    const c = cache.get(i); if (c && c.g === g && time - c.at < .5) return c.S;
    const inf = api.info(g), G = api.geo(g), BA = banner('banner_attack_speed_+%'), g1 = archonOn() && inf.gem?.tags?.includes('plant') ? withArchon(g) : g;
    const dmg = api.damage?.(BA ? { ...g1, add: { ...g1.add, 'attack_speed_+%': BA } } : g1) || null, P0 = prof(g, inf), dur = dmg?.shape?.duration, P = dur ? { ...P0, dur } : P0;   // the level's skill effect duration with the build's modifiers
    const R = P.radiusBonus ? SIM.orbBlast + G.radius : G.radius;
    let els = P.els.length ? [...P.els] : P.attack ? ['physical'] : [], ail = [...P.applies], col = P.el;
    // gas and oil only burn once something sets them alight
    if (P.ground === 'gas' || P.ground === 'oil') { els = els.filter(e => e !== 'fire'); ail = ail.filter(a => a !== 'ignite'); col = P.ground === 'gas' ? 'gas' : 'dust'; }
    const tags = inf.gem?.tags || [];
    const S = { i, g, P, G, kind: P.kind, name: g.name, label: inf.label, el: col, els, ail, mult: dmg?.attack ? 1 + banner('attack_damage_+%_final') / 100 : P.spell ? 1 + (me.ley?.more || 0) / 100 : 1, gm: 1, spent: 0, R, A: R || SIM.area, aoe: P.aoe ?? (P.explodes || tags.includes('area')), spear: inf.gem?.types?.includes('Spear'), dmg, elemental: tags.some(x => ['fire', 'cold', 'lightning'].includes(x)) };
    cache.set(i, { g, at: time, S }); return S;
  }
  const setBuff = b => { buffs = buffs.filter(x => x.label !== b.label); buffs.push(b); };
  const sh = S => S.dmg?.shape || {}, durOf = S => sh(S).duration || (S.dmg?.stats?.base_skill_effect_duration || 0) / 1000;   // the gem's own chains, projectiles and times (calc.js)
  const mk = i => { const b = base(i); return b && { ...b, els: [...b.els], ail: [...b.ail] }; };
  const byName = name => api.build().gems.findIndex(g => g.name === name);
  // What is used by hand gets a slot (calc.js byHand); persistent skills are on while their spirit is reserved, so the
  // scene turns them on in the build's order while the build's Spirit covers them (the game starts none it cannot reserve)
  const always = g => (api.info(g).gem?.types || []).includes('Persistent'), unpaid = new Set();
  // a Banner too: on while its Spirit is reserved, building its Glory, and placed by hand
  const slots = () => api.build().gems.flatMap((g, i) => api.byHand(i) || (api.info(g).gem?.types || []).some(x => x === 'Banner' || x === 'PersistentShowsCastTime') || ['Iron Ward', 'Grim Feast'].includes(g.name) ? [i] : []);   // Temporal Rift, Iron Ward, Grim Feast (its Grim Resurrection): on, and used
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
  const meleeR = S => sh(S).reach ?? SIM.meleeRange;   // the weapon's reach (calc.js shape), else the scene's
  // to the dummy's edge; a strike with a dash range of its own (Killing Palm, Ice Strike...) dashes to an enemy farther than melee
  const strikeR = S => (S.P.dash ? sh(S).dash ?? SIM.dashRange : Math.max(meleeR(S), sh(S).dash || 0)) + SIM.body;
  const inCone = (c, a0, half, p) => { const da = Math.atan2(p.z - c.z, p.x - c.x) - a0; return Math.abs(Math.atan2(Math.sin(da), Math.cos(da))) <= half; };
  const coneHalf = S => (S.cone / 2 || (S.kind === 'cone' ? SIM.cone / 2 : 65)) * Math.PI / 180;   // S.cone: the data's angle (Deadly Resolve)
  function aim(S, p) {
    const max = S.kind === 'grenade' ? SIM.throwRange : S.kind === 'travel' ? sh(S).travel ?? SIM.travelRange : S.kind === 'slam' ? meleeR(S) : SIM.castRange;
    let dx = p.x - pp.x, dz = p.z - pp.z, l = Math.hypot(dx, dz);
    if (l < .001) { dx = Math.sin(facing); dz = Math.cos(facing); l = 0; } else { dx /= l; dz /= l; }
    const k = S.src ? l : Math.min(l, max);
    S.dx = dx; S.dz = dz; S.from = { x: pp.x, z: pp.z }; S.at = { x: pp.x + dx * k, z: pp.z + dz * k };
  }

  // ---------- enemies: monsters of the game placed with a click, with their stats at the chosen level (enemies.js)
  // sources the damage of the build does not describe (a totem or minion with its own damage hits as 'totemHit' / 'minionHit')
  const APPROX = new Set(['minion', 'totem', 'ground', 'mark', 'herald', 'none']);
  const MAXE = 60;
  function arm(d, level, key) {
    const m = d.mon, list = attacksOf(m), fresh = d.level !== level || d.rarity !== tpl.rarity;
    d.level = level; d.rarity = tpl.rarity; d.stat = enemyStats(m, level, tpl.rarity); d.atk = attackOf(m, level, list.some(a => a.key === key) ? key : list[0].key, tpl.rarity);
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
  const clean = d => { d.impales = []; d.slows = []; d.blood = 0; d.dazed = d.attr = d.inc = d.halt = d.crushed = d.intim = 0; d.agony = null; d.weak = []; d.shards = null; d.pustule = null; d.st = {}; d.burn = {}; d.dots = []; d.curse = d.mark = null; d.frz = d.brk = 0; d.flam = []; d.bar = {}; d.lock = {}; d.imm = {}; d.mag = {}; d.cut = 0; };
  const restore = d => {
    const f = d.fig; d.pos.set(d.home.x, 0, d.home.z); d.aggro = false; d.dead = false; d.life = d.max; d.es = d.maxEs; d.fall = d.corpse = d.back = d.lances = 0; d.by = null; d.sig = ''; d.wind = null; d.wait = rnd(.6, 1.2);
    clean(d);
    f.upper.rotation.set(0, 0, 0); f.group.visible = f.plate.visible = true;
  };
  function wipe() { dummies.forEach(d => d.fig.dispose()); dummies = []; hudT = 0; }
  function heal() { const c = sheet(); me.maxL = c.life || 0; me.maxE = c.es || 0; me.maxM = c.mana || 0; me.life = me.maxL; me.es = me.maxE; me.mana = me.maxM; me.rage = 0; me.hurt = -9; me.ward = me.maxW = c.ward || 0;
    Object.assign(me, { owls: 0, owlT: 0, jade: 0, jadeIn: null, seeds: 0, locust: 0, pinn: null, iron: 0, heat: 0, angAt: time, requiem: 0, fpAt: null, sight: 0, kaom: null, calamity: null, chayula: null, demon: null, rifts: [], incs: [], bark: [], arctic: 0, wind: 0, travAt: {}, voltAt: {}, st: {}, mag: {}, burn: {}, flam: [], leech: noLeech(), bar: {}, lock: {}, stuns: [], fl: [null, null], drink: [], cc: [null, null, null], cu: [], guard: 0, quill: undefined, runes: [], mimics: [], fuel: {}, fuelAt: {}, inf: {}, infUsed: -99, glory: {}, gloryAt: {}, aff: { fire: 0, cold: 0, lightning: 0 }, affAt: {}, sealAt: {} }); }
  // Rage (calc.js rageOf): Berserk's part only while it is on; gaining any holds off its loss for the delay
  const rageMax = () => { const R = sheet().rage; return R?.base ? R.base + (R.berserk && tog[R.berserk.name] ? R.berserk.max : 0) : 0; };
  // Rage gained at its most builds Glory (Walking Calamity), one per Rage: note: the data gives no rate
  function gainRage(n) { const M = rageMax(); if (!(n > 0) || !M) return; const over = Math.max(0, me.rage + n - Math.max(M, me.rage)); me.rage = Math.min(M, me.rage + n); me.raged = time; if (over) for (const S of gloryOf()) if (S.name === 'Walking Calamity') gloryAdd(S, over); }
  // your death, by an enemy or by your own life loss: everything restored
  function died(by) { stats.deaths++; say(t('{0} killed you', by), 'blood'); toast(t('You died: life and energy shield restored')); fx.ring(pp, .3, 2.6, 'blood', .5); heal(); me.safe = 2; }
  function reset() {
    objs = objs.filter(o => o.keep || (o.remove(), false));
    grounds.forEach(g => g.decal.remove()); grounds = [];
    hazards.forEach(h => h.decal.remove()); hazards = [];
    frags.forEach(f => f.dec.remove()); frags = [];
    timers = []; empower = []; buffs = []; fissures = []; surges = []; archonAt = -Infinity; charge = held = move = null; pp.y = 0;
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
  const clear = (d, s) => { if (s === 'curse') d.curse = null; else if (s === 'mark') d.mark = null; else d.st[s] = 0; };
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
    if (Math.random() * 100 < M.one) gainCharge(type, S.label);
    if (Math.random() * 100 < M.random) gainCharge(['frenzy', 'power', 'endurance'][Math.floor(Math.random() * 3)], S.label);
    // Empowered Sparks: a power charge generated empowers your next attacks to trigger its Sparks (no expiry in the data)
    const E = type === 'power' && S.dmg?.trig?.find(T => T.stats?.support_empower_X_attacks_with_spark_on_power_charge_gain), X = E && S.dmg.trig.find(T => T.support === E.support && T.hits?.lightning);
    if (X) { const A = asTrig(S, X); empower = empower.filter(e => e.type !== 'spark'); empower.push({ type: 'spark', uses: E.stats.support_empower_X_attacks_with_spark_on_power_charge_gain, X: A, label: A.label, name: S.name, el: 'lightning' }); }
  }
  // Combo now: lost after the skill's delay without gaining any (its supports' 4 or 6 s, longer with Flow)
  const comboNow = S => time - (me.comboAt ?? -99) > (S.dmg?.combo?.decay || 4) ? 0 : me.combo || 0;
  function gainCharge(type, by) {
    chargeAt[type] = time;   // gaining one refreshes them all
    if (charges[type] >= maxC(type)) return;
    charges[type]++; fx.glow({ x: pp.x, y: 1.5, z: pp.z }, 1.8, CHC[type], .45);
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
    if (d.life <= 0) { ash(d, -d.life, S); kill(d, S); }
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
  function hit(d, S, o = {}) {
    if (d.dead) return false;
    if (S.dmg?.stats?.['time_rip_damage_share_%']) visage(d, S);
    // Temper Weapon: an Empowered attack Combusts on its first hit (its chance): its own hit, fire, in its area around the enemy
    const CB = S.combust; if (CB && !CB.done && Math.random() * 100 < CB.T.dmg.stats['imbue_weapon_combust_trigger_chance_%']) { CB.done = true; const c = { x: d.pos.x, z: d.pos.z }; later(.05, () => boom(c, CB.T.A, CB.T)); }
    d.aggro = true;   // hit, it comes at you
    const P = S.P, D = S.dmg, own = !APPROX.has(S.src), A = own ? D?.ail : null;
    const real = own && !!D && Object.keys(D.hits).length > 0, raw = {};
    if (own && (D ? D.attack : P.attack) && !A?.alwaysHit) {   // attacks roll your accuracy against its evasion; spells always hit
      // player attacks lose accuracy with distance: none within 2 m, linearly up to the most at 9 m (KeywordPopups
      // Accuracy; linear as Path of Building 2), from you to the target; not your minions' and totems' own attacks
      const c = sheet(), far = /minion|totem/.test(S.src) ? 0 : clamp((dist(pp, d.pos) - 2) / 7, 0, 1), acc = c.accuracy * (S.accX || 1) * (1 + banner('banner_accuracy_+%') / 100 / (c.accuracyInc || 1)) * (1 - far * (c.accuracyFalloff || 0) / 100);
      if (acc > 0 && d.stat.evasion > 0 && Math.random() * 100 >= playerHitChance(acc, d.stat.evasion * (d.st.maim > 0 ? 1 - MAIM.evasion / 100 : 1) * (d.st.blind > 0 ? 1 - BLIND.less / 100 : 1))) { fx.text(over(d), t('Miss'), '#9a968c', .3); return false; }
    }
    if (S.spear && !S.src && sheet().lances) d.lances = Math.min(30, (d.lances || 0) + 1);   // Atziri's Contempt: a Bloodstone Lance, up to 30 (note: its text)
    // m: the scene's multipliers; g, gp: the game's (on the whole hit, on its physical part); stunX: the consumed state's stun
    let m = (o.mult ?? 1) * S.mult, g = S.gm ?? 1, gp = 1, stunX = o.stunX ?? 1;
    if (real && D.attack && S.src !== 'minionHit') g *= rageX(D);
    if (D?.attack && time < d.parried?.until) g *= 1 + d.parried.more / 100;   // Parried
    if (!o.noPay) {
      const C = A?.consume || {}, uniq = d.stat.rarity === 'unique';
      for (const s of new Set([...P.consumes, ...Object.keys(C)])) if (has(d, s)) {
        consume(d, S, s);
        const c = C[s];
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
    if (real) {
      // a mark adds to the critical damage bonus; the buff of a consumed Freezing / Voltaic Mark adds damage as extra cold / lightning
      const W = when(D, d, S);
      crit = Math.random() * 100 < (D.crit || 0) * W.crit * regulate('power', 'charge_mastery_crit_chance_+%_final_with_power_charges') + weakOf(d); if (crit) (me.critAt ||= {})[S.name] = time;
      // Shocking Leap: the first critical hit of a supported leap's use leaves its Shocked Ground there
      const SL = crit && !S.src && !S.leapt && S.dmg?.sum?.support_shocking_leap_shocked_ground_radius;
      if (SL) { S.leapt = true; ground('shocked', { x: d.pos.x, z: d.pos.z }, SL / 10, S.dmg.sum.support_shocking_leap_shocked_ground_duration_ms / 1000, S); }
      const cm = crit ? 1 + ((D.critBonus || 0) * W.critBonus + (M?.D?.crit || 0)) / 100 : 1, B = S.src === 'minionHit' ? [] : buffs.filter(b => b.gain && !(b.gain.attack && !S.P.attack)).map(b => b.gain);   // a crit starts Inexorable Critical again
      for (const el in D.hits) { const [lo, hi] = D.hits[el]; raw[el] = (lo + Math.random() * (hi - lo)) * m * g * (el === 'physical' ? gp : 1) * cm * (W.dmg[el] ?? 1); }
      if (time < me.chayula?.until && !S.src) for (const e of ['physical', 'chaos']) if (raw[e]) raw[e] *= 1 + me.chayula.more / 100;   // Archon of Chayula
      if (time < me.unbound?.until && !S.src) for (const e of ELEM) if (raw[e]) raw[e] *= me.unbound.more;   // Unbound
      if (time < me.pinn?.until) for (const e of ELEM) if (raw[e]) raw[e] *= 1 + me.pinn.more / 100;   // Pinnacle of Power
      const SO = S.P.spell && !S.src && objs.find(o => o.soul && !o.dead)?.soul;   // Soul Offering
      if (SO) for (const e in raw) raw[e] *= 1 + SO['power_offering_buff_spell_damage_+%'] / 100;
      if (S.P.spell && !S.src && demon()) for (const e in raw) raw[e] *= 1 + demon() * me.demon.st['demon_form_spell_damage_+%_final_per_stack'] / 100;   // Demon Form
      const KB = S.dmg?.stats?.['damage_+%_final_per_5%_heavy_stun_threshold_buildup'];   // Kinetic Bash: per 5% of the enemy's heavy stun buildup
      if (KB) for (const e in raw) raw[e] *= 1 + KB * Math.floor((d.bar.stun || 0) / 5) / 100;
      const AT = d.attr >= 1 && attr();   // Attrition
      if (AT) for (const e in raw) raw[e] *= 1 + AT['skill_attrition_hit_damage_+%_final_vs_rare_or_unique_enemy_per_second_ever_in_presence_up_to_max'] * Math.floor(d.attr) / 100;
      // Vorana's Siege: more against an Isolated enemy, none of its allies within 6 m (keywords.json Isolated)
      const VS = S.dmg?.sum?.['support_voranas_siege_hit_damage_+%_final_vs_isolated_enemies'];
      if (VS && !dummies.some(e => e !== d && !e.dead && dist(e.pos, d.pos) <= 6)) for (const e in raw) raw[e] *= 1 + VS / 100;
      // Lightning Conduit: more damage to a shocked enemy, per 5% more damage it takes from the shock
      const LC = has(d, 'shock') && S.dmg?.stats?.['lightning_conduit_damage_+%_final_per_5%_increased_damage_taken_from_shock'];
      if (LC) for (const e in raw) raw[e] *= 1 + LC * (shocked(d) - 1) * 20 / 100;
      if (S.chaosX && raw.chaos) raw.chaos *= S.chaosX;   // Profanity
      const IM = S.dmg?.stats?.['active_skill_damage_+%_final_vs_immobilised_enemies'];   // Siege Cascade: more against the immobilised
      if (IM && has(d, 'immobilised')) for (const e in raw) raw[e] *= 1 + IM / 100;
      if (S.P.attack && !S.src && raw.physical) briarStore(raw.physical);
      const CS = cstaff(S);   // Charged Staff: its added lightning per stack
      if (CS) { const st = CS.S.dmg.stats, lo = st.charged_staff_attack_minimum_added_lightning_damage_per_stack, hi = st.charged_staff_attack_maximum_added_lightning_damage_per_stack; raw.lightning = (raw.lightning || 0) + CS.n * (lo + Math.random() * (hi - lo)) * m * cm; }
      // Trinity: more elemental damage per 30 Affinity of any type (its text; the stat's name says 50); a hit dealing
      // elemental damage gains Affinity of its highest elemental type and loses some of the others
      const TR = !S.src && trinity();
      if (TR) {
        const k = 1 + TR['trinity_damage_+%_final_to_grant_per_50_resonance'] * Math.floor((me.aff.fire + me.aff.cold + me.aff.lightning) / 30) / 100, top = [...ELEM].filter(e => raw[e] > 0).sort((a, b) => raw[b] - raw[a])[0];
        for (const e of ELEM) if (raw[e]) raw[e] *= k;
        if (top) for (const e of ELEM) { if (e === top) { me.aff[e] = Math.min(TRINITY_MAX, me.aff[e] + TR.trinity_resonance_to_grant); me.affAt[e] = time; } else me.aff[e] = Math.max(0, me.aff[e] - TR.trinity_loss_per_hit); }
      }
      // shares of all damage gained as extra damage of a type, each of the damage before any of them: the buffs'; Mantra
      // of Destruction's Empowered attack and its Purple Flames (per stack) as chaos; Mana Tempest, Charged Shots, Volt
      // Thrill of the Kill, Archmage and Ambrosia as lightning
      const MT = empowered(S), TK = S.P.attack && time < me.thrill?.until && me.thrill.X;
      const G = [...B, { el: 'chaos', pct: (S.mantra?.pct || 0) + (!S.src && time < me.purple?.until ? me.purple.n * me.purple.pct : 0) },
        { el: 'lightning', pct: (MT ? MT.dmg.stats['non_skill_base_all_damage_%_to_gain_as_lightning_with_spells_from_buff'] : 0) + (S.charged || 0) + (S.volt || 0) + (TK?.['support_thrill_of_the_kill_buff_grant_%_added_lightning_attack_damage'] || 0)
          + (archmage(S)?.['archmage_all_damage_%_to_gain_as_lightning_to_grant_to_non_channelling_spells_per_100_max_mana'] * Math.floor(me.maxM / 100) || 0) + (S.ambrosia || 0) }, { el: 'fire', pct: S.fireGain }, ...(S.gains || []), { el: 'fire', pct: S.heated && S.dmg.stats['active_skill_all_damage_%_as_fire_if_heat_is_consumed'] }];   // Detonating Arrow's stages
      const all = Object.values(raw).reduce((t, v) => t + v, 0); for (const b of G) if (b.pct) raw[b.el] = (raw[b.el] || 0) + all * b.pct / 100;
      if (crit) gainBuff(S, 'crit');
      if (!S.src) { if (crit) trigger(S, 'crit', d); trigger(S, 'hit', d); harbinger(d, S, false); swarm(d, false); }
      if (!S.src && has(d, 'ignite')) trigger(S, 'ignitedHit', d);
      // Impale: an attack hit extracts the strongest on the enemy, added to its physical damage; a hit may Impale (its
      // number of them) for a share of its physical damage times its magnitude, up to their most on the enemy
      const IP = A?.impale, ph = raw.physical || 0;
      if (D.attack && d.impales.length && !IP?.keep) raw.physical = ph + d.impales.splice(d.impales.indexOf(Math.max(...d.impales)), 1)[0];
      if (ph && Math.random() * 100 < IP?.chance) { d.impales.push(...Array(IP.n).fill(ph * IMPALE.pct / 100 * IP.mag)); d.impales.splice(0, d.impales.length - IMPALE.max); }
      const dealt = {};
      for (const el in raw) { const got = dealt[el] = takes(d, el, raw[el], true, D?.stats?.['enemy_phys_reduction_%_penalty_vs_hit']); total += got; if (got > best) { best = got; top = el; } }
      // Lightning Conduit consumes the shock it hit: the first consumed, its additional bolts fall among the enemies in its area
      if (LC && !S.src) clear(d, 'shock');
      const LX = LC && !S.src && !S.conduit && S.dmg.stats.lightning_conduit_x_additional_strikes_if_consumed_a_shock;
      if (LX) { S.conduit = true; const L = inside(S.at, S.A); L.length || L.push(d);
        for (let k = 0; k < LX; k++) { const e = L[k % L.length]; later(.1 * (k + 1), () => { if (!e.dead) { fx.bolt(V(e.pos.x, 12, e.pos.z), V(e.pos.x, 0, e.pos.z), S.el, .2, .06, .5); hit(e, { ...S, src: 'conduit' }); } }); } }
      if (!/minion|totem/.test(S.src || '')) leech(D, dealt, total, d);
    } else total = (d.max + d.maxEs) / 8 * m * g * shocked(d);
    // a mark that grants a charge (Sniper's Mark) is consumed by your critical hit
    if (M?.gain && d.mark === M && crit && own) {
      d.mark = null; trigger(M.S, 'mark', d); fx.ring(d.pos, .3, 1.5, 'mark', .35);
      say(t('{0} consumes {1}', S.label, M.label), 'mark'); gainCharge(M.gain, M.label);
    }
    floatN(d, total, top, { sim: !real || Math.abs(m - 1) > .001, crit });
    if (!S.src) remnantOn('hit', d, crit);
    if (!S.src && P.attack) { if (P.kind === 'projectile') me.projHit = time; if (P.melee) me.meleeHit = time; }   // for Pursuit and Retreat
    // Rage: "Only one Hit every 0.5 seconds can cause you to gain Rage" (keywords.json); the tree's gains and the skill's
    // supports' (calc.js onHit); a crit can cost it (Prototype Seventeen); Combo from Strikes; a perfectly timed hit's charge
    const H = real ? D.onHit : null;
    if (!S.src && time - (me.rageHit ?? -9) >= .5) {
      const G = sheet().rage?.gain, n = (G?.hit || 0) + (P.attack ? G?.attack || 0 : 0) + (P.melee ? (G?.melee || 0) + (H ? H.rage + H.ragePct * rageMax() / 100 : 0) : 0);
      if (n > 0) { me.rageHit = time; gainRage(n); }
    }
    if (!S.src && H) {
      if (crit && H.loseRageOnCrit) me.rage = Math.max(0, me.rage - rageMax() * H.loseRageOnCrit / 100);
      if (S.perfect && Math.random() * 100 < H.perfectEndurance) chargeBy('endurance', S);
      if (D.combo?.strike) { me.combo = comboNow(S) + 1 + (Math.random() * 100 < D.combo.extra ? 1 : 0); me.comboAt = time; }
    }
    const full = d.life >= d.max; d.by = S; damage(d, total, S);
    if (crit && own && S.name !== 'Midnight Zenith') zenith(d);
    if (own && Math.random() * 100 < (S.P.attack ? D?.stats?.['attacks_chance_to_blind_on_hit_%'] || 0 : 0) + (D?.sum?.['global_chance_to_blind_on_hit_%'] || 0)) { if (!(d.st.blind > 0)) fx.text(over(d), t(STATE.blind), css(PIP.blind), .36); d.st.blind = BLIND.time; }   // Blind (Flash Grenade)
    if (own && S.name === 'Blood Hunt' && !S.src) bloodHunt(S, d);
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
    if (!S.src) { thornHit(S, d); const H = real ? Object.keys(raw) : S.els; if (D?.attack ?? P.attack) glory(d, 'attack_hit'); if (H.some(e => ELEM.has(e))) glory(d, 'elemental_hit'); if (H.includes('chaos')) glory(d, 'chaos_hit'); }
    if (d.dead) return true;
    if (real) afflict(d, S, raw, { crit, stunX, full }); else for (const a of S.ail) if (!A?.never?.[a]) inflict(d, a, S);
    if (P.dotHit) dot(d, S);
    event('hit', d.pos, S, d); if (crit) { event('crit', d.pos, S, d); if (!S.src && P.melee) expression(d, S); }
    return true;
  }
  // The supports' bonuses that count only under a condition (calc.js when, PoB2's tags), checked on this hit: the
  // enemy's state and life, yours (low life is the game's 35%: DefaultLowStatusThresholdPercent), your charges and
  // Rage, how far it is, how long you stood still or channelled, what you hit recently. A condition the scene does not
  // have (combo, blind...) is not met. Each counts its points (stacks, quarter seconds...) up to the support's own most
  const LOW = (GAME.low_pct ?? 35) / 100;
  // "Recently refers to the past 4 seconds" (keywords.json); the crossbow bolts reloaded and the skills used lately
  const RECENT = 4, reloads = [], used = [], reloaded = secs => reloads.reduce((t, r) => t + (time - r.t <= secs ? r.n : 0), 0);
  function condN(c, d, S) {
    const v = c.var, en = c.actor === 'enemy', st = k => has(d, k), lifeK = x => x.life / Math.max(1, x.max);
    const is = en ? { LowLife: lifeK(d) <= LOW, FullLife: d.life >= d.max, Frozen: st('freeze'), Bleeding: st('bleed'), Poisoned: st('poison'), Ignited: st('ignite'), Burning: st('ignite'),
      Shocked: st('shock'), Chilled: st('chill'), Electrocuted: st('electrocute'), Pinned: st('pin'), Maimed: st('maim'), Blinded: st('blind'), Immobilised: st('immobilised'), HeavyStunned: st('stun'),
      Ailing: ['ignite', 'chill', 'freeze', 'shock', 'electrocute', 'poison', 'bleed'].some(st), ArmourFullyBroken: st('armour'), Dazed: d.dazed > time,
      Unique: d.stat.rarity === 'unique', RareOrUnique: ['rare', 'unique'].includes(d.stat.rarity) }
      : { LowLife: me.life <= me.maxL * LOW, FullLife: me.life >= me.maxL, FullMana: me.mana >= me.maxM * .9,   // Zenith: "above 90% of your Maximum Mana"
        FullEnergyShield: me.maxE > 0 && me.es >= me.maxE, HaveMaximumRage: rageMax() > 0 && me.rage >= rageMax(), Moved2m: (S.moved || 0) >= 2,
        Stationary: (S.still || 0) > 0, Channelling: !!charge, EnemyHigherLifePercent: lifeK(d) > me.life / Math.max(1, me.maxL),
        HitProjectileRecently: time - (me.projHit ?? -99) <= (c.secs || RECENT), HitMeleeRecently: time - (me.meleeHit ?? -99) <= (c.secs || RECENT), PerfectTiming: !!S.perfect, ConsumedInfusionRecently: time - me.infUsed <= RECENT };
    const count = { Rage: me.rage, ComboStacks: comboNow(S), FrenzyCharge: charges.frenzy, PowerCharge: charges.power, EnduranceCharge: charges.endurance,
      StationarySeconds: S.still || 0, ChannellingTime: charge?.s || 0, PoisonStacks: st('poison') ? 1 : 0,
      BoltsReloadedPastSixSeconds: reloaded(6), BoltsReloadedPastEightSeconds: reloaded(8), SecondsSinceInevitableCrit: time - (me.critAt?.[S.name] ?? 0),
      DifferentElementalSkillUsedRecently: new Set(used.filter(u => u.elemental && time - u.t <= RECENT).map(u => u.name)).size, MinionPresenceCount: objs.filter(o => o.minion && !o.dead).length };
    let n;
    if (c.type === 'ActorCondition' || c.type === 'Condition') n = is[v] ? 1 : 0;
    else if (c.type === 'MultiplierThreshold') n = v === 'Rage' && S.enraged || v in count && count[v] >= (c.threshold || 0) ? 1 : 0;
    else if (c.type === 'Multiplier') n = v in count ? Math.floor(count[v] / (c.div || 1)) : 0;
    else if (c.type === 'DistanceRamp') {   // [distance in tenths of a metre, share] points, as PoB2 has them (Longshot: "7m+")
      const x = dist(pp, d.pos) * 10, R = c.ramp; n = x <= R[0][0] ? R[0][1] : R[R.length - 1][1];
      for (let i = 1; i < R.length; i++) if (x > R[i - 1][0] && x <= R[i][0]) n = R[i - 1][1] + (R[i][1] - R[i - 1][1]) * (x - R[i - 1][0]) / (R[i][0] - R[i - 1][0]);
    } else return 0;
    return c.neg ? +!n : n;
  }
  function when(D, d, S) {
    const W = { dmg: {}, crit: S.critX || 1, critBonus: 1 };   // Potential's consumed power charge
    for (const w of D.when || []) {
      let n = w.cond.reduce((t, c) => t * condN(c, d, S), 1);
      if (!n) continue;
      const p = w.val * Math.min(n, w.stacks || Infinity), pct = w.cap == null ? p : p < 0 ? Math.max(w.cap, p) : Math.min(w.cap, p);
      if (w.what === 'damage') for (const el in w.w) W.dmg[el] = (W.dmg[el] ?? 1) * (1 + pct / 100 * w.w[el]);
      else W[w.what] *= 1 + pct / 100 * w.w;
    }
    return W;
  }
  // Leech (keywords.json): a share of the damage the hit dealt (calc.js leech), as if it dealt at most 40,000 with the
  // same ratios, less the monster's leech resistance, recovered over one second (faster with leech rate). Only one
  // instance recovers at a time: a new one is added to what is left (note: how the game joins them is not in the data)
  function leech(D, dealt, total, d) {
    const k = Math.min(1, GAME.leech_max_damage / (total || 1)) * (1 - (d.stat.leechRes || 0));
    for (const r of ['life', 'mana']) {
      const x = D.leech?.[r], n = x && ((dealt.physical || 0) * x.phys + total * x.all) / 100 * x.more * k;
      if (!(n > 0)) continue;
      const q = me.leech[r]; q.left += n; q.rate = q.left * x.rate; q.keep = r === 'life' && D.leech.keep;
    }
  }
  // Damaging ailments deal, per second, a share of the hit that inflicted them (the game's base values: monsters.json constants),
  // after the enemy's resistances. Without that hit (grounds, minions, missing damage) they use the scene value, drawn with "~".
  const AIL_DOT = { ignite: ['fire', ['fire']], bleed: ['physical', ['physical']], poison: ['chaos', ['physical', 'chaos']] };
  function ailDps(d, a, raw) {
    const [el, from] = AIL_DOT[a], base = raw ? from.reduce((s, e) => s + (raw[e] || 0), 0) : 0, per = GAME[a + '_per_minute'];
    return base > 0 && per ? { dps: defence(d, el, base * per / 6000, false), sim: false, el } : { dps: (d.max + d.maxEs) * SIM.dot / 8, sim: true, el };
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
    const p = { x: d.pos.x, z: d.pos.z }, blast = (q, key, from) => {
      const T = from.dmg.trig.find(t => t.stats?.[key]), x = d.max * T.stats[key] / 1e4, X = asTrig(from, T, scale(T.hits, x));
      boom(q, X.A, X);
    };
    for (const T of d.ignBy?.dmg?.onKill || []) if (T['corpse_explosion_monster_life_%'] && d.st.ignite > 0 && Math.random() * 100 < (T['chance_to_trigger_fiery_death_on_ignited_enemy_death_%'] ?? 100))
      later(.05, () => blast(p, 'corpse_explosion_monster_life_%', d.ignBy));
    for (const T of S?.dmg?.onKill || []) {
      if (T['support_bone_shrapnel_physical_damage_equal_to_%_monster_life'] && d.st.pin > 0)
        later(.05, () => blast(p, 'support_bone_shrapnel_physical_damage_equal_to_%_monster_life', S));
      const cold = T['support_frozen_spite_%_enemy_maximum_life_dealt_as_cold_damage'];
      if (cold && frozen) for (let k = 0; k < (T.base_number_of_projectiles || 1); k++) {
        const a = Math.random() * Math.PI * 2, r = rnd(T.ice_fragment_min_chunk_distance || 0, T.ice_fragment_max_chunk_distance || 0) / 10, q = { x: p.x + Math.sin(a) * r, z: p.z + Math.cos(a) * r };
        frag(q, (T.active_skill_base_area_of_effect_radius || 10) / 10, (T.base_skill_detonation_time || 0) / 1000, at => blast(at, 'support_frozen_spite_%_enemy_maximum_life_dealt_as_cold_damage', S));
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
  // note: Corrupted Blood's debuffs share one duration, refreshed (the game times each one)
  const trigReady = {}, fields = { static: [], rift: [] }, crystals = [];
  // a triggered skill's cooldown and stored uses: false while none is left
  const spend = T => { if (!T.cooldown) return true; const r = trigReady[T.id] = (trigReady[T.id] || []).filter(at => at > time); return r.length < (T.uses || 1) && r.push(time + T.cooldown / 1000) > 0; };
  const KINDS = [['base_number_of_living_lightning_allowed', null], ['shocking_rift_number_of_pulses', 'rift'], ['grounding_shocks_pulse_delay_ms', 'static'],
    ['chance_to_trigger_volcanic_eruption', 'erupt'], ['number_of_chains', 'current'], ['triggered_by_support_electrocute_lineage_%', 'fulminate'],
    ['support_mana_flare_%_of_current_mana_consumed', 'flare'], ['spell_minimum_base_cold_damage_as_%_of_intelligence', 'discharge'],
    ['base_chaos_damage_to_deal_per_minute', 'decay'], ['add_buff_to_target_skill_number_of_corrupted_blood_debuffs_to_inflict', 'cry'],
    ['support_battershout_physical_damage_equal_to_%_of_broken_armour', 'batter'], ['support_haemocrystals_physical_damage_equal_to_%_of_remaining_bleed_damage', 'crystal'],
    ['chance_to_trigger_shocked_ground_on_mark_activated_%', 'charged'], ['trigger_on_heavy_stun_%', 'smash']];
  const ON = { rift: 'shock', static: 'shock', current: 'shock', erupt: 'ignitedHit', fulminate: 'electrocuteKill', flare: 'crit', discharge: 'hit',
    decay: 'curse', cry: 'warcry', batter: 'warcry', crystal: 'hit', charged: 'mark', smash: 'heavyStun' };
  const DISCHARGE = { ignite: 'fire', freeze: 'cold', shock: 'lightning' };
  function trigger(S, on, d) {
    if (on === 'mark' && S?.called && Math.random() * 100 < (SK.skills['Called Shots'].meta_support?.['your_marks_spread_to_a_nearby_enemies_on_consume_%_chance'] || 0)) later(.1, () => { const e = unmarked(d.pos, CALLED.spread)[0]; if (e) markOn(e, S); });
    for (const T of S?.dmg?.trig || []) {
      const ts = T.stats || {}, U = T.support, kind = KINDS.find(([k]) => ts[k])?.[1];
      if (!kind || T.reason && kind !== 'charged' || ON[kind] !== on) continue;   // Charged Mark only leaves ground
      const gone = kind === 'discharge' && Object.keys(DISCHARGE).filter(a => has(d, a));
      if (gone && !gone.length || kind === 'batter' && !has(d, 'armour') || kind === 'crystal' && !has(d, 'bleed')) continue;
      const near4 = kind === 'rift' && dummies.filter(e => !e.dead && !e.inRift && has(e, 'shock') && dist(e.pos, d.pos) <= U.try_consuming_shock_to_trigger_shocking_rift_in_radius_on_shocking_enemy / 10);
      if (near4 && near4.length < U.consume_shock_of_X_enemies_to_trigger_shocking_rift) continue;
      if (!spend(T)) continue;
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
      else if (kind === 'crystal') for (let k = 0; k < (U.consume_bleed_to_create_X_haemocrystals || 1); k++) {
        if (crystals.length >= (U.support_haemocrystals_maximum_allowed_crystals || Infinity)) break;
        const a = Math.random() * Math.PI * 2, r = Math.random() * ts.support_haemocrystals_crystal_creation_radius / 10, q = { x: c.x + Math.sin(a) * r, z: c.z + Math.cos(a) * r };
        crystals.push(q); fx.ring(q, .1, .35, 'blood', .3);
        later(dur, () => { crystals.splice(crystals.indexOf(q), 1); boom(q, R, X); });
      }
      else if (kind === 'current') { const e = near(d.pos, sh(X).chainRange || SIM.chainRange, e => e !== d); if (e) chain(chest(d), e, X, (sh(X).chains || 1) - 1, new Set([d])); }
      else if (kind === 'erupt') for (let k = 0; k < (ts.base_number_of_projectiles || 1); k++) {
        const a = Math.random() * Math.PI * 2, r = rnd(ts.skill_mortar_minimum_projectile_distance, ts.skill_mortar_maximum_projectile_distance) / 10, q = { x: c.x + Math.sin(a) * r, z: c.z + Math.cos(a) * r };
        later(SIM.meteor, () => boom(q, R, X));
      } else {   // a field that pulses: Static Shocks, Shocking Rift
        const F = fields[kind], max = ts.maximum_grounding_shocks_allowed || ts.number_of_shocking_rifts_allowed, me2 = { dead: false, in: near4 || [] };
        if (F.length >= max) { const old = F.shift(); old.dead = true; old.in.forEach(e => e.inRift = false); }
        F.push(me2);
        const gap = kind === 'rift' ? ts.shocking_rift_pulse_interval_ms / 1000 / (1 + (ts['shocking_rift_speed_+%_per_shock_consumed'] || 0) * near4.length / 100) : ts.grounding_shocks_pulse_delay_ms / 1000;
        const pulses = kind === 'rift' ? ts.shocking_rift_number_of_pulses : Math.floor((sh(X).duration || ts.base_skill_effect_duration / 1000) / gap);
        if (near4) for (const e of near4) { e.st.shock = 0; e.inRift = true; }
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
  function inflict(d, a, S, k = 1, raw = null, o = null) {
    if (d.dead || d.imm[a] > 0) return;
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
      const v = ailDps(d, a, raw), w = d.st[a] > 0 && d.burn[a];
      if (o?.eff) v.dps *= o.eff;
      if (!w || w.sim && !v.sim || w.sim === v.sim && v.dps > w.dps) d.burn[a] = v;
    }
    if (a === 'bleed') d.red = S.dmg?.sum?.['bleeding_monsters_attack_speed_+%'] != null && S.dmg.sum;   // See Red: they move and attack faster while bleeding
    const fresh = !(d.st[a] > 0); d.st[a] = Math.max(d.st[a] || 0, o?.dur ?? DUR[a]); d.by = S;
    if (o?.mag) d.mag[a] = fresh ? o.mag : Math.max(d.mag[a] || 0, o.mag);   // the strongest shock / chill stays
    else if (fresh) delete d.mag[a];
    if (a === 'shock') trigger(S, 'shock', d);   // a shock over a shock is shocking the enemy too
    if (!fresh) return;
    if (!S.src && EL_AIL.includes(a) && !(time < me.unbound?.until)) { const i = byName('Unbound Avatar'), UA = i >= 0 && base(i)?.dmg?.stats; if (UA) me.fury = Math.min(UA.ailment_bearer_required_stacks_to_use, (me.fury || 0) + 1); }   // Unbound Fury
    siphon(a, d); if (!S.src) glory(d, a === 'stun' ? 'heavy_stun' : a); if (a === 'stun') houndBlow(d, true);
    // Combat Frenzy: a frenzy charge on freezing, electrocuting or pinning an enemy, once every its cooldown
    const CF = ['freeze', 'electrocute', 'pin'].includes(a) && onS('Combat Frenzy');
    if (CF && time - (me.cfAt ?? -99) >= CF.dmg.stats.skill_combat_frenzy_x_ms_cooldown / 1000) { me.cfAt = time; gainCharge('frenzy', CF.label); }
    // Breachlord's Rift: freezing or electrocuting breaks its share of the enemy's armour
    const BR = (a === 'freeze' || a === 'electrocute') && d.stat.armour > 0 && !(d.st.armour > 0) && S.dmg?.sum?.['support_break_%_armour_on_freeze_or_electrocute'];
    if (BR && (d.cut = (d.cut || 0) + d.stat.armour * BR / 100) >= d.stat.armour) { d.cut = 0; inflict(d, 'armour', S, 1, null, {}); }
    const MD = d.mark?.D;   // Freezing / Voltaic Mark: the state it builds up consumes it and grants you its buff
    if (MD?.gain && (a === 'freeze' && MD.freeze || a === 'electrocute' && MD.electrocute)) {
      const M = d.mark; d.mark = null; trigger(M.S, 'mark', d); buffs = buffs.filter(b => !b.gain || b.sup);
      buffs.push({ label: M.label, name: M.name, c: css(MD.gain.el), s: MD.gain.time, gain: MD.gain }); say(t('{0} consumes {1}', S.label, M.label), 'mark');
    }
    if (a === 'freeze') gainBuff(S, 'freeze');
    if (a === 'ignite') d.ignBy = S;   // Fiery Death: the enemies the supported skill ignites
    const p = chest(d);
    if (a === 'freeze') { fx.text(over(d), t(STATE[a]), css('ice'), .36); fx.emit(22, { p, r: .3, v: 1.6, up: 1, life: .6, size: .16, c: 'ice', c2: 'white', g: 5 }); fx.ring(d.pos, .2, 1.1, 'ice', .35); }
    else if (a === 'stun') { fx.text(over(d), t(STATE[a]), '#f2ead8', .36); fx.ring(d.pos, .2, 1.2, 'white', .3); d.wind = null; if (!S.src) remnantOn('stun', d); }
    else if (a === 'armour') { fx.text(over(d), t(STATE[a]), css('dust'), .34); fx.emit(16, { p, v: 3, up: 2, life: .6, size: .1, c: 0xb0a898, g: 12, k: 1.2 }); }
    else if (a === 'electrocute' || a === 'pin' || a === 'maim') { fx.text(over(d), t(STATE[a]), css(PIP[a]), .36); fx.ring(d.pos, .2, 1.1, PIP[a], .3); if (a === 'electrocute') d.wind = null; }
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
  const shocked = d => d.st.shock > 0 ? 1 + (d.mag.shock ?? GC.BaseShockMagnitude) / 100 : 1;
  // what the enemy takes of r damage of a type now: armour lowered by Armour Break (none when fully broken, which also adds
  // physical damage taken) and by a curse, resistance lowered by exposure and curses (both less on rarer monsters), and shock
  // Intimidated, they take more. note: as a factor of its own, not added to the other increases
  function takes(d, el, r, isHit = true, ow) { return defence(d, el, r, isHit, ow) * shocked(d) * (d.intim > time ? 1 + INTIM / 100 : 1); }
  function defence(d, el, r, isHit = true, ow = 0) {
    let st = d.stat; const C = d.curse?.C, k = d.curse?.k || 0;
    if (el === 'physical' && (d.cut > 0 || d.st.armour > 0 || C?.armour)) st = { ...st, armour: d.st.armour > 0 ? 0 : Math.max(0, st.armour - d.cut - (C?.armour || 0) * k) };
    const low = (d.st.expo > 0 && d.expo?.els.includes(el) ? d.expo.mag * st.expoEffect : 0) - (C?.res[el] || 0) * k;
    if (low) st = { ...st, res: { ...st.res, [el]: st.res[el] - low } };
    const W = el === 'chaos' && d.wither ? (d.wither = d.wither.filter(u => u.until > time)).reduce((t, u) => t + u.pct, 0) : 0;
    const crush = isHit && el === 'physical' && d.crushed > time ? r * CRUSH / 100 : 0;   // Crushed: less physical damage reduction
    const got = enemyTakes(st, el, r, isHit), over = el === 'physical' ? (r - got) * ow / 100 : 0;   // High Velocity Rounds: Overwhelm, its share of the reduction ignored
    return (got + over + crush) * (isHit && el === 'physical' && d.st.armour > 0 ? 1 + (BROKEN.taken + (time < d.sunder?.until ? d.sunder.pct : 0)) / 100 : 1) * (1 + W / 100);
  }
  // Withered for s seconds, its chaos damage taken (Wither's own, else keywords.json's), up to its most at once
  function withers(d, s, pct = WITHER.per) { const w = d.wither = (d.wither || []).filter(u => u.until > time); w.push({ until: time + s, pct }); if (w.length > WITHER.max) w.shift(); }
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
    'added_physical_damage_%_ward_cost': [['freeze'], ['physical']], chaos_damage_can_freeze: [['freeze'], ['chaos']], chaos_damage_can_shock: [['shock'], ['chaos']],
    base_chaos_damage_can_electrocute: [['electrocute'], ['chaos']], elemental_damage_also_contributes_to_flammability_ignite_chill_freeze_and_shock: [['ignite', 'chill', 'freeze', 'shock'], ['fire', 'cold', 'lightning']],
    elemental_damage_can_inflict_bleeding: [['bleed'], ['fire', 'cold', 'lightning']], fire_damage_can_inflict_bleeding: [['bleed'], ['fire']] };
  function afflict(d, S, raw, o = {}) {
    const A = S.dmg.ail, N = A.never, AL = A.always, E = A.expo, thr = Math.max(1, d.stat.ail * awe(d, 'ailment')), x = e => raw[e] || 0, UB = !S.src && time < me.unbound?.until && me.unbound, roll = c => Math.random() * 100 < c, eroll = c => roll(c * (UB ? UB.chance : 1));
    const ex = (els, ms) => ms && expo(d, els, EXPO.res * E.effect, ms / 1000);
    if (roll(S.dmg.stats?.['base_chance_to_daze_%'] || 0)) daze(d, DAZE.time);   // Wind Blast, Siphoning Strike
    // the damage of the hit that counts for an ailment: its own type's, every type's with "all damage can <ailment>" (the
    // build's; Pinnacle of Power's buff: every Elemental Ailment, BuffDefinitions elemental_power; all damage to bleeding /
    // poisoned enemies contributing to chill), and the types the build's "<type> damage can <ailment>" add (EXTRA)
    const SU = S.dmg.sum || {}, PN = !S.src && time < me.pinn?.until, allD = Object.values(raw).reduce((t, v) => t + v, 0);
    const can = a => PN && a !== 'electrocute' || SU[`all_damage_can_${a}`] || a === 'ignite' && SU.you_and_allies_in_presence_all_damage_can_ignite
      || a === 'electrocute' && S.P.attack && SU.all_attack_damage_can_electrocute
      || a === 'chill' && (SU.all_damage_to_bleeding_enemies_contributes_to_chill && has(d, 'bleed') || SU.all_damage_to_poisoned_enemies_contributes_to_chill && has(d, 'poison'));
    const adds = a => Object.entries(EXTRA).flatMap(([k, [as, es]]) => SU[k] && as.includes(a) ? es : []), xa = (a, e) => can(a) ? allD : [...new Set([e, ...adds(a)])].reduce((t, k) => t + x(k), 0);
    if (xa('ignite', 'fire') && (S.els.includes('fire') || can('ignite') || adds('ignite').length) && !N.ignite) {   // flammability: each hit adds some for a while, the total is the chance to ignite
      // Incendiary Shot: its ignite lasts longer for each of its pellets that hit this enemy
      const PH = S.dmg.stats['ignite_duration_+%_per_shotgun_pellet_hit'], pellets = PH ? 1 + PH * (S.pellets ??= new Map()).set(d, (S.pellets.get(d) || 0) + 1).get(d) / 100 : 1;
      d.flam.push({ v: xa('ignite', 'fire') / thr * GC.IgniteChanceMultiplier * A.igniteChance, s: GC.BaseFlammabilityDuration });
      if (AL.ignite || eroll(d.flam.reduce((t, f) => t + f.v, 0))) { inflict(d, 'ignite', S, 1, { ...raw, fire: xa('ignite', 'fire') }, { dur: DUR.ignite * A.igniteTime * pellets, eff: A.igniteEffect * (S.heated ? 1 + (S.dmg.stats['ignite_effect_+%_final_if_heat_is_consumed'] || 0) / 100 : 1) }); ex(['fire'], E.onIgnite); }   // Incendiary Shot's Heat
    }
    const W = d.wet?.until > time ? d.wet : null;   // Thunderstorm's drench
    if (xa('shock', 'lightning') && !N.shock && (AL.shock || eroll(xa('shock', 'lightning') / thr * GC.ShockChanceMultiplier * A.shockChance * (1 + (W?.shock || 0) / 100) * (1 + (me.galv?.dmg.stats['galvanic_field_shock_chance_+%_final'] || 0) / 100) * (1 + (me.thrill?.until > time && me.thrill.X['support_thrill_of_the_kill_buff_shock_chance_+%'] || 0) / 100)))) {
      const so = { dur: DUR.shock * A.shockTime, mag: GC.BaseShockMagnitude * A.shockEffect }; inflict(d, 'shock', S, 1, raw, so); ex(['lightning'], E.onShock);
      if (me.galv) galvanic(d);
      // Shock Conduction: its chance to shock each other enemy within its radius too
      const SCn = S.dmg.sum?.['support_%_chance_to_shock_nearby_enemy_on_shock'];
      if (SCn) for (const e of inside(d.pos, S.dmg.sum.shock_nearby_enemy_base_area_of_effect_radius / 10)) if (e !== d && roll(SCn)) inflict(e, 'shock', S, 1, raw, so);
    }
    if (xa('chill', 'cold') || xa('freeze', 'cold')) {
      const mag = Math.min(GC.ChillMaxEffect, GC.ChillEffectMultiplier * xa('chill', 'cold') * A.chillDamage / thr * A.chillEffect);
      if (mag >= CHILL_MIN) inflict(d, 'chill', S, 1, raw, { dur: DUR.chill * A.chillTime, mag });
      if (!N.freeze) AL.freeze ? inflict(d, 'freeze', S, 1, null, { dur: DUR.freeze * A.freezeTime }) : build(d, 'freeze', xa('freeze', 'cold') * GC.FreezeDamageScale * A.freeze * (UB ? UB.build : 1) * (1 + (d.mark?.D?.freeze || 0) / 100) * (1 + (W?.freeze || 0) / 100), S, A);
      if (o.crit) ex(['cold'], E.onColdCrit);
    }
    if (A.electrocute) build(d, 'electrocute', xa('electrocute', 'lightning') * GC.ElectrocuteDamageScale * A.electrocute * (UB ? UB.build : 1) * (1 + (d.mark?.D?.electrocute || 0) / 100), S, A);
    const wasPinned = d.st.pin > 0;
    // Lockdown: its most more Pin buildup on enemies within 2 m of you (its text). note: how it falls off past 2 m is not
    // in the data (nor in PoB2): none there
    const LK = !S.src && dist(pp, d.pos) <= 2 ? 1 + (S.dmg?.finals?.['support_lockdown_distance_based_pin_damage_+%_final'] || 0) / 100 : 1;
    if (A.pin) build(d, 'pin', (A.pinPhys ? x('physical') : allD) * GC.PinDamageScale * A.pin * LK, S, A);
    const all = Object.entries(raw).reduce((t, [e, v]) => t + v * (e === 'physical' ? A.stunPhys : 1), 0);
    if (!N.stun) AL.stun ? inflict(d, 'stun', S, 1, null, { dur: DUR.stun }) : build(d, 'stun', all * A.stunMelee * GC.HeavyStunDamageScale * A.stun * (o.stunX || 1), S, A);
    // Incision: each stack on the enemy adds to the chance to bleed it; bleeding it removes them, and the support's bleeding
    // is more effective per Incision removed recently
    if (xa('bleed', 'physical') && !N.bleed && roll(A.bleed * (o.full ? 1 + A.bleedFull / 100 : 1) + INCISION.per * (d.inc || 0))) {
      me.incs = me.incs.filter(u => time - u.t <= RECENT); if (d.inc) { me.incs.push({ t: time, n: d.inc }); d.inc = 0; }
      const ri = me.incs.reduce((t, u) => t + u.n, 0);
      inflict(d, 'bleed', S, 1, { ...raw, physical: xa('bleed', 'physical') }, { dur: DUR.bleed * A.bleedTime, eff: A.bleedEffect * (1 + Math.min(INCISION.cap, A.incEff * ri) / 100) * (1 + (S.concoct || 0) / 100) });   // Concoct
    }
    if (A.incision) d.inc = Math.min(INCISION.max, (d.inc || 0) + A.incision);
    // Aggravate (keywords.json): the attack's chance on hit (Rake, Bleeding Concoction), Herald of Blood's explosion's
    // chance, Rusted Spikes' chance when the hit Pins aggravate the bleeding the enemy has, treated as moving for the rest
    // of it: its damage doubled (AGGRAVATED). note: a moving enemy's own extra bleeding damage is not simulated
    const st0 = S.dmg?.stats || {}, AG = (S.P.attack ? st0['base_aggravate_bleeding_on_attack_hit_chance_%'] || 0 : 0) + (S.aggX || 0)
      + (!wasPinned && d.st.pin > 0 ? S.dmg?.sum?.['aggravate_bleeding_on_pin_chance_%'] || 0 : 0);
    if (AG && d.st.bleed > 0 && d.burn.bleed && !d.burn.bleed.agg && roll(AG)) { d.burn.bleed.agg = true; fx.text(over(d), t('Aggravated Bleeding'), css('blood'), .32); }
    // Tacati's Ire: its poison deals its damage faster per Rage you have (as much damage over a shorter time)
    const PF = 1 + (S.dmg?.sum?.['faster_poison_%_per_current_rage'] || 0) * me.rage / 100;
    if (xa('poison', 'physical') + x('chaos') && roll(A.poison)) inflict(d, 'poison', S, 1, can('poison') ? { physical: allD } : raw, { dur: DUR.poison * A.poisonTime / PF, eff: A.poisonEffect * PF });
    if (roll(A.maim + (d.st.poison > 0 ? A.maimPoisoned : 0) + (d.st.bleed > 0 ? A.maimBleeding : 0)) || o.crit && A.maimCrit) inflict(d, 'maim', S, 1, null, { dur: MAIM.time, mag: MAIM.move + (A.maimMore || 0) });
    if (A.maimAfterPin && d.st.pin > 0) d.unpin = { s: A.maimAfterPin, S };   // maimed for a while once this Pin ends
    if (E.hit) expo(d, ELEM, E.hit * E.effect, (E.hitMs || DUR.expo * 1000) / 1000);
    const brk = N.armour ? 0 : (A.breakFlat + x('physical') * (A.breakPct + (S.breakPct || 0)) / 100 + x('chaos') * (S.dmg.sum?.['chaos_damage_%_dealt_as_armour_break'] || 0) / 100 + x('fire') * (S.dmg.stats?.['armour_break_fire_damage_%_dealt_as_armour_break'] || 0) / 100
      + (d.crushed > time ? x('physical') * (S.dmg.sum?.['crushed_target_%_physical_damage_taken_as_armour_break'] || 0) / 100 : 0)) * A.breakMore;   // Tumult's consumed frenzy charge; Uul-Netol's Embrace's share of chaos, Smash to Smithereens' of fire; Styrn's Ferocity's share of physical against the Crushed
    if (brk > 0 && d.stat.armour > 0 && !(d.st.armour > 0)) {
      if (!S.src && Math.random() * 100 < (S.dmg.onHit?.breakEndurance || 0)) chargeBy('endurance', S);   // Armour Break II, Break Endurance
      d.cut = (d.cut || 0) + brk * (d.stat.rarity === 'normal' ? A.breakNormal : d.stat.rarity === 'magic' ? A.breakMagic : 1);
      if (d.cut >= d.stat.armour) { d.cut = 0; inflict(d, 'armour', S, 1, raw, { dur: BROKEN.time }); scavenge(d); daze(d, S.dmg.sum?.support_daze_break_duration_ms / 1000); if (A.maimOnBreak) inflict(d, 'maim', S, 1, null, { dur: MAIM.time }); }
    }
  }
  // freeze, heavy stun, electrocute and pin bars: buildup as a % of the enemy's poise; after one fills, it is harder to fill
  // again for a while (GameConstants <name>ThresholdModifier / <name>ModifierDuration)
  const BAR = { freeze: 'Freeze', stun: 'HeavyStun', electrocute: 'Electrocute', pin: 'Pin' };
  // Overwhelming Presence: the enemies in your Presence have its less stun and ailment thresholds
  const awe = (d, k) => { const st = onS('Overwhelming Presence')?.dmg.stats; return st && dist(d.pos, pp) <= sheet().overgrow.r ? 1 + st[`skill_overwhelming_pressure_aura_enemy_${k}_threshold_+%`] / 100 : 1; };
  // Daze: for its time the enemy takes more stun buildup
  const daze = (d, s) => { if (!(s > 0)) return; if (!(d.dazed > time)) fx.text(over(d), t('Daze'), css('gold'), .3); d.dazed = Math.max(d.dazed || 0, time + s); };
  function build(d, a, n, S, A) {
    if (!(n > 0) || d.st[a] > 0 || d.imm[a] > 0) return;
    if (a === 'stun' && d.dazed > time) n *= 1 + DAZE.stun / 100;
    const G = BAR[a], hard = d.lock[a] > 0 ? 1 + GC[G + 'ThresholdModifier'] / 100 : 1;
    d.bar[a] = (d.bar[a] || 0) + n / (Math.max(1, d.stat.poise * awe(d, a === 'stun' ? 'stun' : 'ailment')) * hard) * 100; d.calm = 0;
    if (d.bar[a] < 100) return;
    d.bar[a] = 0; d.lock[a] = GC[G + 'ModifierDuration'];
    inflict(d, a, S, 1, null, { dur: a === 'freeze' ? DUR.freeze * A.freezeTime : DUR[a] });
    if (a === 'stun' && !S.src) trigger(S, 'heavyStun', d);   // Smash to Smithereens
    const H = a === 'stun' && !S.src && S.dmg?.onHit;   // Enduring Impact: endurance charges on heavy stunning
    if (H) for (let k = d.stat.rarity === 'unique' ? H.stunEnduranceUnique : Math.random() * 100 < H.stunEndurance ? 1 : 0; k > 0; k--) chargeBy('endurance', S);
    // Vanguard: heavy stunning with a supported skill grants its Guard per 10 Strength for its duration
    // note: the scene has no light stun, so its Guard on a light stun is not simulated
    const VG = a === 'stun' && !S.src && S.dmg?.sum?.gain_X_guard_on_heavy_stun_per_10_strength;
    if (VG) { const g = Math.min(VG * Math.floor((sheet().attrs?.str || 0) / 10), 2 * (me.maxL || 0)); if (g > me.guard) { me.guard = g; later(S.dmg.sum.guard_on_stun_guard_duration_ms / 1000, () => { if (me.guard === g) me.guard = 0; }); } }
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
    const o = d.dots.find(o => o.name === S.name), s = S.P.dur || 5, v = dotOf(d, S);
    // Drain Ailments: a spell's damage over time Consumes an ailment of the enemy (one at random) for its more damage
    const DA = S.P.spell && S.dmg?.finals?.['support_drained_ailment_damage_over_time_+%_final_if_ailment_consumed'], on = DA ? DRAINED.filter(a => has(d, a)) : [];
    if (on.length) { consume(d, S, on[Math.floor(Math.random() * on.length)]); v.dps *= 1 + DA / 100; }
    if (o) Object.assign(o, v, { s, S }); else d.dots.push({ s, name: S.name, label: S.label, spread: !!S.P.spread, chaos: S.els.includes('chaos'), S, ...v });
    d.by = S; return d.dots.find(o => o.name === S.name);
  }
  function markOn(d, S) {
    // Living Bomb, Untether: up to their most seeds at a time, the oldest gives way
    const LB = S.dmg?.stats?.living_bomb_base_number_of_bombs_allowed;
    if (LB) { const on = dummies.filter(e => e !== d && e.mark?.name === S.name).sort((a, b) => a.mark.at - b.mark.at); while (on.length >= LB) on.shift().mark = null; }
    d.mark = { at: time, s: sh(S).duration || S.P.dur || 8, els: S.P.els, label: S.label, name: S.name, D: S.dmg?.mark, gain: S.P.gain, bomb: S.P.bomb, hits: 0, R: S.A, S: { ...S, src: 'mark', ail: ailOf(S.P.els) }, hound: S.dmg?.stats?.['hunters_mark_%_of_phys_damage_over_time_as_build_up'] != null && S };
    fx.ring(d.pos, 2.2, .5, 'mark', .4); fx.bolt(hand(), V(d.pos.x, 2, d.pos.z), 'mark', .15, .02, .1);
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
  // the skill a meta gem triggers: the build's first triggerable spell (Feral Invocation: a Shapeshifting attack)
  const trigOf = T => api.build().gems.findIndex((g, j) => { const b = g.name !== T.name && base(j); return b && !NOHIT.has(b.kind) && (T.manaPer ? b.P.attack && api.info(g).gem?.types?.includes('Shapeshift') : b.P.triggerable && b.P.spell); });
  // Energy (keywords.json): a meta gem with its gains in the data (Cast on X, Invocations) gains its centienergy per Power (per block: Cast / Curse on Block)
  // of the enemy (Feral Invocation: per its mana spent), more by its increased energy; its maximum is 1 per its ms of the
  // triggered skill's use time, at which it triggers it. An Invocation stores up to its maximum and triggers when used, as
  // many times as its energy covers
  // note: that modifiers to total use time count double here is not simulated
  function gainEnergy(T, n, j) {
    T.need = 1000 / (base(j).dmg?.speed || 1 / SIM.castTime) / T.perMs;
    T.energy = Math.min(T.cap || T.need, T.energy + n * T.more);
  }
  function invoke(T) {
    const j = trigOf(T), n = j < 0 ? 0 : Math.floor(T.energy / T.need);
    if (!n) return toast(t('{0} needs {1} Energy', T.label, Math.ceil(T.need)));
    T.energy -= n * T.need; say(t('{0} triggers {1}', T.label, base(j).label), T.el);
    for (let k = 0; k < n; k++) later(.12 + k * .25, () => use(j, { at: near(pp, 30)?.pos || { x: pp.x, z: pp.z }, src: 'meta', rand: T.rand }));
  }
  function event(type, p, S, d) {
    if (S.src === 'meta') return;
    for (const k in tog) {
      const T = tog[k];
      if (T.kind === 'meta' && (T.per ? T.per[type] : T.wants.includes(type))) {
        const j = trigOf(T);
        if (j < 0) continue;
        if (T.per) { gainEnergy(T, T.per[type] / 100 * (POWER[d?.stat.rarity] || 1), j); if (T.cap || T.energy < T.need) continue; T.energy -= T.need; }
        else { if (++T.energy < T.need) continue; T.energy = 0; }
        const at = { x: p.x, z: p.z };
        say(t('{0} triggers {1}', T.label, base(j).label), T.el);
        fx.glow({ x: pp.x, y: 2.2, z: pp.z }, 1.4, T.el, .4);
        later(.12, () => use(j, { at, src: 'meta', rand: T.rand }));
      } else if (T.kind === 'aura' && T.P.gain && ['freeze', 'shock', 'ignite', 'armour'].includes(type) && time - T.last > 1.2) { T.last = time; gainCharge(T.P.gain, T.label); }
    }
  }
  // Culling Strike: a skill that culls (its description), or any of yours with Culling Strike (Rare and Unique enemies);
  // checked before the hit's damage, the threshold raised by its +%. A cull recovers Life Drain's and Soul Drain's % of your
  // maximum life and mana
  const underCull = (d, S) => d.life + d.es <= (d.max + d.maxEs) * CULL[d.stat.rarity || 'normal'] * (1 + (gst(S)['culling_strike_threshold_+%'] || 0) / 100) / 100;
  const cullable = (d, S) => {
    const r = d.stat.rarity || 'normal';
    return !d.dead && (S.P.culls || (r === 'rare' || r === 'unique') && (S.g?.supports?.some(n => /^Culling Strike/.test(n)) || d.attr >= attr()?.skill_attrition_culling_strike_at_x_or_more_stacks)) && underCull(d, S);
  };
  // Detonate Living: its hit on an enemy under the Culling Strike threshold kills it, which explodes (its part) with its
  // permillage of the monster's life as physical. note: the game lets it target only such enemies; here any hit, the
  // others take its own small hit
  // a share of a monster's life dealt as one element over an area, as it is (no bonus of the scene's or the build's)
  const lifeBlast = (c, R, X, el, n) => n > 0 && area(c, R, { ...X, el, els: [el], ail: [], src: 'corpse', dmg: { ...X.dmg, hits: { [el]: [n, n] } } }, { noPay: true, noTouch: true });
  function detonate(d, S) {
    const X = partOf(S, 'DetonateLivingExplodePlayer'), c = { x: d.pos.x, z: d.pos.z }, n = d.max * (X?.dmg.stats.corpse_explosion_monster_life_permillage_physical || 0) / 1000;
    fx.text(over(d), t('Culling Strike'), css('blood'), .4); damage(d, d.life + d.es, S);
    if (X) later(.05, () => { boom(c, X.A, { ...X, mult: S.mult, src: 'detonate' }); lifeBlast(c, X.A, X, 'physical', n); });
    return true;
  }
  function cull(d, S) {
    if (!cullable(d, S)) return false; const X = gst(S);
    // Thrill of the Kill: culling a shocked enemy, its buff: its share of attack damage as extra lightning and its shock chance
    const TS = X.support_thrill_of_the_kill_buff_base_duration_ms / 1000;
    if (TS && d.st.shock > 0) { me.thrill = { X, until: time + TS }; setBuff({ label: api.info({ name: S.g.supports.find(n => /^Thrill of the Kill/.test(n)) }).label, c: css('lightning'), s: TS }); }
    fx.text(over(d), t('Culling Strike'), css('blood'), .4); damage(d, d.life + d.es, S);
    me.life = Math.min(me.maxL, me.life + me.maxL * (X['recover_%_maximum_life_on_cull'] || 0) / 100 + (X.active_skill_life_gained_on_cull || 0)); me.mana = Math.min(me.maxM, me.mana + me.maxM * (X['recover_%_maximum_mana_on_cull'] || 0) / 100);
    return true;
  }
  // Bloodhound's Mark: the marked enemy heavily stunned, or killed after enough blood loss (its % of the stun threshold),
  // consumes it for Blood Explosion there, its more damage and area up to its most from the buildup
  function houndBlow(d, full) {
    const M = d.mark, X = M?.hound; if (!X) return; const st = X.dmg.stats, k = full ? 1 : Math.min(1, (d.bar.stun || 0) / 100);
    if (!full && (d.bar.stun || 0) < st['hunters_mark_%_of_max_threshold_to_trigger_explosion_on_death']) return;
    d.mark = null; say(M.label, 'blood');
    boom({ x: d.pos.x, z: d.pos.z }, M.R * Math.sqrt(1 + st['hunters_mark_explosion_area_of_effect_+%_final_from_buildup'] * k / 100), { ...X, mult: X.mult * (1 + st['hunters_mark_buildup_%_as_explosion_damage_+%_final'] * k / 100) });
  }
  // Blood Hunt: its hit on an enemy with at least its Blood Loss (keywords.json BloodLoss: the physical damage over time
  // it has taken) consumes it and its bleeding in a blood explosion (its part), the area larger by its % per its amount
  // consumed, up to 500%, and the enemies in it losing its % of that Blood Loss as life
  function bloodHunt(S, d) {
    const st = S.dmg.stats, X = partOf(S, 'BloodHuntExplosionPlayer'), xs = X?.dmg.stats, n = d.blood || 0;
    if (!X || n < st.blood_hunt_X_blood_loss_consumed_to_explode) return;
    d.blood = 0; clear(d, 'bleed'); delete d.burn.bleed;
    const c = { x: d.pos.x, z: d.pos.z }, R = X.A * Math.sqrt(1 + Math.min(500, xs['blood_hunt_skill_area_of_effect_+%_final_per_X_blood_loss_consumed_up_to_500%'] * Math.floor(n / xs['blood_hunt_X_blood_loss_consumed_for_skill_area_of_effect_+%_final'])) / 100);
    fx.explode(V(c.x, .8, c.z), R, 'blood'); boom(c, R, { ...X, mult: S.mult });
    for (const e of inside(c, R)) damage(e, n * xs['blood_hunt_explosion_%_blood_loss_to_deal_as_life_loss'] / 100, X, false, true);
  }
  // Wing Blast, Boneshatter: its hit Heavy Stuns an enemy Primed for it (keywords.json PrimedStun), which releases its
  // shockwave (its part; more from a Unique enemy); Wing Blast's has its chance to grant you a Power Charge.
  // note: Wing Blast's knockback and leap back are not simulated
  const SHOCKWAVE = { 'Wing Blast': ['WingBlastStunExplosionPlayer', 'wing_blast_shockwave_damage_+%_final_if_created_from_unique'], Boneshatter: ['BoneshatterShockwavePlayer', 'boneshatter_damage_+%_final_if_created_from_unique'] };
  function wingBlast(S, d) {
    if ((d.bar.stun || 0) < PRIMED[d.stat.rarity]) return;
    const [id, uq] = SHOCKWAVE[S.name], st = S.dmg.stats, X = partOf(S, id), c = { x: d.pos.x, z: d.pos.z };
    d.bar.stun = 0; d.lock.stun = GC.HeavyStunModifierDuration; inflict(d, 'stun', S, 1, null, { dur: DUR.stun });
    if (X) { fx.ring(c, .3, X.A, 'white', .35); boom(c, X.A, { ...X, mult: S.mult * uniqueMore(d, X.dmg.stats[uq]), src: 'shockwave' }); }
    if (Math.random() * 100 < st['wing_blast_chance_to_gain_power_charge_on_stun_%']) gainCharge('power', S.label);
  }
  // Repulsion: its curse inflicts its Fragility; a hit of yours on the cursed enemy removes it for an explosion there
  // (its own damage and area) with more stun buildup per Fragility, and that enemy cannot be cursed by it for its time.
  // note: its knockback is not simulated
  function repulse(d) {
    const RS = d.curse.S, st = RS.dmg.stats, c = { x: d.pos.x, z: d.pos.z };
    d.curse = null; d.noRepulse = time + st.repulsion_curse_when_detonated_prevent_curse_for_X_ms / 1000;
    fx.ring(c, .3, RS.A, 'gold', .4);
    const D = granted('Repulsion Wave', RS.g?.level), X = D && { ...asTrig(RS, { ...D, id: 'Repulsion Wave' }), label: RS.label, src: 'repulsion' }; if (!X) return;
    later(.05, () => boom(c, RS.A, X, { stunX: 1 + st['curse_repulsion_shockwave_hit_damage_stun_multiplier_+%_final_per_fragility_on_special_object'] * st.curse_repulsion_applies_X_fragility / 100 }));
  }
  // Voltaic Barrier: a projectile of yours through its wall is energised; its hit discharges the part's chaining
  // lightning to up to its most other enemies within its radius of the one hit, each beam chaining its number of times
  function discharge(X, d) {
    const n = X.dmg.stats.voltaic_barrier_trigger_maximum_number_of_extra_targets, seen = new Set([d]);
    for (const e of nearest(d.pos, n, e => e !== d && dist(e.pos, d.pos) <= X.A)) chain(chest(d), e, { ...X, src: 'discharge' }, X.dmg.stats.number_of_chains || 0, seen);
  }
  // Dark Pact, Abyssal Pact: the damageable minion nearest the cursor gives its % of its life (Abyssal: of its maximum)
  // and the area around it takes the spell's hit plus that much chaos (physical); Dark Pact with no minion takes it from
  // your life, its more damage. note: the life given is added to the hit as it is, not scaled by the build's modifiers
  function pact(S) {
    const st = S.dmg.stats, dark = st['skeletal_chains_aoe_%_health_dealt_as_chaos_damage'], el = dark ? 'chaos' : 'physical', pct = dark || st['skeletal_chains_aoe_%_health_dealt_as_physical_damage'];
    const m = objs.filter(o => o.minion && !o.dead && o.segs).sort((a, b) => dist(a.pos, S.at) - dist(b.pos, S.at))[0], g = m?.segs[0];
    if (!m && !dark) return toast(t('{0} needs a minion', S.label));
    const n = (m ? (dark ? g.life : g.max) : me.life) * pct / 100, c = m ? { x: m.pos.x, z: m.pos.z } : { x: pp.x, z: pp.z };
    if (m) { g.life -= n; if (g.life <= 0) m.dead = m.slain = true; } else me.life = Math.max(1, me.life - n);
    const H = { ...S.dmg.hits }, h = H[el] || [0, 0]; H[el] = [h[0] + n, h[1] + n];
    fx.ring(c, .2, S.A, el, .5); fx.emit(18, { p: { x: c.x, y: .8, z: c.z }, r: .3, v: 2, up: 1, life: .5, size: .16, c: el, c2: 'blood' });
    boom(c, S.A, { ...S, el, els: [...new Set([...S.els, el])], mult: S.mult * (m ? 1 : 1 + (st['skeletal_chains_no_minions_damage_+%_final'] || 0) / 100), dmg: { ...S.dmg, hits: H } });
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
    const k = 1 + st['harbinger_of_madness_damage_+%_final_per_power_of_source_enemy'] * POWER[d.stat.rarity || 'normal'] / 100, add = slain ? d.max * st['harbinger_of_madness_additional_damage_from_%_source_enemy_life'] / 100 : 0;
    const X = { ...H, mult: 1, dmg: { ...H.dmg, hits: { physical: [st.secondary_minimum_base_physical_damage * k + add, st.secondary_maximum_base_physical_damage * k + add] } } };
    const from = { x: d.pos.x, z: d.pos.z }, e = near(from, 12, e => e !== d), to = e ? { x: e.pos.x, z: e.pos.z } : around(from, 3);
    lob(fx.orb('chaos', .2), V(from.x, 1, from.z), V(to.x, .4, to.z), .5, .5, () => boom(to, X.A, X), { trail: 'chaos' });
  }
  // Azmerian Swarms: killing an enemy with an Elemental Ailment (its chance), or hitting a Rare or Unique one with one (its
  // chance), summons a Swarm for its duration, up to its most; their hits deal their more damage per type of Elemental
  // Ailment on the target
  function swarm(d, slain) {
    const W = onS('Azmerian Swarms'), st = W?.dmg?.stats; if (!st || !EL_AIL.some(a => d.st[a] > 0)) return;
    const pc = slain ? st['skill_grants_%_chance_to_summon_azmerian_swarm_on_kill_affected_by_elemental_ailment'] : POWER[d.stat.rarity] >= POWER.rare ? st['skill_grants_%_chance_to_summon_azmerian_swarm_on_hitting_unique_or_rare_enemy_affected_by_elemental_ailment'] : 0;
    if (!(Math.random() * 100 < pc)) return;
    limit(o => o.kind === W.name, st.max_azmerian_swarms);
    minion(W, around(d.pos, 1), durOf(W), { kind: W.name, more: e => 1 + EL_AIL.filter(a => e.st[a] > 0).length * st['minion_damage_+%_final_per_different_elemental_ailment_on_target'] / 100 });
  }
  // Moment of Vulnerability: its hit on an enemy Primed for Stun, Electrocution or Freeze (keywords.json: its share of the
  // bar by rarity) leaves a visage of it there for as long as that immobilisation would last; its share of the damage
  // the visage takes is dealt to the enemy too. The enemy cannot be ripped again for its delay
  // note: the visage stands still and takes no damage of its own, it only passes the share on
  function visage(d, S) {
    const st = S.dmg.stats, a = !d.visage && !(d.ripAt > time) && ['stun', 'electrocute', 'freeze'].find(a => (d.bar[a] || 0) >= PRIMED[d.stat.rarity]);
    if (!a) return;
    d.ripAt = time + st.rip_from_time_immunity_duration_ms / 1000;
    const v = place(d.pos.x + rnd(-1, 1), d.pos.z + rnd(-1, 1), d.mon, d.level); if (!v) return;
    Object.assign(v, { visage: d, share: st['time_rip_damage_share_%'], until: time + DUR[a] * (a === 'freeze' ? S.dmg.ail.freezeTime : 1) });
  }
  function kill(d, S) {
    d.dead = true; stats.kills++; record('kill', S?.label || '?', d.mon.name); if (!S?.src) gainRage(sheet().rage?.gain.kill);
    houndBlow(d, false); harbinger(d, S, true); if (!S?.src) swarm(d, true); popBoils(d);
    // Killing Palm, Cull the Weak: an enemy they kill grants their charges by its rarity
    const kr = { unique: 'unique', rare: 'rare' }[d.stat.rarity] || 'normal_and_magic';
    const KG = S && !S.src ? ['power', 'frenzy'].filter(c => S.dmg?.stats?.[`skill_grant_X_${c}_charges_against_${kr}_monsters`]) : [];
    for (const c of KG) for (let k = S.dmg.stats[`skill_grant_X_${c}_charges_against_${kr}_monsters`]; k > 0; k--) chargeBy(c, S);
    const r = d.stat.rarity || 'normal';   // the kill refills your flasks
    // Bounty: a killing blow of a supported skill grants its more flask and charm charges
    const BY = !S?.src && S?.dmg?.sum || {}, bk = k => 1 + (BY[`support_${k}_charges_gained_+%_final_from_killing_blow`] || 0) / 100;
    flasks().forEach((f, n) => { if (f) me.fl[n] = Math.min(f.max, flaskLeft(n) + POWER[r] * FLASK_GAIN[r] * f.gain * bk(n ? 'mana_flask' : 'life_flask')); });
    charms().forEach((f, n) => { if (f) me.cc[n] = Math.min(f.max, charmLeft(n) + POWER[r] * CHARM_GAIN * f.gain * bk('charm')); });
    if (r === 'rare' || r === 'unique') charmUse('killing_rare_or_unique_enemy');
    const st = d.st, p = { x: d.pos.x, z: d.pos.z }, frozen = st.freeze > 0, M = d.mark, f = d.fig;
    // Crushing Fear: an enemy it kills is crushed into its shockwave (its part, its secondary radius), more damage and area
    // per the enemy's power (note: the stats say per power of a culled enemy; here of any it kills)
    const CF = S && !S.src && partOf(S, 'CrushingFearNovaPlayer');
    if (CF) {
      const cs = CF.dmg.stats, pw = POWER[r] || 1, A = radOf(CF) * Math.sqrt(1 + cs['crushing_fear_area_of_effect_+%_final_per_power_of_culled_enemy'] * pw / 100);
      later(.1, () => { pop(p, A, 'chaos'); boom(p, A, { ...CF, gm: (CF.gm ?? 1) * (1 + cs['crushing_fear_damage_+%_final_per_power_of_culled_enemy'] * pw / 100) }); });
    }
    if (st.shock > 0) gainBuff(S, 'shockKill');
    if (st.electrocute > 0) trigger(S, 'electrocuteKill', d);
    deathBlast(d, frozen, S);
    // Cannibalism, on a persistent buff that is up: life recovered on kill
    for (const g of api.build().gems) if (tog[g.name]) me.life = Math.min(me.maxL, me.life + me.maxL * (api.damage?.(g)?.lifeOnKill || 0) / 100);
    // heralds: an enemy that dies with the ailment of their element explodes
    for (const k in tog) {
      const T = tog[k], a = T.kind === 'herald' && !['Herald of Ash', 'Herald of Plague'].includes(k) && (k !== 'Herald of Thunder' || S?.P?.attack) && AILMENT[T.P.el];   // Herald of Ash: ash(); Herald of Thunder: attack kills
      if (a && st[a] > 0) { const bl = d.blood; later(.1, () => herald(T, p, bl)); }   // its Blood Loss, before the corpse is cleaned
    }
    // Herald of Plague: a poisoned enemy killed spreads its poison to the enemies within its radius, its chance to Hinder them
    const hs = st.poison > 0 && onS('Herald of Plague')?.dmg.stats;
    if (hs) for (const e of inside(p, hs.herald_of_agony_poison_spread_on_kill_radius_base_magnitude_to_grant / 10)) {
      e.st.poison = Math.max(e.st.poison || 0, st.poison); e.burn.poison = { ...d.burn.poison }; fx.bolt(V(p.x, 1, p.z), chest(e), 'poison', .2, .03, .4);
      if (Math.random() * 100 < hs['hinder_chance_%_on_spreading_poioson']) e.slows.push({ until: time + HINDER.time, pct: -HINDER.slow });
    }
    if (M?.bomb) { trigger(M.S, 'mark', d); later(.06, () => { say(t('{0} explodes on the kill', M.label), 'mark'); bombed(M, p); }); }
    const sp = d.dots.find(o => o.spread);
    if (sp) {   // Contagion jumps to the neighbours and carries the other chaos debuffs with it
      const carry = d.dots.filter(o => o.spread || o.chaos), list = dummies.filter(e => !e.dead && dist(e.pos, p) <= 3.5);
      for (const e of list) { fx.bolt(V(p.x, 1, p.z), chest(e), 'chaos', .28, .03, .4); for (const o of carry) if (!e.dots.some(x => x.name === o.name)) e.dots.push({ ...o, s: 5, ...dotOf(e, o.S) }); e.by = S; }
      if (list.length) say(t('{0} spreads to {1} enemies', sp.label, list.length), 'chaos');
    }
    if (S.P.gain && !S.P.corpse && !S.src && !KG.length && !['aura', 'mark'].includes(S.P.kind)) chargeBy(S.P.gain, S);   // not on top of its own (Killing Palm's)
    event('kill', p, S);
    if (!S?.src) remnantOn('kill', d);
    if (S?.mantra) { const M = S.mantra, n = Math.min(10, (time < me.purple?.until ? me.purple.n : 0) + 1); me.purple = { n, pct: M.flame, until: time + M.flameFor }; setBuff({ label: t('Purple Flame of Chayula'), name: 'purple', c: css('chaos'), s: M.flameFor }); }   // up to 10 (keywords.json)
    const RP = !S?.src && S?.P?.melee && d.st.bleed > 0 && S.dmg?.sum?.['create_life_remnant_on_melee_kill_bleeding_enemy_%'];
    if (RP && Math.random() * 100 < RP) remnant({ ...S, name: 'Rip' }, around(d.pos, S.dmg.sum.rip_support_life_remnant_creation_radius / 10));
    if (Math.random() * 100 < (S?.dmg?.sum?.['create_verisium_remmant_on_kill_enemy_%'] || 0)) infRemnant('verisium', p, { dur: (S.dmg.sum.base_remnant_duration_ms || 0) / 1000 });   // Runic Extraction
    hatch(p);
    clean(d); d.sig = ''; d.wind = null; d.life = d.es = 0;
    f.ice.visible = f.curse.visible = f.mark.visible = f.plate.visible = false; f.sack.emissive.setRGB(0, 0, 0);
    if (frozen) {   // frozen enemies shatter: no corpse
      fx.emit(46, { p: { x: p.x, y: 1, z: p.z }, r: .3, h: 1, v: 5, up: 2, life: .8, size: .2, c: 'ice', c2: 'white', g: 9 });
      fx.ring(p, .3, 1.8, 'ice', .4); f.group.visible = false; d.corpse = 0; d.back = SIM.respawn;
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
    fx.emit(26, { p: { x: d.pos.x, y: .4, z: d.pos.z }, r: .5, v: 1.5, up: 3, life: .8, size: .22, c, c2: 'blood' }); fx.ring(d.pos, 1.3, .2, c, .4);
  }
  // Corpse skills act on a corpse near the cursor; without one they do nothing.
  function useCorpse(S) {
    const d = corpseAt(S.at, Math.max(S.A, SIM.snap));
    if (!d) { toast(t('{0} needs a corpse: kill an enemy or press C', S.label)); return null; }
    const p = { x: d.pos.x, z: d.pos.z, life: d.max }; eat(d, S.el); if (S.P.gain) chargeBy(S.P.gain, S);   // life: the corpse's monster's
    return p;
  }

  // Every enemy in a circle, plus whatever lies there and reacts (grenades, crystals, rods, gas, oil).
  function area(c, R, S, o = {}) {
    let n = 0;
    for (const d of dummies) if (!d.dead && dist(d.pos, c) <= R + SIM.body && hit(d, S, o)) n++;
    if (!o.noTouch) touch(c, R, S);
    return n;
  }
  function touch(c, R, S) {
    for (const o of objs) if (o.touch && !o.dead && o !== S.self && dist(o.pos, c) <= R + (o.r || 0)) o.touch(S);
    const fire = S.els.includes('fire');
    if (!fire && !S.P.detonator) return;
    for (const g of grounds) {
      if (g.dead || dist(g, c) > R + g.r) continue;
      if (g.type === 'gas') {
        g.dead = true; say(t('{0}: the gas cloud explodes', S.label), 'fire');
        // Decompose's: its explosion part after its delay, and its permillage of the corpse's life as chaos damage
        const X = partOf(g.S, 'CorpsewadeCorpseCloudExplosionPlayer'), gs = g.S.dmg?.stats || {}, n = (g.corpse || 0) * (gs.corpse_explosion_monster_life_permillage_chaos || 0) / 1000;
        later(X ? (gs.explosion_delay_ms || 0) / 1000 : .08, () => {
          boom(g, g.r, X ? { ...X, mult: g.S.mult, src: 'cloud' } : { ...g.S, els: ['fire'], el: 'fire', ail: ['ignite'], src: 'ground' });
          lifeBlast(g, g.r, g.S, 'chaos', n);
        });
      } else if (g.type === 'oil' && fire) {
        g.dead = true; say(t('{0}: the oil catches fire', S.label), 'fire');
        fx.explode(g, g.r, 'fire', { soft: true }); ground('burning', g, g.r, GROUND_TIME.burning, { ...g.S, els: ['fire'], el: 'fire', ail: ['ignite'], src: 'ground' });
      }
    }
  }
  function boom(c, R, S, o = {}) {
    fx.explode(c, R, S.el, o);
    if (R > 1.4 && !o.soft) shake = Math.max(shake, Math.min(.5, R * .09));
    return area(c, R, S, o);
  }
  // small impact without the full explosion
  function pop(p, r, c) {
    fx.disc(p, r, c, .28, { a: .6 }); fx.ring(p, r * .3, r, c, .3); fx.flash(p, c, 12, .2, 5);
    fx.emit(Math.min(24, 6 + r * 8), { p: { x: p.x, y: .2, z: p.z }, r: r * .5, v: r * 2.2, up: 2, life: .4, size: .16, c, c2: 'white', drag: 1.5, g: 4 });
  }
  // a chain hits each enemy once, each with the damage of the first (a support's less damage is in calc.js), and
  // reaches as far as calc.js shape says
  function chain(from, d, S, n, seen = new Set(), mult = 1) {
    const to = chest(d), R = sh(S).chainRange || SIM.chainRange;
    fx.bolt(from, to, S.el, .18); fx.flash(to, S.el, 12, .2, 6);
    seen.add(d); hit(d, S, { mult });
    if (n <= 0) return;
    later(.07, () => {
      // a lightning rod within reach takes the bolt and pulses over its whole area
      if (S.els.includes('lightning')) for (const o of objs) if (o.rod && !o.dead && !seen.has(o) && o !== S.self && dist(o.pos, d.pos) <= R) { seen.add(o); fx.bolt(to, V(o.pos.x, 1.7, o.pos.z), S.el, .18); o.pulse(S); break; }
      const e = near(d.pos, R, e => !seen.has(e));
      if (e) chain(to, e, S, n - 1, seen, mult);
    });
  }
  function ground(type, c, r, dur, S, grow) {   // grow: its area +per% a second, up to +max% (Creeping Chill)
    if (grounds.length >= 40) grounds[0].dead = true;
    const [col, tex, dark] = GFX[type];
    const decal = fx.decal(c, r, tex, col, { a: dark ? .85 : .5, dark, k: 1.2, pulse: dark ? 0 : 5, y: .031 + (grounds.length % 20) * .0005 });
    const g = { type, x: c.x, z: c.z, r, r0: r, age: 0, grow, s: (dur || GROUND_TIME[type] || SIM.groundTime) * (S ? sh(S).ground || 1 : 1), tick: .2, S, decal, dead: false }; grounds.push(g); return g;
  }
  function groundFx(g) {
    const p = { x: g.x, y: .05, z: g.z }, r = g.r * .9;
    if (g.type === 'burning') fx.emit(1, { p, r, v: .2, up: 2, life: .6, size: .4, c: 'fire', c2: 'ember' });
    else if (g.type === 'chilled') fx.emit(1, { p, r, v: .1, up: .5, life: 1, size: .22, c: 'ice', k: 1.2 });
    else if (g.type === 'shocked') fx.emit(2, { p, r, v: 1.5, life: .2, size: .14, c: 'lightning', c2: 'white', k: 3 });
    else if (g.type === 'gas') fx.emit(1, { p, r, h: .8, v: .3, up: .3, life: 1.6, size: 1.1, grow: 1.6, c: 0x5c7a22, smoke: true, a: .28 });
    else if (g.type === 'caustic') fx.emit(1, { p, r, v: .1, up: .7, life: .9, size: .2, c: 'poison' });
    else if (g.type === 'consecrated') fx.emit(1, { p, r, v: .1, up: .8, life: 1, size: .14, c: 'holy' });
  }
  // S with element e added, as the one it now deals most (got: the one it picked up)
  const astral = S => S.P.nova && S.g?.supports?.includes('Astral Projection');
  const withEl = (S, e) => ({ ...S, els: [...new Set([...S.els, e])], el: e, ail: [...new Set([...S.ail, ...ailOf([e])])], got: e });
  // its pct % of all its hit damage gained as element e (a Whirlwind's, a twister's from the ground or Whirlwind it took)
  const gainAs = (A, e, pct) => { const H = A.dmg.hits, all = Object.values(H).reduce((a, h) => [a[0] + h[0], a[1] + h[1]], [0, 0]), h = H[e] || [0, 0];
    return { ...withEl(A, e), dmg: { ...A.dmg, hits: { ...H, [e]: [h[0] + all[0] * pct / 100, h[1] + all[1] * pct / 100] } } }; };
  // A wind skill picks up the elemental ground it passes over.
  function absorb(S, at, r) {
    const g = grounds.find(g => !g.dead && GROUND_EL[g.type] && !S.els.includes(GROUND_EL[g.type]) && dist(g, at) <= r + g.r * .6);
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
      limit(o => o.plant && o.name === S.name, st.number_of_poisonbloom_arrow_bloom_allowed);   // Toxic Growth: up to its most pustules
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
      every: s => s.mana_remnants_spawn_remnant_on_crit_vs_elemental_ailment_enemy_every_X_ms, get: (s, k) => { me.mana = gain(me.mana, me.maxM, s.mana_remnants_gain_per_globe * k); } },
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
    for (let j = 0; j < n; j++) {
      const V = R.kinds ? R.kinds[Math.floor(rnd(R.kinds.length))] : R, c = j ? around(p, SIM.pickup) : { x: p.x, z: p.z }, m = new THREE.Mesh(ORB, new THREE.MeshBasicMaterial({ color: fx.color(V.c, 2.2), fog: false }));
      m.position.set(c.x, .5, c.z);
      thing(m, (s.base_remnant_duration_ms || SIM.lifetime * 1000) / 1000, { name: S.name, c,
        tick(dt, e) { m.position.y = .5 + Math.sin(e.s * 4) * .08; if (dist(pp, c) <= reach) { e.dead = true; collect(S, V, c); } } });
    }
  }
  function collect(S, R, c) {
    const s = rstats(S), k = 1 + (s['remnant_effect_+%'] || 0) / 100;
    fx.ring(c, .15, .8, R.c, .3); fx.emit(10, { p: { x: c.x, y: .5, z: c.z }, r: .2, v: 1.2, up: 1.5, life: .5, size: .14, c: R.c, c2: 'white' });
    if (s.remnants_affect_allies_in_presence_instead) return say(t('{0}: the Remnant affects your allies', S.label), R.c);   // the scene's minions have no life of their own
    later((s.remnant_delay_X_ms || 0) / 1000, () => { R.get(s, k, S); hudT = 0; fx.glow({ x: pp.x, y: 1.2, z: pp.z }, .9, R.c, .35); });
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
  const chanAt = {}, chanInf = {}, fus = {};   // fus: Ember Fusillade's Embers
  const INF_TIME = 20, INF_C = { fire: 'fire', cold: 'cold', lightning: 'lightning', verisium: 'gold' };   // note: keywords.json "for 20 seconds"
  const infNow = el => (me.inf[el] = (me.inf[el] || []).filter(x => x > time));
  function infRemnant(el, p, o = {}) {   // o: its pickup range +% (Siphon Elements), its duration (Runic Extraction's)
    const c = { x: p.x, z: p.z }, m = new THREE.Mesh(ORB, new THREE.MeshBasicMaterial({ color: fx.color(INF_C[el], 2.2), fog: false })), reach = SIM.pickup * (1 + (o.range || 0) / 100); m.position.set(c.x, .5, c.z);
    thing(m, o.dur || SIM.lifetime, { name: 'infusion', c, tick(dt, e) { m.position.y = .5 + Math.sin(e.s * 4) * .08; if (dist(pp, c) <= reach) { e.dead = true; infGain(el, c); } } });
  }
  // Siphon Elements, while on: a chance of a Remnant of that kind when you freeze (per Power of the enemy), ignite a
  // target not ignited or shock one not shocked
  const SIPHON = { freeze: ['cold', 'freezing'], ignite: ['fire', 'igniting'], shock: ['lightning', 'shocking'] };
  function siphon(a, d) {
    const g = tog['Siphon Elements'] && gemBy('Siphon Elements'), st = g && api.damage?.(g)?.stats, [el, v] = SIPHON[a] || []; if (!st || !el) return;
    if (Math.random() * 100 < (st[`infusion_remnants_%_chance_to_spawn_${el}_infusion_on_${v}_an_enemy`] || 0) * (a === 'freeze' ? POWER[d.stat.rarity] || 1 : 1))
      infRemnant(el, d.pos, { range: st['remnant_pickup_range_+%'] });
  }
  const bombed = (M, p) => { boom(p, M.R, M.S); if (M.S.P.leaves) infRemnant(M.S.P.leaves, p); };   // Living Bomb's seed
  function infGain(el, c) {
    const I = sheet().infusion, max = el === 'verisium' ? Math.max(...Object.values(I.max)) : I.max[el], q = infNow(el);
    const until = time + INF_TIME * I.time; q.push(until); if (Math.random() * 100 < I.more) q.push(until);
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
  // earthen objects (Earthshatter's spikes, Forge Hammer's hammer, Shield Wall's walls): up to the skill's limit, the oldest
  // goes; for its duration
  // up to a limit: the oldest of the objects f picks gives way
  const limit = (f, max) => { const mine = objs.filter(o => f(o) && !o.dead); while (max && mine.length >= max) mine.shift().dead = true; };
  const SPEAR = new THREE.CylinderGeometry(.03, .03, 1.3, 5), SPEAR_M = new THREE.MeshStandardMaterial({ color: 0x8a8070, metalness: .6, roughness: .5 });
  const EARTH = { spike: new THREE.ConeGeometry(.35, 1.6, 6), hammer: new THREE.BoxGeometry(.7, .5, .4) };
  function earth(S, c, max, spike) {
    limit(o => o.earth && o.name === S.name, max);
    const m = new THREE.Mesh(spike ? EARTH.spike : EARTH.hammer, new THREE.MeshStandardMaterial({ color: spike ? 0x6b5a48 : 0x3a3430, emissive: S.els.includes('fire') ? 0x5a1a04 : 0, roughness: .9, flatShading: true }));
    m.position.set(c.x, spike ? .8 : .35, c.z); m.rotation.set(spike ? 0 : .5, rnd(TAU), 0); m.castShadow = true;
    pop(c, .6, 'dust');
    const e = thing(m, S.P.dur || SIM.lifetime, { r: .4, name: S.name, earth: S, near: p => dist(p, c),
      // a warcry near it shatters it: the spike's explosion, or the hammer's Molten Fissures in a spiral (calc.js parts)
      shatter() {
        e.dead = true; pop(c, 1, 'dust'); const X = partOf(S, spike ? 'EarthshatterSpikePlayer' : 'ForgeHammerFissurePlayer'); if (!X) return;
        say(t('{0} shatters', S.label), X.el);
        if (spike) return boom(c, X.A, X);
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
  // lodges there as a Lightning Rod (up to its most). note: its homing is not simulated
  function shockchain(S, d) {
    const X = partOf(S, 'ShockchainArrowExplosionPlayer'); if (!X) return;
    const st = S.dmg.stats, lit = e => has(e, 'shock') || has(e, 'electrocute'), seen = new Set([d]), wave = e => { boom({ x: e.pos.x, z: e.pos.z }, X.A, X); clear(e, 'shock'); };
    let at = d, n = lit(d) ? st.shockchain_arrow_X_additional_chains_on_first_hitting_shocked_or_electrocuted_enemy : 0;
    if (n) wave(d);
    for (; n > 0; n--) {
      const e = near(at.pos, sh(S).chainRange || SIM.chainRange, e => !seen.has(e) && lit(e)); if (!e) break;
      seen.add(e); fx.bolt(chest(at), chest(e), 'lightning', .18); hit(e, S); wave(e); at = e;
    }
    limit(o => o.rod && o.name === S.name, st.number_of_lightning_rods_allowed); rod(S, { x: at.pos.x, z: at.pos.z });
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
  const radOf = (X, k = 'secondary') => (X.dmg.stats[`active_skill_base_${k}_area_of_effect_radius`] || 10) / 10;   // a part's other radius, m
  // a part of the skill with its own damage (calc.js parts), as a skill of the scene
  const partOf = (S, id) => { const D = S.dmg?.parts?.[id], els = Object.keys(D?.hits || {}), r = D?.stats.active_skill_base_area_of_effect_radius; return D && { ...S, dmg: { ...D, trig: [] }, A: r < 0 ? Math.max(.1, S.A + r / 10) : (r || 10) / 10, el: els.find(e => e !== 'physical') || els[0], els, ail: ailOf(els), mult: 1, gm: 1 }; };
  // Shield Wall: its wall of earth in segments (its secondary radius each), each with its life; enemies on their way to
  // you attack the one in front of them. Your Slams and warcries shatter them all; each explodes around itself, more
  // when slammed, less within its first 0.5 s when enemies break it
  function shieldWall(S, a, b, c, dur) {
    const st = S.dmg.stats, r = (st.active_skill_base_secondary_area_of_effect_radius || 10) / 10, len = dist(a, b), n = Math.max(1, Math.round(len / (2 * r))), g = holder(c), born = time;
    limit(o => o.earth && o.name === S.name, st.base_number_of_shield_walls_allowed);
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
    for (const o of objs) if (o.segs && !o.dead) for (const q of o.segs) if (q.life > 0 && dist(d.pos, q.p) < k && (o.decoy || segDist(q.p, d.pos, pp) < q.r + SIM.body)) { best = q; k = dist(d.pos, q.p); }
    return best; };
  // Lingering Illusion: while it is on, a roll leaves a copy of you where it began, for its duration, with its share of
  // your maximum life; enemies nearer to it than to you attack it, and one they destroy drops its Remnant (a power charge)
  function illusion(S, p) {
    const st = S.dmg.stats, f = makeMinion(fx, 'arcane'); f.group.position.set(p.x, 0, p.z);
    const q = { p, r: .3, life: Math.max(1, me.maxL * st['lingering_illusion_clone_base_maximum_life_%_of_owner_maximum_life'] / 100),
      hurt(n) { if (q.life > 0 && (q.life -= n) <= 0) { e.dead = true; pop(p, .6, 'arcane'); remnant(S, p); } } };
    const e = thing(f.group, durOf(S), { name: S.name, decoy: true, segs: [q] });
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
  function lob(mesh, from, to, dur, h, land, o = {}) {
    mesh.position.copy(from); scene.add(mesh); let k = 0;
    const e = { pos: mesh.position, dead: false,
      update(dt) {
        k = Math.min(1, k + dt / dur);
        mesh.position.set(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k + Math.sin(k * Math.PI) * h, from.z + (to.z - from.z) * k);
        if (o.spin) mesh.rotation.x += dt * 9;
        if (o.trail) fx.emit(o.big ? 4 : 1, { p: mesh.position, v: .5, life: o.big ? .6 : .3, size: o.big ? .6 : .16, c: o.trail, c2: 'white', drag: 1 });
        if (k >= 1) { e.dead = true; land(); }
      },
      remove() { fx.drop(mesh); } };
    objs.push(e); return e;
  }
  // A Hazard a support leaves: it arms after arm s, then hits the first enemy to step in its area and is gone, for dur s;
  // o.early: its damage +% final if set off within its first 0.5 s (Brambleslam's, "when not killed by self")
  // o.reach: how near an enemy sets it off (else its area); o.delay: it goes off that long after (Conductive Runes);
  // o.more(t): its damage multiplier t s after arming (Ice Shards); o.mesh: what stands there; o.then(p): after it goes off
  function hazardAt(X, p, dur, o = {}) {
    const arm = o.arm || 0, c = o.c || 'dust', reach = o.reach || X.A, g = holder(p);
    const decal = fx.decal(p, reach, 'patch', c, { a: .8, k: 1 }); if (o.mesh) g.add(o.mesh);
    const e = thing(g, dur, { name: X.name, hazard: true,
      tick() {
        if (e.set || e.s < arm || !dummies.some(d => !d.dead && dist(d.pos, p) <= reach + SIM.body)) return;
        const S2 = { ...X, mult: X.mult * (e.s < .5 && o.early ? 1 + o.early / 100 : 1) * (o.more?.(e.s - arm) ?? 1) }; e.set = true;
        later(o.delay || 0, () => { e.dead = true; area(p, X.A, S2); o.then?.(p); fx.emit(10, { p: { x: p.x, y: .2, z: p.z }, r: X.A, v: 1.5, up: 1, life: .3, size: .1, c, c2: 'white' }); });
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
    hudT = 0;
  }
  const chargesSpent = n => { const U = sheet().surge?.charge || {}; for (const el in U) surgeGain(SURGE_OF[el], el, U[el] * n); };
  const gemini = () => { const U = sheet().surge?.reload, el = (me.gem = !me.gem) ? 'cold' : 'fire'; if (U) surgeGain('Gemini Surge', el, U[el]); };
  function surgeTake() {
    const took = [], G = granted('Gemini Surge')?.stats.surge_can_apply_to_X_number_of_projectiles_per_skill_use;
    surges = surges.filter(s => s.until > time && (took.some(o => o.name === s.name && o.el === s.el) || !took.push({ ...s, n: s.name === 'Gemini Surge' ? G : Infinity })));
    return took;
  }
  function surgeBlast(S, s, p) {
    const D = granted(s.name, S.g?.level); if (!D) return;
    const B = asTrig(S, { ...D, id: s.name }), id = Object.keys(D.parts || {}).find(k => k.toLowerCase().includes(s.el)), X = id ? { ...partOf(B, id), A: B.A } : B;
    fx.ring(p, .2, X.A, s.el, .3); boom(p, X.A, X);
  }
  // Elemental Expression (the Invoker's): a melee critical hit triggers it, within its cooldown: a fiery explosion at the
  // enemy, a bolt of lightning chaining from it or a wave of icy projectiles toward it, each as likely as your Strength,
  // Dexterity and Intelligence (the wave's spread: a look only). note: the level of the triggered skill is not in the data: the attack's own
  function expression(d, S) {
    const D = sheet().expression && granted('Elemental Expression', S.g?.level);
    if (!D || !spend({ id: 'Elemental Expression', cooldown: D.cooldown, uses: D.uses })) return;
    const a = sheet().attrs || {}, r = Math.random() * ((a.str || 0) + (a.dex || 0) + (a.int || 0)), el = r < a.str ? 'Fire' : r < a.str + a.dex ? 'Lightning' : 'Cold';
    const X = partOf(asTrig(S, { ...D, id: 'Elemental Expression' }), `ElementalExpression${el}Player`); if (!X) return;
    if (el === 'Fire') boom(d.pos, X.A, X);
    else if (el === 'Lightning') chain(V(pp.x, 1.2, pp.z), d, X, X.dmg.stats.number_of_chains);
    else { const a0 = Math.atan2(d.pos.x - pp.x, d.pos.z - pp.z), n = X.dmg.stats.base_number_of_projectiles; for (let k = 0; k < n; k++) { const q = a0 + (k - (n - 1) / 2) * .25; shoot(X, pp, Math.sin(q), Math.cos(q)); } }
  }
  // Doedre's Undoing: the curse's area stays for the curse's duration (up to its most areas), cursing the enemies that
  // enter it, and spawns Witchtoads in it at its interval (up to its most at once); a toad leaps at an enemy and explodes
  // there (Dark Consequences: its part, at the curse's level). note: how close an enemy must be for a toad to leap and how
  // long the leap takes are not in the data: in the area, half a second
  function doedre(S, c, R, curseOn) {
    const su = S.dmg.sum, D = granted("Doedre's Undoing", S.g?.level, 'ChaosFrogExplosionPlayer'); if (!D) return;
    const X = asTrig(S, { ...D, id: "Doedre's Undoing" }), toads = [], dec = fx.decal(c, R, 'rune', 'curse', { a: .45, spin: .4 }); let tk = 0;
    X.A = (D.stats.active_skill_base_area_of_effect_radius || 10) / 10;
    limit(o => o.doedre, su.maximum_curse_zones_allowed);
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
    const st = X.dmg.stats, n = st.base_number_of_projectiles, cone = st.ballistic_ice_chunk_cone_angle / 10 * Math.PI / 180;
    for (let k = 0; k < n; k++) {
      const a = a0 + (n > 1 ? k / (n - 1) - .5 : 0) * cone, r = rnd(st.ice_fragment_min_chunk_distance, st.ice_fragment_max_chunk_distance) / 10, to = { x: p.x + Math.sin(a) * r, z: p.z + Math.cos(a) * r };
      lob(fx.orb('cold', .1), new THREE.Vector3(p.x, .8, p.z), new THREE.Vector3(to.x, .1, to.z), .3, .6, () =>
        frag(to, X.A, Math.max(0, st.base_skill_detonation_time / 1000 - .3), q => boom(q, X.A, X, { noPay: true })));
    }
  }
  function shoot(S, from, dx, dz, o = {}) {
    const G = S.G, P = S.P, speed = o.speed || G.speed || SIM.projSpeed, slow = !o.speed && (speed < 5.5 || P.spiral || P.wind);
    const cr = Math.max(.15, G.collision || 0), m = P.attack && !P.wind ? fx.arrow(S.el) : fx.orb(S.el, slow ? .26 : .14);
    let left = o.range || (G.speed ? G.range : SIM.projRange), pulse = .2, cur = S, a0 = Math.atan2(dx, dz), trail = 0, spd = speed, burn = 0;
    // Ball Lightning: its hits on the enemies around it at its frequency; with a Fire Infusion consumed it slows down over
    // time, leaves Ignited Ground at its interval and explodes where it ends (its infused parts)
    const bst = S.dmg?.stats || {}, every = bst.ball_lightning_base_hit_frequency_ms / 1000, fi = S.infs?.includes('fire') && bst.ball_lightning_infused_acceleration != null;
    const BG = fi && partOf(S, 'BallLightningIgnitedGround'), BX = fi && partOf(S, 'BallLightningInfusedExplosionPlayer');
    const FR = S.dmg?.parts?.FragmentationRoundsFreezeShatterPlayer;   // Fragmentation Rounds: its bolts burst the Ice Crystals they reach
    m.position.set(from.x, 1.1, from.z); m.rotation.y = a0; scene.add(m);
    // Pierce, then Fork, then Chain (calc.js shape): a fractional pierce is a chance, rolled per projectile. The forks
    // part at an angle the data does not give (a look only); they keep the targets already hit and the less damage
    const D = sh(S), seen = new Set(o.seen), forked = o.forked || 0, surged = o.split || forked ? [] : (S.surges || []).filter(s => s.n-- > 0);
    const pierceN = Math.floor(D.pierce || 0) + (Math.random() < (D.pierce || 0) % 1 ? 1 : 0);
    let pierced = o.pierced || 0;
    const mult = () => (pierced ? (1 + (D.pierceMore || 0) / 100) * Math.max(0, 1 + (D.perPierce || 0) * pierced / 100) : 1) * (forked ? 1 + (D.forkMore || 0) / 100 : 1);
    const end = hitD => {
      q.dead = true; const p = { x: m.position.x, z: m.position.z }; for (const s of surged) surgeBlast(cur, s, p);
      if ((P.chains || S.addChains) && hitD) {
        chain(m.position.clone(), hitD, cur, (D.chains || 0) + (S.addChains || 0), seen, mult());
        // Lightning Arrow: bolts from the one hit to the nearest others in its area ("up to 2 extra targets")
        const by = chest(hitD);
        for (const e of nearest(hitD.pos, D.extraTargets || 0, e => !seen.has(e) && dist(e.pos, hitD.pos) <= S.A)) {
          seen.add(e); fx.bolt(by, chest(e), cur.el, .18); hit(e, cur, { mult: mult() });
        }
      }
      else if (cur.perfect && cur.dmg?.parts?.SnipeExplosionPlayer) snipeBlast(cur, hitD, p, mult());
      else if (P.explodes || S.aoe) {
        boom(p, S.A, cur);
        const X = cur.infs?.includes('fire') && infPart(cur, 'fire'), n = X && sh(X).projectiles;   // Fireball: a ring of smaller firebolts
        if (n) for (let k = 0; k < n; k++) shoot({ ...X, aoe: false, P: { ...X.P, explodes: false }, infs: [] }, p, Math.sin(k * TAU / n), Math.cos(k * TAU / n), { range: Math.max(1, (X.G.range || SIM.projRange) + (X.dmg.stats.projectile_maximum_range_override || 0) / 10) });
      }
      else if (hitD) { hit(hitD, cur, { mult: mult() }); touch(p, .5, cur); fx.flash(m.position, cur.el, 8, .15, 4); darts(cur, hitD); spearBurst(cur, hitD); }
      else fx.emit(6, { p: m.position, v: 1.5, life: .3, size: .14, c: cur.el });
    };
    const q = { pos: m.position, r: cr, dead: false, proj: true, name: S.name,
      update(dt) {
        if (P.wander) { a0 += rnd(-1, 1) * 9 * dt; dx = Math.sin(a0); dz = Math.cos(a0); m.rotation.y = a0; }
        if (fi) spd = Math.max(.3, spd * (1 + bst.ball_lightning_infused_acceleration / 100 * dt));
        let stepLeft = Math.min(left, spd * dt); left -= stepLeft; trail += stepLeft;
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
          for (const d of dummies) if (!d.dead && !seen.has(d) && dist(d.pos, m.position) <= cr + SIM.body) {
            seen.add(d); shrapnel(cur, d); if (cur.icetip) iceFrags(cur.icetip, { x: d.pos.x, z: d.pos.z }, a0);
            // Split: its first hit splits it toward that many other enemies around; the split ones split no more
            const N = !o.split && (D.split || 0) + (empowered(S)?.dmg.stats.mana_tempest_empowered_spells_split_to_X_additional_targets || 0);   // Mana Tempest
            if (N) {
              o.split = true;
              for (const e of nearest(d.pos, N, e => e !== d && dist(e.pos, d.pos) <= left)) { const l = dist(e.pos, m.position) || 1; shoot(cur, m.position, (e.pos.x - m.position.x) / l, (e.pos.z - m.position.z) / l, { speed, range: left, seen: [d], split: true }); }
            }
            if (slow) hit(d, cur);
            else if (pierced < pierceN) { hit(d, cur, { mult: mult() }); pierced++; fx.flash(m.position, cur.el, 6, .12, 3); }
            else if (forked < (D.forks || 0)) {
              hit(d, cur, { mult: mult() }); q.dead = true; fx.flash(m.position, cur.el, 8, .15, 4);
              for (const s of [-1, 1]) { const a = a0 + s * .5; shoot(cur, m.position, Math.sin(a), Math.cos(a), { speed, range: left, seen, pierced, forked: forked + 1 }); }
              break;
            }
            else { end(d); break; }
          }
        }
        if (q.dead) return;
        fx.emit(slow ? 2 : 1, { p: m.position, v: .4, life: .35, size: slow ? .3 : .16, c: cur.el, c2: 'white', drag: 1 });
        if (slow) {
          if (P.absorbs && !S.dmg?.parts?.WhirlwindLanceStormPlayer) { const n = absorb(cur, m.position, Math.max(S.R, .6)); if (n !== cur) { cur = n; tint(m, cur.el); } }
          if (P.ground && trail > 1.4) { trail = 0; ground(P.ground, m.position, .8, 4, cur); }
          if (S.R && (pulse -= dt) <= 0) { pulse = every || .35; fx.ring(m.position, .2, S.R, cur.el, .3, { a: .6 }); area(m.position, S.R, cur, { mult: every ? 1 : .5 }); }
          if (BG && (burn -= dt) <= 0) { burn = bst.ball_lightning_infused_burning_ground_interval_ms / 1000; ground('burning', m.position, radOf(BG, 'tertiary'), BG.dmg.shape?.duration || 4, BG); }
        }
        if (left <= 0) { end(null); caltrops(S, m.position); if (BX) boom({ x: m.position.x, z: m.position.z }, radOf(BX), BX); }
      },
      remove() { fx.drop(m); } };
    objs.push(q); return q;
  }
  function minion(S, p, life, o = {}) {
    // a minion with the damage of its own (calc.js minionOf) attacks at its speed; else the scene's half hit every 1.1 / 1.5 s.
    // o.attacks: it is gone after that many; o.chains: its hit chains to that many more enemies. With its life (calc.js
    // minionLife) enemies nearer to it than to you attack it (a decoy, as Lingering Illusion), and it dies at none left.
    // note: what its defences take off their hits is not counted (the scene's minions have no armour or resistances)
    const f = makeMinion(fx, S.el), real = !!S.dmg?.minion && Object.keys(S.dmg.hits).length > 0, MS = real ? { ...S, src: 'minionHit' } : { ...S, src: 'minion', mult: .5 * S.mult }, ranged = S.P.ranged;
    f.group.position.set(p.x, 0, p.z); scene.add(f.group);
    fx.ring(p, .2, 1, S.el, .4); fx.emit(14, { p: { x: p.x, y: .2, z: p.z }, r: .4, v: .6, up: 2.5, life: .6, size: .2, c: S.el });
    let wait = rnd(.3, 1), sw = 0;
    const e = { pos: f.group.position, r: .3, dead: false, keep: life === Infinity, s: 0, minion: true, kind: o.kind,
      update(dt) {
        e.s += dt; wait -= dt; sw = Math.max(0, sw - dt * 4); f.arm.rotation.x = -1 - Math.sin(sw * Math.PI) * 1.2;
        if (e.s >= life) { e.dead = true; return; }
        const d = near(e.pos, ranged ? 12 : 9), goal = d ? d.pos : pp, k = dist(goal, e.pos), stop = d ? (ranged ? 7 : 1.1) : 2.4;
        if (k > .05) f.group.rotation.y = Math.atan2(goal.x - e.pos.x, goal.z - e.pos.z);
        if (k > stop) { const v = Math.min(k - stop, 5.5 * (o.speed || 1) * dt); e.pos.x += (goal.x - e.pos.x) / k * v; e.pos.z += (goal.z - e.pos.z) / k * v; e.pos.y = Math.abs(Math.sin(e.s * 9)) * .05; }
        else if (d && wait <= 0) {
          const PO = painOn(e), MX = PO ? { ...MS, mult: MS.mult * (1 + PO['pain_offering_damage_+%'] / 100) } : MS;
          wait = (real && S.dmg.speed ? 1 / S.dmg.speed : ranged ? 1.5 : 1.1) / (1 + (PO?.['pain_offering_attack_and_cast_speed_+%'] || 0) / 100); sw = 1;
          if (ranged) shoot(MX, e.pos, (d.pos.x - e.pos.x) / k, (d.pos.z - e.pos.z) / k, { speed: 14, range: 13 });
          else if (o.chains) chain(V(e.pos.x, 1, e.pos.z), d, MX, o.chains);
          else { fx.sector(e.pos, d.pos.x - e.pos.x, d.pos.z - e.pos.z, 1.3, .8, S.el, .16, { a: .7 }); hit(d, o.more ? { ...MX, mult: MX.mult * o.more(d) } : MX); }
          if (o.attacks && --o.attacks <= 0) e.dead = true;
        }
      },
      remove() {
        fx.emit(16, { p: { x: e.pos.x, y: .8, z: e.pos.z }, r: .3, v: 1.5, up: 1, life: .6, size: .14, c: 0xd8d0b8, g: 8, k: 1 }); f.dispose();
        if (!e.keep || e.slain) event('miniondeath', e.pos, MS);
        if (e.keep && e.slain) fallen(S, e);
      } };
    const L = S.dmg?.minionLife;
    if (L > 0) Object.assign(e, { decoy: true, loyal: S.dmg?.sum?.['companion_takes_%_damage_before_you_from_support'], segs: [{ p: e.pos, r: .3, life: L, max: L, hurt(n) {
      // Bone Offering: while its spike stands its shield takes its less damage from hits; a hit above its % of the minion's
      // maximum life is absorbed whole and the shield explodes (after that, its quality's less damage). note: the
      // explosion's damage is not in its data
      const B = objs.find(o => o.bone && !o.dead);
      if (B) { if (e.shot !== B && n > L * B.bone['bone_offering_hit_threshold_%_of_maximum_life'] / 100) { e.shot = B; fx.ring(e.pos, .2, 1.2, 'dust', .35); fx.emit(12, { p: { x: e.pos.x, y: .8, z: e.pos.z }, r: .3, v: 2, life: .4, size: .12, c: 0xd8d0b8 }); return; }
        n *= 1 + (e.shot === B ? B.bone['bone_offering_damage_taken_+%_final_after_shield_loss'] || 0 : B.bone['bone_offering_damage_taken_+%_final']) / 100; }
      n *= o.taken || 1;   // an Empowered Zombie's less damage taken
      fx.emit(4, { p: { x: e.pos.x, y: .8, z: e.pos.z }, r: .2, v: 1, life: .3, size: .1, c: 0xc03030 }); if (this.life > 0 && (this.life -= n) <= 0) e.dead = e.slain = true; } }] });
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
  function briarStore(n) { const st = onS('Briarpatch')?.dmg.stats; if (st) me.briar = Math.min(st.briarpatch_maximum_stored_physical_damage, (me.briar || 0) + n * st.briarpatch_stores_permyriad_of_physical_damage_dealt / 1e4); }
  function briar(by) {
    const S = onS('Briarpatch'), st = S?.dmg.stats, n = me.briar || 0; if (!st || !n || time < me.briarAt) return;
    me.briar = 0; me.briarAt = time + st.briarpatch_ground_creation_delay_ms / 1000; limit(o => o.briar, st.base_briarpatch_ground_limit);
    const c = { ...by.at }, X = { ...S, el: 'physical', els: ['physical'], dmg: { ...S.dmg, hits: { physical: [n, n] } } }, dec = fx.decal(c, S.A, 'patch', 'dust', { a: .45, k: 1 });
    let tk = 0; say(S.label, 'dust');
    thing(holder(c), durOf(S), { briar: 1, off: () => dec.remove(), tick(dt) {
      if ((tk -= dt) > 0) return; tk = .5;
      for (const d of inside(c, S.A)) { const moved = d.bp && dist(d.bp, d.pos) > .05; d.bp = { x: d.pos.x, z: d.pos.z }; if (moved) hit(d, X); }
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
    const e = thing(g, S.P.dur || SIM.lifetime, { r: .3, rod: true, name: S.name,
      pulse(by) {
        if (time - last < .5 || by.src === 'rod') return; last = time;
        say(t('{0} pulses: struck by {1}', S.label, by.label), S.el);
        fx.bolt(V(c.x, 11, c.z), V(c.x, 1.8, c.z), S.el, .2, .06, .4); fx.ring(c, .3, R, S.el, .4, { k: 2.8 }); fx.flash(c, S.el, 30, .3, 9);
        fx.emit(30, { p: { x: c.x, y: .4, z: c.z }, v: R * 3, flat: true, life: .3, size: .16, c: S.el, c2: 'white', drag: 2, k: 3 });
        area(c, R, { ...S, self: e, src: 'rod' });
      },
      touch(by) { if (by.els.includes('lightning') && by.name !== S.name) e.pulse(by); },
      off: () => range.remove() });
    pop(c, 1, S.el); area(c, 1, { ...S, self: e }, { noTouch: true });
  }
  const ICE = new THREE.ConeGeometry(.32, 1.5, 5);
  // life: a crystal with its own (Midnight Zenith's) takes the average of each hit's damage and bursts at none left
  // (note: what its defences take off is not in the data); else any hit bursts it
  const avgHit = by => Object.values(by.dmg?.hits || {}).reduce((t, [a, b]) => t + (a + b) / 2, 0) * (by.mult ?? 1);
  // an Ice Crystal's life: its skill's (Frost Wall, Grim Pillars, Frozen Locus), increased and more (Icicle, Glacier)
  const crystalLife = S => (S.dmg?.stats?.frost_wall_maximum_life || 0) * (1 + (S.dmg?.sum?.['ice_crystal_maximum_life_+%'] || 0) / 100)
    * Object.entries(S.dmg?.finals || {}).reduce((m, [k, x]) => k.endsWith('ice_crystal_maximum_life_+%_final') ? m * (1 + x / 100) : m, 1);
  function crystal(S, p, dur, B = S, life = crystalLife(S)) {   // B: the skill its burst is (Grim Pillars' explosion part)
    const m = new THREE.Mesh(ICE, new THREE.MeshStandardMaterial({ color: 0xbfe8ff, emissive: 0x2a6f9f, roughness: .1, transparent: true, opacity: .85, flatShading: true }));
    m.position.set(p.x, .75, p.z); m.rotation.set(rnd(-.15, .15), rnd(TAU), rnd(-.15, .15)); m.scale.setScalar(.01); m.castShadow = true;
    fx.emit(8, { p: { x: p.x, y: .2, z: p.z }, r: .3, v: 1, up: 2, life: .5, size: .16, c: 'ice' });
    const h = rnd(.8, 1.2);
    const e = thing(m, dur, { r: .4, name: S.name, ice: true,
      tick(dt, e) { const s = ease(Math.min(1, e.s * 5)); m.scale.set(s, s * h, s); },
      touch(by) {   // hit by anything: it bursts, and the burst reaches the next crystals
        if (life > 0 && (life -= avgHit(by)) > 0) return;
        e.dead = true;
        later(rnd(.04, .14), () => { if (by.src !== 'crystal') say(t('{0}: the ice crystals explode ({1})', S.label, by.label), 'ice'); boom(p, B.A, { ...B, self: e, src: 'crystal' });
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
  function vortex(S, c, R, dur, o = {}) {   // Tornado: drifts towards the enemies and takes the element of the ground it crosses
    const g = holder(c), ts = S.dmg?.stats || {}, pull = ts['tornado_pull_strength_%'], DOT = Object.keys(S.dmg?.dot || {}).length > 0; let cur = S, tk = .2, pt = 0;
    limit(x => x.vortex && x.name === S.name, ts.number_of_tornados_allowed ?? ts.base_number_of_tornado_shots_allowed);
    // Tornado Shot's: it stays where it lands and Hinders the enemies standing in it; your arrows, spears and bolts that reach
    // it are sucked in and it spits a ring of copies (its number, range and less damage) that are not copied again, up to
    // its most times
    const cs = o.copy, hold = new Map();
    const e = thing(g, dur, { name: S.name, vortex: true, R, copy: cs && { left: cs.tornado_shot_number_of_hits_allowed },
      spit(C, k) {
        const n = cs.base_number_of_projectiles, a0 = rnd(TAU), p = { x: g.position.x, z: g.position.z };
        if (--e.copy.left <= 0) e.dur = e.s;
        for (let i = 0; i < n; i++) { const a = a0 + i * TAU / n; shoot({ ...C, copied: true, mult: C.mult * k * (1 + cs['tornado_shot_projectile_damage_+%_final'] / 100) }, p, Math.sin(a), Math.cos(a), { range: cs.tornado_shot_projectile_range / 10 }); }
      },
      tick(dt, e) {
        const p = g.position, col = cur.el === 'physical' ? 'dust' : cur.el;
        for (let i = 0; i < 3; i++) {
          const a = e.s * 9 + i * 2.1 + rnd(.6), h = rnd(3.4), rr = .2 + h * .28 * (R / 3 + .3);
          fx.emit(1, { p: { x: p.x + Math.cos(a) * rr, y: h, z: p.z + Math.sin(a) * rr }, dir: V(-Math.sin(a) * 3.5, 1.2, Math.cos(a) * 3.5), life: .45, size: .34, c: col, c2: 'white', k: cur.el === 'physical' ? 1.1 : 2.2 });
        }
        if (cs) standSlow(hold, p, R, -HINDER.slow, .3);
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
        if ((tk -= dt) <= 0) { tk = DOT ? .4 : o.every || .4; fx.ring(p, R * .3, R, col, .35, { a: .45 }); if (!DOT) area(p, R, { ...cur, self: e }, { mult: o.mult ?? .4 }); }
      } });
  }
  // Landing a jump: Xibaqua's Rending sets off the corpses within its secondary radius (up to its most) after its delay, each
  // for that share of its life as fire in its area; Crater opens its fissures, a hit of its own each (their length and
  // spread the slam's: the data gives none) that last its duration
  function landed(S, c) {
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
    const dx = Math.sin(ang), dz = Math.cos(ang), b = { x: from.x + dx * len, z: from.z + dz * len }, seen = new Set();   // each enemy once
    const decal = fx.strip(from, b, .9, 0x070605, o.dur || 4, { dark: true, tex: 'beam', a: .9, y: .033 });
    if (o.dur) {
      const mine = fissures.filter(f => f.S.name === S.name);
      if (mine.length >= o.max) { const old = mine[0]; old.decal.t = old.decal.dur; fissures.splice(fissures.indexOf(old), 1); }
      fissures.push({ a: { x: from.x, z: from.z }, b, S, r, mult, decal, end: time + o.dur, next: 0 });
    }
    for (let k = 1; k <= len; k++) later(k * .06, () => {
      const p = { x: from.x + dx * k, z: from.z + dz * k };
      pop(p, r, S.el); fx.pillar(p, .25, 1.6, S.el, .25, 2.4); for (const d of dummies) if (!d.dead && !seen.has(d) && dist(d.pos, p) <= r + SIM.body) { seen.add(d); hit(d, S, { mult, noPay: true }); }
    });
    // Branching Fissures: its number of secondary fissures off this one, with its less area and damage
    // note: where they branch, their angle and length are not in its data: evenly along it, alternating sides at 45°, half its length
    const BF = !o.branch && S.dmg?.sum, n = BF?.number_of_branching_fissures || 0;
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
  function slash(S, dx, dz, r = 2, half = .95) {
    fx.sector(pp, dx, dz, r, half, S.el, .2, { k: 2.6, a: .85, grow: true });
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
      const n = (sh(S).projectiles || S.P.count || 1) + S.spent * 2 + (S.addProj || 0), a0 = Math.atan2(S.dx, S.dz), spread = S.circle ? TAU / n : S.P.wander ? .45 : .13, h = hand();
      for (let i = 0; i < n; i++) { const a = a0 + (i - (n - 1) / 2) * spread; shoot(S, S.from, Math.sin(a), Math.cos(a)); }
      fx.glow(h, .9, S.el, .2);
    },
    chain(S) {
      const d = near(S.at, SIM.snap) || near(S.at, 6, e => dist(e.pos, S.from) <= SIM.castRange), h = hand(), n = (sh(S).chains || 0) + (S.addChains || 0);   // Arc's chains from a Lightning Infusion
      // Exsanguinate: its tendrils, each on another of the enemies nearest your aim. note: its cone's angle is not in the data
      const B = d && S.dmg?.stats?.blood_tendrils_beam_count;
      if (B) nearest(S.at, B, e => dist(e.pos, S.from) <= SIM.castRange).forEach(e => chain(h, e, S, n));
      else if (d) { chain(h, d, S, n); shockchain(S, d); }
      else { fx.bolt(h, V(S.at.x, .1, S.at.z), S.el, .18); pop(S.at, .6, S.el); touch(S.at, .6, S); }
    },
    rain(S) {
      const P = S.P, c = S.at, R = S.A, h = hand();
      const shot = land => lob(P.attack ? fx.arrow(S.el) : fx.orb(S.el, .13), h, V(c.x, .1, c.z), .42, 3.2, land, { trail: S.el });
      // Tornado Shot: its shot's hit (PoB2's main part) and its tornado (its own part) where it lands
      // note: its secondary radius taken as the tornado's
      const TX = partOf(S, 'Tornado');
      if (TX) return shot(() => { boom(c, R, S); vortex(TX, c, radOf(TX), durOf(TX), { copy: TX.dmg.stats }); });
      if (P.object) return shot(() => rod(S, c));
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
              touch(by) { if (by.P.detonator || by.els.includes('fire')) e.s = e.dur; },
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
          fx.streak(V(q.x + 1.5, 12, q.z - 1), V(q.x, 0, q.z), S.el, .13, .025, 1.6);
          later(.13, () => { fx.ring(q, .1, ar, S.el, .25, { a: .7 }); fx.emit(4, { p: { x: q.x, y: .1, z: q.z }, v: 1.5, up: 1.5, life: .3, size: .12, c: S.el, c2: 'white' }); area(q, ar, S, { mult: RA ? 1 : .5, noTouch: i % 4 > 0 }); });
        });
        return;
      }
      shot(() => {
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
      const P = S.P, c = S.at;
      lob(fx.orb(S.el, .11), S.origin ? V(S.origin.x, 1.5, S.origin.z) : hand(), V(c.x, .15, c.z), .55, 2.6, () => {
        if (P.ground === 'oil' || P.ground === 'gas') {   // bursts where it lands and leaves its ground: no fuse
          fx.explode(c, S.A, S.el, { soft: true });
          for (const d of inside(c, S.A)) { if (P.ground === 'oil') expo(d, ELEM, expoMag(S)); else inflict(d, 'poison', S); d.wob = .6; }
          ground(P.ground, c, S.A, P.dur, S);
          return;
        }
        const m = fx.orb(S.el, .12); m.position.set(c.x, .15, c.z);
        const blow = e => {
          const X = { ...S, self: e }; boom(c, S.A, X);
          for (let i = 0; i < (P.cluster || 0); i++) later(.22 + i * .08, () => { const a = rnd(TAU), r = rnd(.4, .9) * S.A; boom({ x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r }, S.A * .45, X, { soft: true, mult: .5, noPay: true }); });
        };
        thing(m, sh(S).detonate || (/Flash/.test(S.name) ? .7 : SIM.fuse), { r: .25, name: S.name,
          tick(dt, e) { m.userData.glow.scale.setScalar(.7 + Math.sin(e.s * (6 + e.s * 9)) ** 2 * 1.3); },
          touch(by) { if (by.P.detonator && !this.dead) { this.dead = true; say(t('{0} detonates {1}', by.label, S.label), 'fire'); later(.06, () => blow(this)); } },
          end: blow });
      }, { spin: true, trail: S.el });
    },
    orb(S) {
      const P = S.P, c = S.at, R = S.A, dur = P.detonates ? sh(S).detonate || SIM.orbFuse : P.dur || SIM.lifetime;
      // one at a time (Frost Bomb: its limit); Frost Bomb's exposure grows each pulse (its compounding magnitude) up to its cap
      const st = S.dmg?.stats || {}, cmp = st.active_skill_all_elemental_exposure_compounding_magnitude, eff = S.dmg?.ail?.expo.effect ?? 1;
      limit(o => o.orbOf === S.name, st.base_maximum_number_of_frost_bombs || st.orb_of_storms_base_maximum_number_of_orbs || st.solar_orb_base_maximum_number_of_orbs || 1);   // Frost Bomb, Orb of Storms, Solar Orb: their most
      const m = fx.orb(S.el, .3), range = fx.decal(c, R, 'outline', S.el, { a: .35, rot: 0 }); m.position.set(c.x, 1.3, c.z);
      fx.ring(c, .2, 1.4, S.el, .4);
      let tk = .4;
      const e = thing(m, dur, { r: R, orbOf: S.name, name: S.name, bolts: 0,
        tick(dt, e) {
          m.position.y = 1.3 + Math.sin(e.s * 3) * .08; if (P.detonates) m.userData.core.scale.setScalar(.3 * (1 + e.s / dur * .7));
          if ((tk -= dt) > 0) return;
          if (P.detonates) { tk = .6; fx.ring(c, .3, R, S.el, .5, { a: .55 }); for (const d of inside(c, R)) { expo(d, ELEM, cmp && d.st.expo > 0 && d.expo ? Math.min(st.active_skill_all_elemental_exposure_compounding_magnitude_cap * eff, d.expo.mag + cmp * eff) : expoMag(S)); inflict(d, 'chill', S); } }   // pulses of exposure, then the blast
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
        const X = T && charges.power >= need && (charges.power -= need, chargesSpent(need), asTrig(S, T));
        if (X) say(X.label, X.el);
        for (let i = 0; i < 6; i++) { const k = i / 5, p = { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k }; later(i * .04, () => { crystal(S, p, dur); if (X) ground('chilled', p, X.A, 0, X, { per: X.dmg.stats['active_skill_ground_effect_area_of_effect_+%_final_per_second'], max: X.dmg.stats['active_skill_ground_effect_area_of_effect_+%_final_per_second_max'] }); }); }
        for (const d of dummies) if (!d.dead && segDist(d.pos, a, b) <= .7 + SIM.body) hit(d, S);
        return;
      }
      const fire = S.els.includes('fire'); let tk = 0;
      if (P.earthen) { fx.strip(a, b, 1.2, S.el, dur, { a: .6 }); return shieldWall(S, a, b, c, dur); }
      // its own limit (Flame Wall's 3); a wall with damage over time burns those in it (its damage per second), else hits
      limit(o => o.wall && o.name === S.name, S.dmg?.stats?.number_of_allowed_firewalls);
      // Voltaic Barrier: its own limit, its hits every its interval (not the scene's lesser ones), and it energises the
      // projectiles fired through it (discharge)
      const VS = S.dmg?.stats?.voltaic_barrier_damage_interval_ms, volt = VS && partOf(S, 'VoltaicBarrierTriggeredChainLightningPlayer');
      if (VS) limit(o => o.wall && o.name === S.name, S.dmg.stats.voltaic_barrier_active_actions_limit);
      const strip = fx.strip(a, b, 1.2, S.el, dur, { a: .6 }), burns = Object.keys(S.dmg?.dot || {}).length > 0;
      thing(holder(c), dur, { wall: true, fire, volt, a, b, name: S.name, label: S.label, S,
        tick(dt, e) {
          for (let i = Math.ceil(dt * 100); i > 0; i--) { const k = rnd(); fx.emit(1, { p: { x: a.x + (b.x - a.x) * k, y: .05, z: a.z + (b.z - a.z) * k }, v: .3, up: fire ? 3.4 : 2.2, life: .6, size: .5, c: S.el, c2: fire ? 'ember' : 'white', drag: .5 }); }
          if ((tk -= dt) > 0) return; tk = burns ? .2 : VS ? VS / 1000 : .5;
          for (const d of dummies) if (!d.dead && segDist(d.pos, a, b) <= .7 + SIM.body) burns ? dot(d, { ...S, P: { ...S.P, dur: .3 } }) : hit(d, { ...S, self: e }, { mult: VS ? 1 : .3, noPay: true });
        }, off: () => { strip.dur = Math.min(strip.dur, strip.t); } });   // a wall over the limit goes
    },
    curse(S) {
      const c = S.at, R = S.A;
      const wait = sh(S).curseDelay || SIM.curseDelay;
      fx.telegraph(c, R, 'curse', wait);
      later(wait, () => {
        fx.disc(c, R, 'curse', .7, { tex: 'rune', a: .8, spin: 1 }); fx.ring(c, R * .3, R, 'curse', .5);
        const C = S.dmg?.curse; let n = 0;
        const curseOn = (d, quiet) => {
          if (d.noRepulse > time && S.name === 'Repulsion') return;
          if (C?.maxLevel && d.level > C.maxLevel) { if (!quiet) say(t('{0} cannot curse enemies above level {1}', S.label, C.maxLevel), 'curse'); return; }
          n++;
          const s = (sh(S).duration || SIM.curseTime) * (S.curseX || 1);
          d.curse = { s, full: s, label: S.label, name: S.name, S, C, k: (C?.effect ?? 1) * d.stat.curseEffect }; trigger(S, 'curse', d); fx.emit(6, { p: chest(d), r: .3, v: .4, up: -1, life: .6, size: .2, c: 'curse' });
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
      if (S.name === 'Lunar Blessing') return lunar(S);
      // Echoing Cry: it Echoes its times after its delay, its area larger each time (its description: "grows larger")
      const ES = !S.echoK && S.dmg?.sum || {}, EN = ES.base_warcry_echo_X_times;
      for (let k = 1; k <= (EN || 0); k++) later(k * ES.warcry_echo_delay_ms_from_support / 1000, () => K.warcry({ ...S, echoK: k, from: { x: pp.x, z: pp.z }, A: S.A * Math.sqrt(1 + (ES['warcry_echo_area_of_effect_+%_final_per_repeat'] || 0) * k / 100) }));
      const c = S.from, R = S.A, col = S.P.els.length ? S.el : 'gold';
      fx.ring(c, .5, R, col, .55, { k: 2.8 }); fx.ring(c, .3, R * .7, 'white', .4, { a: .5 }); shake = Math.max(shake, .22);
      fx.emit(40, { p: { x: c.x, y: .3, z: c.z }, v: R * 2, flat: true, life: .4, size: .2, c: col, c2: 'white', drag: 1.5 });
      const list = inside(c, R);
      for (const o of [...objs]) if (o.earth && !o.dead && !o.segs && o.near(c) <= R) o.shatter('warcry');   // earthen objects near it
      for (const d of list) { d.wob = 1; for (const a of ailOf(S.P.els)) inflict(d, a, S); trigger(S, 'warcry', d); daze(d, S.dmg.sum?.support_dazed_cry_duration_ms / 1000); }   // Dazing Cry
      // the attacks it Empowers: one per its Power of the enemies in its area, up to its cap (else the scene's 2); a Slam
      // performs Seismic Cry's additional Aftershocks
      const ws = S.dmg?.stats || {}, per = ws.warcry_empowers_per_X_monster_power, pw = list.reduce((n, d) => n + (POWER[d.stat.rarity] || 1), 0), mp = Math.min(ws.warcry_empowers_per_X_monster_power_mp_cap, pw), FG = ws.shielding_cry_grant_X_guard_per_5_mp, uses = per ? Math.floor(mp / per) : 2;
      // Arctic Howl: its Empowered attacks gain its cold damage per 5 Power (up to its cap) instead, a Slam leaving Chilled
      // Ground for its secondary duration
      // note: that added damage as the gem gives it, without your modifiers
      const wc = ws.wolf_warcry_empowered_attack_cold_damage_min_per_5_power_up_to_cap, k5 = wc && Math.floor(mp / 5);
      gainRage(Math.floor(pw / 5) * S.dmg?.sum?.warcry_grant_X_rage_per_5_power);   // Raging Cry: its Rage per 5 Power of the enemies in its area
      if (wc && uses) { empower = empower.filter(e => e.type !== 'cold'); empower.push({ type: 'cold', label: S.label, name: S.name, uses, s: 12, add: [wc * k5, ws.wolf_warcry_empowered_attack_cold_damage_max_per_5_power_up_to_cap * k5], chill: (ws.base_secondary_skill_effect_duration || 0) / 1000 }); say(t('{0} gains {1} from {2}', t('Attack'), t('Cold'), S.label) + ` ×${uses}`, 'cold'); }
      else if (S.P.empowers && uses && !FG) { empower = empower.filter(e => e.type !== 'echo'); empower.push({ type: 'echo', label: S.label, name: S.name, uses, s: 12, slam: ws.seismic_cry_slam_skill_additional_aftershocks || 0 }); say(t('{0}: your next melee attacks repeat as an aftershock', S.label) + ` ×${uses}`, 'gold'); }
      // Fortifying Cry: its Guard per 5 Power of the enemies in its area (up to its cap); its Empowered melee attacks (one
      // per its Power, up to its cap) trigger its Shield Wave where they land. note: any melee attack, not only shield ones
      if (FG) {
        const g = Math.min(FG * Math.floor(Math.min(pw, ws.shielding_cry_grant_X_guard_per_5_mp_mp_cap) / 5), 2 * (me.maxL || 0)), n = Math.floor(Math.min(pw, ws.shielding_cry_an_additional_empowered_attack_per_X_mp_mp_cap) / ws.shielding_cry_an_additional_empowered_attack_per_X_mp);
        if (g > me.guard) { me.guard = g; later(durOf(S), () => { if (me.guard === g) me.guard = 0; }); }
        if (n) { empower = empower.filter(e => e.type !== 'wave'); empower.push({ type: 'wave', label: S.label, name: S.name, uses: n, s: durOf(S), X: { ...partOf(S, 'FortifyingCryShockwavePlayer'), mult: S.mult } }); }
      }
      if (S.P.gain && list.length) chargeBy(S.P.gain, S);
      // Ancestral Cry: you embody Kaom for its duration (its more per endurance charge, which it removes): Volcanic Steps
      // every so far you travel (its shockwave), your melee Strikes and Slams Ancestrally Boosted, a Strike triggering
      // Volcanic Eruption (its projectile part)
      const st = S.dmg?.stats || {}, every = st.ancestral_cry_triggers_shockwave_every_X_units_travelled;
      if (every) {
        const n = charges.endurance; charges.endurance = 0;
        me.kaom = { S, walked: 0, every: every / 10, more: st.ancestral_cry_empowered_attacks_strike_X_additional_enemies || 0, X: partOf(S, 'AncestralCryProjectilePlayer'),
          until: time + durOf(S) * (1 + (st['ancestral_cry_duration_+%_final_per_removable_endurance_charge'] || 0) * n / 100) };
        setBuff({ label: S.label, name: S.name, c: css('fire'), s: me.kaom.until - time });
      }
    },
    toggle(S) {   // heralds, persistent buffs, meta gems, minions and manual auras stay on until used again
      const k = S.name;
      if (tog[k]?.cap) return invoke(tog[k]);   // an Invocation: used, it spends its energy
      if (tog[k] && k === 'Plague Bearer') return plague(S);   // Plague Bearer: used, it unleashes
      if (tog[k] && k === 'Grim Feast') return grim(S);   // Grim Feast: used, Grim Resurrection
      if (tog[k]) { untoggle(k); say(t('{0} off', S.label), 'dust'); return; }
      const T = tog[k] = { name: k, kind: S.kind, P: S.P, label: S.label, el: S.el, energy: 0, need: 0, last: -9, R: 0, objs: [] };
      if (S.kind === 'meta') {
        T.wants = metaWants(S.P); T.need = T.wants[0] === 'hit' ? SIM.energy * 3 : SIM.energy;
        const st = gst(S), per = Object.fromEntries(Object.entries(st).flatMap(([k, v]) => { const m = k.match(/_gain_X_centienergy(?:_per_monster_power)?_on_(\w+)$/); return m ? [[m[1], v]] : []; }));
        if (st['support_randomise_higher_damage_+%_final'] != null) T.rand = st;
        if (Object.keys(per).length || st.feral_invocation_gain_1_energy_per_X_mana_spent) Object.assign(T, { per, perMs: st.generic_ongoing_trigger_1_maximum_energy_per_Xms_total_cast_time || 10, more: 1 + (st['energy_generated_+%'] || 0) / 100, cap: st.generic_ongoing_trigger_maximum_energy, manaPer: st.feral_invocation_gain_1_energy_per_X_mana_spent });
      }
      else if (S.kind === 'minion' && !S.dmg?.stats?.skill_raging_spirits_max_per_action) for (let i = 0; i < 2; i++) T.objs.push(minion(S, { x: pp.x + rnd(-1.5, 1.5), z: pp.z + rnd(-1.5, 1.5) }, Infinity));
      else if (S.kind === 'herald') T.decal = fx.decal(pp, .9, 'rune', S.el, { a: .7, spin: 1.5 });
      else { T.R = S.kind === 'field' ? S.A : S.R; T.decal = fx.decal(pp, T.R || 1.1, T.R ? 'outline' : 'ring', S.el, { a: .45, rot: 0 }); }
      fx.ring(pp, .3, 2, S.el, .5); fx.pillar(pp, .5, 2.6, S.el, .35, 2); say(t('{0} on', S.label), S.el);
    },
    // Raise Zombie: for its duration, up to its limit; without a corpse it consumes a Power Charge for an Empowered Zombie
    // (its more hit damage, less damage taken and more movement speed) and two more
    raise(S) {
      const r = Math.max(S.A, SIM.snap), list = corpses(S.at, r).slice(0, S.R ? 4 : 1 + S.spent);
      const st = S.dmg?.stats || {}, life = durOf(S) || SIM.minionTime, emp = st['power_charged_zombie_hit_damage_+%_final'];
      const raise = (X, p, o) => { limit(o => o.kind === S.name, st.base_number_of_zombies_allowed); minion(X, p, life, { kind: S.name, ...o }); };
      const E = { taken: 1 - st['power_charged_zombie_damage_taken_-%_final'] / 100, speed: 1 + st['power_charged_zombie_movement_speed_+%_final'] / 100 };
      if (!list.length && emp != null && charges.power > 0) { charges.power--; chargesSpent(1); for (let k = 0; k < 3; k++) raise(k ? S : { ...S, mult: S.mult * (1 + emp / 100) }, around(S.at, 1), k ? {} : E); return say(t('{0}: {1} raised from corpses', S.label, 3), S.el); }
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
      const c = S.at, f = makeTotem(fx, S.el, S.P.ballista), TS0 = { ...F, src: real ? 'totemHit' : 'totem', mult: F.mult * (S.totemMult || 1) * less('support_splinter_totem_damage_+%_final_each_splinter') }, R0 = (F.R || S.R || SIM.totemArea) * Math.sqrt(less('support_splinter_totem_area_of_effect_+%_final_each_splinter')), far = S.P.ballista || S.P.ranged;
      const every = (real && F.dmg.speed ? 1 / F.dmg.speed : far ? 1 : 1.3) / less('support_splinter_totem_skill_speed_+%_final_each_splinter');
      if (gen) f.group.scale.setScalar(.8 ** gen);
      let acts = 0;
      f.group.position.set(c.x, 0, c.z); f.group.rotation.y = facing; scene.add(f.group);
      fx.ring(c, .2, 1.3, S.el, .4); fx.emit(18, { p: { x: c.x, y: .1, z: c.z }, r: .5, v: 1.5, up: 1.5, life: .6, size: .5, grow: 2, c: 'dust', smoke: true, a: .4 });
      let wait = .5;
      const e = { pos: f.group.position, r: .4, dead: false, s: 0, totemOf: S.name,
        update(dt) {
          e.s += dt; if (e.s > (sh(S).totem || SIM.totemTime) * (S.totemTime || 1)) { e.die(); return; }
          if ((wait -= dt) > 0) return;
          const d = near(e.pos, far ? 12 : R0 + 1); if (!d) { wait = .2; return; }
          wait = every;
          const k = dist(d.pos, e.pos) || 1, a0 = f.group.rotation.y = Math.atan2(d.pos.x - e.pos.x, d.pos.z - e.pos.z), n = far ? sh(F).projectiles || 1 : 1;
          const gw = su.support_greatwood_number_of_active_totems_in_base_radius_to_track ? Math.min(su.support_greatwood_maximum_number_of_active_totems_in_radius_for_effects, objs.filter(o => o.totemOf && o !== e && !o.dead && dist(o.pos, e.pos) <= su.support_greatwood_number_of_active_totems_in_base_radius_to_track / 10).length) : 0;
          const TS = gw ? { ...TS0, mult: TS0.mult * (1 + gw * su['damage_+%_final_per_totem_in_radius_from_support_greatwood'] / 100) } : TS0, R = R0 * Math.sqrt(1 + gw * (su['area_of_effect_+%_per_totem_in_radius_from_support_greatwood'] || 0) / 100);
          if (F.kind === 'grenade') K.grenade({ ...TS, origin: { x: e.pos.x, z: e.pos.z }, at: { x: d.pos.x, z: d.pos.z } });
          else if (far) for (let i = 0; i < n; i++) { const a = a0 + (i - (n - 1) / 2) * .12; shoot(TS, e.pos, Math.sin(a), Math.cos(a), { speed: 22, range: 13 }); }
          else { fx.ring(e.pos, .3, R, S.el, .4); fx.disc(e.pos, R, S.el, .3, { a: .35 }); area(e.pos, R, TS, real ? {} : { mult: .6 }); }
          if (SPL && gen < SPL && ++acts >= su.support_splinter_totem_splinter_after_X_actions) { e.die(); for (let i = 0; i < 2; i++) K.totem({ ...S, at: around(e.pos, 1.2), gen: gen + 1 }); }
        },
        // Tawhoa's Tending: on death it explodes for that share of the totem's life (calc.js totemLife) in its area
        die() {
          e.dead = true; const T = S.dmg?.trig?.find(T => T.stats?.['base_physical_damage_equal_to_%_of_totem_life']);
          if (T && S.dmg.totemLife) { const X = asTrig(S, T, scale(T.hits, S.dmg.totemLife * T.stats['base_physical_damage_equal_to_%_of_totem_life'] / 1e4)), p = { x: e.pos.x, z: e.pos.z }; say(X.label, X.el); boom(p, X.A, X); }
        },
        remove() { fx.emit(14, { p: { x: e.pos.x, y: .8, z: e.pos.z }, r: .3, v: 1.4, up: 1, life: .6, size: .14, c: 0x5c4026, g: 8, k: 1 }); f.dispose(); } };
      objs.push(e);
    },
    travel(S) {
      // Shield Charge: it crashes into the first enemy on its path and stops there, its more damage from the distance
      // travelled (up to its most at its full range), its final cone part too; it runs on its extra distance past where
      // you aimed (note: as a straight run on, its slowing down is not simulated)
      const SE = (S.dmg?.stats?.shield_charge_extra_distance || 0) / 10;
      const P = S.P, to = SE ? { x: S.at.x + S.dx * SE, z: S.at.z + S.dz * SE } : S.at, from = { x: pp.x, z: pp.z }, far = S.dmg?.stats?.['base_additional_damage_from_distance_+%_final'], crash = far != null;
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
        if (SS) { boom(at, SS.A, { ...SS, mult: S.mult }); slammed(SS, at, SS.A); for (const g of grounds) if (!g.dead && g.type === 'jagged' && dist(g, at) <= SS.A + g.r) { g.dead = true; boom(g, g.r, S, { soft: true }); } }
        // Molten Crash: its Molten Fissures (its part, up to its limit, lasting its duration), one more for the Rage it
        // consumes on landing if you have it, then its second slam setting them off
        // note: one fissure without Rage is the description's plural read at its least; their length is not in the data
        const ms = S.dmg?.stats, mc = ms?.molten_crash_max_number_of_fissures;
        if (mc) {
          const X = partOf(S, 'MoltenCrashFissurePlayer') || S, cost = ms.molten_crash_optionally_consume_X_rage_for_fissures, more = me.rage >= cost ? ms.molten_crash_number_of_additional_fissures_from_rage_consumption : 0;
          if (more) me.rage -= cost;
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
      const P = S.P; let c = S.src ? S.at : S.from;
      if (P.from) { const q = objs.find(o => o.proj && o.name === P.from && !o.dead); if (q) { c = { x: q.pos.x, z: q.pos.z }; say(t('{0} erupts from {1}', S.label, labelOf(P.from)), S.el); } }
      const R = stageR(S), dur = Math.min(.5, .12 + R * .045);
      // Elemental Sundering: its pulse deals nothing; it Consumes the Freeze, Shock and Ignite of the enemies in it, nearest
      // first, each an explosion of that element around the enemy (the cold one the gem's, the others its parts), up to its
      // most, with its more damage from a Unique
      // note: its pulse's radius is PoB2's (Skills/act_dex.lua ElementalSunderingPlayer "Pulse": 50), scaled as its explosion's;
      // the ailments of allies and corpses are not in the scene
      // Bone Cage: its ring of bone spikes around you (up to its rings, a new one ends the last) for its duration; a spike an
      // enemy touches breaks (its chance: 100%), hitting and Pinning the enemies within its secondary radius
      // note: its spikes stand side by side around the ring, their number the scene's (the data gives none)
      const BC = S.dmg?.stats?.ring_of_bone_maximum_number_of_rings;
      if (BC) {
        const r = radOf(S), n = Math.max(3, Math.round(Math.PI * R / r)), g = holder(c), mat = new THREE.MeshStandardMaterial({ color: 0xd8d0b8, roughness: .7, flatShading: true });
        limit(o => o.cage && o.name === S.name, BC);
        const spikes = Array.from({ length: n }, (_, k) => {
          const a = k * TAU / n, m = new THREE.Mesh(EARTH.spike, mat); m.position.set(Math.sin(a) * R, .45, Math.cos(a) * R); m.scale.set(.5, .6, .5); m.castShadow = true; g.add(m);
          return { m, p: { x: c.x + Math.sin(a) * R, z: c.z + Math.cos(a) * R } };
        });
        pop(c, R, 'dust');
        const e = thing(g, durOf(S), { name: S.name, cage: true,
          tick() { for (const k of spikes) if (k.m.visible && inside(k.p, .2).length) { k.m.visible = false; pop(k.p, r, 'dust'); area(k.p, r, { ...S, self: e }); } } });
        return;
      }
      const ES = S.dmg?.stats?.elemental_sundering_number_of_explosion_allowed;
      if (ES) {
        const st = S.dmg.stats, pr = 5 * S.A / (st.active_skill_base_area_of_effect_radius / 10), by = { freeze: S, ignite: partOf(S, 'ElementalSunderingFirePlayer'), shock: partOf(S, 'ElementalSunderingLightningPlayer') };
        fx.ring(c, .3, pr, S.el, .4, { a: .6 }); let n = ES;
        for (const d of inside(c, pr).sort((p, q) => dist(p.pos, c) - dist(q.pos, c))) for (const s of ['freeze', 'shock', 'ignite']) if (n > 0 && has(d, s)) {
          n--; consume(d, S, s);
          const X = by[s], p = { x: d.pos.x, z: d.pos.z }, gm = uniqueMore(d, st['elemental_sundering_damage_+%_final_if_created_from_unique']);
          later(.1, () => { pop(p, X.A, X.el); boom(p, X.A, { ...X, gm: (X.gm ?? 1) * gm }, { noPay: true }); });
        }
        return;
      }
      fx.ring(c, .2, R, S.el, dur + .15, { k: 2.8 }); fx.disc(c, R, S.el, dur + .25, { a: .35 }); fx.flash(c, S.el, 30 + R * 10, .35, 6 + R * 2);
      fx.emit(Math.min(120, 20 + R * 14), { p: { x: c.x, y: .4, z: c.z }, v: R / dur * .8, flat: true, life: dur, size: .22, c: S.el, c2: 'white', drag: .5 });
      for (const d of inside(c, R)) later(dist(d.pos, c) / R * dur, () => hit(d, S));   // the wave reaches the near ones first
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
        const SW = S.dmg?.stats?.sunder_wave_max_steps;
        if (SW) { const ss = S.dmg.stats, X = partOf(S, 'SunderShockwavePlayer'), XR = X && radOf(X); for (let k = 0; k < SW; k++) later(k * .12, () => {
          const r = R + k * ss['sunder_wave_radius_+_per_step'] / 10, q = { x: c.x + S.dx * R * 1.8 * k, z: c.z + S.dz * R * 1.8 * k };
          const there = inside(q, r);
          for (const d of there) if (d.st.armour > 0) d.sunder = { pct: ss.sunder_armor_break_extra_magnitude, until: time + durOf(S) };
          if (X) for (const d of there.slice(0, ss.sunder_shockwave_limit_per_cascade)) boom({ x: d.pos.x, z: d.pos.z }, XR, X, { soft: true });
          boom(q, r, S);
        }); }
        else boom(c, R, S);
        // Supercharged Slam: an Aftershock per stage, each its delay later and its radius larger per previous one
        const ps = S.dmg?.part || {};
        for (let k = 1; k <= cs; k++) later(k * ps.aftershock_delay_ms / 1000, () => boom(c, R + k * ps['aftershock_radius_+_per_previous_aftershock'] / 10, S));
        // Tremors: its independent chances for one, two and three more Aftershocks, each the slam's damage in its area after it (keywords.json)
        const TR = !S.src && S.dmg?.sum, n = TR ? [['support_slam_chance_for_one_additional_aftershock_%', 1], ['support_slam_chance_for_two_additional_aftershocks_%', 2], ['support_slam_chance_for_three_additional_aftershocks_%', 3]].reduce((n, [w, k]) => n + (Math.random() * 100 < (TR[w] || 0) ? k : 0), 0) : 0;
        for (let k = 1; k <= n; k++) later(.42 * k, () => { say(t('Aftershock of {0}', S.label), S.el); boom(c, R, S); });
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
          if (X) me.rage -= FS;
          for (const sgn of [-1, 1]) later(st.aftershock_delay_ms / 1000, () => { const a = a0 + sgn * off, q = { x: c.x + Math.sin(a) * gap, z: c.z + Math.cos(a) * gap }; boom(q, r, W); if (X) ground('jagged', q, r, durOf(X), W); });
        }
        slammed(S, c, R); if (S.chillFor) ground('chilled', c, R, S.chillFor, S); fx.disc(c, R * 1.1, 0x0a0806, 5, { dark: true, tex: 'cracks', a: .85, hold: .6, y: .032, spin: 0 });
        // Starborn Onslaught: its fissures, lasting its duration up to its limit, and its stars falling one after another
        // (its first delay, its delay) between its inner and outer radius around the impact (its explosion part)
        // note: the branching of its fissures is not drawn
        const st = S.dmg?.stats || {}, stars = st.empyrean_descent_number_of_explosions, X = stars && partOf(S, 'StarbornOnslaughtExplosions');
        if (stars) for (let k = 0; k < (st.base_number_of_fissures || 1); k++) fissure(S, c, Math.atan2(S.dx, S.dz) + k * TAU / st.base_number_of_fissures, 5, .8, .5, { dur: sh(S).duration || st.base_skill_effect_duration / 1000, max: st.volcanic_fissure_base_maximum_number_of_fissures });
        // Fury of the Mountain: each pound a Molten Fissure off at random within its cone in front of you, lasting its
        // duration up to its most (note: one per pound, the data gives no number; their length is the scene's)
        else if (st.fury_of_the_mountain_base_maximum_number_of_fissures) { const h = st.bear_fury_of_the_mountain_front_facing_cone_angle * Math.PI / 360; fissure(S, c, Math.atan2(S.dx, S.dz) + rnd(-h, h), 5, S.A, 1, { dur: durOf(S), max: st.fury_of_the_mountain_base_maximum_number_of_fissures }); }
        else if (P.fissure) for (let j = -1; j <= 1; j++) fissure(S, c, Math.atan2(S.dx, S.dz) + j * .5, 5);
        if (X) for (let k = 0; k < stars; k++) later((st.empyrean_descent_secondary_explosions_initial_delay_ms + k * st.empyrean_descent_secondary_explosions_delay_ms) / 1000, () => {
          const a = rnd(TAU), r = rnd(st.empyrean_descent_secondary_explosions_inner_radius / 10, st.empyrean_descent_secondary_explosions_outer_radius / 10), q = V(c.x + Math.sin(a) * r, 0, c.z + Math.cos(a) * r);
          fx.streak(V(q.x + 2, 13, q.z - 1.5), q, 'cold', .16, .07, 1.8); later(.16, () => { pop(q, X.A, 'cold'); area(q, X.A, X); });
        });
        // the earthen object it leaves: Earthshatter's spike where its fissure ends, Forge Hammer's hammer where it lands
        if (P.earthen) { const spike = !!st.spike_slam_max_spikes; earth(S, spike ? { x: c.x + S.dx * 5, z: c.z + S.dz * 5 } : c, spike ? st.spike_slam_max_spikes : st.forge_hammer_maximum_hammers, spike); }
        // Earthquake: its Jagged Ground (its tertiary radius and duration, up to its most patches, never on one of its own)
        // erupts at its end in its Aftershock part. note: the Aftershock hits the patch's area (its own radius is smaller)
        if (P.aftershock) {
          const r = st.active_skill_base_tertiary_area_of_effect_radius / 10 || R, dur = st.skill_jagged_ground_base_duration_ms / 1000, X = partOf(S, 'EarthquakeAftershockPlayer') || S, mine = grounds.filter(g => !g.dead && g.quake === S.name);
          if (mine.length < (st.base_number_of_earthquakes_allowed || 1) && !mine.some(g => dist(g, c) < g.r + r)) {
            ground('jagged', c, r, dur, S).quake = S.name; fx.telegraph(c, r, S.el, dur);
            later(dur, () => { say(t('Aftershock of {0}', S.label), S.el); pop(c, r, S.el); boom(c, r, { ...X, mult: S.mult }); });
          }
        } else if (P.ground) ground(P.ground, c, R * 1.15, P.dur, S);
        if (P.fan && S.spent) { const a0 = Math.atan2(S.dx, S.dz), n = 1 + S.spent * 2; for (let i = 0; i < n; i++) { const a = a0 + (i - (n - 1) / 2) * .22; shoot({ ...S, aoe: false, P: { ...P, explodes: false } }, c, Math.sin(a), Math.cos(a), { speed: 20, range: 11 }); } }
      });
    },
    strike(S) {
      const P = S.P, reach = strikeR(S), FL = S.dmg?.stats?.flicker_strike_additional_flickers_from_power_charges, n = S.times || (FL ? 1 + S.spent * FL : P.dash ? Math.max(1, S.spent) : 1);   // Flicker Strike: its more strikes per Power Charge
      const first = S.src ? near(S.at, 1) : near(S.at, SIM.snap, e => dist(e.pos, pp) <= reach);
      if (!first) return slash(S, S.dx, S.dz);   // nothing in reach: swings at the air
      const go = (d, k) => {
        if (d.dead) return;
        if (P.dash || dist(d.pos, pp) > meleeR(S) + SIM.body) {   // strikes that carry you to the target
          const a = Math.atan2(pp.x - d.pos.x, pp.z - d.pos.z) + (k ? rnd(-2, 2) : 0), q = { x: d.pos.x + Math.sin(a) * 1.1, z: d.pos.z + Math.cos(a) * 1.1 };
          fx.bolt(V(pp.x, 1, pp.z), V(q.x, 1, q.z), S.el, .2, .04, .1); pp.x = q.x; pp.z = q.z;
        }
        const dx = d.pos.x - pp.x, dz = d.pos.z - pp.z, l = Math.hypot(dx, dz) || 1;
        facing = Math.atan2(dx, dz); castAt = time; slash(S, dx / l, dz / l);
        if (S.R) { pop(d.pos, S.R, S.el); area(d.pos, S.R, S); } else { hit(d, S); touch(d.pos, .6, S); }
        if (k + 1 < n) later(.13, () => go(near(d.pos, 6, e => e !== d) || d, k + 1));
      };
      const shocked0 = first.st.shock > 0;
      go(first, 0);
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
      if (S.P.culls && first.dead) dummies.filter(e => cullable(e, S) && dist(e.pos, pp) <= (S.dmg?.stats?.base_melee_dash_range || 0) / 10).forEach((e, k) => later((k + 1) * .13, () => go(e, k + 1)));
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
      fx.sector(c, S.dx, S.dz, R, half, S.el, ch ? .22 : .35, { grow: !ch, a: ch ? .45 : .7 });
      fx.emit(ch ? 7 : 24, { p: { x: c.x + S.dx * .8, y: 1, z: c.z + S.dz * .8 }, dir: V(S.dx * R * 2.2, .2, S.dz * R * 2.2), v: R * half * 1.1, life: .42, size: .32, c: S.el, c2: 'white', drag: .9 });
      for (const d of inside(c, R)) if (inCone(c, a0, half, d.pos)) hit(d, S);
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
      const su = S.src ? {} : S.dmg?.sum || {}, MV = su.support_storm_base_movement_speed && su.support_storm_base_movement_speed / 10 * (1 + su['support_approaching_storms_movement_speed_+%_final'] / 100), to = S.at;
      if (MV) S = { ...S, mult: S.mult * (1 + su['support_approaching_storms_damage_+%_final'] / 100) };
      const P = S.P, c = MV ? { x: pp.x, z: pp.z } : S.at, st = S.dmg?.stats || {}, dur = sh(S).duration || Math.min(P.dur || 4, 10), shrink = MV ? Math.sqrt(1 + su['support_approaching_storms_area_of_effect_+%_final'] / 100) : 1;
      if (P.wind) return vortex(S, c, S.A, dur);
      // its own limit, impact interval (and variance), fall time and re-hit interval on one enemy (Firestorm, Icestorm,
      // Thunderstorm); the scene's when a storm gives none
      const max = Object.entries(st).find(([k]) => /_max(?:imum)?_number_of_storms$/.test(k))?.[1] || 2, every = (st.fire_storm_fireball_delay_ms ?? st.lightning_storm_hit_frequency_ms ?? 170) / 1000,
        vary = (st.lightning_storm_hit_frequency_variance_ms || 0) / 1000, fall = (st.firestorm_fall_time_ms ?? 160) / 1000,
        again = (st.rain_hit_delay_ms ?? st.lightning_storm_hit_prevention_duration_ms ?? 0) / 1000, hitAt = new Map();
      limit(o => o.stormOf === S.name, max + (su['support_storm_skill_limit_+'] || 0));
      // Firestorm's consumed Infusions: Fire, a larger area and more frequent bolts; Cold and Lightning, their own bolts too
      const fi = S.infs?.includes('fire'), G0 = stormGeo(S), Z = (G0.Z + (fi ? (st['firestorm_secondary_radius_+_if_consumed_fire_infusion'] || 0) / 10 : 0)) * shrink, R = G0.R * shrink;
      const extra = (S.infs || []).filter(e => e !== 'fire').map(e => infPart(S, e)).filter(Boolean);
      const out = fx.decal(c, Z, 'outline', S.el, { a: .4, rot: 0 }), bolt = S.els.includes('lightning');
      // Thunderstorm drenches the enemies in it: more shock chance and freeze buildup against them while they stay
      const ws = st['thunderstorm_wet_debuff_shock_chance_on_+%_final'], wet = ws != null && { shock: ws, freeze: st['thunderstorm_wet_debuff_hit_damage_freeze_multiplier_+%_final'] || 0 };
      // Icestorm: the chill and freeze of the enemies in front of you are consumed, each improving its bolts (per chill;
      // per Power of the frozen enemy): the next bolts are its improved part, a larger area
      // note: "in front of you" the data does not size: within cast range, on the side of the target
      const IX = st.firestorm_improved_bolts_per_chill_consumed != null && partOf(S, 'IcestormEmpoweredPlayer'); let imp = 0;
      if (IX) for (const d of dummies) if (!d.dead && dist(d.pos, pp) <= SIM.castRange && (d.pos.x - pp.x) * (c.x - pp.x) + (d.pos.z - pp.z) * (c.z - pp.z) > 0) {
        if (d.st.freeze > 0) { clear(d, 'freeze'); imp += (st.firestorm_improved_bolts_per_monster_power_of_freeze_consumed || 0) * (POWER[d.stat.rarity] || 1); }
        if (d.st.chill > 0) { clear(d, 'chill'); imp += st.firestorm_improved_bolts_per_chill_consumed; }
      }
      let tk = 0;
      thing(holder(c), dur, { stormOf: S.name, name: S.name,
        tick(dt, e) {   // impacts scattered over the area for as long as it lasts; plants in it Overgrow (its description)
          if (MV) { const l = dist(c, to), v = Math.min(l, MV * dt); if (l > .01) { c.x += (to.x - c.x) / l * v; c.z += (to.z - c.z) / l * v; out.move(c); } }
          for (const o of objs) if (o.plant && dist(o.c, c) <= Z) overgrow(o);
          if (wet) for (const d of inside(c, Z)) d.wet = { ...wet, until: time + .2 };
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
          later(r / R * .25, () => { limit(o => o.hazard && o.name === S.name, SF); pop(p, .3, 'dust'); hazardAt(X, p, durOf(S), { reach: .25, mesh: m, early: st['hazard_damage_+%_final_for_first_500_ms_when_not_killed_by_self'],
            then: q => { for (const d of inside(q, X.A)) inflict(d, 'maim', S, 1, null, { dur: MAIM.time, mag: MAIM.move + st['spearfield_maim_slows_an_additional_%'] }); } }); });
        }
        return;
      }
      if (P.corpse) { c = useCorpse(S); if (!c) return; }
      fx.ring(c, .2, R, S.el, .45);
      // its ground grows its % a second up to its most (Decompose); a cloud made of a corpse keeps that monster's life
      const zs = S.dmg?.stats || {}, gr = zs['active_skill_ground_effect_area_of_effect_+%_final_per_second'];
      if (P.ground) { ground(P.ground, c, R, dur, S, gr && { per: gr, max: zs['active_skill_ground_effect_area_of_effect_+%_final_per_second_max'] }).corpse = c.life; area(c, R, S, { mult: .5 }); return; }
      const dec = fx.decal(c, R, P.plant ? 'cracks' : 'rune', S.el, { a: .55, spin: P.plant ? 0 : .3 }); let tk = 0;
      if (P.plant) limit(o => o.plant && o.name === S.name, S.dmg?.stats?.number_of_vine_arrow_pod_allowed);
      limit(o => o.name === S.name && !o.plant, S.dmg?.stats?.ritual_of_power_maximum_number_of_rituals ?? S.dmg?.stats?.number_of_poison_cloud_allowed);   // Profane Ritual, Decompose: up to their most
      const z = thing(holder(c), dur, { name: S.name, plant: P.plant && S, c, R,
        tick(dt, e) {
          if (e.plant) presence(e);
          if (Math.random() < dt * R * 8) fx.emit(1, { p: { x: c.x, y: .05, z: c.z }, r: R * .9, v: .2, up: 1.4, life: .7, size: .22, c: S.el });
          if ((tk -= dt) > 0) return; tk = .5;
          area(c, e.R, { ...S, self: e, mult: S.mult * (e.more || 1) }, { mult: .25, noPay: e.s > .6, noTouch: true });
        },
        off: () => dec.remove() });
      if (z.plant) planted(z);
    },
    dot(S) {
      const R = S.A; let c = S.at;
      if (S.P.corpse) { c = useCorpse(S); if (!c) return; }
      fx.disc(c, R, S.el, .6, { tex: 'patch', a: .7 }); fx.ring(c, .2, R, S.el, .45);
      fx.emit(30, { p: { x: c.x, y: .3, z: c.z }, r: R * .8, v: .6, up: 1.6, life: 1, size: .3, c: S.el, c2: 'poison' });
      for (const d of inside(c, R)) { dot(d, S); d.wob = .5; }
      touch(c, R, S);
    },
    buff(S) {
      const P = S.P;
      if (P.corpse && !useCorpse(S)) return;
      fx.ring(pp, 1.8, .3, S.el, .4); fx.pillar(pp, .5, 2.6, S.el, .35, 2);
      // Barrage: repeats from its stats (else the scene's 2, one more per charge spent: Unleash), each with its less damage
      // Ice-Tipped Arrows: its number of your next projectile attacks are empowered, for its duration (icetip)
      const IT = partOf(S, 'IceTippedArrowsIceFragmentPlayer');
      if (IT) { const uses = S.dmg.stats.shearing_bolts_number_of_empowered_attacks; empower = empower.filter(e => e.type !== 'icetip'); empower.push({ type: 'icetip', label: S.label, name: S.name, el: 'cold', uses, s: durOf(S), X: IT, cv: S.dmg.stats['shearing_bolts_non_skill_base_physical_damage_%_to_convert_to_cold'] }); say(t('{0} active', S.label) + ` ×${uses}`, 'cold'); }
      else if (P.repeats) { const st = S.dmg?.stats || {}, n = (st.empower_barrage_base_number_of_barrage_repeats ?? 2) + (st.empower_barrage_number_of_barrage_repeats_per_frenzy_charge ?? 1) * S.spent;
        empower = empower.filter(e => e.type !== 'repeat'); empower.push({ type: 'repeat', flag: P.repeats, n, less: st['empower_barrage_damage_-%_final_with_repeated_projectiles'] || 0, label: S.label, name: S.name, s: sh(S).duration || 12 }); say(t('{0}: your next skill repeats {1} times', S.label, n), 'gold'); }
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
        const n = c.life * CP / 1000; fx.telegraph(c, R, S.el, (cs.explosion_delay_ms || 0) / 1000);
        return later((cs.explosion_delay_ms || 0) / 1000, () => { boom(c, R, S); lifeBlast(c, R, S, 'physical', n); });
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
      boom(c, R, S);
      if (P.ground) ground(P.ground, c, R, Math.min(P.dur || GROUND_TIME[P.ground] || SIM.groundTime, 10), S);
    },
    meteor(S) {
      const X = S.infs?.includes('fire') && infPart(S, 'fire'); if (X) S = X;   // Comet: a devastating blast of ice and fire
      const P = S.P, R = S.A, fall = S.dmg?.stats?.comet_fall_time_ms, delay = fall ? fall / 1000 : P.delay ?? (P.dur && P.dur <= 4 ? P.dur : SIM.meteor);
      const d = P.attack ? near(S.at, SIM.snap) : null, c = d ? { x: d.pos.x, z: d.pos.z } : S.at;
      fx.telegraph(c, R, S.el, delay);
      // Skyfall: where it lands, its Temporary Minions (more with a Verisium Infusion consumed: its infused part's),
      // up to its limit, for its duration
      const st = S.dmg?.stats || {}, VM = st.verisium_comet_number_of_minions_to_create;
      if (VM) later(delay, () => {
        const n = VM + (S.infs?.includes('verisium') ? partOf(S, 'SkyfallInfusedPlayer')?.dmg.stats.verisium_comet_number_of_minions_to_create || 0 : 0);
        for (let k = 0; k < n; k++) { limit(o => o.kind === S.name, st.base_number_of_verisium_octopus_minions_allowed); minion(S, around(c, R), durOf(S), { kind: S.name }); }
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
      limit(o => o.volcano && o.name === S.name, st.volcano_base_number_of_geysers_allowed || 1);
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
      limit(o => o.fragments, st.base_number_of_ice_volcanos_allowed);
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
  // after its time to impact) or its static field (its lightning part's pulses, then its final strike)
  K.apocalypse = S => {
    const st = S.dmg?.stats || {}, dur = durOf(S), F = partOf(S, 'ApocalypseFirePlayer'), L = partOf(S, 'ApocalypseLightningPlayer'), LF = partOf(S, 'ApocalypseLightningFinalStrikePlayer');
    const r2 = S.G?.radius2 || .8; let tk = 0;
    setBuff({ label: S.label, name: S.name, c: css('lightning'), s: dur });
    const one = [
      c => { let w = 0; for (let k = 0; k < (st.unleash_blizzard_number_of_bolts || 1); k++) { w += rnd(st.unleash_blizzard_minimum_bolt_frequency_ms, st.unleash_blizzard_maximum_bolt_frequency_ms) / 1000; const q = around(c, 2); later(w, () => { fx.streak(V(q.x + 2, 13, q.z - 1.5), V(q.x, 0, q.z), 'cold', .12, .06, 1.8); later(.16, () => { pop(q, r2, 'cold'); area(q, r2, S); }); }); } },
      F && (c => { const w = F.dmg.stats.unleash_meteor_time_till_impact_ms / 1000; fx.telegraph(c, F.A, 'fire', w); later(w, () => { pop(c, F.A, 'fire'); boom(c, F.A, F); shake = .3; }); }),
      L && (c => { const n = L.dmg.stats.unleash_static_field_number_of_pluses || 1, w = L.dmg.stats.unleash_static_field_time_till_final_strike_ms / 1000, dec = fx.decal(c, L.A, 'rune', 'lightning', { a: .5, spin: .5 });
        for (let k = 0; k < n; k++) later(k * w / n, () => area(c, L.A, L)); later(w, () => { dec.remove(); fx.bolt(V(c.x, 14, c.z), V(c.x, 0, c.z), 'lightning', .3, .12, .5); if (LF) boom(c, L.A, LF); }); }),
    ].filter(Boolean);
    thing(holder(pp), dur, { name: S.name, tick(dt) {
      if ((tk -= dt) > 0) return; tk = st.unleash_the_elements_base_trigger_frequency_ms / 1000;
      const d = near(pp, S.A); if (d) one[Math.floor(rnd(one.length))]({ x: d.pos.x, z: d.pos.z });
    } });
  };
  // Archon of Chayula: for its duration you are his Archon: more physical and chaos damage, its chance to Wither on hit, and
  // at its interval Chayula's Will, a chaos tornado that seeks the enemies within its secondary radius at its speed and
  // hits in its area at its interval
  K.chayula = S => {
    const st = S.dmg?.stats || {}, dur = durOf(S); let tk = 0;
    me.chayula = { until: time + dur, more: st['archon_of_chayula_physical_and_chaos_damage_+%_final'] || 0, wither: st['archon_of_chayula_withered_on_hit_for_4_seconds_%_chance'] || 0 };
    setBuff({ label: S.label, name: S.name, c: css('chaos'), s: dur });
    fx.ring(pp, .3, 3, 'chaos', .6);
    thing(holder(pp), dur, { name: S.name, tick(dt, e) {
      if ((tk -= dt) > 0) return; tk = st.archon_of_chayula_spawn_chaos_tornado_interval_ms / 1000;
      vortex(S, { x: pp.x, z: pp.z }, S.A, e.dur - e.s, { speed: st.archon_chayula_storm_movement_speed / 10, every: st.archon_of_chayula_tornado_attack_interval_ms / 1000, mult: 1, seek: S.G?.radius2 || 9 });
    } });
  };
  // Conductive Runes: its Runes in a cone in front of you up to its limit, each arming after its time and going off its
  // activation time after an enemy steps on it (its secondary radius), exploding in its area
  K.runes = S => {
    const st = S.dmg?.stats || {}, n = st.rune_hazard_number_of_runes_to_create || 1, half = (st.rune_hazard_cone_angle || 60) / 2 * Math.PI / 180, a0 = Math.atan2(S.dx, S.dz);
    for (let k = 0; k < n; k++) {
      limit(o => o.hazard && o.name === S.name, st.rune_hazard_base_number_of_runes_allowed);
      const a = a0 + rnd(-half, half), r = rnd(1, SIM.castRange * .6), p = { x: pp.x + Math.sin(a) * r, z: pp.z + Math.cos(a) * r };
      hazardAt(S, p, durOf(S), { arm: st.rune_hazard_arming_time_ms / 1000, delay: st.rune_hazard_detonate_time_ms / 1000, reach: S.G?.radius2, c: 'lightning' });
    }
  };
  // Rolling Magma: a ball of magma lobbed at the target (within its least and most distance) that hits its area where it
  // lands and bounces forward its Chains times (its bounce range each), its impacts setting off Molten Fissures and
  // Volcanos as a Slam does
  K.magma = S => {
    const st = S.dmg?.stats || {}, l = Math.hypot(S.at.x - pp.x, S.at.z - pp.z) || 1, k = clamp(l, st.magma_orb_target_distance_absolute_minimum / 10, st.magma_orb_target_distance_absolute_maximum / 10);
    const bounce = (from, to, left) => lob(fx.orb('fire', .25), V(from.x, from.y ?? 1.2, from.z), V(to.x, .2, to.z), .35, 1.4, () => {
      pop(to, S.A, 'fire'); boom(to, S.A, S); slammed(S, to, S.A);
      if (left > 0) bounce({ x: to.x, y: .2, z: to.z }, { x: to.x + S.dx * st.magma_orb_base_bounce_range / 10, z: to.z + S.dz * st.magma_orb_base_bounce_range / 10 }, left - 1);
    }, { trail: 'fire' });
    bounce({ x: pp.x, z: pp.z }, { x: pp.x + S.dx * k, z: pp.z + S.dz * k }, sh(S).chains ?? st.number_of_chains ?? 0);
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
      if (lance) limit(o => o.whirl && o.lance, st.windstorm_base_maximum_number_of_storms);
      const e = thing(holder(c), lance ? durOf(W) : Infinity, { whirl: true, lance, stage: lance ? top + (S.spent ? 1 : 0) : 1, c, out: !lance || dist(pp, c) > W.A, X: X0,
        R: () => W.A + st['sandstorm_swipe_storm_radius_+_per_stage'] * (e.stage - 1) / 10,
        tick(dt) {
          const R = e.R(); fx.emit(2, { p: { x: c.x + rnd(-R, R), y: rnd(1.5), z: c.z + rnd(-R, R) }, r: .3, v: 2, life: .5, size: .4, c: e.X.el === 'physical' ? 'dust' : e.X.el, smoke: true, a: .3 });
          standSlow(slow, c, R, st['active_skill_base_slow_debuff_movement_speed_+%_final'], .1);
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
    for (const d of inside(S.at, S.A).filter(d => d.curse && d.curse.s <= d.curse.full / 2).slice(0, st.hexblast_maximum_number_of_explosions)) { d.curse = null; boom({ x: d.pos.x, z: d.pos.z }, r, S); }
  };
  // Volatile / Bitter Dead: consumes its corpses (up to its number) where you aim, each a core for its duration that seeks
  // the nearest enemy, its aura part hitting those around it (its Ignite / Chill), and explodes at its end (its explosion
  // part). note: the core's speed and how often its aura hits are not in the data: 3 m/s, every 0.5 s
  K.volatile = S => {
    const ks = Object.keys(S.dmg.parts || {}), X = partOf(S, ks.find(k => /Explosion/.test(k))), U = partOf(S, ks.find(k => /Aura/.test(k)));
    const list = corpses(S.at, Math.max(S.A, SIM.snap)).slice(0, S.dmg.stats.volatile_dead_base_number_of_corpses_to_consume);
    if (!list.length) return toast(t('{0} needs a corpse: kill an enemy or press C', S.label));
    for (const d of list) {
      eat(d, S.el); const m = fx.orb(S.el, .3); m.position.set(d.pos.x, 1, d.pos.z); let tk = 0;
      thing(m, durOf(S), { name: S.name,
        tick(dt) {
          const p = m.position, e = near(p, 15); if (e) { const k = dist(e.pos, p); if (k > .5) { p.x += (e.pos.x - p.x) / k * 3 * dt; p.z += (e.pos.z - p.z) / k * 3 * dt; } }
          if ((tk -= dt) <= 0 && U) { tk = .5; fx.ring(p, .2, U.A, S.el, .3, { a: .4 }); area(p, U.A, U); }
        },
        end: () => X && boom({ x: m.position.x, z: m.position.z }, X.A, X) });
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
    for (let k = 1 + (S.spent ? st.mantra_of_illusions_bonus_illusions_when_consuming_power_charge : 0); k > 0; k--) {
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
      limit(o => o.ice && o.name === S.name, st.base_number_of_grim_pillars_allowed ?? st.base_number_of_frozen_locus_allowed);
      const a = k * TAU / n, p = { x: c.x + Math.sin(a) * r, z: c.z + Math.cos(a) * r };
      crystal(S, p, durOf(S), X || S); for (const d of inside(p, hr)) hit(d, S);
    }
  };
  K.twister = S => {
    const st = S.dmg?.stats || {}, W = objs.find(o => o.whirl && !o.dead && dist(o.c, pp) <= o.R()), n = (sh(S).projectiles || 1) + (W ? W.stage : 0);
    if (W) W.dead = true;   // it consumes the Whirlwind: one more twister per stage, more damage per stage
    const mult = W ? 1 + st['twister_damage_+%_final_per_whirling_slash_stage'] * W.stage / 100 : 1, a0 = Math.atan2(S.dx, S.dz), spread = (st.minimum_per_projectile_spread_angle_degrees || 15) * Math.PI / 180;
    const T = W?.X.got ? gainAs(S, W.X.got, st['twister_gain_%_elemental_damage_of_corresponding_type']) : S;
    for (let k = 0; k < n; k++) vortex(T, { x: pp.x, z: pp.z }, S.A, durOf(S), { dir: a0 + (k - (n - 1) / 2) * spread, speed: st.twister_base_movement_speed / 10, every: st.twister_hit_interval_ms / 1000, mult });
  };
  // a Banner: placed where you stand for its duration, its Aura granting you its buff while you are within its area
  // (its base_skill_buff_<stat>_to_apply, and Refraction's Refractive Plating), one of each Banner at a time. Refraction
  // III: the enemies in its area have its Exposure per 1000 of your armour, up to 80% (its text)
  K.banner = S => {
    const st = S.dmg?.stats || {}, su = S.dmg?.sup || {}, give = Object.fromEntries(Object.entries(st).flatMap(([k, v]) => { const m = k.match(/^base_skill_buff_(.+)_to_apply$/); return m ? [[m[1], v]] : []; }));
    for (const k of ['%_armour_to_apply_to_elemental_damage', 'deflection_rating_%_of_evasion_rating']) if (su['support_tempered_valour_' + k]) give[k] = su['support_tempered_valour_' + k];
    const RX = su['support_tempered_valour_banner_applies_%_elemental_exposure_per_1000_armour'];
    for (const o of objs) if (o.banner && o.name === S.name) o.dead = true;
    const c = { x: pp.x, z: pp.z }, g = holder(c), R = S.A, ring = fx.decal(c, R, 'outline', 'gold', { a: .35, rot: 0 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.04, .05, 3.2), new THREE.MeshStandardMaterial({ color: 0x6a5a3a })); pole.position.y = 1.6;
    const flag = new THREE.Mesh(new THREE.BoxGeometry(.04, 1.1, .8), new THREE.MeshStandardMaterial({ color: fx.color(S.el === 'physical' ? 'gold' : S.el, 1), emissive: 0x201000 })); flag.position.set(0, 2.5, .42);
    g.add(pole, flag); fx.ring(c, .2, R, 'gold', .5); say(t('{0} active', S.label), 'gold');
    thing(g, durOf(S), { name: S.name, banner: give, R, c, off: () => ring.remove(), tick(dt) {
      flag.rotation.y = Math.sin(time * 2) * .15;
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
    const st = attr(); if (st) for (const d of inside(pp, sheet().overgrow.r)) if (['rare', 'unique'].includes(d.stat.rarity)) d.attr = Math.min(st.skill_attrition_presence_max_seconds, (d.attr || 0) + dt);
  }
  // Critical Weakness: each stack adds critical hit chance to hits against the enemy. Malice: while on, a stack every its
  // interval on the enemies in your Presence, for its duration
  const weakOf = d => (d.weak = (d.weak || []).filter(u => u > time)).length * WEAK.per;
  const weaken = (d, n, s = WEAK.time) => { weakOf(d); for (let k = 0; k < n; k++) d.weak.push(time + s); d.weak.sort((a, b) => a - b); d.weak.splice(0, d.weak.length - WEAK.max); };
  function malice() {
    const S = onS('Malice'), st = S?.dmg?.stats; if (!st || time - (me.maliceAt ?? -99) < st.critical_chance_against_aura_apply_brittle_every_x_ms / 1000) return;
    me.maliceAt = time; for (const d of inside(pp, sheet().overgrow.r)) weaken(d, 1, durOf(S));
  }
  function popBoils(d) {
    const n = d.boils, S = d.boilS; d.boils = 0; d.boilAt = null; if (!n) return;
    const st = S.dmg.stats, p = { x: d.pos.x, z: d.pos.z }, dps = d.max * st['blood_boil_%_health_as_corrupted_blood_damage_per_minute'] / 6000;
    later(st.blood_boil_explosion_delay_ms / 1000, () => {
      const R = S.A * Math.sqrt(1 + n * st['blood_boil_explosion_area_+%_final_per_boil'] / 100); fx.ring(p, .2, R, 'blood', .5);
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
  // Rite of Restoration: its Sigil (its limit, its duration); standing in it you regenerate its life and have its more
  // armour, evasion and energy shield per stage; the mana you spend in it gains a stage for each its % of your maximum,
  // at most one a second, up to its most
  // note: that it starts at its first stage is not in the data
  K.sigil = S => {
    const st = S.dmg?.stats || {}, c = { x: pp.x, z: pp.z }, R = S.A, g = holder(c), ring = fx.decal(c, R, 'outline', 'gold', { a: .4, rot: 0 }), glow = fx.decal(c, R, 'patch', 'gold', { a: .12, k: 1 });
    limit(o => o.sigil && o.name === S.name, st.base_number_of_sigil_of_power_allowed);
    const give = n => ({ 'armour_evasion_+%_final': n * st['sacred_ground_armour_evasion_energy_shield_+%_final_per_stage'], 'energy_shield_+%_final': n * st['sacred_ground_armour_evasion_energy_shield_+%_final_per_stage'], life_regeneration_per_minute: n * st.sacred_ground_life_regeneration_for_allies_per_minute_per_stage });
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
      const dmg = n >= 10 ? { ...S.dmg, leech: { ...S.dmg.leech, life: { all: 0, more: 1, rate: 1, ...lf, phys: (lf?.phys || 0) + L } } } : S.dmg;
      pop(p, A, 'blood'); boom(p, A, { ...S, dmg, mult: S.mult * (1 + st['damage_per_bloodstone_lance_+%_final'] * n / 100) });
    }
  };
  // Oil Barrage: its projectiles one after another across its spread arc to where you aim, each hitting its area where it
  // lands and leaving Oil Ground; with a Power Charge to consume (one every its interval while you keep using it) the
  // electrified oil instead (its empowered part), with no ground
  // note: its secondary explosions are not simulated (where they happen is not in the data)
  K.oil = S => {
    const st = S.dmg?.stats || {}, n = sh(S).projectiles || st.base_number_of_projectiles || 1, arc = (st.barrage_base_spread_arc_override || 0) * Math.PI / 180, a0 = Math.atan2(S.dx, S.dz), l = Math.max(st['minimum_projectile_target_distance_+'] / 10 || 0, dist(S.at, pp));
    if (!(time < me.oilUntil) && charges.power > 0) { charges.power--; chargesSpent(1); me.oilUntil = time + st.electric_spit_empowered_channel_consume_power_charge_per_X_ms / 1000; }
    const E = time < me.oilUntil && partOf(S, 'OilBarrageEmpoweredPlayer'), X = E ? { ...E, mult: S.mult } : S;
    for (let k = 0; k < n; k++) later(k * .08, () => {
      const a = a0 + (n > 1 ? k / (n - 1) - .5 : 0) * arc, q = { x: pp.x + Math.sin(a) * l, z: pp.z + Math.cos(a) * l };
      lob(fx.orb(E ? 'lightning' : 'dust', .12), hand(), V(q.x, .1, q.z), .4, 2.4, () => { boom(q, X.A, X); if (!E) ground('oil', q, X.A, X.P.dur, X); }, { trail: E ? 'lightning' : 'dust' });
    });
  };
  K.parry = S => { me.parry = { S, until: time + PARRY_WAIT }; fx.ring(pp, .3, .9, 'white', .3, { a: .5 }); };
  K.shield = S => { me.raised = { ...me.raised, S, until: time + SIM.channelTick * 2 }; };
  // Triskelion Cascade: your next Cascadable spell is empowered (its less damage and area), centred on you, for its duration
  // and its share of the empowered spell's cast time is added to its cooldown (its last use's, use())
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
        if (++hits >= st.bell_hit_limit) e.dead = true;
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
    const g = Math.min(me.maxL * n * S.dmg.stats['maximum_life_%_damage_absorbed_per_jade_consumed'] / 100, 2 * me.maxL);   // keywords.json Guard: up to 200% of your life
    if (g > me.guard) { me.guard = g; later(durOf(S), () => { if (me.guard === g) me.guard = 0; }); }
    fx.glow({ x: pp.x, y: 1.2, z: pp.z }, 1.2, 'cold', .5); say(t('{0}: {1} Jade consumed', S.label, n), 'cold');
  };
  // Wardbound Minions: it spends all your Runic Ward (its cost with it), one caster per its Ward spent, up to its most,
  // each for its duration and at most its number of casts
  K.wardbound = S => {
    const st = S.dmg.stats, n = Math.min(Math.floor(((st._cost?.Ward || 0) + me.ward) / st.wardbound_minions_summon_minion_for_every_X_runic_ward_spent), st.base_number_of_wardbound_minions_allowed);
    spendWard(me.ward);
    for (let k = 0; k < n; k++) { limit(o => o.kind === S.name, st.base_number_of_wardbound_minions_allowed); minion(S, around(pp, 2), durOf(S), { kind: S.name, attacks: st.wardbound_minion_maximum_number_of_casts }); }
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
    const n = (/rare|unique/.test(d.stat.rarity) ? st.midnight_star_gain_x_ice_seeds_when_you_critically_hit_a_rare_or_unique_enemy : 0) + (d.dead ? POWER[d.stat.rarity] || 1 : 0);
    if (!n || (me.seeds = (me.seeds || 0) + n) < need) return;
    me.seeds -= need;
    const X = partOf(S, 'Crystal'), xs = X?.dmg.stats; if (!X) return;
    for (let k = 0; k < st.unique_nattblom_crystals_per_trigger; k++) { limit(o => o.ice && o.name === S.name, xs.midnight_star_max_ice_crystals); crystal(S, around(d.pos, st.unique_nattblom_crystal_radius / 10), durOf(X), X, xs.frost_wall_maximum_life); }
  }
  // Mirror of Refraction: while it is on, a mirror appears in your Presence every its interval, up to its most, for its
  // duration. A spell projectile that hits one shatters it, copying the projectile in a nova of its number around it;
  // the copies can shatter other mirrors in turn
  const MIRROR = new THREE.BoxGeometry(.5, .9, .05);
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
  K.bonestorm = S => {
    const st = S.dmg.stats, X = partOf(S, 'BonestormExplosionPlayer') || S, xs = X.dmg?.stats || {}, h = hand();
    const n = Math.min(st.base_number_of_allowed_bone_storm_projectiles || 1, Math.max(1, Math.floor((S.held || 0) / SIM.channelTick)));
    const r = S.spent ? (X.A + (xs['bone_spear_power_charged_aoe_+'] || 0) / 10) * Math.sqrt(1 + (S.spent - 1) * (xs['bone_spear_power_charged_aoe_+%_final_per_additional_power_charge'] || 0) / 100) : X.A;
    const foes = nearest(S.at, n, d => dist(d.pos, S.at) <= (st.bone_spear_target_rectangle_length || 0) / 10);
    for (let k = 0; k < n; k++) later(k * .04, () => {
      const d = foes[k % (foes.length || 1)], q = d && !d.dead ? { x: d.pos.x, z: d.pos.z } : around(S.at, 1);
      fx.streak(h, V(q.x, .3, q.z), 'physical', .12, .04, 1); later(.12, () => { pop(q, r, 'physical'); boom(q, r, { ...X, mult: S.mult }, { noPay: k > 0 }); });
    });
  };
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
      limit(o => o.espear, st.base_number_of_remote_spear_mines_allowed);
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
        fx.ring(c, .3, X.A, 'ice', .35); boom(c, X.A, { ...X, self: e, gains: [...ail].map(el => ({ el, pct: xs['tempest_bell_physical_damage_%_as_elemental_per_ailment'] })) }, { soft: true });
        if (++hits >= st.bell_hit_limit) e.dead = true;
      } });
  };
  // Disengage: its cone of spearpoints in front of you (its radius, its angle) as you leap back its path distance; each
  // Parried enemy it hits has the debuff consumed for its shockwave part and grants you its Frenzy Charges
  K.disengage = S => {
    const st = S.dmg?.stats || {}, c = { x: pp.x, z: pp.z }, R = st.disengage_cone_radius / 10, X = partOf(S, 'DisengageShockwavePlayer'), half = coneHalf({ cone: st.disengage_cone_angle });
    const parried = inside(c, R).filter(d => time < d.parried?.until && inCone(c, Math.atan2(S.dz, S.dx), half, d.pos));
    K.sweep({ ...S, from: c, R, cone: st.disengage_cone_angle });
    for (const d of parried) { d.parried = null; if (X) boom({ x: d.pos.x, z: d.pos.z }, X.A, X); for (let k = st.consume_parry_debuff_on_hit_to_gain_X_frenzy_charges; k > 0; k--) chargeBy('frenzy', S); }
    const l = st.leap_maximum_allowed_path_distance / 10;
    move = { from: c, to: { x: c.x - S.dx * l, z: c.z - S.dz * l }, k: 0, dur: .3, h: 1.2, S, seen: new Set() };
  };
  // Devour: a corpse or a Cullable enemy (culled) at the target and up to its number of other corpses within its area
  // there, each restoring its life and granting a Power Charge; one beyond your reach and within its dash range you leap
  // to, hitting its area where you land
  // note: over how long its life is regenerated is not in the data; at once here
  K.devour = S => {
    const st = S.dmg?.stats || {}, C = { ...S, P: { ...S.P, culls: true } }, e = corpseAt(S.at, SIM.snap) || near(S.at, SIM.snap, d => cullable(d, C));
    if (!e) return toast(t('{0} needs a corpse: kill an enemy or press C', S.label));
    const p = { x: e.pos.x, z: e.pos.z }, l = dist(p, pp), reach = meleeR(S) + SIM.body;
    const eatAll = () => [e, ...corpses(p, S.A).filter(d => d !== e).slice(0, st.wyvern_devour_max_extra_corpses_to_consume)].forEach(d => {
      if (d.corpse > 0) eat(d, S.el); else if (!cull(d, C)) return;
      me.life = gain(me.life, me.maxL, st.wyvern_devour_life_restoration); chargeBy('power', S);
    });
    if (l <= reach) eatAll();
    else if (l <= reach + st.base_melee_dash_range / 10) move = { from: { x: pp.x, z: pp.z }, to: p, k: 0, dur: .35, h: 1.6, S, seen: new Set(), land: at => { boom(at, S.A, S); eatAll(); } };
  };
  // Thrashing Vines: its growth area at the target (its limit, its duration), a vine crashing in it every its share of the
  // cast time, onto an enemy in it if there is one, hitting its secondary area
  K.vines = S => {
    const st = S.dmg?.stats || {}, c = { ...S.at }, R = S.A, r = radOf(S), every = (S.dmg?.speed ? 1 / S.dmg.speed : SIM.castTime) * st['awakened_forest_spawn_vines_per_X%_cast_time'] / 100;
    const was = objs.find(o => o.forest && o.name === S.name && !o.dead && dist(o.c, c) <= R); if (was) { was.s = 0; return; }   // sustained: the same area goes on
    limit(o => o.forest && o.name === S.name, st.base_number_of_awakened_forests_allowed);
    const ring = fx.decal(c, R, 'outline', 'poison', { a: .35, rot: 0 }); let k = 0;
    planted(thing(holder(c), durOf(S), { name: S.name, forest: true, plant: S, c, R, off: () => ring.remove(), tick(dt, e) {
      presence(e);
      if ((k -= dt) > 0) return; k = every;
      const d = near(c, e.R), q = d ? { x: d.pos.x, z: d.pos.z } : around(c, e.R);
      fx.pillar(q, r * .4, 2.4, 'poison', .3, 2); later(.2, () => boom(q, r, { ...S, mult: S.mult * (e.more || 1) }, { soft: true }));
    } }));
  };
  // Cross Slash: two gouges in front of you, each its angle apart across your aim, its length and its secondary width,
  // each hitting on its own, as you leap back its offset; a Marked enemy hit by both has its Mark activated and takes the
  // shockwave (its part) after its delay. The Ice Fragments within its search radius are pulled into where the gouges
  // cross (where you stood) and explode at once. note: the overshoot of their pull is a look the data does not explain
  K.cross = S => {
    const st = S.dmg?.stats || {}, c = { x: pp.x, z: pp.z }, w = radOf(S), a0 = Math.atan2(S.dx, S.dz), half = st.wolf_cross_slash_angle / 2 * Math.PI / 180, X = partOf(S, 'WolfCrossSlashMarkConsumedPlayer'), both = new Map();
    for (const sgn of [-1, 1]) {
      const a = a0 + sgn * half, b = { x: c.x + Math.sin(a) * S.A, z: c.z + Math.cos(a) * S.A };
      fx.strip(c, b, w * 2, S.el, .4, { a: .7 });
      for (const d of dummies) if (!d.dead && segDist(d.pos, c, b) <= w + SIM.body) { hit(d, S); both.set(d, (both.get(d) || 0) + 1); }
    }
    for (const [d, n] of both) if (n === 2 && d.mark && !d.dead) { markOff(d); if (X) later(st.wolf_pounce_mark_shockwave_delay_ms / 1000, () => boom({ x: d.pos.x, z: d.pos.z }, X.A, X)); }
    for (const F of frags.filter(F => dist(F.p, c) <= st.ice_chunk_refire_search_radius / 10)) {
      frags = frags.filter(f => f !== F); F.dec.remove();
      lob(fx.orb('cold', .1), new THREE.Vector3(F.p.x, .3, F.p.z), new THREE.Vector3(c.x, .1, c.z), .2, .5, () => { pop(c, F.R, 'ice'); F.go(c); });
    }
    const l = st.wolf_cross_slash_offset / 10; move = { from: c, to: { x: c.x - S.dx * l, z: c.z - S.dz * l }, k: 0, dur: .2, h: .6, S, seen: new Set() };
  };
  // Unearth: its cone of bone spikes in front of you (its radius, its angle); each corpse in it becomes a Bone Construct
  // for its duration, up to its limit
  // note: larger corpses making more than one construct is not simulated
  K.unearth = S => {
    const st = S.dmg?.stats || {}, c = { x: pp.x, z: pp.z }, half = coneHalf({ cone: st.bone_cone_angle }), a0 = Math.atan2(S.dz, S.dx);
    K.sweep({ ...S, from: c, R: S.A, cone: st.bone_cone_angle });
    for (const d of corpses(c, S.A).filter(d => inCone(c, a0, half, d.pos))) {
      const p = { x: d.pos.x, z: d.pos.z }; eat(d, S.el);
      limit(o => o.kind === S.name, st.base_number_of_skeletal_constructs_allowed); minion(S, p, durOf(S), { kind: S.name });
    }
  };
  // Toxic Domain: its Toxic Bloom around you for its duration; in it you regenerate its life and your skills cost more
  // and your projectile attacks attach its Toxic Pustules (thornHit)
  K.domain = S => {
    const st = S.dmg?.stats || {}, c = { x: pp.x, z: pp.z }, ring = fx.decal(c, S.A, 'patch', 'poison', { a: .3, k: 1 });
    limit(o => o.banner && o.name === S.name, 1);
    thing(holder(c), durOf(S), { name: S.name, banner: { life_regeneration_per_minute: st['toxic_domain_healing_per_minute_+'], 'toxic_domain_mana_cost_+%': st['toxic_domain_mana_cost_+%'] }, domain: S, R: S.A, c, off: () => ring.remove() });
    fx.ring(c, .2, S.A, 'poison', .45); say(t('{0} active', S.label), 'poison');
  };
  // Ice Shards: each bolt of its clip strikes the ground at the target (its hit there) and leaves a shard, up to the
  // shards' limit, that arms after its time and explodes (its part) when an enemy comes within its detection radius;
  // armed longer, more damage, up to its more after its bonus delay. note: the data has no time a shard lasts (the
  // scene's) nor how its more grows (here evenly over the delay), and the bolt's hit covers the scene's half metre
  K.shards = S => {
    const X = partOf(S, 'IceShardsShardPlayer'), xs = X?.dmg.stats, c = around(S.at, .5); if (!X) return;
    fx.streak(hand(), V(c.x, .1, c.z), 'cold', .1, .04, 1); boom(c, .5, S, { soft: true });
    limit(o => o.hazard && o.name === S.name, xs.permafrost_shard_limit);
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
        limit(o => o.stormblast, st.stormblast_bolts_maximum_active_bolt_count);
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
  // its second duration). note: the projectile's own path hits are not simulated, only its landing
  K.lance = S => {
    const I = S.spent && partOf(S, 'StormLanceInfusedPlayer'), X = I ? { ...I, mult: S.mult } : S, st = X.dmg.stats, c = { ...S.at }, R = radOf(S);
    limit(o => o.lanceOf === S.name, S.dmg.stats.base_number_of_overcharged_spears_allowed);
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
    const c = { x: m.pos.x, z: m.pos.z }, ring = fx.decal(c, S.A, 'outline', 'blood', { a: .4, rot: 0 }); m.dead = true;
    limit(o => o[tag], max);
    fx.pillar(c, .3, 2.2, 'blood', .5, 2); thing(holder(c), durOf(S), { [tag]: S.dmg.stats, R: S.A, off: () => ring.remove() }); say(t('{0} active', S.label), 'blood');
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
  function fallen(S, e) {
    me.fallen.push({ name: S.name, life: e.segs[0].max });
    const G = onS('Grim Feast'), s = G && rstats(G);
    if (s && dist(pp, e.pos) <= sheet().overgrow.r && Math.random() * 100 < s['grim_remnant_chance_to_spawn_orb_on_minion_death_in_presence_%']) remnant({ ...G, store: e.segs[0].max * s['grim_remnant_health_stored_in_globe_%'] / 100 }, e.pos);
  }
  function grim(S) {
    let n = me.grim, k = 0; me.grim = 0;
    me.fallen = me.fallen.filter(f => { const X = onS(f.name); if (!X || f.life > n) return !!X; n -= f.life; k++; tog[f.name].objs.push(minion(X, around(pp, 1.5), Infinity)); return false; });
    fx.ring(pp, .3, 2, 'chaos', .5); say(t('{0}: {1} Revived', S.label, k), 'chaos');
  }
  // Wither: channelled, its area drifts toward where you aim at its speed; each use Withers the enemies in it
  K.wither = S => {
    const st = S.dmg.stats, W = me.wither, c = W && time - W.t < .5 ? W : { x: S.at.x, z: S.at.z }, l = dist(c, S.at), v = Math.min(l, st.wither_channeled_move_targeting_area_X_units_per_second / 10 * (time - (W?.t ?? time)));
    if (l > .01) { c.x += (S.at.x - c.x) / l * v; c.z += (S.at.z - c.z) / l * v; }
    c.t = time; me.wither = c; fx.ring(c, .2, S.A, 'chaos', .3, { a: .4 });
    for (const d of inside(c, S.A)) withers(d, st.active_skill_withered_base_duration_ms / 1000, st['chaos_damage_taken_+%']);
  };
  // Entangle: a fissure crawling from you toward your aim, its radius long, hitting along it; a plant lasting its duration,
  // up to its most at once. Every its interval a vine (its part) lashes at an enemy within the part's radius of it, up to
  // their most at once, hitting and slowing it per vine for the vine's duration. Overgrown: more vines, and its duration
  // runs slower
  K.entangle = S => {
    const st = S.dmg.stats, X = partOf(S, 'EntangleVinePlayer'), xs = X.dmg.stats, ang = Math.atan2(S.dx, S.dz), a = { x: pp.x, z: pp.z }, b = { x: a.x + Math.sin(ang) * S.A, z: a.z + Math.cos(ang) * S.A }, dur = durOf(S);
    limit(o => o.entangle && o.name === S.name, st.base_number_of_entangle_roots_allowed);
    fissure(S, a, ang, S.A, radOf(S), 1, { dur, max: st.base_number_of_entangle_roots_allowed });
    let k = 0, vines = [];
    planted(thing(holder(a), dur, { name: S.name, entangle: true, plant: S, c: { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, R: S.A / 2, tick(dt, e) {
      presence(e); if (e.overgrown) e.s += dt * st['entangle_duration_speed_+%_when_wet'] / 100;
      if ((k -= dt) > 0) return; k = st.entangle_apply_vines_every_X_ms / 1000;
      vines = vines.filter(v => v.until > time);
      if (vines.length >= xs.entangle_vines_maximum_number_of_vines_allowed + (e.overgrown ? xs.entangle_vines_additional_number_of_vines_allowed_when_wet : 0)) return;
      const d = dummies.filter(d => !d.dead && segDist(d.pos, a, b) <= X.A + SIM.body).sort((p, q) => p.slows.length - q.slows.length)[0]; if (!d) return;
      const v = { until: time + xs.entangle_vine_duration_ms / 1000, pct: xs['entangle_base_movement_speed_+%_final_per_applied_stack'] }; vines.push(v); d.slows.push(v);
      fx.streak(V(d.pos.x, 0, d.pos.z), V(d.pos.x, 1.2, d.pos.z), 'poison', .14, .05, .6); hit(d, X);
    } }));
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
    d.slows.push({ until: time + HINDER.time, pct: -HINDER.slow });
  };
  // Demon Form: a shapeshift until used again, a skill that isn't a spell is used or you reach 1 Life; a Demonflame
  // each second in it (up to 10, its description), each its more spell damage and its Life lost per minute; its cast speed
  const demon = () => me.demon ? Math.min(10, Math.floor(time - me.demon.at)) : 0;
  const demonOff = () => { say(t('{0} off', me.demon.label), 'dust'); me.demon = null; };
  K.demon = S => { if (me.demon) return demonOff(); me.demon = { st: S.dmg.stats, at: time, label: S.label, name: S.name }; say(t('{0} on', S.label), 'fire'); };
  // Inevitable Agony: the enemies in its area record its share of the damage hits deal them, for its duration; once it
  // ends, or once what it recorded could kill them, they lose that much life at once
  K.agony = S => {
    const pct = S.dmg.stats['curse_pain_synchronisation_base_recorded_damage_%_to_apply'], until = time + durOf(S);
    for (const d of inside(S.at, S.A)) d.agony = { S, pct, until, n: 0 };
    fx.ring(S.at, .3, S.A, 'chaos', .5);
  };
  function agonyEnds(d) { const A = d.agony; d.agony = null; if (A.n > 0) { fx.ring(d.pos, .2, 1.2, 'chaos', .4); damage(d, A.n, { ...A.S, src: 'agony' }, false, true); } }
  // Ritual Sacrifice: a Rare (or Unique) monster's corpse at the cursor is consumed, else you stab yourself for its share
  // of your life; either way its buff, for its duration. note: the monster modifiers it grants are not in the scene
  K.sacrifice = S => {
    const d = corpseAt(S.at, Math.max(S.A, SIM.snap)), rare = d && POWER[d.stat.rarity] >= POWER.rare;
    if (rare) eat(d, 'blood'); else { me.life = Math.max(1, me.life - me.maxL * S.dmg.stats['head_hunt_%_life_to_remove_on_self_stab'] / 100); fx.emit(10, { p: { x: pp.x, y: 1.1, z: pp.z }, v: 1.5, up: 1, life: .4, size: .14, c: 'blood' }); }
    setBuff({ label: S.label, name: S.name, c: css('blood'), s: durOf(S) });
  };
  // Iron Ward: while on, it stores its share of the physical damage your armour mitigates, up to its most; used, a nova of
  // that stored damage, its area more by how full it is. note: the stored damage as it is, not scaled by the skill's modifiers
  K.iron = S => {
    const st = S.dmg.stats, n = me.iron || 0; if (!n) return toast(t('{0}: nothing stored', S.label));
    const R = S.A * Math.sqrt(1 + st['warding_steel_area_of_effect_+%_final_per_charge_%'] * n / st.warding_steel_maximum_stored_mitigated_physical_damage);
    me.iron = 0; boom({ x: pp.x, z: pp.z }, R, { ...S, els: ['physical'], el: 'physical', dmg: { ...S.dmg, hits: { physical: [n, n] } } });
  };
  // Time Freeze: time stops for the enemies in its area, for its duration. note: the shorter stop for an enemy stopped
  // before (within its resistance duration) is not sized in the data, nor do their ailments pause here
  K.tfreeze = S => {
    const dur = durOf(S); for (const d of inside(pp, S.A)) d.halt = time + dur;
    fx.ring(pp, .3, S.A, 'white', .7, { k: 2 }); say(t('{0} active', S.label), 'white');
  };
  // Pinnacle of Power: for its duration per power charge consumed, its more elemental damage per charge, and its
  // elemental ailments from every damage type (afflict)
  K.pinnacle = S => {
    const st = S.dmg.stats, n = S.spent, dur = n * st.elemental_power_buff_duration_per_power_charge_ms / 1000;
    me.pinn = { until: time + dur, more: n * st['elemental_power_elemental_damage_+%_final_per_power_charge'] }; setBuff({ label: S.label, name: S.name, c: css('gold'), s: dur });
  };
  // Charged Staff: consumes all power charges for stacks; using it again while it lasts adds to its stacks and duration
  const cstaff = S => S.P.attack && !S.src && time < me.cstaff?.until && me.cstaff;
  K.cstaff = S => {
    const on = time < me.cstaff?.until, n = S.spent;
    me.cstaff = { S, n: (on ? me.cstaff.n : 0) + n, until: (on ? me.cstaff.until : time) + n * S.dmg.stats.charged_staff_buff_duration_per_stack_ms / 1000 };
    setBuff({ label: S.label, name: S.name, c: css('lightning'), s: me.cstaff.until - time }); say(`${S.label}: ${me.cstaff.n}`, 'lightning');
  };
  // Galvanic Field: a buff that raises your shock chance; shocking an enemy consumes it to attach its orb to that enemy,
  // which fires a chaining bolt at an enemy within its secondary radius every beam delay until it expires
  // note: the buff's own duration is not in its data, it lasts until a shock consumes it
  K.galvanic = S => { me.galv = S; say(t('{0} active', S.label), 'lightning'); };
  function galvanic(d) {
    const S = me.galv, st = S.dmg.stats, m = fx.orb('lightning', .2); me.galv = null;
    limit(o => o.galvOf, st.galvanic_field_maximum_number_of_spheres);
    let tk = 0;
    thing(m, durOf(S), { galvOf: 1, name: S.name, tick(dt, e) {
      if (d.dead) { e.dead = true; return; }
      m.position.set(d.pos.x, 2.4, d.pos.z); if ((tk -= dt) > 0) return;
      const q = near(d.pos, radOf(S)); if (!q) return;
      tk = st.base_galvanic_field_beam_delay_ms / 1000; chain(m.position.clone(), q, { ...S, self: e, src: 'orb' }, st.number_of_chains);
    } });
  }
  // what the Banners you stand in grant: their buff's stat, summed
  const banner = k => objs.reduce((n, o) => n + (o.banner && !o.dead && dist(o.c, pp) <= o.R ? o.banner[k] || 0 : 0), 0);
  function untoggle(k) { const T = tog[k]; if (!T) return; T.decal?.remove(); T.objs.forEach(o => { o.dead = true; }); delete tog[k]; }

  // ---------- using a skill
  // what a use costs: mana (a channel's for one tick, or `held` s), and life
  function costOf(S, held) {
    const AM = archmage(S), per = S.dmg?.costPerSecond ? held ?? SIM.channelTick : 1, LP = S.dmg?.lifePerRecent;
    return { cost: (S.dmg?.cost || 0) * per * (S.costX || 1) * (1 + banner('toxic_domain_mana_cost_+%') / 100) + (AM ? me.maxM * AM.archmage_max_mana_permyriad_to_add_to_non_channelled_spell_mana_cost / 1e4 : 0),
      life: (S.dmg?.lifeCost || 0) * per + (LP ? me.maxL * Math.min(LP.max, LP.pct * used.filter(u => u.name === S.name && time - u.t <= RECENT).length) / 100 : 0) };
  }
  function use(i, o = {}) {
    let S = mk(i); if (!S) return false;
    const P = S.P, auto = !!o.src;
    if (!auto && stuck()) return false;   // frozen or heavily stunned, you cannot act
    // Forge Hammer: used again while its hammer is lodged, it recalls it (its Recall part, its more attack speed) and its
    // cooldown starts over
    const lodged = !auto && S.dmg?.stats?.forge_hammer_maximum_hammers && objs.find(o => o.earth && o.name === S.name && !o.dead);
    if (lodged) { recall(S, lodged); cdReady[S.name] = []; return true; }
    // a skill with a cooldown is used while one of its uses is left (Second Wind doubles them); each recharges over it
    const C = !auto && S.dmg?.cooldown, ready = C && (cdReady[S.name] = (cdReady[S.name] || []).filter(at => at > time));
    // one whose game text says a charge can bypass its cooldown (Ice-Tipped Arrows a Frenzy Charge, Fortifying Cry an
    // Endurance Charge: the charge its types say it consumes) spends one instead of waiting
    // (its only use of charges: none spent otherwise)
    const gi = C && api.info(S.g).gem, byCharge = /cooldown can be bypassed/.test(gi?.description || ''), wait = C && ready.length >= (S.dmg.uses || 1);
    // Enraged Warcry: a Warcry spends its Rage instead of the Endurance Charge
    const ER = wait && byCharge && S.dmg?.sum?.warcry_bypass_cooldown_spending_X_rage_instead_of_endurance_charge, RG = ER && me.rage >= ER;
    const BY = !ER && wait && byCharge && Object.keys(charges).find(c => gi.types?.includes(`SkillConsumes${c[0].toUpperCase() + c.slice(1)}ChargesOnUse`) && charges[c]);
    if (wait && !BY && !RG) return false;
    if (BY) { charges[BY]--; chargesSpent(1); say(t('{0} spends {1} charges', S.label, 1), 'gold'); }
    if (RG) { me.rage -= ER; say(`${S.label}: −${ER} ${t('Rage')}`, 'blood'); }
    Object.assign(S, o); if (o.more) S.mult *= o.more;
    aim(S, o.at || cursor);
    if (!auto && astral(S)) S.from = { ...S.at };   // Astral Projection: the Nova where you aim, not around you
    // Ixchel's Torment: a skill its meta gem triggers has its damage and area each somewhere between its less and more
    if (S.rand) { const pick = k => 1 + rnd(S.rand[`support_randomise_lower_${k}_+%_final`], S.rand[`support_randomise_higher_${k}_+%_final`]) / 100; S.mult *= pick('damage'); S.A *= Math.sqrt(pick('aoe')); }
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
      if (P.channel && !going) { chanInf[S.name] = S.infs; S.fresh = true; }
      const st = S.dmg?.stats || {}, arc = st['arc_damage_+%_final_from_infusion_consumption'], fs = st['firestorm_damage_+%_if_consumed_fire_infusion'];
      S.addChains = 0;
      if (arc && S.infs.includes('lightning')) { S.mult *= 1 + arc / 100; S.addChains = st.arc_chains_gained_from_infusion_consumption || 0; }
      // Spiral Volley: the frenzy charges it consumed, its more damage for consuming any and per charge, and its chains per charge
      const sv = S.spent && st['spiral_volley_damage_+%_final_when_frenzy_charges_consumed'];
      if (sv) { S.mult *= (1 + sv / 100) * (1 + S.spent * st['spiral_volley_damage_+%_final_per_frenzy_charge_consumed'] / 100); S.addChains = S.spent * st.spiral_volley_X_chains_per_frenzy_charge_consumed; }
      if (fs && S.infs.includes('fire')) S.mult *= 1 + fs / 100 * (S.dmg.incW?.fire ?? 1);   // "increased", against the skill's own
      if (!inhib && !byCharge) for (const c of P.spend) if (charges[c]) { const n = P.spendOne ? 1 : charges[c]; S.gm *= 1 + ((ch[c]?.per || 0) * n + (ch[c]?.when || 0)) / 100; S.spent += n; chargesSpent(n); charges[c] -= n; }
      if (S.spent) { say(t('{0} spends {1} charges', S.label, S.spent), 'gold'); }
      // Profanity: consumes up to its number of corpses within its distance of you, its more chaos damage if it did (I) or per corpse (II)
      const PF = !auto && S.dmg?.sum, PN = PF?.skill_consume_up_to_X_corpses_on_use, eaten = PN ? corpses(pp, PF.skill_consume_corpse_within_X_units_on_use / 10).slice(0, PN) : [];
      for (const d of eaten) eat(d, 'chaos');
      S.chaosX = eaten.length && 1 + ((PF['support_chaos_damage_+%_final_if_corpse_consumed_on_use'] || 0) + eaten.length * (PF['support_chaos_damage_+%_final_per_corpse_consumed_on_use'] || 0)) / 100;
      // Detonating Arrow: its share of damage as extra fire per stage. note: its explosion at maximum stages is not simulated
      const DA = st.detonating_arrow_max_number_of_stages; S.fireGain = DA && S.stage != null ? Math.round(S.stage * DA) * st['detonating_arrow_all_damage_%_to_gain_as_fire_per_stage'] : 0;
      if (S.stage != null && !P.ownStages) { S.mult *= st.flameblast_maximum_stages ? 1 + blast(S) * st['charged_blast_spell_damage_+%_final_per_stack'] / 100 : DA ? 1 : 1 + 2 * S.stage; if (S.perfect) { if (!S.dmg?.parts?.SnipeExplosionPlayer) { S.mult *= 1.5; S.aoe = true; } fx.text({ x: pp.x, y: 2.6, z: pp.z }, t('Perfect timing!'), css('gold')); } }
      if (P.channel && !P.stages) S.mult *= SIM.channelHit;
      facing = Math.atan2(S.dx, S.dz); castAt = time; player.cast(1); player.setColor(S.el); goal = null; walk = false;
      if (P.absorbs) S = absorb(S, pp, 1);
      // what was waiting for this skill: an element from a buff, the aftershock of a warcry, the repeats of Barrage / Unleash
      const hits = !NOHIT.has(S.kind), tally = () => empower.reduce((t, e) => t + 1 + (e.uses || 0), 0), had = tally();
      for (let k = empower.length - 1; k >= 0; k--) {
        const E = empower[k];
        if (E.type === 'infuse' && P.attack && hits) {
          S.els = [...new Set([...S.els, E.el])]; S.el = E.el; S.ail = [...new Set([...S.ail, ...ailOf([E.el])])]; empower.splice(k, 1);
          say(t('{0} gains {1} from {2}', S.label, t(cap(E.el)), E.label), E.el);
        } else if (E.type === 'cold' && P.attack && hits && S.dmg) {
          const h = S.dmg.hits.cold || [0, 0]; S.dmg = { ...S.dmg, hits: { ...S.dmg.hits, cold: [h[0] + E.add[0], h[1] + E.add[1]] } }; S.els = [...new Set([...S.els, 'cold'])]; if (P.slams) S.chillFor = E.chill;
          if (--E.uses <= 0) empower.splice(k, 1);
        } else if (E.type === 'echo' && P.attack && P.melee && hits) { S.echo = E.label; S.echoN = 1 + (P.slams ? E.slam : 0); if (--E.uses <= 0) empower.splice(k, 1); }
        else if (E.type === 'repeat' && P[E.flag]) { S.rep = E.n; S.repBy = E.label; S.repX = 1 - E.less / 100; empower.splice(k, 1); }
        else if (E.type === 'trisk' && P.spell && api.info(S.g).gem?.types?.includes('Cascadable')) { S.trisk = E; S.at = { x: pp.x, z: pp.z }; S.mult *= E.mult; S.A *= E.area; empower.splice(k, 1);
          const R = cdReady[E.name]; if (R?.length && S.dmg?.speed > 0) R[R.length - 1] += E.cd / 100 / S.dmg.speed; say(`${E.label}: ${S.label}`, 'fire'); }
        else if (E.type === 'mantra' && P.attack && P.melee && hits) { S.mantra = E; if (--E.uses <= 0) empower.splice(k, 1); }
        else if (E.type === 'temper' && P.attack && P.melee && hits) { S.combust = { T: E.T }; if (--E.uses <= 0) empower.splice(k, 1); }
        else if (E.type === 'wave' && P.attack && P.melee && hits) { const c = { ...S.at }; later(.15, () => boom(c, E.X.A, E.X)); if (--E.uses <= 0) empower.splice(k, 1); }
        // Ice-Tipped Arrows: its share of the attack's physical damage as cold (note: all of the hit's physical, its
        // modifiers kept: the weapon's base alone is not told apart here), its fragments on each hit (iceFrags)
        else if (E.type === 'icetip' && P.attack && P.ranged && hits && S.dmg) {
          const H = { ...S.dmg.hits }, ph = H.physical, cv = (E.cv ?? 100) / 100;
          if (ph) { const c = H.cold || [0, 0]; H.cold = [c[0] + ph[0] * cv, c[1] + ph[1] * cv]; H.physical = [ph[0] * (1 - cv), ph[1] * (1 - cv)]; if (cv >= 1) delete H.physical; }
          const { els, el, ail } = withEl(S, 'cold'); Object.assign(S, { els, el, ail, dmg: { ...S.dmg, hits: H } });
          S.icetip = fragsOf(S, E.X);
          say(t('{0} gains {1} from {2}', S.label, t('Cold'), E.label), 'cold'); if (--E.uses <= 0) empower.splice(k, 1);
        }
        else if (E.type === 'bounty' && S.kind === 'projectile') { S.addProj = E.add; S.G = { ...S.G, speed: (S.G?.speed || SIM.projSpeed) * (1 + E.speed / 100) }; empower.splice(k, 1); say(`${E.label}: ${S.label}`, 'gold'); }
        else if (E.type === 'spark' && P.attack) { K.projectile({ ...E.X, from: S.from, dx: S.dx, dz: S.dz, P: { ...E.X.P, wander: true } }); if (--E.uses <= 0) empower.splice(k, 1); }
      }
      // Empowered (it took something waiting for it): Premeditation's more damage, Unerring Power's less cost and more Accuracy
      if (tally() < had) { const F = S.dmg?.finals || {}; S.mult *= 1 + (F['support_empowered_damage_+%_final'] || 0) / 100;
        S.costX = 1 + (F['support_discount_skill_cost_+%_final_if_empowered'] || 0) / 100; S.accX = 1 + (F['support_discount_accuracy_rating_+%_final_if_empowered'] || 0) / 100; }
      // Escape Shot: its arrow makes its Ice Fragments where it hits (its fragment part, iceFrags)
      const ES = !S.icetip && partOf(S, 'EscapeShotIceFragmentPlayer'); if (ES) S.icetip = fragsOf(S, ES);
      // Unleash (Zarokh's Revolt): a spell gains a Seal every its % of its cast time, up to its most; casting it breaks them,
      // each repeating it its times with its less damage
      const SU = S.dmg?.sum, SL = !auto && P.spell && SU?.base_maximum_seals_for_skill;
      if (SL) {
        const every = SU['support_%_of_total_cast_time_as_base_skill_seal_gain_interval'] / 100 / (S.dmg.speed || 1 / SIM.castTime), n = Math.min(SL, Math.floor((time - (me.sealAt[S.name] ?? -Infinity)) / every));
        me.sealAt[S.name] = time;
        if (n > 0) { S.rep = (S.rep || 0) + n * SU.skill_rapid_fire_repeats_per_broken_seal; S.repBy = t('Seal') + ` ×${n}`; S.repX = 1 + SU['support_spell_rapid_fire_repeat_use_damage_+%_final'] / 100; }
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
      if (!(Math.random() * 100 < (st['chance_to_not_consume_glory_%'] || 0))) me.glory[S.name] = Math.random() * 100 < (st['chance_to_retain_40%_of_glory_on_use_%'] || 0) ? GN * .4 : 0;
      hudT = 0;
    }
    const KA = !auto && P.melee && time < me.kaom?.until && me.kaom;
    if (KA && P.slams) { S.mult *= 1 + ANCESTRAL.slam / 100; S.A *= Math.sqrt(1 + ANCESTRAL.area / 100); }
    else if (KA && S.kind === 'strike') { S.addTargets = KA.more; S.kaom = KA; }
    // Echoing Cry: usable once you have travelled its distance since its last use
    const MV = !auto && S.dmg?.sum?.skill_unusable_until_moved_X_distance;
    const left = MV && MV / 10 - (me.trav - (me.travAt[S.name] ?? -Infinity));
    if (left > 0) { toast(t('{0}: move {1} m first', S.label, Math.ceil(left))); return false; }
    if (MV) me.travAt[S.name] = me.trav;
    const CB = S.dmg?.combo;
    if (!auto && CB?.need && comboNow(S) < CB.need) { toast(t('{0} needs {1} Combo', S.label, CB.need)); return false; }   // Combo Finisher
    if (!auto && me.maxM && !tog[S.name]) {
      const { cost, life } = costOf(S, o.held);
      if (cost > me.mana) { toast(t('Not enough mana for {0}', S.label) + ` (${Math.ceil(cost)})`); return false; }
      // a Runic Ward cost (Conductive Runes); Olroth's Hubris: its share of your maximum Ward more, added physical and
      // cold damage of their shares of it (its physical counts for freeze: afflict). note: added as they are, not scaled by the skill's modifiers
      const OH = S.dmg?.sum, WC = (S.dmg?.stats?._cost?.Ward || 0) + me.maxW * (OH?.['base_ward_cost_+_%_of_maximum_ward'] || 0) / 100;
      if (WC > me.ward) { toast(t('Not enough Runic Ward for {0}', S.label)); return false; }
      if (WC) spendWard(WC);
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
      me.mana -= cost * (shot ? 1 - S.dmg.sum['support_charged_shots_recover_%_mana_cost_on_use'] / 100 : 1); me.life -= life; if (cost > 0) for (const o of objs) if (o.spend && !o.dead && dist(o.c, pp) <= o.R) o.spend(cost); gainRage(sheet().rage?.gain.use); if (life > 0) gloryPaid('life', life, S.name);
      // Concoct / Ambrosia: the use consumes their share of your life / mana flask's most charges, for their more bleeding
      // effect / damage gained as lightning per charge consumed
      const flaskUse = (n, k, per) => { const f = flasks()[n], U = S.dmg?.sum || {}; if (!f || !U[k]) return 0; const c = Math.floor(Math.min(flaskLeft(n), f.max * U[k] / 100)); me.fl[n] -= c; return c * (U[per] || 0); };
      S.concoct = flaskUse(0, 'consume_%_of_maximum_life_flask_charges_on_skill_use', 'support_concoct_bleed_effect_+%_final_per_life_flask_charge_consumed');
      S.ambrosia = flaskUse(1, 'consume_%_of_maximum_mana_flask_charges_on_skill_use', 'gain_%_damage_as_lighting_per_mana_flask_charge_consumed');
      if (cost > 0) { fuelUp(S, cost); for (const k in tog) { const T = tog[k], j = T.manaPer ? trigOf(T) : -1; if (j >= 0) gainEnergy(T, cost / T.manaPer, j); } }   // Feral Invocation
    }
    // how far you moved and how long you stood still before this use (Momentum, Dauntless); Rageforged's Rage spent
    S.moved = me.walked || 0; S.still = time - (me.movedAt ?? -99); me.walked = 0;
    if (!auto && S.dmg?.enrage && me.rage >= S.dmg.enrage) { me.rage -= S.dmg.enrage; S.enraged = true; }
    // charges the supports consume on use (calc.js onUse): one each, all of them for Rally; Perpetual Charge may keep
    // them, Heightened Charges may double what they give; Medved's Felling costs life per 5 Rage
    const U = !auto && S.dmg?.onUse; nextCdX = 1;
    if (U) {
      const take = (c, every) => { const n = every ? charges[c] : Math.min(1, charges[c]); if (!n) return 0; if (!(Math.random() * 100 < U.keep)) charges[c] -= n; chargesSpent(n); return n * (Math.random() * 100 < U.double ? 2 : 1); };
      let n;
      if (U.speed && (n = take('frenzy'))) nextCdX = 1 + U.speed * n / 100;
      if (U.breakPct && (n = take('frenzy'))) S.breakPct = U.breakPct * n;
      if (U.crit && (n = take('power'))) S.critX = 1 + U.crit * n / 100;
      if (U.curse && (n = take('power'))) S.curseX = 1 + U.curse * n / 100;
      if (U.lifePerEndurance && (n = take('endurance', true))) me.life = Math.min(me.maxL, me.life + me.maxL * U.lifePerEndurance * n / 100);
      if (U.lifePerCooldown && C) me.life = Math.min(me.maxL, me.life + me.maxL * U.lifePerCooldown * C / 1000 / 100);   // Second Wind III
      if (U.lifePer5Rage) me.life = Math.max(1, me.life - me.maxL * U.lifePer5Rage * Math.floor(me.rage / 5) / 100);
    }
    if (C && !BY && !RG) ready.push(time + C / 1000);
    for (let k = !auto && S.dmg?.stats?.verisium_infusion_skill_number_of_verisium_infusion_to_grant || 0; k > 0; k--) infGain('verisium', pp);   // Powered by Verisium
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
    // note: which it takes first is the player's choice; Power Charges first here. The totem's life is not simulated
    const NC = !auto && S.dmg?.stats?.active_skill_requires_X_power_or_endurance_charges;
    if (NC) {
      const have = charges.power + charges.endurance; if (have < NC) { toast(t('{0} needs {1} charges and has {2}', S.label, NC, have)); return false; }
      const p = Math.min(NC, charges.power), st = S.dmg.stats; charges.power -= p; charges.endurance -= NC - p; chargesSpent(NC);
      S.totemMult = 1 + p * st['spell_totem_damage_+%_final_per_power_charge_consumed'] / 100; S.totemTime = 1 + (NC - p) * st['spell_totem_totem_duration_+%_final_per_endurance_charge_consumed'] / 100;
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
      const len = S.dmg.stats.statset_index_for_third_animation_combo_index != null ? 4 : 3, q = (me.seq ||= {})[S.name], n = q && time - q.at < SEQ_GAP ? q.n % len + 1 : 1;
      me.seq[S.name] = { n, at: time }; S.chain0 = S.dmg;
      if (n === len) { const X = partOf(S, Object.keys(S.dmg.parts)[0]); Object.assign(S, { dmg: X.dmg, el: X.el, els: X.els, ail: X.ail, final: true }); say(t('{0}: Final Strike', S.label), S.el); }
      else if (len === 4 && n === 3) S.times = 3;
    }
    // Volt: its Voltaic Charge from how far you moved since its last use (its gain a metre, up to its most), spent for
    // its share of damage as extra lightning per 10
    const su = S.dmg?.sum, VO = !auto && su?.support_static_charge_maximum_charge;
    S.volt = VO && Math.floor(Math.min(VO, (me.trav - (me.voltAt[S.name] ?? 0)) * su.support_static_charge_charge_gain_per_metre) / 10) * su['support_static_charge_%_damage_gained_as_lightning_per_10_charge'];
    if (VO) me.voltAt[S.name] = me.trav;
    const run = Object.keys(S.dmg?.stats || {}).some(k => k.startsWith('skeletal_chains_aoe_%_health_dealt_as_')) ? pact : K[S.kind] || K.area;
    run(S); whirl(S);
    // Raging Spirits: a fire spell you use yourself also summons them, one per its radius of the spell's area, up to its
    // most per use and its limit, for its duration
    const RS = !auto && S.P.spell && S.els.includes('fire') && onS('Raging Spirits'), rs = RS && RS.dmg.stats;
    if (RS) for (let k = Math.min(rs.skill_raging_spirits_max_per_action, Math.max(1, Math.floor(S.A * 10 / rs.skill_raging_spirit_per_x_radius))); k > 0; k--) {
      limit(o => o.kind === RS.name, rs.base_number_of_raging_spirits_allowed); minion(RS, around(pp, 1), durOf(RS), { kind: RS.name });
    }
    if (!auto && (P.slams || S.kind === 'warcry' || S.name === 'Shield Charge')) for (const o of [...objs]) if (o.segs && !o.dead) o.shatter(P.slams ? 'slam' : 'warcry');
    // Trickster's Shard: a spell you cast leaves a Fractured Mimic where you cast it, for its duration; at their limit they
    // all cast their spells, with their less damage, and are gone
    const TS = !auto && S.P.spell && S.dmg?.trig?.find(T => T.stats?.support_tricksters_shard_maximum_active_mimics);
    if (TS) {
      const M = me.mimics = me.mimics.filter(m => m.until > time), less = 1 + TS.support['skill_used_by_fractured_mimic_spell_damage_+%_final'] / 100;
      M.push({ S: { ...S, mult: S.mult * less }, run, until: time + (TS.shape?.duration || TS.stats.base_skill_effect_duration / 1000) }); fx.ring(S.from, .2, .8, S.el, .5);
      if (M.length >= TS.stats.support_tricksters_shard_maximum_active_mimics) { say(api.info({ name: TS.id }).label, S.el); for (const m of M.splice(0)) m.run(m.S); }
    }
    used.push({ name: S.name, elemental: S.elemental, cd: !!S.dmg?.cooldown, spell: !!S.P.spell, t: time }); while (used[0]?.t < time - 8) used.shift();   // the last 8 s (Uhtred's Constellation)
    if (S.echo) for (let k = 1; k <= S.echoN; k++) later(.42 * k, () => { say(t('Aftershock of {0} ({1})', S.label, S.echo), 'gold'); shake = Math.max(shake, .25); run({ ...S, mult: S.mult * .7, echo: null, spent: 0 }); });
    // Triskelion Cascade: the empowered spell cascades from you to its areas along three arms, its number on each
    if (S.trisk) for (let a = 0; a < 3; a++) for (let k = 1; k <= S.trisk.n; k++) { const q = a * TAU / 3 + facing, r = S.A * 2 * k; later(k * .12, () => run({ ...S, trisk: null, at: { x: pp.x + Math.sin(q) * r, z: pp.z + Math.cos(q) * r } })); }
    // Jagged Ground: a slam consumes its Endurance Charges for Jagged Ground in its area for its duration
    const JG = !auto && P.slams && su?.support_consume_X_endurance_charges_on_use;
    if (JG && charges.endurance >= JG) { charges.endurance -= JG; chargesSpent(JG); later(.12, () => ground('jagged', S.at, S.A, su.support_jagged_ground_base_duration_ms / 1000, S)); }
    if (!auto && P.spell) briar(S);
    // Charged Staff: your attacks while it lasts also send its lightning shockwave in its cone ahead
    const CW = cstaff(S) && partOf(me.cstaff.S, 'ChargedStaffShockwavePlayer');
    if (CW) { const a0 = Math.atan2(S.dz, S.dx), half = CW.dmg.stats.charged_staff_cone_angle * Math.PI / 360; fx.sector(pp, S.dx, S.dz, CW.A, half, 'lightning', .3, { grow: true, a: .6 }); for (const d of inside(pp, CW.A)) if (inCone(pp, a0, half, d.pos)) hit(d, { ...CW, mult: S.mult }); }
    // Spell Echo: the spell echoes its number of times at the same target after it, the echo with its increased area
    // note: the delay of an echo is not in its data, the scene's quarter second
    const SE = S.dmg?.sum?.support_spell_echo_number_of_echo_cascades;
    if (SE) for (let k = 1; k <= SE; k++) later(.25 * k, () => run({ ...S, A: S.A * Math.sqrt(1 + S.dmg.sum['echoed_spell_area_of_effect_+%'] / 100) }));
    // Spell Cascade: the spell also lands on either side of its target along a random axis, its number on each side, in its smaller area
    const SC = S.dmg?.sum?.support_spell_cascade_number_of_cascades_per_side;
    if (SC) { const q = Math.random() * TAU, A = S.A * Math.sqrt(1 + S.dmg.sum['support_spell_cascade_area_of_effect_+%_for_cascade'] / 100); for (const sd of [1, -1]) for (let k = 1; k <= SC; k++) { const r = sd * (S.A + A * (2 * k - 1)); later(k * .12, () => run({ ...S, A, at: { x: S.at.x + Math.sin(q) * r, z: S.at.z + Math.cos(q) * r } })); } }
    if (S.rep) { say(t('{0} repeats {1} times ({2})', S.label, S.rep, S.repBy), 'gold'); for (let k = 1; k <= S.rep; k++) later(k * .16, () => { player.cast(1); run({ ...S, rep: 0, mult: S.mult * S.repX, from: { x: pp.x, z: pp.z } }); }); }
    // an Orb of Storms nearby answers your spells with a bolt of its own ("when you cast a Spell near the Orb")
    if (!auto && S.P.spell) for (const ob of objs) if (ob.zap && !ob.dead && ob.name !== S.name && dist(ob.pos, pp) <= ob.r) ob.zap(true);
    return true;
  }
  // Glory (keywords.json): each skill that requires it builds its own, up to what it requires, from its Glorious actions:
  // the Power of the enemy (its % of it) once every 0.5 s per enemy, not while that skill is active (but a Banner), or
  // its % of the Ward or of the life you spend; it loses 2 a second after 15 s without gaining any, and is spent on use
  const SEQ_GAP = 2, PARRY_WAIT = 1, GLORY_EVERY = .5, GLORY_IDLE = 15, GLORY_LOSS = 2, ELEM = new Set(['fire', 'cold', 'lightning']);
  const trinity = () => onS('Trinity')?.dmg?.stats;
  const gst = S => ({ ...S?.dmg?.sum, ...S?.dmg?.stats }), spendWard = n => { me.ward -= n; gloryPaid('ward', n); };
  const gloryNeed = S => { const st = gst(S), n = st.active_skill_requires_X_glory; return n ? n * (1 + (st['support_glory_required_+%_final'] || 0) / 100) : 0; };
  const gloryOf = () => slots().map(base).filter(S => S && gloryNeed(S));
  function gloryAdd(S, n) {
    if (!(n > 0) || (/Banner/.test(S.name) ? !tog[S.name] : objs.some(o => o.name === S.name && !o.dead))) return;   // a Banner builds it while its Spirit is reserved
    const max = gloryNeed(S), v = me.glory[S.name] || 0; if (v >= max) return;
    me.glory[S.name] = Math.min(max, v + n); me.gloryAt[S.name] = time; hudT = 0;
  }
  function glory(d, ev) {
    for (const S of gloryOf()) {
      // its % of the enemy's Power, or a hundredth of its number whatever the enemy (Spear of Solaris' Ignite and Shock)
      const st = gst(S), mp = st[`active_skill_generates_mp_%_glory_per_${ev}`] || 0, flat = st[`active_skill_hundred_times_generates_glory_per_${ev}`] || 0;
      const seen = d.gloryAt ||= {}; if (!mp && !flat || time - (seen[S.name] ?? -9) < GLORY_EVERY) continue;
      seen[S.name] = time; gloryAdd(S, (mp * (POWER[d.stat.rarity] || 1) + flat) / 100);
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
    if (b && use(i)) cd = b.P.channel && !b.P.stages ? SIM.channelTick : useTime(b); else { cd = .3; held = null; }
  }
  // seconds between uses: the attack / cast speed of the build when calc.js knows it, else the scene default
  let nextCdX = 1;   // Ferocity: more skill speed for the use that consumed a frenzy charge
  // a crossbow fires its clip at its firing rate and reloads when the last bolt is gone (Ammo Conservation may keep one)
  const clips = {}, cdReady = {};
  const useTime = b => {
    const c = b.dmg?.clip, sp = c ? c.fire : b.dmg?.useTime ? 1 / b.dmg.useTime : b.dmg?.speed;   // with a cooldown: its own speed, the uses limit it
    let t = (sp > 0 ? clamp(1 / sp, .15, 3) : SIM.castTime) / nextCdX / regulate('frenzy', 'charge_mastery_skill_speed_+%_with_frenzy_charges') / (1 + (me.cad?.[b.name]?.n || 0) * (b.dmg?.sum?.['support_measured_speed_attack_speed_+%_final_per_stack'] || 0) / 100)
      / (me.demon && b.P.spell ? 1 + me.demon.st['demon_form_grants_cast_speed_+%'] / 100 : 1)
      // Medved's Felling: its attack speed per 5 Rage. note: the game adds it to the skill's increased attack speed, a factor of its own here
      / (1 + Math.floor(me.rage / 5) * (b.dmg?.sum?.['supported_skill_attack_speed_+%_per_5_rage'] || 0) / 100)
      // Rapid Casting III: its cast speed per different spell you cast in the last eight seconds
      / (1 + new Set(used.filter(u => u.spell && time - u.t <= 8).map(u => u.name)).size * (b.P.spell && b.dmg?.sum?.['cast_speed_+%_per_num_unique_spells_cast_in_last_8_seconds'] || 0) / 100);
    if (c && !(Math.random() < c.keep) && (clips[b.name] = (clips[b.name] ?? c.bolts) - 1) <= 0) { clips[b.name] = c.bolts; t += c.reload; reloads.push({ t: time + t, n: c.bolts }); gemini(); while (reloads[0]?.t < time - 8) reloads.shift(); }
    return t;
  };
  function press(i, key) {
    const b = slots().includes(i) && base(i); if (!b || move) return;   // what has a slot: by hand, Banners, Temporal Rift, Iron Ward
    held = null;
    if (b.P.stages && b.P.channel) { charge = { i, s: 0 }; held = { i, key }; return; }   // charge while held, release to fire
    if (b.P.toggle || b.kind === 'field') { use(i); return; }
    if (ONCE.has(b.kind)) { if (cd <= 0 && use(i)) cd = useTime(b); return; }
    held = { i, key };
    if (cd <= 0) fire(i);
  }
  function release() {
    const c = charge; charge = null; held = null;
    const RS = me.raised; me.raised = null;   // Raise Shield: its Shield Bash when released soon after a block
    if (RS && time - (RS.blocked ?? -9) <= RS.S.dmg.stats.raise_shield_base_retaliation_duration_ms / 1000 && near(pp, meleeR(RS.S) + SIM.body)) K.sweep({ ...RS.S, from: { x: pp.x, z: pp.z } });
    const P = c && base(c.i)?.P; if (!P) return;
    if (use(c.i, { stage: Math.min(1, c.s / (P.perfect ? 1 : 1.6)), perfect: P.perfect && Math.abs(c.s - 1) < .2, held: c.s })) cd = useTime(base(c.i));
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
    else if (c === K.swap && api.swapSet) { const n = api.swapSet(); fx.ring(pp, 1.2, .3, 'gold', .3); say(t('Weapon set {0}', n), 'gold'); }   // the game's weapon swap
    else if (c === K.roll) roll();
  });
  const rollHeld = () => keys[settings().keys.roll] || padWas[1];
  // the roll: where W A S D or the stick move you, else toward the cursor, as the game's
  const OWL = { every: 4, max: 3, proj: 2 };   // Primal Bounty's Owl Feathers (step, roll)
  function roll() {
    if (move || rollCd > 0 || stuck()) return;
    const fx0 = cursor.x - pp.x, fz0 = cursor.z - pp.z, l = Math.hypot(fx0, fz0);
    const dx = steer ? steer.x : l > .1 ? fx0 / l : Math.sin(facing), dz = steer ? steer.z : l > .1 ? fz0 / l : Math.cos(facing);
    move = { from: { x: pp.x, z: pp.z }, to: { x: pp.x + dx * 3.6, z: pp.z + dz * 3.6 }, k: 0, dur: .3, h: .25, roll: true }; rollCd = .7; me.sprint = null; facing = Math.atan2(dx, dz); charge = held = goal = null;
    fx.emit(10, { p: { x: pp.x, y: .1, z: pp.z }, r: .3, v: 1, up: .6, life: .6, size: .5, grow: 2, c: 'dust', smoke: true, a: .35 });
    event('dodge', near(pp, 30)?.pos || pp, NONE);
    const LI = onS('Lingering Illusion'); if (LI) illusion(LI, { x: pp.x, z: pp.z });
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
      case 'meta': case 'minion': case 'buff': break;
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
  let spdC = { at: -9, v: 0 };
  const spd = () => { if (time - spdC.at > .5) spdC = { at: time, v: api.playerSpeed(banner('movement_speed_+%')) }; return spdC.v; };
  function drawHud() {
    const gems = api.build().gems, names = gems.map(g => g.name);
    for (const k in tog) if (!names.includes(k)) untoggle(k);
    let free = sheet().spirit ?? Infinity;
    gems.forEach((g, i) => {
      if (!always(g)) return;
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
      const poor = B && me.maxM && !tog[g.name] && costOf(B).cost > me.mana;   // not enough mana for it: greyed, as in the game
      return `<button class="s-slot${i === sel ? ' on' : ''}${tog[g.name] ? ' act' : ''}${GN && gl < GN || poor ? ' dim' : ''}" data-k="${k}" data-i="${i}" style="--c:${css(P.el)}">${inf.icon ? `<img src="${esc(inf.icon)}" alt="" draggable="false" onerror="this.remove()">` : ''}<span>${esc(inf.label.slice(0, 3))}</span>${GN ? `<i class="gl" title="${esc(t('Glory'))}">${gl}/${Math.ceil(GN)}</i>` : ''}<b>${keyLabel(k)}</b></button>`;
    }).join('') : `<span class="note">${t(gems.length ? 'No skill of the build is used by hand: they are always on.' : 'Add skills in the Skills tab.')}</span>`));
    put(buffEl, effects()); put(badEl, ailing());
    put(logEl, logs.filter(l => time - l.at < 9).map(l => `<div style="--c:${l.c}"${time - l.at > 5 ? ' class="old"' : ''}>${esc(l.text)}${l.n > 1 ? ` ×${l.n}` : ''}</div>`).join(''));
    keysText(); clogHtml(); targetHtml();
    // your life and energy shield (the left orb, energy shield as its ring), mana and the Spirit left unreserved (the right
    // one, with Rage), as the game shows them
    const c = sheet(), rm = rageMax(), pct = (a, b) => (b > 0 ? clamp(a / b, 0, 1) * 100 : 0).toFixed(1), row = (k, a, b) => `<div><span>${k}</span><b>${a}/${b}</b></div>`;
    put(lifeEl, `<div class="s-vtxt">${me.known ? row(t('Life'), short(Math.max(0, Math.ceil(me.life))), short(me.maxL)) : `<div><span>${t('Life unknown: the class base life is missing in the data')}</span></div>`}`
      + `${me.maxE > 0 ? row(t('Shield'), short(Math.max(0, Math.ceil(me.es))), short(me.maxE)) : ''}</div><div class="s-orb"><i style="height:${pct(me.life, me.maxL)}%"></i>${me.maxE > 0 ? `<u style="--p:${pct(me.es, me.maxE)}%"></u>` : ''}</div>`);
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
  // corner, the seconds left under it, its name over it
  const one = (img, c, title, n, s, bad) => `<span class="s-buff${bad ? ' bad' : ''}" style="--c:${c}" title="${esc(title)}">${img ? `<img src="${esc(img)}" alt="" draggable="false" onerror="this.remove()">` : `<i>${esc(title.slice(0, 2))}</i>`}${n ? `<em>${n}</em>` : ''}${s != null ? `<small>${Math.ceil(s)}s</small>` : ''}</span>`;
  function effects() {
    const b = [], icon = n => { const g = gemBy(n), inf = g && api.info(g); return inf ? inf.buff || inf.icon : ''; };
    for (const c in charges) if (charges[c]) b.push(one(api.chargeIcon?.(c), css(CHC[c]), `${t(CHARGE[c])} ${charges[c]}/${maxC(c)}`, charges[c]));
    for (const e in me.inf) { const q = infNow(e), I = api.infusion?.(e); if (q.length) b.push(one(I?.icon, css(INF_C[e]), I?.name || e, q.length, q[0] - time)); }
    for (const k in tog) { const T = tog[k]; b.push(one(icon(k), css(T.el), T.label, T.kind === 'meta' ? `${Math.floor(T.energy)}/${Math.ceil(T.need)}` : k === 'Trinity' ? [...ELEM].map(e => Math.floor(me.aff[e])).join('/') : k === 'Arctic Armour' ? Math.floor(me.arctic) : k === 'Wind Dancer' ? Math.floor(me.wind) : '')); }   // Trinity: its Affinity, fire / cold / lightning
    const sg = {}; for (const s of surges) if (s.until > time) (sg[s.name + s.el] ??= { s, n: 0 }).n++;
    for (const { s, n } of Object.values(sg)) { const I = api.info({ name: s.name }); b.push(one(I.icon, css(s.el), `${I.label}: ${t(s.el[0].toUpperCase() + s.el.slice(1))}`, n, s.until - time)); }
    if (sheet().owl) { const I = api.info({ name: 'Primal Bounty' }); b.push(one(I.icon, css('gold'), I.label, me.owls || 0)); }   // its Owl Feathers
    for (const E of empower) b.push(one(icon(E.name), css(E.el || 'gold'), E.label, E.uses > 1 ? E.uses : '', E.s));
    for (const B of buffs) b.push(one(B.img || icon(B.name), B.c, B.label, '', B.s));
    if (me.demon) b.push(one(icon(me.demon.name), css('fire'), me.demon.label, demon()));
    if (me.jade) b.push(one(icon('Encase in Jade'), css('cold'), t('Jade'), me.jade));
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
    for (const k in st) if (st[k] > 0) st[k] -= dt;
    for (const k in d.lock) d.lock[k] -= dt;
    for (const k in d.imm) d.imm[k] -= dt;
    for (let i = d.flam.length - 1; i >= 0; i--) if ((d.flam[i].s -= dt) <= 0) d.flam.splice(i, 1);
    // the bars empty after a while without buildup (monster.ot poise decay)
    if ((d.calm += dt) * 1000 > GAME.poise_decay_delay_ms) for (const k in d.bar) d.bar[k] = Math.max(0, d.bar[k] - GAME.poise_decay_per_second * dt);
    if (d.curse && (d.curse.s -= dt) <= 0) d.curse = null;
    if (d.mark && !(d.mark.hound && st.bleed > 0) && (d.mark.s -= dt) <= 0) {   // Bloodhound's Mark lasts while they bleed
      if (d.mark.bomb) markOff(d); else d.mark = null; }
    for (let i = d.dots.length - 1; i >= 0; i--) if ((d.dots[i].s -= dt) <= 0) d.dots.splice(i, 1);
    if (d.pustule) pustule(d, dt);
    if ((d.tick -= dt) <= 0) {   // damage over time: ignite, poison, bleeding and the skills' own, one number per tick
      d.tick = .5; let n = 0, past = 0, sim = false, el = 'chaos', best = 0;
      const add = (v, noEs) => { const k = v.dps * (v.agg ? AGGRAVATED : 1) * shocked(d); n += k; if (noEs) past += k; sim ||= v.sim; if (v.dps > best) { best = v.dps; el = v.el; } };
      for (const a in AIL_DOT) if (st[a] > 0 && d.burn[a]) add(d.burn[a], a !== 'ignite');
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
    const frozen = st.freeze > 0, e = f.sack.emissive;
    if (!frozen) { let a = Math.atan2(pp.x - d.pos.x, pp.z - d.pos.z) - f.group.rotation.y; a = Math.atan2(Math.sin(a), Math.cos(a)); f.group.rotation.y += a * Math.min(1, dt * 5); }   // they watch you
    d.lunge = Math.max(0, d.lunge - dt * 3.2);
    f.upper.rotation.x = frozen ? 0 : Math.sin(time * 22 + d.ph) * d.wob * .16 + Math.sin(d.lunge * Math.PI) * .42; f.upper.rotation.z = frozen ? 0 : Math.cos(time * 17 + d.ph) * d.wob * .1;
    f.ice.visible = frozen; f.curse.visible = !!d.curse; f.mark.visible = !!d.mark;
    if (d.curse) f.curse.rotation.y += dt * .8;
    if (d.mark) { f.mark.rotation.y += dt * 2.5; f.mark.scale.setScalar(1 + Math.sin(time * 5) * .08); }
    if (d.flash > 0) e.setRGB(.9, .3, .2).multiplyScalar(d.flash / .18);
    else if (st.ignite > 0) e.setRGB(.45, .13, 0); else if (st.shock > 0) e.setRGB(.12, .15, .4); else if (st.poison > 0 || d.dots.length) e.setRGB(.1, .28, .04);
    else if (st.chill > 0) e.setRGB(.05, .2, .35); else e.setRGB(0, 0, 0);
    const p = { x: d.pos.x, y: .9 * d.sc, z: d.pos.z };
    if (st.ignite > 0 && Math.random() < dt * 22) fx.emit(1, { p, r: .25, h: .8, v: .2, up: 1.8, life: .5, size: .32, c: 'fire', c2: 'ember' });
    if (st.shock > 0 && Math.random() < dt * 9) fx.emit(2, { p, r: .3, h: 1, v: 1.6, life: .18, size: .13, c: 'lightning', c2: 'white', k: 3 });
    if (st.poison > 0 && Math.random() < dt * 8) fx.emit(1, { p, r: .3, h: .8, v: .1, up: .8, life: .9, size: .16, c: 'poison' });
    if (st.bleed > 0 && Math.random() < dt * 8) fx.emit(1, { p, r: .25, h: .6, v: .3, life: .6, size: .1, c: 'blood', g: 9, k: 1.2 });
    if ((st.chill > 0 || frozen) && Math.random() < dt * 6) fx.emit(1, { p, r: .4, h: 1.2, v: .1, up: -.3, life: 1, size: .12, c: 'ice' });
    if (d.dots.length && Math.random() < dt * 9) fx.emit(1, { p, r: .3, h: 1, v: .2, up: .7, life: .8, size: .2, c: 'chaos' });
    const pips = Object.keys(PIP).filter(s => has(d, s)).map(s => css(PIP[s])); if (d.dots.length) pips.push(css('chaos'));
    const top = d === topD, sig = (top ? 'top' : Math.ceil(d.life / d.max * 48) + ':' + (d.maxEs ? Math.ceil(d.es / d.maxEs * 48) : '')) + pips.join('');
    if (sig !== d.sig) { d.sig = sig; f.draw(top ? { pips } : { life: d.life / d.max, es: d.maxEs ? d.es / d.maxEs : null, pips }); }
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
    put(tgtEl, `<div style="color:${RARE[d.stat.rarity] || RARE.normal}">${esc(d.mon.name)}</div><div class="s-tbar"><i style="width:${p(d.life, d.max)}%"></i>${d.maxEs > 0 ? `<u style="width:${p(d.es, d.maxEs)}%"></u>` : ''}<span>${short(Math.ceil(d.life + d.es))}/${short(d.max + d.maxEs)}</span></div><small>${t('Lv. {0}', d.level)}</small>`);
  }
  function hurt(n, chaos, el, crit, d) {
    if (!(n > 0)) return;
    if (me.st.shock > 0) { const k = 1 + me.mag.shock / 100; n *= k; chaos *= k; }   // shocked, you take more damage
    stats.taken += n; me.hurt = time; shake = Math.min(.45, shake + .1); gainRage(sheet().rage?.gain.hurt);
    const c = el === 'physical' ? 'blood' : el; record('taken', d?.mon.name || '?', '', n, css(c));
    if (Math.round(n) >= 1) fx.num({ x: pp.x + rnd(-.2, .2), y: 2.2, z: pp.z }, '−' + short(n) + (crit ? '!' : ''), css(c), crit ? .62 : .46, !!crit);
    fx.emit(6, { p: { x: pp.x, y: 1.1, z: pp.z }, v: 2.2, up: 1, life: .3, size: .12, c, c2: 'white', drag: 2 });
    if (!me.known) return;   // without the class base life there is no pool to empty: the numbers still show what gets through
    if (me.guard > 0) { const g = Math.min(me.guard, n), k = 1 - g / n; me.guard -= g; n *= k; chaos *= k; }   // a charm's guard takes it before anything
    // Loyalty: its share of a hit's damage taken from the life of the Companion of the skill it supports, before you
    const LY = d && objs.find(o => o.loyal && !o.dead && o.segs[0].life > 0);
    if (LY) { const k = LY.loyal / 100; LY.segs[0].hurt(n * k); n *= 1 - k; chaos *= 1 - k; }
    // energy shield takes the damage first; chaos damage removes twice as much of it
    const other = n - chaos, es0 = me.es; let e = Math.min(me.es, other), left = other - e; me.es -= e;
    e = Math.min(me.es, chaos * 2); me.es -= e; left += chaos - e / 2;
    // Barkskin: the energy shield enemy hits take gives its share as armour for its duration, stacking
    const BK = d && es0 > me.es && onS('Barkskin');
    if (BK) me.bark.push({ until: time + durOf(BK), v: (es0 - me.es) * BK.dmg.stats['barkskin_armour_to_gain_as_%_of_energy_shield_lost_to_enemy_hits'] / 100 });
    me.life -= left;
    // Runic Ward (keywords.json): damage that would take your life to 0 leaves you at 1, the ward taking the rest
    if (me.life < 1 && me.ward >= 1 - me.life) { spendWard(1 - me.life); me.life = 1; }
    if (me.life < 1 && time < me.sight) me.life = 1;   // Future-Past's Sight Beyond Sight
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
    if (N) hits.cold = N.thorns.map(x => x * (T.thornsX || 1));
    if (n) hits.physical = [0, 1].map(k => (hits.physical?.[k] || 0) + n * SP[k ? 'scavenged_plating_thorns_maximum_physical_damage' : 'scavenged_plating_thorns_minimum_physical_damage'] * (T.thornsX || 1));
    // Crackling Barrier: while you channel the skill it supports, its share of your maximum mana as lightning thorns
    const ci = held?.i ?? charge?.i, cb = ci != null && base(ci), CB = cb?.P.channel && cb.dmg?.sum?.['return_%_of_maximum_mana_as_lightning_damage_to_attacker_while_channelling'];
    if (CB) { const x = me.maxM * CB / 100 * (T.thornsX || 1); hits.lightning = [0, 1].map(k => (hits.lightning?.[k] || 0) + x); }
    return Object.values(hits).some(([, hi]) => hi > 0) ? { ...T, hits } : null;
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
  function arctic(d) {
    const S = arcticS(), n = Math.floor(me.arctic); if (!S || !n || d.dead) return;
    const st = S.dmg.stats; me.arctic--; fx.ring(pp, .2, 1.6, 'cold', .35);
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
    hit(d, thornX(D, t('Thorns')), { noPay: true }); me.quill = 0;
  }
  function thornHit(S, d) {
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
    E.next = time + E.cd; if (--E.uses <= 0) empower.splice(empower.indexOf(E), 1);
    const X = E.X, l = dist(d.pos, pp) || 1, k = 1 + Math.floor((sheet().armour || 0) / X.dmg.stats['dangerous_resolve_attack_damage_+1%_final_per_X_armour']) / 100;
    say(X.label, X.el); K.sweep({ ...X, mult: k, from: { x: pp.x, z: pp.z }, dx: (d.pos.x - pp.x) / l, dz: (d.pos.z - pp.z) / l, R: X.A, cone: X.dmg.stats.dangerous_resolve_cone_angle });
  }
  // Active Block: a readied Parry blocks the next blockable hit from within its distance (for projectiles or not) and
  // retaliates with its sweep, the enemy Parried for its duration (its more attack damage taken); a raised Shield blocks
  // every one, and released within its retaliation time after one it bashes the enemies close to you
  // note: how long a readied Parry waits for a hit is not in the data; PARRY_WAIT s here
  const blocked = d => { fx.ring(pp, .4, 1.1, 'white', .25, { a: .6 }); fx.text(above(), t('Blocked'), GREY, .32); event('block', pp, {}); record('avoid', d.mon.name, t('Blocked'), 0, GREY); };   // Cast / Curse on Block: its energy per block
  // Charge Regulation: while on, each kind of charge you have grants its buff (frenzy: its skill speed, power: its more
  // critical hit chance, endurance: its more armour, evasion and energy shield), and it consumes one of each every its interval.
  // note: its increased skill speed is applied as more here
  const regulate = (c, k) => { const v = charges[c] > 0 && onS('Charge Regulation')?.dmg.stats[k]; return 1 + (v || 0) / 100; };
  function regulation() {
    const st = onS('Charge Regulation')?.dmg.stats; if (!st) { me.regAt = null; return; }
    if (time - (me.regAt ??= time) < st.consume_frenzy_power_and_endurance_charge_every_x_ms / 1000) return;
    me.regAt = time; for (const c of ['frenzy', 'power', 'endurance']) if (charges[c] > 0) { charges[c]--; chargesSpent(1); }
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
  function activeBlock(d, a) {
    const P = time < me.parry?.until && me.parry.S, R = time < me.raised?.until && me.raised;
    if (!P && !R) return false;
    if (P) {
      const st = P.dmg.stats, far = (a.shape === 'projectile' ? st.base_maximum_active_block_distance_for_projectiles : st.base_maximum_active_block_distance_for_non_projectiles) / 10, l = dist(d.pos, pp) || 1;
      if (l > far + SIM.body * d.sc) return false;
      me.parry = null; K.sweep({ ...P, from: { x: pp.x, z: pp.z }, dx: (d.pos.x - pp.x) / l, dz: (d.pos.z - pp.z) / l });
      d.parried = { more: st['base_parry_buff_damage_taken_+%_final_to_apply'], until: time + st.base_parry_duration_ms / 1000 };
    } else { R.blocked = time; spray(d); }
    blocked(d); return true;
  }
  const seen = () => { const st = onS('Future-Past')?.dmg.stats; return !!st && time - me.fpAt >= st.base_skill_effect_duration / 1000; };   // Future-Past's Foresight
  function struck(d) {
    const a = d.atk; let c = withCharms(sheet());
    me.bark = me.bark.filter(b => b.until > time);   // Barkskin's armour, up to your armour items' own
    if (me.jade) c = { ...c, physDR: me.jade * c.jade.dr };   // Jade: its additional physical damage reduction a stack
    if (me.bark.length) c = { ...c, armour: (c.armour || 0) + Math.min(armourItems(api.build().items).armour, me.bark.reduce((t, b) => t + b.v, 0)) };
    if (d.dead || me.safe > 0 || !a.hasHit) return;
    // Future-Past: after its Hindsight (its duration) Hinekora's Foresight keeps the roll from avoiding hits; a hit while
    // rolling restores your life first and grants Sight Beyond Sight (its secondary duration: you cannot die), then
    // Hindsight again. note: her copy (foresight_clone_duration_ms) is a look the scene does not have
    const FP = onS('Future-Past'), foresight = seen();
    if (move && !move.S && !a.area && !foresight) return fx.text(above(), t('Dodged'), GREY, .32), record('avoid', d.mon.name, t('Dodged'), 0, GREY);   // the dodge roll avoids strikes and projectiles
    if (move && !move.S && foresight) { me.life = me.maxL; me.sight = time + FP.dmg.stats.base_secondary_skill_effect_duration / 1000; me.fpAt = time; say(FP.label, 'gold'); fx.glow({ x: pp.x, y: 1.2, z: pp.z }, 1.2, 'gold', .5); }
    if (!a.unblockable && activeBlock(d, a)) return;
    if (Math.random() * 100 >= hitChance(d.stat.accuracy * (d.st.blind > 0 ? 1 - BLIND.less / 100 : 1), (c.evasion || 0) * (me.st.maim > 0 ? 1 - MAIM.evasion / 100 : 1))) return fx.text(above(), t('Evaded'), GREY, .32), record('avoid', d.mon.name, t('Evaded'), 0, GREY);
    if (Math.random() * 100 < blockChance(c, a)) return blocked(d);
    // Seraph's Heart: while the buff it supports is on, its chance for the hit to treat your resistances as 90%
    const SH = 'support_seraphs_heart_enemy_hits_%_chance_to_treat_all_resistances_as_90%', SR = Object.keys(tog).map(onS).find(S => S?.dmg?.sum?.[SH]);
    if (SR && Math.random() * 100 < SR.dmg.sum[SH]) c = { ...c, res: Object.fromEntries(Object.entries(c.res || {}).map(([e, r]) => [e, { ...r, capped: 90 }])) };
    // Deflect (keywords.json): its chance like evasion's, your deflection rating against their accuracy; a deflected hit
    // deals its less damage
    const DF = c.deflect && deflection(c), dfl = DF > 0 && Math.random() * 100 >= hitChance(d.stat.accuracy * (d.st.blind > 0 ? 1 - BLIND.less / 100 : 1), DF);
    if (dfl) fx.text(above(), t('Deflected'), GREY, .32);
    // a curse that lowers their damage (Enfeeble)
    const crit = Math.random() * 100 < a.crit, cm = (dfl ? 1 - c.deflect.less / 100 : 1) * (crit ? 1 + a.critBonus / 100 : 1) * (1 + (d.curse?.C?.damage || 0) * (d.curse?.k || 0) / 100) * (d.intim > time ? 1 - INTIM / 100 : 1);   // and Intimidated ones
    let total = 0, chaos = 0, top = d.col, best = 0; const raw = {}, dealt = {}, IW = onS('Iron Ward')?.dmg.stats;
    for (const el in a.hits) {
      const [lo, hi] = a.hits[el]; let got = playerTakes(c, el, raw[el] = (lo + Math.random() * (hi - lo)) * cm);
      if (me.aegis > 0 && ELEM.includes(el)) { const k = Math.min(me.aegis, got); me.aegis -= k; got -= k; me.aegisAt = time; }   // Sorcery Ward
      if (el === 'physical' && IW) me.iron = Math.min(IW.warding_steel_maximum_stored_mitigated_physical_damage, (me.iron || 0) + (raw[el] - got) * IW['warding_steel_gains_%_of_damage_from_mitigated_physical_damage'] / 100);   // Iron Ward
      dealt[el] = got; total += got; if (el === 'chaos') chaos += got; if (got > best) { best = got; top = el; }
    }
    if (me.ghost >= 1) { me.ghost--; me.ghostAt = time; }   // Ghost Dance
    if (dealt.lightning > 0) valako(dealt.lightning);
    const RT = tempered(d); hurt(total * RT, chaos * RT, top, crit, d);
    if (me.sprint) { me.sprint = null; if (!sheet().noFall) suffer('stun', DUR.stun, { heavy: true }); }   // hit while sprinting, you fall over (SprintTutorialContent)
    if (me.safe > 0) return;   // not after the hit killed you
    resolve(d); if (a.melee) { retaliate(d); arctic(d); } windDance(); ailed(d, raw, dealt);
    for (const el of ['fire', 'cold', 'lightning', 'chaos']) if (raw[el] > 0) charmUse(el + '_damage_taken');
  }
  // What their hits do to you: GameConstants' ailment rules, from the hit's damage before your defences, against your
  // ailment, freeze and stun thresholds (calc.js ailmentDefence()), with the player's own durations (GameConstants <name>Player),
  // your chance to avoid each one and the chances of the monster's skill. Bleeding and poison need a chance of the skill.
  // Ignite, bleeding and poison deal their share of the hit per second (monsters.json constants); the strongest stays.
  // Heavy stun builds up from every hit, more from physical and melee ones (monster.ot), and lasts your own heavy stun time (character.ot).
  const PL = GAME.player || {};
  const frozen = () => me.st.freeze > 0, stuck = () => frozen() || me.st.stun > 0 || me.st.electrocute > 0, slowed = () => me.st.chill > 0 ? 1 - me.mag.chill / 100 : 1,
    maimed = () => me.st.maim > 0 ? 1 - MAIM.move / 100 : 1;   // maim slows only your movement
  function suffer(a, s, o = {}) {
    if (immune(a)) return;
    const fresh = !(me.st[a] > 0); me.st[a] = Math.max(me.st[a] || 0, s);
    if (o.mag) me.mag[a] = fresh ? o.mag : Math.max(me.mag[a] || 0, o.mag);
    if (o.dot && (fresh || o.dot.dps > (me.burn[a]?.dps || 0))) me.burn[a] = o.dot;
    if (!fresh) return;
    if (a === 'freeze' || a === 'stun' || a === 'electrocute') { held = charge = goal = null; walk = false; }   // they stop what you are doing
    if (a === 'freeze') { me.st.chill = 0; fx.emit(22, { p: { x: pp.x, y: 1, z: pp.z }, r: .3, v: 1.6, up: 1, life: .6, size: .16, c: 'ice', c2: 'white', g: 5 }); }
    fx.text(above(), t(a === 'stun' ? (o.heavy ? 'Heavy Stun' : 'Light Stun') : STATE[a]), css(PIP[a]), .34); fx.ring(pp, .2, 1, PIP[a], .3); hudT = 0;
    charmUse(a === 'stun' ? 'stunned' : a === 'maim' ? 'affected_by_slow' : 'affected_by_' + a);   // maim is a slow (its BuffDefinitions text)
  }
  function ailed(d, raw, dealt) {
    const D = sheet().ailments, A = d.atk.ail, x = e => raw[e] || 0, roll = c => Math.random() * 100 < c;
    if (!D?.ail || !me.known) return;
    const thr = Math.max(1, D.ail) * (1 + banner('ailment_threshold_+%_final') / 100), more = (inc, fin) => (1 + (A[inc] || 0) / 100) * (1 + (A[fin] || 0) / 100), can = a => !immune(a) && !roll(D.avoid[a]);
    const dot = (a, el, base) => ({ dps: base * GAME[a + '_per_minute'] / 6000, el });
    me.by = d;
    // freeze and electrocute build up against their thresholds; once one fills, it is harder to fill again for a while
    // (GameConstants <name>ThresholdModifier / <name>ModifierDuration, the player's where the game has its own)
    const build = (a, n, cap, dur) => {
      if (!(n > 0) || !cap || me.st[a] > 0) return;
      const G = a[0].toUpperCase() + a.slice(1), rule = k => PL[G + k] ?? GC[G + k];
      me.bar[a] = (me.bar[a] || 0) + n / (cap * (me.lock[a] > 0 ? 1 + rule('ThresholdModifier') / 100 : 1)) * 100; me.calm = 0;
      if (me.bar[a] < 100) return;
      me.bar[a] = 0; me.lock[a] = rule('ModifierDuration');
      if (can(a)) suffer(a, dur);
    };
    if (x('fire')) {   // flammability: each hit adds some for a while, the total is the chance to ignite you
      me.flam.push({ v: x('fire') / thr * GC.IgniteChanceMultiplier * more('ignite_chance_+%', 'active_skill_ignite_chance_+%_final'), s: PL.BaseFlammabilityDuration });
      if (roll(me.flam.reduce((t, f) => t + f.v, 0)) && can('ignite')) suffer('ignite', DUR.ignite * D.dur.ignite, { dot: dot('ignite', 'fire', x('fire') * D.eff.ignite) });
    }
    // a skill that shocks / chills as though dealing more damage (active_skill_<ailment>_as_though_damage_+%_final)
    const though = a => 1 + (A[`active_skill_${a}_as_though_damage_+%_final`] || 0) / 100;
    if (x('lightning') && roll(x('lightning') * though('shock') / thr * GC.ShockChanceMultiplier * more('shock_chance_+%', 'active_skill_shock_chance_+%_final')) && can('shock'))
      suffer('shock', PL.BaseShockDuration * D.dur.shock, { mag: GC.BaseShockMagnitude * D.eff.shock });
    if (x('cold') && !frozen()) {
      const mag = Math.min(GC.ChillMaxEffect, GC.ChillEffectMultiplier * x('cold') * though('chill') / thr * D.eff.chill);
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
    const melee = d.atk.melee, hard = Object.entries(dealt).reduce((t, [e, v]) => t + v * (e === 'physical' ? 1 + GAME.stun_physical / 100 : 1), 0)
      * (melee ? 1 + GAME.stun_melee / 100 : 1) * (1 + ((A['hit_damage_stun_multiplier_+%'] || 0) + (melee ? A['melee_hit_damage_stun_multiplier_+%'] || 0 : 0)) / 100)
      * (1 + (A['active_skill_hit_damage_stun_multiplier_+%_final'] || 0) / 100);
    me.stuns = me.stuns.filter(at => time - at < GAME.player_light_stun_repeat_ms / 1000);
    const stunChance = D.stun ? Math.min(100, hard / (D.stun * (1 + GAME.player_light_stun_repeat_pct * me.stuns.length / 100)) * 100) : 0;
    if (!frozen() && stunChance >= GAME.player_light_stun_min && roll(stunChance) && can('stun')) {
      me.stuns.push(time); suffer('stun', GAME.player_light_stun_ms / 1000 * D.dur.stun * (1 + (A['base_stun_duration_+%'] || 0) / 100));
    }
    if (x('physical') && roll((A['local_chance_to_bleed_on_hit_%'] || 0) + (A['main_hand_local_chance_to_bleed_on_hit_%'] || 0)) && can('bleed')) suffer('bleed', DUR.bleed * D.dur.bleed, { dot: dot('bleed', 'physical', x('physical')) });
    // maim on hit (the skill's or its main hand weapon's chance, with its increased chance)
    const maim = ((A['maim_on_hit_%'] || 0) + (A['main_hand_local_maim_on_hit_%'] || 0)) * (1 + (A['maim_chance_+%'] || 0) / 100);
    if (roll(maim) && can('maim')) suffer('maim', MAIM.time);
    const pois = (A['base_chance_to_poison_on_hit_%'] || 0) + (A[d.atk.attack ? 'chance_to_poison_on_hit_with_attacks_%' : 'spells_chance_to_poison_on_hit_%'] || 0);
    if ((x('physical') || x('chaos')) && roll(pois) && can('poison')) suffer('poison', DUR.poison * D.dur.poison, { dot: dot('poison', 'chaos', x('physical') + x('chaos')) });
  }
  // Flasks, as the game's: the build's life flask and mana flask (items.js flaskOf()), on 1 and 2, together before the skills.
  // One that applies its effect constantly recovers all the time and is not drunk.
  // A drink spends its charges and recovers its amount over its time; drinking again replaces the one in progress (note:
  // the tables do not say what a second drink does). Kills refill them, as the glossary (KeywordPopups Flask, Power) says:
  // half the monster's power for a normal one, all of it for a magic one, twice it for rare and unique ones, the power being
  // the rarity's 1 / 2 / 5 times the monster's own, and 20 for a unique (note: a monster's own power is not in the tables:
  // the glossary's average, 1, is used). Dying and refilling fill them, as a checkpoint or a well does.
  const POWER = { normal: 1, magic: 2, rare: 5, unique: 20 }, FLASK_GAIN = { normal: .5, magic: 1, rare: 2, unique: 2 };
  const flasks = () => sheet().flasks || [];
  const flaskLeft = n => { const f = flasks()[n]; if (!f) return 0; return me.fl[n] = Math.min(me.fl[n] ?? f.max, f.max); };
  const flaskName = n => t(n ? 'Mana Flask' : 'Life Flask');
  const flaskHeal = (f, n) => {   // life (and energy shield, when the build says so) or mana
    if (f.k === 'mana') return void (me.mana = gain(me.mana, me.maxM, n));
    me.life = gain(me.life, me.maxL, n); if (f.es) me.es = Math.min(me.maxE, me.es + n);
  };
  function drink(n) {
    const f = flasks()[n];
    if (!f) return toast(t('{0}: nothing equipped', flaskName(n)));
    if (f.always) return toast(t('{0} applies its effect constantly', flaskName(n)));
    if (flaskLeft(n) < f.per) return toast(t('{0} needs {1} charges and has {2}', flaskName(n), f.per, Math.floor(me.fl[n])));
    me.fl[n] -= f.per; me.drink[n] = { k: f.k, es: f.es, rate: f.amount / f.time, s: f.time };
    fx.ring(pp, .3, 1.2, f.k === 'life' ? 'blood' : 'arcane', .4); hudT = 0;
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
  const immune = a => me.cu.some(u => u && IMMUNE_TO[u.c.buff] === a);
  function charmUse(on) {
    charms().forEach((f, n) => {
      if (!f || f.on !== on || me.cu[n] || charmLeft(n) < f.per) return;
      if (!(Math.random() * 100 < f.keep)) me.cc[n] -= f.per;
      me.cu[n] = { c: f, s: f.time };
      if (f.life) flaskHeal({ k: 'life' }, f.life); if (f.mana) flaskHeal({ k: 'mana' }, f.mana); if (f.guard) me.guard = f.guard;
      const a = IMMUNE_TO[f.buff]; if (a) { me.st[a] = 0; delete me.burn[a]; delete me.mag[a]; me.bar[a] = 0; }
      say(t('{0} used', f.name), 'gold'); fx.ring(pp, .3, 1.3, 'gold', .4); hudT = 0;
    });
  }
  // the attack damage your Rage adds now (berserk's effect while it is on), and against what the skill's numbers assume
  const rageNow = () => { const R = sheet().rage; return me.rage * (100 + (R?.berserk && tog[R.berserk.name] ? R.berserk.effect : 0)) / 100; };
  const rageX = D => (1 + rageNow() / 100) / (1 + (D.rage || 0) * (100 + (D.rageEffect || 0)) / 1e4);
  // what buffs and ailments change right now, for the side panel (app.js onLive): each as [now, without them]
  // (null: the build cannot change it). Recovery: regeneration and the constant flasks, with the flasks being drunk;
  // damage over time: your ignite, bleeding and poison and the ground you stand in, after resistances and shock, as vitals() and tickHazards() deal it
  function live() {
    const c = sheet(), w = withCharms(c), act = stuck() ? 0 : slowed(), gain = buffs.find(b => b.gain)?.gain, R = c.rage;
    const rate = (k, on) => (on ? me.drink : flasks().filter(f => f?.always).map(f => ({ k: f.k, rate: f.amount / f.time }))).reduce((t, D) => t + (D?.k === k ? D.rate : 0), 0);
    const rec = k => { const r = (k === 'life' ? c.lifeRegen : c.manaRegen) || 0, own = r + rate(k); return [own + rate(k, true), own]; };
    let dot = 0;
    for (const a in me.burn) if (me.st[a] > 0) dot += playerTakes(w, me.burn[a].el, me.burn[a].dps, false);
    if (!(me.safe > 0)) for (const h of hazards) if (dist(h, pp) <= h.r) for (const el in h.dot) dot += playerTakes(w, el, h.dot[el], false);
    const bz = R?.berserk, raging = bz && tog[bz.name] && me.rage > 0 && time - me.raged <= R.delay;
    return {
      res: ['fire', 'cold', 'lightning', 'chaos'].map(e => [e, w.res?.[e]?.capped ?? 0, c.res?.[e]?.capped ?? 0]),
      move: [spd() * act * maimed(), spd()], action: [act * 100, 100], taken: [me.st.shock > 0 ? me.mag.shock : 0, 0],
      life: rec('life'), mana: rec('mana'), dot: [dot * (me.st.shock > 0 ? 1 + me.mag.shock / 100 : 1), 0],
      rage: rageMax() ? [rageNow(), 0] : null, ward: me.maxW ? [me.ward, 0] : null, guard: me.guard > 0 || charms().some(f => f?.guard) ? [me.guard, 0] : null,
      berserk: bz ? { v: [raging ? me.maxL * bz.lifePerRage / 100 * me.rage : 0, 0], name: api.info(api.build().gems.find(g => g.name === bz.name) || { name: bz.name }).label } : null,
      // the share of its damage per second a skill you use deals now: action speed, Rage on attacks, a mark's buff (not a
      // totem's or a minion's, nor one a meta gem uses: those act by themselves)
      dps: i => { const S = base(i), D = S?.dmg; return D && api.byHand(i) && !['totem', 'minion', 'raise'].includes(S.kind) ? act * (D.attack ? rageX(D) : 1) * (gain ? 1 + gain.pct / 100 : 1) : 1; },
    };
  }
  // your resistances with those of the charms in use
  function withCharms(c) {
    const MB = magma()?.dmg.stats['skill_igneous_shield_grants_block_chance_+%']; if (MB) c = { ...c, block: (c.block || 0) * (1 + MB / 100) };
    const AE = banner('armour_evasion_+%_final'), PL = plates() * (plating()?.['scavenged_plating_armour_+%_final_per_stack'] || 0), MR = banner('additional_maximum_all_elemental_resistances_%'), WE = Math.floor(me.wind) * (onS('Wind Dancer')?.dmg.stats['wind_dancer_evasion_rating_+%_final_per_stage'] || 0);
    const CR = regulate('endurance', 'charge_mastery_armour_evasion_energy_shield_+%_final_with_endurance_charges');
    const RA = banner('%_armour_to_apply_to_elemental_damage'), RE = banner('deflection_rating_%_of_evasion_rating');   // Refractive Plating
    if ((RA || RE) && c.deflect) c = { ...c, armourEl: Object.fromEntries(Object.entries(c.armourEl).map(([e, x]) => [e, x + (e === 'chaos' ? 0 : RA)])), deflect: { ...c.deflect, eva: c.deflect.eva + RE } };
    if (AE || MR || WE || PL || CR > 1) c = { ...c, armour: c.armour * (1 + AE / 100) * (1 + PL / 100) * CR, evasion: (c.evasion || 0) * (1 + AE / 100) * (1 + WE / 100) * CR, res: MR && c.res ? Object.fromEntries(Object.entries(c.res).map(([e, r]) => [e, e === 'chaos' ? r : { ...r, max: r.max + MR, capped: Math.min(r.max + MR, r.value) }])) : c.res };
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
    if (d.st.freeze > 0 || d.st.stun > 0 || d.st.electrocute > 0 || d.halt > time) { d.wind = null; return; }   // frozen, heavily stunned, electrocuted and time-stopped enemies cannot act
    // chill and a curse's slower actions (Temporal Chains) slow everything they do
    let k = (d.st.chill > 0 ? 1 - (d.mag.chill ?? CHILL_MIN) * d.stat.slowEffect / 100 : 1) * (1 + (d.curse?.C?.speed || 0) * (d.curse?.k || 0) / 100);
    if (k < 1) dt *= Math.max(SLOW_FLOOR, k);
    // Maim slows only their movement, a slow too: with chill, never under SLOW_FLOOR of their speed
    const ks = Math.max(SLOW_FLOOR, Math.min(1, k)), VS = (d.slows = d.slows.filter(u => u.until > time)).reduce((t, u) => t + u.pct, 0);   // its slows: Entangle's vines, Hinder
    const maim = Math.max(SLOW_FLOOR / ks, (d.st.maim > 0 ? 1 - (d.mag.maim ?? MAIM.move) * d.stat.slowEffect / 100 : 1) * (1 + VS * d.stat.slowEffect / 100));
    const SR = d.st.bleed > 0 && d.red;
    d.wait -= dt * (SR ? 1 + SR['bleeding_monsters_attack_speed_+%'] / 100 : 1);
    if (d.wind) { if ((d.wind.s -= dt) <= 0) { const w = d.wind; d.wind = null; w.land(); } return; }
    if (me.safe > 0) return;
    const far = dist(d.pos, pp), R = reachOf(d), v = (d.mon.speed || 0) / 10 * maim * (SR ? 1 + SR['bleeding_monsters_movement_velocity_+%'] / 100 : 1);
    if (far <= (d.mon.aggro || 0) / 10) d.aggro = true;
    const q = d.aggro && wallIn(d);   // a Shield Wall in the way: it walks to it and attacks it
    if (q) {
      const k = dist(d.pos, q.p), stop = q.r + SIM.body;
      if (k > stop && v > 0 && !(d.st.pin > 0) && !api.still?.()) { const m = Math.min(k - stop, v * dt) / k; d.pos.x += (q.p.x - d.pos.x) * m; d.pos.z += (q.p.z - d.pos.z) * m; }
      else if (d.wait <= 0 && k <= R + q.r && api.fight?.()) { d.wait = Math.max(.25, d.atk.period); d.lunge = 1; q.hurt(Object.values(d.atk.hits || {}).reduce((t, [lo, hi]) => t + (lo + hi) / 2, 0)); }
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
    const A = d.atk, used = (d.ready = (d.ready || []).filter(at => at > time)).length; d.ready.push(time + A.cooldown);
    d.wait = Math.max(.25, A.period, used + 1 < A.uses ? 0 : Math.min(...d.ready) - time); strike(d);
  }
  // your pools follow the build; life regenerates and the energy shield recharges after its delay without damage
  function vitals(dt) {
    const c = sheet(), L = c.life || 0, E = (c.es || 0) * (1 + banner('energy_shield_+%_final') / 100) * regulate('endurance', 'charge_mastery_armour_evasion_energy_shield_+%_final_with_endurance_charges'); me.known = c.life != null;
    if (L !== me.maxL) { me.life = me.maxL ? me.life / me.maxL * L : L; me.maxL = L; }
    if (E !== me.maxE) { me.es = me.maxE ? me.es / me.maxE * E : E; me.maxE = E; }
    const W = c.ward || 0; if (W !== me.maxW) { me.ward = me.maxW ? me.ward / me.maxW * W : W; me.maxW = W; }
    if (me.ward < W) me.ward = Math.min(W, me.ward + W * WARD_REGEN / 100 * dt);   // overflowed ward stays
    if (me.heat && time - me.heatAt > c.heat.delay) me.heat = Math.max(0, me.heat - dt / c.heat.rate);   // Heat cools off
    leylines(dt); bells(dt); mirrors(dt); jade(dt); if (me.locust && !me.sprint && time - me.locustAt > 4) me.locust = 0; boils(); attrition(dt); malice(); regulation();
    const TRF = onS('Temporal Rift')?.dmg?.stats;
    if (TRF && time - (me.riftAt ?? -99) >= TRF.temporal_rift_snapshot_interval / 1000) {
      me.riftAt = time; me.rifts.push({ x: pp.x, z: pp.z, life: me.life, mana: me.mana, es: me.es }); if (me.rifts.length > TRF.temporal_rift_maximum_snapshots) me.rifts.shift();
    }
    // Time of Need: while on, every its interval it heals its life and removes your elemental ailments
    // note: its interval is "modifiable", the cooldown recovery rate of the build is not applied to it here
    const TN = onS('Time of Need')?.dmg?.stats;
    if (TN && time - (me.needAt ??= time) >= TN.base_cooldown_modifiable_repeat_interval_ms / 1000) {
      me.needAt = time; me.life = Math.min(me.maxL, me.life + TN.skill_time_of_need_gain_x_life);
      for (const a of EL_AIL) { me.st[a] = 0; delete me.burn[a]; delete me.mag[a]; }
      fx.ring(pp, 1.5, .2, 'gold', .5); hudT = 0;
    }
    // Sorcery Ward: a barrier of its share of your armour and evasion taking the elemental damage of hits, back to full its
    // delay after it last took damage. Ghost Dance: a Ghost Shroud every its interval, up to its most; one is consumed when
    // you are hit, and having lost one recently you regenerate its share of your evasion as energy shield
    if (!onS('Future-Past')) me.fpAt = null; else me.fpAt ??= time;   // its Hindsight from when it is on
    // Blasphemy: while it is on, the curses socketed in it curse the enemies within their own area around you, at its less
    // effect. note: its own radius in the data (1 m) is not used: the curse's
    called();
    const BL = onS('Blasphemy');
    if (BL) api.build().gems.forEach((g, i) => {
      const S = g.meta === 'Blasphemy' && base(i), C = S?.dmg?.curse; if (!S) return;
      for (const d of inside(pp, S.A)) if (!(d.level > C?.maxLevel)) d.curse = { s: .2, label: S.label, C, k: (C?.effect ?? 1) * (1 + BL.dmg.stats['support_blasphemy_curse_effect_+%_final'] / 100) * d.stat.curseEffect };
    });
    // Her Declaration: while the buff it supports is on, an enemy that enters your Presence is Intimidated for its duration
    const HK = 'support_mothers_declaration_intimidate_enemies_when_they_enter_your_presence_base_duration_ms', HD = Object.keys(tog).map(onS).find(S => S?.dmg?.sum?.[HK]);
    for (const d of dummies) { const inP = !d.dead && dist(d.pos, pp) <= sheet().overgrow.r; if (HD && inP && !d.inPres) d.intim = Math.max(d.intim || 0, time + HD.dmg.sum[HK] / 1000); d.inPres = inP; }
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
      me.swarmAt = time; limit(o => o.kind === RS.name, rs.ravenous_swarm_maximum_swarm_count); minion(RS, around(pp, 1), durOf(RS), { kind: RS.name });
    }
    const SW = onS('Sorcery Ward')?.dmg.stats, GD = onS('Ghost Dance')?.dmg.stats;
    if (!SW) me.aegis = 0; else if (time - (me.aegisAt ?? -99) >= SW.aegis_recharge_delay_ms / 1000) me.aegis = ((c.armour || 0) + (c.evasion || 0)) * SW['aegis_unique_shield_max_value_from_%_armour_evasion'] / 100;
    if (!GD) me.ghost = 0; else {
      me.ghost = Math.min(GD.ghost_dance_max_stacks, (me.ghost || 0) + dt * 1000 / GD.base_cooldown_modifiable_repeat_interval_ms);
      if (time - (me.ghostAt ?? -99) <= RECENT) me.es = Math.min(me.maxE, me.es + (c.evasion || 0) * GD['skill_base_ghost_dance_grants_%_evasion_as_es_regeneration_per_minute_if_have_lost_ghost_dance_shroud_recently'] / 100 / 60 * dt);
    }
    if (me.demon) { me.life -= demon() * me.demon.st.demon_form_life_loss_per_minute_per_stack / 60 * dt; if (me.life <= 1) { me.life = 1; demonOff(); } }
    // Primal Bounty (Spirit Walker, OWL): an Owl Feather every 4 s (its % faster), up to 3 ("Gain a Primal Owl Feather every
    // 4 seconds, up to a maximum of 3", stat_texts owl_feather_max_bonus_to_stack)
    const OW = sheet().owl; if (OW) { me.owlT = (me.owlT || 0) + dt * (1 + OW.faster / 100); if (me.owlT >= OWL.every) { me.owlT = 0; if ((me.owls || 0) < OWL.max) { me.owls = (me.owls || 0) + 1; hudT = 0; } } }
    const MB = magma()?.dmg.stats; me.lava = MB ? Math.min(1, (me.lava || 0) + dt * 1000 / (MB.igneous_shield_charge_up_time_ms * (1 + MB['igneous_shield_charge_up_time_+%'] / 100))) : 0;
    for (const S of remnantSkills()) { const R = REMNANT[S.name], s = rstats(S); if (R.spawn && time - (remnantAt[S.name] ?? -99) >= R.spawn(s) / 1000) { remnantAt[S.name] = time; remnant(S, around(pp, s.breach_flame_spawn_radius / 10)); } }   // Flames, Blooms
    const SP = me.spectral; if (SP && time - SP.at >= SP.wait) { me.spectral = null; for (let k = 0; k < SP.n; k++) later(k * SP.every, () => { const X = { ...SP.S, spent: 0 }; aim(X, near(pp, 15)?.pos ?? { x: pp.x + SP.S.dx, z: pp.z + SP.S.dz }); K.projectile(X); }); }   // Spectral Volley
    const LR = banner('life_regeneration_per_minute'); if (LR) me.life = gain(me.life, me.maxL, LR / 60 * dt);
    const FC = banner('flask_charge_per_min'); if (FC) flasks().forEach((f, n) => { if (f) me.fl[n] = Math.min(f.max, flaskLeft(n) + FC / 60 * dt); });
    const WD = onS('Wind Dancer')?.dmg.stats; if (WD) me.wind = Math.min(WD.wind_dancer_maximum_number_of_stages, me.wind + dt * 1000 / WD.wind_dancer_stages_gained_every_x_ms);
    const AA = arcticS()?.dmg.stats; if (AA && time - (me.movedAt ?? -99) > .1) me.arctic = Math.min(AA.maximum_number_of_arctic_armour_stationary_stacks, me.arctic + dt * 1000 / AA.base_active_skill_buff_stack_gain_frequency_ms);
    const TR = trinity(); if (TR) for (const e of ELEM) if (time - (me.affAt[e] ?? -99) > TR.trinity_resonance_decay_delay_ms / 1000) me.aff[e] = Math.max(0, me.aff[e] - TR.trinity_resonance_loss_per_second * dt);
    for (const n in me.glory) if (time - (me.gloryAt[n] ?? -99) > GLORY_IDLE) me.glory[n] = Math.max(0, me.glory[n] - GLORY_LOSS * dt);
    me.safe = Math.max(0, me.safe - dt);
    for (const a in me.st) if (me.st[a] > 0) me.st[a] -= dt;
    for (const a in me.lock) me.lock[a] -= dt;
    for (let i = me.flam.length - 1; i >= 0; i--) if ((me.flam[i].s -= dt) <= 0) me.flam.splice(i, 1);
    // your freeze and stun bars empty after a while without buildup (character.ot poise decay)
    if ((me.calm += dt) * 1000 > GAME.player_poise_decay_delay_ms) for (const a in me.bar) me.bar[a] = Math.max(0, me.bar[a] - GAME.player_poise_decay_per_second * dt);
    if ((me.tick -= dt) <= 0) {   // ignite, bleeding and poison after your resistances (bleeding ignores armour), one number per tick
      me.tick = .5; let n = 0, chaos = 0, worst = 'fire', best = 0;
      for (const a in me.burn) if (me.st[a] > 0) {
        const B = me.burn[a], got = playerTakes(withCharms(c), B.el, B.dps, false) * .5;
        n += got; if (B.el === 'chaos') chaos += got; if (got > best) { best = got; worst = B.el; }
      }
      if (n > 0) hurt(n, chaos, worst, false, me.by);
    }
    const p = { x: pp.x, y: .9, z: pp.z }, S = me.st;
    if (S.ignite > 0 && Math.random() < dt * 22) fx.emit(1, { p, r: .25, h: .8, v: .2, up: 1.8, life: .5, size: .32, c: 'fire', c2: 'ember' });
    if (S.shock > 0 && Math.random() < dt * 9) fx.emit(2, { p, r: .3, h: 1, v: 1.6, life: .18, size: .13, c: 'lightning', c2: 'white', k: 3 });
    if (S.poison > 0 && Math.random() < dt * 8) fx.emit(1, { p, r: .3, h: .8, v: .1, up: .8, life: .9, size: .16, c: 'poison' });
    if (S.bleed > 0 && Math.random() < dt * 8) fx.emit(1, { p, r: .25, h: .6, v: .3, life: .6, size: .1, c: 'blood', g: 9, k: 1.2 });
    if (S.stun > 0 && Math.random() < dt * 10) fx.emit(1, { p: { x: pp.x, y: 2.1, z: pp.z }, r: .35, v: .4, life: .5, size: .14, c: 'white', c2: 'gold' });
    if ((S.chill > 0 || S.freeze > 0) && Math.random() < dt * (S.freeze > 0 ? 20 : 6)) fx.emit(1, { p, r: .4, h: 1.2, v: .1, up: -.3, life: 1, size: .12, c: 'ice' });
    if (c.lifeRegen > 0 && me.life < L) me.life = Math.min(L, me.life + c.lifeRegen * (time < me.rip?.until ? 1 + me.rip.rate / 100 : 1) * dt);   // Rip's faster regeneration
    // leech recovers at its rate and is removed when the pool is full (Life Leech III's life leech is not)
    for (const [r, top] of [['life', L], ['mana', c.mana || 0]]) {
      const q = me.leech[r]; if (!(q.left > 0)) continue;
      if (me[r] >= top && !q.keep) { q.left = 0; continue; }
      const n = Math.min(q.left, q.rate * dt); q.left -= n; me[r] = Math.min(top, me[r] + n);
    }
    if (me.es < E && time - me.hurt >= (c.esDelay ?? 4)) me.es = Math.min(E, me.es + (c.esRecharge || 0) * dt);
    // mana regenerates; Rage regenerates from its gem while that is on, is lost once the delay passes without gaining
    // any, and Berserk costs life per Rage while Rage is not being lost
    const M = c.mana || 0;
    if (M !== me.maxM) { me.mana = me.maxM ? me.mana / me.maxM * M : M; me.maxM = M; }
    if (c.manaRegen > 0 && me.mana < M) me.mana = Math.min(M, me.mana + c.manaRegen * dt);
    me.drink.forEach((D, n) => {   // a flask recovers its amount over its time
      if (!D) return; const got = D.rate * Math.min(D.s, dt); D.s -= dt;
      flaskHeal(D, got); if (D.s <= 0) me.drink[n] = null;
    });
    for (const f of flasks()) if (f?.always) flaskHeal(f, f.amount / f.time * dt);   // one that applies its effect constantly recovers all the time
    me.cu.forEach((u, n) => { if (u && (u.s -= dt) <= 0) { me.cu[n] = null; if (u.c.guard) me.guard = 0; } });
    const R = c.rage, top = rageMax();
    if (!top) { me.rage = 0; return; }
    if (R.regen && tog[R.regen.name]) gainRage(R.regen.perSec * dt);
    if (time < me.calamity?.until) gainRage(me.calamity.rage / 60 * dt);
    if (time - me.raged > R.delay) me.rage = Math.max(0, me.rage - R.loss * dt);
    me.rage = Math.min(me.rage, top);
    if (R.berserk && tog[R.berserk.name] && me.known && me.rage > 0 && time - me.raged <= R.delay) {
      me.life -= me.maxL * R.berserk.lifePerRage / 100 * me.rage * dt;
      if (me.life <= 0) died(api.info(api.build().gems.find(g => g.name === R.berserk.name)).label);
    }
  }
  function tickHazards(dt) {
    for (let i = hazards.length - 1; i >= 0; i--) {
      const h = hazards[i]; h.s -= dt; h.tick -= dt;
      if (h.s <= 0) { h.decal.remove(); hazards.splice(i, 1); continue; }
      if (Math.random() < dt * 9) fx.emit(1, { p: { x: h.x + rnd(-h.r, h.r) * .65, y: .1, z: h.z + rnd(-h.r, h.r) * .65 }, v: .2, up: 1, life: .7, size: .26, c: h.el });
      if (h.tick > 0) continue;
      h.tick = .5;
      if (me.safe > 0 || dist(h, pp) > h.r) continue;
      const c = withCharms(sheet()); let n = 0, chaos = 0;
      for (const el in h.dot) { const got = playerTakes(c, el, h.dot[el], false) * .5; n += got; if (el === 'chaos') chaos += got; }
      hurt(n, chaos, h.el, false, h.d);
    }
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
      while (m.drops?.[0] <= m.k) { m.drops.shift(); const S = m.TC; for (let k = 0; k < (sh(S).projectiles || S.dmg.stats.base_number_of_projectiles || 1); k++) hazardAt(S, around(pp, radOf(S)), durOf(S)); }
      pp.x = m.from.x + (m.to.x - m.from.x) * m.k; pp.z = m.from.z + (m.to.z - m.from.z) * m.k; pp.y = Math.sin(m.k * Math.PI) * m.h;
      if (m.S) {
        fx.emit(2, { p: { x: pp.x, y: pp.y + .8, z: pp.z }, r: .3, v: .5, life: .35, size: .3, c: m.S.el, c2: 'white' });
        if (m.jag && (m.step -= dt) <= 0) { m.step = .06; ground('jagged', pp, m.S.A, m.jag, m.S); }   // Stampede's footsteps (note: their spacing is the scene's)
        if (!m.h) for (const d of dummies) if (!d.dead && !m.seen.has(d) && dist(d.pos, pp) <= 1 + SIM.body) { if (m.crash) { m.k = 1; m.to = { x: pp.x, z: pp.z }; break; } m.seen.add(d); hit(d, m.S, { mult: .6, noPay: true }); }
      }
      if (m.k >= 1) { pp.y = 0; move = null; m.land?.(m.to); if (m.roll && rollHeld()) { me.sprint = { at: time }; say(t('Sprinting'), 'gold'); } }
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
    } else if (steer && !charge && !stuck()) {
      goal = null;
      if (time - castAt > .3) { const v = spd() * slowed() * maimed() * dt; pp.x += steer.x * v; pp.z += steer.z * v; moving = true; if (time - castAt > .45) facing = Math.atan2(steer.x, steer.z); }
    } else if (goal && !charge && !stuck()) {   // to the point clicked, following the cursor while the button is held
      if (walk) goal = { x: cursor.x, z: cursor.z };
      const mx = goal.x - pp.x, mz = goal.z - pp.z, l = Math.hypot(mx, mz), v = Math.min(l, spd() * slowed() * maimed() * dt);
      if (l > .15) { pp.x += mx / l * v; pp.z += mz / l * v; moving = true; if (time - castAt > .45) facing = Math.atan2(mx, mz); } else if (!walk) goal = null;
    }
    const far = Math.hypot(pp.x, pp.z); if (far > 60) { pp.x *= 60 / far; pp.z *= 60 / far; }
    const step = Math.hypot(pp.x - (me.lastX ?? pp.x), pp.z - (me.lastZ ?? pp.z)); me.lastX = pp.x; me.lastZ = pp.z;
    if (step > 1e-4) { me.walked = (me.walked || 0) + step; me.trav += step; me.movedAt = time; }
    const KA = me.kaom; if (KA && time < KA.until && (KA.walked += step) >= KA.every) { KA.walked = 0; fx.ring(pp, .2, KA.S.A, 'fire', .35); boom({ x: pp.x, z: pp.z }, KA.S.A, KA.S, { soft: true }); }
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
      charge.s += dt; castAt = time; facing = Math.atan2(cursor.x - pp.x, cursor.z - pp.z);
      const b = base(charge.i), h = hand();
      if (b) fx.emit(2, { p: { x: h.x + rnd(-1, 1), y: h.y + rnd(-.6, .6), z: h.z + rnd(-1, 1) }, dir: V(0, 0, 0), v: .3, life: .3, size: .16 + Math.min(1, charge.s) * .16, c: b.el, c2: 'white' });
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
      g.tick = .5; const a = GAIL[g.type]; if (!a) continue;
      for (const d of dummies) if (!d.dead && dist(d.pos, g) <= g.r + SIM.body) inflict(d, a, g.S, 1, g.S?.raw);   // raw: a ground with a damage of its own (Burning Inscription)
    }
    vitals(dt); tickHazards(dt);
    for (const c in charges) if (charges[c] && time - (chargeAt[c] ?? time) > CHARGE_TIME) charges[c] = 0;
    for (const d of dummies) { tickDummy(d, dt); think(d, dt); if (d.agony && time >= d.agony.until) agonyEnds(d); }
    for (const k in tog) {
      const T = tog[k]; T.decal?.move(pp);
      if (T.kind === 'herald' && Math.random() < dt * 14) { const a = time * 3 + rnd(TAU); fx.emit(1, { p: { x: pp.x + Math.cos(a) * .8, y: rnd(.2, 1.8), z: pp.z + Math.sin(a) * .8 }, v: .1, up: .8, life: .6, size: .16, c: T.el }); }
      if (T.kind === 'field') for (const d of dummies) if (!d.dead && dist(d.pos, pp) <= T.R + SIM.body) d.flash = Math.max(d.flash, .06);
    }
    for (let i = empower.length - 1; i >= 0; i--) if (empower[i].s != null && (empower[i].s -= dt) <= 0) empower.splice(i, 1);
    resolveGain(dt);
    fissures = fissures.filter(f => f.end > time);
    for (let i = buffs.length - 1; i >= 0; i--) if ((buffs[i].s -= dt) <= 0) buffs.splice(i, 1);

    player.update(dt, moving && !move, spd(), !!charge || !!held && time - castAt < .3);
    reticle(); arena.update(dt, pp); fx.update(dt);
    if (toastT > 0 && (toastT -= dt) <= 0) toastEl.classList.remove('on');
    if ((hudT -= dt) <= 0) { hudT = .12; drawHud(); api.onLive?.(live()); }
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
    time += dt;
    try { step(dt); } catch (e) { if (e.message !== lastErr) { lastErr = e.message; console.error('scene:', e); } }
    composer ? composer.render(dt) : renderer.render(scene, cam);
  });

  return {
    select: i => select(i, false),
    selected: () => sel,
    // the key of the bar a skill of the build is on (html), '' when on none
    keyOf: i => { const k = barNow().indexOf(i); return k >= 0 ? keyLabel(k) : ''; },
    reset,
    // the enemy the next click places: { id → monster of enemies.js, level, attack, rarity }. The ones of that monster already in the scene follow it.
    enemy(mon, level, attack, rarity) {
      tpl.mon = mon || null; tpl.level = clamp(Math.round(+level) || 1, 1, 100); tpl.attack = attack || null; tpl.rarity = rarity || null; hudT = 0;
      if (!tpl.mon) return setPlacing(false);
      for (const d of dummies) if (d.mon === tpl.mon) arm(d, tpl.level, tpl.attack);
    },
    placing: on => on == null ? placing : setPlacing(on),
    clear: wipe,
    count: () => dummies.length,
  };
}
