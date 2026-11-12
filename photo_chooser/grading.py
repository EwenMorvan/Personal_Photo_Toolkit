"""
PhotoChooser – non-destructive editing pipeline (geometry + colour grading).

This module is the *reference* implementation used for exports, thumbnails
and lightbox renders. The live editor preview runs the same maths on the GPU
in static/js/gl-renderer.js (shader) + static/js/grade-core.js (uniforms).
Any change to the maths here MUST be mirrored there, and vice-versa.

Pipeline (per pixel, sRGB-encoded values, Rec.709 luma):
   0·  Learned colour ("Couleur IA"): per-photo 3D LUT predicted by a model, mixed in
   0a'. Sharpening: fine detail (3x3) of the source luma at the *rendered* resolution
   0a. Dehaze + clarity             (need the photo's auxiliary maps)
   0b. Local adjustments            (up to MAX_LOCALS layers, each limited by a mask:
                                     AI mask and / or brush paint)
   1. White balance + exposure      (in linear light)
   2. Offset                        (wheel + master)
   3. Lift / Gain                   out = gain * (in + lift * (1 - in))
   4. Gamma                         out = in ** (4 ** -gamma)
   5. Contrast around pivot
   6. Shadows / Highlights          (luma-weighted exposure)
   7. Custom curves                 (Y then R/G/B, monotone cubic)
   8. Hue rotation / Saturation / Color boost   (in YCbCr)
   9. 3D LUT (.cube) with mix
  10. Clamp
"""
import copy
import math
from pathlib import Path

import numpy as np
from PIL import Image

LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)
K_LIFT, K_GAMMA, K_GAIN, K_OFFSET = 0.25, 0.5, 0.5, 0.25
CURVE_SAMPLES = 1024
IDENTITY_CURVE = [[0.0, 0.0], [1.0, 1.0]]
CHUNK_PIXELS = 1 << 20          # process 1 Mpx at a time to bound memory
MAX_LOCALS = 6                  # same limit as the shader
LOCAL_PIVOT = 0.435
CLARITY_GAIN = 1.5
SHARP_GAIN = 2.0
SHARP_CLAMP = 0.08              # limits halos on hard edges
# channel order of the AI mask stack (must match ai_masks.MASK_NAMES)
MASK_NAMES = ["sky", "person", "vegetation", "water", "ground", "building", "foreground", "background"]


# ── Defaults / normalisation ─────────────────────────────────────────────────

def default_grade() -> dict:
    return {
        "exposure": 0.0, "temp": 0.0, "tint": 0.0,
        "contrast": 1.0, "pivot": 0.435,
        "shadows": 0.0, "highlights": 0.0,
        "sat": 50.0, "hue": 50.0, "boost": 0.0,
        "lift":   {"x": 0.0, "y": 0.0, "m": 0.0},
        "gamma":  {"x": 0.0, "y": 0.0, "m": 0.0},
        "gain":   {"x": 0.0, "y": 0.0, "m": 1.0},
        "offset": {"x": 0.0, "y": 0.0, "m": 0.0},
        "curves": {k: copy.deepcopy(IDENTITY_CURVE) for k in "yrgb"},
        "lut": None, "lut_mix": 1.0,
        "clarity": 0.0, "dehaze": 0.0,
        "sharpen": 0.0,
        "ai": 0.0,                  # amount (0..100) of the learned per-photo LUT
        "locals": [],
    }


def default_local() -> dict:
    """One local adjustment layer. mask: a MASK_NAMES entry, or "brush" (paint only)."""
    return {
        "id": "", "name": "", "mask": "brush", "invert": False, "on": True, "auto": False,
        "amount": 100.0, "paint": None,
        "exposure": 0.0, "contrast": 1.0, "shadows": 0.0, "highlights": 0.0,
        "temp": 0.0, "tint": 0.0, "sat": 50.0, "clarity": 0.0,
    }


LOCAL_ADJ = ("exposure", "contrast", "shadows", "highlights", "temp", "tint", "sat", "clarity")


def local_effective(l: dict) -> bool:
    d = default_local()
    return bool(l.get("on", True)) and l.get("amount", 100) > 0.01 and \
        any(not _close(l[k], d[k]) for k in LOCAL_ADJ)


def default_geo() -> dict:
    return {"rot": 0, "flip": False, "angle": 0.0, "crop": None, "aspect": "free"}


def _merge(base: dict, over: dict) -> dict:
    for k, v in (over or {}).items():
        if k in base and isinstance(base[k], dict) and isinstance(v, dict):
            _merge(base[k], v)
        else:
            base[k] = v
    return base


def normalize_edits(edits: dict | None) -> dict:
    edits = edits or {}
    grade = _merge(default_grade(), copy.deepcopy(edits.get("grade") or {}))
    grade["locals"] = [_merge(default_local(), l) for l in (grade.get("locals") or [])
                       if isinstance(l, dict)]
    return {
        "grade": grade,
        "geo":   _merge(default_geo(),   copy.deepcopy(edits.get("geo") or {})),
    }


def _close(a, b, eps=1e-4):
    return abs(float(a) - float(b)) < eps


def curves_identity(curves: dict) -> bool:
    for k in "yrgb":
        pts = curves.get(k) or IDENTITY_CURVE
        if len(pts) != 2 or not (_close(pts[0][0], 0) and _close(pts[0][1], 0)
                                 and _close(pts[1][0], 1) and _close(pts[1][1], 1)):
            return False
    return True


def grade_is_identity(g: dict) -> bool:
    d = default_grade()
    if any(local_effective(_merge(default_local(), dict(l))) for l in g.get("locals") or []):
        return False
    for k in ("exposure", "temp", "tint", "contrast", "pivot", "shadows",
              "highlights", "sat", "hue", "boost", "clarity", "dehaze", "ai", "sharpen"):
        if k == "pivot":
            continue  # pivot alone has no effect
        if not _close(g[k], d[k]):
            return False
    for w in ("lift", "gamma", "gain", "offset"):
        for c in "xym":
            if not _close(g[w][c], d[w][c]):
                return False
    if not curves_identity(g["curves"]):
        return False
    if g.get("lut") and g.get("lut_mix", 1) > 1e-4:
        return False
    return True


