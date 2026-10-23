from contextlib import contextmanager
import re

import pytest

from backend.guest_retirement import RetirementBlocked, TABLES, retire_guests


class CleanupPool:
    """Aggregate-only Oracle fixture with rollback and preservation failures."""
    def __init__(self, *, catalog=True, mixed=False, changed_members=False):
        self.catalog = catalog
        self.mixed = mixed
        self.changed_members = changed_members
        self.rows = dict.fromkeys(TABLES, 1)
        self.writes = []
        self.commits = self.rollbacks = 0
        self.value = self.rowcount = 0

    @contextmanager
    def connection(self):
        yield self

    @contextmanager
    def transaction(self):
        before = dict(self.rows)
        try:
            yield self
            self.commits += 1
        except Exception:
            self.rows = before
            self.rollbacks += 1
            raise

    def cursor(self):
        return self.connection()

    def fetchone(self):
        return (self.value,)

    def execute(self, sql, params=None):
        if sql.startswith("LOCK "):
            return
        if "DBA_CONSTRAINTS" in sql:
            if not self.catalog:
                raise RuntimeError("Catalog unavailable")
            self.value = 0
        elif "SYSTEM_ADMIN_YN" in sql:
            self.value = int(self.mixed)
        elif 'FROM "INIT$SVY_TB_TEMPLATE"' in sql or 'FROM "INIT$SVY_TB_TEMPLATE_VERSION"' in sql:
            self.value = 0
        elif sql.startswith("SELECT"):
            table = re.search(r'FROM "([^"]+)"', sql).group(1)
            if "WHERE GUEST_YN" in sql:
                self.value = self.rows["INIT$SVY_TB_USER"]
            elif "WHERE NOT (" in sql:
                self.value = 4 + int(self.changed_members and not any(self.rows.values()))
            else:
                self.value = self.rows[table]
        elif sql.startswith("DELETE"):
            assert params == {"guestType": "DB_GUEST"}
            assert " WHERE " in sql and ":guestType" in sql
            table = re.search(r'DELETE FROM "([^"]+)"', sql).group(1)
            assert table in TABLES
            self.writes.append(sql)
            self.rowcount = self.rows[table]
            self.rows[table] = 0
        elif sql.startswith("UPDATE"):
            assert 'SET ACTIVE_VERSION_NO = NULL WHERE TENANT_ID IN' in sql
            assert params == {"guestType": "DB_GUEST"}
            self.writes.append(sql)
        else:
            raise AssertionError("Unexpected statement")


def test_cleanup_preview_is_read_only():
    pool = CleanupPool()
    result = retire_guests(pool)
    assert result["mode"] == "preview"
    assert sum(result["guestRows"].values()) == len(TABLES)
    assert not pool.writes
    assert pool.commits == 0


@pytest.mark.parametrize("options", [{"catalog": False}, {"mixed": True}])
def test_cleanup_blocks_without_dba_check_or_guest_only_ownership(options):
    pool = CleanupPool(**options)
    with pytest.raises(RetirementBlocked):
        retire_guests(pool, apply=True)
    assert not pool.writes
    assert pool.commits == 0
    assert pool.rollbacks == 1
    assert all(count == 1 for count in pool.rows.values())


def test_cleanup_commits_only_guest_rows_and_preserves_members():
    pool = CleanupPool()
    result = retire_guests(pool, apply=True)
    assert result["remainingGuestUsers"] == 0
    assert result["memberRowsUnchanged"] is True
    assert sum(result["deletedRows"].values()) == len(TABLES)
    assert not any(pool.rows.values())
    assert pool.commits == 1


def test_cleanup_preservation_failure_rolls_everything_back():
    pool = CleanupPool(changed_members=True)
    with pytest.raises(RetirementBlocked, match="Member row counts changed"):
        retire_guests(pool, apply=True)
    assert pool.commits == 0
    assert pool.rollbacks == 1
    assert all(count == 1 for count in pool.rows.values())
