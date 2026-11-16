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


def tr(by_lang, i, field='Name', key='name'):
    """{'name_es': ..., 'name_fr': ...} for row i (or row by key for dict tables); empty texts left out."""
    out = {}
    for c, rows in by_lang.items():
        r = rows.get(i) if isinstance(rows, dict) else rows[i] if i is not None and i < len(rows) else None
        if r and r.get(field):
            out[f'{key}_{c}'] = plain(r[field])
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
        gems[-1].update(description=plain(ex.get(desc_col)), **tr(gem_effects_tr, g['GemEffects'][0], desc_col, 'description') if g['GemEffects'] else {})
        gems[-1].update(icon=sr['Icon'], family=[support_family[f]['Id'] for f in sr['Family']], lineage=sr['IsLineage'],
                        require=types(ge['AllowedActiveSkillTypes']), exclude=types(ge['ExcludedActiveSkillTypes']),
                        adds=types(ge['AddedActiveSkillTypes']), gems_only=ge['SupportsGemsOnly'])
    elif ge and ge['ActiveSkill'] is not None:
        a = active_skills[ge['ActiveSkill']]
        gems[-1].update(icon=a['Icon_DDSFile'], types=types(a['ActiveSkillTypes']), cannot_be_supported=ge['CannotBeSupported'],
                        # text for the skill's info window (ActiveSkills.Description, per language)
                        description=plain(a.get('Description')), **tr(active_skills_tr, ge['ActiveSkill'], 'Description', 'description'))
save('gems.json', gems)

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
save('passive_tree.json', {'class_roots': roots, 'attribute_options': attr_opts, 'groups': centres, 'orbit_radii': radii, 'nodes': {str(k): v for k, v in nodes.items()}})

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

