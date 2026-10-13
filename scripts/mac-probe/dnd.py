import http.server, threading, functools
from playwright.sync_api import sync_playwright
h = functools.partial(http.server.SimpleHTTPRequestHandler, directory='scripts/mac-probe')
s = http.server.ThreadingHTTPServer(('127.0.0.1', 0), h); threading.Thread(target=s.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{s.server_address[1]}/index.html"
with sync_playwright() as p:
    for name in ("chromium","webkit"):
        b = getattr(p,name).launch(); pg = b.new_page(); pg.goto(url)
        pg.locator('#a').drag_to(pg.locator('#b'))
        print(name, sorted(set(pg.evaluate('log'))))
        b.close()
s.shutdown()
