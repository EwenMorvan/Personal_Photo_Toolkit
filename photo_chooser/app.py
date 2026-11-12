from flask import send_from_directory
import os
import re
import struct
import sys
import json
import shutil
import hashlib
import threading
import subprocess
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from functools import wraps
from pathlib import Path
from io import BytesIO

from flask import Flask, jsonify, request, send_file, abort, render_template

from PIL import Image, ImageOps, ExifTags
try:
    import pillow_heif
    pillow_heif.register_heif_opener()
    HEIF_SUPPORT = True
except ImportError:
    HEIF_SUPPORT = False
try:
    from PIL import ImageCms
    _SRGB_PROFILE = ImageCms.createProfile("sRGB")
except Exception:
    ImageCms = None
    _SRGB_PROFILE = None

import grading
import ai_masks
import ai_color
import auto_prefs
import numpy as np

# ── AI ───────────────────────────────────────────────────────────────────────
# Everything runs on ONNX Runtime (ai_masks.py): masks, classification, smart auto.
# No PyTorch: the same features work from the script and from the frozen .exe.

# ── Constants ────────────────────────────────────────────────────────────────
# Code, user data and caches live in separate places (see paths.py): the user's projects
# are in Documents\Photo Studio for the installed app, so updates never touch them.
import paths
_BUNDLE_DIR = paths.CODE_DIR                     # templates / static sit beside the code
if not (_BUNDLE_DIR / "templates").exists() and getattr(sys, "_MEIPASS", None):
    _BUNDLE_DIR = Path(sys._MEIPASS)             # old one-file exe
_RUNTIME_DIR = paths.DATA_DIR
CACHE_DIR = paths.CACHE_DIR

BASE_DIR     = _BUNDLE_DIR
# Built without a console window: there is nowhere to print, so messages go to a log file
if sys.stdout is None or sys.stderr is None:
    _log = open(paths.LOG_FILE, "a", encoding="utf-8", buffering=1)
    sys.stdout = sys.stderr = _log

PROJECTS_DIR = _RUNTIME_DIR / "projects"
THUMB_DIR    = CACHE_DIR / "thumbnails_cache"
LUT_DIR      = _RUNTIME_DIR / "luts"
PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
THUMB_DIR.mkdir(parents=True, exist_ok=True)
LUT_DIR.mkdir(parents=True, exist_ok=True)
MAPS_DIR     = CACHE_DIR / "maps_cache"     # AI masks + blur / haze maps, per photo
PAINT_DIR    = _RUNTIME_DIR / "paint"          # brush masks, per photo & layer
MAPS_DIR.mkdir(parents=True, exist_ok=True)
PAINT_DIR.mkdir(parents=True, exist_ok=True)
# what the Auto has learned from the user's retouches – shared by the script and the .exe
PREFS = auto_prefs.AutoPrefs(
    (_RUNTIME_DIR if os.environ.get("PHOTOCHOOSER_HOME")
     else Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "PhotoChooser") / "auto_prefs.json")

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff", ".tif",
             ".webp", ".heic", ".heif", ".cr2", ".nef", ".arw"}
VIDEO_EXT = {".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm", ".3gp",
             ".mts", ".m2ts", ".wmv"}
SUPPORTED_EXT = IMAGE_EXT | VIDEO_EXT
BROWSER_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}

VIDEO_MIME = {".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/mp4",
              ".webm": "video/webm", ".mkv": "video/webm", ".3gp": "video/3gpp",
              ".avi": "video/x-msvideo", ".wmv": "video/x-ms-wmv",
              ".mts": "video/mp2t", ".m2ts": "video/mp2t"}

FFMPEG  = shutil.which("ffmpeg")
FFPROBE = shutil.which("ffprobe")
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

AI_LABELS = ["landscape", "sea", "mountain", "person", "city", "forest",
             "snow", "sunset", "indoor", "food", "animal", "architecture"]

app = Flask(__name__,
            template_folder=str(_BUNDLE_DIR / "templates"),
            static_folder=str(_BUNDLE_DIR / "static"))

# project.json is read-modify-written by concurrent requests → serialise
_proj_lock = threading.RLock()
# exports run one at a time so a newer edit can never be overwritten by an older one
_export_pool = ThreadPoolExecutor(max_workers=1)

def locked(fn):
    @wraps(fn)
    def wrapper(*a, **kw):
        with _proj_lock:
            return fn(*a, **kw)
    return wrapper

# ── Helpers ──────────────────────────────────────────────────────────────────

def photo_id(path: str) -> str:
    return hashlib.md5(path.encode()).hexdigest()

def project_path(name: str) -> Path:
    return PROJECTS_DIR / name

def project_json(name: str) -> Path:
    return project_path(name) / "project.json"

def sorted_dir(name: str) -> Path:
    return project_path(name) / f"{name}_photos_sorted"

def load_project(name: str) -> dict | None:
    p = project_json(name)
    if not p.exists():
        return None
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)

def save_project(data: dict):
    p = project_json(data["name"])
    tmp = p.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, p)

def find_photo(data: dict, pid: str) -> dict | None:
    for p in data.get("photos", []):
        if p["id"] == pid:
            return p
    return None

def is_video(p: dict) -> bool:
    return p.get("type") == "video"

def get_exif(img: Image.Image) -> dict:
    exif_data = {}
    try:
        raw = img._getexif()
        if not raw:
            return exif_data
        named = {ExifTags.TAGS.get(k, k): v for k, v in raw.items()}

        # Date
        for field in ("DateTimeOriginal", "DateTimeDigitized", "DateTime"):
            if field in named:
                try:
                    exif_data["date"] = datetime.strptime(
                        named[field], "%Y:%m:%d %H:%M:%S"
                    ).isoformat()
                    break
                except Exception:
                    pass

        # GPS
        gps_info = named.get("GPSInfo")
        if gps_info:
            def dms_to_dd(dms, ref):
                try:
                    d, m, s = [float(x) if not hasattr(x, 'numerator')
                                else x.numerator / x.denominator for x in dms]
                    dd = d + m / 60 + s / 3600
                    if ref in ("S", "W"):
                        dd = -dd
                    return round(dd, 6)
                except Exception:
                    return None

            gps_tags = {ExifTags.GPSTAGS.get(k, k): v for k, v in gps_info.items()}
            lat = dms_to_dd(gps_tags.get("GPSLatitude", []), gps_tags.get("GPSLatitudeRef", "N"))
            lon = dms_to_dd(gps_tags.get("GPSLongitude", []), gps_tags.get("GPSLongitudeRef", "E"))
            if lat is not None and lon is not None:
                exif_data["lat"] = lat
                exif_data["lon"] = lon
    except Exception:
        pass
    return exif_data

