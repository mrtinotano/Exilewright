"""Item, gem and passive tree art straight from the game: extracts each base's and unique's .dds (via getfiles.mjs) and converts it to
../available/img/<path>.webp at half size. A path without .dds is a UIImages name: the piece of its atlas that
art/uiimages1.txt gives, saved as ../available/img/<name>.webp. Usage: python images.py <gameDir>   (run after available.py and uniques.py)"""
import json, os, shlex, subprocess, sys
from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
items = json.load(open(os.path.join(ROOT, 'available', 'items.json'), encoding='utf8'))
uniques = json.load(open(os.path.join(ROOT, 'available', 'unique_items.json'), encoding='utf8'))
paths = {x['img'] for b in items['bases'] for x in [b, *b.get('variants', {}).values()] if x.get('img')} | {items['unique_img'][u['name']] for u in uniques if u['name'] in items['unique_img']}
paths |= {b['charm']['icon'] for b in items['bases'] if b.get('charm', {}).get('icon')}   # a charm's buff, in the simulator
gems = json.load(open(os.path.join(ROOT, 'available', 'gems.json'), encoding='utf8'))
paths |= {g['icon'] for g in gems if g.get('icon')} | {g['socket_icon'] for g in gems if g.get('socket_icon')} | {g['buff_icon'] for g in gems if g.get('buff_icon')}
_sk = json.load(open(os.path.join(ROOT, 'available', 'skills.json'), encoding='utf8'))
paths |= set(_sk.get('charge_icons', {}).values()) | {x['icon'] for x in _sk.get('infusions', {}).values()} | set(_sk.get('ailment_icons', {}).values()) | {_sk['move_icon'], _sk['archon_nature_icon']}   # the simulator's buffs and debuffs
paths |= {c['img'] for c in json.load(open(os.path.join(ROOT, 'available', 'currency.json'), encoding='utf8'))['currency'].values()}   # trade prices
tree = json.load(open(os.path.join(ROOT, 'available', 'passive_tree.json'), encoding='utf8'))
ascs = json.load(open(os.path.join(ROOT, 'available', 'ascendancies.json'), encoding='utf8'))
paths |= {n['icon'] for n in tree['nodes'].values() if n.get('icon')}  # passive node icons
paths |= {x['icon'] for v in tree['timeless']['versions'] for x in v.get('named', {}).values() if x.get('icon')}  # what a timeless jewel's conquered passives become (Tribute)
paths |= set(tree['attribute_icons'].values())   # an attribute passive with its attribute picked
paths |= {a[k] for a in ascs for k in ('tree_image', 'class_tree_image') if a.get(k)}  # central circle art
# the passive tree's own art (PassiveSkillTreeUIArt rows Character and Ascendancy, their PassiveSkillTreeNodeFrameArt
# frames), each saved as ../available/img/tree/<role>.webp (the piece of its file the index gives: a file has a few
# spare pixels on the right and below, which would leave a frame off its passive): the node frames per state
def table(t):
    return json.load(open(os.path.join(ROOT, 'tables', 'English', t + '.json'), encoding='utf8'))
uiart, frames = {r['Id']: r for r in table('PassiveSkillTreeUIArt')}, table('PassiveSkillTreeNodeFrameArt')
TREE = {}
for prefix, row, kinds in (('', uiart['Character'], ('Passive', 'Notable', 'Keystone', 'Jewel')), ('asc_', uiart['Ascendancy'], ('Passive', 'Notable'))):
    for kind in kinds:
        for state, col in (('normal', 'Normal'), ('can', 'CanAllocate'), ('active', 'Active')):
            TREE[f'{prefix}{kind.lower()}_{state}'] = frames[row[kind + 'Frame']][col]
for state, col in (('normal', 'Normal'), ('active', 'Active')):
    TREE['asc_start_' + state] = frames[uiart['Ascendancy']['AscendancyStart']][col]
