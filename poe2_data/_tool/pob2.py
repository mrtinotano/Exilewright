"""Game data the Mac cannot extract (no game install), read from Path of Building 2's export of the game's own tables
(MonsterVarieties, GrantedEffects*, DefaultMonsterStats, GameConstants, character.ot - "(c) Grinding Gear Games"):
- ../available/monsters.json: every monster with its real multipliers, resistances and skills, plus the per-level
  tables that turn those multipliers into life, armour, evasion, accuracy and damage (the enemies of the 3D scene).
- ../available/pob2.json: what available.py puts in skills.json on Windows and is missing until then: the stats of
  every gem per level, the cast times and the character constants. The app only uses it where skills.json has nothing.
- ../available/trade_mods.json: for every item modifier of items.json and unique_items.json, its English name and the
  number the official trade site gives each of its lines (the gear search, trade.js).
Files are cached in ../pob2_cache so re-runs don't hit GitHub.
Usage: python -I pob2.py"""
import json, os, re, time, urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
CACHE = os.path.join(ROOT, 'pob2_cache')
URL = 'https://raw.githubusercontent.com/PathOfBuildingCommunity/PathOfBuilding-PoE2/dev/src/Data/'
os.makedirs(CACHE, exist_ok=True)


def get(path):
    f = os.path.join(CACHE, path.replace('../', '').replace('/', '_'))
    if not os.path.exists(f) or time.time() - os.path.getmtime(f) > 7 * 86400:  # re-read after a week: patches change monsters
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


def assigned(src, name):
    return Lua(src, re.search(r'^data\.' + name + r'\s*=\s*(?=\{)', src, re.M).end()).value()


# ---- skills -------------------------------------------------------------------------------------------------------
ELEMENTS = ('physical', 'fire', 'cold', 'lightning', 'chaos')
KEEP = re.compile(r'area_of_effect|radius|number_of_(?:additional_)?projectiles|number_of_chains|base_skill_effect_duration|'
                  r'chance_to_(?:poison|bleed)|ignite_chance|shock_chance|freeze|maim|knockback|_damage_\+%_final')
skills = {}
for path in ('Skills/minion.lua', 'Skills/spectre.lua'):  # the monster skills win over a minion skill with the same id
    for sid, s, _ in entries(get(path), 'skills'):
        sets = []
        for st in (s.get('statSets') or {}).values() if isinstance(s.get('statSets'), dict) else s.get('statSets') or []:
            lv = st.get('levels') or {}
            lv = lv.get(1) if isinstance(lv, dict) else (lv[0] if lv else {})
            lv = lv or {}
            if isinstance(lv, list):
                lv = {i + 1: v for i, v in enumerate(lv)}
            interp = lv.get('statInterpolation') or []
            interp = interp if isinstance(interp, list) else [interp[k] for k in sorted(interp)]
            values = {name: (lv[i + 1], interp[i] if i < len(interp) else 1) for i, name in enumerate(st.get('stats') or []) if i + 1 in lv}
            flags_only = [name for i, name in enumerate(st.get('stats') or []) if i + 1 not in lv]
            const = dict((a, b) for a, b in (st.get('constantStats') or []))
            hit, dot, convert = {}, {}, {}
            for el in ELEMENTS:
                lo, hi = values.get(f'spell_minimum_base_{el}_damage'), values.get(f'spell_maximum_base_{el}_damage')
                if lo and hi:
                    hit[el] = [lo[0], hi[0], lo[1]]  # level-1 values + interpolation (3 = scales with the effectiveness curve)
                d = values.get(f'base_{el}_damage_to_deal_per_minute')
                if d:
                    dot[el] = [d[0], d[1]]
                c = const.get(f'active_skill_base_physical_damage_%_to_convert_to_{el}')
                if c:
                    convert[el] = c
            flags = sorted(k for k, v in (st.get('baseFlags') or {}).items() if v)
            sets.append({k: v for k, v in {
                'label': st.get('label'),
                'eff': [st.get('baseEffectiveness', 1), st.get('incrementalEffectiveness', 0), st.get('damageIncrementalEffectiveness', 0)],
                'flags': flags, 'hit': hit, 'dot': dot, 'convert': convert,
                'no_damage': 'base_deal_no_damage' in flags_only or None,
                'area': 'is_area_damage' in flags_only or None,
                'unblockable': None if ('base_skill_can_be_blocked' in flags_only or 'attack' in flags) else True,
                'const': {k: v for k, v in const.items() if KEEP.search(k)},
            }.items() if v not in (None, {}, [])})
        lv = s.get('levels') or {}
        lv = (lv.get(1) if isinstance(lv, dict) else (lv[0] if lv else {})) or {}
        skills[sid] = {k: v for k, v in {
            'name': s.get('name'),
            'types': sorted(k for k, v in (s.get('skillTypes') or {}).items() if v),
            'cast': s.get('castTime'), 'cooldown': lv.get('cooldown'), 'uses': lv.get('storedUses'),
            'crit': lv.get('critChance'), 'mult': lv.get('baseMultiplier'), 'speed': lv.get('attackSpeedMultiplier'),
            'description': s.get('description'), 'sets': sets,
        }.items() if v not in (None, [], '')}

