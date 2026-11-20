#!/usr/bin/env python3
"""
AirDrop relay for the gallery build.

AirDrop always saves to ~/Downloads, and a web page can't read a folder on its own. This does
both halves: it moves each photo that arrives after the relay starts into
~/Downloads/clustr-gallery, and it serves that folder at http://127.0.0.1:4180 so the gallery
(?gallery) can pick the photos up with no clicks. Files already in Downloads when the relay
starts are left alone.

Run with: python3 scripts/airdrop-relay.py    Stop with Ctrl+C.
"""
import json
import mimetypes
import os
import shutil
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SRC = os.path.expanduser('~/Downloads')
DEST = os.path.join(SRC, 'clustr-gallery')
IMAGE_EXT = {'.jpg', '.jpeg', '.heic', '.heif', '.png', '.webp', '.gif', '.avif', '.tif', '.tiff'}
PORT = 4180  # must match RELAY_URL in src/lib/gallery.ts


def is_image(name):
    return os.path.splitext(name)[1].lower() in IMAGE_EXT


class PhotoServer(BaseHTTPRequestHandler):
    """GET /photos lists the gallery folder in arrival order. GET /photos/<name> sends one."""

    def do_GET(self):
        path = urllib.parse.unquote(urllib.parse.urlparse(self.path).path)
        if path == '/photos':
            names = [n for n in os.listdir(DEST) if is_image(n) and os.path.isfile(os.path.join(DEST, n))]
            # A move into the folder sets ctime, so this is the order photos arrived in.
            names.sort(key=lambda n: os.stat(os.path.join(DEST, n)).st_ctime)
            return self.send(200, json.dumps(names).encode(), 'application/json')
        if path.startswith('/photos/'):
            # basename keeps requests inside the gallery folder.
            name = os.path.basename(path[len('/photos/'):])
            file = os.path.join(DEST, name)
            if is_image(name) and os.path.isfile(file):
                with open(file, 'rb') as f:
                    body = f.read()
                kind = 'image/heic' if name.lower().endswith(('.heic', '.heif')) else (
                    mimetypes.guess_type(name)[0] or 'application/octet-stream')
                return self.send(200, body, kind)
        self.send(404, b'not found', 'text/plain')

    def send(self, code, body, kind):
        self.send_response(code)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(body)))
        # The gallery runs on another localhost port, so it needs CORS to read these.
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass  # the gallery polls every 1.5 s; keep the terminal for arrivals


def main():
    os.makedirs(DEST, exist_ok=True)
    # New arrivals are told apart by name, not by date. AirDrop keeps a photo's original
    # created and modified dates, so a photo taken last month looks old even as it lands.
    seen = set(os.listdir(SRC))
    sizes = {}  # name -> size at the last poll
    # Only this Mac can reach the server: it binds to 127.0.0.1, not the venue network.
    server = ThreadingHTTPServer(('127.0.0.1', PORT), PhotoServer)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    print(f'Relaying new photos from {SRC} to {DEST}.')
    print(f'Serving them to the gallery at http://127.0.0.1:{PORT}/photos. Ctrl+C to stop.')
    while True:
        for name in os.listdir(SRC):
            if name in seen:
                continue
            path = os.path.join(SRC, name)
            if not is_image(name) or not os.path.isfile(path):
                seen.add(name)
                continue
            # Only move a file once its size holds still across two polls, so a transfer in
            # progress is never moved.
            size = os.stat(path).st_size
            settled = sizes.get(name) == size
            sizes[name] = size
            if not settled or size == 0:
                continue
            target = os.path.join(DEST, name)
            if os.path.exists(target):
                stem, ext = os.path.splitext(name)
                target = os.path.join(DEST, f'{stem}-{int(time.time() * 1000)}{ext}')
            try:
                shutil.move(path, target)
                sizes.pop(name, None)
                seen.add(name)
                print(f'  {name}')
            except OSError as e:
                print(f'  could not move {name}: {e}')
        time.sleep(1)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('\nStopped.')
