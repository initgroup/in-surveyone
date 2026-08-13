from __future__ import annotations

import hashlib
import json
import logging
import re
import unicodedata
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any

from backend.config import Settings, get_settings
from backend.database import OraclePool, get_oracle_pool
from backend.database_helper import OracleCrud
from backend.delivery_security import (
    contact_hash,
    decrypt_contact,
    encrypt_contact,
    is_masked_contact,
    mask_contact,
)
from backend.errors import (
    AuthenticationError,
    ConflictError,
    DomainValidationError,
    NotFoundError,
    ServiceUnavailableError,
)
from backend.memory_store import (
    MemoryStore,
    UserRecord,
    _project_profile_for_settings,
    _seed_templates,
    _settings_for_project_profile,
    _skin_from_theme,
    apply_public_translation,
    new_id,
    report_cutoff_exclusive,
    submission_payload_hash,
    utcnow,
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
    DashboardView,
    DeliveryChannel,
    DeliveryChannelResult,
    DeploymentDraftRequest,
    DeploymentDraftView,
    DeploymentExecuteResult,
    DeploymentExecutionView,
    GuestMode,
    GuestCredentialView,
    GuestProvisionView,
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
    validate_publish_ready_sections,
)
from backend.security import (
    hash_password,
    new_initial_password,
    new_session_token,
    session_token_hash,
    verify_password,
)
from backend.security import validate_idempotency_key


logger = logging.getLogger(__name__)


def _json_dump(value: Any) -> str:
    if hasattr(value, "model_dump"):
        value = value.model_dump(by_alias=True, mode="json")
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _json_load(value: Any, default: Any) -> Any:
    if value is None or value == "":
        return default
    if isinstance(value, (dict, list, bool, int, float)):
        return value
    if isinstance(value, (bytes, bytearray, memoryview)):
        value = bytes(value).decode("utf-8")
    try:
        return json.loads(str(value))
    except json.JSONDecodeError:
        if default is None and isinstance(value, str):
            # Oracle native JSON columns return scalar JSON strings without
            # the quotes present in textual CLOB JSON.
            return value
        raise


def _as_aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _oracle_error_code(exc: Exception) -> int | None:
    if exc.args:
        code = getattr(exc.args[0], "code", None)
        if isinstance(code, int):
            return code
    match = re.search(r"ORA-(\d{5})", str(exc))
    return int(match.group(1)) if match else None


