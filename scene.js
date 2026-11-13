// 3D test room. 1 unit = 1 metre (PoE: 10 game units = 1 m). Sizes/speeds come from geo() / playerSpeed() (game data).
// Dummies are point targets: monster hitbox sizes are not in the extracted data, so a hit needs the dummy's centre inside.
// WASD move, 1-9 pick a skill from the build, left click casts it towards the cursor, R respawns dummies.
import * as THREE from 'three';

export function initScene(el, getBuild, geo, playerSpeed) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  el.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x15151a);
  const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x333344, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(10, 20, 5); scene.add(sun);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x2a2a30 }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
  const grid = new THREE.GridHelper(200, 200, 0x444455, 0x33333a); grid.position.y = 0.01; scene.add(grid);

  const player = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 1, 4, 12), new THREE.MeshStandardMaterial({ color: 0xc8a050 }));
  player.position.y = 0.9; scene.add(player);

  let dummies = [];
  function spawn() {
    dummies.forEach(d => scene.remove(d));
    dummies = Array.from({ length: 25 }, () => {
      const d = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 1.6, 12), new THREE.MeshStandardMaterial({ color: 0x777777 }));
      const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 14;
      d.position.set(player.position.x + Math.cos(a) * r, 0.8, player.position.z + Math.sin(a) * r);
      d.userData.hits = 0; d.userData.flash = 0;
      scene.add(d); return d;
    });
  }
  spawn();

  // Shapes: circle at cursor, nova around you, cone/line from you towards the cursor,
  // projectile flies and stops at the first dummy, aura toggles a circle that follows you and marks who is inside.
  const effects = [], projectiles = [];
  let aura = null;
  const mat = color => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide });
  const hit = d => { d.userData.hits++; d.userData.flash = 0.3; };
  function flat(geo, x, z, rotY = 0, color = 0x66aaff) {
    const m = new THREE.Mesh(geo, mat(color));
    m.rotation.set(-Math.PI / 2, 0, rotY); m.position.set(x, 0.02, z);
    scene.add(m); return m;
  }
  function cast(point) {
    const g = getBuild().gems[skill];
    if (!g) return;
    const G = geo(g), shape = g.shape || 'circle', R = G.radius, W = G.width, p = player.position;
    if (shape === 'projectile' ? !G.speed : !R) { msg = shape === 'projectile' ? 'Sin velocidad de proyectil en los datos' : 'Radio 0: el juego no da radio, pon uno manual'; return; }
    const dir = new THREE.Vector2(point.x - p.x, point.z - p.z).normalize(), ang = Math.atan2(-dir.y, dir.x);
    const rel = d => new THREE.Vector2(d.position.x - p.x, d.position.z - p.z);
    let mesh, test;
    if (shape === 'circle' || shape === 'nova') {
      const c = shape === 'nova' ? p : point;
      mesh = flat(new THREE.CircleGeometry(R, 48), c.x, c.z);
      test = d => Math.hypot(d.position.x - c.x, d.position.z - c.z) <= R;
    } else if (shape === 'cone') {
      const half = THREE.MathUtils.degToRad(W) / 2;
      mesh = flat(new THREE.CircleGeometry(R, 32, -half, 2 * half), p.x, p.z, ang);
      test = d => { const v = rel(d); return v.length() <= R && Math.abs(Math.atan2(dir.x * v.y - dir.y * v.x, dir.dot(v))) <= half; };
    } else if (shape === 'line') {
      const geo = new THREE.PlaneGeometry(R, W); geo.translate(R / 2, 0, 0);
      mesh = flat(geo, p.x, p.z, ang);
      test = d => { const v = rel(d), t = dir.dot(v); return t >= 0 && t <= R && Math.abs(dir.x * v.y - dir.y * v.x) <= W / 2; };
    } else if (shape === 'projectile') {
      const m = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.1, G.collision), 12, 8), new THREE.MeshBasicMaterial({ color: 0xffaa44 }));
      m.position.set(p.x, 0.9, p.z); scene.add(m);
      projectiles.push({ mesh: m, dir, left: G.range, speed: G.speed, r: G.collision }); return;
    } else if (shape === 'aura') {
      if (aura) { scene.remove(aura.mesh); aura = null; return; }
      aura = { mesh: flat(new THREE.CircleGeometry(R, 48), p.x, p.z, 0, 0x88ff88), R }; return;
    }
    effects.push({ mesh, t: 0 });
    dummies.filter(test).forEach(hit);
  }

  function update(dt) {
    for (let i = effects.length - 1; i >= 0; i--) {
      const f = effects[i]; f.t += dt; f.mesh.material.opacity = 0.45 * (1 - f.t / 0.6);
      if (f.t > 0.6) { scene.remove(f.mesh); f.mesh.geometry.dispose(); effects.splice(i, 1); }
    }
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const q = projectiles[i], step = Math.min(q.left, q.speed * dt);
      q.mesh.position.x += q.dir.x * step; q.mesh.position.z += q.dir.y * step; q.left -= step;
      const d = dummies.find(d => Math.hypot(d.position.x - q.mesh.position.x, d.position.z - q.mesh.position.z) <= q.r);
      if (d) hit(d);
      if (d || q.left <= 0) { scene.remove(q.mesh); projectiles.splice(i, 1); }
    }
    if (aura) {
      aura.mesh.position.set(player.position.x, 0.02, player.position.z);
      for (const d of dummies) if (Math.hypot(d.position.x - player.position.x, d.position.z - player.position.z) <= aura.R) d.userData.flash = Math.max(d.userData.flash, 0.05);
    }
  }

  let skill = 0, msg = '';
  const keys = {}, mouse = new THREE.Vector2(), ray = new THREE.Raycaster();
  addEventListener('keydown', e => {
    if (el.hidden || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    keys[e.code] = true;
    if (/^Digit[1-9]$/.test(e.code)) skill = +e.code[5] - 1;
    if (e.code === 'KeyR') spawn();
  });
  addEventListener('keyup', e => keys[e.code] = false);
  renderer.domElement.addEventListener('mousedown', e => {
    const r = renderer.domElement.getBoundingClientRect();
    mouse.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(mouse, cam);
    const hit = ray.intersectObject(ground)[0];
    msg = ''; if (hit) cast(hit.point);
  });

  const hud = el.querySelector('#hud'), clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    if (el.hidden) return;
    const dt = Math.min(clock.getDelta(), 0.1);
    if (renderer.domElement.width !== el.clientWidth || renderer.domElement.height !== el.clientHeight) {
      renderer.setSize(el.clientWidth, el.clientHeight); cam.aspect = el.clientWidth / el.clientHeight; cam.updateProjectionMatrix();
    }
    const mv = new THREE.Vector2((keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0), (keys.KeyS ? 1 : 0) - (keys.KeyW ? 1 : 0)).normalize().multiplyScalar(playerSpeed() * dt);
    player.position.x += mv.x; player.position.z += mv.y;
    cam.position.set(player.position.x, 18, player.position.z + 14); cam.lookAt(player.position);

    update(dt);
    for (const d of dummies) {
      d.userData.flash = Math.max(0, d.userData.flash - dt);
      d.material.color.setHex(d.userData.flash ? 0xff4444 : 0x777777);
    }
    const gems = getBuild().gems;
    hud.textContent = (gems.length ? gems.map((g, i) => {
      const G = geo(g);
      return `${i === skill ? '▶' : ' '} ${i + 1}. ${g.name}  (${g.shape || 'circle'}, ${g.shape === 'projectile'
        ? (G.speed ? `${G.speed.toFixed(1)} m/s, ${G.range.toFixed(1)} m` : 'sin datos')
        : `${G.radius.toFixed(2)} m${G.radiusFromData ? '' : ' manual'}`})`;
    }).join('\n') : 'Añade gemas a la build')
      + `\n\nVelocidad: ${playerSpeed().toFixed(2)} m/s · WASD mover · 1-9 habilidad · clic lanzar · R reiniciar`
      + `\nImpactos totales: ${dummies.reduce((s, d) => s + d.userData.hits, 0)}${msg ? '\n' + msg : ''}`;
    renderer.render(scene, cam);
  });
}
