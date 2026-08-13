from __future__ import annotations

import base64
import hashlib
import hmac

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
