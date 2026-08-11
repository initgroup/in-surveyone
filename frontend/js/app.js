(function () {
    "use strict";

    const configuredAssetVersion = String(window.SURVEYONE_CONFIG?.assetVersion || "1");
    const localDevelopmentHost = ["127.0.0.1", "localhost"].includes(window.location?.hostname || "");
    const runtimeAssetVersion = localDevelopmentHost
        ? `${configuredAssetVersion}-${Date.now()}`
        : configuredAssetVersion;

    function versionedAsset(src) {
        const url = new URL(src, document.baseURI);
        if (url.origin === window.location.origin && url.pathname.startsWith("/frontend/")) {
            url.searchParams.set("v", runtimeAssetVersion);
        }
        return url.href;
    }

    const state = {
        user: null,
        route: null,
        currentPage: null,
        loadedScripts: new Set(),
        activeStyle: null,
        routeGeneration: 0,
        routeController: null,
        routeTask: null,
        guestCapabilities: null,
        guestCapabilitiesPromise: null,
        issuedGuest: null,
        sessionInvalidHandling: false,
        modalReturnFocus: null
    };

    const dom = {};

    document.addEventListener("DOMContentLoaded", init);

    async function init() {
        cacheDom();
        renderNavigation();
        bindShellEvents();
        await restoreSession();
        window.addEventListener("hashchange", route);
        await route();
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
        dom.guestRequest = document.querySelector("[data-guest-request-view]");
        dom.guestCredentials = document.querySelector("[data-guest-credentials]");
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
        window.addEventListener("surveyone:session-invalid", handleInvalidSession);
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
            if (["guest", "login", "signup"].includes(authAction)) openAuth(authAction);
        });

        document.querySelector("[data-quick-create]").addEventListener("click", () => {
            if (state.user) navigate("M02002"); else openAuth("guest");
        });
        document.querySelector("[data-help-button]").addEventListener("click", () => void showHelp());
        document.querySelector("[data-guest-start]").addEventListener("click", startGuest);
        document.querySelector("[data-guest-login]").addEventListener("click", showIssuedGuestLogin);
        dom.guestCredentials.addEventListener("click", (event) => {
            const copy = event.target.closest("[data-copy-guest-credential]");
            if (copy) void copyIssuedGuestCredential(copy.dataset.copyGuestCredential);
        });
        document.querySelectorAll("[data-auth-tab]").forEach((tab) => tab.addEventListener("click", () => selectAuthTab(tab.dataset.authTab)));
        document.querySelector("[data-login-form]").addEventListener("submit", submitLogin);
        document.querySelector("[data-signup-form]").addEventListener("submit", submitSignup);
        dom.modal.addEventListener("close", () => {
            const target = state.modalReturnFocus;
            state.modalReturnFocus = null;
            if (target?.isConnected) target.focus({ preventScroll: true });
        });
        dom.authDialog.addEventListener("close", clearIssuedGuest);
    }

    function handleInvalidSession() {
        if (state.sessionInvalidHandling) return;
        state.sessionInvalidHandling = true;
        const hadUser = Boolean(state.user);
        state.user = null;
        state.routeController?.abort();
        updateUserUi();
        dom.userMenu.hidden = true;
        dom.userButton.setAttribute("aria-expanded", "false");

        if (hadUser) {
            toast("로그인 세션이 만료되어 안전하게 로그아웃했습니다. 다시 로그인해 주세요.", "error");
        }

        void (async () => {
            try {
                await fetch(`${window.SURVEYONE_CONFIG.apiBaseUrl}/api/auth/logout`, {
                    method: "POST",
                    headers: { Accept: "application/json" },
                    credentials: "same-origin"
                });
            } catch (error) {
                console.warn("만료된 세션 쿠키를 서버에서 정리하지 못했습니다.", error);
            }
            try {
                if (hadUser) {
                    history.replaceState(null, "", "#/M01001");
                    await route();
                    openAuth("login");
                }
            } finally {
                state.sessionInvalidHandling = false;
            }
        })();
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

    function route() {
        const requestedCode = routeCode();
        const generation = state.routeGeneration + 1;
        state.routeGeneration = generation;
        state.routeController?.abort();
        const controller = new AbortController();
        state.routeController = controller;
        const previousTask = state.routeTask;
        const task = (async () => {
            if (previousTask) {
                try { await previousTask; } catch (error) { if (!isAbortError(error)) console.warn("이전 화면 정리를 완료하지 못했습니다.", error); }
            }
            if (!isCurrentRoute(generation, controller)) return;
            await performRoute(requestedCode, generation, controller);
        })();
        state.routeTask = task;
        const clearTask = () => { if (state.routeTask === task) state.routeTask = null; };
        task.then(clearTask, clearTask);
        return task;
    }

    async function performRoute(requestedCode, generation, controller) {
        let code = requestedCode;
        if (!state.user && code !== "M01001") {
            code = "M01001";
            history.replaceState(null, "", "#/M01001");
            toast("둘러보기에서는 메인 대시보드를 볼 수 있습니다. 설문 작업은 메인에서 시작 방식을 선택해 주세요.");
        }
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
        const routeRoot = document.createElement("div");
        routeRoot.className = "route-view";
        routeRoot.dataset.routeGeneration = String(generation);
        routeRoot.innerHTML = loadingMarkup(page.label);
        dom.pageHost.replaceChildren(routeRoot);

        let candidatePage = null;
        let candidateStyle = null;
        try {
            const previousPage = state.currentPage;
            state.currentPage = null;
            await destroyPage(previousPage);
            assertCurrentRoute(generation, controller);

            candidateStyle = await loadPageStyle(page.style, { signal: controller.signal });
            assertCurrentRoute(generation, controller);
            activatePageStyle(candidateStyle);
            candidateStyle = null;

            const response = await fetch(page.html, { cache: "no-store", signal: controller.signal });
            assertCurrentRoute(generation, controller);
            if (!response.ok) throw new Error(`화면 파일을 불러오지 못했습니다. (${response.status})`);
            const markup = await response.text();
            assertCurrentRoute(generation, controller);
            routeRoot.innerHTML = markup;

            await loadScript(page.script, { signal: controller.signal });
            assertCurrentRoute(generation, controller);
            const pageDefinition = window.Pages?.[code] || null;
            candidatePage = pageDefinition ? Object.create(pageDefinition) : null;
            if (candidatePage?.init) {
                const routeApi = createRouteApi(controller.signal);
                const active = () => isCurrentRoute(generation, controller);
                await candidatePage.init({
                    root: routeRoot,
                    api: routeApi,
                    signal: controller.signal,
                    routeGeneration: generation,
                    isCurrentRoute: active,
                    toast: (...args) => { if (active()) return toast(...args); },
                    navigate: (...args) => { if (active()) return navigate(...args); },
                    openModal: (...args) => { if (active()) return openModal(...args); },
                    openAuth: (...args) => { if (active()) return openAuth(...args); },
                    loadGuestCapabilities: (...args) => active() ? loadGuestCapabilities(...args) : Promise.reject(abortError()),
                    user: state.user,
                    appState: state
                });
            }
            assertCurrentRoute(generation, controller);
            state.currentPage = candidatePage;
            candidatePage = null;
            dom.pageHost.focus({ preventScroll: true });
        } catch (error) {
            await destroyPage(candidatePage);
            discardPageStyle(candidateStyle);
            if (!isCurrentRoute(generation, controller) || isAbortError(error)) return;
            console.error(error);
            routeRoot.innerHTML = errorMarkup(error.message);
            routeRoot.querySelector("[data-route-retry]")?.addEventListener("click", route);
        }
    }

    function isCurrentRoute(generation, controller) {
        return state.routeGeneration === generation && state.routeController === controller && !controller.signal.aborted;
    }

    function abortError() {
        const error = new Error("화면 전환이 취소되었습니다.");
        error.name = "AbortError";
        return error;
    }

    function isAbortError(error) {
        return error?.name === "AbortError";
    }

    function assertCurrentRoute(generation, controller) {
        if (!isCurrentRoute(generation, controller)) throw abortError();
    }

    async function destroyPage(page) {
        if (!page?.destroy) return;
        try { await page.destroy(); } catch (error) { console.warn("화면 정리 중 오류가 발생했습니다.", error); }
    }

    function createRouteApi(signal) {
        const request = (path, options = {}) => Common.request(path, { ...options, signal });
        return {
            get(path, options = {}) { return request(path, options); },
            post(path, body, options = {}) { return request(path, { ...options, method: "POST", body }); },
            put(path, body, options = {}) { return request(path, { ...options, method: "PUT", body }); },
            patch(path, body, options = {}) { return request(path, { ...options, method: "PATCH", body }); },
            delete(path, options = {}) { return request(path, { ...options, method: "DELETE" }); }
        };
    }

    function loadScript(src, { signal } = {}) {
        if (signal?.aborted) return Promise.reject(abortError());
        if (state.loadedScripts.has(src)) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const script = document.createElement("script");
            let settled = false;
            const finish = (error = null) => {
                if (settled) return;
                settled = true;
                signal?.removeEventListener("abort", onAbort);
                script.onload = null;
                script.onerror = null;
                if (error) reject(error); else resolve();
            };
            const onAbort = () => {
                script.remove();
                finish(abortError());
            };
            script.src = versionedAsset(src);
            script.onload = () => {
                if (signal?.aborted) return onAbort();
                state.loadedScripts.add(src);
                finish();
            };
            script.onerror = () => {
                script.remove();
                finish(new Error(`${src} 스크립트를 불러오지 못했습니다.`));
            };
            signal?.addEventListener("abort", onAbort, { once: true });
            document.body.appendChild(script);
        });
    }

    function loadPageStyle(href, { signal } = {}) {
        if (!href) return Promise.resolve(null);
        if (signal?.aborted) return Promise.reject(abortError());
        const absoluteHref = versionedAsset(href);
        if (state.activeStyle?.isConnected && state.activeStyle.href === absoluteHref) {
            return Promise.resolve({ link: state.activeStyle, reused: true, activated: true });
        }
        return new Promise((resolve, reject) => {
            const link = document.createElement("link");
            const candidate = { link, reused: false, activated: false };
            let settled = false;
            const finish = (value, error = null) => {
                if (settled) return;
                settled = true;
                signal?.removeEventListener("abort", onAbort);
                link.onload = null;
                link.onerror = null;
                if (error) reject(error); else resolve(value);
            };
            const onAbort = () => {
                link.remove();
                finish(null, abortError());
            };
            link.rel = "stylesheet";
            link.href = absoluteHref;
            link.dataset.pageStyle = "";
            link.onload = () => signal?.aborted ? onAbort() : finish(candidate);
            link.onerror = () => {
                link.remove();
                finish(null);
            };
            signal?.addEventListener("abort", onAbort, { once: true });
            document.head.appendChild(link);
        });
    }

    function activatePageStyle(candidate) {
        if (!candidate || candidate.reused || candidate.activated) return;
        const previousStyle = state.activeStyle;
        candidate.activated = true;
        state.activeStyle = candidate.link;
        if (previousStyle && previousStyle !== candidate.link) previousStyle.remove();
    }

    function discardPageStyle(candidate) {
        if (candidate && !candidate.reused && !candidate.activated) candidate.link.remove();
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
            return false;
        }
    }

    async function startGuest() {
        const capability = databaseGuestCapability();
        if (!capability?.available) {
            setAuthBusy(false, capability?.reason || "게스트 계정을 현재 발급할 수 없습니다.", true);
            return;
        }
        setAuthBusy(true, "게스트 계정을 발급하고 있습니다.");
        try {
            const payload = await Common.api.post("/api/auth/guest", { mode: "database" });
            const issued = normalizeIssuedGuest(payload);
            if (!issued.loginId || !issued.initialPassword) {
                throw new Error("계정은 발급되었지만 일회용 자격정보를 확인하지 못했습니다. 새로고침하지 말고 관리자에게 문의해 주세요.");
            }
            state.issuedGuest = issued;
            setAuthBusy(false, "");
            renderIssuedGuest();
        } catch (error) {
            const message = error?.message || "게스트 계정을 현재 발급할 수 없습니다.";
            const status = Number(error?.status);
            if (!Number.isFinite(status) || status >= 500) {
                state.guestCapabilities = fallbackGuestCapabilities(message);
            }
            setAuthBusy(false, message, true);
        }
    }

    function normalizeIssuedGuest(payload) {
        const source = payload?.data || payload || {};
        const session = source.session?.data || source.session || source.authSession || source.auth_session || source;
        const credential = source.guestCredential || source.guest_credential || source.credentials || source.credential || source.accountCredential || source.account_credential || {};
        const pick = (...values) => values.find((value) => value !== undefined && value !== null && String(value) !== "");
        return {
            loginId: String(pick(credential.loginId, credential.login_id, source.loginId, source.login_id, session?.user?.loginId, session?.user?.login_id) || ""),
            initialPassword: String(pick(credential.initialPassword, credential.initial_password, credential.temporaryPassword, credential.temporary_password, credential.password, source.initialPassword, source.initial_password) || ""),
            expiresAt: pick(credential.expiresAt, credential.expires_at, session?.expiresAt, session?.expires_at, source.expiresAt, source.expires_at) || null
        };
    }

    function renderIssuedGuest() {
        const issued = state.issuedGuest;
        if (!issued) return;
        dom.guestRequest.hidden = true;
        dom.guestCredentials.hidden = false;
        dom.guestCredentials.querySelector("[data-guest-login-id]").textContent = issued.loginId;
        dom.guestCredentials.querySelector("[data-guest-initial-password]").textContent = issued.initialPassword;
        dom.guestCredentials.querySelector("[data-guest-expires-at]").textContent = formatGuestExpiry(issued.expiresAt);
        dom.authMessage.textContent = "자격정보를 먼저 복사한 뒤 로그인 화면에서 게스트 계정으로 로그인해 주세요.";
        dom.authMessage.classList.remove("is-error");
        requestAnimationFrame(() => dom.guestCredentials.querySelector("[data-guest-credential-title]")?.focus({ preventScroll: true }));
    }

    function formatGuestExpiry(value) {
        if (!value) return "서버에 설정된 게스트 유효기간까지";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        try {
            return new Intl.DateTimeFormat("ko-KR", { dateStyle: "long", timeStyle: "short" }).format(date);
        } catch {
            return String(value);
        }
    }

    async function copyIssuedGuestCredential(field) {
        const issued = state.issuedGuest;
        if (!issued) return;
        const values = {
            loginId: issued.loginId,
            initialPassword: issued.initialPassword,
            all: `IN-SURVEYONE 게스트 계정\n아이디: ${issued.loginId}\n초기 비밀번호: ${issued.initialPassword}\n유효기간: ${formatGuestExpiry(issued.expiresAt)}`
        };
        const value = values[field];
        if (!value) return;
        try {
            await navigator.clipboard.writeText(value);
            toast(field === "all" ? "자격정보를 모두 복사했습니다." : "자격정보를 복사했습니다.", "success");
        } catch {
            toast("브라우저에서 복사를 허용하지 않았습니다. 값을 직접 선택해 복사해 주세요.", "error");
        }
    }

    function showIssuedGuestLogin() {
        const issued = state.issuedGuest;
        if (!issued) return;
        const form = document.querySelector("[data-login-form]");
        form.elements.loginId.value = issued.loginId;
        form.elements.password.value = issued.initialPassword;
        clearIssuedGuest({ preserveLoginForm: true });
        selectAuthTab("login");
        dom.authMessage.textContent = "발급된 게스트 계정 자격정보를 입력했습니다. 로그인 버튼을 눌러 계속하세요.";
        dom.authMessage.classList.remove("is-error");
        form.elements.password.focus({ preventScroll: true });
    }

    function clearIssuedGuest({ preserveLoginForm = false } = {}) {
        const loginForm = document.querySelector("[data-login-form]");
        if (!preserveLoginForm) loginForm.reset();
        state.issuedGuest = null;
        dom.guestRequest.hidden = false;
        dom.guestCredentials.hidden = true;
        dom.guestCredentials.querySelector("[data-guest-login-id]").textContent = "";
        dom.guestCredentials.querySelector("[data-guest-initial-password]").textContent = "";
        dom.guestCredentials.querySelector("[data-guest-expires-at]").textContent = "";
    }

    async function submitLogin(event) {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(event.currentTarget));
        setAuthBusy(true, "로그인 중입니다.");
        try {
            const payload = await Common.api.post("/api/auth/login", data);
            state.user = payload.user || payload;
            updateUserUi();
            setAuthBusy(false, "");
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
            setAuthBusy(false, "");
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
        toast("로그아웃했습니다. 메인 대시보드를 계속 둘러볼 수 있습니다.", "success");
        await route();
    }

    function updateUserUi() {
        const user = state.user;
        const name = user?.name || user?.displayName || "방문자";
        const tenant = String(user?.organizationName || user?.tenantName || "IN-SURVEYONE")
            .replace(/^DB\s*게스트\s*/i, "게스트 ");
        const guest = Boolean(user && (user.isGuest ?? user.role === "guest"));
        document.querySelector("[data-user-name]").textContent = name;
        document.querySelector("[data-user-role]").textContent = !user ? "둘러보기" : (guest ? "게스트 계정" : (user.roleLabel || "설문 관리자"));
        document.querySelector("[data-user-avatar]").textContent = name.trim().charAt(0).toUpperCase() || "G";
        document.querySelector("[data-tenant-name]").textContent = tenant;
        document.querySelector("[data-save-state]").innerHTML = user
            ? '<i aria-hidden="true"></i> 모든 변경사항 저장됨'
            : '<i aria-hidden="true"></i> 읽기 전용 둘러보기';
        document.querySelector("[data-quick-create]").innerHTML = user
            ? '<span aria-hidden="true">＋</span> 새 설문'
            : '<span aria-hidden="true">＋</span> 체험 시작';
        document.querySelector("[data-guest-upgrade]").hidden = Boolean(user && !guest);
        document.querySelectorAll('[data-auth-action="logout"]').forEach((button) => { button.hidden = !user; });
        document.querySelectorAll('[data-auth-action="login"], [data-auth-action="signup"]').forEach((button) => { button.hidden = Boolean(user && !guest); });
    }

    function openAuth(mode = "guest") {
        clearIssuedGuest();
        setAuthBusy(false, "");
        selectAuthTab(mode);
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
        const titles = { guest: "게스트 체험 계정 발급", login: "작업공간으로 돌아오기", signup: "기관 설문 작업공간 만들기" };
        const intros = {
            guest: "만료형 게스트 계정을 발급받아 안전하게 분리된 작업공간에서 제품 흐름을 체험할 수 있습니다.",
            login: "회원 아이디 또는 발급받은 게스트 계정으로 로그인하세요.",
            signup: "기관 전용 설문 작업공간을 만들고 지속적으로 운영하세요."
        };
        document.querySelector("[data-auth-title]").textContent = titles[mode];
        document.querySelector("[data-auth-intro]").textContent = intros[mode];
        if (mode === "guest") void loadGuestCapabilities();
    }

    function fallbackGuestCapabilities(reason = "게스트 계정 제공 상태를 확인하지 못했습니다.") {
        return {
            selectedMode: "database",
            modes: [
                {
                    mode: "database",
                    title: "게스트 계정",
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
            : [source.database, source.mode === "database" ? source : null].filter(Boolean);
        const fallback = fallbackGuestCapabilities();
        const candidate = rawModes.find((item) => String(item?.mode || item?.code || "").toLowerCase() === "database")
            || rawModes[0]
            || fallback.modes[0];
        return {
            selectedMode: "database",
            modes: [{
                ...candidate,
                mode: "database",
                title: candidate?.title || "게스트 계정",
                available: Boolean(candidate?.available),
                limits: candidate?.limits || {},
                features: candidate?.features || {},
                providerConfigured: candidate?.providerConfigured || candidate?.provider_configured || candidate?.providers || {}
            }]
        };
    }

    async function loadGuestCapabilities() {
        const cachedDatabase = state.guestCapabilities?.modes?.find((item) => item.mode === "database");
        if (cachedDatabase?.available) {
            renderGuestCapabilities();
            return state.guestCapabilities;
        }
        if (state.guestCapabilitiesPromise) return state.guestCapabilitiesPromise;
        const status = document.querySelector("[data-guest-capability-status]");
        if (status) status.textContent = "게스트 계정 발급 상태를 확인하고 있습니다.";
        state.guestCapabilitiesPromise = Common.api.get("/api/auth/guest/capabilities?mode=database")
            .then((payload) => normalizeGuestCapabilities(payload))
            .catch((error) => fallbackGuestCapabilities(error.message))
            .then((capabilities) => {
                state.guestCapabilities = capabilities;
                renderGuestCapabilities();
                return capabilities;
            })
            .finally(() => { state.guestCapabilitiesPromise = null; });
        return state.guestCapabilitiesPromise;
    }

    function databaseGuestCapability() {
        return state.guestCapabilities?.modes?.find((item) => item.mode === "database")
            || fallbackGuestCapabilities().modes[0];
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

    function renderGuestCapabilities() {
        const capabilities = state.guestCapabilities || fallbackGuestCapabilities();
        const database = capabilities.modes.find((item) => item.mode === "database");
        const card = document.querySelector("[data-guest-issue-card]");
        const reason = document.querySelector("[data-guest-account-reason]");
        const button = document.querySelector("[data-guest-start]");
        const available = Boolean(database?.available);
        card?.classList.toggle("is-disabled", !available);
        if (button) button.disabled = !available;
        const limits = limitSummary(database);
        const expiryHours = database?.expiresInHours ?? database?.expires_in_hours;
        const expirySummary = Number.isFinite(Number(expiryHours)) ? `발급 후 ${Common.formatNumber(expiryHours)}시간 유효` : "";
        if (reason) reason.textContent = [database?.reason, expirySummary, limits].filter(Boolean).join(" · ")
            || (available ? "현재 발급할 수 있습니다." : "현재 발급할 수 없습니다.");
        const status = document.querySelector("[data-guest-capability-status]");
        if (status) status.textContent = available
            ? "게스트 계정을 발급할 수 있습니다. 외부 발송 기능은 제공자 설정 상태를 따릅니다."
            : `게스트 계정을 현재 발급할 수 없습니다. ${database?.reason || "서비스 저장소 연결 상태를 확인해 주세요."}`;
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
