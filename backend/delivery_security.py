from __future__ import annotations

import base64
import hashlib
import hmac
import json

from cryptography.fernet import Fernet, InvalidToken

from backend.errors import ServiceUnavailableError


def _fernet(secret: str) -> Fernet:
    digest = hashlib.sha256(f"IN-SURVEYONE:delivery:{secret}".encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def normalize_contact(channel: str, value: str) -> str:
    candidate = value.strip()
    if channel.upper() == "EMAIL":
        return candidate.casefold()
    if channel.upper() in {"SMS", "FAX"}:
        digits = "".join(character for character in candidate if character.isdigit())
        return digits or candidate
    return candidate


def contact_hash(secret: str, channel: str, value: str) -> str:
    normalized = normalize_contact(channel, value)
    return hmac.new(
        secret.encode("utf-8"),
        f"{channel.upper()}:{normalized}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def recipient_access_token(
    secret: str,
    *,
    survey_id: str,
    survey_version: int,
    deployment_id: str,
    recipient_id: str,
) -> str:
    payload = json.dumps(
        [survey_id, survey_version, deployment_id, recipient_id],
        ensure_ascii=True,
        separators=(",", ":"),
    ).encode("utf-8")
    encrypted = _fernet(secret).encrypt(payload).decode("ascii")
    return f"d1.{encrypted}"


def recipient_access_claims(
    secret: str,
    token: str,
    *,
    survey_id: str,
    survey_version: int,
) -> tuple[str, str] | None:
    try:
        prefix, encrypted = token.split(".", 1)
        if prefix != "d1":
            return None
        payload = json.loads(
            _fernet(secret).decrypt(encrypted.encode("ascii")).decode("utf-8")
        )
        valid = (
            isinstance(payload, list)
            and len(payload) == 4
            and payload[0] == survey_id
            and payload[1] == survey_version
            and all(isinstance(value, str) and value for value in payload[2:])
        )
        return (payload[2], payload[3]) if valid else None
    except (InvalidToken, UnicodeError, ValueError, json.JSONDecodeError):
        return None


def validate_recipient_access_token(
    secret: str,
    token: str,
    *,
    survey_id: str,
    survey_version: int,
) -> bool:
    return recipient_access_claims(
        secret,
        token,
        survey_id=survey_id,
        survey_version=survey_version,
    ) is not None


def encrypt_contact(secret: str, value: str) -> str:
    return _fernet(secret).encrypt(value.encode("utf-8")).decode("ascii")


def decrypt_contact(secret: str, value: str) -> str:
    try:
        return _fernet(secret).decrypt(value.encode("ascii")).decode("utf-8")
    except (InvalidToken, UnicodeError, ValueError) as exc:
        raise ServiceUnavailableError(
            "저장된 수신자 연락처를 복호화할 수 없습니다. 발송 키 설정을 확인해 주세요."
        ) from exc


def mask_contact(channel: str, value: str | None) -> str | None:
    if not value:
        return None
    if channel.upper() == "EMAIL" and "@" in value:
        local, domain = value.split("@", 1)
        return f"{local[:1]}***@{domain}"
    if channel.upper() in {"SMS", "FAX"}:
        digits = "".join(character for character in value if character.isdigit())
        if len(digits) >= 7:
            return f"{digits[:3]}-****-{digits[-4:]}"
    return f"{value[:1]}***{value[-1:] if len(value) > 1 else ''}"


def is_masked_contact(value: str | None) -> bool:
    return bool(value and "*" in value)