def geo_is_identity(geo: dict) -> bool:
    crop = geo.get("crop")
    crop_full = (not crop) or (_close(crop["x"], 0) and _close(crop["y"], 0)
                               and _close(crop["w"], 1) and _close(crop["h"], 1))
    return (int(geo.get("rot", 0)) % 360 == 0 and not geo.get("flip")
            and _close(geo.get("angle", 0), 0) and crop_full)


def edits_are_identity(edits: dict | None) -> bool:
    if not edits:
        return True
    e = normalize_edits(edits)
    return grade_is_identity(e["grade"]) and geo_is_identity(e["geo"])


# ── Colour maths helpers ─────────────────────────────────────────────────────

def s2l(x):
    return np.where(x <= 0.04045, x / 12.92, ((np.maximum(x, 0) + 0.055) / 1.055) ** 2.4)


def l2s(x):
    x = np.maximum(x, 0)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * x ** (1 / 2.4) - 0.055)


def wheel_rgb(w: dict, k: float) -> np.ndarray:
    """(x, y) of a colour wheel = (Cb, Cr) direction → zero-luma RGB shift."""
    cb, cr = float(w["x"]) * k, float(w["y"]) * k
    return np.array([1.5748 * cr, -0.187324 * cb - 0.468124 * cr, 1.8556 * cb], np.float32)


def wb_gains(temp: float, tint: float, exposure: float) -> np.ndarray:
    t, ti = temp / 100.0, tint / 100.0
    l = np.array([0.5 * t + 0.2 * ti, -0.4 * ti, -0.5 * t + 0.2 * ti], np.float64)
    l -= float(np.dot(LUMA, l))
    return (2.0 ** (l + exposure)).astype(np.float32)


def gains_to_temp_tint(log2_gains) -> tuple[float, float]:
    lr, lg, lb = log2_gains
    return (lr - lb) * 100.0, ((lr + lb) / 2 - lg) / 0.6 * 100.0


# ── Curves (Fritsch–Carlson monotone cubic) ──────────────────────────────────

def _spline_slopes(xs, ys):
    n = len(xs)
    d = [(ys[k + 1] - ys[k]) / max(xs[k + 1] - xs[k], 1e-9) for k in range(n - 1)]
    m = [0.0] * n
    m[0], m[-1] = d[0], d[-1]
    for k in range(1, n - 1):
        m[k] = (d[k - 1] + d[k]) / 2 if d[k - 1] * d[k] > 0 else 0.0
    for k in range(n - 1):
        if d[k] == 0:
            m[k] = m[k + 1] = 0.0
        else:
            a, b = m[k] / d[k], m[k + 1] / d[k]
            s = a * a + b * b
            if s > 9:
                t = 3 / math.sqrt(s)
                m[k], m[k + 1] = t * a * d[k], t * b * d[k]
    return m


def spline_eval(points, x: np.ndarray) -> np.ndarray:
    pts = sorted(points, key=lambda p: p[0])
    xs = [float(p[0]) for p in pts]
    ys = [float(p[1]) for p in pts]
    x = np.asarray(x, np.float64)
    if len(xs) < 2:
        return np.full_like(x, ys[0] if ys else 0.0)
    m = _spline_slopes(xs, ys)
    xa, ya, ma = np.array(xs), np.array(ys), np.array(m)
    k = np.clip(np.searchsorted(xa, x, side="right") - 1, 0, len(xs) - 2)
    h = np.maximum(xa[k + 1] - xa[k], 1e-9)
    t = np.clip((x - xa[k]) / h, 0, 1)
    t2, t3 = t * t, t * t * t
    y = ((2 * t3 - 3 * t2 + 1) * ya[k] + (t3 - 2 * t2 + t) * h * ma[k]
         + (-2 * t3 + 3 * t2) * ya[k + 1] + (t3 - t2) * h * ma[k + 1])
    y = np.where(x <= xa[0], ya[0], np.where(x >= xa[-1], ya[-1], y))
    return np.clip(y, 0, 1)


def build_curve_lut(curves: dict) -> np.ndarray:
    """(CURVE_SAMPLES, 3) composite LUT: channel(Y(x))."""
    xs = np.arange(CURVE_SAMPLES, dtype=np.float64) / (CURVE_SAMPLES - 1)
    yv = spline_eval(curves.get("y") or IDENTITY_CURVE, xs)
    return np.stack([spline_eval(curves.get(c) or IDENTITY_CURVE, yv) for c in "rgb"],
                    axis=1).astype(np.float32)


# ── .cube LUTs ───────────────────────────────────────────────────────────────

_lut_cache: dict = {}


def parse_cube(text: str) -> dict:
    size, dmin, dmax, vals = None, [0.0] * 3, [1.0] * 3, []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        up = line.upper()
        if up.startswith("TITLE"):
            continue
        if up.startswith("LUT_1D_SIZE"):
            raise ValueError("Les LUT 1D ne sont pas supportées (3D uniquement)")
        if up.startswith("LUT_3D_SIZE"):
            size = int(line.split()[1])
            continue
        if up.startswith("DOMAIN_MIN"):
            dmin = [float(v) for v in line.split()[1:4]]
            continue
        if up.startswith("DOMAIN_MAX"):
            dmax = [float(v) for v in line.split()[1:4]]
            continue
        parts = line.split()
        if len(parts) >= 3:
            try:
                vals.append([float(parts[0]), float(parts[1]), float(parts[2])])
            except ValueError:
                continue
    if not size or len(vals) < size ** 3:
        raise ValueError("Fichier .cube invalide")
    arr = np.array(vals[: size ** 3], np.float32).reshape(size, size, size, 3)  # [b, g, r]
    return {"size": size, "data": arr,
            "min": np.array(dmin, np.float32), "max": np.array(dmax, np.float32)}


