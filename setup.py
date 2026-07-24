"""
package mini-todo as a double-clickable macOS .app bundle.

does not require xcode — only the xcode command line tools and py2app.

usage:
    pip install py2app
    python3 setup.py py2app
"""

from setuptools import setup

APP = ["app.py"]
DATA_FILES = [("ui", ["ui/index.html", "ui/style.css", "ui/script.js"])]
OPTIONS = {
    "argv_emulation": False,
    "iconfile": "icon.icns",
    "packages": ["webview"],
    "plist": {
        "CFBundleName": "mini-todo",
        "CFBundleDisplayName": "mini-todo",
        "CFBundleShortVersionString": "1.0.0",
        "CFBundleIdentifier": "local.minitodo.app",
        "NSHighResolutionCapable": True,
    },
}

setup(
    app=APP,
    data_files=DATA_FILES,
    options={"py2app": OPTIONS},
    setup_requires=["py2app"],
)
