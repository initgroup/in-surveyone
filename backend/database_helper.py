from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

from backend.sql_loader import SqlLoader, sql_loader


def read_oracle_value(value: Any) -> Any:
    return value.read() if hasattr(value, "read") else value


def row_dict(cursor: Any, row: Any) -> dict[str, Any]:
    names = [str(item[0]).lower() for item in cursor.description or ()]
    return {name: read_oracle_value(value) for name, value in zip(names, row)}


class OracleCrud:
    """Small SQL-ID executor; transaction ownership remains with the caller."""

    def __init__(self, loader: SqlLoader | None = None) -> None:
        self.loader = loader or sql_loader

    def fetch_one(
        self,
        connection: Any,
        sql_id: str,
        params: Mapping[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        cursor = connection.cursor()
        try:
            cursor.execute(self.loader.get(sql_id), dict(params or {}))
            row = cursor.fetchone()
            return row_dict(cursor, row) if row is not None else None
        finally:
            cursor.close()

    def fetch_all(
        self,
        connection: Any,
        sql_id: str,
        params: Mapping[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        cursor = connection.cursor()
        try:
            cursor.execute(self.loader.get(sql_id), dict(params or {}))
            return [row_dict(cursor, row) for row in cursor.fetchall()]
        finally:
            cursor.close()

    def execute(
        self,
        connection: Any,
        sql_id: str,
        params: Mapping[str, Any] | None = None,
    ) -> int:
        cursor = connection.cursor()
        try:
            cursor.execute(self.loader.get(sql_id), dict(params or {}))
            return max(0, int(cursor.rowcount or 0))
        finally:
            cursor.close()

    def executemany(
        self,
        connection: Any,
        sql_id: str,
        rows: Iterable[Mapping[str, Any]],
    ) -> int:
        values = [dict(row) for row in rows]
        if not values:
            return 0
        cursor = connection.cursor()
        try:
            cursor.executemany(self.loader.get(sql_id), values)
            return max(0, int(cursor.rowcount or 0))
        finally:
            cursor.close()
