"""
Photo Studio – launcher (this is what the installer puts on the computer: "Photo Studio.exe").

It contains Python and every library the app needs, plus one copy of the app's code.
Updates download newer code into %LOCALAPPDATA%\\PhotoStudio\\versions\\<version>; on each
start the launcher runs the newest version it can (one that does not need libraries it
lacks). If that version fails to start, it is set aside and the previous one is used.

RUNTIME must be raised (and a new installer published) whenever a library is added,
removed or upgraded in a way the code relies on.
"""
import json
import os
import runpy
import subprocess
import sys
import traceback
from pathlib import Path

RUNTIME = 1

HOME = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "PhotoStudio"
VERSIONS = HOME / "versions"


def vkey(v):
    out = [int("".join(c for c in p if c.isdigit()) or 0) for p in str(v).lstrip("vV").split(".")]
    return tuple((out + [0, 0, 0])[:3])


def info(d: Path):
    try:
        return json.loads((d / "version.json").read_text(encoding="utf-8"))
    except Exception:
        return None


def candidates():
    bundled = Path(getattr(sys, "_MEIPASS", Path(__file__).parent)) / "app_code"
    if not bundled.exists():                       # running launcher.py from the sources
        bundled = Path(__file__).parent
    out = []
    v = info(bundled)
    if v:
        out.append((vkey(v["version"]), bundled))
    if VERSIONS.exists():
        for d in VERSIONS.iterdir():
            v = info(d) if d.is_dir() and not d.name.endswith(".tmp") else None
            if v and int(v.get("runtime", 1)) <= RUNTIME and not (d / "BROKEN").exists() and (d / "app.py").exists():
                out.append((vkey(v["version"]), d))
    out.sort(key=lambda x: x[0], reverse=True)
    return out


def alert(text):
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, text, "Photo Studio", 0x10)
    except Exception:
        pass


def main():
    HOME.mkdir(parents=True, exist_ok=True)
    cands = candidates()
    if not cands:
        alert("Photo Studio est incomplet : réinstallez l'application.")
        return
    code = cands[0][1]
    os.environ.update(PHOTOSTUDIO_LAUNCHER=sys.executable if getattr(sys, "frozen", False) else "",
                      PHOTOSTUDIO_RUNTIME=str(RUNTIME), PHOTOSTUDIO_VERSIONS=str(VERSIONS), PHOTOSTUDIO_CODE=str(code))
    if not os.environ["PHOTOSTUDIO_LAUNCHER"]:
        del os.environ["PHOTOSTUDIO_LAUNCHER"]
    sys.path.insert(0, str(code))
    try:
        runpy.run_path(str(code / "app.py"), run_name="__main__")
    except SystemExit:
        raise
    except BaseException:
        tb = traceback.format_exc()
        try:
            with open(HOME / "launcher.log", "a", encoding="utf-8") as f:
                f.write(f"--- {code}\n{tb}\n")
        except Exception:
            pass
        if len(cands) > 1 and code.parent == VERSIONS:
            # this update does not start: set it aside and start the previous version instead
            (code / "BROKEN").write_text(tb, encoding="utf-8")
            if getattr(sys, "frozen", False):
                subprocess.Popen([sys.executable], close_fds=True)
                return
        alert("Photo Studio n'a pas pu démarrer.\n\nDétails dans :\n" + str(HOME / "launcher.log"))


if __name__ == "__main__":
    main()
