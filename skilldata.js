// skills.json (the game's own tables: poe2_data/_tool/available.py), shared by every module, plus what the tables do not
// say: what each support's stats do to the calculation and which quest rewards the campaign gives, from pob2.json
// (poe2_data/_tool/pob2.py, Path of Building 2).
const load = f => fetch('poe2_data/available/' + f).then(r => r.json());
const [SK, POB] = await Promise.all([load('skills.json'), load('pob2.json').catch(() => ({}))]);
SK.supports = POB.supports || {};   // name -> { text, stats, mods }: calc.js withSupports()
SK.quests = POB.quests || [];       // { key, act, area, info, level, options, pick }: calc.js QUESTS
SK.quest_points = POB.quest_points || [];   // { act, level, points }: the quests' passive points, calc.js requiredLevel
SK.minions = POB.minions || {};     // minion gem -> the monsters (monsters.json ids) it raises: calc.js minionOf()
// a stat set the game's tables leave out (Midnight Zenith's Crystal) becomes a part of its skill, as the dump's parts are:
// its "secondary" base damage is the part's own, its critChance the part's critical hit chance
const own = st => Object.fromEntries(Object.entries(st).map(([k, x]) => k === 'critChance' ? ['base_critical_strike_chance', x * 100] : [k.replace(/^secondary_(minimum|maximum)_base/, '$1_base'), x]));
for (const [name, sets] of Object.entries(POB.stat_sets || {})) for (const [part, P] of Object.entries(sets)) {
  const S = SK.skills[name]; if (S) (S.parts ||= {})[part] = { constant: P.constant, levels: Object.fromEntries(Object.entries(P.levels).map(([n, st]) => [n, own(st)])) };
}
export { SK };
