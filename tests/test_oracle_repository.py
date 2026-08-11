from __future__ import annotations

from contextlib import contextmanager
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import timedelta
import json
import re
from threading import Lock
from types import SimpleNamespace
from typing import Any

import pytest

from backend.config import PROJECT_ROOT, get_settings
from backend.errors import (
    AuthenticationError,
    ConflictError,
    DomainValidationError,
    NotFoundError,
    ServiceUnavailableError,
)
from backend.models import (
    GuestMode,
    LoginRequest,
    PublicSurvey,
    Question,
    QuestionType,
    SubmitResponseRequest,
    SurveyLanguages,
    SurveyCreateRequest,
    SurveySection,
    SurveySettings,
    SurveyTheme,
    SurveyTranslation,
    SurveyUpdateRequest,
)
from backend.oracle_store import OracleStore, _json_load, _public_snapshot, utcnow
from backend.security import verify_password
from backend.sql_loader import sql_loader


class FakePool:
    def __init__(self) -> None:
        self.connection_object = object()
        self.commits = 0
        self.rollbacks = 0

    @contextmanager
    def connection(self):
        yield self.connection_object

    @contextmanager
    def transaction(self):
        try:
            yield self.connection_object
            self.commits += 1
        except Exception:
            self.rollbacks += 1
            raise

    def ping(self):
        return None


class RecordingCrud:
    def __init__(self) -> None:
        self.executes: list[tuple[str, dict[str, Any]]] = []
        self.batches: list[tuple[str, list[dict[str, Any]]]] = []
        self.template_reads = 0
        self.seed_rows: list[dict[str, Any]] = []
        self.events: list[str] = []
        self.guest_login_sequence = 0

    def execute(self, connection, sql_id, params=None):
        self.events.append(f"execute:{sql_id}")
        self.executes.append((sql_id, dict(params or {})))
        return 1

    def executemany(self, connection, sql_id, rows):
        self.events.append(f"batch:{sql_id}")
        values = [dict(row) for row in rows]
        self.batches.append((sql_id, values))
        if sql_id == "TEMPLATE_MERGE":
            self.seed_rows = [
                {
                    "template_code": row["templateCode"],
                    "template_title": row["templateTitle"],
                    "category_code": row["categoryCode"],
                    "description": row["description"],
                    "content_json": row["contentJson"],
                }
                for row in values
            ]
        return len(values)

    def fetch_all(self, connection, sql_id, params=None):
        if sql_id == "TEMPLATE_LIST":
            self.template_reads += 1
            return [] if self.template_reads == 1 else self.seed_rows
        return []

    def fetch_one(self, connection, sql_id, params=None):
        if sql_id == "AUTH_GUEST_LOGIN_NEXT":
            self.guest_login_sequence += 1
            return {"login_sequence_value": self.guest_login_sequence}
        return None


def test_database_guest_is_provisioned_without_a_session_or_plaintext_storage() -> None:
    pool = FakePool()
    crud = RecordingCrud()
    settings = get_settings()
    store = OracleStore(settings=settings, pool=pool, crud=crud)

    provisioned = store.create_guest("DB tester", GuestMode.DATABASE)

    assert provisioned.user.guest_mode == GuestMode.DATABASE
    assert provisioned.guest_credential.login_id == "quest001"
    assert provisioned.guest_credential.expires_at == provisioned.expires_at
    assert pool.commits == 1
    statements = {sql_id: params for sql_id, params in crud.executes}
    assert statements["AUTH_TENANT_INSERT"]["tenantTypeCode"] == "DB_GUEST"
    assert statements["AUTH_USER_INSERT"]["guestModeCode"] == "DB"
    assert statements["AUTH_USER_INSERT"]["loginId"] == "quest001"
    assert verify_password(
        provisioned.guest_credential.initial_password,
        statements["AUTH_USER_INSERT"]["passwordHash"],
    )
    assert provisioned.guest_credential.initial_password not in str(statements)
    assert statements["AUTH_TENANT_INSERT"]["expiresAt"] == provisioned.expires_at
    assert "AUTH_SESSION_INSERT" not in statements
    capability_batch = next(rows for sql_id, rows in crud.batches if sql_id == "AUTH_GUEST_CAP_INSERT")
    assert {row["capabilityCode"] for row in capability_batch} >= {
        "SURVEY_CREATE",
        "SURVEY_PUBLISH",
        "MULTILINGUAL",
        "RAW_EXPORT",
        "CUSTOM_REPORT",
    }
    allowed_by_code = {
        row["capabilityCode"]: row["allowedYn"] for row in capability_batch
    }
    assert allowed_by_code["CUSTOM_REPORT"] == "N"
    assert allowed_by_code["EXTERNAL_DELIVERY"] == "N"
    limits_by_code = {
        row["capabilityCode"]: row["limitValue"] for row in capability_batch
    }
    assert limits_by_code["SURVEY_CREATE"] == settings.db_guest_max_projects
    assert (
        limits_by_code["SURVEY_QUESTION_COUNT"]
        == settings.db_guest_max_questions
    )
    assert limits_by_code["RESPONSE_COLLECT"] == settings.db_guest_max_responses


