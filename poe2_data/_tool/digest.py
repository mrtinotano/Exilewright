"""Human-readable digest of build-relevant mechanics -> ../digest/*.md
Usage: python -I digest.py   (after available.py)"""
import json, os, re

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SD = os.path.join(ROOT, 'files', 'data', 'statdescriptions')
OUT = os.path.join(ROOT, 'digest')


def load(t):
    with open(os.path.join(ROOT, 'tables', 'English', t + '.json'), encoding='utf8') as f:
        return json.load(f)


def avail(n):
    with open(os.path.join(ROOT, 'available', n), encoding='utf8') as f:
        return json.load(f)


# --- stat description templates: {tuple(stat ids): [(conds, text, handlers)]}, English only
TPL = {}
LINE = re.compile(r'^\s*(.*?)\s*"(.*)"\s*(.*)$')


def parse_csd(path):
    lines = open(path, encoding='utf8', errors='replace').read().splitlines()
    i = 0
    while i < len(lines):
        if lines[i].strip() != 'description':
            i += 1
            continue
        ids = tuple(lines[i + 1].split()[1:])
        n = int(lines[i + 2].strip())
        variants = []
        for ln in lines[i + 3:i + 3 + n]:
            m = LINE.match(ln)
            if m:
                variants.append((m.group(1).split(), m.group(2), m.group(3)))
        TPL.setdefault(ids, variants)
        i += 3 + n


for f in ('passive_skill_stat_descriptions.csd', 'stat_descriptions.csd', 'gem_stat_descriptions.csd',
          'skill_stat_descriptions.csd', 'meta_gem_stat_descriptions.csd', 'active_skill_gem_stat_descriptions.csd'):
    p = os.path.join(SD, f)
    if os.path.exists(p):
        parse_csd(p)
BY_STAT = {}
for ids in TPL:
    for s in ids:
        BY_STAT.setdefault(s, ids)


def in_range(cond, v):
    if cond in ('#', '#|#'):
        return True
    if cond.startswith('!'):
        return v != int(cond[1:])
    lo, _, hi = cond.partition('|') if '|' in cond else (cond, '', cond)
    return (lo == '#' or v >= int(lo)) and (hi == '#' or v <= int(hi))


def describe(stats):
    """stats: {stat_id: value} -> list of English lines (note: approximate formatting, ignores most handlers)."""
    out, done = [], set()
    for s in stats:
        if s in done:
            continue
        ids = BY_STAT.get(s)
        if not ids:
            out.append(f'{s} = {stats[s]}')
            continue
        vals = [stats.get(x, 0) for x in ids]
        vals = [v[0] if isinstance(v, list) else v for v in vals]
        done.update(ids)
        for conds, text, handlers in TPL[ids]:
            if all(in_range(c, v) for c, v in zip(conds, vals)):
                v2 = list(vals)
                for m in re.finditer(r'negate (\d)', handlers):
                    v2[int(m.group(1)) - 1] = -v2[int(m.group(1)) - 1]
                for m in re.finditer(r'(?:divide_by_one_hundred|per_minute_to_per_second|milliseconds_to_seconds)\w* (\d)', handlers):
                    k = int(m.group(1)) - 1
                    v2[k] = round(v2[k] / (60 if 'minute' in m.group(0) else 1000 if 'milli' in m.group(0) else 100), 2)
                t = re.sub(r'\{(\d)(?::([^}]*))?\}', lambda m: (('+' if m.group(2) == '+d' and v2[int(m.group(1))] >= 0 else '') + str(v2[int(m.group(1))])), text)
                out.append(re.sub(r'\[([^|\]]*\|)?([^\]]*)\]', r'\2', t).replace('\\n', ' / '))
                break
    return out


os.makedirs(OUT, exist_ok=True)


def write(name, lines):
    with open(os.path.join(OUT, name), 'w', encoding='utf8') as f:
        f.write('\n'.join(lines))
    print(name, len(lines))


# --- passives
tree = avail('passive_tree.json')['nodes']
reminder = load('ReminderText')
clean = lambda t: re.sub(r'\[([^|\]]*\|)?([^\]]*)\]', r'\2', t or '').replace('\n', ' ')
rem_by_id = {x['Id']: [clean(reminder[r]['Text']) for r in x['ReminderStrings']] for x in load('PassiveSkills')}
key, asc, notab = [], {}, []
for n in tree.values():
    txt = '; '.join(describe(n['stats']) + [f'({r})' for r in rem_by_id.get(n['id'], [])]) + (f" [grants skill: {n['grants_skill']}]" if n['grants_skill'] else '')
    row = f"- **{n['name']}** — {txt}"
    if n['ascendancy']:
        if n['type'] in ('notable', 'keystone') or n['grants_skill']:
            asc.setdefault(n['ascendancy'], []).append(row)
    elif n['type'] == 'keystone':
        key.append(row)
    elif n['type'] == 'notable':
        notab.append(row)
write('keystones.md', ['# Keystones'] + sorted(key))
write('ascendancies.md', ['# Ascendancy notables'] + [l for a in sorted(asc) for l in [f'\n## {a}'] + sorted(asc[a])])
write('notables.md', ['# Notables'] + sorted(set(notab)))

# --- gems
skill_gems, gem_effects, active = load('SkillGems'), load('GemEffects'), load('ActiveSkills')
act_by_ge = {a['GrantedEffect']: a for a in active if a['GrantedEffect'] is not None}
grants = load('GrantedEffects')
rows = {}
for g in avail('gems.json'):
    if g['source'] == 'unconfirmed':
        continue
    desc = []
    for e in skill_gems[g['skill_gems_index']]['GemEffects']:
        ge = gem_effects[e]
        if g['kind'] == 'support':
            desc.append(ge['SupportText'] or '')
        else:
            a = act_by_ge.get(ge['GrantedEffect']) or (active[grants[ge['GrantedEffect']]['ActiveSkill']] if grants[ge['GrantedEffect']]['ActiveSkill'] is not None else None)
            desc.append((a or {}).get('Description') or '')
    d = ' / '.join(x for x in desc if x).replace('\n', ' ')
    d = re.sub(r'\[([^|\]]*\|)?([^\]]*)\]', r'\2', d)
    rows.setdefault(g['kind'], []).append(f"- **{g['name']}** ({g['source']}, tier {g['tier']}; {', '.join(g['tags'])}) — {d}")
for k, v in rows.items():
    write(f'gems_{k}.md', [f'# {k} gems'] + sorted(set(v)))
