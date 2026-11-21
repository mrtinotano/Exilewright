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
be pasted in Equipment. Equipment has the game's two weapon sets (tabs I and II, a key swaps them in the Simulator):
the passives of each set and the stats follow the set in hand; a two-handed weapon shows in both hands, as in the game. **.build file for the game** (in Export) saves the build for the in-game build planner (0.5+, folder
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
  Or *Chosen modifiers*: the item must have every modifier picked, each with at least the value typed (the ones of
  the item worn to start from), each kind its own (implicit, fractured, crafted, enchantment, rune, desecrated…), of
  the same base or any. The search starts from the dearest under the price and goes down to 10, shown cheapest first.
  The Equipment tab has the same under an item: a box for each of its modifiers, a price and its currency, and the
  results in the item window.
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
line is always asked for), every one of them (a unique: the lines that can roll otherwise). A line the app does not know ("+3 to Level of all Attack Skills") is asked by the site's own wording of it, in any language (through its English, as Exiled Exchange 2 does). An unidentified item (often sold so,
dearer as a gamble) is priced as the unidentified ones listed of its base and rarity, of its item level or more (not
for a unique), corrupted or not as it is. Currency and what stacks (runes, essences, omens, fragments, uncut gems, waystones...) is priced on the Currency Exchange instead: the best rates its sellers ask, in the currency most of them take, and what your stack comes to. A skill gem is priced as the ones of its level and quality or more, corrupted or not as it is; a waystone of its own (magic, rare) as the ones of its tier that give at least about as much item rarity, pack size, waystone drop chance... (its numbers at most the ±% under), a plain one on the Currency Exchange. One listing per seller, as Exiled Exchange 2 shows them. As Exiled Exchange 2 asks: a non-unique item finds no uniques; one not
corrupted, mirrored or sanctified finds none that are (a corrupted one finds either); a corrupted one's rune sockets
and a flask's, charm's or (not rare) weapon's or armour's quality past the usual are asked as minimums. With "Thorough search"
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

