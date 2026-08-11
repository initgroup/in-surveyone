(function () {
    "use strict";
    const PAGE_NAME = "M02001";
    const statusLabels = { draft: "작성 중", published: "진행 중", active: "진행 중", closed: "종료", paused: "일시정지" };

    window.Pages = window.Pages || {};
    window.Pages[PAGE_NAME] = {
        async init(context) {
            this.context = context;
            this.root = context.root;
            this.items = [];
            this.filter = "all";
            this.view = localStorage.getItem("surveyone-project-view") || "grid";
            this.bind();
            await this.load();
        },
        bind() {
            this.onClick = async (event) => {
                if (event.target.closest("[data-project-create]")) return this.context.navigate("M02002");
                const status = event.target.closest("[data-status-filter]");
                if (status) {
                    this.filter = status.dataset.statusFilter;
                    this.root.querySelectorAll("[data-status-filter]").forEach((button) => button.setAttribute("aria-selected", String(button === status)));
                    this.render();
                }
                const view = event.target.closest("[data-view]");
                if (view) {
                    this.view = view.dataset.view;
                    localStorage.setItem("surveyone-project-view", this.view);
                    this.root.querySelectorAll("[data-view]").forEach((button) => button.setAttribute("aria-selected", String(button === view)));
                    this.render();
                }
                const open = event.target.closest("[data-open-id]");
                if (open) this.context.navigate("M02003", { surveyId: open.dataset.openId });
                const publish = event.target.closest("[data-publish-id]");
                if (publish) await this.publish(publish.dataset.publishId);
                const share = event.target.closest("[data-share-id]");
                if (share) this.context.navigate("M03001", { surveyId: share.dataset.shareId });
                const more = event.target.closest("[data-more-id]");
                if (more) this.showActions(more.dataset.moreId);
            };
            this.onSearch = Common.debounce(() => this.render(), 180);
            this.onSort = () => this.render();
            this.root.addEventListener("click", this.onClick);
            this.root.querySelector("[data-project-search]").addEventListener("input", this.onSearch);
            this.root.querySelector("[data-project-sort]").addEventListener("change", this.onSort);
            const initialView = this.root.querySelector(`[data-view="${this.view}"]`);
            if (initialView) {
                this.root.querySelectorAll("[data-view]").forEach((button) => button.setAttribute("aria-selected", String(button === initialView)));
            }
        },
        async load() {
            try {
                const payload = await this.context.api.get("/api/surveys");
                this.items = payload.items || payload.surveys || payload || [];
                this.root.querySelector("[data-count-all]").textContent = this.items.length;
                this.render();
            } catch (error) {
                this.items = [];
                this.render(error.message);
            }
        },
        render(errorMessage) {
            const query = this.root.querySelector("[data-project-search]").value.trim().toLowerCase();
            const sort = this.root.querySelector("[data-project-sort]").value;
            let items = this.items.filter((item) => {
                const normalizedStatus = item.status === "active" ? "published" : item.status;
                return (this.filter === "all" || normalizedStatus === this.filter) && (!query || `${item.title} ${item.category || ""}`.toLowerCase().includes(query));
            });
            items.sort((a, b) => {
                if (sort === "responses") return (b.responseCount || 0) - (a.responseCount || 0);
                return new Date(sort === "created" ? b.createdAt : b.updatedAt || b.createdAt) - new Date(sort === "created" ? a.createdAt : a.updatedAt || a.createdAt);
            });
            const grid = this.root.querySelector("[data-project-grid]");
            grid.className = `project-grid ${this.view === "list" ? "is-list" : ""}`;
            if (!items.length) {
                grid.innerHTML = `<section class="empty-state project-empty"><span class="empty-icon">${errorMessage ? "!" : "＋"}</span><h2>${errorMessage ? "프로젝트를 불러오지 못했습니다" : "조건에 맞는 설문이 없습니다"}</h2><p>${Common.escapeHtml(errorMessage || "새 프로젝트를 만들거나 검색 조건을 바꿔보세요.")}</p><button class="button button-primary" data-project-create>${errorMessage ? "새 설문 만들기" : "첫 설문 만들기"}</button></section>`;
                return;
            }
            grid.innerHTML = items.map((item) => this.cardMarkup(item)).join("");
        },
        cardMarkup(item) {
            const status = item.status === "active" ? "published" : (item.status || "draft");
            const published = status === "published";
            const count = item.responseCount || 0;
            const started = item.startedResponseCount || count;
            const completion = item.completionRate ?? (started ? Math.round(count / started * 100) : 0);
            return `<article class="project-card">
                <header class="project-card-head"><span class="status-badge status-${Common.escapeHtml(status)}">${statusLabels[status] || status}</span><button class="icon-button project-more" type="button" data-more-id="${Common.escapeHtml(item.id)}" aria-label="${Common.escapeHtml(item.title)} 프로젝트 메뉴">•••</button></header>
                <button class="project-card-main" type="button" data-open-id="${Common.escapeHtml(item.id)}"><span class="project-category">${Common.escapeHtml(item.category || item.templateName || "직접 작성")}</span><h3>${Common.escapeHtml(item.title)}</h3><p>${Common.escapeHtml(item.description || "설문 설명을 입력해 주세요.")}</p></button>
                <dl class="project-stats"><div><dt>문항</dt><dd>${Common.formatNumber(item.questionCount || item.questions?.length || 0)}</dd></div><div><dt>응답</dt><dd>${Common.formatNumber(count)}</dd></div><div><dt>완료율</dt><dd>${completion}%</dd></div></dl>
                <footer class="project-card-footer"><span>${Common.formatDate(item.updatedAt || item.createdAt)} 수정</span><div class="project-card-actions">${published ? `<button class="button button-small" type="button" data-share-id="${Common.escapeHtml(item.id)}">배포</button>` : `<button class="button button-small button-primary" type="button" data-publish-id="${Common.escapeHtml(item.id)}">확정</button>`}<button class="button button-small" type="button" data-open-id="${Common.escapeHtml(item.id)}">편집</button></div></footer>
            </article>`;
        },
        async publish(id) {
            try {
                const result = await this.context.api.post(`/api/surveys/${encodeURIComponent(id)}/publish`, {});
                const updated = result.survey || result;
                this.items = this.items.map((item) => item.id === id ? { ...item, ...updated, status: updated.status || "published" } : item);
                this.render();
                this.context.toast("설문을 확정하고 고유 응답 URL을 만들었습니다.", "success");
            } catch (error) { this.context.toast(error.message, "error"); }
        },
        showActions(id) {
            const item = this.items.find((candidate) => String(candidate.id) === String(id));
            if (!item) return;
            const dialog = this.context.openModal(`<p class="eyebrow">PROJECT ACTIONS</p><h2>${Common.escapeHtml(item.title)}</h2><div class="project-action-menu"><button class="button" data-modal-edit>설문 편집</button><button class="button" data-modal-share>배포 센터</button><button class="button" data-modal-report>결과 보고서</button></div>`);
            dialog.querySelector("[data-modal-edit]").addEventListener("click", () => { dialog.close(); this.context.navigate("M02003", { surveyId: id }); });
            dialog.querySelector("[data-modal-share]").addEventListener("click", () => { dialog.close(); this.context.navigate("M03001", { surveyId: id }); });
            dialog.querySelector("[data-modal-report]").addEventListener("click", () => { dialog.close(); this.context.navigate("M05001", { surveyId: id }); });
        },
        destroy() {
            this.root?.removeEventListener("click", this.onClick);
            this.root?.querySelector("[data-project-search]")?.removeEventListener("input", this.onSearch);
            this.root?.querySelector("[data-project-sort]")?.removeEventListener("change", this.onSort);
            this.root = null;
        }
    };
})();
