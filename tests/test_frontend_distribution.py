from __future__ import annotations

import json
from pathlib import Path
import shutil
import subprocess

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_distribution_starts_with_finalized_project_browser_and_four_step_workflow() -> None:
    html = (PROJECT_ROOT / "frontend" / "pages" / "M03001.html").read_text(
        encoding="utf-8"
    )
    script = (PROJECT_ROOT / "frontend" / "js" / "M03001.js").read_text(
        encoding="utf-8"
    )
    css = (PROJECT_ROOT / "frontend" / "css" / "pages" / "M03001.css").read_text(
        encoding="utf-8"
    )

    assert "data-distribution-project-view" in html
    assert "data-distribution-project-grid" in html
    assert 'data-distribution-layout="grid"' in html
    assert 'data-distribution-layout="list"' in html
    assert "<select data-distribution-survey" not in html
    assert "data-distribution-workflow hidden" in html
    assert html.count("data-distribution-step-target=") == 4
    assert "국가·언어·연락수단" in html
    assert "복수 채널·예약 설정" in html
    assert "언어별 설문 URL·메시지" not in html  # compact step labels stay scannable
    assert "언어별 URL과 안내문" in html
    assert "저장하고 발송 실행 요청" in html
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
    assert 'executionStatus === "DISABLED"' in script
    assert 'if (event.target.closest("[data-new-distribution-batch]"))' in script
    assert 'this.draft.recipients = [this.blankRecipient()]' in script
    assert "초안 입력값을 확인해 주세요." in script
    assert 'this.root.querySelectorAll("[data-distribution-step] input' in script
    assert "this.syncExecutionLock();" in script
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
    assert ".distribution-recipient" in css
    assert ".distribution-channel-grid" in css
    assert ".distribution-message-card" in css
    assert ".distribution-review-summary" in css
    assert ".recipient-import-progress" in css
    assert ".recipient-pagination" in css
    assert "font-family: inherit" in css
    assert "@media (max-width: 52rem)" in css


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
assert.match(payload.messagesByLanguage.vi.emailBody, /lang=vi/);
assert.match(payload.messagesByLanguage.vi.emailSubject, /Khảo sát gia đình đa văn hóa/);

page.draft.recipients.push(page.blankRecipient());
const payloadWithPlaceholder = page.buildPayload();
assert.equal(payloadWithPlaceholder.recipients.length, 1);
page.draft = page.normalizeDraft({{}});
const emptyDraftPayload = page.buildPayload();
assert.equal(emptyDraftPayload.recipients.length, 0);
assert.deepEqual(Array.from(emptyDraftPayload.channels), []);

const url = page.languageUrl("fil");
assert.equal(url, "https://survey.example.test/s/multicultural-family?lang=fil");
const card = page.projectCardMarkup({{
    id: "survey-101",
    title: "다문화 가정 생활 조사",
    category: "사회조사",
    status: "published",
    publishedVersion: 3,
    questionCount: 12,
    responseCount: 4
}});
assert.match(card, /data-open-distribution-project="survey-101"/);
assert.match(card, /확정 v3/);

const csv = page.parseCsv('name,countryCode,preferredLanguage,email,mobile,fax,kakaoId,channels\\r\\n"응답자, A001",VN,vi,a@example.com,010,,,EMAIL|SMS\\r\\n');
assert.equal(csv.length, 2);
assert.equal(csv[1][0], "응답자, A001");
assert.equal(csv[1][2], "vi");

page.context = {{ confirmMessage: async () => true }};
page.renderExecutionResult = () => {{}};
page.renderRecipients = () => {{}};
page.renderChannels = () => {{}};
page.renderMessages = () => {{}};
page.updateWorkflow = () => {{}};
page.syncExecutionLock = () => {{}};
page.updateSaveState = () => {{}};
page.root = {{ querySelector() {{ return {{ focus() {{}} }}; }} }};
page.draft = page.normalizeDraft({{ channels: ["EMAIL", "SMS"], executionStatus: "QUEUED" }});
page.startNewBatch().then(() => {{
    assert.equal(page.draft.revision, null);
    assert.equal(page.draft.executionStatus, null);
    assert.equal(page.draft.recipients.length, 1);
    assert.equal(page.draft.recipients[0].email, "");
    assert.deepEqual(Array.from(page.draft.channels), ["EMAIL", "SMS"]);
}}).catch((error) => {{
    console.error(error);
    process.exitCode = 1;
}});
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
