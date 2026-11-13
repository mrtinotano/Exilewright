import re
"""Filter the raw dump down to what a player can actually obtain. Writes ../available/*.json.
Usage: python -I available.py   (run after extract.mjs)"""
import json, math, os, struct

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'available')
BAD = ('[DNT', '[UNUSED', 'Coming Soon', '[TEST', 'DNT-UNUSED')


def load(t, lang='English'):
    with open(os.path.join(ROOT, 'tables', lang, t + '.json'), encoding='utf8') as f:
        return json.load(f)


def ok(name):
    return bool(name) and not any(b in name for b in BAD)


def save(name, data):
    with open(os.path.join(OUT, name), 'w', encoding='utf8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print(name, len(data))


def parse_psg(path):
    """Passive tree graph: returns {node_id: [connected ids]}, class root ids and {node_id: (x, y)}."""
    d = open(path, 'rb').read()
    per_orbit = d[3:13]
    radii = (0, 82, 162, 335, 493, 662, 846, 251, 1080, 1322)  # note: PoB constants, re-check if the tree looks warped
    pos = {}
    o = 13
    n, = struct.unpack_from('<I', d, o); o += 4
    roots = [struct.unpack_from('<I', d, o + 8 * i)[0] for i in range(n)]; o += 8 * n
    groups, = struct.unpack_from('<I', d, o); o += 4
    graph = {}
    for _ in range(groups):
        gx, gy = struct.unpack_from('<ff', d, o); o += 17  # x f32, y f32, flags u32, unk u32, unk u8
        nc, = struct.unpack_from('<I', d, o); o += 4
        for _ in range(nc):
            nid, orb, idx, cc = struct.unpack_from('<IIII', d, o); o += 16
            a = 2 * math.pi * idx / per_orbit[orb]
            pos[nid] = (round(gx + radii[orb] * math.sin(a)), round(gy - radii[orb] * math.cos(a)))
            graph[nid] = [struct.unpack_from('<I', d, o + 8 * i)[0] for i in range(cc)]; o += 8 * cc
    assert o == len(d), 'psg layout changed, update parse_psg'
    return graph, roots, pos


os.makedirs(OUT, exist_ok=True)
bases, bases_es = load('BaseItemTypes'), load('BaseItemTypes', 'Spanish')
stats = load('Stats')
gem_effects, gem_tags, grants = load('GemEffects'), load('GemTags'), load('GrantedEffects')
skill_gems = load('SkillGems')
supports = load('SupportGems')
support_ids = {s['SkillGem'] for s in supports}
lineage_ids = {s['SkillGem'] for s in supports if s['IsLineage']}

# where non-cuttable skills come from; anything left over is most likely unobtainable
granted_by_passive = {p['GrantedSkill'] for p in load('PassiveSkills') if p['GrantedSkill'] is not None}
granted_by_mod = {x['Skill'] for x in load('ModGrantedSkills')}
granted_by_unique = {s for x in load('SkillGemsForUniqueStat') for s in x['SkillGems']}
granted_by_base = {s for x in load('ItemInherentSkills') for s in x['SkillsGranted']}
weapon_default = {s for x in load('CharacterMeleeSkills') for s in x['SkillGems']}

# --- gems
active_skills, skill_types = load('ActiveSkills'), [t['Id'] for t in load('ActiveSkillType')]
support_row = {s['SkillGem']: s for s in supports}
support_family = load('SupportGemFamily')
types = lambda ids: [skill_types[t] for t in ids]   # support requirements are RPN: type names plus OR / AND / NOT
ivis = load('ItemVisualIdentity')
PANEL = 'Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/'
gems = []
for i, g in enumerate(skill_gems):
    b = bases[g['BaseItemType']]
    if not ok(b['Name']):
        continue
    if g['CraftingTypes']:
        source = 'gem_cutting'          # appears in the uncut-gem menu
    elif i in lineage_ids:
        source = 'lineage_drop'
    elif i in granted_by_passive:
        source = 'passive_or_ascendancy'
    elif i in granted_by_unique:
        source = 'unique_item'
    elif i in granted_by_mod:
        source = 'item_mod'              # runes, soul cores, item affixes
    elif i in granted_by_base:
        source = 'item_base'             # e.g. sceptre/talisman base skills
    elif i in weapon_default:
        source = 'weapon_default'
    else:
        source = 'unconfirmed'           # no known source: assume NOT obtainable
    tags = sorted({gem_tags[t]['Id'] for e in g['GemEffects'] for t in gem_effects[e]['GemTags'] if gem_tags[t]['Id']})
    gems.append({
        'name': b['Name'], 'name_es': bases_es[g['BaseItemType']]['Name'], 'id': b['Id'],
        'kind': 'support' if i in support_ids else ('spirit' if g['GemType'] == 2 else 'active'),
        'tier': g['CraftingLevel'], 'source': source, 'tags': tags,
        'attr': {'str': g['StrengthRequirementPercent'], 'dex': g['DexterityRequirementPercent'], 'int': g['IntelligenceRequirementPercent']},
        'skill_gems_index': i,
    })
    ge = grants[gem_effects[g['GemEffects'][0]]['GrantedEffect']] if g['GemEffects'] else None
    # first socket of the skill panel: the gem itself, or the panel's icon for skills granted by items / ascendancy
    art = ivis[b['ItemVisualIdentity']]['DDSFile']
    gems[-1]['socket_icon'] = art if not art.lower().endswith('/blankgem.dds') else PANEL + {'passive_or_ascendancy': 'SkillPanelAscendancyIcon.dds'}.get(source, 'SkillPanelItemIcon.dds')
    if i in support_ids:
        sr = support_row[i]
        gems[-1].update(icon=sr['Icon'], family=[support_family[f]['Id'] for f in sr['Family']], lineage=sr['IsLineage'],
                        require=types(ge['AllowedActiveSkillTypes']), exclude=types(ge['ExcludedActiveSkillTypes']),
                        adds=types(ge['AddedActiveSkillTypes']), gems_only=ge['SupportsGemsOnly'])
    elif ge and ge['ActiveSkill'] is not None:
        a = active_skills[ge['ActiveSkill']]
        gems[-1].update(icon=a['Icon_DDSFile'], types=types(a['ActiveSkillTypes']), cannot_be_supported=ge['CannotBeSupported'])
save('gems.json', gems)

# --- passive tree (only nodes on the real graph, not from unused ascendancies)
graph, roots, pos = parse_psg(os.path.join(ROOT, 'files', 'metadata', 'passiveskillgraph.psg'))
asc = load('Ascendancy')
passives, passives_es = load('PassiveSkills'), {p['PassiveSkillGraphId']: p for p in load('PassiveSkills', 'Spanish')}
by_gid = {p['PassiveSkillGraphId']: p for p in passives}
nodes = {}
for gid, conns in graph.items():
    p = by_gid[gid]
    a = asc[p['Ascendancy']]['Name'] if p['Ascendancy'] is not None else None
    if not ok(p['Name']) or (a and not ok(a)):
        continue
    vals = [p[f'Stat{k}Value'] for k in range(1, 8)]
    nodes[gid] = {
        'name': p['Name'], 'name_es': passives_es.get(gid, {}).get('Name'), 'id': p['Id'],
        'type': 'keystone' if p['IsKeystone'] else 'notable' if p['IsNotable'] else 'jewel' if p['IsJewelSocket']
                else 'attribute' if p['IsAttribute'] else 'small',
        'ascendancy': a, 'ascendancy_start': p['IsAscendancyStartingNode'],
        'stats': {stats[s]['Id']: v for s, v in zip(p['Stats'], vals)},
        'grants_skill': bases[skill_gems[p['GrantedSkill']]['BaseItemType']]['Name'] if p['GrantedSkill'] is not None else None,
        'links': conns, 'x': pos[gid][0], 'y': pos[gid][1],
    }
for n in nodes.values():  # links are directed in the file; make undirected and drop removed nodes
    n['links'] = [c for c in n['links'] if c in nodes]
for gid, n in nodes.items():
    for c in n['links']:
        if gid not in nodes[c]['links']:
            nodes[c]['links'].append(gid)
# what an "Attribute" node turns into when you pick one (hidden passives the game swaps in)
attr_opts = {k: {stats[st]['Id']: p[f'Stat{i + 1}Value'] for i, st in enumerate(p['Stats'])}
             for p in passives for k in ('strength', 'dexterity', 'intelligence') if p['Id'].startswith('generic_attribute_' + k)}
save('passive_tree.json', {'class_roots': roots, 'attribute_options': attr_opts, 'nodes': {str(k): v for k, v in nodes.items()}})

# --- ascendancies / classes
chars = load('Characters')
save('ascendancies.json', [{'name': a['Name'], 'class': chars[a['Character']]['Name'] if a['Character'] is not None else None,
                            'attrs': {'str': chars[a['Character']]['BaseStrength'], 'dex': chars[a['Character']]['BaseDexterity'], 'int': chars[a['Character']]['BaseIntelligence']}
                            if a['Character'] is not None else None} for a in asc if ok(a['Name'])])

# --- uniques: what the Unique Stash Tab knows about; hidden-if-empty ones are flagged
words, layout = load('Words'), load('UniqueStashLayout')
words_es = load('Words', 'Spanish')
save('uniques.json', sorted(({'name': words[u['WordsKey']]['Text'], 'name_es': words_es[u['WordsKey']]['Text'],
                              'hidden_in_stash_tab': not (u['ShowIfEmptyStandard'] or u['ShowIfEmptyChallengeLeague'])}
                             for u in layout if u['RenamedVersion'] is None and not u['IsAlternateArt'] and ok(words[u['WordsKey']]['Text'])),
                            key=lambda x: x['name']))

# --- rollable item mods: prefix/suffix on items with some non-zero spawn weight
mods = load('Mods')
save('item_mods.json', [{'id': m['Id'], 'name': m['Name'], 'affix': 'prefix' if m['GenerationType'] == 1 else 'suffix',
                         'level': m['Level'], 'stats': [stats[m[f'Stat{k}']]['Id'] for k in range(1, 9) if m[f'Stat{k}'] is not None],
                         'values': [m[f'Stat{k}Value'] for k in range(1, 9) if m[f'Stat{k}'] is not None]}
                        for m in mods if m['Domain'] == 1 and m['GenerationType'] in (1, 2) and any(m['SpawnWeight_Values'])])

# --- stat texts (Spanish, English fallback) for stats used by passives and item mods; app formats them
def parse_csd(path, out):
    lines = open(path, encoding='utf8').read().splitlines()
    i = 0
    while i < len(lines):
        if lines[i].strip() != 'description':
            i += 1; continue
        ids = lines[i + 1].split()[1:]; i += 2
        langs = {}
        lang = 'English'
        while i < len(lines) and lines[i].strip() and lines[i].strip() != 'description' and not lines[i].startswith(('no_description', 'include')):
            s = lines[i].strip()
            if s.startswith('lang '):
                lang = s.split('"')[1]; i += 1; continue
            n = int(s); rows = []
            for r in lines[i + 1:i + 1 + n]:
                cond, text, rest = r.strip().split('"', 2)
                rows.append({'c': cond.split(), 't': text, 'h': rest.split()})
            langs[lang] = rows; i += 1 + n
            lang = 'English'
        out[' '.join(ids)] = {'stats': ids, 'rows': langs.get('Spanish') or langs['English']}

sd = os.path.join(ROOT, 'files', 'data', 'statdescriptions')
descs = {}
for f in ('stat_descriptions.csd', 'passive_skill_stat_descriptions.csd'):  # later file overrides
    parse_csd(os.path.join(sd, f), descs)
used = {s for n in nodes.values() for s in n['stats']} | {s for m in mods for k in range(1, 9) if m[f'Stat{k}'] is not None for s in [stats[m[f'Stat{k}']]['Id']]}
save('stat_texts.json', [d for d in descs.values() if used & set(d['stats'])])

# --- skill geometry for the 3D scene. Units are game units (10 = 1 m).
# radius: active_skill_base_area_of_effect_radius per gem level. Projectile speed: Projectiles.ProjectileSpeed / 10 = units/s
# (poedb: Fireball 1040 -> 104 units/s); only exact name matches, there is no table linking a player skill to its projectile.
# Player base speed: Pathfinding.base_speed in metadata/characters/character.ot (units/s).
ge_tab, gfx, ss_tab = load('GrantedEffects'), load('GemEffects'), load('GrantedEffectStatSets')
ss_lvl = {}
for r in load('GrantedEffectStatSetsPerLevel'):
    ss_lvl.setdefault(r['StatSet'], []).append(r)
proj_by_id = {p['Id'].lower(): p for p in load('Projectiles')}
sid = lambda i: stats[i]['Id']
skills = {}
for g in gems:
    if g['kind'] != 'active':
        continue
    e = ge_tab[gfx[skill_gems[g['skill_gems_index']]['GemEffects'][0]]['GrantedEffect']]
    s = ss_tab[e['StatSet']]
    const = {sid(a): v for a, v in zip(s['ConstantStats'], s['ConstantStatsValues'])}
    implicit = {sid(a) for a in s['ImplicitStats']}
    radius = {}
    for r in ss_lvl.get(e['StatSet'], []):
        per = {sid(a): v for a, v in zip(r['AdditionalStats'], r['AdditionalStatsValues'])}
        v = per.get('active_skill_base_area_of_effect_radius', const.get('active_skill_base_area_of_effect_radius'))
        if v is not None:
            radius[r['GemLevel']] = v
    p = proj_by_id.get('metadata/projectiles/' + g['name'].replace(' ', '').replace("'", '').lower())
    skills[g['name']] = {
        'radius': radius or None,
        'projectile': 'base_is_projectile' in implicit,
        'projectile_speed': p['ProjectileSpeed'] / 10 if p and 'base_is_projectile' in implicit else None,
        'projectile_range': const.get('projectile_maximum_range_override'),
        'duration_ms': const.get('base_skill_effect_duration'),
        'projectile_collision': p['CollisionRadius'] if p and 'base_is_projectile' in implicit else None,
    }
ot = open(os.path.join(ROOT, 'files', 'metadata', 'characters', 'character.ot'), encoding='utf-16').read()
base_speed = int(ot.split('Pathfinding')[1].split('base_speed')[1].split('=')[1].split()[0])
cs = {c['Id']: c['Text'] for c in load('ClientStrings')}
capacity_per = int(re.search(r'(\d+) \[Strength[^=]*= \+1 Strength \[SupportGem', cs['StrengthDescription']).group(1))
max_sockets = max(int(m.group(1)) for c in load('CurrencyItems') if (m := re.fullmatch(r'add_skill_gem_socket_(\d+)', c['Action'] or '')))
save('skills.json', {'player_base_speed': base_speed, 'support_capacity_per_attribute': capacity_per, 'max_support_sockets': max_sockets, 'skills': skills})

# --- equipment: bases (with tags inherited through the .it files), implicits and rollable affixes with spawn tags
def read_it(p, cache={}):
    """tags + parent of a metadata/items/*.it file, following 'extends'."""
    p = p.lower()
    if p not in cache:
        f = os.path.join(ROOT, 'files', p + '.it')
        tags, parent = [], None
        if os.path.exists(f):
            raw = open(f, 'rb').read()
            txt = raw.decode('utf-16') if raw[:2] == b'\xff\xfe' else raw.decode('utf8')
            for line in txt.splitlines():
                line = line.strip()
                if line.startswith('extends ') and '"nothing"' not in line:
                    parent = line.split('"')[1]
                elif line.startswith('tag = '):
                    tags.append(line.split('"')[1])
        cache[p] = tags + (read_it(parent) if parent else [])
    return cache[p]

classes, tags_tab = load('ItemClasses'), load('Tags')
SLOT_CLASSES = {  # ItemClasses.Name -> slots it can go in
    'Amulets': ['amulet'], 'Rings': ['ring1', 'ring2'], 'Belts': ['belt'], 'Gloves': ['gloves'], 'Boots': ['boots'],
    'Body Armours': ['body'], 'Helmets': ['helmet'], 'Shields': ['offhand'], 'Foci': ['offhand'], 'Bucklers': ['offhand'], 'Quivers': ['offhand'],
    **{c: ['weapon', 'offhand'] for c in ('Claws', 'Daggers', 'Wands', 'One Hand Swords', 'One Hand Axes', 'One Hand Maces', 'Sceptres', 'Spears', 'Flails')},
    'Jewels': ['jewel'], 'Life Flasks': ['flask1'], 'Mana Flasks': ['flask2'], 'Charms': ['charm1', 'charm2', 'charm3'],
    **{c: ['weapon'] for c in ('Bows', 'Staves', 'Two Hand Swords', 'Two Hand Axes', 'Two Hand Maces', 'Quarterstaves', 'Crossbows', 'Talismans')},
}
armour = {a['BaseItemType']: a for a in load('ArmourTypes')}
weapon = {w['BaseItemType']: w for w in load('WeaponTypes')}
flasks = {f['BaseItemType']: f for f in load('Flasks')}
visual = load('ItemVisualIdentity')
mods_es = load('Mods', 'Spanish')
mod_stats = lambda m: [[stats[m[f'Stat{k}']]['Id'], *m[f'Stat{k}Value']] for k in range(1, 9) if m[f'Stat{k}'] is not None]
# obtainable bases: GGG's official trade list (cached; delete the file to refresh after a patch)
trade_file = os.path.join(ROOT, 'poe2db_cache', 'trade2_items.json')
if not os.path.exists(trade_file):
    import urllib.request
    os.makedirs(os.path.dirname(trade_file), exist_ok=True)
    req = urllib.request.Request('https://www.pathofexile.com/api/trade2/data/items', headers={'User-Agent': 'Mozilla/5.0 (personal build planner)'})
    open(trade_file, 'wb').write(urllib.request.urlopen(req, timeout=30).read())
trade_types = {e['type'] for c in json.load(open(trade_file, encoding='utf8'))['result'] for e in c['entries']}
bases, implicit_ids = [], set()
for i, b in enumerate(bases_es and load('BaseItemTypes')):
    cls = classes[b['ItemClass']]['Name']
    if cls not in SLOT_CLASSES or not ok(b['Name']) or b['ModDomain'] not in (1, 2, 11) or b['Name'] not in trade_types:  # 1 item, 2 flask/charm, 11 jewel
        continue
    implicit_ids.update(b['Implicit_Mods'])
    a, w, fl = armour.get(i), weapon.get(i), flasks.get(i)
    bases.append({
        'name': b['Name'], 'name_es': bases_es[i]['Name'], 'class': cls, 'slots': SLOT_CLASSES[cls], 'level': b['DropLevel'], 'domain': b['ModDomain'],
        'tags': sorted(set(read_it(b['InheritsFrom']) + [tags_tab[t]['Id'] for t in b['Tags']])),
        'implicits': [mods[m]['Id'] for m in b['Implicit_Mods']],
        'armour': a and {'armour': a['Armour'], 'evasion': a['Evasion'], 'energy_shield': a['EnergyShield'], 'movement_speed_%': a['IncreasedMovementSpeed']},
        'img': visual[b['ItemVisualIdentity']]['DDSFile'] if b['ItemVisualIdentity'] is not None else None,
        'size': [b['Width'], b['Height']],
        'flask': fl and {'life': fl['LifePerUse'], 'mana': fl['ManaPerUse'], 'recovery_s': fl['RecoveryTime'] / 10},
        'weapon': w and {'crit': w['CritChance'] / 100, 'attack_time_ms': w['Speed'], 'min': w['DamageMin'], 'max': w['DamageMax'], 'range': w['RangeMax']},
    })
save('items.json', {
    'bases': list({(b['class'], b['name']): b for b in sorted(bases, key=lambda b: -b['level'])}.values()),  # dedupe: same name, keep lowest drop level
    'implicits': {mods[m]['Id']: mod_stats(mods[m]) for m in implicit_ids},
    'unique_img': {words[u['WordsKey']]['Text']: visual[u['ItemVisualIdentityKey']]['DDSFile'] for u in layout if u['ItemVisualIdentityKey'] is not None},
    'affixes': [{'id': m['Id'], 'name': mods_es[i]['Name'] or m['Name'], 'affix': 'prefix' if m['GenerationType'] == 1 else 'suffix',
                 'level': m['Level'], 'domain': m['Domain'], 'family': m['Families'][0] if m['Families'] else None, 'stats': mod_stats(m),
                 'spawn': [[tags_tab[t]['Id'], v] for t, v in zip(m['SpawnWeight_Tags'], m['SpawnWeight_Values'])]}
                for i, m in enumerate(mods) if m['Domain'] in (1, 2, 11) and m['GenerationType'] in (1, 2) and any(m['SpawnWeight_Values'])],
})
