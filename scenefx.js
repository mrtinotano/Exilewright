// Visual toolkit of the 3D scene: generated textures, a particle pool, one-shot effects, the arena and the figures
// of the enemies and the summons (the player's is humanoid.js).
// Purely cosmetic: no game data and no simulation rules live here (those are in skillfx.js / scene.js).
import * as THREE from 'three';

export const COL = {
  fire: 0xff6a1e, cold: 0x7fd2ff, lightning: 0xa9b9ff, chaos: 0xb44be6, physical: 0xd9c3a0, arcane: 0x6f9cff,
  poison: 0x74d43c, blood: 0xd42a20, holy: 0xffe2a0, ice: 0xcdf1ff, gold: 0xffc45a, white: 0xffffff, ember: 0xffb040,
  smoke: 0x2c2926, dust: 0x7d6f5e, oil: 0x0b0805, gas: 0x9bc43a, curse: 0x9a3ad6, mark: 0xff4030,
};
export const hex = c => typeof c === 'number' ? c : COL[c] ?? COL.arcane;
export const css = c => '#' + hex(c).toString(16).padStart(6, '0');
const rnd = (a = 1, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);
const TAU = Math.PI * 2, ease = k => 1 - (1 - k) ** 3;

// ---------- textures (drawn once on canvases: white shapes with alpha, tinted by the materials)
function tex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); }
  return t;
}
const radial = stops => (g, w) => {
  const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  stops.forEach(([o, a]) => gr.addColorStop(o, `rgba(255,255,255,${a})`));
  g.fillStyle = gr; g.fillRect(0, 0, w, w);
};
const mask = (g, w, from = .7) => { g.globalCompositeOperation = 'destination-in'; radial([[0, 1], [from, 1], [1, 0]])(g, w); g.globalCompositeOperation = 'source-over'; };
function textures() {
  return {
    glow: tex(64, 64, radial([[0, 1], [.2, .7], [.5, .22], [1, 0]])),
    ring: tex(256, 256, radial([[0, 0], [.55, 0], [.82, .25], [.93, 1], [1, 0]])),
    disc: tex(256, 256, radial([[0, .28], [.7, .36], [.93, .95], [1, 0]])),
    soft: tex(128, 128, radial([[0, .9], [.6, .5], [1, 0]])),
    outline: tex(512, 512, (g, w) => {
      radial([[0, .05], [.9, .09], [.96, .16], [.975, 0]])(g, w);
      g.strokeStyle = '#fff'; g.lineWidth = w * .012; g.beginPath(); g.arc(w / 2, w / 2, w * .478, 0, TAU); g.stroke();
      g.lineWidth = w * .006; g.globalAlpha = .6;
      for (let i = 0; i < 32; i++) { const a = i / 32 * TAU, r0 = w * (i % 4 ? .455 : .43); g.beginPath(); g.moveTo(w / 2 + Math.cos(a) * r0, w / 2 + Math.sin(a) * r0); g.lineTo(w / 2 + Math.cos(a) * w * .478, w / 2 + Math.sin(a) * w * .478); g.stroke(); }
    }),
    patch: tex(256, 256, (g, w) => {
      for (let i = 0; i < 90; i++) {
        const a = rnd(TAU), d = Math.sqrt(rnd()) * w * .42, r = rnd(w * .05, w * .17), x = w / 2 + Math.cos(a) * d, y = w / 2 + Math.sin(a) * d;
        const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(255,255,255,${rnd(.2, .6)})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r);
      }
      mask(g, w, .72);
    }),
    cracks: tex(512, 512, (g, w) => {
      g.strokeStyle = '#fff'; g.lineCap = 'round';
      const line = (x, y, a, lw, n) => {
        for (let s = 0; s < n; s++) {
          const l = rnd(w * .03, w * .075); a += rnd(-.55, .55);
          const nx = x + Math.cos(a) * l, ny = y + Math.sin(a) * l;
          g.lineWidth = lw; g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke();
          if (n > 3 && Math.random() < .3) line(nx, ny, a + rnd(-1.2, 1.2), lw * .6, 3);
          x = nx; y = ny; lw *= .85;
        }
      };
      for (let i = 0; i < 12; i++) line(w / 2, w / 2, i / 12 * TAU + rnd(-.2, .2), rnd(4, 8), 9);
      mask(g, w, .6);
    }),
    rune: tex(512, 512, (g, w) => {
      const c = w / 2; g.strokeStyle = '#fff'; g.lineWidth = w * .012;
      [.95, .8, .4].forEach(r => { g.beginPath(); g.arc(c, c, r * c, 0, TAU); g.stroke(); });
      g.lineWidth = w * .008;
      for (let i = 0; i < 24; i++) {
        const a = i / 24 * TAU, k = i % 4; g.save(); g.translate(c + Math.cos(a) * c * .875, c + Math.sin(a) * c * .875); g.rotate(a + Math.PI / 2);
        g.beginPath(); g.moveTo(-7, -8); g.lineTo(k ? 7 : -7, 8); if (k > 1) g.lineTo(7, -8); if (k === 3) g.lineTo(-7, 0); g.stroke(); g.restore();
      }
      g.globalAlpha = .12; g.fillStyle = '#fff'; g.beginPath(); g.arc(c, c, c * .95, 0, TAU); g.fill();
    }),
    beam: tex(64, 64, (g, w) => {
      const gr = g.createLinearGradient(0, 0, 0, w); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(.5, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, w);
      g.globalCompositeOperation = 'destination-in';
      const e = g.createLinearGradient(0, 0, w, 0); e.addColorStop(0, 'rgba(255,255,255,0)'); e.addColorStop(.12, 'rgba(255,255,255,1)'); e.addColorStop(.88, 'rgba(255,255,255,1)'); e.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = e; g.fillRect(0, 0, w, w);
    }),
    line: tex(64, 16, (g, w, h) => { g.fillStyle = '#fff'; for (let x = 0; x < w; x += 16) g.fillRect(x, h / 2 - 2, 10, 4); }),
  };
}

