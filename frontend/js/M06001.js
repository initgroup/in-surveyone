(function () {
    "use strict";
    const PAGE_NAME = "M06001";

    window.Pages = window.Pages || {};
    window.Pages[PAGE_NAME] = {
        async init(context) {
            this.context = context;
            this.root = context.root;
            this.form = this.root.querySelector("[data-system-settings-form]");
            this.preferences = Common.preferences.read();
            Object.entries(this.preferences).forEach(([name, value]) => {
                const field = this.form.elements.namedItem(name);
                if (field) field.value = value;
            });
            this.root.querySelector("[data-system-asset-version]").textContent = window.SURVEYONE_CONFIG.assetVersion;
            Common.preferences.apply(this.preferences);
            this.onSubmit = (event) => this.save(event);
            this.form.addEventListener("submit", this.onSubmit);
            this.policy = null;
            this.policySaving = false;
            this.policyForm = this.root.querySelector("[data-login-policy-form]");
            this.onPolicySubmit = (event) => { event.preventDefault(); void this.saveLoginPolicy(); };
            this.onPolicyReload = async () => {
                if (this.hasUnsavedChanges() && !(await this.context.confirmMessage("저장하지 않은 로그인 정책 변경을 버리고 다시 불러올까요?"))) return;
                await this.loadLoginPolicy();
            };
            this.onPolicyChange = () => {
                this.root.querySelector("[data-login-policy-state]").textContent = this.hasUnsavedChanges() ? "저장하지 않은 변경사항" : "저장된 정책입니다.";
            };
            if (context.user?.systemAdmin) {
                this.root.querySelector("[data-login-policy-access]").hidden = true;
                this.policyForm.hidden = false;
                this.policyForm.addEventListener("submit", this.onPolicySubmit);
                this.policyForm.addEventListener("change", this.onPolicyChange);
                this.root.querySelector("[data-login-policy-reload]").addEventListener("click", this.onPolicyReload);
                await this.loadLoginPolicy();
            }
        },
        save(event) {
            event.preventDefault();
            const next = {
                density: this.form.elements.density.value,
                motion: this.form.elements.motion.value,
                startPage: this.form.elements.startPage.value
            };
            try {
                this.preferences = Common.preferences.save(next);
                this.root.querySelector("[data-system-settings-state]").textContent = "이 브라우저의 작업 환경 설정을 저장했습니다.";
                this.context.toast("시스템 작업 환경 설정을 저장했습니다.", "success");
            } catch {
                this.root.querySelector("[data-system-settings-state]").textContent = "브라우저 저장소를 사용할 수 없어 저장하지 못했습니다.";
                this.context.toast("환경 설정을 저장하지 못했습니다. 브라우저의 저장소 허용 설정을 확인해 주세요.", "error");
            }
        },
        async loadLoginPolicy() {
            if (this.policySaving) return false;
            this.policyLoading = true;
            this.setPolicyBusy(true);
            const root = this.root;
            try {
                const policy = await this.context.api.get("/api/system-settings/login-policy");
                if (this.root !== root) return false;
                this.policy = policy;
                this.policyForm.elements.allowConcurrentLogins.checked = policy.allowConcurrentLogins;
                root.querySelector("[data-login-policy-state]").textContent = policy.allowConcurrentLogins ? "중복 로그인 허용 중" : "중복 로그인 제한 중 · 새 로그인만 유지";
                return true;
            } catch (error) {
                if (this.root === root) root.querySelector("[data-login-policy-state]").textContent = error.message;
                return false;
            } finally {
                this.policyLoading = false;
                if (this.root === root) this.setPolicyBusy(false);
            }
        },
        setPolicyBusy(busy) {
            this.policyForm.elements.allowConcurrentLogins.disabled = busy || !this.policy;
            this.root.querySelector("[data-login-policy-save]").disabled = busy || !this.policy;
            this.root.querySelector("[data-login-policy-reload]").disabled = busy;
        },
        async saveLoginPolicy() {
            if (!this.policy || this.policySaving || this.policyLoading) return false;
            this.policySaving = true;
            this.setPolicyBusy(true);
            const root = this.root;
            try {
                const policy = await this.context.api.put("/api/system-settings/login-policy", {
                    allowConcurrentLogins: this.policyForm.elements.allowConcurrentLogins.checked,
                    revision: this.policy.revision
                });
                if (this.root !== root) return false;
                this.policy = policy;
                this.policyForm.elements.allowConcurrentLogins.checked = policy.allowConcurrentLogins;
                root.querySelector("[data-login-policy-state]").textContent = "전체 계정의 로그인 정책을 저장했습니다.";
                this.context.toast("로그인 정책을 저장했습니다.", "success");
                return true;
            } catch (error) {
                if (this.root === root) root.querySelector("[data-login-policy-state]").textContent = error.message;
                return false;
            } finally {
                this.policySaving = false;
                if (this.root === root) this.setPolicyBusy(false);
            }
        },
        hasUnsavedChanges() {
            return Boolean(this.policy && this.policyForm && this.policy.allowConcurrentLogins !== this.policyForm.elements.allowConcurrentLogins.checked);
        },
        async beforeLeave() {
            if (this.policySaving) { this.context.toast("로그인 정책 저장이 끝난 뒤 이동하세요.", "info"); return false; }
            return !this.hasUnsavedChanges() || await this.context.confirmMessage("저장하지 않은 로그인 정책 변경을 버리고 이동할까요?");
        },
        async beforeRefresh() { return this.beforeLeave(); },
        destroy() {
            this.form?.removeEventListener("submit", this.onSubmit);
            this.policyForm?.removeEventListener("submit", this.onPolicySubmit);
            this.policyForm?.removeEventListener("change", this.onPolicyChange);
            this.root?.querySelector("[data-login-policy-reload]")?.removeEventListener("click", this.onPolicyReload);
            this.policyForm = null;
            this.root = null;
        }
    };
})();
