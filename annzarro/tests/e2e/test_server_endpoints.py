"""End-to-end tests for the server's HTTP surface.

These used to require a server already listening on localhost:8000 (or
ANNZARRO_TEST_SERVER_URL) and errored everywhere else, including CI; they also
targeted routes that have since moved (/api/v1/datasets -> /api/v1/core/datasets,
/css and /js -> /static/...). They now run in-process against the committed
fixture through the shared ``client`` fixture (conftest.py).
"""


def test_api_config_endpoint(client):
    response = client.get("/api/v1/config")
    assert response.status_code == 200
    assert "app_name" in response.get_json()


def test_api_datasets_endpoint(client):
    response = client.get("/api/v1/core/datasets")
    assert response.status_code == 200
    names = [d["id"] for d in response.get_json()["datasets"]]
    assert "fixture_small" in names


def test_dataset_info(client, fixture_path):
    response = client.get("/api/v1/datasets/fixture_small.zarr")
    assert response.status_code == 200
    info = response.get_json()
    assert info["n_obs"] > 0 and info["n_vars"] > 0
    assert "X_umap" in info["embeddings"]


def test_static_file_serving(client):
    response = client.get("/")
    assert response.status_code == 200
    assert "<html" in response.get_data(as_text=True).lower()

    response = client.get("/static/css/styles.css")
    assert response.status_code == 200
    assert "css" in response.content_type

    response = client.get("/static/js/main.js")
    assert response.status_code == 200
    assert "javascript" in response.content_type


def test_nonexistent_api_endpoint(client):
    assert client.get("/api/v1/nonexistent").status_code == 404


def test_client_side_routing(client):
    response = client.get("/nonexistent/path")
    assert response.status_code == 200
    assert "<html" in response.get_data(as_text=True).lower()