def date_from_filename(filename: str) -> str | None:
    patterns = [
        r"(\d{4})[_\-](\d{2})[_\-](\d{2})[_\-\s](\d{2})[_\-\:\.](\d{2})[_\-\:\.](\d{2})",
        r"(\d{4})[_\-](\d{2})[_\-](\d{2})",
        r"(\d{8})_(\d{6})",
        r"(\d{8})",
    ]
    for pat in patterns:
        m = re.search(pat, filename)
        if m:
            g = m.groups()
            try:
                if len(g) == 6:
                    return datetime(*map(int, g)).isoformat()
                elif len(g) == 3:
                    return datetime(int(g[0]), int(g[1]), int(g[2])).isoformat()
                elif len(g) == 2:
                    s = g[0] + g[1]
                    return datetime(int(s[:4]), int(s[4:6]), int(s[6:8]),
                                    int(s[8:10]), int(s[10:12]), int(s[12:14])).isoformat()
                elif len(g) == 1:
                    s = g[0]
                    return datetime(int(s[:4]), int(s[4:6]), int(s[6:8])).isoformat()
            except Exception:
                pass
    return None

def probe_video(filepath: str) -> dict:
    """Width/height/duration/creation date via ffprobe (if installed)."""
    out = {}
    if not FFPROBE:
        return out
    try:
        res = subprocess.run(
            [FFPROBE, "-v", "quiet", "-print_format", "json",
             "-show_format", "-show_streams", filepath],
            capture_output=True, timeout=15, creationflags=_NO_WINDOW)
        info = json.loads(res.stdout or b"{}")
        fmt = info.get("format", {})
        if fmt.get("duration"):
            out["duration"] = round(float(fmt["duration"]), 2)
        vs = next((s for s in info.get("streams", []) if s.get("codec_type") == "video"), None)
        if vs:
            w, h = int(vs.get("width", 0)), int(vs.get("height", 0))
            rot = 0
            try:
                rot = int(vs.get("tags", {}).get("rotate", 0))
            except ValueError:
                pass
            for sd in vs.get("side_data_list", []) or []:
                if "rotation" in sd:
                    rot = int(sd["rotation"])
            if abs(rot) % 180 == 90:
                w, h = h, w
            out["width"], out["height"] = w, h
            out["codec"] = vs.get("codec_name")
        ct = fmt.get("tags", {}).get("creation_time")
        if ct:
            dt = datetime.fromisoformat(ct.replace("Z", "+00:00"))
            if dt.tzinfo:
                dt = dt.astimezone().replace(tzinfo=None)
            if dt.year > 1971:
                out["date"] = dt.replace(microsecond=0).isoformat()
    except Exception:
        pass
    return out

def scan_file(filepath: str) -> dict | None:
    ext = Path(filepath).suffix.lower()
    if ext not in SUPPORTED_EXT:
        return None
    info = {
        "id":            photo_id(filepath),
        "path":          filepath,
        "filename":      Path(filepath).name,
        "type":          "video" if ext in VIDEO_EXT else "photo",
        "date":          None,
        "lat":           None,
        "lon":           None,
        "width":         0,
        "height":        0,
        "category":      None,
        "liked":         False,
    }
    if info["type"] == "video":
        v = probe_video(filepath)
        info["width"]    = v.get("width", 0)
        info["height"]   = v.get("height", 0)
        info["duration"] = v.get("duration")
        info["date"]     = v.get("date")
    else:
        try:
            with Image.open(filepath) as img:
                info["width"], info["height"] = img.size
                exif = get_exif(img)
                info["date"] = exif.get("date")
                info["lat"]  = exif.get("lat")
                info["lon"]  = exif.get("lon")
                orient = img.getexif().get(0x0112, 1)
                if orient in (5, 6, 7, 8):
                    info["width"], info["height"] = info["height"], info["width"]
        except Exception:
            pass

    if not info["date"]:
        info["date"] = date_from_filename(Path(filepath).name)
    if not info["date"]:
        try:
            mtime = os.path.getmtime(filepath)
            info["date"] = datetime.fromtimestamp(mtime).isoformat()
        except Exception:
            pass
    return info

def classify_photo(filepath: str) -> str | None:
    if not ai_masks.available():
        return None
    try:
        return ai_masks.classify(open_image(filepath, 768))
    except Exception as e:
        print(f"[AI] classification {filepath}: {e}")
        return None

# ── Image loading / rendering ────────────────────────────────────────────────

def open_image(path: str, max_size: int | None = None) -> Image.Image:
    """Open any supported image as upright 8-bit sRGB RGB."""
    img = Image.open(path)
    if max_size and img.format == "JPEG":
        img.draft("RGB", (max_size, max_size))    # fast DCT downscale
    img = ImageOps.exif_transpose(img)
    icc = img.info.get("icc_profile")
    if img.mode != "RGB":
        if img.mode in ("RGBA", "LA", "PA") or (img.mode == "P" and "transparency" in img.info):
            rgba = img.convert("RGBA")
            bg = Image.new("RGB", rgba.size, (255, 255, 255))
            bg.paste(rgba, mask=rgba.split()[3])
            img = bg
        else:
            img = img.convert("RGB")
    if icc and ImageCms is not None:
        try:
            src = ImageCms.ImageCmsProfile(BytesIO(icc))
            if "srgb" not in ImageCms.getProfileDescription(src).lower():
                img = ImageCms.profileToProfile(img, src, _SRGB_PROFILE, outputMode="RGB")
        except Exception:
            pass
    img.info.pop("icc_profile", None)
    return img

def edits_key(edits) -> str:
    if grading.edits_are_identity(edits):
        return "none"
    e = grading.normalize_edits(edits)
    lut = e["grade"].get("lut")
    if lut and (LUT_DIR / lut).exists():
        e["_lut_mtime"] = (LUT_DIR / lut).stat().st_mtime
    if any(l["mask"] != "brush" for l in e["grade"]["locals"]):
        e["_ai"] = ai_masks.available()      # rendered without masks until the models are there
    return hashlib.md5(json.dumps(e, sort_keys=True).encode()).hexdigest()[:16]

