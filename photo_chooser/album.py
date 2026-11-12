"""
Photo Studio – Album module (photo-book maker).

An album references the photos of a PhotoChooser project (by id) and stores only its
structure: pages, layouts, captions, theme. Pages are rendered in the browser with
HTML/CSS (static/js/album.js) – the same code draws the editor, the thumbnails and
the print / PDF output.

Automatic mode: photos are analysed (true aspect ratio, sharpness, kind of scene from
the AI masks, date, GPS when present), split into chapters (days / places), then laid
out page by page by matching each photo's shape to the slots of the page layouts.
"""
import hashlib
import itertools
import json
import math
import os
import threading
import uuid
from datetime import datetime
from pathlib import Path

import numpy as np
from flask import jsonify, request, abort

# ── Page layouts: slots as [x, y, w, h] fractions of the page's photo area ────
T = 1 / 3
LAYOUTS = {
    "1":  {"slots": [[0, 0, 1, 1]]},
    "1f": {"slots": [[0, 0, 1, 1]], "bleed": True},              # full page, no margin
    "2h": {"slots": [[0, 0, .5, 1], [.5, 0, .5, 1]]},
    "2v": {"slots": [[0, 0, 1, .5], [0, .5, 1, .5]]},
    "2a": {"slots": [[0, 0, .64, 1], [.64, .22, .36, .56]]},
    "3l": {"slots": [[0, 0, .6, 1], [.6, 0, .4, .5], [.6, .5, .4, .5]]},
    "3r": {"slots": [[0, 0, .4, .5], [0, .5, .4, .5], [.4, 0, .6, 1]]},
    "3t": {"slots": [[0, 0, 1, .6], [0, .6, .5, .4], [.5, .6, .5, .4]]},
    "3b": {"slots": [[0, 0, .5, .4], [.5, 0, .5, .4], [0, .4, 1, .6]]},
    "3c": {"slots": [[0, 0, T, 1], [T, 0, T, 1], [2 * T, 0, T, 1]]},
    "3s": {"slots": [[0, 0, 1, T], [0, T, 1, T], [0, 2 * T, 1, T]]},
    "4":  {"slots": [[0, 0, .5, .5], [.5, 0, .5, .5], [0, .5, .5, .5], [.5, .5, .5, .5]]},
    "4t": {"slots": [[0, 0, 1, .58], [0, .58, T, .42], [T, .58, T, .42], [2 * T, .58, T, .42]]},
    "4l": {"slots": [[0, 0, .58, 1], [.58, 0, .42, T], [.58, T, .42, T], [.58, 2 * T, .42, T]]},
    # with note blocks ("texts"): the text sits beside the photos, never on or under them
    "1t": {"slots": [[0, 0, .66, 1]], "texts": [[.70, .12, .30, .76]]},
    "t1": {"slots": [[.34, 0, .66, 1]], "texts": [[0, .12, .30, .76]]},
    "2t": {"slots": [[0, 0, .62, .5], [0, .5, .62, .5]], "texts": [[.66, .12, .34, .76]]},
    "t2": {"slots": [[.38, 0, .62, .5], [.38, .5, .62, .5]], "texts": [[0, .12, .34, .76]]},
    "2x": {"slots": [[0, 0, .5, .5], [.5, .5, .5, .5]], "texts": [[.55, .07, .41, .36], [.04, .57, .41, .36]]},
    "3x": {"slots": [[0, 0, .64, .6], [0, .6, .32, .4], [.32, .6, .32, .4]], "texts": [[.68, .10, .32, .80]]},
    # photo above, words below
    "1tb": {"slots": [[0, 0, 1, .70]], "texts": [[.08, .73, .84, .27]]},
    "2tb": {"slots": [[0, 0, .5, .68], [.5, 0, .5, .68]], "texts": [[.08, .71, .84, .29]]},
    # ── chosen by hand only ("manual"): airy, collage and mosaic pages ──
    "1c": {"slots": [[.14, .14, .72, .72]], "manual": True},
    "1p": {"slots": [[0, .27, 1, .46]], "manual": True},
    "2p": {"slots": [[0, 0, 1, .36], [0, .36, 1, .64]], "manual": True},
    "2c": {"slots": [[.05, .18, .43, .64], [.52, .18, .43, .64]], "manual": True},
    "2d": {"slots": [[0, 0, .60, .62], [.40, .38, .60, .62]], "manual": True},
    "3m": {"slots": [[0, 0, .22, 1], [.22, 0, .56, 1], [.78, 0, .22, 1]], "manual": True},
    "3d": {"slots": [[0, 0, .50, .50], [.25, .25, .50, .50], [.50, .50, .50, .50]], "manual": True},
    "3k": {"slots": [[.02, .06, .50, .56], [.48, .02, .50, .46], [.30, .50, .52, .48]], "manual": True},
    "4s": {"slots": [[0, 0, .25, 1], [.25, 0, .25, 1], [.5, 0, .25, 1], [.75, 0, .25, 1]], "manual": True},
    "4p": {"slots": [[0, 0, .6, .4], [.6, 0, .4, .6], [.4, .6, .6, .4], [0, .4, .4, .6]], "manual": True},
    "4c": {"slots": [[.02, .04, .46, .50], [.50, 0, .48, .44], [.08, .50, .40, .46], [.46, .42, .50, .56]], "manual": True},
    "4h": {"slots": [[0, 0, 1, .5], [0, .5, T, .5], [T, .5, T, .5], [2 * T, .5, T, .5]], "manual": True},
    "5a": {"slots": [[0, 0, .5, 1], [.5, 0, .25, .5], [.75, 0, .25, .5], [.5, .5, .25, .5], [.75, .5, .25, .5]], "manual": True},
    "5b": {"slots": [[0, 0, .5, .56], [.5, 0, .5, .56], [0, .56, T, .44], [T, .56, T, .44], [2 * T, .56, T, .44]], "manual": True},
    "5c": {"slots": [[.25, .16, .5, .68], [0, 0, .25, .5], [0, .5, .25, .5], [.75, 0, .25, .5], [.75, .5, .25, .5]], "manual": True},
    "6":  {"slots": [[c * T, r * .5, T, .5] for r in range(2) for c in range(3)], "manual": True},
    "6a": {"slots": [[0, 0, .66, .66], [.66, 0, .34, .33], [.66, .33, .34, .33], [0, .66, .33, .34], [.33, .66, .33, .34],
                     [.66, .66, .34, .34]], "manual": True},
    "7":  {"slots": [[0, 0, 1, .5]] + [[c * T, .5 + r * .25, T, .25] for r in range(2) for c in range(3)], "manual": True},
    "8":  {"slots": [[c * .25, r * .5, .25, .5] for r in range(2) for c in range(4)], "manual": True},
    "9":  {"slots": [[c * T, r * T, T, T] for r in range(3) for c in range(3)], "manual": True},
    "tt1": {"slots": [[0, .2, 1, .8]], "texts": [[0, 0, 1, .18]], "manual": True},
    "q1":  {"slots": [[.60, .18, .40, .64]], "texts": [[0, .15, .54, .70]], "manual": True},
    "tc2": {"slots": [[0, 0, .36, 1], [.64, 0, .36, 1]], "texts": [[.39, .15, .22, .70]], "manual": True},
    "3tb": {"slots": [[0, 0, T, .66], [T, 0, T, .66], [2 * T, 0, T, .66]], "texts": [[.08, .70, .84, .30]], "manual": True},
    "3z":  {"slots": [[0, 0, .45, T], [0, T, .45, T], [0, 2 * T, .45, T]],
            "texts": [[.50, .03, .50, .27], [.50, .36, .50, .27], [.50, .70, .50, .27]], "manual": True},
    "4x":  {"slots": [[0, 0, .5, .5], [.5, 0, .5, .5], [0, .5, .5, .5]], "texts": [[.54, .55, .42, .40]], "manual": True},
    "5x":  {"slots": [[.34, 0, .66, .6], [0, .6, .34, .4], [.34, .6, .33, .4], [.67, .6, .33, .4]], "texts": [[0, .05, .30, .50]],
            "manual": True},
    "6x":  {"slots": [[0, 0, .25, .5], [.25, 0, .25, .5], [0, .5, .25, .5], [.25, .5, .25, .5]],
            "texts": [[.55, .08, .42, .38], [.55, .54, .42, .38]], "manual": True},
}
FORMATS = {   # page size in mm – the sizes print services offer for photo books
    "square":    {"label": "Carré 30,5 cm (12 × 12″)", "w": 305, "h": 305},
    "square_s":  {"label": "Carré 23 cm (9 × 9″)",     "w": 229, "h": 229},
    "square_21": {"label": "Carré 21 cm",              "w": 210, "h": 210},
    "landscape": {"label": "A4 paysage",               "w": 297, "h": 210},
    "portrait":  {"label": "A4 portrait",              "w": 210, "h": 297},
    "a5":        {"label": "A5 portrait",              "w": 148, "h": 210},
    "us_l":      {"label": "Paysage 28 × 23 cm (11 × 9″)", "w": 279, "h": 229},
    "us_p":      {"label": "Portrait 23 × 28 cm (9 × 11″)", "w": 229, "h": 279},
}
# What a print service expects (Prodigi photo books: one PDF, front cover first, back
# cover last, even page count, pages at the exact book size, 10 mm safe margin, 300 dpi).
BOOKS = {
    "hardcover": {"label": "Couverture rigide", "min": 24, "max": 300},
    "softcover": {"label": "Couverture souple", "min": 20, "max": 300},
    "layflat":   {"label": "Layflat (ouverture à plat)", "min": 18, "max": 122},
}
PRINT_DPI = 300
SAFE_MM = 10
DENSITY = {"airy": {1: 0.0, 2: 0.05, 3: 0.5}, "normal": {1: 0.35, 2: 0.0, 3: 0.0, 4: 0.3},
           "dense": {2: 0.4, 3: 0.05, 4: 0.0}}