def test_database_guest_can_relogin_without_revealing_password_again() -> None:
    provisioning_crud = RecordingCrud()
    store = OracleStore(
        settings=get_settings(), pool=FakePool(), crud=provisioning_crud
    )
    provisioned = store.create_guest("Guest", GuestMode.DATABASE)
    user_insert = next(
        params
        for sql_id, params in provisioning_crud.executes
        if sql_id == "AUTH_USER_INSERT"
    )
    tenant_insert = next(
        params
        for sql_id, params in provisioning_crud.executes
        if sql_id == "AUTH_TENANT_INSERT"
    )

    class LoginCrud(RecordingCrud):
        def fetch_one(self, connection, sql_id, params=None):
            if sql_id == "AUTH_USER_BY_LOGIN":
                return {
                    "user_id": user_insert["userId"],
                    "tenant_id": user_insert["tenantId"],
                    "login_id": user_insert["loginId"],
                    "password_hash": user_insert["passwordHash"],
                    "user_name": user_insert["userName"],
                    "email": None,
                    "role_code": "GUEST",
                    "guest_yn": "Y",
                    "guest_mode_code": "DB",
                    "created_at": utcnow(),
                    "tenant_name": tenant_insert["tenantName"],
                    "tenant_expires_at": tenant_insert["expiresAt"],
                }
            return super().fetch_one(connection, sql_id, params)

    login_crud = LoginCrud()
    login_store = OracleStore(
        settings=get_settings(), pool=FakePool(), crud=login_crud
    )
    _, relogged = login_store.login(
        LoginRequest(
            loginId=provisioned.guest_credential.login_id,
            password=provisioned.guest_credential.initial_password,
        )
    )

    assert relogged.user.is_guest is True
    assert relogged.user.login_id == provisioned.guest_credential.login_id
    assert relogged.expires_at <= tenant_insert["expiresAt"]
    remaining = (relogged.expires_at - utcnow()).total_seconds()
    assert get_settings().session_ttl_seconds - 5 <= remaining
    assert remaining <= get_settings().session_ttl_seconds
    assert "guestCredential" not in relogged.model_dump(by_alias=True)


def test_session_lookup_validates_database_row_with_application_clock() -> None:
    now = utcnow()
    session_row = {
        "session_token_hash": "a" * 64,
        "user_id": "user-session",
        "expires_at": now + timedelta(hours=1),
        "revoked_at": None,
        "tenant_id": "tenant-session",
        "login_id": "quest999",
        "user_name": "Guest",
        "email": None,
        "role_code": "GUEST",
        "guest_yn": "Y",
        "guest_mode_code": "DB",
        "user_use_yn": "Y",
        "created_at": now,
        "tenant_name": "Guest workspace",
        "tenant_status_code": "ACTIVE",
        "tenant_expires_at": now + timedelta(hours=2),
    }

    class SessionCrud(RecordingCrud):
        def fetch_one(self, connection, sql_id, params=None):
            if sql_id == "AUTH_SESSION_SELECT":
                return dict(session_row)
            return super().fetch_one(connection, sql_id, params)

    store = OracleStore(
        settings=get_settings(), pool=FakePool(), crud=SessionCrud()
    )

    assert store.auth_session("opaque-token").user.login_id == "quest999"

    session_row["expires_at"] = now - timedelta(seconds=1)
    with pytest.raises(AuthenticationError, match="만료"):
        store.auth_session("opaque-token")


def test_session_sql_does_not_hide_state_before_domain_validation() -> None:
    statement = sql_loader.get("AUTH_SESSION_SELECT").upper()

    assert "S.REVOKED_AT" in statement
    assert "U.USE_YN AS USER_USE_YN" in statement
    assert "T.STATUS_CODE AS TENANT_STATUS_CODE" in statement
    where_clause = statement.split(" WHERE ", 1)[1]
    assert "S.SESSION_TOKEN_HASH = :SESSIONTOKENHASH" in where_clause
    assert "SYSTIMESTAMP" not in where_clause
    assert "S.EXPIRES_AT >" not in where_clause


