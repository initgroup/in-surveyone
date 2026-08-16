from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from threading import Lock
import time
from typing import Protocol, runtime_checkable

from fastapi import Request

from backend.config import Settings, get_settings
from backend.errors import AuthenticationError
from backend.memory_store import UserRecord, memory_store
from backend.models import (
    AdminTemplateDraftRequest,
    AdminTemplateDraftView,
    AdminTemplatePatchRequest,
    AdminTemplatePublishRequest,
    AdminTemplateView,
    AdminMemberPage,
    AdminMemberStatusRequest,
    AdminMemberView,
    AdminPasswordResetView,
    AuthSessionView,
    DashboardView,
    DeliveryProvidersView,
    DeploymentDraftRequest,
    DeploymentDraftView,
    DeploymentExecuteRequest,
    DeploymentExecuteResult,
    GuestCapabilitiesView,
    GuestFeatures,
    GuestProvisionView,
    GuestLimits,
    GuestMode,
    GuestModeCapability,
    LoginRequest,
    PublicSurvey,
    PublishRequest,
    PublishResult,
    PublicUrlRegenerationResult,
    ResponseReceipt,
    SignupRequest,
    SubmitResponseRequest,
    SurveyCreateRequest,
    SurveyDetail,
    SurveyPage,
    SurveyReport,
    SurveyResponseView,
    SurveyStatus,
    SurveySummary,
    SurveyTemplate,
    SurveyTemplateApplyRequest,
    SurveyTemplateResetRequest,
    SurveyUpdateRequest,
)


_probe_lock = Lock()
_probe_at = 0.0
_probe_result: tuple[bool, str | None] = (False, "Oracle has not been checked.")


def _database_guest_probe(
    settings: Settings, *, force_refresh: bool = False
) -> tuple[bool, str | None]:
    global _probe_at, _probe_result
    if settings.environment == "test" and settings.db_mode == "memory":
        return True, None
    if settings.db_mode != "oracle" or not all(
        (settings.db_user, settings.db_password, settings.db_dsn)
    ):
        return False, "Oracle mode and DB connection settings are required."
    now = time.monotonic()
    with _probe_lock:
        if _probe_at and not force_refresh and now - _probe_at < 30:
            return _probe_result
        store = oracle_store()
        readiness = getattr(store, "readiness", None)
        _probe_result = (
            readiness()
            if callable(readiness)
            else (False, "Oracle repository readiness check is unavailable.")
        )
        _probe_at = now
        return _probe_result


def prime_database_guest_probe(settings: Settings | None = None) -> tuple[bool, str | None]:
    return _database_guest_probe(settings or get_settings(), force_refresh=True)


@runtime_checkable
class SurveyStore(Protocol):
    def create_guest(
        self, display_name: str, mode: GuestMode = GuestMode.DATABASE
    ) -> GuestProvisionView: ...

    def signup(self, request: SignupRequest) -> tuple[str, AuthSessionView]: ...
    def login(self, request: LoginRequest) -> tuple[str, AuthSessionView]: ...
    def authenticate(self, raw_token: str | None) -> UserRecord: ...
    def auth_session(self, raw_token: str | None) -> AuthSessionView: ...
    def extend_session(self, raw_token: str | None) -> AuthSessionView: ...
    def logout(self, raw_token: str | None) -> None: ...
    def templates(self) -> list[SurveyTemplate]: ...
    def template(self, code: str) -> SurveyTemplate: ...
    def admin_templates(self, user: UserRecord) -> list[AdminTemplateView]: ...
    def create_admin_template_draft(
        self, user: UserRecord, request: AdminTemplateDraftRequest
    ) -> AdminTemplateDraftView: ...
    def delete_admin_template_draft(
        self, user: UserRecord, survey_id: str
    ) -> None: ...
    def publish_admin_template(
        self,
        user: UserRecord,
        code: str,
        request: AdminTemplatePublishRequest,
    ) -> AdminTemplateView: ...
    def patch_admin_template(
        self,
        user: UserRecord,
        code: str,
        request: AdminTemplatePatchRequest,
    ) -> AdminTemplateView: ...
    def delete_admin_template(self, user: UserRecord, code: str) -> None: ...
    def admin_members(
        self,
        user: UserRecord,
        *,
        page: int,
        page_size: int,
        query: str = "",
        member_type: str = "all",
    ) -> AdminMemberPage: ...
    def admin_reset_member_password(
        self, user: UserRecord, member_id: str
    ) -> AdminPasswordResetView: ...
    def admin_set_member_status(
        self, user: UserRecord, member_id: str, request: AdminMemberStatusRequest
    ) -> AdminMemberView: ...
    def admin_withdraw_member(self, user: UserRecord, member_id: str) -> None: ...
    def create_survey(
        self,
        user: UserRecord,
        request: SurveyCreateRequest,
        *,
        admin_template: bool = False,
    ) -> SurveyDetail: ...
    def list_surveys(
        self,
        user: UserRecord,
        status: SurveyStatus | None = None,
        *,
        stage: str | None = None,
    ) -> list[SurveySummary]: ...
    def survey_page(
        self,
        user: UserRecord,
        *,
        page: int,
        page_size: int,
        status: SurveyStatus | None = None,
        stage: str | None = None,
        query: str = "",
        sort: str = "updated-desc",
    ) -> SurveyPage: ...
    def get_survey(self, user: UserRecord, survey_id: str) -> SurveyDetail: ...
    def apply_template(
        self, user: UserRecord, survey_id: str, request: SurveyTemplateApplyRequest
    ) -> SurveyDetail: ...
    def reset_template(
        self, user: UserRecord, survey_id: str, request: SurveyTemplateResetRequest
    ) -> SurveyDetail: ...
    def update_survey(
        self, user: UserRecord, survey_id: str, request: SurveyUpdateRequest
    ) -> SurveyDetail: ...
    def delete_survey(self, user: UserRecord, survey_id: str) -> None: ...
    def close_survey(self, user: UserRecord, survey_id: str) -> SurveyDetail: ...
    def publish(
        self, user: UserRecord, survey_id: str, request: PublishRequest
    ) -> PublishResult: ...
    def regenerate_public_url(
        self, user: UserRecord, survey_id: str
    ) -> PublicUrlRegenerationResult: ...
    def public_survey(self, slug: str, language: str | None = None) -> PublicSurvey: ...
    def submit_response(
        self,
        slug: str,
        request: SubmitResponseRequest,
        *,
        idempotency_key: str | None = None,
    ) -> ResponseReceipt: ...
    def responses(
        self, user: UserRecord, survey_id: str, *, offset: int = 0, limit: int = 100
    ) -> list[SurveyResponseView]: ...
    def report(
        self,
        user: UserRecord,
        survey_id: str,
        *,
        cutoff_date: date | None = None,
        response_status: str = "all",
    ) -> SurveyReport: ...
    def dashboard(self, user: UserRecord) -> DashboardView: ...
    def delivery_providers(self, user: UserRecord) -> DeliveryProvidersView: ...
    def deployment(self, user: UserRecord, survey_id: str) -> DeploymentDraftView: ...
    def save_deployment(
        self, user: UserRecord, survey_id: str, request: DeploymentDraftRequest
    ) -> DeploymentDraftView: ...
    def execute_deployment(
        self, user: UserRecord, survey_id: str, request: DeploymentExecuteRequest
    ) -> DeploymentExecuteResult: ...
    def page_help(self, menu_id: str, language: str) -> dict[str, object]: ...


