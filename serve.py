"""Local server for the app; no-store so edited files show up on a normal reload.

/share/upload?site=<id> (POST, body = build code) and /share/download?url=<link> (GET) talk to the build sites
for the page: browsers block those calls from another origin (CORS). Only the sites below are reachable.
Endpoints are the ones Path of Building 2 uses (src/Modules/BuildSiteTools.lua).

/pob (GET) gives the page the builds saved in Path of Building 2 on this computer, to import one without copying its
code: their file names, the last saved first, or with ?name=<one of them> its XML. A character of the account gets
here that way: the game's site hands characters only to programs registered with it, and Path of Building is one.

/trade/... passes the gear search (trade.js) on to the official trade site's API, pathofexile.com/api/trade2:
  GET  /trade/data/<stats|filters|leagues|static>   what can be searched (kept in memory)
  POST /trade/search?league=<name>                   body = the query (JSON) -> ids of the items listed
  POST /trade/exchange?league=<name>                 body = a bulk exchange query (JSON) -> the offers
  GET  /trade/fetch?ids=<a,b,...>&query=<search id>  the items (10 at most)
The site's answers, errors and rate limit headers go back as they come. No login: weighted searches open on the
official site instead.

/clipboard?lang=<code> (GET, a stream of server-sent events) tells the equipment comparison (loot.js, in Settings) about the items copied in
the game: Ctrl+C over an item puts its text in the clipboard, and a page cannot read the clipboard while the game is
the window in use. Only text shaped like an item (it has a "--------" line) is passed on: anything else copied stays
here.

/filtersound?name=<file> (POST, body = the sound) copies a sound of the user's own (.mp3, .wav, .ogg) into the game's
folder for the Filter tab; GET plays it from there. Local only.
/save (POST, body = {"kind": "game" | "json", "name", "text"}) saves a build as a file: a .build in the game's
BuildPlanner folder, or JSON in Downloads; 200 with the file's path. Local only.
/filter (POST, body = {"name", "text", "overwrite"}) saves the Filter tab's .filter in the game's folder (Documents/My
Games/Path of Exile 2): 409 when that file is there and overwrite is not set, else 200 with the file's path. Local only.
/settings (GET) -> {"app": the window can go to the notification area, "tray", "startup": it can open with Windows (the
installed or portable executable), "on": it does}. POST, local only, any of: {"tray": true} only the icon in the
notification area (no taskbar button; a click on the icon opens the window, minimizing hides it there), {"on": true}
opens it with Windows (HKCU Run), {"price_key": "Ctrl+D", "worn_key": "Alt+D"} the shortcuts of the Settings tab
(settings.js). On Windows, a shortcut pressed while the game is the window in use copies the item under the pointer: one
Ctrl+C, as if pressed (GGG's rule for tools: one action per key press, nothing automatic), and that copy goes to the
pages as {"price": text} (look up what it costs on the trade site) or {"worn": text} (the character now wears it)
instead of text.

/update tells the page whether there is a newer version (the latest release on GitHub, RELEASES):
  GET  /update   {"version", "latest", "newer", "page" (the release's page), "install" (this is the installed app and the
                 release has its installer), "app" (this runs as the app)}
  POST /update   downloads that installer, starts it (silent: it shows its progress and opens the app again) and closes
                 the app, so its files can be replaced. Only from the page this server serves.

/overlay puts the Compare tab's verdict in a small window over the game, next to the pointer, the way the overlay tools
for the game do (the game has to run in windowed full screen: nothing draws over exclusive full screen):
  GET  /overlay   {"overlay": true} when this server has that window
  POST /overlay   body = {kind, title, name, lines, link, open} (JSON), shown until its ✕ is clicked; null = nothing to show.
                  link: a search on the official trade site, opened in the browser by a button that says `open`. A line is
                  text, or a list of pieces of it, each text or [text, tone]: up (green), down (red), dim
The window needs tkinter, which comes with Python. It is made on Windows, and elsewhere with: python3 serve.py overlay
Without it the clipboard is only looked at while a page is listening. With it, from the start: an item copied while
no page is there to judge it gets an answer too, a line saying so.

As an app of its own (the "Exilewright" executable, or: python serve.py app, which needs pywebview) the page opens
in a native window: WebView2 embedded, no browser around it. Its data (the builds) goes to %LOCALAPPDATA%/Exilewright,
or to "profile" next to the executable in the portable version; closing the window stops everything. It always uses
port 8767, as the saved builds belong to the page's address.

Usage: python3 serve.py [port] [overlay] [app]   (default port 8765)
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, quote
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import ctypes
import json
import os
import queue
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
import webbrowser

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
UA = {'User-Agent': 'Exilewright (local build planner)'}
# note: where Path of Building 2 keeps its builds on Windows by default, and only the ones not in a folder of
# their own; its "buildPath" setting if someone keeps them elsewhere
POB = os.path.join(os.path.expanduser('~'), 'Documents', 'Path of Building (PoE2)', 'Builds')


def call(url, body=None):
    headers = dict(UA, **({'Content-Type': 'application/x-www-form-urlencoded'} if body is not None else {}))
    try:
        with urlopen(Request(url, data=body, headers=headers), timeout=20) as r:
            return r.read()
    except HTTPError as e:  # keep the site's own explanation
        raise RuntimeError(f'{e.code} {e.reason}: {e.read()[:300].decode(errors="replace").strip()}') from None


TRADE = 'https://www.pathofexile.com/api/trade2/'
PASS = ('Retry-After', 'X-Rate-Limit-Policy', 'X-Rate-Limit-Rules', 'X-Rate-Limit-Ip', 'X-Rate-Limit-Ip-State',
        'X-Rate-Limit-Account', 'X-Rate-Limit-Account-State')
trade_data = {}


def trade(path, body=None):
    """-> (status, body, headers to pass on) of a trade API call; the site's error replies are answers too"""
    headers = dict(UA, Accept='application/json')
    if body is not None:
        headers['Content-Type'] = 'application/json'
    try:
        with urlopen(Request(TRADE + path, data=body, headers=headers), timeout=20) as r:
            return r.status, r.read(), {k: r.headers[k] for k in PASS if r.headers[k]}
    except HTTPError as e:
        return e.code, e.read(), {k: e.headers[k] for k in PASS if e.headers[k]}


