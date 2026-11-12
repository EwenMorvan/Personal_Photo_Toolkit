"""
Photo Studio – automatic updates, data folder, import from the old version.

How updates work
  · Each release is a GitHub Release of the repository named in version.json ("repo"),
    tagged <tag_prefix>X.Y.Z (the repository also publishes other apps: their tags are ignored). Its text (taken from CHANGELOG.md by release.py) is what the user reads.
  · It carries update.json ({version, runtime, sha256}), the app code as a zip, and the
    installer. The code zip is small: the installed launcher already contains Python and
    every library, so most updates only replace the code.
  · "runtime" counts the launcher's libraries. A release that needs a newer launcher
    (a new library) is installed with the installer instead, downloaded and run the same way.
  · The check is quiet: no network, no repo configured or no newer version → nothing shown.
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
import zipfile
from pathlib import Path

from flask import jsonify, request

import paths

API = os.environ.get("PHOTOSTUDIO_UPDATE_API", "https://api.github.com")
VERSIONS = Path(os.environ.get("PHOTOSTUDIO_VERSIONS") or paths.HOME / "versions")
LAUNCHER = os.environ.get("PHOTOSTUDIO_LAUNCHER")              # the installed Photo Studio.exe
RUNTIME = int(os.environ.get("PHOTOSTUDIO_RUNTIME") or 0)      # libraries of that launcher
UA = {"User-Agent": "PhotoStudio-updater", "Accept": "application/vnd.github+json"}

_state = {"check": None, "job": None}
_lock = threading.Lock()


def vkey(v: str):
    out = []
    for part in str(v).lstrip("vV").split("."):
        digits = "".join(c for c in part if c.isdigit())
        out.append(int(digits or 0))
    return tuple((out + [0, 0, 0])[:3])


def _get(url, timeout=6):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read()


def tag_version(tag: str, prefix: str):
    """'photo-studio-v1.2.0' → '1.2.0'; None for a tag of another app."""
    if prefix:
        return tag[len(prefix):] if tag.startswith(prefix) else None
    return tag.lstrip("vV")


def check(force=False) -> dict:
    """What is available, with the notes of every version newer than this one."""
    with _lock:
        c = _state["check"]
        if c and not force and time.time() - c["at"] < 3600:
            return c
    cur = paths.version()
    out = {"at": time.time(), "current": cur["version"], "available": False, "can_update": bool(LAUNCHER),
           "repo": os.environ.get("PHOTOSTUDIO_UPDATE_REPO") or cur.get("repo") or ""}
    if not out["repo"]:
        out["error"] = "Aucun dépôt de mises à jour configuré."
    else:
        try:
            prefix = cur.get("tag_prefix", "")
            rels = json.loads(_get(f"{API}/repos/{out['repo']}/releases?per_page=50"))
            for r in rels:
                r["_v"] = tag_version(r.get("tag_name", ""), prefix)
            rels = [r for r in rels if r["_v"] and not r.get("draft") and not r.get("prerelease") and vkey(r["_v"]) > vkey(cur["version"])
                    # a version that was installed here and failed to start is not offered again
                    and not (VERSIONS / r["_v"] / "BROKEN").exists()]
            rels.sort(key=lambda r: vkey(r["_v"]), reverse=True)
            if rels:
                top = rels[0]
                assets = {a["name"]: a["browser_download_url"] for a in top.get("assets", [])}
                manifest = json.loads(_get(assets["update.json"])) if "update.json" in assets else {}
                code = next((u for n, u in assets.items() if n.startswith("photo-studio-code") and n.endswith(".zip")), None)
                setup = next((u for n, u in assets.items() if n.lower().endswith(".exe")), None)
                runtime = int(manifest.get("runtime", 1))
                out.update(available=True, latest=top["_v"], runtime=runtime, sha256=manifest.get("sha256"),
                           code_url=code, setup_url=setup, page=top.get("html_url"),
                           # a release that needs newer libraries than this launcher has: full installer
                           mode="code" if code and RUNTIME and runtime <= RUNTIME else "installer" if setup else "page",
                           notes=[{"version": r["_v"], "date": (r.get("published_at") or "")[:10],
                                   "text": r.get("body") or ""} for r in rels])
                skipped = paths.settings().get("skip_version")
                out["skipped"] = skipped == out["latest"]
        except Exception as e:                       # offline, rate-limited, repo private…: stay quiet
            out["error"] = f"Vérification impossible ({e.__class__.__name__})"
    with _lock:
        _state["check"] = out
    return out


def _download(url, dest, job, share):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA["User-Agent"]}), timeout=30) as r:
        total = int(r.headers.get("Content-Length") or 0)
        h, done = hashlib.sha256(), 0
        with open(dest, "wb") as f:
            while True:
                b = r.read(1 << 16)
                if not b:
                    break
                f.write(b); h.update(b); done += len(b)
                if total:
                    job["progress"] = round(share * done / total, 3)
    return h.hexdigest()


def _apply(info, job):
    try:
        tmp = Path(tempfile.mkdtemp(prefix="photostudio-"))
        if info["mode"] == "code":
            job["step"] = "Téléchargement…"
            z = tmp / "code.zip"
            sha = _download(info["code_url"], z, job, 0.85)
            if info.get("sha256") and sha != info["sha256"]:
                raise RuntimeError("le fichier téléchargé est abîmé (somme de contrôle différente)")
            job["step"] = "Installation…"
            dest = VERSIONS / info["latest"]
            work = VERSIONS / (info["latest"] + ".tmp")
            shutil.rmtree(work, ignore_errors=True)
            with zipfile.ZipFile(z) as zf:
                names = zf.namelist()
                if "app.py" not in names or "version.json" not in names:
                    raise RuntimeError("le paquet de mise à jour est incomplet")
                for n in names:                       # never write outside the target folder
                    if n.startswith(("/", "\\")) or ".." in Path(n).parts:
                        raise RuntimeError("le paquet de mise à jour est invalide")
                zf.extractall(work)
            shutil.rmtree(dest, ignore_errors=True)
            os.replace(work, dest)
            _prune()
            job.update(progress=1, step="Prêt", done=True)
        else:
            job["step"] = "Téléchargement de l'installateur…"
            exe = tmp / f"PhotoStudio-Setup-{info['latest']}.exe"
            _download(info["setup_url"], exe, job, 1)
            job.update(progress=1, step="Prêt", done=True, setup=str(exe))
        shutil.rmtree(tmp, ignore_errors=True) if info["mode"] == "code" else None
    except Exception as e:
        job.update(error=str(e), done=True)


def _prune(keep=2):
    """Keep the newest downloaded versions only (the bundled one always stays in the launcher)."""
    try:
        vs = sorted((d for d in VERSIONS.iterdir() if d.is_dir() and not d.name.endswith(".tmp")),
                    key=lambda d: vkey(d.name), reverse=True)
        for d in vs[keep:]:
            if Path(paths.CODE_DIR).resolve() != d.resolve():
                shutil.rmtree(d, ignore_errors=True)
    except FileNotFoundError:
        pass


def restart(core, installer=None):
    """Start the launcher again (it picks the newest version) or the installer, then stop."""
    env = dict(os.environ, PHOTOSTUDIO_RESTART="1", PHOTOCHOOSER_NO_BROWSER="1")   # the open window stays
    flags = getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    if installer:
        subprocess.Popen([installer, "/SILENT", "/SP-", "/NOCANCEL", "/CLOSEAPPLICATIONS"], creationflags=flags, close_fds=True)
    else:
        subprocess.Popen([LAUNCHER], env=env, creationflags=flags, close_fds=True, cwd=str(Path(LAUNCHER).parent))
    threading.Timer(0.6, lambda: os._exit(0)).start()


# ── data folder & the old version's projects ─────────────────────────────────
def _copy_tree(src: Path, dst: Path, stats):
    for root, _dirs, files in os.walk(src):
        r = Path(root)
        out = dst / r.relative_to(src)
        out.mkdir(parents=True, exist_ok=True)
        for f in files:
            t = out / f
            if t.exists():
                stats["skipped"] += 1
                continue
            shutil.copy2(r / f, t)
            stats["copied"] += 1


def _subdirs(d: Path, n: int):
    try:
        return [x for x in d.iterdir() if x.is_dir() and not x.name.startswith((".", "$"))][:n]
    except OSError:                                  # protected folders ("Ma musique"…), broken links
        return []


def _old_installs():
    """Folders where the old Photo_chooser.exe kept its projects (next to the exe):
    Documents, Desktop, Downloads and two levels below them."""
    roots = [paths.documents(), Path.home() / "Desktop", Path.home() / "Downloads", Path.home() / "OneDrive" / "Bureau",
             Path.home() / "OneDrive" / "Desktop", Path.home() / "OneDrive" / "Documents"]
    found, seen = [], {paths.DATA_DIR.resolve()}
    for root in roots:
        if not root.is_dir():
            continue
        for d in [root] + _subdirs(root, 200):
            for cand in [d] + (_subdirs(d, 60) if d != root else []):
                try:
                    projs = sum(1 for _ in (cand / "projects").glob("*/project.json")) if (cand / "projects").is_dir() else 0
                    if projs and cand.resolve() not in seen:
                        seen.add(cand.resolve())
                        found.append({"path": str(cand), "projects": projs})
                except OSError:
                    pass
    found.sort(key=lambda f: -f["projects"])
    return found[:10]


def register(app, core):
    @app.route("/api/app/info")
    def app_info():
        v = paths.version()
        empty = not any((paths.DATA_DIR / "projects").glob("*/project.json")) if (paths.DATA_DIR / "projects").exists() else True
        return jsonify({"version": v["version"], "installed": paths.INSTALLED, "launcher": bool(LAUNCHER),
                        "data_dir": str(paths.DATA_DIR), "empty": empty, "repo": v.get("repo", "")})

    @app.route("/api/update/check")
    def update_check():
        c = check(force=request.args.get("force") == "1")
        return jsonify({k: v for k, v in c.items() if k != "at"})

    @app.route("/api/update/skip", methods=["POST"])
    def update_skip():
        paths.save_settings(skip_version=(request.json or {}).get("version"))
        return jsonify({"ok": True})

    @app.route("/api/update/apply", methods=["POST"])
    def update_apply():
        info = check()
        if not info.get("available"):
            return jsonify({"error": "Aucune mise à jour disponible"}), 400
        if not LAUNCHER:
            return jsonify({"error": "Mise à jour automatique possible seulement avec l'application installée"}), 400
        if info["mode"] == "page":
            return jsonify({"error": "Cette version doit être téléchargée depuis sa page"}), 400
        with _lock:
            job = _state["job"]
            if job and not job.get("done"):
                return jsonify(job)
            job = _state["job"] = {"progress": 0, "step": "Préparation…", "done": False, "version": info["latest"], "mode": info["mode"]}
        threading.Thread(target=_apply, args=(info, job), daemon=True).start()
        return jsonify(job)

    @app.route("/api/update/progress")
    def update_progress():
        return jsonify(_state["job"] or {})

    @app.route("/api/update/restart", methods=["POST"])
    def update_restart():
        job = _state["job"] or {}
        if not LAUNCHER:
            return jsonify({"error": "Pas de lanceur"}), 400
        restart(core, installer=job.get("setup"))
        return jsonify({"ok": True})

    @app.route("/api/migrate/detect")
    def migrate_detect():
        return jsonify(_old_installs())

    @app.route("/api/migrate", methods=["POST"])
    def migrate():
        src = Path((request.json or {}).get("path") or "")
        if src.name == "projects":
            src = src.parent
        if not (src / "projects").is_dir():
            return jsonify({"error": "Pas de dossier « projects » ici : choisissez le dossier où se trouvait Photo_chooser.exe"}), 400
        stats = {"copied": 0, "skipped": 0}
        for part in paths.DATA_PARTS:
            if (src / part).is_dir():
                _copy_tree(src / part, paths.DATA_DIR / part, stats)
        n = sum(1 for _ in (src / "projects").glob("*/project.json"))
        return jsonify({"projects": n, **stats})

    @app.route("/api/settings/data-dir", methods=["POST"])
    def set_data_dir():
        """Choose another data folder: what is there now is copied (never deleted), then the app restarts."""
        new = Path((request.json or {}).get("path") or "")
        if not new.is_absolute():
            return jsonify({"error": "Dossier invalide"}), 400
        if not LAUNCHER:
            return jsonify({"error": "Réglage disponible avec l'application installée"}), 400
        new.mkdir(parents=True, exist_ok=True)
        stats = {"copied": 0, "skipped": 0}
        for part in paths.DATA_PARTS:
            if (paths.DATA_DIR / part).is_dir():
                _copy_tree(paths.DATA_DIR / part, new / part, stats)
        paths.save_settings(data_dir=str(new))
        restart(core)
        return jsonify({"ok": True, **stats})

    @app.route("/api/settings/open-data", methods=["POST"])
    def open_data():
        os.startfile(str(paths.DATA_DIR))
        return jsonify({"ok": True})

    # quiet first check in the background, so the page gets an answer at once
    threading.Thread(target=check, daemon=True).start()
