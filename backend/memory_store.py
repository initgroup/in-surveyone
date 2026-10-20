from __future__ import annotations

from backend.publication_links import public_link_items

from backend.survey_audience import audience_submission, validate_audiences

import hashlib
import hmac
import json
import math
import re
import secrets
import unicodedata
from collections import Counter
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta, timezone
from threading import RLock
from typing import Any, Iterable
from uuid import uuid4

from backend.config import Settings, get_settings
from backend.errors import (
    AuthenticationError,
    ConflictError,
    DomainValidationError,
    ForbiddenError,
    NotFoundError,
)
from backend.models import (
    AdminTemplateDraftRequest,
    AdminTemplateDraftView,
    AdminTemplatePatchRequest,
    AdminTemplatePublishRequest,
    AdminTemplateStatus,
    AdminTemplateView,
    AdminMemberPage,
    AdminMemberStatusRequest,
    AdminMemberView,
    AdminPasswordResetView,
    AnswerItem,
    AuthSessionView,
    DashboardTrendPoint,
    DashboardView,
    DeliveryChannel,
    DeliveryChannelResult,
    DeliveryProviderView,
    DeliveryProvidersView,
    DeploymentDraftRequest,
    DeploymentDraftView,
    DeploymentExecuteRequest,
    DeploymentExecuteResult,
    DeploymentExecutionView,
    GuestMode,
    GuestCredentialView,
    GuestProvisionView,
    LoginRequest,
    PublicSurvey,
    PublishRequest,
    PublishResult,
    PublicUrlRegenerationResult,
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
    SurveyPage,
    SurveyProjectProfile,
    SurveyReport,
    SurveyResponseView,
    SurveySection,
    SurveySettings,
    SurveyStatus,
    SurveySummary,
    SurveyTemplate,
    SurveyTemplateApplyRequest,
    SurveyTemplateResetRequest,
    SurveyTheme,
    SurveyTranslation,
    SurveyUpdateRequest,
    UserRole,
    UserView,
    _normalize_locale,
    validate_translation_references,
    validate_question_activation_references,
    validate_publish_ready_sections,
)
from backend.security import (
    hash_password,
    new_initial_password,
    new_session_token,
    session_token_hash,
    validate_idempotency_key,
    verify_password,
)
from backend.delivery_security import (
    contact_hash,
    is_masked_contact,
    mask_contact,
    recipient_access_claims,
)


REPORT_TIMEZONE = timezone(timedelta(hours=9), name="Asia/Seoul")


def report_cutoff_exclusive(cutoff_date: date | None) -> datetime | None:
    if cutoff_date is None:
        return None
    if cutoff_date == date.max:
        raise DomainValidationError("cutoffDate must be earlier than 9999-12-31.")
    return datetime.combine(
        cutoff_date + timedelta(days=1),
        datetime.min.time(),
        tzinfo=REPORT_TIMEZONE,
    ).astimezone(timezone.utc)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_id(prefix: str) -> str:
    maximum_hex_length = max(8, 39 - len(prefix))
    return f"{prefix}_{uuid4().hex[:maximum_hex_length]}"


def new_public_slug() -> str:
    """Issue a non-semantic 128-bit public URL key."""
    issued_on = datetime.now(timezone.utc).strftime("%Y%m%d")
    return f"svy-{issued_on}-{secrets.token_hex(16)}"


def replace_public_slug_paths(value: Any, previous_slug: str, slug: str) -> Any:
    """Replace only public survey path segments inside stored message content."""
    previous_path = f"/s/{previous_slug}"
    next_path = f"/s/{slug}"
    if isinstance(value, str):
        return re.sub(
            rf"{re.escape(previous_path)}(?![a-z0-9-])", next_path, value
        )
    if isinstance(value, list):
        return [replace_public_slug_paths(item, previous_slug, slug) for item in value]
    if isinstance(value, dict):
        return {
            key: replace_public_slug_paths(item, previous_slug, slug)
            for key, item in value.items()
        }
    return value


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
            "audienceCode": request.audience_code,
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
    system_admin: bool = False
    active: bool = True
    withdrawn_at: datetime | None = None


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


@dataclass(frozen=True, slots=True)
class AdminTemplateVersionRecord:
    version_no: int
    snapshot_json: str
    source_survey_id: str
    published_by: str
    published_at: datetime


@dataclass(slots=True)
class AdminTemplateRecord:
    code: str
    status: AdminTemplateStatus
    source_survey_id: str | None
    use_count: int
    versions: list[AdminTemplateVersionRecord]
    published_at: datetime
    updated_at: datetime


