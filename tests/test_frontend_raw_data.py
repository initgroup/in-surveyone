import json
import re
from pathlib import Path
import shutil
import subprocess

import pytest
from fastapi.testclient import TestClient

from main import app


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_raw_data_page_starts_with_analysis_project_browser_and_exports() -> None:
    html = (PROJECT_ROOT / "frontend" / "pages" / "M04001.html").read_text(
        encoding="utf-8"
    )
    script = (PROJECT_ROOT / "frontend" / "js" / "M04001.js").read_text(
        encoding="utf-8"
    )
    css = (PROJECT_ROOT / "frontend" / "css" / "pages" / "M04001.css").read_text(
        encoding="utf-8"
    )

    assert "data-response-project-view" in html
    assert "data-response-project-grid" in html
    assert 'data-response-project-layout="grid"' in html
    assert 'data-response-project-layout="list"' in html
    assert "data-response-workspace" in html
    assert "data-response-project-back" in html
    assert "data-response-query" in html
    assert "data-response-refresh" in html
    assert 'aria-label="최신 응답 새로고침"' in html
    assert 'role="combobox"' not in html
    assert "data-column-summary" in html
    assert "data-response-pagination" in html
    assert "renderProjects(errorMessage" in script
    assert "projectCardMarkup(item)" in script
    assert "showProjectList()" in script
    assert "applyResponseFilters()" in script
    assert "async refreshResponses(button)" in script
    assert 'await this.loadResponses(this.selectedSurveyId, { preserveView: true })' in script
    assert "previousColumns" in script
    assert 'this.root.querySelector("[data-response-refresh]").disabled = !this.selectedSurveyId;' in script
    assert 'this.root.querySelector("[data-response-refresh]").disabled = true;' in script
    set_enabled = script[script.index("setEnabled(enabled)"):script.index("renderMetrics(summary")]
    assert "[data-response-query]" in set_enabled
    assert "[data-response-refresh]" not in set_enabled
    assert 'localStorage.getItem("surveyone-rawdata-view")' in script
    assert "analysisDescriptors" in script
    assert "this.responseLoadToken = 0" in script
    assert "requestToken !== this.responseLoadToken" in script
    assert 'data-export-mode="analysis"' in script
    assert "보기별 1/0 열" in script
    assert ".response-project-grid.is-list" in css
    assert ".analysis-readiness.is-ready" in css
    assert ".response-table th:nth-child(1)" in css
    assert ".response-mobile-list" in css


def test_frontend_assets_are_versioned_and_not_cached_in_local_or_test_mode() -> None:
    index = (PROJECT_ROOT / "frontend" / "index.html").read_text(encoding="utf-8")
    config = (PROJECT_ROOT / "frontend" / "config" / "app.config.js").read_text(
        encoding="utf-8"
    )
    app_script = (PROJECT_ROOT / "frontend" / "js" / "app.js").read_text(
        encoding="utf-8"
    )

    version_match = re.search(r'assetVersion: "(\d{4}\.\d{2}\.\d{2}\.\d+)"', config)
    assert version_match
    version = version_match.group(1)
    public = (PROJECT_ROOT / "frontend" / "public.html").read_text(encoding="utf-8")
    for document in (index, public):
        for asset in ("config/app.config.js", "js/common.js", "js/code-editor.js"):
            assert f'/frontend/{asset}?v={version}' in document
    assert f'/frontend/css/app.css?v={version}' in index
    assert f'/frontend/js/app.js?v={version}' in index
    assert f'/frontend/js/public.js?v={version}' in public
    assert "function versionedAsset(src)" in app_script
    assert 'url.searchParams.set("v", runtimeAssetVersion)' in app_script
    assert "link.href = absoluteHref" in app_script
    assert "script.src = versionedAsset(src)" in app_script

    with TestClient(app) as client:
        document = client.get("/")
        stylesheet = client.get("/frontend/css/pages/M04001.css")

    assert document.status_code == 200
    assert stylesheet.status_code == 200
    assert "no-store" in document.headers["cache-control"]
    assert "no-store" in stylesheet.headers["cache-control"]
    assert ".response-mobile-list" in stylesheet.text