def load_lut(lut_dir: Path, name: str) -> dict | None:
    if not name:
        return None
    p = lut_dir / name
    if not p.exists():
        return None
    key = (str(p), p.stat().st_mtime)
    if key not in _lut_cache:
        _lut_cache[key] = parse_cube(p.read_text(encoding="utf-8", errors="ignore"))
    return _lut_cache[key]


def apply_lut3d(c: np.ndarray, lut: dict) -> np.ndarray:
    n = lut["size"]
    data = lut["data"]
    v = np.clip((c - lut["min"]) / np.maximum(lut["max"] - lut["min"], 1e-6), 0, 1)
    p = v * (n - 1)
    i0 = np.clip(np.floor(p).astype(np.int32), 0, n - 2)
    f = p - i0
    r0, g0, b0 = i0[:, 0], i0[:, 1], i0[:, 2]
    fr, fg, fb = f[:, 0:1], f[:, 1:2], f[:, 2:3]

    def g(db, dg, dr):
        return data[b0 + db, g0 + dg, r0 + dr]

    c00 = g(0, 0, 0) * (1 - fr) + g(0, 0, 1) * fr
    c10 = g(0, 1, 0) * (1 - fr) + g(0, 1, 1) * fr
    c01 = g(1, 0, 0) * (1 - fr) + g(1, 0, 1) * fr
    c11 = g(1, 1, 0) * (1 - fr) + g(1, 1, 1) * fr
    c0 = c00 * (1 - fg) + c10 * fg
    c1 = c01 * (1 - fg) + c11 * fg
    return c0 * (1 - fb) + c1 * fb


# ── Grade application ────────────────────────────────────────────────────────

def prepare(grade: dict, lut_dir: Path | None = None) -> dict:
    g = grade
    P = {
        "wb": wb_gains(g["temp"], g["tint"], g["exposure"]),
        "wb_on": not (_close(g["temp"], 0) and _close(g["tint"], 0) and _close(g["exposure"], 0)),
        "offset": (g["offset"]["m"] + wheel_rgb(g["offset"], K_OFFSET)).astype(np.float32),
        "lift": (g["lift"]["m"] + wheel_rgb(g["lift"], K_LIFT)).astype(np.float32),
        "gain": (g["gain"]["m"] * (1 + wheel_rgb(g["gain"], K_GAIN))).astype(np.float32),
        "gexp": (4.0 ** -(g["gamma"]["m"] + wheel_rgb(g["gamma"], K_GAMMA))).astype(np.float32),
        "contrast": float(g["contrast"]), "pivot": float(g["pivot"]),
        "sh": g["shadows"] / 100.0 * 1.0, "hl": g["highlights"] / 100.0 * 0.8,
        "curves": None if curves_identity(g["curves"]) else build_curve_lut(g["curves"]),
        "hue": (g["hue"] - 50) / 50 * math.pi,
        "sat": g["sat"] / 50.0, "boost": g["boost"] / 100.0,
        "lut": None, "lut_mix": float(g.get("lut_mix", 1.0)),
        "clarity": g.get("clarity", 0) / 100.0 * CLARITY_GAIN,
        "dehaze": g.get("dehaze", 0) / 100.0,
        "ai": g.get("ai", 0) / 100.0,
        "sharpen": g.get("sharpen", 0) / 100.0 * SHARP_GAIN,
        "locals": [],
    }
    for l in (g.get("locals") or []):
        if len(P["locals"]) >= MAX_LOCALS:
            break
        if not local_effective(l):
            continue
        P["locals"].append({
            "src": l,
            "wb": wb_gains(l["temp"], l["tint"], l["exposure"]),
            "wb_on": not (_close(l["temp"], 0) and _close(l["tint"], 0) and _close(l["exposure"], 0)),
            "contrast": float(l["contrast"]),
            "sh": l["shadows"] / 100.0, "hl": l["highlights"] / 100.0 * 0.8,
            "sat": l["sat"] / 50.0,
            "clarity": l["clarity"] / 100.0 * CLARITY_GAIN,
        })
    P["color_on"] = not (_close(g["hue"], 50) and _close(g["sat"], 50) and _close(g["boost"], 0))
    if g.get("lut") and lut_dir is not None and P["lut_mix"] > 1e-4:
        try:
            P["lut"] = load_lut(lut_dir, g["lut"])
        except Exception as e:
            print(f"[LUT] {g['lut']}: {e}")
    return P


def _apply_local(c, L, detail, w):
    if L["wb_on"]:
        c = l2s(s2l(c) * L["wb"])
    c = (c - LOCAL_PIVOT) * L["contrast"] + LOCAL_PIVOT
    if L["sh"] or L["hl"]:
        y = np.clip(c @ LUMA, 0, 1)
        ws = np.clip(1 - y / 0.6, 0, 1) ** 2
        wh = np.clip((y - 0.4) / 0.6, 0, 1) ** 2
        c = c * np.exp2(L["sh"] * ws + L["hl"] * wh)[:, None]
    y = (c @ LUMA)[:, None]
    c = y + (c - y) * L["sat"]
    if L["clarity"] and detail is not None:
        c = c + (L["clarity"] * detail * w)[:, None]
    return c


