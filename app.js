import { t, esc, tn, fmt, lang } from './i18n.js';
import { initScene } from './scene.js';
import { profile, chips } from './skillfx.js';
import { statLines, shownLines, NAMES } from './stats.js';
import { renderChar, skillTip } from './charpanel.js';
import { useSumOf, gemName, withConds, skill, withSupports, character, attributes, recovery, snapshot, QUESTS, questPick, questStats, requiredLevel, skillStats, auraStats, linkMetas, usedBy, byHand, reservation, rageOf, ailmentDefence, inc, GEM, tributeOf, subsOf, dealt, gemStats } from './calc.js';
import { PLACED, enemy, search as findEnemies, enemyStats, attacksOf, attackOf, versusPlayer, versusEnemy, RARITIES, rarityOf, MON_MODS, MAP, setMap, mapPlayer } from './enemies.js';
import { SLOTS, initItems, slotOpen, gearStats, wornItems, statsOf, radiusOf, itemView, setNames, flaskOf, charmOf, swapSet, pieceDef, isQuiver, isFocus, baseOf, known, parseWaystone, formsOf, radiusNamed, socketStats, SOCKETABLES, CHAKRA } from './items.js';
import { initSkills } from './skills.js';
import { initOpt } from './optview.js';
import { toughness } from './optimize.js';
import { initLoot } from './loot.js';
import { initSettings, watchUpdates, stored, put, ask } from './settings.js';
import { initFilter } from './filter.js';
import { SEARCH_SLOTS, siteQuery, listingQuery } from './trade.js';
import { diff, impactHtml } from './impact.js';
import { SK } from './skilldata.js';
import { encode, decode, toXML, fromXML, SITES, upload, download, toBuildFile, buildFileName } from './share.js';

const $ = id => document.getElementById(id);
const load = f => fetch('poe2_data/available/' + f).then(r => r.json());
const [tree, gems, ascs] = await Promise.all([load('passive_tree.json'), load('gems.json'), load('ascendancies.json')]);
const N = tree.nodes, NODE_BY_NAME = new Map(Object.entries(N).filter(([, n]) => !n.ascendancy).map(([id, n]) => [n.name, id]));
const ROOTS = new Set(tree.class_roots.map(String));
const label = tn;
// what jewels name by a number: a passive by its hash (Megalomaniac, From Nothing), a keystone by its index (Flesh
// Crucible), a skill (Prism of Belief)
setNames(N, label, tree.keystone_list || [], gems.filter(g => g.specific), tree.timeless?.overrides);
NAMES.passive_hash = h => N[h] ? label(N[h]) : tree.timeless?.overrides?.[h] && label(tree.timeless.overrides[h]);
NAMES.passive_keystone_index = i => N[tree.keystone_list?.[i - 1]] && label(N[tree.keystone_list[i - 1]]);
NAMES.specific_skill = i => { const g = gems.find(x => x.specific === i); return g && tn(g); };

