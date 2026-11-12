"""
PhotoChooser – AI masks (sky, people, vegetation, water, ground, buildings,
foreground / background) and auxiliary maps (local-contrast base, haze map).

Runs on CPU with ONNX Runtime:
  * SegFormer-B2 / ADE20K   → semantic classes
  * Depth-Anything-V2 Small → relative depth (foreground / background)
Models are downloaded once into MODELS_DIR.

All maps are computed in the *upright source frame* (before crop / rotation);
grading.py and the WebGL shader sample them with the photo's own coordinates.
"""
import os
import threading
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

MODELS_DIR = Path(os.environ.get("PHOTOCHOOSER_MODELS")
                  or Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "PhotoChooser" / "models")

MODELS = {
    "seg": {
        "file": "segformer_b2_ade.onnx", "size": 110_445_327, "label": "Segmentation (ciel, personnes…)",
        "url": "https://huggingface.co/Xenova/segformer-b2-finetuned-ade-512-512/resolve/main/onnx/model.onnx",
    },
    "depth": {
        "file": "depth_anything_v2_small.onnx", "size": 99_060_839, "label": "Profondeur (plans)",
        "url": "https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model.onnx",
    },
}

# Order = channel index in the mask stack (2 RGBA textures on the GPU side)
MASK_NAMES = ["sky", "person", "vegetation", "water", "ground", "building", "foreground", "background"]

ADE = ["wall", "building", "sky", "floor", "tree", "ceiling", "road", "bed", "windowpane", "grass", "cabinet", "sidewalk", "person", "earth", "door", "table", "mountain", "plant", "curtain", "chair", "car", "water", "painting", "sofa", "shelf", "house", "sea", "mirror", "rug", "field", "armchair", "seat", "fence", "desk", "rock", "wardrobe", "lamp", "bathtub", "railing", "cushion", "base", "box", "column", "signboard", "chest of drawers", "counter", "sand", "sink", "skyscraper", "fireplace", "refrigerator", "grandstand", "path", "stairs", "runway", "case", "pool table", "pillow", "screen door", "stairway", "river", "bridge", "bookcase", "blind", "coffee table", "toilet", "flower", "book", "hill", "bench", "countertop", "stove", "palm", "kitchen island", "computer", "swivel chair", "boat", "bar", "arcade machine", "hovel", "bus", "towel", "light", "truck", "tower", "chandelier", "awning", "streetlight", "booth", "television receiver", "airplane", "dirt track", "apparel", "pole", "land", "bannister", "escalator", "ottoman", "bottle", "buffet", "poster", "stage", "van", "ship", "fountain", "conveyer belt", "canopy", "washer", "plaything", "swimming pool", "stool", "barrel", "basket", "waterfall", "tent", "bag", "minibike", "cradle", "oven", "ball", "food", "step", "tank", "trade name", "microwave", "pot", "animal", "bicycle", "lake", "dishwasher", "screen", "blanket", "sculpture", "hood", "sconce", "vase", "traffic light", "tray", "ashcan", "fan", "pier", "crt screen", "plate", "monitor", "bulletin board", "shower", "radiator", "glass", "clock", "flag"]

GROUPS = {
    "sky":        ["sky"],
    "person":     ["person"],
    "vegetation": ["tree", "grass", "plant", "field", "palm", "flower"],
    "water":      ["water", "sea", "river", "lake", "swimming pool", "waterfall"],
    "ground":     ["mountain", "rock", "earth", "sand", "hill", "land", "road", "path", "dirt track", "sidewalk"],
    "building":   ["building", "house", "skyscraper", "wall", "tower", "bridge", "hovel", "fence", "column"],
}
GROUP_IDX = {g: [ADE.index(n) for n in names] for g, names in GROUPS.items()}

MASK_SIZE = 1024      # long side of the AI masks
AUX_SIZE = 512        # long side of the blur / haze maps
MEAN = np.array([0.485, 0.456, 0.406], np.float32)
STD = np.array([0.229, 0.224, 0.225], np.float32)

