import re
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_builder_explicit_save_precedes_publication_and_distribution_uses_navigation_guard() -> None:
    page = (PROJECT_ROOT / "frontend" / "pages" / "M02003.html").read_text(encoding="utf-8")
    script = (PROJECT_ROOT / "frontend" / "js" / "M02003.js").read_text(encoding="utf-8")

    assert "data-builder-save" in page
    assert "data-builder-distribute" in page
    assert "data-builder-publish" in page
    assert "저장·확정 및 URL 발급" in page
    assert "async saveExplicit" in script
    assert "async prepareDistribution" in script
    assert "async publishSurvey" in script
    assert "await this.saveExplicit({ notify: false })" in script
    assert "async beforeRefresh()" in script
    assert "data-builder-leave-save" in script
    assert 'this.context.navigate("M03001", { surveyId: this.survey.id });' in script
    assert '/publish`, {})' in script


def test_builder_language_status_never_collapses_into_vertical_text() -> None:
    css = (PROJECT_ROOT / "frontend" / "css" / "pages" / "M02003.css").read_text(
        encoding="utf-8"
    )

    status_rule = re.search(r"\.builder-language-status \{([^}]*)\}", css)
    assert status_rule
    declarations = status_rule.group(1)
    assert "min-width: 112px" in declarations
    assert "text-overflow: ellipsis" in declarations
    assert "white-space: nowrap" in declarations
    assert "word-break: keep-all" in declarations
    assert "@media (max-width: 128rem)" in css


