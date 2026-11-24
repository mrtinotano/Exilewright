// Turns {stat_id: value} into game text using poe2_data/available/stat_texts.json (parsed from the game's .csd files).
import { lang } from './i18n.js';
// stat_texts.<lang>.json per translated language (written by _tool/available.py); English file as fallback
const load = f => fetch('poe2_data/available/' + f).then(r => r.ok ? r.json() : Promise.reject());
const index = descs => { const by = {}; for (const d of descs) for (const s of d.stats) (by[s] ||= []).push(d); return by; };
const EN = index(await load('stat_texts.json'));
// English text is always needed too: Path of Building and the game's item text are in English
const byStat = lang === 'en' ? EN : await load(`stat_texts.${lang}.json`).then(index).catch(() => EN);

const DIV = { two: 2, three: 3, four: 4, five: 5, ten: 10, fifteen: 15, twenty: 20, fifty: 50, one_hundred: 100 };
// a number that is a name, set by the app: a passive's hash (Megalomaniac's "Allocates {0}", From Nothing's keystone), a
// keystone's index (Flesh Crucible), a skill's (Prism of Belief), a Mage's Legacy's (Mageblood: set by items.js)
export const NAMES = { passive_hash: null, passive_keystone_index: null, specific_skill: null, mages_legacy_index: null };
function apply(h, v) {
  if (h in NAMES) return v && NAMES[h]?.(v) || '—';
  if (h === 'negate') return -v;
  if (h === 'negate_and_double') return -2 * v;
  if (h === 'double') return 2 * v;
  if (h === 'times_twenty') return 20 * v;
  if (h === 'add_one') return v + 1;
  if (h === 'subtract_one') return v - 1;
  if (h === 'plus_two_hundred') return v + 200;
  if (h.startsWith('per_minute_to_per_second')) return v / 60;
  if (h.startsWith('milliseconds_to_seconds')) return v / 1000;
  if (h.startsWith('deciseconds_to_seconds')) return v / 10;
  // "divide_by_ten_1dp_if_required": Orb of Storms' "Orb radius is 3.6 metres"
  const m = h.match(/^divide_by_([a-z_]+?)(_then_double)?(?:_?\d+dp)?(?:_if_required)?(_and_negate)?_?$/);
  if (m && DIV[m[1]]) return v / DIV[m[1]] * (m[2] ? 2 : 1) * (m[3] ? -1 : 1);
  return v; // note: rare handlers (hashes, indices) left raw
}
const inRange = (c, v) => {
  if (c === '#') return true;
  if (c[0] === '!') return v !== +c.slice(1);
  if (!c.includes('|')) return v === +c;
  const [a, b] = c.split('|');
  return (a === '#' || v >= +a) && (b === '#' || v <= +b);
};
const num = v => typeof v === 'string' ? v : +v.toFixed(2);
const BY = byStat;

export const statLinesEn = stats => statLines(stats, EN);
// the lines a stat whose number is a name is worded with ("Allocates {0}", "+{0} to Level of all {1} Skills"), in English
// and the page's language (only the first line of a two-line text): { re, stats (the stat each group of re reads), fixed
// ({stat: value} the line's own wording says: a timeless jewel's "by the line of Medved" is its keystone 2) }
export const nameLines = id => [EN, byStat].flatMap(by => (by[id] || []).flatMap(d => d.rows.filter(r => r.t).map(r => {
  const stats = [], re = unlink(r.t).split('\\n')[0].split(/(\{\d*(?::\+?d)?\})/)
    .map((x, i) => i % 2 ? (stats.push(d.stats[+(x.match(/\d+/)?.[0] || 0)]), '(.+?)') : x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
  return { re: new RegExp('^' + re + '$'), stats, fixed: Object.fromEntries(r.c.map((c, i) => [d.stats[i], +c]).filter(([, v]) => Number.isInteger(v))) };
})));
const unlink = t => t.replace(/\[([^\]|]+)\|([^\]]+)\]/g, '$2').replace(/\[([^\]]+)\]/g, '$1');   // "[Attack|ataque]" -> "ataque"
// a line of an item in the page's language -> the same line in English, its numbers as "#": the game's own description
// of it in both (the same stats, the row of the same conditions), as Exiled Exchange 2 reads lines no modifier of its
// own words ("+3 al nivel de todas las habilidades de ataque" -> "+# to Level of all Attack Skills"); null if none
const TPL = t => unlink(t).replace(/\{\d*(?::\+?d)?\}/g, '#');
const KEY = l => l.toLowerCase().replace(/[+-]?\d+(?:\.\d+)?/g, '#').replace(/\+/g, '').replace(/\s+/g, ' ').trim();
let LOCAL = null;
export function englishOf(line) {
  if (!LOCAL) { LOCAL = new Map(); for (const ds of Object.values(byStat)) for (const d of ds) if (!d.skill) for (const r of d.rows) if (r.t && !r.t.includes('\\n')) LOCAL.set(KEY(TPL(r.t)), [d, r]); }
  const [d, r] = LOCAL.get(KEY(line)) || [];
  const en = d && EN[d.stats[0]]?.find(e => !e.skill && e.stats.join() === d.stats.join()), er = en?.rows.find(x => x.c.join() === r.c.join());
  return er?.t ? TPL(er.t) : null;
}
// only the lines the game has text for (a stat with none comes out as "id: value"), helper keys ("_cost"…) left out
const RAW = /^[a-z0-9_%+\-]+: -?[\d.]+$/;
export const shownLines = (stats, skill) => statLines(Object.fromEntries(Object.entries(stats).filter(([k]) => !k.startsWith('_'))), BY, skill).filter(l => !RAW.test(l));
// skill: gem name, for the texts of that skill's own .csd (entries with "skill"; other skills' are skipped)
export function statLines(stats, byStat = BY, skill) {
  const done = new Set(), out = [];
  for (const id of Object.keys(stats)) {
    if (done.has(id) || id.endsWith('_no_display')) continue;
    // the description that covers the most of these stats wins (e.g. min+max damage on one line), the skill's own first
    const d = (byStat[id] || []).filter(d => !d.skill || d.skill.includes(skill)).map(d => [d, d.stats.filter(s => s in stats).length])
      .sort((a, b) => b[1] - a[1] || !!b[0].skill - !!a[0].skill || a[0].stats.length - b[0].stats.length)[0]?.[0];
    const vals = d ? d.stats.map(s => stats[s] ?? 0) : [];
    const row = d?.rows.find(r => r.c.every((c, i) => inRange(c, vals[i])));
    if (!row || !row.t) { out.push(`${id}: ${stats[id]}`); done.add(id); continue; }
    d.stats.forEach(s => done.add(s));
    const v = [...vals];
    for (let i = 0; i < row.h.length; i++) {
      const k = +row.h[i + 1];
      if (k) { v[k - 1] = apply(row.h[i], v[k - 1]); i++; }
    }
    out.push(unlink(row.t)
      .replace(/\{(\d*)(?::\+?d)?\}/g, (m, i) => (m.includes('+') && v[+i || 0] >= 0 ? '+' : '') + num(v[+i || 0]))
      .replace(/\\n/g, '\n'));
  }
  return out;
}
