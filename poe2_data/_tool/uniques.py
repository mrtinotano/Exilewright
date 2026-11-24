"""Which mods each unique has. The game client has every unique mod (Mods.GenerationType 3) but not the unique -> mods
link (server side), so that link comes from poe2db.tw pages; each mod is then matched to the game's own Mods row by
family + stats + value ranges. Anything that doesn't match exactly is listed as unmatched, never guessed.
Pages are cached in ../poe2db_cache so re-runs don't hit the site. Writes ../available/unique_items.json
Usage: python -I uniques.py"""
import html, json, os, re, time, urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
CACHE = os.path.join(ROOT, 'poe2db_cache')
os.makedirs(CACHE, exist_ok=True)
load = lambda t: json.load(open(os.path.join(ROOT, 'tables', 'English', t + '.json'), encoding='utf8'))


def get(page):
    f = os.path.join(CACHE, re.sub(r'[^\w.-]', '_', page) + '.html')
    if not os.path.exists(f) or time.time() - os.path.getmtime(f) > 7 * 86400:  # re-read after a week: patches change uniques
        req = urllib.request.Request('https://poe2db.tw/us/' + page, headers={'User-Agent': 'Mozilla/5.0 (personal build planner)'})
        data = urllib.request.urlopen(req, timeout=30).read()
        open(f, 'wb').write(data)
        time.sleep(1)  # be gentle with the site
    return open(f, encoding='utf8').read()


text = lambda s: html.unescape(re.sub(r'<[^>]+>', '', s)).strip()
norm = lambda s: re.sub(r'\s+', ' ', s.replace('_', ' ')).strip().lower()

stats, fams, mods = load('Stats'), load('ModFamily'), load('Mods')
by_family = {}
for m in mods:
    if m['GenerationType'] == 3:
        for f in m['Families']:
            by_family.setdefault(fams[f]['Id'], []).append(m)
mod_stats = lambda m: {norm(stats[m[f'Stat{k}']]['Id']): tuple(m[f'Stat{k}Value']) for k in range(1, 9) if m[f'Stat{k}'] is not None}

base_implicits = {}
for b in load('BaseItemTypes'):  # poe2db also lists the base implicit among the unique's mods; the base already gives it
    base_implicits.setdefault(b['Name'], set()).update(mods[i]['Id'] for i in b['Implicit_Mods'])
names = {u['name']: u for u in json.load(open(os.path.join(ROOT, 'available', 'uniques.json'), encoding='utf8')) if not u['hidden_in_stash_tab']}
# and only those GGG's trade site lists for the live patch, with their base (written by available.py)
live = json.load(open(os.path.join(CACHE, 'trade2_uniques.json'), encoding='utf8'))
obtainable = names.keys() & live.keys()
listing = get('Unique_item')
# the list page writes a unique in two ways: <a href="/us/Page"><span class="uniqueName">Name</span> ..., and <a href="Page">Name</a> ...
entries = dict.fromkeys(re.findall(r'href="(?:/us/)?([^"]+)"[^>]*>(?:<span class="uniqueName">)?([^<]+)(?:</span>)?(?:</a>)? <span class="uniqueTypeLine">([^<]+)</span>', listing))
# the newest uniques are not on it yet but have their own page: the base comes from the trade list
for name in sorted(obtainable - {html.unescape(n) for _, n, _ in entries}):
    entries[(re.sub(r"[^\w ]", '', name).replace(' ', '_'), name, None)] = None

out, total, matched = [], 0, 0
for page, name, _ in entries:
    name = html.unescape(name)
    if name not in obtainable:
        continue
    base = live[name]   # GGG's own name for the base: poe2db's can be out of date
    try:
        doc = get(page)
    except urllib.error.HTTPError:   # no page for it: left out, never guessed
        continue
    found, unmatched = [], []
    for header, table in re.findall(r'<h5 class="card-header">((?:(?!</h5>).)*)</h5>\s*<table[^>]*>(.*?)</table>', doc, re.S):
        row = dict((text(k), v) for k, v in re.findall(r'<tr><th>(.*?)(?:</th>)?<td>(.*?)(?=<tr>|$)', table, re.S))  # poe2db omits closing tags
        if 'Unique (3)' not in text(row.get('GenerationType', '')):
            continue
        total += 1
        want = {}
        for li in re.findall(r'<li>(.*?)</li>', row.get('Stats', ''), re.S):
            nums = [int(n) for n in re.findall(r'-?\d+', text(re.search(r'<span class="badge bg-primary">(.*?)</span>\s*(?:<span class="badge bg-secondary"|$)', li, re.S).group(1)))]
            want[norm(text(li.split('<span')[0]))] = (nums[0], nums[-1])
        cands = [m for m in by_family.get(text(row.get('Family', '')), []) if mod_stats(m) == want]
        if len(cands) >= 1 and len({json.dumps(mod_stats(c)) for c in cands}) == 1:  # same stats/values: any of them is the same mod
            m = cands[0]
            if m['Id'] in base_implicits.get(base, ()):
                total -= 1; continue
            found.append({'id': m['Id'], 'text': text(header),
                          'stats': [[stats[m[f'Stat{k}']]['Id'], *m[f'Stat{k}Value']] for k in range(1, 9) if m[f'Stat{k}'] is not None]})
            matched += 1
        else:
            unmatched.append(text(header))
    # a gloves' page also lists it as Fists of Stone (the Martial Artist's Way of the Stonefist), implicits first: those
    # modifiers apart, without the implicits (the transformed base's own: available.py)
    cut = next((i for i, m in enumerate(found) if m['id'].startswith('HandWraps')), len(found))
    fists = [m for m in found[cut:] if not m['id'].startswith('HandWrapsImplicit')]
    out.append({**{k: v for k, v in names[name].items() if k.startswith('name')}, 'base': base, 'mods': found[:cut], 'unmatched': unmatched, **({'stonefist': fists} if fists else {})})   # name, name_es...

with open(os.path.join(ROOT, 'available', 'unique_items.json'), 'w', encoding='utf8') as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
print(f'{len(out)} uniques, {matched}/{total} mods matched to game data')
