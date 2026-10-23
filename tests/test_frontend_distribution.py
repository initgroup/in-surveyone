from __future__ import annotations

import json
from pathlib import Path
import shutil
import subprocess

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_distribution_starts_with_finalized_project_browser_and_two_step_workflow() -> None:
    html = (PROJECT_ROOT / "frontend" / "pages" / "M03001.html").read_text(
        encoding="utf-8"
    )
    script = (PROJECT_ROOT / "frontend" / "js" / "M03001.js").read_text(
        encoding="utf-8"
    )
    css = (PROJECT_ROOT / "frontend" / "css" / "pages" / "M03001.css").read_text(
        encoding="utf-8"
    )
    app_css = (PROJECT_ROOT / "frontend" / "css" / "app.css").read_text(
        encoding="utf-8"
    )

    assert "data-distribution-project-view" in html
    assert "data-distribution-project-grid" in html
    assert 'data-distribution-layout="grid"' in html
    assert 'data-distribution-layout="list"' in html
    assert "<select data-distribution-survey" not in html
    assert "data-distribution-workflow hidden" in html
    assert "data-distribution-project-context" in html
    assert "data-distribution-context-title" in html
    assert "data-distribution-context-survey-state" in html
    assert "data-distribution-context-response-state" in html
    assert "data-distribution-context-period-sync" in html
    assert "data-distribution-context-deployment-state" in html
    assert "data-distribution-context-start" in html
    assert "data-distribution-context-end" in html
    assert html.count('data-distribution-save>저장</button>') == 1
    assert "data-distribution-save>초안 저장</button>" not in html
    assert html.count("data-distribution-step-target=") == 2
    assert "data-recipient-grid" in html
    assert "data-recipient-detail" in html
    assert "data-delivery-preview" in html
    assert "data-delivery-consent" in html
    assert "data-delivery-option" in html
    assert 'data-distribution-step-target="4" disabled' not in html
    assert "Excel 양식" in html
    assert '.csv,.txt,.xlsx' in html
    assert "data-recipient-import-progress" in html
    assert "data-recipient-pagination" in html

    assert 'get("/api/surveys?status=published")' in script
    assert 'get("/api/deployments/providers")' in script
    assert "`/api/deployments/by-survey/${encodeURIComponent(id)}`" in script
    assert "`/api/deployments/by-survey/${encodeURIComponent(this.current.id)}`" in script
    assert "`/api/deployments/by-survey/${encodeURIComponent(this.current.id)}/execute`" in script
    assert 'localStorage.getItem("surveyone-distribution-view")' in script
    assert "projectCardMarkup(item)" in script
    assert "preferredLanguage" in script
    assert "countryCode" in script
    assert 'code: "FAX"' in script
    assert 'code: "vi"' in script
    assert 'code: "fil"' in script
    assert "sendStagedDelivery()" in script
    assert "초안 입력값을 확인해 주세요." in script
    assert 'this.root.querySelectorAll("[data-distribution-step] input' in script
    assert "this.syncExecutionLock();" in script
    assert "data-replace-recipient-contact" in script
    assert "replaceMaskedContact(button)" in script
    assert "연락처 마스킹 표시" in script
    assert "distribution-project-public-url" in script
    assert "data-project-url-management" in script
    assert "window.SurveyPublicationLinks.open({" in script
    assert "/public-url/regenerate" not in script
    assert "replaceDraftPublicUrl(previousUrl, nextUrl)" in script
    assert "loadPublishedSurveyState(this.current)" in script
    assert "renderProjectContext()" in script
    assert "availabilityStatus || this.publishedSurvey?.availability_status" in script
    assert 'responseLabel = "응답 시작 전"' in script
    assert 'responseLabel = "응답 기간 종료"' in script
    assert 'querySelector("[data-distribution-context-start]")' in script
    assert 'querySelector("[data-distribution-context-end]")' in script
    assert 'querySelector("[data-distribution-context-period-sync]")' in script
    assert "periodFromSurvey(survey)" in script
    assert "publishedSurveyPeriod()" in script
    assert "M02001 기간 변경 미확정 · 재확정 필요" in script
    assert "distribution-project-period" in script
    assert 'timeZone: "Asia/Seoul"' in script
    assert '"\uc989\uc2dc \uc2dc\uc791 \u00b7 \uc81c\ud55c \uc5c6\uc74c"' in script
    assert '"\uc885\ub8cc \uc81c\ud55c \uc5c6\uc74c"' in script
    assert script.count('target="_blank"') >= 3
    assert script.count('rel="noopener noreferrer"') >= 3
    assert "uploadRecipientFile(file)" in script
    assert "XMLHttpRequest" in script
    assert "this.draft.recipients.slice(offset, offset + this.recipientPageSize)" in script
    assert 'history.replaceState(null, "", `${base}#/M03001`);' in script
    for action in (
        "data-distribution-project-back",
        "data-add-recipient",
        "data-import-recipient",
        "data-download-recipient-sample",
        "data-download-recipient-xlsx",
        "data-distribution-save",
        "data-distribution-previous",
        "data-distribution-next",
        "data-distribution-execute",
        "data-edit-survey-languages",
    ):
        assert action in script

    assert ".distribution-project-grid.is-list" in css
    assert ".distribution-project-card > footer > .button { flex: 0 0 auto; min-width: 76px;" in css
    assert ".distribution-project-public-url { display: grid; flex: 1 1 0; min-width: 0; overflow: hidden; }" in css
    assert ".distribution-project-public-url code { flex: 1 1 auto; min-width: 0; overflow: hidden;" in css
    assert ".distribution-project-context { position: sticky" in css
    assert "scroll-margin-top: calc(var(--header-height) + 12px)" in css
    assert ".distribution-project-period" in css
    assert ".distribution-queue-explanation" in css
    assert ".recipient-grid" in css
    assert ".distribution-channel-grid" in css
    assert ".distribution-message-card" in css
    assert ".distribution-review-summary" in css
    assert ".recipient-import-progress" in css
    assert ".recipient-pagination" in css
    assert "font-family: inherit" in css
    assert "@media (max-width: 52rem)" in css
    assert ".sr-only { position: absolute !important;" in app_css


