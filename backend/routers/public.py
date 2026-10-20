from __future__ import annotations

from fastapi import APIRouter, Header, Query

from backend.models import (
    ApiResponse,
    PublicSurvey,
    ResponseReceipt,
    SubmitResponseRequest,
)
from backend.stores import public_store
from backend.survey_audience import resolve_audience


router = APIRouter()


@router.get("/surveys/{slug}", response_model=ApiResponse[PublicSurvey])
def public_survey(
    slug: str,
    language: str | None = Query(default=None, alias="lang", max_length=20),
    audience: str | None = Query(default=None, max_length=40),
) -> ApiResponse[PublicSurvey]:
    store = public_store(slug)
    survey = store.public_survey(slug, language)
    return ApiResponse(data=survey.model_copy(update={"audience_code": resolve_audience(survey, audience)}))


@router.post(
    "/surveys/{slug}/responses",
    response_model=ApiResponse[ResponseReceipt],
    status_code=201,
)
def submit_response(
    slug: str,
    payload: SubmitResponseRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> ApiResponse[ResponseReceipt]:
    return ApiResponse(
        data=public_store(slug).submit_response(
            slug,
            payload,
            idempotency_key=idempotency_key,
        )
    )
