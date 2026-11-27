// Skills tab laid out like the in-game skill panel: icon, level, name and support sockets per skill.
// Everything from gems.json / skills.json (game tables): support compatibility (skill types, RPN with OR/AND/NOT),
// support families, max sockets (Jeweller's Orb actions) and support gem capacity (ClientStrings: 5 attribute = 1).
import { t, esc, tn, fmt, lang, kwPlain, kwHtml } from './i18n.js';
import { attributes, skill, reservation, totem, usedBy, metasFor, linkMetas, condKey, GEM, gemName, subsOf, subDamage, typeSets, fitsGem } from './calc.js';
import { BINDABLE, enemy } from './enemies.js';
// a bindable monster as the picker lists it: varieties of one name (their skills differ) by the tail of their game id
const spLabel = m => m ? m.variant ? `${m.name} (${m.variant})` : m.name : '';
export { GEM };
import { shownLines } from './stats.js';
import { dpsDiff, impactLine } from './impact.js';
import { SK } from './skilldata.js';
import { grantedSkills, wornItems, SLOTS } from './items.js';
const load = f => fetch('poe2_data/available/' + f).then(r => r.json());
const GEMS = await load('gems.json');
export const SUPPORTS = GEMS.filter(g => g.kind === 'support');
const img = p => p ? 'poe2_data/available/img/' + p.toLowerCase().replace(/\.dds$/, '.webp') : '';
const ATTRS = { str: [t('Str'), 'strength', '#c44'], dex: [t('Dex'), 'dexterity', '#4a4'], int: [t('Int'), 'intelligence', '#48c'] };
// a support uses capacity of its main attribute (the requirement % the game gives it)
export const colour = g => { const a = Object.entries(g.attr).sort((x, y) => y[1] - x[1])[0]; return a[1] ? a[0] : null; };

const num = (x, d = 0) => x == null ? '—' : fmt(x, d);
// stat lines of a gem at a level (constants + that level), hidden helper keys (_cost, _spirit…) left out
function gemLines(name, level) {
  const d = SK.skills[name]; if (!d) return [];
  return shownLines({ ...(d.constant || {}), ...(d.levels?.[level] || d.levels?.[Object.keys(d.levels || {})[0]] || {}) }, name);
}
const descOf = G => G['description_' + lang] || G.description || '';
// what a support does in words: the game's description, else Path of Building's reading of its stats (English)
export const supportText = S => kwPlain(descOf(S)) || SK.supports?.[S.name]?.text || '';
const DTYPE = { physical: 'Physical Damage', fire: 'Fire Damage', cold: 'Cold Damage', lightning: 'Lightning Damage', chaos: 'Chaos Damage' };

// the conditions of the skill's bonuses (calc.js out.when) the player can say hold, one row each with the lines that need
// it: a tick, or a count for a "per" one (empty: not counted). b.conds keeps them for every skill of the build
function condRows(s, b, sum) {
  const by = new Map();
  for (const w of s.when || []) {
    if (!w.cond.every(c => /^(?:Actor)?Condition$|^Multiplier/.test(c.type))) continue;   // a buff's, a distance's: calc.js never counts them
    let lines = w.gem && GEM[w.gem] ? [`${tn(GEM[w.gem])}: ${supportText(GEM[w.gem])}`] : w.stat ? shownLines({ [w.stat]: w.val }, w.skill) : [];   // a support's: its description (its stats have no text); a skill's own stat: its .csd text (w.skill)
    if (!lines.length && w.stat) lines = shownLines(Object.fromEntries(Object.entries(sum).filter(([k]) => k.endsWith(w.stat))));   // inc()'s families: the build's own stats of it
    for (const c of w.cond) { const k = condKey(c); if (!by.has(k)) by.set(k, new Set()); lines.forEach(l => by.get(k).add(l)); }
  }
  return [...by].map(([k, L]) => { const x = b.conds?.[k];
    const box = k[0] === '#' ? `type="number" min="0" step="1" value="${x ?? ''}" placeholder="—"` : `type="checkbox"${x ? ' checked' : ''}`;
    return `<label class="cond"><input ${box} data-cond="${esc(k)}"><span>${L.size ? [...L].map(esc).join('<br>') : (k.startsWith('enemy:') ? t('Enemies') + ': ' : '') + esc(k.replace(/^enemy:|^#/, '').replace(/([a-z])([A-Z0-9])/g, '$1 $2'))}</span></label>`; }).join('');
}