# --- rollable item mods: prefix/suffix on items with some non-zero spawn weight
mods = load('Mods')
save('item_mods.json', [{'id': m['Id'], 'name': m['Name'], 'affix': 'prefix' if m['GenerationType'] == 1 else 'suffix',
                         'level': m['Level'], 'stats': [stats[m[f'Stat{k}']]['Id'] for k in range(1, 9) if m[f'Stat{k}'] is not None],
                         'values': [m[f'Stat{k}Value'] for k in range(1, 9) if m[f'Stat{k}'] is not None]}
                        for m in mods if m['Domain'] == 1 and m['GenerationType'] in (1, 2) and any(m['SpawnWeight_Values'])])

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
for g in sorted(gems, key=lambda g: g['source'] == 'gem_cutting'):   # skills go by name: of two gems with one name (Herald of Ash and a unique's own) the one you can cut stays
    if g['kind'] not in ('active', 'support', 'spirit'):   # supports too: their stat lines describe them in the picker; spirit: meta gems (Mortar Cannon)
        continue
    fx = gfx[skill_gems[g['skill_gems_index']]['GemEffects'][0]]
    e = ge_tab[fx['GrantedEffect']]
    # A skill that deals no damage itself has the one that does laid over it: a gem's own skill that only loads
    # ammunition or reserves spirit (crossbow rounds, Black Powder Blitz) under the skill the gem then uses, and the
    # main stat set of a skill made of several parts (Rolling Slam) under its first part that deals damage
    idle = lambda i: 'base_deal_no_damage' in {sid(a) for a in ss_tab[i]['ImplicitStats']}
    effects = [e] + [ge_tab[x] for x in fx['AdditionalGrantedEffects'][:1] if idle(e['StatSet'])]
    # ...unless the skill sets that part off by itself (Ancestral Cry's shockwave): then the cry's own cast time, cost and area stay on top
    if 'display_statset_hide_usage_stats' in {sid(a) for a in ss_tab[effects[-1]['StatSet']]['ImplicitStats']}:
        effects.reverse()
    sets = [i for x in effects for i in [x['StatSet']] + ([j for j in x['AdditionalStatSets'] if not idle(j)][:1] if idle(x['StatSet']) else [])]
    implicit = {sid(a) for i in sets for a in ss_tab[i]['ImplicitStats']}
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
            if any(r['CostAmounts']):   # channelled skills cost per minute: written per second
                st['_cost'] = {c['Id'].removesuffix('PerMinute'): round(v / c['Divisor'], 1) if c['PerMinute'] else v
                               for c, v in zip((cost_types[t] for t in x['CostTypes']), r['CostAmounts'])}
    area = 'active_skill_base_area_of_effect_radius'
    radius = {lvl: st.get(area, const.get(area)) for lvl, st in levels.items() if area in st or area in const}
    if levels:   # what never changes with the level goes to "constant": keeps the file small
        one = next(iter(levels.values()))
        for k in sorted(set.intersection(*map(set, levels.values()))):   # sorted: the same file on every run
            if all(lv[k] == one[k] for lv in levels.values()):
                const[k] = one[k]
                for lv in levels.values():
                    del lv[k]
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
        if os.path.exists(cp := os.path.join(ROOT, 'files', csd.lower())):
            rows = {b.split()[1] for b in open(cp, encoding='utf-8', errors='replace').read().split('description')[1:] if 'table_only' in b and b.split()[0] == '1'}
            area2 = 'active_skill_base_secondary_area_of_effect_radius'
            if 'active_skill_secondary_area_of_effect_radius' in rows and 'active_skill_area_of_effect_radius' not in rows:
                skills[g['name']]['radius'] = {lvl: st.get(area2, const.get(area2)) for lvl, st in levels.items() if area2 in st or area2 in const} or None
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
save('skills.json', {'monster_stats': monster_stats, 'minion_level': minion_level, 'character_stats': char_stats, 'quest_rewards': quest_rewards, 'resistance_penalty': res_penalty, 'attribute_text': attr_text, 'player_base_speed': base_speed, 'support_capacity_per_attribute': capacity_per, 'max_support_sockets': max_sockets, 'skills': skills})

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
spirit = {s['BaseItemType']: s['SpiritGranted'] for s in load('ItemSpirit')}   # sceptres: 100
visual = load('ItemVisualIdentity')
mods_tr = load_langs('Mods')
mod_stats = lambda m: [[stats[m[f'Stat{k}']]['Id'], *m[f'Stat{k}Value']] for k in range(1, 9) if m[f'Stat{k}'] is not None]
bases, implicit_ids = [], set()
for i, b in enumerate(load('BaseItemTypes')):
    cls = classes[b['ItemClass']]['Name']
    if cls not in SLOT_CLASSES or not ok(b['Name']) or b['ModDomain'] not in (1, 2, 11) or b['Name'] not in trade_types:  # 1 item, 2 flask/charm, 11 jewel
        continue
    implicit_ids.update(b['Implicit_Mods'])
    a, w, fl = armour.get(i), weapon.get(i), flasks.get(i)
    bases.append({
        'name': b['Name'], **tr(bases_tr, i), 'class': cls, 'slots': SLOT_CLASSES[cls], 'level': b['DropLevel'], 'domain': b['ModDomain'],
        'tags': sorted(set(read_it(b['InheritsFrom']) + [tags_tab[t]['Id'] for t in b['Tags']])),
        'implicits': [mods[m]['Id'] for m in b['Implicit_Mods']],
        'armour': a and {'armour': a['Armour'], 'evasion': a['Evasion'], 'energy_shield': a['EnergyShield'], 'movement_speed_%': a['IncreasedMovementSpeed']},
        'img': visual[b['ItemVisualIdentity']]['DDSFile'] if b['ItemVisualIdentity'] is not None else None,
        'size': [b['Width'], b['Height']],
        'flask': fl and {'life': fl['LifePerUse'], 'mana': fl['ManaPerUse'], 'recovery_s': fl['RecoveryTime'] / 10},
        'weapon': w and {'crit': w['CritChance'] / 100, 'attack_time_ms': w['Speed'], 'min': w['DamageMin'], 'max': w['DamageMax'], 'range': w['RangeMax']},
        'spirit': spirit.get(i),
    })
