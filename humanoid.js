// The player's figure: the mannequin of Quaternius' Universal Animation Library (CC0, mannequin.glb; the game's models
// are not something the app can read), the same whatever the build's class, holding the build's weapon, and the poses
// it plays. Its run, its roll and its fall are the library's clips; every other pose is the app's own. Purely
// cosmetic: scene.js decides when a skill takes effect; a clip only shows it. In every action clip k = 0 is the moment
// of the use and k = 1 the wind-up right before the next one, so a held skill swings into each of its uses.
import * as THREE from 'three';
import { KIND } from './skillfx.js';

const D = Math.PI / 180, TAU = Math.PI * 2, WHITE = new THREE.Color(1, 1, 1), clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = k => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };
const std = (color, roughness = .85, metalness = 0, o = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...o });

// ---------- poses: three numbers a joint, in degrees when written and radians when stored
// trunk joints: lean forward, turn left, bend left. arms and legs: raise forward, raise sideways, turn inward.
// elbows and knees: bend. pos: metres. x: the bow's draw (0 to 1).
const J = ['pos', 'body', 'hips', 'spine', 'chest', 'head', 'shL', 'elL', 'haL', 'shR', 'elR', 'haR', 'hipL', 'knL', 'ftL', 'hipR', 'knR', 'ftR', 'x'];
const JI = Object.fromEntries(J.map((n, i) => [n, i * 3])), N = J.length * 3, BOTH = { sh: 1, el: 1, ha: 1, hip: 1, kn: 1, ft: 1 };
const span = (...names) => names.flatMap(n => [JI[n], JI[n] + 1, JI[n] + 2]);
const LEFT = span('shL', 'elL', 'haL'), LEG = new Uint8Array(N), LEGS = new Set(['hips', 'hipL', 'knL', 'ftL', 'hipR', 'knR', 'ftR']);
for (const i of span('pos', 'body', ...LEGS)) LEG[i] = 1;
function pose(o, from) {
  const v = from ? Float32Array.from(from) : new Float32Array(N);
  for (const [k, x] of Object.entries(o)) for (const n of BOTH[k] ? [k + 'L', k + 'R'] : [k])
    (typeof x === 'number' ? [x] : x).forEach((y, i) => { v[JI[n] + i] = y * (n === 'pos' || n === 'x' ? 1 : D); });
  return v;
}
const STAND = { hip: [3, 7, 0], kn: 6, ft: 3 };
const LUNGE = { hipL: [38, 6, 0], knL: 48, ftL: 10, hipR: [-28, 6, 0], knR: 12, ftR: -18, pos: [0, -.1, .16] };   // left foot forward, weight on it
const BRACE = { hipL: [16, 8, 0], knL: 20, hipR: [-8, 10, 0], knR: 28, ftR: -8, pos: [0, -.05, -.05] };            // weight back, ready to go
const WIDE = { hipL: [6, 16, 0], hipR: [6, 16, 0], kn: 26, pos: [0, -.06, 0] };
const ARCHER = { hipL: [14, 10, 0], hipR: [-12, 12, -30], knL: 10, knR: 14, ftR: -6, pos: [0, -.02, 0], spine: [0, -22, 0] };   // left foot towards the target

// how each family of weapon is carried
const STANCE = Object.fromEntries(Object.entries({
  unarmed: { sh: [14, 12, 0], el: 42 },
  one: { shR: [22, 16, 0], elR: 62, haR: [-15, 0, 0], shL: [16, 10, 72], elL: 88 },
  two: { shR: [30, 10, 10], elR: 98, haR: [0, 0, 22], shL: [40, 0, 20], elL: 80, chest: [0, -10, 0], head: [0, 10, 0] },
  staff: { shR: [28, 14, 0], elR: 62, shL: [8, 10, 0], elL: 25 },
  wand: { shR: [20, 12, 0], elR: 84, haR: [-12, 0, 0], shL: [24, 10, 15], elL: 92 },
  spear: { shR: [26, 16, 0], elR: 64, shL: [16, 10, 72], elL: 88 },
  qstaff: { shR: [30, 10, 10], elR: 76, haR: [0, 0, 38], shL: [40, 0, 20], elL: 70 },
  bow: { shL: [20, 14, 0], elL: 44, shR: [10, 10, 0], elR: 36 },
  crossbow: { shR: [24, 6, 8], elR: 64, shL: [48, -10, 20], elL: 60 },
}).map(([k, p]) => [k, pose({ ...STAND, ...p })]));
const TWO_HANDS = { two: 1, qstaff: 1, crossbow: 1 }, SHIELD_ARM = { one: 1, spear: 1, wand: 1 };
// the library's clips: the metres its run covers a cycle (it bounds: 4.7 at its own pace), where in it the left leg leads, and the seconds
// of its roll that are shown, in the time a roll takes to be over (longer than the 0.3 s it travels)
const STRIDE = 4.2, JOG0 = .68, ROLL = [.2, 1.1], ROLL_TIME = .55;

