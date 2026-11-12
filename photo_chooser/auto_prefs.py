"""
PhotoChooser – the automatic enhancement learns the user's taste.

Every time a photo is saved from the editor after "Auto", the difference between what
the solver proposed (grade["auto_ref"]) and what the user ended up with is stored as a
sample: (scene, image features) → parameter deltas. The next Auto adds the deltas of
the most similar photos (kernel-weighted average, shrunk towards zero while there are
few samples), so it converges towards how this user finishes this kind of photo.
"""
import json
import math
import os
import threading
from pathlib import Path

SCALARS = ("exposure", "contrast", "shadows", "highlights", "boost", "sat", "temp", "tint",
           "clarity", "dehaze", "sharpen")
WHEELS = ("lift", "gamma", "gain")
ZONES = ("sky", "person", "foreground", "ground", "vegetation", "water")

# allowed range of each learnable value after correction
LIMITS = {
    "exposure": (-1.5, 1.5), "contrast": (0.8, 1.3), "shadows": (-50, 60), "highlights": (-60, 40),
    "boost": (-40, 45), "sat": (30, 65), "temp": (-25, 25), "tint": (-20, 20),
    "clarity": (-10, 35), "dehaze": (0, 70), "sharpen": (0, 100),
    "lift.m": (-0.08, 0.05), "gamma.m": (-0.1, 0.18), "gain.m": (0.9, 1.25),
}
# a change smaller than this is not a deliberate retouch
NOISE = {"exposure": 0.03, "contrast": 0.01, "shadows": 1.5, "highlights": 1.5, "boost": 1.5, "sat": 0.8,
         "temp": 1, "tint": 1, "clarity": 1, "dehaze": 1.5, "sharpen": 2,
         "lift.m": 0.004, "gamma.m": 0.006, "gain.m": 0.01}
FEATURE_SCALE = {"med": 0.15, "p90": 0.2, "haze": 0.12, "chroma": 0.12, "local_contrast": 0.03,
                 "sky": 0.25, "person": 0.1, "warm": 0.3}
SIGMA, SHRINK, OTHER_SCENE = 1.5, 1.2, 0.35
MAX_SAMPLES = 400

_lock = threading.Lock()


def grade_vector(g: dict) -> dict:
    """The learnable numbers of a (normalised) grade."""
    v = {k: float(g[k]) for k in SCALARS}
    for w in WHEELS:
        v[w + ".m"] = float(g[w]["m"])
    for mask in ZONES:
        l = next((l for l in g.get("locals") or [] if l.get("mask") == mask and l.get("on", True)), None)
        amt = (l.get("amount", 100) / 100.0) if l else 0.0
        v[mask + ".exposure"] = float(l["exposure"]) * amt if l else 0.0
        if mask == "sky":
            v["sky.sat"] = (float(l["sat"]) - 50) * amt if l else 0.0
    return v


def _dist(fa: dict, fb: dict) -> float:
    return math.sqrt(sum(((fa.get(k, 0) - fb.get(k, 0)) / s) ** 2 for k, s in FEATURE_SCALE.items()))


class AutoPrefs:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.samples = {}
        try:
            self.samples = json.loads(self.path.read_text(encoding="utf-8")).get("samples", {})
        except Exception:
            pass

    def _save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"version": 1, "samples": self.samples}, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, self.path)

    def count(self) -> int:
        return sum(1 for s in self.samples.values() if s.get("w", 0) >= 0.5)

    def clear(self):
        with _lock:
            self.samples = {}
            self._save()

    def forget(self, key: str):
        with _lock:
            if self.samples.pop(key, None) is not None:
                self._save()

    def record(self, key: str, auto_ref: dict, final_vector: dict, weight: float | None = None):
        """auto_ref: {"v": solver vector, "f": features, "scene": str}"""
        raw = auto_ref.get("v") or {}
        delta = {}
        for k, v in final_vector.items():
            d = v - raw.get(k, 0.0)
            if abs(d) > NOISE.get(k, 0.04 if k.endswith(".exposure") else 1.0):
                delta[k] = round(d, 4)
        # left exactly as proposed: a (weak) approval, not a deliberate retouch
        proposed = auto_ref.get("o") or raw
        tol = lambda k: NOISE.get(k, 0.04 if k.endswith(".exposure") else 1.0)
        untouched = all(abs(v - proposed.get(k, 0.0)) <= tol(k) for k, v in final_vector.items())
        with _lock:
            self.samples[key] = {"scene": auto_ref.get("scene"), "f": auto_ref.get("f") or {},
                                 "d": delta, "w": weight if weight is not None else (0.25 if untouched else 1.0)}
            if len(self.samples) > MAX_SAMPLES:
                for old in list(self.samples)[: len(self.samples) - MAX_SAMPLES]:
                    del self.samples[old]
            self._save()

    def predict(self, features: dict, scene: str, exclude: str | None = None) -> tuple[dict, float]:
        """Returns (deltas to add to the solver's result, effective number of similar samples)."""
        acc, total = {}, 0.0
        for key, s in self.samples.items():
            if key == exclude:
                continue
            w = s.get("w", 1.0) * math.exp(-_dist(features, s.get("f", {})) ** 2 / (2 * SIGMA ** 2))
            if s.get("scene") != scene:
                w *= OTHER_SCENE
            if w < 1e-3:
                continue
            total += w
            for k, d in s.get("d", {}).items():
                acc[k] = acc.get(k, 0.0) + w * d
        if not total:
            return {}, 0.0
        return {k: v / (total + SHRINK) for k, v in acc.items()}, total


def apply_delta(g: dict, delta: dict, make_zone=None, coverage: dict | None = None) -> dict:
    """Add learned deltas to a grade (in place). make_zone(mask) builds a neutral zone layer."""
    for k, d in delta.items():
        if k in SCALARS:
            lo, hi = LIMITS[k]
            g[k] = round(min(hi, max(lo, g[k] + d)), 3)
        elif k.endswith(".m"):
            lo, hi = LIMITS[k]
            w = k[:-2]
            g[w]["m"] = round(min(hi, max(lo, g[w]["m"] + d)), 4)
        else:
            mask, field = k.split(".")
            l = next((l for l in g["locals"] if l.get("mask") == mask), None)
            if l is None:
                enough = (coverage or {}).get(mask, 0) > 0.05
                if not (make_zone and enough and field == "exposure" and abs(d) > 0.06):
                    continue
                l = make_zone(mask)
                g["locals"].append(l)
            if field == "exposure":
                l["exposure"] = round(min(0.9, max(-0.9, l["exposure"] + d)), 3)
            elif field == "sat":
                l["sat"] = round(min(68, max(30, l["sat"] + d)), 2)
    return g
