// The Loot tab: is an item of the game better than the one in use, for this build? The item comes as the text the
// game copies with Ctrl+C over it (found and identified, in the inventory or in a merchant's shop): pasted here, or
// picked up by serve.py's /clipboard while the game is the window in use. It is tried in every slot it fits and the
// build is worked out with and without it, so the build's passives and skills decide what counts (spell damage on a
// wand is an upgrade for a spell and nothing for a bow). Without a skill only the defences and the weapon's own damage
// are judged. What it is compared with is the gear marked here as worn (the build is left alone) or the build's own.
// The verdict of an item that came from the game also goes to serve.py's /overlay, which shows it over the game.
// The tab also saves the loot filter of the build (filter.js): what the game itself marks where items drop.
//   ctx: { build(), id(), rev(), sumOf(b), snap(b), sockets() ([{id, label}] of the allocated jewel sockets),
//          change(fn(b)) (edits the build, saves, redraws) }
import { t, fmt, tn, lang, locale, cap } from './i18n.js';
import { OBJECTIVES, score, whyNot } from './optimize.js';
import { GEM } from './skills.js';
import { SLOTS, parseItem, itemView, gearStats, offhandFits, classOf, propText, modDiff } from './items.js';
import { shownLines } from './stats.js';
import { diff, impactHtml, impactText } from './impact.js';
import { filterPlan, filterText, mergeFilter, isFilter, filterFileName, DEFENCES } from './filter.js';

const KEY = 'poe2loot', LIST = 'poe2lootlist';
const MAX = 20;   // items kept in the list
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const opt = (v, text, on) => `<option value="${esc(v)}"${on ? ' selected' : ''}>${esc(text)}</option>`;
const chk = (k, on, text) => `<label class="chk"><input type="checkbox" data-c="${k}"${on ? ' checked' : ''}> ${esc(text)}</label>`;
const BADGE = { up: ['▲', 'Upgrade'], mix: ['⇄', 'Trade-off'], same: ['≈', 'About the same'], down: ['▼', 'Worse'], on: ['✓', 'Equipped'], none: ['–', 'No slot for it'] };
const RANK = { on: 4, up: 3, mix: 2, same: 1, down: 0 };
const NOTES = { up: [[660, 0], [880, .12], [1320, .24]], mix: [[660, 0], [660, .16]], same: [[220, 0]], down: [[220, 0]] };   // [Hz, seconds in]
const FLOAT_CSS = `body{margin:0;padding:6px;background:#0c0a08;color:#d8ccb0;font:13px/1.35 sans-serif}
.c{padding:5px 8px;margin-bottom:5px;border-left:4px solid #666;background:#1c1c1c}.c:first-child{font-size:15px}
.c b{white-space:nowrap}.c small{display:block;color:#aaa;font-size:11px}p{color:#888;text-align:center}
.up{background:#12301a;border-color:#5fd06a}.up b{color:#8fe89a}.mix{background:#33290f;border-color:#e0b040}.mix b{color:#f0cc66}
.down{background:#301414;border-color:#c05050}.down b{color:#e88}`;

// a difference under half a percent is no difference; a number there was none of before counts as all gained
const sgn = (a, z) => { const x = a || 0, y = z || 0; return Math.abs(y - x) <= Math.max(Math.abs(x), Math.abs(y)) * .005 ? 0 : y > x ? 1 : -1; };
const mid = v => Array.isArray(v) ? (v[0] + v[1]) / 2 : v || 0;   // a damage range counts by its middle
const tone = d => d > 0 ? 'up' : d < 0 ? 'down' : '';
const dir = (text, d) => d ? `<i class="${tone(d)}">${text}</i>` : text;   // better in green, worse in red, the same as it is
const plain = l => typeof l === 'string' ? l : l.map(s => typeof s === 'string' ? s : s[0]).join('');
const MODS = 6;   // modifier lines of each list (gained, lost) shown over the game
const rel = (a, z) => { const x = a || 0, y = z || 0; return x > 0 ? y / x - 1 : y > 0 ? 1 : 0; };

