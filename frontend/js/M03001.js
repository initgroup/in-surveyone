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
                if (event.target.closest("[data-open-public]")) this.openPublic();
                const retry = event.target.closest("[data-retry-distribution]");
                if (retry) await this.selectSurvey(retry.dataset.retryDistribution);
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
                const [payload, runtime] = await Promise.all([
                    this.context.api.get("/api/surveys"),
                    this.context.api.get("/api/runtime-config").catch(() => ({}))
                ]);
                this.publicBaseUrl = runtime?.publicBaseUrl || location.origin;
                this.items = payload?.items || payload?.surveys || payload || [];
                if (!Array.isArray(this.items)) throw new Error("설문 목록 형식이 올바르지 않습니다.");
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
                this.current = payload?.survey || payload;
                if (!this.current || typeof this.current !== "object" || Array.isArray(this.current)) {
                    throw new Error("설문 상세 정보 형식이 올바르지 않습니다.");
                }
            } catch (error) {
                const summary = this.items.find((item) => String(item.id) === String(id));
                this.current = null;
                this.renderLoadError(id, summary?.title, error.message);
                this.context.toast(error.message, "error");
                return;
            }
            this.render();
        },
        renderEmpty() { this.root.querySelector("[data-distribution-title]").textContent = "설문을 선택하세요"; this.root.querySelector("[data-distribution-status]").className = "status-badge"; this.root.querySelector("[data-distribution-status]").textContent = "선택 필요"; this.root.querySelector("[data-distribution-body]").innerHTML = `<div class="distribution-empty"><span>↗</span><strong>배포할 설문을 먼저 선택하세요.</strong><p>작성 중인 설문은 확정 후 고유 응답 URL이 생성됩니다.</p></div>`; this.updateChecklist(); },
        renderLoadError(id, title, message) {
            this.root.querySelector("[data-distribution-title]").textContent = title || "설문을 불러오지 못했습니다";
            const badge = this.root.querySelector("[data-distribution-status]");
            badge.className = "status-badge status-paused";
            badge.textContent = "확인 필요";
            this.root.querySelector("[data-distribution-body]").innerHTML = `<div class="distribution-empty"><span>!</span><strong>공개 URL을 확인할 수 없습니다.</strong><p>${Common.escapeHtml(message || "설문 상세 정보를 다시 불러와 주세요.")}</p><button class="button button-primary" type="button" data-retry-distribution="${Common.escapeHtml(id)}">다시 불러오기</button></div>`;
            this.updateChecklist();
        },
        render() {
            const publicUrl = this.publicUrl();
            const publishedStatus = ["published", "active", "closed"].includes(this.current.status);
            if (publishedStatus && !publicUrl) {
                this.renderLoadError(this.current.id, this.current.title, "배포 상태이지만 서버에서 공개 URL을 제공하지 않았습니다. 설문을 다시 배포하거나 관리자에게 문의해 주세요.");
                return;
            }
            const published = Boolean(publicUrl);
            this.root.querySelector("[data-distribution-title]").textContent = this.current.title;
            const badge = this.root.querySelector("[data-distribution-status]");
            badge.className = `status-badge status-${published ? "published" : "draft"}`;
            badge.textContent = published ? "배포됨" : "작성 중";
            const body = this.root.querySelector("[data-distribution-body]");
            const template = this.root.querySelector(published ? "[data-published-distribution-template]" : "[data-draft-distribution-template]");
            body.innerHTML = ""; body.appendChild(template.content.cloneNode(true));
            if (published) {
                body.querySelector("[data-public-url]").value = publicUrl;
                body.querySelector("[data-embed-code]").value = this.embedCode();
                body.querySelector("[data-version-label]").textContent = `v${this.current.publishedVersion || this.current.version || 1}`;
                body.querySelector("[data-published-at]").textContent = Common.formatDate(this.current.publishedAt || this.current.updatedAt);
                body.querySelector("[data-distribution-response-count]").textContent = Common.formatNumber(this.current.responseCount || 0);
                body.querySelector("[data-email-subject]").value = `[설문 참여 요청] ${this.current.title}`;
                body.querySelector("[data-email-message]").value = `안녕하세요. ${this.current.title} 설문에 참여해 주세요.\n\n${publicUrl}`;
                body.querySelector("[data-message-body]").value = `[IN-SURVEYONE] ${this.current.title} 참여 안내 ${publicUrl}`;
                this.drawQrPreview();
            }
            this.updateChecklist();
        },
        publicUrl() {
            if (!this.current) return "";
            const slug = this.current.publicSlug || this.current.slug;
            const value = this.current.publicUrl || (slug ? `/s/${encodeURIComponent(slug)}` : "");
            if (!value) return "";
            try {
                const url = new URL(String(value), this.publicBaseUrl || location.origin);
                return ["http:", "https:"].includes(url.protocol) ? url.href : "";
            } catch { return ""; }
        },
        embedCode() { const url = this.publicUrl(); return url ? `<iframe src="${url}" title="${String(this.current?.title || "설문").replaceAll('"', '&quot;')}" width="100%" height="760" style="border:0" loading="lazy"></iframe>` : ""; },
        statusLabel(status) { return ({ draft: "작성 중", published: "진행 중", active: "진행 중", closed: "종료", paused: "일시정지" })[status] || status || "작성 중"; },
        selectChannel(code) { this.root.querySelectorAll("[data-channel]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.channel === code))); this.root.querySelectorAll("[data-channel-panel]").forEach((panel) => { panel.hidden = panel.dataset.channelPanel !== code; }); },
        async publish() { try { const payload = await this.context.api.post(`/api/surveys/${encodeURIComponent(this.current.id)}/publish`, {}); this.current = { ...this.current, ...(payload.survey || payload), status: "published" }; this.items = this.items.map((item) => item.id === this.current.id ? { ...item, ...this.current } : item); this.render(); if (this.publicUrl()) this.context.toast("고유 응답 URL을 만들었습니다.", "success"); else this.context.toast("배포되었지만 공개 URL을 확인하지 못했습니다.", "error"); } catch (error) { this.context.toast(error.message, "error"); } },
        async copy(value, message) { if (!value) return this.context.toast("복사할 공개 URL이 없습니다.", "error"); try { await navigator.clipboard.writeText(value); this.context.toast(message, "success"); } catch { this.context.toast("브라우저에서 복사를 허용하지 않았습니다.", "error"); } },
        openPublic() { const url = this.publicUrl(); if (!url) return this.context.toast("열 수 있는 공개 URL이 없습니다.", "error"); window.open(url, "_blank", "noopener"); },
        updateChecklist() { const current = this.current || {}; const checks = { questions: (current.questions?.length || current.questionCount || 0) > 0, intro: Boolean(current.description || current.intro), mobile: Boolean(sessionStorage.getItem(`survey-previewed:${current.id}`)), published: Boolean(this.publicUrl()) }; let count = 0; Object.entries(checks).forEach(([key, checked]) => { const input = this.root.querySelector(`[data-release-check="${key}"]`); if (input) input.checked = checked; if (checked) count += 1; }); this.root.querySelector("[data-check-progress]").textContent = `${count}/4`; },
        drawQrPreview() {
            const host = this.root.querySelector("[data-qr-preview]");
            const image = host?.querySelector("[data-qr-image]");
            const status = host?.querySelector("[data-qr-status]");
            const target = this.publicUrl();
            if (!host || !image || !status || !target) return;
            const endpoint = `/api/surveys/${encodeURIComponent(this.current.id)}/qr.svg?v=${encodeURIComponent(this.current.updatedAt || Date.now())}`;
            image.hidden = true;
            status.hidden = false;
            status.className = "qr-status";
            status.textContent = "표준 QR 코드를 생성하는 중입니다.";
            image.onload = () => {
                image.hidden = false;
                status.hidden = true;
            };
            image.onerror = () => {
                image.hidden = true;
                status.hidden = false;
                status.className = "qr-status is-error";
                status.textContent = "QR 코드를 불러오지 못했습니다. 로그인 상태와 배포본을 확인하세요.";
            };
            image.alt = `${this.current.title} 설문 참여 QR 코드`;
            image.src = endpoint;
            const download = this.root.querySelector("[data-download-qr]");
            if (download) {
                download.href = endpoint;
                download.download = `${String(this.current.slug || this.current.id).replace(/[^A-Za-z0-9._-]/g, "-")}-qr.svg`;
            }
            const targetHost = this.root.querySelector("[data-qr-target]");
            if (targetHost) targetHost.textContent = target;
            this.renderQrNetworkGuide(target);
        },
        renderQrNetworkGuide(target) {
            const guide = this.root.querySelector("[data-qr-network-guide]");
            if (!guide) return;
            let hostname = "";
            try { hostname = new URL(target).hostname.toLowerCase(); } catch { return; }
            const loopback = ["127.0.0.1", "localhost", "::1"].includes(hostname);
            const privateNetwork = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname);
            guide.className = `qr-network-guide${loopback ? " is-blocked" : privateNetwork ? " is-local" : " is-ready"}`;
            if (loopback) {
                guide.innerHTML = `<strong>휴대폰에서 열 수 없는 주소입니다.</strong><span><code>127.0.0.1</code>은 휴대폰 자기 자신을 가리킵니다. 로컬 시험 시 <code>SURVEYONE_HOST=0.0.0.0</code>, <code>SURVEYONE_BASE_URL=http://PC의-LAN-IP:8300</code>로 설정하고 같은 Wi-Fi에서 접속하세요.</span>`;
            } else if (privateNetwork) {
                guide.innerHTML = `<strong>로컬 네트워크 시험용 QR입니다.</strong><span>PC와 휴대폰을 같은 Wi-Fi에 연결하고 Windows 방화벽에서 8300 포트 접근을 허용해야 합니다.</span>`;
            } else {
                guide.innerHTML = `<strong>외부 접속 가능한 QR입니다.</strong><span>Render의 HTTPS 주소를 인코딩했습니다. 인쇄 전에 실제 휴대폰 카메라로 한 번 확인하세요.</span>`;
            }
        },
        previewMessage() { const email = this.root.querySelector("[data-email-message]")?.value; const message = this.root.querySelector("[data-message-body]")?.value; this.context.openModal(`<p class="eyebrow">MESSAGE PREVIEW · DEMO</p><h2>발송 내용 미리보기</h2><div class="message-preview-card">${Common.escapeHtml(email || message || "안내문을 입력하세요.").replaceAll("\n", "<br>")}</div><p class="muted">실제 발송은 기관별 이메일·문자·카카오 사업자 자격정보를 서버 비밀 저장소에 연결한 뒤 활성화됩니다.</p>`); },
        destroy() { this.root?.removeEventListener("click", this.onClick); this.root?.removeEventListener("change", this.onChange); this.root?.removeEventListener("input", this.onInput); this.root = null; }
    };
})();
