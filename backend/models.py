from __future__ import annotations

import json
import math
import re
from datetime import date, datetime, timezone
from enum import Enum
from html.parser import HTMLParser
from typing import Annotated, Any, Generic, Literal, TypeVar
from uuid import uuid4

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    SecretStr,
    StringConstraints,
    computed_field,
    field_serializer,
    field_validator,
    model_validator,
)

from backend.config import get_settings


PUBLIC_JSON_MAX_DEPTH = 12
PUBLIC_JSON_MAX_NODES = 10_000
PUBLIC_JSON_MAX_STRING_BYTES = 32_768
PUBLIC_JSON_MAX_CONTAINER_ITEMS = 1_000
CUSTOM_SOURCE_MAX_BYTES = 512 * 1024
CUSTOM_SOURCE_TOTAL_MAX_BYTES = 1024 * 1024
CONTENT_HTML_MAX_BYTES = 64 * 1024
SAFE_ASSET_PREFIXES = ("/frontend/assets/", "/uploads/")
HEX_COLOR_PATTERN = re.compile(r"^#[0-9A-Fa-f]{6}$")
RADIUS_PATTERN = re.compile(r"^(?:0|[1-9][0-9]?)px$")
STABLE_ID_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$"
StableId = Annotated[
    str,
    Field(min_length=1, max_length=80, pattern=STABLE_ID_PATTERN),
]


class _SurveyContentParser(HTMLParser):
    """Accept presentation-only HTML without executable content or external assets."""

    tags = {
        "p", "br", "strong", "em", "u", "h2", "h3", "h4", "ul", "ol", "li",
        "blockquote", "table", "caption", "thead", "tbody", "tfoot", "tr", "th",
        "td", "div", "span",
    }

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag not in self.tags:
            raise ValueError(f"contentHtml does not allow the {tag} element.")
        seen: set[str] = set()
        for name, value in attrs:
            if name in seen:
                raise ValueError("contentHtml cannot contain duplicate attributes.")
            seen.add(name)
            if name in {"colspan", "rowspan"} and tag in {"th", "td"}:
                if value is None or not re.fullmatch(r"(?:[1-9]|1[0-9]|20)", value):
                    raise ValueError("contentHtml table spans must be between 1 and 20.")
            elif name == "scope" and tag == "th":
                if value not in {"row", "col", "rowgroup", "colgroup"}:
                    raise ValueError("contentHtml table scope is invalid.")
            else:
                raise ValueError(f"contentHtml does not allow the {name} attribute.")

    def handle_endtag(self, tag: str) -> None:
        if tag not in self.tags:
            raise ValueError(f"contentHtml does not allow the {tag} element.")

    def handle_data(self, data: str) -> None:
        if "<" in data:
            raise ValueError("contentHtml must escape literal less-than characters.")

    def handle_comment(self, data: str) -> None:
        raise ValueError("contentHtml cannot contain comments.")

    def handle_decl(self, decl: str) -> None:
        raise ValueError("contentHtml cannot contain document declarations.")

    def unknown_decl(self, data: str) -> None:
        raise ValueError("contentHtml cannot contain document declarations.")

    def handle_pi(self, data: str) -> None:
        raise ValueError("contentHtml cannot contain processing instructions.")


def _validate_content_html(value: str) -> str:
    if len(value.encode("utf-8")) > CONTENT_HTML_MAX_BYTES:
        raise ValueError("contentHtml must not exceed 64KB.")
    parser = _SurveyContentParser(convert_charrefs=False)
    try:
        parser.feed(value)
        parser.close()
    except (AssertionError, ValueError) as exc:
        raise ValueError(f"Invalid contentHtml: {exc}") from exc
    return value


def _validate_asset_url(value: str | None) -> str | None:
    if value is None:
        return None
    candidate = value.strip()
    if not candidate:
        return None
    path = candidate.split("?", 1)[0].split("#", 1)[0]
    if (
        not candidate.startswith("/")
        or candidate.startswith("//")
        or "\\" in candidate
        or any(part in {".", ".."} for part in path.split("/"))
        or not path.startswith(SAFE_ASSET_PREFIXES)
    ):
        raise ValueError("Survey images must use an approved same-origin asset path.")
    return candidate


def _validate_skin_assets(value: dict[str, Any] | None) -> dict[str, Any] | None:
    if value is None:
        return None
    skin = dict(value)
    for key in ("primary", "accent", "surface", "card"):
        if key in skin and skin[key] not in {None, ""} and not HEX_COLOR_PATTERN.fullmatch(str(skin[key])):
            raise ValueError(f"skin.{key} must be a six-digit hex color.")
    if "radius" in skin and skin["radius"] not in {None, ""} and not RADIUS_PATTERN.fullmatch(str(skin["radius"])):
        raise ValueError("skin.radius must be between 0px and 99px.")
    for key in ("headerImageUrl", "logoUrl", "organizationLogoUrl"):
        if key in skin:
            skin[key] = _validate_asset_url(None if skin[key] is None else str(skin[key]))
    custom_code = skin.get("customCode", skin.get("custom_code"))
    if custom_code is not None:
        if not isinstance(custom_code, dict):
            raise ValueError("skin.customCode must be an object.")
        enabled = custom_code.get("enabled", False)
        if not isinstance(enabled, bool):
            raise ValueError("skin.customCode.enabled must be a boolean.")
        normalized_code: dict[str, Any] = {
            "enabled": enabled,
            "placement": str(custom_code.get("placement") or "beforeQuestions"),
        }
        if normalized_code["placement"] not in {"beforeQuestions", "afterQuestions"}:
            raise ValueError("skin.customCode.placement is not supported.")
        total_bytes = 0
        for key in ("html", "css", "javascript"):
            source = custom_code.get(key, "")
            if not isinstance(source, str):
                raise ValueError(f"skin.customCode.{key} must be text.")
            source_bytes = len(source.encode("utf-8"))
            if source_bytes > CUSTOM_SOURCE_MAX_BYTES:
                raise ValueError(f"skin.customCode.{key} must not exceed 512KB.")
            total_bytes += source_bytes
            normalized_code[key] = source
        if total_bytes > CUSTOM_SOURCE_TOTAL_MAX_BYTES:
            raise ValueError("skin.customCode source must not exceed 1MB in total.")
        if re.search(
            r"<\s*/?\s*(?:script|style|link|base|iframe|object|embed|html|head|body)\b",
            normalized_code["html"],
            re.IGNORECASE,
        ):
            raise ValueError(
                "skin.customCode.html must use the CSS and JavaScript source fields."
            )
        if re.search(r"\son[a-z]+\s*=", normalized_code["html"], re.IGNORECASE):
            raise ValueError("skin.customCode.html cannot contain inline event handlers.")
        if re.search(
            r"@import|expression\s*\(|behavior\s*:|-moz-binding|javascript\s*:|position\s*:\s*fixed|url\s*\(",
            normalized_code["css"],
            re.IGNORECASE,
        ):
            raise ValueError("skin.customCode.css contains a prohibited expression.")
        skin.pop("custom_code", None)
        skin["customCode"] = normalized_code
    return skin


def _validate_public_json_shape(value: Any) -> None:
    """Bound nested public input before domain validation or persistence."""
    pending: list[tuple[Any, int]] = [(value, 0)]
    nodes = 0
    while pending:
        item, depth = pending.pop()
        nodes += 1
        if nodes > PUBLIC_JSON_MAX_NODES:
            raise ValueError("Submission JSON contains too many values.")
        if depth > PUBLIC_JSON_MAX_DEPTH:
            raise ValueError("Submission JSON nesting is too deep.")
        if isinstance(item, float) and not math.isfinite(item):
            raise ValueError("Submission JSON cannot contain NaN or Infinity.")
        if isinstance(item, str):
            if len(item.encode("utf-8")) > PUBLIC_JSON_MAX_STRING_BYTES:
                raise ValueError("A submission string is too large.")
        elif isinstance(item, dict):
            if len(item) > PUBLIC_JSON_MAX_CONTAINER_ITEMS:
                raise ValueError("A submission object contains too many entries.")
            pending.extend((key, depth + 1) for key in item)
            pending.extend((nested, depth + 1) for nested in item.values())
        elif isinstance(item, (list, tuple)):
            if len(item) > PUBLIC_JSON_MAX_CONTAINER_ITEMS:
                raise ValueError("A submission list contains too many entries.")
            pending.extend((nested, depth + 1) for nested in item)


