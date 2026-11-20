// The Optimizer tab: asks optimize.js for the passive tree path and the support gems that raise one number of the
// build the most, and trade.js for gear listed on the official trade site that does. Everything shown is what the
// planner's own calculation says, so it is a guide, not a promise. app.js owns the build: it only changes through ctx.
//   ctx: { build(), id(), rev(), sumOf(b), snap(b), tree, N, rootOf(b), total (tree points), setNodes(b, nodes),
//          change(fn(b)) (edits the build, saves, redraws), showOnTree(ids), ask(text, ...options) }
import { t, tn, fmt } from './i18n.js';
import { OBJECTIVES, score, whyNot, optimizeTree, bestSupports } from './optimize.js';
import { GEM, colour, supportText } from './skills.js';
import { SK } from './skilldata.js';
import { SLOTS, classOf, slotClasses, wear, priceLines, affixLines, modsOf } from './items.js';
import { diff, impactHtml, impactList } from './impact.js';
import { CATEGORY, SEARCH_SLOTS, STATUS, CURRENCY, MONEY, wanted, withIds, findGear, findLike, findBetter, leagues, weighted, siteQuery } from './trade.js';

const KEY = 'poe2opt';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const img = p => p ? 'poe2_data/available/img/' + p.toLowerCase().replace(/\.dds$/, '.webp') : '';
const ATTR = { str: ['Strength', '#c44'], dex: ['Dexterity', '#4a4'], int: ['Intelligence', '#48c'] };
const NOTES = {
  mix: 'Balanced: damage per second × toughness, so neither is given up for the other.',
  tough: 'Toughness: how many hits of a normal monster of your level it takes to bring the character down. Evasion, block, armour and resistances count; recovery does not.',
};
const SHOWN = 20;   // items of a gear search on screen
const opt = (v, text, on) => `<option value="${esc(v)}"${on ? ' selected' : ''}>${esc(text)}</option>`;
const chk = (k, on, text, tip = '') => `<label class="chk" title="${esc(tip)}"><input type="checkbox" data-c="${k}"${on ? ' checked' : ''}> ${esc(text)}</label>`;

