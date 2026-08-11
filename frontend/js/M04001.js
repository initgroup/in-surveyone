(function () {
    "use strict";
    const PAGE_NAME = "M04001";

    window.Pages = window.Pages || {};
    window.Pages[PAGE_NAME] = {
        async init(context) {
            this.context = context;
            this.root = context.root;
            this.surveys = [];
            this.responses = [];
            this.questions = [];
            this.visibleColumns = new Set();
            this.bind();
            await this.loadSurveys();
        },
        bind() {
            this.onChange = async (event) => {
                if (event.target.matches("[data-response-survey]")) await this.loadResponses(event.target.value);
                if (event.target.matches("[data-response-state], [data-response-from], [data-response-to]")) this.renderTable();
            };
            this.onInput = Common.debounce((event) => { if (event.target.matches("[data-response-search]")) this.renderTable(); }, 170);
            this.onClick = (event) => {
                if (event.target.closest("[data-export-responses]")) this.exportCsv();
                if (event.target.closest("[data-response-reset]")) this.resetFilters();
                if (event.target.closest("[data-toggle-columns]")) this.showColumns();
                if (event.target.closest("[data-privacy-guide]")) this.showPrivacyGuide();
            };
            this.root.addEventListener("change", this.onChange);
            this.root.addEventListener("input", this.onInput);
            this.root.addEventListener("click", this.onClick);
        },
        async loadSurveys() {
            try {
                const payload = await this.context.api.get("/api/surveys");
                this.surveys = payload.items || payload.surveys || payload || [];
                const select = this.root.querySelector("[data-response-survey]");
                select.innerHTML = `<option value="">설문을 선택하세요</option>${this.surveys.map((item) => `<option value="${Common.escapeHtml(item.id)}">${Common.escapeHtml(item.title)}</option>`).join("")}`;
                const requested = window.SurveyOneApp.queryParams().get("surveyId");
                if (requested && this.surveys.some((item) => String(item.id) === requested)) { select.value = requested; await this.loadResponses(requested); }
            } catch (error) { this.renderError(error.message); }
        },
        async loadResponses(id) {
            if (!id) { this.responses = []; this.questions = []; this.setEnabled(false); this.renderEmpty(); return; }
            this.renderLoading();
            try {
                const [surveyPayload, responsePayload] = await Promise.all([
                    this.context.api.get(`/api/surveys/${encodeURIComponent(id)}`),
                    this.fetchAllResponses(id)
                ]);
                const survey = surveyPayload.survey || surveyPayload;
                this.currentSurvey = survey;
                this.questions = Common.questionsOf(survey).filter((item) => !["notice", "text"].includes(item.type));
                this.responses = responsePayload.items || responsePayload.responses || responsePayload || [];
                this.visibleColumns = new Set(this.questions.slice(0, 8).map((item) => String(item.id)));
                this.root.querySelector("[data-response-title]").textContent = survey.title;
                this.setEnabled(true);
                this.renderMetrics(responsePayload.summary || {});
                this.renderTable();
            } catch (error) { this.responses = []; this.renderError(error.message); }
        },
        async fetchAllResponses(id) {
            const pageSize = 200;
            const responses = [];
            for (let offset = 0; ; offset += pageSize) {
                const payload = await this.context.api.get(`/api/surveys/${encodeURIComponent(id)}/responses?offset=${offset}&limit=${pageSize}`);
                const page = payload.items || payload.responses || payload || [];
                if (!Array.isArray(page)) throw new Error("응답 목록 형식이 올바르지 않습니다.");
                responses.push(...page);
                if (page.length < pageSize) break;
            }
            return responses;
        },
        setEnabled(enabled) { this.root.querySelectorAll("[data-response-search], [data-response-state], [data-response-from], [data-response-to], [data-response-reset], [data-export-responses], [data-toggle-columns]").forEach((element) => { element.disabled = !enabled; }); },
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
            this.root.querySelector("[data-response-metrics]").innerHTML = metrics.map((item, index) => `<article class="card metric-card"><span class="metric-label">${Common.icon(["database","check","chart","time"][index],17)} ${item[0]}</span><strong class="metric-value">${item[1]}<small>${item[2]}</small></strong><span class="metric-trend">${item[3]}</span></article>`).join("");
        },
        averageDuration() { const values = this.responses.map((item) => Number(item.durationSeconds || 0)).filter(Boolean); return values.length ? values.reduce((a,b) => a+b,0) / values.length : 0; },
        filtered() {
            const query = this.root.querySelector("[data-response-search]").value.trim().toLowerCase();
            const state = this.root.querySelector("[data-response-state]").value;
            const from = this.root.querySelector("[data-response-from]").value;
            const to = this.root.querySelector("[data-response-to]").value;
            return this.responses.filter((item) => {
                const complete = item.status !== "partial" && item.completed !== false;
                const serialized = JSON.stringify(item).toLowerCase();
                const date = (item.submittedAt || item.createdAt || "").slice(0,10);
                return (!query || serialized.includes(query)) && (state === "all" || (state === "complete") === complete) && (!from || date >= from) && (!to || date <= to);
            });
        },
        answerValue(response, question) {
            const answers = response.answers || {};
            let value;
            if (Array.isArray(answers)) value = answers.find((item) => String(item.questionId) === String(question.id))?.value;
            else value = answers[question.id] ?? answers[String(question.id)];
            if (Array.isArray(value)) return value.join(" | ");
            if (value && typeof value === "object") return JSON.stringify(value);
            return value ?? "";
        },
        renderTable() {
            const items = this.filtered();
            const questions = this.questions.filter((item) => this.visibleColumns.has(String(item.id)));
            this.root.querySelector("[data-response-count]").textContent = `총 ${Common.formatNumber(items.length)}건`;
            if (!items.length) { this.root.querySelector("[data-response-state-host]").innerHTML = `<div class="response-empty"><span>0</span><strong>표시할 응답이 없습니다.</strong><p>응답이 수집되면 이곳에서 실시간으로 조회할 수 있습니다.</p></div>`; return; }
            this.root.querySelector("[data-response-state-host]").innerHTML = `<div class="data-table-wrap"><table class="data-table response-table"><thead><tr><th>응답 ID</th><th>상태</th><th>제출 시각</th><th>소요 시간</th>${questions.map((question, index) => `<th title="${Common.escapeHtml(question.title)}">Q${index + 1}. ${Common.escapeHtml(question.title)}</th>`).join("")}</tr></thead><tbody>${items.map((item) => `<tr><td class="response-id">${Common.escapeHtml(item.id || item.responseId)}</td><td><span class="status-badge ${item.status === "partial" || item.completed === false ? "status-paused" : "status-published"}">${item.status === "partial" || item.completed === false ? "미완료" : "완료"}</span></td><td>${Common.formatDate(item.submittedAt || item.createdAt, { hour: "2-digit", minute: "2-digit" })}</td><td>${item.durationSeconds ? `${Math.max(1,Math.round(item.durationSeconds/60))}분` : "-"}</td>${questions.map((question) => `<td class="answer-cell" title="${Common.escapeHtml(this.answerValue(item,question))}">${Common.escapeHtml(this.answerValue(item,question) || "-")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
        },
        renderLoading() { this.root.querySelector("[data-response-state-host]").innerHTML = `<div class="page-loading"><span class="spinner"></span><strong>응답 데이터를 불러오는 중</strong></div>`; },
        renderEmpty() { this.root.querySelector("[data-response-title]").textContent = "설문을 선택하세요"; this.root.querySelector("[data-response-state-host]").innerHTML = `<div class="response-empty"><span>≡</span><strong>설문을 선택하면 응답이 표시됩니다.</strong><p>개인정보가 포함된 열은 권한과 다운로드 사유를 확인한 뒤 제공합니다.</p></div>`; this.root.querySelector("[data-response-count]").textContent = "총 0건"; },
        renderError(message) { this.root.querySelector("[data-response-state-host]").innerHTML = `<div class="response-empty"><span>!</span><strong>응답을 불러오지 못했습니다.</strong><p>${Common.escapeHtml(message)}</p></div>`; this.context.toast(message,"error"); },
        resetFilters() { this.root.querySelector("[data-response-search]").value = ""; this.root.querySelector("[data-response-state]").value = "all"; this.root.querySelector("[data-response-from]").value = ""; this.root.querySelector("[data-response-to]").value = ""; this.renderTable(); },
        exportCsv() { const questions = this.questions.filter((item) => this.visibleColumns.has(String(item.id))); const rows = [["응답ID","상태","제출시각","소요시간(초)",...questions.map((item) => item.title)], ...this.filtered().map((item) => [item.id || item.responseId, item.status || (item.completed === false ? "partial" : "complete"), item.submittedAt || item.createdAt, item.durationSeconds || "", ...questions.map((question) => this.answerValue(item, question))])]; Common.downloadCsv(`${this.currentSurvey?.title || "survey"}_responses.csv`, rows); this.context.toast("현재 필터 기준으로 CSV를 만들었습니다.","success"); },
        showColumns() { const dialog = this.context.openModal(`<p class="eyebrow">VISIBLE COLUMNS</p><h2>표시할 문항 열</h2><div class="column-picker">${this.questions.map((question) => `<label><input type="checkbox" value="${Common.escapeHtml(question.id)}" ${this.visibleColumns.has(String(question.id)) ? "checked" : ""}> <span>${Common.escapeHtml(question.title)}</span></label>`).join("")}</div><button class="button button-primary button-block" data-apply-columns>적용</button>`); dialog.querySelector("[data-apply-columns]").addEventListener("click", () => { this.visibleColumns = new Set([...dialog.querySelectorAll('.column-picker input:checked')].map((input) => String(input.value))); dialog.close(); this.renderTable(); }); },
        showPrivacyGuide() { this.context.openModal(`<p class="eyebrow">DATA GOVERNANCE</p><h2>응답 데이터 처리 원칙</h2><ol class="help-steps"><li><strong>최소 권한</strong><span>회원사와 프로젝트 권한을 서버에서 매 요청마다 확인합니다.</span></li><li><strong>목적 제한</strong><span>설문 고지 목적을 벗어난 재사용과 불필요한 결합을 금지합니다.</span></li><li><strong>감사 기록</strong><span>원자료 조회·다운로드 사유와 사용자를 남깁니다.</span></li><li><strong>보유기간</strong><span>만료 정책에 따라 익명화하거나 안전하게 파기합니다.</span></li></ol>`); },
        destroy() { this.root?.removeEventListener("change",this.onChange); this.root?.removeEventListener("input",this.onInput); this.root?.removeEventListener("click",this.onClick); this.root=null; }
    };
})();
