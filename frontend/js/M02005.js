(function () {
    "use strict";
    const PAGE_NAME = "M02005";

    window.Pages = window.Pages || {};
    window.Pages[PAGE_NAME] = {
        async init(context) {
            this.context = context;
            this.root = context.root;
            this.current = null;
            this.recommendedTemplateId = window.SurveyOneApp.queryParams().get("templateId");
            this.headerImage = null;
            this.destroyed = false;
            this.savedSkin = null;
            this.saving = false;
            this.bind();
            this.renderPresets();
            await this.loadRequestedSurvey();
        },
        bind() {
            this.onClick = (event) => {
                const preset = event.target.closest("[data-skin-preset]");
                if (preset) this.applyPreset(preset.dataset.skinPreset);
                const device = event.target.closest("[data-preview-device]");
                if (device) this.setDevice(device.dataset.previewDevice);
                if (event.target.closest("[data-save-skin]")) void this.save();
                if (event.target.closest("[data-skin-next]")) void this.save({ continueToExperience: true });
                if (event.target.closest("[data-open-skin-code]")) void this.openCustomCode();
                if (event.target.closest("[data-skin-project-list]")) this.context.navigate("M02001", { selectFor: "skin" });
                const flow = event.target.closest("[data-skin-flow-route]");
                if (flow && this.current) this.context.navigate(flow.dataset.skinFlowRoute, { ...(flow.dataset.skinFlowRoute === "M02001" ? { editId: this.current.id } : { surveyId: this.current.id }), flow: "project", ...(this.recommendedTemplateId ? { templateId: this.recommendedTemplateId } : {}) });
            };
            this.onChange = async (event) => {
                if (event.target.matches("[data-skin-header-image]")) this.previewImage(event.target.files?.[0]);
                this.updatePreview();
            };
            this.onInput = (event) => {
                if (event.target.matches("[data-skin-primary]")) this.root.querySelector("[data-skin-primary-text]").value = event.target.value;
                if (event.target.matches("[data-skin-primary-text]")) this.root.querySelector("[data-skin-primary]").value = event.target.value;
                if (event.target.matches("[data-skin-accent]")) this.root.querySelector("[data-skin-accent-text]").value = event.target.value;
                if (event.target.matches("[data-skin-accent-text]")) this.root.querySelector("[data-skin-accent]").value = event.target.value;
                this.updatePreview();
            };
            this.root.addEventListener("click", this.onClick);
            this.root.addEventListener("change", this.onChange);
            this.root.addEventListener("input", this.onInput);
        },
        renderPresets() {
            this.root.querySelector("[data-skin-presets]").innerHTML = window.SURVEYONE_CONFIG.skinPresets.map((skin) => `<button class="skin-preset" type="button" data-skin-preset="${skin.code}" aria-pressed="false"><span class="skin-preset-swatch" style="--skin-primary:${skin.primary};--skin-surface:${skin.surface};--skin-radius:${skin.radius}"><i></i><i></i></span><span><strong>${skin.name}</strong><small>${skin.primary} · ${skin.radius}</small></span></button>`).join("");
        },
        async loadRequestedSurvey() {
            const requested = window.SurveyOneApp.queryParams().get("surveyId");
            if (requested) await this.loadSurvey(requested);
            else this.root.querySelector("[data-skin-save-state]").textContent = "프로젝트 목록에서 스킨을 설정할 설문을 선택해 주세요.";
        },
        async loadSurvey(id) {
            if (!id) {
                this.current = null;
                this.customCode = window.SurveyCodeEditor.normalize();
                this.resetHeaderPreview();
                this.root.querySelector("[data-skin-project-id]").textContent = "프로젝트를 선택해 주세요.";
                this.root.querySelector("[data-save-skin]").disabled = true;
                this.root.querySelector("[data-skin-next]").disabled = true;
                this.root.querySelector("[data-open-skin-code]").disabled = true;
                this.root.querySelector("[data-skin-save-state]").textContent = "설문을 선택하면 저장할 수 있습니다. 확정된 버전은 바뀌지 않으며 다음 확정부터 반영됩니다.";
                this.renderCodeSummary();
                return;
            }
            try { const payload = await this.context.api.get(`/api/surveys/${encodeURIComponent(id)}`); this.current = payload.survey || payload; }
            catch (error) { return this.context.toast(error.message,"error"); }
            if (this.destroyed) return;
            const skin = { preset:"ocean", ...(this.current.skin || {}) };
            this.customCode = window.SurveyCodeEditor.normalize(skin.customCode);
            this.resetHeaderPreview();
            if (skin.preset) this.applyPreset(skin.preset, false);
            if (skin.primary) this.setColor("primary", skin.primary);
            if (skin.accent) this.setColor("accent", skin.accent);
            this.root.querySelector("[data-skin-font]").value = skin.font || "system";
            this.root.querySelector("[data-skin-radius]").value = skin.radius || "18px";
            this.root.querySelector("[data-skin-show-logo]").checked = Boolean(skin.showLogo);
            this.root.querySelector("[data-skin-contrast]").checked = Boolean(skin.highContrast);
            this.root.querySelector("[data-project-slug]").value = this.current.publicSlug || this.current.slug || "배포 시 자동 생성";
            this.root.querySelector("[data-project-share-title]").value = skin.shareTitle || this.current.title || "";
            this.root.querySelector("[data-project-share-description]").value = skin.shareDescription || this.current.description || "";
            this.root.querySelector("[data-skin-project-id]").textContent = `프로젝트 ID ${this.current.id}`;
            this.root.querySelector("[data-save-skin]").disabled = false;
            this.root.querySelector("[data-skin-next]").disabled = false;
            this.root.querySelector("[data-open-skin-code]").disabled = false;
            this.root.querySelector("[data-skin-save-state]").textContent = "변경 후 저장하면 이 프로젝트의 편집 초안에만 적용됩니다.";
            this.renderCodeSummary();
            this.updatePreview();
            this.savedSkin = JSON.stringify(this.collectSkin());
        },
        setColor(kind,value) { this.root.querySelector(`[data-skin-${kind}]`).value=value; this.root.querySelector(`[data-skin-${kind}-text]`).value=value; },
        applyPreset(code, update = true) { const skin = window.SURVEYONE_CONFIG.skinPresets.find((item) => item.code === code); if (!skin) return; this.setColor("primary",skin.primary); this.setColor("accent",skin.accent); this.root.querySelector("[data-skin-radius]").value=skin.radius; this.root.querySelectorAll("[data-skin-preset]").forEach((button)=>button.setAttribute("aria-pressed",String(button.dataset.skinPreset===code))); this.activePreset=code; this.updatePreview(); if (update) this.root.querySelector("[data-skin-save-state]").textContent="저장하지 않은 변경사항이 있습니다."; },
        updatePreview() { const preview=this.root.querySelector("[data-skin-preview]"); const primary=this.root.querySelector("[data-skin-primary]").value; const accent=this.root.querySelector("[data-skin-accent]").value; const radius=this.root.querySelector("[data-skin-radius]").value; const font=this.root.querySelector("[data-skin-font]").value; preview.style.setProperty("--preview-primary",primary); preview.style.setProperty("--preview-accent",accent); preview.style.setProperty("--preview-radius",radius); preview.style.setProperty("--preview-font",font==="serif"?'"Batang",serif':font==="rounded"?'"Arial Rounded MT Bold",var(--font)':'var(--font)'); preview.classList.toggle("high-contrast",this.root.querySelector("[data-skin-contrast]").checked); this.root.querySelector("[data-preview-logo]").hidden=!this.root.querySelector("[data-skin-show-logo]").checked; this.root.querySelector("[data-preview-title]").textContent=this.current?.title||"서비스 만족도 설문"; this.root.querySelector("[data-preview-description]").textContent=this.current?.description||"더 나은 서비스를 위해 여러분의 의견을 들려주세요."; },
        setDevice(device) { this.root.querySelectorAll("[data-preview-device]").forEach((button)=>button.setAttribute("aria-selected",String(button.dataset.previewDevice===device))); this.root.querySelector("[data-device-stage]").classList.toggle("is-desktop",device==="desktop"); },
        previewImage(file) { if (!file) return; if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) { this.context.toast("PNG·JPEG·WebP 이미지만 미리 볼 수 있습니다.","error"); return; } if (file.size>2*1024*1024) { this.context.toast("헤더 이미지는 2MB 이하만 미리 볼 수 있습니다.","error"); return; } if (this.headerImage) URL.revokeObjectURL(this.headerImage); this.headerImage=URL.createObjectURL(file); const header=this.root.querySelector("[data-skin-preview-header]"); header.style.backgroundImage=`linear-gradient(90deg,rgba(7,22,45,.45),rgba(7,22,45,.1)),url(${this.headerImage})`; },
        resetHeaderPreview() { if (this.headerImage) URL.revokeObjectURL(this.headerImage); this.headerImage=null; const header=this.root?.querySelector("[data-skin-preview-header]"); if (header) header.style.backgroundImage=""; const input=this.root?.querySelector("[data-skin-header-image]"); if (input) input.value=""; },
        renderCodeSummary() {
            const source = window.SurveyCodeEditor.normalize(this.customCode);
            const length = source.html.length + source.css.length + source.javascript.length;
            this.root.querySelector("[data-skin-code-state]").textContent = source.enabled ? "공개 화면 적용" : "사용 안 함";
            this.root.querySelector("[data-skin-code-summary]").textContent = length ? `HTML ${source.html.length.toLocaleString("ko-KR")}자 · CSS ${source.css.length.toLocaleString("ko-KR")}자 · JS ${source.javascript.length.toLocaleString("ko-KR")}자` : "저장된 사용자 코드가 없습니다.";
        },
        async openCustomCode() {
            if (!this.current) return;
            await window.SurveyCodeEditor.open({
                context: this.context,
                title: "STEP 02 · 공개 설문 사용자 코드",
                description: "프리셋 위에 추가할 HTML·CSS·JavaScript를 작성합니다. 확정된 버전은 바뀌지 않고 다음 저장·확정본부터 적용됩니다.",
                sources: this.customCode,
                onApply: (source) => {
                    this.customCode = source;
                    this.renderCodeSummary();
                    this.root.querySelector("[data-skin-save-state]").textContent = "저장하지 않은 사용자 코드 변경사항이 있습니다.";
                }
            });
        },
        collectSkin() { return { preset:this.activePreset||"custom", primary:this.root.querySelector("[data-skin-primary]").value, accent:this.root.querySelector("[data-skin-accent]").value, font:this.root.querySelector("[data-skin-font]").value, radius:this.root.querySelector("[data-skin-radius]").value, showLogo:this.root.querySelector("[data-skin-show-logo]").checked, highContrast:this.root.querySelector("[data-skin-contrast]").checked, customCode:window.SurveyCodeEditor.normalize(this.customCode) }; },
        async save({ continueToExperience = false } = {}) {
            if (!this.current || this.saving) return;
            this.saving = true;
            const button = this.root.querySelector("[data-save-skin]");
            const nextButton = this.root.querySelector("[data-skin-next]");
            const status = this.root.querySelector("[data-skin-save-state]");
            button.disabled = true;
            nextButton.disabled = true;
            status.textContent = "저장 중…";
            const submittedSkin = JSON.stringify(this.collectSkin());
            const skin = { ...(this.current.skin || {}), ...JSON.parse(submittedSkin) };
            try {
                const payload = await this.context.api.patch(`/api/surveys/${encodeURIComponent(this.current.id)}`, { skin, expectedRevision: this.current.revision });
                this.current = { ...this.current, ...(payload.survey || payload) };
                if (!this.destroyed) {
                    this.savedSkin = submittedSkin;
                    this.saving = false;
                    status.textContent = this.hasUnsavedChanges() ? "저장 중 추가한 변경사항을 다시 저장해 주세요." : "프로젝트 스킨을 저장했습니다.";
                    this.context.toast("응답 화면 스킨을 저장했습니다.", "success");
                    if (continueToExperience && !this.hasUnsavedChanges()) this.context.navigate("M02004", { surveyId: this.current.id, flow: "project", ...(this.recommendedTemplateId ? { templateId: this.recommendedTemplateId } : {}) });
                }
            } catch (error) {
                if (!this.destroyed) {
                    status.textContent = "저장하지 못했습니다.";
                    this.context.toast(error.message, "error");
                }
            } finally {
                this.saving = false;
                if (!this.destroyed) { button.disabled = false; nextButton.disabled = false; }
            }
        },
        hasUnsavedChanges() { return Boolean(this.current && this.savedSkin !== null && (this.saving || this.savedSkin !== JSON.stringify(this.collectSkin()))); },
        beforeLeave() {
            if (this.saving) { this.context.toast("저장이 끝난 후 이동해 주세요."); return false; }
            return !this.hasUnsavedChanges() || this.context.confirmMessage("저장하지 않은 스킨·사용자 코드 변경사항이 있습니다. 변경사항을 버리고 이동할까요?", { title: "미저장 변경사항", confirmLabel: "변경사항 버리기" });
        },
        beforeRefresh() { return this.beforeLeave(); },
        destroy() { this.destroyed=true; if(this.headerImage) URL.revokeObjectURL(this.headerImage); this.root?.removeEventListener("click",this.onClick); this.root?.removeEventListener("change",this.onChange); this.root?.removeEventListener("input",this.onInput); this.root=null; }
    };
})();
