// "What should I take to get the most X": the passive tree path and the support gems that raise one number of the
// build the most (a skill's damage or speed, toughness, life, energy shield...). Both searches try changes and keep
// what the calculation (calc.js) says is best, so they only see what the planner calculates: a passive or support
// whose effect is conditional or not modelled counts as nothing.
// No DOM here: optview.js is the screen, app.js owns the build.
import { skill, character, attributes, supportKnown } from './calc.js';
import { typical, hitChanceExact, playerTakes, K, TYPES } from './enemies.js';
import { SK } from './skilldata.js';
import { GEM, SUPPORTS, colour, canSupport } from './skills.js';

// ---------- objectives
// skill: needs a skill of the build. dec: decimals when shown. unit: printed after the number
export const OBJECTIVES = {
  dps: { label: 'Skill damage per second', skill: true },
  mix: { label: 'Damage and toughness (balanced)', skill: true },
  speed: { label: 'Skill uses per second', skill: true, dec: 2 },
  tough: { label: 'Toughness', dec: 1 },
  life: { label: 'Life' }, es: { label: 'Energy Shield' }, pool: { label: 'Life + Energy Shield' },
  mana: { label: 'Mana' }, spirit: { label: 'Spirit' }, armour: { label: 'Armour' }, evasion: { label: 'Evasion' },
  res: { label: 'Resistances (sum, up to their maximum)', unit: '%' }, move: { label: 'Movement speed', unit: '%' },
};
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
// Toughness: how many hits of a normal monster of the character's level it takes to bring the character down.
// 40% of the hits are physical and 15% each fire, cold, lightning and chaos (monsters differ: a fixed mix that makes
// every defence count). Evasion (hits that miss), block, armour and resistances are in; recovery, ailments and
// critical hits are not. Chaos damage removes twice as much energy shield.
const MIX = { physical: .4, fire: .15, cold: .15, lightning: .15, chaos: .15 };
export function toughness(c) {
  const m = typical(c.level), life = c.life || 0;
  if (!m.damage) return life + c.es;
  const lost = TYPES.reduce((s, type) => s + MIX[type] * playerTakes(c, type, m.damage) / ((life + c.es / (type === 'chaos' ? 2 : 1)) || 1), 0);   // share of the pool an average hit removes
  const lands = hitChanceExact(m.accuracy, c.evasion, c.evadeMax) / 100 * (1 - clamp(c.block || 0, 0, c.blockMax ?? K.player_max_block ?? 50) / 100 * (1 - (c.blockTaken || 0) / 100));
  return lost > 0 && lands > 0 ? 1 / (lost * lands) : 0;
}
// hits and damage over time of a skill, per second (null: the skill deals no damage the app can work out)
export const damage = s => { const dot = Object.values(s.dot).reduce((x, y) => x + y, 0); return s.dps == null && !dot ? null : (s.dps || 0) + dot; };
// the number an objective looks at, for build b with summed stats `sum` (g: the gem of b the skill objectives rate)
export function score(key, b, sum, g) {
  if (key === 'dps') return damage(skill(g, b, sum));
  if (key === 'speed') return skill(g, b, sum).speed;
  const c = character(b, sum);
  switch (key) {
    case 'mix': { const d = damage(skill(g, b, sum)); return d == null ? null : d * toughness(c); }
    case 'tough': return toughness(c);
    case 'pool': return (c.life || 0) + c.es;
    case 'res': return Object.values(c.res).reduce((s, r) => s + r.capped, 0);
    default: return c[key] ?? 0;
  }
}
// why a skill objective has no number (calc.js gives the reason), or null
export const whyNot = (key, b, sum, g) => !OBJECTIVES[key].skill ? null : !g ? 'Add a skill to the build first'
  : score(key, b, sum, g) == null ? skill(g, b, sum).reason || 'This skill does not deal direct damage' : null;

// ---------- passive tree
const ATTR = { str: 'strength', dex: 'dexterity', int: 'intelligence' };
const NONE = {};
const GROW = 8;       // passives a step may take around the one it walks to (a cluster is worth the walk as a whole)
const plus = (to, stats) => { for (const id in stats) to[id] = (to[id] || 0) + stats[id]; return to; };