def clipboard():
    """-> (look, seconds between looks) for this system's clipboard, or None when there is no way to read it.
    look(seen) -> (stamp, text): text is None while nothing was copied since the look that gave `seen`"""
    if sys.platform == 'win32':
        user, kernel = ctypes.windll.user32, ctypes.windll.kernel32
        user.OpenClipboard.argtypes = [ctypes.c_void_p]
        user.GetClipboardData.argtypes = [ctypes.c_uint]
        user.GetClipboardData.restype = ctypes.c_void_p
        kernel.GlobalLock.argtypes = kernel.GlobalUnlock.argtypes = [ctypes.c_void_p]
        kernel.GlobalLock.restype = ctypes.c_void_p

        def look(seen):
            n = user.GetClipboardSequenceNumber()   # goes up with every copy, the same text again included
            if n == seen:
                return n, None
            if not user.OpenClipboard(None):        # another program has it open: the next look reads it
                return seen, None
            try:
                h = user.GetClipboardData(13)       # CF_UNICODETEXT
                p = kernel.GlobalLock(h) if h else None
                if not p:
                    return n, ''
                try:
                    return n, ctypes.wstring_at(p)
                finally:
                    kernel.GlobalUnlock(h)
            finally:
                user.CloseClipboard()
        return look, .4
    cmd = next((c for c in (['pbpaste'], ['wl-paste', '-n'], ['xclip', '-o', '-selection', 'clipboard']) if shutil.which(c[0])), None)
    if not cmd:
        return None
    env = dict(os.environ, LC_ALL='en_US.UTF-8') if cmd[0] == 'pbpaste' else None   # it writes in the locale's encoding
    copies = None
    if sys.platform == 'darwin':   # macOS counts the copies too, the same text again included
        try:
            objc = ctypes.CDLL('/usr/lib/libobjc.dylib')
            ctypes.CDLL('/System/Library/Frameworks/AppKit.framework/AppKit')
            objc.objc_getClass.restype = objc.sel_registerName.restype = ctypes.c_void_p
            objc.objc_getClass.argtypes = objc.sel_registerName.argtypes = [ctypes.c_char_p]
            send, count = objc['objc_msgSend'], objc['objc_msgSend']   # one function, two kinds of answer
            send.argtypes = count.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
            send.restype, count.restype = ctypes.c_void_p, ctypes.c_long
            board = send(objc.objc_getClass(b'NSPasteboard'), objc.sel_registerName(b'generalPasteboard'))
            changes = objc.sel_registerName(b'changeCount')
            if board and count(board, changes) >= 0:
                copies = lambda: count(board, changes)
        except (OSError, AttributeError):
            pass

    def look(seen):   # without a copy counter the text itself says whether something new was copied
        n = copies() if copies else None
        if copies and n == seen:
            return n, None
        try:
            text = subprocess.run(cmd, capture_output=True, timeout=3, env=env).stdout.decode(errors='replace')
        except (OSError, subprocess.SubprocessError):
            return seen, None
        return (n, text) if copies else (text, None if text == seen else text)
    return look, .4 if copies else 1


