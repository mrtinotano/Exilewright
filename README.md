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

The enemies of the 3D scene (`poe2_data/available/monsters.json`) come from Path of Building 2's export of the game
tables and need no install: `python -I pob2.py` in the same folder.