// Spends up to `points` passive points from what build b has allocated, one step at a time: each step looks at every
// passive it can still pay the way to, alone and with the useful passives around it, works out the objective with
// them added, and takes the group that gives the most per point. So it is a heuristic (greedy): good paths, not a
// proven best one. Attribute passives on the way become the attribute that helps the objective (else `pref`).
// Keystones change rules the app does not calculate: never a reason to walk. A jewel socket is, for the jewel the build
// has for it; and the passives in a jewel's radius get what it adds to them (Time-Lost jewels), or can be taken without
// a link to the tree (Controlled Metamorphosis, From Nothing) once its socket is allocated.
//   tree: passive_tree.json; root: the class start; base: the summed stats of b (app.js sumOf); f(sum) -> number.
//   jewels: the build's socketed jewels, allocated or not (app.js jewelsOf): id (its socket), R (items.js radiusOf),
//   in(id) (within its radius), stats (what it grants with its socket allocated), free (the passives it frees)
//   tick({ spent, left, value }) may return a promise (lets the page breathe); stop() true ends the search.
// Returns { nodes (new ids, in order), attrs ({id: str|dex|int}), from, to (objective before / after), steps }.
export async function optimizeTree({ tree, b, base, root, extra = [], jewels = [], f, points, pref = 'str', tick, stop }) {
  const N = tree.nodes, roots = new Set(tree.class_roots.map(String));
  const ok = id => { const n = N[id]; return n && !n.ascendancy && n.type !== 'keystone' && (!roots.has(id) || id === root); };
  const counted = new Set(b['set' + (b.wset || 1)] || []);   // passives of the weapon set in use are in `base` already
  const have = new Set(b.nodes.length ? [...b.nodes, ...extra] : [root]);   // extra: the starts Split Personality opens
  const bySocket = new Map(jewels.map(j => [j.id, j]));
  const kind = id => N[id].type === 'notable' ? 'notable' : N[id].type === 'small' || N[id].type === 'attribute' ? 'small' : null;
  // what a passive gives: its own stats, what the jewels with their socket allocated add to it in their radius, and for
  // a socket with a jewel, the jewel and what its radius adds to the passives allocated already
  const statsOf = (id, a) => {
    const own = counted.has(id) ? NONE : N[id].type === 'attribute' ? plain[b.attrs?.[id] || a] : N[id].stats, k = kind(id), add = [];
    if (k && own !== NONE) for (const j of jewels) if (j.R && have.has(j.id) && j.in(id)) add.push(j.R[k]);
    const j = bySocket.get(id);
    if (j && !have.has(id)) { add.push(j.stats); if (j.R) for (const x of have) { const kx = kind(x); if (kx && j.in(x)) add.push(j.R[kx]); } }
    return add.length ? add.reduce(plus, plus({}, own)) : own;
  };
  const plain = Object.fromEntries(Object.entries(ATTR).map(([k, id]) => [k, tree.attribute_options[id]]));
  const sig = new Map(), sigOf = id => sig.get(id) ?? (sig.set(id, JSON.stringify(N[id].stats)), sig.get(id));
  let sum = { ...base }, left = points, cur = f(sum) || 0;
  const from = cur, nodes = [], attrs = {}, steps = [];
  while (left > 0 && !stop?.()) {
    // every passive within reach of the points left, and the way to it
    const dist = new Map([...have].map(u => [u, 0])), prev = new Map(), q = [...have];
    for (const j of jewels) if (have.has(j.id)) for (const x of j.free) if (!dist.has(x) && ok(x)) { dist.set(x, 1); q.push(x); }   // free passives: a point each, no way to them
    for (let i = 0; i < q.length; i++) {
      const u = q[i], d = dist.get(u); if (d >= left) continue;
      for (const w of N[u].links) { const s = String(w); if (!dist.has(s) && ok(s)) { dist.set(s, d + 1); prev.set(s, u); q.push(s); } }
    }
    const eps = 1e-9 * Math.max(1, Math.abs(cur));
    const gain = stats => f(plus({ ...sum }, stats)) - cur;
    // attribute passives: the attribute that helps most right now
    let attr = pref, best = eps;
    for (const a in plain) { const x = gain(plain[a]); if (x > best) { best = x; attr = a; } }
    // what each passive gives by itself (same stats, same answer)
    const memo = new Map(), own = new Map();
    for (const id of q) {
      if (!dist.get(id)) continue;
      const st = statsOf(id, attr), k = st === N[id].stats ? sigOf(id) : st === NONE ? '' : JSON.stringify(st);
      if (!memo.has(k)) memo.set(k, k === '' || k === '{}' ? 0 : gain(st));
      if (memo.get(k) > eps) own.set(id, memo.get(k));
    }
    // candidates: the way to each useful passive, then growing over useful passives next to it, best first
    let pick = null;
    const tried = new Set();
    const rate = ids => {
      const key = ids.length < 2 ? ids[0] : [...ids].sort().join();
      if (tried.has(key)) return; tried.add(key);
      const s = { ...sum }; for (const id of ids) plus(s, statsOf(id, attr));
      const g = f(s) - cur, r = g / ids.length;
      if (g > eps && (!pick || r > pick.r + eps || Math.abs(r - pick.r) <= eps && g > pick.g)) pick = { ids: [...ids], g, r };
    };
    for (const u of own.keys()) {
      const ids = []; for (let x = u; dist.get(x) > 0; x = prev.get(x)) ids.push(x);
      ids.reverse(); rate(ids);
      const set = new Set(ids), edge = new Map();
      const open = id => { for (const w of N[id].links) { const s = String(w); if (own.has(s) && !set.has(s) && !have.has(s)) edge.set(s, own.get(s)); } };
      ids.forEach(open);
      for (let k = 0; k < GROW && edge.size && ids.length < left; k++) {
        let top = null; for (const [id, x] of edge) if (top === null || x > edge.get(top)) top = id;
        edge.delete(top); set.add(top); ids.push(top); open(top); rate(ids);
      }
    }
    if (!pick) break;
    for (const id of pick.ids) {
      if (N[id].type === 'attribute' && !counted.has(id) && !b.attrs?.[id]) attrs[id] = attr;
      plus(sum, statsOf(id, attr)); have.add(id); nodes.push(id);
    }
    left -= pick.ids.length; cur = f(sum) || 0;
    steps.push({ ids: pick.ids, value: cur });
    await tick?.({ spent: points - left, left, value: cur });
  }
  return { nodes, attrs, from, to: cur, steps, stopped: !!stop?.() };
}