def _to_camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part[:1].upper() + part[1:] for part in tail)


def _to_snake(value: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", value).lower()


def _axis_label(value: Any) -> str:
    if isinstance(value, dict):
        return str(value.get("label") or "")
    if hasattr(value, "label"):
        return str(value.label)
    return str(value)


class ApiModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=_to_camel,
        populate_by_name=True,
        str_strip_whitespace=True,
    )


T = TypeVar("T")


class ApiResponse(ApiModel, Generic[T]):
    status: Literal["success"] = "success"
    data: T


class UserRole(str, Enum):
    OWNER = "OWNER"
    MEMBER = "MEMBER"
    GUEST = "GUEST"


class GuestMode(str, Enum):
    DATABASE = "database"


class UserView(ApiModel):
    id: str
    login_id: str
    name: str
    email: str | None = None
    tenant_id: str
    organization_name: str
    role: UserRole
    system_admin: bool = False
    is_guest: bool
    guest_mode: GuestMode | None = None
    created_at: datetime


class AdminMemberView(ApiModel):
    id: str
    login_id: str
    name: str
    email: str | None = None
    tenant_id: str
    organization_name: str
    role: UserRole
    system_admin: bool = False
    is_guest: bool = False
    guest_mode: GuestMode | None = None
    active: bool = True
    expires_at: datetime | None = None
    withdrawn_at: datetime | None = None
    created_at: datetime
    last_login_at: datetime | None = None
    project_count: int = 0


class AdminMemberPage(ApiModel):
    items: list[AdminMemberView]
    page: int
    page_size: int
    total: int
    has_next: bool


class AdminMemberStatusRequest(ApiModel):
    active: bool


class AdminPasswordResetView(ApiModel):
    user_id: str
    login_id: str
    temporary_password: str = Field(repr=False)


class GuestSessionRequest(ApiModel):
    display_name: str = Field(default="게스트", min_length=1, max_length=60)
    mode: GuestMode = GuestMode.DATABASE


class GuestLimits(ApiModel):
    max_projects: int | None = None
    max_questions_per_survey: int | None = None
    max_responses_per_survey: int | None = None


class GuestFeatures(ApiModel):
    templates: bool = True
    publish_demo_url: bool = True
    external_delivery: bool = False
    raw_data_export: bool = False
    custom_report_persistence: bool = False
    multilingual: bool = True
    all_question_types: bool = True


class GuestModeCapability(ApiModel):
    mode: GuestMode
    title: str
    available: bool
    reason: str | None = None
    persistence: str
    expires_in_hours: int | None = None
    limits: GuestLimits = Field(default_factory=GuestLimits)
    features: GuestFeatures = Field(default_factory=GuestFeatures)
    provider_configured: dict[str, bool] = Field(default_factory=dict)


class GuestCapabilitiesView(ApiModel):
    selected_mode: GuestMode
    modes: list[GuestModeCapability]


class SignupRequest(ApiModel):
    login_id: str = Field(min_length=4, max_length=50, pattern=r"^[A-Za-z0-9._-]+$")
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(min_length=1, max_length=100)
    email: str | None = Field(default=None, max_length=320)
    organization_name: str = Field(min_length=2, max_length=200)
    terms_accepted: bool
    privacy_accepted: bool
    request_system_admin: bool = False
    admin_key: SecretStr | None = Field(default=None, repr=False)

    @field_validator("login_id")
    @classmethod
    def reserve_guest_login_ids(cls, value: str) -> str:
        if re.fullmatch(r"quest\d+", value, flags=re.IGNORECASE):
            raise ValueError("quest followed by digits is reserved for guest accounts.")
        return value

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str | None) -> str | None:
        if value is not None and ("@" not in value or value.startswith("@") or value.endswith("@")):
            raise ValueError("A valid email address is required.")
        return value

    @model_validator(mode="after")
    def require_signup_agreements_and_admin_key(self) -> SignupRequest:
        if not self.terms_accepted or not self.privacy_accepted:
            raise ValueError("이용약관과 개인정보 수집·이용에 모두 동의해야 합니다.")
        if self.request_system_admin and not self.admin_key:
            raise ValueError("플랫폼 관리자 가입에는 관리자 인증키가 필요합니다.")
        return self


class LoginRequest(ApiModel):
    login_id: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=1, max_length=128)
    keep_signed_in: bool = False


class GuestCredentialView(ApiModel):
    login_id: str
    initial_password: str
    expires_at: datetime


class AuthSessionView(ApiModel):
    user: UserView
    expires_at: datetime


class GuestProvisionView(ApiModel):
    user: UserView
    expires_at: datetime
    guest_credential: GuestCredentialView
    session: AuthSessionView | None = None


class QuestionType(str, Enum):
    SINGLE_CHOICE = "single_choice"
    MULTIPLE_CHOICE = "multiple_choice"
    DROPDOWN = "dropdown"
    SHORT_TEXT = "short_text"
    LONG_TEXT = "long_text"
    NUMBER = "number"
    SCALE = "scale"
    MATRIX = "matrix"
    TEXT = "text"
    SLIDER = "slider"
    TABLE = "table"
    REPEAT_TABLE = "repeat_table"
    DATE = "date"


class QuestionOption(ApiModel):
    code: str | None = Field(default=None, pattern=r"^[1-9][0-9]{0,5}$")
    id: StableId = Field(default_factory=lambda: uuid4().hex[:12])
    label: str = Field(default="", max_length=500)


class QuestionBehavior(str, Enum):
    FIXED_REQUIRED = "fixed_required"
    FIXED_OPTIONAL = "fixed_optional"
    DYNAMIC_REQUIRED = "dynamic_required"
    DYNAMIC_OPTIONAL = "dynamic_optional"


class QuestionCondition(ApiModel):
    source_question_id: StableId
    operator: Literal[
        "equals",
        "not_equals",
        "contains",
        "in",
        "exists",
        "not_exists",
        "greater_than",
        "greater_or_equal",
        "less_than",
        "less_or_equal",
    ] = "equals"
    value: str | int | float | bool | list[str | int | float | bool] | None = None

    @model_validator(mode="after")
    def validate_condition_value(self) -> "QuestionCondition":
        if self.operator in {"exists", "not_exists"}:
            self.value = None
        elif self.value is None or self.value == []:
            raise ValueError("값 비교 조건에는 비교 값을 입력해야 합니다.")
        if isinstance(self.value, list) and len(self.value) > 50:
            raise ValueError("한 조건의 비교 값은 최대 50개까지 입력할 수 있습니다.")
        values = self.value if isinstance(self.value, list) else [self.value]
        if any(isinstance(item, float) and not math.isfinite(item) for item in values):
            raise ValueError("조건 비교 값에는 유한한 숫자만 사용할 수 있습니다.")
        return self


class QuestionConditionGroup(ApiModel):
    combinator: Literal["all", "any"] = "all"
    conditions: list[QuestionCondition] = Field(min_length=1, max_length=20)


class QuestionSettings(ApiModel):
    model_config = ConfigDict(
        alias_generator=_to_camel,
        populate_by_name=True,
        str_strip_whitespace=True,
        extra="allow",
    )

    min_value: float | None = None
    max_value: float | None = None
    step: float | None = None
    min_label: str | None = Field(default=None, max_length=100)
    max_label: str | None = Field(default=None, max_length=100)
    unit: str | None = Field(default=None, max_length=30)
    rows: list[QuestionOption] = Field(default_factory=list, max_length=200)
    columns: list[QuestionOption] = Field(default_factory=list, max_length=200)
    min_selections: int | None = Field(default=None, ge=1, le=200)
    max_selections: int | None = Field(default=None, ge=1)
    scale_order: Literal["ascending", "descending"] = "ascending"
    scale_display: Literal["buttons", "slider"] = "buttons"
    choice_input: Literal["options", "codes"] = "options"
    choice_layout: Literal["vertical", "horizontal", "columns_2", "columns_3", "columns_4"] = "vertical"
    content_html: Annotated[str, StringConstraints(strip_whitespace=False)] = ""
    exclude_selected_from: StableId | None = None
    allow_other: bool = False
    shuffle_options: bool = False

    @field_validator("content_html")
    @classmethod
    def validate_content_html(cls, value: str) -> str:
        return _validate_content_html(value)

    @model_validator(mode="after")
    def validate_range(self) -> "QuestionSettings":
        for field_name in ("min_value", "max_value", "step"):
            value = getattr(self, field_name)
            if value is not None and not math.isfinite(value):
                alias = _to_camel(field_name)
                raise ValueError(f"{alias} must be a finite number.")
        if (
            self.min_value is not None
            and self.max_value is not None
            and self.min_value > self.max_value
        ):
            raise ValueError("minValue cannot be greater than maxValue.")
        if self.step is not None and self.step <= 0:
            raise ValueError("step must be greater than zero.")
        if (
            self.min_selections is not None
            and self.max_selections is not None
            and self.min_selections > self.max_selections
        ):
            raise ValueError("minSelections cannot be greater than maxSelections.")
        for field_name in ("rows", "columns"):
            identifiers = [item.id for item in getattr(self, field_name)]
            if len(identifiers) != len(set(identifiers)):
                raise ValueError(f"settings.{field_name} IDs must be unique.")
        return self


