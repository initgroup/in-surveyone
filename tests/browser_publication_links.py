"""URL modal regression with synthetic APIs only; never rotates a real URL."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import json
from threading import Thread
from http.server import ThreadingHTTPServer
from urllib.parse import urlsplit

from browser_showcase import ROOT, StaticHandler
from playwright.sync_api import sync_playwright


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), StaticHandler)
    Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    output = ROOT / ".tmp" / "publication-links-review"
    output.mkdir(parents=True, exist_ok=True)
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel="msedge", headless=True)
            for width, height in ((1440, 900), (768, 900), (360, 740), (360, 480)):
                context = browser.new_context(viewport={"width": width, "height": height}, reduced_motion="reduce")
                page = context.new_page()
                page.set_default_timeout(7000)
                errors, reads, writes, held = [], [], [], []
                mode, slug = "hold", "synthetic-current"
                project = {"id": "url-fixture", "title": "URL 관리 검증용 합성 설문", "status": "published", "publishedVersion": 8, "slug": slug, "publicUrl": f"/s/{slug}", "questionCount": 300, "responseCount": 0}
                page.on("pageerror", lambda error: errors.append(str(error)))

                def metadata():
                    return {"publicBaseUrl": "https://survey.example.test", "surveyId": project["id"], "title": project["title"], "version": 8, "slug": slug, "publicUrl": f"/s/{slug}", "links": [{"audienceCode": f"group-{index}", "label": f"검증 대상 {index + 1:02d} · 길이가 긴 대상 이름 확인", "url": f"/s/{slug}?audience=group-{index}", "isDefault": index == 0} for index in range(20)]}

                def fulfill(route, data, status=200):
                    route.fulfill(status=status, content_type="application/json", body=json.dumps({"status": "success", "data": data} if status == 200 else data))

                def api(route):
                    nonlocal slug
                    req = route.request
                    path = urlsplit(req.url).path
                    if req.method == "GET":
                        reads.append(path)
                    else:
                        writes.append((req.method, path))
                    if path == "/api/auth/me":
                        fulfill(route, {"user": {"id": "test-owner", "tenantId": "test-tenant", "name": "검증 담당자", "role": "OWNER"}, "expiresAt": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()})
                    elif path == "/api/version":
                        fulfill(route, {"version": (ROOT / "VERSION").read_text(encoding="utf-8").strip()})
                    elif path == "/api/runtime-config":
                        fulfill(route, {"publicBaseUrl": "https://survey.example.test", "environment": "test"})
                    elif path == "/api/surveys/page":
                        fulfill(route, {"items": [project], "page": 1, "pageSize": 24, "total": 1, "totalAll": 1})
                    elif path == "/api/surveys/url-fixture/public-links":
                        if mode == "hold":
                            held.append(route)
                        elif mode == "fail":
                            fulfill(route, {"detail": "Synthetic URL read failure"}, 503)
                        else:
                            fulfill(route, metadata())
                    elif path == "/api/surveys/url-fixture/public-url/regenerate":
                        assert req.method == "POST"
                        slug = "synthetic-rotated"
                        project.update({"slug": slug, "publicUrl": f"/s/{slug}"})
                        fulfill(route, {"surveyId": project["id"], "slug": slug, "publicUrl": f"/s/{slug}"})
                    else:
                        errors.append(f"Unexpected API: {req.method} {path}")
                        fulfill(route, {"detail": "Unknown synthetic route"}, 404)

                page.route("**/api/**", api)
                page.goto(base + "/#/M02001")
                button = page.locator('[data-project-public-links="url-fixture"]')
                button.wait_for()
                page.evaluate("Common.copyText = async text => { window.__copiedUrl = text; }")
                baseline = len(reads)
                button.click()
                modal = page.locator("[data-modal]")
                modal.wait_for(state="visible")
                close = modal.locator('.dialog-close-row button[aria-label="닫기"]')
                done = modal.locator("[data-publication-done]")
                regenerate = modal.locator("[data-publication-regenerate]")
                assert done.is_visible() and close.is_visible()
                assert regenerate.is_disabled()
                page.wait_for_function("document.querySelector('[data-publication-status]').textContent.includes('불러오는')")
                assert len(held) == 1
                mode = "ok"
                fulfill(held.pop(), metadata())
                page.wait_for_function("document.querySelectorAll('[data-publication-url]').length === 20")
                assert reads[baseline:] == ["/api/surveys/url-fixture/public-links"], reads[baseline:]
                assert regenerate.is_enabled()
                metrics = modal.evaluate("""element => {
                    const box = selector => { const r = element.querySelector(selector).getBoundingClientRect(); return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height}; };
                    return {header:box('.modal-drag-bar'),close:box('.dialog-close-row button'),done:box('[data-publication-done]'),regenerate:box('[data-publication-regenerate]'),scroll:box('.publication-scroll'),outerScroll:element.scrollHeight-element.clientHeight,scrollOverflow:getComputedStyle(element.querySelector(".publication-scroll")).overflowY,scrollHeight:element.querySelector(".publication-scroll").scrollHeight,scrollClient:element.querySelector(".publication-scroll").clientHeight,outerOverflow:getComputedStyle(element).overflowY};
                }""")
                assert metrics["close"]["width"] >= 44 and metrics["close"]["height"] >= 44
                assert metrics["close"]["top"] >= metrics["header"]["top"]
                assert metrics["close"]["bottom"] <= metrics["header"]["bottom"]
                assert 0 <= metrics["done"]["top"] < metrics["done"]["bottom"] <= height
                assert metrics["regenerate"]["bottom"] <= height
                assert metrics["outerOverflow"] == "hidden"
                assert metrics["scrollOverflow"] == "auto"
                scroll = modal.locator(".publication-scroll")
                assert scroll.evaluate("element => element.scrollHeight > element.clientHeight")
                scroll.evaluate("element => { element.scrollTop = element.scrollHeight; }")
                assert abs(done.bounding_box()["y"] - metrics["done"]["top"]) < 1
                assert abs(close.bounding_box()["y"] - metrics["close"]["top"]) < 1
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), (width, height, page.evaluate("({width:innerWidth,scroll:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,8).map(e=>[e.tagName,e.className,e.getBoundingClientRect().right])})"))
                page.screenshot(path=str(output / f"long-list-{width}-{height}.png"))
                modal.locator("[data-publication-copy]").last.click()
                assert "audience=group-19" in page.evaluate("window.__copiedUrl")
                assert abs(done.bounding_box()["y"] - metrics["done"]["top"]) < 1
                assert abs(close.bounding_box()["y"] - metrics["close"]["top"]) < 1
                assert modal.evaluate("element => element.scrollTop") == 0
                page.keyboard.press("Escape")
                modal.wait_for(state="hidden")
                assert button.evaluate("element => element === document.activeElement")
                button.press("Enter")
                page.wait_for_function("document.querySelectorAll('[data-publication-url]').length === 20")
                regenerate.click()
                page.locator("[data-message-cancel]").click()
                assert not writes
                regenerate.click()
                page.locator("[data-message-confirm]").click()
                page.wait_for_function("[...document.querySelectorAll('[data-publication-url]')].every(element => element.value.includes('/s/synthetic-rotated?')) && document.querySelectorAll('[data-publication-url]').length === 20")
                assert writes == [("POST", "/api/surveys/url-fixture/public-url/regenerate")]
                done.click()
                modal.wait_for(state="hidden")
                mode = "fail"
                button.click()
                modal.locator("[data-publication-retry]").wait_for()
                page.locator(".service-failure-dialog[open]").wait_for()
                page.locator("[data-failure-return]").click()
                assert regenerate.is_disabled() and done.is_visible()
                mode = "hold"
                baseline = len(reads)
                retry = modal.locator("[data-publication-retry]")
                retry.dispatch_event("click")
                retry.dispatch_event("click")
                assert len(held) == 1
                assert len(reads) == baseline + 1
                mode = "ok"
                fulfill(held.pop(), metadata())
                page.wait_for_function("document.querySelectorAll('[data-publication-url]').length === 20")
                done.click()
                modal.wait_for(state="hidden")
                # Late responses must not reopen or overwrite another layer.
                mode = "hold"
                button.click()
                assert len(held) == 1
                close.click()
                modal.wait_for(state="hidden")
                fulfill(held.pop(), metadata())
                page.wait_for_timeout(60)
                assert not modal.is_visible()
                # Switching from the project action layer must retain the new URL layer.
                mode = "ok"
                page.locator('[data-more-id="url-fixture"]').click()
                modal.locator("[data-modal-public-links]").click()
                page.wait_for_function("document.querySelectorAll('[data-publication-url]').length === 20")
                assert modal.locator("[data-publication-done]").is_visible()
                modal.locator("[data-publication-done]").click()
                modal.wait_for(state="hidden")
                assert not errors, errors
                print(f"PASS {width}x{height}: one GET, fixed X/footer, 20 targets, nested scroll, keyboard/focus, copy, rotation, retry and late-close")
                context.close()
            browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
