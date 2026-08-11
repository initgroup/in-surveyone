from __future__ import annotations

import json
import math
import re
from datetime import datetime
from enum import Enum
from typing import Any, Generic, Literal, TypeVar
from uuid import uuid4

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
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
SAFE_ASSET_PREFIXES = ("/frontend/assets/", "/uploads/")
HEX_COLOR_PATTERN = re.compile(r"^#[0-9A-Fa-f]{6}$")
RADIUS_PATTERN = re.compile(r"^(?:0|[1-9][0-9]?)px$")


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
    LOCAL = "local"
    DATABASE = "database"


class UserView(ApiModel):
    id: str
    login_id: str
    name: str
    email: str | None = None
    tenant_id: str
    organization_name: str
    role: UserRole
    is_guest: bool
    guest_mode: GuestMode | None = None
    created_at: datetime


class GuestSessionRequest(ApiModel):
    display_name: str = Field(default="게스트", min_length=1, max_length=60)
    mode: GuestMode = GuestMode.LOCAL


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

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str | None) -> str | None:
        if value is not None and ("@" not in value or value.startswith("@") or value.endswith("@")):
            raise ValueError("A valid email address is required.")
        return value


class LoginRequest(ApiModel):
    login_id: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=1, max_length=128)


class AuthSessionView(ApiModel):
    user: UserView
    expires_at: datetime


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
    id: str = Field(default_factory=lambda: uuid4().hex[:12], min_length=1, max_length=80)
    label: str = Field(min_length=1, max_length=500)


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
    max_selections: int | None = Field(default=None, ge=1)
    allow_other: bool = False
    shuffle_options: bool = False

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
        for field_name in ("rows", "columns"):
            identifiers = [item.id for item in getattr(self, field_name)]
            if len(identifiers) != len(set(identifiers)):
                raise ValueError(f"settings.{field_name} IDs must be unique.")
        return self


class Question(ApiModel):
    id: str = Field(default_factory=lambda: uuid4().hex[:12], min_length=1, max_length=80)
    type: QuestionType
    title: str = Field(min_length=1, max_length=1000)
    description: str | None = Field(default=None, max_length=4000)
    required: bool = False
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
        option_types = {
            QuestionType.SINGLE_CHOICE,
            QuestionType.MULTIPLE_CHOICE,
            QuestionType.DROPDOWN,
        }
        if self.type in option_types and not self.options:
            raise ValueError(f"{self.type.value} questions require at least one option.")
        if self.type == QuestionType.MATRIX and (
            not self.settings.rows or not self.settings.columns
        ):
            raise ValueError("matrix questions require rows and columns.")
        if self.type in {QuestionType.TABLE, QuestionType.REPEAT_TABLE} and (
            not self.settings.rows or not self.settings.columns
        ):
            raise ValueError("table questions require rows and columns.")
        if self.type == QuestionType.TEXT and self.required:
            raise ValueError("text blocks cannot be required.")
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
        if self.type == QuestionType.SCALE:
            if self.min is None or self.max is None:
                raise ValueError("scale questions require min and max values.")
            if not float(self.min).is_integer() or not float(self.max).is_integer():
                raise ValueError("scale min and max must be integers.")
            if self.min not in {0, 1}:
                raise ValueError("scale min must be either 0 or 1.")
            if self.min >= self.max:
                raise ValueError("scale min must be less than max.")
            if not 2 <= self.max <= 10:
                raise ValueError("scale max must be between 2 and 10.")
            if self.settings.step is not None and self.settings.step != 1:
                raise ValueError("scale step must be 1.")
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
    id: str = Field(default_factory=lambda: uuid4().hex[:12], min_length=1, max_length=80)
    title: str = Field(default="새 섹션", min_length=1, max_length=500)
    description: str | None = Field(default=None, max_length=4000)
    questions: list[Question] = Field(default_factory=list, max_length=500)

    @model_validator(mode="after")
    def validate_question_ids(self) -> "SurveySection":
        identifiers = [question.id for question in self.questions]
        if len(identifiers) != len(set(identifiers)):
            raise ValueError("Question IDs must be unique within a section.")
        return self


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


class SurveySettings(ApiModel):
    collect_email: bool = False
    show_progress_bar: bool = True
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
        if self.starts_at and self.closes_at and self.starts_at >= self.closes_at:
            raise ValueError("startsAt must be earlier than closesAt.")
        if self.show_progress is None:
            self.show_progress = self.show_progress_bar
        if self.one_response is None:
            self.one_response = self.one_response_per_respondent
        if self.allow_edit is None:
            self.allow_edit = self.allow_response_edit
        return self