def test_guest_sequence_skips_inactive_existing_login_ids() -> None:
    class CollisionCrud(RecordingCrud):
        checked: list[str]

        def __init__(self) -> None:
            super().__init__()
            self.checked = []

        def fetch_one(self, connection, sql_id, params=None):
            if sql_id == "AUTH_LOGIN_ID_EXISTS":
                self.checked.append(params["loginId"])
                return {"login_id_exists": 1} if params["loginId"] == "quest001" else None
            return super().fetch_one(connection, sql_id, params)

    crud = CollisionCrud()
    provisioned = OracleStore(
        settings=get_settings(), pool=FakePool(), crud=crud
    ).create_guest("Guest", GuestMode.DATABASE)

    assert provisioned.guest_credential.login_id == "quest002"
    assert crud.checked == ["quest001", "quest002"]
    checked = [
        params["loginId"]
        for sql_id, params in crud.executes
        if sql_id == "AUTH_USER_INSERT"
    ]
    assert checked == ["quest002"]


def test_guest_login_format_does_not_truncate_sequence_values_above_999() -> None:
    crud = RecordingCrud()
    crud.guest_login_sequence = 999
    provisioned = OracleStore(
        settings=get_settings(), pool=FakePool(), crud=crud
    ).create_guest("Guest", GuestMode.DATABASE)

    assert provisioned.guest_credential.login_id == "quest1000"


def test_quest001_cannot_read_quest010_owned_survey() -> None:
    class OwnershipCrud(RecordingCrud):
        last_params: dict[str, Any] | None = None

        def fetch_one(self, connection, sql_id, params=None):
            if sql_id == "SURVEY_DETAIL_BY_OWNER":
                self.last_params = dict(params or {})
                # The fixture survey belongs to another isolated guest owner.
                if self.last_params == {
                    "surveyId": "survey-quest010",
                    "tenantId": "tenant-quest010",
                    "ownerUserId": "user-quest010",
                }:
                    return {"survey_id": "survey-quest010"}
                return None
            return super().fetch_one(connection, sql_id, params)

    crud = OwnershipCrud()
    store = OracleStore(settings=get_settings(), pool=FakePool(), crud=crud)
    quest001 = SimpleNamespace(
        tenant_id="tenant-quest001",
        id="user-quest001",
        login_id="quest001",
    )

    try:
        store.get_survey(quest001, "survey-quest010")
    except NotFoundError:
        pass
    else:  # pragma: no cover - protects the tenant/owner boundary.
        raise AssertionError("quest001 read quest010's survey")

    assert crud.last_params == {
        "surveyId": "survey-quest010",
        "tenantId": "tenant-quest001",
        "ownerUserId": "user-quest001",
    }


def test_every_owner_list_or_mutation_sql_binds_tenant_and_user() -> None:
    for sql_id in (
        "SURVEY_LIST_BY_OWNER",
        "SURVEY_DETAIL_BY_OWNER",
        "SURVEY_DETAIL_FOR_UPDATE",
        "SURVEY_UPDATE_BY_OWNER",
        "SURVEY_MARK_PUBLISHED_BY_OWNER",
        "RESPONSE_LIST_BY_OWNER",
        "RESPONSE_ANSWER_LIST_BY_OWNER",
        "RESPONSE_REPORT_LIST",
        "RESPONSE_TOTAL_BY_OWNER",
    ):
        statement = sql_loader.get(sql_id).upper()
        assert ":TENANTID" in statement, sql_id
        assert ":OWNERUSERID" in statement, sql_id


def test_empty_oracle_template_catalog_is_idempotently_seeded() -> None:
    pool = FakePool()
    crud = RecordingCrud()
    store = OracleStore(settings=get_settings(), pool=pool, crud=crud)

    templates = store.templates()

    assert pool.commits == 1
    assert {template.code for template in templates} >= {
        "social-research",
        "integrity-survey",
        "business-survey",
    }
    seed = next(rows for sql_id, rows in crud.batches if sql_id == "TEMPLATE_MERGE")
    assert len(seed) >= 3


def test_invalid_legacy_seed_template_json_is_repaired() -> None:
    pool = FakePool()
    crud = RecordingCrud()
    crud.template_reads = 1
    crud.seed_rows = [
        {
            "template_code": "social-research",
            "template_title": "legacy",
            "category_code": "legacy",
            "description": "legacy",
            "content_json": "{'code': 'social-research'}",
        }
    ]
    store = OracleStore(settings=get_settings(), pool=pool, crud=crud)

    templates = store.templates()

    repair = next(
        params for sql_id, params in crud.executes if sql_id == "TEMPLATE_REPAIR"
    )
    assert repair["templateCode"] == "social-research"
    assert json.loads(repair["contentJson"])["code"] == "social-research"
    assert {template.code for template in templates} >= {
        "social-research",
        "integrity-survey",
        "business-survey",
    }


def test_oracle_native_json_value_is_not_reparsed_as_python_repr() -> None:
    native_value = {
        "code": "social-research",
        "languages": {"sourceLocale": "ko"},
    }

    assert _json_load(native_value, {}) is native_value


