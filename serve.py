"""Local server for the app; no-store so edited files show up on a normal reload.

/share/upload?site=<id> (POST, body = build code) and /share/download?url=<link> (GET) talk to the build sites
for the page: browsers block those calls from another origin (CORS). Only the sites below are reachable.
Endpoints are the ones Path of Building 2 uses (src/Modules/BuildSiteTools.lua).
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import os
import re

UPLOAD = {  # site -> (post url, form field prefix, prefix added to the reply to make the link)
    'maxroll': ('https://maxroll.gg/poe2/api/pob', 'pobCode=', 'https://maxroll.gg/poe2/pob/'),
    'pobbin': ('https://pobb.in/pob/', '', 'https://pobb.in/'),
    'poeninja': ('https://poe.ninja/poe2/pob/api/upload', 'code=', ''),
    'poe2db': ('https://poe2db.tw/pob/api/gen', '', ''),
}
DOWNLOAD = [  # link pattern -> raw build code url
    (r'maxroll\.gg/poe2/pob/([\w-]+)', 'https://maxroll.gg/poe2/api/pob/{}'),
    (r'pobb\.in/(?:pob/)?([\w-]+)', 'https://pobb.in/pob/{}'),
    (r'poe2?\.ninja/(?:poe2/)?pob/(?:raw/)?([\w-]+)', 'https://poe.ninja/poe2/pob/raw/{}'),
    (r'poe2db\.tw/pob/([\w-]+)', 'https://poe2db.tw/pob/{}/raw'),
    (r'pastebin\.com/(?:raw/)?(\w+)', 'https://pastebin.com/raw/{}'),
    (r'rentry\.co/(?:paste/)?(\w+)', 'https://rentry.co/paste/{}/raw'),
]
UA = {'User-Agent': 'POE2-Builder (local build planner)'}


def call(url, body=None):
    headers = dict(UA, **({'Content-Type': 'application/x-www-form-urlencoded'} if body is not None else {}))
    try:
        with urlopen(Request(url, data=body, headers=headers), timeout=20) as r:
            return r.read()
    except HTTPError as e:  # keep the site's own explanation
        raise RuntimeError(f'{e.code} {e.reason}: {e.read()[:300].decode(errors="replace").strip()}') from None


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def reply(self, code, text):
        data = text.encode() if isinstance(text, str) else text
        self.send_response(code)
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        u = urlparse(self.path)
        if u.path != '/share/download':
            return super().do_GET()
        link = parse_qs(u.query).get('url', [''])[0]
        for pat, raw in DOWNLOAD:
            m = re.search(pat, link)
            if m:
                try:
                    return self.reply(200, call(raw.format(m.group(1))))
                except Exception as e:
                    return self.reply(502, str(e))
        self.reply(400, 'unknown site')

    def do_POST(self):
        u = urlparse(self.path)
        site = UPLOAD.get(parse_qs(u.query).get('site', [''])[0])
        if u.path != '/share/upload' or not site:
            return self.reply(404, 'not found')
        code = self.rfile.read(int(self.headers.get('Content-Length', 0))).decode().strip()
        if not re.fullmatch(r'[\w=-]+', code):
            return self.reply(400, 'not a build code')
        post, field, prefix = site
        try:
            self.reply(200, prefix + call(post, (field + code).encode()).decode().strip())
        except Exception as e:
            self.reply(502, str(e))


ThreadingHTTPServer(('127.0.0.1', 8765), partial(Handler, directory=os.path.dirname(os.path.abspath(__file__)))).serve_forever()
