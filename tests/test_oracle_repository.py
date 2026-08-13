from __future__ import annotations

from contextlib import contextmanager
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import timedelta
import hashlib
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
    AdminTemplatePublishRequest,
    DeploymentDraftRequest,
    DeploymentDraftView,
    GuestMode,
    LoginRequest,
    PublicSurvey,
    Question,
    QuestionType,
    SubmitResponseRequest,
    SurveyLanguages,
    SurveyCreateRequest,
    SurveyDetail,
    SurveySection,
    SurveySettings,
    SurveyStatus,
    SurveyTheme,
    SurveyTranslation,
    SurveyUpdateRequest,
    UserRole,
)
from backend.memory_store import UserRecord, _seed_templates
from backend.oracle_store import OracleStore, _json_load, _public_snapshot, utcnow
from backend.delivery_security import decrypt_contact
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
        self.seed_rows: list[dict[str, Any]] = []
        self.events: list[str] = []
        self.guest_login_sequence = 0

    def execute(self, connection, sql_id, params=None):
        self.events.append(f"execute:{sql_id}")
        self.executes.append((sql_id, dict(params or {})))
        if sql_id == "TEMPLATE_REPAIR":
            replacement = dict(params or {})
            for row in self.seed_rows:
                if row["template_code"] == replacement["templateCode"]:
                    row.update(
                        {
                            "template_title": replacement["templateTitle"],
                            "category_code": replacement["categoryCode"],
                            "description": replacement["description"],
                            "content_json": replacement["contentJson"],
                            "status_code": "ACTIVE",
                            "use_yn": "Y",
                        }
                    )
        return 1

    def executemany(self, connection, sql_id, rows):
        self.events.append(f"batch:{sql_id}")
        values = [dict(row) for row in rows]
        self.batches.append((sql_id, values))
        if sql_id == "TEMPLATE_MERGE":
            existing_codes = {row["template_code"] for row in self.seed_rows}
            self.seed_rows.extend(
                {
                    "template_code": row["templateCode"],
                    "template_title": row["templateTitle"],
                    "category_code": row["categoryCode"],
                    "description": row["description"],
                    "content_json": row["contentJson"],
                    "status_code": "ACTIVE",
                    "use_yn": "Y",
                }
                for row in values
                if row["templateCode"] not in existing_codes
            )
        return len(values)

    def fetch_all(self, connection, sql_id, params=None):
        if sql_id == "TEMPLATE_CATALOG_CONTENT_LIST":
            return self.seed_rows
        if sql_id == "TEMPLATE_LIST":
            return [
                row
                for row in self.seed_rows
                if row.get("use_yn", "Y") == "Y"
                and row.get("status_code", "ACTIVE") == "ACTIVE"
            ]
        if sql_id == "TEMPLATE_VERSION_MISSING":
            return [
                row
                for row in self.seed_rows
                if row.get("use_yn", "Y") == "Y"
                and row.get("status_code", "ACTIVE") == "ACTIVE"
            ]
        return []

    def fetch_one(self, connection, sql_id, params=None):
        if sql_id == "AUTH_GUEST_LOGIN_NEXT":
            self.guest_login_sequence += 1
            return {"login_sequence_value": self.guest_login_sequence}
        return None


def assert_exact_sql_binds(
    calls: list[tuple[str, dict[str, Any]]],
) -> None:
    for sql_id, parameters in calls:
        expected = set(
            re.findall(r":([A-Za-z][A-Za-z0-9_]*)", sql_loader.get(sql_id))
        )
        assert set(parameters) == expected, sql_id


