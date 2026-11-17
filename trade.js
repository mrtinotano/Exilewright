// Gear search on the official Path of Exile 2 trade site (pathofexile.com/trade2), the way Path of Building does it:
// work out what each modifier a slot can roll is worth to the build, look for listed items that have those modifiers,
// then put every item found on the build and rank them by what the calculation says they really change.
// The page cannot call the trade site itself (browsers block it, CORS): serve.py passes the calls on (/trade/...).
// Without logging in the site refuses weighted searches ("Query is too complex"), so the anonymous search asks for
// the items with the most of each of the best modifiers (or the best damage / defence of the item) and reads those;
// the weighted search itself is offered as a link that opens on the official site, where the user is logged in.
// No DOM here: optview.js is the screen.
import { affixLines, tradeItem, priceLines } from './items.js';

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
// -> { known: the site's stat ids (null when it cannot be asked), desecrated(en): the id of that desecrated line }
async function statIndex() {
  let known = null;
  const des = [new Map(), new Map()];
  try {
    const groups = (await data('stats')).result;
    known = new Set(groups.flatMap(g => g.entries.map(e => e.id)));
    for (const e of groups.find(g => g.id === 'desecrated')?.entries || []) des.forEach((m, loose) => m.has(shape(e.text, loose)) || m.set(shape(e.text, loose), e.id));
  } catch (e) { if (!(e instanceof TradeError)) throw e; }
  return { known, desecrated: en => des[0].get(shape(en)) || des[1].get(shape(en, 1)) || null };
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
// Looks for listed items like it: the same base (a unique: the same unique) whose numbers are near its own. Its own
// damage per second or armour / evasion / energy shield (propsOf: from the copied text, quality and runes included, as
// the site counts them) stand for the lines that make them (local ones); every other line (priceLines; a unique's only
// those that can roll otherwise) is asked as a normal, crafted, fractured or desecrated modifier alike. All of them
// within `near` % (Settings; not rounded, and a number never goes past 1 towards 0: "+1 to …" stays 1 at any %),
// all of them: one it lacks is not alike.
// Without any, only the name and base. The site sorts the listings by what they are worth whatever the currency, so the
// order is the price's: no exchange rate is needed. In the shop it would sit between the dearest worse one (from:
// every number at or under its own, no modifier it lacks, not dearer than `to`) and the cheapest better one (to: every number at or over its
// own, or a modifier it lacks). With neither (alike ones with some numbers over and some under): between the cheapest
// alike and the next dearer one.
// -> { total, near (the tolerance; null: only the name and base), within (how many of its `of` lines), raised (lines whose % went up to upTo),
//      from, to: { amount, currency, more (to: it has modifiers this one lacks) } (null when there is none), id (the search) }
const MANY = 10, WIDE = 30;
const around = (v, near) => { if (!v) return null; const d = Math.abs(v) * near / 100, r = x => +x.toFixed(2);
  return v > 0 ? { min: r(Math.max(v - d, Math.min(v, 1))), max: r(v + d) } : { min: r(v - d), max: r(Math.min(v + d, Math.max(v, -1))) }; };
// side -1: from the % under it up to it (worse); 1: from it up to the % over it (better)
const range = (v, near, side) => { const r = around(v, near); return r && side ? side < 0 ? { min: r.min, max: v } : { min: v, max: r.max } : r; };
console.assert(around(1, 50).min === 1 && around(-43, 10).max === -38.7 && around(-1, 90).max === -1 && around(30, 10).min === 27, 'around');
// the numbers the site filters weapons and armour by, from the item's text in English (none in another language)
export function propsOf(text) {
  const avg = re => [...(text.match(re)?.[1] || '').matchAll(/(\d+)-(\d+)/g)].reduce((s, m) => s + (+m[1] + +m[2]) / 2, 0);
  const one = re => +(text.match(re)?.[1] || 0), aps = one(/^Attacks per Second: ([\d.]+)/m);
  const p = { pdps: avg(/^Physical Damage: (.+)$/m) * aps, edps: avg(/^Elemental Damage: (.+)$/m) * aps,
    ar: one(/^Armour: (\d+)/m), ev: one(/^Evasion Rating: (\d+)/m), es: one(/^Energy Shield: (\d+)/m) };
  return Object.fromEntries(Object.entries(p).filter(([, v]) => v > 0).map(([k, v]) => [k, Math.round(v * 10) / 10]));
}
console.assert(JSON.stringify(propsOf('Physical Damage: 280-615 (augmented)\nAttacks per Second: 1.40')) === '{"pdps":626.5}', 'propsOf');
export async function priceOf({ league, item, text = '', state = 'available', near = 10, deep = false }) {
  const props = propsOf(text);
  const { known, desecrated } = await statIndex();
  const lines = priceLines(item).filter(l => l.varies && !(l.local && Object.keys(props).length))
    .map(l => ({ ...l, ids: l.en ? [desecrated(l.en)].filter(Boolean) : ['explicit', 'crafted', 'fractured', 'desecrated'].map(k => `${k}.stat_${l.hash}`).filter(id => known ? known.has(id) : id.startsWith('explicit')) }))
    .filter(l => l.ids.length).slice(0, 8), n = lines.length;
  const query = { status: { option: state }, type: item.base, ...(item.unique && { name: item.unique }) };
  const filters = side => Object.keys(props).length ? { equipment_filters: { filters: Object.fromEntries(Object.entries(props).map(([k, v]) => [k, range(v, near, side)])) } } : {};
  // at least k of its lines, each as normal, crafted, fractured or desecrated (an item has one of them), line i
  // within pct(i) % (on that side of its number); over / upTo: only dearer than / at most that price; desc: dearest first
  const search = (k, pct, { side = 0, over, upTo, desc } = {}) => call('search?league=' + encodeURIComponent(league), { query: { ...query,
    filters: { ...filters(side), ...(over || upTo) && { trade_filters: { filters: { price: over ? { min: +over.amount + .01, option: over.currency } : { max: +upTo.amount, option: upTo.currency } } } } },
    stats: k ? [{ type: 'count', value: { min: k }, filters: lines.flatMap((l, i) => l.ids.map(id => ({ id, ...range(l.value, pct(i), side) && { value: range(l.value, pct(i), side) } }))) }] : [] },
    sort: { price: desc ? 'desc' : 'asc' } }, deep ? 65 : 8);   // a thorough search waits its turn
  // all of them within the %; nothing, and `deep` (Settings): one line at a time, its % alone raised 5 by 5 up to WIDE
  // (asked at WIDE first: a line nothing is found with at all costs one search), then every line at the % it found
  // something with. Still nothing: any one line left out. Then there is none.
  let s = await search(n, () => near), k = n, wide = {}, pct = () => near;
  if (!s.total && n && deep) {
    for (const [i, l] of lines.entries()) {
      if (!around(l.value, near) || near >= WIDE) continue;
      const at = async p => (await search(n, j => j === i ? p : near)).total;
      if (!await at(WIDE)) continue;
      let p = near;
      do p = Math.min(p + 5, WIDE); while (p < WIDE && !await at(p));
      wide[i] = p;
    }
    if (Object.keys(wide).length) s = await search(n, pct = i => wide[i] || near);
    else if (n > 1) s = await search(k = n - 1, pct);
  }
  // a listing with a skill level line this one does not have ("+3 to Level of all Attack Skills", by the site's stat
  // number and wording) can be many times dearer: never one of the two prices. note: only those, as every rare alike
  // has some other line, and which other ones raise a price this much is no table's
  const ours = new Set(priceLines(item).map(l => l.hash ? String(l.hash) : l.en && desecrated(l.en)?.split('_').pop()).filter(Boolean));
  const more = it => ['explicitMods', 'fracturedMods', 'craftedMods', 'desecratedMods'].flatMap(k => it?.[k] || [])
    .some(m => m.hash && !ours.has(/(\d+)$/.exec(m.hash)?.[1]) && /\bto Level of\b/i.test(m.description || ''));
  const pricesOf = async s => { const ids = (s.result || []).slice(0, MANY);
    return ids.length ? ((await call(`fetch?ids=${ids.join()}&query=${encodeURIComponent(s.id)}`)).result || []).filter(r => r?.listing?.price).map(r => ({ ...r.listing.price, more: more(r.item) })) : []; };
  const sided = n || Object.keys(props).length;
  let from = null, to = null;
  const key = x => x.amount + ' ' + x.currency;
  // the top: the cheapest better one. The bottom: the dearest worse one asking less than it (the site's price filter
  // converts the currencies, so the bottom is always the cheaper one); none, the same with one of its lines fewer, then
  // the base alone. Neither with a line this one does not have
  if (s.total && sided) {
    to = (await pricesOf(await search(k, pct, { side: 1 }))).find(x => !x.more) || null;
    for (const kk of [...new Set([k, k - 1, 0])].filter(x => x >= 0)) {
      from = (await pricesOf(await search(kk, pct, { side: -1, desc: true, upTo: to }))).find(x => !x.more && (!to || key(x) !== key(to))) || null;
      if (from) break;
    }
  }
  if (s.total && !from && !to) from = (await pricesOf(s)).find(x => !x.more) || null;   // nothing to rate it by: the cheapest alike
  // nothing better listed: the next dearer alike
  if (from && !to) to = (await pricesOf(await search(k, pct, { over: from }))).find(x => !x.more) || null;
  const raised = Object.values(wide);
  return { total: s.total, near: sided ? near : null, within: k, of: n, raised: raised.length, upTo: Math.max(0, ...raised), from, to, id: s.id };
}

// ---------- the search
// Runs the searches, reads the first `per` items of each and rates them: value(items) with the item in `slot`.
// tick(text key, args): progress. -> { found: [{ ...listing, value, plan }] best first, searches: [{ plan, id, total }],
// unread (listed items the app has no base for), errors: [TradeError] }
export async function findGear({ league, cls, slot, items, value, wants, price, level, state, per = 10, tick }) {
  const todo = plans({ cls, wants, price, level, state });
  const seen = new Set(), found = [], searches = [], errors = [];
  let unread = 0;
  for (const plan of todo) {
    try {
      tick?.('Searching the trade site ({0} of {1})…', searches.length + errors.length + 1, todo.length);
      const s = await call('search?league=' + encodeURIComponent(league), plan.body);
      searches.push({ plan, id: s.id, total: s.total });
      const ids = (s.result || []).filter(id => !seen.has(id)).slice(0, per);
      if (!ids.length) continue;
      ids.forEach(id => seen.add(id));
      tick?.('Reading {0} items…', ids.length);
      for (const r of (await call(`fetch?ids=${ids.join()}&query=${encodeURIComponent(s.id)}`)).result || []) {
        const l = r && readListing(r);
        if (!l) continue;
        if (!l.item || !l.slots.includes(slot)) { unread++; continue; }
        found.push({ ...l, value: value({ ...items, [slot]: l.item }), plan });
      }
    } catch (e) {
      if (!(e instanceof TradeError)) throw e;
      errors.push(e);
      if (e.kind !== 'site') break;   // the site turned this search down: the others may still run
    }
  }
  found.sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
  return { found, searches, unread, errors };
}
