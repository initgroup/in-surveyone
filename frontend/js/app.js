(function () {
    "use strict";

    const state = {
        user: null,
        route: null,
        currentPage: null,
        loadedScripts: new Set(),
        activeStyle: null,
        guestCapabilities: null,
        guestCapabilitiesPromise: null,
        modalReturnFocus: null
    };

    const dom = {};

    document.addEventListener("DOMContentLoaded", init);

    async function init() {
        cacheDom();
        renderNavigation();
        bindShellEvents();
        const hasSession = await restoreSession();
        window.addEventListener("hashchange", route);
        if (hasSession) {
            await route();
        } else {
            dom.pageHost.innerHTML = `<section class="empty-state"><span class="empty-icon">IN</span><h2>설문 작업공간에 오신 것을 환영합니다.</h2><p>게스트 체험, 로그인 또는 회원가입으로 작업공간을 시작하세요.</p><button class="button button-primary" type="button" data-auth-action="guest">게스트로 시작</button></section>`;
            dom.pageHost.querySelector('[data-auth-action="guest"]').addEventListener("click", () => openAuth("guest"));
        }
    }

    function cacheDom() {
        dom.navigation = document.querySelector("[data-navigation]");
        dom.mobileNav = document.querySelector("[data-mobile-nav]");
        dom.sidebar = document.querySelector("[data-sidebar]");
        dom.scrim = document.querySelector("[data-sidebar-scrim]");
        dom.menuToggle = document.querySelector("[data-menu-toggle]");
        dom.pageHost = document.querySelector("#pageHost");
        dom.pageTitle = document.querySelector("[data-page-title]");
        dom.pageGroup = document.querySelector("[data-page-group]");
        dom.userButton = document.querySelector("[data-user-button]");
        dom.userMenu = document.querySelector("[data-user-menu]");
        dom.authDialog = document.querySelector("[data-auth-dialog]");
        dom.authMessage = document.querySelector("[data-auth-message]");
        dom.modal = document.querySelector("[data-modal]");
        dom.modalBody = document.querySelector("[data-modal-body]");
    }

    function renderNavigation() {
        dom.navigation.innerHTML = window.MENU_CONFIG.map((group) => `
            <section class="nav-group" data-nav-group="${group.code}">
                <button class="nav-group-label" type="button" aria-expanded="true">
                    <span>${Common.icon(group.icon, 18)} ${group.label}</span><i aria-hidden="true">⌄</i>
                </button>
                <div class="nav-group-items">
                    ${group.items.map((item) => `<a href="#/${item.code}" data-route-link="${item.code}" title="${item.description}">${item.label}</a>`).join("")}
                </div>
            </section>
        `).join("");

        const quickCodes = ["M01001", "M02001", "M02003", "M04001", "M05001"];
        dom.mobileNav.innerHTML = quickCodes.map((code) => {
            const page = window.PAGE_CONFIG[code];
            const group = window.MENU_CONFIG.find((candidate) => candidate.code === page.groupCode);
            return `<a href="#/${code}" data-route-link="${code}">${Common.icon(group.icon, 19)}<span>${shortMobileLabel(code, page.label)}</span></a>`;
        }).join("");
    }

    function shortMobileLabel(code, label) {
        return ({ M01001: "홈", M02001: "설문", M02003: "편집", M04001: "응답", M05001: "분석" })[code] || label;
    }

    function bindShellEvents() {
        dom.menuToggle.addEventListener("click", () => setSidebar(!dom.sidebar.classList.contains("is-open")));
        dom.scrim.addEventListener("click", () => setSidebar(false));
        dom.navigation.addEventListener("click", (event) => {
            const button = event.target.closest(".nav-group-label");
            if (button) {
                const group = button.closest(".nav-group");
                const expanded = button.getAttribute("aria-expanded") === "true";
                button.setAttribute("aria-expanded", String(!expanded));
                group.classList.toggle("is-collapsed", expanded);
            }
            if (event.target.closest("[data-route-link]")) setSidebar(false);
        });

        dom.userButton.addEventListener("click", () => {
            const opening = dom.userMenu.hidden;
            dom.userMenu.hidden = !opening;
            dom.userButton.setAttribute("aria-expanded", String(opening));
        });
        document.addEventListener("click", (event) => {
            if (!event.target.closest("[data-user-button]") && !event.target.closest("[data-user-menu]")) {
                dom.userMenu.hidden = true;
                dom.userButton.setAttribute("aria-expanded", "false");
            }
            const authAction = event.target.closest("[data-auth-action]")?.dataset.authAction;
            if (authAction === "logout") logout();
            if (authAction === "login" || authAction === "signup") openAuth(authAction);
        });

        document.querySelector("[data-quick-create]").addEventListener("click", () => navigate("M02002"));
        document.querySelector("[data-help-button]").addEventListener("click", () => void showHelp());
        document.querySelector("[data-guest-start]").addEventListener("click", startGuest);
        document.querySelector("[data-guest-mode-picker]").addEventListener("change", renderGuestCapabilities);
        document.querySelectorAll("[data-auth-tab]").forEach((tab) => tab.addEventListener("click", () => selectAuthTab(tab.dataset.authTab)));
        document.querySelector("[data-login-form]").addEventListener("submit", submitLogin);
        document.querySelector("[data-signup-form]").addEventListener("submit", submitSignup);
        dom.modal.addEventListener("close", () => {
            const target = state.modalReturnFocus;
            state.modalReturnFocus = null;
            if (target?.isConnected) target.focus({ preventScroll: true });
        });
    }

    function setSidebar(open) {
        dom.sidebar.classList.toggle("is-open", open);
        dom.scrim.hidden = !open;
        dom.menuToggle.setAttribute("aria-expanded", String(open));
        document.body.classList.toggle("has-sidebar-open", open);
    }

    function routeCode() {
        const code = location.hash.replace(/^#\/?/, "").split(/[?&]/)[0].toUpperCase();
        return window.PAGE_CONFIG[code] ? code : window.SURVEYONE_CONFIG.defaultRoute;
    }

    async function route() {
        const code = routeCode();
        if (location.hash !== `#/${code}` && !location.hash.includes("?")) history.replaceState(null, "", `#/${code}`);
        const page = window.PAGE_CONFIG[code];
        if (dom.modal.open) dom.modal.close();
        state.route = code;
        updateActiveNavigation(code);
        dom.pageTitle.textContent = page.label;
        dom.pageGroup.textContent = window.MENU_CONFIG.find((group) => group.code === page.groupCode)?.label || "";
        const helpButton = document.querySelector("[data-help-button]");
        helpButton.setAttribute("aria-label", `${page.label} 작성 도움말 열기`);
        helpButton.title = `${page.label} 작성 도움말`;
        document.title = `${page.label} | IN-SURVEYONE`;
        dom.pageHost.innerHTML = loadingMarkup(page.label);

        try {
            if (state.currentPage?.destroy) await state.currentPage.destroy();
            await loadPageStyle(page.style);
            const response = await fetch(page.html, { cache: "no-store" });
            if (!response.ok) throw new Error(`화면 파일을 불러오지 못했습니다. (${response.status})`);
            dom.pageHost.innerHTML = await response.text();
            await loadScript(page.script);
            state.currentPage = window.Pages?.[code] || null;
            if (state.currentPage?.init) {
                await state.currentPage.init({
                    root: dom.pageHost,
                    api: Common.api,
                    toast,
                    navigate,
                    openModal,
                    user: state.user,
                    appState: state
                });
            }
            dom.pageHost.focus({ preventScroll: true });
        } catch (error) {
            console.error(error);
            dom.pageHost.innerHTML = errorMarkup(error.message);
            dom.pageHost.querySelector("[data-route-retry]")?.addEventListener("click", route);
        }
    }

    function loadScript(src) {
        if (state.loadedScripts.has(src)) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = src;
            script.onload = () => { state.loadedScripts.add(src); resolve(); };
            script.onerror = () => reject(new Error(`${src} 스크립트를 불러오지 못했습니다.`));
            document.body.appendChild(script);
        });
    }

    async function loadPageStyle(href) {
        if (state.activeStyle) state.activeStyle.remove();
        return new Promise((resolve) => {
            const link = document.createElement("link");
            link.rel = "stylesheet";
            link.href = href;
            link.dataset.pageStyle = "";
            link.onload = resolve;
            link.onerror = resolve;
            document.head.appendChild(link);
            state.activeStyle = link;
        });
    }

    function updateActiveNavigation(code) {
        document.querySelectorAll("[data-route-link]").forEach((link) => {
            const current = link.dataset.routeLink === code;
            link.classList.toggle("is-active", current);
            if (current) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
        });
    }

    function navigate(code, params = null) {
        const query = params ? `?${new URLSearchParams(params)}` : "";
        location.hash = `#/${code}${query}`;
    }

    function queryParams() {
        const raw = location.hash.split("?")[1] || "";
        return new URLSearchParams(raw);
    }

    async function restoreSession() {
        try {
            const payload = await Common.api.get("/api/auth/me");
            state.user = payload.user || payload;
            updateUserUi();
            return true;
        } catch (error) {
            if (error.status !== 401) console.warn("세션을 확인하지 못했습니다.", error);
            updateUserUi();
            openAuth("guest");
            return false;
        }
    }

    async function startGuest() {
        const mode = document.querySelector('input[name="guestMode"]:checked')?.value || "local";
        const capability = guestMode(mode);
        if (!capability?.available) {
            setAuthBusy(false, capability?.reason || "선택한 게스트 모드를 사용할 수 없습니다.", true);
            return;
        }
        setAuthBusy(true, "게스트 작업공간을 준비하고 있습니다.");
        try {
            const payload = await Common.api.post("/api/auth/guest", { mode });
            state.user = payload.user || payload;
            sessionStorage.setItem("surveyone-welcome-seen", "true");
            updateUserUi();
            dom.authDialog.close();
            toast(mode === "database" ? "DB 저장 체험 작업공간에 입장했습니다." : "로컬 체험 작업공간에 입장했습니다.", "success");
            await route();
        } catch (error) {
            setAuthBusy(false, error.message, true);
        }
    }

    async function submitLogin(event) {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(event.currentTarget));
        setAuthBusy(true, "로그인 중입니다.");
        try {
            const payload = await Common.api.post("/api/auth/login", data);
            state.user = payload.user || payload;
            updateUserUi();
            dom.authDialog.close();
            toast("로그인했습니다.", "success");
            await route();
        } catch (error) { setAuthBusy(false, error.message, true); }
    }

    async function submitSignup(event) {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(event.currentTarget));
        delete data.terms;
        setAuthBusy(true, "작업공간을 만들고 있습니다.");
        try {
            const payload = await Common.api.post("/api/auth/signup", data);
            state.user = payload.user || payload;
            updateUserUi();
            dom.authDialog.close();
            toast("IN-SURVEYONE 작업공간이 생성되었습니다.", "success");
            await route();
        } catch (error) { setAuthBusy(false, error.message, true); }
    }

    async function logout() {
        try { await Common.api.post("/api/auth/logout", {}); } catch (error) { console.warn(error); }
        state.user = null;
        updateUserUi();
        dom.userMenu.hidden = true;
        openAuth("login");
    }

    function updateUserUi() {
        const user = state.user;
        const name = user?.name || user?.displayName || "Guest";
        const tenant = user?.organizationName || user?.tenantName || "게스트 체험관";
        const guest = !user || Boolean(user.isGuest ?? user.role === "guest");
        document.querySelector("[data-user-name]").textContent = name;
        const guestModeCode = String(user?.guestMode || user?.guest_mode || "").toLowerCase();
        const guestModeLabel = ["database", "db"].includes(guestModeCode) ? "DB 저장 체험" : "로컬 체험";
        document.querySelector("[data-user-role]").textContent = guest ? guestModeLabel : (user.roleLabel || "설문 관리자");
        document.querySelector("[data-user-avatar]").textContent = name.trim().charAt(0).toUpperCase() || "G";
        document.querySelector("[data-tenant-name]").textContent = tenant;
        document.querySelector("[data-guest-upgrade]").hidden = !guest;
        document.querySelectorAll('[data-auth-action="logout"]').forEach((button) => { button.hidden = !user; });
        document.querySelectorAll('[data-auth-action="login"], [data-auth-action="signup"]').forEach((button) => { button.hidden = Boolean(user && !guest); });
    }

    function openAuth(mode = "guest") {
        selectAuthTab(mode);
        dom.authMessage.textContent = "";
        if (!dom.authDialog.open) dom.authDialog.showModal();
        if (mode === "guest") void loadGuestCapabilities();
    }

    function selectAuthTab(mode) {
        document.querySelectorAll("[data-auth-tab]").forEach((tab) => {
            const selected = tab.dataset.authTab === mode;
            tab.setAttribute("aria-selected", String(selected));
            tab.tabIndex = selected ? 0 : -1;
        });
        document.querySelectorAll("[data-auth-panel]").forEach((panel) => { panel.hidden = panel.dataset.authPanel !== mode; });
        const titles = { guest: "먼저 가볍게 체험하세요", login: "작업공간으로 돌아오기", signup: "기관 설문 작업공간 만들기" };
        document.querySelector("[data-auth-title]").textContent = titles[mode];
        if (mode === "guest") void loadGuestCapabilities();
    }

    function fallbackGuestCapabilities(reason = "DB 저장 체험 제공 상태를 확인하지 못했습니다.") {
        return {
            selectedMode: "local",
            modes: [
                {
                    mode: "local",
                    title: "로컬 체험",
                    available: true,
                    reason: "프로세스가 종료되면 데이터가 사라질 수 있습니다.",
                    persistence: "memory",
                    limits: {},
                    features: {}
                },
                {
                    mode: "database",
                    title: "DB 저장 체험",
                    available: false,
                    reason,
                    persistence: "oracle",
                    limits: {},
                    features: {},
                    providerConfigured: {}
                }
            ]
        };
    }

    function normalizeGuestCapabilities(payload) {
        const source = payload?.data || payload || {};
        const rawModes = Array.isArray(source.modes)
            ? source.modes
            : [source.local, source.database].filter(Boolean);
        const fallback = fallbackGuestCapabilities();
        const modes = ["local", "database"].map((mode) => {
            const candidate = rawModes.find((item) => String(item?.mode || item?.code || "").toLowerCase() === mode)
                || rawModes[mode === "local" ? 0 : 1]
                || fallback.modes.find((item) => item.mode === mode);
            return {
                ...candidate,
                mode,
                available: mode === "local" ? candidate?.available !== false : Boolean(candidate?.available),
                limits: candidate?.limits || {},
                features: candidate?.features || {},
                providerConfigured: candidate?.providerConfigured || candidate?.providers || {}
            };
        });
        const requested = String(source.selectedMode || source.selected_mode || "local").toLowerCase();
        return { selectedMode: modes.some((item) => item.mode === requested && item.available) ? requested : "local", modes };
    }

    async function loadGuestCapabilities() {
        if (state.guestCapabilities) {
            renderGuestCapabilities();
            return state.guestCapabilities;
        }
        if (state.guestCapabilitiesPromise) return state.guestCapabilitiesPromise;
        const status = document.querySelector("[data-guest-capability-status]");
        if (status) status.textContent = "게스트 모드 제공 상태를 확인하고 있습니다.";
        state.guestCapabilitiesPromise = Common.api.get("/api/auth/guest/capabilities")
            .then((payload) => normalizeGuestCapabilities(payload))
            .catch((error) => fallbackGuestCapabilities(error.message))
            .then((capabilities) => {
                state.guestCapabilities = capabilities;
                renderGuestCapabilities(true);
                return capabilities;
            })
            .finally(() => { state.guestCapabilitiesPromise = null; });
        return state.guestCapabilitiesPromise;
    }

    function guestMode(mode) {
        return state.guestCapabilities?.modes?.find((item) => item.mode === mode)
            || fallbackGuestCapabilities().modes.find((item) => item.mode === mode);
    }

    function limitSummary(mode) {
        const limits = mode?.limits || {};
        const values = [
            [limits.maxProjects ?? limits.max_projects, "프로젝트"],
            [limits.maxQuestionsPerSurvey ?? limits.max_questions_per_survey, "문항/설문"],
            [limits.maxResponsesPerSurvey ?? limits.max_responses_per_survey, "응답/설문"]
        ].filter(([value]) => Number.isFinite(Number(value)));
        return values.length ? values.map(([value, label]) => `${label} ${Common.formatNumber(value)}`).join(" · ") : "";
    }

    function renderGuestCapabilities(selectRecommended = false) {
        const picker = document.querySelector("[data-guest-mode-picker]");
        if (!picker) return;
        const capabilities = state.guestCapabilities || fallbackGuestCapabilities();
        capabilities.modes.forEach((mode) => {
            const card = picker.querySelector(`[data-guest-mode-card="${mode.mode}"]`);
            const input = card?.querySelector("input");
            const reason = card?.querySelector(`[data-guest-mode-reason="${mode.mode}"]`);
            if (!card || !input || !reason) return;
            input.disabled = !mode.available;
            card.classList.toggle("is-disabled", !mode.available);
            card.classList.toggle("is-selected", input.checked && mode.available);
            const limits = limitSummary(mode);
            const providerLabels = { email: "이메일", sms: "문자", kakao: "카카오" };
            const providers = Object.entries(mode.providerConfigured || {}).filter(([, configured]) => configured).map(([code]) => providerLabels[code] || code);
            const providerSummary = mode.mode === "database" && providers.length ? `설정 감지 provider(전송 adapter 별도): ${providers.join(", ")}` : "";
            reason.textContent = [mode.reason, limits, providerSummary].filter(Boolean).join(" · ") || (mode.available ? "현재 사용할 수 있습니다." : "현재 사용할 수 없습니다.");
        });
        if (selectRecommended) {
            const recommended = capabilities.modes.find((item) => item.mode === capabilities.selectedMode && item.available)
                || capabilities.modes.find((item) => item.available);
            const selected = recommended && picker.querySelector(`input[value="${CSS.escape(recommended.mode)}"]`);
            if (selected) selected.checked = true;
        }
        const checked = picker.querySelector('input[name="guestMode"]:checked:not(:disabled)');
        if (!checked) picker.querySelector('input[name="guestMode"]:not(:disabled)')?.click();
        capabilities.modes.forEach((mode) => {
            const card = picker.querySelector(`[data-guest-mode-card="${mode.mode}"]`);
            const input = card?.querySelector("input");
            card?.classList.toggle("is-selected", Boolean(input?.checked && !input.disabled));
        });
        const database = capabilities.modes.find((item) => item.mode === "database");
        const status = document.querySelector("[data-guest-capability-status]");
        if (status) status.textContent = database?.available
            ? "두 체험 모드를 사용할 수 있습니다. 외부 발송은 provider 설정 상태를 따릅니다."
            : `로컬 체험을 사용할 수 있습니다. DB 저장 체험: ${database?.reason || "현재 사용할 수 없습니다."}`;
    }

    function setAuthBusy(busy, message, error = false) {
        dom.authDialog.querySelectorAll("button, input").forEach((element) => { if (!element.closest(".dialog-close-row")) element.disabled = busy; });
        if (!busy) renderGuestCapabilities();
        dom.authMessage.textContent = message || "";
        dom.authMessage.classList.toggle("is-error", error);
    }

    function toast(message, tone = "info") {
        const region = document.querySelector("[data-toast-region]");
        const element = document.createElement("div");
        element.className = `toast toast-${tone}`;
        element.innerHTML = `${Common.icon(tone === "success" ? "check" : "info", 18)}<span>${Common.escapeHtml(message)}</span>`;
        region.appendChild(element);
        setTimeout(() => element.classList.add("is-visible"), 10);
        setTimeout(() => { element.classList.remove("is-visible"); setTimeout(() => element.remove(), 220); }, 3600);
    }

    function openModal(content, options = {}) {
        state.modalReturnFocus = document.activeElement;
        dom.modalBody.innerHTML = content;
        dom.modal.classList.toggle("modal-wide", Boolean(options.wide));
        dom.modal.setAttribute("aria-label", options.label || "안내");
        if (!dom.modal.open) dom.modal.showModal();
        requestAnimationFrame(() => {
            const target = options.initialFocus ? dom.modal.querySelector(options.initialFocus) : dom.modal.querySelector("[autofocus]");
            target?.focus({ preventScroll: true });
        });
        return dom.modal;
    }

    function staticHelp() {
        return window.HELP_CONFIG?.[state.route] || {
            title: "IN-SURVEYONE 작성 도움말",
            summary: "설문을 만들고 배포한 뒤 응답과 보고서를 확인하는 통합 작업공간입니다.",
            steps: [{ title: "메뉴 선택", text: "왼쪽 메뉴에서 필요한 작업 화면을 선택하세요." }],
            tip: "각 화면의 작성 도움말은 현재 작업에 맞는 안내를 제공합니다."
        };
    }

    function normalizedGuide(value) {
        if (typeof value !== "string") return value;
        try { return JSON.parse(value); } catch { return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean); }
    }

    function normalizeHelp(payload, fallback) {
        const remote = payload?.data || payload || {};
        const guide = normalizedGuide(remote.guide ?? remote.guideJson ?? remote.guide_json);
        const candidates = Array.isArray(guide) ? guide : (guide?.steps || guide?.items || guide?.guide || []);
        const steps = (Array.isArray(candidates) ? candidates : []).map((item, index) => {
            if (typeof item === "string") return { title: `${index + 1}단계`, text: item };
            return {
                title: item?.title || item?.label || item?.name || `${index + 1}단계`,
                text: item?.text || item?.description || item?.body || item?.content || ""
            };
        }).filter((item) => item.title || item.text);
        return {
            title: remote.title || remote.helpTitle || fallback.title,
            summary: remote.body || remote.summary || remote.helpBody || fallback.summary,
            steps: steps.length ? steps : fallback.steps,
            tip: remote.tip || guide?.tip || guide?.notice || fallback.tip
        };
    }

    function helpMarkup(page) {
        const steps = page.steps.map((step) => `<li><strong>${Common.escapeHtml(step.title)}</strong><span>${Common.escapeHtml(step.text)}</span></li>`).join("");
        return `<p class="eyebrow">작성 도움말</p><h2 data-help-title tabindex="-1">${Common.escapeHtml(page.title)}</h2><p class="help-summary">${Common.escapeHtml(page.summary)}</p><ol class="help-steps">${steps}</ol><aside class="help-tip" role="note"><strong>확인하세요</strong><span>${Common.escapeHtml(page.tip)}</span></aside>`;
    }

    async function showHelp() {
        const fallback = staticHelp();
        const locale = String(document.documentElement.lang || navigator.language || "ko").split(/[-_]/)[0];
        openModal(`<div class="page-loading help-loading" role="status"><span class="spinner"></span><strong>작성 도움말을 불러오고 있습니다.</strong></div>`, { label: fallback.title });
        let page = fallback;
        try {
            const payload = await Common.api.get(`/api/help/${encodeURIComponent(state.route || "M01001")}?lang=${encodeURIComponent(locale)}`);
            page = normalizeHelp(payload, fallback);
        } catch {
            page = fallback;
        }
        if (!dom.modal.open) return;
        dom.modalBody.innerHTML = helpMarkup(page);
        dom.modal.setAttribute("aria-label", page.title);
        requestAnimationFrame(() => dom.modal.querySelector("[data-help-title]")?.focus({ preventScroll: true }));
    }

    function loadingMarkup(label) {
        return `<div class="page-loading" role="status"><span class="spinner"></span><strong>${Common.escapeHtml(label)}</strong><p>작업공간을 준비하고 있습니다.</p></div>`;
    }

    function errorMarkup(message) {
        return `<section class="empty-state error-state"><span class="empty-icon">!</span><h2>화면을 불러오지 못했습니다</h2><p>${Common.escapeHtml(message)}</p><button class="button button-primary" type="button" data-route-retry>다시 시도</button></section>`;
    }

    window.Pages = window.Pages || {};
    window.SurveyOneApp = { navigate, queryParams, toast, openModal, get user() { return state.user; } };
})();
