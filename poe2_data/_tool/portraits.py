"""The character panel's portraits: each base class's and ascendancy's "<Name> portrait.png" from the PoE2 Wiki
(poe2wiki.net, CC BY-NC-SA; the art is Grinding Gear Games'), as the game shows them: the game draws them from the
character's 3D model, so the files have none. Saved as ../available/img/portraits/<name>.webp.
Usage: python portraits.py   (run after available.py; again when a class or ascendancy is added)"""
import hashlib, io, json, os, urllib.error, urllib.parse, urllib.request
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'available', 'img', 'portraits')
UA = {'User-Agent': 'Mozilla/5.0 (personal build planner)'}
ascs = json.load(open(os.path.join(ROOT, 'available', 'ascendancies.json'), encoding='utf8'))
names = sorted({a['name'] for a in ascs} | {a['class'] for a in ascs})


def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read()


# MediaWiki keeps a file at images/<md5[0]>/<md5[:2]>/<name> (the API sits behind a bot check, the images do not)
def file_url(n):
    f = f'{n} portrait.png'.replace(' ', '_')
    h = hashlib.md5(f.encode()).hexdigest()
    return f'https://www.poe2wiki.net/images/{h[0]}/{h[:2]}/{urllib.parse.quote(f)}'


os.makedirs(OUT, exist_ok=True)
missing = []
for n in names:
    try:
        Image.open(io.BytesIO(get(file_url(n)))).convert('RGB').save(os.path.join(OUT, n.lower().replace(' ', '_') + '.webp'), 'WEBP', quality=90)
    except (urllib.error.HTTPError, OSError):
        missing.append(n)
print(len(names) - len(missing), 'portraits; missing:', missing)