# what a rune (soul core, talisman...) gives in a socket, every set of stats once ([[id, value, value], ...]): parseItem
# reads a "(rune)" line no modifier is worded like by these (SoulCoreStats; the Bonded ones are not counted)
rune_sets = list({tuple((sid(x), v, v) for x, v in zip(r['Stats'], r['StatsValues'])): 1 for r in load('SoulCoreStats') if r['Stats']})
assert any(x[0][0] == 'base_fire_damage_resistance_%' for x in rune_sets), 'SoulCoreStats'
save('items.json', {
    'runes': rune_sets,
    'bases': list({(b['class'], b['name']): b for b in sorted(bases, key=lambda b: -b['level'])}.values()),  # dedupe: same name, keep lowest drop level
    'implicits': {mods[m]['Id']: mod_stats(mods[m]) for m in implicit_ids},
    'unique_img': {shown(u['WordsKey']): visual[u['ItemVisualIdentityKey']]['DDSFile'] for u in layout if u['ItemVisualIdentityKey'] is not None},
    'affixes': [{'id': m['Id'], 'name': m['Name'], **tr(mods_tr, i), 'affix': 'prefix' if m['GenerationType'] == 1 else 'suffix',
                 'level': m['Level'], 'domain': m['Domain'], 'family': m['Families'][0] if m['Families'] else None, 'stats': mod_stats(m),
                 'spawn': [[tags_tab[t]['Id'], v] for t, v in zip(m['SpawnWeight_Tags'], m['SpawnWeight_Values'])],
                 **({'desecrated': True} if m['Domain'] == 28 else {})}
                # desecrated modifiers (Abyss: "Ulaman's", "of Kurgal"...) are AbyssMod* of domain 28, for any item their tags fit
                for i, m in enumerate(mods) if (m['Domain'] in (1, 2, 11) or m['Domain'] == 28 and m['Id'].startswith('AbyssMod'))
                and m['GenerationType'] in (1, 2) and any(m['SpawnWeight_Values'])],
})

# --- monsters of the 3D scene (enemies.js): every monster with its own multipliers, resistances and skills, and the
# per-level tables that turn the multipliers into life, armour, evasion, accuracy and damage
ELEMENTS = ('physical', 'fire', 'cold', 'lightning', 'chaos')
KEEP = re.compile(r'area_of_effect|radius|number_of_(?:additional_)?projectiles|number_of_chains|base_skill_effect_duration|'
                  r'chance_to_(?:poison|bleed)|ignite_chance|shock_chance|freeze|maim|knockback|_damage_\+%_final')
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
        'areas': sorted(areas.get(m['Name'], ())), 'skills': [ge_tab[g]['Id'] for g in m['GrantedEffects']]}),
        'life': m['LifeMultiplier'] / 100, 'damage': m['DamageMultiplier'] / 100, 'spread': t['DamageSpread'] / 100,
        'res': [res[el + '1'][0] if res else 0 for el in ('Fire', 'Cold', 'Lightning', 'Chaos')],
        'attack_time': m['AttackSpeed'] / 1000, 'range': m['MaximumAttackDistance'], 'speed': m['MovementSpeed'],
        # note: MonsterTypes has this flag in a column the schema has no name for, so extract.mjs leaves it out; all
        # but 2 of the 598 monsters Path of Building 2 exports have it. Read that column if those two ever matter
        'ignores_attack_speed': True}
    same = json.dumps({k: v for k, v in mon.items() if k not in ('id', 'areas')}, sort_keys=True)
    if same in seen:   # the same monster placed somewhere else: one entry, all its areas
        seen[same]['areas'] = sorted(set(seen[same].get('areas', []) + mon.get('areas', [])))
        continue
    seen[same] = mon
    monsters.append(mon)
    mskills.update({ge_tab[g]['Id']: g for g in m['GrantedEffects']})