def test_distribution_payload_keeps_multi_channel_recipients_and_language_messages() -> None:
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node.js is not installed; distribution behavior test skipped.")

    script_path = json.dumps(
        str(PROJECT_ROOT / "frontend" / "js" / "M03001.js")
    )
    harness = f"""
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const scriptPath = {script_path};
const source = fs.readFileSync(scriptPath, "utf8");
const context = {{
    console,
    URL,
    Intl,
    structuredClone,
    Common: {{
        escapeHtml(value) {{ return String(value ?? ""); }},
        formatNumber(value) {{ return String(value ?? 0); }},
        formatDate(value) {{ return String(value ?? ""); }},
        debounce(callback) {{ return callback; }}
    }},
    SURVEYONE_CONFIG: {{ locales: [] }}
}};
context.window = context;
context.globalThis = context;
vm.runInNewContext(source, context, {{ filename: scriptPath }});
const page = Object.create(context.Pages.M03001);
page.current = {{
    id: "survey-101",
    title: "다문화 가정 생활 조사",
    status: "published",
    publishedVersion: 3,
    publicUrl: "/s/multicultural-family",
    languages: {{ sourceLocale: "ko", defaultLocale: "ko", enabled: ["ko", "vi", "fil"] }},
    translations: {{ vi: {{ title: "Khảo sát gia đình đa văn hóa" }} }}
}};
page.publicBaseUrl = "https://survey.example.test";
page.providers = page.normalizeProviders({{
    providers: {{
        email: {{ enabled: true, providerCode: "smtp" }},
        sms: {{ enabled: false, reason: "SMS provider 미설정" }},
        kakao: false,
        fax: {{ status: "READY", providerCode: "fax-api" }}
    }}
}});
assert.equal(page.providerReady("EMAIL"), true);
assert.equal(page.providerReady("SMS"), false);
assert.equal(page.providers.SMS.reason, "SMS provider 미설정");

page.draft = page.normalizeDraft({{
    revision: 7,
    recipients: [{{
        id: "recipient-1",
        name: "응답자 A001",
        countryCode: "VN",
        preferredLanguage: "vi",
        email: "sample@example.com",
        mobile: "010-0000-0000",
        channels: ["EMAIL", "SMS"]
    }}],
    channels: ["EMAIL", "SMS"],
    schedule: {{ mode: "NOW", strategy: "ALL_AVAILABLE" }},
    messagesByLanguage: {{}}
}});
const payload = page.buildPayload();
assert.equal(payload.revision, 7);
assert.equal(payload.status, "DRAFT");
assert.deepEqual(Array.from(payload.channels), ["EMAIL", "SMS"]);
assert.equal(payload.recipients[0].countryCode, "VN");
assert.equal(payload.recipients[0].preferredLanguage, "vi");
assert.deepEqual(Array.from(payload.recipients[0].channels), ["EMAIL", "SMS"]);
assert.ok(payload.messagesByLanguage.vi.emailBody.includes("{{surveyUrl}}"));
assert.ok(payload.messagesByLanguage.vi.emailSubject.includes("{{surveyTitle}}"));
assert.deepEqual(Array.from(payload.schedule.priority).sort(), ["EMAIL", "SMS"]);
page.draft.deliveryOptions.sendScope = "INDIVIDUAL";
page.draft.deliveryOptions.individualRecipientId = "recipient-1";
page.draft.recipients[0].selected = false;
const individualPayload = page.buildPayload();
assert.equal(individualPayload.deliveryOptions.sendScope, "INDIVIDUAL");
assert.equal(individualPayload.recipients[0].selected, false);
assert.equal(page.previewRecipients().length, 1);
page.draft.deliveryOptions.sendScope = "BULK";
assert.equal(page.previewRecipients().length, 0);
page.draft.recipients[0].selected = true;


page.draft.recipients.push(page.blankRecipient());
const payloadWithPlaceholder = page.buildPayload();
assert.equal(payloadWithPlaceholder.recipients.length, 1);
page.draft = page.normalizeDraft({{}});
const emptyDraftPayload = page.buildPayload();
assert.equal(emptyDraftPayload.recipients.length, 0);
assert.deepEqual(Array.from(emptyDraftPayload.channels), []);

const url = page.languageUrl("fil");
assert.equal(url, "https://survey.example.test/s/multicultural-family?lang=fil");
page.draft.messagesByLanguage.ko = {{ emailBody: "https://survey.example.test/s/multicultural-family?lang=ko" }};
page.replaceDraftPublicUrl(
    "https://survey.example.test/s/multicultural-family",
    "https://survey.example.test/s/svy-20260814-0123456789abcdef0123456789abcdef"
);
assert.equal(page.draft.messagesByLanguage.ko.emailBody, "https://survey.example.test/s/svy-20260814-0123456789abcdef0123456789abcdef?lang=ko");
const card = page.projectCardMarkup({{
    id: "survey-101",
    title: "다문화 가정 생활 조사",
    category: "사회조사",
    status: "published",
    publishedVersion: 3,
    questionCount: 12,
    responseCount: 4,
    publicUrl: "/s/svy-0123456789abcdef0123456789abcdef"
    ,startsAt: "2026-08-15T00:00:00Z"
    ,closesAt: "2026-08-31T15:00:00Z"
}});
assert.match(card, /data-open-distribution-project="survey-101"/);
assert.match(card, /확정 v3/);
assert.match(card, /설문 URL/);
assert.ok(card.includes("https://survey.example.test/s/svy-0123456789abcdef0123456789abcdef"));
assert.match(card, /target="_blank"/);
assert.match(card, /설문 기간 · M02001 설정/);

const csv = page.parseCsv('name,countryCode,preferredLanguage,email,mobile,fax,kakaoId,channels\\r\\n"응답자, A001",VN,vi,a@example.com,010,,,EMAIL|SMS\\r\\n');
assert.equal(csv.length, 2);
assert.equal(csv[1][0], "응답자, A001");
assert.equal(csv[1][2], "vi");

page.context = {{ confirmMessage: async () => true, api: {{ get: async () => ({{ defaultSender: "0211112222" }}) }} }};
page.renderExecutionResult = () => {{}};
page.renderRecipients = () => {{}};
page.renderChannels = () => {{}};
page.renderMessages = () => {{}};
page.updateWorkflow = () => {{}};
page.syncExecutionLock = () => {{}};
page.updateSaveState = () => {{}};
page.setActionDisabled = () => {{}};
page.root = {{ querySelector() {{ return {{ focus() {{}} }}; }} }};
page.deliveryDefaults = {{ senderNumber: "0233334444" }};
page.draft = page.normalizeDraft({{ channels: ["EMAIL", "SMS"], deliveryOptions: {{ senderNumber: "0255556666" }}, executionStatus: "QUEUED" }});
assert.equal(page.draft.deliveryOptions.senderNumber, "0255556666");
const beforeRecipients = JSON.stringify(page.draft.recipients);
page.enableDirectEditing();
assert.equal(page.draft.revision, null);
assert.equal(page.draft.executionStatus, null);
assert.equal(page.draft.deliveryOptions.senderNumber, "0255556666");
assert.equal(JSON.stringify(page.draft.recipients), beforeRecipients);
assert.equal(page.awaitingDeliveryEdit, true);
assert.equal(page.previewSignature, null);
assert.deepEqual(Array.from(page.draft.channels), ["EMAIL", "SMS"]);

"""
    result = subprocess.run(
        [node, "-e", harness],
        cwd=PROJECT_ROOT,
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    assert result.returncode == 0, result.stderr
