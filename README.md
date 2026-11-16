# POE 2 Builder

Personal Path of Exile 2 build planner: passive tree, equipment, skills/supports and a 3D scene.
Every number comes from the game's own data (see `poe2_data/README.md`).

## Run
Double-click `start.cmd` (or `python serve.py`) and open http://127.0.0.1:8765

**Share** (top bar) exports/imports Path of Building 2 codes and links (pobb.in, poe.ninja, Maxroll, poe2db;
pastebin and rentry to import) through `serve.py`, plus JSON files, and imports the builds saved in Path of
Building 2 on the same computer (how a character of your account gets here: import it there, save it, pick it
in Share). Items copied in the game with Ctrl+C can
be pasted in Equipment. **.build file for the game** saves the build for the in-game build planner (0.5+, folder
`Documents/My Games/Path of Exile 2/BuildPlanner`): tree, ascendancy and gems with supports; gem levels and gear
travel as notes, since the format has no fields for them (layout as Path of Building 2 writes it).

**Character panel** (left): the level goes up with the tree, one passive point per level; a real character also has
the passive points quests give, so type its level (a build imported from Path of Building 2 brings its own).
Elemental resistances carry the game's penalty for the level of the area (`ResistancePenaltyPerAreaLevel`: none at
first, -60% from level 65), taken to be the character's level. **Campaign rewards** lists what quests leave on a
character for good (+100 Spirit, resistances, the choices at each shrine...): counted from the level of each one's
area, a choice only once made; an imported build brings its own.

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

**Loot** (its own tab) says whether an item is better than what the character wears: hold the pointer over an item in
the game (one you found and identified, one in the inventory or the stash, one a merchant sells) and press Ctrl+C.
The game puts the item's text in the clipboard, `serve.py` passes it to the page (`/clipboard`), and the page puts the
item on the build in every slot it fits and calculates the build with and without it: the build's passives and skills
decide what counts. Without a skill in the build only defences and the weapon's own damage are judged.
- *Over the game*: the verdict shows in a small window next to the pointer for a few seconds, plus a sound, so there
  is nothing to paste and no need to look at the planner. It only has to stay open in the browser, started from
  `serve.py`. The window is made on Windows (`start.cmd`); elsewhere start the server with `python3 serve.py overlay`.
  It needs a Python with tkinter, and the game in windowed full screen: nothing draws over exclusive full screen.
- *What the character wears*: the planner cannot read it from the game. **Equip** on an item of the Loot tab tells it
  you put that item on; or compare with the build's own Equipment instead.
- One key press per item, as the overlay tools for the game do: the planner never reads the game's memory or screen
  and never moves the mouse for you. GGG's rules for tools (https://www.pathofexile.com/developer/docs) allow one
  read of the clipboard per manual key press and nothing automatic, so there is no scan of the whole inventory.
  Modifiers `calc.js` does not calculate are listed as not counted.
- *Loot filter for the game*: **Save the filter** writes a `.filter` file for the game's own item filter (folder
  `Documents/My Games/Path of Exile 2`, picked in the game's options), made from the build (`filter.js`): the weapon
  classes it uses (for a spell, only the wands and staves that can roll modifiers for its damage type), armour pieces
  with the same defences as the ones it wears, amulets, rings, belts, jewels when the tree has a socket, and the bases
  of its unique items stand out where they drop. A filter sees an item's class, base and rarity, never its modifiers,
  so it marks what is worth a look and Ctrl+C gives the verdict. It can be put in front of a filter already in use
  (NeverSink's, for instance): the build's gear takes the planner's look and the rest stays as that filter has it.
  Save it again after changing the build. Not yet loaded in the game: see the to-do notes.

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
python -I pob2.py
```
Everything comes from the game's own tables, in its ten languages: gems with their stats per level, items, uniques,
the passive tree, and the monsters of the 3D scene. `available.py` ends with a self-check that fails if a patch renames
a column it needs. `pob2.py` needs no install: it reads from Path of Building 2 the two things the tables do not say,
what each support's stats do to the calculation (`pob2.json`) and the trade-site number of every item modifier
(`trade_mods.json`, what the gear search matches by).
