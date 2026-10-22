(function () {
    "use strict";
    const PAGE_NAME = "M02004";

    window.Pages = window.Pages || {};
    window.Pages[PAGE_NAME] = {
        async init(context) {
            this.context = context;
            this.root = context.root;
            this.surveyId = window.SurveyOneApp.queryParams().get("surveyId");
            this.recommendedTemplateId = window.SurveyOneApp.queryParams().get("templateId");
            this.mode = "scroll";
            this.savedSettings = null;
            this.saving = false;
            this.skin = { preset: "ocean" };
            if (!this.surveyId) {
                context.toast("STEP 01에서 프로젝트 기본정보를 먼저 저장해 주세요.", "error");
                context.navigate("M02001", { create: "1" });
                return;
            }
            this.bind();
            await this.load();
        },
        bind() {
            this.onClick = (event) => {
                const choice = event.target.closest("[data-presentation-mode]");
                if (choice) this.select(choice.dataset.presentationMode);
                const skin = event.target.closest("[data-experience-skin-preset]");
                if (skin) this.selectSkin(skin.dataset.experienceSkinPreset);
                if (event.target.closest("[data-experience-basic]")) this.context.navigate("M02001", { editId: this.surveyId, flow: "project", ...(this.recommendedTemplateId ? { templateId: this.recommendedTemplateId } : {}) });
                if (event.target.closest("[data-experience-project-list]")) this.context.navigate("M02001");
                if (event.target.closest("[data-experience-skin]")) this.context.navigate("M02005", { surveyId: this.surveyId, flow: "project", ...(this.recommendedTemplateId ? { templateId: this.recommendedTemplateId } : {}) });
                if (event.target.closest("[data-experience-editor]")) this.context.navigate("M02003", { surveyId: this.surveyId, flow: "project", ...(this.recommendedTemplateId ? { templateId: this.recommendedTemplateId, template: "1" } : {}) });
                if (event.target.closest("[data-experience-next]")) void this.saveAndContinue();
            };
            this.onKeydown = (event) => {
                if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
                const card = event.target.closest("[data-presentation-mode]");
                if (!card) return;
                event.preventDefault();
                this.select(card.dataset.presentationMode === "scroll" ? "one_at_a_time" : "scroll", { focus: true });
            };
            this.root.addEventListener("click", this.onClick);
            this.root.addEventListener("keydown", this.onKeydown);
        },
        async load() {
            const errorBox = this.root.querySelector("[data-experience-error]");
            try {
                const payload = await this.context.api.get(`/api/surveys/${encodeURIComponent(this.surveyId)}`);
                this.survey = payload.survey || payload;
                this.mode = this.survey.settings?.presentationMode || "scroll";
                this.skin = { preset: "ocean", ...(this.survey.skin || {}) };
                this.root.querySelector("[data-experience-project-id]").textContent = `프로젝트 ID ${this.survey.id}`;
                this.renderSkins();
                this.selectSkin(this.skin.preset, { updateSkin: false });
                this.select(this.mode);
                this.savedSettings = this.settingsSnapshot();
            } catch (error) {
                this.saving = false;
                errorBox.textContent = error.message;
                errorBox.hidden = false;
                errorBox.focus();
                this.root.querySelector("[data-experience-next]").disabled = true;
            }
        },
        select(mode, { focus = false } = {}) {
            this.mode = mode === "one_at_a_time" ? mode : "scroll";
            this.root.querySelectorAll("[data-presentation-mode]").forEach((card) => {
                const selected = card.dataset.presentationMode === this.mode;
                card.setAttribute("aria-checked", String(selected));
                card.tabIndex = selected ? 0 : -1;
                if (selected && focus) card.focus();
            });
        },
        renderSkins() {
            this.root.querySelector("[data-experience-skins]").innerHTML = window.SURVEYONE_CONFIG.skinPresets.map((skin) => `<button type="button" data-experience-skin-preset="${skin.code}" style="--skin-color:${skin.primary}" aria-pressed="false"><i></i><span>${skin.name}</span></button>`).join("");
        },
        selectSkin(code, { updateSkin = true } = {}) {
            const preset = window.SURVEYONE_CONFIG.skinPresets.find((item) => item.code === code) || window.SURVEYONE_CONFIG.skinPresets[0];
            if (updateSkin) this.skin = { ...this.skin, preset: preset.code, primary: preset.primary, accent: preset.accent, radius: preset.radius };
            this.root.style.setProperty("--experience-primary", this.skin.primary || preset.primary);
            this.root.style.setProperty("--experience-accent", this.skin.accent || preset.accent);
            this.root.style.setProperty("--experience-radius", this.skin.radius || preset.radius);
            this.root.querySelector("[data-experience-skin-name]").textContent = `${preset.name} · STEP 02에서 세부 조정 가능`;
            this.root.querySelectorAll("[data-experience-skin-preset]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.experienceSkinPreset === preset.code)));
        },
        async saveAndContinue() {
            if (!this.survey || this.saving) return;
            this.saving = true;
            const button = this.root.querySelector("[data-experience-next]");
            const errorBox = this.root.querySelector("[data-experience-error]");
            button.disabled = true;
            errorBox.hidden = true;
            try {
                const settings = { ...(this.survey.settings || {}), presentationMode: this.mode };
                delete settings.showProgress;
                delete settings.oneResponse;
                delete settings.allowEdit;
                const submitted = this.settingsSnapshot();
                const payload = await this.context.api.patch(`/api/surveys/${encodeURIComponent(this.surveyId)}`, { settings, skin: this.skin, expectedRevision: this.survey.revision });
                this.survey = { ...this.survey, ...(payload.survey || payload) };
                this.savedSettings = submitted;
                this.saving = false;
                if (this.hasUnsavedChanges()) {
                    button.disabled = false;
                    this.context.toast("저장 중 추가한 변경사항을 다시 저장해 주세요.");
                    return;
                }
                this.context.toast("STEP 03 응답 UI 방식을 저장했습니다.", "success");
                this.context.navigate("M02003", { surveyId: this.surveyId, flow: "project", ...(this.recommendedTemplateId ? { templateId: this.recommendedTemplateId, template: "1" } : {}) });
            } catch (error) {
                this.saving = false;
                errorBox.textContent = error.message;
                errorBox.hidden = false;
                errorBox.focus();
                button.disabled = false;
            }
        },
        settingsSnapshot() { return JSON.stringify({ mode: this.mode, skin: this.skin }); },
        hasUnsavedChanges() { return this.savedSettings !== null && (this.saving || this.savedSettings !== this.settingsSnapshot()); },
        beforeLeave() {
            if (this.saving) { this.context.toast("저장이 끝난 후 이동해 주세요."); return false; }
            return !this.hasUnsavedChanges() || this.context.confirmMessage("저장하지 않은 응답 UI 변경사항이 있습니다. 변경사항을 버리고 이동할까요?", { title: "미저장 변경사항", confirmLabel: "변경사항 버리기" });
        },
        beforeRefresh() { return this.beforeLeave(); },
        destroy() {
            this.root?.removeEventListener("click", this.onClick);
            this.root?.removeEventListener("keydown", this.onKeydown);
            this.root = null;
        }
    };
})();
