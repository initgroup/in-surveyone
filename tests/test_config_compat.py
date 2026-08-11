from __future__ import annotations

from pathlib import Path

import pytest

from backend import config
from backend.config import PROJECT_ROOT, get_settings


DB_ENV_KEYS = {
    "SURVEYONE_DB_MODE",
    "SURVEYONE_DB_USER",
    "SURVEYONE_DB_PASSWORD",
    "SURVEYONE_DB_DSN",
    "SURVEYONE_DB_ORACLE_MODE",
    "SURVEYONE_DB_CLIENT_PATH",
    "SURVEYONE_DB_WALLET_PATH",
    "SURVEYONE_DB_WALLET_PASSWORD",
    "SURVEYONE_DB_POOL_MIN",
    "SURVEYONE_DB_POOL_MAX",
    "SURVEYONE_DB_POOL_INCREMENT",
    "SURVEYONE_DB_POOL_WAIT_TIMEOUT_MS",
    "SURVEYONE_DB_CALL_TIMEOUT_MS",
    "DB_MODE",
    "DB_USER_LOC",
    "DB_PASSWORD_LOC",
    "DB_HOST",
    "DB_PORT",
    "DB_SERVICE",
    "DB_USER_CLD",
    "DB_PASSWORD_CLD",
    "DB_DSN_CLD",
    "DB_ORACLE_MODE",
    "DB_CLIENT_PATH",
    "DB_WALLET_PATH",
    "DB_WALLET_PASSWORD",
    "DB_POOL_MIN",
    "DB_POOL_MAX",
    "DB_POOL_INCREMENT",
    "DB_POOL_WAIT_TIMEOUT_MS",
    "DB_CALL_TIMEOUT_MS",
    "DB_CONNECT_TIMEOUT",
    "DB_RETRY_COUNT",
    "DB_RETRY_DELAY",
    "DB_POOL_ACQUIRE_WARN_SECONDS",
}


def _clear_database_environment(monkeypatch) -> None:
    for key in DB_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)


def _read_settings():
    return get_settings.__wrapped__()


def test_members_cloud_profile_maps_to_oracle(monkeypatch) -> None:
    with monkeypatch.context() as environment:
        _clear_database_environment(environment)
        environment.setenv("DB_MODE", "cloud")
        environment.setenv("DB_USER_CLD", "INIT$BASE02")
        environment.setenv("DB_PASSWORD_CLD", "test-password")
        environment.setenv("DB_DSN_CLD", "surveyone_high")
        environment.setenv("DB_WALLET_PATH", "wallet-test")
        environment.setenv("DB_ORACLE_MODE", "thin")
        environment.setenv("DB_POOL_MIN", "2")
        environment.setenv("DB_POOL_MAX", "7")
        environment.setenv("SURVEYONE_SESSION_SECRET", "test-session-secret")

        settings = _read_settings()

        assert settings.db_mode == "oracle"
        assert settings.db_user == "INIT$BASE02"
        assert settings.db_password == "test-password"
        assert settings.db_dsn == "surveyone_high"
        assert settings.db_wallet_path == (PROJECT_ROOT / "wallet-test").resolve()
        assert settings.db_pool_min == 2
        assert settings.db_pool_max == 7


def test_members_local_profile_builds_easy_connect_dsn(monkeypatch) -> None:
    with monkeypatch.context() as environment:
        _clear_database_environment(environment)
        environment.setenv("DB_MODE", "local")
        environment.setenv("DB_USER_LOC", "INIT$BASE02")
        environment.setenv("DB_PASSWORD_LOC", "test-password")
        environment.setenv("DB_HOST", "127.0.0.1")
        environment.setenv("DB_PORT", "1522")
        environment.setenv("DB_SERVICE", "FREEPDB1")
        environment.setenv("SURVEYONE_SESSION_SECRET", "test-session-secret")

        settings = _read_settings()

        assert settings.db_mode == "oracle"
        assert settings.db_user == "INIT$BASE02"
        assert settings.db_dsn == "127.0.0.1:1522/FREEPDB1"


def test_members_db_mode_takes_priority_over_surveyone_alias(monkeypatch) -> None:
    with monkeypatch.context() as environment:
        _clear_database_environment(environment)
        environment.setenv("SURVEYONE_DB_MODE", "memory")
        environment.setenv("DB_MODE", "cloud")
        environment.setenv("DB_USER_CLD", "INIT$BASE02")
        environment.setenv("DB_PASSWORD_CLD", "test-password")
        environment.setenv("DB_DSN_CLD", "surveyone_high")

        assert _read_settings().db_mode == "oracle"


