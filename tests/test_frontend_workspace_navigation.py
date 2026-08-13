from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def _read(path: str) -> str:
    return (PROJECT_ROOT / path).read_text(encoding="utf-8")


def test_project_workspaces_share_one_top_right_list_button_contract() -> None:
    pages = {
        "frontend/pages/M02001.html": "data-project-form-cancel",
        "frontend/pages/M02003.html": "data-builder-back",
        "frontend/pages/M02004.html": "data-experience-project-list",
        "frontend/pages/M02005.html": "data-skin-project-list",
        "frontend/pages/M03001.html": "data-distribution-project-back",
        "frontend/pages/M04001.html": "data-response-project-back",
    }

    for path, action in pages.items():
        html = _read(path)
        button_start = html.rfind("<button", 0, html.index(action))
        button_end = html.index("</button>", html.index(action))
        button = html[button_start:button_end]
        assert 'class="button workspace-list-button"' in button
        assert 'class="workspace-list-button-icon" aria-hidden="true">←</span>' in button
        assert "프로젝트 목록" in button or "data-builder-back-label" in button

    for path in (
        "frontend/pages/M02001.html",
        "frontend/pages/M02003.html",
        "frontend/pages/M02004.html",
        "frontend/pages/M02005.html",
        "frontend/pages/M03001.html",
    ):
        html = _read(path)
        assert html.index("survey-flow") < html.index("workspace-list-button")


def test_project_list_buttons_keep_correct_spa_destinations_and_mobile_visibility() -> None:
    builder = _read("frontend/js/M02003.js")
    experience = _read("frontend/js/M02004.js")
    skin = _read("frontend/js/M02005.js")
    distribution = _read("frontend/js/M03001.js")
    raw_data = _read("frontend/js/M04001.js")
    app_css = _read("frontend/css/app.css")
    builder_css = _read("frontend/css/pages/M02003.css")

    assert 'this.context.navigate(this.templateAdmin ? "M07001" : "M02001")' in builder
    assert 'this.root.querySelector("[data-builder-back-label]").textContent = "공용 템플릿 목록"' in builder
    assert 'if (event.target.closest("[data-experience-project-list]")) this.context.navigate("M02001")' in experience
    assert 'this.context.navigate("M02001", { selectFor: "skin" })' in skin
    assert 'if (event.target.closest("[data-distribution-project-back]")) return this.backToProjects()' in distribution
    assert 'if (event.target.closest("[data-response-project-back]")) this.showProjectList()' in raw_data
    assert ".workspace-list-button {" in app_css
    assert ".workspace-list-button-icon {" in app_css
    assert ".builder-actions .workspace-list-button { display: inline-flex;" in builder_css
    assert "grid-template-columns: minmax(220px, .7fr) auto minmax(520px, 1.3fr)" in builder_css
    assert ".builder-actions .button { flex: 0 0 auto; white-space: nowrap; }" in builder_css
    assert "@media (max-width: 110rem)" in builder_css
    assert ".builder-actions .workspace-list-button { width: 40px;" in builder_css


def test_public_urls_use_readable_application_font_sizes() -> None:
    project_css = _read("frontend/css/pages/M02001.css")
    distribution_css = _read("frontend/css/pages/M03001.css")

    assert ".project-public-url code" in project_css
    assert "font-size: 13px" in project_css
    assert ".distribution-language-url input" in distribution_css
    assert ".distribution-review-languages code" in distribution_css
    assert distribution_css.count("font-size: 13px") >= 2
    assert "font-family: Consolas,monospace" not in distribution_css