def test_project_creation_is_a_single_menu_four_step_flow() -> None:
    menu = (PROJECT_ROOT / "frontend" / "config" / "menu.config.js").read_text(encoding="utf-8")
    project_page = (PROJECT_ROOT / "frontend" / "pages" / "M02001.html").read_text(encoding="utf-8")
    skin_page = (PROJECT_ROOT / "frontend" / "pages" / "M02005.html").read_text(encoding="utf-8")
    builder_page = (PROJECT_ROOT / "frontend" / "pages" / "M02003.html").read_text(encoding="utf-8")
    experience_page = (PROJECT_ROOT / "frontend" / "pages" / "M02004.html").read_text(encoding="utf-8")
    experience_script = (PROJECT_ROOT / "frontend" / "js" / "M02004.js").read_text(encoding="utf-8")
    builder_script = (PROJECT_ROOT / "frontend" / "js" / "M02003.js").read_text(encoding="utf-8")
    project_script = (PROJECT_ROOT / "frontend" / "js" / "M02001.js").read_text(encoding="utf-8")
    dashboard_script = (PROJECT_ROOT / "frontend" / "js" / "M01001.js").read_text(encoding="utf-8")
    app_css = (PROJECT_ROOT / "frontend" / "css" / "app.css").read_text(encoding="utf-8")
    builder_css = (PROJECT_ROOT / "frontend" / "css" / "pages" / "M02003.css").read_text(encoding="utf-8")

    assert all(f'code: "{code}"' in menu for code in ("M02002", "M02003", "M02004", "M02005"))
    assert menu.count('hidden: true, navigationCode: "M02001"') == 4
    assert 'data-project-list-view' in project_page
    assert 'data-project-form-view hidden' in project_page
    assert 'data-project-create-flow' in project_page
    assert project_page.count('class="survey-flow"') == 1
    for page in (project_page, skin_page, experience_page, builder_page):
        assert "survey-flow" in page
        assert all(f"STEP 0{step}" in page for step in range(1, 5))
        assert "기본정보" in page
        assert "스킨 설정" in page
        assert "응답 UI" in page
        assert "설문 편집" in page
    assert 'this.root.querySelector("[data-builder-flow]").hidden = false;' in builder_script
    assert 'this.root.querySelectorAll("[data-project-flow]").forEach((button) => { button.disabled = false; });' in project_script
    assert 'data-project-flow="M02005"' in project_page
    assert 'data-skin-flow-route="M02004"' in skin_page
    assert "data-experience-editor" in experience_page
    assert 'this.context.api.post("/api/surveys"' not in builder_script
    assert 'this.context.api.post("/api/surveys", body)' in project_script
    assert 'this.openWorkspace("M02001", { create: "1" })' in dashboard_script
    assert 'start: "template"' in dashboard_script
    assert 'this.startMode = params.get("start") === "template"' in project_script
    assert 'this.context.navigate("M02003", { surveyId: survey.id, flow: "project", template: "1"' in project_script
    assert 'post("/api/surveys", { title: "제목 없는 설문" })' not in dashboard_script
    assert "async openTemplateLibrary()" in builder_script
    assert builder_page.count("data-builder-template-library") == 2
    assert ".survey-flow { margin-bottom: 18px;" in app_css
    assert "overflow-x: auto; color: var(--muted);" in app_css
    assert "--content-gutter: 16px;" in app_css
    assert "--header-gutter: 20px;" in app_css
    assert "--sidebar-gutter: 14px;" in app_css
    assert "padding: 0 var(--header-gutter);" in app_css
    assert "padding: 18px var(--sidebar-gutter);" in app_css
    assert ".page-host { width: 100%; max-width: none;" in app_css
    assert "padding: var(--content-gutter);" in app_css
    assert ".route-view { width: 100%; min-width: 0; }" in app_css
    assert ":root { --content-gutter: 12px; }" in app_css
    assert ".survey-flow { overflow-x: visible; }" in app_css
    assert ".survey-flow ol { grid-template-columns: repeat(2, minmax(0, 1fr)); min-width: 0; }" in app_css
    assert ".survey-flow li:nth-child(even) { border-right: 0; }" in app_css
    assert ".survey-flow li:nth-last-child(-n + 2) { border-bottom: 0; }" in app_css
    basic_report_css = (PROJECT_ROOT / "frontend" / "css" / "pages" / "M05001.css").read_text(encoding="utf-8")
    custom_report_css = (PROJECT_ROOT / "frontend" / "css" / "pages" / "M05002.css").read_text(encoding="utf-8")
    assert "width: min(100%, 1440px);" not in basic_report_css
    assert "width: min(100%, 1600px);" not in custom_report_css
    assert ".page-host:has(.builder-shell)" not in builder_css
    assert ".project-registration { width: 100%; margin: 0; }" in (PROJECT_ROOT / "frontend" / "css" / "pages" / "M02001.css").read_text(encoding="utf-8")
    assert ".experience-options { width: 100%; margin: 0;" in (PROJECT_ROOT / "frontend" / "css" / "pages" / "M02004.css").read_text(encoding="utf-8")
    assert '<div class="project-registration-view" data-project-form-view hidden' in project_page
    assert "async applyTemplateChoice(dialog)" in builder_script
    assert 'this.context.api.get("/api/templates")' in builder_script
    assert 'const endpoint = this.pendingTemplateCode ? "template" : "template/reset";' in builder_script
    assert "현재 문항·동적 조건·섹션 분기·번역이 새 구조로 교체됩니다." in builder_script
    assert 'presentationMode: this.mode' in experience_script
    assert 'this.context.navigate("M02003"' in experience_script
    assert 'this.context.navigate("M02001")' in builder_script
    assert "프로젝트 ID" in project_script
    assert "data-delete-id" in project_script
    assert "data-close-id" in project_script
    assert "data-copy-public-url" in project_script
    assert "프로젝트 배포 URL" in project_script
    assert 'params.set("stage", this.filter);' in project_script
    assert 'data-status-filter="confirmed"' in project_page
    assert 'data-status-filter="active"' in project_page
    assert '/close`, {})' in project_script
    assert 'this.context.api.delete(`/api/surveys/${encodeURIComponent(id)}`)' in project_script


def test_new_and_existing_project_step_one_use_different_actions() -> None:
    page = (PROJECT_ROOT / "frontend" / "pages" / "M02001.html").read_text(encoding="utf-8")
    script = (PROJECT_ROOT / "frontend" / "js" / "M02001.js").read_text(encoding="utf-8")

    assert "data-project-next hidden" in page
    assert 'textContent = "저장 후 STEP 02로"' in script
    assert 'this.editingPublished ? "변경사항만 저장" : "변경사항 저장"' in script
    assert 'this.root.querySelector("[data-project-next]").hidden = false;' in script
    assert 'this.context.navigate("M02005", { surveyId: survey.id, flow: "project"' in script
    assert "data-project-published-period-note" in page
    assert "data-project-publish-changes" in page
    assert "공개 URL은 확정 버전의 기간을 사용합니다." in page
    assert 'event.submitter?.matches("[data-project-publish-changes]")' in script
    assert "새 버전 확정 및 기간 반영" in script
    assert "공개 URL의 기간은 이전 확정본을 유지합니다." in script
    assert '/publish`, {})' in script


