from __future__ import annotations

from datetime import date
from typing import Literal
from urllib.parse import urljoin

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response

from backend.config import get_settings
from backend.dependencies import current_store, current_user
from backend.errors import ConflictError
from backend.memory_store import UserRecord
from backend.models import (
    ApiResponse,
    PublishRequest,
    PublishResult,
    SurveyCreateRequest,
    SurveyDetail,
    SurveyReport,
    SurveyResponseView,
    SurveyStatus,
    SurveySummary,
    SurveyUpdateRequest,
)
from backend.stores import SurveyStore
from backend.qr_code import create_qr_svg


router = APIRouter()


@router.get("", response_model=ApiResponse[list[SurveySummary]])
def list_surveys(
    status: SurveyStatus | None = None,
    user: UserRecord = Depends(current_user),
    store: SurveyStore = Depends(current_store),
) -> ApiResponse[list[SurveySummary]]:
    return ApiResponse(data=store.list_surveys(user, status))


@router.post("", response_model=ApiResponse[SurveyDetail], status_code=201)
def create_survey(
    payload: SurveyCreateRequest,
    user: UserRecord = Depends(current_user),
    store: SurveyStore = Depends(current_store),
) -> ApiResponse[SurveyDetail]:
    return ApiResponse(data=store.create_survey(user, payload))


@router.get("/{survey_id}", response_model=ApiResponse[SurveyDetail])
def get_survey(
    survey_id: str,
    user: UserRecord = Depends(current_user),
    store: SurveyStore = Depends(current_store),
) -> ApiResponse[SurveyDetail]:
    return ApiResponse(data=store.get_survey(user, survey_id))


@router.get("/{survey_id}/qr.svg", response_class=Response)
def survey_qr_code(
    survey_id: str,
    user: UserRecord = Depends(current_user),
    store: SurveyStore = Depends(current_store),
) -> Response:
    survey = store.get_survey(user, survey_id)
    if not survey.public_url:
        raise ConflictError("설문을 배포한 후 QR 코드를 생성할 수 있습니다.")
    target = urljoin(f"{get_settings().base_url}/", survey.public_url)
    return Response(
        content=create_qr_svg(target),
        media_type="image/svg+xml",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate",
            "Content-Disposition": f'inline; filename="survey-{survey_id}-qr.svg"',
            "Content-Security-Policy": "default-src 'none'; sandbox",
            "X-Content-Type-Options": "nosniff",
            "X-QR-Target": target,
        },
    )


@router.put("/{survey_id}", response_model=ApiResponse[SurveyDetail])
@router.patch("/{survey_id}", response_model=ApiResponse[SurveyDetail])
def update_survey(
    survey_id: str,
    payload: SurveyUpdateRequest,
    user: UserRecord = Depends(current_user),
    store: SurveyStore = Depends(current_store),
) -> ApiResponse[SurveyDetail]:
    return ApiResponse(data=store.update_survey(user, survey_id, payload))


@router.post("/{survey_id}/publish", response_model=ApiResponse[PublishResult])
def publish_survey(
    survey_id: str,
    payload: PublishRequest | None = None,
    user: UserRecord = Depends(current_user),
    store: SurveyStore = Depends(current_store),
) -> ApiResponse[PublishResult]:
    return ApiResponse(data=store.publish(user, survey_id, payload or PublishRequest()))


@router.get(
    "/{survey_id}/responses",
    response_model=ApiResponse[list[SurveyResponseView]],
)
def list_responses(
    survey_id: str,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=200),
    user: UserRecord = Depends(current_user),
    store: SurveyStore = Depends(current_store),
) -> ApiResponse[list[SurveyResponseView]]:
    return ApiResponse(data=store.responses(user, survey_id, offset=offset, limit=limit))


@router.get("/{survey_id}/report", response_model=ApiResponse[SurveyReport])
def survey_report(
    survey_id: str,
    cutoff_date: date | None = Query(default=None, alias="cutoffDate"),
    status: Literal["all", "complete", "partial"] = Query(default="all"),
    response_status: str | None = Query(
        default=None,
        alias="responseStatus",
        pattern=r"^(?:ALL|COMPLETE|PARTIAL|all|complete|partial)$",
    ),
    user: UserRecord = Depends(current_user),
    store: SurveyStore = Depends(current_store),
) -> ApiResponse[SurveyReport]:
    selected_status = (response_status or status).lower()
    return ApiResponse(
        data=store.report(
            user,
            survey_id,
            cutoff_date=cutoff_date,
            response_status=selected_status,
        )
    )
