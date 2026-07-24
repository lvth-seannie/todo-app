"""
Optional: package Retro ToDo as a double-clickable macOS .app bundle.

This does NOT require Xcode — only the Xcode Command Line Tools (a small
subset of Xcode) and py2app. See README.md for full instructions.

Usage:
    pip install py2app
    python3 setup.py py2app
"""

from setuptools import setup

APP = ["app.py"]
DATA_FILES = [("ui", ["ui/index.html", "ui/style.css", "ui/script.js"])]
OPTIONS = {
    "argv_emulation": False,
    "packages": ["webview"],
    "plist": {
        "CFBundleName": "Retro ToDo",
        "CFBundleDisplayName": "Retro ToDo",
        "CFBundleShortVersionString": "1.0.0",
        "CFBundleIdentifier": "local.retrotodo.app",
        "NSHighResolutionCapable": True,
    },
}

setup(
    app=APP,
    data_files=DATA_FILES,
    options={"py2app": OPTIONS},
    setup_requires=["py2app"],
)
