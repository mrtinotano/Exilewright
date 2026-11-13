import { initScene } from './scene.js';
import { statLines } from './stats.js';
import { initItems, gearStats } from './items.js';
import { initSkills } from './skills.js';

const $ = id => document.getElementById(id);
const load = f => fetch('poe2_data/available/' + f).then(r => r.json());
const [tree, gems, ascs, SK] = await Promise.all([load('passive_tree.json'), load('gems.json'), load('ascendancies.json'), load('skills.json')]);
const N = tree.nodes;
const ROOTS = new Set(tree.class_roots.map(String));
const label = n => n.name_es || n.name;

// ---------- builds (localStorage; export/import as JSON files)
const KEY = 'poe2builds';
let builds = JSON.parse(localStorage.getItem(KEY) || '{}');
let cur;
const SHAPES = { circle: 'Círculo (cursor)', nova: 'Nova (en ti)', cone: 'Cono', line: 'Línea', projectile: 'Proyectil', aura: 'Aura (te sigue)' };
const guessShape = t => t.includes('nova') || t.includes('warcry') ? 'nova' : t.includes('projectile') ? 'projectile' : t.includes('aura') || t.includes('persistent') ? 'aura'
  : t.includes('slam') || t.includes('strike') ? 'cone' : 'circle';
const blank = () => ({ name: 'Nueva build', asc: ascs[0].name, gems: [], nodes: [], ascNodes: [], notes: '' });
const save = () => { localStorage.setItem(KEY, JSON.stringify(builds)); };
function select(id) {
  cur = id; localStorage.setItem(KEY + ':last', id);
  renderSide(); drawTree(); renderItems?.();
}
const B = () => builds[cur];
if (!Object.keys(builds).length) builds[Date.now()] = blank();

// ---------- sidebar
$('asc').innerHTML = ascs.map(a => `<option>${a.name}</option>`).join('');
$('gemNames').innerHTML = gems.filter(g => g.kind !== 'support').map(g => `<option value="${g.name}">${g.name_es || ''} · ${g.kind}</option>`).join('');

function renderSide() {
  const b = B();
  b.gems.forEach(g => { g.level ??= 20; g.width ??= 0; });  // builds saved before gem levels existed
  $('buildList').innerHTML = Object.entries(builds).map(([id, x]) => `<option value="${id}" ${id === cur ? 'selected' : ''}>${x.name}</option>`).join('');
  $('name').value = b.name; $('asc').value = b.asc; $('notes').value = b.notes;
  $('gems').innerHTML = b.gems.map((g, i) => {
    const G = geo(g), num = (k, v, t) => `<input type="number" step="0.1" min="0" data-i="${i}" data-k="${k}" value="${v}" title="${t}">`;
    return `<li style="flex-wrap:wrap"><span>${i + 1}. ${g.name}</span>nv${num('level', g.level, 'nivel de gema')}<button data-del="${i}">✕</button>
    <select data-i="${i}" data-k="shape" style="width:auto">${Object.entries(SHAPES).map(([k, t]) => `<option value="${k}" ${k === g.shape ? 'selected' : ''}>${t}</option>`).join('')}</select>
    ${g.shape === 'projectile' ? '' : G.radiusFromData ? `<span title="active_skill_base_area_of_effect_radius × área del árbol">radio ${G.radius.toFixed(2)} m</span>` : `radio${num('radius', g.radius, 'el juego no da radio para esta gema: valor manual')}<small>manual</small>`}
    ${g.shape === 'cone' || g.shape === 'line' ? `${g.shape === 'cone' ? 'ángulo°' : 'ancho m'}${num('width', g.width, 'el juego no da este dato: valor manual')}<small>manual</small>` : ''}
    ${g.shape === 'projectile' ? `<small>${G.speed ? `${G.speed.toFixed(1)} m/s · alcance ${G.range.toFixed(1)} m` : 'sin velocidad en los datos'}</small>` : ''}</li>`;
  }).join('');
  renderStats();
  renderSkills?.();
}
const statText = n => statLines(n.stats).join('\n') + (n.grants_skill ? `\nOtorga: ${n.grants_skill}` : '');

