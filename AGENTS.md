# Working on Exilewright (for AI coding assistants)

A Path of Exile 2 build planner for Windows: plain JavaScript modules in the browser (no framework, no bundler, no
npm for the app) served by one Python file, `serve.py`, from `app/`. Read `README.md` first for what each part does.

## Run it
- `python serve.py` serves the app at http://127.0.0.1:8765 (open it in a browser). No build step: edit a `.js`
  file in `app/` and reload the page.
- `python serve.py app` opens it in its own window (needs `pip install pywebview`).
- Checks: several modules have `console.assert` self-checks that run when the page loads, so open the browser console
  after a change and look for `Assertion failed`. Check a file's syntax with `node --check app/<file>.js`.

## Where things are
| File (in `app/` unless named) | What it does |
|---|---|
| `index.html`, `app.js` | page, tabs, passive tree drawing, build storage |
| `calc.js` | character sheet and skill damage |
| `charpanel.js` | character panel and skill tooltip |
| `items.js` | item bases, modifiers, parsing an item copied in the game (Ctrl+C) |
| `skills.js`, `skilldata.js` | skills tab, gem and support data |
| `optimize.js`, `optview.js`, `trade.js` | optimizer and gear search on the official trade site |
| `loot.js`, `settings.js` | equipment comparison and price check over the game, settings |
| `filter.js` | loot filter creator |
| `scene.js`, `scenefx.js`, `skillfx.js`, `enemies.js`, `models/wolf.glb` | 3D simulator |
| `humanoid.js`, `models/mannequin.glb`, `models/moves.json` | the simulator's player figure: the mannequin with its run, roll and fall (Quaternius' Universal Animation Library, CC0), its blows, shots, throws and casts (moves of KayKit's Adventurers, CC0, as turns of the figure's joints), and the app's own poses for the rest |
| `share.js` | Path of Building 2 codes and links |
| `i18n.js`, `i18n/*.json` | UI translations |
| `three/` | three.js r160 (MIT) as the simulator uses it: the minified module and the addons it imports, as published on npm |
| `serve.py` (root) | local server, trade site proxy, clipboard, overlay window, the app window |
| `poe2_data/available/` (root) | the game data the app reads (generated, in the repo) |
| `poe2_data/_tool/` (root) | the scripts that generate it from the installed game (see `poe2_data/README.md`) |
| `packaging/` (root) | `build_app.py` and `installer.iss`: the exe, the portable zip and the installer |
| `tools/moves.py` (root) | makes `models/moves.json` from KayKit's files |

## Rules
- **Numbers come from the game.** Every value (stats, formulas, ranges, colours, sizes) comes from the game's own
  tables in `poe2_data/` or from Path of Building 2's data. Never make one up; if a table does not say it, write a
  `note:` comment saying where the value came from.
- **Ten languages.** Every new piece of UI text is written in English in the code and added, translated, to all nine
  files in `app/i18n/` (pt, es, fr, de, ru, ja, ko, th, zh), using the game's own terms in each language. Game names
  (items, gems, passives) come translated from the data (`name_<lang>`), never from `i18n/`.
- **Generated files are not edited by hand.** Change the script in `poe2_data/_tool/` and regenerate.
- **One key press, one action.** The app never reads the game's memory or screen and never sends input on its own,
  following GGG's rules for third-party tools.
- **Security is not traded for convenience** (see Security below).
- Keep it small: plain JavaScript and the standard library, no new dependencies.
- Code, comments and commit messages are in English.

## Security
The app runs on people's own computers, next to their game and their files. No change may weaken any of this; if a
task seems to need it, stop and ask the maintainer first.
- **Local only.** The server listens on `127.0.0.1`, never on another interface.
- **Only its own page is answered.** `do_GET` and `do_POST` begin with `Handler.mine()` (Host, Origin and
  Sec-Fetch-Site). A new endpoint goes behind it. No CORS headers.
- **No code in the markup.** The page goes with a Content-Security-Policy (`policy` in `serve.py`): only the server's
  own scripts and the inline ones of `index.html` (by their hash) run. Never `'unsafe-inline'` or `'unsafe-eval'` for
  scripts, never another host. So `onclick=""`, `onerror=""` and the like do not run: use listeners (a picture that may
  be missing gets `data-may-miss`), and nothing is loaded from a CDN.
- **What comes from outside is data, never code**: an imported build or code, the trade site's and poe2scout's
  answers, the clipboard. It goes through `clean()` (`app.js`) and `esc()` before it is markup; no `eval`, no
  `new Function`. A build the page cannot show is not kept (`addBuild`).
- **Files the server writes** have a fixed folder and extension and a checked name. No endpoint reads, writes or runs a
  path the page gives.
- **What goes out** goes to the fixed hosts in `serve.py` only, never to an address the page gives whole, and never
  with an account's cookie, session, password or token.
- **The updater** takes only `Exilewright-setup.exe` from this repository's releases, over HTTPS, when the user asks.
- **The app's window** exposes nothing of Python to the page (no `js_api`).
- **The build's packages** stay at the versions of `packaging/requirements.txt`; raise them on purpose.
- **No secrets** (tokens, keys, e-mail addresses) in a commit.

`checks()` in `serve.py` runs at every start and stops the server when the policy or `mine()` is weakened; `clean` and
`onSet` have `console.assert` checks of their own. When one fails, fix the change, never the check.
