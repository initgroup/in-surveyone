from __future__ import annotations

import hashlib
import json
import math
import re
import secrets
import unicodedata
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from threading import RLock
from typing import Any, Iterable
from uuid import uuid4

from backend.config import Settings, get_settings
from backend.errors import (
    AuthenticationError,
    ConflictError,
    DomainValidationError,
    NotFoundError,
)
from backend.models import (
    AnswerItem,
    AuthSessionView,
    DashboardView,
    GuestMode,
    LoginRequest,
    PublicSurvey,
    PublishRequest,
    PublishResult,
    Question,
    QuestionOption,
    QuestionReport,
    QuestionSettings,
    QuestionType,
    ResponseReceipt,
    SignupRequest,
    SubmitResponseRequest,
    SurveyCreateRequest,
    SurveyDetail,
    SurveyLanguages,
    SurveyReport,
    SurveyResponseView,
    SurveySection,
    SurveySettings,
    SurveyStatus,
    SurveySummary,
    SurveyTemplate,
    SurveyTheme,
    SurveyTranslation,
    SurveyUpdateRequest,
    UserRole,
    UserView,
    _normalize_locale,
)
from backend.security import (
    hash_password,
    new_session_token,
    session_token_hash,
    validate_idempotency_key,
    verify_password,
)


REPORT_TIMEZONE = timezone(timedelta(hours=9), name="Asia/Seoul")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_id(prefix: str) -> str:
    maximum_hex_length = max(8, 39 - len(prefix))
    return f"{prefix}_{uuid4().hex[:maximum_hex_length]}"


