"""Synthetic outage/recovery checks; never uses live DB, accounts or sending."""
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
from backend.config import get_settings  # noqa: E402
from backend.dependencies import current_store, current_user  # noqa: E402
from backend.memory_store import MemoryStore, utcnow  # noqa: E402
from backend.models import PublicSurvey, SurveySection, Question, SurveySettings, SurveyTheme  # noqa: E402
from main import app  # noqa: E402

logging.getLogger("httpx").setLevel(logging.ERROR)


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), StaticHandler)
    Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    output = ROOT / ".tmp/service-error-review"
    output.mkdir(parents=True, exist_ok=True)
    public = PublicSurvey(survey_id="outage-fixture", slug="outage-fixture", version=1,
        title="합성 설문", category="검증", sections=[SurveySection(id="s", title="안내", questions=[Question(id="q", type="short_text", title="검증 입력", required=True)])],
        settings=SurveySettings(), theme=SurveyTheme(), published_at=utcnow()).model_dump(by_alias=True, mode="json")
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel="msedge", headless=True)
            for width in (1440, 768, 360):
                store = MemoryStore(replace(get_settings(), base_url="https://survey.example.test"))
                user = store._users["user_demo"]
                app.dependency_overrides[current_store] = lambda: store
                app.dependency_overrides[current_user] = lambda: user
                mode = "bootstrap_db"
                counts = {"writes": 0, "submits": []}
                context = browser.new_context(viewport={"width": width, "height": 950}, reduced_motion="reduce")
                page = context.new_page()
                page.set_default_timeout(12000)
                errors, held = [], []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.add_init_script("""Object.defineProperty(window, 'SURVEYONE_CONFIG', {
                    configurable: true, get() { return this._testConfig; }, set(value) {
                        this._testConfig = Object.freeze({...value, requestTimeoutMs: 900, assetTimeoutMs: 700, pageInitTimeoutMs: 2200});
                    }
                });""")
                with TestClient(app) as client:
                    def hold(route):
                        held.append(route)

                    def respond(route, data, status=200):
                        route.fulfill(status=status, content_type="application/json", body=json.dumps(data))
                    def api(route):
                        req = route.request
                        path = urlsplit(req.url).path
                        if path == "/api/auth/me":
                            if mode == "bootstrap_db":
                                return respond(route, {"detail": "private Oracle connection detail", "code": "DATABASE_UNAVAILABLE", "requestId": "0123456789abcdef0123456789abcdef"}, 503)
                            return respond(route, {"data": {"user": store._user_view(user).model_dump(by_alias=True, mode="json"), "expiresAt": (utcnow()+timedelta(hours=1)).isoformat()}})
                        if path == "/api/runtime-config":
                            return respond(route, {"data": {"publicBaseUrl": "https://survey.example.test", "environment": "test"}})
                        if path == "/api/surveys" and mode == "api_timeout":
                            return hold(route)
                        if path == "/api/surveys" and mode == "malformed":
                            return route.fulfill(status=200, content_type="text/html", body="<html>private gateway error</html>")
                        if path == "/api/public/surveys/outage-fixture":
                            if req.method == "GET":
                                if mode == "public_db":
                                    return respond(route, {"code": "DATABASE_UNAVAILABLE", "detail": "private Oracle detail"}, 503)
                                return respond(route, {"data": public})
                        if path == "/api/public/surveys/outage-fixture/responses":
                            counts["submits"].append(req.headers.get("idempotency-key"))
                            if mode == "public_timeout":
                                return hold(route)
                            return respond(route, {"data": {"responseId": "synthetic", "message": "완료"}}, 201)
                        if req.method == "PUT" and path.startswith("/api/deployments/"):
                            counts["writes"] += 1
                            if mode == "write_timeout":
                                return hold(route)
                        response = client.request(req.method, path + ("?" + urlsplit(req.url).query if urlsplit(req.url).query else ""), content=req.post_data_buffer, headers={"content-type": req.headers.get("content-type", "application/json")})
                        route.fulfill(status=response.status_code, content_type=response.headers.get("content-type", "application/json"), body=response.content)
                    page.route("**/api/**", api)
                    page.goto(base + "/#/M03001")
                    failure = page.locator('[data-service-failure]')
                    failure.wait_for()
                    assert "DATABASE_UNAVAILABLE" in failure.inner_text()
                    assert "private" not in page.locator('body').inner_text()
                    assert page.url.endswith("#/M03001")
                    page.screenshot(path=str(output / f"database-{width}.png"))
                    mode = "normal"
                    page.locator('[data-route-retry]').click()
                    page.locator('[data-open-distribution-project]').first.wait_for()
                    mode = "api_timeout"
                    page.reload()
                    failure.wait_for()
                    assert "REQUEST_TIMEOUT" in failure.inner_text()
                    mode = "normal"
                    page.locator('[data-route-retry]').click()
                    page.locator('[data-open-distribution-project]').first.wait_for()
                    # Failed static assets time out and release the route queue.
                    page.route("**/frontend/css/pages/M04001.css*", hold)
                    page.evaluate("void SurveyOneApp.navigate('M04001')")
                    failure.wait_for()
                    assert "REQUEST_TIMEOUT" in failure.inner_text()
                    page.evaluate("void SurveyOneApp.navigate('M03001')")
                    page.locator('[data-open-distribution-project]').first.wait_for()
                    page.unroute("**/frontend/css/pages/M04001.css*")
                    # A superseded request is cancellation, never an outage page.
                    mode = "api_timeout"
                    page.reload()
                    page.locator('.page-loading').wait_for()
                    page.evaluate("void SurveyOneApp.navigate('M06001')")
                    page.locator('[data-system-settings-form]').wait_for()
                    assert failure.count() == 0
                    mode = "malformed"
                    page.evaluate("void SurveyOneApp.navigate('M03001')")
                    failure.wait_for()
                    assert "INVALID_RESPONSE" in failure.inner_text()
                    mode = "normal"
                    page.locator('[data-route-retry]').click()
                    page.locator('[data-open-distribution-project]').first.wait_for()
                    page.evaluate("void SurveyOneApp.navigate('M03001', {surveyId:'survey_demo_social'})")
                    page.locator('[data-distribution-workflow]:not([hidden])').wait_for()
                    name = page.locator('[data-recipient-list] [data-recipient-field="name"]').first
                    name.fill("합성 입력 유지")
                    mode = "write_timeout"
                    page.locator('[data-distribution-save]').first.click()
                    dialog = page.locator('.service-failure-dialog[open]')
                    dialog.wait_for()
                    assert "처리됐는지는 확인할 수 없습니다" in dialog.inner_text()
                    assert counts["writes"] == 1
                    assert name.input_value() == "합성 입력 유지"
                    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
                    page.screenshot(path=str(output / f"preserved-{width}.png"))
                    dialog.locator('[data-failure-return]').click()
                    assert name.input_value() == "합성 입력 유지"
                    assert counts["writes"] == 1
                    # Public survey reload and failed submission preserve answers and retry keys.
                    mode = "public_db"
                    page.route("**/s/outage-fixture", lambda route: route.fulfill(content_type="text/html", body=(ROOT / "frontend/public.html").read_text(encoding="utf-8")))
                    page.goto(base + "/s/outage-fixture")
                    failure.wait_for()
                    assert "DATABASE_UNAVAILABLE" in failure.inner_text()
                    mode = "normal"
                    page.locator('[data-failure-retry]').click()
                    answer = page.locator('[data-question-id="q"] input').first
                    answer.fill("보존할 합성 답변")
                    mode = "public_timeout"
                    page.locator('.public-submit').click()
                    dialog.wait_for()
                    assert len(counts["submits"]) == 1
                    dialog.locator('[data-failure-return]').click()
                    assert answer.input_value() == "보존할 합성 답변"
                    mode = "normal"
                    page.locator('.public-submit').click()
                    page.locator('[data-public-state]:not([hidden])').wait_for()
                    assert len(counts["submits"]) == 2
                    assert counts["submits"][0] == counts["submits"][1]
                    assert not errors, errors
                for pending in held:
                    try:
                        pending.abort()
                    except Exception:
                        pass
                context.close()
                print(f"service failures {width}px: bootstrap/DB, API/assets timeout, stale route, invalid response, draft and public retry passed")
            browser.close()
    finally:
        app.dependency_overrides.clear()
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
