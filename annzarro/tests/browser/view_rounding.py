"""The rule that rounds a kept view, as the tests state it (static/js/utils/view-rounding.js).

A zoom is kept to 4 significant digits of its span, a 3D camera's eye and center to 4 significant
digits of the eye's distance from the center, its up vector to 4 decimals. A test that compares
what the app kept with what the plot showed rounds the shown value with these functions and then
compares exactly (to float epsilon), not with a looser tolerance.
"""
import math


def round_range(rng):
    lo, hi = min(rng), max(rng)
    span = hi - lo
    if not span > 0:
        return list(rng)
    step = 10 ** (math.floor(math.log10(span)) - 3)
    a, b = (float(f"{round(v / step) * step:.12g}") for v in (lo, hi))
    out = [a, b] if a < b else [lo, hi]
    return out if rng[0] <= rng[1] else out[::-1]


def _snap(v, step):
    return float(f"{round(v / step) * step:.12g}")


def round_camera(cam):
    eye, center, up = cam["eye"], cam["center"], cam["up"]
    d = math.sqrt(sum((eye[k] - center[k]) ** 2 for k in "xyz"))
    step = 10 ** (math.floor(math.log10(d)) - 3) if d > 0 else 1e-3
    return {"eye": {k: _snap(eye[k], step) for k in "xyz"},
            "center": {k: _snap(center[k], step) for k in "xyz"},
            "up": {k: _snap(up[k], 1e-4) for k in "xyz"}}
