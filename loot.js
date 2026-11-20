// The equipment comparison (a section of Settings): is an item of the game better than the one in use, for this build?
// The item comes as the text the game copies with Ctrl+C over it (found and identified, in the inventory or in a
// merchant's shop), picked up by serve.py's /clipboard while the game is the window in use. It is tried in every slot it fits and the
// build is worked out with and without it, so the build's passives and skills decide what counts (spell damage on a
// wand is an upgrade for a spell and nothing for a bow). Without a skill only the defences and the weapon's own damage
// are judged. It is compared with the gear kept here as worn (the build is left alone) or the build's own.
// The verdict goes to serve.py's /overlay, which shows it over the game: there is nothing else to see.
//   ctx: { build(), id(), sumOf(b), snap(b), sockets() ([{id, label}] of the allocated jewel sockets) }
import { t, fmt, tn, lang, cap } from './i18n.js';
import { OBJECTIVES, score, whyNot } from './optimize.js';
import { GEM } from './skills.js';
import { SLOTS, parseItem, itemView, gearStats, offhandFits, classOf, propText, modDiff } from './items.js';
import { shownLines } from './stats.js';
import { diff, impactText } from './impact.js';
import { priceOf, priceUnid, leagues, siteLink, TradeError } from './trade.js';
import { settings, wornRow } from './settings.js';

const KEY = 'poe2loot';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const opt = (v, text, on) => `<option value="${esc(v)}"${on ? ' selected' : ''}>${esc(text)}</option>`;
const BADGE = { up: ['▲', 'Upgrade'], mix: ['⇄', 'Trade-off'], same: ['≈', 'About the same'], down: ['▼', 'Worse'], on: ['✓', 'Equipped'], none: ['–', 'No slot for it'] };
const RANK = { on: 4, up: 3, mix: 2, same: 1, down: 0 };

// a difference under half a percent is no difference; a number there was none of before counts as all gained
const sgn = (a, z) => { const x = a || 0, y = z || 0; return Math.abs(y - x) <= Math.max(Math.abs(x), Math.abs(y)) * .005 ? 0 : y > x ? 1 : -1; };
const mid = v => Array.isArray(v) ? (v[0] + v[1]) / 2 : v || 0;   // a damage range counts by its middle
const tone = d => d > 0 ? 'up' : d < 0 ? 'down' : '';
const MODS = 6;   // modifier lines of each list (gained, lost) shown over the game
const rel = (a, z) => { const x = a || 0, y = z || 0; return x > 0 ? y / x - 1 : y > 0 ? 1 : 0; };

