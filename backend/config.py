from __future__ import annotations

import os
import secrets
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - dotenv is installed in normal environments.
    load_dotenv = None


PROJECT_ROOT = Path(__file__).resolve().parent.parent
_load_dotenv_enabled = str(os.getenv("SURVEYONE_LOAD_DOTENV", "true")).strip().lower()
if load_dotenv is not None and _load_dotenv_enabled not in {"0", "false", "no", "off"}:
    load_dotenv(PROJECT_ROOT / ".env")


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def _env_int(name: str, default: int, *, minimum: int | None = None) -> int:
    raw_value = os.getenv(name)
    value = default if raw_value is None or not raw_value.strip() else int(raw_value)
    if minimum is not None and value < minimum:
        raise ValueError(f"{name} must be at least {minimum}.")
    return value


def _first_env(*names: str) -> str | None:
    for name in names:
        value = os.getenv(name)
        if value is not None and value.strip():
            return value
    return None


def _env_int_compat(
    primary: str,
    legacy: str,
    default: int,
    *,
    minimum: int | None = None,
) -> int:
    raw_value = _first_env(primary, legacy)
    value = default if raw_value is None else int(raw_value)
    if minimum is not None and value < minimum:
        raise ValueError(f"{primary} (or {legacy}) must be at least {minimum}.")
    return value


