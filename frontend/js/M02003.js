(function () {
    "use strict";
    const PAGE_NAME = "M02003";
    const draftFields = ["title", "description", "category", "sections", "theme", "skin", "logicRules", "settings", "languages", "translations"];
    const optionTypes = new Set(["single", "multiple", "dropdown"]);
    const rangeTypes = new Set(["number", "scale", "slider"]);
    const matrixTypes = new Set(["matrix_single", "matrix_multiple", "table", "repeat_table"]);
    const choiceMatrixTypes = new Set(["matrix_single", "matrix_multiple"]);
    const adminTemplateCategories = ["사회조사", "청렴도", "사업체", "만족도", "교육·행사", "조직진단", "신청·수요", "기관 맞춤형"];
    const templateCovers = ["#2857cf", "#159b82", "#8652d0", "#bd6b25", "#234d78", "#a3486c"];
    const previewDevices = [
        { code: "mobile-360", label: "모바일 소형 · 360 × 800", width: 360, height: 800 },
        { code: "mobile-390", label: "모바일 표준 · 390 × 844", width: 390, height: 844 },
        { code: "mobile-430", label: "모바일 대형 · 430 × 932", width: 430, height: 932 },
        { code: "tablet-768", label: "태블릿 세로 · 768 × 1024", width: 768, height: 1024 },
        { code: "laptop-1024", label: "노트북 소형 · 1024 × 768", width: 1024, height: 768 },
        { code: "desktop-1280", label: "데스크톱 · 1280 × 800", width: 1280, height: 800 },
        { code: "desktop-1440", label: "데스크톱 대형 · 1440 × 900", width: 1440, height: 900 }
    ];

    function uid(prefix = "q") {
        return `${prefix}_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`}`;
    }

    function defaultQuestion(type) {
        const config = window.SURVEYONE_CONFIG.questionTypes.find((item) => item.code === type) || window.SURVEYONE_CONFIG.questionTypes[0];
        const question = { id: uid(), type, title: `${config.label} 문항`, description: "", required: false, behavior: "fixed_optional", activationCondition: null, validation: { type: "none" } };
        if (optionTypes.has(type)) question.options = [{ id: uid("o"), label: "보기 1" }, { id: uid("o"), label: "보기 2" }];
        if (type === "scale") Object.assign(question, { min: 1, max: 5, minLabel: "매우 불만족", maxLabel: "매우 만족", settings: { scaleDisplay: "slider" } });
        if (type === "slider") Object.assign(question, { min: 0, max: 100, unit: "점" });
        if (type === "number") Object.assign(question, { min: null, max: null, unit: "" });
        if (choiceMatrixTypes.has(type)) Object.assign(question, { rows: ["항목 1", "항목 2"], columns: ["매우 불만족", "보통", "매우 만족"] });
        if (type === "table") Object.assign(question, { rows: ["항목 1", "항목 2"], columns: ["입력값 1", "입력값 2"] });
        if (type === "repeat_table") Object.assign(question, { rows: [], columns: ["입력값 1", "입력값 2"] });
        if (type === "notice") Object.assign(question, { title: "안내 제목", description: "응답자에게 전달할 안내 내용을 입력하세요." });
        return question;
    }

    window.Pages = window.Pages || {};
    window.Pages[PAGE_NAME] = {
        async init(context) {
            this.context = context;
            this.root = context.root;
            const params = window.SurveyOneApp.queryParams();
            this.surveyId = params.get("surveyId");
            this.templateAdmin = params.get("templateAdmin") === "1";
            this.newProjectFlow = !this.templateAdmin;
            this.templateCode = params.get("templateCode") || null;
            this.recommendedTemplateId = params.get("templateId");
            this.openTemplateOnLoad = params.get("template") === "1" || Boolean(this.recommendedTemplateId);
            this.survey = null;
            this.activeId = null;
            this.activeSectionId = null;
            this.mode = "questions";
            this.canvasScrollPositions = {};
            this.collapsedSections = new Set();
            this.insertionMode = "after";
            this.selectedQuestionType = "single";
            this.addedQuestionId = null;
            this.savePromise = null;
            this.savedDraft = null;
            this.savingExplicit = false;
            this.leavePromise = null;
            this.publishing = false;
            this.dirty = false;
            this.destroyed = false;
            this.dragId = null;
            this.editingLocale = null;
            this.persistedSourceLocale = null;
            if (this.templateAdmin && !context.user?.systemAdmin) {
                this.context.toast("공용 템플릿은 플랫폼 관리자만 편집할 수 있습니다.", "error");
                this.context.navigate("M01001");
                return;
            }
            if (!this.surveyId) {
                this.context.toast("편집할 프로젝트를 먼저 선택하거나 새 프로젝트를 시작해 주세요.", "error");
                this.context.navigate("M02001");
                return;
            }
            this.root.querySelector("[data-builder-flow]").hidden = false;
            if (this.templateAdmin) this.root.querySelector("[data-builder-flow]").hidden = true;
            this.root.querySelectorAll("[data-template-admin-publish]").forEach((button) => { button.hidden = !this.templateAdmin; });
            this.root.querySelectorAll("[data-builder-template-library]").forEach((button) => { button.hidden = this.templateAdmin; });
            this.root.querySelectorAll("[data-builder-distribute]").forEach((button) => { button.hidden = this.templateAdmin; });
            this.root.querySelectorAll("[data-builder-publish]").forEach(button => { button.hidden = this.templateAdmin; });
            if (this.templateAdmin) {
                this.root.querySelector("[data-builder-back]").setAttribute("aria-label", "공용 템플릿 목록으로 돌아가기");
                this.root.querySelector("[data-builder-back]").setAttribute("title", "공용 템플릿 목록");
                this.root.querySelector("[data-builder-back-label]").textContent = "공용 템플릿 목록";
            }
            this.bind();
            this.renderTools();
            this.renderSkins();
            await this.load();
            if (this.openTemplateOnLoad && this.survey) await this.openTemplateLibrary();
        },
        bind() {
            this.onClick = async (event) => {
                if (event.target.closest("[data-builder-file-menu] button")) this.root.querySelector("[data-builder-file-menu]").open = false;
                if (event.target.closest("[data-builder-basic]")) return this.context.navigate("M02001", { editId: this.surveyId, flow: "project", ...(this.recommendedTemplateId ? { templateId: this.recommendedTemplateId } : {}) });
                if (event.target.closest("[data-builder-skin-step]")) return this.context.navigate("M02005", { surveyId: this.surveyId, flow: "project", ...(this.recommendedTemplateId ? { templateId: this.recommendedTemplateId } : {}) });
                if (event.target.closest("[data-builder-experience]")) return this.context.navigate("M02004", { surveyId: this.surveyId, flow: "project", ...(this.recommendedTemplateId ? { templateId: this.recommendedTemplateId } : {}) });
                if (event.target.closest("[data-builder-back]")) return this.context.navigate(this.templateAdmin ? "M07001" : "M02001");
                const tool = event.target.closest("[data-question-type]");
                if (tool) return this.selectQuestionType(tool.dataset.questionType);
                if (event.target.closest("[data-add-selected-question]")) return this.addQuestion(this.selectedQuestionType || "single");
                if (event.target.closest("[data-canvas-add]")) return this.addQuestion(this.selectedQuestionType || "single", { mode: "survey-end" });
                if (event.target.closest("[data-add-section]")) return this.addSection();
                const foldAll = event.target.closest("[data-sections-fold]");
                if (foldAll) return this.setAllSectionsCollapsed(foldAll.dataset.sectionsFold === "collapse");
                const fold = event.target.closest("[data-section-toggle]");
                if (fold) {
                    const id = fold.closest(".builder-section-heading").dataset.sectionId;
                    return this.setSectionCollapsed(id, !this.collapsedSections?.has(id));
                }
                const sectionAdd = event.target.closest("[data-section-select]");
                if (sectionAdd) {
                    const sectionId = sectionAdd.closest(".builder-section-heading").dataset.sectionId;
                    this.selectSection(sectionId);
                    return this.chooseQuestionInsertion({ mode: "section-end", sectionId });
                }
                const sectionDelete = event.target.closest("[data-section-delete]");
                if (sectionDelete) return this.confirmSectionRemoval(sectionDelete.closest(".builder-section-heading").dataset.sectionId);
                if (event.target.closest("[data-scroll-selection]")) return this.revealSelection();
                const documentScroll = event.target.closest("[data-builder-scroll]");
                if (documentScroll) return this.navigateDocument(documentScroll.dataset.builderScroll);
                const heading = event.target.closest(".builder-section-heading");
                if (heading) this.selectSection(heading.dataset.sectionId);
                const card = event.target.closest("[data-question-id]");
                if (card) this.selectQuestion(card.dataset.questionId);
                const insert = event.target.closest("[data-question-insert]");
                if (insert) return this.chooseQuestionInsertion({ mode: insert.dataset.questionInsert, questionId: card.dataset.questionId });
                if (event.target.closest("[data-question-up]")) return this.moveQuestion(card.dataset.questionId, -1);
                if (event.target.closest("[data-question-down]")) return this.moveQuestion(card.dataset.questionId, 1);
                if (event.target.closest("[data-question-duplicate]")) return this.duplicateQuestion(card.dataset.questionId);
                if (event.target.closest("[data-question-delete]")) return this.deleteQuestion(card.dataset.questionId);
                if (event.target.closest("[data-question-settings]")) return this.openProperties(card.dataset.questionId);
                const moveOption = event.target.closest("[data-option-move]");
                if (moveOption) return this.moveOption(card.dataset.questionId, moveOption.dataset.optionMove, Number(moveOption.dataset.optionDirection));
                const insertOption = event.target.closest("[data-option-insert]");
                if (insertOption) return this.addOption(card.dataset.questionId, insertOption.dataset.optionInsert);
                const insertAxis = event.target.closest("[data-axis-insert]");
                if (insertAxis) return this.addAxisItem(insertAxis.dataset.axisInsert, Number(insertAxis.dataset.axisIndex));
                const addOption = event.target.closest("[data-add-option]");
                if (addOption) return this.addOption(addOption.dataset.addOption);
                const deleteOption = event.target.closest("[data-delete-option]");
                if (deleteOption) return this.deleteOption(card.dataset.questionId, deleteOption.dataset.deleteOption);
                const addAxis = event.target.closest("[data-axis-add]");
                if (addAxis) return this.addAxisItem(addAxis.dataset.axisAdd);
                const deleteAxis = event.target.closest("[data-axis-delete]");
                if (deleteAxis) return this.deleteAxisItem(deleteAxis.dataset.axisDelete, Number(deleteAxis.dataset.axisIndex));
                const moveAxis = event.target.closest("[data-axis-move]");
                if (moveAxis) return this.moveAxisItem(moveAxis.dataset.axisMove, Number(moveAxis.dataset.axisIndex), Number(moveAxis.dataset.axisDirection));
                const mode = event.target.closest("[data-builder-mode]");
                if (mode) return this.setMode(mode.dataset.builderMode);
                if (event.target.closest("[data-builder-save]")) return this.saveExplicit();
                if (event.target.closest("[data-builder-discard]")) return this.confirmDiscardChanges();
                if (event.target.closest("[data-builder-preview]")) return this.preview();
                if (event.target.closest("[data-builder-template-library]")) return this.openTemplateLibrary();
                if (event.target.closest("[data-builder-code]")) return this.openCustomCode();
                if (event.target.closest("[data-sync-source-options]")) {
                    const question = this.question(this.activeId);
                    if (question?.settings?.excludeSelectedFrom) return this.chooseExcludedSource(question, question.settings.excludeSelectedFrom, true);
                }
                if (event.target.closest("[data-edit-audiences]")) return this.editAudiences();
                if (event.target.closest("[data-edit-notice-html]")) return this.editNoticeContent();
                const noticePreset = event.target.closest("[data-notice-preset]");
                if (noticePreset) return this.editNoticeContent(noticePreset.dataset.noticePreset);
                if (event.target.closest("[data-export-draft]")) return this.exportDraftPackage();
                if (event.target.closest("[data-import-draft]")) return this.root.querySelector("[data-import-draft-file]").click();
                if (event.target.closest("[data-builder-distribute]")) return this.prepareDistribution();
                if (event.target.closest("[data-template-admin-publish]")) return this.openAdminTemplatePublish();
                if (event.target.closest("[data-builder-public-links]")) return this.openPublicLinks();
                if (event.target.closest("[data-builder-publish]")) return this.publishSurvey();
                if (event.target.closest("[data-properties-close]")) return this.closeProperties();
                const skin = event.target.closest("[data-skin-code]");
                if (skin) return this.setSkin(skin.dataset.skinCode);
                if (event.target.closest("[data-open-skins]")) return this.context.navigate("M02005", { surveyId: this.survey.id, flow: "project", ...(this.recommendedTemplateId ? { templateId: this.recommendedTemplateId } : {}) });
                if (event.target.closest("[data-add-rule]")) return this.addLogicRule();
                if (event.target.closest("[data-remove-rule]")) return this.removeLogicRule(event.target.closest("[data-rule-id]").dataset.ruleId);
                if (event.target.closest("[data-add-condition]")) return this.addActivationCondition();
                const removeCondition = event.target.closest("[data-remove-condition]");
                if (removeCondition) return this.removeActivationCondition(Number(removeCondition.dataset.removeCondition));
            };
            this.onSelectionPointerDown = () => { this.selectingByPointer = true; };
            this.onSelectionPointerEnd = () => { this.selectingByPointer = false; };
            this.root.addEventListener("pointerdown", this.onSelectionPointerDown);
            document.addEventListener("pointerup", this.onSelectionPointerEnd);
            document.addEventListener("pointercancel", this.onSelectionPointerEnd);
            this.onSelectionFocus = (event) => {
                // Pointer selection runs on click so the banner cannot move a button between down and up.
                if (this.selectingByPointer || event.target.closest("[data-section-toggle]")) return;
                const card = event.target.closest("[data-question-id]");
                if (card) this.selectQuestion(card.dataset.questionId);
                else {
                    const heading = event.target.closest(".builder-section-heading");
                    if (heading) this.selectSection(heading.dataset.sectionId);
                }
            };
            this.root.addEventListener("focusin", this.onSelectionFocus);
            this.onInput = (event) => this.handleInput(event);
            this.onChange = (event) => {
                if (event.target.matches("[data-import-draft-file]")) { this.importDraftPackage(event.target.files[0]); event.target.value = ""; return; }
                this.handleChange(event);
            };
            this.onDragStart = (event) => { const card = event.target.closest("[data-question-id]"); if (card) { this.dragId = card.dataset.questionId; card.classList.add("is-dragging"); event.dataTransfer.effectAllowed = "move"; } };
            this.onDragEnd = (event) => { event.target.closest("[data-question-id]")?.classList.remove("is-dragging"); this.dragId = null; };
            this.onDragOver = (event) => event.preventDefault();
            this.onDrop = (event) => { event.preventDefault(); const target = event.target.closest("[data-question-id]"); if (target && this.dragId && target.dataset.questionId !== this.dragId) this.reorderTo(this.dragId, target.dataset.questionId); };
            this.onToolDoubleClick = (event) => {
                const tool = event.target.closest("[data-question-tools] [data-question-type]");
                if (!tool) return;
                event.preventDefault();
                this.selectQuestionType(tool.dataset.questionType);
                this.addQuestion(this.selectedQuestionType);
            };
            this.root.addEventListener("click", this.onClick);
            this.root.addEventListener("dblclick", this.onToolDoubleClick);
            this.root.addEventListener("input", this.onInput);
            this.root.addEventListener("change", this.onChange);
            this.root.addEventListener("dragstart", this.onDragStart);
            this.root.addEventListener("dragend", this.onDragEnd);
            this.root.addEventListener("dragover", this.onDragOver);
            this.root.addEventListener("drop", this.onDrop);
            const toolbar = this.root.querySelector(".builder-topbar");
            const shell = this.root.querySelector("[data-builder-shell]");
            this.syncToolbarLayout = () => {
                if (this.destroyed) return;
                const rect = toolbar.getBoundingClientRect();
                if (this.toolbarWidth !== rect.width) { this.toolbarWidth = rect.width; this.resizeQuestionTitles?.(); }
                shell.style.setProperty("--builder-toolbar-height", `${Math.ceil(rect.height)}px`);
                shell.style.setProperty("--builder-toolbar-bottom", `${Math.ceil(rect.bottom)}px`);
                const workspace = this.root.querySelector(".builder-workspace");
                const bottomSpace = parseFloat(getComputedStyle(this.root).paddingBottom) || 16;
                // Keep a viewport-sized workbench; the outer page may scroll its introductions away.
                const headerHeight = parseFloat(getComputedStyle(this.root).getPropertyValue("--header-height")) || 0;
                const height = Math.max(240, window.innerHeight - headerHeight - rect.height - bottomSpace - 2);
                shell.style.setProperty("--builder-workspace-height", `${Math.floor(height)}px`);
                if (window.matchMedia("(min-width: 60.001rem)").matches) workspace.style.height = `${Math.floor(height)}px`;
                else workspace.style.removeProperty("height");
            };
            this.toolbarResizeObserver = new ResizeObserver(this.syncToolbarLayout);
            this.toolbarResizeObserver.observe(toolbar);
            this.workspaceResizeObserver = new ResizeObserver(() => this.syncToolbarLayout());
            this.workspaceResizeObserver.observe(this.root.querySelector(".builder-publication-guide"));
            this.workspaceResizeObserver.observe(this.root.querySelector(".builder-document-navigation"));
            this.fileMenu = this.root.querySelector("[data-builder-file-menu]");
            this.onFileMenuToggle = () => {
                if (!this.fileMenu.open) return;
                const anchor = this.fileMenu.querySelector("summary").getBoundingClientRect();
                const panel = this.fileMenu.querySelector(".builder-file-menu-panel");
                panel.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - 238))}px`;
                panel.style.top = `${Math.min(anchor.bottom + 6, Math.max(8, window.innerHeight - panel.offsetHeight - 8))}px`;
            };
            this.onToolbarPointerDown = event => {
                if (this.fileMenu.open && (!(event.target instanceof Node) || !this.fileMenu.contains(event.target))) this.fileMenu.open = false;
            };
            this.onToolbarKeyDown = event => {
                this.selectingByPointer = false;
                const tool = event.target.closest("[data-question-tools] [data-question-type]");
                if (tool && event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    this.selectQuestionType(tool.dataset.questionType);
                    this.addQuestion(this.selectedQuestionType);
                    return;
                }
                if (event.key === "Escape" && this.fileMenu.open) {
                    this.fileMenu.open = false; this.fileMenu.querySelector("summary").focus(); event.preventDefault();
                }
                const tab = event.target.closest("[data-builder-mode]");
                if (tab && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                    event.preventDefault();
                    const tabs = [...this.root.querySelectorAll("[data-builder-mode]")];
                    const index = tabs.indexOf(tab);
                    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
                    tabs[next].click(); tabs[next].focus();
                }
            };
            this.onToolbarScroll = event => {
                this.syncToolbarLayout();
                if (!this.fileMenu.open) return;
                if (event.type === "resize") this.fileMenu.open = false;
                else if (!(event.target instanceof Node) || !this.fileMenu.contains(event.target)) this.onFileMenuToggle();
            };
            this.fileMenu.addEventListener("toggle", this.onFileMenuToggle);
            document.addEventListener("pointerdown", this.onToolbarPointerDown);
            document.addEventListener("scroll", this.onToolbarScroll, true);
            window.addEventListener("resize", this.onToolbarScroll);
            this.root.addEventListener("keydown", this.onToolbarKeyDown);
        },
        async load() {
            try {
                const payload = await this.context.api.get(`/api/surveys/${encodeURIComponent(this.surveyId)}`);
                this.survey = payload.survey || payload;
                this.normalizeSurvey();
                this.persistedSourceLocale = this.survey.languages.sourceLocale;
                this.dirty = false;
                this.renderSurvey();
                this.savedDraft = this.draftSnapshot();
                this.setSaveLabel("저장됨");
                requestAnimationFrame(() => {
                    if (this.destroyed) return;
                    this.syncToolbarLayout();
                    requestAnimationFrame(() => {
                        if (!this.destroyed && !document.querySelector("dialog[open]")) this.scrollOuterToWorkspace();
                    });
                });
            } catch (error) {
                const backLabel = this.templateAdmin ? "공용 템플릿 목록" : "프로젝트 목록";
                this.root.querySelector(".builder-canvas").innerHTML = `<section class="empty-state error-state"><span class="empty-icon">!</span><h2>설문을 열 수 없습니다</h2><p>${Common.escapeHtml(error.message)}</p><button class="button workspace-list-button" data-builder-back><span class="workspace-list-button-icon" aria-hidden="true">←</span><span>${backLabel}</span></button></section>`;
            }
        },
        normalizeSurvey() {
            const legacyQuestions = Array.isArray(this.survey.questions) ? this.survey.questions : [];
            const sourceSections = Array.isArray(this.survey.sections) && this.survey.sections.length
                ? this.survey.sections
                : [{ id: uid("section"), title: "설문 문항", description: "", questions: legacyQuestions }];
            this.survey.sections = sourceSections.map((section, index) => ({
                ...section,
                id: section.id || uid("section"),
                title: section.title || `섹션 ${index + 1}`,
                description: section.description || "",
                questions: (Array.isArray(section.questions) ? section.questions : []).map((question) => {
                    const normalized = {
                        ...defaultQuestion(question.type || "single"),
                        ...question,
                        id: question.id || uid(),
                        behavior: question.behavior || (question.required ? "fixed_required" : "fixed_optional"),
                        activationCondition: question.activationCondition || question.activation_condition || null
                    };
                    if (normalized.type === "notice") Object.assign(normalized, { behavior: "fixed_optional", required: false, activationCondition: null });
                    return normalized;
                })
            }));
            this.survey.sections.forEach((section) => section.questions.forEach((question) => this.syncQuestionCompatibility(question)));
            this.refreshQuestions();
            const incomingSettings = this.survey.settings || {};
            const settings = { anonymous: true, showProgressBar: true, showQuestionNumbers: true, oneResponsePerRespondent: false, allowResponseEdit: false, presentationMode: "scroll", confirmationMessage: "응답해 주셔서 감사합니다.", ...incomingSettings };
            if (incomingSettings.showProgressBar === undefined && incomingSettings.showProgress !== undefined) settings.showProgressBar = incomingSettings.showProgress;
            if (incomingSettings.oneResponsePerRespondent === undefined && incomingSettings.oneResponse !== undefined) settings.oneResponsePerRespondent = incomingSettings.oneResponse;
            if (incomingSettings.allowResponseEdit === undefined && incomingSettings.allowEdit !== undefined) settings.allowResponseEdit = incomingSettings.allowEdit;
            settings.showProgress = settings.showProgressBar ?? settings.showProgress;
            settings.oneResponse = settings.oneResponsePerRespondent ?? settings.oneResponse;
            settings.allowEdit = settings.allowResponseEdit ?? settings.allowEdit;
            this.survey.settings = settings;
            this.survey.logicRules = this.survey.logicRules || [];
            this.survey.skin = this.survey.skin || { preset: "ocean" };
            this.normalizeLanguages();
        },
        normalizeLanguages() {
            const compatibility = this.survey.skin?.i18n || {};
            const raw = this.survey.languages || compatibility.languages || {};
            const sourceLocale = this.localeCode(raw.sourceLocale || raw.source_locale || raw.source || "ko", null, "ko");
            const rawEnabled = Array.isArray(raw)
                ? raw
                : (raw.enabled || raw.locales || raw.codes || [sourceLocale]);
            const enabled = [...new Set(rawEnabled.filter((item) => typeof item === "string" || item?.enabled !== false)
                .map((item) => typeof item === "string" ? item : item?.code)
                .map((item) => this.localeCode(item, null, null)).filter(Boolean))];
            if (!enabled.includes(sourceLocale)) enabled.unshift(sourceLocale);
            const requestedDefault = this.localeCode(raw.defaultLocale || raw.default_locale || raw.default || sourceLocale, null, sourceLocale);
            const defaultLocale = enabled.includes(requestedDefault) ? requestedDefault : sourceLocale;
            this.survey.languages = { sourceLocale, defaultLocale, enabled };
            const translations = this.survey.translations || compatibility.translations;
            const entries = translations && typeof translations === "object" && !Array.isArray(translations) ? Object.entries(translations) : [];
            this.survey.translations = Object.fromEntries(entries.map(([locale, value]) => [this.localeCode(locale, null, null), value])
                .filter(([locale]) => locale).map(([locale, value]) => [locale, structuredClone(value)]));
            this.editingLocale = enabled.includes(this.editingLocale) ? this.editingLocale : sourceLocale;
        },
        localeCatalog() {
            const configured = window.SURVEYONE_CONFIG.locales;
            const recommendations = Array.isArray(configured) && configured.length ? configured : [
                { code: "ko", label: "한국어", nativeLabel: "한국어" },
                { code: "en", label: "영어", nativeLabel: "English" },
                { code: "ja", label: "일본어", nativeLabel: "日本語" },
                { code: "zh", label: "중국어", nativeLabel: "中文" }
            ];
            const dynamicCodes = [
                ...(this.survey?.languages?.enabled || []),
                ...Object.keys(this.survey?.translations || {})
            ];
            const result = recommendations.map((item) => ({ ...item, code: this.localeCode(item.code, null, item.code) }));
            dynamicCodes.forEach((code) => {
                const canonical = this.localeCode(code, null, null);
                if (canonical && !result.some((item) => item.code.toLowerCase() === canonical.toLowerCase())) result.push({ code: canonical, label: canonical, nativeLabel: canonical });
            });
            return result;
        },
        localeCode(value, supported = null, fallback = "ko") {
            const candidate = String(value || "").trim().replaceAll("_", "-");
            let canonical = null;
            try { canonical = Intl.getCanonicalLocales(candidate)[0] || null; } catch { canonical = null; }
            if (!canonical) return fallback;
            if (!supported) return canonical;
            const match = [...supported].find((code) => String(code).toLowerCase() === canonical.toLowerCase());
            return match || fallback;
        },
        localeLabel(code) {
            const locale = this.localeCatalog().find((item) => item.code.toLowerCase() === String(code).toLowerCase());
            if (locale) return locale.nativeLabel || locale.label || code;
            const base = String(code).split("-")[0];
            const baseLocale = this.localeCatalog().find((item) => item.code === base);
            return baseLocale ? `${baseLocale.nativeLabel || baseLocale.label} (${code})` : code;
        },
        renderLanguageControls() {
            const languages = this.survey.languages;
            const catalog = this.localeCatalog();
            const editing = this.root.querySelector("[data-edit-locale]");
            editing.innerHTML = languages.enabled.map((code) => `<option value="${Common.escapeHtml(code)}" ${code === this.editingLocale ? "selected" : ""}>${Common.escapeHtml(this.localeLabel(code))}</option>`).join("");
            const source = this.root.querySelector("[data-source-locale]");
            source.innerHTML = catalog.map((locale) => `<option value="${locale.code}" ${locale.code === languages.sourceLocale ? "selected" : ""}>${Common.escapeHtml(locale.label)} (${Common.escapeHtml(locale.nativeLabel)})</option>`).join("");
            const defaultLocale = this.root.querySelector("[data-default-locale]");
            defaultLocale.innerHTML = languages.enabled.map((code) => `<option value="${code}" ${code === languages.defaultLocale ? "selected" : ""}>${Common.escapeHtml(this.localeLabel(code))}</option>`).join("");
            this.root.querySelector("[data-language-options]").innerHTML = catalog.map((locale) => {
                const isSource = locale.code === languages.sourceLocale;
                const checked = languages.enabled.includes(locale.code);
                return `<label class="builder-language-option"><input type="checkbox" data-language-code="${locale.code}" ${checked ? "checked" : ""} ${isSource ? "disabled" : ""}><span>${Common.escapeHtml(locale.label)}<small>${Common.escapeHtml(locale.nativeLabel)}</small></span></label>`;
            }).join("");
            const status = this.root.querySelector("[data-language-status]");
            const sourceLabel = this.localeLabel(languages.sourceLocale);
            status.textContent = this.editingLocale === languages.sourceLocale
                ? `${sourceLabel} 원문 편집 중`
                : `${this.localeLabel(this.editingLocale)} 번역 편집 중 · 빈 문구는 ${sourceLabel}로 대체`;
        },
        translationBucket(locale = this.editingLocale, create = false) {
            if (locale === this.survey.languages.sourceLocale) return null;
            let bucket = this.survey.translations[locale];
            if (!bucket && create) {
                bucket = { title: "", description: "", confirmationMessage: "", sections: {} };
                this.survey.translations[locale] = bucket;
            }
            if (bucket && create && (!bucket.sections || typeof bucket.sections !== "object")) bucket.sections = {};
            return bucket || null;
        },
        localizedValue(value, fallback = "") {
            return typeof value === "string" && value.trim() ? value : String(fallback ?? "");
        },
        localizedSurveyField(field) {
            const base = field === "confirmationMessage" ? this.survey.settings?.confirmationMessage : this.survey[field];
            const translated = this.translationBucket()?.[field];
            return this.localizedValue(translated, base);
        },
        localizedSectionField(section, field) {
            const translated = this.translationBucket()?.sections?.[section.id]?.[field];
            return this.localizedValue(translated, section[field]);
        },
        localizedQuestionField(question, field) {
            const location = this.questionLocation(question.id);
            const translated = location && this.translationBucket()?.sections?.[location.section.id]?.questions?.[question.id]?.[field];
            return this.localizedValue(translated, question[field]);
        },
        localizedOptionLabel(question, option) {
            const location = this.questionLocation(question.id);
            const translated = location && this.translationBucket()?.sections?.[location.section.id]?.questions?.[question.id]?.options?.[option.id];
            return this.localizedValue(translated, option.label);
        },
        localizedIndexedLabel(question, field, index) {
            const translations = this.translatedQuestion(question)?.[field];
            const stableKey = this.matrixItemKey(question, field, index);
            const translated = translations?.[stableKey] ?? translations?.[index];
            return this.localizedValue(translated, question[field]?.[index]);
        },
        matrixItemKey(question, field, index) {
            return String(question.settings?.[field]?.[index]?.id ?? index);
        },
        ensureResultCodes(items) {
            const used = new Set(items.map(item => item.resultCode).filter(value => value != null));
            let next = Math.max(0, ...[...used].filter(value => /^[0-9]{1,6}$/.test(value)).map(Number)) + 1;
            items.forEach(item => {
                if (item.resultCode != null) return;
                if (item.code && !used.has(item.code)) item.resultCode = item.code;
                else { while (used.has(String(next))) next += 1; item.resultCode = String(next++); }
                used.add(item.resultCode);
            });
        },
        ensureScalePoints(question) {
            if (question.type !== "scale") return;
            const current = question.settings.scalePoints || [];
            const minimum = question.min ?? 1, maximum = question.max ?? 5;
            const used = new Set(current.filter(point => point.score >= minimum && point.score <= maximum).map(point => point.resultCode));
            question.settings.scalePoints = Array.from({length: Math.min(11, Math.max(0, maximum - minimum + 1))}, (_, index) => {
                const score = minimum + index;
                const existing = current.find(point => point.score === score);
                if (existing) return existing;
                const point = {score, label: String(score)};
                if (!used.has(String(score))) { point.resultCode = String(score); used.add(point.resultCode); }
                return point;
            });
            this.ensureResultCodes(question.settings.scalePoints);
        },
        validateCodeControls(question) {
            const card = this.root.querySelector(`[data-question-id="${CSS.escape(question.id)}"]`);
            const groups = [];
            if (card) groups.push([...card.querySelectorAll("[data-option-result-code]")], [...card.querySelectorAll("[data-option-code]")]);
            if (this.activeId === question.id) ["rows", "columns"].forEach(field => groups.push([...this.root.querySelectorAll(`[data-axis-result-code="${field}"]`)]));
            if (this.activeId === question.id) groups.push([...this.root.querySelectorAll("[data-scale-code]")]);
            groups.forEach(inputs => {
                const values = inputs.map(input => input.value.trim());
                inputs.forEach((input, index) => {
                    const value = values[index];
                    const valid = value.length > 0 && value.length <= 120 && !/[\x00-\x1f\x7f]/.test(value) && values.filter(other => other === value).length === 1 && (!input.matches("[data-option-code]") || /^[1-9][0-9]{0,5}$/.test(value));
                    input.setCustomValidity(valid ? "" : "비어 있지 않은 고유한 코드를 입력하세요.");
                    input.setAttribute("aria-invalid", String(!valid));
                });
            });
        },
        resultCodeProblem() {
            for (const question of this.survey.questions) {
                const groups = [question.options || [], question.settings?.rows || [], question.settings?.columns || [], question.settings?.scalePoints || []];
                for (const group of groups) {
                    const codes = group.map(item => String(item.resultCode ?? item.id ?? "").trim());
                    if (codes.some(code => !code || code.length > 120 || /[\x00-\x1f\x7f]/.test(code)) || new Set(codes).size !== codes.length) return `“${this.localizedQuestionField(question, "title")}”의 결과 코드를 확인하세요. 같은 목록 안에서 중복 없이 1~120자로 입력해야 합니다.`;
                }
                if (question.settings?.choiceInput === "codes") {
                    const codes = (question.options || []).map(option => option.code);
                    if (codes.some(code => !/^[1-9][0-9]{0,5}$/.test(code || "")) || new Set(codes).size !== codes.length) return "번호 입력용 보기 번호는 중복 없이 1~999999로 지정하세요.";
                }
            }
            return "";
        },
        responseContract(question) {
            if (optionTypes.has(question.type)) return "표시 문구는 응답 화면에, 결과 코드는 결과 코드형 내보내기에 사용됩니다. 중간 삽입·순서 변경으로 기존 코드는 바뀌지 않습니다. 응답 연결 ID는 자동으로 유지됩니다.";
            if (matrixTypes.has(question.type)) return "행·열의 표시 문구와 결과 코드를 따로 설정합니다. 표의 입력 내용은 그대로 저장하고 결과 코드형에서는 지정한 행·열 코드로 구분합니다. 반복표의 행 순서는 응답자가 추가한 순서입니다.";
            if (question.type === "scale") return "선택 점수는 숫자로 저장해 통계를 계산합니다. 점수별 표시 문구와 결과 코드는 아래에서 수정하며 결과 코드형 내보내기에 적용됩니다.";
            if (["number", "slider"].includes(question.type)) return "응답자가 입력·선택한 숫자를 저장합니다. 표시 단위는 값에 포함되지 않습니다. 최솟값·최댓값과 간격으로 허용 값을 설정하세요.";
            if (question.type === "date") return "응답자가 선택한 날짜를 YYYY-MM-DD 형식으로 저장합니다.";
            if (question.type === "notice") return "안내 문항은 화면에만 표시되며 응답값을 저장하지 않습니다.";
            return "응답자가 입력한 문자를 그대로 저장합니다. 표시 문구인 문항 제목·설명은 응답값에 포함되지 않습니다.";
        },
        renderScalePoints(question) {
            const panel = this.root.querySelector("[data-scale-points]");
            panel.hidden = question.type !== "scale";
            if (panel.hidden) return;
            this.ensureScalePoints(question);
            const disabled = this.editingLocale !== this.survey.languages.sourceLocale ? "disabled" : "";
            panel.querySelector("[data-scale-point-list]").innerHTML = question.settings.scalePoints.map(point => `<div class="scale-point-item"><strong>${point.score}점</strong><label>표시 문구<input type="text" maxlength="100" data-scale-label="${point.score}" value="${Common.escapeHtml(point.label)}" ${disabled}></label><label>결과 코드<input type="text" maxlength="120" data-scale-code="${point.score}" value="${Common.escapeHtml(point.resultCode)}" ${disabled}></label></div>`).join("");
        },
        syncQuestionCompatibility(question) {
            const behaviors = new Set(["fixed_required", "fixed_optional", "dynamic_required", "dynamic_optional"]);
            question.behavior = behaviors.has(question.behavior) ? question.behavior : (question.required ? "fixed_required" : "fixed_optional");
            question.required = ["fixed_required", "dynamic_required"].includes(question.behavior);
            question.settings = question.settings && typeof question.settings === "object" ? question.settings : {};
            [["min", "minValue"], ["max", "maxValue"], ["minLabel", "minLabel"], ["maxLabel", "maxLabel"], ["unit", "unit"]].forEach(([topLevel, setting]) => {
                if (question[topLevel] === undefined || question[topLevel] === null) question[topLevel] = question.settings[setting] ?? question[topLevel];
                if (question[topLevel] !== undefined) question.settings[setting] = question[topLevel];
            });
            this.ensureResultCodes(question.options || []);
            ["rows", "columns"].forEach((field) => {
                const existing = Array.isArray(question.settings[field]) ? question.settings[field] : [];
                if ((!Array.isArray(question[field]) || !question[field].length) && existing.length) question[field] = existing.map((item) => String(item?.label ?? item ?? ""));
                const labels = Array.isArray(question[field]) ? question[field] : [];
                question.settings[field] = labels.map((label, index) => ({
                    ...(existing[index] && typeof existing[index] === "object" ? existing[index] : {}),
                    id: String(existing[index]?.id || uid(field === "rows" ? "row" : "col")),
                    label: String(label ?? "")
                }));
                this.ensureResultCodes(question.settings[field]);
            });
            this.ensureScalePoints(question);
        },
        setLocalizedSurveyField(field, value) {
            if (this.editingLocale === this.survey.languages.sourceLocale) {
                if (field === "confirmationMessage") this.survey.settings.confirmationMessage = value;
                else this.survey[field] = value;
                return;
            }
            this.translationBucket(this.editingLocale, true)[field] = value;
        },
        translatedSection(section, create = false) {
            const bucket = this.translationBucket(this.editingLocale, create);
            if (!bucket) return null;
            if (!bucket.sections || typeof bucket.sections !== "object") {
                if (!create) return null;
                bucket.sections = {};
            }
            if (!bucket.sections[section.id] && create) bucket.sections[section.id] = { title: "", description: "", questions: {} };
            const translated = bucket.sections[section.id];
            if (translated && create && (!translated.questions || typeof translated.questions !== "object")) translated.questions = {};
            return translated || null;
        },
        setLocalizedSectionField(section, field, value) {
            if (this.editingLocale === this.survey.languages.sourceLocale) section[field] = value;
            else this.translatedSection(section, true)[field] = value;
        },
        translatedQuestion(question, create = false) {
            const location = this.questionLocation(question.id);
            if (!location) return null;
            const translatedSection = this.translatedSection(location.section, create);
            if (!translatedSection) return null;
            if (!translatedSection.questions[question.id] && create) translatedSection.questions[question.id] = { title: "", description: "", options: {} };
            const translated = translatedSection.questions[question.id];
            if (translated && create && (!translated.options || typeof translated.options !== "object")) translated.options = {};
            return translated || null;
        },
        setLocalizedQuestionField(question, field, value) {
            if (this.editingLocale === this.survey.languages.sourceLocale) question[field] = value;
            else this.translatedQuestion(question, true)[field] = value;
        },
        setLocalizedOptionLabel(question, option, value) {
            if (this.editingLocale === this.survey.languages.sourceLocale) option.label = value;
            else this.translatedQuestion(question, true).options[option.id] = value;
        },
        setLocalizedIndexedLabel(question, field, index, value) {
            if (this.editingLocale === this.survey.languages.sourceLocale) {
                question[field] = Array.isArray(question[field]) ? question[field] : [];
                question[field][index] = value;
                return;
            }
            const translated = this.translatedQuestion(question, true);
            if (!translated[field] || typeof translated[field] !== "object") translated[field] = {};
            const stableKey = this.matrixItemKey(question, field, index);
            translated[field][stableKey] = value;
            if (stableKey !== String(index)) delete translated[field][index];
        },
        baseTranslationSnapshot() {
            return {
                title: this.survey.title || "",
                description: this.survey.description || "",
                confirmationMessage: this.survey.settings?.confirmationMessage || "",
                sections: Object.fromEntries(this.survey.sections.map((section) => [section.id, {
                    title: section.title || "",
                    description: section.description || "",
                    questions: Object.fromEntries(section.questions.map((question) => [question.id, {
                        title: question.title || "",
                        description: question.description || "",
                        options: Object.fromEntries((question.options || []).map((option) => [option.id, option.label || ""])),
                        rows: Object.fromEntries((question.rows || []).map((row, index) => [this.matrixItemKey(question, "rows", index), row || ""])),
                        columns: Object.fromEntries((question.columns || []).map((column, index) => [this.matrixItemKey(question, "columns", index), column || ""])),
                        minLabel: question.minLabel || "",
                        maxLabel: question.maxLabel || "",
                        unit: question.unit || ""
                    }]))
                }]))
            };
        },
        promoteTranslationToBase(overlay) {
            const source = overlay && typeof overlay === "object" ? overlay : {};
            this.survey.title = this.localizedValue(source.title, this.survey.title) || "제목 없는 설문";
            this.survey.description = this.localizedValue(source.description, this.survey.description);
            this.survey.settings.confirmationMessage = this.localizedValue(source.confirmationMessage, this.survey.settings.confirmationMessage);
            this.survey.sections.forEach((section) => {
                const sectionOverlay = source.sections?.[section.id] || {};
                section.title = this.localizedValue(sectionOverlay.title, section.title) || "새 섹션";
                section.description = this.localizedValue(sectionOverlay.description, section.description);
                section.questions.forEach((question) => {
                    const questionOverlay = sectionOverlay.questions?.[question.id] || {};
                    question.title = this.localizedValue(questionOverlay.title, question.title) || "질문";
                    question.description = this.localizedValue(questionOverlay.description, question.description);
                    (question.options || []).forEach((option) => { option.label = this.localizedValue(questionOverlay.options?.[option.id], option.label); });
                    ["rows", "columns"].forEach((field) => {
                        if (Array.isArray(question[field])) question[field] = question[field].map((value, index) => {
                            const stableKey = this.matrixItemKey(question, field, index);
                            return this.localizedValue(questionOverlay[field]?.[stableKey] ?? questionOverlay[field]?.[index], value);
                        });
                    });
                    ["minLabel", "maxLabel", "unit"].forEach((field) => { question[field] = this.localizedValue(questionOverlay[field], question[field]); });
                    this.syncQuestionCompatibility(question);
                });
            });
        },
        sourcePromotionGaps(locale) {
            const overlay = this.survey.translations[locale];
            if (!overlay || typeof overlay !== "object") return ["설문 번역 전체"];
            const gaps = [];
            const requireText = (value, label) => { if (typeof value !== "string" || !value.trim()) gaps.push(label); };
            requireText(overlay.title, "설문 제목");
            requireText(overlay.confirmationMessage, "완료 메시지");
            if (this.survey.description) requireText(overlay.description, "설문 설명");
            this.survey.sections.forEach((section, sectionIndex) => {
                const sectionOverlay = overlay.sections?.[section.id];
                requireText(sectionOverlay?.title, `${sectionIndex + 1}번 섹션 제목`);
                if (section.description) requireText(sectionOverlay?.description, `${sectionIndex + 1}번 섹션 설명`);
                section.questions.forEach((question, questionIndex) => {
                    const questionOverlay = sectionOverlay?.questions?.[question.id];
                    const prefix = `${sectionIndex + 1}번 섹션 ${questionIndex + 1}번 문항`;
                    requireText(questionOverlay?.title, `${prefix} 제목`);
                    if (question.description) requireText(questionOverlay?.description, `${prefix} 설명`);
                    (question.options || []).forEach((option, optionIndex) => requireText(questionOverlay?.options?.[option.id], `${prefix} ${optionIndex + 1}번 보기`));
                    ["rows", "columns"].forEach((field) => (question[field] || []).forEach((value, index) => {
                        const stableKey = this.matrixItemKey(question, field, index);
                        if (value) requireText(questionOverlay?.[field]?.[stableKey] ?? questionOverlay?.[field]?.[index], `${prefix} ${field === "rows" ? "행" : "열"} ${index + 1}`);
                    }));
                    [["minLabel", "최솟값 문구"], ["maxLabel", "최댓값 문구"], ["unit", "단위"]].forEach(([field, label]) => {
                        if (question[field]) requireText(questionOverlay?.[field], `${prefix} ${label}`);
                    });
                });
            });
            return gaps;
        },
        changeSourceLocale(next) {
            const previous = this.survey.languages.sourceLocale;
            if (next === previous) return { changed: false, gaps: [] };
            const gaps = this.sourcePromotionGaps(next);
            if (gaps.length) return { changed: false, gaps };
            const previousSnapshot = this.baseTranslationSnapshot();
            const nextOverlay = structuredClone(this.survey.translations[next] || {});
            this.promoteTranslationToBase(nextOverlay);
            this.survey.translations[previous] = previousSnapshot;
            delete this.survey.translations[next];
            this.survey.languages.sourceLocale = next;
            if (!this.survey.languages.enabled.includes(next)) this.survey.languages.enabled.push(next);
            if (this.editingLocale === previous) this.editingLocale = next;
            if (!this.survey.languages.enabled.includes(this.survey.languages.defaultLocale)) this.survey.languages.defaultLocale = next;
            return { changed: true, gaps: [] };
        },
        refreshQuestions() {
            this.survey.questions = this.survey.sections.flatMap((section) => section.questions);
        },
        renderTools() {
            const icons = {
                radio: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
                "check-square": '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8 12 3 3 5-6"/>',
                "chevron-down": '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m9 10 3 3 3-3"/>',
                text: '<path d="M4 6h16M12 6v13M8 19h8"/>',
                "align-left": '<path d="M4 5h16M4 10h12M4 15h16M4 20h9"/>',
                hash: '<path d="M9 3 7 21M17 3l-2 18M4 9h17M3 15h17"/>',
                "bar-chart": '<path d="M4 20h16M7 16v-5m5 5V4m5 12V8"/>',
                sliders: '<path d="M3 7h7m4 0h7M3 17h13m4 0h1"/><circle cx="12" cy="7" r="2"/><circle cx="18" cy="17" r="2"/>',
                grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
                table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M10 4v16"/>',
                copy: '<rect x="7" y="7" width="14" height="14" rx="2"/><path d="M17 7V3H3v14h4"/>',
                calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h1m5 0h1"/>',
                info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>'
            };
            this.root.querySelector("[data-question-tools]").innerHTML = window.SURVEYONE_CONFIG.questionTypes.map((item) => `<button class="question-tool" type="button" data-question-type="${item.code}" title="${Common.escapeHtml(item.description)} · 한 번 클릭: 선택 · 더블클릭 또는 Ctrl+Enter: 추가" aria-pressed="false" aria-label="${Common.escapeHtml(item.label)} 유형 선택 · ${Common.escapeHtml(item.description)}"><span class="question-tool-icon" aria-hidden="true"><svg viewBox="0 0 24 24">${icons[item.icon] || icons.text}</svg></span><strong>${Common.escapeHtml(item.label)}</strong><small>${Common.escapeHtml(item.description)}</small></button>`).join("");
            this.selectQuestionType(this.selectedQuestionType || "single");
        },
        selectQuestionType(type) {
            const config = window.SURVEYONE_CONFIG.questionTypes.find(item => item.code === type);
            if (!config) return;
            this.selectedQuestionType = type;
            this.root.querySelectorAll("[data-question-tools] [data-question-type]").forEach(tool => {
                const selected = tool.dataset.questionType === type;
                tool.classList.toggle("is-selected", selected);
                tool.setAttribute("aria-pressed", String(selected));
            });
            this.root.querySelectorAll("[data-add-selected-question]").forEach(button => {
                button.textContent = `＋ ${config.label} 추가`;
                button.setAttribute("aria-label", `선택한 ${config.label} 문항을 지정 위치에 추가`);
            });
            this.root.querySelector("[data-canvas-add]").textContent = `＋ ${config.label} · 설문 맨 끝에 추가`;
        },
        renderSkins() {
            this.root.querySelector("[data-builder-skins]").innerHTML = window.SURVEYONE_CONFIG.skinPresets.map((skin) => `<button class="skin-dot" type="button" style="--skin-color:${skin.primary}" data-skin-code="${skin.code}" aria-label="${skin.name}"></button>`).join("");
        },
        renderSurvey() {
            const status = this.survey.status || "draft";
            this.root.querySelector("[data-builder-status]").textContent = ({ draft: "작성 중", published: "배포됨", active: "배포됨", closed: "종료" })[status] || status;
            if (this.templateAdmin) this.root.querySelector("[data-builder-status]").textContent = this.templateCode ? `공용 템플릿 ${this.templateCode} 편집 중` : "새 공용 템플릿 편집 중";
            this.renderLanguageControls();
            this.renderAudienceSummary();
            this.updatePublishActions();
            const localizedTitle = this.localizedSurveyField("title") || "제목 없는 설문";
            this.root.querySelector("[data-builder-title]").value = localizedTitle;
            this.root.querySelector("[data-survey-heading]").value = localizedTitle;
            this.root.querySelector("[data-survey-description]").value = this.localizedSurveyField("description");
            Object.entries(this.survey.settings).forEach(([key, value]) => {
                const input = this.root.querySelector(`[data-setting="${key}"]`);
                if (!input) return;
                if (input.type === "checkbox") input.checked = Boolean(value); else input.value = value ?? "";
            });
            const confirmation = this.root.querySelector('[data-setting="confirmationMessage"]');
            if (confirmation) confirmation.value = this.localizedSurveyField("confirmationMessage");
            this.renderQuestions();
            this.renderRules();
            this.applySkin();
        },
        renderQuestions() {
            const host = this.root.querySelector("[data-question-list]");
            const template = this.root.querySelector("[data-question-template]");
            this.choiceLayoutCleanup?.();
            host.innerHTML = "";
            this.collapsedSections = new Set([...(this.collapsedSections || [])].filter(id => this.section(id)));
            let questionIndex = 0;
            const questionNumbers = window.SurveyQuestionNumbering.numbers(this.survey.sections);
            this.survey.sections.forEach((section, sectionIndex) => {
                const group = document.createElement("section");
                group.className = "builder-survey-section";
                group.dataset.editorSection = section.id;
                const body = document.createElement("div");
                body.className = "builder-section-body";
                body.dataset.sectionBody = section.id;
                body.id = `builder-section-body-${encodeURIComponent(section.id)}`;
                const heading = document.createElement("header");
                heading.className = "builder-section-heading";
                heading.dataset.sectionId = section.id;
                heading.innerHTML = `<span>SECTION ${String(sectionIndex + 1).padStart(2, "0")}</span><div class="builder-section-copy"><input type="text" data-section-title value="${Common.escapeHtml(this.localizedSectionField(section, "title"))}" aria-label="${sectionIndex + 1}번 섹션 제목"><input type="text" data-section-description value="${Common.escapeHtml(this.localizedSectionField(section, "description"))}" placeholder="섹션 설명(선택)" aria-label="${sectionIndex + 1}번 섹션 설명"></div><div class="builder-section-actions"><small data-section-summary>${section.questions.length}개 문항</small><button type="button" data-section-toggle aria-expanded="true" aria-controls="${Common.escapeHtml(body.id)}" aria-label="${sectionIndex + 1}번 섹션 접기">▾ 접기</button><button type="button" data-section-select aria-label="${sectionIndex + 1}번 섹션 끝에 문항 추가">섹션 끝에 추가</button><button type="button" data-section-delete ${this.survey.sections.length === 1 ? 'disabled title="설문에는 섹션이 하나 이상 필요합니다"' : ''} aria-label="${sectionIndex + 1}번 섹션 삭제">섹션 삭제</button></div>${section.questions.length ? '' : '<p class="builder-empty-section">비어 있는 섹션입니다. 문항 도구에서 유형을 선택해 이곳에 추가하세요.</p>'}`;
                group.appendChild(heading);
                group.appendChild(body);
                host.appendChild(group);
                section.questions.forEach((question) => {
                    this.syncQuestionCompatibility(question);
                    const node = template.content.firstElementChild.cloneNode(true);
                    node.dataset.questionId = question.id;
                    node.dataset.sectionId = section.id;
                    node.classList.toggle("is-active", question.id === this.activeId);
                    questionIndex += 1;
                    const displayNumber = questionNumbers.get(String(question.id));
                    node.querySelector(".question-index").textContent = this.survey.settings.showQuestionNumbers === false
                        ? String(questionIndex).padStart(2, "0") : displayNumber == null ? "—" : String(displayNumber).padStart(2, "0");
                    node.querySelector(".question-type-badge").textContent = this.typeLabel(question.type);
                    node.querySelector("[data-question-title]").value = this.displayQuestionTitle(question);
                    const description = node.querySelector("[data-question-description-preview]");
                    description.textContent = this.localizedQuestionField(question, "description");
                    description.hidden = !description.textContent;
                    node.querySelector("[data-required-label]").textContent = ({ fixed_required: "고정 · 필수", fixed_optional: "고정 · 선택", dynamic_required: "동적 · 필수", dynamic_optional: "동적 · 선택" })[question.behavior] || (question.required ? "필수 응답" : "선택 응답");
                    node.querySelector("[data-answer-editor]").innerHTML = this.answerMarkup(question);
                    body.appendChild(node);
                });
            });
            this.renderDocumentNavigation();
            this.updateSelection();
            this.resizeQuestionTitles();
            this.choiceLayoutCleanup = window.SurveyChoiceLayout?.mount(host);
            this.root.querySelector("[data-question-count]").textContent = `${this.survey.questions.length}개`;
            this.root.querySelector("[data-estimated-time]").textContent = `${Math.max(1, Math.ceil(this.survey.questions.filter((item) => item.type !== "notice").length * .35))}분`;
            const recommendTemplate = !this.templateAdmin && this.survey.questions.length === 0;
            const templateStart = this.root.querySelector("[data-builder-template-start]");
            if (templateStart) templateStart.hidden = !recommendTemplate;
            this.root.querySelectorAll(".builder-template-button").forEach((button) => {
                button.classList.toggle("is-recommended", recommendTemplate);
                button.setAttribute("aria-label", recommendTemplate ? "추천: 템플릿으로 설문 시작" : "설문 템플릿 선택");
            });
        },
        resizeQuestionTitles() {
            const titles = [...(this.root?.querySelectorAll("textarea[data-question-title]") || [])];
            titles.forEach(title => { title.style.height = "auto"; });
            const heights = titles.map(title => Math.max(48, title.scrollHeight));
            titles.forEach((title, index) => { title.style.height = `${heights[index]}px`; });
        },
        answerMarkup(question) {
            if (optionTypes.has(question.type)) {
                const grid = ["single", "multiple"].includes(question.type) && question.settings?.choiceInput !== "codes";
                const layout = window.SurveyChoiceLayout?.normalize(question.settings?.choiceLayout) || "vertical";
                const sourceEditing = this.editingLocale === this.survey.languages.sourceLocale;
                const disabled = sourceEditing ? "" : "disabled";
                const options = (question.options || []).map((option, index) => `<div class="option-row" data-choice-item data-option-row="${Common.escapeHtml(option.id)}"><span class="option-marker ${question.type === "multiple" ? 'multiple' : ''}" aria-hidden="true"></span><label class="option-label-field"><span>표시 문구</span><input type="text" maxlength="500" value="${Common.escapeHtml(this.localizedOptionLabel(question, option))}" data-option-id="${Common.escapeHtml(option.id)}" data-choice-label aria-label="보기 내용"></label><button type="button" data-delete-option="${Common.escapeHtml(option.id)}" aria-label="${index + 1}번 보기 삭제" ${!sourceEditing || question.options.length <= 1 ? 'disabled' : ''}>×</button><div class="option-value-fields"><label>결과 코드<input type="text" maxlength="120" value="${Common.escapeHtml(option.resultCode)}" data-option-result-code="${Common.escapeHtml(option.id)}" aria-label="${index + 1}번 보기 결과 코드" ${disabled}></label>${question.settings?.choiceInput === "codes" ? `<label>입력 번호<input class="option-code" type="text" inputmode="numeric" maxlength="6" value="${Common.escapeHtml(option.code || "")}" data-option-code="${Common.escapeHtml(option.id)}" aria-label="보기 번호" ${disabled}></label>` : ''}</div><div class="option-row-actions"><span>${index + 1}번째</span><button type="button" data-option-move="${Common.escapeHtml(option.id)}" data-option-direction="-1" aria-label="${index + 1}번 보기 위로 이동" ${!sourceEditing || index === 0 ? 'disabled' : ''}>↑</button><button type="button" data-option-move="${Common.escapeHtml(option.id)}" data-option-direction="1" aria-label="${index + 1}번 보기 아래로 이동" ${!sourceEditing || index === question.options.length - 1 ? 'disabled' : ''}>↓</button><button type="button" data-option-insert="${Common.escapeHtml(option.id)}" ${disabled}>＋ 아래 삽입</button></div></div>`).join("");
                return `<p class="option-contract-help sr-only">표시 문구는 설문에 보이고, 결과 코드는 결과 코드형으로 내보낼 때 사용합니다.${question.settings?.choiceInput === "codes" ? ' 입력 번호는 응답자가 번호로 선택할 때 사용합니다.' : ''}</p><div class="choice-options-editor">${options}</div>${grid ? `<details class="option-layout-preview"><summary>응답 화면의 보기 배열 미리보기</summary><div class="choice-layout-preview" data-choice-layout="${layout}">${question.options.map(option => `<div class="choice-layout-preview-item" data-choice-item><span class="option-marker ${question.type === 'multiple' ? 'multiple' : ''}" aria-hidden="true"></span><span data-choice-label>${Common.escapeHtml(this.localizedOptionLabel(question, option))}</span></div>`).join('')}</div></details>` : ''}<button class="add-option" type="button" data-add-option="${Common.escapeHtml(question.id)}" ${disabled}>＋ 마지막에 보기 추가</button>`;
            }
            if (question.type === "short_text") return `<div class="answer-placeholder">짧은 답변이 입력됩니다.</div>`;
            if (question.type === "long_text") return `<div class="answer-placeholder long">긴 답변이 입력됩니다.</div>`;
            if (["number", "slider"].includes(question.type)) return `<div class="answer-placeholder">${question.min ?? 0} — ${question.max ?? 100} ${Common.escapeHtml(this.localizedQuestionField(question, "unit"))}</div>`;
            if (question.type === "scale") {
                const minimum = Number(question.min ?? 1), maximum = Number(question.max ?? 5);
                const count = Math.min(11, Math.max(2, maximum - minimum + 1));
                const descending = question.settings?.scaleOrder === "descending";
                const values = Array.from({ length: count }, (_, i) => minimum + i);
                if (descending) values.reverse();
                const labels = `<div class="scale-preview-labels"><span>${Common.escapeHtml(this.localizedQuestionField(question, descending ? "maxLabel" : "minLabel"))}</span><span>${Common.escapeHtml(this.localizedQuestionField(question, descending ? "minLabel" : "maxLabel"))}</span></div>`;
                const sliderLabels = `<div class="scale-preview-labels rating-editor-endpoints"><span><b>${descending ? maximum : minimum}</b><span>${Common.escapeHtml(this.localizedQuestionField(question, descending ? "maxLabel" : "minLabel"))}</span></span><span><b>${descending ? minimum : maximum}</b><span>${Common.escapeHtml(this.localizedQuestionField(question, descending ? "minLabel" : "maxLabel"))}</span></span></div>`;
                if (question.settings?.scaleDisplay === "slider") return `<div class="rating-editor-preview">${sliderLabels}<div class="rating-editor-track" aria-hidden="true"><div class="rating-editor-stops">${values.map((value, index) => `<span class="rating-editor-stop" style="--rating-position:${index / (values.length - 1) * 100}%"></span>`).join("")}</div></div><div class="rating-editor-ticks">${values.map((value, index) => `<span style="--rating-position:${index / (values.length - 1) * 100}%">${value}</span>`).join("")}</div><small>선 위의 동그라미를 눌러 점수 선택 · 응답 전에는 미선택</small></div>`;
                return `<div class="scale-preview" style="--count:${count}">${values.map(value => `<span>${Common.escapeHtml(question.settings?.scalePoints?.find(point => point.score === value)?.label || String(value))}</span>`).join("")}</div>${labels}`;
            }
            if (choiceMatrixTypes.has(question.type)) return this.axisTableMarkup(question, question.type === "matrix_multiple" ? "checkbox" : "radio");
            if (question.type === "table") return this.axisTableMarkup(question, "text");
            if (question.type === "repeat_table") return this.repeatTableEditorMarkup(question);
            if (question.type === "date") return `<div class="answer-placeholder">연도-월-일</div>`;
            if (question.type === "notice") return `<div class="survey-document" data-notice-id="${Common.escapeHtml(question.id)}">${question.settings?.contentHtml ? window.SurveyContent.render(question.settings.contentHtml) : Common.escapeHtml(this.localizedQuestionField(question, "description") || "안내 내용을 입력하세요.")}</div>`;
            return `<div class="answer-placeholder">응답 영역</div>`;
        },
        axisTableMarkup(question, cellType) {
            const columns = question.columns || [];
            const rows = question.rows || [];
            const cells = (rowIndex) => columns.map((column, columnIndex) => {
                if (cellType === "text") return `<td><span class="table-cell-placeholder" aria-label="${rowIndex + 1}행 ${columnIndex + 1}열 응답 입력 영역">입력</span></td>`;
                const markerClass = cellType === "checkbox" ? " is-checkbox" : "";
                return `<td><span class="matrix-cell-marker${markerClass}" aria-hidden="true"></span></td>`;
            }).join("");
            return `<div class="matrix-preview ${cellType === "text" ? "table-input-preview" : ""}"><table><thead><tr><th scope="col">항목</th>${columns.map((column, index) => `<th scope="col"><input type="text" data-matrix-column-index="${index}" value="${Common.escapeHtml(this.localizedIndexedLabel(question, "columns", index))}" aria-label="${index + 1}번 열 제목"></th>`).join("")}</tr></thead><tbody>${rows.map((row, rowIndex) => `<tr><th scope="row"><input type="text" data-matrix-row-index="${rowIndex}" value="${Common.escapeHtml(this.localizedIndexedLabel(question, "rows", rowIndex))}" aria-label="${rowIndex + 1}번 행 제목"></th>${cells(rowIndex)}</tr>`).join("")}</tbody></table></div>`;
        },
        repeatTableEditorMarkup(question) {
            const columns = question.columns || [];
            return `<div class="repeat-table-editor-preview"><div class="repeat-table-editor-row is-heading" style="--columns:${Math.max(1, columns.length)}">${columns.map((column, index) => `<input type="text" data-matrix-column-index="${index}" value="${Common.escapeHtml(this.localizedIndexedLabel(question, "columns", index))}" aria-label="${index + 1}번 열 제목">`).join("")}<span></span></div><div class="repeat-table-editor-row" style="--columns:${Math.max(1, columns.length)}">${columns.map((column, index) => `<span>${Common.escapeHtml(this.localizedIndexedLabel(question, "columns", index) || `열 ${index + 1}`)} 입력</span>`).join("")}<button type="button" disabled aria-label="행 삭제 예시">×</button></div><span class="repeat-table-add-preview">＋ 응답자가 필요한 만큼 행 추가</span></div>`;
        },
        typeLabel(code) { return window.SURVEYONE_CONFIG.questionTypes.find((item) => item.code === code)?.label || code; },
        displayQuestionTitle(question) {
            return window.SurveyQuestionNumbering.title(question, this.survey.settings, this.localizedQuestionField(question, "title"));
        },
        setDisplayedQuestionTitle(question, value) {
            const original = this.localizedQuestionField(question, "title");
            const displayed = this.displayQuestionTitle(question);
            const prefix = original.slice(0, original.length - displayed.length);
            const numberedInput = window.SurveyQuestionNumbering.title(question, this.survey.settings, value) !== value;
            this.setLocalizedQuestionField(question, "title", prefix && !numberedInput ? prefix + value : value);
        },
        questionInsertionTarget(placement = null) {
            const mode = placement?.mode || this.insertionMode || "after";
            if (!["before", "after", "section-end", "survey-end"].includes(mode)) return null;
            const location = this.questionLocation(placement?.questionId ?? this.activeId);
            if (["before", "after"].includes(mode) && location) return { section: location.section, index: location.questionIndex + (mode === "after" ? 1 : 0), mode, location };
            // An explicit missing anchor must never silently become an append operation.
            if (["before", "after"].includes(mode) && placement) return null;
            if (mode === "section-end" && placement?.sectionId && !this.section(placement.sectionId)) return null;
            const section = mode === "survey-end" ? this.survey.sections.at(-1) : this.section(placement?.sectionId ?? this.activeSectionId) || this.survey.sections.at(-1);
            if (!section) return null;
            return { section, index: section.questions.length, mode: mode === "survey-end" ? "survey-end" : "section-end", location: null };
        },
        questionInsertionLabel(target) {
            if (target.mode === "survey-end") return "설문 전체의 맨 끝";
            const sectionIndex = this.survey.sections.findIndex(section => section.id === target.section.id) + 1;
            if (!target.location) return `섹션 ${sectionIndex}의 맨 끝`;
            const number = window.SurveyQuestionNumbering.numbers(this.survey.sections).get(String(target.location.question.id));
            const anchor = this.survey.settings.showQuestionNumbers !== false && number != null ? `${number}번 문항` : `섹션 ${sectionIndex} · ${target.location.questionIndex + 1}번째 항목`;
            return `${anchor} 바로 ${target.mode === "before" ? "위" : "아래"}`;
        },
        chooseQuestionInsertion(placement) {
            const target = this.questionInsertionTarget(placement);
            if (!target) return this.context.toast("추가 기준 위치를 찾을 수 없습니다. 문항 또는 섹션을 다시 선택해 주세요.", "error");
            // Freeze the anchor ID before opening the picker; focus changes cannot redirect insertion.
            const captured = { mode: target.mode, sectionId: target.section.id, ...(target.location ? {questionId: target.location.question.id} : {}) };
            const automatic = this.survey.settings.showQuestionNumbers !== false;
            const dialog = this.context.openModal(`<section class="builder-insert-dialog"><header><h2>문항 삽입</h2><p><strong>${Common.escapeHtml(this.questionInsertionLabel(target))}</strong>에 추가할 문항 유형을 선택하세요.</p><p class="builder-insert-numbering">${automatic ? "문항 번호는 삽입 순서에 맞춰 자동 갱신됩니다. 안내문과 번호 제외 문항은 계산에서 제외됩니다." : "현재 자동 문항 번호가 꺼져 있습니다. 설문 설정에서 문항 번호 표시를 켜면 삽입 순서에 따라 번호가 갱신됩니다."}</p></header><div class="builder-insert-type-list" data-insert-type-list></div><footer><button class="button button-function" type="button" data-insert-cancel>취소</button></footer></section>`, { label: "문항 삽입 유형 선택", wide: true, initialFocus: "[data-insert-type]" });
            const host = dialog.querySelector("[data-insert-type-list]");
            this.root.querySelectorAll("[data-question-tools] [data-question-type]").forEach(tool => {
                const button = tool.cloneNode(true);
                button.dataset.insertType = tool.dataset.questionType;
                button.removeAttribute("data-question-type");
                button.removeAttribute("aria-pressed");
                button.classList.remove("is-selected");
                button.setAttribute("aria-label", `${this.typeLabel(tool.dataset.questionType)} 문항 삽입`);
                host.appendChild(button);
            });
            let type = null;
            host.addEventListener("click", event => {
                const button = event.target.closest("[data-insert-type]");
                if (button) { type = button.dataset.insertType; dialog.close(); }
            });
            dialog.querySelector("[data-insert-cancel]").addEventListener("click", () => dialog.close());
            dialog.addEventListener("close", () => { if (type && !this.destroyed) { this.selectQuestionType(type); this.addQuestion(type, captured); } }, {once:true});
        },
        addQuestion(type, placement = null) {
            if (!window.SURVEYONE_CONFIG.questionTypes.some(item => item.code === type)) return;
            const target = this.questionInsertionTarget(placement);
            if (!target) return this.context.toast("문항을 추가할 위치를 다시 선택해 주세요.", "error");
            const question = defaultQuestion(type);
            target.section.questions.splice(target.index, 0, question);
            this.refreshQuestions();
            this.activeId = question.id;
            this.activeSectionId = target.section.id;
            this.insertionMode = "after";
            this.addedQuestionId = question.id;
            this.setMode("questions");
            this.renderQuestions();
            this.openProperties(question.id);
            if (window.matchMedia("(max-width: 78rem)").matches) this.closeProperties();
            this.markDirty();
            this.revealSelection(true);
        },
        addSection(render = true) {
            const section = { id: uid("section"), title: `섹션 ${this.survey.sections.length + 1}`, description: "", questions: [] };
            this.survey.sections.push(section);
            this.refreshQuestions();
            if (render) {
                this.setMode("questions");
                this.selectSection(section.id);
                this.renderQuestions();
                this.renderRules();
                this.markDirty();
                this.revealSelection(true);
            }
            return section;
        },
        selectSection(id) {
            if (!this.section(id)) return;
            this.activeId = null;
            this.activeSectionId = id;
            this.insertionMode = "section-end";
            this.addedQuestionId = null;
            this.root.querySelector("[data-properties-empty]").hidden = false;
            this.root.querySelector("[data-properties-panel]").hidden = true;
            this.closeProperties();
            this.updateSelection();
        },
        selectQuestion(id, syncProperties = true) {
            const location = this.questionLocation(id);
            if (!location) return;
            const changed = this.activeId !== id;
            if (changed) { this.addedQuestionId = null; this.insertionMode = "after"; }
            this.activeId = id;
            this.activeSectionId = location.section.id;
            this.updateSelection();
            // The desktop inspector stays visible even when its mobile overlay is closed.
            const inspectorVisible = !window.matchMedia("(max-width: 78rem)").matches || this.root.querySelector(".builder-properties").classList.contains("is-open");
            if (changed && syncProperties && inspectorVisible) this.openProperties(id);
        },
        updateSelection() {
            const location = this.questionLocation(this.activeId);
            if (location) this.activeSectionId = location.section.id;
            else this.activeId = null;
            if (!this.section(this.activeSectionId)) this.activeSectionId = this.survey.sections.at(-1)?.id || null;
            this.root.querySelectorAll("[data-question-id]").forEach((card) => {
                const selected = card.dataset.questionId === this.activeId;
                card.classList.toggle("is-active", selected);
                if (selected) card.setAttribute("aria-current", "true"); else card.removeAttribute("aria-current");
                const banner = card.querySelector("[data-question-selection]");
                banner.hidden = !selected;
                banner.querySelector("strong").textContent = this.addedQuestionId === card.dataset.questionId ? "새 문항" : "편집 중";
            });
            this.root.querySelectorAll(".builder-section-heading").forEach((heading) => {
                const selected = heading.dataset.sectionId === this.activeSectionId;
                heading.classList.toggle("is-active", selected);
                const button = heading.querySelector("[data-section-select]");
                button.setAttribute("aria-pressed", String(selected && !location));
                button.textContent = "섹션 끝에 추가";
            });
            const target = this.questionInsertionTarget();
            const status = this.root.querySelector("[data-insertion-status]");
            const message = target ? `${this.questionInsertionLabel(target)}에 추가` : "추가할 위치를 선택하세요.";
            if (status.textContent !== message) status.textContent = message;
            status.title = message;
            const control = this.root.querySelector("[data-insertion-position]");
            control.querySelectorAll('option[value="before"], option[value="after"]').forEach(option => { option.disabled = !location; });
            control.value = target?.mode || "section-end";
            control.title = message;
            this.root.querySelectorAll("[data-question-selection] > [data-insertion-hint]").forEach(hint => { hint.textContent = `문항 도구: ${message}. 아래 버튼으로 이 문항 위·아래에도 삽입할 수 있습니다.`; });
            this.applySectionFolding();
        },
        applySectionFolding() {
            const collapsed = this.collapsedSections || new Set();
            const selectedSection = this.questionLocation(this.activeId)?.section.id;
            this.root.querySelectorAll(".builder-survey-section").forEach(group => {
                const id = group.dataset.editorSection;
                const section = this.section(id);
                const folded = collapsed.has(id);
                const heading = group.querySelector(".builder-section-heading");
                const body = group.querySelector("[data-section-body]");
                if (folded && body.contains(document.activeElement)) heading.querySelector("[data-section-toggle]").focus({preventScroll:true});
                body.hidden = folded;
                heading.classList.toggle("is-collapsed", folded);
                const toggle = heading.querySelector("[data-section-toggle]");
                toggle.setAttribute("aria-expanded", String(!folded));
                toggle.setAttribute("aria-label", `${this.localizedSectionField(section, "title")} ${folded ? "펼치기" : "접기"}`);
                toggle.textContent = folded ? "▸ 펼치기" : "▾ 접기";
                heading.querySelector("[data-section-summary]").textContent = `${section.questions.length}개 문항${folded ? " · 접힘" : ""}${folded && selectedSection === id ? " · 선택 문항 포함" : ""}`;
            });
            const count = this.survey.sections.filter(section => collapsed.has(section.id)).length;
            const status = this.root.querySelector("[data-section-fold-status]");
            const message = `섹션 ${this.survey.sections.length}개 · ${count}개 접힘`;
            if (status.textContent !== message) status.textContent = message;
            this.root.querySelector('[data-sections-fold="collapse"]').disabled = count === this.survey.sections.length;
            this.root.querySelector('[data-sections-fold="expand"]').disabled = count === 0;
        },
        setSectionCollapsed(id, collapsed) {
            if (!this.section(id)) return;
            this.collapsedSections = this.collapsedSections || new Set();
            if (collapsed) this.collapsedSections.add(id); else this.collapsedSections.delete(id);
            this.applySectionFolding();
            if (!collapsed) this.resizeQuestionTitles();
        },
        setAllSectionsCollapsed(collapsed) {
            this.collapsedSections = new Set(collapsed ? this.survey.sections.map(section => section.id) : []);
            this.applySectionFolding();
            if (!collapsed) this.resizeQuestionTitles();
            this.scrollDocumentTarget(this.root.querySelector(".builder-section-heading"), "start");
        },
        scrollOuterToWorkspace() {
            if (!window.matchMedia("(min-width: 60.001rem)").matches) return;
            this.syncToolbarLayout();
            const token = (this.workspaceAlignmentToken || 0) + 1;
            this.workspaceAlignmentToken = token;
            const align = (remaining = 2) => {
                if (this.destroyed || this.workspaceAlignmentToken !== token) return;
                const toolbar = this.root.querySelector(".builder-topbar");
                const workspace = this.root.querySelector(".builder-workspace");
                const headerHeight = parseFloat(getComputedStyle(this.root).getPropertyValue("--header-height")) || 0;
                const offset = window.scrollY + workspace.getBoundingClientRect().top - headerHeight - toolbar.getBoundingClientRect().height;
                window.scrollTo({top:Math.max(0, offset),behavior:"instant"});
                // A newly measured height may update the outer scroll range on the next frame.
                if (remaining && Math.abs(workspace.getBoundingClientRect().top - toolbar.getBoundingClientRect().bottom) > 3) requestAnimationFrame(() => align(remaining - 1));
            };
            requestAnimationFrame(() => align());
        },

        renderDocumentNavigation() {
            const select = this.root.querySelector("[data-canvas-section]");
            select.innerHTML = '<option value="">섹션으로 이동</option>' + this.survey.sections.map((section, index) => `<option value="${Common.escapeHtml(section.id)}">${index + 1}. ${Common.escapeHtml(this.localizedSectionField(section, "title"))}</option>`).join("");
        },
        documentScrollIsIndependent() {
            const scroller = this.root.querySelector("[data-builder-document-scroll]");
            return scroller && getComputedStyle(scroller).overflowY === "auto";
        },
        scrollDocumentTarget(target, alignment = "center") {
            if (!target) return;
            if (target.matches("[data-question-id]")) this.setSectionCollapsed(target.dataset.sectionId, false);
            const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.uiMotion === "reduced";
            const behavior = reduced ? "instant" : "smooth";
            if (this.documentScrollIsIndependent()) {
                this.scrollOuterToWorkspace();
                const scroller = this.root.querySelector("[data-builder-document-scroll]");
                const position = scroller.scrollTop + target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
                const offset = alignment === "start" ? 16 : Math.max(16, (scroller.clientHeight - target.getBoundingClientRect().height) / 2);
                scroller.scrollTo({ top: Math.max(0, position - offset), behavior });
            } else if (alignment === "start") {
                const toolbar = this.root.querySelector(".builder-topbar");
                const toolbox = this.root.querySelector(".builder-toolbox");
                const headerHeight = parseFloat(getComputedStyle(this.root).getPropertyValue("--header-height")) || 0;
                const fixedTop = headerHeight + toolbar.getBoundingClientRect().height + (toolbox.hidden ? 0 : toolbox.getBoundingClientRect().height);
                window.scrollTo({ top: Math.max(0, window.scrollY + target.getBoundingClientRect().top - fixedTop - 16), behavior });
            } else target.scrollIntoView({ behavior, block: alignment });
        },
        navigateDocument(destination) {
            if (destination === "selection") return this.revealSelection();
            if (!["start", "end"].includes(destination)) return;
            const scroller = this.root.querySelector("[data-builder-document-scroll]");
            const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.uiMotion === "reduced";
            const behavior = reduced ? "instant" : "smooth";
            if (this.documentScrollIsIndependent()) scroller.scrollTo({ top: destination === "start" ? 0 : scroller.scrollHeight, behavior });
            else {
                const target = destination === "start" ? scroller : scroller.querySelector(`[data-mode-panel="${this.mode || "questions"}"]`);
                target?.scrollIntoView({ behavior, block: destination === "start" ? "start" : "end" });
            }
        },
        revealSelection(focusTitle = false) {
            requestAnimationFrame(() => {
                if (this.destroyed) return;
                const selector = this.activeId ? `[data-question-id="${CSS.escape(this.activeId)}"]` : `.builder-section-heading[data-section-id="${CSS.escape(this.activeSectionId || "")}"]`;
                const target = this.root?.querySelector(selector);
                this.scrollDocumentTarget(target);
                if (focusTitle) {
                    const title = target?.querySelector("[data-question-title], [data-section-title]");
                    title?.focus({ preventScroll: true });
                    title?.select();
                }
            });
        },
        sectionRemovalPlan(id) {
            const section = this.section(id);
            if (!section) return null;
            const questionIds = new Set(section.questions.map((question) => String(question.id)));
            const dependents = this.survey.questions.filter((question) => !questionIds.has(String(question.id)) && (
                questionIds.has(String(question.settings?.excludeSelectedFrom || "")) ||
                (question.activationCondition?.conditions || []).some((condition) => questionIds.has(String(condition.sourceQuestionId || condition.source_question_id)))
            ));
            const routes = this.survey.settings.audienceRoutes || [];
            const emptyRoutes = routes.filter((route) => route.sectionIds.includes(id) && route.sectionIds.length === 1);
            const blocked = this.survey.sections.length <= 1 ? "설문에는 섹션이 하나 이상 필요합니다."
                : dependents.length ? `다른 섹션의 문항이 이 섹션의 문항을 조건으로 사용합니다: ${dependents.slice(0, 3).map((question) => this.localizedQuestionField(question, "title")).join(", ")}. 해당 문항의 활성화 조건 또는 선행 보기 제외 연결을 먼저 수정해 주세요.`
                : emptyRoutes.length ? `이 섹션을 삭제하면 대상 “${emptyRoutes.map((route) => route.label || route.code).join(", ")}”에 표시할 섹션이 없어집니다. 대상·섹션 분기에서 다른 섹션을 지정하거나 해당 대상을 먼저 삭제해 주세요.` : "";
            const rules = (this.survey.logicRules || []).filter((rule) => ![
                rule?.questionId, rule?.sourceQuestionId, rule?.targetQuestionId, rule?.destinationQuestionId
            ].some((reference) => questionIds.has(String(reference ?? ""))) && ![
                rule?.targetSectionId, rule?.destinationSectionId, rule?.gotoSectionId, rule?.destination
            ].some((reference) => String(reference ?? "") === String(id)));
            return { section, questionIds, rules, dependents, emptyRoutes, blocked,
                ruleCount: (this.survey.logicRules || []).length - rules.length,
                routeCount: routes.filter((route) => route.sectionIds.includes(id)).length };
        },
        confirmSectionRemoval(id) {
            const plan = this.sectionRemovalPlan(id);
            if (!plan) return;
            const dialog = this.context.openModal(`<section class="builder-section-removal"><h2>섹션 삭제</h2><p>삭제할 섹션: <strong>${Common.escapeHtml(this.localizedSectionField(plan.section, "title"))}</strong></p><p>${plan.section.questions.length ? `포함된 문항 <strong>${plan.section.questions.length}개</strong>도 함께 삭제합니다.` : "문항이 없는 빈 섹션을 삭제합니다."}</p><ul><li>문항과 해당 번역이 함께 삭제됩니다.</li>${plan.ruleCount ? `<li>연결된 이동 분기 규칙 ${plan.ruleCount}개도 삭제됩니다.</li>` : ''}${plan.routeCount ? `<li>대상 ${plan.routeCount}개의 표시 섹션에서 제외됩니다.</li>` : ''}</ul><p>상단 저장을 눌러야 삭제가 저장됩니다. 변경 취소로 되돌릴 수 있으며 공개 설문에는 재확정한 뒤 반영됩니다.</p>${plan.blocked ? `<p class="form-error" role="alert">${Common.escapeHtml(plan.blocked)}</p>` : ''}<div class="builder-section-removal-actions"><button class="button button-function" type="button" data-section-remove-cancel>취소</button>${plan.emptyRoutes.length ? '<button class="button button-function" type="button" data-section-review-audiences>대상·섹션 분기 수정</button>' : ''}${plan.dependents.length ? '<button class="button button-function" type="button" data-section-review-dependent>연결된 문항 확인</button>' : ''}<button class="button button-delete" type="button" data-section-remove-confirm ${plan.blocked ? 'disabled' : ''}>${plan.section.questions.length ? '섹션과 문항 삭제' : '빈 섹션 삭제'}</button></div></section>`, { label: "섹션 삭제 확인", initialFocus: "[data-section-remove-cancel]" });
            const afterClose = (callback) => {
                dialog.addEventListener("close", () => { if (!this.destroyed) callback(); }, { once: true });
                dialog.close();
            };
            dialog.querySelector("[data-section-remove-cancel]").addEventListener("click", () => dialog.close());
            dialog.querySelector("[data-section-review-audiences]")?.addEventListener("click", () => afterClose(() => this.editAudiences()));
            dialog.querySelector("[data-section-review-dependent]")?.addEventListener("click", () => {
                afterClose(() => { this.openProperties(plan.dependents[0].id); this.revealSelection(); });
            });
            dialog.querySelector("[data-section-remove-confirm]").addEventListener("click", () => {
                if (this.removeSection(id)) afterClose(() => this.revealSelection(true));
            });
        },
        removeSection(id) {
            const plan = this.sectionRemovalPlan(id);
            if (!plan) return false;
            if (plan.blocked) { this.context.toast(plan.blocked, "error"); return false; }
            const index = this.survey.sections.findIndex((section) => section.id === id);
            plan.questionIds.forEach((questionId) => this.pruneQuestionTranslations(questionId));
            Object.values(this.survey.translations || {}).forEach((bucket) => {
                if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) return;
                ["sections", "sectionTitles", "section_titles", "sectionDescriptions", "section_descriptions"].forEach((field) => {
                    if (bucket[field] && typeof bucket[field] === "object") delete bucket[field][id];
                });
            });
            this.survey.sections.splice(index, 1);
            this.survey.logicRules = plan.rules;
            (this.survey.settings.audienceRoutes || []).forEach((route) => { route.sectionIds = route.sectionIds.filter((sectionId) => sectionId !== id); });
            this.refreshQuestions();
            if (this.activeSectionId === id || plan.questionIds.has(String(this.activeId))) this.selectSection(this.survey.sections[Math.min(index, this.survey.sections.length - 1)].id);
            this.renderQuestions();
            this.renderRules();
            this.renderAudienceSummary();
            this.markDirty();
            this.context.toast("섹션을 삭제했습니다.", "success");
            return true;
        },
        openProperties(id) {
            if (this.mode && this.mode !== "questions") return;
            this.selectQuestion(id, false);
            const question = this.question(id);
            if (!question) return;
            this.root.querySelector("[data-properties-empty]").hidden = true;
            this.root.querySelector("[data-properties-panel]").hidden = false;
            this.root.querySelector(".builder-properties").classList.add("is-open");
            this.root.querySelector("[data-properties-type]").textContent = this.typeLabel(question.type);
            this.root.querySelector("[data-response-contract]").textContent = this.responseContract(question);
            this.renderScalePoints(question);
            const behaviorSelect = this.root.querySelector("[data-prop-behavior]");
            behaviorSelect.value = question.behavior || (question.required ? "fixed_required" : "fixed_optional");
            behaviorSelect.disabled = question.type === "notice";
            const excludeNumber = this.root.querySelector("[data-prop-exclude-numbering]");
            excludeNumber.checked = question.type === "notice" || question.settings?.excludeFromNumbering === true;
            excludeNumber.disabled = question.type === "notice";
            this.renderActivationConditions(question);
            const descriptionEnabled = this.root.querySelector("[data-prop-description-enabled]");
            descriptionEnabled.checked = Boolean(question.description);
            descriptionEnabled.disabled = this.editingLocale !== this.survey.languages.sourceLocale;
            this.root.querySelector("[data-prop-description-field]").hidden = !question.description;
            this.root.querySelector("[data-prop-description]").value = this.localizedQuestionField(question, "description");
            this.root.querySelector("[data-prop-validation]").value = question.validation?.type || "none";
            this.root.querySelector("[data-prop-number-field]").hidden = !rangeTypes.has(question.type);
            this.root.querySelector("[data-prop-range-field]").hidden = !rangeTypes.has(question.type);
            this.root.querySelector("[data-prop-scale-label-field]").hidden = question.type !== "scale";
            this.root.querySelector("[data-prop-scale-range-help]").hidden = question.type !== "scale";
            this.root.querySelector("[data-prop-scale-order-field]").hidden = question.type !== "scale";
            this.root.querySelector("[data-prop-scale-order]").value = question.settings?.scaleOrder || "ascending";
            this.root.querySelector("[data-prop-scale-display-field]").hidden = question.type !== "scale";
            this.root.querySelector("[data-prop-scale-display]").value = question.settings?.scaleDisplay || "buttons";
            this.root.querySelector("[data-prop-unit]").value = this.localizedQuestionField(question, "unit");
            const minimumInput = this.root.querySelector("[data-prop-min]");
            const maximumInput = this.root.querySelector("[data-prop-max]");
            minimumInput.value = question.min ?? "";
            maximumInput.value = question.max ?? "";
            [[minimumInput, "min", "max", "step"], [maximumInput, "min", "max", "step"]].forEach(([input, ...attributes]) => attributes.forEach((attribute) => input.removeAttribute(attribute)));
            if (question.type === "scale") {
                minimumInput.min = "0";
                minimumInput.max = "1";
                minimumInput.step = "1";
                maximumInput.min = "2";
                maximumInput.max = "10";
                maximumInput.step = "1";
            }
            this.root.querySelector("[data-prop-min-label]").value = this.localizedQuestionField(question, "minLabel");
            this.root.querySelector("[data-prop-max-label]").value = this.localizedQuestionField(question, "maxLabel");
            this.root.querySelector("[data-prop-notice-content]").hidden = question.type !== "notice";
            this.root.querySelector("[data-prop-choice-settings]").hidden = !optionTypes.has(question.type);
            this.root.querySelector("[data-prop-choice-input-field]").hidden = question.type !== "multiple";
            this.root.querySelector("[data-prop-choice-input]").value = question.settings?.choiceInput || "options";
            this.root.querySelector("[data-prop-choice-layout-field]").hidden = !["single", "multiple"].includes(question.type);
            this.root.querySelector("[data-prop-choice-layout]").value = question.settings?.choiceLayout || "vertical";
            this.root.querySelector("[data-prop-choice-layout]").disabled = question.settings?.choiceInput === "codes";
            this.root.querySelector("[data-prop-searchable]").checked = Boolean(question.settings?.searchable);
            this.root.querySelector("[data-prop-selection-limits]").hidden = question.type !== "multiple";
            this.root.querySelector("[data-prop-min-selections]").value = question.settings?.minSelections ?? "";
            this.root.querySelector("[data-prop-max-selections]").value = question.settings?.maxSelections ?? "";
            const sourceSelect = this.root.querySelector("[data-prop-exclude-source]");
            const currentIndex = this.survey.questions.indexOf(question);
            const sources = this.survey.questions.slice(0, currentIndex).filter((item) => optionTypes.has(item.type));
            sourceSelect.innerHTML = '<option value="">제외하지 않음</option>' + sources.map((source) => `<option value="${Common.escapeHtml(source.id)}">${Common.escapeHtml(source.title)}</option>`).join("");
            sourceSelect.value = question.settings?.excludeSelectedFrom || "";
            this.root.querySelector("[data-sync-source-options]").disabled = !question.settings?.excludeSelectedFrom;
            this.renderAxisProperties(question);
        },
        renderAxisProperties(question) {
            const panel = this.root.querySelector("[data-prop-axis-field]");
            const supportsAxes = matrixTypes.has(question.type);
            panel.hidden = !supportsAxes;
            if (!supportsAxes) return;
            this.syncQuestionCompatibility(question);
            const sourceEditing = this.editingLocale === this.survey.languages.sourceLocale;
            const repeat = question.type === "repeat_table";
            this.root.querySelector("[data-axis-row-group]").hidden = repeat;
            this.root.querySelector("[data-axis-settings-help]").textContent = repeat
                ? "가로 열을 구성합니다. 세로 행은 응답자가 필요한 만큼 직접 추가합니다."
                : question.type === "table"
                    ? "세로 행과 가로 열마다 텍스트 입력칸이 만들어집니다."
                    : "세로 행마다 가로 보기 중 하나 또는 여러 개를 선택합니다.";
            this.root.querySelector("[data-axis-structure-summary]").textContent = repeat
                ? `${question.columns.length}열 · 행 추가형`
                : `${question.rows.length}행 × ${question.columns.length}열`;
            ["rows", "columns"].forEach((field) => {
                const host = this.root.querySelector(`[data-axis-list="${field}"]`);
                const label = field === "rows" ? "행" : "열";
                host.innerHTML = (question[field] || []).map((value, index) => `<div class="axis-item"><span>${index + 1}</span><label>표시 문구<input type="text" maxlength="500" data-matrix-${field === "rows" ? "row" : "column"}-index="${index}" value="${Common.escapeHtml(this.localizedIndexedLabel(question, field, index))}" aria-label="${index + 1}번 ${label} 제목"></label><label class="axis-result-field">결과 코드<input type="text" maxlength="120" data-axis-result-code="${field}" data-axis-index="${index}" value="${Common.escapeHtml(question.settings[field][index].resultCode)}" aria-label="${index + 1}번 ${label} 결과 코드" ${!sourceEditing ? 'disabled' : ''}></label><div class="axis-item-actions"><button type="button" data-axis-move="${field}" data-axis-index="${index}" data-axis-direction="-1" aria-label="${index + 1}번 ${label} 위로 이동" ${!sourceEditing || index === 0 ? "disabled" : ""}>↑</button><button type="button" data-axis-move="${field}" data-axis-index="${index}" data-axis-direction="1" aria-label="${index + 1}번 ${label} 아래로 이동" ${!sourceEditing || index === question[field].length - 1 ? "disabled" : ""}>↓</button><button type="button" data-axis-insert="${field}" data-axis-index="${index}" ${!sourceEditing ? 'disabled' : ''}>＋ 아래 삽입</button><button type="button" class="is-delete" data-axis-delete="${field}" data-axis-index="${index}" aria-label="${index + 1}번 ${label} 삭제" ${!sourceEditing || question[field].length <= 1 ? "disabled" : ""}>×</button></div></div>`).join("");
            });
            panel.querySelectorAll("[data-axis-add]").forEach((button) => { button.disabled = !sourceEditing; });
            panel.classList.toggle("is-translation", !sourceEditing);
        },
        renderActivationConditions(question) {
            const behavior = question.behavior || (question.required ? "fixed_required" : "fixed_optional");
            const dynamic = behavior.startsWith("dynamic_");
            const builder = this.root.querySelector("[data-prop-condition-builder]");
            builder.hidden = !dynamic;
            if (!dynamic) return;
            question.activationCondition ||= { combinator: "all", conditions: [] };
            const questionIndex = this.survey.questions.findIndex((item) => String(item.id) === String(question.id));
            const sources = this.survey.questions.slice(0, questionIndex).filter((item) => item.type !== "notice");
            this.root.querySelector("[data-condition-combinator]").value = question.activationCondition.combinator || "all";
            this.root.querySelector("[data-condition-list]").innerHTML = question.activationCondition.conditions.map((condition, index) => `<div class="question-condition-row" data-condition-index="${index}"><label>선행 문항<select data-condition-source>${sources.map((source) => `<option value="${Common.escapeHtml(source.id)}" ${String(source.id) === String(condition.sourceQuestionId || condition.source_question_id) ? "selected" : ""}>${Common.escapeHtml(this.localizedQuestionField(source, "title"))} · ${Common.escapeHtml(source.id)}</option>`).join("")}</select></label><label>조건<select data-condition-operator><option value="equals" ${condition.operator === "equals" ? "selected" : ""}>같음</option><option value="not_equals" ${condition.operator === "not_equals" ? "selected" : ""}>같지 않음</option><option value="contains" ${condition.operator === "contains" ? "selected" : ""}>포함</option><option value="in" ${condition.operator === "in" ? "selected" : ""}>목록 중 하나</option><option value="exists" ${condition.operator === "exists" ? "selected" : ""}>응답값 존재</option><option value="not_exists" ${condition.operator === "not_exists" ? "selected" : ""}>응답값 없음</option><option value="greater_than" ${condition.operator === "greater_than" ? "selected" : ""}>보다 큼</option><option value="greater_or_equal" ${condition.operator === "greater_or_equal" ? "selected" : ""}>이상</option><option value="less_than" ${condition.operator === "less_than" ? "selected" : ""}>보다 작음</option><option value="less_or_equal" ${condition.operator === "less_or_equal" ? "selected" : ""}>이하</option></select></label><label>비교 값${this.activationConditionValueMarkup(condition, sources)}</label><button type="button" data-remove-condition="${index}" aria-label="조건 삭제" ${question.activationCondition.conditions.length <= 1 ? "disabled" : ""}>×</button></div>`).join("");
            this.root.querySelector("[data-add-condition]").disabled = !sources.length;
        },
        activationConditionValueMarkup(condition, sources) {
            const operator = condition.operator || "equals";
            const disabled = ["exists", "not_exists"].includes(operator);
            const sourceId = String(condition.sourceQuestionId || condition.source_question_id || "");
            const source = sources.find((candidate) => String(candidate.id) === sourceId);
            const values = (Array.isArray(condition.value) ? condition.value : [condition.value]).filter((value) => value !== null && value !== undefined && String(value) !== "").map(String);
            const options = Array.isArray(source?.options) ? source.options : [];
            if (!disabled && options.length && ["equals", "not_equals", "contains", "in"].includes(operator)) {
                const multiple = operator === "in";
                const knownIds = new Set(options.map((option) => String(option.id)));
                const legacy = values.filter((value) => !knownIds.has(value));
                return `<select data-condition-value ${multiple ? 'multiple size="4" aria-label="비교할 보기 복수 선택"' : ""}>${multiple ? "" : '<option value="">비교할 보기 선택</option>'}${options.map((option) => `<option value="${Common.escapeHtml(option.id)}" ${values.includes(String(option.id)) ? "selected" : ""}>${Common.escapeHtml(this.localizedOptionLabel(source, option))} · 결과 코드 ${Common.escapeHtml(option.resultCode ?? option.id)}</option>`).join("")}${legacy.map((value) => `<option value="${Common.escapeHtml(value)}" selected>기존 값 · ${Common.escapeHtml(value)}</option>`).join("")}</select>${multiple ? "<small>PC에서는 Ctrl/Command 키로, 모바일에서는 목록에서 여러 보기를 선택합니다.</small>" : ""}`;
            }
            return `<input data-condition-value value="${Common.escapeHtml(values.join(","))}" placeholder="비교할 응답값" ${disabled ? "disabled" : ""}>`;
        },
        addActivationCondition() {
            const question = this.question(this.activeId);
            const index = this.survey.questions.findIndex((item) => String(item.id) === String(question?.id));
            const source = this.survey.questions.slice(0, index).find((item) => item.type !== "notice");
            if (!question || !source) return this.context.toast("동적 문항 앞에 응답 가능한 선행 문항을 먼저 배치해 주세요.", "error");
            question.activationCondition ||= { combinator: "all", conditions: [] };
            question.activationCondition.conditions.push({ sourceQuestionId: source.id, operator: "exists", value: null });
            this.openProperties(question.id);
            this.markDirty();
        },
        removeActivationCondition(index) {
            const question = this.question(this.activeId);
            if (!question?.activationCondition) return;
            if (question.activationCondition.conditions.length <= 1) return this.context.toast("동적 문항에는 활성화 조건이 한 개 이상 필요합니다.", "error");
            question.activationCondition.conditions.splice(index, 1);
            this.openProperties(question.id);
            this.markDirty();
        },
        closeProperties() { this.root.querySelector(".builder-properties").classList.remove("is-open"); },
        handleInput(event) {
            if (!this.survey || event.target.matches("[data-insertion-position], [data-canvas-section]")) return;
            if (event.target.matches("[data-section-title]")) {
                const section = this.section(event.target.closest("[data-section-id]")?.dataset.sectionId);
                if (section) this.setLocalizedSectionField(section, "title", this.editingLocale === this.survey.languages.sourceLocale ? (event.target.value || "새 섹션") : event.target.value);
                this.renderDocumentNavigation();
                this.markDirty();
                return;
            }
            if (event.target.matches("[data-section-description]")) {
                const section = this.section(event.target.closest("[data-section-id]")?.dataset.sectionId);
                if (section) this.setLocalizedSectionField(section, "description", event.target.value);
                this.markDirty();
                return;
            }
            if (event.target.matches("[data-builder-title], [data-survey-heading]")) {
                this.setLocalizedSurveyField("title", event.target.value);
                const other = event.target.matches("[data-builder-title]") ? this.root.querySelector("[data-survey-heading]") : this.root.querySelector("[data-builder-title]");
                if (document.activeElement !== other) other.value = event.target.value;
                this.markDirty(); return;
            }
            if (event.target.matches("[data-survey-description]")) { this.setLocalizedSurveyField("description", event.target.value); this.markDirty(); return; }
            if (event.target.matches('[data-setting="confirmationMessage"]')) { this.setLocalizedSurveyField("confirmationMessage", event.target.value); this.markDirty(); return; }
            const card = event.target.closest("[data-question-id]");
            const question = card ? this.question(card.dataset.questionId) : this.question(this.activeId);
            if (!question) return;
            if (event.target.matches("[data-question-title]")) { this.setDisplayedQuestionTitle(question, event.target.value); this.resizeQuestionTitles(); }
            if (event.target.matches("[data-option-id]")) { const option = question.options?.find((item) => item.id === event.target.dataset.optionId); if (option) this.setLocalizedOptionLabel(question, option, event.target.value); }
            if (event.target.matches("[data-option-result-code], [data-axis-result-code], [data-scale-code], [data-scale-label]")) {
                if (this.editingLocale !== this.survey.languages.sourceLocale) return;
                let item;
                let group;
                if (event.target.matches("[data-option-result-code]")) { group = question.options; item = group.find(option => option.id === event.target.dataset.optionResultCode); }
                else if (event.target.matches("[data-axis-result-code]")) { group = question.settings[event.target.dataset.axisResultCode]; item = group[Number(event.target.dataset.axisIndex)]; }
                else { group = question.settings.scalePoints; item = group.find(point => point.score === Number(event.target.dataset.scaleCode ?? event.target.dataset.scaleLabel)); }
                if (!item) return;
                const label = event.target.matches("[data-scale-label]");
                item[label ? "label" : "resultCode"] = label ? event.target.value : event.target.value.trim();
                const valid = label || (item.resultCode.length > 0 && !/[\x00-\x1f\x7f]/.test(item.resultCode) && !group.some(other => other !== item && other.resultCode === item.resultCode));
                event.target.setCustomValidity(valid ? "" : "비어 있지 않은 고유한 결과 코드를 입력하세요.");
                event.target.setAttribute("aria-invalid", String(!valid));
                this.validateCodeControls(question);
                this.markDirty(); return;
            }
            if (event.target.matches("[data-option-code]")) {
                const option = question.options.find(item => item.id === event.target.dataset.optionCode);
                const code = event.target.value.trim();
                const valid = /^[1-9][0-9]{0,5}$/.test(code) && !question.options.some(item => item !== option && item.code === code);
                event.target.setCustomValidity(valid ? "" : "다른 보기와 겹치지 않는 1~999999 번호를 입력하세요.");
                option.code = code;
                event.target.setAttribute("aria-invalid", String(!valid));
                this.validateCodeControls(question);
            }
            if (event.target.matches("[data-prop-description]")) this.setLocalizedQuestionField(question, "description", event.target.value);
            if (event.target.matches("[data-prop-unit]")) this.setLocalizedQuestionField(question, "unit", event.target.value);
            if (event.target.matches("[data-prop-min-label]")) this.setLocalizedQuestionField(question, "minLabel", event.target.value);
            if (event.target.matches("[data-prop-max-label]")) this.setLocalizedQuestionField(question, "maxLabel", event.target.value);
            if (event.target.matches("[data-matrix-row-index]")) this.updateAxisLabel(question, "rows", Number(event.target.dataset.matrixRowIndex), event.target.value, event.target);
            if (event.target.matches("[data-matrix-column-index]")) this.updateAxisLabel(question, "columns", Number(event.target.dataset.matrixColumnIndex), event.target.value, event.target);
            if (event.target.matches("[data-prop-min]")) {
                const value = event.target.value === "" ? null : Number(event.target.value);
                question.min = question.type === "scale" && value !== null ? Math.min(1, Math.max(0, Math.round(value))) : value;
                if (question.type === "scale" && value !== null) event.target.value = String(question.min);
            }
            if (event.target.matches("[data-prop-max]")) {
                const value = event.target.value === "" ? null : Number(event.target.value);
                question.max = question.type === "scale" && value !== null ? Math.min(10, Math.max(2, Math.round(value))) : value;
                if (question.type === "scale" && value !== null) event.target.value = String(question.max);
            }
            if (question.type === "scale" && event.target.matches("[data-prop-min], [data-prop-max]")) this.renderScalePoints(question);
            this.markDirty();
        },
        handleChange(event) {
            if (!this.survey) return;
            if (event.target.matches("[data-canvas-section]")) {
                const heading = [...this.root.querySelectorAll(".builder-section-heading")].find(node => node.dataset.sectionId === event.target.value);
                if (heading) {
                    this.setSectionCollapsed(heading.dataset.sectionId, false);
                    this.scrollDocumentTarget(heading);
                }
                event.target.value = "";
                return;
            }
            if (event.target.matches("[data-insertion-position]")) {
                this.insertionMode = event.target.value;
                this.updateSelection();
                return;
            }
            if (event.target.matches("[data-edit-locale]")) {
                this.editingLocale = this.survey.languages.enabled.includes(event.target.value) ? event.target.value : this.survey.languages.sourceLocale;
                this.renderSurvey();
                if (this.activeId) this.openProperties(this.activeId);
                return;
            }
            if (event.target.matches("[data-source-locale]")) {
                const next = this.localeCode(event.target.value);
                const result = this.changeSourceLocale(next);
                if (!result.changed) {
                    this.renderLanguageControls();
                    const preview = result.gaps.slice(0, 3).join(", ");
                    this.context.toast(`원문 언어를 바꾸려면 ${this.localeLabel(next)} 번역을 먼저 완성하세요.${preview ? ` 누락: ${preview}${result.gaps.length > 3 ? ` 외 ${result.gaps.length - 3}개` : ""}` : ""}`, "error");
                    return;
                }
                this.renderSurvey();
                if (this.activeId) this.openProperties(this.activeId);
                this.context.toast(`원문을 ${this.localeLabel(next)}로 전환하고 이전 원문을 번역으로 보존했습니다.`, "success");
                this.markDirty();
                return;
            }
            if (event.target.matches("[data-default-locale]")) {
                if (this.survey.languages.enabled.includes(event.target.value)) this.survey.languages.defaultLocale = event.target.value;
                this.renderLanguageControls();
                this.markDirty();
                return;
            }
            if (event.target.matches("[data-language-code]")) {
                const code = this.localeCode(event.target.dataset.languageCode, undefined, null);
                if (!code || code === this.survey.languages.sourceLocale) return this.renderLanguageControls();
                if (event.target.checked && !this.survey.languages.enabled.includes(code)) this.survey.languages.enabled.push(code);
                if (!event.target.checked) {
                    this.survey.languages.enabled = this.survey.languages.enabled.filter((item) => item !== code);
                    delete this.survey.translations[code];
                }
                if (!this.survey.languages.enabled.includes(this.survey.languages.defaultLocale)) this.survey.languages.defaultLocale = this.survey.languages.sourceLocale;
                if (!this.survey.languages.enabled.includes(this.editingLocale)) this.editingLocale = this.survey.languages.sourceLocale;
                this.renderSurvey();
                if (this.activeId) this.openProperties(this.activeId);
                this.markDirty();
                return;
            }
            const setting = event.target.dataset.setting;
            if (setting) {
                const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
                if (setting === "confirmationMessage") {
                    this.setLocalizedSurveyField("confirmationMessage", value);
                    this.markDirty();
                    return;
                }
                const canonicalName = { showProgress: "showProgressBar", oneResponse: "oneResponsePerRespondent", allowEdit: "allowResponseEdit" }[setting];
                this.survey.settings[setting] = value;
                if (setting === "showQuestionNumbers") this.renderQuestions();
                if (canonicalName) this.survey.settings[canonicalName] = value;
                this.markDirty();
                return;
            }
            const ruleElement = event.target.closest("[data-rule-id]");
            if (ruleElement) {
                const rule = this.survey.logicRules.find((item) => String(item.id) === ruleElement.dataset.ruleId);
                if (rule) {
                    if (event.target.matches("[data-rule-question]")) {
                        rule.questionId = event.target.value;
                        rule.sourceQuestionId = event.target.value;
                        rule.value = "";
                        this.renderRules();
                    }
                    if (event.target.matches("[data-rule-operator]")) rule.operator = event.target.value;
                    if (event.target.matches("[data-rule-value]")) rule.value = event.target.value;
                    if (event.target.matches("[data-rule-destination]")) {
                        rule.destination = event.target.value;
                        rule.targetSectionId = event.target.value === "complete" || event.target.value === "next" ? null : event.target.value;
                    }
                    this.markDirty();
                }
                return;
            }
            const question = this.question(this.activeId);
            if (!question) return;
            for (const [selector, key] of [["[data-prop-min-selections]", "minSelections"], ["[data-prop-max-selections]", "maxSelections"]]) {
                if (event.target.matches(selector)) question.settings = { ...(question.settings || {}), [key]: event.target.value === "" ? null : Number(event.target.value) };
            }
            if (event.target.matches("[data-prop-exclude-numbering]")) {
                question.settings = { ...(question.settings || {}), excludeFromNumbering: event.target.checked };
                this.renderQuestions();
            }
            if (event.target.matches("[data-prop-scale-order]")) question.settings = { ...(question.settings || {}), scaleOrder: event.target.value };
            if (event.target.matches("[data-prop-scale-display]")) question.settings = { ...(question.settings || {}), scaleDisplay: event.target.value };
            if (event.target.matches("[data-prop-scale-order], [data-prop-scale-display], [data-scale-label], [data-prop-min], [data-prop-max]")) this.renderQuestions();
            if (event.target.matches("[data-prop-choice-layout]")) {
                question.settings = { ...(question.settings || {}), choiceLayout: event.target.value };
                this.renderQuestions();
            }
            if (event.target.matches("[data-prop-choice-input]")) {
                question.settings = { ...(question.settings || {}), choiceInput: event.target.value };
                if (event.target.value === "codes") {
                    this.ensureOptionCodes(question);
                    question.settings.maxSelections = Math.min(20, question.settings.maxSelections || 5);
                    if (question.settings.minSelections > question.settings.maxSelections) question.settings.minSelections = question.settings.maxSelections;
                }
                this.renderQuestions(); this.openProperties(question.id);
            }
            if (event.target.matches("[data-prop-searchable]")) question.settings = { ...(question.settings || {}), searchable: event.target.checked };
            if (event.target.matches("[data-prop-exclude-source]")) return this.chooseExcludedSource(question, event.target.value);
            if (event.target.matches("[data-prop-behavior]")) {
                const nextBehavior = event.target.value;
                if (nextBehavior.startsWith("dynamic_")) {
                    const questionIndex = this.survey.questions.findIndex((item) => String(item.id) === String(question.id));
                    const source = this.survey.questions.slice(0, questionIndex).find((item) => item.type !== "notice");
                    if (!source) {
                        event.target.value = question.behavior;
                        return this.context.toast("동적 문항 앞에 응답 가능한 선행 문항을 먼저 배치해 주세요.", "error");
                    }
                    question.activationCondition ||= { combinator: "all", conditions: [{ sourceQuestionId: source.id, operator: "exists", value: null }] };
                } else question.activationCondition = null;
                question.behavior = nextBehavior;
                question.required = ["fixed_required", "dynamic_required"].includes(question.behavior);
                this.openProperties(question.id);
                this.renderQuestions();
            }
            if (event.target.matches("[data-condition-combinator]")) question.activationCondition.combinator = event.target.value;
            const conditionRow = event.target.closest("[data-condition-index]");
            if (conditionRow && question.activationCondition) {
                const condition = question.activationCondition.conditions[Number(conditionRow.dataset.conditionIndex)];
                if (condition) {
                    if (event.target.matches("[data-condition-source]")) {
                        condition.sourceQuestionId = event.target.value;
                        condition.value = null;
                        this.openProperties(question.id);
                    }
                    if (event.target.matches("[data-condition-operator]")) {
                        condition.operator = event.target.value;
                        if (["exists", "not_exists"].includes(condition.operator)) condition.value = null;
                        this.openProperties(question.id);
                    }
                    if (event.target.matches("[data-condition-value]")) {
                        condition.value = event.target.multiple
                            ? [...event.target.selectedOptions].map((option) => option.value)
                            : event.target.value.includes(",") ? event.target.value.split(",").map((value) => value.trim()).filter(Boolean) : event.target.value;
                    }
                }
            }
            if (event.target.matches("[data-prop-description-enabled]") && this.editingLocale === this.survey.languages.sourceLocale) { if (event.target.checked && !question.description) question.description = "응답 기준이나 도움말을 입력하세요."; if (!event.target.checked) question.description = ""; this.openProperties(question.id); this.renderQuestions(); }
            if (event.target.matches("[data-prop-validation]")) question.validation = { ...(question.validation || {}), type: event.target.value };
            this.markDirty();
        },
        section(id) { return this.survey.sections.find((item) => String(item.id) === String(id)); },
        question(id) { return this.questionLocation(id)?.question || null; },
        questionLocation(id) {
            for (let sectionIndex = 0; sectionIndex < this.survey.sections.length; sectionIndex += 1) {
                const section = this.survey.sections[sectionIndex];
                const questionIndex = section.questions.findIndex((item) => String(item.id) === String(id));
                if (questionIndex >= 0) return { section, sectionIndex, questionIndex, question: section.questions[questionIndex] };
            }
            return null;
        },
        moveQuestion(id, delta) {
            const flatIndex = this.survey.questions.findIndex((item) => String(item.id) === String(id));
            const target = this.survey.questions[flatIndex + delta];
            if (flatIndex < 0 || !target) return;
            this.reorderTo(id, target.id, delta > 0);
        },
        reorderTo(fromId, targetId, placeAfter = false) {
            const from = this.questionLocation(fromId);
            const target = this.questionLocation(targetId);
            if (!from || !target) return;
            const originalSections = structuredClone(this.survey.sections);
            const originalTranslations = structuredClone(this.survey.translations || {});
            const sourceSectionId = String(from.section.id);
            const [question] = from.section.questions.splice(from.questionIndex, 1);
            const targetAfterRemoval = this.questionLocation(targetId);
            const insertAt = targetAfterRemoval.questionIndex + (placeAfter ? 1 : 0);
            targetAfterRemoval.section.questions.splice(insertAt, 0, question);
            const destinationSectionId = String(targetAfterRemoval.section.id);
            if (sourceSectionId !== destinationSectionId) this.moveQuestionTranslations(question.id, sourceSectionId, destinationSectionId);
            this.refreshQuestions();
            const orderProblem = this.activationOrderProblem();
            if (orderProblem) {
                this.survey.sections = originalSections;
                this.survey.translations = originalTranslations;
                this.refreshQuestions();
                this.renderQuestions();
                return this.context.toast(`문항을 이동할 수 없습니다. ${orderProblem}`, "error");
            }
            this.renderQuestions();
            this.markDirty();
        },
        moveQuestionTranslations(questionId, sourceSectionId, destinationSectionId) {
            const questionKey = String(questionId);
            Object.values(this.survey.translations || {}).forEach((bucket) => {
                if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) return;
                const sourceQuestions = bucket.sections?.[sourceSectionId]?.questions;
                if (!sourceQuestions || !Object.prototype.hasOwnProperty.call(sourceQuestions, questionKey)) return;
                const translatedQuestion = sourceQuestions[questionKey];
                delete sourceQuestions[questionKey];
                if (!bucket.sections[destinationSectionId] || typeof bucket.sections[destinationSectionId] !== "object") {
                    bucket.sections[destinationSectionId] = { title: "", description: "", questions: {} };
                }
                const destination = bucket.sections[destinationSectionId];
                if (!destination.questions || typeof destination.questions !== "object") destination.questions = {};
                destination.questions[questionKey] = translatedQuestion;
            });
        },
        duplicateQuestion(id) {
            const location = this.questionLocation(id);
            if (!location) return;
            const copy = structuredClone(location.question);
            copy.id = uid();
            if (copy.options && !copy.settings?.excludeSelectedFrom) copy.options = copy.options.map((item) => ({ ...item, id: uid("o") }));
            location.section.questions.splice(location.questionIndex + 1, 0, copy);
            this.refreshQuestions();
            this.activeId = copy.id;
            this.activeSectionId = location.section.id;
            this.addedQuestionId = copy.id;
            this.renderQuestions();
            this.openProperties(copy.id);
            if (window.matchMedia("(max-width: 78rem)").matches) this.closeProperties();
            this.markDirty();
            this.revealSelection(true);
        },
        pruneQuestionTranslations(questionId) {
            const key = String(questionId);
            Object.values(this.survey.translations || {}).forEach((bucket) => {
                if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) return;
                Object.values(bucket.sections || {}).forEach((sectionTranslation) => {
                    if (sectionTranslation?.questions && typeof sectionTranslation.questions === "object") delete sectionTranslation.questions[key];
                });
                ["questionTitles", "question_titles", "questionDescriptions", "question_descriptions", "optionLabels", "option_labels"].forEach((field) => {
                    if (bucket[field] && typeof bucket[field] === "object") delete bucket[field][key];
                });
            });
        },
        pruneOptionTranslations(questionId, optionId) {
            const questionKey = String(questionId);
            const optionKey = String(optionId);
            Object.values(this.survey.translations || {}).forEach((bucket) => {
                if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) return;
                Object.values(bucket.sections || {}).forEach((sectionTranslation) => {
                    const options = sectionTranslation?.questions?.[questionKey]?.options;
                    if (options && typeof options === "object") delete options[optionKey];
                });
                ["optionLabels", "option_labels"].forEach((field) => {
                    const labels = bucket[field]?.[questionKey];
                    if (labels && typeof labels === "object") delete labels[optionKey];
                });
            });
        },
        updateAxisLabel(question, field, index, value, sourceInput) {
            this.setLocalizedIndexedLabel(question, field, index, value);
            if (this.editingLocale === this.survey.languages.sourceLocale) this.syncQuestionCompatibility(question);
            const attribute = field === "rows" ? "data-matrix-row-index" : "data-matrix-column-index";
            const card = this.root.querySelector(`[data-question-id="${CSS.escape(question.id)}"]`);
            const candidates = [
                card?.querySelector(`[${attribute}="${index}"]`),
                this.activeId === question.id ? this.root.querySelector(`[data-prop-axis-field] [${attribute}="${index}"]`) : null
            ];
            candidates.forEach((input) => { if (input && input !== sourceInput) input.value = value; });
        },
        canonicalizeAxisTranslations(question, field, excludedIndex = -1) {
            const items = Array.isArray(question.settings?.[field]) ? question.settings[field] : [];
            const questionKey = String(question.id);
            Object.values(this.survey.translations || {}).forEach((bucket) => {
                if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) return;
                Object.values(bucket.sections || {}).forEach((sectionTranslation) => {
                    const translatedQuestion = sectionTranslation?.questions?.[questionKey];
                    const current = translatedQuestion?.[field];
                    if (!current || typeof current !== "object" || Array.isArray(current)) return;
                    const rebuilt = {};
                    items.forEach((item, index) => {
                        if (index === excludedIndex) return;
                        const value = current[item.id] ?? current[index];
                        if (value !== undefined) rebuilt[item.id] = value;
                    });
                    translatedQuestion[field] = rebuilt;
                });
            });
        },
        addAxisItem(field, afterIndex = null) {
            const question = this.question(this.activeId);
            if (!question || !["rows", "columns"].includes(field)) return;
            if (this.editingLocale !== this.survey.languages.sourceLocale) return this.context.toast("행과 열의 구조는 원문 언어에서만 변경할 수 있습니다.", "error");
            this.syncQuestionCompatibility(question);
            const label = field === "rows" ? `항목 ${question.rows.length + 1}` : `열 ${question.columns.length + 1}`;
            this.canonicalizeAxisTranslations(question, field);
            const insertAt = afterIndex === null ? question[field].length : Math.max(0, Math.min(question[field].length, afterIndex + 1));
            const item = { id: uid(field === "rows" ? "row" : "col"), label };
            this.ensureResultCodes([...question.settings[field], item]);
            question[field].splice(insertAt, 0, label);
            question.settings[field].splice(insertAt, 0, item);
            this.renderQuestions();
            this.openProperties(question.id);
            this.markDirty();
        },
        deleteAxisItem(field, index) {
            const question = this.question(this.activeId);
            if (!question || !["rows", "columns"].includes(field) || !Number.isInteger(index)) return;
            if (this.editingLocale !== this.survey.languages.sourceLocale) return this.context.toast("행과 열의 구조는 원문 언어에서만 변경할 수 있습니다.", "error");
            this.syncQuestionCompatibility(question);
            if (question[field].length <= 1 || index < 0 || index >= question[field].length) return this.context.toast(`${field === "rows" ? "행" : "열"}은 한 개 이상 필요합니다.`, "error");
            this.canonicalizeAxisTranslations(question, field, index);
            question[field].splice(index, 1);
            question.settings[field].splice(index, 1);
            this.renderQuestions();
            this.openProperties(question.id);
            this.markDirty();
        },
        moveAxisItem(field, index, direction) {
            const question = this.question(this.activeId);
            if (!question || !["rows", "columns"].includes(field) || ![-1, 1].includes(direction)) return;
            if (this.editingLocale !== this.survey.languages.sourceLocale) return;
            this.syncQuestionCompatibility(question);
            const target = index + direction;
            if (index < 0 || target < 0 || target >= question[field].length) return;
            this.canonicalizeAxisTranslations(question, field);
            [question[field][index], question[field][target]] = [question[field][target], question[field][index]];
            [question.settings[field][index], question.settings[field][target]] = [question.settings[field][target], question.settings[field][index]];
            this.renderQuestions();
            this.openProperties(question.id);
            this.markDirty();
        },
        deleteQuestion(id) {
            const location = this.questionLocation(id);
            if (!location) return;
            const dependents = this.conditionSourceDependents(id);
            if (dependents.length) return this.context.toast(`이 문항을 조건으로 사용하는 후행 문항이 있습니다: ${dependents.slice(0, 3).map((item) => this.localizedQuestionField(item, "title")).join(", ")}. 먼저 해당 활성화 조건을 제거해 주세요.`, "error");
            location.section.questions.splice(location.questionIndex, 1);
            this.pruneQuestionTranslations(id);
            this.survey.logicRules = (this.survey.logicRules || []).filter((rule) => ![
                rule?.questionId,
                rule?.sourceQuestionId,
                rule?.targetQuestionId,
                rule?.destinationQuestionId
            ].some((reference) => String(reference ?? "") === String(id)));
            this.refreshQuestions();
            if (this.activeId === id) {
                this.activeId = null;
                this.activeSectionId = location.section.id;
                this.addedQuestionId = null;
                this.closeProperties();
                this.root.querySelector("[data-properties-empty]").hidden = false;
                this.root.querySelector("[data-properties-panel]").hidden = true;
            }
            this.renderQuestions();
            this.renderRules();
            this.markDirty();
        },
        addOption(questionId, afterId = null) {
            const question = this.question(questionId);
            if (!question) return;
            if (this.editingLocale !== this.survey.languages.sourceLocale) return this.context.toast("보기 구조와 코드는 원문 언어에서만 변경할 수 있습니다.", "error");
            question.options = question.options || [];
            const option = {id: uid("o"), label: "새 보기"};
            this.ensureResultCodes([...question.options, option]);
            const index = afterId === null ? question.options.length : question.options.findIndex(item => item.id === afterId) + 1;
            question.options.splice(index, 0, option);
            if (question.settings?.choiceInput === "codes") this.ensureOptionCodes(question);
            this.renderQuestions(); this.markDirty();
            requestAnimationFrame(() => this.root?.querySelector(`[data-option-id="${CSS.escape(option.id)}"]`)?.focus());
        },
        moveOption(questionId, optionId, direction) {
            const question = this.question(questionId);
            if (!question || this.editingLocale !== this.survey.languages.sourceLocale || ![-1, 1].includes(direction)) return;
            const index = question.options.findIndex(option => option.id === optionId);
            const target = index + direction;
            if (index < 0 || target < 0 || target >= question.options.length) return;
            [question.options[index], question.options[target]] = [question.options[target], question.options[index]];
            this.renderQuestions(); this.markDirty();
            requestAnimationFrame(() => this.root?.querySelector(`[data-option-move="${CSS.escape(optionId)}"][data-option-direction="${direction}"]`)?.focus());
        },
        deleteOption(questionId, optionId) {
            const question = this.question(questionId);
            if (!question || this.editingLocale !== this.survey.languages.sourceLocale) return;
            if (question.options.length <= 1) return this.context.toast("보기는 한 개 이상 필요합니다.", "error");
            const referenced = this.survey.questions.some(candidate => (String(candidate.settings?.excludeSelectedFrom || "") === String(questionId) && (candidate.options || []).some(option => option.id === optionId)) || (candidate.activationCondition?.conditions || []).some(condition => String(condition.sourceQuestionId || condition.source_question_id) === String(questionId) && (Array.isArray(condition.value) ? condition.value : [condition.value]).some(value => String(value) === String(optionId))));
            const ruleReference = (this.survey.logicRules || []).some(rule => String(rule.sourceQuestionId || rule.questionId || "") === String(questionId) && (Array.isArray(rule.value) ? rule.value : [rule.value || rule.optionId]).some(value => String(value) === String(optionId)));
            if (referenced || ruleReference) return this.context.toast("이 보기를 문항 조건·선행 보기 제외·이동 분기에서 사용 중입니다. 연결을 먼저 수정해 주세요.", "error");
            question.options = question.options.filter(item => item.id !== optionId);
            this.pruneOptionTranslations(questionId, optionId); this.renderQuestions(); this.markDirty();
        },
        conditionSourceDependents(sourceId) {
            return this.survey.questions.filter((question) => String(question.settings?.excludeSelectedFrom || "") === String(sourceId) || (question.activationCondition?.conditions || []).some((condition) => String(condition.sourceQuestionId || condition.source_question_id) === String(sourceId)));
        },
        activationOrderProblem() {
            const positions = new Map(this.survey.questions.map((question, index) => [String(question.id), index]));
            for (const [index, question] of this.survey.questions.entries()) {
                if (question.settings?.excludeSelectedFrom) {
                    const sourceIndex = positions.get(String(question.settings.excludeSelectedFrom));
                    if (sourceIndex === undefined || sourceIndex >= index) return `${this.localizedQuestionField(question, "title")}보다 보기 제외 기준 문항이 앞에 있어야 합니다.`;
                }
                for (const condition of question.activationCondition?.conditions || []) {
                    const sourceIndex = positions.get(String(condition.sourceQuestionId || condition.source_question_id));
                    if (sourceIndex === undefined) return `${this.localizedQuestionField(question, "title")}의 기준 문항을 찾을 수 없습니다.`;
                    if (sourceIndex >= index) return `${this.localizedQuestionField(question, "title")}보다 조건 기준 문항이 앞에 있어야 합니다.`;
                }
            }
            return "";
        },
        setMode(mode) {
            if (!["questions", "logic", "settings"].includes(mode)) return;
            const previous = this.mode || "questions";
            const scroller = this.root.querySelector("[data-builder-document-scroll]");
            this.canvasScrollPositions = this.canvasScrollPositions || {};
            if (previous !== mode) this.canvasScrollPositions[previous] = scroller.scrollTop;
            this.mode = mode;
            this.root.querySelector("[data-builder-shell]").dataset.editorMode = mode;
            const editingQuestions = mode === "questions";
            this.root.querySelector(".builder-toolbox").hidden = !editingQuestions;
            this.root.querySelector(".builder-properties").hidden = !editingQuestions;
            this.root.querySelectorAll("[data-question-navigation]").forEach(control => { control.hidden = !editingQuestions; });
            if (!editingQuestions) this.closeProperties();
            const copy = {
                questions: ["설문 구성", "문항을 선택해 내용과 속성을 편집하세요."],
                logic: ["분기 설계", "응답에 따른 섹션 이동과 URL 대상별 표시 범위를 설정하세요."],
                settings: ["설문 설정", "설문 전체의 응답 정책, 언어와 화면 스타일을 설정하세요."]
            }[mode];
            this.root.querySelector("[data-canvas-title]").textContent = copy[0];
            this.root.querySelector("[data-canvas-guide]").textContent = copy[1];
            if (mode === "logic") this.renderRules();
            this.root.querySelectorAll("[data-builder-mode]").forEach(button => {
                const selected = button.dataset.builderMode === mode;
                button.setAttribute("aria-selected", String(selected)); button.tabIndex = selected ? 0 : -1;
            });
            this.root.querySelectorAll("[data-mode-panel]").forEach(panel => { panel.hidden = panel.dataset.modePanel !== mode; });
            if (editingQuestions) this.resizeQuestionTitles();
            if (editingQuestions && previous !== mode && this.activeId && this.question(this.activeId)) {
                this.openProperties(this.activeId);
                if (window.matchMedia("(max-width: 78rem)").matches) this.closeProperties();
            }
            if (previous !== mode) scroller.scrollTop = this.canvasScrollPositions[mode] || 0;
        },
        addLogicRule() {
            const source = this.survey.questions.find((question) => optionTypes.has(question.type)) || this.survey.questions[0];
            if (!source) return this.context.toast("먼저 분기 기준 문항을 추가하세요.", "error");
            this.survey.logicRules.push({ id: uid("r"), questionId: source.id, sourceQuestionId: source.id, operator: "equals", value: "", destination: "complete", targetSectionId: null });
            this.renderRules();
            this.markDirty();
        },
        removeLogicRule(id) { this.survey.logicRules = this.survey.logicRules.filter((item) => item.id !== id); this.renderRules(); this.markDirty(); },
        renderRules() {
            const host = this.root.querySelector("[data-logic-rules]");
            if (!host || !this.survey) return;
            host.innerHTML = this.survey.logicRules.map((rule) => {
                const sourceId = String(rule.sourceQuestionId || rule.questionId || "");
                const destination = String(rule.targetSectionId || rule.destination || "complete");
                const questionOptions = this.survey.questions.map((question) => `<option value="${Common.escapeHtml(question.id)}" ${String(question.id) === sourceId ? "selected" : ""}>${Common.escapeHtml(this.localizedQuestionField(question, "title"))}</option>`).join("");
                const source = this.question(sourceId);
                const value = String(rule.value ?? rule.optionId ?? "");
                const options = source?.options || [];
                const valueControl = options.length
                    ? `<select data-rule-value><option value="">비교할 보기 선택</option>${options.map(option => `<option value="${Common.escapeHtml(option.id)}" ${value === option.id ? 'selected' : ''}>${Common.escapeHtml(this.localizedOptionLabel(source, option))} · 결과 코드 ${Common.escapeHtml(option.resultCode ?? option.id)}</option>`).join('')}${value && !options.some(option => option.id === value) ? `<option value="${Common.escapeHtml(value)}" selected>기존 값 · ${Common.escapeHtml(value)}</option>` : ''}</select>`
                    : `<input type="text" data-rule-value value="${Common.escapeHtml(value)}" placeholder="비교할 응답값">`;
                const sectionOptions = this.survey.sections.map((section) => `<option value="${Common.escapeHtml(section.id)}" ${String(section.id) === destination ? "selected" : ""}>${Common.escapeHtml(this.localizedSectionField(section, "title"))}</option>`).join("");
                return `<article class="logic-rule" data-rule-id="${Common.escapeHtml(rule.id)}"><label class="form-field">기준 문항<select data-rule-question>${questionOptions}</select></label><label class="form-field">조건<select data-rule-operator><option value="equals" ${rule.operator === "equals" ? "selected" : ""}>같음</option><option value="notEquals" ${rule.operator === "notEquals" ? "selected" : ""}>같지 않음</option><option value="contains" ${rule.operator === "contains" ? "selected" : ""}>포함</option></select></label><label class="form-field">비교 값${valueControl}</label><label class="form-field">이동 위치<select data-rule-destination><option value="complete" ${destination === "complete" ? "selected" : ""}>설문 완료</option><option value="next" ${destination === "next" ? "selected" : ""}>다음 섹션</option>${sectionOptions}</select></label><button class="button button-small button-delete" type="button" data-remove-rule>삭제</button></article>`;
            }).join("");
        },
        setSkin(code) { this.survey.skin = { ...(this.survey.skin || {}), preset: code }; this.applySkin(); this.markDirty(); },
        applySkin() { const skin = window.SURVEYONE_CONFIG.skinPresets.find((item) => item.code === this.survey.skin?.preset) || window.SURVEYONE_CONFIG.skinPresets[0]; this.root.querySelector("[data-builder-shell]").style.setProperty("--survey-primary", skin.primary); this.root.querySelectorAll("[data-skin-code]").forEach((button) => button.classList.toggle("is-active", button.dataset.skinCode === skin.code)); },
        applyExcludedSource(question, sourceId, copyOptions = false) {
            const source = sourceId ? this.question(sourceId) : null;
            if (sourceId && !source) return;
            if (copyOptions && source) {
                for (const option of question.options || []) this.pruneOptionTranslations(question.id, option.id);
                question.options = structuredClone(source.options || []);
                if (question.settings?.choiceInput === "codes") this.ensureOptionCodes(question);
            }
            question.settings = { ...(question.settings || {}), excludeSelectedFrom: sourceId || null };
            this.renderQuestions(); this.openProperties(question.id); this.markDirty();
        },
        chooseExcludedSource(question, sourceId, forceCopy = false) {
            const source = sourceId ? this.question(sourceId) : null;
            const sharedIds = source && (question.options || []).some((option) => (source.options || []).some((candidate) => candidate.id === option.id));
            if (!sourceId || (sharedIds && !forceCopy)) return this.applyExcludedSource(question, sourceId);
            if (!source) return;
            this.root.querySelector("[data-prop-exclude-source]").value = question.settings?.excludeSelectedFrom || "";
            const dialog = this.context.openModal(`<section class="draft-import-review"><h2>선행 문항 보기 연결</h2><p><strong>${Common.escapeHtml(source.title)}</strong>의 보기 ${source.options.length}개를 가져오고 현재 문항의 보기 목록을 교체합니다. 같은 보기 ID를 사용해 선행 응답에서 선택한 보기를 제외합니다.</p><p>현재 문항의 기존 보기 번역은 지워집니다.</p><button class="button button-save" type="button" data-confirm-choice-link>보기 가져오고 연결</button></section>`, { label: "선행 문항 보기 연결", initialFocus: "[data-confirm-choice-link]" });
            dialog.querySelector("[data-confirm-choice-link]").addEventListener("click", () => { this.applyExcludedSource(question, sourceId, true); dialog.close(); });
        },
        async editNoticeContent(preset = "") {
            const question = this.question(this.activeId);
            if (!question || question.type !== "notice") return;
            const existing = question.settings?.contentHtml || (question.description ? `<p>${Common.escapeHtml(question.description)}</p>` : "");
            const html = preset ? existing + "\n" + (window.SurveyContent.presets[preset] || "") : existing;
            const customCode = window.SurveyCodeEditor.normalize(this.survey.skin?.customCode);
            await window.SurveyCodeEditor.open({
                context: this.context, title: "안내문·표 서식 편집",
                description: "HTML은 선택한 안내문에 적용합니다. CSS·JavaScript는 설문 전체가 공유하는 기존 코드를 편집합니다. JavaScript는 설문 공통 HTML의 격리 영역에서 실행되며 안내문·응답 입력란을 직접 수정하지 않습니다.",
                richHtml: true, noticeId: question.id, sharedHtml: customCode.html,
                allowPlacement: false, sources: { ...customCode, html },
                onApply: (source) => {
                    const contentHtml = window.SurveyContent.validate(source.html);
                    const updatedCode = window.SurveyCodeEditor.validate({ ...customCode, css: source.css, javascript: source.javascript, enabled: source.enabled });
                    question.settings = { ...(question.settings || {}), contentHtml };
                    this.survey.skin = { ...(this.survey.skin || {}), customCode: updatedCode };
                    this.renderQuestions(); this.markDirty();
                }
            });
        },
        ensureOptionCodes(question) {
            const used = new Set((question.options || []).map(option => option.code).filter(Boolean));
            for (const option of question.options || []) {
                if (option.code) continue;
                let next = 1;
                while (used.has(String(next))) next += 1;
                option.code = String(next); used.add(option.code);
            }
        },
        renderAudienceSummary() {
            const summary = this.root.querySelector("[data-audience-summary]");
            if (!summary) return;
            const routes = this.survey.settings?.audienceRoutes || [];
            summary.textContent = routes.length ? routes.map(route => `${route.label}: ?audience=${route.code}${route.code === this.survey.settings.defaultAudience ? " (기본)" : ""}`).join(" · ") : "모든 대상에게 전체 섹션을 표시합니다.";
        },
        editAudiences() {
            const routes = structuredClone(this.survey.settings?.audienceRoutes || []);
            let defaultIndex = routes.findIndex(route => route.code === this.survey.settings.defaultAudience);
            const dialog = this.context.openModal(`<section class="audience-editor"><h2>URL별 대상·섹션 분기</h2><p>표시할 섹션을 선택하세요. 연결된 선행 문항도 같은 대상에 포함해야 합니다. 구분자 없는 URL은 기본 대상에 연결됩니다.</p><div data-audience-rows></div><button class="button button-function" type="button" data-audience-add>대상 추가</button><p data-audience-error role="alert"></p><button class="button button-save" type="button" data-audience-apply>편집기에 적용</button></section>`, {label:"URL별 대상 분기", wide:true, initialFocus:"[data-audience-add]"});
            const host = dialog.querySelector("[data-audience-rows]");
            const render = () => {
                host.innerHTML = routes.map((route, index) => `<fieldset data-audience-index="${index}"><legend>대상 ${index + 1}</legend><div class="audience-fields"><label>구분자<input data-audience-code maxlength="40" value="${Common.escapeHtml(route.code)}" pattern="[a-z0-9][a-z0-9_-]{0,39}"></label><label>대상 이름<input data-audience-label maxlength="100" value="${Common.escapeHtml(route.label)}"></label><label class="audience-check"><input type="radio" name="audience-default" data-audience-default ${defaultIndex === index ? "checked" : ""}>기본 대상</label><button class="button button-delete" type="button" data-audience-remove>대상 삭제</button></div><div class="audience-sections">${this.survey.sections.map(section => `<label><input type="checkbox" data-audience-section value="${Common.escapeHtml(section.id)}" ${route.sectionIds.includes(section.id) ? "checked" : ""}>${Common.escapeHtml(section.title)}</label>`).join("")}</div><small>?audience=${Common.escapeHtml(route.code)}</small></fieldset>`).join("");
            };
            host.addEventListener("input", event => {
                const row = event.target.closest("[data-audience-index]"); if (!row) return;
                const index = Number(row.dataset.audienceIndex), route = routes[index];
                if (event.target.matches("[data-audience-code]")) route.code = event.target.value.trim();
                if (event.target.matches("[data-audience-label]")) route.label = event.target.value.trim();
                if (event.target.matches("[data-audience-default]")) defaultIndex = index;
                if (event.target.matches("[data-audience-section]")) route.sectionIds = [...row.querySelectorAll("[data-audience-section]:checked")].map(input => input.value);
            });
            host.addEventListener("click", event => {
                if (!event.target.closest("[data-audience-remove]")) return;
                const index = Number(event.target.closest("[data-audience-index]").dataset.audienceIndex);
                routes.splice(index, 1);
                if (defaultIndex === index) defaultIndex = routes.length ? 0 : -1;
                else if (defaultIndex > index) defaultIndex -= 1;
                render();
            });
            dialog.querySelector("[data-audience-add]").addEventListener("click", () => {
                if (routes.length >= 20) return;
                let index = routes.length + 1; while (routes.some(route => route.code === `group-${index}`)) index += 1;
                routes.push({code:`group-${index}`,label:`대상 ${index}`,sectionIds:this.survey.sections.map(section => section.id)});
                if (defaultIndex < 0) defaultIndex = 0;
                render();
            });
            dialog.querySelector("[data-audience-apply]").addEventListener("click", async event => {
                const error = dialog.querySelector("[data-audience-error]");
                if (routes.some(route => !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(route.code) || !route.label || !route.sectionIds.length) || new Set(routes.map(route => route.code)).size !== routes.length) { error.textContent = "구분자는 중복 없이 영문 소문자·숫자·밑줄·하이픈으로 입력하고 이름과 섹션을 지정해 주세요."; return; }
                event.target.disabled = true;
                this.survey.settings.audienceRoutes = routes;
                this.survey.settings.defaultAudience = routes[defaultIndex]?.code || null;
                this.renderAudienceSummary();
                this.markDirty();
                dialog.close();
                this.context.toast("대상·섹션 분기를 적용했습니다. 상단 저장으로 보관하세요.", "success");
            });
            render();
        },
        exportDraftPackage() {
            let draft;
            try { draft = this.savePayload(); }
            catch (error) { return this.context.toast(error.message, "error"); }
            delete draft.expectedRevision;
            delete draft.sourceLocalePromotionFrom;
            const blob = new Blob([JSON.stringify({ format: "in-surveyone.draft", formatVersion: 1, draft }, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url; link.download = "surveyone-draft.json"; link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        },
        draftImportPayload(source) {
            const allowed = ["title", "description", "category", "sections", "theme", "skin", "logicRules", "languages", "translations"];
            const payload = Object.fromEntries(allowed.filter((key) => Object.hasOwn(source, key)).map((key) => [key, structuredClone(source[key])]));
            payload.settings = structuredClone(this.survey.settings || {});
            const presentation = ["presentationMode", "showProgressBar", "confirmationMessage", "showQuestionNumbers", "audienceRoutes", "defaultAudience"];
            for (const key of presentation) if (Object.hasOwn(source.settings || {}, key)) payload.settings[key] = source.settings[key];
            payload.settings.audienceRoutes = structuredClone(source.settings?.audienceRoutes || []);
            payload.settings.defaultAudience = source.settings?.defaultAudience || null;
            delete payload.settings.showProgress;
            if (this.survey.projectProfile) payload.projectProfile = structuredClone(this.survey.projectProfile);
            payload.expectedRevision = this.survey.revision;
            return payload;
        },
        async importDraftPackage(file) {
            if (!file) return;
            try {
                if (file.size > 2 * 1024 * 1024) throw new Error("설계 파일은 2MB 이하만 불러올 수 있습니다.");
                const packageData = JSON.parse(await file.text());
                if (packageData.format !== "in-surveyone.draft" || packageData.formatVersion !== 1 || !Array.isArray(packageData.draft?.sections)) throw new Error("IN-SURVEYONE 설계 파일 형식 또는 버전을 확인해 주세요.");
                const source = packageData.draft;
                const count = source.sections.reduce((sum, section) => sum + (Array.isArray(section.questions) ? section.questions.length : 0), 0);
                const dialog = this.context.openModal(`<section class="draft-import-review"><h2>설계 파일 불러오기</h2><p><strong>${Common.escapeHtml(source.title || "제목 없는 설문")}</strong> · ${source.sections.length}개 섹션 · ${count}개 문항</p><p>이 프로젝트의 편집 초안 내용을 파일의 설계로 교체합니다. 프로젝트 식별자·공개 주소·조사 기간·응답 운영 정책은 유지됩니다. 현재 초안이 필요하면 취소 후 설계 파일로 내보내세요.</p><button class="button button-save" type="button" data-import-confirm>불러오고 저장</button><output data-import-status role="status"></output></section>`, { label: "설계 파일 불러오기 확인", initialFocus: "[data-import-confirm]" });
                dialog.querySelector("[data-import-confirm]").addEventListener("click", async (event) => {
                    event.target.disabled = true;
                    const status = dialog.querySelector("[data-import-status]");
                    try {
                        await this.flushSave();
                        await this.context.api.put(`/api/surveys/${encodeURIComponent(this.survey.id)}`, this.draftImportPayload(source));
                        this.dirty = false;
                        await this.load();
                        dialog.close();
                        this.context.toast("설계 파일을 검증해 현재 프로젝트 초안에 저장했습니다.", "success");
                    } catch (error) { status.textContent = error.message; event.target.disabled = false; }
                });
            } catch (error) { this.context.toast(error.message, "error"); }
        },
        async openCustomCode() {
            if (!this.survey) return;
            await window.SurveyCodeEditor.open({
                context: this.context,
                title: "STEP 04 · 설문 HTML·CSS·JavaScript",
                description: "설문 구조는 그대로 유지하면서 공개 화면의 사용자 안내 영역과 스타일, 격리 스크립트를 추가합니다.",
                sources: this.survey.skin?.customCode,
                onApply: (source) => {
                    this.survey.skin = { ...(this.survey.skin || {}), customCode: source };
                    this.markDirty();
                    this.context.toast("사용자 코드를 편집 초안에 반영했습니다. 상단 저장을 누른 뒤 다시 확정하면 공개 설문에 적용됩니다.", "success");
                }
            });
        },
        draftSnapshot(source = this.survey) {
            return Object.fromEntries(draftFields.filter(key => Object.hasOwn(source || {}, key)).map(key => [key, structuredClone(source[key])]));
        },
        updateSaveControls() {
            if (!this.root || this.destroyed) return;
            const busy = Boolean(this.savePromise || this.savingExplicit || this.publishing);
            const save = this.root.querySelector("[data-builder-save]");
            const discard = this.root.querySelector("[data-builder-discard]");
            if (save) { save.disabled = !this.survey || busy; save.setAttribute("aria-busy", String(Boolean(this.savePromise || this.savingExplicit))); }
            if (discard) discard.disabled = !this.savedDraft || !this.dirty || busy;
        },
        setSaveLabel(message) {
            if (!this.destroyed && this.root?.isConnected) {
                const label = this.root.querySelector("[data-builder-save-label]");
                if (label) {
                    label.textContent = message;
                    label.dataset.saveState = message.includes("실패") ? "error" : message === "저장됨" ? "saved" : message === "저장 중…" ? "saving" : "pending";
                }
                this.updateSaveControls();
            }
        },
        markDirty() {
            this.dirty = true;
            this.setSaveLabel("저장 안 됨");
        },
        restoreSavedDraft() {
            if (!this.savedDraft || this.savePromise || this.savingExplicit) return false;
            const inspectorOpen = this.root.querySelector(".builder-properties")?.classList.contains("is-open");
            draftFields.forEach(key => { delete this.survey[key]; });
            Object.assign(this.survey, structuredClone(this.savedDraft));
            this.normalizeSurvey();
            this.dirty = false;
            this.addedQuestionId = null;
            this.renderSurvey();
            if (this.activeId && this.question(this.activeId)) {
                this.openProperties(this.activeId);
                if (!inspectorOpen) this.closeProperties();
            } else this.selectSection(this.activeSectionId);
            this.setSaveLabel("저장됨");
            return true;
        },
        async confirmDiscardChanges() {
            if (!this.dirty || !this.savedDraft || this.savePromise || this.savingExplicit) return;
            const confirmed = await this.context.confirmMessage("마지막 저장 후 수정한 제목·문항·보기·설정·코드를 모두 취소하고 마지막 저장 상태로 돌아갈까요?", { title: "변경 취소", confirmLabel: "변경 취소", cancelLabel: "계속 편집", destructive: true });
            if (confirmed && !this.destroyed && this.restoreSavedDraft()) this.context.toast("마지막 저장 상태로 되돌렸습니다.", "success");
        },
        savePayload() {
            const codeProblem = this.resultCodeProblem();
            if (codeProblem) throw new Error(codeProblem);
            this.survey.sections.forEach((section) => section.questions.forEach((question) => this.syncQuestionCompatibility(question)));
            const settings = structuredClone(this.survey.settings || {});
            settings.showProgressBar = Boolean(settings.showProgressBar ?? settings.showProgress);
            settings.oneResponsePerRespondent = Boolean(settings.oneResponsePerRespondent ?? settings.oneResponse);
            settings.allowResponseEdit = Boolean(settings.allowResponseEdit ?? settings.allowEdit);
            delete settings.showProgress;
            delete settings.oneResponse;
            delete settings.allowEdit;
            const languages = structuredClone(this.survey.languages);
            const translations = structuredClone(this.survey.translations || {});
            const skin = structuredClone(this.survey.skin || {});
            skin.i18n = { ...(skin.i18n || {}), languages, translations };
            this.survey.skin = skin;
            const payload = {
                title: this.survey.title,
                description: this.survey.description || "",
                category: this.survey.category || "일반",
                sections: structuredClone(this.survey.sections),
                settings,
                theme: structuredClone(this.survey.theme || {}),
                skin,
                logicRules: structuredClone(this.survey.logicRules || []),
                languages,
                translations,
                expectedRevision: this.survey.revision
            };
            if (this.persistedSourceLocale && languages.sourceLocale !== this.persistedSourceLocale) payload.sourceLocalePromotionFrom = this.persistedSourceLocale;
            return payload;
        },
        async save({ updateUi = true } = {}) {
            if (!this.survey || !this.dirty) return true;
            if (this.savePromise) await this.savePromise;
            if (!this.dirty) return true;
            const payload = this.savePayload();
            const savedDraft = this.draftSnapshot(payload);
            this.dirty = false;
            if (updateUi) this.setSaveLabel("저장 중…");
            const request = this.context.api.put(`/api/surveys/${encodeURIComponent(this.survey.id)}`, payload);
            this.savePromise = request;
            this.updateSaveControls();
            try {
                const response = await request;
                const saved = response.survey || response;
                this.survey.revision = saved.revision ?? this.survey.revision;
                this.survey.updatedAt = saved.updatedAt ?? this.survey.updatedAt;
                this.persistedSourceLocale = savedDraft.languages?.sourceLocale || this.survey.languages.sourceLocale;
                this.savedDraft = Array.isArray(saved.sections) ? this.draftSnapshot(saved) : savedDraft;
                if (updateUi) this.setSaveLabel(this.dirty ? "저장 안 됨" : "저장됨");
                return true;
            } catch (error) {
                this.dirty = true;
                if (updateUi) this.setSaveLabel("저장 실패");
                throw error;
            } finally {
                if (this.savePromise === request) this.savePromise = null;
                this.updateSaveControls();
            }
        },
        async flushSave(options = {}) {
            if (this.savePromise) await this.savePromise;
            if (this.dirty) await this.save(options);
            return true;
        },
        async saveExplicit({ notify = true } = {}) {
            if (!this.survey || this.savingExplicit) return false;
            this.savingExplicit = true;
            this.dirty = true;
            this.setSaveLabel("저장 중…");
            try {
                await this.flushSave();
                if (notify && !this.destroyed) this.context.toast(this.dirty ? "저장 시점의 초안을 보관했습니다. 저장 중 추가한 수정은 아직 저장되지 않았습니다." : "설문 초안을 저장했습니다.", "success");
                return !this.dirty;
            } catch (error) {
                this.setSaveLabel("저장 실패");
                if (!this.destroyed) this.context.toast(`설문 초안을 저장하지 못했습니다. ${error.message}`, "error");
                return false;
            } finally {
                this.savingExplicit = false;
                this.updateSaveControls();
            }
        },
        async openTemplateLibrary() {
            if (this.templateAdmin || !this.survey) return;
            this.context.openModal(`<div class="page-loading" role="status"><span class="spinner"></span><strong>템플릿을 불러오고 있습니다.</strong></div>`, { label: "템플릿 선택", wide: true, templateLibrary: true });
            try {
                const payload = await this.context.api.get("/api/templates");
                this.templateItems = payload?.items || payload?.templates || payload || [];
                const categories = ["전체", ...new Set(this.templateItems.map((item) => item.category || "일반"))];
            const dialog = this.context.openModal(`<section class="editor-template-layer"><header><div><span class="eyebrow">TEMPLATE LIBRARY</span><h2>설문 구조 템플릿 선택</h2><p>템플릿은 시작 구조입니다. 적용 후 STEP 04에서 자유롭게 수정할 수 있습니다.</p></div><button class="button button-function" type="button" data-editor-template-blank>빈 설문</button></header><div class="editor-template-toolbar"><div class="editor-template-categories" data-editor-template-categories>${categories.map((category, index) => `<button type="button" data-editor-template-category="${Common.escapeHtml(category)}" aria-pressed="${index === 0}">${Common.escapeHtml(category)}</button>`).join("")}</div><label class="search-field"><span class="sr-only">템플릿 검색</span><input type="search" data-editor-template-search placeholder="템플릿 이름 또는 설명 검색"></label></div><div class="editor-template-grid" data-editor-template-grid></div><aside class="editor-template-confirm" data-editor-template-confirm hidden><div><strong data-editor-template-confirm-title>템플릿 적용 확인</strong><p>현재 문항·동적 조건·섹션 분기·번역이 새 구조로 교체됩니다. 기본정보·스킨·응답 UI는 유지됩니다.</p></div><button class="button button-function" type="button" data-editor-template-confirm-cancel>취소</button><button class="button button-function button-important" type="button" data-editor-template-confirm-apply>저장하고 구조 교체</button></aside></section>`, { label: "설문 구조 템플릿 선택", wide: true, templateLibrary: true, initialFocus: "[data-editor-template-search]" });
                this.templateCategory = "전체";
                this.renderTemplateLibrary(dialog);
                dialog.querySelector("[data-editor-template-search]")?.addEventListener("input", () => this.renderTemplateLibrary(dialog));
                dialog.querySelector("[data-editor-template-categories]")?.addEventListener("click", (event) => {
                    const category = event.target.closest("[data-editor-template-category]");
                    if (!category) return;
                    this.templateCategory = category.dataset.editorTemplateCategory;
                    dialog.querySelectorAll("[data-editor-template-category]").forEach((button) => button.setAttribute("aria-pressed", String(button === category)));
                    this.renderTemplateLibrary(dialog);
                });
                dialog.querySelector("[data-editor-template-grid]")?.addEventListener("click", (event) => {
                    const use = event.target.closest("[data-editor-template-use]");
                    if (use) this.confirmTemplateChoice(dialog, use.dataset.editorTemplateUse);
                });
                dialog.querySelector("[data-editor-template-blank]")?.addEventListener("click", () => this.confirmTemplateChoice(dialog, ""));
                dialog.querySelector("[data-editor-template-confirm-cancel]")?.addEventListener("click", () => { dialog.querySelector("[data-editor-template-confirm]").hidden = true; });
                dialog.querySelector("[data-editor-template-confirm-apply]")?.addEventListener("click", () => void this.applyTemplateChoice(dialog));
            } catch (error) {
                this.context.openModal(`<p class="eyebrow">TEMPLATE LIBRARY</p><h2>템플릿을 불러오지 못했습니다</h2><p>${Common.escapeHtml(error.message)}</p>`, { label: "템플릿 불러오기 오류" });
            }
        },
        renderTemplateLibrary(dialog) {
            const query = dialog.querySelector("[data-editor-template-search]")?.value.trim().toLowerCase() || "";
            const items = this.templateItems.filter((item) => (this.templateCategory === "전체" || (item.category || "일반") === this.templateCategory) && (!query || `${item.name || item.title} ${item.description || ""}`.toLowerCase().includes(query)));
            dialog.querySelector("[data-editor-template-grid]").innerHTML = items.map((item, index) => `<article class="editor-template-card ${String(item.id || item.code) === String(this.recommendedTemplateId) ? "is-recommended" : ""}"><div class="editor-template-cover" style="--template-cover:${templateCovers[index % templateCovers.length]}"><span>${String(index + 1).padStart(2, "0")}</span><b>${Common.escapeHtml(item.category || "일반")}</b></div><div><h3>${Common.escapeHtml(item.name || item.title)}</h3><p>${Common.escapeHtml(item.description || "목적에 맞게 편집할 수 있는 설문 구조입니다.")}</p><small>${Common.formatNumber(item.questionCount || Common.questionsOf(item).length)}개 문항</small></div><button class="button button-function button-important" type="button" data-editor-template-use="${Common.escapeHtml(item.id || item.code)}">이 템플릿 선택</button></article>`).join("") || `<section class="empty-state"><span class="empty-icon">⌕</span><h3>검색 결과가 없습니다</h3><p>다른 검색어나 분야를 선택해 주세요.</p></section>`;
        },
        confirmTemplateChoice(dialog, code) {
            const template = this.templateItems.find((item) => String(item.id || item.code) === String(code));
            this.pendingTemplateCode = code;
            dialog.querySelector("[data-editor-template-confirm-title]").textContent = template ? `“${template.name || template.title}” 구조로 교체할까요?` : "빈 설문 구조로 교체할까요?";
            const confirmation = dialog.querySelector("[data-editor-template-confirm]");
            confirmation.hidden = false;
            confirmation.scrollIntoView({ block: "nearest" });
            confirmation.querySelector("[data-editor-template-confirm-apply]").focus({ preventScroll: true });
        },
        async applyTemplateChoice(dialog) {
            const apply = dialog.querySelector("[data-editor-template-confirm-apply]");
            apply.disabled = true;
            try {
                await this.flushSave();
                const endpoint = this.pendingTemplateCode ? "template" : "template/reset";
                const body = this.pendingTemplateCode ? { templateCode: this.pendingTemplateCode, expectedRevision: this.survey.revision } : { expectedRevision: this.survey.revision };
                const payload = await this.context.api.post(`/api/surveys/${encodeURIComponent(this.survey.id)}/${endpoint}`, body);
                this.survey = payload.survey || payload;
                this.normalizeSurvey();
                this.persistedSourceLocale = this.survey.languages.sourceLocale;
                this.dirty = false;
                this.renderSurvey();
                this.savedDraft = this.draftSnapshot();
                this.setSaveLabel("저장됨");
                this.recommendedTemplateId = null;
                dialog.close();
                this.context.toast(this.pendingTemplateCode ? "템플릿 구조를 적용했습니다." : "빈 설문 구조를 적용했습니다.", "success");
            } catch (error) {
                apply.disabled = false;
                this.context.toast(error.message, "error");
            }
        },
        preview() {
            let snapshot;
            try { snapshot = this.savePayload(); }
            catch (error) { return this.context.toast(error.message, "error"); }
            const token = globalThis.crypto.randomUUID();
            const deviceOptions = `${previewDevices.map((device) => `<option value="${device.code}" ${device.code === "mobile-390" ? "selected" : ""}>${device.label}</option>`).join("")}<option value="custom">직접 입력</option>`;
            const dialog = this.context.openModal(`<section class="builder-preview-simulator"><header class="builder-preview-toolbar"><div class="builder-preview-toolbar-copy"><span class="eyebrow">LIVE RESPONDENT RENDERER</span><h2>실제 응답 화면 미리보기</h2><p>100% 원본 크기로 표시합니다. 큰 화면은 안쪽 스크롤로 확인하세요. 미리보기 응답은 저장·제출되지 않습니다.</p></div><div class="builder-preview-size-controls"><label>보기 배율<select data-preview-scale><option value="actual" selected>100% · 원본 크기</option><option value="fit">화면 맞춤 · 전체 보기</option></select></label><label>화면 해상도<select data-preview-device-size>${deviceOptions}</select></label><div class="builder-preview-custom-size" data-preview-custom-size hidden><label>가로(px)<input type="number" min="240" max="5120" value="390" data-preview-custom-width></label><span>×</span><label>세로(px)<input type="number" min="320" max="2880" value="844" data-preview-custom-height></label></div></div><output data-preview-size-status></output></header><div class="builder-preview-stage" data-preview-stage tabindex="0" role="region" aria-label="설문 미리보기 · 가로 및 세로 스크롤 가능"><div class="builder-preview-device-holder" data-preview-device-holder><div class="builder-preview-viewport" data-preview-viewport><iframe class="builder-public-preview" data-interactive-preview title="실제 공개 설문 미리보기" sandbox="allow-scripts"></iframe></div></div></div></section>`, { label: "실제 공개 설문 미리보기", wide: true, previewSimulator: true, initialFocus: "[data-preview-device-size]" });
            const frame = dialog.querySelector("[data-interactive-preview]");
            const routes = snapshot.settings?.audienceRoutes || [];
            if (routes.length) dialog.querySelector(".builder-preview-size-controls").insertAdjacentHTML("afterbegin", `<label>설문 대상<select data-preview-audience>${routes.map(route => `<option value="${Common.escapeHtml(route.code)}" ${route.code === snapshot.settings.defaultAudience ? "selected" : ""}>${Common.escapeHtml(route.label)}</option>`).join("")}</select></label>`);
            delete snapshot.expectedRevision;
            const onMessage = (event) => {
                if (event.source !== frame.contentWindow || event.origin !== "null" || event.data?.token !== token) return;
                if (event.data.type === "surveyone-preview-ready") frame.contentWindow.postMessage({ type: "surveyone-preview-draft", token, draft: snapshot, locale: this.editingLocale }, "*");
            };
            window.addEventListener("message", onMessage);
            const audienceSelect = dialog.querySelector("[data-preview-audience]");
            const loadPreview = () => { frame.src = `/frontend/public.html?preview=1&previewToken=${encodeURIComponent(token)}${audienceSelect ? `&audience=${encodeURIComponent(audienceSelect.value)}` : ""}`; };
            audienceSelect?.addEventListener("change", loadPreview);
            loadPreview();
            const select = dialog.querySelector("[data-preview-device-size]");
            const customSize = dialog.querySelector("[data-preview-custom-size]");
            const scaleSelect = dialog.querySelector("[data-preview-scale]");
            const refresh = () => this.applyPreviewDevice(dialog, select.value);
            const stageScrollToStart = () => dialog.querySelector("[data-preview-stage]").scrollTo({ left: 0, top: 0, behavior: "instant" });
            select.addEventListener("change", () => { customSize.hidden = select.value !== "custom"; refresh(); stageScrollToStart(); });
            scaleSelect.addEventListener("change", () => { refresh(); stageScrollToStart(); });
            customSize.querySelectorAll("input").forEach((input) => input.addEventListener("input", refresh));
            const observer = new ResizeObserver(refresh);
            observer.observe(dialog.querySelector("[data-preview-stage]"));
            window.addEventListener("resize", refresh);
            dialog.addEventListener("close", () => { observer.disconnect(); window.removeEventListener("resize", refresh); window.removeEventListener("message", onMessage); frame.src = "about:blank"; }, { once: true });
            requestAnimationFrame(refresh);
        },
        applyPreviewDevice(dialog, code) {
            const preset = previewDevices.find((item) => item.code === code) || previewDevices[1];
            const customWidth = Number(dialog.querySelector("[data-preview-custom-width]")?.value);
            const customHeight = Number(dialog.querySelector("[data-preview-custom-height]")?.value);
            const device = code === "custom" ? {
                width: Math.round(Math.min(5120, Math.max(240, Number.isFinite(customWidth) ? customWidth : 390))),
                height: Math.round(Math.min(2880, Math.max(320, Number.isFinite(customHeight) ? customHeight : 844)))
            } : preset;
            const stage = dialog.querySelector("[data-preview-stage]");
            const holder = dialog.querySelector("[data-preview-device-holder]");
            const viewport = dialog.querySelector("[data-preview-viewport]");
            if (!stage.clientWidth || !stage.clientHeight) return;
            const fit = dialog.querySelector("[data-preview-scale]")?.value === "fit";
            const scale = fit ? Math.max(0.01, Math.min(1, (stage.clientWidth - 24) / device.width, (stage.clientHeight - 24) / device.height)) : 1;
            viewport.style.width = `${device.width}px`;
            viewport.style.height = `${device.height}px`;
            viewport.style.transform = scale === 1 ? "none" : `scale(${scale})`;
            holder.style.width = `${Math.round(device.width * scale)}px`;
            holder.style.height = `${Math.round(device.height * scale)}px`;
            dialog.querySelector("[data-preview-size-status]").textContent = `${device.width} × ${device.height} · ${Math.round(scale * 100)}%${fit ? " · 화면 맞춤" : " · 원본 크기"}`;
        },
        async prepareDistribution() {
            if (this.publishing) return;
            if (!this.hasPublishedUrl()) {
                this.context.toast("먼저 저장·확정 및 URL 발급을 완료하고 대상별 URL을 확인해 주세요.", "warning");
                this.root.querySelector("[data-builder-publish]")?.focus();
                return;
            }
            if (!this.survey.questions.some((question) => question.type !== "notice")) return this.context.toast("배포하려면 응답 가능한 문항을 한 개 이상 추가하세요.", "error");
            try {
                const payload = await this.context.api.get(`/api/surveys/${encodeURIComponent(this.survey.id)}/public-links`);
                const view = payload?.data || payload;
                if (!view?.links?.length) throw new Error("확정된 URL이 없습니다. 설문을 먼저 확정해 주세요.");
                if (this.destroyed) return;
                this.context.toast("확정된 버전과 URL로 발송을 준비합니다. 초안 변경은 재확정 후 공개됩니다.", "success");
                this.context.navigate("M03001", { surveyId: this.survey.id });
            } catch (error) {
                if (!this.destroyed) this.context.toast(`확정 URL을 확인하지 못해 이동을 중단했습니다. ${error.message}`, "error");
            }
        },
        openAdminTemplatePublish() {
            if (!this.templateAdmin || this.publishing) return;
            if (!this.survey.questions.some((question) => question.type !== "notice")) return this.context.toast("공용 템플릿에는 응답 가능한 문항이 한 개 이상 필요합니다.", "error");
            const proposedCode = this.templateCode || `template-${Date.now().toString(36)}`;
            const category = this.survey.category || this.survey.projectProfile?.category || adminTemplateCategories[0];
            const dialog = this.context.openModal(`<p class="eyebrow">PUBLISH SHARED TEMPLATE</p><h2>공용 템플릿으로 등록</h2><p class="muted">현재 관리자 초안을 새 템플릿 버전으로 고정합니다. 회원이 선택하면 이 버전이 독립 설문으로 복사됩니다.</p><form class="template-meta-form" data-admin-template-form>
                <label class="form-field">템플릿 코드<input type="text" maxlength="50" pattern="[a-z0-9][a-z0-9-]{2,49}" value="${Common.escapeHtml(proposedCode)}" data-admin-template-code ${this.templateCode ? "readonly" : ""} required><span class="field-help">영문 소문자·숫자·하이픈 3~50자, 등록 후 변경할 수 없습니다.</span></label>
                <label class="form-field">템플릿 제목<input type="text" maxlength="120" value="${Common.escapeHtml(this.survey.title || "")}" data-admin-template-title required></label>
                <label class="form-field">분야<select data-admin-template-category required>${adminTemplateCategories.map((item) => `<option value="${Common.escapeHtml(item)}" ${item === category ? "selected" : ""}>${Common.escapeHtml(item)}</option>`).join("")}</select></label>
                <label class="form-field">회원에게 보일 설명<textarea rows="4" maxlength="500" data-admin-template-description>${Common.escapeHtml(this.survey.description || "")}</textarea></label>
                <p class="form-error" data-admin-template-error role="alert" tabindex="-1" hidden></p>
                <div class="template-meta-actions"><button class="button button-function" type="button" data-admin-template-cancel>취소</button><button class="button button-save button-important" type="submit">저장 후 등록</button></div>
            </form>`, { label: "공용 템플릿 등록", initialFocus: "[data-admin-template-title]" });
            const form = dialog.querySelector("[data-admin-template-form]");
            dialog.querySelector("[data-admin-template-cancel]")?.addEventListener("click", () => dialog.close());
            form?.addEventListener("submit", (event) => this.publishAdminTemplate(event, dialog));
        },
        async publishAdminTemplate(event, dialog) {
            event.preventDefault();
            if (this.publishing) return;
            const form = event.currentTarget;
            const code = form.querySelector("[data-admin-template-code]").value.trim().toLowerCase();
            const errorHost = form.querySelector("[data-admin-template-error]");
            if (!/^[a-z0-9][a-z0-9-]{2,49}$/.test(code)) {
                errorHost.textContent = "템플릿 코드는 영문 소문자·숫자·하이픈으로 3~50자 입력하세요.";
                errorHost.hidden = false;
                errorHost.focus();
                return;
            }
            const submit = form.querySelector('[type="submit"]');
            this.publishing = true;
            submit.disabled = true;
            errorHost.hidden = true;
            const saved = await this.saveExplicit({ notify: false });
            if (!saved || this.destroyed) {
                this.publishing = false;
                if (!this.destroyed) submit.disabled = false;
                return;
            }
            try {
                await this.context.api.post(`/api/admin/templates/${encodeURIComponent(code)}/publish`, {
                    sourceSurveyId: this.survey.id,
                    title: form.querySelector("[data-admin-template-title]").value.trim(),
                    description: form.querySelector("[data-admin-template-description]").value.trim(),
                    category: form.querySelector("[data-admin-template-category]").value
                });
                dialog.close();
                this.context.toast("공용 템플릿 버전을 등록했습니다.", "success");
                this.context.navigate("M07001");
            } catch (error) {
                errorHost.textContent = error.message;
                errorHost.hidden = false;
                errorHost.focus();
                submit.disabled = false;
            } finally {
                this.publishing = false;
            }
        },
        hasPublishedUrl() {
            return !this.templateAdmin && ["published", "active"].includes(this.survey?.status) && Boolean(this.survey.slug || this.survey.publicUrl);
        },
        updatePublishActions() {
            this.updateSaveControls();
            const published = this.hasPublishedUrl();
            this.root.querySelectorAll("[data-builder-distribute]").forEach(button => {
                button.disabled = !published || this.publishing;
                button.title = published ? "현재 확정된 버전과 URL로 발송을 준비합니다." : "먼저 저장·확정 및 URL 발급을 완료하세요.";
                button.textContent = "발송 준비";
            });
            this.root.querySelectorAll("[data-builder-public-links]").forEach(button => { button.hidden = !published; });
            this.root.querySelectorAll("[data-builder-publish]").forEach(publish => {
                publish.hidden = this.templateAdmin;
                publish.disabled = this.publishing;
                publish.textContent = published ? "재확정 · 기존 URL 유지" : "저장·확정 및 URL 발급";
                publish.title = "저장만으로는 공개되지 않습니다. 확정 후 대상별 URL을 확인할 수 있습니다.";
            });
        },
        async openPublicLinks() {
            try {
                await window.SurveyPublicationLinks.open({
                    context: this.context, surveyId: this.survey.id,
                    onRegenerate: result => {
                        if (this.destroyed) return;
                        this.survey.slug = result.slug; this.survey.publicUrl = result.publicUrl;
                    }
                });
            } catch (error) { this.context.toast(error.message, "error"); }
        },
        async publishSurvey() {
            if (this.publishing) return;
            if (!this.survey.questions.some((question) => question.type !== "notice")) return this.context.toast("확정하려면 응답 가능한 문항을 한 개 이상 추가하세요.", "error");
            this.publishing = true;
            this.updatePublishActions();
            const saved = await this.saveExplicit({ notify: false });
            if (!saved || this.destroyed) {
                this.publishing = false;
                if (!this.destroyed) this.updatePublishActions();
                return;
            }
            try {
                const payload = await this.context.api.post(`/api/surveys/${encodeURIComponent(this.survey.id)}/publish`, {});
                const published = payload.survey || payload;
                this.survey.status = "published";
                this.survey.slug = published.slug;
                this.survey.publicUrl = published.publicUrl;
                this.survey.publishedVersion = published.version;
                this.updatePublishActions();
                this.root.querySelector("[data-builder-status]").textContent = "배포됨";
                this.context.toast(`설문 v${published.version}을 확정했습니다. 대상별 URL을 확인하세요.`, "success");
                await this.openPublicLinks();
            } catch (error) {
                this.context.toast(error.message, "error");
            } finally {
                this.publishing = false;
                if (!this.destroyed) this.updatePublishActions();
            }
        },
        hasUnsavedChanges() { return Boolean(this.dirty || this.savePromise); },
        beforeLeave() { return this.beforeRefresh(); },
        async beforeRefresh() {
            if (this.savePromise) {
                try { await this.savePromise; }
                catch { /* The edit remains available for save retry or explicit discard. */ }
            }
            if (!this.survey || !this.dirty) return true;
            if (this.leavePromise) return this.leavePromise;
            const dialog = this.context.openModal(`<section class="builder-unsaved-dialog"><h2>저장하지 않은 변경사항</h2><p>제목·문항·설정의 수정 내용이 아직 저장되지 않았습니다. 이동 또는 새로고침 전에 처리 방법을 선택하세요.</p><output data-builder-leave-error role="alert"></output><div class="builder-unsaved-actions"><button class="button button-function" type="button" data-builder-leave-stay>계속 편집</button><button class="button button-delete" type="button" data-builder-leave-discard>저장 안 하고 이동</button><button class="button button-save" type="button" data-builder-leave-save>저장 후 이동</button></div></section>`, { label: "미저장 변경사항", initialFocus: "[data-builder-leave-stay]" });
            this.leavePromise = new Promise(resolve => {
                let approved = false;
                dialog.addEventListener("close", () => { this.leavePromise = null; resolve(approved); }, { once: true });
                dialog.querySelector("[data-builder-leave-stay]").addEventListener("click", () => dialog.close());
                dialog.querySelector("[data-builder-leave-discard]").addEventListener("click", () => {
                    if (this.restoreSavedDraft()) { approved = true; dialog.close(); }
                });
                dialog.querySelector("[data-builder-leave-save]").addEventListener("click", async () => {
                    const buttons = [...dialog.querySelectorAll("button")];
                    buttons.forEach(button => { button.disabled = true; });
                    const saved = await this.saveExplicit({notify:false});
                    if (!dialog.open || this.destroyed) return;
                    if (saved) { approved = true; dialog.close(); }
                    else {
                        dialog.querySelector("[data-builder-leave-error]").textContent = "저장하지 못했습니다. 편집 내용은 유지됩니다. 다시 시도하거나 계속 편집을 선택하세요.";
                        buttons.forEach(button => { button.disabled = false; });
                    }
                });
            });
            return this.leavePromise;
        },
        async destroy() {
            this.choiceLayoutCleanup?.();
            this.choiceLayoutCleanup = null;
            this.toolbarResizeObserver?.disconnect();
            this.workspaceResizeObserver?.disconnect();
            this.fileMenu?.removeEventListener("toggle", this.onFileMenuToggle);
            document.removeEventListener("pointerdown", this.onToolbarPointerDown);
            document.removeEventListener("scroll", this.onToolbarScroll, true);
            window.removeEventListener("resize", this.onToolbarScroll);
            this.root?.removeEventListener("keydown", this.onToolbarKeyDown);
            // Teardown never persists edits; navigation/native unload guards own the decision.
            this.destroyed = true;
            this.root?.removeEventListener("pointerdown", this.onSelectionPointerDown);
            document.removeEventListener("pointerup", this.onSelectionPointerEnd);
            document.removeEventListener("pointercancel", this.onSelectionPointerEnd);
            this.root?.removeEventListener("focusin", this.onSelectionFocus);
            this.root?.removeEventListener("click", this.onClick);
            this.root?.removeEventListener("dblclick", this.onToolDoubleClick);
            this.root?.removeEventListener("input", this.onInput);
            this.root?.removeEventListener("change", this.onChange);
            this.root?.removeEventListener("dragstart", this.onDragStart);
            this.root?.removeEventListener("dragend", this.onDragEnd);
            this.root?.removeEventListener("dragover", this.onDragOver);
            this.root?.removeEventListener("drop", this.onDrop);
            this.root = null;
        }
    };
})();