def _public_snapshot(value: Any) -> PublicSurvey:
    try:
        return PublicSurvey.model_validate(_json_load(value, {}))
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        raise ServiceUnavailableError(
            "배포된 설문 데이터 형식을 확인할 수 없습니다. 관리자에게 문의해 주세요."
        ) from exc


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
            guest_mode=(
                GuestMode.DATABASE
                if str(row.get("guest_mode_code") or "").upper() == "DB"
                else None
            ),
            created_at=_as_aware(row.get("created_at")) or utcnow(),
            tenant_expires_at=_as_aware(row.get("tenant_expires_at")),
            system_admin=str(row.get("system_admin_yn") or "N").upper() == "Y",
            active=str(row.get("user_use_yn") or row.get("use_yn") or "Y").upper() == "Y",
            withdrawn_at=_as_aware(row.get("withdrawn_at")),
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
            system_admin=user.system_admin,
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
        session_expires_at = now + timedelta(
            seconds=self.settings.session_ttl_seconds
        )
        expires_at = (
            min(expires_at, session_expires_at)
            if expires_at is not None
            else session_expires_at
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
    ) -> GuestProvisionView:
        if mode != GuestMode.DATABASE:
            raise DomainValidationError("OracleStore only creates database guests.")
        now = utcnow()
        expires_at = now + timedelta(hours=self.settings.guest_project_ttl_hours)
        tenant_id = new_id("tenant")
        user_id = new_id("user")
        initial_password = new_initial_password()
        with self.pool.transaction() as connection:
            login_id = ""
            for _ in range(10_000):
                login_row = self.crud.fetch_one(connection, "AUTH_GUEST_LOGIN_NEXT")
                raw_sequence_value = (
                    login_row.get("login_sequence_value") if login_row else None
                )
                try:
                    sequence_value = int(raw_sequence_value)
                except (TypeError, ValueError, OverflowError):
                    raise ServiceUnavailableError(
                        "게스트 로그인 아이디를 발급할 수 없습니다."
                    )
                if sequence_value < 1:
                    raise ServiceUnavailableError(
                        "Oracle returned an invalid guest login sequence value."
                    )
                candidate = f"quest{sequence_value:03d}"
                if self.crud.fetch_one(
                    connection, "AUTH_LOGIN_ID_EXISTS", {"loginId": candidate}
                ) is None:
                    login_id = candidate
                    break
            if not login_id:
                raise ServiceUnavailableError(
                    "사용 가능한 게스트 로그인 아이디를 발급할 수 없습니다."
                )
            tenant_name = f"게스트 체험공간 {login_id.upper()}"
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
                    "passwordHash": hash_password(initial_password),
                    "userName": display_name.strip() or "게스트",
                    "email": None,
                    "roleCode": UserRole.GUEST.value,
                    "systemAdminYn": "N",
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
                name=display_name.strip() or "게스트",
                email=None,
                organization_name=tenant_name,
                password_hash=None,
                role=UserRole.GUEST,
                is_guest=True,
                guest_mode=GuestMode.DATABASE,
                created_at=now,
                tenant_expires_at=expires_at,
            )
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
        login_id = self._normalize_login(request.login_id)
        system_admin = self._system_admin_for_signup(request)
        with self.pool.transaction() as connection:
            if self.crud.fetch_one(
                connection, "AUTH_LOGIN_ID_EXISTS", {"loginId": login_id}
            ):
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
                    "systemAdminYn": "Y" if system_admin else "N",
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
                system_admin=system_admin,
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
            if row is None or not verify_password(
                request.password, str(row.get("password_hash") or "")
            ):
                raise AuthenticationError("아이디 또는 비밀번호가 올바르지 않습니다.")
            user = self._user_from_row(row)
            return self._new_session(
                connection,
                user,
                expires_at=user.tenant_expires_at if user.is_guest else None,
            )

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
        now = utcnow()
        if row.get("revoked_at") is not None:
            raise AuthenticationError("로그인 세션이 종료되었습니다.")
        session_expires_at = _as_aware(row.get("expires_at"))
        if session_expires_at is None or session_expires_at <= now:
            raise AuthenticationError("로그인 세션이 만료되었습니다.")
        if str(row.get("user_use_yn") or "N") != "Y":
            raise AuthenticationError("사용할 수 없는 로그인 계정입니다.")
        if str(row.get("tenant_status_code") or "") != "ACTIVE":
            raise AuthenticationError("사용할 수 없는 작업공간입니다.")
        tenant_expires_at = _as_aware(row.get("tenant_expires_at"))
        if tenant_expires_at is not None and tenant_expires_at <= now:
            raise AuthenticationError("게스트 작업공간이 만료되었습니다.")
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
        existing_rows = self.crud.fetch_all(
            connection, "TEMPLATE_CATALOG_CONTENT_LIST"
        )
        seed_templates = {template.code: template for template in _seed_templates()}

        for row in existing_rows:
            template_code = str(row.get("template_code") or "")
            try:
                _json_load(row.get("content_json"), {})
            except (json.JSONDecodeError, TypeError, ValueError) as exc:
                template = seed_templates.get(template_code)
                if template is None:
                    is_public = (
                        str(row.get("status_code") or "").upper() == "ACTIVE"
                        and str(row.get("use_yn") or "").upper() == "Y"
                    )
                    if is_public:
                        raise RuntimeError(
                            f"Template CONTENT_JSON is invalid: {template_code}"
                        ) from exc
                    logger.warning(
                        "Ignoring invalid JSON in inactive template catalog row: %s",
                        template_code,
                    )
                    continue
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
        # Hash the exact materialized CLOB copied into the immutable version.
        # STANDARD_HASH does not accept LOB values on every supported Oracle
        # release, so hashing belongs at the repository edge.
        version_rows = self.crud.fetch_all(connection, "TEMPLATE_VERSION_MISSING")
        for row in version_rows:
            raw_content = row.get("content_json")
            try:
                parsed_content = _json_load(raw_content, {})
            except (json.JSONDecodeError, TypeError, ValueError) as exc:
                raise RuntimeError(
                    f"Template CONTENT_JSON is invalid: {row.get('template_code')}"
                ) from exc
            if isinstance(raw_content, str):
                content_json = raw_content
            elif isinstance(raw_content, (bytes, bytearray, memoryview)):
                content_json = bytes(raw_content).decode("utf-8")
            else:
                # Oracle native JSON values are returned as Python dict/list
                # objects. str(dict) is Python syntax with single quotes, not
                # JSON, so normalize it explicitly for the immutable snapshot.
                content_json = _json_dump(parsed_content)
            self.crud.execute(
                connection,
                "TEMPLATE_VERSION_SEED",
                {
                    "templateCode": str(row["template_code"]),
                    "snapshotJson": content_json,
                    "contentHash": hashlib.sha256(
                        content_json.encode("utf-8")
                    ).hexdigest(),
                },
            )

    @staticmethod
    def _template_from_row(row: dict[str, Any]) -> SurveyTemplate:
        payload = _json_load(row.get("content_json"), {})
        # Catalog metadata is authoritative and can change without rewriting
        # an immutable structural snapshot/version row.
        payload["code"] = str(row["template_code"])
        payload["title"] = str(row["template_title"])
        payload["category"] = str(row["category_code"])
        payload["description"] = str(row.get("description") or "")
        payload["versionNo"] = int(row.get("current_version_no") or 1)
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
    def _require_system_admin(user: UserRecord) -> None:
        MemoryStore._require_system_admin(user)

    def _admin_template_view_from_row(
        self, row: dict[str, Any]
    ) -> AdminTemplateView:
        template = self._template_from_row(row)
        return AdminTemplateView(
            code=template.code,
            title=template.title,
            description=template.description,
            category=template.category,
            status=AdminTemplateStatus(str(row.get("status_code") or "active").lower()),
            version_no=int(row.get("current_version_no") or 1),
            source_survey_id=(
                str(row["source_survey_id"])
                if row.get("source_survey_id") is not None
                else None
            ),
            question_count=template.question_count,
            use_count=int(row.get("use_count") or 0),
            published_at=(
                _as_aware(row.get("current_published_at"))
                or _as_aware(row.get("updated_at"))
                or _as_aware(row.get("created_at"))
                or utcnow()
            ),
            updated_at=(
                _as_aware(row.get("updated_at"))
                or _as_aware(row.get("created_at"))
                or utcnow()
            ),
        )

    def admin_templates(self, user: UserRecord) -> list[AdminTemplateView]:
        self._require_system_admin(user)
        with self.pool.transaction() as connection:
            self._seed_templates_if_empty(connection)
            rows = self.crud.fetch_all(connection, "ADMIN_TEMPLATE_LIST")
            draft_rows = self.crud.fetch_all(
                connection,
                "ADMIN_TEMPLATE_ORPHAN_DRAFT_LIST",
                {"tenantId": user.tenant_id, "ownerUserId": user.id},
            )
        values = [self._admin_template_view_from_row(row) for row in rows]
        values.extend(self._admin_template_draft_view_from_row(row) for row in draft_rows)
        values.sort(key=lambda item: item.updated_at, reverse=True)
        return values

    @staticmethod
    def _admin_template_draft_view_from_row(
        row: dict[str, Any]
    ) -> AdminTemplateView:
        draft = _json_load(row.get("draft_json"), {})
        question_count = sum(
            len(section.get("questions") or [])
            for section in draft.get("sections") or []
        )
        survey_id = str(row["survey_id"])
        updated_at = _as_aware(row.get("updated_at")) or utcnow()
        return AdminTemplateView(
            code=f"draft:{survey_id}",
            title=str(row["survey_title"]),
            description=str(row.get("description") or ""),
            category=str(row.get("category_code") or "일반조사"),
            status=AdminTemplateStatus.DRAFT,
            version_no=0,
            source_survey_id=survey_id,
            draft_only=True,
            question_count=question_count,
            use_count=0,
            published_at=None,
            updated_at=updated_at,
        )

    @staticmethod
    def _admin_member_from_row(row: dict[str, Any]) -> AdminMemberView:
        return AdminMemberView(
            id=str(row["user_id"]),
            login_id=str(row["login_id"]),
            name=str(row["user_name"]),
            email=mask_contact("EMAIL", str(row["email"])) if row.get("email") is not None else None,
            tenant_id=str(row["tenant_id"]),
            organization_name=str(row["tenant_name"]),
            role=UserRole(str(row["role_code"]).upper()),
            system_admin=str(row.get("system_admin_yn") or "N").upper() == "Y",
            is_guest=str(row.get("guest_yn") or "N").upper() == "Y",
            guest_mode=(
                GuestMode.DATABASE
                if str(row.get("guest_mode_code") or "").upper() == "DB"
                else None
            ),
            active=str(row.get("use_yn") or "N").upper() == "Y",
            expires_at=_as_aware(row.get("tenant_expires_at")),
            withdrawn_at=_as_aware(row.get("withdrawn_at")),
            created_at=_as_aware(row.get("created_at")) or utcnow(),
            last_login_at=_as_aware(row.get("last_login_at")),
        )

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
        if normalized_type not in {"all", "member", "guest"}:
            raise DomainValidationError("회원 분류가 올바르지 않습니다.")
        params = {
            "queryPattern": f"%{normalized}%" if normalized else None,
            "memberType": normalized_type.upper(),
        }
        with self.pool.connection() as connection:
            count_row = self.crud.fetch_one(connection, "ADMIN_MEMBER_COUNT", params) or {"member_count": 0}
            rows = self.crud.fetch_all(
                connection,
                "ADMIN_MEMBER_PAGE",
                {
                    **params,
                    "offsetRows": (page - 1) * page_size,
                    "limitRows": page_size,
                },
            )
        total = int(count_row.get("member_count") or 0)
        return AdminMemberPage(
            items=[self._admin_member_from_row(row) for row in rows],
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
        temporary_password = self._temporary_password()
        with self.pool.transaction() as connection:
            member = self.crud.fetch_one(
                connection, "ADMIN_MEMBER_DETAIL_LOCK", {"userId": member_id}
            )
            if member is None:
                raise NotFoundError("회원 계정을 찾을 수 없습니다.")
            if member.get("withdrawn_at") is not None:
                raise DomainValidationError("이미 탈퇴한 계정은 비밀번호를 초기화할 수 없습니다.")
            affected = self.crud.execute(
                connection,
                "ADMIN_MEMBER_PASSWORD_RESET",
                {"userId": member_id, "passwordHash": hash_password(temporary_password)},
            )
            if affected != 1:
                raise ConflictError("비밀번호 초기화 중 계정 상태가 변경되었습니다.")
            self.crud.execute(
                connection, "ADMIN_MEMBER_SESSIONS_REVOKE", {"userId": member_id}
            )
        return AdminPasswordResetView(
            user_id=member_id,
            login_id=str(member["login_id"]),
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
        with self.pool.transaction() as connection:
            member = self.crud.fetch_one(
                connection, "ADMIN_MEMBER_DETAIL_LOCK", {"userId": member_id}
            )
            if member is None:
                raise NotFoundError("회원 계정을 찾을 수 없습니다.")
            if member.get("withdrawn_at") is not None:
                raise DomainValidationError("탈퇴한 계정의 이용 상태는 변경할 수 없습니다.")
            affected = self.crud.execute(
                connection,
                "ADMIN_MEMBER_STATUS_UPDATE",
                {"userId": member_id, "useYn": "Y" if request.active else "N"},
            )
            if affected != 1:
                raise ConflictError("회원 상태 변경 중 계정 정보가 변경되었습니다.")
            if not request.active:
                self.crud.execute(
                    connection, "ADMIN_MEMBER_SESSIONS_REVOKE", {"userId": member_id}
                )
            member["use_yn"] = "Y" if request.active else "N"
        return self._admin_member_from_row(member)

    def admin_withdraw_member(self, user: UserRecord, member_id: str) -> None:
        self._require_system_admin(user)
        if member_id == user.id:
            raise DomainValidationError("현재 로그인한 관리자 계정은 여기에서 탈퇴시킬 수 없습니다.")
        with self.pool.transaction() as connection:
            member = self.crud.fetch_one(
                connection, "ADMIN_MEMBER_DETAIL_LOCK", {"userId": member_id}
            )
            if member is None:
                raise NotFoundError("회원 계정을 찾을 수 없습니다.")
            if member.get("withdrawn_at") is not None:
                return
            affected = self.crud.execute(
                connection,
                "ADMIN_MEMBER_WITHDRAW",
                {
                    "userId": member_id,
                    "withdrawnLoginId": new_id("withdrawn"),
                },
            )
            if affected != 1:
                raise ConflictError("회원 탈퇴 처리 중 계정 정보가 변경되었습니다.")
            self.crud.execute(
                connection, "ADMIN_MEMBER_SESSIONS_REVOKE", {"userId": member_id}
            )
            self.crud.execute(
                connection,
                "ADMIN_MEMBER_TENANT_CLOSE",
                {
                    "tenantId": str(member["tenant_id"]),
                    "tenantName": "탈퇴 작업공간",
                },
            )

    def create_admin_template_draft(
        self,
        user: UserRecord,
        request: AdminTemplateDraftRequest,
    ) -> AdminTemplateDraftView:
        self._require_system_admin(user)
        template = None
        if request.template_code:
            # Administrators may reopen an archived template as a draft even
            # though the public template catalog intentionally hides it.
            with self.pool.transaction() as connection:
                self._seed_templates_if_empty(connection)
                row = self.crud.fetch_one(
                    connection,
                    "ADMIN_TEMPLATE_DETAIL_LOCK",
                    {"templateCode": request.template_code},
                )
                if row is None:
                    raise NotFoundError("공용 템플릿을 찾을 수 없습니다.")
                if str(row.get("status_code") or "").upper() == "DELETED":
                    raise NotFoundError("공용 템플릿을 찾을 수 없습니다.")
                source_survey_id = row.get("source_survey_id")
                if source_survey_id is not None:
                    try:
                        source_row = self._survey_row(
                            connection, user, str(source_survey_id)
                        )
                    except NotFoundError:
                        source_row = None
                    if (
                        source_row is not None
                        and str(source_row.get("admin_template_yn") or "N").upper()
                        == "Y"
                        and str(source_row.get("status_code") or "").upper()
                        == "DRAFT"
                    ):
                        current = self._detail_from_row(source_row)
                        return AdminTemplateDraftView(
                            survey_id=current.id,
                            source_survey_id=current.id,
                            template_code=request.template_code,
                            revision=current.revision,
                        )
                template = self._template_from_row(row)
        detail = self.create_survey(
            user,
            SurveyCreateRequest(
                title=request.title,
                description=template.description if template else None,
                category=template.category if template else "일반조사",
                sections=(
                    [section.model_copy(deep=True) for section in template.sections]
                    if template
                    else None
                ),
                settings=template.settings.model_copy(deep=True) if template else None,
                theme=template.theme.model_copy(deep=True) if template else None,
                skin=dict(template.skin) if template else None,
                logic_rules=[dict(rule) for rule in template.logic_rules] if template else [],
                languages=template.languages.model_copy(deep=True) if template else SurveyLanguages(),
                translations=(
                    {
                        locale: value.model_copy(deep=True)
                        for locale, value in template.translations.items()
                    }
                    if template
                    else {}
                ),
            ),
            admin_template=True,
        )
        if request.template_code:
            with self.pool.transaction() as connection:
                affected = self.crud.execute(
                    connection,
                    "ADMIN_TEMPLATE_DRAFT_LINK",
                    {
                        "templateCode": request.template_code,
                        "sourceSurveyId": detail.id,
                        "actorUserId": user.id,
                    },
                )
                if affected != 1:
                    raise ConflictError("공용 템플릿 편집 초안을 연결하지 못했습니다.")
        return AdminTemplateDraftView(
            survey_id=detail.id,
            source_survey_id=detail.id,
            template_code=request.template_code,
            revision=detail.revision,
        )

    def delete_admin_template_draft(
        self, user: UserRecord, survey_id: str
    ) -> None:
        self._require_system_admin(user)
        with self.pool.transaction() as connection:
            affected = self.crud.execute(
                connection,
                "ADMIN_TEMPLATE_DRAFT_DELETE",
                {
                    "surveyId": survey_id,
                    "tenantId": user.tenant_id,
                    "ownerUserId": user.id,
                },
            )
            if affected != 1:
                raise ConflictError(
                    "작성 중인 독립 공용 템플릿 초안을 찾을 수 없거나 삭제할 수 없습니다."
                )

    def publish_admin_template(
        self,
        user: UserRecord,
        code: str,
        request: AdminTemplatePublishRequest,
    ) -> AdminTemplateView:
        self._require_system_admin(user)
        normalized_code = code.strip().lower()
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{2,49}", normalized_code):
            raise DomainValidationError("템플릿 코드는 영문 소문자·숫자·하이픈으로 3~50자여야 합니다.")
        with self.pool.transaction() as connection:
            # Hold the source draft lock through validation and snapshot writes.
            # This prevents an editor update from racing template publication.
            source_row = self._survey_row(
                connection, user, request.source_survey_id, lock=True
            )
            source = self._detail_from_row(source_row)
            if source.status != SurveyStatus.DRAFT or source.published_version:
                raise ConflictError("작성 중인 관리자 초안만 공용 템플릿으로 등록할 수 있습니다.")
            if str(source_row.get("admin_template_yn") or "N").upper() != "Y":
                raise ConflictError("공용 템플릿 관리에서 만든 관리자 초안만 등록할 수 있습니다.")
            try:
                validate_publish_ready_sections(source.sections)
            except ValueError as exc:
                raise DomainValidationError(str(exc)) from exc
            current = self.crud.fetch_one(
                connection,
                "ADMIN_TEMPLATE_DETAIL_LOCK",
                {"templateCode": normalized_code},
            )
            version_no = int(current.get("current_version_no") or 0) + 1 if current else 1
            template = SurveyTemplate(
                code=normalized_code,
                title=request.title,
                description=request.description,
                category=request.category,
                sections=[section.model_copy(deep=True) for section in source.sections],
                settings=source.settings.model_copy(deep=True),
                theme=source.theme.model_copy(deep=True),
                skin=dict(source.skin),
                logic_rules=[dict(rule) for rule in source.logic_rules],
                languages=source.languages.model_copy(deep=True),
                translations={
                    locale: value.model_copy(deep=True)
                    for locale, value in source.translations.items()
                },
                version_no=version_no,
            )
            snapshot_json = template.model_dump_json(by_alias=True)
            content_hash = hashlib.sha256(snapshot_json.encode("utf-8")).hexdigest()
            upsert_parameters = {
                "templateCode": normalized_code,
                "templateTitle": template.title,
                "categoryCode": template.category,
                "description": template.description,
                "contentJson": snapshot_json,
                "versionNo": version_no,
                "sourceSurveyId": source.id,
                "actorUserId": user.id,
            }
            version_parameters = {
                "templateCode": normalized_code,
                "versionNo": version_no,
                "sourceSurveyId": source.id,
                "sourceSurveyRevision": source.revision,
                "publishedBy": user.id,
                "snapshotJson": snapshot_json,
                "contentHash": content_hash,
            }
            self.crud.execute(
                connection, "ADMIN_TEMPLATE_UPSERT", upsert_parameters
            )
            self.crud.execute(
                connection, "ADMIN_TEMPLATE_VERSION_INSERT", version_parameters
            )
            row = self.crud.fetch_one(
                connection,
                "ADMIN_TEMPLATE_DETAIL",
                {"templateCode": normalized_code},
            )
        if row is None:
            raise ServiceUnavailableError("등록한 공용 템플릿을 다시 읽을 수 없습니다.")
        return self._admin_template_view_from_row(row)

    def patch_admin_template(
        self,
        user: UserRecord,
        code: str,
        request: AdminTemplatePatchRequest,
    ) -> AdminTemplateView:
        self._require_system_admin(user)
        normalized_code = code.strip().lower()
        with self.pool.transaction() as connection:
            row = self.crud.fetch_one(
                connection,
                "ADMIN_TEMPLATE_DETAIL_LOCK",
                {"templateCode": normalized_code},
            )
            if row is None:
                raise NotFoundError("공용 템플릿을 찾을 수 없습니다.")
            if str(row.get("status_code") or "").upper() == "DELETED":
                raise NotFoundError("공용 템플릿을 찾을 수 없습니다.")
            updates = request.model_fields_set
            status_code = (
                request.status.value.upper()
                if "status" in updates and request.status is not None
                else None
            )
            self.crud.execute(
                connection,
                "ADMIN_TEMPLATE_PATCH",
                {
                    "templateCode": normalized_code,
                    "templateTitle": request.title if "title" in updates else None,
                    "categoryCode": request.category if "category" in updates else None,
                    "description": request.description if "description" in updates else None,
                    "descriptionSet": "Y" if "description" in updates else "N",
                    "statusCode": status_code,
                    "actorUserId": user.id,
                },
            )
            result = self.crud.fetch_one(
                connection,
                "ADMIN_TEMPLATE_DETAIL",
                {"templateCode": normalized_code},
            )
        if result is None:
            raise ServiceUnavailableError("수정한 공용 템플릿을 다시 읽을 수 없습니다.")
        return self._admin_template_view_from_row(result)

    def delete_admin_template(self, user: UserRecord, code: str) -> None:
        self._require_system_admin(user)
        normalized_code = code.strip().lower()
        with self.pool.transaction() as connection:
            row = self.crud.fetch_one(
                connection,
                "ADMIN_TEMPLATE_DETAIL_LOCK",
                {"templateCode": normalized_code},
            )
            if (
                row is None
                or str(row.get("status_code") or "").upper() == "DELETED"
            ):
                raise NotFoundError("공용 템플릿을 찾을 수 없습니다.")
            source_survey_id = row.get("source_survey_id")
            if source_survey_id is not None:
                self.crud.execute(
                    connection,
                    "ADMIN_TEMPLATE_SOURCE_DELETE",
                    {
                        "surveyId": str(source_survey_id),
                        "actorUserId": user.id,
                    },
                )
            affected = self.crud.execute(
                connection,
                "ADMIN_TEMPLATE_DELETE",
                {
                    "templateCode": normalized_code,
                    "actorUserId": user.id,
                },
            )
            if affected != 1:
                raise ConflictError("공용 템플릿 삭제 중 상태가 변경되었습니다.")

    @staticmethod
    def _draft_json(
        *,
        sections: list[SurveySection],
        settings: SurveySettings,
        theme: SurveyTheme,
        skin: dict[str, Any],
        project_profile: SurveyProjectProfile,
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
                "projectProfile": project_profile.model_dump(by_alias=True, mode="json"),
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
            template_version_no=(
                int(row["template_version_no"])
                if row.get("template_version_no") is not None
                else None
            ),
            revision=int(row["revision_no"]),
            sections=[SurveySection.model_validate(item) for item in draft.get("sections") or []],
            settings=SurveySettings.model_validate(draft.get("settings") or {}),
            theme=SurveyTheme.model_validate(draft.get("theme") or {}),
            skin=dict(draft.get("skin") or {}),
            project_profile=SurveyProjectProfile(
                starts_at=_as_aware(row.get("survey_start_at")),
                closes_at=_as_aware(row.get("survey_closes_at")),
                identified=str(row.get("identified_yn") or "N").upper() == "Y",
                show_progress=str(row.get("show_progress_yn") or "Y").upper() == "Y",
                target_audience=(
                    str(row["target_audience"])
                    if row.get("target_audience") is not None
                    else None
                ),
                population_mode=str(row.get("population_mode_code") or "UNKNOWN").lower(),
                population_size=(
                    int(row["population_size"])
                    if row.get("population_size") is not None
                    else None
                ),
                target_response_count=(
                    int(row["target_response_count"])
                    if row.get("target_response_count") is not None
                    else None
                ),
            ),
            logic_rules=[dict(item) for item in draft.get("logicRules") or []],
            languages=languages,
            default_locale=languages.default_locale,
            supported_locales=list(languages.enabled),
            translations=translations,
        )

    def create_survey(
        self,
        user: UserRecord,
        request: SurveyCreateRequest,
        *,
        admin_template: bool = False,
    ) -> SurveyDetail:
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
        self._validate_translation_targets(sections, translations)
        project_profile = request.project_profile.model_copy(deep=True)
        settings = _settings_for_project_profile(
            request.settings or (template.settings if template else SurveySettings()),
            project_profile,
        )
        theme = request.theme or (template.theme if template else SurveyTheme())
        skin = dict(request.skin) if request.skin is not None else _skin_from_theme(theme)
        survey_id = new_id("survey")
        draft_json = self._draft_json(
            sections=sections,
            settings=settings,
            theme=theme,
            skin=skin,
            project_profile=project_profile,
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
                    "templateVersionNo": template.version_no if template else None,
                    "surveyTitle": title,
                    "description": request.description if request.description is not None else template.description if template else None,
                    "categoryCode": request.category or (template.category if template else "일반조사"),
                    "surveyStartAt": project_profile.starts_at,
                    "surveyClosesAt": project_profile.closes_at,
                    "identifiedYn": "Y" if project_profile.identified else "N",
                    "showProgressYn": "Y" if project_profile.show_progress else "N",
                    "targetAudience": project_profile.target_audience,
                    "populationModeCode": project_profile.population_mode.value.upper(),
                    "populationSize": project_profile.population_size,
                    "targetResponseCount": project_profile.target_response_count,
                    "adminTemplateYn": "Y" if admin_template else "N",
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

    def survey_page(
        self,
        user: UserRecord,
        *,
        page: int,
        page_size: int,
        status: SurveyStatus | None = None,
        query: str = "",
        sort: str = "updated-desc",
    ) -> SurveyPage:
        normalized_query = query.strip().lower()
        params = {
            "tenantId": user.tenant_id,
            "ownerUserId": user.id,
            "statusCode": status.value.upper() if status else None,
            "queryPattern": f"%{normalized_query}%" if normalized_query else None,
        }
        with self.pool.connection() as connection:
            counts = self.crud.fetch_one(
                connection, "SURVEY_PAGE_COUNTS_BY_OWNER", params
            ) or {"filtered_count": 0, "total_count": 0}
            rows = self.crud.fetch_all(
                connection,
                "SURVEY_PAGE_BY_OWNER",
                {
                    **params,
                    "sortCode": sort,
                    "offsetRows": (page - 1) * page_size,
                    "limitRows": page_size,
                },
            )
        total = int(counts.get("filtered_count") or 0)
        return SurveyPage(
            items=[self._summary_from_row(row) for row in rows],
            page=page,
            page_size=page_size,
            total=total,
            total_all=int(counts.get("total_count") or 0),
            has_next=page * page_size < total,
        )

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

    def apply_template(
        self,
        user: UserRecord,
        survey_id: str,
        request: SurveyTemplateApplyRequest,
    ) -> SurveyDetail:
        template = self.template(request.template_code)
        with self.pool.transaction() as connection:
            row = self._survey_row(connection, user, survey_id, lock=True)
            detail = self._detail_from_row(row)
            if (
                request.expected_revision is not None
                and request.expected_revision != detail.revision
            ):
                raise ConflictError(
                    "다른 화면에서 프로젝트가 변경되었습니다. 최신 내용을 다시 불러온 뒤 템플릿을 선택해 주세요."
                )
            if detail.status != SurveyStatus.DRAFT or detail.published_version is not None:
                raise ConflictError(
                    "템플릿은 아직 확정하지 않은 작성 중 프로젝트에만 적용할 수 있습니다."
                )
            template_settings = template.settings.model_copy(deep=True)
            template_settings.presentation_mode = detail.settings.presentation_mode
            settings = _settings_for_project_profile(
                template_settings, detail.project_profile
            )
            affected = self.crud.execute(
                connection,
                "SURVEY_APPLY_TEMPLATE_BY_OWNER",
                {
                    "surveyId": survey_id,
                    "tenantId": user.tenant_id,
                    "ownerUserId": user.id,
                    "templateCode": template.code,
                    "templateVersionNo": template.version_no,
                    "draftJson": self._draft_json(
                        sections=[
                            section.model_copy(deep=True)
                            for section in template.sections
                        ],
                        settings=settings,
                        theme=detail.theme,
                        skin=detail.skin,
                        project_profile=detail.project_profile,
                        logic_rules=[dict(rule) for rule in template.logic_rules],
                        languages=template.languages.model_copy(deep=True),
                        translations={
                            key: value.model_copy(deep=True)
                            for key, value in template.translations.items()
                        },
                    ),
                },
            )
            if affected != 1:
                raise ConflictError("템플릿 적용 중 프로젝트 상태가 변경되었습니다.")
            self._sync_i18n(
                connection,
                user.tenant_id,
                survey_id,
                0,
                template.languages,
                template.translations,
            )
        return self.get_survey(user, survey_id)

    def reset_template(
        self,
        user: UserRecord,
        survey_id: str,
        request: SurveyTemplateResetRequest,
    ) -> SurveyDetail:
        with self.pool.transaction() as connection:
            row = self._survey_row(connection, user, survey_id, lock=True)
            detail = self._detail_from_row(row)
            if (
                request.expected_revision is not None
                and request.expected_revision != detail.revision
            ):
                raise ConflictError(
                    "다른 화면에서 프로젝트가 변경되었습니다. 최신 내용을 다시 불러온 뒤 다시 시도해 주세요."
                )
            if detail.status != SurveyStatus.DRAFT or detail.published_version is not None:
                raise ConflictError(
                    "빈 설문으로 초기화하는 작업은 아직 확정하지 않은 작성 중 프로젝트에서만 가능합니다."
                )
            affected = self.crud.execute(
                connection,
                "SURVEY_APPLY_TEMPLATE_BY_OWNER",
                {
                    "surveyId": survey_id,
                    "tenantId": user.tenant_id,
                    "ownerUserId": user.id,
                    "templateCode": None,
                    "templateVersionNo": None,
                    "draftJson": self._draft_json(
                        sections=[SurveySection(title="설문 문항", questions=[])],
                        settings=detail.settings,
                        theme=detail.theme,
                        skin=detail.skin,
                        project_profile=detail.project_profile,
                        logic_rules=[],
                        languages=detail.languages,
                        translations={},
                    ),
                },
            )
            if affected != 1:
                raise ConflictError("빈 설문으로 초기화하는 중 프로젝트 상태가 변경되었습니다.")
            self._sync_i18n(
                connection,
                user.tenant_id,
                survey_id,
                0,
                detail.languages,
                {},
            )
        return self.get_survey(user, survey_id)

    def delete_survey(self, user: UserRecord, survey_id: str) -> None:
        with self.pool.transaction() as connection:
            row = self._survey_row(connection, user, survey_id, lock=True)
            status = SurveyStatus(str(row["status_code"]).lower())
            if status == SurveyStatus.PUBLISHED:
                raise ConflictError(
                    "진행 중인 설문 프로젝트는 삭제할 수 없습니다. 먼저 배포를 종료해 주세요."
                )
            affected = self.crud.execute(
                connection,
                "SURVEY_SOFT_DELETE_BY_OWNER",
                {
                    "surveyId": survey_id,
                    "tenantId": user.tenant_id,
                    "ownerUserId": user.id,
                },
            )
            if affected != 1:
                raise ConflictError("설문 삭제 중 상태가 변경되었습니다. 목록을 새로고침해 주세요.")

    def close_survey(self, user: UserRecord, survey_id: str) -> SurveyDetail:
        with self.pool.transaction() as connection:
            row = self._survey_row(connection, user, survey_id, lock=True)
            if SurveyStatus(str(row["status_code"]).lower()) != SurveyStatus.PUBLISHED:
                raise ConflictError("진행 중인 설문 프로젝트만 배포를 종료할 수 있습니다.")
            affected = self.crud.execute(
                connection,
                "SURVEY_CLOSE_BY_OWNER",
                {
                    "surveyId": survey_id,
                    "tenantId": user.tenant_id,
                    "ownerUserId": user.id,
                },
            )
            if affected != 1:
                raise ConflictError("배포 종료 중 프로젝트 상태가 변경되었습니다. 목록을 새로고침해 주세요.")
            self.crud.execute(
                connection,
                "SURVEY_DEPLOYMENT_CLOSE",
                {"surveyId": survey_id, "tenantId": user.tenant_id},
            )
        return self.get_survey(user, survey_id)

    def update_survey(
        self, user: UserRecord, survey_id: str, request: SurveyUpdateRequest
    ) -> SurveyDetail:
        for attempt in range(2):
            try:
                with self.pool.transaction() as connection:
                    self._update_survey_transaction(
                        connection, user, survey_id, request
                    )
                return self.get_survey(user, survey_id)
            except Exception as exc:
                error_code = _oracle_error_code(exc)
                if error_code not in {60, 12860}:
                    raise
                if attempt == 0:
                    logger.warning(
                        "Retrying serial Oracle survey update after ORA-%05d. survey=%s",
                        error_code,
                        survey_id,
                    )
                    continue
                raise ServiceUnavailableError(
                    "동시에 저장 요청이 발생했습니다. 변경사항은 유지되며 잠시 후 다시 저장해 주세요."
                ) from exc
        raise AssertionError("unreachable")

    def _update_survey_transaction(
        self,
        connection: Any,
        user: UserRecord,
        survey_id: str,
        request: SurveyUpdateRequest,
    ) -> None:
        row = self._survey_row(connection, user, survey_id, lock=True)
        detail = self._detail_from_row(row)
        if (
            request.expected_revision is not None
            and request.expected_revision != detail.revision
        ):
            raise ConflictError(
                "다른 화면에서 프로젝트가 변경되었습니다. 최신 내용을 다시 불러온 뒤 저장해 주세요."
            )
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
        project_profile = (
            request.project_profile
            if "project_profile" in fields and request.project_profile is not None
            else detail.project_profile
        )
        if "project_profile" in fields:
            settings = _settings_for_project_profile(settings, project_profile)
        elif "settings" in fields:
            project_profile = _project_profile_for_settings(
                project_profile, settings
            )
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
        self._validate_translation_targets(sections, translations)
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
                "surveyStartAt": project_profile.starts_at,
                "surveyClosesAt": project_profile.closes_at,
                "identifiedYn": "Y" if project_profile.identified else "N",
                "showProgressYn": "Y" if project_profile.show_progress else "N",
                "targetAudience": project_profile.target_audience,
                "populationModeCode": project_profile.population_mode.value.upper(),
                "populationSize": project_profile.population_size,
                "targetResponseCount": project_profile.target_response_count,
                "draftJson": self._draft_json(
                    sections=sections,
                    settings=settings,
                    theme=theme,
                    skin=skin,
                    project_profile=project_profile,
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
            if not detail.title.strip():
                raise DomainValidationError(
                    "설문을 확정하려면 제목을 입력해야 합니다."
                )
            try:
                validate_publish_ready_sections(detail.sections)
            except ValueError as exc:
                raise DomainValidationError(str(exc)) from exc
            existing_slug = str(row["public_slug"]) if row.get("public_slug") else None
            if existing_slug and request.slug and request.slug != existing_slug:
                raise ConflictError("배포된 설문의 URL 식별자는 변경할 수 없습니다.")
            slug = existing_slug or self._unique_slug(
                connection, request.slug or detail.title, survey_id
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
                project_profile=detail.project_profile,
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
        public = _public_snapshot(row["snapshot_json"])
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
        return _public_snapshot(row["snapshot_json"]) if row else None

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
            cutoff = report_cutoff_exclusive(cutoff_date)
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

    def _delivery_context(
        self,
        connection: Any,
        user: UserRecord,
        survey_id: str,
        *,
        lock: bool = False,
    ) -> tuple[dict[str, Any], PublicSurvey]:
        survey_row = self._survey_row(connection, user, survey_id, lock=lock)
        detail = self._detail_from_row(survey_row)
        if (
            detail.status != SurveyStatus.PUBLISHED
            or detail.published_version is None
            or not detail.slug
        ):
            raise ConflictError("확정된 설문 프로젝트만 배포할 수 있습니다.")
        context = self.crud.fetch_one(
            connection,
            "DELIVERY_CONTEXT_BY_OWNER",
            {
                "tenantId": user.tenant_id,
                "surveyId": survey_id,
                "ownerUserId": user.id,
            },
        )
        if context is None:
            raise ConflictError(
                "확정 버전과 활성 배포 정보가 일치하지 않습니다. 설문을 다시 확정해 주세요."
            )
        public = _public_snapshot(context["snapshot_json"])
        context_version = int(context["survey_version_no"])
        if (
            public.survey_id != survey_id
            or public.version != context_version
            or context_version != detail.published_version
            or public.slug != str(context["public_slug"])
        ):
            raise ServiceUnavailableError(
                "배포할 확정 설문 버전의 무결성을 확인할 수 없습니다."
            )
        return context, public

    @staticmethod
    def _delivery_plan_json(request: DeploymentDraftRequest) -> str:
        return _json_dump(
            {
                "channels": [channel.value for channel in request.channels],
                "messagesByLanguage": {
                    locale: messages.model_dump(by_alias=True, mode="json")
                    for locale, messages in request.messages_by_language.items()
                },
                "schedule": request.schedule.model_dump(by_alias=True, mode="json"),
                "status": "DRAFT",
            }
        )

    def _deployment_from_rows(
        self,
        connection: Any,
        context: dict[str, Any],
        batch: dict[str, Any],
    ) -> DeploymentDraftView:
        if (
            str(batch["deployment_id"]) != str(context["deployment_id"])
            or str(batch["survey_id"]) != str(context["survey_id"])
            or int(batch["survey_version_no"])
            != int(context["survey_version_no"])
        ):
            raise ConflictError(
                "설문 확정 버전이 변경되어 기존 배포 계획을 사용할 수 없습니다. "
                "새 확정 버전에 맞는 배포 계획을 만들어 주세요."
            )
        query_params = {
            "tenantId": str(batch["tenant_id"]),
            "surveyId": str(batch["survey_id"]),
            "surveyVersionNo": int(batch["survey_version_no"]),
            "deploymentId": str(batch["deployment_id"]),
            "batchId": str(batch["batch_id"]),
        }
        targets = self.crud.fetch_all(
            connection, "DELIVERY_TARGET_LIST", query_params
        )
        endpoint_rows = self.crud.fetch_all(
            connection, "DELIVERY_RECIPIENT_LIST", query_params
        )
        endpoint_fields = {
            "EMAIL": "email",
            "SMS": "mobile",
            "FAX": "fax",
            "KAKAO": "kakaoId",
        }
        contacts: dict[str, dict[str, str]] = defaultdict(dict)
        for endpoint in endpoint_rows:
            channel = str(endpoint["contact_type_code"]).upper()
            field_name = endpoint_fields.get(channel)
            if field_name is None or endpoint.get("target_id") is None:
                raise ServiceUnavailableError(
                    "저장된 배포 연락처 형식을 확인할 수 없습니다."
                )
            contacts[str(endpoint["target_id"])][field_name] = decrypt_contact(
                self.settings.delivery_secret,
                str(endpoint["contact_value_encrypted"]),
            )

        recipients: list[dict[str, Any]] = []
        for target in targets:
            attributes = _json_load(target.get("attributes_json"), {})
            if not isinstance(attributes, dict):
                raise ServiceUnavailableError(
                    "저장된 배포 대상자 속성 형식을 확인할 수 없습니다."
                )
            target_id = str(target["target_id"])
            recipient = {
                "id": str(target["client_target_id"]),
                "name": str(target["display_name"]),
                "countryCode": str(target["country_code"]),
                "preferredLanguage": str(target["preferred_lang_code"]),
                "channels": list(attributes.get("channels") or []),
                "email": None,
                "mobile": None,
                "fax": None,
                "kakaoId": None,
            }
            recipient.update(contacts.get(target_id, {}))
            recipients.append(recipient)

        plan = _json_load(batch.get("plan_json"), {})
        if not isinstance(plan, dict):
            raise ServiceUnavailableError("저장된 배포 계획 형식을 확인할 수 없습니다.")
        payload = {
            "revision": int(batch["revision_no"]),
            "recipients": recipients,
            "channels": list(plan.get("channels") or []),
            "messagesByLanguage": dict(plan.get("messagesByLanguage") or {}),
            "schedule": dict(plan.get("schedule") or {}),
            "status": "DRAFT",
            "deploymentId": str(context["deployment_id"]),
            "surveyId": str(context["survey_id"]),
            "surveyVersion": int(context["survey_version_no"]),
            "publicSlug": str(context["public_slug"]),
            "updatedAt": _as_aware(batch.get("updated_at"))
            or _as_aware(batch.get("created_at"))
            or utcnow(),
            "executionStatus": (
                str(batch["execution_status_code"])
                if batch.get("execution_status_code") is not None
                else None
            ),
        }
        try:
            return DeploymentDraftView.model_validate(payload)
        except (TypeError, ValueError) as exc:
            raise ServiceUnavailableError(
                "저장된 배포 계획의 무결성을 확인할 수 없습니다."
            ) from exc

    def _deployment_retention_until(
        self, user: UserRecord, public: PublicSurvey, now: datetime
    ) -> datetime:
        candidates = [now + timedelta(days=90)]
        if public.settings.closes_at and public.settings.closes_at > now:
            candidates.append(public.settings.closes_at)
        if user.tenant_expires_at and user.tenant_expires_at > now:
            candidates.append(user.tenant_expires_at)
        return min(candidates)

    @staticmethod
    def _validate_delivery_languages(
        request: DeploymentDraftRequest, public: PublicSurvey
    ) -> None:
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

    def deployment(
        self, user: UserRecord, survey_id: str
    ) -> DeploymentDraftView:
        with self.pool.connection() as connection:
            context, _ = self._delivery_context(connection, user, survey_id)
            params = {
                "tenantId": user.tenant_id,
                "surveyId": survey_id,
                "deploymentId": str(context["deployment_id"]),
                "surveyVersionNo": int(context["survey_version_no"]),
            }
            batch = self.crud.fetch_one(
                connection,
                "DELIVERY_BATCH_LATEST",
                params,
            )
            if batch is None:
                raise NotFoundError("저장된 배포 초안이 없습니다.")
            value = self._deployment_from_rows(connection, context, batch)
        return self._masked_deployment(value)

    def save_deployment(
        self,
        user: UserRecord,
        survey_id: str,
        request: DeploymentDraftRequest,
    ) -> DeploymentDraftView:
        now = utcnow()
        with self.pool.transaction() as connection:
            context, public = self._delivery_context(
                connection, user, survey_id, lock=True
            )
            params = {
                "tenantId": user.tenant_id,
                "surveyId": survey_id,
                "deploymentId": str(context["deployment_id"]),
                "surveyVersionNo": public.version,
            }
            batch = self.crud.fetch_one(
                connection, "DELIVERY_BATCH_LATEST_FOR_UPDATE", params
            )
            current = (
                self._deployment_from_rows(connection, context, batch)
                if batch is not None
                else None
            )
            previous = current
            if request.revision is not None and (
                current is None or request.revision != current.revision
            ):
                raise ConflictError(
                    "다른 화면에서 배포 초안이 변경되었습니다. 최신 내용을 다시 불러와 주세요."
                )
            if (
                batch is not None
                and str(batch["status_code"]).upper() == "DRAFT"
                and request.revision is None
            ):
                raise ConflictError(
                    "기존 배포 초안을 변경하려면 최신 revision이 필요합니다. 초안을 다시 불러와 주세요."
                )
            if batch is not None and str(batch["status_code"]).upper() != "DRAFT":
                if request.revision is not None:
                    raise ConflictError(
                        "이미 실행한 배포 계획은 변경할 수 없습니다. revision 없이 새 배포 계획을 만들어 주세요."
                    )
                batch = None
                current = None
            request = self._merge_masked_recipient_contacts(request, previous)
            self._validate_delivery_languages(request, public)
            if (
                public.settings.closes_at is not None
                and public.settings.closes_at <= now
            ):
                raise ConflictError("응답 기간이 종료된 설문은 배포할 수 없습니다.")
            if (
                request.schedule.scheduled_at is not None
                and request.schedule.scheduled_at <= now
            ):
                raise DomainValidationError(
                    "예약 발송 시각은 현재 시각보다 이후여야 합니다."
                )
            retention_until = self._deployment_retention_until(user, public, now)
            if (
                request.schedule.scheduled_at is not None
                and request.schedule.scheduled_at >= retention_until
            ):
                raise DomainValidationError(
                    "예약 발송 시각은 설문 응답 기간과 연락처 보유 기간 안이어야 합니다."
                )

            contact_fields = {
                DeliveryChannel.EMAIL: ("email", "EMAIL"),
                DeliveryChannel.SMS: ("mobile", "SMS"),
                DeliveryChannel.KAKAO: ("kakao_id", "KAKAO"),
                DeliveryChannel.FAX: ("fax", "FAX"),
            }
            seen_contacts: set[tuple[str, str]] = set()
            target_rows: list[dict[str, Any]] = []
            endpoint_rows: list[dict[str, Any]] = []
            for recipient in request.recipients:
                target_id = new_id("target")
                target_rows.append(
                    {
                        "targetId": target_id,
                        "clientTargetId": recipient.id,
                        "tenantId": user.tenant_id,
                        "surveyId": survey_id,
                        "surveyVersionNo": public.version,
                        "deploymentId": str(context["deployment_id"]),
                        "batchId": None,
                        "displayName": recipient.name,
                        "countryCode": recipient.country_code,
                        "preferredLangCode": recipient.preferred_language,
                        "attributesJson": _json_dump(
                            {
                                "channels": [
                                    channel.value for channel in recipient.channels
                                ]
                            }
                        ),
                        "retentionUntil": retention_until,
                        "createdAt": now,
                    }
                )
                for channel in recipient.channels:
                    field_name, contact_type = contact_fields[channel]
                    value = getattr(recipient, field_name)
                    if not value or is_masked_contact(value):
                        raise DomainValidationError(
                            f"{recipient.name} 대상자의 {contact_type} 연락처를 다시 입력해 주세요."
                        )
                    value_hash = contact_hash(
                        self.settings.delivery_secret, contact_type, value
                    )
                    duplicate_key = (contact_type, value_hash)
                    if duplicate_key in seen_contacts:
                        raise DomainValidationError(
                            f"같은 {contact_type} 연락처를 배포 대상에 중복 등록할 수 없습니다."
                        )
                    seen_contacts.add(duplicate_key)
                    endpoint_rows.append(
                        {
                            "recipientId": new_id("recipient"),
                            "tenantId": user.tenant_id,
                            "surveyId": survey_id,
                            "surveyVersionNo": public.version,
                            "deploymentId": str(context["deployment_id"]),
                            "contactTypeCode": contact_type,
                            "contactValueHash": value_hash,
                            "contactValueEncrypted": encrypt_contact(
                                self.settings.delivery_secret, value
                            ),
                            "displayName": recipient.name,
                            "attributesJson": _json_dump({}),
                            "retentionUntil": retention_until,
                            "createdAt": now,
                            "targetId": target_id,
                        }
                    )

            if batch is None:
                batch_id = new_id("batch")
                for target_row in target_rows:
                    target_row["batchId"] = batch_id
                self.crud.execute(
                    connection,
                    "DELIVERY_BATCH_INSERT",
                    {
                        **params,
                        "batchId": batch_id,
                        "surveyVersionNo": public.version,
                        "planJson": self._delivery_plan_json(request),
                        "createdBy": user.id,
                        "updatedAt": now,
                    },
                )
            else:
                batch_id = str(batch["batch_id"])
                for target_row in target_rows:
                    target_row["batchId"] = batch_id
                affected = self.crud.execute(
                    connection,
                    "DELIVERY_BATCH_UPDATE_DRAFT",
                    {
                        **params,
                        "batchId": batch_id,
                        "expectedRevision": int(batch["revision_no"]),
                        "planJson": self._delivery_plan_json(request),
                        "updatedAt": now,
                    },
                )
                if affected != 1:
                    raise ConflictError(
                        "배포 초안 저장 중 상태가 변경되었습니다. 최신 내용을 다시 불러와 주세요."
                    )
                delete_params = {**params, "batchId": batch_id}
                self.crud.execute(
                    connection, "DELIVERY_RECIPIENT_DELETE_DRAFT", delete_params
                )
                self.crud.execute(
                    connection, "DELIVERY_TARGET_DELETE_DRAFT", delete_params
                )
            self.crud.executemany(
                connection, "DELIVERY_TARGET_INSERT", target_rows
            )
            self.crud.executemany(
                connection, "DELIVERY_RECIPIENT_INSERT", endpoint_rows
            )
        return self.deployment(user, survey_id)

    def execute_deployment(
        self,
        user: UserRecord,
        survey_id: str,
        request: DeploymentDraftRequest,
    ) -> DeploymentExecuteResult:
        saved = self.save_deployment(user, survey_id, request)
        now = utcnow()
        with self.pool.transaction() as connection:
            context, _ = self._delivery_context(
                connection, user, survey_id, lock=True
            )
            params = {
                "tenantId": user.tenant_id,
                "surveyId": survey_id,
                "deploymentId": str(context["deployment_id"]),
                "surveyVersionNo": int(context["survey_version_no"]),
            }
            batch = self.crud.fetch_one(
                connection, "DELIVERY_BATCH_LATEST_FOR_UPDATE", params
            )
            if (
                batch is None
                or str(batch["status_code"]).upper() != "DRAFT"
                or int(batch["revision_no"]) != saved.revision
            ):
                raise ConflictError(
                    "배포 실행 직전에 계획이 변경되었습니다. 최신 내용을 확인한 뒤 다시 실행해 주세요."
                )
            raw = self._deployment_from_rows(connection, context, batch)
            batch_params = {**params, "batchId": str(batch["batch_id"])}
            target_rows = self.crud.fetch_all(
                connection, "DELIVERY_TARGET_LIST", batch_params
            )
            endpoint_rows = self.crud.fetch_all(
                connection, "DELIVERY_RECIPIENT_LIST", batch_params
            )
            targets_by_client = {
                str(row["client_target_id"]): str(row["target_id"])
                for row in target_rows
            }
            endpoints = {
                (str(row["target_id"]), str(row["contact_type_code"]).upper()): str(
                    row["recipient_id"]
                )
                for row in endpoint_rows
            }
            providers = self.delivery_providers(user).providers
            queue_rows: list[dict[str, Any]] = []
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
                target_id = targets_by_client.get(recipient.id)
                if target_id is None:
                    raise ServiceUnavailableError(
                        "배포 대상자와 연락처를 연결할 수 없습니다."
                    )
                for channel in available:
                    recipient_id = endpoints.get((target_id, channel.value))
                    if recipient_id is None:
                        raise ServiceUnavailableError(
                            "배포 대상자의 선택 채널 연락처를 확인할 수 없습니다."
                        )
                    provider = providers[channel.value.lower()]
                    queued = provider.enabled
                    language = recipient.preferred_language
                    message = raw.messages_by_language[language]
                    queue_rows.append(
                        {
                            "deliveryId": new_id("delivery"),
                            "tenantId": user.tenant_id,
                            "surveyId": survey_id,
                            "surveyVersionNo": raw.survey_version,
                            "deploymentId": raw.deployment_id,
                            "recipientId": recipient_id,
                            "channelCode": channel.value,
                            "providerCode": (
                                provider.provider_code if queued else "disabled"
                            ),
                            "statusCode": "QUEUED" if queued else "DISABLED",
                            "messageTemplateJson": _json_dump(
                                {
                                    "language": language,
                                    "publicPath": f"/s/{raw.public_slug}?lang={language}",
                                    "messages": message.model_dump(
                                        by_alias=True, mode="json"
                                    ),
                                }
                            ),
                            "scheduledAt": raw.schedule.scheduled_at or now,
                            "lastErrorCode": (
                                None if queued else "PROVIDER_DISABLED"
                            ),
                            "createdAt": now,
                            "batchId": str(batch["batch_id"]),
                            "langCode": language,
                        }
                    )
            self.crud.executemany(connection, "DELIVERY_QUEUE_INSERT", queue_rows)
            queued_count = sum(row["statusCode"] == "QUEUED" for row in queue_rows)
            disabled_count = sum(
                row["statusCode"] == "DISABLED" for row in queue_rows
            )
            execution_status = (
                "QUEUED"
                if queued_count and not disabled_count
                else "PARTIAL"
                if queued_count
                else "DISABLED"
            )
            affected = self.crud.execute(
                connection,
                "DELIVERY_BATCH_MARK_EXECUTED",
                {
                    **params,
                    "batchId": str(batch["batch_id"]),
                    "expectedRevision": saved.revision,
                    "executionStatusCode": execution_status,
                    "updatedAt": now,
                },
            )
            if affected != 1:
                raise ConflictError(
                    "배포 실행 상태가 변경되었습니다. 실행 이력을 확인해 주세요."
                )

        deployment = self.deployment(user, survey_id)
        channel_results: list[DeliveryChannelResult] = []
        for channel in saved.channels:
            provider = self.delivery_providers(user).providers[channel.value.lower()]
            count = sum(
                row["channelCode"] == channel.value for row in queue_rows
            )
            channel_results.append(
                DeliveryChannelResult(
                    channel=channel,
                    status="QUEUED" if provider.enabled else "DISABLED",
                    count=count,
                    reason=None if provider.enabled else provider.reason,
                )
            )
        return DeploymentExecuteResult(
            deployment=deployment,
            execution=DeploymentExecutionView(
                execution_status=execution_status,
                channel_results=channel_results,
            ),
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
        enabled_locales = sorted(set(languages.enabled), key=str.casefold)
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
                        "zh": "Chinese",
                        "zh-CN": "Chinese (Simplified)",
                        "zh-TW": "Chinese (Traditional)",
                        "vi": "Vietnamese",
                        "fil": "Filipino",
                    }.get(locale, locale),
                    "nativeName": {
                        "ko": "한국어",
                        "en": "English",
                        "ja": "日本語",
                        "zh": "中文",
                        "zh-CN": "简体中文",
                        "zh-TW": "繁體中文",
                        "vi": "Tiếng Việt",
                        "fil": "Filipino",
                    }.get(locale, locale),
                    "directionCode": (
                        "RTL"
                        if locale.split("-")[0] in {"ar", "he", "fa", "ur"}
                        else "LTR"
                    ),
                }
                for locale in enabled_locales
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
                    for locale in enabled_locales
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
                "table_count": 23,
                "critical_column_count": 16,
                "critical_constraint_count": 14,
                "valid_function_count": 2,
                "guest_sequence_count": 1,
            }
            actual = {
                key: int(row.get(key) or 0) if row else 0 for key in expected
            }
            if actual != expected:
                mismatches = ", ".join(
                    f"{key}={actual[key]}/{expected_value}"
                    for key, expected_value in expected.items()
                    if actual[key] != expected_value
                )
                return (
                    False,
                    "Oracle schema is incomplete or incompatible. "
                    f"Mismatched readiness checks: {mismatches}. "
                    "Run SURVEYONE_SYSTEM_DDL.sql for a new schema or "
                    "SURVEYONE_SYSTEM_ALT.sql for an existing schema.",
                )
            return True, None
        except Exception as exc:
            return False, f"Oracle connection is unavailable ({type(exc).__name__})."
