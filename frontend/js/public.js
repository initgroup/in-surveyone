(function () {
    "use strict";

    const state = {
        survey: null,
        slug: "",
        sections: [],
        questions: [],
        answers: {},
        saveTimer: null,
        respondentKey: null,
        languages: { sourceLocale: "ko", defaultLocale: "ko", enabled: ["ko"] },
        translations: {},
        locale: "ko",
        requestedLocale: "",
        idempotencyKey: null
    };
    const dom = {};

    document.addEventListener("DOMContentLoaded", init);

    async function init() {
        cacheDom();
        state.slug = decodeURIComponent(location.pathname.split("/").filter(Boolean).pop() || new URLSearchParams(location.search).get("slug") || "");
        if (!state.slug) return showState("!", "설문 주소가 올바르지 않습니다.", "전달받은 링크를 다시 확인해 주세요.");
        bind();
        try {
            state.requestedLocale = preferredLanguage();
            const languageQuery = state.requestedLocale ? `?lang=${encodeURIComponent(state.requestedLocale)}` : "";
            let payload = await Common.api.get(`/api/public/surveys/${encodeURIComponent(state.slug)}${languageQuery}`);
            state.survey = payload.survey || payload;
            normalizeSurvey();
            const servedLocale = localeCode(state.survey.requestedLocale || state.survey.requested_locale, null, null);
            if (state.locale && (!servedLocale || servedLocale.toLowerCase() !== state.locale.toLowerCase())) {
                payload = await Common.api.get(`/api/public/surveys/${encodeURIComponent(state.slug)}?lang=${encodeURIComponent(state.locale)}`);
                state.survey = payload.survey || payload;
                normalizeSurvey();
            }
            restoreDraft();
            render();
        } catch (error) {
            showState("!", "설문을 열 수 없습니다.", error.message);
        }
    }

    function preferredLanguage() {
        const query = new URLSearchParams(location.search).get("lang");
        if (query && query.trim()) return query.trim();
        return (navigator.languages || [navigator.language]).find((locale) => typeof locale === "string" && locale.trim()) || "";
    }

    function cacheDom() {
        dom.loading = document.querySelector("[data-public-loading]");
        dom.form = document.querySelector("[data-public-form]");
        dom.list = document.querySelector("[data-public-question-list]");
        dom.state = document.querySelector("[data-public-state]");
        dom.progress = document.querySelector("[data-public-progress]");
        dom.saveState = document.querySelector("[data-public-save-state]");
        dom.summary = document.querySelector("[data-validation-summary]");
        dom.language = document.querySelector("[data-public-language]");
        dom.languageWrap = document.querySelector("[data-public-language-wrap]");
        dom.demoBanner = document.querySelector("[data-public-demo-banner]");
    }

    function bind() {
        dom.form.addEventListener("input", onInput);
        dom.form.addEventListener("change", onInput);
        dom.form.addEventListener("click", onClick);
        dom.form.addEventListener("submit", submit);
        dom.language.addEventListener("change", changeLanguage);
        window.addEventListener("scroll", updateProgress, { passive: true });
    }

    function normalizeSurvey() {
        const flatQuestions = Array.isArray(state.survey.questions) ? state.survey.questions : [];
        state.sections = Array.isArray(state.survey.sections) && state.survey.sections.length
            ? state.survey.sections
            : [{ id: "section-default", title: "설문 문항", description: "", questions: flatQuestions }];
        state.sections = state.sections.map((section, index) => ({
            ...section,
            id: section.id || `section-${index + 1}`,
            title: section.title || `섹션 ${index + 1}`,
            questions: Array.isArray(section.questions) ? section.questions : []
        }));
        state.questions = state.sections.flatMap((section) => section.questions);
        normalizeLanguages();
    }

    function localeCatalog() {
        const configured = window.SURVEYONE_CONFIG.locales;
        const recommendations = Array.isArray(configured) && configured.length ? configured : [
            { code: "ko", label: "한국어", nativeLabel: "한국어" },
            { code: "en", label: "영어", nativeLabel: "English" },
            { code: "ja", label: "일본어", nativeLabel: "日本語" },
            { code: "zh", label: "중국어", nativeLabel: "中文" }
        ];
        const result = recommendations.map((item) => ({ ...item, code: localeCode(item.code, null, item.code) }));
        [...(state.languages?.enabled || []), ...Object.keys(state.translations || {})].forEach((code) => {
            const canonical = localeCode(code, null, null);
            if (canonical && !result.some((item) => item.code.toLowerCase() === canonical.toLowerCase())) result.push({ code: canonical, label: canonical, nativeLabel: canonical });
        });
        return result;
    }

    function localeCode(value, supported = null, fallback = null) {
        const candidate = String(value || "").trim().replaceAll("_", "-");
        let canonical = null;
        try { canonical = Intl.getCanonicalLocales(candidate)[0] || null; } catch { canonical = null; }
        if (!canonical) return fallback;
        if (!supported) return canonical;
        return [...supported].find((code) => String(code).toLowerCase() === canonical.toLowerCase()) || fallback;
    }

    function resolveLocale(value, enabled) {
        const canonical = localeCode(value, null, null);
        if (!canonical) return null;
        const exact = enabled.find((code) => code.toLowerCase() === canonical.toLowerCase());
        if (exact) return exact;
        const base = canonical.split("-")[0].toLowerCase();
        return enabled.find((code) => code.toLowerCase() === base)
            || enabled.find((code) => code.split("-")[0].toLowerCase() === base)
            || null;
    }

    function normalizeLanguages() {
        const compatibility = state.survey.skin?.i18n || {};
        const raw = state.survey.languages || compatibility.languages || {
            sourceLocale: state.survey.defaultLocale || state.survey.default_locale || "ko",
            defaultLocale: state.survey.defaultLocale || state.survey.default_locale || "ko",
            enabled: state.survey.supportedLocales || state.survey.supported_locales || ["ko"]
        };
        const sourceLocale = localeCode(raw.sourceLocale || raw.source_locale || raw.source || "ko", null, "ko");
        const rawEnabled = Array.isArray(raw) ? raw : (raw.enabled || raw.locales || raw.codes || [sourceLocale]);
        const enabled = [...new Set(rawEnabled.filter((item) => typeof item === "string" || item?.enabled !== false)
            .map((item) => typeof item === "string" ? item : item?.code)
            .map((item) => localeCode(item, null, null)).filter(Boolean))];
        if (!enabled.includes(sourceLocale)) enabled.unshift(sourceLocale);
        const requestedDefault = localeCode(raw.defaultLocale || raw.default_locale || raw.default || sourceLocale, null, sourceLocale);
        const defaultLocale = resolveLocale(requestedDefault, enabled) || sourceLocale;
        state.languages = { sourceLocale, defaultLocale, enabled };
        const rawTranslations = state.survey.translations || compatibility.translations || {};
        const translations = Array.isArray(rawTranslations)
            ? Object.fromEntries(rawTranslations.map((item) => [item.locale || item.code, item.translations || item.content || item]).filter(([code]) => code))
            : (rawTranslations && typeof rawTranslations === "object" ? rawTranslations : {});
        state.translations = Object.fromEntries(Object.entries(translations).map(([locale, value]) => [localeCode(locale, null, null), value]).filter(([locale]) => locale));
        const requested = new URLSearchParams(location.search).get("lang");
        const preferences = [requested, ...(navigator.languages || [navigator.language]), defaultLocale, sourceLocale];
        state.locale = preferences.map((item) => resolveLocale(item, enabled)).find(Boolean) || sourceLocale;
    }

    function localeLabel(code) {
        const locale = localeCatalog().find((item) => item.code.toLowerCase() === String(code).toLowerCase());
        if (locale) return locale.nativeLabel || locale.label || code;
        const base = String(code).split("-")[0];
        const baseLocale = localeCatalog().find((item) => item.code === base);
        return baseLocale ? `${baseLocale.nativeLabel || baseLocale.label} (${code})` : code;
    }

    function translationBucket(locale = state.locale) {
        return locale === state.languages.sourceLocale ? null : state.translations[locale] || null;
    }

    function localizedValue(value, fallback = "") {
        return typeof value === "string" && value.trim() ? value : String(fallback ?? "");
    }

    function localizedTranslation(primary, defaultValue, source) {
        if (state.locale === state.languages.sourceLocale) return String(source ?? "");
        return localizedValue(primary, localizedValue(defaultValue, source));
    }

    function localizedSurveyField(field) {
        const base = field === "confirmationMessage" ? state.survey.settings?.confirmationMessage : state.survey[field];
        return localizedTranslation(translationBucket()?.[field], translationBucket(state.languages.defaultLocale)?.[field], base);
    }

    function localizedSectionField(section, field) {
        return localizedTranslation(
            translationBucket()?.sections?.[section.id]?.[field],
            translationBucket(state.languages.defaultLocale)?.sections?.[section.id]?.[field],
            section[field]
        );
    }

    function translatedQuestion(question, locale = state.locale) {
        if (!question) return null;
        const section = state.sections.find((item) => item.questions.some((candidate) => String(candidate.id) === String(question.id)));
        return section ? translationBucket(locale)?.sections?.[section.id]?.questions?.[question.id] : null;
    }

    function localizedQuestionField(question, field) {
        if (!question) return "";
        return localizedTranslation(
            translatedQuestion(question)?.[field],
            translatedQuestion(question, state.languages.defaultLocale)?.[field],
            question[field]
        );
    }

    function localizedOptionLabel(question, option) {
        return localizedTranslation(
            translatedQuestion(question)?.options?.[option.id],
            translatedQuestion(question, state.languages.defaultLocale)?.options?.[option.id],
            option.label
        );
    }

    function localizedIndexedLabel(question, field, index) {
        const stableKey = axisItemId(question, field, index);
        const current = translatedQuestion(question)?.[field];
        const fallback = translatedQuestion(question, state.languages.defaultLocale)?.[field];
        return localizedTranslation(
            current?.[stableKey] ?? current?.[index],
            fallback?.[stableKey] ?? fallback?.[index],
            question[field]?.[index]
        );
    }

    function axisItemId(question, field, index) {
        return String(question.settings?.[field]?.[index]?.id ?? index);
    }

    function renderLanguageSelector() {
        document.documentElement.lang = state.locale;
        dom.language.innerHTML = state.languages.enabled.map((code) => `<option value="${Common.escapeHtml(code)}" ${code === state.locale ? "selected" : ""}>${Common.escapeHtml(localeLabel(code))}</option>`).join("");
        dom.languageWrap.hidden = state.languages.enabled.length < 2;
    }

    function cloneSerializable(value) {
        if (typeof structuredClone === "function") return structuredClone(value);
        return JSON.parse(JSON.stringify(value));
    }

    function languageStateSnapshot() {
        return cloneSerializable({
            survey: state.survey,
            sections: state.sections,
            questions: state.questions,
            answers: state.answers,
            languages: state.languages,
            translations: state.translations,
            locale: state.locale,
            requestedLocale: state.requestedLocale,
            idempotencyKey: state.idempotencyKey
        });
    }

    function restoreLanguageState(snapshot) {
        Object.entries(snapshot).forEach(([key, value]) => { state[key] = value; });
    }

    async function changeLanguage(event) {
        const locale = event.target.value;
        if (!state.languages.enabled.includes(locale) || locale === state.locale) return;
        collectAnswers();
        const previousState = languageStateSnapshot();
        const previousUrl = `${location.pathname}${location.search}${location.hash}`;
        const url = new URL(location.href);
        url.searchParams.set("lang", locale);
        history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
        dom.language.disabled = true;
        try {
            const payload = await Common.api.get(`/api/public/surveys/${encodeURIComponent(state.slug)}?lang=${encodeURIComponent(locale)}`);
            state.survey = payload.survey || payload;
            normalizeSurvey();
            render();
            state.idempotencyKey = null;
        } catch (error) {
            restoreLanguageState(previousState);
            history.replaceState(null, "", previousUrl);
            try {
                render();
                dom.saveState.textContent = `언어를 바꾸지 못했습니다. ${error?.message || "다시 시도해 주세요."}`;
            } catch {
                showState("!", "설문 언어를 바꾸지 못했습니다.", "페이지를 새로 고침한 뒤 다시 시도해 주세요.");
            }
        } finally {
            dom.language.disabled = false;
            dom.language.focus({ preventScroll: true });
        }
    }

    function formatExperienceExpiry(value) {
        if (!value) return "운영 정책에 따른 만료 시각";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "확인되지 않은 만료 시각";
        try {
            return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(date);
        } catch {
            return "확인되지 않은 만료 시각";
        }
    }

    function render() {
        applySkin();
        renderLanguageSelector();
        document.title = `${localizedSurveyField("title")} | IN-SURVEYONE`;
        document.querySelector("[data-public-organization]").textContent = state.survey.organizationName || state.survey.tenantName || "안전한 온라인 설문";
        document.querySelector("[data-public-category]").textContent = (state.survey.category || "ONLINE SURVEY").toUpperCase();
        document.querySelector("[data-public-title]").textContent = localizedSurveyField("title");
        document.querySelector("[data-public-description]").textContent = localizedSurveyField("description") || "설문에 참여해 주세요.";
        const guestDemo = Boolean(state.survey.guestDemo ?? state.survey.guest_demo);
        const expiresAt = state.survey.experienceExpiresAt || state.survey.experience_expires_at;
        dom.demoBanner.hidden = !guestDemo;
        if (guestDemo) {
            const expires = formatExperienceExpiry(expiresAt);
            dom.demoBanner.textContent = `체험용 설문 · ${expires}까지만 접근할 수 있습니다. 실제 개인정보를 입력하지 마세요.`;
        }
        const answerableQuestions = state.questions.filter((item) => item.type !== "notice");
        document.querySelector("[data-public-time]").textContent = `약 ${Math.max(1, Math.ceil(answerableQuestions.length * .35))}분`;
        document.querySelector("[data-public-count]").textContent = `${answerableQuestions.length}개`;
        document.querySelector("[data-public-mode]").textContent = state.survey.settings?.anonymous === false ? "기명" : "익명";
        document.querySelector("[data-public-notice]").hidden = true;

        let questionIndex = 0;
        dom.list.innerHTML = state.sections.map((section, sectionIndex) => {
            const result = sectionMarkup(section, sectionIndex, questionIndex);
            questionIndex += section.questions.filter((question) => question.type !== "notice").length;
            return result;
        }).join("");

        const showProgress = setting("showProgressBar", "showProgress", true);
        document.querySelector(".public-progress").hidden = !showProgress;
        populateDraft();
        collectAnswers();
        applyLogic();
        dom.loading.hidden = true;
        dom.form.hidden = false;
        document.querySelector("#surveyMain").focus({ preventScroll: true });
        updateProgress();
    }

    function applySkin() {
        const skin = state.survey.skin || {};
        const preset = window.SURVEYONE_CONFIG.skinPresets.find((item) => item.code === skin.preset) || {};
        const root = document.documentElement;
        const safeColor = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value) : fallback;
        const safeRadius = /^(?:0|[1-9][0-9]?)px$/.test(String(skin.radius || "")) ? String(skin.radius) : (preset.radius || "18px");
        root.style.setProperty("--survey-primary", safeColor(skin.primary, preset.primary || "#2457d6"));
        root.style.setProperty("--survey-accent", safeColor(skin.accent, preset.accent || "#4ed7bd"));
        root.style.setProperty("--survey-surface", safeColor(skin.surface, preset.surface || "#f3f7ff"));
        root.style.setProperty("--survey-radius", safeRadius);
        if (skin.font === "serif") root.style.setProperty("--survey-font", '"Batang",serif');
        document.body.classList.toggle("high-contrast", Boolean(skin.highContrast));
        const image = document.querySelector("[data-public-cover-image]");
        const headerImage = safeAssetUrl(skin.headerImageUrl);
        image.classList.toggle("has-image", Boolean(headerImage));
        image.style.backgroundImage = "";
        if (headerImage) {
            image.classList.add("has-image");
            image.style.backgroundImage = `linear-gradient(90deg,rgba(7,22,45,.25),rgba(7,22,45,0)),url("${headerImage}")`;
        }
    }

    function safeAssetUrl(value) {
        if (!value) return "";
        try {
            const candidate = new URL(String(value), location.origin);
            if (candidate.origin !== location.origin) return "";
            if (!["/frontend/assets/", "/uploads/"].some((prefix) => candidate.pathname.startsWith(prefix))) return "";
            return candidate.href.replace(/["\\\n\r]/g, "");
        } catch {
            return "";
        }
    }

    function sectionMarkup(section, sectionIndex, questionOffset) {
        let localIndex = 0;
        const content = section.questions.map((question) => {
            if (question.type === "notice") return noticeMarkup(question);
            const markup = questionMarkup(question, questionOffset + localIndex);
            localIndex += 1;
            return markup;
        }).join("");
        const sectionDescription = localizedSectionField(section, "description");
        const description = sectionDescription ? `<p class="public-section-description">${Common.escapeHtml(sectionDescription)}</p>` : "";
        return `<fieldset class="public-section" data-section-id="${Common.escapeHtml(section.id)}"><legend><span>SECTION ${String(sectionIndex + 1).padStart(2, "0")}</span><strong>${Common.escapeHtml(localizedSectionField(section, "title"))}</strong></legend>${description}<div class="public-section-questions">${content}</div></fieldset>`;
    }

    function noticeMarkup(question) {
        return `<aside class="public-notice" role="note"><h2>${Common.escapeHtml(localizedQuestionField(question, "title"))}</h2><p>${Common.escapeHtml(localizedQuestionField(question, "description"))}</p></aside>`;
    }

    function questionMarkup(question, index) {
        const token = domToken(question.id, index);
        const titleId = `question-title-${token}`;
        const helpId = `question-help-${token}`;
        const errorId = `question-error-${token}`;
        const title = localizedQuestionField(question, "title");
        const help = localizedQuestionField(question, "description");
        const describedBy = `${help ? `${helpId} ` : ""}${errorId}`;
        return `<section id="question-${token}" class="public-question-card" data-question-id="${Common.escapeHtml(question.id)}" data-question-number="${index + 1}" tabindex="-1" aria-labelledby="${titleId}"><div class="question-number"><span>QUESTION ${String(index + 1).padStart(2, "0")}</span><span>${Common.escapeHtml(typeLabel(question.type))}</span></div><h2 id="${titleId}">${index + 1}. ${Common.escapeHtml(title)} ${question.required ? '<span class="required-mark" aria-label="필수">*</span>' : ""}</h2>${help ? `<p id="${helpId}" class="question-help">${Common.escapeHtml(help)}</p>` : ""}<div class="public-answer">${answerMarkup(question, { titleId, describedBy })}</div><p id="${errorId}" class="question-error" role="alert" aria-live="polite" hidden></p></section>`;
    }

    function typeLabel(type) {
        return window.SURVEYONE_CONFIG.questionTypes.find((item) => item.code === type)?.label || type;
    }

    function answerMarkup(question, ids) {
        const name = `q_${question.id}`;
        const aria = `aria-labelledby="${ids.titleId}" aria-describedby="${ids.describedBy}"`;
        if (question.type === "single" || question.type === "multiple") {
            const inputType = question.type === "multiple" ? "checkbox" : "radio";
            const choices = (question.options || []).map((option) => `<label class="public-choice"><input type="${inputType}" name="${Common.escapeHtml(name)}" value="${Common.escapeHtml(option.id)}" ${aria}><span>${Common.escapeHtml(localizedOptionLabel(question, option))}</span></label>`).join("");
            return `<fieldset class="public-answer-group" ${aria}><legend class="public-visually-hidden">${Common.escapeHtml(localizedQuestionField(question, "title"))}</legend>${choices}</fieldset>`;
        }
        if (question.type === "dropdown") return `<select name="${Common.escapeHtml(name)}" ${aria}><option value="">선택하세요</option>${(question.options || []).map((option) => `<option value="${Common.escapeHtml(option.id)}">${Common.escapeHtml(localizedOptionLabel(question, option))}</option>`).join("")}</select>`;
        if (question.type === "short_text") return `<input type="text" name="${Common.escapeHtml(name)}" placeholder="답변을 입력하세요" ${aria}>`;
        if (question.type === "long_text") return `<textarea name="${Common.escapeHtml(name)}" placeholder="의견을 자유롭게 입력하세요" ${aria}></textarea>`;
        if (question.type === "number") return `<label class="input-with-unit"><input type="number" name="${Common.escapeHtml(name)}" min="${question.min ?? ""}" max="${question.max ?? ""}" placeholder="숫자 입력" ${aria}><span>${Common.escapeHtml(localizedQuestionField(question, "unit"))}</span></label>`;
        if (question.type === "date") return `<input type="date" name="${Common.escapeHtml(name)}" ${aria}>`;
        if (question.type === "scale") {
            const minimum = Number(question.min ?? 1);
            const maximum = Number(question.max ?? 5);
            const count = Math.min(11, Math.max(2, maximum - minimum + 1));
            const choices = Array.from({ length: count }, (_, index) => `<label><input type="radio" name="${Common.escapeHtml(name)}" value="${minimum + index}" ${aria}><span>${minimum + index}</span></label>`).join("");
            return `<fieldset class="public-answer-group" ${aria}><legend class="public-visually-hidden">${Common.escapeHtml(localizedQuestionField(question, "title"))}</legend><div class="public-scale" style="--scale-count:${count}">${choices}</div><div class="scale-labels"><span>${Common.escapeHtml(localizedQuestionField(question, "minLabel"))}</span><span>${Common.escapeHtml(localizedQuestionField(question, "maxLabel"))}</span></div></fieldset>`;
        }
        if (question.type === "slider") return `<div class="slider-answer"><output class="slider-value" data-slider-value>${question.min ?? 0}${Common.escapeHtml(localizedQuestionField(question, "unit"))}</output><input type="range" name="${Common.escapeHtml(name)}" min="${question.min ?? 0}" max="${question.max ?? 100}" value="${question.min ?? 0}" data-slider ${aria}></div>`;
        if (["matrix_single", "matrix_multiple"].includes(question.type)) return matrixMarkup(question, name, aria);
        if (question.type === "table") return fixedTableMarkup(question, name, aria);
        if (question.type === "repeat_table") return repeatTableMarkup(question, name, aria);
        return `<input type="text" name="${Common.escapeHtml(name)}" placeholder="답변을 입력하세요" ${aria}>`;
    }

    function matrixMarkup(question, name, aria) {
        const multiple = question.type === "matrix_multiple";
        const columns = (question.columns || []).map((column, index) => localizedIndexedLabel(question, "columns", index));
        const rows = (question.rows || []).map((row, index) => localizedIndexedLabel(question, "rows", index));
        return `<div class="public-matrix" role="group" ${aria}><table><caption class="public-visually-hidden">${Common.escapeHtml(localizedQuestionField(question, "title"))}</caption><thead><tr><th scope="col">항목</th>${columns.map((column) => `<th scope="col">${Common.escapeHtml(column)}</th>`).join("")}</tr></thead><tbody>${rows.map((row, rowIndex) => `<tr data-matrix-row-id="${Common.escapeHtml(axisItemId(question, "rows", rowIndex))}"><th scope="row">${Common.escapeHtml(row)}</th>${columns.map((column, columnIndex) => `<td><input type="${multiple ? "checkbox" : "radio"}" name="${Common.escapeHtml(name)}_${rowIndex}${multiple ? `_${columnIndex}` : ""}" value="${Common.escapeHtml(axisItemId(question, "columns", columnIndex))}" aria-label="${Common.escapeHtml(row)} - ${Common.escapeHtml(column)}" aria-describedby="${aria.match(/aria-describedby="([^"]*)"/)?.[1] || ""}"></td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    }

    function repeatTableMarkup(question, name, aria) {
        const sourceColumns = question.columns?.length ? question.columns : ["항목", "내용"];
        const columns = sourceColumns.map((column, index) => localizedIndexedLabel(question, "columns", index));
        return `<div class="repeat-table" role="group" ${aria} data-repeat-table="${Common.escapeHtml(question.id)}"><div class="repeat-table-row" style="--columns:${columns.length}" aria-hidden="true">${columns.map((column) => `<strong>${Common.escapeHtml(column)}</strong>`).join("")}<span></span></div><div data-repeat-rows>${repeatRow(columns, name, 0, aria)}</div><button class="repeat-add" type="button" data-repeat-add>＋ 행 추가</button></div>`;
    }

    function fixedTableMarkup(question, name, aria) {
        const sourceColumns = question.columns?.length ? question.columns : ["항목", "내용"];
        const sourceRows = question.rows?.length ? question.rows : ["1행"];
        const columns = sourceColumns.map((column, index) => localizedIndexedLabel(question, "columns", index));
        const rows = sourceRows.map((row, index) => localizedIndexedLabel(question, "rows", index));
        const describedBy = aria.match(/aria-describedby="([^"]*)"/)?.[1] || "";
        return `<div class="public-fixed-table" role="group" ${aria}><table><caption class="public-visually-hidden">${Common.escapeHtml(localizedQuestionField(question, "title"))}</caption><thead><tr><th scope="col">항목</th>${columns.map((column) => `<th scope="col">${Common.escapeHtml(column)}</th>`).join("")}</tr></thead><tbody data-repeat-rows>${rows.map((row, rowIndex) => `<tr data-repeat-row><th scope="row">${Common.escapeHtml(row)}</th>${columns.map((column, columnIndex) => `<td><input type="text" name="${Common.escapeHtml(name)}_${rowIndex}_${columnIndex}" aria-label="${Common.escapeHtml(row)} - ${Common.escapeHtml(column)}" aria-describedby="${Common.escapeHtml(describedBy)}"></td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    }

    function repeatRow(columns, name, index, aria = "") {
        return `<div class="repeat-table-row" style="--columns:${columns.length}" data-repeat-row>${columns.map((column, columnIndex) => `<input type="text" name="${Common.escapeHtml(name)}_${index}_${columnIndex}" placeholder="${Common.escapeHtml(column)}" aria-label="${index + 1}행 ${Common.escapeHtml(column)}" ${aria}>`).join("")}<button type="button" data-repeat-remove aria-label="${index + 1}행 삭제">×</button></div>`;
    }

    function onClick(event) {
        const add = event.target.closest("[data-repeat-add]");
        const remove = event.target.closest("[data-repeat-remove]");
        if (add || remove) state.idempotencyKey = null;
        if (add) {
            const table = add.closest("[data-repeat-table]");
            const currentQuestion = question(table.dataset.repeatTable);
            const rows = table.querySelector("[data-repeat-rows]");
            const card = table.closest("[data-question-id]");
            const description = card.querySelector(".question-help")?.id;
            const error = card.querySelector(".question-error")?.id;
            const aria = `aria-labelledby="${card.querySelector("h2").id}" aria-describedby="${[description, error].filter(Boolean).join(" ")}"`;
            const sourceColumns = currentQuestion.columns?.length ? currentQuestion.columns : ["항목", "내용"];
            const localizedColumns = sourceColumns.map((column, index) => localizedIndexedLabel(currentQuestion, "columns", index));
            rows.insertAdjacentHTML("beforeend", repeatRow(localizedColumns, `q_${currentQuestion.id}`, rows.children.length, aria));
            collectAnswers();
            scheduleDraft();
        }
        if (remove && remove.closest("[data-repeat-rows]").children.length > 1) {
            remove.closest("[data-repeat-row]").remove();
            collectAnswers();
            scheduleDraft();
        }
    }

    function onInput(event) {
        state.idempotencyKey = null;
        if (event.target.matches("[data-slider]")) {
            const currentQuestion = question(event.target.closest("[data-question-id]").dataset.questionId);
            event.target.closest(".slider-answer").querySelector("[data-slider-value]").textContent = `${event.target.value}${localizedQuestionField(currentQuestion, "unit")}`;
        }
        collectAnswers();
        applyLogic();
        clearQuestionError(event.target.closest("[data-question-id]"));
        renderValidationSummary();
        scheduleDraft();
        updateProgress();
    }

    function question(id) {
        return state.questions.find((item) => String(item.id) === String(id));
    }

    function collectAnswers() {
        const result = {};
        dom.list.querySelectorAll("[data-question-id]").forEach((card) => {
            const id = card.dataset.questionId;
            const currentQuestion = question(id);
            const name = `q_${id}`;
            let value = "";
            if (currentQuestion.type === "multiple") {
                value = [...card.querySelectorAll(`input[name="${CSS.escape(name)}"]:checked`)].map((input) => input.value);
            } else if (["single", "scale"].includes(currentQuestion.type)) {
                value = card.querySelector(`input[type="radio"][name="${CSS.escape(name)}"]:checked`)?.value ?? "";
            } else if (currentQuestion.type.startsWith("matrix_")) {
                value = {};
                (currentQuestion.rows || []).forEach((row, rowIndex) => {
                    const rowName = `${name}_${rowIndex}`;
                    const selector = currentQuestion.type === "matrix_single"
                        ? `input[name="${CSS.escape(rowName)}"]:checked`
                        : `input[name^="${CSS.escape(`${rowName}_`)}"]:checked`;
                    const checked = [...card.querySelectorAll(selector)].map((input) => input.value);
                    const rowId = axisItemId(currentQuestion, "rows", rowIndex);
                    if (checked.length) value[rowId] = currentQuestion.type === "matrix_single" ? checked[0] : checked;
                });
            } else if (["table", "repeat_table"].includes(currentQuestion.type)) {
                value = [...card.querySelectorAll("[data-repeat-row]")].map((row) => [...row.querySelectorAll("input")].map((input) => input.value));
            } else {
                const input = card.querySelector(`[name="${CSS.escape(name)}"]`);
                value = input?.value ?? "";
            }
            result[id] = hasValue(value) ? value : "";
        });
        state.answers = result;
    }

    function scheduleDraft() {
        clearTimeout(state.saveTimer);
        dom.saveState.textContent = "임시 저장 중…";
        state.saveTimer = setTimeout(() => {
            try {
                sessionStorage.setItem(`surveyone:draft:${state.slug}`, JSON.stringify(state.answers));
                dom.saveState.textContent = "이 탭에 임시 저장했습니다.";
            } catch {
                dom.saveState.textContent = "임시 저장을 사용할 수 없습니다.";
            }
        }, 300);
    }

    function restoreDraft() {
        try {
            state.answers = JSON.parse(sessionStorage.getItem(`surveyone:draft:${state.slug}`) || "{}");
        } catch {
            state.answers = {};
        }
    }

    function populateDraft() {
        Object.entries(state.answers).forEach(([id, value]) => {
            const card = dom.list.querySelector(`[data-question-id="${CSS.escape(id)}"]`);
            const currentQuestion = question(id);
            if (!card || value == null || !currentQuestion) return;
            const name = `q_${id}`;
            if (Array.isArray(value) && currentQuestion.type === "multiple") {
                value.forEach((item) => {
                    const input = card.querySelector(`input[name="${CSS.escape(name)}"][value="${CSS.escape(String(item))}"]`);
                    if (input) input.checked = true;
                });
            } else if (Array.isArray(value) && currentQuestion.type === "table") {
                value.forEach((row, rowIndex) => {
                    (Array.isArray(row) ? row : []).forEach((cell, columnIndex) => {
                        const input = card.querySelector(`[name="${CSS.escape(name)}_${rowIndex}_${columnIndex}"]`);
                        if (input) input.value = cell ?? "";
                    });
                });
            } else if (Array.isArray(value) && currentQuestion.type === "repeat_table") {
                const sourceColumns = currentQuestion.columns?.length ? currentQuestion.columns : ["항목", "내용"];
                const columns = sourceColumns.map((column, index) => localizedIndexedLabel(currentQuestion, "columns", index));
                const rowsHost = card.querySelector("[data-repeat-rows]");
                const description = card.querySelector(".question-help")?.id;
                const error = card.querySelector(".question-error")?.id;
                const aria = `aria-labelledby="${card.querySelector("h2").id}" aria-describedby="${[description, error].filter(Boolean).join(" ")}"`;
                const rows = value.length ? value : [columns.map(() => "")];
                rowsHost.innerHTML = rows.map((row, rowIndex) => repeatRow(columns, name, rowIndex, aria)).join("");
                rows.forEach((row, rowIndex) => {
                    (Array.isArray(row) ? row : []).forEach((cell, columnIndex) => {
                        const input = rowsHost.querySelector(`[name="${CSS.escape(name)}_${rowIndex}_${columnIndex}"]`);
                        if (input) input.value = cell ?? "";
                    });
                });
            } else if (currentQuestion.type.startsWith("matrix_") && typeof value === "object") {
                Object.entries(value).forEach(([rowKey, selected]) => {
                    const stableRowIndex = (currentQuestion.rows || []).findIndex((row, index) => axisItemId(currentQuestion, "rows", index) === String(rowKey));
                    const rowIndex = stableRowIndex >= 0 ? stableRowIndex : Number(rowKey);
                    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= (currentQuestion.rows || []).length) return;
                    const selectedValues = Array.isArray(selected) ? selected : [selected];
                    selectedValues.forEach((columnKey) => {
                        const stableColumnIndex = (currentQuestion.columns || []).findIndex((column, index) => axisItemId(currentQuestion, "columns", index) === String(columnKey));
                        const columnIndex = stableColumnIndex >= 0 ? stableColumnIndex : Number(columnKey);
                        if (!Number.isInteger(columnIndex) || columnIndex < 0 || columnIndex >= (currentQuestion.columns || []).length) return;
                        const columnId = axisItemId(currentQuestion, "columns", columnIndex);
                        const rowName = `${name}_${rowIndex}`;
                        const selector = currentQuestion.type === "matrix_single"
                            ? `input[name="${CSS.escape(rowName)}"][value="${CSS.escape(columnId)}"]`
                            : `input[name^="${CSS.escape(`${rowName}_`)}"][value="${CSS.escape(columnId)}"]`;
                        const input = card.querySelector(selector);
                        if (input) input.checked = true;
                    });
                });
            } else if (typeof value !== "object") {
                const radio = card.querySelector(`input[name="${CSS.escape(name)}"][value="${CSS.escape(String(value))}"]`);
                const input = radio || card.querySelector(`[name="${CSS.escape(name)}"]`);
                if (input) {
                    if (radio) radio.checked = true;
                    else input.value = value;
                    if (input.matches("[data-slider]")) input.dispatchEvent(new Event("input", { bubbles: false }));
                }
            }
        });
    }

    function hasValue(value) {
        if (Array.isArray(value)) return value.some((item) => Array.isArray(item) ? item.some(Boolean) : Boolean(item));
        if (value && typeof value === "object") return Object.values(value).some(hasValue);
        return String(value ?? "").trim() !== "";
    }

    function validate() {
        collectAnswers();
        applyLogic();
        const errors = [];
        dom.list.querySelectorAll("[data-question-id]").forEach((card) => {
            const currentQuestion = question(card.dataset.questionId);
            const errorElement = card.querySelector(".question-error");
            const visible = !card.closest("[data-section-id]").hidden;
            let message = "";
            if (visible && currentQuestion.required && !hasValue(state.answers[currentQuestion.id])) message = "필수 문항에 응답해 주세요.";
            if (visible && !message && currentQuestion.validation?.type === "email" && hasValue(state.answers[currentQuestion.id]) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.answers[currentQuestion.id])) message = "이메일 형식으로 입력해 주세요.";
            setQuestionError(card, message);
            if (message) errors.push({ number: card.dataset.questionNumber, title: localizedQuestionField(currentQuestion, "title"), card });
            if (!visible) errorElement.hidden = true;
        });
        renderValidationSummary();
        if (errors.length) {
            const first = errors[0].card;
            first.scrollIntoView({ behavior: "smooth", block: "center" });
            (first.querySelector("input,select,textarea,button") || first).focus({ preventScroll: true });
        }
        return !errors.length;
    }

    function setQuestionError(card, message) {
        if (!card) return;
        const errorElement = card.querySelector(".question-error");
        card.classList.toggle("has-error", Boolean(message));
        errorElement.hidden = !message;
        errorElement.textContent = message;
        card.querySelectorAll("input,select,textarea").forEach((control) => {
            if (message) control.setAttribute("aria-invalid", "true");
            else control.removeAttribute("aria-invalid");
        });
    }

    function clearQuestionError(card) {
        if (card?.classList.contains("has-error")) setQuestionError(card, "");
    }

    function renderValidationSummary() {
        const errors = [...dom.list.querySelectorAll("[data-question-id].has-error")].map((card) => ({
            card,
            number: card.dataset.questionNumber,
            title: localizedQuestionField(question(card.dataset.questionId), "title") || "문항"
        }));
        dom.summary.querySelector("strong").textContent = "확인이 필요한 문항이 있습니다.";
        dom.summary.querySelector("ul").innerHTML = errors.map((error) => `<li><a href="#${error.card.id}">${error.number}번 ${Common.escapeHtml(error.title)}</a></li>`).join("");
        dom.summary.hidden = !errors.length;
    }

    function applyLogic() {
        const rules = Array.isArray(state.survey.logicRules) ? state.survey.logicRules : [];
        const visibleIds = new Set();
        if (!rules.length) state.sections.forEach((section) => visibleIds.add(String(section.id)));
        else {
            const sectionByQuestion = new Map();
            state.sections.forEach((section, sectionIndex) => section.questions.forEach((item) => sectionByQuestion.set(String(item.id), sectionIndex)));
            const visited = new Set();
            let index = 0;
            while (index >= 0 && index < state.sections.length && !visited.has(index)) {
                visited.add(index);
                const section = state.sections[index];
                visibleIds.add(String(section.id));
                const matchingRule = rules.find((rule) => {
                    const sourceId = String(rule.sourceQuestionId || rule.questionId || "");
                    return sectionByQuestion.get(sourceId) === index && ruleMatches(rule, state.answers[sourceId]);
                });
                if (!matchingRule) {
                    index += 1;
                    continue;
                }
                const destination = String(matchingRule.targetSectionId || matchingRule.destinationSectionId || matchingRule.gotoSectionId || matchingRule.destination || "next");
                if (["complete", "submit", "end"].includes(destination)) break;
                if (destination === "next") {
                    index += 1;
                    continue;
                }
                const targetIndex = state.sections.findIndex((item) => String(item.id) === destination);
                index = targetIndex >= 0 ? targetIndex : index + 1;
            }
        }
        dom.list.querySelectorAll("[data-section-id]").forEach((section) => {
            const hidden = !visibleIds.has(String(section.dataset.sectionId));
            section.hidden = hidden;
            section.setAttribute("aria-hidden", String(hidden));
            if (hidden) section.querySelectorAll("[data-question-id]").forEach((card) => setQuestionError(card, ""));
        });
    }

    function ruleMatches(rule, answer) {
        if (!hasValue(answer)) return false;
        const expected = String(rule.value ?? rule.optionId ?? rule.equals ?? "");
        if (!expected) return false;
        const values = Array.isArray(answer) ? answer.map(String) : [String(answer)];
        if (rule.operator === "notEquals" || rule.operator === "not_equals") return !values.includes(expected);
        if (rule.operator === "contains") return values.some((value) => value.includes(expected));
        return values.includes(expected);
    }

    async function submit(event) {
        event.preventDefault();
        if (!validate()) return;
        const button = dom.form.querySelector('button[type="submit"]');
        button.disabled = true;
        button.textContent = "제출 중…";
        const oneResponse = setting("oneResponsePerRespondent", "oneResponse", false);
        const visibleQuestionIds = new Set(
            [...dom.list.querySelectorAll("[data-section-id]:not([hidden]) [data-question-id]")]
                .map((card) => String(card.dataset.questionId))
        );
        const visibleAnswers = Object.fromEntries(
            Object.entries(state.answers).filter(([questionId]) => visibleQuestionIds.has(String(questionId)))
        );
        state.idempotencyKey ||= `submission_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
        try {
            await Common.api.post(`/api/public/surveys/${encodeURIComponent(state.slug)}/responses`, {
                answers: visibleAnswers,
                respondentKey: oneResponse ? respondentKey() : undefined,
                client: { language: state.locale, viewport: `${innerWidth}x${innerHeight}` }
            }, { headers: { "Idempotency-Key": state.idempotencyKey } });
            sessionStorage.removeItem(`surveyone:draft:${state.slug}`);
            dom.form.hidden = true;
            showState("✓", "응답을 제출했습니다.", localizedSurveyField("confirmationMessage") || "소중한 의견을 보내주셔서 감사합니다.");
        } catch (error) {
            button.disabled = false;
            button.textContent = "응답 제출하기";
            dom.summary.hidden = false;
            dom.summary.querySelector("strong").textContent = "응답을 제출하지 못했습니다.";
            dom.summary.querySelector("ul").innerHTML = `<li>${Common.escapeHtml(error.message)}</li>`;
            dom.summary.setAttribute("tabindex", "-1");
            dom.summary.focus();
        }
    }

    function respondentKey() {
        if (state.respondentKey) return state.respondentKey;
        const storageKey = `surveyone:respondent:${state.slug}`;
        try {
            const existing = localStorage.getItem(storageKey);
            if (existing) return (state.respondentKey = existing);
            const value = createBrowserKey();
            localStorage.setItem(storageKey, value);
            return (state.respondentKey = value);
        } catch {
            return (state.respondentKey = createBrowserKey());
        }
    }

    function createBrowserKey() {
        if (globalThis.crypto?.randomUUID) return `browser_${globalThis.crypto.randomUUID()}`;
        const bytes = new Uint8Array(16);
        globalThis.crypto?.getRandomValues?.(bytes);
        const randomPart = bytes.some(Boolean) ? [...bytes].map((item) => item.toString(16).padStart(2, "0")).join("") : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
        return `browser_${randomPart}`;
    }

    function setting(canonicalName, compatibilityName, fallback) {
        const settings = state.survey.settings || {};
        return settings[canonicalName] ?? settings[compatibilityName] ?? fallback;
    }

    function updateProgress() {
        if (!state.survey) return;
        const visibleQuestions = [...dom.list.querySelectorAll("[data-section-id]:not([hidden]) [data-question-id]")].map((card) => question(card.dataset.questionId));
        const answered = visibleQuestions.filter((item) => hasValue(state.answers[item.id])).length;
        dom.progress.style.width = `${visibleQuestions.length ? Math.round(answered / visibleQuestions.length * 100) : 0}%`;
    }

    function domToken(id, index) {
        return `${index + 1}-${String(id).replace(/[^A-Za-z0-9_-]/g, "_")}`;
    }

    function showState(icon, title, message) {
        dom.loading.hidden = true;
        dom.form.hidden = true;
        dom.state.hidden = false;
        dom.state.innerHTML = `<span class="public-state-icon">${Common.escapeHtml(icon)}</span><h1>${Common.escapeHtml(title)}</h1><p>${Common.escapeHtml(message)}</p><a href="/">IN-SURVEYONE 홈</a>`;
    }
})();
