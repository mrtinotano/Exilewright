import re
"""Filter the raw dump down to what a player can actually obtain. Writes ../available/*.json.
Usage: python -I available.py   (run after extract.mjs)"""
import json, math, os, struct

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'available')
BAD = ('DNT', 'INCOMPLETE', '[UNUSED', 'Coming Soon', '[TEST')


def load(t, lang='English'):
    with open(os.path.join(ROOT, 'tables', lang, t + '.json'), encoding='utf8') as f:
        return json.load(f)


# game languages: the app's code -> folder name under Data/Balance (extract.mjs dumps each to tables/<folder>)
LANGS = {'es': 'Spanish', 'pt': 'Portuguese', 'fr': 'French', 'de': 'German', 'ru': 'Russian',
         'ja': 'Japanese', 'ko': 'Korean', 'th': 'Thai', 'zh': 'Traditional Chinese'}


def text(*path):
    """a game text file under ../files: UTF-16 as the game has it (getfiles.mjs), or UTF-8 (extract.mjs)"""
    raw = open(os.path.join(ROOT, 'files', *path), 'rb').read()
    return raw.decode('utf-16') if raw[:2] == b'\xff\xfe' else raw.decode('utf8')


def load_langs(t):
    """{code: rows} of a table for every translated language that was extracted."""
    return {c: load(t, l) for c, l in LANGS.items() if os.path.exists(os.path.join(ROOT, 'tables', l, t + '.json'))}


# the game's keyword markup, "[Keyword|shown text]" or "[Shown]", as the text it shows
plain = lambda s: re.sub(r'\[(?:[^\]|]*\|)?([^\]]*)\]', r'\1', s) if s else None


def tr(by_lang, i, field='Name', key='name', keep=False):
    """{'name_es': ..., 'name_fr': ...} for row i (or row by key for dict tables); empty texts left out. keep: the
    game's keyword markup stays ("[Ignite|ignited]", read by i18n.js)"""
    out = {}
    for c, rows in by_lang.items():
        r = rows.get(i) if isinstance(rows, dict) else rows[i] if i is not None and i < len(rows) else None
        if r and r.get(field):
            out[f'{key}_{c}'] = r[field] if keep else plain(r[field])
    return out


def ok(name):
    return bool(name) and not any(b in name for b in BAD)


