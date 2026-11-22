"""The Vaal (mutated) modifiers each unique can get from an Architect's Orb: the game's Incursion2MutatedUniqueModsClient
lists the unique modifiers that can be replaced, and its UniqueMutatedVaal* Mods rows are the replacements, but which
unique can get which is server side: poe2db's unique pages list them (as text). Each text is matched to its Mods row by
its stat text (stat_texts.json) and, between rows of the same text, by its numbers; anything else is left out, never
guessed. Reads the pages uniques.py cached (no download). Adds to ../available/unique_items.json, per unique:
"mutated": [{id, text, stats}] and "replaceable": [its modifier ids an Architect's Orb can replace].
Usage: python -I mutated.py (after uniques.py)"""
import html, json, os, re

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
load = lambda t: json.load(open(os.path.join(ROOT, 'tables', 'English', t + '.json'), encoding='utf8'))
stats, mods = load('Stats'), load('Mods')
original = {mods[i]['Id'] for i in load('Incursion2MutatedUniqueModsClient')[0]['Mods']}
NUM = r'\(?[+-]?\d+(?:\.\d+)?(?:\s*[—–-]\s*[+-]?\d+(?:\.\d+)?)?\)?'
norm = lambda s: re.sub(r'\s+', ' ', re.sub(r'[+-]?#', '#', re.sub(NUM, '#', re.sub(r'(?i)\bglobal\s+', '', s.replace('\\n', ' '))))).strip().lower()   # the site's "Global" is not in the game's text; the game's text has "\n"
plain = lambda t: re.sub(r'\{\d*[^}]*\}', '#', re.sub(r'\[(?:[^\]|]*\|)?([^\]]*)\]', r'\1', t))
nums = lambda s: [tuple(float(x) for x in re.findall(r'[+-]?\d+(?:\.\d+)?', g)) for g in re.findall(NUM, s)]

rows = {}   # stat id -> the stat_texts rows that show it: (their stats, the row)
for r in json.load(open(os.path.join(ROOT, 'available', 'stat_texts.json'), encoding='utf8')):
    for s in r['stats']:
        rows.setdefault(s, []).extend((r['stats'], x) for x in r['rows'])
mod_stats = lambda m: [[stats[m[f'Stat{k}']]['Id'], *m[f'Stat{k}Value']] for k in range(1, 9) if m[f'Stat{k}'] is not None]
mutant = [m for m in mods if m['Id'].startswith('UniqueMutatedVaal')]
KEYSTONE = {p['Name'].lower(): {stats[i]['Id'] for i in p['Stats']} for p in load('PassiveSkills') if p.get('IsKeystone')}   # a keystone shows as its name
SHOW = {'negate': -1, 'per_minute_to_per_second': 1 / 60, 'divide_by_one_hundred': .01, 'divide_by_ten': .1, 'milliseconds_to_seconds': .001, 'double': 2}


def shown(m, stat_ids, row):
    """the numbers the row shows for the mod (its handlers: name, then the 1-based value they act on)"""
    have, k = {s[0]: s[1:] for s in mod_stats(m)}, {}
    h = row['h']
    for i, x in enumerate(h):
        if not str(x).isdigit():
            f = next((v for n, v in SHOW.items() if str(x).startswith(n)), 1)
            idx = int(h[i + 1]) if i + 1 < len(h) and str(h[i + 1]).isdigit() else 1
            k[idx] = k.get(idx, 1) * f
    out = []
    for i, s in enumerate(stat_ids, 1):
        if s in have and '{%d' % (i - 1) in row['t']:
            lo, hi = (round(abs(v * k.get(i, 1)), 2) for v in have[s])
            out += [lo] if lo == hi else [lo, hi]
    return sorted(out)


def within(a, b):   # every number of a among b's (the text's own numbers, as '2 additional', are b's too)
    b = list(b)
    return all(x in b and not b.remove(x) for x in a)


def match(text):
    t, n = norm(text), sorted(round(abs(x), 2) for g in nums(text) for x in g)
    cands = [m for m in mutant if any(norm(plain(row['t'])) == t for s in mod_stats(m) for _, row in rows.get(s[0], ()))] or [m for m in mutant if any(s[0] in KEYSTONE.get(text.strip().lower(), ()) for s in mod_stats(m))]
    if len({json.dumps(mod_stats(c)) for c in cands}) > 1:   # same text, other numbers: the row with the page's
        fit = lambda ok: [m for m in cands if any(norm(plain(row['t'])) == t and ok(shown(m, ids, row)) for s in mod_stats(m) for ids, row in rows.get(s[0], ()))]
        cands = fit(lambda x: x == n) or fit(lambda x: within(x, n))
    return cands[0] if len({json.dumps(mod_stats(c)) for c in cands}) == 1 else None


path = os.path.join(ROOT, 'available', 'unique_items.json')
uniques = json.load(open(path, encoding='utf8'))
found = missed = 0
for u in uniques:
    f = os.path.join(ROOT, 'poe2db_cache', re.sub(r'[^\w.-]', '_', re.sub(r"[^\w ]", '', u['name']).replace(' ', '_')) + '.html')
    doc = open(f, encoding='utf8').read() if os.path.exists(f) else ''
    out = []
    for b in re.findall(r'<div class="poe2 mutatedMod"><div>(.*?)</div>', doc, re.S):
        text = re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', '', re.sub(r'<br\s*/?>', ' ', b)))).strip()
        m = match(text)
        if m: out.append({'id': m['Id'], 'text': text, 'stats': mod_stats(m)}); found += 1
        else: missed += 1; print('not matched:', u['name'], '|', text)
    u.pop('mutated', None); u.pop('replaceable', None)
    if out: u['mutated'], u['replaceable'] = out, [m['id'] for m in u['mods'] if m['id'] in original]
json.dump(uniques, open(path, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
print(f'{found} mutated modifiers matched, {missed} not; {sum(1 for u in uniques if u.get("mutated"))} uniques')
