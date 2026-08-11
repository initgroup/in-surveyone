(function () {
    "use strict";
    const PAGE_NAME = "M02003";
    const optionTypes = new Set(["single", "multiple", "dropdown"]);
    const rangeTypes = new Set(["number", "scale", "slider"]);
    const matrixTypes = new Set(["matrix_single", "matrix_multiple", "table", "repeat_table"]);

    function uid(prefix = "q") {
        return `${prefix}_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`}`;
    }

    function defaultQuestion(type) {
        const config = window.SURVEYONE_CONFIG.questionTypes.find((item) => item.code === type) || window.SURVEYONE_CONFIG.questionTypes[0];
        const question = { id: uid(), type, title: `${config.label} 문항`, description: "", required: false, validation: { type: "none" } };
        if (optionTypes.has(type)) question.options = [{ id: uid("o"), label: "보기 1" }, { id: uid("o"), label: "보기 2" }];
        if (type === "scale") Object.assign(question, { min: 1, max: 5, minLabel: "매우 불만족", maxLabel: "매우 만족" });
        if (type === "slider") Object.assign(question, { min: 0, max: 100, unit: "점" });
        if (type === "number") Object.assign(question, { min: null, max: null, unit: "" });
        if (matrixTypes.has(type)) Object.assign(question, { rows: ["항목 1", "항목 2"], columns: ["매우 불만족", "보통", "매우 만족"] });
        if (type === "notice") Object.assign(question, { title: "안내 제목", description: "응답자에게 전달할 안내 내용을 입력하세요." });
        return question;
    }

    window.Pages = window.Pages || {};
    window.Pages[PAGE_NAME] = {
        async init(context) {
            this.context = context;
            this.root = context.root;
            this.surveyId = window.SurveyOneApp.queryParams().get("surveyId");
            this.survey = null;
            this.activeId = null;
            this.saveTimer = null;
            this.savePromise = null;
            this.dirty = false;
            this.destroyed = false;
            this.dragId = null;
            this.editingLocale = null;
            this.persistedSourceLocale = null;
            this.bind();
            this.renderTools();
            this.renderSkins();
            await this.load();
        },
        bind() {
            this.onClick = async (event) => {
                if (event.target.closest("[data-builder-back]")) {
                    try {
                        await this.flushSave();
                        return this.context.navigate("M02001");
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
                const mode = event.target.closest("[data-builder-mode]");
                if (mode) return this.setMode(mode.dataset.builderMode);
                if (event.target.closest("[data-builder-preview]")) return this.preview();
                if (event.target.closest("[data-builder-publish]")) return this.publish();
                if (event.target.closest("[data-properties-close]")) return this.closeProperties();
                const skin = event.target.closest("[data-skin-code]");
                if (skin) return this.setSkin(skin.dataset.skinCode);
                if (event.target.closest("[data-open-skins]")) {
                    try {
                        await this.flushSave();
                        return this.context.navigate("M06001", { surveyId: this.survey.id });
                    } catch (error) {
                        return this.context.toast(`저장하지 못해 이동을 중단했습니다. ${error.message}`, "error");
                    }
                }
                if (event.target.closest("[data-add-rule]")) return this.addLogicRule();
                if (event.target.closest("[data-remove-rule]")) return this.removeLogicRule(event.target.closest("[data-rule-id]").dataset.ruleId);
                if (event.target.closest("[data-mobile-tools]")) this.root.querySelector(".builder-toolbox")?.scrollIntoView({ behavior: "smooth" });
            };
            this.onInput = (event) => this.handleInput(event);
            this.onChange = (event) => this.handleChange(event);
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
                if (!this.surveyId) {
                    const created = await this.context.api.post("/api/surveys", { title: "제목 없는 설문" });
                    this.survey = created.survey || created;
                    this.surveyId = this.survey.id;
                    history.replaceState(null, "", `#/M02003?surveyId=${encodeURIComponent(this.surveyId)}`);
                } else {
                    const payload = await this.context.api.get(`/api/surveys/${encodeURIComponent(this.surveyId)}`);
                    this.survey = payload.survey || payload;
                }
                this.normalizeSurvey();
                this.persistedSourceLocale = this.survey.languages.sourceLocale;
                this.renderSurvey();
            } catch (error) {
                this.root.querySelector(".builder-canvas").innerHTML = `<section class="empty-state error-state"><span class="empty-icon">!</span><h2>설문을 열 수 없습니다</h2><p>${Common.escapeHtml(error.message)}</p><button class="button button-primary" data-builder-back>프로젝트 목록</button></section>`;
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
                questions: (Array.isArray(section.questions) ? section.questions : []).map((question) => ({
                    ...defaultQuestion(question.type || "single"),
                    ...question,
                    id: question.id || uid()
                }))
            }));
            this.survey.sections.forEach((section) => section.questions.forEach((question) => this.syncQuestionCompatibility(question)));
            this.refreshQuestions();
            const incomingSettings = this.survey.settings || {};
            const settings = { anonymous: true, showProgressBar: true, oneResponsePerRespondent: false, allowResponseEdit: false, confirmationMessage: "응답해 주셔서 감사합니다.", ...incomingSettings };
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
            this.renderLanguageControls();
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
                    node.querySelector("[data-required-label]").textContent = question.required ? "필수 응답" : "선택 응답";
                    node.querySelector("[data-answer-editor]").innerHTML = this.answerMarkup(question);
                    host.appendChild(node);
                });
            });
            this.root.querySelector("[data-question-count]").textContent = `${this.survey.questions.length}개`;
            this.root.querySelector("[data-estimated-time]").textContent = `${Math.max(1, Math.ceil(this.survey.questions.filter((item) => item.type !== "notice").length * .35))}분`;
        },
        answerMarkup(question) {
            if (optionTypes.has(question.type)) {
                return (question.options || []).map((option) => `<div class="option-row"><span class="option-marker ${question.type === "multiple" ? "multiple" : ""}"></span><input type="text" value="${Common.escapeHtml(this.localizedOptionLabel(question, option))}" data-option-id="${Common.escapeHtml(option.id)}" aria-label="보기 내용"><button type="button" data-delete-option="${Common.escapeHtml(option.id)}" aria-label="보기 삭제">×</button></div>`).join("") + `<button class="add-option" type="button" data-add-option="${question.id}">＋ 보기 추가</button>`;
            }
            if (question.type === "short_text") return `<div class="answer-placeholder">짧은 답변이 입력됩니다.</div>`;
            if (question.type === "long_text") return `<div class="answer-placeholder long">긴 답변이 입력됩니다.</div>`;
            if (["number", "slider"].includes(question.type)) return `<div class="answer-placeholder">${question.min ?? 0} — ${question.max ?? 100} ${Common.escapeHtml(this.localizedQuestionField(question, "unit"))}</div>`;
            if (question.type === "scale") {
                const count = Math.min(10, Math.max(2, Number(question.max || 5) - Number(question.min || 1) + 1));
                return `<div class="scale-preview" style="--count:${count}">${Array.from({ length: count }, (_, i) => `<span>${Number(question.min || 1) + i}</span>`).join("")}</div><div class="scale-preview-labels"><span>${Common.escapeHtml(this.localizedQuestionField(question, "minLabel"))}</span><span>${Common.escapeHtml(this.localizedQuestionField(question, "maxLabel"))}</span></div>`;
            }
            if (matrixTypes.has(question.type)) return `<div class="matrix-preview"><table><thead><tr><th>항목</th>${(question.columns || []).map((column, index) => `<th><input type="text" data-matrix-column-index="${index}" value="${Common.escapeHtml(this.localizedIndexedLabel(question, "columns", index))}" aria-label="${index + 1}번 열 제목"></th>`).join("")}</tr></thead><tbody>${(question.rows || []).map((row, rowIndex) => `<tr><td><input type="text" data-matrix-row-index="${rowIndex}" value="${Common.escapeHtml(this.localizedIndexedLabel(question, "rows", rowIndex))}" aria-label="${rowIndex + 1}번 행 제목"></td>${(question.columns || []).map(() => "<td>○</td>").join("")}</tr>`).join("")}</tbody></table></div>`;
            if (question.type === "date") return `<div class="answer-placeholder">연도-월-일</div>`;
            if (question.type === "notice") return `<div class="answer-placeholder long">${Common.escapeHtml(this.localizedQuestionField(question, "description") || "안내 내용을 입력하세요.")}</div>`;
            return `<div class="answer-placeholder">응답 영역</div>`;
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
            this.root.querySelector("[data-prop-required]").checked = Boolean(question.required);
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
            if (event.target.matches("[data-prop-description]")) this.setLocalizedQuestionField(question, "description", event.target.value);
            if (event.target.matches("[data-prop-unit]")) this.setLocalizedQuestionField(question, "unit", event.target.value);
            if (event.target.matches("[data-prop-min-label]")) this.setLocalizedQuestionField(question, "minLabel", event.target.value);
            if (event.target.matches("[data-prop-max-label]")) this.setLocalizedQuestionField(question, "maxLabel", event.target.value);
            if (event.target.matches("[data-matrix-row-index]")) this.setLocalizedIndexedLabel(question, "rows", Number(event.target.dataset.matrixRowIndex), event.target.value);
            if (event.target.matches("[data-matrix-column-index]")) this.setLocalizedIndexedLabel(question, "columns", Number(event.target.dataset.matrixColumnIndex), event.target.value);
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
                if (!event.target.checked) this.survey.languages.enabled = this.survey.languages.enabled.filter((item) => item !== code);
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
            if (event.target.matches("[data-prop-required]")) { question.required = event.target.checked; this.renderQuestions(); }
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
            const [question] = from.section.questions.splice(from.questionIndex, 1);
            const targetAfterRemoval = this.questionLocation(targetId);
            const insertAt = targetAfterRemoval.questionIndex + (placeAfter ? 1 : 0);
            targetAfterRemoval.section.questions.splice(insertAt, 0, question);
            this.refreshQuestions();
            this.renderQuestions();
            this.scheduleSave();
        },
        duplicateQuestion(id) {
            const location = this.questionLocation(id);
            if (!location) return;
            const copy = structuredClone(location.question);
            copy.id = uid();
            if (copy.options) copy.options = copy.options.map((item) => ({ ...item, id: uid("o") }));
            location.section.questions.splice(location.questionIndex + 1, 0, copy);
            this.refreshQuestions();
            this.activeId = copy.id;
            this.renderQuestions();
            this.scheduleSave();
        },
        deleteQuestion(id) {
            const location = this.questionLocation(id);
            if (!location) return;
            location.section.questions.splice(location.questionIndex, 1);
            this.refreshQuestions();
            if (this.activeId === id) {
                this.activeId = null;
                this.root.querySelector("[data-properties-empty]").hidden = false;
                this.root.querySelector("[data-properties-panel]").hidden = true;
            }
            this.renderQuestions();
            this.scheduleSave();
        },
        addOption(questionId) { const question = this.question(questionId); if (!question) return; question.options = question.options || []; question.options.push({ id: uid("o"), label: `보기 ${question.options.length + 1}` }); this.renderQuestions(); this.scheduleSave(); },
        deleteOption(questionId, optionId) { const question = this.question(questionId); if (!question || question.options.length <= 1) return this.context.toast("보기는 한 개 이상 필요합니다.", "error"); question.options = question.options.filter((item) => item.id !== optionId); this.renderQuestions(); this.scheduleSave(); },
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
                return `<article class="logic-rule" data-rule-id="${Common.escapeHtml(rule.id)}"><label class="form-field">기준 문항<select data-rule-question>${questionOptions}</select></label><label class="form-field">조건<select data-rule-operator><option value="equals" ${rule.operator === "equals" ? "selected" : ""}>같음</option><option value="notEquals" ${rule.operator === "notEquals" ? "selected" : ""}>같지 않음</option><option value="contains" ${rule.operator === "contains" ? "selected" : ""}>포함</option></select></label><label class="form-field">비교 값<input type="text" data-rule-value value="${Common.escapeHtml(rule.value || rule.optionId || "")}" placeholder="보기 ID 또는 값"></label><label class="form-field">이동 위치<select data-rule-destination><option value="complete" ${destination === "complete" ? "selected" : ""}>설문 완료</option><option value="next" ${destination === "next" ? "selected" : ""}>다음 섹션</option>${sectionOptions}</select></label><button class="button button-small button-danger" type="button" data-remove-rule>삭제</button></article>`;
            }).join("");
        },
        setSkin(code) { this.survey.skin = { ...(this.survey.skin || {}), preset: code }; this.applySkin(); this.scheduleSave(); },
        applySkin() { const skin = window.SURVEYONE_CONFIG.skinPresets.find((item) => item.code === this.survey.skin?.preset) || window.SURVEYONE_CONFIG.skinPresets[0]; this.root.querySelector("[data-builder-shell]").style.setProperty("--survey-primary", skin.primary); this.root.querySelectorAll("[data-skin-code]").forEach((button) => button.classList.toggle("is-active", button.dataset.skinCode === skin.code)); },
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
                translations
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
        preview() {
            const questions = this.survey.questions.slice(0, 6);
            const skin = window.SURVEYONE_CONFIG.skinPresets.find((item) => item.code === this.survey.skin?.preset) || window.SURVEYONE_CONFIG.skinPresets[0];
            const questionMarkup = questions.map((question, index) => {
                const title = this.localizedQuestionField(question, "title");
                const answer = optionTypes.has(question.type)
                    ? (question.options || []).map((option) => `<label><input type="${question.type === "multiple" ? "checkbox" : "radio"}" disabled> ${Common.escapeHtml(this.localizedOptionLabel(question, option))}</label>`).join("")
                    : `<div class="answer-placeholder">${question.type === "long_text" ? "긴 답변" : "응답 입력"}</div>`;
                return `<div class="builder-preview-question"><strong>${index + 1}. ${Common.escapeHtml(title)} ${question.required ? '<span class="text-danger">*</span>' : ""}</strong>${answer}</div>`;
            }).join("");
            this.context.openModal(`<p class="eyebrow">RESPONDENT PREVIEW · ${Common.escapeHtml(this.localeLabel(this.editingLocale))}</p><h2>모바일 응답 미리보기</h2><div class="builder-preview" style="--survey-primary:${skin.primary}"><div class="builder-preview-cover"><h3>${Common.escapeHtml(this.localizedSurveyField("title"))}</h3><p>${Common.escapeHtml(this.localizedSurveyField("description") || "설문에 참여해 주세요.")}</p></div>${questionMarkup || '<div class="builder-preview-question">문항을 추가하면 여기에 표시됩니다.</div>'}</div>`, { wide: false });
        },
        async publish() {
            if (!this.survey.questions.some((question) => question.type !== "notice")) return this.context.toast("배포하려면 응답 가능한 문항을 한 개 이상 추가하세요.", "error");
            try {
                await this.flushSave();
                const payload = await this.context.api.post(`/api/surveys/${encodeURIComponent(this.survey.id)}/publish`, {});
                this.survey = { ...this.survey, ...(payload.survey || payload), status: "published" };
                if (this.destroyed) return;
                this.renderSurvey();
                this.context.toast("불변 배포본과 고유 URL을 만들었습니다.", "success");
                this.context.navigate("M03001", { surveyId: this.survey.id });
            } catch (error) {
                if (!this.destroyed) this.context.toast(`저장 또는 배포에 실패했습니다. ${error.message}`, "error");
            }
        },
        async destroy() {
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