_maps_lock = threading.Lock()

def paint_path(pid: str, layer_id: str) -> Path:
    safe = "".join(ch for ch in str(layer_id) if ch.isalnum() or ch in "_-")[:40]
    return PAINT_DIR / f"{pid}_{safe}.png"

class PhotoMaps:
    """Per-photo maps in the upright source frame (cached on disk):
    blur / haze maps, AI masks and brush paint. See grading.apply_grade_image."""

    def __init__(self, p: dict):
        self.p = p
        try:
            st = os.stat(p["path"])
            sig = f"{p['path']}|{st.st_mtime}|{st.st_size}"
        except OSError:
            sig = p["path"]
        self.key = hashlib.md5(("v1|" + sig).encode()).hexdigest()
        self._img = None

    def _image(self) -> Image.Image:
        if self._img is None:
            self._img = open_image(self.p["path"], 2048)
        return self._img

    def aux(self):
        f = MAPS_DIR / f"{self.key}_aux.npz"
        with _maps_lock:
            if f.exists():
                d = np.load(f)
                return d["aux"], d["air"].tolist()
            aux, air = ai_masks.compute_aux(self._image())
            np.savez_compressed(f, aux=aux, air=np.array(air, np.float32))
            return aux, air

    def masks(self):
        f = MAPS_DIR / f"{self.key}_ai.npz"
        with _maps_lock:
            if f.exists():
                return np.load(f)["stack"]
            if not ai_masks.available():
                return None
            try:
                stack = ai_masks.compute_masks(self._image())
            except Exception as e:
                print(f"[AI] {self.p['path']}: {e}")
                return None
            np.savez_compressed(f, stack=stack)
            return stack

    def ailut(self):
        """Per-photo LUT predicted by the colour model (see ai_color.py)."""
        if not ai_color.available():
            return None
        f = MAPS_DIR / f"{self.key}_ailut.npy"
        with _maps_lock:
            if f.exists():
                return np.load(f)
            try:
                lut = ai_color.predict_lut(self._image())
            except Exception as e:
                print(f"[AI colour] {self.p['path']}: {e}")
                return None
            np.save(f, lut)
            return lut

    def paint(self, layer: dict):
        f = paint_path(self.p["id"], layer.get("id", ""))
        if not f.exists():
            return None
        try:
            with Image.open(f) as im:
                return np.asarray(im.convert("RGB"))[..., :2]
        except Exception:
            return None

def render_photo(p: dict, max_size: int | None, raw: bool = False) -> Image.Image:
    edits = None if raw else p.get("edits")
    load_size = None
    if max_size:
        frac = (grading.crop_fraction(grading.normalize_edits(edits)["geo"],
                                      p.get("width") or 1, p.get("height") or 1) if edits else 1)
        # load enough pixels so the cropped result still reaches max_size
        load_size = int(max_size / frac) + 1
    img = open_image(p["path"], load_size)
    if max_size and max(img.size) > load_size:
        img.thumbnail((load_size, load_size), Image.Resampling.LANCZOS)
    if raw or grading.edits_are_identity(edits):
        if max_size and max(img.size) > max_size:
            img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
        return img
    return grading.render(img, edits, max_size, LUT_DIR, PhotoMaps(p))

def cached_render(p: dict, max_size: int, raw: bool = False, quality: int = 90) -> Path | None:
    key = "raw" if raw else edits_key(p.get("edits"))
    tid = hashlib.md5(f"v3|{p['path']}|{max_size}|{key}".encode()).hexdigest()
    out = THUMB_DIR / f"{tid}.jpg"
    if out.exists():
        return out
    try:
        img = render_photo(p, max_size, raw)
        tmp = out.with_suffix(".tmp")
        img.save(tmp, "JPEG", quality=quality)
        os.replace(tmp, out)
    except Exception as e:
        print(f"[render] {p['path']}: {e}")
        return None
    return out

def video_thumbnail(p: dict, size: int = 400) -> Path | None:
    tid = hashlib.md5(f"v2|video|{p['path']}|{size}".encode()).hexdigest()
    out = THUMB_DIR / f"{tid}.jpg"
    if out.exists():
        return out
    if not FFMPEG:
        return None
    dur = p.get("duration") or 0
    for ss in ([min(1.0, dur / 3)] if dur else [1.0]) + [0]:
        try:
            subprocess.run(
                [FFMPEG, "-y", "-v", "error", "-ss", f"{ss:.2f}", "-i", p["path"],
                 "-frames:v", "1", "-vf", f"scale='min({size},iw)':-2", str(out)],
                capture_output=True, timeout=30, creationflags=_NO_WINDOW)
            if out.exists() and out.stat().st_size > 0:
                return out
        except Exception:
            pass
    return None

# ── Export of liked items to the "sorted" folder ─────────────────────────────

def export_filename(p: dict) -> str:
    src = Path(p["path"])
    if not is_video(p) and not grading.edits_are_identity(p.get("edits")):
        return src.stem + ".jpg"
    return src.name

MEDIA_RE = re.compile(r"^(.*?)(_\d+)?(\.[A-Za-z0-9]+)$")

def sync_sorted(pname: str, data: dict) -> list:
    """Make the sorted folder mirror exactly the liked items: one file per liked item,
    named after its source (edited photos → .jpg render, otherwise a copy of the original).
    Updates export_name on the entries (caller saves) and returns the ids to (re)export."""
    dst_dir = sorted_dir(pname)
    dst_dir.mkdir(parents=True, exist_ok=True)
    used, todo = set(), []
    for p in data.get("photos", []):
        if not p.get("liked"):
            p.pop("export_name", None)
            p.pop("export_key", None)
            continue
        base = export_filename(p)
        stem, suffix = Path(base).stem, Path(base).suffix
        name, i = base, 1
        while name.lower() in used:            # same file name from two source folders
            name = f"{stem}_{i}{suffix}"
            i += 1
        used.add(name.lower())
        key = edits_key(p.get("edits"))
        # entries liked before export tracking existed hold a plain copy of the original
        stale = p.get("export_key", "none") != key
        if p.get("export_name") != name or stale or not (dst_dir / name).exists():
            todo.append(p["id"])
        p["export_name"] = name

    # Drop files that no longer match a liked item (old names, "_1" duplicates, unliked…).
    # Only files derived from this project's sources are touched.
    stems = {Path(x).stem.lower() for x in
             [q["path"] for q in data.get("photos", [])] + list(data.get("excluded", []))}
    for f in dst_dir.iterdir():
        if not f.is_file() or f.name.lower() in used or f.suffix.lower() not in SUPPORTED_EXT:
            continue
        m = MEDIA_RE.match(f.name)
        if f.stem.lower() in stems or (m and m.group(1).lower() in stems):
            try:
                f.unlink()
            except Exception as e:
                print(f"[sorted] {f.name}: {e}")
    return todo

