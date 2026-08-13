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
            const params = window.SurveyOneApp.queryParams();
            this.surveyId = params.get("surveyId");
            this.recommendedTemplateId = params.get("templateId");
            this.replacementRequested = params.get("replace") === "1";
            this.applying = false;
            if (!this.surveyId) {
                this.context.toast("STEP 01에서 프로젝트 기본정보를 먼저 저장해 주세요.", "error");
                this.context.navigate("M02001", { create: "1" });
                return;
            }
            this.context.navigate("M02003", { surveyId: this.surveyId, flow: "project", template: "1", ...(this.recommendedTemplateId ? { templateId: this.recommendedTemplateId } : {}) });
            return;
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
                if (event.target.closest("[data-create-blank]")) await this.continueSurvey();
                const start = event.target.closest("[data-start-template]");
                if (start) await this.continueSurvey(start.dataset.startTemplate);
                const preview = event.target.closest("[data-preview-template]");
                if (preview) this.preview(preview.dataset.previewTemplate);
                if (event.target.closest("[data-template-guide]")) this.guide();
                const flowStep = event.target.closest("[data-template-flow]");
                if (flowStep) this.context.navigate(flowStep.dataset.templateFlow, { surveyId: this.surveyId, flow: "project" });
            };
            this.onSearch = Common.debounce(() => this.render(), 160);
            this.root.addEventListener("click", this.onClick);
            this.root.querySelector("[data-template-search]").addEventListener("input", this.onSearch);
        },
        async load() {
            try {
                const [templateResult, projectResult] = await Promise.allSettled([
                    this.context.api.get("/api/templates"),
                    this.context.api.get(`/api/surveys/${encodeURIComponent(this.surveyId)}`)
                ]);
                if (projectResult.status === "rejected") throw projectResult.reason;
                const projectPayload = projectResult.value;
                this.project = projectPayload.survey || projectPayload;
                this.root.querySelector("[data-template-project-id]").textContent = `프로젝트 ID ${this.project.id}`;
                this.root.querySelector("[data-flow-basic]").href = `#/M02001?editId=${encodeURIComponent(this.project.id)}&flow=project`;
                const replacing = this.replacementRequested || Common.questionsOf(this.project).length > 0 || Boolean(this.project.templateCode);
                this.root.querySelector("[data-template-replacement-note]").hidden = !replacing;
                if (templateResult.status === "rejected") {
                    this.items = [];
                    this.root.querySelector("[data-template-grid]").innerHTML = `<section class="empty-state project-empty"><span class="empty-icon">!</span><h2>템플릿을 불러오지 못했습니다</h2><p>${Common.escapeHtml(templateResult.reason?.message || "잠시 후 다시 시도해 주세요.")}</p><button class="button button-primary" data-create-blank>빈 설문으로 시작</button></section>`;
                    this.root.querySelector("[data-template-count]").textContent = "템플릿 연결 실패";
                    return;
                }
                const payload = templateResult.value;
                const items = payload?.items || payload?.templates || payload || [];
                this.items = Array.isArray(items) ? items : [];
                this.render();
            } catch (error) {
                this.context.toast(`프로젝트를 불러오지 못했습니다. ${error.message}`, "error");
                this.context.navigate("M02001");
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
            grid.innerHTML = items.map((item, index) => `<article class="library-card ${String(item.id || item.code) === String(this.recommendedTemplateId) ? "is-recommended" : ""}">
                <div class="library-cover" style="--cover:${coverGradients[index % coverGradients.length]}"><span class="library-cover-number">${String(index + 1).padStart(2, "0")}</span><span class="tag">${Common.escapeHtml(item.category || "일반")}</span></div>
                <div class="library-content"><h3>${Common.escapeHtml(item.name || item.title)}</h3><p>${Common.escapeHtml(item.description || "목적에 맞게 자유롭게 편집할 수 있는 기본 설문입니다.")}</p><div class="library-meta"><span>${Common.formatNumber(item.questionCount || Common.questionsOf(item).length)}개 문항</span><span>약 ${item.estimatedMinutes || Math.max(1, Math.ceil(Common.questionsOf(item).length * .35))}분</span><span>${item.hasLogic ? "분기 포함" : "기본형"}</span></div></div>
                <footer class="library-footer"><button class="button button-small" type="button" data-preview-template="${Common.escapeHtml(item.id || item.code)}">미리보기</button><button class="button button-small button-primary" type="button" data-start-template="${Common.escapeHtml(item.id || item.code)}">이 템플릿 사용</button></footer>
            </article>`).join("");
        },
        async continueSurvey(templateId = null) {
            if (this.applying || !this.project) return;
            const template = this.items.find((item) => String(item.id || item.code) === String(templateId));
            const buttons = this.root.querySelectorAll("[data-create-blank], [data-start-template]");
            try {
                const hasStructure = Common.questionsOf(this.project).length > 0 || Boolean(this.project.templateCode);
                if (hasStructure && !(await this.context.confirmMessage(
                    `${template ? `“${template.name || template.title}” 템플릿` : "빈 설문"}으로 설문 구조를 교체할까요?\n\n현재 문항·동적 조건·섹션 분기·번역은 제거됩니다. 프로젝트 기본정보·스킨·응답 UI 방식은 유지됩니다.`,
                    { title: "설문 구조 교체", confirmLabel: "구조 교체", tone: "warning", destructive: true }
                ))) return;
                this.applying = true;
                buttons.forEach((button) => { button.disabled = true; });
                if (template) {
                    const payload = await this.context.api.post(`/api/surveys/${encodeURIComponent(this.surveyId)}/template`, {
                        templateCode: template.id || template.code,
                        expectedRevision: this.project.revision
                    });
                    this.project = payload.survey || payload;
                } else if (hasStructure) {
                    const payload = await this.context.api.post(`/api/surveys/${encodeURIComponent(this.surveyId)}/template/reset`, {
                        expectedRevision: this.project.revision
                    });
                    this.project = payload.survey || payload;
                }
                this.context.toast(template ? "STEP 02 템플릿을 독립 초안으로 복사했습니다." : "빈 설문 구조를 선택했습니다.", "success");
                this.context.navigate("M02004", { surveyId: this.surveyId, flow: "new" });
            } catch (error) { this.context.toast(error.message, "error"); }
            finally {
                this.applying = false;
                if (this.root) buttons.forEach((button) => { button.disabled = false; });
            }
        },
        preview(id) {
            const item = this.items.find((candidate) => String(candidate.id || candidate.code) === String(id));
            if (!item) return;
            const questions = Common.questionsOf(item);
            const dialog = this.context.openModal(`<p class="eyebrow">TEMPLATE PREVIEW</p><h2>${Common.escapeHtml(item.name || item.title)}</h2><p class="muted">${Common.escapeHtml(item.description || "")}</p><div class="template-preview-list">${questions.slice(0, 8).map((question, index) => `<div><span>${index + 1}</span><strong>${Common.escapeHtml(question.title || question.label || "문항")}</strong><small>${Common.escapeHtml(question.type || "question")}</small></div>`).join("") || "<p>템플릿을 사용하면 기본 문항을 확인할 수 있습니다.</p>"}</div><button class="button button-primary button-block" type="button" data-preview-use>이 템플릿 사용</button>`);
            dialog.querySelector("[data-preview-use]")?.addEventListener("click", () => { dialog.close(); void this.continueSurvey(id); }, { once: true });
        },
        guide() {
            this.context.openModal(`<p class="eyebrow">DESIGN CHECKLIST</p><h2>배포 전 설문 설계 점검</h2><ol class="help-steps"><li><strong>조사 목적</strong><span>모든 문항이 의사결정 목적과 연결되는지 확인합니다.</span></li><li><strong>응답 부담</strong><span>모바일에서 10분 안에 완료할 수 있는 분량을 권장합니다.</span></li><li><strong>개인정보</strong><span>필요한 정보만 수집하고 보유 기간과 이용 목적을 고지합니다.</span></li><li><strong>사전 테스트</strong><span>분기, 필수값, 극단값, 작은 화면을 함께 점검합니다.</span></li></ol>`);
        },
        destroy() {
            this.onSearch?.cancel?.();
            this.root?.removeEventListener("click", this.onClick);
            this.root?.querySelector("[data-template-search]")?.removeEventListener("input", this.onSearch);
            this.root = null;
        }
    };
})();
