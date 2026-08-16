from __future__ import annotations

import json
from pathlib import Path
import shutil
import subprocess

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_common_api_marks_protected_401_but_not_login_failure() -> None:
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node.js is not installed; session event regression skipped.")

    common_path = json.dumps(str(PROJECT_ROOT / "frontend" / "js" / "common.js"))
    harness = f"""
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const events = [];
class TestCustomEvent {{
    constructor(type, options = {{}}) {{ this.type = type; this.detail = options.detail; }}
}}
const responses = [];
const response = (status, payload) => ({{
    ok: status >= 200 && status < 300,
    status,
    headers: {{ get(name) {{ return String(name).toLowerCase() === "content-type" ? "application/json" : null; }} }},
    async text() {{ return JSON.stringify(payload); }}
}});
const context = {{
    console,
    Headers,
    FormData,
    Blob,
    URL,
    Intl,
    CustomEvent: TestCustomEvent,
    document: {{ createElement() {{ return {{ click() {{}} }}; }} }},
    navigator: {{}},
    fetch: async () => responses.shift()
}};
context.window = context;
context.window.SURVEYONE_CONFIG = {{ apiBaseUrl: "" }};
context.window.dispatchEvent = (event) => {{ events.push(event); return true; }};
vm.runInNewContext(fs.readFileSync({common_path}, "utf8"), context);

(async () => {{
    responses.push(response(401, {{ detail: "expired" }}));
    await assert.rejects(context.Common.api.get("/api/surveys"), (error) => {{
        assert.equal(error.status, 401);
        assert.equal(error.sessionInvalid, true);
        return true;
    }});
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "surveyone:session-invalid");
    assert.equal(events[0].detail.endpoint, "/api/surveys");

    responses.push(response(401, {{ detail: "invalid credentials" }}));
    await assert.rejects(context.Common.api.post("/api/auth/login", {{}}), (error) => {{
        assert.equal(error.status, 401);
        assert.equal(error.sessionInvalid, undefined);
        return true;
    }});
    assert.equal(events.length, 1, "credential failure must not become session expiry");

    responses.push(response(401, {{ detail: "no current session" }}));
    await assert.rejects(context.Common.api.get("/api/auth/me"), (error) => {{
        assert.equal(error.sessionInvalid, undefined);
        return true;
    }});
    assert.equal(events.length, 1, "initial session probe must handle its own 401");

    let releaseStale;
    responses.push(new Promise((resolve) => {{ releaseStale = resolve; }}));
    const staleRequest = context.Common.api.get("/api/dashboard");
    responses.push(response(200, {{ data: {{ user: {{ id: "new-user" }} }} }}));
    await context.Common.api.post("/api/auth/login", {{ loginId: "user", password: "password" }});
    releaseStale(response(401, {{ detail: "old session expired" }}));
    await assert.rejects(staleRequest, (error) => {{
        assert.equal(error.sessionInvalid, undefined);
        return true;
    }});
    assert.equal(events.length, 1, "a stale 401 must not invalidate a newer login");
}})().catch((error) => {{ console.error(error); process.exitCode = 1; }});
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


def test_app_invalid_session_flow_is_single_and_clears_stale_state() -> None:
    source = (PROJECT_ROOT / "frontend" / "js" / "app.js").read_text(
        encoding="utf-8"
    )
    block = source.split("function handleInvalidSession()", 1)[1].split(
        "function setSidebar", 1
    )[0]

    assert 'window.addEventListener("surveyone:session-invalid", handleInvalidSession)' in source
    assert "if (state.sessionInvalidHandling) return;" in block
    assert "if (!state.user)" in block
    assert "state.user = null;" in block
    assert "state.routeController?.abort();" in block
    assert "/api/auth/logout" not in block
    assert 'history.replaceState(null, "", "#/M01001")' in block
    assert 'openAuth("login")' in block
    submit_block = source.split("async function submitLogin(event)", 1)[1].split(
        "async function submitSignup", 1
    )[0]
    assert "state.routeController?.abort();" in submit_block


def test_session_countdown_extend_action_and_sidebar_collapse_are_wired() -> None:
    index = (PROJECT_ROOT / "frontend" / "index.html").read_text(encoding="utf-8")
    app_source = (PROJECT_ROOT / "frontend" / "js" / "app.js").read_text(
        encoding="utf-8"
    )
    common_source = (PROJECT_ROOT / "frontend" / "js" / "common.js").read_text(
        encoding="utf-8"
    )
    css = (PROJECT_ROOT / "frontend" / "css" / "app.css").read_text(
        encoding="utf-8"
    )

    assert "data-session-status" in index
    assert "data-session-remaining" in index
    assert "data-session-extend" in index
    assert 'window.addEventListener("surveyone:session-refreshed", handleSessionRefreshed)' in app_source
    assert 'Common.api.post("/api/auth/extend", {})' in app_source
    assert "formatSessionRemaining" in app_source
    assert 'response.headers.get("X-SurveyOne-Session-Expires-At")' in common_source
    assert 'new CustomEvent("surveyone:session-refreshed"' in common_source
    assert "sidebarCollapsed: false" in app_source
    assert "body.sidebar-collapsed .app-shell" in css
    assert "body.sidebar-collapsed .app-sidebar" in css
