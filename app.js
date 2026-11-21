import { t, tn, fmt, lang } from './i18n.js';
import { initScene } from './scene.js';
import { profile, chips } from './skillfx.js';
import { statLines } from './stats.js';
import { renderChar, skillTip } from './charpanel.js';
import { skill, withSupports, character, recovery, snapshot, QUESTS, questPick, questStats, requiredLevel, skillStats, auraStats, linkMetas, usedBy, byHand, reservation, rageOf, ailmentDefence } from './calc.js';
import { ENEMIES, enemy, search as findEnemies, enemyStats, attacksOf, attackOf, versusPlayer, versusEnemy, RARITIES, rarityOf } from './enemies.js';
import { initItems, gearStats, radiusOf, flaskOf, charmOf, swapSet, pieceDef } from './items.js';
import { initSkills } from './skills.js';
import { initOpt } from './optview.js';
import { initLoot } from './loot.js';
import { initSettings, watchUpdates } from './settings.js';
import { initFilter } from './filter.js';
import { SEARCH_SLOTS, siteQuery } from './trade.js';
import { diff, impactHtml } from './impact.js';
import { SK } from './skilldata.js';
import { encode, decode, toXML, fromXML, SITES, upload, download, toBuildFile, buildFileName } from './share.js';

const $ = id => document.getElementById(id);
const load = f => fetch('poe2_data/available/' + f).then(r => r.json());
const [tree, gems, ascs] = await Promise.all([load('passive_tree.json'), load('gems.json'), load('ascendancies.json')]);
const N = tree.nodes;
const ROOTS = new Set(tree.class_roots.map(String));
const label = tn;

// ---------- builds (localStorage; export/import as JSON files)
const KEY = 'poe2builds';
let builds = JSON.parse(localStorage.getItem(KEY) || '{}');
let cur;
// asc: the ascendancy, or the base class's name while none is chosen
const blank = () => ({ name: t('New build'), level: 1, asc: ascs[0].class, gems: [], nodes: [], ascNodes: [], notes: '' });
let rev = 0;   // goes up with every change to the builds: what is worked out from the build is kept until then
// undo / redo, per build: every save() keeps the build as it was (what is typed in a text box less than a second apart
// is one step)
const hist = {}, HIST_MAX = 100;
let shown = '', stepAt = 0;
const store = () => { rev++; localStorage.setItem(KEY, JSON.stringify(builds)); };
const save = () => {
  if (B()) linkMetas(B());
  const now = JSON.stringify(B() ?? null), h = hist[cur] ||= { undo: [], redo: [] };
  if (now !== shown && shown) {
    if (Date.now() - stepAt > 1000 || !h.undo.length || !document.activeElement?.matches('textarea, input:not([type]), input[type=text], input[type=number]')) { h.undo.push(shown); if (h.undo.length > HIST_MAX) h.undo.shift(); }
    h.redo = []; stepAt = Date.now();
  }
  shown = now; store(); undoBtns();
};
function step(back) {
  const h = hist[cur], from = back ? h?.undo : h?.redo;
  if (!from?.length) return;
  (back ? h.redo : h.undo).push(shown);
  shown = from.pop(); stepAt = 0;
  builds[cur] = JSON.parse(shown); store();
  select(cur); document.querySelector('nav button.on')?.click();
}
function undoBtns() { const h = hist[cur]; $('undo').disabled = !h?.undo.length; $('redo').disabled = !h?.redo.length; }
$('undo').onclick = () => step(true);
$('redo').onclick = () => step(false);
addEventListener('keydown', e => {   // Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z); a text box keeps its own
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.target.closest?.('input, textarea, [contenteditable]')) return;
  const k = e.key.toLowerCase();
  if (k === 'z' || k === 'y') { e.preventDefault(); step(k === 'z' && !e.shiftKey); }
});
function select(id) {
  cur = id; rev++; localStorage.setItem(KEY + ':last', id); if (B()) linkMetas(B()); shown = JSON.stringify(B() ?? null); undoBtns();
  renderSide(); drawTree(); renderItems?.();
  checkStart();
}
const B = () => builds[cur];
if (!Object.keys(builds).length) builds[Date.now()] = blank();

// ---------- top bar (build, name, level, class, ascendancy) and side panel (character sheet)
const CLASSES = [...new Set(ascs.map(a => a.class))];
let picking = null;  // 'cls' | 'asc': which list is open in the character panel
// the character panel's face: an ascendancy's, cut from its illustration (images.py FACES; the game draws its own from
// the 3D model); the base class's from the UI atlas
const portraitOf = asc => asc ? 'portraits/' + asc.toLowerCase().replaceAll(' ', '_') + '.webp' : '';   // poe2_data/_tool/portraits.py
const clsLabel = x => tn(ascs.find(a => a.class === x)?.class_names) || x;   // a base class as the game names it
const clsOf = asc => ascs.find(a => a.name === asc)?.class || (CLASSES.includes(asc) ? asc : undefined);