# the ring round a socketed jewel's radius (PassiveJewelRadiiArt: two circles, turning against each other in the game):
# ring_1/2 the Default row's, ring_inv the circle inside a ring-shaped radius, ring<version>_1/2 a timeless jewel's
# (AlternateTreeArt, by the local_unique_jewel_alternate_tree_version of the uniques there are); and the frames of the
# passives such a jewel conquers, when its version has its own (AlternateTreeArt.UIArt): alt<version>_<frame>_<state>
radii, alt = table('PassiveJewelRadiiArt'), {a['TreeVersion']: a for a in table('AlternateTreeArt')}
TREE['ring_inv'] = radii[0]['Inverse1']
TREE['ring_1'], TREE['ring_2'] = radii[0]['Circle1'], radii[0]['Circle2']
for n in sorted({s[1] for u in uniques for m in u.get('mods', []) for s in m.get('stats', []) if s[0] == 'local_unique_jewel_alternate_tree_version'}):
    TREE[f'ring{n}_1'], TREE[f'ring{n}_2'] = radii[alt[n]['JewelRadiiArt']]['Circle1'], radii[alt[n]['JewelRadiiArt']]['Circle2']
    paths |= {k['icon'] for k in tree['timeless']['keystones'] if k['version'] == n}   # the keystone its conqueror puts in place of the tree's
    if alt[n]['UIArt'] is not None:
        for kind in ('Passive', 'Notable', 'Keystone'):
            for state, col in (('normal', 'Normal'), ('can', 'CanAllocate'), ('active', 'Active')):
                TREE[f'alt{n}_{kind.lower()}_{state}'] = frames[table('PassiveSkillTreeUIArt')[alt[n]['UIArt']][kind + 'Frame']][col]
# a socket with a jewel in it (passive_tree.json socketed), for the jewels there are: sock_<the picture's name>
for name, pic in tree['socketed'].items():
    if name in {b['name'] for b in items['bases']} | {u['name'] for u in uniques}:
        TREE['sock_' + pic.split('/')[-1].lower()] = pic
# the character panel's icons, painted into the panel's own picture (CharacterPanelContent, 4K), saved as
# ../available/img/panel/<role>.webp: where each sits in it, cut off the stone behind it; the resistances' are round
# badges (centre, radius)
CONTENT = 'art/textures/interface/2d/2dart/uiimages/ingame/characterpanel/4k/characterpanelcontent.dds'
PAINTED = {'life': (152, 55), 'es': (452, 55), 'mana': (747, 52), 'spirit': (1047, 52), 'armour': (285, 271), 'evasion': (599, 271), 'block': (913, 271)}
BADGES, BADGE_R = {'fire': (102, 539), 'cold': (670, 537), 'lightning': (102, 653), 'chaos': (670, 655)}, 45
# the art behind a group of the tree, by its mastery (PassiveSkillTreeMasteryArt.ActiveEffectImage), saved whole at
# half size as ../available/img/mastery/<id>.webp
MASTERY = {r['Id']: r['ActiveEffectImage'] for r in table('PassiveSkillTreeMasteryArt') if r['ActiveEffectImage']}
ui = set(TREE.values()) | set(MASTERY.values())
atlas = {}
if ui:
    index = os.path.join(ROOT, 'files', 'art', 'uiimages1.txt')
    if not os.path.exists(index):
        open(os.path.join(ROOT, 'files', '_ui_list.txt'), 'w').write('art/uiimages1.txt')
        subprocess.run(['node', os.path.join(os.path.dirname(__file__), 'getfiles.mjs'), sys.argv[1], ROOT, '@' + os.path.join(ROOT, 'files', '_ui_list.txt')], check=True, stdout=subprocess.DEVNULL)
    for line in open(index, encoding='utf-16-le'):   # "Name" "Atlas.dds" x1 y1 x2 y2
        name, file, *box = shlex.split(line)
        if name in ui:
            atlas[name.lower()] = (file.lower(), tuple(int(v) for v in box))
paths = sorted(p.lower() for p in paths)
todo = [p for p in sorted(set(paths) | {f for f, _ in atlas.values()} | {CONTENT}) if not os.path.exists(os.path.join(ROOT, 'files', p))]   # atlases: extracted, not converted whole
if todo:
    lst = os.path.join(ROOT, 'files', '_dds_list.txt')
    open(lst, 'w').write('\n'.join(todo))
    subprocess.run(['node', os.path.join(os.path.dirname(__file__), 'getfiles.mjs'), sys.argv[1], ROOT, '@' + lst], check=True, stdout=subprocess.DEVNULL)