def submission_payload_hash(
    survey: PublicSurvey,
    answers: list[AnswerItem],
    request: SubmitResponseRequest,
) -> str:
    """Hash the normalized, version-bound submission for safe retry comparison."""
    canonical = json.dumps(
        {
            "surveyId": survey.survey_id,
            "surveyVersion": survey.version,
            "respondentKey": request.respondent_key,
            "answers": [
                answer.model_dump(by_alias=True, mode="json") for answer in answers
            ],
            "metadata": request.metadata,
        },
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


@dataclass(frozen=True, slots=True)
class TenantRecord:
    id: str
    name: str
    created_at: datetime
    expires_at: datetime | None


@dataclass(frozen=True, slots=True)
class UserRecord:
    id: str
    tenant_id: str
    login_id: str
    name: str
    email: str | None
    organization_name: str
    password_hash: str | None
    role: UserRole
    is_guest: bool
    guest_mode: GuestMode | None
    created_at: datetime
    tenant_expires_at: datetime | None


@dataclass(frozen=True, slots=True)
class SessionRecord:
    token_hash: str
    user_id: str
    created_at: datetime
    expires_at: datetime


@dataclass(frozen=True, slots=True)
class PublishedVersionRecord:
    version: int
    snapshot_json: str
    content_hash: str
    published_at: datetime


@dataclass(slots=True)
class SurveyRecord:
    id: str
    tenant_id: str
    owner_id: str
    title: str
    description: str | None
    category: str
    template_code: str | None
    sections: list[SurveySection]
    settings: SurveySettings
    theme: SurveyTheme
    skin: dict[str, Any]
    logic_rules: list[dict[str, Any]]
    default_locale: str
    supported_locales: list[str]
    translations: dict[str, Any]
    languages: SurveyLanguages
    status: SurveyStatus
    revision: int
    slug: str | None
    versions: list[PublishedVersionRecord]
    created_at: datetime
    updated_at: datetime
    published_at: datetime | None


@dataclass(frozen=True, slots=True)
class ResponseRecord:
    id: str
    survey_id: str
    tenant_id: str
    survey_version: int
    answers_json: str
    respondent_key: str | None
    idempotency_key_hash: str | None
    request_payload_hash: str | None
    metadata_json: str
    submitted_at: datetime


class MemoryStore:
    """Thread-safe in-process repository for development and guest trials."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self._lock = RLock()
        self._tenants: dict[str, TenantRecord] = {}
        self._users: dict[str, UserRecord] = {}
        self._users_by_login: dict[str, str] = {}
        self._sessions: dict[str, SessionRecord] = {}
        self._templates: dict[str, SurveyTemplate] = {}
        self._surveys: dict[str, SurveyRecord] = {}
        self._slug_routes: dict[str, tuple[str, int]] = {}
        self._responses: dict[str, list[ResponseRecord]] = {}
        self._idempotency_receipts: dict[
            tuple[str, str, str], tuple[str, ResponseReceipt]
        ] = {}
        self._seed()

    @staticmethod
    def _clone_model(value):
        return value.model_copy(deep=True)

    @staticmethod
    def _normalize_login(login_id: str) -> str:
        return login_id.strip().lower()

    def _user_view(self, user: UserRecord) -> UserView:
        return UserView(
            id=user.id,
            login_id=user.login_id,
            name=user.name,
            email=user.email,
            tenant_id=user.tenant_id,
            organization_name=user.organization_name,
            role=user.role,
            is_guest=user.is_guest,
            guest_mode=user.guest_mode,
            created_at=user.created_at,
        )

    def _seed(self) -> None:
        templates = _seed_templates()
        self._templates = {template.code: template for template in templates}

        created_at = utcnow()
        tenant = TenantRecord(
            id="tenant_demo",
            name="IN-SURVEYONE 데모",
            created_at=created_at,
            expires_at=None,
        )
        user = UserRecord(
            id="user_demo",
            tenant_id=tenant.id,
            login_id="demo-owner",
            name="데모 운영자",
            email=None,
            organization_name=tenant.name,
            password_hash=None,
            role=UserRole.OWNER,
            is_guest=False,
            guest_mode=None,
            created_at=created_at,
            tenant_expires_at=None,
        )
        self._tenants[tenant.id] = tenant
        self._users[user.id] = user

        template = self._templates["social-research"]
        survey = SurveyRecord(
            id="survey_demo_social",
            tenant_id=tenant.id,
            owner_id=user.id,
            title="시민 생활 만족도 데모 조사",
            description="IN-SURVEYONE의 모바일 설문 응답 흐름을 체험하는 공개 데모입니다.",
            category="사회조사",
            template_code=template.code,
            sections=[section.model_copy(deep=True) for section in template.sections],
            settings=template.settings.model_copy(deep=True),
            theme=template.theme.model_copy(deep=True),
            skin=_skin_from_theme(template.theme),
            logic_rules=[],
            default_locale=template.default_locale,
            supported_locales=list(template.supported_locales),
            translations={
                key: value.model_copy(deep=True)
                for key, value in template.translations.items()
            },
            languages=template.languages.model_copy(deep=True),
            status=SurveyStatus.DRAFT,
            revision=1,
            slug=None,
            versions=[],
            created_at=created_at,
            updated_at=created_at,
            published_at=None,
        )
        self._surveys[survey.id] = survey
        self._responses[survey.id] = []
        self._publish_locked(survey, PublishRequest(slug="citizen-life-demo"))

    def templates(self) -> list[SurveyTemplate]:
        with self._lock:
            return [
                template.model_copy(deep=True)
                for template in sorted(self._templates.values(), key=lambda item: item.title)
            ]

    def template(self, code: str) -> SurveyTemplate:
        with self._lock:
            template = self._templates.get(code)
            if template is None:
                raise NotFoundError("설문 템플릿을 찾을 수 없습니다.")
            return template.model_copy(deep=True)

    def create_guest(
        self,
        display_name: str,
        mode: GuestMode = GuestMode.LOCAL,
    ) -> tuple[str, AuthSessionView]:
        if mode != GuestMode.LOCAL:
            raise DomainValidationError("The in-process store only supports local guests.")
        with self._lock:
            now = utcnow()
            expires_at = now + timedelta(hours=self.settings.guest_project_ttl_hours)
            suffix = secrets.token_hex(4)
            tenant = TenantRecord(
                id=new_id("tenant"),
                name=f"게스트 체험공간 {suffix.upper()}",
                created_at=now,
                expires_at=expires_at,
            )
            user = UserRecord(
                id=new_id("user"),
                tenant_id=tenant.id,
                login_id=f"guest-{suffix}",
                name=display_name.strip() or "게스트",
                email=None,
                organization_name=tenant.name,
                password_hash=None,
                role=UserRole.GUEST,
                is_guest=True,
                guest_mode=GuestMode.LOCAL,
                created_at=now,
                tenant_expires_at=expires_at,
            )
            self._tenants[tenant.id] = tenant
            self._users[user.id] = user
            return self._create_session_locked(
                user,
                expires_at=expires_at,
            )

    def signup(self, request: SignupRequest) -> tuple[str, AuthSessionView]:
        with self._lock:
            normalized_login = self._normalize_login(request.login_id)
            if normalized_login in self._users_by_login:
                raise ConflictError("이미 사용 중인 아이디입니다.")

            now = utcnow()
            tenant = TenantRecord(
                id=new_id("tenant"),
                name=request.organization_name,
                created_at=now,
                expires_at=None,
            )
            user = UserRecord(
                id=new_id("user"),
                tenant_id=tenant.id,
                login_id=normalized_login,
                name=request.name,
                email=request.email,
                organization_name=tenant.name,
                password_hash=hash_password(request.password),
                role=UserRole.OWNER,
                is_guest=False,
                guest_mode=None,
                created_at=now,
                tenant_expires_at=None,
            )
            self._tenants[tenant.id] = tenant
            self._users[user.id] = user
            self._users_by_login[normalized_login] = user.id
            return self._create_session_locked(user)

    def login(self, request: LoginRequest) -> tuple[str, AuthSessionView]:
        with self._lock:
            user_id = self._users_by_login.get(self._normalize_login(request.login_id))
            user = self._users.get(user_id or "")
            if user is None or user.is_guest or not verify_password(
                request.password, user.password_hash
            ):
                raise AuthenticationError("아이디 또는 비밀번호가 올바르지 않습니다.")
            return self._create_session_locked(user)

    def _create_session_locked(
        self,
        user: UserRecord,
        *,
        expires_at: datetime | None = None,
    ) -> tuple[str, AuthSessionView]:
        now = utcnow()
        expires_at = expires_at or now + timedelta(
            seconds=self.settings.session_ttl_seconds
        )
        raw_token = new_session_token()
        token_hash = session_token_hash(raw_token, self.settings.session_secret)
        self._sessions[token_hash] = SessionRecord(
            token_hash=token_hash,
            user_id=user.id,
            created_at=now,
            expires_at=expires_at,
        )
        return raw_token, AuthSessionView(user=self._user_view(user), expires_at=expires_at)

    def authenticate(self, raw_token: str | None) -> UserRecord:
        if not raw_token:
            raise AuthenticationError("로그인 세션이 필요합니다.")
        token_hash = session_token_hash(raw_token, self.settings.session_secret)
        with self._lock:
            session = self._sessions.get(token_hash)
            if session is None:
                raise AuthenticationError("로그인 세션이 유효하지 않습니다.")
            if session.expires_at <= utcnow():
                self._sessions.pop(token_hash, None)
                raise AuthenticationError("로그인 세션이 만료되었습니다.")
            user = self._users.get(session.user_id)
            if user is None:
                self._sessions.pop(token_hash, None)
                raise AuthenticationError("로그인 사용자를 찾을 수 없습니다.")
            return user

    def auth_session(self, raw_token: str | None) -> AuthSessionView:
        user = self.authenticate(raw_token)
        token_hash = session_token_hash(str(raw_token), self.settings.session_secret)
        with self._lock:
            session = self._sessions[token_hash]
            return AuthSessionView(user=self._user_view(user), expires_at=session.expires_at)

    def logout(self, raw_token: str | None) -> None:
        if not raw_token:
            return
        token_hash = session_token_hash(raw_token, self.settings.session_secret)
        with self._lock:
            self._sessions.pop(token_hash, None)

    def create_survey(self, user: UserRecord, request: SurveyCreateRequest) -> SurveyDetail:
        with self._lock:
            if user.guest_mode == GuestMode.LOCAL:
                owned_count = sum(
                    survey.tenant_id == user.tenant_id and survey.owner_id == user.id
                    for survey in self._surveys.values()
                )
                if owned_count >= self.settings.local_guest_max_projects:
                    raise DomainValidationError(
                        "Local guest project limit has been reached."
                    )
            template = None
            template_code = request.template_code or request.template_id
            if template_code:
                template = self._templates.get(template_code)
                if template is None:
                    raise NotFoundError("설문 템플릿을 찾을 수 없습니다.")

            title = request.title or (f"{template.title} 복사본" if template else None)
            if not title:
                raise DomainValidationError("설문 제목을 입력해 주세요.")
            sections = (
                [section.model_copy(deep=True) for section in request.sections]
                if request.sections is not None
                else [
                    SurveySection(
                        title="설문 문항",
                        questions=[question.model_copy(deep=True) for question in request.questions],
                    )
                ]
                if request.questions is not None
                else [section.model_copy(deep=True) for section in template.sections]
                if template
                else [SurveySection(title="설문 문항", questions=[])]
            )
            self._validate_global_question_ids(sections)
            if user.guest_mode == GuestMode.LOCAL and sum(
                len(section.questions) for section in sections
            ) > self.settings.local_guest_max_questions:
                raise DomainValidationError(
                    "Local guest question limit has been exceeded."
                )

            now = utcnow()
            survey = SurveyRecord(
                id=new_id("survey"),
                tenant_id=user.tenant_id,
                owner_id=user.id,
                title=title,
                description=(
                    request.description
                    if request.description is not None
                    else template.description
                    if template
                    else None
                ),
                category=request.category or (template.category if template else "일반조사"),
                template_code=template.code if template else None,
                sections=sections,
                settings=(
                    request.settings.model_copy(deep=True)
                    if request.settings is not None
                    else template.settings.model_copy(deep=True)
                    if template
                    else SurveySettings()
                ),
                theme=(
                    request.theme.model_copy(deep=True)
                    if request.theme is not None
                    else template.theme.model_copy(deep=True)
                    if template
                    else SurveyTheme()
                ),
                skin=(
                    dict(request.skin)
                    if request.skin is not None
                    else _skin_from_theme(template.theme)
                    if template
                    else _skin_from_theme(SurveyTheme())
                ),
                logic_rules=[dict(rule) for rule in request.logic_rules],
                default_locale=(
                    request.languages.default_locale
                    if "languages" in request.model_fields_set
                    else request.default_locale
                    if "default_locale" in request.model_fields_set
                    else template.default_locale
                    if template
                    else "ko"
                ),
                supported_locales=(
                    list(request.languages.enabled)
                    if "languages" in request.model_fields_set
                    else list(request.supported_locales)
                    if "supported_locales" in request.model_fields_set
                    else list(template.supported_locales)
                    if template
                    else ["ko"]
                ),
                translations=(
                    {
                        key: value.model_copy(deep=True)
                        for key, value in request.translations.items()
                    }
                    if "translations" in request.model_fields_set
                    else {
                        key: value.model_copy(deep=True)
                        for key, value in template.translations.items()
                    }
                    if template
                    else {}
                ),
                languages=(
                    request.languages.model_copy(deep=True)
                    if "languages" in request.model_fields_set
                    else template.languages.model_copy(deep=True)
                    if template
                    else SurveyLanguages()
                ),
                status=SurveyStatus.DRAFT,
                revision=1,
                slug=None,
                versions=[],
                created_at=now,
                updated_at=now,
                published_at=None,
            )
            self._surveys[survey.id] = survey
            self._responses[survey.id] = []
            return self._detail_locked(survey)

    def list_surveys(
        self,
        user: UserRecord,
        status: SurveyStatus | None = None,
    ) -> list[SurveySummary]:
        with self._lock:
            surveys = [
                survey
                for survey in self._surveys.values()
                if survey.tenant_id == user.tenant_id
                and survey.owner_id == user.id
                and (status is None or survey.status == status)
            ]
            surveys.sort(key=lambda item: item.updated_at, reverse=True)
            return [self._summary_locked(survey) for survey in surveys]

    def get_survey(self, user: UserRecord, survey_id: str) -> SurveyDetail:
        with self._lock:
            return self._detail_locked(self._owned_survey_locked(user, survey_id))

    @staticmethod
    def _translation_matches_content(
        translation: SurveyTranslation,
        *,
        title: str,
        description: str | None,
        sections: list[SurveySection],
        confirmation_message: str,
    ) -> bool:
        if translation.title != title:
            return False
        if description and translation.description != description:
            return False
        if translation.confirmation_message != confirmation_message:
            return False
        for section in sections:
            section_translation = translation.sections.get(section.id)
            section_title = (
                section_translation.title
                if section_translation is not None
                else translation.section_titles.get(section.id)
            )
            if section_title != section.title:
                return False
            if section.description:
                section_description = (
                    section_translation.description
                    if section_translation is not None
                    else translation.section_descriptions.get(section.id)
                )
                if section_description != section.description:
                    return False
            for question in section.questions:
                question_translation = (
                    section_translation.questions.get(question.id)
                    if section_translation is not None
                    else None
                )
                question_title = (
                    question_translation.title
                    if question_translation is not None
                    else translation.question_titles.get(question.id)
                )
                if question_title != question.title:
                    return False
                if question.description:
                    question_description = (
                        question_translation.description
                        if question_translation is not None
                        else translation.question_descriptions.get(question.id)
                    )
                    if question_description != question.description:
                        return False
                option_labels = (
                    question_translation.options
                    if question_translation is not None
                    else translation.option_labels.get(question.id, {})
                )
                if any(option_labels.get(option.id) != option.label for option in question.options):
                    return False
                if question_translation is None and (
                    question.settings.rows
                    or question.settings.columns
                    or question.min_label
                    or question.max_label
                    or question.unit
                ):
                    return False
                if question_translation is not None:
                    for field_name in ("rows", "columns"):
                        axis = getattr(question.settings, field_name)
                        translated_axis = getattr(question_translation, field_name)
                        for index, item in enumerate(axis):
                            translated = translated_axis.get(
                                item.id,
                                translated_axis.get(str(index)),
                            )
                            if translated != item.label:
                                return False
                    for field_name in ("min_label", "max_label", "unit"):
                        base_value = getattr(question, field_name)
                        if base_value and getattr(question_translation, field_name) != base_value:
                            return False
        return True

    @classmethod
    def _validate_source_locale_promotion(
        cls,
        current: SurveyRecord | SurveyDetail,
        request: SurveyUpdateRequest,
    ) -> None:
        if request.languages is None:
            return
        previous = current.languages.source_locale
        promoted = request.languages.source_locale
        if promoted == previous:
            return
        fields = request.model_fields_set
        if (
            request.source_locale_promotion_from != previous
            or not {"title", "description", "sections", "settings", "translations"}
            <= fields
            or request.title is None
            or request.sections is None
            or request.settings is None
            or request.translations is None
            or promoted in request.translations
        ):
            raise DomainValidationError(
                "sourceLocale promotion requires a complete editor payload and "
                "sourceLocalePromotionFrom matching the current source locale."
            )
        previous_snapshot = request.translations.get(previous)
        promoted_overlay = current.translations.get(promoted)
        if (
            previous_snapshot is None
            or promoted_overlay is None
            or not cls._translation_matches_content(
                previous_snapshot,
                title=current.title,
                description=current.description,
                sections=current.sections,
                confirmation_message=current.settings.confirmation_message,
            )
            or not cls._translation_matches_content(
                promoted_overlay,
                title=request.title,
                description=request.description,
                sections=request.sections,
                confirmation_message=request.settings.confirmation_message,
            )
        ):
            raise DomainValidationError(
                "sourceLocale promotion requires complete previous-source and "
                "target-language snapshots keyed by stable IDs."
            )

    def update_survey(
        self,
        user: UserRecord,
        survey_id: str,
        request: SurveyUpdateRequest,
    ) -> SurveyDetail:
        with self._lock:
            survey = self._owned_survey_locked(user, survey_id)
            self._validate_source_locale_promotion(survey, request)
            updates = request.model_fields_set
            if "title" in updates and request.title is not None:
                survey.title = request.title
            if "description" in updates:
                survey.description = request.description
            if "category" in updates and request.category is not None:
                survey.category = request.category
            if "questions" in updates and request.questions is not None:
                replacement_sections = [
                    SurveySection(
                        title="설문 문항",
                        questions=[
                            question.model_copy(deep=True) for question in request.questions
                        ],
                    )
                ]
                self._validate_global_question_ids(replacement_sections)
                survey.sections = replacement_sections
            elif "sections" in updates and request.sections is not None:
                self._validate_global_question_ids(request.sections)
                survey.sections = [section.model_copy(deep=True) for section in request.sections]
            if "settings" in updates and request.settings is not None:
                survey.settings = request.settings.model_copy(deep=True)
            if "theme" in updates and request.theme is not None:
                survey.theme = request.theme.model_copy(deep=True)
                if "skin" not in updates:
                    survey.skin = _skin_from_theme(survey.theme)
            if "skin" in updates and request.skin is not None:
                survey.skin = dict(request.skin)
            if "logic_rules" in updates and request.logic_rules is not None:
                survey.logic_rules = [dict(rule) for rule in request.logic_rules]
            if "default_locale" in updates and request.default_locale is not None:
                survey.default_locale = request.default_locale
            if "supported_locales" in updates and request.supported_locales is not None:
                survey.supported_locales = list(request.supported_locales)
            if "translations" in updates and request.translations is not None:
                survey.translations = {
                    key: value.model_copy(deep=True)
                    for key, value in request.translations.items()
                }
            if "languages" in updates and request.languages is not None:
                survey.languages = request.languages.model_copy(deep=True)
                survey.default_locale = request.languages.default_locale
                survey.supported_locales = list(request.languages.enabled)
            elif {"default_locale", "supported_locales"} & updates:
                survey.languages = SurveyLanguages(
                    source_locale=(
                        survey.languages.source_locale
                        if survey.languages.source_locale in survey.supported_locales
                        else survey.default_locale
                    ),
                    default_locale=survey.default_locale,
                    enabled=list(survey.supported_locales),
                )
            if survey.default_locale not in survey.supported_locales:
                raise DomainValidationError(
                    "defaultLocale must be included in supportedLocales."
                )
            if set(survey.translations) - set(survey.supported_locales):
                raise DomainValidationError(
                    "translations contain a locale not listed in supportedLocales."
                )
            if user.guest_mode == GuestMode.LOCAL and sum(
                len(section.questions) for section in survey.sections
            ) > self.settings.local_guest_max_questions:
                raise DomainValidationError(
                    "Local guest question limit has been exceeded."
                )
            survey.revision += 1
            survey.updated_at = utcnow()
            return self._detail_locked(survey)

    def publish(
        self,
        user: UserRecord,
        survey_id: str,
        request: PublishRequest,
    ) -> PublishResult:
        with self._lock:
            survey = self._owned_survey_locked(user, survey_id)
            return self._publish_locked(survey, request)

    def _publish_locked(
        self,
        survey: SurveyRecord,
        request: PublishRequest,
    ) -> PublishResult:
        answerable_questions = [
            question
            for section in survey.sections
            for question in section.questions
            if question.type != QuestionType.TEXT
        ]
        if not answerable_questions:
            raise DomainValidationError("배포하려면 응답 가능한 문항이 하나 이상 필요합니다.")

        local_prefix = "local-guest-"
        owner = self._users.get(survey.owner_id)
        is_local_guest = owner is not None and owner.guest_mode == GuestMode.LOCAL
        requested_slug = request.slug
        if is_local_guest and requested_slug and not requested_slug.startswith(local_prefix):
            requested_slug = f"{local_prefix}{requested_slug}"
        if not is_local_guest and requested_slug and requested_slug.startswith(local_prefix):
            raise DomainValidationError(
                "The local-guest- URL namespace is reserved for local guest surveys."
            )

        if survey.slug:
            if is_local_guest and not survey.slug.startswith(local_prefix):
                # Local data is process-scoped, so an in-process legacy route can
                # be migrated safely without a durable redirect dependency.
                self._slug_routes.pop(survey.slug, None)
                survey.slug = self._unique_slug_locked(
                    f"{local_prefix}{survey.slug}", survey.id
                )
            if requested_slug and requested_slug != survey.slug:
                raise ConflictError("배포된 설문의 URL 식별자는 변경할 수 없습니다.")
            slug = survey.slug
        else:
            slug_base = requested_slug or survey.title
            if is_local_guest and not slug_base.startswith(local_prefix):
                slug_base = f"{local_prefix}{slug_base}"
            slug = self._unique_slug_locked(slug_base, survey.id)
        if is_local_guest and not slug.startswith(local_prefix):
            slug = self._unique_slug_locked(f"{local_prefix}{slug}", survey.id)
        elif not is_local_guest and slug.startswith(local_prefix):
            slug = self._unique_slug_locked(
                f"persistent-{survey.id.split('_')[-1][:12]}", survey.id
            )

        now = utcnow()
        version = len(survey.versions) + 1
        public_survey = PublicSurvey(
            survey_id=survey.id,
            slug=slug,
            version=version,
            title=survey.title,
            description=survey.description,
            category=survey.category,
            sections=[section.model_copy(deep=True) for section in survey.sections],
            settings=survey.settings.model_copy(deep=True),
            theme=survey.theme.model_copy(deep=True),
            skin=dict(survey.skin),
            logic_rules=[dict(rule) for rule in survey.logic_rules],
            default_locale=survey.default_locale,
            supported_locales=list(survey.supported_locales),
            translations={
                key: value.model_copy(deep=True)
                for key, value in survey.translations.items()
            },
            languages=survey.languages.model_copy(deep=True),
            published_at=now,
            guest_demo=is_local_guest,
            experience_expires_at=(
                self._tenants[survey.tenant_id].expires_at
                if is_local_guest
                else None
            ),
        )
        snapshot_json = public_survey.model_dump_json(by_alias=True)
        content_hash = hashlib.sha256(snapshot_json.encode("utf-8")).hexdigest()
        published_version = PublishedVersionRecord(
            version=version,
            snapshot_json=snapshot_json,
            content_hash=content_hash,
            published_at=now,
        )
        survey.versions.append(published_version)
        survey.slug = slug
        survey.status = SurveyStatus.PUBLISHED
        survey.published_at = now
        survey.updated_at = now
        self._slug_routes[slug] = (survey.id, version)
        return PublishResult(
            survey_id=survey.id,
            slug=slug,
            version=version,
            public_url=f"/s/{slug}",
            content_hash=content_hash,
            published_at=now,
        )

    def public_survey(self, slug: str, language: str | None = None) -> PublicSurvey:
        with self._lock:
            survey, version = self._public_version_locked(slug)
            public = PublicSurvey.model_validate_json(version.snapshot_json)
            return apply_public_translation(public, language)

    def submit_response(
        self,
        slug: str,
        request: SubmitResponseRequest,
        *,
        idempotency_key: str | None = None,
    ) -> ResponseReceipt:
        with self._lock:
            survey, version = self._public_version_locked(slug)
            public_survey = PublicSurvey.model_validate_json(version.snapshot_json)
            if (
                public_survey.settings.one_response_per_respondent
                and not request.respondent_key
            ):
                raise DomainValidationError(
                    "This survey requires a stable respondentKey to enforce one response."
                )

            normalized_answers = self._validate_answers(public_survey, request.answers)
            try:
                validated_key = validate_idempotency_key(idempotency_key)
            except ValueError as exc:
                raise DomainValidationError(str(exc)) from exc
            idempotency_hash = (
                session_token_hash(validated_key, self.settings.session_secret)
                if validated_key
                else None
            )
            payload_hash = submission_payload_hash(
                public_survey, normalized_answers, request
            )
            receipt_key = (
                survey.tenant_id,
                survey.id,
                idempotency_hash or "",
            )
            if idempotency_hash:
                existing = self._idempotency_receipts.get(receipt_key)
                if existing is not None:
                    existing_payload_hash, receipt = existing
                    if existing_payload_hash != payload_hash:
                        raise ConflictError(
                            "Idempotency-Key was already used with a different payload."
                        )
                    return receipt.model_copy(deep=True)

            now = utcnow()
            if public_survey.settings.starts_at and now < public_survey.settings.starts_at:
                raise ConflictError("아직 응답 기간이 시작되지 않았습니다.")
            if public_survey.settings.closes_at and now > public_survey.settings.closes_at:
                raise ConflictError("설문 응답 기간이 종료되었습니다.")
            if len(self._responses.get(survey.id, [])) >= self.settings.local_guest_max_responses and any(
                user.tenant_id == survey.tenant_id
                and user.guest_mode == GuestMode.LOCAL
                for user in self._users.values()
            ):
                raise ConflictError(
                    "Local guest response limit has been reached."
                )
            if public_survey.settings.one_response_per_respondent and request.respondent_key:
                if any(
                    response.respondent_key == request.respondent_key
                    for response in self._responses.get(survey.id, [])
                ):
                    raise ConflictError("이미 이 설문에 응답했습니다.")

            response = ResponseRecord(
                id=new_id("response"),
                survey_id=survey.id,
                tenant_id=survey.tenant_id,
                survey_version=version.version,
                answers_json=json.dumps(
                    [answer.model_dump(by_alias=True, mode="json") for answer in normalized_answers],
                    ensure_ascii=False,
                    separators=(",", ":"),
                ),
                respondent_key=request.respondent_key,
                idempotency_key_hash=idempotency_hash,
                request_payload_hash=payload_hash if idempotency_hash else None,
                metadata_json=json.dumps(request.metadata, ensure_ascii=False, separators=(",", ":")),
                submitted_at=now,
            )
            self._responses.setdefault(survey.id, []).append(response)
            receipt = ResponseReceipt(
                response_id=response.id,
                survey_id=survey.id,
                survey_version=version.version,
                submitted_at=now,
                message=public_survey.settings.confirmation_message,
            )
            if idempotency_hash:
                self._idempotency_receipts[receipt_key] = (payload_hash, receipt)
            return receipt

    def responses(
        self,
        user: UserRecord,
        survey_id: str,
        *,
        offset: int = 0,
        limit: int = 100,
    ) -> list[SurveyResponseView]:
        with self._lock:
            survey = self._owned_survey_locked(user, survey_id)
            records = self._responses.get(survey.id, [])[offset : offset + limit]
            return [self._response_view(record) for record in records]

    def report(
        self,
        user: UserRecord,
        survey_id: str,
        *,
        cutoff_date: date | None = None,
        response_status: str = "all",
    ) -> SurveyReport:
        with self._lock:
            survey = self._owned_survey_locked(user, survey_id)
            normalized_status = response_status.strip().lower()
            if normalized_status not in {"all", "complete", "partial"}:
                raise DomainValidationError(
                    "응답 상태는 all, complete, partial 중 하나여야 합니다."
                )
            latest_version = survey.versions[-1] if survey.versions else None
            latest_public = (
                PublicSurvey.model_validate_json(latest_version.snapshot_json)
                if latest_version
                else None
            )
            records = [
                record
                for record in self._responses.get(survey.id, [])
                if latest_version and record.survey_version == latest_version.version
            ]
            if cutoff_date is not None:
                cutoff_exclusive = datetime.combine(
                    cutoff_date + timedelta(days=1),
                    datetime.min.time(),
                    tzinfo=REPORT_TIMEZONE,
                ).astimezone(timezone.utc)
                records = [
                    record
                    for record in records
                    if record.submitted_at < cutoff_exclusive
                ]
            # The current response store persists completed submissions only.
            # Keep the filter contract explicit so a future partial-response
            # repository can extend this without changing the API shape.
            if normalized_status == "partial":
                records = []
            sections = latest_public.sections if latest_public else survey.sections
            answers_by_question: dict[str, list[Any]] = {}
            for record in records:
                for answer in self._response_view(record).answers:
                    answers_by_question.setdefault(answer.question_id, []).append(answer.value)

            question_reports: list[QuestionReport] = []
            for question in (question for section in sections for question in section.questions):
                if question.type == QuestionType.TEXT:
                    continue
                values = answers_by_question.get(question.id, [])
                question_reports.append(self._question_report(question, values))

            return SurveyReport(
                survey_id=survey.id,
                title=latest_public.title if latest_public else survey.title,
                total_responses=len(records),
                completed_responses=len(records),
                partial_responses=0,
                completion_rate=1.0 if records else 0.0,
                published_version=latest_version.version if latest_version else None,
                generated_at=utcnow(),
                questions=question_reports,
            )

    def dashboard(self, user: UserRecord) -> DashboardView:
        with self._lock:
            surveys = [
                survey
                for survey in self._surveys.values()
                if survey.tenant_id == user.tenant_id and survey.owner_id == user.id
            ]
            surveys.sort(key=lambda item: item.updated_at, reverse=True)
            return DashboardView(
                total_surveys=len(surveys),
                draft_surveys=sum(survey.status == SurveyStatus.DRAFT for survey in surveys),
                published_surveys=sum(
                    survey.status == SurveyStatus.PUBLISHED for survey in surveys
                ),
                closed_surveys=sum(survey.status == SurveyStatus.CLOSED for survey in surveys),
                total_responses=sum(len(self._responses.get(survey.id, [])) for survey in surveys),
                recent_surveys=[self._summary_locked(survey) for survey in surveys[:5]],
            )

    def page_help(self, menu_id: str, language: str) -> dict[str, object]:
        raise NotFoundError("Bundled page help should be used in local mode.")

    def _owned_survey_locked(self, user: UserRecord, survey_id: str) -> SurveyRecord:
        survey = self._surveys.get(survey_id)
        # Deliberately return the same 404 for a missing or cross-tenant resource.
        if (
            survey is None
            or survey.tenant_id != user.tenant_id
            or survey.owner_id != user.id
        ):
            raise NotFoundError("설문 프로젝트를 찾을 수 없습니다.")
        return survey

    def _public_version_locked(
        self, slug: str
    ) -> tuple[SurveyRecord, PublishedVersionRecord]:
        route = self._slug_routes.get(slug.strip().lower())
        if route is None:
            raise NotFoundError("공개 설문을 찾을 수 없습니다.")
        survey_id, version_number = route
        survey = self._surveys[survey_id]
        tenant = self._tenants.get(survey.tenant_id)
        if tenant is None or (
            tenant.expires_at is not None and tenant.expires_at <= utcnow()
        ):
            raise NotFoundError("공개 설문을 찾을 수 없습니다.")
        try:
            version = next(
                item for item in survey.versions if item.version == version_number
            )
        except StopIteration as exc:  # pragma: no cover - protects internal invariants.
            raise NotFoundError("공개 설문 버전을 찾을 수 없습니다.") from exc
        return survey, version

    def _summary_locked(self, survey: SurveyRecord) -> SurveySummary:
        return SurveySummary(
            id=survey.id,
            title=survey.title,
            category=survey.category,
            status=survey.status,
            response_count=len(self._responses.get(survey.id, [])),
            question_count=sum(len(section.questions) for section in survey.sections),
            published_version=len(survey.versions) or None,
            slug=survey.slug,
            public_url=f"/s/{survey.slug}" if survey.slug else None,
            created_at=survey.created_at,
            updated_at=survey.updated_at,
            published_at=survey.published_at,
        )

    def _detail_locked(self, survey: SurveyRecord) -> SurveyDetail:
        summary = self._summary_locked(survey)
        return SurveyDetail(
            **summary.model_dump(),
            description=survey.description,
            template_code=survey.template_code,
            revision=survey.revision,
            sections=[section.model_copy(deep=True) for section in survey.sections],
            settings=survey.settings.model_copy(deep=True),
            theme=survey.theme.model_copy(deep=True),
            skin=dict(survey.skin),
            logic_rules=[dict(rule) for rule in survey.logic_rules],
            default_locale=survey.default_locale,
            supported_locales=list(survey.supported_locales),
            translations={
                key: value.model_copy(deep=True)
                for key, value in survey.translations.items()
            },
            languages=survey.languages.model_copy(deep=True),
        )

    @staticmethod
    def _validate_global_question_ids(sections: Iterable[SurveySection]) -> None:
        identifiers = [
            question.id for section in sections for question in section.questions
        ]
        if len(identifiers) != len(set(identifiers)):
            raise DomainValidationError("설문 전체에서 문항 ID는 중복될 수 없습니다.")

    def _unique_slug_locked(self, value: str, survey_id: str) -> str:
        normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
        base = re.sub(r"[^a-z0-9]+", "-", normalized.lower()).strip("-")
        if len(base) < 3:
            base = f"survey-{survey_id.split('_')[-1][:8]}"
        base = base[:70].rstrip("-")
        candidate = base
        sequence = 2
        while candidate in self._slug_routes and self._slug_routes[candidate][0] != survey_id:
            suffix = f"-{sequence}"
            candidate = f"{base[: 80 - len(suffix)]}{suffix}"
            sequence += 1
        return candidate

    @staticmethod
    def _is_empty(value: Any) -> bool:
        if value is None:
            return True
        if isinstance(value, str):
            return not value.strip()
        if isinstance(value, (list, tuple, set)):
            return not value or all(MemoryStore._is_empty(item) for item in value)
        if isinstance(value, dict):
            return not value or all(
                MemoryStore._is_empty(item) for item in value.values()
            )
        return False

    @staticmethod
    def _logic_rule_matches(rule: dict[str, Any], value: Any) -> bool:
        if MemoryStore._is_empty(value):
            return False
        expected_value = rule.get("value")
        if expected_value is None:
            expected_value = rule.get("optionId")
        if expected_value is None:
            expected_value = rule.get("equals")
        expected = str(expected_value if expected_value is not None else "")
        if not expected:
            return False
        values = [str(item) for item in value] if isinstance(value, list) else [str(value)]
        operator = str(rule.get("operator") or "equals")
        if operator in {"notEquals", "not_equals"}:
            return expected not in values
        if operator == "contains":
            return any(expected in item for item in values)
        return expected in values

    @classmethod
    def _reachable_section_ids(
        cls,
        survey: PublicSurvey,
        answer_map: dict[str, AnswerItem],
    ) -> set[str]:
        if not survey.logic_rules:
            return {section.id for section in survey.sections}
        section_index_by_question = {
            question.id: section_index
            for section_index, section in enumerate(survey.sections)
            for question in section.questions
        }
        visible: set[str] = set()
        visited: set[int] = set()
        section_index = 0
        while (
            0 <= section_index < len(survey.sections)
            and section_index not in visited
        ):
            visited.add(section_index)
            section = survey.sections[section_index]
            visible.add(section.id)
            matching_rule: dict[str, Any] | None = None
            for rule in survey.logic_rules:
                source_id = str(
                    rule.get("sourceQuestionId") or rule.get("questionId") or ""
                )
                answer = answer_map.get(source_id)
                if (
                    section_index_by_question.get(source_id) == section_index
                    and answer is not None
                    and cls._logic_rule_matches(rule, answer.value)
                ):
                    matching_rule = rule
                    break
            if matching_rule is None:
                section_index += 1
                continue
            destination = str(
                matching_rule.get("targetSectionId")
                or matching_rule.get("destinationSectionId")
                or matching_rule.get("gotoSectionId")
                or matching_rule.get("destination")
                or "next"
            )
            if destination in {"complete", "submit", "end"}:
                break
            if destination == "next":
                section_index += 1
                continue
            target_index = next(
                (
                    index
                    for index, item in enumerate(survey.sections)
                    if item.id == destination
                ),
                -1,
            )
            section_index = target_index if target_index >= 0 else section_index + 1
        return visible

    def _validate_answers(
        self,
        survey: PublicSurvey,
        answers: list[AnswerItem],
    ) -> list[AnswerItem]:
        questions = {
            question.id: question
            for section in survey.sections
            for question in section.questions
            if question.type != QuestionType.TEXT
        }
        answer_map = {answer.question_id: answer for answer in answers}
        unknown = sorted(set(answer_map) - set(questions))
        if unknown:
            raise DomainValidationError(
                f"존재하지 않는 문항에 대한 응답입니다: {', '.join(unknown)}"
            )

        reachable_sections = self._reachable_section_ids(survey, answer_map)
        hidden_questions = {
            question.id
            for section in survey.sections
            if section.id not in reachable_sections
            for question in section.questions
        }
        tampered = sorted(
            question_id
            for question_id in hidden_questions
            if question_id in answer_map
            and not self._is_empty(answer_map[question_id].value)
        )
        if tampered:
            raise DomainValidationError(
                "분기 조건으로 숨겨진 문항에는 응답할 수 없습니다: "
                + ", ".join(tampered)
            )

        normalized: list[AnswerItem] = []
        for section in survey.sections:
            if section.id not in reachable_sections:
                continue
            for question in section.questions:
                if question.type == QuestionType.TEXT:
                    continue
                answer = answer_map.get(question.id)
                value = answer.value if answer else None
                if question.required and self._is_empty(value):
                    raise DomainValidationError(
                        f"필수 문항에 응답해 주세요: {question.title}"
                    )
                if self._is_empty(value):
                    continue
                value = self._normalize_answer_value(question, value)
                self._validate_answer_value(question, value)
                normalized.append(AnswerItem(question_id=question.id, value=value))
        return normalized

    @staticmethod
    def _normalize_answer_value(question: Question, value: Any) -> Any:
        if question.type in {QuestionType.NUMBER, QuestionType.SCALE, QuestionType.SLIDER}:
            if isinstance(value, str):
                try:
                    numeric = float(value)
                except ValueError:
                    return value
                return int(numeric) if numeric.is_integer() else numeric
        if question.type == QuestionType.MATRIX and isinstance(value, dict):
            row_ids = [item.id for item in question.settings.rows]
            column_ids = [item.id for item in question.settings.columns]

            def map_identifier(raw: Any, identifiers: list[str]) -> str:
                text = str(raw)
                if text in identifiers:
                    return text
                try:
                    return identifiers[int(text)]
                except (ValueError, IndexError):
                    return text

            normalized_matrix: dict[str, Any] = {}
            for raw_row, raw_column in value.items():
                row_id = map_identifier(raw_row, row_ids)
                if isinstance(raw_column, list):
                    normalized_matrix[row_id] = [
                        map_identifier(item, column_ids) for item in raw_column
                    ]
                else:
                    normalized_matrix[row_id] = map_identifier(raw_column, column_ids)
            return normalized_matrix
        return value

    def _validate_answer_value(self, question: Question, value: Any) -> None:
        option_ids = {option.id for option in question.options}
        if question.type in {QuestionType.SINGLE_CHOICE, QuestionType.DROPDOWN}:
            if not isinstance(value, str) or value not in option_ids:
                raise DomainValidationError(f"선택값이 올바르지 않습니다: {question.title}")
            return
        if question.type == QuestionType.MULTIPLE_CHOICE:
            if (
                not isinstance(value, list)
                or any(not isinstance(item, str) or item not in option_ids for item in value)
                or len(value) != len(set(value))
            ):
                raise DomainValidationError(f"복수 선택값이 올바르지 않습니다: {question.title}")
            maximum = question.settings.max_selections
            if maximum is not None and len(value) > maximum:
                raise DomainValidationError(
                    f"최대 {maximum}개까지 선택할 수 있습니다: {question.title}"
                )
            return
        if question.type in {QuestionType.SHORT_TEXT, QuestionType.LONG_TEXT}:
            if not isinstance(value, str) or len(value) > 10_000:
                raise DomainValidationError(f"텍스트 응답이 올바르지 않습니다: {question.title}")
            return
        if question.type in {QuestionType.NUMBER, QuestionType.SCALE, QuestionType.SLIDER}:
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise DomainValidationError(f"숫자 응답이 필요합니다: {question.title}")
            try:
                finite = math.isfinite(value)
            except OverflowError:
                finite = False
            if not finite:
                raise DomainValidationError(f"유한한 숫자 응답이 필요합니다: {question.title}")
            if question.type == QuestionType.SCALE and not float(value).is_integer():
                raise DomainValidationError(
                    f"Scale responses must be whole numbers: {question.title}"
                )
            if question.settings.min_value is not None and value < question.settings.min_value:
                raise DomainValidationError(f"허용 범위보다 작은 값입니다: {question.title}")
            if question.settings.max_value is not None and value > question.settings.max_value:
                raise DomainValidationError(f"허용 범위보다 큰 값입니다: {question.title}")
            return
        if question.type == QuestionType.MATRIX:
            rows = {item.id for item in question.settings.rows}
            columns = {item.id for item in question.settings.columns}
            selection_mode = str(
                (question.settings.model_extra or {}).get("selectionMode", "single")
            )
            valid = isinstance(value, dict)
            if valid:
                for row, column in value.items():
                    if row not in rows:
                        valid = False
                        break
                    selected = column if isinstance(column, list) else [column]
                    if (
                        any(item not in columns for item in selected)
                        or (selection_mode != "multiple" and len(selected) > 1)
                    ):
                        valid = False
                        break
            if not valid:
                raise DomainValidationError(f"매트릭스 응답이 올바르지 않습니다: {question.title}")
            return
        if question.type == QuestionType.DATE:
            if not isinstance(value, str):
                raise DomainValidationError(f"날짜 응답이 필요합니다: {question.title}")
            try:
                date.fromisoformat(value)
            except ValueError as exc:
                raise DomainValidationError(
                    f"날짜는 YYYY-MM-DD 형식이어야 합니다: {question.title}"
                ) from exc
            return
        if question.type in {QuestionType.TABLE, QuestionType.REPEAT_TABLE}:
            columns = question.settings.columns
            valid = isinstance(value, list) and 0 < len(value) <= 200
            if valid and question.type == QuestionType.TABLE:
                valid = len(value) == len(question.settings.rows)
            if valid:
                for row in value:
                    if not isinstance(row, list) or len(row) != len(columns):
                        valid = False
                        break
                    for cell in row:
                        if isinstance(cell, (dict, list)) or cell is None:
                            valid = False
                            break
                        if isinstance(cell, str) and len(cell) > 10_000:
                            valid = False
                            break
                    if not valid:
                        break
            if not valid:
                raise DomainValidationError(f"표 응답이 올바르지 않습니다: {question.title}")

    @staticmethod
    def _response_view(record: ResponseRecord) -> SurveyResponseView:
        answers = [AnswerItem.model_validate(item) for item in json.loads(record.answers_json)]
        metadata = json.loads(record.metadata_json)
        return SurveyResponseView(
            id=record.id,
            survey_id=record.survey_id,
            survey_version=record.survey_version,
            answers=answers,
            respondent_key=record.respondent_key,
            metadata=metadata,
            submitted_at=record.submitted_at,
        )

    @staticmethod
    def _question_report(question: Question, values: list[Any]) -> QuestionReport:
        option_counts: Counter[str] = Counter()
        numeric_values: list[float] = []
        text_samples: list[str] = []
        if question.type in {QuestionType.SINGLE_CHOICE, QuestionType.DROPDOWN}:
            option_counts.update(str(value) for value in values)
        elif question.type == QuestionType.MULTIPLE_CHOICE:
            for value in values:
                if isinstance(value, list):
                    option_counts.update(str(item) for item in value)
        elif question.type in {
            QuestionType.NUMBER,
            QuestionType.SCALE,
            QuestionType.SLIDER,
        }:
            numeric_values = [
                float(value)
                for value in values
                if isinstance(value, (int, float)) and not isinstance(value, bool)
            ]
        elif question.type in {QuestionType.SHORT_TEXT, QuestionType.LONG_TEXT}:
            text_samples = [str(value)[:500] for value in values if isinstance(value, str)][-20:]

        labels = {option.id: option.label for option in question.options}
        labeled_counts = {
            labels.get(option_id, option_id): count
            for option_id, count in option_counts.items()
        }
        return QuestionReport(
            question_id=question.id,
            title=question.title,
            type=question.type,
            response_count=len(values),
            option_counts=labeled_counts,
            average=(sum(numeric_values) / len(numeric_values) if numeric_values else None),
            text_samples=text_samples,
        )


def _option(identifier: str, label: str) -> QuestionOption:
    return QuestionOption(id=identifier, label=label)


def _skin_from_theme(theme: SurveyTheme) -> dict[str, Any]:
    return {
        "preset": theme.code,
        "primary": theme.primary_color,
        "surface": theme.background_color,
        "card": theme.card_color,
        "font": theme.font_family,
        "headerImageUrl": theme.logo_url,
    }


def apply_public_translation(
    survey: PublicSurvey,
    language: str | None,
) -> PublicSurvey:
    """Return a localized copy without mutating the immutable stored snapshot."""

    try:
        requested = _normalize_locale(language or survey.default_locale)
    except ValueError:
        requested = survey.default_locale
    locale = requested if requested in survey.supported_locales else survey.default_locale
    localized = survey.model_copy(deep=True)
    localized.requested_locale = locale
    translation = localized.translations.get(locale)
    if translation is None:
        return localized

    if translation.title is not None:
        localized.title = translation.title
    if translation.description is not None:
        localized.description = translation.description
    if translation.confirmation_message is not None:
        localized.settings.confirmation_message = translation.confirmation_message
    for section in localized.sections:
        nested_section = translation.sections.get(section.id)
        section.title = (
            nested_section.title
            if nested_section is not None and nested_section.title is not None
            else translation.section_titles.get(section.id, section.title)
        )
        if nested_section is not None and nested_section.description is not None:
            section.description = nested_section.description
        elif section.id in translation.section_descriptions:
            section.description = translation.section_descriptions[section.id]
        for question in section.questions:
            nested_question = (
                nested_section.questions.get(question.id)
                if nested_section is not None
                else None
            )
            question.title = (
                nested_question.title
                if nested_question is not None and nested_question.title is not None
                else translation.question_titles.get(question.id, question.title)
            )
            if nested_question is not None and nested_question.description is not None:
                question.description = nested_question.description
            elif question.id in translation.question_descriptions:
                question.description = translation.question_descriptions[question.id]
            labels = dict(translation.option_labels.get(question.id, {}))
            if nested_question is not None:
                labels.update(nested_question.options)
            for option in question.options:
                option.label = labels.get(option.id, option.label)
            for index, option in enumerate(question.settings.rows):
                translated_label = (
                    nested_question.rows.get(
                        str(index),
                        nested_question.rows.get(
                            option.id,
                            labels.get(option.id, option.label),
                        ),
                    )
                    if nested_question is not None
                    else labels.get(option.id, option.label)
                )
                option.label = translated_label
                if index < len(question.rows):
                    question.rows[index] = translated_label
                else:
                    question.rows.append(translated_label)
            for index, option in enumerate(question.settings.columns):
                translated_label = (
                    nested_question.columns.get(
                        str(index),
                        nested_question.columns.get(
                            option.id,
                            labels.get(option.id, option.label),
                        ),
                    )
                    if nested_question is not None
                    else labels.get(option.id, option.label)
                )
                option.label = translated_label
                if index < len(question.columns):
                    question.columns[index] = translated_label
                else:
                    question.columns.append(translated_label)
            if nested_question is not None:
                if nested_question.min_label is not None:
                    question.settings.min_label = nested_question.min_label
                    question.min_label = nested_question.min_label
                if nested_question.max_label is not None:
                    question.settings.max_label = nested_question.max_label
                    question.max_label = nested_question.max_label
                if nested_question.unit is not None:
                    question.settings.unit = nested_question.unit
                    question.unit = nested_question.unit
    return localized


def _seed_templates() -> list[SurveyTemplate]:
    social = SurveyTemplate(
        code="social-research",
        title="사회조사 기본형",
        description="지역사회 생활, 정책 수요, 만족도를 모바일 친화적으로 조사하는 기본 템플릿입니다.",
        category="사회조사",
        tags=["사회", "시민", "만족도"],
        theme=SurveyTheme(code="public-blue", primary_color="#3156D3"),
        sections=[
            SurveySection(
                id="social-profile",
                title="응답자 기본정보",
                questions=[
                    Question(
                        id="social-residence",
                        type=QuestionType.SINGLE_CHOICE,
                        title="현재 거주 지역을 선택해 주세요.",
                        required=True,
                        options=[
                            _option("center", "도심권"),
                            _option("east", "동부권"),
                            _option("west", "서부권"),
                            _option("other", "기타"),
                        ],
                    ),
                    Question(
                        id="social-age",
                        type=QuestionType.DROPDOWN,
                        title="연령대를 선택해 주세요.",
                        options=[
                            _option("20s", "20대 이하"),
                            _option("30s", "30대"),
                            _option("40s", "40대"),
                            _option("50s", "50대"),
                            _option("60plus", "60대 이상"),
                        ],
                    ),
                ],
            ),
            SurveySection(
                id="social-satisfaction",
                title="생활 만족도",
                questions=[
                    Question(
                        id="social-score",
                        type=QuestionType.SCALE,
                        title="현재 지역 생활에 얼마나 만족하십니까?",
                        required=True,
                        settings=QuestionSettings(
                            min_value=1,
                            max_value=5,
                            step=1,
                            min_label="매우 불만족",
                            max_label="매우 만족",
                        ),
                    ),
                    Question(
                        id="social-comment",
                        type=QuestionType.LONG_TEXT,
                        title="개선이 필요한 점을 자유롭게 적어 주세요.",
                    ),
                ],
            ),
        ],
    )

    integrity = SurveyTemplate(
        code="integrity-survey",
        title="청렴도 조사 기본형",
        description="공공기관 업무 경험과 청렴 체감 수준을 익명으로 확인하는 템플릿입니다.",
        category="청렴도조사",
        tags=["청렴", "공공기관", "익명"],
        theme=SurveyTheme(
            code="integrity-green",
            primary_color="#138A63",
            background_color="#F1F8F5",
        ),
        settings=SurveySettings(
            confirmation_message="청렴도 조사에 참여해 주셔서 감사합니다."
        ),
        sections=[
            SurveySection(
                id="integrity-experience",
                title="업무 경험",
                questions=[
                    Question(
                        id="integrity-contact",
                        type=QuestionType.SINGLE_CHOICE,
                        title="최근 1년 이내 기관 업무를 경험하셨습니까?",
                        required=True,
                        options=[_option("yes", "예"), _option("no", "아니요")],
                    ),
                    Question(
                        id="integrity-fairness",
                        type=QuestionType.SCALE,
                        title="업무 처리가 공정했다고 생각하십니까?",
                        required=True,
                        settings=QuestionSettings(
                            min_value=1,
                            max_value=7,
                            step=1,
                            min_label="전혀 그렇지 않다",
                            max_label="매우 그렇다",
                        ),
                    ),
                    Question(
                        id="integrity-risks",
                        type=QuestionType.MULTIPLE_CHOICE,
                        title="개선이 필요하다고 느낀 영역을 선택해 주세요.",
                        options=[
                            _option("process", "업무 절차"),
                            _option("information", "정보 공개"),
                            _option("attitude", "응대 태도"),
                            _option("none", "해당 없음"),
                        ],
                    ),
                ],
            )
        ],
    )

    business = SurveyTemplate(
        code="business-survey",
        title="사업체조사 기본형",
        description="사업체 현황, 종사자 수, 경영 전망을 구조화해 수집하는 템플릿입니다.",
        category="사업체조사",
        tags=["사업체", "통계", "경영"],
        theme=SurveyTheme(
            code="business-indigo",
            primary_color="#4F46A5",
            background_color="#F5F4FB",
        ),
        sections=[
            SurveySection(
                id="business-overview",
                title="사업체 기본정보",
                questions=[
                    Question(
                        id="business-name",
                        type=QuestionType.SHORT_TEXT,
                        title="사업체명을 입력해 주세요.",
                        required=True,
                    ),
                    Question(
                        id="business-workers",
                        type=QuestionType.NUMBER,
                        title="현재 종사자 수를 입력해 주세요.",
                        required=True,
                        settings=QuestionSettings(min_value=0, max_value=1_000_000, unit="명"),
                    ),
                    Question(
                        id="business-outlook",
                        type=QuestionType.SINGLE_CHOICE,
                        title="향후 1년 경영 전망은 어떻습니까?",
                        required=True,
                        options=[
                            _option("improve", "개선"),
                            _option("same", "비슷함"),
                            _option("decline", "악화"),
                        ],
                    ),
                ],
            )
        ],
    )
    return [social, integrity, business]


memory_store = MemoryStore()
