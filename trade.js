// Gear search on the official Path of Exile 2 trade site (pathofexile.com/trade2), the way Path of Building does it:
// work out what each modifier a slot can roll is worth to the build, look for listed items that have those modifiers,
// then put every item found on the build and rank them by what the calculation says they really change.
// The page cannot call the trade site itself (browsers block it, CORS): serve.py passes the calls on (/trade/...).
// Without logging in the site refuses weighted searches ("Query is too complex"), so the anonymous search asks for
// the items with the most of each of the best modifiers (or the best damage / defence of the item) and reads those;
// the weighted search itself is offered as a link that opens on the official site, where the user is logged in.
// No DOM here: optview.js is the screen.
import { affixLines, tradeItem, priceLines, classOf } from './items.js';

const SITE = 'https://www.pathofexile.com/trade2/search/poe2/';
// item class (items.json) -> the trade site's category
export const CATEGORY = {
  'One Hand Maces': 'weapon.onemace', 'Two Hand Maces': 'weapon.twomace', Quarterstaves: 'weapon.warstaff', Bows: 'weapon.bow', Crossbows: 'weapon.crossbow',
  Spears: 'weapon.spear', Wands: 'weapon.wand', Sceptres: 'weapon.sceptre', Staves: 'weapon.staff', Talismans: 'weapon.talisman',
  'One Hand Swords': 'weapon.onesword', 'Two Hand Swords': 'weapon.twosword', 'One Hand Axes': 'weapon.oneaxe', 'Two Hand Axes': 'weapon.twoaxe',
  Daggers: 'weapon.dagger', Flails: 'weapon.flail', Claws: 'weapon.claw',
  Helmets: 'armour.helmet', 'Body Armours': 'armour.chest', Gloves: 'armour.gloves', Boots: 'armour.boots', Quivers: 'armour.quiver',
  Shields: 'armour.shield', Foci: 'armour.focus', Bucklers: 'armour.buckler', Amulets: 'accessory.amulet', Belts: 'accessory.belt', Rings: 'accessory.ring',
};
export const SEARCH_SLOTS = ['weapon', 'offhand', 'helmet', 'body', 'gloves', 'boots', 'amulet', 'ring1', 'ring2', 'belt'];
export const STATUS = { securable: 'Instant buyout', available: 'Instant buyout or in person', any: 'Any' };
// the currencies the site prices in: the game's names and art (available.py: currency.json); `price` is the site's price
// filter, whose first option ('': no currency) is any currency worth the same in Exalted Orbs
export const MONEY = await fetch('poe2_data/available/currency.json').then(r => r.ok ? r.json() : null).catch(() => null) || { price: ['', 'exalted', 'divine', 'chaos'], currency: {} };
export const CURRENCY = MONEY.price;

// ---------- what to look for
// The modifier lines an item of class `cls` can roll, each with what its best roll adds to the build's number.
// value(items) is that number for the build wearing `items`; items: what the build wears now; slot: where the item goes.
// -> [{ hash, text, local, stats, roll, gain }] best first, only those that add something
export function wanted({ cls, slot, items, value }) {
  const memo = new Map(), at = it => { const k = JSON.stringify(it); return memo.get(k) ?? (memo.set(k, value({ ...items, [slot]: it }) || 0), memo.get(k)); };
  return affixLines(cls, items[slot]?.base).map(o => ({ ...o, gain: Math.max(...o.tries.map(x => at(x.item) - at(x.bare))) }))
    .filter(o => o.gain > 1e-9).sort((a, b) => b.gain - a.gain);
}

