from __future__ import annotations

import logging
import time
from contextlib import contextmanager
from threading import Lock
from typing import Any, Iterator

from backend.config import Settings, get_settings


logger = logging.getLogger(__name__)


class OraclePool:
    """Lazy Oracle pool using the shared INIT DB_MODE contract.

    Runtime development and production both use Oracle. The driver import stays
    lazy so isolated automated repository tests can use their explicit memory
    fixture without loading native Oracle components.
    """

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._pool: Any | None = None
        self._lock = Lock()
        self._client_initialized = False

    def _driver(self):
        try:
            import oracledb
        except ImportError as exc:  # pragma: no cover - depends on optional runtime mode.
            raise RuntimeError(
                "python-oracledb is required when DB_MODE is local or cloud."
            ) from exc
        return oracledb

    def _connect_args(self, oracledb) -> dict[str, Any]:
        settings = self.settings
        if not settings.db_user or not settings.db_password or not settings.db_dsn:
            raise RuntimeError(
                "Oracle user, password, and DSN settings are required. Use "
                "the DB_MODE local/cloud profile from .env."
            )

        if settings.db_oracle_mode == "thick":
            if settings.db_client_path is None:
                raise RuntimeError(
                    "DB_CLIENT_PATH is required for thick Oracle mode."
                )
            if not self._client_initialized:
                try:
                    oracledb.init_oracle_client(
                        lib_dir=str(settings.db_client_path),
                        config_dir=(
                            str(settings.db_wallet_path)
                            if settings.db_wallet_path is not None
                            else None
                        ),
                    )
                except oracledb.ProgrammingError:
                    # Another pool may already have initialized the process client.
                    pass
                self._client_initialized = True

        args: dict[str, Any] = {
            "user": settings.db_user,
            "password": settings.db_password,
            "dsn": settings.db_dsn,
            "tcp_connect_timeout": settings.db_connect_timeout,
            "retry_count": settings.db_retry_count,
            "retry_delay": settings.db_retry_delay,
        }
        if settings.db_oracle_mode == "thin":
            wallet_path = settings.db_wallet_path
            if wallet_path is not None and wallet_path.exists():
                args["config_dir"] = str(wallet_path)
                args["wallet_location"] = str(wallet_path)
                if settings.db_wallet_password:
                    args["wallet_password"] = settings.db_wallet_password
            elif "/" not in settings.db_dsn and ":" not in settings.db_dsn:
                raise RuntimeError(
                    f"DB_WALLET_PATH directory not found or inaccessible: {wallet_path}. "
                    "A TNS alias requires tnsnames.ora in this directory."
                )
        return args

    @staticmethod
    def _initialize_session(connection: Any, _requested_tag: str | None) -> None:
        """Keep application DML serial even if the database profile forces PDML."""
        cursor = connection.cursor()
        try:
            cursor.execute("ALTER SESSION DISABLE PARALLEL DML")
        finally:
            cursor.close()

    def get_pool(self):
        if self._pool is not None:
            return self._pool
        with self._lock:
            if self._pool is not None:
                return self._pool
            oracledb = self._driver()
            self._pool = oracledb.create_pool(
                **self._connect_args(oracledb),
                min=self.settings.db_pool_min,
                max=self.settings.db_pool_max,
                increment=self.settings.db_pool_increment,
                session_callback=self._initialize_session,
                getmode=oracledb.POOL_GETMODE_TIMEDWAIT,
                wait_timeout=max(
                    1_000,
                    min(30_000, self.settings.db_pool_wait_timeout_ms),
                ),
            )
            logger.info(
                "IN-SURVEYONE Oracle pool initialized. min=%s max=%s",
                self.settings.db_pool_min,
                self.settings.db_pool_max,
            )
            return self._pool

    @contextmanager
    def connection(self) -> Iterator[Any]:
        pool = self.get_pool()
        started_at = time.monotonic()
        connection = pool.acquire()
        try:
            connection.call_timeout = self.settings.db_call_timeout_ms
            elapsed = time.monotonic() - started_at
            log_method = (
                logger.warning
                if elapsed >= self.settings.db_pool_acquire_warn_seconds
                else logger.info
            )
            log_method("Oracle pool acquire completed in %.3fs.", elapsed)
            yield connection
        finally:
            connection.close()

    @contextmanager
    def transaction(self) -> Iterator[Any]:
        with self.connection() as connection:
            try:
                yield connection
                connection.commit()
            except Exception:
                connection.rollback()
                raise

    def ping(self) -> None:
        with self.connection() as connection:
            connection.ping()

    def close(self) -> None:
        with self._lock:
            if self._pool is not None:
                self._pool.close(force=True)
                self._pool = None


_oracle_pool = OraclePool(get_settings())


def get_oracle_pool() -> OraclePool:
    if get_settings().db_mode != "oracle":
        raise RuntimeError("Oracle pool requested while DB_MODE is not local/cloud.")
    return _oracle_pool


def close_database() -> None:
    _oracle_pool.close()


def database_status() -> dict[str, str]:
    settings = get_settings()
    return {
        "mode": settings.db_mode,
        "state": "ready" if settings.db_mode == "memory" else "configured",
    }