@dataclass(slots=True)
class SurveyRecord:
    id: str
    tenant_id: str
    owner_id: str
    title: str
    description: str | None
    category: str
    template_code: str | None
    template_version_no: int | None
    sections: list[SurveySection]
    settings: SurveySettings
    theme: SurveyTheme
    skin: dict[str, Any]
    project_profile: SurveyProjectProfile
    logic_rules: list[dict[str, Any]]
    default_locale: str
    supported_locales: list[str]
    translations: dict[str, Any]
    languages: SurveyLanguages
    admin_template: bool
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
        self._admin_templates: dict[str, AdminTemplateRecord] = {}
        self._surveys: dict[str, SurveyRecord] = {}
        self._slug_routes: dict[str, tuple[str, int]] = {}
        self._responses: dict[str, list[ResponseRecord]] = {}
        self._idempotency_receipts: dict[
            tuple[str, str, str], tuple[str, ResponseReceipt]
        ] = {}
        self._deployment_drafts: dict[str, DeploymentDraftView] = {}
        self._deployment_history: dict[str, list[DeploymentDraftView]] = {}
        self._guest_login_sequence = 0
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
            system_admin=user.system_admin,
            is_guest=user.is_guest,
            guest_mode=user.guest_mode,
            created_at=user.created_at,
        )

    def _seed(self) -> None:
        templates = _seed_templates()
        self._templates = {template.code: template for template in templates}

        created_at = utcnow()
        self._admin_templates = {
            template.code: AdminTemplateRecord(
                code=template.code,
                status=AdminTemplateStatus.ACTIVE,
                source_survey_id=None,
                use_count=0,
                versions=[
                    AdminTemplateVersionRecord(
                        version_no=1,
                        snapshot_json=template.model_dump_json(by_alias=True),
                        source_survey_id=f"seed:{template.code}",
                        published_by="system",
                        published_at=created_at,
                    )
                ],
                published_at=created_at,
                updated_at=created_at,
            )
            for template in templates
        }
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
            template_version_no=template.version_no,
            sections=[section.model_copy(deep=True) for section in template.sections],
            settings=template.settings.model_copy(deep=True),
            theme=template.theme.model_copy(deep=True),
            skin=_skin_from_theme(template.theme),
            project_profile=SurveyProjectProfile(),
            logic_rules=[],
            default_locale=template.default_locale,
            supported_locales=list(template.supported_locales),
            translations={
                key: value.model_copy(deep=True)
                for key, value in template.translations.items()
            },
            languages=template.languages.model_copy(deep=True),
            admin_template=False,
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
                if self._admin_templates.get(template.code) is not None
                and self._admin_templates[template.code].status
                == AdminTemplateStatus.ACTIVE
            ]

    def template(self, code: str) -> SurveyTemplate:
        with self._lock:
            template = self._templates.get(code)
            record = self._admin_templates.get(code)
            if (
                template is None
                or record is None
                or record.status != AdminTemplateStatus.ACTIVE
            ):
                raise NotFoundError("설문 템플릿을 찾을 수 없습니다.")
            return template.model_copy(deep=True)

    @staticmethod
    def _require_system_admin(user: UserRecord) -> None:
        if not user.system_admin:
            raise ForbiddenError("공용 템플릿 관리는 플랫폼 관리자만 사용할 수 있습니다.")

    def _admin_template_view_locked(
        self, record: AdminTemplateRecord
    ) -> AdminTemplateView:
        template = self._templates[record.code]
        return AdminTemplateView(
            code=record.code,
            title=template.title,
            description=template.description,
            category=template.category,
            status=record.status,
            version_no=record.versions[-1].version_no,
            source_survey_id=record.source_survey_id,
            question_count=template.question_count,
            use_count=record.use_count,
            published_at=record.published_at,
            updated_at=record.updated_at,
        )

    def admin_templates(self, user: UserRecord) -> list[AdminTemplateView]:
        self._require_system_admin(user)
        with self._lock:
            records = sorted(
                (
                    item
                    for item in self._admin_templates.values()
                    if item.status != AdminTemplateStatus.DELETED
                ),
                key=lambda item: item.updated_at,
                reverse=True,
            )
            linked_sources = {
                item.source_survey_id
                for item in self._admin_templates.values()
                if item.status != AdminTemplateStatus.DELETED
                and item.source_survey_id is not None
            }
            drafts = [
                survey
                for survey in self._surveys.values()
                if survey.tenant_id == user.tenant_id
                and survey.owner_id == user.id
                and survey.admin_template
                and survey.status == SurveyStatus.DRAFT
                and survey.id not in linked_sources
            ]
            views = [self._admin_template_view_locked(record) for record in records]
            views.extend(
                AdminTemplateView(
                    code=f"draft:{survey.id}",
                    title=survey.title,
                    description=survey.description or "",
                    category=survey.category,
                    status=AdminTemplateStatus.DRAFT,
                    version_no=0,
                    source_survey_id=survey.id,
                    draft_only=True,
                    question_count=sum(
                        len(section.questions) for section in survey.sections
                    ),
                    use_count=0,
                    published_at=None,
                    updated_at=survey.updated_at,
                )
                for survey in drafts
            )
            views.sort(key=lambda item: item.updated_at, reverse=True)
            return views

    @staticmethod
    def _temporary_password() -> str:
        return f"Init!{secrets.token_urlsafe(12)}"

    def admin_members(
        self,
        user: UserRecord,
        *,
        page: int,
        page_size: int,
        query: str = "",
        member_type: str = "all",
    ) -> AdminMemberPage:
        self._require_system_admin(user)
        normalized = query.strip().lower()
        normalized_type = member_type.strip().lower()
        if normalized_type not in {"all", "member", "guest", "guest_unused", "guest_expired"}:
            raise DomainValidationError("회원 분류가 올바르지 않습니다.")
        with self._lock:
            members = [
                candidate
                for candidate in self._users.values()
                if (
                    normalized_type == "all"
                    or (normalized_type == "guest" and candidate.is_guest)
                    or (normalized_type == "member" and not candidate.is_guest)
                    or (
                        normalized_type == "guest_expired"
                        and candidate.is_guest
                        and candidate.tenant_expires_at is not None
                        and candidate.tenant_expires_at <= utcnow()
                    )
                    or (
                        normalized_type == "guest_unused"
                        and candidate.is_guest
                        and not any(
                            survey.tenant_id == candidate.tenant_id
                            and survey.owner_id == candidate.id
                            and survey.status != SurveyStatus.DELETED
                            for survey in self._surveys.values()
                        )
                    )
                )
                and (
                    not normalized
                    or normalized in candidate.login_id.lower()
                    or normalized in candidate.name.lower()
                    or normalized in candidate.organization_name.lower()
                    or normalized in str(candidate.email or "").lower()
                )
            ]
            members.sort(key=lambda candidate: candidate.created_at, reverse=True)
            total = len(members)
            start = (page - 1) * page_size
            items = members[start : start + page_size]
            views = [
                AdminMemberView(
                    id=candidate.id,
                    login_id=candidate.login_id,
                    name=candidate.name,
                    email=mask_contact("EMAIL", candidate.email),
                    tenant_id=candidate.tenant_id,
                    organization_name=candidate.organization_name,
                    role=candidate.role,
                    system_admin=candidate.system_admin,
                    is_guest=candidate.is_guest,
                    guest_mode=candidate.guest_mode,
                    active=candidate.active,
                    expires_at=candidate.tenant_expires_at,
                    withdrawn_at=candidate.withdrawn_at,
                    created_at=candidate.created_at,
                    last_login_at=max(
                        (
                            session.created_at
                            for session in self._sessions.values()
                            if session.user_id == candidate.id
                        ),
                        default=None,
                    ),
                    project_count=sum(
                        survey.tenant_id == candidate.tenant_id
                        and survey.owner_id == candidate.id
                        and survey.status != SurveyStatus.DELETED
                        for survey in self._surveys.values()
                    ),
                )
                for candidate in items
            ]
        return AdminMemberPage(
            items=views,
            page=page,
            page_size=page_size,
            total=total,
            has_next=page * page_size < total,
        )

    def admin_reset_member_password(
        self, user: UserRecord, member_id: str
    ) -> AdminPasswordResetView:
        self._require_system_admin(user)
        if member_id == user.id:
            raise DomainValidationError("현재 로그인한 관리자 계정은 여기에서 초기화할 수 없습니다.")
        with self._lock:
            member = self._users.get(member_id)
            if member is None:
                raise NotFoundError("회원 계정을 찾을 수 없습니다.")
            if member.withdrawn_at is not None:
                raise DomainValidationError("이미 탈퇴한 계정은 비밀번호를 초기화할 수 없습니다.")
            temporary_password = self._temporary_password()
            self._users[member_id] = replace(
                member, password_hash=hash_password(temporary_password)
            )
            self._sessions = {
                key: session
                for key, session in self._sessions.items()
                if session.user_id != member_id
            }
            return AdminPasswordResetView(
                user_id=member_id,
                login_id=member.login_id,
                temporary_password=temporary_password,
            )

    def admin_set_member_status(
        self,
        user: UserRecord,
        member_id: str,
        request: AdminMemberStatusRequest,
    ) -> AdminMemberView:
        self._require_system_admin(user)
        if member_id == user.id:
            raise DomainValidationError("현재 로그인한 관리자 계정 상태는 변경할 수 없습니다.")
        with self._lock:
            member = self._users.get(member_id)
            if member is None:
                raise NotFoundError("회원 계정을 찾을 수 없습니다.")
            if member.withdrawn_at is not None:
                raise DomainValidationError("탈퇴한 계정의 이용 상태는 변경할 수 없습니다.")
            member = replace(member, active=request.active)
            self._users[member_id] = member
            if not request.active:
                self._sessions = {
                    key: session
                    for key, session in self._sessions.items()
                    if session.user_id != member_id
                }
            return AdminMemberView(
                id=member.id,
                login_id=member.login_id,
                name=member.name,
                email=mask_contact("EMAIL", member.email),
                tenant_id=member.tenant_id,
                organization_name=member.organization_name,
                role=member.role,
                system_admin=member.system_admin,
                is_guest=member.is_guest,
                guest_mode=member.guest_mode,
                active=member.active,
                expires_at=member.tenant_expires_at,
                withdrawn_at=member.withdrawn_at,
                created_at=member.created_at,
            )

    def admin_withdraw_member(self, user: UserRecord, member_id: str) -> None:
        self._require_system_admin(user)
        if member_id == user.id:
            raise DomainValidationError("현재 로그인한 관리자 계정은 여기에서 탈퇴시킬 수 없습니다.")
        with self._lock:
            member = self._users.get(member_id)
            if member is None:
                raise NotFoundError("회원 계정을 찾을 수 없습니다.")
            if member.withdrawn_at is not None:
                return
            withdrawn_at = utcnow()
            withdrawn_login = new_id("withdrawn")
            self._users_by_login.pop(self._normalize_login(member.login_id), None)
            withdrawn = replace(
                member,
                login_id=withdrawn_login,
                name="탈퇴 회원",
                email=None,
                organization_name="탈퇴 작업공간",
                password_hash=None,
                system_admin=False,
                active=False,
                withdrawn_at=withdrawn_at,
            )
            self._users[member_id] = withdrawn
            tenant = self._tenants.get(member.tenant_id)
            if tenant is not None and not any(
                candidate.tenant_id == member.tenant_id
                and candidate.id != member_id
                and candidate.withdrawn_at is None
                for candidate in self._users.values()
            ):
                self._tenants[member.tenant_id] = replace(
                    tenant, name="탈퇴 작업공간"
                )
            self._sessions = {
                key: session
                for key, session in self._sessions.items()
                if session.user_id != member_id
            }

    def create_admin_template_draft(
        self,
        user: UserRecord,
        request: AdminTemplateDraftRequest,
    ) -> AdminTemplateDraftView:
        self._require_system_admin(user)
        with self._lock:
            template = None
            if request.template_code is not None:
                template = self._templates.get(request.template_code)
                record = self._admin_templates.get(request.template_code)
                if (
                    template is None
                    or record is None
                    or record.status == AdminTemplateStatus.DELETED
                ):
                    raise NotFoundError("공용 템플릿을 찾을 수 없습니다.")
                if record.source_survey_id:
                    current = self._surveys.get(record.source_survey_id)
                    if (
                        current is not None
                        and current.tenant_id == user.tenant_id
                        and current.owner_id == user.id
                        and current.admin_template
                        and current.status == SurveyStatus.DRAFT
                    ):
                        return AdminTemplateDraftView(
                            survey_id=current.id,
                            source_survey_id=current.id,
                            template_code=request.template_code,
                            revision=current.revision,
                        )
            create_request = SurveyCreateRequest(
                title=request.title,
                description=template.description if template else None,
                category=template.category if template else "일반조사",
                sections=(
                    [section.model_copy(deep=True) for section in template.sections]
                    if template
                    else None
                ),
                settings=(template.settings.model_copy(deep=True) if template else None),
                theme=(template.theme.model_copy(deep=True) if template else None),
                skin=(dict(template.skin) if template else None),
                logic_rules=(
                    [dict(rule) for rule in template.logic_rules] if template else []
                ),
                languages=(
                    template.languages.model_copy(deep=True)
                    if template
                    else SurveyLanguages()
                ),
                translations=(
                    {
                        locale: translation.model_copy(deep=True)
                        for locale, translation in template.translations.items()
                    }
                    if template
                    else {}
                ),
            )
            survey = self.create_survey(user, create_request, admin_template=True)
            if request.template_code is not None:
                record.source_survey_id = survey.id
                record.updated_at = utcnow()
            return AdminTemplateDraftView(
                survey_id=survey.id,
                source_survey_id=survey.id,
                template_code=request.template_code,
                revision=survey.revision,
            )

    def delete_admin_template_draft(
        self, user: UserRecord, survey_id: str
    ) -> None:
        self._require_system_admin(user)
        with self._lock:
            survey = self._owned_survey_locked(user, survey_id)
            if not survey.admin_template or survey.status != SurveyStatus.DRAFT:
                raise ConflictError("작성 중인 공용 템플릿 초안만 삭제할 수 있습니다.")
            if any(
                record.status != AdminTemplateStatus.DELETED
                and record.source_survey_id == survey.id
                for record in self._admin_templates.values()
            ):
                raise ConflictError("등록된 공용 템플릿의 편집 초안은 템플릿 삭제 기능을 사용해 주세요.")
            survey.status = SurveyStatus.DELETED
            survey.updated_at = utcnow()

    def publish_admin_template(
        self,
        user: UserRecord,
        code: str,
        request: AdminTemplatePublishRequest,
    ) -> AdminTemplateView:
        self._require_system_admin(user)
        normalized_code = code.strip().lower()
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{2,49}", normalized_code):
            raise DomainValidationError(
                "템플릿 코드는 영문 소문자·숫자·하이픈으로 3~50자 입력해 주세요."
            )
        with self._lock:
            source = self._owned_survey_locked(user, request.source_survey_id)
            if (
                not source.admin_template
                or source.status != SurveyStatus.DRAFT
                or source.versions
            ):
                raise ConflictError("작성 중인 관리자 초안만 공용 템플릿으로 등록할 수 있습니다.")
            try:
                validate_publish_ready_sections(source.sections)
                validate_translation_references(source.translations, source.sections)
            except ValueError as exc:
                raise DomainValidationError(str(exc)) from exc

            existing = self._admin_templates.get(normalized_code)
            version_no = existing.versions[-1].version_no + 1 if existing else 1
            template = SurveyTemplate(
                code=normalized_code,
                title=request.title,
                description=request.description,
                category=request.category,
                tags=(
                    list(self._templates[normalized_code].tags)
                    if normalized_code in self._templates
                    else []
                ),
                sections=[section.model_copy(deep=True) for section in source.sections],
                settings=source.settings.model_copy(deep=True),
                theme=source.theme.model_copy(deep=True),
                skin=dict(source.skin),
                logic_rules=[dict(rule) for rule in source.logic_rules],
                languages=source.languages.model_copy(deep=True),
                translations={
                    locale: translation.model_copy(deep=True)
                    for locale, translation in source.translations.items()
                },
                version_no=version_no,
            )
            now = utcnow()
            version = AdminTemplateVersionRecord(
                version_no=version_no,
                snapshot_json=template.model_dump_json(by_alias=True),
                source_survey_id=source.id,
                published_by=user.id,
                published_at=now,
            )
            self._templates[normalized_code] = template.model_copy(deep=True)
            if existing is None:
                record = AdminTemplateRecord(
                    code=normalized_code,
                    status=AdminTemplateStatus.ACTIVE,
                    source_survey_id=source.id,
                    use_count=0,
                    versions=[version],
                    published_at=now,
                    updated_at=now,
                )
                self._admin_templates[normalized_code] = record
            else:
                existing.versions.append(version)
                existing.source_survey_id = source.id
                existing.status = AdminTemplateStatus.ACTIVE
                existing.published_at = now
                existing.updated_at = now
                record = existing
            return self._admin_template_view_locked(record)

    def patch_admin_template(
        self,
        user: UserRecord,
        code: str,
        request: AdminTemplatePatchRequest,
    ) -> AdminTemplateView:
        self._require_system_admin(user)
        normalized_code = code.strip().lower()
        with self._lock:
            record = self._admin_templates.get(normalized_code)
            template = self._templates.get(normalized_code)
            if (
                record is None
                or template is None
                or record.status == AdminTemplateStatus.DELETED
            ):
                raise NotFoundError("공용 템플릿을 찾을 수 없습니다.")
            updates = request.model_fields_set
            changes: dict[str, Any] = {}
            for field_name in ("title", "description", "category"):
                if field_name in updates:
                    changes[field_name] = getattr(request, field_name)
            if changes:
                self._templates[normalized_code] = template.model_copy(update=changes)
            if "status" in updates and request.status is not None:
                record.status = request.status
            record.updated_at = utcnow()
            return self._admin_template_view_locked(record)

    def delete_admin_template(self, user: UserRecord, code: str) -> None:
        self._require_system_admin(user)
        normalized_code = code.strip().lower()
        with self._lock:
            record = self._admin_templates.get(normalized_code)
            if record is None or record.status == AdminTemplateStatus.DELETED:
                raise NotFoundError("공용 템플릿을 찾을 수 없습니다.")
            record.status = AdminTemplateStatus.DELETED
            record.updated_at = utcnow()
            if record.source_survey_id:
                source = self._surveys.get(record.source_survey_id)
                if source is not None and source.admin_template:
                    source.status = SurveyStatus.DELETED
                    source.updated_at = record.updated_at

    def create_guest(
        self,
        display_name: str,
        mode: GuestMode = GuestMode.DATABASE,
    ) -> GuestProvisionView:
        if mode != GuestMode.DATABASE:
            raise DomainValidationError("Only database guest mode is supported.")
        with self._lock:
            now = utcnow()
            expires_at = now + timedelta(hours=self.settings.guest_unused_ttl_hours)
            self._guest_login_sequence += 1
            login_id = f"quest{self._guest_login_sequence:03d}"
            initial_password = new_initial_password()
            tenant = TenantRecord(
                id=new_id("tenant"),
                name=f"게스트 체험공간 {login_id.upper()}",
                created_at=now,
                expires_at=expires_at,
            )
            user = UserRecord(
                id=new_id("user"),
                tenant_id=tenant.id,
                login_id=login_id,
                name=display_name.strip() or "게스트",
                email=None,
                organization_name=tenant.name,
                password_hash=hash_password(initial_password),
                role=UserRole.GUEST,
                is_guest=True,
                guest_mode=mode,
                created_at=now,
                tenant_expires_at=expires_at,
            )
            self._tenants[tenant.id] = tenant
            self._users[user.id] = user
            self._users_by_login[login_id] = user.id
            return GuestProvisionView(
                user=self._user_view(user),
                expires_at=expires_at,
                guest_credential=GuestCredentialView(
                    login_id=login_id,
                    initial_password=initial_password,
                    expires_at=expires_at,
                ),
            )

    def signup(self, request: SignupRequest) -> tuple[str, AuthSessionView]:
        system_admin = self._system_admin_for_signup(request)
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
                system_admin=system_admin,
                is_guest=False,
                guest_mode=None,
                created_at=now,
                tenant_expires_at=None,
            )
            self._tenants[tenant.id] = tenant
            self._users[user.id] = user
            self._users_by_login[normalized_login] = user.id
            return self._create_session_locked(user)

    def _system_admin_for_signup(self, request: SignupRequest) -> bool:
        if not request.request_system_admin:
            return False
        configured = self.settings.admin_key
        supplied = request.admin_key.get_secret_value() if request.admin_key else ""
        if not configured:
            raise DomainValidationError(
                "플랫폼 관리자 가입이 비활성화되어 있습니다. 서버의 INIT_ADMIN_KEY 설정을 확인해 주세요."
            )
        if not hmac.compare_digest(supplied.encode("utf-8"), configured.encode("utf-8")):
            raise DomainValidationError("관리자 인증키가 올바르지 않습니다.")
        return True

    def login(self, request: LoginRequest) -> tuple[str, AuthSessionView]:
        with self._lock:
            user_id = self._users_by_login.get(self._normalize_login(request.login_id))
            user = self._users.get(user_id or "")
            if (
                user is None
                or not user.active
                or (
                    user.tenant_expires_at is not None
                    and user.tenant_expires_at <= utcnow()
                )
                or not verify_password(
                request.password, user.password_hash
                )
            ):
                raise AuthenticationError("아이디 또는 비밀번호가 올바르지 않습니다.")
            return self._create_session_locked(
                user,
                expires_at=user.tenant_expires_at if user.is_guest else None,
            )

    def _create_session_locked(
        self,
        user: UserRecord,
        *,
        expires_at: datetime | None = None,
    ) -> tuple[str, AuthSessionView]:
        now = utcnow()
        session_expires_at = now + timedelta(
            seconds=self.settings.session_ttl_seconds
        )
        expires_at = (
            min(expires_at, session_expires_at)
            if expires_at is not None
            else session_expires_at
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
            now = utcnow()
            if session.expires_at <= now:
                self._sessions.pop(token_hash, None)
                raise AuthenticationError("로그인 세션이 만료되었습니다.")
            user = self._users.get(session.user_id)
            if user is None or not user.active:
                self._sessions.pop(token_hash, None)
                raise AuthenticationError("로그인 사용자를 찾을 수 없습니다.")
            expires_at = now + timedelta(seconds=self.settings.session_ttl_seconds)
            if user.tenant_expires_at is not None:
                if user.tenant_expires_at <= now:
                    self._sessions.pop(token_hash, None)
                    raise AuthenticationError("게스트 작업공간이 만료되었습니다.")
                expires_at = min(expires_at, user.tenant_expires_at)
            self._sessions[token_hash] = replace(session, expires_at=expires_at)
            return user

    def auth_session(self, raw_token: str | None) -> AuthSessionView:
        user = self.authenticate(raw_token)
        token_hash = session_token_hash(str(raw_token), self.settings.session_secret)
        with self._lock:
            session = self._sessions[token_hash]
            return AuthSessionView(user=self._user_view(user), expires_at=session.expires_at)

    def extend_session(self, raw_token: str | None) -> AuthSessionView:
        return self.auth_session(raw_token)

    def logout(self, raw_token: str | None) -> None:
        if not raw_token:
            return
        token_hash = session_token_hash(raw_token, self.settings.session_secret)
        with self._lock:
            self._sessions.pop(token_hash, None)

    def create_survey(
        self,
        user: UserRecord,
        request: SurveyCreateRequest,
        *,
        admin_template: bool = False,
    ) -> SurveyDetail:
        with self._lock:
            if user.is_guest:
                owned_count = sum(
                    survey.tenant_id == user.tenant_id
                    and survey.owner_id == user.id
                    and survey.status != SurveyStatus.DELETED
                    for survey in self._surveys.values()
                )
                if owned_count >= self.settings.db_guest_max_projects:
                    raise DomainValidationError(
                        "Database guest project limit has been reached."
                    )
            template = None
            template_code = request.template_code or request.template_id
            if template_code:
                template = self._templates.get(template_code)
                template_record = self._admin_templates.get(template_code)
                if (
                    template is None
                    or template_record is None
                    or template_record.status != AdminTemplateStatus.ACTIVE
                ):
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
            if user.is_guest and sum(
                len(section.questions) for section in sections
            ) > self.settings.db_guest_max_questions:
                raise DomainValidationError(
                    "Database guest question limit has been exceeded."
                )

            now = utcnow()
            if user.is_guest:
                project_expires_at = now + timedelta(hours=self.settings.guest_project_ttl_hours)
                tenant = self._tenants.get(user.tenant_id)
                if tenant is not None and (tenant.expires_at is None or tenant.expires_at < project_expires_at):
                    self._tenants[user.tenant_id] = replace(tenant, expires_at=project_expires_at)
                    user = replace(user, tenant_expires_at=project_expires_at)
                    self._users[user.id] = user
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
                template_version_no=template.version_no if template else None,
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
                    else dict(template.skin)
                    if template
                    else _skin_from_theme(SurveyTheme())
                ),
                project_profile=request.project_profile.model_copy(deep=True),
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
                admin_template=admin_template,
                status=SurveyStatus.DRAFT,
                revision=1,
                slug=None,
                versions=[],
                created_at=now,
                updated_at=now,
                published_at=None,
            )
            survey.settings = _settings_for_project_profile(
                survey.settings, survey.project_profile
            )
            self._validate_translation_targets(survey.sections, survey.translations)
            validate_audiences(survey.sections, survey.settings)
            self._surveys[survey.id] = survey
            self._responses[survey.id] = []
            if template is not None:
                self._admin_templates[template.code].use_count += 1
            return self._detail_locked(survey)

    def list_surveys(
        self,
        user: UserRecord,
        status: SurveyStatus | None = None,
        *,
        stage: str | None = None,
    ) -> list[SurveySummary]:
        with self._lock:
            surveys = [
                survey
                for survey in self._surveys.values()
                if survey.tenant_id == user.tenant_id
                and survey.owner_id == user.id
                and survey.status != SurveyStatus.DELETED
                and not survey.admin_template
                and (status is None or survey.status == status)
                and self._matches_distribution_stage_locked(survey, stage)
            ]
            surveys.sort(key=lambda item: item.updated_at, reverse=True)
            return [self._summary_locked(survey) for survey in surveys]

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
    ) -> SurveyPage:
        normalized_query = query.strip().casefold()
        with self._lock:
            owned = [
                survey
                for survey in self._surveys.values()
                if survey.tenant_id == user.tenant_id
                and survey.owner_id == user.id
                and survey.status != SurveyStatus.DELETED
                and not survey.admin_template
            ]
            filtered = [
                survey
                for survey in owned
                if (status is None or survey.status == status)
                and self._matches_distribution_stage_locked(survey, stage)
                and (
                    not normalized_query
                    or normalized_query
                    in f"{survey.title} {survey.category} {survey.id}".casefold()
                )
            ]
            def title_key(item: SurveyRecord) -> tuple[str, str]:
                return item.title.casefold(), item.id

            if sort == "responses":
                filtered.sort(
                    key=lambda item: (-len(self._responses.get(item.id, [])), *title_key(item))
                )
            elif sort == "title":
                filtered.sort(key=title_key)
            elif sort == "updated-asc":
                filtered.sort(key=lambda item: (item.updated_at, *title_key(item)))
            elif sort == "created-desc":
                filtered.sort(key=lambda item: (-item.created_at.timestamp(), *title_key(item)))
            else:
                filtered.sort(key=lambda item: (-item.updated_at.timestamp(), *title_key(item)))
            offset = (page - 1) * page_size
            items = filtered[offset : offset + page_size]
            return SurveyPage(
                items=[self._summary_locked(survey) for survey in items],
                page=page,
                page_size=page_size,
                total=len(filtered),
                total_all=len(owned),
                has_next=offset + page_size < len(filtered),
            )

    def delivery_providers(self, user: UserRecord) -> DeliveryProvidersView:
        configured = {
            "email": self.settings.email_provider,
            "sms": self.settings.sms_provider,
            "kakao": self.settings.kakao_provider,
            "fax": self.settings.fax_provider,
        }
        providers: dict[str, DeliveryProviderView] = {}
        for code, provider_code in configured.items():
            enabled = not user.is_guest and provider_code not in {"", "disabled"}
            reason = (
                "발송 provider가 준비되었습니다."
                if enabled
                else "게스트 계정은 실제 외부 발송을 사용할 수 없습니다."
                if user.is_guest
                else f"{code.upper()} 발송 provider가 설정되지 않았습니다."
            )
            providers[code] = DeliveryProviderView(
                enabled=enabled,
                status="READY" if enabled else "DISABLED",
                provider_code=provider_code if enabled else "disabled",
                reason=reason,
            )
        return DeliveryProvidersView(providers=providers)

    @staticmethod
    def _merge_masked_recipient_contacts(
        request: DeploymentDraftRequest,
        current: DeploymentDraftView | None,
    ) -> DeploymentDraftRequest:
        if current is None:
            return request
        previous = {recipient.id: recipient for recipient in current.recipients}
        payload = request.model_dump(by_alias=True, mode="json")
        for recipient in payload["recipients"]:
            old = previous.get(recipient["id"])
            if old is None:
                continue
            contact_types = {
                "email": "EMAIL",
                "mobile": "SMS",
                "fax": "FAX",
                "kakaoId": "KAKAO",
            }
            for field_name, contact_type in contact_types.items():
                submitted = recipient.get(field_name)
                if not is_masked_contact(submitted):
                    continue
                old_value = getattr(
                    old,
                    {"kakaoId": "kakao_id"}.get(field_name, field_name),
                )
                if submitted != mask_contact(contact_type, old_value):
                    raise DomainValidationError(
                        f"{recipient['name']} 대상자의 마스킹된 {contact_type} 연락처는 "
                        "일부만 수정할 수 없습니다. 전체 값을 다시 입력해 주세요."
                    )
                recipient[field_name] = old_value
        return DeploymentDraftRequest.model_validate(payload)

    @staticmethod
    def _masked_deployment(value: DeploymentDraftView) -> DeploymentDraftView:
        payload = value.model_dump(by_alias=True, mode="json")
        for recipient in payload["recipients"]:
            recipient["email"] = mask_contact("EMAIL", recipient.get("email"))
            recipient["mobile"] = mask_contact("SMS", recipient.get("mobile"))
            recipient["fax"] = mask_contact("FAX", recipient.get("fax"))
            recipient["kakaoId"] = mask_contact("KAKAO", recipient.get("kakaoId"))
        return DeploymentDraftView.model_validate(payload)

    def _published_survey_locked(
        self, user: UserRecord, survey_id: str
    ) -> tuple[SurveyRecord, PublicSurvey]:
        survey = self._owned_survey_locked(user, survey_id)
        if survey.status != SurveyStatus.PUBLISHED or not survey.versions or not survey.slug:
            raise ConflictError("확정된 설문 프로젝트만 배포 작업을 할 수 있습니다.")
        public = PublicSurvey.model_validate_json(survey.versions[-1].snapshot_json)
        public.slug = survey.slug
        return survey, public

    def deployment(
        self, user: UserRecord, survey_id: str
    ) -> DeploymentDraftView:
        with self._lock:
            self._published_survey_locked(user, survey_id)
            value = self._deployment_drafts.get(survey_id)
            if value is None:
                raise NotFoundError("저장된 배포 초안이 없습니다.")
            return self._masked_deployment(value)

    def save_deployment(
        self,
        user: UserRecord,
        survey_id: str,
        request: DeploymentDraftRequest,
    ) -> DeploymentDraftView:
        with self._lock:
            survey, public = self._published_survey_locked(user, survey_id)
            current = self._deployment_drafts.get(survey_id)
            if request.revision is not None and (
                current is None or request.revision != current.revision
            ):
                raise ConflictError(
                    "다른 화면에서 배포 초안이 변경되었습니다. 최신 내용을 다시 불러와 주세요."
                )
            request = self._merge_masked_recipient_contacts(request, current)
            executed_current = None
            if current is not None and current.execution_status:
                if request.revision is not None:
                    raise ConflictError(
                        "이미 실행한 배포 계획은 변경할 수 없습니다. revision 없이 새 배포 계획을 만들어 주세요."
                    )
                executed_current = current
                current = None
            elif current is not None and request.revision is None:
                raise ConflictError(
                    "기존 배포 초안을 변경하려면 최신 revision이 필요합니다. 초안을 다시 불러와 주세요."
                )
            unsupported = {
                recipient.preferred_language
                for recipient in request.recipients
                if recipient.preferred_language not in public.supported_locales
            }
            if unsupported:
                raise DomainValidationError(
                    "확정 버전에 포함되지 않은 수신 언어입니다: "
                    + ", ".join(sorted(unsupported))
                )
            now = utcnow()
            if public.settings.closes_at is not None and public.settings.closes_at <= now:
                raise ConflictError("응답 기간이 종료된 설문은 배포할 수 없습니다.")
            retention_candidates = [now + timedelta(days=90)]
            if public.settings.closes_at and public.settings.closes_at > now:
                retention_candidates.append(public.settings.closes_at)
            if user.tenant_expires_at and user.tenant_expires_at > now:
                retention_candidates.append(user.tenant_expires_at)
            retention_until = min(retention_candidates)
            if (
                request.schedule.scheduled_at is not None
                and request.schedule.scheduled_at >= retention_until
            ):
                raise DomainValidationError(
                    "예약 발송 시각은 설문 응답 기간과 연락처 보유 기간 안이어야 합니다."
                )
            contact_fields = {
                DeliveryChannel.EMAIL: "email",
                DeliveryChannel.SMS: "mobile",
                DeliveryChannel.KAKAO: "kakao_id",
                DeliveryChannel.FAX: "fax",
            }
            seen_contacts: set[tuple[DeliveryChannel, str]] = set()
            for recipient in request.recipients:
                for channel in recipient.channels:
                    value = getattr(recipient, contact_fields[channel])
                    if not value:
                        continue
                    duplicate_key = (
                        channel,
                        contact_hash(self.settings.delivery_secret, channel.value, value),
                    )
                    if duplicate_key in seen_contacts:
                        raise DomainValidationError(
                            f"같은 {channel.value} 연락처를 배포 대상에 중복 등록할 수 없습니다."
                        )
                    seen_contacts.add(duplicate_key)
            if executed_current is not None:
                self._deployment_history.setdefault(survey_id, []).append(
                    executed_current.model_copy(deep=True)
                )
            value = DeploymentDraftView(
                **request.model_dump(exclude={"revision"}),
                deployment_id=(
                    current.deployment_id
                    if current
                    else new_id("deploy")
                ),
                survey_id=survey_id,
                survey_version=public.version,
                public_slug=public.slug,
                revision=(current.revision + 1 if current else 1),
                updated_at=now,
                execution_status=(current.execution_status if current else None),
            )
            self._deployment_drafts[survey_id] = value
            return self._masked_deployment(value)

    def execute_deployment(
        self,
        user: UserRecord,
        survey_id: str,
        request: DeploymentExecuteRequest,
    ) -> DeploymentExecuteResult:
        saved = self.save_deployment(user, survey_id, request)
        with self._lock:
            raw = self._deployment_drafts[survey_id]
            if raw.revision != saved.revision or raw.execution_status is not None:
                raise ConflictError(
                    "배포 실행 직전에 계획이 변경되었습니다. 최신 내용을 확인한 뒤 다시 실행해 주세요."
                )
            providers = self.delivery_providers(user).providers
            channel_counts = {channel: 0 for channel in raw.channels}
            queued_count = 0
            disabled_count = 0
            for recipient in raw.recipients:
                available = [
                    channel
                    for channel in raw.channels
                    if channel in recipient.channels
                ]
                if raw.schedule.strategy == "PRIORITY_FALLBACK" and available:
                    ordered = [
                        channel
                        for channel in raw.schedule.priority
                        if channel in available
                    ]
                    ready = [
                        channel
                        for channel in ordered
                        if providers[channel.value.lower()].enabled
                    ]
                    available = [ready[0] if ready else ordered[0]]
                for channel in available:
                    channel_counts[channel] += 1
                    if providers[channel.value.lower()].enabled:
                        queued_count += 1
                    else:
                        disabled_count += 1
            channel_results: list[DeliveryChannelResult] = []
            for channel in raw.channels:
                provider = providers[channel.value.lower()]
                channel_results.append(
                    DeliveryChannelResult(
                        channel=channel,
                        status="QUEUED" if provider.enabled else "DISABLED",
                        count=channel_counts[channel],
                        reason=None if provider.enabled else provider.reason,
                    )
                )
            execution_status = (
                "QUEUED"
                if queued_count and not disabled_count
                else "PARTIAL"
                if queued_count
                else "DISABLED"
            )
            raw.execution_status = execution_status
            self._deployment_drafts[survey_id] = raw
            return DeploymentExecuteResult(
                deployment=self._masked_deployment(raw),
                execution=DeploymentExecutionView(
                    execution_status=execution_status,
                    channel_results=channel_results,
                ),
            )

    def get_survey(self, user: UserRecord, survey_id: str) -> SurveyDetail:
        with self._lock:
            return self._detail_locked(self._owned_survey_locked(user, survey_id))

    def apply_template(
        self,
        user: UserRecord,
        survey_id: str,
        request: SurveyTemplateApplyRequest,
    ) -> SurveyDetail:
        with self._lock:
            survey = self._owned_survey_locked(user, survey_id)
            if (
                request.expected_revision is not None
                and request.expected_revision != survey.revision
            ):
                raise ConflictError(
                    "다른 화면에서 프로젝트가 변경되었습니다. 최신 내용을 다시 불러온 뒤 템플릿을 선택해 주세요."
                )
            if survey.status != SurveyStatus.DRAFT or survey.versions:
                raise ConflictError(
                    "템플릿은 아직 확정하지 않은 작성 중 프로젝트에만 적용할 수 있습니다."
                )
            template = self._templates.get(request.template_code)
            template_record = self._admin_templates.get(request.template_code)
            if (
                template is None
                or template_record is None
                or template_record.status != AdminTemplateStatus.ACTIVE
            ):
                raise NotFoundError("설문 템플릿을 찾을 수 없습니다.")
            survey.template_code = template.code
            survey.template_version_no = template.version_no
            survey.sections = [
                section.model_copy(deep=True) for section in template.sections
            ]
            template_settings = template.settings.model_copy(deep=True)
            template_settings.presentation_mode = survey.settings.presentation_mode
            survey.settings = _settings_for_project_profile(
                template_settings, survey.project_profile
            )
            survey.logic_rules = [dict(rule) for rule in template.logic_rules]
            survey.default_locale = template.default_locale
            survey.supported_locales = list(template.supported_locales)
            survey.translations = {
                key: value.model_copy(deep=True)
                for key, value in template.translations.items()
            }
            survey.languages = template.languages.model_copy(deep=True)
            survey.revision += 1
            survey.updated_at = utcnow()
            template_record.use_count += 1
            return self._detail_locked(survey)

    def reset_template(
        self,
        user: UserRecord,
        survey_id: str,
        request: SurveyTemplateResetRequest,
    ) -> SurveyDetail:
        with self._lock:
            survey = self._owned_survey_locked(user, survey_id)
            if (
                request.expected_revision is not None
                and request.expected_revision != survey.revision
            ):
                raise ConflictError(
                    "다른 화면에서 프로젝트가 변경되었습니다. 최신 내용을 다시 불러온 뒤 다시 시도해 주세요."
                )
            if survey.status != SurveyStatus.DRAFT or survey.versions:
                raise ConflictError(
                    "빈 설문으로 초기화하는 작업은 아직 확정하지 않은 작성 중 프로젝트에서만 가능합니다."
                )
            survey.template_code = None
            survey.template_version_no = None
            survey.sections = [SurveySection(title="설문 문항", questions=[])]
            survey.logic_rules = []
            survey.translations = {}
            survey.revision += 1
            survey.updated_at = utcnow()
            return self._detail_locked(survey)

    def delete_survey(self, user: UserRecord, survey_id: str) -> None:
        with self._lock:
            survey = self._owned_survey_locked(user, survey_id)
            if survey.status == SurveyStatus.PUBLISHED:
                raise ConflictError(
                    "확정 또는 진행 중인 설문 프로젝트는 삭제할 수 없습니다. 먼저 배포를 종료해 주세요."
                )
            if survey.slug:
                self._slug_routes.pop(survey.slug, None)
            survey.status = SurveyStatus.DELETED
            survey.updated_at = utcnow()

    def close_survey(self, user: UserRecord, survey_id: str) -> SurveyDetail:
        with self._lock:
            survey = self._owned_survey_locked(user, survey_id)
            if survey.status != SurveyStatus.PUBLISHED:
                raise ConflictError("확정 또는 진행 중인 설문 프로젝트만 배포를 종료할 수 있습니다.")
            if survey.slug:
                self._slug_routes.pop(survey.slug, None)
            current_delivery = self._deployment_drafts.pop(survey_id, None)
            if current_delivery is not None:
                self._deployment_history.setdefault(survey_id, []).append(
                    current_delivery.model_copy(deep=True)
                )
            survey.status = SurveyStatus.CLOSED
            survey.updated_at = utcnow()
            return self._detail_locked(survey)

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
            if (
                request.expected_revision is not None
                and request.expected_revision != survey.revision
            ):
                raise ConflictError(
                    "다른 화면에서 프로젝트가 변경되었습니다. 최신 내용을 다시 불러온 뒤 저장해 주세요."
                )
            self._validate_source_locale_promotion(survey, request)
            updates = request.model_fields_set
            proposed_sections = (
                [SurveySection(title="설문 문항", questions=request.questions)]
                if "questions" in updates and request.questions is not None
                else request.sections
                if "sections" in updates and request.sections is not None
                else survey.sections
            )
            validate_audiences(proposed_sections, request.settings or survey.settings)
            proposed_translations = (
                request.translations
                if "translations" in updates and request.translations is not None
                else survey.translations
            )
            self._validate_translation_targets(
                proposed_sections, proposed_translations
            )
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
                if "project_profile" not in updates:
                    survey.project_profile = _project_profile_for_settings(
                        survey.project_profile, survey.settings
                    )
            if "theme" in updates and request.theme is not None:
                survey.theme = request.theme.model_copy(deep=True)
                if "skin" not in updates:
                    survey.skin = _skin_from_theme(survey.theme)
            if "skin" in updates and request.skin is not None:
                survey.skin = dict(request.skin)
            if "project_profile" in updates and request.project_profile is not None:
                survey.project_profile = request.project_profile.model_copy(deep=True)
                survey.settings = _settings_for_project_profile(
                    survey.settings, survey.project_profile
                )
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
            if user.is_guest and sum(
                len(section.questions) for section in survey.sections
            ) > self.settings.db_guest_max_questions:
                raise DomainValidationError(
                    "Database guest question limit has been exceeded."
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
        if not survey.title.strip():
            raise DomainValidationError(
                "설문을 확정하려면 제목을 입력해야 합니다."
            )
        try:
            validate_publish_ready_sections(survey.sections)
        except ValueError as exc:
            raise DomainValidationError(str(exc)) from exc

        owner = self._users.get(survey.owner_id)
        is_guest_demo = owner is not None and owner.is_guest
        requested_slug = request.slug

        if survey.slug:
            if requested_slug and requested_slug != survey.slug:
                raise ConflictError("확정된 설문의 URL 식별자는 변경할 수 없습니다.")
            slug = survey.slug
        else:
            slug_base = requested_slug or new_public_slug()
            slug = self._unique_slug_locked(slug_base, survey.id)

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
            project_profile=survey.project_profile.model_copy(deep=True),
            logic_rules=[dict(rule) for rule in survey.logic_rules],
            default_locale=survey.default_locale,
            supported_locales=list(survey.supported_locales),
            translations={
                key: value.model_copy(deep=True)
                for key, value in survey.translations.items()
            },
            languages=survey.languages.model_copy(deep=True),
            published_at=now,
            guest_demo=is_guest_demo,
            experience_expires_at=(
                self._tenants[survey.tenant_id].expires_at
                if is_guest_demo
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
            links=public_link_items(public_survey),
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
            public.slug = survey.slug or public.slug
            return apply_public_availability(
                apply_public_translation(public, language)
            )

    def regenerate_public_url(
        self, user: UserRecord, survey_id: str
    ) -> PublicUrlRegenerationResult:
        with self._lock:
            survey = self._owned_survey_locked(user, survey_id)
            if survey.status != SurveyStatus.PUBLISHED or not survey.slug or not survey.versions:
                raise ConflictError("확정되어 공개 중인 설문만 URL을 재발급할 수 있습니다.")
            previous_slug = survey.slug
            slug = previous_slug
            while slug == previous_slug:
                slug = self._unique_slug_locked(new_public_slug(), survey.id)
            now = utcnow()
            self._slug_routes.pop(previous_slug, None)
            self._slug_routes[slug] = (survey.id, len(survey.versions))
            survey.slug = slug
            survey.updated_at = now
            deployment_revision = None
            current = self._deployment_drafts.get(survey_id)
            if current is not None:
                payload = current.model_dump(by_alias=True, mode="json")
                payload["publicSlug"] = slug
                payload["updatedAt"] = now
                if current.execution_status is None:
                    payload["messagesByLanguage"] = replace_public_slug_paths(
                        payload.get("messagesByLanguage") or {}, previous_slug, slug
                    )
                    payload["revision"] = current.revision + 1
                    deployment_revision = payload["revision"]
                self._deployment_drafts[survey_id] = DeploymentDraftView.model_validate(
                    payload
                )
            return PublicUrlRegenerationResult(
                survey_id=survey_id,
                previous_slug=previous_slug,
                slug=slug,
                public_url=f"/s/{slug}",
                deployment_revision=deployment_revision,
                regenerated_at=now,
            )

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
            if request.respondent_key and request.respondent_key.startswith("d1."):
                claims = recipient_access_claims(
                    self.settings.delivery_secret,
                    request.respondent_key,
                    survey_id=survey.id,
                    survey_version=version.version,
                )
                if claims is None:
                    raise DomainValidationError("응답자별 배포 URL이 유효하지 않습니다.")
                payload = request.model_dump(by_alias=True, mode="json")
                payload["metadata"]["deliveryTargetId"] = claims[1]
                request = SubmitResponseRequest.model_validate(payload)
            if (
                public_survey.settings.one_response_per_respondent
                and not request.respondent_key
            ):
                raise DomainValidationError(
                    "This survey requires a stable respondentKey to enforce one response."
                )

            selected_survey, request = audience_submission(public_survey, request)
            normalized_answers = self._validate_answers(selected_survey, request.answers)
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
            if public_survey.settings.closes_at and now >= public_survey.settings.closes_at:
                raise ConflictError("설문 응답 기간이 종료되었습니다.")
            if len(self._responses.get(survey.id, [])) >= self.settings.db_guest_max_responses and any(
                user.tenant_id == survey.tenant_id and user.is_guest
                for user in self._users.values()
            ):
                raise ConflictError(
                    "Database guest response limit has been reached."
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
                cutoff_exclusive = report_cutoff_exclusive(cutoff_date)
                assert cutoff_exclusive is not None
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
                and survey.status != SurveyStatus.DELETED
                and not survey.admin_template
            ]
            surveys.sort(key=lambda item: item.updated_at, reverse=True)
            kst = timezone(timedelta(hours=9))
            today = datetime.now(kst).date()
            trend_dates = [today - timedelta(days=offset) for offset in range(7, -1, -1)]
            owned_ids = {survey.id for survey in surveys}
            response_counts = Counter(
                response.submitted_at.astimezone(kst).date()
                for survey_id, responses in self._responses.items()
                if survey_id in owned_ids
                for response in responses
            )
            return DashboardView(
                total_surveys=len(surveys),
                draft_surveys=sum(survey.status == SurveyStatus.DRAFT for survey in surveys),
                published_surveys=sum(
                    survey.status == SurveyStatus.PUBLISHED for survey in surveys
                ),
                closed_surveys=sum(survey.status == SurveyStatus.CLOSED for survey in surveys),
                total_responses=sum(len(self._responses.get(survey.id, [])) for survey in surveys),
                today_responses=response_counts[today],
                response_trend=[
                    DashboardTrendPoint(date=trend_date, responses=response_counts[trend_date])
                    for trend_date in trend_dates
                ],
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
            or survey.status == SurveyStatus.DELETED
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
        if survey.status != SurveyStatus.PUBLISHED:
            raise NotFoundError("공개 설문을 찾을 수 없습니다.")
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
        active = self._has_executed_distribution_locked(survey)
        deployment_status = (
            "ACTIVE"
            if survey.status == SurveyStatus.PUBLISHED
            and active
            else "READY"
            if survey.status == SurveyStatus.PUBLISHED
            else None
        )
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
            deployment_status=deployment_status,
            starts_at=survey.project_profile.starts_at,
            closes_at=survey.project_profile.closes_at,
            created_at=survey.created_at,
            updated_at=survey.updated_at,
            published_at=survey.published_at,
        )

    def _matches_distribution_stage_locked(
        self, survey: SurveyRecord, stage: str | None
    ) -> bool:
        if stage is None:
            return True
        if survey.status != SurveyStatus.PUBLISHED:
            return False
        active = self._has_executed_distribution_locked(survey)
        return active if stage == "active" else not active

    def _has_executed_distribution_locked(self, survey: SurveyRecord) -> bool:
        version = len(survey.versions)
        deployments = [
            self._deployment_drafts.get(survey.id),
            *self._deployment_history.get(survey.id, []),
        ]
        return any(
            item is not None
            and item.survey_version == version
            and item.execution_status is not None
            for item in deployments
        )

    def _detail_locked(self, survey: SurveyRecord) -> SurveyDetail:
        summary = self._summary_locked(survey)
        return SurveyDetail(
            **summary.model_dump(),
            description=survey.description,
            template_code=survey.template_code,
            template_version_no=survey.template_version_no,
            revision=survey.revision,
            sections=[section.model_copy(deep=True) for section in survey.sections],
            settings=survey.settings.model_copy(deep=True),
            theme=survey.theme.model_copy(deep=True),
            skin=dict(survey.skin),
            project_profile=survey.project_profile.model_copy(deep=True),
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
        sections = list(sections)
        identifiers = [
            question.id for section in sections for question in section.questions
        ]
        if len(identifiers) != len(set(identifiers)):
            raise DomainValidationError("설문 전체에서 문항 ID는 중복될 수 없습니다.")
        try:
            validate_question_activation_references(sections)
        except ValueError as exc:
            raise DomainValidationError(str(exc)) from exc

    @staticmethod
    def _validate_translation_targets(
        sections: list[SurveySection], translations: dict[str, SurveyTranslation]
    ) -> None:
        try:
            validate_translation_references(translations, sections)
        except ValueError as exc:
            raise DomainValidationError(str(exc)) from exc

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

    @staticmethod
    def _question_condition_matches(condition: Any, value: Any) -> bool:
        operator = str(condition.operator)
        if operator == "exists":
            return not MemoryStore._is_empty(value)
        if operator == "not_exists":
            return MemoryStore._is_empty(value)
        if MemoryStore._is_empty(value):
            return False
        expected = condition.value
        actual_values = value if isinstance(value, list) else [value]
        expected_values = expected if isinstance(expected, list) else [expected]
        if operator == "contains":
            return any(
                str(expected_item) in str(actual_item)
                for actual_item in actual_values
                for expected_item in expected_values
            )
        if operator == "in":
            return any(
                str(actual_item) == str(expected_item)
                for actual_item in actual_values
                for expected_item in expected_values
            )
        if operator in {
            "greater_than",
            "greater_or_equal",
            "less_than",
            "less_or_equal",
        }:
            try:
                actual_number = float(actual_values[0])
                expected_number = float(expected_values[0])
            except (TypeError, ValueError):
                return False
            return {
                "greater_than": actual_number > expected_number,
                "greater_or_equal": actual_number >= expected_number,
                "less_than": actual_number < expected_number,
                "less_or_equal": actual_number <= expected_number,
            }[operator]
        equal = any(
            str(actual_item) == str(expected_item)
            for actual_item in actual_values
            for expected_item in expected_values
        )
        return not equal if operator == "not_equals" else equal

    @classmethod
    def _question_is_active(
        cls, question: Question, answer_map: dict[str, AnswerItem]
    ) -> bool:
        group = question.activation_condition
        if group is None:
            return True
        matches = [
            cls._question_condition_matches(
                condition,
                answer_map.get(condition.source_question_id).value
                if answer_map.get(condition.source_question_id)
                else None,
            )
            for condition in group.conditions
        ]
        return all(matches) if group.combinator == "all" else any(matches)

    @classmethod
    def _reachable_section_ids(
        cls,
        survey: PublicSurvey,
        answer_map: dict[str, AnswerItem],
    ) -> set[str]:
        return cls._response_visibility(survey, answer_map)[0]

    @classmethod
    def _response_visibility(
        cls,
        survey: PublicSurvey,
        answer_map: dict[str, AnswerItem],
    ) -> tuple[set[str], set[str], dict[str, AnswerItem]]:
        section_index_by_question = {
            question.id: section_index
            for section_index, section in enumerate(survey.sections)
            for question in section.questions
        }
        visible: set[str] = set()
        active_questions: set[str] = set()
        effective_answers: dict[str, AnswerItem] = {}
        visited: set[int] = set()
        section_index = 0
        while (
            0 <= section_index < len(survey.sections)
            and section_index not in visited
        ):
            visited.add(section_index)
            section = survey.sections[section_index]
            visible.add(section.id)
            for question in section.questions:
                if question.type == QuestionType.TEXT:
                    continue
                if cls._question_is_active(question, effective_answers):
                    active_questions.add(question.id)
                    answer = answer_map.get(question.id)
                    if answer is not None:
                        effective_answers[question.id] = answer
            matching_rule: dict[str, Any] | None = None
            for rule in survey.logic_rules:
                source_id = str(
                    rule.get("sourceQuestionId") or rule.get("questionId") or ""
                )
                answer = effective_answers.get(source_id)
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
        return visible, active_questions, effective_answers

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
        answer_map = {
            answer.question_id: AnswerItem(
                question_id=answer.question_id,
                value=self._normalize_answer_value(questions[answer.question_id], answer.value)
                if answer.question_id in questions and questions[answer.question_id].settings.choice_input == "codes"
                else answer.value,
            ) for answer in answers
        }
        unknown = sorted(set(answer_map) - set(questions))
        if unknown:
            raise DomainValidationError(
                f"존재하지 않는 문항에 대한 응답입니다: {', '.join(unknown)}"
            )

        reachable_sections, active_question_ids, effective_answers = (
            self._response_visibility(survey, answer_map)
        )
        hidden_questions = set(questions) - active_question_ids
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
                if question.id not in active_question_ids:
                    continue
                answer = effective_answers.get(question.id)
                value = answer.value if answer else None
                if question.required and self._is_empty(value):
                    raise DomainValidationError(
                        f"필수 문항에 응답해 주세요: {question.title}"
                    )
                if self._is_empty(value):
                    continue
                value = self._normalize_answer_value(question, value)
                self._validate_answer_value(question, value)
                excluded_source = question.settings.exclude_selected_from
                if excluded_source and excluded_source in effective_answers:
                    excluded_value = effective_answers[excluded_source].value
                    excluded = excluded_value if isinstance(excluded_value, list) else [excluded_value]
                    selected = value if isinstance(value, list) else [value]
                    if any(item in excluded for item in selected):
                        raise DomainValidationError(
                            f"A preceding answer excludes a selected option: {question.title}"
                        )
                normalized.append(AnswerItem(question_id=question.id, value=value))
        return normalized

    @staticmethod
    def _normalize_answer_value(question: Question, value: Any) -> Any:
        if question.settings.choice_input == "codes" and isinstance(value, list):
            codes = {option.code: option.id for option in question.options}
            option_ids = {option.id for option in question.options}
            return [
                item if isinstance(item, str) and item in option_ids else codes.get(str(int(str(item))), item)
                if isinstance(item, (str, int)) and not isinstance(item, bool)
                and re.fullmatch(r"[0-9]{1,6}", str(item)) else item
                for item in value
            ]
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
            minimum = question.settings.min_selections
            if minimum is not None and len(value) < minimum:
                raise DomainValidationError(
                    f"Select at least {minimum} options: {question.title}"
                )
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
                        not selected
                        or any(not isinstance(item, str) or item not in columns for item in selected)
                        or len(selected) != len(set(selected))
                        or (selection_mode != "multiple" and len(selected) != 1)
                    ):
                        valid = False
                        break
            if valid and question.required and set(value) != rows:
                valid = False
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
        row_counts: dict[str, dict[str, int]] = {}
        row_labels: dict[str, str] = {}
        column_labels: dict[str, str] = {}
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
        elif question.type == QuestionType.MATRIX:
            row_labels = {item.id: item.label for item in question.settings.rows}
            column_labels = {item.id: item.label for item in question.settings.columns}
            row_counts = {
                row_id: {column_id: 0 for column_id in column_labels}
                for row_id in row_labels
            }
            for value in values:
                if not isinstance(value, dict):
                    continue
                for row_id, selection in value.items():
                    if row_id not in row_counts:
                        continue
                    selected = selection if isinstance(selection, list) else [selection]
                    for column_id in set(item for item in selected if isinstance(item, str)):
                        if column_id in column_labels:
                            row_counts[row_id][column_id] += 1

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
            row_counts=row_counts,
            row_labels=row_labels,
            column_labels=column_labels,
        )


def _option(identifier: str, label: str) -> QuestionOption:
    return QuestionOption(id=identifier, label=label)


def _settings_for_project_profile(
    settings: SurveySettings, profile: SurveyProjectProfile
) -> SurveySettings:
    payload = settings.model_dump()
    payload.update(
        {
            "starts_at": profile.starts_at,
            "closes_at": profile.closes_at,
            "anonymous": not profile.identified,
            "show_progress_bar": profile.show_progress,
            "show_progress": profile.show_progress,
        }
    )
    return SurveySettings.model_validate(payload)


def _project_profile_for_settings(
    profile: SurveyProjectProfile, settings: SurveySettings
) -> SurveyProjectProfile:
    payload = profile.model_dump()
    payload.update(
        {
            "starts_at": settings.starts_at,
            "closes_at": settings.closes_at,
            "identified": not settings.anonymous,
            "show_progress": settings.show_progress_bar,
        }
    )
    return SurveyProjectProfile.model_validate(payload)


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


def apply_public_availability(
    survey: PublicSurvey, now: datetime | None = None
) -> PublicSurvey:
    """Attach server-authoritative response-period state to a public view."""
    current = now or utcnow()
    available = survey.model_copy(deep=True)
    available.server_time = current
    if available.settings.starts_at and current < available.settings.starts_at:
        available.availability_status = "SCHEDULED"
    elif available.settings.closes_at and current >= available.settings.closes_at:
        available.availability_status = "CLOSED"
    else:
        available.availability_status = "OPEN"
    return available


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
