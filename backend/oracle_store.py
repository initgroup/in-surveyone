from __future__ import annotations

import hashlib
import json
import re
import secrets
import unicodedata
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any

from backend.config import Settings, get_settings
from backend.database import OraclePool, get_oracle_pool
from backend.database_helper import OracleCrud
from backend.errors import (
    AuthenticationError,
    ConflictError,
    DomainValidationError,
    NotFoundError,
)
from backend.memory_store import (
    REPORT_TIMEZONE,
    MemoryStore,
    UserRecord,
    _seed_templates,
    _skin_from_theme,
    apply_public_translation,
    new_id,
    submission_payload_hash,
    utcnow,
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
from backend.security import hash_password, new_session_token, session_token_hash, verify_password
from backend.security import validate_idempotency_key


def _json_dump(value: Any) -> str:
    if hasattr(value, "model_dump"):
        value = value.model_dump(by_alias=True, mode="json")
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _json_load(value: Any, default: Any) -> Any:
    if value is None or value == "":
        return default
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, (bytes, bytearray, memoryview)):
        value = bytes(value).decode("utf-8")
    return json.loads(str(value))


def _as_aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


class OracleStore(MemoryStore):
    """Oracle implementation of the same application repository contract.

    The inheritance is intentionally limited to pure validation/report helpers;
    this constructor does not create or read any in-process repository state.
    """

    def __init__(
        self,
        settings: Settings | None = None,
        pool: OraclePool | None = None,
        crud: OracleCrud | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.pool = pool or get_oracle_pool()
        self.crud = crud or OracleCrud()

    @staticmethod
    def _normalize_login(login_id: str) -> str:
        return login_id.strip().lower()

    @staticmethod
    def _guest_mode(value: Any) -> GuestMode | None:
        return GuestMode.DATABASE if str(value or "").upper() == "DB" else None

    def _user_from_row(self, row: dict[str, Any]) -> UserRecord:
        role = UserRole(str(row["role_code"]).upper())
        return UserRecord(
            id=str(row.get("user_id") or ""),
            tenant_id=str(row["tenant_id"]),
            login_id=str(row["login_id"]),
            name=str(row["user_name"]),
            email=str(row["email"]) if row.get("email") is not None else None,
            organization_name=str(row["tenant_name"]),
            password_hash=(
                str(row["password_hash"])
                if row.get("password_hash") is not None
                else None
            ),
            role=role,
            is_guest=str(row.get("guest_yn") or "N").upper() == "Y",
            guest_mode=self._guest_mode(row.get("guest_mode_code")),
            created_at=_as_aware(row.get("created_at")) or utcnow(),
            tenant_expires_at=_as_aware(row.get("tenant_expires_at")),
        )

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

    def _new_session(
        self,
        connection: Any,
        user: UserRecord,
        *,
        expires_at: datetime | None = None,
    ) -> tuple[str, AuthSessionView]:
        now = utcnow()
        expires_at = expires_at or now + timedelta(
            seconds=self.settings.session_ttl_seconds
        )
        token = new_session_token()
        self.crud.execute(
            connection,
            "AUTH_SESSION_INSERT",
            {
                "sessionTokenHash": session_token_hash(
                    token, self.settings.session_secret
                ),
                "userId": user.id,
                "expiresAt": expires_at,
            },
        )
        return token, AuthSessionView(user=self._user_view(user), expires_at=expires_at)

    def create_guest(
        self,
        display_name: str,
        mode: GuestMode = GuestMode.DATABASE,
    ) -> tuple[str, AuthSessionView]:
        if mode != GuestMode.DATABASE:
            raise DomainValidationError("OracleStore only creates database guests.")
        now = utcnow()
        expires_at = now + timedelta(hours=self.settings.guest_project_ttl_hours)
        suffix = secrets.token_hex(5)
        tenant_id = new_id("tenant")
        user_id = new_id("user")
        login_id = f"db-guest-{suffix}"
        tenant_name = f"DB 게스트 체험공간 {suffix.upper()}"
        with self.pool.transaction() as connection:
            self.crud.execute(
                connection,
                "AUTH_TENANT_INSERT",
                {
                    "tenantId": tenant_id,
                    "tenantName": tenant_name,
                    "tenantTypeCode": "DB_GUEST",
                    "expiresAt": expires_at,
                },
            )
            self.crud.execute(
                connection,
                "AUTH_USER_INSERT",
                {
                    "userId": user_id,
                    "tenantId": tenant_id,
                    "loginId": login_id,
                    "passwordHash": None,
                    "userName": display_name.strip() or "DB 게스트",
                    "email": None,
                    "roleCode": UserRole.GUEST.value,
                    "guestYn": "Y",
                    "guestModeCode": "DB",
                },
            )
            capability_rows = []
            for code, (allowed, limit_value) in {
                "SURVEY_CREATE": (True, self.settings.db_guest_max_projects),
                "SURVEY_QUESTION_COUNT": (
                    True,
                    self.settings.db_guest_max_questions,
                ),
                "RESPONSE_COLLECT": (True, self.settings.db_guest_max_responses),
                "SURVEY_PUBLISH": (True, None),
                "MULTILINGUAL": (True, None),
                "RAW_EXPORT": (True, None),
                "CUSTOM_REPORT": (False, None),
                "EXTERNAL_DELIVERY": (False, None),
            }.items():
                capability_rows.append(
                    {
                        "tenantId": tenant_id,
                        "userId": user_id,
                        "capabilityCode": code,
                        "allowedYn": "Y" if allowed else "N",
                        "limitValue": limit_value,
                        "expiresAt": expires_at,
                    }
                )
            self.crud.executemany(connection, "AUTH_GUEST_CAP_INSERT", capability_rows)
            user = UserRecord(
                id=user_id,
                tenant_id=tenant_id,
                login_id=login_id,
                name=display_name.strip() or "DB 게스트",
                email=None,
                organization_name=tenant_name,
                password_hash=None,
                role=UserRole.GUEST,
                is_guest=True,
                guest_mode=GuestMode.DATABASE,
                created_at=now,
                tenant_expires_at=expires_at,
            )
            return self._new_session(connection, user, expires_at=expires_at)

    def signup(self, request: SignupRequest) -> tuple[str, AuthSessionView]:
        login_id = self._normalize_login(request.login_id)
        with self.pool.transaction() as connection:
            if self.crud.fetch_one(connection, "AUTH_USER_BY_LOGIN", {"loginId": login_id}):
                raise ConflictError("이미 사용 중인 아이디입니다.")
            tenant_id = new_id("tenant")
            user_id = new_id("user")
            self.crud.execute(
                connection,
                "AUTH_TENANT_INSERT",
                {
                    "tenantId": tenant_id,
                    "tenantName": request.organization_name,
                    "tenantTypeCode": "MEMBER",
                    "expiresAt": None,
                },
            )
            self.crud.execute(
                connection,
                "AUTH_USER_INSERT",
                {
                    "userId": user_id,
                    "tenantId": tenant_id,
                    "loginId": login_id,
                    "passwordHash": hash_password(request.password),
                    "userName": request.name,
                    "email": request.email,
                    "roleCode": UserRole.OWNER.value,
                    "guestYn": "N",
                    "guestModeCode": "NONE",
                },
            )
            user = UserRecord(
                id=user_id,
                tenant_id=tenant_id,
                login_id=login_id,
                name=request.name,
                email=request.email,
                organization_name=request.organization_name,
                password_hash=None,
                role=UserRole.OWNER,
                is_guest=False,
                guest_mode=None,
                created_at=utcnow(),
                tenant_expires_at=None,
            )
            return self._new_session(connection, user)

    def login(self, request: LoginRequest) -> tuple[str, AuthSessionView]:
        with self.pool.transaction() as connection:
            row = self.crud.fetch_one(
                connection,
                "AUTH_USER_BY_LOGIN",
                {"loginId": self._normalize_login(request.login_id)},
            )
            if row is None or str(row.get("guest_yn") or "N") == "Y" or not verify_password(
                request.password, str(row.get("password_hash") or "")
            ):
                raise AuthenticationError("아이디 또는 비밀번호가 올바르지 않습니다.")
            user = self._user_from_row(row)
            return self._new_session(connection, user)

    def _session_row(self, raw_token: str | None) -> dict[str, Any]:
        if not raw_token:
            raise AuthenticationError("로그인 세션이 필요합니다.")
        with self.pool.connection() as connection:
            row = self.crud.fetch_one(
                connection,
                "AUTH_SESSION_SELECT",
                {
                    "sessionTokenHash": session_token_hash(
                        raw_token, self.settings.session_secret
                    )
                },
            )
        if row is None:
            raise AuthenticationError("로그인 세션이 유효하지 않거나 만료되었습니다.")
        return row

    def authenticate(self, raw_token: str | None) -> UserRecord:
        return self._user_from_row(self._session_row(raw_token))

    def auth_session(self, raw_token: str | None) -> AuthSessionView:
        row = self._session_row(raw_token)
        return AuthSessionView(
            user=self._user_view(self._user_from_row(row)),
            expires_at=_as_aware(row["expires_at"]) or utcnow(),
        )

    def logout(self, raw_token: str | None) -> None:
        if not raw_token:
            return
        with self.pool.transaction() as connection:
            self.crud.execute(
                connection,
                "AUTH_SESSION_REVOKE",
                {
                    "sessionTokenHash": session_token_hash(
                        raw_token, self.settings.session_secret
                    )
                },
            )

    def _seed_templates_if_empty(self, connection: Any) -> None:
        existing_rows = self.crud.fetch_all(connection, "TEMPLATE_LIST")
        seed_templates = {template.code: template for template in _seed_templates()}

        for row in existing_rows:
            template_code = str(row.get("template_code") or "")
            try:
                _json_load(row.get("content_json"), {})
            except (json.JSONDecodeError, TypeError, ValueError) as exc:
                template = seed_templates.get(template_code)
                if template is None:
                    raise RuntimeError(
                        f"Template CONTENT_JSON is invalid: {template_code}"
                    ) from exc
                self.crud.execute(
                    connection,
                    "TEMPLATE_REPAIR",
                    {
                        "templateCode": template.code,
                        "templateTitle": template.title,
                        "categoryCode": template.category,
                        "description": template.description,
                        "contentJson": template.model_dump_json(by_alias=True),
                    },
                )

        self.crud.executemany(
            connection,
            "TEMPLATE_MERGE",
            [
                {
                    "templateCode": template.code,
                    "templateTitle": template.title,
                    "categoryCode": template.category,
                    "description": template.description,
                    "contentJson": template.model_dump_json(by_alias=True),
                }
                for template in seed_templates.values()
            ],
        )

    @staticmethod
    def _template_from_row(row: dict[str, Any]) -> SurveyTemplate:
        payload = _json_load(row.get("content_json"), {})
        payload.setdefault("code", str(row["template_code"]))
        payload.setdefault("title", str(row["template_title"]))
        payload.setdefault("category", str(row["category_code"]))
        payload.setdefault("description", str(row.get("description") or ""))
        return SurveyTemplate.model_validate(payload)

    def templates(self) -> list[SurveyTemplate]:
        with self.pool.transaction() as connection:
            self._seed_templates_if_empty(connection)
            rows = self.crud.fetch_all(connection, "TEMPLATE_LIST")
        return [self._template_from_row(row) for row in rows]

    def template(self, code: str) -> SurveyTemplate:
        with self.pool.transaction() as connection:
            self._seed_templates_if_empty(connection)
            row = self.crud.fetch_one(
                connection, "TEMPLATE_DETAIL", {"templateCode": code}
            )
        if row is None:
            raise NotFoundError("설문 템플릿을 찾을 수 없습니다.")
        return self._template_from_row(row)

    @staticmethod
    def _draft_json(
        *,
        sections: list[SurveySection],
        settings: SurveySettings,
        theme: SurveyTheme,
        skin: dict[str, Any],
        logic_rules: list[dict[str, Any]],
        languages: SurveyLanguages,
        translations: dict[str, SurveyTranslation],
    ) -> str:
        return _json_dump(
            {
                "sections": [item.model_dump(by_alias=True, mode="json") for item in sections],
                "settings": settings.model_dump(by_alias=True, mode="json"),
                "theme": theme.model_dump(by_alias=True, mode="json"),
                "skin": skin,
                "logicRules": logic_rules,
                "languages": languages.model_dump(by_alias=True, mode="json"),
                "defaultLocale": languages.default_locale,
                "supportedLocales": languages.enabled,
                "translations": {
                    key: value.model_dump(by_alias=True, mode="json")
                    for key, value in translations.items()
                },
            }
        )

    @staticmethod
    def _summary_from_row(row: dict[str, Any]) -> SurveySummary:
        draft = _json_load(row.get("draft_json"), {})
        question_count = sum(
            len(section.get("questions") or []) for section in draft.get("sections") or []
        )
        slug = str(row["public_slug"]) if row.get("public_slug") else None
        return SurveySummary(
            id=str(row["survey_id"]),
            title=str(row["survey_title"]),
            category=str(row["category_code"]),
            status=SurveyStatus(str(row["status_code"]).lower()),
            response_count=int(row.get("response_count") or 0),
            question_count=question_count,
            published_version=(
                int(row["active_version_no"])
                if row.get("active_version_no") is not None
                else None
            ),
            slug=slug,
            public_url=f"/s/{slug}" if slug else None,
            created_at=_as_aware(row.get("created_at")) or utcnow(),
            updated_at=_as_aware(row.get("updated_at")) or utcnow(),
            published_at=_as_aware(row.get("published_at")),
        )

    @classmethod
    def _detail_from_row(cls, row: dict[str, Any]) -> SurveyDetail:
        draft = _json_load(row.get("draft_json"), {})
        languages = SurveyLanguages.model_validate(draft.get("languages") or {})
        translations = {
            key: SurveyTranslation.model_validate(value)
            for key, value in (draft.get("translations") or {}).items()
        }
        summary = cls._summary_from_row(row)
        return SurveyDetail(
            **summary.model_dump(),
            description=(
                str(row["description"]) if row.get("description") is not None else None
            ),
            template_code=(
                str(row["template_code"]) if row.get("template_code") else None
            ),
            revision=int(row["revision_no"]),
            sections=[SurveySection.model_validate(item) for item in draft.get("sections") or []],
            settings=SurveySettings.model_validate(draft.get("settings") or {}),
            theme=SurveyTheme.model_validate(draft.get("theme") or {}),
            skin=dict(draft.get("skin") or {}),
            logic_rules=[dict(item) for item in draft.get("logicRules") or []],
            languages=languages,
            default_locale=languages.default_locale,
            supported_locales=list(languages.enabled),
            translations=translations,
        )

    def create_survey(self, user: UserRecord, request: SurveyCreateRequest) -> SurveyDetail:
        template = self.template(request.template_code or request.template_id) if (
            request.template_code or request.template_id
        ) else None
        title = request.title or (f"{template.title} 복사본" if template else None)
        if not title:
            raise DomainValidationError("설문 제목을 입력해 주세요.")
        sections = (
            [item.model_copy(deep=True) for item in request.sections]
            if request.sections is not None
            else [SurveySection(title="설문 문항", questions=[item.model_copy(deep=True) for item in request.questions])]
            if request.questions is not None
            else [item.model_copy(deep=True) for item in template.sections]
            if template
            else [SurveySection(title="설문 문항", questions=[])]
        )
        self._validate_global_question_ids(sections)
        languages = (
            request.languages.model_copy(deep=True)
            if "languages" in request.model_fields_set
            else template.languages.model_copy(deep=True)
            if template
            else SurveyLanguages()
        )
        translations = (
            {key: value.model_copy(deep=True) for key, value in request.translations.items()}
            if "translations" in request.model_fields_set
            else {key: value.model_copy(deep=True) for key, value in template.translations.items()}
            if template
            else {}
        )
        settings = request.settings or (template.settings if template else SurveySettings())
        theme = request.theme or (template.theme if template else SurveyTheme())
        skin = dict(request.skin) if request.skin is not None else _skin_from_theme(theme)
        survey_id = new_id("survey")
        draft_json = self._draft_json(
            sections=sections,
            settings=settings,
            theme=theme,
            skin=skin,
            logic_rules=[dict(item) for item in request.logic_rules],
            languages=languages,
            translations=translations,
        )
        with self.pool.transaction() as connection:
            if user.guest_mode == GuestMode.DATABASE:
                locked_tenant = self.crud.fetch_one(
                    connection,
                    "SURVEY_DB_GUEST_TENANT_LOCK",
                    {"tenantId": user.tenant_id},
                )
                if locked_tenant is None:
                    raise ConflictError("DB guest workspace is unavailable or expired.")
                project_count = self.crud.fetch_one(
                    connection,
                    "SURVEY_COUNT_BY_TENANT",
                    {"tenantId": user.tenant_id},
                )
                if int(project_count["project_count"] or 0) >= self.settings.db_guest_max_projects:
                    raise DomainValidationError(
                        "DB guest project limit has been reached."
                    )
                if sum(len(section.questions) for section in sections) > self.settings.db_guest_max_questions:
                    raise DomainValidationError(
                        "DB guest question limit has been exceeded."
                    )
            self.crud.execute(
                connection,
                "SURVEY_INSERT",
                {
                    "surveyId": survey_id,
                    "tenantId": user.tenant_id,
                    "ownerUserId": user.id,
                    "templateCode": template.code if template else None,
                    "surveyTitle": title,
                    "description": request.description if request.description is not None else template.description if template else None,
                    "categoryCode": request.category or (template.category if template else "일반조사"),
                    "draftJson": draft_json,
                },
            )
            self._sync_i18n(
                connection, user.tenant_id, survey_id, 0, languages, translations
            )
        return self.get_survey(user, survey_id)

    def list_surveys(
        self, user: UserRecord, status: SurveyStatus | None = None
    ) -> list[SurveySummary]:
        with self.pool.connection() as connection:
            rows = self.crud.fetch_all(
                connection,
                "SURVEY_LIST_BY_OWNER",
                {
                    "tenantId": user.tenant_id,
                    "ownerUserId": user.id,
                    "statusCode": status.value.upper() if status else None,
                },
            )
        return [self._summary_from_row(row) for row in rows]

    def _survey_row(
        self, connection: Any, user: UserRecord, survey_id: str, *, lock: bool = False
    ) -> dict[str, Any]:
        row = self.crud.fetch_one(
            connection,
            "SURVEY_DETAIL_FOR_UPDATE" if lock else "SURVEY_DETAIL_BY_OWNER",
            {
                "surveyId": survey_id,
                "tenantId": user.tenant_id,
                "ownerUserId": user.id,
            },
        )
        if row is None:
            raise NotFoundError("설문 프로젝트를 찾을 수 없습니다.")
        row.setdefault("response_count", 0)
        return row

    def get_survey(self, user: UserRecord, survey_id: str) -> SurveyDetail:
        with self.pool.connection() as connection:
            row = self._survey_row(connection, user, survey_id)
        return self._detail_from_row(row)

    def update_survey(
        self, user: UserRecord, survey_id: str, request: SurveyUpdateRequest
    ) -> SurveyDetail:
        with self.pool.transaction() as connection:
            row = self._survey_row(connection, user, survey_id, lock=True)
            detail = self._detail_from_row(row)
            self._validate_source_locale_promotion(detail, request)
            fields = request.model_fields_set
            title = request.title if "title" in fields and request.title is not None else detail.title
            description = request.description if "description" in fields else detail.description
            category = request.category if "category" in fields and request.category else detail.category
            if "questions" in fields and request.questions is not None:
                sections = [SurveySection(title="설문 문항", questions=request.questions)]
            elif "sections" in fields and request.sections is not None:
                sections = request.sections
            else:
                sections = detail.sections
            self._validate_global_question_ids(sections)
            if user.guest_mode == GuestMode.DATABASE and sum(
                len(section.questions) for section in sections
            ) > self.settings.db_guest_max_questions:
                raise DomainValidationError(
                    "DB guest question limit has been exceeded."
                )
            settings = request.settings if "settings" in fields and request.settings else detail.settings
            theme = request.theme if "theme" in fields and request.theme else detail.theme
            skin = dict(request.skin) if "skin" in fields and request.skin is not None else detail.skin
            if "theme" in fields and "skin" not in fields:
                skin = _skin_from_theme(theme)
            logic = request.logic_rules if "logic_rules" in fields and request.logic_rules is not None else detail.logic_rules
            languages = request.languages if "languages" in fields and request.languages else detail.languages
            if "languages" not in fields and ({"default_locale", "supported_locales"} & fields):
                enabled = request.supported_locales or detail.supported_locales
                default = request.default_locale or detail.default_locale
                languages = SurveyLanguages(
                    source_locale=detail.languages.source_locale if detail.languages.source_locale in enabled else default,
                    default_locale=default,
                    enabled=enabled,
                )
            translations = request.translations if "translations" in fields and request.translations is not None else detail.translations
            unsupported = set(translations) - set(languages.enabled)
            if unsupported:
                raise DomainValidationError("번역 언어는 languages.enabled에 포함되어야 합니다.")
            affected = self.crud.execute(
                connection,
                "SURVEY_UPDATE_BY_OWNER",
                {
                    "surveyId": survey_id,
                    "tenantId": user.tenant_id,
                    "ownerUserId": user.id,
                    "surveyTitle": title,
                    "description": description,
                    "categoryCode": category,
                    "draftJson": self._draft_json(
                        sections=sections,
                        settings=settings,
                        theme=theme,
                        skin=skin,
                        logic_rules=logic,
                        languages=languages,
                        translations=translations,
                    ),
                },
            )
            if affected != 1:
                raise ConflictError("설문 수정 중 소유권 또는 상태가 변경되었습니다.")
            self._sync_i18n(
                connection, user.tenant_id, survey_id, 0, languages, translations
            )
        return self.get_survey(user, survey_id)

    @staticmethod
    def _slug_base(value: str, survey_id: str) -> str:
        normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
        base = re.sub(r"[^a-z0-9]+", "-", normalized.lower()).strip("-")
        if len(base) < 3:
            base = f"survey-{survey_id.split('_')[-1][:8]}"
        return base[:70].rstrip("-")

    def _unique_slug(self, connection: Any, value: str, survey_id: str) -> str:
        base = self._slug_base(value, survey_id)
        candidate = base
        sequence = 2
        while True:
            row = self.crud.fetch_one(
                connection, "SURVEY_SLUG_OWNER", {"publicSlug": candidate}
            )
            if row is None or str(row["survey_id"]) == survey_id:
                return candidate
            suffix = f"-{sequence}"
            candidate = f"{base[: 80 - len(suffix)]}{suffix}"
            sequence += 1

    def publish(
        self, user: UserRecord, survey_id: str, request: PublishRequest
    ) -> PublishResult:
        with self.pool.transaction() as connection:
            row = self._survey_row(connection, user, survey_id, lock=True)
            detail = self._detail_from_row(row)
            if not any(
                question.type.value != "text"
                for section in detail.sections
                for question in section.questions
            ):
                raise DomainValidationError("배포하려면 응답 가능한 문항이 필요합니다.")
            existing_slug = str(row["public_slug"]) if row.get("public_slug") else None
            reserved_prefix = "local-guest-"
            if existing_slug and existing_slug.startswith(reserved_prefix):
                raise ConflictError(
                    "Persistent surveys cannot use the local guest URL namespace."
                )
            if request.slug and request.slug.startswith(reserved_prefix):
                raise DomainValidationError(
                    "The local-guest- URL namespace is reserved for local guest surveys."
                )
            if existing_slug and request.slug and request.slug != existing_slug:
                raise ConflictError("배포된 설문의 URL 식별자는 변경할 수 없습니다.")
            slug = existing_slug or self._unique_slug(
                connection, request.slug or detail.title, survey_id
            )
            if slug.startswith(reserved_prefix):
                slug = self._unique_slug(
                    connection,
                    f"persistent-{survey_id.split('_')[-1][:12]}",
                    survey_id,
                )
            version_row = self.crud.fetch_one(
                connection,
                "SURVEY_VERSION_NEXT",
                {"tenantId": user.tenant_id, "surveyId": survey_id},
            )
            version = int(version_row["version_no"])
            published_at = utcnow()
            public = PublicSurvey(
                survey_id=survey_id,
                slug=slug,
                version=version,
                title=detail.title,
                description=detail.description,
                category=detail.category,
                sections=detail.sections,
                settings=detail.settings,
                theme=detail.theme,
                skin=detail.skin,
                logic_rules=detail.logic_rules,
                languages=detail.languages,
                default_locale=detail.default_locale,
                supported_locales=detail.supported_locales,
                translations=detail.translations,
                published_at=published_at,
                guest_demo=user.guest_mode == GuestMode.DATABASE,
                experience_expires_at=(
                    user.tenant_expires_at
                    if user.guest_mode == GuestMode.DATABASE
                    else None
                ),
            )
            snapshot = public.model_dump_json(by_alias=True)
            content_hash = hashlib.sha256(snapshot.encode("utf-8")).hexdigest()
            self.crud.execute(
                connection,
                "SURVEY_VERSION_INSERT",
                {
                    "surveyId": survey_id,
                    "versionNo": version,
                    "snapshotJson": snapshot,
                    "contentHash": content_hash,
                    "publishedBy": user.id,
                    "publishedAt": published_at,
                    "tenantId": user.tenant_id,
                },
            )
            affected = self.crud.execute(
                connection,
                "SURVEY_MARK_PUBLISHED_BY_OWNER",
                {
                    "surveyId": survey_id,
                    "tenantId": user.tenant_id,
                    "ownerUserId": user.id,
                    "publicSlug": slug,
                    "versionNo": version,
                    "publishedAt": published_at,
                },
            )
            if affected != 1:
                raise ConflictError("설문 배포 중 소유권 또는 상태가 변경되었습니다.")
            self.crud.execute(
                connection,
                "SURVEY_DEPLOYMENT_MERGE",
                {
                    "deploymentId": new_id("deploy"),
                    "tenantId": user.tenant_id,
                    "surveyId": survey_id,
                    "versionNo": version,
                    "publicSlug": slug,
                    "responsePolicyJson": _json_dump(detail.settings),
                    "skinSnapshotJson": _json_dump(detail.skin),
                    "createdBy": user.id,
                    "publishedAt": published_at,
                },
            )
            self._sync_i18n(
                connection,
                user.tenant_id,
                survey_id,
                version,
                detail.languages,
                detail.translations,
            )
        return PublishResult(
            survey_id=survey_id,
            slug=slug,
            version=version,
            public_url=f"/s/{slug}",
            content_hash=content_hash,
            published_at=published_at,
        )

    def _public_row(self, slug: str) -> dict[str, Any]:
        with self.pool.connection() as connection:
            row = self.crud.fetch_one(
                connection, "SURVEY_PUBLIC_BY_SLUG", {"publicSlug": slug}
            )
        if row is None:
            raise NotFoundError("공개 설문을 찾을 수 없습니다.")
        return row

    @staticmethod
    def _public_from_row(row: dict[str, Any]) -> PublicSurvey:
        public = PublicSurvey.model_validate_json(row["snapshot_json"])
        is_guest = str(row.get("tenant_type_code") or "MEMBER").upper() == "DB_GUEST"
        public.guest_demo = is_guest
        public.experience_expires_at = (
            _as_aware(row.get("tenant_expires_at")) if is_guest else None
        )
        return public

    def public_survey(self, slug: str, language: str | None = None) -> PublicSurvey:
        public = self._public_from_row(self._public_row(slug))
        return apply_public_translation(public, language)

    def submit_response(
        self,
        slug: str,
        request: SubmitResponseRequest,
        *,
        idempotency_key: str | None = None,
    ) -> ResponseReceipt:
        row = self._public_row(slug)
        public = self._public_from_row(row)
        now = utcnow()
        if public.settings.one_response_per_respondent and not request.respondent_key:
            raise DomainValidationError(
                "This survey requires a stable respondentKey to enforce one response."
            )
        answers = self._validate_answers(public, request.answers)
        try:
            validated_key = validate_idempotency_key(idempotency_key)
        except ValueError as exc:
            raise DomainValidationError(str(exc)) from exc
        respondent_hash = (
            session_token_hash(request.respondent_key, self.settings.session_secret)
            if request.respondent_key
            else None
        )
        idempotency_hash = (
            session_token_hash(validated_key, self.settings.session_secret)
            if validated_key
            else None
        )
        payload_hash = submission_payload_hash(public, answers, request)
        response_id = new_id("response")
        tenant_id = str(row["tenant_id"])
        with self.pool.transaction() as connection:
            if public.guest_demo or idempotency_hash or (
                public.settings.one_response_per_respondent and respondent_hash
            ):
                locked_survey = self.crud.fetch_one(
                    connection,
                    "RESPONSE_SURVEY_LOCK",
                    {
                        "tenantId": tenant_id,
                        "surveyId": public.survey_id,
                    },
                )
                if locked_survey is None:
                    raise ConflictError("설문 공개 상태가 변경되었습니다.")
                if int(locked_survey["active_version_no"]) != public.version:
                    raise ConflictError(
                        "설문 버전이 변경되었습니다. 새로고침 후 다시 제출해 주세요."
                    )

            if idempotency_hash:
                existing = self.crud.fetch_one(
                    connection,
                    "RESPONSE_BY_IDEMPOTENCY",
                    {
                        "tenantId": tenant_id,
                        "surveyId": public.survey_id,
                        "idempotencyKeyHash": idempotency_hash,
                    },
                )
                if existing is not None:
                    if str(existing.get("request_payload_hash") or "") != payload_hash:
                        raise ConflictError(
                            "Idempotency-Key was already used with a different payload."
                        )
                    return ResponseReceipt(
                        response_id=str(existing["response_id"]),
                        survey_id=public.survey_id,
                        survey_version=int(existing["survey_version_no"]),
                        submitted_at=_as_aware(existing.get("submitted_at")) or now,
                        message=public.settings.confirmation_message,
                    )

            if public.settings.starts_at and now < public.settings.starts_at:
                raise ConflictError("아직 응답 기간이 시작되지 않았습니다.")
            if public.settings.closes_at and now > public.settings.closes_at:
                raise ConflictError("설문 응답 기간이 종료되었습니다.")

            if public.settings.one_response_per_respondent and respondent_hash:
                duplicate = self.crud.fetch_one(
                    connection,
                    "RESPONSE_DUPLICATE_COUNT",
                    {
                        "tenantId": tenant_id,
                        "surveyId": public.survey_id,
                        "surveyVersionNo": public.version,
                        "respondentKeyHash": respondent_hash,
                    },
                )
                if int(duplicate["duplicate_count"] or 0) > 0:
                    raise ConflictError("이미 이 설문에 응답했습니다.")
            if public.guest_demo:
                response_count = self.crud.fetch_one(
                    connection,
                    "RESPONSE_COUNT_BY_SURVEY",
                    {
                        "tenantId": tenant_id,
                        "surveyId": public.survey_id,
                    },
                )
                if int(response_count["response_count"] or 0) >= self.settings.db_guest_max_responses:
                    raise ConflictError("DB guest response limit has been reached.")
            self.crud.execute(
                connection,
                "RESPONSE_INSERT",
                {
                    "responseId": response_id,
                    "tenantId": tenant_id,
                    "surveyId": public.survey_id,
                    "surveyVersionNo": public.version,
                    "respondentKeyHash": respondent_hash,
                    "idempotencyKeyHash": idempotency_hash,
                    "requestPayloadHash": payload_hash if idempotency_hash else None,
                    "metadataJson": _json_dump(request.metadata),
                    "submittedAt": now,
                },
            )
            self.crud.executemany(
                connection,
                "RESPONSE_ANSWER_INSERT",
                [
                    {
                        "responseId": response_id,
                        "tenantId": tenant_id,
                        "questionId": answer.question_id,
                        "answerValueJson": _json_dump(answer.value),
                        "createdAt": now,
                    }
                    for answer in answers
                ],
            )
        return ResponseReceipt(
            response_id=response_id,
            survey_id=public.survey_id,
            survey_version=public.version,
            submitted_at=now,
            message=public.settings.confirmation_message,
        )

    def responses(
        self,
        user: UserRecord,
        survey_id: str,
        *,
        offset: int = 0,
        limit: int = 100,
    ) -> list[SurveyResponseView]:
        with self.pool.connection() as connection:
            self._survey_row(connection, user, survey_id)
            response_rows = self.crud.fetch_all(
                connection,
                "RESPONSE_LIST_BY_OWNER",
                {
                    "surveyId": survey_id,
                    "tenantId": user.tenant_id,
                    "ownerUserId": user.id,
                    "offset": offset,
                    "limit": limit,
                },
            )
            answer_rows = self.crud.fetch_all(
                connection,
                "RESPONSE_ANSWER_LIST_BY_OWNER",
                {
                    "surveyId": survey_id,
                    "tenantId": user.tenant_id,
                    "ownerUserId": user.id,
                    "offset": offset,
                    "limit": limit,
                },
            )
        answers: dict[str, list[AnswerItem]] = defaultdict(list)
        selected_ids = {str(row["response_id"]) for row in response_rows}
        for row in answer_rows:
            response_id = str(row["response_id"])
            if response_id in selected_ids:
                answers[response_id].append(
                    AnswerItem(
                        question_id=str(row["question_id"]),
                        value=_json_load(row.get("answer_value_json"), None),
                    )
                )
        return [
            SurveyResponseView(
                id=str(row["response_id"]),
                survey_id=str(row["survey_id"]),
                survey_version=int(row["survey_version_no"]),
                answers=answers[str(row["response_id"])],
                respondent_key=None,
                metadata=_json_load(row.get("metadata_json"), {}),
                submitted_at=_as_aware(row.get("submitted_at")) or utcnow(),
            )
            for row in response_rows
        ]

    def _published_snapshot(
        self, connection: Any, user: UserRecord, detail: SurveyDetail
    ) -> PublicSurvey | None:
        if detail.published_version is None:
            return None
        row = self.crud.fetch_one(
            connection,
            "SURVEY_VERSION_BY_NO",
            {
                "tenantId": user.tenant_id,
                "surveyId": detail.id,
                "versionNo": detail.published_version,
            },
        )
        return PublicSurvey.model_validate_json(row["snapshot_json"]) if row else None

    def report(
        self,
        user: UserRecord,
        survey_id: str,
        *,
        cutoff_date: date | None = None,
        response_status: str = "all",
    ) -> SurveyReport:
        normalized_status = response_status.strip().lower()
        if normalized_status not in {"all", "complete", "partial"}:
            raise DomainValidationError("응답 상태는 all, complete, partial 중 하나여야 합니다.")
        with self.pool.connection() as connection:
            row = self._survey_row(connection, user, survey_id)
            detail = self._detail_from_row(row)
            snapshot = self._published_snapshot(connection, user, detail)
            cutoff = (
                datetime.combine(
                    cutoff_date + timedelta(days=1),
                    datetime.min.time(),
                    tzinfo=REPORT_TIMEZONE,
                ).astimezone(timezone.utc)
                if cutoff_date
                else None
            )
            rows = (
                self.crud.fetch_all(
                    connection,
                    "RESPONSE_REPORT_LIST",
                    {
                        "surveyId": survey_id,
                        "tenantId": user.tenant_id,
                        "ownerUserId": user.id,
                        "surveyVersionNo": detail.published_version,
                        "cutoffExclusive": cutoff,
                    },
                )
                if snapshot is not None and normalized_status != "partial"
                else []
            )
        response_ids = {str(row["response_id"]) for row in rows}
        values: dict[str, list[Any]] = defaultdict(list)
        for item in rows:
            if item.get("question_id") is not None:
                values[str(item["question_id"])].append(
                    _json_load(item.get("answer_value_json"), None)
                )
        question_reports = [
            self._question_report(question, values.get(question.id, []))
            for section in (snapshot.sections if snapshot else detail.sections)
            for question in section.questions
            if question.type.value != "text"
        ]
        count = len(response_ids)
        return SurveyReport(
            survey_id=survey_id,
            title=snapshot.title if snapshot else detail.title,
            total_responses=count,
            completed_responses=count,
            partial_responses=0,
            completion_rate=1.0 if count else 0.0,
            published_version=detail.published_version,
            generated_at=utcnow(),
            questions=question_reports,
        )

    def dashboard(self, user: UserRecord) -> DashboardView:
        surveys = self.list_surveys(user)
        with self.pool.connection() as connection:
            row = self.crud.fetch_one(
                connection,
                "RESPONSE_TOTAL_BY_OWNER",
                {"tenantId": user.tenant_id, "ownerUserId": user.id},
            )
        return DashboardView(
            total_surveys=len(surveys),
            draft_surveys=sum(item.status == SurveyStatus.DRAFT for item in surveys),
            published_surveys=sum(item.status == SurveyStatus.PUBLISHED for item in surveys),
            closed_surveys=sum(item.status == SurveyStatus.CLOSED for item in surveys),
            total_responses=int(row["response_count"] or 0) if row else 0,
            recent_surveys=surveys[:5],
        )

    @staticmethod
    def _i18n_rows(
        tenant_id: str,
        survey_id: str,
        version: int,
        translations: dict[str, SurveyTranslation],
    ) -> list[dict[str, Any]]:
        values: dict[tuple[str, str, str, str], str] = {}

        def add(locale: str, kind: str, resource_id: str, field: str, text: str | None) -> None:
            # Oracle treats an empty string as NULL. An empty translation means
            # fallback to the source locale and must not hit TEXT_VALUE NOT NULL.
            if text is not None and text.strip():
                values[(locale, kind, resource_id, field)] = text

        for locale, translation in translations.items():
            add(locale, "SURVEY", survey_id, "TITLE", translation.title)
            add(locale, "SURVEY", survey_id, "DESCRIPTION", translation.description)
            add(locale, "SURVEY", survey_id, "CONFIRMATION", translation.confirmation_message)
            for section_id, text in translation.section_titles.items():
                add(locale, "SECTION", section_id, "TITLE", text)
            for section_id, text in translation.section_descriptions.items():
                add(locale, "SECTION", section_id, "DESCRIPTION", text)
            for question_id, text in translation.question_titles.items():
                add(locale, "QUESTION", question_id, "TITLE", text)
            for question_id, text in translation.question_descriptions.items():
                add(locale, "QUESTION", question_id, "DESCRIPTION", text)
            for question_id, options in translation.option_labels.items():
                for option_id, text in options.items():
                    add(locale, "OPTION", f"{question_id}:{option_id}", "LABEL", text)
            for section_id, section in translation.sections.items():
                add(locale, "SECTION", section_id, "TITLE", section.title)
                add(locale, "SECTION", section_id, "DESCRIPTION", section.description)
                for question_id, question in section.questions.items():
                    add(locale, "QUESTION", question_id, "TITLE", question.title)
                    add(locale, "QUESTION", question_id, "DESCRIPTION", question.description)
                    for option_id, text in question.options.items():
                        add(locale, "OPTION", f"{question_id}:{option_id}", "LABEL", text)
                    for row_id, text in question.rows.items():
                        add(
                            locale,
                            "OPTION",
                            f"{question_id}:row:{row_id}",
                            "ROW_LABEL",
                            text,
                        )
                    for column_id, text in question.columns.items():
                        add(
                            locale,
                            "OPTION",
                            f"{question_id}:column:{column_id}",
                            "COLUMN_LABEL",
                            text,
                        )
                    add(locale, "QUESTION", question_id, "MIN_LABEL", question.min_label)
                    add(locale, "QUESTION", question_id, "MAX_LABEL", question.max_label)
                    add(locale, "QUESTION", question_id, "UNIT", question.unit)
        return [
            {
                "tenantId": tenant_id,
                "surveyId": survey_id,
                "versionNo": version,
                "langCode": locale,
                "resourceTypeCode": kind,
                "resourceId": resource_id,
                "fieldCode": field,
                "textValue": text,
            }
            for (locale, kind, resource_id, field), text in values.items()
        ]

    def _sync_i18n(
        self,
        connection: Any,
        tenant_id: str,
        survey_id: str,
        version: int,
        languages: SurveyLanguages,
        translations: dict[str, SurveyTranslation],
    ) -> None:
        self.crud.executemany(
            connection,
            "LANGUAGE_MERGE",
            [
                {
                    "langCode": locale,
                    "langName": {
                        "ko": "Korean",
                        "en": "English",
                        "ja": "Japanese",
                        "zh-CN": "Chinese (Simplified)",
                    }.get(locale, locale),
                    "nativeName": {
                        "ko": "한국어",
                        "en": "English",
                        "ja": "日本語",
                        "zh-CN": "简体中文",
                    }.get(locale, locale),
                    "directionCode": (
                        "RTL"
                        if locale.split("-")[0] in {"ar", "he", "fa", "ur"}
                        else "LTR"
                    ),
                }
                for locale in languages.enabled
            ],
        )
        if version == 0:
            self.crud.execute(
                connection,
                "SURVEY_LANG_DELETE",
                {"tenantId": tenant_id, "surveyId": survey_id},
            )
            self.crud.executemany(
                connection,
                "SURVEY_LANG_INSERT",
                [
                    {
                        "tenantId": tenant_id,
                        "surveyId": survey_id,
                        "langCode": locale,
                        "defaultYn": "Y" if locale == languages.default_locale else "N",
                    }
                    for locale in languages.enabled
                ],
            )
        self.crud.execute(
            connection,
            "SURVEY_I18N_DELETE_VERSION",
            {"tenantId": tenant_id, "surveyId": survey_id, "versionNo": version},
        )
        self.crud.executemany(
            connection,
            "SURVEY_I18N_INSERT",
            self._i18n_rows(tenant_id, survey_id, version, translations),
        )

    def page_help(self, menu_id: str, language: str) -> dict[str, Any]:
        normalized_menu = menu_id.strip().upper()
        if not re.fullmatch(r"M\d{5}", normalized_menu):
            raise DomainValidationError("menuId must use the M01001 format.")
        try:
            locale = _normalize_locale(language)
        except ValueError as exc:
            raise DomainValidationError("lang must be a valid BCP 47 locale.") from exc
        with self.pool.connection() as connection:
            row = self.crud.fetch_one(
                connection,
                "PAGE_HELP_SELECT",
                {"menuId": normalized_menu, "langCode": locale},
            )
        if row is None:
            raise NotFoundError("페이지 도움말을 찾을 수 없습니다.")
        return {
            "menuId": str(row["menu_id"]),
            "language": str(row["lang_code"]),
            "title": str(row["help_title"]),
            "body": str(row["help_body"]),
            "guide": _json_load(row.get("guide_json"), {}),
        }

    def readiness(self) -> tuple[bool, str | None]:
        try:
            self.pool.ping()
            with self.pool.connection() as connection:
                row = self.crud.fetch_one(connection, "AUTH_SCHEMA_READY")
            expected = {
                "table_count": 20,
                "critical_column_count": 9,
                "critical_constraint_count": 6,
                "valid_function_count": 2,
            }
            actual = {
                key: int(row.get(key) or 0) if row else 0 for key in expected
            }
            if actual != expected:
                return (
                    False,
                    "Oracle schema is incomplete or incompatible. "
                    "Run SURVEYONE_SYSTEM_DDL.sql or SURVEYONE_SYSTEM_ALT.sql.",
                )
            return True, None
        except Exception as exc:
            return False, f"Oracle connection is unavailable ({type(exc).__name__})."
