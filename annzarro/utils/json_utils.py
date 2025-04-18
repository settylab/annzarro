"""
JSON utilities for Annzarro

This module provides functions for converting complex objects to JSON-compatible format,
particularly for handling NumPy arrays and other scientific data types.
"""

import json
import math
from pathlib import Path
from typing import Any, Union
import numpy as np


class NumpyJSONEncoder(json.JSONEncoder):
    """
    Serialize complex types (np.ndarray, np scalar, Path, set, bytes…)
    and turn any NaN/±Inf into None so that your JS never actually sees
    “Infinity” or “NaN” literals in the JSON.
    """
    def iterencode(self, o: Any, _one_shot=False):
        def clean(obj: Any) -> Any:
            # NumPy scalars
            if isinstance(obj, (np.integer,)):
                return int(obj)
            if isinstance(obj, (np.bool_, bool)):
                return bool(obj)
            if isinstance(obj, (np.floating, float)):
                v = float(obj)
                return None if not math.isfinite(v) else v

            # 0‑d arrays
            if isinstance(obj, np.ndarray) and obj.ndim == 0:
                return clean(obj.item())
            # n‑d arrays
            if isinstance(obj, np.ndarray):
                return [clean(x) for x in obj.tolist()]

            # containers
            if isinstance(obj, dict):
                return {k: clean(v) for k, v in obj.items()}
            if isinstance(obj, (list, tuple, set, frozenset)):
                return [clean(x) for x in obj]

            # others
            if isinstance(obj, Path):
                return str(obj)
            if isinstance(obj, (bytes, bytearray)):
                return obj.decode('utf-8', 'replace')

            return obj  # str, int, None, etc.

        cleaned = clean(o)
        # now hand it back to the stdlib to actually write the string
        return super().iterencode(cleaned, _one_shot)


# convenience wrappers
def to_json(obj: Any, **kw):
    return json.dumps(obj, cls=NumpyJSONEncoder, ensure_ascii=False, **kw)

def save_json(obj: Any, path: Union[str, Path], **kw):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(obj, f, cls=NumpyJSONEncoder, ensure_ascii=False, **kw)