from __future__ import annotations

from datetime import date
from functools import lru_cache
from threading import Lock
import time
from typing import Protocol, runtime_checkable

from fastapi import Request

from backend.config import Settings, get_settings
from backend.errors import AuthenticationError
from backend.memory_store import UserRecord, memory_store
from backend.models import (
    AuthSessionView,
    DashboardView,
    GuestCapabilitiesView,
    GuestFeatures,
    GuestLimits,
    GuestMode,
    GuestModeCapability,
    LoginRequest,
    PublicSurvey,
    PublishRequest,
    PublishResult,
    ResponseReceipt,
    SignupRequest,
    SubmitResponseRequest,
    SurveyCreateRequest,
    SurveyDetail,
    SurveyReport,
    SurveyResponseView,
    SurveyStatus,
    SurveySummary,
    SurveyTemplate,
    SurveyUpdateRequest,
)


_probe_lock = Lock()
_probe_at = 0.0
_probe_result: tuple[bool, str | None] = (False, "Oracle has not been checked.")


def _database_guest_probe(
    settings: Settings, *, force_refresh: bool = False
) -> tuple[bool, str | None]:
    global _probe_at, _probe_result
    if settings.db_mode != "oracle" or not all(
        (settings.db_user, settings.db_password, settings.db_dsn)
    ):
        return False, "Oracle mode and DB connection settings are required."
    now = time.monotonic()
    with _probe_lock:
        if _probe_at and (not force_refresh or now - _probe_at < 30):
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
        self, display_name: str, mode: GuestMode = GuestMode.LOCAL
    ) -> tuple[str, AuthSessionView]: ...

    def signup(self, request: SignupRequest) -> tuple[str, AuthSessionView]: ...
    def login(self, request: LoginRequest) -> tuple[str, AuthSessionView]: ...
    def authenticate(self, raw_token: str | None) -> UserRecord: ...
    def auth_session(self, raw_token: str | None) -> AuthSessionView: ...
    def logout(self, raw_token: str | None) -> None: ...
    def templates(self) -> list[SurveyTemplate]: ...
    def template(self, code: str) -> SurveyTemplate: ...
    def create_survey(self, user: UserRecord, request: SurveyCreateRequest) -> SurveyDetail: ...
    def list_surveys(
        self, user: UserRecord, status: SurveyStatus | None = None
    ) -> list[SurveySummary]: ...
    def get_survey(self, user: UserRecord, survey_id: str) -> SurveyDetail: ...
    def update_survey(
        self, user: UserRecord, survey_id: str, request: SurveyUpdateRequest
    ) -> SurveyDetail: ...
    def publish(
        self, user: UserRecord, survey_id: str, request: PublishRequest
    ) -> PublishResult: ...
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
    def page_help(self, menu_id: str, language: str) -> dict[str, object]: ...


@lru_cache(maxsize=1)
def oracle_store() -> SurveyStore:
    from backend.oracle_store import OracleStore

    return OracleStore()


def primary_store(settings: Settings | None = None) -> SurveyStore:
    selected = settings or get_settings()
    return oracle_store() if selected.db_mode == "oracle" else memory_store


def resolve_authenticated_store(raw_token: str | None) -> tuple[SurveyStore, UserRecord]:
    if not raw_token:
        raise AuthenticationError("로그인 세션이 필요합니다.")

    # Tokens are opaque random values. Store selection is proven by finding the
    # HMAC token hash in a repository, never by trusting a caller-controlled prefix.
    try:
        return memory_store, memory_store.authenticate(raw_token)
    except AuthenticationError:
        pass

    if get_settings().db_mode == "oracle":
        store = oracle_store()
        return store, store.authenticate(raw_token)
    raise AuthenticationError("로그인 세션이 유효하지 않습니다.")


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
            request.state.surveyone_store = store
            request.state.surveyone_user = user
            return store
    if authenticate:
        raise AuthenticationError("로그인 세션이 필요합니다.")
    return primary_store()


def public_store(slug: str) -> SurveyStore:
    # The namespace itself selects exactly one repository. This prevents a
    # local slug from shadowing a persistent route and prevents local typos
    # from ever acquiring an Oracle connection.
    if slug.startswith("local-guest-"):
        memory_store.public_survey(slug)
        return memory_store
    if get_settings().db_mode == "oracle":
        store = oracle_store()
        store.public_survey(slug)
        return store
    memory_store.public_survey(slug)
    return memory_store


def guest_capabilities(
    selected_mode: GuestMode = GuestMode.LOCAL,
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
    local = GuestModeCapability(
        mode=GuestMode.LOCAL,
        title="로컬 게스트",
        available=True,
        reason="브라우저 체험용이며 서버 재시작 시 데이터가 사라집니다.",
        persistence="process-memory",
        expires_in_hours=selected.guest_project_ttl_hours,
        limits=GuestLimits(
            max_projects=selected.local_guest_max_projects,
            max_questions_per_survey=selected.local_guest_max_questions,
            max_responses_per_survey=selected.local_guest_max_responses,
        ),
        features=GuestFeatures(
            templates=True,
            publish_demo_url=True,
            external_delivery=False,
            raw_data_export=False,
            custom_report_persistence=False,
            multilingual=True,
            all_question_types=True,
        ),
        provider_configured={key: False for key in providers},
    )
    database = GuestModeCapability(
        mode=GuestMode.DATABASE,
        title="DB 게스트",
        available=database_configured,
        reason=(
            f"Oracle에 {selected.guest_project_ttl_hours}시간 접근 가능한 설문 제작·배포·응답 체험 공간입니다. "
            "외부 발송과 맞춤 보고서 영구 저장은 미리보기만 제공됩니다."
            if database_configured
            else database_reason
        ),
        persistence="oracle-temporary-tenant",
        expires_in_hours=selected.guest_project_ttl_hours,
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
    return GuestCapabilitiesView(selected_mode=selected_mode, modes=[local, database])