// a tab of the game's skill window: its label (available.py), else the skill's name
export const tabName = (x, G) => x?.['label_' + lang] || x?.label || tn(G);
// side panel (left, in place of the character sheet): every number of the selected skill, grouped like the game's skill
// details window, with a tab for each skill it sets off that deals damage (view: its key; Ancestral Cry's Volcanic Steps)
function details(g, b, sum, geo, view) {
  const G = GEM[g.name] || {}, main = skill(g, b, sum), subs = subsOf(g, main, true), sub = subs.find(x => x.key === view), s = sub?.s || main, st = s.stats, P = sub && SK.skills[g.name]?.parts?.[sub.key], geom = sub && !P ? {} : geo?.(P ? { ...g, part: sub.key } : g) || {};   // a part's own radius; the gem's hit (Volcanic Steps) has none in the data
  const desc = sub ? sub.tab?.['description_' + lang] || sub.tab?.description || '' : descOf(G);
  const tabs = subs.length ? `<div class="dtabs">${[{ key: '', tab: SK.skills[g.name]?.tab }, ...subs].map(x => `<button data-dtab="${esc(x.key)}"${(sub?.key || '') === x.key ? ' class="on"' : ''}>${esc(tabName(x.tab, G))}</button>`).join('')}</div>` : '';
  const sec = (title, rows) => (rows = rows.filter(Boolean)).length
    ? `<h4>${t(title)}</h4>${rows.map(([k, v]) => `<div class="kv"${k === 'Damage per Second' ? ' data-why="dps"' : ''}><span>${t(k)}</span><b>${v}</b></div>`).join('')}` : '';
  const hits = Object.entries(s.hits), lo = hits.reduce((a, [, h]) => a + h[0], 0), hi = hits.reduce((a, [, h]) => a + h[1], 0);
  const cost = st._cost && Object.entries(st._cost).map(([k, v]) => t(/life/i.test(k) ? '{0} life' : /es|energy/i.test(k) ? '{0} energy shield' : '{0} mana', v)).join(', ');
  const sups = (g.supports || []).filter(n => GEM[n]);
  const lines = P ? shownLines({ ...P.constant, ...P.levels?.[st._level] }, sub.key) : shownLines({ ...st, ...st._mods, ...Object.fromEntries(Object.entries({ ...SK.skills[g.name]?.part, ...SK.skills[g.name]?.part_levels?.[st._level] }).filter(([k]) => st[k] ?? st._mods?.[k]).map(([k, v]) => [k, v + (st[k] ?? st._mods[k])])) }, g.name), spirit = reservation(g, sum, b), T = totem(g, sum);   // at the level and quality the character uses it with (calc.js gemStats); the part's stats with what quality adds to them (Vaulting Impact's Broken Stance hits: 10 + 2)
  return `<div class="dhead"><img src="${img(G.icon)}" alt=""><div><b>${esc(gemName(g))}</b><small>${t('Level')} ${st._level}${st._quality ? ` · ${t('Quality')} ${st._quality}%` : ''}</small></div></div>
    ${tabs}${desc ? `<p class="ddesc">${kwHtml(desc)}</p>` : ''}
    ${sec('Damage', [
      s.perHit != null && ['Average Damage per Hit', fmt(s.perHit, 1)],
      !s.triggered && ['Damage per Second', s.dps != null ? fmt(s.dps, 1) : '—'],
      ['Total Combined Damage', hits.length ? `${fmt(lo)} – ${fmt(hi)}` : '—'],
      ...hits.map(([k, [a, z]]) => [DTYPE[k], `${fmt(a)} – ${fmt(z)}`]),
      s.totems > 0 && ['Active totems', s.totems],
      s.rage > 0 && ['Rage (more attack damage)', s.rage],
      s.rage > 0 && s.rageEffect > 0 && ['Increased Rage effect (Berserk)', s.rageEffect + '%'],
    ])}
    ${sub && s.triggered ? sec('Speed', [s.cooldown && ['Cooldown time', fmt(s.cooldown / 1000, 2) + ' s']]) : sec('Speed', [
      !s.attack && ['Cast time', s.castTime ? fmt(s.castTime / 1000, 2) + ' s' : '—'],
      s.attack && s.useTime && ['Attack time', fmt(s.useTime, 2) + ' s'],
      [s.attack ? 'Attacks per second' : 'Uses per second', s.speed ? fmt(s.speed, 2) : '—'],
      s.cooldown && ['Cooldown time', fmt(s.cooldown / 1000, 2) + ' s'],
      s.uses > 1 && ['Cooldown uses', s.uses],
    ])}
    ${sec('Critical Hits', [
      ['Critical hit chance', s.crit != null ? fmt(s.crit, 2) + '%' : '—'],
      ['Critical Damage Bonus', s.critBonus != null ? '+' + fmt(s.critBonus) + '%' : '—'],
    ])}
    ${sec('Accuracy', s.hitAt ? [['Main Hand Accuracy Rating', fmt(s.accuracy)], ...s.hitAt.map(([m, h]) => [t('Estimated main hand Chance to Hit at {0}m', m), h + '%'])] : [])}
    ${sec('Ailments', [
      s.ignite && ['Ignite damage per second', `${fmt(s.ignite.perSecond[0], 1)} – ${fmt(s.ignite.perSecond[1], 1)}`],
      s.ignite && ['Ignite duration', fmt(s.ignite.duration, 1) + ' s'],
    ])}
    ${(c => c ? `<h4>${t('Conditions')}</h4><p class="note">${t('Tick what holds while you fight: its bonuses count in the damage of every skill. The simulator checks them on its own.')}</p><div class="conds">${c}</div>` : '')(condRows(s, b, sum))}
    ${sub ? '' : sec('Cost & Reservation', [cost && ['Cost', cost], spirit && ['Reservation', t('{0} spirit', spirit)]])}${sec('Area & Duration', [
      geom.radiusFromData && ['Radius', fmt(geom.radius, 1) + ' m'],
      !sub && (d => d && ['Duration', fmt(d, 2) + ' s'])(s.shape?.duration || SK.skills[g.name]?.duration_ms / 1000),   // with its modifiers and the charges it consumes (Conditions)
      !sub && geom.speed && ['Projectile speed', fmt(geom.speed, 1) + ' m/s'],
    ])}
    ${T ? sec('Totem', [
      ['Totem level', T.level], T.limit && ['Totem limit', T.limit], T.duration && ['Totem duration', fmt(T.duration, 1) + ' s'],
      ['Maximum Life', fmt(T.life)], ['Armour', fmt(T.armour)], ['Evasion Rating', fmt(T.evasion)], ['Ailment Threshold', fmt(T.ailment)],
      ['Elemental Resistances', T.res.fire + '%'], ['Chaos Resistance', T.res.chaos + '%'],
    ]) : ''}
    ${s.reason ? `<p class="note">${esc(t(s.reason))}</p>` : ''}
    <h4>${t('Skill Stats')}</h4>${lines.length ? `<div class="dlines">${lines.map(esc).join('<br>')}</div>` : `<p class="note">—</p>`}
    <h4>${t('Supports')}</h4>${sups.length ? sups.map(n => {
      const S = GEM[n], sl = gemLines(n, 1);
      return `<div class="dsup"><img src="${img(S.icon)}" alt=""><div><b>${esc(tn(S))} <button class="sockx" data-unsup="${b.gems.indexOf(g)}:${g.supports.indexOf(n)}" title="${t('Remove support')}">✕</button></b>${descOf(S) ? `<small>${kwHtml(descOf(S))}</small>` : ''}${sl.length ? `<div class="dlines">${sl.map(esc).join('<br>')}</div>` : ''}</div></div>`;
    }).join('') : `<p class="note">${t('No supports socketed')}</p>`}`;
}