def test_oracle_admin_member_guest_filter_and_withdrawal_are_transactional() -> None:
    member_row = {
        "user_id": "user_guest_001",
        "tenant_id": "tenant_guest_001",
        "login_id": "quest001",
        "user_name": "게스트",
        "email": None,
        "role_code": "GUEST",
        "system_admin_yn": "N",
        "guest_yn": "Y",
        "guest_mode_code": "DB",
        "use_yn": "Y",
        "withdrawn_at": None,
        "created_at": utcnow(),
        "tenant_name": "게스트 체험공간",
        "tenant_expires_at": utcnow() + timedelta(hours=2),
        "last_login_at": None,
    }

    class MemberCrud(RecordingCrud):
        def fetch_one(self, connection, sql_id, params=None):
            self.events.append(f"fetch_one:{sql_id}")
            if sql_id == "ADMIN_MEMBER_COUNT":
                assert params["memberType"] == "GUEST"
                return {"member_count": 1}
            if sql_id == "ADMIN_MEMBER_DETAIL_LOCK":
                return dict(member_row)
            return super().fetch_one(connection, sql_id, params)

        def fetch_all(self, connection, sql_id, params=None):
            self.events.append(f"fetch_all:{sql_id}")
            if sql_id == "ADMIN_MEMBER_PAGE":
                assert params["memberType"] == "GUEST"
                return [dict(member_row)]
            return super().fetch_all(connection, sql_id, params)

    pool = FakePool()
    crud = MemberCrud()
    store = OracleStore(settings=get_settings(), pool=pool, crud=crud)
    admin = UserRecord(
        id="user_admin_001",
        tenant_id="tenant_admin_001",
        login_id="admin",
        name="관리자",
        email=None,
        organization_name="관리 기관",
        password_hash=None,
        role=UserRole.OWNER,
        is_guest=False,
        guest_mode=None,
        created_at=utcnow(),
        tenant_expires_at=None,
        system_admin=True,
    )

    page = store.admin_members(
        admin, page=1, page_size=20, member_type="guest"
    )
    assert page.total == 1
    assert page.items[0].is_guest is True
    assert page.items[0].guest_mode == GuestMode.DATABASE

    store.admin_withdraw_member(admin, member_row["user_id"])

    statements = {sql_id: params for sql_id, params in crud.executes}
    assert statements["ADMIN_MEMBER_WITHDRAW"]["userId"] == member_row["user_id"]
    assert statements["ADMIN_MEMBER_WITHDRAW"]["withdrawnLoginId"].startswith(
        "withdrawn_"
    )
    assert statements["ADMIN_MEMBER_TENANT_CLOSE"]["tenantId"] == member_row[
        "tenant_id"
    ]
    assert "ADMIN_MEMBER_SESSIONS_REVOKE" in statements
    assert pool.commits == 1
    assert_exact_sql_binds(crud.executes)


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
        "SURVEY_PAGE_COUNTS_BY_OWNER",
        "SURVEY_PAGE_BY_OWNER",
        "SURVEY_DETAIL_BY_OWNER",
        "SURVEY_DETAIL_FOR_UPDATE",
        "SURVEY_UPDATE_BY_OWNER",
        "SURVEY_APPLY_TEMPLATE_BY_OWNER",
        "SURVEY_SOFT_DELETE_BY_OWNER",
        "SURVEY_CLOSE_BY_OWNER",
        "SURVEY_MARK_PUBLISHED_BY_OWNER",
        "RESPONSE_LIST_BY_OWNER",
        "RESPONSE_ANSWER_LIST_BY_OWNER",
        "RESPONSE_REPORT_LIST",
        "RESPONSE_TOTAL_BY_OWNER",
    ):
        statement = sql_loader.get(sql_id).upper()
        assert ":TENANTID" in statement, sql_id
        assert ":OWNERUSERID" in statement, sql_id


def test_oracle_project_page_is_bounded_and_server_sorted() -> None:
    page_sql = sql_loader.get("SURVEY_PAGE_BY_OWNER").upper()
    count_sql = sql_loader.get("SURVEY_PAGE_COUNTS_BY_OWNER").upper()

    assert "OFFSET :OFFSETROWS ROWS FETCH NEXT :LIMITROWS ROWS ONLY" in page_sql
    assert ":SORTCODE" in page_sql
    assert ":QUERYPATTERN" in page_sql
    assert "FILTERED_COUNT" in count_sql
    assert "TOTAL_COUNT" in count_sql

    class PageCrud(RecordingCrud):
        page_params: dict[str, Any] | None = None

        def fetch_one(self, connection, sql_id, params=None):
            if sql_id == "SURVEY_PAGE_COUNTS_BY_OWNER":
                return {"filtered_count": 41, "total_count": 52}
            return super().fetch_one(connection, sql_id, params)

        def fetch_all(self, connection, sql_id, params=None):
            if sql_id == "SURVEY_PAGE_BY_OWNER":
                self.page_params = dict(params or {})
                return []
            return super().fetch_all(connection, sql_id, params)

    crud = PageCrud()
    store = OracleStore(settings=get_settings(), pool=FakePool(), crud=crud)
    result = store.survey_page(
        SimpleNamespace(tenant_id="tenant-page", id="user-page"),
        page=2,
        page_size=24,
        status=SurveyStatus.DRAFT,
        query=" 만족도 ",
        sort="title",
    )

    assert result.total == 41
    assert result.total_all == 52
    assert result.has_next is False
    assert crud.page_params == {
        "tenantId": "tenant-page",
        "ownerUserId": "user-page",
        "statusCode": "DRAFT",
        "queryPattern": "%만족도%",
        "sortCode": "title",
        "offsetRows": 24,
        "limitRows": 24,
    }