// Attribute nodes: right click cycles Str/Dex/Int
const ATTR = { str: ['strength', '#c44'], dex: ['dexterity', '#4a4'], int: ['intelligence', '#48c'] };
const NEXT = { undefined: 'str', str: 'dex', dex: 'int', int: 'str' };
function nodeStats(id) {
  const n = N[id], a = (B().attrs || {})[id];
  return n.type === 'attribute' && a ? tree.attribute_options[ATTR[a][0]] : n.stats;  // game's hidden generic_attribute_* passives
}
function cycleAttr(id) {
  if (N[id].type !== 'attribute') return;
  const b = B(); b.attrs ||= {};
  b.attrs[id] = NEXT[b.attrs[id]];
  save(); renderSide(); drawTree();
}
function treeSum() {
  const b = B(), sum = {};
  for (const id of [...b.nodes, ...b.ascNodes]) for (const [k, v] of Object.entries(nodeStats(id))) sum[k] = (sum[k] || 0) + v;
  for (const [k, v] of Object.entries(gearStats(Object.fromEntries(Object.entries(b.items || {}).filter(([slot]) => !slot.startsWith('jewel:') || b.nodes.some(n => 'jewel:' + n === slot)))))) sum[k] = (sum[k] || 0) + v;
  return sum;
}
// Sum of "<prefix>_<suffix>" stats that apply to a gem: generic prefixes always, others only if the gem has that tag
// (spell_area_of_effect_+% -> spell, slam_skill_area_of_effect_+% -> slam). Minion/companion ones affect other skills.
function inc(sum, suffix, tags) {
  let t = 0;
  for (const [k, v] of Object.entries(sum)) {
    if (!k.endsWith(suffix)) continue;
    const pre = k.slice(0, -suffix.length).replace(/_skill_$|_$/, '');
    if (pre === '' || pre === 'base' || tags.includes(pre) && pre !== 'minion' && pre !== 'companion') t += v;
  }
  return t;
}
// Scene geometry in metres (game units / 10). Everything comes from skills.json + the tree, except values the game data lacks.
function geo(g) {
  const d = SK.skills[g.name] || {}, tags = gems.find(x => x.name === g.name)?.tags || [], sum = treeSum();
  const base = d.radius?.[g.level];
  const speed = d.projectile_speed && d.projectile_speed * (1 + inc(sum, 'projectile_speed_+%', tags) / 100) / 10;
  return {
    radiusFromData: base != null,
    // area modifiers scale area, so radius scales with the square root
    radius: base != null ? base / 10 * Math.sqrt(Math.max(0, 1 + inc(sum, 'area_of_effect_+%', tags) / 100)) : g.radius || 0,
    width: g.width || 0,
    speed,
    // range: skill override, else speed × duration, else 150 units (GGG: default max projectile distance)
    range: d.projectile_range ? d.projectile_range / 10 : d.duration_ms && speed ? speed * d.duration_ms / 1000 : 15,
    collision: (d.projectile_collision || 0) / 10,
  };
}
const playerSpeed = () => SK.player_base_speed * (1 + (treeSum()['base_movement_velocity_+%'] || 0) / 100) / 10;
function renderStats() {
  const b = B(), sum = treeSum();
  $('points').textContent = Math.max(0, b.nodes.length - 1);
  const pending = b.nodes.filter(id => N[id].type === 'attribute' && !(b.attrs || {})[id]).length; // game text always says "+5", so count them
  delete sum.display_passive_attribute_text;
  $('stats').textContent = statLines(sum).sort().join('\n') + (pending ? `\n${pending} nodo(s) de atributo sin elegir (clic derecho)` : '');
}

