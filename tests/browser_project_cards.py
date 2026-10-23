"""Project footer layout regression with synthetic data; no API mutations."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from http.server import ThreadingHTTPServer
import json
from threading import Thread
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

from browser_showcase import ROOT, StaticHandler


def main():
    projects = [{"id": f"layout-{index}", "title": f"카드 정렬 확인 {index + 1}",
                 "status": "published" if index < 3 else "draft", "category": "일반조사",
                 "publicUrl": f"/s/layout-{index}" if index < 3 else None,
                 "questionCount": 12, "responseCount": index,
                 "updatedAt": date, "description": "날짜와 버튼 영역의 합성 레이아웃 확인"}
                for index, date in enumerate(["2026-10-22T09:00:00Z", "2026-09-09T09:00:00Z", "2026-08-14T09:00:00Z"] * 2)]
    server = ThreadingHTTPServer(("127.0.0.1", 0), StaticHandler)
    Thread(target=server.serve_forever, daemon=True).start()
    output = ROOT / ".tmp" / "project-card-review"
    output.mkdir(parents=True, exist_ok=True)
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel="msedge", headless=True)
            for width in (1920, 1440, 1024, 768, 360):
                context = browser.new_context(viewport={"width": width, "height": 1000}, reduced_motion="reduce")
                page = context.new_page()
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                def api(route):
                    request = route.request
                    assert request.method == "GET", "Layout checks must never write"
                    path = urlsplit(request.url).path
                    if path == "/api/auth/me":
                        data = {"user": {"id": "layout-owner", "tenantId": "layout-tenant", "name": "검증 담당자", "role": "OWNER"},
                                "expiresAt": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()}
                    elif path == "/api/version":
                        data = {"version": (ROOT / "VERSION").read_text(encoding="utf-8").strip()}
                    elif path == "/api/runtime-config":
                        data = {"publicBaseUrl": "https://survey.example.test", "environment": "test"}
                    elif path == "/api/surveys/page":
                        data = {"items": projects, "page": 1, "pageSize": 24, "total": 6, "totalAll": 6}
                    else:
                        raise AssertionError(f"Unexpected layout API: {path}")
                    route.fulfill(status=200, content_type="application/json", body=json.dumps({"data": data}))
                page.route("**/api/**", api)
                page.goto(f"http://127.0.0.1:{server.server_address[1]}/#/M02001")
                page.locator(".project-card-updated").nth(5).wait_for()
                page.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
                metrics = page.locator(".project-card").evaluate_all("""cards => cards.map(card => {
                    const footer = card.querySelector('.project-card-footer');
                    const date = footer.querySelector('.project-card-updated');
                    const rect = node => { const r = node.getBoundingClientRect(); return {x:r.x,y:r.y,right:r.right,bottom:r.bottom}; };
                    const range = document.createRange(); range.selectNodeContents(date);
                    return {card:rect(card),footer:rect(footer),date:rect(date),dateLines:range.getClientRects().length,
                            buttons:[...footer.querySelectorAll('button')].map(button => {
                                const text = document.createRange(); text.selectNodeContents(button);
                                return {rect:rect(button),height:button.getBoundingClientRect().height,text:button.innerText};
                            })};
                })""")
                for metric in metrics:
                    assert metric["dateLines"] == 1, (width, metric)
                    assert metric["date"]["right"] <= metric["card"]["right"], (width, metric)
                    for button in metric["buttons"]:
                        bounds = button["rect"]
                        assert bounds["x"] >= metric["card"]["x"] and bounds["right"] <= metric["card"]["right"], (width, button)
                        assert bounds["y"] >= metric["footer"]["y"] and bounds["bottom"] <= metric["footer"]["bottom"], (width, button)
                        assert bounds["right"] <= metric["date"]["x"] or bounds["x"] >= metric["date"]["right"] or bounds["y"] >= metric["date"]["bottom"], (width, metric)
                assert "2026.10.22 수정" in page.locator(".project-card-updated").first.inner_text()
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), width
                assert not errors, errors
                page.screenshot(path=str(output / f"cards-{width}.png"), full_page=True)
                print(f"PASS {width}px: date stays on one line; actions remain inside published and draft cards")
                context.close()
            browser.close()
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()
