# POE 2 Builder

Personal Path of Exile 2 build planner: passive tree, equipment, skills/supports and a 3D scene.
Every number comes from the game's own data (see `poe2_data/README.md`).

## Run
Double-click `start.cmd` (or `python serve.py`) and open http://127.0.0.1:8765

**Share** (top bar) exports/imports Path of Building 2 codes and links (pobb.in, poe.ninja, Maxroll, poe2db;
pastebin and rentry to import) through `serve.py`, plus JSON files. Items copied in the game with Ctrl+C can
be pasted in Equipment. **.build file for the game** saves the build for the in-game build planner (0.5+, folder
`Documents/My Games/Path of Exile 2/BuildPlanner`): tree, ascendancy and gems with supports; gem levels and gear
travel as notes, since the format has no fields for them (layout as Path of Building 2 writes it).

**Optimizer** (its own tab) works for the build on screen and one objective: damage per second or uses per second
of a skill, toughness, life, energy shield, armour, evasion, resistances…
- *Passive tree*: spends the points on the passives that raise the objective the most, from the current tree or from
  the class start. A step-by-step search (`optimize.js`): good paths, not a proven best one, and only what `calc.js`
  calculates counts (keystones and conditional effects do not).
- *Support gems*: tries every support the skill can take, alone and together, within the game's rules (skill types,
  one support of each family, support capacity from attributes).
- *Gear on the trade site*: works out what each modifier of a slot is worth to the objective, searches the official
  trade site through `serve.py` (`/trade/*`, so the app has to be opened from `serve.py`), puts each listed item on
  the build and ranks them by what they change. Without a login the site only takes simple searches, so the app asks
  for the items with the most of each of the best modifiers; the weighted search Path of Building makes opens on the
  site with one link. To run that one inside the app, start the server with your own session cookie of the site:
  `POESESSID=... python3 serve.py` (it is only sent to www.pathofexile.com; this mode has not been tested).
  The app keeps to the site's rate limits, so a search takes a few seconds.

The generated data the app needs (`poe2_data/available/`, item/gem images included) is in the repo,
so the app works right after cloning.

## Regenerate data after a game patch (needs PoE2 installed)
```
cd poe2_data/_tool
npm i
node extract.mjs "C:/Program Files (x86)/Steam/steamapps/common/Path of Exile 2" ..
python -I available.py
python -I uniques.py
python images.py "C:/Program Files (x86)/Steam/steamapps/common/Path of Exile 2"   # needs Pillow
```

The enemies of the 3D scene (`poe2_data/available/monsters.json`) and the trade-site numbers of every item modifier
(`trade_mods.json`, what the gear search matches by) come from Path of Building 2's export of the game tables and need
no install: `python -I pob2.py` in the same folder. Run it again after regenerating the items.
