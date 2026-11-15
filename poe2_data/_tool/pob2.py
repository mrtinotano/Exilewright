"""What the game's tables do not say, read from Path of Building 2's data (generated from the same tables -
"(c) Grinding Gear Games" - plus its own reading of them):
- ../available/pob2.json: for every support gem, what each of its stats does to the calculation (Damage MORE, Speed
  INC, a NeverCrit flag...), so calc.js need not guess it from the stat id.
- ../available/trade_mods.json: for every item modifier of items.json and unique_items.json, its English name and the
  number the official trade site gives each of its lines (the gear search, trade.js).
Everything else (gems per level, character constants, monsters) comes from the game itself: available.py.
Files are cached in ../pob2_cache so re-runs don't hit GitHub.
Usage: python -I pob2.py, after available.py and uniques.py"""
import json, os, re, time, urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
CACHE = os.path.join(ROOT, 'pob2_cache')
URL = 'https://raw.githubusercontent.com/PathOfBuildingCommunity/PathOfBuilding-PoE2/dev/src/Data/'
os.makedirs(CACHE, exist_ok=True)


def get(path):
    f = os.path.join(CACHE, path.replace('../', '').replace('/', '_'))
    if not os.path.exists(f) or time.time() - os.path.getmtime(f) > 7 * 86400:  # re-read after a week: patches change gems and modifiers
        req = urllib.request.Request(URL + path, headers={'User-Agent': 'Mozilla/5.0 (personal build planner)'})
        open(f, 'wb').write(urllib.request.urlopen(req, timeout=60).read())
    return open(f, encoding='utf8').read()


