"""
Where panel sets are kept
-------------------------

Panel sets are JSON files in one directory. :func:`directory` is the only place that decides
which; every route and admin page asks it.

1. ``server.panel_sets_dir`` set by the operator: that directory. When ``<data_dir>/sessions``
   also holds panel sets, the start-up log warns and points at ``annzarro panel-sets migrate``.
2. Not set, ``<data_dir>/sessions`` holds ``*.json`` and ``<state_dir>/panel-sets`` is absent or
   empty: **legacy mode**. The install keeps using ``<data_dir>/sessions`` until the operator
   copies the sets with ``annzarro panel-sets migrate``. Nothing moves by itself.
3. Otherwise ``<state_dir>/panel-sets``, created 0700 on the first save.

Once the new directory holds a file, rule 3 applies and rule 2 no longer can.
"""

import contextlib
import logging
import os
import shutil
from dataclasses import dataclass
from typing import List, Optional

from annzarro.server import session_store
from annzarro.utils import paths

logger = logging.getLogger(__name__)

LEGACY_NAME = "sessions"
EXPLICIT, LEGACY, STATE = "explicit", "legacy", "state"


@dataclass(frozen=True)
class Location:
    path: str
    mode: str                 # EXPLICIT, LEGACY or STATE
    new_path: str             # where the sets go once copied (state mode and the target of migrate)
    legacy_path: str          # <data_dir>/sessions
    note: Optional[str] = None


def legacy_dir(config) -> str:
    """``<data_dir>/sessions``, where panel sets lived before they had a directory of their own."""
    data_dir = config.get("data_dir") or paths.default_data_dir()
    return os.path.join(os.path.expanduser(str(data_dir)), LEGACY_NAME)


def holds_sets(directory: str) -> bool:
    """Whether ``directory`` holds at least one ``*.json`` file."""
    try:
        with os.scandir(directory) as it:
            return any(e.name.endswith(".json") and e.is_file() for e in it)
    except OSError:
        return False


def _explicit(config) -> bool:
    """Whether the operator named ``panel_sets_dir`` (a derived default does not count)."""
    if not config.get("panel_sets_dir"):
        return False
    origin = (config.get("config_origins") or {}).get("server.panel_sets_dir")
    if origin is not None:
        return not str(origin).startswith("derived:")
    state = config.get("state_dir")
    return not state or os.path.abspath(os.path.expanduser(str(config["panel_sets_dir"]))) != \
        os.path.abspath(os.path.join(os.path.expanduser(str(state)), "panel-sets"))


def _new_dir(config) -> str:
    if config.get("panel_sets_dir"):
        return os.path.abspath(os.path.expanduser(str(config["panel_sets_dir"])))
    state = config.get("state_dir")
    if state:
        return os.path.join(os.path.abspath(os.path.expanduser(str(state))), "panel-sets")
    return str(paths.panel_sets_dir())


def resolve(config) -> Location:
    """The panel-sets directory for ``config`` (the flat server configuration), and why."""
    legacy, new = legacy_dir(config), _new_dir(config)
    if _explicit(config):
        note = None
        if holds_sets(legacy) and os.path.realpath(legacy) != os.path.realpath(new):
            note = (f"panel sets also exist in {legacy}; they are not used. "
                    "Run `annzarro panel-sets migrate` to copy them to " + new)
        return Location(new, EXPLICIT, new, legacy, note)
    if holds_sets(legacy) and not holds_sets(new):
        return Location(legacy, LEGACY, new, legacy,
                        f"panel sets are read from and saved to {legacy} (legacy location); "
                        f"run `annzarro panel-sets migrate` to copy them to {new}")
    return Location(new, STATE, new, legacy)


def directory(config) -> str:
    """The directory panel sets are read from and saved to."""
    return resolve(config).path


def is_legacy(config) -> bool:
    return resolve(config).mode == LEGACY


def top_level_skip(config) -> tuple:
    """Folder names a listing of the data directory's top level leaves out: ``sessions`` while
    panel sets still live there."""
    return (LEGACY_NAME,) if is_legacy(config) else ()


def ensure(config) -> str:
    """:func:`directory`, created when absent (0700 in the state directory)."""
    location = resolve(config)
    if not os.path.isdir(location.path):
        os.makedirs(location.path, mode=0o700, exist_ok=True)
        if location.mode != LEGACY:
            try:
                os.chmod(location.path, 0o700)
            except OSError:
                pass
    return location.path


def describe(config) -> dict:
    """What start-up, the admin Health page and ``annzarro paths`` report."""
    location = resolve(config)
    return {"path": location.path, "mode": location.mode, "legacy": location.mode == LEGACY,
            "note": location.note}


def log_startup(config) -> None:
    """Say once at start-up where panel sets live when that deserves a word."""
    location = resolve(config)
    if location.note:
        (logger.warning if location.mode == EXPLICIT else logger.info)(location.note)


# --- annzarro panel-sets migrate -------------------------------------------------------------

@dataclass
class MigrationReport:
    source: str
    target: str
    copied: List[str]
    identical: List[str]      # already there, byte for byte
    conflicts: List[str]      # a different file of that name exists in the target
    failed: List[str]
    dry_run: bool
    locked: bool = True

    @property
    def ok(self) -> bool:
        return not self.conflicts and not self.failed


def _same(a: str, b: str) -> bool:
    with open(a, "rb") as fa, open(b, "rb") as fb:
        while True:
            ca, cb = fa.read(1 << 20), fb.read(1 << 20)
            if ca != cb:
                return False
            if not ca:
                return True


def migrate(config, dry_run=False) -> MigrationReport:
    """Copy every panel set of ``<data_dir>/sessions`` to the new directory.

    Each copy is compared byte for byte with its source. A file already in the target that
    differs is a conflict and stays as it is; nothing is overwritten and nothing, anywhere, is
    deleted. Running it again reports the same files as identical.
    """
    source, target = legacy_dir(config), _new_dir(config)
    report = MigrationReport(source, target, [], [], [], [], dry_run)
    if os.path.realpath(source) == os.path.realpath(target):
        raise ValueError(f"panel_sets_dir is {source} itself; there is nothing to copy")
    if not os.path.isdir(source):
        return report
    names = sorted(n for n in os.listdir(source)
                   if n.endswith(".json") and os.path.isfile(os.path.join(source, n)))
    with contextlib.ExitStack() as stack:
        # Take the lock a server saves under, but never create its file in the data directory:
        # without one no server has saved here, so there is nobody to wait for.
        if os.path.exists(os.path.join(source, ".lock.lock")):
            try:
                stack.enter_context(session_store.locked(source))
            except PermissionError:       # a read-only data directory cannot take the lock
                report.locked = False
        if not dry_run and names:
            os.makedirs(target, mode=0o700, exist_ok=True)
            try:
                os.chmod(target, 0o700)
            except OSError:
                pass
        for name in names:
            src, dst = os.path.join(source, name), os.path.join(target, name)
            if os.path.lexists(dst):
                (report.identical if os.path.isfile(dst) and _same(src, dst) else report.conflicts).append(name)
            elif dry_run:
                report.copied.append(name)
            else:
                try:
                    shutil.copy2(src, dst)
                    if not _same(src, dst):
                        os.unlink(dst)       # our own half-copy, never the source
                        raise OSError("copy differs from the original")
                    report.copied.append(name)
                except OSError as e:
                    logger.warning("Panel set %s was not copied: %s", name, e)
                    report.failed.append(name)
    return report