def apply_grade_array(c: np.ndarray, P: dict, X: dict | None = None) -> np.ndarray:
    """c: (n, 3) float32 sRGB-encoded in [0, 1]. Returns graded (n, 3) in [0, 1].
    X (optional per-pixel maps, all (n,) float32 in [0, 1]):
      blur  – blurred source luma,  t – haze transmission,  air – airlight RGB,
      masks – one array per entry of P["locals"] (None = layer unavailable)."""
    if X:
        if P["ai"] and X.get("ailut") is not None:
            c = c + (apply_lut3d(np.clip(c, 0, 1), X["ailut"]) - c) * P["ai"]
        detail = w = None
        if X.get("blur") is not None:
            ysrc = c @ LUMA
            detail = ysrc - X["blur"]
            w = np.clip(1 - np.abs(2 * ysrc - 1) ** 3, 0, 1)
        if P["dehaze"] and X.get("t") is not None:
            ts = np.maximum(1 - P["dehaze"] * (1 - X["t"]), 0.25)[:, None]
            c = np.where(c < X["air"], (c - X["air"]) / ts + X["air"], c)   # brighter than the haze: untouched
        if P["clarity"] and detail is not None:
            c = c + (P["clarity"] * detail * w)[:, None]
        if P["sharpen"] and X.get("fine") is not None:
            c = c + (P["sharpen"] * X["fine"])[:, None]
        for L, m in zip(P["locals"], X.get("masks") or []):
            if m is None:
                continue
            idx = np.nonzero(m > 0.003)[0]
            if not len(idx):
                continue
            sub = c[idx]
            adj = _apply_local(sub, L, None if detail is None else detail[idx],
                               None if w is None else w[idx])
            c = c.copy() if not c.flags.writeable else c
            c[idx] = sub + (adj - sub) * m[idx, None]

    if P["wb_on"]:
        c = l2s(s2l(c) * P["wb"])
    c = c + P["offset"]
    c = P["gain"] * (c + P["lift"] * (1 - c))
    c = np.power(np.maximum(c, 0), P["gexp"])
    c = (c - P["pivot"]) * P["contrast"] + P["pivot"]

    if P["sh"] or P["hl"]:
        y = np.clip(c @ LUMA, 0, 1)
        ws = np.clip(1 - y / 0.6, 0, 1) ** 2
        wh = np.clip((y - 0.4) / 0.6, 0, 1) ** 2
        c = c * np.exp2(P["sh"] * ws + P["hl"] * wh)[:, None]

    lut = P["curves"]
    if lut is not None:
        v = np.clip(c, 0, 1) * (CURVE_SAMPLES - 1)
        i0 = np.clip(np.floor(v).astype(np.int32), 0, CURVE_SAMPLES - 2)
        f = v - i0
        out = np.empty_like(c)
        for ch in range(3):
            a = lut[i0[:, ch], ch]
            b = lut[i0[:, ch] + 1, ch]
            out[:, ch] = a + (b - a) * f[:, ch]
        c = out

    if P["color_on"]:
        y = c @ LUMA
        cb = (c[:, 2] - y) / 1.8556
        cr = (c[:, 0] - y) / 1.5748
        hc, hs = math.cos(P["hue"]), math.sin(P["hue"])
        cb, cr = cb * hc - cr * hs, cb * hs + cr * hc
        chroma = np.sqrt(cb * cb + cr * cr)
        f = P["sat"] * (1 + P["boost"] * (1 - np.clip(chroma * 2.5, 0, 1)))
        cb, cr = cb * f, cr * f
        r = y + 1.5748 * cr
        b = y + 1.8556 * cb
        g = (y - 0.2126 * r - 0.0722 * b) / 0.7152
        c = np.stack([r, g, b], axis=1)

    if P["lut"] is not None:
        c = c + (apply_lut3d(np.clip(c, 0, 1), P["lut"]) - c) * P["lut_mix"]

    return np.clip(c, 0, 1).astype(np.float32)


def _needs(grade: dict) -> tuple[bool, bool]:
    """(needs aux maps, needs local masks)"""
    loc = [l for l in grade.get("locals") or [] if local_effective(l)]
    aux = (not _close(grade.get("clarity", 0), 0) or not _close(grade.get("dehaze", 0), 0)
           or any(not _close(l["clarity"], 0) for l in loc))
    return aux, bool(loc)


def fine_detail(arr: np.ndarray) -> np.ndarray:
    """Luma minus its 3x3 gaussian ([1 2 1] ⊗ [1 2 1] / 16), at the image's own resolution.
    arr: uint8 (h, w, 3). Returns float32 (h*w,) clamped to ±SHARP_CLAMP."""
    y = (arr.astype(np.float32) @ LUMA) / 255.0
    p = np.pad(y, 1, mode="edge")
    h = (p[:, :-2] + 2 * p[:, 1:-1] + p[:, 2:]) * 0.25
    b = (h[:-2] + 2 * h[1:-1] + h[2:]) * 0.25
    return np.clip(y - b, -SHARP_CLAMP, SHARP_CLAMP).reshape(-1)


def lut_dict(data: np.ndarray) -> dict:
    """Wrap a (N, N, N, 3) [b, g, r] array for apply_lut3d."""
    return {"size": data.shape[0], "data": data,
            "min": np.zeros(3, np.float32), "max": np.ones(3, np.float32)}


def _map_to(arr: np.ndarray, geo: dict, size) -> np.ndarray:
    """Bring a single-channel map (upright source frame) into the output frame."""
    m = apply_geometry(Image.fromarray(arr, "L"), geo)
    return np.asarray(m.resize(size, Image.Resampling.BILINEAR)).reshape(-1)


def _layer_mask(l: dict, maps, geo: dict, size) -> np.ndarray | None:
    """uint8 (n,) mask of a local layer: (AI mask, optionally inverted) + paint − erase."""
    m = None
    if l["mask"] in MASK_NAMES:
        stack = maps.masks()
        if stack is not None:
            m = _map_to(np.ascontiguousarray(stack[..., MASK_NAMES.index(l["mask"])]), geo, size)
            m = m.astype(np.float32) / 255.0
            if l.get("invert"):
                m = 1 - m
    paint = maps.paint(l) if l.get("paint") else None
    if paint is not None:
        add = _map_to(np.ascontiguousarray(paint[..., 0]), geo, size).astype(np.float32) / 255.0
        era = _map_to(np.ascontiguousarray(paint[..., 1]), geo, size).astype(np.float32) / 255.0
        m = np.clip((0 if m is None else m) + add, 0, 1) * (1 - era)
    if m is None:
        return None
    return (m * (min(l["amount"], 100.0) / 100.0) * 255 + 0.5).astype(np.uint8)


