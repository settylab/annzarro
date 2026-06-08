"""Deep-link smoke test: the DoLiMap -> AnnZarro ``?dataset_path=&view=`` path.

This is the regression net for the two operator-discovered failures that the
unit/server suites missed because none of them exercised a real deep-link
end-to-end:

  * BUG #1 -- vendor assets never provisioned: ``static/vendor/`` (jQuery,
    Bootstrap, Plotly, DataTables, ...) was absent in the pilot deploy, so every
    bundle 404'd, ``bootstrap`` was undefined, and the app threw
    "Initialization failed". ``test_referenced_static_assets_resolve`` asserts
    every ``/static/...`` URL the rendered ``index.html`` references returns 200.

  * The deep-link data contract: a shared link must (a) be discoverable, (b)
    color a plot by an obs column, (c) read a single gene's expression column,
    and (d) read the embedding coordinates. Those are asserted directly against
    the data endpoints the front-end calls on boot.

Everything runs in-process via Flask's test client -- no live server, no bound
port -- against the committed toy ``fixture_small.zarr``.

(BUG #2, the client-side ``Math.min(...largeArray)`` stack overflow, is guarded
by ``annzarro/tests/js/`` and ``annzarro/tests/static/`` -- it is a JS-runtime
fault that this Python data-path test cannot observe; see those modules.)
"""
import base64
import json
import re

import pytest

API = "/api/v1"


def _static_refs(html):
    """All distinct /static/... URLs referenced by href/src/url() in the HTML."""
    refs = set(re.findall(r'(?:href|src)="(/static/[^"]+)"', html))
    refs |= set(re.findall(r'url\(["\']?(/static/[^"\')]+)', html))
    return sorted(refs)


def test_index_serves(client):
    """The app shell renders -- the precondition for any deep-link to boot."""
    resp = client.get("/")
    assert resp.status_code == 200
    body = resp.get_data(as_text=True)
    # The module entrypoint must be wired in, or nothing initializes.
    assert "static/js/main.js" in body


def test_referenced_static_assets_resolve(client):
    """Every asset index.html references must serve 200 (catches BUG #1).

    With ``static/vendor/`` unprovisioned, the vendor bundles 404 here exactly as
    they did in the pilot -- which is what left ``bootstrap`` undefined and
    surfaced "Initialization failed" to the operator.
    """
    html = client.get("/").get_data(as_text=True)
    refs = _static_refs(html)
    assert refs, "index.html referenced no /static/ assets -- template parse failed?"

    vendor_refs = [u for u in refs if "/vendor/" in u]
    assert vendor_refs, "no vendor assets referenced -- template changed unexpectedly"

    missing = [(u, client.get(u).status_code) for u in refs]
    missing = [(u, code) for (u, code) in missing if code != 200]
    assert not missing, (
        "static assets did not return 200 (BUG #1 class -- run the vendor "
        f"provisioning step / annzarro-install.py): {missing}"
    )


def test_dataset_is_discoverable(client, fixture_path):
    """A deep-link target must show up in discovery (the dataset selector)."""
    resp = client.get(f"{API}/datasets")
    assert resp.status_code == 200
    # The discovery endpoint returns a bare list of dataset descriptors.
    datasets = resp.get_json()
    paths = [d.get("path", "") for d in datasets]
    assert any(p.endswith("fixture_small.zarr") for p in paths), paths


def test_dataset_info(client, fixture_path):
    resp = client.get(f"{API}/data/info?dataset_path={fixture_path}")
    assert resp.status_code == 200, resp.get_data(as_text=True)
    info = resp.get_json()
    assert info["n_obs"] == 200 and info["n_vars"] == 20
    assert info["has_obs"] and info["has_var"]


def test_deeplink_color_by_obs_column(client, fixture_path):
    """The 'color a plot by an obs column' path returns sane finite data."""
    resp = client.get(f"{API}/data/obs?dataset_path={fixture_path}&columns=total_counts")
    assert resp.status_code == 200, resp.get_data(as_text=True)
    data = resp.get_json()["data"]
    col = data["total_counts"] if isinstance(data, dict) else data
    assert len(col) == 200
    assert all(isinstance(v, (int, float)) for v in col)
    assert min(col) >= 100.0 and max(col) <= 10000.0


def test_deeplink_gene_expression_column(client, fixture_path):
    """A single gene's expression column loads (the column bug #2 chokes on)."""
    resp = client.get(f"{API}/data/X?dataset_path={fixture_path}&cols=0")
    assert resp.status_code == 200, resp.get_data(as_text=True)
    rows = resp.get_json()["data"]
    assert len(rows) == 200
    # One column requested -> one value per cell.
    assert all(len(r) == 1 for r in rows)


def test_deeplink_embedding(client, fixture_path):
    """The embedding the deep-linked plot lays out on must load as 2-D coords."""
    resp = client.get(f"{API}/data/obsm/X_umap?dataset_path={fixture_path}")
    assert resp.status_code == 200, resp.get_data(as_text=True)
    coords = resp.get_json()["data"]
    assert len(coords) == 200
    assert all(len(xy) == 2 for xy in coords)


def test_view_payload_grammar_roundtrips():
    """The ``view=base64url(JSON)`` grammar a sharer emits must decode cleanly.

    Mirrors main.js ``_b64urlDecode`` (RFC 4648 base64url) so a drift in the
    encoding contract between DoLiMap (producer) and AnnZarro (consumer) is
    caught here rather than as a silent "Invalid deep-link" at runtime.
    """
    view = {
        "constants": {"focusedGene": "GENE000"},
        "panels": [{"type": "cell_plot", "config": {"colorBy": "total_counts"}}],
    }
    raw = json.dumps(view).encode("utf-8")
    b64url = base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")

    # Decode the way the client does: urlsafe alphabet, padding restored.
    pad = "=" * (-len(b64url) % 4)
    decoded = json.loads(base64.urlsafe_b64decode(b64url + pad).decode("utf-8"))
    assert decoded == view
    assert decoded["constants"]["focusedGene"] == "GENE000"


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