THEMES = ["classique", "noir", "carnet", "minimal", "magazine", "voyage", "mer", "montagne", "foret", "coucher", "nuit",
          "polaroid", "pastel", "retro", "tropical", "neige", "journal"]

MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre",
          "octobre", "novembre", "décembre"]
DAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
# first drafts for the notes: meant to be rewritten, but never left empty
NOTES = {
    "sea": ["{m} au bord de l'eau, le bleu à perte de vue.", "L'océan, les rochers et le bruit des vagues."],
    "mountain": ["{m} sur les hauteurs, des paysages à couper le souffle.", "On prend de l'altitude : la vue en vaut la peine."],
    "nature": ["{m} au milieu de la végétation.", "Du vert partout, on respire."],
    "town": ["Balade dans les ruelles, on flâne et on regarde.", "{m} au village, façades colorées et petites places."],
    "portrait": ["Les sourires du jour.", "Ceux qui ont fait le voyage."],
    "sunset": ["Le soleil descend, la lumière devient dorée.", "Dernières couleurs avant la nuit."],
    "night": ["La nuit tombe, la journée se termine.", "Ambiance de soirée."],
    None: ["{m} de balade, quelques souvenirs en passant.", "Un moment de la journée à raconter ici."],
}

def moment(d):
    if d is None:
        return "Journée"
    h = d.hour
    return "Matinée" if h < 11 else "Midi" if h < 14 else "Après-midi" if h < 18 else "Fin de journée" if h < 21 else "Soirée"