class SurveyQuestionTranslation(ApiModel):
    title: str | None = Field(default=None, max_length=1000)
    description: str | None = Field(default=None, max_length=4000)
    options: dict[str, str] = Field(default_factory=dict)
    rows: dict[str, str] = Field(default_factory=dict)
    columns: dict[str, str] = Field(default_factory=dict)
    min_label: str | None = Field(default=None, max_length=100)
    max_label: str | None = Field(default=None, max_length=100)
    unit: str | None = Field(default=None, max_length=30)


class SurveySectionTranslation(ApiModel):
    title: str | None = Field(default=None, max_length=500)
    description: str | None = Field(default=None, max_length=4000)
    questions: dict[str, SurveyQuestionTranslation] = Field(default_factory=dict)


class SurveyTranslation(ApiModel):
    """Locale overlay keyed by stable section/question/option identifiers."""

    title: str | None = Field(default=None, max_length=500)
    description: str | None = Field(default=None, max_length=4000)
    confirmation_message: str | None = Field(default=None, max_length=2000)
    sections: dict[str, SurveySectionTranslation] = Field(default_factory=dict)
    # Flat maps remain accepted for early editor payload compatibility.
    section_titles: dict[str, str] = Field(default_factory=dict)
    section_descriptions: dict[str, str] = Field(default_factory=dict)
    question_titles: dict[str, str] = Field(default_factory=dict)
    question_descriptions: dict[str, str] = Field(default_factory=dict)
    option_labels: dict[str, dict[str, str]] = Field(default_factory=dict)


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
    def skin(self) -> dict[str, Any]:
        return {
            "preset": self.theme.code,
            "primary": self.theme.primary_color,
            "surface": self.theme.background_color,
            "card": self.theme.card_color,
            "font": self.theme.font_family,
            "headerImageUrl": self.theme.logo_url,
        }


class SurveyStatus(str, Enum):
    DRAFT = "draft"
    PUBLISHED = "published"
    CLOSED = "closed"


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
    logic_rules: list[dict[str, Any]] = Field(default_factory=list, max_length=500)

    @field_validator("skin")
    @classmethod
    def validate_skin(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        return _validate_skin_assets(value)


class SurveyUpdateRequest(ApiModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    description: str | None = Field(default=None, max_length=4000)
    category: str | None = Field(default=None, min_length=1, max_length=100)
    sections: list[SurveySection] | None = Field(default=None, max_length=100)
    questions: list[Question] | None = Field(default=None, max_length=500)
    settings: SurveySettings | None = None
    theme: SurveyTheme | None = None
    skin: dict[str, Any] | None = None
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
    created_at: datetime
    updated_at: datetime
    published_at: datetime | None = None


class SurveyDetail(SurveySummary):
    description: str | None = None
    template_code: str | None = None
    revision: int
    sections: list[SurveySection]
    settings: SurveySettings
    theme: SurveyTheme
    skin: dict[str, Any] = Field(default_factory=dict)
    logic_rules: list[dict[str, Any]] = Field(default_factory=list)
    default_locale: str = "ko"
    supported_locales: list[str] = Field(default_factory=lambda: ["ko"])
    translations: dict[str, SurveyTranslation] = Field(default_factory=dict)
    languages: SurveyLanguages = Field(default_factory=SurveyLanguages)

    @field_validator("skin")
    @classmethod
    def validate_skin(cls, value: dict[str, Any]) -> dict[str, Any]:
        return _validate_skin_assets(value) or {}

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


class PublicSurvey(SurveyLocaleMixin):
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
    logic_rules: list[dict[str, Any]] = Field(default_factory=list)
    published_at: datetime
    requested_locale: str | None = None
    guest_demo: bool = False
    experience_expires_at: datetime | None = None

    @field_validator("skin")
    @classmethod
    def validate_skin(cls, value: dict[str, Any]) -> dict[str, Any]:
        return _validate_skin_assets(value) or {}

    @computed_field
    @property
    def questions(self) -> list[Question]:
        return [
            question.model_copy(deep=True)
            for section in self.sections
            for question in section.questions
        ]


class AnswerItem(ApiModel):
    question_id: str = Field(min_length=1, max_length=80)
    value: Any = None


class SubmitResponseRequest(ApiModel):
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


class DashboardView(ApiModel):
    total_surveys: int
    draft_surveys: int
    published_surveys: int
    closed_surveys: int
    total_responses: int
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