def test_oracle_native_json_scalar_answers_are_preserved() -> None:
    assert _json_load("plain answer", None) == "plain answer"
    assert _json_load(True, None) is True
    assert _json_load(42, None) == 42
    assert _json_load(3.5, None) == 3.5


def test_public_snapshot_accepts_oracle_native_json_object() -> None:
    snapshot = PublicSurvey(
        survey_id="survey-native-json",
        slug="native-json",
        version=1,
        title="Native Oracle JSON",
        category="test",
        sections=[],
        settings=SurveySettings(),
        theme=SurveyTheme(),
        published_at=utcnow(),
    )

    restored = _public_snapshot(snapshot.model_dump(by_alias=True, mode="json"))

    assert restored.survey_id == snapshot.survey_id
    assert restored.slug == snapshot.slug


def test_i18n_rows_use_ddl_allowlist_and_skip_blank_oracle_text() -> None:
    translations = {
        "en": SurveyTranslation.model_validate(
            {
                "title": "   ",
                "sections": {
                    "section-1": {
                        "questions": {
                            "matrix-q": {
                                "title": "Matrix",
                                "description": "",
                                "rows": {"0": "Quality", "1": "  "},
                                "columns": {"0": "Satisfied"},
                            }
                        }
                    }
                },
            }
        )
    }

    rows = OracleStore._i18n_rows("tenant-1", "survey-1", 0, translations)

    allowed = {"SURVEY", "SECTION", "QUESTION", "OPTION", "VALIDATION", "THANK_YOU"}
    assert {row["resourceTypeCode"] for row in rows} <= allowed
    assert all(str(row["textValue"]).strip() for row in rows)
    axis_rows = [row for row in rows if row["resourceTypeCode"] == "OPTION"]
    assert {(row["fieldCode"], row["textValue"]) for row in axis_rows} == {
        ("ROW_LABEL", "Quality"),
        ("COLUMN_LABEL", "Satisfied"),
    }


def test_new_bcp47_languages_are_merged_before_survey_language_rows() -> None:
    pool = FakePool()
    crud = RecordingCrud()
    store = OracleStore(settings=get_settings(), pool=pool, crud=crud)
    languages = SurveyLanguages(
        source_locale="fr",
        default_locale="fr",
        enabled=["fr", "en-us", "ar"],
    )

    store._sync_i18n(
        pool.connection_object,
        "tenant-1",
        "survey-1",
        0,
        languages,
        {},
    )

    assert languages.enabled == ["fr", "en-US", "ar"]
    assert crud.events.index("batch:LANGUAGE_MERGE") < crud.events.index(
        "batch:SURVEY_LANG_INSERT"
    )
    language_rows = next(
        rows for sql_id, rows in crud.batches if sql_id == "LANGUAGE_MERGE"
    )
    by_code = {row["langCode"]: row for row in language_rows}
    assert by_code["fr"]["langName"] == "fr"
    assert by_code["en-US"]["nativeName"] == "en-US"
    assert by_code["fr"]["directionCode"] == "LTR"
    assert by_code["ar"]["directionCode"] == "RTL"
    survey_language_rows = next(
        rows for sql_id, rows in crud.batches if sql_id == "SURVEY_LANG_INSERT"
    )
    assert [row["langCode"] for row in survey_language_rows] == ["ar", "en-US", "fr"]


def test_language_catalog_sync_does_not_update_shared_existing_rows() -> None:
    language_merge = sql_loader.get("LANGUAGE_MERGE").upper()

    assert "WHEN MATCHED THEN" not in language_merge
    assert "WHEN NOT MATCHED THEN INSERT" in language_merge


def test_survey_update_retries_after_oracle_parallel_dml_deadlock() -> None:
    class OracleErrorInfo:
        code = 12860

    class FakeDatabaseError(Exception):
        pass

    class RetryStore(OracleStore):
        def __init__(self) -> None:
            super().__init__(
                settings=get_settings(), pool=FakePool(), crud=RecordingCrud()
            )
            self.attempts = 0

        def _update_survey_transaction(
            self, connection, user, survey_id, request
        ) -> None:
            self.attempts += 1
            if self.attempts == 1:
                raise FakeDatabaseError(OracleErrorInfo())

        def get_survey(self, user, survey_id):
            return "saved"

    store = RetryStore()
    result = store.update_survey(
        SimpleNamespace(tenant_id="tenant-1", id="user-1"),
        "survey-1",
        SurveyUpdateRequest(title="Retried"),
    )

    assert result == "saved"
    assert store.attempts == 2
    assert store.pool.rollbacks == 1
    assert store.pool.commits == 1


