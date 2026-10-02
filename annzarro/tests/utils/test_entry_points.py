"""One command starts the server. `annzarro-server` (annzarro/server/__main__.py)
bypassed the layered configuration: without -c it ran create_app's laptop
defaults and ignored /etc, ~/.config, ./config.yaml and ANNZARRO_* variables,
so on a shared machine it silently skipped login and confinement settings.
`annzarro start` covers everything it did."""
import os

try:
    import tomllib
except ImportError:  # Python < 3.11
    tomllib = None

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


def test_only_the_annzarro_command_is_installed():
    text = open(os.path.join(ROOT, "pyproject.toml")).read()
    if tomllib:
        scripts = tomllib.loads(text)["project"]["scripts"]
        assert scripts == {"annzarro": "annzarro.cli:main"}
    assert "annzarro-server" not in text
    assert not os.path.exists(os.path.join(ROOT, "annzarro", "server", "__main__.py"))
