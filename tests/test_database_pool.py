from dataclasses import replace

import pytest

from backend.config import get_settings
from backend.database import OraclePool


class FakeCursor:
    def __init__(self) -> None:
        self.statements: list[str] = []
        self.closed = False

    def execute(self, statement: str) -> None:
        self.statements.append(statement)

    def close(self) -> None:
        self.closed = True


class FakeConnection:
    def __init__(self) -> None:
        self.cursor_object = FakeCursor()

    def cursor(self) -> FakeCursor:
        return self.cursor_object


class FakeDriver:
    POOL_GETMODE_TIMEDWAIT = object()

    def __init__(self) -> None:
        self.pool_arguments = None

    def create_pool(self, **kwargs):
        self.pool_arguments = kwargs
        return object()


def test_oracle_pool_disables_parallel_dml_for_every_new_session() -> None:
    settings = replace(
        get_settings(),
        db_user="test-user",
        db_password="test-password",
        db_dsn="localhost:1521/XE",
        db_oracle_mode="thin",
        db_wallet_path=None,
    )
    driver = FakeDriver()
    pool = OraclePool(settings)
    pool._driver = lambda: driver  # type: ignore[method-assign]

    pool.get_pool()

    callback = driver.pool_arguments["session_callback"]
    connection = FakeConnection()
    callback(connection, None)
    assert connection.cursor_object.statements == [
        "ALTER SESSION DISABLE PARALLEL DML"
    ]
    assert connection.cursor_object.closed is True


def test_connection_is_returned_when_post_acquire_setup_fails() -> None:
    class SetupFailureConnection:
        closed = False

        @property
        def call_timeout(self):
            return None

        @call_timeout.setter
        def call_timeout(self, value) -> None:
            raise RuntimeError("setup failed")

        def close(self) -> None:
            self.closed = True

    class AcquiringPool:
        connection = SetupFailureConnection()

        def acquire(self):
            return self.connection

    oracle_pool = OraclePool(get_settings())
    fake_pool = AcquiringPool()
    oracle_pool.get_pool = lambda: fake_pool  # type: ignore[method-assign]

    with pytest.raises(RuntimeError, match="setup failed"):
        with oracle_pool.connection():
            pass
    assert fake_pool.connection.closed is True
