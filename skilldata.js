// skills.json, shared by every module, completed with what it lacks until the data is regenerated on Windows:
// the stats of each gem per level, the cast times and the character constants. Those come from pob2.json
// (poe2_data/_tool/pob2.py, Path of Building 2's export of the same game tables); whatever skills.json has wins.
const load = f => fetch('poe2_data/available/' + f).then(r => r.json());
const [SK, POB] = await Promise.all([load('skills.json'), load('pob2.json').catch(() => ({}))]);
SK.character_stats ||= POB.character_stats;
SK.attribute_text ||= POB.attribute_text;
for (const [name, d] of Object.entries(POB.skills || {})) {
  const s = SK.skills[name];
  if (s && !s.levels) SK.skills[name] = { ...d, ...s };
}
export { SK };