def test_project_response_period_keeps_minute_precision() -> None:
    page = (PROJECT_ROOT / "frontend" / "pages" / "M02001.html").read_text(
        encoding="utf-8"
    )
    script = (PROJECT_ROOT / "frontend" / "js" / "M02001.js").read_text(
        encoding="utf-8"
    )

    assert page.count('type="datetime-local"') >= 2
    assert 'name="startsAt" step="60"' in page
    assert 'name="closesAt" step="60"' in page
    assert "localDateTimeValue" in script
    assert "date.setHours(23, 59, 59, 999)" not in script
    assert "return date.toISOString();" in script
    assert 'const KOREA_UTC_OFFSET = "+09:00";' in script
    assert "const KOREA_UTC_OFFSET_MINUTES = 9 * 60;" in script
    assert "korea.getUTCFullYear()" in script
    assert "한국표준시 KST" in page
    assert "Asia/Seoul(UTC+9)" in page


def test_skin_step_does_not_put_growing_project_data_in_a_select() -> None:
    page = (PROJECT_ROOT / "frontend" / "pages" / "M02005.html").read_text(encoding="utf-8")
    script = (PROJECT_ROOT / "frontend" / "js" / "M02005.js").read_text(encoding="utf-8")

    assert "data-skin-survey" not in page
    assert "data-skin-project-list" in page
    assert 'this.context.api.get("/api/surveys")' not in script
    assert 'this.context.navigate("M02001", { selectFor: "skin" });' in script
    assert "data-skin-next" in page


def test_system_settings_is_separate_from_project_skin_step() -> None:
    menu = (PROJECT_ROOT / "frontend" / "config" / "menu.config.js").read_text(encoding="utf-8")
    page = (PROJECT_ROOT / "frontend" / "pages" / "M06001.html").read_text(encoding="utf-8")
    script = (PROJECT_ROOT / "frontend" / "js" / "M06001.js").read_text(encoding="utf-8")

    assert 'code: "M06001", label: "시스템 환경 설정"' in menu
    assert "IN-SURVEYONE ENVIRONMENT" in page
    assert "data-system-settings-form" in page
    assert "data-system-asset-version" in page
    assert "data-skin-presets" not in page
    assert "/api/surveys" not in script
    assert "Common.preferences.save(next)" in script
    assert "Common.preferences.read()" in script


def test_template_layer_locks_background_and_keeps_a_stable_scroll_area() -> None:
    index = (PROJECT_ROOT / "frontend" / "index.html").read_text(encoding="utf-8")
    builder_page = (PROJECT_ROOT / "frontend" / "pages" / "M02003.html").read_text(
        encoding="utf-8"
    )
    app_script = (PROJECT_ROOT / "frontend" / "js" / "app.js").read_text(encoding="utf-8")
    builder_script = (PROJECT_ROOT / "frontend" / "js" / "M02003.js").read_text(encoding="utf-8")
    app_css = (PROJECT_ROOT / "frontend" / "css" / "app.css").read_text(encoding="utf-8")
    builder_css = (PROJECT_ROOT / "frontend" / "css" / "pages" / "M02003.css").read_text(encoding="utf-8")

    assert 'document.documentElement.classList.add("app-modal-open")' in app_script
    assert 'document.documentElement.classList.remove("app-modal-open")' in app_script
    assert 'classList.toggle("modal-template-library", Boolean(options.templateLibrary))' in app_script
    assert 'class="modal-drag-bar" data-modal-drag-handle tabindex="0"' in index
    assert "function startModalDrag(event)" in app_script
    assert "dom.modal.setPointerCapture(event.pointerId)" in app_script
    assert "function moveModalWithKeyboard(event)" in app_script
    assert "html.app-modal-open, html.app-message-open { overflow: hidden;" in app_css
    assert "scrollbar-gutter: stable" in app_css
    assert "state.modalScrollPosition" in app_script
    assert ".modal-drag-bar" in app_css
    assert ".modal-template-library { height: min(560px, calc(100vh - 30px)); overflow: hidden; }" in app_css
    assert "grid-template-rows: auto auto minmax(0, 1fr) auto" in builder_css
    assert "overscroll-behavior: contain" in builder_css
    assert "grid-auto-rows: max-content" in builder_css
    assert "grid-template-rows: 86px auto auto" in builder_css
    assert "padding-right: 48px" in builder_css
    assert "data-builder-template-start" in builder_page
    assert "builder-template-button" in builder_page
    assert 'button.classList.toggle("is-recommended", recommendTemplate)' in builder_script
    assert ".builder-template-start { display: grid;" in builder_css
    assert "white-space: nowrap" in builder_css.split(".builder-save-label", 1)[1].split("}", 1)[0]
    assert ".editor-template-grid > .empty-state { grid-column: 1 / -1; min-height: 100%; }" in builder_css
    assert 'confirmation.scrollIntoView({ block: "nearest" });' in builder_script
    assert builder_script.count("templateLibrary: true") == 2