def test_repeated_oracle_parallel_dml_deadlock_becomes_safe_503() -> None:
    class OracleErrorInfo:
        code = 12860

    class FakeDatabaseError(Exception):
        pass

    class FailingStore(OracleStore):
        def _update_survey_transaction(
            self, connection, user, survey_id, request
        ) -> None:
            raise FakeDatabaseError(OracleErrorInfo())

    pool = FakePool()
    store = FailingStore(
        settings=get_settings(), pool=pool, crud=RecordingCrud()
    )

    try:
        store.update_survey(
            SimpleNamespace(tenant_id="tenant-1", id="user-1"),
            "survey-1",
            SurveyUpdateRequest(title="Still locked"),
        )
    except ServiceUnavailableError as exc:
        assert "동시에 저장 요청" in exc.detail
    else:  # pragma: no cover - protects the API error boundary.
        raise AssertionError("Repeated deadlock escaped as an unhandled exception")
    assert pool.rollbacks == 2


def test_readiness_query_matches_all_twenty_ddl_tables() -> None:
    ddl = (PROJECT_ROOT / "database" / "SURVEYONE_SYSTEM_DDL.sql").read_text(
        encoding="utf-8"
    )
    ddl_tables = set(re.findall(r'CREATE TABLE "(INIT\$SVY_TB_[A-Z0-9_]+)"', ddl))
    readiness_tables = set(
        re.findall(r"'(INIT\$SVY_TB_[A-Z0-9_]+)'", sql_loader.get("AUTH_SCHEMA_READY"))
    )

    assert len(ddl_tables) == 20
    assert readiness_tables == ddl_tables

    class ReadinessCrud(RecordingCrud):
        def __init__(
            self,
            count: int,
            *,
            critical_columns: int = 9,
            critical_constraints: int = 6,
            valid_functions: int = 2,
            guest_sequences: int = 1,
        ) -> None:
            super().__init__()
            self.count = count
            self.critical_columns = critical_columns
            self.critical_constraints = critical_constraints
            self.valid_functions = valid_functions
            self.guest_sequences = guest_sequences

        def fetch_one(self, connection, sql_id, params=None):
            assert sql_id == "AUTH_SCHEMA_READY"
            return {
                "table_count": self.count,
                "critical_column_count": self.critical_columns,
                "critical_constraint_count": self.critical_constraints,
                "valid_function_count": self.valid_functions,
                "guest_sequence_count": self.guest_sequences,
            }

    ready = OracleStore(
        settings=get_settings(), pool=FakePool(), crud=ReadinessCrud(20)
    ).readiness()
    incomplete = OracleStore(
        settings=get_settings(), pool=FakePool(), crud=ReadinessCrud(19)
    ).readiness()
    malformed = OracleStore(
        settings=get_settings(),
        pool=FakePool(),
        crud=ReadinessCrud(20, critical_columns=8),
    ).readiness()
    invalid_function = OracleStore(
        settings=get_settings(),
        pool=FakePool(),
        crud=ReadinessCrud(20, valid_functions=1),
    ).readiness()
    missing_sequence = OracleStore(
        settings=get_settings(),
        pool=FakePool(),
        crud=ReadinessCrud(20, guest_sequences=0),
    ).readiness()
    assert ready == (True, None)
    assert incomplete[0] is False
    assert "incomplete" in str(incomplete[1]).lower()
    assert malformed[0] is False
    assert invalid_function[0] is False
    assert missing_sequence[0] is False
    assert "guest_sequence_count=0/1" in str(missing_sequence[1])
    assert "SURVEYONE_SYSTEM_ALT.sql" in str(missing_sequence[1])


def test_response_answer_sql_reuses_the_deterministic_owner_page() -> None:
    response_sql = " ".join(sql_loader.get("RESPONSE_LIST_BY_OWNER").upper().split())
    answer_sql = " ".join(
        sql_loader.get("RESPONSE_ANSWER_LIST_BY_OWNER").upper().split()
    )
    ordering = "ORDER BY R.SUBMITTED_AT DESC , R.RESPONSE_ID DESC"

    assert ordering in response_sql
    assert ordering in answer_sql
    assert "WITH PAGE_RESPONSE AS" in answer_sql
    assert "S.OWNER_USER_ID = :OWNERUSERID" in answer_sql
    assert "R.TENANT_ID = :TENANTID" in answer_sql
    assert "A.TENANT_ID = :TENANTID" in answer_sql
    assert "OFFSET :OFFSET ROWS FETCH NEXT :LIMIT ROWS ONLY" in answer_sql