export function initLoot(el, ctx) {
  const S = { vs: 'worn', key: '', gem: {}, on: {}, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  // what the character wears is the game's, one for every build (it used to be kept per build: the fullest one stays)
  if (S.worn) { S.on = Object.values(S.worn).reduce((a, g) => Object.keys(g).length > Object.keys(a).length ? g : a, S.on); delete S.worn; localStorage.setItem(KEY, JSON.stringify(S)); }
  if (S.key && !OBJECTIVES[S.key]) S.key = '';
  const keep = () => localStorage.setItem(KEY, JSON.stringify(S));
  let live = 'wait';             // the clipboard watch: 'wait' (connecting), 'on', 'none' (this server has no /clipboard)
  let over = false;              // serve.py has a window to show verdicts over the game

  // ---------- the build and what the item is compared with
  const skills = b => b.gems.filter(g => GEM[g.name] && GEM[g.name].kind !== 'support');
  const gemOf = b => { const l = skills(b); return l[S.gem[ctx.id()] || 0] || l[0] || null; };   // the skill picked for this build
  const gearOf = b => S.vs === 'build' ? b.items || {} : S.on;
  const slotName = slot => slot.startsWith('jewel:') ? `${t('Jewel')} (${ctx.sockets().find(j => 'jewel:' + j.id === slot)?.label || '?'})` : t(SLOTS[slot]);
  const nameOf = it => { const v = itemView(it); return it.name || (v ? v.name || v.base : it.base); };   // it.name: the one the game gave a worn item
  const numOf = (v, key) => { const o = OBJECTIVES[key] || { skill: true }; return v == null ? '—' : fmt(v, o.dec ?? (o.skill && Math.abs(v) < 100 ? 1 : 0)) + (o.unit || ''); };
  const share = (a, z) => !(a > 0) || z == null ? '' : (z >= a ? '+' : '') + fmt((z / a - 1) * 100, 1) + '%';

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
  // an item in every slot it fits, the best slot first (none: a jewel with no socket allocated)
  function verdict(e) {
    const b = ctx.build(), g = gemOf(b), gear = gearOf(b), giant = ctx.sumOf(b).keystone_giants_blood;
    // with no skill to say which weapons the build uses, a weapon is only compared with one of its own kind
    const fits = s => s === 'offhand' ? offhandFits(gear.weapon, e.r.item, giant) : s !== 'weapon' || g || !gear.weapon || classOf(gear.weapon) === classOf(e.r.item);
    const slots = e.r.slots.includes('jewel') ? ctx.sockets().map(j => 'jewel:' + j.id) : e.r.slots.filter(s => SLOTS[s] && fits(s));
    return slots.map(slot => rate(b, g, gear, slot, e.r.item)).sort((p, q) => RANK[q.kind] - RANK[p.kind] || q.gain - p.gain);
  }

  // ---------- telling: the window over the game
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
  const say = v => { if (over) fetch('overlay', { method: 'POST', body: JSON.stringify(v) }).catch(() => {}); };

  const fromBuild = () => { S.on = structuredClone(ctx.build().items || {}); keep(); };
  // ---------- items coming in
  function add(text) {
    text = text.replace(/\r/g, '').trim();
    const r = parseItem(text);
    const msg = !r ? t('That is not item text, or the planner does not have its base.') : r.unidentified ? t('That item is not identified yet: identify it and copy it again.')
      // modifiers are read in English and in the page's language only
      : lang === 'en' && !/^Rarity:/m.test(text) ? t('The game is in another language: set the planner to the same one (Settings) to read its modifiers.') : '';
    if (msg) return say({ kind: 'none', title: 'Exilewright', lines: [msg] });
    const e = { r };
    // nothing marked as worn yet: start from the build's equipment (an imported character's), not from this item
    if (S.vs !== 'build' && !Object.keys(S.on).length) fromBuild();
    // nothing is known to be worn where it goes: this is it (what the character has on is copied first)
    const free = S.vs === 'build' ? null : r.slots.find(s => verdict(e).some(x => x.slot === s && !x.old));
    if (free) { e.took = free; put(free, r.item, r.name); }
    say(told(e, verdict(e)[0]));
  }
  // the "put on" shortcut (Settings): the copied item is now what the character wears, in the slot where it does the
  // most (of two rings, the one it beats). Pressed again over it: it goes to the next slot it fits, and the one it left
  // gets back what it had (S.was). It also makes the comparison go by what the character wears
  function wear(text) {
    const r = parseItem(text.replace(/\r/g, '').trim());
    if (!r || r.unidentified) return say({ kind: 'none', title: 'Exilewright', lines: [t(r ? 'That item is not identified yet: identify it and copy it again.' : 'That is not item text, or the planner does not have its base.')] });
    if (S.vs === 'build') { S.vs = 'worn'; render(); }
    if (!Object.keys(S.on).length) fromBuild();
    const e = { r }, all = verdict(e), on = all.find(x => x.kind === 'on'), slots = all.map(x => x.slot).sort();
    if (!all.length) return say(told(e));
    const slot = on ? slots[(slots.indexOf(on.slot) + 1) % slots.length] : all[0].slot;
    if (on && slot !== on.slot) { if (S.was?.[on.slot]) S.on[on.slot] = S.was[on.slot]; else delete S.on[on.slot]; }
    if (slot !== on?.slot) { S.was = { [slot]: S.on[slot] }; put(slot, r.item, r.name); }
    say({ kind: 'on', title: `${BADGE.on[0]} ${t('Equipped')} · ${slotName(slot)}`, name: r.name || nameOf(r.item), lines: [
      t('Taken as what the character wears: what you copy next is compared with it'),
      ...slots.length > 1 ? [[[t('Press the shortcut again over it to put it in the other slot.'), 'dim']]] : []] });
  }
  // the price check shortcut (Settings): what the same item costs on the trade site, over the game. The item is not
  // judged
  async function priceCheck(text) {
    const show = v => { if (over) fetch('overlay', { method: 'POST', body: JSON.stringify({ kind: 'price', title: t('Price check'), open: t('Open on the trade site'), ...v }) }).catch(() => {}); };
    const r = parseItem(text.replace(/\r/g, '').trim());
    if (!r) return show({ lines: [t('That is not item text, or the planner does not have its base.')] });
    const name = r.name || nameOf(r.item), s = settings();
    const unid = r.unidentified && r;   // priced as the unidentified ones like it are
    show({ name, lines: [t(s.deep ? 'Searching the trade site (thorough search: it can take longer)…' : 'Searching the trade site…')] });
    try {
      const league = s.league || (await leagues())[0];
      const p = unid ? await priceUnid({ ...r, league, state: s.state }) : await priceOf({ league, item: r.item, r, text, state: s.state, near: +s.near, deep: !!s.deep }), link = p.id ? siteLink(league, p.id) : '';
      if (!p.total) return show({ name, link, lines: [t('Nothing like it is listed in {0}.', league),
        ...s.deep || unid ? [] : [[[t('Tip: turn on "Thorough search" in the Settings of Exilewright to look further.'), 'dim']]]] });
      const cost = x => `${x.amount} ${t(x.currency)}`;
      // note: the 5 cheapest shown, one per line, so the window stays small; the trade site's link lists them all
      const asked = p.prices.slice(0, 5).map(cost);
      show({ name, link, lines: [
        ...asked.length ? [[[t('Similar ones for sale') + ':', '']], ...asked.map(a => [['· ' + a, 'up']])] : [],
        [[unid ? (p.ilvl ? t('{0} unidentified ones like it listed in {1}, item level {2} or more', p.total, league, p.ilvl) : t('{0} unidentified ones like it listed in {1}', p.total, league))
          : p.near ? t('{0} like it listed in {1}, its numbers at most {2}% under', p.total, league, p.near) : t('{0} listed in {1}', p.total, league), 'dim']],
        ...p.within < p.of ? [[[t('With {0} of its {1} modifiers', p.within, p.of), 'dim']]] : [],
        ...p.raised ? [[[t('{0} of its modifiers searched up to {1}% to find any', p.raised, p.upTo), 'dim']]] : [],
        ...asked.length ? [[[t('What they ask, not what they sold for: check on the trade site to be sure.'), 'dim']]] : []] });
    } catch (e) {
      if (!(e instanceof TradeError)) throw e;
      show({ name, lines: [e.kind === 'wait' ? t('The trade site asks to wait {0} seconds before searching again.', Math.ceil(e.wait || 60)) : t('The trade site answered: {0}', e.message)] });
    }
  }
  // serve.py passes on what the game copies (a page cannot read the clipboard while another window is in use)
  function watch() {
    const src = new EventSource('clipboard?lang=' + lang);
    src.onopen = () => { live = 'on'; showLive(); };
    src.onmessage = m => { let x; try { x = JSON.parse(m.data); } catch { return; } if (x?.price) priceCheck(x.price); else if (x?.worn) wear(x.worn); else add(x); };
    src.onerror = () => { live = src.readyState === 2 ? 'none' : 'wait'; showLive(); };
    // a lock held for good is one of the things that keep a browser from putting a tab nobody looks at to sleep
    navigator.locks?.request('poe2loot', () => new Promise(() => {}));
  }
  function showLive() {
    const s = el.querySelector('.llive');
    if (!s) return;
    s.className = 'llive ' + (live === 'on' ? 'optmsg' : live === 'none' ? 'opterr' : 'note');
    s.textContent = live === 'on' ? t('watching what the game copies')
      : live === 'wait' ? t('connecting…') : live === 'none' ? t("this needs the planner's own server: python3 serve.py") : '';
  }

  // ---------- the section
  // slot <- item in the worn gear kept here
  function put(slot, item, name) { S.on[slot] = { ...structuredClone(item), ...(name && { name }) }; keep(); }
  function render() {
    const b = ctx.build(), g = gemOf(b), own = skills(b);
    el.innerHTML = `<h3>${t('Equipment comparison')}</h3>
        <p class="note">${t("Hold the pointer over an item in the game (one you found and identified, one in the inventory or one a merchant sells) and press Ctrl+C: next to the pointer you see whether it is better or worse than the one the character wears. The item is tried in every slot it fits and the build is worked out with and without it: the build's passives and skills decide what counts.")}</p>
        <div class="optrow">
          <label>${t('Compare with')} <select data-s="vs">${opt('worn', t('What the character wears'), S.vs !== 'build')}${opt('build', t("The build's equipment"), S.vs === 'build')}</select></label>
          <label>${t('Judge by')} <select data-s="key">${opt('', t('Damage and defence, each on its own'), !S.key)}${Object.entries(OBJECTIVES).map(([k, o]) => opt(k, t(o.label), S.key === k)).join('')}</select></label>
          ${own.length > 1 ? `<label>${t('Skill')} <select data-gem>${own.map((x, i) => opt(i, tn(GEM[x.name]) || x.name, x === g)).join('')}</select></label>` : ''}
        </div>
        ${g ? '' : `<p class="note">${t("The build has no skill: damage cannot be judged, only the defences and the weapon's own damage.")}</p>`}
        ${wornRow()}
        <div class="optrow">
          ${over ? '<span class="llive"></span>' : `<span class="note">${t('To see the verdict over the game, start the server with: python3 serve.py overlay')}</span>`}
        </div>`;
    showLive();
  }

  el.onchange = e => {
    const d = e.target.dataset;
    if (d.s) S[d.s] = e.target.value;
    else if ('gem' in d) S.gem[ctx.id()] = +e.target.value;
    else return;
    keep(); render();
  };
  fetch('overlay').then(r => r.ok ? r.json() : {}).then(j => { over = !!j.overlay; render(); }).catch(() => {});
  watch();
  return render;
}
