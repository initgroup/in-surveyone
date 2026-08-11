(function () {
    "use strict";
    const PAGE_NAME = "M03001";

    window.Pages = window.Pages || {};
    window.Pages[PAGE_NAME] = {
        async init(context) {
            this.context = context;
            this.root = context.root;
            this.items = [];
            this.current = null;
            this.bind();
            await this.load();
        },
        bind() {
            this.onClick = async (event) => {
                const channel = event.target.closest("[data-channel]");
                if (channel) this.selectChannel(channel.dataset.channel);
                if (event.target.closest("[data-copy-public]")) await this.copy(this.publicUrl(), "응답 URL을 복사했습니다.");
                if (event.target.closest("[data-copy-embed]")) await this.copy(this.embedCode(), "삽입 코드를 복사했습니다.");
                if (event.target.closest("[data-open-public]")) window.open(this.publicUrl(), "_blank", "noopener");
                if (event.target.closest("[data-edit-survey]")) this.context.navigate("M02003", { surveyId: this.current.id });
                if (event.target.closest("[data-publish-survey]")) await this.publish();
                if (event.target.closest("[data-preview-message]")) this.previewMessage();
                if (event.target.closest("[data-download-recipient-sample]")) Common.downloadCsv("in-surveyone-recipients.csv", [["이름", "이메일", "휴대전화", "대상자코드"], ["홍길동", "sample@example.com", "010-0000-0000", "A001"]]);
                const messageChannel = event.target.closest("[data-message-channel]");
                if (messageChannel) this.root.querySelectorAll("[data-message-channel]").forEach((button) => button.setAttribute("aria-pressed", String(button === messageChannel)));
            };
            this.onChange = async (event) => { if (event.target.matches("[data-distribution-survey]")) await this.selectSurvey(event.target.value); };
            this.onInput = (event) => { if (event.target.matches("[data-message-body]")) this.root.querySelector("[data-message-count]").textContent = `${event.target.value.length} / 1,000자`; };
            this.root.addEventListener("click", this.onClick);
            this.root.addEventListener("change", this.onChange);
            this.root.addEventListener("input", this.onInput);
        },
        async load() {
            try {
                const payload = await this.context.api.get("/api/surveys");
                this.items = payload.items || payload.surveys || payload || [];
                const select = this.root.querySelector("[data-distribution-survey]");
                select.innerHTML = `<option value="">설문을 선택하세요</option>${this.items.map((item) => `<option value="${Common.escapeHtml(item.id)}">${Common.escapeHtml(item.title)} · ${this.statusLabel(item.status)}</option>`).join("")}`;
                const requested = window.SurveyOneApp.queryParams().get("surveyId");
                if (requested && this.items.some((item) => String(item.id) === requested)) { select.value = requested; await this.selectSurvey(requested); }
            } catch (error) { this.context.toast(error.message, "error"); }
        },
        async selectSurvey(id) {
            if (!id) { this.current = null; this.renderEmpty(); return; }
            try {
                const payload = await this.context.api.get(`/api/surveys/${encodeURIComponent(id)}`);
                this.current = payload.survey || payload;
            } catch (error) {
                this.current = this.items.find((item) => String(item.id) === String(id));
                if (!this.current) return this.context.toast(error.message, "error");
            }
            this.render();
        },
        renderEmpty() { this.root.querySelector("[data-distribution-title]").textContent = "설문을 선택하세요"; this.root.querySelector("[data-distribution-status]").className = "status-badge"; this.root.querySelector("[data-distribution-status]").textContent = "선택 필요"; this.root.querySelector("[data-distribution-body]").innerHTML = `<div class="distribution-empty"><span>↗</span><strong>배포할 설문을 먼저 선택하세요.</strong><p>작성 중인 설문은 확정 후 고유 응답 URL이 생성됩니다.</p></div>`; this.updateChecklist(); },
        render() {
            const published = ["published", "active"].includes(this.current.status) || Boolean(this.current.publicSlug || this.current.publicUrl);
            this.root.querySelector("[data-distribution-title]").textContent = this.current.title;
            const badge = this.root.querySelector("[data-distribution-status]");
            badge.className = `status-badge status-${published ? "published" : "draft"}`;
            badge.textContent = published ? "배포됨" : "작성 중";
            const body = this.root.querySelector("[data-distribution-body]");
            const template = this.root.querySelector(published ? "[data-published-distribution-template]" : "[data-draft-distribution-template]");
            body.innerHTML = ""; body.appendChild(template.content.cloneNode(true));
            if (published) {
                body.querySelector("[data-public-url]").value = this.publicUrl();
                body.querySelector("[data-embed-code]").value = this.embedCode();
                body.querySelector("[data-version-label]").textContent = `v${this.current.publishedVersion || this.current.version || 1}`;
                body.querySelector("[data-published-at]").textContent = Common.formatDate(this.current.publishedAt || this.current.updatedAt);
                body.querySelector("[data-distribution-response-count]").textContent = Common.formatNumber(this.current.responseCount || 0);
                body.querySelector("[data-email-subject]").value = `[설문 참여 요청] ${this.current.title}`;
                body.querySelector("[data-email-message]").value = `안녕하세요. ${this.current.title} 설문에 참여해 주세요.\n\n${this.publicUrl()}`;
                body.querySelector("[data-message-body]").value = `[IN-SURVEYONE] ${this.current.title} 참여 안내 ${this.publicUrl()}`;
                this.drawQrPreview();
            }
            this.updateChecklist();
        },
        publicUrl() { if (!this.current) return ""; const value = this.current.publicUrl || `${location.origin}/s/${this.current.publicSlug || this.current.slug || this.current.id}`; return value.startsWith("http") ? value : new URL(value, location.origin).href; },
        embedCode() { return `<iframe src="${this.publicUrl()}" title="${String(this.current?.title || "설문").replaceAll('"', '&quot;')}" width="100%" height="760" style="border:0" loading="lazy"></iframe>`; },
        statusLabel(status) { return ({ draft: "작성 중", published: "진행 중", active: "진행 중", closed: "종료", paused: "일시정지" })[status] || status || "작성 중"; },
        selectChannel(code) { this.root.querySelectorAll("[data-channel]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.channel === code))); this.root.querySelectorAll("[data-channel-panel]").forEach((panel) => { panel.hidden = panel.dataset.channelPanel !== code; }); },
        async publish() { try { const payload = await this.context.api.post(`/api/surveys/${encodeURIComponent(this.current.id)}/publish`, {}); this.current = { ...this.current, ...(payload.survey || payload), status: "published" }; this.items = this.items.map((item) => item.id === this.current.id ? { ...item, ...this.current } : item); this.render(); this.context.toast("고유 응답 URL을 만들었습니다.", "success"); } catch (error) { this.context.toast(error.message, "error"); } },
        async copy(value, message) { try { await navigator.clipboard.writeText(value); this.context.toast(message, "success"); } catch { this.context.toast("브라우저에서 복사를 허용하지 않았습니다.", "error"); } },
        updateChecklist() { const current = this.current || {}; const checks = { questions: (current.questions?.length || current.questionCount || 0) > 0, intro: Boolean(current.description || current.intro), mobile: Boolean(sessionStorage.getItem(`survey-previewed:${current.id}`)), published: ["published", "active"].includes(current.status) || Boolean(current.publicSlug || current.publicUrl) }; let count = 0; Object.entries(checks).forEach(([key, checked]) => { const input = this.root.querySelector(`[data-release-check="${key}"]`); if (input) input.checked = checked; if (checked) count += 1; }); this.root.querySelector("[data-check-progress]").textContent = `${count}/4`; },
        drawQrPreview() { const host = this.root.querySelector("[data-qr-preview]"); if (!host) return; const source = this.publicUrl(); let seed = [...source].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 2166136261); const cells = []; for (let index = 0; index < 169; index += 1) { seed = (seed * 1664525 + 1013904223) >>> 0; const row = Math.floor(index / 13), col = index % 13; const finder = (row < 4 && col < 4) || (row < 4 && col > 8) || (row > 8 && col < 4); cells.push(`<i style="opacity:${finder || seed % 3 === 0 ? 1 : 0}"></i>`); } host.innerHTML = cells.join(""); },
        previewMessage() { const email = this.root.querySelector("[data-email-message]")?.value; const message = this.root.querySelector("[data-message-body]")?.value; this.context.openModal(`<p class="eyebrow">MESSAGE PREVIEW · DEMO</p><h2>발송 내용 미리보기</h2><div class="message-preview-card">${Common.escapeHtml(email || message || "안내문을 입력하세요.").replaceAll("\n", "<br>")}</div><p class="muted">실제 발송은 기관별 이메일·문자·카카오 사업자 자격정보를 서버 비밀 저장소에 연결한 뒤 활성화됩니다.</p>`); },
        destroy() { this.root?.removeEventListener("click", this.onClick); this.root?.removeEventListener("change", this.onChange); this.root?.removeEventListener("input", this.onInput); this.root = null; }
    };
})();
