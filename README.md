# Exilewright

A Path of Exile 2 build planner and simulator for Windows.

- **Plan a build:** passive tree, ascendancy, equipment, skills and supports, with the numbers the game uses.
- **Try it in 3D:** a simulator that puts your build against the game's monsters, with the game's own skill effects.
- **Tools for playing:** an equipment comparison and a price check over the game, and a loot filter creator.

Every number comes from the game's own data (see `poe2_data/README.md`).

Fan-made, not affiliated with or endorsed by Grinding Gear Games. Path of Exile, its data and images are (c)
Grinding Gear Games; support stat readings come from Path of Building Community (MIT). See `LICENSE` and `NOTICE.md`.

> **Early version.** Exilewright is a young tool: some things do not work quite right yet and some numbers may be
> off. It is being improved as fast as possible. If something looks wrong, please
> [open an issue](https://github.com/mrtinotano/Exilewright/issues/new/choose).

## Contents
- [Install](#install)
- [The planner](#the-planner)
- [Import and export](#import-and-export)
- [Optimizer](#optimizer)
- [Over the game: equipment comparison and price check](#over-the-game-equipment-comparison-and-price-check)
- [Loot filter](#loot-filter)
- [Simulator](#simulator)
- [Settings](#settings)
- [Privacy](#privacy)
- [Feedback](#feedback)
- [For developers](#for-developers)
- [Support](#support)

## Install
1. Download **Exilewright-setup.exe** from [Releases](https://github.com/mrtinotano/Exilewright/releases/latest).
2. Run it. It needs no admin rights and adds Exilewright to the Start menu.

Windows may warn that the app is not recognised, because it is not signed: "More info" → "Run anyway".

- It opens in a window of its own (WebView2, part of Windows), with the size and place it last had.
- Your builds and settings are kept in `%LOCALAPPDATA%\Exilewright`.
- **Updates:** when it opens, and when its window comes back to the front (at most every half minute), it looks for a
  newer release. The top bar then says so, with a button that downloads and installs it; the app closes and opens
  again on its own.

## The planner
**Character panel** (left)
- The level goes up with the tree, one passive point per level. A real character also has the points quests give, so
  type its level (a build imported from Path of Building 2 brings its own).
- Elemental resistances carry the game's penalty for the area level (none at first, -60% from level 65), taken to be
  the character's level.
- **Campaign rewards** lists what quests leave on a character for good (+100 Spirit, resistances, the shrine
  choices...), counted from the level of each one's area.
- Aura skills (the Purities, Discipline) grant their resistances and energy shield at their gem's level.

**Passive tree**: the class and ascendancy trees, with the points of each of the game's two weapon sets.

**Equipment**: a paper doll like the game's inventory.
- Items copied in the game with Ctrl+C can be pasted in.
- The two weapon sets (tabs I and II): the stats follow the set in hand, and a two-handed weapon shows in both hands.

**Skills**: skill gems and their supports, as in the game.
- Supports go only where the game allows them (skill types, one of each family, support capacity from attributes),
  and each applies to the parts of a gem it can support.
- Gem quality works as in the game, the Gemling Legionnaire's alternate qualities included.
- Each gem is used with weapon set I, II or both, as the game's "Used with weapon set:".
- Persistent gems have an Enabled box, as in the game.
- A skill the weapon in hand cannot use shows its numbers with that weapon and the reason; it gets no DPS.
- Skills that trigger other skills (Ancestral Cry, Cast on X...) get a tab for each triggered skill in the details
  panel.

## Import and export
Both are in the top bar.

- **Path of Building 2 codes and links:** pobb.in, poe.ninja, Maxroll and poe2db; pastebin and rentry to import.
- **Builds saved in Path of Building 2** on the same computer. To bring in a character of your account, import it
  there, save it and pick it in Import.
- An import lists the skills in the order of the game's skill panel, with the attacks your weapons give (Mace Strike,
  a cannon's Grenade...) in their weapon set.
- **JSON files**, to move builds between computers.
- **.build file for the game** (Export): saves the build for the in-game build planner (0.5+, in
  `Documents/My Games/Path of Exile 2/BuildPlanner`): tree, ascendancy and gems with supports. Gem levels and gear go
  in as notes, since the format has no fields for them.

## Optimizer
Its own tab. It works on the build on screen for one objective: damage or uses per second of a skill, toughness, life,
energy shield, armour, evasion, resistances...

- **Passive tree:** spends the points on the passives that raise the objective most, from the current tree or from
  the class start. It finds good paths, not a proven best one, and only counts what the planner calculates
  (keystones and conditional effects do not count).
- **Support gems:** tries every support the skill can take, alone and together, within the game's rules.
- **Gear on the trade site:** works out what each modifier of a slot is worth, searches the official trade site and
  ranks the items found by what they change on the build.
  - Without a login the site only takes simple searches, so the app asks for the items with the most of each of the
    best modifiers. The weighted search Path of Building makes opens on the site with one link.
  - Or **Chosen modifiers:** the item must have every modifier you pick, each with at least the value you type. The
    Equipment tab has the same under an item.
  - The app keeps to the site's rate limits, so a search takes a few seconds.

## Over the game: equipment comparison and price check
Both are turned on in Settings and work with the game in windowed full screen (nothing draws over exclusive full
screen). The result shows in a small window next to the pointer.

**Equipment comparison**: is an item better than what the character wears?
- Hold the pointer over an item in the game (one on the ground, in the inventory or stash, or a merchant's) and press
  Ctrl+C. The app puts the item on the build in every slot it fits and calculates the build with and without it.
- The planner cannot read what the character wears, so it starts from the build's equipment; the first item copied
  for an empty slot is taken as the one worn. Or compare with the build's own Equipment instead.
- Without a skill in the build, only defences and the weapon's own damage are judged. Modifiers the planner does not
  calculate are listed as not counted.

**Price check**: hold the pointer over an item and press the shortcut (Ctrl+D unless you change it).
- The app sends the game one Ctrl+C and searches the official trade site for items like yours, as Exiled Exchange 2
  does: the same unique, the same kind of weapon or armour, or the same base, with its modifiers and its damage or
  defences, each at most 10% under yours (Settings: "Numbers down to").
- It lists what the 5 cheapest ask (one listing per seller) and a button that opens the same search on the site.
- **Currency and what stacks** (runes, essences, omens, fragments...) is priced from the game's Currency Exchange
  ([poe2scout](https://poe2scout.com)) and the trade site's bulk exchange, with what your stack comes to.
- **Unidentified items, skill gems and waystones** are priced against ones like them (base and item level; level and
  quality; tier and what the waystone gives).
- **Thorough search** (Settings): when nothing is found, it lowers each line's minimum on its own, or leaves one line
  out, to find the nearest listings.

**With a controller**: pick the item with the controller, keep the mouse pointer over no item and press Ctrl+C or the
shortcut on the keyboard. The window then shows at the top middle of the screen.

**Within the game's rules**: one key press, one item. The app never reads the game's memory or screen and never moves
the mouse, as [GGG's rules for tools](https://www.pathofexile.com/developer/docs) ask, so there is no scan of the
whole inventory.

## Loot filter
Its own tab. Build a filter rule by rule:
- **What it catches:** item classes and bases from the game's data, rarity, item and area level, quality, stack size,
  waystone tier.
- **How it shows:** text, border and background colours, text size, drop sound, light beam, minimap icon.

Save it straight into `Documents/My Games/Path of Exile 2`, or download it. In the game: Options → Game → Item Filter.

## Simulator
Its own tab: your build's skills against the game's monsters in a 3D room.

### The screen
Laid out like the game's: the life and energy shield orb, mana, Spirit and Rage, your buffs and ailments with the
game's icons, and the skill bar in the middle. A skill's info shows with the cursor over it; the keys are behind the
**?** button.

While it is open, the side panel shows only what changes as you play (resistances, speed, damage taken, recovery,
damage over time...), up in green and down in red, and under it the damage per second of each skill as it is now.

Buttons in the scene:
- **Enemies**: the monster to place, its level, the map, and a box that keeps them standing still as dummies.
- **≡**: a combat log of the last hits, kills and damage taken, with each skill's total.
- **Pause**: time, enemies and stats stand still.

### Controls
Chosen in Settings, as the game's two layouts:

| | Click to move | W A S D |
|---|---|---|
| Moving | Click (Move is on left click to begin with) | W A S D |
| Skill bar | Left, middle and right mouse button, Q W E R T | Mouse buttons, Q E R T F |

- Each slot has the skill you put on it by clicking it.
- **Ctrl+click** places an enemy, **Alt+drag** turns the camera.
- The life and mana flasks are on **1** and **2**, and swapping weapon sets uses the game's key.
- **Controller:** the left stick moves, the right stick aims (else the nearest enemy is the target), A X Y RB RT LB LT
  and the right stick click use the bar, B rolls and the D-pad drinks the flasks. The game keeps its controller binds
  in its program, so this layout is the simulator's own.

### Enemies and maps
- Enemies are the game's monsters at their own level, life, defences and speed. They come at you once you are within
  their aggro range or hit them, and attack once you are in their reach.
- **Map:** paste a waystone from the game (Ctrl+C on it, in any of the game's languages) or pick its tier and
  modifiers by hand. The tier sets the monsters' level; the monsters' modifiers are on every enemy and the players'
  on your character. Its Ignited, Chilled and Shocked ground is a patch in the room that does it to you.
- Not simulated: a map's rewards and the curses an area puts on players from time to time (their values are not in
  the game's tables).

### Your character
- **Skills:** the ones used by hand go on the bar. Persistent ones (auras, heralds, buffs, reserved minions, Cast on X)
  are on while your Spirit covers them, in the build's order, and a skill in a meta gem is used by it.
- **Moving while using a skill:** a skill that roots you does so for its whole use time; one that does not slows you by
  its own penalty.
- **Mana and Rage:** each use costs its mana as Path of Building 2 works it out, and mana regenerates at the build's
  rate. Rage is gained as the build says, raises attack damage and is lost after 4 s without gaining any.
- **Flasks and charms:** a drink spends its charges and recovers over its time, and kills refill them by the monster's
  rarity. Charms are used on their own when their condition happens (frozen, ignited, stunned...).
- **What hits you:** monster hits bring the game's ailments (ignite, shock, chill, freeze, heavy stun, bleeding, poison)
  against your thresholds, avoidance and reductions. Your armour, evasion, deflection, block and resistances count.

### Your hits
- Hits deal the skill's own damage after the monster's defences: armour, evasion, resistances and penetration.
- **Ailments and states** follow the game's rules and each monster's thresholds: shock, ignite, chill, freeze, stun,
  bleeding, poison, Armour Break, Electrocute, Pin, Maim, Blind, Hinder, Exposure...
- **Curses and marks** apply their gem's effects (less on rarer monsters).
- **Conditions count:** the tree's and gear's bonuses against an enemy in a state (frozen, on full life, rare...) and
  while you are in one (killed recently, on low life, surrounded...).

### Skills with mechanics of their own
Each skill follows its gem's own numbers: chains, projectiles, fuses, curse delays, durations, cooldowns, charges. Many
also have their own mechanics, for example:
- **Totems and minions:** the game's monster each gem raises, at its level, with its own attack or spell, life and
  your minion modifiers. Enemies nearer to one than to you attack it.
- **Buffs on the ground:** Banners, Sigils, Consecrated Ground, Leylines.
- **Energy and triggers:** Cast on X and the Invocations gain energy per Power of the enemy and trigger their spell.
- **Ground and things left behind:** Ice Crystals, Whirlwinds and Twisters, Jagged Ground, Fissures, Spearfield's
  spears, Bone Cage, Toxic Pustules, corpse cores.
- **Consuming a state or a charge:** Elemental Sundering, Hexblast, Snipe, Boneshatter, Drain Ailments, the Surges.
- **Explosions on death or detonation:** Detonate Dead, Detonate Living, Herald of Blood, Crushing Fear, Repulsion.

Where the game's data leaves a value out (a time, a count), the code says so in a `note:` comment. A number that
uses a value of the simulator's own instead of the game's is drawn with "~".

### Skills look like the game
Over ninety skills use the game's own effects, colours, timings and shapes, taken from its effect files and checked
against its skill videos. Skills not done yet use a simpler effect of their element.

## Settings
Its own tab:
- The price check's shortcut, league, sellers and ±%, and the equipment comparison.
- The simulator's keys.
- General: open with Windows, only an icon in the notification area (no taskbar button), and the language.

## Privacy
- No accounts, telemetry or analytics.
- Your builds and settings stay on your computer (`%LOCALAPPDATA%\Exilewright`). `log.txt` there holds what went wrong
  the last time it ran, and never leaves your computer.
- It checks GitHub for a newer version of itself, and downloads it only when you choose to update.
- Anything else goes out only when you ask for it: a build imported or shared through the site you pick (pobb.in,
  poe.ninja, Maxroll, poe2db, pastebin, rentry), the official trade site when you price an item or search for gear,
  and poe2scout when you price currency or something that stacks.

## Feedback
Found a bug, a number that does not match the game, or have an idea?
[Open an issue](https://github.com/mrtinotano/Exilewright/issues/new/choose) (there is a form for each).

The project does not take pull requests: they are closed on their own, so please write an issue instead.

## For developers
### Run from source
- `python serve.py` serves the planner at http://127.0.0.1:8765 for a browser (`start.cmd`, or
  `python serve.py open`, opens it there too).
- `python serve.py app` opens it in its own window (needs `pip install pywebview`).
- Builds made in the browser stay in the browser: bring them over with Export and Import.
- The data the app needs (`poe2_data/available/`, images included) is in the repo, so it runs right after cloning.
- The overlay over the game needs a Python with tkinter; outside Windows start the server with
  `python3 serve.py overlay`.

### Build the release
`packaging/build_app.py` makes `dist/Exilewright/Exilewright.exe`, a portable zip and the installer (`packaging/installer.iss`, which needs
Inno Setup 6). It needs PyInstaller and pywebview (see the top of `packaging/build_app.py`). The version is `VERSION` in
`serve.py`: the window title, the update check and the installer take it from there.

### Regenerate the data after a game patch
Needs Path of Exile 2 installed.
```
cd poe2_data/_tool
npm i
node extract.mjs "C:/Program Files (x86)/Steam/steamapps/common/Path of Exile 2" ..
python -I available.py
python -I uniques.py
python images.py "C:/Program Files (x86)/Steam/steamapps/common/Path of Exile 2"   # needs Pillow
python -I pob2.py
```
- Everything comes from the game's own tables, in its ten languages: gems with their stats per level, items, uniques,
  the passive tree and the simulator's monsters.
- `available.py` ends with a self-check that fails if a patch renames a column it needs.
- `pob2.py` reads from Path of Building 2 the two things the tables do not say: what each support's stats do to the
  calculation (`pob2.json`) and the trade site's number for every item modifier (`trade_mods.json`).

`AGENTS.md` describes how the project is laid out and its rules, for coding assistants.

## Support
Exilewright is free. If it helps you and you want to thank the work, you can
[buy me a coffee on Ko-fi](https://ko-fi.com/adriamartin). Thank you!
