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
    assert 'if (!state.user && code !== "M01001")' in app_source
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
    assert ".auth-panel" in css_source
    assert "height: 390px" in css_source
    assert "scrollbar-width: thin" in css_source
    assert "*::-webkit-scrollbar-thumb" in css_source


def test_auth_dialog_busy_state_is_reset_before_reopening_and_after_success() -> None:
    app_source = (PROJECT_ROOT / "frontend" / "js" / "app.js").read_text(encoding="utf-8")

    open_auth_block = app_source.split('function openAuth(mode = "guest")', 1)[1].split(
        "function selectAuthTab", 1
    )[0]
    assert 'setAuthBusy(false, "");' in open_auth_block
    assert app_source.count('setAuthBusy(false, "");') >= 4


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


def test_guest_post_failure_replaces_stale_available_capability() -> None:
    _run_guest_state_scenario(
        """
    hooks.state.guestCapabilities = capability(true);
    context.Common.api.post = async () => {
        const error = new Error("Oracle connection is unavailable");
        error.status = 503;
        throw error;
    };

    await hooks.startGuest();
    assert.equal(hooks.state.guestCapabilities.modes[0].available, false);
    assert.equal(guestButton.disabled, true, "a failed POST must not re-enable from stale state");
    assert.equal(guestCard.classList.contains("is-disabled"), true);
    assert.match(guestStatus.textContent, /Oracle connection is unavailable/);
    assert.equal(authMessage.textContent, "Oracle connection is unavailable");
    assert.equal(authMessage.classList.contains("is-error"), true);

    let recoveryCalls = 0;
    context.Common.api.get = async () => {
        recoveryCalls += 1;
        return capability(true);
    };
    const recovered = await hooks.loadGuestCapabilities();
    assert.equal(recoveryCalls, 1, "the next explicit capability load must retry after POST failure");
    assert.equal(recovered.modes[0].available, true);
    assert.equal(guestButton.disabled, false);

    context.Common.api.post = async () => {
        const error = new Error("요청 값을 확인해 주세요");
        error.status = 422;
        throw error;
    };
    await hooks.startGuest();
    assert.equal(hooks.state.guestCapabilities.modes[0].available, true,
        "a client error must not relabel Oracle capability as unavailable");
    assert.equal(guestButton.disabled, false);
    assert.equal(authMessage.textContent, "요청 값을 확인해 주세요");
        """
    )
