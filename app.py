"""
Retro ToDo — a tiny local desktop to-do app.

Layout is inspired by a retro terminal-style to-do app (calendar + Today/
Completed tabs), restyled with a clean, modern "Figma-app" visual language:
soft dark panels, rounded corners, subtle borders/shadows, a single purple
accent, and pointer cursors on anything clickable.

Run locally with:
    python3 app.py

All data is stored in a plain JSON file (tasks.json) next to this script —
no server, no database, nothing leaves your machine.
"""

import json
import os
import threading
from datetime import datetime

import webview

APP_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(APP_DIR, "tasks.json")

# Guards concurrent writes from the webview UI thread.
_lock = threading.Lock()


class Api:
    """Exposed to the frontend as `window.pywebview.api.<method>(...)`.

    Every public method here is callable from JavaScript and returns
    JSON-serialisable data (pywebview handles the marshalling).
    """

    def __init__(self):
        self.data = self._load()

    # -- persistence -----------------------------------------------------

    def _load(self):
        if os.path.exists(DATA_FILE):
            try:
                with open(DATA_FILE, "r", encoding="utf-8") as f:
                    return json.load(f)
            except (json.JSONDecodeError, OSError):
                # Corrupt or unreadable file: start fresh rather than crash.
                return {}
        return {}

    def _save(self):
        with _lock:
            with open(DATA_FILE, "w", encoding="utf-8") as f:
                json.dump(self.data, f, indent=2)

    # -- task operations (called from script.js) -------------------------

    def get_tasks(self, date):
        """Return the list of tasks for a given ISO date string (YYYY-MM-DD)."""
        return self.data.get(date, [])

    def add_task(self, date, text):
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
            }
            self.data[date].append(task)
        self._save()
        return self.data[date]

    def toggle_task(self, date, task_id):
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
        with _lock:
            tasks = self.data.get(date, [])
            self.data[date] = [t for t in tasks if t["id"] != task_id]
        self._save()
        return self.data.get(date, [])

    def edit_task(self, date, task_id, new_text):
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
        """Used to put a small dot on calendar days that have any tasks."""
        return {d: len(v) for d, v in self.data.items() if v}


def main():
    api = Api()
    ui_path = os.path.join(APP_DIR, "ui", "index.html")
    webview.create_window(
        "Retro ToDo",
        ui_path,
        js_api=api,
        width=1040,
        height=700,
        min_size=(760, 560),
        background_color="#1a1a1e",
    )
    webview.start()


if __name__ == "__main__":
    main()