# ---- monsters -----------------------------------------------------------------------------------------------------
src = get('Spectres.lua')
monsters, used, missing, seen = [], set(), set(), {}
for mid, m, _ in entries(src, 'minions'):
    ids = [s for s in (m.get('skillList') or []) if s in skills]
    missing.update(s for s in (m.get('skillList') or []) if s not in skills)
    used.update(ids)
    mon = {k: v for k, v in {
        'id': mid, 'name': m['name'], 'category': m.get('monsterCategory'), 'boss': 'Boss' in mid or None,
        'life': m['life'], 'es': m.get('energyShield'), 'armour': m.get('armour'), 'evasion': m.get('evasion'),
        'res': [m.get('fireResist', 0), m.get('coldResist', 0), m.get('lightningResist', 0), m.get('chaosResist', 0)],
        'damage': m['damage'], 'spread': m.get('damageSpread', 0), 'attack_time': m.get('attackTime', 1),
        'range': m.get('attackRange'), 'crit': m.get('critChance'), 'speed': m.get('baseMovementSpeed'),
        'ignores_attack_speed': m.get('baseDamageIgnoresAttackSpeed'),
        'ranged': 'ranged' in (m.get('monsterTags') or []) or None,
        'areas': m.get('spawnLocation') or None, 'skills': ids,
    }.items() if v is not None}
    same = json.dumps({k: v for k, v in mon.items() if k not in ('id', 'areas')}, sort_keys=True)
    if same in seen:  # the same monster placed in another area: one entry, all its areas
        seen[same]['areas'] = sorted(set(seen[same].get('areas', []) + mon.get('areas', [])))
        continue
    seen[same] = mon
    monsters.append(mon)
monsters.sort(key=lambda m: (m['name'], m['id']))