def spot(w, h, px, py, sw, sh):
    """where the window over the game goes: under the pointer (the game describes the item above it); with no room
    there, over it; with none there either, beside it. On the main screen it is kept whole (the size of the others is
    not known)"""
    x, y = px - w // 2, py + 28
    if 0 <= px < sw and 0 <= py < sh:
        x = min(max(x, 8), max(sw - w - 8, 8))
        if y + h > sh - 8:
            y = py - 28 - h
            if y < 8:
                y = min(max(py - h // 2, 8), max(sh - h - 8, 8))
                x = px + 40 if px + 40 + w <= sw - 8 else max(px - 40 - w, 8)
    return x, y


assert spot(400, 100, 500, 300, 1920, 1080) == (300, 328), 'spot: under'
assert spot(400, 300, 500, 900, 1920, 1080) == (300, 572), 'spot: over'
assert spot(460, 700, 1500, 500, 1920, 1080) == (1000, 150), 'spot: beside, to the left near the right edge'


class PadState(ctypes.Structure):   # XInputGetState's
    _fields_ = [('packet', ctypes.c_uint32), ('buttons', ctypes.c_uint16), ('triggers', ctypes.c_uint8 * 2), ('sticks', ctypes.c_int16 * 4)]


def pad_state():
    """-> what is being done on the controllers plugged in (XInput: Xbox ones, and the others Steam Input passes on as
    one): buttons held, triggers pulled, sticks pushed well past the middle (a worn stick drifts a little); () off Windows"""
    if not hasattr(pad_state, 'get'):
        try:
            pad_state.get = ctypes.windll.xinput1_4.XInputGetState
        except (AttributeError, OSError):
            pad_state.get = None
    st, out = PadState(), []
    for i in range(4) if pad_state.get else ():
        if pad_state.get(i, ctypes.byref(st)) == 0:
            out.append((st.buttons, *(t > 30 for t in st.triggers), *(int(v / 12000) for v in st.sticks)))
    return tuple(out)


def overlay():
    """-> (show, loop) of a small window that stays over everything on the screen, or None without tkinter or a screen.
    show(verdict) puts {kind, title, name, lines: [[(text, tone)]]} in it, next to the pointer (from any thread). A
    comparison stays until its ✕ is clicked, a click lands anywhere else, a key is pressed or another window comes to
    the front (all Windows only) or the next one comes; anything else (the item was taken as worn, a notice of the server's) goes by itself in a few seconds.
    loop() runs the window and has to be called in the thread that called this, the main one"""
    win, back = sys.platform == 'win32', '#12100c'
    if win:   # a new window takes the keyboard on Windows: remember who has it, to give it back below
        # the screen in real pixels before the window is made: the app's window (WebView2) turns that on for the whole
        # program later, and a window made before it measures a scaled screen (1536x864 at 125%) in real pixels, so
        # under the bottom fifth it was not kept on the screen
        try:
            ctypes.windll.shcore.SetProcessDpiAwareness(2)
        except (AttributeError, OSError):
            pass
        ctypes.windll.user32.GetForegroundWindow.restype = ctypes.c_void_p
        front = ctypes.windll.user32.GetForegroundWindow()
    try:
        import tkinter as tk
        root = tk.Tk()
    except Exception:
        return None
    try:   # macOS has a kind of window made for this: no title bar, over the others, and showing it takes no keyboard
        root.tk.call('::tk::unsupported::MacWindowStyle', 'style', root._w, 'help', 'noActivates')
    except tk.TclError:
        root.overrideredirect(True)                  # no title bar, no place in the task bar
    root.attributes('-alpha', 0 if win else .95)
    root.configure(bg='#6b5a36')                     # shows as a frame, 1px wide
    box = tk.Frame(root, bg=back, padx=12, pady=8)
    box.pack(padx=1, pady=1)
    face = 'Segoe UI' if win else 'Helvetica'
    head = tk.Frame(box, bg=back)
    head.pack(fill='x')
    title = tk.Label(head, bg=back, font=(face, 14, 'bold'), justify='left', anchor='w', wraplength=420)
    title.pack(side='left')
    close = tk.Label(head, text='✕', bg=back, fg='#9a8f78', font=(face, 12), cursor='hand2')
    close.pack(side='right', anchor='n', padx=(16, 0))
    body = tk.Frame(box, bg=back)
    q, timer = queue.Queue(), None
    held = None   # the keys and mouse buttons down at the last look; None: not looked at since the window came up
    keys = []     # what closes it when pressed: the mouse buttons, the game's own keys (game_keys) and Esc; when the game's
                  # settings cannot be read, any key but W A S D
    over = gone = None   # the window in front when it came up; the one it was over when another came to the front
    if win:
        # hiding is done by making it clear, never by taking it off the screen: putting a window back on the screen
        # can take the keyboard from the game. Hidden, clicks go through it to the game; shown, it takes them (its ✕
        # closes it, and so do a click anywhere else and a key: see poll) but never the keyboard
        mouse = {1, 2, 4}   # left, right and middle button
        # what closes the window when pressed: those, the two side buttons and the keys the game uses (keys, below), but
        # Shift, Ctrl, Alt and Print Screen
        watch = [k for k in (*mouse, 5, 6, *range(8, 0x5B), *range(0x60, 0x92), *range(0xBA, 0xE3)) if k not in (0x10, 0x11, 0x12, 0x2C)]
        user = ctypes.windll.user32
        user.GetAncestor.restype = ctypes.c_void_p
        user.GetAncestor.argtypes = [ctypes.c_void_p, ctypes.c_uint]
        user.GetWindowLongW.argtypes = [ctypes.c_void_p, ctypes.c_int]
        user.SetWindowLongW.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_long]

        def clicks(mine):   # layered + tool window + never the window in use, and transparent to clicks unless they are its own
            h = user.GetAncestor(root.winfo_id(), 2)
            ex = user.GetWindowLongW(h, -20) | 0x80000 | 0x80 | 0x08000000
            user.SetWindowLongW(h, -20, ex & ~0x20 if mine else ex | 0x20)
        root.update()
        clicks(False)
        user.SetForegroundWindow.argtypes = [ctypes.c_void_p]
        user.SetForegroundWindow(front)
    else:
        root.withdraw()

    def hide(_=None):
        nonlocal timer
        if timer:
            root.after_cancel(timer)
        timer = None
        if win:
            root.attributes('-alpha', 0)
            clicks(False)
        else:
            root.withdraw()
    close.bind('<Button-1>', hide)

    def draw(v):
        nonlocal timer, held, keys, over, gone
        if win:   # what comes soon after the user went to another window (a search's answer) is dropped, unless that one is back
            now = user.GetForegroundWindow()
            if gone and now != gone[0] and time.monotonic() - gone[1] < 90:
                return
            over, gone = now, None
        title.config(text=v['title'], fg=TINT.get(v['kind'], '#d8ccb0'))
        for old in body.winfo_children():
            old.destroy()
        rows = ([[(v['name'], '')]] if v['name'] else []) + v['lines']
        for pieces in rows:                           # a line: its pieces side by side, each in its tone
            row = tk.Frame(body, bg=back)
            row.pack(fill='x')
            for text, tone in pieces:
                tk.Label(row, text=text, bg=back, fg=TONE.get(tone, '#d8ccb0'), font=(face, 11), justify='left', anchor='w',
                         wraplength=460, padx=0, pady=0, bd=0).pack(side='left')
        if v.get('link'):                             # a button that opens the search on the trade site in the browser
            go = tk.Label(body, text=v.get('open') or 'Open', bg='#2a2418', fg='#e8d8b0', font=(face, 10), cursor='hand2', padx=8, pady=3)
            go.pack(anchor='w', pady=(6, 0))
            go.bind('<Button-1>', lambda _, url=v['link']: (webbrowser.open(url), hide()))
        if rows or v.get('link'):
            body.pack(fill='x')
        else:
            body.pack_forget()
        root.update_idletasks()
        w, h, (px, py) = root.winfo_reqwidth(), root.winfo_reqheight(), root.winfo_pointerxy()
        sw, sh = root.winfo_screenwidth(), root.winfo_screenheight()
        if pad[0]:   # playing with the controller: the game copied the item it picked, the pointer is not by
            px, py = sw // 2, sh // 4   # it; the window goes to the middle at the top, clear of the game's description
        x, y = spot(w, h, px, py, sw, sh)
        root.geometry(f'+{x}+{y}')
        root.update_idletasks()                      # now: on Windows the first move is lost if it waits for the calls below
        if win:
            root.attributes('-alpha', .95)
            clicks(True)
            game = game_keys()
            held, keys = None, [k for k in watch if k in (*mouse, 5, 6) or (k in game | {0x1B} if game else k not in b'WASD')]
        else:
            root.deiconify()
        root.attributes('-topmost', True)            # every time: macOS forgets it while the window is off the screen
        root.lift()
        if timer:
            root.after_cancel(timer)
        timer = None if v['kind'] in COMPARED else root.after(NOTED * 1000, hide)

    # the controller was used after the mouse: the window does not go by the pointer
    pad, last = [False], [None, None]

    def poll():
        nonlocal held
        if win and float(root.attributes('-alpha')):
            # shown: a click anywhere else closes it, and so does any key the game could take (it moves the character,
            # opens a menu...). Not with Ctrl, Alt or Win down: that is copying the next item, a picture of the screen
            # or another window. note: keys and mouse are looked at 20 times a second, not hooked (a hook written
            # in Python can slow the pointer in the game); a hook if presses ever get missed
            now = {k: user.GetAsyncKeyState(k) for k in keys}   # 0x8000: down, 1: pressed since the last look
            down = {k for k, s in now.items() if s & 0x8000}
            new = set() if held is None else {k for k, s in now.items() if s & 1 or k in down and k not in held}
            held = down
            px, py = root.winfo_pointerxy()
            away = not (0 <= px - root.winfo_rootx() < root.winfo_width() and 0 <= py - root.winfo_rooty() < root.winfo_height())
            if new & mouse and away or new - mouse and not any(user.GetAsyncKeyState(k) & 0x8000 for k in (0x11, 0x12, 0x5B, 0x5C)):
                hide()
            elif user.GetForegroundWindow() != over:   # Alt+Tab, the taskbar, another window: it stays with the one it came over
                gone = over, time.monotonic()
                hide()
        try:
            while True:
                draw(q.get_nowait())
        except queue.Empty:
            pass
        m, p = root.winfo_pointerxy(), pad_state()
        if m != last[0]:
            pad[0] = False
        if p != last[1] and last[1] is not None:
            pad[0] = True
        last[:] = m, p
        root.after(50, poll)
    root.after(50, poll)
    return q.put, root.mainloop


def game_config():
    """the game's own settings file (poe2_production_Config.ini), '' when it cannot be read"""
    try:
        with open(os.path.join(game_folder(), 'poe2_production_Config.ini'), encoding='utf-8-sig') as f:
            return f.read()
    except (OSError, ValueError):
        return ''


def game_setting(key):
    """-> the value of a setting in the game's settings file, '' when it is not there"""
    m = re.search(rf'^{key}=(.*?)\s*$', game_config(), re.M)
    return m.group(1) if m else ''


def game_keys():
    """-> the Windows key codes the game is set to use ([ACTION_KEYS], or [WASD_ACTION_KEYS] when it moves the character
    with W A S D: "action=code [modifier]", 0 unbound); None when the file cannot be read"""
    text = game_config()
    part = 'WASD_ACTION_KEYS' if re.search(r'^use_wasd_to_move=true\s*$', text, re.M) else 'ACTION_KEYS'
    m = re.search(rf'^\[{part}\]\s*$(.*?)(?=^\[|\Z)', text, re.M | re.S)
    return {int(c) for c in re.findall(r'^\w+=(\d+)', m.group(1), re.M)} if m else None


def tongue():
    """-> the language this system is in ('es'), '' when it does not say"""
    try:
        if sys.platform == 'win32':
            name = ctypes.create_unicode_buffer(85)
            ctypes.windll.kernel32.GetUserDefaultLocaleName(name, 85)
            return name.value[:2].lower()
        return (os.environ.get('LC_ALL') or os.environ.get('LANG') or '')[:2].lower()
    except Exception:
        return ''


def tell(text):
    """a line of this server's own in the window over the game, in the app's words for it (i18n/<code>.json)"""
    try:
        with open(os.path.join(HERE, 'i18n', TONGUE + '.json'), encoding='utf-8') as f:
            text = json.load(f).get(text) or text
    except (OSError, ValueError):
        pass
    OVER[0]({'kind': '', 'title': 'Exilewright', 'name': '', 'lines': [[(text, '')]]})


def watch_clipboard():
    """the one reader of the clipboard: item text goes to every page listening. With the window over the game, a line
    in it when no page is there to judge the item, or none answers"""
    global ASKED, PRESSED
    look, wait = CLIP
    seen, idle = None, True
    while True:
        time.sleep(wait)
        if not LISTEN and not OVER:
            idle = True                              # nobody to tell: the clipboard is left alone
            continue
        if idle:                                     # what was copied before anyone asked is nobody's business
            seen, idle = look(None)[0], False
            continue
        seen, text = look(seen)
        if text and len(text) < 8000 and re.search(r'\n-{8}\r?\n', text):
            if PRESSED[0] and time.monotonic() - PRESSED[1] < 2:   # copied by a shortcut
                text = {PRESSED[0]: text}
            PRESSED = ('', 0)
            for q in list(LISTEN):
                q.put(text)
            if OVER and LISTEN:
                ASKED = time.monotonic()
            elif OVER:
                tell('The planner is not open: nothing can judge the item')
        if ASKED and time.monotonic() - ASKED > 3:
            ASKED = 0
            tell("The planner's page is not answering: look at its tab once")


def watch_game():
    """the clipboard and, on Windows, the price check shortcut. Only one running copy of the app watches them (two, e.g.
    the installed app and one started from the folder, would each put their window over the game for one Ctrl+D):
    the first; another waits and takes over when it closes (the system hands the mutex on)"""
    if sys.platform == 'win32':
        k = ctypes.windll.kernel32
        k.CreateMutexW.restype = ctypes.c_void_p
        k.WaitForSingleObject(ctypes.c_void_p(k.CreateMutexW(None, False, r'Local\ExilewrightGameWatch')), 0xFFFFFFFF)
        threading.Thread(target=watch_keys, daemon=True).start()
    watch_clipboard()


def combo(text):
    """'Ctrl+Shift+D' -> ([modifier keys], key) as Windows numbers them, None when it is no shortcut the app takes:
    Ctrl and/or Alt (Shift too) with a letter, a digit or F1-F12"""
    *mods, key = str(text).split('+')
    vk = {'Ctrl': 0x11, 'Shift': 0x10, 'Alt': 0x12}
    if not {'Ctrl', 'Alt'} & set(mods) or any(m not in vk for m in mods):
        return None
    k = ord(key) if re.fullmatch('[A-Z0-9]', key) else 0x6F + int(key[1:]) if re.fullmatch('F([1-9]|1[0-2])', key) else None
    return k and ([vk[m] for m in mods], k)


def number(version):
    """'0.10' -> (0, 10), to compare versions"""
    return tuple(int(n) for n in re.findall(r'\d+', version))


assert number('0.10') > number('0.9') > number('0.2') and not number('0.2') > number('0.2'), 'number'
assert combo('Ctrl+D') == ([0x11], 0x44) and combo('Alt+F5') == ([0x12], 0x74) and combo('Shift+D') is None, 'combo'


def watch_keys():
    """Windows: a shortcut of KEYS pressed while the game is the window in use. The game copies the item under the
    pointer with Ctrl+C: that is sent once (the keys of the shortcut that are not Ctrl are let go first, so the game
    sees Ctrl+C alone), and the copy that follows is marked with the shortcut's name (watch_clipboard)"""
    global PRESSED
    user = ctypes.windll.user32
    user.GetForegroundWindow.restype = ctypes.c_void_p
    user.GetWindowTextW.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_int]
    was = set()
    while True:
        time.sleep(.03)
        down = {name for name, (mods, key) in KEYS.items() if all(user.GetAsyncKeyState(k) & 0x8000 for k in (*mods, key))}
        # Ctrl+Shift+D held also holds Ctrl+D: the shortcut with the most keys is the one pressed
        name = max(down - was, key=lambda n: len(KEYS[n][0]), default=None)
        was = down
        if name:
            mods, key = KEYS[name]
            title = ctypes.create_unicode_buffer(64)
            user.GetWindowTextW(user.GetForegroundWindow(), title, 64)
            if title.value.startswith('Path of Exile 2'):
                PRESSED = (name, time.monotonic())
                up, ctrl = 2, 0x11 in mods   # KEYEVENTF_KEYUP
                for k in (0x10, 0x12):
                    if k in mods:
                        user.keybd_event(k, 0, up, 0)
                for k, how in ((0x11, 0), (0x43, 0), (0x43, up)) + (() if ctrl else ((0x11, up),)):
                    user.keybd_event(k, 0, how, 0)