monsters.sort(key=lambda m: (m['name'], m['id']))
mon_stats = ot_stats(text('metadata', 'monsters', 'monster.ot'))
dms = load('DefaultMonsterStats')
with open(os.path.join(OUT, 'monsters.json'), 'w', encoding='utf8') as f:
    json.dump({
        # index = monster level - 1
        'tables': {k: [round(r[c], 2) for r in dms] for k, c in (('life', 'MonsterLife'), ('damage', 'Damage'), ('armour', 'Armour'), ('evasion', 'Evasion'), ('accuracy', 'Accuracy'))},
        'constants': {
            'skill_effectiveness': game['SkillDamageBaseEffectiveness'],
            'monster_crit_bonus': mon_stats.get('base_critical_hit_damage_bonus'), 'monster_max_resistance': mon_stats.get('base_maximum_all_resistances_%'),
            'monster_max_physical_reduction': mon_stats.get('maximum_physical_damage_reduction_%'),
            'player_max_resistance': char_stats.get('base_maximum_all_resistances_%'), 'player_max_physical_reduction': char_stats.get('maximum_physical_damage_reduction_%'),
            'player_max_evade': game['DefaultMaxEvadeChancePercent'], 'player_crit_bonus': char_stats.get('base_critical_hit_damage_bonus'),
            'es_recharge_delay_ms': game['BaseShieldRegenCooldownTimeMs'], 'es_recharge_per_minute': char_stats.get('energy_shield_recharge_rate_per_minute_%'),
            'player_max_block': char_stats.get('object_inherent_base_maximum_block_%_from_ot'),
            # ailments: % of the hit dealt per minute, and how long they last
            'ignite_per_minute': game['IgniteHitDamagePercentPerMinute'], 'ignite_duration': game['BaseIgniteDuration'],
            'bleed_per_minute': game['BleedingHitDamagePercentPerMinute'], 'bleed_duration': game['BaseBleedingDuration'],
            'poison_per_minute': game['PoisonHitDamagePercentPerMinute'], 'poison_duration': game['BasePoisonDuration'],
        },
        'monsters': monsters,
        'skills': {k: monster_skill(ge_tab[g]) for k, g in sorted(mskills.items())},
    }, f, ensure_ascii=False, separators=(',', ':'))
print(f'monsters.json {len(monsters)} monsters ({sum(1 for m in monsters if m.get("boss"))} bosses), {len(mskills)} skills')

# --- self-check: a column renamed by a patch has to fail here, not show up as "—" in the app
assert plain('[Knockback|Knocking Back] a [Projectile]') == 'Knocking Back a Projectile'
assert all(s['levels'] for s in skills.values()), 'a gem without stats per level'
assert skills['Fireball']['cast_time_ms'] and skills['Fireball']['levels'][20]['spell_minimum_base_fire_damage'] > 0
assert all(char_stats.get(k) for k in ('life_per_level', 'mana_per_level', 'energy_shield_delay_ms', 'ailment_threshold_life_%')), 'character.ot / GameConstants'
assert all(c.get(k) for c in chars if ok(c['Name']) for k in ('BaseMaxLife', 'BaseMaxMana')), 'Characters base life / mana'
assert all(b['spirit'] for b in bases if b['class'] == 'Sceptres'), 'ItemSpirit: a sceptre without its Spirit'
assert [['base_spirit', 30]] in quest_rewards and len(res_penalty) == 100 and res_penalty[0] == 0 > res_penalty[-1], 'QuestStaticRewards / ResistancePenaltyPerAreaLevel'
assert skills['Berserk']['quality'] and skills['Berserk']['alt_quality'], 'GrantedEffectQualityStats'
assert any(m['Domain'] == 28 and m['Id'] == 'AbyssModCrossbowUlamanPrefixMaximumRangedAttackTotems' for m in mods), 'desecrated modifiers (Mods.Domain 28)'
assert skills['Mortar Cannon']['totem'] == {'life_mult': 1, 'ballista': True, 'armour': 100} and skills['Shockwave Totem']['totem']['armour'] == 0 and skills['Orb of Storms']['radius'][12] == 36 and skills['Ancestral Warrior Totem']['totem'] == {'life_mult': 1, 'ballista': False, 'armour': 0} and minion_level[17] == 36, 'SkillTotemVariations / MinionGemLevelScaling'
assert any('Berserk' in d.get('skill', ()) and 'skill_base_rage_effect_+%_to_apply' in d['stats'] for d in kept), 'ActiveSkills.StatDescription'
assert skills['Rolling Slam']['weapons'] == ['One Hand Maces', 'Two Hand Maces'] and not skills['Fireball']['weapons'], 'ActiveSkillWeaponRequirement'
assert len(monsters) > 1000 and any(m.get('areas') for m in monsters) and any(s.get('proj_speed') for s in map(monster_skill, ge_tab[:2000]))