def test_multi_matrix_and_table_answers_are_presented_and_exported_semantically() -> None:
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node.js is not installed; raw-data behavior test skipped.")

    script_path = json.dumps(
        str(PROJECT_ROOT / "frontend" / "js" / "M04001.js")
    )
    harness = f"""
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const scriptPath = {script_path};
const source = fs.readFileSync(scriptPath, "utf8");
const context = {{
    console,
    Common: {{
        escapeHtml(value) {{ return String(value ?? ""); }},
        formatNumber(value) {{ return String(value); }},
        formatDate(value) {{ return String(value ?? ""); }},
        questionsOf(entity) {{ return entity?.questions || []; }}
    }}
}};
context.window = context;
vm.runInNewContext(source, context, {{ filename: scriptPath }});
const page = Object.create(context.Pages.M04001);

const projectCard = page.projectCardMarkup({{
    id: "survey-101",
    title: "다문화 가정 생활 조사",
    category: "사회조사",
    status: "published",
    responseCount: 24,
    questionCount: 8,
    publishedVersion: 2,
    updatedAt: "2026-08-13"
}});
assert.match(projectCard, /data-open-response-project="survey-101"/);
assert.match(projectCard, /분석 가능/);
assert.match(projectCard, /v2/);

const multiple = {{
    id: "q1",
    type: "multiple",
    title: "이용 서비스",
    options: [{{ id: "web", label: "웹" }}, {{ id: "mobile", label: "모바일" }}]
}};
const matrix = {{
    id: "q2",
    type: "matrix_multiple",
    title: "서비스 평가",
    settings: {{
        selectionMode: "multiple",
        rows: [{{ id: "quality", label: "품질" }}],
        columns: [{{ id: "good", label: "만족" }}, {{ id: "fast", label: "빠름" }}]
    }}
}};
const table = {{
    id: "q3",
    type: "table",
    title: "사업체 현황",
    settings: {{
        rows: [{{ id: "head", label: "본사" }}],
        columns: [{{ id: "name", label: "명칭" }}, {{ id: "count", label: "인원" }}]
    }}
}};
const response = {{ answers: {{
    q1: ["web", "mobile"],
    q2: {{ quality: ["good", "fast"] }},
    q3: [["인아이티", 12]]
}} }};

assert.equal(page.answerPresentation(response, multiple).text, "웹 | 모바일");
assert.equal(page.answerPresentation(response, matrix).text, "품질: 만족, 빠름");
assert.equal(page.answerPresentation(response, table).text, "본사: 명칭=인아이티 · 인원=12");

const descriptors = page.analysisDescriptors([
    {{ number: 1, question: multiple }},
    {{ number: 2, question: matrix }}
]);
assert.deepEqual(
    descriptors.map((item) => item.label),
    [
        "Q1. 이용 서비스 [웹]",
        "Q1. 이용 서비스 [모바일]",
        "Q2. 서비스 평가 [품질 / 만족]",
        "Q2. 서비스 평가 [품질 / 빠름]"
    ]
);
assert.deepEqual(descriptors.map((item) => item.value(response)), [1, 1, 1, 1]);
"""
    completed = subprocess.run(
        [node, "-"],
        input=harness,
        text=True,
        encoding="utf-8",
        capture_output=True,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr or completed.stdout


def test_default_columns_refresh_and_xlsx_export_include_all_filtered_pages() -> None:
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node.js is not installed.")
    script_path = str(PROJECT_ROOT / "frontend" / "js" / "M04001.js")
    harness = r'''
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const context = { console, AbortController, setTimeout, clearTimeout, CustomEvent: class { constructor(name, init) { this.type = name; this.detail = init.detail; } },
    Common: { questionsOf: (survey) => survey.questions || [], formatNumber: String }, SURVEYONE_CONFIG: { apiBaseUrl: "" } };
context.window = context;
vm.runInNewContext(fs.readFileSync("frontend/js/common.js", "utf8"), context);
vm.runInNewContext(fs.readFileSync(process.argv[2], "utf8"), context);
(async () => {
    const page = Object.create(context.Pages.M04001);
    const values = { "[data-response-search]": "", "[data-response-state]": "all", "[data-response-from]": "", "[data-response-to]": "" };
    const button = { disabled: false, setAttribute() {}, removeAttribute() {} };
    page.root = { querySelector: (selector) => selector === "[data-export-xlsx]" ? button : ({ value: values[selector] || "", textContent: "" }) };
    const questions = Array.from({ length: 45 }, (_, index) => ({ id: `q-${index}`, type: "number", title: `Question ${index}` }));
    const survey = { title: "Synthetic", sections: [{ id: "section", title: "Section", questions }] };
    const records = Array.from({ length: 250 }, (_, index) => ({ id: `response-${index}`, submittedAt: "2026-10-20T00:00:00Z", answers: [{ questionId: "q-0", value: index }] }));
    const offsets = [];
    page.context = { toast() {}, api: { get: async (url) => {
        if (!url.includes("/responses?")) return survey;
        const offset = Number(new URL(url, "http://fixture.test").searchParams.get("offset"));
        offsets.push(offset);
        return records.slice(offset, offset + 200);
    } } };
    page.selectedSurveyId = "synthetic";
    page.responseLoadToken = 0;
    page.questionEntries = [];
    page.visibleColumns = new Set();
    for (const method of ["renderLoading", "setEnabled", "renderMetrics", "renderTable"]) page[method] = () => {};
    assert.equal(await page.loadResponses("synthetic"), true);
    assert.equal(page.visibleEntries().length, 45);
    assert.deepEqual(offsets, [0, 200]);
    questions.push({ id: "q-45", type: "number", title: "New question" });
    await page.loadResponses("synthetic", { preserveView: true });
    assert.equal(page.visibleColumns.size, 46);
    page.visibleColumns = new Set(["q-44"]);
    await page.loadResponses("synthetic", { preserveView: true });
    assert.equal(page.visibleEntries().map((entry) => entry.id).join(), "q-44");
    page.visibleColumns = new Set();
    await page.loadResponses("synthetic", { preserveView: true });
    assert.equal(page.visibleColumns.size, 0);
    await page.loadResponses("synthetic");
    assert.equal(page.visibleColumns.size, 46);
    page.page = 3;
    page.pageSize = 50;
    page.exportController = new AbortController();
    let request, clicks = 0, revoked = 0;
    context.fetch = async (url, options) => {
        request = { url, ...options, body: JSON.parse(options.body) };
        return { ok: true, headers: { get: () => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, blob: async () => ({ size: 123 }) };
    };
    context.URL = { createObjectURL: () => "blob:synthetic", revokeObjectURL: () => revoked++ };
    context.document = { createElement: () => ({ click() { clicks++; }, remove() {} }), body: { append() {} } };
    await page.exportXlsx("visible");
    assert.equal(request.method, "POST");
    assert.equal(request.credentials, "same-origin");
    assert.equal(request.body.responseIds.length, 250); // All pages, even while page 3 is open.
    assert.equal(request.body.questionIds.length, 46);
    assert.equal(request.signal, page.exportController.signal);
    assert.equal(clicks, 1);
    values["[data-response-search]"] = "response-249";
    page.visibleColumns = new Set(["q-44"]);
    await page.exportXlsx("visible");
    assert.deepEqual(request.body.responseIds, ["response-249"]);
    assert.deepEqual(request.body.questionIds, ["q-44"]);
    let sessionInvalid = false;
    context.dispatchEvent = (event) => { sessionInvalid = event.type === "surveyone:session-invalid"; };
    context.fetch = async () => ({ ok: false, status: 401, json: async () => ({ detail: "Session expired" }) });
    await page.exportXlsx("raw");
    assert.equal(sessionInvalid, true);
    assert.equal(button.disabled, false);
    assert.equal(clicks, 2);
    const faults = [];
    context.Common.failure = { ...context.Common.failure, open(error) { faults.push(error); } };
    context.SURVEYONE_CONFIG.downloadTimeoutMs = 20;
    let attempts = 0;
    context.fetch = async () => { attempts++; return { ok: true, status: 200, headers: { get: () => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, blob: () => new Promise(() => {}) }; };
    await page.exportXlsx("raw");
    assert.equal(attempts, 1);
    assert.equal(faults[0].code, "REQUEST_TIMEOUT");
    assert.equal(page.exportController.signal.aborted, true);
    assert.equal(button.disabled, false);
    context.fetch = async () => ({ ok: false, status: 503, json: async () => ({ code: "DATABASE_UNAVAILABLE", detail: "private connection detail" }) });
    await page.exportXlsx("raw");
    assert.equal(faults[1].code, "DATABASE_UNAVAILABLE");
    assert(!faults[1].message.includes("private"));
    assert.equal(page.exportController.signal.aborted, false);
    assert.equal(clicks, 2);
    setTimeout(() => assert.equal(revoked, 2), 0);
})().catch((error) => { console.error(error); process.exitCode = 1; });
'''
    completed = subprocess.run([node, "-", script_path], input=harness, text=True, encoding="utf-8", capture_output=True, check=False)
    assert completed.returncode == 0, completed.stderr or completed.stdout
