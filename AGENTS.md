# Working on Exilewright (for AI coding assistants)

A Path of Exile 2 build planner for Windows: plain JavaScript modules in the browser (no framework, no bundler, no
npm for the app) served by one Python file, `serve.py`. Read `README.md` first for what each part does.

## Run it
- `python serve.py` serves the app at http://127.0.0.1:8765 (open it in a browser). No build step: edit a `.js`
  file and reload the page.
- `python serve.py app` opens it in its own window (needs `pip install pywebview`).
- Checks: several modules have `console.assert` self-checks that run when the page loads, so open the browser console
  after a change and look for `Assertion failed`. Check a file's syntax with `node --check <file>.js`.

## Where things are
| File | What it does |
|---|---|
| `index.html`, `app.js` | page, tabs, passive tree drawing, build storage |
| `calc.js` | character sheet and skill damage |
| `charpanel.js` | character panel and skill tooltip |
| `items.js` | item bases, modifiers, parsing an item copied in the game (Ctrl+C) |
| `skills.js`, `skilldata.js` | skills tab, gem and support data |
| `optimize.js`, `optview.js`, `trade.js` | optimizer and gear search on the official trade site |
| `loot.js`, `settings.js` | equipment comparison and price check over the game, settings |
| `filter.js` | loot filter creator |
| `scene.js`, `scenefx.js`, `skillfx.js`, `enemies.js` | 3D simulator |
| `share.js` | Path of Building 2 codes and links |
| `i18n.js`, `i18n/*.json` | UI translations |
| `serve.py` | local server, trade site proxy, clipboard, overlay window, the app window |
| `poe2_data/available/` | the game data the app reads (generated, in the repo) |
| `poe2_data/_tool/` | the scripts that generate it from the installed game (see `poe2_data/README.md`) |

## Rules
- **Numbers come from the game.** Every value (stats, formulas, ranges, colours, sizes) comes from the game's own
  tables in `poe2_data/` or from Path of Building 2's data. Never make one up; if a table does not say it, write a
  `note:` comment saying where the value came from.
- **Ten languages.** Every new piece of UI text is written in English in the code and added, translated, to all nine
  files in `i18n/` (pt, es, fr, de, ru, ja, ko, th, zh), using the game's own terms in each language. Game names
  (items, gems, passives) come translated from the data (`name_<lang>`), never from `i18n/`.
- **Generated files are not edited by hand.** Change the script in `poe2_data/_tool/` and regenerate.
- **One key press, one action.** The app never reads the game's memory or screen and never sends input on its own,
  following GGG's rules for third-party tools.
- Keep it small: plain JavaScript and the standard library, no new dependencies.
- Code, comments and commit messages are in English.