def test_oracle_response_answers_receive_the_exact_response_page_binds() -> None:
    class PagedResponseCrud(RecordingCrud):
        def __init__(self) -> None:
            super().__init__()
            self.answer_params: dict[str, Any] | None = None

        def fetch_all(self, connection, sql_id, params=None):
            values = dict(params or {})
            if sql_id == "RESPONSE_LIST_BY_OWNER":
                return [
                    {
                        "response_id": "response-page-2",
                        "survey_id": "survey-1",
                        "survey_version_no": 1,
                        "metadata_json": "{}",
                        "submitted_at": utcnow(),
                    }
                ]
            if sql_id == "RESPONSE_ANSWER_LIST_BY_OWNER":
                self.answer_params = values
                return [
                    {
                        "response_id": "response-page-2",
                        "question_id": "q1",
                        "answer_value_json": '"page answer"',
                    },
                    {
                        "response_id": "response-outside-page",
                        "question_id": "q1",
                        "answer_value_json": '"must be ignored"',
                    },
                ]
            return super().fetch_all(connection, sql_id, values)

    class PagedResponseStore(OracleStore):
        def _survey_row(self, connection, user, survey_id, *, lock=False):
            return {}

    crud = PagedResponseCrud()
    store = PagedResponseStore(settings=get_settings(), pool=FakePool(), crud=crud)
    user = SimpleNamespace(tenant_id="tenant-1", id="owner-1")

    page = store.responses(user, "survey-1", offset=25, limit=10)

    assert crud.answer_params == {
        "surveyId": "survey-1",
        "tenantId": "tenant-1",
        "ownerUserId": "owner-1",
        "offset": 25,
        "limit": 10,
    }
    assert len(page) == 1
    assert [answer.value for answer in page[0].answers] == ["page answer"]


class SerializedPool(FakePool):
    def __init__(self) -> None:
        super().__init__()
        self._transaction_lock = Lock()

    @contextmanager
    def transaction(self):
        with self._transaction_lock:
            yield self.connection_object
            self.commits += 1


class OneResponseCrud(RecordingCrud):
    def __init__(self, snapshot: PublicSurvey) -> None:
        super().__init__()
        self.snapshot = snapshot
        self.respondent_hashes: set[str] = set()
        self.idempotent_rows: dict[str, dict[str, Any]] = {}
        self.response_count = 0

    def fetch_one(self, connection, sql_id, params=None):
        values = dict(params or {})
        self.events.append(f"fetch:{sql_id}")
        if sql_id == "SURVEY_PUBLIC_BY_SLUG":
            return {
                "tenant_id": "tenant-1",
                "tenant_type_code": (
                    "DB_GUEST" if self.snapshot.guest_demo else "MEMBER"
                ),
                "tenant_expires_at": self.snapshot.experience_expires_at,
                "snapshot_json": self.snapshot.model_dump_json(by_alias=True),
            }
        if sql_id == "RESPONSE_SURVEY_LOCK":
            return {"active_version_no": self.snapshot.version}
        if sql_id == "RESPONSE_DUPLICATE_COUNT":
            return {
                "duplicate_count": int(
                    values["respondentKeyHash"] in self.respondent_hashes
                )
            }
        if sql_id == "RESPONSE_BY_IDEMPOTENCY":
            return self.idempotent_rows.get(values["idempotencyKeyHash"])
        if sql_id == "RESPONSE_COUNT_BY_SURVEY":
            return {"response_count": self.response_count}
        return None

    def execute(self, connection, sql_id, params=None):
        values = dict(params or {})
        result = super().execute(connection, sql_id, values)
        if sql_id == "RESPONSE_INSERT" and values.get("respondentKeyHash"):
            self.respondent_hashes.add(values["respondentKeyHash"])
        if sql_id == "RESPONSE_INSERT" and values.get("idempotencyKeyHash"):
            self.idempotent_rows[values["idempotencyKeyHash"]] = {
                "response_id": values["responseId"],
                "survey_version_no": values["surveyVersionNo"],
                "request_payload_hash": values["requestPayloadHash"],
                "submitted_at": values["submittedAt"],
            }
        return result


def test_one_response_submission_is_serialized_before_duplicate_recheck() -> None:
    snapshot = PublicSurvey(
        survey_id="survey-1",
        slug="persistent-survey",
        version=1,
        title="One response",
        category="test",
        sections=[
            SurveySection(
                id="section-1",
                title="Questions",
                questions=[
                    Question(
                        id="optional-text",
                        type=QuestionType.SHORT_TEXT,
                        title="Optional",
                    )
                ],
            )
        ],
        settings=SurveySettings(one_response_per_respondent=True),
        theme=SurveyTheme(),
        published_at=utcnow(),
    )
    pool = SerializedPool()
    crud = OneResponseCrud(snapshot)
    store = OracleStore(settings=get_settings(), pool=pool, crud=crud)
    request = SubmitResponseRequest(respondent_key="same-person", answers=[])

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(store.submit_response, snapshot.slug, request)
            for _ in range(2)
        ]
    successes = 0
    conflicts = 0
    for future in futures:
        try:
            future.result()
            successes += 1
        except ConflictError:
            conflicts += 1

    assert (successes, conflicts) == (1, 1)
    first_lock = crud.events.index("fetch:RESPONSE_SURVEY_LOCK")
    first_duplicate = crud.events.index("fetch:RESPONSE_DUPLICATE_COUNT")
    first_insert = crud.events.index("execute:RESPONSE_INSERT")
    assert first_lock < first_duplicate < first_insert
    lock_sql = sql_loader.get("RESPONSE_SURVEY_LOCK").upper()
    duplicate_sql = sql_loader.get("RESPONSE_DUPLICATE_COUNT").upper()
    assert "FOR UPDATE OF S.ACTIVE_VERSION_NO" in lock_sql
    assert "SURVEY_VERSION_NO" not in duplicate_sql

    try:
        store.submit_response(snapshot.slug, SubmitResponseRequest(answers=[]))
    except DomainValidationError:
        pass
    else:  # pragma: no cover - protects the security policy assertion.
        raise AssertionError("respondentKey-less one-response submission was accepted")