const edit = fn => e => { fn(e, B()); save(); renderSide(); drawTree(); };
$('buildList').onchange = e => select(e.target.value);
$('newBuild').onclick = () => { const id = String(Date.now()); builds[id] = blank(); save(); select(id); };
$('delBuild').onclick = () => {
  if (!confirm(`¿Borrar "${B().name}"?`)) return;
  delete builds[cur]; if (!Object.keys(builds).length) builds[Date.now()] = blank();
  save(); select(Object.keys(builds)[0]);
};
$('name').onchange = edit((e, b) => b.name = e.target.value);
$('asc').onchange = edit((e, b) => { b.asc = e.target.value; b.ascNodes = []; });
$('notes').onchange = edit((e, b) => b.notes = e.target.value);
$('gemSearch').onchange = edit((e, b) => {
  const g = gems.find(g => g.name === e.target.value);
  if (g) b.gems.push({ name: g.name, shape: guessShape(g.tags), level: 20, radius: 0, width: 0 });
  e.target.value = '';
});
$('gems').onchange = edit((e, b) => b.gems[e.target.dataset.i][e.target.dataset.k] = e.target.dataset.k === 'shape' ? e.target.value : +e.target.value);
$('gems').onclick = e => e.target.dataset.del && edit((_, b) => b.gems.splice(e.target.dataset.del, 1))(e);
$('export').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(B(), null, 1)], { type: 'application/json' }));
  a.download = B().name.replace(/[^\w-]+/g, '_') + '.json'; a.click();
};
$('import').onclick = () => $('importFile').click();
$('importFile').onchange = async e => {
  const b = { ...blank(), ...JSON.parse(await e.target.files[0].text()) };
  const id = String(Date.now()); builds[id] = b; save(); select(id); e.target.value = '';
};

// ---------- passive tree (canvas 2D), drawn like the in-game tree
const cv = $('treeCanvas'), ctx = cv.getContext('2d');
const R = { keystone: 58, notable: 40, jewel: 40, attribute: 24, small: 24, root: 52 };
const ORBIT = tree.orbit_radii || [], GROUPS = tree.groups || [];
const CENTRE_R = 1330;   // empty middle of the tree (class roots sit at ~1450): the chosen ascendancy is drawn there
// The data has no node icons yet: tint each node by the theme of its stats instead
const HUES = [[/fire|ignite|burn/, '#e0682c'], [/cold|freeze|chill/, '#62b6ea'], [/lightning|shock|electro/, '#e6d24c'], [/chaos|poison|wither/, '#a064d4'],
  [/minion|companion|totem|ally/, '#52c49c'], [/energy_shield|mana|spell|cast|intelligence/, '#5c82e2'],
  [/evasion|deflection|projectile|accuracy|movement|dexterity|bow|dodge/, '#70c464'],
  [/armour|block|stun|strength|shield|slam|mace/, '#c48c52'], [/life|leech|regeneration|flask/, '#d44c4c'], [/critical/, '#ececec']];
const hueOf = n => { const k = Object.keys(n.stats).join(' '); return HUES.find(([re]) => re.test(k))?.[1] || '#b49a68'; };
const HUE = Object.fromEntries(Object.entries(N).map(([id, n]) => [id, hueOf(n)]));