def save(name, data):
    with open(os.path.join(OUT, name), 'w', encoding='utf8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print(name, len(data))


def parse_psg(path):
    """Passive tree graph: returns {node_id: [connected ids]}, class root ids, {node_id: (x, y)},
    group centres [(x, y)], {node_id: (group index, orbit)} and the orbit radii (the app draws same-orbit links as arcs)."""
    d = open(path, 'rb').read()
    per_orbit = d[3:13]
    radii = (0, 82, 162, 335, 493, 662, 846, 251, 1080, 1322)  # note: PoB constants, re-check if the tree looks warped
    pos, centres, orbit = {}, [], {}
    o = 13
    n, = struct.unpack_from('<I', d, o); o += 4
    roots = [struct.unpack_from('<I', d, o + 8 * i)[0] for i in range(n)]; o += 8 * n
    groups, = struct.unpack_from('<I', d, o); o += 4
    graph = {}
    for _ in range(groups):
        gx, gy = struct.unpack_from('<ff', d, o); o += 17  # x f32, y f32, flags u32, unk u32, unk u8
        centres.append((round(gx), round(gy)))
        nc, = struct.unpack_from('<I', d, o); o += 4
        for _ in range(nc):
            nid, orb, idx, cc = struct.unpack_from('<IIII', d, o); o += 16
            a = 2 * math.pi * idx / per_orbit[orb]
            pos[nid] = (round(gx + radii[orb] * math.sin(a)), round(gy - radii[orb] * math.cos(a)))
            orbit[nid] = (len(centres) - 1, orb)
            graph[nid] = [struct.unpack_from('<I', d, o + 8 * i)[0] for i in range(cc)]; o += 8 * cc
    assert o == len(d), 'psg layout changed, update parse_psg'
    return graph, roots, pos, centres, orbit, radii


os.makedirs(OUT, exist_ok=True)
bases, bases_tr = load('BaseItemTypes'), load_langs('BaseItemTypes')
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

# what exists in the live patch: GGG's official trade list. Downloaded again on every run so removed gems/uniques/bases
# drop out after a patch; the cached copy is only used when offline.
trade_file = os.path.join(ROOT, 'poe2db_cache', 'trade2_items.json')
try:
    import urllib.request
    req = urllib.request.Request('https://www.pathofexile.com/api/trade2/data/items', headers={'User-Agent': 'Mozilla/5.0 (personal build planner)'})
    data = urllib.request.urlopen(req, timeout=30).read()
    json.loads(data)['result']
    os.makedirs(os.path.dirname(trade_file), exist_ok=True)
    open(trade_file, 'wb').write(data)
except Exception as e:
    print('trade list download failed, using cached copy:', e)
trade = {c['id']: c['entries'] for c in json.load(open(trade_file, encoding='utf8'))['result']}
trade_types = {e['type'] for c in trade.values() for e in c}
trade_gems = {e['type'] for e in trade['gem']}
trade_uniques = {e['name']: e['type'] for c in trade.values() for e in reversed(c) if e.get('flags', {}).get('unique')}   # name -> base
json.dump(dict(sorted(trade_uniques.items())), open(os.path.join(ROOT, 'poe2db_cache', 'trade2_uniques.json'), 'w', encoding='utf8'), ensure_ascii=False, indent=1)

# --- gems
active_skills, skill_types = load('ActiveSkills'), [t['Id'] for t in load('ActiveSkillType')]
# the icon the game shows for a buff (BuffDefinitions -> BuffVisuals.BuffDDSFile), found for a skill by its ActiveSkills
# id (a buff of that id, or a visual of that id or that id + _buff: sigil_of_life_buff) or by its name
buff_defs, buff_vis = load('BuffDefinitions'), load('BuffVisuals')
_vis_icon = {v['Id']: v['BuffDDSFile'] for v in buff_vis if v['BuffDDSFile']}
_buff_icon = {r['Id']: buff_vis[r['BuffVisual']]['BuffDDSFile'] for r in buff_defs if r['BuffVisual'] is not None and not r['Invisible'] and buff_vis[r['BuffVisual']]['BuffDDSFile']}
_buff_by_name = {}
for r in buff_defs:
    if r['Name'] and r['Id'] in _buff_icon:
        _buff_by_name.setdefault(r['Name'], _buff_icon[r['Id']])
def buff_icon(a):
    i = a['Id']
    return _buff_icon.get(i) or _vis_icon.get(i) or _vis_icon.get(i + '_buff') or _buff_by_name.get(a['DisplayedName'])
active_skills_tr = load_langs('ActiveSkills')
gem_effects_tr = load_langs('GemEffects')
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
    elif b['Name'] in trade_gems:
        source = 'tradeable'             # no source found in the tables, but GGG's trade site lists it
    else:
        continue                         # no known source and not in the live patch: removed / unreleased / test gem
    if source in ('gem_cutting', 'lineage_drop') and b['Name'] not in trade_gems:
        continue                         # still in the tables but gone from the live patch
    tags = sorted({gem_tags[t]['Id'] for e in g['GemEffects'] for t in gem_effects[e]['GemTags'] if gem_tags[t]['Id']})
    gems.append({
        'name': b['Name'], **tr(bases_tr, g['BaseItemType']), 'id': b['Id'],
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
        # what the support does, for the support picker. note: column name from dat-schema poe2 (GemEffects.SupportText);
        # if it comes out empty the picker falls back to the support's stat lines (skills.json)
        ex = gem_effects[g['GemEffects'][0]] if g['GemEffects'] else {}
        desc_col = next((c for c in ('SupportText', 'Description') if ex.get(c)), 'SupportText')
        gems[-1].update(description=ex.get(desc_col), **tr(gem_effects_tr, g['GemEffects'][0], desc_col, 'description', True) if g['GemEffects'] else {})
        gems[-1].update(icon=sr['Icon'], family=[support_family[f]['Id'] for f in sr['Family']], lineage=sr['IsLineage'],
                        require=types(ge['AllowedActiveSkillTypes']), exclude=types(ge['ExcludedActiveSkillTypes']),
                        adds=types(ge['AddedActiveSkillTypes']), gems_only=ge['SupportsGemsOnly'])
    elif ge and ge['ActiveSkill'] is not None:
        a = active_skills[ge['ActiveSkill']]
        gems[-1].update(icon=a['Icon_DDSFile'], types=types(a['ActiveSkillTypes']), cannot_be_supported=ge['CannotBeSupported'], buff_icon=buff_icon(a),
                        # text for the skill's info window (ActiveSkills.Description, per language), keyword markup kept
                        description=a.get('Description'), **tr(active_skills_tr, ge['ActiveSkill'], 'Description', 'description', True))
        # a meta gem (Mortar Cannon, Ancestral Warrior Totem...): the skills its sockets take are those its own support
        # part (GemEffects.AdditionalGrantedEffects named Support...) can support, as a support gem's require / exclude
        part = next((grants[x] for x in gem_effects[g['GemEffects'][0]]['AdditionalGrantedEffects'] if grants[x]['Id'].startswith('Support')), None)
        if 'meta' in tags and part:
            gems[-1]['holds'] = {'require': types(part['AllowedActiveSkillTypes']), 'exclude': types(part['ExcludedActiveSkillTypes'])}
# Prism of Belief's "+# to Level of all <skill> Skills": the skill by unique_jewel_specific_skill_level_+_skill
# (SkillGemsForUniqueStat.Index -> its skill gems)
for x in load('SkillGemsForUniqueStat'):
    for g in gems:
        if g['skill_gems_index'] in x['SkillGems']:
            g['specific'] = x['Index']
save('gems.json', gems)
# what the keywords of those descriptions mean (KeywordPopups: the game's help on hovering "[Ignite|ignited]"), the
# ones they use: {id: {term, def, term_<code>, def_<code>}}
KW = re.compile(r'\[([^\]|]+)(?:\|[^\]]*)?\]')
used = {m for g in gems for k, v in g.items() if k.startswith('description') and v for m in KW.findall(v)}
kw_langs = load_langs('KeywordPopups')
save('keywords.json', {k['Id']: {'term': plain(k['Term']), 'def': plain(k['Definition']), **tr(kw_langs, i, 'Term', 'term'), **tr(kw_langs, i, 'Definition', 'def')}
                       for i, k in enumerate(load('KeywordPopups')) if k['Id'] in used})

# --- passive tree (only nodes on the real graph, not from unused ascendancies)
graph, roots, pos, centres, orbit, radii = parse_psg(os.path.join(ROOT, 'files', 'metadata', 'passiveskillgraph.psg'))
asc = load('Ascendancy')
passives = load('PassiveSkills')
passives_tr = {c: {p['PassiveSkillGraphId']: p for p in rows} for c, rows in load_langs('PassiveSkills').items()}
by_gid = {p['PassiveSkillGraphId']: p for p in passives}
nodes = {}
for gid, conns in graph.items():
    p = by_gid[gid]
    a = asc[p['Ascendancy']]['Name'] if p['Ascendancy'] is not None else None
    if not ok(p['Name']) or (a and not ok(a)):
        continue
    vals = [p[f'Stat{k}Value'] for k in range(1, 8)]
    nodes[gid] = {
        'name': p['Name'], **tr(passives_tr, gid), 'id': p['Id'],
        'type': 'keystone' if p['IsKeystone'] else 'notable' if p['IsNotable'] else 'jewel' if p['IsJewelSocket']
                else 'attribute' if p['IsAttribute'] else 'small',
        'ascendancy': a, 'ascendancy_start': p['IsAscendancyStartingNode'],
        **({'option': True} if p['IsMultipleChoiceOption'] else {}),   # one of a multiple choice notable's options: picking it costs no point
        # not everyone's: the ascendancy the game shows it to alone (the Oracle's own passives), the passives that must
        # all be allocated before it can be (as graph ids, like the tree's keys), and one that is only ever granted (an
        # anointed notable, Voices' Sinister sockets: on no tree until something gives it)
        **({'only_for': asc[p['VisibleForAscendancy']]['Name']} if p['VisibleForAscendancy'] is not None else {}),
        **({'needs': [str(passives[u]['PassiveSkillGraphId']) for u in p['UnlockedBy']]} if p['UnlockedBy'] else {}),
        **({'granted': True} if p['IsAnointmentOnly'] else {}),
        'stats': {stats[s]['Id']: v for s, v in zip(p['Stats'], vals)},
        'grants_skill': bases[skill_gems[p['GrantedSkill']]['BaseItemType']]['Name'] if p['GrantedSkill'] is not None else None,
        'icon': p.get('Icon_DDSFile') or None,
        'links': conns, 'x': pos[gid][0], 'y': pos[gid][1], 'group': orbit[gid][0], 'orbit': orbit[gid][1],
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
attr_icons = {k: p['Icon_DDSFile'] for p in passives for k in attr_opts if p['Id'].startswith('generic_attribute_' + k)}   # and what it then looks like
# the art the game draws behind a passive of a mastery (images.py: img/mastery/<id>): PassiveSkills.MasteryGroup ->
# PassiveSkillMasteryGroups.Art -> PassiveSkillTreeMasteryArt
mastery_groups, mastery_art = load('PassiveSkillMasteryGroups'), load('PassiveSkillTreeMasteryArt')
for gid, n in nodes.items():
    if by_gid[gid]['MasteryGroup'] is not None:
        n['mastery_art'] = mastery_art[mastery_groups[by_gid[gid]['MasteryGroup']]['Art']]['Id']
# timeless jewels (local_unique_jewel_alternate_tree_version): what each conqueror changes in its radius
# (AlternateTreeVersions: which kinds of passive it replaces or adds to, by the jewel's seed) and the keystone that takes
# the place of each keystone in it (AlternatePassiveSkills, picked by local_unique_jewel_alternate_tree_keystone)
alt_versions = [{'replaces': {'small': v['SmallNormalPassiveReplaced'], 'attribute': v['SmallAttributeReplaced'], 'notable': v['NotableReplacementSpawnWeight'] > 0},
                 'adds': {'small': v['SmallNormalPassiveSkillAdditions'][1] > 0, 'attribute': v['SmallAttributePassiveSkillAdditions'][1] > 0, 'notable': v['NotableAdditions'][1] > 0}}
                for v in load('AlternateTreeVersions')]
alt_tr = load_langs('AlternatePassiveSkills')
conquerors = [{'version': x['AlternateTreeVersion'], 'index': x['ConquerorIndex'], 'name': x['Name'], **tr(alt_tr, i), 'icon': x['DDSIcon'],
               'stats': {stats[st]['Id']: x[f'Stat{k + 1}'][0] for k, st in enumerate(x['Stats'])}}
              for i, x in enumerate(load('AlternatePassiveSkills')) if 4 in x['PassiveType'] and x['ConquerorVersion'] == 0]
# what a conqueror does in its radius whatever the seed: a kind of passive (PassiveType 1 attribute, 2 small, 3 notable)
# replaced by the only passive it can become (Abyss: small passives -> Tribute; 'named': its name and art), what every
# passive of a kind gets added
# (Abyss: attribute passives +3 Tribute), and what the jewel's own modifiers add to a kind
# (AlternateTreeExtraAdditionsFromJewelStats: "Conquered Small Passive Skills also grant ...")
PTYPE = {1: 'attribute', 2: 'small', 3: 'notable'}
def alt_fixed(x, n):
    rolls = [x[f'Stat{k + 1}'] for k in range(min(n, len(x['Stats'])))]
    return {stats[st]['Id']: r[0] for st, r in zip(x['Stats'], rolls)} if all(r[0] == r[1] for r in rolls) and x.get('Random', [0, 0]) == [0, 0] else None
alt_skills, alt_adds = load('AlternatePassiveSkills'), load('AlternatePassiveAdditions')
for vi, (v, out) in enumerate(zip(load('AlternateTreeVersions'), alt_versions)):
    rep_ = {1: v['SmallAttributeReplaced'], 2: v['SmallNormalPassiveReplaced'], 3: v['NotableReplacementSpawnWeight'] >= 100}
    cnt = {1: v['SmallAttributePassiveSkillAdditions'], 2: v['SmallNormalPassiveSkillAdditions'], 3: v['NotableAdditions']}
    for ty, kind in PTYPE.items():
        c = [x for x in alt_skills if x['AlternateTreeVersion'] == vi and ty in x['PassiveType'] and x['SpawnWeight'] > 0]
        if rep_[ty] and len(c) == 1 and (st := alt_fixed(c[0], 6)) is not None:
            out.setdefault('becomes', {})[kind] = st
            out.setdefault('named', {})[kind] = {'name': c[0]['Name'], **tr(alt_tr, c[0]['_index']), 'icon': c[0]['DDSIcon']}
        a = [x for x in alt_adds if x['AlternateTreeVersion'] == vi and ty in x['PassiveType'] and x['SpawnWeight'] > 0]
        if cnt[ty][0] == cnt[ty][1] > 0 and len(a) == 1 and (st := alt_fixed(a[0], 3)) is not None: out.setdefault('plus', {})[kind] = {k: x * cnt[ty][0] for k, x in st.items()}
    ex = {stats[r['Id']]['Id']: [PTYPE[r['NodeType']], stats[r['Stat']]['Id']] for r in load('AlternateTreeExtraAdditionsFromJewelStats') if r['JewelType'] == vi}
    if ex: out['extra'] = ex
# what a conquered notable can become (its version's notables in AlternatePassiveSkills; one with no weight never comes
# up), for the timeless jewels there are (uniques.py's unique_items.json). Which of them is not in the client data: the game mixes the jewel's seed with a number the jewel hides
# (local_unique_jewel_break_timeless_jewel_calculators), so the planner is told what the game shows (app.js tellConquest)
alt_live = {s[1] for u in json.load(open(os.path.join(OUT, 'unique_items.json'), encoding='utf8')) for m in u.get('mods', []) for s in m.get('stats', []) if s[0] == 'local_unique_jewel_alternate_tree_version'}
alt_notables = {x['Id']: {'version': x['AlternateTreeVersion'], 'name': x['Name'], **tr(alt_tr, x['_index']), 'icon': x['DDSIcon'], 'stats': st}
                for x in alt_skills if x['AlternateTreeVersion'] in alt_live and 3 in x['PassiveType'] and x['SpawnWeight'] > 0 and (st := alt_fixed(x, 6)) is not None}
# the notables an Undying Hate's modifier makes one of its conquered notables become ("One Conquered Notable Passive
# Skill becomes Ephemeral Contact": local_historic_jewel_override_*, a passive's hash)
alt_over = {}
for r in load('AlternateTreeExtraPassiveOverridesFromJewelStats'):
    p = passives[r['PassiveSkill']]
    alt_over[str(p['PassiveSkillGraphId'])] = {'name': p['Name'], **tr(passives_tr, p['PassiveSkillGraphId']),
        'stats': {stats[st]['Id']: p[f'Stat{k + 1}Value'] for k, st in enumerate(p['Stats'])}}
# the picture of a socket with a jewel in it: by the jewel's base (PassiveJewelArt), a unique's own (PassiveJewelUniqueArt)
words = load('Words')
socketed = {**{bases[r['BaseItemTypesKey']]['Name']: r['SocketedImage'] for r in load('PassiveJewelArt')},
            **{words[r['Name']]['Text']: r['JewelArt'] for r in load('PassiveJewelUniqueArt')}}
socket_art = {words[r['Name']]['Text']: r['KeystoneArt'] for r in load('PassiveJewelUniqueArt') if r['KeystoneArt']}   # and the art behind that socket
save('passive_tree.json', {'class_roots': roots, 'socketed': socketed, 'socket_art': socket_art, 'attribute_options': attr_opts, 'attribute_icons': attr_icons, 'groups': centres, 'orbit_radii': radii, 'nodes': {str(k): v for k, v in nodes.items()},
                           'timeless': {'versions': alt_versions, 'keystones': conquerors, 'overrides': alt_over, 'notables': alt_notables},
                           # Flesh Crucible's keystone (local_vivisection_random_keystone_index, from 1): PassiveKeystoneList's rows
                           'keystone_list': [str(passives[k['Passive']]['PassiveSkillGraphId']) for k in load('PassiveKeystoneList')]})

# --- ascendancies / classes
chars, chars_tr, asc_tr = load('Characters'), load_langs('Characters'), load_langs('Ascendancy')
save('ascendancies.json', [{'name': a['Name'], **tr(asc_tr, ai), 'class': chars[a['Character']]['Name'] if a['Character'] is not None else None,
                            # the class name per language, as {name, name_es, ...} (app: tn(class_names))
                            'class_names': {'name': chars[a['Character']]['Name'], **tr(chars_tr, a['Character'])} if a['Character'] is not None else None,
                            # art for the tree's central circle: the ascendancy's own, else its class's
                            'tree_image': a.get('PassiveTreeImage') or None,
                            'class_tree_image': chars[a['Character']].get('PassiveTreeImage') or None if a['Character'] is not None else None,
                            # every number of the class row (base life/mana... whatever this patch's Characters has)
                            'class_base': {k: v for k, v in chars[a['Character']].items() if type(v) in (int, float)} if a['Character'] is not None else None,
                            'attrs': {'str': chars[a['Character']]['BaseStrength'], 'dex': chars[a['Character']]['BaseDexterity'], 'int': chars[a['Character']]['BaseIntelligence']}
                            if a['Character'] is not None else None} for ai, a in enumerate(asc) if ok(a['Name'])])

# --- uniques: what the Unique Stash Tab knows about; hidden-if-empty ones are flagged
words, layout = load('Words'), load('UniqueStashLayout')
words_tr = load_langs('Words')
shown = lambda i: words[i]['Text2'] or words[i]['Text']   # the name the game shows, in every language (Text is the internal one: "Brynabas")
tab = [(u['WordsKey'], not (u['ShowIfEmptyStandard'] or u['ShowIfEmptyChallengeLeague'])) for u in layout if u['RenamedVersion'] is None and not u['IsAlternateArt']]
# and the uniques with no slot in the stash tab (tablets, relics, the newest ones) that GGG's trade site lists all the same
tab += [(i, False) for i, w in enumerate(words) if w['Wordlist'] == 6 and shown(i) in trade_uniques.keys() - {shown(u['WordsKey']) for u in layout}]
save('uniques.json', sorted(({'name': shown(k), **tr(words_tr, k, 'Text2'), 'hidden_in_stash_tab': hidden} for k, hidden in tab if ok(shown(k))),
                            key=lambda x: x['name']))

mods = load('Mods')

# --- skill geometry for the 3D scene. Units are game units (10 = 1 m).
# radius: active_skill_base_area_of_effect_radius per gem level. Projectile speed: Projectiles.ProjectileSpeed / 10 = units/s
# (poedb: Fireball 1040 -> 104 units/s); only exact name matches, there is no table linking a player skill to its projectile.
# Player base speed: Pathfinding.base_speed in metadata/characters/character.ot (units/s).
ge_tab, gfx, ss_tab = load('GrantedEffects'), load('GemEffects'), load('GrantedEffectStatSets')
ss_lvl = {}
for r in load('GrantedEffectStatSetsPerLevel'):
    ss_lvl.setdefault(r['StatSet'], []).append(r)
proj_tab = load('Projectiles')
proj_by_id = {p['Id'].lower(): p for p in proj_tab}
ge_lvl = {}
for r in load('GrantedEffectsPerLevel'):
    ge_lvl.setdefault(id(ge_tab[r['GrantedEffect']]), []).append(r)
cost_types = load('CostTypes')
sid = lambda i: stats[i]['Id']
# the weapons a skill is used with: ActiveSkills.WeaponRequirements -> item class names ('' is unarmed)
classes, wieldable = load('ItemClasses'), load('WieldableClasses')
weapon_req = [[classes[wieldable[c]['ItemClass']]['Name'] for c in r['WieldableClasses']] for r in load('ActiveSkillWeaponRequirement')]
# what a gem's quality gives, per 1000 quality: "quality" always, "alt_quality" only for who has "Gem Quality grants
# Socketed Skills an additional effect" (Gemling Legionnaire)
quality_tab = {r['GrantedEffect']: r for r in load('GrantedEffectQualityStats')}
# a totem is a monster: ActiveSkills.SkillTotemId -> SkillTotemVariations -> MonsterVarieties (its life multiplier)
totem_variety, varieties, monster_types = {}, load('MonsterVarieties'), load('MonsterTypes')
for r in load('SkillTotemVariations'):
    totem_variety.setdefault(r['SkillTotemsKey'], varieties[r['MonsterVarietiesKey']])
# ...unless a stat of the skill says which monster it is: totem_has_<X> -> MonsterVarietiesArtVariations X
# (Ancestral Warrior Totem's spirit: life x1 and no x4 armour, as the game's window shows, not SkillTotemId's SlamTotem)
art_variety = {}
for r in (r for r in load('MonsterVarietiesArtVariations') if r['MonsterVarietiesKeys']):
    art_variety.setdefault(r['Id'], varieties[r['MonsterVarietiesKeys'][0]])
skills, skill_csd = {}, {}
PART_FLAG = re.compile(r'^(never_|always_|active_skill_never_|cannot_|projectiles_fork|support_double_number_of_cooldown_uses|base_consume_|global_always_hit|global_cannot_crit|base_lightning_damage_can_electrocute|base_all_damage_can_pin|minions_are_gigantic|companions_are_gigantic)')
PART_RULE = re.compile(r'consume|_vs_|against_|exposure|curse|freeze|shock|ignite|chill|stun|bleed|poison|electrocut|pins?_|armour_break|charge')
def stat_levels(effects, sets):
    """the constant stats of these stat sets and every other one per gem level (the effects' cooldown, uses, cost...)"""
    const = {sid(a): v for i in sets for a, v in zip(ss_tab[i]['ConstantStats'], ss_tab[i]['ConstantStatsValues'])}
    # every stat per gem level and the row's own numbers under "_" keys, for the DPS and the skill info window.
    # FloatStats: BaseResolvedValues is the number the game shows (FloatStatsValues is its share of the level's
    # effectiveness). BaseMultiplier is what an attack deals over / under 100% of the weapon, in 1/100 %.
    levels = {}
    for i in sets:
        for r in ss_lvl.get(i, []):
            st = levels.setdefault(r['GemLevel'], {})
            st.update({sid(a): v for a, v in zip(r['AdditionalStats'], r['AdditionalStatsValues'])})
            st.update({sid(a): v for a, v in zip(r['FloatStats'], r['BaseResolvedValues'])})
            if r['BaseMultiplier']:
                st['_base_multiplier'] = 10000 + r['BaseMultiplier']
            for col, key in (('SpellCritChance', '_spell_crit'), ('AttackCritChance', '_attack_crit')):
                if r[col]:
                    st[key] = r[col]
    for x in effects:
        for r in ge_lvl.get(id(x), []):
            st = levels.setdefault(r['Level'], {})
            for col, key in (('Cooldown', '_cooldown_ms'), ('StoredUses', '_stored_uses'), ('Reservation', '_spirit'),
                             ('AttackSpeedMultiplier', 'active_skill_attack_speed_+%_final')):
                if r[col]:
                    st[key] = r[col]
            if x['IsSupport'] and r['CostMultiplier'] not in (0, 100):   # a support's cost multiplier (Path of Building 2: SupportManaMultiplier)
                st['_cost_multiplier'] = r['CostMultiplier']
            if any(r['CostAmounts']):   # channelled skills cost per minute: written per second (ManaPerSecond)
                st['_cost'] = {c['Id'].replace('PerMinute', 'PerSecond'): round(v / c['Divisor'], 1) if c['PerMinute'] else v
                               for c, v in zip((cost_types[t] for t in x['CostTypes']), r['CostAmounts'])}
    if levels:   # what never changes with the level goes to "constant": keeps the file small
        one = next(iter(levels.values()))
        for k in sorted(set.intersection(*map(set, levels.values()))):   # sorted: the same file on every run
            if all(lv[k] == one[k] for lv in levels.values()):
                const[k] = one[k]
                for lv in levels.values():
                    del lv[k]
    return const, levels


for g in sorted(gems, key=lambda g: g['source'] == 'gem_cutting'):   # skills go by name: of two gems with one name (Herald of Ash and a unique's own) the one you can cut stays
    if g['kind'] not in ('active', 'support', 'spirit'):   # supports too: their stat lines describe them in the picker; spirit: meta gems (Mortar Cannon)
        continue
    fx = gfx[skill_gems[g['skill_gems_index']]['GemEffects'][0]]
    e = ge_tab[fx['GrantedEffect']]
    # A skill that deals no damage itself has the one that does laid over it: a gem's own skill that only loads
    # ammunition or reserves spirit (crossbow rounds, Black Powder Blitz) under the skill the gem then uses, and the
    # main stat set of a skill made of several parts (Rolling Slam) under its first part that deals damage
    # ...and a totem's own attack over the totem it raises (Shockwave Totem's quake: its damage, speed and area)
    implicit_of = lambda x: {sid(a) for a in ss_tab[x['StatSet']]['ImplicitStats']}
    idle = lambda i: 'base_deal_no_damage' in {sid(a) for a in ss_tab[i]['ImplicitStats']}
    effects = [e] + [ge_tab[x] for x in fx['AdditionalGrantedEffects'][:1] if idle(e['StatSet'])
                     or 'is_totem' in implicit_of(e) and 'base_skill_is_totemified' in implicit_of(ge_tab[x]) and not ge_tab[x]['Id'].startswith('Support')]
    # ...unless the skill sets that part off by itself (Ancestral Cry's shockwave): then the cry's own cast time, cost and area stay on top
    if 'display_statset_hide_usage_stats' in implicit_of(effects[-1]):
        effects.reverse()
    sets = [i for x in effects for i in [x['StatSet']] + ([j for j in x['AdditionalStatSets'] if not idle(j)][:1] if idle(x['StatSet']) else [])]
    implicit = {sid(a) for i in sets for a in ss_tab[i]['ImplicitStats']}
    const, levels = stat_levels(effects, sets)
    rad = lambda area: {lvl: st.get(area, const.get(area)) for lvl, st in levels.items() if area in st or area in const} or None
    radius = rad('active_skill_base_area_of_effect_radius')
    # what the gem's other parts say (its second hit, the explosion, the empowered use...): only the rules the 3D scene
    # reads (consuming a state, damage against one, exposure, curses, charges), per level as above; and every on / off
    # rule of the skill (never_freeze, always_ignite, base_consume_enemy_shock_on_hit...) from all of its parts
    allfx = effects + [ge_tab[x] for x in fx['AdditionalGrantedEffects'] if ge_tab[x] not in effects and not ge_tab[x]['Id'].startswith(('Support', 'Triggered') if g['kind'] == 'support' else 'Support')]   # a support's triggered skills are skills of their own (below)
    more_sets = [i for x in allfx for i in [x['StatSet']] + x['AdditionalStatSets'] if i not in sets]
    flags = sorted({k for x in allfx for i in [x['StatSet']] + x['AdditionalStatSets'] for k in map(sid, ss_tab[i]['ImplicitStats']) if PART_FLAG.search(k)})
    part, part_levels = {}, {}
    for i in more_sets:
        part.update({k: v for k, v in zip(map(sid, ss_tab[i]['ConstantStats']), ss_tab[i]['ConstantStatsValues']) if PART_RULE.search(k)})
        for r in ss_lvl.get(i, []):
            part_levels.setdefault(r['GemLevel'], {}).update({k: v for k, v in zip(map(sid, r['AdditionalStats']), r['AdditionalStatsValues']) if PART_RULE.search(k)})
    part_levels = {l: x for l, x in part_levels.items() if x}
    # the gem's other parts with damage of their own (Earthshatter's spike, Forge Hammer's fissures): every stat of the
    # part and its multiplier per level, as the skill's (stat_levels)
    parts = {ss_tab[i]['Id']: {'constant': c, 'levels': lv} for i in more_sets for c, lv in [stat_levels([], [i])]
             if any('_base_multiplier' in x or 'wild_beast_damage_+%_final' in x or any(k.startswith('spell_minimum_base_') for k in x) for x in lv.values())}   # an attack's multiplier or a spell's own damage (Volcano's projectiles); Savage Fury's frenzy
    # the secondary radius of a part without damage of its own, as the skill's (Detonating Arrow's explosion: the arrow's damage)
    R2 = 'active_skill_base_secondary_area_of_effect_radius'
    for i in more_sets:
        r = ss_tab[i]['Id'] not in parts and dict(zip(map(sid, ss_tab[i]['ConstantStats']), ss_tab[i]['ConstantStatsValues'])).get(R2)
        if r: const.setdefault(R2, r)
    if part_levels:
        one = next(iter(part_levels.values()))
        for k in set.intersection(*map(set, part_levels.values())):
            if all(lv[k] == one[k] for lv in part_levels.values()):
                part[k] = one[k]
                for lv in part_levels.values():
                    del lv[k]
        part_levels = {l: x for l, x in part_levels.items() if x}
    p = proj_by_id.get('metadata/projectiles/' + g['name'].replace(' ', '').replace("'", '').lower())
    q = next((quality_tab[i] for i in [fx['GrantedEffect'], *fx['AdditionalGrantedEffects'][:1]] if i in quality_tab), {})
    acts = [active_skills[x['ActiveSkill']] for x in effects if x['ActiveSkill'] is not None]
    skills[g['name']] = {
        **{k: {sid(a): v for a, v in zip(q[s], q[s + 'ValuesPermille'] if k == 'quality' else q['AltStatValuesPermille'])}
           for k, s in (('quality', 'Stats'), ('alt_quality', 'AltStats')) if q.get(s)},
        'cast_time_ms': effects[-1]['CastTime'],
        'constant': const,
        'levels': levels or None,
        'radius': radius or None,
        'projectile': 'base_is_projectile' in implicit,
        'projectile_speed': p['ProjectileSpeed'] / 10 if p and 'base_is_projectile' in implicit else None,
        'projectile_range': const.get('projectile_maximum_range_override'),
        'duration_ms': const.get('base_skill_effect_duration'),
        'projectile_collision': p['CollisionRadius'] if p and 'base_is_projectile' in implicit else None,
        'weapons': next((weapon_req[a['WeaponRequirements']] for a in acts if a['WeaponRequirements'] is not None), None),
        # what a meta gem does to the skill it uses: its own support part (GemEffects.AdditionalGrantedEffects named
        # Support...: Mortar Cannon's -50% more attack speed for the grenades it fires)
        **({'flags': flags} if flags else {}), **({'part': part} if part else {}), **({'part_levels': part_levels} if part_levels else {}), **({'parts': parts} if parts else {}),
        # the skill a support sets off (Fiery Death's explosion: TriggeredFieryDeathPlayer), its own constant stats
        **({'triggers': t} if g['kind'] == 'support' and (t := {ge_tab[x]['Id']: {sid(a): v for a, v in zip(ss_tab[ge_tab[x]['StatSet']]['ConstantStats'], ss_tab[ge_tab[x]['StatSet']]['ConstantStatsValues'])}
                                                                  for x in fx['AdditionalGrantedEffects'] if ge_tab[x]['Id'].startswith('Triggered')}) else {}),
        'meta_support': {sid(a): v for x in fx['AdditionalGrantedEffects'] if ge_tab[x]['Id'].startswith('Support')
                         for a, v in zip(ss_tab[ge_tab[x]['StatSet']]['ConstantStats'], ss_tab[ge_tab[x]['StatSet']]['ConstantStatsValues'])} or None,
        # the skill a meta gem itself uses for the skills in it (Mirage Archer's Mirage: its duration, its cooldown)
        **({'meta_skill': m} if (m := {ge_tab[x]['Id']: dict(zip(('constant', 'levels'), stat_levels([ge_tab[x]], [ge_tab[x]['StatSet']])))
                                      for x in fx['AdditionalGrantedEffects'] if ge_tab[x]['Id'].endswith('SpawnPlayer')}) else {}),
    }
    totem = next((art_variety[k[10:]] for k in implicit | set(const) if k.startswith('totem_has_') and k[10:] in art_variety), None) \
        or next((totem_variety[a['SkillTotemId']] for a in acts if a.get('SkillTotemId') in totem_variety), None)
    if totem and 'is_totem' in implicit:   # the totem's life: a monster of its level times its variety's multiplier
        skills[g['name']]['totem'] = {'life_mult': totem['LifeMultiplier'] / 100, 'ballista': 'is_ranged_attack_totem' in implicit,
                                      'armour': monster_types[totem['MonsterType']]['Armour']}   # MonsterTypes.Armour: 0 or 100 for totems
    # the skill's own stat texts (Berserk's Rage effect, Virtuous Barrier's Motes): ActiveSkills.StatDescription
    csd = next((a['StatDescription'] for a in acts if a['StatDescription']), '')
    if 'specific_skill_stat_descriptions' in csd.lower():
        skill_csd.setdefault(csd.lower(), []).append(g['name'])
        # the radius the game's skill window shows is the one the skill's .csd gives a table_only row ("Orb radius@{0}m"):
        # the secondary one when only that has a row (Orb of Storms: 3.6 m, its 5.6 m is not shown)
        if os.path.exists(os.path.join(ROOT, 'files', csd.lower())):
            rows = {b.split()[1] for b in text(csd.lower()).split('description')[1:] if 'table_only' in b and b.split()[0] == '1'}
            if 'active_skill_secondary_area_of_effect_radius' in rows and 'active_skill_area_of_effect_radius' not in rows:
                skills[g['name']]['radius'] = rad('active_skill_base_secondary_area_of_effect_radius')
# the skills supports set off (Shocking Rift, Volcanic Eruption, Fiery Death...) as skills of their own, under their
# GrantedEffects id: per level, as they take the level of the skill the support is on (Path of Building 2,
# CalcActiveSkill: "Active skills granted by support gems inherit the level of the skill that support applied to")
AOE = 'active_skill_base_area_of_effect_radius'
TAG_OF = {'Attack', 'Spell', 'Area', 'Projectile', 'Melee', 'Duration', 'Fire', 'Cold', 'Lightning', 'Physical', 'Chaos'}
for g in gems:
    if g['kind'] != 'support' or not skills.get(g['name'], {}).get('triggers'):
        continue
    fx = gfx[skill_gems[g['skill_gems_index']]['GemEffects'][0]]
    for x in (ge_tab[i] for i in fx['AdditionalGrantedEffects'] if ge_tab[i]['Id'].startswith('Triggered')):
        const, levels = stat_levels([x], [x['StatSet']])
        a = active_skills[x['ActiveSkill']] if x['ActiveSkill'] is not None else {}
        kinds = types(a.get('ActiveSkillTypes') or [])
        skills[x['Id']] = {'name': a.get('DisplayedName'), **(tr(active_skills_tr, x['ActiveSkill'], 'DisplayedName', 'name') if a else {}),
                           'triggered_by': g['name'], 'types': kinds, 'tags': sorted(t.lower() for t in kinds if t in TAG_OF),
                           'cast_time_ms': x['CastTime'], 'constant': const, 'levels': levels or None,
                           'radius': {l: st.get(AOE, const.get(AOE)) for l, st in levels.items() if AOE in st or AOE in const} or None,
                           'flags': sorted(k for k in map(sid, ss_tab[x['StatSet']]['ImplicitStats']) if PART_FLAG.search(k)) or None,
                           # its other parts (Catalysing Discharge per element, Poison Spores' explosion): their stats per level
                           **({'parts': {ss_tab[i]['Id']: dict(zip(('constant', 'levels'), stat_levels([], [i]))) for i in x['AdditionalStatSets']}} if x['AdditionalStatSets'] else {})}
ot = text('metadata', 'characters', 'character.ot')
base_speed = int(ot.split('Pathfinding')[1].split('base_speed')[1].split('=')[1].split()[0])
cs = {c['Id']: c['Text'] for c in load('ClientStrings')}
capacity_per = int(re.search(r'(\d+) \[Strength[^=]*= \+1 Strength \[SupportGem', cs['StrengthDescription']).group(1))
max_sockets = max(int(m.group(1)) for c in load('CurrencyItems') if (m := re.fullmatch(r'add_skill_gem_socket_(\d+)', c['Action'] or '')))
# base character numbers (life, mana, resist caps...): every "stat = number" in character.ot, used by the stats panel
ot_stats = lambda s: {k: int(v) for k, v in re.findall(r'^\s*([a-z_%+\-]+)\s*=\s*(-?\d+)\s*$', s, re.M)}
char_stats = ot_stats(ot)
# not in character.ot: how long energy shield waits before recharging (GameConstants)
game = {c['Id']: c['Value'] / c['Divisor'] for c in load('GameConstants')}
char_stats['energy_shield_delay_ms'] = round(game['BaseShieldRegenCooldownTimeMs'])
char_stats['ailment_threshold_life_%'] = round(game['PlayerAilmentThresholdLifeFactor'] * 100)   # a player's starts at half its life
# Ignite: a share of the hit's fire damage per second, for a few seconds (the game's window: 815-1772 fire -> 163-354.4/s)
char_stats['ignite_%_per_second'] = game['IgniteHitDamagePercentPerMinute'] / 60
char_stats['ignite_duration_s'] = game['BaseIgniteDuration']
char_stats['base_maximum_rage'] = game['BaseMaximumRage']   # 30; passives add maximum_rage
char_stats['rage_loss_delay_ms'], char_stats['rage_loss_per_minute'] = game['BaseRageLossDelayMs'], game['BaseRageLossPerMinute']
char_stats['base_maximum_infusions'] = game['BaseMaximumInfusionCount']
char_stats['damage_%_deflected'] = game['BasePercentDamageDeflected']   # a deflected hit takes 40% less
attr_text = {k: cs.get(k + 'Description') for k in ('Strength', 'Dexterity', 'Intelligence')}  # what 1 point of each gives
# what the campaign leaves on a character: the stats of every permanent quest reward (the table also keeps rewards the
# campaign no longer gives: which ones count is pob2.py's part; the tally of boss faces is no stat of the character),
# and the elemental resistance penalty of an area by its level, level 1 first
quest_rewards = [r for r in ([[stats[s]['Id'], v] for s, v in zip(q['RewardStats'], q['RewardStatsValues']) if stats[s]['Id'] != 'number_of_broken_faces']
                             for q in load('QuestStaticRewards')) if r]
res_penalty = [r['Penalty'] for r in sorted(load('ResistancePenaltyPerAreaLevel'), key=lambda r: r['AreaLevel'])]
# monster stats per level (character panel: armour % against a hit of a monster of your level, evade chance against its accuracy)
try:
    monster_stats = [{'level': int(r.get('DisplayLevel') or i + 1), **{k: v for k, v in r.items() if isinstance(v, (int, float)) and not isinstance(v, bool)}} for i, r in enumerate(load('DefaultMonsterStats'))]
except FileNotFoundError:
    monster_stats = []
# the level of a minion or totem by its gem's level (2 per level)
minion_level = [r['MinionLevel'] for r in sorted(load('MinionGemLevelScaling'), key=lambda r: r['GemLevel'])]
# what a minion gets of its owner's stats (MinionStats: the owner's stat -> the minion's; note: "virtual_minion_X" read as
# the "minion_X" the tree and gear give) and what every player minion has (PlayerMinionIntrinsicStats: +70% critical damage
# bonus, always hits). The rows for one kind of minion (zombies, skeletons...) and for companions are left out: which kind
# a gem raises is not in the dump (DisplayMinionMonsterType is empty)
minion_stats = {sid(r['MinionStat']).replace('virtual_minion_', 'minion_', 1): next(sid(x) for x in r['PlayerStat'] if x != r['MinionStat'])
                for r in load('MinionStats') if not (r['MinionType'] or r['MinionType2'] or r['CompanionStat']) and any(x != r['MinionStat'] for x in r['PlayerStat'])}
minion_intrinsic = {sid(r['Stat']): r['Value'] for r in load('PlayerMinionIntrinsicStats')}
# Nature's Archon: BuffTemplates ArchonNature's values, in the order of its BuffDefinition's stats (those left at 0 are out)
archon_nature = next({sid(k): x for k, x in zip(buff_defs[r['BuffDefinition']]['Stats'], r['Buff_StatValues']) if x} for r in load('BuffTemplates') if r['Id'] == 'ArchonNature')
# an Archon's time and the recovery before another, as the game's Archon keyword says them ("lasts 10 seconds", "lasts 20 seconds")
archon_time = [int(x) for x in re.findall(r'lasts (\d+) seconds', next(r['Definition'] for r in load('KeywordPopups') if r['Id'] == 'Archon'))]
assert len(archon_time) == 2, archon_time
# the lesser (non-damaging) Shrines' buffs, which The Hammer of Faith grants at random: their name (BuffDefinitions, in
# every language), how long they last (Shrines) and their stats (BuffTemplates' values in the order of the definition's)
_tmpl = load('BuffTemplates')
lesser_shrines = [{'id': r['Id'], 'duration': r['Duration'], 'name': buff_defs[t['BuffDefinition']]['Name'], **tr(load_langs('BuffDefinitions'), t['BuffDefinition']),
                   'stats': {sid(k): x for k, x in zip(buff_defs[t['BuffDefinition']]['Stats'], t['Buff_StatValues']) if x and sid(k) != 'has_shrine_effect'}}
                  for r in load('Shrines') if r['IsLesserShrine'] for t in [_tmpl[r['Player_ShrineBuffsKey']]]]
save('skills.json', {'move_icon': 'Art/2DArt/SkillIcons/iconmoveonly.dds',   # the bar's Move, on left click by default (the game's icon; no table names it)
                     'charge_icons': {c: _buff_icon[c + '_charge'] for c in ('frenzy', 'power', 'endurance')},
                     # the Elemental Infusions you have: their buff's icon and name (BuffDefinitions), in every language
                     'infusions': {e: {'icon': _buff_icon[e + '_infusion'], 'name': buff_defs[k]['Name'], **tr(load_langs('BuffDefinitions'), k)}
                                   for e in ('fire', 'cold', 'lightning', 'verisium') for k in [next(i for i, r in enumerate(buff_defs) if r['Id'] == e + '_infusion')]},
                     # the icons of the ailments on you; frozen and electrocuted have none in BuffVisuals: the game's StatusFrozen /
                     # StatusElectrocuted art (no table names them; the PoE2 Wiki's status icons are the same)
                     'ailment_icons': {**{a: _buff_icon[b] for a, b in (('ignite', 'ignited'), ('chill', 'chilled'), ('shock', 'shocked'), ('poison', 'poison'), ('bleed', 'bleeding'), ('maim', 'maim'))},
                                       'freeze': 'Art/2DArt/BuffIcons/StatusFrozen.dds', 'electrocute': 'Art/2DArt/BuffIcons/StatusElectrocuted.dds'}, 'monster_stats': monster_stats, 'minion_level': minion_level, 'minion_stats': minion_stats, 'minion_intrinsic': minion_intrinsic, 'archon_nature': archon_nature, 'archon_time': archon_time, 'archon_nature_icon': _buff_icon['archon_nature'], 'character_stats': char_stats, 'quest_rewards': quest_rewards, 'resistance_penalty': res_penalty, 'attribute_text': attr_text, 'player_base_speed': base_speed, 'support_capacity_per_attribute': capacity_per, 'max_support_sockets': max_sockets, 'lesser_shrines': lesser_shrines, 'skills': skills})

# --- stat texts for stats used by passives, item mods and skills; app formats them.
# stat_texts.json is English, stat_texts.<code>.json each translated language (English rows where the game has none)
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
        out[' '.join(ids)] = {'stats': ids, 'langs': langs}

sd = os.path.join(ROOT, 'files', 'data', 'statdescriptions')
descs = {}
for f in ('gem_stat_descriptions.csd', 'skill_stat_descriptions.csd', 'active_skill_gem_stat_descriptions.csd',
          'stat_descriptions.csd', 'passive_skill_stat_descriptions.csd'):  # later file overrides
    if os.path.exists(os.path.join(sd, f)):
        parse_csd(os.path.join(sd, f), descs)
skill_keys = lambda sk: set(sk['constant']) | {k for lv in (sk['levels'] or {}).values() for k in lv}
used = {s for n in nodes.values() for s in n['stats']} | {s for m in mods for k in range(1, 9) if m[f'Stat{k}'] is not None for s in [stats[m[f'Stat{k}']]['Id']]}
used |= {k for sk in skills.values() for k in skill_keys(sk)}
used |= {stats[x]['Id'] for r in load('SoulCoreStats') for x in [*r['Stats'], *r['BondedStats']]}   # runes, soul cores, idols (the item editor's sockets)
used |= {s for k in [*conquerors, *alt_over.values(), *alt_notables.values()] for s in k['stats']}   # the keystones timeless jewels put in place of the tree's, the notables Undying Hate's modifiers name
used |= {s for v in alt_versions for st in [*v.get('becomes', {}).values(), *v.get('plus', {}).values()] for s in st} | {to for v in alt_versions for _, to in v.get('extra', {}).values()}   # and what the passives they conquer become or get (Tribute)
kept = [d for d in descs.values() if used & set(d['stats'])]
# a skill's own .csd (it includes the general ones and overrides them): entries marked with the skills that use it
for csd, names in sorted(skill_csd.items()):
    if os.path.exists(p := os.path.join(ROOT, 'files', csd)):
        own = {}; parse_csd(p, own)
        mine = set().union(*(skill_keys(skills[n]) for n in names))
        kept += [{**d, 'skill': names} for d in own.values() if mine & set(d['stats'])]
row = lambda d, l: {'stats': d['stats'], 'rows': d['langs'].get(l) or d['langs']['English'], **({'skill': d['skill']} if 'skill' in d else {})}
save('stat_texts.json', [row(d, 'English') for d in kept])
for c, l in LANGS.items():
    save(f'stat_texts.{c}.json', [row(d, l) for d in kept])

# --- the character panel's list (CharacterPanelStats: the character's own sections, Life to Miscellaneous): each row's
# section, text, stat (the first of StatsKeys1; the other columns are conditions), how it is shown and its handlers
cp_tabs, cp_modes, cp_fns = load('CharacterPanelTabs'), load('CharacterPanelDescriptionModes'), load('StatDescriptionFunctions')
cp_langs, cp_tab_langs, cp_mode_langs = load_langs('CharacterPanelStats'), load_langs('CharacterPanelTabs'), load_langs('CharacterPanelDescriptionModes')
CP_TABS = ('Life', 'EnergyShield', 'Mana', 'Armour', 'Evasion', 'Deflection', 'Resistances', 'Blocking', 'Ward', 'Rage', 'Thorns',
           'Stun', 'Ailments', 'DamageTaken', 'DamageRedirect', 'Flasks', 'Charms', 'Charges', 'Infusions', 'Misc')
char_panel = {
    'sections': [{'id': t['Id'], 'name': plain(t['Text']), **tr(cp_tab_langs, t['_index'], 'Text')} for t in cp_tabs if t['Id'] in CP_TABS],
    'formats': {m['Id']: {'en': [m['FormatString_Positive'], m['FormatString_Negative']],
                          **{c: [rows[m['_index']]['FormatString_Positive'], rows[m['_index']]['FormatString_Negative']] for c, rows in cp_mode_langs.items()}} for m in cp_modes},
    'rows': [{'section': cp_tabs[r['CharacterPanelTabsKey']]['Id'], 'id': r['Id'], 'stat': stats[r['StatsKeys1'][0]]['Id'],
              'mode': cp_modes[r['CharacterPanelDescriptionModesKey']]['Id'], 'fn': [cp_fns[i]['Id'] for i in r['StatDescriptionFunctions']],
              **{k: re.sub(r'<[^>]*>\{(.*)\}', r'\1', v) for k, v in {'name': plain(r['Text']), **tr(cp_langs, r['_index'], 'Text')}.items()}}   # "<size:22>{text}": a smaller font
             for r in load('CharacterPanelStats') if cp_tabs[r['CharacterPanelTabsKey']]['Id'] in CP_TABS and r['StatsKeys1'] and r['Text']],
}
save('char_panel.json', char_panel)

# --- equipment: bases (with tags inherited through the .it files), implicits and rollable affixes with spawn tags
def read_it(p, cache={}):
    """tags + parent of a metadata/items/*.it file, following 'extends'."""
    p = p.lower()
    if p not in cache:
        tags, parent = [], None
        if os.path.exists(os.path.join(ROOT, 'files', p + '.it')):
            for line in text(p + '.it').splitlines():
                line = line.strip()
                if line.startswith('extends ') and '"nothing"' not in line:
                    parent = line.split('"')[1]
                elif line.startswith('tag = '):
                    tags.append(line.split('"')[1])
        cache[p] = tags + (read_it(parent) if parent else [])
    return cache[p]

tags_tab = load('Tags')
tag_ids = {t['Id'] for t in tags_tab}
SLOT_CLASSES = {  # ItemClasses.Name -> slots it can go in
    'Amulets': ['amulet'], 'Rings': ['ring1', 'ring2', 'ring3'], 'Belts': ['belt'], 'Gloves': ['gloves'], 'Boots': ['boots'],
    'Body Armours': ['body'], 'Helmets': ['helmet'], 'Shields': ['offhand'], 'Foci': ['offhand'], 'Bucklers': ['offhand'], 'Quivers': ['offhand'],
    **{c: ['weapon', 'offhand'] for c in ('Claws', 'Daggers', 'Wands', 'One Hand Swords', 'One Hand Axes', 'One Hand Maces', 'Sceptres', 'Spears', 'Flails')},
    'Jewels': ['jewel'], 'Life Flasks': ['flask1'], 'Mana Flasks': ['flask2'], 'Charms': ['charm1', 'charm2', 'charm3'],
    **{c: ['weapon'] for c in ('Bows', 'Staves', 'Two Hand Swords', 'Two Hand Axes', 'Two Hand Maces', 'Quarterstaves', 'Crossbows', 'Talismans')},
}
armour = {a['BaseItemType']: a for a in load('ArmourTypes')}
weapon = {w['BaseItemType']: w for w in load('WeaponTypes')}
shield_block = {s['BaseItemType']: s['Block'] for s in load('ShieldTypes')}   # a shield's chance to block, %
flasks = {f['BaseItemType']: f for f in load('Flasks')}
charges = {c['BaseItemTypesKey']: c for c in load('ComponentCharges')}   # a flask's (and charm's) most charges and charges per use
utility = load('UtilityFlaskBuffs')
# a charm's effect while it lasts: its buff (UtilityFlaskBuffs -> BuffDefinitions), the buff's stats with their values and its icon
def charm_of(fl):
    u = fl and fl['UtilityBuff'] and utility[fl['UtilityBuff'][0]]; d = u and buff_defs[u['BuffDefinition']]
    return d and {'buff': d['Id'], 'stats': dict(zip(map(sid, d['Stats']), u['StatValues'])), 'icon': _buff_icon.get(d['Id'])}
spirit = {s['BaseItemType']: s['SpiritGranted'] for s in load('ItemSpirit')}   # sceptres: 100
# the attributes a base needs worn (AttributeRequirements), only the ones it asks: {'str': 41, 'int': 41}
req = {r['BaseItemType']: {k: r['Req' + K] for k, K in (('str', 'Str'), ('dex', 'Dex'), ('int', 'Int')) if r['Req' + K]} for r in load('AttributeRequirements')}
visual = load('ItemVisualIdentity')
mods_tr = load_langs('Mods')
mod_stats = lambda m: [[stats[m[f'Stat{k}']]['Id'], *m[f'Stat{k}Value']] for k in range(1, 9) if m[f'Stat{k}'] is not None]
bases, implicit_ids = [], set()
# the skill an item gives with no gem ("Grants Skill: Purity of Fire"): a base's own (ItemInherentSkills: sceptres,
# staves, shields) and a modifier's (ModGrantedSkills), by the gem's name
base_types = load('BaseItemTypes')
gem_name = lambda sg: base_types[skill_gems[sg]['BaseItemType']]['Name']
inherent = {x['BaseItemType']: [gem_name(sg) for sg in x['SkillsGranted']] for x in load('ItemInherentSkills') if x['SkillsGranted']}
for i, b in enumerate(base_types):
    cls = classes[b['ItemClass']]['Name']
    if cls not in SLOT_CLASSES or not ok(b['Name']) or b['ModDomain'] not in (1, 2, 11) or b['Name'] not in trade_types:  # 1 item, 2 flask/charm, 11 jewel
        continue
    implicit_ids.update(b['Implicit_Mods'])
    a, w, fl = armour.get(i), weapon.get(i), flasks.get(i)
    bases.append({
        'id': b['Id'].split('/')[-1], 'name': b['Name'], **tr(bases_tr, i), 'class': cls, 'slots': SLOT_CLASSES[cls], 'level': b['DropLevel'], 'domain': b['ModDomain'],
        'tags': sorted(set(read_it(b['InheritsFrom']) + [tags_tab[t]['Id'] for t in b['Tags']])),
        'implicits': [mods[m]['Id'] for m in b['Implicit_Mods']],
        # (ward: the Runic Ward of a Runeforged / Runemastered base, only where it has any)
        'armour': a and {'armour': a['Armour'], 'evasion': a['Evasion'], 'energy_shield': a['EnergyShield'], 'movement_speed_%': a['IncreasedMovementSpeed'], **({'ward': a['Ward']} if a['Ward'] else {})},
        **({'block': shield_block[i]} if i in shield_block else {}),
        'img': visual[b['ItemVisualIdentity']]['DDSFile'] if b['ItemVisualIdentity'] is not None else None,
        'size': [b['Width'], b['Height']],
        'flask': fl and {'life': fl['LifePerUse'], 'mana': fl['ManaPerUse'], 'recovery_s': fl['RecoveryTime'] / 10, 'charges': charges[b['Id']]['MaxCharges'], 'per_use': charges[b['Id']]['PerCharge']},
        **({'charm': charm_of(fl)} if cls == 'Charms' else {}),
        'weapon': w and {'crit': w['CritChance'] / 100, 'attack_time_ms': w['Speed'], 'min': w['DamageMin'], 'max': w['DamageMax'], 'range': w['RangeMax'], **({'reload_ms': w['ReloadTime']} if w.get('ReloadTime') else {})},
        'spirit': spirit.get(i),
        **({'req': req[i]} if req.get(i) else {}),
        **({'grants': inherent[i]} if i in inherent else {}),
    })
# bases of one name (a Two-Stone Ring's three pairs of resistances, a Runeforged Grasping Mail's kinds of defence): one is
# kept, the last of the lowest drop level, with what each other has otherwise in its 'variants', by the game's id
def one_name(bases):
    out = {}
    for b in sorted(bases, key=lambda b: -b['level']): out.setdefault((b['class'], b['name']), []).append(b)
    for (*rest, kept) in out.values():
        var = {b['id']: {f: b.get(f) for f in sorted(set(b) | set(kept)) if f != 'id' and b.get(f) != kept.get(f)} for b in rest}
        if var := {k: d for k, d in var.items() if d}: kept['variants'] = var
    return [{k: v for k, v in g[-1].items() if k != 'id'} for g in out.values()]
# what a rune (soul core, talisman...) gives in a socket, every set of stats once ([[id, value, value], ...]): parseItem
# reads a "(rune)" line no modifier is worded like by these (SoulCoreStats; the Bonded ones are not counted)
rune_sets = list({tuple((sid(x), v, v) for x, v in zip(r['Stats'], r['StatsValues'])): 1 for r in load('SoulCoreStats') if r['Stats']})
assert any(x[0][0] == 'base_fire_damage_resistance_%' for x in rune_sets), 'SoulCoreStats'
# what can be socketed (runes, soul cores, idols...: SoulCores), for the item editor's sockets: its name, kind,
# (SoulCoreTypes), required level and, per item class it goes in, its stats and its Bonded ones (the Shaman's Wisdom of the Maji):
# by: [[classes, stats, bonded]]. A category with no item classes of its own (SoulCoreStatCategories "All", "Martial
# Weapon", "Armour") is the classes with weapon damage / defences, a "Martial ..." one those and its own
_bit, _sc_types = load('BaseItemTypes'), [t['Id'] for t in load('SoulCoreTypes')]
_martial = sorted({b['class'] for b in bases if b.get('weapon')})
_armour = sorted({b['class'] for b in bases if b.get('armour')})
def _sc_classes(c):
    own = [classes[i]['Name'] for i in c['TargetItemClasses']]
    return sorted({*own, *(_martial if c['Id'].startswith('Martial') else []), *(_armour if c['Id'] in ('Armour', 'All') else []),
                   *(_martial + ['Wands', 'Staves', 'Sceptres'] if c['Id'] == 'All' else [])})
_sc_cats = [_sc_classes(c) for c in load('SoulCoreStatCategories')]
_sc_stats = {}
for r in load('SoulCoreStats'):
    if r['Stats'] or r['BondedStats']:
        _sc_stats.setdefault(r['SoulCore'], []).append([_sc_cats[r['StatCategory']], [[sid(x), v] for x, v in zip(r['Stats'], r['StatsValues'])], [[sid(x), v] for x, v in zip(r['BondedStats'], r['BondedStatsValues'])]])
# limit: [n, group] how many may be socketed at a time (KeywordPopups "Ancient": "You may not have more than one Augment of
# this type socketed at a time"): of that one, or of its group (SoulCoreLimits with a text: Ancient Augment, Aldur's Legacy)
_sc_lim = load('SoulCoreLimits')
socketables = [{'name': _bit[c['BaseItemType']]['Name'], **tr(bases_tr, c['BaseItemType']), 'kind': _sc_types[c['Type']], 'level': c['RequiredLevel'],
                **({'limit': [(l := _sc_lim[c['Limit']])['Limit'], l['Id'] if l['Text'] else None]} if c['Limit'] is not None else {}),
                'by': _sc_stats[i]}
               for i, c in enumerate(load('SoulCores')) if i in _sc_stats and ok(_bit[c['BaseItemType']]['Name'])]
assert next(x for x in socketables if x['name'] == 'Lesser Desert Rune')['by'][2] == [_armour, [['base_fire_damage_resistance_%', 10]], [['base_maximum_life', 20], ['base_maximum_mana', 20]]], 'socketables'
assert next(b for b in bases if b['name'] == 'Ruby Charm')['charm']['stats'] == {'base_fire_damage_resistance_%': 25}, 'UtilityFlaskBuffs'
assert all(b.get('charm') and b['charm']['icon'] for b in bases if b['class'] == 'Charms'), 'a charm without its effect or icon'
assert next(b for b in bases if b['name'] == 'Lesser Life Flask')['flask'] == {'life': 50, 'mana': 0, 'recovery_s': 3.0, 'charges': 60, 'per_use': 10}, 'Flasks / ComponentCharges'
cs_langs = {'en': cs, **{c: {x['Id']: x['Text'] for x in rows} for c, rows in load_langs('ClientStrings').items()}}   # ClientStrings of each language
# a unique's modifier that is one of several, each drop with its own (Split Personality: a class start each; poe2db
# names a single one): the modifiers of its family together, for the item's own line to say which
# note: no table says a family's modifiers are one unique's alternatives; this one is seen on a character's jewel
FORM_FAMILIES = ('UniqueJewelGrantsAlternateClassStart',)
mod_forms = []
for fam_i, fam in enumerate(load('ModFamily')):
    if fam['Id'] in FORM_FAMILIES:
        mod_forms.append([{'id': m['Id'], 'stats': [[stats[m[f'Stat{k}']]['Id'], *m[f'Stat{k}Value']] for k in range(1, 9) if m[f'Stat{k}'] is not None]}
                          for m in mods if m['GenerationType'] == 3 and fam_i in m['Families']])
save('items.json', {
    'runes': rune_sets,
    'socketables': socketables,
    # their limits' words: "Limited to" (ClientStrings JewelItemLimit), a group's "{0} Ancient Augment" (SoulCoreLimits)
    'socketable_limits': {'': {'name': cs['JewelItemLimit'], **{f'name_{c}': v['JewelItemLimit'] for c, v in cs_langs.items() if c != 'en' and v.get('JewelItemLimit')}},
                          **{r['Id']: {'name': plain(r['Text']), **tr(load_langs('SoulCoreLimits'), i, 'Text')} for i, r in enumerate(_sc_lim) if r['Text']}},
    'socketable_kinds': {r['Id']: {'name': plain(r['Name']), **tr(load_langs('SoulCoreTypes'), i)} for i, r in enumerate(load('SoulCoreTypes'))},   # their kinds' names (Rune, Idol...)
    # a radius jewel's size by its radius (PassiveJewelRadii: 1000 is "Small"), as the item shows it ("Radius: Small")
    'jewel_radii': {r['Radius']: re.sub(r'(?<=[a-z])(?=[A-Z])', ' ', r['ID']) for r in load('PassiveJewelRadii')},
    # the rings a jewel can be limited to ("Only affects Passives in Medium-Large Ring": local_jewel_variable_ring_radius_value
    # 5, the fifth row): [inner, outer] radius
    'jewel_rings': [[r['RingInnerRadius'], r['RingOuterRadius']] for r in load('PassiveJewelRadii')],
    # what the tree multiplies every one of those radii by (GameConstants)
    'jewel_distance': game['PassiveTreeJewelDistanceMultiplier'],
    # how the game opens a radius jewel's line in each language (ClientStrings ModStatJewelAddTo*: "Small Passive Skills
    # in Radius also grant {0}", "[SmallPassive|Small Passive]" markup shown as its second part): {0} is the stat's line
    'radius_grant': {c: {k: re.sub(r'\[(?:[^|\]]*\|)?([^\]]*)\]', r'\1', t['ModStatJewelAddTo' + k.title()]).strip()
                         for k in ('small', 'notable')}
                     for c, t in cs_langs.items()},
    'bases': one_name(bases),
    'implicits': {mods[m]['Id']: mod_stats(mods[m]) for m in implicit_ids},
    # the tags of a modifier (Mods.ImplicitTags: elemental, lightning, resistance...), for catalyst quality
    'implicit_tags': {mods[m]['Id']: [tags_tab[t]['Id'] for t in mods[m]['ImplicitTags']] for m in implicit_ids if mods[m]['ImplicitTags']},
    # how an item says the level of the skill it grants, in each language (ClientStrings ItemDisplayGrantedSkill:
    # "Grants Skill: <underline>{{Level {1} {0}}}" shown as "Grants Skill: Level 11 Purity of Fire"): {0} the skill, {1} its level
    'grant_line': {c: re.sub(r'\{(?!\d\})|(?<!\{\d)\}', '', re.sub(r'<\w+>', '', t['ItemDisplayGrantedSkill']))
                   for c, t in cs_langs.items()},
    # the labels of a gem's and a waystone's properties in each language (ClientStrings: "Level", "Waystone Drop Chance",
    # "[ItemRarity|Item Rarity]" shown as its second part), by the trade site's filter of each (trade.js gemOf, wayOf)
    'trade_labels': {c: {f: re.sub(r'\[(?:[^|\]]*\|)?([^\]]*)\]', r'\1', t[k]).strip() for f, k in {
                         'gem_level': 'Level', 'map_revives': 'NumberOfPortalsPerWaystone',
                         'map_iir': 'ItemDisplayMapItemRarity', 'map_packsize': 'ItemDisplayMapPack', 'map_bonus': 'ItemDisplayMapWaystoneDropChance',
                         'map_magic_monsters': 'ItemDisplayMapMagicMonsterQuantityBonus', 'map_rare_monsters': 'ItemDisplayMapRareMonsterQuantityBonus',
                         'map_experience': 'ItemDisplayMapExperienceGained'}.items()}
                     for c, t in cs_langs.items()},
    'mod_grants': {mods[x['Mod']]['Id']: gem_name(x['Skill']) for x in load('ModGrantedSkills')},
    'mod_forms': mod_forms,
    # Way of the Stonefist (Martial Artist): the base worn gloves become (the Runeforged one too: 'runeforged'), with its
    # tags, art and implicits, and what each of their modifiers becomes, the game's own "HandWraps<id>" row of Mods
    # ("Strength1" -> "HandWrapsStrength1": Area of Effect)
    'fists': (lambda fs, w: {**fs[0], 'runeforged': fs[1],
                             'mods': {m['Id']: mod_stats(w['HandWraps' + m['Id'].rstrip('_')]) for m in mods if m['GenerationType'] in (1, 2) and 'HandWraps' + m['Id'].rstrip('_') in w}})(
        [{'name': f['Name'], **tr(bases_tr, f['_index']), 'tags': sorted(set(read_it(f['InheritsFrom']) + [tags_tab[t]['Id'] for t in f['Tags']])),
          'img': visual[f['ItemVisualIdentity']]['DDSFile'], 'implicits': {mods[m]['Id']: mod_stats(mods[m]) for m in f['Implicit_Mods']}}
         for f in base_types if '/FourGlovesDexIntAscendancy' in f['Id']], {m['Id']: m for m in mods if m['Id'].startswith('HandWraps')}),
    # Mageblood's legacies (UniqueMagesLegacy, picked by local_unique_mages_legacy_*, from 1): what each one grants
    'mages_legacy': [{'name': plain(r['DisplayText']), **tr(load_langs('UniqueMagesLegacy'), i, 'DisplayText'), 'stats': {stats[s]['Id']: v for s, v in zip(r['Stats'], r['StatValues'])}}
                     for i, r in enumerate(load('UniqueMagesLegacy'))],
    # catalyst quality on jewellery and jewels (AlternateQualityTypes): how each language shows it ("Quality (Lightning
    # Modifiers)", "Calidad (mods. de rayo)") -> the tag of the modifiers it makes stronger (JewelleryQualityLightning ->
    # lightning; Defence -> defences, the tag's own name)
    'catalysts': {q['Description']: next(t for t in (w, w + 's') if t in tag_ids)
                  for rows in [load('AlternateQualityTypes'), *load_langs('AlternateQualityTypes').values()] for q in rows
                  for w in [re.sub(r'^(Jewellery|CurrencyJewel)Quality', '', q['Id']).lower()]},
    'unique_img': {shown(u['WordsKey']): visual[u['ItemVisualIdentityKey']]['DDSFile'] for u in layout if u['ItemVisualIdentityKey'] is not None},
    'affixes': [{'id': m['Id'], 'name': m['Name'], **tr(mods_tr, i), 'affix': 'prefix' if m['GenerationType'] == 1 else 'suffix',
                 'level': m['Level'], 'domain': m['Domain'], 'family': m['Families'][0] if m['Families'] else None, 'stats': mod_stats(m),
                 'spawn': [[tags_tab[t]['Id'], v] for t, v in zip(m['SpawnWeight_Tags'], m['SpawnWeight_Values'])],
                 **({'tags': [tags_tab[t]['Id'] for t in m['ImplicitTags']]} if m['ImplicitTags'] else {}),
                 **({'desecrated': True} if m['Domain'] == 28 else {}),
                **({'historic': True} if m['Id'].startswith('HistoricAbyssJewel') else {}),
                 # a radius jewel's modifier is given by the passives in its radius (Mods.RadiusJewelType: 1 small ones,
                 # 2 notable ones; "Small Passive Skills in Radius also grant ...")
                 **({'radius': {1: 'small', 2: 'notable'}[m['RadiusJewelType']]} if m.get('RadiusJewelType') in (1, 2) else {})}
                # desecrated modifiers (Abyss: "Ulaman's", "of Kurgal"...) are AbyssMod* of domain 28, for any item their tags fit
                for i, m in enumerate(mods) if (m['Domain'] in (1, 2, 11) or m['Domain'] == 28 and m['Id'].startswith('AbyssMod'))
                # an essence's modifiers ("Essences", "of the Essence") never roll (no spawn weight): only read on an item
                and m['GenerationType'] in (1, 2) and (any(m['SpawnWeight_Values']) or m['Domain'] == 1 and m['Name'] in ('Essences', 'of the Essence'))
                # what desecrating an Undying Hate adds (HistoricAbyssJewel*: its conquered passives' bonuses, a notable they become)
                or m['Id'].startswith('HistoricAbyssJewel') and any(m['SpawnWeight_Values'])],
})

# --- the loot filter creator (filter.js): every item class and base the trade list has, with the names each language
# shows (a .filter file names them in English)
classes_tr = load_langs('ItemClasses')
seen, fbases, fclasses = set(), [], {}
for i, b in enumerate(load('BaseItemTypes')):
    c = b['ItemClass']
    cls = classes[c]['Name'] if c is not None else ''
    if not cls or not ok(b['Name']) or b['Name'] not in trade_types or (cls, b['Name']) in seen:
        continue
    seen.add((cls, b['Name']))
    fclasses.setdefault(cls, c)
    fbases.append({'name': b['Name'], **tr(bases_tr, i), 'class': cls})
save('filter.json', {'classes': [{'name': n, **tr(classes_tr, c)} for n, c in sorted(fclasses.items())], 'bases': fbases})

# --- currency the trade site prices items in: its id there (api/trade2/data/static, downloaded like the trade list)
# -> the game's name in every language and its art (BaseItemTypes, by the English name); `price` is the order of the
# trade site's price filter (api/trade2/data/filters), whose first option (no currency) is "Exalted Orb Equivalent"
def trade_data(what):
    path = os.path.join(ROOT, 'poe2db_cache', f'trade2_{what}.json')
    try:
        req = urllib.request.Request('https://www.pathofexile.com/api/trade2/data/' + what, headers={'User-Agent': 'Mozilla/5.0 (personal build planner)'})
        data = urllib.request.urlopen(req, timeout=30).read()
        json.loads(data)['result']
        open(path, 'wb').write(data)
    except Exception as e:
        print(f'trade {what} download failed, using cached copy:', e)
    return json.load(open(path, encoding='utf8'))['result']
by_name, bit = {}, load('BaseItemTypes')
for i, b in enumerate(bit):
    if classes[b['ItemClass']]['Name'] == 'Stackable Currency' and ok(b['Name']):
        by_name.setdefault(b['Name'], i)
cur_out = {}
for e in next(g for g in trade_data('static') if g['id'] == 'Currency')['entries']:
    i = by_name.get(e['text'])
    if i is not None:
        cur_out[e['id']] = {'name': bit[i]['Name'], **tr(bases_tr, i), 'img': visual[bit[i]['ItemVisualIdentity']]['DDSFile']}
price_opts = next(f for g in trade_data('filters') for f in g['filters'] if f['id'] == 'price')['option']['options']
save('currency.json', {'price': [o['id'] or '' for o in price_opts if not o['id'] or o['id'] in cur_out or o['id'] == 'exalted_divine'], 'currency': cur_out})

# --- what the trade site's bulk exchange (Currency Exchange) lists, every group of its static data (api/trade2/data/
# static): its id there -> the game's name in every language (BaseItemTypes, by the English name: "Uncut Skill Gem
# (Level 19)", "Waystone (Tier 15)" are bases of their own), for the price check of a stackable item (trade.js priceBulk)
any_name = {}
for i, b in enumerate(bit):
    if ok(b['Name']):
        any_name.setdefault(b['Name'], i)
bulk = []
for g in trade_data('static'):
    for e in g['entries']:
        i = any_name.get(e.get('text'))
        if i is not None:
            bulk.append({'id': e['id'], 'name': bit[i]['Name'], **tr(bases_tr, i)})
assert len(bulk) > 500 and any(x['id'] == 'divine' for x in bulk), 'bulk.json: the bulk exchange'
save('bulk.json', bulk)


# --- monsters of the 3D scene (enemies.js): every monster with its own multipliers, resistances and skills, and the
# per-level tables that turn the multipliers into life, armour, evasion, accuracy and damage
ELEMENTS = ('physical', 'fire', 'cold', 'lightning', 'chaos')
KEEP = re.compile(r'area_of_effect|radius|number_of_(?:additional_)?projectiles|number_of_chains|base_skill_effect_duration|'
                  r'chance_to_(?:poison|bleed)|ignite_chance|shock_chance|freeze|maim|knockback|_damage_\+%_final|'
                  r'^(?:active_skill_|melee_)?hit_damage_stun_multiplier_\+%(?:_final)?$|^base_stun_duration_\+%$')
filled = lambda d: {k: v for k, v in d.items() if v not in (None, {}, [], '', 0, False)}


def monster_skill(e):
    a = active_skills[e['ActiveSkill']] if e['ActiveSkill'] is not None else {}
    kinds, sets, shot = set(types(a.get('ActiveSkillTypes') or [])), [], None
    for i in [e['StatSet']] + e['AdditionalStatSets']:
        s, lv = ss_tab[i], (ss_lvl.get(i) or [{}])[0]
        on = {sid(x) for x in s['ImplicitStats'] + lv.get('AdditionalFlags', [])}
        const = dict(zip(map(sid, s['ConstantStats']), s['ConstantStatsValues']))
        shot = shot or const.get('monster_projectile_variation')
        # level-1 values with their interpolation: 3 = a share of the effectiveness of the monster's level (enemies.js
        # works it out), anything else is the number itself
        vals = {sid(x): (f if it == 3 else r, it) for x, f, r, it in
                zip(lv.get('FloatStats', []), lv.get('FloatStatsValues', []), lv.get('BaseResolvedValues', []), lv.get('StatInterpolations', []))}
        # a skill of both types (the beams) has its own damage values, like a spell
        flags = sorted(f for f, yes in (('attack', 'Attack' in kinds and 'Spell' not in kinds), ('spell', 'Spell' in kinds), ('melee', 'Melee' in kinds), ('area', 'Area' in kinds),
                                        ('duration', 'Duration' in kinds), ('projectile', 'base_is_projectile' in on)) if yes)
        hit, dot = {}, {}
        for el in ELEMENTS:
            lo, hi = vals.get(f'spell_minimum_base_{el}_damage'), vals.get(f'spell_maximum_base_{el}_damage')
            if lo and hi and hi[0]:
                hit[el] = [round(lo[0], 6), round(hi[0], 6), lo[1]]
            d = vals.get(f'base_{el}_damage_to_deal_per_minute')
            if d and d[0]:   # a share of the effectiveness is per second, in thousandths
                dot[el] = [round(d[0] * 1000 / 60, 6) if d[1] == 3 else d[0], d[1]]
        sets.append(filled({
            'label': labels[s['Label']]['Text'] if s['Label'] is not None else None,
            'eff': [round(s[k], 6) for k in ('BaseEffectiveness', 'IncrementalEffectiveness', 'DamageIncrementalEffectiveness')],
            'hit': hit, 'dot': dot,
            'convert': {el: const[k] for el in ELEMENTS if const.get(k := f'active_skill_base_physical_damage_%_to_convert_to_{el}')},
            'no_damage': 'base_deal_no_damage' in on, 'area': 'is_area_damage' in on,
            'unblockable': 'base_cannot_be_blocked' in on or not ('base_skill_can_be_blocked' in on or 'attack' in flags),
            'const': {k: v for k, v in const.items() if KEEP.search(k)},
        }) | {'flags': flags})
    lv, gl = (ss_lvl.get(e['StatSet']) or [{}])[0], (ge_lvl.get(id(e)) or [{}])[0]
    return filled({
        # game units per second (10 = 1 m), like the gems' projectile_speed
        'proj_speed': (shots_attack if 'Attack' in kinds else shots_spell).get(shot, 0) / 10,
        'name': a.get('DisplayedName'), 'types': sorted(kinds), 'cast': e['CastTime'] / 1000,
        'cooldown': gl.get('Cooldown', 0) / 1000, 'uses': gl.get('StoredUses'), 'speed': gl.get('AttackSpeedMultiplier'),
        'crit': (lv.get('SpellCritChance') or lv.get('AttackCritChance') or 0) / 100,
        'mult': 1 + lv['BaseMultiplier'] / 10000 if lv.get('BaseMultiplier') else None,
        'description': plain(a.get('Description')), 'sets': sets,
    })


labels, world = load('GrantedEffectLabels'), load('WorldAreas')
# the projectile a monster skill fires: its "monster_projectile_variation" number -> Projectiles row
shots_spell, shots_attack = ({r['Id']: proj_tab[r['Projectile']]['ProjectileSpeed'] for r in load(t) if r['Projectile'] is not None}
                             for t in ('MonsterProjectileSpell', 'MonsterProjectileAttack'))
varieties, varieties_tr, mtypes, mres, mcats = load('MonsterVarieties'), load_langs('MonsterVarieties'), load('MonsterTypes'), load('MonsterResistances'), load('MonsterCategories')
# Where each monster is met, by name (its varieties share the list, as in Path of Building 2's export): the areas of the
# packs it is part of, the maps those packs are native to, and the areas it is the boss of.
def place(w):
    floor = re.match(r'Sanctum_(\d+)', w['Id'])
    if w['Id'] == 'G_Endgame_Town':   # the endgame's hub: the packs listed there are the ones any map can have
        return 'Found in Maps'
    return w['Name'] + (' (Map)' if 'map' in [tags_tab[t]['Id'] for t in w['Tags']] else f' (Floor {floor[1]})' if floor
                        else f" (Act {w['Act']})" if w['Act'] != 10 and not w['Id'].startswith('Sanctum') else '')


named = lambda w: ok(w['Name']) and w['Name'] != 'NULL'
packs, areas, in_pack, area_bosses = load('MonsterPacks'), {}, {}, set()
pack_areas = [{place(world[w]) for w in p['WorldAreas'] if named(world[w])} for p in packs]
for x in load('EndGameMaps'):
    for pi in x['MonsterPacks'] if x['WorldArea'] is not None and named(world[x['WorldArea']]) else []:
        pack_areas[pi].add(place(world[x['WorldArea']]))
for x in load('MonsterPackEntries'):
    in_pack.setdefault(x['MonsterPacksKey'], []).append(x['MonsterVarietiesKey'])
for pi, p in enumerate(packs):
    for k in p['BossMonsters'] + p['AdditionalMonsters'] + in_pack.get(pi, []):
        if k is not None:
            areas.setdefault(varieties[k]['Name'], set()).update(pack_areas[pi])
for w in world:
    area_bosses.update(w['Bosses_MonsterVarietiesKeys'])
    for k in w['Bosses_MonsterVarietiesKeys'] if named(w) else []:
        areas.setdefault(varieties[k]['Name'], set()).add(place(w))
def mod_stats(ids):
    out = {}
    for i in ids:
        for j in range(1, 7):
            if mods[i].get(f'Stat{j}') is not None:
                out[sid(mods[i][f'Stat{j}'])] = out.get(sid(mods[i][f'Stat{j}']), 0) + mods[i][f'Stat{j}Value'][0]
    return out


monsters, mskills, seen = [], {}, {}
for i, m in enumerate(varieties):
    if not ok(m['Name']) or not re.search(r'[A-Za-z]{2}', m['Name']):
        continue
    t = mtypes[m['MonsterType']]
    res = mres[t['MonsterResistances'][0]] if t['MonsterResistances'] else None
    mon = {'id': m['Id'], 'name': m['Name'], **tr(varieties_tr, i), **filled({
        'category': mcats[m['MonsterCategory']]['Name'] if m['MonsterCategory'] is not None else None,
        'boss': 'Boss' in m['Id'] or m['BossHealthBar'] or i in area_bosses,
        'es': t['EnergyShieldFromLife'] / 100, 'armour': t['Armour'] / 100, 'evasion': t['Evasion'] / 100,
        'crit': round(m['AttackCrit'] * 100, 2), 'ranged': 'ranged' in [tags_tab[x]['Id'] for x in m['Tags']],
        'areas': sorted(areas.get(m['Name'], ())), 'skills': [ge_tab[g]['Id'] for g in m['GrantedEffects']],
        # its own mods' attack speed (Raging Spirit: 40% more)
        'attack_speed': {k: v for k, v in mod_stats(m['Mods'] + m['Special_Mods']).items() if k in ('attack_speed_+%', 'active_skill_attack_speed_+%_final')}}),
        'life': m['LifeMultiplier'] / 100, 'damage': m['DamageMultiplier'] / 100, 'spread': t['DamageSpread'] / 100,
        'res': [res[el + '1'][0] if res else 0 for el in ('Fire', 'Cold', 'Lightning', 'Chaos')],
        'attack_time': m['AttackSpeed'] / 1000, 'range': m['MaximumAttackDistance'], 'speed': m['MovementSpeed'], 'aggro': m['MaxAgroRange'],   # game units: 10 = 1 m, like the player's speed
        # note: MonsterTypes has this flag in a column the schema has no name for, so extract.mjs leaves it out; all
        # but 2 of the 598 monsters Path of Building 2 exports have it. Read that column if those two ever matter
        'ignores_attack_speed': True}
    same = json.dumps({k: v for k, v in mon.items() if k not in ('id', 'areas', 'aggro')}, sort_keys=True)
    if same in seen:   # the same monster placed somewhere else: one entry, all its areas
        seen[same]['areas'] = sorted(set(seen[same].get('areas', []) + mon.get('areas', [])))
        continue
    seen[same] = mon
    monsters.append(mon)
    mskills.update({ge_tab[g]['Id']: g for g in m['GrantedEffects']})
monsters.sort(key=lambda m: (m['name'], m['id']))
mon_stats = ot_stats(text('metadata', 'monsters', 'monster.ot'))
dms = load('DefaultMonsterStats')
# what a monster's rarity adds (Mods MonsterMagic<n>, MonsterRare<n>, MonsterUnique<n>): +% final life, energy shield, damage
# and how much less it takes from poise (stun / freeze buildup), slows, curses and exposure
RARITY_STATS = {'monster_life_+%_final_from_rarity': 'life', 'monster_energy_shield_+%_final_from_rarity': 'es', 'monster_rarity_damage_+%_final': 'damage',
                'poise_threshold_+%_final_from_rarity': 'poise', 'slow_potency_+%_final_from_rarity': 'slow', 'curse_effect_on_self_+%_final_from_rarity': 'curse',
                'exposure_effect_on_self_+%_final_from_rarity': 'exposure'}
rarity = {}
for m in mods:
    r = re.fullmatch(r'Monster(Magic|Rare|Unique)\d+', m['Id'])
    for j in range(1, 7):
        if r and m.get(f'Stat{j}') is not None and stats[m[f'Stat{j}']]['Id'] in RARITY_STATS:
            rarity.setdefault(r[1].lower(), {})[RARITY_STATS[stats[m[f'Stat{j}']]['Id']]] = m[f'Stat{j}Value'][0]
# --- a waystone's modifiers (enemies.js): the area's Mods (domain 6) that are a prefix or a suffix (the others never roll
# on one: 'Monsters steal charges' is in the table and on no waystone of the trade site) and roll on the waystones' own tags
# (map_key_low / medium / high / highest) or on any item (default: the same rolls at every tier), one entry per kind with
# its rolls at each tag. Left out: the areas' curse zones ('Players are periodically Cursed with ...'), whose curse the
# tables have no values for (ModType DoedreCurseZoneAura*: stats without a Mod). Its stats are those the item's
# text words (stat_descriptions.csd): the rewards, worded in the item's header (map_stat_descriptions.csd), are left out,
# and of a patch of ground its radius is kept (radius, game units), not how many the area has nor its art. And each
# tier's waystone: its names, area level (MapTiers) and tag
worded = {s for d in descs.values() for s in d['stats']}
map_level = {r['Tier']: r['Level'] for r in load('MapTiers')}
map_tiers, map_mods = {}, {}
for i, b in enumerate(base_types):
    r = re.fullmatch(r'Metadata/Items/Maps/MapKeyTier(\d+)', b['Id'])
    if r:
        map_tiers[int(r[1])] = {'name': b['Name'], **tr(bases_tr, i), 'level': map_level[int(r[1])],
                                'tag': next(tags_tab[t]['Id'][8:] for t in b['Tags'] if tags_tab[t]['Id'].startswith('map_key_'))}
for m in mods:
    if m['Domain'] != 6 or m['GenerationType'] not in (1, 2):
        continue
    w = {tags_tab[t]['Id']: v for t, v in zip(m['SpawnWeight_Tags'], m['SpawnWeight_Values'])}
    on = [k[8:] for k, v in w.items() if v and k.startswith('map_key_')] or sorted({t['tag'] for t in map_tiers.values()} if w.get('default') else [])
    rolls = [(sid(m[f'Stat{j}']), m[f'Stat{j}Value']) for j in range(1, 9) if m.get(f'Stat{j}') is not None and sid(m[f'Stat{j}']) in worded]
    if not on or any(s.endswith('_curse_zones') for s, _ in rolls):
        continue
    kind = re.sub(r'\d+$', '', m['Id'])
    e = map_mods.setdefault(kind, {'id': kind, 'stats': [s for s, _ in rolls], 'rolls': {}})
    assert e['stats'] == [s for s, _ in rolls] and rolls, ('a waystone modifier whose tiers word other stats', m['Id'])
    for tag in on:
        e['rolls'][tag] = [v for _, v in rolls]
    for j in range(1, 9):
        if m.get(f'Stat{j}') is not None and sid(m[f'Stat{j}']) == 'map_ground_effect_radius':
            assert e.setdefault('radius', m[f'Stat{j}Value'][0]) == m[f'Stat{j}Value'][0], ('a patch of ground whose radius changes with the tier', m['Id'])
with open(os.path.join(OUT, 'monsters.json'), 'w', encoding='utf8') as f:
    json.dump({
        # index = monster level - 1
        'tables': {k: [round(r[c], 2) for r in dms] for k, c in (('life', 'MonsterLife'), ('damage', 'Damage'), ('armour', 'Armour'), ('evasion', 'Evasion'), ('accuracy', 'Accuracy'), ('ally_damage', 'MinionDamage'),
            # % more elemental / chaos damage of a monster at the level (stats non_player_minion_{elemental,chaos}_damage_+%_final_from_monster_level)
            ('more_elemental', 'MoreElementalDamage'), ('more_chaos', 'MoreChaosDamage'), ('leech', 'LeechResistance'), ('leech_rare', 'RareUniqueLeechResistance'),
            # what a hit has to deal to inflict an ailment (Elemental Ailment Threshold) and to fill the stun / freeze bar (poise)
            ('ailment', 'AilmentThreshold'), ('poise', 'PoiseThreshold'))},
        'constants': {
            'skill_effectiveness': game['SkillDamageBaseEffectiveness'],
            'monster_crit_bonus': mon_stats.get('base_critical_hit_damage_bonus'), 'monster_max_resistance': mon_stats.get('base_maximum_all_resistances_%'),
            'monster_max_physical_reduction': mon_stats.get('maximum_physical_damage_reduction_%'),
            'player_max_resistance': char_stats.get('base_maximum_all_resistances_%'), 'player_max_physical_reduction': char_stats.get('maximum_physical_damage_reduction_%'),
            'player_max_evade': game['DefaultMaxEvadeChancePercent'], 'player_crit_bonus': char_stats.get('base_critical_hit_damage_bonus'),
            'es_recharge_delay_ms': game['BaseShieldRegenCooldownTimeMs'], 'es_recharge_per_minute': char_stats.get('energy_shield_recharge_rate_per_minute_%'),
            'player_max_block': char_stats.get('object_inherent_base_maximum_block_%_from_ot'),
            'leech_max_damage': game['EffectiveMaxDamageForLeech'], 'low_pct': game['DefaultLowStatusThresholdPercent'],   # "low life" is below this %   # a hit leeches as if it dealt at most this much
            # ailments: % of the hit dealt per minute, and how long they last
            'ignite_per_minute': game['IgniteHitDamagePercentPerMinute'], 'ignite_duration': game['BaseIgniteDuration'],
            'bleed_per_minute': game['BleedingHitDamagePercentPerMinute'], 'bleed_duration': game['BaseBleedingDuration'],
            'poison_per_minute': game['PoisonHitDamagePercentPerMinute'], 'poison_duration': game['BasePoisonDuration'],
            # every other ailment rule on a monster, as GameConstants names it (chance multipliers, buildup scales, durations,
            # the harder-to-freeze / stun window after one), plus the monster's own heavy stun length and poise decay (monster.ot)
            'game': {k: v for k, v in game.items() if re.match(r'(Shock|Ignite|MiscAilment|AilmentChance|Chill|Freeze|HeavyStun|Electrocute|Pin|BaseShock|BaseChill|BaseFlammability|CullingStrike|JaggedGround)', k) and not k.endswith('Player')},
            # the same rules where the game has its own for a player hit by a monster (FreezeDurationPlayer...), without "Player"
            'player': {k[:-6]: v for k, v in game.items() if k.endswith('Player') and re.match(r'(Freeze|BaseChill|BaseShock|BaseFlammability|HeavyStun|Electrocute|Pin)', k)},
            'heavy_stun_ms': mon_stats.get('base_heavy_stun_duration_ms'), 'poise_decay_delay_ms': mon_stats.get('poise_decay_delay_ms'), 'poise_decay_per_second': mon_stats.get('poise_decay_%_per_second'),
            # what a monster's hit does to your stun: more for physical and melee hits (monster.ot), and how fast your bars
            # empty (character.ot)
            'stun_physical': mon_stats.get('physical_hit_damage_stun_multiplier_+%_final_from_ot'), 'stun_melee': mon_stats.get('melee_hit_damage_stun_multiplier_+%_final_from_ot'),
            # light stun on you (players cannot be heavily stunned by plain hits: KeywordPopups HeavyStunPlayer): its length,
            # the least chance that counts, and the higher threshold for each stun in the last few seconds (character.ot)
            'player_light_stun_ms': char_stats.get('stun_base_duration_override_ms'), 'player_light_stun_min': game['LightStunMinimumChancePlayer'],
            # light stun on a monster: its length (monster.ot) and the least chance that counts
            'light_stun_ms': mon_stats.get('stun_base_duration_override_ms'), 'light_stun_min': game['LightStunMinimumChance'],
            'player_light_stun_repeat_pct': char_stats.get('light_stun_threshold_+%_final_per_number_of_times_stunned_in_past_duration_from_ot'),
            'player_light_stun_repeat_ms': char_stats.get('x_ms_for_number_of_times_stunned_in_past_duration_from_ot'),
            'player_poise_decay_delay_ms': char_stats.get('poise_decay_delay_ms'), 'player_poise_decay_per_second': char_stats.get('poise_decay_%_per_second'),
        },
        'monsters': monsters, 'rarity': rarity,
        # the modifiers a magic or rare monster can roll (Mods, monster domain, with a spawn weight): name ('TBD' left
        # out), prefix/suffix and stats; Rarity has no monster mod count, so the app lets you pick them. An aura's
        # (BuffTemplates): its radius in game units and whether it is on its enemies (BuffDefinitions BuffCategory 2,
        # a debuff) or on its allies and itself (1)
        'mods': [{'id': m['Id'], **({'name': m['Name'], **tr(mods_tr, i)} if m['Name'] and m['Name'] != 'TBD' else {}),
                  'affix': 'prefix' if m['GenerationType'] == 1 else 'suffix', 'stats': mod_stats([i]),
                  **({'aura': {'r': t['AuraRadius'], 'foe': buff_defs[t['BuffDefinition']]['BuffCategory'] == 2}}
                     if (t := m['BuffTemplate'] is not None and _tmpl[m['BuffTemplate']]) and t['AuraRadius'] else {})}
                 for i, m in enumerate(mods) if m['Domain'] == 3 and m['GenerationType'] in (1, 2) and any(m['SpawnWeight_Values']) and mod_stats([i])],
        'skills': {k: monster_skill(ge_tab[g]) for k, g in sorted(mskills.items())},
        'map': {'tiers': [map_tiers[k] for k in sorted(map_tiers)], 'mods': list(map_mods.values())},
    }, f, ensure_ascii=False, separators=(',', ':'))
print(f'monsters.json {len(monsters)} monsters ({sum(1 for m in monsters if m.get("boss"))} bosses), {len(mskills)} skills')

# --- self-check: a column renamed by a patch has to fail here, not show up as "—" in the app
assert plain('[Knockback|Knocking Back] a [Projectile]') == 'Knocking Back a Projectile'
assert all(s['levels'] for s in skills.values()), 'a gem without stats per level'
assert skills['Fireball']['cast_time_ms'] and skills['Fireball']['levels'][20]['spell_minimum_base_fire_damage'] > 0
assert all(char_stats.get(k) for k in ('life_per_level', 'mana_per_level', 'energy_shield_delay_ms', 'ailment_threshold_life_%')), 'character.ot / GameConstants'
assert char_stats['ignite_%_per_second'] == 20 and char_stats['ignite_duration_s'] == 4, 'GameConstants: Ignite'
assert char_stats['base_maximum_rage'] == 30, 'GameConstants: BaseMaximumRage'
assert minion_stats['minion_damage_+%'] == 'damage_+%' and minion_intrinsic['base_critical_hit_damage_bonus'] == 70, 'MinionStats / PlayerMinionIntrinsicStats'
assert next(m for m in monsters if m['id'] == 'Metadata/Monsters/RagingSpirit/RagingSpiritPlayerSummoned')['attack_speed'] == {'active_skill_attack_speed_+%_final': 40}, "a monster variety's mods"
assert all(c.get(k) for c in chars if ok(c['Name']) for k in ('BaseMaxLife', 'BaseMaxMana')), 'Characters base life / mana'
assert all(b['spirit'] for b in bases if b['class'] == 'Sceptres'), 'ItemSpirit: a sceptre without its Spirit'
assert [['base_spirit', 30]] in quest_rewards and len(res_penalty) == 100 and res_penalty[0] == 0 > res_penalty[-1], 'QuestStaticRewards / ResistancePenaltyPerAreaLevel'
assert skills['Berserk']['quality'] and skills['Berserk']['alt_quality'], 'GrantedEffectQualityStats'
assert any(m['Domain'] == 28 and m['Id'] == 'AbyssModCrossbowUlamanPrefixMaximumRangedAttackTotems' for m in mods), 'desecrated modifiers (Mods.Domain 28)'
assert next(m for m in mods if m['Id'] == 'JewelRadiusPhysicalDamage')['RadiusJewelType'] == 1, 'Mods.RadiusJewelType: 1 = small passives'
assert all(k in game for k in ('ShockChanceMultiplier', 'IgniteChanceMultiplier', 'BaseShockMagnitude', 'ChillEffectMultiplier', 'ChillMaxEffect', 'BaseChillDuration',
    'BaseShockDuration', 'FreezeDuration', 'FreezeDamageScale', 'FreezeThresholdModifier', 'FreezeModifierDuration', 'HeavyStunDamageScale',
    'HeavyStunThresholdModifier', 'HeavyStunModifierDuration', 'BaseFlammabilityDuration')) and all(mon_stats.get(k) for k in ('base_heavy_stun_duration_ms', 'poise_decay_delay_ms', 'poise_decay_%_per_second')), 'GameConstants / monster.ot: ailment rules'
assert skills['Shockwave Totem']['levels'][20]['_base_multiplier'] == 6600 and skills['Artillery Ballista']['levels'][20]['_base_multiplier'] == 4000, "a totem's own attack"
assert skills['Glacial Cascade']['part']['active_skill_consume_enemy_freeze_to_gain_damage_against_unique_+%_final'] > 0 and 'never_freeze' in skills['Glacial Cascade']['flags'], 'other stat sets of a skill'
assert rarity['unique']['poise'] == 500 and rarity['rare']['curse'] == -30, 'monster rarity: poise / curse effect'
assert sorted(map_tiers) == list(range(1, 17)) and map_tiers[16] == {**map_tiers[16], 'level': 80, 'tag': 'highest'}, 'waystone tiers (BaseItemTypes MapKeyTier<n>, MapTiers)'
assert all(e['rolls'] and set(e['rolls']) <= {'low', 'medium', 'high', 'highest'} and all(lo <= hi for r in e['rolls'].values() for lo, hi in r) for e in map_mods.values()) and map_mods['MapMonsterDamageAsFire']['rolls']['high'] == [[15, 19]] and map_mods['MapSpreadChilledGround']['radius'] == 26     and 'MapMonstersStealCharges' not in map_mods and set(map_mods['MapMonsterSpeedIncrease']['rolls']) == {'high', 'highest'} and map_mods['MapMonsterArmoured']['rolls'] == {t: [[35, 55]] for t in ('low', 'medium', 'high', 'highest')}, 'waystone modifiers (Mods domain 6, map_key_ tags or default)'
assert rarity['unique']['life'] > rarity['rare']['life'] > rarity['magic']['life'] > 0 and rarity['unique']['damage'] < 0, ('monster rarity mods', rarity)
assert skills['Orb of Storms']['radius'][12] == 36, 'the radius of a table_only row'
assert skills['Mortar Cannon']['meta_support']['support_grenade_ballista_attack_speed_+%_final'] == -50, 'meta_support'
assert skills['Mortar Cannon']['totem'] == {'life_mult': 1, 'ballista': True, 'armour': 100} and skills['Shockwave Totem']['totem']['armour'] == 0 and skills['Ancestral Warrior Totem']['totem'] == {'life_mult': 1, 'ballista': False, 'armour': 0} and minion_level[17] == 36, 'SkillTotemVariations / MinionGemLevelScaling'
assert any('Berserk' in d.get('skill', ()) and 'skill_base_rage_effect_+%_to_apply' in d['stats'] for d in kept), 'ActiveSkills.StatDescription'
assert skills['Rolling Slam']['weapons'] == ['One Hand Maces', 'Two Hand Maces'] and not skills['Fireball']['weapons'], 'ActiveSkillWeaponRequirement'
assert len(monsters) > 1000 and any(m.get('areas') for m in monsters) and any(s.get('proj_speed') for s in map(monster_skill, ge_tab[:2000]))
assert skills['Orb of Storms']['levels'][20]['_cost'] == {'Mana': 129} and skills['Runic Tempering']['levels'][20]['_cost'] == {'ManaPerSecond': 19.6}, 'GrantedEffectsPerLevel.CostAmounts'
assert any(s.get('constant', {}).get('_cost_multiplier') == 120 or any(L.get('_cost_multiplier') == 120 for L in s.get('levels', {}).values()) for s in skills.values()) and '_cost_multiplier' not in str(skills['Mortar Cannon']), 'GrantedEffectsPerLevel.CostMultiplier'
assert next(g for g in gems if g['name'] == 'Berserk')['buff_icon'] == 'Art/2DArt/BuffIcons/Beserk.dds' and next(g for g in gems if g['name'] == 'Rite of Restoration')['buff_icon'].endswith('HuskOfDreamsBuff.dds'), 'BuffDefinitions / BuffVisuals'
assert game['FreezeDurationPlayer'] == 2 and game['FreezeDamageScalePlayer'] == 2 and game['BaseChillDurationPlayer'] == 2 and game['BaseShockDurationPlayer'] == 4, 'GameConstants: the player ones'
assert char_stats.get('base_heavy_stun_duration_ms') and char_stats.get('poise_decay_%_per_second') and mon_stats.get('physical_hit_damage_stun_multiplier_+%_final_from_ot'), 'character.ot / monster.ot: heavy stun on you'