def test_oracle_idempotent_retry_reuses_receipt_and_binds_answer_tenant() -> None:
    snapshot = PublicSurvey(
        survey_id="survey-1",
        slug="persistent-survey",
        version=1,
        title="Retry survey",
        category="test",
        sections=[
            SurveySection(
                id="section-1",
                title="Questions",
                questions=[
                    Question(
                        id="optional-text",
                        type=QuestionType.SHORT_TEXT,
                        title="Optional",
                    )
                ],
            )
        ],
        settings=SurveySettings(),
        theme=SurveyTheme(),
        published_at=utcnow(),
    )
    crud = OneResponseCrud(snapshot)
    store = OracleStore(settings=get_settings(), pool=FakePool(), crud=crud)
    request = SubmitResponseRequest(
        answers=[{"questionId": "optional-text", "value": "same"}]
    )

    first = store.submit_response(
        snapshot.slug,
        request,
        idempotency_key="retry-key-1",
    )
    retried = store.submit_response(
        snapshot.slug,
        request,
        idempotency_key="retry-key-1",
    )

    assert retried == first
    assert sum(sql_id == "RESPONSE_INSERT" for sql_id, _ in crud.executes) == 1
    answer_rows = next(
        rows for sql_id, rows in crud.batches if sql_id == "RESPONSE_ANSWER_INSERT"
    )
    assert answer_rows[0]["tenantId"] == "tenant-1"
    response_insert = next(
        values for sql_id, values in crud.executes if sql_id == "RESPONSE_INSERT"
    )
    assert response_insert["idempotencyKeyHash"] != "retry-key-1"
    assert response_insert["requestPayloadHash"]

    try:
        store.submit_response(
            snapshot.slug,
            SubmitResponseRequest(
                answers=[{"questionId": "optional-text", "value": "changed"}]
            ),
            idempotency_key="retry-key-1",
        )
    except ConflictError:
        pass
    else:  # pragma: no cover - protects the idempotency conflict contract.
        raise AssertionError("An idempotency key was reused with a changed payload")


def test_public_oracle_queries_block_expired_database_guests() -> None:
    public_sql = sql_loader.get("SURVEY_PUBLIC_BY_SLUG").upper()
    lock_sql = sql_loader.get("RESPONSE_SURVEY_LOCK").upper()
    for statement in (public_sql, lock_sql):
        assert 'JOIN "INIT$SVY_TB_TENANT"' in statement
        assert "T.STATUS_CODE = 'ACTIVE'" in statement
        assert "T.TENANT_TYPE_CODE = 'DB_GUEST'" in statement
        assert "T.EXPIRES_AT > SYSTIMESTAMP" in statement

    class ExpiredGuestCrud(RecordingCrud):
        def fetch_one(self, connection, sql_id, params=None):
            if sql_id == "SURVEY_PUBLIC_BY_SLUG":
                return None
            return super().fetch_one(connection, sql_id, params)

    store = OracleStore(
        settings=get_settings(), pool=FakePool(), crud=ExpiredGuestCrud()
    )
    try:
        store.public_survey("expired-db-guest")
    except NotFoundError:
        pass
    else:  # pragma: no cover - protects the expiration access contract.
        raise AssertionError("An expired DB guest survey remained publicly accessible")


def test_oracle_update_rejects_unverified_source_locale_change() -> None:
    current = SimpleNamespace(
        languages=SurveyLanguages(
            source_locale="ko",
            default_locale="ko",
            enabled=["ko", "en"],
        ),
        translations={},
        title="Korean source",
        description=None,
        sections=[],
        settings=SurveySettings(),
    )

    class PromotionStore(OracleStore):
        def _survey_row(self, connection, user, survey_id, *, lock=False):
            return {}

        def _detail_from_row(self, row):
            return current

    store = PromotionStore(
        settings=get_settings(), pool=FakePool(), crud=RecordingCrud()
    )
    user = SimpleNamespace(tenant_id="tenant-1", id="user-1")
    request = SurveyUpdateRequest(
        languages={
            "sourceLocale": "en",
            "defaultLocale": "ko",
            "enabled": ["ko", "en"],
        }
    )

    try:
        store.update_survey(user, "survey-1", request)
    except DomainValidationError:
        pass
    else:  # pragma: no cover - protects the shared repository guard.
        raise AssertionError("Oracle accepted an unverified sourceLocale change")


