from __future__ import annotations

from dataclasses import replace
from pathlib import Path
import shutil
import subprocess

from fastapi.testclient import TestClient
import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize("exception,code,status", [
    (RuntimeError("synthetic-private-connection-detail"), "DATABASE_UNAVAILABLE", 503),
    (TimeoutError("synthetic-private-connection-detail"), "REQUEST_TIMEOUT", 504),
    (ValueError("synthetic-private-connection-detail"), "SERVER_ERROR", 500),
])
def test_server_faults_are_safe_traceable_and_never_fall_back(monkeypatch, caplog, exception, code, status):
    import main
    monkeypatch.setattr(main, "settings", replace(main.settings, db_mode="oracle"))
    def fail():
        raise exception
    monkeypatch.setattr(main, "database_status", fail)
    with TestClient(main.app, raise_server_exceptions=False) as client:
        response = client.get("/api/health")
    assert response.status_code == status
    assert response.json()["code"] == code
    assert len(response.json()["requestId"]) == 32
    assert response.headers["cache-control"] == "no-store"
    assert "synthetic-private" not in response.text
    assert "synthetic-private" not in caplog.text
    assert response.json()["requestId"] in caplog.text


def test_dedicated_error_document_is_available_without_database(monkeypatch):
    import main
    with TestClient(main.app) as client:
        response = client.get("/error")
    assert response.status_code == 200
    assert response.text.count("<main ") == 1
    assert response.text.count("<h1 ") == 1
    assert "no-store" in response.headers["cache-control"]
    assert "service-error-page.js" in response.text


def test_transport_deadlines_abort_without_replaying_and_keep_business_errors():
    node = shutil.which("node")
    if not node:
        pytest.skip("Node is optional for runtime")
    script = r"""
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let mode = 'hang', calls = 0, lastSignal;
const events = [];
const ctx = { Headers, FormData, AbortController, TypeError, setTimeout, clearTimeout,
    navigator: { onLine: true },
    SURVEYONE_CONFIG: { apiBaseUrl: '', requestTimeoutMs: 25 },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    dispatchEvent(event) { events.push(event); },
    fetch: async (path, options) => {
        calls++; lastSignal = options.signal;
        if (mode === 'hang') return new Promise(() => {});
        if (mode === 'network') throw new TypeError('private URL must not appear');
        if (mode === 'body') return { ok: true, status: 200, headers: new Headers({'content-type':'application/json'}), text: () => new Promise(() => {}) };
        const values = {
            db: [503, '{"detail":"private connection data","code":"DATABASE_UNAVAILABLE","requestId":"0123456789abcdef0123456789abcdef"}'],
            gateway: [502, '<html>private proxy diagnostic</html>'],
            malformed: [200, '{invalid private body'],
            validation: [422, '{"detail":"입력값 확인"}']
        };
        const [status, raw] = values[mode];
        return { ok: status < 400, status, headers: new Headers({'content-type': mode === 'gateway' ? 'text/html' : 'application/json'}), text: async () => raw };
    }
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('frontend/js/common.js', 'utf8'), ctx);
(async () => {
    const api = ctx.Common;
    await assert.rejects(api.request('/api/example', {method:'POST'}), error => error.code === 'REQUEST_TIMEOUT' && error.method === 'POST');
    assert.equal(calls, 1, 'a failed mutation must never be replayed');
    assert.equal(lastSignal.aborted, true);
    assert.equal(events.length, 1);
    const controller = new AbortController();
    const pending = api.request('/api/old-route', {signal: controller.signal});
    controller.abort();
    await assert.rejects(pending, error => error.name === 'AbortError');
    assert.equal(events.length, 1, 'normal route cancellation must stay silent');
    mode = 'body';
    await assert.rejects(api.request('/api/example'), error => error.code === 'REQUEST_TIMEOUT');
    mode = 'network';
    await assert.rejects(api.request('/api/example'), error => error.code === 'NETWORK_ERROR' && !error.message.includes('private'));
    ctx.navigator.onLine = false;
    await assert.rejects(api.request('/api/example'), error => error.code === 'OFFLINE');
    for (const [next, code] of [['db','DATABASE_UNAVAILABLE'], ['gateway','SERVICE_UNAVAILABLE'], ['malformed','INVALID_RESPONSE']]) {
        mode = next;
        await assert.rejects(api.request('/api/example'), error => {
            assert.equal(error.code, code);
            assert(!error.message.includes('private'));
            assert(!api.failure.markup(error).includes('private'));
            return true;
        });
    }
    const before = events.length;
    mode = 'validation';
    await assert.rejects(api.request('/api/example'), error => error.status === 422 && error.message === '입력값 확인');
    assert.equal(events.length, before);
})().catch(error => { console.error(error); process.exitCode = 1; });
"""
    result = subprocess.run([node, "-e", script], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    assert result.returncode == 0, result.stderr