def test_mobile_builder_actions_and_template_dialog_do_not_clip_controls() -> None:
    app_css = (PROJECT_ROOT / "frontend" / "css" / "app.css").read_text(encoding="utf-8")
    builder_css = (PROJECT_ROOT / "frontend" / "css" / "pages" / "M02003.css").read_text(encoding="utf-8")

    assert "height: calc(100dvh - 12px)" in app_css
    assert ".header-help, .header-page-refresh { width: 38px;" in app_css
    assert ".button, input, select, textarea { min-height: 44px; }" in app_css
    assert ".builder-primary-actions { grid-column: 1 / -1; display: flex;" in builder_css
    assert "white-space: normal; word-break: keep-all;" in builder_css
    assert ".builder-canvas { padding: 16px 12px 60px; }" in builder_css
    assert ".editor-template-card { grid-template-rows: 78px auto auto; }" in builder_css


def test_every_business_page_and_public_renderer_define_mobile_breakpoints() -> None:
    styles = sorted((PROJECT_ROOT / "frontend" / "css" / "pages").glob("M*.css"))
    styles.append(PROJECT_ROOT / "frontend" / "css" / "public.css")
    missing = []
    for style in styles:
        source = style.read_text(encoding="utf-8")
        breakpoints = re.findall(r"@media\s*\(max-width:\s*([0-9.]+)(rem|px)\)", source)
        has_mobile = any(
            (unit == "rem" and float(value) <= 52)
            or (unit == "px" and float(value) <= 832)
            for value, unit in breakpoints
        )
        if not has_mobile:
            missing.append(style.name)

    assert not missing, f"mobile breakpoint missing: {', '.join(missing)}"
    index = (PROJECT_ROOT / "frontend" / "index.html").read_text(encoding="utf-8")
    public = (PROJECT_ROOT / "frontend" / "public.html").read_text(encoding="utf-8")
    assert 'width=device-width, initial-scale=1, viewport-fit=cover' in index
    assert 'width=device-width, initial-scale=1, viewport-fit=cover' in public


def test_editor_preview_is_interactive_and_simulates_fixed_viewports() -> None:
    app_script = (PROJECT_ROOT / "frontend" / "js" / "app.js").read_text(encoding="utf-8")
    builder_script = (PROJECT_ROOT / "frontend" / "js" / "M02003.js").read_text(encoding="utf-8")
    app_css = (PROJECT_ROOT / "frontend" / "css" / "app.css").read_text(encoding="utf-8")
    builder_css = (PROJECT_ROOT / "frontend" / "css" / "pages" / "M02003.css").read_text(encoding="utf-8")

    for code, width, height in (
        ("mobile-360", 360, 800),
        ("mobile-390", 390, 844),
        ("mobile-430", 430, 932),
        ("tablet-768", 768, 1024),
        ("laptop-1024", 1024, 768),
        ("desktop-1280", 1280, 800),
        ("desktop-1440", 1440, 900),
    ):
        assert f'code: "{code}"' in builder_script
        assert f"width: {width}, height: {height}" in builder_script

    assert "data-interactive-preview" in builder_script
    assert "data-preview-device-size" in builder_script
    assert '<option value="custom">직접 입력</option>' in builder_script
    assert 'data-preview-custom-width' in builder_script
    assert 'data-preview-custom-height' in builder_script
    assert 'min="240" max="5120"' in builder_script
    assert 'min="320" max="2880"' in builder_script
    assert 'code === "custom"' in builder_script
    assert 'sandbox="allow-scripts"' in builder_script
    assert "surveyone-preview-ready" in builder_script
    assert "surveyone-preview-draft" in builder_script
    assert "event.source !== frame.contentWindow" in builder_script
    assert 'event.origin !== "null"' in builder_script
    assert "/frontend/public.html?preview=1" in builder_script
    assert "applyPreviewDevice(dialog, code)" in builder_script
    assert "previewSimulator: true" in builder_script
    assert 'classList.toggle("modal-preview-simulator", Boolean(options.previewSimulator))' in app_script
    assert ".modal-preview-simulator" in app_css
    assert "container-type: inline-size" in builder_css
    assert "transform-origin: top left" in builder_css
    assert ".builder-preview-custom-size[hidden] { display: none; }" in builder_css
    assert "@container (min-width: 700px)" in builder_css
    assert "@media (max-width: 26rem)" in builder_css