def test_delivery_context_is_owner_scoped_and_pins_the_active_immutable_version() -> None:
    statement = sql_loader.get("DELIVERY_CONTEXT_BY_OWNER").upper()

    assert 'S.TENANT_ID = :TENANTID' in statement
    assert 'S.SURVEY_ID = :SURVEYID' in statement
    assert 'S.OWNER_USER_ID = :OWNERUSERID' in statement
    assert "S.STATUS_CODE = 'PUBLISHED'" in statement
    assert "D.SURVEY_VERSION_NO = S.ACTIVE_VERSION_NO" in statement
    assert "V.VERSION_NO = S.ACTIVE_VERSION_NO" in statement
    assert "D.STATUS_CODE = 'ACTIVE'" in statement
    draft_update = sql_loader.get("DELIVERY_BATCH_UPDATE_DRAFT").upper()
    assert "REVISION_NO = :EXPECTEDREVISION" in draft_update
    assert "STATUS_CODE = 'DRAFT'" in draft_update
    target_list = sql_loader.get("DELIVERY_TARGET_LIST").upper()
    recipient_list = sql_loader.get("DELIVERY_RECIPIENT_LIST").upper()
    latest_batch = sql_loader.get("DELIVERY_BATCH_LATEST").upper()
    latest_batch_lock = sql_loader.get("DELIVERY_BATCH_LATEST_FOR_UPDATE").upper()
    assert "T.BATCH_ID = :BATCHID" in target_list
    assert "T.BATCH_ID = :BATCHID" in recipient_list
    assert "B.STATUS_CODE <> 'CANCELLED'" in latest_batch
    assert "L.STATUS_CODE <> 'CANCELLED'" in latest_batch_lock


def test_admin_template_metadata_patch_can_explicitly_clear_description() -> None:
    statement = sql_loader.get("ADMIN_TEMPLATE_PATCH").upper()

    assert ":DESCRIPTIONSET" in statement
    assert "CASE WHEN :DESCRIPTIONSET = 'Y' THEN :DESCRIPTION" in statement
    assert "CONTENT_JSON =" not in statement


