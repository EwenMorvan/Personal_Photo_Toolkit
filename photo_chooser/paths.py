"""
Photo Studio – where things live on disk.

  code   : the folder of app.py (bundled with the installed app, or an update downloaded
           into %LOCALAPPDATA%\\PhotoStudio\\versions\\<version>)
  data   : what the user makes – projects, albums, montages, LUTs, brush masks.
           Installed app: Documents\\Photo Studio (or the folder chosen in the settings),
           so it survives updates and uninstalling.
  cache  : what can be rebuilt – thumbnails, AI maps. Installed app: %LOCALAPPDATA%\\PhotoStudio\\cache
  home   : the app's own files – settings, downloaded versions, log.

Running app.py from the source folder (launch.bat) keeps everything next to the code, as before.
PHOTOCHOOSER_HOME (tests) puts data and cache in that folder.
"""
import json
import os
import sys
from pathlib import Path

CODE_DIR = Path(__file__).parent
HOME = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "PhotoStudio"
SETTINGS_FILE = HOME / "settings.json"
# started by the installed launcher (Photo Studio.exe) – or the old one-file exe
INSTALLED = bool(os.environ.get("PHOTOSTUDIO_LAUNCHER")) or bool(getattr(sys, "frozen", False))


def documents() -> Path:
    """The user's real Documents folder (it may have been moved, e.g. to OneDrive)."""
    try:
        import ctypes
        from ctypes import wintypes
        class GUID(ctypes.Structure):
            _fields_ = [("a", wintypes.DWORD), ("b", wintypes.WORD), ("c", wintypes.WORD), ("d", ctypes.c_ubyte * 8)]
        fid = GUID(0xFDD39AD0, 0x238F, 0x46AF, (ctypes.c_ubyte * 8)(0xAD, 0xB4, 0x6C, 0x85, 0x48, 0x03, 0x69, 0xC7))
        p = ctypes.c_wchar_p()
        if ctypes.windll.shell32.SHGetKnownFolderPath(ctypes.byref(fid), 0, None, ctypes.byref(p)) == 0:
            out = Path(p.value)
            ctypes.windll.ole32.CoTaskMemFree(p)
            return out
    except Exception:
        pass
    return Path.home() / "Documents"


def settings() -> dict:
    try:
        return json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_settings(**kw):
    s = settings()
    s.update(kw)
    HOME.mkdir(parents=True, exist_ok=True)
    SETTINGS_FILE.write_text(json.dumps(s, ensure_ascii=False, indent=1), encoding="utf-8")


def default_data_dir() -> Path:
    return documents() / "Photo Studio"


if os.environ.get("PHOTOCHOOSER_HOME"):
    DATA_DIR = CACHE_DIR = Path(os.environ["PHOTOCHOOSER_HOME"])
    LOG_FILE = DATA_DIR / "photo_studio.log"
elif INSTALLED:
    DATA_DIR = Path(settings().get("data_dir") or default_data_dir())
    CACHE_DIR = HOME / "cache"
    LOG_FILE = HOME / "photo_studio.log"
else:
    DATA_DIR = CACHE_DIR = CODE_DIR
    LOG_FILE = CODE_DIR / "photo_studio.log"

for d in (DATA_DIR, CACHE_DIR):
    d.mkdir(parents=True, exist_ok=True)

# what belongs to the user in DATA_DIR (moved together when the folder is changed)
DATA_PARTS = ("projects", "albums", "montages", "luts", "paint")


def version() -> dict:
    try:
        return json.loads((CODE_DIR / "version.json").read_text(encoding="utf-8"))
    except Exception:
        return {"version": "0.0.0", "runtime": 1}