export function initLoot(el, ctx) {
  const S = { vs: 'worn', key: '', gem: {}, watch: true, over: true, sound: true, notify: false, fmin: 'magic', worn: {}, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  if (S.key && !OBJECTIVES[S.key]) S.key = '';
  const keep = () => localStorage.setItem(KEY, JSON.stringify(S));
  // the items looked at, newest first: { text, at (time), r (parseItem), undo: { slot, old } once equipped from here,
  // v + stamp (the verdict, kept while nothing it depends on changes) }
  let list = JSON.parse(localStorage.getItem(LIST) || '[]').map(([text, at]) => ({ text, at, r: parseItem(text) })).filter(e => e.r);
  const keepList = () => localStorage.setItem(LIST, JSON.stringify(list.map(e => [e.text, e.at])));
  const tab = document.querySelector('nav button[data-v="loot"]');
  let msg = '', bad = false;     // what the last text given was, when it was no item
  let fmsg = '', fbad = false;   // what became of the loot filter asked for
  let es = null, live = '';      // the clipboard watch: '' off, 'wait' (connecting), 'on', 'none' (this server has no /clipboard)
  let ac = null, pip = null;     // sound, the floating window
  let over = false, awake = false;   // serve.py has a window to show verdicts over the game; this tab was told to stay awake
  let wornRev = 0;               // goes up with every change to the worn gear

  // ---------- the build and what the item is compared with
  const skills = b => b.gems.filter(g => GEM[g.name] && GEM[g.name].kind !== 'support');
  const gemOf = b => { const l = skills(b); return l[S.gem[ctx.id()] || 0] || l[0] || null; };   // the skill picked for this build
  const gearOf = b => S.vs === 'build' ? b.items || {} : S.worn[ctx.id()] || {};
  const slotName = slot => slot.startsWith('jewel:') ? `${t('Jewel')} (${ctx.sockets().find(j => 'jewel:' + j.id === slot)?.label || '?'})` : t(SLOTS[slot]);
  const nameOf = it => { const v = itemView(it); return it.name || (v ? v.name || v.base : it.base); };   // it.name: the one the game gave a worn item
  const numOf = (v, key) => { const o = OBJECTIVES[key] || { skill: true }; return v == null ? '—' : fmt(v, o.dec ?? (o.skill && Math.abs(v) < 100 ? 1 : 0)) + (o.unit || ''); };
  const share = (a, z) => !(a > 0) || z == null ? '' : (z >= a ? '+' : '') + fmt((z / a - 1) * 100, 1) + '%';
  const pct = (a, z) => { const s = share(a, z); return s && `<i class="${z > a * (1 + 1e-9) ? 'up' : z < a * (1 - 1e-9) ? 'down' : ''}">${s}</i>`; };

  // ---------- the verdict
  // the item in one slot: { slot, old (what is there), kind (up, mix, same, down; on: it is the one there), nums: the
  // numbers judged [label, before, after, objective key], rows: every calculated number that changes, raw: [gained,
  // lost] modifier lines when the calculation sees no difference, lean: damage × toughness when one pays for the other }
  function rate(b, g, gear, slot, item) {
    const old = gear[slot] || null;
    if (old && JSON.stringify({ ...old, name: undefined }) === JSON.stringify(item)) return { slot, old, kind: 'on', nums: [], rows: [], gain: 0 };
    const a = { ...b, items: gear }, sa = ctx.sumOf(a), next = { ...gear, [slot]: item };
    if (slot === 'weapon' && next.offhand && !offhandFits(item, next.offhand, sa.keystone_giants_blood)) delete next.offhand;   // it takes both hands
    const z = { ...b, items: next }, sz = ctx.sumOf(z);
    const two = key => [[a, sa], [z, sz]].map(([x, s]) => whyNot(key, x, s, g) ? null : score(key, x, s, g));
    const nums = [];
    let marks, why = null;
    if (S.key && S.key !== 'mix') { const [x, y] = two(S.key); nums.push([OBJECTIVES[S.key].label, x, y, S.key]); marks = [sgn(x, y)]; }
    else {
      let [x, y] = two('dps'), label = 'Skill damage per second', own = false;
      // no damage to go by (no skill, or one the planner cannot work out): one weapon against the other by their own
      // damage, and that settles it (the toughness of a build with no skill says little next to it)
      if (x == null && y == null && slot === 'weapon') { x = itemView(old)?.dps || 0; y = itemView(item).dps; label = "Weapon's damage per second"; own = sgn(x, y) !== 0; }
      const [p, q] = two('tough');
      if (x || y) nums.push([label, x, y, 'dps']);
      if (!own) nums.push(['Toughness', p, q, 'tough']);
      if (x != null && y == null) why = whyNot('dps', z, sz, g);   // the skill cannot be used with it: nothing makes up for that
      marks = own ? [sgn(x, y)] : why || S.key ? [sgn((x || 0) * p, (y || 0) * q)] : [sgn(x, y), sgn(p, q)];
    }
    const rows = diff(ctx.snap(a), ctx.snap(z));
    if (!marks.some(Boolean)) marks = rows.map(r => Math.sign(r.d));   // neither moves: mana, spirit, attributes... may
    let raw = null;
    if (!marks.some(Boolean)) {   // nothing calculated moves: the modifiers themselves, more of them or fewer
      const x = gearStats(old ? { x: old } : {}), y = gearStats({ x: item }), up = {}, down = {};
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) { const d = (y[k] || 0) - (x[k] || 0); if (d > 0) up[k] = d; else if (d < 0) down[k] = -d; }
      raw = [up, down].map(s => shownLines(s));
      marks = [raw[0].length ? 1 : 0, raw[1].length ? -1 : 0];
    }
    const up = marks.some(m => m > 0), down = marks.some(m => m < 0), kind = up && down ? 'mix' : up ? 'up' : down ? 'down' : 'same';
    const lean = kind === 'mix' && nums.length === 2 && nums.every(n => n[1] > 0 && n[2] != null) ? nums[0][2] * nums[1][2] / (nums[0][1] * nums[1][1]) - 1 : null;
    // its own numbers next to the old one's, [label, before, after, 1 better / -1 worse / 0 the same], and the modifiers that change hands
    const was = old ? itemView(old).props : [], now = itemView(item).props;
    const own = !old ? [] : [...new Set([...now, ...was].map(p => p[0]))].map(k => { const x = was.find(p => p[0] === k), y = now.find(p => p[0] === k); return [k, x, y, sgn(mid(x?.[1]), mid(y?.[1]))]; });
    return { slot, old, kind, nums, rows, raw, lean, why, own, mods: modDiff(old, item), gain: nums.reduce((s, [, x, y]) => s + rel(x, y), 0) };
  }
  // an item of the list in every slot it fits, the best slot first (none: a jewel with no socket allocated)
  function verdict(e) {
    const b = ctx.build(), g = gemOf(b), stamp = [ctx.id(), ctx.rev(), S.vs, S.key, g ? b.gems.indexOf(g) : -1, wornRev].join();
    if (e.stamp !== stamp) {
      const gear = gearOf(b), giant = ctx.sumOf(b).keystone_giants_blood;
      // with no skill to say which weapons the build uses, a weapon is only compared with one of its own kind
      const fits = s => s === 'offhand' ? offhandFits(gear.weapon, e.r.item, giant) : s !== 'weapon' || g || !gear.weapon || classOf(gear.weapon) === classOf(e.r.item);
      const slots = e.r.slots.includes('jewel') ? ctx.sockets().map(j => 'jewel:' + j.id) : e.r.slots.filter(s => SLOTS[s] && fits(s));
      e.stamp = stamp;
      e.v = slots.map(slot => rate(b, g, gear, slot, e.r.item)).sort((p, q) => RANK[q.kind] - RANK[p.kind] || q.gain - p.gain);
    }
    return e.v;
  }

  // ---------- telling: the window over the game, sound, desktop notification, the floating window and a dot on the tab
  const noSlot = e => t(e.r.slots.includes('jewel') ? 'Allocate a jewel socket in the tree first' : 'It does not go with the weapon in use');
  // the verdict in a few lines: plain text, or pieces of it each with its tone ([text, 'up' | 'down' | 'dim'])
  function told(e, v) {
    const [icon, word] = BADGE[v?.kind || 'none'];
    const lines = !v ? [noSlot(e)] : v.kind === 'on' ? e.took === v.slot ? [t('Taken as what the character wears: what you copy next is compared with it')] : [] : [
      ...v.nums.map(([label, x, y, key]) => [`${t(label)}: ${numOf(x, key)} → `, [`${numOf(y, key)}  ${share(x, y)}`, tone(sgn(x, y))]]),
      ...(v.lean == null ? [] : [`${t('Damage × toughness')}: ${share(1, 1 + v.lean)}`]),
      ...(v.why ? [t(v.why)] : []),
      ...v.own.map(([k, x, y, d]) => [`${t(k)}: ${x ? propText(x) : '—'} → `, [y ? propText(y) : '—', tone(d)]]),
      ...(v.raw || v.nums.some(([, x, y]) => sgn(x, y)) ? [] : [impactText(v.rows, 3)].filter(Boolean)),
      ...v.mods.flatMap((l, k) => !l.length ? [] : [[[cap(t(k ? 'loses' : 'gains')) + ':', 'dim']], ...l.slice(0, MODS).map(x => [[`  ${x}`, k ? 'down' : 'up']]), ...(l.length > MODS ? [[['…', 'dim']]] : [])]),
      ...(e.r.missed.length ? [`${t('Not understood: it is not counted')} (${e.r.missed.length})`] : []),
      ...(v.old ? [] : [[[t('the slot is empty'), 'dim']]])];
    const name = e.r.name || nameOf(e.r.item), pair = v?.old && v.kind !== 'on';   // the two compared, as every number under them: worn → copied
    return { kind: v?.kind || 'none', title: `${icon} ${t(word)}` + (v ? ' · ' + slotName(v.slot) : ''), name: pair ? `${t('Equipped')}: ${nameOf(v.old)} → ${name}` : name, lines };
  }
  // serve.py's window over the game. It waits for an answer to every item it passes on: nothing to show is one too
  const say = v => { if (over) fetch('overlay', { method: 'POST', body: JSON.stringify(S.over ? v : null) }).catch(() => {}); };
  function beep(kind) {
    if (!S.sound || !NOTES[kind]) return;
    try {
      ac ||= new AudioContext(); ac.resume();
      const vol = kind === 'up' ? .22 : kind === 'mix' ? .15 : .05;
      for (const [hz, at] of NOTES[kind]) {
        const o = ac.createOscillator(), g = ac.createGain(), t0 = ac.currentTime + at;
        o.type = 'triangle'; o.frequency.value = hz;
        g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(.001, t0 + .25);
        o.connect(g).connect(ac.destination); o.start(t0); o.stop(t0 + .26);
      }
    } catch {}   // no sound in this browser: the rest still tells
  }
  function notify(e, v) {
    if (!S.notify || !('Notification' in window) || Notification.permission !== 'granted' || document.hasFocus()) return;
    const w = told(e, v);
    try { new Notification(`${w.title}: ${w.name}`, { tag: 'poe2loot', silent: S.sound, body: w.lines.map(plain).join('\n') }); } catch {}
  }
  // a small window that stays over the others (the game too, unless it runs in exclusive full screen)
  async function float() {
    if (pip) return pip.close();
    try { pip = await documentPictureInPicture.requestWindow({ width: 340, height: 300 }); } catch { return; }
    pip.document.title = t('Loot');
    pip.document.head.append(Object.assign(pip.document.createElement('style'), { textContent: FLOAT_CSS }));
    pip.addEventListener('pagehide', () => { pip = null; render(); });
    render();
  }
  function drawFloat() {
    if (!pip) return;
    pip.document.body.innerHTML = list.length ? list.slice(0, 4).map(e => {
      const v = verdict(e)[0], [icon, word] = BADGE[v?.kind || 'none'];
      return `<div class="c ${v?.kind || ''}"><b>${icon} ${t(word)}</b> <span>${esc(e.r.name || nameOf(e.r.item))}</span>
        <small>${v ? esc(slotName(v.slot)) : ''}${(v?.nums || []).map(([label, x, y]) => { const s = share(x, y); return s ? ` · ${esc(t(label))} ${s}` : ''; }).join('')}</small></div>`;
    }).join('') : `<p>${t('Copy an item in the game: Ctrl+C over it')}</p>`;
  }

  // ---------- items coming in
  function add(text, game) {   // game: it is what the game copied, not something pasted here
    text = text.replace(/\r/g, '').trim();
    const r = parseItem(text);
    msg = !r ? t('That is not item text, or the planner does not have its base.') : r.unidentified ? t('That item is not identified yet: identify it and copy it again.') : '';
    bad = !!msg;
    if (!msg) {   // the same item copied again goes back to the top
      list = [{ text, at: Date.now(), r, undo: list.find(e => e.text === text)?.undo }, ...list.filter(e => e.text !== text)].slice(0, MAX);
      keepList();
      // nothing is known to be worn where it goes: this is it (what the character has on is copied first)
      const free = S.vs === 'build' ? null : r.slots.find(s => verdict(list[0]).some(x => x.slot === s && !x.old));
      if (free) { list[0].took = free; put(free, r.item, r.name); }
      const v = verdict(list[0])[0];
      if (v) { beep(v.kind); if (v.kind === 'up' || v.kind === 'mix') notify(list[0], v); if (v.kind === 'up' && el.hidden) tab?.classList.add('new'); }
      if (game) say(told(list[0], v));
    } else if (game) say({ kind: 'none', title: 'PoE2 Planner', lines: [msg] });
    render();
  }
  // serve.py passes on what the game copies (a page cannot read the clipboard while another window is in use)
  function watch() {
    es?.close(); es = null; live = '';
    if (S.watch) {
      const src = es = new EventSource('clipboard?lang=' + lang);
      live = 'wait';
      src.onopen = () => { live = 'on'; showLive(); };
      src.onmessage = m => { let text; try { text = JSON.parse(m.data); } catch { return; } add(text, true); };
      // a lock held for good is one of the things that keep a browser from putting a tab nobody looks at to sleep
      if (!awake) { awake = true; navigator.locks?.request('poe2loot', () => new Promise(() => {})); }
      src.onerror = () => { if (src === es) { live = src.readyState === 2 ? 'none' : 'wait'; showLive(); } };
    }
    showLive();
  }
  function showLive() {
    const s = el.querySelector('.llive');
    if (!s) return;
    const mute = S.sound && live === 'on' && navigator.userActivation && !navigator.userActivation.hasBeenActive;   // browsers play nothing on a page nobody touched
    s.className = 'llive ' + (live === 'on' ? 'optmsg' : live === 'none' ? 'opterr' : 'note');
    s.textContent = live === 'on' ? t('watching what the game copies') + (mute ? ' · ' + t('click anywhere on this page once so it can play sounds') : '')
      : live === 'wait' ? t('connecting…') : live === 'none' ? t("this needs the planner's own server: python3 serve.py") : '';
  }
  addEventListener('pointerdown', showLive, { once: true });

  // ---------- the loot filter for the game
  // the build's own equipment says what it uses; what is worn fills in what the build leaves open
  const planOf = b => filterPlan({ b, gears: [b.items, S.worn[ctx.id()]], gem: gemOf(b), tree: ctx.sumOf({ ...b, items: {} }), sockets: ctx.sockets().length });
  // -> the name it was saved under, null when the user backed out. Where the browser lets the user choose the folder
  // (the game's own, so there is no file to move afterwards) it opens there again the next time; else a download.
  async function saveText(name, text) {
    if (window.showSaveFilePicker) {
      try {
        const h = await showSaveFilePicker({ id: 'poe2filter', startIn: 'documents', suggestedName: name, types: [{ description: 'Item filter', accept: { 'text/plain': ['.filter'] } }] });
        const w = await h.createWritable(); await w.write(text); await w.close();
        return h.name;
      } catch (e) { if (e.name === 'AbortError') return null; }   // not allowed here or now: a download does it too
    }
    const l = document.createElement('a');
    l.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    l.download = name; l.click();
    return name;
  }
  async function saveFilter(other) {   // other: { name, text } of the filter to put ours in front of
    const b = ctx.build(), ours = filterText(planOf(b), { name: b.name, min: S.fmin });
    const name = await saveText(filterFileName(b, other?.name), other ? mergeFilter(other.text, ours) : ours);
    if (name) { fmsg = t('Saved as {0}.', name); fbad = false; render(); }
  }
  function pickFilter() {
    const inp = Object.assign(document.createElement('input'), { type: 'file', accept: '.filter' });
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      const text = await f.text();
      if (!isFilter(text) || text.includes('\uFFFD')) { fmsg = t('That file is not an item filter.'); fbad = true; return render(); }
      saveFilter({ name: f.name, text });
    };
    inp.click();
  }
  function filterHtml(b) {
    const p = planOf(b), names = l => l.map(c => t(c)).join(', '), chip = (k, v, cls = '') => `<span class="${cls}">${k ? esc(k) + ': ' : ''}<b>${esc(v)}</b></span>`;
    const cut = p.cut.map(d => t(d[0].toUpperCase() + d.slice(1))).join(' / ');
    const kinds = p.defs.map(d => DEFENCES.filter((_, i) => d[i] !== false).map(x => t(x[2])).join(d.includes(null) ? ' / ' : ' + ')).join(', ');
    const notes = [!p.weapons.length ? 'No weapon is marked: put the weapon of the build in Equipment.' : p.from.weapons === 'skill' ? 'The weapon is guessed from the skill: put the weapon of the build in Equipment to be exact.' : '',
      p.defs.length ? '' : 'No armour is marked: the build has no armour pieces, defence passives or skill to tell which kind it wears.',
      p.uniques.length ? 'A filter cannot tell one unique from another: every unique of those bases is marked.' : ''].filter(Boolean);
    return `<section><h3>${t('Loot filter for the game')}</h3>
      <p class="note">${t("A file for the game's own item filter, made from this build: the kind of gear it uses stands out where it drops, with nothing to ask the planner. A filter cannot see an item's modifiers, so it marks what is worth a look: Ctrl+C over the item says whether it is an upgrade.")}</p>
      <div class="lworn">${p.weapons.length ? chip(t('Weapons'), p.weapons.map(c => t(c) + (p.only[c] ? ` (${t('only the bases that roll {0} spell modifiers', cut)})` : '')).join(', ')) : ''}${
        p.defs.length ? chip(t('Armour pieces'), `${names(p.armour)} · ${kinds}`) : ''}${chip('', names(p.jewellery))}${p.jewels ? chip('', t('Jewels')) : ''}${
        p.uniques.length ? chip(t('Uniques of the build'), p.uniques.map(u => u.name).join(', '), 'unique') : ''}</div>
      ${notes.map(n => `<p class="note">${t(n)}</p>`).join('')}
      <div class="optrow">
        <label>${t('Items marked')} <select data-s="fmin">${opt('rare', t('Rare items only'), S.fmin === 'rare')}${opt('magic', t('Magic and rare items'), S.fmin === 'magic')}${opt('normal', t('Items of every rarity'), S.fmin === 'normal')}</select></label>
        <button data-do="filter">${t('Save the filter')}</button><button data-do="merge">${t('Add it to a filter I already use…')}</button>
      </div>
      <p class="note">${t('Save it in Documents/My Games/Path of Exile 2 and pick it in the game: Options → Game → Item Filter. After a change to the build, save it again and load it again in the game.')}</p>
      ${fmsg ? `<p class="${fbad ? 'opterr' : 'optmsg'}">${esc(fmsg)}</p>` : ''}
    </section>`;
  }

  // ---------- the tab
  // slot <- item (null empties it): the worn gear kept here, or the build itself
  function put(slot, item, name) {
    if (S.vs === 'build') return ctx.change(b => { const it = b.items ||= {}; if (item) it[slot] = structuredClone(item); else delete it[slot]; });
    const w = S.worn[ctx.id()] ||= {};
    if (item) w[slot] = { ...structuredClone(item), ...(name && { name }) }; else delete w[slot];
    wornRev++; keep(); render();
  }
  function card(e, i) {
    const vs = verdict(e), v = vs[0], it = itemView(e.r.item), [icon, word] = BADGE[v?.kind || 'none'], name = e.r.name || it.name;
    const judged = v && v.kind !== 'on';
    const where = !v ? noSlot(e) : v.kind === 'on' ? slotName(v.slot)
      : `${slotName(v.slot)} · ${v.old ? t('instead of {0}', nameOf(v.old)) : t('the slot is empty')}`;
    const nums = !judged ? '' : `<div class="lnums">${v.nums.map(([label, x, y, key]) => `<div><span>${esc(t(label))}</span><b>${numOf(x, key)} → ${dir(numOf(y, key), sgn(x, y))}</b>${pct(x, y)}</div>`).join('')}${
      v.own.map(([k, x, y, d]) => `<div><span>${esc(t(k))}</span><b>${x ? propText(x) : '—'} → ${dir(y ? propText(y) : '—', d)}</b></div>`).join('')}${
      v.lean == null ? '' : `<div><span>${t('Damage × toughness')}</span>${pct(1, 1 + v.lean)}</div>`}</div>${v.why ? `<p class="note">${esc(t(v.why))}</p>` : ''}`;
    // the modifiers that change hands with the one it replaces
    const swap = !judged || !v.old || !(v.mods[0].length + v.mods[1].length) ? '' : `<div class="imp"><div class="imph">${esc(cap(t('instead of {0}', nameOf(v.old))))}</div>${
      v.mods.map((lines, k) => lines.map(l => `<div class="${k ? 'down' : 'up'}"><span>${esc(l)}</span><b>${k ? t('loses') : t('gains')}</b></div>`).join('')).join('')}</div>`;
    const changes = !judged ? '' : !v.raw ? v.rows.length ? impactHtml(t('What changes with it on'), v.rows) : ''
      : swap || !v.raw[0].length && !v.raw[1].length ? impactHtml(t('What changes with it on'), [])
      : `<div class="imp"><div class="imph">${t('The calculated numbers stay the same. Not counted by the planner:')}</div>${
        v.raw.map((lines, k) => lines.map(l => `<div class="${k ? 'down' : 'up'}"><span>${esc(l)}</span><b>${k ? t('loses') : t('gains')}</b></div>`).join('')).join('')}</div>`;
    const buttons = !v ? '' : v.kind === 'on' ? `<button data-do="undo" data-i="${i}" data-slot="${esc(v.slot)}">${e.undo?.slot === v.slot ? t('Undo') : t('Take off')}</button>`
      : vs.map(x => `<button class="${x.kind}" data-do="equip" data-i="${i}" data-slot="${esc(x.slot)}" title="${esc(t(BADGE[x.kind][1]))}">${vs.length > 1 ? esc(t('Equip: {0}', slotName(x.slot))) : t('Equip')}</button>`).join('');
    return `<div class="gitem ${it.rarity}${v?.kind === 'up' ? ' lup' : ''}">
      <div class="lverd ${v?.kind || ''}"><b>${icon} ${t(word)}</b><span>${esc(where)}</span><button data-do="drop" data-i="${i}" title="${t('Remove')}">✕</button></div>
      <div class="ghead">${it.img ? `<img src="${esc(it.img)}" alt="" loading="lazy" onerror="this.remove()">` : ''}<b>${esc(name || it.base)}</b>${name ? `<span>${esc(it.base)}</span>` : ''}</div>
      ${nums}
      <div class="gmods">${it.props.map(p => `<div class="prop">${t(p[0])}: <span>${propText(p)}</span></div>`).join('')}${it.dps ? `<div class="prop">${t("Weapon's damage per second")}: <span>${fmt(it.dps, 1)}</span></div>` : ''}${
        it.mods.map(m => `<div class="mod">${esc(m)}</div>`).join('')}${e.r.missed.map(m => `<div class="mod off" title="${t('Not understood: it is not counted')}">${esc(m)}</div>`).join('')}</div>
      ${changes}${swap}
      <div class="gfoot"><small class="note">${new Date(e.at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</small><span class="lbtns">${buttons}</span></div></div>`;
  }
  function render() {
    drawFloat();
    if (el.hidden) return;
    tab?.classList.remove('new');
    const b = ctx.build(), g = gemOf(b), own = skills(b), top = el.scrollTop, gear = Object.entries(gearOf(b)).filter(([s, it]) => itemView(it) && (SLOTS[s] || s.startsWith('jewel:')));
    const blocked = 'Notification' in window && Notification.permission === 'denied';
    el.innerHTML = `<div class="opt loot">
      <section class="opthead"><h3>${t('Loot')}</h3>
        <p class="note">${t("Hold the pointer over an item in the game (one you found and identified, one in the inventory or one a merchant sells) and press Ctrl+C. Paste it below, or let the planner pick it up by itself. The item is tried in every slot it fits and the build is worked out with and without it: the build's passives and skills decide what counts.")}</p>
        <div class="optrow">
          <label>${t('Compare with')} <select data-s="vs">${opt('worn', t('What the character wears'), S.vs !== 'build')}${opt('build', t("The build's equipment"), S.vs === 'build')}</select></label>
          <label>${t('Judge by')} <select data-s="key">${opt('', t('Damage and defence, each on its own'), !S.key)}${Object.entries(OBJECTIVES).map(([k, o]) => opt(k, t(o.label), S.key === k)).join('')}</select></label>
          ${own.length > 1 ? `<label>${t('Skill')} <select data-gem>${own.map((x, i) => opt(i, tn(GEM[x.name]) || x.name, x === g)).join('')}</select></label>` : ''}
        </div>
        ${g ? '' : `<p class="note">${t("The build has no skill: damage cannot be judged, only the defences and the weapon's own damage.")}</p>`}
        <div class="optrow">
          ${chk('watch', S.watch, t('Watch for items copied in the game'))}<span class="llive"></span>
        </div>
        <div class="optrow">
          ${over ? chk('over', S.over, t('Show the verdict over the game, next to the pointer'))
          : `<span class="note">${t('To see the verdict over the game, start the server with: python3 serve.py overlay')}</span>`}
        </div>
        <div class="optrow">
          ${chk('sound', S.sound, t('Sound'))}
          ${'Notification' in window ? chk('notify', S.notify, t('Desktop notification on upgrades') + (blocked ? ` (${t('blocked in the browser')})` : '')) : ''}
          ${'documentPictureInPicture' in window ? `<button data-do="float">${pip ? t('Close the floating window') : t('Floating window')}</button>` : ''}
        </div>
        <textarea class="pasteItem" data-act="paste" rows="2" placeholder="${t('Paste an item here: Ctrl+C on it in the game, or copied from Path of Building')}"></textarea>
        ${msg ? `<p class="${bad ? 'opterr' : 'optmsg'}">${esc(msg)}</p>` : ''}
      </section>
      <section><h3>${S.vs === 'build' ? t("The build's equipment") : t('What the character wears')}</h3>
        ${S.vs === 'build' ? `<p class="note">${t('Items are compared with the ones of the Equipment tab, and Equip puts them in the build.')}</p>`
        : gear.length ? '' : `<p class="note">${t('Nothing yet. Copy each item the character has on (Ctrl+C over it in the game): the first item copied for a slot is taken as the one worn there, and what you find or see in a shop afterwards is compared with it. The build is not changed.')}</p>
          ${Object.keys(b.items || {}).length ? `<div class="optrow"><button data-do="copy">${t("Start from the build's equipment")}</button></div>` : ''}`}
        ${gear.length ? `<div class="lworn">${gear.map(([s, it]) => `<span class="${itemView(it).rarity}">${esc(slotName(s))}: <b>${esc(nameOf(it))}</b>${
          S.vs === 'build' ? '' : `<button data-do="off" data-slot="${esc(s)}" title="${t('Take off')}">✕</button>`}</span>`).join('')}</div>` : ''}
      </section>
      ${filterHtml(b)}
      ${list.length ? `<section><div class="optrow"><h3>${t('Items looked at')}</h3><button data-do="clear">${t('Clear the list')}</button></div>
        <div class="gitems">${list.map(card).join('')}</div></section>` : ''}
    </div>`;
    el.scrollTop = top;
    showLive();
  }

  el.onchange = e => {
    const d = e.target.dataset;
    if (d.s) S[d.s] = e.target.value;
    else if ('gem' in d) S.gem[ctx.id()] = +e.target.value;
    else if (d.c) {
      S[d.c] = e.target.checked;
      if (d.c === 'watch') watch();
      if (d.c === 'notify' && S.notify && Notification.permission === 'default') Notification.requestPermission().then(render);
    } else return;
    keep(); render();
  };
  el.addEventListener('input', e => { const x = e.target; if (x.dataset.act === 'paste' && x.value.trim()) { const text = x.value; x.value = ''; add(text); } });
  el.onclick = e => {
    const d = e.target.closest('[data-do]');
    if (!d) return;
    const en = list[+d.dataset.i], slot = d.dataset.slot;
    switch (d.dataset.do) {
      case 'equip': { const old = gearOf(ctx.build())[slot]; en.undo = { slot, old: old ? structuredClone(old) : null }; put(slot, en.r.item, en.r.name); break; }
      case 'undo': { const old = en.undo?.slot === slot ? en.undo.old : null; en.undo = null; put(slot, old); break; }
      case 'off': put(slot, null); break;
      case 'copy': S.worn[ctx.id()] = structuredClone(ctx.build().items || {}); wornRev++; keep(); render(); break;
      case 'drop': list.splice(+d.dataset.i, 1); keepList(); render(); break;
      case 'clear': list = []; keepList(); render(); break;
      case 'float': float(); break;
      case 'filter': saveFilter(); break;
      case 'merge': pickFilter(); break;
    }
  };
  fetch('overlay').then(r => r.ok ? r.json() : {}).then(j => { over = !!j.overlay; render(); }).catch(() => {});
  if (S.watch) watch();
  return render;
}
