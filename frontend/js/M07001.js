(function () {
    "use strict";
    const PAGE_NAME = "M07001";
    const categories = ["사회조사", "청렴도", "사업체", "만족도", "교육·행사", "조직진단", "신청·수요", "기관 맞춤형"];

    function itemStatus(item) {
        const value = String(item.status || (item.active === false ? "archived" : "active")).toLowerCase();
        return ["active", "draft", "archived"].includes(value) ? value : "draft";
    }

    function sourceSurveyId(item) {
        return item.sourceSurveyId || item.draftSurveyId || item.surveyId || item.source_survey_id || null;
    }

    window.Pages = window.Pages || {};
    window.Pages[PAGE_NAME] = {
        async init(context) {
            this.context = context;
            this.root = context.root;
            this.items = [];
            this.query = "";
            this.status = "all";
            this.destroyed = false;
            this.creating = false;
            this.loadToken = 0;
            if (!context.user?.systemAdmin) {
                context.toast("공용 템플릿 관리는 플랫폼 관리자만 사용할 수 있습니다.", "error");
                context.navigate("M01001");
                return;
            }
            this.bind();
            await this.load();
        },
        bind() {
            this.onClick = (event) => {
                if (event.target.closest("[data-template-new]")) return this.createDraft();
                if (event.target.closest("[data-template-refresh]")) return this.load();
                const edit = event.target.closest("[data-template-edit]");
                if (edit) return this.editTemplate(edit.dataset.templateEdit);
                const metadata = event.target.closest("[data-template-metadata]");
                if (metadata) return this.openMetadata(metadata.dataset.templateMetadata);
                const remove = event.target.closest("[data-template-delete]");
                if (remove) return this.deleteTemplate(remove.dataset.templateDelete, remove);
            };
            this.onInput = (event) => {
                if (!event.target.matches("[data-template-search]")) return;
                this.query = event.target.value.trim().toLowerCase();
                this.render();
            };
            this.onChange = (event) => {
                if (event.target.matches("[data-template-card-status]")) {
                    return this.changeStatus(
                        event.target.dataset.templateCardStatus,
                        event.target.value,
                        event.target
                    );
                }
                if (event.target.matches("[data-template-status]")) {
                    this.status = event.target.value;
                    this.render();
                }
            };
            this.root.addEventListener("click", this.onClick);
            this.root.addEventListener("input", this.onInput);
            this.root.addEventListener("change", this.onChange);
        },
        async load() {
            const loadToken = ++this.loadToken;
            const host = this.root.querySelector("[data-template-list]");
            host.setAttribute("aria-busy", "true");
            host.innerHTML = '<div class="page-loading"><span class="spinner"></span><strong>공용 템플릿을 불러오고 있습니다.</strong></div>';
            try {
                const payload = await this.context.api.get("/api/admin/templates");
                if (this.destroyed || loadToken !== this.loadToken) return;
                const items = payload?.items || payload?.templates || payload || [];
                this.items = Array.isArray(items) ? items : [];
                this.renderSummary();
                this.render();
            } catch (error) {
                if (this.destroyed || loadToken !== this.loadToken) return;
                host.innerHTML = `<div class="template-admin-error" role="alert"><strong>공용 템플릿을 불러오지 못했습니다.</strong><p>${Common.escapeHtml(error.message)}</p><button class="button button-small" type="button" data-template-refresh>다시 시도</button></div>`;
            } finally {
                if (!this.destroyed && loadToken === this.loadToken) host.setAttribute("aria-busy", "false");
            }
        },
        renderSummary() {
            const active = this.items.filter((item) => itemStatus(item) === "active").length;
            const archived = this.items.filter((item) => itemStatus(item) === "archived").length;
            const uses = this.items.reduce((total, item) => total + Number(item.useCount || item.copyCount || 0), 0);
            this.root.querySelector("[data-template-total]").textContent = Common.formatNumber(this.items.length);
            this.root.querySelector("[data-template-active]").textContent = Common.formatNumber(active);
            this.root.querySelector("[data-template-archived]").textContent = Common.formatNumber(archived);
            this.root.querySelector("[data-template-use-count]").textContent = Common.formatNumber(uses);
        },
        render() {
            const host = this.root.querySelector("[data-template-list]");
            const filtered = this.items.filter((item) => {
                const status = itemStatus(item);
                const text = `${item.title || item.name || ""} ${item.code || item.id || ""} ${item.category || ""} ${item.description || ""}`.toLowerCase();
                return (this.status === "all" || status === this.status) && (!this.query || text.includes(this.query));
            });
            if (!filtered.length) {
                host.innerHTML = `<div class="template-admin-empty"><span class="empty-icon">▦</span><h2>${this.items.length ? "검색 조건에 맞는 템플릿이 없습니다." : "아직 공용 템플릿이 없습니다."}</h2><p>${this.items.length ? "검색어 또는 공개 상태를 바꿔 보세요." : "일반 설문 제작기에서 첫 공용 템플릿을 설계해 보세요."}</p>${this.items.length ? "" : '<button class="button button-primary" type="button" data-template-new>새 템플릿 설계</button>'}</div>`;
                return;
            }
            host.innerHTML = `<div class="template-admin-grid">${filtered.map((item) => this.cardMarkup(item)).join("")}</div>`;
        },
        cardMarkup(item) {
            const code = String(item.code || item.id || "");
            const status = itemStatus(item);
            const statusLabel = { active: "회원 공개", draft: "검토 중", archived: "보관" }[status];
            const surveyId = sourceSurveyId(item);
            const draftOnly = Boolean(item.draftOnly || item.draft_only);
            const title = item.title || item.name || "제목 없는 템플릿";
            return `<article class="template-admin-card">
                <header class="template-admin-card-header"><span class="template-admin-status is-${status}">${statusLabel}</span><span class="tag">${Common.escapeHtml(item.category || "일반")}</span><code>${Common.escapeHtml(code)}</code></header>
                <div class="template-admin-card-body"><h3>${Common.escapeHtml(title)}</h3><p>${Common.escapeHtml(item.description || "템플릿 설명을 입력해 주세요.")}</p></div>
                <dl class="template-admin-card-meta"><div><dt>버전</dt><dd>${draftOnly ? "미등록" : `v${Common.escapeHtml(item.version || item.versionNo || 1)}`}</dd></div><div><dt>문항</dt><dd>${Common.formatNumber(item.questionCount || 0)}</dd></div><div><dt>적용</dt><dd>${Common.formatNumber(item.useCount || item.copyCount || 0)}</dd></div></dl>
                <footer class="template-admin-card-footer">
                    ${draftOnly ? '<p class="template-admin-draft-note">공개 전 작업 초안 · 저장한 내용으로 계속 편집할 수 있습니다.</p>' : `<label class="template-admin-card-state"><span>공개 상태</span><select data-template-card-status="${Common.escapeHtml(code)}" data-current-status="${status}" aria-label="${Common.escapeHtml(title)} 공개 상태"><option value="active" ${status === "active" ? "selected" : ""}>회원 공개</option><option value="draft" ${status === "draft" ? "selected" : ""}>비공개·검토 중</option><option value="archived" ${status === "archived" ? "selected" : ""}>보관</option></select></label>`}
                    <div class="template-admin-card-actions"><button class="button button-small" type="button" data-template-edit="${Common.escapeHtml(code)}" aria-label="${Common.escapeHtml(title)} 편집">편집</button>${draftOnly ? "" : `<button class="button button-small" type="button" data-template-metadata="${Common.escapeHtml(code)}">정보 수정</button>`}<button class="button button-small button-danger" type="button" data-template-delete="${Common.escapeHtml(code)}">삭제</button></div>
                </footer>
            </article>`;
        },
        find(code) {
            return this.items.find((item) => String(item.code || item.id) === String(code));
        },
        async createDraft(templateCode = null) {
            if (this.creating) return;
            this.creating = true;
            const buttons = this.root.querySelectorAll("[data-template-new]");
            buttons.forEach((button) => { button.disabled = true; });
            try {
                const body = { title: templateCode ? (this.find(templateCode)?.title || "공용 템플릿") : "새 공용 템플릿" };
                if (templateCode) body.templateCode = templateCode;
                const payload = await this.context.api.post("/api/admin/templates/drafts", body);
                const surveyId = payload?.surveyId || payload?.survey?.id || payload?.id;
                if (!surveyId) throw new Error("템플릿 초안 프로젝트 ID를 받지 못했습니다.");
                this.context.navigate("M02003", { surveyId, templateAdmin: "1", ...(templateCode ? { templateCode } : {}) });
            } catch (error) {
                this.context.toast(`템플릿 초안을 만들지 못했습니다. ${error.message}`, "error");
            } finally {
                this.creating = false;
                if (this.root) buttons.forEach((button) => { button.disabled = false; });
            }
        },
        editTemplate(code) {
            const item = this.find(code);
            const surveyId = item && sourceSurveyId(item);
            if (!surveyId) return this.createDraft(code);
            const draftOnly = Boolean(item.draftOnly || item.draft_only);
            this.context.navigate("M02003", { surveyId, templateAdmin: "1", ...(draftOnly ? {} : { templateCode: code }) });
        },
        openMetadata(code) {
            const item = this.find(code);
            if (!item) return;
            const dialog = this.context.openModal(`<p class="eyebrow">TEMPLATE METADATA</p><h2>공용 템플릿 정보 수정</h2><form class="template-meta-form" data-template-meta-form>
                <label class="form-field">템플릿 코드<input type="text" value="${Common.escapeHtml(code)}" disabled></label>
                <label class="form-field">템플릿 제목<input type="text" maxlength="120" value="${Common.escapeHtml(item.title || item.name || "")}" data-meta-title required autofocus></label>
                <label class="form-field">분야<select data-meta-category required>${categories.map((category) => `<option value="${Common.escapeHtml(category)}" ${category === item.category ? "selected" : ""}>${Common.escapeHtml(category)}</option>`).join("")}</select></label>
                <label class="form-field">설명<textarea rows="4" maxlength="500" data-meta-description>${Common.escapeHtml(item.description || "")}</textarea></label>
                <p class="form-error" data-meta-error role="alert" tabindex="-1" hidden></p>
                <div class="template-meta-actions"><button class="button" type="button" data-meta-cancel>취소</button><button class="button button-primary" type="submit">저장</button></div>
            </form>`, { label: "공용 템플릿 정보 수정" });
            const form = dialog.querySelector("[data-template-meta-form]");
            dialog.querySelector("[data-meta-cancel]")?.addEventListener("click", () => dialog.close());
            form?.addEventListener("submit", async (event) => {
                event.preventDefault();
                const submit = form.querySelector('[type="submit"]');
                const errorHost = form.querySelector("[data-meta-error]");
                submit.disabled = true;
                errorHost.hidden = true;
                try {
                    await this.context.api.patch(`/api/admin/templates/${encodeURIComponent(code)}`, {
                        title: form.querySelector("[data-meta-title]").value.trim(),
                        category: form.querySelector("[data-meta-category]").value,
                        description: form.querySelector("[data-meta-description]").value.trim()
                    });
                    dialog.close();
                    this.context.toast("공용 템플릿 정보를 수정했습니다.", "success");
                    await this.load();
                } catch (error) {
                    errorHost.textContent = error.message;
                    errorHost.hidden = false;
                    submit.disabled = false;
                    errorHost.focus?.();
                }
            });
        },
        async changeStatus(code, next, select) {
            const item = this.find(code);
            if (!item) return;
            const current = itemStatus(item);
            if (next === current) return;
            if (current === "active" && next !== "active" && !(await this.context.confirmMessage(
                "회원 템플릿 라이브러리에서 공개를 중단할까요? 이미 복사된 회원 프로젝트에는 영향이 없습니다.",
                { title: "템플릿 공개 중단", confirmLabel: "공개 중단", tone: "warning" }
            ))) {
                select.value = current;
                return;
            }
            select.disabled = true;
            try {
                await this.context.api.patch(`/api/admin/templates/${encodeURIComponent(code)}`, { status: next });
                const message = {
                    active: "회원 템플릿 라이브러리에 공개했습니다.",
                    draft: "비공개 검토 상태로 변경했습니다.",
                    archived: "공용 템플릿을 보관했습니다."
                }[next];
                this.context.toast(message, "success");
                await this.load();
            } catch (error) {
                select.value = current;
                select.disabled = false;
                this.context.toast(`상태를 변경하지 못했습니다. ${error.message}`, "error");
            }
        },
        async deleteTemplate(code, button) {
            const item = this.find(code);
            if (!item) return;
            const title = item.title || item.name || code;
            const draftOnly = Boolean(item.draftOnly || item.draft_only);
            const confirmation = draftOnly
                ? `“${title}” 공개 전 작업 초안을 삭제할까요?\n\n아직 회원에게 공개되지 않은 관리자 설계 내용이 삭제됩니다.`
                : `“${title}” 공용 템플릿을 삭제할까요?\n\n템플릿 목록과 회원 선택 레이어에서는 제거되지만, 이미 복사된 회원 프로젝트와 과거 템플릿 버전 기록은 유지됩니다.`;
            if (!(await this.context.confirmMessage(confirmation, {
                title: draftOnly ? "작업 초안 삭제" : "공용 템플릿 삭제",
                confirmLabel: "삭제",
                tone: "error",
                destructive: true
            }))) return;
            button.disabled = true;
            try {
                const endpoint = draftOnly
                    ? `/api/admin/templates/drafts/${encodeURIComponent(sourceSurveyId(item))}`
                    : `/api/admin/templates/${encodeURIComponent(code)}`;
                await this.context.api.delete(endpoint);
                this.context.toast(draftOnly ? "공용 템플릿 작업 초안을 삭제했습니다." : "공용 템플릿을 삭제했습니다.", "success");
                await this.load();
            } catch (error) {
                button.disabled = false;
                this.context.toast(`템플릿을 삭제하지 못했습니다. ${error.message}`, "error");
            }
        },
        destroy() {
            this.destroyed = true;
            this.root?.removeEventListener("click", this.onClick);
            this.root?.removeEventListener("input", this.onInput);
            this.root?.removeEventListener("change", this.onChange);
            this.root = null;
        }
    };
})();