// ascendancy nodes live far outside the tree in the data: fit each ascendancy into the central circle
const ASC = {};
for (const [id, n] of Object.entries(N)) if (n.ascendancy) (ASC[n.ascendancy] ||= []).push(id);
const FIT = {};
for (const [a, ids] of Object.entries(ASC)) {
  const xs = ids.map(i => N[i].x), ys = ids.map(i => N[i].y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const half = Math.max(...ids.map(i => Math.hypot(N[i].x - cx, N[i].y - cy))) + 80;
  FIT[a] = { cx, cy, k: Math.min(1, (CENTRE_R - 150) / half) };
}
const world = (x, y, a) => a ? [(x - FIT[a].cx) * FIT[a].k, (y - FIT[a].cy) * FIT[a].k] : [x, y];
const WP = Object.fromEntries(Object.entries(N).map(([id, n]) => [id, world(n.x, n.y, n.ascendancy)]));
const main = Object.keys(N).filter(id => !N[id].ascendancy);
const ascStart = a => (ASC[a] || []).find(i => N[i].ascendancy_start);
const classRoot = a => N[ascStart(a)]?.links.map(String).find(l => ROOTS.has(l));
const BACKDROPS = new Map();   // small node clusters get a faint round backdrop, like the game's group art
for (const id of main) { const n = N[id]; if (n.group != null && ORBIT[n.orbit] <= 335) BACKDROPS.set(n.group, Math.max(BACKDROPS.get(n.group) || 0, ORBIT[n.orbit])); }
const visible = () => [...main, ...(ASC[B().asc] || [])];
let view = { x: 0, y: 0, s: 0 }, hover = null;

const walkable = (id, root) => N[id] && !N[id].ascendancy && (!ROOTS.has(id) || id === root);
function pathTo(have, target, ok) {   // BFS from the allocated set to target, returns the new node ids
  const prev = new Map(have.map(n => [n, null])), q = [...have];
  while (q.length) {
    const u = q.shift();
    if (u === target) break;
    for (const w of N[u].links.map(String)) if (!prev.has(w) && ok(w)) { prev.set(w, u); q.push(w); }
  }
  if (!prev.has(target)) return [];
  const out = []; for (let u = target; prev.get(u) !== null; u = prev.get(u)) out.push(u);
  return out.reverse();
}
function prune(nodes) {            // keep only what is still connected to nodes[0]
  const keep = new Set([nodes[0]]), q = [nodes[0]], set = new Set(nodes);
  while (q.length) for (const w of N[q.shift()].links.map(String)) if (set.has(w) && !keep.has(w)) { keep.add(w); q.push(w); }
  return nodes.filter(n => keep.has(n));
}
// what clicking `id` would allocate (empty if it is allocated already or unreachable)
function preview(id) {
  const b = B();
  if (N[id].ascendancy) {
    const st = ascStart(b.asc);
    return id === st || b.ascNodes.includes(id) ? [] : pathTo([st, ...b.ascNodes], id, w => N[w]?.ascendancy === b.asc);
  }
  if (b.nodes.includes(id)) return [];
  const have = b.nodes.length ? b.nodes : ROOTS.has(id) ? [] : [classRoot(b.asc)].filter(Boolean);
  if (!have.length) return ROOTS.has(id) ? [id] : [];
  return [...(b.nodes.length ? [] : have), ...pathTo(have, id, w => walkable(w, have[0]))];
}
function clickNode(id) {
  const b = B();
  if (N[id].ascendancy) {
    const st = ascStart(b.asc);
    if (id === st) return;
    b.ascNodes = b.ascNodes.includes(id) ? prune([st, ...b.ascNodes.filter(n => n !== id)]).slice(1) : [...b.ascNodes, ...preview(id)];
  } else if (id === b.nodes[0]) b.nodes = [];
  else if (b.nodes.includes(id)) b.nodes = prune(b.nodes.filter(n => n !== id));
  else b.nodes.push(...preview(id));
  save(); renderSide(); drawTree();
}

// link geometry in world units: same group + same orbit = arc around the group centre, like the game
function linkPath(p, a, b) {
  const [x1, y1] = WP[a], [x2, y2] = WP[b], A = N[a], Bn = N[b];
  p.moveTo(x1, y1);
  if (A.group != null && A.group === Bn.group && A.orbit === Bn.orbit && A.orbit > 0) {
    const [cx, cy] = world(...GROUPS[A.group], A.ascendancy), r = ORBIT[A.orbit] * (A.ascendancy ? FIT[A.ascendancy].k : 1);
    const a1 = Math.atan2(y1 - cy, x1 - cx); let d = Math.atan2(y2 - cy, x2 - cx) - a1;
    d = (d + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
    p.arc(cx, cy, r, a1, a1 + d, d < 0);
  } else p.lineTo(x2, y2);
}
const isRoot = id => ROOTS.has(id);
// game art, present only once the data was regenerated with the game installed (icon / tree_image fields + images.py)
const IMG = {};
function art(p) {
  if (!p) return null;
  const k = p.toLowerCase();
  if (!(k in IMG)) { IMG[k] = null; const im = new Image(); im.onload = () => { IMG[k] = im; redraw(); }; im.src = 'poe2_data/available/img/' + k.replace(/\.dds$/, '.webp'); }
  return IMG[k];
}
function drawNode(id, x, y, r, state) {   // state: on | path | off
  const n = N[id], lit = state !== 'off', type = isRoot(id) ? 'root' : n.type;
  const col = n.type === 'attribute' ? (ATTR[(B().attrs || {})[id]]?.[1] || '#b8b0a0') : isRoot(id) ? '#e8d8b0' : HUE[id];
  const frame = state === 'on' ? '#f2cf74' : state === 'path' ? '#c9b07a' : '#6a5d47';
  if (r < 3) { ctx.fillStyle = lit ? frame : type === 'keystone' || type === 'notable' ? '#8a7650' : '#4a4236'; ctx.beginPath(); ctx.arc(x, y, Math.max(1.2, r), 0, 7); ctx.fill(); return; }
  if (state === 'on') { ctx.shadowColor = '#f0b84a'; ctx.shadowBlur = r * .9; }
  // icon disc
  const g = ctx.createRadialGradient(x - r * .25, y - r * .3, r * .05, x, y, r);
  g.addColorStop(0, col); g.addColorStop(.75, '#100c08'); g.addColorStop(1, '#000');
  ctx.globalAlpha = lit ? 1 : .42;
  ctx.fillStyle = g;
  ctx.beginPath();
  if (type === 'jewel') { for (let i = 0; i < 6; i++) ctx.lineTo(x + r * .8 * Math.cos(i * Math.PI / 3), y + r * .8 * Math.sin(i * Math.PI / 3)); ctx.closePath(); }
  else ctx.arc(x, y, r * .82, 0, 7);
  ctx.fill(); ctx.shadowBlur = 0;
  const icon = r >= 6 && art(n.icon);
  if (icon) { ctx.save(); ctx.clip(); ctx.drawImage(icon, x - r * .82, y - r * .82, r * 1.64, r * 1.64); ctx.restore(); }
  ctx.globalAlpha = 1;
  // frame: thin ring for smalls, double gilded ring for notables, heavy ornate ring for keystones / class starts
  ctx.strokeStyle = frame;
  const ring = (rr, w) => { ctx.lineWidth = w; ctx.beginPath(); ctx.arc(x, y, rr, 0, 7); ctx.stroke(); };
  if (type === 'small' || type === 'attribute') ring(r * .88, Math.max(1, r * .14));
  else if (type === 'notable') { ring(r * .86, r * .12); ring(r * 1.02, r * .07); }
  else if (type === 'jewel') {
    ctx.lineWidth = r * .12; ctx.beginPath();
    for (let i = 0; i < 6; i++) ctx.lineTo(x + r * .9 * Math.cos(i * Math.PI / 3), y + r * .9 * Math.sin(i * Math.PI / 3));
    ctx.closePath(); ctx.stroke(); ring(r * 1.05, r * .05);
  } else {
    ring(r * .86, r * .14); ring(r * 1.02, r * .06);
    ctx.lineWidth = r * .08;
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; ctx.beginPath(); ctx.moveTo(x + r * .98 * Math.cos(a), y + r * .98 * Math.sin(a)); ctx.lineTo(x + r * 1.18 * Math.cos(a), y + r * 1.18 * Math.sin(a)); ctx.stroke(); }
  }
  if (id === hover) { ctx.strokeStyle = '#fff6d8'; ring(r * 1.12, 1.5); }
}

const dpr = () => devicePixelRatio || 1;
function drawTree() {
  if (!cv.offsetParent) return;
  const W = cv.clientWidth, H = cv.clientHeight, D = dpr();
  if (cv.width !== W * D || cv.height !== H * D) { cv.width = W * D; cv.height = H * D; }
  view.s ||= Math.min(W, H) / 26000;   // fit whole tree on first draw
  const s = view.s, b = B(), st = ascStart(b.asc);
  const on = new Set([...b.nodes, ...b.ascNodes, ...(st ? [st] : [])]);
  const pre = new Set(hover ? preview(hover) : []);
  const vis = visible(), visSet = new Set(vis);
  const sx = x => (x - view.x) * s + W / 2, sy = y => (y - view.y) * s + H / 2;

  // background
  ctx.setTransform(D, 0, 0, D, 0, 0);
  const bg = ctx.createRadialGradient(sx(0), sy(0), 0, sx(0), sy(0), 14000 * s + Math.max(W, H));
  bg.addColorStop(0, '#1a1712'); bg.addColorStop(.5, '#0d0c0a'); bg.addColorStop(1, '#050505');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  // world-space layers
  ctx.setTransform(D * s, 0, 0, D * s, D * (W / 2 - view.x * s), D * (H / 2 - view.y * s));
  // faint group backdrops
  ctx.fillStyle = 'rgba(200,170,110,0.03)';
  for (const [g, r] of BACKDROPS) { ctx.beginPath(); ctx.arc(...GROUPS[g], r + 60, 0, 7); ctx.fill(); }
  // central ascendancy disc
  const disc = ctx.createRadialGradient(0, 0, CENTRE_R * .2, 0, 0, CENTRE_R);
  disc.addColorStop(0, '#221d16'); disc.addColorStop(1, '#0b0a08');
  ctx.fillStyle = disc; ctx.beginPath(); ctx.arc(0, 0, CENTRE_R, 0, 7); ctx.fill();
  const A = ascs.find(a => a.name === b.asc), centreArt = art(A?.tree_image) || art(A?.class_tree_image);
  if (centreArt) {
    const k = 2 * CENTRE_R / Math.max(centreArt.width, centreArt.height);
    ctx.save(); ctx.clip(); ctx.globalAlpha = .55;
    ctx.drawImage(centreArt, -centreArt.width * k / 2, -centreArt.height * k / 2, centreArt.width * k, centreArt.height * k);
    ctx.restore();
  }
  ctx.beginPath(); ctx.arc(0, 0, CENTRE_R, 0, 7);
  ctx.strokeStyle = '#7a6440'; ctx.lineWidth = 18; ctx.stroke();
  ctx.strokeStyle = '#3a3022'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(0, 0, CENTRE_R - 40, 0, 7); ctx.stroke();

  // links: off, preview, allocated (glowing)
  const off = new Path2D(), path = new Path2D(), lit = new Path2D();
  for (const id of vis) for (const l of N[id].links) {
    const m = String(l);
    if (!visSet.has(m) || +m < +id || !N[id].ascendancy !== !N[m].ascendancy) continue;
    const A = on.has(id), Bo = on.has(m);
    linkPath(A && Bo ? lit : (A || pre.has(id)) && (Bo || pre.has(m)) ? path : off, id, m);
  }
  const px = v => v / s;   // screen pixels -> world units
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#3d3427'; ctx.lineWidth = Math.max(px(1.2), 9); ctx.stroke(off);
  ctx.strokeStyle = '#a8905e'; ctx.lineWidth = Math.max(px(2), 12); ctx.stroke(path);
  ctx.shadowColor = '#f0b040'; ctx.shadowBlur = 10 * D;
  ctx.strokeStyle = '#e8bf62'; ctx.lineWidth = Math.max(px(2.5), 16); ctx.stroke(lit);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#fff0c0'; ctx.lineWidth = Math.max(px(.8), 5); ctx.stroke(lit);

  // nodes (screen space so they stay crisp)
  ctx.setTransform(D, 0, 0, D, 0, 0);
  const myRoot = classRoot(b.asc);
  for (const id of vis) {
    const n = N[id], [wx, wy] = WP[id], x = sx(wx), y = sy(wy);
    const r = R[isRoot(id) ? 'root' : n.type] * s * (n.ascendancy ? FIT[n.ascendancy].k : 1);
    if (x < -r * 2 || y < -r * 2 || x > W + r * 2 || y > H + r * 2) continue;
    drawNode(id, x, y, r, on.has(id) ? 'on' : pre.has(id) || (id === myRoot && !b.nodes.length) ? 'path' : 'off');
  }
  // labels
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (const id of vis) {
    const n = N[id];
    if (isRoot(id)) continue;
    if (!(n.type === 'keystone' && s > .045 || n.type === 'notable' && s > .11)) continue;
    const [wx, wy] = WP[id], x = sx(wx), y = sy(wy);
    if (x < -100 || y < -40 || x > W + 100 || y > H + 40) continue;
    const r = R[isRoot(id) ? 'root' : n.type] * s * (n.ascendancy ? FIT[n.ascendancy].k : 1);
    ctx.font = `${n.type === 'keystone' ? 13 : 11}px Georgia, serif`;
    ctx.fillStyle = on.has(id) ? '#f2d58a' : '#a8987a';
    ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
    ctx.strokeText(label(n), x, y + r * 1.25 + 2); ctx.fillText(label(n), x, y + r * 1.25 + 2);
  }
  if (s > .02) {
    ctx.font = '16px Georgia, serif'; ctx.fillStyle = '#c8a860';
    ctx.fillText(b.asc, sx(0), sy(-CENTRE_R * .8));
  }
}
let raf = 0;
const redraw = () => raf ||= requestAnimationFrame(() => { raf = 0; drawTree(); });
function nodeAt(mx, my) {
  let best = null, bd = Infinity;
  for (const id of visible()) {
    const n = N[id], [wx, wy] = WP[id];
    const x = (wx - view.x) * view.s + cv.clientWidth / 2, y = (wy - view.y) * view.s + cv.clientHeight / 2;
    const r = Math.max(8, R[isRoot(id) ? 'root' : n.type] * view.s * (n.ascendancy ? FIT[n.ascendancy].k : 1)), d = (x - mx) ** 2 + (y - my) ** 2;
    if (d < r * r && d < bd) { best = id; bd = d; }
  }
  return best;
}
const esc = t => String(t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const KIND = { keystone: 'Piedra angular', notable: 'Notable', jewel: 'Engarce de joya', attribute: 'Atributo', small: 'Pasiva' };
function showTip(id, mx, my) {
  const tip = $('tip'), n = N[id];
  tip.hidden = !id;
  if (!id) return;
  const lines = statLines(nodeStats(id)).concat(n.grants_skill ? [`Otorga: ${n.grants_skill}`] : []);
  const cost = preview(id).filter(x => !isRoot(x)).length, start = n.ascendancy_start;
  tip.className = 'tip-' + (isRoot(id) ? 'root' : n.type);
  tip.innerHTML = `<div class="th">${esc(label(n))}<small>${isRoot(id) ? 'Inicio de clase' : KIND[n.type]}${n.ascendancy ? ' · ' + esc(n.ascendancy) : ''}</small></div>`
    + (lines.length ? `<div class="tb">${lines.map(esc).join('<br>')}</div>` : '')
    + `<div class="tf">${n.type === 'attribute' ? 'Clic derecho: Fue / Des / Int<br>' : ''}${start ? 'Inicio de la ascendencia' : cost ? `Clic: asignar (${cost} punto${cost > 1 ? 's' : ''})` : preview(id).length ? 'Clic: empezar aquí' : 'Clic: quitar'}</div>`;
  const box = cv.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = Math.min(mx + 16, box.width - w - 4) + 'px';
  tip.style.top = (my + 16 + h > box.height ? my - h - 10 : my + 16) + 'px';
}
let drag = null;
cv.onmousedown = e => drag = { x: e.offsetX, y: e.offsetY, moved: false };
cv.onmousemove = e => {
  if (drag) {
    const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    if (drag.moved) { view.x -= dx / view.s; view.y -= dy / view.s; drag.x = e.offsetX; drag.y = e.offsetY; $('tip').hidden = true; redraw(); return; }
  }
  const h = nodeAt(e.offsetX, e.offsetY);
  if (h !== hover) { hover = h; redraw(); }
  cv.style.cursor = h ? 'pointer' : 'grab';
  showTip(h, e.offsetX, e.offsetY);
};
cv.onmouseup = e => { if (drag && !drag.moved) { const h = nodeAt(e.offsetX, e.offsetY); if (h) { e.button === 2 ? cycleAttr(h) : clickNode(h); showTip(h, e.offsetX, e.offsetY); } } drag = null; };
cv.oncontextmenu = e => e.preventDefault();
cv.onmouseleave = () => { drag = null; hover = null; $('tip').hidden = true; redraw(); };
cv.onwheel = e => {
  e.preventDefault();
  const k = e.deltaY < 0 ? 1.15 : 1 / 1.15, mx = e.offsetX - cv.clientWidth / 2, my = e.offsetY - cv.clientHeight / 2;
  const ns = Math.min(1.5, Math.max(.01, view.s * k)), kk = ns / view.s;
  view.x += mx / view.s * (1 - 1 / kk); view.y += my / view.s * (1 - 1 / kk); view.s = ns; $('tip').hidden = true; redraw();
};
addEventListener('resize', redraw);

// ---------- tabs
document.querySelectorAll('nav button').forEach(btn => btn.onclick = () => {
  document.querySelectorAll('nav button').forEach(x => x.classList.toggle('on', x === btn));
  document.querySelectorAll('.view').forEach(v => v.hidden = v.id !== btn.dataset.v);
  drawTree();
});

initScene($('scene'), B, geo, playerSpeed);
const renderItems = initItems($('items'), B, () => { save(); renderSide(); },
  () => B().nodes.filter(id => N[id].type === 'jewel').map((id, i) => ({ id, label: `engarce ${i + 1}` })));
const renderSkills = initSkills($('skills'), B, () => { save(); renderSide(); }, treeSum);
select(builds[localStorage.getItem(KEY + ':last')] ? localStorage.getItem(KEY + ':last') : Object.keys(builds)[0]);