_sessions: dict = {}
_infer_lock = threading.Lock()
_download = {"active": False, "done": 0, "total": 0, "error": None}

try:
    import onnxruntime as ort
    RUNTIME = True
except Exception:           # pragma: no cover
    ort = None
    RUNTIME = False


# ── Models ───────────────────────────────────────────────────────────────────

def model_path(key: str) -> Path:
    return MODELS_DIR / MODELS[key]["file"]


def model_ready(key: str) -> bool:
    p = model_path(key)
    return p.exists() and p.stat().st_size == MODELS[key]["size"]


def available() -> bool:
    return RUNTIME and all(model_ready(k) for k in MODELS)


def status() -> dict:
    return {
        "runtime": RUNTIME,
        "ready": available(),
        "models": {k: {"ready": model_ready(k), "size": m["size"], "label": m["label"]} for k, m in MODELS.items()},
        "total_size": sum(m["size"] for k, m in MODELS.items() if not model_ready(k)),
        "download": dict(_download),
        "dir": str(MODELS_DIR),
    }


def _download_all():
    try:
        MODELS_DIR.mkdir(parents=True, exist_ok=True)
        todo = [k for k in MODELS if not model_ready(k)]
        _download.update(done=0, total=sum(MODELS[k]["size"] for k in todo), error=None)
        for k in todo:
            dst = model_path(k)
            tmp = dst.with_suffix(".part")
            req = urllib.request.Request(MODELS[k]["url"], headers={"User-Agent": "PhotoChooser"})
            with urllib.request.urlopen(req, timeout=60) as r, open(tmp, "wb") as f:
                while True:
                    chunk = r.read(1 << 20)
                    if not chunk:
                        break
                    f.write(chunk)
                    _download["done"] += len(chunk)
            if tmp.stat().st_size != MODELS[k]["size"]:
                tmp.unlink(missing_ok=True)
                raise IOError(f"téléchargement incomplet ({MODELS[k]['file']})")
            os.replace(tmp, dst)
    except Exception as e:
        _download["error"] = str(e)
    finally:
        _download["active"] = False


def start_download() -> bool:
    if _download["active"] or available():
        return False
    _download.update(active=True, done=0, total=0, error=None)
    threading.Thread(target=_download_all, daemon=True).start()
    return True


def _session(key: str):
    if key not in _sessions:
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = max(1, (os.cpu_count() or 4) - 1)
        _sessions[key] = ort.InferenceSession(str(model_path(key)), opts, providers=["CPUExecutionProvider"])
    return _sessions[key]


# ── Image helpers ────────────────────────────────────────────────────────────

def _fit(size, long_side, multiple=1):
    w, h = size
    k = long_side / max(w, h)
    nw, nh = max(multiple, round(w * k / multiple) * multiple), max(multiple, round(h * k / multiple) * multiple)
    return int(nw), int(nh)


def _prep(img: Image.Image, size) -> np.ndarray:
    a = np.asarray(img.resize(size, Image.Resampling.BICUBIC), np.float32) / 255.0
    return ((a - MEAN) / STD).transpose(2, 0, 1)[None].astype(np.float32)


def _resize_f(a: np.ndarray, size) -> np.ndarray:
    """Bilinear resize of a float (H, W) map."""
    return np.asarray(Image.fromarray(a.astype(np.float32), "F").resize(size, Image.Resampling.BILINEAR), np.float32)


def _box(a: np.ndarray, r: int) -> np.ndarray:
    """Mean filter of radius r (edge-replicated), O(1) per pixel."""
    p = np.pad(a, r, mode="edge").astype(np.float64)
    c = np.cumsum(np.cumsum(p, 0), 1)
    c = np.pad(c, ((1, 0), (1, 0)))
    k = 2 * r + 1
    s = c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]
    return (s / (k * k)).astype(np.float32)


def guided_filter(guide: np.ndarray, src: np.ndarray, r: int, eps: float) -> np.ndarray:
    """Edge-aware smoothing of src following the edges of guide (He et al.)."""
    mi, mp = _box(guide, r), _box(src, r)
    cov = _box(guide * src, r) - mi * mp
    var = _box(guide * guide, r) - mi * mi
    a = cov / (var + eps)
    b = mp - a * mi
    return _box(a, r) * guide + _box(b, r)