**Simulator** (its own tab): the build's skills against the game's monsters in a 3D room, on a screen laid out like the game's (life and shield orb, mana, Spirit and Rage orb, the buffs with the game's icons, the skill bar in the middle; a skill's info shows with the cursor over it, the keys behind the ? button). You move as in the game, chosen in Settings: click to move, with the bar on the left, middle and right mouse button and Q W E R T, or W A S D, with it on the mouse buttons and Q E R T F (the game's two layouts, as its config gives them); each slot has the skill you put on it by clicking it (a skill new to the build takes a free one). Move is one of them, on left click to begin with, as in the game: it walks to the cursor while held, and a skill put in its place is used by that click, so you walk only from the slot you give Move; Ctrl+click places an enemy and Alt+drag turns the camera. A controller works once the browser sees it: the left stick moves, the right stick aims (else the nearest enemy is the target), A X Y RB RT LB LT and the right stick click use the bar, B rolls and the D-pad drinks the flasks (the game keeps its default controller binds in its executable, so this layout is the simulator's). Enemies come at you at their own movement speed (MonsterVarieties) once you are within their aggro range or hit them, and attack once you are in their reach; the enemy panel is a dropdown in the scene, by the ? button, and a box in it keeps them standing still, as dummies, and Reset puts them back where they were placed. The build's life and mana flasks sit together before the skills, on 1 and 2 as in the game: a drink spends its charges (the game's most charges and charges per use, with the item's and the build's modifiers) and recovers its amount over its time, a flask that applies its effect constantly recovers all the time, and kills refill them by the monster's rarity, as the game's glossary says. The build's charms follow them and are used by themselves when their implicit says (you become frozen, ignited, stunned..., take fire damage, kill a rare enemy), granting the game's buff for their duration: immunity to that ailment, which also removes it, or the resistance, with their charges refilled by kills. Only skills used by
hand go on it; persistent ones (auras, heralds, buffs like Berserk, reserved minions, Cast on X) are on, in the build's order, while
the build's Spirit covers them, and the skill placed in a meta gem is used by it. While the Simulator is open the side panel shows only what changes as you play, against your character without it: resistances (charms), movement and action speed (chill, freeze, heavy stun), damage taken (shock), life and mana recovery per second (the flasks being drunk), damage over time taken per second (your ailments and the ground you stand in), the life Berserk costs, attack damage from Rage and a charm's guard, up in green and down in red; under it, the skills that deal damage, with their damage per second as it is now, a skill a meta gem uses shown inside that meta gem's card; only the cards scroll, under their title. Each use costs its mana as Path of Building 2 works it out (the gem's cost, its supports' multipliers, reduced cost and cost efficiency; per second while channelled) and mana regenerates at the build's rate; Rage is gained from its gem (Eternal Rage) or the build's "gain Rage on hit / kill / when hit", lost after 4 s without gaining any, raises attack damage by the Rage you have, and Berserk costs its life per Rage while on. Enemy hits put the game's ailments on you, shown with their icons in a red-framed row under the buffs: ignite (flammability), shock and chill from the hit's damage against your ailment threshold, freeze building up against your freeze threshold and heavy stun against your stun threshold (more from physical and melee hits, as monster.ot says; both bars show while they fill and empty as character.ot says), bleeding and poison from the monster skill's chance, with the player's durations and your avoidance, reduced duration and reduced effect; chill slows you, freeze and heavy stun stop you, shock raises the damage you take and the damaging ones hurt every second. Hits deal the skill's own damage
after the monster's defences, and ailments follow the game's rules (`GameConstants` and each monster's thresholds per level
and rarity): the chance to shock and the flammability that ignites grow with the damage against the monster's ailment
threshold, chill slows by its magnitude, freeze and heavy stun fill a bar against its poise (harder to fill again for a
while after one), bleeding and poison need a chance from the skill or the build, Armour Break lowers its armour until it
is Fully Broken, Electrocute and Pin build up from the skills that can inflict them, and Maim (from the skill, the weapon,
the tree, on fully breaking armour or once Pin ends; Spearfield, Artillery Ballista and Brambles always) slows their
movement and lowers their evasion. The tree's and gear's increased damage against an enemy in a state (frozen, maimed,
heavy stunned, on full life, rare or unique...) counts on the hits that find it so. Each skill keeps its own rules: what it
never or always inflicts, the more damage it deals when it consumes a state or hits one (frozen, shocked, immobilised...),
against unique enemies or per charge spent. Curses apply their gem's resistances, armour, damage and speed (less on rarer
monsters, none above the gem's level limit), Exposure lowers resistances by its source's magnitude, and marks add their
critical damage or freeze / electrocute buildup (Freezing and Voltaic Mark grant their extra damage when that fills).
Totems use their gem's own attack or spell, or the gem placed in them (Mortar Cannon's grenade), with the damage and
speed the planner calculates for a totem, up to the build's totem limit. Minions are the game's monster their gem raises,
at the level the gem gives, with their own attack or spell and what the game passes them of your minion modifiers (and the increased damage, attack speed and area some gems give them per your Strength or Dexterity; the Infernal Hound Ignites the enemies around it as though dealt its share of its life as fire damage),
and their life (the allies' life at their level times their monster's, with your increased and more minion life):
enemies nearer to a minion than to you attack it, and it dies at none left. An Empowered Zombie takes less damage and moves faster. Bone Offering shields them while its spike
stands, Grim Feast gathers the life of the persistent ones slain in your Presence for its Grim Resurrection, and
Healing Runes spends Runic Ward to heal them.
Chains, projectiles, grenade fuses, curse delays and totem durations are each gem's own. Skills with mechanics of their own follow
their gem's numbers too: Glory built from the enemy's Power (Banners, Hammer of the Gods, Walking Calamity), Banners and
Rite of Restoration's Sigil buffing you while you stand in them (the Sigil gaining stages from the mana you spend there),
Energy for Cast on X and the Invocations (centienergy per Power of the enemy, up to 1 per 10 ms of the triggered spell's use
time), attack chains (Ice Strike, Tempest Flurry, Primal Strikes) stepping to their final strike, Seals that repeat a spell
(Unleash), Parry and Raise Shield blocking actively, Leylines draining Runic Ward for more spell damage, Bloodstone Lances
for Shattering Spite, Unbound Fury, Splinter Totem and Greatwood, Spectral Volley's lingering projectiles, and the Flames of
Chayula and Ancient Blooms of Into the Breach and Wildwood's Gifts, crossbow Heat (Rapid Shot builds it, grenades and
Incendiary Shot consume it), the Surges and Elemental Expression, Whirling Slash's Whirlwind that Twister consumes, the
visages of Moment of Vulnerability, Hexblast detonating curses, Lightning Spear's and Shockchain Arrow's bursts, Temper
Weapon's Combust and the corpse cores of Volatile and Bitter Dead, the ice crystals of Grim Pillars and Frozen Locus,
Requiem's Anguish, Hollow Form's images, Tempest Bell's shockwaves, Earthquake's Jagged Ground and its Aftershock,
Explosive Spear's lodged spear and its cross, Bonestorm's spikes, Mirror of Refraction's mirrors, Stormblast Bolts,
Encase in Jade with Jade Heritage's stacks, Midnight Zenith's crystals (with their life and cold explosion, from Path
of Building 2's stat set), Fragments Of The Past's volcano and its Ice Fragments, Ice Shards' shards that arm and grow stronger, Blood Hunt's
explosion of the Blood Loss an enemy has taken, Decompose's growing gas cloud exploding with its own fire and
the corpse's life as chaos, Blind (Flash Grenade) lowering an enemy's accuracy and evasion, Called Shots marking an enemy every
five seconds and passing a consumed Mark on, Voltaic Barrier energising the projectiles fired through it to discharge
chaining lightning, Repulsion's curse detonating on your hit, Wing Blast's shockwave on a Primed enemy, Lunar Blessing's
Moonbeams, Detonate Dead and Detonate Living exploding with their share of the monster's life, Dark Pact and Abyssal
Pact sacrificing a minion's life (Dark Pact yours without one), the strikes that dash to an enemy by their own range, Herald of Blood's explosion from the Blood Loss of the enemy, Shield Charge's more stun when fully charged, one Living Bomb seed (five for Untether) and one Rain of Arrows at a time, Fury of the Mountain's Molten Fissures at random within its cone (up to twelve), Elemental Sundering's explosion of each Freeze, Shock and Ignite its pulse consumes, Bone Cage's ring of spikes that break on touch and Pin, Spearfield's spears that explode on touch and Maim (up to seventy), Boneshatter's shockwave on Heavy Stunning an enemy Primed for it, Snipe's explosion on Perfect Timing (its enhanced one consuming a Freeze), Fragmentation Rounds' shrapnel from a Frozen enemy, Crushing Fear's shockwave from the enemy it kills (per its power), Explosive Concoction's smaller flasks at Ignited enemies and the Concoctions' Mana Flask charges, Tornado Shot's tornado (its damage over time, it Hinders and copies your arrows, spears and bolts into a ring of three), Ice-Tipped Arrows' next four projectile attacks turned to cold with Ice Fragments that explode where they land, Escape Shot's leap back with its icy arrow hitting where you stood and its Ice Fragments, Cross Slash pulling every Ice Fragment near (Frozen Spite's too) into where its gouges cross to explode at once, Whirlwind Lance's Whirlwinds where the spear lands (up to six, collapsing as you enter them), Whirlwinds gaining half their damage as the element of the ground they stand on, Twister's twisters gaining half their damage as the element of the ground they pass over or of the elemental Whirlwind they consume, Shield Charge's extra distance and Aggravated Bleeding (Herald of Blood's explosion's chance and Rusted Spikes' on Pin too), Fragmentation Rounds' bolts bursting the Ice Crystals they reach, a charge bypassing the cooldown of the skills whose text says so (Ice-Tipped Arrows a Frenzy Charge, the Warcries an Endurance Charge, or Rage with Enraged Warcry), Astral Projection's Novas where you aim, Ice Crystals with their skill's life (Frost Wall, Grim Pillars, Frozen Locus; less with Icicle, more with Glacier) that burst once your hits take it, Premeditation's more damage and Unerring Power's lower cost and higher Accuracy only on an Empowered use, Tacati's Ire's faster Poison per Rage, Lockdown's more Pin buildup within 2 m, Rapid Casting III's cast speed per different spell cast lately, Crackling Barrier's lightning thorns while you channel, Loyalty's Companion taking its share of your hits (and its less life), Drain Ailments consuming an ailment for its more damage over time, Derange's Energy Shield cost equal to your Intelligence and more damage over time per 100 Intelligence, Refraction's Refractive Plating (its share of armour against elemental hits, deflection from evasion) within the Banner and Refraction III's Exposure per 1000 armour on the enemies in it, the enemies' hits Deflected by your deflection rating against their accuracy and cut by the armour that applies to their element, Infernal Cry's Empowered melee attacks gaining its share of their damage as fire, Ferocious Roar's Rage per Power and its Empowered attacks' Armour Break, Elemental Conflux's more damage of a random element changing every its duration, your regeneration on Consecrated Ground (5% of your life a second, more by Consecrate's effect), Withering Presence Withering the enemies in your Presence every its interval, Animus Exchange's life sacrificed for Runic Ward (which can Overflow), Hollow Shell's Guard from the Ward it costs, Emergency Reload reloading every clip and its more damage for crossbow bolts, Meditate's channelled energy shield recharge (its more rate, no delay, Overflowing; a hit ends it), Eye of Winter's single Eye releasing its shards in a spiral (each enemy's first shard hit of a use with its more damage, damage gained from the elemental ground it passes over), Frostflame Nova's damageless wave on the Ignited (their Ignite restarted, Freeze buildup more per 1% of their ailment threshold the Ignite deals a second, no other Ignite until it ends), Enervating Nova's ring (no damage within its secondary radius, more with distance up to its most at the edge; the enemies hit Electrocutable by any lightning damage for its duration), Contagion's more damage each time it spreads (up to its most), a skill the weapon in hand cannot use refused, Triskelion Cascade's and Barrage's cooldowns lengthened by their share of the empowered skill's use time (Barrage's up to its most), Pinnacle of Power's and the build's "all damage can ignite / chill / freeze / shock" counting every damage type of a hit for that ailment, Explosive Spear's hit on the enemies it pierces on the way, Toxic Domain's Toxic Pustules attached by your projectile attacks in its Bloom (bursting for its own attack damage, storing poison), Stormblast Bolts' hit where each bolt lands, the damage types the build's "<type> damage can <ailment>" (physical, chaos, elemental; all damage to bleeding or poisoned enemies for chill; attacks' electrocute, projectiles' and physical Pin, fire or elemental bleeding, all damage poisoning) and Olroth's Hubris (freeze) add to an ailment, Primal Bounty's Owl Feathers (spent on a dodge to give your next projectile skill more projectiles, faster),
Wardbound Minions and Rigwald's Ferocity by weapon set. The ≡ button opens a combat log: the last hits, kills
and damage taken, with each skill's total, and a bar at the top shows the life of the enemy under the cursor or last hit,
as the game does. Where the data leaves something out (a time, a count),
the code says so in a `note:` comment. Numbers that use a value of the
scene and not of the game (a consumed state the skill gives no number for, a minion with no damaging skill) are drawn with "~".

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
