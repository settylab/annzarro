"""Source guard: a deep-link must never strand the UI on the restore spinner.

Operator-reported boot hang (2026-06-07): opening AnnZarro via a DoLiMap
``?dataset_path=...&view=...`` deep-link showed "Loading Dataset and Autosaved
Panels / Your previous panel set is being restored..." and hung there forever --
a panel only opened once the user manually clicked a plot.

Root cause was purely client-side ordering: when a localStorage autosave existed,
``PanelManager.init({hasAutosave:true})`` replaced the welcome tile's header with
that spinner, and the spinner is *only ever cleared as a side effect of a panel
being created*. A bare ``?dataset_path`` (no ``view=``, exactly what the DoLiMap
datasets table emits) -- or a ``view`` that materializes no panel -- creates
nothing, so the spinner never resolves and there is no Welcome fallback.

The fix (static/js/main.js, panel-manager.js, selection-tile.js):
  1. parse the deep-link BEFORE ``PanelManager.init`` and gate the spinner on
     ``!deepLink`` -- a deep-link boots into the plain Welcome tile instead;
  2. after applying the deep-link OR restoring an autosave, always call
     ``PanelManager.ensureWelcomeFallback()`` so an empty/failed restore drops
     back to Welcome rather than spinning;
  3. a ``setTimeout`` safety net in ``PanelManager.init`` so even a never-resolving
     restore can't pin the spinner forever.

This guard greps the front-end source so the ordering/fallback can't silently
regress. It needs no node, jsdom, or browser, so it runs anywhere pytest does.
Self-activating: it only enforces once the deep-link boot path
(``_applyDeepLink``) exists, so it never false-fails a pre-feature checkout.
"""
import os
import re

import pytest

_THIS = os.path.abspath(__file__)
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(_THIS))))
JS_ROOT = os.path.join(REPO_ROOT, "static", "js")
MAIN_JS = os.path.join(JS_ROOT, "main.js")
PANEL_JS = os.path.join(JS_ROOT, "panel-manager.js")
TILE_JS = os.path.join(JS_ROOT, "selection-tile.js")


def _read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def _feature_present():
    """The deep-link boot path must exist before these invariants are meaningful."""
    return os.path.isfile(MAIN_JS) and "_applyDeepLink" in _read(MAIN_JS)


def test_deeplink_parsed_before_panel_init():
    """The deep-link must be parsed before ``PanelManager.init`` so the spinner
    decision can see it. If init runs first, the gate below cannot work."""
    if not _feature_present():
        pytest.skip("_applyDeepLink not present -- deep-link feature not in this checkout")
    src = _read(MAIN_JS)
    parse_idx = src.find("_parseDeepLink()")
    init_idx = src.find("PanelManager.init(")
    assert parse_idx != -1, "main.js no longer calls _parseDeepLink() -- deep-link boot changed"
    assert init_idx != -1, "main.js no longer calls PanelManager.init() -- boot changed"
    assert parse_idx < init_idx, (
        "main.js must parse the deep-link BEFORE PanelManager.init() so the "
        "autosave-spinner decision can suppress the spinner for a deep-link boot. "
        "Parsing it afterwards reintroduces the infinite-spinner hang."
    )


def test_autosave_spinner_suppressed_for_deeplink():
    """``hasAutosave`` (which drives the restore spinner) must exclude the
    deep-link case, i.e. be ANDed with a deep-link negation."""
    if not _feature_present():
        pytest.skip("_applyDeepLink not present -- deep-link feature not in this checkout")
    src = _read(MAIN_JS)
    # Find the hasAutosave assignment and require a `!deepLink` (or !!deepLink-style
    # negation) conjunct on it. Tolerant of whitespace and the exact variable name.
    m = re.search(r"const\s+hasAutosave\s*=\s*([^;]+);", src)
    assert m, "main.js no longer assigns `const hasAutosave = ...` -- boot changed"
    rhs = m.group(1)
    assert re.search(r"&&\s*!\s*deepLink", rhs), (
        "`hasAutosave` must be gated with `&& !deepLink` so a deep-link boot does "
        "NOT show the 'restoring previous panel set' spinner (which only clears "
        f"when a panel is created). Found: hasAutosave = {rhs.strip()}"
    )


def test_welcome_fallback_invoked_in_boot():
    """After the deep-link/autosave branches, the boot must call
    ``ensureWelcomeFallback`` so an empty or failed restore shows Welcome."""
    if not _feature_present():
        pytest.skip("_applyDeepLink not present -- deep-link feature not in this checkout")
    src = _read(MAIN_JS)
    assert "ensureWelcomeFallback" in src, (
        "main.js no longer calls PanelManager.ensureWelcomeFallback() -- without "
        "it a deep-link with no view (or a thrown restore) hangs on the spinner "
        "instead of falling back to the Welcome screen."
    )


def test_panel_manager_defines_and_guards_fallback():
    """``ensureWelcomeFallback`` must exist, be exported, and no-op once panels
    exist (so it never clobbers a successful restore)."""
    if not _feature_present():
        pytest.skip("_applyDeepLink not present -- deep-link feature not in this checkout")
    src = _read(PANEL_JS)
    assert re.search(r"function\s+ensureWelcomeFallback\s*\(", src), (
        "panel-manager.js must define ensureWelcomeFallback()."
    )
    # The guard: it must bail when panels already exist, so a normal restore /
    # successful deep-link is left untouched.
    m = re.search(r"function\s+ensureWelcomeFallback\s*\([^)]*\)\s*\{(.*?)\n    \}", src, re.DOTALL)
    assert m, "could not locate the ensureWelcomeFallback body to verify its guard"
    body = m.group(1)
    assert re.search(r"_panels\.size\s*>\s*0", body) and "return" in body, (
        "ensureWelcomeFallback must early-return when `_panels.size > 0`, or it "
        "would reset the welcome header even after a panel successfully opened."
    )
    assert re.search(r"\bensureWelcomeFallback\b", src.split("return {", 1)[-1]), (
        "ensureWelcomeFallback must be exported from the PanelManager public API."
    )


def test_selection_tile_can_restore_welcome_header():
    """``SelectionTile.showWelcomeHeader`` must exist and restore the Welcome
    prompt so the fallback replaces the spinner with usable UI."""
    if not _feature_present():
        pytest.skip("_applyDeepLink not present -- deep-link feature not in this checkout")
    src = _read(TILE_JS)
    assert "showWelcomeHeader" in src, (
        "selection-tile.js must define showWelcomeHeader() -- the method "
        "ensureWelcomeFallback calls to swap the spinner back to 'Welcome to "
        "AnnZarro / Get started by choosing a panel type'."
    )
    m = re.search(r"showWelcomeHeader\s*\(\s*\)\s*\{(.*?)\n    \}", src, re.DOTALL)
    assert m, "could not locate the showWelcomeHeader body"
    body = m.group(1)
    assert "Welcome to AnnZarro" in body and "tile-selection-header" in body, (
        "showWelcomeHeader must restore the default Welcome header content."
    )


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