def test_database_guest_project_limit_is_checked_under_tenant_lock() -> None:
    settings = replace(get_settings(), db_guest_max_projects=1)

    class ProjectLimitCrud(RecordingCrud):
        def fetch_one(self, connection, sql_id, params=None):
            self.events.append(f"fetch:{sql_id}")
            if sql_id == "SURVEY_DB_GUEST_TENANT_LOCK":
                return {"tenant_id": "tenant-1"}
            if sql_id == "SURVEY_COUNT_BY_TENANT":
                return {"project_count": 1}
            return super().fetch_one(connection, sql_id, params)

    crud = ProjectLimitCrud()
    store = OracleStore(settings=settings, pool=FakePool(), crud=crud)
    user = SimpleNamespace(
        tenant_id="tenant-1",
        id="user-1",
        guest_mode=GuestMode.DATABASE,
    )

    try:
        store.create_survey(
            user,
            SurveyCreateRequest(
                title="Over project limit",
                questions=[
                    Question(
                        id="q1",
                        type=QuestionType.SHORT_TEXT,
                        title="Question",
                    )
                ],
            ),
        )
    except DomainValidationError:
        pass
    else:  # pragma: no cover - protects the DB guest project cap.
        raise AssertionError("DB guest project limit was not enforced")
    assert crud.events.index("fetch:SURVEY_DB_GUEST_TENANT_LOCK") < crud.events.index(
        "fetch:SURVEY_COUNT_BY_TENANT"
    )
    assert all(sql_id != "SURVEY_INSERT" for sql_id, _ in crud.executes)


def test_database_guest_question_limit_is_checked_under_survey_lock() -> None:
    settings = replace(get_settings(), db_guest_max_questions=1)
    current = SimpleNamespace(
        languages=SurveyLanguages(),
        translations={},
        title="Draft",
        description=None,
        category="test",
        sections=[],
        settings=SurveySettings(),
        theme=SurveyTheme(),
        skin={},
        logic_rules=[],
    )

    class QuestionLimitStore(OracleStore):
        def _survey_row(self, connection, user, survey_id, *, lock=False):
            assert lock is True
            return {}

        def _detail_from_row(self, row):
            return current

    store = QuestionLimitStore(
        settings=settings, pool=FakePool(), crud=RecordingCrud()
    )
    user = SimpleNamespace(
        tenant_id="tenant-1",
        id="user-1",
        guest_mode=GuestMode.DATABASE,
    )
    request = SurveyUpdateRequest(
        sections=[
            SurveySection(
                id="section-1",
                title="Questions",
                questions=[
                    Question(id="q1", type=QuestionType.SHORT_TEXT, title="One"),
                    Question(id="q2", type=QuestionType.SHORT_TEXT, title="Two"),
                ],
            )
        ]
    )

    try:
        store.update_survey(user, "survey-1", request)
    except DomainValidationError:
        pass
    else:  # pragma: no cover - protects the DB guest question cap.
        raise AssertionError("DB guest question limit was not enforced")


def test_database_guest_response_limit_is_checked_under_survey_lock() -> None:
    settings = replace(get_settings(), db_guest_max_responses=1)
    snapshot = PublicSurvey(
        survey_id="survey-1",
        slug="persistent-db-guest",
        version=1,
        title="DB guest response cap",
        category="test",
        sections=[
            SurveySection(
                id="section-1",
                title="Questions",
                questions=[
                    Question(
                        id="optional-text",
                        type=QuestionType.SHORT_TEXT,
                        title="Optional",
                    )
                ],
            )
        ],
        settings=SurveySettings(),
        theme=SurveyTheme(),
        published_at=utcnow(),
        guest_demo=True,
    )
    crud = OneResponseCrud(snapshot)
    crud.response_count = 1
    store = OracleStore(settings=settings, pool=FakePool(), crud=crud)

    try:
        store.submit_response(snapshot.slug, SubmitResponseRequest(answers=[]))
    except ConflictError:
        pass
    else:  # pragma: no cover - protects the DB guest response cap.
        raise AssertionError("DB guest response limit was not enforced")
    assert crud.events.index("fetch:RESPONSE_SURVEY_LOCK") < crud.events.index(
        "fetch:RESPONSE_COUNT_BY_SURVEY"
    )
    assert all(sql_id != "RESPONSE_INSERT" for sql_id, _ in crud.executes)