def _smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


# ── Masks ────────────────────────────────────────────────────────────────────

def compute_masks(img: Image.Image) -> np.ndarray:
    """img: upright RGB. Returns uint8 (H, W, 8) stack, long side = MASK_SIZE."""
    img = img.convert("RGB")
    out_size = _fit(img.size, min(MASK_SIZE, max(img.size)))
    W, H = out_size
    small = img.resize(out_size, Image.Resampling.LANCZOS)
    guide = np.asarray(small.convert("L"), np.float32) / 255.0

    with _infer_lock:
        seg = _session("seg")
        x = _prep(img, _fit(img.size, 640, 32))
        logits = seg.run(None, {seg.get_inputs()[0].name: x})[0][0]         # (150, h, w)
        dep = _session("depth")
        x = _prep(img, _fit(img.size, 518, 14))
        depth = dep.run(None, {dep.get_inputs()[0].name: x})[0]
        depth = depth.reshape(depth.shape[-2], depth.shape[-1])

    logits = logits - logits.max(axis=0, keepdims=True)
    prob = np.exp(logits)
    prob /= prob.sum(axis=0, keepdims=True)

    stack = np.zeros((H, W, len(MASK_NAMES)), np.uint8)
    r = max(4, round(max(W, H) / 90))
    for i, name in enumerate(MASK_NAMES[:6]):
        m = _resize_f(prob[GROUP_IDX[name]].sum(axis=0), out_size)
        if m.max() < 0.2:
            continue
        m = guided_filter(guide, m, r, 2e-3)
        # firm up the soft probability so the mask is clean but keeps a feathered edge
        stack[..., i] = (_smoothstep(0.25, 0.75, m) * 255 + 0.5).astype(np.uint8)

    # relative depth (higher = closer) → foreground / background
    lo, hi = np.percentile(depth, [2, 98])
    d = np.clip((depth - lo) / max(hi - lo, 1e-6), 0, 1)
    d = np.clip(guided_filter(guide, _resize_f(d, out_size), r * 2, 4e-3), 0, 1)
    stack[..., 6] = (_smoothstep(0.45, 0.70, d) * 255 + 0.5).astype(np.uint8)
    stack[..., 7] = ((1 - _smoothstep(0.20, 0.45, d)) * 255 + 0.5).astype(np.uint8)
    return stack


def coverage(stack: np.ndarray) -> dict:
    return {n: round(float(stack[..., i].mean() / 255.0), 4) for i, n in enumerate(MASK_NAMES)}


# ── Auxiliary maps (no AI needed) ────────────────────────────────────────────