def test_deployment_style_wallet_path_uses_existing_project_fallback(
    monkeypatch,
    tmp_path: Path,
) -> None:
    project_wallet = tmp_path / "etc" / "secrets"
    project_wallet.mkdir(parents=True)
    monkeypatch.setattr(config, "PROJECT_ROOT", tmp_path)
    monkeypatch.setenv("DB_WALLET_PATH", "/etc/secrets")

    resolved = config._optional_path("DB_WALLET_PATH", "SURVEYONE_DB_WALLET_PATH")

    assert resolved == project_wallet.resolve()


def test_development_oracle_creates_and_reuses_local_session_secret(
    monkeypatch,
    tmp_path: Path,
) -> None:
    with monkeypatch.context() as environment:
        _clear_database_environment(environment)
        environment.setattr(config, "PROJECT_ROOT", tmp_path)
        environment.setenv("DB_MODE", "cloud")
        environment.setenv("DB_USER_CLD", "INIT$BASE02")
        environment.setenv("DB_PASSWORD_CLD", "test-password")
        environment.setenv("DB_DSN_CLD", "surveyone_high")
        environment.setenv("SURVEYONE_ENV", "development")
        environment.delenv("INIT_SECRET_KEY", raising=False)
        environment.delenv("SURVEYONE_SESSION_SECRET", raising=False)

        first = _read_settings().session_secret
        second = _read_settings().session_secret

        assert len(first) >= 32
        assert second == first
        assert (tmp_path / "runtime" / ".session-secret").is_file()


def test_production_requires_explicit_session_secret(monkeypatch) -> None:
    with monkeypatch.context() as environment:
        _clear_database_environment(environment)
        environment.setenv("DB_MODE", "cloud")
        environment.setenv("DB_USER_CLD", "INIT$BASE02")
        environment.setenv("DB_PASSWORD_CLD", "test-password")
        environment.setenv("DB_DSN_CLD", "surveyone_high")
        environment.setenv("SURVEYONE_ENV", "production")
        environment.delenv("INIT_SECRET_KEY", raising=False)
        environment.delenv("SURVEYONE_SESSION_SECRET", raising=False)

        with pytest.raises(ValueError, match="required in production"):
            _read_settings()


def test_members_init_environment_keys_are_used(monkeypatch) -> None:
    with monkeypatch.context() as environment:
        _clear_database_environment(environment)
        environment.setenv("INIT_SECRET_KEY", "members-compatible-secret-value")
        environment.setenv("INIT_ALLOWED_ORIGINS", "https://survey.example.com")
        environment.setenv("INIT_COOKIE_SECURE", "Y")
        environment.setenv("INIT_COOKIE_SAMESITE", "strict")
        environment.setenv("INIT_SESSION_TTL_SECONDS", "3600")
        environment.setenv("SURVEYONE_ENV", "production")
        environment.setenv("SURVEYONE_BASE_URL", "https://survey.example.com")

        settings = _read_settings()

        assert settings.session_secret == "members-compatible-secret-value"
        assert settings.allowed_origins == ("https://survey.example.com",)
        assert settings.cookie_secure is True
        assert settings.cookie_samesite == "strict"
        assert settings.session_ttl_seconds == 3600


def test_loopback_http_disables_secure_cookie_only_in_development(monkeypatch) -> None:
    with monkeypatch.context() as environment:
        environment.setenv("SURVEYONE_ENV", "development")
        environment.setenv("SURVEYONE_BASE_URL", "http://127.0.0.1:8300")
        environment.setenv("INIT_COOKIE_SECURE", "true")

        settings = _read_settings()

        assert settings.cookie_secure is False


def test_production_rejects_insecure_cookie_or_http_origin(monkeypatch) -> None:
    with monkeypatch.context() as environment:
        environment.setenv("SURVEYONE_ENV", "production")
        environment.setenv("INIT_SECRET_KEY", "production-session-secret-value")
        environment.setenv("SURVEYONE_BASE_URL", "http://survey.example.com")
        environment.setenv("INIT_COOKIE_SECURE", "true")

        with pytest.raises(ValueError, match="must use HTTPS"):
            _read_settings()

        environment.setenv("SURVEYONE_BASE_URL", "https://survey.example.com")
        environment.setenv("INIT_COOKIE_SECURE", "false")

        with pytest.raises(ValueError, match="must be true in production"):
            _read_settings()
