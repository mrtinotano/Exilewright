// skills.json (the game's own tables: poe2_data/_tool/available.py), shared by every module, plus what the tables do not
// say: what each support's stats do to the calculation, from pob2.json (poe2_data/_tool/pob2.py, Path of Building 2).
const load = f => fetch('poe2_data/available/' + f).then(r => r.json());
const [SK, POB] = await Promise.all([load('skills.json'), load('pob2.json').catch(() => ({}))]);
SK.supports = POB.supports || {};   // name -> { text, stats, mods }: calc.js withSupports()
export { SK };
