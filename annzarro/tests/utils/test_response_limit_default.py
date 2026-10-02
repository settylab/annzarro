"""max_response_elements: base.yaml said 10,000,000, schema.yaml and the
built-in DEFAULT_CONFIG 1,000,000. The merged config (10,000,000) is what
runs, so the other two now say the same."""
from annzarro.utils.config_manager import ConfigManager


def test_max_response_elements_default_agrees_everywhere(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(ConfigManager, "SYSTEM_CONFIG_PATH", str(tmp_path / "none.yaml"))
    monkeypatch.delenv("ANNZARRO_SERVER_MAX_RESPONSE_ELEMENTS", raising=False)
    from annzarro.server.core import DEFAULT_CONFIG
    mgr = ConfigManager()
    merged = mgr.load_config(env="production")["server"]["max_response_elements"]
    schema = mgr._load_schema()["server"]["properties"]["max_response_elements"]["default"]
    assert merged == schema == DEFAULT_CONFIG["max_response_elements"] == 10_000_000
