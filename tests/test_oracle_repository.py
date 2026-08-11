from __future__ import annotations

from contextlib import contextmanager
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
import json
import re
from threading import Lock
from types import SimpleNamespace
from typing import Any

from backend.config import PROJECT_ROOT, get_settings
from backend.errors import ConflictError, DomainValidationError, NotFoundError
from backend.models import (
    GuestMode,
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
from backend.oracle_store import OracleStore, _json_load, utcnow
from backend.security import session_token_hash
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
        return None


def test_database_guest_is_persisted_and_session_token_is_hashed() -> None:
    pool = FakePool()
    crud = RecordingCrud()
    settings = get_settings()
    store = OracleStore(settings=settings, pool=pool, crud=crud)

    token, session = store.create_guest("DB tester", GuestMode.DATABASE)

    assert session.user.guest_mode == GuestMode.DATABASE
    assert pool.commits == 1
    statements = {sql_id: params for sql_id, params in crud.executes}
    assert statements["AUTH_TENANT_INSERT"]["tenantTypeCode"] == "DB_GUEST"
    assert statements["AUTH_USER_INSERT"]["guestModeCode"] == "DB"
    assert (
        statements["AUTH_SESSION_INSERT"]["expiresAt"]
        == statements["AUTH_TENANT_INSERT"]["expiresAt"]
        == session.expires_at
    )
    persisted_hash = statements["AUTH_SESSION_INSERT"]["sessionTokenHash"]
    assert persisted_hash == session_token_hash(token, settings.session_secret)
    assert token != persisted_hash
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
    assert [row["langCode"] for row in survey_language_rows] == ["fr", "en-US", "ar"]


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
        ) -> None:
            super().__init__()
            self.count = count
            self.critical_columns = critical_columns
            self.critical_constraints = critical_constraints
            self.valid_functions = valid_functions

        def fetch_one(self, connection, sql_id, params=None):
            assert sql_id == "AUTH_SCHEMA_READY"
            return {
                "table_count": self.count,
                "critical_column_count": self.critical_columns,
                "critical_constraint_count": self.critical_constraints,
                "valid_function_count": self.valid_functions,
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
    assert ready == (True, None)
    assert incomplete[0] is False
    assert "incomplete" in str(incomplete[1]).lower()
    assert malformed[0] is False
    assert invalid_function[0] is False


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
    assert "FOR UPDATE" in sql_loader.get("RESPONSE_SURVEY_LOCK").upper()

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
