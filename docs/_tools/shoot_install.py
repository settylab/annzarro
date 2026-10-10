"""Screenshots for Getting started and Deployment.

Run: .venv-docs/bin/python docs/_tools/shoot_install.py [--port 8811]

getting-started/
  welcome-picker.png   the Welcome tile with the Dataset picker open (local server, no login)
  first-plot.png       the Cell Plot tile, controls open, right after clicking "Cell Plot"
deployment/
  login.png            the login page of a server with login enabled (custom branding)
  header-signed-in.png the header badge of a signed-in admin
  header-no-login.png  the "No login" warning badge of a shared server without login

The login and badge shots run their own server from a throwaway configuration
(temporary users file, data directory and ANNZARRO_HOME), never the real ones.
"""
import argparse
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from PIL import Image  # noqa: E402
from shots import DATA_DIR, DSF, Session, stop_server  # noqa: E402

STATIC = HERE.parent / "_static" / "screens"
ANNZARRO = str(Path(sys.executable).with_name("annzarro"))
VIEWPORT = {"width": 1600, "height": 1000}


def shrink(path: Path, colours: int = 256) -> None:
    """Re-save optimised; quantise when that keeps the file under ~400 KB."""
    im = Image.open(path).convert("RGB")
    im.save(path, optimize=True)
    if path.stat().st_size > 400_000:
        im.quantize(colours, method=Image.Quantize.MEDIANCUT).save(path, optimize=True)


def wait_up(url: str, proc: subprocess.Popen, log: Path) -> None:
    for _ in range(120):
        try:
            urllib.request.urlopen(url, timeout=2)
            return
        except Exception:
            if proc.poll() is not None:
                sys.exit(f"server exited, see {log}")
            time.sleep(0.5)
    stop_server(proc)
    sys.exit("server did not come up")


def header_left(page, path: Path) -> None:
    """The left of the header: app name, sign-in badge and dataset picker."""
    box = page.locator("#app-header").bounding_box()
    page.screenshot(path=str(path), clip={"x": 0, "y": box["y"], "width": 620,
                                          "height": box["height"]})


def settle(page, seconds=1.0):
    page.wait_for_load_state("networkidle")
    time.sleep(seconds)


# --------------------------------------------------------------------------- local
def local_shots(port: int) -> None:
    out = STATIC / "getting-started"
    with Session(port, out) as s:
        ctx = s.browser.new_context(viewport=VIEWPORT, device_scale_factor=DSF,
                                    color_scheme="light")
        page = ctx.new_page()
        page.goto(s.base + "/")
        page.wait_for_selector("text=Welcome to AnnZarro")
        page.wait_for_function("() => document.getElementById('cell-count').textContent !== '-'")
        settle(page)
        page.click("#dataset-selector + .select2 .select2-selection")
        page.wait_for_selector(".select2-results__option")
        time.sleep(0.5)
        page.screenshot(path=str(out / "welcome-picker.png"))
        s.log.append("wrote welcome-picker.png")
        page.keyboard.press("Escape")

        page.get_by_text("Cell Plot", exact=True).first.click()
        page.wait_for_function("""() => { const g = document.querySelector('.tile .js-plotly-plot');
                                   return g && g._fullData && g._fullData.length > 0; }""")
        settle(page, 2)
        page.mouse.move(2, VIEWPORT["height"] - 2)
        page.locator(".tile").first.screenshot(path=str(out / "first-plot.png"))
        s.log.append("wrote first-plot.png")
        ctx.close()
    for name in ("welcome-picker", "first-plot"):
        shrink(out / f"{name}.png")


# --------------------------------------------------------------------------- hosted
def hosted_server(tmp: Path, port: int, extra_yaml: str):
    """Start `annzarro start --config` with a throwaway config; return (proc, log)."""
    data = tmp / "data"
    data.mkdir(exist_ok=True)
    link = data / "bm_aging_annzarro.zarr"
    if not link.exists():
        link.symlink_to(DATA_DIR / "bm_aging_annzarro.zarr")
    cfg = tmp / "site.yaml"
    cfg.write_text(f"""server:
  data_dir: {data}
  allowed_dirs:
    - {DATA_DIR}
{extra_yaml}""")
    env = dict(os.environ, ANNZARRO_HOME=str(tmp / "home"), XDG_CONFIG_HOME=str(tmp / "xdg"))
    env.pop("ANNZARRO_AUTH_DISABLED", None)
    log = tmp / "server.log"
    proc = subprocess.Popen([ANNZARRO, "start", "--config", str(cfg), "--port", str(port),
                             "--no-browser"], cwd=tmp, env=env, stdout=log.open("w"),
                            stderr=subprocess.STDOUT, start_new_session=True)
    return proc, log, cfg, env


def hosted_shots(port: int) -> None:
    out = STATIC / "deployment"
    out.mkdir(parents=True, exist_ok=True)
    base = f"http://127.0.0.1:{port}"
    from playwright.sync_api import sync_playwright

    with tempfile.TemporaryDirectory(prefix="annzarro-docs-") as t, sync_playwright() as pw:
        tmp = Path(t)
        browser = pw.chromium.launch()

        # 1. Login enabled, custom branding, one admin.
        proc, log, cfg, env = hosted_server(tmp, port, f"""auth:
  enabled: true
  user_file: {tmp / 'users.json'}
branding:
  app_name: AnnZarro
  project_description: Datasets of the Example Lab
  contact_info:
    lab_name: Example Lab
    lab_url: https://example.org
    email: annzarro-admin@example.org
""")
        subprocess.run([ANNZARRO, "--config", str(cfg), "user", "add", "--username", "alice",
                        "--password", "docs-only-password", "--admin"],
                       env=env, cwd=tmp, check=True, capture_output=True)
        try:
            wait_up(base + "/login", proc, log)
            ctx = browser.new_context(viewport={"width": 1100, "height": 760},
                                      device_scale_factor=DSF, color_scheme="light")
            page = ctx.new_page()
            page.goto(base + "/")              # redirected to /login
            settle(page)
            page.screenshot(path=str(out / "login.png"))
            page.fill("input[name=username]", "alice")
            page.fill("input[name=password]", "docs-only-password")
            page.click("button[type=submit]")
            page.set_viewport_size(VIEWPORT)
            page.wait_for_selector("#auth-indicator:not([hidden])")
            page.wait_for_function("() => document.getElementById('cell-count').textContent !== '-'")
            settle(page)
            header_left(page, out / "header-signed-in.png")
            ctx.close()
        finally:
            stop_server(proc)

        # 2. Shared (server.hosted) with login disabled: the warning badge.
        proc, log, cfg, env = hosted_server(tmp, port, """  hosted: true
auth:
  enabled: false
""")
        try:
            wait_up(base + "/", proc, log)
            ctx = browser.new_context(viewport=VIEWPORT, device_scale_factor=DSF,
                                      color_scheme="light")
            page = ctx.new_page()
            page.goto(base + "/")
            page.wait_for_selector("#auth-indicator:not([hidden])")
            page.wait_for_function("() => document.getElementById('cell-count').textContent !== '-'")
            settle(page)
            header_left(page, out / "header-no-login.png")
            ctx.close()
            print("SECURITY lines in the server log:",
                  sum("SECURITY" in line for line in log.read_text().splitlines()))
        finally:
            stop_server(proc)
        browser.close()
    for name in ("login", "header-signed-in", "header-no-login"):
        shrink(out / f"{name}.png")
        print(f"wrote {name}.png")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8811)
    a = ap.parse_args()
    local_shots(a.port)
    hosted_shots(a.port)
