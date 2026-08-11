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
    fetch: async () => ({{
        ok: false,
        status: 401,
        headers: {{ get() {{ return "application/json"; }} }},
        async text() {{ return JSON.stringify({{ detail: "expired" }}); }}
    }})
}};
context.window = context;
context.window.SURVEYONE_CONFIG = {{ apiBaseUrl: "" }};
context.window.dispatchEvent = (event) => {{ events.push(event); return true; }};
vm.runInNewContext(fs.readFileSync({common_path}, "utf8"), context);

(async () => {{
    await assert.rejects(context.Common.api.get("/api/surveys"), (error) => {{
        assert.equal(error.status, 401);
        assert.equal(error.sessionInvalid, true);
        return true;
    }});
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "surveyone:session-invalid");
    assert.equal(events[0].detail.endpoint, "/api/surveys");

    await assert.rejects(context.Common.api.post("/api/auth/login", {{}}), (error) => {{
        assert.equal(error.status, 401);
        assert.equal(error.sessionInvalid, undefined);
        return true;
    }});
    assert.equal(events.length, 1, "credential failure must not become session expiry");
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
    assert "state.user = null;" in block
    assert "state.routeController?.abort();" in block
    assert 'credentials: "same-origin"' in block
    assert 'history.replaceState(null, "", "#/M01001")' in block
    assert 'openAuth("login")' in block
