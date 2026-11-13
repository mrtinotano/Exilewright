// Turns {stat_id: value} into game text using poe2_data/available/stat_texts.json (parsed from the game's .csd files).
const descs = await fetch('poe2_data/available/stat_texts.json').then(r => r.json());
const byStat = {};
for (const d of descs) for (const s of d.stats) (byStat[s] ||= []).push(d);

const DIV = { two: 2, three: 3, four: 4, five: 5, ten: 10, fifteen: 15, twenty: 20, fifty: 50, one_hundred: 100 };
function apply(h, v) {
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
  const m = h.match(/^divide_by_([a-z_]+?)(_then_double)?_?(\d+dp)?(_and_negate)?_?$/);
  if (m && DIV[m[1]]) return v / DIV[m[1]] * (m[2] ? 2 : 1) * (m[4] ? -1 : 1);
  return v; // note: rare handlers (hashes, indices) left raw
}
const inRange = (c, v) => {
  if (c === '#') return true;
  if (c[0] === '!') return v !== +c.slice(1);
  if (!c.includes('|')) return v === +c;
  const [a, b] = c.split('|');
  return (a === '#' || v >= +a) && (b === '#' || v <= +b);
};
const num = v => +v.toFixed(2);

export function statLines(stats) {
  const done = new Set(), out = [];
  for (const id of Object.keys(stats)) {
    if (done.has(id) || id.endsWith('_no_display')) continue;
    // the description that covers the most of these stats wins (e.g. min+max damage on one line)
    const d = (byStat[id] || []).map(d => [d, d.stats.filter(s => s in stats).length])
      .sort((a, b) => b[1] - a[1] || a[0].stats.length - b[0].stats.length)[0]?.[0];
    const vals = d ? d.stats.map(s => stats[s] ?? 0) : [];
    const row = d?.rows.find(r => r.c.every((c, i) => inRange(c, vals[i])));
    if (!row || !row.t) { out.push(`${id}: ${stats[id]}`); done.add(id); continue; }
    d.stats.forEach(s => done.add(s));
    const v = [...vals];
    for (let i = 0; i < row.h.length; i++) {
      const k = +row.h[i + 1];
      if (k) { v[k - 1] = apply(row.h[i], v[k - 1]); i++; }
    }
    out.push(row.t
      .replace(/\{(\d*)(?::\+?d)?\}/g, (m, i) => (m.includes('+') && v[+i || 0] >= 0 ? '+' : '') + num(v[+i || 0]))
      .replace(/\[([^\]|]+)\|([^\]]+)\]/g, '$2').replace(/\[([^\]]+)\]/g, '$1').replace(/\\n/g, '\n'));
  }
  return out;
}