// ---------- the trade site
export class TradeError extends Error { constructor(msg, kind, wait) { super(msg); this.kind = kind; this.wait = wait; } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
// What the site allows: [calls, seconds] windows per kind of call (it says so in every answer: "5:10:60" is 5 calls
// in 10 seconds, or 60 seconds locked out). Going over locks out for longer each time, so the planner counts its own
// calls and stays one short of every window: a short wait is slept, a long one is told to the user.
const LIMITS = { search: [[5, 10], [15, 60], [30, 300]], fetch: [[12, 4], [16, 12]] }, sent = { search: [], fetch: [] };
const kindOf = path => path.startsWith('search') ? 'search' : path.startsWith('fetch') ? 'fetch' : null;
function waitFor(kind, now = Date.now()) {   // seconds until one more call of this kind fits
  let w = 0;
  for (const [n, secs] of LIMITS[kind]) {
    const m = Math.max(1, n - 1), inside = sent[kind].filter(x => x > now - secs * 1000);
    if (inside.length >= m) w = Math.max(w, (inside[inside.length - m] + secs * 1000 - now) / 1000);
  }
  return w;
}
const rules = h => (h || '').split(',').map(x => x.split(':').slice(0, 2).map(Number)).filter(([n, secs]) => n > 0 && secs > 0);
let last = 0;
// one call at a time, spaced out; a wait longer than `patience` seconds is told instead
async function call(path, body, patience = 8) {
  const kind = kindOf(path);
  if (kind) { const w = waitFor(kind); if (w > patience) throw new TradeError('rate limit', 'wait', Math.ceil(w)); if (w > 0) await sleep(w * 1000); }
  const gap = last + 1100 - Date.now(); if (gap > 0) await sleep(gap);
  last = Date.now();
  let r;
  try { r = await fetch('trade/' + path, body ? { method: 'POST', body: JSON.stringify(body) } : undefined); }
  catch { throw new TradeError('no server', 'offline'); }
  if (kind) {
    sent[kind] = [...sent[kind].filter(x => x > last - 1800e3), last];
    const now = [...rules(r.headers.get('X-Rate-Limit-Ip')), ...rules(r.headers.get('X-Rate-Limit-Account'))];
    if (now.length) LIMITS[kind] = now;
  }
  const txt = await r.text();
  let j = null; try { j = JSON.parse(txt); } catch { /* not the proxy: a plain file server answers 404 / 501 in HTML */ }
  if (r.status === 429) throw new TradeError(j?.error?.message || 'rate limited', 'wait', +r.headers.get('Retry-After') || 60);
  if (!j || !r.ok && !j.error) throw new TradeError(txt.slice(0, 200), r.status === 404 || r.status === 501 ? 'offline' : 'site');
  if (j.error) throw new TradeError(j.error.message || String(j.error), 'site');
  return j;
}
const cache = {};
const data = kind => cache[kind] ||= call('data/' + kind).catch(e => { delete cache[kind]; throw e; });
export const leagues = () => data('leagues').then(j => j.result.filter(l => l.realm === 'poe2').map(l => l.id));

// adds .id (the site's stat) to each line: "explicit.stat_<number>", the number Path of Building's data gives the
// modifier. When the site's own list can be read, a line it does not have gets none. A desecrated line is found by
// its wording in the site's "desecrated" list ("+86 to maximum Life" is "# to maximum Life"); none without that list.
// The site keeps "+#" in some lines and has its own case; it writes some "reduced" lines as "increased": the exact
// wording first, then that one (the first entry of each wording kept). note: such a line weighs the wrong way in
// the weighted search (its number is negative there); flip its weight if one ever ranks high
const shape = (s, loose) => { s = s.replace(/[+-]?\d+(\.\d+)?/g, '#').replace(/\+/g, '').replace(/\bmetres\b/g, 'metre').toLowerCase().trim();
  return loose ? s.replace(/\breduced\b/g, 'increased') : s; };
// -> { known: the site's stat ids (null when it cannot be asked), desecrated(en): the id of that desecrated line,
//      total(hash): the site's total of that stat over every line of an item ("+# total to Dexterity" for
//      "+# to Dexterity": an attribute or a resistance), when it has one }
async function statIndex() {
  let known = null;
  const des = [new Map(), new Map()], text = new Map(), totals = new Map(), worded = new Map();
  try {
    const groups = (await data('stats')).result;
    known = new Set(groups.flatMap(g => g.entries.map(e => e.id)));
    for (const e of groups.find(g => g.id === 'desecrated')?.entries || []) des.forEach((m, loose) => m.has(shape(e.text, loose)) || m.set(shape(e.text, loose), e.id));
    for (const e of groups.find(g => g.id === 'explicit')?.entries || []) text.set(e.id, shape(e.text));
    for (const g of groups.filter(g => ['explicit', 'crafted', 'fractured', 'desecrated'].includes(g.id))) for (const e of g.entries) worded.has(shape(e.text)) ? worded.get(shape(e.text)).push(e.id) : worded.set(shape(e.text), [e.id]);
    for (const e of groups.find(g => g.id === 'pseudo')?.entries || []) if (/ total to /.test(e.text)) totals.set(shape(e.text.replace(' total to ', ' to ')), e.id);
  } catch (e) { if (!(e instanceof TradeError)) throw e; }
  const desecrated = en => des[0].get(shape(en)) || des[1].get(shape(en, 1)) || null, total = hash => totals.get(text.get('explicit.stat_' + hash)) || null;
  // the site's stats for one of priceLines' lines: a desecrated one by its wording, an attribute or a resistance as the
  // item's total of it, any other as a normal, crafted, fractured or desecrated modifier alike
  const idsOf = l => l.en ? [desecrated(l.en)].filter(Boolean) : total(l.hash) ? [total(l.hash)]
    : ['explicit', 'crafted', 'fractured', 'desecrated'].map(k => `${k}.stat_${l.hash}`).filter(id => known ? known.has(id) : id.startsWith('explicit'));
  // a line the app does not know (no modifier of its data words it so: "+3 to Level of all Attack Skills"), by the
  // site's own wording of it, as any kind of modifier (English text only)
  const byWords = line => worded.get(shape(line)) || [];
  return { known, desecrated, idsOf, byWords };
}
export async function withIds(wants) {
  const { known, desecrated } = await statIndex();
  return wants.map(w => { const id = w.desecrated ? desecrated(w.en) : 'explicit.stat_' + w.hash;
    return { ...w, id: w.desecrated || !known || known.has(id) ? id : null }; });
}

// the item's own numbers the site can sort by, from the local modifiers worth having
const PROP = [[/local_.*physical_damage(?!_reduction)/, 'pdps'], [/local_.*(fire|cold|lightning|chaos)_damage/, 'edps'], [/local_attack_speed|local_critical_strike/, 'dps'],
  [/physical_damage_reduction_rating|armour/, 'ar'], [/evasion/, 'ev'], [/energy_shield/, 'es']];
const propOf = w => { if (!w.local) return null; for (const [re, key] of PROP) if (w.stats.some(id => re.test(id))) return key; return null; };

// level: the character's, to leave out what it cannot wear yet
const filters = (cls, price, level) => ({ type_filters: { filters: { category: { option: CATEGORY[cls] } } },
  ...(level > 0 && { req_filters: { filters: { lvl: { max: +level } } } }),
  ...(price?.max > 0 && { trade_filters: { filters: { price: { max: +price.max, ...(price.currency && { option: price.currency }) } } } }) });
// The searches an anonymous visitor can make, best first (at most `n`): the most of one good modifier (with at least
// one more of the others), or the highest damage / defence of the item when its local modifiers are what counts.
export function plans({ cls, wants, price, level, state = 'securable', n = 3 }) {
  const out = new Map();
  for (const w of wants) {
    const prop = propOf(w), key = prop || (w.id && 'stat.' + w.id);
    if (!key || out.has(key)) continue;
    const others = wants.filter(o => o.id && o !== w && !propOf(o)).slice(0, 8);
    const stats = prop ? [] : [{ type: 'and', filters: [{ id: w.id }] }, ...others.length ? [{ type: 'count', value: { min: 1 }, filters: others.map(o => ({ id: o.id })) }] : []];
    out.set(key, { key, by: prop ? null : w, prop, gain: w.gain, body: { query: { status: { option: state }, stats, filters: filters(cls, price, level) }, sort: { [key]: 'desc' } } });
    if (out.size >= n) break;
  }
  return [...out.values()];
}
// The search Path of Building makes: every modifier weighted by what one point of it is worth, best total first.
// The site only runs it for logged-in users.
export function weighted({ cls, wants, price, level, state = 'securable' }) {
  const list = wants.filter(w => w.id && w.roll > 0).slice(0, 30);
  if (!list.length) return null;
  const top = Math.max(...list.map(w => w.gain / w.roll));
  return { query: { status: { option: state }, filters: filters(cls, price, level),
    stats: [{ type: 'weight', value: { min: 1 }, filters: list.map(w => ({ id: w.id, value: { weight: +(100 * w.gain / w.roll / top).toPrecision(3) } })) }] }, sort: { 'statgroup.0': 'desc' } };
}
export const siteLink = (league, queryId) => SITE + encodeURIComponent(league) + (queryId ? '/' + queryId : '');
export const siteQuery = (league, body) => SITE + encodeURIComponent(league) + '?q=' + encodeURIComponent(JSON.stringify(body));

// ---------- reading what the site lists
const plain = s => String(s).replace(/\[(?:[^\]|]*\|)?([^\]]*)\]/g, '$1');   // "[Resistances|Fire Resistance]" -> "Fire Resistance"
const KINDS = { implicitMods: 'implicit', explicitMods: 'explicit', fracturedMods: 'fractured', desecratedMods: 'desecrated', craftedMods: 'crafted' };
// the lines of one kind: text, the site's stat and the modifiers behind it (an old-style listing only has the text)
const linesOf = (it, key) => (it[key] || []).map(m => typeof m === 'string' ? { text: plain(m), kind: KINDS[key], mods: [] } : { text: plain(m.description || ''), kind: KINDS[key],
  hash: +/(\d+)$/.exec(m.hash || '')?.[1] || 0, mods: (m.mods || []).map(x => ({ name: x.name, level: x.level, mags: (x.magnitudes || []).map(g => [+g.min, +g.max]) })) });