def apply_grade_image(img: Image.Image, grade: dict, lut_dir: Path | None = None,
                      maps=None, geo: dict | None = None) -> Image.Image:
    """maps: provider of the photo's maps in the upright source frame, with
         aux()   -> (uint8 (h, w, 2) [blurred luma, transmission], airlight RGB)
         masks() -> uint8 (h, w, 8) AI stack, or None when unavailable
         paint(layer) -> uint8 (h, w, 2) [add, erase], or None
         ailut() -> float32 (33, 33, 33, 3) learned LUT of the photo, or None
    geo: geometry already applied to img (the maps go through the same one)."""
    if grade_is_identity(grade):
        return img
    P = prepare(grade, lut_dir)
    arr = np.asarray(img.convert("RGB"))
    h, w, _ = arr.shape
    flat = arr.reshape(-1, 3)

    blur = trans = air = None
    masks = []
    need_aux, need_masks = _needs(grade)
    geo = geo or default_geo()
    if maps is not None and need_aux:
        aux, air = maps.aux()
        blur = _map_to(np.ascontiguousarray(aux[..., 0]), geo, (w, h))
        trans = _map_to(np.ascontiguousarray(aux[..., 1]), geo, (w, h))
        air = np.array(air, np.float32)
    if maps is not None and need_masks:
        masks = [_layer_mask(L["src"], maps, geo, (w, h)) for L in P["locals"]]
    ailut = None
    if maps is not None and P["ai"]:
        data = maps.ailut()
        ailut = None if data is None else lut_dict(data)
    fine = fine_detail(arr) if P["sharpen"] else None
    use_x = blur is not None or ailut is not None or fine is not None or any(m is not None for m in masks)

    out = np.empty_like(flat)
    f255 = np.float32(1 / 255.0)
    for s in range(0, flat.shape[0], CHUNK_PIXELS):
        e = s + CHUNK_PIXELS
        chunk = flat[s:e].astype(np.float32) * f255
        X = None
        if use_x:
            X = {"blur": None if blur is None else blur[s:e] * f255,
                 "t": None if trans is None else trans[s:e] * f255,
                 "air": air, "ailut": ailut, "fine": None if fine is None else fine[s:e],
                 "masks": [None if m is None else m[s:e] * f255 for m in masks]}
        res = apply_grade_array(chunk, P, X)
        out[s:e] = (res * 255.0 + 0.5).astype(np.uint8)
    return Image.fromarray(out.reshape(h, w, 3), "RGB")


# ── Geometry ─────────────────────────────────────────────────────────────────

def straighten_scale(w: float, h: float, angle_rad: float) -> float:
    a = abs(angle_rad)
    c, s = math.cos(a), math.sin(a)
    return min(w / (w * c + h * s), h / (w * s + h * c))


def crop_fraction(geo: dict, w: float = 1, h: float = 1) -> float:
    """Lower bound of output size / source size after geometry (for draft sizing)."""
    if int(geo.get("rot", 0)) % 180:
        w, h = h, w
    s = straighten_scale(w, h, math.radians(geo.get("angle", 0) or 0))
    crop = geo.get("crop") or {"w": 1, "h": 1}
    return max(0.05, s * min(crop["w"], crop["h"]))


def apply_geometry(img: Image.Image, geo: dict) -> Image.Image:
    rot = int(geo.get("rot", 0)) % 360
    if rot == 90:
        img = img.transpose(Image.Transpose.ROTATE_270)   # 90° clockwise
    elif rot == 180:
        img = img.transpose(Image.Transpose.ROTATE_180)
    elif rot == 270:
        img = img.transpose(Image.Transpose.ROTATE_90)
    if geo.get("flip"):
        img = img.transpose(Image.Transpose.FLIP_LEFT_RIGHT)

    W, H = img.size
    ang = float(geo.get("angle", 0) or 0)
    if abs(ang) > 1e-3:
        s = straighten_scale(W, H, math.radians(ang))
        img = img.rotate(ang, resample=Image.Resampling.BICUBIC, center=(W / 2, H / 2))
        bw, bh = W * s, H * s
        img = img.crop((round((W - bw) / 2), round((H - bh) / 2),
                        round((W + bw) / 2), round((H + bh) / 2)))

    crop = geo.get("crop")
    if crop:
        BW, BH = img.size
        box = (round(crop["x"] * BW), round(crop["y"] * BH),
               round((crop["x"] + crop["w"]) * BW), round((crop["y"] + crop["h"]) * BH))
        if box[2] - box[0] >= 1 and box[3] - box[1] >= 1:
            img = img.crop(box)
    return img


def render(img: Image.Image, edits: dict | None, max_size: int | None = None,
           lut_dir: Path | None = None, maps=None) -> Image.Image:
    """Full render: geometry → (optional downscale) → grade."""
    e = normalize_edits(edits)
    img = apply_geometry(img, e["geo"])
    if max_size and max(img.size) > max_size:
        img = img.copy()
        img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
    return apply_grade_image(img, e["grade"], lut_dir, maps, e["geo"])


# ── Auto colour (balance + levels) ───────────────────────────────────────────

