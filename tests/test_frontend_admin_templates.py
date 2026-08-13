from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def _read(relative: str) -> str:
    return (PROJECT_ROOT / relative).read_text(encoding="utf-8")


def test_admin_template_menu_is_role_scoped_and_route_guarded() -> None:
    menu = _read("frontend/config/menu.config.js")
    app = _read("frontend/js/app.js")

    assert 'code: "M07001"' in menu
    assert 'roles: ["SYSTEM_ADMIN"]' in menu
    assert "function canAccessMenu" in app
    assert ".filter((group) => canAccessMenu(group))" in app
    assert "!canAccessMenu(requestedPage)" in app
    assert "이 메뉴는 플랫폼 관리자만 사용할 수 있습니다." in app
    assert "renderNavigation();" in app.split("function updateUserUi()", 1)[1]


def test_admin_template_catalog_uses_versioned_draft_workflow() -> None:
    page = _read("frontend/pages/M07001.html")
    script = _read("frontend/js/M07001.js")
    style = _read("frontend/css/pages/M07001.css")
    help_config = _read("frontend/config/help.config.js")

    assert "<h1" not in page  # SPA shell owns the page's single h1.
    assert "<h2" in page
    assert "data-template-new" in page
    assert "프로젝트 소유의 독립 초안" in page
    assert 'this.context.api.get("/api/admin/templates")' in script
    assert 'this.context.api.post("/api/admin/templates/drafts", body)' in script
    assert "templateAdmin: \"1\"" in script
    assert "data-template-card-status" in script
    assert "data-template-delete" in script
    assert "item.draftOnly" in script
    assert "/api/admin/templates/drafts/${encodeURIComponent(sourceSurveyId(item))}" in script
    assert "저장한 내용으로 계속 편집" in script
    assert "api.patch(`/api/admin/templates/${encodeURIComponent(code)}`" in script
    assert "this.context.api.delete(endpoint)" in script
    assert "새 버전 설계" not in script
    assert ".template-admin-grid" in style
    assert "M07001:" in help_config


def test_builder_admin_mode_registers_snapshot_and_hides_project_publish() -> None:
    page = _read("frontend/pages/M02003.html")
    script = _read("frontend/js/M02003.js")

    assert page.count("data-template-admin-publish") == 2
    assert 'params.get("templateAdmin") === "1"' in script
    assert "!context.user?.systemAdmin" in script
    assert 'querySelectorAll("[data-builder-distribute]")' in script
    assert 'this.root.querySelector("[data-builder-publish]").hidden = this.templateAdmin' in script
    assert "openAdminTemplatePublish()" in script
    assert "async publishAdminTemplate(event, dialog)" in script
    assert "/api/admin/templates/${encodeURIComponent(code)}/publish" in script
    for field in ("sourceSurveyId", "title", "description", "category"):
        assert field in script
    assert 'this.context.navigate("M07001")' in script


def test_builder_admin_mode_keeps_m07001_navigation_context() -> None:
    app = _read("frontend/js/app.js")

    assert 'code === "M02003"' in app
    assert 'queryParams().get("templateAdmin") === "1"' in app
    assert "window.PAGE_CONFIG.M07001" in app
    assert "updateActiveNavigation(navigationPage.navigationCode || navigationPage.code || code)" in app


def test_member_templates_are_only_rendered_in_step04_layer() -> None:
    dashboard = _read("frontend/js/M01001.js")
    legacy_step = _read("frontend/js/M02002.js")
    builder = _read("frontend/js/M02003.js")

    assert 'api.get("/api/templates")' not in dashboard
    assert 'this.context.navigate("M02003"' in legacy_step
    assert 'this.context.api.get("/api/templates")' in builder
    assert "openTemplateLibrary()" in builder