// ---------- clips: [k, pose] keys; a null pose is the family's stance
const A = (keys, o = {}) => ({ keys: keys.map(([k, p]) => [k, p && pose({ ...STAND, ...p })]), ...o });
const CLIPS = {
  // one-handed slash from the right across the body
  swing: A([
    [0, { ...LUNGE, spine: [6, 12, 0], chest: [10, 28, 0], head: [0, -18, 0], shR: [82, 8, 0], elR: 14, haR: [55, 0, 0], shL: [10, 25, 0], elL: 60 }],
    [.16, { ...LUNGE, spine: [8, 18, 0], chest: [14, 52, 0], head: [0, -34, 0], shR: [70, -42, 0], elR: 38, haR: [70, 0, 0], shL: [-15, 30, 0], elL: 70 }],
    [.5, null],
    [.84, { ...BRACE, spine: [0, -14, 0], chest: [-4, -42, 0], head: [0, 34, 0], shR: [70, 72, 0], elR: 75, haR: [-20, 0, 0], shL: [45, 5, 30], elL: 70 }],
    [1, { ...LUNGE, chest: [4, -12, 0], head: [0, 8, 0], shR: [84, 44, 0], elR: 32, haR: [25, 0, 0], shL: [25, 15, 0], elL: 60 }],
  ]),
  // two-handed sweep: the whole trunk turns with it
  cleave: A([
    [0, { ...LUNGE, spine: [8, 16, 0], chest: [12, 30, 0], head: [0, -22, 0], shR: [78, 0, 0], elR: 18, haR: [62, 0, 0] }],
    [.18, { ...LUNGE, spine: [10, 26, 0], chest: [14, 58, 0], head: [0, -42, 0], shR: [66, -34, 0], elR: 46, haR: [72, 0, 0] }],
    [.52, null],
    [.84, { ...BRACE, spine: [0, -20, 0], chest: [-6, -50, 0], head: [0, 44, 0], shR: [84, 66, 0], elR: 84, haR: [-28, 0, 0] }],
    [1, { ...LUNGE, spine: [4, -4, 0], chest: [6, -14, 0], head: [0, 12, 0], shR: [86, 36, 0], elR: 36, haR: [28, 0, 0] }],
  ]),
  // overhead smash into the ground in front
  slam: A([
    [0, { ...LUNGE, pos: [0, -.2, .2], body: [13, 0, 0], spine: [13, 0, 0], chest: [15, 0, 0], head: [-22, 0, 0], shR: [60, 4, 0], elR: 14, haR: [78, 0, 0], shL: [56, 4, 0], elL: 14 }],
    [.2, { ...LUNGE, pos: [0, -.16, .18], body: [11, 0, 0], spine: [11, 0, 0], chest: [12, 0, 0], head: [-16, 0, 0], shR: [60, 4, 0], elR: 18, haR: [74, 0, 0], shL: [56, 4, 0], elL: 18 }],
    [.55, null],
    [.84, { ...BRACE, pos: [0, .02, -.06], body: [-6, 0, 0], spine: [-8, 0, 0], chest: [-10, 0, 0], head: [10, 0, 0], shR: [158, 6, 0], elR: 74, haR: [-24, 0, 0], shL: [150, 6, 0], elL: 70 }],
    [1, { ...LUNGE, pos: [0, -.08, .1], body: [6, 0, 0], spine: [4, 0, 0], chest: [4, 0, 0], shR: [112, 4, 0], elR: 30, haR: [30, 0, 0], shL: [104, 4, 0], elL: 30 }],
  ]),
  // spear or dagger stab
  thrust: A([
    [0, { ...LUNGE, pos: [0, -.14, .26], spine: [8, 14, 0], chest: [12, 34, 0], head: [0, -30, 0], shR: [88, 4, 0], elR: 6, haR: [88, 0, 0], shL: [-20, 30, 0], elL: 50 }],
    [.2, { ...LUNGE, pos: [0, -.12, .22], spine: [8, 12, 0], chest: [10, 28, 0], head: [0, -26, 0], shR: [80, 6, 0], elR: 24, haR: [86, 0, 0], shL: [-12, 28, 0], elL: 55 }],
    [.55, null],
    [.86, { ...BRACE, spine: [0, -12, 0], chest: [0, -36, 0], head: [0, 34, 0], shR: [-14, 26, 0], elR: 112, haR: [80, 0, 0], shL: [60, -10, 0], elL: 40 }],
    [1, { ...LUNGE, chest: [6, 4, 0], head: [0, -4, 0], shR: [50, 10, 0], elR: 70, haR: [86, 0, 0], shL: [10, 20, 0], elL: 50 }],
  ]),
  // palm or fist
  punch: A([
    [0, { ...LUNGE, spine: [6, 14, 0], chest: [8, 36, 0], head: [0, -32, 0], shR: [88, -4, 0], elR: 6, shL: [-10, 16, 0], elL: 110 }],
    [.2, { ...LUNGE, spine: [6, 10, 0], chest: [8, 26, 0], head: [0, -24, 0], shR: [80, 0, 0], elR: 30, shL: [0, 16, 0], elL: 105 }],
    [.55, null],
    [.86, { ...BRACE, spine: [0, -10, 0], chest: [0, -32, 0], head: [0, 30, 0], shR: [-12, 16, 0], elR: 124, shL: [70, -8, 0], elL: 50 }],
    [1, { ...LUNGE, chest: [4, 0, 0], shR: [40, 6, 0], elR: 90, shL: [30, 4, 0], elL: 80 }],
  ]),
  // bow: sideways to the target, the string let go at k = 0 and drawn again towards k = 1
  shoot: A([
    [0, { ...ARCHER, chest: [0, -50, 0], head: [0, 68, 0], shL: [90, 72, 0], elL: 4, shR: [90, 84, 0], elR: 146, x: [.15] }],
    [.14, { ...ARCHER, chest: [0, -52, 0], head: [0, 68, 0], shL: [90, 70, 0], elL: 4, shR: [88, 100, 0], elR: 112, x: [0] }],
    [.5, { ...ARCHER, chest: [0, -36, 0], head: [0, 52, 0], shL: [78, 58, 0], elL: 14, shR: [70, 20, 0], elR: 70, x: [0] }],
    [.72, { ...ARCHER, chest: [0, -46, 0], head: [0, 64, 0], shL: [88, 70, 0], elL: 6, shR: [86, 30, 0], elR: 60, x: [.05] }],
    [1, { ...ARCHER, chest: [0, -50, 0], head: [0, 68, 0], shL: [90, 72, 0], elL: 4, shR: [90, 84, 0], elR: 148, x: [1] }],
  ]),
  // bow, loosed into the sky
  shootUp: A([
    [0, { ...ARCHER, chest: [-14, -50, 0], head: [-24, 60, 0], shL: [132, 72, 0], elL: 4, shR: [118, 84, 0], elR: 146, x: [.15] }],
    [.14, { ...ARCHER, chest: [-14, -52, 0], head: [-24, 60, 0], shL: [132, 70, 0], elL: 4, shR: [110, 100, 0], elR: 112, x: [0] }],
    [.5, { ...ARCHER, chest: [0, -36, 0], head: [0, 52, 0], shL: [78, 58, 0], elL: 14, shR: [70, 20, 0], elR: 70, x: [0] }],
    [1, { ...ARCHER, chest: [-14, -50, 0], head: [-24, 60, 0], shL: [132, 72, 0], elL: 4, shR: [118, 84, 0], elR: 148, x: [1] }],
  ]),
  // crossbow: shouldered, the recoil after the bolt leaves
  fire: A([
    [0, { ...BRACE, pos: [0, -.06, -.04], spine: [-2, -8, 0], chest: [-2, -16, 0], head: [2, 14, 0], shR: [26, 10, 0], elR: 68 }],
    [.1, { ...BRACE, pos: [0, -.06, -.1], spine: [-5, -8, 0], chest: [-7, -16, 0], head: [6, 14, 0], shR: [32, 10, 0], elR: 76 }],
    [.4, { ...BRACE, spine: [4, -8, 0], chest: [6, -16, 0], head: [-4, 14, 0], shR: [16, 10, 0], elR: 72 }],
    [1, { ...BRACE, pos: [0, -.06, -.02], spine: [0, -8, 0], chest: [0, -16, 0], head: [0, 14, 0], shR: [26, 10, 0], elR: 66 }],
  ]),
  // overhand throw: a spear, a grenade
  throw: A([
    [0, { ...LUNGE, spine: [10, 14, 0], chest: [14, 34, 0], head: [-8, -30, 0], shR: [126, 10, 0], elR: 18, haR: [130, 0, 0], shL: [10, 30, 0], elL: 50 }],
    [.18, { ...LUNGE, pos: [0, -.14, .2], spine: [18, 18, 0], chest: [22, 44, 0], head: [-14, -38, 0], shR: [44, -14, 0], elR: 24, haR: [96, 0, 0], shL: [-20, 34, 0], elL: 60 }],
    [.55, null],
    [.84, { ...BRACE, spine: [-6, -8, 0], chest: [-8, -20, 0], head: [4, 22, 0], shR: [150, 20, 0], elR: 100, haR: [236, 0, 0], shL: [80, -10, 0], elL: 26 }],
    [1, { ...LUNGE, chest: [0, 0, 0], shR: [140, 14, 0], elR: 70, haR: [196, 0, 0], shL: [40, 10, 0], elL: 40 }],
  ]),
  // spell sent forward: the weapon arm thrown at the target
  castFwd: A([
    [0, { ...LUNGE, pos: [0, -.06, .1], spine: [4, 8, 0], chest: [8, 20, 0], head: [0, -16, 0], shR: [84, 6, 0], elR: 12, haR: [50, 0, 0], shL: [-24, 30, 0], elL: 46 }],
    [.2, { ...LUNGE, pos: [0, -.06, .1], spine: [4, 8, 0], chest: [8, 18, 0], head: [0, -14, 0], shR: [78, 6, 0], elR: 22, haR: [50, 0, 0], shL: [-18, 28, 0], elL: 46 }],
    [.55, null],
    [.84, { ...BRACE, spine: [-2, -8, 0], chest: [-6, -24, 0], head: [0, 22, 0], shR: [58, 40, 0], elR: 104, haR: [58, 0, 0], shL: [50, 0, 0], elL: 60 }],
    [1, { ...LUNGE, pos: [0, -.04, .04], chest: [2, 0, 0], shR: [80, 22, 0], elR: 50, haR: [54, 0, 0], shL: [10, 20, 0], elL: 50 }],
  ]),
  // spell placed at the cursor: called down with the free hand
  castPoint: A([
    [0, { ...BRACE, spine: [6, 6, 0], chest: [10, 12, 0], head: [8, -8, 0], shR: [66, 4, 0], elR: 12, haR: [40, 0, 0], shL: [72, 14, 0], elL: 14 }],
    [.22, { ...BRACE, spine: [8, 6, 0], chest: [12, 12, 0], head: [10, -8, 0], shR: [58, 4, 0], elR: 16, haR: [46, 0, 0], shL: [60, 14, 0], elL: 16 }],
    [.55, null],
    [.84, { ...STAND, pos: [0, .02, 0], spine: [-6, 0, 0], chest: [-8, 0, 0], head: [-14, 0, 0], shR: [150, 12, 0], elR: 34, haR: [-10, 0, 0], shL: [158, 16, 0], elL: 30 }],
    [1, { ...BRACE, chest: [2, 6, 0], shR: [108, 8, 0], elR: 20, haR: [20, 0, 0], shL: [116, 14, 0], elL: 20 }],
  ]),
  // burst around you: gathered in, thrown out to both sides
  castNova: A([
    [0, { ...WIDE, pos: [0, -.1, 0], spine: [6, 0, 0], chest: [8, 0, 0], head: [-6, 0, 0], shR: [34, 62, 0], elR: 16, haR: [30, 0, 0], shL: [34, 66, 0], elL: 14 }],
    [.22, { ...WIDE, pos: [0, -.08, 0], spine: [4, 0, 0], chest: [6, 0, 0], shR: [28, 70, 0], elR: 20, haR: [30, 0, 0], shL: [28, 72, 0], elL: 18 }],
    [.55, null],
    [.84, { ...STAND, pos: [0, .02, 0], spine: [-4, 0, 0], chest: [-6, 0, 0], head: [6, 0, 0], shR: [96, -22, 0], elR: 112, shL: [96, -22, 0], elL: 112 }],
    [1, { ...WIDE, pos: [0, -.05, 0], shR: [70, 20, 0], elR: 60, shL: [70, 20, 0], elL: 60 }],
  ]),
  // something taken on yourself: the weapon lifted overhead
  castSelf: A([
    [0, { ...STAND, pos: [0, .02, 0], spine: [-4, 0, 0], chest: [-6, 0, 0], head: [-18, 0, 0], shR: [164, 10, 0], elR: 14, shL: [26, 36, 0], elL: 40 }],
    [.25, { ...STAND, spine: [-3, 0, 0], chest: [-5, 0, 0], head: [-14, 0, 0], shR: [156, 10, 0], elR: 20, shL: [24, 34, 0], elL: 42 }],
    [.6, null],
    [.86, { ...STAND, pos: [0, -.03, 0], chest: [4, 0, 0], head: [6, 0, 0], shR: [56, 4, 0], elR: 96, shL: [30, 8, 0], elL: 70 }],
    [1, { ...STAND, shR: [120, 8, 0], elR: 50, shL: [28, 24, 0], elL: 50 }],
  ]),
  // raised from the ground: minions, totems, walls
  castLow: A([
    [0, { ...BRACE, pos: [0, -.02, 0], spine: [-2, 0, 0], chest: [-4, 6, 0], head: [-6, 0, 0], shL: [104, 20, 0], elL: 26, shR: [40, 14, 0], elR: 60 }],
    [.25, { ...BRACE, chest: [-2, 6, 0], shL: [112, 22, 0], elL: 22, shR: [38, 14, 0], elR: 60 }],
    [.6, null],
    [.86, { ...WIDE, pos: [0, -.2, .04], body: [12, 0, 0], spine: [14, 0, 0], chest: [14, 8, 0], head: [-10, 0, 0], shL: [44, 8, 0], elL: 10, shR: [30, 14, 0], elR: 70 }],
    [1, { ...BRACE, pos: [0, -.1, 0], spine: [6, 0, 0], chest: [6, 6, 0], shL: [74, 14, 0], elL: 16, shR: [36, 14, 0], elR: 64 }],
  ]),
  // warcry: the breath drawn in, then thrown out with the chest
  shout: A([
    [0, { ...WIDE, spine: [-8, 0, 0], chest: [-14, 0, 0], head: [-22, 0, 0], shR: [-26, 34, 0], elR: 76, shL: [-26, 34, 0], elL: 76 }],
    [.35, { ...WIDE, spine: [-6, 0, 0], chest: [-10, 0, 0], head: [-16, 0, 0], shR: [-20, 32, 0], elR: 80, shL: [-20, 32, 0], elL: 80 }],
    [.7, null],
    [.88, { ...WIDE, pos: [0, -.1, 0], spine: [12, 0, 0], chest: [16, 0, 0], head: [14, 0, 0], shR: [44, 8, 0], elR: 104, shL: [44, 8, 0], elL: 104 }],
    [1, { ...WIDE, shR: [10, 20, 0], elR: 90, shL: [10, 20, 0], elL: 90 }],
  ]),
};
// poses held for as long as something lasts
const HOLD = Object.fromEntries(Object.entries({
  channel: { ...BRACE, spine: [4, 6, 0], chest: [8, 14, 0], head: [0, -10, 0], shR: [76, 6, 0], elR: 24, haR: [24, 0, 0], shL: [66, -6, 0], elL: 44 },
  press: { ...LUNGE, spine: [6, 10, 0], chest: [10, 22, 0], head: [0, -16, 0], shR: [74, 10, 0], elR: 30, haR: [50, 0, 0], shL: [20, 20, 0], elL: 60 },
  gather: { ...WIDE, pos: [0, -.12, 0], spine: [8, 0, 0], chest: [10, 0, 0], head: [8, 0, 0], shR: [50, 10, 0], elR: 100, shL: [50, 10, 0], elL: 100 },
  full: { ...STAND, pos: [0, .02, 0], spine: [-6, 0, 0], chest: [-8, 0, 0], head: [-16, 0, 0], shR: [150, 16, 0], elR: 40, shL: [150, 16, 0], elL: 40 },
  drawn: { ...ARCHER, chest: [0, -50, 0], head: [0, 68, 0], shL: [90, 72, 0], elL: 4, shR: [90, 84, 0], elR: 148, x: [1] },
  air: { pos: [0, 0, 0], body: [10, 0, 0], spine: [-6, 0, 0], chest: [-8, 0, 0], shR: [156, 6, 0], elR: 60, haR: [-20, 0, 0], shL: [150, 6, 0], elL: 60, hipL: [58, 6, 0], knL: 92, hipR: [8, 6, 0], knR: 70 },
  dash: { ...LUNGE, pos: [0, -.16, .2], body: [22, 0, 0], spine: [8, 0, 0], chest: [6, 16, 0], head: [-24, -12, 0], shR: [-30, 20, 0], elR: 50, haR: [40, 0, 0], shL: [60, 0, 60], elL: 80 },
}).map(([k, p]) => [k, pose({ ...STAND, ...p })]));
const FREE_HAND = new Set(['castPoint', 'castNova', 'castLow', 'shout', 'punch', 'throw']);   // the second hand leaves the weapon
const TRAIL = new Set(['swing', 'cleave', 'slam', 'thrust']), TRAIL_N = 12;   // the blows whose weapon leaves a trail, and how many steps of it are kept

