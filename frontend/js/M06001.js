(function () {
    "use strict";
    const PAGE_NAME = "M06001";

    window.Pages = window.Pages || {};
    window.Pages[PAGE_NAME] = {
        async init(context) {
            this.context = context;
            this.root = context.root;
            this.surveys = [];
            this.current = null;
            this.headerImage = null;
            this.destroyed = false;
            this.bind();
            this.renderPresets();
            await this.loadSurveys();
        },
        bind() {
            this.onClick = (event) => {
                const preset = event.target.closest("[data-skin-preset]");
                if (preset) this.applyPreset(preset.dataset.skinPreset);
                const device = event.target.closest("[data-preview-device]");
                if (device) this.setDevice(device.dataset.previewDevice);
                if (event.target.closest("[data-save-skin]")) this.save();
            };
            this.onChange = async (event) => {
                if (event.target.matches("[data-skin-survey]")) await this.loadSurvey(event.target.value);
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
        async loadSurveys() {
            try {
                const payload = await this.context.api.get("/api/surveys");
                this.surveys = payload.items || payload.surveys || payload || [];
                const select = this.root.querySelector("[data-skin-survey]");
                select.innerHTML = `<option value="">설문을 선택하세요</option>${this.surveys.map((survey) => `<option value="${Common.escapeHtml(survey.id)}">${Common.escapeHtml(survey.title)}</option>`).join("")}`;
                const requested = window.SurveyOneApp.queryParams().get("surveyId");
                if (requested && this.surveys.some((item) => String(item.id) === requested)) { select.value = requested; await this.loadSurvey(requested); }
            } catch (error) { this.context.toast(error.message,"error"); }
        },
        async loadSurvey(id) {
            if (!id) { this.current = null; this.root.querySelector("[data-save-skin]").disabled = true; this.root.querySelector("[data-skin-save-state]").textContent = "설문을 선택하면 저장할 수 있습니다."; return; }
            try { const payload = await this.context.api.get(`/api/surveys/${encodeURIComponent(id)}`); this.current = payload.survey || payload; }
            catch (error) { return this.context.toast(error.message,"error"); }
            const skin = { preset:"ocean", ...(this.current.skin || {}) };
            if (skin.preset) this.applyPreset(skin.preset, false);
            if (skin.primary) this.setColor("primary", skin.primary);
            if (skin.accent) this.setColor("accent", skin.accent);
            this.root.querySelector("[data-skin-font]").value = skin.font || "system";
            this.root.querySelector("[data-skin-radius]").value = skin.radius || "18px";
            this.root.querySelector("[data-skin-show-logo]").checked = Boolean(skin.showLogo);
            this.root.querySelector("[data-skin-contrast]").checked = Boolean(skin.highContrast);
            this.root.querySelector("[data-project-slug]").value = this.current.publicSlug || this.current.slug || "배포 시 자동 생성";
            this.root.querySelector("[data-project-share-title]").value = this.current.shareTitle || this.current.title || "";
            this.root.querySelector("[data-project-share-description]").value = this.current.shareDescription || this.current.description || "";
            this.root.querySelector("[data-save-skin]").disabled = false;
            this.root.querySelector("[data-skin-save-state]").textContent = "변경 후 저장하면 이 프로젝트에만 적용됩니다.";
            this.updatePreview();
        },
        setColor(kind,value) { this.root.querySelector(`[data-skin-${kind}]`).value=value; this.root.querySelector(`[data-skin-${kind}-text]`).value=value; },
        applyPreset(code, update = true) { const skin = window.SURVEYONE_CONFIG.skinPresets.find((item) => item.code === code); if (!skin) return; this.setColor("primary",skin.primary); this.setColor("accent",skin.accent); this.root.querySelector("[data-skin-radius]").value=skin.radius; this.root.querySelectorAll("[data-skin-preset]").forEach((button)=>button.setAttribute("aria-pressed",String(button.dataset.skinPreset===code))); this.activePreset=code; this.updatePreview(); if (update) this.root.querySelector("[data-skin-save-state]").textContent="저장하지 않은 변경사항이 있습니다."; },
        updatePreview() { const preview=this.root.querySelector("[data-skin-preview]"); const primary=this.root.querySelector("[data-skin-primary]").value; const accent=this.root.querySelector("[data-skin-accent]").value; const radius=this.root.querySelector("[data-skin-radius]").value; const font=this.root.querySelector("[data-skin-font]").value; preview.style.setProperty("--preview-primary",primary); preview.style.setProperty("--preview-accent",accent); preview.style.setProperty("--preview-radius",radius); preview.style.setProperty("--preview-font",font==="serif"?'"Batang",serif':font==="rounded"?'"Arial Rounded MT Bold",var(--font)':'var(--font)'); preview.classList.toggle("high-contrast",this.root.querySelector("[data-skin-contrast]").checked); this.root.querySelector("[data-preview-logo]").hidden=!this.root.querySelector("[data-skin-show-logo]").checked; this.root.querySelector("[data-preview-title]").textContent=this.current?.title||"서비스 만족도 설문"; this.root.querySelector("[data-preview-description]").textContent=this.current?.description||"더 나은 서비스를 위해 여러분의 의견을 들려주세요."; },
        setDevice(device) { this.root.querySelectorAll("[data-preview-device]").forEach((button)=>button.setAttribute("aria-selected",String(button.dataset.previewDevice===device))); this.root.querySelector("[data-device-stage]").classList.toggle("is-desktop",device==="desktop"); },
        previewImage(file) { if (!file) return; if (file.size>2*1024*1024) { this.context.toast("헤더 이미지는 2MB 이하만 미리 볼 수 있습니다.","error"); return; } if (this.headerImage) URL.revokeObjectURL(this.headerImage); this.headerImage=URL.createObjectURL(file); const header=this.root.querySelector("[data-skin-preview-header]"); header.style.backgroundImage=`linear-gradient(90deg,rgba(7,22,45,.45),rgba(7,22,45,.1)),url(${this.headerImage})`; },
        collectSkin() { return { preset:this.activePreset||"custom", primary:this.root.querySelector("[data-skin-primary]").value, accent:this.root.querySelector("[data-skin-accent]").value, font:this.root.querySelector("[data-skin-font]").value, radius:this.root.querySelector("[data-skin-radius]").value, showLogo:this.root.querySelector("[data-skin-show-logo]").checked, highContrast:this.root.querySelector("[data-skin-contrast]").checked }; },
        async save() {
            if (!this.current) return;
            const button = this.root.querySelector("[data-save-skin]");
            const status = this.root.querySelector("[data-skin-save-state]");
            button.disabled = true;
            status.textContent = "저장 중…";
            const sections = Array.isArray(this.current.sections) && this.current.sections.length
                ? structuredClone(this.current.sections)
                : [{ id: `section_${this.current.id}`, title: "설문 문항", description: "", questions: structuredClone(this.current.questions || []) }];
            const updated = {
                title: this.current.title,
                description: this.current.description || "",
                category: this.current.category || "일반",
                sections,
                settings: structuredClone(this.current.settings || {}),
                theme: structuredClone(this.current.theme || {}),
                skin: this.collectSkin(),
                logicRules: structuredClone(this.current.logicRules || [])
            };
            const shareTitle = this.root.querySelector("[data-project-share-title]").value;
            const shareDescription = this.root.querySelector("[data-project-share-description]").value;
            updated.skin.shareTitle = shareTitle;
            updated.skin.shareDescription = shareDescription;
            try {
                const payload = await this.context.api.put(`/api/surveys/${encodeURIComponent(this.current.id)}`, updated);
                this.current = { ...this.current, ...(payload.survey || payload), shareTitle, shareDescription };
                if (!this.destroyed) {
                    status.textContent = "프로젝트 스킨을 저장했습니다.";
                    this.context.toast("응답 화면 스킨을 저장했습니다.", "success");
                }
            } catch (error) {
                if (!this.destroyed) {
                    status.textContent = "저장하지 못했습니다.";
                    this.context.toast(error.message, "error");
                }
            } finally {
                if (!this.destroyed) button.disabled = false;
            }
        },
        destroy() { this.destroyed=true; if(this.headerImage) URL.revokeObjectURL(this.headerImage); this.root?.removeEventListener("click",this.onClick); this.root?.removeEventListener("change",this.onChange); this.root?.removeEventListener("input",this.onInput); this.root=null; }
    };
})();
