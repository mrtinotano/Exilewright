"""Item, gem and passive tree art straight from the game: extracts each base's and unique's .dds (via getfiles.mjs) and converts it to
../available/img/<path>.webp at half size. Usage: python images.py <gameDir>   (run after available.py and uniques.py)"""
import json, os, subprocess, sys
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
paths = sorted(p.lower() for p in paths)
todo = [p for p in paths if not os.path.exists(os.path.join(ROOT, 'files', p))]
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
print(f'{len(paths)} images, {len(bad)} failed', bad[:5])