def test_project_sort_select_has_distinct_working_sort_modes() -> None:
    page = (PROJECT_ROOT / "frontend" / "pages" / "M02001.html").read_text(
        encoding="utf-8"
    )
    script = (PROJECT_ROOT / "frontend" / "js" / "M02001.js").read_text(
        encoding="utf-8"
    )

    for value in (
        "updated-desc",
        "updated-asc",
        "created-desc",
        "responses",
        "title",
    ):
        assert f'value="{value}"' in page
    assert 'aria-describedby="projectSortStatus"' in page
    assert 'this.onSort = () => void this.loadPage(1, { announceSort: true });' in script
    assert 'this.context.api.get(`/api/surveys/page?${params}`)' in script
    assert "renderPagination()" in script
    assert "pageSize: String(this.pageSize)" in script
    assert "프로젝트를 정렬했습니다." in script


def test_cross_section_reorder_moves_nested_translation_bucket() -> None:
    script = (PROJECT_ROOT / "frontend" / "js" / "M02003.js").read_text(encoding="utf-8")

    assert "this.moveQuestionTranslations(question.id, sourceSectionId, destinationSectionId)" in script
    assert "delete sourceQuestions[questionKey];" in script
    assert "destination.questions[questionKey] = translatedQuestion;" in script
    assert "questionTitles" in script  # flat compatibility maps remain independently keyed by question ID


def test_dynamic_condition_editor_uses_stable_option_ids_without_manual_lookup() -> None:
    script = (PROJECT_ROOT / "frontend" / "js" / "M02003.js").read_text(
        encoding="utf-8"
    )

    assert "activationConditionValueMarkup(condition, sources)" in script
    assert 'question.required = ["fixed_required", "dynamic_required"].includes(question.behavior);' in script
    assert 'multiple size="4" aria-label="비교할 보기 복수 선택"' in script
    assert "this.localizedOptionLabel(source, option)" in script
    assert "[...event.target.selectedOptions].map((option) => option.value)" in script
    assert "condition.sourceQuestionId = event.target.value;" in script
    assert "condition.value = null;" in script


def test_table_axes_are_configurable_and_previewed_by_question_semantics() -> None:
    page = (PROJECT_ROOT / "frontend" / "pages" / "M02003.html").read_text(
        encoding="utf-8"
    )
    script = (PROJECT_ROOT / "frontend" / "js" / "M02003.js").read_text(
        encoding="utf-8"
    )
    public_script = (PROJECT_ROOT / "frontend" / "js" / "public.js").read_text(
        encoding="utf-8"
    )

    assert 'data-prop-axis-field' in page
    assert 'data-axis-list="rows"' in page
    assert 'data-axis-list="columns"' in page
    assert 'data-axis-add="rows"' in page
    assert 'data-axis-add="columns"' in page
    assert "addAxisItem(field, afterIndex = null)" in script
    assert "deleteAxisItem(field, index)" in script
    assert "moveAxisItem(field, index, direction)" in script
    assert 'if (question.type === "table") return this.axisTableMarkup(question, "text")' in script
    assert 'if (choiceMatrixTypes.has(question.type))' in script
    assert 'if (question.type === "repeat_table") return this.repeatTableEditorMarkup(question)' in script
    assert "/frontend/public.html?preview=1" in script
    assert "previewAxisTableMarkup" not in script
    assert "previewRepeatTableMarkup" not in script
    assert 'if (question.type === "table") return fixedTableMarkup(question, name, aria)' in public_script
    assert 'if (question.type === "repeat_table") return repeatTableMarkup(question, name, aria)' in public_script
    assert 'function axisItemId(question, field, index)' in public_script
    assert 'value[rowId] = currentQuestion.type === "matrix_single"' in public_script