def _normalize_origin(value: str) -> str:
    raw_value = value.strip()
    parsed = urlsplit(raw_value)
    if (
        parsed.scheme.lower() not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError(f"Invalid origin in INIT_ALLOWED_ORIGINS: {value!r}")

    scheme = parsed.scheme.lower()
    host = parsed.hostname.lower()
    if ":" in host:
        host = f"[{host}]"
    default_port = 443 if scheme == "https" else 80
    port_suffix = f":{parsed.port}" if parsed.port and parsed.port != default_port else ""
    return f"{scheme}://{host}{port_suffix}"


@dataclass(frozen=True, slots=True)
class Settings:
    app_name: str
    environment: str
    log_level: str
    host: str
    port: int
    base_url: str
    db_mode: str
    allowed_origins: tuple[str, ...]
    session_cookie_name: str
    session_secret: str
    session_ttl_seconds: int
    cookie_secure: bool
    cookie_samesite: str
    db_user: str | None
    db_password: str | None
    db_dsn: str | None
    db_oracle_mode: str
    db_client_path: Path | None
    db_wallet_path: Path | None
    db_wallet_password: str | None
    db_pool_min: int
    db_pool_max: int
    db_pool_increment: int
    db_pool_wait_timeout_ms: int
    db_call_timeout_ms: int
    db_connect_timeout: int
    db_retry_count: int
    db_retry_delay: int
    db_pool_acquire_warn_seconds: float
    guest_unused_ttl_hours: int
    guest_project_ttl_hours: int
    email_provider: str
    sms_provider: str
    kakao_provider: str
    fax_provider: str
    delivery_secret: str
    db_guest_max_projects: int
    db_guest_max_questions: int
    db_guest_max_responses: int
    public_submit_max_bytes: int
    public_body_max_bytes: int
    delivery_body_max_bytes: int
    guest_body_max_bytes: int
    auth_body_max_bytes: int
    guest_create_rate_limit: int
    signup_rate_limit: int
    login_rate_limit: int
    public_submit_rate_limit: int
    rate_limit_window_seconds: int
    admin_key: str | None = field(default=None, repr=False)


def _optional_path(name: str, legacy_name: str | None = None) -> Path | None:
    names = (name, legacy_name) if legacy_name else (name,)
    value = str(_first_env(*(item for item in names if item)) or "").strip()
    if not value:
        return None

    path = Path(value)
    project_path = (PROJECT_ROOT / value.lstrip("/\\")).resolve()
    if path.is_absolute():
        if path.exists() or not project_path.exists():
            return path
        return project_path
    return project_path


def _development_session_secret() -> str:
    secret_path = PROJECT_ROOT / "runtime" / ".session-secret"

    def read_existing() -> str:
        value = secret_path.read_text(encoding="utf-8").strip()
        if len(value) < 32:
            raise ValueError(
                "The development session secret is invalid. Remove "
                "runtime/.session-secret and restart the application."
            )
        return value

    if secret_path.exists():
        return read_existing()

    secret_path.parent.mkdir(parents=True, exist_ok=True)
    generated = secrets.token_urlsafe(48)
    try:
        with secret_path.open("x", encoding="utf-8", newline="\n") as secret_file:
            secret_file.write(generated)
    except FileExistsError:
        return read_existing()
    return generated


def _resolved_cookie_secure(base_url: str, environment: str) -> bool:
    requested = (
        _env_bool("INIT_COOKIE_SECURE", False)
        if os.getenv("INIT_COOKIE_SECURE") is not None
        else _env_bool("SURVEYONE_COOKIE_SECURE", False)
    )
    parsed = urlsplit(base_url)
    production = environment in {"production", "prod"}
    loopback = (parsed.hostname or "").lower() in {"127.0.0.1", "localhost", "::1"}

    if production:
        if parsed.scheme.lower() != "https":
            raise ValueError("Production SURVEYONE_BASE_URL must use HTTPS.")
        if not requested:
            raise ValueError("INIT_COOKIE_SECURE must be true in production.")
        return True

    if requested and parsed.scheme.lower() != "https":
        if not loopback:
            raise ValueError(
                "Secure cookies require HTTPS; only loopback development may use HTTP."
            )
        # A Secure cookie cannot be relied on over the local HTTP development URL.
        # Keep the production setting strict while making Ctrl+Shift+B usable locally.
        return False
    return requested


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    surveyone_db_mode = str(os.getenv("SURVEYONE_DB_MODE") or "").strip().lower()
    legacy_db_mode = str(os.getenv("DB_MODE") or "").strip().lower()
    requested_db_mode = legacy_db_mode or surveyone_db_mode or "oracle"
    db_mode_aliases = {
        "memory": "memory",
        "oracle": "oracle",
        "cloud": "oracle",
        "local": "oracle",
    }
    try:
        db_mode = db_mode_aliases[requested_db_mode]
    except KeyError as exc:
        raise ValueError(
            "Database mode must be memory/oracle, or compatible DB_MODE local/cloud."
        ) from exc

    legacy_profile = legacy_db_mode if legacy_db_mode in {"local", "cloud"} else "cloud"
    if legacy_profile == "local":
        legacy_db_user = _first_env("DB_USER_LOC")
        legacy_db_password = _first_env("DB_PASSWORD_LOC")
        legacy_host = str(_first_env("DB_HOST") or "127.0.0.1").strip()
        legacy_port = int(str(_first_env("DB_PORT") or "1521").strip())
        legacy_service = str(_first_env("DB_SERVICE") or "").strip()
        legacy_db_dsn = (
            f"{legacy_host}:{legacy_port}/{legacy_service}"
            if legacy_service
            else None
        )
    else:
        legacy_db_user = _first_env("DB_USER_CLD")
        legacy_db_password = _first_env("DB_PASSWORD_CLD")
        legacy_db_dsn = _first_env("DB_DSN_CLD")

    db_user = legacy_db_user or _first_env("SURVEYONE_DB_USER")
    db_password = legacy_db_password or _first_env("SURVEYONE_DB_PASSWORD")
    db_dsn = legacy_db_dsn or _first_env("SURVEYONE_DB_DSN")

    raw_origins = str(
        _first_env("INIT_ALLOWED_ORIGINS", "SURVEYONE_ALLOWED_ORIGINS") or ""
    ).strip()
    origin_values = (
        [item for item in raw_origins.split(",") if item.strip()]
        if raw_origins
        else ["http://127.0.0.1:8300", "http://localhost:8300"]
    )
    if "*" in origin_values:
        raise ValueError("INIT_ALLOWED_ORIGINS cannot contain '*'.")
    allowed_origins = tuple(dict.fromkeys(_normalize_origin(item) for item in origin_values))

    samesite = str(
        _first_env("INIT_COOKIE_SAMESITE", "SURVEYONE_COOKIE_SAMESITE") or "lax"
    ).strip().lower()
    if samesite not in {"lax", "strict", "none"}:
        raise ValueError("INIT_COOKIE_SAMESITE must be lax, strict, or none.")

    pool_min = _env_int_compat("DB_POOL_MIN", "SURVEYONE_DB_POOL_MIN", 1, minimum=0)
    pool_max = _env_int_compat("DB_POOL_MAX", "SURVEYONE_DB_POOL_MAX", 6, minimum=1)
    if pool_max < pool_min:
        raise ValueError("DB_POOL_MAX must be >= DB_POOL_MIN.")

    oracle_mode = str(
        _first_env("DB_ORACLE_MODE", "SURVEYONE_DB_ORACLE_MODE") or "thin"
    ).strip().lower()
    if oracle_mode not in {"thin", "thick"}:
        raise ValueError("DB_ORACLE_MODE must be 'thin' or 'thick'.")

    host = str(os.getenv("SURVEYONE_HOST", "127.0.0.1")).strip() or "127.0.0.1"
    port = _env_int("SURVEYONE_PORT", 8300, minimum=1)
    base_url = str(
        os.getenv("SURVEYONE_BASE_URL", f"http://{host}:{port}")
    ).strip().rstrip("/")
    if not base_url:
        raise ValueError("SURVEYONE_BASE_URL cannot be empty.")

    session_secret = str(
        _first_env("INIT_SECRET_KEY", "SURVEYONE_SESSION_SECRET") or ""
    ).strip()
    environment = str(os.getenv("SURVEYONE_ENV", "development")).strip().lower()
    if not session_secret:
        if environment in {"production", "prod"}:
            raise ValueError(
                "INIT_SECRET_KEY is required in production environments."
            )
        session_secret = _development_session_secret()
    delivery_secret = str(os.getenv("SURVEYONE_DELIVERY_SECRET") or "").strip()
    if not delivery_secret:
        if environment in {"production", "prod"}:
            raise ValueError(
                "SURVEYONE_DELIVERY_SECRET is required in production environments."
            )
        delivery_secret = session_secret

    return Settings(
        app_name=str(
            _first_env("APP_NAME", "SURVEYONE_APP_NAME") or "IN-SURVEYONE"
        ).strip(),
        environment=environment,
        log_level=str(
            _first_env("LOG_LEVEL", "SURVEYONE_LOG_LEVEL") or "INFO"
        ).strip().upper(),
        host=host,
        port=port,
        base_url=base_url,
        db_mode=db_mode,
        allowed_origins=allowed_origins,
        session_cookie_name=(
            str(os.getenv("SURVEYONE_SESSION_COOKIE_NAME", "in_surveyone_session_v1")).strip()
            or "in_surveyone_session_v1"
        ),
        session_secret=session_secret,
        session_ttl_seconds=_env_int_compat(
            "INIT_SESSION_TTL_SECONDS",
            "SURVEYONE_SESSION_TTL_SECONDS",
            28_800,
            minimum=300,
        ),
        cookie_secure=_resolved_cookie_secure(base_url, environment),
        cookie_samesite=samesite,
        db_user=str(db_user or "").strip() or None,
        db_password=db_password or None,
        db_dsn=str(db_dsn or "").strip() or None,
        db_oracle_mode=oracle_mode,
        db_client_path=_optional_path("DB_CLIENT_PATH", "SURVEYONE_DB_CLIENT_PATH"),
        db_wallet_path=_optional_path("DB_WALLET_PATH", "SURVEYONE_DB_WALLET_PATH"),
        db_wallet_password=(
            _first_env("DB_WALLET_PASSWORD", "SURVEYONE_DB_WALLET_PASSWORD") or None
        ),
        db_pool_min=pool_min,
        db_pool_max=pool_max,
        db_pool_increment=_env_int_compat(
            "DB_POOL_INCREMENT", "SURVEYONE_DB_POOL_INCREMENT", 1, minimum=1
        ),
        db_pool_wait_timeout_ms=_env_int_compat(
            "DB_POOL_WAIT_TIMEOUT_MS",
            "SURVEYONE_DB_POOL_WAIT_TIMEOUT_MS",
            30_000,
            minimum=1_000,
        ),
        db_call_timeout_ms=_env_int_compat(
            "DB_CALL_TIMEOUT_MS",
            "SURVEYONE_DB_CALL_TIMEOUT_MS",
            60_000,
            minimum=0,
        ),
        db_connect_timeout=_env_int("DB_CONNECT_TIMEOUT", 10, minimum=1),
        db_retry_count=_env_int("DB_RETRY_COUNT", 1, minimum=0),
        db_retry_delay=_env_int("DB_RETRY_DELAY", 1, minimum=0),
        db_pool_acquire_warn_seconds=float(
            os.getenv("DB_POOL_ACQUIRE_WARN_SECONDS", "3")
        ),
        guest_unused_ttl_hours=_env_int(
            "SURVEYONE_GUEST_UNUSED_TTL_HOURS", 24, minimum=1
        ),
        guest_project_ttl_hours=_env_int(
            "SURVEYONE_GUEST_PROJECT_TTL_HOURS", 168, minimum=1
        ),
        email_provider=str(os.getenv("SURVEYONE_EMAIL_PROVIDER", "disabled")).strip().lower(),
        sms_provider=str(os.getenv("SURVEYONE_SMS_PROVIDER", "disabled")).strip().lower(),
        kakao_provider=str(os.getenv("SURVEYONE_KAKAO_PROVIDER", "disabled")).strip().lower(),
        fax_provider=str(os.getenv("SURVEYONE_FAX_PROVIDER", "disabled")).strip().lower(),
        delivery_secret=delivery_secret,
        db_guest_max_projects=_env_int(
            "SURVEYONE_DB_GUEST_MAX_PROJECTS", 10, minimum=1
        ),
        db_guest_max_questions=_env_int(
            "SURVEYONE_DB_GUEST_MAX_QUESTIONS", 300, minimum=1
        ),
        db_guest_max_responses=_env_int(
            "SURVEYONE_DB_GUEST_MAX_RESPONSES", 2_000, minimum=1
        ),
        public_submit_max_bytes=_env_int(
            "SURVEYONE_PUBLIC_SUBMIT_MAX_BYTES", 262_144, minimum=4_096
        ),
        public_body_max_bytes=_env_int(
            "SURVEYONE_PUBLIC_BODY_MAX_BYTES", 524_288, minimum=4_096
        ),
        delivery_body_max_bytes=_env_int(
            "SURVEYONE_DELIVERY_BODY_MAX_BYTES", 4_194_304, minimum=65_536
        ),
        guest_body_max_bytes=_env_int(
            "SURVEYONE_GUEST_BODY_MAX_BYTES", 16_384, minimum=1_024
        ),
        auth_body_max_bytes=_env_int(
            "SURVEYONE_AUTH_BODY_MAX_BYTES", 16_384, minimum=1_024
        ),
        guest_create_rate_limit=_env_int(
            "SURVEYONE_GUEST_CREATE_RATE_LIMIT", 60, minimum=1
        ),
        signup_rate_limit=_env_int(
            "SURVEYONE_SIGNUP_RATE_LIMIT", 30, minimum=1
        ),
        login_rate_limit=_env_int(
            "SURVEYONE_LOGIN_RATE_LIMIT", 30, minimum=1
        ),
        public_submit_rate_limit=_env_int(
            "SURVEYONE_PUBLIC_SUBMIT_RATE_LIMIT", 120, minimum=1
        ),
        rate_limit_window_seconds=_env_int(
            "SURVEYONE_RATE_LIMIT_WINDOW_SECONDS", 60, minimum=1
        ),
        admin_key=str(os.getenv("INIT_ADMIN_KEY") or "").strip() or None,
    )
