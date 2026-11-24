"""The cost limits of a computation: when a request is asked about first, when it is refused, and how large a
grouping, a matrix, a grid or a browser-side drawing may get.

Each limit is a setting under ``limits:`` in the configuration file and a policy key ``limits.<name>`` an admin can
change on the Settings page (server/limits.py declares them). A value in the configuration file is a ceiling: the
admin may lower it, not raise it. With nothing set there, the admin may set anything within the bounds below.

The server resolves the limits once per request (``use``) and the code here reads them with ``get``; outside a
request (tests, the command line) a limit is its default. The browser reads the same values from
``/api/v1/policy/effective`` (static/js/utils/limits.js); ``static/js/limits-defaults.json`` holds the defaults for a
server that sends none, written from this table by ``write_browser_defaults`` (a test fails when it is stale).

The upper bounds are ten times the default, provisional until each is measured at its maximum (``partitionings``
stops at the default of ``request_partitionings``, which it may not pass); the group, level and
grid bounds also stay below the 16-bit group codes (65,533 usable values), and ``grid_sets`` cannot rise above 16
(a cell's sets are a 16-bit mask).
"""
import contextlib
import contextvars
import json
import os
from dataclasses import dataclass
from typing import Any, Dict, List, Mapping, Optional

#: The time tiers, in the order they must keep: ``live_update_s <= ask_first_s <= refuse_s``.
TIME_ORDER = ("live_update_s", "ask_first_s", "refuse_s")


@dataclass(frozen=True)
class CostLimit:
    name: str
    default: Any
    minimum: float
    maximum: float
    integer: bool
    enforced: str          # "server" | "browser" | "both"
    kind: str              # "safety": protects the server or the tab | "ux": when to ask or show
    group: str             # the Settings page's sub-group: "time" | "grouping" | "browser" (GROUPS)
    label: str
    help: str


#: The Settings page's headings of the groups, in order
GROUPS = {"time": "When to ask and refuse", "grouping": "Groupings, matrices and grids",
          "browser": "Drawn and exported in the browser"}


def _limit(name, default, maximum, *, minimum=1, integer=True, enforced="server", kind="safety", group="grouping",
           label, help):
    return CostLimit(name, default, minimum, maximum, integer, enforced, kind, group, label, help)


