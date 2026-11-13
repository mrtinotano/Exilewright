"""Local server for the app; no-store so edited files show up on a normal reload."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import os


class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


ThreadingHTTPServer(('127.0.0.1', 8765), partial(NoCache, directory=os.path.dirname(os.path.abspath(__file__)))).serve_forever()