// -> { id, name, base, rarity, mods: [text], extra: [runes and enchants, never counted], price: { amount, currency }, seller,
//      item (for the build, null when the app does not have its base), slots, missed: [lines not counted] }
export function readListing(r) {
  const it = r.item || {}, lines = Object.keys(KINDS).flatMap(k => linesOf(it, k)), name = plain(it.name || ''), base = plain(it.baseType || it.typeLine || '');
  const p = tradeItem({ name, base, lines });
  return { id: r.id, name, base, rarity: (it.rarity || '').toLowerCase(), ilvl: it.ilvl, mods: lines.map(l => l.text),
    extra: ['enchantMods', 'runeMods'].flatMap(k => linesOf(it, k).map(l => l.text)), quality: +(it.properties || []).find(x => /Quality/.test(x.name))?.values?.[0]?.[0]?.replace(/\D/g, '') || 0,
    price: r.listing?.price ? { amount: r.listing.price.amount, currency: r.listing.price.currency } : null, seller: r.listing?.account?.name || '',
    item: p?.item || null, slots: p?.slots || [], missed: p?.missed || [] };
}

// ---------- the price check: what an item like this one is worth
// Looks for listed items like it: the same base (a unique: the same unique; a rare weapon or armour: the same kind)
// whose numbers are near its own. Its own
// damage per second or armour / evasion / energy shield (propsOf: from the copied text, quality and runes included, as
// the site counts them) stand for the lines that make them (local ones); every other line (priceLines; a unique's only
// those that can roll otherwise) is asked as a normal, crafted, fractured or desecrated modifier alike, an attribute or
// a resistance as the item's total of it (as Exiled Exchange 2 asks them). All of them at most `near` % under its own
// and with no top (range; Settings; not rounded, and a number never goes past 1 towards 0: "+1 to …" stays 1 at any
// %), all of them: one it lacks is not alike.
// Without any, only the name and base. The site sorts the listings by what they are worth whatever the currency, so the
// order is the price's: no exchange rate is needed. What the cheapest alike ones ask is the answer, as listed.
// -> { total, near (the tolerance; null: only the name and base), within (how many of its `of` lines), raised (lines whose % went up to upTo),
//      prices: [{ amount, currency }] (the cheapest alike ones, at most MANY), id (the search) }
const MANY = 10, WIDE = 30;
const around = (v, near) => { if (!v) return null; const d = Math.abs(v) * near / 100, r = x => +x.toFixed(2);
  return v > 0 ? { min: r(Math.max(v - d, Math.min(v, 1))), max: r(v + d) } : { min: r(v - d), max: r(Math.min(v + d, Math.max(v, -1))) }; };