def auto_grade(img: Image.Image) -> dict:
    """Resolve-style 'auto balance': neutralise the cast, set black/white points
    and nudge the midtones. Returns a partial grade to merge."""
    small = img.convert("RGB").copy()
    small.thumbnail((512, 512))
    a = np.asarray(small, np.float32).reshape(-1, 3) / 255.0
    lin = s2l(a)
    y = lin @ LUMA
    # Estimate the cast from *near-neutral* pixels only (rock, clouds, walls, snow…):
    # plain grey-world is fooled by large coloured areas (blue sky, sea, foliage).
    mx, mn = a.max(axis=1), a.min(axis=1)
    sat = (mx - mn) / np.maximum(mx, 1e-6)
    ys = a @ LUMA
    temp = tint = 0.0
    for limit in (0.18, 0.28):
        mask = (mx < 0.97) & (ys > 0.12) & (sat < limit)
        if mask.mean() > 0.01:
            est = lin[mask].mean(axis=0)
            lg = np.log2(est + 1e-6)
            # partial correction (keeps some of the mood), weaker if few neutral pixels
            strength = 0.8 * min(1.0, mask.mean() / 0.05)
            temp, tint = gains_to_temp_tint(-(lg - lg.mean()) * strength)
            break
    temp = float(np.clip(temp, -40, 40))
    tint = float(np.clip(tint, -40, 40))

    g = default_grade()
    g["temp"], g["tint"] = temp, tint
    c = apply_grade_array(a, prepare(g))
    yy = c @ LUMA
    p_lo, p_hi = (float(v) for v in np.percentile(yy, [0.5, 99.5]))

    lift_m, gain_m = 0.0, 1.0
    if p_hi - p_lo > 0.05:
        t_lo = min(0.02, p_lo)
        t_hi = max(0.97, p_hi)
        den = t_hi * (1 - p_lo) - t_lo * (1 - p_hi)
        if abs(den) > 1e-6:
            lift_m = (t_lo * p_hi - t_hi * p_lo) / den
            lift_m = float(np.clip(lift_m, -0.08, 0.05))
            gain_m = float(np.clip(t_hi / max(p_hi + lift_m * (1 - p_hi), 1e-3), 0.8, 1.6))

    g["lift"]["m"], g["gain"]["m"] = lift_m, gain_m
    c = apply_grade_array(a, prepare(g))
    med = float(np.median(c @ LUMA))
    gamma_m = 0.0
    if 0.03 < med < 0.97:
        target = med + (0.45 - med) * 0.5
        e = math.log(target) / math.log(med)
        gamma_m = float(np.clip(-math.log(e) / math.log(4), -0.2, 0.2))

    return {"temp": round(temp, 2), "tint": round(tint, 2),
            "lift": {"m": round(lift_m, 4)}, "gain": {"m": round(gain_m, 4)},
            "gamma": {"m": round(gamma_m, 4)}}


# ── Smart auto (per-zone, uses the AI masks when available) ──────────────────

LOCAL_LABELS = {"sky": "Ciel", "person": "Personnes", "vegetation": "Végétation", "water": "Eau",
                "ground": "Relief / sol", "building": "Bâtiments",
                "foreground": "Premier plan", "background": "Arrière-plan", "brush": "Pinceau"}


def _auto_layer(mask: str, **adj) -> dict:
    l = default_local()
    l.update(id=f"auto_{mask}", name=LOCAL_LABELS[mask], mask=mask, auto=True)
    l.update({k: round(float(v), 2) for k, v in adj.items()})
    return l


# Tunable targets of the automatic enhancement ("what a finished photo measures like").
AUTO = {
    "black": 0.015, "white": 0.975,          # luma percentiles 0.5 / 99.5 after grading
    "median": (0.36, 0.54), "median_pull": 0.6,   # only a median outside this band is corrected
    "local_contrast": 0.060,                 # RMS of (luma - wide blur) in the mid-tones
    "chroma": 0.26,                          # mean (max - min) spread of the coloured pixels
    "fine": 0.0125,                          # RMS of the 3x3 fine detail at ~1000 px
    "sky_luma": 0.56,
}