def test_oracle_delivery_draft_encrypts_contacts_and_keeps_them_out_of_plan_json() -> None:
    public = PublicSurvey(
        survey_id="survey-delivery",
        slug="delivery-survey",
        version=3,
        title="Delivery",
        category="test",
        sections=[],
        settings=SurveySettings(),
        theme=SurveyTheme(),
        supported_locales=["ko"],
        published_at=utcnow(),
    )
    context = {
        "tenant_id": "tenant-delivery",
        "survey_id": public.survey_id,
        "survey_version_no": public.version,
        "deployment_id": "deployment-delivery",
        "public_slug": public.slug,
    }

    class DeliveryStore(OracleStore):
        def _delivery_context(self, connection, user, survey_id, *, lock=False):
            assert lock is True
            assert survey_id == public.survey_id
            return context, public

        def deployment(self, user, survey_id):
            return SimpleNamespace(survey_id=survey_id)

    pool = FakePool()
    crud = RecordingCrud()
    store = DeliveryStore(settings=get_settings(), pool=pool, crud=crud)
    user = SimpleNamespace(
        id="user-delivery",
        tenant_id="tenant-delivery",
        tenant_expires_at=None,
    )
    raw_email = "recipient@example.test"
    request = DeploymentDraftRequest.model_validate(
        {
            "recipients": [
                {
                    "id": "respondent-1",
                    "name": "Recipient",
                    "countryCode": "KR",
                    "preferredLanguage": "ko",
                    "email": raw_email,
                    "channels": ["EMAIL"],
                }
            ],
            "channels": ["EMAIL"],
            "messagesByLanguage": {
                "ko": {
                    "emailSubject": "Survey invitation",
                    "emailBody": "Please participate.",
                }
            },
            "schedule": {"mode": "NOW", "strategy": "ALL_AVAILABLE"},
        }
    )

    saved = store.save_deployment(user, public.survey_id, request)

    assert saved.survey_id == public.survey_id
    assert pool.commits == 1
    plan = next(
        params["planJson"]
        for sql_id, params in crud.executes
        if sql_id == "DELIVERY_BATCH_INSERT"
    )
    endpoints = next(
        rows
        for sql_id, rows in crud.batches
        if sql_id == "DELIVERY_RECIPIENT_INSERT"
    )
    assert raw_email not in plan
    assert raw_email not in str(endpoints)
    assert endpoints[0]["contactValueHash"] != raw_email
    assert decrypt_contact(
        get_settings().delivery_secret,
        endpoints[0]["contactValueEncrypted"],
    ) == raw_email
    targets = next(
        rows for sql_id, rows in crud.batches if sql_id == "DELIVERY_TARGET_INSERT"
    )
    inserted_batch = next(
        params["batchId"]
        for sql_id, params in crud.executes
        if sql_id == "DELIVERY_BATCH_INSERT"
    )
    assert targets[0]["batchId"] == inserted_batch
    assert raw_email not in targets[0]["attributesJson"]
    assert json.loads(targets[0]["attributesJson"]) == {"channels": ["EMAIL"]}
    assert_exact_sql_binds(crud.executes)
    assert_exact_sql_binds(
        [
            (sql_id, row)
            for sql_id, rows in crud.batches
            for row in rows
        ]
    )


def test_guest_delivery_providers_remain_disabled_in_oracle_store() -> None:
    store = OracleStore(settings=get_settings(), pool=FakePool(), crud=RecordingCrud())
    guest = SimpleNamespace(is_guest=True)

    providers = store.delivery_providers(guest).providers

    assert set(providers) == {"email", "sms", "kakao", "fax"}
    assert all(not provider.enabled for provider in providers.values())
    assert all(provider.status == "DISABLED" for provider in providers.values())


def test_new_oracle_delivery_batch_never_rewrites_executed_history() -> None:
    now = utcnow()
    public = PublicSurvey(
        survey_id="survey-repeat",
        slug="repeat-survey",
        version=1,
        title="Repeat",
        category="test",
        sections=[],
        settings=SurveySettings(),
        theme=SurveyTheme(),
        supported_locales=["ko"],
        published_at=now,
    )
    context = {
        "tenant_id": "tenant-repeat",
        "survey_id": public.survey_id,
        "survey_version_no": public.version,
        "deployment_id": "deployment-repeat",
        "public_slug": public.slug,
    }
    request = DeploymentDraftRequest.model_validate(
        {
            "recipients": [
                {
                    "id": "respondent-repeat",
                    "name": "Recipient",
                    "countryCode": "KR",
                    "preferredLanguage": "ko",
                    "email": "repeat@example.test",
                    "channels": ["EMAIL"],
                }
            ],
            "channels": ["EMAIL"],
            "messagesByLanguage": {
                "ko": {"emailSubject": "Again", "emailBody": "Again"}
            },
        }
    )
    executed = DeploymentDraftView(
        **request.model_dump(exclude={"revision"}),
        deployment_id=context["deployment_id"],
        survey_id=public.survey_id,
        survey_version=public.version,
        public_slug=public.slug,
        revision=4,
        updated_at=now,
        execution_status="QUEUED",
    )

    class RepeatCrud(RecordingCrud):
        def fetch_one(self, connection, sql_id, params=None):
            if sql_id == "DELIVERY_BATCH_LATEST_FOR_UPDATE":
                return {
                    "batch_id": "old-executed-batch",
                    "tenant_id": "tenant-repeat",
                    "survey_id": public.survey_id,
                    "survey_version_no": public.version,
                    "deployment_id": context["deployment_id"],
                    "revision_no": 4,
                    "status_code": "EXECUTED",
                    "plan_json": "{}",
                    "created_at": now,
                    "updated_at": now,
                }
            return super().fetch_one(connection, sql_id, params)

    class RepeatStore(OracleStore):
        def _delivery_context(self, connection, user, survey_id, *, lock=False):
            return context, public

        def _deployment_from_rows(self, connection, selected_context, batch):
            return executed

        def deployment(self, user, survey_id):
            return SimpleNamespace(survey_id=survey_id)

    crud = RepeatCrud()
    store = RepeatStore(settings=get_settings(), pool=FakePool(), crud=crud)
    user = SimpleNamespace(
        id="user-repeat",
        tenant_id="tenant-repeat",
        tenant_expires_at=None,
    )

    store.save_deployment(user, public.survey_id, request)

    executed_sql = [sql_id for sql_id, _ in crud.executes]
    assert "DELIVERY_BATCH_INSERT" in executed_sql
    assert "DELIVERY_BATCH_UPDATE_DRAFT" not in executed_sql
    assert "DELIVERY_RECIPIENT_DELETE_DRAFT" not in executed_sql
    assert "DELIVERY_TARGET_DELETE_DRAFT" not in executed_sql
    target_rows = next(
        rows for sql_id, rows in crud.batches if sql_id == "DELIVERY_TARGET_INSERT"
    )
    assert target_rows[0]["batchId"] != "old-executed-batch"


