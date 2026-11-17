// What a change does to the build: the character panel numbers and every skill's DPS, before and after it
// (two calc.js snapshot()s). The tree tooltip (a passive and the path to it), the item editor and the support
// picker all show these rows.
import { t, fmt } from './i18n.js';

// [snapshot key, label, decimals, unit]; the labels are ones the character panel already uses
const ROWS = [
  ['life', 'Life'], ['es', 'Energy Shield'], ['mana', 'Mana'], ['spirit', 'Spirit'],
  ['armour', 'Armour'], ['evasion', 'Evasion'], ['block', 'Block', 0, '%'],
  ['fire', 'Fire Resistance', 0, '%'], ['cold', 'Cold Resistance', 0, '%'], ['lightning', 'Lightning Resistance', 0, '%'], ['chaos', 'Chaos Resistance', 0, '%'],
  ['str', 'Strength'], ['dex', 'Dexterity'], ['int', 'Intelligence'],
  ['lifeRegen', 'Life Recovery per second from Regeneration', 1], ['esRecharge', 'Energy Shield Recharge per second', 1],
  ['move', 'Base Movement Speed', 0, '%'], ['accuracy', 'Accuracy'],
];
const MAX_SKILLS = 3;   // skills listed per change, biggest difference first

// one changed number, or null if it would print as no change. pct: share of the old value (null when there was none
// or the row is a percentage already)
function row(label, x, y, dec = 0, unit = '', dps = false) {
  if (x == null && y == null) return null;
  const d = (y || 0) - (x || 0);
  return Math.abs(d) < .5 / 10 ** dec ? null : { label, d, pct: unit || !x ? null : d / Math.abs(x) * 100, dec, unit, dps };
}
// rows that differ between two snapshots: skills first (what a change is usually taken for), then the panel order
export function diff(a, z) {
  const skills = a.dps.map(([name, x], i) => { const y = z.dps[i]?.[1]; return row(t('{0} DPS', name), x, y, Math.max(x || 0, y || 0) < 100 ? 1 : 0, '', true); })
    .filter(Boolean).sort((p, q) => Math.abs(q.d) - Math.abs(p.d)).slice(0, MAX_SKILLS);
  return [...skills, ...ROWS.map(([k, label, dec, unit]) => row(t(label), a[k], z[k], dec, unit)).filter(Boolean)];
}
// DPS of one skill before and after (support picker)
export const dpsDiff = (x, y) => [row('DPS', x, y, Math.max(x || 0, y || 0) < 100 ? 1 : 0, '', true)].filter(Boolean);

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const signed = (d, dec, unit = '') => (d > 0 ? '+' : '−') + fmt(Math.abs(d), dec) + unit;
const share = r => signed(r.pct, Math.abs(r.pct) < 10 ? 1 : 0, '%');
const cls = r => r.d > 0 ? 'up' : 'down';
// short form for lists: a skill by how much of its DPS changes, anything else by the amount
const brief = r => `${r.dps && r.pct != null ? share(r) : signed(r.d, r.dec, r.unit)} ${r.label}`;

// block for a tooltip or card: a title and one line per changed number (a note when nothing calculated changes)
export const impactHtml = (title, rows) => `<div class="imp"><div class="imph">${esc(title)}</div>${rows.length
  ? rows.map(r => `<div class="${cls(r)}"><span>${esc(r.label)}</span><b>${signed(r.d, r.dec, r.unit)}${r.pct != null ? ` <small>${share(r)}</small>` : ''}</b></div>`).join('')
  : `<p>${t('No change in the calculated numbers')}</p>`}</div>`;
// every change, one per line, gains first (empty when nothing changes)
export const impactList = rows => rows.length ? `<div class="impv">${[...rows].sort((p, q) => (q.d > 0) - (p.d > 0)).map(r => `<div class="${cls(r)}">${esc(brief(r))}</div>`).join('')}</div>` : '';
// the biggest changes on one line, for list entries (empty when nothing changes)
export const impactLine = (rows, max = 3) => rows.length ? `<small class="impl">${rows.slice(0, max).map(r => `<i class="${cls(r)}">${esc(brief(r))}</i>`).join('')}${rows.length > max ? '<i>…</i>' : ''}</small>` : '';
// the same as plain text (select options)
export const impactText = (rows, max = 2) => rows.slice(0, max).map(brief).join(', ');
