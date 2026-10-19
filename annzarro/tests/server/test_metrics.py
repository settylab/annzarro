"""/metrics: off by default, who may read it, what its labels can hold, and how workers merge."""
import json
import os
import re

import pytest

from annzarro.server import metrics
from annzarro.server.core import create_app


def _app(tmp_path, **config):
    data = tmp_path / "data"
    data.mkdir(exist_ok=True)
    settings = {"TESTING": True, "data_dir": str(data), "log_file": str(tmp_path / "app.log"),
                "user_file": str(tmp_path / "users" / "users.json")}
    settings.update(config)
    return create_app(settings)


def _get(client, path, **kwargs):
    response = client.get(path, **kwargs)
    response.get_data()
    response.close()
    return response


def _samples(text, name):
    return [line for line in text.splitlines() if line.startswith(name + "{") or line.startswith(name + " ")]


@pytest.fixture
def app(tmp_path):
    return _app(tmp_path, metrics_enabled=True)


def test_off_by_default_there_is_no_metrics_endpoint(tmp_path):
    app = _app(tmp_path)
    assert "metrics" not in {rule.endpoint for rule in app.url_map.iter_rules()}
    assert metrics.EXTENSION not in app.extensions
    # nothing wrapped the app either
    assert type(app.wsgi_app).__name__ == "function" or "Telemetry" not in type(app.wsgi_app).__name__
    assert b"annzarro_http" not in _get(app.test_client(), "/metrics", environ_base={"REMOTE_ADDR": "127.0.0.1"}).data


def test_loopback_reads_the_exposition(app):
    response = _get(app.test_client(), "/metrics", environ_base={"REMOTE_ADDR": "127.0.0.1"})
    assert response.status_code == 200
    assert response.headers["Content-Type"].startswith("text/plain; version=0.0.4")
    assert response.headers["Cache-Control"] == "no-store"
    text = response.get_data(as_text=True)
    for family in ("annzarro_build_info", "annzarro_http_requests_total", "annzarro_http_request_duration_seconds",
                   "annzarro_http_requests_in_flight", "annzarro_http_response_bytes_total",
                   "annzarro_cache_hits_total", "annzarro_cache_misses_total", "annzarro_cache_size_bytes",
                   "annzarro_open_datasets", "annzarro_process_resident_memory_bytes"):
        assert f"# TYPE {family} " in text, family
    assert f'annzarro_process_resident_memory_bytes{{worker="{os.getpid()}"}}' in text


@pytest.mark.parametrize("address", ["203.0.113.9", "10.1.2.3", "::ffff:203.0.113.9", "2001:db8::1", "garbage"])
def test_other_addresses_get_what_a_missing_url_gets(app, tmp_path, address):
    refused = _get(app.test_client(), "/metrics", environ_base={"REMOTE_ADDR": address})
    (tmp_path / "off").mkdir()
    off = _get(_app(tmp_path / "off").test_client(), "/metrics", environ_base={"REMOTE_ADDR": address})
    assert b"annzarro_http" not in refused.data
    assert (refused.status_code, refused.data) == (off.status_code, off.data)


def test_a_proxied_request_is_refused_even_from_loopback(app):
    for header in ("X-Forwarded-For", "X-Real-IP", "Forwarded", "X-Forwarded-Host"):
        response = _get(app.test_client(), "/metrics", headers={header: "198.51.100.7"},
                        environ_base={"REMOTE_ADDR": "127.0.0.1"})
        assert b"annzarro_http" not in response.data, header


def test_a_trusted_proxy_makes_the_forwarded_address_the_client(tmp_path):
    app = _app(tmp_path, metrics_enabled=True, proxy_count=1, metrics_allow=["10.0.0.0/8"])
    ok = _get(app.test_client(), "/metrics", headers={"X-Forwarded-For": "10.4.4.4"},
              environ_base={"REMOTE_ADDR": "127.0.0.1"})
    public = _get(app.test_client(), "/metrics", headers={"X-Forwarded-For": "198.51.100.7"},
                  environ_base={"REMOTE_ADDR": "127.0.0.1"})
    assert b"annzarro_http" in ok.data
    assert b"annzarro_http" not in public.data


def test_the_allowed_networks_are_configurable_and_checked_at_startup(tmp_path):
    app = _app(tmp_path, metrics_enabled=True, metrics_allow=["192.0.2.0/24", "2001:db8::/32"])
    for address, readable in (("192.0.2.77", True), ("2001:db8::5", True), ("127.0.0.1", False)):
        reply = _get(app.test_client(), "/metrics", environ_base={"REMOTE_ADDR": address})
        assert (b"annzarro_http" in reply.data) is readable, address
    with pytest.raises(ValueError, match="metrics_allow"):
        _app(tmp_path, metrics_enabled=True, metrics_allow=["not-a-network"])


def test_it_is_open_to_a_scraper_that_cannot_log_in(tmp_path):
    from annzarro.tests.server.admin_helpers import make_app
    app = make_app(tmp_path, metrics_enabled=True)
    reply = _get(app.test_client(), "/metrics", environ_base={"REMOTE_ADDR": "127.0.0.1"})
    assert reply.status_code == 200 and b"annzarro_http" in reply.data


