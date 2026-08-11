(function () {
    "use strict";

    const PAGE_NAME = "M01001";

    window.Pages = window.Pages || {};
    window.Pages[PAGE_NAME] = {
        async init(context) {
            this.context = context;
            this.root = context.root;
            this.root.querySelector("[data-greeting]").textContent = `${context.user?.name || "담당자"}님, 안녕하세요.`;
            this.bind();
            await this.load();
        },

        bind() {
            this.onClick = (event) => {
                if (event.target.closest("[data-dashboard-create], [data-dashboard-templates]")) this.context.navigate("M02002");
                if (event.target.closest("[data-dashboard-all]")) this.context.navigate("M02001");
                if (event.target.closest("[data-dashboard-reports]")) this.context.navigate("M05001");
                if (event.target.closest("[data-dashboard-refresh]")) this.load();
                if (event.target.closest("[data-blank-survey]")) this.createBlankSurvey();
                const project = event.target.closest("[data-open-survey]");
                if (project) this.context.navigate("M02003", { surveyId: project.dataset.openSurvey });
                const template = event.target.closest("[data-template-id]");
                if (template) this.context.navigate("M02002", { templateId: template.dataset.templateId });
            };
            this.root.addEventListener("click", this.onClick);
        },

        async load() {
            try {
                const [dashboard, templatesPayload] = await Promise.all([
                    this.context.api.get("/api/dashboard"),
                    this.context.api.get("/api/templates")
                ]);
                this.renderMetrics(dashboard.summary || dashboard.metrics || dashboard);
                this.renderRecent(dashboard.recentSurveys || dashboard.surveys || []);
                const templates = templatesPayload.items || templatesPayload.templates || templatesPayload;
                this.renderTemplates(Array.isArray(templates) ? templates.slice(0, 3) : []);
            } catch (error) {
                this.renderMetrics({ drafts: 0, active: 0, responses: 0, closed: 0 });
                this.renderRecent([]);
                this.renderTemplates([]);
                this.context.toast(error.message, "error");
            }
        },

        renderMetrics(summary) {
            const values = [
                { label: "작성 중", value: summary.drafts ?? summary.draftCount ?? summary.draftSurveys ?? 0, hint: "초안을 이어서 완성하세요" },
                { label: "진행 중", value: summary.active ?? summary.publishedCount ?? summary.publishedSurveys ?? 0, hint: "현재 응답 수집 중" },
                { label: "누적 응답", value: summary.responses ?? summary.responseCount ?? summary.totalResponses ?? 0, hint: "실시간으로 반영됩니다" },
                { label: "완료 설문", value: summary.closed ?? summary.closedCount ?? Math.max(0, (summary.totalSurveys || 0) - (summary.draftSurveys || 0) - (summary.publishedSurveys || 0)), hint: "보고서를 만들 수 있어요" }
            ];
            this.root.querySelector("[data-dashboard-metrics]").innerHTML = values.map((item, index) => `
                <article class="card metric-card">
                    <span class="metric-label">${Common.icon(["edit", "send", "users", "chart"][index], 17)} ${item.label}</span>
                    <strong class="metric-value">${Common.formatNumber(item.value)}<small>${index === 2 ? "건" : "개"}</small></strong>
                    <span class="metric-trend">${item.hint}</span>
                </article>
            `).join("");
            this.root.querySelector("[data-live-responses]").textContent = `+${Common.formatNumber(summary.todayResponses ?? summary.responsesToday ?? 0)}`;
        },

        renderRecent(items) {
            const host = this.root.querySelector("[data-recent-surveys]");
            if (!items.length) {
                host.innerHTML = `<div class="dashboard-inline-empty"><span>아직 만든 설문이 없습니다.</span><button class="button button-small button-secondary" data-dashboard-create>첫 설문 만들기</button></div>`;
                return;
            }
            host.innerHTML = items.slice(0, 4).map((item) => {
                const status = item.status || "draft";
                const statusLabel = ({ draft: "작성 중", published: "진행 중", active: "진행 중", closed: "종료", paused: "일시정지" })[status] || status;
                return `<article class="recent-item">
                    <div class="recent-title"><span class="status-badge status-${Common.escapeHtml(status)}">${statusLabel}</span><strong>${Common.escapeHtml(item.title)}</strong><small>${Common.escapeHtml(item.category || item.templateName || "직접 작성")}</small></div>
                    <div class="recent-meta"><span>응답</span><strong>${Common.formatNumber(item.responseCount || 0)}</strong></div>
                    <button class="button recent-action" type="button" data-open-survey="${Common.escapeHtml(item.id)}" aria-label="${Common.escapeHtml(item.title)} 열기">→</button>
                </article>`;
            }).join("");
        },

        renderTemplates(items) {
            const host = this.root.querySelector("[data-dashboard-template-list]");
            if (!items.length) {
                host.innerHTML = `<button class="template-mini-card" type="button" data-dashboard-templates><span class="template-mini-icon">＋</span><h3>템플릿 라이브러리</h3><p>목적별 기본 설문을 확인해보세요.</p></button>`;
                return;
            }
            host.innerHTML = items.map((item, index) => `<button class="template-mini-card" type="button" data-template-id="${Common.escapeHtml(item.id || item.code)}">
                <span class="template-mini-top"><span class="template-mini-icon">${["社", "廉", "事"][index] || "問"}</span><span class="tag">${Common.escapeHtml(item.category || "추천")}</span></span>
                <h3>${Common.escapeHtml(item.name || item.title)}</h3>
                <p>${Common.escapeHtml(item.description || "검증된 기본 문항을 자유롭게 편집할 수 있습니다.")}</p>
                <span class="template-mini-meta"><span>${Common.formatNumber(item.questionCount || Common.questionsOf(item).length)}개 문항</span><span>·</span><span>약 ${item.estimatedMinutes || 5}분</span></span>
            </button>`).join("");
        },

        async createBlankSurvey() {
            try {
                const result = await this.context.api.post("/api/surveys", { title: "제목 없는 설문" });
                const survey = result.survey || result;
                this.context.toast("새 설문 초안을 만들었습니다.", "success");
                this.context.navigate("M02003", { surveyId: survey.id });
            } catch (error) { this.context.toast(error.message, "error"); }
        },

        destroy() {
            this.root?.removeEventListener("click", this.onClick);
            this.root = null;
            this.context = null;
        }
    };
})();
