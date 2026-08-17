from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def _read(relative_path: str) -> str:
    return (PROJECT_ROOT / relative_path).read_text(encoding="utf-8")


def test_response_menu_uses_user_facing_explorer_name() -> None:
    menu = _read("frontend/config/menu.config.js")
    help_config = _read("frontend/config/help.config.js")
    raw_page = _read("frontend/pages/M04001.html")

    assert 'code: "M04001", label: "응답 탐색"' in menu
    assert 'title: "응답 탐색 도움말"' in help_config
    assert "RESPONSE EXPLORER" in raw_page
    assert "RAW DATA PROJECTS" not in raw_page


def test_basic_report_preserves_survey_lookup_and_builds_detail_dashboard() -> None:
    html = _read("frontend/pages/M05001.html")
    script = _read("frontend/js/M05001.js")
    css = _read("frontend/css/pages/M05001.css")

    assert 'state.api.get("/api/surveys")' in script
    assert 'data-role="survey-select"' in html
    assert 'data-role="apply-filter"' in html
    assert 'addEventListener("change", () => loadReport()' in script

    for role in (
        "detail-title",
        "trend-chart",
        "completion-ring",
        "chart-grid",
        "question-table-body",
        "open-responses",
    ):
        assert f'data-role="{role}"' in html

    assert "/responses?offset=0&limit=200" in script
    assert "function renderTrend()" in script
    assert "function renderCompletion(report)" in script
    assert 'state.navigate("M04001", { surveyId: id })' in script
    assert "conic-gradient" in css
    assert ".report-overview-grid" in css