// The clip a skill plays, from its kind and tags and the family of the weapon in hand; null: a leap or a dash,
// which shows the pose of its own movement.
const SPELL = { Projectile: 'castFwd', 'Chaining bolt': 'castFwd', Line: 'castFwd', Cone: 'castFwd', Nova: 'castNova', Warcry: 'shout', Buff: 'castSelf',
  'Persistent buff': 'castSelf', Herald: 'castSelf', Aura: 'castSelf', 'Meta trigger': 'castSelf', Minions: 'castLow', 'Minions from corpses': 'castLow',
  Totem: 'castLow', Wall: 'castLow', Hazard: 'castLow' };
export function clipOf(P, kind, fam) {
  const L = KIND[kind] || '';
  if (L === 'Travel') return null;
  if (P.channel && !P.stages) return P.attack && fam !== 'bow' && fam !== 'crossbow' ? 'press' : P.attack ? (fam === 'bow' ? 'drawn' : 'fire') : 'channel';
  if (!P.attack || SPELL[L] && L !== 'Projectile' && L !== 'Cone') return SPELL[L] || 'castPoint';
  if (fam === 'bow') return L === 'Falls on the cursor' ? 'shootUp' : 'shoot';
  if (fam === 'crossbow') return 'fire';
  if (L === 'Slam' || L === 'Fissure wave' || P.slams) return 'slam';
  if (L === 'Projectile' || L === 'Falls on the cursor' || L === 'Grenade' || L === 'Delayed impact') return 'throw';
  if (L === 'Strike') return fam === 'spear' ? 'thrust' : fam === 'unarmed' ? 'punch' : fam === 'two' || fam === 'qstaff' ? 'cleave' : 'swing';
  return fam === 'unarmed' ? 'punch' : fam === 'one' || fam === 'spear' || fam === 'wand' ? 'swing' : 'cleave';
}