VERSION = '0.53'   # the app's version: the window's title, the update check and the installer (build_app.py) take it from here
RELEASES = 'mrtinotano/Exilewright'   # the GitHub repository whose latest release is the newest version
FROZEN = getattr(sys, 'frozen', False)   # the executable PyInstaller makes (build_app.py): the files are inside it
if FROZEN and sys.stderr is None:   # no console in the executable: the server's log goes nowhere
    sys.stdout = sys.stderr = open(os.devnull, 'w')
HERE = sys._MEIPASS if FROZEN else os.path.dirname(os.path.abspath(__file__))
ARGS = sys.argv[1:] + (['app'] if FROZEN else [])
SOUND_MAX = 10 << 20   # the biggest sound of the user's own the Filter tab copies into the game's folder
NOTED = 3      # seconds a notice that compares nothing stays over the game (the server's own, the item was taken as worn...)
COMPARED = {'up', 'mix', 'same', 'down', 'price'}   # kinds of verdict with a comparison to read: they stay until they are closed
TINT = {'up': '#8fe89a', 'mix': '#f0cc66', 'down': '#ee8888', 'on': '#8fc7ff'}
TONE = {'up': '#8fe89a', 'down': '#ee8888', 'dim': '#9a8f78'}   # pieces of a line: better, worse, said in passing
LISTEN = []    # a queue for every page listening to /clipboard
ASKED = 0      # when item text went to the pages, while no verdict for the window has come back
KEYS = {'price': combo('Ctrl+D'), 'worn': combo('Alt+D')}   # the shortcuts (Settings) as ([modifier keys], key), as the page last said
PRESSED = ('', 0)   # which shortcut sent Ctrl+C to the game, and when
TONGUE = tongue() if re.fullmatch('[a-z]{2}', tongue()) else 'en'   # then the language of the page that listened last
CLIP = clipboard()
OVER = overlay() if (sys.platform == 'win32' or 'overlay' in ARGS) and 'app' not in ARGS and 'nowatch' not in ARGS else None   # app(): its own thread
TRAY = None    # app(): set_tray(on), and whether it is on
RUN = r'Software\Microsoft\Windows\CurrentVersion\Run'