COST_LIMITS: Dict[str, CostLimit] = {c.name: c for c in (
    _limit("ask_first_s", 60.0, 600.0, minimum=0, integer=False, enforced="both", kind="ux", group="time",
           label="Ask first above (s)",
           help="Estimated seconds above which a gene score, a grouping or a Cell-Gene read asks before it runs "
                "(it then runs once the user agrees). Never above refuse_s."),
    _limit("refuse_s", 600.0, 6000.0, minimum=0, integer=False, enforced="server", group="time",
           label="Refuse above (s)",
           help="Estimated seconds above which a gene score, a grouping or a Cell-Gene read is refused, "
                "even when the user agrees. Bounds the time one request may hold a compute slot."),
    _limit("live_update_s", 5.0, 50.0, minimum=0, integer=False, enforced="both", group="time",
           label="Live update below (s)",
           help="Estimated seconds below which a computation updates live while it is edited and runs in the light "
                "lane; above it, edits wait for Update. Never above ask_first_s."),
    _limit("progress_bar_s", 10.0, 100.0, minimum=0, integer=False, enforced="browser", kind="ux", group="time",
           label="Progress bar after (s)",
           help="Seconds (estimated, or waited so far) after which a computation shows a progress bar."),
    _limit("refresh_min_interval_large_s", 60.0, 600.0, minimum=0, integer=False, enforced="server", group="time",
           label="Refresh interval, large datasets (s)",
           help="Seconds between two Refreshes of one dataset with more cells than refresh_large_cells, for a user "
                "who is not an admin on a shared server (an admin keeps server.refresh_min_interval_s). Every "
                "Refresh makes every user read the dataset again, so this bounds how often one user can do that "
                "to a large one. A Refresh inside it is scheduled for the end of the interval, not refused."),
    _limit("refresh_large_cells", 10_000_000, 100_000_000, enforced="server", group="time",
           label="Large dataset for Refresh (cells)",
           help="Cells above which a dataset counts as large for refresh_min_interval_large_s."),
    _limit("matrix_values", 400_000, 4_000_000, enforced="both",
           label="Cell-Gene matrix values",
           help="Most values one Cell-Gene matrix or grouping request may hold: groups x genes and measures on the "
                "server, groups x drawn rows in the browser."),
    _limit("genes_per_section", 2_000, 20_000, enforced="browser", group="browser", kind="ux",
           label="Genes per Cell-Gene section",
           help="Most genes one section of a Cell-Gene Plot draws."),
    _limit("groups", 2_000, 20_000, minimum=2, enforced="both",
           label="Groups per grouping",
           help="Most levels one partitioning may make and most groups one grouping may have; a larger one is "
                "refused with too_many_groups or too_many_levels."),
    _limit("partitionings", 8, 64, enforced="both",
           label="Partitionings per grouping",
           help="Most partitionings one grouping combines. Never above request_partitionings."),
    _limit("request_partitionings", 64, 640,
           label="Partitionings per request",
           help="Most partitionings one grouping request holds, groupings used as sources included."),
    _limit("measures", 16, 160,
           label="Measures per request",
           help="Most measures (numeric summaries) one grouping request computes."),
    _limit("thresholds", 4, 40,
           label="Thresholds per gene",
           help="Most detection thresholds one gene or source is compared with in one request."),
    _limit("grid_cells", 2_097_152, 20_971_520, enforced="both",
           label="Count plot grid cells",
           help="Most cells of a count plot grid (and values a grid measure accumulates: 40 bytes each)."),
    _limit("grid_2d_bins", 512, 5_120, minimum=2,
           label="2D grid bins per axis",
           help="Most bins on the x and on the y axis of a 2D count plot."),
    _limit("grid_2d_split", 8, 80,
           label="2D grid split levels",
           help="Most levels of the third (split) axis of a 2D count plot."),
    _limit("grid_1d_bins", 2_000, 20_000, minimum=2,
           label="1D grid bins",
           help="Most bins on the x axis of a 1D count plot."),
    _limit("grid_1d_split", 200, 2_000,
           label="1D grid split levels",
           help="Most levels of the split axis of a 1D count plot."),
    _limit("grid_categorical_levels", 200, 2_000,
           label="Categorical grid levels per axis",
           help="Most levels on the x and on the y axis of a categorical count plot."),
    _limit("grid_sets", 16, 16, minimum=2,
           label="Sets per count plot",
           help="Most sets one set count plot compares. 16 is also the most there can be (a cell's sets are a "
                "16-bit mask), so this can only be lowered."),
    _limit("obsp_source_max_cells", 1_000_000, 10_000_000,
           label="Cells for an obsp source",
           help="Most cells a dataset may have for one of its obsp rows to be used as a per-cell source."),
    _limit("cell_export_max", 1_000_000, 10_000_000, enforced="browser", group="browser",
           label="Cells per grouping export",
           help="Most cells a grouping's cell export (CSV) writes; it is built in the browser tab."),
    _limit("bars_3d_max", 40_000, 400_000, enforced="browser", group="browser",
           label="Bars in a 3D view",
           help="Most bars a 3D bar view draws (provisional: WebGL memory of the tab)."),
    _limit("density_points_draw", 1_000_000, 10_000_000, enforced="browser", group="browser",
           label="Cells drawn as density points",
           help="Most cells the Cell points layer of a Cell Count Plot's 2D density draws; above it a seeded "
                "uniform sample of this many is drawn."),
    _limit("density_points_load", 25_000_000, 250_000_000, enforced="browser", group="browser",
           label="Cells loaded for density points",
           help="Most cells whose positions the Cell points layer of a 2D density loads into the browser tab "
                "(about 9 bytes a cell); above it the layer is refused."),
    _limit("dendrogram_rows", 2_000, 20_000, minimum=2, enforced="browser", group="browser",
           label="Rows clustered for a dendrogram",
           help="Most rows (or columns) clustered in the browser for a dendrogram; clustering costs memory and "
                "time in proportion to the square of the rows."),
)}