def test_oracle_delivery_execution_only_records_queued_or_disabled_work() -> None:
    now = utcnow()
    public = PublicSurvey(
        survey_id="survey-execute",
        slug="execute-survey",
        version=2,
        title="Execute",
        category="test",
        sections=[],
        settings=SurveySettings(),
        theme=SurveyTheme(),
        supported_locales=["ko"],
        published_at=now,
    )
    context = {
        "tenant_id": "tenant-execute",
        "survey_id": public.survey_id,
        "survey_version_no": public.version,
        "deployment_id": "deployment-execute",
        "public_slug": public.slug,
    }
    request = DeploymentDraftRequest.model_validate(
        {
            "revision": 1,
            "recipients": [
                {
                    "id": "respondent-1",
                    "name": "Recipient",
                    "countryCode": "KR",
                    "preferredLanguage": "ko",
                    "email": "recipient@example.test",
                    "mobile": "01012345678",
                    "channels": ["EMAIL", "SMS"],
                }
            ],
            "channels": ["EMAIL", "SMS"],
            "messagesByLanguage": {
                "ko": {
                    "emailSubject": "Survey invitation",
                    "emailBody": "Please participate.",
                    "smsBody": "Please participate.",
                }
            },
            "schedule": {"mode": "NOW", "strategy": "ALL_AVAILABLE"},
        }
    )
    raw = DeploymentDraftView(
        **request.model_dump(exclude={"revision"}),
        deployment_id=context["deployment_id"],
        survey_id=public.survey_id,
        survey_version=public.version,
        public_slug=public.slug,
        revision=2,
        updated_at=now,
    )

    class ExecuteCrud(RecordingCrud):
        def fetch_one(self, connection, sql_id, params=None):
            if sql_id == "DELIVERY_BATCH_LATEST_FOR_UPDATE":
                return {
                    "batch_id": "batch-execute",
                    "tenant_id": "tenant-execute",
                    "survey_id": public.survey_id,
                    "survey_version_no": public.version,
                    "deployment_id": context["deployment_id"],
                    "revision_no": 2,
                    "status_code": "DRAFT",
                    "plan_json": "{}",
                    "created_at": now,
                    "updated_at": now,
                }
            return super().fetch_one(connection, sql_id, params)

        def fetch_all(self, connection, sql_id, params=None):
            if sql_id == "DELIVERY_TARGET_LIST":
                return [
                    {
                        "target_id": "target-1",
                        "client_target_id": "respondent-1",
                    }
                ]
            if sql_id == "DELIVERY_RECIPIENT_LIST":
                return [
                    {
                        "target_id": "target-1",
                        "contact_type_code": "EMAIL",
                        "recipient_id": "endpoint-email",
                    },
                    {
                        "target_id": "target-1",
                        "contact_type_code": "SMS",
                        "recipient_id": "endpoint-sms",
                    },
                ]
            return super().fetch_all(connection, sql_id, params)

    class ExecuteStore(OracleStore):
        def save_deployment(self, user, survey_id, value):
            return raw

        def _delivery_context(self, connection, user, survey_id, *, lock=False):
            assert lock is True
            return context, public

        def _deployment_from_rows(self, connection, selected_context, batch):
            return raw

        def deployment(self, user, survey_id):
            return self._masked_deployment(
                raw.model_copy(update={"execution_status": "PARTIAL"})
            )

    settings = replace(
        get_settings(), email_provider="test-email", sms_provider="disabled"
    )
    crud = ExecuteCrud()
    store = ExecuteStore(settings=settings, pool=FakePool(), crud=crud)
    user = SimpleNamespace(
        id="user-execute",
        tenant_id="tenant-execute",
        is_guest=False,
        tenant_expires_at=None,
    )

    result = store.execute_deployment(user, public.survey_id, request)

    queued = next(
        rows for sql_id, rows in crud.batches if sql_id == "DELIVERY_QUEUE_INSERT"
    )
    assert {row["statusCode"] for row in queued} == {"QUEUED", "DISABLED"}
    assert {row["providerCode"] for row in queued} == {"test-email", "disabled"}
    assert all(row["lastErrorCode"] is None for row in queued if row["statusCode"] == "QUEUED")
    assert all(
        row["lastErrorCode"] == "PROVIDER_DISABLED"
        for row in queued
        if row["statusCode"] == "DISABLED"
    )
    marked = next(
        params
        for sql_id, params in crud.executes
        if sql_id == "DELIVERY_BATCH_MARK_EXECUTED"
    )
    assert marked["executionStatusCode"] == "PARTIAL"
    assert result.execution.execution_status == "PARTIAL"
    assert_exact_sql_binds(crud.executes)
    assert_exact_sql_binds(
        [
            (sql_id, row)
            for sql_id, rows in crud.batches
            for row in rows
        ]
    )