class Question(ApiModel):
    id: StableId = Field(default_factory=lambda: uuid4().hex[:12])
    type: QuestionType
    title: str = Field(default="", max_length=1000)
    description: str | None = Field(default=None, max_length=4000)
    required: bool = False
    behavior: QuestionBehavior = QuestionBehavior.FIXED_OPTIONAL
    activation_condition: QuestionConditionGroup | None = None
    options: list[QuestionOption] = Field(default_factory=list, max_length=200)
    settings: QuestionSettings = Field(default_factory=QuestionSettings)
    min: float | None = None
    max: float | None = None
    min_label: str | None = Field(default=None, max_length=100)
    max_label: str | None = Field(default=None, max_length=100)
    unit: str | None = Field(default=None, max_length=30)
    rows: list[str] = Field(default_factory=list, max_length=200)
    columns: list[str] = Field(default_factory=list, max_length=200)
    validation: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="before")
    @classmethod
    def normalize_editor_shape(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        payload = dict(value)
        if "behavior" not in payload:
            payload["behavior"] = (
                QuestionBehavior.FIXED_REQUIRED.value
                if bool(payload.get("required"))
                else QuestionBehavior.FIXED_OPTIONAL.value
            )
        aliases = {
            "single": QuestionType.SINGLE_CHOICE.value,
            "multiple": QuestionType.MULTIPLE_CHOICE.value,
            "matrix_single": QuestionType.MATRIX.value,
            "matrix_multiple": QuestionType.MATRIX.value,
            "notice": QuestionType.TEXT.value,
        }
        raw_type = payload.get("type")
        incoming_type = (
            raw_type.value if isinstance(raw_type, QuestionType) else str(raw_type or "")
        )
        payload["type"] = aliases.get(incoming_type, incoming_type)

        raw_settings = payload.get("settings")
        if isinstance(raw_settings, dict):
            settings = dict(raw_settings)
        elif hasattr(raw_settings, "model_dump"):
            settings = raw_settings.model_dump(by_alias=True)
        else:
            settings = {}
        compatibility_fields = {
            "min": "minValue",
            "max": "maxValue",
            "minLabel": "minLabel",
            "maxLabel": "maxLabel",
            "unit": "unit",
            "maxSelections": "maxSelections",
            "allowOther": "allowOther",
        }
        for source, target in compatibility_fields.items():
            if source not in payload or payload[source] is None:
                continue
            existing = settings.get(target, settings.get(_to_snake(target)))
            if source in {"min", "max"} and existing is not None:
                try:
                    equal = float(existing) == float(payload[source])
                except (TypeError, ValueError):
                    equal = existing == payload[source]
                if not equal:
                    raise ValueError(
                        f"question.{source} must equal settings.{target}."
                    )
            if existing is None:
                settings[target] = payload[source]

        if incoming_type in {"matrix_single", "matrix_multiple"}:
            settings.setdefault(
                "selectionMode",
                "single" if incoming_type == "matrix_single" else "multiple",
            )
        for field_name in ("rows", "columns"):
            raw_items = payload.get(field_name)
            if not isinstance(raw_items, list):
                continue
            settings_items = settings.get(field_name)
            if isinstance(settings_items, list) and settings_items:
                top_labels = [_axis_label(item) for item in raw_items]
                settings_labels = [_axis_label(item) for item in settings_items]
                if top_labels != settings_labels:
                    raise ValueError(
                        f"question.{field_name} must equal settings.{field_name} labels."
                    )
            else:
                settings[field_name] = [
                    item
                    if isinstance(item, dict)
                    else {
                        "id": f"{field_name[:3]}-{index + 1}",
                        "label": str(item),
                    }
                    for index, item in enumerate(raw_items)
                ]
        payload["settings"] = settings
        return payload

    @model_validator(mode="after")
    def validate_question_shape(self) -> "Question":
        dynamic = self.behavior in {
            QuestionBehavior.DYNAMIC_REQUIRED,
            QuestionBehavior.DYNAMIC_OPTIONAL,
        }
        if dynamic and self.activation_condition is None:
            raise ValueError("동적 문항에는 선행 문항 조건이 필요합니다.")
        if not dynamic and self.activation_condition is not None:
            raise ValueError("고정 문항에는 활성화 조건을 설정할 수 없습니다.")
        self.required = self.behavior in {
            QuestionBehavior.FIXED_REQUIRED,
            QuestionBehavior.DYNAMIC_REQUIRED,
        }
        if self.type == QuestionType.TEXT and (
            self.required or dynamic
        ):
            raise ValueError("안내 텍스트는 고정선택문항으로만 사용할 수 있습니다.")
        if self.settings.content_html and self.type != QuestionType.TEXT:
            raise ValueError("contentHtml can only be used by an informational notice.")
        if self.settings.exclude_selected_from and self.type not in {
            QuestionType.SINGLE_CHOICE, QuestionType.MULTIPLE_CHOICE, QuestionType.DROPDOWN,
        }:
            raise ValueError("excludeSelectedFrom can only be used by choice questions.")
        if self.settings.choice_input == "codes":
            codes = [option.code for option in self.options]
            if self.type != QuestionType.MULTIPLE_CHOICE:
                raise ValueError("choiceInput codes requires a multiple choice question.")
            if not codes or None in codes or len(codes) != len(set(codes)):
                raise ValueError("Number entry requires a unique code for every option.")
            if not self.settings.max_selections or self.settings.max_selections > 20:
                raise ValueError("Number entry requires maxSelections between 1 and 20.")
        identifiers = [option.id for option in self.options]
        if len(identifiers) != len(set(identifiers)):
            raise ValueError("Question option IDs must be unique.")
        if self.min is None:
            self.min = self.settings.min_value
        if self.max is None:
            self.max = self.settings.max_value
        if self.min_label is None:
            self.min_label = self.settings.min_label
        if self.max_label is None:
            self.max_label = self.settings.max_label
        if self.unit is None:
            self.unit = self.settings.unit
        if not self.rows:
            self.rows = [item.label for item in self.settings.rows]
        if not self.columns:
            self.columns = [item.label for item in self.settings.columns]
        if self.min != self.settings.min_value or self.max != self.settings.max_value:
            raise ValueError("question min/max must equal settings minValue/maxValue.")
        if self.rows != [item.label for item in self.settings.rows]:
            raise ValueError("question rows must equal settings.rows labels.")
        if self.columns != [item.label for item in self.settings.columns]:
            raise ValueError("question columns must equal settings.columns labels.")
        return self

    @field_serializer("type")
    def serialize_editor_type(self, value: QuestionType) -> str:
        if value == QuestionType.SINGLE_CHOICE:
            return "single"
        if value == QuestionType.MULTIPLE_CHOICE:
            return "multiple"
        if value == QuestionType.TEXT:
            return "notice"
        if value == QuestionType.MATRIX:
            selection_mode = str(
                (self.settings.model_extra or {}).get("selectionMode", "single")
            )
            return "matrix_multiple" if selection_mode == "multiple" else "matrix_single"
        return value.value


class SurveySection(ApiModel):
    id: StableId = Field(default_factory=lambda: uuid4().hex[:12])
    title: str = Field(default="새 섹션", max_length=500)
    description: str | None = Field(default=None, max_length=4000)
    questions: list[Question] = Field(default_factory=list, max_length=500)

    @model_validator(mode="after")
    def validate_question_ids(self) -> "SurveySection":
        identifiers = [question.id for question in self.questions]
        if len(identifiers) != len(set(identifiers)):
            raise ValueError("Question IDs must be unique within a section.")
        return self


def validate_question_activation_references(sections: list[SurveySection]) -> None:
    ordered = [
        question
        for section in sections
        for question in section.questions
    ]
    index_by_id = {question.id: index for index, question in enumerate(ordered)}
    for target_index, question in enumerate(ordered):
        excluded_source = question.settings.exclude_selected_from
        if excluded_source:
            source_index = index_by_id.get(excluded_source)
            if source_index is None:
                raise ValueError("excludeSelectedFrom references an unknown question ID.")
            if source_index >= target_index:
                raise ValueError("excludeSelectedFrom must reference a preceding question.")
            source = ordered[source_index]
            if source.type not in {
                QuestionType.SINGLE_CHOICE, QuestionType.MULTIPLE_CHOICE, QuestionType.DROPDOWN,
            }:
                raise ValueError("excludeSelectedFrom must reference a choice question.")
            if not {option.id for option in source.options}.intersection(
                option.id for option in question.options
            ):
                raise ValueError("excludeSelectedFrom requires shared stable option IDs.")
        group = question.activation_condition
        if group is None:
            continue
        for condition in group.conditions:
            source_index = index_by_id.get(condition.source_question_id)
            if source_index is None:
                raise ValueError(
                    f"동적 문항 조건이 존재하지 않는 문항 ID를 참조합니다: {condition.source_question_id}"
                )
            if source_index >= target_index:
                raise ValueError(
                    "동적 문항 조건은 현재 문항보다 앞에 있는 선행 문항만 참조할 수 있습니다."
                )
            if ordered[source_index].type == QuestionType.TEXT:
                raise ValueError("안내 텍스트는 동적 문항의 조건 문항으로 사용할 수 없습니다.")


def validate_publish_ready_sections(sections: list[SurveySection]) -> None:
    validate_question_activation_references(sections)
    answerable = False
    option_types = {
        QuestionType.SINGLE_CHOICE,
        QuestionType.MULTIPLE_CHOICE,
        QuestionType.DROPDOWN,
    }
    for section in sections:
        if not section.title.strip():
            raise ValueError("설문을 확정하려면 모든 섹션에 제목을 입력해야 합니다.")
        for question in section.questions:
            if not question.title.strip():
                raise ValueError("설문을 확정하려면 모든 문항에 제목을 입력해야 합니다.")
            if question.type != QuestionType.TEXT:
                answerable = True
            if question.type in option_types:
                if not question.options:
                    raise ValueError("선택형 문항에는 보기 항목이 한 개 이상 필요합니다.")
                if any(not option.label.strip() for option in question.options):
                    raise ValueError("모든 보기 항목에 내용을 입력해야 합니다.")
            if question.type in {QuestionType.MATRIX, QuestionType.TABLE}:
                if not question.settings.rows or not question.settings.columns:
                    raise ValueError("매트릭스와 표 문항에는 행과 열이 필요합니다.")
                if any(
                    not item.label.strip()
                    for item in question.settings.rows + question.settings.columns
                ):
                    raise ValueError("모든 행과 열에 이름을 입력해야 합니다.")
            if question.type == QuestionType.REPEAT_TABLE:
                if not question.settings.columns:
                    raise ValueError("반복표 문항에는 열이 한 개 이상 필요합니다.")
                if any(not item.label.strip() for item in question.settings.columns):
                    raise ValueError("반복표의 모든 열에 이름을 입력해야 합니다.")
            if question.type == QuestionType.SCALE:
                if question.min is None or question.max is None:
                    raise ValueError("척도 문항에는 최솟값과 최댓값이 필요합니다.")
                if not float(question.min).is_integer() or not float(
                    question.max
                ).is_integer():
                    raise ValueError("척도의 최솟값과 최댓값은 정수여야 합니다.")
                if question.min not in {0, 1}:
                    raise ValueError("척도의 최솟값은 0 또는 1이어야 합니다.")
                if question.min >= question.max:
                    raise ValueError("척도의 최솟값은 최댓값보다 작아야 합니다.")
                if not 2 <= question.max <= 10:
                    raise ValueError("척도의 최댓값은 2에서 10 사이여야 합니다.")
                if question.settings.step is not None and question.settings.step != 1:
                    raise ValueError("척도의 간격은 1이어야 합니다.")
    if not answerable:
        raise ValueError("설문을 확정하려면 응답 가능한 문항을 한 개 이상 추가해야 합니다.")


class SurveyTheme(ApiModel):
    code: str = Field(default="clean-blue", min_length=1, max_length=80)
    primary_color: str = Field(default="#3156D3", pattern=r"^#[0-9A-Fa-f]{6}$")
    background_color: str = Field(default="#F4F7FB", pattern=r"^#[0-9A-Fa-f]{6}$")
    card_color: str = Field(default="#FFFFFF", pattern=r"^#[0-9A-Fa-f]{6}$")
    font_family: str = Field(default="Pretendard", min_length=1, max_length=100)
    logo_url: str | None = Field(default=None, max_length=1000)

    @field_validator("logo_url")
    @classmethod
    def validate_logo_url(cls, value: str | None) -> str | None:
        return _validate_asset_url(value)


class SurveyPresentationMode(str, Enum):
    SCROLL = "scroll"
    ONE_AT_A_TIME = "one_at_a_time"


class SurveyAudienceRoute(ApiModel):
    code: str = Field(pattern=r"^[a-z0-9][a-z0-9_-]{0,39}$")
    label: str = Field(min_length=1, max_length=100)
    section_ids: list[StableId] = Field(min_length=1, max_length=100)

    @field_validator("section_ids")
    @classmethod
    def unique_sections(cls, values: list[str]) -> list[str]:
        if len(values) != len(set(values)):
            raise ValueError("audience sectionIds must be unique.")
        return values


class SurveySettings(ApiModel):
    audience_routes: list[SurveyAudienceRoute] = Field(default_factory=list, max_length=20)
    default_audience: str | None = Field(default=None, max_length=40)
    collect_email: bool = False
    show_progress_bar: bool = True
    show_question_numbers: bool = True
    one_response_per_respondent: bool = False
    allow_response_edit: bool = False
    confirmation_message: str = Field(
        default="응답이 정상적으로 제출되었습니다.",
        min_length=1,
        max_length=2000,
    )
    starts_at: datetime | None = None
    closes_at: datetime | None = None
    anonymous: bool = True
    presentation_mode: SurveyPresentationMode = SurveyPresentationMode.SCROLL
    show_progress: bool | None = None
    one_response: bool | None = None
    allow_edit: bool | None = None

    @model_validator(mode="before")
    @classmethod
    def normalize_editor_settings(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        payload = dict(value)
        mappings = {
            "showProgress": "showProgressBar",
            "oneResponse": "oneResponsePerRespondent",
            "allowEdit": "allowResponseEdit",
        }
        for source, target in mappings.items():
            if source in payload and target not in payload:
                payload[target] = payload[source]
        return payload

    @model_validator(mode="after")
    def validate_period(self) -> "SurveySettings":
        codes = [route.code for route in self.audience_routes]
        if len(codes) != len(set(codes)):
            raise ValueError("audience route codes must be unique.")
        if (codes and self.default_audience not in codes) or (not codes and self.default_audience):
            raise ValueError("defaultAudience must reference an audience route.")
        if self.starts_at and self.closes_at and self.starts_at >= self.closes_at:
            raise ValueError("startsAt must be earlier than closesAt.")
        if self.show_progress is None:
            self.show_progress = self.show_progress_bar
        if self.one_response is None:
            self.one_response = self.one_response_per_respondent
        if self.allow_edit is None:
            self.allow_edit = self.allow_response_edit
        return self

    @field_validator("starts_at", "closes_at")
    @classmethod
    def normalize_aware_datetime(cls, value: datetime | None) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("Survey response dates must include a timezone offset.")
        return value.astimezone(timezone.utc)


def validate_audience_references(sections: list[SurveySection], settings: SurveySettings | None) -> None:
    if settings is None or not settings.audience_routes:
        return
    known = {section.id for section in sections}
    for route in settings.audience_routes:
        if not set(route.section_ids) <= known:
            raise ValueError("audience route references an unknown section ID.")
        selected = [section for section in sections if section.id in route.section_ids]
        validate_question_activation_references(selected)


class SurveyQuestionTranslation(ApiModel):
    title: str | None = Field(default=None, max_length=1000)
    description: str | None = Field(default=None, max_length=4000)
    options: dict[StableId, str] = Field(default_factory=dict)
    rows: dict[StableId, str] = Field(default_factory=dict)
    columns: dict[StableId, str] = Field(default_factory=dict)
    min_label: str | None = Field(default=None, max_length=100)
    max_label: str | None = Field(default=None, max_length=100)
    unit: str | None = Field(default=None, max_length=30)


class SurveySectionTranslation(ApiModel):
    title: str | None = Field(default=None, max_length=500)
    description: str | None = Field(default=None, max_length=4000)
    questions: dict[StableId, SurveyQuestionTranslation] = Field(default_factory=dict)


class SurveyTranslation(ApiModel):
    """Locale overlay keyed by stable section/question/option identifiers."""

    title: str | None = Field(default=None, max_length=500)
    description: str | None = Field(default=None, max_length=4000)
    confirmation_message: str | None = Field(default=None, max_length=2000)
    sections: dict[StableId, SurveySectionTranslation] = Field(default_factory=dict)
    # Flat maps remain accepted for early editor payload compatibility.
    section_titles: dict[StableId, str] = Field(default_factory=dict)
    section_descriptions: dict[StableId, str] = Field(default_factory=dict)
    question_titles: dict[StableId, str] = Field(default_factory=dict)
    question_descriptions: dict[StableId, str] = Field(default_factory=dict)
    option_labels: dict[StableId, dict[StableId, str]] = Field(default_factory=dict)


def validate_translation_references(
    translations: dict[str, SurveyTranslation], sections: list[SurveySection]
) -> None:
    section_map = {section.id: section for section in sections}
    question_map = {
        question.id: question for section in sections for question in section.questions
    }

    def reject_unknown(label: str, values: set[str], allowed: set[str]) -> None:
        unknown = values - allowed
        if unknown:
            raise ValueError(
                f"{label} references unknown stable IDs: {', '.join(sorted(unknown))}"
            )

    section_ids = set(section_map)
    question_ids = set(question_map)
    for locale, translation in translations.items():
        reject_unknown(
            f"translations.{locale}.sections",
            set(translation.sections)
            | set(translation.section_titles)
            | set(translation.section_descriptions),
            section_ids,
        )
        reject_unknown(
            f"translations.{locale}.questions",
            set(translation.question_titles)
            | set(translation.question_descriptions)
            | set(translation.option_labels),
            question_ids,
        )
        for question_id, labels in translation.option_labels.items():
            reject_unknown(
                f"translations.{locale}.optionLabels.{question_id}",
                set(labels),
                {option.id for option in question_map[question_id].options},
            )
        for section_id, section_translation in translation.sections.items():
            section_question_map = {
                question.id: question for question in section_map[section_id].questions
            }
            reject_unknown(
                f"translations.{locale}.sections.{section_id}.questions",
                set(section_translation.questions),
                set(section_question_map),
            )
            for question_id, question_translation in section_translation.questions.items():
                question = section_question_map[question_id]
                reject_unknown(
                    f"translations.{locale}.questions.{question_id}.options",
                    set(question_translation.options),
                    {option.id for option in question.options},
                )
                for axis_name in ("rows", "columns"):
                    items = getattr(question.settings, axis_name)
                    allowed = {item.id for item in items} | {
                        str(index) for index in range(len(items))
                    }
                    reject_unknown(
                        f"translations.{locale}.questions.{question_id}.{axis_name}",
                        set(getattr(question_translation, axis_name)),
                        allowed,
                    )


class SurveyLanguages(ApiModel):
    source_locale: str = "ko"
    default_locale: str = "ko"
    enabled: list[str] = Field(default_factory=lambda: ["ko"], max_length=20)

    @field_validator("source_locale", "default_locale")
    @classmethod
    def validate_single_locale(cls, value: str) -> str:
        return _normalize_locale(value)

    @field_validator("enabled")
    @classmethod
    def validate_enabled(cls, values: list[str]) -> list[str]:
        normalized = list(dict.fromkeys(_normalize_locale(value) for value in values))
        if not normalized:
            raise ValueError("languages.enabled must contain at least one locale.")
        return normalized

    @model_validator(mode="after")
    def validate_language_membership(self) -> "SurveyLanguages":
        if self.source_locale not in self.enabled or self.default_locale not in self.enabled:
            raise ValueError(
                "languages.sourceLocale and defaultLocale must be included in enabled."
            )
        return self


def _normalize_locale(value: str) -> str:
    locale = value.strip().replace("_", "-")
    parts = locale.split("-")
    if (
        len(locale) > 20
        or not 1 <= len(parts)
        or not parts[0].isalpha()
        or not 2 <= len(parts[0]) <= 8
    ):
        raise ValueError("locale must be a BCP 47 language tag such as ko or en-US.")
    normalized = [parts[0].lower()]
    for part in parts[1:]:
        if not part.isalnum() or not 1 <= len(part) <= 8:
            raise ValueError("locale must be a BCP 47 language tag such as ko or en-US.")
        if len(part) == 4 and part.isalpha():
            normalized.append(part.title())
        elif (len(part) == 2 and part.isalpha()) or (
            len(part) == 3 and part.isdigit()
        ):
            normalized.append(part.upper())
        else:
            normalized.append(part.lower())
    return "-".join(normalized)


class SurveyLocaleMixin(ApiModel):
    languages: SurveyLanguages = Field(default_factory=SurveyLanguages)
    default_locale: str = "ko"
    supported_locales: list[str] = Field(default_factory=lambda: ["ko"], max_length=20)
    translations: dict[str, SurveyTranslation] = Field(default_factory=dict)

    @field_validator("default_locale")
    @classmethod
    def validate_default_locale(cls, value: str) -> str:
        return _normalize_locale(value)

    @field_validator("supported_locales")
    @classmethod
    def validate_supported_locales(cls, values: list[str]) -> list[str]:
        normalized = list(dict.fromkeys(_normalize_locale(value) for value in values))
        if not normalized:
            raise ValueError("supportedLocales must contain at least one locale.")
        return normalized

    @field_validator("translations")
    @classmethod
    def validate_translation_locales(
        cls, values: dict[str, SurveyTranslation]
    ) -> dict[str, SurveyTranslation]:
        return {_normalize_locale(key): value for key, value in values.items()}

    @model_validator(mode="after")
    def validate_locale_contract(self) -> "SurveyLocaleMixin":
        # `languages` is the canonical editor contract; the two legacy fields
        # are mirrored for older clients and persisted snapshots.
        fields_set = self.model_fields_set
        if "languages" in fields_set:
            self.default_locale = self.languages.default_locale
            self.supported_locales = list(self.languages.enabled)
        else:
            self.languages = SurveyLanguages(
                source_locale=self.default_locale,
                default_locale=self.default_locale,
                enabled=list(self.supported_locales),
            )
        if self.default_locale not in self.supported_locales:
            raise ValueError("defaultLocale must be included in supportedLocales.")
        unsupported = set(self.translations) - set(self.supported_locales)
        if unsupported:
            raise ValueError(
                "translations contain unsupported locales: " + ", ".join(sorted(unsupported))
            )
        sections = getattr(self, "sections", None)
        if sections is not None:
            validate_translation_references(self.translations, sections)
            validate_audience_references(sections, getattr(self, "settings", None))
        return self


class SurveyTemplate(SurveyLocaleMixin):
    code: str
    title: str
    description: str
    category: str
    tags: list[str] = Field(default_factory=list)
    sections: list[SurveySection]
    settings: SurveySettings = Field(default_factory=SurveySettings)
    theme: SurveyTheme = Field(default_factory=SurveyTheme)
    skin: dict[str, Any] = Field(default_factory=dict)
    logic_rules: list[dict[str, Any]] = Field(default_factory=list, max_length=500)
    version_no: int = Field(default=1, ge=1)

    @field_validator("skin")
    @classmethod
    def validate_skin(cls, value: dict[str, Any]) -> dict[str, Any]:
        return _validate_skin_assets(value) or {}

    @computed_field
    @property
    def id(self) -> str:
        return self.code

    @computed_field
    @property
    def name(self) -> str:
        return self.title

    @computed_field
    @property
    def questions(self) -> list[Question]:
        return [
            question.model_copy(deep=True)
            for section in self.sections
            for question in section.questions
        ]

    @computed_field
    @property
    def question_count(self) -> int:
        return sum(len(section.questions) for section in self.sections)

    @computed_field
    @property
    def has_logic(self) -> bool:
        return bool(self.logic_rules) or any(
            question.activation_condition is not None
            for section in self.sections
            for question in section.questions
        )

    @model_validator(mode="after")
    def validate_activation_conditions(self) -> "SurveyTemplate":
        if not self.skin:
            self.skin = {
                "preset": self.theme.code,
                "primary": self.theme.primary_color,
                "surface": self.theme.background_color,
                "card": self.theme.card_color,
                "font": self.theme.font_family,
                "headerImageUrl": self.theme.logo_url,
            }
        validate_question_activation_references(self.sections)
        return self


class SurveyStatus(str, Enum):
    DRAFT = "draft"
    PUBLISHED = "published"
    CLOSED = "closed"
    DELETED = "deleted"


class AdminTemplateStatus(str, Enum):
    DRAFT = "draft"
    ACTIVE = "active"
    ARCHIVED = "archived"
    DELETED = "deleted"


class AdminTemplateDraftRequest(ApiModel):
    title: str = Field(min_length=1, max_length=500)
    template_code: str | None = Field(
        default=None,
        min_length=3,
        max_length=50,
        pattern=r"^[a-z0-9][a-z0-9-]{2,49}$",
    )


class AdminTemplateDraftView(ApiModel):
    survey_id: str
    source_survey_id: str
    template_code: str | None = None
    revision: int


class AdminTemplatePublishRequest(ApiModel):
    source_survey_id: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)
    category: str = Field(min_length=1, max_length=100)


class AdminTemplatePatchRequest(ApiModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    category: str | None = Field(default=None, min_length=1, max_length=100)
    status: AdminTemplateStatus | None = None

    @model_validator(mode="after")
    def require_change(self) -> "AdminTemplatePatchRequest":
        if not self.model_fields_set:
            raise ValueError("At least one template field must be supplied.")
        if any(getattr(self, field_name) is None for field_name in self.model_fields_set):
            raise ValueError("Template fields cannot be null.")
        if self.status == AdminTemplateStatus.DELETED:
            raise ValueError("Use the template delete endpoint to delete a template.")
        return self


class AdminTemplateView(ApiModel):
    code: str
    title: str
    description: str
    category: str
    status: AdminTemplateStatus
    version_no: int = Field(ge=0)
    source_survey_id: str | None = None
    draft_only: bool = False
    question_count: int = Field(ge=0)
    use_count: int = Field(default=0, ge=0)
    published_at: datetime | None = None
    updated_at: datetime


class DeliveryChannel(str, Enum):
    EMAIL = "EMAIL"
    SMS = "SMS"
    KAKAO = "KAKAO"
    FAX = "FAX"


class DeliveryRecipientInput(ApiModel):
    id: StableId = Field(default_factory=lambda: uuid4().hex[:12])
    name: str = Field(min_length=1, max_length=200)
    country_code: str = Field(min_length=2, max_length=3, pattern=r"^[A-Z]{2,3}$")
    preferred_language: str
    email: str | None = Field(default=None, max_length=320)
    mobile: str | None = Field(default=None, max_length=80)
    fax: str | None = Field(default=None, max_length=80)
    kakao_id: str | None = Field(default=None, max_length=200)
    channels: list[DeliveryChannel] = Field(min_length=1, max_length=4)

    @field_validator("preferred_language")
    @classmethod
    def validate_preferred_language(cls, value: str) -> str:
        return _normalize_locale(value)

    @field_validator("email", "mobile", "fax", "kakao_id")
    @classmethod
    def normalize_contact(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @model_validator(mode="after")
    def validate_available_channels(self) -> "DeliveryRecipientInput":
        if len(self.channels) != len(set(self.channels)):
            raise ValueError("응답자별 발송 채널은 중복해서 선택할 수 없습니다.")
        channel_fields = {
            DeliveryChannel.EMAIL: self.email,
            DeliveryChannel.SMS: self.mobile,
            DeliveryChannel.KAKAO: self.kakao_id,
            DeliveryChannel.FAX: self.fax,
        }
        missing = [channel.value for channel in self.channels if not channel_fields[channel]]
        if missing:
            raise ValueError(
                "선택한 발송 채널에 필요한 연락처가 없습니다: " + ", ".join(missing)
            )
        if self.email and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", self.email):
            raise ValueError("유효한 이메일 주소를 입력해 주세요.")
        return self


class DeliveryMessages(ApiModel):
    email_subject: str = Field(default="", max_length=500)
    email_body: str = Field(default="", max_length=CUSTOM_SOURCE_MAX_BYTES)
    sms_body: str = Field(default="", max_length=1000)
    kakao_body: str = Field(default="", max_length=1000)
    fax_title: str = Field(default="", max_length=500)
    fax_body: str = Field(default="", max_length=CUSTOM_SOURCE_MAX_BYTES)

    @field_validator("email_body", "fax_body")
    @classmethod
    def validate_lob_message_size(cls, value: str) -> str:
        if len(value.encode("utf-8")) > CUSTOM_SOURCE_MAX_BYTES:
            raise ValueError("HTML 안내문은 UTF-8 기준 512KB 이하로 작성해 주세요.")
        return value


class DeliveryRecipientImportView(ApiModel):
    recipients: list[DeliveryRecipientInput]
    total: int = Field(ge=1, le=2000)
    file_type: Literal["csv", "txt", "xlsx"]
    encoding: str | None = None


class DeliverySchedule(ApiModel):
    mode: Literal["NOW", "SCHEDULED"] = "NOW"
    scheduled_at: datetime | None = None
    strategy: Literal["ALL_AVAILABLE", "PRIORITY_FALLBACK"] = "ALL_AVAILABLE"
    priority: list[DeliveryChannel] = Field(default_factory=list, max_length=4)

    @field_validator("scheduled_at")
    @classmethod
    def normalize_scheduled_at(cls, value: datetime | None) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("예약 발송 시각에는 시간대 정보가 포함되어야 합니다.")
        return value.astimezone(timezone.utc)

    @model_validator(mode="after")
    def validate_schedule(self) -> "DeliverySchedule":
        if len(self.priority) != len(set(self.priority)):
            raise ValueError("대체 발송 우선순위에는 같은 채널을 중복할 수 없습니다.")
        if self.mode == "SCHEDULED" and self.scheduled_at is None:
            raise ValueError("예약 발송 시각을 입력해 주세요.")
        if (
            self.mode == "SCHEDULED"
            and self.scheduled_at is not None
            and self.scheduled_at <= datetime.now(timezone.utc)
        ):
            raise ValueError("예약 발송 시각은 현재 시각보다 이후여야 합니다.")
        if self.mode == "NOW":
            self.scheduled_at = None
        return self


class DeploymentDraftRequest(ApiModel):
    revision: int | None = Field(default=None, ge=1)
    recipients: list[DeliveryRecipientInput] = Field(default_factory=list, max_length=2000)
    channels: list[DeliveryChannel] = Field(default_factory=list, max_length=4)
    messages_by_language: dict[str, DeliveryMessages] = Field(
        default_factory=dict, max_length=20
    )
    schedule: DeliverySchedule = Field(default_factory=DeliverySchedule)
    status: Literal["DRAFT"] = "DRAFT"

    @field_validator("messages_by_language")
    @classmethod
    def normalize_message_locales(
        cls, value: dict[str, DeliveryMessages]
    ) -> dict[str, DeliveryMessages]:
        return {_normalize_locale(locale): messages for locale, messages in value.items()}

    @model_validator(mode="after")
    def validate_delivery_plan(self) -> "DeploymentDraftRequest":
        recipient_ids = [recipient.id for recipient in self.recipients]
        if len(recipient_ids) != len(set(recipient_ids)):
            raise ValueError("배포 대상자 ID는 배포 계획 안에서 고유해야 합니다.")
        if len(self.channels) != len(set(self.channels)):
            raise ValueError("배포 채널은 중복해서 선택할 수 없습니다.")
        # A draft can be saved before STEP 01 recipients or STEP 02 channels are
        # complete. Recipient rows that are present are still individually valid;
        # execution uses DeploymentExecuteRequest below to require the full plan.
        if not self.recipients or not self.channels:
            return self
        selected = set(self.channels)
        unreachable = [
            recipient.id
            for recipient in self.recipients
            if not selected.intersection(recipient.channels)
        ]
        if unreachable:
            raise ValueError(
                "선택한 채널로 전송할 수 없는 대상자가 있습니다: "
                + ", ".join(unreachable[:10])
            )
        unavailable = [
            channel.value
            for channel in self.channels
            if not any(channel in recipient.channels for recipient in self.recipients)
        ]
        if unavailable:
            raise ValueError(
                "선택한 채널로 전송 가능한 대상자가 없습니다: "
                + ", ".join(unavailable)
            )
        recipient_locales = {recipient.preferred_language for recipient in self.recipients}
        missing_locales = recipient_locales - set(self.messages_by_language)
        if missing_locales:
            raise ValueError(
                "선호 언어별 안내문이 없습니다: " + ", ".join(sorted(missing_locales))
            )
        required_fields = {
            DeliveryChannel.EMAIL: ("email_subject", "email_body"),
            DeliveryChannel.SMS: ("sms_body",),
            DeliveryChannel.KAKAO: ("kakao_body",),
            DeliveryChannel.FAX: ("fax_title", "fax_body"),
        }
        required_by_locale: dict[str, set[DeliveryChannel]] = {
            locale: set() for locale in recipient_locales
        }
        for recipient in self.recipients:
            required_by_locale[recipient.preferred_language].update(
                selected.intersection(recipient.channels)
            )
        for locale in recipient_locales:
            messages = self.messages_by_language[locale]
            for channel in required_by_locale[locale]:
                for field_name in required_fields[channel]:
                    if not getattr(messages, field_name).strip():
                        raise ValueError(
                            f"{locale} 안내문의 {channel.value} 필수 문안을 입력해 주세요."
                        )
        if self.schedule.strategy == "PRIORITY_FALLBACK":
            if (
                set(self.schedule.priority) != selected
                or len(self.schedule.priority) != len(selected)
            ):
                raise ValueError("대체 발송 우선순위에는 선택한 채널을 모두 한 번씩 포함해 주세요.")
        return self


class DeploymentExecuteRequest(DeploymentDraftRequest):
    recipients: list[DeliveryRecipientInput] = Field(min_length=1, max_length=2000)
    channels: list[DeliveryChannel] = Field(min_length=1, max_length=4)
    messages_by_language: dict[str, DeliveryMessages] = Field(
        min_length=1, max_length=20
    )


class DeploymentDraftView(DeploymentDraftRequest):
    deployment_id: str
    survey_id: str
    survey_version: int
    public_slug: str
    revision: int
    updated_at: datetime
    execution_status: str | None = None


class DeliveryProviderView(ApiModel):
    enabled: bool
    status: Literal["READY", "DISABLED"]
    provider_code: str
    reason: str


class DeliveryProvidersView(ApiModel):
    providers: dict[str, DeliveryProviderView]


class DeliveryChannelResult(ApiModel):
    channel: DeliveryChannel
    status: Literal["QUEUED", "DISABLED"]
    count: int = Field(ge=0)
    reason: str | None = None


class DeploymentExecutionView(ApiModel):
    execution_status: Literal["QUEUED", "PARTIAL", "DISABLED"]
    channel_results: list[DeliveryChannelResult]


class DeploymentExecuteResult(ApiModel):
    deployment: DeploymentDraftView
    execution: DeploymentExecutionView


class PopulationMode(str, Enum):
    KNOWN = "known"
    UNKNOWN = "unknown"


class SurveyProjectProfile(ApiModel):
    starts_at: datetime | None = None
    closes_at: datetime | None = None
    identified: bool = False
    show_progress: bool = True
    target_audience: str | None = Field(default=None, max_length=1000)
    population_mode: PopulationMode = PopulationMode.UNKNOWN
    population_size: int | None = Field(default=None, ge=1, le=1_000_000_000)
    target_response_count: int | None = Field(default=None, ge=1, le=1_000_000_000)

    @field_validator("starts_at", "closes_at")
    @classmethod
    def normalize_aware_datetime(cls, value: datetime | None) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("조사 기간에는 시간대 정보가 포함되어야 합니다.")
        return value.astimezone(timezone.utc)

    @model_validator(mode="after")
    def validate_profile(self) -> "SurveyProjectProfile":
        if self.starts_at and self.closes_at and self.starts_at >= self.closes_at:
            raise ValueError("조사 시작일은 종료일보다 빨라야 합니다.")
        if self.population_mode == PopulationMode.KNOWN and self.population_size is None:
            raise ValueError("모집단 크기를 알고 있는 경우 모집단 크기를 입력해 주세요.")
        if self.population_mode == PopulationMode.UNKNOWN and self.population_size is not None:
            raise ValueError("모집단 크기를 모르는 경우 모집단 크기를 비워 주세요.")
        if (
            self.population_size is not None
            and self.target_response_count is not None
            and self.target_response_count > self.population_size
        ):
            raise ValueError("목표 응답자 수는 모집단 크기보다 클 수 없습니다.")
        return self


class SurveyTemplateApplyRequest(ApiModel):
    template_code: str = Field(min_length=1, max_length=100)
    expected_revision: int | None = Field(default=None, ge=1)


class SurveyTemplateResetRequest(ApiModel):
    expected_revision: int | None = Field(default=None, ge=1)


class SurveyCreateRequest(SurveyLocaleMixin):
    title: str | None = Field(default=None, max_length=500)
    description: str | None = Field(default=None, max_length=4000)
    category: str | None = Field(default=None, max_length=100)
    template_code: str | None = Field(default=None, max_length=100)
    template_id: str | None = Field(default=None, max_length=100)
    sections: list[SurveySection] | None = Field(default=None, max_length=100)
    questions: list[Question] | None = Field(default=None, max_length=500)
    settings: SurveySettings | None = None
    theme: SurveyTheme | None = None
    skin: dict[str, Any] | None = None
    project_profile: SurveyProjectProfile = Field(default_factory=SurveyProjectProfile)
    logic_rules: list[dict[str, Any]] = Field(default_factory=list, max_length=500)

    @field_validator("skin")
    @classmethod
    def validate_skin(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        return _validate_skin_assets(value)

    @model_validator(mode="after")
    def validate_activation_conditions(self) -> "SurveyCreateRequest":
        if self.sections is not None:
            validate_question_activation_references(self.sections)
            validate_audience_references(self.sections, self.settings)
        elif self.questions is not None:
            validate_question_activation_references(
                [SurveySection(title="설문 문항", questions=self.questions)]
            )
        return self


class SurveyUpdateRequest(ApiModel):
    expected_revision: int | None = Field(default=None, ge=1)
    title: str | None = Field(default=None, max_length=500)
    description: str | None = Field(default=None, max_length=4000)
    category: str | None = Field(default=None, min_length=1, max_length=100)
    sections: list[SurveySection] | None = Field(default=None, max_length=100)
    questions: list[Question] | None = Field(default=None, max_length=500)
    settings: SurveySettings | None = None
    theme: SurveyTheme | None = None
    skin: dict[str, Any] | None = None
    project_profile: SurveyProjectProfile | None = None
    logic_rules: list[dict[str, Any]] | None = Field(default=None, max_length=500)
    default_locale: str | None = None
    supported_locales: list[str] | None = Field(default=None, max_length=20)
    translations: dict[str, SurveyTranslation] | None = None
    languages: SurveyLanguages | None = None

    @field_validator("skin")
    @classmethod
    def validate_skin(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        return _validate_skin_assets(value)
    source_locale_promotion_from: str | None = None

    @field_validator("default_locale")
    @classmethod
    def validate_optional_default_locale(cls, value: str | None) -> str | None:
        return _normalize_locale(value) if value is not None else None

    @field_validator("source_locale_promotion_from")
    @classmethod
    def validate_promotion_source(cls, value: str | None) -> str | None:
        return _normalize_locale(value) if value is not None else None

    @field_validator("supported_locales")
    @classmethod
    def validate_optional_supported_locales(
        cls, values: list[str] | None
    ) -> list[str] | None:
        if values is None:
            return None
        normalized = list(dict.fromkeys(_normalize_locale(value) for value in values))
        if not normalized:
            raise ValueError("supportedLocales must contain at least one locale.")
        return normalized

    @field_validator("translations")
    @classmethod
    def validate_optional_translation_locales(
        cls, values: dict[str, SurveyTranslation] | None
    ) -> dict[str, SurveyTranslation] | None:
        if values is None:
            return None
        return {_normalize_locale(key): value for key, value in values.items()}

    @model_validator(mode="after")
    def validate_translation_targets_when_sections_are_present(
        self,
    ) -> "SurveyUpdateRequest":
        if self.sections is not None and self.translations is not None:
            validate_translation_references(self.translations, self.sections)
        if self.sections is not None:
            validate_question_activation_references(self.sections)
            validate_audience_references(self.sections, self.settings)
        elif self.questions is not None:
            validate_question_activation_references(
                [SurveySection(title="설문 문항", questions=self.questions)]
            )
        return self


class SurveySummary(ApiModel):
    id: str
    title: str
    category: str
    status: SurveyStatus
    response_count: int
    question_count: int
    published_version: int | None = None
    slug: str | None = None
    public_url: str | None = None
    deployment_status: Literal["READY", "ACTIVE"] | None = None
    starts_at: datetime | None = None
    closes_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    published_at: datetime | None = None


class SurveyPage(ApiModel):
    items: list[SurveySummary]
    page: int = Field(ge=1)
    page_size: int = Field(ge=1, le=100)
    total: int = Field(ge=0)
    total_all: int = Field(ge=0)
    has_next: bool


class SurveyDetail(SurveySummary):
    description: str | None = None
    template_code: str | None = None
    template_version_no: int | None = None
    revision: int
    sections: list[SurveySection]
    settings: SurveySettings
    theme: SurveyTheme
    skin: dict[str, Any] = Field(default_factory=dict)
    project_profile: SurveyProjectProfile = Field(default_factory=SurveyProjectProfile)
    logic_rules: list[dict[str, Any]] = Field(default_factory=list)
    default_locale: str = "ko"
    supported_locales: list[str] = Field(default_factory=lambda: ["ko"])
    translations: dict[str, SurveyTranslation] = Field(default_factory=dict)
    languages: SurveyLanguages = Field(default_factory=SurveyLanguages)

    @field_validator("skin")
    @classmethod
    def validate_skin(cls, value: dict[str, Any]) -> dict[str, Any]:
        return _validate_skin_assets(value) or {}

    @model_validator(mode="after")
    def validate_translation_targets(self) -> "SurveyDetail":
        validate_translation_references(self.translations, self.sections)
        validate_audience_references(self.sections, self.settings)
        validate_question_activation_references(self.sections)
        return self

    @computed_field
    @property
    def questions(self) -> list[Question]:
        return [
            question.model_copy(deep=True)
            for section in self.sections
            for question in section.questions
        ]


class PublishRequest(ApiModel):
    slug: str | None = Field(default=None, min_length=3, max_length=80)

    @field_validator("slug")
    @classmethod
    def normalize_slug(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().lower()
        if any(character not in "abcdefghijklmnopqrstuvwxyz0123456789-" for character in normalized):
            raise ValueError("slug may contain lowercase letters, numbers, and hyphens only.")
        if normalized.startswith("-") or normalized.endswith("-") or "--" in normalized:
            raise ValueError("slug cannot start/end with a hyphen or contain repeated hyphens.")
        return normalized


class PublishResult(ApiModel):
    survey_id: str
    slug: str
    version: int
    public_url: str
    content_hash: str
    published_at: datetime


class PublicUrlRegenerationResult(ApiModel):
    survey_id: str
    previous_slug: str
    slug: str
    public_url: str
    deployment_revision: int | None = None
    regenerated_at: datetime


class PublicSurvey(SurveyLocaleMixin):
    audience_code: str | None = None
    survey_id: str
    slug: str
    version: int
    title: str
    description: str | None = None
    category: str
    sections: list[SurveySection]
    settings: SurveySettings
    theme: SurveyTheme
    skin: dict[str, Any] = Field(default_factory=dict)
    project_profile: SurveyProjectProfile = Field(default_factory=SurveyProjectProfile)
    logic_rules: list[dict[str, Any]] = Field(default_factory=list)
    published_at: datetime
    requested_locale: str | None = None
    guest_demo: bool = False
    experience_expires_at: datetime | None = None
    server_time: datetime | None = None
    availability_status: Literal["SCHEDULED", "OPEN", "CLOSED"] | None = None

    @field_validator("skin")
    @classmethod
    def validate_skin(cls, value: dict[str, Any]) -> dict[str, Any]:
        return _validate_skin_assets(value) or {}

    @model_validator(mode="after")
    def validate_activation_conditions(self) -> "PublicSurvey":
        validate_question_activation_references(self.sections)
        return self

    @computed_field
    @property
    def questions(self) -> list[Question]:
        return [
            question.model_copy(deep=True)
            for section in self.sections
            for question in section.questions
        ]


class AnswerItem(ApiModel):
    question_id: StableId
    value: Any = None


class SubmitResponseRequest(ApiModel):
    audience_code: str | None = Field(default=None, max_length=40)
    answers: list[AnswerItem] = Field(default_factory=list, max_length=1000)
    respondent_key: str | None = Field(default=None, max_length=200)
    metadata: dict[str, str] = Field(default_factory=dict)

    @model_validator(mode="before")
    @classmethod
    def normalize_public_submission(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        payload = dict(value)
        raw_answers = payload.get("answers")
        if isinstance(raw_answers, dict):
            payload["answers"] = [
                {"questionId": question_id, "value": answer_value}
                for question_id, answer_value in raw_answers.items()
            ]
        client = payload.get("client")
        if isinstance(client, dict):
            metadata = dict(payload.get("metadata") or {})
            for key, item in client.items():
                metadata.setdefault(f"client.{key}", str(item))
            payload["metadata"] = metadata
        return payload

    @model_validator(mode="after")
    def validate_answer_ids(self) -> "SubmitResponseRequest":
        identifiers = [answer.question_id for answer in self.answers]
        if len(identifiers) != len(set(identifiers)):
            raise ValueError("Each question can be answered only once.")
        if len(self.metadata) > 30:
            raise ValueError("metadata supports at most 30 entries.")
        _validate_public_json_shape(self.model_dump(by_alias=True, mode="python"))
        serialized = self.model_dump(by_alias=True, mode="json")
        encoded = json.dumps(
            serialized,
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        if len(encoded) > get_settings().public_submit_max_bytes:
            raise ValueError("Submission JSON exceeds the configured byte limit.")
        return self


class ResponseReceipt(ApiModel):
    response_id: str
    survey_id: str
    survey_version: int
    submitted_at: datetime
    message: str


class SurveyResponseView(ApiModel):
    id: str
    survey_id: str
    survey_version: int
    answers: list[AnswerItem]
    respondent_key: str | None = None
    metadata: dict[str, str]
    submitted_at: datetime


class QuestionReport(ApiModel):
    question_id: str
    title: str
    type: QuestionType
    response_count: int
    option_counts: dict[str, int] = Field(default_factory=dict)
    row_counts: dict[str, dict[str, int]] = Field(default_factory=dict)
    row_labels: dict[str, str] = Field(default_factory=dict)
    column_labels: dict[str, str] = Field(default_factory=dict)
    average: float | None = None
    text_samples: list[str] = Field(default_factory=list)

    @computed_field
    @property
    def distribution(self) -> dict[str, int]:
        return dict(self.option_counts)


class SurveyReport(ApiModel):
    survey_id: str
    title: str
    total_responses: int
    completed_responses: int
    partial_responses: int
    completion_rate: float = Field(ge=0, le=1)
    published_version: int | None = None
    generated_at: datetime
    questions: list[QuestionReport]


class DashboardTrendPoint(ApiModel):
    date: date
    responses: int = Field(ge=0)


class DashboardView(ApiModel):
    total_surveys: int
    draft_surveys: int
    published_surveys: int
    closed_surveys: int
    total_responses: int
    today_responses: int = Field(default=0, ge=0)
    response_trend: list[DashboardTrendPoint] = Field(default_factory=list)
    recent_surveys: list[SurveySummary]

    @computed_field
    @property
    def summary(self) -> dict[str, int]:
        return {
            "drafts": self.draft_surveys,
            "active": self.published_surveys,
            "closed": self.closed_surveys,
            "responses": self.total_responses,
        }
