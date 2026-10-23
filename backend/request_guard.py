from __future__ import annotations

import math
import time
from threading import Lock
from typing import Callable

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from backend.config import Settings


class InProcessFixedWindowLimiter:
    """Bounded process-local defense; never a distributed edge-rate substitute."""

    def __init__(
        self,
        *,
        max_buckets: int = 10_000,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.max_buckets = max_buckets
        self.clock = clock
        self._lock = Lock()
        self._buckets: dict[str, tuple[float, int]] = {}

    def reset(self) -> None:
        with self._lock:
            self._buckets.clear()

    def allow(self, key: str, *, limit: int, window_seconds: int) -> tuple[bool, int]:
        now = self.clock()
        with self._lock:
            started_at, count = self._buckets.get(key, (now, 0))
            if now - started_at >= window_seconds:
                started_at, count = now, 0
            if count >= limit:
                retry_after = max(1, math.ceil(window_seconds - (now - started_at)))
                return False, retry_after
            self._buckets[key] = (started_at, count + 1)
            if len(self._buckets) > self.max_buckets:
                self._prune(now, window_seconds)
            return True, 0

    def _prune(self, now: float, window_seconds: int) -> None:
        expired = [
            key
            for key, (started_at, _) in self._buckets.items()
            if now - started_at >= window_seconds
        ]
        for key in expired:
            self._buckets.pop(key, None)
        overflow = len(self._buckets) - self.max_buckets
        if overflow > 0:
            oldest = sorted(
                self._buckets,
                key=lambda key: self._buckets[key][0],
            )[:overflow]
            for key in oldest:
                self._buckets.pop(key, None)


class PublicRequestGuardMiddleware:
    """Cap sensitive transport bodies and rate-limit anonymous actions."""

    _PUBLIC_PREFIX = "/api/public/surveys/"
    _PUBLIC_SUFFIX = "/responses"
    _AUTH_ACTIONS = {
        "/api/auth/signup": "signup",
        "/api/auth/login": "login",
    }

    def __init__(
        self,
        app: ASGIApp,
        *,
        settings: Settings,
        limiter: InProcessFixedWindowLimiter | None = None,
    ) -> None:
        self.app = app
        self.settings = settings
        self.limiter = limiter or InProcessFixedWindowLimiter()

    @classmethod
    def _submission_slug(cls, path: str) -> str | None:
        if not path.startswith(cls._PUBLIC_PREFIX) or not path.endswith(
            cls._PUBLIC_SUFFIX
        ):
            return None
        slug = path[len(cls._PUBLIC_PREFIX) : -len(cls._PUBLIC_SUFFIX)]
        return slug if slug and "/" not in slug else None

    @staticmethod
    def _is_delivery_write(path: str, method: str) -> bool:
        if method == "POST" and path == "/api/deployments/recipients/import":
            return True
        prefix = "/api/deployments/by-survey/"
        if method not in {"PUT", "POST"} or not path.startswith(prefix):
            return False
        suffix = path[len(prefix) :]
        if not suffix or suffix.startswith("/") or "//" in suffix:
            return False
        if method == "PUT":
            return "/" not in suffix
        return suffix.endswith("/execute") and "/" not in suffix[: -len("/execute")]

    @staticmethod
    def _direct_client_ip(scope: Scope) -> str:
        client = scope.get("client")
        return str(client[0]) if client else "unknown"

    @staticmethod
    def _content_length(scope: Scope) -> int | None:
        raw_lengths = [
            value
            for name, value in scope.get("headers", [])
            if name.lower() == b"content-length"
        ]
        if not raw_lengths:
            return None
        try:
            values = {int(value.decode("ascii")) for value in raw_lengths}
        except (UnicodeDecodeError, ValueError):
            return -1
        if len(values) != 1:
            return -1
        value = values.pop()
        return value if value >= 0 else -1

    async def _send_error(
        self,
        scope: Scope,
        receive: Receive,
        send: Send,
        *,
        status_code: int,
        detail: str,
        retry_after: int | None = None,
    ) -> None:
        headers = {"Retry-After": str(retry_after)} if retry_after else None
        response = JSONResponse(
            status_code=status_code,
            content={"detail": detail},
            headers=headers,
        )
        await response(scope, receive, send)

    async def _buffer_body(
        self,
        receive: Receive,
        *,
        maximum: int,
    ) -> list[Message] | None:
        messages: list[Message] = []
        received = 0
        while True:
            message = await receive()
            messages.append(message)
            if message["type"] == "http.disconnect":
                return messages
            if message["type"] != "http.request":
                continue
            received += len(message.get("body", b""))
            if received > maximum:
                return None
            if not message.get("more_body", False):
                return messages

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        method = scope.get("method", "GET").upper()
        path = str(scope.get("path") or "")
        submission_slug = self._submission_slug(path) if method == "POST" else None
        auth_action = self._AUTH_ACTIONS.get(path) if method == "POST" else None
        delivery_write = self._is_delivery_write(path, method)
        if submission_slug is None and auth_action is None and not delivery_write:
            await self.app(scope, receive, send)
            return

        if delivery_write:
            maximum = self.settings.delivery_body_max_bytes
            too_large_detail = "Delivery request body is too large."
        elif submission_slug is not None:
            maximum = self.settings.public_body_max_bytes
            too_large_detail = "Public response request body is too large."
        else:
            maximum = self.settings.auth_body_max_bytes
            too_large_detail = "Authentication request body is too large."
        content_length = self._content_length(scope)
        if content_length is not None and (
            content_length < 0 or content_length > maximum
        ):
            status_code = 400 if content_length < 0 else 413
            detail = (
                "Invalid Content-Length header."
                if content_length < 0
                else too_large_detail
            )
            await self._send_error(
                scope,
                receive,
                send,
                status_code=status_code,
                detail=detail,
            )
            return

        if delivery_write:
            messages = await self._buffer_body(receive, maximum=maximum)
            if messages is None:
                await self._send_error(
                    scope,
                    receive,
                    send,
                    status_code=413,
                    detail=too_large_detail,
                )
                return
            message_index = 0

            async def replay_delivery_receive() -> Message:
                nonlocal message_index
                if message_index < len(messages):
                    message = messages[message_index]
                    message_index += 1
                    return message
                return {"type": "http.request", "body": b"", "more_body": False}

            await self.app(scope, replay_delivery_receive, send)
            return

        client_ip = self._direct_client_ip(scope)
        if auth_action == "signup":
            rate_key = f"signup:{client_ip}"
            rate_limit = self.settings.signup_rate_limit
        elif auth_action == "login":
            rate_key = f"login:{client_ip}"
            rate_limit = self.settings.login_rate_limit
        else:
            rate_key = f"public-submit:{client_ip}:{submission_slug}"
            rate_limit = self.settings.public_submit_rate_limit
        allowed, retry_after = self.limiter.allow(
            rate_key,
            limit=rate_limit,
            window_seconds=self.settings.rate_limit_window_seconds,
        )
        if not allowed:
            await self._send_error(
                scope,
                receive,
                send,
                status_code=429,
                detail="Too many requests. Please retry later.",
                retry_after=retry_after,
            )
            return

        messages = await self._buffer_body(
            receive,
            maximum=maximum,
        )
        if messages is None:
            await self._send_error(
                scope,
                receive,
                send,
                status_code=413,
                detail=too_large_detail,
            )
            return

        message_index = 0

        async def replay_receive() -> Message:
            nonlocal message_index
            if message_index < len(messages):
                message = messages[message_index]
                message_index += 1
                return message
            return {"type": "http.request", "body": b"", "more_body": False}

        await self.app(scope, replay_receive, send)
