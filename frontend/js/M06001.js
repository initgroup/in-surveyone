(function () {
    "use strict";
    const PAGE_NAME = "M06001";

    window.Pages = window.Pages || {};
    window.Pages[PAGE_NAME] = {
        init(context) {
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
        destroy() {
            this.form?.removeEventListener("submit", this.onSubmit);
            this.root = null;
        }
    };
})();