def compute_aux(img: Image.Image) -> tuple[np.ndarray, list]:
    """Returns (uint8 (H, W, 2): [blurred luma, haze transmission], airlight RGB 0..1)."""
    img = img.convert("RGB")
    size = _fit(img.size, min(AUX_SIZE, max(img.size)))
    small = img.resize(size, Image.Resampling.LANCZOS)
    a = np.asarray(small, np.float32) / 255.0
    luma = a @ np.array([0.2126, 0.7152, 0.0722], np.float32)

    # local-contrast base: wide gaussian of the luma
    radius = max(size) * 0.035
    blur = np.asarray(Image.fromarray((luma * 255 + 0.5).astype(np.uint8), "L")
                      .filter(ImageFilter.GaussianBlur(radius)), np.float32) / 255.0

    # haze: dark-channel prior, refined along the image edges
    dark = Image.fromarray((a.min(axis=2) * 255).astype(np.uint8), "L").filter(ImageFilter.MinFilter(9))
    dark = np.asarray(dark, np.float32) / 255.0
    n = max(10, dark.size // 500)
    idx = np.argpartition(dark.ravel(), -n)[-n:]
    air = np.clip(a.reshape(-1, 3)[idx].mean(axis=0), 0.5, 1.0)
    t = 1.0 - 0.9 * np.asarray(Image.fromarray(((a / air).min(axis=2).clip(0, 1) * 255).astype(np.uint8), "L")
                               .filter(ImageFilter.MinFilter(9)), np.float32) / 255.0
    t = np.clip(guided_filter(luma, t, max(4, max(size) // 40), 1e-3), 0.1, 1.0)

    aux = np.stack([blur, t], axis=2)
    return (aux * 255 + 0.5).astype(np.uint8), [round(float(v), 4) for v in air]


# ── Classification (same model as the masks: no extra download, no PyTorch) ──

CLASS_GROUPS = {
    "person": ["person"],
    "animal": ["animal"],
    "food": ["food", "plate", "tray"],
    "sea": ["sea", "water", "river", "lake", "swimming pool", "waterfall", "sand", "boat", "ship"],
    "mountain": ["mountain", "rock", "hill"],
    "forest": ["tree", "plant", "palm"],
    "field": ["grass", "field", "earth", "land", "path", "dirt track", "flower"],
    "street": ["road", "sidewalk", "car", "bus", "truck", "van", "streetlight", "traffic light", "signboard", "minibike", "bicycle"],
    "built": ["building", "house", "skyscraper", "tower", "bridge", "column", "hovel", "fence", "stairs", "stairway"],
    "indoor": ["wall", "floor", "ceiling", "bed", "cabinet", "table", "chair", "sofa", "shelf", "curtain", "desk", "lamp",
               "armchair", "seat", "wardrobe", "cushion", "counter", "sink", "refrigerator", "bookcase", "coffee table",
               "countertop", "stove", "kitchen island", "computer", "television receiver", "door", "windowpane", "rug",
               "painting", "mirror", "bathtub", "toilet", "pillow", "chest of drawers", "blanket", "screen", "monitor"],
    "sky": ["sky"],
}
_CLASS_IDX = {g: [ADE.index(n) for n in names if n in ADE] for g, names in CLASS_GROUPS.items()}


def classify(img: Image.Image) -> str | None:
    """One of the app's categories (landscape, sea, mountain, person, city, forest, snow,
    sunset, indoor, food, animal, architecture), or None when nothing stands out."""
    img = img.convert("RGB")
    with _infer_lock:
        seg = _session("seg")
        logits = seg.run(None, {seg.get_inputs()[0].name: _prep(img, _fit(img.size, 512, 32))})[0][0]
    labels = logits.argmax(axis=0)
    counts = np.bincount(labels.ravel(), minlength=len(ADE)) / labels.size
    f = {g: float(counts[idx].sum()) for g, idx in _CLASS_IDX.items()}

    small = np.asarray(img.resize((labels.shape[1], labels.shape[0]), Image.Resampling.BILINEAR), np.float32) / 255.0
    luma = small @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    spread = small.max(axis=2) - small.min(axis=2)
    sky = labels == ADE.index("sky")
    land = ~sky

    if f["person"] > 0.12:
        return "person"
    if f["animal"] > 0.06:
        return "animal"
    if f["food"] > 0.10:
        return "food"
    if f["indoor"] > 0.50:
        return "indoor"
    if sky.mean() > 0.08:                                   # warm, glowing sky
        hot = sky & (small[..., 0] > small[..., 2] * 1.15) & (spread > 0.15)
        if hot.sum() > 0.12 * sky.sum():
            return "sunset"
    if land.mean() > 0.3 and float(((luma > 0.75) & (spread < 0.10) & land).sum() / land.sum()) > 0.35 \
            and f["mountain"] + f["field"] + f["forest"] > 0.25:
        return "snow"
    if f["sea"] > 0.15:
        return "sea"
    if f["built"] > 0.40 and f["street"] < 0.10:
        return "architecture"
    if f["built"] + f["street"] > 0.35:
        return "city"
    if f["forest"] > 0.40:
        return "forest"
    if f["mountain"] > 0.25:
        return "mountain"
    if f["sky"] + f["field"] + f["mountain"] + f["forest"] > 0.5:
        return "landscape"
    return None
