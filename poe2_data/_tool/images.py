"""Item, gem and passive tree art straight from the game: extracts each base's and unique's .dds (via getfiles.mjs) and converts it to
../available/img/<path>.webp at half size. A path without .dds is a UIImages name: the piece of its atlas that
art/uiimages1.txt gives, saved as ../available/img/<name>.webp. Usage: python images.py <gameDir>   (run after available.py and uniques.py)"""
import json, os, shlex, subprocess, sys
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
items = json.load(open(os.path.join(ROOT, 'available', 'items.json'), encoding='utf8'))
uniques = json.load(open(os.path.join(ROOT, 'available', 'unique_items.json'), encoding='utf8'))
paths = {b['img'] for b in items['bases'] if b['img']} | {items['unique_img'][u['name']] for u in uniques if u['name'] in items['unique_img']}
gems = json.load(open(os.path.join(ROOT, 'available', 'gems.json'), encoding='utf8'))
paths |= {g['icon'] for g in gems if g.get('icon')} | {g['socket_icon'] for g in gems if g.get('socket_icon')}
tree = json.load(open(os.path.join(ROOT, 'available', 'passive_tree.json'), encoding='utf8'))
ascs = json.load(open(os.path.join(ROOT, 'available', 'ascendancies.json'), encoding='utf8'))
paths |= {n['icon'] for n in tree['nodes'].values() if n.get('icon')}  # passive node icons
paths |= {a[k] for a in ascs for k in ('tree_image', 'class_tree_image') if a.get(k)}  # central circle art
ui = {a.get('portrait') for a in ascs if a.get('portrait')}   # character panel faces: UIImages names
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
for size in ('Small', 'Medium', 'Large'):
    TREE['group_' + size.lower()] = uiart['Character']['GroupBackground' + size]
ui |= set(TREE.values())
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
todo = [p for p in sorted(set(paths) | {f for f, _ in atlas.values()}) if not os.path.exists(os.path.join(ROOT, 'files', p))]   # atlases: extracted, not converted whole
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
        os.makedirs(os.path.dirname(out), exist_ok=True)
        im.resize((im.width // 2, im.height // 2), Image.LANCZOS).save(out, 'WEBP', quality=85)
    except Exception as e:
        bad.append((p, str(e)))
for role, name in TREE.items():   # each is a picture of its own: whole, full size (they are drawn large when zoomed in)
    out = os.path.join(ROOT, 'available', 'img', 'tree', role + '.webp')
    try:
        os.makedirs(os.path.dirname(out), exist_ok=True)
        Image.open(os.path.join(ROOT, 'files', atlas[name.lower()][0])).save(out, 'WEBP', quality=90)
    except Exception as e:
        bad.append((role, str(e)))
for name, (file, (x1, y1, x2, y2)) in atlas.items():
    if name in {v.lower() for v in TREE.values()}:
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
