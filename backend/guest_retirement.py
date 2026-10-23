"""One-time, narrowly scoped retirement of legacy DB_GUEST workspaces.

No DDL, credential/body reads, exports, or external delivery. Preview by default.
"""
from __future__ import annotations

from typing import Any


# Children precede their parents. These are the only tables this tool may mutate.
TABLES = (
    "INIT$SVY_TB_AUDIT_LOG",
    "INIT$SVY_TB_REPORT_RUN",
    "INIT$SVY_TB_REPORT_DEFINITION",
    "INIT$SVY_TB_DELIVERY",
    "INIT$SVY_TB_DELIVERY_RECIPIENT",
    "INIT$SVY_TB_DELIVERY_TARGET",
    "INIT$SVY_TB_DELIVERY_BATCH",
    "INIT$SVY_TB_SURVEY_DEPLOYMENT",
    "INIT$SVY_TB_SURVEY_SKIN",
    "INIT$SVY_TB_RESPONSE_ANSWER",
    "INIT$SVY_TB_RESPONSE",
    "INIT$SVY_TB_SURVEY_I18N",
    "INIT$SVY_TB_SURVEY_LANG",
    "INIT$SVY_TB_SURVEY_VERSION",
    "INIT$SVY_TB_SURVEY",
    "INIT$SVY_TB_GUEST_CAP",
    "INIT$SVY_TB_AUTH_SESSION",
    "INIT$SVY_TB_USER",
    "INIT$SVY_TB_TENANT",
)
TENANTS = '(SELECT TENANT_ID FROM "INIT$SVY_TB_TENANT" WHERE TENANT_TYPE_CODE = :guestType)'
USERS = f'(SELECT USER_ID FROM "INIT$SVY_TB_USER" WHERE TENANT_ID IN {TENANTS})'
SURVEYS = f'(SELECT SURVEY_ID FROM "INIT$SVY_TB_SURVEY" WHERE TENANT_ID IN {TENANTS})'
PARAMS = {"guestType": "DB_GUEST"}


class RetirementBlocked(RuntimeError):
    """A non-sensitive reason why no data can be changed."""


def _count(cursor: Any, sql: str, params: dict | None = None) -> int:
    cursor.execute(sql, params or {})
    return int(cursor.fetchone()[0])


def _predicate(table: str) -> str:
    if table not in TABLES:
        raise RetirementBlocked("Table is outside the retirement allowlist.")
    return f'USER_ID IN {USERS}' if table == "INIT$SVY_TB_AUTH_SESSION" else f'TENANT_ID IN {TENANTS}'


def _counts(cursor: Any, *, members: bool = False) -> dict[str, int]:
    return {
        table: _count(cursor, f'SELECT COUNT(*) FROM "{table}" WHERE {"NOT " if members else ""}({_predicate(table)})', PARAMS)
        for table in TABLES
    }


def _validate_scope(cursor: Any) -> None:
    inconsistent = _count(cursor, f'''SELECT COUNT(*) FROM "INIT$SVY_TB_USER"
        WHERE (TENANT_ID IN {TENANTS} AND
          (GUEST_YN <> 'Y' OR ROLE_CODE <> 'GUEST' OR GUEST_MODE_CODE <> 'DB' OR SYSTEM_ADMIN_YN <> 'N'))
        OR (TENANT_ID NOT IN {TENANTS} AND (GUEST_YN = 'Y' OR ROLE_CODE = 'GUEST' OR GUEST_MODE_CODE = 'DB'))''', PARAMS)
    if inconsistent:
        raise RetirementBlocked("Mixed member/guest ownership detected; no changes made.")
    shared = _count(cursor, f'''SELECT COUNT(*) FROM "INIT$SVY_TB_TEMPLATE"
        WHERE CREATED_BY IN {USERS} OR UPDATED_BY IN {USERS} OR SOURCE_SURVEY_ID IN {SURVEYS}''', PARAMS)
    shared += _count(cursor, f'''SELECT COUNT(*) FROM "INIT$SVY_TB_TEMPLATE_VERSION"
        WHERE PUBLISHED_BY IN {USERS} OR SOURCE_SURVEY_ID IN {SURVEYS}''', PARAMS)
    if shared:
        raise RetirementBlocked("Shared templates reference guest data; no changes made.")
    # Refuse unseen cross-schema references or additional child tables. Never
    # disable constraints or rely on cascade deletion of an unreviewed table.
    names = ",".join("'" + name + "'" for name in TABLES)
    try:
        external = _count(cursor, f'''SELECT COUNT(*)
            FROM DBA_CONSTRAINTS C JOIN DBA_CONSTRAINTS P
              ON C.R_OWNER = P.OWNER AND C.R_CONSTRAINT_NAME = P.CONSTRAINT_NAME
            WHERE C.CONSTRAINT_TYPE = 'R'
              AND P.OWNER = SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')
              AND P.TABLE_NAME IN ({names})
              AND (C.OWNER <> P.OWNER OR C.TABLE_NAME NOT IN ({names}, 'INIT$SVY_TB_TEMPLATE', 'INIT$SVY_TB_TEMPLATE_VERSION'))''')
    except Exception as exc:
        raise RetirementBlocked("Cannot verify cross-schema foreign keys; no changes made.") from exc
    if external:
        raise RetirementBlocked("Unreviewed foreign-key references exist; no changes made.")


def retire_guests(pool: Any, *, apply: bool = False) -> dict[str, object]:
    """Return aggregate counts; commit only after guest-zero/member checks pass."""
    manager = pool.transaction if apply else pool.connection
    with manager() as connection:
        with connection.cursor() as cursor:
            if apply:
                # Short maintenance transaction; NOWAIT aborts instead of
                # waiting on active work. No table structure is changed.
                for table in ("INIT$SVY_TB_TENANT", "INIT$SVY_TB_USER", *TABLES[:-2]):
                    cursor.execute(f'LOCK TABLE "{table}" IN EXCLUSIVE MODE NOWAIT')
            if apply:
                for table in ("INIT$SVY_TB_TEMPLATE", "INIT$SVY_TB_TEMPLATE_VERSION"):
                    cursor.execute(f'LOCK TABLE "{table}" IN SHARE MODE NOWAIT')
            _validate_scope(cursor)
            before = _counts(cursor)
            preserved = _counts(cursor, members=True)
            if not apply:
                return {"mode": "preview", "guestRows": before, "preservedRows": preserved}
            cursor.execute(f'UPDATE "INIT$SVY_TB_SURVEY" SET ACTIVE_VERSION_NO = NULL WHERE TENANT_ID IN {TENANTS}', PARAMS)
            deleted = {}
            for table in TABLES:
                cursor.execute(f'DELETE FROM "{table}" WHERE {_predicate(table)}', PARAMS)
                deleted[table] = cursor.rowcount
                if deleted[table] != before[table]:
                    raise RetirementBlocked("Row counts changed during retirement; transaction rolled back.")
            if any(_counts(cursor).values()):
                raise RetirementBlocked("Guest rows remain; transaction rolled back.")
            if _counts(cursor, members=True) != preserved:
                raise RetirementBlocked("Member row counts changed; transaction rolled back.")
            remaining = _count(cursor, 'SELECT COUNT(*) FROM "INIT$SVY_TB_USER" WHERE GUEST_YN = \'Y\' OR ROLE_CODE = \'GUEST\' OR GUEST_MODE_CODE = \'DB\'')
            if remaining:
                raise RetirementBlocked("Legacy guest identities remain; transaction rolled back.")
            return {"mode": "applied", "deletedRows": deleted, "memberRowsUnchanged": True, "remainingGuestUsers": 0}