SCENES = {"sea": "Bord de mer", "mountain": "Paysages", "nature": "Nature", "town": "Villages",
          "portrait": "Portraits", "sunset": "Coucher de soleil", "night": "De nuit"}

_jobs: dict = {}
_lock = threading.RLock()


def fr_date(d: datetime, weekday=False, year=True) -> str:
    s = f"{d.day}{'er' if d.day == 1 else ''} {MONTHS[d.month - 1]}"
    if year:
        s += f" {d.year}"
    return f"{DAYS[d.weekday()]} {s}" if weekday else s


def fr_range(a: datetime, b: datetime) -> str:
    if a.date() == b.date():
        return fr_date(a)
    if (a.year, a.month) == (b.year, b.month):
        return f"{a.day}{'er' if a.day == 1 else ''} – {fr_date(b)}"
    if a.year == b.year:
        return f"{fr_date(a, year=False)} – {fr_date(b)}"
    return f"{fr_date(a)} – {fr_date(b)}"


def _dt(p):
    try:
        return datetime.fromisoformat(p["date"])
    except Exception:
        return None


def register(app, core):
    """core: the app module (projects, images, AI masks…)."""
    ALBUMS_DIR = core._RUNTIME_DIR / "albums"
    ALBUMS_DIR.mkdir(parents=True, exist_ok=True)
    grading, ai_masks = core.grading, core.ai_masks

    def album_file(aid):
        safe = "".join(c for c in aid if c.isalnum())
        return ALBUMS_DIR / f"{safe}.json"

    def load(aid):
        f = album_file(aid)
        if not f.exists():
            return None
        return json.loads(f.read_text(encoding="utf-8"))

    def save(album):
        album["updated"] = datetime.now().isoformat()
        f = album_file(album["id"])
        tmp = f.with_suffix(".tmp")
        tmp.write_text(json.dumps(album, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, f)

    # ── photo analysis ────────────────────────────────────────────────────
    def display_aspect(p, src_aspect):
        """Aspect ratio of the photo as it is shown (after rotation / crop)."""
        geo = grading.normalize_edits(p.get("edits"))["geo"]
        a = src_aspect
        if int(geo.get("rot", 0)) % 180:
            a = 1 / a
        crop = geo.get("crop")
        if crop:
            a *= crop["w"] / max(crop["h"], 1e-6)
        return a

    def features(p, deep):
        """Cached per-photo analysis. deep=True also uses the AI masks (slower the first time)."""
        maps = core.PhotoMaps(p)
        f = core.MAPS_DIR / f"{maps.key}_feat.json"
        feat = None
        if f.exists():
            try:
                feat = json.loads(f.read_text())
            except Exception:
                feat = None
        if feat is None or (deep and "cov" not in feat and ai_masks.available()):
            img = core.open_image(p["path"], 512)
            a = np.asarray(img, np.float32) / 255.0
            flat = a.reshape(-1, 3)
            y = flat @ grading.LUMA
            feat = {
                "aspect": round(img.width / img.height, 4),
                "med": round(float(np.median(y)), 3),
                "chroma": round(float(np.mean(flat.max(axis=1) - flat.min(axis=1))), 3),
                "sharp": round(float(np.sqrt(np.mean(grading.fine_detail(np.asarray(img)) ** 2))), 4),
                "warm": round(float(flat[:, 0].mean() / max(flat[:, 2].mean(), 1e-3)), 3),
            }
            if deep and ai_masks.available():
                stack = maps.masks()
                if stack is not None:
                    feat["cov"] = ai_masks.coverage(stack)
            f.write_text(json.dumps(feat))
        return feat

    def scene_of(feat):
        cov = feat.get("cov") or {}
        if feat["med"] < 0.16:
            return "night"
        if feat["warm"] > 1.45 and feat["med"] < 0.45:
            return "sunset"
        if cov.get("person", 0) > 0.08:
            return "portrait"
        if cov.get("water", 0) > 0.15:
            return "sea"
        if cov.get("building", 0) > 0.22:
            return "town"
        if cov.get("vegetation", 0) > 0.35:
            return "nature"
        if cov.get("ground", 0) > 0.3 and cov.get("sky", 0) > 0.05:
            return "mountain"
        return None

    def score_of(p, feat):
        cov = feat.get("cov") or {}
        s = min(feat["sharp"], 0.035) * 14 + min(feat["chroma"], 0.4) * 0.8
        if 0.12 < cov.get("sky", 0) < 0.6:
            s += 0.2                                       # open landscapes make good full pages
        if cov.get("person", 0) > 0.03:
            s += 0.1
        if p.get("edits"):
            s += 0.15                                      # the user took the time to retouch it
        if feat["med"] < 0.12:
            s -= 0.3
        return round(s, 3)

    # ── automatic layout ──────────────────────────────────────────────────
    def page_aspect(fmt):
        f = FORMATS[fmt]
        return f["w"] / f["h"]

    def best_fit(photos, layout, pa):
        """Assign photos to slots (any order): returns (cost, ordered photos)."""
        slots = [s[2] * pa / s[3] for s in layout["slots"]]
        best = None
        for perm in itertools.permutations(range(len(photos))):
            c = sum(abs(math.log(photos[i]["aspect"] / slots[k])) for k, i in enumerate(perm))
            if best is None or c < best[0]:
                best = (c, [photos[i] for i in perm])
        return best

    def paginate(photos, fmt, density, hero_score):
        """Returns [(layout, photos)]. A page with a note block opens the sequence and
        comes back every few pages, so the album tells something between the photos."""
        pa = page_aspect(fmt)
        pref = DENSITY[density]
        pages, i, prev, since_hero, since_text = [], 0, None, 99, 99
        while i < len(photos):
            left = len(photos) - i
            ph = photos[i]
            if ph["score"] >= hero_score and since_hero >= 3 and abs(math.log(ph["aspect"] / pa)) < 0.75:
                pages.append(("1f", [ph]))
                i, prev, since_hero = i + 1, "1f", 0
                continue
            best = None
            want_text = since_text >= 3
            for name, L in LAYOUTS.items():
                k = len(L["slots"])
                if L.get("bleed") or L.get("manual") or k > left:
                    continue
                if bool(L.get("texts")) != want_text:
                    continue
                if k not in pref and k != left and not want_text:
                    continue
                if left - k == 1 and left > 2 and 1 not in pref:
                    continue                               # do not strand a lone photo at the end
                cost, order = best_fit(photos[i:i + k], L, pa)
                cost = cost / k + pref.get(k, 0.3 if want_text else 0.6) + (0.45 if name == prev else 0)
                if best is None or cost < best[0]:
                    best = (cost, name, order)
            if best is None:
                k = min(left, 4)
                name = {1: "1", 2: "2h", 3: "3t", 4: "4"}[k]
                best = (0, name, best_fit(photos[i:i + k], LAYOUTS[name], pa)[1])
            pages.append((best[1], best[2]))
            i += len(best[2])
            prev, since_hero = best[1], since_hero + 1
            since_text = 0 if LAYOUTS[best[1]].get("texts") else since_text + 1
        return pages

    def new_page(kind, **kw):
        return {"id": uuid.uuid4().hex[:8], "type": kind, **kw}

    def item(ph):
        return {"pid": ph["id"], "x": 50, "y": 50, "zoom": 1}

    def build(album, photos, density):
        """photos: analysed, chronological. Fills album["pages"]."""
        fmt = album["format"]
        dated = [p for p in photos if p["dt"]]
        pages = []

        # chapters: one per day; a day with very few photos joins its neighbour
        chapters, cur = [], []
        for ph in photos:
            if cur and ph["dt"] and cur[-1]["dt"] and ph["dt"].date() != cur[-1]["dt"].date():
                chapters.append(cur)
                cur = []
            cur.append(ph)
        if cur:
            chapters.append(cur)
        merged = []
        for ch in chapters:
            if merged and (len(ch) < 3 or len(merged[-1]) < 3):
                merged[-1] = merged[-1] + ch
            else:
                merged.append(ch)
        chapters = merged

        scores = sorted((p["score"] for p in photos), reverse=True)
        hero_score = scores[max(0, int(len(scores) * 0.12) - 1)] if scores else 9

        # cover
        wide = [p for p in photos if p["aspect"] > 1.1] or photos
        cover = max(wide, key=lambda p: p["score"]) if wide else None
        sub = fr_range(dated[0]["dt"], dated[-1]["dt"]) if dated else ""
        pages.append(new_page("cover", title=album["name"].replace("_", " "), subtitle=sub,
                              items=[item(cover)] if cover else []))

        for n, ch in enumerate(chapters, 1):
            body = list(ch)
            if len(chapters) > 1:
                d0 = next((p["dt"] for p in ch if p["dt"]), None)
                d1 = next((p["dt"] for p in reversed(ch) if p["dt"]), None)
                kinds = {}
                for p in ch:
                    if p["scene"]:
                        kinds[p["scene"]] = kinds.get(p["scene"], 0) + 1
                top = [SCENES[k] for k, v in sorted(kinds.items(), key=lambda kv: -kv[1]) if v >= max(2, len(ch) * 0.2)][:2]
                lead = max([p for p in ch if p["aspect"] > 1.1] or ch, key=lambda p: p["score"])
                body = [p for p in ch if p is not lead]
                when = (fr_date(d0, weekday=True).capitalize() if d0 and d1 and d0.date() == d1.date()
                        else fr_range(d0, d1) if d0 else "")
                pages.append(new_page("chapter", title=f"Jour {n}" if d0 else f"Chapitre {n}",
                                      subtitle=when, text=" · ".join(top), items=[item(lead)]))
            for layout, group in paginate(body, fmt, density, hero_score):
                pg = new_page("photos", layout=layout, items=[item(p) for p in group], notes=[])
                for k in range(len(LAYOUTS[layout].get("texts", []))):
                    ph = group[min(k, len(group) - 1)]
                    bank = NOTES.get(ph["scene"]) or NOTES[None]
                    head = " · ".join(b for b in [fr_date(ph["dt"], year=False) if ph["dt"] else "", moment(ph["dt"])] if b)
                    pg["notes"].append({"h": head, "t": bank[(len(pages) + k) % len(bank)].format(m=moment(ph["dt"]))})
                pages.append(pg)
        album["pages"] = pages
        return album

    def collect(album, source, deep, progress=None):
        data = core.load_project(album["project"])
        if not data:
            raise ValueError("Projet introuvable")
        pool = [p for p in data["photos"] if not core.is_video(p) and os.path.exists(p["path"])]
        if source == "liked":
            pool = [p for p in pool if p.get("liked")]
        out = []
        for n, p in enumerate(pool):
            try:
                feat = features(p, deep)
            except Exception as e:
                print(f"[album] {p['path']}: {e}")
                continue
            out.append({"id": p["id"], "dt": _dt(p), "aspect": display_aspect(p, feat["aspect"]),
                        "scene": scene_of(feat), "score": score_of(p, feat), "lat": p.get("lat"), "lon": p.get("lon")})
            if progress:
                progress(n + 1, len(pool))
        out.sort(key=lambda p: p["dt"] or datetime.max)
        return out

    # ── routes ────────────────────────────────────────────────────────────
    @app.route("/api/albums/meta")
    def album_meta():
        return jsonify({"layouts": LAYOUTS, "formats": FORMATS, "themes": THEMES, "books": BOOKS,
                        "dpi": PRINT_DPI, "safe_mm": SAFE_MM, "ai": ai_masks.available()})

    @app.route("/api/albums", methods=["GET"])
    def album_list():
        out = []
        for f in ALBUMS_DIR.glob("*.json"):
            try:
                a = json.loads(f.read_text(encoding="utf-8"))
            except Exception:
                continue
            cover = next((it for pg in a.get("pages", []) for it in pg.get("items", []) if it.get("pid")), None)
            out.append({"id": a["id"], "name": a["name"], "project": a["project"], "theme": a.get("theme"),
                        "format": a.get("format"), "pages": len(a.get("pages", [])),
                        "updated": a.get("updated"), "cover": cover["pid"] if cover else None})
        out.sort(key=lambda a: a.get("updated") or "", reverse=True)
        return jsonify(out)

    @app.route("/api/albums", methods=["POST"])
    def album_create():
        b = request.json or {}
        if not core.load_project(b.get("project", "")):
            return jsonify({"error": "Projet introuvable"}), 404
        album = {"id": uuid.uuid4().hex[:12], "name": (b.get("name") or b["project"]).strip(),
                 "project": b["project"], "created": datetime.now().isoformat(),
                 "theme": b.get("theme") if b.get("theme") in THEMES else THEMES[0],
                 "format": b.get("format") if b.get("format") in FORMATS else "square", "pages": []}
        save(album)
        return jsonify(album), 201

    @app.route("/api/albums/<aid>", methods=["GET", "PUT", "DELETE"])
    def album_one(aid):
        album = load(aid)
        if not album:
            abort(404)
        if request.method == "DELETE":
            album_file(aid).unlink(missing_ok=True)
            return jsonify({"ok": True})
        if request.method == "PUT":
            b = request.json or {}
            for k in ("name", "theme", "format", "pages", "style", "overlays", "bg"):
                if k in b:
                    album[k] = b[k]
            with _lock:
                save(album)
        return jsonify(album)

    # ── images added by the user (logos, stickers…) ───────────────────────
    def assets_dir(aid):
        d = ALBUMS_DIR / ("".join(c for c in aid if c.isalnum()) + "_assets")
        d.mkdir(parents=True, exist_ok=True)
        return d

    @app.route("/api/albums/<aid>/assets", methods=["POST"])
    def album_asset_upload(aid):
        if not load(aid):
            abort(404)
        f = request.files.get("file")
        ext = Path(f.filename or "").suffix.lower() if f else ""
        if ext not in (".png", ".jpg", ".jpeg", ".webp", ".gif"):
            return jsonify({"error": "Image PNG, JPG ou WebP attendue"}), 400
        name = uuid.uuid4().hex[:10] + ext
        f.save(assets_dir(aid) / name)
        return jsonify({"name": name})

    @app.route("/api/albums/<aid>/assets/<name>")
    def album_asset(aid, name):
        f = assets_dir(aid) / Path(name).name
        if not f.exists():
            abort(404)
        return core.send_file(str(f))

    # ── print files: the browser rasterises each page, we assemble them ───
    def export_dir(album):
        safe = "".join(c for c in album["name"] if c.isalnum() or c in " _-").strip().replace(" ", "_") or album["id"]
        d = ALBUMS_DIR / "exports" / safe
        d.mkdir(parents=True, exist_ok=True)
        return d

    @app.route("/api/albums/<aid>/export/start", methods=["POST"])
    def album_export_start(aid):
        album = load(aid)
        if not album:
            abort(404)
        d = export_dir(album)
        for f in d.glob("page_*.jpg"):
            f.unlink()
        return jsonify({"dir": str(d)})

    @app.route("/api/albums/<aid>/export/page/<int:n>", methods=["POST"])
    def album_export_page(aid, n):
        album = load(aid)
        if not album:
            abort(404)
        data = request.get_data()
        if not data[:3] == b"\xff\xd8\xff":
            return jsonify({"error": "JPEG attendu"}), 400
        (export_dir(album) / f"page_{n:03d}.jpg").write_bytes(data)
        return jsonify({"ok": True})

    @app.route("/api/albums/<aid>/export/finish", methods=["POST"])
    def album_export_finish(aid):
        """Assemble the page images into one print PDF (page size = book size, 300 dpi)."""
        from PIL import Image
        album = load(aid)
        if not album:
            abort(404)
        d = export_dir(album)
        files = sorted(d.glob("page_*.jpg"))
        if not files:
            return jsonify({"error": "Aucune page"}), 400
        pdf = d / f"{d.name}.pdf"
        imgs = [Image.open(f) for f in files]
        imgs[0].save(pdf, "PDF", resolution=PRINT_DPI, save_all=True, append_images=imgs[1:], quality=92)
        for im in imgs:
            im.close()
        return jsonify({"dir": str(d), "pdf": str(pdf), "pages": len(files),
                        "size_mb": round(pdf.stat().st_size / 1e6, 1)})

    @app.route("/api/albums/<aid>/export/open", methods=["POST"])
    def album_export_open(aid):
        album = load(aid)
        if not album:
            abort(404)
        try:
            os.startfile(export_dir(album))
        except Exception as e:
            return jsonify({"error": str(e)}), 500
        return jsonify({"ok": True})

    @app.route("/api/albums/<aid>/photos")
    def album_photos(aid):
        """Photos of the album's project that can be placed (liked first)."""
        album = load(aid)
        data = core.load_project(album["project"]) if album else None
        if not data:
            abort(404)
        out = []
        for p in data["photos"]:
            if core.is_video(p):
                continue
            f = core.MAPS_DIR / f"{core.PhotoMaps(p).key}_feat.json"
            aspect = None
            if f.exists():
                try:
                    aspect = display_aspect(p, json.loads(f.read_text())["aspect"])
                except Exception:
                    pass
            out.append({"id": p["id"], "rev": p.get("rev", 0), "liked": bool(p.get("liked")),
                        "date": p.get("date"), "aspect": aspect, "filename": p["filename"]})
        return jsonify(out)

    @app.route("/api/albums/<aid>/generate", methods=["POST"])
    def album_generate(aid):
        """Automatic mode. body: {source: liked|all, density: airy|normal|dense, deep: bool}"""
        album = load(aid)
        if not album:
            abort(404)
        b = request.json or {}
        source = b.get("source", "liked")
        density = b.get("density") if b.get("density") in DENSITY else "normal"
        deep = bool(b.get("deep", True))
        job = {"id": uuid.uuid4().hex[:8], "done": 0, "total": 0, "state": "running", "error": None}
        _jobs[job["id"]] = job

        def run():
            try:
                def progress(d, t):
                    job["done"], job["total"] = d, t
                photos = collect(album, source, deep, progress)
                if not photos:
                    raise ValueError("Aucune photo à placer" + (" : likez d'abord des photos dans PhotoChooser" if source == "liked" else ""))
                with _lock:
                    fresh = load(aid) or album
                    build(fresh, photos, density)
                    save(fresh)
                job["state"] = "done"
            except Exception as e:
                job["state"], job["error"] = "error", str(e)

        threading.Thread(target=run, daemon=True).start()
        return jsonify(job)

    @app.route("/api/albums/jobs/<jid>")
    def album_job(jid):
        job = _jobs.get(jid)
        if not job:
            abort(404)
        return jsonify(job)
