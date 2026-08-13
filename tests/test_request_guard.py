from __future__ import annotations

import asyncio
from dataclasses import replace
from typing import Any

from backend.config import get_settings
from backend.request_guard import (
    InProcessFixedWindowLimiter,
    PublicRequestGuardMiddleware,
)


def _run_guard(
    path: str,
    chunks: list[bytes],
    *,
    method: str = "POST",
    settings=None,
    headers: list[tuple[bytes, bytes]] | None = None,
    client_ip: str = "192.0.2.10",
    limiter: InProcessFixedWindowLimiter | None = None,
) -> tuple[int, int, list[tuple[bytes, bytes]]]:
    calls = 0
    sent: list[dict[str, Any]] = []

    async def downstream(scope, receive, send) -> None:
        nonlocal calls
        calls += 1
        while True:
            message = await receive()
            if message["type"] != "http.request" or not message.get(
                "more_body", False
            ):
                break
        await send({"type": "http.response.start", "status": 204, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    incoming = [
        {
            "type": "http.request",
            "body": chunk,
            "more_body": index < len(chunks) - 1,
        }
        for index, chunk in enumerate(chunks or [b""])
    ]

    async def receive() -> dict[str, Any]:
        return incoming.pop(0) if incoming else {
            "type": "http.request",
            "body": b"",
            "more_body": False,
        }

    async def send(message: dict[str, Any]) -> None:
        sent.append(message)

    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": method,
        "scheme": "http",
        "path": path,
        "raw_path": path.encode("ascii"),
        "query_string": b"",
        "headers": headers or [],
        "client": (client_ip, 54321),
        "server": ("testserver", 80),
    }
    guard = PublicRequestGuardMiddleware(
        downstream,
        settings=settings or get_settings(),
        limiter=limiter,
    )
    asyncio.run(guard(scope, receive, send))
    start = next(message for message in sent if message["type"] == "http.response.start")
    return int(start["status"]), calls, list(start.get("headers", []))


def test_content_length_and_chunked_caps_run_before_json_parsing() -> None:
    settings = replace(
        get_settings(),
        public_body_max_bytes=32,
        delivery_body_max_bytes=32,
        guest_body_max_bytes=16,
        auth_body_max_bytes=16,
    )
    oversized = b'{"answers":{}} trailing-malformed-' + b"x" * 64

    status, calls, _ = _run_guard(
        "/api/public/surveys/demo/responses",
        [b"this body must never be read"],
        settings=settings,
        headers=[(b"content-length", str(len(oversized)).encode("ascii"))],
    )
    assert (status, calls) == (413, 0)

    for method_path in (
        "/api/deployments/by-survey/survey-1",
        "/api/deployments/by-survey/survey-1/execute",
        "/api/deployments/recipients/import",
    ):
        method = "PUT" if method_path.endswith("survey-1") else "POST"
        status, calls, _ = _run_guard(
            method_path,
            [oversized[:20], oversized[20:]],
            settings=settings,
            method=method,
        )
        assert (status, calls) == (413, 0)

    guest_oversized = b'{"mode":"local"} malformed-' + b"x" * 32
    for auth_path in ("/api/auth/signup", "/api/auth/login"):
        status, calls, _ = _run_guard(
            auth_path,
            [b"auth body must never be read"],
            settings=settings,
            headers=[
                (b"content-length", str(len(guest_oversized)).encode("ascii"))
            ],
        )
        assert (status, calls) == (413, 0)

        status, calls, _ = _run_guard(
            auth_path,
            [guest_oversized[:8], guest_oversized[8:]],
            settings=settings,
        )
        assert (status, calls) == (413, 0)

    status, calls, _ = _run_guard(
        "/api/auth/guest",
        [b"guest body must never be read"],
        settings=settings,
        headers=[
            (b"content-length", str(len(guest_oversized)).encode("ascii"))
        ],
    )
    assert (status, calls) == (413, 0)

    status, calls, _ = _run_guard(
        "/api/auth/guest",
        [guest_oversized[:8], guest_oversized[8:]],
        settings=settings,
    )
    assert (status, calls) == (413, 0)

    status, calls, _ = _run_guard(
        "/api/public/surveys/demo/responses",
        [oversized[:20], oversized[20:]],
        settings=settings,
    )
    assert (status, calls) == (413, 0)


def test_process_local_rate_limits_are_keyed_by_direct_ip_and_slug() -> None:
    settings = replace(
        get_settings(),
        guest_create_rate_limit=1,
        signup_rate_limit=1,
        login_rate_limit=1,
        public_submit_rate_limit=1,
        rate_limit_window_seconds=60,
    )
    limiter = InProcessFixedWindowLimiter()

    first_guest, _, _ = _run_guard(
        "/api/auth/guest", [b"{}"], settings=settings, limiter=limiter
    )
    blocked_guest, calls, headers = _run_guard(
        "/api/auth/guest", [b"{}"], settings=settings, limiter=limiter
    )
    assert first_guest == 204
    assert (blocked_guest, calls) == (429, 0)
    assert any(name.lower() == b"retry-after" for name, _ in headers)

    for auth_path in ("/api/auth/signup", "/api/auth/login"):
        first_auth, _, _ = _run_guard(
            auth_path, [b"{}"], settings=settings, limiter=limiter
        )
        blocked_auth, calls, _ = _run_guard(
            auth_path, [b"{}"], settings=settings, limiter=limiter
        )
        assert first_auth == 204
        assert (blocked_auth, calls) == (429, 0)

    first_submit, _, _ = _run_guard(
        "/api/public/surveys/alpha/responses",
        [b"{}"],
        settings=settings,
        limiter=limiter,
    )
    blocked_submit, calls, _ = _run_guard(
        "/api/public/surveys/alpha/responses",
        [b"{}"],
        settings=settings,
        limiter=limiter,
    )
    other_slug, _, _ = _run_guard(
        "/api/public/surveys/beta/responses",
        [b"{}"],
        settings=settings,
        limiter=limiter,
    )
    other_ip, _, _ = _run_guard(
        "/api/public/surveys/alpha/responses",
        [b"{}"],
        settings=settings,
        limiter=limiter,
        client_ip="192.0.2.11",
    )
    assert first_submit == 204
    assert (blocked_submit, calls) == (429, 0)
    assert other_slug == other_ip == 204