FUNC = re.compile(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|--[^\n]*|\b(function|if|do|end)\b')


class Lua:
    """Just enough Lua to read the generated data tables: nested tables, strings, numbers, booleans; calls are skipped."""

    def __init__(self, src, at=0):
        self.s, self.i = src, at

    def ws(self):
        s = self.s
        while self.i < len(s):
            if s[self.i].isspace():
                self.i += 1
            elif s.startswith('--', self.i):
                self.i = s.find('\n', self.i) % (len(s) + 1)
            else:
                break

    def string(self):
        s, j = self.s, self.i + 1
        out = []
        while s[j] != '"':
            if s[j] == '\\':
                j += 1
                out.append({'n': '\n', 't': '\t'}.get(s[j], s[j]))
            else:
                out.append(s[j])
            j += 1
        self.i = j + 1
        return ''.join(out)

    def call(self):  # skip a balanced (...) argument list
        depth = 0
        while True:
            c = self.s[self.i]
            if c == '"':
                self.string()
                continue
            depth += (c == '(') - (c == ')')
            self.i += 1
            if not depth:
                return None

    def function(self):  # skip a function ... end body (the calculation hooks Path of Building adds to some skills)
        depth = 0
        while True:
            m = FUNC.search(self.s, self.i)
            self.i = m.end()
            if m.group(1):
                depth += -1 if m.group(1) == 'end' else 1
                if not depth:
                    return None

    def value(self):
        self.ws()
        s, c = self.s, self.s[self.i]
        if s.startswith('function', self.i):
            return self.function()
        if c == '{':
            return self.table()
        if c == '"':
            return self.string()
        m = re.compile(r'-?(?:\d+\.?\d*(?:e[+-]?\d+)?|\.\d+)(?:\s*/\s*\d+\.?\d*)?').match(s, self.i)  # a number, or a plain a/b
        if m:
            self.i = m.end()
            a, _, b = m.group().partition('/')
            n = float(a) / float(b or 1)
            return int(n) if n == int(n) else round(n, 6)
        m = re.compile(r'[A-Za-z_][\w.]*').match(s, self.i)
        self.i = m.end()
        self.ws()
        if self.i < len(s) and s[self.i] == '(':
            return self.call()
        return {'true': True, 'false': False, 'nil': None}.get(m.group(), m.group().split('.')[-1])

    def table(self):
        s, keyed, arr = self.s, {}, []
        self.i += 1
        while True:
            self.ws()
            if s[self.i] == '}':
                self.i += 1
                break
            m = re.compile(r'([A-Za-z_]\w*)\s*=(?!=)').match(s, self.i)
            if s[self.i] == '[':
                self.i += 1
                k = self.value()
                self.ws()
                self.i = s.index('=', self.i) + 1
                keyed[k] = self.value()
            elif m:
                self.i = m.end()
                keyed[m.group(1)] = self.value()
            else:
                arr.append(self.value())
            self.ws()
            if s[self.i] in ',;':
                self.i += 1
        if not keyed:
            return arr
        keyed.update({i + 1: v for i, v in enumerate(arr)})
        return keyed


def entries(src, var):
    """(id, table, position) for every `var["id"] = {...}` in a file."""
    for m in re.finditer(r'^' + var + r'\["([^"]+)"\]\s*=\s*(?=\{)', src, re.M):
        yield m.group(1), Lua(src, m.end()).value(), m.start()


dump = lambda o, name: json.dump(o, open(os.path.join(ROOT, 'available', name), 'w', encoding='utf8'), ensure_ascii=False, separators=(',', ':'))

# ---- support gems ---------------------------------------------------------------------------------------------------
# What a support gives the skill it is socketed in (supports have one level per tier): its description, and its stats.
# Where Path of Building 2 says what a stat does to the calculation (the support's own statMap, else SkillStatMap.lua:
# Damage MORE, Speed INC, a NeverCrit flag...) the stat is written as that mod - [name, MORE|INC|BASE|FLAG, value, flags,
# conditional] - so calc.js need not guess it from the stat id; conditional = only under a condition (enemy on low
# life, a buff being up...), which the app cannot assume. The stats it has no reading for keep their game id.
STAT_MAP = r'^%s\["([^"]+)"\] = \{\n(.*?)^%s\},'
MOD = re.compile(r'^\t+(mod|flag)\("(\w+)"(?:, "(\w+)", (nil|-?[\d.]+))?(.*)$', re.M)


def reading(body, val):
    div, mult = (re.search(r'^\t+' + k + r' = (-?[\d.]+)', body, re.M) for k in ('div', 'mult'))
    for call, name, kind, fixed, rest in MOD.findall(body):
        if call == 'mod' and not kind:  # a list of minion mods, a granted skill...: nothing the app calculates
            continue
        x = 1 if call == 'flag' else float(fixed) if fixed != 'nil' else val
        if not isinstance(x, (int, float)):
            continue
        x = x / float(div.group(1) if div else 1) * float(mult.group(1) if mult else 1)
        flags = sorted({f.lower() for f in re.findall(r'(?:ModFlag|KeywordFlag)\.(\w+)', rest)})
        yield [name, kind or 'FLAG', int(x) if x == int(x) else round(x, 4), flags, 1 if 'type = ' in rest else 0]


shared = dict(re.findall(STAT_MAP % ('', ''), get('SkillStatMap.lua'), re.M | re.S))
support_names = {g['name'] for g in json.load(open(os.path.join(ROOT, 'available', 'gems.json'), encoding='utf8')) if g['kind'] == 'support'}
supports = {}
for path in ('Skills/sup_str.lua', 'Skills/sup_dex.lua', 'Skills/sup_int.lua'):
    src = get(path)
    found = list(entries(src, 'skills'))
    for n, (sid, s, pos) in enumerate(found):
        name = s.get('name')
        if not s.get('support') or name not in support_names or name in supports:
            continue
        sets = s.get('statSets') or {}
        st = (sets.get(1) if isinstance(sets, dict) else sets[0] if sets else None) or {}
        lv = st.get('levels') or {}
        lv = (lv.get(1) if isinstance(lv, dict) else lv[0] if lv else None) or {}
        lv = lv if isinstance(lv, dict) else {i + 1: v for i, v in enumerate(lv)}
        stats = {a: b for a, b in (st.get('constantStats') or [])}
        stats.update({stat: lv.get(i + 1, 1) for i, stat in enumerate(st.get('stats') or [])})  # no number: a flag
        text = src[pos:found[n + 1][2] if n + 1 < len(found) else len(src)]
        text = text[text.find('statMap = {'):text.find('baseFlags = {')] if 'statMap = {' in text else ''
        own = dict(re.findall(STAT_MAP % ('\t' * 4, '\t' * 4), text, re.M | re.S))
        mods = [m for stat in list(stats) if stat in own or stat in shared for m in reading(own.get(stat, shared.get(stat)), stats.pop(stat))]
        supports[name] = {k: v for k, v in {'text': s.get('description'), 'stats': stats, 'mods': mods}.items() if v}

dump({'source': 'Path of Building 2 (Skills/sup_*.lua, SkillStatMap.lua) - game data (c) Grinding Gear Games', 'supports': {k: supports[k] for k in sorted(supports)}}, 'pob2.json')
print(f'{len(supports)} of {len(support_names)} supports with stats; without: {", ".join(sorted(support_names - set(supports))[:15])}')

# The trade site's stat of every modifier line. ModItem.lua / ModItemExclusive.lua, one modifier per row:
#   ["Strength1"] = { type = "Suffix", affix = "of the Brute", "+(5-8) to Strength", ..., tradeHashes = { [4080418644] = { "+(5-8) to Strength" }, } },
# -> id: [English name, [hash, lo, hi, lo, hi...] per line]: the site's stat is "explicit.stat_<hash>" and the numbers
# are those the line shows, in order ("(5-8)" is a roll, a bare number is fixed).
ROW = re.compile(r'^\t\["([^"]+)"\] = \{ (?:type = "\w+", )?affix = "([^"]*)".*?tradeHashes = \{ (.*?)\} \},?$', re.M)
SHOWN = re.compile(r'\((-?[\d.]+)-(-?[\d.]+)\)|(-?\d+(?:\.\d+)?)')
used = {a['id'] for a in json.load(open(os.path.join(ROOT, 'available', 'items.json'), encoding='utf8'))['affixes']}
used |= {m['id'] for u in json.load(open(os.path.join(ROOT, 'available', 'unique_items.json'), encoding='utf8')) for m in u['mods']}
num = lambda x: int(float(x)) if float(x) == int(float(x)) else float(x)
trade = {}
for path in ('ModItem.lua', 'ModItemExclusive.lua'):
    for mod, name, hashes in ROW.findall(get(path)):
        if mod in used:
            trade[mod] = [name] + [[int(h)] + [num(x) for a, b, c in SHOWN.findall(' '.join(re.findall(r'"((?:[^"\\]|\\.)*)"', lines))) for x in ((a, b) if a else (c, c))]
                                   for h, lines in re.findall(r'\[(\d+)\] = \{ (.*?) \},', hashes)]
dump({'source': 'Path of Building 2 game-data export (Mods, trade stat hashes) - (c) Grinding Gear Games', 'mods': {k: trade[k] for k in sorted(trade)}}, 'trade_mods.json')
print(f'{len(trade)} of {len(used)} item modifiers with their trade site stat; without: {", ".join(sorted(used - set(trade))[:15])}')
