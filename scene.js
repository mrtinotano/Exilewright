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
import { K as GAME, enemyStats, attackOf, attacksOf, hitChance, playerHitChance, playerTakes, enemyTakes, blockChance } from './enemies.js';
import { SIM, AILMENT, STATE, GROUND, GROUND_EL, KIND, CHARGE, profile } from './skillfx.js';
import { css, createFx, buildArena, makePlayer, makeDummy, makeMinion, makeTotem } from './scenefx.js';
import { settings, keyName, slotKeys, slotName } from './settings.js';

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
const ONCE = new Set(['buff', 'warcry', 'mark', 'curse', 'orb', 'wall', 'totem', 'raise']);   // one use per key press
const NOHIT = new Set(['banner', 'calamity', 'apocalypse', 'chayula', 'curse', 'mark', 'aura', 'herald', 'meta', 'buff', 'warcry', 'minion', 'raise', 'field']);
const AREAL = new Set(['area', 'nova', 'slam', 'rain', 'grenade', 'orb', 'curse', 'warcry', 'zone', 'storm', 'dot', 'meteor', 'wave', 'sweep', 'cone']);
const PIP = { ignite: 'fire', chill: 'cold', freeze: 'ice', shock: 'lightning', poison: 'poison', bleed: 'blood', armour: 'dust', stun: 'white', expo: 'gold', curse: 'curse', mark: 'mark', electrocute: 'lightning', pin: 'dust', maim: 'blood' };
// The game's ailment rules (GameConstants in monsters.json), and the few its tables do not hold: the glossary's (keywords.json)
const GC = GAME.game || {};
const BROKEN = { time: 12, taken: 20 };   // note: keywords.json ArmourBreak: Fully Broken for 12 s, +20% physical damage taken from hits
const WARD_REGEN = 5;                     // note: keywords.json Ward: Runic Ward regenerates 5% a second by default
const EXPO = { time: 4, res: 20 };        // note: keywords.json Exposure: -20% elemental resistances for 4 s by default
const CHILL_MIN = 30;                     // note: keywords.json Chill: a chill under 30% is ignored
const ANCESTRAL = { slam: 30, area: 25 };   // note: keywords.json Ancestral Boost: a Slam 30% more damage, 25% increased area
const MAIM = { move: 30, evasion: 15, time: 4 };   // note: keywords.json Maim: 30% slower movement, 15% reduced evasion, 4 s
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
  const me = { life: 0, es: 0, maxL: 0, maxE: 0, hurt: -9, safe: 0, known: false, mana: 0, maxM: 0, rage: 0, raged: -99,
    st: {}, mag: {}, burn: {}, flam: [], leech: noLeech(), bar: {}, lock: {}, stuns: [], calm: 0, tick: .5, by: null, fl: [null, null], drink: [], cc: [null, null, null], cu: [], guard: 0, ward: 0, maxW: 0, runes: [], mimics: [], fuel: {}, fuelAt: {}, inf: {}, infUsed: -99, glory: {}, gloryAt: {}, aff: { fire: 0, cold: 0, lightning: 0 }, affAt: {}, arctic: 0, travAt: {}, trav: 0 };   // your pools: life and energy shield against their attacks, mana for your skills, Rage; the ailments their hits put on you
  const camS = { yaw: 0, pitch: .93, dist: 21 }, camT = V(), cursor = V(0, 0, 6);
  const keys = {}, mouse = new THREE.Vector2(), ray = new THREE.Raycaster(), plane = new THREE.Plane(V(0, 1, 0), 0);
  const stats = { kills: 0, dealt: 0, taken: 0, deaths: 0 }, charges = { frenzy: 0, power: 0, endurance: 0 }, chargeAt = {}, tog = {};
  let sel = 0, time = 0, shake = 0, facing = 0, castAt = -9, cd = 0, rollCd = 0, orbit = false, placing = false, walk = false, goal = null;   // goal: where a click on the ground sends you
  let archonAt = -Infinity, dummies = [], objs = [], grounds = [], hazards = [], timers = [], empower = [], buffs = [], logs = [], fissures = [];
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
  const logEl = div('s-log'), lifeEl = div('s-life'), manaEl = div('s-mana'), bar = div('s-bar'), tipEl = div('s-tip'), toastEl = div('s-toast');
  tipEl.hidden = true;
  const pickEl = div('s-pick'); pickEl.hidden = true;
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
    const S = { i, g, P, G, kind: P.kind, name: g.name, label: inf.label, el: col, els, ail, mult: dmg?.attack ? 1 + banner('attack_damage_+%_final') / 100 : 1, gm: 1, spent: 0, R, A: R || SIM.area, aoe: P.explodes || tags.includes('area'), dmg, elemental: tags.some(x => ['fire', 'cold', 'lightning'].includes(x)) };
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
  const slots = () => api.build().gems.flatMap((g, i) => api.byHand(i) || (api.info(g).gem?.types || []).includes('Banner') ? [i] : []);
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
  const stageR = S => S.stage == null ? S.A : S.R ? S.A * (.4 + .8 * S.stage) : S.A * (1 + 2 * S.stage);
  const meleeR = S => sh(S).reach ?? SIM.meleeRange;   // the weapon's reach (calc.js shape), else the scene's
  const strikeR = S => (S.P.dash ? sh(S).dash ?? SIM.dashRange : meleeR(S)) + SIM.body;   // to the dummy's edge
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
    d.fig.setLabel(`${m.name} · ${t('Lv. {0}', level)}`); d.sig = ''; d.wind = null;
  }
  function place(x, z) {
    const m = tpl.mon; if (!m) return null;
    if (dummies.length >= MAXE) { toast(t('The scene holds up to {0} enemies', MAXE)); return null; }
    const fig = makeDummy(fx, { kind: m.category, scale: m.boss ? 1.45 : 1 });
    fig.group.position.set(x, 0, z); fig.group.rotation.y = Math.atan2(pp.x - x, pp.z - z); scene.add(fig.group);
    const d = { fig, pos: fig.group.position, home: { x, z }, aggro: false, mon: m, sc: fig.scale, st: {}, burn: {}, frz: 0, brk: 0, flam: [], bar: {}, lock: {}, imm: {}, calm: 0, mag: {}, curse: null, mark: null, dots: [], dead: false, corpse: 0, back: 0, fall: 0,
      flash: 0, wob: 0, lunge: 0, tick: rnd(.5), ph: rnd(TAU), sig: '', by: null, expo: null, wind: null, wait: rnd(.6, 1.2) };
    arm(d, tpl.level, tpl.attack); dummies.push(d);
    fx.ring(d.pos, 1.3 * d.sc, .3, 'gold', .4, { a: .6 });
    fx.emit(12, { p: { x, y: .2, z }, r: .5, v: 1, up: 1, life: .6, size: .5, grow: 2, c: 'dust', smoke: true, a: .35 });
    hudT = 0; return d;
  }
  // what an enemy carries from the fight: states, ailment bars, curse and mark, damage over time
  const clean = d => { d.pustule = null; d.st = {}; d.burn = {}; d.dots = []; d.curse = d.mark = null; d.frz = d.brk = 0; d.flam = []; d.bar = {}; d.lock = {}; d.imm = {}; d.mag = {}; d.cut = 0; };
  const restore = d => {
    const f = d.fig; d.pos.set(d.home.x, 0, d.home.z); d.aggro = false; d.dead = false; d.life = d.max; d.es = d.maxEs; d.fall = d.corpse = d.back = 0; d.by = null; d.sig = ''; d.wind = null; d.wait = rnd(.6, 1.2);
    clean(d);
    f.upper.rotation.set(0, 0, 0); f.group.visible = f.plate.visible = true;
  };
  function wipe() { dummies.forEach(d => d.fig.dispose()); dummies = []; hudT = 0; }
  function heal() { const c = sheet(); me.maxL = c.life || 0; me.maxE = c.es || 0; me.maxM = c.mana || 0; me.life = me.maxL; me.es = me.maxE; me.mana = me.maxM; me.rage = 0; me.hurt = -9; me.ward = me.maxW = c.ward || 0;
    Object.assign(me, { kaom: null, calamity: null, chayula: null, arctic: 0, travAt: {}, st: {}, mag: {}, burn: {}, flam: [], leech: noLeech(), bar: {}, lock: {}, stuns: [], fl: [null, null], drink: [], cc: [null, null, null], cu: [], guard: 0, quill: undefined, runes: [], mimics: [], fuel: {}, fuelAt: {}, inf: {}, infUsed: -99, glory: {}, gloryAt: {}, aff: { fire: 0, cold: 0, lightning: 0 }, affAt: {} }); }
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
    timers = []; empower = []; buffs = []; fissures = []; archonAt = -Infinity; charge = held = move = null; pp.y = 0;
    for (const k in charges) charges[k] = 0;
    stats.kills = stats.dealt = stats.taken = stats.deaths = 0; dummies.forEach(restore); heal(); hudT = 0;
  }
  function near(p, r, ok) {
    let best = null, bd = r;
    for (const d of dummies) if (!d.dead && (!ok || ok(d))) { const k = dist(d.pos, p); if (k <= bd) { bd = k; best = d; } }
    return best;
  }
  const inside = (c, R) => dummies.filter(d => !d.dead && dist(d.pos, c) <= R + SIM.body * d.sc);
  const has = (d, s) => s === 'curse' ? !!d.curse : s === 'mark' ? !!d.mark
    : s === 'immobilised' ? ['freeze', 'stun', 'electrocute', 'pin'].some(k => d.st[k] > 0) : d.st[s] > 0;
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
    stats.dealt += Math.min(n, d.life + (noEs ? 0 : d.es));
    d.flash = .18; if (!quiet) d.wob = Math.min(1, d.wob + .25 + 2 * Math.min(1, n / (d.max + d.maxEs)));
    const e = noEs ? 0 : Math.min(d.es, n); d.es -= e; d.life -= n - e;
    if (d.life <= 0) kill(d, S);
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
    d.aggro = true;   // hit, it comes at you
    const P = S.P, D = S.dmg, own = !APPROX.has(S.src), A = own ? D?.ail : null;
    const real = own && !!D && Object.keys(D.hits).length > 0, raw = {};
    if (own && (D ? D.attack : P.attack) && !A?.alwaysHit) {   // attacks roll your accuracy against its evasion; spells always hit
      // player attacks lose accuracy with distance: none within 2 m, linearly up to the most at 9 m (KeywordPopups
      // Accuracy; linear as Path of Building 2), from you to the target; not your minions' and totems' own attacks
      const c = sheet(), far = /minion|totem/.test(S.src) ? 0 : clamp((dist(pp, d.pos) - 2) / 7, 0, 1), acc = c.accuracy * (1 + banner('banner_accuracy_+%') / 100 / (c.accuracyInc || 1)) * (1 - far * (c.accuracyFalloff || 0) / 100);
      if (acc > 0 && d.stat.evasion > 0 && Math.random() * 100 >= playerHitChance(acc, d.stat.evasion * (d.st.maim > 0 ? 1 - MAIM.evasion / 100 : 1))) { fx.text(over(d), t('Miss'), '#9a968c', .3); return false; }
    }
    // m: the scene's multipliers; g, gp: the game's (on the whole hit, on its physical part); stunX: the consumed state's stun
    let m = (o.mult ?? 1) * S.mult, g = S.gm ?? 1, gp = 1, stunX = 1;
    if (real && D.attack && S.src !== 'minionHit') g *= rageX(D);
    if (!o.noPay) {
      const C = A?.consume || {}, uniq = d.stat.rarity === 'unique';
      for (const s of new Set([...P.consumes, ...Object.keys(C)])) if (has(d, s)) {
        clear(d, s); d.imm[s] = IMMUNE; pay(d, S, s, true);
        const c = C[s];
        if (!c) { m += SIM.consume; continue; }
        g *= 1 + ((c.any || 0) + (c[uniq ? 'unique' : 'non_unique'] || 0)) / 100; stunX *= 1 + (c.stun || 0) / 100;
      }
      if (A) { for (const [s, pct, u, phys] of A.vs) if (has(d, s) && (u == null || u === uniq)) { if (phys) gp *= 1 + pct / 100; else g *= 1 + pct / 100; } }
      else for (const s of P.bonus) if (has(d, s)) { m += SIM.consume / 2; pay(d, S, s, false); }
    }
    if (real && !S.src && cull(d, S)) return true;
    const M = d.mark;
    if (M && M.bomb && S.src !== 'mark' && ++M.hits >= 4) { d.mark = null; trigger(M.S, 'mark', d); later(.05, () => bombed(M, d.pos)); }
    fx.emit(5, { p: chest(d), v: 2.5, up: 1, life: .3, size: .12, c: S.el, c2: 'white', drag: 2 });
    let total = 0, top = S.el, best = 0, crit = false;
    if (real) {
      // a mark adds to the critical damage bonus; the buff of a consumed Freezing / Voltaic Mark adds damage as extra cold / lightning
      const W = when(D, d, S);
      crit = Math.random() * 100 < (D.crit || 0) * W.crit; if (crit) (me.critAt ||= {})[S.name] = time;
      const cm = crit ? 1 + ((D.critBonus || 0) * W.critBonus + (M?.D?.crit || 0)) / 100 : 1, B = S.src === 'minionHit' ? [] : buffs.filter(b => b.gain && !(b.gain.attack && !S.P.attack)).map(b => b.gain);   // a crit starts Inexorable Critical again
      for (const el in D.hits) { const [lo, hi] = D.hits[el]; raw[el] = (lo + Math.random() * (hi - lo)) * m * g * (el === 'physical' ? gp : 1) * cm * (W.dmg[el] ?? 1); }
      if (time < me.chayula?.until && !S.src) for (const e of ['physical', 'chaos']) if (raw[e]) raw[e] *= 1 + me.chayula.more / 100;   // Archon of Chayula
      // Trinity: more elemental damage per 30 Affinity of any type (its text; the stat's name says 50); a hit dealing
      // elemental damage gains Affinity of its highest elemental type and loses some of the others
      const TR = !S.src && trinity();
      if (TR) {
        const k = 1 + TR['trinity_damage_+%_final_to_grant_per_50_resonance'] * Math.floor((me.aff.fire + me.aff.cold + me.aff.lightning) / 30) / 100, top = [...ELEM].filter(e => raw[e] > 0).sort((a, b) => raw[b] - raw[a])[0];
        for (const e of ELEM) if (raw[e]) raw[e] *= k;
        if (top) for (const e of ELEM) { if (e === top) { me.aff[e] = Math.min(TRINITY_MAX, me.aff[e] + TR.trinity_resonance_to_grant); me.affAt[e] = time; } else me.aff[e] = Math.max(0, me.aff[e] - TR.trinity_loss_per_hit); }
      }
      const all = Object.values(raw).reduce((t, v) => t + v, 0); for (const b of B) raw[b.el] = (raw[b.el] || 0) + all * b.pct / 100;
      if (crit) gainBuff(S, 'crit');
      if (!S.src) { if (crit) trigger(S, 'crit', d); trigger(S, 'hit', d); }
      if (!S.src && has(d, 'ignite')) trigger(S, 'ignitedHit', d);
      const dealt = {};
      for (const el in raw) { const got = dealt[el] = takes(d, el, raw[el]); total += got; if (got > best) { best = got; top = el; } }
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
    d.by = S; damage(d, total, S);
    if (!S.src && time < me.chayula?.until && Math.random() * 100 < me.chayula.wither) { const w = d.wither = (d.wither || []).filter(u => u > time); w.push(time + 4); if (w.length > WITHER.max) w.shift(); }   // its "for 4 seconds"
    if (!S.src) { thornHit(S, d); const H = real ? Object.keys(raw) : S.els; if (D?.attack ?? P.attack) glory(d, 'attack_hit'); if (H.some(e => ELEM.has(e))) glory(d, 'elemental_hit'); if (H.includes('chaos')) glory(d, 'chaos_hit'); }
    if (d.dead) return true;
    if (real) afflict(d, S, raw, { crit, stunX }); else for (const a of S.ail) if (!A?.never?.[a]) inflict(d, a, S);
    if (P.dotHit) dot(d, S);
    event('hit', d.pos, S);
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
      Shocked: st('shock'), Chilled: st('chill'), Electrocuted: st('electrocute'), Pinned: st('pin'), Maimed: st('maim'), Immobilised: st('immobilised'), HeavyStunned: st('stun'),
      Ailing: ['ignite', 'chill', 'freeze', 'shock', 'electrocute', 'poison', 'bleed'].some(st), ArmourFullyBroken: st('armour'),
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
        fx.ring(q, .1, .4, 'ice', .3); later((T.base_skill_detonation_time || 0) / 1000, () => blast(q, 'support_frozen_spite_%_enemy_maximum_life_dealt_as_cold_damage', S));
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
  // note: Corrupted Blood's debuffs share one duration, refreshed (the game times each one)
  const trigReady = {}, fields = { static: [], rift: [] }, crystals = [];
  // a triggered skill's cooldown and stored uses: false while none is left
  const spend = T => { if (!T.cooldown) return true; const r = trigReady[T.id] = (trigReady[T.id] || []).filter(at => at > time); return r.length < (T.uses || 1) && r.push(time + T.cooldown / 1000) > 0; };
  const KINDS = [['base_number_of_living_lightning_allowed', null], ['shocking_rift_number_of_pulses', 'rift'], ['grounding_shocks_pulse_delay_ms', 'static'],
    ['chance_to_trigger_volcanic_eruption', 'erupt'], ['number_of_chains', 'current'], ['triggered_by_support_electrocute_lineage_%', 'fulminate'],
    ['support_mana_flare_%_of_current_mana_consumed', 'flare'], ['spell_minimum_base_cold_damage_as_%_of_intelligence', 'discharge'],
    ['base_chaos_damage_to_deal_per_minute', 'decay'], ['add_buff_to_target_skill_number_of_corrupted_blood_debuffs_to_inflict', 'cry'],
    ['support_battershout_physical_damage_equal_to_%_of_broken_armour', 'batter'], ['support_haemocrystals_physical_damage_equal_to_%_of_remaining_bleed_damage', 'crystal'],
    ['chance_to_trigger_shocked_ground_on_mark_activated_%', 'charged']];
  const ON = { rift: 'shock', static: 'shock', current: 'shock', erupt: 'ignitedHit', fulminate: 'electrocuteKill', flare: 'crit', discharge: 'hit',
    decay: 'curse', cry: 'warcry', batter: 'warcry', crystal: 'hit', charged: 'mark' };
  const DISCHARGE = { ignite: 'fire', freeze: 'cold', shock: 'lightning' };
  function trigger(S, on, d) {
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
      else if (kind === 'flare' || kind === 'discharge' || kind === 'batter') boom(c, R, X);
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
    const fresh = !(d.st[a] > 0); d.st[a] = Math.max(d.st[a] || 0, o?.dur ?? DUR[a]); d.by = S;
    if (o?.mag) d.mag[a] = fresh ? o.mag : Math.max(d.mag[a] || 0, o.mag);   // the strongest shock / chill stays
    else if (fresh) delete d.mag[a];
    if (a === 'shock') trigger(S, 'shock', d);   // a shock over a shock is shocking the enemy too
    if (!fresh) return;
    siphon(a, d); if (!S.src) glory(d, a === 'stun' ? 'heavy_stun' : a);
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
    event(a, d.pos, S);
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
  function takes(d, el, r, isHit = true) { return defence(d, el, r, isHit) * shocked(d); }
  function defence(d, el, r, isHit = true) {
    let st = d.stat; const C = d.curse?.C, k = d.curse?.k || 0;
    if (el === 'physical' && (d.cut > 0 || d.st.armour > 0 || C?.armour)) st = { ...st, armour: d.st.armour > 0 ? 0 : Math.max(0, st.armour - d.cut - (C?.armour || 0) * k) };
    const low = (d.st.expo > 0 && d.expo?.els.includes(el) ? d.expo.mag * st.expoEffect : 0) - (C?.res[el] || 0) * k;
    if (low) st = { ...st, res: { ...st.res, [el]: st.res[el] - low } };
    const W = el === 'chaos' && d.wither ? (d.wither = d.wither.filter(u => u > time)).length : 0;
    return enemyTakes(st, el, r, isHit) * (isHit && el === 'physical' && d.st.armour > 0 ? 1 + BROKEN.taken / 100 : 1) * (1 + W * WITHER.per / 100);
  }
  // What one hit does with ailments, as the game rolls it: its damage before the enemy's mitigation (raw, per type) against the
  // enemy's Elemental Ailment Threshold (chance to shock, flammability for ignite, chill magnitude) and poise (freeze and heavy
  // stun buildup), with GameConstants' rules, the skill's modifiers (calc.js ailments()) and the enemy's rarity. Bleeding and
  // poison need a chance of their own; Armour Break, an amount the skill or the build gives.
  // The skill's own on / off rules (never / always freeze, shock, ignite, stun...) come first. Electrocute and Pin build up
  // like freeze, only from skills that say so. o: { crit, stunX } of the hit.
  // note: freeze buildup is measured against poise, as Path of Building 2 does (the glossary says Ailment Threshold)
  function afflict(d, S, raw, o = {}) {
    const A = S.dmg.ail, N = A.never, AL = A.always, E = A.expo, thr = Math.max(1, d.stat.ail), x = e => raw[e] || 0, roll = c => Math.random() * 100 < c;
    const ex = (els, ms) => ms && expo(d, els, EXPO.res * E.effect, ms / 1000);
    if (x('fire') && S.els.includes('fire') && !N.ignite) {   // flammability: each hit adds some for a while, the total is the chance to ignite
      d.flam.push({ v: x('fire') / thr * GC.IgniteChanceMultiplier * A.igniteChance, s: GC.BaseFlammabilityDuration });
      if (AL.ignite || roll(d.flam.reduce((t, f) => t + f.v, 0))) { inflict(d, 'ignite', S, 1, raw, { dur: DUR.ignite * A.igniteTime, eff: A.igniteEffect }); ex(['fire'], E.onIgnite); }
    }
    const W = d.wet?.until > time ? d.wet : null;   // Thunderstorm's drench
    if (x('lightning') && !N.shock && (AL.shock || roll(x('lightning') / thr * GC.ShockChanceMultiplier * A.shockChance * (1 + (W?.shock || 0) / 100)))) {
      inflict(d, 'shock', S, 1, raw, { dur: DUR.shock * A.shockTime, mag: GC.BaseShockMagnitude * A.shockEffect }); ex(['lightning'], E.onShock);
    }
    if (x('cold')) {
      const mag = Math.min(GC.ChillMaxEffect, GC.ChillEffectMultiplier * x('cold') * A.chillDamage / thr * A.chillEffect);
      if (mag >= CHILL_MIN) inflict(d, 'chill', S, 1, raw, { dur: DUR.chill * A.chillTime, mag });
      if (!N.freeze) AL.freeze ? inflict(d, 'freeze', S, 1, null, { dur: DUR.freeze * A.freezeTime }) : build(d, 'freeze', x('cold') * GC.FreezeDamageScale * A.freeze * (1 + (d.mark?.D?.freeze || 0) / 100) * (1 + (W?.freeze || 0) / 100), S, A);
      if (o.crit) ex(['cold'], E.onColdCrit);
    }
    if (A.electrocute) build(d, 'electrocute', x('lightning') * GC.ElectrocuteDamageScale * A.electrocute * (1 + (d.mark?.D?.electrocute || 0) / 100), S, A);
    if (A.pin) build(d, 'pin', Object.values(raw).reduce((t, v) => t + v, 0) * GC.PinDamageScale * A.pin, S, A);
    const all = Object.entries(raw).reduce((t, [e, v]) => t + v * (e === 'physical' ? A.stunPhys : 1), 0);
    if (!N.stun) AL.stun ? inflict(d, 'stun', S, 1, null, { dur: DUR.stun }) : build(d, 'stun', all * A.stunMelee * GC.HeavyStunDamageScale * A.stun * (o.stunX || 1), S, A);
    if (x('physical') && !N.bleed && roll(A.bleed)) inflict(d, 'bleed', S, 1, raw, { dur: DUR.bleed * A.bleedTime, eff: A.bleedEffect });
    if ((x('physical') || x('chaos')) && roll(A.poison)) inflict(d, 'poison', S, 1, raw, { dur: DUR.poison * A.poisonTime, eff: A.poisonEffect });
    if (roll(A.maim + (d.st.poison > 0 ? A.maimPoisoned : 0) + (d.st.bleed > 0 ? A.maimBleeding : 0)) || o.crit && A.maimCrit) inflict(d, 'maim', S, 1, null, { dur: MAIM.time, mag: MAIM.move + (A.maimMore || 0) });
    if (A.maimAfterPin && d.st.pin > 0) d.unpin = { s: A.maimAfterPin, S };   // maimed for a while once this Pin ends
    if (E.hit) expo(d, ELEM, E.hit * E.effect, (E.hitMs || DUR.expo * 1000) / 1000);
    const brk = N.armour ? 0 : (A.breakFlat + x('physical') * (A.breakPct + (S.breakPct || 0)) / 100) * A.breakMore;   // Tumult's consumed frenzy charge
    if (brk > 0 && d.stat.armour > 0 && !(d.st.armour > 0)) {
      if (!S.src && Math.random() * 100 < (S.dmg.onHit?.breakEndurance || 0)) chargeBy('endurance', S);   // Armour Break II, Break Endurance
      d.cut = (d.cut || 0) + brk * (d.stat.rarity === 'normal' ? A.breakNormal : d.stat.rarity === 'magic' ? A.breakMagic : 1);
      if (d.cut >= d.stat.armour) { d.cut = 0; inflict(d, 'armour', S, 1, raw, { dur: BROKEN.time }); if (A.maimOnBreak) inflict(d, 'maim', S, 1, null, { dur: MAIM.time }); }
    }
  }
  // freeze, heavy stun, electrocute and pin bars: buildup as a % of the enemy's poise; after one fills, it is harder to fill
  // again for a while (GameConstants <name>ThresholdModifier / <name>ModifierDuration)
  const BAR = { freeze: 'Freeze', stun: 'HeavyStun', electrocute: 'Electrocute', pin: 'Pin' };
  function build(d, a, n, S, A) {
    if (!(n > 0) || d.st[a] > 0 || d.imm[a] > 0) return;
    const G = BAR[a], hard = d.lock[a] > 0 ? 1 + GC[G + 'ThresholdModifier'] / 100 : 1;
    d.bar[a] = (d.bar[a] || 0) + n / (Math.max(1, d.stat.poise) * hard) * 100; d.calm = 0;
    if (d.bar[a] < 100) return;
    d.bar[a] = 0; d.lock[a] = GC[G + 'ModifierDuration'];
    inflict(d, a, S, 1, null, { dur: a === 'freeze' ? DUR.freeze * A.freezeTime : DUR[a] });
    const H = a === 'stun' && !S.src && S.dmg?.onHit;   // Enduring Impact: endurance charges on heavy stunning
    if (H) for (let k = d.stat.rarity === 'unique' ? H.stunEnduranceUnique : Math.random() * 100 < H.stunEndurance ? 1 : 0; k > 0; k--) chargeBy('endurance', S);
  }
  // damage over time of the skill itself (Contagion, Essence Drain...): its value per second from the game data, after resistances
  function dotOf(d, S) {
    const list = S.dmg && !APPROX.has(S.src) ? Object.entries(S.dmg.dot) : [];
    if (!list.length) return { dps: (d.max + d.maxEs) * SIM.dot / 8, sim: true, el: S.el };
    let dps = 0, el = list[0][0], best = 0;
    for (const [e, v] of list) { const got = defence(d, e, v * S.mult, false); dps += got; if (got > best) { best = got; el = e; } }
    return { dps, sim: Math.abs(S.mult - 1) > .001, el };
  }
  function dot(d, S) {
    const o = d.dots.find(o => o.name === S.name), s = S.P.dur || 5, v = dotOf(d, S);
    if (o) Object.assign(o, v, { s, S }); else d.dots.push({ s, name: S.name, label: S.label, spread: !!S.P.spread, chaos: S.els.includes('chaos'), S, ...v });
    d.by = S; return d.dots.find(o => o.name === S.name);
  }
  // Things that react to what happens: meta gems fill their energy, persistent buffs grant charges.
  function metaWants(P) {
    if (/Dodge/.test(P.name)) return ['dodge'];
    if (/Minion Death/.test(P.name)) return ['miniondeath'];
    if (P.els.length) return [...new Set(P.els.flatMap(e => e === 'cold' ? ['freeze'] : AILMENT[e] ? [AILMENT[e]] : []))];
    return ['hit'];
  }
  function event(type, p, S) {
    if (S.src === 'meta') return;
    for (const k in tog) {
      const T = tog[k];
      if (T.kind === 'meta' && T.wants.includes(type)) {
        if (++T.energy < T.need) continue;
        T.energy = 0;
        const j = api.build().gems.findIndex((g, j) => { const b = g.name !== T.name && base(j); return b && b.P.triggerable && b.P.spell && !NOHIT.has(b.kind); });
        if (j < 0) continue;
        const at = { x: p.x, z: p.z };
        say(t('{0} triggers {1}', T.label, base(j).label), T.el);
        fx.glow({ x: pp.x, y: 2.2, z: pp.z }, 1.4, T.el, .4);
        later(.12, () => use(j, { at, src: 'meta' }));
      } else if (T.kind === 'aura' && T.P.gain && ['freeze', 'shock', 'ignite', 'armour'].includes(type) && time - T.last > 1.2) { T.last = time; gainCharge(T.P.gain, T.label); }
    }
  }
  // Culling Strike: a skill that culls (its description), or any of yours with Culling Strike (Rare and Unique enemies);
  // checked before the hit's damage, the threshold raised by its +%. A cull recovers Life Drain's and Soul Drain's % of your
  // maximum life and mana
  const cullable = (d, S) => {
    const r = d.stat.rarity || 'normal', X = gst(S);
    return !d.dead && (S.P.culls || (r === 'rare' || r === 'unique') && S.g?.supports?.some(n => /^Culling Strike/.test(n)))
      && d.life + d.es <= (d.max + d.maxEs) * CULL[r] * (1 + (X['culling_strike_threshold_+%'] || 0) / 100) / 100;
  };
  function cull(d, S) {
    if (!cullable(d, S)) return false; const X = gst(S);
    fx.text(over(d), t('Culling Strike'), css('blood'), .4); damage(d, d.life + d.es, S);
    me.life = Math.min(me.maxL, me.life + me.maxL * (X['recover_%_maximum_life_on_cull'] || 0) / 100 + (X.active_skill_life_gained_on_cull || 0)); me.mana = Math.min(me.maxM, me.mana + me.maxM * (X['recover_%_maximum_mana_on_cull'] || 0) / 100);
    return true;
  }
  function kill(d, S) {
    d.dead = true; stats.kills++; if (!S?.src) gainRage(sheet().rage?.gain.kill);
    // Killing Palm, Cull the Weak: an enemy they kill grants their charges by its rarity
    const kr = { unique: 'unique', rare: 'rare' }[d.stat.rarity] || 'normal_and_magic';
    if (S && !S.src) for (const c of ['power', 'frenzy']) for (let k = S.dmg?.stats?.[`skill_grant_X_${c}_charges_against_${kr}_monsters`] || 0; k > 0; k--) chargeBy(c, S);
    const r = d.stat.rarity || 'normal';   // the kill refills your flasks
    flasks().forEach((f, n) => { if (f) me.fl[n] = Math.min(f.max, flaskLeft(n) + POWER[r] * FLASK_GAIN[r] * f.gain); });
    charms().forEach((f, n) => { if (f) me.cc[n] = Math.min(f.max, charmLeft(n) + POWER[r] * CHARM_GAIN * f.gain); });
    if (r === 'rare' || r === 'unique') charmUse('killing_rare_or_unique_enemy');
    const st = d.st, p = { x: d.pos.x, z: d.pos.z }, frozen = st.freeze > 0, M = d.mark, f = d.fig;
    if (st.shock > 0) gainBuff(S, 'shockKill');
    if (st.electrocute > 0) trigger(S, 'electrocuteKill', d);
    deathBlast(d, frozen, S);
    // Cannibalism, on a persistent buff that is up: life recovered on kill
    for (const g of api.build().gems) if (tog[g.name]) me.life = Math.min(me.maxL, me.life + me.maxL * (api.damage?.(g)?.lifeOnKill || 0) / 100);
    // heralds: an enemy that dies with the ailment of their element explodes
    for (const k in tog) {
      const T = tog[k], a = T.kind === 'herald' && AILMENT[T.P.el];
      if (a && st[a] > 0) later(.1, () => herald(T, p));
    }
    if (M?.bomb) { trigger(M.S, 'mark', d); later(.06, () => { say(t('{0} explodes on the kill', M.label), 'mark'); bombed(M, p); }); }
    const sp = d.dots.find(o => o.spread);
    if (sp) {   // Contagion jumps to the neighbours and carries the other chaos debuffs with it
      const carry = d.dots.filter(o => o.spread || o.chaos), list = dummies.filter(e => !e.dead && dist(e.pos, p) <= 3.5);
      for (const e of list) { fx.bolt(V(p.x, 1, p.z), chest(e), 'chaos', .28, .03, .4); for (const o of carry) if (!e.dots.some(x => x.name === o.name)) e.dots.push({ ...o, s: 5, ...dotOf(e, o.S) }); e.by = S; }
      if (list.length) say(t('{0} spreads to {1} enemies', sp.label, list.length), 'chaos');
    }
    if (S.P.gain && !S.P.corpse && !S.src && !['aura', 'mark'].includes(S.P.kind)) chargeBy(S.P.gain, S);
    event('kill', p, S);
    if (!S?.src) remnantOn('kill', d);
    if (Math.random() * 100 < (S?.dmg?.sum?.['create_verisium_remmant_on_kill_enemy_%'] || 0)) infRemnant('verisium', p, { dur: (S.dmg.sum.base_remnant_duration_ms || 0) / 1000 });   // Runic Extraction
    hatch(p);
    clean(d); d.sig = ''; d.wind = null; d.life = d.es = 0;
    f.ice.visible = f.curse.visible = f.mark.visible = f.plate.visible = false; f.sack.emissive.setRGB(0, 0, 0);
    if (frozen) {   // frozen enemies shatter: no corpse
      fx.emit(46, { p: { x: p.x, y: 1, z: p.z }, r: .3, h: 1, v: 5, up: 2, life: .8, size: .2, c: 'ice', c2: 'white', g: 9 });
      fx.ring(p, .3, 1.8, 'ice', .4); f.group.visible = false; d.corpse = 0; d.back = SIM.respawn;
    } else { d.corpse = SIM.corpseTime; d.fall = 0; }
  }
  function herald(T, p) {
    const i = byName(T.name), b = i >= 0 && mk(i); if (!b) return;
    const S = { ...b, src: 'herald', ail: ailOf(T.P.els) };
    say(t('{0} explodes on the kill', T.label), T.el);
    if (T.P.el === 'lightning') {   // bolts on the enemies around instead of one blast
      dummies.filter(e => !e.dead && dist(e.pos, p) <= 7).sort((a, b) => dist(a.pos, p) - dist(b.pos, p)).slice(0, 3).forEach((e, k) => later(k * .08, () => {
        fx.bolt(V(e.pos.x + rnd(-1.5, 1.5), 13, e.pos.z + rnd(-1.5, 1.5)), V(e.pos.x, 0, e.pos.z), 'lightning', .22, .07, .5); pop(e.pos, 1.1, 'lightning'); area(e.pos, 1.1, S);
      }));
    } else boom(p, SIM.heraldR, S);
  }
  const revive = d => { restore(d); fx.ring(d.pos, 1.2 * d.sc, .3, 'gold', .4, { a: .5 }); };
  const corpseAt = (p, r) => { let best = null, bd = r; for (const d of dummies) if (d.corpse > 0) { const k = dist(d.pos, p); if (k <= bd) { bd = k; best = d; } } return best; };
  function eat(d, c) {
    d.corpse = 0; d.back = SIM.respawn; d.fig.group.visible = false;
    fx.emit(26, { p: { x: d.pos.x, y: .4, z: d.pos.z }, r: .5, v: 1.5, up: 3, life: .8, size: .22, c, c2: 'blood' }); fx.ring(d.pos, 1.3, .2, c, .4);
  }
  // Corpse skills act on a corpse near the cursor; without one they do nothing.
  function useCorpse(S) {
    const d = corpseAt(S.at, Math.max(S.A, SIM.snap));
    if (!d) { toast(t('{0} needs a corpse: kill an enemy or press C', S.label)); return null; }
    const p = { x: d.pos.x, z: d.pos.z }; eat(d, S.el); if (S.P.gain) chargeBy(S.P.gain, S);
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
        later(.08, () => boom(g, g.r, { ...g.S, els: ['fire'], el: 'fire', ail: ['ignite'], src: 'ground' }));
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
    grounds.push({ type, x: c.x, z: c.z, r, r0: r, age: 0, grow, s: (dur || GROUND_TIME[type] || SIM.groundTime) * (S ? sh(S).ground || 1 : 1), tick: .2, S, decal, dead: false });
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
  // A wind skill picks up the elemental ground it passes over.
  function absorb(S, at, r) {
    const g = grounds.find(g => !g.dead && GROUND_EL[g.type] && !S.els.includes(GROUND_EL[g.type]) && dist(g, at) <= r + g.r * .6);
    if (!g) return S;
    const e = GROUND_EL[g.type]; g.dead = true;
    say(t('{0} absorbs {1} and gains {2}', S.label, t(GROUND[g.type]), t(cap(e))), e);
    fx.ring(at, g.r, .3, e, .45); fx.emit(30, { p: { x: g.x, y: .2, z: g.z }, r: g.r, v: .5, up: 3, life: .7, size: .25, c: e, c2: 'white' });
    // Catalysing Elements: boosted by the ground, the skill sets off Catalysing Discharge of its element where you are,
    // that part's own damage (calc.js trig parts), its cooldown
    const k = `TriggeredCatalysingDischarge${cap(e)}Player`, T = !S.src && S.dmg?.trig?.find(T => T.parts?.[k]), D = T?.parts[k];
    if (D && spend(T)) { const X = asTrig(S, { ...T, ...D, id: T.id }, D.hits); say(X.label, e); boom(at, X.A, X); }
    return { ...S, els: [...S.els, e], el: e, ail: [...new Set([...S.ail, ...ailOf([e])])] };
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
    if (o.overgrown || o.dead) return; o.overgrown = true; const S = o.plant;
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
      const m = new THREE.Mesh(PUSTULE, new THREE.MeshStandardMaterial({ color: 0x5f8a2a, emissive: 0x1d3008, roughness: .6 })); m.position.set(q.x, .25, q.z);
      planted(thing(m, sh(S).detonate || SIM.lifetime, { name: S.name, plant: S, c: q, R: S.A, tick: (dt, e) => presence(e),
        end: () => { if (X) { say(t('{0} detonates', S.label), 'poison'); boom(q, X.A, X); } } }));
    }
  }
  // ---------- Remnants (keywords.json Remnant): your persistent skills drop them where their condition is met, for their
  // duration; walking over one collects it. Its effect +%, chance for one more, delay and pickup range are the gem's stats
  // with its supports' (Remnant Potency, Harmonic / Magnetic Remnants); Selfless Remnants gives it to your allies instead
  const REMNANT = {
    'Life Remnants': { c: 'blood', kill: s => s['life_remnants_chance_to_spawn_orb_on_killing_enemy_%'], every: s => s.life_remnants_spawn_remnant_on_hit_vs_enemy_every_X_ms,
      get: (s, k) => { me.life = overflow(me.life, me.maxL, s.life_remnants_gain_per_globe * k); } },
    'Mana Remnants': { c: 'lightning', ail: true, kill: s => s['mana_remnants_chance_to_spawn_orb_on_killing_enemy_with_elemental_ailment_%'], crit: true,
      every: s => s.mana_remnants_spawn_remnant_on_crit_vs_elemental_ailment_enemy_every_X_ms, get: (s, k) => { me.mana = gain(me.mana, me.maxM, s.mana_remnants_gain_per_globe * k); } },
    'Sanguine Revelry': { c: 'fire', bleed: true, kill: s => s['sanguine_revelry_%_change_to_create_remnant_on_killing_bleeding_enemy'], every: s => s.create_furious_remnant_when_hitting_bleeding_enemies_once_every_x_ms,
      get: (s, k) => { gainRage(s.sanguine_revelry_rage_gain_per_pickup * k);   // the life by the Rage you have once it is granted
        me.life = gain(me.life, me.maxL, me.maxL * (s['sanguine_revelry_remnant_restore_%_permyriad_of_max_life_per_5_current_rage'] || 0) / 1e6 * k * Math.floor(me.rage / 5)); } },
    'Remnants of Kalguur': { c: 'gold', kill: s => s['ward_remnants_chance_to_spawn_orb_on_killing_enemy_%'], stun: s => s['ward_remnants_chance_to_spawn_remnant_on_stun_%'],
      stunCd: s => s.ward_remnants_spawn_remnant_on_stun_cooldown_ms, get: (s, k) => { me.ward = overflow(me.ward, me.maxW, s.ward_remnants_gain_per_globe * k); } },
  };
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
      const c = j ? around(p, SIM.pickup) : { x: p.x, z: p.z }, m = new THREE.Mesh(ORB, new THREE.MeshBasicMaterial({ color: fx.color(R.c, 2.2), fog: false }));
      m.position.set(c.x, .5, c.z);
      thing(m, (s.base_remnant_duration_ms || SIM.lifetime * 1000) / 1000, { name: S.name, c,
        tick(dt, e) { m.position.y = .5 + Math.sin(e.s * 4) * .08; if (dist(pp, c) <= reach) { e.dead = true; collect(S, R, c); } } });
    }
  }
  function collect(S, R, c) {
    const s = rstats(S), k = 1 + (s['remnant_effect_+%'] || 0) / 100;
    fx.ring(c, .15, .8, R.c, .3); fx.emit(10, { p: { x: c.x, y: .5, z: c.z }, r: .2, v: 1.2, up: 1.5, life: .5, size: .14, c: R.c, c2: 'white' });
    if (s.remnants_affect_allies_in_presence_instead) return say(t('{0}: the Remnant affects your allies', S.label), R.c);   // the scene's minions have no life of their own
    later((s.remnant_delay_X_ms || 0) / 1000, () => { R.get(s, k); hudT = 0; fx.glow({ x: pp.x, y: 1.2, z: pp.z }, .9, R.c, .35); });
  }
  // a hit of yours (each skill no more than once in its time; Mana Remnants on a critical hit on an enemy with an elemental
  // ailment, Sanguine Revelry on a bleeding one), a kill (its chance, under the same condition), a heavy stun (Kalguur's
  // chance, its cooldown)
  function remnantOn(type, d, crit) {
    for (const S of remnantSkills()) {
      const R = REMNANT[S.name], s = rstats(S), ok = (!R.ail || EL_AIL.some(a => d.st[a] > 0)) && (!R.bleed || d.st.bleed > 0);
      if (type === 'hit') { const ms = R.every?.(s); if (ok && ms && (!R.crit || crit) && time - (remnantAt[S.name] ?? -99) >= ms / 1000) { remnantAt[S.name] = time; remnant(S, d.pos); } }
      else if (type === 'kill') { if (ok && Math.random() * 100 < (R.kill(s) || 0)) remnant(S, d.pos); }
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
    U.stored += pd * dt; U.left -= dt * (1 + pd * 60 / (st['toxic_pustule_duration_expires_1%_faster_per_x_stored_poison_damage_multiplied_by_sixty'] || Infinity) / 100);
    if (Math.random() < dt * 6) fx.emit(1, { p: { x: d.pos.x, y: 1.5 * d.sc, z: d.pos.z }, r: .2, v: .2, up: .5, life: .6, size: .22, c: 'poison' });
    if (U.left > 0) return;
    d.pustule = null;
    const more = Math.min(st['toxic_pustule_max_burst_damage_+%_final_from_stored_poison'] || 0, U.stored / (st['toxic_pustule_burst_1%_more_damage_per_x_stored_poison'] || Infinity));
    const R = U.X.A + Math.min(st['toxic_pustule_max_additional_burst_base_radius_+'] || 0, U.stored / (st['toxic_pustule_burst_base_radius_+1_per_x_stored_poison'] || Infinity)) / 10;
    say(t('{0} detonates', U.X.label), 'poison'); boom({ x: d.pos.x, z: d.pos.z }, R, { ...U.X, mult: U.X.mult * (1 + more / 100) });
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
    for (const o of objs) if (o.segs && !o.dead) for (const q of o.segs) if (q.life > 0 && dist(d.pos, q.p) < k && segDist(q.p, d.pos, pp) < q.r + SIM.body) { best = q; k = dist(d.pos, q.p); }
    return best; };
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
  // o.reach: how near an enemy sets it off (else its area); o.delay: it goes off that long after (Conductive Runes)
  function hazardAt(X, p, dur, o = {}) {
    const arm = o.arm || 0, c = o.c || 'dust', reach = o.reach || X.A;
    const decal = fx.decal(p, reach, 'patch', c, { a: .8, k: 1 });
    const e = thing(holder(p), dur, { name: X.name, hazard: true,
      tick() {
        if (e.set || e.s < arm || !dummies.some(d => !d.dead && dist(d.pos, p) <= reach + SIM.body)) return;
        const S2 = e.s < .5 && o.early ? { ...X, mult: X.mult * (1 + o.early / 100) } : X; e.set = true;
        later(o.delay || 0, () => { e.dead = true; area(p, X.A, S2); fx.emit(10, { p: { x: p.x, y: .2, z: p.z }, r: X.A, v: 1.5, up: 1, life: .3, size: .1, c, c2: 'white' }); });
      },
      off: () => decal.remove() });
  }
  const around = (c, r) => { const a = rnd(TAU), k = rnd(r); return { x: c.x + Math.sin(a) * k, z: c.z + Math.cos(a) * k }; };
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
  function shoot(S, from, dx, dz, o = {}) {
    const G = S.G, P = S.P, speed = o.speed || G.speed || SIM.projSpeed, slow = !o.speed && (speed < 5.5 || P.spiral || P.wind);
    const cr = Math.max(.15, G.collision || 0), m = P.attack && !P.wind ? fx.arrow(S.el) : fx.orb(S.el, slow ? .26 : .14);
    let left = o.range || (G.speed ? G.range : SIM.projRange), pulse = .2, cur = S, a0 = Math.atan2(dx, dz), trail = 0, spd = speed, burn = 0;
    // Ball Lightning: its hits on the enemies around it at its frequency; with a Fire Infusion consumed it slows down over
    // time, leaves Ignited Ground at its interval and explodes where it ends (its infused parts)
    const bst = S.dmg?.stats || {}, every = bst.ball_lightning_base_hit_frequency_ms / 1000, fi = S.infs?.includes('fire') && bst.ball_lightning_infused_acceleration != null;
    const BG = fi && partOf(S, 'BallLightningIgnitedGround'), BX = fi && partOf(S, 'BallLightningInfusedExplosionPlayer');
    m.position.set(from.x, 1.1, from.z); m.rotation.y = a0; scene.add(m);
    // Pierce, then Fork, then Chain (calc.js shape): a fractional pierce is a chance, rolled per projectile. The forks
    // part at an angle the data does not give (a look only); they keep the targets already hit and the less damage
    const D = sh(S), seen = new Set(o.seen), forked = o.forked || 0;
    const pierceN = Math.floor(D.pierce || 0) + (Math.random() < (D.pierce || 0) % 1 ? 1 : 0);
    let pierced = o.pierced || 0;
    const mult = () => (pierced ? (1 + (D.pierceMore || 0) / 100) * Math.max(0, 1 + (D.perPierce || 0) * pierced / 100) : 1) * (forked ? 1 + (D.forkMore || 0) / 100 : 1);
    const end = hitD => {
      q.dead = true; const p = { x: m.position.x, z: m.position.z };
      if (P.chains && hitD) {
        chain(m.position.clone(), hitD, cur, D.chains || 0, seen, mult());
        // Lightning Arrow: bolts from the one hit to the nearest others in its area ("up to 2 extra targets")
        const by = chest(hitD);
        for (const e of dummies.filter(e => !e.dead && !seen.has(e) && dist(e.pos, hitD.pos) <= S.A).sort((a, b) => dist(a.pos, hitD.pos) - dist(b.pos, hitD.pos)).slice(0, D.extraTargets || 0)) {
          seen.add(e); fx.bolt(by, chest(e), cur.el, .18); hit(e, cur, { mult: mult() });
        }
      }
      else if (P.explodes || S.aoe) {
        boom(p, S.A, cur);
        const X = cur.infs?.includes('fire') && infPart(cur, 'fire'), n = X && sh(X).projectiles;   // Fireball: a ring of smaller firebolts
        if (n) for (let k = 0; k < n; k++) shoot({ ...X, aoe: false, P: { ...X.P, explodes: false }, infs: [] }, p, Math.sin(k * TAU / n), Math.cos(k * TAU / n), { range: Math.max(1, (X.G.range || SIM.projRange) + (X.dmg.stats.projectile_maximum_range_override || 0) / 10) });
      }
      else if (hitD) { hit(hitD, cur, { mult: mult() }); touch(p, .5, cur); fx.flash(m.position, cur.el, 8, .15, 4); darts(cur, hitD); }
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
          for (const d of dummies) if (!d.dead && !seen.has(d) && dist(d.pos, m.position) <= cr + SIM.body) {
            seen.add(d);
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
          if (P.absorbs) { const n = absorb(cur, m.position, Math.max(S.R, .6)); if (n !== cur) { cur = n; tint(m, cur.el); } }
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
    // o.attacks: it is gone after that many; o.chains: its hit chains to that many more enemies
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
        if (k > stop) { const v = Math.min(k - stop, 5.5 * dt); e.pos.x += (goal.x - e.pos.x) / k * v; e.pos.z += (goal.z - e.pos.z) / k * v; e.pos.y = Math.abs(Math.sin(e.s * 9)) * .05; }
        else if (d && wait <= 0) {
          wait = real && S.dmg.speed ? 1 / S.dmg.speed : ranged ? 1.5 : 1.1; sw = 1;
          if (ranged) shoot(MS, e.pos, (d.pos.x - e.pos.x) / k, (d.pos.z - e.pos.z) / k, { speed: 14, range: 13 });
          else if (o.chains) chain(V(e.pos.x, 1, e.pos.z), d, MS, o.chains);
          else { fx.sector(e.pos, d.pos.x - e.pos.x, d.pos.z - e.pos.z, 1.3, .8, S.el, .16, { a: .7 }); hit(d, MS); }
          if (o.attacks && --o.attacks <= 0) e.dead = true;
        }
      },
      remove() {
        fx.emit(16, { p: { x: e.pos.x, y: .8, z: e.pos.z }, r: .3, v: 1.5, up: 1, life: .6, size: .14, c: 0xd8d0b8, g: 8, k: 1 }); f.dispose();
        if (!e.keep) event('miniondeath', e.pos, MS);
      } };
    objs.push(e); return e;
  }
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
  function crystal(S, p, dur) {
    const m = new THREE.Mesh(ICE, new THREE.MeshStandardMaterial({ color: 0xbfe8ff, emissive: 0x2a6f9f, roughness: .1, transparent: true, opacity: .85, flatShading: true }));
    m.position.set(p.x, .75, p.z); m.rotation.set(rnd(-.15, .15), rnd(TAU), rnd(-.15, .15)); m.scale.setScalar(.01); m.castShadow = true;
    fx.emit(8, { p: { x: p.x, y: .2, z: p.z }, r: .3, v: 1, up: 2, life: .5, size: .16, c: 'ice' });
    const h = rnd(.8, 1.2);
    const e = thing(m, dur, { r: .4, name: S.name,
      tick(dt, e) { const s = ease(Math.min(1, e.s * 5)); m.scale.set(s, s * h, s); },
      touch(by) {   // hit by anything: it bursts, and the burst reaches the next crystals
        e.dead = true;
        later(rnd(.04, .14), () => { if (by.src !== 'crystal') say(t('{0}: the ice crystals explode ({1})', S.label, by.label), 'ice'); boom(p, S.A, { ...S, self: e, src: 'crystal' });
          const X = S.infs?.includes('lightning') && partOf(S, 'FrostWallInfusedPlayer');   // Frost Wall's Lightning Infusion: another explosion
          if (X) boom(p, radOf(X), { ...X, self: e, src: 'crystal' }); });
      },
      end: () => fx.emit(14, { p: { x: p.x, y: .7, z: p.z }, r: .2, h: .6, v: 2, life: .6, size: .14, c: 'ice', g: 9 }) });
  }
  // Tornado's own: up to its limit; it pulls the enemies inside toward its centre (its strength every interval) and deals
  // its damage over time to them while they are in it, with its damage of each absorbed element on top
  // note: an absorbed element's damage per second scales as the skill's physical one does
  function vortex(S, c, R, dur, o = {}) {   // Tornado: drifts towards the enemies and takes the element of the ground it crosses
    const g = holder(c), ts = S.dmg?.stats || {}, pull = ts['tornado_pull_strength_%'], DOT = Object.keys(S.dmg?.dot || {}).length > 0; let cur = S, tk = .2, pt = 0;
    limit(x => x.vortex && x.name === S.name, ts.number_of_tornados_allowed);
    const e = thing(g, dur, { name: S.name, vortex: true,
      tick(dt, e) {
        const p = g.position, col = cur.el === 'physical' ? 'dust' : cur.el;
        for (let i = 0; i < 3; i++) {
          const a = e.s * 9 + i * 2.1 + rnd(.6), h = rnd(3.4), rr = .2 + h * .28 * (R / 3 + .3);
          fx.emit(1, { p: { x: p.x + Math.cos(a) * rr, y: h, z: p.z + Math.sin(a) * rr }, dir: V(-Math.sin(a) * 3.5, 1.2, Math.cos(a) * 3.5), life: .45, size: .34, c: col, c2: 'white', k: cur.el === 'physical' ? 1.1 : 2.2 });
        }
        const d = near(p, o.seek || 9), v = o.speed || 1.3;
        if (d) { const k = dist(d.pos, p); if (k > .3) { p.x += (d.pos.x - p.x) / k * v * dt; p.z += (d.pos.z - p.z) / k * v * dt; } }
        if (S.P.absorbs) cur = absorb(cur, p, R);
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
        for (const d of dummies.filter(d => d.corpse > 0 && dist(d.pos, c) <= ts.active_skill_base_secondary_area_of_effect_radius / 10).slice(0, ts.detonate_on_landing_maximum_number_of_corpses_to_detonate)) {
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
      if (X?.dmg.stats.base_number_of_projectiles) S = { ...X, circle: true };
      const n = (sh(S).projectiles || S.P.count || 1) + S.spent * 2, a0 = Math.atan2(S.dx, S.dz), spread = S.circle ? TAU / n : S.P.wander ? .45 : .13, h = hand();
      for (let i = 0; i < n; i++) { const a = a0 + (i - (n - 1) / 2) * spread; shoot(S, S.from, Math.sin(a), Math.cos(a)); }
      fx.glow(h, .9, S.el, .2);
    },
    chain(S) {
      const d = near(S.at, SIM.snap) || near(S.at, 6, e => dist(e.pos, S.from) <= SIM.castRange), h = hand();
      if (d) chain(h, d, S, (sh(S).chains || 0) + (S.addChains || 0));   // Arc's chains from a Lightning Infusion
      else { fx.bolt(h, V(S.at.x, .1, S.at.z), S.el, .18); pop(S.at, .6, S.el); touch(S.at, .6, S); }
    },
    rain(S) {
      const P = S.P, c = S.at, R = S.A, h = hand();
      const shot = land => lob(P.attack ? fx.arrow(S.el) : fx.orb(S.el, .13), h, V(c.x, .1, c.z), .42, 3.2, land, { trail: S.el });
      if (P.object) return shot(() => rod(S, c));
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
        const n = 22 + S.spent * 8;
        for (let i = 0; i < n; i++) later(.42 + i * .034, () => {
          const a = rnd(TAU), r = Math.sqrt(rnd()) * R, q = { x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r };
          fx.streak(V(q.x + 1.5, 12, q.z - 1), V(q.x, 0, q.z), S.el, .13, .025, 1.6);
          later(.13, () => { fx.ring(q, .1, .75, S.el, .25, { a: .7 }); fx.emit(4, { p: { x: q.x, y: .1, z: q.z }, v: 1.5, up: 1.5, life: .3, size: .12, c: S.el, c2: 'white' }); area(q, .75, S, { mult: .5, noTouch: i % 4 > 0 }); });
        });
        return;
      }
      shot(() => {
        if (P.plant && P.dur) return K.zone({ ...S, at: c });
        boom(c, R, S); if (P.ground) ground(P.ground, c, R, P.dur, S);
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
      limit(o => o.orbOf === S.name, st.base_maximum_number_of_frost_bombs || 1);
      const m = fx.orb(S.el, .3), range = fx.decal(c, R, 'outline', S.el, { a: .35, rot: 0 }); m.position.set(c.x, 1.3, c.z);
      fx.ring(c, .2, 1.4, S.el, .4);
      let tk = .4;
      const e = thing(m, dur, { r: R, orbOf: S.name, name: S.name, bolts: 0,
        tick(dt, e) {
          m.position.y = 1.3 + Math.sin(e.s * 3) * .08; if (P.detonates) m.userData.core.scale.setScalar(.3 * (1 + e.s / dur * .7));
          if ((tk -= dt) > 0) return;
          if (P.detonates) { tk = .6; fx.ring(c, .3, R, S.el, .5, { a: .55 }); for (const d of inside(c, R)) { expo(d, ELEM, cmp && d.st.expo > 0 && d.expo ? Math.min(st.active_skill_all_elemental_exposure_compounding_magnitude_cap * eff, d.expo.mag + cmp * eff) : expoMag(S)); inflict(d, 'chill', S); } }   // pulses of exposure, then the blast
          else if (P.chains) { tk = sh(S).bolts || .9; e.zap(); }
          else { tk = 1; fx.ring(c, .3, R, S.el, .5); area(c, R, { ...S, self: e, src: 'orb' }, { mult: .5 }); }
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
        const X = T && charges.power >= need && (charges.power -= need, asTrig(S, T));
        if (X) say(X.label, X.el);
        for (let i = 0; i < 6; i++) { const k = i / 5, p = { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k }; later(i * .04, () => { crystal(S, p, dur); if (X) ground('chilled', p, X.A, 0, X, { per: X.dmg.stats['active_skill_ground_effect_area_of_effect_+%_final_per_second'], max: X.dmg.stats['active_skill_ground_effect_area_of_effect_+%_final_per_second_max'] }); }); }
        for (const d of dummies) if (!d.dead && segDist(d.pos, a, b) <= .7 + SIM.body) hit(d, S);
        return;
      }
      const fire = S.els.includes('fire'); let tk = 0;
      if (P.earthen) { fx.strip(a, b, 1.2, S.el, dur, { a: .6 }); return shieldWall(S, a, b, c, dur); }
      // its own limit (Flame Wall's 3); a wall with damage over time burns those in it (its damage per second), else hits
      limit(o => o.wall && o.name === S.name, S.dmg?.stats?.number_of_allowed_firewalls);
      const strip = fx.strip(a, b, 1.2, S.el, dur, { a: .6 }), burns = Object.keys(S.dmg?.dot || {}).length > 0;
      thing(holder(c), dur, { wall: true, fire, a, b, name: S.name, label: S.label, S,
        tick(dt, e) {
          for (let i = Math.ceil(dt * 100); i > 0; i--) { const k = rnd(); fx.emit(1, { p: { x: a.x + (b.x - a.x) * k, y: .05, z: a.z + (b.z - a.z) * k }, v: .3, up: fire ? 3.4 : 2.2, life: .6, size: .5, c: S.el, c2: fire ? 'ember' : 'white', drag: .5 }); }
          if ((tk -= dt) > 0) return; tk = burns ? .2 : .5;
          for (const d of dummies) if (!d.dead && segDist(d.pos, a, b) <= .7 + SIM.body) burns ? dot(d, { ...S, P: { ...S.P, dur: .3 } }) : hit(d, { ...S, self: e }, { mult: .3, noPay: true });
        }, off: () => { strip.dur = Math.min(strip.dur, strip.t); } });   // a wall over the limit goes
    },
    curse(S) {
      const c = S.at, R = S.A;
      const wait = sh(S).curseDelay || SIM.curseDelay;
      fx.telegraph(c, R, 'curse', wait);
      later(wait, () => {
        fx.disc(c, R, 'curse', .7, { tex: 'rune', a: .8, spin: 1 }); fx.ring(c, R * .3, R, 'curse', .5);
        const list = inside(c, R);
        const C = S.dmg?.curse; let n = 0;
        for (const d of list) {
          if (C?.maxLevel && d.level > C.maxLevel) { say(t('{0} cannot curse enemies above level {1}', S.label, C.maxLevel), 'curse'); continue; }
          n++;
          d.curse = { s: (sh(S).duration || SIM.curseTime) * (S.curseX || 1), label: S.label, C, k: (C?.effect ?? 1) * d.stat.curseEffect }; trigger(S, 'curse', d); fx.emit(6, { p: chest(d), r: .3, v: .4, up: -1, life: .6, size: .2, c: 'curse' }); }
        if (n) say(t('{0}: {1} enemies cursed', S.label, n), 'curse');
        // Burning Inscription: the curse's Runic Inscription, as it expires, leaves Ignited Ground (its area and time),
        // igniting by a base of that share of your maximum mana through the build's modifiers
        const T = S.dmg?.trig?.find(T => T.stats?.['support_burning_runes_base_fire_damage_equal_to_%_maximum_mana']);
        if (T) { const X = asTrig(S, T, scale(T.hits, me.maxM * T.stats['support_burning_runes_base_fire_damage_equal_to_%_maximum_mana'] / 1e4)); X.raw = Object.fromEntries(Object.entries(X.dmg.hits).map(([e, [lo, hi]]) => [e, (lo + hi) / 2])); say(X.label, X.el); ground('burning', c, X.A, sh(X).duration || T.stats.base_skill_effect_duration / 1000, X); }
      });
    },
    mark(S) {
      const d = near(S.at, SIM.snap); if (!d) return toast(t('No enemy at the cursor'));
      for (const e of dummies) if (e.mark) e.mark = null;   // one mark at a time
      d.mark = { s: sh(S).duration || S.P.dur || 8, els: S.P.els, label: S.label, name: S.name, D: S.dmg?.mark, gain: S.P.gain, bomb: S.P.bomb, hits: 0, R: S.A, S: { ...S, src: 'mark', ail: ailOf(S.P.els) } };
      fx.ring(d.pos, 2.2, .5, 'mark', .4); fx.bolt(hand(), V(d.pos.x, 2, d.pos.z), 'mark', .15, .02, .1);
      say(t('{0} marks the target', S.label), 'mark');
    },
    warcry(S) {
      // Echoing Cry: it Echoes its times after its delay, its area larger each time (its description: "grows larger")
      const ES = !S.echoK && S.dmg?.sum || {}, EN = ES.base_warcry_echo_X_times;
      for (let k = 1; k <= (EN || 0); k++) later(k * ES.warcry_echo_delay_ms_from_support / 1000, () => K.warcry({ ...S, echoK: k, from: { x: pp.x, z: pp.z }, A: S.A * Math.sqrt(1 + (ES['warcry_echo_area_of_effect_+%_final_per_repeat'] || 0) * k / 100) }));
      const c = S.from, R = S.A, col = S.P.els.length ? S.el : 'gold';
      fx.ring(c, .5, R, col, .55, { k: 2.8 }); fx.ring(c, .3, R * .7, 'white', .4, { a: .5 }); shake = Math.max(shake, .22);
      fx.emit(40, { p: { x: c.x, y: .3, z: c.z }, v: R * 2, flat: true, life: .4, size: .2, c: col, c2: 'white', drag: 1.5 });
      const list = inside(c, R);
      for (const o of [...objs]) if (o.earth && !o.dead && !o.segs && o.near(c) <= R) o.shatter('warcry');   // earthen objects near it
      for (const d of list) { d.wob = 1; for (const a of ailOf(S.P.els)) inflict(d, a, S); trigger(S, 'warcry', d); }
      // the attacks it Empowers: one per its Power of the enemies in its area, up to its cap (else the scene's 2); a Slam
      // performs Seismic Cry's additional Aftershocks
      const ws = S.dmg?.stats || {}, per = ws.warcry_empowers_per_X_monster_power, uses = per ? Math.floor(Math.min(ws.warcry_empowers_per_X_monster_power_mp_cap, list.reduce((n, d) => n + (POWER[d.stat.rarity] || 1), 0)) / per) : 2;
      if (S.P.empowers && uses) { empower = empower.filter(e => e.type !== 'echo'); empower.push({ type: 'echo', label: S.label, name: S.name, uses, s: 12, slam: ws.seismic_cry_slam_skill_additional_aftershocks || 0 }); say(t('{0}: your next melee attacks repeat as an aftershock', S.label) + ` ×${uses}`, 'gold'); }
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
      if (tog[k]) { untoggle(k); say(t('{0} off', S.label), 'dust'); return; }
      const T = tog[k] = { name: k, kind: S.kind, P: S.P, label: S.label, el: S.el, energy: 0, need: 0, last: -9, R: 0, objs: [] };
      if (S.kind === 'meta') { T.wants = metaWants(S.P); T.need = T.wants[0] === 'hit' ? SIM.energy * 3 : SIM.energy; }
      else if (S.kind === 'minion') for (let i = 0; i < 2; i++) T.objs.push(minion(S, { x: pp.x + rnd(-1.5, 1.5), z: pp.z + rnd(-1.5, 1.5) }, Infinity));
      else if (S.kind === 'herald') T.decal = fx.decal(pp, .9, 'rune', S.el, { a: .7, spin: 1.5 });
      else { T.R = S.kind === 'field' ? S.A : S.R; T.decal = fx.decal(pp, T.R || 1.1, T.R ? 'outline' : 'ring', S.el, { a: .45, rot: 0 }); }
      fx.ring(pp, .3, 2, S.el, .5); fx.pillar(pp, .5, 2.6, S.el, .35, 2); say(t('{0} on', S.label), S.el);
    },
    // Raise Zombie: for its duration, up to its limit; without a corpse it consumes a Power Charge for an Empowered Zombie
    // (its more hit damage) and two more (its less damage taken and more speed: not simulated)
    raise(S) {
      const r = Math.max(S.A, SIM.snap), list = dummies.filter(d => d.corpse > 0 && dist(d.pos, S.at) <= r).slice(0, S.R ? 4 : 1 + S.spent);
      const st = S.dmg?.stats || {}, life = durOf(S) || SIM.minionTime, emp = st['power_charged_zombie_hit_damage_+%_final'];
      const raise = (X, p) => { limit(o => o.kind === S.name, st.base_number_of_zombies_allowed); minion(X, p, life, { kind: S.name }); };
      if (!list.length && emp != null && charges.power > 0) { charges.power--; for (let k = 0; k < 3; k++) raise(k ? S : { ...S, mult: S.mult * (1 + emp / 100) }, around(S.at, 1)); return say(t('{0}: {1} raised from corpses', S.label, 3), S.el); }
      if (!list.length) return toast(t('{0} needs a corpse: kill an enemy or press C', S.label));
      for (const d of list) { const p = { x: d.pos.x, z: d.pos.z }; eat(d, S.el); raise(S, p); }
      say(t('{0}: {1} raised from corpses', S.label, list.length), S.el);
    },
    // A totem uses its gem's own attack or spell (Shockwave Totem, Artillery Ballista), or a meta totem the gem in it (Mortar
    // Cannon's Cluster Grenade), with the damage and speed calc.js gives it as the totem's; up to the build's totem limit.
    // Without that damage it hits for the scene's share, drawn "~".
    totem(S) {
      const j = api.build().gems.findIndex((_, j) => api.usedBy(j) === S.g), F = j >= 0 && mk(j) || S, real = Object.keys(F.dmg?.hits || {}).length > 0;
      const mine = objs.filter(o => o.totemOf === S.name && !o.dead); if (mine.length >= (F.dmg?.totems || 2)) mine[0].die();
      const c = S.at, f = makeTotem(fx, S.el, S.P.ballista), TS = { ...F, src: real ? 'totemHit' : 'totem' }, R = F.R || S.R || SIM.totemArea, far = S.P.ballista || S.P.ranged;
      const every = real && F.dmg.speed ? 1 / F.dmg.speed : far ? 1 : 1.3;
      f.group.position.set(c.x, 0, c.z); f.group.rotation.y = facing; scene.add(f.group);
      fx.ring(c, .2, 1.3, S.el, .4); fx.emit(18, { p: { x: c.x, y: .1, z: c.z }, r: .5, v: 1.5, up: 1.5, life: .6, size: .5, grow: 2, c: 'dust', smoke: true, a: .4 });
      let wait = .5;
      const e = { pos: f.group.position, r: .4, dead: false, s: 0, totemOf: S.name,
        update(dt) {
          e.s += dt; if (e.s > (sh(S).totem || SIM.totemTime)) { e.die(); return; }
          if ((wait -= dt) > 0) return;
          const d = near(e.pos, far ? 12 : R + 1); if (!d) { wait = .2; return; }
          wait = every;
          const k = dist(d.pos, e.pos) || 1, a0 = f.group.rotation.y = Math.atan2(d.pos.x - e.pos.x, d.pos.z - e.pos.z), n = far ? sh(F).projectiles || 1 : 1;
          if (F.kind === 'grenade') K.grenade({ ...TS, origin: { x: e.pos.x, z: e.pos.z }, at: { x: d.pos.x, z: d.pos.z } });
          else if (far) for (let i = 0; i < n; i++) { const a = a0 + (i - (n - 1) / 2) * .12; shoot(TS, e.pos, Math.sin(a), Math.cos(a), { speed: 22, range: 13 }); }
          else { fx.ring(e.pos, .3, R, S.el, .4); fx.disc(e.pos, R, S.el, .3, { a: .35 }); area(e.pos, R, TS, real ? {} : { mult: .6 }); }
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
      const P = S.P, to = S.at, from = { x: pp.x, z: pp.z };
      const land = () => {
        if (S.R || P.attack) boom(to, S.A, S); else fx.ring(to, .2, 1.6, S.el, .4);
        if (P.ground) ground(P.ground, to, S.A, P.dur, S);
        if (P.slams) slammed(S, to, S.A);
        if (P.jump) landed(S, to);
      };
      if (P.blink && !P.jump) {
        fx.pillar(from, .5, 3, S.el, .3); fx.emit(20, { p: { x: from.x, y: 1, z: from.z }, r: .3, v: 2, life: .4, size: .2, c: S.el, c2: 'white' });
        fx.bolt(V(from.x, 1, from.z), V(to.x, 1, to.z), S.el, .2, .05, .15);
        pp.x = to.x; pp.z = to.z; fx.pillar(to, .6, 3.5, S.el, .35); land();
      } else move = { from, to, k: 0, dur: P.jump ? .45 : .22, h: P.jump ? 2.6 : 0, S, land, seen: new Set() };
    },
    nova(S) {
      const P = S.P; let c = S.src ? S.at : S.from;
      if (P.from) { const q = objs.find(o => o.proj && o.name === P.from && !o.dead); if (q) { c = { x: q.pos.x, z: q.pos.z }; say(t('{0} erupts from {1}', S.label, labelOf(P.from)), S.el); } }
      const R = stageR(S), dur = Math.min(.5, .12 + R * .045);
      fx.ring(c, .2, R, S.el, dur + .15, { k: 2.8 }); fx.disc(c, R, S.el, dur + .25, { a: .35 }); fx.flash(c, S.el, 30 + R * 10, .35, 6 + R * 2);
      fx.emit(Math.min(120, 20 + R * 14), { p: { x: c.x, y: .4, z: c.z }, v: R / dur * .8, flat: true, life: dur, size: .22, c: S.el, c2: 'white', drag: .5 });
      for (const d of inside(c, R)) later(dist(d.pos, c) / R * dur, () => hit(d, S));   // the wave reaches the near ones first
      later(dur * .5, () => touch(c, R, S));
      if (P.ground) later(dur, () => ground(P.ground, c, R, Math.min(P.dur || GROUND_TIME[P.ground] || SIM.groundTime, 8), S));
      const X = S.infs?.includes('cold') && infPart(S, 'cold');   // Ice Nova: a patch of Chilled Ground
      if (X) later(dur, () => { boom(c, X.A, X, { soft: true }); ground('chilled', c, X.A, GROUND_TIME.chilled, X); });
    },
    slam(S) {
      const P = S.P, c = S.at, R = stageR(S);
      later(.12, () => {
        slammed(S, c, R); boom(c, R, S); fx.disc(c, R * 1.1, 0x0a0806, 5, { dark: true, tex: 'cracks', a: .85, hold: .6, y: .032, spin: 0 });
        // Starborn Onslaught: its fissures, lasting its duration up to its limit, and its stars falling one after another
        // (its first delay, its delay) between its inner and outer radius around the impact (its explosion part)
        // note: the branching of its fissures is not drawn
        const st = S.dmg?.stats || {}, stars = st.empyrean_descent_number_of_explosions, X = stars && partOf(S, 'StarbornOnslaughtExplosions');
        if (stars) for (let k = 0; k < (st.base_number_of_fissures || 1); k++) fissure(S, c, Math.atan2(S.dx, S.dz) + k * TAU / st.base_number_of_fissures, 5, .8, .5, { dur: sh(S).duration || st.base_skill_effect_duration / 1000, max: st.volcanic_fissure_base_maximum_number_of_fissures });
        else if (P.fissure) for (let j = -1; j <= 1; j++) fissure(S, c, Math.atan2(S.dx, S.dz) + j * .5, 5);
        if (X) for (let k = 0; k < stars; k++) later((st.empyrean_descent_secondary_explosions_initial_delay_ms + k * st.empyrean_descent_secondary_explosions_delay_ms) / 1000, () => {
          const a = rnd(TAU), r = rnd(st.empyrean_descent_secondary_explosions_inner_radius / 10, st.empyrean_descent_secondary_explosions_outer_radius / 10), q = V(c.x + Math.sin(a) * r, 0, c.z + Math.cos(a) * r);
          fx.streak(V(q.x + 2, 13, q.z - 1.5), q, 'cold', .16, .07, 1.8); later(.16, () => { pop(q, X.A, 'cold'); area(q, X.A, X); });
        });
        // the earthen object it leaves: Earthshatter's spike where its fissure ends, Forge Hammer's hammer where it lands
        if (P.earthen) { const spike = !!st.spike_slam_max_spikes; earth(S, spike ? { x: c.x + S.dx * 5, z: c.z + S.dz * 5 } : c, spike ? st.spike_slam_max_spikes : st.forge_hammer_maximum_hammers, spike); }
        if (P.ground) ground(P.ground, c, R * 1.15, P.dur, S);
        if (P.aftershock) { fx.telegraph(c, R * 1.5, S.el, 1.6); later(1.6, () => { say(t('Aftershock of {0}', S.label), S.el); boom(c, R * 1.5, { ...S, mult: S.mult * 1.5 }); }); }
        if (P.fan && S.spent) { const a0 = Math.atan2(S.dx, S.dz), n = 1 + S.spent * 2; for (let i = 0; i < n; i++) { const a = a0 + (i - (n - 1) / 2) * .22; shoot({ ...S, aoe: false, P: { ...P, explodes: false } }, c, Math.sin(a), Math.cos(a), { speed: 20, range: 11 }); } }
      });
    },
    strike(S) {
      const P = S.P, reach = strikeR(S), n = P.dash ? Math.max(1, S.spent) : 1;
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
      go(first, 0);
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
      for (const d of inside(c, R)) { const da = Math.atan2(d.pos.z - c.z, d.pos.x - c.x) - a0; if (Math.abs(Math.atan2(Math.sin(da), Math.cos(da))) <= half) hit(d, S); }
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
      } else {   // eruptions that walk away from you; the last one is the big one
        const n = 6, st = Math.max(1, R * 2);
        for (let i = 1; i <= n; i++) later(i * .09, () => {
          const p = { x: c.x + S.dx * st * i, z: c.z + S.dz * st * i }, last = i === n;
          fx.pillar(p, R * .5, 1.5 + i * .25, S.el, .3, 2.4); boom(p, R * (last ? 1.8 : 1 + i * .08), S, { soft: !last, noPay: !last, mult: last ? 1 : .5 });
        });
      }
    },
    storm(S) {
      const P = S.P, c = S.at, st = S.dmg?.stats || {}, dur = sh(S).duration || Math.min(P.dur || 4, 10);
      if (P.wind) return vortex(S, c, S.A, dur);
      // its own limit, impact interval (and variance), fall time and re-hit interval on one enemy (Firestorm, Icestorm,
      // Thunderstorm); the scene's when a storm gives none
      const max = Object.entries(st).find(([k]) => /_max(?:imum)?_number_of_storms$/.test(k))?.[1] || 2, every = (st.fire_storm_fireball_delay_ms ?? st.lightning_storm_hit_frequency_ms ?? 170) / 1000,
        vary = (st.lightning_storm_hit_frequency_variance_ms || 0) / 1000, fall = (st.firestorm_fall_time_ms ?? 160) / 1000,
        again = (st.rain_hit_delay_ms ?? st.lightning_storm_hit_prevention_duration_ms ?? 0) / 1000, hitAt = new Map();
      limit(o => o.stormOf === S.name, max);
      // Firestorm's consumed Infusions: Fire, a larger area and more frequent bolts; Cold and Lightning, their own bolts too
      const fi = S.infs?.includes('fire'), G0 = stormGeo(S), Z = G0.Z + (fi ? (st['firestorm_secondary_radius_+_if_consumed_fire_infusion'] || 0) / 10 : 0), R = G0.R;
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
      if (P.corpse) { c = useCorpse(S); if (!c) return; }
      fx.ring(c, .2, R, S.el, .45);
      if (P.ground) { ground(P.ground, c, R, dur, S); area(c, R, S, { mult: .5 }); return; }
      const dec = fx.decal(c, R, P.plant ? 'cracks' : 'rune', S.el, { a: .55, spin: P.plant ? 0 : .3 }); let tk = 0;
      const z = thing(holder(c), dur, { name: S.name, plant: P.plant && S, c, R,
        tick(dt, e) {
          if (e.plant) presence(e);
          if (Math.random() < dt * R * 8) fx.emit(1, { p: { x: c.x, y: .05, z: c.z }, r: R * .9, v: .2, up: 1.4, life: .7, size: .22, c: S.el });
          if ((tk -= dt) > 0) return; tk = .5;
          area(c, R, { ...S, self: e }, { mult: .25, noPay: e.s > .6, noTouch: true });
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
      if (P.repeats) { const st = S.dmg?.stats || {}, n = (st.empower_barrage_base_number_of_barrage_repeats ?? 2) + (st.empower_barrage_number_of_barrage_repeats_per_frenzy_charge ?? 1) * S.spent;
        empower = empower.filter(e => e.type !== 'repeat'); empower.push({ type: 'repeat', flag: P.repeats, n, less: st['empower_barrage_damage_-%_final_with_repeated_projectiles'] || 0, label: S.label, name: S.name, s: sh(S).duration || 12 }); say(t('{0}: your next skill repeats {1} times', S.label, n), 'gold'); }
      else if (P.empowers && P.els.length) { empower = empower.filter(e => e.type !== 'infuse'); empower.push({ type: 'infuse', el: P.els[0], label: S.label, name: S.name, s: 12 }); say(t('{0}: your next attack gains {1}', S.label, t(cap(P.els[0]))), P.els[0]); }
      else { setBuff({ label: S.label, name: S.name, c: css(S.el), s: P.dur || 6 }); say(t('{0} active', S.label), S.el); }
    },
    area(S) {
      const P = S.P, R = S.A; let c = S.at;
      if (P.corpse) { c = useCorpse(S); if (!c) return; }
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
        const Y = { ...X, mult: X.mult * (e.stat.rarity === 'unique' ? 1 + (st['snap_damage_+%_final_if_created_from_unique'] || 0) / 100 : 1) };
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
  // a Banner: placed where you stand for its duration, its Aura granting you its buff while you are within its area
  // (its base_skill_buff_<stat>_to_apply), one of each Banner at a time
  K.banner = S => {
    const st = S.dmg?.stats || {}, give = Object.fromEntries(Object.entries(st).flatMap(([k, v]) => { const m = k.match(/^base_skill_buff_(.+)_to_apply$/); return m ? [[m[1], v]] : []; }));
    for (const o of objs) if (o.banner && o.name === S.name) o.dead = true;
    const c = { x: pp.x, z: pp.z }, g = holder(c), R = S.A, ring = fx.decal(c, R, 'outline', 'gold', { a: .35, rot: 0 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.04, .05, 3.2), new THREE.MeshStandardMaterial({ color: 0x6a5a3a })); pole.position.y = 1.6;
    const flag = new THREE.Mesh(new THREE.BoxGeometry(.04, 1.1, .8), new THREE.MeshStandardMaterial({ color: fx.color(S.el === 'physical' ? 'gold' : S.el, 1), emissive: 0x201000 })); flag.position.set(0, 2.5, .42);
    g.add(pole, flag); fx.ring(c, .2, R, 'gold', .5); say(t('{0} active', S.label), 'gold');
    thing(g, durOf(S), { name: S.name, banner: give, R, c, tick(dt) { flag.rotation.y = Math.sin(time * 2) * .15; }, off: () => ring.remove() });
  };
  // what the Banners you stand in grant: their buff's stat, summed
  const banner = k => objs.reduce((n, o) => n + (o.banner && !o.dead && dist(o.c, pp) <= o.R ? o.banner[k] || 0 : 0), 0);
  function untoggle(k) { const T = tog[k]; if (!T) return; T.decal?.remove(); T.objs.forEach(o => { o.dead = true; }); delete tog[k]; }

  // ---------- using a skill
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
    if (C && ready.length >= (S.dmg.uses || 1)) return false;
    Object.assign(S, o);
    aim(S, o.at || cursor);
    if (!auto) {
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
      if (arc && S.infs.includes('lightning')) { S.mult *= 1 + arc / 100; S.addChains = st.arc_chains_gained_from_infusion_consumption || 0; }
      if (fs && S.infs.includes('fire')) S.mult *= 1 + fs / 100 * (S.dmg.incW?.fire ?? 1);   // "increased", against the skill's own
      if (!inhib) for (const c of P.spend) if (charges[c]) { S.gm *= 1 + ((ch[c]?.per || 0) * charges[c] + (ch[c]?.when || 0)) / 100; S.spent += charges[c]; charges[c] = 0; }
      if (S.spent) { say(t('{0} spends {1} charges', S.label, S.spent), 'gold'); }
      if (S.stage != null && !P.ownStages) { S.mult *= 1 + 2 * S.stage; if (S.perfect) { S.mult *= 1.5; S.aoe = true; fx.text({ x: pp.x, y: 2.6, z: pp.z }, t('Perfect timing!'), css('gold')); } }
      if (P.channel && !P.stages) S.mult *= SIM.channelHit;
      facing = Math.atan2(S.dx, S.dz); castAt = time; player.cast(1); player.setColor(S.el); goal = null; walk = false;
      if (P.absorbs) S = absorb(S, pp, 1);
      // what was waiting for this skill: an element from a buff, the aftershock of a warcry, the repeats of Barrage / Unleash
      const hits = !NOHIT.has(S.kind);
      for (let k = empower.length - 1; k >= 0; k--) {
        const E = empower[k];
        if (E.type === 'infuse' && P.attack && hits) {
          S.els = [...new Set([...S.els, E.el])]; S.el = E.el; S.ail = [...new Set([...S.ail, ...ailOf([E.el])])]; empower.splice(k, 1);
          say(t('{0} gains {1} from {2}', S.label, t(cap(E.el)), E.label), E.el);
        } else if (E.type === 'echo' && P.attack && P.melee && hits) { S.echo = E.label; S.echoN = 1 + (P.slams ? E.slam : 0); if (--E.uses <= 0) empower.splice(k, 1); }
        else if (E.type === 'repeat' && P[E.flag]) { S.rep = E.n; S.repBy = E.label; S.repX = 1 - E.less / 100; empower.splice(k, 1); }
        else if (E.type === 'spark' && P.attack) { K.projectile({ ...E.X, from: S.from, dx: S.dx, dz: S.dz, P: { ...E.X.P, wander: true } }); if (--E.uses <= 0) empower.splice(k, 1); }
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
      const per = S.dmg?.costPerSecond ? o.held ?? SIM.channelTick : 1, cost = (S.dmg?.cost || 0) * per, LP = S.dmg?.lifePerRecent,
        life = (S.dmg?.lifeCost || 0) * per + (LP ? me.maxL * Math.min(LP.max, LP.pct * used.filter(u => u.name === S.name && time - u.t <= RECENT).length) / 100 : 0);
      if (cost > me.mana) { toast(t('Not enough mana for {0}', S.label)); return false; }
      const WC = S.dmg?.stats?._cost?.Ward || 0;   // a Runic Ward cost (Conductive Runes)
      if (WC > me.ward) { toast(t('Not enough Runic Ward for {0}', S.label)); return false; }
      if (WC) spendWard(WC);
      if (life && life >= me.life) { toast(t('Not enough life for {0}', S.label)); return false; }   // a life cost cannot kill you
      // Incinerate's fuel: it needs its least to start and burns one second per second channelled
      const FS = S.dmg?.stats, fuel = FS?.incinerate_maximum_fuel, F = me.fuel[S.name] || 0;
      if (fuel && (F <= 0 || !fueling(S.name) && F < FS.incinerate_minimum_fuel_to_use / 1000)) { toast(t('Not enough fuel for {0}', S.label)); return false; }
      if (fuel) { me.fuel[S.name] = F - (o.held ?? SIM.channelTick); me.fuelAt[S.name] = time; }
      me.mana -= cost; me.life -= life; gainRage(sheet().rage?.gain.use); if (life > 0) gloryPaid('life', life, S.name);
      if (cost > 0) fuelUp(S, cost);
    }
    // how far you moved and how long you stood still before this use (Momentum, Dauntless); Rageforged's Rage spent
    S.moved = me.walked || 0; S.still = time - (me.movedAt ?? -99); me.walked = 0;
    if (!auto && S.dmg?.enrage && me.rage >= S.dmg.enrage) { me.rage -= S.dmg.enrage; S.enraged = true; }
    // charges the supports consume on use (calc.js onUse): one each, all of them for Rally; Perpetual Charge may keep
    // them, Heightened Charges may double what they give; Medved's Felling costs life per 5 Rage
    const U = !auto && S.dmg?.onUse; nextCdX = 1;
    if (U) {
      const take = (c, every) => { const n = every ? charges[c] : Math.min(1, charges[c]); if (!n) return 0; if (!(Math.random() * 100 < U.keep)) charges[c] -= n; return n * (Math.random() * 100 < U.double ? 2 : 1); };
      let n;
      if (U.speed && (n = take('frenzy'))) nextCdX = 1 + U.speed * n / 100;
      if (U.breakPct && (n = take('frenzy'))) S.breakPct = U.breakPct * n;
      if (U.crit && (n = take('power'))) S.critX = 1 + U.crit * n / 100;
      if (U.curse && (n = take('power'))) S.curseX = 1 + U.curse * n / 100;
      if (U.lifePerEndurance && (n = take('endurance', true))) me.life = Math.min(me.maxL, me.life + me.maxL * U.lifePerEndurance * n / 100);
      if (U.lifePerCooldown && C) me.life = Math.min(me.maxL, me.life + me.maxL * U.lifePerCooldown * C / 1000 / 100);   // Second Wind III
      if (U.lifePer5Rage) me.life = Math.max(1, me.life - me.maxL * U.lifePer5Rage * Math.floor(me.rage / 5) / 100);
    }
    if (C) ready.push(time + C / 1000);
    for (let k = !auto && S.dmg?.stats?.verisium_infusion_skill_number_of_verisium_infusion_to_grant || 0; k > 0; k--) infGain('verisium', pp);   // Powered by Verisium
    const run = K[S.kind] || K.area;
    run(S);
    if (!auto && (P.slams || S.kind === 'warcry' || S.name === 'Shield Charge')) for (const o of [...objs]) if (o.segs && !o.dead) o.shatter(P.slams ? 'slam' : 'warcry');
    // Trickster's Shard: a spell you cast leaves a Fractured Mimic where you cast it, for its duration; at their limit they
    // all cast their spells, with their less damage, and are gone
    const TS = !auto && S.P.spell && S.dmg?.trig?.find(T => T.stats?.support_tricksters_shard_maximum_active_mimics);
    if (TS) {
      const M = me.mimics = me.mimics.filter(m => m.until > time), less = 1 + TS.support['skill_used_by_fractured_mimic_spell_damage_+%_final'] / 100;
      M.push({ S: { ...S, mult: S.mult * less }, run, until: time + (TS.shape?.duration || TS.stats.base_skill_effect_duration / 1000) }); fx.ring(S.from, .2, .8, S.el, .5);
      if (M.length >= TS.stats.support_tricksters_shard_maximum_active_mimics) { say(api.info({ name: TS.id }).label, S.el); for (const m of M.splice(0)) m.run(m.S); }
    }
    used.push({ name: S.name, elemental: S.elemental, t: time }); while (used[0]?.t < time - RECENT) used.shift();
    if (S.echo) for (let k = 1; k <= S.echoN; k++) later(.42 * k, () => { say(t('Aftershock of {0} ({1})', S.label, S.echo), 'gold'); shake = Math.max(shake, .25); run({ ...S, mult: S.mult * .7, echo: null, spent: 0 }); });
    if (S.rep) { say(t('{0} repeats {1} times ({2})', S.label, S.rep, S.repBy), 'gold'); for (let k = 1; k <= S.rep; k++) later(k * .16, () => { player.cast(1); run({ ...S, rep: 0, mult: S.mult * S.repX, from: { x: pp.x, z: pp.z } }); }); }
    // an Orb of Storms nearby answers your spells with a bolt of its own ("when you cast a Spell near the Orb")
    if (!auto && S.P.spell) for (const ob of objs) if (ob.zap && !ob.dead && ob.name !== S.name && dist(ob.pos, pp) <= ob.r) ob.zap(true);
    return true;
  }
  // Glory (keywords.json): each skill that requires it builds its own, up to what it requires, from its Glorious actions:
  // the Power of the enemy (its % of it) once every 0.5 s per enemy, not while that skill is active (but a Banner), or
  // its % of the Ward or of the life you spend; it loses 2 a second after 15 s without gaining any, and is spent on use
  const GLORY_EVERY = .5, GLORY_IDLE = 15, GLORY_LOSS = 2, ELEM = new Set(['fire', 'cold', 'lightning']);
  const trinity = () => { const i = tog.Trinity ? byName('Trinity') : -1; return i >= 0 ? base(i)?.dmg?.stats : null; };
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
      const st = gst(S), k = (st[`active_skill_generates_mp_%_glory_per_${ev}`] || 0) + (st[`active_skill_hundred_times_generates_glory_per_${ev}`] || 0);
      const seen = d.gloryAt ||= {}; if (!k || time - (seen[S.name] ?? -9) < GLORY_EVERY) continue;
      seen[S.name] = time; gloryAdd(S, k / 100 * (POWER[d.stat.rarity] || 1));
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
    let t = (sp > 0 ? clamp(1 / sp, .15, 3) : SIM.castTime) / nextCdX;
    if (c && !(Math.random() < c.keep) && (clips[b.name] = (clips[b.name] ?? c.bolts) - 1) <= 0) { clips[b.name] = c.bolts; t += c.reload; reloads.push({ t: time + t, n: c.bolts }); while (reloads[0]?.t < time - 8) reloads.shift(); }
    return t;
  };
  function press(i, key) {
    const b = api.byHand(i) && base(i); if (!b || move) return;
    held = null;
    if (b.P.stages && b.P.channel) { charge = { i, s: 0 }; held = { i, key }; return; }   // charge while held, release to fire
    if (b.P.toggle || b.kind === 'field') { use(i); return; }
    if (ONCE.has(b.kind)) { if (cd <= 0 && use(i)) cd = useTime(b); return; }
    held = { i, key };
    if (cd <= 0) fire(i);
  }
  function release() {
    const c = charge; charge = null; held = null;
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
      if (d) { d.st.freeze = 0; kill(d, NONE); say(t('Corpse made: skills that need a corpse can use it'), 'gold'); }
      else toast(t('Point at an enemy to turn it into a corpse'));
    }
    else if (c === K.charges) { for (const k in charges) { charges[k] = maxC(k); chargeAt[k] = time; } fx.ring(pp, 1.8, .3, 'gold', .4); say(t('Charges filled'), 'gold'); }
    else if (c === K.roll) roll();
  });
  // the roll: where W A S D or the stick move you, else toward the cursor, as the game's
  function roll() {
    if (move || rollCd > 0 || stuck()) return;
    const fx0 = cursor.x - pp.x, fz0 = cursor.z - pp.z, l = Math.hypot(fx0, fz0);
    const dx = steer ? steer.x : l > .1 ? fx0 / l : Math.sin(facing), dz = steer ? steer.z : l > .1 ? fz0 / l : Math.cos(facing);
    move = { from: { x: pp.x, z: pp.z }, to: { x: pp.x + dx * 3.6, z: pp.z + dz * 3.6 }, k: 0, dur: .3, h: .25 }; rollCd = .7; facing = Math.atan2(dx, dz); charge = held = goal = null;
    fx.emit(10, { p: { x: pp.x, y: .1, z: pp.z }, r: .3, v: 1, up: .6, life: .6, size: .5, grow: 2, c: 'dust', smoke: true, a: .35 });
    event('dodge', near(pp, 30)?.pos || pp, NONE);
  }
  addEventListener('keyup', e => { keys[e.code] = false; unhold(e.code); if (e.key === 'Alt' && !el.hidden) e.preventDefault(); });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; orbit = walk = false; if (held) release(); });
  dom.addEventListener('mousemove', e => {
    aimMouse(e); inputOf(false);
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
      case 'nova': case 'warcry': circle(pp, S.kind === 'nova' ? stageR(S) : S.A); break;
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
      const g = gems[i], inf = api.info(g), P = prof(g, inf), GN = gloryNeed(base(i)), gl = GN && Math.floor(me.glory[g.name] || 0);
      return `<button class="s-slot${i === sel ? ' on' : ''}${tog[g.name] ? ' act' : ''}${GN && gl < GN ? ' dim' : ''}" data-k="${k}" data-i="${i}" style="--c:${css(P.el)}">${inf.icon ? `<img src="${esc(inf.icon)}" alt="" draggable="false" onerror="this.remove()">` : ''}<span>${esc(inf.label.slice(0, 3))}</span>${GN ? `<i class="gl" title="${esc(t('Glory'))}">${gl}/${Math.ceil(GN)}</i>` : ''}<b>${keyLabel(k)}</b></button>`;
    }).join('') : `<span class="note">${t(gems.length ? 'No skill of the build is used by hand: they are always on.' : 'Add skills in the Skills tab.')}</span>`));
    put(buffEl, effects()); put(badEl, ailing());
    put(logEl, logs.filter(l => time - l.at < 9).map(l => `<div style="--c:${l.c}"${time - l.at > 5 ? ' class="old"' : ''}>${esc(l.text)}${l.n > 1 ? ` ×${l.n}` : ''}</div>`).join(''));
    keysText();
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
    for (const k in tog) { const T = tog[k]; b.push(one(icon(k), css(T.el), T.label, T.kind === 'meta' ? `${T.energy}/${T.need}` : k === 'Trinity' ? [...ELEM].map(e => Math.floor(me.aff[e])).join('/') : k === 'Arctic Armour' ? Math.floor(me.arctic) : '')); }   // Trinity: its Affinity, fire / cold / lightning
    for (const E of empower) b.push(one(icon(E.name), css(E.el || 'gold'), E.label, E.uses > 1 ? E.uses : '', E.s));
    for (const B of buffs) b.push(one(B.img || icon(B.name), B.c, B.label, '', B.s));
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
    if (d.mark && (d.mark.s -= dt) <= 0) { const M = d.mark; d.mark = null; if (M.bomb) { trigger(M.S, 'mark', d); bombed(M, d.pos); } }
    for (let i = d.dots.length - 1; i >= 0; i--) if ((d.dots[i].s -= dt) <= 0) d.dots.splice(i, 1);
    if (d.pustule) pustule(d, dt);
    if ((d.tick -= dt) <= 0) {   // damage over time: ignite, poison, bleeding and the skills' own, one number per tick
      d.tick = .5; let n = 0, past = 0, sim = false, el = 'chaos', best = 0;
      const add = (v, noEs) => { const k = v.dps * shocked(d); n += k; if (noEs) past += k; sim ||= v.sim; if (v.dps > best) { best = v.dps; el = v.el; } };
      for (const a in AIL_DOT) if (st[a] > 0 && d.burn[a]) add(d.burn[a], a !== 'ignite');
      d.dots.forEach(v => add(v));
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
    const sig = Math.ceil(d.life / d.max * 48) + ':' + (d.maxEs ? Math.ceil(d.es / d.maxEs * 48) : '') + pips.join('');
    if (sig !== d.sig) { d.sig = sig; f.draw({ life: d.life / d.max, es: d.maxEs ? d.es / d.maxEs : null, pips }); }
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
  function hurt(n, chaos, el, crit, d) {
    if (!(n > 0)) return;
    if (me.st.shock > 0) { const k = 1 + me.mag.shock / 100; n *= k; chaos *= k; }   // shocked, you take more damage
    stats.taken += n; me.hurt = time; shake = Math.min(.45, shake + .1); gainRage(sheet().rage?.gain.hurt);
    const c = el === 'physical' ? 'blood' : el;
    if (Math.round(n) >= 1) fx.num({ x: pp.x + rnd(-.2, .2), y: 2.2, z: pp.z }, '−' + short(n) + (crit ? '!' : ''), css(c), crit ? .62 : .46, !!crit);
    fx.emit(6, { p: { x: pp.x, y: 1.1, z: pp.z }, v: 2.2, up: 1, life: .3, size: .12, c, c2: 'white', drag: 2 });
    if (!me.known) return;   // without the class base life there is no pool to empty: the numbers still show what gets through
    if (me.guard > 0) { const g = Math.min(me.guard, n), k = 1 - g / n; me.guard -= g; n *= k; chaos *= k; }   // a charm's guard takes it before anything
    // energy shield takes the damage first; chaos damage removes twice as much of it
    const other = n - chaos; let e = Math.min(me.es, other), left = other - e; me.es -= e;
    e = Math.min(me.es, chaos * 2); me.es -= e; left += chaos - e / 2;
    me.life -= left;
    // Runic Ward (keywords.json): damage that would take your life to 0 leaves you at 1, the ward taking the rest
    if (me.life < 1 && me.ward >= 1 - me.life) { spendWard(1 - me.life); me.life = 1; }
    if (me.life <= 0) died(d?.mon.name || '?');
  }
  // The attack of the enemy d reaches you: evade (its accuracy against your evasion), block, crit, then armour and resistances
  // Thorns (keywords.json): a melee attack that hits you is dealt your thorns back, a Hit of yours (calc.js character
  // thorns: its damage, crit, the build's ailments), with the cold thorns Nature's Exchange adds (by your thorns increases).
  // Quill Burst: after you retaliate, the supported skill's next hits (its count) burst for your thorns around the target.
  // Morrigan's Insight: the supported skill's hit on a frozen enemy consumes the freeze for Nature's Exchange (its cooldown):
  // its Guard and cold thorns for its duration
  const THORN_P = profile({ name: 'Thorns', tags: ['physical'] }, {});
  function thornsOf() {
    const T = sheet().thorns || { hits: {} }, N = buffs.find(b => b.thorns), hits = { ...T.hits };
    if (N) hits.cold = N.thorns.map(x => x * (T.thornsX || 1));
    return Object.values(hits).some(([, hi]) => hi > 0) ? { ...T, hits } : null;
  }
  const thornX = (D, label) => { const els = Object.keys(D.hits).filter(e => D.hits[e][1] > 0); return { name: 'Thorns', label, P: THORN_P, G: {}, A: SIM.area, dmg: { attack: false, dot: {}, trig: [], ...D }, src: 'thorns', el: els.find(e => e !== 'physical') || els[0], els, ail: [], mult: 1, gm: 1, spent: 0 }; };
  // Arctic Armour: while on, a stage every its interval you stand still, up to its most; a melee hit you take removes one
  // for a burst of ice at the attacker, its cold damage per stage the barrier had
  // note: that damage as the gem gives it, without your spell modifiers
  const arcticS = () => { const i = tog['Arctic Armour'] ? byName('Arctic Armour') : -1; return i >= 0 ? base(i) : null; };
  function arctic(d) {
    const S = arcticS(), n = Math.floor(me.arctic); if (!S || !n || d.dead) return;
    const st = S.dmg.stats; me.arctic--; fx.ring(pp, .2, 1.6, 'cold', .35);
    hit(d, { ...S, dmg: { ...S.dmg, hits: { cold: [st.arctic_armour_minimum_added_cold_damage_per_stack * n, st.arctic_armour_maximum_added_cold_damage_per_stack * n] } } }, { noPay: true });
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
  function struck(d) {
    const a = d.atk, c = withCharms(sheet());
    if (d.dead || me.safe > 0 || !a.hasHit) return;
    if (move && !move.S && !a.area) return fx.text(above(), t('Dodged'), GREY, .32);   // the dodge roll avoids strikes and projectiles
    if (Math.random() * 100 >= hitChance(d.stat.accuracy, (c.evasion || 0) * (me.st.maim > 0 ? 1 - MAIM.evasion / 100 : 1))) return fx.text(above(), t('Evaded'), GREY, .32);
    if (Math.random() * 100 < blockChance(c, a)) { fx.ring(pp, .4, 1.1, 'white', .25, { a: .6 }); return fx.text(above(), t('Blocked'), GREY, .32); }
    // a curse that lowers their damage (Enfeeble)
    const crit = Math.random() * 100 < a.crit, cm = (crit ? 1 + a.critBonus / 100 : 1) * (1 + (d.curse?.C?.damage || 0) * (d.curse?.k || 0) / 100);
    let total = 0, chaos = 0, top = d.col, best = 0; const raw = {}, dealt = {};
    for (const el in a.hits) {
      const [lo, hi] = a.hits[el], got = playerTakes(c, el, raw[el] = (lo + Math.random() * (hi - lo)) * cm);
      dealt[el] = got; total += got; if (el === 'chaos') chaos += got; if (got > best) { best = got; top = el; }
    }
    hurt(total, chaos, top, crit, d);
    if (me.safe > 0) return;   // not after the hit killed you
    resolve(d); if (a.melee) { retaliate(d); arctic(d); } ailed(d, raw, dealt);
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
    fx.text(above(), t(a === 'stun' ? 'Light Stun' : STATE[a]), css(PIP[a]), .34); fx.ring(pp, .2, 1, PIP[a], .3); hudT = 0;
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
    const AE = banner('armour_evasion_+%_final'), MR = banner('additional_maximum_all_elemental_resistances_%');
    if (AE || MR) c = { ...c, armour: c.armour * (1 + AE / 100), evasion: (c.evasion || 0) * (1 + AE / 100), res: MR && c.res ? Object.fromEntries(Object.entries(c.res).map(([e, r]) => [e, e === 'chaos' ? r : { ...r, max: r.max + MR, capped: Math.min(r.max + MR, r.value) }])) : c.res };
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
    if (d.st.freeze > 0 || d.st.stun > 0 || d.st.electrocute > 0) { d.wind = null; return; }   // frozen, heavily stunned and electrocuted enemies cannot act
    // chill and a curse's slower actions (Temporal Chains) slow everything they do
    let k = (d.st.chill > 0 ? 1 - (d.mag.chill ?? CHILL_MIN) * d.stat.slowEffect / 100 : 1) * (1 + (d.curse?.C?.speed || 0) * (d.curse?.k || 0) / 100);
    if (k < 1) dt *= Math.max(SLOW_FLOOR, k);
    // Maim slows only their movement, a slow too: with chill, never under SLOW_FLOOR of their speed
    const ks = Math.max(SLOW_FLOOR, Math.min(1, k)), maim = d.st.maim > 0 ? Math.max(SLOW_FLOOR / ks, 1 - (d.mag.maim ?? MAIM.move) * d.stat.slowEffect / 100) : 1;
    d.wait -= dt;
    if (d.wind) { if ((d.wind.s -= dt) <= 0) { const w = d.wind; d.wind = null; w.land(); } return; }
    if (me.safe > 0) return;
    const far = dist(d.pos, pp), R = reachOf(d), v = (d.mon.speed || 0) / 10 * maim;
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
    const c = sheet(), L = c.life || 0, E = c.es || 0; me.known = c.life != null;
    if (L !== me.maxL) { me.life = me.maxL ? me.life / me.maxL * L : L; me.maxL = L; }
    if (E !== me.maxE) { me.es = me.maxE ? me.es / me.maxE * E : E; me.maxE = E; }
    const W = c.ward || 0; if (W !== me.maxW) { me.ward = me.maxW ? me.ward / me.maxW * W : W; me.maxW = W; }
    if (me.ward < W) me.ward = Math.min(W, me.ward + W * WARD_REGEN / 100 * dt);   // overflowed ward stays
    const FC = banner('flask_charge_per_min'); if (FC) flasks().forEach((f, n) => { if (f) me.fl[n] = Math.min(f.max, flaskLeft(n) + FC / 60 * dt); });
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
    if (c.lifeRegen > 0 && me.life < L) me.life = Math.min(L, me.life + c.lifeRegen * dt);
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
      pp.x = m.from.x + (m.to.x - m.from.x) * m.k; pp.z = m.from.z + (m.to.z - m.from.z) * m.k; pp.y = Math.sin(m.k * Math.PI) * m.h;
      if (m.S) {
        fx.emit(2, { p: { x: pp.x, y: pp.y + .8, z: pp.z }, r: .3, v: .5, life: .35, size: .3, c: m.S.el, c2: 'white' });
        if (!m.h) for (const d of dummies) if (!d.dead && !m.seen.has(d) && dist(d.pos, pp) <= 1 + SIM.body) { m.seen.add(d); hit(d, m.S, { mult: .6, noPay: true }); }
      }
      if (m.k >= 1) { pp.y = 0; move = null; m.land?.(); }
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
    for (const d of dummies) { tickDummy(d, dt); think(d, dt); }
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
