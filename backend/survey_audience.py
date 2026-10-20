"""Version-bound URL audience selection shared by both repositories."""
from __future__ import annotations

from backend.errors import DomainValidationError
from backend.models import (
    PublicSurvey, SubmitResponseRequest, SurveySection, SurveySettings,
    validate_audience_references,
)


def validate_audiences(sections: list[SurveySection], settings: SurveySettings) -> None:
    try:
        validate_audience_references(sections, settings)
    except ValueError as exc:
        raise DomainValidationError(str(exc)) from exc


def resolve_audience(survey: PublicSurvey, code: str | None) -> str | None:
    resolved = code if code is not None else survey.settings.default_audience
    if resolved is not None and resolved not in {route.code for route in survey.settings.audience_routes}:
        raise DomainValidationError("설문 대상 구분자가 올바르지 않습니다. 안내받은 URL을 확인해 주세요.")
    return resolved


def audience_submission(
    survey: PublicSurvey, request: SubmitResponseRequest,
) -> tuple[PublicSurvey, SubmitResponseRequest]:
    code = resolve_audience(survey, request.audience_code)
    metadata = {key: value for key, value in request.metadata.items() if key != "audienceCode"}
    if code is None:
        return survey, request.model_copy(update={"metadata": metadata})
    route = next(route for route in survey.settings.audience_routes if route.code == code)
    metadata["audienceCode"] = code
    selected = survey.model_copy(update={
        "audience_code": code,
        "sections": [section for section in survey.sections if section.id in route.section_ids],
    })
    return selected, request.model_copy(update={"audience_code": code, "metadata": metadata})