// at least the % under it, with no top (more of it is no less like it, and can ask less), as Exiled Exchange 2
// searches. A negative number keeps both ends: which way is better there is the line's own
const range = (v, near) => { const r = around(v, near); return r && v > 0 ? { min: r.min } : r; };
console.assert(JSON.stringify(range(30, 10)) === '{"min":27}' && range(-43, 10).max === -38.7 && range(0, 10) === null, 'range');
console.assert(around(1, 50).min === 1 && around(-43, 10).max === -38.7 && around(-1, 90).max === -1 && around(30, 10).min === 27, 'around');
// the lowest of the steps 5 by 5 over `near` (up to WIDE, which finds something) that finds something: `at` asked
// about half the steps each time, since a wider % finds all a narrower one does
async function lowest(near, at) {
  const steps = [];
  for (let p = near + 5; p < WIDE; p += 5) steps.push(p);
  steps.push(WIDE);
  let lo = 0, hi = steps.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (await at(steps[m])) hi = m; else lo = m + 1; }
  return steps[hi];
}
lowest(10, async p => p >= 20).then(p => console.assert(p === 20, 'lowest'));
// the numbers the site filters weapons and armour by, from the item's text in English (none in another language)
export function propsOf(text) {
  const avg = re => [...(text.match(re)?.[1] || '').matchAll(/(\d+)-(\d+)/g)].reduce((s, m) => s + (+m[1] + +m[2]) / 2, 0);
  const one = re => +(text.match(re)?.[1] || 0), aps = one(/^Attacks per Second: ([\d.]+)/m);
  const p = { pdps: avg(/^Physical Damage: (.+)$/m) * aps, edps: avg(/^Elemental Damage: (.+)$/m) * aps,
    ar: one(/^Armour: (\d+)/m), ev: one(/^Evasion Rating: (\d+)/m), es: one(/^Energy Shield: (\d+)/m) };
  return Object.fromEntries(Object.entries(p).filter(([, v]) => v > 0).map(([k, v]) => [k, Math.round(v * 10) / 10]));
}
console.assert(JSON.stringify(propsOf('Physical Damage: 280-615 (augmented)\nAttacks per Second: 1.40')) === '{"pdps":626.5}', 'propsOf');
// what the cheapest listings of search s ask (at most MANY), but those skip(item) says to leave out
async function cheapest(s, skip = () => false) {
  const ids = (s.result || []).slice(0, MANY);
  return ids.length ? ((await call(`fetch?ids=${ids.join()}&query=${encodeURIComponent(s.id)}`)).result || []).filter(r => r?.listing?.price && !skip(r.item)).map(r => r.listing.price) : [];
}
// an unidentified item (sold so, since its modifiers are a gamble): the unidentified ones of its base and rarity listed,
// of its item level or more (a higher one can roll better modifiers; a unique's does not matter), corrupted or not as
// it is (English text only: else either). -> as priceOf
export async function priceUnid({ league, item, rarity, ilvl, corrupted, state = 'available' }) {
  const s = await call('search?league=' + encodeURIComponent(league), { query: { status: { option: state }, type: item.base, filters: {
    type_filters: { filters: { rarity: { option: rarity === 'normal' || !rarity ? 'nonunique' : rarity }, ...ilvl && rarity !== 'unique' && { ilvl: { min: ilvl } } } },
    misc_filters: { filters: { identified: { option: 'false' }, ...corrupted != null && { corrupted: { option: String(corrupted) } } } } } },
    sort: { price: 'asc' } });
  return { total: s.total, prices: await cheapest(s), id: s.id, ilvl: rarity !== 'unique' && ilvl };
}
// what else an item like it must be, as Exiled Exchange 2 asks: a non-unique one no unique (of its base); not
// corrupted when it is not (a corrupted one: either, as corruption can add or spoil); not mirrored nor sanctified
// unless it is (a non-unique); at least its rune sockets when corrupted (the only way past its base's); at least its
// quality where quality is worth something: a flask's over 20, a charm's 10 or more, a weapon's or armour's over 20
// but on a rare one (whose crafting is done)
const QUALITY = { Charms: 10, 'Life Flasks': 21, 'Mana Flasks': 21 };
function sameAs(r) {
  const unique = !!r.item.unique, cls = classOf(r.item), q = r.item.quality || 0, cat = CATEGORY[cls] || '';
  const atQ = q >= (QUALITY[cls] ?? (/^(weapon|armour)\./.test(cat) && r.rarity !== 'rare' ? 21 : Infinity));
  return {
    type_filters: { ...!unique && { rarity: { option: 'nonunique' } }, ...atQ && { quality: { min: q } } },
    misc_filters: { ...!r.corrupted && { corrupted: { option: 'false' } }, ...!unique && !r.mirrored && { mirrored: { option: 'false' } },
      ...!unique && !r.sanctified && !r.corrupted && { sanctified: { option: 'false' } } },
    equipment_filters: { ...r.corrupted && r.sockets && { rune_sockets: { min: r.sockets } } } };
}
// r: parseItem's (its item, rarity, corrupted...)
export async function priceOf({ league, r, text = '', state = 'available', near = 10, deep = false }) {
  const item = r.item;
  const props = propsOf(text);
  const { desecrated, idsOf, byWords } = await statIndex();
  const unknown = (r.missed || []).map(l => ({ text: l, ids: byWords(l), value: +(l.match(/[+-]?\d+(\.\d+)?/)?.[0] || 0) })).filter(l => l.ids.length);
  const lines = [...unknown, ...priceLines(item).filter(l => l.varies && !(l.local && Object.keys(props).length))
    .map(l => ({ ...l, ids: idsOf(l) }))]
    .filter(l => l.ids.length).slice(0, 8), n = lines.length;
  // a rare weapon or armour whose damage or defence is asked: any base of its kind, as Exiled Exchange 2 asks (the
  // base gives nothing more than those); a ring, amulet or belt keeps its base, whose own line is not asked
  const cat = !item.unique && Object.keys(props).length && CATEGORY[classOf(item)];
  const query = { status: { option: state }, ...(!cat && { type: item.base }), ...(item.unique && { name: item.unique }) };
  const also = sameAs(r), group = (k, f) => Object.keys(f).length ? { [k]: { filters: f } } : {};
  const filters = { ...group('type_filters', { ...also.type_filters, ...cat && { category: { option: cat } } }),
    ...group('equipment_filters', { ...also.equipment_filters, ...Object.fromEntries(Object.entries(props).map(([k, v]) => [k, range(v, near)])) }),
    ...group('misc_filters', also.misc_filters) };
  // at least k of its lines, each as normal, crafted, fractured or desecrated (an item has one of them), line i
  // at most pct(i) % under its number. Cheapest first
  const search = (k, pct) => call('search?league=' + encodeURIComponent(league), { query: { ...query, filters,
    stats: k ? [{ type: 'count', value: { min: k }, filters: lines.flatMap((l, i) => l.ids.map(id => ({ id, ...range(l.value, pct(i)) && { value: range(l.value, pct(i)) } }))) }] : [] },
    sort: { price: 'asc' } }, deep ? 65 : 8);   // a thorough search waits its turn
  // all of them within the %; nothing, and `deep` (Settings): one line at a time, its % alone raised 5 by 5 up to WIDE,
  // then every line at the % it found something with. Still nothing: any one line left out. Then there is none.
  // Fewer searches (the site lets a few through at a time): all of them at WIDE first (nothing even so: no line alone
  // finds any), each line at WIDE (nothing: one search spent on it), and its lowest step halving the steps left
  let s = await search(n, () => near), k = n, wide = {}, pct = () => near;
  if (!s.total && n && deep) {
    if (near < WIDE && (await search(n, () => WIDE)).total) for (const [i, l] of lines.entries()) {
      if (!around(l.value, near)) continue;
      const at = async p => (await search(n, j => j === i ? p : near)).total;
      if (n > 1 && !await at(WIDE)) continue;   // one line: the search before asked just that
      wide[i] = await lowest(near, at);
    }
    if (Object.keys(wide).length) s = await search(n, pct = i => wide[i] || near);
    else if (n > 1) s = await search(k = n - 1, pct);
  }
  // a listing with a skill level line this one does not have ("+3 to Level of all Attack Skills", by the site's stat
  // number and wording) can be many times dearer: never one of the prices shown. note: only those, as every rare alike
  // has some other line, and which other ones raise a price this much is no table's
  const ours = new Set([...priceLines(item).map(l => l.hash ? String(l.hash) : l.en && desecrated(l.en)?.split('_').pop()), ...unknown.flatMap(l => l.ids.map(id => id.split('_').pop()))].filter(Boolean));
  const more = it => ['explicitMods', 'fracturedMods', 'craftedMods', 'desecratedMods'].flatMap(k => it?.[k] || [])
    .some(m => m.hash && !ours.has(/(\d+)$/.exec(m.hash)?.[1]) && /\bto Level of\b/i.test(m.description || ''));
  const sided = n || Object.keys(props).length;
  // what the cheapest alike ones ask (as Exiled Exchange 2 lists them): no range worked out of them
  const prices = await cheapest(s, more);
  const raised = Object.values(wide);
  return { total: s.total, near: sided ? near : null, within: k, of: n, raised: raised.length, upTo: Math.max(0, ...raised), prices, id: s.id };
}

