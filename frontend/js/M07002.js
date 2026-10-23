(function () {
    "use strict";
    const PAGE_NAME = "M07002";

    window.Pages = window.Pages || {};
    window.Pages[PAGE_NAME] = {
        async init(context) {
            this.context = context;
            this.root = context.root;
            this.page = 1;
            this.pageSize = 20;
            this.total = 0;
            this.items = [];
            this.query = "";
            this.memberType = "all";
            this.destroyed = false;
            if (!context.user?.systemAdmin) {
                context.toast("회원 관리는 플랫폼 관리자만 사용할 수 있습니다.", "error");
                context.navigate("M01001");
                return;
            }
            this.onClick = (event) => this.handleClick(event);
            this.onSearch = Common.debounce(() => {
                this.query = this.root.querySelector("[data-member-search]").value.trim();
                void this.load(1);
            }, 250);
            this.root.addEventListener("click", this.onClick);
            this.root.querySelector("[data-member-search]").addEventListener("input", this.onSearch);
            await this.load(1);
        },
        async load(page = this.page) {
            const host = this.root.querySelector("[data-member-list]");
            host.setAttribute("aria-busy", "true");
            host.innerHTML = '<div class="page-loading"><span class="spinner"></span><strong>가입 회원을 불러오고 있습니다.</strong></div>';
            try {
                const params = new URLSearchParams({ page: String(page), pageSize: String(this.pageSize), query: this.query, memberType: this.memberType });
                const payload = await this.context.api.get(`/api/admin/members?${params}`);
                if (this.destroyed) return;
                this.page = Number(payload.page || page);
                this.total = Number(payload.total || 0);
                this.items = Array.isArray(payload.items) ? payload.items : [];
                this.render();
            } catch (error) {
                host.innerHTML = `<div class="member-admin-error" role="alert"><strong>회원 목록을 불러오지 못했습니다.</strong><p>${Common.escapeHtml(error.message)}</p><button class="button button-function" type="button" data-member-refresh>다시 시도</button></div>`;
            } finally {
                if (!this.destroyed) host.setAttribute("aria-busy", "false");
            }
        },
        render() {
            const typeLabel = { all: "전체 계정", member: "일반 회원" }[this.memberType];
            this.root.querySelector("[data-member-count]").textContent = this.query ? `${typeLabel} 검색 결과 ${Common.formatNumber(this.total)}명` : `${typeLabel} ${Common.formatNumber(this.total)}명 · 페이지당 ${this.pageSize}명`;
            this.root.querySelectorAll("[data-member-type]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.memberType === this.memberType)));
            const host = this.root.querySelector("[data-member-list]");
            if (!this.items.length) {
                host.innerHTML = `<div class="member-admin-empty"><span class="empty-icon">⌕</span><h2>${this.query ? "검색 결과가 없습니다." : `${typeLabel}이 없습니다.`}</h2><p>${this.query ? "다른 검색어 또는 회원 분류를 선택해 주세요." : "다른 회원 분류를 선택해 확인해 주세요."}</p></div>`;
                this.renderPagination();
                return;
            }
            host.innerHTML = `<div class="member-admin-table-wrap"><table class="member-admin-table"><thead><tr><th>회원</th><th>분류</th><th>기관</th><th>이메일</th><th>권한</th><th>상태</th><th>가입·최근 로그인</th><th>관리</th></tr></thead><tbody>${this.items.map((item) => this.row(item)).join("")}</tbody></table></div>`;
            this.renderPagination();
        },
        row(item) {
            const self = String(item.id) === String(this.context.user.id);
            const withdrawn = Boolean(item.withdrawnAt);
            const active = item.active !== false && !withdrawn;
            const statusLabel = withdrawn ? "탈퇴" : active ? "이용 중" : "이용 중지";
            const statusClass = withdrawn ? "is-withdrawn" : active ? "is-active" : "is-stopped";
            const typeLabel = "일반 회원";
            const actions = withdrawn
                ? '<span class="member-admin-withdrawn-note">복구할 수 없는 탈퇴 처리 완료</span>'
                : `<div class="member-admin-actions"><button class="button button-small button-batch" type="button" data-member-password-reset="${Common.escapeHtml(item.id)}" ${self || !active ? "disabled" : ""}>비밀번호 초기화</button><button class="button button-small button-batch" type="button" data-member-status="${Common.escapeHtml(item.id)}" data-next-active="${!active}" ${self ? "disabled" : ""}>${active ? "이용 중지" : "이용 재개"}</button><button class="button button-small button-delete" type="button" data-member-withdraw="${Common.escapeHtml(item.id)}" ${self ? "disabled" : ""}>회원 탈퇴</button></div>`;
            return `<tr><td data-label="회원"><span class="member-admin-identity"><strong>${Common.escapeHtml(item.name)}</strong><small>${Common.escapeHtml(withdrawn ? "계정 정보 익명화됨" : item.loginId)}</small></span></td><td data-label="분류"><span class="member-admin-badge is-member">${typeLabel}</span></td><td data-label="기관">${Common.escapeHtml(item.organizationName)}</td><td data-label="이메일">${Common.escapeHtml(item.email || "미등록")}</td><td data-label="권한"><span class="member-admin-badge ${item.systemAdmin ? "is-admin" : ""}">${item.systemAdmin ? "플랫폼 관리자" : Common.escapeHtml(item.role || "OWNER")}</span></td><td data-label="상태"><span class="member-admin-badge ${statusClass}">${statusLabel}</span></td><td data-label="가입·로그인"><span class="member-admin-identity"><small>가입 ${Common.formatDate(item.createdAt)}</small><small>최근 ${item.lastLoginAt ? Common.formatDate(item.lastLoginAt) : "기록 없음"}</small>${withdrawn ? `<small>탈퇴 ${Common.formatDate(item.withdrawnAt)}</small>` : ""}</span></td><td data-label="관리">${actions}</td></tr>`;
        },
        renderPagination() {
            const host = this.root.querySelector("[data-member-pagination]");
            const pageCount = Math.max(1, Math.ceil(this.total / this.pageSize));
            if (!this.total) return void (host.innerHTML = "");
            const start = (this.page - 1) * this.pageSize + 1;
            const end = Math.min(this.page * this.pageSize, this.total);
            host.innerHTML = `<span>${Common.formatNumber(this.total)}명 중 ${start}–${end}</span><div><button class="button button-small button-navigation button-navigation-back" type="button" data-member-page="${this.page - 1}" ${this.page <= 1 ? "disabled" : ""}>이전</button><span class="button button-small" aria-current="page">${this.page} / ${pageCount}</span><button class="button button-small button-navigation" type="button" data-member-page="${this.page + 1}" ${this.page >= pageCount ? "disabled" : ""}>다음</button></div>`;
        },
        handleClick(event) {
            if (event.target.closest("[data-member-refresh]")) return void this.load(this.page);
            const type = event.target.closest("[data-member-type]");
            if (type) {
                this.memberType = type.dataset.memberType;
                return void this.load(1);
            }
            const page = event.target.closest("[data-member-page]");
            if (page) return void this.load(Number(page.dataset.memberPage));
            const reset = event.target.closest("[data-member-password-reset]");
            if (reset) return void this.resetPassword(reset.dataset.memberPasswordReset, reset);
            const status = event.target.closest("[data-member-status]");
            if (status) return void this.setStatus(status.dataset.memberStatus, status.dataset.nextActive === "true", status);
            const withdraw = event.target.closest("[data-member-withdraw]");
            if (withdraw) return void this.withdrawMember(withdraw.dataset.memberWithdraw, withdraw);
        },
        async resetPassword(memberId, button) {
            const item = this.items.find((candidate) => String(candidate.id) === String(memberId));
            if (!item || !(await this.context.confirmMessage(
                `${item.name} (${item.loginId}) 회원의 비밀번호를 초기화할까요?\n기존 로그인 세션이 모두 종료됩니다.`,
                { title: "회원 비밀번호 초기화", confirmLabel: "초기화", tone: "error", destructive: true }
            ))) return;
            button.disabled = true;
            try {
                const payload = await this.context.api.post(`/api/admin/members/${encodeURIComponent(memberId)}/password-reset`, {});
                const password = payload.temporaryPassword;
                const dialog = this.context.openModal(`<section class="member-password-result"><span class="eyebrow">ONE-TIME TEMPORARY PASSWORD</span><h2>임시 비밀번호가 발급되었습니다.</h2><p><strong>${Common.escapeHtml(payload.loginId)}</strong> 회원에게 안전한 별도 채널로 전달하세요.<br>이 창을 닫으면 다시 확인할 수 없습니다.</p><div class="member-password-value"><code data-member-temp-password>${Common.escapeHtml(password)}</code><button class="button button-function button-important" type="button" data-member-password-copy>복사</button></div><button class="button button-function" type="button" data-member-password-close>확인 후 닫기</button></section>`, { label: "회원 임시 비밀번호", initialFocus: "[data-member-password-copy]" });
                dialog.querySelector("[data-member-password-copy]").addEventListener("click", async (copyButton) => {
                    try { await Common.copyText(password); copyButton.currentTarget.textContent = "복사됨"; }
                    catch { this.context.toast("브라우저에서 클립보드 복사를 허용하지 않았습니다.", "error"); }
                });
                dialog.querySelector("[data-member-password-close]").addEventListener("click", () => dialog.close());
            } catch (error) {
                this.context.toast(error.message, "error");
            } finally { if (button.isConnected) button.disabled = false; }
        },
        async setStatus(memberId, active, button) {
            const item = this.items.find((candidate) => String(candidate.id) === String(memberId));
            if (!item || !(await this.context.confirmMessage(
                `${item.name} 회원의 이용을 ${active ? "재개" : "중지"}할까요?${active ? "" : "\n현재 로그인 세션이 모두 종료됩니다."}`,
                { title: `회원 이용 ${active ? "재개" : "중지"}`, confirmLabel: active ? "이용 재개" : "이용 중지", tone: active ? "info" : "warning", destructive: !active }
            ))) return;
            button.disabled = true;
            try {
                await this.context.api.patch(`/api/admin/members/${encodeURIComponent(memberId)}/status`, { active });
                this.context.toast(active ? "회원 이용을 재개했습니다." : "회원 이용을 중지하고 세션을 종료했습니다.", "success");
                await this.load(this.page);
            } catch (error) { this.context.toast(error.message, "error"); button.disabled = false; }
        },
        async withdrawMember(memberId, button) {
            const item = this.items.find((candidate) => String(candidate.id) === String(memberId));
            if (!item || item.withdrawnAt) return;
            const accountType = "일반 회원";
            const confirmed = await this.context.confirmMessage(
                `${item.name} (${item.loginId}) ${accountType} 계정을 탈퇴 처리할까요?\n\n로그인 정보·이름·이메일은 익명화되고 모든 로그인 세션이 종료됩니다. 이 작업은 복구할 수 없습니다. 설문·응답 등 업무 이력은 무결성과 보존 정책에 따라 유지됩니다.`,
                { title: `${accountType} 회원 탈퇴`, confirmLabel: "탈퇴 처리", tone: "error", destructive: true }
            );
            if (!confirmed) return;
            button.disabled = true;
            try {
                await this.context.api.delete(`/api/admin/members/${encodeURIComponent(memberId)}`);
                this.context.toast(`${accountType} 계정을 탈퇴 처리하고 개인정보를 익명화했습니다.`, "success");
                await this.load(this.page);
            } catch (error) {
                this.context.toast(error.message, "error");
                if (button.isConnected) button.disabled = false;
            }
        },
        destroy() {
            this.destroyed = true;
            this.onSearch?.cancel?.();
            this.root?.removeEventListener("click", this.onClick);
            this.root?.querySelector("[data-member-search]")?.removeEventListener("input", this.onSearch);
            this.root = null;
        }
    };
})();