def test_oracle_admin_template_publish_locks_source_and_uses_exact_binds() -> None:
    now = utcnow()
    source = SurveyDetail(
        id="survey-template-source",
        title="Template source",
        category="만족도",
        status=SurveyStatus.DRAFT,
        response_count=0,
        question_count=1,
        created_at=now,
        updated_at=now,
        revision=7,
        sections=[
            SurveySection(
                id="section-template",
                title="Questions",
                questions=[
                    Question(
                        id="question-template",
                        type=QuestionType.SHORT_TEXT,
                        title="Answerable question",
                    )
                ],
            )
        ],
        settings=SurveySettings(),
        theme=SurveyTheme(),
    )

    class AdminTemplateCrud(RecordingCrud):
        detail_reads = 0
        saved_row: dict[str, Any] | None = None

        def fetch_one(self, connection, sql_id, params=None):
            if sql_id == "ADMIN_TEMPLATE_DETAIL_LOCK":
                self.detail_reads += 1
                return None
            if sql_id == "ADMIN_TEMPLATE_DETAIL":
                assert self.saved_row is not None
                return self.saved_row
            return super().fetch_one(connection, sql_id, params)

        def execute(self, connection, sql_id, params=None):
            values = dict(params or {})
            result = super().execute(connection, sql_id, values)
            if sql_id == "ADMIN_TEMPLATE_UPSERT":
                self.saved_row = {
                    "template_code": values["templateCode"],
                    "template_title": values["templateTitle"],
                    "category_code": values["categoryCode"],
                    "description": values["description"],
                    "content_json": values["contentJson"],
                    "status_code": "ACTIVE",
                    "current_version_no": values["versionNo"],
                    "revision_no": 1,
                    "source_survey_id": values["sourceSurveyId"],
                    "created_at": now,
                    "updated_at": now,
                    "current_published_at": now,
                }
            return result

    class AdminTemplateStore(OracleStore):
        source_was_locked = False

        def _survey_row(self, connection, user, survey_id, *, lock=False):
            assert survey_id == source.id
            assert lock is True
            self.source_was_locked = True
            return {"source": source, "admin_template_yn": "Y"}

        @staticmethod
        def _detail_from_row(row):
            return row["source"]

    crud = AdminTemplateCrud()
    pool = FakePool()
    store = AdminTemplateStore(settings=get_settings(), pool=pool, crud=crud)
    user = SimpleNamespace(
        id="system-admin",
        tenant_id="tenant-admin",
        system_admin=True,
    )

    result = store.publish_admin_template(
        user,
        "public-template",
        AdminTemplatePublishRequest(
            source_survey_id=source.id,
            title="Public template",
            description="Reusable template",
            category="만족도",
        ),
    )

    assert result.version_no == 1
    assert store.source_was_locked is True
    assert pool.commits == 1
    assert_exact_sql_binds(crud.executes)
    version_parameters = next(
        parameters
        for sql_id, parameters in crud.executes
        if sql_id == "ADMIN_TEMPLATE_VERSION_INSERT"
    )
    assert json.loads(version_parameters["snapshotJson"])["versionNo"] == 1


