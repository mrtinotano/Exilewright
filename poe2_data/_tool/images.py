"""Item, gem and passive tree art straight from the game: extracts each base's and unique's .dds (via getfiles.mjs) and converts it to
../available/img/<path>.webp at half size. A path without .dds is a UIImages name: the piece of its atlas that
art/uiimages1.txt gives, saved as ../available/img/<name>.webp. Usage: python images.py <gameDir>   (run after available.py and uniques.py)"""
import json, os, shlex, subprocess, sys
from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
items = json.load(open(os.path.join(ROOT, 'available', 'items.json'), encoding='utf8'))
uniques = json.load(open(os.path.join(ROOT, 'available', 'unique_items.json'), encoding='utf8'))
paths = {b['img'] for b in items['bases'] if b['img']} | {items['unique_img'][u['name']] for u in uniques if u['name'] in items['unique_img']}
paths |= {b['charm']['icon'] for b in items['bases'] if b.get('charm', {}).get('icon')}   # a charm's buff, in the simulator
gems = json.load(open(os.path.join(ROOT, 'available', 'gems.json'), encoding='utf8'))
paths |= {g['icon'] for g in gems if g.get('icon')} | {g['socket_icon'] for g in gems if g.get('socket_icon')} | {g['buff_icon'] for g in gems if g.get('buff_icon')}
_sk = json.load(open(os.path.join(ROOT, 'available', 'skills.json'), encoding='utf8'))
paths |= set(_sk.get('charge_icons', {}).values()) | set(_sk.get('ailment_icons', {}).values()) | {_sk['move_icon']}   # the simulator's buffs and debuffs
paths |= {c['img'] for c in json.load(open(os.path.join(ROOT, 'available', 'currency.json'), encoding='utf8'))['currency'].values()}   # trade prices
tree = json.load(open(os.path.join(ROOT, 'available', 'passive_tree.json'), encoding='utf8'))
ascs = json.load(open(os.path.join(ROOT, 'available', 'ascendancies.json'), encoding='utf8'))
paths |= {n['icon'] for n in tree['nodes'].values() if n.get('icon')}  # passive node icons
paths |= {a[k] for a in ascs for k in ('tree_image', 'class_tree_image') if a.get(k)}  # central circle art
# the passive tree's own art (PassiveSkillTreeUIArt rows Character and Ascendancy, their PassiveSkillTreeNodeFrameArt
# frames), saved whole as ../available/img/tree/<role>.webp: the node frames per state and the group backgrounds
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
# the character panel's resistance icons (UIImages InGame/CharacterPanel), saved whole as ../available/img/panel/<role>.webp
PANEL = {k: 'Art/2DArt/UIImages/InGame/' + v for k, v in {
    'fire': 'CharacterPanel/IconFire', 'cold': 'CharacterPanel/IconCold',
    'lightning': 'CharacterPanel/IconLightning', 'chaos': 'CharacterPanel/IconChaos'}.items()}
# ...and the ones painted into the panel's own picture (life, energy shield, mana, spirit, armour, evasion, block): where
# each sits in CharacterPanelContent (4K), cut off the stone behind it
CONTENT = 'art/textures/interface/2d/2dart/uiimages/ingame/characterpanel/4k/characterpanelcontent.dds'
PAINTED = {'life': (152, 55), 'es': (452, 55), 'mana': (747, 52), 'spirit': (1047, 52), 'armour': (285, 271), 'evasion': (599, 271), 'block': (913, 271)}
# the art behind a group of the tree, by its mastery (PassiveSkillTreeMasteryArt.ActiveEffectImage), saved whole at
# half size as ../available/img/mastery/<id>.webp
MASTERY = {r['Id']: r['ActiveEffectImage'] for r in table('PassiveSkillTreeMasteryArt') if r['ActiveEffectImage']}
ui = set(TREE.values()) | set(PANEL.values()) | set(MASTERY.values())
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
for folder, role, name in [('tree', *x) for x in TREE.items()] + [('panel', *x) for x in PANEL.items()] + [('mastery', *x) for x in MASTERY.items()]:   # each is a picture of its own: whole, full size (the tree's are drawn large when zoomed in; the masteries at half)
    out = os.path.join(ROOT, 'available', 'img', folder, role + '.webp')
    try:
        os.makedirs(os.path.dirname(out), exist_ok=True)
        im = Image.open(os.path.join(ROOT, 'files', atlas[name.lower()][0]))
        (im.resize((im.width // 2, im.height // 2), Image.LANCZOS) if folder == 'mastery' else im).save(out, 'WEBP', quality=90)
    except Exception as e:
        bad.append((role, str(e)))
def painted(c):   # the icon: what is bright or coloured, with the holes inside it filled, small specks dropped
    hsv = c.convert('RGB').convert('HSV')
    m = ImageChops.lighter(c.convert('L').point(lambda x: 255 if x > 105 else 0), ImageChops.multiply(hsv.getchannel('S'), hsv.getchannel('V')).point(lambda x: 255 if x > 45 else 0))
    m = m.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
    ImageDraw.floodfill(m, (0, 0), 128)
    c.putalpha(m.point(lambda x: 0 if x == 128 else 255).filter(ImageFilter.GaussianBlur(0.8)))
    c = c.crop(c.getbbox()); side = max(c.size)
    sq = Image.new('RGBA', (side, side)); sq.alpha_composite(c, ((side - c.width) // 2, (side - c.height) // 2)); return sq
try:
    sheet = Image.open(os.path.join(ROOT, 'files', CONTENT)).convert('RGBA')
    for role, (x, y) in PAINTED.items():
        painted(sheet.crop((x - 46, y - 42, x + 46, y + 46))).save(os.path.join(ROOT, 'available', 'img', 'panel', role + '.webp'), 'WEBP', quality=90)
except Exception as e:
    bad.append(('panel', str(e)))
skip = {v.lower() for v in [*TREE.values(), *PANEL.values(), *MASTERY.values()]}
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
