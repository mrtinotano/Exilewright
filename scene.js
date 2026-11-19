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
const ailOf = els => els.flatMap(e => e === 'cold' ? ['chill', 'freeze'] : AILMENT[e] ? [AILMENT[e]] : []);
const ONCE = new Set(['buff', 'warcry', 'mark', 'curse', 'orb', 'wall', 'totem', 'raise']);   // one use per key press
const NOHIT = new Set(['curse', 'mark', 'aura', 'herald', 'meta', 'buff', 'warcry', 'minion', 'raise', 'field']);
const AREAL = new Set(['area', 'nova', 'slam', 'rain', 'grenade', 'orb', 'curse', 'warcry', 'zone', 'storm', 'dot', 'meteor', 'wave', 'sweep', 'cone']);
const PIP = { ignite: 'fire', chill: 'cold', freeze: 'ice', shock: 'lightning', poison: 'poison', bleed: 'blood', armour: 'dust', stun: 'white', expo: 'gold', curse: 'curse', mark: 'mark', electrocute: 'lightning', pin: 'dust', maim: 'blood' };
// The game's ailment rules (GameConstants in monsters.json), and the few its tables do not hold: the glossary's (keywords.json)
const GC = GAME.game || {};
const BROKEN = { time: 12, taken: 20 };   // note: keywords.json ArmourBreak: Fully Broken for 12 s, +20% physical damage taken from hits
const EXPO = { time: 4, res: 20 };        // note: keywords.json Exposure: -20% elemental resistances for 4 s by default
const CHILL_MIN = 30;                     // note: keywords.json Chill: a chill under 30% is ignored
const MAIM = { move: 30, evasion: 15, time: 4 };   // note: keywords.json Maim: 30% slower movement, 15% reduced evasion, 4 s
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
    st: {}, mag: {}, burn: {}, flam: [], bar: {}, lock: {}, stuns: [], calm: 0, tick: .5, by: null, fl: [null, null], drink: [], cc: [null, null, null], cu: [], guard: 0 };   // your pools: life and energy shield against their attacks, mana for your skills, Rage; the ailments their hits put on you
  const camS = { yaw: 0, pitch: .93, dist: 21 }, camT = V(), cursor = V(0, 0, 6);
  const keys = {}, mouse = new THREE.Vector2(), ray = new THREE.Raycaster(), plane = new THREE.Plane(V(0, 1, 0), 0);
  const stats = { kills: 0, dealt: 0, taken: 0, deaths: 0 }, charges = { frenzy: 0, power: 0, endurance: 0 }, chargeAt = {}, tog = {};
  let sel = 0, time = 0, shake = 0, facing = 0, castAt = -9, cd = 0, rollCd = 0, orbit = false, placing = false, walk = false, goal = null;   // goal: where a click on the ground sends you
  let dummies = [], objs = [], grounds = [], hazards = [], timers = [], empower = [], buffs = [], logs = [];
  let held = null, charge = null, move = null, toastT = 0, hudT = 0;

  // ---------- HUD
  const hud = el.querySelector('#hud') || el.appendChild(Object.assign(document.createElement('div'), { id: 'hud' }));
  const div = (cls, into = el) => into.appendChild(Object.assign(document.createElement('div'), { className: cls }));
  // laid out like the game's screen: your effects top left, the keys and statistics behind a button top right, life
  // (and energy shield) in the left orb and mana in the right one with their numbers over them, the skills by the mana orb
  const top = div('s-top'), col = div('s-col', top), buffEl = div('s-buffs', col), badEl = div('s-buffs', col), help = top.appendChild(Object.assign(document.createElement('button'), { className: 's-help', textContent: '?' }));
  help.title = t('Keys and statistics of the simulator'); hud.hidden = true; el.appendChild(hud);
  help.onclick = () => { hud.hidden = !hud.hidden; help.classList.toggle('on', !hud.hidden); };
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
  const prof = (g, inf) => { let P = profs.get(g.name); if (!P) profs.set(g.name, P = profile(inf.gem || { name: g.name }, inf.data || {})); return P; };
  function base(i) {
    const g = api.build().gems[i]; if (!g) return null;
    const c = cache.get(i); if (c && c.g === g && time - c.at < .5) return c.S;
    const inf = api.info(g), G = api.geo(g), P = prof(g, inf);
    const R = P.radiusBonus ? SIM.orbBlast + G.radius : G.radius;
    let els = P.els.length ? [...P.els] : P.attack ? ['physical'] : [], ail = [...P.applies], col = P.el;
    // gas and oil only burn once something sets them alight
    if (P.ground === 'gas' || P.ground === 'oil') { els = els.filter(e => e !== 'fire'); ail = ail.filter(a => a !== 'ignite'); col = P.ground === 'gas' ? 'gas' : 'dust'; }
    const S = { i, g, P, G, kind: P.kind, name: g.name, label: inf.label, el: col, els, ail, mult: 1, gm: 1, spent: 0, R, A: R || SIM.area, aoe: P.explodes || (inf.gem?.tags || []).includes('area'), dmg: api.damage?.(g) || null };
    cache.set(i, { g, at: time, S }); return S;
  }
  const sh = S => S.dmg?.shape || {};   // the gem's own chains, projectiles and times (calc.js)
  const mk = i => { const b = base(i); return b && { ...b, els: [...b.els], ail: [...b.ail] }; };
  const byName = name => api.build().gems.findIndex(g => g.name === name);
  // What is used by hand gets a slot (calc.js byHand); persistent skills are on while their spirit is reserved, so the
  // scene turns them on in the build's order while the build's Spirit covers them (the game starts none it cannot reserve)
  const always = g => (api.info(g).gem?.types || []).includes('Persistent'), unpaid = new Set();
  const slots = () => api.build().gems.flatMap((_, i) => api.byHand(i) ? [i] : []);
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
  const coneHalf = S => (S.kind === 'cone' ? SIM.cone / 2 : 65) * Math.PI / 180;
  function aim(S, p) {
    const max = S.kind === 'grenade' ? SIM.throwRange : S.kind === 'travel' ? SIM.travelRange : S.kind === 'slam' ? SIM.meleeRange : SIM.castRange;
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
  const clean = d => { d.st = {}; d.burn = {}; d.dots = []; d.curse = d.mark = null; d.frz = d.brk = 0; d.flam = []; d.bar = {}; d.lock = {}; d.imm = {}; d.mag = {}; d.cut = 0; };
  const restore = d => {
    const f = d.fig; d.pos.set(d.home.x, 0, d.home.z); d.aggro = false; d.dead = false; d.life = d.max; d.es = d.maxEs; d.fall = d.corpse = d.back = 0; d.by = null; d.sig = ''; d.wind = null; d.wait = rnd(.6, 1.2);
    clean(d);
    f.upper.rotation.set(0, 0, 0); f.group.visible = f.plate.visible = true;
  };
  function wipe() { dummies.forEach(d => d.fig.dispose()); dummies = []; hudT = 0; }
  function heal() { const c = sheet(); me.maxL = c.life || 0; me.maxE = c.es || 0; me.maxM = c.mana || 0; me.life = me.maxL; me.es = me.maxE; me.mana = me.maxM; me.rage = 0; me.hurt = -9;
    Object.assign(me, { st: {}, mag: {}, burn: {}, flam: [], bar: {}, lock: {}, stuns: [], fl: [null, null], drink: [], cc: [null, null, null], cu: [], guard: 0 }); }
  // Rage (calc.js rageOf): Berserk's part only while it is on; gaining any holds off its loss for the delay
  const rageMax = () => { const R = sheet().rage; return R?.base ? R.base + (R.berserk && tog[R.berserk.name] ? R.berserk.max : 0) : 0; };
  function gainRage(n) { const M = rageMax(); if (!(n > 0) || !M) return; me.rage = Math.min(M, me.rage + n); me.raged = time; }
  // your death, by an enemy or by your own life loss: everything restored
  function died(by) { stats.deaths++; say(t('{0} killed you', by), 'blood'); toast(t('You died: life and energy shield restored')); fx.ring(pp, .3, 2.6, 'blood', .5); heal(); me.safe = 2; }
  function reset() {
    objs = objs.filter(o => o.keep || (o.remove(), false));
    grounds.forEach(g => g.decal.remove()); grounds = [];
    hazards.forEach(h => h.decal.remove()); hazards = [];
    timers = []; empower = []; buffs = []; charge = held = move = null; pp.y = 0;
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
      const acc = sheet().accuracy;
      if (acc > 0 && d.stat.evasion > 0 && Math.random() * 100 >= playerHitChance(acc, d.stat.evasion)) { fx.text(over(d), t('Miss'), '#9a968c', .3); return false; }
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
    const M = d.mark;
    if (M && M.bomb && S.src !== 'mark' && ++M.hits >= 4) { d.mark = null; later(.05, () => boom(d.pos, M.R, M.S)); }
    fx.emit(5, { p: chest(d), v: 2.5, up: 1, life: .3, size: .12, c: S.el, c2: 'white', drag: 2 });
    let total = 0, top = S.el, best = 0, crit = false;
    if (real) {
      // a mark adds to the critical damage bonus; the buff of a consumed Freezing / Voltaic Mark adds damage as extra cold / lightning
      crit = Math.random() * 100 < (D.crit || 0); const cm = crit ? 1 + ((D.critBonus || 0) + (M?.D?.crit || 0)) / 100 : 1, B = S.src !== 'minionHit' && buffs.find(b => b.gain)?.gain;
      for (const el in D.hits) { const [lo, hi] = D.hits[el]; raw[el] = (lo + Math.random() * (hi - lo)) * m * g * (el === 'physical' ? gp : 1) * cm; }
      if (B) raw[B.el] = (raw[B.el] || 0) + Object.values(raw).reduce((t, v) => t + v, 0) * B.pct / 100;
      for (const el in raw) { const got = takes(d, el, raw[el]); total += got; if (got > best) { best = got; top = el; } }
    } else total = (d.max + d.maxEs) / 8 * m * g * shocked(d);
    // a mark that grants a charge (Sniper's Mark) is consumed by your critical hit
    if (M?.gain && d.mark === M && crit && own) {
      d.mark = null; fx.ring(d.pos, .3, 1.5, 'mark', .35);
      say(t('{0} consumes {1}', S.label, M.label), 'mark'); gainCharge(M.gain, M.label);
    }
    floatN(d, total, top, { sim: !real || Math.abs(m - 1) > .001, crit });
    if (!S.src) { const G = sheet().rage?.gain; gainRage((G?.hit || 0) + (P.attack ? G?.attack || 0 : 0) + (P.melee ? G?.melee || 0 : 0)); }
    d.by = S; damage(d, total, S);
    if (d.dead) return true;
    if (real) afflict(d, S, raw, { crit, stunX }); else for (const a of S.ail) if (!A?.never?.[a]) inflict(d, a, S);
    if (P.dotHit) dot(d, S);
    event('hit', d.pos, S);
    return true;
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
    if (!fresh) return;
    const MD = d.mark?.D;   // Freezing / Voltaic Mark: the state it builds up consumes it and grants you its buff
    if (MD?.gain && (a === 'freeze' && MD.freeze || a === 'electrocute' && MD.electrocute)) {
      const M = d.mark; d.mark = null; buffs = buffs.filter(b => !b.gain);
      buffs.push({ label: M.label, name: M.name, c: css(MD.gain.el), s: MD.gain.time, gain: MD.gain }); say(t('{0} consumes {1}', S.label, M.label), 'mark');
    }
    const p = chest(d);
    if (a === 'freeze') { fx.text(over(d), t(STATE[a]), css('ice'), .36); fx.emit(22, { p, r: .3, v: 1.6, up: 1, life: .6, size: .16, c: 'ice', c2: 'white', g: 5 }); fx.ring(d.pos, .2, 1.1, 'ice', .35); }
    else if (a === 'stun') { fx.text(over(d), t(STATE[a]), '#f2ead8', .36); fx.ring(d.pos, .2, 1.2, 'white', .3); d.wind = null; }
    else if (a === 'armour') { fx.text(over(d), t(STATE[a]), css('dust'), .34); fx.emit(16, { p, v: 3, up: 2, life: .6, size: .1, c: 0xb0a898, g: 12, k: 1.2 }); }
    else if (a === 'electrocute' || a === 'pin') { fx.text(over(d), t(STATE[a]), css(PIP[a]), .36); fx.ring(d.pos, .2, 1.1, PIP[a], .3); if (a === 'electrocute') d.wind = null; }
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
    return enemyTakes(st, el, r, isHit) * (isHit && el === 'physical' && d.st.armour > 0 ? 1 + BROKEN.taken / 100 : 1);
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
    if (x('lightning') && !N.shock && (AL.shock || roll(x('lightning') / thr * GC.ShockChanceMultiplier * A.shockChance))) {
      inflict(d, 'shock', S, 1, raw, { dur: DUR.shock * A.shockTime, mag: GC.BaseShockMagnitude * A.shockEffect }); ex(['lightning'], E.onShock);
    }
    if (x('cold')) {
      const mag = Math.min(GC.ChillMaxEffect, GC.ChillEffectMultiplier * x('cold') * A.chillDamage / thr * A.chillEffect);
      if (mag >= CHILL_MIN) inflict(d, 'chill', S, 1, raw, { dur: DUR.chill * A.chillTime, mag });
      if (!N.freeze) AL.freeze ? inflict(d, 'freeze', S, 1, null, { dur: DUR.freeze * A.freezeTime }) : build(d, 'freeze', x('cold') * GC.FreezeDamageScale * A.freeze * (1 + (d.mark?.D?.freeze || 0) / 100), S, A);
      if (o.crit) ex(['cold'], E.onColdCrit);
    }
    if (A.electrocute) build(d, 'electrocute', x('lightning') * GC.ElectrocuteDamageScale * A.electrocute * (1 + (d.mark?.D?.electrocute || 0) / 100), S, A);
    if (A.pin) build(d, 'pin', Object.values(raw).reduce((t, v) => t + v, 0) * GC.PinDamageScale * A.pin, S, A);
    const all = Object.entries(raw).reduce((t, [e, v]) => t + v * (e === 'physical' ? A.stunPhys : 1), 0);
    if (!N.stun) AL.stun ? inflict(d, 'stun', S, 1, null, { dur: DUR.stun }) : build(d, 'stun', all * A.stunMelee * GC.HeavyStunDamageScale * A.stun * (o.stunX || 1), S, A);
    if (x('physical') && !N.bleed && roll(A.bleed)) inflict(d, 'bleed', S, 1, raw, { dur: DUR.bleed * A.bleedTime, eff: A.bleedEffect });
    if ((x('physical') || x('chaos')) && roll(A.poison)) inflict(d, 'poison', S, 1, raw, { dur: DUR.poison * A.poisonTime, eff: A.poisonEffect });
    if (E.hit) expo(d, ELEM, E.hit * E.effect, (E.hitMs || DUR.expo * 1000) / 1000);
    const brk = N.armour ? 0 : (A.breakFlat + x('physical') * A.breakPct / 100) * A.breakMore;
    if (brk > 0 && d.stat.armour > 0 && !(d.st.armour > 0)) {
      d.cut = (d.cut || 0) + brk * (d.stat.rarity === 'normal' ? A.breakNormal : d.stat.rarity === 'magic' ? A.breakMagic : 1);
      if (d.cut >= d.stat.armour) { d.cut = 0; inflict(d, 'armour', S, 1, raw, { dur: BROKEN.time }); }
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
    d.by = S;
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
  function kill(d, S) {
    d.dead = true; stats.kills++; if (!S?.src) gainRage(sheet().rage?.gain.kill);
    const r = d.stat.rarity || 'normal';   // the kill refills your flasks
    flasks().forEach((f, n) => { if (f) me.fl[n] = Math.min(f.max, flaskLeft(n) + POWER[r] * FLASK_GAIN[r] * f.gain); });
    charms().forEach((f, n) => { if (f) me.cc[n] = Math.min(f.max, charmLeft(n) + POWER[r] * CHARM_GAIN * f.gain); });
    if (r === 'rare' || r === 'unique') charmUse('killing_rare_or_unique_enemy');
    const st = d.st, p = { x: d.pos.x, z: d.pos.z }, frozen = st.freeze > 0, M = d.mark, f = d.fig;
    // heralds: an enemy that dies with the ailment of their element explodes
    for (const k in tog) {
      const T = tog[k], a = T.kind === 'herald' && AILMENT[T.P.el];
      if (a && st[a] > 0) later(.1, () => herald(T, p));
    }
    if (M?.bomb) later(.06, () => { say(t('{0} explodes on the kill', M.label), 'mark'); boom(p, M.R, M.S); });
    const sp = d.dots.find(o => o.spread);
    if (sp) {   // Contagion jumps to the neighbours and carries the other chaos debuffs with it
      const carry = d.dots.filter(o => o.spread || o.chaos), list = dummies.filter(e => !e.dead && dist(e.pos, p) <= 3.5);
      for (const e of list) { fx.bolt(V(p.x, 1, p.z), chest(e), 'chaos', .28, .03, .4); for (const o of carry) if (!e.dots.some(x => x.name === o.name)) e.dots.push({ ...o, s: 5, ...dotOf(e, o.S) }); e.by = S; }
      if (list.length) say(t('{0} spreads to {1} enemies', sp.label, list.length), 'chaos');
    }
    if (S.P.gain && !S.P.corpse && !S.src && !['aura', 'mark'].includes(S.P.kind)) gainCharge(S.P.gain, S.label);
    event('kill', p, S);
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
    const p = { x: d.pos.x, z: d.pos.z }; eat(d, S.el); if (S.P.gain) gainCharge(S.P.gain, S.label);
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
  function chain(from, d, S, n, seen = new Set()) {
    const to = chest(d);
    fx.bolt(from, to, S.el, .18); fx.flash(to, S.el, 12, .2, 6);
    seen.add(d); hit(d, S, { mult: seen.size > 1 ? .8 : 1 });
    if (n <= 0) return;
    later(.07, () => {
      // a lightning rod within reach takes the bolt and pulses over its whole area
      if (S.els.includes('lightning')) for (const o of objs) if (o.rod && !o.dead && !seen.has(o) && o !== S.self && dist(o.pos, d.pos) <= SIM.chainRange) { seen.add(o); fx.bolt(to, V(o.pos.x, 1.7, o.pos.z), S.el, .18); o.pulse(S); break; }
      const e = near(d.pos, SIM.chainRange, e => !seen.has(e));
      if (e) chain(to, e, S, n - 1, seen);
    });
  }
  function ground(type, c, r, dur, S) {
    if (grounds.length >= 40) grounds[0].dead = true;
    const [col, tex, dark] = GFX[type];
    const decal = fx.decal(c, r, tex, col, { a: dark ? .85 : .5, dark, k: 1.2, pulse: dark ? 0 : 5, y: .031 + (grounds.length % 20) * .0005 });
    grounds.push({ type, x: c.x, z: c.z, r, s: dur || GROUND_TIME[type] || SIM.groundTime, tick: .2, S, decal, dead: false });
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
  const tint = (m, c) => m.traverse(x => { if (x.material) x.material.color.copy(fx.color(c, x.isSprite ? 1.5 : 3)); });
  function shoot(S, from, dx, dz, o = {}) {
    const G = S.G, P = S.P, speed = o.speed || G.speed || SIM.projSpeed, slow = !o.speed && (speed < 5.5 || P.spiral || P.wind);
    const cr = Math.max(.15, G.collision || 0), m = P.attack && !P.wind ? fx.arrow(S.el) : fx.orb(S.el, slow ? .26 : .14);
    let left = o.range || (G.speed ? G.range : SIM.projRange), pulse = .2, cur = S, a0 = Math.atan2(dx, dz), trail = 0;
    m.position.set(from.x, 1.1, from.z); m.rotation.y = a0; scene.add(m);
    const seen = new Set();
    const end = hitD => {
      q.dead = true; const p = { x: m.position.x, z: m.position.z };
      if (P.chains && hitD) chain(m.position.clone(), hitD, cur, sh(cur).chains || SIM.chains);
      else if (P.explodes || S.aoe) boom(p, S.A, cur);
      else if (hitD) { hit(hitD, cur); touch(p, .5, cur); fx.flash(m.position, cur.el, 8, .15, 4); }
      else fx.emit(6, { p: m.position, v: 1.5, life: .3, size: .14, c: cur.el });
    };
    const q = { pos: m.position, r: cr, dead: false, proj: true, name: S.name,
      update(dt) {
        if (P.wander) { a0 += rnd(-1, 1) * 9 * dt; dx = Math.sin(a0); dz = Math.cos(a0); m.rotation.y = a0; }
        let stepLeft = Math.min(left, speed * dt); left -= stepLeft; trail += stepLeft;
        while (stepLeft > 0 && !q.dead) {
          const s = Math.min(.3, stepLeft); stepLeft -= s; m.position.x += dx * s; m.position.z += dz * s;
          if (!cur.fired) for (const w of objs) if (w.wall && w.fire && !w.dead && segDist(m.position, w.a, w.b) < .45) {   // through a wall of fire
            cur = { ...cur, els: [...new Set([...cur.els, 'fire'])], el: 'fire', ail: [...new Set([...cur.ail, 'ignite'])], fired: true }; tint(m, 'fire');
            say(t('{0} gains fire through {1}', S.label, w.label), 'fire'); break;
          }
          for (const d of dummies) if (!d.dead && !seen.has(d) && dist(d.pos, m.position) <= cr + SIM.body) {
            seen.add(d);
            if (slow) hit(d, cur); else { end(d); break; }
          }
        }
        if (q.dead) return;
        fx.emit(slow ? 2 : 1, { p: m.position, v: .4, life: .35, size: slow ? .3 : .16, c: cur.el, c2: 'white', drag: 1 });
        if (slow) {
          if (P.absorbs) { const n = absorb(cur, m.position, Math.max(S.R, .6)); if (n !== cur) { cur = n; tint(m, cur.el); } }
          if (P.ground && trail > 1.4) { trail = 0; ground(P.ground, m.position, .8, 4, cur); }
          if (S.R && (pulse -= dt) <= 0) { pulse = .35; fx.ring(m.position, .2, S.R, cur.el, .3, { a: .6 }); area(m.position, S.R, cur, { mult: .5 }); }
        }
        if (left <= 0) end(null);
      },
      remove() { fx.drop(m); } };
    objs.push(q); return q;
  }
  function minion(S, p, life) {
    // a minion with the damage of its own (calc.js minionOf) attacks at its speed; else the scene's half hit every 1.1 / 1.5 s
    const f = makeMinion(fx, S.el), real = !!S.dmg?.minion && Object.keys(S.dmg.hits).length > 0, MS = real ? { ...S, src: 'minionHit' } : { ...S, src: 'minion', mult: .5 }, ranged = S.P.ranged;
    f.group.position.set(p.x, 0, p.z); scene.add(f.group);
    fx.ring(p, .2, 1, S.el, .4); fx.emit(14, { p: { x: p.x, y: .2, z: p.z }, r: .4, v: .6, up: 2.5, life: .6, size: .2, c: S.el });
    let wait = rnd(.3, 1), sw = 0;
    const e = { pos: f.group.position, r: .3, dead: false, keep: life === Infinity, s: 0,
      update(dt) {
        e.s += dt; wait -= dt; sw = Math.max(0, sw - dt * 4); f.arm.rotation.x = -1 - Math.sin(sw * Math.PI) * 1.2;
        if (e.s >= life) { e.dead = true; return; }
        const d = near(e.pos, ranged ? 12 : 9), goal = d ? d.pos : pp, k = dist(goal, e.pos), stop = d ? (ranged ? 7 : 1.1) : 2.4;
        if (k > .05) f.group.rotation.y = Math.atan2(goal.x - e.pos.x, goal.z - e.pos.z);
        if (k > stop) { const v = Math.min(k - stop, 5.5 * dt); e.pos.x += (goal.x - e.pos.x) / k * v; e.pos.z += (goal.z - e.pos.z) / k * v; e.pos.y = Math.abs(Math.sin(e.s * 9)) * .05; }
        else if (d && wait <= 0) {
          wait = real && S.dmg.speed ? 1 / S.dmg.speed : ranged ? 1.5 : 1.1; sw = 1;
          if (ranged) shoot(MS, e.pos, (d.pos.x - e.pos.x) / k, (d.pos.z - e.pos.z) / k, { speed: 14, range: 13 });
          else { fx.sector(e.pos, d.pos.x - e.pos.x, d.pos.z - e.pos.z, 1.3, .8, S.el, .16, { a: .7 }); hit(d, MS); }
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
        later(rnd(.04, .14), () => { if (by.src !== 'crystal') say(t('{0}: the ice crystals explode ({1})', S.label, by.label), 'ice'); boom(p, S.A, { ...S, self: e, src: 'crystal' }); });
      },
      end: () => fx.emit(14, { p: { x: p.x, y: .7, z: p.z }, r: .2, h: .6, v: 2, life: .6, size: .14, c: 'ice', g: 9 }) });
  }
  function vortex(S, c, R, dur) {   // Tornado: drifts towards the enemies and takes the element of the ground it crosses
    const g = holder(c); let cur = S, tk = .2;
    const e = thing(g, dur, { name: S.name,
      tick(dt, e) {
        const p = g.position, col = cur.el === 'physical' ? 'dust' : cur.el;
        for (let i = 0; i < 3; i++) {
          const a = e.s * 9 + i * 2.1 + rnd(.6), h = rnd(3.4), rr = .2 + h * .28 * (R / 3 + .3);
          fx.emit(1, { p: { x: p.x + Math.cos(a) * rr, y: h, z: p.z + Math.sin(a) * rr }, dir: V(-Math.sin(a) * 3.5, 1.2, Math.cos(a) * 3.5), life: .45, size: .34, c: col, c2: 'white', k: cur.el === 'physical' ? 1.1 : 2.2 });
        }
        const d = near(p, 9);
        if (d) { const k = dist(d.pos, p); if (k > .3) { p.x += (d.pos.x - p.x) / k * 1.3 * dt; p.z += (d.pos.z - p.z) / k * 1.3 * dt; } }
        if (S.P.absorbs) cur = absorb(cur, p, R);
        if ((tk -= dt) <= 0) { tk = .4; fx.ring(p, R * .3, R, col, .35, { a: .45 }); area(p, R, { ...cur, self: e }, { mult: .4 }); }
      } });
  }
  function fissure(S, from, ang, len) {
    const dx = Math.sin(ang), dz = Math.cos(ang), b = { x: from.x + dx * len, z: from.z + dz * len };
    fx.strip(from, b, .9, 0x070605, 4, { dark: true, tex: 'beam', a: .9, y: .033 });
    for (let k = 1; k <= len; k++) later(k * .06, () => {
      const p = { x: from.x + dx * k, z: from.z + dz * k };
      pop(p, .8, S.el); fx.pillar(p, .25, 1.6, S.el, .25, 2.4); area(p, .8, S, { mult: .5, noPay: true, noTouch: true });
    });
  }
  function slash(S, dx, dz, r = 2, half = .95) {
    fx.sector(pp, dx, dz, r, half, S.el, .2, { k: 2.6, a: .85, grow: true });
    fx.emit(8, { p: { x: pp.x + dx, y: 1.1, z: pp.z + dz }, dir: V(dx * 4, 0, dz * 4), v: 2, life: .25, size: .16, c: S.el, c2: 'white', drag: 2 });
  }

  // ---------- how each kind of skill plays out. S carries the aim: S.from, S.at, S.dx, S.dz.
  const K = {
    projectile(S) {
      const n = (sh(S).projectiles || S.P.count || 1) + S.spent * 2, a0 = Math.atan2(S.dx, S.dz), spread = S.P.wander ? .45 : .13, h = hand();
      for (let i = 0; i < n; i++) { const a = a0 + (i - (n - 1) / 2) * spread; shoot(S, S.from, Math.sin(a), Math.cos(a)); }
      fx.glow(h, .9, S.el, .2);
    },
    chain(S) {
      const d = near(S.at, SIM.snap) || near(S.at, 6, e => dist(e.pos, S.from) <= SIM.castRange), h = hand();
      if (d) chain(h, d, S, sh(S).chains || SIM.chains);
      else { fx.bolt(h, V(S.at.x, .1, S.at.z), S.el, .18); pop(S.at, .6, S.el); touch(S.at, .6, S); }
    },
    rain(S) {
      const P = S.P, c = S.at, R = S.A, h = hand();
      const shot = land => lob(P.attack ? fx.arrow(S.el) : fx.orb(S.el, .13), h, V(c.x, .1, c.z), .42, 3.2, land, { trail: S.el });
      if (P.object) return shot(() => rod(S, c));
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
      for (const o of objs) if (o.orbOf === S.name) o.dead = true;   // one at a time
      const m = fx.orb(S.el, .3), range = fx.decal(c, R, 'outline', S.el, { a: .35, rot: 0 }); m.position.set(c.x, 1.3, c.z);
      fx.ring(c, .2, 1.4, S.el, .4);
      let tk = .4;
      const e = thing(m, dur, { r: R, orbOf: S.name, name: S.name,
        tick(dt, e) {
          m.position.y = 1.3 + Math.sin(e.s * 3) * .08; if (P.detonates) m.userData.core.scale.setScalar(.3 * (1 + e.s / dur * .7));
          if ((tk -= dt) > 0) return;
          if (P.detonates) { tk = .6; fx.ring(c, .3, R, S.el, .5, { a: .55 }); for (const d of inside(c, R)) { expo(d, ELEM, expoMag(S)); inflict(d, 'chill', S); } }   // pulses of exposure, then the blast
          else if (P.chains) { tk = .9; e.zap(); }
          else { tk = 1; fx.ring(c, .3, R, S.el, .5); area(c, R, { ...S, self: e, src: 'orb' }, { mult: .5 }); }
        },
        end: e => { if (P.detonates) boom(c, R, { ...S, self: e }); },
        off: () => range.remove() });
      if (P.chains) e.zap = extra => {
        const d = near(c, R); if (!d) return;
        if (extra) say(t('{0} fires an extra bolt', S.label), S.el);
        chain(V(c.x, m.position.y, c.z), d, { ...S, self: e, src: 'orb' }, 2);
      };
    },
    wall(S) {
      const P = S.P, c = S.at, L = SIM.wall / 2, px = -S.dz, pz = S.dx, dur = P.dur || SIM.lifetime;   // across the aim
      const a = { x: c.x - px * L, z: c.z - pz * L }, b = { x: c.x + px * L, z: c.z + pz * L };
      if (P.crystal) {
        for (let i = 0; i < 6; i++) { const k = i / 5, p = { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k }; later(i * .04, () => crystal(S, p, dur)); }
        for (const d of dummies) if (!d.dead && segDist(d.pos, a, b) <= .7 + SIM.body) hit(d, S);
        return;
      }
      const fire = S.els.includes('fire'); let tk = 0;
      fx.strip(a, b, 1.2, S.el, dur, { a: .6 });
      thing(holder(c), dur, { wall: true, fire, a, b, name: S.name, label: S.label,
        tick(dt, e) {
          for (let i = Math.ceil(dt * 100); i > 0; i--) { const k = rnd(); fx.emit(1, { p: { x: a.x + (b.x - a.x) * k, y: .05, z: a.z + (b.z - a.z) * k }, v: .3, up: fire ? 3.4 : 2.2, life: .6, size: .5, c: S.el, c2: fire ? 'ember' : 'white', drag: .5 }); }
          if ((tk -= dt) > 0) return; tk = .5;
          for (const d of dummies) if (!d.dead && segDist(d.pos, a, b) <= .7 + SIM.body) hit(d, { ...S, self: e }, { mult: .3, noPay: true });
        } });
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
          d.curse = { s: sh(S).duration || SIM.curseTime, label: S.label, C, k: (C?.effect ?? 1) * d.stat.curseEffect }; fx.emit(6, { p: chest(d), r: .3, v: .4, up: -1, life: .6, size: .2, c: 'curse' }); }
        if (n) say(t('{0}: {1} enemies cursed', S.label, n), 'curse');
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
      const c = S.from, R = S.A, col = S.P.els.length ? S.el : 'gold';
      fx.ring(c, .5, R, col, .55, { k: 2.8 }); fx.ring(c, .3, R * .7, 'white', .4, { a: .5 }); shake = Math.max(shake, .22);
      fx.emit(40, { p: { x: c.x, y: .3, z: c.z }, v: R * 2, flat: true, life: .4, size: .2, c: col, c2: 'white', drag: 1.5 });
      const list = inside(c, R);
      for (const d of list) { d.wob = 1; for (const a of ailOf(S.P.els)) inflict(d, a, S); }
      if (S.P.empowers) { empower = empower.filter(e => e.type !== 'echo'); empower.push({ type: 'echo', label: S.label, name: S.name, uses: 2, s: 12 }); say(t('{0}: your next melee attacks repeat as an aftershock', S.label), 'gold'); }
      if (S.P.gain && list.length) gainCharge(S.P.gain, S.label);
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
    raise(S) {
      const r = Math.max(S.A, SIM.snap), list = dummies.filter(d => d.corpse > 0 && dist(d.pos, S.at) <= r).slice(0, S.R ? 4 : 1 + S.spent);
      if (!list.length) return toast(t('{0} needs a corpse: kill an enemy or press C', S.label));
      for (const d of list) { const p = { x: d.pos.x, z: d.pos.z }; eat(d, S.el); minion(S, p, SIM.minionTime); }
      say(t('{0}: {1} raised from corpses', S.label, list.length), S.el);
    },
    // A totem uses its gem's own attack or spell (Shockwave Totem, Artillery Ballista), or a meta totem the gem in it (Mortar
    // Cannon's Cluster Grenade), with the damage and speed calc.js gives it as the totem's; up to the build's totem limit.
    // Without that damage it hits for the scene's share, drawn "~".
    totem(S) {
      const j = api.build().gems.findIndex((_, j) => api.usedBy(j) === S.g), F = j >= 0 && mk(j) || S, real = Object.keys(F.dmg?.hits || {}).length > 0;
      const mine = objs.filter(o => o.totemOf === S.name && !o.dead); if (mine.length >= (F.dmg?.totems || 2)) mine[0].dead = true;
      const c = S.at, f = makeTotem(fx, S.el, S.P.ballista), TS = { ...F, src: real ? 'totemHit' : 'totem' }, R = F.R || S.R || SIM.totemArea, far = S.P.ballista || S.P.ranged;
      const every = real && F.dmg.speed ? 1 / F.dmg.speed : far ? 1 : 1.3;
      f.group.position.set(c.x, 0, c.z); f.group.rotation.y = facing; scene.add(f.group);
      fx.ring(c, .2, 1.3, S.el, .4); fx.emit(18, { p: { x: c.x, y: .1, z: c.z }, r: .5, v: 1.5, up: 1.5, life: .6, size: .5, grow: 2, c: 'dust', smoke: true, a: .4 });
      let wait = .5;
      const e = { pos: f.group.position, r: .4, dead: false, s: 0, totemOf: S.name,
        update(dt) {
          e.s += dt; if (e.s > (sh(S).totem || SIM.totemTime)) { e.dead = true; return; }
          if ((wait -= dt) > 0) return;
          const d = near(e.pos, far ? 12 : R + 1); if (!d) { wait = .2; return; }
          wait = every;
          const k = dist(d.pos, e.pos) || 1, a0 = f.group.rotation.y = Math.atan2(d.pos.x - e.pos.x, d.pos.z - e.pos.z), n = far ? sh(F).projectiles || 1 : 1;
          if (F.kind === 'grenade') K.grenade({ ...TS, origin: { x: e.pos.x, z: e.pos.z }, at: { x: d.pos.x, z: d.pos.z } });
          else if (far) for (let i = 0; i < n; i++) { const a = a0 + (i - (n - 1) / 2) * .12; shoot(TS, e.pos, Math.sin(a), Math.cos(a), { speed: 22, range: 13 }); }
          else { fx.ring(e.pos, .3, R, S.el, .4); fx.disc(e.pos, R, S.el, .3, { a: .35 }); area(e.pos, R, TS, real ? {} : { mult: .6 }); }
        },
        remove() { fx.emit(14, { p: { x: e.pos.x, y: .8, z: e.pos.z }, r: .3, v: 1.4, up: 1, life: .6, size: .14, c: 0x5c4026, g: 8, k: 1 }); f.dispose(); } };
      objs.push(e);
    },
    travel(S) {
      const P = S.P, to = S.at, from = { x: pp.x, z: pp.z };
      const land = () => {
        if (S.R || P.attack) boom(to, S.A, S); else fx.ring(to, .2, 1.6, S.el, .4);
        if (P.ground) ground(P.ground, to, S.A, P.dur, S);
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
    },
    slam(S) {
      const P = S.P, c = S.at, R = stageR(S);
      later(.12, () => {
        boom(c, R, S); fx.disc(c, R * 1.1, 0x0a0806, 5, { dark: true, tex: 'cracks', a: .85, hold: .6, y: .032, spin: 0 });
        if (P.fissure) for (let j = -1; j <= 1; j++) fissure(S, c, Math.atan2(S.dx, S.dz) + j * .5, 5);
        if (P.ground) ground(P.ground, c, R * 1.15, P.dur, S);
        if (P.aftershock) { fx.telegraph(c, R * 1.5, S.el, 1.6); later(1.6, () => { say(t('Aftershock of {0}', S.label), S.el); boom(c, R * 1.5, { ...S, mult: S.mult * 1.5 }); }); }
        if (P.fan && S.spent) { const a0 = Math.atan2(S.dx, S.dz), n = 1 + S.spent * 2; for (let i = 0; i < n; i++) { const a = a0 + (i - (n - 1) / 2) * .22; shoot({ ...S, aoe: false, P: { ...P, explodes: false } }, c, Math.sin(a), Math.cos(a), { speed: 20, range: 11 }); } }
      });
    },
    strike(S) {
      const P = S.P, reach = (P.dash ? SIM.dashRange : SIM.meleeRange) + .6, n = P.dash ? Math.max(1, S.spent) : 1;
      const first = S.src ? near(S.at, 1) : near(S.at, SIM.snap, e => dist(e.pos, pp) <= reach);
      if (!first) return slash(S, S.dx, S.dz);   // nothing in reach: swings at the air
      const go = (d, k) => {
        if (d.dead) return;
        if (P.dash || dist(d.pos, pp) > SIM.meleeRange) {   // strikes that carry you to the target
          const a = Math.atan2(pp.x - d.pos.x, pp.z - d.pos.z) + (k ? rnd(-2, 2) : 0), q = { x: d.pos.x + Math.sin(a) * 1.1, z: d.pos.z + Math.cos(a) * 1.1 };
          fx.bolt(V(pp.x, 1, pp.z), V(q.x, 1, q.z), S.el, .2, .04, .1); pp.x = q.x; pp.z = q.z;
        }
        const dx = d.pos.x - pp.x, dz = d.pos.z - pp.z, l = Math.hypot(dx, dz) || 1;
        facing = Math.atan2(dx, dz); castAt = time; slash(S, dx / l, dz / l);
        if (S.R) { pop(d.pos, S.R, S.el); area(d.pos, S.R, S); } else { hit(d, S); touch(d.pos, .6, S); }
        if (k + 1 < n) later(.13, () => go(near(d.pos, 6, e => e !== d) || d, k + 1));
      };
      go(first, 0);
    },
    sweep(S) {
      const half = coneHalf(S), R = S.R || SIM.meleeRange, c = S.from, a0 = Math.atan2(S.dz, S.dx), ch = S.P.channel;
      fx.sector(c, S.dx, S.dz, R, half, S.el, ch ? .22 : .35, { grow: !ch, a: ch ? .45 : .7 });
      fx.emit(ch ? 7 : 24, { p: { x: c.x + S.dx * .8, y: 1, z: c.z + S.dz * .8 }, dir: V(S.dx * R * 2.2, .2, S.dz * R * 2.2), v: R * half * 1.1, life: .42, size: .32, c: S.el, c2: 'white', drag: .9 });
      for (const d of inside(c, R)) { const da = Math.atan2(d.pos.z - c.z, d.pos.x - c.x) - a0; if (Math.abs(Math.atan2(Math.sin(da), Math.cos(da))) <= half) hit(d, S); }
      touch({ x: c.x + S.dx * R * .55, z: c.z + S.dz * R * .55 }, R * .5, S);
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
      const P = S.P, c = S.at, R = S.A, dur = Math.min(P.dur || 4, 10);
      if (P.wind) return vortex(S, c, R, dur);
      const old = objs.filter(o => o.stormOf === S.name && !o.dead); if (old.length >= 2) old[0].dead = true;
      const Z = Math.max(R * 2.4, SIM.stormArea), out = fx.decal(c, Z, 'outline', S.el, { a: .4, rot: 0 }), bolt = S.els.includes('lightning');
      let tk = 0;
      thing(holder(c), dur, { stormOf: S.name, name: S.name,
        tick(dt, e) {   // impacts scattered over the area for as long as it lasts
          if ((tk -= dt) > 0) return; tk = .17;
          const a = rnd(TAU), r = Math.sqrt(rnd()) * Z, q = V(c.x + Math.cos(a) * r, 0, c.z + Math.sin(a) * r);
          if (bolt) fx.bolt(V(q.x + rnd(-1, 1), 12, q.z + rnd(-1, 1)), q, S.el, .2, .06, .5); else fx.streak(V(q.x + 2, 13, q.z - 1.5), q, S.el, .16, .07, 1.8);
          later(bolt ? 0 : .16, () => { pop(q, R, S.el); area(q, R, { ...S, self: e }, { mult: .6 }); });
        },
        off: () => out.remove() });
    },
    zone(S) {
      const P = S.P, R = S.A, dur = Math.min(P.dur || SIM.groundTime, 12); let c = S.at;
      if (P.corpse) { c = useCorpse(S); if (!c) return; }
      fx.ring(c, .2, R, S.el, .45);
      if (P.ground) { ground(P.ground, c, R, dur, S); area(c, R, S, { mult: .5 }); return; }
      const dec = fx.decal(c, R, P.plant ? 'cracks' : 'rune', S.el, { a: .55, spin: P.plant ? 0 : .3 }); let tk = 0;
      thing(holder(c), dur, { name: S.name,
        tick(dt, e) {
          if (Math.random() < dt * R * 8) fx.emit(1, { p: { x: c.x, y: .05, z: c.z }, r: R * .9, v: .2, up: 1.4, life: .7, size: .22, c: S.el });
          if ((tk -= dt) > 0) return; tk = .5;
          area(c, R, { ...S, self: e }, { mult: .25, noPay: e.s > .6, noTouch: true });
        },
        off: () => dec.remove() });
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
      if (P.repeats) { empower = empower.filter(e => e.type !== 'repeat'); empower.push({ type: 'repeat', flag: P.repeats, n: 2 + S.spent, label: S.label, name: S.name, s: 12 }); say(t('{0}: your next skill repeats {1} times', S.label, 2 + S.spent), 'gold'); }
      else if (P.empowers && P.els.length) { empower = empower.filter(e => e.type !== 'infuse'); empower.push({ type: 'infuse', el: P.els[0], label: S.label, name: S.name, s: 12 }); say(t('{0}: your next attack gains {1}', S.label, t(cap(P.els[0]))), P.els[0]); }
      else { buffs = buffs.filter(b => b.label !== S.label); buffs.push({ label: S.label, name: S.name, c: css(S.el), s: P.dur || 6 }); say(t('{0} active', S.label), S.el); }
    },
    area(S) {
      const P = S.P, R = S.A; let c = S.at;
      if (P.corpse) { c = useCorpse(S); if (!c) return; }
      if (P.stages && !P.els.length && P.dur) {   // a rune on the ground that only buffs (Sigil of Power)
        const dec = fx.decal(pp, R, 'rune', S.el, { a: .6, spin: .25 });
        thing(holder(pp), P.dur, { off: () => dec.remove() });
        buffs = buffs.filter(b => b.label !== S.label); buffs.push({ label: S.label, name: S.name, c: css(S.el), s: P.dur }); say(t('{0} active', S.label), S.el);
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
      const P = S.P, R = S.A, delay = P.delay ?? (P.dur && P.dur <= 4 ? P.dur : SIM.meteor);
      const d = P.attack ? near(S.at, SIM.snap) : null, c = d ? { x: d.pos.x, z: d.pos.z } : S.at;
      fx.telegraph(c, R, S.el, delay);
      if (S.els.includes('lightning') && !S.els.includes('fire')) return later(delay, () => { fx.bolt(V(c.x + 1, 17, c.z - 1), V(c.x, 0, c.z), S.el, .28, .13, .6); boom(c, R, S); });
      const fly = Math.min(.4, delay);
      later(delay - fly, () => lob(fx.orb(S.el, clamp(R * .3, .3, .9)), V(c.x + 6, 24, c.z - 5), V(c.x, .3, c.z), fly, 0, () => { boom(c, R, S); shake = .5; }, { trail: S.el, big: true }));
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
  function untoggle(k) { const T = tog[k]; if (!T) return; T.decal?.remove(); T.objs.forEach(o => { o.dead = true; }); delete tog[k]; }

  // ---------- using a skill
  function use(i, o = {}) {
    let S = mk(i); if (!S) return false;
    const P = S.P, auto = !!o.src;
    if (!auto && stuck()) return false;   // frozen or heavily stunned, you cannot act
    Object.assign(S, o);
    aim(S, o.at || cursor);
    if (!auto) {
      if (P.needsCharges && P.spend.length && !P.spend.some(c => charges[c] > 0)) { toast(t('{0} needs {1} charges (press G)', S.label, t(CHARGE[P.spend[0]]))); return false; }
      const ch = S.dmg?.ail?.charge || {};
      for (const c of P.spend) if (charges[c]) { S.gm *= 1 + ((ch[c]?.per || 0) * charges[c] + (ch[c]?.when || 0)) / 100; S.spent += charges[c]; charges[c] = 0; }
      if (S.spent) { say(t('{0} spends {1} charges', S.label, S.spent), 'gold'); }
      if (S.stage != null) { S.mult *= 1 + 2 * S.stage; if (S.perfect) { S.mult *= 1.5; S.aoe = true; fx.text({ x: pp.x, y: 2.6, z: pp.z }, t('Perfect timing!'), css('gold')); } }
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
        } else if (E.type === 'echo' && P.attack && P.melee && hits) { S.echo = E.label; if (--E.uses <= 0) empower.splice(k, 1); }
        else if (E.type === 'repeat' && P[E.flag]) { S.rep = E.n; S.repBy = E.label; empower.splice(k, 1); }
      }
    }
    if (!auto && me.maxM && !tog[S.name]) {
      const cost = (S.dmg?.cost || 0) * (S.dmg?.costPerSecond ? o.held ?? SIM.channelTick : 1);
      if (cost > me.mana) { toast(t('Not enough mana for {0}', S.label)); return false; }
      me.mana -= cost; gainRage(sheet().rage?.gain.use);
    }
    const run = K[S.kind] || K.area;
    run(S);
    if (S.echo) later(.42, () => { say(t('Aftershock of {0} ({1})', S.label, S.echo), 'gold'); shake = Math.max(shake, .25); run({ ...S, mult: S.mult * .7, echo: null, spent: 0 }); });
    if (S.rep) { say(t('{0} repeats {1} times ({2})', S.label, S.rep, S.repBy), 'gold'); for (let k = 1; k <= S.rep; k++) later(k * .16, () => { player.cast(1); run({ ...S, rep: 0, from: { x: pp.x, z: pp.z } }); }); }
    // an Orb of Storms nearby answers your lightning skills with a bolt of its own
    if (!auto && S.els.includes('lightning')) for (const ob of objs) if (ob.zap && !ob.dead && ob.name !== S.name && dist(ob.pos, pp) <= ob.r) ob.zap(true);
    return true;
  }
  function fire(i) {
    const b = base(i);
    if (b && use(i)) cd = b.P.channel && !b.P.stages ? SIM.channelTick : useTime(b); else { cd = .3; held = null; }
  }
  // seconds between uses: the attack / cast speed of the build when calc.js knows it, else the scene default
  const useTime = b => b.dmg?.speed > 0 ? clamp(1 / b.dmg.speed, .15, 3) : SIM.castTime;
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
      case 'strike': { const reach = (P.dash ? SIM.dashRange : SIM.meleeRange) + .6, d = near(cursor, SIM.snap, e => dist(e.pos, pp) <= reach); if (d) circle(d.pos, S.R || .7); else sector(2, .95); break; }
      case 'sweep': case 'cone': sector(S.R || SIM.meleeRange, coneHalf(S)); break;
      case 'beam': strip(pp, S.dx, S.dz, S.R || 10, 1); break;
      case 'wave': S.A > 3 ? strip(pp, S.dx, S.dz, S.A, 2.4) : strip(pp, S.dx, S.dz, Math.max(1, S.A * 2) * 6 + S.A, Math.max(.6, S.A * 2)); break;
      case 'wall': strip({ x: c.x + S.dz * SIM.wall / 2, z: c.z - S.dx * SIM.wall / 2 }, -S.dz, S.dx, SIM.wall, .6); break;
      case 'storm': circle(c, P.wind ? S.A : Math.max(S.A * 2.4, SIM.stormArea)); break;
      case 'slam': circle(c, stageR(S)); break;
      case 'totem': circle(c, P.ballista || P.ranged ? .6 : S.R || SIM.totemArea); break;
      case 'raise': circle(c, Math.max(S.A, SIM.snap)); break;
      case 'area': circle(S.R >= 6 ? pp : c, S.A); break;
      default: circle(c, S.A);
    }
  }

  // ---------- HUD text
  let spdC = { at: -9, v: 0 };
  const spd = () => { if (time - spdC.at > .5) spdC = { at: time, v: api.playerSpeed() }; return spdC.v; };
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
      const g = gems[i], inf = api.info(g), P = prof(g, inf);
      return `<button class="s-slot${i === sel ? ' on' : ''}${tog[g.name] ? ' act' : ''}" data-k="${k}" data-i="${i}" style="--c:${css(P.el)}">${inf.icon ? `<img src="${esc(inf.icon)}" alt="" draggable="false" onerror="this.remove()">` : ''}<span>${esc(inf.label.slice(0, 3))}</span><b>${keyLabel(k)}</b></button>`;
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
    if (S.dmg?.cost) rows.push(`${t('Cost')} ${S.dmg.costPerSecond ? fmt(S.dmg.cost, 1) + '/s' : short(S.dmg.cost)} ${t('Mana')}`);
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
    for (const k in tog) { const T = tog[k]; b.push(one(icon(k), css(T.el), T.label, T.kind === 'meta' ? `${T.energy}/${T.need}` : '')); }
    for (const E of empower) b.push(one(icon(E.name), css(E.el || 'gold'), E.label, E.uses > 1 ? E.uses : '', E.s));
    for (const B of buffs) b.push(one(icon(B.name), B.c, B.label, '', B.s));
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
    for (const k in st) if (st[k] > 0) st[k] -= dt;
    for (const k in d.lock) d.lock[k] -= dt;
    for (const k in d.imm) d.imm[k] -= dt;
    for (let i = d.flam.length - 1; i >= 0; i--) if ((d.flam[i].s -= dt) <= 0) d.flam.splice(i, 1);
    // the bars empty after a while without buildup (monster.ot poise decay)
    if ((d.calm += dt) * 1000 > GAME.poise_decay_delay_ms) for (const k in d.bar) d.bar[k] = Math.max(0, d.bar[k] - GAME.poise_decay_per_second * dt);
    if (d.curse && (d.curse.s -= dt) <= 0) d.curse = null;
    if (d.mark && (d.mark.s -= dt) <= 0) { const M = d.mark; d.mark = null; if (M.bomb) boom(d.pos, M.R, M.S); }
    for (let i = d.dots.length - 1; i >= 0; i--) if ((d.dots[i].s -= dt) <= 0) d.dots.splice(i, 1);
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
    if (me.life <= 0) died(d?.mon.name || '?');
  }
  // The attack of the enemy d reaches you: evade (its accuracy against your evasion), block, crit, then armour and resistances
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
    ailed(d, raw, dealt);
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
    const thr = Math.max(1, D.ail), more = (inc, fin) => (1 + (A[inc] || 0) / 100) * (1 + (A[fin] || 0) / 100), can = a => !immune(a) && !roll(D.avoid[a]);
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
        D.freeze, PL.FreezeDuration * D.dur.freeze);
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
    if (x('physical') && roll(A['local_chance_to_bleed_on_hit_%'] || 0) && can('bleed')) suffer('bleed', DUR.bleed * D.dur.bleed, { dot: dot('bleed', 'physical', x('physical')) });
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
    if (f.k === 'mana') return void (me.mana = Math.min(me.maxM, me.mana + n));
    me.life = Math.min(me.maxL, me.life + n); if (f.es) me.es = Math.min(me.maxE, me.es + n);
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
      rage: rageMax() ? [rageNow(), 0] : null, guard: charms().some(f => f?.guard) ? [me.guard, 0] : null,
      berserk: bz ? { v: [raging ? me.maxL * bz.lifePerRage / 100 * me.rage : 0, 0], name: api.info(api.build().gems.find(g => g.name === bz.name) || { name: bz.name }).label } : null,
      // the share of its damage per second a skill you use deals now: action speed, Rage on attacks, a mark's buff (not a
      // totem's or a minion's, nor one a meta gem uses: those act by themselves)
      dps: i => { const S = base(i), D = S?.dmg; return D && api.byHand(i) && !['totem', 'minion', 'raise'].includes(S.kind) ? act * (D.attack ? rageX(D) : 1) * (gain ? 1 + gain.pct / 100 : 1) : 1; },
    };
  }
  // your resistances with those of the charms in use
  function withCharms(c) {
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
    d.wait -= dt;
    if (d.wind) { if ((d.wind.s -= dt) <= 0) { const w = d.wind; d.wind = null; w.land(); } return; }
    if (me.safe > 0) return;
    const far = dist(d.pos, pp), R = reachOf(d), v = (d.mon.speed || 0) / 10;
    if (far <= (d.mon.aggro || 0) / 10) d.aggro = true;
    if (d.aggro && v > 0 && far > R * .8 && !(d.st.pin > 0) && !api.still?.()) {
      const k = Math.min(far - R * .7, v * dt) / far; d.pos.x += (pp.x - d.pos.x) * k; d.pos.z += (pp.z - d.pos.z) * k;
      for (const o of dummies) {   // they do not walk into each other
        if (o === d || o.dead) continue;
        const dx = d.pos.x - o.pos.x, dz = d.pos.z - o.pos.z, l = Math.hypot(dx, dz), min = SIM.body * 2 * Math.max(d.sc, o.sc);
        if (l < min && l > 1e-3) { d.pos.x += dx / l * (min - l); d.pos.z += dz / l * (min - l); }
      }
    }
    if (d.wait > 0 || dist(d.pos, pp) > R) return;
    d.wait = Math.max(.25, d.atk.interval); strike(d);
  }
  // your pools follow the build; life regenerates and the energy shield recharges after its delay without damage
  function vitals(dt) {
    const c = sheet(), L = c.life || 0, E = c.es || 0; me.known = c.life != null;
    if (L !== me.maxL) { me.life = me.maxL ? me.life / me.maxL * L : L; me.maxL = L; }
    if (E !== me.maxE) { me.es = me.maxE ? me.es / me.maxE * E : E; me.maxE = E; }
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
      if (g.dead || g.s <= 0) { g.decal.remove(); grounds.splice(i, 1); continue; }
      if (Math.random() < dt * (3 + g.r * g.r * 3)) groundFx(g);
      if (g.tick > 0) continue;
      g.tick = .5; const a = GAIL[g.type]; if (!a) continue;
      for (const d of dummies) if (!d.dead && dist(d.pos, g) <= g.r + SIM.body) inflict(d, a, g.S);
    }
    vitals(dt); tickHazards(dt);
    for (const c in charges) if (charges[c] && time - (chargeAt[c] ?? time) > CHARGE_TIME) charges[c] = 0;
    for (const d of dummies) { tickDummy(d, dt); think(d, dt); }
    for (const k in tog) {
      const T = tog[k]; T.decal?.move(pp);
      if (T.kind === 'herald' && Math.random() < dt * 14) { const a = time * 3 + rnd(TAU); fx.emit(1, { p: { x: pp.x + Math.cos(a) * .8, y: rnd(.2, 1.8), z: pp.z + Math.sin(a) * .8 }, v: .1, up: .8, life: .6, size: .16, c: T.el }); }
      if (T.kind === 'field') for (const d of dummies) if (!d.dead && dist(d.pos, pp) <= T.R + SIM.body) d.flash = Math.max(d.flash, .06);
    }
    for (let i = empower.length - 1; i >= 0; i--) if ((empower[i].s -= dt) <= 0) empower.splice(i, 1);
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