// ---------- builds (localStorage; export/import as JSON files)
const KEY = 'poe2builds';
// the builds are also kept by the server in a file (serve.py do_backup), stamped with when they were saved: the
// window's storage once went back a week (WebView2 lost what it wrote), so at start the newer of the two is taken
const saved = await fetch('backup').then(r => r.ok ? r.json() : null).catch(() => null);
if (saved?.builds && saved.at > (+localStorage.getItem(KEY + ':at') || 0)) { put(KEY, saved.builds); put(KEY + ':at', String(saved.at)); }
let builds = stored(KEY);
if (!Object.keys(builds).length && (localStorage.getItem(KEY) || '{}') !== '{}') put(KEY + ':unread', localStorage.getItem(KEY));   // builds that cannot be read are kept aside, not written over by the first save
let cur;
// asc: the ascendancy, or the base class's name while none is chosen
const blank = () => ({ name: t('New build'), level: 1, asc: ascs[0].class, gems: [], nodes: [], ascNodes: [], notes: '' });
let rev = 0;   // goes up with every change to the builds: what is worked out from the build is kept until then
// undo / redo, per build: every save() keeps the build as it was (what is typed in a text box less than a second apart
// is one step)
const hist = {}, HIST_MAX = 100;
let shown = '', stepAt = 0;
let unsaved = false;   // the last save did not get into the storage: said once, until one does
let backupAt;
const store = () => {
  rev++;
  const at = Date.now(), ok = put(KEY, builds) && put(KEY + ':at', String(at));
  clearTimeout(backupAt); backupAt = setTimeout(() => fetch('backup', { method: 'POST', body: JSON.stringify({ at, builds }) }).catch(() => {}), 1000);
  if (!ok && !unsaved) ask(t('Your changes are not being saved: the storage of this window is full or closed to it. Export the build so they are not lost.'), t('Export')).then(i => { if (i === 0) openShare(true); });
  unsaved = !ok;
};
// the game data's date (poe2_data/available/version.json: when its tables were extracted): a build keeps the one it was last
// changed with, and says so while it is another (renderStats)
const DATA = (await fetch('poe2_data/available/version.json').then(r => r.json()).catch(() => ({}))).data;
const save = () => {
  if (B()) { linkMetas(B()); if (DATA) B().data = DATA; }
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
// A build is data from outside (a file, a shared code, Path of Building, what an older version saved) and its numbers
// and names end up in the page's markup: nothing in it keeps the characters that start markup, but its name and its
// notes, which are only ever shown as text; what the page walks through is a list, and its class one the game has.
// So are its passives, gems, pieces and their modifiers: what this version's data lacks (a patch took it away) is left out.
const GEM_NAMES = new Set(gems.map(g => g.name));
function clean(b) {
  const strip = o => { for (const k of Object.keys(o)) { const v = o[k]; if (/[<"]/.test(k)) delete o[k]; else if (typeof v === 'string') o[k] = v.replace(/[<"]/g, ''); else if (v && typeof v === 'object') strip(v); } };
  const { name, notes } = b;
  strip(b); b.name = String(name ?? ''); b.notes = String(notes ?? '');
  for (const k of ['nodes', 'ascNodes', 'set1', 'set2']) b[k] = Array.isArray(b[k]) ? b[k].filter(id => N[id]) : [];
  b.gems = Array.isArray(b.gems) ? b.gems.filter(g => GEM_NAMES.has(g?.name)) : [];
  for (const g of b.gems) g.supports = Array.isArray(g.supports) ? g.supports.map(n => GEM_NAMES.has(n) ? n : null) : [];
  for (const k of ['items', 'swap']) if (b[k] && typeof b[k] === 'object') { for (const s of Object.keys(b[k])) if (!known(b[k][s])) delete b[k][s]; } else delete b[k];
  if (b.stash) b.stash = Array.isArray(b.stash) ? b.stash.filter(known) : [];
  if (!ascs.some(a => a.name === b.asc || a.class === b.asc)) b.asc = ascs[0].class;
  return b;
}
{ const g = gems[0].name, n = Object.keys(N)[0];
  const b = clean({ name: 'a<"b', asc: '"><img>', gems: [{ name: g, level: '1"><img onerror=x>', supports: [g, 'gone'] }, { name: 'gone' }, 5], nodes: [n, 'gone'], ascNodes: 3, '<k': 1,
    items: { 'he"lm': {}, body: { base: '<b>' } }, stash: [{ base: 'gone' }], swap: 5 });
  console.assert(b.name === 'a<"b' && b.notes === '' && b.asc === ascs[0].class && JSON.stringify(b.gems) === JSON.stringify([{ name: g, level: '1>img onerror=x>', supports: [g, null] }])
    && b.nodes + '' === n && !b.ascNodes.length && !('<k' in b) && JSON.stringify(b.items) === '{}' && !b.stash.length && !('swap' in b), 'clean'); }
function select(id) {
  cur = id; rev++; put(KEY + ':last', id); if (B()) { linkMetas(clean(B())); fixSplit(B()); } shown = JSON.stringify(B() ?? null); undoBtns();
  renderSide(); drawTree(); renderItems?.();
  checkStart();
}
const B = () => builds[cur];
// another window of the app saved: this one goes on from the builds as they are now, instead of writing its older ones over them
addEventListener('storage', e => {
  const now = e.key === KEY && stored(KEY);
  if (!now || !Object.keys(now).length) return;
  builds = now; select(builds[cur] ? cur : Object.keys(builds)[0]); document.querySelector('nav button.on')?.click();
});
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
  seenItems.set(b, structuredClone({ items: b.items || {}, stash: b.stash }));
  b.gems.forEach(g => { g.level ??= 20; });  // builds saved before gem levels existed
  // builds of the same name (versions of one build) told apart by their level
  const names = Object.values(builds).map(x => x.name);
  $('buildList').innerHTML = Object.entries(builds).map(([id, x]) => `<option value="${id}" ${id === cur ? 'selected' : ''}>${esc(x.name)}${names.indexOf(x.name) !== names.lastIndexOf(x.name) ? ' · ' + t('Level {0}', x.level) : ''}</option>`).join('');
  $('pobAgain').hidden = !b.pob; if (b.pob) $('pobAgain').title = t('Import «{0}» again from Path of Building 2, with the changes made there', b.pob.split('#')[0]);
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
function nodeStats(id, b = B(), cq = conquest(b)) {
  const c = cq.get(id), n = N[id], a = (b.attrs || {})[id];
  if (c?.ks || c?.stats) return (c.ks || c).stats;   // what a timeless jewel turned it into: its conqueror's keystone, a passive
  const own = n.type === 'attribute' && a ? tree.attribute_options[ATTR[a][0]] : n.stats;  // game's hidden generic_attribute_* passives
  return c?.add ? plusStats({ ...own }, c.add) : own;   // ...or what it adds to it
}
const plusStats = (to, x) => { for (const k in x) to[k] = (to[k] || 0) + x[k]; return to; };
// A notable a timeless jewel's seed changes (conquest's tell): a right click asks which of its conqueror's notables the
// game shows there
async function tellConquest(id) {
  const b = B(), c = conquest(b).get(id), ver = c?.tell && statsOf(c.by).local_unique_jewel_alternate_tree_version;
  if (!c?.tell) return;
  const opts = Object.entries(TL.notables).filter(([, x]) => x.version === ver).sort((x, y) => label(x[1]).localeCompare(label(y[1])));
  const i = await ask(t('In the game, {1} turns {0} into:', label(N[id]), itemView(c.by).name), ...opts.map(([, x]) => label(x)), t('As on the tree'));
  if (i < 0) return;
  (b.conq ||= {})[c.tell] = opts[i]?.[0];
  save(); renderSide(); drawTree();
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
const PER_ATTR = [['keystone_iron_grip', 'str', 2, 'projectile_attack_damage_+%'], ['keystone_iron_will', 'str', 2, 'spell_damage_+%'],   // Irongrasp's Iron Grip and Iron Will: 1% per 2 Strength
  ['weapon_damage_+%_per_10_str', 'str', 10, 'attack_damage_+%'], ['attack_speed_+%_per_10_dex', 'dex', 10, 'attack_speed_+%'],
  ['attack_area_of_effect_+%_per_10_int', 'int', 10, 'attack_area_of_effect_+%'], ['attack_speed_+%_per_20_dex', 'dex', 20, 'attack_speed_+%'],
  ['area_of_effect_+%_per_20_int', 'int', 20, 'base_skill_area_of_effect_+%'], ['spell_damage_+%_per_10_int', 'int', 10, 'spell_damage_+%'],
  ['minimum_added_lightning_damage_to_attacks_per_20_intelligence', 'int', 20, 'attack_minimum_added_lightning_damage'], ['maximum_added_lightning_damage_to_attacks_per_20_intelligence', 'int', 20, 'attack_maximum_added_lightning_damage'],
  ['minimum_added_cold_damage_to_attacks_per_20_dexterity', 'dex', 20, 'attack_minimum_added_cold_damage'], ['maximum_added_cold_damage_to_attacks_per_20_dexterity', 'dex', 20, 'attack_maximum_added_cold_damage'],
  ['minimum_added_fire_damage_to_attacks_per_25_strength', 'str', 25, 'attack_minimum_added_fire_damage'], ['maximum_added_fire_damage_to_attacks_per_25_strength', 'str', 25, 'attack_maximum_added_fire_damage'],
  ['energy_shield_recharge_rate_+%_per_4_strength', 'str', 4, 'energy_shield_recharge_rate_+%'], ['base_life_regeneration_rate_per_minute_per_10_intelligence', 'int', 10, 'base_life_regeneration_rate_per_minute']];
function sumOf(b) {   // every stat of a build's passives (with the weapon set in use), gear, campaign rewards and buffs of its own
  const sum = questStats(b);
  for (const [k, v] of Object.entries(skillStats(b))) sum[k] = (sum[k] || 0) + v;
  // Titan's Hulking Form: increased effect of the small passives (attribute ones included)
  // with an anointed amulet's passive ("Allocates Cooked", items.js parseItem), unless the tree has it already
  const all = [...new Set([...b.nodes, ...b.ascNodes, ...setOf(b, b.wset || 1), ...Object.values(b.items || {}).flatMap(it => [it.anoint || []].flat().map(n => NODE_BY_NAME.get(n))).filter(Boolean), ...granted(b)])], small = 1 + all.reduce((t, id) => t + (N[id]?.stats?.['small_passives_effect_+%'] || 0), 0) / 100;
  const cq = conquest(b);
  for (const id of all) { const k = ['small', 'attribute'].includes(N[id]?.type) && !N[id].ascendancy ? small : 1; for (const [s, v] of Object.entries(nodeStats(id, b, cq))) sum[s] = (sum[s] || 0) + v * k; }
  // Necromantic Talisman: the amulet's bonuses are the minions' ("minion:<stat>", calc.js minionStats), not yours
  const NT = sum.minions_get_amulet_stats_instead_of_you && b.items?.amulet;
  for (const [k, v] of Object.entries(gearStats(Object.fromEntries(Object.entries(wornItems(b, sum) || {}).filter(([slot, it]) => (!slot.startsWith('jewel:') || sockOn(b).has(slot.slice(6)) && !(isPhyl(slot.slice(6)) && it.unique)) && slotOpen(slot, sum) && !(NT && slot === 'amulet')))))) sum[k] = (sum[k] || 0) + v;
  if (NT) for (const [k, v] of Object.entries(gearStats({ amulet: b.items.amulet }))) sum['minion:' + k] = (sum['minion:' + k] || 0) + v;
  // the Augments socketed in the equipment (it.socketed): Wisdom of the Maji's Bonded modifiers, Idolatry's per idol and
  // per other one; Runic Meridians' runes tattooed for a slot (b.chakra: { helmet: [names], ... }), as socketed there
  { const W = !!sum.ascendancy_shaman_gain_additional_socketable_mods; let idols = 0, others = 0;
    for (const [slot, it] of Object.entries(wornItems(b, sum) || {})) if (!slot.startsWith('jewel:') && slotOpen(slot, sum)) {
      const own = statsOf(it), r = socketStats(it, own); idols += r.idols; others += r.others;
      if (W) plusStats(sum, socketStats(it, own, true).stats); }
    if (sum.enable_chakras) for (const [slot, names] of Object.entries(b.chakra || {})) { const it = { socketed: names.filter(n => SOCKETABLES[n]?.kind === 'Rune') }, cls = CHAKRA[slot];
      if (cls) { plusStats(sum, socketStats(it, {}, false, cls).stats); if (W) plusStats(sum, socketStats(it, {}, true, cls).stats); } }
    plusStats(sum, { 'base_reservation_efficiency_+%': idols * (sum['reservation_efficiency_+%_of_skills_per_socketed_idol'] || 0), 'companion_damage_+%': idols * (sum['companion_damage_+%_per_socketed_idol'] || 0),
      'base_resist_all_elements_%': others * (sum['resist_all_elements_%_per_socketed_non_idol_augment'] || 0) }); }
  // Ritualist's Mystic Attunement: increased bonuses from the equipped rings and amulet. note: the whole of what they grant
  const JE = sum['equipped_jewellery_effect_of_bonuses_+%'];
  if (JE) for (const [k, v] of Object.entries(gearStats(Object.fromEntries(['ring1', 'ring2', 'ring3', 'amulet'].filter(s => b.items?.[s] && slotOpen(s, sum)).map(s => [s, b.items[s]]))))) sum[k] = (sum[k] || 0) + v * JE / 100;
  // Ingenuity: increased bonuses from the left / right ring (note: Ingenuity's own count too, as the jewellery above)
  for (const s of ['ring1', 'ring2']) { const RE = sum[`equipped_${s}_effect_of_bonuses_+%`]; if (RE && b.items?.[s]) for (const [x, v] of Object.entries(gearStats({ [s]: b.items[s] }))) sum[x] = (sum[x] || 0) + v * RE / 100; }
  // The Adorned: increased effect of the allocated jewel sockets holding a corrupted magic / rare jewel (note: the whole of what the jewel grants)
  for (const [slot, it] of Object.entries(b.items || {})) { const AD = it?.corrupted && slot.startsWith('jewel:') && sockOn(b).has(slot.slice(6)) && sum[`local_unique_jewel_passive_jewel_socket_mod_effect_+%_with_corrupted_${it.rarity}_jewel_socketed`]; if (AD) for (const [k, v] of Object.entries(gearStats({ [slot]: it }))) sum[k] = (sum[k] || 0) + v * AD / 100; }
  // Crystalline Phylactery: increased effect of the non-unique jewel in it
  for (const id of (b.ascNodes || []).filter(isPhyl)) { const it = b.items?.['jewel:' + id]; if (it && !it.unique) for (const [k, v] of Object.entries(gearStats({ ['jewel:' + id]: it }))) sum[k] = (sum[k] || 0) + v * isPhyl(id) / 100; }
  // increased bonuses gained from the equipped Quiver (the whole of what it grants), Instruments of Power's less of a Focus's
  const Q = b.items?.offhand, QE = isQuiver(Q) ? sum['quiver_mod_effect_+%'] : isFocus(Q) ? sum['focus_mod_effect_+%'] : 0;
  if (QE) for (const [k, v] of Object.entries(gearStats({ offhand: Q }))) sum[k] = (sum[k] || 0) + v * QE / 100;
  // a radius jewel in an allocated socket: its modifiers once for each small / notable passive allocated within its
  // radius (or ring) of the socket. note: attribute passives counted as small ones (they are no notables)
  for (const j of jewelsOf(b)) {
    if (!j.R) continue;
    const n = { small: 0, notable: 0 };
    for (const id of new Set([...b.nodes, ...setOf(b, b.wset || 1)])) { const k = radKind(id); if (k && j.in(id)) n[k]++; }
    for (const k of ['small', 'notable']) for (const [s, v] of Object.entries(j.R[k])) sum[s] = (sum[s] || 0) + v * n[k];
  }
  // Grand Spectrum: its increased life once for each Grand Spectrum socketed
  if (sum['maximum_life_+%_per_stackable_unique_jewel']) sum['maximum_life_+%'] = (sum['maximum_life_+%'] || 0) + sum['maximum_life_+%_per_stackable_unique_jewel'] * (sum.number_of_stackable_unique_jewels || 0);
  // Smith of Kitava: what the passives say the body armour grants, while one is worn; their hidden armour
  if (b.items?.body) for (const [k, to] of BODY_GRANTS) if (sum[k]) sum[to] = (sum[to] || 0) + sum[k];
  sum.base_physical_damage_reduction_rating = (sum.base_physical_damage_reduction_rating || 0) + (sum.base_physical_damage_reduction_rating_no_display || 0)
    + pieceDef(b.items, 'body', 'armour') * (sum['ascendancy_titan_damage_reduction_rating_from_body_armour_+%_final'] || 0) / 100;   // Titan's Stone Skin: more armour from the body armour
  // Greatest Defence / Spiked Shield: increased attack damage per 75 armour and evasion on the shield
  if (sum['attack_damage_+%_per_75_armour_or_evasion_on_shield']) sum['attack_damage_+%'] = (sum['attack_damage_+%'] || 0) + sum['attack_damage_+%_per_75_armour_or_evasion_on_shield'] * Math.floor((pieceDef(b.items, 'offhand', 'armour') + pieceDef(b.items, 'offhand', 'evasion')) / 75);
  // Amazon's Stalking Panther: evasion of the helmet, gloves and boots doubled, the body armour's halved
  if (sum.double_evasion_rating_from_gloves_helmets_boots) sum.base_evasion_rating = (sum.base_evasion_rating || 0) + ['helmet', 'gloves', 'boots'].reduce((t, s) => t + pieceDef(wornItems(b, sum), s, 'evasion'), 0);
  if (sum.halve_evasion_rating_from_body) sum.base_evasion_rating = (sum.base_evasion_rating || 0) - pieceDef(b.items, 'body', 'evasion') / 2;
  // uniques' stats per so many points of an attribute (Pillar of the Caged God, Hand of Wisdom and Action, Brutus' Lead
  // Sprinkler, The Whispering Ice, Tetzlapokal's Desire, Geofri's Sanctuary): as the stat they give, for the attribute
  // you have. note: Pillar's "increased Weapon Damage" counted as attack damage
  const PA = PER_ATTR.filter(([k]) => sum[k]), at = PA.length && attributes(sum, b.asc);
  for (const [k, a, n, to] of PA) sum[to] = (sum[to] || 0) + sum[k] * Math.floor((at[a] || 0) / n);
  for (const [k, v] of Object.entries(auraStats(b, sum))) sum[k] = (sum[k] || 0) + v;   // after the rest: their level and magnitude come from it
  // Tribute (Undying Hate's conquered passives, base_tribute and its increase): the stats given per so much of it, or
  // with at least so much ("2% increased Mana Recovery rate per 10 Tribute", "+1% to all Maximum Resistances if you have
  // at least 100 Tribute"), as the stat they name
  const trib = tributeOf(sum);
  for (const [k, v] of Object.entries(sum)) { const m = k.match(/^(.+)_(per|if_you_have_at_least)_(\d+)_tribute$/);
    if (m) sum[m[1]] = (sum[m[1]] || 0) + v * (m[2] === 'per' ? Math.floor(trib / m[3]) : trib >= m[3] ? 1 : 0); }
  return withConds(sum, b.conds);   // the states the player says hold (the conditions panels): not in the simulator, which checks them itself
}
const treeSum = () => sumOf(B()), rawSum = () => sumOf({ ...B(), conds: null });
useSumOf(sumOf);
// where a build's stats come from, for the panels' breakdowns: the campaign, the skills' buffs, the tree, the ascendancy,
// each worn item (with its own armour, evasion, energy shield); Other: what sumOf adds on top (effects of other bonuses,
// radius jewels, small passives' increased effect, the conditions ticked)
function sourcesOf(b) {
  const sum = sumOf(b), cq = conquest(b), nodes = ids => ids.reduce((o, id) => plusStats(o, nodeStats(id, b, cq)), {}), worn = wornItems(b, sum) || {};
  const S = [[t('Campaign rewards'), questStats(b)], [t('Skills'), plusStats({ ...skillStats(b) }, auraStats(b, sum))],
    [t('Passive tree'), nodes([...new Set([...b.nodes, ...setOf(b, b.wset || 1)])])], [t('Ascendancy'), nodes(b.ascNodes || [])],
    ...Object.entries(worn).map(([slot, it]) => [t(SLOTS[slot] || 'Jewel') + (it.name ? ` (${it.name})` : ''), gearStats({ [slot]: it }), { base_physical_damage_reduction_rating: pieceDef(worn, slot, 'armour'),
      base_evasion_rating: pieceDef(worn, slot, 'evasion'), base_maximum_energy_shield: pieceDef(worn, slot, 'energy_shield') }])];   // the piece's own: calc.js reads it apart from the stats
  const known = S.reduce((o, [, st]) => plusStats(o, st), {}), other = {};
  for (const x of S) if (x[2]) plusStats(x[1] = { ...x[1] }, x[2]);
  for (const k in sum) if (Math.abs((sum[k] || 0) - (known[k] || 0)) > .001) other[k] = sum[k] - (known[k] || 0);
  return [...S, [t('Other'), other]];
}
// the stats behind a number of the panels (data-why): the bonuses as they are, not the ones that need a state, nor the
// minions', the enemies', the requirements
const NOT_WHY = /minion|companion|totem|all(?:y|ies)|enem|requirement|penetrat|break|taken|_(?:per|on|when|while|if|during|vs|against|for|with)_|recently/;
const WHY = { life: k => /maximum_life/.test(k), mana: k => /maximum_(?:life_)?mana/.test(k), es: k => /energy_shield/.test(k) && !/recharge|delay|regen|recover|leech|sacrific|bypass/.test(k),
  spirit: k => /spirit/.test(k), armour: k => /(?<!body_)armour|physical_damage_reduction_rating/.test(k) && !/movement/.test(k), evasion: k => /evasion/.test(k), block: k => /block/.test(k),
  ...Object.fromEntries(['fire', 'cold', 'lightning', 'chaos'].map(e => [e, k => /resist/.test(k) && (k.includes(e) || e !== 'chaos' && /elemental|all_elements/.test(k))])),
  ...Object.fromEntries([['str', 'strength'], ['dex', 'dexterity'], ['int', 'intelligence']].map(([a, w]) => [a, k => (k.includes(w) || /all_attributes/.test(k)) && !/level/.test(k)])),
  dps: k => /damage|attack_speed|cast_speed|skill_speed|critical_strike|critical_hit/.test(k) && !/movement|projectile_speed|reflect|recoup|leech|resist|reduction/.test(k) };
const whyOf = what => sourcesOf(B()).map(([label, st]) => [label, shownLines(Object.fromEntries(Object.entries(st).filter(([k, v]) => v && !NOT_WHY.test(k) && WHY[what](k))))])
  .filter(([, L]) => L.length).map(([label, L]) => `${label}:\n  ${L.join('\n  ')}`).join('\n');
// worked out on hovering (not at every drawing): after the title the number had
document.addEventListener('mouseover', e => { const x = e.target.closest?.('[data-why]'); if (!x || x.dataset.whyAt) return;
  const W = WHY[x.dataset.why] && whyOf(x.dataset.why); x.dataset.whyAt = 1; if (W) x.title = (x.title ? x.title + '\n\n' : '') + t('Where it comes from') + ':\n' + W; });
// Scene geometry in metres (game units / 10). Everything comes from skills.json + the tree, except values the game data lacks.
function geo(g) {
  const d = SK.skills[g.name] || {}, gm = GEM[g.name], tags = [...gm?.tags || d.tags || [], ...g.name === 'Parry' ? ['parry'] : [], ...gm?.types?.includes('Offering') ? ['offering'] : []], T = { ...treeSum() };   // Parry's hit area (parry_area_of_effect_+%)
  for (const [k, n] of Object.entries(g.add || {})) T[k] = (T[k] || 0) + n;   // a buff the scene has on (g.add)
  const LR = T['light_radius_additive_modifiers_apply_to_area_%_value'];   // Cornathaum: increased Light Radius as area of effect at its share
  if (LR) T['base_skill_area_of_effect_+%'] = (T['base_skill_area_of_effect_+%'] || 0) + (T['light_radius_+%'] || 0) * LR / 100;
  const FX = T['unarmed_attack_area_of_effect_+1%_per_X_intelligence'], b0 = B();   // Facebreaker: unarmed attacks' area per X Intelligence
  if (FX && !b0.items?.weapon && tags.includes('attack')) T['attack_area_of_effect_+%'] = (T['attack_area_of_effect_+%'] || 0) + Math.floor((character(b0, T).attrs?.int || 0) / FX);
  const { sum, finals } = withSupports(g, T), gs = gemStats(g, sum), own = [...Object.entries(finals), ...Object.entries(gs)];  // supports' area / speed count; the gem's own (its quality's too)
  // the supports' more / less area (Concentrated Area 50% less, Echoing Cry, Spell Cascade...; not Branching Fissures', only its branches')
  const moreArea = own.reduce((m, [k, v]) => (k.endsWith('area_of_effect_+%_final') || k === 'support_astral_projection_aoe_+%_final') && !k.startsWith('branching_fissure') ? m * (1 + v / 100) : m, 1 + (d.levels?.[g.level]?.['area_of_effect_+%_final_from_whirling_assault_level'] || 0) / 100);   // Whirling Assault's own, by its level
  const R = Object.values(d.radius || {}), AOE = 'active_skill_base_area_of_effect_radius', P = d.parts?.[g.part], r0 = P ? (P.levels?.[g.level] || {})[AOE] ?? P.constant?.[AOE] : d.radius?.[g.level] ?? (R.length === 1 ? R[0] : undefined);   // a single-level skill (Mana Flare) at any gem level; a part's own (the skills tab)
  const base = r0 != null && !P ? r0 + (gs[AOE] || 0) - ((d.levels?.[gs._level] || d.levels?.[g.level] || {})[AOE] ?? d.constant?.[AOE] ?? 0) : r0;   // and its quality's (Leylines, Infernal Cry)
  const moreSpeed = own.reduce((m, [k, v]) => k.endsWith('projectile_speed_+%_final') && !k.includes('randomise') ? m * (1 + v / 100) : m, 1);   // Projectile Acceleration / Deceleration
  const rad = b => b ? Math.floor(b * Math.sqrt(Math.max(0, (1 + (inc(sum, 'area_of_effect_+%', tags) + inc(gs, 'area_of_effect_+%', tags)) / 100) * moreArea))) / 10 : 0;
  const speed = d.projectile_speed && d.projectile_speed * (1 + (inc(sum, 'projectile_speed_+%', tags) + inc(gs, 'projectile_speed_+%', tags) + (tags.includes('bow') ? sum['base_arrow_speed_+%'] || 0 : 0)) / 100) * moreSpeed / 10;
  return {
    radiusFromData: base != null,
    // area modifiers scale area, so radius scales with the square root, in whole game units (the game's window:
    // Cluster Grenade 25 x sqrt(1.24) = 27.8 -> 2.7 m)
    radius: base != null ? rad(base) : 0,
    // its secondary radius (a storm's area, Firestorm's; or its strikes', Thunderstorm's), with the same modifiers
    radius2: rad(gs.active_skill_base_secondary_area_of_effect_radius),
    speed,
    // range: skill override, else speed × duration, else 150 units (GGG: default max projectile distance)
    range: d.projectile_range ? d.projectile_range / 10 : d.duration_ms && speed ? speed * d.duration_ms / 1000 : 15,
    collision: (d.projectile_collision || 0) / 10,
    duration: (d.duration_ms || 0) / 1000,
  };
}
const playerSpeed = (more = 0) => SK.player_base_speed * (1 + ((rawSum()['base_movement_velocity_+%'] || 0) + more) / 100) / 10;   // more: a Banner's
let vsId = null;   // the build the character panel compares this one with
function renderStats() {
  const b = B();
  const pending = b.nodes.filter(id => N[id].type === 'attribute' && !(b.attrs || {})[id]).length; // game text always says "+5", so count them
  const points = Math.max(0, b.nodes.length - 1);  // the class start node is free
  // Manual: the level typed in the panel or imported with the build; Auto: the one the points need (Path of Building 2)
  const need = requiredLevel(points);
  b.level = b.lvl || need;
  const sum = treeSum();   // after the level: the campaign rewards counted by default go by it
  renderPoints(b); if ($("treeFind").value) search();   // ascendancy may have changed what is visible
  if (!builds[vsId] || vsId === cur) vsId = null;
  renderChar($('charPanel'), b, sum, { asc: b.asc, cls: clsOf(b.asc), points, need, pending, picking,
    others: Object.entries(builds).filter(([id]) => id !== cur).map(([id, x]) => [id, x.name]), vsId, vs: vsId && { b: builds[vsId], sum: sumOf(builds[vsId]) },
    classes: CLASSES, ascOptions: [clsOf(b.asc), ...ascs.filter(a => a.class === clsOf(b.asc)).map(a => a.name)], portrait: portraitOf(b.asc),
    ascLabel: x => CLASSES.includes(x) ? t('No ascendancy') : tn(ascs.find(a => a.name === x)) || x, clsLabel });
  if (b.data && DATA && b.data !== DATA) $('charPanel').insertAdjacentHTML('afterbegin', `<p class="disc">${esc(t('This build was last changed with the game data of {0}, and this app has that of {1}: what a patch changed may count differently. Your next change takes it to this data.', b.data, DATA))}</p>`);
}
// lower half of the side panel in the 3D scene: the build's skills with how the scene draws them
const gemImg = p => p ? 'poe2_data/available/img/' + p.toLowerCase().replace(/\.dds$/, '.webp') : '';
// a support's triggered skill (SK.skills[id].triggered_by) has no gem: its own name and types, the support's icon
const gemInfo = g => { const d = SK.skills[g.name], gem = GEM[g.name] || d?.triggered_by && { ...d, icon: GEM[d.triggered_by]?.icon }; return { gem, data: d || {}, label: g.spectre ? gemName(g) : tn(gem) || g.name, icon: gemImg(gem?.icon), buff: gemImg(gem?.buff_icon) }; };
// enemy of the 3D scene (not part of a build): the monster the clicks place, its level (0 = the level of the build) and its attack
const SCENE_KEY = 'poe2scene';
// and its map: { tier, mods: { id: [values] } } of a waystone's modifiers (enemies.js MAP), null when there is none
const sceneCfg = (({ enemy = null, level = 0, attack = null, rarity = null, still = false, fight = false, map = null }) => ({ enemy, level, attack, rarity, still, fight,
  map: MAP.tiers[map?.tier - 1] && map.mods && typeof map.mods === 'object' ? { tier: map.tier, mods: Object.fromEntries(Object.entries(map.mods).filter(([id, v]) => Array.isArray(v) && MAP.mods.some(m => m.id === id))) } : null }))(stored(SCENE_KEY));
// the map's modifiers on players, added to the build's stats in the simulator alone (the monsters' are enemies.js's)
setMap(sceneCfg.map);
let mapSelf = mapPlayer(sceneCfg.map);
const simSum = () => { const s = rawSum(); for (const k in mapSelf) s[k] = (s[k] || 0) + mapSelf[k]; return s; };
// damage of each skill of the build (calc.js), shared by the cards, the enemy panel and the scene until the build changes
const dmgCache = new Map();
const skillDmg = g => { let s = dmgCache.get(g); if (!s) dmgCache.set(g, s = skill(g, { ...B(), conds: null }, rawSum())); return s; };   // the scene checks the conditions on each hit: not the planner's
// the scene's: with the map's less Cooldown Recovery Rate of players (a more / less of its own, so the cooldown divided by it)
const simCd = new WeakMap(), simDmg = g => { const s = skillDmg(g), k = mapSelf['map_player_cooldown_speed_+%_final']; if (!k || !s?.cooldown) return s;
  let o = simCd.get(s); if (o?.k !== k) simCd.set(s, o = { k, s: { ...s, cooldown: s.cooldown / Math.max(.01, 1 + k / 100) } }); return o.s; };
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
  tip.innerHTML = skillTip(GEM[g.name] || {}, g, B(), treeSum(), geo);
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
$('buildList').onchange = e => select(e.target.value);
$('newBuild').onclick = () => { const id = String(Date.now()); builds[id] = blank(); save(); select(id); };
$('pobAgain').onclick = () => openShare(false, B().pob.split('#')[0] + '.xml');
$('dupBuild').onclick = () => { let id = Date.now(); while (builds[id]) id++; builds[id] = { ...structuredClone(B()), name: t('{0} (copy)', B().name) }; save(); select(String(id)); };
$('delBuild').onclick = async () => {
  if (await ask(t('Delete the build «{0}»? This cannot be undone.', B().name), t('Delete')) !== 0) return;
  delete builds[cur]; if (!Object.keys(builds).length) builds[Date.now()] = blank();
  save(); select(Object.keys(builds)[0]);
};
// several builds deleted at once: each with its class, level and the day it was made, ticked to go
$('delMany').onclick = () => {
  const d = document.createElement('div');
  d.className = 'ask';
  d.innerHTML = `<div class="pick"><button class="close" data-a="close">✕</button>${Object.entries(builds).map(([id, x]) => `<label><input type="checkbox" value="${id}"> ${esc(x.name)} <small>${esc(tn(ascs.find(a => a.name === x.asc)) || clsLabel(x.asc))} · ${t('Level {0}', x.level)} · ${new Date(+id).toLocaleDateString()}</small></label>`).join('')}
    <button data-a="go" disabled></button></div>`;
  const go = d.querySelector('[data-a=go]'), ticked = () => [...d.querySelectorAll(':checked')].map(c => c.value);
  const count = () => { go.textContent = t('Delete the selected ({0})', ticked().length); go.disabled = !ticked().length; };
  count(); d.onchange = count;
  d.onclick = async e => {
    if (e.target === d || e.target.dataset.a === 'close') return d.remove();
    if (e.target !== go) return;
    const ids = ticked();
    if (await ask(t('Delete {0} builds? This cannot be undone.', ids.length), t('Delete')) !== 0) return;
    d.remove(); ids.forEach(id => delete builds[id]);
    if (!Object.keys(builds).length) builds[Date.now()] = blank();
    if (!builds[cur]) cur = Object.keys(builds)[0];
    select(cur); save();
  };
  document.body.append(d);
};
// character panel: name, base class and ascendancy are edited in place
$('charPanel').onchange = e => {
  const d = e.target.dataset;
  if (d.act === 'vs') { vsId = e.target.value || null; renderStats(); if (!$('skills').hidden) renderSkills(); return; }
  if (d.act === 'name') edit((e, b) => b.name = e.target.value.trim() || t('New build'))(e);
  if (d.act === 'level') edit((e, b) => { const v = Math.round(+e.target.value); if (v >= 1) b.lvl = Math.min(100, v); else delete b.lvl; })(e);
  if (d.cond) edit((e, b) => { const C = b.conds ||= {}; if (e.target.checked) C[d.cond] = 1; else delete C[d.cond]; })(e);   // a condition of the character's (charpanel.js)
  if (d.quest) edit((e, b) => (b.quests ||= {})[d.quest] = e.target.type === 'checkbox' ? +e.target.checked : +e.target.value)(e);
};
$('charPanel').onclick = async e => {
  if (e.target.dataset.act === 'lvlmode') return edit((e, b) => { if (b.lvl) delete b.lvl; else b.lvl = b.level; })(e);   // Auto <-> Manual
  const el = e.target.closest('[data-pick], [data-cls], [data-asc]'); if (!el) return;
  if (el.dataset.pick) { picking = picking === el.dataset.pick ? null : el.dataset.pick; renderStats(); return; }
  picking = null;
  const b = B();
  if (el.dataset.asc) {
    if (el.dataset.asc === b.asc) renderStats(); else edit((_, b) => { b.asc = el.dataset.asc; b.ascNodes = []; setNodes(b, prune(b.nodes, b)); })(e);
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
  edit((_, b) => { const had = [...b.nodes, ...b.ascNodes]; b.asc = asc; b.ascNodes = []; setNodes(b, prune(nodes, b)); relock(b, had); })(e);
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
// a Split Personality read before its class start was (as the Sorceress's, whatever it said): the form with which the
// tree hangs together, when with the one it has part of it hangs from nothing
function fixSplit(b) {
  const whole = () => prune(b.nodes, b).length === b.nodes.length;
  if (!whole()) for (const it of Object.values(b.items || {})) for (const m of it.mods || []) { const was = m.id;
    if (formsOf(was).some(f => (m.id = f.id, whole()))) return; m.id = was; }
}
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
  else if (d.enmod) { const L = (sceneCfg.mods || []).filter(x => x !== d.enmod); sceneCfg.mods = e.target.checked ? [...L, d.enmod] : L; saveScene(); syncEnemy(); renderEnemy(); }   // a magic or rare enemy's modifiers
  else if (d.map === 'tier') pickTier(+e.target.value);
  else if (d.mapmod) { const m = MAP.mods.find(x => x.id === d.mapmod), mods = { ...sceneCfg.map.mods }; if (e.target.checked) mods[m.id] = topRoll(m, sceneCfg.map.tier); else delete mods[m.id]; setSceneMap({ ...sceneCfg.map, mods }); }
  else if (d.mapval) { const [id, k] = d.mapval.split(':'), vals = [...sceneCfg.map.mods[id]]; vals[k] = Math.round(+e.target.value) || 0; setSceneMap({ ...sceneCfg.map, mods: { ...sceneCfg.map.mods, [id]: vals } }); }
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
  if (e.target.dataset.map === 'clear') return setSceneMap(null);
  const c = !e.target.closest('input, select, label, summary') && e.target.closest('[data-card]');
  if (c) { scene3d.select(+c.dataset.card); markCard(+c.dataset.card); }
};
const markCard = i => { document.querySelectorAll('#sceneSkills .sk-card').forEach(c => c.classList.toggle('on', +c.dataset.card === i)); renderEnemy(); };
// ---------- share: Path of Building 2 code, build sites, JSON file
const shareCtx = () => ({ stats: b => character(b, treeSum()), N, gems, ascs, clsOf, ascStart, classRoot, roots: ROOTS, maxSockets: SK.max_support_sockets || 5, quests: QUESTS, questPick });
// what makes two builds the same one, whatever their name: an import of a build that is already here opens that one
// instead of adding a copy (clicking Import again, or the same Path of Building file twice, used to pile them up)
const canon = x => Array.isArray(x) ? '[' + x.map(canon).join() + ']' : x && typeof x === 'object' ? '{' + Object.keys(x).sort().map(k => k + ':' + canon(x[k])).join() + '}' : JSON.stringify(x ?? null);
const sig = b => canon([b.asc, [...b.nodes].sort(), [...(b.ascNodes || [])].sort(), (b.gems || []).map(g => [g.name, +g.level || 0, (g.supports || []).filter(Boolean)]), b.items || {}, b.attrs || {}]);
// what an update brought, said in a line: level, passives taken and dropped, skills and supports, items
function changes(a, b) {
  const out = [], gl = n => tn(gems.find(g => g.name === n)) || n, minus = (x, y) => x.filter(v => !y.includes(v));
  if (a.level !== b.level) out.push(t('Level {0} → {1}', a.level, b.level));
  const pa = [...a.nodes, ...a.ascNodes], pb = [...b.nodes, ...b.ascNodes], up = minus(pb, pa).length, down = minus(pa, pb).length;
  if (up || down) out.push(t('Passives: +{0} −{1}', up, down));
  const ga = a.gems.map(g => g.name), gb = b.gems.map(g => g.name);
  if (minus(gb, ga).length) out.push(t('New skills: {0}', minus(gb, ga).map(gl).join(', ')));
  if (minus(ga, gb).length) out.push(t('Skills removed: {0}', minus(ga, gb).map(gl).join(', ')));
  const sup = b.gems.filter(g => { const o = a.gems.find(x => x.name === g.name); return o && canon(o.supports.filter(Boolean).sort()) !== canon(g.supports.filter(Boolean).sort()); });
  if (sup.length) out.push(t('Other supports on: {0}', sup.map(g => gl(g.name)).join(', ')));
  const ia = a.items || {}, ib = b.items || {}, items = [...new Set([...Object.keys(ia), ...Object.keys(ib)])].filter(s => canon(ia[s]) !== canon(ib[s])).length;
  if (items) out.push(t('Items changed: {0}', items));
  return out.join(' · ');
}
const addBuild = b => {
  const same = Object.keys(builds).find(id => sig(builds[id]) === sig(b));
  if (same) { select(same); return builds[same]; }
  let n = Date.now(); while (builds[n]) n++; const id = String(n); builds[id] = b; save(); select(id); return null;
};
// one panel, with what the header button asked for: taking a build in, or giving this one out
// again: a Path of Building file to import at once (Update from Path of Building)
const openShare = async (exporting, again) => {
  const d = document.createElement('div');
  d.className = 'ask'; d.id = 'sharePanel';
  const code = exporting ? await encode(toXML(B(), shareCtx())) : '';
  d.innerHTML = `<div><button class="close" data-a="close">✕</button>${exporting ? `
    <h3>${t('Export')}</h3>
    <p class="note">${t('Path of Building 2 code: paste it in Path of Building (Import/Export Build) or on any of these sites.')}</p>
    <textarea rows="3" readonly data-code>${code}</textarea>
    <div class="row"><button data-a="copy">${t('Copy code')}</button>${SITES.map(s => `<button data-up="${s.id}">${t('Link on {0}', s.name)}</button>`).join('')}
      <button data-a="json">${t('JSON file')}</button><button data-a="all" title="${t('Every build in one JSON file: JSON file in Import brings them all back, next to the ones you have.')}">${t('All builds (backup)')}</button></div>
    <div class="msg" data-out></div>
    <h3>${t('The game')}</h3>
    <p class="note">${t('Since 0.5 the in-game build planner loads .build files: save it in Documents/My Games/Path of Exile 2/BuildPlanner. It carries the tree, the ascendancy and the gems with their supports; gem levels and gear go in as notes.')}</p>
    <div class="row"><button data-a="game">${t('.build file for the game')}</button></div>` : `
    <h3>${t('Import')}</h3>
    <textarea rows="3" data-in placeholder="${t('Paste a Path of Building code or a link (pobb.in, poe.ninja, Maxroll, poe2db, pastebin, rentry)')}"></textarea>
    <div class="row"><button data-a="import">${t('Import as a new build')}</button><button data-a="file">${t('JSON file')}</button><select data-pob hidden></select></div>
    <div class="msg" data-inmsg></div>
    <p class="note">${t("Why Path of Building 2: your Path of Exile account can only be connected to official programs authorised by Grinding Gear Games, and GGG is not accepting requests from new programs to use that feature at the moment, so this app cannot read your characters by itself. Path of Building 2 is authorised: import your character there (Import/Export Build, Import from website) and save it: it shows up in the list above, or copy its code and paste it here.")}
      <a href="https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2/releases/latest" target="_blank" rel="noopener">${t('Download Path of Building 2')}</a></p>
    <p class="note">${t('To bring your gear here, hover an item in the game, press Ctrl+C and paste it in Equipment. Copy (⧉) on an item gives its text for Path of Building and trade sites.')}</p>`}</div>`;
  const out = d.querySelector('[data-out]'), inmsg = d.querySelector('[data-inmsg]');
  // the builds saved in Path of Building 2 on this computer (serve.py lists them): picking one imports it. That is how a
  // character of the account gets here, the game's site hands them to registered programs only
  const pob = d.querySelector('[data-pob]');
  if (pob) fetch('pob').then(r => r.ok ? r.json() : []).catch(() => []).then(names => {
    if (again && !names.includes(again)) inmsg.textContent = t('«{0}» is not among the builds of Path of Building 2 on this computer.', again.replace(/\.xml$/i, ''));
    if (!names.length) return;
    pob.innerHTML = `<option value="">${t('From Path of Building 2 on this computer…')}</option>` + names.map(n => `<option value="${esc(n)}">${esc(n.replace(/\.xml$/i, ''))}</option>`).join('');
    pob.hidden = false;
    if (names.includes(again)) { pob.value = again; pob.onchange(); }
  });
  // a build from Path of Building's XML; one picked there goes by its file's name, the one it was saved under
  // a build's skills in the order of the game's skill panel (serve.py pob?order), when that answer is this character's
  // (the same skill gems); a gem a meta gem holds (Cluster Grenade in Mortar Cannon) stays right after it
  const inGameOrder = (b, order) => {
    const top = b.gems.filter(g => !g.meta).map(g => g.name), at = n => order.indexOf(n), groups = [];
    if (top.length !== order.length || !top.every(n => order.includes(n))) return;
    for (const g of b.gems) if (g.meta && groups.length) groups.at(-1).push(g); else groups.push([g]);
    b.gems = groups.sort((x, y) => at(x[0].name) - at(y[0].name)).flat();
  };
  const importXML = (xml, name, order) => {
    const ctx = shareCtx(), { build, warn, specs, active } = fromXML(xml, ctx, blank);
    if (name) build.name = name;
    // one from a Path of Building file replaces the build that came from that file (the newest, if several; before builds
    // kept their file, the one of the same name), so changing it there and importing it again updates it; Undo brings it back
    let upd = false, what = '';
    const put = (o, key) => {
      if (order?.length) inGameOrder(o, order);
      if (!name) return addBuild(o);
      o.pob = key;
      const id = Object.keys(builds).filter(k => builds[k].pob === key || !builds[k].pob && builds[k].name === o.name).sort((x, y) => y - x)[0];
      if (!id) return addBuild(o);
      if (sig(builds[id]) === sig(o)) { select(id); return builds[id]; }
      what = changes(builds[id], clean(structuredClone(o)));
      select(id); builds[id] = o; save(); select(id); upd = true; return null;
    };
    // Path of Building's other trees (levelling stages, other versions): each a build of its own, the open one last (shown)
    specs.forEach((title, i) => { if (i === active) return; const o = fromXML(xml, ctx, blank, i).build; o.name = `${build.name} — ${title || t('Tree') + ' ' + (i + 1)}`; put(o, name + '#' + i); });
    const had = put(build, name); d.querySelector('[data-in]').value = '';
    if (had) return void (inmsg.textContent = t('This build is already here: «{0}». It is open.', had.name));
    if (upd) return void (inmsg.textContent = t('«{0}» updated from Path of Building. Undo brings back how it was.', build.name) + (what && ' ' + what));
    inmsg.textContent = (warn.length ? t('Imported. Not understood ({0}): {1}', warn.length, warn.join(' · ')) : t('Imported.')) + (specs.length > 1 ? ' ' + t('Each of its {0} trees is a build of its own.', specs.length) : '');
  };
  if (pob) pob.onchange = async () => {
    if (!pob.value) return;
    try { importXML(await (await fetch('pob?name=' + encodeURIComponent(pob.value))).text(), pob.value.replace(/\.xml$/i, ''), await fetch('pob?order').then(r => r.ok ? r.json() : []).catch(() => [])); }
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
    if (a === 'all') await save(JSON.stringify({ builds: Object.values(builds) }), 'Exilewright-builds-' + new Date().toISOString().slice(0, 10) + '.json', 'json');
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
        out.innerHTML = `${t('Link copied:')} ${/^https?:\/\//.test(url) ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>` : esc(url)}`;   // a link only to a web page
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
  const x = JSON.parse(await e.target.files[0].text());   // one build, or a backup of all of them ({ builds: [...] }): added to the ones there are
  for (const b of Array.isArray(x?.builds) ? x.builds : [x]) if (b && typeof b === 'object') addBuild({ ...blank(), ...b });   // one already here is not added again
  e.target.value = ''; document.getElementById('sharePanel')?.remove();
};

// ---------- passive tree (canvas 2D), drawn like the in-game tree
const cv = $('treeCanvas'), ctx = cv.getContext('2d');
const R = { keystone: 111, notable: 76.5, jewel: 76.5, attribute: 51.5, small: 51.5, root: 104 };   // half the size of the game's frame of each (img/tree), in world units
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
// what of the tree is a build's to see: not the passives the game shows to one ascendancy alone (only_for: the Oracle's
// own) for another, nor the ones only ever granted (granted: Voices' Sinister sockets, the notables of an anointment),
// unless the build has them
let shownFor = {};   // kept until the builds change
function visible() {
  const b = B(), key = cur + ' ' + rev;
  if (shownFor.key !== key) {
    const got = new Set([...sockOn(b), ...setOf(b, 1), ...setOf(b, 2), ...granted(b)]);
    shownFor = { key, ids: [...main.filter(id => got.has(id) || !N[id].granted && (!N[id].only_for || N[id].only_for === b.asc)), ...(ASC[b.asc] || [])] };
  }
  return shownFor.ids;
}
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
    b['set' + k] = b.nodes.length ? prune([...b.nodes, ...own], b).filter(n => own.includes(n)) : [];
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
    + `<button data-lvl class="${lvlAt != null ? 'on' : ''}" title="${t('Levelling order: the passives you have by a level, numbered in the order to take them. Click a later passive to take it sooner.')}">${t('Levelling')}<b>${lvlAt != null ? t('Level {0}', lvlAt) : '—'}</b></button>`
    + (lvlAt != null ? `<label class="lvlbar">${t('{0} points', lvlPoints(lvlAt))}<input type="range" min="1" max="100" value="${lvlAt}" data-lvlat></label>` : '')
    + `<button id="treeReset" title="${t('Remove every allocated passive, ascendancy and weapon set point')}">${t('Reset')}<b>⟲</b></button>`;
}
$('treePts').oninput = e => { if (e.target.dataset.lvlat == null) return; lvlAt = +e.target.value;   // redrawn without the bar (keeps the drag)
  $('treePts').querySelector('[data-lvl] b').textContent = t('Level {0}', lvlAt); e.target.parentNode.firstChild.textContent = t('{0} points', lvlPoints(lvlAt)); drawTree(); };
$('treePts').onclick = async e => {
  if (e.target.closest('[data-lvl]')) { lvlAt = lvlAt == null ? B().level || 1 : null; renderPoints(B()); drawTree(); return; }
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
// a passive can be allocated once the passives that unlock it are (needs: the Oracle's own, The Unseen Path), and one
// that is only ever granted never
// note: the table lists them (PassiveSkills.UnlockedBy); that it takes all of them is read off The Hollowkeeper, whose
// only link is to one of its two
const lacks = (id, b) => (N[id].needs || []).filter(n => !b.nodes.includes(n) && !b.ascNodes.includes(n));
const mayTake = (id, b) => !N[id].granted && !lacks(id, b).length;
const walkable = (id, root, b = { nodes: [], ascNodes: [] }) => N[id] && !N[id].ascendancy && (!ROOTS.has(id) || id === root) && mayTake(id, b);
console.assert((o => o && !walkable(o, '') && walkable(o, '', { nodes: [], ascNodes: N[o].needs }) && !main.some(id => N[id].granted && walkable(id, '')))(main.find(id => N[id].only_for)),
  'walkable: a passive that another unlocks, one that is only ever granted');
function pathTo(have, target, ok, add) {   // BFS from the allocated set to target (id or test), returns the new node ids; add: seeds not allocated (free passives), kept in the path that starts at one
  const hit = typeof target === 'function' ? target : u => u === target;
  const prev = new Map(have.map(n => [n, null])), q = [...have];
  let end = null;
  while (q.length) {
    const u = q.shift();
    if (hit(u)) { end = u; break; }
    for (const w of N[u].links.map(String)) if (!prev.has(w) && ok(w)) { prev.set(w, u); q.push(w); }
  }
  if (end === null) return [];
  const out = []; let u = end; for (; prev.get(u) !== null; u = prev.get(u)) out.push(u);
  if (add?.has(u)) out.push(u);
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
// Split Personality: a jewel in an allocated socket lets passives be allocated from another class start (its stat names
// the start's attributes; the tree's starts are named by the old classes). The start itself costs no point. An ascendancy
// passive does the same (the Pathfinder's Path of the Warrior: display_can_take_character_start_point, 1 to 6 in that order)
const SPLIT = { str: 'MARAUDER', dex: 'RANGER', int: 'WITCH', strdex: 'DUELIST', strint: 'TEMPLAR', dexint: 'SIX' };
const ROOT_OF = Object.fromEntries([...ROOTS].map(id => [N[id].name, id]));
const splitRoots = (b, has = new Set(b.nodes)) => [...Object.entries(b.items || {}).flatMap(([slot, it]) => !slot.startsWith('jewel:') || !has.has(slot.slice(6)) ? []
  : Object.keys(statsOf(it)).map(k => ROOT_OF[SPLIT[k.match(/^local_jewel_can_allocate_passives_from_(\w+)_start$/)?.[1]]])),
  ...(b.ascNodes || []).map(id => ROOT_OF[Object.values(SPLIT)[N[id]?.stats?.display_can_take_character_start_point - 1]])].filter(Boolean);
console.assert(splitRoots({ nodes: [], ascNodes: ['57253'] })[0] === ROOT_OF.MARAUDER && !splitRoots({ nodes: [], ascNodes: [] }).length, "Path of the Warrior opens the Warrior's start");
// the jewels in allocated sockets (has: the allocated passives): its socket, the item, its radius (items.js radiusOf) and
// in(id): whether a passive is within that radius, or its ring, of the socket or of the keystone it names (From Nothing)
const radiusScale = b => 1 + (b.ascNodes || []).reduce((a, id) => a + (N[id]?.stats?.['ascendancy_non_unique_jewel_radius_+%'] || 0), 0) / 100;   // Baryanic Leylines: a larger radius for a non-unique jewel
function jewelsOf(b, has = sockOn(b), scale = radiusScale(b)) {
  return Object.entries(b.items || {}).flatMap(([slot, it]) => {
    const id = slot.startsWith('jewel:') && slot.slice(6);
    if (!id || !N[id] || !has.has(id)) return [];
    const R = radiusOf(it), C = N[R?.around] || N[id], r = R && R.r * (it.unique ? 1 : scale);
    const near = x => { const d = Math.hypot(N[x].x - C.x, N[x].y - C.y); return R.ring ? d >= R.ring[0] && d <= R.ring[1] : d <= r; };
    return [{ id, it, R, C, r, in: x => !!R && !!N[x] && !N[x].ascendancy && !ROOTS.has(x) && near(x) }];
  });
}
const radKind = id => N[id] && !N[id].ascendancy && (N[id].type === 'notable' ? 'notable' : N[id].type === 'small' || N[id].type === 'attribute' ? 'small' : null);
// the passives jewels allocate: Megalomaniac's notables (by hash), Flesh Crucible's keystone (its index in keystone_list)
const GRANTS = [[/^unique_jewel_grants_notable_hash_\d+$/, v => v], [/vivisection_random_keystone_index$/, v => tree.keystone_list?.[v - 1]]];
const granted = (b, has) => jewelsOf(b, has).flatMap(j => Object.entries(statsOf(j.it)).map(([k, v]) => GRANTS.find(([re]) => re.test(k))?.[1](v)).filter(x => x && N[x]).map(String));
// Voices' Sinister jewel sockets (sockets with no links, voices_jewel_slot1..5, allocated in that order): the allocated
// passives with those Voices in the tree's own sockets allocate
const VOICES = Object.keys(N).filter(id => /^voices_jewel_slot/.test(N[id].id)).sort((a, b) => N[a].id.localeCompare(N[b].id));
const isPhyl = id => N[id]?.stats?.['phylactery_jewel_socket_effect_+%'], isSock = id => N[id].type === 'jewel' || isPhyl(id);   // Crystalline Phylactery: a jewel socket
function sockOn(b) {
  const n = Object.entries(b.items || {}).reduce((t, [s, it]) => t + (s.startsWith('jewel:') && b.nodes.includes(s.slice(6)) ? statsOf(it).unique_jewel_grants_x_voices_jewel_sockets || 0 : 0), 0);
  return new Set([...b.nodes, ...VOICES.slice(0, n), ...(b.ascNodes || []).filter(isPhyl)]);   // and the Lich's Phylactery
}
// timeless jewels (Heroic Tragedy, Undying Hate) in allocated sockets (js: those jewels): each keystone in their radius
// becomes their conqueror's (passive_tree.json timeless: AlternatePassiveSkills, by local_unique_jewel_alternate_tree_keystone);
// what a kind of passive always becomes or gets added, whatever the seed (Undying Hate: small passives become Tribute,
// attribute ones add Tribute), with what the jewel's own modifiers add to that kind; a notable its modifier names
// ("One Conquered Notable Passive Skill becomes Ephemeral Contact": the first of them allocated, which one is the seed's).
// The rest the seed changes is only marked (which passive and how is not in the game's client data: the game mixes the
// seed with a number the jewel hides), until the player says what the game shows there (tell: its key in b.conq, the
// seed and the passive, so the same jewel says the same in any socket; tellConquest)
// -> Map id -> { ks, by (the jewel) } | { stats, named (the passive it became: its name and art), by } | { add, by } | { over (the notable it became), told (by the player), tell, by } | { seed: true, tell, by }
const TL = tree.timeless || { versions: [], keystones: [], overrides: {} };
function conquest(b, js = jewelsOf(b)) {
  const out = new Map();
  for (const j of js) {
    const st = statsOf(j.it), ver = st.local_unique_jewel_alternate_tree_version, v = TL.versions[ver];
    if (!v || !j.R) continue;
    const ks = TL.keystones.find(k => k.version === ver && k.index === st.local_unique_jewel_alternate_tree_keystone), by = j.it;
    const extra = {}; for (const [k, [kind, to]] of Object.entries(v.extra || {})) if (st[k]) plusStats(extra[kind] ||= {}, { [to]: st[k] });
    const over = Object.entries(st).filter(([k, x]) => /^local_historic_jewel_override_\d+_conquored_notable_to_passive_hash_\d+$/.test(k) && TL.overrides?.[x]).map(([, x]) => TL.overrides[x]);
    const can = Object.values(TL.notables || {}).some(x => x.version === ver);
    for (const id of main) if (j.in(id)) { const ty = N[id].type, tell = ty === 'notable' && can && st.local_unique_jewel_alternate_tree_seed + ':' + id, told = tell && TL.notables[b.conq?.[tell]];
      if (ty === 'keystone') { if (ks) out.set(id, { ks, by }); continue; }
      if (v.becomes?.[ty]) out.set(id, { stats: plusStats({ ...v.becomes[ty] }, extra[ty] || {}), named: v.named?.[ty], by });
      else if (v.replaces[ty] || v.adds[ty] && !v.plus?.[ty]) out.set(id, told?.version === ver ? { over: told, stats: told.stats, told: true, tell, by } : ty === 'notable' && b.nodes.includes(id) && over.length ? (o => ({ over: o, stats: o.stats, tell, by }))(over.shift()) : { seed: true, tell, by });
      else if (v.plus?.[ty] || extra[ty]) out.set(id, { add: plusStats({ ...v.plus?.[ty] }, extra[ty] || {}), by });
    }
  }
  return out;
}
// as seen in the game: an Undying Hate of seed 6858 turns Melting Flames into Domineering Commands
console.assert((b => conquest(b).get('43939')?.over?.name === 'Domineering Commands' && conquest({ ...b, conq: {} }).get('43939')?.seed)({ nodes: ['26196'], conq: { '6858:43939': 'abyss_notable_20' },
  items: { 'jewel:26196': { base: 'Timeless Jewel', implicits: [], mods: [{ id: 'UniqueJewelAlternateTreeInRadiusAbyssal', values: [7, 6858, 1, 1500, 1, 1, 0] }], unique: 'Undying Hate' } } }),
  'a conquered notable is what the player said the game shows, and only marked until then');
// the passives that can be allocated without being connected (Controlled Metamorphosis' radius, From Nothing's keystone's)
// Entwined Realities: non-keystone passives in a Medium radius of an allocated keystone, unconnected
const ENTWINE = radiusNamed('Medium'), entwined = (b, has) => (b.ascNodes || []).some(id => N[id]?.stats?.ascendancy_disconnected_passives_can_be_allocated_around_allocated_keystones)
  ? [...has || b.nodes].filter(k => N[k]?.type === 'keystone').flatMap(k => main.filter(id => N[id].type !== 'keystone' && !ROOTS.has(id) && Math.hypot(N[id].x - N[k].x, N[id].y - N[k].y) <= ENTWINE && mayTake(id, b))) : [];
const freeNodes = (b, has) => new Set([...jewelsOf(b, has).filter(j => j.R?.free).flatMap(j => main.filter(id => j.in(id) && mayTake(id, b))), ...entwined(b, has)]);
function prune(nodes, b) {         // keep only what is still connected to nodes[0], or to a start Split Personality opens
  // (its socket may hang from that start itself, as in the game: the tree can then leave the class start); sockets that
  // end up loose close their start, until nothing more goes
  if (!nodes.length) return nodes;   // an empty tree (a new build)
  for (let alive = new Set(nodes); ;) {
    const keep = new Set([nodes[0], ...(b ? [...splitRoots(b, alive), ...[...freeNodes(b, alive)].filter(n => alive.has(n))] : [])]), q = [...keep];
    while (q.length) for (const w of N[q.shift()].links.map(String)) if (alive.has(w) && !keep.has(w)) { keep.add(w); q.push(w); }
    const next = nodes.filter(n => keep.has(n));
    if (next.length === alive.size) return next;
    alive = new Set(next);
  }
}
// levelling order: the tree's passives in the order they were taken (b.nodes keeps the clicks' order), each moved after
// the first one it hangs from when it came earlier (an imported tree's order is Path of Building's); lvlAt: the level the
// tree shows the passives of (null: all of them), as many as calc.js requiredLevel gives points by then
let lvlAt = null;
function levelOrder(b, nodes = b.nodes) {
  if (!nodes.length) return nodes;
  const out = [nodes[0]], got = new Set([nodes[0], ...splitRoots(b)]), free = freeNodes(b), left = nodes.slice(1);
  while (left.length) {
    const i = left.findIndex(id => free.has(id) || N[id].links.some(w => got.has(String(w))));
    const [x] = left.splice(Math.max(0, i), 1); out.push(x); got.add(x);
  }
  return out;
}
const lvlPoints = L => { let k = 0; while (k < TOTAL.tree && requiredLevel(k + 1) <= L) k++; return k; };
const lvlNodes = b => levelOrder(b).slice(0, lvlPoints(lvlAt) + 1);
// in that view a click on a passive taken later takes it (and what it hangs from) at this level, before the last ones
function takeSooner(b, id) {
  const all = levelOrder(b), now = all.slice(0, lvlPoints(lvlAt) + 1); if (now.includes(id)) return;
  const p = pathTo(now, id, w => all.includes(w)), head = now.slice(0, Math.max(1, now.length - p.length));
  setNodes(b, levelOrder(b, [...head, ...p, ...all.filter(x => !p.includes(x) && !head.includes(x))]));
}
// what clicking `id` would allocate (empty if it is allocated already or unreachable)
function preview(id, b = B()) {
  if (N[id].ascendancy) {
    const st = ascStart(b.asc);
    return id === st || b.ascNodes.includes(id) ? [] : pathTo([st, ...b.ascNodes], id, w => N[w]?.ascendancy === b.asc && mayTake(w, b));
  }
  if (b.nodes.includes(id)) return [];
  if (mode) {   // weapon set: grows from the normal tree plus that set's passives
    const own = setOf(b, mode);
    if (own.includes(id) || !b.nodes.length || !setOK(id)) return [];
    const free = new Set([...freeNodes(b)].filter(n => !b.nodes.includes(n) && !own.includes(n)));
    const p = pathTo([...b.nodes, ...own, ...splitRoots(b), ...free], id, w => walkable(w, b.nodes[0], b), free);
    return p.every(setOK) ? p : [];
  }
  // the tree always grows from the class start, like in the game
  const have = b.nodes.length ? b.nodes : [classRoot(b.asc)].filter(Boolean);
  if (!have.length) return [];
  const free = new Set([...freeNodes(b)].filter(n => !b.nodes.includes(n)));
  const p = id === have[0] ? [] : pathTo([...have, ...splitRoots(b), ...free], id, w => walkable(w, have[0], b), free);
  if (id !== have[0] && !p.length) return [];
  return [...(b.nodes.length ? [] : have), ...p];
}
// the passives another unlocked go with it (the Oracle's own, with The Unseen Path); had: what was allocated before
function relock(b, had) {
  for (;;) {
    const has = new Set([...b.nodes, ...b.ascNodes]), gone = had.filter(n => !has.has(n)), lost = n => N[n].needs?.some(x => gone.includes(x));
    if (![...has, ...setOf(b, 1), ...setOf(b, 2)].some(lost)) return;
    for (const k of [1, 2]) b['set' + k] = setOf(b, k).filter(n => !lost(n));
    b.ascNodes = prune([ascStart(b.asc), ...b.ascNodes.filter(n => !lost(n))]).slice(1);
    setNodes(b, prune(b.nodes.filter(n => !lost(n)), b));
  }
}
function toggle(b, id) {   // what a click on `id` does to build b (false: nothing)
  const had = [...b.nodes, ...b.ascNodes];
  if (N[id].ascendancy) {
    const st = ascStart(b.asc);
    if (id === st) return false;
    b.ascNodes = b.ascNodes.includes(id) ? prune([st, ...b.ascNodes.filter(n => n !== id)]).slice(1) : [...b.ascNodes, ...preview(id, b)];
    setNodes(b, prune(b.nodes, b));   // what hung from a class start one of them opened goes with it
  } else if (mode) {
    const own = setOf(b, mode);
    if (own.includes(id)) { b['set' + mode] = own.filter(n => n !== id); fixSets(b); }
    else own.push(...preview(id, b));
  } else if (id === b.nodes[0]) setNodes(b, []);
  else if (b.nodes.includes(id)) setNodes(b, prune(b.nodes.filter(n => n !== id), b));
  else {   // a set passive taken with a normal point stops being a set passive
    const p = preview(id, b); b.nodes.push(...p);
    for (const k of [1, 2]) b['set' + k] = setOf(b, k).filter(n => !p.includes(n));
  }
  relock(b, had);
}
function clickNode(id) {
  if (lvlAt != null && B().nodes.includes(id)) { takeSooner(B(), id); save(); renderSide(); drawTree(); return; }   // the levelling view
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
  if (!(k in IMG)) { IMG[k] = null; const im = new Image(); im.onload = () => { IMG[k] = im; redraw(); }; im.src = k.startsWith('poe2_data/') ? k : 'poe2_data/available/img/' + k.replace(/\.dds$/, '') + '.webp'; }
  return IMG[k];
}
// the game's node frames (images.py: img/tree/<frame>_<normal|can|active>.webp) and how much of each is the hole the
// icon shows through (measured on those pictures); an ascendancy frame has a backing, so its icon goes on top
const LINK = {
  normal: [['#5e5846', 11], ['#0c0b05', 7], ['#2c200e', 3]],
  can: [['#b8a458', 11], ['#483e06', 9, 1], ['#dacc7d', 7], ['#fbf9ef', 3]],
  active: [['rgba(159,129,74,.3)', 37], ['rgba(159,129,74,.6)', 20], ['#ffd786', 13], ['#5f4509', 9, 1], ['#f2e4b8', 7], ['#ffffff', 3]],
};
// the passives a timeless jewel conquers have that jewel's own links and frames when its tree version has them
// (AlternateTreeArt.UIArt: Undying Hate's Abyss; images.py: img/tree/alt<version>_*): the links, read the same way off
// AbyssPassiveSkillScreenCurves*Together.dds
const LINK_ALT = { 7: {
  normal: [['#419236', 11], ['#040e04', 7], ['#0d200a', 3]],
  can: [['#bacd70', 13], ['#94d259', 9], ['#386600', 7, 1], ['#88d242', 5], ['#a0d271', 3]],
  active: [['rgba(124,168,3,.37)', 34], ['rgba(124,168,3,.73)', 20], ['#d4ff6b', 11], ['#4c4e12', 7, 1], ['#b1c367', 5, 1], ['#ecfea8', 3], ['#ffffe9', 1]],
} };
const FRAME = { small: 'passive', attribute: 'passive', notable: 'notable', keystone: 'keystone', jewel: 'jewel' };
const HOLE = { passive: .66, notable: .592, keystone: .587, asc_passive: .651, asc_notable: .584 };
// a passive that is not allocated has a duller icon in the game: less colour (sat) and fainter (a)
// note: no table says them; the two that leave the same passives as bright (0.75 of what they were here) and as
// saturated (0.47) as on a screenshot of the game, measured on it and on this page (Path of Building 2 halves
// their brightness, much the same, and leaves their colour)
const DULL = { sat: .3, a: .52, of: new Map() };
function dull(im) {   // the picture with less colour, made once
  if (!DULL.of.has(im)) { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.filter = `saturate(${DULL.sat})`; g.drawImage(im, 0, 0); DULL.of.set(im, c); }
  return DULL.of.get(im);
}
function drawNode(id, x, y, r, state, tint, pic2, alt) {   // state: on | path | off; tint: weapon set colour; pic2: the art of what a timeless jewel made of it, or of the attribute picked for it; alt: the tree version whose frames it has
  const n = N[id], lit = state !== 'off', type = isRoot(id) ? 'root' : n.type;
  const col = n.type === 'attribute' ? (ATTR[(B().attrs || {})[id]]?.[1] || '#b8b0a0') : isRoot(id) ? '#e8d8b0' : HUE[id];
  const frame = tint || state === 'on' ? tint || '#f2cf74' : state === 'path' ? '#c9b07a' : '#6a5d47';
  if (r < 3) { ctx.fillStyle = lit ? frame : type === 'keystone' || type === 'notable' ? '#8a7650' : '#4a4236'; ctx.beginPath(); ctx.arc(x, y, Math.max(1.2, r), 0, 7); ctx.fill(); return; }
  const kind = n.ascendancy_start ? 'asc_start' : n.ascendancy ? (type === 'notable' ? 'asc_notable' : 'asc_passive') : FRAME[type];
  const pic = kind && !isRoot(id) && art(`tree/${alt && kind !== 'jewel' ? `alt${alt}_` : ''}${kind}_${state === 'on' ? 'active' : state === 'path' && kind !== 'asc_start' ? 'can' : 'normal'}`);
  if (pic) {
    // a frame is drawn one pixel a world unit, like the game's links; its icon fills the hole
    const f = r / R[type], w = pic.width * f, h = pic.height * f, ir = (HOLE[kind] || 0) * w / 2;
    const icon = ir > 0 && art(pic2 || n.icon);
    const drawIcon = () => {   // its icon at any size; while it loads, the colour of its stats
      if (!ir) return;
      ctx.save(); ctx.globalAlpha = lit ? 1 : DULL.a; ctx.beginPath(); ctx.arc(x, y, ir, 0, 7);
      if (icon) { ctx.clip(); ctx.drawImage(lit ? icon : dull(icon), x - ir, y - ir, ir * 2, ir * 2); } else { ctx.fillStyle = col; ctx.fill(); }
      ctx.restore();
    };
    if (!n.ascendancy) drawIcon();
    ctx.drawImage(pic, x - w / 2, y - h / 2, w, h);
    if (n.ascendancy) drawIcon();
    // the jewel socketed in it: the game's picture of it in a socket, a unique's own or its base's (passive_tree.json
    // socketed; images.py: img/tree/sock_*), as large as the frame
    const it = type === 'jewel' && B().items?.['jewel:' + id], so = it && (tree.socketed[it.unique] || tree.socketed[it.base]), jw = so && art('tree/sock_' + so.split('/').pop());
    if (jw) ctx.drawImage(jw, x - w / 2, y - h / 2, w, h);
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
  const icon = r >= 6 && art(pic2 || n.icon);
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
const searchText = id => SEARCH_TEXT[id] ??= fold([N[id].name, tn(N[id]), N[id].grants_skill, ...statLines(nodeStats(id))].filter(Boolean).join('\n'));
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
  if ((e.ctrlKey || e.metaKey) && foundAt >= 0) { clickNode(ids[foundAt]); return; }   // the keyboard's click: allocate / remove the match shown
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
  const s = view.s, b0 = B(), b = lvlAt == null ? b0 : { ...b0, nodes: lvlNodes(b0) }, st = ascStart(b.asc);   // the levelling view: the passives by that level
  const set1 = new Set(setOf(b, 1)), set2 = new Set(setOf(b, 2));
  const on = new Set([...b.nodes, ...b.ascNodes, ...(st ? [st] : []), ...set1, ...set2, ...splitRoots(b), ...granted(b), ...sockOn(b)]), js = jewelsOf(b), cq = conquest(b, js);   // and the starts Split Personality opens, what jewels allocate
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
  // note: no table says the size or how faint: 2 world units a pixel (one a pixel of the game's own picture) and 0.15
  // are what the colour of 13 of them by how far from their passive fits best on a screenshot of the game (1.9, 0.08 to
  // 0.17), and what Path of Building 2 draws them at (760 units for 776 pixels, 0.15)
  for (const id of MASTERY) {
    const pic = visSet.has(id) && art('mastery/' + N[id].mastery_art);
    if (!pic) continue;
    const [x, y] = WP[id], w = pic.width * 2, h = pic.height * 2;
    ctx.globalAlpha = on.has(id) ? 1 : .15;
    ctx.drawImage(pic, x - w / 2, y - h / 2, w, h);
  }
  ctx.globalAlpha = 1;
  // behind the socket of a unique jewel that has art for it, that art (passive_tree.json socket_art,
  // PassiveJewelUniqueArt.KeystoneArt: the runes of the Abyss behind Undying Hate), as large as a mastery's; it does
  // not turn (a video of the game)
  // note: how bright (1.7 times the picture: once more, added at 0.7) is measured on a screenshot of the game; no
  // table says it
  for (const j of js) {
    const name = tree.socket_art[j.it.unique], pic = name && art('mastery/' + name.split('/').pop());
    if (!pic) continue;
    const [x, y] = WP[j.id], w = pic.width * 2, h = pic.height * 2;
    ctx.drawImage(pic, x - w / 2, y - h / 2, w, h);
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .7;
    ctx.drawImage(pic, x - w / 2, y - h / 2, w, h);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  }
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

  // the passives within a timeless jewel whose tree has its own links and frames: id -> its tree version
  const alt = new Map();
  for (const j of js) { const v = j.R && statsOf(j.it).local_unique_jewel_alternate_tree_version; if (LINK_ALT[v]) for (const id of main) if (j.in(id)) alt.set(id, v); }
  // links: off, preview, allocated (glowing); altP: those between two passives of such a jewel, by version
  const off = new Path2D(), path = new Path2D(), lit = new Path2D(), setLit = { [SET_COL[1]]: new Path2D(), [SET_COL[2]]: new Path2D() }, altP = {}, own = { normal: off, can: path, active: lit };
  for (const id of vis) for (const l of N[id].links) {
    const m = String(l);
    if (!visSet.has(m) || +m < +id || !N[id].ascendancy !== !N[m].ascendancy) continue;
    const A = on.has(id), Bo = on.has(m);
    const tint = A && Bo && (setTint(id) || setTint(m));
    const kind = A && Bo ? 'active' : (A || pre.has(id)) && (Bo || pre.has(m)) ? 'can' : 'normal', av = alt.get(id) === alt.get(m) && alt.get(id);
    linkPath(tint ? setLit[tint] : (av ? altP[av] ||= { normal: new Path2D(), can: new Path2D(), active: new Path2D() } : own)[kind], id, m);
  }
  const px = v => v / s;   // screen pixels -> world units
  ctx.lineCap = 'round';
  // each kind of link as the game's own (PassiveSkillScreenCurves*Together.dds: its colours across the line, outside
  // in, one pixel a world unit), never thinner on screen than `least` pixels. The dark line inside a lit one (third: 1)
  // is left out while it is under 0.6 screen pixels a side: the game's filtering blends it away at that size, and
  // strokes laid one over another speckle the link with it
  // note: 0.6 is measured here, not the game's: how far the brightness along a link's middle strays, 9-14% with it
  // and 2-5% without at 0.2 to 0.5 pixels a unit, 2-5% either way above
  const stroke = (p, layers, least) => {
    const k = Math.max(1, px(least) / layers[0][1]);
    layers.forEach(([c, w, dark], i) => { if (dark && (w - layers[i + 1][1]) * k * s * D < 1.2) return; ctx.strokeStyle = c; ctx.lineWidth = w * k; ctx.stroke(p); });
  };
  stroke(off, LINK.normal, 1.2);
  stroke(path, LINK.can, 1.6);
  stroke(lit, LINK.active, 2.4);
  for (const [v, P] of Object.entries(altP)) { stroke(P.normal, LINK_ALT[v].normal, 1.2); stroke(P.can, LINK_ALT[v].can, 1.6); stroke(P.active, LINK_ALT[v].active, 2.4); }
  for (const [c, p] of Object.entries(setLit)) stroke(p, [[c + '55', 37], [c, 13], ['#ffffff', 3]], 2.4);
  // the radius of each socketed jewel in view goes over the tree, on its own canvas (turnRings)
  rings = js.filter(j => j.R).map(j => [j, sx(j.C.x), sy(j.C.y), s]).filter(([j, x, y]) => { const r = (j.R.ring?.[1] || j.r) * s; return x + r > 0 && x - r < W && y + r > 0 && y - r < H; });
  ringRaf ||= requestAnimationFrame(turnRings);

  // nodes (screen space so they stay crisp)
  ctx.setTransform(D, 0, 0, D, 0, 0);
  const myRoot = classRoot(b.asc);
  for (const id of vis) {
    const n = N[id], [wx, wy] = WP[id], x = sx(wx), y = sy(wy);
    const r = R[isRoot(id) ? 'root' : n.type] * s * (n.ascendancy ? FIT[n.ascendancy].k : 1);
    if (x < -r * 2 || y < -r * 2 || x > W + r * 2 || y > H + r * 2) continue;
    if (found.has(id)) drawFound(x, y, r);
    drawNode(id, x, y, r, on.has(id) ? 'on' : pre.has(id) || (id === myRoot && !b.nodes.length) ? 'path' : 'off', on.has(id) && setTint(id), (cq.get(id)?.ks || cq.get(id)?.named || cq.get(id)?.over)?.icon || tree.attribute_icons[ATTR[(b.attrs || {})[id]]?.[0]], alt.get(id));
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
    const name = label(cq.get(id)?.ks || cq.get(id)?.over || cq.get(id)?.named || n);
    ctx.strokeText(name, x, y + r * 1.25 + 2); ctx.fillText(name, x, y + r * 1.25 + 2);
  }
  // the levelling view: each passive's place in the order
  if (lvlAt != null && s > .05) {
    ctx.textBaseline = 'middle'; ctx.font = 'bold 11px Georgia, serif'; ctx.fillStyle = '#9fe8ff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
    b.nodes.forEach((id, i) => { if (!i || !visSet.has(id)) return; const [wx, wy] = WP[id], x = sx(wx), y = sy(wy); ctx.strokeText(i, x, y); ctx.fillText(i, x, y); });
  }
}
let raf = 0;
const redraw = () => raf ||= requestAnimationFrame(() => { raf = 0; drawTree(); });
// A socketed jewel's radius (or its ring), round the socket or round the keystone it names (From Nothing): the game's
// own pictures of it (images.py: img/tree/ring*.webp), as wide as twice the radius; a timeless jewel has its
// conqueror's. Its two circles turn against each other; the circle inside a ring-shaped radius is another picture,
// whose line is 0.94 of the way out (measured on it; Path of Building 2 draws its own 1.06 times as wide). g: where
// to draw; (x, y): its centre there; k: pixels a tree unit; turn: how far the circles have turned
function drawRings(g, j, x, y, k, turn) {
  const v = statsOf(j.it).local_unique_jewel_alternate_tree_version || '', [inner, outer] = j.R.ring || [0, j.r], ri = inner / .94;
  for (const [p, rr, dir] of [[`ring${v}_1`, outer, -1], [`ring${v}_2`, outer, 1], ['ring_inv', ri, -1], ['ring_inv', ri, 1]]) {
    const im = rr && art('tree/' + p);
    if (!im) continue;
    g.save(); g.translate(x, y); g.rotate(dir * turn); g.drawImage(im, -rr * k, -rr * k, rr * 2 * k, rr * 2 * k); g.restore();
  }
}
// the rings of the tree turn all the time: they have a canvas of their own over it, so the tree is not drawn again
// note: no table says how fast they turn: 0.021 radians a second each way, measured on a video of the game (the
// angle its band moved after 1.5 and 3 seconds), which is Path of Building 2's 0.7 * 0.00003 radians a millisecond
const RING_TURN = .021, rcv = $('treeRings'), rctx = rcv.getContext('2d');   // radians a second
let rings = [], ringRaf = 0;   // what drawTree last had in view: [jewel, x, y, pixels a tree unit]
function turnRings(now) {
  if (rcv.width !== cv.width || rcv.height !== cv.height) { rcv.width = cv.width; rcv.height = cv.height; }
  const D = dpr();
  rctx.setTransform(D, 0, 0, D, 0, 0); rctx.clearRect(0, 0, cv.clientWidth, cv.clientHeight);
  for (const [j, x, y, k] of rings) drawRings(rctx, j, x, y, k, now / 1000 * RING_TURN);
  ringRaf = rings.length && cv.offsetParent ? requestAnimationFrame(turnRings) : 0;   // nothing to turn, or the tree is not shown: until it is drawn again
}
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
const KIND = { keystone: 'Keystone', notable: 'Notable', jewel: 'Jewel socket', attribute: 'Attribute', small: 'Passive' };
let tipKey;
function showTip(id, mx, my) {
  const tip = $('tip'), n = N[id];
  tip.hidden = !id;
  if (!id) return;
  if (tipKey !== (tipKey = `${id} ${mode} ${rev}`)) tipHtml(tip, id, n);
  const box = cv.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = Math.min(mx + 16, box.width - w - 4) + 'px';
  tip.style.top = (my + 16 + h > box.height ? my - h - 10 : my + 16) + 'px';
}
function tipHtml(tip, id, n) {
  const b = B(), jv = n.type === 'jewel' && itemView(b.items?.['jewel:' + id]), cq = conquest(b).get(id);   // a socket: the jewel in it; a timeless jewel's conquest
  const by = cq && itemView(cq.by)?.name;
  const lines = statLines(nodeStats(id)).concat(n.grants_skill ? [t('Grants: {0}', n.grants_skill)] : [], lacks(id, b).length ? [t('Requires {0}', lacks(id, b).map(x => label(N[x])).join(', '))] : [], jv ? [jv.name || jv.base, ...jv.mods] : [],
    cq && !cq.seed ? [t('Conquered by {0}', by)] : []);
  const cost = preview(id).filter(x => !isRoot(x)).length, start = n.ascendancy_start;
  const sets = [1, 2].filter(k => setOf(b, k).includes(id)), forSet = mode && !n.ascendancy;
  const mine = b.nodes.includes(id) || b.ascNodes.includes(id) || forSet && sets.includes(mode), lv = lvlAt != null && b.nodes.includes(id);   // lv: the levelling view's, a click moves it
  tip.className = 'tip-' + (isRoot(id) ? 'root' : n.type);
  tip.innerHTML = `<div class="th">${esc(label(cq?.ks || cq?.over || cq?.named || n))}<small>${isRoot(id) ? t('Class start') : t(KIND[n.type])}${n.ascendancy ? ' · ' + esc(n.ascendancy) : ''}${sets.map(k => ' · ' + t('Set {0}', k)).join('')}</small></div>`
    + (lines.length ? `<div class="tb">${lines.map(esc).join('<br>')}</div>` : '')
    + (cq?.seed ? `<div class="disc">${esc(t('{0} changes this passive by its seed, which the game data does not show: it counts as it is.', by))}</div>` : '')
    + (!lv && (cost || mine) ? impactHtml(t(mine ? 'If you remove it' : 'If you allocate it'), nodeImpact(id)) : '')
    + `<div class="tf">${n.type === 'attribute' ? t('Right click: Str / Dex / Int') + '<br>' : ''}${cq?.tell ? t('Right click: what it is in the game') + '<br>' : ''}${lv ? t(lvlNodes(b).includes(id) ? 'Taken by this level' : 'Click: take it at this level') : start ? t('Ascendancy start') : cost ? (forSet ? t(cost > 1 ? 'Click: allocate ({0} points of set {1})' : 'Click: allocate (1 point of set {1})', cost, mode) : t(cost > 1 ? 'Click: allocate ({0} points)' : 'Click: allocate (1 point)', cost)) : preview(id).length ? t('Click: start here')
      : mine ? t('Click: remove') : forSet && !setOK(id) ? t('Cannot be allocated to a weapon set') : t('Cannot be allocated from here')}</div>`;
}
// mouse, pen and touch alike (pointer events): one pointer pans, two pinch to zoom; a touch or pen held half a second
// does what the right button does (Str / Dex / Int)
let drag = null;
const pts = new Map(), gap = () => { const [a, b] = [...pts.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]); };
function zoomAt(x, y, k) {
  const mx = x - cv.clientWidth / 2, my = y - cv.clientHeight / 2, ns = Math.min(1.5, Math.max(.01, view.s * k)), kk = ns / view.s;
  view.x += mx / view.s * (1 - 1 / kk); view.y += my / view.s * (1 - 1 / kk); view.s = ns; $('tip').hidden = true; redraw();
}
cv.onpointerdown = e => { cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.offsetX, e.offsetY]);
  drag = pts.size === 1 ? { x: e.offsetX, y: e.offsetY, moved: false, at: Date.now() } : { moved: true, d: gap() }; };
cv.onpointermove = e => {
  if (pts.size === 2 && pts.has(e.pointerId)) { pts.set(e.pointerId, [e.offsetX, e.offsetY]); const d = gap(), [a, b] = [...pts.values()];
    if (drag.d) zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, d / drag.d); drag.d = d; return; }
  if (drag && pts.size === 1) {
    const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    if (drag.moved) { view.x -= dx / view.s; view.y -= dy / view.s; drag.x = e.offsetX; drag.y = e.offsetY; $('tip').hidden = true; redraw(); return; }
  }
  const h = nodeAt(e.offsetX, e.offsetY);
  if (h !== hover) { hover = h; redraw(); }
  cv.style.cursor = h ? 'pointer' : 'grab';
  showTip(h, e.offsetX, e.offsetY);
};
cv.onpointerup = e => {
  pts.delete(e.pointerId);
  if (drag && !drag.moved && !pts.size) { const h = nodeAt(e.offsetX, e.offsetY), held = e.pointerType !== 'mouse' && Date.now() - drag.at > 500;
    if (h) { e.button === 2 || held ? (cycleAttr(h), tellConquest(h)) : clickNode(h); showTip(h, e.offsetX, e.offsetY); } }
  if (!pts.size) drag = null;
};
cv.onpointercancel = e => { pts.delete(e.pointerId); if (!pts.size) drag = null; };
cv.oncontextmenu = e => e.preventDefault();
cv.onpointerleave = e => { if (pts.size) return; drag = null; hover = null; $('tip').hidden = true; redraw(); };
cv.onwheel = e => { e.preventDefault(); zoomAt(e.offsetX, e.offsetY, e.deltaY < 0 ? 1.15 : 1 / 1.15); };
addEventListener('resize', redraw);
document.querySelectorAll('nav button').forEach(x => { x.setAttribute('role', 'tab'); x.setAttribute('aria-selected', x.classList.contains('on')); });

// ---------- tabs
// side panel: character sheet in Tree / Equipment, details of the selected skill in Skills, in the 3D scene what changes while
// you play (resistances, speeds, damage taken...) over the skills whose damage changes with it
document.querySelectorAll('nav button').forEach(btn => btn.onclick = () => {
  const v = btn.dataset.v;
  document.querySelectorAll('nav button').forEach(x => { x.classList.toggle('on', x === btn); x.setAttribute('aria-selected', x === btn); });
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
const saveScene = () => put(SCENE_KEY, sceneCfg);
// the simulator's skill bar of each build: { slots: [gem name or null x8], seen: [gem names it has placed] }
const BAR_KEY = SCENE_KEY + ':bar', sceneBars = stored(BAR_KEY);
const enemyLevel = () => Math.max(1, Math.min(100, sceneCfg.level || B().level || 1));
const syncEnemy = () => scene3d?.enemy(enemy(sceneCfg.enemy), enemyLevel(), sceneCfg.attack, sceneCfg.rarity, sceneCfg.mods);
const enWrap = Object.assign(document.createElement('details'), { className: 's-enwrap' });
enWrap.innerHTML = `<summary>${t('Enemies')}</summary><div id="sceneEnemy"></div>`;
$('scene').append(enWrap);
enWrap.onchange = $('sceneSkills').onchange; enWrap.onclick = $('sceneSkills').onclick;
enWrap.querySelector('summary').onmouseup = e => e.target.blur();   // Space rolls in the scene, it must not fold the panel
$('sceneEnemy').innerHTML = `<h3>${t('Enemies')} <small class="note">${t('{0} from the game', fmt(PLACED.length))}</small></h3>
  <div class="en-pick"><input id="enFind" type="search" placeholder="${esc(t('Search enemy…'))}" autocomplete="off" spellcheck="false"><div id="enList" hidden></div></div>
  <div id="enMap"></div><div id="enDetail"></div>`;
// ---------- the map of the scene: a waystone's modifiers (enemies.js MAP), pasted from the game or picked by hand. Its
// monsters' are on every enemy, its players' on your character in the simulator, its ground is a patch in the room
// (scene.js); its tier sets the enemies' level (the area's)
let mapNote = '';   // what the last paste left out, or that it was no waystone
const rollOf = (m, tier) => m.rolls[MAP.tiers[tier - 1].tag];   // undefined: it does not roll on a waystone of that tier
const topRoll = (m, tier) => rollOf(m, tier).map(([lo, hi]) => Math.abs(lo) > Math.abs(hi) ? lo : hi);   // the strongest roll of each stat
const mapLines = (m, vals) => shownLines(Object.fromEntries(m.stats.map((s, k) => [s, vals[k]]))).join(' · ');
function setSceneMap(map, note = '') {
  sceneCfg.map = map; mapNote = note;
  setMap(map); mapSelf = mapPlayer(map);
  saveScene(); scene3d?.remap(); renderMap(); renderEnemy();
}
// a tier: its area level for the enemies, and each modifier's values brought within its rolls at that tier, without
// those that do not roll on it (own: a pasted waystone's values, kept as the item has them)
function pickTier(tier, mods = sceneCfg.map?.mods || {}, own = false, note = '') {
  if (!MAP.tiers[tier - 1]) return setSceneMap(null);
  sceneCfg.level = MAP.tiers[tier - 1].level; syncEnemy();
  setSceneMap({ tier, mods: own ? mods : Object.fromEntries(Object.entries(mods).flatMap(([id, vals]) => {
    const R = rollOf(MAP.mods.find(x => x.id === id), tier); return R ? [[id, R.map(([lo, hi], k) => Math.max(lo, Math.min(hi, vals[k])))]] : []; })) }, note);
}
function renderMap() {
  const map = sceneCfg.map, n = Object.keys(map?.mods || {}).length, open = $('enMap').querySelector('details')?.open;
  const row = m => { const on = map.mods[m.id], R = rollOf(m, map.tier) || [];
    return `<label><input type="checkbox" data-mapmod="${esc(m.id)}"${on ? ' checked' : ''}> ${esc(mapLines(m, on || topRoll(m, map.tier)))}</label>`
      + (on ? R.map(([lo, hi], k) => lo === hi ? '' : `<input type="number" data-mapval="${esc(m.id)}:${k}" min="${lo}" max="${hi}" step="1" value="${+on[k] || 0}" title="${lo} – ${hi}">`).join('') : ''); };
  $('enMap').innerHTML = `<details class="en-mods en-map"${open || open == null && map ? ' open' : ''}><summary>${t('Map modifiers')} <small>${n}</small></summary>
    <textarea class="pasteItem" data-map="paste" rows="2" placeholder="${esc(t('Paste a waystone here: Ctrl+C on it in the game'))}"></textarea>
    ${mapNote ? `<p class="note">${esc(mapNote)}</p>` : ''}
    <div class="sk-set"><label><span>${t('Waystone')}</span><select data-map="tier"><option value="0">—</option>${MAP.tiers.map((x, i) => `<option value="${i + 1}"${map?.tier === i + 1 ? ' selected' : ''}>${esc(tn(x))} · ${t('Level')} ${x.level}</option>`).join('')}</select></label>
      ${map ? `<button data-map="clear">${t('Remove the map')}</button>` : ''}</div>
    ${map ? MAP.mods.filter(m => map.mods[m.id] || rollOf(m, map.tier)).map(row).join('') : ''}
    <p class="note">${t('The modifiers of the map are on every enemy and on your character in the simulator. Each kind of ground it has is one patch in the room; its rewards are not simulated.')}</p></details>`;
}
enWrap.addEventListener('input', e => {
  if (e.target.dataset.map !== 'paste' || !e.target.value.trim()) return;
  const w = parseWaystone(e.target.value, MAP);
  if (!w) { mapNote = t('That is not a waystone.'); return renderMap(); }
  pickTier(w.tier, w.mods, true, w.missed.length ? `${t('Not simulated')}: ${w.missed.join(' · ')}` : '');
});
renderMap();
const enFind = $('enFind'), enList = $('enList');
let enAt = 0;   // row the arrow keys are on
function listEnemies() {
  const { total, list } = findEnemies(enFind.value, 60);
  enAt = Math.max(0, Math.min(enAt, list.length - 1));
  enList.innerHTML = list.map((m, i) => `<div class="en-row${i === enAt ? ' at' : ''}${m.id === sceneCfg.enemy ? ' on' : ''}" data-id="${esc(m.id)}">
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
  const b = B(), c = character(b, simSum()), L = enemyLevel(), rar = rarityOf(m, sceneCfg.rarity), st = enemyStats(m, L, rar, false, sceneCfg.mods);
  const list = attacksOf(m), key = list.some(a => a.key === sceneCfg.attack) ? sceneCfg.attack : list[0].key, atk = attackOf(m, L, key, rar, false, sceneCfg.mods), vp = versusPlayer(atk, st, c);
  const on = new Set(sceneCfg.mods), modText = x => esc([x.name && tn(x), ...shownLines(x.stats)].filter(Boolean).join(' · '));
  const mods = !['magic', 'rare'].includes(rar) ? '' : `<details class="en-mods"${on.size ? ' open' : ''}><summary>${t('Modifiers')} <small>${on.size}</small></summary>
    ${MON_MODS.filter(x => shownLines(x.stats).length).map(x => `<label><input type="checkbox" data-enmod="${esc(x.id)}"${on.has(x.id) ? ' checked' : ''}> ${modText(x)}</label>`).join('')}</details>`;
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
  // a gem with no damage of its own: the first skill it sets off that has some (Ancestral Cry's Volcanic Steps)
  const g = b.gems[scene3d?.selected() ?? 0], own = g && simDmg(g), dmg = own && !dealt(own) && subsOf(g, own)[0]?.s || own, ve = dmg && versusEnemy(dmg, st, c.accuracy);
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
    ${m.areas?.length ? `<p class="note en-areas" title="${esc(m.areas.join('\n'))}">${esc(m.areas.slice(0, 3).join(' · '))}${m.areas.length > 3 ? ' …' : ''}</p>` : ''}
    <div class="sk-set"><label><span>${t('Level')} ${sceneCfg.level ? `<a data-en="mylevel" title="${esc(t('Use the level of your build ({0})', b.level))}">↺</a>` : `<small>${t('yours')}</small>`}</span>
        <input type="number" min="1" max="100" step="1" data-en="level" value="${L}"></label>
      <label><span>${t('Rarity')}</span><select data-en="rarity">${RARITIES.map(r => `<option value="${r}" ${r === rar ? 'selected' : ''}>${t(r[0].toUpperCase() + r.slice(1))}</option>`).join('')}</select></label>
      <label><span>${t('Attack')}</span><select data-en="attack">${list.map(a => `<option value="${esc(a.key)}" ${a.key === key ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label></div>
    ${mods}${atk.description ? `<p class="note">${esc(atk.description)}</p>` : ''}
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
    ${row(t('Armour'), L.armour, '')}${row(t('Evasion Rating'), L.evasion, '')}${L.deflect ? row(t('Deflection Rating'), L.deflect, '') : ''}${L.block ? row(t('Block'), L.block, '%') : ''}${L.physDR ? row(t('Additional physical damage reduction'), L.physDR, '%') : ''}
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
scene3d = initScene($('scene'), { build: B, geo, playerSpeed, still: () => sceneCfg.still, fight: () => sceneCfg.fight, onLive, info: gemInfo, onSelect: markCard, onPlacing: () => renderEnemy(), damage: simDmg, usedBy: j => usedBy(B(), j), byHand: j => byHand(B(), j), reserve: g => reservation(g, treeSum(), B()),
  // x: a buff the scene has on (The Hammer of Faith's Shrine), its stats added to the tree's and gear's
  sheet: x => { const sum = simSum(); for (const [k, n] of Object.entries(x || {})) sum[k] = (sum[k] || 0) + n; const c = character(B(), sum); return { ...c, ...recovery(c, sum), rage: rageOf(B(), sum), sprint: { speed: (SK.character_stats?.['sprint_movement_speed_+%'] || 0) + (sum['sprint_movement_speed_+%'] || 0), min: SK.character_stats?.dodge_roll_sprint_minimum_time_ms, turn: SK.character_stats?.dodge_roll_sprint_turn_rate }, noFall: !!sum.cannot_be_heavy_stunned_while_sprinting, owl: sum.owl_feather_max_bonus_to_stack ? { stack: sum.owl_feather_max_bonus_to_stack, faster: sum['owl_feather_gain_frequency_+%'] || 0 } : null, jade: sum.buildup_jade_every_x_ms && { every: sum.buildup_jade_every_x_ms, max: sum.max_jade_stacks, dr: sum['additional_physical_damage_reduction_%_per_jade'] }, ailments: ailmentDefence(c, sum),
    flasks: ['flask1', 'flask2'].map(k => { const f = flaskOf(B().items?.[k], sum); return f && { ...f, img: gemImg(f.img) }; }),
    charms: sum.keystone_oasis ? [] : ['charm1', 'charm2', 'charm3'].map(k => { const f = charmOf(B().items?.[k], { ...sum, 'charm_effect_+%': (sum['charm_effect_+%'] || 0) + (sum['charm_effect_+%_per_empty_charm_slot'] || 0) * c.emptyCharms }); return f && { ...f, img: gemImg(f.img), icon: gemImg(f.icon) }; }) }; },
  chargeIcon: c => gemImg(SK.charge_icons?.[c]), infusion: e => SK.infusions?.[e] && { icon: gemImg(SK.infusions[e].icon), name: tn(SK.infusions[e]) }, moveIcon: gemImg(SK.move_icon), wardOrb: k => gemImg(`art/textures/interface/2d/2dart/uiimages/ingame/hud/4k/orb_ward${k}.dds`), ailmentIcon: a => gemImg(SK.ailment_icons?.[a]), archonIcon: gemImg(SK.archon_nature_icon), archon: SK.archon_nature,
  swapSet: () => { swapSet(B(), B().wset === 2 ? 1 : 2); save(); renderSide(); return B().wset; },
  look: () => ({ weapon: baseOf(B().items?.weapon)?.class, offhand: baseOf(B().items?.offhand)?.class }),   // what the figure holds
  bar: () => sceneBars[cur], setBar: v => { sceneBars[cur] = v; put(BAR_KEY, sceneBars); renderSceneSkills(); } });
// Split Personality can't be taken out while passives hang from the start it opens (as in the game): that item change is
// undone (seenItems: the build's gear as the panel last showed it)
const seenItems = new WeakMap();
function keepSplit() {
  const b = B(), was = seenItems.get(b);
  if (!was || prune(b.nodes, b).length >= prune(b.nodes, { ...b, items: was.items }).length) return;
  b.items = structuredClone(was.items); b.stash = structuredClone(was.stash);
  ask(t('This jewel cannot be taken out: passives allocated from the class start it opens would be left unconnected.'));
}
// where a socket is, for the equipment panel: on the left the whole tree with the socket marked, on the right the passives
// round it (the allocated ones lit) and the radius of the jewel in it; a click shows it on the tree
function drawSocket(c, id) {
  const g = c.getContext('2d'), D = dpr(), W = c.clientWidth, H = c.clientHeight, b = B();
  c.width = W * D; c.height = H * D; g.setTransform(D, 0, 0, D, 0, 0);
  g.fillStyle = '#080c12'; g.fillRect(0, 0, W, H);
  const on = new Set([...b.nodes, ...granted(b), ...splitRoots(b)]), j = jewelsOf(b).find(x => x.id === id), S = N[id];
  const seen = new Set(visible()), mine = main.filter(a => seen.has(a));   // the passives on this build's tree
  const near = H / Math.max(4500, 2.4 * (j?.R?.ring?.[1] || j?.r || 0));
  const view = (x0, w, cx, cy, k) => {   // the tree round (cx, cy) at k pixels a unit, in the box from x0, w wide
    const X = x => x0 + w / 2 + (x - cx) * k, Y = y => H / 2 + (y - cy) * k;
    g.save(); g.beginPath(); g.rect(x0, 0, w, H); g.clip();
    const off = new Path2D(), lit = new Path2D();
    for (const a of mine) for (const l of N[a].links) { const m = String(l);
      if (+m < +a || !seen.has(m) || N[m].ascendancy) continue;
      const p = on.has(a) && on.has(m) ? lit : off; p.moveTo(X(N[a].x), Y(N[a].y)); p.lineTo(X(N[m].x), Y(N[m].y)); }
    g.lineWidth = 1; g.strokeStyle = '#3a352b'; g.stroke(off); g.lineWidth = 2; g.strokeStyle = '#c9a24a'; g.stroke(lit);
    for (const a of mine) { const n = N[a], r = Math.max(1, R[isRoot(a) ? 'root' : n.type] * k * .7);
      g.fillStyle = on.has(a) ? '#f2cf74' : n.type === 'jewel' ? '#6f8fb0' : '#5a5040'; g.beginPath(); g.arc(X(n.x), Y(n.y), r, 0, 7); g.fill(); }
    g.strokeStyle = '#9fe8ff'; g.lineWidth = 2;
    g.beginPath(); g.arc(X(S.x), Y(S.y), Math.max(6, R.jewel * k * 1.3), 0, 7); g.stroke();
    if (j?.R) drawRings(g, j, X(j.C.x), Y(j.C.y), k, .7);
    g.restore();
    return { X, Y };
  };
  const all = H / 26000, o = view(0, H, 0, 0, all), half = W / 2 - H / 2;
  view(H, W - H, S.x, S.y, near);
  g.strokeStyle = 'rgba(159,232,255,.7)'; g.lineWidth = 1;   // the part the right shows
  g.strokeRect(o.X(S.x) - half / near * all, o.Y(S.y) - H / 2 / near * all, (W - H) / near * all, H / near * all);
  g.fillStyle = '#3a352b'; g.fillRect(H, 0, 1, H);
}
// the build's jewels as the optimizer takes them: every socket holding one, allocated or not, with what it grants there
// (its modifiers, Megalomaniac's notables) and the passives it frees (optimize.js optimizeTree)
const optJewels = b => jewelsOf(b, new Set(Object.keys(b.items || {}).map(s => s.slice(6)))).map(j => ({ ...j,
  stats: [gearStats({ ['jewel:' + j.id]: j.it }), ...granted(b, new Set([j.id])).filter(x => !b.nodes.includes(x)).map(x => N[x].stats)].reduce(plusStats, {}),
  free: j.R?.free ? main.filter(id => j.in(id) && mayTake(id, b)) : [],
  // what a timeless jewel changes in its radius once its socket is allocated: per passive, the stats added (removed below 0)
  swap: new Map([...conquest(b, [j])].filter(([id, c]) => !c.ks && !c.seed && (!c.over || c.told)).map(([id, c]) => {
    const was = nodeStats(id, b, new Map()), now = nodeStats(id, b, new Map([[id, c]])), d = {};
    for (const k of new Set([...Object.keys(was), ...Object.keys(now)])) if ((now[k] || 0) !== (was[k] || 0)) d[k] = (now[k] || 0) - (was[k] || 0);
    return [id, d]; })) }));
const sockets = () => [...sockOn(B())].filter(isSock).map((id, i) => ({ id, label: t('socket {0}', i + 1) }));   // the allocated jewel sockets, Voices' too
const renderItems = initItems($('items'), B, () => { keepSplit(); save(); renderSide(); },
  sockets,
  items => snap({ ...B(), items }), treeSum,
  { can: slot => SEARCH_SLOTS.includes(slot) || slot.startsWith('jewel:'), map: drawSocket, show: id => showOnTree([id]), money: () => renderOpt.money(), tough: items => { const b = { ...B(), items }; return toughness(character(b, sumOf(b))); }, find: (...a) => renderOpt.better(...a), price: p => renderOpt.price(p), site: siteQuery, item: (league, l, state) => siteQuery(league, listingQuery(l, state)) });
const renderSkills = initSkills($('skills'), $('skillPanel'), B, () => { save(); renderSide(); }, treeSum, addGem, geo, () => builds[vsId] && vsId !== cur && { b: builds[vsId], sum: sumOf(builds[vsId]) });
const renderOpt = initOpt($('opt'), { build: B, id: () => cur, rev: () => rev, sumOf, snap, tree, N, rootOf: b => classRoot(b.asc), splitRoots, jewels: optJewels, total: TOTAL.tree, sockets: b => [...sockOn(b)].filter(isSock), setNodes, showOnTree,
  change: fn => { fn(B()); save(); renderSide(); drawTree(); } });
const lootEl = document.createElement('section');   // the equipment comparison: a section of Settings
const renderLoot = initLoot(lootEl, { build: B, id: () => cur, sumOf, snap,
  sockets });
const renderSettings = initSettings($('settings'), lootEl);
watchUpdates($('updNote'));
const renderFilter = initFilter($('filter'));
select(builds[localStorage.getItem(KEY + ':last')] ? localStorage.getItem(KEY + ':last') : Object.keys(builds)[0]);
$('boot')?.remove();   // the page is ready

// accessibility: a button with a symbol for text (✕, ↶, ⟲) is named by its title for screen readers; a clickable row or
// cell that is no button (a skill, an equipment slot: [data-sel], .cell[data-pick]) takes the keyboard's focus and Enter / Space
const ACT = '[data-sel], .cell[data-pick]';
const a11y = root => { for (const x of root.querySelectorAll?.('button[title]:not([aria-label])') || []) if (!/\p{L}/u.test(x.textContent)) x.setAttribute('aria-label', x.title);
  for (const x of root.querySelectorAll?.(ACT) || []) if (!x.hasAttribute('tabindex')) { x.tabIndex = 0; x.setAttribute('role', 'button'); } };
new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) a11y(n.parentNode || n); }).observe(document.body, { childList: true, subtree: true });
a11y(document.body);
addEventListener('keydown', e => { if ((e.key !== 'Enter' && e.key !== ' ') || !e.target.matches?.(ACT)) return;
  const { sel, pick } = e.target.dataset; e.preventDefault(); e.target.click();   // drawn anew: the focus goes back to the same one
  requestAnimationFrame(() => document.querySelector(sel != null ? `[data-sel="${CSS.escape(sel)}"]` : `.cell[data-pick="${CSS.escape(pick)}"]`)?.focus()); });
