"""Header version regression with synthetic APIs and unsaved local form input."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from http.server import ThreadingHTTPServer
import json
from threading import Thread
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

from browser_showcase import ROOT, StaticHandler


def main():
    version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    server = ThreadingHTTPServer(("127.0.0.1", 0), StaticHandler)
    Thread(target=server.serve_forever, daemon=True).start()
    output = ROOT / ".tmp" / "release-version-review"
    output.mkdir(parents=True, exist_ok=True)
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel="msedge", headless=True)
            for width in (1440, 768, 360):
                context = browser.new_context(viewport={"width": width, "height": 1000}, reduced_motion="reduce")
                page = context.new_page()
                page.set_default_timeout(10000)
                page.add_init_script("window.versionClockOffset=0; const realNow=Date.now; Date.now=()=>realNow()+window.versionClockOffset;")
                errors, writes, held = [], [], []
                mode, requests = "hold", 0
                page.on("pageerror", lambda error: errors.append(str(error)))
                def respond(route, data, status=200):
                    route.fulfill(status=status, content_type="application/json", body=json.dumps({"data": data} if status == 200 else data))
                def api(route):
                    nonlocal requests
                    request = route.request
                    path = urlsplit(request.url).path
                    if request.method != "GET":
                        writes.append(path)
                    if path == "/api/version":
                        requests += 1
                        if mode == "hold":
                            held.append(route)
                            return
                        if mode == "fail":
                            return respond(route, {"code": "SERVICE_UNAVAILABLE", "detail": "Synthetic version outage"}, 503)
                        return respond(route, {"version": "2099.01.01.1" if mode == "new" else "invalid<script>" if mode == "invalid" else version})
                    if path == "/api/auth/me":
                        return respond(route, {"user": {"id": "version-owner", "tenantId": "version-tenant", "name": "검증 담당자", "role": "OWNER"},
                                               "expiresAt": (datetime.now(timezone.utc)+timedelta(hours=1)).isoformat()})
                    if path == "/api/runtime-config":
                        return respond(route, {"publicBaseUrl": "https://survey.example.test", "environment": "test"})
                    if path == "/api/surveys/page":
                        return respond(route, {"items": [], "page": 1, "pageSize": 24, "total": 0, "totalAll": 0})
                    raise AssertionError(f"Unexpected version test API: {path}")
                page.route("**/api/**", api)
                page.goto(f"http://127.0.0.1:{server.server_address[1]}/#/M02001?create=1")
                title = page.locator('[data-project-form] [name="title"]')
                title.wait_for()
                title.fill("새 버전 확인 중에도 유지할 미저장 입력")
                route_url = page.url
                badge = page.locator("[data-application-version]")
                assert badge.inner_text() == "버전 확인 중" and title.is_enabled()
                assert len(held) == 1
                mode = "ok"
                respond(held.pop(), {"version": version})
                page.wait_for_function("version => document.querySelector('[data-application-version]').textContent === 'v'+version", arg=version)
                bounds = page.evaluate("""() => {
                    const rect = selector => { const r=document.querySelector(selector).getBoundingClientRect(); return {top:r.top,bottom:r.bottom,left:r.left,right:r.right}; };
                    return {header:rect('.app-header'),image:rect('.brand img'),badge:rect('[data-application-version]')};
                }""")
                assert bounds["badge"]["bottom"] <= bounds["header"]["bottom"] and bounds["badge"]["top"] >= bounds["image"]["bottom"] - 1, (width, bounds)
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), width
                page.screenshot(path=str(output / f"header-{width}.png"))
                mode = "new"
                page.evaluate("window.versionClockOffset+=61000;window.dispatchEvent(new Event('focus'))")
                page.wait_for_function("document.querySelector('[data-application-version]').textContent === '↑ v2099.01.01.1'")
                assert "화면 버전 v" + version in badge.get_attribute("title")
                assert "is-update-available" in badge.get_attribute("class")
                assert title.input_value() == "새 버전 확인 중에도 유지할 미저장 입력" and page.url == route_url
                count = requests
                page.evaluate("window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('focus'))")
                assert requests == count == 2
                mode = "fail"
                page.evaluate("window.versionClockOffset+=61000;window.dispatchEvent(new Event('focus'))")
                page.wait_for_function("document.querySelector('[data-application-version]').textContent === '버전 확인 불가'")
                assert page.locator(".service-failure-dialog[open]").count() == 0
                assert title.input_value() == "새 버전 확인 중에도 유지할 미저장 입력"
                mode = "ok"
                page.evaluate("window.versionClockOffset+=61000;window.dispatchEvent(new Event('focus'))")
                page.wait_for_function("version => document.querySelector('[data-application-version]').textContent === 'v'+version", arg=version)
                mode = "invalid"
                page.evaluate("window.versionClockOffset+=61000;window.dispatchEvent(new Event('focus'))")
                page.wait_for_function("() => document.querySelector('[data-application-version]').classList.contains('is-unavailable')")
                mode = "ok"
                page.evaluate("window.versionClockOffset+=61000;window.dispatchEvent(new Event('focus'))")
                page.wait_for_function("version => document.querySelector('[data-application-version]').textContent === 'v'+version", arg=version)
                assert not writes and not errors, (writes, errors)
                assert title.input_value() == "새 버전 확인 중에도 유지할 미저장 입력"
                print(f"PASS {width}px: header version, nonblocking lookup, new deployment, throttling, failure recovery and unsaved input preservation")
                context.close()
            browser.close()
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()
