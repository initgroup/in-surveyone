(function () {
    "use strict";

    const PAGE_NAME = "M03001";
    const CHANNELS = [
        { code: "EMAIL", provider: "email", field: "email", label: "이메일", icon: "@", placeholder: "name@example.com" },
        { code: "SMS", provider: "sms", field: "mobile", label: "문자", icon: "M", placeholder: "010-0000-0000" },
        { code: "KAKAO", provider: "kakao", field: "kakaoId", label: "카카오", icon: "K", placeholder: "휴대전화 또는 식별자" },
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
        { code: "OTHER", label: "기타", locale: "en" }
    ];
    const STEP_TITLES = {
        1: "배포 대상자를 준비하세요.",
        2: "복수 채널과 발송 방식을 정하세요.",
        3: "언어별 설문 URL과 안내문을 확인하세요.",
        4: "최종 발송 계획을 검토하세요."
    };

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
            this.current = null;
            this.draft = null;
            this.providers = this.normalizeProviders({});
            this.publicBaseUrl = location.origin;
            this.step = 1;
            this.maxStep = 1;
            this.view = localStorage.getItem("surveyone-distribution-view") || "grid";
            this.dirty = false;
            this.saving = false;
            this.executionResult = null;
            this.recipientPage = 1;
            this.recipientPageSize = 25;
            this.importingRecipients = false;
            this.bind();
            await this.load();
        },

        bind() {
            this.onClick = async (event) => {
                const layout = event.target.closest("[data-distribution-layout]");
                if (layout) return this.changeLayout(layout.dataset.distributionLayout);
                const open = event.target.closest("[data-open-distribution-project]");
                if (open) return this.openProject(open.dataset.openDistributionProject);
                if (event.target.closest("[data-distribution-project-back]")) return this.backToProjects();
                if (event.target.closest("[data-add-recipient]")) return this.addRecipient();
                if (event.target.closest("[data-import-recipient]")) return this.root.querySelector("[data-recipient-file]").click();
                if (event.target.closest("[data-download-recipient-sample]")) return this.downloadRecipientSample();
                if (event.target.closest("[data-download-recipient-xlsx]")) return this.downloadRecipientExcelSample();
                const recipientPage = event.target.closest("[data-recipient-page]");
                if (recipientPage && !recipientPage.disabled) return this.changeRecipientPage(Number(recipientPage.dataset.recipientPage));
                const remove = event.target.closest("[data-remove-recipient]");
                if (remove) return this.removeRecipient(remove.dataset.removeRecipient);
                const target = event.target.closest("[data-distribution-step-target]");
                if (target && !target.disabled) return this.goStep(Number(target.dataset.distributionStepTarget));
                if (event.target.closest("[data-distribution-previous]")) return this.goStep(Math.max(1, this.step - 1));
                if (event.target.closest("[data-distribution-next]")) return this.nextStep();
                if (event.target.closest("[data-distribution-save]")) return this.saveDraft();
                if (event.target.closest("[data-distribution-execute]")) return this.execute();
                if (event.target.closest("[data-new-distribution-batch]")) return this.startNewBatch();
                if (event.target.closest("[data-edit-survey-languages]")) return this.context.navigate("M02003", { surveyId: this.current.id });
                const copy = event.target.closest("[data-copy-language-url]");
                if (copy) return this.copyLanguageUrl(copy.dataset.copyLanguageUrl);
            };
            this.onInput = (event) => {
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
                    this.context.api.get("/api/runtime-config").catch(() => ({})),
                    this.context.api.get("/api/deployments/providers").catch((error) => ({ loadError: error.message }))
                ]);
                this.publicBaseUrl = runtime?.publicBaseUrl || location.origin;
                this.providers = this.normalizeProviders(providers);
                this.items = arrayPayload(surveys).filter((item) => this.isFinalized(item));
                this.populateCategoryFilter();
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
                grid.innerHTML = `<section class="empty-state distribution-project-empty"><span class="empty-icon">${errorMessage ? "!" : "↗"}</span><h2>${errorMessage ? "확정 프로젝트를 불러오지 못했습니다" : "배포할 수 있는 확정 프로젝트가 없습니다"}</h2><p>${Common.escapeHtml(errorMessage || "설문 편집기에서 문항을 저장하고 확정한 뒤 다시 확인해 주세요.")}</p><button class="button button-primary" type="button" data-go-projects>설문 프로젝트로 이동</button></section>`;
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
            return `<article class="distribution-project-card"><header><span class="status-badge status-published">확정 v${version}</span><span class="distribution-project-state">${deploymentLabel}</span></header><button type="button" class="distribution-project-main" data-open-distribution-project="${Common.escapeHtml(item.id)}"><span class="project-category">${Common.escapeHtml(item.category || "설문")}</span><h3>${Common.escapeHtml(item.title || "제목 없는 설문")}</h3><span class="project-id">프로젝트 ID <code>${Common.escapeHtml(item.id)}</code></span><p>${Common.escapeHtml(item.description || "대상자와 채널을 설정해 배포를 시작하세요.")}</p></button><dl><div><dt>확정 버전</dt><dd>v${version}</dd></div><div><dt>문항</dt><dd>${Common.formatNumber(item.questionCount || 0)}</dd></div><div><dt>응답</dt><dd>${Common.formatNumber(responses)}</dd></div></dl><footer><span>${Common.formatDate(item.publishedAt || item.updatedAt)} 확정</span><button class="button button-small button-primary" type="button" data-open-distribution-project="${Common.escapeHtml(item.id)}">배포 작업</button></footer></article>`;
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
                this.draft = this.normalizeDraft(deploymentPayload?.deployment || deploymentPayload);
                this.recipientPage = 1;
                this.step = 1;
                this.maxStep = this.draft.revision || this.draft.recipients.some((item) => item.name || item.channels.length) ? 4 : 1;
                this.dirty = false;
                this.executionResult = deploymentPayload?.execution || (this.draft.executionStatus ? deploymentPayload : null);
                this.root.querySelector("[data-distribution-project-view]").hidden = true;
                this.root.querySelector("[data-distribution-workflow]").hidden = false;
                this.root.querySelector("[data-distribution-survey-title]").textContent = this.current.title;
                this.root.querySelector("[data-distribution-project-id]").textContent = this.current.id;
                this.root.querySelector("[data-distribution-version]").textContent = `v${this.current.publishedVersion || this.current.version || 1}`;
                this.renderProviderAlert();
                this.renderRecipients();
                this.renderChannels();
                this.renderMessages();
                this.renderExecutionResult(this.executionResult);
                this.updateWorkflow();
                this.root.querySelector("[data-distribution-title]").focus({ preventScroll: true });
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
            const requestedPriority = Array.isArray(schedule.priority) ? schedule.priority.map(upper).filter((code) => CHANNELS.some((channel) => channel.code === code)) : [];
            const priority = [...new Set([...requestedPriority, ...CHANNELS.map((item) => item.code)])];
            return {
                revision: candidate.revision ?? null,
                recipients: recipients.length ? recipients : [this.blankRecipient()],
                channels: [...new Set(channels)],
                messagesByLanguage: candidate.messagesByLanguage && typeof candidate.messagesByLanguage === "object" ? structuredClone(candidate.messagesByLanguage) : {},
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
            return { id: uid(), name: "", countryCode: "KR", preferredLanguage: this.defaultLocale(), email: "", mobile: "", fax: "", kakaoId: "", channels: [] };
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
                channels: [...new Set(channels)]
            };
        },

        localeCode(value) {
            const raw = String(value || "ko").trim().replaceAll("_", "-");
            try { return Intl.getCanonicalLocales(raw)[0] || "ko"; }
            catch { return "ko"; }
        },

        enabledLocales() {
            const languages = this.current?.languages || {};
            const raw = languages.enabled || this.current?.supportedLocales || [languages.defaultLocale || this.current?.defaultLocale || "ko"];
            const locales = [...new Set((Array.isArray(raw) ? raw : [raw]).map((value) => this.localeCode(typeof value === "string" ? value : value?.code)))];
            const defaultLocale = this.defaultLocale();
            if (!locales.includes(defaultLocale)) locales.unshift(defaultLocale);
            return locales;
        },

        defaultLocale() {
            return this.localeCode(this.current?.languages?.defaultLocale || this.current?.defaultLocale || "ko");
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
            return locale ? `${locale.label} · ${locale.nativeLabel}` : canonical;
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
            const disabled = CHANNELS.filter((channel) => !this.providerReady(channel.code));
            const alert = this.root.querySelector("[data-provider-alert]");
            alert.className = `distribution-provider-alert${disabled.length ? " is-warning" : " is-ready"}`;
            alert.innerHTML = disabled.length
                ? `<strong>외부 발송 준비 확인</strong><span>${disabled.map((item) => item.label).join("·")} provider가 비활성 상태입니다. 대상자와 문안은 저장할 수 있지만 해당 채널의 실행 결과는 <b>DISABLED</b>로 보류됩니다.</span>`
                : `<strong>외부 발송 provider 준비 완료</strong><span>선택한 채널의 수신 동의와 최종 대상 수를 STEP 04에서 다시 확인하세요.</span>`;
        },

        renderRecipients() {
            const host = this.root.querySelector("[data-recipient-list]");
            const total = this.draft.recipients.length;
            const pageCount = Math.max(1, Math.ceil(total / this.recipientPageSize));
            this.recipientPage = Math.min(Math.max(1, this.recipientPage), pageCount);
            const offset = (this.recipientPage - 1) * this.recipientPageSize;
            host.innerHTML = this.draft.recipients.slice(offset, offset + this.recipientPageSize).map((recipient, index) => this.recipientMarkup(recipient, offset + index)).join("");
            host.querySelectorAll("[data-recipient-row]").forEach((row) => this.syncRecipientChannelAvailability(row));
            this.renderRecipientPagination(total, pageCount);
        },

        renderRecipientPagination(total, pageCount) {
            const host = this.root.querySelector("[data-recipient-pagination]");
            host.hidden = pageCount <= 1;
            if (pageCount <= 1) { host.innerHTML = ""; return; }
            const start = Math.max(1, Math.min(this.recipientPage - 2, pageCount - 4));
            const end = Math.min(pageCount, start + 4);
            const pages = [];
            for (let page = start; page <= end; page += 1) {
                pages.push(`<button class="button button-small" type="button" data-recipient-page="${page}" ${page === this.recipientPage ? 'aria-current="page"' : ""}>${page}</button>`);
            }
            const first = (this.recipientPage - 1) * this.recipientPageSize + 1;
            const last = Math.min(this.recipientPage * this.recipientPageSize, total);
            host.innerHTML = `<span>전체 ${Common.formatNumber(total)}명 · ${Common.formatNumber(first)}–${Common.formatNumber(last)}명 표시</span><div><button class="button button-small" type="button" data-recipient-page="${this.recipientPage - 1}" ${this.recipientPage === 1 ? "disabled" : ""}>이전</button>${pages.join("")}<button class="button button-small" type="button" data-recipient-page="${this.recipientPage + 1}" ${this.recipientPage === pageCount ? "disabled" : ""}>다음</button></div>`;
        },

        changeRecipientPage(page) {
            this.recipientPage = page;
            this.renderRecipients();
            this.root.querySelector("[data-recipient-list]")?.scrollIntoView({ block: "start", behavior: "smooth" });
        },

        recipientMarkup(recipient, index) {
            const countries = COUNTRIES.map((country) => `<option value="${country.code}" ${country.code === recipient.countryCode ? "selected" : ""}>${country.label}</option>`).join("");
            const enabled = new Set(this.enabledLocales());
            const languages = this.localeCatalog().map((locale) => `<option value="${locale.code}" ${locale.code === recipient.preferredLanguage ? "selected" : ""} ${enabled.has(locale.code) ? "" : "disabled"}>${Common.escapeHtml(locale.nativeLabel || locale.label)}${enabled.has(locale.code) ? "" : " · 번역 미확정"}</option>`).join("");
            const contacts = CHANNELS.map((channel) => `<label class="recipient-contact"><span>${channel.label}</span><input type="${channel.code === "EMAIL" ? "email" : "text"}" value="${Common.escapeHtml(recipient[channel.field])}" placeholder="${channel.placeholder}" data-recipient-field="${channel.field}"></label>`).join("");
            const channelChecks = CHANNELS.map((channel) => `<label class="recipient-channel ${this.providerReady(channel.code) ? "" : "is-provider-disabled"}"><input type="checkbox" value="${channel.code}" data-recipient-channel="${channel.code}" ${recipient.channels.includes(channel.code) ? "checked" : ""}><span>${channel.label}<small data-recipient-channel-status="${channel.code}"></small></span></label>`).join("");
            return `<article class="distribution-recipient" data-recipient-row="${Common.escapeHtml(recipient.id)}"><div class="recipient-identity"><span class="recipient-number">${String(index + 1).padStart(2, "0")}</span><label><span>대상자명 또는 코드</span><input required value="${Common.escapeHtml(recipient.name)}" placeholder="예: 응답자 A001" data-recipient-field="name"></label><label><span>국가</span><select data-recipient-field="countryCode">${countries}</select></label></div><label class="recipient-language"><span>선호 언어</span><select data-recipient-field="preferredLanguage">${languages}</select></label><div class="recipient-contacts">${contacts}</div><fieldset class="recipient-channels"><legend>전송 가능한 채널</legend>${channelChecks}</fieldset><button class="icon-button recipient-remove" type="button" data-remove-recipient="${Common.escapeHtml(recipient.id)}" aria-label="${Common.escapeHtml(recipient.name || `${index + 1}번 대상자`)} 삭제">×</button></article>`;
        },

        recipientByElement(element) {
            const id = element.closest("[data-recipient-row]")?.dataset.recipientRow;
            return this.draft.recipients.find((item) => String(item.id) === String(id));
        },

        updateRecipientField(element, changed = false) {
            const recipient = this.recipientByElement(element);
            if (!recipient) return;
            const field = element.dataset.recipientField;
            const previousCountry = recipient.countryCode;
            recipient[field] = element.value;
            if (field === "preferredLanguage") recipient[field] = this.localeCode(element.value);
            if (field === "countryCode" && changed) {
                const previousSuggested = COUNTRIES.find((item) => item.code === previousCountry)?.locale;
                const suggested = COUNTRIES.find((item) => item.code === element.value)?.locale || this.defaultLocale();
                if (!recipient.preferredLanguage || recipient.preferredLanguage === previousSuggested) {
                    recipient.preferredLanguage = this.enabledLocales().includes(suggested) ? suggested : this.defaultLocale();
                    const select = element.closest("[data-recipient-row]").querySelector('[data-recipient-field="preferredLanguage"]');
                    if (select) select.value = recipient.preferredLanguage;
                }
            }
            if (CHANNELS.some((channel) => channel.field === field)) this.syncRecipientChannelAvailability(element.closest("[data-recipient-row]"));
            this.markDirty();
        },

        syncRecipientChannelAvailability(row) {
            const recipient = this.recipientByElement(row);
            if (!recipient) return;
            CHANNELS.forEach((channel) => {
                const checkbox = row.querySelector(`[data-recipient-channel="${channel.code}"]`);
                const status = row.querySelector(`[data-recipient-channel-status="${channel.code}"]`);
                const hasContact = Boolean(String(recipient[channel.field] || "").trim());
                checkbox.disabled = !hasContact;
                if (!hasContact) {
                    checkbox.checked = false;
                    recipient.channels = recipient.channels.filter((item) => item !== channel.code);
                }
                status.textContent = !hasContact ? "연락정보 필요" : this.providerReady(channel.code) ? "전송 가능" : "저장 가능·provider 꺼짐";
            });
        },

        updateRecipientChannel(element) {
            const recipient = this.recipientByElement(element);
            if (!recipient) return;
            const code = upper(element.dataset.recipientChannel);
            recipient.channels = element.checked ? [...new Set([...recipient.channels, code])] : recipient.channels.filter((item) => item !== code);
            this.markDirty();
        },

        addRecipient() {
            const recipient = this.blankRecipient();
            this.draft.recipients.push(recipient);
            this.recipientPage = Math.ceil(this.draft.recipients.length / this.recipientPageSize);
            this.renderRecipients();
            this.markDirty();
            this.root.querySelector(`[data-recipient-row="${CSS.escape(recipient.id)}"] [data-recipient-field="name"]`)?.focus();
        },

        removeRecipient(id) {
            if (this.draft.recipients.length === 1) return this.context.toast("대상자는 한 명 이상 필요합니다.", "error");
            this.draft.recipients = this.draft.recipients.filter((item) => String(item.id) !== String(id));
            this.renderRecipients();
            this.markDirty();
        },

        downloadRecipientSample() {
            Common.downloadCsv("in-surveyone-recipients.csv", [
                ["name", "countryCode", "preferredLanguage", "email", "mobile", "fax", "kakaoId", "channels"],
                ["응답자 A001", "KR", "ko", "sample@example.com", "010-0000-0000", "", "", "EMAIL|SMS"]
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
                const imported = (result.recipients || []).map((item) => this.normalizeRecipient(item));
                const currentCount = this.draft.recipients.filter((item) => this.recipientHasInput(item)).length;
                if (currentCount + imported.length > 2000) throw new Error("배포 초안에는 대상자를 최대 2,000명까지 등록할 수 있습니다.");
                if (this.draft.recipients.length === 1 && !this.draft.recipients[0].name && !this.draft.recipients[0].channels.length) this.draft.recipients = [];
                this.draft.recipients.push(...imported);
                this.recipientPage = Math.max(1, Math.ceil((this.draft.recipients.length - imported.length + 1) / this.recipientPageSize));
                this.renderRecipients();
                this.markDirty();
                const encoding = result.encoding ? ` · ${result.encoding}` : "";
                this.context.toast(`${Common.formatNumber(imported.length)}명의 대상자를 가져왔습니다.${encoding}`, "success");
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

        parseCsv(text) {
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
                else if (character === ",") { row.push(cell); cell = ""; }
                else if (character === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
                else cell += character;
            }
            if (quoted) throw new Error("CSV 따옴표 형식이 올바르지 않습니다.");
            if (cell || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
            return rows;
        },

        renderChannels() {
            const host = this.root.querySelector("[data-channel-options]");
            host.innerHTML = CHANNELS.map((channel) => {
                const provider = this.providers[channel.code];
                const selected = this.draft.channels.includes(channel.code);
                const targetCount = this.draft.recipients.filter((recipient) => recipient.channels.includes(channel.code) && String(recipient[channel.field] || "").trim()).length;
                const priority = Math.max(0, this.draft.schedule.priority.indexOf(channel.code));
                const priorityOptions = CHANNELS.map((_, index) => `<option value="${index + 1}" ${priority === index ? "selected" : ""}>${index + 1}순위</option>`).join("");
                return `<article class="distribution-channel-card ${provider.configured ? "is-ready" : "is-disabled"}"><label><input type="checkbox" value="${channel.code}" data-distribution-channel="${channel.code}" ${selected ? "checked" : ""}><span class="distribution-channel-icon channel-${channel.code.toLowerCase()}">${channel.icon}</span><span><strong>${channel.label}</strong><small>${Common.formatNumber(targetCount)}명에게 전송 가능</small><em>${provider.configured ? `${provider.providerCode} · 준비됨` : `disabled · ${provider.reason}`}</em></span></label><label class="distribution-channel-priority"><span class="sr-only">${channel.label} 우선순위</span><select data-channel-priority="${channel.code}" aria-label="${channel.label} 발송 우선순위">${priorityOptions}</select></label></article>`;
            }).join("");
            const strategy = this.root.querySelector(`[name="deliveryStrategy"][value="${this.draft.schedule.strategy}"]`);
            if (strategy) strategy.checked = true;
            const mode = this.root.querySelector(`[name="scheduleMode"][value="${this.draft.schedule.mode}"]`);
            if (mode) mode.checked = true;
            const scheduled = this.root.querySelector("[data-scheduled-at]");
            scheduled.value = this.localDateTimeValue(this.draft.schedule.scheduledAt);
            this.syncScheduleField();
        },

        updateSelectedChannel(element) {
            const code = upper(element.dataset.distributionChannel);
            this.draft.channels = element.checked ? [...new Set([...this.draft.channels, code])] : this.draft.channels.filter((item) => item !== code);
            this.ensureMessages();
            this.markDirty();
        },

        updateChannelPriority(element) {
            const code = upper(element.dataset.channelPriority);
            const requestedIndex = Math.max(0, Math.min(CHANNELS.length - 1, Number(element.value) - 1));
            const priority = this.draft.schedule.priority.filter((item) => item !== code);
            priority.splice(requestedIndex, 0, code);
            this.draft.schedule.priority = priority;
            this.renderChannels();
            this.markDirty();
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
            const locales = [...new Set(this.draft.recipients.map((item) => this.localeCode(item.preferredLanguage)).filter(Boolean))];
            return locales.length ? locales : [this.defaultLocale()];
        },

        localizedSurveyTitle(locale) {
            if (locale === this.current?.languages?.sourceLocale || locale === this.current?.defaultLocale) return this.current.title;
            return this.current?.translations?.[locale]?.title || this.current.title;
        },

        invitationDefaults(locale) {
            const title = this.localizedSurveyTitle(locale);
            const url = this.languageUrl(locale);
            const templates = {
                ko: { subject: `[설문 참여 요청] ${title}`, greeting: `안녕하세요. ${title} 설문에 참여해 주세요.`, short: `[IN-SURVEYONE] ${title} 참여 안내` },
                en: { subject: `[Survey invitation] ${title}`, greeting: `Hello. Please participate in the ${title} survey.`, short: `[IN-SURVEYONE] Invitation: ${title}` },
                ja: { subject: `【アンケートのお願い】${title}`, greeting: `${title}アンケートへのご協力をお願いいたします。`, short: `【IN-SURVEYONE】${title} ご案内` },
                zh: { subject: `【问卷邀请】${title}`, greeting: `您好，请参与“${title}”问卷调查。`, short: `【IN-SURVEYONE】${title} 问卷邀请` },
                vi: { subject: `[Mời tham gia khảo sát] ${title}`, greeting: `Xin chào. Vui lòng tham gia khảo sát ${title}.`, short: `[IN-SURVEYONE] Mời khảo sát: ${title}` },
                fil: { subject: `[Paanyaya sa survey] ${title}`, greeting: `Kumusta. Inaanyayahan kang sagutan ang survey na ${title}.`, short: `[IN-SURVEYONE] Survey: ${title}` }
            };
            const base = templates[locale.split("-")[0]] || templates.en;
            return { emailSubject: base.subject, emailBody: `${base.greeting}\n\n${url}`, smsBody: `${base.short} ${url}`, kakaoBody: `${base.short}\n${url}`, faxTitle: base.subject, faxBody: `${base.greeting}\n\n${url}` };
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
            summary.innerHTML = locales.map((locale) => `<span>${Common.escapeHtml(this.localeLabel(locale))}<b>${Common.formatNumber(this.draft.recipients.filter((item) => this.localeCode(item.preferredLanguage) === locale).length)}명</b></span>`).join("");
            this.root.querySelector("[data-message-list]").innerHTML = locales.map((locale, index) => this.messageMarkup(locale, index === 0)).join("");
        },

        messageMarkup(locale, open) {
            const messages = this.draft.messagesByLanguage[locale];
            const selected = new Set(this.draft.channels);
            const fields = [];
            if (selected.has("EMAIL")) fields.push(`<label class="form-field">이메일 제목<input data-message-locale="${locale}" data-message-field="emailSubject" value="${Common.escapeHtml(messages.emailSubject)}"></label><label class="form-field">이메일 본문<textarea rows="5" data-message-locale="${locale}" data-message-field="emailBody">${Common.escapeHtml(messages.emailBody)}</textarea></label>`);
            if (selected.has("SMS")) fields.push(`<label class="form-field">문자 안내문<textarea rows="3" maxlength="1000" data-message-locale="${locale}" data-message-field="smsBody">${Common.escapeHtml(messages.smsBody)}</textarea></label>`);
            if (selected.has("KAKAO")) fields.push(`<label class="form-field">카카오 안내문<textarea rows="3" maxlength="1000" data-message-locale="${locale}" data-message-field="kakaoBody">${Common.escapeHtml(messages.kakaoBody)}</textarea></label>`);
            if (selected.has("FAX")) fields.push(`<label class="form-field">팩스 표지 제목<input data-message-locale="${locale}" data-message-field="faxTitle" value="${Common.escapeHtml(messages.faxTitle)}"></label><label class="form-field">팩스 안내문<textarea rows="4" data-message-locale="${locale}" data-message-field="faxBody">${Common.escapeHtml(messages.faxBody)}</textarea></label>`);
            return `<details class="distribution-message-card" ${open ? "open" : ""}><summary><span><strong>${Common.escapeHtml(this.localeLabel(locale))}</strong><small>${Common.formatNumber(this.draft.recipients.filter((item) => this.localeCode(item.preferredLanguage) === locale).length)}명 대상</small></span><b>${this.enabledLocales().includes(locale) ? "확정 번역 사용" : "기본 언어 대체"}</b></summary><div class="distribution-language-url"><label>설문 URL<input readonly value="${Common.escapeHtml(this.languageUrl(locale))}"></label><button class="button button-small" type="button" data-copy-language-url="${locale}">URL 복사</button></div><div class="distribution-message-fields">${fields.join("") || '<p class="muted">STEP 02에서 발송 채널을 선택하면 안내문 입력란이 표시됩니다.</p>'}</div></details>`;
        },

        updateMessageField(element) {
            const locale = this.localeCode(element.dataset.messageLocale);
            this.draft.messagesByLanguage[locale] ||= this.invitationDefaults(locale);
            this.draft.messagesByLanguage[locale][element.dataset.messageField] = element.value;
            this.markDirty();
        },

        publicUrl() {
            const slug = this.current?.publicSlug || this.current?.slug;
            const value = this.current?.publicUrl || (slug ? `/s/${encodeURIComponent(slug)}` : "");
            if (!value) return "";
            try { return new URL(String(value), this.publicBaseUrl || location.origin).href; }
            catch { return ""; }
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
                if (!this.draft.recipients.length) return error("[data-recipient-error]", "대상자를 한 명 이상 추가해 주세요.");
                const invalid = this.draft.recipients.find((recipient) => !recipient.name.trim() || !recipient.countryCode || !recipient.preferredLanguage || !recipient.channels.length || recipient.channels.some((code) => !String(recipient[CHANNELS.find((item) => item.code === code)?.field] || "").trim()));
                if (invalid) return error("[data-recipient-error]", "모든 대상자의 이름·국가·선호 언어와 한 개 이상의 유효한 전송 채널을 확인해 주세요.");
                const unsupported = this.draft.recipients.find((recipient) => !this.enabledLocales().includes(this.localeCode(recipient.preferredLanguage)));
                if (unsupported) return error("[data-recipient-error]", `${unsupported.name} 대상자의 선호 언어는 현재 확정 버전에 포함되지 않았습니다.`);
            }
            if (step === 2) {
                this.root.querySelector("[data-channel-error]").hidden = true;
                if (!this.draft.channels.length) return error("[data-channel-error]", "사용할 발송 채널을 한 개 이상 선택해 주세요.");
                const usable = this.draft.channels.some((code) => this.draft.recipients.some((recipient) => recipient.channels.includes(code)));
                if (!usable) return error("[data-channel-error]", "선택한 채널로 전송 가능한 대상자가 없습니다.");
                if (this.draft.schedule.mode === "SCHEDULED") {
                    if (!this.draft.schedule.scheduledAt) return error("[data-channel-error]", "예약 발송 시각을 입력해 주세요.");
                    if (new Date(this.draft.schedule.scheduledAt) <= new Date()) return error("[data-channel-error]", "예약 발송 시각은 현재보다 이후여야 합니다.");
                }
            }
            if (step === 3) {
                this.root.querySelector("[data-message-error]").hidden = true;
                this.ensureMessages();
                const requirements = { EMAIL: ["emailSubject", "emailBody"], SMS: ["smsBody"], KAKAO: ["kakaoBody"], FAX: ["faxTitle", "faxBody"] };
                const missing = this.recipientLocales().find((locale) => this.draft.channels.some((code) => requirements[code].some((field) => !String(this.draft.messagesByLanguage[locale]?.[field] || "").trim())));
                if (missing) return error("[data-message-error]", `${this.localeLabel(missing)} 안내문에 비어 있는 필수 항목이 있습니다.`);
            }
            return true;
        },

        nextStep() {
            if (!this.validateStep(this.step)) return;
            this.maxStep = Math.max(this.maxStep, Math.min(4, this.step + 1));
            this.goStep(Math.min(4, this.step + 1));
        },

        goStep(step) {
            if (!Number.isInteger(step) || step < 1 || step > this.maxStep || step > 4) return;
            this.step = step;
            if (step === 2) this.renderChannels();
            if (step === 3) this.renderMessages();
            if (step === 4) this.renderReview();
            this.updateWorkflow();
            const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
            this.root.querySelector("[data-distribution-workflow]").scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
        },

        updateWorkflow() {
            this.root.querySelectorAll("[data-distribution-step]").forEach((panel) => { panel.hidden = Number(panel.dataset.distributionStep) !== this.step; });
            this.root.querySelectorAll("[data-distribution-step-target]").forEach((button) => {
                const number = Number(button.dataset.distributionStepTarget);
                const item = button.closest("li");
                button.disabled = number > this.maxStep;
                item.classList.toggle("is-current", number === this.step);
                item.classList.toggle("is-complete", number < this.step || (number < this.maxStep && number !== this.step));
                if (number === this.step) item.setAttribute("aria-current", "step"); else item.removeAttribute("aria-current");
            });
            this.root.querySelector("[data-distribution-step-kicker]").textContent = `DISTRIBUTION · STEP ${String(this.step).padStart(2, "0")}`;
            this.root.querySelector("[data-distribution-title]").textContent = STEP_TITLES[this.step];
            this.root.querySelector("[data-step-position]").textContent = `STEP ${String(this.step).padStart(2, "0")} / 04`;
            this.root.querySelector("[data-distribution-previous]").disabled = this.step === 1;
            const next = this.root.querySelector("[data-distribution-next]");
            next.hidden = this.step === 4;
            next.textContent = this.step === 3 ? "검토 단계로" : "다음 단계";
            this.updateSaveState();
            // STEP 전환 시 채널·문안 DOM이 다시 만들어지므로 실행 완료
            // 배치는 렌더링 뒤에도 반드시 읽기 전용 상태를 유지한다.
            this.syncExecutionLock();
        },

        renderReview() {
            const selectedCodes = this.draft.schedule.priority.filter((code) => this.draft.channels.includes(code));
            const selected = selectedCodes.map((code) => CHANNELS.find((channel) => channel.code === code)).filter(Boolean);
            const languageCounts = this.recipientLocales().map((locale) => ({ locale, count: this.draft.recipients.filter((item) => this.localeCode(item.preferredLanguage) === locale).length }));
            const schedule = this.draft.schedule.mode === "SCHEDULED" ? Common.formatDate(this.draft.schedule.scheduledAt, { hour: "2-digit", minute: "2-digit" }) : "실행 확인 후 즉시";
            const channelCards = selected.map((channel) => {
                const count = this.draft.recipients.filter((recipient) => recipient.channels.includes(channel.code) && String(recipient[channel.field] || "").trim()).length;
                const ready = this.providerReady(channel.code);
                return `<div class="distribution-review-channel ${ready ? "is-ready" : "is-disabled"}"><span class="distribution-channel-icon channel-${channel.code.toLowerCase()}">${channel.icon}</span><span><strong>${channel.label}</strong><small>${Common.formatNumber(count)}명 대상</small></span><b>${ready ? "실행 가능" : "DISABLED 예정"}</b></div>`;
            }).join("");
            this.root.querySelector("[data-distribution-review]").innerHTML = `<div class="distribution-review-summary"><article><span>대상자</span><strong>${Common.formatNumber(this.draft.recipients.length)}명</strong><small>수신 동의·보유기간 서버 검증 필요</small></article><article><span>언어</span><strong>${languageCounts.length}개</strong><small>${languageCounts.map((item) => `${this.localeLabel(item.locale).split(" · ")[0]} ${item.count}명`).join(" · ")}</small></article><article><span>전송 방식</span><strong>${this.draft.schedule.strategy === "ALL_AVAILABLE" ? "모든 선택 채널" : "우선순위·대체"}</strong><small>${selected.map((item) => item.label).join(" · ")}</small></article><article><span>발송 시점</span><strong>${schedule}</strong><small>확정 버전 v${this.current.publishedVersion || this.current.version || 1}</small></article></div><section class="distribution-review-section"><h4>채널별 실행 준비</h4><div class="distribution-review-channels">${channelCards}</div></section><section class="distribution-review-section"><h4>언어별 설문 URL</h4><div class="distribution-review-languages">${languageCounts.map((item) => `<div><span><strong>${Common.escapeHtml(this.localeLabel(item.locale))}</strong><small>${item.count}명</small></span><code>${Common.escapeHtml(this.languageUrl(item.locale))}</code><button class="button button-small" type="button" data-copy-language-url="${item.locale}">복사</button></div>`).join("")}</div></section>`;
            const disabled = selected.filter((item) => !this.providerReady(item.code));
            const note = this.root.querySelector("[data-execute-note]");
            note.className = `distribution-execute-note${disabled.length ? " is-warning" : " is-ready"}`;
            note.innerHTML = disabled.length
                ? `<strong>실행 시 일부 채널이 보류됩니다.</strong><span>${disabled.map((item) => `${item.label}: ${this.providers[item.code].reason}`).join(" / ")} 초안과 실행 요청 이력은 저장되며 서버 응답의 <code>executionStatus: DISABLED</code>와 채널별 사유를 표시합니다.</span>`
                : `<strong>발송 실행 준비가 완료되었습니다.</strong><span>실행 전 대상자 수신 동의와 언어별 문안을 마지막으로 확인하세요.</span>`;
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
                    channels: [...recipient.channels]
                })),
                channels: [...this.draft.channels],
                messagesByLanguage,
                schedule: { ...this.draft.schedule, scheduledAt: this.draft.schedule.mode === "SCHEDULED" ? this.draft.schedule.scheduledAt : null },
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
            if (this.saving || !this.current) return null;
            this.saving = true;
            this.updateSaveState("저장 중…");
            this.setActionDisabled(true);
            try {
                const payload = await this.context.api.put(`/api/deployments/by-survey/${encodeURIComponent(this.current.id)}`, this.buildPayload());
                const saved = payload?.deployment || payload || {};
                if (saved.revision !== undefined) this.draft.revision = saved.revision;
                this.draft.status = upper(saved.status || "DRAFT");
                this.draft.executionStatus = upper(saved.executionStatus || this.draft.executionStatus) || null;
                this.dirty = false;
                this.updateSaveState("초안 저장됨");
                if (!options.silent) this.context.toast("배포 초안을 저장했습니다.", "success");
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
            const invalidStep = [1, 2, 3].find((step) => !this.validateStep(step, false));
            if (invalidStep) {
                this.maxStep = Math.max(this.maxStep, invalidStep || 1);
                this.goStep(invalidStep || 1);
                this.validateStep(invalidStep, true);
                return;
            }
            if (!(await this.context.confirmMessage(
                "현재 대상자·언어·채널로 발송 실행을 요청할까요? 실행 이력은 확정 후 수정할 수 없습니다.",
                { title: "발송 실행 확인", confirmLabel: "실행 요청", tone: "warning" }
            ))) return;
            this.setActionDisabled(true);
            this.updateSaveState("실행 요청 중…");
            try {
                const payload = await this.context.api.post(`/api/deployments/by-survey/${encodeURIComponent(this.current.id)}/execute`, this.buildPayload());
                const result = payload?.execution || payload || {};
                const saved = payload?.deployment || result?.deployment || result;
                if (saved.revision !== undefined) this.draft.revision = saved.revision;
                this.draft.executionStatus = upper(result.executionStatus || saved.executionStatus || "QUEUED");
                this.dirty = false;
                this.executionResult = result;
                this.renderExecutionResult(result);
                this.renderReview();
                this.updateSaveState(this.draft.executionStatus === "DISABLED" ? "저장됨 · 실행 보류" : "저장됨 · 실행 요청 완료");
                this.context.toast(this.draft.executionStatus === "DISABLED" ? "배포 계획은 저장했지만 비활성 provider 채널은 실행이 보류되었습니다." : "발송 실행을 요청했습니다.", this.draft.executionStatus === "DISABLED" ? "warning" : "success");
            } catch (error) {
                this.updateSaveState("실행 요청 실패");
                this.context.toast(error.message, "error");
            } finally {
                this.setActionDisabled(false);
            }
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
            host.innerHTML = `<strong>${status === "DISABLED" ? "발송 실행이 일부 또는 전체 보류되었습니다." : "발송 실행 요청을 저장했습니다."}</strong><span>실행 상태 <code>${Common.escapeHtml(status || "UNKNOWN")}</code></span>${details ? `<ul>${details}</ul>` : ""}`;
            host.focus({ preventScroll: true });
            host.insertAdjacentHTML("beforeend", '<button class="button button-small" type="button" data-new-distribution-batch>같은 설문으로 새 배포 준비</button>');
            this.syncExecutionLock();
        },

        async startNewBatch() {
            if (!this.draft?.executionStatus) return;
            if (!(await this.context.confirmMessage(
                "이전 실행 이력은 그대로 보존하고 새 배포 초안을 만들까요? 개인정보 보호를 위해 대상자 연락처는 복사하지 않으며 채널·언어별 문안만 유지합니다.",
                { title: "새 배포 초안", confirmLabel: "새 초안 만들기", tone: "warning" }
            ))) return;
            this.draft.revision = null;
            this.draft.recipients = [this.blankRecipient()];
            this.draft.status = "DRAFT";
            this.draft.executionStatus = null;
            this.executionResult = null;
            this.dirty = true;
            this.step = 1;
            this.maxStep = 4;
            this.renderExecutionResult(null);
            this.renderRecipients();
            this.renderChannels();
            this.renderMessages();
            this.updateWorkflow();
            this.syncExecutionLock();
            this.updateSaveState("새 배포 · 저장 전");
            this.root.querySelector('[data-recipient-field="name"]')?.focus();
        },

        syncExecutionLock() {
            const locked = Boolean(this.draft?.executionStatus);
            this.root.querySelectorAll("[data-distribution-step] input, [data-distribution-step] select, [data-distribution-step] textarea, [data-distribution-step] button, [data-distribution-save], [data-distribution-execute]").forEach((control) => {
                control.disabled = locked;
            });
            this.root.querySelector("[data-distribution-workflow]")?.classList.toggle("is-execution-locked", locked);
        },

        setActionDisabled(disabled) {
            if (!this.root) return;
            const locked = disabled || Boolean(this.draft?.executionStatus);
            this.root.querySelectorAll("[data-distribution-step] input, [data-distribution-step] select, [data-distribution-step] textarea, [data-distribution-step] button, [data-distribution-save], [data-distribution-execute]").forEach((control) => {
                control.disabled = locked;
            });
            this.root.querySelector("[data-distribution-project-back]").disabled = disabled;
            if (!locked) {
                this.root.querySelectorAll("[data-recipient-row]").forEach((row) => this.syncRecipientChannelAvailability(row));
                this.syncScheduleField();
            }
        },

        markDirty() {
            this.dirty = true;
            this.executionResult = null;
            this.renderExecutionResult(null);
            this.updateSaveState();
        },

        updateSaveState(text = null) {
            const host = this.root.querySelector("[data-distribution-save-state]");
            host.textContent = text || (this.dirty ? "저장하지 않은 변경사항" : this.draft?.revision ? `초안 r${this.draft.revision} 저장됨` : "저장 전");
            host.classList.toggle("is-dirty", this.dirty);
        },

        async backToProjects() {
            if (this.dirty && !(await this.context.confirmMessage(
                "저장하지 않은 배포 변경사항이 있습니다. 프로젝트 목록으로 돌아갈까요?",
                { title: "저장하지 않은 변경사항", confirmLabel: "변경 버리고 이동", tone: "warning", destructive: true }
            ))) return;
            this.dirty = false;
            this.current = null;
            this.draft = null;
            this.executionResult = null;
            this.step = 1;
            this.maxStep = 1;
            this.root.querySelector("[data-distribution-workflow]").hidden = true;
            this.root.querySelector("[data-distribution-project-view]").hidden = false;
            this.renderProjects();
            const base = location.href.split("#", 1)[0];
            history.replaceState(null, "", `${base}#/M03001`);
            this.root.querySelector("[data-distribution-search]")?.focus({ preventScroll: true });
        },

        async beforeRefresh() {
            return !this.dirty || this.context.confirmMessage(
                "저장하지 않은 배포 변경사항이 있습니다. 변경사항을 버리고 현재 화면을 새로고침할까요?",
                { title: "현재 화면 새로고침", confirmLabel: "변경 버리고 새로고침", tone: "warning", destructive: true }
            );
        },

        destroy() {
            this.searchDebounced?.cancel?.();
            this.root?.removeEventListener("click", this.onClick);
            this.root?.removeEventListener("input", this.onInput);
            this.root?.removeEventListener("change", this.onChange);
            this.root = null;
        }
    };
})();
