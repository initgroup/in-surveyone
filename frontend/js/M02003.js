(function () {
    "use strict";
    const PAGE_NAME = "M02003";
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
            this.saveTimer = null;
            this.savePromise = null;
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
            this.root.querySelector("[data-builder-publish]").hidden = this.templateAdmin;
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
                if (event.target.closest("[data-builder-basic]")) {
                    try {
                        await this.flushSave();
                        return this.context.navigate("M02001", { editId: this.surveyId, flow: "project", ...(this.recommendedTemplateId ? { templateId: this.recommendedTemplateId } : {}) });
                    } catch (error) {
                        return this.context.toast(`저장하지 못해 이동을 중단했습니다. ${error.message}`, "error");
                    }
                }
                if (event.target.closest("[data-builder-skin-step]")) {
                    try {
                        await this.flushSave();
                        return this.context.navigate("M02005", { surveyId: this.surveyId, flow: "project", ...(this.recommendedTemplateId ? { templateId: this.recommendedTemplateId } : {}) });
                    } catch (error) {
                        return this.context.toast(`저장하지 못해 이동을 중단했습니다. ${error.message}`, "error");
                    }
                }
                if (event.target.closest("[data-builder-experience]")) {
                    try {
                        await this.flushSave();
                        return this.context.navigate("M02004", { surveyId: this.surveyId, flow: "project", ...(this.recommendedTemplateId ? { templateId: this.recommendedTemplateId } : {}) });
                    } catch (error) {
                        return this.context.toast(`저장하지 못해 이동을 중단했습니다. ${error.message}`, "error");
                    }
                }
                if (event.target.closest("[data-builder-back]")) {
                    try {
                        await this.flushSave();
                        return this.context.navigate(this.templateAdmin ? "M07001" : "M02001");
                    } catch (error) {
                        return this.context.toast(`저장하지 못해 이동을 중단했습니다. ${error.message}`, "error");
                    }
                }
                const tool = event.target.closest("[data-question-type]");
                if (tool) return this.addQuestion(tool.dataset.questionType);
                if (event.target.closest("[data-canvas-add]")) return this.addQuestion("single");
                if (event.target.closest("[data-add-section]")) return this.addSection();
                const card = event.target.closest("[data-question-id]");
                if (card) this.selectQuestion(card.dataset.questionId);
                if (event.target.closest("[data-question-up]")) return this.moveQuestion(card.dataset.questionId, -1);
                if (event.target.closest("[data-question-down]")) return this.moveQuestion(card.dataset.questionId, 1);
                if (event.target.closest("[data-question-duplicate]")) return this.duplicateQuestion(card.dataset.questionId);
                if (event.target.closest("[data-question-delete]")) return this.deleteQuestion(card.dataset.questionId);
                if (event.target.closest("[data-question-settings]")) return this.openProperties(card.dataset.questionId);
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
                if (event.target.closest("[data-builder-publish]")) return this.publishSurvey();
                if (event.target.closest("[data-properties-close]")) return this.closeProperties();
                const skin = event.target.closest("[data-skin-code]");
                if (skin) return this.setSkin(skin.dataset.skinCode);
                if (event.target.closest("[data-open-skins]")) {
                    try {
                        await this.flushSave();
                        return this.context.navigate("M02005", { surveyId: this.survey.id, flow: "project", ...(this.recommendedTemplateId ? { templateId: this.recommendedTemplateId } : {}) });
                    } catch (error) {
                        return this.context.toast(`저장하지 못해 이동을 중단했습니다. ${error.message}`, "error");
                    }
                }
                if (event.target.closest("[data-add-rule]")) return this.addLogicRule();
                if (event.target.closest("[data-remove-rule]")) return this.removeLogicRule(event.target.closest("[data-rule-id]").dataset.ruleId);
                if (event.target.closest("[data-add-condition]")) return this.addActivationCondition();
                const removeCondition = event.target.closest("[data-remove-condition]");
                if (removeCondition) return this.removeActivationCondition(Number(removeCondition.dataset.removeCondition));
                if (event.target.closest("[data-mobile-tools]")) this.root.querySelector(".builder-toolbox")?.scrollIntoView({ behavior: "smooth" });
            };
            this.onInput = (event) => this.handleInput(event);
            this.onChange = (event) => {
                if (event.target.matches("[data-import-draft-file]")) { this.importDraftPackage(event.target.files[0]); event.target.value = ""; return; }
                this.handleChange(event);
            };
            this.onDragStart = (event) => { const card = event.target.closest("[data-question-id]"); if (card) { this.dragId = card.dataset.questionId; card.classList.add("is-dragging"); event.dataTransfer.effectAllowed = "move"; } };
            this.onDragEnd = (event) => { event.target.closest("[data-question-id]")?.classList.remove("is-dragging"); this.dragId = null; };
            this.onDragOver = (event) => event.preventDefault();
            this.onDrop = (event) => { event.preventDefault(); const target = event.target.closest("[data-question-id]"); if (target && this.dragId && target.dataset.questionId !== this.dragId) this.reorderTo(this.dragId, target.dataset.questionId); };
            this.root.addEventListener("click", this.onClick);
            this.root.addEventListener("input", this.onInput);
            this.root.addEventListener("change", this.onChange);
            this.root.addEventListener("dragstart", this.onDragStart);
            this.root.addEventListener("dragend", this.onDragEnd);
            this.root.addEventListener("dragover", this.onDragOver);
            this.root.addEventListener("drop", this.onDrop);
        },
        async load() {
            try {
                const payload = await this.context.api.get(`/api/surveys/${encodeURIComponent(this.surveyId)}`);
                this.survey = payload.survey || payload;
                this.normalizeSurvey();
                this.persistedSourceLocale = this.survey.languages.sourceLocale;
                this.renderSurvey();
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
        syncQuestionCompatibility(question) {
            const behaviors = new Set(["fixed_required", "fixed_optional", "dynamic_required", "dynamic_optional"]);
            question.behavior = behaviors.has(question.behavior) ? question.behavior : (question.required ? "fixed_required" : "fixed_optional");
            question.required = ["fixed_required", "dynamic_required"].includes(question.behavior);
            question.settings = question.settings && typeof question.settings === "object" ? question.settings : {};
            [["min", "minValue"], ["max", "maxValue"], ["minLabel", "minLabel"], ["maxLabel", "maxLabel"], ["unit", "unit"]].forEach(([topLevel, setting]) => {
                if (question[topLevel] === undefined || question[topLevel] === null) question[topLevel] = question.settings[setting] ?? question[topLevel];
                if (question[topLevel] !== undefined) question.settings[setting] = question[topLevel];
            });
            ["rows", "columns"].forEach((field) => {
                const existing = Array.isArray(question.settings[field]) ? question.settings[field] : [];
                if ((!Array.isArray(question[field]) || !question[field].length) && existing.length) question[field] = existing.map((item) => String(item?.label ?? item ?? ""));
                const labels = Array.isArray(question[field]) ? question[field] : [];
                question.settings[field] = labels.map((label, index) => ({
                    ...(existing[index] && typeof existing[index] === "object" ? existing[index] : {}),
                    id: String(existing[index]?.id || uid(field === "rows" ? "row" : "col")),
                    label: String(label ?? "")
                }));
            });
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
            this.root.querySelector("[data-question-tools]").innerHTML = window.SURVEYONE_CONFIG.questionTypes.map((item) => `<button class="question-tool" type="button" data-question-type="${item.code}"><span>＋ ${item.label}</span><small>${item.description}</small></button>`).join("");
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
            let questionIndex = 0;
            this.survey.sections.forEach((section, sectionIndex) => {
                const heading = document.createElement("section");
                heading.className = "builder-section-heading";
                heading.dataset.sectionId = section.id;
                heading.innerHTML = `<span>SECTION ${String(sectionIndex + 1).padStart(2, "0")}</span><div class="builder-section-copy"><input type="text" data-section-title value="${Common.escapeHtml(this.localizedSectionField(section, "title"))}" aria-label="${sectionIndex + 1}번 섹션 제목"><input type="text" data-section-description value="${Common.escapeHtml(this.localizedSectionField(section, "description"))}" placeholder="섹션 설명(선택)" aria-label="${sectionIndex + 1}번 섹션 설명"></div><small>${section.questions.length}개 문항</small>`;
                host.appendChild(heading);
                section.questions.forEach((question) => {
                    const node = template.content.firstElementChild.cloneNode(true);
                    node.dataset.questionId = question.id;
                    node.dataset.sectionId = section.id;
                    node.classList.toggle("is-active", question.id === this.activeId);
                    node.querySelector(".question-index").textContent = String(++questionIndex).padStart(2, "0");
                    node.querySelector(".question-type-badge").textContent = this.typeLabel(question.type);
                    node.querySelector("[data-question-title]").value = this.localizedQuestionField(question, "title");
                    const description = node.querySelector("[data-question-description-preview]");
                    description.textContent = this.localizedQuestionField(question, "description");
                    description.hidden = !description.textContent;
                    node.querySelector("[data-required-label]").textContent = ({ fixed_required: "고정 · 필수", fixed_optional: "고정 · 선택", dynamic_required: "동적 · 필수", dynamic_optional: "동적 · 선택" })[question.behavior] || (question.required ? "필수 응답" : "선택 응답");
                    node.querySelector("[data-answer-editor]").innerHTML = this.answerMarkup(question);
                    host.appendChild(node);
                });
            });
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
        answerMarkup(question) {
            if (optionTypes.has(question.type)) {
                const grid = ["single", "multiple"].includes(question.type) && question.settings?.choiceInput !== "codes";
                const layout = window.SurveyChoiceLayout?.normalize(question.settings?.choiceLayout) || "vertical";
                const options = (question.options || []).map((option) => `<div class="option-row" data-choice-item>${question.settings?.choiceInput === "codes" ? `<input class="option-code" type="text" inputmode="numeric" maxlength="6" value="${Common.escapeHtml(option.code || "")}" data-option-code="${Common.escapeHtml(option.id)}" aria-label="보기 번호">` : `<span class="option-marker ${question.type === "multiple" ? "multiple" : ""}"></span>`}<input type="text" value="${Common.escapeHtml(this.localizedOptionLabel(question, option))}" data-option-id="${Common.escapeHtml(option.id)}" data-choice-label aria-label="보기 내용"><button type="button" data-delete-option="${Common.escapeHtml(option.id)}" aria-label="보기 삭제">×</button></div>`).join("");
                return `${grid ? `<div class="choice-options-editor" data-choice-layout="${layout}">${options}</div>` : options}<button class="add-option" type="button" data-add-option="${question.id}">＋ 보기 추가</button>`;
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
                if (question.settings?.scaleDisplay === "slider") return `${labels}<div class="rating-editor-preview"><div class="rating-editor-track" aria-hidden="true"></div><div class="rating-editor-ticks">${values.map(value => `<span>${value}</span>`).join("")}</div><small>슬라이더 + 점수 직접 선택 · 응답 전에는 미선택</small></div>`;
                return `<div class="scale-preview" style="--count:${count}">${values.map(value => `<span>${value}</span>`).join("")}</div>${labels}`;
            }
            if (choiceMatrixTypes.has(question.type)) return this.axisTableMarkup(question, question.type === "matrix_multiple" ? "checkbox" : "radio");
            if (question.type === "table") return this.axisTableMarkup(question, "text");
            if (question.type === "repeat_table") return this.repeatTableEditorMarkup(question);
            if (question.type === "date") return `<div class="answer-placeholder">연도-월-일</div>`;
            if (question.type === "notice") return `<div class="survey-document">${question.settings?.contentHtml ? window.SurveyContent.render(question.settings.contentHtml) : Common.escapeHtml(this.localizedQuestionField(question, "description") || "안내 내용을 입력하세요.")}</div>`;
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
        addQuestion(type) {
            const question = defaultQuestion(type);
            const activeLocation = this.questionLocation(this.activeId);
            const section = activeLocation?.section || this.survey.sections.at(-1) || this.addSection(false);
            section.questions.push(question);
            this.refreshQuestions();
            this.activeId = question.id;
            this.renderQuestions();
            this.openProperties(question.id);
            this.scheduleSave();
            requestAnimationFrame(() => {
                if (!this.destroyed) this.root?.querySelector(`[data-question-id="${CSS.escape(question.id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
            });
        },
        addSection(render = true) {
            const section = { id: uid("section"), title: `섹션 ${this.survey.sections.length + 1}`, description: "", questions: [] };
            this.survey.sections.push(section);
            this.refreshQuestions();
            if (render) {
                this.renderQuestions();
                this.scheduleSave();
                requestAnimationFrame(() => {
                    if (!this.destroyed) this.root?.querySelector(`[data-section-id="${CSS.escape(section.id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                });
            }
            return section;
        },
        selectQuestion(id) {
            this.activeId = id;
            this.root.querySelectorAll("[data-question-id]").forEach((card) => card.classList.toggle("is-active", card.dataset.questionId === id));
        },
        openProperties(id) {
            this.selectQuestion(id);
            const question = this.question(id);
            if (!question) return;
            this.root.querySelector("[data-properties-empty]").hidden = true;
            this.root.querySelector("[data-properties-panel]").hidden = false;
            this.root.querySelector(".builder-properties").classList.add("is-open");
            this.root.querySelector("[data-properties-type]").textContent = this.typeLabel(question.type);
            const behaviorSelect = this.root.querySelector("[data-prop-behavior]");
            behaviorSelect.value = question.behavior || (question.required ? "fixed_required" : "fixed_optional");
            behaviorSelect.disabled = question.type === "notice";
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
                host.innerHTML = (question[field] || []).map((value, index) => `<div class="axis-item"><span>${index + 1}</span><input type="text" data-matrix-${field === "rows" ? "row" : "column"}-index="${index}" value="${Common.escapeHtml(this.localizedIndexedLabel(question, field, index))}" aria-label="${index + 1}번 ${label} 제목"><div class="axis-item-actions"><button type="button" data-axis-move="${field}" data-axis-index="${index}" data-axis-direction="-1" aria-label="${index + 1}번 ${label} 위로 이동" ${!sourceEditing || index === 0 ? "disabled" : ""}>↑</button><button type="button" data-axis-move="${field}" data-axis-index="${index}" data-axis-direction="1" aria-label="${index + 1}번 ${label} 아래로 이동" ${!sourceEditing || index === question[field].length - 1 ? "disabled" : ""}>↓</button><button type="button" class="is-delete" data-axis-delete="${field}" data-axis-index="${index}" aria-label="${index + 1}번 ${label} 삭제" ${!sourceEditing || question[field].length <= 1 ? "disabled" : ""}>×</button></div></div>`).join("");
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
                return `<select data-condition-value ${multiple ? 'multiple size="4" aria-label="비교할 보기 복수 선택"' : ""}>${multiple ? "" : '<option value="">비교할 보기 선택</option>'}${options.map((option) => `<option value="${Common.escapeHtml(option.id)}" ${values.includes(String(option.id)) ? "selected" : ""}>${Common.escapeHtml(this.localizedOptionLabel(source, option))} · ${Common.escapeHtml(option.id)}</option>`).join("")}${legacy.map((value) => `<option value="${Common.escapeHtml(value)}" selected>기존 값 · ${Common.escapeHtml(value)}</option>`).join("")}</select>${multiple ? "<small>PC에서는 Ctrl/Command 키로, 모바일에서는 목록에서 여러 보기를 선택합니다.</small>" : ""}`;
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
            this.scheduleSave();
        },
        removeActivationCondition(index) {
            const question = this.question(this.activeId);
            if (!question?.activationCondition) return;
            if (question.activationCondition.conditions.length <= 1) return this.context.toast("동적 문항에는 활성화 조건이 한 개 이상 필요합니다.", "error");
            question.activationCondition.conditions.splice(index, 1);
            this.openProperties(question.id);
            this.scheduleSave();
        },
        closeProperties() { this.root.querySelector(".builder-properties").classList.remove("is-open"); },
        handleInput(event) {
            if (!this.survey) return;
            if (event.target.matches("[data-section-title]")) {
                const section = this.section(event.target.closest("[data-section-id]")?.dataset.sectionId);
                if (section) this.setLocalizedSectionField(section, "title", this.editingLocale === this.survey.languages.sourceLocale ? (event.target.value || "새 섹션") : event.target.value);
                this.scheduleSave();
                return;
            }
            if (event.target.matches("[data-section-description]")) {
                const section = this.section(event.target.closest("[data-section-id]")?.dataset.sectionId);
                if (section) this.setLocalizedSectionField(section, "description", event.target.value);
                this.scheduleSave();
                return;
            }
            if (event.target.matches("[data-builder-title], [data-survey-heading]")) {
                this.setLocalizedSurveyField("title", event.target.value);
                const other = event.target.matches("[data-builder-title]") ? this.root.querySelector("[data-survey-heading]") : this.root.querySelector("[data-builder-title]");
                if (document.activeElement !== other) other.value = event.target.value;
                this.scheduleSave(); return;
            }
            if (event.target.matches("[data-survey-description]")) { this.setLocalizedSurveyField("description", event.target.value); this.scheduleSave(); return; }
            if (event.target.matches('[data-setting="confirmationMessage"]')) { this.setLocalizedSurveyField("confirmationMessage", event.target.value); this.scheduleSave(); return; }
            const card = event.target.closest("[data-question-id]");
            const question = card ? this.question(card.dataset.questionId) : this.question(this.activeId);
            if (!question) return;
            if (event.target.matches("[data-question-title]")) this.setLocalizedQuestionField(question, "title", event.target.value);
            if (event.target.matches("[data-option-id]")) { const option = question.options?.find((item) => item.id === event.target.dataset.optionId); if (option) this.setLocalizedOptionLabel(question, option, event.target.value); }
            if (event.target.matches("[data-option-code]")) {
                const option = question.options.find(item => item.id === event.target.dataset.optionCode);
                const code = event.target.value.trim();
                const valid = /^[1-9][0-9]{0,5}$/.test(code) && !question.options.some(item => item !== option && item.code === code);
                event.target.setCustomValidity(valid ? "" : "다른 보기와 겹치지 않는 1~999999 번호를 입력하세요.");
                if (!valid) { event.target.reportValidity(); return; }
                option.code = code;
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
            this.scheduleSave();
        },
        handleChange(event) {
            if (!this.survey) return;
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
                this.scheduleSave();
                return;
            }
            if (event.target.matches("[data-default-locale]")) {
                if (this.survey.languages.enabled.includes(event.target.value)) this.survey.languages.defaultLocale = event.target.value;
                this.renderLanguageControls();
                this.scheduleSave();
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
                this.scheduleSave();
                return;
            }
            const setting = event.target.dataset.setting;
            if (setting) {
                const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
                if (setting === "confirmationMessage") {
                    this.setLocalizedSurveyField("confirmationMessage", value);
                    this.scheduleSave();
                    return;
                }
                const canonicalName = { showProgress: "showProgressBar", oneResponse: "oneResponsePerRespondent", allowEdit: "allowResponseEdit" }[setting];
                this.survey.settings[setting] = value;
                if (canonicalName) this.survey.settings[canonicalName] = value;
                this.scheduleSave();
                return;
            }
            const ruleElement = event.target.closest("[data-rule-id]");
            if (ruleElement) {
                const rule = this.survey.logicRules.find((item) => String(item.id) === ruleElement.dataset.ruleId);
                if (rule) {
                    if (event.target.matches("[data-rule-question]")) {
                        rule.questionId = event.target.value;
                        rule.sourceQuestionId = event.target.value;
                    }
                    if (event.target.matches("[data-rule-operator]")) rule.operator = event.target.value;
                    if (event.target.matches("[data-rule-value]")) rule.value = event.target.value;
                    if (event.target.matches("[data-rule-destination]")) {
                        rule.destination = event.target.value;
                        rule.targetSectionId = event.target.value === "complete" || event.target.value === "next" ? null : event.target.value;
                    }
                    this.scheduleSave();
                }
                return;
            }
            const question = this.question(this.activeId);
            if (!question) return;
            for (const [selector, key] of [["[data-prop-min-selections]", "minSelections"], ["[data-prop-max-selections]", "maxSelections"]]) {
                if (event.target.matches(selector)) question.settings = { ...(question.settings || {}), [key]: event.target.value === "" ? null : Number(event.target.value) };
            }
            if (event.target.matches("[data-prop-scale-order]")) question.settings = { ...(question.settings || {}), scaleOrder: event.target.value };
            if (event.target.matches("[data-prop-scale-display]")) question.settings = { ...(question.settings || {}), scaleDisplay: event.target.value };
            if (event.target.matches("[data-prop-scale-order], [data-prop-scale-display]")) this.renderQuestions();
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
            this.scheduleSave();
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
            this.scheduleSave();
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
            this.renderQuestions();
            this.scheduleSave();
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
        addAxisItem(field) {
            const question = this.question(this.activeId);
            if (!question || !["rows", "columns"].includes(field)) return;
            if (this.editingLocale !== this.survey.languages.sourceLocale) return this.context.toast("행과 열의 구조는 원문 언어에서만 변경할 수 있습니다.", "error");
            this.syncQuestionCompatibility(question);
            const label = field === "rows" ? `항목 ${question.rows.length + 1}` : `열 ${question.columns.length + 1}`;
            question[field].push(label);
            question.settings[field].push({ id: uid(field === "rows" ? "row" : "col"), label });
            this.renderQuestions();
            this.openProperties(question.id);
            this.scheduleSave();
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
            this.scheduleSave();
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
            this.scheduleSave();
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
                this.root.querySelector("[data-properties-empty]").hidden = false;
                this.root.querySelector("[data-properties-panel]").hidden = true;
            }
            this.renderQuestions();
            this.renderRules();
            this.scheduleSave();
        },
        addOption(questionId) { const question = this.question(questionId); if (!question) return; question.options = question.options || []; question.options.push({ id: uid("o"), label: `보기 ${question.options.length + 1}` }); if (question.settings?.choiceInput === "codes") this.ensureOptionCodes(question); this.renderQuestions(); this.scheduleSave(); },
        deleteOption(questionId, optionId) { const question = this.question(questionId); if (!question || question.options.length <= 1) return this.context.toast("보기는 한 개 이상 필요합니다.", "error"); const referenced = this.survey.questions.some((candidate) => (candidate.activationCondition?.conditions || []).some((condition) => String(condition.sourceQuestionId || condition.source_question_id) === String(questionId) && (Array.isArray(condition.value) ? condition.value : [condition.value]).some((value) => String(value) === String(optionId)))); if (referenced) return this.context.toast("이 보기를 동적 문항 조건에서 사용 중입니다. 조건을 먼저 수정해 주세요.", "error"); question.options = question.options.filter((item) => item.id !== optionId); this.pruneOptionTranslations(questionId, optionId); this.renderQuestions(); this.scheduleSave(); },
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
        setMode(mode) { this.root.querySelectorAll("[data-builder-mode]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.builderMode === mode))); this.root.querySelectorAll("[data-mode-panel]").forEach((panel) => { panel.hidden = panel.dataset.modePanel !== mode; }); },
        addLogicRule() {
            const source = this.survey.questions.find((question) => optionTypes.has(question.type)) || this.survey.questions[0];
            if (!source) return this.context.toast("먼저 분기 기준 문항을 추가하세요.", "error");
            this.survey.logicRules.push({ id: uid("r"), questionId: source.id, sourceQuestionId: source.id, operator: "equals", value: "", destination: "complete", targetSectionId: null });
            this.renderRules();
            this.scheduleSave();
        },
        removeLogicRule(id) { this.survey.logicRules = this.survey.logicRules.filter((item) => item.id !== id); this.renderRules(); this.scheduleSave(); },
        renderRules() {
            const host = this.root.querySelector("[data-logic-rules]");
            if (!host || !this.survey) return;
            host.innerHTML = this.survey.logicRules.map((rule) => {
                const sourceId = String(rule.sourceQuestionId || rule.questionId || "");
                const destination = String(rule.targetSectionId || rule.destination || "complete");
                const questionOptions = this.survey.questions.map((question) => `<option value="${Common.escapeHtml(question.id)}" ${String(question.id) === sourceId ? "selected" : ""}>${Common.escapeHtml(this.localizedQuestionField(question, "title"))}</option>`).join("");
                const sectionOptions = this.survey.sections.map((section) => `<option value="${Common.escapeHtml(section.id)}" ${String(section.id) === destination ? "selected" : ""}>${Common.escapeHtml(this.localizedSectionField(section, "title"))}</option>`).join("");
                return `<article class="logic-rule" data-rule-id="${Common.escapeHtml(rule.id)}"><label class="form-field">기준 문항<select data-rule-question>${questionOptions}</select></label><label class="form-field">조건<select data-rule-operator><option value="equals" ${rule.operator === "equals" ? "selected" : ""}>같음</option><option value="notEquals" ${rule.operator === "notEquals" ? "selected" : ""}>같지 않음</option><option value="contains" ${rule.operator === "contains" ? "selected" : ""}>포함</option></select></label><label class="form-field">비교 값<input type="text" data-rule-value value="${Common.escapeHtml(rule.value || rule.optionId || "")}" placeholder="보기 ID 또는 값"></label><label class="form-field">이동 위치<select data-rule-destination><option value="complete" ${destination === "complete" ? "selected" : ""}>설문 완료</option><option value="next" ${destination === "next" ? "selected" : ""}>다음 섹션</option>${sectionOptions}</select></label><button class="button button-small button-delete" type="button" data-remove-rule>삭제</button></article>`;
            }).join("");
        },
        setSkin(code) { this.survey.skin = { ...(this.survey.skin || {}), preset: code }; this.applySkin(); this.scheduleSave(); },
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
            this.renderQuestions(); this.openProperties(question.id); this.scheduleSave();
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
            const existing = question.settings?.contentHtml || "";
            const html = preset ? existing + "\n" + (window.SurveyContent.presets[preset] || "") : existing;
            await window.SurveyCodeEditor.open({
                context: this.context, title: "안내문·표 서식 편집",
                description: "문단·강조·목록·표를 편집합니다. 표지 예제와 안내 표를 넣은 뒤 내용을 바꿔 주세요. 안내 서식은 원문 공통으로 표시됩니다.",
                tabs: ["html"], allowEnable: false, allowPlacement: false, email: true,
                sources: { html, enabled: true },
                onApply: (source) => {
                    question.settings = { ...(question.settings || {}), contentHtml: window.SurveyContent.validate(source.html) };
                    this.renderQuestions(); this.scheduleSave();
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
            const dialog = this.context.openModal(`<section class="audience-editor"><h2>URL별 대상·섹션 분기</h2><p>표시할 섹션을 선택하세요. 연결된 선행 문항도 같은 대상에 포함해야 합니다. 구분자 없는 URL은 기본 대상에 연결됩니다.</p><div data-audience-rows></div><button class="button button-function" type="button" data-audience-add>대상 추가</button><p data-audience-error role="alert"></p><button class="button button-save" type="button" data-audience-apply>분기 설정 저장</button></section>`, {label:"URL별 대상 분기", wide:true, initialFocus:"[data-audience-add]"});
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
                const previous = structuredClone(this.survey.settings);
                try {
                    await this.flushSave();
                    this.survey.settings.audienceRoutes = routes;
                    this.survey.settings.defaultAudience = routes[defaultIndex]?.code || null;
                    this.dirty = true;
                    if (!await this.saveExplicit({notify:false})) throw new Error("설정을 저장하지 못했습니다. 선행 문항이 같은 대상에 포함되는지 확인하세요.");
                    this.renderAudienceSummary(); dialog.close();
                } catch (failure) { this.survey.settings = previous; this.dirty = false; error.textContent = failure.message; event.target.disabled = false; }
            });
            render();
        },
        exportDraftPackage() {
            const draft = this.savePayload();
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
                const dialog = this.context.openModal(`<section class="draft-import-review"><h2>설계 파일 불러오기</h2><p><strong>${Common.escapeHtml(source.title || "제목 없는 설문")}</strong> · ${source.sections.length}개 섹션 · ${count}개 문항</p><p>이 프로젝트의 편집 초안 내용을 파일의 설계로 교체합니다. 프로젝트 식별자·공개 주소·조사 기간·응답 운영 정책은 유지됩니다. 현재 초안이 필요하면 취소 후 설계 파일로 내보내세요.</p><button class="button button-save" type="button" data-import-confirm>초안에 불러오기</button><output data-import-status role="status"></output></section>`, { label: "설계 파일 불러오기 확인", initialFocus: "[data-import-confirm]" });
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
                    this.scheduleSave();
                    this.context.toast("사용자 코드를 편집 초안에 반영했습니다. 자동 저장 후 다음 확정 버전부터 적용됩니다.", "success");
                }
            });
        },
        setSaveLabel(message) {
            if (!this.destroyed && this.root?.isConnected) {
                const label = this.root.querySelector("[data-builder-save-label]");
                if (label) label.textContent = message;
            }
        },
        scheduleSave() {
            this.dirty = true;
            clearTimeout(this.saveTimer);
            this.setSaveLabel("저장 대기");
            this.saveTimer = setTimeout(() => {
                this.saveTimer = null;
                this.flushSave().catch((error) => {
                    this.setSaveLabel("저장 실패");
                    if (!this.destroyed) this.context.toast(error.message, "error");
                });
            }, 700);
        },
        savePayload() {
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
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
            const payload = this.savePayload();
            this.dirty = false;
            if (updateUi) this.setSaveLabel("저장 중…");
            const request = this.context.api.put(`/api/surveys/${encodeURIComponent(this.survey.id)}`, payload);
            this.savePromise = request;
            try {
                const response = await request;
                const saved = response.survey || response;
                this.survey.revision = saved.revision ?? this.survey.revision;
                this.survey.updatedAt = saved.updatedAt ?? this.survey.updatedAt;
                this.persistedSourceLocale = saved.languages?.sourceLocale || this.survey.languages.sourceLocale;
                if (updateUi) this.setSaveLabel(this.dirty ? "저장 대기" : "저장됨");
                return true;
            } catch (error) {
                this.dirty = true;
                if (updateUi) this.setSaveLabel("저장 실패");
                throw error;
            } finally {
                if (this.savePromise === request) this.savePromise = null;
            }
        },
        async flushSave(options = {}) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
            while (this.savePromise || this.dirty) {
                if (this.savePromise) await this.savePromise;
                if (this.dirty) await this.save(options);
            }
            return true;
        },
        async saveExplicit({ notify = true } = {}) {
            if (!this.survey) return false;
            this.dirty = true;
            this.setSaveLabel("저장 중…");
            try {
                await this.flushSave();
                if (notify && !this.destroyed) this.context.toast("설문 초안을 저장했습니다.", "success");
                return true;
            } catch (error) {
                this.setSaveLabel("저장 실패");
                if (!this.destroyed) this.context.toast(`설문 초안을 저장하지 못했습니다. ${error.message}`, "error");
                return false;
            }
        },
        async openTemplateLibrary() {
            if (this.templateAdmin || !this.survey) return;
            try {
                await this.flushSave();
            } catch (error) {
                return this.context.toast(`저장하지 못해 템플릿 선택을 열 수 없습니다. ${error.message}`, "error");
            }
            this.context.openModal(`<div class="page-loading" role="status"><span class="spinner"></span><strong>템플릿을 불러오고 있습니다.</strong></div>`, { label: "템플릿 선택", wide: true, templateLibrary: true });
            try {
                const payload = await this.context.api.get("/api/templates");
                this.templateItems = payload?.items || payload?.templates || payload || [];
                const categories = ["전체", ...new Set(this.templateItems.map((item) => item.category || "일반"))];
            const dialog = this.context.openModal(`<section class="editor-template-layer"><header><div><span class="eyebrow">TEMPLATE LIBRARY</span><h2>설문 구조 템플릿 선택</h2><p>템플릿은 시작 구조입니다. 적용 후 STEP 04에서 자유롭게 수정할 수 있습니다.</p></div><button class="button button-function" type="button" data-editor-template-blank>빈 설문</button></header><div class="editor-template-toolbar"><div class="editor-template-categories" data-editor-template-categories>${categories.map((category, index) => `<button type="button" data-editor-template-category="${Common.escapeHtml(category)}" aria-pressed="${index === 0}">${Common.escapeHtml(category)}</button>`).join("")}</div><label class="search-field"><span class="sr-only">템플릿 검색</span><input type="search" data-editor-template-search placeholder="템플릿 이름 또는 설명 검색"></label></div><div class="editor-template-grid" data-editor-template-grid></div><aside class="editor-template-confirm" data-editor-template-confirm hidden><div><strong data-editor-template-confirm-title>템플릿 적용 확인</strong><p>현재 문항·동적 조건·섹션 분기·번역이 새 구조로 교체됩니다. 기본정보·스킨·응답 UI는 유지됩니다.</p></div><button class="button button-function" type="button" data-editor-template-confirm-cancel>취소</button><button class="button button-function button-important" type="button" data-editor-template-confirm-apply>구조 교체</button></aside></section>`, { label: "설문 구조 템플릿 선택", wide: true, templateLibrary: true, initialFocus: "[data-editor-template-search]" });
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
                const endpoint = this.pendingTemplateCode ? "template" : "template/reset";
                const body = this.pendingTemplateCode ? { templateCode: this.pendingTemplateCode, expectedRevision: this.survey.revision } : { expectedRevision: this.survey.revision };
                const payload = await this.context.api.post(`/api/surveys/${encodeURIComponent(this.survey.id)}/${endpoint}`, body);
                this.survey = payload.survey || payload;
                this.normalizeSurvey();
                this.persistedSourceLocale = this.survey.languages.sourceLocale;
                this.dirty = false;
                this.renderSurvey();
                this.recommendedTemplateId = null;
                dialog.close();
                this.context.toast(this.pendingTemplateCode ? "템플릿 구조를 적용했습니다." : "빈 설문 구조를 적용했습니다.", "success");
            } catch (error) {
                apply.disabled = false;
                this.context.toast(error.message, "error");
            }
        },
        preview() {
            const token = globalThis.crypto.randomUUID();
            const deviceOptions = `${previewDevices.map((device) => `<option value="${device.code}" ${device.code === "mobile-390" ? "selected" : ""}>${device.label}</option>`).join("")}<option value="custom">직접 입력</option>`;
            const dialog = this.context.openModal(`<section class="builder-preview-simulator"><header class="builder-preview-toolbar"><div class="builder-preview-toolbar-copy"><span class="eyebrow">LIVE RESPONDENT RENDERER</span><h2>실제 응답 화면 미리보기</h2><p>현재 편집 초안을 표시합니다. 미리보기 응답은 저장·제출되지 않습니다.</p></div><div class="builder-preview-size-controls"><label>화면 해상도<select data-preview-device-size>${deviceOptions}</select></label><div class="builder-preview-custom-size" data-preview-custom-size hidden><label>가로(px)<input type="number" min="240" max="5120" value="390" data-preview-custom-width></label><span>×</span><label>세로(px)<input type="number" min="320" max="2880" value="844" data-preview-custom-height></label></div></div><output data-preview-size-status></output></header><div class="builder-preview-stage" data-preview-stage><div class="builder-preview-device-holder" data-preview-device-holder><div class="builder-preview-viewport" data-preview-viewport><iframe class="builder-public-preview" data-interactive-preview title="실제 공개 설문 미리보기" sandbox="allow-scripts"></iframe></div></div></div></section>`, { label: "실제 공개 설문 미리보기", wide: true, previewSimulator: true, initialFocus: "[data-preview-device-size]" });
            const frame = dialog.querySelector("[data-interactive-preview]");
            const snapshot = this.savePayload();
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
            const refresh = () => this.applyPreviewDevice(dialog, select.value);
            select.addEventListener("change", () => { customSize.hidden = select.value !== "custom"; refresh(); });
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
            const scale = Math.min(1, (stage.clientWidth - 24) / device.width, (stage.clientHeight - 24) / device.height);
            viewport.style.width = `${device.width}px`;
            viewport.style.height = `${device.height}px`;
            viewport.style.transform = `scale(${scale})`;
            holder.style.width = `${Math.round(device.width * scale)}px`;
            holder.style.height = `${Math.round(device.height * scale)}px`;
            dialog.querySelector("[data-preview-size-status]").textContent = `${device.width} × ${device.height} · ${Math.round(scale * 100)}%`;
        },
        async prepareDistribution() {
            if (!this.survey.questions.some((question) => question.type !== "notice")) return this.context.toast("배포하려면 응답 가능한 문항을 한 개 이상 추가하세요.", "error");
            const saved = await this.saveExplicit({ notify: false });
            if (!saved || this.destroyed) return;
            this.context.toast("초안을 저장했습니다. 배포 설정으로 이동합니다.", "success");
            this.context.navigate("M03001", { surveyId: this.survey.id });
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
        async publishSurvey() {
            if (this.publishing) return;
            if (!this.survey.questions.some((question) => question.type !== "notice")) return this.context.toast("확정하려면 응답 가능한 문항을 한 개 이상 추가하세요.", "error");
            const button = this.root.querySelector("[data-builder-publish]");
            this.publishing = true;
            button.disabled = true;
            const saved = await this.saveExplicit({ notify: false });
            if (!saved || this.destroyed) {
                this.publishing = false;
                if (!this.destroyed) button.disabled = false;
                return;
            }
            try {
                const payload = await this.context.api.post(`/api/surveys/${encodeURIComponent(this.survey.id)}/publish`, {});
                const published = payload.survey || payload;
                this.survey.status = "published";
                this.survey.slug = published.slug;
                this.survey.publicUrl = published.publicUrl;
                this.root.querySelector("[data-builder-status]").textContent = "배포됨";
                this.context.toast(`설문을 확정했습니다. 응답 URL: ${published.publicUrl}`, "success");
            } catch (error) {
                this.context.toast(error.message, "error");
            } finally {
                this.publishing = false;
                if (!this.destroyed) button.disabled = false;
            }
        },
        async beforeRefresh() {
            if (!this.survey || (!this.dirty && !this.savePromise)) return true;
            try {
                await this.flushSave();
                return true;
            } catch (error) {
                if (!this.destroyed) this.context.toast(`저장하지 못해 화면을 새로고침하지 않았습니다. ${error.message}`, "error");
                return false;
            }
        },
        async destroy() {
            this.choiceLayoutCleanup?.();
            this.choiceLayoutCleanup = null;
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
            try {
                if (this.dirty || this.savePromise) await this.flushSave({ updateUi: false });
            } catch (error) {
                console.error("IN-SURVEYONE autosave flush failed", error);
            }
            this.destroyed = true;
            this.root?.removeEventListener("click", this.onClick);
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