def at_startup(on=None):
    """whether Windows opens the app when the user logs in (it is told to when on is True or False): the executable
    only, with "startup" (it opens minimized, or only in the notification area)"""
    if not (FROZEN and sys.platform == 'win32'):
        return None
    import winreg
    cmd = f'"{sys.executable}" startup'
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, RUN) as k:
        if on:
            winreg.SetValueEx(k, 'Exilewright', 0, winreg.REG_SZ, cmd)
        elif on is False:
            try:
                winreg.DeleteValue(k, 'Exilewright')
            except FileNotFoundError:
                pass
        try:
            return winreg.QueryValueEx(k, 'Exilewright')[0] == cmd
        except FileNotFoundError:
            return False


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
            if what == 'exchange' and body is not None:   # the bulk exchange: a stackable item's price (trade.js priceBulk)
                if not re.fullmatch(r'[\w ]{1,60}', one('league')) or len(body) > 2000 or not isinstance(json.loads(body), dict):
                    return self.reply_json(400, b'{"error":{"message":"bad exchange"}}')
                return self.reply_json(*trade('exchange/poe2/' + quote(one('league')), body))
        except Exception as e:
            return self.reply_json(502, json.dumps({'error': {'message': str(e)}}).encode())
        self.reply_json(404, b'{"error":{"message":"not found"}}')

    def mine(self):
        """the request is from the page this server serves: not from a foreign page that points a name of its own at
        127.0.0.1, nor from another site's page open in the same browser"""
        host = self.headers.get('Host', '')
        return host.rsplit(':', 1)[0] in ('127.0.0.1', 'localhost') and self.headers.get('Origin') in (None, 'http://' + host)

    def do_pob(self, u):
        if not self.mine():   # the user's own builds: for the page this server serves only
            return self.reply(403, 'local only')
        try:
            names = sorted((f for f in os.listdir(POB) if f.lower().endswith('.xml')), key=lambda f: -os.path.getmtime(os.path.join(POB, f)))
        except OSError:   # no Path of Building 2 here
            names = []
        name = parse_qs(u.query).get('name', [''])[0]
        if not name:
            return self.reply_json(200, json.dumps(names).encode())
        if name not in names:   # one of the list, never a path of the page's own
            return self.reply(404, 'no such build')
        with open(os.path.join(POB, name), 'rb') as f:
            self.reply(200, f.read())

    def do_clipboard(self, u):
        global TONGUE
        if not self.mine():   # the clipboard can hold anything: only item text ever leaves, and only to that page
            return self.reply(403, 'local only')
        if not CLIP:
            return self.reply(501, 'no way to read the clipboard on this system')
        code = parse_qs(u.query).get('lang', [''])[0]
        if re.fullmatch('[a-z]{2}', code) and code != TONGUE:
            TONGUE = code
            try:   # kept for the next start: the window's messages are in it before any page listens
                os.makedirs(profile(), exist_ok=True)
                with open(os.path.join(profile(), 'language'), 'w', encoding='utf-8') as f:
                    f.write(code)
            except OSError:
                pass
        q = queue.Queue()
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.end_headers()
        LISTEN.append(q)
        try:
            self.wfile.write(b': watching\n\n')
            while True:
                self.wfile.flush()
                try:
                    self.wfile.write(f'data: {json.dumps(q.get(timeout=5))}\n\n'.encode())
                except queue.Empty:
                    self.wfile.write(b': still here\n\n')   # also how a closed page is noticed
        except OSError:   # the page was closed
            pass
        finally:
            LISTEN.remove(q)

    def do_overlay(self, body=None):
        global ASKED
        if body is None:
            return self.reply_json(200, json.dumps({'overlay': bool(OVER)}).encode())
        if not OVER or not self.mine():
            return self.reply(403, 'no window to show it in')
        try:
            v = json.loads(body) if len(body) < 16000 else None
        except ValueError:
            v = None
        ASKED = 0   # the page answered, be it with nothing to show
        if isinstance(v, dict):
            lines = v.get('lines')
            piece = lambda p: (str(p[0])[:160], str(p[1])) if isinstance(p, list) and len(p) == 2 else (str(p)[:160], '')
            link = str(v.get('link') or '')   # only a search on the official trade site is ever opened
            OVER[0]({'kind': str(v.get('kind')), 'title': str(v.get('title', ''))[:120], 'name': str(v.get('name', ''))[:120],
                     'link': link if re.fullmatch(r'https://www\.pathofexile\.com/trade2/(search|exchange)/poe2/[\w%.-]+/[\w-]+', link) else '',
                     'open': str(v.get('open', ''))[:60],
                     'lines': [[piece(p) for p in (x if isinstance(x, list) else [x])[:6]] for x in (lines if isinstance(lines, list) else [])[:30]]})
        self.reply(200, 'ok')

    def do_filter(self, body):
        if not self.mine():
            return self.reply(403, 'local only')
        try:
            x = json.loads(body)
            name, text = x['name'], x['text']
        except (ValueError, KeyError, TypeError):
            return self.reply(400, 'not a filter')
        if not isinstance(name, str) or not re.fullmatch(r'[^<>:"/\\|?*]{1,60}', name) or not name.isprintable() or name.strip(' .') != name or not isinstance(text, str):
            return self.reply(400, 'not a file name')
        path = os.path.join(game_folder(), name + '.filter')
        if os.path.exists(path) and not x.get('overwrite'):
            return self.reply(409, path)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w', encoding='utf-8', newline='\r\n') as f:
            f.write(text)
        self.reply(200, path)

    def do_sound(self, u, body=None):
        """a sound of the user's own for the Filter tab (CustomAlertSound): POST copies it into the game's folder, where
        the game looks for it; GET plays it back from there"""
        if not self.mine():
            return self.reply(403, 'local only')
        name = parse_qs(u.query).get('name', [''])[0]
        kind = {'.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg'}.get(os.path.splitext(name)[1].lower())
        if not kind or not re.fullmatch(r'[^<>:"/\\|?*]{1,80}', name) or not name.isprintable() or name.strip(' .') != name:
            return self.reply(400, 'not a sound file')
        path = os.path.join(game_folder(), name)
        if body is not None:
            if not body or len(body) > SOUND_MAX:
                return self.reply(413, 'too big')
            os.makedirs(game_folder(), exist_ok=True)
            with open(path, 'wb') as f:
                f.write(body)
            return self.reply(200, path)
        try:
            with open(path, 'rb') as f:
                data = f.read()
        except OSError:
            return self.reply(404, 'no such sound')
        self.send_response(200)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_save(self, body):
        """a build saved as a file: for the game's build planner (kind "game": a .build in its BuildPlanner folder, where
        the game reads them) or as JSON (kind "json": the Downloads folder). The app's window cannot download files the
        way a browser does"""
        if not self.mine():
            return self.reply(403, 'local only')
        try:
            x = json.loads(body)
            ext, name, text = {'game': '.build', 'json': '.json'}[x['kind']], x['name'], x['text']
        except (ValueError, KeyError, TypeError):
            return self.reply(400, 'not a build')
        if not isinstance(name, str) or not re.fullmatch(r'[^<>:"/\\|?*]{1,80}', name) or not name.isprintable() or name.strip(' .') != name or not isinstance(text, str):
            return self.reply(400, 'not a file name')
        # note: Downloads where Windows has it by default (a moved one is not looked up)
        folder = os.path.join(game_folder(), 'BuildPlanner') if ext == '.build' else os.path.join(os.path.expanduser('~'), 'Downloads')
        path = os.path.join(folder, name if name.endswith(ext) else name + ext)
        os.makedirs(folder, exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(text)
        self.reply(200, path)

    def do_update(self, post=False):
        if post and not self.mine():
            return self.reply(403, 'local only')
        try:
            # github.com's own link to the latest release, which goes on to its tag's page: not the API (60 asks an hour),
            # so it can be asked whenever the window comes to the front
            with urlopen(Request(f'https://github.com/{RELEASES}/releases/latest', method='HEAD', headers=UA), timeout=20) as r:
                page = r.geturl()
            latest = page.rsplit('/tag/v', 1)[1]
            if not re.fullmatch(r'\d+(\.\d+)*', latest):   # it goes into a link and a file name
                raise ValueError(f'not a version: {page}')
        except Exception as e:
            return self.reply_json(502, json.dumps({'error': str(e)}).encode())
        installed = FROZEN and not os.path.exists(os.path.join(os.path.dirname(sys.executable), 'portable'))
        newer = number(latest) > number(VERSION)
        if not post:
            return self.reply_json(200, json.dumps({'version': VERSION, 'latest': latest, 'newer': newer, 'page': page,
                                                    'install': installed, 'app': 'app' in ARGS}).encode())
        if not (newer and installed):
            return self.reply(409, 'nothing to install')
        try:
            path = os.path.join(os.environ.get('TEMP', profile()), f'Exilewright-setup-{latest}.exe')
            with open(path, 'wb') as f:
                f.write(call(f'https://github.com/{RELEASES}/releases/download/v{latest}/Exilewright-setup.exe'))   # each release has it
        except Exception as e:
            return self.reply(502, str(e))
        subprocess.Popen([path, '/SILENT', '/SUPPRESSMSGBOXES'], close_fds=True)
        self.reply(200, 'ok')
        threading.Timer(.5, os._exit, (0,)).start()   # once the page has its answer: the installer replaces these files

    def do_settings(self, body=None):
        global KEYS
        if not self.mine():
            return self.reply(403, 'local only')
        try:
            v = json.loads(body) if body and len(body) < 1000 else {}
        except ValueError:
            v = None
        if not isinstance(v, dict) or any(k + '_key' in v and not combo(v[k + '_key']) for k in KEYS):
            return self.reply(400, 'not a setting')
        KEYS = {k: combo(v[k + '_key']) if k + '_key' in v else c for k, c in KEYS.items()}
        if 'tray' in v and TRAY:
            TRAY[0](bool(v['tray']))
        on = at_startup(bool(v['on']) if 'on' in v else None)
        self.reply_json(200, json.dumps({'app': bool(TRAY), 'tray': bool(TRAY and TRAY[1]()), 'startup': on is not None, 'on': bool(on)}).encode())

    def do_GET(self):
        u = urlparse(self.path)
        if u.path.startswith('/trade/'):
            return self.do_trade(u)
        if u.path == '/clipboard':
            return self.do_clipboard(u)
        if u.path == '/pob':
            return self.do_pob(u)
        if u.path == '/filtersound':
            return self.do_sound(u)
        if u.path == '/overlay':
            return self.do_overlay()
        if u.path == '/update':
            return self.do_update()
        if u.path == '/settings':
            return self.do_settings()
        if u.path == '/game':   # the language the game is played in ('en'; '' when its settings file cannot be read)
            return self.reply_json(200, json.dumps({'language': game_setting('language')[:2].lower()}).encode())
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
        if u.path == '/overlay':
            return self.do_overlay(self.rfile.read(int(self.headers.get('Content-Length', 0))))
        if u.path == '/update':
            return self.do_update(post=True)
        if u.path == '/settings':
            return self.do_settings(self.rfile.read(int(self.headers.get('Content-Length', 0))))
        if u.path == '/filter':
            return self.do_filter(self.rfile.read(int(self.headers.get('Content-Length', 0))))
        if u.path == '/filtersound':
            return self.do_sound(u, self.rfile.read(min(int(self.headers.get('Content-Length', 0)), SOUND_MAX + 1)))
        if u.path == '/save':
            return self.do_save(self.rfile.read(int(self.headers.get('Content-Length', 0))))
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


def game_folder():
    """Documents/My Games/Path of Exile 2, where the game looks for .filter files (Documents as Windows has it, which may
    be moved to OneDrive)"""
    docs = os.path.expanduser('~/Documents')
    if sys.platform == 'win32':
        buf = ctypes.create_unicode_buffer(260)
        if ctypes.windll.shell32.SHGetFolderPathW(None, 5, None, 0, buf) == 0:   # 5: CSIDL_PERSONAL (Documents)
            docs = buf.value
    return os.path.join(docs, 'My Games', 'Path of Exile 2')


class Server(ThreadingHTTPServer):
    request_queue_size = 128   # a page asks for dozens of files at once; the ones that do not fit in the queue are lost
    # on Windows that option lets a second server take the port of one already running, instead of failing: the app
    # opened twice would run two servers (two clipboard watchers), and a page could reach the older one
    allow_reuse_address = allow_reuse_port = sys.platform != 'win32'


def profile():
    """where the app keeps the page's data (the builds): next to the executable in the portable version (a file named
    "portable" there), else the user's AppData, as an installed program does"""
    here = os.path.dirname(sys.executable) if FROZEN else HERE
    if os.path.exists(os.path.join(here, 'portable')) or not FROZEN:
        return os.path.join(here, 'profile')
    return os.path.join(os.environ.get('LOCALAPPDATA', here), 'Exilewright')


def app(url):
    """the page in a native window (WebView2, the web engine Windows has, embedded: no browser around it). The window
    over the game gets a thread of its own, as this one wants the main thread; closing the window stops everything.
    The window opens at the size, place and maximized or not it last had (window.json in the profile, with "tray": only
    an icon in the notification area, no taskbar button). Opened by Windows ("startup"): minimized, or only the icon"""
    import webview

    def over():
        global OVER
        OVER = overlay()
        if OVER:
            OVER[1]()
    if sys.platform == 'win32':
        threading.Thread(target=over, daemon=True).start()
    path = os.path.join(profile(), 'window.json')
    s = {'width': 1500, 'height': 950, 'x': None, 'y': None, 'maximized': True, 'tray': False}   # the first time: maximized
    try:
        with open(path, encoding='utf-8') as f:
            s.update(json.load(f))
    except (OSError, ValueError):
        pass
    if s['x'] is not None and not any(m.x <= s['x'] + 100 <= m.x + m.width and m.y <= s['y'] + 20 <= m.y + m.height for m in webview.screens):
        s['x'] = s['y'] = None   # its place is on a screen that is not there any more
    w = webview.create_window(f'Exilewright {VERSION}', url, width=s['width'], height=s['height'], x=s['x'], y=s['y'],
                              maximized=s['maximized'], min_size=(900, 600), text_select=True,
                              hidden='startup' in ARGS and s['tray'], minimized='startup' in ARGS and not s['tray'])

    def normal():   # maximizing moves the window before it says it is maximized: Windows itself is asked
        if sys.platform == 'win32':
            h = w.native.Handle.ToInt64()
            return not (ctypes.windll.user32.IsZoomed(ctypes.c_void_p(h)) or ctypes.windll.user32.IsIconic(ctypes.c_void_p(h)))
        return not s['maximized']

    timer = None

    def keep(**change):   # written half a second after the last change: an update or a killed app never says it is closing
        nonlocal timer
        s.update(change)
        if timer:
            timer.cancel()
        timer = threading.Timer(.5, write)
        timer.start()

    def write():
        try:
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(s, f)
        except OSError:
            pass
    w.events.resized += lambda width, height: normal() and keep(width=width, height=height)
    w.events.moved += lambda x, y: normal() and x > -10000 and keep(x=x, y=y)   # a minimized window is moved far off the screen
    icon = None

    def set_tray(on):   # on the window's thread: the taskbar button goes, the icon comes (or the other way round)
        nonlocal icon
        f = w.native
        if f.InvokeRequired:
            from System import Action
            return f.Invoke(Action(lambda: set_tray(on)))
        if on and not icon:
            from System.Drawing import Icon
            from System.Windows.Forms import NotifyIcon
            icon = NotifyIcon()
            icon.Icon, icon.Text = Icon.ExtractAssociatedIcon(sys.executable), f'Exilewright {VERSION}'
            icon.MouseClick += lambda *_: come_back()
        if icon:
            icon.Visible = on
        if f.ShowInTaskbar == on:
            f.ShowInTaskbar = not on
        if s['tray'] != on:
            keep(tray=on)

    def come_back():   # a click on the icon: the window as it was, in front
        from System.Windows.Forms import FormWindowState
        f = w.native
        f.Show()
        if f.WindowState == FormWindowState.Minimized:
            f.WindowState = FormWindowState.Maximized if s['maximized'] else FormWindowState.Normal
        f.Activate()
    if sys.platform == 'win32':
        global TRAY
        TRAY = (set_tray, lambda: s['tray'])
        w.events.before_show += lambda: s['tray'] and set_tray(True)   # before the window has a taskbar button
        w.events.minimized += lambda: s['tray'] and w.hide()   # with no taskbar button, minimized is hidden: the icon brings it back
    w.events.maximized += lambda: keep(maximized=True)
    w.events.restored += lambda: keep(maximized=False)
    webview.start(private_mode=False, storage_path=profile())
    if icon:
        icon.Dispose()   # else it stays in the notification area until the pointer goes over it
    os._exit(0)


try:   # the language of the page that listened last (do_clipboard), else the system's
    with open(os.path.join(profile(), 'language'), encoding='utf-8') as f:
        code = f.read().strip()
    if re.fullmatch('[a-z]{2}', code):
        TONGUE = code
except OSError:
    pass
port = 8767 if 'app' in ARGS else next((int(a) for a in ARGS if a.isdigit()), 8765)
try:
    server = Server(('127.0.0.1', port), partial(Handler, directory=HERE))
except OSError:   # the app is open already: one more window of it
    if 'app' not in ARGS:
        raise
    server = None
if CLIP and server and 'nowatch' not in ARGS:   # nowatch: a copy only for looking at the page, leaving the game's keys to the app
    threading.Thread(target=watch_game, daemon=True).start()
if 'app' in ARGS:
    if server:
        threading.Thread(target=server.serve_forever, daemon=True).start()
    app(f'http://127.0.0.1:{port}/')
if OVER:   # the window wants the main thread: the server goes to one of its own
    signal.signal(signal.SIGINT, signal.SIG_DFL)   # Ctrl+C in the terminal still stops it at once
    threading.Thread(target=server.serve_forever, daemon=True).start()
    OVER[1]()
else:
    if (sys.platform == 'win32' or 'overlay' in ARGS) and 'nowatch' not in ARGS:
        print('No window over the game: this Python has no tkinter (the Compare tab still works in the browser)')
    server.serve_forever()
