// Build sharing: Path of Building 2 build codes, the format pobb.in, poe.ninja, Maxroll and poe2db read and write.
// A code is base64url( zlib deflate( <PathOfBuilding2> XML ) ), see PoB's src/Classes/ImportTab.lua.
import { itemText, itemNote, parseItem, swapSet } from './items.js';
import { usedBy } from './calc.js';
import { t } from './i18n.js';

// Path of Building's own ids (its tree 0_5 "classes" list): not game data, only needed to talk to PoB
const POB_CLASS = { Ranger: 2, Huntress: 8, Warrior: 6, Mercenary: 9, Druid: 11, Witch: 1, Sorceress: 7, Monk: 10 };
const POB_ASC = { Deadeye: 'Ranger1', Pathfinder: 'Ranger3', Amazon: 'Huntress1', 'Spirit Walker': 'Huntress2', Ritualist: 'Huntress3',
  Titan: 'Warrior1', Warbringer: 'Warrior2', 'Smith of Kitava': 'Warrior3', Tactician: 'Mercenary1', Witchhunter: 'Mercenary2',
  'Gemling Legionnaire': 'Mercenary3', Oracle: 'Druid1', Shaman: 'Druid2', Infernalist: 'Witch1', 'Blood Mage': 'Witch2', Lich: 'Witch3',
  'Abyssal Lich': 'Witch3b', Stormweaver: 'Sorceress1', Chronomancer: 'Sorceress2', 'Disciple of Varashta': 'Sorceress3',
  'Martial Artist': 'Monk1', Invoker: 'Monk2', 'Acolyte of Chayula': 'Monk3' };
const POB_SLOT = { weapon: 'Weapon 1', offhand: 'Weapon 2', helmet: 'Helmet', body: 'Body Armour', gloves: 'Gloves', boots: 'Boots',
  amulet: 'Amulet', ring1: 'Ring 1', ring2: 'Ring 2', ring3: 'Ring 3', belt: 'Belt', flask1: 'Flask 1', flask2: 'Flask 2', charm1: 'Charm 1', charm2: 'Charm 2', charm3: 'Charm 3',
  'swap:weapon': 'Weapon 1 Swap', 'swap:offhand': 'Weapon 2 Swap' };   // weapon set II
const rev = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [String(v), k]));
const ASC_OF = rev(POB_ASC), SLOT_OF = rev(POB_SLOT), CLASS_OF = rev(POB_CLASS);