// ---------- particles: one THREE.Points per blend mode, simulated on the CPU
const VERT = `attribute vec3 pcolor; attribute float size; attribute float alpha; uniform float scale; varying vec3 vC; varying float vA;
void main() { vC = pcolor; vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`;
const FRAG = `uniform sampler2D map; varying vec3 vC; varying float vA;
void main() { float a = texture2D(map, gl_PointCoord).a * vA; if (a < 0.003) discard; gl_FragColor = vec4(vC, a);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;
function pool(scene, max, map, additive) {
  const pos = new Float32Array(max * 3), colr = new Float32Array(max * 3), size = new Float32Array(max), alpha = new Float32Array(max);
  const P = Array.from({ length: max }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0, life: 1, s0: 1, s1: 0, g: 0, drag: 0, r: 1, gr: 1, b: 1, a: 1 }));
  const geo = new THREE.BufferGeometry(), attr = (a, n) => new THREE.BufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', attr(pos, 3)); geo.setAttribute('pcolor', attr(colr, 3)); geo.setAttribute('size', attr(size, 1)); geo.setAttribute('alpha', attr(alpha, 1));
  const mat = new THREE.ShaderMaterial({ uniforms: { map: { value: map }, scale: { value: 800 } }, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = additive ? 6 : 5; scene.add(pts);
  let n = 0;
  return {
    mat,
    get: () => n < max ? P[n++] : null,
    update(dt) {
      for (let i = 0; i < n;) {
        const p = P[i]; p.t += dt;
        if (p.t >= p.life) { n--; P[i] = P[n]; P[n] = p; continue; }
        const k = p.t / p.life, dr = Math.max(0, 1 - p.drag * dt);
        p.vy -= p.g * dt; p.vx *= dr; p.vy *= dr; p.vz *= dr;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        if (p.y < .03 && p.g > 0) { p.y = .03; p.vy *= -.35; p.vx *= .6; p.vz *= .6; }
        pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
        colr[i * 3] = p.r; colr[i * 3 + 1] = p.gr; colr[i * 3 + 2] = p.b;
        size[i] = p.s0 + (p.s1 - p.s0) * k; alpha[i] = p.a * Math.min(1, k * 10) * (1 - k);
        i++;
      }
      geo.setDrawRange(0, n);
      for (const a of ['position', 'pcolor', 'size', 'alpha']) geo.attributes[a].needsUpdate = true;
    },
  };
}

export function createFx(scene) {
  const T = textures();
  const PLANE = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), QUAD = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const BALL = new THREE.IcosahedronGeometry(1, 2), TUBE = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true).translate(0, .5, 0);
  const SHAFT = new THREE.CylinderGeometry(.018, .018, .9, 5).rotateX(Math.PI / 2), UP = new THREE.Vector3(0, 1, 0), tv = new THREE.Vector3();
  const sectors = {};
  const color = (c, k = 1) => new THREE.Color(hex(c)).multiplyScalar(k);
  const glowMat = (c, k = 2, a = 1, map = null) => new THREE.MeshBasicMaterial({ map, color: color(c, k), transparent: true, opacity: a, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  const darkMat = (c, a = 1, map = null) => new THREE.MeshBasicMaterial({ map, color: color(c), transparent: true, opacity: a, depthWrite: false, side: THREE.DoubleSide });
  const sparks = pool(scene, 6000, T.glow, true), smoke = pool(scene, 1500, T.soft, false);
  const tc = new THREE.Color();

  // n particles. o: { p, r (spawn radius on the ground plane), h (vertical spread), v (speed, random direction), up (extra upward speed),
  //   dir (Vector3 bias), life, size, grow (end size factor), c (colour), c2 (second colour to mix), k (brightness), g (gravity), drag, a, smoke, flat }
  function emit(n, o) {
    const pl = o.smoke ? smoke : sparks, k = o.k ?? (o.smoke ? 1 : 2.2), c1 = hex(o.c ?? 'white'), c2 = o.c2 != null ? hex(o.c2) : c1;
    for (let i = 0; i < n; i++) {
      const p = pl.get(); if (!p) return;
      const a = rnd(TAU), d = Math.sqrt(rnd()) * (o.r || 0), th = rnd(TAU), ph = o.flat ? 0 : Math.acos(rnd(-1, 1)) - Math.PI / 2, v = (o.v || 0) * rnd(.35, 1);
      p.x = o.p.x + Math.cos(a) * d; p.y = (o.p.y || 0) + rnd(o.h || 0); p.z = o.p.z + Math.sin(a) * d;
      p.vx = Math.cos(th) * Math.cos(ph) * v + (o.dir ? o.dir.x : 0); p.vy = Math.sin(ph) * v + (o.up || 0) * rnd(.5, 1) + (o.dir ? o.dir.y : 0); p.vz = Math.sin(th) * Math.cos(ph) * v + (o.dir ? o.dir.z : 0);
      p.t = 0; p.life = (o.life || .6) * rnd(.6, 1.2); p.s0 = (o.size || .2) * rnd(.7, 1.3); p.s1 = p.s0 * (o.grow ?? .2);
      p.g = o.g || 0; p.drag = o.drag || 0; p.a = o.a ?? 1;
      tc.setHex(Math.random() < .5 ? c1 : c2).multiplyScalar(k * rnd(.7, 1.1)); p.r = tc.r; p.gr = tc.g; p.b = tc.b;
    }
  }

  // ---------- timed effects
  const fxs = [];
  function add(obj, dur, upd, own) {
    scene.add(obj); const e = { obj, t: 0, dur, upd, own, end: null };
    fxs.push(e); return e;
  }
  const drop = o => { o.parent?.remove(o); o.traverse(m => { if (m.material) m.material.dispose(); if (m.userData.own) m.geometry.dispose(); }); };
  const flat = (map, mat, p, r, y = .04) => { const m = new THREE.Mesh(PLANE, mat); mat.map = map; m.position.set(p.x, y, p.z); m.scale.set(r, 1, r); m.renderOrder = 2; return m; };

  const lights = Array.from({ length: 5 }, () => { const l = new THREE.PointLight(0xffffff, 0, 14, 2); l.userData = { t: 1, dur: 1, i: 0 }; scene.add(l); return l; });
  function flash(p, c, i = 40, dur = .3, dist = 13) {
    const left = l => l.userData.i * Math.max(0, 1 - l.userData.t / l.userData.dur);
    const l = lights.reduce((a, b) => left(b) < left(a) ? b : a);
    if (left(l) > i) return;
    l.position.set(p.x, (p.y || 0) + 1.3, p.z); l.color.setHex(hex(c)); l.distance = dist; l.userData = { t: 0, dur, i };
  }

  const fx = {
    T, emit, add, drop, flash, color, glowMat, darkMat,
    // expanding ring on the ground
    ring(p, r0, r1, c, dur = .45, o = {}) {
      const m = flat(o.tex ? T[o.tex] : T.ring, glowMat(c, o.k ?? 2.2), p, r0, o.y ?? .06);
      return add(m, dur, k => { const r = r0 + (r1 - r0) * ease(k); m.scale.set(r, 1, r); m.material.opacity = (o.a ?? 1) * (1 - k * k); });
    },
    // flash of a filled area
    disc(p, r, c, dur = .35, o = {}) {
      const m = flat(T[o.tex || 'disc'], o.dark ? darkMat(c, o.a ?? .8) : glowMat(c, o.k ?? 1.6, o.a ?? .8), p, r, o.y ?? .05);
      if (o.spin) m.rotation.y = rnd(TAU);
      const a = o.a ?? .8;
      return add(m, dur, k => { m.material.opacity = a * (o.hold ? Math.min(1, (1 - k) / (1 - o.hold)) : 1 - k); if (o.spin) m.rotation.y += o.spin * .016; });
    },
    // lasting decal: returns { mesh, set(r), remove() }
    decal(p, r, texName, c, o = {}) {
      const a = o.a ?? .7, m = flat(T[texName], o.dark ? darkMat(c, 0) : glowMat(c, o.k ?? 1.4, 0), p, r, o.y ?? .035);
      m.rotation.y = o.rot ?? rnd(TAU);
      const e = add(m, Infinity, (k, e, dt) => {
        const out = e.end == null ? 1 : Math.max(0, 1 - (e.t - e.end) / .5);
        m.material.opacity = a * Math.min(1, e.t / .25) * out * (o.pulse ? .8 + .2 * Math.sin(e.t * o.pulse) : 1);
        if (o.spin) m.rotation.y += o.spin * dt;
      });
      return { mesh: m, mat: m.material, set: r => m.scale.set(r, 1, r), move: p => m.position.set(p.x, m.position.y, p.z), remove() { if (e.end == null) { e.end = e.t; e.dur = e.t + .5; } } };
    },
    ball(p, r, c, dur = .3, k = 2.6) {
      const m = new THREE.Mesh(BALL, glowMat(c, k, .9)); m.position.set(p.x, p.y ?? .4, p.z);
      return add(m, dur, t => { const s = r * (.25 + .75 * ease(t)); m.scale.setScalar(s); m.material.opacity = .9 * (1 - t); });
    },
    glow(p, size, c, dur = .3, k = 2) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.glow, color: color(c, k), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
      s.position.set(p.x, p.y ?? 1, p.z); s.scale.setScalar(size);
      return add(s, dur, t => { s.material.opacity = 1 - t; s.scale.setScalar(size * (1 + t * .6)); });
    },
    pillar(p, r, h, c, dur = .25, k = 3) {
      const m = new THREE.Mesh(TUBE, glowMat(c, k, .9)); m.position.set(p.x, 0, p.z); m.scale.set(r, h, r);
      return add(m, dur, t => { const s = r * (1 - t * .8); m.scale.set(s, h, s); m.material.opacity = .9 * (1 - t); });
    },
    // jagged bolt between two points (jitter 0 = straight beam)
    bolt(a, b, c, dur = .16, w = .045, jitter = .32) {
      const len = a.distanceTo(b), n = Math.max(2, Math.round(len * 1.6)), pts = [];
      for (let i = 0; i <= n; i++) {
        const k = i / n, j = i && i < n ? jitter * Math.min(1, len / 3) : 0;
        pts.push(new THREE.Vector3(a.x + (b.x - a.x) * k + rnd(-j, j), a.y + (b.y - a.y) * k + rnd(-j, j), a.z + (b.z - a.z) * k + rnd(-j, j)));
      }
      const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', jitter ? .05 : .5), n * 3, w, 5, false);
      const m = new THREE.Mesh(g, glowMat(c, 3.2, 1)); m.userData.own = true;
      return add(m, dur, t => { m.material.opacity = (1 - t) * (jitter ? rnd(.55, 1) : 1); }, true);
    },
    // short glowing streak that flies from a to b (arrows of a rain, falling shards)
    streak(a, b, c, dur = .2, w = .03, len = 1.2) {
      const m = new THREE.Mesh(TUBE, glowMat(c, 3, 1)); m.scale.set(w, len, w);
      m.quaternion.setFromUnitVectors(UP, tv.subVectors(a, b).normalize()); m.position.copy(a);
      const tr = ['fire', 'cold', 'chaos'].includes(c);
      return add(m, dur, k => { m.position.lerpVectors(a, b, k); if (tr) fx.trail(m.position, c, true); });
    },
    // an arrow left stuck in the ground at p for a moment, leaning as a rain's fall (Rain of Arrows' video)
    stuck(p, c) {
      const m = fx.arrow(c), dx = 1.5, dz = -1, l = Math.hypot(dx, dz);
      m.position.set(p.x + dx / l * .25, .3, p.z + dz / l * .25); m.lookAt(p.x - dx / l * .6, -.5, p.z - dz / l * .6); m.children[1].visible = false;   // no glow at a buried tip
      emit(3, { p: { x: p.x, y: .05, z: p.z }, r: .1, v: .4, up: .6, life: .6, size: .35, grow: 1.8, c: 'dust', smoke: true, a: .35 });
      return add(m, 1.2, k => { if (k >= 1) drop(m); else m.children.forEach(x => { x.material.transparent = true; x.material.opacity = Math.min(1, (1 - k) / .3); }); });
    },
    // circular sector from p towards angle `ang` (radians on the ground plane), half-angle `half`
    sector(p, dx, dz, r, half, c, dur = .3, o = {}) {
      const key = Math.round(half * 40);
      const g = sectors[key] ||= new THREE.CircleGeometry(1, 28, -half, 2 * half).rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, glowMat(c, o.k ?? 1.8, o.a ?? .8, T[o.tex || 'disc']));
      m.position.set(p.x, o.y ?? .06, p.z); m.rotation.y = Math.atan2(-dz, dx); m.scale.set(r, 1, r); m.renderOrder = 2;
      const a = o.a ?? .8;
      return add(m, dur, k => { m.material.opacity = a * (1 - k); if (o.grow) { const s = r * (.5 + .5 * ease(k)); m.scale.set(s, 1, s); } });
    },
    // a blade's crescent at weapon height, sweeping across the swing (the game's slashes: Ice Strike's video)
    arc(p, dx, dz, r, half, c) {
      const key = 'a' + Math.round(half * 40);
      const g = sectors[key] ||= new THREE.RingGeometry(.86, 1, 28, 1, -half, 2 * half).rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, glowMat(c, 2.6, .9)), a0 = Math.atan2(-dz, dx);
      m.position.set(p.x, 1, p.z); m.renderOrder = 3;
      return add(m, .22, k => { m.rotation.y = a0 + half * .6 * (1 - ease(k)); const s = r * (.85 + .15 * ease(k)); m.scale.set(s, 1, s); m.material.opacity = .9 * (1 - k * k); });
    },
    // flat rectangle on the ground from a to b
    strip(a, b, w, c, dur = .3, o = {}) {
      const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || .01;
      const m = new THREE.Mesh(QUAD, o.dark ? darkMat(c, o.a ?? .8, T[o.tex || 'beam']) : glowMat(c, o.k ?? 2, o.a ?? .8, T[o.tex || 'beam']));
      m.position.set((a.x + b.x) / 2, o.y ?? .06, (a.z + b.z) / 2); m.rotation.y = Math.atan2(-dz, dx); m.scale.set(len, 1, w); m.renderOrder = 2;
      const al = o.a ?? .8;
      return add(m, dur, k => { m.material.opacity = al * (dur === Infinity ? 1 : 1 - k); });
    },
    // area warning: outline plus a disc that fills up until the impact
    telegraph(p, r, c, dur) {
      const out = flat(T.outline, glowMat(c, 1.6, .9), p, r, .05), fill = flat(T.disc, glowMat(c, 1, .5), p, .01, .045);
      add(out, dur + .1, k => { out.material.opacity = .9 * Math.min(1, k * 8); });
      return add(fill, dur, k => { const s = Math.max(.01, r * k); fill.scale.set(s, 1, s); });
    },
    // floating text
    text(p, str, c = '#ffffff', size = .42) {
      const key = str + c; let e = fx.texts.get(key);
      if (!e) {
        const cv = document.createElement('canvas'), g = cv.getContext('2d'), font = 'bold 40px Georgia, serif';
        g.font = font; cv.width = Math.ceil(g.measureText(str).width) + 20; cv.height = 54;
        g.font = font; g.textBaseline = 'middle'; g.lineWidth = 7; g.strokeStyle = '#000'; g.lineJoin = 'round'; g.strokeText(str, 10, 28); g.fillStyle = c; g.fillText(str, 10, 28);
        const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace;
        fx.texts.set(key, e = { tx, w: cv.width / cv.height });
        if (fx.texts.size > 150) { const k0 = fx.texts.keys().next().value; fx.texts.get(k0).tx.dispose(); fx.texts.delete(k0); }
      }
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: e.tx, transparent: true, depthTest: false, depthWrite: false, fog: false }));
      s.position.set(p.x + rnd(-.25, .25), (p.y || 2) + .1, p.z); s.scale.set(size * e.w, size, 1); s.renderOrder = 30;
      const y0 = s.position.y;
      return add(s, 1.25, k => { s.position.y = y0 + ease(k) * 1.1; s.material.opacity = k < .7 ? 1 : (1 - k) / .3; });
    },
    texts: new Map(),
    // floating damage number: numbers rarely repeat, so each one owns its texture and frees it when it ends
    num(p, str, c = '#ffffff', size = .5, big = false) {
      if (fx.nums >= 110) return null;
      const cv = document.createElement('canvas'), g = cv.getContext('2d'), font = 'bold 40px Georgia, serif';
      g.font = font; cv.width = Math.ceil(g.measureText(str).width) + 20; cv.height = 54;
      g.font = font; g.textBaseline = 'middle'; g.lineWidth = 7; g.strokeStyle = '#000'; g.lineJoin = 'round'; g.strokeText(str, 10, 28); g.fillStyle = c; g.fillText(str, 10, 28);
      const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, transparent: true, depthTest: false, depthWrite: false, fog: false }));
      const w = cv.width / cv.height, x0 = p.x + rnd(-.4, .4), y0 = (p.y || 2) + rnd(.35), dx = rnd(-.5, .5);
      s.position.set(x0, y0, p.z + rnd(-.2, .2)); s.renderOrder = big ? 32 : 31; fx.nums++;
      const e = add(s, big ? 1.5 : 1.15, k => {
        const pop = 1 + (big ? .7 : .3) * Math.max(0, 1 - k * 7);
        s.scale.set(size * w * pop, size * pop, 1);
        s.position.x = x0 + dx * k; s.position.y = y0 + ease(k) * 1.4;
        s.material.opacity = k < .65 ? 1 : (1 - k) / .35;
      });
      e.tex = tx; return e;
    },
    nums: 0,

    // ---------- composite explosion by element, after the game's own skill videos (Fireball, Ice Nova, Spark, Contagion):
    // no ring or outline at the edge, the burst itself fills the area
    explode(p, r, el, o = {}) {
      const c = hex(el), n = Math.min(150, Math.round(14 + r * r * 7)), y = p.y || 0, at = { x: p.x, y: y + .3, z: p.z };
      fx.disc(p, r, c, .3, { a: .35 });
      flash(p, c, 30 + r * 22, .35, 8 + r * 3);
      if (!o.soft) fx.ball({ x: p.x, y: y + .5, z: p.z }, Math.min(r * .4, 1.6), c, .2);
      if (el === 'fire') {   // tongues of flame over the whole area, a few left burning for a moment on the scorch
        emit(n, { p: at, r: r * .5, v: r * 2.4, up: 3.5, life: .7, size: .28, c: 'fire', c2: 'ember', g: 3, drag: 1.2 });
        emit(n * .6, { p: { x: p.x, y: y + .1, z: p.z }, r: r * .9, v: .5, up: 3, life: .5, size: .75, grow: .3, c: 'fire', c2: 'ember', k: 1.6, drag: 2 });
        emit(n / 4, { p: at, r: r * .6, v: 1, up: 2.2, life: 1.3, size: .9, grow: 2.4, c: 'smoke', smoke: true, a: .45, drag: .6 });
        fx.burn(p, r * .8, 1.4);
        fx.disc(p, r * .85, 0x050302, 4, { dark: true, a: .55, tex: 'patch', hold: .6, y: .03 });
      } else if (el === 'cold') {   // ice shards bursting out in a star
        fx.shards(p, r);
        emit(n, { p: at, r: r * .4, v: r * 3, up: 2, life: .8, size: .2, c: 'ice', c2: 'cold', g: 7, drag: .8 });
        emit(n / 3, { p: at, r: r * .8, v: .8, up: .5, life: 1.2, size: .8, grow: 2, c: 'cold', k: .5, drag: 1 });
        fx.disc(p, r, 'ice', 2.5, { tex: 'cracks', a: .55, hold: .5, k: 1.1 });
      } else if (el === 'lightning') {   // forks crackling along the ground, besides the strikes from above
        for (let i = 0; i < 2 + Math.min(3, r | 0); i++) {
          const q = new THREE.Vector3(p.x + rnd(-r, r) * .5, y, p.z + rnd(-r, r) * .5);
          fx.bolt(new THREE.Vector3(q.x + rnd(-1.5, 1.5), 11, q.z + rnd(-1.5, 1.5)), q, 'lightning', .2, .06, .5);
        }
        fx.forks(p, r);
        emit(n, { p: at, r: r * .5, v: r * 4.5, up: 2, life: .35, size: .16, c: 'lightning', c2: 'white', drag: 2.5, k: 3 });
      } else if (el === 'chaos') {   // dark violet wisps rising
        emit(n, { p: at, r: r * .8, v: 1.4, up: 2.4, life: 1.1, size: .26, c: 'chaos', c2: 'poison', drag: 1 });
        emit(n / 2, { p: { x: p.x, y: y + .1, z: p.z }, r: r * .8, v: .3, up: 1.6, life: 1.6, size: 1, grow: 2, c: 0x2a1040, smoke: true, a: .6, drag: .8 });
      } else if (el === 'physical') {
        emit(n * .7, { p: at, r: r * .5, v: r * 2.2, up: 4, life: .8, size: .13, c: 'dust', c2: 0xb8a890, g: 12, drag: .5, k: 1 });
        emit(n / 3, { p: at, r: r * .8, v: 1.6, up: 1.2, life: 1.1, size: 1, grow: 2.2, c: 'dust', smoke: true, a: .4, drag: 1.2 });
        fx.disc(p, r, 0x0a0806, 5, { dark: true, tex: 'cracks', a: .8, hold: .6, y: .03 });
      } else emit(n, { p: at, r: r * .5, v: r * 2.6, up: 2, life: .6, size: .2, c, c2: 'white', drag: 1.5 });
    },

    // ice shards bursting out from p in a star, reaching r in about `dur` seconds (Ice Nova's look)
    shards(p, r, dur = .22) {
      const y = p.y || 0;
      for (let i = 0, N = Math.min(30, 8 + r * 7); i < N; i++) {
        const a = rnd(TAU), l = r * rnd(.55, 1);
        fx.streak(new THREE.Vector3(p.x, y + .2, p.z), new THREE.Vector3(p.x + Math.cos(a) * l, y + rnd(.05, .5), p.z + Math.sin(a) * l), 'ice', dur * rnd(.75, 1.2), rnd(.03, .055), rnd(.7, 1.5));
      }
    },
    // lightning forking out from p along the ground (Spark's look)
    forks(p, r) {
      const y = p.y || 0;
      for (let i = 0, N = 3 + Math.min(6, r * 2 | 0); i < N; i++) {
        const a = rnd(TAU), l = r * rnd(.6, 1);
        fx.bolt(new THREE.Vector3(p.x, y + .25, p.z), new THREE.Vector3(p.x + Math.cos(a) * l, y + .1, p.z + Math.sin(a) * l), 'lightning', rnd(.12, .22), .03, .35);
      }
    },
    // flames left on the ground for `dur` seconds, dying down
    burn(p, r, dur) {
      return add(new THREE.Object3D(), dur, (k, e, dt) => {
        emit(40 * r * dt * (1 - k) + Math.random() | 0, { p: { x: p.x, y: (p.y || 0) + .05, z: p.z }, r, up: 1.6, life: .45, size: .35, grow: .2, c: 'fire', c2: 'ember', k: 1.5, drag: 2 });
      });
    },
    // a projectile's trail, one frame of it (big: a slow, large one)
    trail(p, el, big) {
      if (el === 'fire') {
        emit(big ? 3 : 2, { p, r: .05, v: .3, up: .5, life: .3, size: big ? .42 : .26, grow: .1, c: 'fire', c2: 'ember', k: 1.8, drag: 2 });
        emit(1, { p, v: .2, up: .8, life: .7, size: .3, grow: 2, c: 'smoke', smoke: true, a: .25 });
      } else if (el === 'lightning') {   // little arcs crackling around it
        emit(2, { p, r: .08, v: 2.5, life: .15, size: .1, c: 'lightning', c2: 'white', k: 3, drag: 3 });
        if (Math.random() < .5) { const a = rnd(TAU), l = rnd(.3, big ? 1 : .7); fx.bolt(p.clone(), new THREE.Vector3(p.x + Math.cos(a) * l, p.y + rnd(-.4, .2), p.z + Math.sin(a) * l), 'lightning', .08, .018, .25); }
      }
      else if (el === 'cold') emit(2, { p, r: .05, v: .3, life: .45, size: big ? .24 : .16, c: 'ice', c2: 'cold', g: 2, drag: 1 });
      else if (el === 'chaos') { emit(1, { p, v: .3, life: .4, size: .18, c: 'chaos', drag: 1 }); emit(1, { p, v: .2, up: .4, life: .8, size: .35, grow: 2, c: 0x2a1040, smoke: true, a: .4 }); }
      else emit(big ? 2 : 1, { p, v: .4, life: .35, size: big ? .3 : .16, c: el, c2: 'white', drag: 1 });
    },

    // ---------- small props used by the skills
    orb(c, r = .16) {
      const g = new THREE.Group(), core = new THREE.Mesh(BALL, new THREE.MeshBasicMaterial({ color: color(c, 3.2), fog: false }));
      core.scale.setScalar(r); g.add(core);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.glow, color: color(c, 1.6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
      s.scale.setScalar(r * 7); g.add(s); g.userData.glow = s; g.userData.core = core;
      return g;
    },
    arrow(c) {
      const g = new THREE.Group(), sh = new THREE.Mesh(SHAFT, new THREE.MeshBasicMaterial({ color: color(c, 2.6), fog: false }));
      g.add(sh);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.glow, color: color(c, 1.3), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
      s.scale.setScalar(.7); s.position.z = .4; g.add(s);
      return g;
    },
    setViewport(h, fov) { const s = h / (2 * Math.tan(fov * Math.PI / 360)); sparks.mat.uniforms.scale.value = s; smoke.mat.uniforms.scale.value = s; },
    update(dt) {
      for (let i = fxs.length - 1; i >= 0; i--) {
        const e = fxs[i]; e.t += dt;
        e.upd?.(Math.min(1, e.t / e.dur), e, dt);
        if (e.t >= e.dur) { scene.remove(e.obj); e.obj.material?.dispose(); if (e.own) e.obj.geometry.dispose(); if (e.tex) { e.tex.dispose(); fx.nums--; } fxs.splice(i, 1); }
      }
      for (const l of lights) { const u = l.userData; u.t += dt; const k = Math.max(0, 1 - u.t / u.dur); l.intensity = u.i * k * k; }
      sparks.update(dt); smoke.update(dt);
    },
  };
  return fx;
}

// ---------- the test room: a prototype level like a game engine's blank one: a grid floor measured in metres (dark, so
// that the effects read as they do in the game), a low wall around where you can walk and blocks beyond it. Its size
// and blocks are the app's own drawing; only the floor's metres are a measure.
export const ROOM = 30;   // m from its centre to the wall
const std = (color, roughness = .9, metalness = 0, o = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...o });
export function buildArena(scene, fx) {
  const SKY = 0x4d5b6e;
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 60, 190);
  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x3a3d42, 1.1));
  const sun = new THREE.DirectionalLight(0xfff2dc, 2.6);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -.0005; sun.shadow.normalBias = .03;
  Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 90 });
  scene.add(sun, sun.target);

  // a tile of 5 m: a line every metre, a heavier one around it
  const grid = (base, line) => tex(1024, 1024, (g, w) => {
    g.fillStyle = base; g.fillRect(0, 0, w, w); g.strokeStyle = line;
    for (let i = 0; i <= 5; i++) { const x = i * w / 5; g.globalAlpha = i % 5 ? .3 : .75; g.lineWidth = i % 5 ? 3 : 8; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, w); g.moveTo(0, x); g.lineTo(w, x); g.stroke(); }
  }, 1);
  const floorTex = grid('#2c2f35', '#8a93a0'); floorTex.repeat.set(80, 80); floorTex.anisotropy = 8;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), std(0xffffff, .92, 0, { map: floorTex }));
  ground.receiveShadow = true; scene.add(ground);
  // the measure painted on the floor: the centre, and the metres of every heavy line along both axes
  const W = ROOM + 1, marks = tex(2048, 2048, (g, w) => {
    const m = w / (2 * W), c = w / 2;
    g.strokeStyle = g.fillStyle = '#fff'; g.font = '600 22px Segoe UI, Arial, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'top';
    for (let r = 5; r <= ROOM; r += 5) for (const [x, y] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) g.fillText(r + ' m', c + x * r * m + 6, c + y * r * m + 5);
    g.lineWidth = 3; g.beginPath(); g.arc(c, c, m, 0, TAU); g.stroke();
  });
  const inlay = new THREE.Mesh(new THREE.PlaneGeometry(2 * W, 2 * W).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: marks, transparent: true, opacity: .5, depthWrite: false }));
  inlay.position.y = .012; inlay.renderOrder = 1; scene.add(inlay);

  // the wall around the room, low enough to see over, and prototype blocks beyond it
  const blockTex = grid('#4f6a8c', '#c5d3e6'), blue = std(0xffffff, .85, 0, { map: blockTex }), orange = std(0xc9742f, .8);
  const add = (geo, mat, x, y, z, ry = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = m.receiveShadow = true; scene.add(m); return m; };
  const N = 24, wall = new THREE.BoxGeometry(2 * W * Math.tan(Math.PI / N) + .1, 1.2, .8), cube = new THREE.BoxGeometry(2, 2, 2), slab = new THREE.BoxGeometry(6, 1, 3);
  for (let i = 0; i < N; i++) { const a = i / N * TAU; add(wall, blue, Math.sin(a) * (W + .4), .6, Math.cos(a) * (W + .4), a); }
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * TAU + .3, r = 39 + (i % 3) * 3, x = Math.sin(a) * r, z = Math.cos(a) * r;
    if (i % 2) { for (let k = 0; k < 3; k++) add(slab, blue, x, .5 + k, z, a).translateZ(k * 1.2); }   // steps
    else { add(cube, blue, x, 1, z, a); add(cube, i % 4 ? blue : orange, x, 3, z, a + .5); add(cube, blue, x + Math.cos(a) * 2.2, 1, z - Math.sin(a) * 2.2, a); }
  }

  return {
    ground,
    update(dt, pp) { sun.position.set(pp.x - 14, 32, pp.z + 10); sun.target.position.set(pp.x, 0, pp.z); },
  };
}

// ---------- figures
const shadow = o => { o.traverse(m => { if (m.isMesh) m.castShadow = true; }); return o; };
let PM;   // shared materials of the dummies and the summons
const mats = () => PM ||= {
  leather: std(0x4c3828, .85), cloth: std(0x6e211d, .9, 0, { side: THREE.DoubleSide }), dark: std(0x26211e, .9, 0, { side: THREE.DoubleSide }), metal: std(0x9c968a, .4, .8), skin: std(0xc49a7c, .7),
  wood: std(0x5c4026, .85), darkwood: std(0x3a2a1a, .9), rope: std(0x8a7448, 1), bone: std(0xd8d0b8, .7), red: std(0x8a1f18, .8),
};

// Figure of a placed enemy: a training dummy dressed by the monster's category (the game models are not available).
// Own material for the sackcloth (tinted by the states), a plate with life and energy shield, and the markers
// of frozen / cursed / marked. o = { kind (category), scale }
const LOOK = {
  Beast: { tint: 0x7a5a3a, horns: 0x3a2a1a, helm: false }, Humanoid: { tint: 0x9a8560, helm: true }, Undead: { tint: 0xb9b4a2, helm: false },
  Demon: { tint: 0x7c2a22, horns: 0x1c1512, helm: false }, Construct: { tint: 0x6c7884, helm: true },
};
export function makeDummy(fx, o = {}) {
  const M = mats(), g = new THREE.Group(), upper = new THREE.Group(); g.add(upper);
  const look = LOOK[o.kind] || LOOK.Humanoid, sc = o.scale || 1;
  const sack = std(look.tint, 1);
  const mesh = (geo, m, x, y, z, parent = upper) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); parent.add(o); return o; };
  const G = makeDummy.G ||= {
    base: new THREE.CylinderGeometry(.42, .5, .12, 14), post: new THREE.CylinderGeometry(.07, .085, 1.2, 8), body: new THREE.CylinderGeometry(.27, .21, .78, 12),
    rope: new THREE.TorusGeometry(.25, .022, 6, 14).rotateX(Math.PI / 2), bar: new THREE.CylinderGeometry(.045, .045, 1.05, 8).rotateZ(Math.PI / 2), head: new THREE.SphereGeometry(.17, 12, 10),
    helm: new THREE.SphereGeometry(.19, 12, 6, 0, TAU, 0, Math.PI / 2), target: new THREE.CircleGeometry(.11, 14), ice: new THREE.IcosahedronGeometry(.55, 1),
    plane: new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), torus: new THREE.TorusGeometry(.5, .022, 6, 28).rotateX(Math.PI / 2), horn: new THREE.ConeGeometry(.045, .26, 6),
  };
  mesh(G.base, M.darkwood, 0, .06, 0, g); mesh(G.post, M.wood, 0, .7, 0);
  mesh(G.body, sack, 0, 1.15, 0); mesh(G.rope, M.rope, 0, 1.38, 0).scale.setScalar(1.02); mesh(G.rope, M.rope, 0, .95, 0).scale.setScalar(.9);
  mesh(G.bar, M.wood, 0, 1.4, 0); mesh(G.head, sack, 0, 1.71, 0);
  if (look.helm) mesh(G.helm, M.metal, 0, 1.74, 0);
  if (look.horns) for (const s of [1, -1]) mesh(G.horn, M.dark, s * .12, 1.9, 0).rotation.z = -s * .45;
  mesh(G.target, M.red, 0, 1.18, .262);
  shadow(g); g.scale.setScalar(sc);
  const ice = new THREE.Mesh(G.ice, new THREE.MeshStandardMaterial({ color: 0x9fdcff, transparent: true, opacity: .5, roughness: .08, metalness: .1, emissive: 0x1c5a8a, flatShading: true }));
  ice.position.y = 1.05; ice.scale.set(1, 1.95, 1); ice.visible = false; g.add(ice);
  const curse = new THREE.Mesh(G.plane, fx.glowMat('curse', 1.8, .85, fx.T.rune)); curse.position.y = .05 / sc; curse.scale.set(.85, 1, .85); curse.visible = false; g.add(curse);
  const mark = new THREE.Mesh(G.torus, fx.glowMat('mark', 2.6, .95)); mark.position.y = 1.2; mark.visible = false; g.add(mark);
  const P = lifePlate(g, 2.05 + .5 / sc, 2.5 / sc);
  return {
    group: g, upper, sack, ice, curse, mark, plate: P.plate, scale: sc, draw: P.draw,
    dispose() { g.parent?.remove(g); sack.dispose(); ice.material.dispose(); curse.material.dispose(); mark.material.dispose(); P.dispose(); },
  };
}

// The bar over a figure's head, as the game's: its states as coloured pips, a small energy shield bar, its life under it.
function lifePlate(g, y, w) {
  const W = 256, H = 80, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace;
  const plate = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, transparent: true, depthWrite: false, fog: false }));
  plate.position.y = y; plate.scale.set(w, w * H / W, 1); plate.renderOrder = 25; g.add(plate);
  return {
    plate,
    // life / es = fractions left (null hides the bar), pips = css colours of the active states
    draw({ life = null, es = null, pips = [] }) {
      const c = cv.getContext('2d'); c.clearRect(0, 0, W, H);
      let x = W / 2 - pips.length * 8;
      for (const p of pips) { c.fillStyle = p; c.beginPath(); c.arc(x + 8, 10, 6.5, 0, TAU); c.fill(); c.strokeStyle = '#000'; c.lineWidth = 1.5; c.stroke(); x += 16; }
      const bar = (y, h, k, col) => {
        c.fillStyle = 'rgba(0,0,0,.78)'; c.fillRect(68, y, 120, h); c.fillStyle = col; c.fillRect(69, y + 1, 118 * Math.max(0, Math.min(1, k)), h - 2);
        c.strokeStyle = '#3a3020'; c.lineWidth = 1; c.strokeRect(68.5, y + .5, 120, h);
      };
      if (es != null) bar(52, 6, es, '#5aa8e8');   // a small bar with no name, as the game's
      if (life != null) bar(59, 9, life, life > .35 ? '#b8281e' : '#e06a20');
      tx.needsUpdate = true;
    },
    dispose() { plate.material.dispose(); tx.dispose(); },
  };
}

// Small summoned figure (skeleton-like) tinted with the element of its skill.
export function makeMinion(fx, c) {
  const M = mats(), g = new THREE.Group();
  const mesh = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); g.add(o); return o; };
  mesh(new THREE.CylinderGeometry(.07, .05, .7, 6), M.bone, .09, .35, 0); mesh(new THREE.CylinderGeometry(.07, .05, .7, 6), M.bone, -.09, .35, 0);
  mesh(new THREE.CylinderGeometry(.19, .13, .5, 8), M.bone, 0, .95, 0); mesh(new THREE.SphereGeometry(.14, 10, 8), M.bone, 0, 1.36, 0);
  const arm = mesh(new THREE.CylinderGeometry(.04, .04, .55, 6), M.bone, .24, 1, .12); arm.rotation.x = -1;
  mesh(new THREE.CylinderGeometry(.02, .02, .9, 5), M.metal, .24, 1.15, .42).rotation.x = -.9;
  shadow(g);
  const eyes = fx.orb(c, .035); eyes.position.set(0, 1.38, .12); g.add(eyes);
  const P = lifePlate(g, 1.75, 1.6);
  return { group: g, arm, draw: P.draw, dispose() { g.parent?.remove(g); eyes.traverse(m => m.material?.dispose()); P.dispose(); } };
}

export function makeTotem(fx, c, ballista) {
  const M = mats(), g = new THREE.Group();
  const mesh = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); g.add(o); return o; };
  if (ballista) {
    mesh(new THREE.CylinderGeometry(.06, .3, .9, 6), M.darkwood, 0, .45, 0); mesh(new THREE.BoxGeometry(.16, .14, 1.1), M.wood, 0, 1, 0);
    mesh(new THREE.BoxGeometry(1.3, .07, .09), M.wood, 0, 1.05, .35); mesh(new THREE.BoxGeometry(.1, .1, .3), M.metal, 0, 1.08, .5);
  } else {
    mesh(new THREE.CylinderGeometry(.26, .32, 1.7, 8), M.wood, 0, .85, 0); mesh(new THREE.BoxGeometry(.7, .22, .5), M.darkwood, 0, 1.75, 0);
    mesh(new THREE.BoxGeometry(.46, .3, .12), M.darkwood, 0, 1.25, .24); mesh(new THREE.ConeGeometry(.2, .4, 6), M.darkwood, 0, 2.05, 0);
  }
  shadow(g);
  const eye = fx.orb(c, ballista ? .05 : .08); eye.position.set(0, ballista ? 1.15 : 1.3, ballista ? .5 : .32); g.add(eye);
  const P = lifePlate(g, ballista ? 1.6 : 2.55, 1.8);
  return { group: g, draw: P.draw, dispose() { g.parent?.remove(g); eye.traverse(m => m.material?.dispose()); P.dispose(); } };
}
