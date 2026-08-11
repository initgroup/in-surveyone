(function () {
    "use strict";
    const PAGE_NAME = "M02002";
    const coverGradients = [
        "linear-gradient(135deg,#2457d6,#183d93)",
        "linear-gradient(135deg,#0c806b,#1ebf9e)",
        "linear-gradient(135deg,#7048c8,#ae78de)",
        "linear-gradient(135deg,#c06d21,#e9a23a)",
        "linear-gradient(135deg,#183b66,#3d6794)",
        "linear-gradient(135deg,#9e3f62,#d76c91)"
    ];

    window.Pages = window.Pages || {};
    window.Pages[PAGE_NAME] = {
        async init(context) {
            this.context = context;
            this.root = context.root;
            this.items = [];
            this.category = "all";
            this.bind();
            await this.load();
        },
        bind() {
            this.onClick = async (event) => {
                const category = event.target.closest("[data-template-category]");
                if (category) {
                    this.category = category.dataset.templateCategory;
                    this.root.querySelectorAll("[data-template-category]").forEach((button) => button.setAttribute("aria-selected", String(button === category)));
                    this.render();
                }
                if (event.target.closest("[data-create-blank]")) await this.createSurvey();
                const start = event.target.closest("[data-start-template]");
                if (start) await this.createSurvey(start.dataset.startTemplate);
                const preview = event.target.closest("[data-preview-template]");
                if (preview) this.preview(preview.dataset.previewTemplate);
                if (event.target.closest("[data-template-guide]")) this.guide();
            };
            this.onSearch = Common.debounce(() => this.render(), 160);
            this.root.addEventListener("click", this.onClick);
            this.root.querySelector("[data-template-search]").addEventListener("input", this.onSearch);
        },
        async load() {
            try {
                const payload = await this.context.api.get("/api/templates");
                this.items = payload.items || payload.templates || payload || [];
                this.render();
            } catch (error) {
                this.root.querySelector("[data-template-grid]").innerHTML = `<section class="empty-state project-empty"><span class="empty-icon">!</span><h2>템플릿을 불러오지 못했습니다</h2><p>${Common.escapeHtml(error.message)}</p><button class="button button-primary" data-create-blank>빈 설문으로 시작</button></section>`;
            }
        },
        render() {
            const query = this.root.querySelector("[data-template-search]").value.trim().toLowerCase();
            const items = this.items.filter((item) => (this.category === "all" || `${item.category || ""}`.includes(this.category)) && (!query || `${item.name || item.title} ${item.description || ""}`.toLowerCase().includes(query)));
            this.root.querySelector("[data-template-count]").textContent = `${items.length}개 템플릿`;
            const grid = this.root.querySelector("[data-template-grid]");
            if (!items.length) {
                grid.innerHTML = `<section class="empty-state project-empty"><span class="empty-icon">⌕</span><h2>검색 결과가 없습니다</h2><p>다른 검색어를 입력하거나 전체 분야를 선택해보세요.</p></section>`;
                return;
            }
            grid.innerHTML = items.map((item, index) => `<article class="library-card">
                <div class="library-cover" style="--cover:${coverGradients[index % coverGradients.length]}"><span class="library-cover-number">${String(index + 1).padStart(2, "0")}</span><span class="tag">${Common.escapeHtml(item.category || "일반")}</span></div>
                <div class="library-content"><h3>${Common.escapeHtml(item.name || item.title)}</h3><p>${Common.escapeHtml(item.description || "목적에 맞게 자유롭게 편집할 수 있는 기본 설문입니다.")}</p><div class="library-meta"><span>${Common.formatNumber(item.questionCount || Common.questionsOf(item).length)}개 문항</span><span>약 ${item.estimatedMinutes || Math.max(1, Math.ceil(Common.questionsOf(item).length * .35))}분</span><span>${item.hasLogic ? "분기 포함" : "기본형"}</span></div></div>
                <footer class="library-footer"><button class="button button-small" type="button" data-preview-template="${Common.escapeHtml(item.id || item.code)}">미리보기</button><button class="button button-small button-primary" type="button" data-start-template="${Common.escapeHtml(item.id || item.code)}">이 템플릿 사용</button></footer>
            </article>`).join("");
        },
        async createSurvey(templateId = null) {
            const template = this.items.find((item) => String(item.id || item.code) === String(templateId));
            try {
                const payload = await this.context.api.post("/api/surveys", { title: template ? `${template.name || template.title} - 새 설문` : "제목 없는 설문", templateId, templateCode: templateId });
                const survey = payload.survey || payload;
                this.context.toast(template ? "템플릿으로 설문 초안을 만들었습니다." : "빈 설문을 만들었습니다.", "success");
                this.context.navigate("M02003", { surveyId: survey.id });
            } catch (error) { this.context.toast(error.message, "error"); }
        },
        preview(id) {
            const item = this.items.find((candidate) => String(candidate.id || candidate.code) === String(id));
            if (!item) return;
            const questions = Common.questionsOf(item);
            this.context.openModal(`<p class="eyebrow">TEMPLATE PREVIEW</p><h2>${Common.escapeHtml(item.name || item.title)}</h2><p class="muted">${Common.escapeHtml(item.description || "")}</p><div class="template-preview-list">${questions.slice(0, 8).map((question, index) => `<div><span>${index + 1}</span><strong>${Common.escapeHtml(question.title || question.label || "문항")}</strong><small>${Common.escapeHtml(question.type || "question")}</small></div>`).join("") || "<p>템플릿을 사용하면 기본 문항을 확인할 수 있습니다.</p>"}</div><button class="button button-primary button-block" type="button" data-preview-use>이 템플릿 사용</button>`);
            document.querySelector("[data-preview-use]")?.addEventListener("click", () => { document.querySelector("[data-modal]").close(); this.createSurvey(id); }, { once: true });
        },
        guide() {
            this.context.openModal(`<p class="eyebrow">DESIGN CHECKLIST</p><h2>배포 전 설문 설계 점검</h2><ol class="help-steps"><li><strong>조사 목적</strong><span>모든 문항이 의사결정 목적과 연결되는지 확인합니다.</span></li><li><strong>응답 부담</strong><span>모바일에서 10분 안에 완료할 수 있는 분량을 권장합니다.</span></li><li><strong>개인정보</strong><span>필요한 정보만 수집하고 보유 기간과 이용 목적을 고지합니다.</span></li><li><strong>사전 테스트</strong><span>분기, 필수값, 극단값, 작은 화면을 함께 점검합니다.</span></li></ol>`);
        },
        destroy() {
            this.root?.removeEventListener("click", this.onClick);
            this.root?.querySelector("[data-template-search]")?.removeEventListener("input", this.onSearch);
            this.root = null;
        }
    };
})();