bad = []
for p in paths:
    out = os.path.join(ROOT, 'available', 'img', p[:-4] + '.webp')
    if os.path.exists(out):
        continue
    try:
        im = Image.open(os.path.join(ROOT, 'files', p))
        if '/flasks/' in p:   # a flask's art is three pictures side by side: the glass, the glass empty, the liquid; the
            im, w = im.convert('RGBA'), im.width // 3   # inventory shows it full: the liquid behind the glass
            im = Image.alpha_composite(im.crop((2 * w, 0, 3 * w, im.height)), im.crop((0, 0, w, im.height)))
        os.makedirs(os.path.dirname(out), exist_ok=True)
        im.resize((im.width // 2, im.height // 2), Image.LANCZOS).save(out, 'WEBP', quality=85)
    except Exception as e:
        bad.append((p, str(e)))
for folder, role, name in [('tree', *x) for x in TREE.items()] + [('mastery', *x) for x in MASTERY.items()]:   # each is a picture of its own: full size (the tree's are drawn large when zoomed in; the masteries at half)
    out = os.path.join(ROOT, 'available', 'img', folder, role + '.webp')
    try:
        os.makedirs(os.path.dirname(out), exist_ok=True)
        file, (x1, y1, x2, y2) = atlas[name.lower()]
        im = Image.open(os.path.join(ROOT, 'files', file))
        if folder == 'tree': im = im.crop((x1, y1, x2 + 1, y2 + 1))
        (im.resize((im.width // 2, im.height // 2), Image.LANCZOS) if folder == 'mastery' else im).save(out, 'WEBP', quality=90)
    except Exception as e:
        bad.append((role, str(e)))
def painted(c):   # the icon: what is bright or coloured, with the holes inside it filled, small specks dropped
    hsv = c.convert('RGB').convert('HSV')
    m = ImageChops.lighter(c.convert('L').point(lambda x: 255 if x > 105 else 0), ImageChops.multiply(hsv.getchannel('S'), hsv.getchannel('V')).point(lambda x: 255 if x > 45 else 0))
    m = m.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
    ImageDraw.floodfill(m, (0, 0), 128)
    c.putalpha(m.point(lambda x: 0 if x == 128 else 255).filter(ImageFilter.GaussianBlur(0.8)))
    return c.crop(c.getbbox())
try:
    sheet = Image.open(os.path.join(ROOT, 'files', CONTENT)).convert('RGBA')
    for role, (x, y) in PAINTED.items():
        painted(sheet.crop((x - 46, y - 42, x + 46, y + 46))).save(os.path.join(ROOT, 'available', 'img', 'panel', role + '.webp'), 'WEBP', quality=90)
    r = BADGE_R
    for role, (x, y) in BADGES.items():
        c, m = sheet.crop((x - r, y - r, x + r + 1, y + r + 1)), Image.new('L', (8 * (2 * r + 1),) * 2)
        ImageDraw.Draw(m).ellipse((0, 0, m.width - 1, m.height - 1), fill=255)
        c.putalpha(m.resize(c.size, Image.LANCZOS)); c.save(os.path.join(ROOT, 'available', 'img', 'panel', role + '.webp'), 'WEBP', quality=90)
except Exception as e:
    bad.append(('panel', str(e)))
skip = {v.lower() for v in [*TREE.values(), *MASTERY.values()]}
for name, (file, (x1, y1, x2, y2)) in atlas.items():
    if name in skip:
        continue
    out = os.path.join(ROOT, 'available', 'img', name + '.webp')
    try:
        im = Image.open(os.path.join(ROOT, 'files', file)).convert('RGBA').crop((x1, y1, x2 + 1, y2 + 1))
        # a bust on a clear background; the character panel shows the face: a square half as wide as the picture,
        # from the top of the head, centred on the head (the opaque part of the top 30%)
        alpha = im.getchannel('A').point(lambda v: 255 if v > 128 else 0)
        top = alpha.getbbox()[1]
        head = alpha.crop((0, top, im.width, top + int(.3 * im.height))).getbbox()
        side = im.width // 2
        left = min(max((head[0] + head[2]) // 2 - side // 2, 0), im.width - side)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        im.crop((left, top, left + side, top + side)).save(out, 'WEBP', quality=85)
    except Exception as e:
        bad.append((name, str(e)))
print(f'{len(paths) + len(atlas)} images, {len(bad)} failed', bad[:5])
