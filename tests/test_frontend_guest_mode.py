import json
from pathlib import Path
import shutil
import subprocess

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def _run_guest_state_scenario(scenario: str) -> None:
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node.js is not installed; browser-state regression harness skipped.")

    app_path = json.dumps(str(PROJECT_ROOT / "frontend" / "js" / "app.js"))
    harness = f"""
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const appPath = {app_path};
let source = fs.readFileSync(appPath, "utf8");
const marker = "}})();";
const markerIndex = source.lastIndexOf(marker);
assert.notEqual(markerIndex, -1, "app.js IIFE terminator was not found");
source = source.slice(0, markerIndex)
    + `globalThis.__guestTestHooks = {{ state, dom, loadGuestCapabilities, startGuest }};\n`
    + source.slice(markerIndex);

function makeClassList() {{
    const values = new Set();
    return {{
        add(name) {{ values.add(name); }},
        remove(name) {{ values.delete(name); }},
        toggle(name, force) {{
            if (force === undefined) force = !values.has(name);
            if (force) values.add(name); else values.delete(name);
            return force;
        }},
        contains(name) {{ return values.has(name); }}
    }};
}}

const guestButton = {{ disabled: true, closest() {{ return null; }} }};
const guestCard = {{ classList: makeClassList() }};
const guestReason = {{ textContent: "" }};
const guestStatus = {{ textContent: "" }};
const authMessage = {{ textContent: "", classList: makeClassList() }};
const elements = {{
    "[data-guest-start]": guestButton,
    "[data-guest-issue-card]": guestCard,
    "[data-guest-account-reason]": guestReason,
    "[data-guest-capability-status]": guestStatus
}};
const context = {{
    console,
    document: {{
        addEventListener() {{}},
        querySelector(selector) {{ return elements[selector] || null; }},
        querySelectorAll() {{ return []; }}
    }},
    Common: {{
        api: {{}},
        formatNumber(value) {{ return String(value); }}
    }},
    setTimeout,
    clearTimeout
}};
context.window = context;
vm.runInNewContext(source, context, {{ filename: appPath }});
const hooks = context.__guestTestHooks;
hooks.dom.authDialog = {{ querySelectorAll() {{ return [guestButton]; }} }};
hooks.dom.authMessage = authMessage;

function capability(available, reason = null) {{
    return {{
        selectedMode: "database",
        modes: [{{
            mode: "database",
            title: "DB guest",
            available,
            reason,
            persistence: "oracle",
            expiresInHours: 24,
            limits: {{}},
            features: {{}},
            providerConfigured: {{}}
        }}]
    }};
}}

(async () => {{
{scenario}
}})().catch((error) => {{
    console.error(error);
    process.exitCode = 1;
}});
"""
    completed = subprocess.run(
        [node, "-"],
        input=harness,
        text=True,
        encoding="utf-8",
        capture_output=True,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr or completed.stdout


def test_guest_entry_is_single_database_account_issuance() -> None:
    app_source = (PROJECT_ROOT / "frontend" / "js" / "app.js").read_text(encoding="utf-8")
    index_source = (PROJECT_ROOT / "frontend" / "index.html").read_text(encoding="utf-8")

    assert 'name="guestMode"' not in index_source
    assert "로컬 체험" not in index_source
    assert 'Common.api.get("/api/auth/guest/capabilities?mode=database")' in app_source
    assert 'Common.api.post("/api/auth/guest", { mode: "database" })' in app_source
    start_block = app_source.split("async function startGuest()", 1)[1].split(
        "async function activateGuestForWork()", 1
    )[0]
    assert 'Common.api.post("/api/auth/guest"' not in start_block
    assert 'navigate(target.route || "M02001", target.params || { create: "1" })' in start_block
    assert "state.guestStartTarget" in start_block
    assert "state.guestActivationPromise" in app_source
    assert 'selectedMode: "database"' in app_source


def test_unavailable_database_guest_is_explained_and_disabled() -> None:
    app_source = (PROJECT_ROOT / "frontend" / "js" / "app.js").read_text(encoding="utf-8")
    index_source = (PROJECT_ROOT / "frontend" / "index.html").read_text(encoding="utf-8")
    css_source = (PROJECT_ROOT / "frontend" / "css" / "app.css").read_text(encoding="utf-8")

    assert "button.disabled = !available" in app_source
    assert "게스트 계정을 현재 발급할 수 없습니다." in app_source
    assert "DB 게스트" not in index_source
    assert "data-guest-issue-card" in index_source
    assert "data-guest-start disabled" in index_source
    assert ".guest-account-card.is-disabled" in css_source


def test_anonymous_visit_routes_to_dashboard_without_opening_auth_dialog() -> None:
    app_source = (PROJECT_ROOT / "frontend" / "js" / "app.js").read_text(encoding="utf-8")

    init_block = app_source.split("async function init()", 1)[1].split("function cacheDom()", 1)[0]
    restore_block = app_source.split("async function restoreSession()", 1)[1].split("async function startGuest()", 1)[0]
    assert "await restoreSession();" in init_block
    assert "await route();" in init_block
    assert 'openAuth("guest")' not in init_block
    assert 'openAuth("guest")' not in restore_block
    assert 'const anonymousGuestDraft = !state.user && code === "M02001"' in app_source
    assert 'if (!state.user && code !== "M01001" && !anonymousGuestDraft)' in app_source
    assert 'if (requestedPage && !anonymousGuestDraft && !canAccessMenu(requestedPage))' in app_source
    assert "읽기 전용 둘러보기" in app_source


def test_dashboard_offers_database_guest_and_member_choices_to_visitors() -> None:
    page_source = (PROJECT_ROOT / "frontend" / "pages" / "M01001.html").read_text(encoding="utf-8")
    page_script = (PROJECT_ROOT / "frontend" / "js" / "M01001.js").read_text(encoding="utf-8")

    assert "data-start-guest" in page_source
    assert 'data-start-guest="local"' not in page_source
    assert 'data-start-guest="database"' not in page_source
    assert 'data-start-auth="signup"' in page_source
    assert 'data-start-auth="login"' in page_source
    assert "data-visitor-database-card" in page_source
    assert 'this.context.openAuth("guest")' in page_script
    assert "configureDatabaseGuestEntry" in page_script
    assert "게스트(손님) 체험" in page_source
    assert "DB 게스트" not in page_source
    assert 'class="auth-policy-details"' in (PROJECT_ROOT / "frontend" / "index.html").read_text(encoding="utf-8")
    assert 'this.root.classList.toggle("is-visitor-dashboard", this.isVisitor)' in page_script


def test_page_context_is_integrated_into_top_header_and_auth_tabs_share_height() -> None:
    index_source = (PROJECT_ROOT / "frontend" / "index.html").read_text(
        encoding="utf-8"
    )
    css_source = (PROJECT_ROOT / "frontend" / "css" / "app.css").read_text(
        encoding="utf-8"
    )

    assert 'class="header-page-context"' in index_source
    assert 'class="header-page-actions"' in index_source
    assert 'class="page-context-bar"' not in index_source
    assert 'class="workspace-chip" href="#/M01001"' in index_source
    assert 'aria-label="현재 작업공간 대시보드로 이동"' in index_source
    assert 'data-page-group-link' in index_source
    assert 'dom.pageGroupLink.href = `#/${groupLandingCode}`' in (
        PROJECT_ROOT / "frontend" / "js" / "app.js"
    ).read_text(encoding="utf-8")
    assert ".auth-panel" in css_source
    auth_panel_rule = css_source.split(".auth-panel {", 1)[1].split("}", 1)[0]
    assert "max-height: min(520px, 58vh)" in auth_panel_rule
    assert "height: 390px" not in auth_panel_rule
    assert "scrollbar-width: thin" in css_source
    assert "*::-webkit-scrollbar-thumb" in css_source
    assert "background: rgba(241, 246, 248, .98)" in css_source
    assert ".signup-terms-disclosure" in css_source


def test_dashboard_actions_have_retry_and_refresh_feedback() -> None:
    page_source = (PROJECT_ROOT / "frontend" / "pages" / "M01001.html").read_text(encoding="utf-8")
    page_script = (PROJECT_ROOT / "frontend" / "js" / "M01001.js").read_text(encoding="utf-8")
    app_source = (PROJECT_ROOT / "frontend" / "js" / "app.js").read_text(encoding="utf-8")
    index_source = (PROJECT_ROOT / "frontend" / "index.html").read_text(encoding="utf-8")

    assert "data-visitor-database-retry" in page_source
    assert "data-guest-capability-retry" in index_source
    assert 'this.configureDatabaseGuestEntry({ force: true })' in page_script
    assert 'this.load({ announce: true, refreshGuest: true })' in page_script
    assert 'refreshButton.textContent = "새로고침 중…"' in page_script
    assert 'loadGuestCapabilities({ force: true })' in app_source
    assert "data-response-trend" in page_source
    assert "responseTrend: dashboard.responseTrend" in page_script
    assert 'start: "template"' in page_script
    assert 'this.context.openAuth("guest", { route, params })' in page_script


def test_auth_dialog_busy_state_is_reset_before_reopening_and_after_success() -> None:
    app_source = (PROJECT_ROOT / "frontend" / "js" / "app.js").read_text(encoding="utf-8")

    open_auth_block = app_source.split('function openAuth(mode = "guest", guestStartTarget = null)', 1)[1].split(
        "function selectAuthTab", 1
    )[0]
    assert 'setAuthBusy(false, "");' in open_auth_block
    assert app_source.count('setAuthBusy(false, "");') >= 3
    select_auth_block = app_source.split(
        'function selectAuthTab(mode, { focus = true } = {})', 1
    )[1].split("function fallbackGuestCapabilities", 1)[0]
    assert 'input[name="loginId"]' in select_auth_block
    assert 'loginId.focus({ preventScroll: true });' in select_auth_block
    assert 'selectAuthTab("login", { focus: false });' in app_source


def test_authentication_errors_are_rendered_inside_the_open_layer() -> None:
    app_source = (PROJECT_ROOT / "frontend" / "js" / "app.js").read_text(
        encoding="utf-8"
    )
    index_source = (PROJECT_ROOT / "frontend" / "index.html").read_text(
        encoding="utf-8"
    )
    css_source = (PROJECT_ROOT / "frontend" / "css" / "app.css").read_text(
        encoding="utf-8"
    )

    message_position = index_source.index("data-auth-message")
    login_position = index_source.index("data-login-form")
    assert message_position < login_position
    assert 'data-login-form novalidate' in index_source
    assert 'tabindex="-1" hidden' in index_source
    assert "function validateLoginForm(form)" in app_source
    assert "function loginFailureMessage(error)" in app_source
    assert "function setAuthMessage(message" in app_source
    assert 'if (normalizedTone === "error" && dom.authDialog?.open)' in app_source
    assert "setAuthMessage(\n                        \"로그인 세션이 만료" in app_source
    assert '.form-message.is-error' in css_source
    assert '.form-message[hidden] { display: none; }' in css_source


def test_issued_guest_secret_is_only_handed_to_normal_login_form() -> None:
    app_source = (PROJECT_ROOT / "frontend" / "js" / "app.js").read_text(encoding="utf-8")
    index_source = (PROJECT_ROOT / "frontend" / "index.html").read_text(encoding="utf-8")

    assert "guestCredential" in app_source
    assert "initialPassword" in app_source
    assert "continueIssuedGuest" not in app_source
    assert "data-guest-continue" not in index_source
    assert 'clearIssuedGuest({ preserveLoginForm: true });' in app_source
    assert "if (!preserveLoginForm) loginForm.reset();" in app_source
    assert 'Common.api.post("/api/auth/login", data)' in app_source
    assert "localStorage" not in app_source


def test_shared_pc_login_is_non_persistent_by_default_and_warns_users() -> None:
    app_source = (PROJECT_ROOT / "frontend" / "js" / "app.js").read_text(encoding="utf-8")
    index_source = (PROJECT_ROOT / "frontend" / "index.html").read_text(encoding="utf-8")

    assert 'name="keepSignedIn" value="true"' in index_source
    assert "공용 PC인가요?" in index_source
    assert "공용 PC에서는 작업 후 반드시 로그아웃하세요." in index_source
    assert 'data.keepSignedIn = data.keepSignedIn === "true";' in app_source


def test_unavailable_guest_capability_is_retried_and_pending_requests_are_deduplicated() -> None:
    _run_guest_state_scenario(
        """
    let getCalls = 0;
    context.Common.api.get = async () => {
        getCalls += 1;
        if (getCalls === 1) throw new Error("transport unavailable");
        return capability(true);
    };

    const first = await hooks.loadGuestCapabilities();
    assert.equal(first.modes[0].available, false);
    assert.equal(guestButton.disabled, true);
    assert.match(guestStatus.textContent, /transport unavailable/);

    const recovered = await hooks.loadGuestCapabilities();
    assert.equal(getCalls, 2, "an unavailable transport fallback must be retried");
    assert.equal(recovered.modes[0].available, true);
    assert.equal(guestButton.disabled, false);

    hooks.state.guestCapabilities = capability(false, "schema unavailable");
    let resolveRequest;
    let pendingCalls = 0;
    context.Common.api.get = () => {
        pendingCalls += 1;
        return new Promise((resolve) => { resolveRequest = resolve; });
    };
    const pendingFirst = hooks.loadGuestCapabilities();
    const pendingSecond = hooks.loadGuestCapabilities();
    assert.equal(pendingCalls, 1, "concurrent retries must share the in-flight request");
    resolveRequest(capability(false, "still unavailable"));
    await Promise.all([pendingFirst, pendingSecond]);
    assert.equal(guestButton.disabled, true);
        """
    )


def test_guest_account_is_activated_only_from_first_project_save() -> None:
    app_source = (PROJECT_ROOT / "frontend" / "js" / "app.js").read_text(encoding="utf-8")
    project_source = (PROJECT_ROOT / "frontend" / "js" / "M02001.js").read_text(encoding="utf-8")
    index_source = (PROJECT_ROOT / "frontend" / "index.html").read_text(encoding="utf-8")

    start_block = app_source.split("async function startGuest()", 1)[1].split(
        "async function activateGuestForWork()", 1
    )[0]
    activation_block = app_source.split("async function activateGuestForWork()", 1)[1].split(
        "function normalizeIssuedGuest", 1
    )[0]
    assert 'Common.api.post("/api/auth/guest"' not in start_block
    assert 'navigate(target.route || "M02001", target.params || { create: "1" })' in start_block
    assert 'Common.api.post("/api/auth/guest", { mode: "database" })' in activation_block
    assert "if (state.guestActivationPromise) return state.guestActivationPromise" in activation_block
    assert "await this.context.activateGuestForWork()" in project_source
    assert project_source.index("await this.context.activateGuestForWork()") < project_source.index('this.context.api.post("/api/surveys", body)')
    assert "처음 저장할 때" in index_source
    assert "프로젝트 작성 시작" in index_source


def test_signup_exposes_admin_key_and_readable_required_agreements() -> None:
    html = (PROJECT_ROOT / "frontend" / "index.html").read_text(encoding="utf-8")
    script = (PROJECT_ROOT / "frontend" / "js" / "app.js").read_text(encoding="utf-8")
    css = (PROJECT_ROOT / "frontend" / "css" / "app.css").read_text(encoding="utf-8")

    assert 'name="requestSystemAdmin" value="true" data-signup-admin-toggle' in html
    assert 'name="adminKey"' in html
    assert "INIT_ADMIN_KEY와 일치해야 하며 가입 후 저장되지 않습니다." in html
    assert "IN-SURVEYONE 서비스 이용약관" in html
    assert "개인정보 수집·이용 안내" in html
    assert 'name="termsAccepted" value="true" required' in html
    assert 'name="privacyAccepted" value="true" required' in html
    assert html.index('class="signup-terms-document"') < html.index('name="termsAccepted"')
    assert 'data.requestSystemAdmin = data.requestSystemAdmin === "true";' in script
    assert 'navigate("M07001")' in script
    assert ".signup-terms-document" in css
    assert "overflow-y: auto" in css
