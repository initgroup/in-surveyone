"""Opt-in Oracle regression: synthetic CLOBs on DUAL only; no business rows or writes.

Run directly with the project venv. Never collected by default pytest.
"""
from __future__ import annotations

import json
from pathlib import Path
import re
import sys

import oracledb

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.database import close_database, get_oracle_pool  # noqa: E402
from backend.sql_loader import sql_loader  # noqa: E402


def main() -> int:
    projection = sql_loader.get("SURVEY_PUBLIC_LINKS_BY_OWNER").split('\n  FROM "INIT$SVY_TB_SURVEY" S', 1)[0]
    sql = projection + """
FROM (SELECT TO_CLOB(:snapshot) AS SNAPSHOT_JSON, 8 AS VERSION_NO FROM DUAL) V
        CROSS JOIN (SELECT 'probe' AS SURVEY_ID, 'probe-slug' AS PUBLIC_SLUG,
                           'PUBLISHED' AS STATUS_CODE FROM DUAL) S"""
    routes = [{"code": f"group-{i}", "label": f"Group {i}", "sectionIds": [f"section-{n:03d}" for n in range(100)]} for i in range(20)]
    cases = [
        ("translated-title", {"title": "Source title", "defaultLocale": "en", "translations": {"ko": {"description": "No title field"}, "en": {"title": "English title"}}, "settings": {"audienceRoutes": [], "defaultAudience": None}}, "English title", []),
        ("translation-without-title", {"title": "Source title", "defaultLocale": "en", "translations": {"en": {"questionTitles": {"q1": "Example"}}}, "settings": {"audienceRoutes": [], "defaultAudience": None}}, "Source title", []),
        ("legacy-optional-fields-absent", {"title": "Legacy title", "defaultLocale": "ko", "settings": {}}, "Legacy title", []),
        ("empty-translations", {"title": "Source title", "defaultLocale": "ko", "translations": {}, "settings": {}}, "Source title", []),
        ("null-translation-title", {"title": "Source title", "defaultLocale": "en", "translations": {"en": {"title": None}}, "settings": {"audienceRoutes": []}}, "Source title", []),
        ("large-audience-clob", {"title": "Source title", "defaultLocale": "en", "translations": {"en": {"description": "No title", "questionTitles": {f"q{i}": "Synthetic text" * 10 for i in range(500)}}}, "settings": {"audienceRoutes": routes, "defaultAudience": "group-0"}}, "Source title", routes),
    ]
    failed = []
    try:
        with get_oracle_pool().connection() as connection:
            with connection.cursor() as cursor:
                cursor.setinputsizes(snapshot=oracledb.DB_TYPE_CLOB)
                for name, snapshot, title, expected_routes in cases:
                    try:
                        cursor.execute(sql, {"snapshot": json.dumps(snapshot)})
                        row = cursor.fetchone()
                        raw_routes = row[5].read() if hasattr(row[5], "read") else row[5]
                        actual_routes = json.loads(raw_routes) if raw_routes else []
                        assert row[4] == title
                        assert actual_routes == expected_routes
                        assert row[6] == snapshot["settings"].get("defaultAudience")
                        print(f"PASS {name}")
                    except Exception as exc:
                        # No SQL exception bodies, connection details or business data.
                        failed.append(name)
                        print(json.dumps({"case": name, "errorType": type(exc).__name__, "oracleErrors": re.findall(r"ORA-\d{5}", str(exc))}))
        print(json.dumps({"cases": len(cases), "failed": len(failed), "databaseWrites": 0}))
        return int(bool(failed))
    finally:
        close_database()


if __name__ == "__main__":
    raise SystemExit(main())