_current: "contextvars.ContextVar[Optional[Dict[str, Any]]]" = contextvars.ContextVar("annzarro_cost_limits",
                                                                                     default=None)


def defaults() -> Dict[str, Any]:
    return {name: c.default for name, c in COST_LIMITS.items()}


def ordered(values: Mapping[str, Any]) -> Dict[str, Any]:
    """``values`` with the time tiers in order: a live limit above ask_first is ask_first, an ask_first above
    refuse is refuse (the stricter value wins)."""
    out = dict(values)
    refuse = out["refuse_s"]
    out["ask_first_s"] = min(out["ask_first_s"], refuse)
    out["live_update_s"] = min(out["live_update_s"], out["ask_first_s"])
    out["partitionings"] = min(out["partitionings"], out["request_partitionings"])
    return out


def use(values: Optional[Mapping[str, Any]]) -> contextvars.Token:
    """Make ``values`` (every limit, or None for the defaults) the limits of the current request."""
    return _current.set(None if values is None else ordered({**defaults(), **dict(values)}))


def reset(token: contextvars.Token) -> None:
    _current.reset(token)


def snapshot() -> Dict[str, Any]:
    """Every limit as it applies now."""
    current = _current.get()
    return dict(current) if current is not None else defaults()


def get(name: str) -> Any:
    """One limit as it applies now: the request's, else the default."""
    current = _current.get()
    return current[name] if current is not None else COST_LIMITS[name].default


@contextlib.contextmanager
def override(**values):
    """Run the block with ``values`` in place of the limits in force (the rest as they are): for tests and for code
    that runs outside a request."""
    token = use({**snapshot(), **values})
    try:
        yield
    finally:
        reset(token)


def check(values: Mapping[str, Any], where: str = "limits") -> List[str]:
    """Messages for every value of ``values`` (``{name: value}``, absent names are fine) that is not a number within
    its bounds, and for time tiers out of order (the defaults fill the tiers ``values`` does not set)."""
    errors = []
    for name, value in (values or {}).items():
        limit = COST_LIMITS.get(name)
        if limit is None:
            errors.append(f"Unknown setting {where}.{name}")
            continue
        bad = isinstance(value, bool) or not isinstance(value, (int, float)) \
            or (limit.integer and isinstance(value, float) and not value.is_integer()) \
            or not limit.minimum <= value <= limit.maximum
        if bad:
            kind = "a whole number" if limit.integer else "a number"
            errors.append(f"Invalid {where}.{name}: {value!r} (expected {kind} from {limit.minimum:g} to "
                          f"{limit.maximum:g})")
    if errors:
        return errors
    merged = {**defaults(), **dict(values or {})}
    for low, high in zip(TIME_ORDER, TIME_ORDER[1:]):
        if merged[low] > merged[high]:
            errors.append(f"Invalid {where}.{low}: {merged[low]:g} is above {where}.{high} ({merged[high]:g}); "
                          f"live_update_s <= ask_first_s <= refuse_s")
    if merged["partitionings"] > merged["request_partitionings"]:
        errors.append(f"Invalid {where}.partitionings: {merged['partitionings']} is above "
                      f"{where}.request_partitionings ({merged['request_partitionings']})")
    return errors


#: The browser's copy of the defaults (static/js/limits-defaults.json), relative to the package's parent
BROWSER_DEFAULTS = os.path.join("static", "js", "limits-defaults.json")


def browser_defaults_text() -> str:
    """The text of static/js/limits-defaults.json: every limit's default under its policy key name."""
    body = {"_comment": "Generated from annzarro/core/cost_limits.py by `python -m annzarro.core.cost_limits`; "
                        "do not edit.",
            **{f"limits.{name}": c.default for name, c in COST_LIMITS.items()}}
    return json.dumps(body, indent=2) + "\n"


def write_browser_defaults(root: str) -> str:
    path = os.path.join(root, BROWSER_DEFAULTS)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(browser_defaults_text())
    return path


if __name__ == "__main__":   # pragma: no cover
    print(write_browser_defaults(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))