# ---- per-level tables and constants -------------------------------------------------------------------------------
misc = get('Misc.lua')
table = lambda name: assigned(misc, name)
game, char, mon = table('gameConstants'), table('characterConstants'), table('monsterConstants')
out = {
    'source': 'Path of Building 2 game-data export (MonsterVarieties, GrantedEffects, DefaultMonsterStats) - Monster data (c) Grinding Gear Games',
    'tables': {  # index = monster level - 1
        'life': table('monsterLifeTable'), 'damage': [round(x, 2) for x in table('monsterDamageTable')],
        'armour': table('monsterArmourTable'), 'evasion': table('monsterEvasionTable'),
        'accuracy': table('monsterAccuracyTable'),
    },
    'constants': {
        'skill_effectiveness': game['SkillDamageBaseEffectiveness'],
        'monster_crit_bonus': mon.get('base_critical_hit_damage_bonus'),
        'monster_max_resistance': mon.get('base_maximum_all_resistances_%'),
        'monster_max_physical_reduction': mon.get('maximum_physical_damage_reduction_%'),
        'player_max_resistance': char.get('base_maximum_all_resistances_%'),
        'player_max_physical_reduction': char.get('maximum_physical_damage_reduction_%'),
        'player_max_evade': game.get('DefaultMaxEvadeChancePercent'),
        'player_crit_bonus': char.get('base_critical_hit_damage_bonus'),
        'es_recharge_delay_ms': game.get('BaseShieldRegenCooldownTimeMs'),
        'es_recharge_per_minute': char.get('energy_shield_recharge_rate_per_minute_%'),
        'player_max_block': char.get('object_inherent_base_maximum_block_%_from_ot'),
        # ailments: % of the hit dealt per minute, and how long they last
        'ignite_per_minute': game.get('IgniteHitDamagePercentPerMinute'), 'ignite_duration': game.get('BaseIgniteDuration'),
        'bleed_per_minute': game.get('BleedingHitDamagePercentPerMinute'), 'bleed_duration': game.get('BaseBleedingDuration'),
        'poison_per_minute': game.get('PoisonHitDamagePercentPerMinute'), 'poison_duration': game.get('BasePoisonDuration'),
    },
    'monsters': monsters,
    'skills': {k: skills[k] for k in sorted(used)},
}
dump = lambda o, name: json.dump(o, open(os.path.join(ROOT, 'available', name), 'w', encoding='utf8'), ensure_ascii=False, separators=(',', ':'))
dump(out, 'monsters.json')
print(f'{len(monsters)} monsters ({sum(1 for m in monsters if m.get("boss"))} bosses), {len(used)} monster skills'
      + (f'; {len(missing)} monster skill ids have no data in this export' if missing else ''))

# ---- gem levels and character constants -----------------------------------------------------------------------------
# Same shape as available.py writes on Windows: per gem, cast_time_ms + constant stats + stats per gem level, with the
# row's own numbers under "_" keys. Stats that never change with the level go to "constant" to keep the file small.
names = set(json.load(open(os.path.join(ROOT, 'available', 'skills.json'), encoding='utf8'))['skills'])
gems = {}
for path in ('Skills/act_str.lua', 'Skills/act_dex.lua', 'Skills/act_int.lua', 'Skills/other.lua'):
    for sid, s, _ in entries(get(path), 'skills'):
        name = s.get('name') or ''
        name = name if name in names else name.removesuffix(' Minion')  # "Skeletal Warrior Minion" is the gem "Skeletal Warrior"
        if name not in names or name in gems and not sid.endswith('Player'):  # "<Name>Player" is the gem's own skill
            continue
        sets = s.get('statSets') or {}
        sets = [sets[k] for k in sorted(k for k in sets if isinstance(k, int))] if isinstance(sets, dict) else sets
        # the main stat set, like available.py; in skills made of several parts (Rolling Slam) it is marked as dealing
        # no damage, and the first part that does is laid over it
        idle = lambda t: 'base_deal_no_damage' in (t.get('stats') or [])
        main = sets[0] if sets else {}
        hit = next((t for t in sets if not idle(t)), main) if idle(main) else main
        const = {a: b for t in (main, hit) for a, b in (t.get('constantStats') or [])}
        rows = {}
        spell = 'Spell' in (s.get('skillTypes') or {})
        for lvl, g in (s.get('levels') or {}).items():
            if not isinstance(lvl, int):
                continue
            row, lv = {}, (hit.get('levels') or {}).get(lvl) or {}
            for t in (main, hit):
                tl = (t.get('levels') or {}).get(lvl) or {}
                row.update({stat: tl[i + 1] for i, stat in enumerate(t.get('stats') or []) if i + 1 in tl})
            for src_row in (g, lv):
                if src_row.get('baseMultiplier') is not None:
                    row['_base_multiplier'] = round(src_row['baseMultiplier'] * 10000)
                if src_row.get('critChance') is not None:
                    row['_spell_crit' if spell else '_attack_crit'] = round(src_row['critChance'] * 100)
                if src_row.get('attackSpeedMultiplier'):
                    row['active_skill_attack_speed_+%_final'] = src_row['attackSpeedMultiplier']
                if src_row.get('cooldown'):
                    row['_cooldown_ms'] = round(src_row['cooldown'] * 1000)
                    row['_stored_uses'] = src_row.get('storedUses')
                if src_row.get('spiritReservationFlat'):
                    row['_spirit'] = src_row['spiritReservationFlat']
                if src_row.get('cost'):  # channelled skills cost per minute: shown per second
                    row['_cost'] = {k.removesuffix('PerMinute'): round(v / 60, 1) if k.endswith('PerMinute') else v for k, v in src_row['cost'].items()}
            rows[lvl] = {k: v for k, v in row.items() if v is not None}
        if not rows:
            continue
        for k in set.intersection(*(set(r) for r in rows.values())):
            if all(r[k] == rows[1 if 1 in rows else min(rows)][k] for r in rows.values()):
                const[k] = next(iter(rows.values()))[k]
                for r in rows.values():
                    del r[k]
        gems[name] = {'cast_time_ms': round(s['castTime'] * 1000) if s.get('castTime') else None, 'constant': const,
                      'levels': {str(k): rows[k] for k in sorted(rows)}}

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