// ---------- support gems
const TOP = 22;   // supports that go into the combinations: the best by themselves, one per family
// supports that pay for what they give with when the skill can be used (a long cooldown, enough Combo, having moved
// first): more per use, not more per second, so they are left out unless asked for. Read from Path of Building's text.
const LIMITS = /gain a (long )?cooldown|can only be used|cannot be used (until|unless)/i;
export const limitsUse = name => LIMITS.test(SK.supports?.[name]?.text || '');

// The supports that raise objective `key` (dps / speed) of gem g of build b the most, for `sockets` sockets:
// every compatible support the data can calculate is tried alone, then every combination of the best ones, since
// their multipliers stack with each other. Game rules kept: supported skill types, one support per family in a
// skill, and (capacity: true) the support gem capacity the attributes give, minus what the other skills use.
// Returns { base, combos: [{ names, value }] (best first), singles: [{ name, value }], unknown (compatible supports
// without data to calculate), compatible, cap: {str,dex,int} sockets left per colour or null }, or { error }.
export function bestSupports({ b, g, sum, key = 'dps', sockets = g.sockets ?? 2, lineage = false, limited = false, capacity = true, keep = 3 }) {
  const G = GEM[g.name];
  if (!G || G.kind === 'support') return { error: 'Add a skill to the build first' };
  if (G.cannot_be_supported) return { error: 'Cannot be supported' };
  const f = names => score(key, b, sum, { ...g, supports: names });
  const base = f([]);
  if (base == null) return { error: skill({ ...g, supports: [] }, b, sum).reason || 'This skill does not deal direct damage' };
  const types = new Set(G.types || []);
  const fit = SUPPORTS.filter(s => canSupport(s, types) && (lineage || !s.lineage) && (limited || !limitsUse(s.name)));
  const known = fit.filter(s => supportKnown(s.name));
  const singles = known.map(s => ({ s, name: s.name, value: f([s.name]) })).filter(x => x.value != null && x.value > base * (1 + 1e-9)).sort((x, y) => y.value - x.value);
  // of a family (tiers I / II / III of one support) only the best can be used anyway
  const fams = new Set(), top = [];
  for (const x of singles) { const k = x.s.family.join() || x.name; if (!fams.has(k) && top.length < TOP) { fams.add(k); top.push(x); } }
  let cap = null;
  if (capacity) {
    const at = attributes(sum, b.asc), per = SK.support_capacity_per_attribute || 5;
    cap = Object.fromEntries(Object.keys(ATTR).map(k => [k, Math.floor(at[k] / per)]));
    for (const o of b.gems || []) if (o !== g && !o.meta && o.name !== g.meta) for (const n of o.supports || []) {   // a skill in a meta gem: its supports are the meta gem's
      const c = n && GEM[n] && colour(GEM[n]); if (c) cap[c]--; }
  }
  // every valid combination of up to `sockets` of them
  const combos = [], names = [], used = new Set(), need = { str: 0, dex: 0, int: 0 };
  const walk = from => {
    if (names.length) {
      const all = new Set([...types, ...names.flatMap(n => GEM[n].adds || [])]);   // a support may change the skill's types for the others
      if (all.size === types.size || names.every(n => canSupport(GEM[n], all))) { const value = f(names); if (value != null) combos.push({ names: [...names], value }); }
    }
    if (names.length >= sockets) return;
    for (let i = from; i < top.length; i++) {
      const s = top[i].s, c = colour(s);
      if (s.family.some(x => used.has(x)) || cap && c && need[c] >= cap[c]) continue;
      s.family.forEach(x => used.add(x)); if (c) need[c]++; names.push(s.name);
      walk(i + 1);
      names.pop(); if (c) need[c]--; s.family.forEach(x => used.delete(x));
    }
  };
  walk(0);
  combos.sort((x, y) => y.value - x.value || x.names.length - y.names.length);
  return { base, combos: combos.slice(0, keep), singles: singles.map(({ name, value }) => ({ name, value })), unknown: fit.length - known.length, compatible: fit.length, cap };
}
