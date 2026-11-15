"""Local server for the app; no-store so edited files show up on a normal reload.

/share/upload?site=<id> (POST, body = build code) and /share/download?url=<link> (GET) talk to the build sites
for the page: browsers block those calls from another origin (CORS). Only the sites below are reachable.
Endpoints are the ones Path of Building 2 uses (src/Modules/BuildSiteTools.lua).

/trade/... passes the gear search (trade.js) on to the official trade site's API, pathofexile.com/api/trade2:
  GET  /trade/data/<stats|filters|leagues|static>   what can be searched (kept in memory)
  POST /trade/search?league=<name>                   body = the query (JSON) -> ids of the items listed
  GET  /trade/fetch?ids=<a,b,...>&query=<search id>  the items (10 at most)
  GET  /trade/status                                 {"session": true} when a session was given
The site's answers, errors and rate limit headers go back as they come. Logged-out visitors cannot run weighted
searches; to let the app run them start the server with your own session of the site in the POESESSID environment
variable (it is only ever sent to www.pathofexile.com, never to the page):  POESESSID=... python3 serve.py

Usage: python3 serve.py [port]   (default 8765)
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, quote
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import json
import os
import re
import sys

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


TRADE = 'https://www.pathofexile.com/api/trade2/'
SESSION = os.environ.get('POESESSID', '').strip()
SESSION = SESSION if re.fullmatch(r'[0-9a-f]{32}', SESSION) else ''   # anything else is not a session of the site
PASS = ('Retry-After', 'X-Rate-Limit-Policy', 'X-Rate-Limit-Rules', 'X-Rate-Limit-Ip', 'X-Rate-Limit-Ip-State',
        'X-Rate-Limit-Account', 'X-Rate-Limit-Account-State')
trade_data = {}


def trade(path, body=None):
    """-> (status, body, headers to pass on) of a trade API call; the site's error replies are answers too"""
    headers = dict(UA, Accept='application/json')
    if body is not None:
        headers['Content-Type'] = 'application/json'
    if SESSION:
        headers['Cookie'] = 'POESESSID=' + SESSION
    try:
        with urlopen(Request(TRADE + path, data=body, headers=headers), timeout=20) as r:
            return r.status, r.read(), {k: r.headers[k] for k in PASS if r.headers[k]}
    except HTTPError as e:
        return e.code, e.read(), {k: e.headers[k] for k in PASS if e.headers[k]}


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

    def reply_json(self, code, data, headers=None):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def do_trade(self, u, body=None):
        q = parse_qs(u.query)
        one = lambda k: q.get(k, [''])[0]
        what = u.path[len('/trade/'):]
        try:
            if what == 'status' and body is None:
                return self.reply_json(200, json.dumps({'session': bool(SESSION)}).encode())
            if what in ('data/stats', 'data/filters', 'data/leagues', 'data/static') and body is None:
                if what not in trade_data:
                    code, data, headers = trade(what)
                    if code != 200:
                        return self.reply_json(code, data, headers)
                    trade_data[what] = data
                return self.reply_json(200, trade_data[what])
            if what == 'fetch' and body is None:
                ids = one('ids').split(',')
                if not (0 < len(ids) <= 10 and all(re.fullmatch(r'[0-9a-f]{64}', i) for i in ids) and re.fullmatch(r'[\w-]+', one('query'))):
                    return self.reply_json(400, b'{"error":{"message":"bad ids"}}')
                return self.reply_json(*trade(f'fetch/{",".join(ids)}?query={one("query")}&realm=poe2'))
            if what == 'search' and body is not None:
                if not re.fullmatch(r'[\w ]{1,60}', one('league')) or len(body) > 20000 or not isinstance(json.loads(body), dict):
                    return self.reply_json(400, b'{"error":{"message":"bad search"}}')
                return self.reply_json(*trade('search/poe2/' + quote(one('league')), body))
        except Exception as e:
            return self.reply_json(502, json.dumps({'error': {'message': str(e)}}).encode())
        self.reply_json(404, b'{"error":{"message":"not found"}}')

    def do_GET(self):
        u = urlparse(self.path)
        if u.path.startswith('/trade/'):
            return self.do_trade(u)
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
        if u.path.startswith('/trade/'):
            return self.do_trade(u, self.rfile.read(int(self.headers.get('Content-Length', 0))))
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


ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1]) if len(sys.argv) > 1 else 8765), partial(Handler, directory=os.path.dirname(os.path.abspath(__file__)))).serve_forever()
