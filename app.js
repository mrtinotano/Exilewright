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
  $('ascNodes').innerHTML = Object.entries(N).filter(([, n]) => n.ascendancy === b.asc && !n.ascendancy_start)
    .map(([id, n]) => `<li title="${statText(n)}"><input type="checkbox" style="width:auto" data-asc="${id}" ${b.ascNodes.includes(id) ? 'checked' : ''}><span>${label(n)}</span></li>`).join('');
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
$('ascNodes').onchange = edit((e, b) => {
  const id = e.target.dataset.asc;
  b.ascNodes = e.target.checked ? [...b.ascNodes, id] : b.ascNodes.filter(x => x !== id);
});
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

// ---------- passive tree (canvas 2D)
const cv = $('treeCanvas'), ctx = cv.getContext('2d');
const main = Object.entries(N).filter(([, n]) => !n.ascendancy);
const R = { keystone: 60, notable: 40, jewel: 40, attribute: 22, small: 22 };
let view = { x: 0, y: 0, s: 0 }, hover = null;

const walkable = (id, root) => N[id] && !N[id].ascendancy && (!ROOTS.has(id) || id === root);
function pathTo(target) {          // BFS from the allocated set to target, returns the new node ids
  const b = B(), root = b.nodes[0], prev = new Map(b.nodes.map(n => [n, null])), q = [...b.nodes];
  while (q.length) {
    const u = q.shift();
    if (u === target) break;
    for (const w of N[u].links.map(String)) if (!prev.has(w) && walkable(w, root)) { prev.set(w, u); q.push(w); }
  }
  if (!prev.has(target)) return [];
  const out = []; for (let u = target; !b.nodes.includes(u); u = prev.get(u)) out.push(u);
  return out;
}
function prune(nodes) {            // keep only what is still connected to the class root
  const keep = new Set([nodes[0]]), q = [nodes[0]], set = new Set(nodes);
  while (q.length) for (const w of N[q.shift()].links.map(String)) if (set.has(w) && !keep.has(w)) { keep.add(w); q.push(w); }
  return nodes.filter(n => keep.has(n));
}
function clickNode(id) {
  const b = B();
  if (!b.nodes.length) { if (ROOTS.has(id)) b.nodes = [id]; }
  else if (id === b.nodes[0]) b.nodes = [];
  else if (b.nodes.includes(id)) b.nodes = prune(b.nodes.filter(n => n !== id));
  else b.nodes.push(...pathTo(id));
  save(); renderSide(); drawTree();
}

const toScreen = n => [(n.x - view.x) * view.s + cv.width / 2, (n.y - view.y) * view.s + cv.height / 2];
function drawTree() {
  if (!cv.offsetParent) return;
  cv.width = cv.clientWidth; cv.height = cv.clientHeight;
  view.s ||= Math.min(cv.width, cv.height) / 26000;   // fit whole tree on first draw
  const on = new Set(B().nodes);
  ctx.lineWidth = 1;
  for (const [id, n] of main) {
    const [x, y] = toScreen(n);
    for (const l of n.links) {
      const m = N[l]; if (!m || m.ascendancy || l < +id) continue;
      const [x2, y2] = toScreen(m);
      ctx.strokeStyle = on.has(id) && on.has(String(l)) ? '#c8a050' : '#333';
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
    }
  }
  for (const [id, n] of main) {
    const [x, y] = toScreen(n), r = Math.max(1.5, R[n.type] * view.s);
    ctx.fillStyle = on.has(id) ? (ATTR[(B().attrs || {})[id]]?.[1] || '#c8a050') : ROOTS.has(id) ? '#5a8' : n.type === 'keystone' ? '#a55' : n.type === 'notable' ? '#68a' : '#555';
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    if (id === hover) { ctx.strokeStyle = '#fff'; ctx.stroke(); }
    if (view.s > 0.12 && n.type !== 'small' && n.type !== 'attribute') { ctx.fillStyle = '#aaa'; ctx.fillText(label(n), x + r + 2, y + 3); }
  }
}
function nodeAt(mx, my) {
  let best = null, bd = 12 ** 2;
  for (const [id, n] of main) {
    const [x, y] = toScreen(n), d = (x - mx) ** 2 + (y - my) ** 2;
    if (d < Math.max(bd, (R[n.type] * view.s) ** 2) && d < (best ? bd : Infinity)) { best = id; bd = d; }
  }
  return best;
}
let drag = null;
cv.onmousedown = e => drag = { x: e.offsetX, y: e.offsetY, moved: false };
cv.onmousemove = e => {
  if (drag) {
    const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    view.x -= dx / view.s; view.y -= dy / view.s; drag.x = e.offsetX; drag.y = e.offsetY; drawTree(); return;
  }
  const h = nodeAt(e.offsetX, e.offsetY), tip = $('tip');
  if (h !== hover) { hover = h; drawTree(); }
  tip.hidden = !h;
  if (h) { tip.textContent = `${label(N[h])} (${N[h].type})\n${statText({ ...N[h], stats: nodeStats(h) })}` + (N[h].type === 'attribute' ? '\nClic derecho: Fue / Des / Int' : ''); tip.style.left = e.offsetX + 14 + 'px'; tip.style.top = e.offsetY + 14 + 'px'; }
};
cv.onmouseup = e => { if (drag && !drag.moved) { const h = nodeAt(e.offsetX, e.offsetY); if (h) e.button === 2 ? cycleAttr(h) : clickNode(h); } drag = null; };
cv.oncontextmenu = e => e.preventDefault();
cv.onmouseleave = () => drag = null;
cv.onwheel = e => {
  e.preventDefault();
  const k = e.deltaY < 0 ? 1.2 : 1 / 1.2, mx = e.offsetX - cv.width / 2, my = e.offsetY - cv.height / 2;
  view.x += mx / view.s * (1 - 1 / k); view.y += my / view.s * (1 - 1 / k); view.s *= k; drawTree();
};
addEventListener('resize', drawTree);

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