function renderSide() {
  const b = B();
  b.gems.forEach(g => { g.level ??= 20; });  // builds saved before gem levels existed
  $('buildList').innerHTML = Object.entries(builds).map(([id, x]) => `<option value="${id}" ${id === cur ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  $('notes').value = b.notes;
  $('notesBtn').textContent = t('Notes') + (b.notes ? ' •' : '');
  renderStats();
  renderSceneSkills();
  renderSkills?.();
  if (!$('opt').hidden) renderOpt();   // its numbers are the build's
  if (!$('settings').hidden) renderLoot();   // the equipment comparison's skills are the build's
}
const statText = n => statLines(n.stats).join('\n') + (n.grants_skill ? '\n' + t('Grants: {0}', n.grants_skill) : '');

// Attribute nodes: right click cycles Str/Dex/Int
const ATTR = { str: ['strength', '#c44'], dex: ['dexterity', '#4a4'], int: ['intelligence', '#48c'] };
const NEXT = { undefined: 'str', str: 'dex', dex: 'int', int: 'str' };
function nodeStats(id, b = B()) {
  const n = N[id], a = (b.attrs || {})[id];
  return n.type === 'attribute' && a ? tree.attribute_options[ATTR[a][0]] : n.stats;  // game's hidden generic_attribute_* passives
}
function cycleAttr(id) {
  if (N[id].type !== 'attribute') return;
  const b = B(); b.attrs ||= {};
  b.attrs[id] = NEXT[b.attrs[id]];
  save(); renderSide(); drawTree();
}
const BODY_GRANTS = [['body_armour_grants_spirit_+%', 'spirit_+%'], ['body_armour_grants_x_life_regeneration_rate_per_minute_%', 'life_regeneration_rate_per_minute_%'],
  ['body_armour_grants_x_physical_damage_taken_%_as_fire', 'physical_damage_from_hits_%_taken_as_fire'], ['body_armour_grants_x_strength_+%', 'strength_+%'],
  ['body_armour_grants_x_maximum_life_+%', 'maximum_life_+%'], ['body_armour_grants_x_base_fire_damage_resistance_%', 'base_fire_damage_resistance_%'],
  ['body_armour_grants_thorns_damage_+%', 'thorns_damage_+%'], ['body_armour_grants_glory_generation_+%', 'glory_generation_+%']];
function sumOf(b) {   // every stat of a build's passives (with the weapon set in use), gear, campaign rewards and buffs of its own
  const sum = questStats(b);
  for (const [k, v] of Object.entries(skillStats(b))) sum[k] = (sum[k] || 0) + v;
  // Titan's Hulking Form: increased effect of the small passives (attribute ones included)
  const all = [...b.nodes, ...b.ascNodes, ...setOf(b, b.wset || 1)], small = 1 + all.reduce((t, id) => t + (N[id]?.stats?.['small_passives_effect_+%'] || 0), 0) / 100;
  for (const id of all) { const k = ['small', 'attribute'].includes(N[id]?.type) && !N[id].ascendancy ? small : 1; for (const [s, v] of Object.entries(nodeStats(id, b))) sum[s] = (sum[s] || 0) + v * k; }
  for (const [k, v] of Object.entries(gearStats(Object.fromEntries(Object.entries(b.items || {}).filter(([slot]) => !slot.startsWith('jewel:') || b.nodes.some(n => 'jewel:' + n === slot)))))) sum[k] = (sum[k] || 0) + v;
  // a radius jewel in an allocated socket: its modifiers once for each small / notable passive allocated within its
  // radius of the socket (tree units). note: attribute passives counted as small ones (they are no notables)
  for (const [slot, it] of Object.entries(b.items || {})) {
    const J = slot.startsWith('jewel:') && b.nodes.some(n => 'jewel:' + n === slot) && N[slot.slice(6)], R = J && radiusOf(it);
    if (!R) continue;
    const n = { small: 0, notable: 0 };
    for (const id of new Set([...b.nodes, ...setOf(b, b.wset || 1)])) { const x = N[id];
      const k = x && (x.type === 'notable' ? 'notable' : x.type === 'small' || x.type === 'attribute' ? 'small' : null);
      if (k && !x.ascendancy && Math.hypot(x.x - J.x, x.y - J.y) <= R.r) n[k]++; }
    for (const k of ['small', 'notable']) for (const [s, v] of Object.entries(R[k])) sum[s] = (sum[s] || 0) + v * n[k];
  }
  // Smith of Kitava: what the passives say the body armour grants, while one is worn; their hidden armour
  if (b.items?.body) for (const [k, to] of BODY_GRANTS) if (sum[k]) sum[to] = (sum[to] || 0) + sum[k];
  sum.base_physical_damage_reduction_rating = (sum.base_physical_damage_reduction_rating || 0) + (sum.base_physical_damage_reduction_rating_no_display || 0)
    + pieceDef(b.items, 'body', 'armour') * (sum['ascendancy_titan_damage_reduction_rating_from_body_armour_+%_final'] || 0) / 100;   // Titan's Stone Skin: more armour from the body armour
  // Amazon's Stalking Panther: evasion of the helmet, gloves and boots doubled, the body armour's halved
  if (sum.double_evasion_rating_from_gloves_helmets_boots) sum.base_evasion_rating = (sum.base_evasion_rating || 0) + ['helmet', 'gloves', 'boots'].reduce((t, s) => t + pieceDef(b.items, s, 'evasion'), 0);
  if (sum.halve_evasion_rating_from_body) sum.base_evasion_rating = (sum.base_evasion_rating || 0) - pieceDef(b.items, 'body', 'evasion') / 2;
  for (const [k, v] of Object.entries(auraStats(b, sum))) sum[k] = (sum[k] || 0) + v;   // after the rest: their level and magnitude come from it
  return sum;
}
const treeSum = () => sumOf(B());
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
  const d = SK.skills[g.name] || {}, tags = gems.find(x => x.name === g.name)?.tags || d.tags || [], T = { ...treeSum() };
  for (const [k, n] of Object.entries(g.add || {})) T[k] = (T[k] || 0) + n;   // a buff the scene has on (g.add)
  const { sum, finals } = withSupports(g, T);  // supports' area / speed count
  // the supports' more / less area (Concentrated Area 50% less, Echoing Cry, Spell Cascade...; not Branching Fissures', only its branches')
  const moreArea = Object.entries(finals).reduce((m, [k, v]) => (k.endsWith('area_of_effect_+%_final') || k === 'support_astral_projection_aoe_+%_final') && !k.startsWith('branching_fissure') ? m * (1 + v / 100) : m, 1);
  const R = Object.values(d.radius || {}), base = d.radius?.[g.level] ?? (R.length === 1 ? R[0] : undefined);   // a single-level skill (Mana Flare) at any gem level
  const moreSpeed = Object.entries(finals).reduce((m, [k, v]) => k.endsWith('projectile_speed_+%_final') && !k.includes('randomise') ? m * (1 + v / 100) : m, 1);   // Projectile Acceleration / Deceleration
  const rad = b => b ? Math.floor(b * Math.sqrt(Math.max(0, (1 + inc(sum, 'area_of_effect_+%', tags) / 100) * moreArea))) / 10 : 0;
  const speed = d.projectile_speed && d.projectile_speed * (1 + inc(sum, 'projectile_speed_+%', tags) / 100) * moreSpeed / 10;
  return {
    radiusFromData: base != null,
    // area modifiers scale area, so radius scales with the square root, in whole game units (the game's window:
    // Cluster Grenade 25 x sqrt(1.24) = 27.8 -> 2.7 m)
    radius: base != null ? rad(base) : 0,
    // its secondary radius (a storm's area, Firestorm's; or its strikes', Thunderstorm's), with the same modifiers
    radius2: rad(d.levels?.[g.level]?.active_skill_base_secondary_area_of_effect_radius ?? d.constant?.active_skill_base_secondary_area_of_effect_radius),
    speed,
    // range: skill override, else speed × duration, else 150 units (GGG: default max projectile distance)
    range: d.projectile_range ? d.projectile_range / 10 : d.duration_ms && speed ? speed * d.duration_ms / 1000 : 15,
    collision: (d.projectile_collision || 0) / 10,
    duration: (d.duration_ms || 0) / 1000,
  };
}
const playerSpeed = (more = 0) => SK.player_base_speed * (1 + ((treeSum()['base_movement_velocity_+%'] || 0) + more) / 100) / 10;   // more: a Banner's
function renderStats() {
  const b = B();
  const pending = b.nodes.filter(id => N[id].type === 'attribute' && !(b.attrs || {})[id]).length; // game text always says "+5", so count them
  const points = Math.max(0, b.nodes.length - 1);  // the class start node is free
  // Manual: the level typed in the panel or imported with the build; Auto: the one the points need (Path of Building 2)
  const need = requiredLevel(points);
  b.level = b.lvl || need;
  const sum = treeSum();   // after the level: the campaign rewards counted by default go by it
  renderPoints(b); if ($("treeFind").value) search();   // ascendancy may have changed what is visible
  renderChar($('charPanel'), b, sum, { asc: b.asc, cls: clsOf(b.asc), points, need, pending, picking,
    classes: CLASSES, ascOptions: [clsOf(b.asc), ...ascs.filter(a => a.class === clsOf(b.asc)).map(a => a.name)], portrait: portraitOf(b.asc),
    ascLabel: x => CLASSES.includes(x) ? t('No ascendancy') : tn(ascs.find(a => a.name === x)) || x, clsLabel });
}
// lower half of the side panel in the 3D scene: the build's skills with how the scene draws them
const gemImg = p => p ? 'poe2_data/available/img/' + p.toLowerCase().replace(/\.dds$/, '.webp') : '';
// a support's triggered skill (SK.skills[id].triggered_by) has no gem: its own name and types, the support's icon
const gemInfo = g => { const d = SK.skills[g.name], gem = gems.find(x => x.name === g.name) || d?.triggered_by && { ...d, icon: gems.find(x => x.name === d.triggered_by)?.icon }; return { gem, data: d || {}, label: tn(gem) || g.name, icon: gemImg(gem?.icon), buff: gemImg(gem?.buff_icon) }; };
// enemy of the 3D scene (not part of a build): the monster the clicks place, its level (0 = the level of the build) and its attack
const SCENE_KEY = 'poe2scene';
const sceneCfg = (({ enemy = null, level = 0, attack = null, rarity = null, still = false, fight = false }) => ({ enemy, level, attack, rarity, still, fight }))(JSON.parse(localStorage.getItem(SCENE_KEY) || '{}'));
// damage of each skill of the build (calc.js), shared by the cards, the enemy panel and the scene until the build changes
const dmgCache = new Map();
const skillDmg = g => { let s = dmgCache.get(g); if (!s) dmgCache.set(g, s = skill(g, B(), treeSum())); return s; };
let scene3d;
function renderSceneSkills() {
  const b = B(), sum = treeSum(), on = scene3d?.selected();
  dmgCache.clear();
  const list = b.gems.map(g => { const inf = gemInfo(g); return { g, inf, label: inf.label, P: profile(inf.gem, inf.data) }; });
  const key = i => scene3d?.keyOf(i) || '';   // the key of the simulator's bar it is on
  // only the skills with damage per second; one a meta gem uses goes inside that meta gem's card
  const dps = g => skillDmg(g).dps != null, inside = g => list.map((x, j) => usedBy(b, j) === g && dps(x.g) ? card(x, j) : '').join('');
  const card = ({ g, inf, P }, i) => {
    const G = geo(g), s = skillDmg(g), sub = inside(g);
    const facts = [
      G.radiusFromData ? `<span title="active_skill_base_area_of_effect_radius × ${t('tree area')}">${t('radius')} <b>${G.radius.toFixed(2)} m</b></span>` : '',
      G.speed ? `<span>${t('speed')} <b>${G.speed.toFixed(1)} m/s</b></span><span>${t('range')} <b>${G.range.toFixed(1)} m</b></span>` : '',
      G.duration ? `<span>${t('duration')} <b>${fmt(G.duration, G.duration % 1 ? 1 : 0)} s</b></span>` : '',
    ].join('');
    return `<div class="sk-card el-${P.el || 'none'}${i === on ? ' on' : ''}" data-card="${i}">
      <div class="sk-head"><span class="sk-ico">${inf.icon ? `<img src="${inf.icon}" alt="" onerror="this.remove()">` : ''}${key(i) ? `<i>${key(i)}</i>` : ''}</span>
        <span class="sk-name"><span data-tip="${i}">${esc(inf.label)}</span><small>${t('Level')} ${g.level}</small></span>
        ${s.dps != null ? `<b class="sdps" data-dps="${i}">${fmt(s.dps)} <small>DPS</small></b>` : ''}</div>
      <div class="chips">${chips(P).map(([text, cls, arg]) => `<span class="chip ${cls}">${esc(t(text, arg ? t(arg) : undefined))}</span>`).join('')}</div>
      ${facts ? `<div class="sk-facts">${facts}</div>` : ''}
      ${sub ? `<div class="sk-sub">${sub}</div>` : ''}
    </div>`;
  };
  const cards = list.map((x, i) => usedBy(b, i) ? '' : (dps(x.g) || inside(x.g)) && card(x, i) || '').join('');
  $('sceneList').innerHTML = `<h3>${t('Skills')}</h3><div class="sk-scroll">
    ${cards || `<p class="note">${t(list.length ? 'None of your skills deals damage.' : 'Add skills in the Skills tab.')}</p>`}</div>`;
  syncEnemy(); renderEnemy();
}
// skill info window: anything with data-tip="<gem index>"
function gemTip(t) {
  const tip = $('gtip'), g = t && B().gems[t.dataset.tip];
  if (!g) { tip.hidden = true; return; }
  tip.innerHTML = skillTip(gems.find(x => x.name === g.name) || {}, g, B(), treeSum(), geo);
  tip.hidden = false;
  const r = t.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = Math.max(4, r.right + 10 + w > innerWidth ? r.left - w - 10 : r.right + 10) + 'px';
  tip.style.top = Math.max(4, Math.min(innerHeight - h - 4, r.top)) + 'px';
}
document.addEventListener('mouseover', e => gemTip(e.target.closest?.('[data-tip]')));
function addGem(name, level = 20) {   // level: the one an item that grants it says
  const g = gems.find(g => g.name === name || tn(g) === name || g.name_es === name);
  if (!g) return false;
  B().gems.push({ name: g.name, level });
  save(); renderSide(); return true;
}

const edit = fn => e => { fn(e, B()); save(); renderSide(); drawTree(); if (!$('items').hidden) renderItems(); };  // the Equipment view shows what each item changes
// in-app confirmation (native confirm() is blocked in some embedded browsers): resolves true on the OK button
// in-app choice dialog (native confirm() is blocked in some embedded browsers):
// resolves with the index of the chosen option, or -1 on Cancel / Escape / click outside
function ask(text, ...opts) {
  return new Promise(done => {
    const d = document.createElement('div');
    d.className = 'ask';
    d.innerHTML = `<div><p>${esc(text)}</p>${opts.map((o, i) => `<button data-i="${i}">${esc(o)}</button>`).join(' ')} <button data-i="-1">${t('Cancel')}</button></div>`;
    const close = v => { d.remove(); removeEventListener('keydown', key); done(v); };
    const key = e => { if (e.key === 'Escape') close(-1); };
    d.onclick = e => { if (e.target === d) close(-1); else if (e.target.dataset.i) close(+e.target.dataset.i); };
    addEventListener('keydown', key);
    document.body.append(d);
    d.querySelector('button').focus();
  });
}
$('buildList').onchange = e => select(e.target.value);
$('newBuild').onclick = () => { const id = String(Date.now()); builds[id] = blank(); save(); select(id); };
$('delBuild').onclick = async () => {
  if (await ask(t('Delete the build «{0}»? This cannot be undone.', B().name), t('Delete')) !== 0) return;
  delete builds[cur]; if (!Object.keys(builds).length) builds[Date.now()] = blank();
  save(); select(Object.keys(builds)[0]);
};
// character panel: name, base class and ascendancy are edited in place
$('charPanel').onchange = e => {
  const d = e.target.dataset;
  if (d.act === 'name') edit((e, b) => b.name = e.target.value.trim() || t('New build'))(e);
  if (d.act === 'level') edit((e, b) => { const v = Math.round(+e.target.value); if (v >= 1) b.lvl = Math.min(100, v); else delete b.lvl; })(e);
  if (d.quest) edit((e, b) => (b.quests ||= {})[d.quest] = e.target.type === 'checkbox' ? +e.target.checked : +e.target.value)(e);
};
$('charPanel').onclick = async e => {
  if (e.target.dataset.act === 'lvlmode') return edit((e, b) => { if (b.lvl) delete b.lvl; else b.lvl = b.level; })(e);   // Auto <-> Manual
  const el = e.target.closest('[data-pick], [data-cls], [data-asc]'); if (!el) return;
  if (el.dataset.pick) { picking = picking === el.dataset.pick ? null : el.dataset.pick; renderStats(); return; }
  picking = null;
  const b = B();
  if (el.dataset.asc) {
    if (el.dataset.asc === b.asc) renderStats(); else edit((_, b) => { b.asc = el.dataset.asc; b.ascNodes = []; })(e);
    return;
  }
  const cls = el.dataset.cls;
  if (cls === clsOf(b.asc)) { renderStats(); return; }
  const asc = cls, root = classRoot(cls);   // a new class starts without an ascendancy
  renderStats();  // close the list while asking
  let nodes = [];
  if (b.nodes.length > 1 && root === b.nodes[0]) nodes = b.nodes;   // same start node: the tree stays valid
  else if (b.nodes.length > 1) {
    const name = clsLabel(cls);
    nodes = await moveTree(b.nodes, root, name, t('{0} starts somewhere else on the tree.', name));
    if (!nodes) return;
  }
  edit((_, b) => { b.asc = asc; b.ascNodes = []; setNodes(b, nodes); })(e);
};
const setNodes = (b, nodes) => {
  b.nodes = nodes; fixSets(b);
  const kept = new Set([...nodes, ...setOf(b, 1), ...setOf(b, 2)]);
  b.attrs = Object.fromEntries(Object.entries(b.attrs || {}).filter(([id]) => kept.has(id)));
};
// the tree must start at the class start: offer to clear it or link it there (null = cancelled)
async function moveTree(nodes, root, cls, why) {
  const linked = reroot(nodes, root), had = nodes.length - 1;
  const pick = await ask(why + ' ' + t('You have {0} points allocated.', had),
    t('Clear the tree'),
    ...linked.length ? [t('Connect it to the {0} start', cls)] : []);
  return pick < 0 ? null : pick === 1 ? linked : [];
}
// builds made before the start was enforced may begin at another class start
async function checkStart() {
  const b = B(), root = classRoot(b.asc), id = cur;
  if (!b.nodes.length || !root || b.nodes[0] === root) return;
  const cls = clsOf(b.asc);
  const nodes = await moveTree(b.nodes, root, cls, t('This build\'s tree begins at another class\'s start, and {0} can only start at its own.', cls));
  if (nodes && id === cur) { setNodes(b, nodes); save(); renderSide(); drawTree(); }
}
$('notes').onchange = edit((e, b) => b.notes = e.target.value);
$('notesBtn').onclick = () => { $('notesBox').hidden = !$('notesBox').hidden; if (!$('notesBox').hidden) $('notes').focus(); };
$('sceneSkills').onchange = e => {
  const d = e.target.dataset;
  if (d.en === 'still' || d.en === 'fight') { sceneCfg[d.en] = e.target.checked; saveScene(); }
  else if (d.en === 'level' || d.en === 'attack' || d.en === 'rarity') {  // the enemy of the scene
    if (d.en === 'attack' || d.en === 'rarity') sceneCfg[d.en] = e.target.value; else { const v = Math.round(+e.target.value); sceneCfg.level = v >= 1 ? Math.min(100, v) : 0; }
    saveScene(); syncEnemy(); renderEnemy();
  }
};
$('sceneSkills').onclick = e => {
  const en = e.target.dataset.en;
  if (en === 'place') return scene3d.placing(!scene3d.placing());
  if (en === 'clear' || en === 'reset') { e.target.blur(); return scene3d[en](); }   // blur: Space rolls in the scene, it must not press the button again
  if (en === 'mylevel') { sceneCfg.level = 0; saveScene(); syncEnemy(); return renderEnemy(); }
  const c = !e.target.closest('input, select, label, summary') && e.target.closest('[data-card]');
  if (c) { scene3d.select(+c.dataset.card); markCard(+c.dataset.card); }
};
const markCard = i => { document.querySelectorAll('#sceneSkills .sk-card').forEach(c => c.classList.toggle('on', +c.dataset.card === i)); renderEnemy(); };
// ---------- share: Path of Building 2 code, build sites, JSON file
const shareCtx = () => ({ stats: b => character(b, treeSum()), N, gems, ascs, clsOf, ascStart, classRoot, roots: ROOTS, maxSockets: SK.max_support_sockets || 5, quests: QUESTS, questPick });
const addBuild = b => { const id = String(Date.now()); builds[id] = b; save(); select(id); };
// one panel, with what the header button asked for: taking a build in, or giving this one out
const openShare = async exporting => {
  const d = document.createElement('div');
  d.className = 'ask'; d.id = 'sharePanel';
  const code = exporting ? await encode(toXML(B(), shareCtx())) : '';
  d.innerHTML = `<div><button class="close" data-a="close">✕</button>${exporting ? `
    <h3>${t('Export')}</h3>
    <p class="note">${t('Path of Building 2 code: paste it in Path of Building (Import/Export Build) or on any of these sites.')}</p>
    <textarea rows="3" readonly data-code>${code}</textarea>
    <div class="row"><button data-a="copy">${t('Copy code')}</button>${SITES.map(s => `<button data-up="${s.id}">${t('Link on {0}', s.name)}</button>`).join('')}
      <button data-a="json">${t('JSON file')}</button></div>
    <div class="msg" data-out></div>
    <h3>${t('The game')}</h3>
    <p class="note">${t('Since 0.5 the in-game build planner loads .build files: save it in Documents/My Games/Path of Exile 2/BuildPlanner. It carries the tree, the ascendancy and the gems with their supports; gem levels and gear go in as notes.')}</p>
    <div class="row"><button data-a="game">${t('.build file for the game')}</button></div>` : `
    <h3>${t('Import')}</h3>
    <textarea rows="3" data-in placeholder="${t('Paste a Path of Building code or a link (pobb.in, poe.ninja, Maxroll, poe2db, pastebin, rentry)')}"></textarea>
    <div class="row"><button data-a="import">${t('Import as a new build')}</button><button data-a="file">${t('JSON file')}</button><select data-pob hidden></select></div>
    <div class="msg" data-inmsg></div>
    <p class="note">${t('To bring your gear here, hover an item in the game, press Ctrl+C and paste it in Equipment. Copy (⧉) on an item gives its text for Path of Building and trade sites.')}</p>`}</div>`;
  const out = d.querySelector('[data-out]'), inmsg = d.querySelector('[data-inmsg]');
  // the builds saved in Path of Building 2 on this computer (serve.py lists them): picking one imports it. That is how a
  // character of the account gets here, the game's site hands them to registered programs only
  const pob = d.querySelector('[data-pob]');
  if (pob) fetch('pob').then(r => r.ok ? r.json() : []).catch(() => []).then(names => {
    if (!names.length) return;
    pob.innerHTML = `<option value="">${t('From Path of Building 2 on this computer…')}</option>` + names.map(n => `<option value="${esc(n)}">${esc(n.replace(/\.xml$/i, ''))}</option>`).join('');
    pob.hidden = false;
  });
  // a build from Path of Building's XML; one picked there goes by its file's name, the one it was saved under
  const importXML = (xml, name) => {
    const { build, warn } = fromXML(xml, shareCtx(), blank);
    if (name) build.name = name;
    addBuild(build);
    inmsg.textContent = warn.length ? t('Imported. Not understood ({0}): {1}', warn.length, warn.join(' · ')) : t('Imported.');
  };
  if (pob) pob.onchange = async () => {
    if (!pob.value) return;
    try { importXML(await (await fetch('pob?name=' + encodeURIComponent(pob.value))).text(), pob.value.replace(/\.xml$/i, '')); }
    catch (err) { inmsg.textContent = t('Could not import: {0}', err.message); }
  };
  const close = () => { d.remove(); removeEventListener('keydown', key); };
  const key = e => { if (e.key === 'Escape') close(); };
  addEventListener('keydown', key);
  d.onclick = async e => {
    const el = e.target, a = el.dataset.a;
    if (el === d || a === 'close') return close();
    if (a === 'copy') { await navigator.clipboard.writeText(code); out.textContent = t('Code copied.'); }
    // the planner's server writes the file (the app's window cannot download); a page without it downloads it
    const save = async (text, name, kind) => {
      const r = await fetch('save', { method: 'POST', body: JSON.stringify({ kind, name, text }) }).catch(() => null);
      if (r?.ok) { out.textContent = t('Saved: {0}', await r.text()); return; }
      const l = document.createElement('a');
      l.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      l.download = name; l.click();
    };
    if (a === 'json') await save(JSON.stringify(B(), null, 1), B().name.replace(/[^\w-]+/g, '_') + '.json', 'json');
    // in the game's language: the page's when they are the same, else English (the only other one the planner has)
    if (a === 'game') { const g = (await fetch('game').then(r => r.json()).catch(() => null))?.language;
      await save(toBuildFile(B(), shareCtx(), !!g && g !== lang), buildFileName(B()), 'game'); }
    if (a === 'file') $('importFile').click();
    if (el.dataset.up) {
      const s = SITES.find(s => s.id === el.dataset.up);
      out.textContent = t('Uploading to {0}…', s.name);
      try {
        const url = await upload(s.id, code);
        await navigator.clipboard.writeText(url).catch(() => {});
        out.innerHTML = `${t('Link copied:')} <a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>`;
      } catch (err) {   // no serve.py, or the site refused: hand the code over by hand
        await navigator.clipboard.writeText(code).catch(() => {});
        out.innerHTML = `${esc(t('{0} could not be reached from here ({1}). The code is copied: paste it on', s.name, err.message))} <a href="${s.home}" target="_blank" rel="noopener">${s.home}</a>`;
      }
    }
    if (a === 'import') {
      let txt = d.querySelector('[data-in]').value.trim();
      if (!txt) return;
      try {
        if (/^https?:\/\/|^[\w.]+\.\w+\//.test(txt)) { inmsg.textContent = t('Downloading…'); txt = await download(txt); }
        importXML(txt.startsWith('<') ? txt : await decode(txt));
      } catch (err) { inmsg.textContent = t('Could not import: {0}', err.message); }
    }
  };
  document.body.append(d);
};
$('importBtn').onclick = () => openShare(false);
$('exportBtn').onclick = () => openShare(true);
$('importFile').onchange = async e => {
  addBuild({ ...blank(), ...JSON.parse(await e.target.files[0].text()) });
  e.target.value = ''; document.getElementById('sharePanel')?.remove();
};

// ---------- passive tree (canvas 2D), drawn like the in-game tree
const cv = $('treeCanvas'), ctx = cv.getContext('2d');
const R = { keystone: 116, notable: 82, jewel: 82, attribute: 56, small: 56, root: 104 };   // half the size of the game's frame of each (img/tree), in world units
const ORBIT = tree.orbit_radii || [], GROUPS = tree.groups || [];
const CENTRE_R = 1330;   // empty middle of the tree (class roots sit at ~1450): the chosen ascendancy is drawn there
// a node with no icon (no game art yet) is tinted by the theme of its stats instead
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
const ownRoot = a => N[ascStart(a)]?.links.map(String).find(l => ROOTS.has(l));
// every ascendancy of a class shares its start (some, e.g. Abyssal Lich, don't link to it in the data)
const classRoot = a => ownRoot(a) || ascs.filter(x => x.class === clsOf(a)).map(x => ownRoot(x.name)).find(Boolean);
const MASTERY = Object.keys(N).filter(id => N[id].mastery_art);   // the passives with their mastery's art behind them
const visible = () => [...main, ...(ASC[B().asc] || [])];
let view = { x: 0, y: 0, s: 0 }, hover = null;

// ---------- weapon sets: passives that only apply while that weapon set is in use
// game rules (no table in the extracted data): 99 points from levels + 24 from quests, 8 ascendancy points
// (4 trials x 2), up to 24 weapon set points for each set; keystones and jewel sockets can't go in a set
const TOTAL = { tree: 123, asc: 8, set: 24 };
const SET_COL = { 1: '#e0704a', 2: '#62b0e8' };
let mode = 0;   // what a click on the tree allocates: 0 = normal points, 1 / 2 = weapon set points
const setOf = (b, k) => (b['set' + k] ||= []);
const setOK = id => !ROOTS.has(id) && N[id].type !== 'keystone' && N[id].type !== 'jewel' && !N[id].ascendancy;
function fixSets(b) {   // set passives must stay linked to the start through normal or same-set passives
  for (const k of [1, 2]) {
    const own = setOf(b, k).filter(n => !b.nodes.includes(n));
    b['set' + k] = b.nodes.length ? prune([...b.nodes, ...own]).filter(n => own.includes(n)) : [];
  }
}
// a multiple choice notable's option (Gemling's Implanted Gems: Bolstering Implants) is picked with it, for no point
const ascPaid = b => b.ascNodes.filter(id => !N[id]?.option).length;
function renderPoints(b) {
  const box = (label, used, total, m, tip) => `<${m == null ? 'div' : `button data-mode="${m}"`} class="${m === mode ? 'on' : ''}${used > total ? ' over' : ''}" title="${tip}"${m ? ` style="--set:${SET_COL[m]}"` : ''}>${label}<b>${used} / ${total}</b></${m == null ? 'div' : 'button'}>`;
  $('treePts').innerHTML =
    box(t('Tree'), Math.max(0, b.nodes.length - 1), TOTAL.tree, 0, t('Click: allocate normal points (99 from levels + 24 from quests)'))
    + box(t('Ascendancy'), ascPaid(b), TOTAL.asc, null, t('Ascendancy points (4 trials × 2)'))
    + box(t('Set 1'), setOf(b, 1).length, TOTAL.set, 1, t('Click: allocate points to weapon set {0} (the panel stats use this set)', 1))
    + box(t('Set 2'), setOf(b, 2).length, TOTAL.set, 2, t('Click: allocate points to weapon set {0} (the panel stats use this set)', 2))
    + `<button id="treeReset" title="${t('Remove every allocated passive, ascendancy and weapon set point')}">${t('Reset')}<b>⟲</b></button>`;
}
$('treePts').onclick = async e => {
  if (e.target.closest('#treeReset')) {
    const b = B(), n = Math.max(0, b.nodes.length - 1) + ascPaid(b) + setOf(b, 1).length + setOf(b, 2).length;
    if (!n || await ask(t('Reset the whole tree? {0} allocated points will be removed.', n), t('Reset')) !== 0) return;
    return edit((_, b) => { b.ascNodes = []; setNodes(b, []); })(e);
  }
  const el = e.target.closest('[data-mode]'); if (!el) return;
  mode = +el.dataset.mode;
  if (mode) swapSet(B(), mode);   // the set of the passives is the set in hand (its weapons too)
  save(); renderSide(); drawTree();
};
const walkable = (id, root) => N[id] && !N[id].ascendancy && (!ROOTS.has(id) || id === root);
function pathTo(have, target, ok) {   // BFS from the allocated set to target (id or test), returns the new node ids
  const hit = typeof target === 'function' ? target : u => u === target;
  const prev = new Map(have.map(n => [n, null])), q = [...have];
  let end = null;
  while (q.length) {
    const u = q.shift();
    if (hit(u)) { end = u; break; }
    for (const w of N[u].links.map(String)) if (!prev.has(w) && ok(w)) { prev.set(w, u); q.push(w); }
  }
  if (end === null) return [];
  const out = []; for (let u = end; prev.get(u) !== null; u = prev.get(u)) out.push(u);
  return out.reverse();
}
// move an allocated tree to another class start: keep every passive and join each loose piece,
// nearest first, to what is already connected by the shortest path (nodes that can't be reached are dropped)
function reroot(nodes, root) {
  if (!root) return [];
  const rest = new Set(nodes.filter(n => !ROOTS.has(n))), have = [root];
  const absorb = from => {   // pull in allocated passives touching the connected set
    const q = [...from];
    while (q.length) for (const w of N[q.shift()].links.map(String)) if (rest.has(w)) { rest.delete(w); have.push(w); q.push(w); }
  };
  absorb(have);
  while (rest.size) {
    const p = pathTo(have, u => rest.has(u), w => walkable(w, root) || rest.has(w));
    if (!p.length) break;
    for (const u of p) rest.delete(u);
    have.push(...p); absorb(p);
  }
  return have;
}
function prune(nodes) {            // keep only what is still connected to nodes[0]
  const keep = new Set([nodes[0]]), q = [nodes[0]], set = new Set(nodes);
  while (q.length) for (const w of N[q.shift()].links.map(String)) if (set.has(w) && !keep.has(w)) { keep.add(w); q.push(w); }
  return nodes.filter(n => keep.has(n));
}
// what clicking `id` would allocate (empty if it is allocated already or unreachable)
function preview(id, b = B()) {
  if (N[id].ascendancy) {
    const st = ascStart(b.asc);
    return id === st || b.ascNodes.includes(id) ? [] : pathTo([st, ...b.ascNodes], id, w => N[w]?.ascendancy === b.asc);
  }
  if (b.nodes.includes(id)) return [];
  if (mode) {   // weapon set: grows from the normal tree plus that set's passives
    const own = setOf(b, mode);
    if (own.includes(id) || !b.nodes.length || !setOK(id)) return [];
    const p = pathTo([...b.nodes, ...own], id, w => walkable(w, b.nodes[0]));
    return p.every(setOK) ? p : [];
  }
  // the tree always grows from the class start, like in the game
  const have = b.nodes.length ? b.nodes : [classRoot(b.asc)].filter(Boolean);
  if (!have.length) return [];
  const p = id === have[0] ? [] : pathTo(have, id, w => walkable(w, have[0]));
  if (id !== have[0] && !p.length) return [];
  return [...(b.nodes.length ? [] : have), ...p];
}
function toggle(b, id) {   // what a click on `id` does to build b (false: nothing)
  if (N[id].ascendancy) {
    const st = ascStart(b.asc);
    if (id === st) return false;
    b.ascNodes = b.ascNodes.includes(id) ? prune([st, ...b.ascNodes.filter(n => n !== id)]).slice(1) : [...b.ascNodes, ...preview(id, b)];
  } else if (mode) {
    const own = setOf(b, mode);
    if (own.includes(id)) { b['set' + mode] = own.filter(n => n !== id); fixSets(b); }
    else own.push(...preview(id, b));
  } else if (id === b.nodes[0]) setNodes(b, []);
  else if (b.nodes.includes(id)) setNodes(b, prune(b.nodes.filter(n => n !== id)));
  else {   // a set passive taken with a normal point stops being a set passive
    const p = preview(id, b); b.nodes.push(...p);
    for (const k of [1, 2]) b['set' + k] = setOf(b, k).filter(n => !p.includes(n));
  }
}
function clickNode(id) {
  if (toggle(B(), id) !== false) { save(); renderSide(); drawTree(); }
}
// What that click would change in the panel numbers and each skill's DPS. The level stays as it is, so only the
// passives count (the planner's level follows the points spent). Kept while the same passive is under the mouse.
const snap = b => snapshot(b, sumOf(b));
let impKey, impRows;
function nodeImpact(id) {
  const key = `${id} ${mode} ${rev}`;
  if (key !== impKey) { const z = structuredClone(B()); toggle(z, id); impKey = key; impRows = diff(snap(B()), snap(z)); }
  return impRows;
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
  if (!(k in IMG)) { IMG[k] = null; const im = new Image(); im.onload = () => { IMG[k] = im; redraw(); }; im.src = 'poe2_data/available/img/' + k.replace(/\.dds$/, '') + '.webp'; }
  return IMG[k];
}
// the game's node frames (images.py: img/tree/<frame>_<normal|can|active>.webp) and how much of each is the hole the
// icon shows through (measured on those pictures); an ascendancy frame has a backing, so its icon goes on top
const LINK = {
  normal: [['#5e5846', 11], ['#0c0b05', 7], ['#2c200e', 3]],
  can: [['#b8a458', 11], ['#483e06', 9], ['#dacc7d', 7], ['#fbf9ef', 3]],
  active: [['rgba(159,129,74,.3)', 37], ['rgba(159,129,74,.6)', 20], ['#ffd786', 13], ['#5f4509', 9], ['#f2e4b8', 7], ['#ffffff', 3]],
};
const FRAME = { small: 'passive', attribute: 'passive', notable: 'notable', keystone: 'keystone', jewel: 'jewel' };
const HOLE = { passive: .607, notable: .562, keystone: .561, asc_passive: .62, asc_notable: .56 };
function drawNode(id, x, y, r, state, tint) {   // state: on | path | off; tint: weapon set colour
  const n = N[id], lit = state !== 'off', type = isRoot(id) ? 'root' : n.type;
  const col = n.type === 'attribute' ? (ATTR[(B().attrs || {})[id]]?.[1] || '#b8b0a0') : isRoot(id) ? '#e8d8b0' : HUE[id];
  const frame = tint || state === 'on' ? tint || '#f2cf74' : state === 'path' ? '#c9b07a' : '#6a5d47';
  if (r < 3) { ctx.fillStyle = lit ? frame : type === 'keystone' || type === 'notable' ? '#8a7650' : '#4a4236'; ctx.beginPath(); ctx.arc(x, y, Math.max(1.2, r), 0, 7); ctx.fill(); return; }
  const kind = n.ascendancy_start ? 'asc_start' : n.ascendancy ? (type === 'notable' ? 'asc_notable' : 'asc_passive') : FRAME[type];
  const pic = kind && !isRoot(id) && art(`tree/${kind}_${state === 'on' ? 'active' : state === 'path' && kind !== 'asc_start' ? 'can' : 'normal'}`);
  if (pic) {
    // a frame is drawn one pixel a world unit, like the game's links; its icon fills the hole
    const f = r / R[type], w = pic.width * f, h = pic.height * f, ir = (HOLE[kind] || 0) * w / 2;
    const icon = ir > 0 && art(n.icon);
    const drawIcon = () => {   // its icon at any size; while it loads, the colour of its stats
      if (!ir) return;
      ctx.save(); ctx.globalAlpha = lit ? 1 : .55; ctx.beginPath(); ctx.arc(x, y, ir, 0, 7);
      if (icon) { ctx.clip(); ctx.drawImage(icon, x - ir, y - ir, ir * 2, ir * 2); } else { ctx.fillStyle = col; ctx.fill(); }
      ctx.restore();
    };
    if (!n.ascendancy) drawIcon();
    ctx.drawImage(pic, x - w / 2, y - h / 2, w, h);
    if (n.ascendancy) drawIcon();
    const ring = (rr, wd, c) => { ctx.strokeStyle = c; ctx.lineWidth = wd; ctx.beginPath(); ctx.arc(x, y, rr, 0, 7); ctx.stroke(); };
    if (tint) ring(w / 2, Math.max(1.5, w * .06), tint);   // a weapon set's passive: its colour round the frame
    if (id === hover) ring(w / 2 + 2, 1.5, '#fff6d8');
    return;
  }
  if (state === 'on') { ctx.shadowColor = tint || '#f0b84a'; ctx.shadowBlur = r * .9; }
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

// ---------- node search: highlights nodes whose name or description contains the text (case and accent insensitive)
const fold = t => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const SEARCH_TEXT = {};
const searchText = id => SEARCH_TEXT[id] ??= fold([N[id].name, N[id].name_es, N[id].grants_skill, ...statLines(nodeStats(id))].filter(Boolean).join('\n'));
let found = new Set(), foundAt = -1;
function search() {
  const q = fold($('treeFind').value.trim());
  found = new Set(q ? visible().filter(id => !isRoot(id) && searchText(id).includes(q)) : []);
  foundAt = -1;
  $('treeFindN').textContent = q ? t(found.size === 1 ? '1 result' : '{0} results', found.size) : '';
  redraw();
}
$('treeFind').oninput = search;
$('treeFind').onkeydown = e => {   // Enter / Shift+Enter: centre the view on the next / previous match
  if (e.key === 'Escape') { e.target.value = ''; search(); }
  if (e.key !== 'Enter' || !found.size) return;
  const ids = [...found];
  foundAt = (foundAt + (e.shiftKey ? -1 : 1) + ids.length) % ids.length;
  [view.x, view.y] = WP[ids[foundAt]]; view.s = Math.max(view.s, .12);
  $('treeFindN').textContent = `${foundAt + 1} / ${ids.length}`;
  redraw();
};
// the passives the optimizer would take, lit like search matches, with the tree moved and zoomed to show them all
function showOnTree(ids) {
  $('treeFind').value = ''; found = new Set(ids); foundAt = -1;
  $('treeFindN').textContent = t(found.size === 1 ? '1 result' : '{0} results', found.size);
  document.querySelector('nav button[data-v="tree"]').click();
  const at = ids.map(id => WP[id]).filter(Boolean); if (!at.length) return;
  const xs = at.map(p => p[0]), ys = at.map(p => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  view.x = (x0 + x1) / 2; view.y = (y0 + y1) / 2;
  view.s = Math.min(.12, Math.max(.01, Math.min(cv.clientWidth / (x1 - x0 + 1500), cv.clientHeight / (y1 - y0 + 1500))));
  redraw();
}
function drawFound(x, y, r) {
  const rr = Math.max(r * 1.45, 7);
  ctx.shadowColor = '#7fe0ff'; ctx.shadowBlur = 12; ctx.strokeStyle = '#9fe8ff'; ctx.lineWidth = Math.max(2, r * .16);
  ctx.beginPath(); ctx.arc(x, y, rr, 0, 7); ctx.stroke(); ctx.shadowBlur = 0;
}

const dpr = () => devicePixelRatio || 1;
function drawTree() {
  if (!cv.offsetParent) return;
  const W = cv.clientWidth, H = cv.clientHeight, D = dpr();
  if (cv.width !== W * D || cv.height !== H * D) { cv.width = W * D; cv.height = H * D; }
  view.s ||= Math.min(W, H) / 26000;   // fit whole tree on first draw
  const s = view.s, b = B(), st = ascStart(b.asc);
  const set1 = new Set(setOf(b, 1)), set2 = new Set(setOf(b, 2));
  const on = new Set([...b.nodes, ...b.ascNodes, ...(st ? [st] : []), ...set1, ...set2]);
  const setTint = id => b.nodes.includes(id) ? null : set1.has(id) && (mode !== 2 || !set2.has(id)) ? SET_COL[1] : set2.has(id) ? SET_COL[2] : null;
  const pre = new Set(hover ? preview(hover) : []);
  const vis = visible(), visSet = new Set(vis);
  const sx = x => (x - view.x) * s + W / 2, sy = y => (y - view.y) * s + H / 2;

  // background: one colour, the one of the game's passive screen (measured on a screenshot of it; the game's shader
  // takes its texture from the executable)
  ctx.setTransform(D, 0, 0, D, 0, 0);
  ctx.fillStyle = '#080c12'; ctx.fillRect(0, 0, W, H);

  // world-space layers
  ctx.setTransform(D * s, 0, 0, D * s, D * (W / 2 - view.x * s), D * (H / 2 - view.y * s));
  // behind each passive of a mastery, its art (images.py: img/mastery, at half size), bright once it is allocated,
  // faint until then (as the game shows it)
  // note: the size (1.5 world units a pixel) and the faint 0.3 are by eye from screenshots of the game; no table says them
  for (const id of MASTERY) {
    const pic = art('mastery/' + N[id].mastery_art);
    if (!pic) continue;
    const [x, y] = WP[id], w = pic.width * 1.5, h = pic.height * 1.5;
    ctx.globalAlpha = on.has(id) ? 1 : .3;
    ctx.drawImage(pic, x - w / 2, y - h / 2, w, h);
  }
  ctx.globalAlpha = 1;
  // central ascendancy disc
  const disc = ctx.createRadialGradient(0, 0, CENTRE_R * .2, 0, 0, CENTRE_R);
  disc.addColorStop(0, '#221d16'); disc.addColorStop(1, '#0b0a08');
  ctx.fillStyle = disc; ctx.beginPath(); ctx.arc(0, 0, CENTRE_R, 0, 7); ctx.fill();
  const A = ascs.find(a => a.name === b.asc), centreArt = art(A?.tree_image) || art(ascs.find(a => a.class === clsOf(b.asc))?.class_tree_image);
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
  const off = new Path2D(), path = new Path2D(), lit = new Path2D(), setLit = { [SET_COL[1]]: new Path2D(), [SET_COL[2]]: new Path2D() };
  for (const id of vis) for (const l of N[id].links) {
    const m = String(l);
    if (!visSet.has(m) || +m < +id || !N[id].ascendancy !== !N[m].ascendancy) continue;
    const A = on.has(id), Bo = on.has(m);
    const tint = A && Bo && (setTint(id) || setTint(m));
    linkPath(tint ? setLit[tint] : A && Bo ? lit : (A || pre.has(id)) && (Bo || pre.has(m)) ? path : off, id, m);
  }
  const px = v => v / s;   // screen pixels -> world units
  ctx.lineCap = 'round';
  // each kind of link as the game's own (PassiveSkillScreenCurves*Together.dds: its colours across the line, outside
  // in, one pixel a world unit), never thinner on screen than `least` pixels
  const stroke = (p, layers, least) => {
    const k = Math.max(1, px(least) / layers[0][1]);
    for (const [c, w] of layers) { ctx.strokeStyle = c; ctx.lineWidth = w * k; ctx.stroke(p); }
  };
  stroke(off, LINK.normal, 1.2);
  stroke(path, LINK.can, 1.6);
  stroke(lit, LINK.active, 2.4);
  for (const [c, p] of Object.entries(setLit)) stroke(p, [[c + '55', 37], [c, 13], ['#ffffff', 3]], 2.4);

  // nodes (screen space so they stay crisp)
  ctx.setTransform(D, 0, 0, D, 0, 0);
  const myRoot = classRoot(b.asc);
  for (const id of vis) {
    const n = N[id], [wx, wy] = WP[id], x = sx(wx), y = sy(wy);
    const r = R[isRoot(id) ? 'root' : n.type] * s * (n.ascendancy ? FIT[n.ascendancy].k : 1);
    if (x < -r * 2 || y < -r * 2 || x > W + r * 2 || y > H + r * 2) continue;
    if (found.has(id)) drawFound(x, y, r);
    drawNode(id, x, y, r, on.has(id) ? 'on' : pre.has(id) || (id === myRoot && !b.nodes.length) ? 'path' : 'off', on.has(id) && setTint(id));
  }
  // labels
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (const id of vis) {
    const n = N[id];
    if (isRoot(id)) continue;
    if (!(n.type === 'keystone' && s > .08 || n.type === 'notable' && s > .3)) continue;
    const [wx, wy] = WP[id], x = sx(wx), y = sy(wy);
    if (x < -100 || y < -40 || x > W + 100 || y > H + 40) continue;
    const r = R[isRoot(id) ? 'root' : n.type] * s * (n.ascendancy ? FIT[n.ascendancy].k : 1);
    ctx.font = `${n.type === 'keystone' ? 13 : 11}px Georgia, serif`;
    ctx.fillStyle = on.has(id) ? '#f2d58a' : '#a8987a';
    ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
    ctx.strokeText(label(n), x, y + r * 1.25 + 2); ctx.fillText(label(n), x, y + r * 1.25 + 2);
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
const KIND = { keystone: 'Keystone', notable: 'Notable', jewel: 'Jewel socket', attribute: 'Attribute', small: 'Passive' };
function showTip(id, mx, my) {
  const tip = $('tip'), n = N[id];
  tip.hidden = !id;
  if (!id) return;
  const lines = statLines(nodeStats(id)).concat(n.grants_skill ? [t('Grants: {0}', n.grants_skill)] : []);
  const cost = preview(id).filter(x => !isRoot(x)).length, start = n.ascendancy_start, b = B();
  const sets = [1, 2].filter(k => setOf(b, k).includes(id)), forSet = mode && !n.ascendancy;
  const mine = b.nodes.includes(id) || b.ascNodes.includes(id) || forSet && sets.includes(mode);
  tip.className = 'tip-' + (isRoot(id) ? 'root' : n.type);
  tip.innerHTML = `<div class="th">${esc(label(n))}<small>${isRoot(id) ? t('Class start') : t(KIND[n.type])}${n.ascendancy ? ' · ' + esc(n.ascendancy) : ''}${sets.map(k => ' · ' + t('Set {0}', k)).join('')}</small></div>`
    + (lines.length ? `<div class="tb">${lines.map(esc).join('<br>')}</div>` : '')
    + (cost || mine ? impactHtml(t(mine ? 'If you remove it' : 'If you allocate it'), nodeImpact(id)) : '')
    + `<div class="tf">${n.type === 'attribute' ? t('Right click: Str / Dex / Int') + '<br>' : ''}${start ? t('Ascendancy start') : cost ? (forSet ? t(cost > 1 ? 'Click: allocate ({0} points of set {1})' : 'Click: allocate (1 point of set {1})', cost, mode) : t(cost > 1 ? 'Click: allocate ({0} points)' : 'Click: allocate (1 point)', cost)) : preview(id).length ? t('Click: start here')
      : mine ? t('Click: remove') : forSet && !setOK(id) ? t('Cannot be allocated to a weapon set') : t('Cannot be allocated from here')}</div>`;
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
// side panel: character sheet in Tree / Equipment, details of the selected skill in Skills, in the 3D scene what changes while
// you play (resistances, speeds, damage taken...) over the skills whose damage changes with it
document.querySelectorAll('nav button').forEach(btn => btn.onclick = () => {
  const v = btn.dataset.v;
  document.querySelectorAll('nav button').forEach(x => x.classList.toggle('on', x === btn));
  document.querySelectorAll('.view').forEach(x => x.hidden = x.id !== v);
  $('charPanel').hidden = v === 'skills' || v === 'scene';
  $('simChar').hidden = v !== 'scene';
  $('skillPanel').hidden = v !== 'skills';
  $('sceneSkills').hidden = v !== 'scene';
  if (v === 'items') renderItems();     // what each item would change depends on the tree and skills as they are now
  if (v === 'opt') renderOpt();
  if (v === 'settings') { renderSettings(); renderLoot(); }
  if (v === 'filter') renderFilter();
  dispatchEvent(new Event('resize'));  // canvas / 3D renderer follow the new width
  drawTree();
});

// ---------- enemy of the 3D scene: searchable list of the game's monsters, its level and attack, and what the numbers say (enemies.js)
const saveScene = () => localStorage.setItem(SCENE_KEY, JSON.stringify(sceneCfg));
// the simulator's skill bar of each build: { slots: [gem name or null x8], seen: [gem names it has placed] }
const BAR_KEY = SCENE_KEY + ':bar', sceneBars = (() => { try { return JSON.parse(localStorage.getItem(BAR_KEY) || '{}'); } catch { return {}; } })();
const enemyLevel = () => Math.max(1, Math.min(100, sceneCfg.level || B().level || 1));
const syncEnemy = () => scene3d?.enemy(enemy(sceneCfg.enemy), enemyLevel(), sceneCfg.attack, sceneCfg.rarity);
const attr = x => esc(x).replace(/"/g, '&quot;');
const enWrap = Object.assign(document.createElement('details'), { className: 's-enwrap' });
enWrap.innerHTML = `<summary>${t('Enemies')}</summary><div id="sceneEnemy"></div>`;
$('scene').append(enWrap);
enWrap.onchange = $('sceneSkills').onchange; enWrap.onclick = $('sceneSkills').onclick;
enWrap.querySelector('summary').onmouseup = e => e.target.blur();   // Space rolls in the scene, it must not fold the panel
$('sceneEnemy').innerHTML = `<h3>${t('Enemies')} <small class="note">${t('{0} from the game', fmt(ENEMIES.length))}</small></h3>
  <div class="en-pick"><input id="enFind" type="search" placeholder="${attr(t('Search enemy…'))}" autocomplete="off" spellcheck="false"><div id="enList" hidden></div></div>
  <div id="enDetail"></div>`;
const enFind = $('enFind'), enList = $('enList');
let enAt = 0;   // row the arrow keys are on
function listEnemies() {
  const { total, list } = findEnemies(enFind.value, 60);
  enAt = Math.max(0, Math.min(enAt, list.length - 1));
  enList.innerHTML = list.map((m, i) => `<div class="en-row${i === enAt ? ' at' : ''}${m.id === sceneCfg.enemy ? ' on' : ''}" data-id="${attr(m.id)}">
      <span>${esc(m.name)}${m.variant ? ` <small>${esc(m.variant)}</small>` : ''}</span>
      <small>${[m.boss && `<b>${t('Boss')}</b>`, m.category && t(m.category), m.areas?.[0] && esc(m.areas[0])].filter(Boolean).join(' · ')}</small></div>`).join('')
    + (total > list.length ? `<p class="note">${t('{0} more: type to narrow the list', fmt(total - list.length))}</p>` : total ? '' : `<p class="note">${t('No enemy matches')}</p>`);
  enList.hidden = false;
}
const closeEnemies = () => { enList.hidden = true; enFind.value = enemy(sceneCfg.enemy)?.name || ''; };
function pickEnemy(id) {
  if (!enemy(id)) return;
  sceneCfg.enemy = id; sceneCfg.attack = sceneCfg.rarity = null; saveScene();
  enFind.blur(); closeEnemies(); syncEnemy(); renderEnemy();
  scene3d.placing(true);   // the next clicks in the scene place it
}
enFind.onfocus = () => { enFind.value = ''; enAt = 0; listEnemies(); enList.scrollTop = 0; };
enFind.oninput = () => { enAt = 0; listEnemies(); enList.scrollTop = 0; };
enFind.onblur = closeEnemies;
enFind.onkeydown = e => {
  const rows = enList.querySelectorAll('.en-row');
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); if (!rows.length) return;
    enAt = (enAt + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length;
    rows.forEach((r, i) => r.classList.toggle('at', i === enAt)); rows[enAt].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') { if (rows[enAt]) pickEnemy(rows[enAt].dataset.id); }
  else if (e.key === 'Escape') { e.preventDefault(); enFind.blur(); }
};
enList.onmousedown = e => { e.preventDefault(); const r = e.target.closest('[data-id]'); if (r) pickEnemy(r.dataset.id); };   // keeps the focus until the pick is done

const EL_NAME = { physical: 'Physical', fire: 'Fire', cold: 'Cold', lightning: 'Lightning', chaos: 'Chaos' };
const secs = x => x == null ? '—' : x >= 3600 ? '> 1 h' : fmt(x, x < 10 ? 2 : x < 100 ? 1 : 0) + ' s';
// the picked enemy: its stats at the level, its attack against the defences of the build, and the selected skill against it
function renderEnemy() {
  const box = $('enDetail'), m = enemy(sceneCfg.enemy);
  if (document.activeElement !== enFind) enFind.value = m?.name || '';
  if (!m) { box.innerHTML = `<p class="note">${t('Pick an enemy and click in the scene to place it. Its life, defences and damage are the game\'s at the level you set: test your damage on it and your defences against its attacks.')}</p>`; return; }
  const b = B(), c = character(b, treeSum()), L = enemyLevel(), rar = rarityOf(m, sceneCfg.rarity), st = enemyStats(m, L, rar);
  const list = attacksOf(m), key = list.some(a => a.key === sceneCfg.attack) ? sceneCfg.attack : list[0].key, atk = attackOf(m, L, key, rar), vp = versusPlayer(atk, st, c);
  const row = (k, v) => `<tr><th>${k}</th><td>${v}</td></tr>`;
  const el = (type, text) => `<span class="dm ${type}">${text}</span>`;
  const rng = r => r[0] === r[1] ? fmt(r[0]) : `${fmt(r[0])}–${fmt(r[1])}`;
  const pct = x => fmt(x) + '%', small = x => fmt(x, x < 100 ? 1 : 0);
  const types = v => v.types.map(x => row(t(EL_NAME[x.type]), `${el(x.type, rng(x.raw))} → <b>${rng(x.taken)}</b>`));
  const stats = [row(t('Life'), fmt(st.life)), st.es ? row(t('Energy Shield'), el('es', fmt(st.es))) : '', row(t('Armour'), fmt(st.armour)), row(t('Evasion'), fmt(st.evasion)),
    row(t('Accuracy'), fmt(st.accuracy)), row(t('Resistances'), ['fire', 'cold', 'lightning', 'chaos'].map(e => el(e, pct(st.res[e]))).join(' '))];
  const theirs = [...types(vp),
    ...vp.dots.map(x => row(t('{0} per second', t(EL_NAME[x.type])), `${el(x.type, small(x.raw))} → <b>${small(x.taken)}</b>`)),
    row(t('Every'), secs(atk.interval)),
    atk.hasHit ? row(t('Chance to hit you'), pct(vp.hit)) : '',
    vp.block > 0 ? row(t('Block'), pct(vp.block)) : '',
    atk.hasHit ? row(t('Critical hit'), `${pct(vp.crit)} · ${t('biggest hit')} <b>${fmt(vp.maxTaken)}</b>`) : '',
    atk.hasHit ? row(t('Mitigated'), pct(vp.mitigated)) : '',
    row(t('Damage per second'), `<b>${small(vp.dps)}</b>`),
    row(t('You survive'), vp.pool == null ? t('life unknown') : vp.ttd == null ? '∞' : `<b>${secs(vp.ttd)}</b>`)];
  const g = b.gems[scene3d?.selected() ?? 0], dmg = g && skillDmg(g), ve = dmg && versusEnemy(dmg, st, c.accuracy);
  const yours = !g ? '' : `<h4>${t('{0} against it', esc(gemInfo(g).label))}</h4>` + (ve ? `<table class="en-t">${[...types(ve),
      ve.dotTaken > 0 ? row(t('Damage over time'), `<b>${small(ve.dotTaken)}</b> / s`) : '',
      dmg.attack ? row(t('Chance to hit'), pct(ve.hit)) : '',
      ve.types.length ? row(t('Mitigated'), pct(ve.mitigated)) : '',
      row(t('Damage per second'), ve.dps != null ? `<b>${fmt(ve.dps)}</b>` : '—'),
      ve.hitsToKill ? row(t('Hits to kill'), fmt(ve.hitsToKill)) : '',
      row(t('Time to kill'), `<b>${secs(ve.ttk)}</b>`)].join('')}</table>`
    : `<p class="note">${t(dmg.reason || 'This skill does not deal direct damage')}. ${t('In the scene each of its hits takes 1/8 of the enemy\'s life, marked with ~.')}</p>`);
  const placing = !!scene3d?.placing();
  box.innerHTML = `<div class="en-head"><b>${esc(m.name)}</b>${m.variant ? ` <small>${esc(m.variant)}</small>` : ''}<span>${[m.boss && t('Boss'), m.category && t(m.category)].filter(Boolean).join(' · ')}</span></div>
    ${m.areas?.length ? `<p class="note en-areas" title="${attr(m.areas.join('\n'))}">${esc(m.areas.slice(0, 3).join(' · '))}${m.areas.length > 3 ? ' …' : ''}</p>` : ''}
    <div class="sk-set"><label><span>${t('Level')} ${sceneCfg.level ? `<a data-en="mylevel" title="${attr(t('Use the level of your build ({0})', b.level))}">↺</a>` : `<small>${t('yours')}</small>`}</span>
        <input type="number" min="1" max="100" step="1" data-en="level" value="${L}"></label>
      <label><span>${t('Rarity')}</span><select data-en="rarity">${RARITIES.map(r => `<option value="${r}" ${r === rar ? 'selected' : ''}>${t(r[0].toUpperCase() + r.slice(1))}</option>`).join('')}</select></label>
      <label><span>${t('Attack')}</span><select data-en="attack">${list.map(a => `<option value="${attr(a.key)}" ${a.key === key ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label></div>
    ${atk.description ? `<p class="note">${esc(atk.description)}</p>` : ''}
    <table class="en-t">${stats.join('')}</table>
    <h4>${t('{0} against you', esc(atk.name))} <small>${t('hit → after your defences')}</small></h4>
    <table class="en-t">${theirs.join('')}</table>
    ${yours}
    <div class="en-btns"><button data-en="place" class="${placing ? 'on' : ''}">${placing ? t('Placing: click in the scene') : t('Place with a click')}</button>
      <button data-en="clear">${t('Remove enemies')}</button><button data-en="reset">${t('Reset the simulator')}</button></div>
    <label class="en-still"><input type="checkbox" data-en="still"${sceneCfg.still ? ' checked' : ''}> ${t('Enemies stand still')}</label>
    <label class="en-still"><input type="checkbox" data-en="fight"${sceneCfg.fight ? ' checked' : ''}> ${t('Enemies attack')}</label>
    <p class="note">${t('Enemies come at you at their speed once you are within their aggro range or hit them, and attack within their reach. A number with ~ includes a value the game data does not give.')}</p>`;
}

// what buffs and ailments change while you play, against your character without them: up in green, down in red
// (`good`: whether more is better). Life, mana, Spirit, Rage and charges are already on the scene's screen.
let liveHtml = '';
function onLive(L) {
  if ($('simChar').hidden) return;
  const row = (k, [now, was], unit, good = true, d = 0) => {
    const cls = Math.abs(now - was) < .05 ? '' : (now > was) === good ? 'up' : 'down';
    return `<tr><th>${k}</th><td>${cls ? `<small>${fmt(was, d)}${unit} → </small>` : ''}<b class="${cls}">${fmt(now, d)}${unit}</b></td></tr>`;
  };
  const html = `<h3>${t('Character')}</h3><table class="en-t">
    ${L.res.map(([e, now, was]) => row(`<span class="dm ${e}">${t(EL_NAME[e])}</span>`, [now, was], '%')).join('')}
    ${row(t('Movement speed'), L.move, ' m/s', true, 1)}${row(t('Action speed'), L.action, '%')}${row(t('Damage taken'), L.taken, '%', false)}
    ${row(t('Total Life Recovery per second'), L.life, '', true, 1)}${row(t('Mana Recovery per second'), L.mana, '', true, 1)}${row(t('Damage over time taken per second'), L.dot, '', false, 1)}
    ${L.berserk ? row(t('{0}: life lost per second', esc(L.berserk.name)), L.berserk.v, '', false, 1) : ''}
    ${L.rage ? row(t('Attack damage from Rage'), L.rage, '%') : ''}${L.ward ? row(t('Runic Ward'), L.ward, '') : ''}${L.guard ? row(t('Guard'), L.guard, '') : ''}</table>`;
  if (html !== liveHtml) $('simChar').innerHTML = liveHtml = html;
  B().gems.forEach((g, i) => {   // the cards' damage per second, as it is now
    const el = document.querySelector(`#sceneList [data-dps="${i}"]`), s = skillDmg(g); if (!el || s.dps == null) return;
    const k = L.dps(i), v = `${fmt(s.dps * k)} <small>DPS</small>`;
    if (el.dataset.v !== v) { el.dataset.v = v; el.innerHTML = v; el.className = 'sdps' + (k > 1.001 ? ' up' : k < .999 ? ' down' : ''); }
  });
}
scene3d = initScene($('scene'), { build: B, geo, playerSpeed, still: () => sceneCfg.still, fight: () => sceneCfg.fight, onLive, info: gemInfo, onSelect: markCard, onPlacing: () => renderEnemy(), damage: skillDmg, usedBy: j => usedBy(B(), j), byHand: j => byHand(B(), j), reserve: g => reservation(g, treeSum(), B()),
  sheet: () => { const sum = treeSum(), c = character(B(), sum); return { ...c, ...recovery(c, sum), rage: rageOf(B(), sum), sprint: { speed: (SK.character_stats?.['sprint_movement_speed_+%'] || 0) + (sum['sprint_movement_speed_+%'] || 0), min: SK.character_stats?.dodge_roll_sprint_minimum_time_ms, turn: SK.character_stats?.dodge_roll_sprint_turn_rate }, noFall: !!sum.cannot_be_heavy_stunned_while_sprinting, owl: sum.owl_feather_max_bonus_to_stack ? { stack: sum.owl_feather_max_bonus_to_stack, faster: sum['owl_feather_gain_frequency_+%'] || 0 } : null, jade: sum.buildup_jade_every_x_ms && { every: sum.buildup_jade_every_x_ms, max: sum.max_jade_stacks, dr: sum['additional_physical_damage_reduction_%_per_jade'] }, ailments: ailmentDefence(c, sum),
    flasks: ['flask1', 'flask2'].map(k => { const f = flaskOf(B().items?.[k], sum); return f && { ...f, img: gemImg(f.img) }; }),
    charms: ['charm1', 'charm2', 'charm3'].map(k => { const f = charmOf(B().items?.[k], sum); return f && { ...f, img: gemImg(f.img), icon: gemImg(f.icon) }; }) }; },
  chargeIcon: c => gemImg(SK.charge_icons?.[c]), infusion: e => SK.infusions?.[e] && { icon: gemImg(SK.infusions[e].icon), name: tn(SK.infusions[e]) }, moveIcon: gemImg(SK.move_icon), ailmentIcon: a => gemImg(SK.ailment_icons?.[a]), archonIcon: gemImg(SK.archon_nature_icon), archon: SK.archon_nature,
  swapSet: () => { swapSet(B(), B().wset === 2 ? 1 : 2); save(); renderSide(); return B().wset; },
  bar: () => sceneBars[cur], setBar: v => { sceneBars[cur] = v; try { localStorage.setItem(BAR_KEY, JSON.stringify(sceneBars)); } catch {} renderSceneSkills(); } });
const renderItems = initItems($('items'), B, () => { save(); renderSide(); },
  () => B().nodes.filter(id => N[id].type === 'jewel').map((id, i) => ({ id, label: t('socket {0}', i + 1) })),
  items => snap({ ...B(), items }), () => treeSum().keystone_giants_blood,
  { can: slot => SEARCH_SLOTS.includes(slot), money: () => renderOpt.money(), find: (...a) => renderOpt.better(...a), price: p => renderOpt.price(p), site: siteQuery });
const renderSkills = initSkills($('skills'), $('skillPanel'), B, () => { save(); renderSide(); }, treeSum, addGem, geo);
const renderOpt = initOpt($('opt'), { build: B, id: () => cur, rev: () => rev, sumOf, snap, tree, N, rootOf: b => classRoot(b.asc), total: TOTAL.tree, setNodes, showOnTree, ask,
  change: fn => { fn(B()); save(); renderSide(); drawTree(); } });
const lootEl = document.createElement('section');   // the equipment comparison: a section of Settings
const renderLoot = initLoot(lootEl, { build: B, id: () => cur, sumOf, snap,
  sockets: () => B().nodes.filter(id => N[id].type === 'jewel').map((id, i) => ({ id, label: t('socket {0}', i + 1) })) });
const renderSettings = initSettings($('settings'), lootEl);
watchUpdates($('updNote'));
const renderFilter = initFilter($('filter'));
select(builds[localStorage.getItem(KEY + ':last')] ? localStorage.getItem(KEY + ':last') : Object.keys(builds)[0]);