// ---------- code <-> XML
const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
function b64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_');
}
const unb64 = s => Uint8Array.from(atob(s.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
export const encode = async xml => b64(await pipe(new TextEncoder().encode(xml), new CompressionStream('deflate')));
export const decode = async code => new TextDecoder().decode(await pipe(unb64(code), new DecompressionStream('deflate')));

const x = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// PoB's <PlayerStat> list, filled with this app's own numbers (PoB recomputes them on load; pobb.in shows them and
// refuses a <Build> with no children). Values the data cannot give (null) are left out.
function playerStats(c) {
  if (!c) return '';
  const r = c.res || {}, rows = [['Str', c.attrs?.str], ['Dex', c.attrs?.dex], ['Int', c.attrs?.int], ['Life', c.life], ['Mana', c.mana],
    ['EnergyShield', c.es], ['Spirit', c.spirit], ['Armour', c.armour], ['Evasion', c.evasion],
    ...['Fire', 'Cold', 'Lightning', 'Chaos'].map(k => [k + 'Resist', r[k.toLowerCase()]?.capped])];
  return rows.filter(([, v]) => v != null && Number.isFinite(+v)).map(([k, v]) => `<PlayerStat stat="${k}" value="${v}"/>`).join('');
}

// ctx: { stats(b): calc.js character(), N: tree nodes, gems: gems.json, clsOf(asc), ascStart(asc), classRoot(asc), roots: Set of class start ids, maxSockets }
export function toXML(b, ctx) {
  const cls = ctx.clsOf(b.asc), st = ctx.ascStart(b.asc), set1 = b.set1 || [], set2 = b.set2 || [];
  const nodes = [...new Set([...b.nodes, ...st ? [st] : [], ...b.ascNodes, ...set1, ...set2])];
  const attr = k => Object.entries(b.attrs || {}).filter(([, v]) => v === k).map(([id]) => id).join(',');
  // PoB keeps set I in Weapon 1 / 2 and set II in their Swap slots, whichever is in hand (useSecondWeaponSet)
  const hand = b.wset === 2, inHand = Object.entries(b.items || {}).map(([s, it]) => [hand && /^(weapon|offhand)$/.test(s) ? 'swap:' + s : s, it]);
  const items = [...inHand, ...Object.entries(b.swap || {}).map(([s, it]) => [hand ? s : 'swap:' + s, it])].map(([slot, it]) => [slot, itemText(it)]).filter(([, txt]) => txt);
  const iid = Object.fromEntries(items.map(([slot], i) => [slot, i + 1]));
  const byName = Object.fromEntries(ctx.gems.map(g => [g.name, g]));
  const gem = (name, level, quality = 0) => `<Gem nameSpec="${x(name)}"${byName[name] ? ` gemId="${x(byName[name].id)}"` : ''} level="${level}" quality="${quality}" enabled="true"/>`;
  const jewels = items.filter(([s]) => s.startsWith('jewel:'));
  return `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
<Build level="${b.level}" targetVersion="0_1" className="${x(cls)}" ascendClassName="${x(b.asc === cls ? 'None' : b.asc)}" mainSocketGroup="1" viewMode="TREE">${playerStats(ctx.stats?.(b))}</Build>
<Tree activeSpec="1"><Spec title="${x(b.name)}" treeVersion="0_5" classInternalId="${POB_CLASS[cls] ?? ''}" ascendancyInternalId="${POB_ASC[b.asc] ?? ''}" nodes="${nodes.join(',')}" masteryEffects="">
${[[1, set1], [2, set2]].filter(([, s]) => s.length).map(([k, s]) => `<WeaponSet${k} nodes="${s.join(',')}"/>`).join('')}
<Sockets>${jewels.map(([s]) => `<Socket nodeId="${s.slice(6)}" itemId="${iid[s]}"/>`).join('')}</Sockets>
<Overrides><AttributeOverride strNodes="${attr('str')}" dexNodes="${attr('dex')}" intNodes="${attr('int')}"/></Overrides>
</Spec></Tree>
<Skills activeSkillSet="1"><SkillSet id="1">
${b.gems.map((g, i) => usedBy(b, i) ? null : `<Skill enabled="${g.enabled !== false}" slot="" mainActiveSkill="1">${gem(g.name, g.level ?? 20, g.quality)}${
   b.gems.filter((x, k) => usedBy(b, k) === g).map(x => gem(x.name, x.level ?? 20, x.quality)).join('')}${(g.supports || []).filter(Boolean).map(s => gem(s, 1)).join('')}</Skill>`).filter(Boolean).join('\n')}
</SkillSet></Skills>
<Items activeItemSet="1">
${items.map(([s, txt]) => `<Item id="${iid[s]}">${x(txt)}</Item>`).join('\n')}
<ItemSet id="1" useSecondWeaponSet="${hand}">${items.filter(([s]) => POB_SLOT[s]).map(([s]) => `<Slot name="${POB_SLOT[s]}" itemId="${iid[s]}"/>`).join('')}</ItemSet>
</Items>
<Notes>${x(b.notes)}</Notes>
<Config activeConfigSet="1"><ConfigSet id="1" title="Default">${(ctx.quests || []).map(q => {
    const n = ctx.questPick(b, q);   // as PoB keeps them: a reward is on unless it says false, a choice is its option's own text
    return q.pick ? n ? `<Input name="${x(q.key)}" string="${x(q.options[n - 1].text)}"/>` : '' : n ? '' : `<Input name="${x(q.key)}" boolean="false"/>`;
  }).join('')}</ConfigSet></Config>
</PathOfBuilding2>`;
}

// -> { build, warn: [what could not be read], specs: [each tree's title], active: the open one's index }; at: the tree to
// read (an index of specs), else the one Path of Building had open
export function fromXML(xml, ctx, blank, at) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml'), root = doc.documentElement;
  if (doc.querySelector('parsererror') || root.nodeName !== 'PathOfBuilding2') throw new Error('not a Path of Building 2 build');
  const kids = (el, name) => el ? [...el.children].filter(c => c.nodeName === name) : [];
  const ids = s => (s || '').split(',').map(v => v.trim()).filter(v => ctx.N[v]);
  const warn = [], b = blank();
  const build = kids(root, 'Build')[0], tree = kids(root, 'Tree')[0];
  b.level = Math.min(100, Math.max(1, +build?.getAttribute('level') || 1));
  const specs = kids(tree, 'Spec'), openSpec = Math.max(0, specs.indexOf(specs[(+tree?.getAttribute('activeSpec') || 1) - 1])), spec = specs[at ?? openSpec];
  // ascendancy: PoB's internal id, else the names; a build without one has the base class alone
  const asc = ASC_OF[spec?.getAttribute('ascendancyInternalId')] || build?.getAttribute('ascendClassName');
  const cls = CLASS_OF[spec?.getAttribute('classInternalId')] || build?.getAttribute('className');
  b.asc = ctx.ascs.find(a => a.name === asc)?.name || ctx.ascs.find(a => a.class === cls)?.class || b.asc;
  b.name = spec?.getAttribute('title') || b.asc;
  if (spec) {
    const sets = [1, 2].map(k => new Set(ids(kids(spec, 'WeaponSet' + k)[0]?.getAttribute('nodes'))));
    const main = [], ascN = [];
    for (const id of ids(spec.getAttribute('nodes'))) {
      const n = ctx.N[id];
      if (n.ascendancy) { if (n.ascendancy === b.asc && !n.ascendancy_start) ascN.push(id); }
      else if (sets[0].has(id) || sets[1].has(id) || ctx.roots.has(id)) continue;
      else main.push(id);
    }
    const start = ctx.classRoot(b.asc);
    b.nodes = main.length || sets[0].size || sets[1].size ? [start, ...main] : [];
    b.ascNodes = ascN; b.set1 = [...sets[0]]; b.set2 = [...sets[1]];
    const ov = spec.querySelector('Overrides > AttributeOverride');
    b.attrs = {};
    if (ov) for (const k of ['str', 'dex', 'int']) for (const id of ids(ov.getAttribute(k + 'Nodes'))) b.attrs[id] = k;
  }
  // skills: each active gem of a group gets that group's supports
  const byId = Object.fromEntries(ctx.gems.map(g => [g.id, g])), byName = Object.fromEntries(ctx.gems.map(g => [g.name.toLowerCase(), g]));
  const skills = kids(root, 'Skills')[0], set = kids(skills, 'SkillSet');
  const active = set.find(s => s.getAttribute('id') === skills.getAttribute('activeSkillSet')) || set[0] || skills;
  b.gems = [];
  for (const sk of kids(active, 'Skill')) {
    const gs = kids(sk, 'Gem').map(e => {
      const g = byId[e.getAttribute('gemId')] || byName[(e.getAttribute('nameSpec') || '').toLowerCase()];
      if (!g) warn.push(e.getAttribute('nameSpec') || e.getAttribute('gemId'));
      return g && { g, level: +e.getAttribute('level') || 20, quality: +e.getAttribute('quality') || 0 };
    }).filter(Boolean);
    const sup = gs.filter(o => o.g.kind === 'support').map(o => o.g.name).slice(0, ctx.maxSockets);
    // a skill the tree or an item grants comes twice from an imported character: as the game lists it, and as PoB adds it
    const again = sk.getAttribute('source') ? b.gems.map(g => g.name) : [];
    // a meta gem and the skills in it are one group (Mortar Cannon and its Cluster Grenade): those skills go in it
    const act = gs.filter(o => o.g.kind !== 'support' && !again.includes(o.g.name)), meta = act.find(o => o.g.tags?.includes('meta'));
    const metaN = meta && b.gems.filter(x => x.name === meta.g.name).length;   // the build's second meta gem of that name, or third...
    for (const o of act)
      b.gems.push({ name: o.g.name, level: o.level, ...o.quality ? { quality: o.quality } : {}, sockets: Math.min(ctx.maxSockets, Math.max(2, sup.length + (o === meta ? act.length - 1 : 0))),
        supports: [...sup], ...meta && o !== meta && { meta: meta.g.name, ...metaN && { metaN } }, ...sk.getAttribute('enabled') === 'false' && { enabled: false } });
  }
  // items: the active item set's slots, and the tree's jewel sockets
  const itemsEl = kids(root, 'Items')[0], text = {};
  for (const it of kids(itemsEl, 'Item')) text[it.getAttribute('id')] = it.textContent;
  const isets = kids(itemsEl, 'ItemSet'), iset = isets.find(s => s.getAttribute('id') === itemsEl?.getAttribute('activeItemSet')) || isets[0];
  const place = [...kids(iset, 'Slot').map(s => [SLOT_OF[s.getAttribute('name')], s.getAttribute('itemId')]),
    ...spec ? kids(kids(spec, 'Sockets')[0], 'Socket').map(s => ['jewel:' + s.getAttribute('nodeId'), s.getAttribute('itemId')]) : []];
  b.items = {}; delete b.swap;
  for (const [slot, id] of place) {
    if (!slot || !text[id]) continue;
    const r = parseItem(text[id]);
    if (!r) { warn.push(text[id].split('\n').map(l => l.trim()).filter(Boolean).slice(1, 3).join(' ')); continue; }
    const it = r.name ? { ...r.item, name: r.name } : r.item;   // a rare's name, written back on export
    if (slot.startsWith('swap:')) (b.swap ||= {})[slot.slice(5)] = it; else b.items[slot] = it;
    warn.push(...r.missed);
  }
  b.wset = 1; if (iset?.getAttribute('useSecondWeaponSet') === 'true') swapSet(b, 2);
  b.notes = kids(root, 'Notes')[0]?.textContent.trim() || '';
  // the level is the build's own, and so are its campaign rewards (the active <ConfigSet>, written as in toXML)
  b.lvl = b.level;
  const config = kids(root, 'Config')[0], sets = kids(config, 'ConfigSet'), flat = s => (s || '').replace(/\s+/g, ' ').trim();
  const input = Object.fromEntries(kids(sets.find(s => s.getAttribute('id') === config.getAttribute('activeConfigSet')) || sets[0] || config, 'Input').map(e => [e.getAttribute('name'), e]));
  b.quests = {};
  for (const q of ctx.quests || []) b.quests[q.key] = q.pick ? q.options.findIndex(o => flat(o.text) === flat(input[q.key]?.getAttribute('string'))) + 1
    : +(input[q.key]?.getAttribute('boolean') !== 'false');
  return { build: b, warn, specs: specs.map(s => s.getAttribute('title') || ''), active: openSpec };
}

// ---------- the game's own build planner (0.5): a .build JSON file, read from Documents/My Games/Path of Exile 2/BuildPlanner
// Layout as Path of Building 2 writes it (src/Modules/BuildExportPoE2.lua). The file has no levels, attributes or items:
// gem levels and the gear go in as notes the planner shows.
const INVENTORY = {   // game InventoryId + position, from PoB's generated src/Data/InventorySlots.lua
  weapon: ['Weapon1', 0], offhand: ['Offhand1', 0], helmet: ['Helm1', 0], body: ['BodyArmour1', 0], gloves: ['Gloves1', 0],
  boots: ['Boots1', 0], amulet: ['Amulet1', 0], ring1: ['Ring1', 0], ring2: ['Ring2', 0], belt: ['Belt1', 0],
  flask1: ['Flask1', 0], flask2: ['Flask1', 1], charm1: ['Flask1', 2], charm2: ['Flask1', 3], charm3: ['Flask1', 4] };
export const TREE_VERSION = '0.5';
export function toBuildFile(b, ctx, en = false) {   // en: in English, not the page's language
  const st = ctx.ascStart(b.asc), byName = Object.fromEntries(ctx.gems.map(g => [g.name, g]));
  // the game's ascendancy id is the one in its start node's id (AscendancyWitch1Start__ -> Witch1)
  const ascendancy = ctx.N[st]?.id.match(/^Ascendancy(.+?)Start/)?.[1] || POB_ASC[b.asc];
  const set = {};
  for (const [k, s] of [[1, b.set1], [2, b.set2]]) for (const id of s || []) set[id] = k;
  const passives = [...new Set([...b.nodes, ...st ? [st] : [], ...b.ascNodes, ...Object.keys(set)])]
    .filter(id => ctx.N[id]?.id).map(id => ({ id: ctx.N[id].id, weapon_set: set[id] || 0 }));
  const skills = b.gems.filter(g => byName[g.name]).map(g => {
    const sup = (g.supports || []).filter(n => byName[n]).map(n => byName[n].id);
    return { id: byName[g.name].id, additional_text: (en ? 'Level' : t('Level')) + ' ' + (g.level ?? 20), ...sup.length ? { support_skills: sup } : {} };
  });
  const inventory_slots = Object.entries(b.items || {}).filter(([slot]) => INVENTORY[slot])
    .map(([slot, it]) => ({ inventory_id: INVENTORY[slot][0], slot_x: INVENTORY[slot][1], ...it.unique && { unique_name: it.unique }, additional_text: itemNote(it, en) }))
    .filter(s => s.additional_text || s.unique_name);   // a unique by its name, as the official format has it
  return JSON.stringify({ name: b.name || (en ? 'Unnamed' : t('Unnamed')), ...ascendancy ? { ascendancy } : {}, ...b.notes ? { description: b.notes } : {},
    passives, skills, inventory_slots }, null, 2);
}
export const buildFileName = b => (b.name || 'Unnamed').replace(/[\\/:*?"<>|\x00-\x1f]/g, '-') + ` [${TREE_VERSION}].build`;

// ---------- sites (through serve.py: browsers block them from this page)
export const SITES = [
  { id: 'pobbin', name: 'pobb.in', home: 'https://pobb.in/' },
  { id: 'poeninja', name: 'poe.ninja', home: 'https://poe.ninja/poe2/pob' },
  { id: 'maxroll', name: 'Maxroll', home: 'https://maxroll.gg/poe2/planner' },
  { id: 'poe2db', name: 'poe2db', home: 'https://poe2db.tw/pob/' },
];
export async function upload(site, code) {
  const r = await fetch('/share/upload?site=' + site, { method: 'POST', body: code });
  const out = (await r.text()).trim();
  if (!r.ok || !/^https:\/\//.test(out)) throw new Error(out || r.statusText);
  return out;
}
export async function download(link) {
  const r = await fetch('/share/download?url=' + encodeURIComponent(link));
  if (!r.ok) throw new Error((await r.text()) || r.statusText);
  return (await r.text()).trim();
}
