"""System login policy UI with synthetic users and API; no production access."""
from __future__ import annotations

from dataclasses import replace
from datetime import timedelta
from http.server import ThreadingHTTPServer
import json
import logging
import os
from pathlib import Path
import sys
from threading import Thread
from urllib.parse import urlsplit
import warnings

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ["SURVEYONE_LOAD_DOTENV"] = "false"
os.environ["DB_MODE"] = "memory"
os.environ["SURVEYONE_ENV"] = "test"
for code in ("EMAIL", "SMS", "KAKAO", "FAX"):
    os.environ[f"SURVEYONE_{code}_PROVIDER"] = "disabled"
warnings.filterwarnings("ignore", message="Using.*httpx.*")

from fastapi.testclient import TestClient  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402
from browser_showcase import StaticHandler  # noqa: E402
from test_login_policy import member  # noqa: E402
from backend.config import get_settings  # noqa: E402
from backend.dependencies import current_store, current_user  # noqa: E402
from backend.memory_store import MemoryStore, utcnow  # noqa: E402
from backend.models import LoginPolicyUpdate  # noqa: E402
from main import app  # noqa: E402

logging.getLogger("httpx").setLevel(logging.ERROR)


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), StaticHandler)
    Thread(target=server.serve_forever, daemon=True).start()
    output = ROOT / ".tmp/login-policy-review"
    output.mkdir(parents=True, exist_ok=True)
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel="msedge", headless=True)
            for width in (1440, 768, 360):
                store = MemoryStore(get_settings())
                normal = member(store, "synthetic-policy-ui")
                user = replace(normal, system_admin=True)
                app.dependency_overrides[current_store] = lambda: store
                app.dependency_overrides[current_user] = lambda: user
                errors, writes = [], []
                fail_save = False
                context = browser.new_context(viewport={"width": width, "height": 1000}, reduced_motion="reduce")
                page = context.new_page()
                page.set_default_timeout(10000)
                page.on("pageerror", lambda error: errors.append(str(error)))
                with TestClient(app) as client:
                    def api(route):
                        nonlocal fail_save
                        req = route.request
                        path = urlsplit(req.url).path
                        if path == "/api/auth/me":
                            data = {"user": store._user_view(user).model_dump(by_alias=True, mode="json"), "expiresAt": (utcnow() + timedelta(hours=1)).isoformat()}
                            return route.fulfill(status=200, content_type="application/json", body=json.dumps({"data": data}))
                        if req.method == "PUT":
                            writes.append(path)
                            if fail_save:
                                fail_save = False
                                return route.fulfill(status=503, content_type="application/json", body=json.dumps({"detail": "합성 저장 실패"}))
                        response = client.request(req.method, path, content=req.post_data_buffer, headers={"content-type": "application/json"})
                        route.fulfill(status=response.status_code, content_type=response.headers.get("content-type", "application/json"), body=response.content)
                    page.route("**/api/**", api)
                    page.goto(f"http://127.0.0.1:{server.server_address[1]}/#/M06001")
                    toggle = page.locator('[name="allowConcurrentLogins"]')
                    page.wait_for_function("() => { const field = document.querySelector('[name=allowConcurrentLogins]'); return field && !field.disabled; }")
                    assert toggle.is_checked()
                    assert not writes
                    toggle.uncheck()
                    assert not writes
                    page.evaluate("void SurveyOneApp.navigate('M02001')")
                    page.locator('[data-message-dialog][open]').wait_for()
                    page.locator('[data-message-cancel]').click()
                    assert page.locator('[data-login-policy-form]').is_visible()
                    assert not toggle.is_checked()
                    fail_save = True
                    page.locator('[data-login-policy-save]').click()
                    page.wait_for_function("document.querySelector('[data-login-policy-state]').textContent.includes('합성 저장 실패')")
                    assert not toggle.is_checked()
                    assert store.login_policy(user).allow_concurrent_logins
                    page.locator('[data-login-policy-save]').click()
                    page.wait_for_function("document.querySelector('[data-login-policy-state]').textContent.includes('저장했습니다')")
                    assert not store.login_policy(user).allow_concurrent_logins
                    # Conflicting edits preserve input and require an explicit reload.
                    toggle.check()
                    store.update_login_policy(user, LoginPolicyUpdate(allowConcurrentLogins=False, revision=2))
                    page.locator('[data-login-policy-save]').click()
                    page.wait_for_function("document.querySelector('[data-login-policy-state]').textContent.includes('다른 관리자')")
                    assert toggle.is_checked()
                    page.locator('[data-login-policy-reload]').click()
                    page.locator('[data-message-dialog][open]').wait_for()
                    page.locator('[data-message-confirm]').click()
                    page.wait_for_function("!document.querySelector('[name=allowConcurrentLogins]').checked")
                    toggle.check()
                    page.locator('[data-login-policy-save]').click()
                    page.wait_for_function("document.querySelector('[data-login-policy-state]').textContent.includes('저장했습니다')")
                    page.reload()
                    page.wait_for_function("() => { const field = document.querySelector('[name=allowConcurrentLogins]'); return field && !field.disabled; }")
                    assert toggle.is_checked()
                    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
                    toggle.scroll_into_view_if_needed()
                    page.screenshot(path=str(output / f"settings-{width}.png"), full_page=False)
                    assert not errors, errors
                    # Standard users keep browser preferences and cannot edit the policy.
                    user = normal
                    before = len(writes)
                    page.reload()
                    page.locator('[data-login-policy-access]:not([hidden])').wait_for()
                    assert not page.locator('[data-login-policy-form]').is_visible()
                    assert page.locator('[data-system-settings-form]').is_visible()
                    assert len(writes) == before
                context.close()
                print(f"login policy {width}px: permissions, manual save, failure recovery, conflict/reload and persistence passed")
            browser.close()
    finally:
        app.dependency_overrides.clear()
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
