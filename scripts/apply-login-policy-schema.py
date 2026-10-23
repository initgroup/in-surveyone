"""Check or add only the global login policy; never change an existing policy."""
from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def definition(source: str) -> str:
    match = re.search(r"CREATE_TABLE_IF_MISSING\('INIT\$SVY_TB_LOGIN_POLICY',\s*q'\[\n(.*?)\n\]'\);", source, re.S)
    if not match:
        raise ValueError("Policy table definition missing")
    return match.group(1)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Create the missing policy table and default row only")
    args = parser.parse_args()
    logging.disable(logging.CRITICAL)
    from backend.database import close_database, get_oracle_pool
    try:
        ddl = (ROOT / "database/SURVEYONE_SYSTEM_DDL.sql").read_text(encoding="utf-8")
        alt = (ROOT / "database/SURVEYONE_SYSTEM_ALT.sql").read_text(encoding="utf-8")
        create = definition(ddl)
        if create != definition(alt):
            raise ValueError("Fresh and upgrade definitions differ")
        created = False
        with get_oracle_pool().connection() as connection:
            cursor = connection.cursor()
            try:
                cursor.execute("SELECT COUNT(*) FROM USER_TABLES WHERE TABLE_NAME = 'INIT$SVY_TB_LOGIN_POLICY'")
                exists = bool(cursor.fetchone()[0])
                if not exists and not args.apply:
                    print(json.dumps({"tableExists": False, "action": "Run with --apply to create the default-allow policy"}))
                    return 0
                if not exists:
                    cursor.execute(create)
                    created = True
                cursor.execute("SELECT COLUMN_NAME, DATA_TYPE, DATA_LENGTH, NULLABLE FROM USER_TAB_COLUMNS WHERE TABLE_NAME = 'INIT$SVY_TB_LOGIN_POLICY' ORDER BY COLUMN_ID")
                columns = cursor.fetchall()
                expected = [("POLICY_CODE", "VARCHAR2", 20, "N"), ("ALLOW_MULTI_YN", "CHAR", 1, "N"), ("REVISION_NO", "NUMBER", 22, "N"), ("UPDATED_BY_USER_ID", "VARCHAR2", 40, "Y"), ("UPDATED_AT", "TIMESTAMP(6) WITH TIME ZONE", 13, "Y")]
                if columns != expected:
                    raise ValueError("Existing policy columns differ from final schema")
                cursor.execute("SELECT CONSTRAINT_NAME FROM USER_CONSTRAINTS WHERE TABLE_NAME = 'INIT$SVY_TB_LOGIN_POLICY' AND STATUS = 'ENABLED' AND VALIDATED = 'VALIDATED'")
                names = {row[0] for row in cursor.fetchall()}
                if not {"INIT$SVY_PK_LOGIN_POLICY", "INIT$SVY_CK_LOGIN_POLICY_CODE", "INIT$SVY_CK_LOGIN_POLICY_MULTI", "INIT$SVY_CK_LOGIN_POLICY_REV", "INIT$SVY_FK_LOGIN_POLICY_USER"}.issubset(names):
                    raise ValueError("Policy constraints are incomplete")
                cursor.execute("SELECT COUNT(*) FROM USER_INDEXES WHERE INDEX_NAME = 'INIT$SVY_IX_LOGIN_POLICY_USER'")
                index_exists = bool(cursor.fetchone()[0])
                if not index_exists and args.apply:
                    cursor.execute('CREATE INDEX "INIT$SVY_IX_LOGIN_POLICY_USER" ON "INIT$SVY_TB_LOGIN_POLICY" ("UPDATED_BY_USER_ID")')
                    index_exists = True
                cursor.execute('SELECT ALLOW_MULTI_YN, REVISION_NO FROM "INIT$SVY_TB_LOGIN_POLICY" WHERE POLICY_CODE = \'AUTH\'')
                policy = cursor.fetchone()
                if not policy and args.apply:
                    cursor.execute("""MERGE INTO "INIT$SVY_TB_LOGIN_POLICY" P
                        USING (SELECT 'AUTH' POLICY_CODE FROM DUAL) S ON (P.POLICY_CODE = S.POLICY_CODE)
                        WHEN NOT MATCHED THEN INSERT (POLICY_CODE, ALLOW_MULTI_YN, REVISION_NO) VALUES (S.POLICY_CODE, 'Y', 1)""")
                    connection.commit()
                    cursor.execute('SELECT ALLOW_MULTI_YN, REVISION_NO FROM "INIT$SVY_TB_LOGIN_POLICY" WHERE POLICY_CODE = \'AUTH\'')
                    policy = cursor.fetchone()
                print(json.dumps({"tableExists": True, "created": created, "columnsVerified": True, "constraintsVerified": True, "auditIndexExists": index_exists, "policyExists": policy is not None, "allowConcurrentLogins": policy[0] == "Y" if policy else None, "revision": int(policy[1]) if policy else None}))
            finally:
                cursor.close()
        return 0
    except Exception as exc:
        detail = exc.args[0] if exc.args else None
        print(json.dumps({"ok": False, "errorType": type(exc).__name__, "oracleCode": getattr(detail, "code", None)}))
        return 1
    finally:
        close_database()


if __name__ == "__main__":
    raise SystemExit(main())