def smart_auto(img: Image.Image, stack: np.ndarray | None = None,
               aux: np.ndarray | None = None, air=None) -> dict:
    """One-click enhancement, solved by measurement rather than fixed recipes.

    The photo is rendered at low resolution through the *real* pipeline; black / white
    points, median, local contrast, haze, colourfulness and each detected zone are
    measured and every parameter (wheels, curve, clarity, dehaze, sharpening, zones) is
    adjusted until the measurements reach the AUTO targets, within limits that depend
    on the kind of scene. Returns a partial grade (its "locals" replace the previous
    auto zones); "auto_info" holds what was measured."""
    T = AUTO
    wb = auto_grade(img)                                   # neutral-pixel white balance estimate
    rgb = img.convert("RGB")
    small = rgb.copy()
    small.thumbnail((512, 512))
    W, H = small.size
    a = np.asarray(small, np.float32).reshape(-1, 3) / 255.0

    def chan(i, arr):
        m = Image.fromarray(np.ascontiguousarray(arr[..., i]), "L").resize((W, H), Image.Resampling.BILINEAR)
        return np.asarray(m, np.float32).reshape(-1) / 255.0

    blur = chan(0, aux) if aux is not None else None
    trans = chan(1, aux) if aux is not None else None
    masks = {n: chan(i, stack) for i, n in enumerate(MASK_NAMES)} if stack is not None else {}
    cov = {n: float(m.mean()) for n, m in masks.items()}
    air = np.array(air if air is not None else [1, 1, 1], np.float32)

    # ── scene ─────────────────────────────────────────────────────────────
    y0 = a @ LUMA
    med0, p90_0 = float(np.median(y0)), float(np.percentile(y0, 90))
    lit = a[y0 > 0.25] if (y0 > 0.25).sum() > 200 else a
    warm_ratio = float(lit[:, 0].mean() / max(lit[:, 2].mean(), 1e-3))
    night = med0 < 0.16 and p90_0 < 0.7
    warm = night and warm_ratio > 1.25
    sky = masks.get("sky")
    if sky is not None and cov["sky"] > 0.04:
        insky = sky > 0.5
        hot = insky & (a[:, 0] > a[:, 2] * 1.15) & ((a.max(axis=1) - a.min(axis=1)) > 0.15)
        warm = warm or hot.sum() > 0.12 * max(insky.sum(), 1)   # sunset / sunrise glow
    elif not masks and warm_ratio > 1.45:
        warm = True
    portrait = cov.get("person", 0) > 0.08
    scene = "night" if night else "sunset" if warm else "portrait" if portrait \
        else "landscape" if cov.get("sky", 0) > 0.04 else "general"
    strength = 0.0 if night else 0.6 if warm else 0.8 if portrait else 1.0   # how assertive to be

    g = default_grade()
    wb_k = 0.15 if warm else 0.3 if night else 0.6
    g["temp"] = round(float(np.clip(wb["temp"] * wb_k, -12, 12)), 2)
    g["tint"] = round(float(np.clip(wb["tint"] * wb_k, -10, 10)), 2)

    def sim(grade):
        P = prepare(grade)
        X = {"blur": blur, "t": trans, "air": air, "ailut": None, "fine": None,
             "masks": [masks[L["src"]["mask"]] * (L["src"]["amount"] / 100.0)
                       if L["src"]["mask"] in masks else None for L in P["locals"]]}
        return apply_grade_array(a.copy(), P, X)

    def wmean(v, m):
        return float((v * m).sum() / max(m.sum(), 1e-6))

    # ── haze → dehaze (measured outside the sky) ──────────────────────────
    haze = 0.0
    if trans is not None:
        if masks:
            far = masks["background"] * (1 - sky)              # distant, and not sky
            if float(far.mean()) > 0.05:
                haze = wmean(1 - trans, far)
                g["dehaze"] = round(float(np.clip((haze - 0.10) * 170, 0, 32)) * strength, 1)
            else:                                              # nothing far away: bright is not hazy
                haze = wmean(1 - trans, 1 - sky)
                g["dehaze"] = round(float(np.clip((haze - 0.15) * 60, 0, 8)) * strength, 1)
        else:
            haze = float(np.mean(1 - trans))
            g["dehaze"] = round(float(np.clip((haze - 0.12) * 110, 0, 22)) * strength, 1)

    # ── tone: black / white points and median, measured on the rendered result ──
    def settle(rounds):
        for _ in range(rounds):
            y = sim(g) @ LUMA
            p_lo, med, p_hi = (float(v) for v in np.percentile(y, [0.5, 50, 99.5]))
            if p_hi - p_lo > 0.05:
                t_lo, t_hi = min(T["black"], p_lo), max(T["white"], p_hi)
                den = t_hi * (1 - p_lo) - t_lo * (1 - p_hi)
                if abs(den) > 1e-6:
                    L = (t_lo * p_hi - t_hi * p_lo) / den
                    G = t_hi / max(p_hi + L * (1 - p_hi), 1e-3)
                    g["lift"]["m"] = float(np.clip(g["lift"]["m"] + 0.7 * L, -0.01 if night else -0.04, 0.03))
                    g["gain"]["m"] = float(np.clip(g["gain"]["m"] * G ** 0.7, 0.95, 1.06 if night else 1.12))
            lo, hi = T["median"]
            if not night and not warm and 0.03 < med < 0.97 and not lo <= med <= hi:
                target = med + ((lo if med < lo else hi) - med) * T["median_pull"]
                step = -math.log(math.log(target) / math.log(med)) / math.log(4)
                g["gamma"]["m"] = float(np.clip(g["gamma"]["m"] + 0.8 * np.clip(step, -0.05, 0.05), -0.05, 0.14))

    settle(3)

    y = sim(g) @ LUMA
    p5, p95 = (float(v) for v in np.percentile(y, [5, 95]))
    g["shadows"] = round(float(np.clip((0.07 - p5) * 450, 0, 10 if night else 35)), 1)
    g["highlights"] = round(-float(np.clip((p95 - 0.90) * 300, 0, 35)), 1)

    # ── tone curve: restrained equalisation + a gentle S for depth ────────
    y = sim(g) @ LUMA
    cdf = np.cumsum(np.histogram(y, bins=256, range=(0, 1))[0]).astype(np.float64)
    cdf /= max(cdf[-1], 1)
    s_amt = 0.014 * strength
    pts = [[0.0, 0.0]]
    for x, sgn in ((0.25, -1), (0.5, 0), (0.75, 1)):
        eq = float(cdf[int(x * 255)])
        yv = x + float(np.clip((0.05 if night else 0.14) * (eq - x), -0.035, 0.035)) + sgn * s_amt
        pts.append([x, round(max(yv, pts[-1][1] + 0.08), 4)])
    pts.append([1.0, 1.0])
    g["curves"]["y"] = pts

    # ── local contrast → clarity, fine detail → sharpening ───────────────
    lc = 0.0
    if blur is not None:
        wmid = np.clip(1 - np.abs(2 * y0 - 1) ** 3, 0, 1)
        lc = float(np.sqrt(np.mean(((y0 - blur) * wmid) ** 2)))
        g["clarity"] = round(min(float(np.clip(14 - (lc - 0.07) * 250, 4, 22)),
                                 4 if night else 6 if portrait else 22) * max(strength, 0.5), 1)
    probe = rgb.copy()
    probe.thumbnail((1024, 1024))
    fine = float(np.sqrt(np.mean(fine_detail(np.asarray(probe)) ** 2)))
    g["sharpen"] = round(min(float(np.clip(22 - (fine - 0.02) * 600, 10, 30)),
                             8 if night else 14 if portrait else 30), 1)

    # ── colourfulness → colour boost (vibrance: protects what is already vivid) ──
    c = sim(g)
    spread = c.max(axis=1) - c.min(axis=1)
    coloured = spread > 0.06
    share = float(coloured.mean())
    chroma = float(spread[coloured].mean()) if share > 0.02 else 0.0
    want = (T["chroma"] / max(chroma, 1e-3) - 1) * 70 if chroma else 0.0
    g["boost"] = round(float(np.clip(want, 0, 10 if (night or portrait) else 22))
                       * min(1.0, share / 0.4) * max(strength, 0.4), 1)

    # ── shadows / highlights rarely share a cast: balance each with its wheel ──
    c = sim(g)
    y = c @ LUMA
    mx, mn = c.max(axis=1), c.min(axis=1)
    neutral = (mx - mn) / np.maximum(mx, 1e-6) < 0.25
    cb = (c[:, 2] - y) / 1.8556
    cr = (c[:, 0] - y) / 1.5748
    for wheel, kk, lo, hi in (("lift", K_LIFT, 0.05, 0.30), ("gain", K_GAIN, 0.65, 0.95)):
        m = neutral & (y > lo) & (y < hi)
        if warm or night or m.mean() < 0.01:
            continue
        ym = float(y[m].mean())
        v = -np.array([cb[m].mean(), cr[m].mean()]) / max(kk * ((1 - ym) if wheel == "lift" else ym), 1e-3) * 0.4
        n = float(np.hypot(*v))
        if n > 0.08:
            v *= 0.08 / n
        g[wheel]["x"], g[wheel]["y"] = round(float(v[0]), 4), round(float(v[1]), 4)

    # ── zones: each one measured on the current render ────────────────────
    if masks:
        c = sim(g)
        y = c @ LUMA
        person = masks["person"]
        y_land = wmean(y, 1 - sky) if cov["sky"] < 0.97 else 0.5

        if cov["sky"] > 0.04:
            def sky_stats(col):
                m = (col * sky[:, None]).sum(axis=0) / max(sky.sum(), 1e-6)
                return float(m @ LUMA), float((m.max() - m.min()) / max(m.max(), 1e-6)), m
            ys, sat_s, srgb = sky_stats(c)
            nd = copy.deepcopy(g)
            nd["dehaze"] = 0.0
            ys_nd, sat_nd, _ = sky_stats(sim(nd))                      # the sky before dehazing
            blue = srgb[2] > srgb[0] * 1.08
            # where the sky should sit: a touch deeper than it was, never darker than the target
            y_goal = ys_nd - float(np.clip((ys_nd - T["sky_luma"]) * 0.5, 0, 0.08)) * strength
            s_goal = min(sat_nd * (1.10 if blue else 1.04), max(sat_nd, 0.58))
            g["locals"].append(_auto_layer(
                "sky",
                exposure=np.clip(2.2 * math.log2(max(y_goal, 0.02) / max(ys, 0.02)), -0.5, 0.4),
                highlights=-np.clip((y_goal - 0.62) * 80, 0, 25),
                sat=float(np.clip(50 * s_goal / max(sat_s, 0.02), 30, 56)),
                contrast=1.03, clarity=6 * strength))
        if cov["person"] > 0.01:
            yp = wmean(y, person)
            g["locals"].append(_auto_layer(
                "person",
                exposure=np.clip((0.46 - yp) * 1.5, -0.15, 0.7 if not night else 0.25),
                shadows=12, temp=0 if warm else 3,
                clarity=-g["clarity"] * 0.8 - 4))                      # keep skin smooth
        if cov["vegetation"] > 0.08:
            yv = wmean(y, masks["vegetation"])
            g["locals"].append(_auto_layer(
                "vegetation", sat=50 + 6 * strength, exposure=np.clip((0.33 - yv) * 1.2, 0, 0.35),
                shadows=np.clip((0.3 - yv) * 120, 0, 25)))
        if cov["water"] > 0.05:
            g["locals"].append(_auto_layer("water", sat=50 + 7 * strength, clarity=10 * strength, contrast=1.05))
        if cov["ground"] > 0.10:
            yg = wmean(y, masks["ground"])
            g["locals"].append(_auto_layer(
                "ground", clarity=8 * strength, exposure=np.clip((0.38 - yg) * 1.2, 0, 0.4),
                shadows=np.clip((0.33 - yg) * 120, 0, 25)))
        fg = masks["foreground"] * (1 - person)
        if 0.08 < float(fg.mean()) < 0.7 and len(g["locals"]) < MAX_LOCALS:
            d = y_land - wmean(y, fg)
            if d > 0.10:                                               # backlit foreground
                g["locals"].append(_auto_layer(
                    "foreground", exposure=np.clip(d * 1.4, 0, 0.5), shadows=15))
        g["locals"] = [l for l in g["locals"] if local_effective(l)][:MAX_LOCALS]
        settle(2)                                                      # zones moved the tones a little

    clip0 = float((y0 > 0.985).mean())
    for _ in range(6):
        if float(((sim(g) @ LUMA) > 0.985).mean()) - clip0 < 0.012:
            break
        g["gain"]["m"] = max(0.95, g["gain"]["m"] - 0.03)
        g["highlights"] = max(-40.0, g["highlights"] - 6)

    for wheel in ("lift", "gain", "gamma"):
        g[wheel]["m"] = round(g[wheel]["m"], 4)
    out = {k: g[k] for k in ("temp", "tint", "shadows", "highlights", "clarity", "dehaze", "sharpen",
                             "boost", "lift", "gamma", "gain", "locals")}
    out["contrast"] = 1.0
    out["curves"] = {"y": g["curves"]["y"]}
    out["scene"] = scene
    out["auto_info"] = {"haze": round(haze, 3), "local_contrast": round(lc, 4), "fine": round(fine, 4),
                        "chroma": round(chroma, 3), "med": round(med0, 3), "p90": round(p90_0, 3),
                        "sky": round(cov.get("sky", 0.0), 3), "person": round(cov.get("person", 0.0), 3),
                        "warm": round(min(warm_ratio, 3.0), 3),
                        "cov": {k: round(v, 3) for k, v in cov.items()}}
    return out
