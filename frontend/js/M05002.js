(function () {
    "use strict";

    const PAGE_CODE = "M05002";
    const STORAGE_KEY_PREFIX = "inSurveyOne.reportDrafts.v1";
    const WIDTHS = [4, 6, 8, 12];
    const WIDGETS = [
        { type: "kpis", title: "응답 핵심 지표", description: "응답 수, 완료율과 응답 시간을 요약합니다.", icon: "Σ", span: 12 },
        { type: "completion", title: "완료 현황", description: "완료·진행 중 응답의 비중을 비교합니다.", icon: "%", span: 6 },
        { type: "questions", title: "문항 응답 분포", description: "대표 선택형 문항의 보기별 비율을 표시합니다.", icon: "▥", span: 6 },
        { type: "question-table", title: "문항 요약표", description: "문항별 유형과 응답 건수를 표로 제공합니다.", icon: "表", span: 12 },
        { type: "trend", title: "응답 추이", description: "일자별 응답 수집 흐름을 확인합니다.", icon: "↗", span: 6 },
        { type: "survey-info", title: "설문 기준 정보", description: "설문 상태와 보고서 생성 기준을 기록합니다.", icon: "i", span: 6 }
    ];
    const WIDGET_BY_TYPE = new Map(WIDGETS.map((widget) => [widget.type, widget]));

    const state = {
        root: null,
        api: null,
        toast: null,
        navigate: null,
        confirmMessage: null,
        events: null,
        requestVersion: 0,
        initialSurveyId: "",
        surveys: [],
        report: null,
        items: [],
        drafts: [],
        activeDraftId: "",
        selectedSurveyId: "",
        paperSize: "A4",
        orientation: "PORTRAIT",
        templateName: "새 맞춤형 보고서",
        dirty: false,
        storageKey: "",
        elements: {}
    };

    function read(source, keys, fallback = "") {
        if (!source || typeof source !== "object") return fallback;
        for (const key of keys) {
            const value = source[key];
            if (value !== undefined && value !== null && value !== "") return value;
        }
        return fallback;
    }

    function scopedStorageKey(actor) {
        const tenantId = String(read(actor, ["tenantId", "tenant_id", "organizationId", "organization_id"], "")).trim();
        const userId = String(read(actor, ["id", "userId", "user_id", "loginId", "login_id"], "")).trim();
        if (!tenantId && !userId) return `${STORAGE_KEY_PREFIX}:anonymous`;
        const tenantScope = encodeURIComponent(tenantId || "no-tenant");
        const userScope = encodeURIComponent(userId || "no-user");
        return `${STORAGE_KEY_PREFIX}:${tenantScope}:${userScope}`;
    }

    function unwrapEnvelope(response) {
        let value = response;
        for (let index = 0; index < 3; index += 1) {
            if (!value || Array.isArray(value) || typeof value !== "object") break;
            const keys = Object.keys(value);
            const isEnvelope = Object.prototype.hasOwnProperty.call(value, "data") && (
                Object.prototype.hasOwnProperty.call(value, "status")
                || Object.prototype.hasOwnProperty.call(value, "success")
                || Object.prototype.hasOwnProperty.call(value, "headers")
                || keys.length <= 3
            );
            if (!isEnvelope) break;
            value = value.data;
        }
        return value;
    }

    function asList(value, keys = []) {
        if (Array.isArray(value)) return value;
        if (!value || typeof value !== "object") return [];
        for (const key of keys) {
            if (Array.isArray(value[key])) return value[key];
        }
        return [];
    }

    function numberValue(value, fallback = 0) {
        const normalized = typeof value === "string" ? value.replace(/,/g, "").trim() : value;
        const number = Number(normalized);
        return Number.isFinite(number) ? number : fallback;
    }

    function formatNumber(value, maximumFractionDigits = 1) {
        return numberValue(value).toLocaleString("ko-KR", { maximumFractionDigits });
    }

    function formatDate(value, includeTime = false) {
        if (!value) return "";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return new Intl.DateTimeFormat("ko-KR", includeTime ? {
            year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
        } : {
            year: "numeric", month: "2-digit", day: "2-digit"
        }).format(date);
    }

    function clampPercent(value) {
        return Math.max(0, Math.min(100, numberValue(value)));
    }

    function surveyId(survey) {
        return String(read(survey, ["id", "surveyId", "survey_id", "SURVEY_ID", "projectId", "PROJECT_ID"], ""));
    }

    function surveyTitle(survey) {
        return String(read(survey, ["title", "name", "surveyTitle", "survey_title", "SURVEY_TITLE", "projectName", "PROJECT_NAME"], "제목 없는 설문"));
    }

    function surveyStatus(survey) {
        const raw = String(read(survey, ["status", "surveyStatus", "survey_status", "SURVEY_STATUS"], "")).toUpperCase();
        return ({ DRAFT: "작성 중", READY: "배포 대기", PUBLISHED: "진행 중", ACTIVE: "진행 중", CLOSED: "종료", ENDED: "종료" })[raw] || raw || "상태 미정";
    }

    function selectedSurvey() {
        return state.surveys.find((survey) => surveyId(survey) === String(state.selectedSurveyId)) || null;
    }

    function notify(message, type = "info") {
        const toast = state.toast;
        if (typeof toast === "function") {
            toast(message, type);
            return;
        }
        if (toast && typeof toast[type] === "function") {
            toast[type](message);
            return;
        }
        if (toast && typeof toast.show === "function") {
            toast.show(message, { type });
            return;
        }
        if (type === "error") console.error(`[${PAGE_CODE}] ${message}`);
    }

    function setStatus(message, type = "") {
        const element = state.elements.status;
        if (!element) return;
        element.textContent = message;
        element.classList.toggle("is-success", type === "success");
        element.classList.toggle("is-error", type === "error");
    }

    function errorMessage(error) {
        return String(error?.detail || error?.message || "잠시 후 다시 시도해 주세요.");
    }

    function createId(prefix = "draft") {
        if (window.crypto && typeof window.crypto.randomUUID === "function") return `${prefix}-${window.crypto.randomUUID()}`;
        return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }

    function pageElement(root) {
        if (root?.matches?.('[data-page="M05002"]')) return root;
        return root?.querySelector?.('[data-page="M05002"]') || root;
    }

    function cacheElements() {
        const root = state.root;
        const find = (role) => root.querySelector(`[data-role="${role}"]`);
        state.elements = {
            surveySelect: find("survey-select"),
            templateName: find("template-name"),
            paperSize: find("paper-size"),
            draftSelect: find("draft-select"),
            deleteDraft: find("delete-draft"),
            reportBasis: find("report-basis"),
            loading: find("loading-state"),
            error: find("error-state"),
            errorMessage: find("error-message"),
            empty: find("empty-state"),
            workbench: find("workbench"),
            widgetPalette: find("widget-palette"),
            widgetCount: find("widget-count"),
            layout: find("layout"),
            layoutEmpty: find("layout-empty"),
            layoutSummary: find("layout-summary"),
            paper: find("report-paper"),
            previewTitle: find("preview-title"),
            previewSurvey: find("preview-survey"),
            status: find("status"),
            retry: find("retry")
        };
    }

    function bindEvents() {
        const signal = state.events.signal;
        const root = state.root;
        state.elements.surveySelect?.addEventListener("change", () => {
            state.selectedSurveyId = state.elements.surveySelect.value;
            markDirty("설문 기준이 변경되었습니다.");
            loadReport();
        }, { signal });
        state.elements.templateName?.addEventListener("input", () => {
            state.templateName = state.elements.templateName.value;
            state.elements.previewTitle.textContent = state.templateName.trim() || "제목 없는 맞춤형 보고서";
            markDirty("템플릿 이름이 변경되었습니다.");
        }, { signal });
        state.elements.paperSize?.addEventListener("change", () => {
            state.paperSize = state.elements.paperSize.value === "A3" ? "A3" : "A4";
            updatePaperAppearance();
            markDirty("용지 설정이 변경되었습니다.");
        }, { signal });
        root.querySelectorAll('input[name="m05002-orientation"]').forEach((input) => {
            input.addEventListener("change", () => {
                if (!input.checked) return;
                state.orientation = input.value === "LANDSCAPE" ? "LANDSCAPE" : "PORTRAIT";
                updatePaperAppearance();
                markDirty("용지 방향이 변경되었습니다.");
            }, { signal });
        });
        state.elements.widgetPalette?.addEventListener("click", (event) => {
            const button = event.target.closest?.("[data-add-widget]");
            if (button) addWidget(button.dataset.addWidget);
        }, { signal });
        state.elements.layout?.addEventListener("click", (event) => {
            const button = event.target.closest?.("[data-action][data-item-id]");
            if (button) handleLayoutAction(button.dataset.itemId, button.dataset.action);
        }, { signal });
        root.querySelector('[data-role="save-draft"]')?.addEventListener("click", saveDraft, { signal });
        root.querySelector('[data-role="new-draft"]')?.addEventListener("click", () => resetEditor({ keepSurvey: true }), { signal });
        state.elements.deleteDraft?.addEventListener("click", deleteDraft, { signal });
        state.elements.draftSelect?.addEventListener("change", () => loadDraft(state.elements.draftSelect.value), { signal });
        state.elements.retry?.addEventListener("click", () => {
            if (state.surveys.length) loadReport();
            else loadSurveys();
        }, { signal });
        root.querySelector('[data-role="print-demo"]')?.addEventListener("click", () => {
            if (!state.items.length) {
                notify("인쇄할 위젯을 먼저 추가해 주세요.", "error");
                return;
            }
            notify("인쇄 미리보기는 Demo 기능이며 브라우저 인쇄 설정을 사용합니다.", "info");
            if (typeof window.print === "function") window.print();
        }, { signal });
    }

    function setView(view) {
        state.elements.loading.hidden = view !== "loading";
        state.elements.error.hidden = view !== "error";
        state.elements.empty.hidden = view !== "empty";
        state.elements.workbench.hidden = view !== "workbench";
    }

    function populateSurveyOptions(preferredId = state.selectedSurveyId) {
        const select = state.elements.surveySelect;
        select.replaceChildren();
        if (!state.surveys.length) {
            select.append(new Option("선택할 수 있는 설문이 없습니다", ""));
            select.disabled = true;
            return;
        }
        select.disabled = false;
        select.append(new Option("설문 프로젝트를 선택하세요", ""));
        state.surveys.forEach((survey) => {
            const id = surveyId(survey);
            if (!id) return;
            select.append(new Option(`${surveyTitle(survey)} · ${surveyStatus(survey)}`, id));
        });
        const available = Array.from(select.options).some((option) => option.value === String(preferredId));
        select.value = available ? String(preferredId) : (select.options[1]?.value || "");
        state.selectedSurveyId = select.value;
    }

    async function loadSurveys() {
        const version = ++state.requestVersion;
        setView("loading");
        try {
            const response = await state.api.get("/api/surveys");
            if (version !== state.requestVersion || !state.root) return;
            const payload = unwrapEnvelope(response);
            state.surveys = asList(payload, ["surveys", "items", "rows", "results"]);
            populateSurveyOptions(state.initialSurveyId || state.selectedSurveyId);
            if (!state.surveys.length) {
                state.elements.reportBasis.textContent = "맞춤형 보고서에 사용할 설문이 없습니다.";
                setView("empty");
                return;
            }
            await loadReport();
        } catch (error) {
            if (version !== state.requestVersion || !state.root) return;
            state.surveys = [];
            populateSurveyOptions();
            state.elements.errorMessage.textContent = errorMessage(error);
            setView("error");
        }
    }

    async function loadReport() {
        const id = String(state.selectedSurveyId || state.elements.surveySelect?.value || "");
        if (!id) {
            state.report = null;
            state.elements.reportBasis.textContent = "설문을 선택해 주세요.";
            state.elements.previewSurvey.textContent = "설문을 선택해 주세요.";
            renderLayout();
            setView("workbench");
            return;
        }
        const version = ++state.requestVersion;
        setView("loading");
        try {
            const response = await state.api.get(`/api/surveys/${encodeURIComponent(id)}/report`);
            if (version !== state.requestVersion || !state.root) return;
            const payload = unwrapEnvelope(response);
            state.report = payload && typeof payload === "object" ? payload : {};
            const survey = selectedSurvey();
            const generatedAt = read(reportRoot(state.report), ["generatedAt", "updatedAt", "generated_at", "UPDATED_AT"], new Date().toISOString());
            state.elements.reportBasis.textContent = `${survey ? surveyTitle(survey) : "선택 설문"} · ${formatDate(generatedAt, true)} 기준`;
            state.elements.previewSurvey.textContent = survey ? `${surveyTitle(survey)} · ${surveyStatus(survey)}` : "선택 설문";
            renderLayout();
            setView("workbench");
        } catch (error) {
            if (version !== state.requestVersion || !state.root) return;
            state.report = null;
            state.elements.errorMessage.textContent = errorMessage(error);
            setView("error");
        }
    }

    function reportRoot(report) {
        const nested = read(report, ["report", "result", "summaryReport"], null);
        return nested && typeof nested === "object" ? { ...report, ...nested } : (report || {});
    }

    function totalResponses(report) {
        const source = reportRoot(report);
        const summary = read(source, ["summary", "overview", "totals"], {});
        const explicit = read(summary, ["totalResponses", "responseCount", "total", "TOTAL_RESPONSES", "RESPONSE_COUNT"], null);
        if (explicit !== null) return numberValue(explicit);
        const direct = read(source, ["totalResponses", "responseCount", "responsesCount", "TOTAL_RESPONSES", "RESPONSE_COUNT"], null);
        if (direct !== null) return numberValue(direct);
        return asList(read(source, ["responses", "rawResponses"], []), ["items", "rows"]).length;
    }

    function completionMetrics(report) {
        const source = reportRoot(report);
        const summary = read(source, ["summary", "overview", "totals"], {});
        const total = totalResponses(source);
        const completedRaw = read(summary, ["completedResponses", "completeCount", "completed", "COMPLETED_RESPONSES"], read(source, ["completedResponses", "completeCount"], null));
        const partialRaw = read(summary, ["partialResponses", "partialCount", "inProgress", "PARTIAL_RESPONSES"], read(source, ["partialResponses", "partialCount", "inProgress"], null));
        const completed = completedRaw === null
            ? (partialRaw === null ? total : Math.max(0, total - numberValue(partialRaw)))
            : numberValue(completedRaw);
        const partial = partialRaw === null ? Math.max(0, total - completed) : numberValue(partialRaw);
        let rate = numberValue(read(summary, ["completionRate", "completeRate", "COMPLETION_RATE"], total ? completed / total : 0));
        if (rate > 1) rate /= 100;
        return { total, completed, partial, rate };
    }

    function deriveKpis(report) {
        const source = reportRoot(report);
        const explicit = asList(read(source, ["kpis", "metrics", "keyMetrics"], []), ["items", "rows"]);
        if (explicit.length) return explicit.slice(0, 4).map((item, index) => ({
            label: String(read(item, ["label", "name", "title", "metric"], `지표 ${index + 1}`)),
            value: read(item, ["value", "count", "metricValue"], 0),
            unit: String(read(item, ["unit", "format"], ""))
        }));
        const summary = read(source, ["summary", "overview", "totals"], {});
        const { total, completed, rate } = completionMetrics(source);
        const seconds = numberValue(read(summary, ["averageDurationSeconds", "avgDurationSeconds", "averageSeconds"], 0));
        return [
            { label: "총 응답", value: total, unit: "count" },
            { label: "완료 응답", value: completed, unit: "count" },
            { label: "완료율", value: rate, unit: "rate" },
            { label: "평균 응답 시간", value: seconds >= 60 ? `${Math.floor(seconds / 60)}분 ${Math.round(seconds % 60)}초` : `${Math.round(seconds)}초`, unit: "text" }
        ];
    }

    function displayKpi(kpi) {
        const unit = String(kpi.unit || "").toLowerCase();
        if (unit.includes("rate") || unit.includes("percent") || unit === "%") {
            let value = numberValue(kpi.value);
            if (Math.abs(value) <= 1) value *= 100;
            return `${formatNumber(value)}%`;
        }
        if (unit === "text") return String(kpi.value || "-");
        if (typeof kpi.value === "number" || /^-?[\d,.]+$/.test(String(kpi.value || ""))) return `${formatNumber(kpi.value)}건`;
        return String(kpi.value ?? "-");
    }

    function normalizeQuestionType(value) {
        const type = String(value || "").toUpperCase();
        return ({ SINGLE: "객관식", SINGLE_CHOICE: "객관식", RADIO: "객관식", MULTIPLE_CHOICE: "복수응답", CHECKBOX: "복수응답", MULTIPLE: "복수응답", MULTI: "복수응답", TEXT: "주관식", SHORT_TEXT: "단답형", LONG_TEXT: "장문형", NUMBER: "숫자", SCALE: "척도", LIKERT: "척도", MATRIX: "매트릭스", TABLE: "표", REPEAT_TABLE: "반복표" })[type] || (type ? type.replace(/_/g, " ") : "문항");
    }

    function normalizeChoices(question, responseCount) {
        const raw = read(question, ["options", "choices", "distribution", "answerDistribution", "answers", "values"], []);
        let choices = [];
        if (Array.isArray(raw)) {
            choices = raw.map((choice, index) => choice && typeof choice === "object" ? {
                label: String(read(choice, ["label", "text", "name", "option", "value"], `보기 ${index + 1}`)),
                count: numberValue(read(choice, ["count", "responses", "responseCount", "frequency"], 0)),
                percent: read(choice, ["percent", "percentage", "rate", "ratio"], null)
            } : { label: String(choice), count: 0, percent: null });
        } else if (raw && typeof raw === "object") {
            choices = Object.entries(raw).map(([label, value]) => ({
                label,
                count: numberValue(value && typeof value === "object" ? read(value, ["count", "frequency", "value"], 0) : value),
                percent: value && typeof value === "object" ? read(value, ["percent", "percentage", "rate"], null) : null
            }));
        }
        const sum = choices.reduce((total, choice) => total + choice.count, 0);
        const denominator = responseCount || sum;
        return choices.map((choice) => {
            let percent = choice.percent === null ? (denominator ? choice.count / denominator * 100 : 0) : numberValue(choice.percent);
            if (percent > 0 && percent <= 1) percent *= 100;
            return { ...choice, percent: clampPercent(percent) };
        });
    }

    function deriveQuestions(report) {
        const source = reportRoot(report);
        const raw = asList(read(source, ["questions", "questionStats", "questionReports", "questionSummaries", "items"], []), ["items", "rows"]);
        const total = totalResponses(source);
        return raw.map((question, index) => {
            const responseCount = numberValue(read(question, ["responseCount", "answeredCount", "count", "responses"], total));
            return {
                order: numberValue(read(question, ["order", "sequence", "questionNo", "number"], index + 1), index + 1),
                title: String(read(question, ["title", "text", "question", "label", "questionText"], `문항 ${index + 1}`)),
                type: normalizeQuestionType(read(question, ["type", "questionType", "question_type"], "")),
                responseCount,
                choices: normalizeChoices(question, responseCount)
            };
        }).sort((a, b) => a.order - b.order);
    }

    function deriveTrend(report) {
        const source = reportRoot(report);
        const raw = read(source, ["responseTrend", "trend", "dailyResponses", "timeline"], []);
        let rows = [];
        if (Array.isArray(raw)) rows = raw.map((item, index) => item && typeof item === "object" ? {
            label: String(read(item, ["label", "date", "day", "period"], index + 1)),
            count: numberValue(read(item, ["count", "responses", "value"], 0))
        } : { label: String(index + 1), count: numberValue(item) });
        else if (raw && typeof raw === "object") rows = Object.entries(raw).map(([label, value]) => ({ label, count: numberValue(value) }));
        if (!rows.length) {
            const responses = asList(read(source, ["responses", "rawResponses"], []), ["items", "rows"]);
            const counts = new Map();
            responses.forEach((response) => {
                const dateValue = read(response, ["submittedAt", "completedAt", "createdAt", "submitted_at", "CREATED_AT"], "");
                if (!dateValue) return;
                const key = String(dateValue).slice(0, 10);
                counts.set(key, (counts.get(key) || 0) + 1);
            });
            rows = Array.from(counts, ([label, count]) => ({ label, count })).sort((a, b) => a.label.localeCompare(b.label));
        }
        return rows.slice(-8);
    }

    function readDrafts() {
        try {
            const parsed = JSON.parse(window.localStorage.getItem(state.storageKey) || "[]");
            if (!Array.isArray(parsed)) return [];
            return parsed.slice(0, 20).map(sanitizeDraft).filter(Boolean);
        } catch (error) {
            console.warn(`[${PAGE_CODE}] 로컬 초안을 읽지 못했습니다.`, error);
            return [];
        }
    }

    function sanitizeDraft(raw) {
        if (!raw || typeof raw !== "object" || !raw.id) return null;
        const seen = new Set();
        const items = asList(raw.items).slice(0, WIDGETS.length).map((item) => {
            const type = String(item?.type || "");
            if (!WIDGET_BY_TYPE.has(type) || seen.has(type)) return null;
            seen.add(type);
            const requestedSpan = numberValue(item.span, WIDGET_BY_TYPE.get(type).span);
            const span = WIDTHS.reduce((best, current) => Math.abs(current - requestedSpan) < Math.abs(best - requestedSpan) ? current : best, 12);
            return { id: String(item.id || createId("widget")), type, span };
        }).filter(Boolean);
        return {
            id: String(raw.id),
            name: String(raw.name || "맞춤형 보고서").slice(0, 80),
            surveyId: String(raw.surveyId || ""),
            paperSize: raw.paperSize === "A3" ? "A3" : "A4",
            orientation: raw.orientation === "LANDSCAPE" ? "LANDSCAPE" : "PORTRAIT",
            items,
            updatedAt: String(raw.updatedAt || "")
        };
    }

    function writeDrafts() {
        window.localStorage.setItem(state.storageKey, JSON.stringify(state.drafts.slice(0, 20)));
    }

    function renderDraftOptions() {
        const select = state.elements.draftSelect;
        select.replaceChildren(new Option("저장된 초안 선택", ""));
        state.drafts.forEach((draft) => {
            const suffix = draft.updatedAt ? ` · ${formatDate(draft.updatedAt)}` : "";
            select.append(new Option(`${draft.name}${suffix}`, draft.id));
        });
        select.value = state.drafts.some((draft) => draft.id === state.activeDraftId) ? state.activeDraftId : "";
        state.elements.deleteDraft.disabled = !select.value;
    }

    function saveDraft() {
        state.templateName = state.elements.templateName.value.trim();
        if (!state.templateName) {
            setStatus("템플릿 이름을 입력해 주세요.", "error");
            state.elements.templateName.focus();
            return;
        }
        if (!state.items.length) {
            setStatus("저장할 결과 위젯을 한 개 이상 추가해 주세요.", "error");
            notify("저장할 결과 위젯을 한 개 이상 추가해 주세요.", "error");
            return;
        }
        const id = state.activeDraftId || createId();
        const draft = {
            id,
            name: state.templateName.slice(0, 80),
            surveyId: state.selectedSurveyId,
            paperSize: state.paperSize,
            orientation: state.orientation,
            items: state.items.map((item) => ({ id: item.id, type: item.type, span: item.span })),
            updatedAt: new Date().toISOString(),
            schemaVersion: 1
        };
        const index = state.drafts.findIndex((item) => item.id === id);
        if (index >= 0) state.drafts.splice(index, 1, draft);
        else state.drafts.unshift(draft);
        try {
            writeDrafts();
            state.activeDraftId = id;
            state.dirty = false;
            renderDraftOptions();
            setStatus("이 브라우저에 레이아웃 초안을 저장했습니다. 응답 데이터는 저장하지 않았습니다.", "success");
            notify("맞춤형 보고서 초안을 브라우저에 저장했습니다. (Beta)", "success");
        } catch (error) {
            setStatus("브라우저 저장소를 사용할 수 없어 초안을 저장하지 못했습니다.", "error");
            notify("브라우저 저장소를 사용할 수 없습니다.", "error");
        }
    }

    function loadDraft(id) {
        const draft = state.drafts.find((item) => item.id === String(id));
        if (!draft) {
            state.activeDraftId = "";
            state.elements.deleteDraft.disabled = true;
            return;
        }
        state.activeDraftId = draft.id;
        state.templateName = draft.name;
        state.paperSize = draft.paperSize;
        state.orientation = draft.orientation;
        state.items = draft.items.map((item) => ({ ...item }));
        state.selectedSurveyId = draft.surveyId || state.selectedSurveyId;
        state.elements.templateName.value = state.templateName;
        state.elements.paperSize.value = state.paperSize;
        const orientationInput = state.root.querySelector(`input[name="m05002-orientation"][value="${state.orientation}"]`);
        if (orientationInput) orientationInput.checked = true;
        populateSurveyOptions(state.selectedSurveyId);
        state.elements.previewTitle.textContent = state.templateName;
        state.dirty = false;
        updatePaperAppearance();
        renderDraftOptions();
        renderPalette();
        renderLayout();
        setStatus("저장된 로컬 초안을 불러왔습니다. 최신 응답 데이터로 다시 표시합니다.", "success");
        loadReport();
    }

    async function deleteDraft() {
        const id = state.activeDraftId || state.elements.draftSelect.value;
        const draft = state.drafts.find((item) => item.id === id);
        if (!draft) return;
        if (!(await state.confirmMessage(`'${draft.name}' 로컬 초안을 삭제할까요?`, {
            title: "맞춤형 보고서 초안 삭제",
            confirmLabel: "삭제",
            tone: "error",
            destructive: true
        }))) return;
        state.drafts = state.drafts.filter((item) => item.id !== id);
        try {
            writeDrafts();
        } catch (error) {
            notify("로컬 초안을 삭제하지 못했습니다.", "error");
            return;
        }
        resetEditor({ keepSurvey: true });
        notify("로컬 초안을 삭제했습니다.", "success");
    }

    function resetEditor({ keepSurvey = false } = {}) {
        state.activeDraftId = "";
        state.templateName = "새 맞춤형 보고서";
        state.paperSize = "A4";
        state.orientation = "PORTRAIT";
        state.items = [];
        state.dirty = false;
        if (!keepSurvey) state.selectedSurveyId = state.elements.surveySelect?.value || "";
        state.elements.templateName.value = state.templateName;
        state.elements.paperSize.value = state.paperSize;
        const portrait = state.root.querySelector('input[name="m05002-orientation"][value="PORTRAIT"]');
        if (portrait) portrait.checked = true;
        state.elements.previewTitle.textContent = state.templateName;
        updatePaperAppearance();
        renderDraftOptions();
        renderPalette();
        renderLayout();
        setStatus("새 레이아웃입니다. 결과 위젯을 추가해 주세요.");
    }

    function markDirty(message) {
        state.dirty = true;
        setStatus(`${message} 브라우저에 저장하려면 '브라우저에 저장'을 눌러 주세요.`);
    }

    function addWidget(type) {
        const definition = WIDGET_BY_TYPE.get(String(type));
        if (!definition || state.items.some((item) => item.type === definition.type)) return;
        state.items.push({ id: createId("widget"), type: definition.type, span: definition.span });
        renderPalette();
        renderLayout();
        markDirty(`${definition.title} 위젯을 추가했습니다.`);
    }

    function handleLayoutAction(itemId, action) {
        const index = state.items.findIndex((item) => item.id === String(itemId));
        if (index < 0) return;
        const item = state.items[index];
        if (action === "move-up" && index > 0) {
            state.items.splice(index - 1, 0, state.items.splice(index, 1)[0]);
        } else if (action === "move-down" && index < state.items.length - 1) {
            state.items.splice(index + 1, 0, state.items.splice(index, 1)[0]);
        } else if (action === "resize") {
            const widthIndex = WIDTHS.indexOf(item.span);
            item.span = WIDTHS[(widthIndex + 1) % WIDTHS.length];
        } else if (action === "remove") {
            state.items.splice(index, 1);
        } else {
            return;
        }
        renderPalette();
        renderLayout();
        markDirty("레이아웃 구성이 변경되었습니다.");
    }

    function renderPalette() {
        const palette = state.elements.widgetPalette;
        palette.replaceChildren();
        const used = new Set(state.items.map((item) => item.type));
        WIDGETS.forEach((widget) => {
            const card = document.createElement("article");
            card.className = `custom-report-palette-card${used.has(widget.type) ? " is-used" : ""}`;
            const icon = document.createElement("span");
            icon.className = "custom-report-widget-icon";
            icon.textContent = widget.icon;
            icon.setAttribute("aria-hidden", "true");
            const copy = document.createElement("div");
            copy.className = "custom-report-widget-copy";
            const title = document.createElement("strong");
            title.textContent = widget.title;
            const description = document.createElement("span");
            description.textContent = widget.description;
            copy.append(title, description);
            const button = document.createElement("button");
            button.type = "button";
            button.className = "custom-report-add-button";
            button.dataset.addWidget = widget.type;
            button.disabled = used.has(widget.type);
            button.textContent = used.has(widget.type) ? "✓" : "+";
            button.setAttribute("aria-label", used.has(widget.type) ? `${widget.title} 위젯이 이미 추가됨` : `${widget.title} 위젯 추가`);
            card.append(icon, copy, button);
            palette.append(card);
        });
        state.elements.widgetCount.textContent = `${used.size} / ${WIDGETS.length}`;
    }

    function controlButton(item, action, label, text, disabled = false) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.itemId = item.id;
        button.dataset.action = action;
        button.setAttribute("aria-label", label);
        button.title = label;
        button.textContent = text;
        button.disabled = disabled;
        return button;
    }

    function emptyWidget(message) {
        const empty = document.createElement("div");
        empty.className = "custom-preview-empty";
        empty.textContent = message;
        return empty;
    }

    function previewBar(labelText, percent, valueText) {
        const row = document.createElement("div");
        row.className = "custom-preview-bar";
        row.setAttribute("role", "img");
        row.setAttribute("aria-label", `${labelText}: ${valueText}`);
        const label = document.createElement("span");
        label.textContent = labelText;
        label.title = labelText;
        const track = document.createElement("span");
        track.className = "custom-preview-track";
        track.setAttribute("aria-hidden", "true");
        const fill = document.createElement("span");
        fill.className = "custom-preview-fill";
        fill.style.setProperty("--bar-size", `${clampPercent(percent)}%`);
        track.append(fill);
        const value = document.createElement("strong");
        value.textContent = valueText;
        row.append(label, track, value);
        return row;
    }

    function renderKpiWidget() {
        const wrapper = document.createElement("div");
        wrapper.className = "custom-preview-kpis";
        deriveKpis(state.report).forEach((kpi) => {
            const card = document.createElement("div");
            card.className = "custom-preview-kpi";
            const label = document.createElement("span");
            label.textContent = kpi.label;
            const value = document.createElement("strong");
            value.textContent = displayKpi(kpi);
            card.append(label, value);
            wrapper.append(card);
        });
        return wrapper;
    }

    function renderCompletionWidget() {
        const { total, completed, partial } = completionMetrics(state.report);
        if (!total) return emptyWidget("아직 수집된 응답이 없습니다.");
        const wrapper = document.createElement("div");
        wrapper.className = "custom-preview-bars";
        wrapper.append(
            previewBar("완료", completed / total * 100, `${formatNumber(completed, 0)}건`),
            previewBar("진행 중", partial / total * 100, `${formatNumber(partial, 0)}건`)
        );
        return wrapper;
    }

    function renderQuestionWidget() {
        const question = deriveQuestions(state.report).find((item) => item.choices.length);
        if (!question) return emptyWidget("집계 가능한 선택형 문항이 없습니다.");
        const wrapper = document.createElement("div");
        const heading = document.createElement("p");
        heading.className = "custom-preview-summary";
        const strong = document.createElement("strong");
        strong.textContent = `${question.order}. ${question.title}`;
        heading.append(strong);
        const bars = document.createElement("div");
        bars.className = "custom-preview-bars";
        question.choices.slice(0, 5).forEach((choice) => {
            bars.append(previewBar(choice.label, choice.percent, `${formatNumber(choice.percent)}%`));
        });
        wrapper.append(heading, bars);
        return wrapper;
    }

    function renderQuestionTableWidget() {
        const questions = deriveQuestions(state.report).slice(0, 6);
        if (!questions.length) return emptyWidget("표시할 문항 집계가 없습니다.");
        const wrap = document.createElement("div");
        wrap.className = "custom-preview-table-wrap";
        const table = document.createElement("table");
        table.className = "custom-preview-table";
        const thead = document.createElement("thead");
        const header = document.createElement("tr");
        ["번호", "문항", "유형", "응답"].forEach((text) => {
            const th = document.createElement("th");
            th.scope = "col";
            th.textContent = text;
            header.append(th);
        });
        thead.append(header);
        const tbody = document.createElement("tbody");
        questions.forEach((question) => {
            const row = document.createElement("tr");
            [question.order, question.title, question.type, `${formatNumber(question.responseCount, 0)}건`].forEach((value) => {
                const cell = document.createElement("td");
                cell.textContent = String(value);
                row.append(cell);
            });
            tbody.append(row);
        });
        table.append(thead, tbody);
        wrap.append(table);
        return wrap;
    }

    function renderTrendWidget() {
        const rows = deriveTrend(state.report);
        if (!rows.length) return emptyWidget("표시할 일자별 응답 추이가 없습니다.");
        const maximum = Math.max(...rows.map((row) => row.count), 1);
        const wrapper = document.createElement("div");
        wrapper.className = "custom-preview-bars";
        rows.forEach((row) => {
            const label = /^\d{4}-\d{2}-\d{2}/.test(row.label) ? row.label.slice(5) : row.label;
            wrapper.append(previewBar(label, row.count / maximum * 100, `${formatNumber(row.count, 0)}건`));
        });
        return wrapper;
    }

    function renderSurveyInfoWidget() {
        const survey = selectedSurvey();
        const source = reportRoot(state.report);
        const questions = deriveQuestions(source);
        const generatedAt = read(source, ["generatedAt", "updatedAt", "generated_at", "UPDATED_AT"], new Date().toISOString());
        const wrapper = document.createElement("div");
        wrapper.className = "custom-preview-summary";
        [
            ["설문", survey ? surveyTitle(survey) : "선택 없음"],
            ["상태", survey ? surveyStatus(survey) : "-"],
            ["문항", `${formatNumber(questions.length, 0)}개`],
            ["보고서 기준", formatDate(generatedAt, true)]
        ].forEach(([label, value]) => {
            const row = document.createElement("span");
            const strong = document.createElement("strong");
            strong.textContent = `${label}: `;
            row.append(strong, document.createTextNode(value));
            wrapper.append(row);
        });
        return wrapper;
    }

    function renderWidget(type) {
        if (!state.report) return emptyWidget("설문 보고서 데이터를 불러오면 미리보기가 표시됩니다.");
        if (type === "kpis") return renderKpiWidget();
        if (type === "completion") return renderCompletionWidget();
        if (type === "questions") return renderQuestionWidget();
        if (type === "question-table") return renderQuestionTableWidget();
        if (type === "trend") return renderTrendWidget();
        if (type === "survey-info") return renderSurveyInfoWidget();
        return emptyWidget("지원하지 않는 위젯입니다.");
    }

    function renderLayout() {
        const layout = state.elements.layout;
        layout.replaceChildren();
        state.elements.layoutEmpty.hidden = state.items.length > 0;
        state.elements.layoutSummary.textContent = `${state.items.length}개 위젯 · 12열 레이아웃`;
        state.elements.previewTitle.textContent = state.templateName.trim() || "제목 없는 맞춤형 보고서";
        const survey = selectedSurvey();
        if (survey) state.elements.previewSurvey.textContent = `${surveyTitle(survey)} · ${surveyStatus(survey)}`;
        state.items.forEach((item, index) => {
            const definition = WIDGET_BY_TYPE.get(item.type);
            if (!definition) return;
            const card = document.createElement("article");
            card.className = "custom-report-layout-card";
            card.style.setProperty("--widget-span", String(item.span));
            card.dataset.itemId = item.id;
            const header = document.createElement("header");
            header.className = "custom-report-layout-card-header";
            const title = document.createElement("h4");
            title.textContent = definition.title;
            const controls = document.createElement("div");
            controls.className = "custom-report-layout-controls";
            controls.append(
                controlButton(item, "move-up", `${definition.title} 앞으로 이동`, "↑", index === 0),
                controlButton(item, "move-down", `${definition.title} 뒤로 이동`, "↓", index === state.items.length - 1),
                controlButton(item, "resize", `${definition.title} 너비 변경, 현재 ${item.span}열`, "↔"),
                controlButton(item, "remove", `${definition.title} 제거`, "×")
            );
            header.append(title, controls);
            const body = document.createElement("div");
            body.className = "custom-report-layout-card-body";
            const widthNote = document.createElement("span");
            widthNote.className = "custom-report-width-note";
            widthNote.textContent = `${item.span} / 12열`;
            body.append(widthNote, renderWidget(item.type));
            card.append(header, body);
            layout.append(card);
        });
    }

    function updatePaperAppearance() {
        const paper = state.elements.paper;
        if (!paper) return;
        paper.classList.toggle("is-a4", state.paperSize === "A4");
        paper.classList.toggle("is-a3", state.paperSize === "A3");
        paper.classList.toggle("is-portrait", state.orientation === "PORTRAIT");
        paper.classList.toggle("is-landscape", state.orientation === "LANDSCAPE");
        paper.setAttribute("aria-label", `${state.paperSize} ${state.orientation === "LANDSCAPE" ? "가로" : "세로"} 맞춤형 보고서 12열 미리보기`);
    }

    window.Pages = window.Pages || {};
    window.Pages[PAGE_CODE] = {
        async init({ root, api, toast, navigate, confirmMessage, user, appState } = {}) {
            this.destroy();
            if (!root || !api || typeof api.get !== "function") {
                throw new Error("M05002 화면을 초기화하려면 root와 api.get이 필요합니다.");
            }
            state.root = pageElement(root);
            state.api = api;
            state.toast = toast;
            state.navigate = navigate;
            state.confirmMessage = confirmMessage || window.SurveyOneApp?.confirmMessage;
            state.events = new AbortController();
            state.initialSurveyId = String(window.SurveyOneApp?.queryParams?.().get("surveyId") || "");
            state.surveys = [];
            state.report = null;
            state.items = [];
            state.drafts = [];
            state.activeDraftId = "";
            state.selectedSurveyId = "";
            state.paperSize = "A4";
            state.orientation = "PORTRAIT";
            state.templateName = "새 맞춤형 보고서";
            state.dirty = false;
            state.storageKey = scopedStorageKey(user || appState?.user || window.SurveyOneApp?.user || null);
            cacheElements();
            state.drafts = readDrafts();
            bindEvents();
            updatePaperAppearance();
            renderDraftOptions();
            renderPalette();
            renderLayout();
            await loadSurveys();
        },

        async beforeRefresh() {
            return !state.dirty || state.confirmMessage(
                "저장하지 않은 맞춤형 보고서 변경사항이 있습니다. 변경사항을 버리고 현재 화면을 새로고침할까요?",
                { title: "현재 화면 새로고침", confirmLabel: "변경 버리고 새로고침", tone: "warning", destructive: true }
            );
        },

        destroy() {
            state.requestVersion += 1;
            state.events?.abort();
            state.root = null;
            state.api = null;
            state.toast = null;
            state.navigate = null;
            state.confirmMessage = null;
            state.events = null;
            state.initialSurveyId = "";
            state.surveys = [];
            state.report = null;
            state.items = [];
            state.drafts = [];
            state.storageKey = "";
            state.elements = {};
        }
    };
})();
