"""Standalone browser regression using curated fixtures; no live DB or accounts."""
from __future__ import annotations

import json
import os
from pathlib import Path
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ["SURVEYONE_LOAD_DOTENV"] = "false"
os.environ["DB_MODE"] = "memory"
os.environ["SURVEYONE_ENV"] = "test"

from backend.memory_store import _seed_templates  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402


class StaticHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        if self.path == "/":
            self.path = "/frontend/index.html"
        if not self.path.startswith("/frontend/"):
            return self.send_error(404)
        return super().do_GET()

    def log_message(self, *args):
        pass


def main():
    fixtures = [item.model_dump(by_alias=True, mode="json") for item in _seed_templates()]
    server = ThreadingHTTPServer(("127.0.0.1", 0), StaticHandler)
    Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    output = ROOT / ".tmp" / "showcase-review"
    output.mkdir(parents=True, exist_ok=True)
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel="msedge", headless=True)
            for width in (360, 768, 1440):
                context = browser.new_context(viewport={"width": width, "height": 1000}, reduced_motion="reduce")
                page = context.new_page()
                page.set_default_timeout(10000)
                errors, writes, guest_requests = [], [], []
                page.on("pageerror", lambda error: errors.append(str(error)))
                failed_catalog = False

                def api(route):
                    nonlocal failed_catalog
                    req = route.request
                    path = urlsplit(req.url).path
                    if req.method != "GET":
                        writes.append(path)
                    if "/guest" in path:
                        guest_requests.append(path)
                    status, data = 200, {}
                    if path == "/api/auth/me":
                        status, data = 401, {"detail": "No session"}
                    elif path == "/api/version":
                        data = {"version": (ROOT / "VERSION").read_text(encoding="utf-8").strip()}
                    elif path == "/api/runtime-config":
                        data = {"publicBaseUrl": "https://survey.example.test", "environment": "test"}
                    elif path == "/api/showcase/templates":
                        if failed_catalog:
                            status, data = 503, {"detail": "Synthetic retry scenario"}
                        else:
                            data = fixtures
                    elif path.startswith("/api/help/"):
                        status, data = 404, {"detail": "Static help"}
                    else:
                        raise AssertionError(f"Unexpected API request: {req.method} {path}")
                    body = {"status": "success", "data": data} if status == 200 else data
                    route.fulfill(status=status, content_type="application/json", body=json.dumps(body))

                page.route("**/api/**", api)
                page.goto(base + "/#/M01002")
                page.locator("[data-showcase-preview]").first.wait_for()
                assert page.locator("main").count() == page.locator("h1").count() == 1
                assert "기능·템플릿 안내" in page.title()
                assert "게스트" not in page.locator("body").inner_text()
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
                assert page.locator("[data-showcase-preview]").count() == len(fixtures)
                page.locator("[data-showcase-search]").fill("no-matching-fixture")
                assert page.locator("[data-showcase-preview]").count() == 0
                page.locator("[data-showcase-search]").fill("")
                page.select_option("[data-showcase-category]", fixtures[0]["category"])
                assert page.locator("[data-showcase-preview]").count() == 1
                page.select_option("[data-showcase-category]", "all")
                page.evaluate("window.scrollTo(0, 0)")
                page.screenshot(path=str(output / f"guide-{width}.png"), full_page=True)
                button = page.locator("[data-showcase-preview]").first
                button.focus()
                page.keyboard.press("Enter")
                frame_element = page.locator("[data-showcase-frame]")
                assert frame_element.get_attribute("sandbox") == "allow-scripts"
                frame = page.frame_locator("[data-showcase-frame]")
                frame.locator("[data-public-form]").wait_for(state="visible")
                assert frame.locator("[data-public-title]").inner_text() == fixtures[0]["title"]
                assert frame.locator("html").evaluate("element => element.scrollWidth <= innerWidth + 1")
                frame.locator('input[type="radio"]').first.check()
                assert frame.locator('input[type="radio"]:checked').count() == 1
                frame.locator(".public-submit").click()
                page.screenshot(path=str(output / f"preview-{width}.png"))
                page.locator('[data-modal] button[aria-label="닫기"]').click()
                page.locator("[data-modal]").wait_for(state="hidden")
                assert button.evaluate("element => element === document.activeElement")
                button.click()
                frame.locator("[data-public-form]").wait_for(state="visible")
                assert frame.locator('input[type="radio"]:checked').count() == 0
                page.locator('[data-modal] button[aria-label="닫기"]').click()
                failed_catalog = True
                page.locator("[data-showcase-retry]").click()
                page.locator('[data-showcase-list] [role="alert"]').wait_for()
                failed_catalog = False
                page.locator("[data-showcase-retry]").click()
                page.locator("[data-showcase-preview]").first.wait_for()
                # Anonymous project creation links must never open a draft.
                page.goto(base + "/#/M02001?create=1")
                page.locator("[data-visitor-start]").wait_for(state="visible")
                assert "#/M01001" in page.url
                page.locator("[data-showcase]").click()
                page.locator("[data-showcase-preview]").first.wait_for()
                page.locator("[data-showcase-start]").first.click()
                page.locator("[data-auth-dialog]").wait_for(state="visible")
                assert page.locator('[data-auth-panel="login"]').is_visible()
                assert page.locator("[data-auth-tab]").count() == 2
                assert not writes, writes
                assert not guest_requests, guest_requests
                assert not errors, errors
                print(f"PASS {width}px: guide, search/filter, isolated preview, no persistence, retry, keyboard/focus, member gate")
                context.close()
            browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
