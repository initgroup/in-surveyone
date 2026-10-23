"""SOLAPI delivery port. Credentials and provider responses never enter logs/UI."""
from __future__ import annotations

import hashlib
import hmac
import json
import re
import secrets
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener

from backend.errors import ServiceUnavailableError


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


@dataclass(frozen=True)
class DeliveryOutcome:
    delivery_id: str
    status: str  # ACCEPTED is provider receipt, not delivery to the handset.
    message_id: str | None = None
    error_code: str | None = None
    status_code: str | None = None
    message: str | None = None
    group_id: str | None = None


class SolapiTransportError(Exception):
    def __init__(self, code: str, *, uncertain: bool, message: str | None = None):
        super().__init__(code)
        self.code, self.uncertain = code, uncertain
        self.message = message


def safe_code(value: Any) -> str:
    return re.sub(r"[^A-Za-z0-9_.:-]", "", str(value or "SOLAPI_ERROR"))[:80] or "SOLAPI_ERROR"


def safe_message(value, settings, messages=()) -> str:
    text = str(value or "")[:4000]
    sensitive = [settings.solapi_api_key, settings.solapi_api_secret]
    for item in messages:
        sensitive.extend([item.get("to"), item.get("from"), item.get("text")])
        sensitive.extend((item.get("kakaoOptions", {}).get("variables") or {}).values())
    for token in sorted({str(item) for item in sensitive if item}, key=len, reverse=True):
        text = text.replace(token, "[비공개]")
    text = re.sub(r"https?://[^\s<>]+|[^\s@]+@[^\s@]+\.[^\s@]+", "[비공개]", text)
    text = re.sub(r"\+?\d(?:[\d ()-]*\d){5,}", "[번호 비공개]", text)
    return re.sub(r"[\x00-\x1f\x7f]", " ", text)[:500]


class SolapiClient:
    def __init__(self, settings):
        self.settings = settings

    def authorization(self, *, date: str | None = None, salt: str | None = None) -> str:
        date = date or datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        salt = salt or secrets.token_hex(16)
        signature = hmac.new((self.settings.solapi_api_secret or "").encode(), (date + salt).encode(), hashlib.sha256).hexdigest()
        return f"HMAC-SHA256 apiKey={self.settings.solapi_api_key}, date={date}, salt={salt}, signature={signature}"

    def request(self, method: str, path: str, payload: dict | None = None) -> Any:
        if not self.settings.solapi_api_key or not self.settings.solapi_api_secret:
            raise SolapiTransportError("SOLAPI_NOT_CONFIGURED", uncertain=False)
        # Fixed HTTPS origin and redirects disabled so auth cannot follow an external URL.
        request = Request("https://api.solapi.com" + path,
                          data=json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None,
                          method=method, headers={"Authorization": self.authorization(), "Content-Type": "application/json; charset=utf-8"})
        try:
            with build_opener(_NoRedirect()).open(request, timeout=self.settings.solapi_timeout_seconds) as response:
                raw = response.read(8 * 1024 * 1024 + 1)
            if len(raw) > 8 * 1024 * 1024:
                raise ValueError("response too large")
            return json.loads(raw)
        except HTTPError as exc:
            code, message = f"SOLAPI_HTTP_{exc.code}", "SOLAPI 요청이 거절되었습니다."
            try:
                detail = json.loads(exc.read(65536))
                if isinstance(detail, dict):
                    code = safe_code(detail.get("errorCode") or code)
                    message = safe_message(detail.get("errorMessage") or detail.get("statusMessage") or message,
                                           self.settings, (payload or {}).get("messages", []))
            except (ValueError, OSError):
                pass
            raise SolapiTransportError(code, uncertain=exc.code >= 500, message=message) from None
        except (URLError, TimeoutError, OSError, ValueError):
            raise SolapiTransportError("SOLAPI_OUTCOME_UNKNOWN", uncertain=method == "POST") from None

    def templates(self, pf_id: str) -> list[dict[str, Any]]:
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", pf_id):
            raise ServiceUnavailableError("카카오 채널 ID를 입력해 주세요.")
        try:
            result = self.request("GET", "/kakao/v2/templates/sendable?" + urlencode({"channelId": pf_id}))
        except SolapiTransportError as exc:
            raise ServiceUnavailableError(f"SOLAPI 템플릿을 조회하지 못했습니다. ({exc.code})") from None
        if not isinstance(result, list):
            raise ServiceUnavailableError("SOLAPI 템플릿 응답 형식을 확인할 수 없습니다.")
        fields = ("templateId", "name", "channelId", "content", "buttons", "variables", "status", "messageType", "emphasizeType")
        return [{key: item.get(key) for key in fields} for item in result
                if isinstance(item, dict) and item.get("status") == "APPROVED"
                and not item.get("isHidden") and not item.get("isDeleted")
                and item.get("channelId") == pf_id]

    def send_many(self, messages: list[dict[str, Any]], scheduled_at=None) -> list[DeliveryOutcome]:
        if not messages:
            return []
        payload = {"messages": messages, "strict": True, "allowDuplicates": False, "showMessageList": True}
        if scheduled_at:
            if scheduled_at <= datetime.now(timezone.utc):
                return [DeliveryOutcome(item["customFields"]["surveyoneDeliveryId"], "FAILED", error_code="SCHEDULE_EXPIRED") for item in messages]
            payload["scheduledDate"] = scheduled_at.isoformat()
        ids = {item["customFields"]["surveyoneDeliveryId"]: item for item in messages}
        try:
            result = self.request("POST", "/messages/v4/send-many/detail", payload)
        except SolapiTransportError as exc:
            return [DeliveryOutcome(key, "UNKNOWN" if exc.uncertain else "FAILED", error_code=exc.code, status_code=exc.code, message=exc.message or "요청 결과를 확인할 수 없습니다. 자동 재전송하지 않습니다.") for key in ids]
        if not isinstance(result, dict):
            return [DeliveryOutcome(key, "UNKNOWN", error_code="SOLAPI_INVALID_RESPONSE") for key in ids]
        outcomes = {}
        destinations = {item["to"]: key for key, item in ids.items()}
        for field, failed in (("messageList", False), ("failedMessageList", True)):
            rows = result.get(field) or []
            if not isinstance(rows, list):
                continue
            for row in rows:
                if not isinstance(row, dict):
                    continue
                fields = row.get("customFields")
                key = (fields.get("surveyoneDeliveryId") if isinstance(fields, dict) else None) or destinations.get(row.get("to"))
                if key not in ids:
                    continue
                message_id = str(row.get("messageId") or "")[:200] or None
                code = str(row.get("statusCode") or "")
                accepted = not failed and code == "2000" and message_id
                status = "ACCEPTED" if accepted else "FAILED" if failed or (code and code != "2000") else "UNKNOWN"
                outcomes[key] = DeliveryOutcome(key, status, message_id,
                                                None if accepted else safe_code(code if status == "FAILED" else "SOLAPI_INVALID_RESPONSE"),
                                                status_code=safe_code(code) if code else None,
                                                message=safe_message(row.get("statusMessage") or ("SOLAPI 정상 접수" if accepted else "접수 결과 확인 필요"), self.settings, messages),
                                                group_id=str((result.get("groupInfo") or {}).get("groupId") or "")[:200] or None)
        return [outcomes.get(key, DeliveryOutcome(key, "UNKNOWN", error_code="SOLAPI_OUTCOME_UNKNOWN")) for key in ids]
