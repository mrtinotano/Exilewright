// Skills tab laid out like the in-game skill panel: icon, level, name and support sockets per skill.
// Everything from gems.json / skills.json (game tables): support compatibility (skill types, RPN with OR/AND/NOT),
// support families, max sockets (Jeweller's Orb actions) and support gem capacity (ClientStrings: 5 attribute = 1).
const load = f => fetch('poe2_data/available/' + f).then(r => r.json());
const [GEMS, SK, ASCS] = await Promise.all([load('gems.json'), load('skills.json'), load('ascendancies.json')]);
const GEM = Object.fromEntries(GEMS.map(g => [g.name, g]));
const SUPPORTS = GEMS.filter(g => g.kind === 'support');
const img = p => p ? 'poe2_data/available/img/' + p.toLowerCase().replace(/\.dds$/, '.webp') : '';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const ATTRS = { str: ['Fue', 'strength', '#c44'], dex: ['Des', 'dexterity', '#4a4'], int: ['Int', 'intelligence', '#48c'] };
// a support uses capacity of its main attribute (the requirement % the game gives it)
const colour = g => { const a = Object.entries(g.attr).sort((x, y) => y[1] - x[1])[0]; return a[1] ? a[0] : null; };

// same evaluation as the game's support type expressions (RPN): any true value left on the stack = match
function matches(expr, types) {
  const st = [];
  for (const t of expr) {
    if (t === 'OR') { const o = st.pop(); st[st.length - 1] = st.at(-1) || o; }
    else if (t === 'AND') { const o = st.pop(); st[st.length - 1] = st.at(-1) && o; }
    else if (t === 'NOT') st[st.length - 1] = !st.at(-1);
    else st.push(types.has(t));
  }
  return st.some(Boolean);
}
const canSupport = (s, types) => !(s.exclude.length && matches(s.exclude, types)) && (!s.require.length || matches(s.require, types));

// attribute total: class base + flat stats from tree/gear, then % increased
export function attributes(sum, ascName) {
  const base = ASCS.find(a => a.name === ascName)?.attrs || { str: 0, dex: 0, int: 0 }, out = {};
  const pair = { str: ['strength_and_dexterity', 'strength_and_intelligence'], dex: ['strength_and_dexterity', 'dexterity_and_intelligence'], int: ['strength_and_intelligence', 'dexterity_and_intelligence'] };
  for (const [k, [, id]] of Object.entries(ATTRS)) {
    const flat = base[k] + (sum['base_' + id] || 0) + (sum['additional_' + id] || 0) + (sum.additional_all_attributes || 0) + pair[k].reduce((t, p) => t + (sum['additional_' + p] || 0), 0);
    out[k] = Math.floor(flat * (1 + (sum[id + '_+%'] || 0) / 100));
  }
  return out;
}

export function initSkills(el, getBuild, changed, getSum) {
  let open = null;  // [gem index, socket index] being edited
  function render() {
    const b = getBuild(), attrs = attributes(getSum(), b.asc), used = { str: 0, dex: 0, int: 0 };
    const rows = b.gems.map((g, gi) => {
      const G = GEM[g.name];
      if (!G || G.kind === 'support') return '';
      g.sockets ??= 2; g.supports ??= [];
      g.supports = g.supports.slice(0, g.sockets);
      const sups = g.supports.map(n => n && GEM[n]);
      sups.forEach(s => s && colour(s) && used[colour(s)]++);
      const types = new Set([...(G.types || []), ...sups.flatMap(s => s?.adds || [])]);
      const sockets = G.cannot_be_supported ? '<small class="note">No admite soportes</small>' : Array.from({ length: g.sockets }, (_, si) => {
        const s = sups[si];
        return `<button class="sock${open?.[0] === gi && open[1] === si ? ' on' : ''}" data-gi="${gi}" data-si="${si}" title="${s ? esc(s.name_es || s.name) : 'Hueco de soporte vacío'}" ${s && colour(s) ? `style="border-color:${ATTRS[colour(s)][2]}"` : ''}>${s ? `<img src="${img(s.icon)}" alt="">` : ''}</button>`;
      }).join('');
      let picker = '';
      if (open?.[0] === gi) {
        const fams = new Set(sups.flatMap((s, i) => s && i !== open[1] ? s.family : []));
        const opts = SUPPORTS.filter(s => canSupport(s, types) && !s.family.some(f => fams.has(f)))
          .sort((x, y) => (x.name_es || x.name).localeCompare(y.name_es || y.name));
        picker = `<select class="pick" data-gi="${gi}" data-si="${open[1]}"><option value="">— vacío —</option>${opts.map(s =>
          `<option value="${esc(s.name)}" ${s.name === g.supports[open[1]] ? 'selected' : ''}>${esc(s.name_es || s.name)}${colour(s) ? ' · ' + ATTRS[colour(s)][0] : ''}</option>`).join('')}</select>
          <small class="note">${opts.length} soportes compatibles con los tipos de esta habilidad</small>`;
      }
      return `<div class="skill"><img class="sicon" src="${img(G.icon)}" alt="">
        <div class="sbody"><div class="shead">NV: <input type="number" min="1" max="40" value="${g.level}" data-gi="${gi}" data-k="level"> <b>${esc(G.name_es || G.name)}</b>
          <span class="sockn">huecos <select data-gi="${gi}" data-k="sockets">${Array.from({ length: SK.max_support_sockets }, (_, i) => i + 1).map(n => `<option ${n === g.sockets ? 'selected' : ''}>${n}</option>`).join('')}</select></span></div>
        <div class="socks"><span class="sock main" title="${G.socket_icon?.endsWith('Icon.dds') ? 'Habilidad otorgada por ' + (G.source === 'passive_or_ascendancy' ? 'ascendencia o pasiva' : 'objeto o arma') : esc(G.name_es || G.name)}"><img src="${img(G.socket_icon)}" alt=""></span>${sockets}</div>${picker}</div></div>`;
    }).join('');
    const per = SK.support_capacity_per_attribute;
    el.innerHTML = `<div class="skills">${rows || '<p class="note">Añade gemas desde la barra lateral.</p>'}
      <div class="cap">Capacidad de gemas de soporte: ${Object.entries(ATTRS).map(([k, [t, , c]]) =>
        `<span style="color:${used[k] > Math.floor(attrs[k] / per) ? '#f55' : c}">${t} (${used[k]}/${Math.floor(attrs[k] / per)})</span>`).join(', ')}
      <br><small class="note">${per} de atributo = 1 de capacidad. Atributos: Fue ${attrs.str}, Des ${attrs.dex}, Int ${attrs.int}. Huecos: los que tenga tu gema (orbes de joyero, máx ${SK.max_support_sockets}).</small></div></div>`;
  }
  el.addEventListener('click', e => {
    const t = e.target.closest('.sock:not(.main)'); if (!t) return;
    open = open?.[0] === +t.dataset.gi && open[1] === +t.dataset.si ? null : [+t.dataset.gi, +t.dataset.si];
    render();
  });
  el.addEventListener('change', e => {
    const t = e.target, g = getBuild().gems[t.dataset.gi]; if (!g) return;
    if (t.classList.contains('pick')) { g.supports[t.dataset.si] = t.value || null; open = null; }
    else g[t.dataset.k] = +t.value;
    changed(); render();
  });
  return render;
}
