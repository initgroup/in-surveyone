import json
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

    assert 'assetVersion: "20261020.3"' in config
    assert index.count("?v=20261020.3") >= 7
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