def save_and_sync(pname: str, data: dict) -> dict:
    """Save the project, then bring the sorted folder in line (exports run in background).
    Returns how many files are being (re)written and which sources are unreachable."""
    todo = sync_sorted(pname, data)
    save_project(data)
    missing = []
    for pid in todo:
        p = find_photo(data, pid)
        if not os.path.exists(p["path"]):
            missing.append(p["filename"])        # e.g. external drive not plugged in
            continue
        _export_pool.submit(_export_job, pname, pid)
    return {"rewritten": len(todo) - len(missing), "missing": missing}

def _export_job(pname: str, pid: str):
    with _proj_lock:
        data = load_project(pname)
        p = find_photo(data, pid) if data else None
        if not p or not p.get("liked") or not p.get("export_name"):
            return
        p = dict(p)
    key = edits_key(p.get("edits"))
    dst = sorted_dir(pname) / p["export_name"]
    tmp = dst.with_name(dst.name + ".part")
    try:
        if is_video(p) or key == "none":
            shutil.copy2(p["path"], tmp)          # not edited → the original file
        else:
            with Image.open(p["path"]) as src:
                exif = src.getexif()
            exif[0x0112] = 1                      # pixels are now upright
            img = grading.render(open_image(p["path"]), p.get("edits"), None, LUT_DIR, PhotoMaps(p))
            img.save(tmp, "JPEG", quality=95, subsampling=0, exif=exif.tobytes())
            st = os.stat(p["path"])
            os.utime(tmp, (st.st_atime, st.st_mtime))
        os.replace(tmp, dst)
    except Exception as e:
        print(f"[export] {p['path']}: {e}")
        tmp.unlink(missing_ok=True)
        return
    with _proj_lock:
        data = load_project(pname)
        cur = find_photo(data, pid) if data else None
        if not cur or not cur.get("liked") or cur.get("export_name") != dst.name:
            dst.unlink(missing_ok=True)           # unliked / renamed while we were working
            return
        cur["export_key"] = key
        save_project(data)

# ── API Routes ────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")

# -- Projects -----------------------------------------------------------------