def test_labels_hold_route_groups_never_paths_or_names(app, tmp_path):
    secret = "pbmc-private-atlas"
    client = app.test_client()
    _get(client, f"/api/v1/data/info?dataset_path=/srv/{secret}.zarr")
    _get(client, f"/api/v1/datasets/{secret}/info")
    _get(client, f"/api/v1/data/layer/{secret}-layer?dataset_path=x")
    _get(client, f"/some/deep/{secret}/link")
    _get(client, "/api/v1/nope/" + secret)
    _get(client, "/static/js/nope-" + secret + ".js")
    text = _get(client, "/metrics", environ_base={"REMOTE_ADDR": "127.0.0.1"}).get_data(as_text=True)
    assert secret not in text and "/srv" not in text
    groups = set(re.findall(r'group="([^"]*)"', text))
    assert {"data/info", "data/layer", "page", "static"} <= groups
    assert groups <= {"data/info", "datasets/info", "data/layer", "page", "unmatched", "static", "metrics"}
    # the only labels there are
    assert set(re.findall(r'(\w+)="', text)) <= {"worker", "group", "method", "code", "le", "cache", "version"}


def test_counts_latency_and_bytes_follow_requests(app):
    client = app.test_client()
    for _ in range(3):
        _get(client, "/api/v1/status")
    _get(client, "/api/v1/nope")
    text = _get(client, "/metrics", environ_base={"REMOTE_ADDR": "127.0.0.1"}).get_data(as_text=True)
    worker = os.getpid()
    assert f'annzarro_http_requests_total{{worker="{worker}",group="status",method="GET",code="200"}} 3' in text
    assert f'annzarro_http_request_duration_seconds_count{{worker="{worker}",group="status"}} 3' in text
    inf = [l for l in text.splitlines() if 'group="status"' in l and 'le="+Inf"' in l]
    assert inf and inf[0].endswith(" 3")
    # buckets are cumulative
    counts = [int(l.rsplit(" ", 1)[1]) for l in text.splitlines()
              if l.startswith("annzarro_http_request_duration_seconds_bucket") and 'group="status"' in l]
    assert counts == sorted(counts)
    assert int(_samples(text, "annzarro_http_response_bytes_total")[0].rsplit(" ", 1)[1]) > 0
    assert f'annzarro_http_requests_in_flight{{worker="{worker}"}} 1' in text   # the scrape itself


def test_a_streamed_reply_is_in_flight_until_it_has_been_read(app):
    from flask import Response
    @app.route("/_slow")
    def _slow():
        return Response((b"x" * 1000 for _ in range(3)), mimetype="application/octet-stream")
    from annzarro.server import access
    access.gate("public")(app.view_functions["_slow"])
    client = app.test_client()
    response = client.get("/_slow", buffered=False)
    mid = app.extensions[metrics.EXTENSION].snapshot()
    assert mid["in_flight"] == 1
    assert len(response.get_data()) == 3000
    response.close()
    after = app.extensions[metrics.EXTENSION].snapshot()
    assert after["in_flight"] == 0
    assert after["bytes"]["_slow"] == 3000


def test_workers_are_merged_and_a_dead_one_is_forgotten(app):
    collector = app.extensions[metrics.EXTENSION]
    other = metrics.Collector(collector.directory, pid=999991)
    other.end("data/obs", "GET", 200, 0.2, 500)
    other.begin = None
    snapshot = other.snapshot()
    snapshot["host"] = "elsewhere"
    path = os.path.join(collector.directory, "elsewhere-999991.json")
    os.makedirs(collector.directory, exist_ok=True)
    with open(path, "w") as fh:
        json.dump(snapshot, fh)
    text = collector.render()
    assert 'worker="999991",group="data/obs",method="GET",code="200"} 1' in text
    assert f'worker="{os.getpid()}"' in text
    # a snapshot of a process of this host that is gone is deleted, not shown
    gone = dict(snapshot, host=snapshot["host"], pid=2 ** 22 + 12345)
    gone["host"] = collector.snapshot()["host"]
    gone_path = os.path.join(collector.directory, "gone.json")
    with open(gone_path, "w") as fh:
        json.dump(gone, fh)
    assert f'worker="{gone["pid"]}"' not in collector.render()
    assert not os.path.exists(gone_path)


def test_a_damaged_snapshot_file_is_ignored(app):
    collector = app.extensions[metrics.EXTENSION]
    os.makedirs(collector.directory, exist_ok=True)
    with open(os.path.join(collector.directory, "junk.json"), "w") as fh:
        fh.write("{not json")
    assert "annzarro_build_info" in collector.render()


def test_route_group_is_bounded_and_has_no_parameters(app):
    seen = set()
    from annzarro.server.telemetry import route_group
    for rule in app.url_map.iter_rules():
        class R:  # a request that matched this rule
            url_rule = rule
        group = route_group(R)
        seen.add(group)
        assert "<" not in group and not group.startswith("/") and group.count("/") <= 1
    assert len(seen) < 80
    assert {"admin", "page", "static", "data/obs", "status"} <= seen
