"""
Todo App — Korean aesthetic local desktop to-do app.

Run locally with:
    python3 app.py

All data is stored in a plain JSON file (tasks.json) in iCloud Drive
(~/Library/Mobile Documents/com~apple~CloudDocs/Applications/mini-todo/) so it syncs
between Macs. If iCloud Drive isn't available it falls back to
~/Library/Application Support/mini-todo/.

On the iPhone, phone/mini-todo.js runs the same UI inside the Scriptable app
and edits that iCloud file directly, so it works without the Mac.

While the window is open, the same UI is also served on the local network
(http://<mac-ip>:8765/?key=...) so a phone on the same Wi-Fi can use it.
Data shape:
{
  "categories": ["Work", "Personal", ...],
  "<YYYY-MM-DD>": [{id, text, done, completed_at, category}, ...],
  ...
}
"""

import json
import os
import secrets
import shutil
import socket
import threading
from datetime import datetime
from socketserver import TCPServer
from wsgiref.simple_server import WSGIRequestHandler, WSGIServer

import bottle
import webview

APP_DIR = os.path.dirname(os.path.abspath(__file__))
UI_DIR = os.path.join(APP_DIR, "ui")
PORT = 8765

HOME = os.path.expanduser("~")
LEGACY_DATA_DIR = os.path.join(HOME, "Library", "Application Support", "mini-todo")
ICLOUD_ROOT = os.path.join(HOME, "Library", "Mobile Documents", "com~apple~CloudDocs")
SCRIPTABLE_DIR = os.path.join(HOME, "Library", "Mobile Documents", "iCloud~dk~simonbs~Scriptable", "Documents")

# Where the data folder lives inside iCloud Drive. Change this to move it
# (quit the app, drag the folder there in Finder, then update this path).
ICLOUD_SUBDIR = os.path.join("Applications", "mini-todo")

# Prefer iCloud Drive so tasks sync across Macs; fall back to Application Support.
if os.path.isdir(ICLOUD_ROOT):
    DATA_DIR = os.path.join(ICLOUD_ROOT, ICLOUD_SUBDIR)
else:
    DATA_DIR = LEGACY_DATA_DIR
DATA_FILE = os.path.join(DATA_DIR, "tasks.json")

# One-time migrations from older locations, if there's no data here yet.
_old_icloud_dir = os.path.join(ICLOUD_ROOT, "mini-todo")
_legacy_file = os.path.join(LEGACY_DATA_DIR, "tasks.json")
if DATA_DIR != LEGACY_DATA_DIR and not os.path.exists(DATA_FILE):
    if DATA_DIR != _old_icloud_dir and os.path.exists(os.path.join(_old_icloud_dir, "tasks.json")):
        os.makedirs(os.path.dirname(DATA_DIR), exist_ok=True)
        if os.path.exists(DATA_DIR):
            os.rmdir(DATA_DIR)  # only succeeds if empty, so nothing is ever overwritten
        shutil.move(_old_icloud_dir, DATA_DIR)
    elif os.path.exists(_legacy_file):
        os.makedirs(DATA_DIR, exist_ok=True)
        shutil.copy2(_legacy_file, DATA_FILE)
os.makedirs(DATA_DIR, exist_ok=True)

# Secret key required by the phone/web server, so others on the Wi-Fi can't read tasks.
KEY_FILE = os.path.join(DATA_DIR, "web_key.txt")
if not os.path.exists(KEY_FILE):
    with open(KEY_FILE, "w") as f:
        f.write(secrets.token_urlsafe(12))
with open(KEY_FILE) as f:
    WEB_KEY = f.read().strip()

_lock = threading.RLock()


def sync_phone_files():
    """Copy the UI (and the Scriptable script) into iCloud so the iPhone version stays current."""
    if DATA_DIR == LEGACY_DATA_DIR:
        return
    try:
        dest = os.path.join(DATA_DIR, "ui")
        os.makedirs(dest, exist_ok=True)
        for name in ("index.html", "style.css", "script.js"):
            shutil.copy2(os.path.join(UI_DIR, name), os.path.join(dest, name))
        if os.path.isdir(SCRIPTABLE_DIR):
            shutil.copy2(
                os.path.join(APP_DIR, "phone", "mini-todo.js"),
                os.path.join(SCRIPTABLE_DIR, "mini-todo.js"),
            )
    except OSError:
        pass


