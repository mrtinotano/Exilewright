# Exilewright

Path of Exile 2 build planner & simulator for Windows: passive tree, equipment, skills/supports and a 3D simulator,
plus an in-game price check and a loot filter creator.
Every number comes from the game's own data (see `poe2_data/README.md`).

Fan-made, not affiliated with or endorsed by Grinding Gear Games. Path of Exile, its data and images are (c)
Grinding Gear Games; support stat readings come from Path of Building Community (MIT). See `LICENSE`.

> **Early version.** Exilewright is a young tool: many things do not work quite right yet, and some numbers may be
> off. It is being improved as fast as possible. If something looks wrong, please
> [open an issue](https://github.com/mrtinotano/Exilewright/issues/new/choose).

## Install
Download it from [Releases](https://github.com/mrtinotano/Exilewright/releases/latest):
- **Exilewright-setup.exe**: installs it (no admin rights needed) and adds it to the Start menu. Your builds are kept
  in `%LOCALAPPDATA%\Exilewright`.
- **Exilewright-portable.zip**: unzip it anywhere and open `Exilewright.exe`. Your builds are kept in the `profile`
  folder next to it.

It opens in a window of its own (WebView2, part of Windows), maximized the first time and then with the size and place it last had;
closing the window closes it. Windows may warn that the app is not recognised, because it is not signed: "More info"
→ "Run anyway".

When it opens, and whenever its window comes back to the front (at most every 10 minutes), it looks for a newer
release: the top bar then says so, with a button that downloads and installs it in the installed app (it closes and
opens again on its own) or opens the release page in the portable one.

## Run from source (developers)
`python serve.py` (or double-click `start.cmd`) serves the planner at http://127.0.0.1:8765 for a browser;
`python serve.py app` opens it in its own window (needs `pip install pywebview`). Builds made in the browser stay in
the browser: bring them over with Export and Import (copy the code, import it).

`build_app.py` makes the release files: `dist/Exilewright/Exilewright.exe`, the portable zip and, with Inno Setup 6,
the installer (`installer.iss`). It needs PyInstaller and pywebview (see the top of `build_app.py`). The version is
`VERSION` in `serve.py`: the window title, the update check and the installer take it from there.

**Import** and **Export** (top bar) take in and give out Path of Building 2 codes and links (pobb.in, poe.ninja,
Maxroll, poe2db; pastebin and rentry to import) through `serve.py`, plus JSON files; Import also takes the builds saved
in Path of Building 2 on the same computer (how a character of your account gets here: import it there, save it, pick
it in Import). Items copied in the game with Ctrl+C can
be pasted in Equipment. **.build file for the game** (in Export) saves the build for the in-game build planner (0.5+, folder
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
  trade site (the app's own server passes the calls on: `serve.py`, `/trade/*`), puts each listed item on
  the build and ranks them by what they change. Without a login the site only takes simple searches, so the app asks
  for the items with the most of each of the best modifiers; the weighted search Path of Building makes opens on the
  site with one link (it runs there when you are logged in).
  The app keeps to the site's rate limits, so a search takes a few seconds.

**Equipment comparison** (Settings) says whether an item is better than what the character wears: hold the pointer over an item in
the game (one you found and identified, one in the inventory or the stash, one a merchant sells) and press Ctrl+C.
The game puts the item's text in the clipboard, `serve.py` passes it to the page (`/clipboard`), and the page puts the
item on the build in every slot it fits and calculates the build with and without it: the build's passives and skills
decide what counts. Without a skill in the build only defences and the weapon's own damage are judged.
- *Over the game*: the verdict shows in a small window next to the pointer for a few seconds, and that is the only
  place it shows: the planner only has to stay open. It needs the game in windowed
  full screen (nothing draws over exclusive full screen). From source it needs a Python with tkinter; outside
  Windows start the server with `python3 serve.py overlay`.
- *What the character wears*: the planner cannot read it from the game, so it starts from the build's equipment and
  the first item copied for an empty slot is taken as the one worn; or compare with the build's own Equipment instead.
- One key press per item, as the overlay tools for the game do: the planner never reads the game's memory or screen
  and never moves the mouse for you. GGG's rules for tools (https://www.pathofexile.com/developer/docs) allow one
  read of the clipboard per manual key press and nothing automatic, so there is no scan of the whole inventory.
  Modifiers `calc.js` does not calculate are listed as not counted.

**Price check over the game** (Settings): hold the pointer over an item in the game and press the shortcut
(Ctrl+D unless you change it; it always takes Ctrl or Alt). `serve.py` sees the key while the game is the window in
use, sends the game one Ctrl+C, as if you pressed it, and the page searches the official trade site for items like
yours, as Exiled Exchange 2 searches them: the same unique, the same kind of weapon or armour (any base: its damage
or defences are asked), or the same base (rings, amulets, belts), with its modifiers (crafted, fractured and
desecrated ones too; attributes and resistances as the item's total) and its weapon damage or defences, each at
most 10% under yours and with no top (Settings: "Numbers down to"; a number never goes past 1 towards 0, so a "+1"
line is always asked for), every one of them (a unique: the lines that can roll otherwise). With "Thorough search"
(Settings), when nothing like that is listed, it goes line by line lowering that one's minimum alone (5% by 5%, down
to 30%) and searches with each at the % that found something, else with any one line left out. Still nothing: there
is none. Next to the pointer it lists what the 5 cheapest alike ones ask (as the site ranks the listings whatever
the currency; never one with a "+ to Level of" line yours does not have) and a button that opens the same search on
the trade site. Again one key press, one item.

**Playing with a controller**: pick the item with the controller, keep the mouse pointer over no item and press Ctrl+C or
the price check shortcut on the keyboard: the game copies the item picked. When the controller was used after the mouse, the
window shows at the top middle of the screen, as the pointer is not by the item.

**Loot filter** (its own tab): build a filter rule by rule (item classes and bases from the game's data, rarity,
item/area level, quality, stack size, waystone tier; text, border and background colours, text size, drop sound,
light beam, minimap icon) and save it straight into `Documents/My Games/Path of Exile 2`, or download it. In the
game: Options, Game, Item Filter.

**Simulator** (its own tab): the build's skills against the game's monsters in a 3D room. Hits deal the skill's own damage
after the monster's defences, and ailments follow the game's rules (`GameConstants` and each monster's thresholds per level
and rarity): the chance to shock and the flammability that ignites grow with the damage against the monster's ailment
threshold, chill slows by its magnitude, freeze and heavy stun fill a bar against its poise (harder to fill again for a
while after one), bleeding and poison need a chance from the skill or the build, Armour Break lowers its armour until it
is Fully Broken, Electrocute and Pin build up from the skills that can inflict them. Each skill keeps its own rules: what it
never or always inflicts, the more damage it deals when it consumes a state or hits one (frozen, shocked, immobilised...),
against unique enemies or per charge spent. Curses apply their gem's resistances, armour, damage and speed (less on rarer
monsters, none above the gem's level limit), Exposure lowers resistances by its source's magnitude, and marks add their
critical damage or freeze / electrocute buildup (Freezing and Voltaic Mark grant their extra damage when that fills).
Totems use their gem's own attack or spell, or the gem placed in them (Mortar Cannon's grenade), with the damage and
speed the planner calculates for a totem, up to the build's totem limit. Chains, projectiles, grenade fuses, curse delays
and totem durations are each gem's own. Numbers that use a value of the scene and not of the game (a consumed state the
skill gives no number for, minions) are drawn with "~".

**Settings** (its own tab): the price check shortcut, its league, seller and ±%, the equipment comparison, the keys of the Simulator, and General
(open with Windows; only an icon in the notification area, no taskbar button: a click on it opens the window; the
language).

The generated data the app needs (`poe2_data/available/`, item/gem images included) is in the repo,
so it runs from source right after cloning.

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
the passive tree, and the monsters of the Simulator. `available.py` ends with a self-check that fails if a patch renames
a column it needs. `pob2.py` needs no install: it reads from Path of Building 2 the two things the tables do not say,
what each support's stats do to the calculation (`pob2.json`) and the trade-site number of every item modifier
(`trade_mods.json`, what the gear search matches by).

## Feedback
Found a bug, a number that does not match the game, or have an idea? [Open an issue](https://github.com/mrtinotano/Exilewright/issues/new/choose)
(there is a form for each). The project does not take pull requests: they are closed on their own, so please write an
issue instead.

Working on it with an AI coding assistant? `AGENTS.md` tells it how the project is laid out and its rules.

## Support
Exilewright is free. If it helps you and you want to thank the work, you can
[buy me a coffee on Ko-fi](https://ko-fi.com/adriamartin). Thank you!
