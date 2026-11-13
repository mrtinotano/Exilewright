# POE 2 Builder

Personal Path of Exile 2 build planner: passive tree, equipment, skills/supports and a 3D scene.
Every number comes from the game's own data (see `poe2_data/README.md`).

## Run
Double-click `start.cmd` (or `python serve.py`) and open http://127.0.0.1:8765

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