def test_oracle_soft_delete_is_transactional_and_blocks_published_projects() -> None:
    class DeleteStore(OracleStore):
        status_code = "DRAFT"

        def _survey_row(self, connection, user, survey_id, *, lock=False):
            assert lock is True
            return {"status_code": self.status_code}

    pool = FakePool()
    crud = RecordingCrud()
    store = DeleteStore(settings=get_settings(), pool=pool, crud=crud)
    user = SimpleNamespace(tenant_id="tenant-1", id="user-1")

    store.delete_survey(user, "survey-1")

    assert pool.commits == 1
    assert crud.executes == [
        (
            "SURVEY_SOFT_DELETE_BY_OWNER",
            {
                "surveyId": "survey-1",
                "tenantId": "tenant-1",
                "ownerUserId": "user-1",
            },
        )
    ]

    store.status_code = "PUBLISHED"
    with pytest.raises(ConflictError, match="진행 중"):
        store.delete_survey(user, "survey-2")
    assert pool.rollbacks == 1
    assert len(crud.executes) == 1


def test_oracle_close_stops_public_deployment_before_delete() -> None:
    sentinel = object()

    class CloseStore(OracleStore):
        status_code = "PUBLISHED"

        def _survey_row(self, connection, user, survey_id, *, lock=False):
            assert lock is True
            return {"status_code": self.status_code}

        def get_survey(self, user, survey_id):
            return sentinel

    pool = FakePool()
    crud = RecordingCrud()
    store = CloseStore(settings=get_settings(), pool=pool, crud=crud)
    user = SimpleNamespace(tenant_id="tenant-1", id="user-1")

    assert store.close_survey(user, "survey-1") is sentinel
    assert pool.commits == 1
    assert crud.executes == [
        (
            "SURVEY_CLOSE_BY_OWNER",
            {
                "surveyId": "survey-1",
                "tenantId": "tenant-1",
                "ownerUserId": "user-1",
            },
        ),
        (
            "SURVEY_DEPLOYMENT_CLOSE",
            {"surveyId": "survey-1", "tenantId": "tenant-1"},
        ),
    ]
    assert_exact_sql_binds(crud.executes)

    store.status_code = "CLOSED"
    with pytest.raises(ConflictError, match="진행 중"):
        store.close_survey(user, "survey-2")
    assert pool.rollbacks == 1


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
    assert_exact_sql_binds(crud.executes)
    assert_exact_sql_binds(
        [
            (sql_id, row)
            for sql_id, rows in crud.batches
            for row in rows
        ]
    )


