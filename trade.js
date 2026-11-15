// Gear search on the official Path of Exile 2 trade site (pathofexile.com/trade2), the way Path of Building does it:
// work out what each modifier a slot can roll is worth to the build, look for listed items that have those modifiers,
// then put every item found on the build and rank them by what the calculation says they really change.
// The page cannot call the trade site itself (browsers block it, CORS): serve.py passes the calls on (/trade/...).
// Without logging in the site refuses weighted searches ("Query is too complex"), so the anonymous search asks for
// the items with the most of each of the best modifiers (or the best damage / defence of the item) and reads those;
// the weighted search itself is offered as a link that opens on the official site, where the user is logged in.
// No DOM here: optview.js is the screen.
import { affixLines, tradeItem } from './items.js';

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
export const CURRENCY = ['exalted', 'divine', 'chaos'];

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
// one call at a time, spaced out
async function call(path, body) {
  const kind = kindOf(path);
  if (kind) { const w = waitFor(kind); if (w > 8) throw new TradeError('rate limit', 'wait', Math.ceil(w)); if (w > 0) await sleep(w * 1000); }
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
export const status = () => call('status');   // { session: true } when serve.py was started with the user's trade session

// adds .id (the site's stat) to each line: "explicit.stat_<number>", the number Path of Building's data gives the
// modifier. When the site's own list can be read, a line it does not have gets none.
export async function withIds(wants) {
  let known = null;
  try { known = new Set((await data('stats')).result.flatMap(g => g.entries.map(e => e.id))); } catch (e) { if (!(e instanceof TradeError)) throw e; }
  return wants.map(w => { const id = 'explicit.stat_' + w.hash; return { ...w, id: !known || known.has(id) ? id : null }; });
}

// the item's own numbers the site can sort by, from the local modifiers worth having
const PROP = [[/local_.*physical_damage(?!_reduction)/, 'pdps'], [/local_.*(fire|cold|lightning|chaos)_damage/, 'edps'], [/local_attack_speed|local_critical_strike/, 'dps'],
  [/physical_damage_reduction_rating|armour/, 'ar'], [/evasion/, 'ev'], [/energy_shield/, 'es']];
const propOf = w => { if (!w.local) return null; for (const [re, key] of PROP) if (w.stats.some(id => re.test(id))) return key; return null; };

// level: the character's, to leave out what it cannot wear yet
const filters = (cls, price, level) => ({ type_filters: { filters: { category: { option: CATEGORY[cls] } } },
  ...(level > 0 && { req_filters: { filters: { lvl: { max: +level } } } }),
  ...(price?.max > 0 && { trade_filters: { filters: { price: { max: +price.max, option: price.currency } } } }) });
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

// ---------- the search
// Runs the searches, reads the first `per` items of each and rates them: value(items) with the item in `slot`.
// tick(text key, args): progress. -> { found: [{ ...listing, value, plan }] best first, searches: [{ plan, id, total }],
// unread (listed items the app has no base for), errors: [TradeError], logged (the weighted search ran) }
export async function findGear({ league, cls, slot, items, value, wants, price, level, state, per = 10, session = false, tick }) {
  const todo = plans({ cls, wants, price, level, state }), w = session && weighted({ cls, wants, price, level, state });
  if (w) todo.unshift({ key: 'weight', gain: Infinity, body: w, weighted: true });
  const seen = new Set(), found = [], searches = [], errors = [];
  let unread = 0, logged = false;
  for (const plan of todo) {
    try {
      tick?.('Searching the trade site ({0} of {1})…', searches.length + errors.length + 1, todo.length);
      const s = await call('search?league=' + encodeURIComponent(league), plan.body);
      searches.push({ plan, id: s.id, total: s.total });
      if (plan.weighted) logged = true;
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
      if (e.kind !== 'site') break;   // the site turned this search down (the weighted one, when not logged in after all): the others may still run
    }
  }
  found.sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
  return { found, searches, unread, errors, logged };
}