@app.route("/api/projects", methods=["GET"])
def list_projects():
    projects = []
    if PROJECTS_DIR.exists():
        for d in PROJECTS_DIR.iterdir():
            if d.is_dir() and (d / "project.json").exists():
                with open(d / "project.json", encoding="utf-8") as f:
                    data = json.load(f)
                photos = data.get("photos", [])
                stills = [p for p in photos if not is_video(p)]
                liked = [p for p in stills if p.get("liked")]
                pool = liked if len(liked) >= 3 else stills
                # 3 covers spread over the project (liked ones first)
                picks = [pool[i] for i in sorted({0, len(pool) // 2, len(pool) - 1})] if pool else []
                dates = sorted(p["date"] for p in photos if p.get("date"))
                projects.append({
                    "name":        data["name"],
                    "created":     data.get("created"),
                    "photo_count": len(photos),
                    "liked_count": sum(1 for p in photos if p.get("liked")),
                    "video_count": len(photos) - len(stills),
                    "date_min":    dates[0] if dates else None,
                    "date_max":    dates[-1] if dates else None,
                    "covers":      [{"id": p["id"], "rev": p.get("rev", 0)} for p in picks],
                })
    return jsonify(projects)

@app.route("/api/projects", methods=["POST"])
@locked
def create_project():
    body = request.json or {}
    name = (body.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Name required"}), 400
    safe = "".join(c for c in name if c.isalnum() or c in " _-").strip().replace(" ", "_")
    if not safe:
        return jsonify({"error": "Invalid name"}), 400
    pp = project_path(safe)
    if pp.exists():
        return jsonify({"error": "Project already exists"}), 409
    pp.mkdir(parents=True)
    data = {"name": safe, "created": datetime.now().isoformat(), "sources": [],
            "photos": [], "excluded": []}
    save_project(data)
    return jsonify(data), 201

@app.route("/api/projects/<name>", methods=["GET"])
def get_project(name):
    data = load_project(name)
    if not data:
        return jsonify({"error": "Not found"}), 404
    return jsonify(data)

@app.route("/api/projects/<name>/sync-sorted", methods=["POST"])
@locked
def sync_sorted_route(name):
    """Repair the sorted folder so it mirrors exactly the liked items."""
    data = load_project(name)
    if not data:
        return jsonify({"error": "Not found"}), 404
    return jsonify(save_and_sync(name, data))

@app.route("/api/projects/<name>/open-sorted", methods=["POST"])
def open_sorted_folder(name):
    data = load_project(name)
    if not data:
        return jsonify({"error": "Not found"}), 404
    folder = sorted_dir(name)
    folder.mkdir(parents=True, exist_ok=True)
    try:
        os.startfile(folder)  # Windows: open in Explorer
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    return jsonify({"path": str(folder)})

# -- Browse dialog ------------------------------------------------------------

def _tk_root():
    import tkinter as tk
    root = tk.Tk(); root.withdraw(); root.lift(); root.attributes("-topmost", True)
    return root

@app.route("/api/browse/folder", methods=["GET"])
def browse_folder():
    try:
        from tkinter import filedialog
        root = _tk_root()
        folder = filedialog.askdirectory(title="Sélectionner un dossier de photos / vidéos")
        root.destroy()
        return jsonify({"path": folder or ""})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/browse/files", methods=["GET"])
def browse_files():
    try:
        from tkinter import filedialog
        root = _tk_root()
        img_pat = " ".join(f"*{e}" for e in sorted(IMAGE_EXT))
        vid_pat = " ".join(f"*{e}" for e in sorted(VIDEO_EXT))
        files = filedialog.askopenfilenames(
            title="Sélectionner des photos / vidéos",
            filetypes=[("Photos et vidéos", f"{img_pat} {vid_pat}"),
                       ("Images", img_pat), ("Vidéos", vid_pat), ("Tous", "*.*")]
        )
        root.destroy()
        return jsonify({"paths": list(files)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# -- Add sources & scan -------------------------------------------------------

@app.route("/api/projects/<name>/scan", methods=["POST"])
@locked
def scan_sources(name):
    data = load_project(name)
    if not data:
        return jsonify({"error": "Not found"}), 404

    body = request.json or {}
    new_sources = body.get("sources", [])   # list of paths (files or folders)

    existing_paths = {p["path"] for p in data.get("photos", [])}
    excluded = set(data.get("excluded", []))
    new_photos = []

    for src in new_sources:
        src = src.strip()
        if not src or not os.path.exists(src):
            continue
        if src not in data["sources"]:
            data["sources"].append(src)

        if os.path.isdir(src):
            for root_dir, _, files in os.walk(src):
                for fname in files:
                    fpath = os.path.join(root_dir, fname)
                    # items removed from the project stay out when re-scanning a folder
                    if fpath not in existing_paths and fpath not in excluded:
                        info = scan_file(fpath)
                        if info:
                            new_photos.append(info)
                            existing_paths.add(fpath)
        elif os.path.isfile(src):
            excluded.discard(src)   # explicitly picked file → bring it back
            if src not in existing_paths:
                info = scan_file(src)
                if info:
                    new_photos.append(info)
                    existing_paths.add(src)

    # Restore liked state for newly added items already present in the sorted folder
    liked_dir = sorted_dir(name)
    if liked_dir.exists() and new_photos:
        liked_set = {f.name for f in liked_dir.iterdir()}
        for p in new_photos:
            if p["filename"] in liked_set:
                p["liked"] = True
                p["export_name"] = p["filename"]

    # Sort all photos by date
    all_photos = data.get("photos", []) + new_photos
    all_photos.sort(key=lambda p: p.get("date") or "9999")

    data["photos"] = all_photos
    data["excluded"] = sorted(excluded)
    save_and_sync(name, data)

    return jsonify({
        "added":  len(new_photos),
        "total":  len(all_photos),
    })

# -- Remove from project (never touches the original files) -------------------

@app.route("/api/projects/<name>/photos/remove", methods=["POST"])
@locked
def remove_photos(name):
    data = load_project(name)
    if not data:
        return jsonify({"error": "Not found"}), 404
    ids = set((request.json or {}).get("ids", []))
    keep, removed = [], []
    for p in data["photos"]:
        (removed if p["id"] in ids else keep).append(p)
    excluded = set(data.get("excluded", []))
    for p in removed:
        if p.get("liked"):               # its copy leaves the sorted folder (sync below)
            p["liked"] = False
            p["_was_liked"] = True
        p.pop("export_name", None)
        p.pop("export_key", None)
        excluded.add(p["path"])
    data["photos"] = keep
    data["excluded"] = sorted(excluded)
    save_and_sync(name, data)
    return jsonify({"removed": removed, "total": len(keep)})

@app.route("/api/projects/<name>/photos/restore", methods=["POST"])
@locked
def restore_photos(name):
    data = load_project(name)
    if not data:
        return jsonify({"error": "Not found"}), 404
    entries = (request.json or {}).get("photos", [])
    have = {p["id"] for p in data["photos"]}
    excluded = set(data.get("excluded", []))
    restored = []
    for p in entries:
        if not isinstance(p, dict) or p.get("id") in have or "path" not in p:
            continue
        p = dict(p)
        excluded.discard(p["path"])
        if p.pop("_was_liked", False):
            p["liked"] = True
        data["photos"].append(p)
        restored.append(p)
    data["photos"].sort(key=lambda p: p.get("date") or "9999")
    data["excluded"] = sorted(excluded)
    save_and_sync(name, data)
    return jsonify({"restored": len(restored), "total": len(data["photos"])})

# -- AI classify all ----------------------------------------------------------

@app.route("/api/projects/<name>/classify", methods=["POST"])
def classify_all(name):
    if not ai_masks.available():
        return jsonify({"error": "Modèles IA non installés : ouvrez une photo › Retoucher › Pro › Zones (IA) pour les télécharger"}), 503
    data = load_project(name)
    if not data:
        return jsonify({"error": "Not found"}), 404
    results = {}
    for p in data["photos"]:
        if not p.get("category") and not is_video(p):
            cat = classify_photo(p["path"])
            if cat:
                results[p["id"]] = cat
    with _proj_lock:
        data = load_project(name)
        for p in data["photos"]:
            if p["id"] in results:
                p["category"] = results[p["id"]]
        save_project(data)
    return jsonify({"classified": len(results)})

# -- Photos list (with optional filters) --------------------------------------

@app.route("/api/projects/<name>/photos", methods=["GET"])
def list_photos(name):
    data = load_project(name)
    if not data:
        return jsonify({"error": "Not found"}), 404

    photos = data.get("photos", [])

    # filters
    date_from = request.args.get("date_from")
    date_to   = request.args.get("date_to")
    category  = request.args.get("category")
    liked_only = request.args.get("liked") == "1"
    has_gps   = request.args.get("has_gps") == "1"
    media     = request.args.get("media")      # "photo" | "video"

    if date_from:
        photos = [p for p in photos if p.get("date") and p["date"] >= date_from]
    if date_to:
        photos = [p for p in photos if p.get("date") and p["date"] <= date_to + "T23:59:59"]
    if category:
        photos = [p for p in photos if p.get("category") == category]
    if liked_only:
        photos = [p for p in photos if p.get("liked")]
    if has_gps:
        photos = [p for p in photos if p.get("lat") is not None]
    if media in ("photo", "video"):
        photos = [p for p in photos if (p.get("type") or "photo") == media]

    return jsonify(photos)

# -- Like / unlike ------------------------------------------------------------

@app.route("/api/projects/<name>/photos/<pid>/like", methods=["POST"])
@locked
def like_photo(name, pid):
    data = load_project(name)
    if not data:
        return jsonify({"error": "Not found"}), 404
    p = find_photo(data, pid)
    if not p:
        return jsonify({"error": "Photo not found"}), 404
    if not os.path.exists(p["path"]):
        return jsonify({"error": "Fichier source introuvable"}), 404
    p["liked"] = True
    save_and_sync(name, data)
    return jsonify({"liked": True})

@app.route("/api/projects/<name>/photos/<pid>/like", methods=["DELETE"])
@locked
def unlike_photo(name, pid):
    data = load_project(name)
    if not data:
        return jsonify({"error": "Not found"}), 404
    p = find_photo(data, pid)
    if not p:
        return jsonify({"error": "Photo not found"}), 404
    p["liked"] = False
    save_and_sync(name, data)
    return jsonify({"liked": False})

# -- Edits (crop / grade) -----------------------------------------------------

def _set_edits(name: str, p: dict, edits):
    if grading.edits_are_identity(edits):
        p.pop("edits", None)
    else:
        p["edits"] = edits
    p["rev"] = int(p.get("rev", 0)) + 1

@app.route("/api/projects/<name>/photos/<pid>/edits", methods=["PUT"])
@locked
def save_edits(name, pid):
    data = load_project(name)
    if not data:
        return jsonify({"error": "Not found"}), 404
    p = find_photo(data, pid)
    if not p or is_video(p):
        return jsonify({"error": "Photo not found"}), 404
    _set_edits(name, p, (request.json or {}).get("edits"))
    save_and_sync(name, data)      # liked → re-render, or back to the original if reset
    try:
        _learn_from(p)
    except Exception as e:
        print(f"[prefs] {e}")
    return jsonify({"rev": p["rev"], "edits": p.get("edits")})

def _portable_grade(grade):
    """A grade that can be applied to another photo: AI layers follow that photo's own
    masks, but brush paint is specific to the photo it was painted on."""
    if not grade:
        return grade
    g = json.loads(json.dumps(grade))
    g.pop("auto_ref", None)          # belongs to the photo it was computed for
    locs = []
    for l in g.get("locals") or []:
        if l.get("mask", "brush") == "brush":
            continue
        l["paint"] = None
        locs.append(l)
    g["locals"] = locs
    return g

def _merge_auto(grade: dict, auto: dict) -> dict:
    """Merge a smart-auto result: its zones replace the previous auto zones,
    layers created by the user are kept."""
    auto = dict(auto)
    new_locals = auto.pop("locals", [])
    keep = [l for l in grade.get("locals") or [] if not l.get("auto")]
    grade.pop("auto_ref", None)
    grading._merge(grade, auto)
    grade["locals"] = (keep + new_locals)[:grading.MAX_LOCALS]
    return grade

RAW_EXT = {".cr2", ".nef", ".arw", ".dng", ".raf", ".orf", ".rw2"}

def _smart_auto(p: dict) -> dict:
    """One-click enhancement: rule-based analysis + per-zone treatment (grading.smart_auto).
    The learned colour model ("Couleur IA") is NOT part of it: on real photos the result
    was judged less pleasing, so it stays an optional manual slider (grade["ai"])."""
    maps = PhotoMaps(p)
    aux, air = maps.aux()
    g = grading.smart_auto(open_image(p["path"], 1024), maps.masks(), aux, air)
    g["ai"] = 0.0
    return _personalise(p, g)

def _personalise(p: dict, g: dict, learn: bool = True) -> dict:
    """Add what was learned from the user's past retouches of similar photos, and
    remember the solver's own proposal (auto_ref) so a later retouch can be learned."""
    info = g.pop("auto_info", {})
    cov = info.pop("cov", {})
    full = grading._merge(grading.default_grade(), json.loads(json.dumps(g)))
    full["locals"] = [grading._merge(grading.default_local(), l) for l in full["locals"]]
    ref = {"v": auto_prefs.grade_vector(full), "f": info, "scene": g.get("scene")}
    n = 0.0
    if learn:
        delta, n = PREFS.predict(info, g.get("scene"), exclude=p["id"])
        if delta:
            auto_prefs.apply_delta(full, delta, lambda m: grading._auto_layer(m), cov)
            g["locals"] = [l for l in full["locals"] if grading.local_effective(l)][:grading.MAX_LOCALS]
    for k in auto_prefs.SCALARS:         # the Auto owns all of these (exposure and sat included)
        g[k] = full[k]
    for w in auto_prefs.WHEELS:
        g[w]["m"] = full[w]["m"]
    ref["o"] = auto_prefs.grade_vector(full)     # what was actually proposed (solver + learned)
    g["auto_ref"] = ref
    g["learned"] = round(n, 1)
    return g

def _learn_from(p: dict):
    """Called when the editor saves: how did the user finish what the Auto proposed?"""
    edits = p.get("edits")
    grade = (edits or {}).get("grade") or {}
    ref = grade.get("auto_ref")
    if not ref:
        PREFS.forget(p["id"])
        return
    if grade.get("look"):            # a style changes many values at once: not a correction
        return
    PREFS.record(p["id"], ref, auto_prefs.grade_vector(grading.normalize_edits(edits)["grade"]))

@app.route("/api/projects/<name>/edits/batch", methods=["POST"])
@locked
def batch_edits(name):
    """Apply a grade (and optionally geometry) to several photos.
    body: {ids, grade: {...}|null, geo: {...}|null, keep_geo: bool}"""
    data = load_project(name)
    if not data:
        return jsonify({"error": "Not found"}), 404
    body = request.json or {}
    ids = set(body.get("ids", []))
    out = {}
    for p in data["photos"]:
        if p["id"] not in ids or is_video(p):
            continue
        cur = p.get("edits") or {}
        new = {"grade": _portable_grade(body.get("grade")), "geo": cur.get("geo")}
        if not body.get("keep_geo", True):
            new["geo"] = body.get("geo")
        _set_edits(name, p, {k: v for k, v in new.items() if v})
        out[p["id"]] = {"rev": p["rev"], "edits": p.get("edits")}
    save_and_sync(name, data)
    return jsonify(out)

@app.route("/api/projects/<name>/auto-grade", methods=["POST"])
def auto_grade_route(name):
    """Compute an automatic balance. apply=true merges it into each photo's grade."""
    data = load_project(name)
    if not data:
        return jsonify({"error": "Not found"}), 404
    body = request.json or {}
    ids = body.get("ids", [])
    results = {}
    for p in data["photos"]:
        if p["id"] in ids and not is_video(p):
            try:
                results[p["id"]] = _smart_auto(p)
            except Exception as e:
                print(f"[auto] {p['path']}: {e}")
    if not body.get("apply"):
        return jsonify(results)
    out = {}
    with _proj_lock:
        data = load_project(name)
        for p in data["photos"]:
            if p["id"] in results:
                e = grading.normalize_edits(p.get("edits"))
                _merge_auto(e["grade"], results[p["id"]])
                _set_edits(name, p, e)
                out[p["id"]] = {"rev": p["rev"], "edits": p.get("edits")}
        save_and_sync(name, data)
    return jsonify(out)

@app.route("/api/projects/<name>/photos/<pid>/open-external", methods=["POST"])
def open_external(name, pid):
    data = load_project(name)
    p = find_photo(data, pid) if data else None
    if not p:
        return jsonify({"error": "Not found"}), 404
    try:
        os.startfile(p["path"])
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    return jsonify({"ok": True})

# -- Serve images / videos ----------------------------------------------------

def _photo_from_request(pid):
    pname = request.args.get("project")
    if not pname:
        abort(404)
    data = load_project(pname)
    if not data:
        abort(404)
    p = find_photo(data, pid)
    if not p or not os.path.exists(p["path"]):
        abort(404)
    return p

@app.route("/api/thumb/<pid>")
def serve_thumb(pid):
    p = _photo_from_request(pid)
    thumb = video_thumbnail(p) if is_video(p) else cached_render(p, 400, quality=85)
    if thumb and thumb.exists():
        resp = send_file(str(thumb), mimetype="image/jpeg")
        resp.headers["Cache-Control"] = "max-age=86400"   # URL carries ?v=rev
        return resp
    abort(404)

@app.route("/api/render/<pid>")
def serve_render(pid):
    """Rendered photo. max=0 → full resolution. raw=1 → ignore edits (editor source)."""
    p = _photo_from_request(pid)
    if is_video(p):
        abort(404)
    max_size = int(request.args.get("max", 2560))
    raw = request.args.get("raw") == "1"
    ext = Path(p["path"]).suffix.lower()
    if max_size == 0 and (raw or grading.edits_are_identity(p.get("edits"))) \
            and ext in BROWSER_IMAGE_EXT:
        return send_file(p["path"])                    # original, untouched
    out = cached_render(p, max_size or 100000, raw, quality=92)
    if not out:
        abort(500)
    resp = send_file(str(out), mimetype="image/jpeg")
    resp.headers["Cache-Control"] = "max-age=86400"
    return resp

@app.route("/api/photo/<pid>")
def serve_photo(pid):
    # Kept for backward compatibility: full-resolution, un-edited
    p = _photo_from_request(pid)
    ext = Path(p["path"]).suffix.lower()
    if ext in BROWSER_IMAGE_EXT:
        return send_file(p["path"])
    out = cached_render(p, 100000, raw=True, quality=92)
    if not out:
        abort(500)
    return send_file(str(out), mimetype="image/jpeg")

@app.route("/api/video/<pid>")
def serve_video(pid):
    p = _photo_from_request(pid)
    ext = Path(p["path"]).suffix.lower()
    return send_file(p["path"], mimetype=VIDEO_MIME.get(ext, "video/mp4"), conditional=True)

# -- Maps (AI masks, blur / haze) & brush paint -------------------------------

@app.route("/api/maps/<pid>")
def serve_maps(pid):
    """Binary bundle for the editor:
    [uint32 json length][json][aux (h*w*2)][masks A (h*w*4)][masks B (h*w*4)]
    ai=1 also computes / returns the AI masks (needs the models)."""
    p = _photo_from_request(pid)
    maps = PhotoMaps(p)
    aux, air = maps.aux()
    meta = {"aux": [aux.shape[1], aux.shape[0]], "air": air, "masks": None,
            "coverage": {}, "names": grading.MASK_NAMES, "ai": ai_masks.available()}
    blobs = [aux.tobytes()]
    if request.args.get("ai") == "1":
        stack = maps.masks()
        if stack is not None:
            meta["masks"] = [stack.shape[1], stack.shape[0]]
            meta["coverage"] = ai_masks.coverage(stack)
            blobs += [np.ascontiguousarray(stack[..., :4]).tobytes(),
                      np.ascontiguousarray(stack[..., 4:]).tobytes()]
    head = json.dumps(meta).encode()
    resp = app.response_class(struct.pack("<I", len(head)) + head + b"".join(blobs),
                              mimetype="application/octet-stream")
    resp.headers["Cache-Control"] = "no-store"
    return resp

@app.route("/api/ailut/<pid>")
def serve_ailut(pid):
    """Raw float32 LUT (33^3 * 3, red fastest) predicted for this photo."""
    lut = PhotoMaps(_photo_from_request(pid)).ailut()
    if lut is None:
        abort(404)
    resp = app.response_class(np.ascontiguousarray(lut, np.float32).tobytes(), mimetype="application/octet-stream")
    resp.headers["X-Lut-Size"] = str(lut.shape[0])
    resp.headers["Cache-Control"] = "no-store"
    return resp

@app.route("/api/paint/<pid>/<layer_id>", methods=["GET"])
def get_paint(pid, layer_id):
    f = paint_path(pid, layer_id)
    if not f.exists():
        abort(404)
    with Image.open(f) as im:
        a = np.asarray(im.convert("RGB"))[..., :2]
    resp = app.response_class(np.ascontiguousarray(a).tobytes(), mimetype="application/octet-stream")
    resp.headers["X-Paint-Size"] = f"{a.shape[1]},{a.shape[0]}"
    resp.headers["Cache-Control"] = "no-store"
    return resp

@app.route("/api/paint/<pid>/<layer_id>", methods=["PUT"])
def put_paint(pid, layer_id):
    """body: raw bytes (h*w*2: add, erase), ?w=&h="""
    w, h = int(request.args["w"]), int(request.args["h"])
    data = request.get_data()
    if len(data) != w * h * 2 or w * h > 4_000_000:
        return jsonify({"error": "bad size"}), 400
    a = np.frombuffer(data, np.uint8).reshape(h, w, 2)
    rgb = np.dstack([a, np.zeros((h, w, 1), np.uint8)])
    f = paint_path(pid, layer_id)
    tmp = f.with_suffix(".tmp")
    Image.fromarray(rgb, "RGB").save(tmp, "PNG")
    os.replace(tmp, f)
    return jsonify({"ok": True})

@app.route("/api/auto-prefs", methods=["GET", "DELETE"])
def auto_prefs_route():
    if request.method == "DELETE":
        PREFS.clear()
    return jsonify({"samples": PREFS.count()})

@app.route("/api/ai/status")
def ai_models_status():
    return jsonify(ai_masks.status())

@app.route("/api/ai/download", methods=["POST"])
def ai_models_download():
    ai_masks.start_download()
    return jsonify(ai_masks.status())

# -- LUTs ---------------------------------------------------------------------

@app.route("/api/luts")
def list_luts():
    return jsonify(sorted(f.name for f in LUT_DIR.glob("*.cube")))

@app.route("/api/luts/<lut_name>")
def get_lut(lut_name):
    p = LUT_DIR / Path(lut_name).name
    if not p.exists():
        abort(404)
    return send_file(str(p), mimetype="text/plain")

@app.route("/api/luts/import", methods=["POST"])
def import_lut():
    try:
        from tkinter import filedialog
        root = _tk_root()
        files = filedialog.askopenfilenames(title="Importer des LUT 3D (.cube)",
                                            filetypes=[("LUT 3D", "*.cube")])
        root.destroy()
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    imported, errors = [], []
    for f in files:
        try:
            grading.parse_cube(Path(f).read_text(encoding="utf-8", errors="ignore"))
            shutil.copy2(f, LUT_DIR / Path(f).name)
            imported.append(Path(f).name)
        except Exception as e:
            errors.append(f"{Path(f).name}: {e}")
    return jsonify({"imported": imported, "errors": errors})

# -- Status -------------------------------------------------------------------

@app.route("/api/ai-status")
def ai_status():
    return jsonify({"available": ai_masks.available()})

@app.route("/api/capabilities")
def capabilities():
    return jsonify({"ffmpeg": bool(FFMPEG), "ffprobe": bool(FFPROBE), "heif": HEIF_SUPPORT})

# -- Modules of the suite (each one registers its own routes) ---------------------
import album
import montage
import phone_link
import updater
album.register(app, sys.modules[__name__])
montage.register(app, sys.modules[__name__])
updater.register(app, sys.modules[__name__])
phone_link.register(app, sys.modules[__name__])

@app.route("/favicon.ico")
def favicon():
    return send_from_directory(app.static_folder, "favicon.ico")

# -- Lifetime (no console window in the .exe: the app must know when to stop) ----
_alive = {"last": None, "bye": None}

@app.route("/api/alive", methods=["GET", "POST"])
def alive():
    """The open page pings this every few seconds."""
    import time
    _alive["last"], _alive["bye"] = time.time(), None
    return jsonify({"app": "photo-studio"})

@app.route("/api/bye", methods=["POST"])
def bye():
    """The page is being closed (or reloaded: a reload pings again right away)."""
    import time
    # now=1: sent by the app's own window, where no other tab can be open → stop quickly
    _alive["bye"] = time.time() + (8 if request.args.get("now") else 70)
    return ("", 204)

@app.route("/api/quit", methods=["POST"])
def quit_app():
    threading.Timer(0.4, lambda: os._exit(0)).start()
    return jsonify({"ok": True})

def _watchdog():
    """Stop the server once the last page is gone. Hidden tabs are throttled by the
    browser (about one ping a minute), hence the generous silence allowed."""
    import time
    while True:
        time.sleep(3)
        now = time.time()
        if _alive["bye"] and now > _alive["bye"]:
            os._exit(0)
        if _alive["last"] and now - _alive["last"] > 180:
            os._exit(0)

def _app_browser() -> str | None:
    """Edge or Chrome: both can show a page in its own window (no tabs, no address bar)."""
    pf = [os.environ.get("ProgramFiles(x86)", ""), os.environ.get("ProgramFiles", ""), os.environ.get("LOCALAPPDATA", "")]
    for rel in (r"Microsoft\Edge\Application\msedge.exe", r"Google\Chrome\Application\chrome.exe"):
        for base in pf:
            p = Path(base) / rel
            if base and p.exists():
                return str(p)
    return shutil.which("msedge") or shutil.which("chrome")

def open_window(url: str):
    """Show the app in its own window, like an installed app. Falls back to a normal
    browser tab when neither Edge nor Chrome is found.
    A dedicated browser profile keeps the window independent from the user's browsing.
    The page itself tells the server when the window is closed (see /api/bye): the browser
    keeps background processes alive, so waiting for its process would not work."""
    exe = None if os.environ.get("PHOTOCHOOSER_TAB") else _app_browser()
    if not exe:
        webbrowser.open(url)
        return
    profile = Path(os.environ.get("PHOTOCHOOSER_PROFILE")
                   or Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "PhotoChooser" / "window")
    profile.mkdir(parents=True, exist_ok=True)
    try:
        subprocess.Popen([exe, f"--app={url}/?window=1", f"--user-data-dir={profile}", "--no-first-run",
                          "--no-default-browser-check", "--disable-background-mode", "--window-size=1500,950"])
    except Exception as e:
        print(f"[window] {e}")
        webbrowser.open(url)
        return

def _already_running(port: int) -> bool:
    try:
        import urllib.request
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/alive", timeout=1.5) as r:
            return json.loads(r.read()).get("app") == "photo-studio"
    except Exception:
        return False

if __name__ == "__main__":
    port = int(os.environ.get("PHOTOCHOOSER_PORT", 5000))
    url = f"http://127.0.0.1:{port}"
    show = not os.environ.get("PHOTOCHOOSER_NO_BROWSER")
    if getattr(sys, 'frozen', False):
        if os.environ.pop("PHOTOSTUDIO_RESTART", None):   # restarted after an update: let the old server go first
            import time
            for _ in range(60):
                if not _already_running(port):
                    break
                time.sleep(0.25)
        if _already_running(port):                 # second launch: just show the window again
            if show:
                open_window(url)
            sys.exit(0)
        if show:
            threading.Timer(1.0, lambda: open_window(url)).start()
        threading.Thread(target=_watchdog, daemon=True).start()
        app.run(debug=False, port=port, threaded=True)
    else:
        # script mode (launch.bat): the reloader runs this block twice, open the window once
        if show and os.environ.get("PHOTOCHOOSER_WINDOW") and not os.environ.get("WERKZEUG_RUN_MAIN"):
            threading.Timer(2.0, lambda: open_window(url)).start()
        app.run(debug=True, port=port, threaded=True)
