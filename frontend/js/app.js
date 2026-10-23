(function () {
    "use strict";

    const configuredAssetVersion = String(window.SURVEYONE_CONFIG?.assetVersion || "1");
    const localDevelopmentHost = ["127.0.0.1", "localhost"].includes(window.location?.hostname || "");
    const runtimeAssetVersion = localDevelopmentHost
        ? `${configuredAssetVersion}-${Date.now()}`
        : configuredAssetVersion;
    const DESKTOP_SIDEBAR_QUERY = "(min-width: 72.01rem)";

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
        routeLoading: null,
        routeFailure: null,
        bootstrapError: null,
        startupRetrying: false,
        leaveTask: null,
        pendingHash: "",
        activeHash: "",
        refreshing: false,
        sessionInvalidHandling: false,
        sessionExpiresAt: null,
        sessionTimer: null,
        sessionExtending: false,
        sidebarCollapsed: false,
        modalReturnFocus: null,
        modalDrag: null,
        modalOffsetX: 0,
        modalOffsetY: 0,
        messageQueue: [],
        activeMessage: null,
        messageReturnFocus: null,
        messageDrag: null,
        messageOffsetX: 0,
        messageOffsetY: 0
    };

    const dom = {};
    let versionRequest = null;
    let versionCheckedAt = 0;

    document.addEventListener("DOMContentLoaded", init);

    async function init() {
        Common.preferences.apply(Common.preferences.read());
        cacheDom();
        void loadApplicationVersion();
        window.addEventListener("focus", () => { void loadApplicationVersion(); });
        document.addEventListener("visibilitychange", () => { if (!document.hidden) void loadApplicationVersion(); });
        syncSidebarForViewport();
        renderNavigation();
        bindShellEvents();
        dom.pageHost.innerHTML = loadingMarkup("서비스 연결 확인");
        await restoreSession();
        window.addEventListener("hashchange", route);
        if (state.bootstrapError) { showStartupFailure(); return; }
        await route();
    }

    function cacheDom() {
        dom.applicationVersion = document.querySelector("[data-application-version]");
        dom.navigation = document.querySelector("[data-navigation]");
        dom.mobileNav = document.querySelector("[data-mobile-nav]");
        dom.sidebar = document.querySelector("[data-sidebar]");
        dom.scrim = document.querySelector("[data-sidebar-scrim]");
        dom.menuToggle = document.querySelector("[data-menu-toggle]");
        dom.pageHost = document.querySelector("#pageHost");
        dom.pageTitle = document.querySelector("[data-page-title]");
        dom.pageGroup = document.querySelector("[data-page-group]");
        dom.pageGroupLink = document.querySelector("[data-page-group-link]");
        dom.pageRefresh = document.querySelector("[data-page-refresh]");
        dom.sessionStatus = document.querySelector("[data-session-status]");
        dom.sessionRemaining = document.querySelector("[data-session-remaining]");
        dom.sessionExtend = document.querySelector("[data-session-extend]");
        dom.userButton = document.querySelector("[data-user-button]");
        dom.userMenu = document.querySelector("[data-user-menu]");
        dom.authDialog = document.querySelector("[data-auth-dialog]");
        dom.authMessage = document.querySelector("[data-auth-message]");
        dom.modal = document.querySelector("[data-modal]");
        dom.modalBody = document.querySelector("[data-modal-body]");
        dom.modalDragTitle = document.querySelector("[data-modal-drag-title]");
        dom.messageDialog = document.querySelector("[data-message-dialog]");
        dom.messageTitle = document.querySelector("[data-message-title]");
        dom.messageText = document.querySelector("[data-message-text]");
        dom.messageToneIcon = document.querySelector("[data-message-tone-icon]");
        dom.messageCopy = document.querySelector("[data-message-copy]");
        dom.messageCancel = document.querySelector("[data-message-cancel]");
        dom.messageConfirm = document.querySelector("[data-message-confirm]");
        dom.toastRegion = document.querySelector("[data-toast-region]");
    }

    function loadApplicationVersion() {
        const badge = dom.applicationVersion;
        if (!badge) return Promise.resolve();
        if (versionRequest) return versionRequest;
        if (Date.now() - versionCheckedAt < 60000) return Promise.resolve();
        versionCheckedAt = Date.now();
        versionRequest = (async () => {
            try {
                const info = await Common.api.get("/api/version", { timeoutMs: 5000, silentFailure: true });
                const version = String(info?.version || "");
                if (!/^[0-9]{4}\.[0-9]{2}\.[0-9]{2}\.[1-9][0-9]{0,3}$/.test(version)) throw new Error("Invalid deployment version");
                const changed = version !== configuredAssetVersion;
                const label = `현재 배포 버전 v${version}. 화면 버전 v${configuredAssetVersion}.${changed ? " 새 버전이 배포되었습니다. 편집 내용을 저장한 뒤 브라우저를 새로고침하세요." : ""}`;
                badge.textContent = `${changed ? "↑ " : ""}v${version}`;
                badge.title = label;
                badge.setAttribute("aria-label", label);
                badge.classList.toggle("is-update-available", changed);
                badge.classList.remove("is-unavailable");
            } catch {
                badge.textContent = "버전 확인 불가";
                badge.title = "서버의 배포 버전을 확인하지 못했습니다. 창을 다시 활성화하면 1분 간격으로 재확인합니다. 브라우저를 새로고침해도 다시 확인할 수 있습니다.";
                badge.setAttribute("aria-label", badge.title);
                badge.classList.remove("is-update-available");
                badge.classList.add("is-unavailable");
            } finally { versionRequest = null; }
        })();
        return versionRequest;
    }

    function renderNavigation() {
        const groups = window.MENU_CONFIG
            .filter((group) => canAccessMenu(group))
            .map((group) => ({ ...group, visibleItems: group.items.filter((item) => !item.hidden && canAccessMenu(item)) }))
            .filter((group) => group.visibleItems.length);
        dom.navigation.innerHTML = groups.map((group) => `
            <section class="nav-group" data-nav-group="${group.code}">
                <button class="nav-group-label" type="button" aria-expanded="true">
                    <span>${Common.icon(group.icon, 18)} ${group.label}</span><i aria-hidden="true">⌄</i>
                </button>
                <div class="nav-group-items">
                    ${group.visibleItems.map((item) => `<a href="#/${item.code}" data-route-link="${item.code}" title="${item.description}">${item.label}</a>`).join("")}
                </div>
            </section>
        `).join("");

        const quickCodes = ["M01001", "M02001", "M03001", "M04001", "M05001"];
        dom.mobileNav.innerHTML = quickCodes.map((code) => {
            const page = window.PAGE_CONFIG[code];
            const group = window.MENU_CONFIG.find((candidate) => candidate.code === page.groupCode);
            return `<a href="#/${code}" data-route-link="${code}">${Common.icon(group.icon, 19)}<span>${shortMobileLabel(code, page.label)}</span></a>`;
        }).join("");
    }

    function canAccessMenu(item, user = state.user) {
        const roles = Array.isArray(item?.roles) ? item.roles.map((role) => String(role).toUpperCase()) : [];
        if (!roles.length) return true;
        return roles.some((role) => role === "SYSTEM_ADMIN"
            ? Boolean(user?.systemAdmin)
            : role === String(user?.role || "").toUpperCase());
    }

    function shortMobileLabel(code, label) {
        return ({ M01001: "홈", M02001: "설문", M03001: "배포", M04001: "응답", M05001: "분석" })[code] || label;
    }

    function bindShellEvents() {
        window.addEventListener("beforeunload", (event) => {
            if (!state.currentPage?.hasUnsavedChanges?.()) return;
            event.preventDefault();
            event.returnValue = "";
        });
        window.addEventListener("surveyone:session-invalid", handleInvalidSession);
        window.addEventListener("surveyone:session-refreshed", handleSessionRefreshed);
        dom.menuToggle.addEventListener("click", toggleSidebar);
        dom.scrim.addEventListener("click", () => setSidebar(false));
        dom.navigation.addEventListener("click", (event) => {
            const button = event.target.closest(".nav-group-label");
            if (button) {
                const group = button.closest(".nav-group");
                const expanded = button.getAttribute("aria-expanded") === "true";
                button.setAttribute("aria-expanded", String(!expanded));
                group.classList.toggle("is-collapsed", expanded);
            }
            if (event.target.closest("[data-route-link]") && !isDesktopSidebar()) setSidebar(false);
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
            if (["login", "signup"].includes(authAction)) openAuth(authAction);
        });

        document.querySelector("[data-quick-create]").addEventListener("click", () => {
            if (state.user) navigate("M02001", { create: "1" }); else navigate("M01002");
        });
        document.querySelector("[data-help-button]").addEventListener("click", () => void showHelp());
        dom.pageRefresh.addEventListener("click", () => void refreshCurrentPage());
        dom.sessionExtend.addEventListener("click", () => void extendSession());
        window.addEventListener("surveyone:service-error", handleServiceFailure);
        document.querySelectorAll("[data-auth-tab]").forEach((tab) => tab.addEventListener("click", () => selectAuthTab(tab.dataset.authTab)));
        document.querySelector("[data-login-form]").addEventListener("submit", submitLogin);
        document.querySelector("[data-signup-form]").addEventListener("submit", submitSignup);
        document.querySelector("[data-signup-admin-toggle]").addEventListener("change", syncSignupAdminFields);
        syncSignupAdminFields();
        dom.modal.addEventListener("close", () => {
            // A queued close from the previous layer must not clear a newly opened layer.
            if (dom.modal.open) return;
            document.documentElement.classList.remove("app-modal-open");
            dom.modal.classList.remove("modal-template-library");
            dom.modal.classList.remove("modal-preview-simulator");
            dom.modal.classList.remove("modal-publication-links");
            resetModalPosition();
            const target = state.modalReturnFocus;
            state.modalReturnFocus = null;
            if (target?.isConnected) target.focus({ preventScroll: true });
            const scroll = state.modalScrollPosition;
            state.modalScrollPosition = null;
            if (scroll) window.scrollTo({ left: scroll.x, top: scroll.y, behavior: "instant" });
            dom.modalBody.replaceChildren();
            dom.modal.removeAttribute("aria-label");
        });
        dom.modal.addEventListener("pointerdown", startModalDrag);
        dom.modal.addEventListener("pointermove", moveModalDrag);
        dom.modal.addEventListener("pointerup", endModalDrag);
        dom.modal.addEventListener("pointercancel", endModalDrag);
        dom.modal.addEventListener("keydown", moveModalWithKeyboard);
        dom.messageDialog.addEventListener("close", closeMessageLayer);
        dom.messageDialog.addEventListener("pointerdown", startMessageDrag);
        dom.messageDialog.addEventListener("pointermove", moveMessageDrag);
        dom.messageDialog.addEventListener("pointerup", endMessageDrag);
        dom.messageDialog.addEventListener("pointercancel", endMessageDrag);
        dom.messageDialog.addEventListener("keydown", moveMessageWithKeyboard);
        dom.messageCopy.addEventListener("click", () => void copyActiveMessage());
        dom.toastRegion.addEventListener("click", (event) => void handleToastAction(event));
        window.addEventListener("resize", () => {
            syncSidebarForViewport();
            if (dom.modal.open) resetModalPosition();
            if (dom.messageDialog.open) resetMessagePosition();
        });
    }

    function handleInvalidSession() {
        if (!state.user) {
            clearSessionExpiry();
            return;
        }
        if (state.sessionInvalidHandling) return;
        state.sessionInvalidHandling = true;
        const hadUser = Boolean(state.user);
        state.user = null;
        clearSessionExpiry();
        state.routeController?.abort();
        updateUserUi();
        dom.userMenu.hidden = true;
        dom.userButton.setAttribute("aria-expanded", "false");

        void (async () => {
            try {
                if (hadUser) {
                    history.replaceState(null, "", "#/M01001");
                    await route();
                    openAuth("login");
                    setAuthMessage(
                        "로그인 세션이 만료되어 안전하게 로그아웃했습니다. 아이디와 비밀번호를 입력해 다시 로그인해 주세요.",
                        { error: true, focus: true }
                    );
                }
            } finally {
                state.sessionInvalidHandling = false;
            }
        })();
    }

    function isDesktopSidebar() {
        return window.matchMedia(DESKTOP_SIDEBAR_QUERY).matches;
    }

    function toggleSidebar() {
        const open = isDesktopSidebar()
            ? document.body.classList.contains("sidebar-collapsed")
            : !dom.sidebar.classList.contains("is-open");
        setSidebar(open);
    }

    function setSidebar(open) {
        if (isDesktopSidebar()) {
            state.sidebarCollapsed = !open;
            document.body.classList.toggle("sidebar-collapsed", !open);
            dom.sidebar.classList.remove("is-open");
            dom.scrim.hidden = true;
            document.body.classList.remove("has-sidebar-open");
        } else {
            document.body.classList.remove("sidebar-collapsed");
            dom.sidebar.classList.toggle("is-open", open);
            dom.scrim.hidden = !open;
            document.body.classList.toggle("has-sidebar-open", open);
        }
        dom.menuToggle.setAttribute("aria-expanded", String(open));
        dom.menuToggle.setAttribute("aria-label", open ? "메뉴 접기" : "메뉴 펼치기");
        dom.menuToggle.title = open ? "메뉴 접기" : "메뉴 펼치기";
    }

    function syncSidebarForViewport() {
        if (!dom.sidebar || !dom.menuToggle) return;
        if (!isDesktopSidebar()) {
            setSidebar(false);
            return;
        }
        setSidebar(!state.sidebarCollapsed);
    }

    function handleSessionRefreshed(event) {
        setSessionExpiry(event?.detail?.expiresAt);
    }

    function setSessionExpiry(value) {
        const expiresAt = Date.parse(String(value || ""));
        if (!Number.isFinite(expiresAt)) return;
        state.sessionExpiresAt = expiresAt;
        if (!state.sessionTimer) {
            state.sessionTimer = window.setInterval(renderSessionStatus, 1000);
        }
        renderSessionStatus();
    }

    function clearSessionExpiry() {
        state.sessionExpiresAt = null;
        if (state.sessionTimer) window.clearInterval(state.sessionTimer);
        state.sessionTimer = null;
        state.sessionExtending = false;
        if (dom.sessionStatus) {
            dom.sessionStatus.hidden = true;
            dom.sessionStatus.classList.remove("is-warning", "is-critical");
        }
        if (dom.sessionRemaining) dom.sessionRemaining.textContent = "--:--";
        if (dom.sessionExtend) dom.sessionExtend.disabled = false;
    }

    function formatSessionRemaining(milliseconds) {
        const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        return hours
            ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
            : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }

    function renderSessionStatus() {
        if (!dom.sessionStatus || !dom.sessionRemaining) return;
        const authenticated = Boolean(state.user && state.sessionExpiresAt);
        dom.sessionStatus.hidden = !authenticated;
        if (!authenticated) return;
        const remaining = state.sessionExpiresAt - Date.now();
        dom.sessionRemaining.textContent = remaining > 0 ? formatSessionRemaining(remaining) : "만료";
        dom.sessionStatus.classList.toggle("is-warning", remaining > 60_000 && remaining <= 600_000);
        dom.sessionStatus.classList.toggle("is-critical", remaining <= 60_000);
        dom.sessionStatus.setAttribute("aria-label", remaining > 0
            ? `로그인 세션 남은 시간 ${formatSessionRemaining(remaining)}`
            : "로그인 세션 만료");
        if (remaining <= 0 && !state.sessionInvalidHandling) {
            state.sessionExpiresAt = null;
            handleInvalidSession();
        }
    }

    async function extendSession() {
        if (!state.user || state.sessionExtending) return;
        state.sessionExtending = true;
        dom.sessionExtend.disabled = true;
        dom.sessionExtend.textContent = "연장 중";
        try {
            const session = await Common.api.post("/api/auth/extend", {});
            setSessionExpiry(session?.expiresAt || session?.expires_at);
            toast("로그인 세션을 연장했습니다.", "success");
        } catch (error) {
            if (!error.sessionInvalid) toast(`세션을 연장하지 못했습니다. ${error.message}`, "error");
        } finally {
            state.sessionExtending = false;
            dom.sessionExtend.disabled = false;
            dom.sessionExtend.textContent = "연장";
        }
    }

    function routeCode() {
        const code = location.hash.replace(/^#\/?/, "").split(/[?&]/)[0].toUpperCase();
        if (!code && state.user) return Common.preferences.read().startPage;
        return window.PAGE_CONFIG[code] ? code : window.SURVEYONE_CONFIG.defaultRoute;
    }

    function route(options = {}) {
        if (state.bootstrapError) { showStartupFailure(); return Promise.resolve(); }
        const refresh = options?.refresh === true;
        if (!refresh && !options?.leaveApproved && state.user && state.leaveTask) {
            state.pendingHash = location.hash;
            return state.leaveTask;
        }
        if (!refresh && !options?.leaveApproved && state.user && state.currentPage?.beforeLeave && location.hash !== state.activeHash) {
            state.pendingHash = location.hash;
            const previousHash = state.activeHash;
            const leavingPage = state.currentPage;
            state.leaveTask = Promise.resolve().then(async () => {
                let allowed = false;
                try { allowed = await leavingPage.beforeLeave(); }
                catch (error) { toast(`현재 작업을 확인해 주세요. ${error.message}`, "error"); }
                const nextHash = state.pendingHash;
                state.leaveTask = null;
                if (state.currentPage !== leavingPage || !state.user) return;
                if (allowed === false) {
                    history.replaceState(null, "", previousHash);
                    return;
                }
                if (nextHash === previousHash) return;
                history.replaceState(null, "", nextHash);
                return route({ leaveApproved: true });
            });
            return state.leaveTask;
        }
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
            await performRoute(requestedCode, generation, controller, { refresh });
        })();
        state.routeTask = task;
        const clearTask = () => { if (state.routeTask === task) state.routeTask = null; };
        task.then(clearTask, clearTask);
        return task;
    }

    async function performRoute(requestedCode, generation, controller, { refresh = false } = {}) {
        let code = requestedCode;
        if (!state.user && !["M01001", "M01002"].includes(code)) {
            code = "M01001";
            history.replaceState(null, "", "#/M01001");
            toast("설문 작업은 로그인 후 이용할 수 있습니다. 기능 안내에서 템플릿을 미리 볼 수 있습니다.");
        }
        const requestedPage = window.PAGE_CONFIG[code];
        if (requestedPage && !canAccessMenu(requestedPage)) {
            code = "M01001";
            history.replaceState(null, "", "#/M01001");
            toast("이 메뉴는 플랫폼 관리자만 사용할 수 있습니다.", "error");
        }
        if (location.hash !== `#/${code}` && !location.hash.includes("?")) history.replaceState(null, "", `#/${code}`);
        const page = window.PAGE_CONFIG[code];
        const templateAdminRoute = code === "M02003"
            && queryParams().get("templateAdmin") === "1"
            && state.user?.systemAdmin;
        const navigationPage = templateAdminRoute
            ? window.PAGE_CONFIG.M07001
            : page;
        cancelMessageLayers();
        resetModalForPageTransition();
        state.route = code;
        updateActiveNavigation(navigationPage.navigationCode || navigationPage.code || code);
        dom.pageTitle.textContent = navigationPage.label;
        const pageGroup = window.MENU_CONFIG.find((group) => group.code === navigationPage.groupCode);
        dom.pageGroup.textContent = pageGroup?.label || "";
        const groupLandingCode = pageGroup?.items?.[0]?.code || "M01001";
        dom.pageGroupLink.href = `#/${groupLandingCode}`;
        dom.pageGroupLink.setAttribute("aria-label", `${pageGroup?.label || "홈"} 메뉴로 이동`);
        const helpButton = document.querySelector("[data-help-button]");
        helpButton.setAttribute("aria-label", `${navigationPage.label} 작성 도움말 열기`);
        helpButton.title = `${navigationPage.label} 작성 도움말`;
        document.title = `${navigationPage.label} | IN-SURVEYONE`;
        const routeRoot = document.createElement("div");
        routeRoot.className = "route-view";
        routeRoot.dataset.routeGeneration = String(generation);
        routeRoot.inert = true;
        routeRoot.setAttribute("aria-busy", "true");
        state.routeLoading = generation;
        state.routeFailure = null;
        Common.failure.close();
        routeRoot.innerHTML = loadingMarkup(page.label);
        dom.pageHost.replaceChildren(routeRoot);

        let candidatePage = null;
        let candidateStyle = null;
        const routeTimer = setTimeout(() => {
            if (!isCurrentRoute(generation, controller)) return;
            const error = Common.failure.create("REQUEST_TIMEOUT");
            controller.abort();
            renderRouteFailure(routeRoot, error);
        }, window.SURVEYONE_CONFIG.pageInitTimeoutMs || 45000);
        try {
            const previousPage = state.currentPage;
            state.currentPage = null;
            await destroyPage(previousPage);
            assertCurrentRoute(generation, controller);

            if (refresh) unloadPageAssets(code, page);

            candidateStyle = await loadPageStyle(page.style, { signal: controller.signal });
            assertCurrentRoute(generation, controller);
            activatePageStyle(candidateStyle);
            candidateStyle = null;

            const response = await Common.failure.bounded(fetch(page.html, { cache: "no-store", signal: controller.signal }), { signal: controller.signal, timeoutMs: window.SURVEYONE_CONFIG.assetTimeoutMs || 15000 });
            assertCurrentRoute(generation, controller);
            if (!response.ok) throw Common.failure.create(response.status >= 500 ? "SERVICE_UNAVAILABLE" : "ASSET_LOAD_FAILED", { status: response.status });
            const markup = await Common.failure.bounded(response.text(), { signal: controller.signal, timeoutMs: window.SURVEYONE_CONFIG.assetTimeoutMs || 15000 });
            assertCurrentRoute(generation, controller);
            routeRoot.innerHTML = markup;

            await loadScript(page.script, { signal: controller.signal });
            assertCurrentRoute(generation, controller);
            const pageDefinition = window.Pages?.[code] || null;
            candidatePage = pageDefinition ? Object.create(pageDefinition) : null;
            if (candidatePage?.init) {
                const routeApi = createRouteApi(controller.signal);
                const active = () => isCurrentRoute(generation, controller);
                await Common.failure.bounded(candidatePage.init({
                    root: routeRoot,
                    api: routeApi,
                    signal: controller.signal,
                    routeGeneration: generation,
                    isCurrentRoute: active,
                    toast: (...args) => { if (active()) return toast(...args); },
                    navigate: (...args) => { if (active()) return navigate(...args); },
                    openModal: (...args) => { if (active()) return openModal(...args); },
                    confirmMessage: (...args) => active() ? confirmMessage(...args) : Promise.resolve(false),
                    openAuth: (...args) => { if (active()) return openAuth(...args); },
                    user: state.user,
                    appState: state
                }), { signal: controller.signal, timeoutMs: window.SURVEYONE_CONFIG.pageInitTimeoutMs || 45000 });
            }
            assertCurrentRoute(generation, controller);
            if (state.routeFailure?.generation === generation) throw state.routeFailure.error;
            state.activeHash = location.hash;
            state.currentPage = candidatePage;
            routeRoot.inert = false;
            routeRoot.removeAttribute("aria-busy");
            candidatePage = null;
            dom.pageHost.focus({ preventScroll: true });
        } catch (error) {
            const showFailure = isCurrentRoute(generation, controller) && !isAbortError(error);
            if (showFailure) controller.abort();
            await destroyPage(candidatePage);
            discardPageStyle(candidateStyle);
            if (!showFailure) return;
            renderRouteFailure(routeRoot, error);
        } finally {
            clearTimeout(routeTimer);
            if (state.routeLoading === generation) state.routeLoading = null;
        }
    }

    function renderRouteFailure(root, error) {
        root.inert = false;
        root.removeAttribute("aria-busy");
        root.innerHTML = errorMarkup(error);
        root.querySelector("[data-route-retry]")?.addEventListener("click", route);
        state.activeHash = location.hash;
        root.querySelector("[data-service-failure]")?.focus({ preventScroll: true });
    }

    function handleServiceFailure(event) {
        const { error, signal, method } = event.detail || {};
        if (!Common.failure.isService(error)) return;
        if (signal && (signal.aborted || signal !== state.routeController?.signal)) return;
        if (state.routeLoading === state.routeGeneration) {
            state.routeFailure ||= { generation: state.routeGeneration, error };
            return;
        }
        if (!state.currentPage) return;
        Common.failure.open(error, {
            write: method && !["GET", "HEAD"].includes(method),
            onRetry: () => refreshCurrentPage()
        });
    }

    function showStartupFailure() {
        dom.pageHost.innerHTML = errorMarkup(state.bootstrapError);
        dom.pageHost.querySelector("[data-route-retry]")?.addEventListener("click", () => void retryStartup());
        dom.pageHost.querySelector("[data-service-failure]")?.focus({ preventScroll: true });
    }

    async function retryStartup() {
        if (state.startupRetrying) return;
        state.startupRetrying = true;
        dom.pageHost.innerHTML = loadingMarkup("로그인 상태 확인");
        try {
            await restoreSession();
            if (state.bootstrapError) showStartupFailure();
            else await route();
        } finally { state.startupRetrying = false; }
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
        if (!page) return;
        try {
            if (page.destroy) await Common.failure.bounded(page.destroy(), { timeoutMs: 5000 });
        } catch (error) {
            console.warn("화면 정리 중 오류가 발생했습니다.", error);
        } finally {
            page.destroyed = true;
            Object.keys(page).forEach((key) => {
                if (key !== "destroyed") page[key] = null;
            });
        }
    }

    function unloadPageAssets(code, page) {
        state.loadedScripts.delete(page.script);
        document.querySelectorAll("script[data-page-script]").forEach((script) => {
            if (script.dataset.pageScript === page.script) script.remove();
        });
        if (window.Pages) delete window.Pages[code];
        if (state.activeStyle) {
            state.activeStyle.remove();
            state.activeStyle = null;
        }
    }

    function resetModalForPageTransition() {
        state.modalReturnFocus = null;
        if (dom.modal.open) dom.modal.close();
        dom.modalBody.replaceChildren();
        dom.modal.removeAttribute("aria-label");
    }

    async function refreshCurrentPage() {
        if (state.refreshing || state.leaveTask || !state.currentPage) return;
        try {
            if (state.currentPage.beforeRefresh) {
                const allowed = await state.currentPage.beforeRefresh();
                if (allowed === false) return;
            }
        } catch (error) {
            toast(`현재 화면을 새로고침할 수 없습니다. ${error.message}`, "error");
            return;
        }
        state.refreshing = true;
        dom.pageRefresh.disabled = true;
        dom.pageRefresh.classList.add("is-refreshing");
        dom.pageRefresh.setAttribute("aria-busy", "true");
        const previousGeneration = state.routeGeneration;
        try {
            clearToasts();
            await route({ refresh: true });
            if (state.currentPage && state.routeGeneration > previousGeneration) {
                toast("현재 화면 메모리를 초기화하고 최신 데이터로 새로고침했습니다.", "success");
            }
        } finally {
            state.refreshing = false;
            dom.pageRefresh.disabled = false;
            dom.pageRefresh.classList.remove("is-refreshing");
            dom.pageRefresh.removeAttribute("aria-busy");
        }
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
            let settled = false, timer;
            const finish = (error = null) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
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
            script.dataset.pageScript = src;
            script.onload = () => {
                if (signal?.aborted) return onAbort();
                state.loadedScripts.add(src);
                finish();
            };
            script.onerror = () => {
                script.remove();
                finish(Common.failure.create("ASSET_LOAD_FAILED"));
            };
            signal?.addEventListener("abort", onAbort, { once: true });
            timer = setTimeout(() => { script.remove(); finish(Common.failure.create("REQUEST_TIMEOUT")); }, window.SURVEYONE_CONFIG.assetTimeoutMs || 15000);
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
            let settled = false, timer;
            const finish = (value, error = null) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
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
                finish(null, Common.failure.create("ASSET_LOAD_FAILED"));
            };
            signal?.addEventListener("abort", onAbort, { once: true });
            timer = setTimeout(() => { link.remove(); finish(null, Common.failure.create("REQUEST_TIMEOUT")); }, window.SURVEYONE_CONFIG.assetTimeoutMs || 15000);
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
            const payload = await Common.api.get("/api/auth/me", { silentFailure: true });
            state.bootstrapError = null;
            state.user = payload.user || payload;
            setSessionExpiry(payload.expiresAt || payload.expires_at);
            updateUserUi();
            return true;
        } catch (error) {
            state.bootstrapError = Common.failure.isService(error) ? error : null;
            if (state.bootstrapError) return false;
            clearSessionExpiry();
            updateUserUi();
            return false;
        }
    }

    async function submitLogin(event) {
        event.preventDefault();
        const form = event.currentTarget;
        if (!validateLoginForm(form)) return;
        const data = Object.fromEntries(new FormData(form));
        data.loginId = String(data.loginId || "").trim();
        data.keepSignedIn = data.keepSignedIn === "true";
        setAuthBusy(true, "로그인 중입니다.");
        try {
            const payload = await Common.api.post("/api/auth/login", data);
            state.routeController?.abort();
            state.user = payload.user || payload;
            setSessionExpiry(payload.expiresAt || payload.expires_at);
            updateUserUi();
            setAuthBusy(false, "");
            dom.authDialog.close();
            toast("로그인했습니다.", "success");
            await route();
        } catch (error) { setAuthBusy(false, loginFailureMessage(error), true); }
    }

    async function submitSignup(event) {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(event.currentTarget));
        data.termsAccepted = data.termsAccepted === "true";
        data.privacyAccepted = data.privacyAccepted === "true";
        data.requestSystemAdmin = data.requestSystemAdmin === "true";
        setAuthBusy(true, "작업공간을 만들고 있습니다.");
        try {
            const payload = await Common.api.post("/api/auth/signup", data);
            state.user = payload.user || payload;
            setSessionExpiry(payload.expiresAt || payload.expires_at);
            updateUserUi();
            setAuthBusy(false, "");
            dom.authDialog.close();
            event.currentTarget.reset();
            syncSignupAdminFields();
            if (state.user.systemAdmin) {
                toast("플랫폼 관리자 작업공간이 생성되었습니다. 공용 템플릿 관리로 이동합니다.", "success");
                navigate("M07001");
            } else {
                toast("IN-SURVEYONE 작업공간이 생성되었습니다.", "success");
                await route();
            }
        } catch (error) {
            const adminKey = event.currentTarget.elements.adminKey;
            if (adminKey) adminKey.value = "";
            setAuthBusy(false, error.message, true);
        }
    }

    function syncSignupAdminFields() {
        const toggle = document.querySelector("[data-signup-admin-toggle]");
        const host = document.querySelector("[data-signup-admin-key]");
        const input = document.querySelector("[data-signup-admin-key-input]");
        if (!toggle || !host || !input) return;
        host.hidden = !toggle.checked;
        input.disabled = !toggle.checked;
        input.required = toggle.checked;
        if (!toggle.checked) input.value = "";
    }

    function validateLoginForm(form) {
        const loginId = form.elements.loginId;
        const password = form.elements.password;
        let field = null;
        let message = "";
        if (!loginId.value.trim()) {
            field = loginId;
            message = "아이디를 입력해 주세요.";
        } else if (!password.value) {
            field = password;
            message = "비밀번호를 입력해 주세요.";
        } else if (password.value.length < 8) {
            field = password;
            message = "비밀번호는 8자 이상 입력해 주세요.";
        }
        if (!message) return true;
        setAuthMessage(message, { error: true });
        field.focus({ preventScroll: true });
        return false;
    }

    function loginFailureMessage(error) {
        if (error?.status === 401) return "아이디 또는 비밀번호가 올바르지 않습니다.";
        if (error?.status === 429) return "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.";
        if (error?.status === 503) return "로그인 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.";
        return error?.message || "로그인 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
    }

    async function logout() {
        try { await Common.api.post("/api/auth/logout", {}); } catch (error) { console.warn(error); }
        state.user = null;
        clearSessionExpiry();
        updateUserUi();
        dom.userMenu.hidden = true;
        toast("로그아웃했습니다. 메인 대시보드를 계속 둘러볼 수 있습니다.", "success");
        await route();
    }

    function updateUserUi() {
        const user = state.user;
        renderNavigation();
        const name = user?.name || user?.displayName || "방문자";
        const tenant = String(user?.organizationName || user?.tenantName || "IN-SURVEYONE");
        document.querySelector("[data-user-name]").textContent = name;
        document.querySelector("[data-user-role]").textContent = !user ? "둘러보기" : (user.systemAdmin ? "플랫폼 관리자" : (user.roleLabel || "설문 관리자"));
        document.querySelector("[data-user-avatar]").textContent = name.trim().charAt(0).toUpperCase() || "G";
        document.querySelector("[data-tenant-name]").textContent = tenant;
        document.querySelector("[data-save-state]").innerHTML = user
            ? '<i aria-hidden="true"></i> 화면별 저장 상태 확인'
            : '<i aria-hidden="true"></i> 읽기 전용 둘러보기';
        document.querySelector("[data-quick-create]").innerHTML = user
            ? '<span aria-hidden="true">＋</span> 새 설문'
            : '<span aria-hidden="true">＋</span> 기능 둘러보기';
        document.querySelector("[data-visitor-signup]").hidden = Boolean(user);
        const sessionSecurity = document.querySelector("[data-session-security]");
        if (sessionSecurity) sessionSecurity.hidden = !user;
        document.querySelectorAll('[data-auth-action="logout"]').forEach((button) => { button.hidden = !user; });
        document.querySelectorAll('[data-auth-action="login"], [data-auth-action="signup"]').forEach((button) => { button.hidden = Boolean(user); });
        renderSessionStatus();
    }

    function openAuth(mode = "login") {
        setAuthBusy(false, "");
        selectAuthTab(mode === "signup" ? "signup" : "login");
        if (!dom.authDialog.open) dom.authDialog.showModal();
    }

    function selectAuthTab(mode, { focus = true } = {}) {
        document.querySelectorAll("[data-auth-tab]").forEach((tab) => {
            const selected = tab.dataset.authTab === mode;
            tab.setAttribute("aria-selected", String(selected));
            tab.tabIndex = selected ? 0 : -1;
        });
        document.querySelectorAll("[data-auth-panel]").forEach((panel) => { panel.hidden = panel.dataset.authPanel !== mode; });
        const titles = { login: "로그인", signup: "회원가입" };
        const intros = {
            login: "회원 계정으로 작업을 이어가세요.",
            signup: "기관 전용 설문 작업공간을 만듭니다."
        };
        document.querySelector("[data-auth-title]").textContent = titles[mode];
        document.querySelector("[data-auth-intro]").textContent = intros[mode];
        if (mode === "login" && focus) {
            requestAnimationFrame(() => {
                if (!dom.authDialog.open) return;
                const loginId = document.querySelector('[data-login-form] input[name="loginId"]');
                if (!loginId || loginId.closest("[data-auth-panel]")?.hidden) return;
                loginId.focus({ preventScroll: true });
            });
        }
    }

    function setAuthBusy(busy, message, error = false) {
        dom.authDialog.querySelectorAll("button, input").forEach((element) => { if (!element.closest(".dialog-close-row")) element.disabled = busy; });
        setAuthMessage(message, { error, focus: error && !busy });
    }

    function setAuthMessage(message, { error = false, focus = false } = {}) {
        const text = String(message || "").trim();
        dom.authMessage.textContent = text;
        dom.authMessage.hidden = !text;
        dom.authMessage.classList.toggle("is-error", error);
        dom.authMessage.setAttribute?.("role", error ? "alert" : "status");
        dom.authMessage.setAttribute?.("aria-live", error ? "assertive" : "polite");
        if (!text || !focus) return;
        const reveal = () => {
            dom.authMessage.scrollIntoView?.({ block: "nearest" });
            dom.authMessage.focus?.({ preventScroll: true });
        };
        if (typeof requestAnimationFrame === "function") requestAnimationFrame(reveal);
        else reveal();
    }

    function toast(message, tone = "info") {
        const normalizedTone = ["success", "warning", "error"].includes(tone) ? tone : "info";
        if (normalizedTone === "error" && dom.authDialog?.open) {
            setAuthMessage(message, { error: true, focus: true });
            return dom.authMessage;
        }
        const labels = { success: "완료", warning: "주의", error: "오류", info: "안내" };
        const element = document.createElement("section");
        element.className = `toast toast-${normalizedTone}`;
        element.dataset.message = String(message ?? "");
        element.setAttribute("role", normalizedTone === "error" ? "alert" : "status");
        element.innerHTML = `
            <span class="toast-icon">${Common.icon(normalizedTone === "success" ? "check" : "info", 17)}</span>
            <span class="toast-copy"><strong>${labels[normalizedTone]}</strong><span>${Common.escapeHtml(message)}</span></span>
            <span class="toast-actions">
                <button class="toast-action" type="button" data-toast-copy title="메시지 복사" aria-label="메시지 내용 복사">${Common.icon("copy", 16)}</button>
                <button class="toast-action" type="button" data-toast-close title="닫기" aria-label="메시지 닫기">×</button>
            </span>`;
        while (dom.toastRegion.children.length >= 4) dismissToast(dom.toastRegion.firstElementChild, true);
        dom.toastRegion.appendChild(element);
        const duration = ["error", "warning"].includes(normalizedTone) ? 6500 : 3800;
        const pause = () => clearTimeout(element.dismissTimer);
        const resume = () => scheduleToastDismiss(element, duration);
        element.addEventListener("mouseenter", pause);
        element.addEventListener("mouseleave", resume);
        element.addEventListener("focusin", pause);
        element.addEventListener("focusout", resume);
        element.showTimer = setTimeout(() => element.classList.add("is-visible"), 10);
        scheduleToastDismiss(element, duration);
        return element;
    }

    function scheduleToastDismiss(element, duration) {
        clearTimeout(element.dismissTimer);
        element.dismissTimer = setTimeout(() => dismissToast(element), duration);
    }

    function dismissToast(element, immediately = false) {
        if (!element) return;
        clearTimeout(element.showTimer);
        clearTimeout(element.dismissTimer);
        clearTimeout(element.removeTimer);
        if (immediately) return element.remove();
        element.classList.remove("is-visible");
        element.removeTimer = setTimeout(() => element.remove(), 220);
    }

    function clearToasts() {
        Array.from(dom.toastRegion.children).forEach((element) => dismissToast(element, true));
    }

    async function handleToastAction(event) {
        const element = event.target.closest(".toast");
        if (!element) return;
        if (event.target.closest("[data-toast-close]")) return dismissToast(element);
        const button = event.target.closest("[data-toast-copy]");
        if (!button) return;
        try {
            await Common.copyText(element.dataset.message || "");
            showCopyFeedback(button, true);
        } catch {
            showCopyFeedback(button, false);
        }
    }

    function showCopyFeedback(button, success) {
        const original = button.innerHTML;
        const originalLabel = button.getAttribute("aria-label");
        button.innerHTML = success ? Common.icon("check", 16) : "!";
        button.setAttribute("aria-label", success ? "복사됨" : "복사 실패");
        button.title = success ? "복사됨" : "복사 실패";
        setTimeout(() => {
            if (!button.isConnected) return;
            button.innerHTML = original;
            button.setAttribute("aria-label", originalLabel || "메시지 내용 복사");
            button.title = "메시지 복사";
        }, 1400);
    }

    function confirmMessage(message, options = {}) {
        return new Promise((resolve) => {
            state.messageQueue.push({
                message: String(message ?? ""),
                title: String(options.title || "확인이 필요합니다"),
                confirmLabel: String(options.confirmLabel || "확인"),
                cancelLabel: String(options.cancelLabel || "취소"),
                tone: ["warning", "error"].includes(options.tone) ? options.tone : "info",
                destructive: Boolean(options.destructive),
                resolve
            });
            showNextMessageLayer();
        });
    }

    function showNextMessageLayer() {
        if (state.activeMessage || dom.messageDialog.open) return;
        const request = state.messageQueue.shift();
        if (!request) return;
        state.activeMessage = request;
        state.messageReturnFocus = document.activeElement;
        resetMessagePosition();
        dom.messageDialog.returnValue = "";
        dom.messageDialog.classList.toggle("is-warning", request.tone === "warning");
        dom.messageDialog.classList.toggle("is-error", request.tone === "error");
        dom.messageTitle.textContent = request.title;
        dom.messageText.textContent = request.message;
        dom.messageToneIcon.textContent = request.tone === "error" ? "!" : request.tone === "warning" ? "!" : "?";
        dom.messageCopy.innerHTML = '<span aria-hidden="true">⧉</span><span>복사</span>';
        dom.messageCopy.setAttribute("aria-label", "메시지 내용 복사");
        dom.messageCopy.title = "메시지 복사";
        dom.messageCancel.textContent = request.cancelLabel;
        dom.messageConfirm.textContent = request.confirmLabel;
        dom.messageConfirm.className = `button ${request.destructive ? "button-delete" : "button-function"} button-important`;
        document.documentElement.classList.add("app-message-open");
        dom.messageDialog.showModal();
        requestAnimationFrame(() => dom.messageConfirm.focus({ preventScroll: true }));
    }

    function closeMessageLayer() {
        const request = state.activeMessage;
        state.activeMessage = null;
        document.documentElement.classList.remove("app-message-open");
        resetMessagePosition();
        const returnFocus = state.messageReturnFocus;
        state.messageReturnFocus = null;
        if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
        request?.resolve(dom.messageDialog.returnValue === "confirm");
        queueMicrotask(showNextMessageLayer);
    }

    function cancelMessageLayers() {
        const queued = state.messageQueue.splice(0);
        queued.forEach((request) => request.resolve(false));
        if (dom.messageDialog.open) {
            dom.messageDialog.returnValue = "cancel";
            dom.messageDialog.close();
        } else if (state.activeMessage) {
            const request = state.activeMessage;
            state.activeMessage = null;
            request.resolve(false);
        }
    }

    async function copyActiveMessage() {
        if (!state.activeMessage) return;
        try {
            await Common.copyText(state.activeMessage.message);
            showCopyFeedback(dom.messageCopy, true);
        } catch {
            showCopyFeedback(dom.messageCopy, false);
        }
    }

    function resetModalPosition() {
        state.modalDrag = null;
        state.modalOffsetX = 0;
        state.modalOffsetY = 0;
        dom.modal?.classList.remove("is-dragging");
        dom.modal?.style.removeProperty("--modal-drag-x");
        dom.modal?.style.removeProperty("--modal-drag-y");
    }

    function setModalPosition(x, y) {
        state.modalOffsetX = x;
        state.modalOffsetY = y;
        dom.modal.style.setProperty("--modal-drag-x", `${x}px`);
        dom.modal.style.setProperty("--modal-drag-y", `${y}px`);
    }

    function startModalDrag(event) {
        const handle = event.target.closest("[data-modal-drag-handle]");
        if (!handle || event.button !== 0) return;
        if (event.target.closest("button, a, input, select, textarea, label")) return;
        const rect = dom.modal.getBoundingClientRect();
        state.modalDrag = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            baseX: state.modalOffsetX,
            baseY: state.modalOffsetY,
            minX: 8 - rect.left,
            maxX: window.innerWidth - 8 - rect.right,
            minY: 8 - rect.top,
            maxY: window.innerHeight - 8 - rect.bottom
        };
        dom.modal.classList.add("is-dragging");
        dom.modal.setPointerCapture(event.pointerId);
        event.preventDefault();
    }

    function moveModalDrag(event) {
        const drag = state.modalDrag;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const deltaX = Math.min(drag.maxX, Math.max(drag.minX, event.clientX - drag.startX));
        const deltaY = Math.min(drag.maxY, Math.max(drag.minY, event.clientY - drag.startY));
        setModalPosition(drag.baseX + deltaX, drag.baseY + deltaY);
    }

    function endModalDrag(event) {
        if (!state.modalDrag || state.modalDrag.pointerId !== event.pointerId) return;
        if (dom.modal.hasPointerCapture(event.pointerId)) dom.modal.releasePointerCapture(event.pointerId);
        state.modalDrag = null;
        dom.modal.classList.remove("is-dragging");
    }

    function moveModalWithKeyboard(event) {
        if (event.target !== event.target.closest("[data-modal-drag-handle]")) return;
        const directions = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] };
        const direction = directions[event.key];
        if (!direction) return;
        const rect = dom.modal.getBoundingClientRect();
        const deltaX = Math.min(window.innerWidth - 8 - rect.right, Math.max(8 - rect.left, direction[0]));
        const deltaY = Math.min(window.innerHeight - 8 - rect.bottom, Math.max(8 - rect.top, direction[1]));
        setModalPosition(state.modalOffsetX + deltaX, state.modalOffsetY + deltaY);
        event.preventDefault();
    }

    function resetMessagePosition() {
        state.messageDrag = null;
        state.messageOffsetX = 0;
        state.messageOffsetY = 0;
        dom.messageDialog?.classList.remove("is-dragging");
        dom.messageDialog?.style.removeProperty("--message-drag-x");
        dom.messageDialog?.style.removeProperty("--message-drag-y");
    }

    function setMessagePosition(x, y) {
        state.messageOffsetX = x;
        state.messageOffsetY = y;
        dom.messageDialog.style.setProperty("--message-drag-x", `${x}px`);
        dom.messageDialog.style.setProperty("--message-drag-y", `${y}px`);
    }

    function startMessageDrag(event) {
        const handle = event.target.closest("[data-message-drag-handle]");
        if (!handle || event.button !== 0 || event.target.closest("button, a, input, select, textarea, label")) return;
        const rect = dom.messageDialog.getBoundingClientRect();
        state.messageDrag = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            baseX: state.messageOffsetX,
            baseY: state.messageOffsetY,
            minX: 8 - rect.left,
            maxX: window.innerWidth - 8 - rect.right,
            minY: 8 - rect.top,
            maxY: window.innerHeight - 8 - rect.bottom
        };
        dom.messageDialog.classList.add("is-dragging");
        dom.messageDialog.setPointerCapture(event.pointerId);
        event.preventDefault();
    }

    function moveMessageDrag(event) {
        const drag = state.messageDrag;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const deltaX = Math.min(drag.maxX, Math.max(drag.minX, event.clientX - drag.startX));
        const deltaY = Math.min(drag.maxY, Math.max(drag.minY, event.clientY - drag.startY));
        setMessagePosition(drag.baseX + deltaX, drag.baseY + deltaY);
    }

    function endMessageDrag(event) {
        if (!state.messageDrag || state.messageDrag.pointerId !== event.pointerId) return;
        if (dom.messageDialog.hasPointerCapture(event.pointerId)) dom.messageDialog.releasePointerCapture(event.pointerId);
        state.messageDrag = null;
        dom.messageDialog.classList.remove("is-dragging");
    }

    function moveMessageWithKeyboard(event) {
        if (event.target !== event.target.closest("[data-message-drag-handle]")) return;
        const directions = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] };
        const direction = directions[event.key];
        if (!direction) return;
        const rect = dom.messageDialog.getBoundingClientRect();
        const deltaX = Math.min(window.innerWidth - 8 - rect.right, Math.max(8 - rect.left, direction[0]));
        const deltaY = Math.min(window.innerHeight - 8 - rect.bottom, Math.max(8 - rect.top, direction[1]));
        setMessagePosition(state.messageOffsetX + deltaX, state.messageOffsetY + deltaY);
        event.preventDefault();
    }

    function openModal(content, options = {}) {
        if (!dom.modal.open) state.modalScrollPosition = { x: window.scrollX, y: window.scrollY };
        if (!dom.modal.open || !options.templateLibrary) resetModalPosition();
        state.modalReturnFocus = document.activeElement;
        dom.modalBody.innerHTML = content;
        dom.modal.classList.toggle("modal-wide", Boolean(options.wide));
        dom.modal.classList.toggle("modal-template-library", Boolean(options.templateLibrary));
        dom.modal.classList.toggle("modal-preview-simulator", Boolean(options.previewSimulator));
        dom.modal.classList.toggle("modal-publication-links", Boolean(options.publicationLinks));
        dom.modal.setAttribute("aria-label", options.label || "안내");
        dom.modalDragTitle.textContent = options.label || "레이어 창";
        document.documentElement.classList.add("app-modal-open");
        const initialTarget = options.initialFocus ? dom.modal.querySelector(options.initialFocus) : dom.modal.querySelector("[autofocus]");
        if (initialTarget) initialTarget.setAttribute("autofocus", "");
        if (!dom.modal.open) dom.modal.showModal();
        const scroll = state.modalScrollPosition;
        if (scroll) window.scrollTo({ left: scroll.x, top: scroll.y, behavior: "instant" });
        requestAnimationFrame(() => {
            const target = initialTarget;
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

    function errorMarkup(error) {
        return Common.failure.markup(error).replace('data-failure-retry', 'data-route-retry');
    }

    window.Pages = window.Pages || {};
    window.SurveyOneApp = { navigate, queryParams, toast, openModal, confirmMessage, refreshCurrentPage, get user() { return state.user; } };
})();
