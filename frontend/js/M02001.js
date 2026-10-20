(function () {
    "use strict";
    const PAGE_NAME = "M02001";
    const KOREA_UTC_OFFSET = "+09:00";
    const KOREA_UTC_OFFSET_MINUTES = 9 * 60;
    const statusLabels = { draft: "작성 중", confirmed: "확정", published: "확정", active: "진행 중", closed: "종료", paused: "일시정지" };

    function localBoundary(value) {
        if (!value) return null;
        const normalized = String(value).trim();
        const date = new Date(`${normalized.length === 16 ? `${normalized}:00` : normalized}${KOREA_UTC_OFFSET}`);
        if (Number.isNaN(date.getTime())) return null;
        return date.toISOString();
    }

    function localDateTimeValue(value) {
        if (!value) return "";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "";
        const korea = new Date(date.getTime() + KOREA_UTC_OFFSET_MINUTES * 60 * 1000);
        const part = (number) => String(number).padStart(2, "0");
        return `${korea.getUTCFullYear()}-${part(korea.getUTCMonth() + 1)}-${part(korea.getUTCDate())}T${part(korea.getUTCHours())}:${part(korea.getUTCMinutes())}`;
    }

    const sortLabels = {
        "updated-desc": "수정일 최신순",
        "updated-asc": "수정일 오래된순",
        "created-desc": "생성일 최신순",
        responses: "응답 많은 순",
        title: "이름 가나다순"
    };

    window.Pages = window.Pages || {};
    window.Pages[PAGE_NAME] = {
        async init(context) {
            this.context = context;
            this.root = context.root;
            this.items = [];
            this.filter = "all";
            this.page = 1;
            this.pageSize = 24;
            this.total = 0;
            this.totalAll = 0;
            this.loadToken = 0;
            this.editingId = null;
            this.editingPublished = false;
            this.templateId = null;
            const params = window.SurveyOneApp.queryParams();
            this.anonymousDraft = !context.user && params.get("create") === "1";
            this.selectFor = params.get("selectFor");
            this.continueAfterSave = false;
            this.view = localStorage.getItem("surveyone-project-view") || "grid";
            this.bind();
            if (!this.anonymousDraft) await this.load();
            this.templateId = params.get("templateId");
            this.startMode = params.get("start") === "template" ? "template" : "blank";
            this.resumeFlow = params.get("flow") === "new";
            if (params.get("create") === "1") this.openCreateForm();
            else if (params.get("editId")) await this.openEditForm(params.get("editId"));
            else if (params.get("urlId")) {
                if (context.isCurrentRoute?.() === false) return;
                const surveyId = params.get("urlId");
                params.delete("urlId");
                const query = params.toString();
                // This is a one-time open request, not a persistent page mode.
                history.replaceState(history.state, "", `${location.href.split("#", 1)[0]}#/M02001${query ? `?${query}` : ""}`);
                await this.openPublicLinks(surveyId);
            }
        },
        bind() {
            this.onClick = async (event) => {
                if (event.target.closest("[data-project-create]")) return this.context.navigate("M02001", { create: "1" });
                if (event.target.closest("[data-project-form-cancel]")) return this.context.navigate("M02001");
                if (event.target.closest("[data-project-next]")) {
                    this.continueAfterSave = true;
                    return this.root.querySelector("[data-project-form]").requestSubmit();
                }
                if (event.target.closest("[data-calculate-sample]")) return this.calculateSampleSize();
                const flowStep = event.target.closest("[data-project-flow]");
                if (flowStep && this.editingId) return this.context.navigate(flowStep.dataset.projectFlow, { surveyId: this.editingId, flow: "project", ...(this.templateId ? { templateId: this.templateId } : {}) });
                const status = event.target.closest("[data-status-filter]");
                if (status) {
                    this.filter = status.dataset.statusFilter;
                    this.root.querySelectorAll("[data-status-filter]").forEach((button) => button.setAttribute("aria-selected", String(button === status)));
                    void this.loadPage(1);
                }
                const pageButton = event.target.closest("[data-project-page]");
                if (pageButton && !pageButton.disabled) return void this.loadPage(Number(pageButton.dataset.projectPage));
                const view = event.target.closest("[data-view]");
                if (view) {
                    this.view = view.dataset.view;
                    localStorage.setItem("surveyone-project-view", this.view);
                    this.root.querySelectorAll("[data-view]").forEach((button) => button.setAttribute("aria-selected", String(button === view)));
                    this.render();
                }
                const basic = event.target.closest("[data-basic-id]");
                if (basic) return this.context.navigate("M02001", { editId: basic.dataset.basicId });
                const open = event.target.closest("[data-open-id]");
                if (open) return this.context.navigate(this.selectFor === "skin" ? "M02005" : "M02003", { surveyId: open.dataset.openId, flow: "project" });
                const publish = event.target.closest("[data-publish-id]");
                if (publish) return this.publish(publish.dataset.publishId);
                const share = event.target.closest("[data-share-id]");
                if (share) return this.context.navigate("M03001", { surveyId: share.dataset.shareId });
                const publicLinks = event.target.closest("[data-project-public-links]");
                if (publicLinks) return this.openPublicLinks(publicLinks.dataset.projectPublicLinks);
                const copyUrl = event.target.closest("[data-copy-public-url]");
                if (copyUrl) return this.copyPublicUrl(copyUrl.dataset.copyPublicUrl);
                const close = event.target.closest("[data-close-id]");
                if (close) return this.confirmClose(close.dataset.closeId);
                const remove = event.target.closest("[data-delete-id]");
                if (remove) return this.confirmDelete(remove.dataset.deleteId);
                const more = event.target.closest("[data-more-id]");
                if (more) return this.showActions(more.dataset.moreId);
            };
            this.onSearch = Common.debounce(() => void this.loadPage(1), 300);
            this.onSort = () => void this.loadPage(1, { announceSort: true });
            this.onFormChange = (event) => {
                if (event.target.name === "populationMode") this.syncPopulationFields();
            };
            this.onFormSubmit = (event) => void this.saveProject(event);
            this.root.addEventListener("click", this.onClick);
            this.root.querySelector("[data-project-search]").addEventListener("input", this.onSearch);
            this.root.querySelector("[data-project-sort]").addEventListener("change", this.onSort);
            this.root.querySelector("[data-project-form]").addEventListener("change", this.onFormChange);
            this.root.querySelector("[data-project-form]").addEventListener("submit", this.onFormSubmit);
            const initialView = this.root.querySelector(`[data-view="${this.view}"]`);
            if (initialView) this.root.querySelectorAll("[data-view]").forEach((button) => button.setAttribute("aria-selected", String(button === initialView)));
        },
        async load() {
            await this.loadPage(1);
        },
        async loadPage(page, { announceSort = false } = {}) {
            const requestedPage = Math.max(1, Number(page) || 1);
            const token = ++this.loadToken;
            const query = this.root.querySelector("[data-project-search]").value.trim();
            const sort = this.root.querySelector("[data-project-sort]").value;
            const params = new URLSearchParams({
                page: String(requestedPage),
                pageSize: String(this.pageSize),
                sort
            });
            if (["confirmed", "active"].includes(this.filter)) {
                params.set("status", "published");
                params.set("stage", this.filter);
            } else if (this.filter !== "all") params.set("status", this.filter);
            if (query) params.set("query", query);
            const content = this.root.querySelector("[data-project-content]");
            content.setAttribute("aria-busy", "true");
            try {
                const payload = await this.context.api.get(`/api/surveys/page?${params}`);
                if (token !== this.loadToken) return;
                this.items = Array.isArray(payload.items) ? payload.items : [];
                this.page = Number(payload.page || requestedPage);
                this.total = Number(payload.total || 0);
                this.totalAll = Number(payload.totalAll ?? payload.total_all ?? this.total);
                this.root.querySelector("[data-count-all]").textContent = this.totalAll;
                this.render();
                if (announceSort) {
                    const sortStatus = this.root.querySelector("[data-project-sort-status]");
                    if (sortStatus) sortStatus.textContent = `${sortLabels[sort] || "선택한 기준"}으로 ${this.total}개 프로젝트를 정렬했습니다.`;
                }
            } catch (error) {
                if (token !== this.loadToken) return;
                this.items = [];
                this.total = 0;
                this.render(error.message);
            } finally {
                if (token === this.loadToken) content.removeAttribute("aria-busy");
            }
        },
        openCreateForm() {
            this.editingId = null;
            this.editingPublished = false;
            const form = this.root.querySelector("[data-project-form]");
            form.reset();
            form.elements.category.value = "일반조사";
            form.elements.identity.value = "anonymous";
            form.elements.progress.value = "show";
            form.elements.populationMode.value = "unknown";
            this.root.querySelector("[data-project-create-flow]").hidden = false;
            this.root.querySelector("[data-project-form-kicker]").textContent = "NEW SURVEY PROJECT";
            this.root.querySelector("[data-project-form-title]").textContent = "프로젝트 기본정보를 입력하세요.";
            this.root.querySelector("[data-project-form-submit]").textContent = "저장 후 STEP 02로";
            this.root.querySelector("[data-project-form-submit]").classList.add("button-important");
            this.root.querySelector("[data-project-publish-changes]").hidden = true;
            this.root.querySelector("[data-project-published-period-note]").hidden = true;
            this.root.querySelector("[data-project-next]").hidden = true;
            this.showForm();
        },
        async openEditForm(id) {
            try {
                const payload = await this.context.api.get(`/api/surveys/${encodeURIComponent(id)}`);
                const survey = payload.survey || payload;
                this.editingId = survey.id;
                this.editingPublished = Number(survey.publishedVersion || 0) > 0;
                this.populateForm(survey);
                this.root.querySelector("[data-project-create-flow]").hidden = false;
                this.root.querySelectorAll("[data-project-flow]").forEach((button) => { button.disabled = false; });
                this.root.querySelector("[data-project-form-kicker]").textContent = "SURVEY PROJECT · STEP 01";
                this.root.querySelector("[data-project-form-title]").textContent = "프로젝트 기본정보를 확인하세요.";
                this.root.querySelector("[data-project-form-submit]").textContent = this.editingPublished ? "변경사항만 저장" : "변경사항 저장";
                this.root.querySelector("[data-project-form-submit]").classList.toggle("button-important", !this.editingPublished);
                this.root.querySelector("[data-project-publish-changes]").hidden = !this.editingPublished;
                this.root.querySelector("[data-project-published-period-note]").hidden = !this.editingPublished;
                this.root.querySelector("[data-project-next]").hidden = false;
                this.showForm();
            } catch (error) {
                this.context.toast(error.message, "error");
                this.context.navigate("M02001");
            }
        },
        showForm() {
            this.root.querySelector("[data-project-list-view]").hidden = true;
            this.root.querySelector("[data-project-form-view]").hidden = false;
            this.root.querySelector("[data-project-form-error]").hidden = true;
            this.syncPopulationFields();
            this.root.querySelector("[name=title]").focus();
        },
        populateForm(survey) {
            const form = this.root.querySelector("[data-project-form]");
            form.reset();
            const profile = survey.projectProfile || {};
            form.elements.title.value = survey.title || "";
            if (![...form.elements.category.options].some((option) => option.value === survey.category)) {
                form.elements.category.add(new Option(survey.category, survey.category));
            }
            form.elements.category.value = survey.category || "일반조사";
            form.elements.description.value = survey.description || "";
            form.elements.targetAudience.value = profile.targetAudience || "";
            form.elements.startsAt.value = localDateTimeValue(profile.startsAt || survey.settings?.startsAt);
            form.elements.closesAt.value = localDateTimeValue(profile.closesAt || survey.settings?.closesAt);
            const identified = profile.identified ?? !(survey.settings?.anonymous ?? true);
            form.elements.identity.value = identified ? "identified" : "anonymous";
            form.elements.progress.value = (profile.showProgress ?? survey.settings?.showProgressBar ?? true) ? "show" : "hide";
            form.elements.populationMode.value = profile.populationMode || "unknown";
            form.elements.populationSize.value = profile.populationSize || "";
            form.elements.targetResponseCount.value = profile.targetResponseCount || "";
        },
        syncPopulationFields() {
            const form = this.root.querySelector("[data-project-form]");
            const known = form.elements.populationMode.value === "known";
            const field = this.root.querySelector("[data-population-size-field]");
            field.hidden = !known;
            form.elements.populationSize.required = known;
            form.elements.populationSize.disabled = !known;
            if (!known) form.elements.populationSize.value = "";
        },
        calculateSampleSize() {
            const form = this.root.querySelector("[data-project-form]");
            const population = Number(form.elements.populationSize.value);
            if (form.elements.populationMode.value !== "known" || !Number.isInteger(population) || population < 1) {
                this.context.toast("모집단 크기를 알고 있음으로 선택하고 전체 모집단 수를 입력해 주세요.", "error");
                form.elements.populationSize.focus();
                return;
            }
            const infiniteSample = 1.96 ** 2 * 0.25 / 0.05 ** 2;
            const recommended = Math.min(population, Math.ceil(infiniteSample / (1 + (infiniteSample - 1) / population)));
            form.elements.targetResponseCount.value = recommended;
            this.context.toast(`권장 최소 표본 ${Common.formatNumber(recommended)}명을 입력했습니다.`, "success");
        },
        collectForm() {
            const form = this.root.querySelector("[data-project-form]");
            const startsAt = form.elements.startsAt.value;
            const closesAt = form.elements.closesAt.value;
            if (Boolean(startsAt) !== Boolean(closesAt)) throw new Error("조사 시작일과 종료일을 함께 입력해 주세요.");
            if (startsAt && closesAt && startsAt > closesAt) throw new Error("조사 시작일은 종료일보다 빨라야 합니다.");
            const populationMode = form.elements.populationMode.value;
            const populationSize = populationMode === "known" ? Number(form.elements.populationSize.value) : null;
            const targetResponseCount = form.elements.targetResponseCount.value ? Number(form.elements.targetResponseCount.value) : null;
            if (populationMode === "known" && (!Number.isInteger(populationSize) || populationSize < 1)) throw new Error("모집단 크기를 입력해 주세요.");
            if (targetResponseCount !== null && (!Number.isInteger(targetResponseCount) || targetResponseCount < 1)) throw new Error("목표 응답자 수는 1명 이상이어야 합니다.");
            if (populationSize && targetResponseCount && targetResponseCount > populationSize) throw new Error("목표 응답자 수는 모집단 크기보다 클 수 없습니다.");
            return {
                title: form.elements.title.value.trim(),
                category: form.elements.category.value,
                description: form.elements.description.value.trim() || null,
                projectProfile: {
                    startsAt: localBoundary(startsAt),
                    closesAt: localBoundary(closesAt),
                    identified: form.elements.identity.value === "identified",
                    showProgress: form.elements.progress.value === "show",
                    targetAudience: form.elements.targetAudience.value.trim() || null,
                    populationMode,
                    populationSize,
                    targetResponseCount
                }
            };
        },
        async saveProject(event) {
            event.preventDefault();
            const form = event.currentTarget;
            const publishAfterSave = Boolean(event.submitter?.matches("[data-project-publish-changes]"));
            const errorBox = this.root.querySelector("[data-project-form-error]");
            if (!form.reportValidity()) return;
            let body;
            try { body = this.collectForm(); }
            catch (error) { errorBox.textContent = error.message; errorBox.hidden = false; errorBox.focus(); return; }
            if (publishAfterSave && !(await this.context.confirmMessage(
                "현재 편집본을 저장하고 새 확정 버전을 생성할까요? 기존 URL은 유지되며 응답 기간을 포함한 현재 설정이 URL에 반영됩니다.",
                { title: "새 버전 확정 및 기간 반영", confirmLabel: "저장하고 새 버전 확정", tone: "warning" }
            ))) return;
            const submitButtons = [...this.root.querySelectorAll("[data-project-form-submit], [data-project-publish-changes]")];
            submitButtons.forEach((button) => { button.disabled = true; });
            errorBox.hidden = true;
            try {
                if (!this.editingId && !this.context.appState.user) {
                    await this.context.activateGuestForWork();
                }
                const payload = this.editingId
                    ? await this.context.api.patch(`/api/surveys/${encodeURIComponent(this.editingId)}`, body)
                    : await this.context.api.post("/api/surveys", body);
                const survey = payload.survey || payload;
                if (this.editingId) {
                    if (publishAfterSave) {
                        const publishPayload = await this.context.api.post(`/api/surveys/${encodeURIComponent(survey.id)}/publish`, {});
                        const published = publishPayload.survey || publishPayload;
                        this.editingPublished = true;
                        this.context.toast(`새 확정 버전 v${published.version}에 설문 기간을 반영했습니다. 기존 URL은 유지됩니다.`, "success");
                    } else if (this.editingPublished) {
                        this.context.toast("편집본에 저장했습니다. 공개 URL의 기간은 이전 확정본을 유지합니다.", "warning");
                    } else this.context.toast("프로젝트 기본정보를 저장했습니다.", "success");
                    if (this.continueAfterSave) this.context.navigate("M02005", { surveyId: survey.id, flow: "project", ...(this.templateId ? { templateId: this.templateId } : {}) });
                    else {
                        this.editingId = survey.id;
                        submitButtons.forEach((button) => { button.disabled = false; });
                        if (publishAfterSave) await this.openPublicLinks(survey.id);
                    }
                } else {
                    this.context.toast("STEP 01 기본정보를 저장했습니다.", "success");
                    if (this.startMode === "template") {
                        this.context.navigate("M02003", { surveyId: survey.id, flow: "project", template: "1", ...(this.templateId ? { templateId: this.templateId } : {}) });
                    } else {
                        this.context.navigate("M02005", { surveyId: survey.id, flow: "project", ...(this.templateId ? { templateId: this.templateId } : {}) });
                    }
                }
            } catch (error) {
                errorBox.textContent = error.message;
                errorBox.hidden = false;
                errorBox.focus();
                submitButtons.forEach((button) => { button.disabled = false; });
            } finally {
                this.continueAfterSave = false;
            }
        },
        render(errorMessage) {
            const items = this.items;
            const grid = this.root.querySelector("[data-project-grid]");
            grid.className = `project-grid ${this.view === "list" ? "is-list" : ""}`;
            if (!items.length) {
                grid.innerHTML = `<section class="empty-state project-empty"><span class="empty-icon">${errorMessage ? "!" : "＋"}</span><h2>${errorMessage ? "프로젝트를 불러오지 못했습니다" : "조건에 맞는 설문이 없습니다"}</h2><p>${Common.escapeHtml(errorMessage || "새 프로젝트를 만들거나 검색 조건을 바꿔보세요.")}</p><button class="button button-function button-important" data-project-create>${errorMessage ? "새 설문 만들기" : "첫 설문 만들기"}</button></section>`;
                this.renderPagination();
                return;
            }
            grid.innerHTML = items.map((item) => this.cardMarkup(item)).join("");
            this.renderPagination();
        },
        renderPagination() {
            const pagination = this.root.querySelector("[data-project-pagination]");
            const pageCount = Math.ceil(this.total / this.pageSize);
            pagination.hidden = pageCount <= 1;
            if (pageCount <= 1) {
                pagination.innerHTML = "";
                return;
            }
            const start = Math.max(1, Math.min(this.page - 2, pageCount - 4));
            const end = Math.min(pageCount, start + 4);
            const pages = [];
            for (let page = start; page <= end; page += 1) {
                pages.push(`<button class="button button-small button-navigation button-cue-hidden" type="button" data-project-page="${page}" ${page === this.page ? 'aria-current="page"' : ""}>${page}</button>`);
            }
            pagination.innerHTML = `<span>${Common.formatNumber(this.total)}개 중 ${Common.formatNumber((this.page - 1) * this.pageSize + 1)}–${Common.formatNumber(Math.min(this.page * this.pageSize, this.total))}</span><div><button class="button button-small button-navigation button-navigation-back" type="button" data-project-page="${this.page - 1}" ${this.page <= 1 ? "disabled" : ""}>이전</button>${pages.join("")}<button class="button button-small button-navigation" type="button" data-project-page="${this.page + 1}" ${this.page >= pageCount ? "disabled" : ""}>다음</button></div>`;
        },
        cardMarkup(item) {
            const status = item.status === "active" ? "published" : (item.status || "draft");
            const published = status === "published";
            const stage = published && String(item.deploymentStatus || "").toUpperCase() === "ACTIVE" ? "active" : published ? "confirmed" : status;
            const count = item.responseCount || 0;
            const started = item.startedResponseCount || count;
            const completion = item.completionRate ?? (started ? Math.round(count / started * 100) : 0);
            const publicUrl = this.absolutePublicUrl(item.publicUrl);
            const urlMarkup = published && publicUrl ? `<div class="project-public-url"><span>프로젝트 배포 URL</span><code title="${Common.escapeHtml(publicUrl)}">${Common.escapeHtml(publicUrl)}</code><button class="button button-small button-function" type="button" data-copy-public-url="${Common.escapeHtml(item.id)}">기본 URL 복사</button><button class="button button-small button-layer" type="button" data-project-public-links="${Common.escapeHtml(item.id)}">대상별 URL · 관리</button></div>` : "";
            const distributionLabel = stage === "active" ? "배포 관리" : "배포 준비";
            return `<article class="project-card"><header class="project-card-head"><span class="status-badge status-${Common.escapeHtml(stage)}">${statusLabels[stage] || stage}</span><button class="icon-button icon-button-layer project-more" type="button" data-more-id="${Common.escapeHtml(item.id)}" aria-label="${Common.escapeHtml(item.title)} 프로젝트 작업 레이어 열기">•••</button></header><button class="project-card-main" type="button" data-open-id="${Common.escapeHtml(item.id)}"><span class="project-category">${Common.escapeHtml(item.category || item.templateName || "직접 작성")}</span><h3>${Common.escapeHtml(item.title)}</h3><span class="project-id">프로젝트 ID <code>${Common.escapeHtml(item.id)}</code></span><p>${Common.escapeHtml(item.description || "설문 설명을 입력해 주세요.")}</p></button>${urlMarkup}<dl class="project-stats"><div><dt>문항</dt><dd>${Common.formatNumber(item.questionCount || item.questions?.length || 0)}</dd></div><div><dt>응답</dt><dd>${Common.formatNumber(count)}</dd></div><div><dt>완료율</dt><dd>${completion}%</dd></div></dl><footer class="project-card-footer"><span>${Common.formatDate(item.updatedAt || item.createdAt)} 수정</span><div class="project-card-actions">${published ? `<button class="button button-small button-navigation" type="button" data-share-id="${Common.escapeHtml(item.id)}">${distributionLabel}</button><button class="button button-small button-batch" type="button" data-close-id="${Common.escapeHtml(item.id)}">배포 종료</button>` : `<button class="button button-small button-batch button-important" type="button" data-publish-id="${Common.escapeHtml(item.id)}">확정 및 URL 발급</button>`}<button class="button button-small button-navigation" type="button" data-open-id="${Common.escapeHtml(item.id)}">편집</button><button class="button button-small button-navigation" type="button" data-basic-id="${Common.escapeHtml(item.id)}">기본정보</button>${!published ? `<button class="button button-small button-delete" type="button" data-delete-id="${Common.escapeHtml(item.id)}">삭제</button>` : ""}</div></footer></article>`;
        },
        absolutePublicUrl(value) {
            if (!value) return "";
            try { return new URL(String(value), location.origin).href; }
            catch { return ""; }
        },
        async openPublicLinks(id) {
            try {
                await window.SurveyPublicationLinks.open({
                    context: this.context, surveyId: id,
                    onRegenerate: result => {
                        if (!this.root || this.context.isCurrentRoute?.() === false) return;
                        const item = this.items.find(candidate => String(candidate.id) === String(id));
                        if (item) {
                            item.slug = result.slug;
                            item.publicUrl = result.publicUrl;
                            this.render();
                        }
                    }
                });
            } catch (error) { this.context.toast(error.message, "error"); }
        },
        async copyPublicUrl(id) {
            const item = this.items.find((candidate) => String(candidate.id) === String(id));
            const value = this.absolutePublicUrl(item?.publicUrl);
            if (!value) return this.context.toast("복사할 프로젝트 배포 URL이 없습니다.", "error");
            try {
                await Common.copyText(value);
                this.context.toast("프로젝트 배포 URL을 복사했습니다.", "success");
            } catch {
                this.context.toast("브라우저에서 URL 복사를 허용하지 않았습니다.", "error");
            }
        },
        async publish(id) {
            try {
                await this.context.api.post(`/api/surveys/${encodeURIComponent(id)}/publish`, {});
                await this.loadPage(this.page);
                this.context.toast("설문을 확정했습니다. 대상별 URL을 확인하세요.", "success");
                await this.openPublicLinks(id);
            } catch (error) { this.context.toast(error.message, "error"); }
        },
        showActions(id) {
            const item = this.items.find((candidate) => String(candidate.id) === String(id));
            if (!item) return;
            const status = item.status === "active" ? "published" : item.status;
            const deletable = status !== "published";
            const publicUrl = this.absolutePublicUrl(item.publicUrl);
            const dialog = this.context.openModal(`<p class="eyebrow">PROJECT ACTIONS</p><h2>${Common.escapeHtml(item.title)}</h2><p class="project-modal-id">프로젝트 ID <code>${Common.escapeHtml(item.id)}</code></p>${status === "published" && publicUrl ? `<p class="project-modal-id">프로젝트 배포 URL <code>${Common.escapeHtml(publicUrl)}</code></p>` : ""}<div class="project-action-menu"><button class="button button-navigation" data-modal-basic>기본정보 수정</button><button class="button button-navigation" data-modal-edit>설문 편집</button><button class="button button-navigation" data-modal-skin>프로젝트 스킨</button>${status === "published" ? '<button class="button button-layer" data-modal-public-links>대상별 URL · 관리</button><button class="button button-function" data-modal-copy-url>기본 URL 복사</button>' : ""}<button class="button button-navigation" data-modal-share>배포 센터</button><button class="button button-navigation" data-modal-report>결과 보고서</button>${status === "published" ? '<button class="button button-batch" data-modal-close>배포 종료</button>' : ""}<button class="button button-delete" data-modal-delete ${deletable ? "" : "disabled"}>${deletable ? "프로젝트 삭제" : "확정·진행 중에는 삭제할 수 없음"}</button></div>${deletable ? "" : '<p class="project-delete-note" role="note">확정 또는 진행 중인 설문은 버전과 응답 보호를 위해 삭제할 수 없습니다. 먼저 배포를 종료해 주세요.</p>'}`);
            dialog.querySelector("[data-modal-basic]").addEventListener("click", () => { dialog.close(); this.context.navigate("M02001", { editId: id }); });
            dialog.querySelector("[data-modal-edit]").addEventListener("click", () => { dialog.close(); this.context.navigate("M02003", { surveyId: id }); });
            dialog.querySelector("[data-modal-skin]").addEventListener("click", () => { dialog.close(); this.context.navigate("M02005", { surveyId: id, flow: "project" }); });
            dialog.querySelector("[data-modal-public-links]")?.addEventListener("click", () => { dialog.close(); void this.openPublicLinks(id); });
            dialog.querySelector("[data-modal-copy-url]")?.addEventListener("click", () => void this.copyPublicUrl(id));
            dialog.querySelector("[data-modal-share]").addEventListener("click", () => { dialog.close(); this.context.navigate("M03001", { surveyId: id }); });
            dialog.querySelector("[data-modal-report]").addEventListener("click", () => { dialog.close(); this.context.navigate("M05001", { surveyId: id }); });
            dialog.querySelector("[data-modal-close]")?.addEventListener("click", () => { dialog.close(); this.confirmClose(id); });
            dialog.querySelector("[data-modal-delete]")?.addEventListener("click", () => this.confirmDelete(id));
        },
        confirmClose(id) {
            const item = this.items.find((candidate) => String(candidate.id) === String(id));
            if (!item) return;
            const dialog = this.context.openModal(`<p class="eyebrow">CLOSE DISTRIBUTION</p><h2>설문 배포를 종료할까요?</h2><p><strong>${Common.escapeHtml(item.title)}</strong></p><p class="project-modal-id">프로젝트 ID <code>${Common.escapeHtml(item.id)}</code></p><p class="project-delete-note" role="note">공개 응답 URL이 즉시 닫힙니다. 기존 확정 버전과 응답·발송 이력은 보존되며, 종료 후 프로젝트를 삭제하거나 새 버전으로 다시 확정할 수 있습니다.</p><div class="project-delete-actions"><button class="button button-function" type="button" data-close-cancel>취소</button><button class="button button-batch button-important" type="button" data-close-confirm>배포 종료</button></div>`, { label: "설문 배포 종료 확인" });
            dialog.querySelector("[data-close-cancel]").addEventListener("click", () => dialog.close());
            dialog.querySelector("[data-close-confirm]").addEventListener("click", (event) => void this.closeProject(id, dialog, event.currentTarget));
        },
        async closeProject(id, dialog, button) {
            button.disabled = true;
            button.textContent = "종료 중…";
            try {
                await this.context.api.post(`/api/surveys/${encodeURIComponent(id)}/close`, {});
                await this.loadPage(this.page);
                dialog.close();
                this.context.toast("설문 배포를 종료했습니다. 이제 프로젝트를 삭제할 수 있습니다.", "success");
            } catch (error) {
                button.disabled = false;
                button.textContent = "배포 종료";
                this.context.toast(error.message, "error");
            }
        },
        confirmDelete(id) {
            const item = this.items.find((candidate) => String(candidate.id) === String(id));
            if (!item) return;
            const status = item.status === "active" ? "published" : item.status;
            if (status === "published") return this.context.toast("확정 또는 진행 중인 설문 프로젝트는 삭제할 수 없습니다. 먼저 배포를 종료해 주세요.", "error");
            const dialog = this.context.openModal(`<p class="eyebrow">DELETE PROJECT</p><h2>프로젝트를 삭제할까요?</h2><p><strong>${Common.escapeHtml(item.title)}</strong></p><p class="project-modal-id">프로젝트 ID <code>${Common.escapeHtml(item.id)}</code></p><p class="project-delete-note" role="note">목록에서 제거되고 더 이상 열 수 없습니다. 진행 중인 프로젝트는 이 작업 자체가 허용되지 않습니다.</p><div class="project-delete-actions"><button class="button button-function" type="button" data-delete-cancel>취소</button><button class="button button-delete button-important" type="button" data-delete-confirm>삭제</button></div>`, { label: "설문 프로젝트 삭제 확인" });
            dialog.querySelector("[data-delete-cancel]").addEventListener("click", () => dialog.close());
            dialog.querySelector("[data-delete-confirm]").addEventListener("click", (event) => void this.deleteProject(id, dialog, event.currentTarget));
        },
        async deleteProject(id, dialog, button) {
            button.disabled = true;
            button.textContent = "삭제 중…";
            try {
                await this.context.api.delete(`/api/surveys/${encodeURIComponent(id)}`);
                await this.loadPage(this.items.length === 1 && this.page > 1 ? this.page - 1 : this.page);
                dialog.close();
                this.context.toast("설문 프로젝트를 삭제했습니다.", "success");
            } catch (error) {
                button.disabled = false;
                button.textContent = "삭제";
                this.context.toast(error.message, "error");
            }
        },
        destroy() {
            this.onSearch?.cancel?.();
            this.root?.removeEventListener("click", this.onClick);
            this.root?.querySelector("[data-project-search]")?.removeEventListener("input", this.onSearch);
            this.root?.querySelector("[data-project-sort]")?.removeEventListener("change", this.onSort);
            this.root?.querySelector("[data-project-form]")?.removeEventListener("change", this.onFormChange);
            this.root?.querySelector("[data-project-form]")?.removeEventListener("submit", this.onFormSubmit);
            this.root = null;
        }
    };
})();