# character.ot. The level-1 life and mana are not in it: Path of Building 2 (CalcSetup.lua) adds 16 life and 30 mana to
# the per-level amounts, and gives 2 life per Strength, 2 mana per Intelligence and AccuracyPerDexBase per Dexterity.
acc = re.search(r'AccuracyPerDexBase\s*=\s*(\d+)', get('../Modules/Data.lua'))
pob = {
    'source': 'Path of Building 2 game-data export (GrantedEffects, GrantedEffectsPerLevel, GrantedEffectStatSetsPerLevel, character.ot) - (c) Grinding Gear Games',
    'character_stats': {
        'base_maximum_life': 16 + char['life_per_level'], 'maximum_life_per_level': char['life_per_level'],
        'base_maximum_mana': 30 + char['mana_per_level'], 'maximum_mana_per_level': char['mana_per_level'],
        'accuracy_rating_per_level': char.get('accuracy_rating_per_level'), 'base_evasion_rating': char.get('base_evasion_rating'),
        'energy_shield_recharge_rate_per_minute_%': char.get('energy_shield_recharge_rate_per_minute_%'),
        'energy_shield_delay_ms': game.get('BaseShieldRegenCooldownTimeMs'),
        'mana_regeneration_rate_per_minute_%': char.get('character_inherent_mana_regeneration_rate_per_minute_%'),
        **{f'base_maximum_{k}_damage_resistance_%': char.get('base_maximum_all_resistances_%') for k in ('fire', 'cold', 'lightning', 'chaos')},
        'base_critical_hit_damage_bonus': char.get('base_critical_hit_damage_bonus'),
        'maximum_block_%': char.get('object_inherent_base_maximum_block_%_from_ot'),
        'maximum_physical_damage_reduction_%': char.get('maximum_physical_damage_reduction_%'),
    },
    'attribute_text': {'Strength': '+2 to maximum Life', 'Intelligence': '+2 to maximum Mana',
                       **({'Dexterity': f'+{acc.group(1)} to Accuracy Rating'} if acc else {})},
    'skills': {k: gems[k] for k in sorted(gems)},
    'supports': {k: supports[k] for k in sorted(supports)},
}
dump(pob, 'pob2.json')
print(f'{len(gems)} of {len(names)} gems with levels; without: {", ".join(sorted(names - set(gems))[:15])}')
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
