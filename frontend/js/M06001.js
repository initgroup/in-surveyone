(function () {
    "use strict";
    const PAGE_NAME = "M06001";
    const STORAGE_KEY = "surveyone-system-preferences";
    const defaults = { density: "comfortable", motion: "system", startPage: "M01001" };

    window.Pages = window.Pages || {};
    window.Pages[PAGE_NAME] = {
        init(context) {
            this.context = context;
            this.root = context.root;
            this.form = this.root.querySelector("[data-system-settings-form]");
            this.preferences = this.readPreferences();
            Object.entries(this.preferences).forEach(([name, value]) => {
                const field = this.form.elements.namedItem(name);
                if (field) field.value = value;
            });
            this.root.querySelector("[data-system-asset-version]").textContent = window.SURVEYONE_CONFIG.assetVersion;
            this.applyPreferences();
            this.onSubmit = (event) => this.save(event);
            this.form.addEventListener("submit", this.onSubmit);
        },
        readPreferences() {
            try { return { ...defaults, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") }; }
            catch { return { ...defaults }; }
        },
        applyPreferences() {
            document.documentElement.dataset.uiDensity = this.preferences.density;
            document.documentElement.dataset.uiMotion = this.preferences.motion;
        },
        save(event) {
            event.preventDefault();
            this.preferences = {
                density: this.form.elements.density.value,
                motion: this.form.elements.motion.value,
                startPage: this.form.elements.startPage.value
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.preferences));
            this.applyPreferences();
            this.root.querySelector("[data-system-settings-state]").textContent = "이 브라우저의 작업 환경 설정을 저장했습니다.";
            this.context.toast("시스템 작업 환경 설정을 저장했습니다.", "success");
        },
        destroy() {
            this.form?.removeEventListener("submit", this.onSubmit);
            this.root = null;
        }
    };
})();