const WEAPON = {   // item class → family and model
  'One Hand Maces': ['one', 'mace'], 'One Hand Swords': ['one', 'sword'], 'One Hand Axes': ['one', 'axe'], Flails: ['one', 'flail'], Daggers: ['one', 'dagger'],
  'Two Hand Maces': ['two', 'maul'], 'Two Hand Swords': ['two', 'greatsword'], 'Two Hand Axes': ['two', 'greataxe'],
  Quarterstaves: ['qstaff', 'qstaff'], Spears: ['spear', 'spear'], Bows: ['bow', 'bow'], Crossbows: ['crossbow', 'crossbow'],
  Staves: ['staff', 'staff'], Talismans: ['staff', 'staff'], Wands: ['wand', 'wand'], Sceptres: ['wand', 'sceptre'],
};

export function makeHumanoid(fx) {
  const root = new THREE.Group(), jt = {};
  const joint = (name, parent, x, y, z) => { const g = new THREE.Group(); g.name = name; g.position.set(x, y, z); parent.add(g); return jt[name] = g; };
  joint('body', root, 0, 0, 0); joint('hips', jt.body, 0, .92, 0); joint('spine', jt.hips, 0, .14, 0); joint('chest', jt.spine, 0, .26, 0); joint('head', jt.chest, 0, .25, 0);
  for (const [S, s] of [['L', 1], ['R', -1]]) {
    joint('sh' + S, jt.chest, s * .19, .12, 0); joint('el' + S, jt['sh' + S], 0, -.27, 0); joint('ha' + S, jt['el' + S], 0, -.27, 0);
    joint('hip' + S, jt.hips, s * .09, -.03, 0); joint('kn' + S, jt['hip' + S], 0, -.4, 0); joint('ft' + S, jt['kn' + S], 0, -.43, 0);
  }
  const PALM = .085, hip0 = jt.hips.position.clone();   // wrist to the middle of the palm; where the hips stand
  let UPPER = .27, FORE = .27 + PALM;   // shoulder to elbow, elbow to palm: the mannequin's once it is loaded
  const tip = new THREE.Object3D(), grip2 = new THREE.Object3D(), nock = new THREE.Object3D();
  let made = [], orbs = [], fam = 'unarmed', stance = STANCE.unarmed, glow = null, string = null, lookKey = null, rig = null;

  const put = (parent, geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); made.push(m); return m; };
  const group = (parent, x = 0, y = 0, z = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); made.push(g); return g; };
  const cyl = (a, b, h, n = 10, open = false, t0 = 0, t1 = TAU) => new THREE.CylinderGeometry(a, b, h, n, 1, open, t0, t1);
  const box = (x, y, z) => new THREE.BoxGeometry(x, y, z), ball = (r, w = 12, h = 9) => new THREE.SphereGeometry(r, w, h);
  const rod = (parent, r, y0, y1, mat, r1 = r) => put(parent, cyl(r1, r, y1 - y0, 7), mat, 0, (y0 + y1) / 2, 0);
  const M = { wood: std(0x5c4026, .85), metal: std(0x9c968a, .42, .8), leather: std(0x3d2c1f, .85), dark: std(0x1f1b19, .9) };

  // ---------- the body. The joints above take the mannequin's measures and its bones follow them: a bone's turn is
  // its joint's, from the pose where both stand alike (arms down for the joints, as the file has them for the bones).
  const DOWN = new THREE.Vector3(0, -1, 0), AX = new THREE.Vector3(1, 0, 0), v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), v4 = new THREE.Vector3();
  const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), JW = {}, JA = {}, ORDER = J.slice(2, 18);
  for (const n of ['body', ...ORDER]) { JW[n] = new THREE.Quaternion(); JA[n] = new THREE.Quaternion(); }
  const BONE = { hips: 'hips', spine: 'spine001', chest: 'spine003', head: 'head' }, NEXT = { sh: 'forearm', el: 'hand', ha: 'f_middle01', hip: 'shin', kn: 'foot' };
  for (const S of 'LR') for (const [j, b] of [['sh', 'upper_arm'], ['el', 'forearm'], ['ha', 'hand'], ['hip', 'thigh'], ['kn', 'shin'], ['ft', 'foot']]) BONE[j + S] = b + S;
  import('three/addons/loaders/GLTFLoader.js').then(({ GLTFLoader }) => new GLTFLoader().load('mannequin.glb', ({ scene: model, animations }) => {
    root.add(model); root.updateWorldMatrix(true, true);
    const inv = root.matrixWorld.clone().invert(), bones = [], B = n => model.getObjectByName('DEF-' + n), P = n => B(n).getWorldPosition(new THREE.Vector3()).applyMatrix4(inv), d = (a, b) => P(b).sub(P(a));
    model.traverse(o => {
      if (o.isBone) bones.push(o);
      else if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; o.material.color.set(o.material.name === 'M_Joints' ? 0x30343b : 0xd3d7dc); o.material.roughness = .55; }
    });
    // each bone: its parent, how it lies in the file, and where the clip and the figure have it (w, in the figure's space)
    const list = bones.map(b => ({ b, up: bones.indexOf(b.parent), rest: b.quaternion.clone(), a: new THREE.Quaternion(), w: new THREE.Quaternion(), j: null, leg: /hips|thigh|shin|foot|toe/.test(b.name), finger: /f_|thumb/.test(b.name) ? b.name.slice(-1) : '' }));
    for (const e of list) e.w.copy(e.rest).premultiply(e.up < 0 ? q1.identity() : list[e.up].w);
    for (const j of ORDER) {
      const e = list[bones.indexOf(B(BONE[j]))], S = j.slice(-1), next = 'LR'.includes(S) && NEXT[j.slice(0, -1)];
      e.j = j; e.C = (next ? new THREE.Quaternion().setFromUnitVectors(DOWN, d(BONE[j], next + S).normalize()).invert() : new THREE.Quaternion()).multiply(e.w); e.Ci = e.C.clone().invert();
    }
    jt.hips.position.copy(hip0.copy(P('hips'))); jt.spine.position.copy(d('hips', 'spine001')); jt.chest.position.copy(d('spine001', 'spine003')); jt.head.position.copy(d('spine003', 'head'));
    for (const S of 'LR') {
      jt['sh' + S].position.copy(d('spine003', 'upper_arm' + S)); jt['el' + S].position.set(0, -d('upper_arm' + S, 'forearm' + S).length(), 0); jt['ha' + S].position.set(0, -d('forearm' + S, 'hand' + S).length(), 0);
      jt['hip' + S].position.copy(d('hips', 'thigh' + S)); jt['kn' + S].position.set(0, -d('thigh' + S, 'shin' + S).length(), 0); jt['ft' + S].position.set(0, -d('shin' + S, 'foot' + S).length(), 0);
    }
    UPPER = -jt.elL.position.y; FORE = PALM - jt.haL.position.y;
    const clip = n => { const c = animations.find(c => c.name === n), by = {}; for (const t of c.tracks) by[t.name] = t.createInterpolant(); return { dur: c.duration, q: bones.map(b => by[b.name + '.quaternion']), p: by['DEF-hips.position'] }; };
    rig = { list, rootQ: bones[0].quaternion.clone(), jog: clip('Jog_Fwd_Loop'), roll: clip('Roll'), death: clip('Death01'), clip: null, t: 0, prev: null, pt: 0, x: 1, grip: { L: 0, R: 0 } };
  }));
  // the trail of a blow: a ribbon through where the outer half of the weapon has just been, fading towards its tail and its inner edge
  const trail = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
  const trailP = new Float32Array(TRAIL_N * 6), trailC = new Float32Array(TRAIL_N * 6), trailLit = new Float32Array(TRAIL_N);
  trail.geometry.setAttribute('position', new THREE.BufferAttribute(trailP, 3)); trail.geometry.setAttribute('color', new THREE.BufferAttribute(trailC, 3));
  trail.geometry.setIndex(Array.from({ length: TRAIL_N - 1 }, (_, i) => [2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2]).flat());
  trail.frustumCulled = false; trail.renderOrder = 6; trail.material.color.copy(fx.color('white', .9));
  let trailAt = 0;
  function sweep(dt, lit) {
    if (!trail.parent) { if (!root.parent) return; root.parent.add(trail); }
    if ((trailAt += dt) >= 1 / 90) {   // a step further
      trailAt = 0; trailP.copyWithin(0, 6); trailLit.copyWithin(0, 1);
    }
    tip.getWorldPosition(v1); jt[tip.parent?.parent === jt.haL ? 'haL' : 'haR'].getWorldPosition(v2).lerp(v1, .55);
    trailP.set([v2.x, v2.y, v2.z, v1.x, v1.y, v1.z], (TRAIL_N - 1) * 6); trailLit[TRAIL_N - 1] = lit;
    for (let i = 0; i < TRAIL_N; i++) trailC.fill(trailLit[i] * (i / (TRAIL_N - 1)) ** 2, i * 6 + 3, i * 6 + 6);   // the outer edge alone is lit
    trail.geometry.attributes.position.needsUpdate = trail.geometry.attributes.color.needsUpdate = true;
  }

  // where a clip has a bone, or the hips, fading from the clip before it
  const turnAt = (i, out) => {
    const R = rig, c = R.clip.q[i];
    if (!c) return out.copy(R.list[i].rest);
    out.fromArray(c.evaluate(R.t));
    return R.x < 1 && R.prev?.q[i] ? out.copy(q2.fromArray(R.prev.q[i].evaluate(R.pt)).slerp(out, R.x)) : out;
  };
  // the clips over the poses: full (0 to 1) of the whole body is the clip's, legs of the hips and the legs
  function drive(dt, clip, t, full, legs) {
    const R = rig, L = R.list;
    if (clip !== R.clip) { R.prev = R.clip; R.pt = R.t; R.clip = clip; R.x = R.prev ? 0 : 1; }
    R.t = t; R.x = Math.min(1, R.x + dt * 9);
    JA.body.copy(jt.body.quaternion); jt.hips.position.copy(hip0);
    if (legs > .001) {
      for (let i = 0; i < L.length; i++) { const e = L[i]; turnAt(i, e.a); e.w.copy(e.a); if (e.up >= 0) e.w.premultiply(L[e.up].w); if (e.j) JA[e.j].copy(e.w).multiply(e.Ci); }
      for (const j of ORDER) { const k = LEGS.has(j) ? legs : full; if (k > .001) jt[j].quaternion.slerp(q1.copy(JA[jt[j].parent.name]).invert().multiply(JA[j]), k); }
      v1.fromArray(clip.p.evaluate(t)); if (R.x < 1 && R.prev?.p) v1.copy(v2.fromArray(R.prev.p.evaluate(R.pt)).lerp(v1, R.x));
      jt.hips.position.lerp(v1.applyQuaternion(R.rootQ).sub(jt.body.position).applyQuaternion(q1.copy(jt.body.quaternion).invert()), legs);
    }
  }
  // the bones after the joints; fingers and the rest of the bones as the file has them, or the clip, or closed on a grip
  function skin(full, legs) {
    const R = rig, L = R.list;
    JW.body.copy(jt.body.quaternion);
    for (const j of ORDER) JW[j].copy(JW[jt[j].parent.name]).multiply(jt[j].quaternion);
    for (const e of L) {
      const up = e.up < 0 ? null : L[e.up].w;
      if (e.j) { e.w.copy(JW[e.j]).multiply(e.C); e.b.quaternion.copy(up).invert().multiply(e.w); continue; }
      const k = legs > .001 ? (e.leg ? legs : full) : 0;
      e.b.quaternion.copy(e.rest); if (e.finger && R.grip[e.finger]) e.b.quaternion.multiply(q1.setFromAxisAngle(AX, R.grip[e.finger] * (/thumb/.test(e.b.name) ? .5 : 1.25)));
      if (k > 0) e.b.quaternion.slerp(e.a, k);
      e.w.copy(e.b.quaternion); if (up) e.w.premultiply(up);
    }
    const hips = L.find(e => e.j === 'hips');
    hips.b.position.copy(jt.hips.position).applyQuaternion(jt.body.quaternion).add(jt.body.position).applyQuaternion(q1.copy(R.rootQ).invert());
  }

  // the weapon: drawn along +Y from the hand that holds it, then laid across the palm
  function equip(cls, off) {
    const [f, model] = WEAPON[cls] || ['unarmed', ''], left = model === 'bow', g = group(left ? jt.haL : jt.haR, 0, -PALM, 0);
    fam = f; stance = STANCE[f]; glow = string = null;
    g.rotation.x = model === 'crossbow' ? Math.PI : Math.PI / 2;
    let top = 0, low = 0;
    const blade = (y, r, side = 1) => { const m = put(g, cyl(r, r, .014, 14, false, 0, Math.PI).rotateY(-Math.PI / 2).rotateZ(Math.PI / 2), M.metal, 0, y, .02 * side); m.scale.z = side; return m; };
    const orb = (y, r) => { glow = fx.orb('arcane', r); glow.position.y = y; g.add(glow); orbs.push(glow); };
    ({
      mace() { rod(g, .018, -.1, .5, M.wood); put(g, new THREE.DodecahedronGeometry(.085), M.metal, 0, .55, 0); for (let i = 0; i < 3; i++) put(g, box(.22, .1, .02), M.metal, 0, .55, 0).rotation.y = i * Math.PI / 3; top = .6; },
      sword() { rod(g, .018, -.12, .04, M.leather); put(g, box(.2, .025, .04), M.metal, 0, .05, 0); put(g, box(.05, .72, .012), M.metal, 0, .43, 0); top = .8; },
      axe() { rod(g, .018, -.12, .58, M.wood); blade(.48, .16); top = .6; },
      flail() { rod(g, .02, -.1, .4, M.wood); put(g, cyl(.008, .008, .24, 5), M.metal, 0, .5, .05).rotation.x = .4; put(g, new THREE.DodecahedronGeometry(.07), M.metal, 0, .62, .1); top = .65; },
      dagger() { rod(g, .015, -.08, .03, M.leather); put(g, box(.035, .3, .01), M.metal, 0, .2, 0); top = .36; },
      maul() { rod(g, .024, -.42, .95, M.wood); put(g, box(.2, .26, .2), M.metal, 0, 1, 0); put(g, box(.23, .05, .23), M.dark, 0, 1, 0); top = 1.12; low = -.34; },
      greatsword() { rod(g, .02, -.32, .06, M.leather); put(g, box(.34, .03, .05), M.metal, 0, .08, 0); put(g, box(.075, 1.15, .014), M.metal, 0, .68, 0); top = 1.26; low = -.24; },
      greataxe() { rod(g, .022, -.42, 1, M.wood); blade(.86, .22); blade(.86, .22, -1); top = 1.05; low = -.34; },
      qstaff() { rod(g, .022, -.95, .95, M.wood); for (const y of [-.9, .9]) put(g, cyl(.03, .03, .12, 8), M.metal, 0, y, 0); top = .95; low = -.5; },
      spear() { rod(g, .018, -.85, 1.05, M.wood); put(g, new THREE.ConeGeometry(.045, .28, 6), M.metal, 0, 1.19, 0); top = 1.3; },
      staff() { rod(g, .03, -1.12, .68, M.wood, .022); put(g, new THREE.TorusGeometry(.08, .016, 6, 14), M.metal, 0, .78, 0); for (const s of [1, -1]) put(g, new THREE.ConeGeometry(.018, .16, 5), M.metal, s * .09, .84, 0).rotation.z = s * .5; orb(.78, .06); top = .78; },
      wand() { rod(g, .012, -.08, .3, M.wood); orb(.34, .035); top = .34; },
      sceptre() { rod(g, .016, -.1, .42, M.metal); put(g, new THREE.DodecahedronGeometry(.05), M.metal, 0, .47, 0); orb(.55, .04); top = .55; },
      bow() {
        const c = new THREE.CatmullRomCurve3([[-.72, -.2], [-.42, -.03], [0, .03], [.42, -.03], [.72, -.2]].map(([y, z]) => new THREE.Vector3(0, y, z)));
        put(g, new THREE.TubeGeometry(c, 18, .014, 5), M.wood);
        string = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -.72, -.2), new THREE.Vector3(0, 0, -.2), new THREE.Vector3(0, .72, -.2)]), new THREE.LineBasicMaterial({ color: 0xd8d0b8 }));
        g.add(string); made.push(string); top = 0;
      },
      crossbow() { put(g, box(.05, .62, .07), M.wood, 0, .16, 0); for (const s of [1, -1]) put(g, box(.36, .03, .03), M.metal, s * .17, .42, 0).rotation.z = -s * .22; rod(g, .008, .1, .52, M.metal); top = .52; low = .3; },
    })[model]?.();
    tip.position.set(0, top, model === 'bow' ? .05 : 0); grip2.position.set(0, low, 0); nock.position.set(0, 0, -.2); g.add(tip, grip2, nock);
    // the other hand: a shield on the forearm, a focus over the palm, a quiver on the back
    if (off === 'Shields' || off === 'Bucklers') {
      const r = off === 'Shields' ? .3 : .19;
      put(jt.elL, cyl(r, r, .035, 16).rotateZ(Math.PI / 2), off === 'Shields' ? M.wood : M.metal, .07, -.15, 0); put(jt.elL, ball(.07, 8, 6), M.metal, .09, -.15, 0);
    } else if (off === 'Foci') { const o = fx.orb('arcane', .05); o.position.set(0, -.12, .1); jt.haL.add(o); orbs.push(o); glow ||= o; }
    grips = { R: f !== 'unarmed' && !left, L: left || TWO_HANDS[f] || f === 'staff' && !off || off === 'Shields' || off === 'Bucklers' };
    if (left || off === 'Quivers') { const q = put(jt.chest, cyl(.05, .04, .5, 8), M.leather, -.1, .16, -.16); q.rotation.z = .5; for (let i = 0; i < 3; i++) put(jt.chest, cyl(.006, .006, .2, 4), M.metal, -.2 + i * .02, .42, -.16).rotation.z = .5; }
  }

  // the build's weapon and what its other hand holds (item classes)
  let grips = {};
  function setLook({ weapon, offhand } = {}) {
    const key = [weapon, offhand].join();
    if (key === lookKey) return;
    lookKey = key;
    for (const m of made) { m.parent?.remove(m); m.geometry?.dispose(); }
    for (const o of orbs) { o.parent?.remove(o); o.traverse(m => m.material?.dispose()); }   // their geometry is the effects' own
    string?.material.dispose(); made = []; orbs = [];
    equip(weapon, offhand);
  }

  // ---------- playing the poses
  const cur = Float32Array.from(STANCE.unarmed), tgt = new Float32Array(N), tmp = new Float32Array(N);
  const mix = (out, a, b, k, idx) => { if (idx) for (const i of idx) out[i] = a[i] + (b[i] - a[i]) * k; else for (let i = 0; i < N; i++) out[i] = a[i] + (b[i] - a[i]) * k; };
  function sample(clip, k, out) {
    const K = clip.keys; let i = 1; while (i < K.length - 1 && K[i][0] < k) i++;
    const [k0, p0] = K[i - 1], [k1, p1] = K[i];
    mix(out, p0 || stance, p1 || stance, smooth((k - k0) / (k1 - k0)));
  }
  const set = (g, v, i, a, b, c) => g.rotation.set(v[i] * a, v[i + 1] * b, v[i + 2] * c);
  function apply(v) {
    jt.body.position.set(v[0], v[1], v[2]);
    for (const n of ['body', 'hips', 'spine', 'chest', 'head']) set(jt[n], v, JI[n], 1, 1, -1);
    for (const [S, s] of [['L', 1], ['R', -1]]) {
      for (const n of ['sh' + S, 'hip' + S]) { const i = JI[n]; jt[n].rotation.set(-v[i], -s * v[i + 2], s * v[i + 1]); }   // forward, turned inward, sideways
      set(jt['el' + S], v, JI['el' + S], -1, s, 0); set(jt['ha' + S], v, JI['ha' + S], 1, s, s);
      set(jt['kn' + S], v, JI['kn' + S], 1, 0, 0); set(jt['ft' + S], v, JI['ft' + S], 1, 0, 0);
    }
  }
  // two-bone reach: the arm of that side bent so that its palm lies on a point of the world (the second hand on a
  // two-handed weapon, the string hand on the bow), by k
  const POLE_L = new THREE.Vector3(.6, -1, -.3), POLE_R = new THREE.Vector3(-1, .35, -.2);
  function reach(S, at, k, pole) {
    const sh = jt['sh' + S], el = jt['el' + S];
    jt.chest.worldToLocal(v1.copy(at)).sub(sh.position);
    const L = clamp(v1.length(), .08, UPPER + FORE - .005), bend = Math.PI - Math.acos(clamp((UPPER * UPPER + FORE * FORE - L * L) / (2 * UPPER * FORE), -1, 1));
    const inner = Math.acos(clamp((UPPER * UPPER + L * L - FORE * FORE) / (2 * UPPER * L), -1, 1));
    q1.setFromUnitVectors(DOWN, v1.normalize());
    // turned about the line to the point until the elbow is as near the pole as it gets
    v2.set(0, 0, -1).applyQuaternion(q1); v3.copy(pole).addScaledVector(v1, -pole.dot(v1)).normalize();
    q1.premultiply(q2.setFromAxisAngle(v1, Math.atan2(v4.crossVectors(v2, v3).dot(v1), v2.dot(v3)))).multiply(q2.setFromAxisAngle(AX, inner));
    sh.quaternion.slerp(q1, k); el.rotation.x += (-bend - el.rotation.x) * k;
  }

  let time = 0, phase = 0, runW = 0, fullW = 0, rollT = null, act = null, flinch = 0, down = 0, wasLeap = false, energy = 0, holdW = 0;
  const w1 = new THREE.Vector3();
  setLook();
  return {
    group: root,
    setLook,
    family: () => fam,
    hand(v) { return tip.getWorldPosition(v); },
    setColor(c) { trail.material.color.copy(fx.color(c, .9)).lerp(WHITE, .35); if (!glow) return; glow.userData.core.material.color.copy(fx.color(c, 3.2)); glow.userData.glow.material.color.copy(fx.color(c, 1.6)); },
    // a use of a skill: its clip from its moment on, lasting the time to the next use
    act(name, dur) { if (CLIPS[name] || HOLD[name]) { act = { name, t: 0, dur: Math.max(.12, dur) }; energy = 1; } },
    pace(dur) { if (act && act.t < .05) act.dur = Math.max(.12, dur); },
    flinch(k = 1) { flinch = Math.max(flinch, k); },
    fall() { down = 1e-4; act = null; },
    // s: { moving, speed (m/s), hold (the key is held: the next use follows), charge (0 to 1 while one builds), roll (0 to 1), leap (0 to 1), dash (0 to 1) }
    update(dt, s = {}) {
      time += dt;
      runW += ((s.moving ? 1 : 0) - runW) * Math.min(1, dt * 10);
      if (s.moving) phase += dt * (s.speed || 3.7) * TAU / STRIDE;
      // standing and running: the stance, and the free arms swinging with the stride (the legs are the clip's)
      tgt.set(stance);
      tgt[JI.chest] += Math.sin(time * 1.7) * .012; tgt[1] += Math.sin(time * 1.7) * .004;
      if (runW > .01) {
        const sn = Math.sin(phase), R = tmp; R.set(stance);
        R[JI.spine] += 6 * D; R[JI.chest + 1] += 8 * sn * D;
        const two = TWO_HANDS[fam], kL = two || SHIELD_ARM[fam] || fam === 'bow' ? .25 : 1, kR = fam === 'unarmed' || fam === 'bow' ? 1 : two ? .2 : .4;
        for (const [S, k, sw] of [['L', kL, -30 * sn * D], ['R', kR, 30 * sn * D]]) {
          const i = JI['sh' + S];
          if (k === 1) { R[i] = 8 * D + sw; R[i + 1] = 8 * D; R[i + 2] = 0; R[JI['el' + S]] = 75 * D; } else R[i] += sw * k;
        }
        mix(tgt, tgt, R, runW);
      }
      // what is being done, over it
      let upper = 0, lower = 0, free = false, lit = 0;
      if (s.roll != null) { act = null; rollT ??= 0; }
      else if (s.leap != null) {
        const k = s.leap; if (k < .75) mix(tmp, HOLD.gather, HOLD.air, smooth(k / .25)); else sample(CLIPS.slam, .84 + (k - .75) / .25 * .16, tmp);
        upper = lower = 1; act = null; wasLeap = true;
      } else if (s.dash != null) { tmp.set(HOLD.dash); upper = lower = 1; act = null; }
      else if (s.charge != null) { mix(tmp, fam === 'bow' ? stance : HOLD.gather, fam === 'bow' ? HOLD.drawn : HOLD.full, smooth(s.charge)); upper = 1; lower = 1 - runW; act = null; energy = 1; }
      else if (act) {
        act.t += dt;
        const C = CLIPS[act.name], k = act.t / act.dur;
        holdW += ((s.hold ? 1 : 0) - holdW) * Math.min(1, dt * 12);
        if (!C) {   // a held pose: while its uses keep coming
          tmp.set(HOLD[act.name]); tmp[JI.shR] += Math.sin(time * 31) * .02; tmp[JI.chest + 1] += Math.sin(time * 23) * .015;
          upper = 1 - smooth((act.t - .25) / .25); if (act.t > .5) act = null;
        } else {
          sample(C, Math.min(1, k), tmp);
          if (TRAIL.has(act.name) && fam !== 'unarmed' && (k < .22 || k > .8)) lit = 1;   // down into the blow and through it
          upper = Math.max(holdW, 1 - smooth((k - .35) / .3));
          if (k >= 1 && !s.hold || k >= .7 && holdW < .02) act = null;
        }
        lower = upper * (1 - runW); free = FREE_HAND.has(act?.name);
      }
      if (wasLeap && s.leap == null) { wasLeap = false; act = { name: 'slam', t: 0, dur: .7 }; }   // landed: the blow, then up again
      if (upper > 0) {
        if (SHIELD_ARM[fam] && lower < 1) mix(tmp, tmp, tgt, .7, LEFT);   // the shield arm keeps its guard
        for (let i = 0; i < N; i++) tgt[i] += (tmp[i] - tgt[i]) * (LEG[i] ? lower : upper);
      }
      // struck: a flinch that fades; killed: the fall, until something else is done
      if (down > 0) { down += dt; if (down > 1.7 || s.moving || act || upper > 0) down = 0; }
      if (flinch > 0) { flinch = Math.max(0, flinch - dt * 4); tgt[JI.chest] -= .3 * flinch; tgt[JI.head] -= .25 * flinch; tgt[JI.spine + 1] += .12 * flinch; }
      const a = 1 - Math.exp(-dt * (act && act.t < .1 ? 60 : 26));   // a blow lands at once
      for (let i = 0; i < N; i++) cur[i] += (tgt[i] - cur[i]) * a;
      apply(cur);
      // the roll goes on after its travel, unless something else is done by then
      if (rollT != null && ((rollT += dt) >= ROLL_TIME || s.roll == null && (s.moving || upper > 0))) rollT = null;
      const full = down > 0 || rollT != null;
      fullW += ((full ? 1 : 0) - fullW) * Math.min(1, dt * 16);
      if (rig) drive(dt, down > 0 ? rig.death : rollT != null ? rig.roll : rig.jog, down > 0 ? Math.min(down * 1.3, 1.3) : rollT != null ? ROLL[0] + rollT / ROLL_TIME * (ROLL[1] - ROLL[0]) : ((phase / TAU + JOG0) % 1) * rig.jog.dur, fullW, Math.max(fullW, runW));
      // the second hand on the weapon, the string hand on the bow
      const two = TWO_HANDS[fam] && !free && !full ? 1 : 0, draw = fam === 'bow' ? clamp(cur[JI.x], 0, 1) : 0;
      if (two || draw > .02) {
        root.updateMatrixWorld(true);
        if (two) reach('L', grip2.getWorldPosition(w1), 1, POLE_L);
        else { nock.position.z = -.2 - draw * .46; reach('R', nock.getWorldPosition(w1), smooth(draw * 5), POLE_R); }
      }
      if (string) { const p = string.geometry.attributes.position; p.setZ(1, -.2 - draw * .46); p.needsUpdate = true; }
      sweep(dt, lit);
      if (rig) { for (const S of 'LR') rig.grip[S] += ((grips[S] && !(S === 'L' && free) ? 1 : .25) - rig.grip[S]) * Math.min(1, dt * 14); skin(fullW, Math.max(fullW, runW)); }
      energy = Math.max(0, energy - dt * 2.5);
      if (glow) glow.userData.glow.scale.setScalar(glow.userData.core.scale.x * (7 + energy * 9 + Math.sin(time * 5) * .5));
    },
  };
}
