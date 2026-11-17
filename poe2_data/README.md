# PoE2 data (extracted from the Steam install)

The raw dump (not in the repo, regenerate it with `_tool/extract.mjs`):
- `tables/<Language>/*.json` — every .datc64 table (1014 in English; the text ones also in the game's other nine
  languages). foreignrow columns are indexes (`_index`) into another table; see `schema.json`.
  Key ones for builds: SkillGems, SupportGems, GrantedEffects*, BaseItemTypes, Mods, Stats, PassiveSkills, Ascendancy,
  UniqueStashLayout, Words.
- `files/data/statdescriptions/*.csd` — text templates of stats/mods.
- `files/metadata/passiveskillgraph.psg` — the passive tree graph (binary).
- `files/metadata/items/**.it`, `characters/character.ot`, `monsters/monster.ot` — base item tags and the base stats
  of the character and of monsters.
- `all_files.txt` — list of the game's 4.2M files.

Update after a patch:

    cd _tool && npm i && node extract.mjs "C:/Program Files (x86)/Steam/steamapps/common/Path of Exile 2" ..
    python -I available.py && python -I uniques.py && python images.py "<game dir>" && python -I pob2.py

The extraction takes a while (ten languages).

## Only what can be obtained: `available/` (made by `python -I _tool/available.py`)
- `gems.json` — gems without [DNT]/[UNUSED]/"Coming Soon", with a `source`:
  gem_cutting | lineage_drop | passive_or_ascendancy | unique_item | item_mod | item_base | weapon_default | tradeable
  (no source in the tables but in GGG's trade list). Gems not in the current patch (no source and not in the trade
  list, or cuttable/lineage ones no longer in it) are left out: the official list `api/trade2/data/items` is
  downloaded on every run.
- `passive_tree.json` — only nodes in the real tree graph (passiveskillgraph.psg), no unused ascendancies; with
  connections (`links`) to work out paths.
- `ascendancies.json` — the 23 playable ascendancies with their class; `portrait` is the class's face in the game's
  character panel (`Characters.Portrait` → `NPCPortraits`), which `images.py` cuts from the UI atlas around the head.
- `uniques.json` — uniques registered in the Unique Stash Tab (`hidden_in_stash_tab` = suspicious) plus those GGG's
  trade list has with no place in that tab (tablets, relics, the newest ones). The name is the one the game shows
  (`Words.Text2`, also the translated column; `Text` is the internal name).
- `unique_items.json` (`uniques.py`) — the mods of each unique: the unique → mods link comes from poe2db (its list
  and, for those not in it yet, their own page); the base is the trade list's one.
- `skills.json` — per gem: cast time, constant and per-level stats (damage, cost, spirit, cooldown…), plus the
  character constants (`character.ot`, `GameConstants`) and the monster table per level.
- `monsters.json` — the enemies of the 3D scene, from `MonsterVarieties`, `MonsterTypes`, `GrantedEffects*`,
  `DefaultMonsterStats`, `MonsterPacks`, `WorldAreas` and `EndGameMaps`: 1846 monsters (364 bosses) with life,
  damage, armour and evasion multipliers, resistances, attack time, critical, areas (by name, as Path of Building 2
  does) and skills; `tables` (one row per level), `constants` (caps, critical bonus, energy shield recharge…) and
  `skills` (damage effectiveness, types, use time, cooldown and, where the tables say, projectile speed and area
  radius).
- Game texts carry keyword markup (`[Key|text shown]`): only the text shown is written.
- `item_mods.json` — item prefixes/suffixes with a spawn weight > 0.

## What the tables do not say: `python -I _tool/pob2.py` (does not need the game)
Reads from Path of Building 2 (keeps the files in `pob2_cache/` and downloads them again when older than a week):
- `pob2.json` — for each support gem, what each of its stats does to the calculation (Damage MORE, Speed INC…); it is
  PoB's reading, the supports' numbers are already in `skills.json`.
- `trade_mods.json` — for each modifier of `items.json` and `unique_items.json`, its English name and the stat number
  the official trade site searches it by (`explicit.stat_<n>`). The gear search (`trade.js`) matches by that number,
  never by the text, so it works in any language. Run it after `available.py` and `uniques.py`.

Rules of `enemies.js` (the game's formulas as Path of Building 2 implements them):
- An enemy's stats at a level = that level's row × its multipliers; part of the life is energy shield if it has any.
- Damage of an attack = base damage of the level × the monster's multiplier (× its attack time) × the skill's
  multiplier, with the part it converts to other types. A spell uses its own values, which grow with the level by the
  skill's effectiveness; damage over time comes per minute in the data.
- How often it attacks: the skill's use time if it has one; otherwise `attack_time / (1 + speed/100)` for attacks or
  the cast time for spells; never less than its cooldown.
- Against you: evasion against its accuracy, block (melee and projectiles only, not areas), armour and resistances
  with their caps. Against it: your accuracy against its evasion, its armour and its resistances.

What the data does not have is filled in by the scene and marked as simulated: the radius of most areas (only 92
monster skills have it), the speed of projectiles with no row in `MonsterProjectileSpell/Attack`, the reach of ranged
attacks and the look of each attack. A damage number with "~" includes a simulated value (e.g. an attack with no
weapon equipped takes 1/8 of the enemy's life per hit).
