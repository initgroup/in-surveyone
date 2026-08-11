from __future__ import annotations

import logging
import re
from pathlib import Path
from threading import Lock

from backend.config import PROJECT_ROOT


logger = logging.getLogger(__name__)


class SqlLoader:
    """Loads named SQL sections from database/*.sql without executing them."""

    _section_pattern = re.compile(
        r"(?ms)^-- \[([A-Za-z0-9_]+)\][ \t]*\r?\n"
        r"(.*?)(?=^-- \[[A-Za-z0-9_]+\][ \t]*\r?$|\Z)"
    )

    def __init__(self, sql_dir: Path | None = None) -> None:
        self.sql_dir = sql_dir or PROJECT_ROOT / "database"
        self._queries: dict[str, str] = {}
        self._sources: dict[str, str] = {}
        self._lock = Lock()

    @staticmethod
    def _normalize(query: str) -> str:
        text = str(query or "").strip()
        if re.match(r"(?is)^\s*(declare|begin)\b", text):
            return re.sub(r"(?m)^\s*/\s*$", "", text).strip()
        return text.rstrip(";").strip()

    def reload(self) -> None:
        if not self.sql_dir.is_dir():
            raise RuntimeError(f"SQL directory not found: {self.sql_dir}")

        queries: dict[str, str] = {}
        sources: dict[str, str] = {}
        system_suffixes = ("_ddl.sql", "_alt.sql", "_drop.sql", "_truc.sql")
        sql_files = [
            item
            for item in self.sql_dir.glob("*.sql")
            if not item.name.lower().endswith(system_suffixes)
        ]
        for file_path in sorted(sql_files, key=lambda item: item.name.lower()):
            content = file_path.read_text(encoding="utf-8")
            for match in self._section_pattern.finditer(content):
                sql_id = match.group(1)
                if sql_id in queries:
                    raise RuntimeError(
                        f"Duplicate SQL ID {sql_id}: {sources[sql_id]}, {file_path.name}"
                    )
                query = self._normalize(match.group(2))
                if not query:
                    raise RuntimeError(f"SQL ID {sql_id} is empty in {file_path.name}.")
                queries[sql_id] = query
                sources[sql_id] = file_path.name

        if not queries:
            raise RuntimeError(f"No SQL IDs found in {self.sql_dir}.")
        with self._lock:
            self._queries = queries
            self._sources = sources
        logger.info("Loaded %s SQL IDs from %s.", len(queries), self.sql_dir)

    def get(self, sql_id: str) -> str:
        if not self._queries:
            self.reload()
        try:
            return self._queries[sql_id]
        except KeyError as exc:
            raise KeyError(f"Undefined SQL ID: {sql_id}") from exc

    def source(self, sql_id: str) -> str:
        if not self._queries:
            self.reload()
        try:
            return self._sources[sql_id]
        except KeyError as exc:
            raise KeyError(f"Undefined SQL ID: {sql_id}") from exc

    def identifiers(self) -> tuple[str, ...]:
        if not self._queries:
            self.reload()
        return tuple(sorted(self._queries))


sql_loader = SqlLoader()
