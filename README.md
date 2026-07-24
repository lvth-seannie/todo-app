# Retro ToDo

A tiny local to-do app: a small calendar on the left to pick a day, a
Today/Completed tab switch, and a simple add-task bar — styled like a clean
dark Figma panel (rounded corners, soft borders, one purple accent, pointer
cursors on anything clickable) rather than the retro-terminal look of the
original screenshot.

It's a normal Python script that opens one native window. Everything is
stored in a `tasks.json` file next to `app.py` — nothing leaves your Mac,
there's no server, no account, no internet needed.

## About Xcode

You don't need Xcode (the IDE) for any of this — Xcode is for building
native Swift/Objective-C apps, and this is a Python app. The only thing
you might need is the **Xcode Command Line Tools**, a small, free download
that provides compiler tools some Python packages need when installing on
macOS (in particular `pyobjc`, which `pywebview` uses to draw a native
window on macOS). If you don't already have them:

```bash
xcode-select --install
```

That's a one-time, ~1 GB install — not the full Xcode app (~15 GB).

## Setup (one time)

You're on an M4 Pro MacBook, so this all runs natively (no Rosetta needed).

```bash
# 1. Go into the project folder
cd retro-todo

# 2. Create a virtual environment (keeps this separate from other Python projects)
python3 -m venv venv
source venv/bin/activate

# 3. Install dependencies
venv/bin/python -m pip install -r requirements.txt
```

If `pywebview` fails to install with a compiler error, run
`xcode-select --install` (above) and try again.

## Run it

```bash
source venv/bin/activate   # if not already active
python3 app.py
```

A window titled "Retro ToDo" opens with the normal native macOS title bar
and traffic-light buttons. Close the window to quit — your tasks stay in
`tasks.json`.

## Using the app

- **Calendar (left)** — click any day to select it; the day you have
  selected is highlighted in purple, today's date is highlighted in cyan.
  Use the `‹` `›` arrows to browse other months, and "Jump to today" to
  snap back. A small dot under a date means it has tasks.
- **Add a task** — type in the bar at the top and press **Add** or hit
  **Enter**. It's added to whichever day is currently selected.
- **Today tab** — shows open (not-yet-done) tasks for the selected day.
  Click the circle to mark a task done (it'll move to Completed); click
  the task text to rename it; the `✕` on hover deletes it.
- **Completed tab** — shows tasks you've finished for the selected day,
  each with the time it was completed.

## Optional: make it a double-clickable app (no Xcode needed)

If you'd like to launch it from Finder/Spotlight instead of the terminal,
you can bundle it with `py2app`:

```bash
source venv/bin/activate
pip install py2app
python3 setup.py py2app
```

This creates `dist/Retro ToDo.app` — drag it into `/Applications` and
double-click like any other Mac app. (First launch may need a right-click
→ Open, since the app isn't notarized/signed by Apple.)

## Notes / limitations

- Data is a single local JSON file — fine for personal use, not meant for
  multiple people editing at once.
- No cloud sync, no login — this was built for local, single-user use as
  requested.
- Want the exact retro-terminal look from your screenshot instead of the
  Figma-style skin? Everything visual lives in `ui/style.css`, so colors,
  fonts, and radii are easy to swap.
