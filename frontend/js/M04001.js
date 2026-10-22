(function () {
    "use strict";
    const PAGE_NAME = "M04001";
    const META_COLUMNS = 4;
    const DEFAULT_COLUMN_COUNT = 8;
    const MULTIPLE_TYPES = new Set(["multiple", "multiple_choice", "checkbox", "checkboxes"]);
    const MATRIX_TYPES = new Set(["matrix", "matrix_single", "matrix_multiple"]);
    const NON_ANSWER_TYPES = new Set(["notice", "text"]);

    function text(value) { return String(value ?? "").trim(); }
    function normalizedType(question) { return text(question?.type).toLowerCase(); }
    function hasValue(value) {
        if (value === null || value === undefined || value === "") return false;
        if (Array.isArray(value)) return value.some(hasValue);
        if (typeof value === "object") return Object.values(value).some(hasValue);
        return true;
    }
    function safeJson(value) {
        try { return JSON.stringify(value); } catch { return String(value ?? ""); }
    }
    function safeFilename(value) {
        return text(value || "survey").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 90) || "survey";
    }

    window.Pages = window.Pages || {};
    window.Pages[PAGE_NAME] = {
        async init(context) {
            this.context = context;
            this.root = context.root;
            this.surveys = [];
            this.responses = [];
            this.questionEntries = [];
            this.questions = [];
            this.visibleColumns = new Set();
            this.selectedSurveyId = "";
            this.responseLoadToken = 0;
            this.exporting = false;
            this.exportController = new AbortController();
            this.page = 1;
            this.pageSize = 50;
            this.projectFilter = "all";
            this.projectLayout = localStorage.getItem("surveyone-rawdata-view") === "list" ? "list" : "grid";
            this.bind();
            await this.loadSurveys();
        },
        bind() {
            this.onChange = (event) => {
                if (event.target.matches("[data-response-state], [data-response-from], [data-response-to]")) {
                    this.page = 1;
                    this.renderTable();
                }
                if (event.target.matches("[data-response-page-size]")) {
                    this.pageSize = Number(event.target.value) || 50;
                    this.page = 1;
                    this.renderTable();
                }
            };
            this.onInput = Common.debounce((event) => {
                if (!this.root) return;
                if (event.target.matches("[data-response-search]")) {
                    this.page = 1;
                    this.renderTable();
                }
                if (event.target.matches("[data-response-project-search]")) this.renderProjects();
            }, 120);
            this.onClick = (event) => {
                const filter = event.target.closest("[data-project-filter]");
                if (filter) {
                    this.projectFilter = filter.dataset.projectFilter;
                    this.root.querySelectorAll("[data-project-filter]").forEach((button) => button.setAttribute("aria-selected", String(button === filter)));
                    this.renderProjects();
                }
                const layout = event.target.closest("[data-response-project-layout]");
                if (layout) {
                    this.projectLayout = layout.dataset.responseProjectLayout;
                    localStorage.setItem("surveyone-rawdata-view", this.projectLayout);
                    this.root.querySelectorAll("[data-response-project-layout]").forEach((button) => button.setAttribute("aria-selected", String(button === layout)));
                    this.renderProjects();
                }
                const project = event.target.closest("[data-open-response-project]");
                if (project) void this.selectSurvey(project.dataset.openResponseProject);
                if (event.target.closest("[data-response-project-back]")) this.showProjectList();

                const preset = event.target.closest("[data-column-preset]");
                if (preset) this.applyColumnPreset(preset.dataset.columnPreset);
                if (event.target.closest("[data-export-responses]")) this.showExportOptions();
                if (event.target.closest("[data-export-xlsx]")) this.showExportOptions("xlsx");
                if (event.target.closest("[data-response-query]")) this.applyResponseFilters();
                const refresh = event.target.closest("[data-response-refresh]");
                if (refresh) void this.refreshResponses(refresh);
                if (event.target.closest("[data-response-reset]")) this.resetFilters();
                if (event.target.closest("[data-toggle-columns]")) this.showColumns();
                if (event.target.closest("[data-privacy-guide]")) this.showPrivacyGuide();
                const detail = event.target.closest("[data-response-detail]");
                if (detail) this.showResponseDetail(detail.dataset.responseDetail);
                const pageButton = event.target.closest("[data-page-delta]");
                if (pageButton && !pageButton.disabled) {
                    this.page += Number(pageButton.dataset.pageDelta);
                    this.renderTable();
                    this.root.querySelector("[data-response-state-host]")?.scrollTo({ top: 0 });
                }
            };
            this.onProjectSort = () => this.renderProjects();
            this.root.addEventListener("change", this.onChange);
            this.root.addEventListener("input", this.onInput);
            this.root.addEventListener("click", this.onClick);
            this.root.querySelector("[data-response-project-sort]").addEventListener("change", this.onProjectSort);
            const initialLayout = this.root.querySelector(`[data-response-project-layout="${this.projectLayout}"]`);
            if (initialLayout) this.root.querySelectorAll("[data-response-project-layout]").forEach((button) => button.setAttribute("aria-selected", String(button === initialLayout)));
        },
        async loadSurveys() {
            try {
                const payload = await this.context.api.get("/api/surveys");
                const items = payload?.items || payload?.surveys || payload || [];
                if (!Array.isArray(items)) throw new Error("설문 목록 형식이 올바르지 않습니다.");
                this.surveys = items;
                this.updateProjectCounts();
                this.renderProjects();
                const requested = window.SurveyOneApp.queryParams().get("surveyId");
                if (requested && this.surveys.some((item) => String(item.id) === requested)) await this.selectSurvey(requested);
            } catch (error) {
                this.surveys = [];
                this.renderProjects(error.message);
            }
        },
        surveyStatus(item) {
            const status = text(item?.status).toLowerCase();
            if (["published", "active", "open"].includes(status)) return "배포 중";
            if (["closed", "ended"].includes(status)) return "종료";
            return "작성 중";
        },
        updateProjectCounts() {
            this.root.querySelector("[data-project-count-all]").textContent = Common.formatNumber(this.surveys.length);
            this.root.querySelector("[data-project-count-ready]").textContent = Common.formatNumber(this.surveys.filter((item) => Number(item.responseCount || 0) > 0).length);
        },
        normalizedSurveyStatus(item) {
            return text(item?.status).toLowerCase() === "active" ? "published" : text(item?.status).toLowerCase();
        },
        renderProjects(errorMessage = "") {
            const query = text(this.root.querySelector("[data-response-project-search]").value).toLowerCase();
            const sort = this.root.querySelector("[data-response-project-sort]").value;
            let items = this.surveys.filter((item) => {
                const status = this.normalizedSurveyStatus(item);
                const filterMatches = this.projectFilter === "all"
                    || (this.projectFilter === "ready" ? Number(item.responseCount || 0) > 0 : status === this.projectFilter);
                const searchSource = `${item.title || ""} ${item.category || ""} ${item.id || ""}`.toLowerCase();
                return filterMatches && (!query || searchSource.includes(query));
            });
            items.sort((a, b) => {
                if (sort === "title") return text(a.title).localeCompare(text(b.title), "ko");
                if (sort === "updated") return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
                return Number(b.responseCount || 0) - Number(a.responseCount || 0)
                    || new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
            });
            const grid = this.root.querySelector("[data-response-project-grid]");
            grid.className = `response-project-grid ${this.projectLayout === "list" ? "is-list" : ""}`;
            if (!items.length) {
                grid.innerHTML = `<section class="empty-state response-project-empty"><span class="empty-icon">${errorMessage ? "!" : "0"}</span><h2>${errorMessage ? "프로젝트를 불러오지 못했습니다" : "조건에 맞는 프로젝트가 없습니다"}</h2><p>${Common.escapeHtml(errorMessage || "검색어 또는 분석 상태 필터를 바꿔보세요.")}</p></section>`;
                return;
            }
            grid.innerHTML = items.map((item) => this.projectCardMarkup(item)).join("");
        },
        projectCardMarkup(item) {
            const responseCount = Number(item.responseCount || 0);
            const questionCount = Number(item.questionCount || 0);
            const ready = responseCount > 0;
            const status = this.normalizedSurveyStatus(item) || "draft";
            const statusClass = status === "published" ? "published" : (status === "closed" ? "closed" : "draft");
            const readiness = ready ? "분석 가능" : (status === "draft" ? "설계 중" : "응답 대기");
            return `<article class="response-project-card"><header class="response-project-card-head"><span class="status-badge status-${statusClass}">${Common.escapeHtml(this.surveyStatus(item))}</span><span class="analysis-readiness ${ready ? "is-ready" : ""}"><i aria-hidden="true"></i>${readiness}</span></header><button class="response-project-card-main" type="button" data-open-response-project="${Common.escapeHtml(item.id)}"><span class="response-project-category">${Common.escapeHtml(item.category || "일반조사")}</span><h3>${Common.escapeHtml(item.title || "제목 없는 설문")}</h3><span class="response-project-id">프로젝트 ID <code>${Common.escapeHtml(item.id)}</code></span></button><dl class="response-project-stats"><div><dt>응답</dt><dd>${Common.formatNumber(responseCount)}<small>건</small></dd></div><div><dt>문항</dt><dd>${Common.formatNumber(questionCount)}<small>개</small></dd></div><div><dt>확정 버전</dt><dd>${item.publishedVersion ? `v${Common.formatNumber(item.publishedVersion)}` : "-"}</dd></div></dl><footer class="response-project-card-footer"><span>${Common.formatDate(item.updatedAt || item.createdAt)} 기준</span><button class="button button-small button-navigation ${ready ? "button-important" : ""}" type="button" data-open-response-project="${Common.escapeHtml(item.id)}">${ready ? "응답 분석" : "응답 현황 열기"}</button></footer></article>`;
        },
        showProjectList() {
            this.responseLoadToken += 1;
            this.root.querySelector("[data-response-project-view]").hidden = false;
            this.root.querySelector("[data-response-workspace]").hidden = true;
            this.selectedSurveyId = "";
            this.currentSurvey = null;
            this.setEnabled(false);
            this.root.querySelector("[data-response-refresh]").disabled = true;
            const route = window.location.hash.split("?")[0] || "#/M04001";
            window.history.replaceState(null, "", route);
            this.renderProjects();
            this.root.querySelector("[data-response-project-search]").focus();
        },
        showWorkspace(survey) {
            this.root.querySelector("[data-response-project-view]").hidden = true;
            this.root.querySelector("[data-response-workspace]").hidden = false;
            this.setEnabled(false);
            this.root.querySelector("[data-response-refresh]").disabled = !this.selectedSurveyId;
            this.root.querySelector("[data-workspace-project-title]").textContent = survey.title || "제목 없는 설문";
            this.root.querySelector("[data-workspace-project-status]").textContent = this.surveyStatus(survey);
            this.root.querySelector("[data-workspace-project-id]").textContent = survey.id;
            this.root.querySelector("[data-workspace-project-title]").focus({ preventScroll: true });
        },
        async selectSurvey(id) {
            const survey = this.surveys.find((item) => String(item.id) === String(id));
            if (!survey) return;
            this.selectedSurveyId = String(id);
            this.showWorkspace(survey);
            const route = window.location.hash.split("?")[0] || "#/M04001";
            window.history.replaceState(null, "", `${route}?surveyId=${encodeURIComponent(this.selectedSurveyId)}`);
            await this.loadResponses(this.selectedSurveyId);
        },
        buildQuestionEntries(survey) {
            const sections = Array.isArray(survey?.sections) && survey.sections.length
                ? survey.sections
                : [{ id: "all", title: "전체 문항", questions: Common.questionsOf(survey) }];
            let number = 0;
            return sections.flatMap((section, sectionIndex) => (Array.isArray(section.questions) ? section.questions : [])
                .filter((question) => !NON_ANSWER_TYPES.has(normalizedType(question)))
                .map((question) => ({
                    question,
                    id: String(question.id),
                    number: ++number,
                    sectionId: String(section.id || `section-${sectionIndex + 1}`),
                    sectionTitle: section.title || `섹션 ${sectionIndex + 1}`
                })));
        },
        essentialEntries() {
            const required = this.questionEntries.filter((entry) => entry.question.required);
            const optional = this.questionEntries.filter((entry) => !entry.question.required);
            return [...required, ...optional].slice(0, DEFAULT_COLUMN_COUNT);
        },
        async loadResponses(id, { preserveView = false } = {}) {
            if (!id) { this.responses = []; this.questionEntries = []; this.questions = []; this.setEnabled(false); this.renderEmpty(); return false; }
            const requestToken = ++this.responseLoadToken;
            const previousColumns = preserveView ? new Set(this.visibleColumns) : new Set();
            const previouslyAll = preserveView && this.questionEntries.length > 0
                && this.questionEntries.every((entry) => previousColumns.has(entry.id));
            this.renderLoading();
            try {
                const [surveyPayload, responsePayload] = await Promise.all([
                    this.context.api.get(`/api/surveys/${encodeURIComponent(id)}`),
                    this.fetchAllResponses(id)
                ]);
                if (requestToken !== this.responseLoadToken || String(id) !== this.selectedSurveyId) return;
                const survey = surveyPayload?.survey || surveyPayload;
                this.currentSurvey = survey;
                this.questionEntries = this.buildQuestionEntries(survey);
                this.questions = this.questionEntries.map((entry) => entry.question);
                this.responses = responsePayload?.items || responsePayload?.responses || responsePayload || [];
                if (!Array.isArray(this.responses)) throw new Error("응답 목록 형식이 올바르지 않습니다.");
                const availableIds = new Set(this.questionEntries.map((entry) => entry.id));
                const retainedColumns = [...previousColumns].filter((id) => availableIds.has(id));
                this.visibleColumns = new Set(!preserveView || previouslyAll ? availableIds : retainedColumns);
                if (!preserveView) this.page = 1;
                this.root.querySelector("[data-response-title]").textContent = survey.title || "제목 없는 설문";
                this.setEnabled(true);
                this.renderMetrics(responsePayload?.summary || {});
                this.renderTable();
                return true;
            } catch (error) {
                if (requestToken !== this.responseLoadToken || String(id) !== this.selectedSurveyId) return;
                this.responses = [];
                this.currentSurvey = null;
                this.setEnabled(false);
                this.renderError(error.message);
                return false;
            }
        },
        async fetchAllResponses(id) {
            const pageSize = 200;
            const responses = [];
            for (let offset = 0; ; offset += pageSize) {
                const payload = await this.context.api.get(`/api/surveys/${encodeURIComponent(id)}/responses?offset=${offset}&limit=${pageSize}`);
                const page = payload?.items || payload?.responses || payload || [];
                if (!Array.isArray(page)) throw new Error("응답 목록 형식이 올바르지 않습니다.");
                responses.push(...page);
                if (page.length < pageSize) break;
            }
            return responses;
        },
        setEnabled(enabled) {
            this.root.querySelectorAll("[data-response-search], [data-response-state], [data-response-from], [data-response-to], [data-response-query], [data-response-reset], [data-export-responses], [data-export-xlsx], [data-toggle-columns], [data-column-preset]").forEach((element) => { element.disabled = !enabled || (element.matches("[data-export-xlsx]") && this.exporting); });
        },
        renderMetrics(summary = {}) {
            const total = summary.total ?? this.responses.length;
            const complete = summary.complete ?? this.responses.filter((item) => item.status !== "partial" && item.completed !== false).length;
            const rate = summary.completionRate ?? (total ? Math.round(complete / total * 100) : 0);
            const seconds = summary.averageDurationSeconds ?? this.averageDuration();
            const metrics = [
                ["전체 응답", Common.formatNumber(total), "건", "제출 기준"],
                ["완료 응답", Common.formatNumber(complete), "건", "필수 문항 충족"],
                ["완료율", rate, "%", "시작 대비 완료"],
                ["평균 소요", seconds ? Math.max(1, Math.round(seconds / 60)) : 0, "분", "완료 응답 기준"]
            ];
            this.root.querySelector("[data-response-metrics]").innerHTML = metrics.map((item, index) => `<article class="card metric-card"><span class="metric-label">${Common.icon(["database", "check", "chart", "time"][index], 17)} ${item[0]}</span><strong class="metric-value">${item[1]}<small>${item[2]}</small></strong><span class="metric-trend">${item[3]}</span></article>`).join("");
        },
        averageDuration() {
            const values = this.responses.map((item) => Number(item.durationSeconds || 0)).filter(Boolean);
            return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
        },
        filtered() {
            const query = this.root.querySelector("[data-response-search]").value.trim().toLowerCase();
            const state = this.root.querySelector("[data-response-state]").value;
            const from = this.root.querySelector("[data-response-from]").value;
            const to = this.root.querySelector("[data-response-to]").value;
            return this.responses.filter((item) => {
                const complete = item.status !== "partial" && item.completed !== false;
                const serialized = safeJson(item).toLowerCase();
                const date = (item.submittedAt || item.createdAt || "").slice(0, 10);
                return (!query || serialized.includes(query))
                    && (state === "all" || (state === "complete") === complete)
                    && (!from || date >= from)
                    && (!to || date <= to);
            });
        },
        rawAnswer(response, question) {
            const answers = response?.answers || {};
            if (Array.isArray(answers)) return answers.find((item) => String(item.questionId) === String(question.id))?.value;
            return answers[question.id] ?? answers[String(question.id)];
        },
        axisItems(question, axis) {
            const settingsItems = question?.settings?.[axis];
            const source = Array.isArray(settingsItems) && settingsItems.length ? settingsItems : question?.[axis];
            return (Array.isArray(source) ? source : []).map((item, index) => typeof item === "object"
                ? { id: String(item.id ?? index), label: text(item.label ?? item.title ?? item.id ?? index + 1) }
                : { id: String(index), label: text(item) || String(index + 1) });
        },
        optionItems(question) {
            return (Array.isArray(question?.options) ? question.options : []).map((item, index) => typeof item === "object"
                ? { id: String(item.id ?? index), label: text(item.label ?? item.title ?? item.id ?? index + 1) }
                : { id: String(index), label: text(item) || String(index + 1) });
        },
        itemLabel(items, value) {
            const token = String(value ?? "");
            const exact = items.find((item) => item.id === token);
            if (exact) return exact.label;
            const index = Number(token);
            if (Number.isInteger(index) && index >= 0 && items[index]) return items[index].label;
            return token;
        },
        isMatrixMultiple(question) {
            const type = normalizedType(question);
            return type === "matrix_multiple" || (type === "matrix" && text(question?.settings?.selectionMode).toLowerCase() === "multiple");
        },
        answerPresentation(response, question) {
            const value = this.rawAnswer(response, question);
            if (!hasValue(value)) return { kind: "empty", text: "-", values: [] };
            const type = normalizedType(question);
            if (MULTIPLE_TYPES.has(type)) {
                const options = this.optionItems(question);
                const values = (Array.isArray(value) ? value : [value]).map((item) => this.itemLabel(options, item));
                return { kind: "chips", text: values.join(" | "), values };
            }
            if (["single", "single_choice", "dropdown"].includes(type)) {
                const label = this.itemLabel(this.optionItems(question), value);
                return { kind: "text", text: label, values: [label] };
            }
            if (MATRIX_TYPES.has(type) && value && typeof value === "object" && !Array.isArray(value)) {
                const rows = this.axisItems(question, "rows");
                const columns = this.axisItems(question, "columns");
                const lines = Object.entries(value).map(([row, selected]) => {
                    const rowLabel = this.itemLabel(rows, row);
                    const labels = (Array.isArray(selected) ? selected : [selected]).map((item) => this.itemLabel(columns, item));
                    return `${rowLabel}: ${labels.join(", ")}`;
                });
                return { kind: "lines", text: lines.join(" | "), values: lines };
            }
            if (["table", "repeat_table"].includes(type) && Array.isArray(value)) {
                const rows = this.axisItems(question, "rows");
                const columns = this.axisItems(question, "columns");
                const lines = value.map((row, rowIndex) => {
                    const rowValues = Array.isArray(row) ? row : Object.values(row || {});
                    const cells = rowValues.map((cell, columnIndex) => `${columns[columnIndex]?.label || `${columnIndex + 1}열`}=${text(cell) || "-"}`);
                    return `${rows[rowIndex]?.label || `${rowIndex + 1}행`}: ${cells.join(" · ")}`;
                }).filter(Boolean);
                return { kind: "lines", text: lines.join(" | "), values: lines };
            }
            if (value && typeof value === "object") {
                const lines = Object.entries(value).map(([key, item]) => `${key}: ${Array.isArray(item) ? item.join(", ") : text(item)}`);
                return { kind: "lines", text: lines.join(" | "), values: lines };
            }
            return { kind: "text", text: String(value), values: [String(value)] };
        },
        presentationMarkup(presentation, compact = false) {
            if (presentation.kind === "empty") return `<span class="answer-empty">-</span>`;
            if (presentation.kind === "chips") {
                const limit = compact ? 3 : presentation.values.length;
                const rest = presentation.values.length - limit;
                return `<span class="answer-chips">${presentation.values.slice(0, limit).map((value) => `<span>${Common.escapeHtml(value)}</span>`).join("")}${rest > 0 ? `<em>+${rest}</em>` : ""}</span>`;
            }
            if (presentation.kind === "lines") {
                const limit = compact ? 2 : presentation.values.length;
                const rest = presentation.values.length - limit;
                return `<span class="answer-lines">${presentation.values.slice(0, limit).map((value) => `<span>${Common.escapeHtml(value)}</span>`).join("")}${rest > 0 ? `<em>외 ${rest}개</em>` : ""}</span>`;
            }
            return `<span class="answer-text">${Common.escapeHtml(presentation.text)}</span>`;
        },
        visibleEntries() { return this.questionEntries.filter((entry) => this.visibleColumns.has(entry.id)); },
        typeLabel(question) {
            const labels = {
                single: "단일선택", single_choice: "단일선택", multiple: "복수응답", multiple_choice: "복수응답",
                dropdown: "목록선택", short_text: "단답형", long_text: "장문형", number: "숫자", scale: "척도",
                slider: "슬라이더", matrix: "매트릭스", matrix_single: "단일 매트릭스", matrix_multiple: "복수 매트릭스",
                table: "표", repeat_table: "반복표", date: "날짜"
            };
            return labels[normalizedType(question)] || normalizedType(question) || "문항";
        },
        renderTable() {
            const items = this.filtered();
            const entries = this.visibleEntries();
            const totalPages = Math.max(1, Math.ceil(items.length / this.pageSize));
            this.page = Math.min(Math.max(1, this.page), totalPages);
            const start = (this.page - 1) * this.pageSize;
            const pageItems = items.slice(start, start + this.pageSize);
            this.root.querySelector("[data-response-count]").textContent = `총 ${Common.formatNumber(items.length)}건 · ${Common.formatNumber(this.questionEntries.length)}개 문항`;
            this.root.querySelector("[data-column-summary]").textContent = `전체 ${this.questionEntries.length}개 문항 중 ${entries.length}개 표시 · 고정 메타 열 ${META_COLUMNS}개`;
            this.renderPagination(items.length, totalPages, start, pageItems.length);
            if (!items.length) {
                this.root.querySelector("[data-response-state-host]").innerHTML = `<div class="response-empty"><span>0</span><strong>표시할 응답이 없습니다.</strong><p>검색어나 기간 조건을 바꾸거나 초기화해 보세요.</p></div>`;
                return;
            }
            if (!entries.length) {
                this.root.querySelector("[data-response-state-host]").innerHTML = `<div class="response-empty"><span>＋</span><strong>표시할 문항 열을 선택하세요.</strong><p>열 설정에서 섹션별 문항을 고르거나 핵심 열 프리셋을 사용할 수 있습니다.</p></div>`;
                return;
            }
            const header = entries.map((entry) => `<th class="question-column" title="${Common.escapeHtml(entry.question.title)}"><span>Q${entry.number}</span><strong>${Common.escapeHtml(entry.question.title || "제목 없는 문항")}</strong><small>${Common.escapeHtml(entry.sectionTitle)} · ${Common.escapeHtml(this.typeLabel(entry.question))}</small></th>`).join("");
            const rows = pageItems.map((item) => {
                const id = String(item.id || item.responseId || "");
                const complete = item.status !== "partial" && item.completed !== false;
                const answers = entries.map((entry) => {
                    const presentation = this.answerPresentation(item, entry.question);
                    return `<td class="answer-cell" title="${Common.escapeHtml(presentation.text)}">${this.presentationMarkup(presentation, true)}</td>`;
                }).join("");
                return `<tr><td class="response-id"><button type="button" data-response-detail="${Common.escapeHtml(id)}">${Common.escapeHtml(id)}</button></td><td><span class="status-badge ${complete ? "status-published" : "status-paused"}">${complete ? "완료" : "미완료"}</span></td><td>${Common.formatDate(item.submittedAt || item.createdAt, { hour: "2-digit", minute: "2-digit" })}</td><td>${item.durationSeconds ? `${Math.max(1, Math.round(item.durationSeconds / 60))}분` : "-"}</td>${answers}</tr>`;
            }).join("");
            const mobileCards = pageItems.map((item) => this.mobileResponseCard(item, entries)).join("");
            this.root.querySelector("[data-response-state-host]").innerHTML = `<div class="data-table-wrap response-table-wrap"><table class="data-table response-table"><thead><tr><th>응답 ID</th><th>상태</th><th>제출 시각</th><th>소요</th>${header}</tr></thead><tbody>${rows}</tbody></table></div><div class="response-mobile-list">${mobileCards}</div>`;
        },
        mobileResponseCard(item, entries) {
            const id = String(item.id || item.responseId || "");
            const complete = item.status !== "partial" && item.completed !== false;
            return `<article class="response-mobile-card"><header><button type="button" data-response-detail="${Common.escapeHtml(id)}">${Common.escapeHtml(id)}</button><span class="status-badge ${complete ? "status-published" : "status-paused"}">${complete ? "완료" : "미완료"}</span></header><p>${Common.formatDate(item.submittedAt || item.createdAt, { hour: "2-digit", minute: "2-digit" })}</p><dl>${entries.slice(0, 3).map((entry) => `<div><dt>Q${entry.number}. ${Common.escapeHtml(entry.question.title)}</dt><dd>${this.presentationMarkup(this.answerPresentation(item, entry.question), true)}</dd></div>`).join("")}</dl><button class="button button-small button-layer" type="button" data-response-detail="${Common.escapeHtml(id)}">전체 응답 보기</button></article>`;
        },
        renderPagination(total, totalPages, start, length) {
            const host = this.root.querySelector("[data-response-pagination]");
            if (!total) { host.innerHTML = ""; return; }
            host.innerHTML = `<span>${Common.formatNumber(start + 1)}–${Common.formatNumber(start + length)} / ${Common.formatNumber(total)}</span><label>페이지당 <select data-response-page-size><option value="25" ${this.pageSize === 25 ? "selected" : ""}>25</option><option value="50" ${this.pageSize === 50 ? "selected" : ""}>50</option><option value="100" ${this.pageSize === 100 ? "selected" : ""}>100</option></select></label><button type="button" data-page-delta="-1" aria-label="이전 페이지" ${this.page <= 1 ? "disabled" : ""}>‹</button><strong>${this.page}/${totalPages}</strong><button type="button" data-page-delta="1" aria-label="다음 페이지" ${this.page >= totalPages ? "disabled" : ""}>›</button>`;
        },
        renderLoading() {
            this.root.querySelector("[data-response-state-host]").innerHTML = `<div class="page-loading"><span class="spinner"></span><strong>응답 데이터를 불러오는 중</strong><p>문항과 응답 수에 따라 잠시 걸릴 수 있습니다.</p></div>`;
        },
        renderEmpty() {
            this.root.querySelector("[data-response-title]").textContent = "응답 레코드";
            this.root.querySelector("[data-column-summary]").textContent = "표시 문항을 선택하면 요약이 표시됩니다.";
            this.root.querySelector("[data-response-state-host]").innerHTML = `<div class="response-empty"><span>≡</span><strong>프로젝트를 선택하면 응답이 표시됩니다.</strong><p>프로젝트 목록에서 분석할 설문을 선택해 주세요.</p></div>`;
            this.root.querySelector("[data-response-count]").textContent = "총 0건";
            this.root.querySelector("[data-response-pagination]").innerHTML = "";
        },
        renderError(message) {
            this.root.querySelector("[data-response-state-host]").innerHTML = `<div class="response-empty"><span>!</span><strong>응답을 불러오지 못했습니다.</strong><p>${Common.escapeHtml(message)}</p></div>`;
            this.context.toast(message, "error");
        },
        resetFilters() {
            this.root.querySelector("[data-response-search]").value = "";
            this.root.querySelector("[data-response-state]").value = "all";
            this.root.querySelector("[data-response-from]").value = "";
            this.root.querySelector("[data-response-to]").value = "";
            this.page = 1;
            this.renderTable();
        },
        applyResponseFilters() {
            this.page = 1;
            this.renderTable();
            this.root.querySelector("[data-response-state-host]")?.scrollTo({ top: 0 });
        },
        async refreshResponses(button) {
            if (!this.selectedSurveyId || button.disabled) return;
            button.disabled = true;
            button.setAttribute("aria-busy", "true");
            try {
                const loaded = await this.loadResponses(this.selectedSurveyId, { preserveView: true });
                if (loaded && this.root) this.context.toast("최신 응답으로 새로고침했습니다.", "success");
            } finally {
                if (this.root) {
                    button.removeAttribute("aria-busy");
                    button.disabled = !this.selectedSurveyId;
                }
            }
        },
        applyColumnPreset(mode) {
            if (mode === "all") this.visibleColumns = new Set(this.questionEntries.map((entry) => entry.id));
            else this.visibleColumns = new Set(this.essentialEntries().map((entry) => entry.id));
            this.page = 1;
            this.renderTable();
            this.context.toast(mode === "all" ? "전체 문항 열을 표시합니다." : "필수 문항 우선 핵심 열을 표시합니다.", "success");
        },
        showColumns() {
            const groups = [];
            this.questionEntries.forEach((entry) => {
                let group = groups.find((item) => item.id === entry.sectionId);
                if (!group) { group = { id: entry.sectionId, title: entry.sectionTitle, entries: [] }; groups.push(group); }
                group.entries.push(entry);
            });
            const dialog = this.context.openModal(`<div class="column-dialog"><p class="eyebrow">VISIBLE COLUMNS</p><h2>표시할 문항 열</h2><p class="column-dialog-intro">섹션별로 필요한 문항만 선택합니다. 많은 열을 선택해도 표 안에서 가로 스크롤됩니다.</p><div class="column-dialog-tools"><input type="search" placeholder="문항명·번호 검색" aria-label="표시 열 검색" data-column-search><button class="button button-small button-function" type="button" data-column-dialog-preset="essential">핵심</button><button class="button button-small button-function" type="button" data-column-dialog-preset="all">전체</button><button class="button button-small button-function" type="button" data-column-dialog-preset="none">해제</button></div><p class="column-dialog-count" aria-live="polite" data-column-dialog-count></p><div class="column-picker">${groups.map((group) => `<section><header><strong>${Common.escapeHtml(group.title)}</strong><span>${group.entries.length}문항</span></header>${group.entries.map((entry) => `<label data-column-choice data-search-text="${Common.escapeHtml(`q${entry.number} ${entry.question.title} ${group.title}`.toLowerCase())}"><input type="checkbox" value="${Common.escapeHtml(entry.id)}" ${this.visibleColumns.has(entry.id) ? "checked" : ""}><span><b>Q${entry.number}</b> ${Common.escapeHtml(entry.question.title || "제목 없는 문항")}<small>${Common.escapeHtml(this.typeLabel(entry.question))}${entry.question.required ? " · 필수" : ""}</small></span></label>`).join("")}</section>`).join("")}</div><button class="button button-function button-important button-block" type="button" data-apply-columns>선택한 열 적용</button></div>`, { wide: true, label: "표시할 문항 열 설정", initialFocus: "[data-column-search]" });
            const update = () => {
                const checked = dialog.querySelectorAll("[data-column-choice] input:checked").length;
                dialog.querySelector("[data-column-dialog-count]").textContent = `${this.questionEntries.length}개 문항 중 ${checked}개 선택`;
            };
            dialog.querySelector("[data-column-search]").addEventListener("input", (event) => {
                const query = event.target.value.trim().toLowerCase();
                dialog.querySelectorAll("[data-column-choice]").forEach((label) => { label.hidden = Boolean(query) && !label.dataset.searchText.includes(query); });
                dialog.querySelectorAll(".column-picker section").forEach((section) => { section.hidden = !section.querySelector("[data-column-choice]:not([hidden])"); });
            });
            dialog.querySelector(".column-picker").addEventListener("change", update);
            dialog.querySelector("[data-column-dialog-preset='essential']").addEventListener("click", () => {
                const ids = new Set(this.essentialEntries().map((entry) => entry.id));
                dialog.querySelectorAll("[data-column-choice] input").forEach((input) => { input.checked = ids.has(String(input.value)); });
                update();
            });
            dialog.querySelector("[data-column-dialog-preset='all']").addEventListener("click", () => { dialog.querySelectorAll("[data-column-choice] input").forEach((input) => { input.checked = true; }); update(); });
            dialog.querySelector("[data-column-dialog-preset='none']").addEventListener("click", () => { dialog.querySelectorAll("[data-column-choice] input").forEach((input) => { input.checked = false; }); update(); });
            dialog.querySelector("[data-apply-columns]").addEventListener("click", () => {
                this.visibleColumns = new Set([...dialog.querySelectorAll("[data-column-choice] input:checked")].map((input) => String(input.value)));
                dialog.close();
                this.page = 1;
                this.renderTable();
            });
            update();
        },
        showResponseDetail(responseId) {
            const response = this.responses.find((item) => String(item.id || item.responseId) === String(responseId));
            if (!response) return;
            const groups = [];
            this.questionEntries.forEach((entry) => {
                let group = groups.find((item) => item.id === entry.sectionId);
                if (!group) { group = { id: entry.sectionId, title: entry.sectionTitle, entries: [] }; groups.push(group); }
                group.entries.push(entry);
            });
            const complete = response.status !== "partial" && response.completed !== false;
            this.context.openModal(`<div class="response-detail"><p class="eyebrow">RESPONSE DETAIL</p><h2>응답 상세</h2><dl class="response-detail-meta"><div><dt>응답 ID</dt><dd>${Common.escapeHtml(responseId)}</dd></div><div><dt>상태</dt><dd>${complete ? "완료" : "미완료"}</dd></div><div><dt>제출 시각</dt><dd>${Common.escapeHtml(Common.formatDate(response.submittedAt || response.createdAt, { hour: "2-digit", minute: "2-digit" }))}</dd></div><div><dt>소요 시간</dt><dd>${response.durationSeconds ? `${Common.formatNumber(response.durationSeconds)}초` : "-"}</dd></div></dl><div class="response-detail-sections">${groups.map((group) => `<section><header><span>SECTION</span><h3>${Common.escapeHtml(group.title)}</h3></header><dl>${group.entries.map((entry) => `<div><dt><b>Q${entry.number}</b><span>${Common.escapeHtml(entry.question.title || "제목 없는 문항")}</span><small>${Common.escapeHtml(this.typeLabel(entry.question))}</small></dt><dd>${this.presentationMarkup(this.answerPresentation(response, entry.question))}</dd></div>`).join("")}</dl></section>`).join("")}</div></div>`, { wide: true, label: "응답 상세" });
        },
        csvMetadata(response) {
            const complete = response.status !== "partial" && response.completed !== false;
            return [response.id || response.responseId, complete ? "완료" : "미완료", response.submittedAt || response.createdAt || "", response.durationSeconds || ""];
        },
        analysisDescriptors(entries) {
            return entries.flatMap((entry) => {
                const question = entry.question;
                const prefix = `Q${entry.number}. ${question.title || "제목 없는 문항"}`;
                const type = normalizedType(question);
                if (MULTIPLE_TYPES.has(type) && this.optionItems(question).length) {
                    return this.optionItems(question).map((option) => ({
                        label: `${prefix} [${option.label}]`,
                        value: (response) => {
                            const raw = this.rawAnswer(response, question);
                            return (Array.isArray(raw) ? raw : [raw]).map(String).includes(option.id) ? 1 : 0;
                        }
                    }));
                }
                if (MATRIX_TYPES.has(type) && this.axisItems(question, "rows").length) {
                    const rows = this.axisItems(question, "rows");
                    const columns = this.axisItems(question, "columns");
                    if (this.isMatrixMultiple(question)) return rows.flatMap((row, rowIndex) => columns.map((column, columnIndex) => ({
                        label: `${prefix} [${row.label} / ${column.label}]`,
                        value: (response) => {
                            const raw = this.rawAnswer(response, question) || {};
                            const selected = raw[row.id] ?? raw[String(rowIndex)] ?? [];
                            const values = (Array.isArray(selected) ? selected : [selected]).map(String);
                            return values.includes(column.id) || values.includes(String(columnIndex)) ? 1 : 0;
                        }
                    })));
                    return rows.map((row, rowIndex) => ({
                        label: `${prefix} [${row.label}]`,
                        value: (response) => {
                            const raw = this.rawAnswer(response, question) || {};
                            return this.itemLabel(columns, raw[row.id] ?? raw[String(rowIndex)] ?? "");
                        }
                    }));
                }
                return [{ label: prefix, value: (response) => this.answerPresentation(response, question).text.replaceAll(" | ", "\n") }];
            });
        },
        exportCsv(mode) {
            const entries = mode === "visible" ? this.visibleEntries() : this.questionEntries;
            const items = this.filtered();
            const baseHeader = ["응답ID", "상태", "제출시각", "소요시간(초)"];
            let rows;
            let suffix;
            if (mode === "analysis") {
                const descriptors = this.analysisDescriptors(entries);
                rows = [baseHeader.concat(descriptors.map((item) => item.label)), ...items.map((response) => this.csvMetadata(response).concat(descriptors.map((item) => item.value(response))))];
                suffix = "analysis";
            } else if (mode === "raw" || mode === "codes") {
                rows = [baseHeader.concat(entries.map((entry) => `Q${entry.number}. ${entry.question.title}`)), ...items.map((response) => this.csvMetadata(response).concat(entries.map((entry) => {
                    const raw = mode === "codes" ? (response.codedAnswers?.[entry.id] ?? this.rawAnswer(response, entry.question)) : this.rawAnswer(response, entry.question);
                    return raw && typeof raw === "object" ? safeJson(raw) : (raw ?? "");
                })))];
                suffix = mode;
            } else {
                rows = [baseHeader.concat(entries.map((entry) => `Q${entry.number}. ${entry.question.title}`)), ...items.map((response) => this.csvMetadata(response).concat(entries.map((entry) => this.answerPresentation(response, entry.question).text.replaceAll(" | ", "\n"))))];
                suffix = "view";
            }
            Common.downloadCsv(`${safeFilename(this.currentSurvey?.title)}_responses_${suffix}.csv`, rows);
            this.context.toast(`${Common.formatNumber(items.length)}건의 CSV를 만들었습니다.`, "success");
        },
        async exportXlsx(mode) {
            if (!this.selectedSurveyId || this.exporting) return;
            const surveyId = this.selectedSurveyId;
            const items = this.filtered();
            const entries = mode === "visible" ? this.visibleEntries() : this.questionEntries;
            const filename = `${safeFilename(this.currentSurvey?.title)}_responses_${mode}.xlsx`;
            const button = this.root.querySelector("[data-export-xlsx]");
            this.exporting = true;
            button.disabled = true;
            button.setAttribute("aria-busy", "true");
            try {
                const response = await fetch(`${window.SURVEYONE_CONFIG.apiBaseUrl}/api/surveys/${encodeURIComponent(surveyId)}/responses/export`, {
                    method: "POST", credentials: "same-origin",
                    headers: { "Content-Type": "application/json", Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
                    body: JSON.stringify({ mode, questionIds: entries.map((entry) => entry.id), responseIds: items.map((item) => String(item.id || item.responseId)) }),
                    signal: this.exportController.signal
                });
                if (!response.ok) {
                    const payload = await response.json().catch(() => null);
                    const detail = payload?.detail ?? payload?.message;
                    const message = typeof detail === "string" ? detail : `엑셀 파일을 만들지 못했습니다. (${response.status})`;
                    if (response.status === 401) window.dispatchEvent(new CustomEvent("surveyone:session-invalid", { detail: { endpoint: "/api/surveys/:id/responses/export", message } }));
                    throw new Error(message);
                }
                const blob = await response.blob();
                if (!blob.size || !(response.headers.get("content-type") || "").includes("spreadsheetml")) throw new Error("엑셀 파일 형식을 확인할 수 없습니다.");
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement("a");
                anchor.href = url;
                anchor.download = filename;
                anchor.hidden = true;
                document.body.append(anchor);
                anchor.click();
                anchor.remove();
                setTimeout(() => URL.revokeObjectURL(url), 0);
                this.context.toast(`${Common.formatNumber(items.length)}건의 엑셀 다운로드를 시작했습니다.`, "success");
            } catch (error) {
                if (error.name !== "AbortError") this.context.toast(error.message, "error");
            } finally {
                this.exporting = false;
                if (this.root) {
                    button.removeAttribute("aria-busy");
                    button.disabled = !this.currentSurvey;
                }
            }
        },
        showExportOptions(format = "csv") {
            const label = format === "xlsx" ? "엑셀 (.xlsx)" : "CSV";
            const dialog = this.context.openModal(`<div class="export-dialog"><p class="eyebrow">${label} EXPORT</p><h2>내보내기 형식 선택</h2><p>현재 검색·상태·기간 필터에 해당하는 전체 페이지의 응답을 내려받습니다. 모든 형식에 동일하게 적용됩니다.</p><div class="export-options"><button type="button" data-export-mode="visible"><strong>현재 보기형</strong><span>화면에서 선택한 문항만 내보냅니다. 복수응답은 보기명으로 한 셀에 정리합니다.</span></button><button type="button" data-export-mode="analysis"><strong>분석형 · 권장</strong><span>전체 문항을 내보내고 복수응답과 복수 매트릭스를 보기별 1/0 열로 분리합니다.</span></button><button type="button" data-export-mode="codes"><strong>결과 코드형</strong><span>응답 당시 확정한 표시 문구·결과 코드 설정을 사용합니다. 표·매트릭스는 행·열 코드로 구분합니다.</span></button><button type="button" data-export-mode="raw"><strong>원본형</strong><span>전체 문항의 제출값을 보존합니다. 표·매트릭스 값은 JSON으로 제공합니다.</span></button></div><p class="export-count">대상 응답 ${Common.formatNumber(this.filtered().length)}건 · 전체 문항 ${Common.formatNumber(this.questionEntries.length)}개</p></div>`, { label: `${label} 내보내기 형식 선택` });
            dialog.querySelector(".export-options").addEventListener("click", (event) => {
                const button = event.target.closest("[data-export-mode]");
                if (!button) return;
                const mode = button.dataset.exportMode;
                dialog.close();
                if (format === "xlsx") void this.exportXlsx(mode);
                else this.exportCsv(mode);
            });
        },
        showPrivacyGuide() {
            this.context.openModal(`<p class="eyebrow">DATA GOVERNANCE</p><h2>응답 데이터 처리 원칙</h2><ol class="help-steps"><li><strong>최소 권한</strong><span>회원사와 프로젝트 권한을 서버에서 매 요청마다 확인합니다.</span></li><li><strong>최소 표시</strong><span>화면에는 업무에 필요한 문항만 선택해 표시합니다.</span></li><li><strong>분석 목적 구분</strong><span>분석형은 복수응답을 1/0 열로 변환하고 원본형은 제출 구조를 보존합니다.</span></li><li><strong>보유기간</strong><span>만료 정책에 따라 익명화하거나 안전하게 파기합니다.</span></li></ol>`);
        },
        destroy() {
            this.exportController?.abort();
            this.onInput?.cancel?.();
            this.root?.removeEventListener("change", this.onChange);
            this.root?.removeEventListener("input", this.onInput);
            this.root?.removeEventListener("click", this.onClick);
            this.root?.querySelector("[data-response-project-sort]")?.removeEventListener("change", this.onProjectSort);
            this.root = null;
        }
    };
})();
