"""
Todo App — Korean aesthetic local desktop to-do app.

Run locally with:
    python3 app.py

All data is stored in a plain JSON file (tasks.json) next to this script.
Data shape:
{
  "categories": ["Work", "Personal", ...],
  "<YYYY-MM-DD>": [{id, text, done, completed_at, category}, ...],
  ...
}
"""

import json
import os
import threading
from datetime import datetime

import webview

APP_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(APP_DIR, "tasks.json")

_lock = threading.Lock()


class Api:
    """Exposed to the frontend as `window.pywebview.api.<method>(...)`.

    Every public method is callable from JavaScript and returns
    JSON-serialisable data.
    """

    def __init__(self):
        self.data = self._load()

    # -- persistence ---------------------------------------------------------

    def _load(self):
        if os.path.exists(DATA_FILE):
            try:
                with open(DATA_FILE, "r", encoding="utf-8") as f:
                    return json.load(f)
            except (json.JSONDecodeError, OSError):
                return {}
        return {}

    def _save(self):
        with _lock:
            with open(DATA_FILE, "w", encoding="utf-8") as f:
                json.dump(self.data, f, indent=2)

    # -- category operations -------------------------------------------------

    def get_categories(self):
        return self.data.get("categories", [])

    def add_category(self, name):
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
        with _lock:
            cats = self.data.get("categories", [])
            self.data["categories"] = [c for c in cats if c != name]
        self._save()
        return self.data.get("categories", [])

    # -- task operations -----------------------------------------------------

    def get_tasks(self, date):
        return self.data.get(date, [])

    def add_task(self, date, text, category=""):
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
        return {
            d: len(v)
            for d, v in self.data.items()
            if d != "categories" and isinstance(v, list) and v
        }


def main():
    api = Api()
    ui_path = os.path.join(APP_DIR, "ui", "index.html")
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