export function initOpt(el, ctx) {
  const S = { key: 'dps', gem: {}, mode: 'add', pref: '', cap: true, lineage: false, limited: false, slot: 'weapon', cls: {}, league: '', state: 'securable', max: '', currency: '', how: 'best', like: {},
    ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  if (!OBJECTIVES[S.key]) S.key = 'dps';
  const keep = () => localStorage.setItem(KEY, JSON.stringify(S));
  let at = null;                 // the build on screen
  let typed = {};                // numbers typed for this build (points, sockets, lvl); the rest follow the build
  let T = null, U = null;        // results for the build as it is (rev): tree { rev, r, after, fresh }, supports { rev, r, key, sockets }
  let run = null, busy = null;   // searches in progress: tree { stop, spent, of }, trade site { text }
  let thinking = false;          // supports being worked out
  let msg = {};                  // what the last action did, per card
  const G = {};                  // gear found, per build + slot + class + objective
  let net = null;                // the trade site: { leagues, offline }
  const wantMemo = { key: '', list: [] };

  // ---------- the build and the objective
  const skills = b => b.gems.filter(g => GEM[g.name] && GEM[g.name].kind !== 'support');
  // the skill picked for this build; none picked yet: the one that does the most damage (the first skill is often an aura
  // or a buff, and nothing raises the damage of a skill that does none)
  let main = null;
  const gemOf = b => {
    const list = skills(b);
    if (S.gem[ctx.id()] != null) return list[S.gem[ctx.id()]] || list[0] || null;
    if (main?.rev !== ctx.rev() || main.id !== ctx.id()) {
      const sum = ctx.sumOf(b), dps = list.map(g => rate('dps', b, g, sum) || 0);
      main = { rev: ctx.rev(), id: ctx.id(), g: list[dps.indexOf(Math.max(0, ...dps))] || list[0] || null };
    }
    return main.g;
  };
  const rate = (key, b, g, sum = ctx.sumOf(b)) => whyNot(key, b, sum, g) ? null : score(key, b, sum, g);
  const num = (v, key) => { const o = OBJECTIVES[key]; return v == null ? '—' : fmt(v, o.dec ?? (o.skill && Math.abs(v) < 100 ? 1 : 0)) + (o.unit || ''); };
  // the objective as text ("balanced" is a product: its two numbers say more)
  const show = (key, b, g, sum = ctx.sumOf(b)) => key === 'mix' ? `${num(rate('dps', b, g, sum), 'dps')} × ${num(rate('tough', b, g, sum), 'tough')}` : num(rate(key, b, g, sum), key);
  const pct = (a, z) => !(a > 0) || z == null ? '' : `<i class="${z > a * (1 + 1e-9) ? 'up' : z < a * (1 - 1e-9) ? 'down' : ''}">${z >= a ? '+' : ''}${fmt((z / a - 1) * 100, 1)}%</i>`;
  const gemName = name => esc(tn(GEM[name]) || name);

  // ---------- passive tree
  const freshOf = b => ({ ...b, nodes: [], set1: [], set2: [], attrs: {} });
  const usedOf = b => Math.max(0, b.nodes.length - 1);
  const pointsFor = b => Math.max(1, Math.min(ctx.total, typed.points ?? (S.mode === 'new' ? ctx.total : ctx.total - usedOf(b))));
  // the build with a path of the search taken (a passive that was a weapon set point becomes a normal one, as in the tree)
  function withPath(b, r, fresh) {
    const z = structuredClone(fresh ? freshOf(b) : b);
    for (const k of [1, 2]) z['set' + k] = (z['set' + k] || []).filter(n => !r.nodes.includes(n));
    ctx.setNodes(z, [...(z.nodes.length ? z.nodes : [ctx.rootOf(b)]), ...r.nodes]);
    z.attrs = { ...z.attrs, ...r.attrs };
    z.level = Math.min(100, z.nodes.length);   // the planner's level follows the points spent
    return z;
  }
  const runText = () => t('{0} of {1} points placed…', run.spent, run.of);
  async function runTree() {
    const b = ctx.build(), g = gemOf(b), fresh = S.mode === 'new', rev = ctx.rev(), key = S.key, b0 = fresh ? freshOf(b) : b, pts = pointsFor(b);
    const bL = { ...b0, level: Math.min(100, 1 + usedOf(b0) + pts) };
    const me = run = { stop: false, spent: 0, of: pts };
    T = null; render();
    await new Promise(r => setTimeout(r, 30));   // the progress line gets on screen first
    const r = await optimizeTree({ tree: ctx.tree, b: b0, base: ctx.sumOf(b0), root: ctx.rootOf(b), f: s => score(key, bL, s, g), points: pts,
      pref: S.pref || g && colour(GEM[g.name]) || 'str', stop: () => me.stop || ctx.rev() !== rev,
      tick: p => { me.spent = p.spent; const o = el.querySelector('#optRun'); if (o) o.textContent = runText(); return new Promise(r => setTimeout(r)); } });
    if (run === me) run = null;
    if (ctx.rev() === rev) T = { rev, r, fresh, key, after: withPath(b, r, fresh) };
    render();
  }
  function treeCard(b, g, why) {
    const auto = g && colour(GEM[g.name]) || 'str', none = S.mode !== 'new' && typed.points == null && usedOf(b) >= ctx.total;
    let res = '';
    if (run) res = `<div class="optrun"><span id="optRun">${runText()}</span> <button data-do="stop">${t('Cancel')}</button></div>`;
    else if (T && !T.r.nodes.length) res = `<p class="note">${t('No passive within reach raises this objective.')}</p>`;
    else if (T) {
      const z = T.after, notables = T.r.nodes.filter(id => ctx.N[id].type === 'notable').map(id => tn(ctx.N[id]));
      res = `<div class="optres"><div class="optval">${esc(t(OBJECTIVES[T.key].label))}: ${show(T.key, b, g)} → <b>${show(T.key, z, g)}</b> ${pct(rate(T.key, b, g), rate(T.key, z, g))}</div>
        <div class="note">${t('{0} points placed, level {1}.', T.r.nodes.length, z.level)}${T.r.stopped ? ' ' + t('The search was stopped before the end.') : ''}${T.fresh ? ' ' + t('Applying it replaces the current tree and its weapon set points.') : ''}</div>
        ${notables.length ? `<div class="optlist"><span class="note">${t('Notables')}:</span> ${notables.map(esc).join(' · ')}</div>` : ''}
        ${impactHtml(t('What the path changes'), diff(ctx.snap(b), ctx.snap(z)))}
        <div class="optrow"><button class="optgo" data-do="applyTree">${t('Apply to the build')}</button>${T.fresh ? '' : `<button data-do="showTree">${t('Show on the tree')}</button>`}</div></div>`;
    } else if (msg.tree) res = `<p class="optmsg">${esc(msg.tree)}</p>`;
    return `<section><h3>${t('Passive tree')}</h3>
      <p class="note">${t('Spends the points on the passives that raise the objective the most, one step at a time: good paths, not a proven best one. Keystones and effects the planner does not calculate are never a reason to walk somewhere.')}</p>
      <div class="optrow"><label>${t('Points to spend')} <input type="number" min="1" max="${ctx.total}" value="${pointsFor(b)}" data-n="points"></label>
        <label>${t('Starting from')} <select data-s="mode">${opt('add', t('The current tree'), S.mode !== 'new')}${opt('new', t('The class start (a new tree)'), S.mode === 'new')}</select></label>
        <label title="${esc(t('Attribute passives on the way become the attribute that helps the objective; when none does, this one.'))}">${t('Attribute passives')}
          <select data-s="pref">${opt('', t('Auto ({0})', t(ATTR[auto][0])), !ATTR[S.pref])}${Object.entries(ATTR).map(([k, [name]]) => opt(k, t(name), k === S.pref)).join('')}</select></label>
        <button class="optgo" data-do="tree"${why || run || none ? ' disabled' : ''}>${t('Find the best path')}</button></div>
      ${none ? `<p class="note">${t('All {0} points are spent: start from the class start to plan the whole tree again.', ctx.total)}</p>` : ''}${res}</section>`;
  }

  // ---------- support gems
  const supKey = () => S.key === 'speed' ? 'speed' : 'dps';   // supports change a skill: any other objective rates them by its damage
  const socketsFor = g => Math.max(1, Math.min(SK.max_support_sockets || 5, typed.sockets ?? g?.sockets ?? 2));
  function runSup() {
    thinking = true; U = null; render();
    setTimeout(() => {   // the page shows "Calculating…" before the work starts
      thinking = false;
      const b = ctx.build(), g = gemOf(b), key = supKey(), sockets = socketsFor(g);
      if (g) U = { rev: ctx.rev(), key, sockets, r: bestSupports({ b, g, sum: ctx.sumOf(b), key, sockets, lineage: S.lineage, limited: S.limited, capacity: S.cap }) };
      render();
    }, 30);
  }
  const chip = name => `<span class="optgem" title="${esc(supportText(GEM[name]) || '')}"><img src="${img(GEM[name].icon)}" alt=""><b style="color:${ATTR[colour(GEM[name])]?.[1] || '#ccc'}">${gemName(name)}</b></span>`;
  function supCard(b, g, sum) {
    const key = supKey(), n = socketsFor(g);
    let res = '';
    if (thinking) res = `<p class="note">${t('Calculating…')}</p>`;
    else if (U?.r.error) res = `<p class="note">${esc(t(U.r.error))}</p>`;
    else if (U) {
      const r = U.r, cur = score(U.key, b, sum, g), has = (g.supports || []).some(Boolean);
      res = `<div class="optres">${r.combos.length ? '' : `<p class="note">${t('No support the planner can calculate raises this.')}</p>`}
        ${r.combos.map((c, i) => `<div class="optcombo"><div class="optgems">${c.names.map(chip).join('')}</div>
          <div class="optval"><b>${num(c.value, U.key)}</b> ${pct(r.base, c.value)} <small class="note">${t('against no supports')}</small>${has ? ` ${pct(cur, c.value)} <small class="note">${t('against the ones it has')}</small>` : ''}
            <button${i ? '' : ' class="optgo"'} data-do="useSup" data-i="${i}">${t('Apply')}</button></div></div>`).join('')}
        ${r.singles.length ? `<div class="optlist"><span class="note">${t('Each one by itself')}:</span> ${r.singles.slice(0, 12).map(x => `<span title="${esc(supportText(GEM[x.name]) || '')}">${gemName(x.name)} ${pct(r.base, x.value)}</span>`).join(' · ')}</div>` : ''}
        <p class="note">${t('{0} supports fit this skill; {1} of them have no data the planner can calculate yet and were left out.', r.compatible, r.unknown)}
          ${r.cap ? t('Support capacity left for this skill: {0} red, {1} green, {2} blue.', r.cap.str, r.cap.dex, r.cap.int) : ''}</p></div>`;
    } else if (msg.sup) res = `<p class="optmsg">${esc(msg.sup)}</p>`;
    return `<section><h3>${t('Support gems')}</h3>
      <p class="note">${t('Tries every support the skill can take, alone and then the best ones together (their multipliers stack), keeping the game\'s rules: skill types, one support of each family, and the support capacity your attributes give.')}
        ${OBJECTIVES[S.key].skill && S.key !== 'mix' ? '' : t('Supports only change the skill, so here they are rated by its damage per second.')}</p>
      <div class="optrow"><label>${t('Sockets')} <select data-n="sockets">${Array.from({ length: SK.max_support_sockets || 5 }, (_, i) => opt(i + 1, i + 1, i + 1 === n)).join('')}</select></label>
        ${chk('cap', S.cap, t('Within the support capacity'), t('Each support needs capacity of its colour: 5 of the attribute give 1, and the supports of your other skills use it too.'))}
        ${chk('lineage', S.lineage, t('Lineage supports'), t('Rare supports that drop from specific bosses.'))}
        ${chk('limited', S.limited, t('Supports that limit its use'), t('Supports that add a long cooldown or a condition to use the skill: more per use, not more per second.'))}
        <button class="optgo" data-do="sup"${g && !thinking ? '' : ' disabled'}>${t('Find the best supports')}</button></div>${res}</section>`;
  }

  // ---------- gear on the trade site
  function gearSel(b) {
    const slot = SEARCH_SLOTS.includes(S.slot) ? S.slot : 'weapon', classes = slotClasses(slot).filter(c => CATEGORY[c]), mine = classOf(b.items?.[slot]);
    return { slot, classes, cls: classes.includes(S.cls[slot]) ? S.cls[slot] : classes.includes(mine) ? mine : classes[0] };
  }
  const valueOf = (b, g, key) => items => { const z = { ...b, items }; return g || !OBJECTIVES[key].skill ? score(key, z, ctx.sumOf(z), g) : null; };
  const levelFor = b => Math.max(0, Math.min(100, typed.lvl ?? (b.level > 1 ? b.level : 0)));
  const leagueList = () => net?.leagues?.length ? net.leagues : ['Standard', 'Hardcore'];
  const leagueNow = () => leagueList().includes(S.league) ? S.league : leagueList()[0];
  const priceNow = () => ({ max: +S.max || 0, currency: CURRENCY.includes(S.currency) ? S.currency : '' });
  const moneyName = c => c === '' ? t('Exalted Orb Equivalent') : c === 'exalted_divine' ? t('Exalted or Divine Orbs') : tn(MONEY.currency[c]) || c;
  // a price as the game shows it: the amount and the currency's art (its name when the art is missing)
  const priceHtml = p => { const m = MONEY.currency[p.currency];
    return `<b>${esc(fmt(p.amount, p.amount % 1 ? 2 : 0))}</b> ${m ? `<img src="${img(m.img)}" alt="" title="${esc(tn(m))}"> ${esc(tn(m))}` : esc(p.currency)}`; };
  const gk = () => OBJECTIVES[S.gear] ? S.gear : S.key;   // what the gear search raises (Stat to improve; none picked: the objective)
  const gearKey = (b, sel) => [ctx.id(), sel.slot, sel.cls, gk(), skills(b).indexOf(gemOf(b))].join('|');
  function wantsFor(b, g, sel) {   // what a top roll of each modifier the slot can have adds, best first (kept while nothing changes)
    const key = ctx.rev() + '|' + gearKey(b, sel);
    if (wantMemo.key !== key) { wantMemo.key = key; wantMemo.list = wanted({ cls: sel.cls, slot: sel.slot, items: b.items || {}, value: valueOf(b, g, gk()) }); }
    return wantMemo.list;
  }
  function netStart(again) {
    if (net && !again) return;
    const me = net = { leagues: null, offline: false };
    leagues().then(l => { me.leagues = l; }, e => { me.leagues = []; me.offline = e.kind === 'offline'; })
      .then(() => { if (net !== me || el.hidden) return; render(); });
  }
  async function runGear() {
    const b = ctx.build(), g = gemOf(b), sel = gearSel(b), id = gearKey(b, sel), league = leagueNow(), price = priceNow(), level = levelFor(b), state = STATUS[S.state] ? S.state : 'securable';
    const me = busy = { text: t('Searching the trade site ({0} of {1})…', 1, '…') };
    render();
    try {
      const wants = await withIds(wantsFor(b, g, sel));
      const res = await findGear({ league, cls: sel.cls, slot: sel.slot, items: b.items || {}, value: valueOf(b, g, gk()), wants, price, level, state,
        tick: (text, ...a) => { me.text = t(text, ...a); const o = el.querySelector('#optBusy'); if (o) o.textContent = me.text; } });
      G[id] = { res, wants, league, price, level, state, cls: sel.cls };
      if (res.errors.some(e => e.kind === 'offline')) netStart(true);   // the server may be up the next time
    } finally { if (busy === me) busy = null; render(); }
  }
  // the search for items with the modifiers picked (or the worn item's: one like it or better), cheapest first
  const likeOf = slot => S.like[slot] ||= [];
  const wornLines = it => priceLines(it).filter(l => l.varies && l.text).map(({ hash, en, kind, text, value }) => ({ hash, en, kind, text, value: Math.round(value * 100) / 100 }));
  async function runLike() {
    const b = ctx.build(), g = gemOf(b), sel = gearSel(b), id = gearKey(b, sel) + '|like', league = leagueNow(), price = priceNow(), level = levelFor(b), state = STATUS[S.state] ? S.state : 'securable';
    const worn = b.items?.[sel.slot], same = worn?.unique && classOf(worn) === sel.cls && likeOf(sel.slot).every(l => wornLines(worn).some(w => w.hash === l.hash && w.en === l.en));
    const me = busy = { text: t('Searching the trade site ({0} of {1})…', 1, 1) };
    render();
    try {
      const res = await findLike({ league, cls: sel.cls, ...same && { unique: worn.unique, base: worn.base }, slot: sel.slot, items: b.items || {}, value: valueOf(b, g, gk()),
        lines: likeOf(sel.slot), price, level, state, tick: (text, ...a) => { me.text = t(text, ...a); const o = el.querySelector('#optBusy'); if (o) o.textContent = me.text; } });
      G[id] = { res, like: true, league, state };
      if (res.errors.some(e => e.kind === 'offline')) netStart(true);
    } finally { if (busy === me) busy = null; render(); }
  }
  const errText = e => e.kind === 'offline' ? t('The gear search needs the planner\'s own server: start it with "python3 serve.py" and open the page it prints.')
    : e.kind === 'wait' ? t('The trade site asks to wait {0} seconds before searching again.', Math.ceil(e.wait || 60)) : t('The trade site answered: {0}', e.message);
  function found(b, g, sel, hit) {
    const { res, league } = hit, key = gk(), items = b.items || {}, value = valueOf(b, g, key), cur = value(items), base = ctx.snap(b), mine = JSON.stringify(items[sel.slot] || null);
    // only what raises the stat over what the character wears (an empty slot: anything that counts)
    // the modifiers picked: every item found, cheapest first (as the site lists them)
    const list = res.found.map((l, i) => ({ l, i, v: value({ ...items, [sel.slot]: l.item }) }))
      .filter(x => hit.like || x.v != null && JSON.stringify(x.l.item) !== mine && (cur == null ? x.v > 0 : x.v > cur * (1 + 1e-9) + 1e-9))
      .sort((x, y) => hit.like ? 0 : y.v - x.v).slice(0, SHOWN);
    // the item itself on the site: its base (a unique: and its name), its seller and its price
    const onSite = l => siteQuery(league, { query: { status: { option: hit.state }, type: l.base, ...(l.rarity === 'unique' && l.name && { name: l.name }),
      filters: { trade_filters: { filters: { ...(l.seller && { account: { input: l.seller } }), ...(l.price && CURRENCY.includes(l.price.currency) && { price: { min: l.price.amount, max: l.price.amount, option: l.price.currency } }) } } } }, sort: { price: 'asc' } });
    const card = ({ l, i, v }) => {
      const off = new Set(l.missed);
      return `<div class="gitem ${esc(l.rarity)}"><div class="ghead"><b>${esc(l.name || l.base)}</b>${l.name ? `<span>${esc(l.base)}</span>` : ''}<small>${l.ilvl ? t('Item level {0}', l.ilvl) : ''}</small></div>
        <div class="gmods">${modsOf(l).map(m => `<div class="mod${off.has(m) ? ' off' : ''}">${esc(m)}</div>`).join('')}${l.extra.map(m => `<div class="mod off">${esc(m)}</div>`).join('')}</div>
        ${impactList(diff(base, ctx.snap({ ...b, items: { ...items, [sel.slot]: l.item } })))}
        <div class="gfoot"><div class="gval">${esc(t(OBJECTIVES[key].label))}: ${key === 'mix' ? '' : `<b>${num(v, key)}</b> `}${pct(cur, v)}</div>
          <div class="gprice">${l.price ? priceHtml(l.price) : t('no price')}</div>
          ${l.seller ? `<div class="note">${t('Seller')}: ${esc(l.seller)}</div>` : ''}
          <div class="gbtns"><button data-do="equip" data-i="${i}">${t('Equip')}</button><a class="gsite" href="${esc(onSite(l))}" target="_blank" rel="noopener">${t('Open on the web')}</a></div></div></div>`;
    };
    const w = !hit.like && weighted({ cls: hit.cls, wants: hit.wants, price: hit.price, level: hit.level, state: hit.state });
    return `<div class="optres">${res.errors.map(e => `<p class="opterr">${esc(errText(e))}</p>`).join('')}
      ${res.unread ? `<p class="note">${t('{0} listed items were left out: the planner does not have their base or they go in another slot.', res.unread)}</p>` : ''}
      ${res.searches.length && !res.found.length && !res.errors.length ? `<p class="note">${t('Nothing listed matches. Try another league, a higher price or "Any" seller.')}</p>` : ''}
      ${res.found.length && !list.length ? `<p class="note">${t('None of the items found improves the current gear.')}</p>` : ''}
      ${res.left ? `<p class="note">${t('{0} of the modifiers are not on the trade site: left out of the search.', res.left)}</p>` : ''}
      ${hit.like ? `<a class="golink" href="${esc(siteQuery(league, res.body))}" target="_blank" rel="noopener">${t('Open this search on the trade site')}</a>` : ''}
      <div class="gitems">${list.map(card).join('')}</div>
      ${res.found.length ? `<p class="note">${t('Rated with each item on the build. Not counted: quality, runes, enchantments and the lines in grey. Requirements are not checked.')}</p>` : ''}
      ${w ? `<p class="note"><a href="${esc(siteQuery(league, w))}" target="_blank" rel="noopener">${t('Open the weighted search on the trade site')}</a> — ${t('every modifier weighted by what it is worth to this build, the search Path of Building makes. The site only runs it when you are logged in there.')}</p>` : ''}</div>`;
  }
  // the modifiers picked for the slot: each with the least it must have, a list to add more, and the worn item's to start from
  const lk = o => o.hash ?? 'd:' + o.en;   // a line's key: its stat, or a desecrated one's wording
  const hashed = s => s.replace(/\d+(?:[.,]\d+)?/g, '#');   // a line without its numbers: the number is the box's
  function likeHtml(b, sel) {
    const list = likeOf(sel.slot), worn = b.items?.[sel.slot], have = new Set(list.map(lk));
    const more = affixLines(sel.cls).filter(o => !have.has(lk(o)));
    return `<div class="likes">${list.map((l, i) => `<div class="likerow"><span>${esc(hashed(l.text))}</span>
        <label>${t('at least')} <input type="number" step="any" value="${l.value || ''}" placeholder="—" data-like="${i}"></label><button data-do="unlike" data-i="${i}" title="${t('Remove')}">✕</button></div>`).join('')
      || `<p class="note">${t('Pick the modifiers the item must have, each with the least of it.')}</p>`}</div>
      <div class="optrow"><select data-addlike><option value="">${t('+ Modifier')}</option>${more.map(o => opt(lk(o), hashed(o.text), false)).join('')}</select>
        <button data-do="fromWorn"${worn && classOf(worn) === sel.cls ? '' : ' disabled'}>${t('The modifiers of the item worn')}</button>
        ${list.length ? `<button data-do="clearLike">${t('Clear')}</button>` : ''}</div>`;
  }
  function gearCard(b, g) {
    const like = S.how === 'like', sel = gearSel(b), blocked = !like && OBJECTIVES[gk()].skill && !g, wants = blocked || like ? [] : wantsFor(b, g, sel), hit = G[gearKey(b, sel) + (like ? '|like' : '')];
    return `<section><h3>${t('Gear on the trade site')}</h3>
      <p class="note">${t('Works out what each modifier the slot can roll is worth to the objective, looks for items listed on the official trade site that have the best ones, puts each on the build and ranks them by what they really change.')}</p>
      <div class="optrow"><label>${t('Look for')} <select data-s="how">${opt('best', t('The best for a stat'), !like)}${opt('like', t('Chosen modifiers'), like)}</select></label>
        ${like ? '' : `<label>${t('Stat to improve')} <select data-s="gear">${Object.entries(OBJECTIVES).map(([k, o]) => opt(k, t(o.label), k === gk())).join('')}</select></label>`}
        <label>${t('Slot')} <select data-s="slot">${SEARCH_SLOTS.map(s => opt(s, t(SLOTS[s]), s === sel.slot)).join('')}</select></label>
        ${sel.classes.length > 1 ? `<label>${t('Type')} <select data-cls>${sel.classes.map(c => opt(c, t(c), c === sel.cls)).join('')}</select></label>` : ''}
        <label>${t('League')} <select data-s="league">${leagueList().map(l => opt(l, l, l === leagueNow())).join('')}</select></label>
        <label>${t('Seller')} <select data-s="state">${Object.entries(STATUS).map(([k, v]) => opt(k, t(v), k === (STATUS[S.state] ? S.state : 'securable'))).join('')}</select></label></div>
      <div class="optrow"><label>${t('Price up to')} <input type="number" min="0" value="${esc(S.max)}" data-s="max" placeholder="—"></label>
        <select data-s="currency" title="${esc(t('Currency of the price'))}">${CURRENCY.map(c => opt(c, moneyName(c), c === priceNow().currency)).join('')}</select>
        <label title="${esc(t('Leaves out what the character cannot wear yet. Empty: any level.'))}">${t('Required level up to')} <input type="number" min="0" max="100" value="${levelFor(b) || ''}" data-n="lvl" placeholder="—"></label>
        <button class="optgo" data-do="${like ? 'like' : 'gear'}"${blocked || busy || (like ? !likeOf(sel.slot).length : !wants.length) || !net?.leagues ? ' disabled' : ''}>${t('Search')}</button></div>
      ${like ? likeHtml(b, sel) : ''}
      ${net?.offline ? `<p class="opterr">${esc(errText({ kind: 'offline' }))}</p>` : ''}
      ${blocked || like || wants.length ? '' : `<p class="note">${t('No modifier this slot can roll raises this objective.')}</p>`}
      ${net && !net.offline && net.leagues ? `<p class="note">${t('Without a trade session the site only takes simple searches, so the planner asks for the items with the most of each of the best modifiers and compares them.')}</p>` : ''}
      ${busy ? `<p class="optrun"><span id="optBusy">${esc(busy.text)}</span></p>` : hit ? found(b, g, sel, hit) : ''}</section>`;
  }

  // ---------- the screen
  function render() {
    const b = ctx.build();
    if (at !== ctx.id()) { at = ctx.id(); typed = {}; msg = {}; T = U = null; }
    if (T?.rev !== ctx.rev()) T = null;
    if (U?.rev !== ctx.rev()) U = null;
    netStart();
    const g = gemOf(b), sum = ctx.sumOf(b), why = whyNot(S.key, b, sum, g), list = skills(b), top = el.scrollTop;
    el.innerHTML = `<div class="opt"><section class="opthead"><div class="optrow">
        <label>${t('Objective')} <select data-s="key">${Object.entries(OBJECTIVES).map(([k, o]) => opt(k, t(o.label), k === S.key)).join('')}</select></label>
        <label>${t('Skill')} ${list.length ? `<select data-gem>${list.map((x, i) => opt(i, tn(GEM[x.name]), x === g)).join('')}</select>` : `<span class="note">${t('Add a skill to the build first')}</span>`}</label>
        <div class="optnow">${why ? (list.length ? `<span class="note">${esc(t(why))}</span>` : '') : `${t('Now')}: <b>${show(S.key, b, g, sum)}</b>`}</div></div>
      ${NOTES[S.key] ? `<p class="note">${t(NOTES[S.key])}</p>` : ''}</section>
      ${treeCard(b, g, why)}${supCard(b, g, sum)}${gearCard(b, g)}</div>`;
    el.scrollTop = top;
  }
  el.onchange = e => {
    const x = e.target, d = x.dataset;
    let other = false;   // the tree search in progress is for something else now
    msg = {};
    if (d.s) { S[d.s] = x.value; if (d.s === 'mode') delete typed.points; if (d.s === 'key' || d.s === 'mode' || d.s === 'pref') { T = null; other = true; } if (d.s === 'key') { U = null; delete S.gear; } }
    else if (d.n) { if (x.value === '') delete typed[d.n]; else typed[d.n] = +x.value; if (d.n === 'lvl' && x.value === '') typed.lvl = 0; if (d.n === 'sockets') U = null; if (d.n === 'points') { T = null; other = true; } }
    else if (d.c) { S[d.c] = x.checked; U = null; }
    else if ('gem' in d) { S.gem[ctx.id()] = +x.value; delete typed.sockets; T = U = null; other = true; }
    else if ('cls' in d) S.cls[gearSel(ctx.build()).slot] = x.value;
    else if (d.like != null) { const l = likeOf(gearSel(ctx.build()).slot)[+d.like]; if (l) l.value = +x.value || 0; }
    else if ('addlike' in d) { const sel = gearSel(ctx.build()), o = x.value && affixLines(sel.cls).find(o => String(lk(o)) === x.value); if (!o) return; likeOf(sel.slot).push({ hash: o.hash, en: o.en, text: o.text, value: 0 }); }
    else return;
    if (run && other) run.stop = true;
    keep(); render();
  };
  el.onclick = async e => {
    const btn = e.target.closest('[data-do]'); if (!btn || btn.disabled) return;
    const what = btn.dataset.do, b = ctx.build();
    msg = {};
    if (what === 'tree') return runTree();
    if (what === 'stop') { if (run) run.stop = true; return; }
    if (what === 'sup') return runSup();
    if (what === 'gear') return runGear();
    if (what === 'like') return runLike();
    const ls = gearSel(b).slot;
    if (what === 'unlike') { likeOf(ls).splice(+btn.dataset.i, 1); keep(); return render(); }
    if (what === 'clearLike') { S.like[ls] = []; keep(); return render(); }
    if (what === 'fromWorn') { S.like[ls] = wornLines(b.items[ls]); keep(); return render(); }
    if (what === 'showTree' && T) return ctx.showOnTree(T.r.nodes);
    if (what === 'applyTree' && T) {
      const { r, fresh } = T, had = usedOf(b) + (b.set1?.length || 0) + (b.set2?.length || 0);
      if (fresh && had && await ctx.ask(t('Replace the current tree? {0} allocated points will be removed.', had), t('Replace')) !== 0) return;
      if (T?.r !== r) return;   // the build changed while the question was open
      msg.tree = t('{0} passives added to the tree.', r.nodes.length);
      ctx.change(b => { const z = withPath(b, r, fresh); Object.assign(b, { nodes: z.nodes, set1: z.set1, set2: z.set2, attrs: z.attrs }); });
    }
    if (what === 'useSup' && U) {
      const names = U.r.combos[+btn.dataset.i]?.names, i = skills(b).indexOf(gemOf(b)); if (!names) return;
      msg.sup = t('Supports changed: {0}.', names.map(n => tn(GEM[n])).join(', '));
      ctx.change(b => { const g = skills(b)[i], m = g.meta && b.gems.find(x => x.name === g.meta);   // in a meta gem: the supports go in its sockets
        const to = m || g, held = m ? b.gems.filter(x => x.meta === m.name).length : 0;
        to.sockets = Math.max(to.sockets ?? 2, names.length + held); to.supports = [...names]; });
    }
    if (what === 'equip') {
      const sel = gearSel(b), l = G[gearKey(b, sel)]?.res.found[+btn.dataset.i], item = l?.item; if (!item) return;
      // a rare keeps its name, as one read from the game's text does
      ctx.change(b => wear(b, sel.slot, { ...structuredClone(item), ...l.name && !item.unique && { name: l.name } }, ctx.sumOf(b).keystone_giants_blood));   // the one it wore stays in the saved items
    }
  };
  render.money = () => CURRENCY.map(c => [c, moneyName(c)]);
  render.price = priceHtml;
  // from the Equipment tab: items better than the one worn in `slot`, up to that price (trade.js findBetter), in the
  // league and with the sellers picked here. -> its answer and the league, or { error } (the text to show)
  render.better = async (slot, max, currency, base, skip, tick) => {
    const b = ctx.build();
    try {
      const ls = net?.leagues?.length ? net.leagues : await leagues(), league = ls.includes(S.league) ? S.league : ls[0];
      const res = await findBetter({ league, item: b.items[slot], base, skip, price: { max: +max || 0, currency: CURRENCY.includes(currency) ? currency : '' }, level: levelFor(b),
        state: STATUS[S.state] ? S.state : 'securable', tick: (text, ...a) => tick(t(text, ...a)) });
      return { ...res, league };
    } catch (e) { if (!e.kind) throw e; return { error: errText(e) }; }
  };
  return render;
}