@lru_cache(maxsize=1)
def oracle_store() -> SurveyStore:
    from backend.oracle_store import OracleStore

    return OracleStore()


def primary_store(settings: Settings | None = None) -> SurveyStore:
    selected = settings or get_settings()
    if selected.environment == "test" and selected.db_mode == "memory":
        return memory_store
    return oracle_store()


def resolve_authenticated_store(raw_token: str | None) -> tuple[SurveyStore, UserRecord]:
    if not raw_token:
        raise AuthenticationError("로그인 세션이 필요합니다.")

    selected = get_settings()
    if selected.environment == "test" and selected.db_mode == "memory":
        return memory_store, memory_store.authenticate(raw_token)
    store = oracle_store()
    return store, store.authenticate(raw_token)


def bind_authenticated_request(
    request: Request,
    store: SurveyStore,
    user: UserRecord,
) -> None:
    request.state.surveyone_store = store
    request.state.surveyone_user = user
    expires_at = datetime.now(timezone.utc) + timedelta(
        seconds=max(1, get_settings().session_ttl_seconds - 1)
    )
    if user.tenant_expires_at is not None:
        expires_at = min(expires_at, user.tenant_expires_at)
    request.state.surveyone_session_expires_at = expires_at


def request_store(request: Request, *, authenticate: bool = True) -> SurveyStore:
    cached = getattr(request.state, "surveyone_store", None)
    if cached is not None:
        return cached
    token = request.cookies.get(get_settings().session_cookie_name)
    if token:
        try:
            store, user = resolve_authenticated_store(token)
        except AuthenticationError:
            if authenticate:
                raise
        else:
            bind_authenticated_request(request, store, user)
            return store
    if authenticate:
        raise AuthenticationError("로그인 세션이 필요합니다.")
    return primary_store()


def public_store(slug: str) -> SurveyStore:
    selected = get_settings()
    if selected.environment == "test" and selected.db_mode == "memory":
        return memory_store
    return oracle_store()


def guest_capabilities(
    selected_mode: GuestMode = GuestMode.DATABASE,
    *,
    settings: Settings | None = None,
) -> GuestCapabilitiesView:
    selected = settings or get_settings()
    database_configured, database_reason = _database_guest_probe(
        selected,
        force_refresh=selected_mode == GuestMode.DATABASE,
    )
    providers = {
        "email": selected.email_provider not in {"", "disabled"},
        "sms": selected.sms_provider not in {"", "disabled"},
        "kakao": selected.kakao_provider not in {"", "disabled"},
    }
    database = GuestModeCapability(
        mode=GuestMode.DATABASE,
        title="게스트(손님)",
        available=database_configured,
        reason=(
            f"첫 저장 전에는 계정을 만들지 않으며, 발급 후 미사용 계정은 {selected.guest_unused_ttl_hours}시간, 프로젝트 저장 계정은 {selected.guest_project_ttl_hours}시간 접근 가능한 Oracle 체험 공간입니다. "
            "외부 발송과 맞춤 보고서 영구 저장은 미리보기만 제공됩니다."
            if database_configured
            else database_reason
        ),
        persistence="oracle-temporary-tenant",
        expires_in_hours=selected.guest_unused_ttl_hours,
        limits=GuestLimits(
            max_projects=selected.db_guest_max_projects,
            max_questions_per_survey=selected.db_guest_max_questions,
            max_responses_per_survey=selected.db_guest_max_responses,
        ),
        features=GuestFeatures(
            templates=True,
            publish_demo_url=True,
            external_delivery=False,
            raw_data_export=True,
            custom_report_persistence=False,
            multilingual=True,
            all_question_types=True,
        ),
        provider_configured=providers,
    )
    return GuestCapabilitiesView(
        selected_mode=GuestMode.DATABASE,
        modes=[database],
    )
