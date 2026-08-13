from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATABASE = ROOT / "database"
DDL_PATH = DATABASE / "SURVEYONE_SYSTEM_DDL.sql"
ALT_PATH = DATABASE / "SURVEYONE_SYSTEM_ALT.sql"
DROP_PATH = DATABASE / "SURVEYONE_SYSTEM_DROP.sql"
TRUC_PATH = DATABASE / "SURVEYONE_SYSTEM_TRUC.sql"

PREFIX = "INIT$SVY_"
EXPECTED_TABLES = {
    "INIT$SVY_TB_AUDIT_LOG",
    "INIT$SVY_TB_AUTH_SESSION",
    "INIT$SVY_TB_DELIVERY",
    "INIT$SVY_TB_DELIVERY_BATCH",
    "INIT$SVY_TB_DELIVERY_RECIPIENT",
    "INIT$SVY_TB_DELIVERY_TARGET",
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
    "INIT$SVY_TB_TEMPLATE_VERSION",
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


def _find_matching_parenthesis(source: str, opening_index: int) -> int:
    depth = 0
    in_string = False
    index = opening_index
    while index < len(source):
        character = source[index]
        if in_string:
            if character == "'":
                if index + 1 < len(source) and source[index + 1] == "'":
                    index += 2
                    continue
                in_string = False
            index += 1
            continue
        if character == "'":
            in_string = True
        elif character == "(":
            depth += 1
        elif character == ")":
            depth -= 1
            if depth == 0:
                return index
        index += 1
    raise AssertionError("unbalanced SQL parentheses")


def _split_top_level(value: str) -> list[str]:
    parts: list[str] = []
    start = 0
    depth = 0
    in_string = False
    index = 0
    while index < len(value):
        character = value[index]
        if in_string:
            if character == "'":
                if index + 1 < len(value) and value[index + 1] == "'":
                    index += 2
                    continue
                in_string = False
            index += 1
            continue
        if character == "'":
            in_string = True
        elif character == "(":
            depth += 1
        elif character == ")":
            depth -= 1
        elif character == "," and depth == 0:
            parts.append(value[start:index].strip())
            start = index + 1
        index += 1
    parts.append(value[start:].strip())
    return parts


def _literal_call_arguments(source: str, call_name: str) -> list[list[str]]:
    calls: list[list[str]] = []
    pattern = re.compile(rf"(?m)^\s*{re.escape(call_name)}\s*\(")
    for match in pattern.finditer(source):
        opening_index = source.find("(", match.start())
        closing_index = _find_matching_parenthesis(source, opening_index)
        calls.append(_split_top_level(source[opening_index + 1 : closing_index]))
    return calls


def _decode_sql_literal_expression(expression: str) -> str:
    literal_pattern = re.compile(r"'((?:''|[^'])*)'")
    parts: list[str] = []
    last_end = 0
    for match in literal_pattern.finditer(expression):
        separator = expression[last_end : match.start()]
        assert not re.sub(r"\s+|\|\|", "", separator), expression
        parts.append(match.group(1).replace("''", "'"))
        last_end = match.end()
    assert parts, expression
    assert not re.sub(r"\s+|\|\|", "", expression[last_end:]), expression
    return "".join(parts)


def _executed_call_definitions(
    source: str,
    call_name: str,
    definition_argument: int,
) -> dict[str, str]:
    definitions: dict[str, str] = {}
    for arguments in _literal_call_arguments(source, call_name):
        assert len(arguments) > definition_argument
        name = _decode_sql_literal_expression(arguments[0])
        assert name not in definitions, f"duplicate {call_name} declaration: {name}"
        definitions[name] = _normalize_sql(
            _decode_sql_literal_expression(arguments[definition_argument])
        )
    return definitions


def _function_definitions(source: str) -> dict[str, str]:
    pattern = re.compile(
        r'(?ms)^(CREATE OR REPLACE FUNCTION "([A-Z0-9$_]+)".*?)(?=^/\s*$)',
    )
    definitions: dict[str, str] = {}
    for match in pattern.finditer(source):
        name = match.group(2)
        assert name not in definitions, f"duplicate function declaration: {name}"
        definitions[name] = _normalize_sql(match.group(1))
    return definitions


def _normalize_constraint_definition(value: str) -> str:
    normalized = _normalize_sql(value)
    normalized = re.sub(r"\(\s+", "(", normalized)
    normalized = re.sub(r"\s+\)", ")", normalized)
    return re.sub(r"\s+ENABLE$", "", normalized, flags=re.IGNORECASE)


def _table_constraint_definitions(source: str) -> dict[tuple[str, str], str]:
    definitions: dict[tuple[str, str], str] = {}
    for table_name, create_table in _table_definitions(source).items():
        opening_index = create_table.find("(")
        assert opening_index >= 0
        closing_index = _find_matching_parenthesis(create_table, opening_index)
        for item in _split_top_level(create_table[opening_index + 1 : closing_index]):
            match = re.match(
                r'^CONSTRAINT\s+"([A-Z0-9$_]+)"\s+(.*)$',
                item,
                re.DOTALL,
            )
            if match is None:
                continue
            key = (table_name, match.group(1))
            assert key not in definitions, f"duplicate table constraint: {key}"
            definitions[key] = _normalize_constraint_definition(match.group(2))
    return definitions


def _constraint_call_definitions(source: str) -> dict[tuple[str, str], str]:
    definitions: dict[tuple[str, str], str] = {}
    for arguments in _literal_call_arguments(source, "ADD_CONSTRAINT_IF_MISSING"):
        assert len(arguments) == 3
        table_name = _decode_sql_literal_expression(arguments[0])
        constraint_name = _decode_sql_literal_expression(arguments[1])
        key = (table_name, constraint_name)
        assert key not in definitions, f"duplicate constraint upgrade: {key}"
        definitions[key] = _normalize_constraint_definition(
            _decode_sql_literal_expression(arguments[2])
        )
    return definitions


def test_ddl_and_alt_have_identical_final_table_definitions() -> None:
    ddl_tables = _table_definitions(_read(DDL_PATH))
    alt_tables = _table_definitions(_read(ALT_PATH))

    assert set(ddl_tables) == EXPECTED_TABLES
    assert set(alt_tables) == EXPECTED_TABLES
    for table_name in sorted(EXPECTED_TABLES):
        assert _normalize_sql(ddl_tables[table_name]) == _normalize_sql(alt_tables[table_name])


def test_upgrade_additions_preserve_fresh_install_column_order() -> None:
    ddl_tables = _table_definitions(_read(DDL_PATH))
    alt = _read(ALT_PATH)
    additions: dict[str, list[str]] = {}
    for arguments in _literal_call_arguments(alt, "ADD_COLUMN_IF_MISSING"):
        table_name = _decode_sql_literal_expression(arguments[0])
        column_name = _decode_sql_literal_expression(arguments[1])
        additions.setdefault(table_name, []).append(column_name)

    assert additions
    for table_name, added_columns in additions.items():
        create_table = ddl_tables[table_name]
        opening_index = create_table.find("(")
        closing_index = _find_matching_parenthesis(create_table, opening_index)
        final_columns = []
        for item in _split_top_level(create_table[opening_index + 1 : closing_index]):
            match = re.match(r'^"([A-Z0-9_]+)"\s+', item)
            if match is not None:
                final_columns.append(match.group(1))
        assert final_columns[-len(added_columns) :] == added_columns, table_name


def test_ddl_and_alt_have_identical_executed_index_and_sequence_definitions() -> None:
    ddl = _read(DDL_PATH)
    alt = _read(ALT_PATH)

    object_name_patterns = {
        "CREATE_INDEX_IF_MISSING": re.compile(
            r'^CREATE (?:UNIQUE )?INDEX "([A-Z0-9$_]+)"',
        ),
        "CREATE_SEQUENCE_IF_MISSING": re.compile(
            r'^CREATE SEQUENCE "([A-Z0-9$_]+)"',
        ),
    }
    for call_name, object_name_pattern in object_name_patterns.items():
        ddl_definitions = _executed_call_definitions(ddl, call_name, 1)
        alt_definitions = _executed_call_definitions(alt, call_name, 1)
        assert ddl_definitions
        assert set(ddl_definitions) == set(alt_definitions)
        assert ddl_definitions == alt_definitions
        for name, definition in ddl_definitions.items():
            match = object_name_pattern.match(definition)
            assert match is not None, (call_name, name)
            assert match.group(1) == name
            assert name.startswith(PREFIX)
            assert len(name.encode("ascii")) <= 30


def test_ddl_and_alt_have_identical_function_definitions() -> None:
    ddl_definitions = _function_definitions(_read(DDL_PATH))
    alt_definitions = _function_definitions(_read(ALT_PATH))

    assert ddl_definitions
    assert set(ddl_definitions) == set(alt_definitions)
    assert ddl_definitions == alt_definitions


def test_ddl_and_alt_have_identical_table_comments() -> None:
    pattern = re.compile(
        r"RUN_DDL\(q'\[(COMMENT ON TABLE .*?)\]'\s*,\s*'COMMENT [^']+'\);"
    )
    ddl_comments = {_normalize_sql(value) for value in pattern.findall(_read(DDL_PATH))}
    alt_comments = {_normalize_sql(value) for value in pattern.findall(_read(ALT_PATH))}

    assert ddl_comments
    assert ddl_comments == alt_comments


def test_alt_constraint_upgrades_match_final_ddl_definitions() -> None:
    ddl = _read(DDL_PATH)
    alt = _read(ALT_PATH)
    final_definitions = _table_constraint_definitions(ddl)
    deferred_ddl_definitions = _constraint_call_definitions(ddl)
    for key, definition in deferred_ddl_definitions.items():
        assert key not in final_definitions
        final_definitions[key] = definition

    alt_upgrade_definitions = _constraint_call_definitions(alt)
    assert alt_upgrade_definitions
    assert set(deferred_ddl_definitions) <= set(alt_upgrade_definitions)
    assert set(alt_upgrade_definitions) <= set(final_definitions)
    for (table_name, constraint_name), definition in alt_upgrade_definitions.items():
        assert table_name in EXPECTED_TABLES
        assert constraint_name.startswith(PREFIX)
        assert len(constraint_name.encode("ascii")) <= 30
        key = (table_name, constraint_name)
        assert definition == final_definitions[key], key


def test_all_declared_oracle_identifiers_use_project_prefix_and_fit_30_bytes() -> None:
    ddl = _read(DDL_PATH)
    patterns = (
        r'CREATE TABLE "([A-Z0-9$_]+)"',
        r'CREATE (?:UNIQUE )?INDEX "([A-Z0-9$_]+)"',
        r'CREATE SEQUENCE "([A-Z0-9$_]+)"',
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

    assert len(re.findall(r'CREATE TABLE "INIT\$SVY_', ddl)) == 23
    assert len(set(re.findall(r'CREATE (?:UNIQUE )?INDEX "(INIT\$SVY_[A-Z0-9_]+)"', ddl))) == 25
    assert len(set(re.findall(r'CONSTRAINT "(INIT\$SVY_[A-Z0-9_]+)"', ddl))) == 164
    assert len(re.findall(r'CREATE OR REPLACE FUNCTION "INIT\$SVY_', ddl)) == 2
    assert ddl.count('CREATE SEQUENCE "INIT$SVY_SQ_GUEST_LOGIN"') == 1


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
    assert "CREATE_SEQUENCE_IF_MISSING" in ddl
    assert "CREATE_SEQUENCE_IF_MISSING" in alt
    assert "ADD_COLUMN_IF_MISSING" in ddl
    assert "ADD_COLUMN_IF_MISSING" in alt
    assert "SVY$_TB_" in alt
    assert "RENAME TO" in alt
    assert "RENAME CONSTRAINT" in alt
    assert "ALTER INDEX" in alt and "RENAME TO" in alt
    assert alt.count('CREATE OR REPLACE FUNCTION "INIT$SVY_FN_') == 2
    for source in (ddl, alt):
        assert "WHENEVER SQLERROR EXIT SQL.SQLCODE ROLLBACK" in source


def test_equivalent_existing_indexes_are_safe_on_ddl_and_alt_reruns() -> None:
    for source in (_read(DDL_PATH), _read(ALT_PATH)):
        procedure_start = source.index("PROCEDURE CREATE_INDEX_IF_MISSING")
        procedure_end = source.index("PROCEDURE CREATE_SEQUENCE_IF_MISSING", procedure_start)
        procedure = source[procedure_start:procedure_end]

        assert "EXECUTE IMMEDIATE P_DDL" in procedure
        assert "IF SQLCODE = -1408" in procedure
        assert "equivalent column list under another index" in procedure
        assert "RAISE;" in procedure


def test_rerunnable_install_and_upgrade_add_columns_in_identical_table_order() -> None:
    ddl = _read(DDL_PATH)
    alt = _read(ALT_PATH)

    def additions_by_table(source: str) -> dict[str, list[str]]:
        result: dict[str, list[str]] = {}
        for arguments in _literal_call_arguments(source, "ADD_COLUMN_IF_MISSING"):
            table_name = _decode_sql_literal_expression(arguments[0])
            result.setdefault(table_name, []).append(
                _decode_sql_literal_expression(arguments[1])
            )
        return result

    ddl_additions = additions_by_table(ddl)
    alt_additions = additions_by_table(alt)

    assert "FUNCTION COLUMN_EXISTS" in ddl
    assert ddl_additions == alt_additions
    final_tables = _table_definitions(ddl)
    for table_name, added_columns in ddl_additions.items():
        final_table = final_tables[table_name]
        opening_index = final_table.find("(")
        closing_index = _find_matching_parenthesis(final_table, opening_index)
        final_columns = [
            match.group(1)
            for item in _split_top_level(
                final_table[opening_index + 1 : closing_index]
            )
            if (match := re.match(r'^"([A-Z0-9_]+)"\s+', item)) is not None
        ]
        assert final_columns[-len(added_columns) :] == added_columns, table_name

    for source in (ddl, alt):
        assert source.index("'TEMPLATE_VERSION_NO', 'NUMBER'") < source.index(
            "'INIT$SVY_FK_SURVEY_TPL_VER'"
        )
        assert source.index(
            "'STATUS_CODE', 'VARCHAR2(20 BYTE) DEFAULT ''ACTIVE'' NOT NULL ENABLE'"
        ) < source.index("'INIT$SVY_IX_TEMPLATE_STATUS'")

    assert ddl.rindex("ADD_COLUMN_IF_MISSING(") < ddl.index(
        "'INIT$SVY_IX_GCAP_EXP'"
    )


def test_guest_login_sequence_has_identical_rerunnable_definition() -> None:
    ddl = _read(DDL_PATH)
    alt = _read(ALT_PATH)
    definition = (
        'CREATE SEQUENCE "INIT$SVY_SQ_GUEST_LOGIN" '
        "START WITH 1 INCREMENT BY 1 CACHE 20 NOCYCLE"
    )

    for source in (ddl, alt):
        assert "CREATE_SEQUENCE_IF_MISSING" in source
        assert source.count(definition) == 1
    assert "GUEST_SEQUENCE_COUNT" in _read(DATABASE / "auth.sql")


def test_survey_soft_delete_status_is_supported_by_fresh_and_upgrade_schema() -> None:
    ddl = _read(DDL_PATH)
    alt = _read(ALT_PATH)
    status_constraint = (
        'CHECK ("STATUS_CODE" IN (\'DRAFT\', \'PUBLISHED\', \'CLOSED\', \'DELETED\')) ENABLE'
    )

    assert status_constraint in ddl
    assert status_constraint in alt
    assert "PROCEDURE ENSURE_SURVEY_STATUS_CONSTRAINT" in alt
    assert "SEARCH_CONDITION_VC" in alt
    assert "already supports DELETED" in alt
    assert "STATUS_CODE IN ('DRAFT', 'CLOSED')" in _read(DATABASE / "surveys.sql")


def test_delivery_upgrade_preserves_legacy_targets_without_reusing_the_plan() -> None:
    alt = _read(ALT_PATH)
    migration = alt.split(
        "/* Preserve pre-batch target rows in a deterministic cancelled history batch.",
        1,
    )[1].split('UPDATE /*+ NO_PARALLEL(T) */ "INIT$SVY_TB_DELIVERY_TARGET" T', 1)[0]

    assert 'INSERT /*+ NOAPPEND NO_PARALLEL */ INTO "INIT$SVY_TB_DELIVERY_BATCH"' in migration
    assert "LOWER(RAWTOHEX(STANDARD_HASH(" in migration
    assert "'CANCELLED'" in migration
    assert "TO_CLOB('{\"migration\":\"legacy-targets\"}')" in migration
    assert 'WHERE T."BATCH_ID" IS NULL' in migration
    assert "NOT EXISTS" in migration
    assert alt.index("REMOVE_OBSOLETE_BATCH_DEPLOY_KEY;") < alt.index(
        'INSERT /*+ NOAPPEND NO_PARALLEL */ INTO "INIT$SVY_TB_DELIVERY_BATCH"'
    )


def test_alt_forces_schema_backfills_to_run_without_parallel_dml() -> None:
    alt = _read(ALT_PATH)

    commit_position = alt.index("COMMIT;")
    disable_position = alt.index("ALTER SESSION DISABLE PARALLEL DML;")
    first_block_position = alt.index("DECLARE")
    assert commit_position < disable_position < first_block_position

    for statement in (
        'UPDATE /*+ NO_PARALLEL */ "INIT$SVY_TB_USER"',
        'UPDATE /*+ NO_PARALLEL(T) */ "INIT$SVY_TB_TENANT" T',
        'UPDATE /*+ NO_PARALLEL(S) */ "INIT$SVY_TB_SURVEY" S',
        'UPDATE /*+ NO_PARALLEL */ "INIT$SVY_TB_TEMPLATE"',
        'UPDATE /*+ NO_PARALLEL(V) */ "INIT$SVY_TB_SURVEY_VERSION" V',
        'UPDATE /*+ NO_PARALLEL(A) */ "INIT$SVY_TB_RESPONSE_ANSWER" A',
        'INSERT /*+ NOAPPEND NO_PARALLEL */ INTO "INIT$SVY_TB_DELIVERY_BATCH"',
        'UPDATE /*+ NO_PARALLEL(T) */ "INIT$SVY_TB_DELIVERY_TARGET" T',
    ):
        assert statement in alt


def test_template_seed_hashes_the_exact_clob_outside_oracle_sql() -> None:
    templates = _read(DATABASE / "templates.sql")
    statement = templates.split("-- [TEMPLATE_VERSION_SEED]", 1)[1].split(
        "-- [ADMIN_TEMPLATE_LIST]", 1
    )[0]

    assert ":contentHash" in statement
    assert "STANDARD_HASH(T.CONTENT_JSON" not in statement


def test_template_status_upgrade_preserves_lifecycle_state_on_rerun() -> None:
    alt = _read(ALT_PATH)

    assert 'SET "STATUS_CODE" = \'ARCHIVED\'' in alt
    assert 'WHERE "STATUS_CODE" = \'ACTIVE\'' in alt
    assert 'SET "USE_YN" = \'N\'' in alt
    assert 'WHERE "STATUS_CODE" IN (\'DRAFT\', \'ARCHIVED\')' in alt
    assert (
        'SET "STATUS_CODE" = CASE WHEN "USE_YN" = \'Y\' THEN \'ACTIVE\' ELSE \'ARCHIVED\' END'
        not in alt
    )


def test_guest_login_collision_check_includes_inactive_and_expired_users() -> None:
    auth_sql = _read(DATABASE / "auth.sql")
    statement = auth_sql.split("-- [AUTH_LOGIN_ID_EXISTS]", 1)[1].split(
        "-- [AUTH_USER_BY_LOGIN]", 1
    )[0]

    assert 'FROM "INIT$SVY_TB_USER"' in statement
    assert "LOWER(LOGIN_ID) = LOWER(:loginId)" in statement
    assert "USE_YN" not in statement
    assert "STATUS_CODE" not in statement
    assert "EXPIRES_AT" not in statement


def test_guest_sequence_nextval_is_selected_only_at_the_outermost_level() -> None:
    auth_sql = _read(DATABASE / "auth.sql")
    statement = auth_sql.split("-- [AUTH_GUEST_LOGIN_NEXT]", 1)[1].split(
        "-- [AUTH_LOGIN_ID_EXISTS]", 1
    )[0]

    assert '"INIT$SVY_SQ_GUEST_LOGIN".NEXTVAL AS LOGIN_SEQUENCE_VALUE' in statement
    assert "FROM (" not in statement.upper()


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
    for language_code in ("ko", "en", "ja", "zh", "vi", "fil"):
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
    assert "'SEQUENCE'" in drop_sql
    assert "INIT$SVY_SQ_GUEST_LOGIN" in ddl
    assert "INIT$SVY_SQ_GUEST_LOGIN" in alt

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
    assert 'UPDATE /*+ NO_PARALLEL(A) */ "INIT$SVY_TB_RESPONSE_ANSWER" A' in alt
    assert re.search(
        r'WHERE\s+R\."RESPONSE_ID"\s*=\s*A\."RESPONSE_ID"',
        alt,
    )
    assert "V_MISSING_TENANT_COUNT > 0" in alt
    assert "INIT$SVY_FK_ANSWER_RESP_T" in alt
    assert "INIT$SVY_UK_RESP_IDEMP" in alt
    assert "INIT$SVY_IX_ANSWER_TENANT" in alt


def test_member_withdrawal_marker_is_present_in_fresh_and_upgrade_schema() -> None:
    ddl_tables = _table_definitions(_read(DDL_PATH))
    alt = _read(ALT_PATH)

    assert '"WITHDRAWN_AT" TIMESTAMP (6) WITH TIME ZONE' in ddl_tables[
        "INIT$SVY_TB_USER"
    ]
    assert "'INIT$SVY_TB_USER'" in alt
    assert "'WITHDRAWN_AT'" in alt
    assert "irreversible member withdrawal marker" in alt


def test_runtime_sql_sections_are_referenced_by_backend() -> None:
    backend_source = "\n".join(
        path.read_text(encoding="utf-8")
        for path in sorted((ROOT / "backend").rglob("*.py"))
    )
    system_suffixes = ("_DDL.SQL", "_ALT.SQL", "_DROP.SQL", "_TRUC.SQL")
    unused: list[str] = []
    for sql_path in sorted(DATABASE.glob("*.sql")):
        if sql_path.name.upper().endswith(system_suffixes):
            continue
        identifiers = re.findall(
            r"(?m)^-- \[([A-Za-z0-9_]+)\][ \t]*$",
            sql_path.read_text(encoding="utf-8"),
        )
        unused.extend(
            f"{sql_path.name}:{identifier}"
            for identifier in identifiers
            if f'"{identifier}"' not in backend_source
        )

    assert unused == []