// ---------- the search
// Runs the searches, reads the first `per` items of each and rates them: value(items) with the item in `slot`.
// tick(text key, args): progress. -> { found: [{ ...listing, value, plan }] best first, searches: [{ plan, id, total }],
// unread (listed items the app has no base for), errors: [TradeError] }
export async function findGear({ league, cls, slot, items, value, wants, price, level, state, per = 10, tick }) {
  const todo = plans({ cls, wants, price, level, state }), out = { found: [], searches: [], unread: 0, errors: [] }, seen = new Set();
  for (const plan of todo) {
    tick?.('Searching the trade site ({0} of {1})…', out.searches.length + out.errors.length + 1, todo.length);
    if (!await search(out, seen, { league, slot, items, value, per, tick }, plan) && out.errors.at(-1)?.kind !== 'site') break;   // the site turned this search down: the others may still run
  }
  out.found.sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
  return out;
}
// The lines of an item (priceLines, or picked by hand: { hash | en (desecrated), kind, value }) as the site's
// conditions: every one of them, each as the kind of modifier it is (normal, fractured, crafted, desecrated: the site's
// groups; none given: normal) and at least its number (a negative one, or 0: just having it). -> { stats, asked, left }
async function asLines(lines) {
  const { known, desecrated } = await statIndex(), kind = l => `${l.kind || 'explicit'}.stat_${l.hash}`;
  const asked = lines.map(l => ({ ...l, id: l.en ? desecrated(l.en) : known && !known.has(kind(l)) ? null : kind(l) })).filter(l => l.id);
  return { asked, left: lines.length - asked.length,
    stats: asked.length ? [{ type: 'and', filters: asked.map(l => ({ id: l.id, ...l.value > 0 && { value: { min: Math.round(l.value * 100) / 100 } } })) }] : [] };
}
// the best the price lets through first: the dearest under it, and down from there (an anonymous search cannot sort
// by the modifiers themselves: "Query is too complex"). Those 10 are shown cheapest first
const DEAREST = { price: 'desc' };
// Items better than `item`, from the Equipment tab: every line it has (asLines), of its kind of item (`base`: of its
// base; a unique: that unique), up to the price, the first 10 down from the dearest, each with how far over the item's
// own numbers its lines go (the mean of theirs / its). note: its implicits and runes are not asked: the data has no
// trade stat for them.
// -> { found: [{ ...listing, up (that mean - 1) }], body (the search, to open on the site), left (lines the site has no stat for) }
const lineKey = l => l.hash ?? 'd:' + l.en;
export async function findBetter({ league, item, base, skip = [], price, level, state, tick }) {   // skip: lines left out (lineKey)
  const { stats, asked, left } = await asLines(priceLines(item).filter(l => l.varies && !skip.includes(String(lineKey(l))))), mine = asked.filter(x => x.value > 0);
  const body = { query: { status: { option: state }, ...(base || item.unique) && { type: item.base }, ...item.unique && { name: item.unique },
    stats, filters: filters(classOf(item), price, level) }, sort: DEAREST };
  tick?.('Searching the trade site ({0} of {1})…', 1, 1);
  const s = await call('search?league=' + encodeURIComponent(league), body), found = [];
  tick?.('Reading {0} items…', Math.min(10, s.result?.length || 0));
  if (s.result?.length) for (const r of (await call(`fetch?ids=${s.result.slice(0, 10).join()}&query=${s.id}`)).result || []) {
    const l = r && readListing(r); if (!l?.item) continue;
    const theirs = new Map(priceLines(l.item).map(x => [lineKey(x), x.value]));
    found.push({ ...l, up: mine.length ? mine.reduce((a, x) => a + (theirs.get(lineKey(x)) ?? x.value) / x.value, 0) / mine.length - 1 : 0 });
  }
  return { found: found.reverse(), body, left };
}
// one search: its first `per` listings not read yet, each rated with the item on the build; false when it failed
async function search(out, seen, { league, slot, items, value, per, tick }, plan) {
  try {
    const s = await call('search?league=' + encodeURIComponent(league), plan.body);
    out.searches.push({ plan, id: s.id, total: s.total });
    const ids = (s.result || []).filter(id => !seen.has(id)).slice(0, per);
    if (!ids.length) return true;
    ids.forEach(id => seen.add(id));
    tick?.('Reading {0} items…', ids.length);
    for (const r of (await call(`fetch?ids=${ids.join()}&query=${encodeURIComponent(s.id)}`)).result || []) {
      const l = r && readListing(r);
      if (!l) continue;
      if (!l.item || !l.slots.includes(slot)) { out.unread++; continue; }
      out.found.push({ ...l, value: value({ ...items, [slot]: l.item }), plan });
    }
    return true;
  } catch (e) {
    if (!(e instanceof TradeError)) throw e;
    out.errors.push(e); return false;
  }
}
// Items with the lines picked by hand (the Optimizer's Chosen modifiers: asLines); a unique: that unique. The first
// `per` down from the dearest under the price, read and rated. -> findGear's answer, with body (the search, to open on
// the site) and left (lines the site has no stat for)
export async function findLike({ league, cls, unique, base, slot, items, value, lines, price, level, state, tick }) {
  const { stats, left } = await asLines(lines);
  const body = { query: { status: { option: state }, ...unique && { name: unique, type: base }, stats, filters: filters(cls, price, level) }, sort: DEAREST };
  const out = { found: [], searches: [], unread: 0, errors: [], body, left };
  await search(out, new Set(), { league, slot, items, value, per: 10, tick }, { body });
  out.found.reverse();
  return out;
}
