from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATABASE = ROOT / "database"
DDL_PATH = DATABASE / "SURVEYONE_SYSTEM_DDL.sql"
ALT_PATH = DATABASE / "SURVEYONE_SYSTEM_ALT.sql"
DROP_PATH = DATABASE / "SURVEYONE_SYSTEM_DROP.sql"
TRUC_PATH = DATABASE / "SURVEYONE_SYSTEM_TRUC.sql"
LEGACY_DROP_PATH = DATABASE / "TEMP_SVY_LEGACY_DROP.sql"

PREFIX = "INIT$SVY_"
EXPECTED_TABLES = {
    "INIT$SVY_TB_AUDIT_LOG",
    "INIT$SVY_TB_AUTH_SESSION",
    "INIT$SVY_TB_DELIVERY",
    "INIT$SVY_TB_DELIVERY_RECIPIENT",
    "INIT$SVY_TB_GUEST_CAP",
    "INIT$SVY_TB_LANGUAGE",
    "INIT$SVY_TB_PAGE_HELP",
    "INIT$SVY_TB_REPORT_DEFINITION",
    "INIT$SVY_TB_REPORT_RUN",
    "INIT$SVY_TB_RESPONSE",
    "INIT$SVY_TB_RESPONSE_ANSWER",
    "INIT$SVY_TB_SURVEY",
    "INIT$SVY_TB_SURVEY_DEPLOYMENT",
    "INIT$SVY_TB_SURVEY_I18N",
    "INIT$SVY_TB_SURVEY_LANG",
    "INIT$SVY_TB_SURVEY_SKIN",
    "INIT$SVY_TB_SURVEY_VERSION",
    "INIT$SVY_TB_TEMPLATE",
    "INIT$SVY_TB_TENANT",
    "INIT$SVY_TB_USER",
}


def _read(path: Path) -> str:
    raw = path.read_bytes()
    assert not raw.startswith(b"\xef\xbb\xbf"), f"{path.name} must not contain a UTF-8 BOM"
    assert b"\r\n" not in raw, f"{path.name} must use LF line endings"
    return raw.decode("utf-8")


def _table_definitions(source: str) -> dict[str, str]:
    pattern = re.compile(
        r"CREATE_TABLE_IF_MISSING\('([^']+)',\s*q'\[\n(.*?)\n\]'\);",
        re.DOTALL,
    )
    return {match.group(1): match.group(2) for match in pattern.finditer(source)}


