"""
Layer 'X' reads the X matrix.

The plot and table menus offer X as the first "layer" (a deep link
{type: 'layer', key: 'X'} used to fall back to the first layer). The readers
serve layer 'X' as X when no layer has that name; the request check added
in #45 (404 key_not_found for unknown layer keys) must let it through.
"""
import os

from annzarro.server.core import create_app

FIXTURE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "fixture_small.zarr"
)


def _client():
    return create_app({"TESTING": True, "DEBUG": False, "auth_enabled": False,
                       "data_dir": os.path.dirname(FIXTURE)}).test_client()


def test_layer_x_is_the_x_matrix():
    client = _client()
    layer = client.get("/api/v1/data/layer/X", query_string={"dataset_path": FIXTURE, "cols": "3"})
    assert layer.status_code == 200, layer.get_json()
    x = client.get("/api/v1/data/X", query_string={"dataset_path": FIXTURE, "cols": "3"})
    assert x.status_code == 200
    assert layer.get_json()["data"] == x.get_json()["data"]
    assert len(layer.get_json()["data"]) == 200


def test_an_unknown_layer_is_still_404():
    resp = _client().get("/api/v1/data/layer/no_such_layer", query_string={"dataset_path": FIXTURE, "cols": "0"})
    assert resp.status_code == 404
    assert resp.get_json()["reason"] == "key_not_found"
