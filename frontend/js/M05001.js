(function () {
    "use strict";

    const PAGE_CODE = "M05001";
    const state = {
        root: null,
        api: null,
        toast: null,
        navigate: null,
        events: null,
        requestVersion: 0,
        initialSurveyId: "",
        surveys: [],
        report: null,
        responses: [],
        trendAvailable: true,
        exporting: false,
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

    function clampPercent(value) {
        return Math.max(0, Math.min(100, numberValue(value)));
    }

    function formatNumber(value, maximumFractionDigits = 1) {
        return numberValue(value).toLocaleString("ko-KR", { maximumFractionDigits });
    }

    function formatDate(value, { includeTime = false } = {}) {
        if (!value) return "";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return new Intl.DateTimeFormat("ko-KR", includeTime ? {
            year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
        } : {
            year: "numeric", month: "2-digit", day: "2-digit"
        }).format(date);
    }

    function todayValue() {
        const now = new Date();
        const offset = now.getTimezoneOffset() * 60 * 1000;
        return new Date(now.getTime() - offset).toISOString().slice(0, 10);
    }

    function surveyId(survey) {
        return String(read(survey, ["id", "surveyId", "survey_id", "SURVEY_ID", "projectId", "PROJECT_ID"], ""));
    }

    function surveyTitle(survey) {
        return String(read(survey, ["title", "name", "surveyTitle", "survey_title", "SURVEY_TITLE", "projectName", "PROJECT_NAME"], "제목 없는 설문"));
    }

    function surveyStatus(survey) {
        const raw = String(read(survey, ["status", "surveyStatus", "survey_status", "SURVEY_STATUS"], "")).toUpperCase();
        const labels = { DRAFT: "작성 중", READY: "배포 대기", PUBLISHED: "진행 중", ACTIVE: "진행 중", CLOSED: "종료", ENDED: "종료" };
        return labels[raw] || raw;
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

    function errorMessage(error) {
        return String(error?.detail || error?.message || "잠시 후 다시 시도해 주세요.");
    }

    function pageElement(root) {
        if (root?.matches?.('[data-page="M05001"]')) return root;
        return root?.querySelector?.('[data-page="M05001"]') || root;
    }

    function cacheElements() {
        const root = state.root;
        const find = (role) => root.querySelector(`[data-role="${role}"]`);
        state.elements = {
            filterForm: find("filter-form"),
            surveySelect: find("survey-select"),
            cutoffDate: find("cutoff-date"),
            responseFilter: find("response-filter"),
            basisText: find("basis-text"),
            loading: find("loading-state"),
            error: find("error-state"),
            errorMessage: find("error-message"),
            empty: find("empty-state"),
            content: find("report-content"),
            retry: find("retry"),
            detailTitle: find("detail-title"),
            detailMeta: find("detail-meta"),
            openResponses: find("open-responses"),
            kpiGrid: find("kpi-grid"),
            updatedAt: find("updated-at"),
            trendChart: find("trend-chart"),
            trendTotal: find("trend-total"),
            trendNote: find("trend-note"),
            completionRing: find("completion-ring"),
            completionValue: find("completion-value"),
            completedCount: find("completed-count"),
            partialCount: find("partial-count"),
            chartGrid: find("chart-grid"),
            chartEmpty: find("chart-empty"),
            questionCount: find("question-count"),
            tableBody: find("question-table-body"),
            tableEmpty: find("table-empty")
        };
    }

    function bindEvents() {
        const signal = state.events.signal;
        state.elements.filterForm?.addEventListener("submit", (event) => {
            event.preventDefault();
            loadReport();
        }, { signal });
        state.elements.surveySelect?.addEventListener("change", () => loadReport(), { signal });
        state.elements.retry?.addEventListener("click", () => {
            if (state.surveys.length) loadReport();
            else loadSurveys();
        }, { signal });
        state.elements.openResponses?.addEventListener("click", () => {
            const id = String(state.elements.surveySelect?.value || "");
            if (id && typeof state.navigate === "function") state.navigate("M04001", { surveyId: id });
        }, { signal });
        state.root.querySelectorAll('[data-role="export"]').forEach((button) => {
            button.addEventListener("click", () => exportReport(button), { signal });
        });
    }

    function downloadFilename(response, fallback) {
        const disposition = response.headers.get("content-disposition") || "";
        const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
        if (encoded) {
            try {
                return decodeURIComponent(encoded);
            } catch (_error) {
                // Fall through to the ASCII filename or local fallback.
            }
        }
        return disposition.match(/filename="([^"]+)"/i)?.[1] || fallback;
    }

    async function downloadError(response) {
        const contentType = response.headers.get("content-type") || "";
        if (contentType.toLowerCase().includes("json")) {
            const payload = await response.json().catch(() => null);
            const detail = payload?.detail ?? payload?.message;
            if (typeof detail === "string") return detail;
            if (Array.isArray(detail)) return detail.map((item) => item?.msg || String(item)).join(" / ");
        }
        const text = await response.text().catch(() => "");
        return text.trim() || `보고서 파일을 만들지 못했습니다. (${response.status})`;
    }

    async function exportReport(activeButton) {
        const id = String(state.elements.surveySelect?.value || "");
        if (!id || !state.report || state.exporting) {
            if (!id) notify("내보낼 설문 프로젝트를 먼저 선택해 주세요.", "info");
            return;
        }
        const format = String(activeButton?.dataset.format || "").toLowerCase();
        if (!new Set(["xlsx", "pdf"]).has(format)) return;
        state.exporting = true;
        const buttons = Array.from(state.root.querySelectorAll('[data-role="export"]'));
        buttons.forEach((button) => {
            button.disabled = true;
            button.setAttribute("aria-busy", button === activeButton ? "true" : "false");
        });
        const params = new URLSearchParams({ format });
        const cutoffDate = state.elements.cutoffDate?.value || "";
        const responseStatus = state.elements.responseFilter?.value || "ALL";
        if (cutoffDate) params.set("cutoffDate", cutoffDate);
        if (responseStatus !== "ALL") params.set("responseStatus", responseStatus);
        const label = format === "xlsx" ? "Excel" : "PDF";
        activeButton?.classList.add("is-exporting");
        try {
            const response = await fetch(
                `${window.SURVEYONE_CONFIG.apiBaseUrl}/api/surveys/${encodeURIComponent(id)}/report/export?${params}`,
                {
                    credentials: "same-origin",
                    headers: { Accept: format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf" },
                    signal: state.events.signal
                }
            );
            if (!response.ok) {
                const message = await downloadError(response);
                if (response.status === 401) {
                    window.dispatchEvent(new CustomEvent("surveyone:session-invalid", {
                        detail: { endpoint: "/api/surveys/:id/report/export", message }
                    }));
                }
                throw new Error(message);
            }
            const blob = await response.blob();
            const expectedType = format === "xlsx" ? "spreadsheetml" : "pdf";
            if (!blob.size || !(response.headers.get("content-type") || "").toLowerCase().includes(expectedType)) {
                throw new Error(`${label} 파일 형식을 확인할 수 없습니다.`);
            }
            const survey = selectedSurvey();
            const fallback = `${survey ? surveyTitle(survey) : "설문-보고서"}.${format}`;
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = downloadFilename(response, fallback);
            anchor.hidden = true;
            document.body.append(anchor);
            anchor.click();
            anchor.remove();
            setTimeout(() => URL.revokeObjectURL(url), 0);
            notify(`${label} 보고서 다운로드를 시작했습니다.`, "success");
        } catch (error) {
            if (error?.name !== "AbortError") notify(errorMessage(error), "error");
        } finally {
            state.exporting = false;
            activeButton?.classList.remove("is-exporting");
            if (state.root) {
                buttons.forEach((button) => {
                    button.disabled = false;
                    button.removeAttribute("aria-busy");
                });
            }
        }
    }

    function setView(view) {
        const elements = state.elements;
        elements.loading.hidden = view !== "loading";
        elements.error.hidden = view !== "error";
        elements.empty.hidden = view !== "empty";
        elements.content.hidden = view !== "content";
        elements.filterForm?.setAttribute("aria-busy", view === "loading" ? "true" : "false");
    }

    function populateSurveyOptions(selectedId = "") {
        const select = state.elements.surveySelect;
        if (!select) return;
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
            const status = surveyStatus(survey);
            const option = new Option(`${surveyTitle(survey)}${status ? ` · ${status}` : ""}`, id);
            select.append(option);
        });
        const available = Array.from(select.options).some((option) => option.value === String(selectedId));
        select.value = available ? String(selectedId) : (select.options[1]?.value || "");
    }

    async function loadSurveys() {
        const version = ++state.requestVersion;
        setView("loading");
        try {
            const response = await state.api.get("/api/surveys");
            if (version !== state.requestVersion || !state.root) return;
            const payload = unwrapEnvelope(response);
            state.surveys = asList(payload, ["surveys", "items", "rows", "results"]);
            populateSurveyOptions(state.initialSurveyId);
            if (!state.surveys.length) {
                state.elements.basisText.textContent = "보고서를 만들 수 있는 설문이 없습니다.";
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

    function selectedSurvey() {
        const id = String(state.elements.surveySelect?.value || "");
        return state.surveys.find((survey) => surveyId(survey) === id) || null;
    }

    async function loadReport() {
        const id = String(state.elements.surveySelect?.value || "");
        if (!id) {
            state.elements.basisText.textContent = "설문을 선택해 주세요.";
            setView("empty");
            return;
        }
        const version = ++state.requestVersion;
        setView("loading");
        const cutoffDate = state.elements.cutoffDate?.value || "";
        const responseStatus = state.elements.responseFilter?.value || "ALL";
        try {
            const params = new URLSearchParams();
            if (cutoffDate) params.set("cutoffDate", cutoffDate);
            if (responseStatus && responseStatus !== "ALL") params.set("responseStatus", responseStatus);
            const query = params.toString();
            const reportRequest = state.api.get(`/api/surveys/${encodeURIComponent(id)}/report${query ? `?${query}` : ""}`);
            const trendRequest = responseStatus === "PARTIAL"
                ? Promise.resolve([])
                : state.api.get(`/api/surveys/${encodeURIComponent(id)}/responses?offset=0&limit=200`);
            const [reportResult, trendResult] = await Promise.allSettled([reportRequest, trendRequest]);
            if (version !== state.requestVersion || !state.root) return;
            if (reportResult.status === "rejected") throw reportResult.reason;
            const payload = unwrapEnvelope(reportResult.value);
            state.report = payload && typeof payload === "object" ? payload : {};
            const trendPayload = trendResult.status === "fulfilled" ? unwrapEnvelope(trendResult.value) : [];
            state.responses = asList(trendPayload, ["responses", "items", "rows", "results"]);
            state.trendAvailable = trendResult.status === "fulfilled";
            renderReport(state.report);
            renderBasis();
            setView("content");
        } catch (error) {
            if (version !== state.requestVersion || !state.root) return;
            state.report = null;
            state.responses = [];
            state.trendAvailable = false;
            state.elements.errorMessage.textContent = errorMessage(error);
            setView("error");
        }
    }

    function reportRoot(report) {
        const nested = read(report, ["report", "result", "summaryReport"], null);
        return nested && typeof nested === "object" ? { ...report, ...nested } : report;
    }

    function totalResponses(report) {
        const source = reportRoot(report);
        const summary = read(source, ["summary", "overview", "totals"], {});
        const explicit = read(summary, ["totalResponses", "responseCount", "total", "TOTAL_RESPONSES", "RESPONSE_COUNT"], null);
        if (explicit !== null) return numberValue(explicit);
        const reportValue = read(source, ["totalResponses", "responseCount", "responsesCount", "TOTAL_RESPONSES", "RESPONSE_COUNT"], null);
        if (reportValue !== null) return numberValue(reportValue);
        return asList(read(source, ["responses", "rawResponses"], []), ["items", "rows"]).length;
    }

    function deriveSummary(report) {
        const source = reportRoot(report);
        const summary = read(source, ["summary", "overview", "totals"], {});
        const total = totalResponses(source);
        const completedRaw = read(summary, ["completedResponses", "completeCount", "completed", "COMPLETED_RESPONSES"], read(source, ["completedResponses", "completeCount"], null));
        const partialRaw = read(summary, ["partialResponses", "partialCount", "inProgress", "PARTIAL_RESPONSES"], read(source, ["partialResponses", "partialCount", "inProgress"], null));
        const completed = completedRaw === null
            ? (partialRaw === null ? total : Math.max(0, total - numberValue(partialRaw)))
            : numberValue(completedRaw);
        const partial = partialRaw === null ? Math.max(0, total - completed) : numberValue(partialRaw);
        let completionRate = numberValue(read(summary, ["completionRate", "completeRate", "COMPLETION_RATE"], read(source, ["completionRate", "completeRate"], total ? completed / total : 0)));
        if (completionRate > 1) completionRate /= 100;
        return { total, completed, partial, completionRate: Math.max(0, Math.min(1, completionRate)) };
    }

    function deriveKpis(report) {
        const source = reportRoot(report);
        const explicit = asList(read(source, ["kpis", "metrics", "keyMetrics"], []), ["items", "rows"]);
        if (explicit.length) {
            return explicit.slice(0, 6).map((item, index) => ({
                label: String(read(item, ["label", "name", "title", "metric"], `지표 ${index + 1}`)),
                value: read(item, ["value", "count", "metricValue"], 0),
                unit: String(read(item, ["unit", "format"], "")),
                note: String(read(item, ["note", "description", "basis"], "")),
                tone: String(read(item, ["tone", "status"], "neutral")).toLowerCase()
            }));
        }
        const { total, completed, partial, completionRate } = deriveSummary(source);
        const questionCount = asList(read(source, ["questions", "questionStats", "questionReports", "questionSummaries", "items"], []), ["items", "rows"]).length;
        return [
            { label: "전체 응답", value: total, unit: "count", note: "현재 조회 기준", tone: "neutral" },
            { label: "완료 응답", value: completed, unit: "count", note: total ? `전체의 ${formatNumber(completionRate * 100)}%` : "응답 없음", tone: "positive" },
            { label: "진행 중", value: partial, unit: "count", note: partial ? "미완료 응답" : "진행 중 없음", tone: partial ? "warning" : "neutral" },
            { label: "분석 문항", value: questionCount, unit: "question", note: "집계 가능한 문항", tone: "neutral" }
        ];
    }

    function displayKpiValue(kpi) {
        const unit = String(kpi.unit || "").toLowerCase();
        if (unit.includes("rate") || unit.includes("percent") || unit === "%") {
            let rate = numberValue(kpi.value);
            if (Math.abs(rate) <= 1) rate *= 100;
            return `${formatNumber(rate)}%`;
        }
        if (unit === "text") return String(kpi.value || "-");
        if (typeof kpi.value === "number" || /^-?[\d,.]+$/.test(String(kpi.value || ""))) {
            const suffix = unit === "question" ? "개" : (unit && !new Set(["count", "number", "건"]).has(unit) ? ` ${kpi.unit}` : "건");
            return `${formatNumber(kpi.value)}${suffix}`;
        }
        return String(kpi.value ?? "-");
    }

    function normalizeQuestionType(value) {
        const type = String(value || "").toUpperCase();
        const labels = {
            SINGLE: "객관식", SINGLE_CHOICE: "객관식", RADIO: "객관식", MULTIPLE_CHOICE: "복수응답", CHECKBOX: "복수응답",
            MULTIPLE: "복수응답", MULTI: "복수응답", TEXT: "주관식", SHORT_TEXT: "단답형",
            LONG_TEXT: "장문형", NUMBER: "숫자", SCALE: "척도", LIKERT: "척도", MATRIX: "매트릭스",
            DATE: "날짜", TABLE: "표", REPEAT_TABLE: "반복표"
        };
        return labels[type] || (type ? type.replace(/_/g, " ") : "문항");
    }

    function normalizeChoices(question, responseCount) {
        const raw = read(question, ["options", "choices", "distribution", "answerDistribution", "answers", "values"], []);
        let choices = [];
        if (Array.isArray(raw)) {
            choices = raw.map((choice, index) => {
                if (choice && typeof choice === "object") {
                    return {
                        label: String(read(choice, ["label", "text", "name", "option", "value"], `보기 ${index + 1}`)),
                        count: numberValue(read(choice, ["count", "responses", "responseCount", "frequency"], 0)),
                        percent: read(choice, ["percent", "percentage", "rate", "ratio"], null)
                    };
                }
                return { label: String(choice), count: 0, percent: null };
            });
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
            let percent = choice.percent === null ? (denominator ? (choice.count / denominator) * 100 : 0) : numberValue(choice.percent);
            if (percent > 0 && percent <= 1) percent *= 100;
            return { ...choice, percent: clampPercent(percent) };
        });
    }

    function deriveQuestions(report) {
        const source = reportRoot(report);
        const raw = asList(read(source, ["questions", "questionStats", "questionReports", "questionSummaries", "items"], []), ["items", "rows"]);
        const total = totalResponses(source);
        return raw.map((question, index) => {
            const responseCount = numberValue(read(question, ["responseCount", "answeredCount", "count", "responses", "RESPONSE_COUNT"], total));
            const missing = numberValue(read(question, ["missingCount", "unansweredCount", "skippedCount", "MISSING_COUNT"], Math.max(0, total - responseCount)));
            const choices = normalizeChoices(question, responseCount);
            const top = choices.slice().sort((a, b) => b.count - a.count)[0];
            return {
                id: String(read(question, ["id", "questionId", "question_id", "code"], index + 1)),
                order: numberValue(read(question, ["order", "sequence", "questionNo", "number"], index + 1), index + 1),
                title: String(read(question, ["title", "text", "question", "label", "questionText"], `문항 ${index + 1}`)),
                type: normalizeQuestionType(read(question, ["type", "questionType", "question_type"], "")),
                responseCount,
                missing,
                choices,
                primary: String(read(question, ["summary", "primaryResult", "average", "mean"], top ? `${top.label} ${formatNumber(top.percent)}%` : "-"))
            };
        }).sort((a, b) => a.order - b.order);
    }

    function renderKpis(report) {
        const grid = state.elements.kpiGrid;
        grid.replaceChildren();
        deriveKpis(report).forEach((kpi) => {
            const card = document.createElement("article");
            card.className = "report-kpi-card";
            card.dataset.tone = kpi.tone || "neutral";
            const label = document.createElement("span");
            label.className = "report-kpi-label";
            label.textContent = kpi.label;
            const value = document.createElement("strong");
            value.className = "report-kpi-value";
            value.textContent = displayKpiValue(kpi);
            const note = document.createElement("span");
            note.className = "report-kpi-note";
            note.textContent = kpi.note || "";
            card.append(label, value, note);
            grid.append(card);
        });
    }

    function localDateKey(value) {
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) return "";
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

    function deriveTrendPoints() {
        const cutoff = state.elements.cutoffDate?.value || todayValue();
        const cutoffDate = new Date(`${cutoff}T12:00:00`);
        const today = new Date(`${todayValue()}T12:00:00`);
        const end = Number.isNaN(cutoffDate.getTime()) || cutoffDate > today ? today : cutoffDate;
        const points = Array.from({ length: 8 }, (_value, index) => {
            const date = new Date(end);
            date.setDate(end.getDate() - (7 - index));
            return { key: localDateKey(date), label: `${date.getMonth() + 1}.${date.getDate()}`, count: 0 };
        });
        const pointMap = new Map(points.map((point) => [point.key, point]));
        const reportVersion = read(reportRoot(state.report), ["publishedVersion", "published_version", "version"], null);
        state.responses.forEach((response) => {
            const responseVersion = read(response, ["surveyVersion", "survey_version", "version"], null);
            if (reportVersion !== null && responseVersion !== null && String(reportVersion) !== String(responseVersion)) return;
            const submittedAt = read(response, ["submittedAt", "submitted_at", "createdAt", "created_at"], "");
            const point = pointMap.get(localDateKey(submittedAt));
            if (point) point.count += 1;
        });
        return points;
    }

    function svgElement(name, attributes = {}) {
        const element = document.createElementNS("http://www.w3.org/2000/svg", name);
        Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
        return element;
    }

    function renderTrend() {
        const host = state.elements.trendChart;
        if (!host) return;
        host.replaceChildren();
        const points = deriveTrendPoints();
        const total = points.reduce((sum, point) => sum + point.count, 0);
        const maximum = Math.max(1, ...points.map((point) => point.count));
        const width = 440;
        const height = 132;
        const baseline = 100;
        const step = width / Math.max(1, points.length - 1);
        const coordinates = points.map((point, index) => ({
            x: Math.round(index * step),
            y: Math.round(baseline - (point.count / maximum) * 76)
        }));
        const svg = svgElement("svg", { viewBox: `0 0 ${width} ${height}`, "aria-hidden": "true", focusable: "false" });
        [24, 62, baseline].forEach((y) => svg.append(svgElement("line", { x1: 0, y1: y, x2: width, y2: y, class: "report-trend-gridline" })));
        const path = coordinates.map((point, index) => `${index ? "L" : "M"}${point.x} ${point.y}`).join(" ");
        const areaPath = coordinates.map((point) => `L${point.x} ${point.y}`).join(" ");
        const area = `M0 ${baseline} ${areaPath} L${width} ${baseline} Z`;
        svg.append(svgElement("path", { d: area, class: "report-trend-area" }));
        svg.append(svgElement("path", { d: path, class: "report-trend-line" }));
        coordinates.forEach((point) => svg.append(svgElement("circle", { cx: point.x, cy: point.y, r: 4, class: "report-trend-point" })));
        const labels = document.createElement("div");
        labels.className = "report-trend-labels";
        points.forEach((point) => {
            const label = document.createElement("span");
            label.textContent = point.label;
            labels.append(label);
        });
        host.append(svg, labels);
        const detail = points.map((point) => `${point.label} ${point.count}건`).join(", ");
        host.setAttribute("aria-label", `최근 8일 응답 추이: ${detail}`);
        state.elements.trendTotal.textContent = `${formatNumber(total, 0)}건`;
        state.elements.trendNote.textContent = !state.trendAvailable
            ? "응답 추이는 불러오지 못했지만 나머지 집계는 정상 표시됩니다."
            : (state.responses.length >= 200 ? "조회된 응답 최대 200건을 기준으로 표시합니다." : "최근 제출 응답을 날짜별로 집계했습니다.");
    }

    function renderCompletion(report) {
        const { completed, partial, completionRate } = deriveSummary(report);
        const percent = clampPercent(completionRate * 100);
        const ring = state.elements.completionRing;
        ring?.style.setProperty("--completion-rate", `${percent}%`);
        ring?.setAttribute("aria-label", `완료율 ${formatNumber(percent)}%, 완료 ${formatNumber(completed, 0)}건, 진행 중 ${formatNumber(partial, 0)}건`);
        state.elements.completionValue.textContent = `${formatNumber(percent)}%`;
        state.elements.completedCount.textContent = `${formatNumber(completed, 0)}건`;
        state.elements.partialCount.textContent = `${formatNumber(partial, 0)}건`;
    }

    function renderDetailHeader(report, questionCount) {
        const source = reportRoot(report);
        const survey = selectedSurvey();
        const title = String(read(source, ["title", "surveyTitle", "survey_title"], survey ? surveyTitle(survey) : "선택한 조사"));
        const version = read(source, ["publishedVersion", "published_version", "version"], null);
        const status = survey ? surveyStatus(survey) : "";
        state.elements.detailTitle.textContent = title;
        state.elements.detailMeta.textContent = [status, version ? `확정 버전 v${formatNumber(version, 0)}` : "확정 버전 없음", `분석 문항 ${formatNumber(questionCount, 0)}개`].filter(Boolean).join(" · ");
    }

    function renderCharts(questions) {
        const grid = state.elements.chartGrid;
        grid.replaceChildren();
        const chartQuestions = questions.filter((question) => question.choices.length).slice(0, 6);
        state.elements.chartEmpty.hidden = chartQuestions.length > 0;
        chartQuestions.forEach((question) => {
            const card = document.createElement("article");
            card.className = "report-chart-card";
            const title = document.createElement("h3");
            title.textContent = `${question.order}. ${question.title}`;
            const meta = document.createElement("p");
            meta.className = "report-chart-meta";
            meta.textContent = `${question.type} · 응답 ${formatNumber(question.responseCount, 0)}건`;
            const list = document.createElement("div");
            list.className = "report-bar-list";
            question.choices.slice(0, 8).forEach((choice) => {
                const item = document.createElement("div");
                item.className = "report-bar-item";
                item.setAttribute("role", "img");
                item.setAttribute("aria-label", `${choice.label}: ${formatNumber(choice.percent)}%, ${formatNumber(choice.count, 0)}건`);
                const label = document.createElement("span");
                label.className = "report-bar-label";
                label.textContent = choice.label;
                label.title = choice.label;
                const track = document.createElement("span");
                track.className = "report-bar-track";
                track.setAttribute("aria-hidden", "true");
                const fill = document.createElement("span");
                fill.className = "report-bar-fill";
                fill.style.setProperty("--bar-size", `${choice.percent}%`);
                track.append(fill);
                const value = document.createElement("strong");
                value.className = "report-bar-value";
                value.textContent = `${formatNumber(choice.percent)}%`;
                item.append(label, track, value);
                list.append(item);
            });
            card.append(title, meta, list);
            grid.append(card);
        });
    }

    function renderQuestionTable(questions) {
        const body = state.elements.tableBody;
        body.replaceChildren();
        state.elements.tableEmpty.hidden = questions.length > 0;
        state.elements.questionCount.textContent = `총 ${formatNumber(questions.length, 0)}개 문항`;
        questions.forEach((question) => {
            const row = document.createElement("tr");
            [question.order, question.title, question.type, `${formatNumber(question.responseCount, 0)}건`, `${formatNumber(question.missing, 0)}건`, question.primary]
                .forEach((value) => {
                    const cell = document.createElement("td");
                    cell.textContent = String(value);
                    row.append(cell);
                });
            body.append(row);
        });
    }

    function renderBasis() {
        const survey = selectedSurvey();
        const cutoff = state.elements.cutoffDate?.value;
        const filter = state.elements.responseFilter?.selectedOptions?.[0]?.textContent || "전체 응답";
        state.elements.basisText.textContent = `${survey ? surveyTitle(survey) : "선택 설문"} · ${cutoff ? `${formatDate(cutoff)}까지` : "전체 기간"} · ${filter}`;
    }

    function renderReport(report) {
        const source = reportRoot(report);
        const questions = deriveQuestions(source);
        renderDetailHeader(source, questions.length);
        renderKpis(source);
        renderTrend();
        renderCompletion(source);
        renderCharts(questions);
        renderQuestionTable(questions);
        const generatedAt = read(source, ["generatedAt", "updatedAt", "lastUpdatedAt", "generated_at", "UPDATED_AT"], new Date().toISOString());
        state.elements.updatedAt.textContent = `최종 집계 ${formatDate(generatedAt, { includeTime: true })}`;
    }

    window.Pages = window.Pages || {};
    window.Pages[PAGE_CODE] = {
        async init({ root, api, toast, navigate } = {}) {
            this.destroy();
            if (!root || !api || typeof api.get !== "function") {
                throw new Error("M05001 화면을 초기화하려면 root와 api.get이 필요합니다.");
            }
            state.root = pageElement(root);
            state.api = api;
            state.toast = toast;
            state.navigate = navigate;
            state.events = new AbortController();
            state.initialSurveyId = String(window.SurveyOneApp?.queryParams?.().get("surveyId") || "");
            state.surveys = [];
            state.report = null;
            state.responses = [];
            state.trendAvailable = true;
            state.exporting = false;
            cacheElements();
            if (state.elements.cutoffDate && !state.elements.cutoffDate.value) state.elements.cutoffDate.value = todayValue();
            bindEvents();
            await loadSurveys();
        },

        destroy() {
            state.requestVersion += 1;
            state.events?.abort();
            state.root = null;
            state.api = null;
            state.toast = null;
            state.navigate = null;
            state.events = null;
            state.initialSurveyId = "";
            state.surveys = [];
            state.report = null;
            state.responses = [];
            state.trendAvailable = true;
            state.exporting = false;
            state.elements = {};
        }
    };
})();