export function initSkills(el, side, getBuild, changed, getSum, addGem, geo, getVs = () => null) {   // getVs: the build the character panel compares with, { b, sum }
  let open = null;  // [gem index, socket index] being edited
  let sel = 0;      // skill shown in the details panel
  let tab = '';     // and which of its tabs (details view)
  function render() {
    const b = getBuild(), sum = getSum(), attrs = attributes(sum, b.asc), used = { str: 0, dex: 0, int: 0 };
    linkMetas(b);
    const cards = b.gems.map((g, gi) => {
      const G = GEM[g.name];
      if (!G || G.kind === 'support') return '';
      g.sockets ??= 2; g.supports ??= [];
      const holder = usedBy(b, gi), metas = metasFor(b, g), held = b.gems.filter((x, i) => usedBy(b, i) === g);
      const room = held.length ? Math.max(0, g.sockets - held.length) : g.sockets;   // a meta gem's sockets also hold its skills
      g.supports = g.supports.slice(0, room);
      const sups = g.supports.map(n => n && GEM[n]);
      if (!holder) sups.forEach(s => s && colour(s) && used[colour(s)]++);
      const own = held[0] || g;   // a meta gem's supports are for the skill in it: its types say which fit
      const types = typeSets(own.name, [...(held[0] ? GEM[g.name].holds?.adds || [] : []), ...sups.flatMap(s => s?.adds || [])]);   // its skills', and the types the meta gem gives it
      // a skill put in a meta gem (Mortar Cannon's Cluster Grenade): the meta gem's sockets and supports are its own
      // Bind Spectre: the monster whose spirit it holds (the game's: bound from a corpse, the gem then "Spectre: <monster>")
      const spec = g.name === 'Bind Spectre' || g.spectre ? `<label class="smeta">${t('Its monster')} <input list="spectreNames" data-gi="${gi}" data-k="spectre" value="${esc(spLabel(enemy(g.spectre)))}" placeholder="${t('Search enemy…')}"></label>` : '';
      const inMeta = metas.length ? `<label class="smeta">${t('Socketed in')} <select data-gi="${gi}" data-k="meta"><option value="">${t('None')}</option>${metas.map(m => `<option value="${esc(m.name)}"${holder === m ? ' selected' : ''}>${esc(tn(GEM[m.name]))}</option>`).join('')}</select></label>` : '';
      const heldHtml = held.map(x => `<span class="sockw"><button class="sock held" data-pick="${b.gems.indexOf(x)}" title="${esc(tn(GEM[x.name]))}"><img src="${img(GEM[x.name].icon)}" alt=""></button></span>`).join('');
      const sockets = holder ? `<small class="note">${t('Uses the supports of {0}', esc(tn(GEM[holder.name])))}</small>` : G.cannot_be_supported ? `<small class="note">${t('Cannot be supported')}</small>` : heldHtml + Array.from({ length: room }, (_, si) => {
        const s = sups[si];
        return `<span class="sockw"><button class="sock${open?.[0] === gi && open[1] === si ? ' on' : ''}" data-gi="${gi}" data-si="${si}" title="${s ? esc(tn(s)) + ' — ' + t('right click to remove') : t('Empty support socket')}" ${s && colour(s) ? `style="border-color:${ATTRS[colour(s)][2]}"` : ''}>${s ? `<img src="${img(s.icon)}" alt="">` : ''}</button>${s ? `<button class="sockx" data-unsup="${gi}:${si}" title="${t('Remove support')}">✕</button>` : ''}</span>`;
      }).join('');
      const d = skill(g, b, sum), sd = d.dps == null && subDamage(d), vs = getVs(), vg = vs && d.dps != null && vs.b.gems.find(x => x.name === g.name), vd = vg && skill(vg, vs.b, vs.sum).dps, dd = vd != null && Math.round(d.dps - vd);   // the same skill in the compared build
      let picker = '';
      if (open?.[0] === gi) {   // only supports this skill can take, with icon, what they do and what they would do to its DPS
        const gain = name => { const supports = [...g.supports]; supports[open[1]] = name; return impactLine(dpsDiff(skill(own, b, sum).dps, skill({ ...own, supports }, b, sum).dps)); };
        const fams = new Set(sups.flatMap((s, i) => s && i !== open[1] ? s.family : []));
        const opts = SUPPORTS.filter(s => fitsGem(s, types) && !s.family.some(f => fams.has(f)))
          .sort((x, y) => tn(x).localeCompare(tn(y)));
        const item = s => {
          const c = colour(s), what = supportText(s) || gemLines(s.name, 1).join(' · ');
          return `<button class="supopt${s.name === g.supports[open[1]] ? ' on' : ''}" data-sup="${esc(s.name)}" data-find="${esc((tn(s) + ' ' + s.name + ' ' + what).toLowerCase())}">
            <img src="${img(s.icon)}" alt=""><span><b style="color:${c ? ATTRS[c][2] : '#ccc'}">${esc(tn(s))}</b><small>${what ? esc(what) : `<i class="disc">${t('No description in the game data yet')}</i>`}</small>${gain(s.name)}</span></button>`;
        };
        picker = `<div class="suppick"><div class="suphead"><input class="supfind" type="search" placeholder="${t('Filter supports…')}" autocomplete="off">
          <small class="note">${t('{0} supports compatible with this skill\'s types', opts.length)}</small></div>
          <div class="suplist">${g.supports[open[1]] ? `<button class="supopt" data-sup=""><span><b>${t('— empty —')}</b><small>${t('Remove support')}</small>${gain(null)}</span></button>` : ''}${opts.map(item).join('')}</div></div>`;
      }
      return `<div class="skill${gi === sel ? ' sel' : ''}${holder ? ' inmeta' : ''}" data-sel="${gi}"><img class="sicon" src="${img(G.icon)}" alt="">
        <div class="sbody"><div class="shead">${t('LV')}: <input type="number" min="1" max="40" value="${g.level}" data-gi="${gi}" data-k="level">${d.stats?._level > g.level ? ` <b class="slv" title="${t('With the levels your passives and gear add')}">${d.stats._level}</b>` : ''} <span title="${t('Quality')}">Q:</span> <input type="number" min="0" max="40" value="${g.quality || 0}" data-gi="${gi}" data-k="quality" title="${t('Quality')}"> <label class="scor"><input type="checkbox"${g.corrupted ? ' checked' : ''} data-gi="${gi}" data-k="corrupted">${t('Corrupted')}</label> <b>${esc(gemName(g))}</b>
          ${spec}${inMeta}<span class="sockn"${holder ? ' hidden' : ''}>${t('sockets')} <select data-gi="${gi}" data-k="sockets">${Array.from({ length: SK.max_support_sockets }, (_, i) => i + 1).map(n => `<option ${n === g.sockets ? 'selected' : ''}>${n}</option>`).join('')}</select></span>
          ${GEM[g.name]?.types?.includes('Persistent') ? `<label class="scor"><input type="checkbox"${g.enabled !== false ? ' checked' : ''} data-gi="${gi}" data-k="enabled">${t('Enabled')}</label>` : ''}
          <label class="smeta"${holder ? ' hidden' : ''}>${t('Used with weapon set:')} <select data-gi="${gi}" data-k="wset">${[['', 'I + II'], [1, 'I'], [2, 'II']].map(([v, l]) => `<option value="${v}"${(g.wset || '') == v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
          <b class="sdps" title="${esc(t(sd ? 'Damage of the skills it sets off' : d.reason || 'DPS with your tree and gear'))}">${d.dps != null ? fmt(Math.round(d.dps)) + ' <small>DPS</small>' + (dd ? `<i class="vs ${dd > 0 ? 'up' : 'dn'}" title="${esc(t('Compared with {0}', vs.b.name))}">${dd > 0 ? '+' : ''}${fmt(dd)}</i>` : '') : sd ? `${fmt(Math.round(sd.v))} <small>${sd.perHit ? t('per hit') : 'DPS'}</small>` : /weapon/.test(d.reason) ? `<small class="swhy">${esc(t(d.reason))}</small>` : '— <small>DPS</small>'}</b><button class="sdel" data-del="${gi}" title="${t('Remove skill')}">✕</button></div>
        <div class="socks">${sockets}</div>${picker}</div></div>`;
    });
    // a skill in a meta gem (Mortar Cannon's Cluster Grenade) right under it, the two in one frame and joined by a line
    const by = b.gems.map((g, i) => usedBy(b, i));
    const rows = b.gems.map((g, i) => { const inner = b.gems.map((x, j) => by[j] === g ? cards[j] : '').join(''); return by[i] ? '' : inner ? `<div class="mgroup">${cards[i]}${inner}</div>` : cards[i]; }).join('');
    const per = SK.support_capacity_per_attribute;
    // what the gear gives that the build does not have yet (the build's own gems are what is worked out)
    const give = grantedSkills(wornItems(b, getSum())).filter(([n]) => GEM[n] && !b.gems.some(g => g.name === n)).map(([n, slot, level]) =>
      `<p class="note">${t('Your {0} grants {1}: it is not in the build.', t(SLOTS[slot] || 'Jewel'), esc(tn(GEM[n])))} <button data-grant="${esc(n)}" data-level="${level || ''}">${t('Add')}</button></p>`).join('');
    const cur = b.gems[sel] && GEM[b.gems[sel].name]?.kind !== 'support' ? b.gems[sel] : null;
    side.innerHTML = cur ? details(cur, b, sum, geo, tab) : `<p class="note">${t('Select a skill to see all its stats.')}</p>`;
    el.innerHTML = `<div class="skills"><div class="skadd"><input list="gemNames" placeholder="${t('Add skill…')}" id="gemSearch"><datalist id="spectreNames">${[...new Set(BINDABLE.map(spLabel))].map(n => `<option value="${esc(n)}">`).join('')}</datalist><datalist id="gemNames">${GEMS.filter(g => g.kind !== 'support')
      .map(g => `<option value="${esc(tn(g))}">`).join('')}</datalist></div>${give}${rows || `<p class="note">${t('No skills yet: type a gem name above.')}</p>`}
      <div class="cap">${t('Support gem capacity')}: ${Object.entries(ATTRS).map(([k, [a, , c]]) =>
        `<span style="color:${used[k] > Math.floor(attrs[k] / per) ? '#f55' : c}">${a} (${used[k]}/${Math.floor(attrs[k] / per)})</span>`).join(', ')}
      <br><small class="note">${t('{0} attribute = 1 capacity. Attributes: Str {1}, Dex {2}, Int {3}. Sockets: whatever your gem has (Jeweller\'s Orbs, max {4}).', per, attrs.str, attrs.dex, attrs.int, SK.max_support_sockets)}</small></div></div>`;
  }
  // remove a support: ✕ on the socket or in the details panel, or right click on the socket
  const unsup = (gi, si) => { const b = getBuild(), g = usedBy(b, gi) || b.gems[gi]; if (!g?.supports?.[si]) return false; g.supports[si] = null; open = null; changed(); render(); return true; };
  side.addEventListener('click', e => { const x = e.target.closest('[data-unsup]'); if (x) unsup(...x.dataset.unsup.split(':').map(Number));
    const T = e.target.closest('[data-dtab]'); if (T) { tab = T.dataset.dtab; render(); } });
  side.addEventListener('change', e => {   // a condition ticked or counted in the details panel
    const x = e.target.closest('[data-cond]'); if (!x) return;
    const C = getBuild().conds ||= {}, k = x.dataset.cond, val = x.type === 'checkbox' ? x.checked ? 1 : null : x.value === '' ? null : Math.max(0, Math.floor(+x.value) || 0);
    if (val == null) delete C[k]; else C[k] = val;
    changed(); render();
  });
  el.addEventListener('contextmenu', e => { const s = e.target.closest('.sock'); if (s && unsup(+s.dataset.gi, +s.dataset.si)) e.preventDefault(); });
  el.addEventListener('click', e => {
    const x = e.target.closest('[data-unsup]');
    if (x) { unsup(...x.dataset.unsup.split(':').map(Number)); return; }
    const grant = e.target.closest('[data-grant]');
    if (grant) { addGem(grant.dataset.grant, +grant.dataset.level || undefined); render(); return; }
    const del = e.target.closest('[data-del]');
    if (del) { getBuild().gems.splice(del.dataset.del, 1); open = null; if (sel >= +del.dataset.del) sel = Math.max(0, sel - 1); changed(); render(); return; }
    const opt = e.target.closest('[data-sup]');
    if (opt) { const g = getBuild().gems[open[0]]; g.supports[open[1]] = opt.dataset.sup || null; open = null; changed(); render(); return; }
    const pk = e.target.closest('[data-pick]');   // a skill in a meta gem's socket: show that skill
    if (pk) { sel = +pk.dataset.pick; open = null; render(); return; }
    const t = e.target.closest('.sock');
    if (!t) {   // anywhere else on a skill row (not its inputs) shows it in the details panel
      const row = e.target.closest('[data-sel]');
      if (row && !e.target.closest('input, select, .suppick') && +row.dataset.sel !== sel) { sel = +row.dataset.sel; tab = ''; render(); }
      return;
    }
    sel = +t.dataset.gi;
    open = open?.[0] === +t.dataset.gi && open[1] === +t.dataset.si ? null : [+t.dataset.gi, +t.dataset.si];
    render();
  });
  el.addEventListener('change', e => {
    if (e.target.id === 'gemSearch') { if (addGem(e.target.value)) el.querySelector('#gemSearch')?.focus(); return; }
    const t = e.target, g = getBuild().gems[t.dataset.gi]; if (!g) return;
    if (!t.dataset.k) return;
    if (t.dataset.k === 'spectre') {   // its monster: the gem is its Spectre; none: Bind Spectre again
      const m = BINDABLE.find(x => spLabel(x) === t.value.trim());
      if (m) Object.assign(g, { name: 'Spectre: {0}', spectre: m.id }); else if (!t.value.trim()) { g.name = 'Bind Spectre'; delete g.spectre; } else return;
    } else if (t.dataset.k === 'meta') {   // in a meta gem: one of its sockets; out of it: its own sockets, empty
      const m = getBuild().gems.find(x => x.name === t.value);
      if (m) m.sockets = Math.min(SK.max_support_sockets, Math.max(m.sockets ?? 2, (m.supports || []).filter(Boolean).length + 1 + getBuild().gems.filter(x => x !== g && x.meta === m.name).length));
      else { g.supports = []; g.sockets = 2; }
      g.meta = t.value;
    } else g[t.dataset.k] = t.type === 'checkbox' ? t.checked : t.max ? Math.max(+t.min, Math.min(+t.max, +t.value || 0)) : +t.value;
    changed(); render();
  });
  el.addEventListener('input', e => {   // filter the support list in place (keeps the focus in the box)
    if (!e.target.classList.contains('supfind')) return;
    const q = e.target.value.trim().toLowerCase();
    for (const o of el.querySelectorAll('.suplist [data-find]')) o.hidden = q && !o.dataset.find.includes(q);
  });
  return render;
}
