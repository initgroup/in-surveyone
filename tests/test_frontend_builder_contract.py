from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_builder_explicit_save_precedes_distribution_navigation() -> None:
    page = (PROJECT_ROOT / "frontend" / "pages" / "M02003.html").read_text(encoding="utf-8")
    script = (PROJECT_ROOT / "frontend" / "js" / "M02003.js").read_text(encoding="utf-8")

    assert "data-builder-save" in page
    assert "data-builder-distribute" in page
    assert "data-builder-publish" in page
    assert "async saveExplicit" in script
    assert "async prepareDistribution" in script
    assert "async publishSurvey" in script
    assert "await this.saveExplicit({ notify: false })" in script
    assert "if (!saved || this.destroyed) return;" in script
    assert 'this.context.navigate("M03001", { surveyId: this.survey.id });' in script
    assert '/publish`, {})' in script


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
    app_script = (PROJECT_ROOT / "frontend" / "js" / "app.js").read_text(encoding="utf-8")
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
    assert 'navigate("M02001", { create: "1" })' in app_script
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
    assert '/close`, {})' in project_script
    assert 'this.context.api.delete(`/api/surveys/${encodeURIComponent(id)}`)' in project_script


def test_new_and_existing_project_step_one_use_different_actions() -> None:
    page = (PROJECT_ROOT / "frontend" / "pages" / "M02001.html").read_text(encoding="utf-8")
    script = (PROJECT_ROOT / "frontend" / "js" / "M02001.js").read_text(encoding="utf-8")

    assert "data-project-next hidden" in page
    assert 'textContent = "저장 후 STEP 02로"' in script
    assert 'textContent = "변경사항 저장"' in script
    assert 'this.root.querySelector("[data-project-next]").hidden = false;' in script
    assert 'this.context.navigate("M02005", { surveyId: survey.id, flow: "project"' in script


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
    assert 'const STORAGE_KEY = "surveyone-system-preferences";' in script


def test_template_layer_locks_background_and_keeps_a_stable_scroll_area() -> None:
    index = (PROJECT_ROOT / "frontend" / "index.html").read_text(encoding="utf-8")
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
    assert "html.app-modal-open, html.app-modal-open body" in app_css
    assert ".modal-drag-bar" in app_css
    assert ".modal-template-library { height: min(560px, calc(100vh - 30px)); overflow: hidden; }" in app_css
    assert "grid-template-rows: auto auto minmax(0, 1fr) auto" in builder_css
    assert "overscroll-behavior: contain" in builder_css
    assert "padding-right: 48px" in builder_css
    assert ".editor-template-grid > .empty-state { grid-column: 1 / -1; min-height: 100%; }" in builder_css
    assert builder_script.count("templateLibrary: true") == 2


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
    assert "data-preview-slider" in builder_script
    assert "data-preview-repeat-add" in builder_script
    assert "updatePreviewLogic(dialog)" in builder_script
    assert "submitPreview(event, dialog)" in builder_script
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
    assert "addAxisItem(field)" in script
    assert "deleteAxisItem(field, index)" in script
    assert "moveAxisItem(field, index, direction)" in script
    assert 'if (question.type === "table") return this.axisTableMarkup(question, "text")' in script
    assert 'if (choiceMatrixTypes.has(question.type))' in script
    assert 'if (question.type === "repeat_table") return this.repeatTableEditorMarkup(question)' in script
    assert "const questions = this.survey.questions;" in script
    assert "previewAxisTableMarkup(question, cellType)" in script
    assert "previewRepeatTableMarkup(question)" in script
    assert 'if (question.type === "table") return fixedTableMarkup(question, name, aria)' in public_script
    assert 'if (question.type === "repeat_table") return repeatTableMarkup(question, name, aria)' in public_script
    assert 'function axisItemId(question, field, index)' in public_script
    assert 'value[rowId] = currentQuestion.type === "matrix_single"' in public_script
