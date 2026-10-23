(function () {
    "use strict";
    window.Pages = window.Pages || {};
    window.Pages.M01002 = {
        async init(context) {
            this.context = context;
            this.root = context.root;
            this.items = [];
            this.destroyed = false;
            this.previewDialog = null;
            this.onClick = (event) => {
                if (event.target.closest("[data-showcase-start]")) {
                    if (this.context.user) this.context.navigate("M02001", { create: "1" });
                    else this.context.openAuth("login");
                }
                if (event.target.closest("[data-showcase-scroll]")) {
                    event.preventDefault();
                    this.root.querySelector("#showcaseTemplatesTitle").focus({ preventScroll: true });
                    this.root.querySelector("#showcaseTemplates").scrollIntoView({ block: "start" });
                }
                if (event.target.closest("[data-showcase-retry]")) void this.load();
                const preview = event.target.closest("[data-showcase-preview]");
                if (preview) this.preview(preview.dataset.showcasePreview);
            };
            this.onFilter = () => this.render();
            this.root.addEventListener("click", this.onClick);
            this.root.querySelector("[data-showcase-search]").addEventListener("input", this.onFilter);
            this.root.querySelector("[data-showcase-category]").addEventListener("change", this.onFilter);
            await this.load();
        },
        async load() {
            if (this.loading) return;
            this.loading = true;
            const host = this.root.querySelector("[data-showcase-list]");
            const retry = this.root.querySelector("[data-showcase-retry]");
            host.setAttribute("aria-busy", "true");
            retry.disabled = true;
            try {
                const payload = await this.context.api.get("/api/showcase/templates");
                if (this.destroyed) return;
                this.items = Array.isArray(payload) ? payload : [];
                const select = this.root.querySelector("[data-showcase-category]");
                const selected = select.value;
                select.innerHTML = '<option value="all">전체 분야</option>' + [...new Set(this.items.map(item => item.category))].map(category => `<option value="${Common.escapeHtml(category)}">${Common.escapeHtml(category)}</option>`).join("");
                select.value = [...select.options].some(option => option.value === selected) ? selected : "all";
                this.render();
            } catch (error) {
                if (this.destroyed) return;
                this.items = [];
                this.root.querySelector("[data-showcase-count]").textContent = "불러오기 실패";
                host.innerHTML = `<p role="alert">예시 템플릿을 불러오지 못했습니다. ${Common.escapeHtml(error.message)} 새로고침 버튼으로 다시 시도해 주세요.</p>`;
            } finally {
                this.loading = false;
                if (!this.destroyed) { host.setAttribute("aria-busy", "false"); retry.disabled = false; }
            }
        },
        render() {
            const query = this.root.querySelector("[data-showcase-search]").value.trim().toLowerCase();
            const category = this.root.querySelector("[data-showcase-category]").value;
            const items = this.items.filter(item => (category === "all" || item.category === category) && `${item.title} ${item.description}`.toLowerCase().includes(query));
            this.root.querySelector("[data-showcase-count]").textContent = `${items.length}개 예시`;
            this.root.querySelector("[data-showcase-list]").innerHTML = items.map(item => `<article class="card showcase-template"><span class="eyebrow">${Common.escapeHtml(item.category)}</span><h3>${Common.escapeHtml(item.title)}</h3><p>${Common.escapeHtml(item.description)}</p><p class="showcase-template-meta">${Common.questionsOf(item).length}개 문항 · 입력은 저장되지 않습니다.</p><button class="button button-layer button-important" type="button" data-showcase-preview="${Common.escapeHtml(item.code)}" aria-label="${Common.escapeHtml(item.title)} 미리보기">응답 화면 미리보기</button></article>`).join("") || '<p role="status">조건에 맞는 예시가 없습니다. 다른 검색어나 분야를 선택해 주세요.</p>';
        },
        preview(code) {
            const item = this.items.find(candidate => candidate.code === code);
            if (!item) return;
            this.previewDialog?.close();
            const token = globalThis.crypto.randomUUID();
            const dialog = this.context.openModal(`<div class="showcase-preview-copy"><span class="eyebrow">TEMPLATE PREVIEW</span><h2>${Common.escapeHtml(item.title)}</h2><p>미리보기 입력은 저장·제출되지 않습니다. 창을 닫으면 입력 내용이 사라집니다.</p></div><iframe class="showcase-preview-frame" data-showcase-frame title="${Common.escapeHtml(item.title)} 응답 화면 미리보기" sandbox="allow-scripts"></iframe>`, { label: "템플릿 응답 화면 미리보기", wide: true });
            dialog.classList.add("showcase-preview-modal");
            this.previewDialog = dialog;
            const frame = dialog.querySelector("[data-showcase-frame]");
            const snapshot = structuredClone(item);
            const onMessage = (event) => {
                if (event.source !== frame.contentWindow || event.origin !== "null" || event.data?.token !== token || event.data?.type !== "surveyone-preview-ready") return;
                frame.contentWindow.postMessage({ type: "surveyone-preview-draft", token, draft: snapshot, locale: "ko" }, "*");
            };
            window.addEventListener("message", onMessage);
            dialog.addEventListener("close", () => { window.removeEventListener("message", onMessage); dialog.classList.remove("showcase-preview-modal"); frame.src = "about:blank"; this.previewDialog = null; }, { once: true });
            frame.src = `/frontend/public.html?preview=1&previewToken=${encodeURIComponent(token)}`;
        },
        destroy() {
            this.destroyed = true;
            this.previewDialog?.close();
            this.root?.removeEventListener("click", this.onClick);
            this.root?.querySelector("[data-showcase-search]")?.removeEventListener("input", this.onFilter);
            this.root?.querySelector("[data-showcase-category]")?.removeEventListener("change", this.onFilter);
            this.root = null;
        }
    };
})();
