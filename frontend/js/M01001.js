(function () {
    "use strict";

    const PAGE_NAME = "M01001";

    window.Pages = window.Pages || {};
    window.Pages[PAGE_NAME] = {
        async init(context) {
            this.context = context;
            this.root = context.root;
            this.isVisitor = !context.user;
            this.root.classList.toggle("is-visitor-dashboard", this.isVisitor);
            this.root.querySelector("[data-greeting]").textContent = this.isVisitor
                ? "설문 운영을 더 간결하게."
                : `${context.user.name || "담당자"}님, 안녕하세요.`;
            this.root.querySelector("[data-visitor-start]").hidden = !this.isVisitor;
            this.bind();
            await this.load();
        },

        bind() {
            this.onClick = (event) => {
                const guestStart = event.target.closest("[data-start-guest]");
                if (guestStart) { this.context.openAuth("guest"); return; }
                const authStart = event.target.closest("[data-start-auth]");
                if (authStart) { this.context.openAuth(authStart.dataset.startAuth); return; }
                if (event.target.closest("[data-visitor-database-retry]")) { void this.configureDatabaseGuestEntry({ force: true }); return; }
                if (event.target.closest("[data-dashboard-create]")) { this.openWorkspace("M02001", { create: "1" }); return; }
                if (event.target.closest("[data-dashboard-templates]")) { this.openWorkspace("M02001", { create: "1", start: "template" }); return; }
                if (event.target.closest("[data-dashboard-all]")) { this.openWorkspace("M02001"); return; }
                if (event.target.closest("[data-dashboard-reports]")) { this.openWorkspace("M05001"); return; }
                if (event.target.closest("[data-dashboard-refresh]")) { void this.load({ announce: true, refreshGuest: true }); return; }
                if (event.target.closest("[data-blank-survey]")) { this.openWorkspace("M02001", { create: "1" }); return; }
                const project = event.target.closest("[data-open-survey]");
                if (project) this.context.navigate("M02003", { surveyId: project.dataset.openSurvey });
            };
            this.root.addEventListener("click", this.onClick);
        },

        openWorkspace(route, params = null) {
            if (this.isVisitor) this.context.openAuth("guest", { route, params });
            else this.context.navigate(route, params);
        },

        async load({ announce = false, refreshGuest = false } = {}) {
            if (this.loading) return;
            this.loading = true;
            const refreshButton = this.root.querySelector("[data-dashboard-refresh]");
            if (refreshButton) {
                refreshButton.disabled = true;
                refreshButton.setAttribute("aria-busy", "true");
                refreshButton.textContent = "새로고침 중…";
            }
            if (this.isVisitor) {
                this.renderMetrics({ drafts: 0, active: 0, responses: 0, closed: 0 });
                this.renderRecent([]);
                try {
                    await this.configureDatabaseGuestEntry({ force: refreshGuest });
                    this.renderTemplateEntry();
                } catch (error) {
                    this.renderTemplateEntry();
                    console.warn("게스트 시작 상태를 확인하지 못했습니다.", error);
                    if (announce) this.context.toast("일부 대시보드 정보를 새로고침하지 못했습니다.", "error");
                    announce = false;
                }
                this.finishLoading(announce);
                return;
            }
            try {
                const dashboard = await this.context.api.get("/api/dashboard");
                const summary = dashboard.summary || dashboard.metrics || dashboard;
                this.renderMetrics({
                    ...summary,
                    todayResponses: dashboard.todayResponses ?? summary.todayResponses,
                    responseTrend: dashboard.responseTrend ?? summary.responseTrend
                });
                this.renderRecent(dashboard.recentSurveys || dashboard.surveys || []);
                this.renderTemplateEntry();
            } catch (error) {
                this.renderMetrics({ drafts: 0, active: 0, responses: 0, closed: 0 });
                this.renderRecent([]);
                this.renderTemplateEntry();
                this.context.toast(error.message, "error");
                announce = false;
            } finally {
                this.finishLoading(announce);
            }
        },

        finishLoading(announce) {
            if (!this.loading) return;
            this.loading = false;
            const refreshButton = this.root?.querySelector("[data-dashboard-refresh]");
            if (refreshButton) {
                refreshButton.disabled = false;
                refreshButton.removeAttribute("aria-busy");
                refreshButton.textContent = "새로고침";
            }
            if (announce) this.context.toast("대시보드 정보를 새로고침했습니다.", "success");
        },

        async configureDatabaseGuestEntry({ force = false } = {}) {
            const button = this.root.querySelector("[data-visitor-database-button]");
            const retry = this.root.querySelector("[data-visitor-database-retry]");
            const status = this.root.querySelector("[data-visitor-database-status]");
            if (button) button.disabled = true;
            if (retry) retry.disabled = true;
            if (status) status.textContent = "발급 상태를 확인하고 있습니다.";
            const capabilities = await this.context.loadGuestCapabilities({ force });
            const database = capabilities?.modes?.find((mode) => mode.mode === "database");
            const card = this.root.querySelector("[data-visitor-database-card]");
            const available = Boolean(database?.available);
            card?.classList.toggle("is-disabled", !available);
            if (button) button.disabled = !available;
            if (retry) {
                retry.hidden = available;
                retry.disabled = available;
            }
            if (status) status.textContent = available
                ? "현재 발급할 수 있습니다. 유효기간과 이용 한도는 발급 화면에서 확인하세요."
                : `현재 발급할 수 없습니다. ${database?.reason || "서비스 저장소 연결 상태를 확인해 주세요."}`;
        },

        renderMetrics(summary) {
            const values = [
                { label: "작성 중", value: summary.drafts ?? summary.draftCount ?? summary.draftSurveys ?? 0, hint: "초안을 이어서 완성하세요" },
                { label: "진행 중", value: summary.active ?? summary.publishedCount ?? summary.publishedSurveys ?? 0, hint: "현재 응답 수집 중" },
                { label: "누적 응답", value: summary.responses ?? summary.responseCount ?? summary.totalResponses ?? 0, hint: "새로고침 시 반영됩니다" },
                { label: "완료 설문", value: summary.closed ?? summary.closedCount ?? Math.max(0, (summary.totalSurveys || 0) - (summary.draftSurveys || 0) - (summary.publishedSurveys || 0)), hint: "보고서를 만들 수 있어요" }
            ];
            this.root.querySelector("[data-dashboard-metrics]").innerHTML = values.map((item, index) => `
                <article class="card metric-card">
                    <span class="metric-label">${Common.icon(["edit", "send", "users", "chart"][index], 17)} ${item.label}</span>
                    <strong class="metric-value">${Common.formatNumber(item.value)}<small>${index === 2 ? "건" : "개"}</small></strong>
                    <span class="metric-trend">${item.hint}</span>
                </article>
            `).join("");
            const trend = this.renderResponseTrend(summary.responseTrend);
            const todayResponses = summary.todayResponses ?? summary.responsesToday ?? trend.at(-1)?.responses ?? 0;
            this.root.querySelector("[data-live-responses]").textContent = `+${Common.formatNumber(todayResponses)}`;
        },

        renderResponseTrend(points) {
            const host = this.root.querySelector("[data-response-trend]");
            if (!host) return [];
            const source = Array.isArray(points) ? points.slice(-8) : [];
            const normalized = source.map((point) => ({
                date: String(point.date || ""),
                responses: Math.max(0, Number(point.responses || 0))
            }));
            while (normalized.length < 8) normalized.unshift({ date: "", responses: 0 });
            const maximum = Math.max(1, ...normalized.map((point) => point.responses));
            host.innerHTML = normalized.map((point) => {
                const height = point.responses ? Math.max(12, Math.round((point.responses / maximum) * 100)) : 4;
                const label = point.date ? `${point.date} · ${Common.formatNumber(point.responses)}건` : `응답 ${Common.formatNumber(point.responses)}건`;
                return `<i style="--h:${height}%" title="${Common.escapeHtml(label)}"></i>`;
            }).join("");
            const total = normalized.reduce((sum, point) => sum + point.responses, 0);
            host.setAttribute("aria-label", total
                ? `최근 8일 응답 추이. 총 ${Common.formatNumber(total)}건, 오늘 ${Common.formatNumber(normalized.at(-1)?.responses || 0)}건.`
                : "최근 8일 응답이 없습니다.");
            return normalized;
        },

        renderRecent(items) {
            const host = this.root.querySelector("[data-recent-surveys]");
            if (!items.length) {
                const message = this.isVisitor
                    ? "현재는 둘러보기 상태입니다. 위에서 시작 방식을 선택하면 내 프로젝트가 여기에 표시됩니다."
                    : "아직 만든 설문이 없습니다.";
                const action = this.isVisitor ? "체험 시작하기" : "첫 설문 만들기";
                host.innerHTML = `<div class="dashboard-inline-empty"><span>${message}</span><button class="button button-small button-function button-important" data-dashboard-create>${action}</button></div>`;
                return;
            }
            host.innerHTML = items.slice(0, 4).map((item) => {
                const status = item.status || "draft";
                const statusLabel = ({ draft: "작성 중", published: "진행 중", active: "진행 중", closed: "종료", paused: "일시정지" })[status] || status;
                const shortId = String(item.id || "").slice(-8).toUpperCase();
                return `<article class="recent-item">
                    <div class="recent-title"><span class="status-badge status-${Common.escapeHtml(status)}">${statusLabel}</span><strong>${Common.escapeHtml(item.title)}</strong><small title="${Common.escapeHtml(item.id)}">${Common.escapeHtml(item.category || item.templateName || "직접 작성")} · ID ${Common.escapeHtml(shortId)}</small></div>
                    <div class="recent-meta"><span>응답</span><strong>${Common.formatNumber(item.responseCount || 0)}</strong></div>
                    <button class="button button-navigation button-icon recent-action" type="button" data-open-survey="${Common.escapeHtml(item.id)}" aria-label="${Common.escapeHtml(item.title)} 열기">→</button>
                </article>`;
            }).join("");
        },

        renderTemplateEntry() {
            const host = this.root.querySelector("[data-dashboard-template-list]");
            host.innerHTML = `<button class="template-mini-card" type="button" data-dashboard-templates><span class="template-mini-icon">＋</span><h3>새 설문 프로젝트</h3><p>기본정보를 입력한 뒤 STEP 04 설문 편집의 템플릿 레이어에서 시작 구조를 선택할 수 있습니다.</p></button>`;
        },

        destroy() {
            this.root?.removeEventListener("click", this.onClick);
            this.root = null;
            this.context = null;
            this.isVisitor = false;
        }
    };
})();
