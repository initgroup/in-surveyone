"""Synthetic browser/API integration; SOLAPI HTTP transport is replaced completely."""
from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta
import json
import logging
import warnings
import os
from pathlib import Path
import sys
from threading import Thread
from http.server import ThreadingHTTPServer
from urllib.parse import urlsplit

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
from backend.solapi import SolapiClient, SolapiTransportError  # noqa: E402
from main import app  # noqa: E402

logging.getLogger("httpx").setLevel(logging.ERROR)


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), StaticHandler)
    Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    output = ROOT / ".tmp" / "delivery-review"
    output.mkdir(parents=True, exist_ok=True)
    original_transport = SolapiClient.request
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel="msedge", headless=True)
            for width in (1440, 768, 360):
                store = MemoryStore(replace(get_settings(), base_url="https://survey.example.test", sms_provider="solapi", kakao_provider="solapi",
                                            solapi_api_key="synthetic-key", solapi_api_secret="synthetic-secret", solapi_default_sender="0212345678", solapi_kakao_pf_id="PF_TEST"))
                user = store._users["user_demo"]
                app.dependency_overrides[current_store] = lambda: store
                app.dependency_overrides[current_user] = lambda: user
                sent, writes, errors = [], [], []
                reject = {"active": False}
                template = {"templateId": "TP_TEST", "name": "기본 설문 참여 안내", "channelId": "PF_TEST", "status": "APPROVED", "content": "#{이름}님, 설문 참여를 부탁드립니다.\n#{URL}",
                            "buttons": [{"buttonType": "WL", "buttonName": "설문 참여", "linkMo": "#{URL}"}], "variables": [{"name": "이름"}, {"name": "URL"}], "messageType": "BA", "emphasizeType": "NONE"}
                def fake_transport(self, method, path, payload=None):
                    if method == "GET":
                        assert path.startswith("/kakao/v2/templates/sendable?")
                        return [template]
                    assert method == "POST" and path == "/messages/v4/send-many/detail"
                    sent.append(payload)
                    if reject["active"]:
                        raise SolapiTransportError("DailyLimitExceeded", uncertain=False, message="일일 50건 한도를 초과했습니다.")
                    return {"messageList": [{"messageId": "synthetic-" + message["customFields"]["surveyoneDeliveryId"], "statusCode": "2000", "customFields": message["customFields"]} for message in payload["messages"]], "failedMessageList": []}
                SolapiClient.request = fake_transport
                context = browser.new_context(viewport={"width": width, "height": 1000}, reduced_motion="reduce")
                page = context.new_page()
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.set_default_timeout(15000)
                with TestClient(app) as client:
                    fail_preview = False
                    def api(route):
                        nonlocal fail_preview
                        req = route.request
                        path = urlsplit(req.url).path
                        if req.method in {"PUT", "POST"} and not path.endswith(("/preview", "/import")):
                            writes.append(path)
                        if path == "/api/auth/me":
                            response = {"user": store._user_view(user).model_dump(by_alias=True, mode="json"), "expiresAt": (utcnow() + timedelta(hours=1)).isoformat()}
                            return route.fulfill(status=200, content_type="application/json", body=json.dumps({"data": response}))
                        if path == "/api/runtime-config":
                            return route.fulfill(status=200, content_type="application/json", body=json.dumps({"data": {"publicBaseUrl": "https://survey.example.test", "environment": "test"}}))
                        if path.endswith("/preview") and fail_preview:
                            fail_preview = False
                            return route.fulfill(status=503, content_type="application/json", body=json.dumps({"detail": "합성 미리보기 재시도"}))
                        headers = {"content-type": req.headers.get("content-type", "application/json")}
                        response = client.request(req.method, path + ("?" + urlsplit(req.url).query if urlsplit(req.url).query else ""), content=req.post_data_buffer, headers=headers)
                        route.fulfill(status=response.status_code, content_type=response.headers.get("content-type", "application/json"), body=response.content)
                    page.route("**/api/**", api)
                    page.goto(base + "/#/M03001?surveyId=survey_demo_social")
                    page.locator('[data-distribution-workflow]:not([hidden])').wait_for()
                    assert page.locator('[data-distribution-step-target]:disabled').count() == 0
                    for step in (2, 1):
                        page.locator(f'[data-distribution-step-target="{step}"]').click()
                        assert page.locator(f'[data-distribution-step="{step}"]').is_visible()
                        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), (width, step)
                    assert not writes and not sent
                    # Help is keyboard accessible, closes with Escape, and never saves.
                    help_toggle = page.get_by_label("배포 작업 도움말", exact=True)
                    help_toggle.focus()
                    page.keyboard.press("Enter")
                    assert help_toggle.evaluate("el => el.parentElement.open")
                    page.keyboard.press("Escape")
                    assert not help_toggle.evaluate("el => el.parentElement.open")
                    assert help_toggle.evaluate("el => el === document.activeElement")
                    assert not writes and not sent
                    if width >= 1200:
                        page.locator('[data-distribution-step-target="2"]').click()
                        editor = page.locator('.distribution-compose-editor')
                        editor.evaluate("el => { el.scrollTop = 90; }")
                        page.locator('[data-distribution-step-target="1"]').click()
                    # URL management stays on this route and preserves dirty cells and scroll.
                    page.locator('[data-recipient-list] [data-recipient-field="name"]').first.fill("레이어 전 입력")
                    before_layer = page.evaluate("({url:location.href,y:scrollY, grid:document.querySelector('[data-recipient-grid]').scrollTop})")
                    url_button = page.locator('[data-distribution-workflow] [data-project-url-management]').first.bounding_box()
                    hit = page.evaluate("p => document.elementFromPoint(p.x+p.width/2,p.y+p.height/2)?.outerHTML", url_button)
                    assert hit and "data-project-url-management" in hit, (width, url_button, hit)
                    page.mouse.click(url_button["x"] + url_button["width"] / 2, url_button["y"] + url_button["height"] / 2)
                    page.locator('.publication-links [data-publication-link]').first.wait_for()
                    page.locator('[data-publication-done]').click()
                    page.wait_for_function("!document.querySelector('.modal-dialog').open" if page.locator('.modal-dialog').count() else "!document.querySelector('[data-publication-done]')")
                    assert page.evaluate("({url:location.href,y:scrollY, grid:document.querySelector('[data-recipient-grid]').scrollTop})") == before_layer
                    assert page.locator('[data-recipient-list] [data-recipient-field="name"]').first.input_value() == "레이어 전 입력"
                    page.locator('[data-recipient-list] [data-recipient-field="name"]').first.fill("")
                    assert not writes and not sent
                    page.screenshot(path=str(output / f"workspace-{width}.png"), full_page=False)
                    def paste(selector, text):
                        cell = page.locator(selector).first
                        cell.focus()
                        cell.evaluate("""(element, text) => {
                            const clipboard = new DataTransfer();
                            clipboard.setData('text/plain', text);
                            element.dispatchEvent(new ClipboardEvent('paste', {clipboardData: clipboard, bubbles: true, cancelable: true}));
                        }""", text)
                    first_name = '[data-recipient-list] [data-recipient-field="name"]'
                    first_mobile = '[data-recipient-list] [data-recipient-field="mobile"]'
                    assert page.locator('[data-recipient-row]').count() == 5
                    assert page.locator('[data-recipient-paste]').count() == 0
                    # Blank rows are UI only; row selection and keyboard movement never save.
                    page.locator(first_name).first.fill("수동 입력 검증")
                    page.keyboard.press("Tab")
                    assert page.locator(first_mobile).first.evaluate("element => element === document.activeElement")
                    page.keyboard.press("Enter")
                    assert page.locator(first_mobile).nth(1).evaluate("element => element === document.activeElement")
                    page.locator(first_name).first.fill("")
                    if width == 1440:
                        huge = "\n".join(f"대량 대상 {i}\t010{i:08}" for i in range(1, 2001))
                        paste(first_name, huge)
                        assert "등록 2,000명" in page.locator('[data-recipient-selection-count]').inner_text()
                        page.locator('[data-undo-recipient-paste]').click()
                        paste(first_name, huge + "\n초과 대상\t01099999999")
                        assert "등록 0명" in page.locator('[data-recipient-selection-count]').inner_text()
                    rows = ["이름\t휴대전화\t이메일", *[f"대상자 A{i:03}\t010{1000+i:08}\t" for i in range(1, 27)]]
                    paste(first_name, "\n".join(rows))
                    assert page.locator('[data-recipient-row]').count() == 25
                    assert "발송 선택 26명" in page.locator('[data-recipient-selection-count]').inner_text()
                    assert page.locator('[data-recipient-detail-title]').inner_text().startswith("1행")
                    assert not writes and not sent
                    if width > 960:
                        grid = page.locator('[data-recipient-grid]')
                        grid_box = grid.bounding_box()
                        detail_box = page.locator('[data-recipient-detail]').bounding_box()
                        footer_box = page.locator('.distribution-step-actions').bounding_box()
                        assert grid_box["height"] >= 250, grid_box
                        assert detail_box["y"] >= grid_box["y"] + grid_box["height"]
                        assert detail_box["y"] + detail_box["height"] <= footer_box["y"] + 1
                        command = page.locator('[data-distribution-save]').first
                        before = command.bounding_box()["y"]
                        outer = page.evaluate("scrollY")
                        grid.evaluate("el => el.scrollTop = 150")
                        assert grid.evaluate("el => el.scrollTop") > 0
                        assert page.evaluate("scrollY") == outer
                        assert command.bounding_box()["y"] == before
                        grid.evaluate("el => el.scrollTop = 0")
                    # Undo restores the previous cells, not revision or publication metadata.
                    page.locator('[data-undo-recipient-paste]').click()
                    assert "등록 0명" in page.locator('[data-recipient-selection-count]').inner_text()
                    assert page.locator(first_name).first.input_value() == ""
                    paste(first_name, "\n".join(rows))
                    # Enter/arrow navigation preserves the selected column across grid pages.
                    page.locator(first_mobile).nth(24).focus()
                    page.keyboard.press("Enter")
                    assert page.locator('[data-recipient-row]').count() == 1
                    page.keyboard.press("ArrowUp")
                    assert page.locator('[data-recipient-row]').count() == 25
                    # A 2x2 block starting at mobile preserves each row's name.
                    paste(first_mobile, "01000001099\tchanged@example.test\n01000001098\tother@example.test")
                    assert page.locator(first_name).first.input_value() == "대상자 A001"
                    assert page.locator('[data-recipient-list] [data-recipient-field="email"]').first.input_value() == "changed@example.test"
                    page.locator('[data-undo-recipient-paste]').click()
                    assert page.locator(first_mobile).first.input_value() == "01000001001"
                    # A reordered Excel header is applied automatically, without a mapping screen.
                    paste(first_name, "이메일\t이름\t휴대전화\nreordered@example.test\t대상자 A001\t01000001001")
                    assert page.locator('[data-recipient-list] [data-recipient-field="email"]').first.input_value() == "reordered@example.test"
                    page.locator('[data-undo-recipient-paste]').click()
                    # Invalid blocks do not partially mutate the grid.
                    paste(first_name, "name\tmobile\temail\nInvalid\t010-****-0000\tx@example.test")
                    assert page.locator(first_name).first.input_value() == "대상자 A001"
                    # Row -> detail -> grid edits stay in sync, without a server request.
                    page.locator('[data-open-recipient-detail]').first.click()
                    page.locator('[data-recipient-detail] [data-recipient-field="name"]').fill("상세 수정 대상자")
                    assert page.locator(first_name).first.input_value() == "상세 수정 대상자"
                    page.locator(first_name).first.fill("대상자 A001")
                    assert "대상자 A001" in page.locator('[data-recipient-detail-title]').inner_text()
                    page.locator('[data-recipient-selected]').nth(1).uncheck()
                    assert not writes and not sent
                    # Header, rows and selected details all fit inside the page on mobile.
                    for toast in page.locator('[data-toast-close]').all():
                        toast.click()
                    page.locator('[data-recipient-grid]').evaluate("element => element.scrollIntoView({block: 'start'})")
                    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
                    page.screenshot(path=str(output / f"grid-{width}.png"), full_page=False)
                    page.locator('[data-distribution-save]').first.click()
                    page.wait_for_function("document.querySelector('[data-recipient-list] [data-recipient-field=mobile]').value.includes('*')")
                    assert "발송 선택 25명" in page.locator('[data-recipient-selection-count]').inner_text()
                    assert page.locator(first_mobile).first.get_attribute("readonly") is not None
                    # Existing channel choices survive replacement of the entire contact value.
                    page.locator('[data-open-recipient-detail]').first.click()
                    page.locator('[data-recipient-channel="KAKAO"]').uncheck()
                    # Editing a persisted number replaces the entire value and its Kakao mirror.
                    page.locator('[data-recipient-row]').first.locator('[data-replace-recipient-contact="mobile"]').click()
                    page.locator(first_name).first.fill("이름 수정 중")
                    page.locator(first_name).first.fill("대상자 A001")
                    page.locator(first_mobile).first.fill("01000001001")
                    assert page.locator('[data-recipient-detail] [data-recipient-field="kakaoId"]').input_value() == "01000001001"
                    assert not page.locator('[data-recipient-channel="KAKAO"]').is_checked()
                    page.locator('[data-recipient-channel="KAKAO"]').check()
                    page.locator('[data-distribution-save]').first.click()
                    page.wait_for_function("document.querySelector('[data-recipient-list] [data-recipient-field=mobile]').value.includes('*')")
                    page.locator('[data-distribution-step-target="2"]').click()
                    page.locator(".distribution-channel-advanced").evaluate("element => element.open = true")
                    page.locator('[data-distribution-channel="SMS"]').check()
                    page.locator('[data-distribution-channel="KAKAO"]').check()
                    assert page.locator('[data-delivery-option="senderNumber"]').input_value() == "0212345678"
                    page.locator('[data-delivery-option="senderNumber"]').fill("0233334444")
                    page.locator('[data-apply-default-sender]').click()
                    page.wait_for_function("document.querySelector('[data-delivery-option=senderNumber]').value === '0212345678'")
                    page.keyboard.press("Escape")
                    assert not page.locator(".distribution-channel-advanced").evaluate("el => el.open")
                    assert not page.locator(".distribution-channel-settings").is_visible()
                    page.locator('[data-message-preset]').first.select_option("closing")
                    # Basic examples are editable registration drafts; they never become approved plans.
                    before_library = page.locator('[data-distribution-step] input, [data-distribution-step] textarea, [data-distribution-step] select').evaluate_all("nodes=>nodes.map(el=>[el.value,el.checked])")
                    page.locator('[data-manage-kakao-templates]').first.click()
                    page.locator('[data-library-tab="basic"]').click()
                    assert page.locator('[data-library-item]').count() == 3
                    page.locator('[data-library-item="invitation"]').click()
                    assert "#{설문URL}" in page.locator('[data-library-content]').input_value()
                    page.locator('[data-library-content]').fill("등록 초안 #{이름} #{설문URL}")
                    assert page.locator('[data-library-apply]').is_hidden()
                    page.evaluate("window.libraryCopyOriginal=Common.copyText; Common.copyText=async text=>{window.libraryCopied=text;}")
                    page.locator('[data-library-copy]').click()
                    assert page.evaluate("window.libraryCopied") == "등록 초안 #{이름} #{설문URL}"
                    page.evaluate("Common.copyText=window.libraryCopyOriginal")
                    assert page.locator('.kakao-library > header a').get_attribute('href') == "https://console.solapi.com/kakao/templates"
                    assert page.evaluate("document.documentElement.scrollWidth<=innerWidth+1")
                    page.screenshot(path=str(output / f"template-library-basic-{width}.png"), full_page=False)
                    page.keyboard.press("Escape")
                    assert page.locator('[data-distribution-step] input, [data-distribution-step] textarea, [data-distribution-step] select').evaluate_all("nodes=>nodes.map(el=>[el.value,el.checked])") == before_library
                    page.locator('[data-manage-kakao-templates]').first.click()
                    page.locator('[data-library-reload]').click()
                    page.locator('[data-library-item="TP_TEST"]').wait_for()
                    page.locator('[data-library-item="TP_TEST"]').click()
                    assert "#{URL}" in page.locator('[data-library-detail]').inner_text()
                    page.locator('[data-library-apply]').click()
                    assert page.evaluate("!document.querySelector('dialog[open]')")
                    assert page.locator('[data-kakao-template]').first.input_value() == "TP_TEST"
                    page.locator('[data-load-kakao-templates]').first.click()
                    page.locator('[data-kakao-template]').first.select_option("TP_TEST")
                    assert page.locator('[data-kakao-variable]').count() == 2
                    if width == 1440:
                        page.set_viewport_size({"width": width, "height": 800})
                        page.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
                        page.locator('[data-distribution-workflow]').evaluate("el => el.scrollIntoView({block:'start'})")
                        layout_probe = """() => [...document.querySelectorAll('.distribution-workflow-head,.distribution-statusbar,.distribution-project-context,.distribution-context-summary,.distribution-context-meta,.distribution-compose-editor')].map(el=>({name:el.className,rect:el.getBoundingClientRect().toJSON(),position:getComputedStyle(el).position,display:getComputedStyle(el).display}))"""
                        before_layout = page.evaluate(layout_probe)
                        before_height = page.locator('.distribution-compose-editor').bounding_box()["height"]
                        assert before_height >= 380, before_height
                        page.locator('[data-distribution-project-context] > summary').click()
                        if page.locator('.distribution-compose-editor').bounding_box()["height"] != before_height:
                            page.screenshot(path=str(output / "layout-failure.png"), full_page=False)
                        assert abs(page.locator('.distribution-compose-editor').bounding_box()["height"] - before_height) <= 1, (before_layout, page.evaluate(layout_probe))
                        page.keyboard.press("Escape")
                        page.locator('.distribution-channel-advanced > summary').click()
                        assert page.locator('.distribution-compose-editor').bounding_box()["height"] == before_height
                        page.keyboard.press("Escape")
                        for selector in (".distribution-compose-editor", ".distribution-send-desk", "[data-distribution-execute]", "[data-delivery-consent]"):
                            box = page.locator(selector).bounding_box()
                            assert box["y"] >= 60 and box["y"] + box["height"] <= 800, (selector, box)
                    page.locator('[data-compose-channel="KAKAO"]').click()
                    page.locator('.distribution-message-device.is-kakao.is-preview-ready').wait_for()
                    page.screenshot(path=str(output / f"kakao-workspace-{width}.png"), full_page=False)
                    page.locator(".distribution-channel-advanced > summary").click()
                    page.locator('[data-distribution-channel="SMS"]').check()
                    page.keyboard.press("Escape")
                    page.screenshot(path=str(output / f"template-{width}.png"), full_page=False)
                    page.locator('[data-distribution-step-target="2"]').click()
                    fail_preview = width == 768
                    page.locator('[data-preview-delivery]').click()
                    if width == 768:
                        page.locator(".service-failure-dialog[open]").wait_for()
                        page.locator("[data-failure-return]").click()
                        page.locator('[data-preview-delivery]').click()
                    page.locator('.distribution-message-device.is-preview-ready').wait_for()
                    assert page.locator('.distribution-message-legend').first.is_visible()
                    legend = page.locator('.distribution-message-legend').first.inner_text()
                    assert all(token in legend for token in ('{{name}}', '{{surveyTitle}}', '{{surveyUrl}}', '{{closingDate}}'))

                    assert "총 50건" in page.locator('[data-delivery-preview]').inner_text()
                    assert page.locator(".distribution-device-chrome").is_visible()
                    assert "대상자 A002" not in page.locator('[data-delivery-preview]').inner_text()
                    assert "01000001001" not in page.locator('[data-delivery-preview]').inner_text()
                    assert "{{surveyUrl}}" not in page.locator('[data-delivery-preview]').inner_text()
                    # Individual mode uses an explicit receiver even if bulk sending is unchecked.
                    page.locator('[name="sendScope"][value="INDIVIDUAL"]').check()
                    assert page.locator("[data-distribution-execute]").is_disabled()
                    page.locator("[data-individual-search]").fill("A002")
                    page.locator("[data-individual-recipient]").click()
                    page.locator('[name="individualContact"][value="SMS"]').check()
                    page.wait_for_function('document.querySelector(".distribution-message-device header strong")?.textContent === "대상자 A002"')
                    page.wait_for_function('document.querySelector("[data-delivery-preview]").textContent.includes("총 1건")')
                    assert "총 1건" in page.locator("[data-delivery-preview]").inner_text()
                    assert "대상자 A001" not in page.locator("[data-delivery-preview]").inner_text()
                    assert page.locator(".distribution-message-device.is-sms.is-preview-ready").is_visible()
                    assert 'byte' in page.locator('.distribution-preview-total').inner_text()
                    page.screenshot(path=str(output / f"sms-variables-{width}.png"), full_page=False)

                    # Direct entry uses the same individual contract, never adds a bulk selection.
                    page.locator('.distribution-direct-receiver > summary').click()
                    page.locator('[data-direct-receiver="name"]').fill("직접 입력 수신자")
                    page.locator('[data-direct-receiver="mobile"]').fill("invalid")
                    page.locator('[data-select-direct-receiver]').click()
                    assert page.locator('[data-recipient-scope-error]').is_visible()
                    assert page.locator('[data-distribution-execute]').is_disabled()
                    page.locator('[data-direct-receiver="mobile"]').fill("010-0000-9090")
                    page.locator('[data-select-direct-receiver]').click()
                    page.wait_for_function('document.querySelector(".distribution-message-device.is-preview-ready header strong")?.textContent === "직접 입력 수신자"')
                    assert "총 1건" in page.locator('[data-delivery-preview]').inner_text()
                    assert page.locator('[data-direct-receiver="mobile"]').input_value() == ""
                    assert "010-0000-9090" not in page.locator('[data-delivery-preview]').inner_text()
                    page.screenshot(path=str(output / f"direct-individual-{width}.png"), full_page=False)
                    page.locator('.distribution-direct-receiver > summary').click()
                    page.locator('[data-direct-receiver="name"]').fill("직접 이메일 수신자")
                    page.locator('[data-direct-receiver="email"]').fill("direct@example.test")
                    page.locator('[data-select-direct-receiver]').click()
                    page.locator('.distribution-message-device.is-email.is-preview-ready').wait_for()
                    assert page.locator('[data-distribution-execute]').is_disabled()
                    page.locator('[data-compose-channel="SMS"]').click()

                    page.locator('[name="sendScope"][value="BULK"]').check()
                    page.locator(".distribution-channel-advanced").evaluate("element => element.open = true")
                    page.locator('[data-distribution-channel="KAKAO"]').check()
                    page.keyboard.press("Escape")
                    page.wait_for_function('document.querySelector("[data-delivery-preview]").textContent.includes("총 50건")')
                    # Preview samples do not change the bulk send scope.
                    page.locator("[data-bulk-preview-picker]").evaluate("element => element.open = true")
                    page.locator('[data-preview-search]').fill("A026")
                    page.get_by_role("button", name="대상자 A026", exact=True).click()
                    page.wait_for_function('document.querySelector(".distribution-message-device header strong")?.textContent === "대상자 A026"')
                    assert "대상자 A026" in page.locator('.distribution-message-content').inner_text()
                    assert page.locator('.distribution-message-content a').get_attribute("href").startswith("https://survey.example.test/s/")
                    page.locator('[data-preview-channel="KAKAO"]').click()
                    assert page.locator('.distribution-message-link').get_attribute("href").startswith("https://survey.example.test/s/")
                    assert page.locator(".distribution-message-device.is-kakao.is-preview-ready").is_visible()
                    # Opening the layer here must not move either workspace column or the page.
                    for toast in page.locator("[data-toast-close]").all():
                        toast.click()
                    page.wait_for_selector(".toast-region .toast", state="detached")
                    page.locator('[data-distribution-workflow] [data-project-url-management]').first.scroll_into_view_if_needed()
                    position = page.evaluate("({url:location.href,y:scrollY,left:document.querySelector('.distribution-compose-editor').scrollTop,right:document.querySelector('.distribution-send-desk').scrollTop})")
                    url_button = page.locator('[data-distribution-workflow] [data-project-url-management]').first.bounding_box()
                    hit = page.evaluate("p => document.elementFromPoint(p.x+p.width/2,p.y+p.height/2)?.outerHTML", url_button)
                    assert hit and "data-project-url-management" in hit, (width, url_button, hit)
                    page.mouse.click(url_button["x"] + url_button["width"] / 2, url_button["y"] + url_button["height"] / 2)
                    page.locator('.publication-links [data-publication-link]').first.wait_for()
                    assert page.evaluate("scrollY") == position["y"], (position, page.evaluate("({y:scrollY,max:document.documentElement.scrollHeight-innerHeight})"))
                    page.keyboard.press("Escape")
                    page.wait_for_function("!document.querySelector('[data-publication-done]')")
                    after_position = page.evaluate("({url:location.href,y:scrollY,left:document.querySelector('.distribution-compose-editor').scrollTop,right:document.querySelector('.distribution-send-desk').scrollTop})")
                    assert after_position == position, (width, position, after_position)
                    assert page.locator('.distribution-message-device header strong').inner_text() == "대상자 A026"
                    # The same preview screen sends a scheduled plan with one final action.
                    page.locator('[name="scheduleMode"][value="SCHEDULED"]').check()
                    local_time = page.evaluate("() => { const d=new Date(Date.now()+7200000); const p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }")
                    page.locator('[data-scheduled-at]').fill(local_time)
                    expected_schedule = page.evaluate("value => new Date(value).toISOString()", local_time)
                    page.wait_for_function('!document.querySelector("[data-delivery-consent]").disabled')
                    assert page.locator('[data-distribution-execute]').inner_text() == "예약 발송 요청"
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f"horizontal overflow at {width}"
                    if width <= 960:
                        page.locator("[data-delivery-preview]").evaluate("element => element.scrollIntoView({block: 'start'})")
                    else:
                        page.locator('[data-distribution-workflow]').evaluate("el => el.scrollIntoView({block:'start'})")
                    if width <= 800:
                        footer = page.locator(".distribution-step-actions").bounding_box()
                        nav = page.locator(".mobile-bottom-nav").bounding_box()
                        assert footer["y"] + footer["height"] <= nav["y"] + 1, (footer, nav)
                    page.screenshot(path=str(output / f"preview-{width}.png"), full_page=False)
                    page.locator('[data-delivery-consent]').check()
                    page.locator('[data-distribution-execute]').click()
                    page.locator('[data-message-confirm]').click()
                    page.wait_for_function('document.querySelector("[data-execution-result]").textContent.includes("접수 50건")')
                    page.wait_for_function('document.querySelector("[data-delivery-history]").open && document.querySelectorAll("[data-history-content] tbody tr").length === 50')
                    assert page.locator('[data-delivery-history] [data-execution-result]').count() == 1
                    assert page.locator('[data-distribution-workflow] [data-execution-result]').count() == 0
                    assert page.locator('[data-history-survey]').input_value() == "survey_demo_social"
                    assert page.locator('[data-history-status]').input_value() == ""
                    assert page.locator('.delivery-current-request').evaluate("el=>!el.open")
                    result_box = page.locator('[data-execution-result]').bounding_box()
                    workflow_box = page.locator('[data-distribution-workflow]').bounding_box()
                    assert result_box["y"] >= workflow_box["y"] + workflow_box["height"], (width, result_box, workflow_box)
                    page.screenshot(path=str(output / f"result-linked-{width}.png"), full_page=False)
                    assert len(sent) == 2 and sum(len(item["messages"]) for item in sent) == 50
                    assert all(datetime.fromisoformat(item["scheduledDate"]) == datetime.fromisoformat(expected_schedule) for item in sent)
                    assert all(message["to"] != "01000001002" for item in sent for message in item["messages"])
                    assert page.locator('[data-distribution-execute]').is_disabled()
                    page.locator('[data-refresh-delivery]').click()
                    assert len(sent) == 2
                    store.settings = replace(store.settings, solapi_default_sender="0211112222")
                    assert page.locator('[data-delivery-option="senderNumber"]').is_enabled()
                    assert page.locator('[data-delivery-option="senderNumber"]').input_value() == "0212345678"
                    assert page.locator('[data-start-new-distribution], [data-new-distribution-batch]').count() == 0
                    page.locator('[data-apply-default-sender]').click()
                    page.wait_for_function("document.querySelector('[data-delivery-option=senderNumber]').value === '0211112222'")
                    page.locator('[data-distribution-step-target="1"]').click()
                    assert '*' in page.locator('[data-recipient-field="mobile"]').first.input_value()
                    assert "등록 28명" in page.locator('[data-recipient-selection-count]').inner_text()
                    page.locator('[data-distribution-save]').click()
                    page.wait_for_function("!document.querySelector('[data-distribution-save]').disabled")
                    assert '*' in page.locator('[data-recipient-field="mobile"]').first.input_value()
                    # File imports remain an optional bulk entry point.
                    page.locator('[data-recipient-file]').set_input_files({"name": "synthetic.csv", "mimeType": "text/csv", "buffer": b"name,countryCode,preferredLanguage,mobile\nSynthetic,KR,ko,01012345678\n"})
                    page.locator('[data-apply-recipient-import="append"]').wait_for()
                    page.locator('[data-apply-recipient-import="replace"]').click()
                    page.locator('[data-message-confirm]').click()
                    assert page.locator(first_name).first.input_value() == "Synthetic"
                    if not page.locator("[data-delivery-history]").evaluate("el=>el.open"):
                        page.locator('[data-delivery-history] > summary').click()
                    page.locator('[data-history-load]').click()
                    page.locator('[data-history-content] table tbody tr').first.wait_for()
                    assert page.locator('[data-history-content] table tbody tr').count() == 50
                    assert "01000001001" not in page.locator('[data-history-content]').inner_text()
                    page.select_option('[data-history-status]', "FAILED")
                    page.get_by_text("표시할 발송 기록이 없습니다.", exact=True).wait_for()
                    page.select_option('[data-history-status]', "ACCEPTED")
                    page.locator('[data-history-content] table tbody tr').first.wait_for()
                    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
                    page.locator('[data-history-content] details').first.locator('summary').click()
                    assert "synthetic-" in page.locator('[data-history-content]').inner_text()
                    # A later request hits the synthetic daily limit; both immediate result
                    # and persistent history must show the actual returned explanation.
                    reject["active"] = True
                    page.locator('[data-distribution-step-target="2"]').click()
                    page.locator('[data-preview-delivery]').click()
                    page.locator('.distribution-message-device.is-preview-ready').wait_for()
                    page.locator('[data-delivery-consent]').check()
                    page.locator('[data-distribution-execute]').click()
                    page.locator('[data-message-confirm]').click()
                    page.wait_for_function('document.querySelector("[data-execution-result]").textContent.includes("일일 50건 한도를 초과했습니다.")')
                    assert page.locator("[data-execution-result]").evaluate("el=>el.classList.contains('has-failures')")
                    page.select_option('[data-history-status]', "FAILED")
                    page.wait_for_function('document.querySelector("[data-history-content]").textContent.includes("일일 50건 한도를 초과했습니다.")')
                    assert page.locator('[data-history-content] table tbody tr').count() == 2
                    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
                    for toast in page.locator('[data-toast-close]').all():
                        toast.click()
                    page.locator('[data-history-content]').evaluate("element => element.scrollIntoView({block:'start'})")
                    page.screenshot(path=str(output / f"history-{width}.png"), full_page=False)
                    # Email content uses the same personalized server preview in an opaque frame.
                    page.locator('[data-distribution-step-target="1"]').click()
                    page.locator(first_name).first.fill("이메일 미리보기 대상")
                    page.locator('[data-recipient-list] [data-recipient-field="email"]').first.fill("preview@example.test")
                    page.locator('[data-distribution-step-target="2"]').click()
                    page.locator(".distribution-channel-advanced").evaluate("element => element.open = true")
                    page.locator('[data-distribution-channel="SMS"]').uncheck()
                    page.locator('[data-distribution-channel="KAKAO"]').uncheck()
                    page.locator('[data-distribution-channel="EMAIL"]').check()
                    page.keyboard.press("Escape")
                    page.locator('[data-message-field="emailSubject"]').fill("{{name}} 고객님 설문 안내")
                    external_requests = []
                    page.on("request", lambda request: external_requests.append(request.url) if "preview-tracker.invalid" in request.url else None)
                    page.locator('[data-message-field="emailBody"]').fill('<p>{{name}} 고객님</p><p>설문 참여를 부탁드립니다.</p><a href="{{surveyUrl}}">설문URL바로가기</a><img src="https://preview-tracker.invalid/pixel"><script>parent.emailPreviewScriptRan=true</script>')
                    frame = page.frame_locator('.distribution-email-preview')
                    frame.get_by_text("이메일 미리보기 대상 고객님", exact=True).wait_for()
                    if width <= 960:
                        page.locator("[data-delivery-preview]").evaluate("el => el.scrollIntoView({block:'start'})")
                    assert page.locator('.distribution-email-subject').inner_text() == "이메일 미리보기 대상 고객님 설문 안내"
                    assert frame.get_by_role("link", name="설문URL바로가기").get_attribute("href").startswith("https://survey.example.test/s/")
                    assert page.locator('.distribution-email-preview').get_attribute("sandbox") == ""
                    assert page.locator(".distribution-message-device.is-email.is-preview-ready").is_visible()
                    page.screenshot(path=str(output / f"email-{width}.png"), full_page=False)
                    assert page.evaluate("window.emailPreviewScriptRan") is None
                    assert not external_requests
                    assert page.locator("[data-distribution-execute]").is_disabled()
                    assert page.locator("[data-distribution-execute]").inner_text() == "이메일 발송 미연동"
                    page.locator('[data-delivery-consent]').check()
                    page.locator('[data-message-field="emailSubject"]').fill("변경한 제목")
                    assert not page.locator('[data-delivery-consent]').is_checked()
                    assert page.locator('[data-distribution-execute]').is_disabled()
                    assert not errors, errors
                    print(f"distribution {width}px: grid paste/undo, header recognition, keyboard, detail sync, selection, masked edits, templates, fake send and file import passed")
                context.close()
            browser.close()
    finally:
        SolapiClient.request = original_transport
        app.dependency_overrides.pop(current_store, None)
        app.dependency_overrides.pop(current_user, None)
        server.shutdown()
    print(f"Synthetic screenshots: {output}")


if __name__ == "__main__":
    main()
