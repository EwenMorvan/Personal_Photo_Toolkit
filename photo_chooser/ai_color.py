"""
PhotoChooser – learned colour enhancement ("Couleur IA").

Model: Image-Adaptive 3D LUT (Zeng et al., TPAMI 2020, Apache-2.0,
https://github.com/HuiZeng/Image-Adaptive-3DLUT), sRGB weights trained on the
MIT-Adobe FiveK dataset (photos retouched by a professional, "expert C").

A tiny CNN looks at the photo and predicts 3 weights; the result is a blend of
3 learned basis 3D LUTs → one 33³ LUT per photo, applied by the normal grading
pipeline (GPU preview and numpy export). The network is small enough to run in
plain numpy: no torch / onnx needed at runtime.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

_BASE = Path(getattr(sys, "_MEIPASS", Path(__file__).parent))
WEIGHTS = _BASE / "assets" / "ai_color.npz"
LUT_SIZE = 33

_model = None


def available() -> bool:
    return WEIGHTS.exists()


def _load():
    global _model
    if _model is None:
        d = np.load(WEIGHTS)
        _model = {k: d[k] for k in d.files}
    return _model


def _conv(x: np.ndarray, w: np.ndarray, b: np.ndarray, stride: int, pad: int) -> np.ndarray:
    """x: (C, H, W), w: (O, C, k, k) → (O, H', W')"""
    o, c, k, _ = w.shape
    if pad:
        x = np.pad(x, ((0, 0), (pad, pad), (pad, pad)))
    win = np.lib.stride_tricks.sliding_window_view(x, (k, k), axis=(1, 2))[:, ::stride, ::stride]
    return np.tensordot(w, win, axes=([1, 2, 3], [0, 3, 4])) + b[:, None, None]


def _leaky(x):
    return np.where(x > 0, x, 0.2 * x)


def _inorm(x, g, b):
    m = x.mean(axis=(1, 2), keepdims=True)
    v = x.var(axis=(1, 2), keepdims=True)
    return (x - m) / np.sqrt(v + 1e-5) * g[:, None, None] + b[:, None, None]


def predict_weights(img: Image.Image) -> np.ndarray:
    """The 3 blending weights of the basis LUTs for this photo."""
    M = _load()
    x = np.asarray(img.convert("RGB").resize((256, 256), Image.Resampling.BILINEAR), np.float32)
    x = x.transpose(2, 0, 1) / 255.0
    for i, norm in ((0, True), (1, True), (2, True), (3, True), (4, False)):
        x = _leaky(_conv(x, M[f"w{i}"], M[f"b{i}"], 2, 1))
        if norm:
            x = _inorm(x, M[f"g{i}"], M[f"n{i}"])
    return _conv(x, M["w5"], M["b5"], 1, 0).reshape(3).astype(np.float32)


def predict_lut(img: Image.Image) -> np.ndarray:
    """Per-photo LUT, float32 (33, 33, 33, 3) indexed [b, g, r] (same layout as .cube data)."""
    w = predict_weights(img)
    return np.tensordot(w, _load()["luts"], axes=(0, 0)).astype(np.float32)
