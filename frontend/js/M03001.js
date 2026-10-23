(function () {
    "use strict";

    const PAGE_NAME = "M03001";
    const CHANNELS = [
        { code: "EMAIL", provider: "email", field: "email", label: "이메일", icon: "@", placeholder: "name@example.com" },
        { code: "SMS", provider: "sms", field: "mobile", label: "문자", icon: "M", placeholder: "010-0000-0000" },
        { code: "KAKAO", provider: "kakao", field: "kakaoId", label: "카카오", icon: "K", placeholder: "카카오 수신 휴대전화" },
        { code: "FAX", provider: "fax", field: "fax", label: "팩스", icon: "F", placeholder: "02-000-0000" }
    ];
    const BASE_LOCALES = [
        { code: "ko", label: "한국어", nativeLabel: "한국어" },
        { code: "en", label: "영어", nativeLabel: "English" },
        { code: "ja", label: "일본어", nativeLabel: "日本語" },
        { code: "zh", label: "중국어", nativeLabel: "中文" },
        { code: "vi", label: "베트남어", nativeLabel: "Tiếng Việt" },
        { code: "fil", label: "필리핀어", nativeLabel: "Filipino" }
    ];
    const COUNTRIES = [
        { code: "KR", label: "대한민국", locale: "ko" },
        { code: "US", label: "미국·영어권", locale: "en" },
        { code: "JP", label: "일본", locale: "ja" },
        { code: "CN", label: "중국", locale: "zh" },
        { code: "VN", label: "베트남", locale: "vi" },
        { code: "PH", label: "필리핀", locale: "fil" },
        { code: "ZZ", label: "기타", locale: "en" }
    ];
    const STEP_TITLES = {
        1: "대상자",
        2: "미리보기·발송"
    };

    const KAKAO_STARTERS = Object.freeze([
        { id: "invitation", name: "설문 참여 요청", content: "#{이름} 고객님\n\n#{설문명} 설문 참여를 안내드립니다.\n\n- 설문URL바로가기 : #{설문URL}\n\n감사합니다." },
        { id: "reminder", name: "설문 참여 재안내", content: "#{이름} 고객님\n\n#{설문명} 설문 참여를 다시 안내드립니다. 이미 참여하셨다면 추가 응답은 필요하지 않습니다.\n\n- 설문URL바로가기 : #{설문URL}\n\n감사합니다." },
        { id: "closing", name: "설문 마감 안내", content: "#{이름} 고객님\n\n#{설문명} 설문 마감일은 #{마감일}입니다. 기간 안에 참여 부탁드립니다.\n\n- 설문URL바로가기 : #{설문URL}\n\n감사합니다." }
    ]);

    function uid(prefix = "recipient") {
        return `${prefix}_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
    }

    function arrayPayload(payload) {
        const items = payload?.items || payload?.surveys || payload || [];
        return Array.isArray(items) ? items : [];
    }

    function upper(value) {
        return String(value || "").trim().toUpperCase();
    }

    window.Pages = window.Pages || {};
    window.Pages[PAGE_NAME] = {
        async init(context) {
            this.context = context;
            this.root = context.root;
            this.items = [];
            clearTimeout(this.previewTimer);
            this.previewRequestId = (this.previewRequestId || 0) + 1;
            this.current = null;
            this.publishedSurvey = null;
            this.draft = null;
            this.providers = this.normalizeProviders({});
            this.publicBaseUrl = null;
            this.step = 1;
            this.stepScrollPositions = {};
            this.maxStep = 1;
            this.view = localStorage.getItem("surveyone-distribution-view") || "grid";
            this.dirty = false;
            this.saving = false;
            this.actionBusy = false;
            this.sending = false;
            this.individualSearch = "";
            this.individualPage = 0;
            this.executionResult = null;
            this.recipientPage = 1;
            this.recipientPageSize = 25;
            this.activeRecipientId = null;
            this.recipientUndo = null;
            this.importingRecipients = false;
            this.deliveryDefaults = {};
            this.kakaoTemplates = [];
            this.previewSignature = null;
            this.previewOffset = 0;
            this.sendResult = null;
            this.bind();
            await this.load();
        },

        bind() {
            this.onClick = async (event) => {
                this.root.querySelectorAll(".distribution-help[open], .distribution-channel-advanced[open], .distribution-project-context[open], .distribution-preview-picker[open]").forEach((help) => {
                    if (!help.contains(event.target)) help.open = false;
                });
                if (event.target.closest("[data-history-load]")) return this.loadDeliveryHistory(0);
                const historyPage = event.target.closest("[data-history-page]");
                if (historyPage) return this.loadDeliveryHistory(Number(historyPage.dataset.historyPage));
                if (event.target.closest("[data-open-delivery-history]")) {
                    return this.openDeliveryResults();
                }
                const layout = event.target.closest("[data-distribution-layout]");
                if (layout) return this.changeLayout(layout.dataset.distributionLayout);
                const projectUrls = event.target.closest("[data-project-url-management]");
                if (projectUrls) return this.openProjectUrls(projectUrls.dataset.projectUrlManagement || this.current?.id);
                const open = event.target.closest("[data-open-distribution-project]");
                if (open) return this.openProject(open.dataset.openDistributionProject);
                if (event.target.closest("[data-distribution-project-back]")) return this.backToProjects();
                if (event.target.closest("[data-undo-recipient-paste]")) return this.undoRecipientPaste();
                const applyImport = event.target.closest("[data-apply-recipient-import]");
                if (applyImport) return this.applyRecipientImport(applyImport.dataset.applyRecipientImport);
                if (event.target.closest("[data-cancel-recipient-import]")) return this.clearRecipientImport();
                const templateLibrary = event.target.closest("[data-manage-kakao-templates]");
                if (templateLibrary) return this.openKakaoTemplateLibrary(templateLibrary.dataset.manageKakaoTemplates);
                const composeChannel = event.target.closest("[data-compose-channel]");
                if (composeChannel) return this.selectComposeChannel(composeChannel.dataset.composeChannel);
                if (event.target.closest("[data-select-direct-receiver]")) return this.selectDirectReceiver();
                const individual = event.target.closest("[data-individual-recipient]");
                if (individual) return this.selectIndividualRecipient(individual.dataset.individualRecipient);
                const individualPage = event.target.closest("[data-individual-page]");
                if (individualPage) { this.individualPage = Number(individualPage.dataset.individualPage); return this.renderIndividualRecipients(); }
                if (event.target.closest("[data-edit-receivers]")) {
                    this.goStep(1);
                    const id = this.draft.deliveryOptions.individualRecipientId;
                    const index = this.draft.recipients.findIndex((item) => item.id === id);
                    if (index >= 0) { this.recipientPage = Math.floor(index / this.recipientPageSize) + 1; this.activeRecipientId = id; this.renderRecipients(); }
                    return;
                }
                if (event.target.closest("[data-preview-delivery]")) return this.previewDelivery();
                const previewRecipient = event.target.closest("[data-preview-recipient]");
                if (previewRecipient) {
                    this.previewRecipientId = previewRecipient.dataset.previewRecipient;
                    const picker = this.root.querySelector("[data-bulk-preview-picker]");
                    picker.open = false;
                    picker.querySelector("summary").focus({ preventScroll: true });
                    this.renderPreviewRecipients();
                    return this.previewDelivery({ silent: true });
                }
                const previewPage = event.target.closest("[data-preview-recipient-page]");
                if (previewPage) { this.previewRecipientPage = Number(previewPage.dataset.previewRecipientPage); return this.renderPreviewRecipients(); }
                const previewChannel = event.target.closest("[data-preview-channel]");
                if (previewChannel) { this.previewChannel = previewChannel.dataset.previewChannel; return this.renderDeliveryPreview(); }
                if (event.target.closest("[data-resume-delivery]")) return this.resumeDelivery();
                if (event.target.closest("[data-refresh-delivery]")) return this.refreshDeliveryStatus();
                const loadTemplates = event.target.closest("[data-load-kakao-templates]");
                if (loadTemplates) return this.loadKakaoTemplates(loadTemplates.dataset.loadKakaoTemplates);
                if (event.target.closest("[data-add-recipient]")) return this.addRecipient();
                if (event.target.closest("[data-import-recipient]")) return this.root.querySelector("[data-recipient-file]").click();
                if (event.target.closest("[data-download-recipient-sample]")) return this.downloadRecipientSample();
                if (event.target.closest("[data-download-recipient-xlsx]")) return this.downloadRecipientExcelSample();
                const recipientPage = event.target.closest("[data-recipient-page]");
                if (recipientPage && !recipientPage.disabled) return this.changeRecipientPage(Number(recipientPage.dataset.recipientPage));
                const remove = event.target.closest("[data-remove-recipient]");
                if (remove) return this.removeRecipient(remove.dataset.removeRecipient);
                const replaceContact = event.target.closest("[data-replace-recipient-contact]");
                if (replaceContact) return this.replaceMaskedContact(replaceContact);
                const target = event.target.closest("[data-distribution-step-target]");
                if (target && !target.disabled) return this.goStep(Number(target.dataset.distributionStepTarget));
                if (event.target.closest("[data-distribution-previous]")) return this.goStep(Math.max(1, this.step - 1));
                if (event.target.closest("[data-distribution-next]")) return this.nextStep();
                if (event.target.closest("[data-distribution-save]")) return this.saveDraft();
                if (event.target.closest("[data-distribution-execute]")) return this.execute();
                if (event.target.closest("[data-apply-default-sender]")) return this.applyDefaultSender();
                if (event.target.closest("[data-edit-survey-languages]")) return this.context.navigate("M02003", { surveyId: this.current.id });
                const emailEditor = event.target.closest("[data-edit-email-html]");
                if (emailEditor) return this.openEmailEditor(emailEditor.dataset.editEmailHtml);
                const copy = event.target.closest("[data-copy-language-url]");
                if (copy) return this.copyLanguageUrl(copy.dataset.copyLanguageUrl);
                const row = event.target.closest("[data-recipient-row]");
                if (row) this.selectRecipient(row.dataset.recipientRow, Boolean(event.target.closest("[data-open-recipient-detail]")));
            };
            this.onInput = (event) => {
                if (event.target.matches("[data-direct-receiver]")) return this.markDirty();
                if (event.target.matches("[data-individual-search]")) {
                    this.individualSearch = event.target.value;
                    this.individualPage = 0;
                    return this.renderIndividualRecipients();
                }
                if (event.target.matches("[data-preview-search]")) {
                    this.previewSearch = event.target.value;
                    this.previewRecipientPage = 0;
                    return this.renderPreviewRecipients();
                }
                const deliveryOption = event.target.closest("[data-delivery-option]");
                if (deliveryOption) { this.draft.deliveryOptions[deliveryOption.dataset.deliveryOption] = deliveryOption.value.trim(); return this.markDirty(); }
                const variable = event.target.closest("[data-kakao-variable]");
                if (variable) { this.draft.messagesByLanguage[variable.dataset.locale].kakaoVariables[variable.dataset.kakaoVariable] = variable.value; return this.markDirty(); }
                if (event.target.matches("[data-distribution-search]")) return this.searchDebounced();
                const field = event.target.closest("[data-recipient-field]");
                if (field) return this.updateRecipientField(field);
                const message = event.target.closest("[data-message-field]");
                if (message) return this.updateMessageField(message);
                if (event.target.matches("[data-scheduled-at]")) {
                    this.draft.schedule.scheduledAt = this.scheduledIso(event.target.value);
                    this.markDirty();
                }
            };
            this.onChange = async (event) => {
                if (event.target.name === "sendScope") return this.changeSendScope(event.target.value);
                if (event.target.name === "individualContact") return this.selectComposeChannel(event.target.value);
                if (event.target.matches("[data-delivery-consent]")) return this.syncPreviewAction();
                if (event.target.matches("[data-history-survey], [data-history-status]")) return this.loadDeliveryHistory(0);
                if (event.target.matches("[data-recipient-selected]")) {
                    const recipient = this.recipientByElement(event.target);
                    if (recipient) recipient.selected = event.target.checked;
                    if (recipient) this.syncRecipientEditors(recipient);
                    this.clearRecipientUndo();
                    this.updateRecipientSelection(); return this.markDirty();
                }
                if (event.target.matches("[data-select-all-recipients]")) {
                    this.draft.recipients.forEach((item) => { item.selected = event.target.checked; });
                    this.clearRecipientUndo();
                    this.renderRecipients(); return this.markDirty();
                }
                if (event.target.matches("[data-message-preset]")) return this.applyMessagePreset(event.target);
                if (event.target.matches("[data-kakao-template]")) return this.selectKakaoTemplate(event.target);
                if (event.target.matches("[data-distribution-filter], [data-distribution-sort]")) return this.renderProjects();
                if (event.target.matches("[data-recipient-file]")) return this.importRecipients(event.target.files?.[0]);
                const field = event.target.closest("[data-recipient-field]");
                if (field) return this.updateRecipientField(field, true);
                const recipientChannel = event.target.closest("[data-recipient-channel]");
                if (recipientChannel) return this.updateRecipientChannel(recipientChannel);
                const channel = event.target.closest("[data-distribution-channel]");
                if (channel) return this.updateSelectedChannel(channel);
                const priority = event.target.closest("[data-channel-priority]");
                if (priority) return this.updateChannelPriority(priority);
                if (event.target.name === "deliveryStrategy") {
                    this.draft.schedule.strategy = event.target.value;
                    return this.markDirty();
                }
                if (event.target.name === "scheduleMode") {
                    this.draft.schedule.mode = event.target.value;
                    this.syncScheduleField();
                    return this.markDirty();
                }
            };
            this.onRecipientFocus = (event) => {
                if (!event.target.matches("[data-recipient-grid-cell]")) return;
                const recipient = this.recipientByElement(event.target);
                if (recipient) this.selectRecipient(recipient.id);
            };
            this.onRecipientPaste = (event) => this.pasteRecipientCells(event);
            this.onRecipientKeyDown = (event) => {
                if (event.key === "Escape") {
                    this.root.querySelectorAll(".distribution-help[open], .distribution-channel-advanced[open], .distribution-project-context[open], .distribution-preview-picker[open]").forEach((help) => {
                        help.open = false;
                        help.querySelector("summary").focus();
                    });
                }
                this.moveRecipientCell(event);
            };
            this.root.addEventListener("focusin", this.onRecipientFocus);
            this.root.addEventListener("paste", this.onRecipientPaste);
            this.root.addEventListener("keydown", this.onRecipientKeyDown);
            this.searchDebounced = Common.debounce(() => this.renderProjects(), 180);
            this.root.addEventListener("click", this.onClick);
            this.root.addEventListener("input", this.onInput);
            this.root.addEventListener("change", this.onChange);
            const selectedView = this.root.querySelector(`[data-distribution-layout="${this.view}"]`);
            if (selectedView) this.changeLayout(this.view, false);
        },

        async load() {
            let loadError = null;
            try {
                const [surveys, runtime, providers] = await Promise.all([
                    this.context.api.get("/api/surveys?status=published"),
                    this.context.api.get("/api/runtime-config"),
                    this.context.api.get("/api/deployments/providers").catch((error) => ({ loadError: error.message }))
                ]);
                if (!runtime?.publicBaseUrl) throw new Error("공개 주소 설정을 불러오지 못했습니다. 다시 시도해 주세요.");
                this.publicBaseUrl = runtime.publicBaseUrl;
                this.providers = this.normalizeProviders(providers);
                this.deliveryDefaults = { senderNumber: providers?.defaultSender || "", kakaoPfId: providers?.kakaoPfId || "" };
                this.items = arrayPayload(surveys).filter((item) => this.isFinalized(item));
                this.populateCategoryFilter();
                this.root.querySelector("[data-history-survey]").innerHTML = '<option value="">전체 프로젝트 (종료된 설문 포함)</option>' + this.items.map((item) => `<option value="${Common.escapeHtml(item.id)}">${Common.escapeHtml(item.title)}</option>`).join("");
            } catch (error) {
                this.items = [];
                loadError = error.message;
            }
            this.root.querySelector("[data-finalized-count]").textContent = Common.formatNumber(this.items.length);
            this.renderProjects(loadError);
            const requested = window.SurveyOneApp.queryParams().get("surveyId");
            if (requested) {
                const found = this.items.some((item) => String(item.id) === String(requested));
                if (found) await this.openProject(requested);
                else this.context.toast("확정된 배포 대상 프로젝트를 찾을 수 없습니다.", "error");
            }
        },

        isFinalized(item) {
            const status = String(item?.status || "").toLowerCase();
            return ["published", "active"].includes(status) || Number(item?.publishedVersion || 0) > 0;
        },

        populateCategoryFilter() {
            const select = this.root.querySelector("[data-distribution-filter]");
            const categories = [...new Set(this.items.map((item) => String(item.category || "기타").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
            select.innerHTML = `<option value="all">전체 분류</option>${categories.map((category) => `<option value="${Common.escapeHtml(category)}">${Common.escapeHtml(category)}</option>`).join("")}`;
        },

        changeLayout(view, render = true) {
            this.view = view === "list" ? "list" : "grid";
            localStorage.setItem("surveyone-distribution-view", this.view);
            this.root.querySelectorAll("[data-distribution-layout]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.distributionLayout === this.view)));
            if (render) this.renderProjects();
        },

        renderProjects(errorMessage = null) {
            const query = this.root.querySelector("[data-distribution-search]").value.trim().toLowerCase();
            const filter = this.root.querySelector("[data-distribution-filter]").value;
            const sort = this.root.querySelector("[data-distribution-sort]").value;
            let items = this.items.filter((item) => {
                const haystack = `${item.title || ""} ${item.category || ""} ${item.id || ""}`.toLowerCase();
                return (filter === "all" || String(item.category || "기타") === filter) && (!query || haystack.includes(query));
            });
            items.sort((a, b) => {
                if (sort === "responses") return Number(b.responseCount || 0) - Number(a.responseCount || 0);
                if (sort === "title") return String(a.title || "").localeCompare(String(b.title || ""), "ko");
                return new Date(b.publishedAt || b.updatedAt || b.createdAt || 0) - new Date(a.publishedAt || a.updatedAt || a.createdAt || 0);
            });
            const grid = this.root.querySelector("[data-distribution-project-grid]");
            grid.className = `distribution-project-grid${this.view === "list" ? " is-list" : ""}`;
            if (!items.length) {
                grid.innerHTML = `<section class="empty-state distribution-project-empty"><span class="empty-icon">${errorMessage ? "!" : "↗"}</span><h2>${errorMessage ? "확정 프로젝트를 불러오지 못했습니다" : "배포할 수 있는 확정 프로젝트가 없습니다"}</h2><p>${Common.escapeHtml(errorMessage || "설문 편집기에서 문항을 저장하고 확정한 뒤 다시 확인해 주세요.")}</p><button class="button button-navigation button-important" type="button" data-go-projects>설문 프로젝트로 이동</button></section>`;
                grid.querySelector("[data-go-projects]")?.addEventListener("click", () => this.context.navigate("M02001"));
                return;
            }
            grid.innerHTML = items.map((item) => this.projectCardMarkup(item)).join("");
        },

        projectCardMarkup(item) {
            const responses = Number(item.responseCount || 0);
            const version = Number(item.publishedVersion || item.version || 1);
            const deploymentStatus = String(item.deploymentStatus || "").toUpperCase();
            const deploymentLabel = ({ DRAFT: "배포 설정 저장됨", QUEUED: "발송 대기", RUNNING: "발송 중", COMPLETE: "발송 완료", DISABLED: "발송 보류" })[deploymentStatus] || "대상·채널 설정";
            const publicUrl = this.publicUrlFor(item);
            const startsAt = item.startsAt || item.starts_at;
            const closesAt = item.closesAt || item.closes_at;
            const formatPeriod = (value, fallback) => value
                ? `${Common.formatDate(value, { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" })} KST`
                : fallback;
            const periodMarkup = `<span class="distribution-project-period"><small>설문 기간 · M02001 설정</small><strong>${Common.escapeHtml(formatPeriod(startsAt, "즉시 시작"))} ~ ${Common.escapeHtml(formatPeriod(closesAt, "종료 제한 없음"))}</strong></span>`;
            const urlMarkup = publicUrl
                ? `<div class="distribution-project-public-url"><span>설문 URL</span><a href="${Common.escapeHtml(publicUrl)}" target="_blank" rel="noopener noreferrer" title="${Common.escapeHtml(publicUrl)}"><code>${Common.escapeHtml(publicUrl)}</code><b aria-hidden="true">↗</b><span class="sr-only">새 탭에서 설문 열기</span></a><small>${Common.formatDate(item.publishedAt || item.updatedAt)} 확정</small></div>`
                : `<span>${Common.formatDate(item.publishedAt || item.updatedAt)} 확정</span>`;
            return `<article class="distribution-project-card"><header><span class="status-badge status-published">확정 v${version}</span><span class="distribution-project-state">${deploymentLabel}</span></header><button type="button" class="distribution-project-main" data-open-distribution-project="${Common.escapeHtml(item.id)}"><span class="project-category">${Common.escapeHtml(item.category || "설문")}</span><h3>${Common.escapeHtml(item.title || "제목 없는 설문")}</h3><span class="project-id">프로젝트 ID <code>${Common.escapeHtml(item.id)}</code></span>${item.description ? `<p>${Common.escapeHtml(item.description)}</p>` : ""}${periodMarkup}</button><dl><div><dt>확정 버전</dt><dd>v${version}</dd></div><div><dt>문항</dt><dd>${Common.formatNumber(item.questionCount || 0)}</dd></div><div><dt>응답</dt><dd>${Common.formatNumber(responses)}</dd></div></dl><footer>${urlMarkup}<div class="distribution-project-url-actions"><button class="button button-small button-navigation" type="button" data-project-url-management="${Common.escapeHtml(item.id)}">프로젝트 URL 관리</button><button class="button button-small button-function button-important" type="button" data-open-distribution-project="${Common.escapeHtml(item.id)}">배포 작업</button></div></footer></article>`;
        },

        async openProjectUrls(surveyId) {
            if (!surveyId || this.saving || this.sending || this.actionBusy) return;
            try {
                await window.SurveyPublicationLinks.open({
                    context: this.context, surveyId, baseUrl: this.publicBaseUrl,
                    onRegenerate: (result) => {
                        if (!this.root || this.context.isCurrentRoute?.() === false) return;
                        const previous = this.current?.id === surveyId ? this.publicUrl() : null;
                        const item = this.items.find((candidate) => candidate.id === surveyId);
                        if (item) Object.assign(item, { slug: result.slug, publicSlug: result.slug, publicUrl: result.publicUrl });
                        if (this.current?.id === surveyId) {
                            Object.assign(this.current, { slug: result.slug, publicSlug: result.slug, publicUrl: result.publicUrl });
                            this.replaceDraftPublicUrl(previous, this.publicUrl());
                            this.renderMessages();
                            this.markDirty();
                        } else this.renderProjects();
                    }
                });
            } catch (error) { this.context.toast(error.message, "error"); }
        },
        async openProject(id) {
            try {
                const [detailPayload, deploymentPayload] = await Promise.all([
                    this.context.api.get(`/api/surveys/${encodeURIComponent(id)}`),
                    this.context.api.get(`/api/deployments/by-survey/${encodeURIComponent(id)}`).catch((error) => {
                        if (error.status === 404) return null;
                        throw error;
                    })
                ]);
                this.current = detailPayload?.survey || detailPayload;
                if (!this.current || !this.isFinalized(this.current)) throw new Error("확정된 프로젝트만 배포할 수 있습니다.");
                this.publishedSurvey = await this.loadPublishedSurveyState(this.current);
                this.draft = this.normalizeDraft(deploymentPayload?.deployment || deploymentPayload);
                this.lastExecutionRevision = this.draft.executionStatus ? this.draft.revision : null;
                this.awaitingDeliveryEdit = false;
                this.clearDirectReceiver();
                this.draft.deliveryOptions.sendScope ||= "BULK";
                this.individualSearch = ""; this.individualPage = 0;
                if (!this.draft.channels.length) this.draft.channels = [this.providerReady("KAKAO") ? "KAKAO" : this.providerReady("SMS") ? "SMS" : "KAKAO"];
                this.activeChannel = this.draft.channels[0];
                this.clearRecipientImport();
                this.clearRecipientUndo();
                this.activeRecipientId = null;
                this.recipientPage = 1;
                this.step = 1;
                this.stepScrollPositions = {};
                this.maxStep = 2;
                this.previewSignature = null;
                this.previewRecipientId = null;
                this.previewSearch = "";
                this.previewRecipientPage = 0;
                this.previewItems = [];
                this.sendResult = null;
                this.kakaoTemplates = [];
                this.root.querySelector("[data-delivery-consent]").checked = false;
                this.dirty = false;
                this.executionResult = deploymentPayload?.execution || (this.draft.executionStatus ? deploymentPayload : null);
                this.root.querySelector("[data-distribution-project-view]").hidden = true;
                this.root.querySelector("[data-distribution-workflow]").hidden = false;
                this.root.querySelector("[data-distribution-survey-title]").textContent = this.current.title;
                this.root.querySelector("[data-distribution-project-id]").textContent = this.current.id;
                this.root.querySelector("[data-distribution-version]").textContent = `v${this.current.publishedVersion || this.current.version || 1}`;
                this.renderProjectContext();
                this.renderProviderAlert();
                this.renderRecipients();
                this.renderChannels();
                this.renderRecipientScope();
                this.renderMessages();
                this.renderExecutionResult(this.executionResult);
                this.updateWorkflow();
                this.root.querySelector("[data-distribution-title]").focus({ preventScroll: true });
                if (this.draft.executionStatus) { await this.refreshDeliveryStatus(); this.enableDirectEditing(); }
            } catch (error) {
                this.context.toast(error.message, "error");
            }
        },

        normalizeDraft(raw) {
            const candidate = raw && typeof raw === "object" ? raw : {};
            const recipients = Array.isArray(candidate.recipients) ? candidate.recipients.map((item) => this.normalizeRecipient(item)) : [];
            const rawChannels = Array.isArray(candidate.channels) ? candidate.channels : [];
            const channels = rawChannels.map((item) => upper(typeof item === "string" ? item : item?.code)).filter((code) => CHANNELS.some((channel) => channel.code === code));
            const schedule = candidate.schedule && typeof candidate.schedule === "object" ? candidate.schedule : {};
            const requestedPriority = Array.isArray(schedule.priority) ? schedule.priority.map(upper).filter((code) => CHANNELS.some((channel) => channel.code === code)) : ["KAKAO", "SMS", "EMAIL", "FAX"];
            const priority = [...new Set([...requestedPriority, ...CHANNELS.map((item) => item.code)])];
            return {
                revision: candidate.revision ?? null,
                recipients: recipients.length ? recipients : [this.blankRecipient()],
                channels: [...new Set(channels)],
                messagesByLanguage: candidate.messagesByLanguage && typeof candidate.messagesByLanguage === "object" ? structuredClone(candidate.messagesByLanguage) : {},
                deliveryOptions: { ...this.deliveryDefaults, ...(candidate.deliveryOptions || {}) },
                schedule: {
                    mode: upper(schedule.mode || "NOW") === "SCHEDULED" ? "SCHEDULED" : "NOW",
                    scheduledAt: schedule.scheduledAt || null,
                    strategy: upper(schedule.strategy || "ALL_AVAILABLE") === "PRIORITY_FALLBACK" ? "PRIORITY_FALLBACK" : "ALL_AVAILABLE",
                    priority
                },
                status: upper(candidate.status || "DRAFT") || "DRAFT",
                executionStatus: upper(candidate.executionStatus || "") || null
            };
        },

        blankRecipient() {
            return { id: uid(), name: "", countryCode: "KR", preferredLanguage: this.defaultLocale(), email: "", mobile: "", fax: "", kakaoId: "", channels: [], selected: true, audienceCode: null };
        },

        normalizeRecipient(item) {
            const channels = Array.isArray(item?.channels) ? item.channels.map((value) => upper(typeof value === "string" ? value : value?.code)).filter((code) => CHANNELS.some((channel) => channel.code === code)) : [];
            return {
                id: String(item?.id || uid()),
                name: String(item?.name || ""),
                countryCode: upper(item?.countryCode || "KR"),
                preferredLanguage: this.localeCode(item?.preferredLanguage || this.defaultLocale()),
                email: String(item?.email || ""),
                mobile: String(item?.mobile || ""),
                fax: String(item?.fax || ""),
                kakaoId: String(item?.kakaoId || ""),
                channels: [...new Set(channels)],
                selected: item?.selected !== false,
                audienceCode: item?.audienceCode || null
            };
        },

        localeCode(value) {
            const raw = String(value || "ko").trim().replaceAll("_", "-");
            try { return Intl.getCanonicalLocales(raw)[0] || "ko"; }
            catch { return "ko"; }
        },

        enabledLocales() {
            const source = this.publishedSurvey || this.current;
            const languages = source?.languages || {};
            const raw = languages.enabled || source?.supportedLocales || [languages.defaultLocale || this.current?.defaultLocale || "ko"];
            const locales = [...new Set((Array.isArray(raw) ? raw : [raw]).map((value) => this.localeCode(typeof value === "string" ? value : value?.code)))];
            const defaultLocale = this.defaultLocale();
            if (!locales.includes(defaultLocale)) locales.unshift(defaultLocale);
            return locales;
        },

        defaultLocale() {
            const source = this.publishedSurvey || this.current;
            return this.localeCode(source?.languages?.defaultLocale || source?.defaultLocale || "ko");
        },

        localeCatalog() {
            const configured = Array.isArray(window.SURVEYONE_CONFIG?.locales) ? window.SURVEYONE_CONFIG.locales : [];
            const catalog = [...BASE_LOCALES];
            configured.forEach((item) => {
                const code = this.localeCode(item.code);
                if (!catalog.some((entry) => entry.code.toLowerCase() === code.toLowerCase())) catalog.push({ ...item, code });
            });
            this.enabledLocales().forEach((code) => {
                if (!catalog.some((item) => item.code.toLowerCase() === code.toLowerCase())) catalog.push({ code, label: code, nativeLabel: code });
            });
            return catalog;
        },

        localeLabel(code) {
            const canonical = this.localeCode(code);
            const locale = this.localeCatalog().find((item) => item.code.toLowerCase() === canonical.toLowerCase());
            return locale ? locale.label === locale.nativeLabel ? locale.label : `${locale.label} · ${locale.nativeLabel}` : canonical;
        },

        normalizeProviders(raw) {
            const source = raw?.providers || raw?.providerConfigured || raw?.provider_configured || raw || {};
            const loadError = raw?.loadError;
            const normalized = {};
            CHANNELS.forEach((channel) => {
                const candidate = source[channel.provider] ?? source[channel.code] ?? source[channel.code.toLowerCase()];
                const object = candidate && typeof candidate === "object" ? candidate : {};
                const configured = typeof candidate === "boolean"
                    ? candidate
                    : Boolean(object.enabled ?? object.available ?? object.configured ?? ["READY", "ENABLED", "ACTIVE"].includes(upper(object.status)));
                normalized[channel.code] = {
                    configured,
                    providerCode: object.providerCode || object.provider || (configured ? channel.provider : "disabled"),
                    reason: object.reason || object.message || loadError || (configured ? "발송 제공자가 준비되었습니다." : `${channel.label} 발송 제공자가 설정되지 않았습니다.`)
                };
            });
            return normalized;
        },

        providerReady(code) {
            return Boolean(this.providers[upper(code)]?.configured);
        },

        renderProviderAlert() {
            const ready = CHANNELS.filter((channel) => this.providerReady(channel.code));
            const disabled = CHANNELS.filter((channel) => !this.providerReady(channel.code));
            const alert = this.root.querySelector("[data-provider-alert]");
            alert.className = `distribution-provider-alert${disabled.length ? " is-warning" : " is-ready"}`;
            alert.innerHTML = `<strong>${ready.length ? `${ready.map((item) => item.label).join("·")} 연결됨` : "발송 설정 필요"}</strong><details class="distribution-help"><summary aria-label="발송 연결 상태 도움말">?</summary><div class="distribution-help-content">${CHANNELS.map((channel) => `${channel.label}: ${Common.escapeHtml(this.providers[channel.code].reason)}`).join("<br>")}<br>미연동 채널은 외부 발송 없이 보류됩니다. 미리보기와 동의 확인 후 실제 발송을 요청합니다.</div></details>`;
        },

        async loadPublishedSurveyState(survey) {
            const slug = String(survey?.slug || survey?.publicUrl || survey?.public_url || "")
                .split("?")[0]
                .split("/")
                .filter(Boolean)
                .pop();
            if (!slug) return null;
            try {
                const payload = await this.context.api.get(`/api/public/surveys/${encodeURIComponent(slug)}`);
                return payload?.survey || payload;
            } catch {
                return null;
            }
        },

        periodFromSurvey(survey) {
            const settings = survey?.settings || {};
            const profile = survey?.projectProfile || survey?.project_profile || {};
            return {
                startsAt: profile.startsAt || profile.starts_at || settings.startsAt || settings.starts_at || null,
                closesAt: profile.closesAt || profile.closes_at || settings.closesAt || settings.closes_at || null
            };
        },

        surveyPeriod() {
            return this.periodFromSurvey(this.current);
        },

        publishedSurveyPeriod() {
            return this.publishedSurvey
                ? this.periodFromSurvey(this.publishedSurvey)
                : this.surveyPeriod();
        },

        renderProjectContext() {
            if (!this.root || !this.current) return;
            const version = Number(this.current.publishedVersion || this.current.version || 1);
            const configuredPeriod = this.surveyPeriod();
            const publishedPeriod = this.publishedSurveyPeriod();
            const configuredStartsAt = configuredPeriod.startsAt ? new Date(configuredPeriod.startsAt) : null;
            const configuredClosesAt = configuredPeriod.closesAt ? new Date(configuredPeriod.closesAt) : null;
            const startsAt = publishedPeriod.startsAt ? new Date(publishedPeriod.startsAt) : null;
            const closesAt = publishedPeriod.closesAt ? new Date(publishedPeriod.closesAt) : null;
            const serverTime = this.publishedSurvey?.serverTime || this.publishedSurvey?.server_time;
            const parsedServerTime = serverTime ? new Date(serverTime) : null;
            const now = parsedServerTime && !Number.isNaN(parsedServerTime.getTime()) ? parsedServerTime : new Date();
            const validStart = startsAt && !Number.isNaN(startsAt.getTime()) ? startsAt : null;
            const validClose = closesAt && !Number.isNaN(closesAt.getTime()) ? closesAt : null;
            const validConfiguredStart = configuredStartsAt && !Number.isNaN(configuredStartsAt.getTime()) ? configuredStartsAt : null;
            const validConfiguredClose = configuredClosesAt && !Number.isNaN(configuredClosesAt.getTime()) ? configuredClosesAt : null;
            const formatBoundary = (value) => `${Common.formatDate(value, { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" })} KST`;
            const sameBoundary = (left, right) => (left?.getTime?.() ?? null) === (right?.getTime?.() ?? null);
            const periodMatchesPublished = sameBoundary(validConfiguredStart, validStart)
                && sameBoundary(validConfiguredClose, validClose);

            let responseLabel = "응답 진행 중 · 기간 제한 없음";
            let responseClass = "is-active";
            const availability = upper(this.publishedSurvey?.availabilityStatus || this.publishedSurvey?.availability_status);
            if (availability === "SCHEDULED" || (validStart && now < validStart)) {
                responseLabel = "응답 시작 전";
                responseClass = "is-scheduled";
            } else if (availability === "CLOSED" || (validClose && now >= validClose)) {
                responseLabel = "응답 기간 종료";
                responseClass = "is-ended";
            } else if (validStart || validClose) responseLabel = "응답 진행 중";

            const summary = this.items.find((item) => String(item.id) === String(this.current.id));
            const executionStatus = upper(this.draft?.executionStatus || "");
            const summaryStatus = upper(summary?.deploymentStatus || "");
            const deliveryLabels = {
                QUEUED: "발송 대기",
                RUNNING: "발송 진행 중",
                COMPLETE: "발송 완료",
                DISABLED: "발송 보류"
            };
            const deliveryLabel = deliveryLabels[executionStatus]
                || (summaryStatus === "ACTIVE" ? "배포 진행 중" : this.draft?.revision ? `배포 초안 r${this.draft.revision}` : "배포 설정 전");
            const deliveryClass = ["QUEUED", "RUNNING", "COMPLETE"].includes(executionStatus) || summaryStatus === "ACTIVE" ? "is-active" : executionStatus === "DISABLED" ? "is-scheduled" : "";
            const surveyStatus = String(this.current.status || "published").toLowerCase();
            const surveyLabel = surveyStatus === "closed" ? "설문 종료" : `설문 확정 v${version}`;

            this.root.querySelector("[data-distribution-context-title]").textContent = this.publishedSurvey?.title || this.current.title || "제목 없는 설문";
            this.root.querySelector("[data-distribution-context-project-id]").textContent = this.current.id;
            this.root.querySelector("[data-distribution-context-version]").textContent = `v${version}`;
            this.root.querySelector("[data-distribution-context-start]").textContent = validConfiguredStart
                ? formatBoundary(validConfiguredStart)
                : "즉시 시작 · 제한 없음";
            this.root.querySelector("[data-distribution-context-end]").textContent = validConfiguredClose
                ? formatBoundary(validConfiguredClose)
                : "종료 제한 없음";
            const surveyState = this.root.querySelector("[data-distribution-context-survey-state]");
            surveyState.textContent = surveyLabel;
            surveyState.className = surveyStatus === "closed" ? "is-ended" : "is-active";
            const responseState = this.root.querySelector("[data-distribution-context-response-state]");
            responseState.textContent = responseLabel;
            responseState.className = responseClass;
            const periodSync = this.root.querySelector("[data-distribution-context-period-sync]");
            periodSync.textContent = !this.publishedSurvey
                ? "확정본 기간 확인 불가"
                : periodMatchesPublished
                ? "M02001 기간 · 확정본 반영"
                : "M02001 기간 변경 미확정 · 재확정 필요";
            periodSync.className = periodMatchesPublished && this.publishedSurvey ? "is-active" : "is-scheduled";
            const deploymentState = this.root.querySelector("[data-distribution-context-deployment-state]");
            deploymentState.textContent = deliveryLabel;
            deploymentState.className = deliveryClass;
        },

        ensureRecipientRows() {
            if (!this.draft.recipients.length) this.draft.recipients.push(this.blankRecipient());
            while (this.draft.recipients.length < 5) this.draft.recipients.push(this.blankRecipient());
        },

        renderRecipients() {
            this.ensureRecipientRows();
            const host = this.root.querySelector("[data-recipient-list]");
            const total = this.draft.recipients.length;
            const pageCount = Math.max(1, Math.ceil(total / this.recipientPageSize));
            this.recipientPage = Math.min(Math.max(1, this.recipientPage), pageCount);
            const offset = (this.recipientPage - 1) * this.recipientPageSize;
            host.innerHTML = this.draft.recipients.slice(offset, offset + this.recipientPageSize).map((recipient, index) => this.recipientMarkup(recipient, offset + index)).join("");
            if (!this.draft.recipients.some((item) => item.id === this.activeRecipientId)) this.activeRecipientId = null;
            this.renderRecipientPagination(total, pageCount);
            this.renderRecipientDetail();
            this.updateRecipientSelection();
            this.syncExecutionLock();
        },

        renderRecipientPagination(total, pageCount) {
            const host = this.root.querySelector("[data-recipient-pagination]");
            host.hidden = pageCount <= 1;
            if (pageCount <= 1) { host.innerHTML = ""; return; }
            const start = Math.max(1, Math.min(this.recipientPage - 2, pageCount - 4));
            const end = Math.min(pageCount, start + 4);
            const pages = [];
            for (let page = start; page <= end; page += 1) {
                pages.push(`<button class="button button-small button-navigation button-cue-hidden" type="button" data-recipient-page="${page}" ${page === this.recipientPage ? 'aria-current="page"' : ""}>${page}</button>`);
            }
            const first = (this.recipientPage - 1) * this.recipientPageSize + 1;
            const last = Math.min(this.recipientPage * this.recipientPageSize, total);
            host.innerHTML = `<span>${Common.formatNumber(first)}–${Common.formatNumber(last)}행 · 빈 행은 저장되지 않습니다.</span><div><button class="button button-small button-navigation button-navigation-back" type="button" data-recipient-page="${this.recipientPage - 1}" ${this.recipientPage === 1 ? "disabled" : ""}>이전</button>${pages.join("")}<button class="button button-small button-navigation" type="button" data-recipient-page="${this.recipientPage + 1}" ${this.recipientPage === pageCount ? "disabled" : ""}>다음</button></div>`;
        },

        changeRecipientPage(page) {
            this.recipientPage = page;
            this.renderRecipients();
            this.root.querySelector("[data-recipient-grid]")?.scrollIntoView({ block: "nearest", behavior: "auto" });
        },

        recipientContactInput(recipient, field, label, index, grid = false) {
            const value = String(recipient[field] || "");
            const masked = field !== "name" && this.isMaskedContact(value);
            const type = field === "email" && !masked ? "email" : "text";
            return `<span class="recipient-cell-editor${masked ? " is-masked" : ""}"><input type="${type}" value="${Common.escapeHtml(value)}" aria-label="${index + 1}행 ${label}" placeholder="${Common.escapeHtml(label)}" data-recipient-field="${field}" ${grid ? 'data-recipient-grid-cell' : ""} autocomplete="off" maxlength="${field === "name" ? 200 : field === "email" ? 320 : field === "kakaoId" ? 200 : 80}" ${field === "mobile" ? 'inputmode="tel"' : ""} ${masked ? 'readonly title="저장된 연락처입니다. 변경을 눌러 전체 값을 입력하세요."' : ""}>${masked ? `<button class="button button-small button-function button-cue-hidden" type="button" data-replace-recipient-contact="${field}" aria-label="${index + 1}행 ${label} 전체 값 변경">변경</button>` : ""}</span>`;
        },

        recipientRowIssue(recipient) {
            if (!this.recipientHasInput(recipient)) return "";
            if (!recipient.name.trim()) return "이름 입력";
            if (!CHANNELS.some((channel) => String(recipient[channel.field] || "").trim())) return "연락처 입력";
            if (recipient.email && !this.isMaskedContact(recipient.email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.email)) return "이메일 확인";
            if (!recipient.channels.length) return "채널 선택";
            if (recipient.channels.some((code) => !String(recipient[CHANNELS.find((item) => item.code === code)?.field] || "").trim())) return "연락채널 확인";
            return "";
        },

        recipientSummary(recipient) {
            const issue = this.recipientRowIssue(recipient);
            if (issue) return `<span class="recipient-grid-issue">${Common.escapeHtml(issue)}</span>`;
            if (!this.recipientHasInput(recipient)) return '<span class="muted">빈 행</span>';
            const route = (this.publishedSurvey?.settings?.audienceRoutes || []).find((item) => item.code === recipient.audienceCode);
            return `<span>${Common.escapeHtml(route?.label || "기본 대상")}</span><small>${CHANNELS.filter((item) => recipient.channels.includes(item.code)).map((item) => item.label).join(" · ")}</small>`;
        },

        recipientMarkup(recipient, index) {
            const active = recipient.id === this.activeRecipientId;
            return `<tr data-recipient-row="${Common.escapeHtml(recipient.id)}" class="${active ? "is-active " : ""}${recipient.selected === false ? "is-excluded" : ""}"><td><label class="recipient-grid-check"><input type="checkbox" data-recipient-selected ${recipient.selected !== false ? "checked" : ""} ${!this.recipientHasInput(recipient) ? "disabled" : ""} aria-label="${index + 1}행 일괄 발송 선택"></label></td><th scope="row"><button class="recipient-row-open" type="button" data-open-recipient-detail="${Common.escapeHtml(recipient.id)}" aria-controls="recipientDetailPanel" aria-expanded="${active}" aria-label="${index + 1}행 상세 수정">${index + 1}</button></th><td>${this.recipientContactInput(recipient, "name", "이름·대상자 코드", index, true)}</td><td>${this.recipientContactInput(recipient, "mobile", "휴대전화", index, true)}</td><td>${this.recipientContactInput(recipient, "email", "이메일", index, true)}</td><td data-recipient-summary>${this.recipientSummary(recipient)}</td><td><button class="icon-button icon-button-delete" type="button" data-remove-recipient="${Common.escapeHtml(recipient.id)}" aria-label="${index + 1}행 삭제">×</button></td></tr>`;
        },

        selectRecipient(id, focusDetail = false) {
            if (!this.draft.recipients.some((item) => item.id === id)) return;
            if (this.activeRecipientId !== id) {
                this.activeRecipientId = id;
                this.root.querySelectorAll("[data-recipient-row]").forEach((row) => {
                    const active = row.dataset.recipientRow === id;
                    row.classList.toggle("is-active", active);
                    row.querySelector("[data-open-recipient-detail]")?.setAttribute("aria-expanded", String(active));
                });
                this.renderRecipientDetail();
                this.syncExecutionLock();
            }
            if (focusDetail) {
                this.root.querySelector("[data-recipient-detail]")?.scrollIntoView({ block: "nearest" });
                this.root.querySelector("[data-recipient-detail-title]")?.focus({ preventScroll: true });
            }
        },

        renderRecipientDetail() {
            const host = this.root.querySelector("[data-recipient-detail]");
            const recipient = this.draft.recipients.find((item) => item.id === this.activeRecipientId);
            if (!recipient) {
                host.innerHTML = '<p class="muted">표에서 행을 선택하면 이곳에서 언어·대상별 URL·채널을 수정할 수 있습니다.</p>';
                delete host.dataset.recipientDetailId;
                return;
            }
            host.dataset.recipientDetailId = recipient.id;
            const index = this.draft.recipients.indexOf(recipient);
            const countries = COUNTRIES.map((country) => `<option value="${country.code}" ${country.code === recipient.countryCode ? "selected" : ""}>${country.label}</option>`).join("");
            const enabled = new Set(this.enabledLocales());
            const languages = this.localeCatalog().filter((locale) => enabled.has(locale.code)).map((locale) => `<option value="${locale.code}" ${locale.code === recipient.preferredLanguage ? "selected" : ""}>${Common.escapeHtml(locale.nativeLabel || locale.label)}</option>`).join("");
            const contacts = [["name", "이름·대상자 코드"], ["mobile", "공통 휴대전화 (문자·카카오)"], ["email", "이메일"], ["kakaoId", "카카오 별도 수신번호"], ["fax", "팩스"]].map(([field, label]) => `<label>${label}${this.recipientContactInput(recipient, field, label, index)}</label>`).join("");
            const channels = CHANNELS.map((channel) => `<label class="recipient-channel"><input type="checkbox" data-recipient-channel="${channel.code}" ${recipient.channels.includes(channel.code) ? "checked" : ""}><span>${channel.label}<small data-recipient-channel-status="${channel.code}"></small></span></label>`).join("");
            host.innerHTML = `<header><div><h4 tabindex="-1" data-recipient-detail-title>${index + 1}행 · ${Common.escapeHtml(recipient.name || "새 대상자")}</h4></div><p>선택 행 상세 · 변경 후 상단 저장</p></header><div class="recipient-detail-fields">${contacts}<label>국가<select data-recipient-field="countryCode">${countries}</select></label><label>선호 언어<select data-recipient-field="preferredLanguage">${languages}</select></label><label>설문 대상별 URL<select data-recipient-field="audienceCode">${this.audienceOptions(recipient.audienceCode)}</select></label></div><fieldset class="recipient-detail-channels"><legend>사용할 연락채널</legend>${channels}</fieldset><small>공통 휴대전화를 변경하면 문자·카카오 번호가 함께 바뀝니다. 카카오만 다른 번호를 쓰려면 별도 수신번호를 수정하세요.</small>`;
            this.syncRecipientChannelAvailability(host);
        },

        recipientByElement(element) {
            const host = element.closest("[data-recipient-row], [data-recipient-detail-id]");
            const id = host?.dataset.recipientRow || host?.dataset.recipientDetailId;
            return this.draft.recipients.find((item) => item.id === id);
        },

        isMaskedContact(value) { return String(value || "").includes("*"); },

        replaceMaskedContact(button) {
            if (this.draft.executionStatus) return;
            const recipient = this.recipientByElement(button);
            const field = button.dataset.replaceRecipientContact;
            if (!recipient || !this.isMaskedContact(recipient[field])) return;
            recipient.contactReplacements ||= {};
            recipient.contactReplacements[field] = [...recipient.channels];
            recipient[field] = "";
            if (field === "mobile") recipient.kakaoId = "";
            this.clearRecipientUndo();
            this.renderRecipients();
            this.focusRecipientCell(this.draft.recipients.indexOf(recipient), ["name", "mobile", "email"].includes(field) ? field : "mobile");
            if (!["name", "mobile", "email"].includes(field)) this.root.querySelector(`[data-recipient-detail] [data-recipient-field="${field}"]`)?.focus();
            this.markDirty();
        },

        assignRecipientField(recipient, field, value) {
            const previous = String(recipient[field] || "");
            const previousChannels = recipient.contactReplacements?.[field];
            const replacing = Boolean(previousChannels);
            let normalized = String(value || "");
            if (field === "audienceCode") {
                const routes = this.publishedSurvey?.settings?.audienceRoutes || [];
                normalized = routes.find((route) => route.label === normalized)?.code || normalized;
            }
            if (field === "countryCode") normalized = COUNTRIES.find((country) => country.label === normalized)?.code || upper(normalized);
            if (field === "preferredLanguage") normalized = this.localeCatalog().find((locale) => [locale.label, locale.nativeLabel].includes(normalized))?.code || this.localeCode(normalized);
            recipient[field] = field === "audienceCode" ? normalized || null : normalized;
            if (field === "mobile") {
                recipient.kakaoId = normalized;
                if (!replacing && !previous.trim() && normalized.trim()) recipient.channels = [...new Set([...recipient.channels, "SMS", "KAKAO"])];
            }
            const channel = CHANNELS.find((item) => item.field === field);
            if (channel && !replacing && !previous.trim() && normalized.trim()) recipient.channels = [...new Set([...recipient.channels, channel.code])];
            if (replacing && normalized.trim()) {
                const restored = previousChannels.filter((code) => field === "mobile" ? ["SMS", "KAKAO"].includes(code) : CHANNELS.find((item) => item.code === code)?.field === field);
                recipient.channels = [...new Set([...recipient.channels, ...restored])];
                delete recipient.contactReplacements[field];
                if (!Object.keys(recipient.contactReplacements).length) delete recipient.contactReplacements;
            }
            recipient.channels = recipient.channels.filter((code) => String(recipient[CHANNELS.find((item) => item.code === code)?.field] || "").trim());
            if (channel && normalized.trim() && !recipient.name.trim()) recipient.name = `대상자 ${String(this.draft.recipients.indexOf(recipient) + 1).padStart(4, "0")}`;
        },

        updateRecipientField(element, changed = false) {
            if (this.draft.executionStatus || this.saving || this.sending) return;
            const recipient = this.recipientByElement(element);
            if (!recipient) return;
            const field = element.dataset.recipientField;
            if (String(recipient[field] || "") === element.value) return;
            this.assignRecipientField(recipient, field, element.value);
            this.clearRecipientUndo();
            this.syncRecipientEditors(recipient, element);
            this.updateRecipientSelection();
            this.markDirty();
        },

        syncRecipientEditors(recipient, source = null) {
            this.root.querySelectorAll("[data-recipient-field]").forEach((input) => {
                if (this.recipientByElement(input)?.id !== recipient.id) return;
                const value = recipient[input.dataset.recipientField] || "";
                if (input !== source) input.value = value;
                if (CHANNELS.some((channel) => channel.field === input.dataset.recipientField)) {
                    input.readOnly = this.isMaskedContact(value);
                    input.closest(".recipient-cell-editor")?.classList.toggle("is-masked", input.readOnly);
                    if (!input.readOnly) input.closest(".recipient-cell-editor")?.querySelector("[data-replace-recipient-contact]")?.remove();
                }
            });
            const row = this.root.querySelector(`[data-recipient-row="${CSS.escape(recipient.id)}"]`);
            if (row) {
                row.querySelector("[data-recipient-summary]").innerHTML = this.recipientSummary(recipient);
                const check = row.querySelector("[data-recipient-selected]");
                check.disabled = Boolean(this.draft.executionStatus) || !this.recipientHasInput(recipient);
                check.checked = recipient.selected !== false;
                row.classList.toggle("is-excluded", recipient.selected === false);
            }
            if (this.activeRecipientId === recipient.id) {
                const detail = this.root.querySelector("[data-recipient-detail]");
                const title = detail.querySelector("[data-recipient-detail-title]");
                if (title) title.textContent = `${this.draft.recipients.indexOf(recipient) + 1}행 · ${recipient.name || "새 대상자"}`;
                this.syncRecipientChannelAvailability(detail);
            }
        },

        syncRecipientChannelAvailability(host) {
            const recipient = this.recipientByElement(host);
            if (!recipient) return;
            CHANNELS.forEach((channel) => {
                const checkbox = host.querySelector(`[data-recipient-channel="${channel.code}"]`);
                const status = host.querySelector(`[data-recipient-channel-status="${channel.code}"]`);
                const hasContact = Boolean(String(recipient[channel.field] || "").trim());
                if (checkbox) { checkbox.disabled = Boolean(this.draft.executionStatus) || !hasContact; checkbox.checked = recipient.channels.includes(channel.code); }
                if (status) status.textContent = !hasContact ? "연락정보 필요" : this.providerReady(channel.code) ? "전송 가능" : "연동 필요·전송 보류";
            });
        },

        updateRecipientChannel(element) {
            const recipient = this.recipientByElement(element);
            if (!recipient || this.draft.executionStatus) return;
            const code = upper(element.dataset.recipientChannel);
            recipient.channels = element.checked ? [...new Set([...recipient.channels, code])] : recipient.channels.filter((item) => item !== code);
            this.clearRecipientUndo();
            this.syncRecipientEditors(recipient);
            this.markDirty();
        },

        focusRecipientCell(index, field = "name") {
            const recipient = this.draft.recipients[index];
            if (!recipient) return;
            const page = Math.floor(index / this.recipientPageSize) + 1;
            if (this.recipientPage !== page) { this.recipientPage = page; this.renderRecipients(); }
            this.selectRecipient(recipient.id);
            const input = this.root.querySelector(`[data-recipient-row="${CSS.escape(recipient.id)}"] [data-recipient-field="${field}"]`);
            input?.focus({ preventScroll: true });
            input?.scrollIntoView({ block: "nearest", inline: "nearest" });
            input?.select();
        },

        addRecipient() {
            if (this.draft.executionStatus) return;
            let index = this.draft.recipients.findIndex((item) => !this.recipientHasInput(item));
            if (index < 0) {
                if (this.draft.recipients.length >= 2000) return this.context.toast("대상자는 최대 2,000명까지 등록할 수 있습니다.", "error");
                index = this.draft.recipients.length;
                this.draft.recipients.push(this.blankRecipient());
                this.renderRecipients();
            }
            this.focusRecipientCell(index);
        },

        removeRecipient(id) {
            if (this.draft.executionStatus) return;
            const index = this.draft.recipients.findIndex((item) => item.id === id);
            const changed = this.recipientHasInput(this.draft.recipients[index]);
            this.draft.recipients = this.draft.recipients.filter((item) => item.id !== id);
            if (this.activeRecipientId === id) this.activeRecipientId = this.draft.recipients[Math.min(index, this.draft.recipients.length - 1)]?.id || null;
            this.clearRecipientUndo();
            this.renderRecipients();
            if (changed) this.markDirty();
        },

        pasteRecipientCells(event) {
            const grid = event.target.closest("[data-recipient-grid]");
            if (!grid) return;
            const input = event.target.closest("[data-recipient-grid-cell]");
            const text = event.clipboardData?.getData("text/plain") || "";
            if (input && !/[\t\r\n]/.test(text)) return;
            event.preventDefault();
            if (this.draft.executionStatus || this.saving || this.sending) return;
            try {
                if (!text.trim()) return;
                if (text.length > 4 * 1024 * 1024) throw new Error("한 번에 붙여넣을 수 있는 표는 4MB 이하여야 합니다.");
                const columns = ["name", "mobile", "email"];
                const startField = input?.dataset.recipientField || "name";
                const startColumn = Math.max(0, columns.indexOf(startField));
                const focused = input ? this.recipientByElement(input) : this.draft.recipients.find((item) => item.id === this.activeRecipientId);
                let start = focused ? this.draft.recipients.indexOf(focused) : this.draft.recipients.findIndex((item) => !this.recipientHasInput(item));
                if (start < 0) start = this.draft.recipients.length;
                const rows = this.parseCsv(text, "\t");
                while (rows.length && rows[rows.length - 1].every((cell) => !cell.trim())) rows.pop();
                const aliases = { name: "name", 이름: "name", 성명: "name", 대상자: "name", 대상자명: "name", 이름대상자코드: "name", mobile: "mobile", 휴대전화: "mobile", 휴대전화문자카카오: "mobile", 휴대폰: "mobile", 전화번호: "mobile", 연락처: "mobile", email: "email", 이메일: "email", countrycode: "countryCode", 국가: "countryCode", preferredlanguage: "preferredLanguage", 언어: "preferredLanguage", 선호언어: "preferredLanguage", audiencecode: "audienceCode", 대상구분: "audienceCode", 설문대상: "audienceCode", kakaoid: "kakaoId", 카카오: "kakaoId", fax: "fax", 팩스: "fax" };
                const headerKeys = (rows[0] || []).map((cell) => cell.trim().toLowerCase().replace(/[\s·()]/g, ""));
                const isHeader = headerKeys.some((key) => aliases[key]) && headerKeys.every((key) => !key || aliases[key] || ["행", "번호", "발송"].includes(key));
                let mapping;
                if (isHeader) { mapping = headerKeys.map((key) => aliases[key] || null); rows.shift(); }
                else {
                    const width = Math.max(...rows.map((row) => row.length));
                    if (width > columns.length - startColumn) throw new Error("이름·휴대전화·이메일 3열을 선택해 붙여넣거나, 열 제목을 포함해 복사해 주세요.");
                    mapping = columns.slice(startColumn, startColumn + width);
                }
                if (!rows.length) throw new Error("열 제목 아래의 대상자 내용도 함께 복사해 주세요.");
                if (rows.length > 2000 || start + rows.length > 2000) throw new Error("대상자는 최대 2,000명까지 등록할 수 있습니다.");
                const fields = mapping.filter(Boolean);
                if (new Set(fields).size !== fields.length) throw new Error("복사한 표에 같은 열 제목이 두 번 있습니다.");
                const limits = { name: 200, mobile: 80, email: 320, kakaoId: 200, fax: 80, countryCode: 20, preferredLanguage: 40, audienceCode: 100 };
                rows.forEach((row) => mapping.forEach((field, column) => {
                    const value = String(row[column] || "").trim();
                    if (field && value.length > limits[field]) throw new Error("너무 긴 값이 있습니다. 필요한 이름·연락처 열만 복사해 주세요.");
                    if (["mobile", "email", "kakaoId", "fax"].includes(field) && value.includes("*")) throw new Error("마스킹된 연락처는 붙여넣을 수 없습니다. 전체 연락처를 입력해 주세요.");
                }));
                const before = structuredClone(this.draft.recipients);
                const previousActive = this.activeRecipientId;
                const previousPage = this.recipientPage;
                while (this.draft.recipients.length < start + rows.length) this.draft.recipients.push(this.blankRecipient());
                rows.forEach((row, index) => mapping.forEach((field, column) => {
                    if (field) this.assignRecipientField(this.draft.recipients[start + index], field, String(row[column] || "").trim());
                }));
                this.activeRecipientId = this.draft.recipients[start].id;
                this.recipientPage = Math.floor(start / this.recipientPageSize) + 1;
                this.renderRecipients();
                this.recipientUndo = { recipients: before, activeId: previousActive, page: previousPage };
                this.root.querySelector("[data-undo-recipient-paste]").hidden = false;
                this.root.querySelector("[data-recipient-grid-status]").textContent = `${Common.formatNumber(rows.length)}행을 붙여넣었습니다. 기존 셀 위에 붙여넣은 경우 해당 값이 바뀝니다. 저장 전 되돌릴 수 있습니다.`;
                this.markDirty();
                this.focusRecipientCell(start, fields.find((field) => columns.includes(field)) || "name");
            } catch (error) { this.context.toast(error.message, "error"); }
        },

        clearRecipientUndo() {
            this.recipientUndo = null;
            const undo = this.root?.querySelector("[data-undo-recipient-paste]");
            if (undo) undo.hidden = true;
        },

        undoRecipientPaste() {
            if (!this.recipientUndo || this.draft.executionStatus || this.saving || this.sending) return;
            this.draft.recipients = this.recipientUndo.recipients;
            this.activeRecipientId = this.recipientUndo.activeId;
            this.recipientPage = this.recipientUndo.page;
            this.clearRecipientUndo();
            this.renderRecipients();
            this.root.querySelector("[data-recipient-grid-status]").textContent = "마지막 붙여넣기를 되돌렸습니다.";
            this.markDirty();
        },

        moveRecipientCell(event) {
            const input = event.target.closest("[data-recipient-grid-cell]");
            if (!input || event.ctrlKey || event.metaKey || event.altKey || this.draft.executionStatus) return;
            const fields = ["name", "mobile", "email"];
            const recipient = this.recipientByElement(input);
            let row = this.draft.recipients.indexOf(recipient);
            let column = fields.indexOf(input.dataset.recipientField);
            if (event.key === "Enter" || event.key === "ArrowDown") row += event.shiftKey && event.key === "Enter" ? -1 : 1;
            else if (event.key === "ArrowUp") row -= 1;
            else if (event.key === "Tab") {
                column += event.shiftKey ? -1 : 1;
                if (column < 0) { row -= 1; column = fields.length - 1; }
                if (column >= fields.length) { row += 1; column = 0; }
            } else return;
            if (row < 0 || row >= 2000) return;
            if (row >= this.draft.recipients.length) {
                if (event.key === "Tab" && !this.recipientHasInput(recipient)) return;
                this.draft.recipients.push(this.blankRecipient());
                this.renderRecipients();
            }
            event.preventDefault();
            this.focusRecipientCell(row, fields[column]);
        },

        audienceOptions(selected) {
            const routes = this.publishedSurvey?.settings?.audienceRoutes || [];
            return `<option value="">기본 대상 URL</option>${routes.map((route) => `<option value="${Common.escapeHtml(route.code)}" ${route.code === selected ? "selected" : ""}>${Common.escapeHtml(route.label || route.code)}</option>`).join("")}`;
        },

        updateRecipientSelection() {
            const recipients = this.draft.recipients.filter((item) => this.recipientHasInput(item));
            const selected = recipients.filter((item) => item.selected !== false).length;
            this.root.querySelector("[data-recipient-selection-count]").textContent = `등록 ${Common.formatNumber(recipients.length)}명 · 발송 선택 ${Common.formatNumber(selected)}명`;
            const all = this.root.querySelector("[data-select-all-recipients]");
            all.checked = recipients.length > 0 && selected === recipients.length;
            all.indeterminate = selected > 0 && selected < recipients.length;
        },

        maskImportedValue(value) {
            const text = String(value || "");
            if (text.includes("@")) return text.slice(0, 1) + "***@" + text.split("@").pop();
            const digits = text.replace(/\D/g, "");
            if (digits.length >= 7) return digits.slice(0, 3) + "-****-" + digits.slice(-4);
            return text.length > 3 ? text.slice(0, 1) + "***" : text;
        },

        stageRecipientImport(items) {
            if (!items.length) throw new Error("등록할 대상자가 없습니다.");
            this.stagedRecipients = items.map((item) => this.normalizeRecipient(item));
            const host = this.root.querySelector("[data-import-review]");
            host.hidden = false;
            host.innerHTML = `<h4>${Common.formatNumber(items.length)}명 가져오기 검토</h4><p>처음 5명을 표시합니다. 기존 목록에 추가하거나 목록을 교체한 뒤 저장하세요.</p><div class="recipient-import-table"><table><thead><tr><th>대상자</th><th>휴대전화</th><th>이메일</th><th>대상 구분</th></tr></thead><tbody>${this.stagedRecipients.slice(0, 5).map((item) => `<tr><td>${Common.escapeHtml(item.name)}</td><td>${Common.escapeHtml(this.maskImportedValue(item.mobile || item.kakaoId))}</td><td>${Common.escapeHtml(this.maskImportedValue(item.email))}</td><td>${Common.escapeHtml(item.audienceCode || "기본 대상")}</td></tr>`).join("")}</tbody></table></div><div class="recipient-bulk-actions"><button class="button button-function button-important" type="button" data-apply-recipient-import="append">목록에 추가</button><button class="button button-function" type="button" data-apply-recipient-import="replace">기존 목록 교체</button><button class="button button-function" type="button" data-cancel-recipient-import>가져오기 취소</button></div>`;
            host.querySelector("button")?.focus();
        },

        async applyRecipientImport(mode) {
            if (!this.stagedRecipients?.length) return;
            const current = this.draft.recipients.filter((item) => this.recipientHasInput(item));
            if (mode === "replace" && current.length && !(await this.context.confirmMessage("현재 대상자 목록을 가져온 목록으로 교체할까요? 저장하기 전까지 서버에는 반영되지 않습니다.", { title: "대상자 목록 교체", confirmLabel: "목록 교체", tone: "warning" }))) return;
            const next = mode === "replace" ? this.stagedRecipients : [...current, ...this.stagedRecipients];
            if (next.length > 2000) return this.context.toast("대상자는 최대 2,000명까지 등록할 수 있습니다.", "error");
            const contacts = new Set();
            for (const item of next) {
                for (const channel of CHANNELS) {
                    const value = String(item[channel.field] || "").trim();
                    if (!value || value.includes("*") || !item.channels.includes(channel.code)) continue;
                    const key = `${channel.code}:${channel.code === "EMAIL" ? value.toLowerCase() : value.replace(/[^0-9a-z]/gi, "")}`;
                    if (contacts.has(key)) return this.context.toast(`${channel.label} 연락처가 중복됩니다. 중복 행을 정리한 뒤 다시 가져오세요.`, "error");
                    contacts.add(key);
                }
            }
            this.draft.recipients = next;
            this.clearRecipientUndo();
            this.activeRecipientId = this.stagedRecipients[0]?.id || null;
            this.recipientPage = 1;
            this.clearRecipientImport();
            this.renderRecipients();
            this.markDirty();
            this.context.toast(`${Common.formatNumber(next.length)}명의 대상자를 초안에 반영했습니다. 저장 후 연락처가 마스킹됩니다.`, "success");
        },

        clearRecipientImport() {
            this.stagedRecipients = null;
            const review = this.root.querySelector("[data-import-review]");
            if (review) { review.hidden = true; review.innerHTML = ""; }
        },

        downloadRecipientSample() {
            Common.downloadCsv("in-surveyone-recipients.csv", [
                ["name", "countryCode", "preferredLanguage", "email", "mobile", "fax", "kakaoId", "channels", "audienceCode"],
                ["응답자 A001", "KR", "ko", "sample@example.com", "010-0000-0000", "", "", "EMAIL|SMS|KAKAO", ""]
            ]);
        },

        downloadRecipientExcelSample() {
            const anchor = document.createElement("a");
            anchor.href = `${window.SURVEYONE_CONFIG.apiBaseUrl}/api/deployments/recipients/sample.xlsx`;
            anchor.download = "in-surveyone-recipients.xlsx";
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
        },

        async importRecipients(file) {
            const input = this.root.querySelector("[data-recipient-file]");
            try {
                if (!file) return;
                if (this.importingRecipients) return;
                if (!/\.(csv|txt|xlsx)$/i.test(file.name)) throw new Error("CSV, TXT 또는 XLSX 파일만 가져올 수 있습니다.");
                if (file.size > 4 * 1024 * 1024) throw new Error("대상자 파일은 4MB 이하여야 합니다.");
                this.importingRecipients = true;
                this.setImportProgress(true, 0, `${file.name} 업로드 준비 중`);
                const result = await this.uploadRecipientFile(file);
                this.stageRecipientImport(result.recipients || []);
            } catch (error) {
                this.context.toast(error.message, "error");
            } finally {
                this.importingRecipients = false;
                this.setImportProgress(false);
                input.value = "";
            }
        },

        uploadRecipientFile(file) {
            return new Promise((resolve, reject) => {
                const form = new FormData();
                form.append("upload", file, file.name);
                const request = new XMLHttpRequest();
                request.open("POST", `${window.SURVEYONE_CONFIG.apiBaseUrl}/api/deployments/recipients/import`);
                request.responseType = "json";
                request.withCredentials = true;
                request.upload.addEventListener("progress", (event) => {
                    if (!event.lengthComputable) return this.setImportProgress(true, null, `${file.name} 업로드 중`);
                    this.setImportProgress(true, Math.round(event.loaded / event.total * 100), `${file.name} 업로드 중`);
                });
                request.upload.addEventListener("load", () => this.setImportProgress(true, null, "파일 분석과 대상자 검증 중"));
                request.addEventListener("load", () => {
                    const payload = request.response || {};
                    if (request.status >= 200 && request.status < 300) return resolve(payload.data || payload);
                    const detail = payload.detail || payload.message || `파일을 가져오지 못했습니다. (${request.status})`;
                    reject(new Error(Array.isArray(detail) ? detail.map((item) => item.msg || String(item)).join(" / ") : String(detail)));
                });
                request.addEventListener("error", () => reject(new Error("파일 업로드 중 네트워크 오류가 발생했습니다.")));
                request.addEventListener("abort", () => reject(new Error("파일 업로드가 취소되었습니다.")));
                request.send(form);
            });
        },

        setImportProgress(visible, percent = null, label = "") {
            const host = this.root?.querySelector("[data-recipient-import-progress]");
            if (!host) return;
            host.hidden = !visible;
            if (!visible) return;
            host.querySelector("[data-recipient-import-label]").textContent = label;
            const meter = host.querySelector("[data-recipient-import-meter]");
            if (percent === null) meter.removeAttribute("value"); else meter.value = percent;
        },

        parseCsv(text, delimiter = ",") {
            const rows = [];
            let row = [];
            let cell = "";
            let quoted = false;
            const source = String(text || "").replace(/^\uFEFF/, "");
            for (let index = 0; index < source.length; index += 1) {
                const character = source[index];
                if (quoted) {
                    if (character === '"' && source[index + 1] === '"') { cell += '"'; index += 1; }
                    else if (character === '"') quoted = false;
                    else cell += character;
                } else if (character === '"') quoted = true;
                else if (character === delimiter) { row.push(cell); cell = ""; }
                else if (character === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
                else cell += character;
            }
            if (quoted) throw new Error("CSV 따옴표 형식이 올바르지 않습니다.");
            if (cell || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
            return rows;
        },

        sendScope() { return this.draft.deliveryOptions?.sendScope || "BULK"; },

        scopeCandidates() {
            if (this.sendScope() === "INDIVIDUAL") return this.draft.recipients.filter((item) => item.id === this.draft.deliveryOptions.individualRecipientId && this.recipientHasInput(item));
            return this.draft.recipients.filter((item) => item.selected !== false && this.recipientHasInput(item));
        },

        composeChannels() { return ["KAKAO", "SMS", "EMAIL"].map((code) => CHANNELS.find((item) => item.code === code)); },

        changeSendScope(scope) {
            if (this.draft.executionStatus || this.actionBusy || !["BULK", "INDIVIDUAL"].includes(scope)) return;
            this.draft.deliveryOptions.sendScope = scope;
            this.previewRecipientId = null;
            this.renderChannels(); this.renderMessages(); this.markDirty();
        },

        selectComposeChannel(code) {
            if (this.draft.executionStatus || this.actionBusy || !this.composeChannels().some((item) => item.code === code)) return;
            this.activeChannel = code;
            this.draft.channels = [code];
            this.draft.schedule.priority = [code, ...this.draft.schedule.priority.filter((item) => item !== code)];
            this.previewChannel = code;
            this.renderChannels(); this.renderMessages(); this.markDirty();
        },

        directReceiverValues() {
            return Object.fromEntries([...(this.root?.querySelectorAll?.("[data-direct-receiver]") || [])].map(input => [input.dataset.directReceiver, input.value.trim()]));
        },

        hasPendingDirectReceiver() { return Object.values(this.directReceiverValues()).some(Boolean); },

        clearDirectReceiver() {
            for (const input of this.root?.querySelectorAll?.("[data-direct-receiver]") || []) input.value = "";
        },

        selectDirectReceiver() {
            if (this.sendScope() !== "INDIVIDUAL" || this.draft.executionStatus || this.saving || this.sending || this.actionBusy) return;
            const values = this.directReceiverValues();
            const error = this.root.querySelector("[data-recipient-scope-error]");
            const reject = message => { error.textContent = message; error.hidden = false; error.focus(); };
            if (!values.name) return reject("수신자 이름을 입력해 주세요.");
            if (!values.mobile && !values.email) return reject("휴대전화 또는 이메일을 입력해 주세요.");
            if (values.mobile && !/^01[0-9]{8,9}$/.test(values.mobile.replace(/[- ()]/g, ""))) return reject("국내 휴대전화 전체 번호를 확인해 주세요.");
            if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) return reject("이메일 주소를 확인해 주세요.");
            if (this.draft.recipients.filter(item => this.recipientHasInput(item)).length >= 2000) return reject("대상자는 최대 2,000명까지 등록할 수 있습니다.");
            const recipient = { ...this.blankRecipient(), name: values.name, mobile: values.mobile || "", kakaoId: values.mobile || "", email: values.email || "", selected: false,
                channels: [...(values.mobile ? ["SMS", "KAKAO"] : []), ...(values.email ? ["EMAIL"] : [])] };
            this.draft.recipients.push(recipient);
            const code = recipient.channels.includes(this.activeChannel) ? this.activeChannel : values.mobile ? (this.providerReady("KAKAO") ? "KAKAO" : "SMS") : "EMAIL";
            this.draft.channels = [code]; this.activeChannel = code; this.previewChannel = code;
            this.clearDirectReceiver();
            this.root.querySelector(".distribution-direct-receiver").open = false;
            this.renderRecipients();
            this.selectIndividualRecipient(recipient.id);
        },

        selectIndividualRecipient(id) {
            if (this.draft.executionStatus || this.actionBusy || !this.draft.recipients.some((item) => item.id === id)) return;
            this.clearDirectReceiver();
            this.draft.deliveryOptions.individualRecipientId = id;
            this.previewRecipientId = id;
            this.renderChannels(); this.renderMessages(); this.markDirty();
            [...this.root.querySelectorAll("[data-individual-recipient]")].find((item) => item.dataset.individualRecipient === id)?.focus({ preventScroll: true });
        },

        renderIndividualRecipients() {
            const search = (this.individualSearch || "").trim().toLocaleLowerCase();
            const items = this.draft.recipients.filter((item) => this.recipientHasInput(item) && [item.name, item.mobile, item.kakaoId, item.email].some((value) => String(value || "").toLocaleLowerCase().includes(search)));
            this.individualPage = Math.max(0, Math.min(this.individualPage || 0, Math.ceil(items.length / 20) - 1));
            const start = this.individualPage * 20;
            const channel = CHANNELS.find((item) => item.code === this.activeChannel);
            this.root.querySelector("[data-individual-list]").innerHTML = items.slice(start, start + 20).map((item) => `<button class="distribution-individual-recipient" type="button" data-individual-recipient="${Common.escapeHtml(item.id)}" aria-pressed="${item.id === this.draft.deliveryOptions.individualRecipientId}"><strong>${Common.escapeHtml(item.name)}</strong><span>${Common.escapeHtml(this.maskImportedValue(item[channel?.field] || item.mobile || item.email || item.kakaoId) || "연락처 없음")}</span></button>`).join("") || '<p class="muted">등록된 대상자를 검색하세요.</p>';
            const pages = this.root.querySelector("[data-individual-pages]");
            pages.hidden = items.length <= 20;
            pages.innerHTML = `<button class="button button-small button-function" type="button" data-individual-page="${this.individualPage - 1}" ${!start ? "disabled" : ""}>이전</button><span>${start + 1}–${Math.min(start + 20, items.length)} / ${items.length}명</span><button class="button button-small button-function" type="button" data-individual-page="${this.individualPage + 1}" ${start + 20 >= items.length ? "disabled" : ""}>다음</button>`;
        },

        renderRecipientScope() {
            const individual = this.sendScope() === "INDIVIDUAL";
            this.root.querySelector(`[name="sendScope"][value="${this.sendScope()}"]`).checked = true;
            this.root.querySelector("[data-individual-receiver]").hidden = !individual;
            this.root.querySelector("[data-bulk-summary]").hidden = individual;
            this.root.querySelector("[data-bulk-preview-picker]").hidden = individual;
            const candidates = this.scopeCandidates();
            const eligible = this.previewRecipients();
            const missing = candidates.length - eligible.length;
            this.root.querySelector("[data-bulk-summary]").innerHTML = `<strong>${Common.formatNumber(eligible.length)}명 일괄 발송</strong>${missing ? `<span>선택 ${Common.formatNumber(candidates.length)}명 · 연락처 없음 ${Common.formatNumber(missing)}명 제외</span>` : ""}`;
            this.renderIndividualRecipients();
            const recipient = individual ? candidates[0] : null;
            this.root.querySelector("[data-individual-contact]").innerHTML = recipient ? `<legend>${Common.escapeHtml(recipient.name)} · 수신 연락처</legend>${this.composeChannels().filter((channel) => recipient.channels.includes(channel.code) && recipient[channel.field]).map((channel) => `<label><input type="radio" name="individualContact" value="${channel.code}" ${this.draft.channels.length === 1 && this.draft.channels.includes(channel.code) ? "checked" : ""}><span><strong>${channel.label}</strong><span>${Common.escapeHtml(this.maskImportedValue(recipient[channel.field]))}</span></span></label>`).join("")}` : '<legend class="sr-only">수신 연락처</legend><p>수신자 미선택</p>';
            this.root.querySelectorAll("[data-sender-for]").forEach((field) => { field.hidden = !this.draft.channels.includes(field.dataset.senderFor); });
        },

        renderChannels() {
            const candidates = this.scopeCandidates();
            const host = this.root.querySelector("[data-channel-options]");
            const channels = [...this.composeChannels(), ...(this.draft.channels.includes("FAX") ? [CHANNELS.find((item) => item.code === "FAX")] : [])];
            this.activeChannel = this.draft.channels.includes(this.activeChannel) ? this.activeChannel : this.draft.channels[0] || "KAKAO";
            this.root.querySelector("[data-compose-channels]").innerHTML = this.composeChannels().map((channel) => `<button type="button" data-compose-channel="${channel.code}" aria-pressed="${this.draft.channels.length === 1 && this.draft.channels.includes(channel.code)}"><strong>${channel.label}</strong><small>${this.providerReady(channel.code) ? "발송 가능" : channel.code === "EMAIL" ? "미리보기" : "연동 설정 필요"}</small></button>`).join("");
            host.innerHTML = channels.map((channel) => {
                const provider = this.providers[channel.code];
                const selected = this.draft.channels.includes(channel.code);
                const targetCount = candidates.filter((recipient) => recipient.channels.includes(channel.code) && String(recipient[channel.field] || "").trim()).length;
                const priority = Math.max(0, this.draft.schedule.priority.indexOf(channel.code));
                const priorityOptions = CHANNELS.map((_, index) => `<option value="${index + 1}" ${priority === index ? "selected" : ""}>${index + 1}순위</option>`).join("");
                return `<article class="distribution-channel-card ${provider.configured ? "is-ready" : "is-disabled"}"><label><input type="checkbox" value="${channel.code}" data-distribution-channel="${channel.code}" ${selected ? "checked" : ""}><span><strong>${channel.label}</strong><small>${Common.formatNumber(targetCount)}명 · ${provider.configured ? "발송 가능" : "미연동"}</small></span></label><label class="distribution-channel-priority"><span class="sr-only">${channel.label} 우선순위</span><select data-channel-priority="${channel.code}" aria-label="${channel.label} 발송 우선순위">${priorityOptions}</select></label></article>`;
            }).join("");
            const strategy = this.root.querySelector(`[name="deliveryStrategy"][value="${this.draft.schedule.strategy}"]`);
            if (strategy) strategy.checked = true;
            const mode = this.root.querySelector(`[name="scheduleMode"][value="${this.draft.schedule.mode}"]`);
            if (mode) mode.checked = true;
            this.root.querySelector("[data-scheduled-at]").value = this.localDateTimeValue(this.draft.schedule.scheduledAt);
            this.syncScheduleField();
            this.root.querySelectorAll("[data-delivery-option]").forEach((input) => { input.value = this.draft.deliveryOptions[input.dataset.deliveryOption] || ""; });
        },

        updateSelectedChannel(element) {
            const code = upper(element.dataset.distributionChannel);
            this.draft.channels = element.checked ? [...new Set([...this.draft.channels, code])] : this.draft.channels.filter((item) => item !== code);
            this.renderChannels();
            this.renderMessages();
            this.markDirty();
            this.root.querySelector(`[data-distribution-channel="${code}"]`)?.focus({ preventScroll: true });
        },

        updateChannelPriority(element) {
            const code = upper(element.dataset.channelPriority);
            const requestedIndex = Math.max(0, Math.min(CHANNELS.length - 1, Number(element.value) - 1));
            const priority = this.draft.schedule.priority.filter((item) => item !== code);
            priority.splice(requestedIndex, 0, code);
            this.draft.schedule.priority = priority;
            this.renderChannels();
            this.markDirty();
            this.root.querySelector(`[data-channel-priority="${code}"]`)?.focus({ preventScroll: true });
        },

        syncScheduleField() {
            const scheduled = this.draft.schedule.mode === "SCHEDULED";
            const field = this.root.querySelector("[data-schedule-field]");
            const input = this.root.querySelector("[data-scheduled-at]");
            field.hidden = !scheduled;
            input.required = scheduled;
            input.disabled = !scheduled;
        },

        scheduledIso(value) {
            if (!value) return null;
            const date = new Date(value);
            return Number.isNaN(date.getTime()) ? null : date.toISOString();
        },

        localDateTimeValue(value) {
            if (!value) return "";
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) return "";
            const part = (number) => String(number).padStart(2, "0");
            return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}T${part(date.getHours())}:${part(date.getMinutes())}`;
        },

        recipientLocales() {
            const locales = [...new Set(this.previewRecipients().map((item) => this.localeCode(item.preferredLanguage)).filter(Boolean))];
            return locales.length ? locales : [this.defaultLocale()];
        },

        localizedSurveyTitle(locale) {
            if (locale === this.current?.languages?.sourceLocale || locale === this.current?.defaultLocale) return this.current.title;
            return this.current?.translations?.[locale]?.title || this.current.title;
        },

        invitationDefaults(locale) {
            const title = "{{surveyTitle}}";
            const url = "{{surveyUrl}}";
            const templates = {
                ko: { subject: `[설문 참여 요청] ${title}`, greeting: `안녕하세요. ${title} 설문에 참여해 주세요.`, short: `[IN-SURVEYONE] ${title} 참여 안내` },
                en: { subject: `[Survey invitation] ${title}`, greeting: `Hello. Please participate in the ${title} survey.`, short: `[IN-SURVEYONE] Invitation: ${title}` },
                ja: { subject: `【アンケートのお願い】${title}`, greeting: `${title}アンケートへのご協力をお願いいたします。`, short: `【IN-SURVEYONE】${title} ご案内` },
                zh: { subject: `【问卷邀请】${title}`, greeting: `您好，请参与“${title}”问卷调查。`, short: `【IN-SURVEYONE】${title} 问卷邀请` },
                vi: { subject: `[Mời tham gia khảo sát] ${title}`, greeting: `Xin chào. Vui lòng tham gia khảo sát ${title}.`, short: `[IN-SURVEYONE] Mời khảo sát: ${title}` },
                fil: { subject: `[Paanyaya sa survey] ${title}`, greeting: `Kumusta. Inaanyayahan kang sagutan ang survey na ${title}.`, short: `[IN-SURVEYONE] Survey: ${title}` }
            };
            const base = templates[locale.split("-")[0]] || templates.en;
            return { emailSubject: base.subject, emailBody: `${base.greeting}\n\n${url}`, smsBody: locale.split("-")[0] === "ko" ? `{{name}} 고객님\n\n${base.greeting}\n\n- 설문URL바로가기 : ${url}\n\n감사합니다.` : `${base.short} ${url}`, kakaoBody: `${base.short}\n${url}`, faxTitle: base.subject, faxBody: `${base.greeting}\n\n${url}` };
        },

        ensureMessages() {
            this.recipientLocales().forEach((locale) => {
                this.draft.messagesByLanguage[locale] = { ...this.invitationDefaults(locale), ...(this.draft.messagesByLanguage[locale] || {}) };
            });
        },

        renderMessages() {
            this.ensureMessages();
            const locales = this.recipientLocales();
            const summary = this.root.querySelector("[data-language-summary]");
            summary.hidden = locales.length <= 1;
            this.root.querySelector("[data-message-list]").classList.toggle("is-single-locale", locales.length === 1);
            this.root.querySelector("[data-composer-title]").textContent = locales.length === 1 ? `문안 · ${this.localeLabel(locales[0])}` : "문안";
            summary.innerHTML = locales.map((locale) => `<span>${Common.escapeHtml(this.localeLabel(locale))}<b>${Common.formatNumber(this.previewRecipients().filter((item) => this.localeCode(item.preferredLanguage) === locale).length)}명</b></span>`).join("");
            this.root.querySelector("[data-message-list]").innerHTML = locales.map((locale, index) => this.messageMarkup(locale, index === 0)).join("");
        },

        messageMarkup(locale, open) {
            const messages = this.draft.messagesByLanguage[locale];
            const selected = new Set(this.draft.channels);
            const fields = [];
            if (selected.has("EMAIL")) fields.push(`<label class="form-field">이메일 제목<input data-message-locale="${locale}" data-message-field="emailSubject" value="${Common.escapeHtml(messages.emailSubject)}"></label><div class="form-field distribution-email-html-field"><div class="distribution-message-field-heading"><span>이메일 본문</span><button class="button button-small button-layer" type="button" data-edit-email-html="${locale}">HTML 편집기</button></div><textarea rows="5" aria-label="${Common.escapeHtml(this.localeLabel(locale))} 이메일 본문" data-message-locale="${locale}" data-message-field="emailBody">${Common.escapeHtml(messages.emailBody)}</textarea></div>`);
            if (selected.has("SMS")) fields.push(`<label class="form-field">문자 안내문<textarea rows="3" maxlength="1000" data-message-locale="${locale}" data-message-field="smsBody">${Common.escapeHtml(messages.smsBody)}</textarea></label>`);
            if (selected.has("KAKAO")) fields.push(`<details class="distribution-approved-source"><summary>승인 원문 확인</summary><label class="form-field"><span class="sr-only">카카오 승인 안내문</span><textarea rows="3" maxlength="1000" data-message-locale="${locale}" data-message-field="kakaoBody" readonly placeholder="승인된 템플릿을 불러와 선택하세요.">${Common.escapeHtml(messages.kakaoBody)}</textarea></label></details>`);
            if (selected.has("FAX")) fields.push(`<label class="form-field">팩스 표지 제목<input data-message-locale="${locale}" data-message-field="faxTitle" value="${Common.escapeHtml(messages.faxTitle)}"></label><label class="form-field">팩스 안내문<textarea rows="4" data-message-locale="${locale}" data-message-field="faxBody">${Common.escapeHtml(messages.faxBody)}</textarea></label>`);
            const preset = `<div class="distribution-message-preset"><label><span class="sr-only">문자 기본 문안</span><select data-message-preset data-locale="${locale}"><option value="">기본 문안 선택</option><option value="invitation">설문 참여 요청</option><option value="reminder">참여 재안내</option><option value="closing">마감 안내</option></select></label></div>`;
            const kakao = selected.has("KAKAO") ? this.kakaoTemplateMarkup(locale, messages) : "";
            return `<details class="distribution-message-card" ${open ? "open" : ""}><summary><span><strong>${Common.escapeHtml(this.localeLabel(locale))}</strong><small>${Common.formatNumber(this.previewRecipients().filter((item) => this.localeCode(item.preferredLanguage) === locale).length)}명 대상</small></span><b>${this.enabledLocales().includes(locale) ? "확정 번역 사용" : "기본 언어 대체"}</b></summary>${selected.has("SMS") ? preset : ""}${kakao}<div class="distribution-message-fields">${fields.join("") || '<p class="muted">위에서 발송 채널을 선택하세요.</p>'}${fields.length ? '<dl class="distribution-message-legend" aria-label="문안 예약어"><div><dt><code>{{name}}</code></dt><dd>대상자 이름</dd></div><div><dt><code>{{surveyTitle}}</code></dt><dd>대상 언어의 설문 제목</dd></div><div><dt><code>{{surveyUrl}}</code></dt><dd>대상·언어가 반영된 설문 링크</dd></div><div><dt><code>{{closingDate}}</code></dt><dd>마감일 · 미설정 시 별도 안내 시까지</dd></div></dl>' : ""}</div></details>`;
        },

        applyMessagePreset(select) {
            const locale = select.dataset.locale;
            if (!select.value) return;
            this.draft.messagesByLanguage[locale] ||= this.invitationDefaults(locale);
            const presets = {
                invitation: "{{name}} 고객님\n\n안녕하세요. {{surveyTitle}} 설문 참여를 부탁드립니다.\n\n- 설문URL바로가기 : {{surveyUrl}}\n\n감사합니다.",
                reminder: "{{name}}님, {{surveyTitle}} 설문 참여를 다시 안내드립니다. 이미 참여하셨다면 추가 응답은 필요하지 않습니다.\n{{surveyUrl}}",
                closing: "{{name}}님, {{surveyTitle}} 설문 마감일은 {{closingDate}}입니다. 기간 안에 참여 부탁드립니다.\n{{surveyUrl}}"
            };
            this.draft.messagesByLanguage[locale].smsBody = presets[select.value];
            this.renderMessages();
            this.markDirty();
        },

        kakaoTemplateMarkup(locale, messages) {
            const pfId = this.draft.deliveryOptions.kakaoPfId || "";
            const templates = (this.kakaoTemplates || []).filter((item) => item.channelId === pfId && (!item.messageType || item.messageType === "BA") && (!item.emphasizeType || item.emphasizeType === "NONE"));
            const options = templates.map((item) => `<option value="${Common.escapeHtml(item.templateId)}" ${item.templateId === messages.kakaoTemplateId ? "selected" : ""}>${Common.escapeHtml(item.name)}</option>`).join("");
            const stored = messages.kakaoTemplateId && !templates.some((item) => item.templateId === messages.kakaoTemplateId)
                ? `<option value="${Common.escapeHtml(messages.kakaoTemplateId)}" selected>저장된 템플릿 · 다시 불러와 확인</option>` : "";
            const variables = Object.entries(messages.kakaoVariables || {}).map(([key, value]) => `<label>${Common.escapeHtml(key)} 연결<input data-kakao-variable="${Common.escapeHtml(key)}" data-locale="${locale}" value="${Common.escapeHtml(value)}" maxlength="1000" placeholder="예: {{name}} 또는 고정 문구"></label>`).join("");
            return `<section class="distribution-kakao-template"><div class="recipient-bulk-actions"><label>알림톡 템플릿<select data-kakao-template data-locale="${locale}"><option value="">승인 템플릿 선택</option>${stored}${options}</select></label><button class="button button-function" type="button" data-load-kakao-templates="${locale}">불러오기</button><button class="button button-layer" type="button" data-manage-kakao-templates="${locale}">템플릿 관리</button></div><div class="distribution-variable-mapping">${variables}</div></section>`;
        },

        openKakaoTemplateLibrary(locale) {
            const escape = Common.escapeHtml;
            const pfId = this.draft.deliveryOptions.kakaoPfId || "";
            const dialog = this.context.openModal(`<section class="kakao-library"><header><h2>카카오 템플릿 관리</h2><a class="button button-navigation" href="https://console.solapi.com/kakao/templates" target="_blank" rel="noopener noreferrer">SOLAPI 등록·검수 관리 ↗</a></header><div class="kakao-library-tabs" role="group" aria-label="템플릿 종류"><button class="button button-navigation button-cue-hidden" type="button" data-library-tab="approved" aria-pressed="true">승인 템플릿</button><button class="button button-navigation button-cue-hidden" type="button" data-library-tab="basic" aria-pressed="false">기본 문안</button></div><div class="kakao-library-tools"><button class="button button-function" type="button" data-library-reload ${pfId ? "" : "disabled"}>승인 목록 조회</button><a href="https://console.solapi.com/kakao/plus-friends" target="_blank" rel="noopener noreferrer">채널 관리 ↗</a><details><summary>?</summary><p>기본 문안 선택 → 등록 문안 복사 → SOLAPI에서 채널에 등록·검수 요청 → 승인 목록 조회 → 선택 적용 순서입니다. 제공 문안은 등록 예시이며 카카오의 실제 승인 결과를 보장하지 않습니다. 승인된 기본형만 발송에 사용할 수 있습니다.</p></details></div><output data-library-status role="status"></output><div class="kakao-library-workspace"><nav data-library-list aria-label="템플릿 목록"></nav><div data-library-detail></div></div><footer><button class="button button-function" type="button" data-library-copy hidden>등록 문안 복사</button><button class="button button-save button-important" type="button" data-library-apply disabled>선택 적용</button><button class="button button-layer button-cue-hidden" type="button" data-library-close>닫기</button></footer></section>`, { label: "카카오 템플릿 관리", wide: true, initialFocus: "[data-library-close]" });
            if (!dialog) return;
            dialog.addEventListener("close", () => {
                if (this.root?.isConnected && this.context.isCurrentRoute?.() !== false) {
                    [...this.root.querySelectorAll("[data-manage-kakao-templates]")].find(button => button.dataset.manageKakaoTemplates === locale)?.focus({ preventScroll: true });
                }
            }, { once: true });
            const host = dialog.querySelector(".kakao-library");
            const status = host.querySelector("[data-library-status]");
            let tab = "approved", selected = null, loading = false;
            const basicDrafts = new Map(KAKAO_STARTERS.map(item => [item.id, { ...item }]));
            const current = () => dialog.open && host.isConnected && this.context.isCurrentRoute?.() !== false;
            const entries = () => tab === "basic" ? [...basicDrafts.values()] : (this.kakaoTemplates || []).filter(item => item.channelId === pfId && (!item.messageType || item.messageType === "BA") && (!item.emphasizeType || item.emphasizeType === "NONE"));
            const identifier = item => tab === "basic" ? item.id : item.templateId;
            const render = () => {
                const items = entries();
                const item = items.find(item => identifier(item) === selected);
                host.querySelectorAll("[data-library-tab]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.libraryTab === tab)));
                host.querySelector("[data-library-list]").innerHTML = items.map(item => `<button type="button" data-library-item="${escape(identifier(item))}" aria-pressed="${identifier(item) === selected}"><strong>${escape(item.name)}</strong><small>${tab === "basic" ? "등록용 예시 · 승인 전" : "승인됨"}</small></button>`).join("");
                status.textContent = tab === "basic" ? "등록용 예시 · SOLAPI 승인 후 발송 가능" : !pfId ? "발송 설정에 SOLAPI 채널 ID(PFID)를 먼저 입력하세요." : items.length ? `승인 템플릿 ${items.length}개` : "승인 목록을 조회하거나 기본 문안으로 등록을 준비하세요.";
                const detail = host.querySelector("[data-library-detail]");
                detail.innerHTML = item ? tab === "basic" ? `<label class="form-field">등록 이름<input data-library-name maxlength="100" value="${escape(item.name)}"></label><label class="form-field">등록 문안<textarea data-library-content maxlength="1000" rows="10">${escape(item.content)}</textarea></label>` : `<h3>${escape(item.name)}</h3><pre>${escape(item.content)}</pre>${(item.buttons || []).map(button => `<div class="distribution-message-link">${escape(button.buttonName || "버튼")}</div>`).join("")}` : "<p>목록에서 템플릿을 선택하세요.</p>";
                host.querySelector("[data-library-copy]").hidden = tab !== "basic";
                host.querySelector("[data-library-copy]").disabled = !item;
                host.querySelector("[data-library-apply]").hidden = tab === "basic";
                host.querySelector("[data-library-apply]").disabled = !item || Boolean(this.draft.executionStatus);
            };
            host.addEventListener("input", event => {
                if (tab !== "basic") return;
                const item = basicDrafts.get(selected);
                if (!item) return;
                if (event.target.matches("[data-library-name]")) item.name = event.target.value;
                if (event.target.matches("[data-library-content]")) item.content = event.target.value;
            });
            host.addEventListener("click", async event => {
                if (event.target.closest("[data-library-close]")) return dialog.close();
                const switcher = event.target.closest("[data-library-tab]");
                if (switcher) { tab = switcher.dataset.libraryTab; selected = null; return render(); }
                const choice = event.target.closest("[data-library-item]");
                if (choice) { selected = choice.dataset.libraryItem; return render(); }
                if (event.target.closest("[data-library-copy]") && tab === "basic") {
                    const item = basicDrafts.get(selected);
                    if (!item) return;
                    try { await Common.copyText(item.content); if (current()) status.textContent = "등록 문안을 복사했습니다. SOLAPI에서 등록·검수 요청하세요."; }
                    catch { if (current()) status.textContent = "복사하지 못했습니다. 등록 문안을 직접 선택해 복사하세요."; }
                }
                if (event.target.closest("[data-library-apply]") && tab === "approved" && !this.draft.executionStatus && this.draft.deliveryOptions.kakaoPfId === pfId) {
                    if (!entries().some(item => item.templateId === selected)) return;
                    this.selectKakaoTemplate({ value: selected, dataset: { locale } });
                    dialog.close();
                }
                if (event.target.closest("[data-library-reload]") && pfId && !loading) {
                    loading = true;
                    const button = host.querySelector("[data-library-reload]"); button.disabled = true;
                    status.textContent = "승인 목록 조회 중…";
                    try {
                        const items = await this.context.api.get(`/api/deployments/solapi/templates?pfId=${encodeURIComponent(pfId)}`);
                        if (!current() || this.draft.deliveryOptions.kakaoPfId !== pfId) return;
                        this.kakaoTemplates = items; this.renderMessages();
                        tab = "approved"; selected = null; render();
                        if (!entries().length) status.textContent = "발송 가능한 승인 템플릿이 없습니다. 기본 문안을 선택해 SOLAPI에서 등록하세요.";
                    } catch (error) { if (current()) status.textContent = error.message; }
                    finally { loading = false; if (current()) button.disabled = false; }
                }
            });
            render();
        },

        async loadKakaoTemplates() {
            const pfId = this.draft.deliveryOptions.kakaoPfId;
            if (!pfId) return this.context.toast("발신 정보에서 카카오 채널 ID를 입력해 주세요.", "error");
            const buttons = this.root.querySelectorAll("[data-load-kakao-templates]");
            buttons.forEach((button) => { button.disabled = true; });
            try {
                const templates = await this.context.api.get(`/api/deployments/solapi/templates?pfId=${encodeURIComponent(pfId)}`);
                if (!this.root || pfId !== this.draft.deliveryOptions.kakaoPfId) return;
                this.kakaoTemplates = templates;
                this.renderMessages();
                if (!this.kakaoTemplates.length) this.context.toast("이 채널에 발송 가능한 승인 템플릿이 없습니다.", "warning");
            } catch (error) { this.context.toast(error.message, "error"); }
            finally { this.root?.querySelectorAll("[data-load-kakao-templates]").forEach((button) => { button.disabled = false; }); }
        },

        selectKakaoTemplate(select) {
            const template = this.kakaoTemplates.find((item) => item.templateId === select.value && item.channelId === this.draft.deliveryOptions.kakaoPfId);
            if (!template) return;
            const messages = this.draft.messagesByLanguage[select.dataset.locale];
            messages.kakaoTemplateId = template.templateId;
            messages.kakaoBody = template.content;
            messages.kakaoButtons = structuredClone(template.buttons || []);
            const names = new Set([...(template.variables || []).map((item) => item.name), ...[...JSON.stringify([template.content, template.buttons]).matchAll(/#\{([^{}]+)\}/g)].map((match) => match[1])]);
            const auto = { 이름: "{{name}}", name: "{{name}}", 설문명: "{{surveyTitle}}", 제목: "{{surveyTitle}}", 설문URL: "{{surveyUrl}}", 설문주소: "{{surveyUrl}}", URL: "{{surveyUrl}}", url: "{{surveyUrl}}", 마감일: "{{closingDate}}" };
            messages.kakaoVariables = Object.fromEntries([...names].map((name) => [name.startsWith("#{") ? name : `#{${name}}`, auto[name] || ""]));
            this.renderMessages();
            this.markDirty();
        },

        previewRecipients() {
            const candidates = this.scopeCandidates();
            // Empty channel selection is an incomplete draft, not a send scope.
            return candidates.filter((item) => !this.draft.channels.length || this.draft.channels.some((code) => item.channels.includes(code) && String(item[CHANNELS.find((channel) => channel.code === code)?.field] || "").trim()));
        },

        renderPreviewRecipients() {
            const recipients = this.previewRecipients();
            if (this.sendScope() === "INDIVIDUAL") this.previewRecipientId = this.draft.deliveryOptions.individualRecipientId;
            if (!recipients.some((item) => item.id === this.previewRecipientId)) {
                this.previewRecipientId = recipients.find((item) => item.id === this.activeRecipientId)?.id || recipients[0]?.id || null;
            }
            const search = (this.previewSearch || "").trim().toLocaleLowerCase();
            const filtered = recipients.filter((item) => item.name.toLocaleLowerCase().includes(search));
            this.previewRecipientPage = Math.max(0, Math.min(this.previewRecipientPage || 0, Math.ceil(filtered.length / 25) - 1));
            const start = this.previewRecipientPage * 25;
            this.root.querySelector("[data-preview-recipients]").innerHTML = filtered.slice(start, start + 25).map((item) => `<button class="distribution-preview-recipient" type="button" data-preview-recipient="${Common.escapeHtml(item.id)}" aria-pressed="${item.id === this.previewRecipientId}">${Common.escapeHtml(item.name)}</button>`).join("") || '<p>일치하는 발송 대상자가 없습니다.</p>';
            const pages = this.root.querySelector("[data-preview-recipient-pages]");
            pages.hidden = filtered.length <= 25;
            pages.innerHTML = `<button class="button button-small button-function" type="button" data-preview-recipient-page="${this.previewRecipientPage - 1}" ${!start ? "disabled" : ""}>이전</button><span>${start + 1}–${Math.min(start + 25, filtered.length)} / ${filtered.length}명</span><button class="button button-small button-function" type="button" data-preview-recipient-page="${this.previewRecipientPage + 1}" ${start + 25 >= filtered.length ? "disabled" : ""}>다음</button>`;
        },

        queuePreview() {
            clearTimeout(this.previewTimer);
            if (this.step !== 2 || this.draft.executionStatus || this.awaitingDeliveryEdit) return;
            if (this.previewSignature === JSON.stringify(this.buildPayload()) && this.previewItems?.length) return;
            this.previewTimer = setTimeout(() => this.previewDelivery({ silent: true }), 450);
        },

        async previewDelivery({ silent = false } = {}) {
            clearTimeout(this.previewTimer);
            const host = this.root.querySelector("[data-delivery-preview]");
            const invalid = [2].find((step) => !this.validateStep(step, false));
            if (invalid) {
                if (!silent) { this.goStep(invalid); this.validateStep(invalid, true); }
                this.renderPreviewPlaceholder(this.previewRecipients().length ? "문안과 발신 정보·예약 시각을 확인하세요. 카카오는 승인 템플릿을 선택하세요." : "발송할 대상자와 수신 연락처를 선택하세요.");
                return;
            }
            this.renderPreviewRecipients();
            const recipientId = this.previewRecipientId;
            if (!recipientId) return;
            const payload = this.buildPayload();
            const signature = JSON.stringify(payload);
            const requestId = this.previewRequestId = (this.previewRequestId || 0) + 1;
            host.setAttribute("aria-busy", "true");
            this.previewSignature = null;
            this.syncPreviewAction();
            this.renderPreviewPlaceholder("실제 발송 문안을 확인하고 있습니다…");
            try {
                const result = await this.context.api.post(`/api/deployments/by-survey/${encodeURIComponent(this.current.id)}/preview?recipientId=${encodeURIComponent(recipientId)}`, payload);
                if (!this.root || requestId !== this.previewRequestId || signature !== JSON.stringify(this.buildPayload()) || recipientId !== this.previewRecipientId) return;
                this.previewItems = result.items || [];
                // A successful preview of the complete plan is required before sending.
                this.previewSignature = this.previewItems.length ? signature : null;
                this.previewTotal = result.total;
                this.renderDeliveryPreview();
            } catch (error) {
                if (!this.root || requestId !== this.previewRequestId) return;
                this.previewSignature = null;
                this.previewItems = [];
                this.renderPreviewPlaceholder(error.message);
                if (!silent) this.context.toast(error.message, "error");
            } finally {
                if (this.root && requestId === this.previewRequestId) {
                    host.setAttribute("aria-busy", "false");
                    this.syncPreviewAction();
                }
            }
        },

        previewText(text) {
            // Link only HTTP(S) URLs, escaping both text and attributes.
            return String(text || "").split(/(https?:\/\/[^\s<>"']+)/g).map((part) => /^https?:\/\//.test(part)
                ? `<a href="${Common.escapeHtml(part)}" target="_blank" rel="noopener noreferrer">${Common.escapeHtml(part)}</a>` : Common.escapeHtml(part)).join("");
        },

        previewDeviceMarkup(item, buttons = "", placeholder = false) {
            const code = ["KAKAO", "SMS", "EMAIL", "FAX"].includes(item.channel) ? item.channel : "SMS";
            const email = code === "EMAIL";
            const label = CHANNELS.find((channel) => channel.code === code)?.label || code;
            const body = !placeholder && email && /<[a-z][\s\S]*>/i.test(item.text)
                ? '<iframe class="distribution-email-preview" title="수신 이메일 본문" sandbox="" referrerpolicy="no-referrer"></iframe>'
                : `<div class="distribution-message-content">${this.previewText(item.text)}</div>`;
            return `<article class="distribution-message-device is-${code.toLowerCase()} ${placeholder ? "is-preview-placeholder" : "is-preview-ready"}" aria-label="${label} 수신 화면"><div class="distribution-device-chrome" aria-hidden="true">${email ? '<span>받은편지함</span><span>메일</span>' : '<span>9:41</span><i></i><span>▮▮ ▰</span>'}</div><div class="distribution-device-screen"><header><strong>${Common.escapeHtml(item.name || "미리보기")}</strong><span>${label} · ${placeholder ? "입력 확인" : item.enabled ? "발송 예정" : "미연동·보류"}</span></header>${placeholder ? "" : `<dl class="distribution-message-envelope"><div><dt>발신</dt><dd>${Common.escapeHtml(item.sender || "설정 필요")}</dd></div><div><dt>수신</dt><dd>${Common.escapeHtml(item.destination || "")}</dd></div></dl>`}${item.subject ? `<h4 class="distribution-email-subject">${Common.escapeHtml(item.subject)}</h4>` : ""}<div class="distribution-message-bubble">${body}${buttons}</div></div><div class="distribution-device-home" aria-hidden="true"></div></article>`;
        },

        renderPreviewPlaceholder(message) {
            const code = this.activeChannel || this.draft?.channels?.[0] || "KAKAO";
            this.root.querySelector("[data-delivery-preview]").innerHTML = this.previewDeviceMarkup({ channel: code, text: message }, "", true);
        },

        renderDeliveryPreview() {
            const host = this.root.querySelector("[data-delivery-preview]");
            const items = this.previewItems || [];
            const item = items.find((item) => item.channel === this.previewChannel) || items[0];
            if (!item) { this.renderPreviewPlaceholder("이 대상자에게 선택한 채널로 발송할 내용이 없습니다."); return; }
            this.previewChannel = item.channel;
            const label = (code) => CHANNELS.find((channel) => channel.code === code)?.label || code;
            const buttons = (item.buttons || []).map((button) => {
                const url = button.linkMo || button.linkPc || "";
                const name = Common.escapeHtml(button.buttonName || "버튼");
                return /^https?:\/\//i.test(url) ? `<a class="distribution-message-link" href="${Common.escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${name}</a>` : `<span class="distribution-message-link">${name}</span>`;
            }).join("");
            host.innerHTML = `<div class="distribution-preview-channels" role="group" aria-label="미리볼 채널" ${items.length < 2 ? "hidden" : ""}>${items.map((entry) => `<button type="button" data-preview-channel="${Common.escapeHtml(entry.channel)}" aria-pressed="${entry.channel === item.channel}">${label(entry.channel)}</button>`).join("")}</div>${this.previewDeviceMarkup(item, buttons)}<p class="distribution-preview-total">총 ${Common.formatNumber(this.previewTotal)}건 예정${item.messageType ? ` · ${item.messageType === "LMS" ? "장문 LMS" : "단문 SMS"} · ${Common.formatNumber(item.messageBytes)} / ${item.messageType === "LMS" ? "2,000" : "90"} byte` : ""}</p>`;
            const frame = host.querySelector("iframe");
            if (frame) {
                // Opaque sandbox + CSP: no scripts, forms or tracking requests.
                const document = new DOMParser().parseFromString(item.text, "text/html");
                document.querySelectorAll("script,iframe,object,embed,form,input,button,meta,base,link").forEach((node) => node.remove());
                document.querySelectorAll("*").forEach((node) => [...node.attributes].forEach((attribute) => {
                    if (/^on/i.test(attribute.name) || ["srcset", "formaction", "action"].includes(attribute.name) || (/^(href|src)$/i.test(attribute.name) && !/^(https?:|data:image\/)/i.test(attribute.value))) node.removeAttribute(attribute.name);
                }));
                frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'"><style>body{margin:12px;font:16px/1.6 sans-serif;overflow-wrap:anywhere}img,table{max-width:100%}</style></head><body>${document.body.innerHTML}</body></html>`;
            }
        },

        syncPreviewAction() {
            const valid = Boolean(this.previewSignature && this.previewSignature === JSON.stringify(this.buildPayload()));
            const button = this.root.querySelector("[data-distribution-execute]");
            const unavailable = this.draft.channels.length && !this.draft.channels.some((code) => this.providerReady(code));
            button.textContent = this.draft.schedule.mode === "SCHEDULED" ? "예약 발송 요청" : "발송 요청";
            if (unavailable) button.textContent = this.draft.channels.every((code) => code === "EMAIL") ? "이메일 발송 미연동" : "발송 연동 설정 필요";
            button.disabled = this.awaitingDeliveryEdit || unavailable || !valid || this.saving || this.sending || this.actionBusy || Boolean(this.draft.executionStatus);
            const consent = this.root.querySelector("[data-delivery-consent]");
            consent.disabled = !valid || this.saving || this.sending || this.actionBusy || Boolean(this.draft.executionStatus);
        },

        updateMessageField(element) {
            const locale = this.localeCode(element.dataset.messageLocale);
            this.draft.messagesByLanguage[locale] ||= this.invitationDefaults(locale);
            this.draft.messagesByLanguage[locale][element.dataset.messageField] = element.value;
            this.markDirty();
        },

        async openEmailEditor(value) {
            const locale = this.localeCode(value);
            this.draft.messagesByLanguage[locale] ||= this.invitationDefaults(locale);
            await window.SurveyCodeEditor.open({
                context: this.context,
                title: `${this.localeLabel(locale)} · 이메일 HTML 안내문`,
                description: "이메일 본문 HTML을 문법 강조와 격리 미리보기로 작성합니다. 이메일에서는 JavaScript가 실행되지 않습니다.",
                tabs: ["html"],
                allowEnable: false,
                allowPlacement: false,
                email: true,
                sources: { enabled: true, html: this.draft.messagesByLanguage[locale].emailBody },
                onApply: (source) => {
                    this.draft.messagesByLanguage[locale].emailBody = source.html;
                    const textarea = [...this.root.querySelectorAll('[data-message-field="emailBody"]')].find((item) => this.localeCode(item.dataset.messageLocale) === locale);
                    if (textarea) textarea.value = source.html;
                    this.markDirty();
                    this.context.toast(`${this.localeLabel(locale)} 이메일 HTML 안내문을 배포 초안에 반영했습니다.`, "success");
                }
            });
        },

        publicUrlFor(item) {
            const slug = item?.publicSlug || item?.slug;
            const value = item?.publicUrl || (slug ? `/s/${encodeURIComponent(slug)}` : "");
            if (!value) return "";
            try { return new URL(String(value), this.publicBaseUrl).href; }
            catch { return ""; }
        },

        publicUrl() {
            return this.publicUrlFor(this.current);
        },

        replaceDraftPublicUrl(previousUrl, nextUrl) {
            if (!previousUrl || !nextUrl || previousUrl === nextUrl) return;
            let previousPath = "";
            let nextPath = "";
            try {
                previousPath = new URL(previousUrl).pathname;
                nextPath = new URL(nextUrl).pathname;
            } catch { /* absolute URLs are expected; exact replacement still applies. */ }
            const replace = (value) => {
                if (typeof value !== "string") return value;
                let next = value.replaceAll(previousUrl, nextUrl);
                if (previousPath && nextPath) {
                    const escapedPath = previousPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                    next = next.replace(new RegExp(`${escapedPath}(?![a-z0-9-])`, "g"), nextPath);
                }
                return next;
            };
            Object.values(this.draft.messagesByLanguage || {}).forEach((messages) => {
                ["emailSubject", "emailBody", "smsBody", "faxTitle", "faxBody"].forEach((key) => {
                    if (key in messages) messages[key] = replace(messages[key]);
                });
                Object.keys(messages.kakaoVariables || {}).forEach((key) => {
                    messages.kakaoVariables[key] = replace(messages.kakaoVariables[key]);
                });
                // Keep the provider-approved Kakao source and buttons intact.
            });
        },

        languageUrl(locale) {
            const value = this.publicUrl();
            if (!value) return "";
            const url = new URL(value);
            url.searchParams.set("lang", this.localeCode(locale));
            return url.href;
        },

        async copyLanguageUrl(locale) {
            const value = this.languageUrl(locale);
            if (!value) return this.context.toast("복사할 공개 설문 URL이 없습니다.", "error");
            try { await Common.copyText(value); this.context.toast(`${this.localeLabel(locale)} 설문 URL을 복사했습니다.`, "success"); }
            catch { this.context.toast("브라우저에서 URL 복사를 허용하지 않았습니다.", "error"); }
        },

        validateStep(step, showError = true) {
            const error = (selector, message) => {
                if (showError) {
                    const box = this.root.querySelector(selector);
                    box.textContent = message;
                    box.hidden = false;
                    box.focus?.();
                }
                return false;
            };
            if (step === 1) {
                this.root.querySelector("[data-recipient-error]").hidden = true;
                if (!this.draft.recipients.some((item) => item.selected !== false && this.recipientHasInput(item))) return error("[data-recipient-error]", "대상자를 한 명 이상 추가해 주세요.");
                const invalid = this.draft.recipients.filter((item) => item.selected !== false && this.recipientHasInput(item)).find((recipient) => !recipient.name.trim() || !recipient.countryCode || !recipient.preferredLanguage || !recipient.channels.length || recipient.channels.some((code) => !String(recipient[CHANNELS.find((item) => item.code === code)?.field] || "").trim()));
                if (invalid) return error("[data-recipient-error]", "모든 대상자의 이름·국가·선호 언어와 한 개 이상의 유효한 전송 채널을 확인해 주세요.");
                const unsupported = this.draft.recipients.filter((item) => item.selected !== false && this.recipientHasInput(item)).find((recipient) => !this.enabledLocales().includes(this.localeCode(recipient.preferredLanguage)));
                if (unsupported) return error("[data-recipient-error]", `${unsupported.name} 대상자의 선호 언어는 현재 확정 버전에 포함되지 않았습니다.`);
            }
            if (step === 2) {
                this.root.querySelector("[data-recipient-scope-error]").hidden = true;
                if (this.sendScope() === "INDIVIDUAL" && this.hasPendingDirectReceiver()) return error("[data-recipient-scope-error]", "직접 입력한 내용을 '입력한 수신자 선택'으로 적용해 주세요.");
                const recipients = this.previewRecipients();
                if (this.sendScope() === "INDIVIDUAL" && !this.draft.deliveryOptions.individualRecipientId) return error("[data-recipient-scope-error]", "개별 발송할 수신자를 선택해 주세요.");
                if (!recipients.length) return error("[data-recipient-scope-error]", "현재 채널로 발송할 대상자가 없습니다. 명단과 수신 연락처를 확인하세요.");
                const invalidRecipient = recipients.find((item) => !item.name.trim() || !item.countryCode || !this.enabledLocales().includes(this.localeCode(item.preferredLanguage)));
                if (invalidRecipient) return error("[data-recipient-scope-error]", "발송 대상자의 이름·국가·확정 언어를 확인하세요.");
                this.root.querySelector("[data-channel-error]").hidden = true;
                this.root.querySelector("[data-schedule-error]").hidden = true;
                if (!this.draft.channels.length) return error("[data-channel-error]", "사용할 발송 채널을 한 개 이상 선택해 주세요.");
                const usable = this.draft.channels.some((code) => this.previewRecipients().some((recipient) => recipient.channels.includes(code)));
                if (!usable) return error("[data-channel-error]", "선택한 채널로 전송 가능한 대상자가 없습니다.");
                if (this.draft.schedule.mode === "SCHEDULED") {
                    if (!this.draft.schedule.scheduledAt) return error("[data-schedule-error]", "예약 발송 시각을 입력해 주세요.");
                    if (new Date(this.draft.schedule.scheduledAt) <= new Date()) return error("[data-schedule-error]", "예약 발송 시각은 현재보다 이후여야 합니다.");
                }
            }
            if (step === 2) {
                this.root.querySelector("[data-message-error]").hidden = true;
                this.ensureMessages();
                const requirements = { EMAIL: ["emailSubject", "emailBody"], SMS: ["smsBody"], KAKAO: ["kakaoBody"], FAX: ["faxTitle", "faxBody"] };
                const missing = this.recipientLocales().find((locale) => this.draft.channels.filter((code) => this.previewRecipients().some((item) => this.localeCode(item.preferredLanguage) === locale && item.channels.includes(code))).some((code) => requirements[code].some((field) => !String(this.draft.messagesByLanguage[locale]?.[field] || "").trim())));
                if (missing) return error("[data-message-error]", `${this.localeLabel(missing)} 안내문에 비어 있는 필수 항목이 있습니다.`);
            }
            return true;
        },

        nextStep() {
            this.maxStep = 2;
            this.goStep(2);
        },

        goStep(step) {
            if (!Number.isInteger(step) || step < 1 || step > 2 || step === this.step) return;
            const previousPanel = this.root.querySelector(`[data-distribution-step="${this.step}"]`);
            this.stepScrollPositions[this.step] = {
                panel: previousPanel.scrollTop,
                editor: this.root.querySelector(".distribution-compose-editor").scrollTop,
                preview: this.root.querySelector(".distribution-send-desk").scrollTop
            };
            this.step = step;
            if (step === 2) {
                this.renderChannels(); this.renderRecipientScope(); this.renderMessages(); this.renderReview(); this.renderPreviewRecipients();
                this.root.querySelector("[data-preview-search]").value = this.previewSearch || "";
                this.queuePreview();
            }
            this.updateWorkflow();
            const panel = this.root.querySelector(`[data-distribution-step="${step}"]`);
            const scroll = this.stepScrollPositions[step] || {};
            panel.scrollTop = scroll.panel || 0;
            if (step === 2) {
                this.root.querySelector(".distribution-compose-editor").scrollTop = scroll.editor || 0;
                this.root.querySelector(".distribution-send-desk").scrollTop = scroll.preview || 0;
            }
            const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
            this.root.querySelector("[data-distribution-workflow]").scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
        },

        updateWorkflow() {
            this.root.querySelector("[data-distribution-workflow]").classList.toggle("is-recipient-step", this.step === 1);
            this.root.querySelectorAll("[data-distribution-step]").forEach((panel) => { panel.hidden = Number(panel.dataset.distributionStep) !== this.step; });
            this.root.querySelectorAll("[data-distribution-step-target]").forEach((button) => {
                const number = Number(button.dataset.distributionStepTarget);
                const item = button.closest("li");
                button.disabled = false;
                item.classList.toggle("is-current", number === this.step);
                item.classList.toggle("is-complete", false);
                if (number === this.step) item.setAttribute("aria-current", "step"); else item.removeAttribute("aria-current");
            });
            this.root.querySelector("[data-distribution-step-kicker]").textContent = `DISTRIBUTION · STEP ${String(this.step).padStart(2, "0")}`;
            this.root.querySelector("[data-distribution-title]").textContent = STEP_TITLES[this.step];
            this.root.querySelector("[data-step-position]").textContent = `STEP ${String(this.step).padStart(2, "0")} / 02`;
            this.root.querySelector("[data-distribution-previous]").disabled = this.step === 1;
            const next = this.root.querySelector("[data-distribution-next]");
            next.hidden = this.step === 2;
            next.textContent = "미리보기·발송";
            this.root.querySelector("[data-distribution-execute]").hidden = this.step !== 2;
            this.root.querySelector("[data-send-confirmation]").hidden = this.step !== 2;
            this.syncPreviewAction();
            this.updateSaveState();
            // Restore temporary busy states after rebuilding step controls.
            this.syncExecutionLock();
        },

        renderReview() {
            const selected = this.draft.channels.map((code) => CHANNELS.find((channel) => channel.code === code)).filter(Boolean);
            this.root.querySelector("[data-distribution-review]").textContent = `${this.sendScope() === "INDIVIDUAL" ? "개별" : "일괄"} ${Common.formatNumber(this.previewRecipients().length)}명 · ${selected.map((item) => item.label).join(" · ") || "채널 선택 필요"}`;
            const disabled = selected.filter((item) => !this.providerReady(item.code));
            const note = this.root.querySelector("[data-execute-note]");
            note.className = `distribution-execute-note${disabled.length ? " is-warning" : " is-ready"}`;
            note.textContent = disabled.length ? `${disabled.map((item) => item.label).join("·")} 미연동 · 실제 전송 없이 보류됩니다.` : "선택한 대상자에게만 발송합니다. 접수 결과는 이력에 저장됩니다.";
            const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            this.root.querySelector("[data-schedule-zone]").textContent = `(${zone})`;
        },

        buildPayload() {
            this.ensureMessages();
            const messagesByLanguage = Object.fromEntries(this.recipientLocales().map((locale) => [locale, structuredClone(this.draft.messagesByLanguage[locale])]));
            const recipients = this.draft.recipients.filter((recipient) => this.recipientHasInput(recipient));
            const payload = {
                revision: this.draft.revision,
                recipients: recipients.map((recipient) => ({
                    id: recipient.id,
                    name: recipient.name.trim(),
                    countryCode: recipient.countryCode,
                    preferredLanguage: this.localeCode(recipient.preferredLanguage),
                    email: recipient.email.trim() || null,
                    mobile: recipient.mobile.trim() || null,
                    fax: recipient.fax.trim() || null,
                    kakaoId: recipient.kakaoId.trim() || null,
                    channels: [...recipient.channels],
                    selected: recipient.selected !== false,
                    audienceCode: recipient.audienceCode || null
                })),
                channels: [...this.draft.channels],
                deliveryOptions: { ...this.draft.deliveryOptions },
                messagesByLanguage,
                schedule: { ...this.draft.schedule, priority: this.draft.schedule.priority.filter((code) => this.draft.channels.includes(code)), scheduledAt: this.draft.schedule.mode === "SCHEDULED" ? this.draft.schedule.scheduledAt : null },
                status: "DRAFT"
            };
            if (payload.revision === null || payload.revision === undefined) delete payload.revision;
            return payload;
        },

        recipientHasInput(recipient) {
            return Boolean(
                String(recipient?.name || "").trim()
                || CHANNELS.some((channel) => String(recipient?.[channel.field] || "").trim())
                || (Array.isArray(recipient?.channels) && recipient.channels.length)
            );
        },

        async saveDraft(options = {}) {
            if (this.saving || !this.current || this.awaitingDeliveryEdit) return null;
            if (this.hasPendingDirectReceiver()) { this.context.toast("직접 입력한 수신자를 선택한 뒤 저장해 주세요.", "error"); return null; }
            this.saving = true;
            this.updateSaveState("저장 중…");
            this.setActionDisabled(true);
            try {
                const payload = await this.context.api.put(`/api/deployments/by-survey/${encodeURIComponent(this.current.id)}`, this.buildPayload());
                const saved = payload?.deployment || payload || {};
                this.draft = this.normalizeDraft(saved);
                this.clearRecipientUndo();
                this.previewSignature = null;
                this.dirty = false;
                this.renderRecipients();
                this.renderChannels();
                this.renderMessages();
                if (this.step === 2) { this.renderRecipientScope(); this.renderReview(); this.renderPreviewRecipients(); this.queuePreview(); }
                this.updateWorkflow();
                this.updateSaveState(`초안 r${this.draft.revision} 저장됨 · 연락처 마스킹 표시`);
                if (!options.silent) this.context.toast("배포 초안을 저장했습니다. 연락처는 안전하게 마스킹해 표시합니다.", "success");
                return saved;
            } catch (error) {
                this.updateSaveState("저장 실패");
                const message = Number(error?.status) === 422
                    ? "초안 입력값을 확인해 주세요. 입력을 시작한 대상자는 대상자명과 선택한 채널의 연락처가 필요합니다."
                    : error.message;
                this.context.toast(message, "error");
                return null;
            } finally {
                this.saving = false;
                this.setActionDisabled(false);
            }
        },

        async execute() {
            if (this.awaitingDeliveryEdit || this.saving || this.sending || this.actionBusy || this.draft?.executionStatus) return;
            const invalidStep = [2].find((step) => !this.validateStep(step, false));
            if (invalidStep) {
                this.maxStep = Math.max(this.maxStep, invalidStep || 1);
                this.goStep(invalidStep || 1);
                this.validateStep(invalidStep, true);
                return;
            }
            if (this.previewSignature !== JSON.stringify(this.buildPayload())) {
                this.context.toast("현재 내용의 대상별 미리보기를 먼저 확인해 주세요.", "error");
                return this.previewDelivery();
            }
            if (!this.root.querySelector("[data-delivery-consent]").checked) return this.context.toast("수신 동의와 발송 확인에 체크해 주세요.", "error");
            const count = this.previewRecipients().length;
            const confirmedSignature = JSON.stringify(this.buildPayload());
            if (!(await this.context.confirmMessage(
                `${this.sendScope() === "INDIVIDUAL" ? "개별 수신자" : "일괄 대상자"} ${Common.formatNumber(count)}명에게 발송을 요청할까요? 활성 SOLAPI 채널은 실제 메시지를 전송하며 비용이 발생할 수 있습니다. 비활성 채널은 보류됩니다.${this.lastExecutionRevision ? " 이전 발송·예약을 변경하거나 취소하지 않는 새 요청입니다." : ""}`,
                { title: this.draft.schedule.mode === "SCHEDULED" ? "예약 발송 확인" : "실제 발송 확인", confirmLabel: this.draft.schedule.mode === "SCHEDULED" ? "예약 요청" : "발송 요청", tone: "warning" }
            ))) return;
            if (confirmedSignature !== JSON.stringify(this.buildPayload()) || confirmedSignature !== this.previewSignature) return;
            this.setActionDisabled(true);
            this.sending = true;
            this.updateSaveState("발송 작업 확정 중…");
            try {
                const payload = await this.context.api.post(`/api/deployments/by-survey/${encodeURIComponent(this.current.id)}/execute`, this.buildPayload());
                this.draft = this.normalizeDraft(payload?.deployment || {});
                this.dirty = false;
                this.executionResult = payload?.execution || {};
                await this.sendStagedDelivery();
                this.renderRecipients();
                this.renderReview();
                this.renderExecutionResult(this.executionResult);
                this.updateSaveState("발송 요청 결과 저장됨");
            } catch (error) {
                this.updateSaveState(this.draft.executionStatus ? "발송 요청 결과 확인 필요" : "발송 요청 실패");
                this.context.toast(error.message, "error");
                if (this.draft.executionStatus) await this.refreshDeliveryStatus();
            } finally {
                this.sending = false;
                this.setActionDisabled(false);
            }
            if (this.draft.executionStatus) { this.enableDirectEditing(); await this.openDeliveryResults(); }
        },

        deliveryLogTable(items, history = false) {
            const labels = {ACCEPTED: "접수", FAILED: "접수 실패", UNKNOWN: "확인 필요", QUEUED: "미요청", DISABLED: "보류", SENT: "전송 완료", CANCELLED: "취소"};
            if (!items.length) return "<p>표시할 발송 기록이 없습니다.</p>";
            return `<div class="delivery-log-table"><table><thead><tr>${history ? '<th scope="col">프로젝트·버전</th>' : ""}<th scope="col">시각</th><th scope="col">채널·결과</th><th scope="col">반환 메시지·조회 정보</th></tr></thead><tbody>${items.map((item) => `<tr>${history ? `<td data-label="프로젝트·버전">${Common.escapeHtml(item.surveyTitle)}<br>v${item.surveyVersion}</td>` : ""}<td data-label="시각">${Common.escapeHtml(Common.formatDate(item.updatedAt || item.createdAt, {hour:"2-digit",minute:"2-digit",second:"2-digit"}))}</td><td data-label="채널·결과">${Common.escapeHtml(({SMS:"문자",KAKAO:"카카오"})[item.channel] || item.channel)}<br><strong>${labels[item.status] || Common.escapeHtml(item.status)}</strong></td><td data-label="반환 메시지">${Common.escapeHtml(item.message || item.errorCode || labels[item.status] || "결과 확인 필요")}<details><summary>결과 코드·식별번호</summary><dl><dt>작업 생성 시각</dt><dd>${Common.escapeHtml(item.createdAt || "-")}</dd><dt>발송 요청 시각</dt><dd>${Common.escapeHtml(item.attemptedAt || "-")}</dd><dt>결과 기록 시각</dt><dd>${Common.escapeHtml(item.updatedAt || "-")}</dd><dt>결과 코드</dt><dd>${Common.escapeHtml(item.statusCode || item.errorCode || "-")}</dd><dt>발송 작업 ID</dt><dd>${Common.escapeHtml(item.deliveryId)}</dd><dt>SOLAPI 메시지 ID</dt><dd>${Common.escapeHtml(item.providerMessageId || "-")}</dd><dt>그룹 ID</dt><dd>${Common.escapeHtml(item.groupId || "-")}</dd>${history ? `<dt>배포 작업 ID</dt><dd>${Common.escapeHtml(item.batchId || "-")}</dd>` : ""}</dl></details></td></tr>`).join("")}</tbody></table></div>`;
        },

        async openDeliveryResults() {
            const history = this.root.querySelector("[data-delivery-history]");
            const surveyId = this.current?.id;
            const revision = this.draft?.revision;
            const survey = this.root.querySelector("[data-history-survey]");
            if (surveyId && [...survey.options].some(option => option.value === surveyId)) survey.value = surveyId;
            this.root.querySelector("[data-history-status]").value = "";
            history.open = true;
            await this.loadDeliveryHistory(0);
            if (!this.root || this.current?.id !== surveyId || this.draft?.revision !== revision || !history.isConnected || !history.open) return;
            history.scrollIntoView({ block: "start", behavior: "auto" });
            const result = history.querySelector("[data-execution-result]");
            if (!result.hidden) result.focus({ preventScroll: true });
        },

        async loadDeliveryHistory(offset = 0) {
            const requestId = this.historyRequestId = (this.historyRequestId || 0) + 1;
            const host = this.root.querySelector("[data-history-content]");
            const params = new URLSearchParams({offset: String(offset)});
            const survey = this.root.querySelector("[data-history-survey]").value;
            const status = this.root.querySelector("[data-history-status]").value;
            if (survey) params.set("surveyId", survey);
            if (status) params.set("status", status);
            host.textContent = "저장된 발송 이력을 조회하고 있습니다…";
            try {
                const result = await this.context.api.get(`/api/deployments/history?${params}`);
                if (!this.root || this.historyRequestId !== requestId) return;
                host.innerHTML = this.deliveryLogTable(result.items || [], true) + `<nav aria-label="발송 이력 페이지"><button class="button button-small button-navigation button-navigation-back" type="button" data-history-page="${Math.max(0, offset - 50)}" ${offset === 0 ? "disabled" : ""}>이전</button><span>${offset + 1}–${offset + result.items.length}건</span><button class="button button-small button-navigation" type="button" data-history-page="${offset + 50}" ${result.hasMore ? "" : "disabled"}>다음</button></nav>`;
            } catch (error) { if (this.root && this.historyRequestId === requestId) host.textContent = error.message; }
        },

        async sendStagedDelivery(revision = this.draft.revision) {
            this.sendResult = await this.context.api.post(`/api/deployments/by-survey/${encodeURIComponent(this.current.id)}/send`, { revision, consentConfirmed: true });
        },

        async resumeDelivery() {
            if (!(await this.context.confirmMessage("아직 외부 요청하지 않은 대기 작업만 발송할까요? 이미 접수되었거나 확인이 필요한 작업은 재전송하지 않습니다.", { title: "대기 작업 발송", confirmLabel: "발송 요청", tone: "warning" }))) return;
            this.setActionDisabled(true);
            try { await this.sendStagedDelivery(this.lastExecutionRevision); this.renderExecutionResult(this.executionResult || {}); }
            catch (error) { this.context.toast(error.message, "error"); }
            finally { this.setActionDisabled(false); }
            await this.openDeliveryResults();
        },

        async refreshDeliveryStatus() {
            try {
                this.sendResult = await this.context.api.get(`/api/deployments/by-survey/${encodeURIComponent(this.current.id)}/delivery-status?revision=${this.draft.executionStatus ? this.draft.revision : this.lastExecutionRevision || this.draft.revision}`);
                this.renderExecutionResult(this.executionResult || {});
                if (this.root.querySelector("[data-delivery-history]").open) await this.loadDeliveryHistory(0);
            } catch (error) { this.context.toast(error.message, "error"); }
        },

        renderExecutionResult(result) {
            const host = this.root.querySelector("[data-execution-result]");
            if (!result) { host.hidden = true; return; }
            const status = upper(result.executionStatus || result.status || this.draft?.executionStatus || "");
            const rawResults = result.channelResults || result.channels || result.reasons || [];
            const entries = Array.isArray(rawResults)
                ? rawResults.map((item) => [upper(item.code || item.channel), item])
                : Object.entries(rawResults || {}).map(([code, value]) => [upper(code), typeof value === "string" ? { reason: value } : value]);
            const details = entries.map(([code, value]) => {
                const channel = CHANNELS.find((item) => item.code === code);
                return `<li><strong>${channel?.label || code}</strong><span>${Common.escapeHtml(value?.reason || value?.message || value?.status || "처리 결과를 확인하세요.")}</span></li>`;
            }).join("");
            host.hidden = false;
            host.className = `distribution-execution-result${status === "DISABLED" ? " is-disabled" : " is-complete"}`;
            host.innerHTML = `<strong>${status === "DISABLED" ? "발송 대기열 등록이 일부 또는 전체 보류되었습니다." : "발송 작업을 대기열에 등록했습니다."}</strong><span>실행 상태 <code>${Common.escapeHtml(status || "UNKNOWN")}</code></span>${details ? `<ul>${details}</ul>` : ""}`;
            if (this.sendResult) {
                const data = this.sendResult;
                host.classList.toggle("has-failures", Boolean(data.failed || data.unknown));
                const codes = [...new Set((data.items || []).map((item) => item.errorCode).filter(Boolean))];
                host.innerHTML = `<strong>발송 요청 결과 · ${Common.escapeHtml(this.current?.title || "")}</strong><span>접수 ${Common.formatNumber(data.accepted || 0)}건 · 접수 실패 ${Common.formatNumber(data.failed || 0)}건 · 확인 필요 ${Common.formatNumber(data.unknown || 0)}건 · 미요청 ${Common.formatNumber(data.queued || 0)}건 · 보류 ${Common.formatNumber(data.disabled || 0)}건</span>${codes.length ? `<p>확인할 결과 코드: ${codes.map((code) => Common.escapeHtml(code)).join(", ")}</p>` : ""}${data.unknown ? "<p>확인 필요 작업은 중복 방지를 위해 자동 재전송하지 않습니다.</p>" : ""}<div><button type="button" class="button button-small button-function" data-refresh-delivery>요청 결과 다시 확인</button>${data.queued ? '<button type="button" class="button button-small button-batch" data-resume-delivery>미요청 작업만 발송</button>' : ""}<a href="https://console.solapi.com/" target="_blank" rel="noopener noreferrer" class="button button-small button-function">SOLAPI 콘솔</a></div>`;
            }
            if (this.sendResult) {
                const failures = [...new Set((this.sendResult.items || []).filter(item => ["FAILED", "UNKNOWN"].includes(item.status)).map(item => item.message || item.errorCode).filter(Boolean))];
                if (failures.length) host.insertAdjacentHTML("beforeend", `<ul class="delivery-result-errors">${failures.map(message => `<li>${Common.escapeHtml(message)}</li>`).join("")}</ul>`);
                host.insertAdjacentHTML("beforeend", `<details class="delivery-current-request"><summary>이번 요청 상세</summary>${this.deliveryLogTable(this.sendResult.items || [])}</details>`);
            }
            this.syncExecutionLock();
        },

        async refreshSenderDefaults() {
            const providers = await this.context.api.get("/api/deployments/providers");
            if (!this.root || this.context.isCurrentRoute?.() === false) throw new Error("현재 작업 화면에서 다시 시도해 주세요.");
            this.deliveryDefaults = { senderNumber: providers?.defaultSender || "", kakaoPfId: providers?.kakaoPfId || "" };
            this.providers = this.normalizeProviders(providers);
            return this.deliveryDefaults;
        },

        async applyDefaultSender() {
            if (!this.draft || this.draft.executionStatus || this.saving || this.sending || this.actionBusy) return;
            this.setActionDisabled(true);
            try {
                const defaults = await this.refreshSenderDefaults();
                if (!defaults.senderNumber) throw new Error("서버의 기본 발신번호가 설정되지 않았습니다. 환경변수 변경 후 서버를 재시작하세요.");
                this.draft.deliveryOptions.senderNumber = defaults.senderNumber;
                this.root.querySelector('[data-delivery-option="senderNumber"]').value = defaults.senderNumber;
                this.markDirty();
                this.context.toast("서버 기본 발신번호를 적용했습니다. 저장·미리보기 후 발송하세요.", "success");
            } catch (error) { this.context.toast(error.message, "error"); }
            finally { this.setActionDisabled(false); }
        },

        enableDirectEditing() {
            if (!this.draft?.executionStatus) return;
            this.lastExecutionRevision = this.draft.revision;
            this.draft.revision = null;
            this.draft.executionStatus = null;
            this.draft.status = "DRAFT";
            this.awaitingDeliveryEdit = true;
            this.previewSignature = null;
            this.previewRequestId = (this.previewRequestId || 0) + 1;
            this.previewItems = [];
            const consent = this.root.querySelector("[data-delivery-consent]");
            if (consent) consent.checked = false;
            this.syncExecutionLock();
            this.updateSaveState();
        },

        syncExecutionLock() {
            const locked = Boolean(this.draft?.executionStatus);
            this.root.querySelectorAll("[data-distribution-step] input, [data-distribution-step] select, [data-distribution-step] textarea, [data-distribution-step] button, [data-distribution-save], [data-distribution-execute]").forEach((control) => {
                if (control.matches("[data-preview-delivery], [data-preview-recipient], [data-preview-recipient-page], [data-preview-channel], [data-preview-search], [data-copy-language-url], [data-project-url-management]")) return;
                if (locked) { control.dataset.executionDisabled = "true"; control.disabled = true; }
                else if (control.dataset.executionDisabled) { delete control.dataset.executionDisabled; control.disabled = false; }
            });
            this.root.querySelector("[data-distribution-workflow]")?.classList.toggle("is-execution-locked", locked);
            if (!locked) {
                this.root.querySelectorAll("[data-recipient-row], [data-recipient-detail-id]").forEach((row) => this.syncRecipientChannelAvailability(row));
                this.syncScheduleField();
            }
            this.syncPreviewAction();
        },

        setActionDisabled(disabled) {
            if (!this.root) return;
            this.actionBusy = disabled;
            this.root.querySelectorAll("[data-distribution-step] input, [data-distribution-step] select, [data-distribution-step] textarea, [data-distribution-step] button, [data-distribution-save], [data-distribution-execute], [data-distribution-step-target]").forEach((control) => {
                if (disabled) { control.dataset.beforeBusy = String(control.disabled); control.disabled = true; }
                else if (control.dataset.beforeBusy !== undefined) { control.disabled = control.dataset.beforeBusy === "true"; delete control.dataset.beforeBusy; }
            });
            this.root.querySelector("[data-distribution-project-back]").disabled = disabled;
            this.syncExecutionLock();
            this.syncPreviewAction();
        },

        markDirty() {
            this.awaitingDeliveryEdit = false;
            this.previewSignature = null;
            this.previewRequestId = (this.previewRequestId || 0) + 1;
            this.previewItems = [];
            this.sendResult = null;
            const preview = this.root?.querySelector("[data-delivery-preview]");
            if (preview) { this.renderPreviewPlaceholder("변경한 내용으로 미리보기를 확인하고 있습니다…"); preview.setAttribute("aria-busy", "false"); }
            const consent = this.root?.querySelector("[data-delivery-consent]");
            if (consent) consent.checked = false;
            this.dirty = true;
            this.executionResult = null;
            this.renderExecutionResult(null);
            if (this.step === 2) { this.renderRecipientScope(); this.renderReview(); this.renderPreviewRecipients(); }
            this.syncPreviewAction();
            this.queuePreview();
            this.updateSaveState();
        },

        updateSaveState(text = null) {
            const host = this.root.querySelector("[data-distribution-save-state]");
            host.textContent = text || (this.awaitingDeliveryEdit ? "직접 수정 가능" : this.dirty ? "저장하지 않은 변경사항" : this.draft?.revision ? `초안 r${this.draft.revision} 저장됨` : "저장 전");
            host.classList.toggle("is-dirty", this.dirty);
            this.renderProjectContext();
        },

        async backToProjects() {
            if (this.dirty && !(await this.context.confirmMessage(
                "저장하지 않은 배포 변경사항이 있습니다. 프로젝트 목록으로 돌아갈까요?",
                { title: "저장하지 않은 변경사항", confirmLabel: "변경 버리고 이동", tone: "warning", destructive: true }
            ))) return;
            this.dirty = false;
            clearTimeout(this.previewTimer);
            this.previewRequestId = (this.previewRequestId || 0) + 1;
            this.current = null;
            this.publishedSurvey = null;
            this.draft = null;
            this.executionResult = null;
            this.sendResult = null;
            this.renderExecutionResult(null);
            this.step = 1;
            this.maxStep = 1;
            this.root.querySelector("[data-distribution-workflow]").hidden = true;
            this.root.querySelector("[data-distribution-project-view]").hidden = false;
            this.renderProjects();
            const base = location.href.split("#", 1)[0];
            history.replaceState(null, "", `${base}#/M03001`);
            this.root.querySelector("[data-distribution-search]")?.focus({ preventScroll: true });
        },

        hasUnsavedChanges() { return Boolean(this.dirty || this.sending); },
        beforeLeave() { if (this.sending) { this.context.toast("발송 요청 결과를 확인한 뒤 이동해 주세요.", "warning"); return false; } return !this.dirty || this.context.confirmMessage("저장하지 않은 배포 변경사항이 있습니다. 변경사항을 버리고 이동할까요?", { title: "미저장 변경사항", confirmLabel: "변경사항 버리기" }); },
        async beforeRefresh() {
            if (this.sending) { this.context.toast("발송 요청 결과를 확인한 뒤 새로고침해 주세요.", "warning"); return false; }
            return !this.dirty || this.context.confirmMessage(
                "저장하지 않은 배포 변경사항이 있습니다. 변경사항을 버리고 현재 화면을 새로고침할까요?",
                { title: "현재 화면 새로고침", confirmLabel: "변경 버리고 새로고침", tone: "warning", destructive: true }
            );
        },

        destroy() {
            clearTimeout(this.previewTimer);
            this.previewRequestId = (this.previewRequestId || 0) + 1;
            this.searchDebounced?.cancel?.();
            this.root?.removeEventListener("click", this.onClick);
            this.root?.removeEventListener("input", this.onInput);
            this.root?.removeEventListener("change", this.onChange);
            this.root?.removeEventListener("focusin", this.onRecipientFocus);
            this.root?.removeEventListener("paste", this.onRecipientPaste);
            this.root?.removeEventListener("keydown", this.onRecipientKeyDown);
            this.recipientUndo = null;
            this.stagedRecipients = null;
            this.root = null;
        }
    };
})();