def _normalize_sql(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def test_ddl_and_alt_have_identical_final_table_definitions() -> None:
    ddl_tables = _table_definitions(_read(DDL_PATH))
    alt_tables = _table_definitions(_read(ALT_PATH))

    assert set(ddl_tables) == EXPECTED_TABLES
    assert set(alt_tables) == EXPECTED_TABLES
    for table_name in sorted(EXPECTED_TABLES):
        assert _normalize_sql(ddl_tables[table_name]) == _normalize_sql(alt_tables[table_name])


def test_all_declared_oracle_identifiers_use_project_prefix_and_fit_30_bytes() -> None:
    ddl = _read(DDL_PATH)
    patterns = (
        r'CREATE TABLE "([A-Z0-9$_]+)"',
        r'CREATE (?:UNIQUE )?INDEX "([A-Z0-9$_]+)"',
        r'CONSTRAINT "([A-Z0-9$_]+)"',
        r'CREATE OR REPLACE FUNCTION "([A-Z0-9$_]+)"',
    )
    names = {
        match.group(1)
        for pattern in patterns
        for match in re.finditer(pattern, ddl, re.IGNORECASE)
    }

    assert names
    assert all(name.startswith(PREFIX) for name in names)
    assert all(len(name.encode("ascii")) <= 30 for name in names)

    assert len(re.findall(r'CREATE TABLE "INIT\$SVY_', ddl)) == 20
    assert len(set(re.findall(r'CREATE (?:UNIQUE )?INDEX "(INIT\$SVY_[A-Z0-9_]+)"', ddl))) == 20
    assert len(set(re.findall(r'CONSTRAINT "(INIT\$SVY_[A-Z0-9_]+)"', ddl))) == 123
    assert len(re.findall(r'CREATE OR REPLACE FUNCTION "INIT\$SVY_', ddl)) == 2


def test_install_and_upgrade_scripts_are_idempotent_and_non_destructive() -> None:
    ddl = _read(DDL_PATH)
    alt = _read(ALT_PATH)
    destructive = re.compile(
        r"\b(?:DROP|TRUNCATE)\s+(?:TABLE|INDEX|SEQUENCE|VIEW|SCHEMA|USER)\b",
        re.IGNORECASE,
    )

    assert not destructive.search(ddl)
    assert not destructive.search(alt)
    assert "CREATE_TABLE_IF_MISSING" in ddl
    assert "CREATE_TABLE_IF_MISSING" in alt
    assert "CREATE_INDEX_IF_MISSING" in ddl
    assert "CREATE_INDEX_IF_MISSING" in alt
    assert "ADD_COLUMN_IF_MISSING" in alt
    assert "SVY$_TB_" in alt
    assert "RENAME TO" in alt
    assert "RENAME CONSTRAINT" in alt
    assert "ALTER INDEX" in alt and "RENAME TO" in alt
    assert alt.count('CREATE OR REPLACE FUNCTION "INIT$SVY_FN_') == 2
    for source in (ddl, alt):
        assert "WHENEVER SQLERROR EXIT SQL.SQLCODE ROLLBACK" in source


def test_i18n_resource_id_is_wide_enough_and_upgrade_only_widens() -> None:
    ddl_tables = _table_definitions(_read(DDL_PATH))
    alt = _read(ALT_PATH)
    i18n_definition = ddl_tables["INIT$SVY_TB_SURVEY_I18N"]

    assert '"RESOURCE_ID" VARCHAR2(200 BYTE) NOT NULL ENABLE' in i18n_definition
    assert '"RESOURCE_ID" VARCHAR2(80 BYTE)' not in i18n_definition
    assert "PROCEDURE WIDEN_VARCHAR2_IF_NEEDED" in alt
    assert "V_DATA_LENGTH < P_MIN_BYTES" in alt
    assert "VARCHAR2('" in alt and "P_MIN_BYTES" in alt
    assert (
        "WIDEN_VARCHAR2_IF_NEEDED('INIT$SVY_TB_SURVEY_I18N', 'RESOURCE_ID', 200);"
        in alt
    )


def test_guest_language_help_and_destructive_utility_contracts() -> None:
    ddl = _read(DDL_PATH)
    alt = _read(ALT_PATH)
    drop_sql = _read(DROP_PATH)
    truc_sql = _read(TRUC_PATH)

    for token in (
        '"TENANT_TYPE_CODE"',
        '"GUEST_MODE_CODE"',
        '"INIT$SVY_TB_GUEST_CAP"',
        '"INIT$SVY_TB_LANGUAGE"',
        '"INIT$SVY_TB_SURVEY_LANG"',
        '"INIT$SVY_TB_SURVEY_I18N"',
        '"INIT$SVY_TB_PAGE_HELP"',
        '"INIT$SVY_FN_GUEST_CAN"',
        '"INIT$SVY_FN_I18N_TEXT"',
    ):
        assert token in ddl

    seed_pattern = re.compile(
        r'MERGE INTO "INIT\$SVY_TB_LANGUAGE".*?S\."SORT_ORDER"\);',
        re.DOTALL,
    )
    ddl_seed = seed_pattern.search(ddl)
    alt_seed = seed_pattern.search(alt)
    assert ddl_seed is not None and alt_seed is not None
    assert _normalize_sql(ddl_seed.group(0)) == _normalize_sql(alt_seed.group(0))
    for language_code in ("ko", "en", "ja", "zh"):
        assert f"SELECT '{language_code}'" in ddl_seed.group(0)
    locale_lookup = (
        'LOWER(I."LANG_CODE") = LOWER(REPLACE(TRIM(P_LANG_CODE), \'_\', \'-\'))'
    )
    assert locale_lookup in ddl
    assert locale_lookup in alt
    for source in (ddl, alt):
        assert "Published fallback comes from the immutable version snapshot" in source
        assert "$.languages.defaultLocale" in source
        assert 'FROM "INIT$SVY_TB_SURVEY_VERSION" V' in source

    assert "DESTRUCTIVE OPERATION" in drop_sql
    assert "SUBSTR(OBJECT_NAME, 1, 9) = 'INIT$SVY_'" in drop_sql
    assert 'DROP TABLE "' in drop_sql
    assert "non-project tables have foreign keys" in drop_sql
    assert "non-project objects depend" in drop_sql
    assert "USER_DEPENDENCIES" in drop_sql
    assert "DBA_CONSTRAINTS" in drop_sql
    assert "DBA_DEPENDENCIES" in drop_sql
    assert "catalog-read privilege" in drop_sql
    assert "WHENEVER SQLERROR EXIT SQL.SQLCODE ROLLBACK" in drop_sql

    assert "DESTRUCTIVE OPERATION" in truc_sql
    assert "TRUNCATE TABLE" in truc_sql
    assert "DISABLE CONSTRAINT" in truc_sql
    assert "ENABLE VALIDATE CONSTRAINT" in truc_sql
    assert "non-project tables" in truc_sql
    assert "V_RESTORE_ERROR_COUNT > 0" in truc_sql
    assert "foreign key(s) could not be restored" in truc_sql
    assert "DBA_CONSTRAINTS" in truc_sql
    assert "catalog-read privilege" in truc_sql
    assert "WHENEVER SQLERROR EXIT SQL.SQLCODE ROLLBACK" in truc_sql


def test_response_retry_and_answer_tenant_upgrade_contract() -> None:
    ddl_tables = _table_definitions(_read(DDL_PATH))
    alt = _read(ALT_PATH)

    response_columns = re.findall(
        r'^\s*,?\s*"([A-Z0-9_]+)"\s+(?:VARCHAR2|NUMBER|CLOB|TIMESTAMP)',
        ddl_tables["INIT$SVY_TB_RESPONSE"],
        re.MULTILINE,
    )
    answer_columns = re.findall(
        r'^\s*,?\s*"([A-Z0-9_]+)"\s+(?:VARCHAR2|NUMBER|CLOB|TIMESTAMP)',
        ddl_tables["INIT$SVY_TB_RESPONSE_ANSWER"],
        re.MULTILINE,
    )
    assert response_columns == [
        "RESPONSE_ID",
        "TENANT_ID",
        "SURVEY_ID",
        "SURVEY_VERSION_NO",
        "RESPONDENT_KEY_HASH",
        "METADATA_JSON",
        "SUBMITTED_AT",
        "IDEMPOTENCY_KEY_HASH",
        "REQUEST_PAYLOAD_HASH",
    ]
    assert answer_columns == [
        "RESPONSE_ID",
        "QUESTION_ID",
        "ANSWER_VALUE_JSON",
        "CREATED_AT",
        "TENANT_ID",
    ]
    assert 'ADD_COLUMN_IF_MISSING(\n        \'INIT$SVY_TB_RESPONSE_ANSWER\'' in alt
    assert 'UPDATE "INIT$SVY_TB_RESPONSE_ANSWER" A' in alt
    assert re.search(
        r'WHERE\s+R\."RESPONSE_ID"\s*=\s*A\."RESPONSE_ID"',
        alt,
    )
    assert "V_MISSING_TENANT_COUNT > 0" in alt
    assert "INIT$SVY_FK_ANSWER_RESP_T" in alt
    assert "INIT$SVY_UK_RESP_IDEMP" in alt
    assert "INIT$SVY_IX_ANSWER_TENANT" in alt


def test_temporary_legacy_drop_is_confirmed_and_prefix_scoped() -> None:
    legacy_drop = _read(LEGACY_DROP_PATH)

    assert "DEFINE CONFIRM_SVY_LEGACY_DROP = 'DROP_SVY_LEGACY'" in legacy_drop
    assert "EXECUTION ENABLED" in legacy_drop
    assert "ACCEPT CONFIRM_SVY_LEGACY_DROP" not in legacy_drop
    assert "SET VERIFY OFF" in legacy_drop
    assert "V_CONFIRMATION <> 'DROP_SVY_LEGACY'" in legacy_drop
    assert "SUBSTR(OBJECT_NAME, 1, 4) = 'SVY$'" in legacy_drop
    assert "SUBSTR(TABLE_NAME, 1, 4) = 'SVY$'" in legacy_drop
    assert "OBJECT_TYPE IN ('TABLE', 'FUNCTION')" in legacy_drop
    assert "OBJECT_TYPE = 'FUNCTION'" in legacy_drop
    assert "V_EXPECTED_SCHEMA CONSTANT VARCHAR2(128 BYTE) := 'INIT$BASE02'" in legacy_drop
    assert "IF USER <> V_EXPECTED_SCHEMA" in legacy_drop
    assert "USER_CONSTRAINTS" in legacy_drop
    assert "USER_DEPENDENCIES" in legacy_drop
    assert "DBA_CONSTRAINTS" not in legacy_drop
    assert "DBA_DEPENDENCIES" not in legacy_drop
    assert "ALL_CONSTRAINTS" not in legacy_drop
    assert "ALL_DEPENDENCIES" not in legacy_drop
    assert "DROP FUNCTION " in legacy_drop
    assert "DROP TABLE " in legacy_drop
    assert "DBMS_ASSERT.ENQUOTE_NAME" not in legacy_drop
    assert "INIT$SVY_" in legacy_drop  # The header explicitly documents exclusion.