def test_invalid_legacy_seed_template_json_is_repaired() -> None:
    pool = FakePool()
    crud = RecordingCrud()
    crud.seed_rows = [
        {
            "template_code": "social-research",
            "template_title": "legacy",
            "category_code": "legacy",
            "description": "legacy",
            "content_json": "{'code': 'social-research'}",
            "status_code": "ARCHIVED",
            "use_yn": "N",
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


def test_inactive_invalid_non_seed_template_does_not_break_public_catalog() -> None:
    pool = FakePool()
    crud = RecordingCrud()
    crud.seed_rows = [
        {
            "template_code": "retired-custom-template",
            "template_title": "retired",
            "category_code": "legacy",
            "description": "legacy",
            "content_json": "{'legacy': True}",
            "status_code": "ARCHIVED",
            "use_yn": "N",
        }
    ]
    store = OracleStore(settings=get_settings(), pool=pool, crud=crud)

    templates = store.templates()

    assert {template.code for template in templates} >= {
        "social-research",
        "integrity-survey",
        "business-survey",
    }
    assert not any(
        params.get("templateCode") == "retired-custom-template"
        for sql_id, params in crud.executes
        if sql_id == "TEMPLATE_REPAIR"
    )


def test_active_invalid_non_seed_template_still_fails_closed() -> None:
    crud = RecordingCrud()
    crud.seed_rows = [
        {
            "template_code": "active-custom-template",
            "template_title": "active",
            "category_code": "custom",
            "description": "custom",
            "content_json": "{'invalid': True}",
            "status_code": "ACTIVE",
            "use_yn": "Y",
        }
    ]
    store = OracleStore(settings=get_settings(), pool=FakePool(), crud=crud)

    with pytest.raises(
        RuntimeError, match="Template CONTENT_JSON is invalid: active-custom-template"
    ):
        store.templates()


def test_oracle_native_json_value_is_not_reparsed_as_python_repr() -> None:
    native_value = {
        "code": "social-research",
        "languages": {"sourceLocale": "ko"},
    }

    assert _json_load(native_value, {}) is native_value


def test_oracle_native_template_json_is_serialized_for_version_snapshot() -> None:
    crud = RecordingCrud()
    native_content = json.loads(
        next(
            template.model_dump_json(by_alias=True)
            for template in _seed_templates()
            if template.code == "business-survey"
        )
    )
    crud.seed_rows = [
        {
            "template_code": "business-survey",
            "template_title": native_content["title"],
            "category_code": native_content["category"],
            "description": native_content["description"],
            "content_json": native_content,
            "status_code": "ACTIVE",
            "use_yn": "Y",
        }
    ]
    store = OracleStore(settings=get_settings(), pool=FakePool(), crud=crud)

    templates = store.templates()

    snapshot = next(
        params
        for sql_id, params in crud.executes
        if sql_id == "TEMPLATE_VERSION_SEED"
        and params["templateCode"] == "business-survey"
    )
    assert json.loads(snapshot["snapshotJson"])["code"] == "business-survey"
    assert snapshot["contentHash"] == hashlib.sha256(
        snapshot["snapshotJson"].encode("utf-8")
    ).hexdigest()
    assert any(template.code == "business-survey" for template in templates)


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


def test_readiness_query_matches_all_ddl_tables() -> None:
    ddl = (PROJECT_ROOT / "database" / "SURVEYONE_SYSTEM_DDL.sql").read_text(
        encoding="utf-8"
    )
    ddl_tables = set(re.findall(r'CREATE TABLE "(INIT\$SVY_TB_[A-Z0-9_]+)"', ddl))
    readiness_tables = set(
        re.findall(r"'(INIT\$SVY_TB_[A-Z0-9_]+)'", sql_loader.get("AUTH_SCHEMA_READY"))
    )

    assert len(ddl_tables) == 23
    assert readiness_tables == ddl_tables

    class ReadinessCrud(RecordingCrud):
        def __init__(
            self,
            count: int,
            *,
            critical_columns: int = 16,
            critical_constraints: int = 14,
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
        settings=get_settings(), pool=FakePool(), crud=ReadinessCrud(23)
    ).readiness()
    incomplete = OracleStore(
        settings=get_settings(), pool=FakePool(), crud=ReadinessCrud(22)
    ).readiness()
    malformed = OracleStore(
        settings=get_settings(),
        pool=FakePool(),
        crud=ReadinessCrud(23, critical_columns=15),
    ).readiness()
    invalid_function = OracleStore(
        settings=get_settings(),
        pool=FakePool(),
        crud=ReadinessCrud(23, valid_functions=1),
    ).readiness()
    missing_sequence = OracleStore(
        settings=get_settings(),
        pool=FakePool(),
        crud=ReadinessCrud(23, guest_sequences=0),
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