class Api:
    """Exposed to the frontend as `window.pywebview.api.<method>(...)`.

    Every public method is callable from JavaScript and returns
    JSON-serialisable data.
    """

    def __init__(self):
        self._mtime = None
        self.data = self._load()

    # -- persistence ---------------------------------------------------------

    def _load(self):
        if os.path.exists(DATA_FILE):
            try:
                self._mtime = os.path.getmtime(DATA_FILE)
                with open(DATA_FILE, "r", encoding="utf-8") as f:
                    return json.load(f)
            except (json.JSONDecodeError, OSError):
                return {}
        return {}

    def _refresh(self):
        """Reload if the file changed on disk (e.g. synced from another Mac)."""
        try:
            mtime = os.path.getmtime(DATA_FILE)
        except OSError:
            return
        if mtime != self._mtime:
            with _lock:
                self.data = self._load()

    def _save(self):
        with _lock:
            # Write to a temp file and swap it in, so iCloud never syncs a half-written file.
            tmp = DATA_FILE + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self.data, f, indent=2)
            os.replace(tmp, DATA_FILE)
            self._mtime = os.path.getmtime(DATA_FILE)

    # -- category operations -------------------------------------------------

    def get_categories(self):
        self._refresh()
        return self.data.get("categories", [])

    def add_category(self, name):
        self._refresh()
        name = (name or "").strip()
        if not name:
            return self.get_categories()
        with _lock:
            cats = self.data.setdefault("categories", [])
            if name not in cats:
                cats.append(name)
        self._save()
        return self.data["categories"]

    def delete_category(self, name):
        self._refresh()
        with _lock:
            cats = self.data.get("categories", [])
            self.data["categories"] = [c for c in cats if c != name]
        self._save()
        return self.data.get("categories", [])

    # -- task operations -----------------------------------------------------

    def get_tasks(self, date):
        self._refresh()
        return self.data.get(date, [])

    def add_task(self, date, text, category=""):
        self._refresh()
        text = (text or "").strip()
        if not text:
            return self.data.get(date, [])
        with _lock:
            self.data.setdefault(date, [])
            task = {
                "id": f"{int(datetime.now().timestamp() * 1000)}",
                "text": text,
                "done": False,
                "completed_at": None,
                "category": (category or "").strip(),
            }
            self.data[date].append(task)
        self._save()
        return self.data[date]

    def toggle_task(self, date, task_id):
        self._refresh()
        with _lock:
            tasks = self.data.get(date, [])
            for t in tasks:
                if t["id"] == task_id:
                    t["done"] = not t["done"]
                    t["completed_at"] = (
                        datetime.now().strftime("%H:%M") if t["done"] else None
                    )
        self._save()
        return self.data.get(date, [])

    def delete_task(self, date, task_id):
        self._refresh()
        with _lock:
            tasks = self.data.get(date, [])
            self.data[date] = [t for t in tasks if t["id"] != task_id]
        self._save()
        return self.data.get(date, [])

    def edit_task(self, date, task_id, new_text):
        self._refresh()
        new_text = (new_text or "").strip()
        if not new_text:
            return self.data.get(date, [])
        with _lock:
            tasks = self.data.get(date, [])
            for t in tasks:
                if t["id"] == task_id:
                    t["text"] = new_text
        self._save()
        return self.data.get(date, [])

    def get_days_with_tasks(self):
        self._refresh()
        return {
            d: len(v)
            for d, v in self.data.items()
            if d != "categories" and isinstance(v, list) and v
        }

    def get_tasks_by_category(self, category):
        """All tasks tagged with `category`, across every date, newest date first."""
        self._refresh()
        result = []
        for d in sorted(self.data.keys(), reverse=True):
            v = self.data[d]
            if d == "categories" or not isinstance(v, list):
                continue
            for t in v:
                if t.get("category") == category:
                    result.append({**t, "date": d})
        return result

    def get_web_url(self):
        # Find this Mac's Wi-Fi/LAN address (no packets are actually sent).
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("10.255.255.255", 1))
            host = s.getsockname()[0]
        except OSError:
            host = "localhost"
        finally:
            s.close()
        return f"http://{host}:{PORT}/?key={WEB_KEY}"


# -- local network server (for using the app from a phone) -----------------

class _QuietHandler(WSGIRequestHandler):
    # Browsers often try https:// first, which this plain-http server rejects
    # with a noisy "Bad request" log line before they fall back. Keep the terminal clean.
    def log_message(self, *args):
        pass


class _FastServer(WSGIServer):
    # The stock server_bind does a reverse DNS lookup (socket.getfqdn) that can
    # hang for a long time on some home networks. The name isn't needed.
    def server_bind(self):
        TCPServer.server_bind(self)
        self.server_name = "localhost"
        self.server_port = self.server_address[1]
        self.setup_environ()


def start_web_server(api):
    app = bottle.Bottle()

    @app.get("/")
    def index():
        # Mark the page so script.js knows to use HTTP instead of window.pywebview.
        with open(os.path.join(UI_DIR, "index.html"), encoding="utf-8") as f:
            html = f.read()
        return html.replace("<head>", "<head>\n  <script>window.MINI_TODO_WEB = true;</script>", 1)

    @app.get("/<filename:re:[a-z]+\\.(js|css)>")
    def static(filename):
        return bottle.static_file(filename, root=UI_DIR)

    @app.post("/api/<name>")
    def call(name):
        if bottle.request.headers.get("X-Key") != WEB_KEY:
            bottle.abort(403, "bad key")
        method = getattr(api, name, None)
        if name.startswith("_") or not callable(method):
            bottle.abort(404)
        args = (bottle.request.json or {}).get("args", [])
        bottle.response.content_type = "application/json"
        return json.dumps(method(*args))

    def serve():
        try:
            bottle.run(app, host="0.0.0.0", port=PORT, quiet=True,
                       server_class=_FastServer, handler_class=_QuietHandler)
        except OSError:
            pass  # port taken, e.g. another mini-todo window is already serving it

    threading.Thread(target=serve, daemon=True).start()


def main():
    sync_phone_files()
    api = Api()
    start_web_server(api)
    ui_path = os.path.join(UI_DIR, "index.html")
    webview.create_window(
        "mini-todo",
        ui_path,
        js_api=api,
        width=1040,
        height=700,
        min_size=(760, 560),
        background_color="#FFFBF0",
    )
    webview.start()


if __name__ == "__main__":
    main()
