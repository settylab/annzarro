"""/api/v1/health: the probe a service manager, container runtime or load balancer calls."""
from annzarro.tests.server.admin_helpers import make_app

PATH = "/api/v1/health"


def test_the_probe_answers_without_login_when_login_is_on(tmp_path):
    app = make_app(tmp_path)
    client = app.test_client()
    # /status is for people who are signed in; the probe is not
    assert client.get("/api/v1/status").status_code == 401
    reply = client.get(PATH)
    assert reply.status_code == 200 and reply.get_json() == {"status": "ok"}
    assert reply.headers["Cache-Control"] == "no-store"


def test_the_probe_names_nothing_of_the_server(tmp_path):
    app = make_app(tmp_path)
    text = app.test_client().get(PATH).get_data(as_text=True)
    for word in (str(tmp_path), "version", "pid", "data_dir", "platform"):
        assert word not in text


def test_the_probe_answers_a_head_request_and_refuses_a_post(tmp_path):
    client = make_app(tmp_path).test_client()
    assert client.head(PATH).status_code == 200
    assert client.post(PATH).status_code == 405


def test_the_probe_answers_without_login_being_on_too(tmp_path):
    client = make_app(tmp_path, auth=False, host="127.0.0.1").test_client()
    assert client.get(PATH).get_json() == {"status": "ok"}
