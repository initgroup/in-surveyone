from __future__ import annotations

import re
from datetime import date
from typing import Literal
from urllib.parse import quote, urljoin

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
    SurveyPublicLinks,
    PublicUrlRegenerationResult,
    SurveyCreateRequest,
    SurveyDetail,
    SurveyPage,
    SurveyReport,
    SurveyResponseView,
    SurveyStatus,
    SurveySummary,
    SurveyTemplateApplyRequest,
    SurveyTemplateResetRequest,
    SurveyUpdateRequest,
)
from backend.stores import SurveyStore
from backend.publication_links import public_links_view
from backend.qr_code import create_qr_svg
from backend.report_export import (
    ExportFormat,
    export_filename,
    render_report_html,
    render_report_pdf,
    render_report_xlsx,
)


router = APIRouter()


@router.get("", response_model=ApiResponse[list[SurveySummary]])
def list_surveys(
    status: SurveyStatus | None = None,
    stage: Literal["confirmed", "active"] | None = None,
    user: UserRecord = Depends(current_user),
    store: SurveyStore = Depends(current_store),
) -> ApiResponse[list[SurveySummary]]:
    return ApiResponse(data=store.list_surveys(user, status, stage=stage))


@router.get("/page", response_model=ApiResponse[SurveyPage])
def page_surveys(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=24, alias="pageSize", ge=1, le=100),
    status: SurveyStatus | None = None,
    stage: Literal["confirmed", "active"] | None = None,
    query: str = Query(default="", max_length=100),
    sort: Literal[
        "updated-desc", "updated-asc", "created-desc", "responses", "title"
    ] = "updated-desc",
    user: UserRecord = Depends(current_user),
    store: SurveyStore = Depends(current_store),
) -> ApiResponse[SurveyPage]:
    return ApiResponse(
        data=store.survey_page(
            user,
            page=page,
            page_size=page_size,
            status=status,
            stage=stage,
            query=query,
            sort=sort,
        )
    )


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


@router.post("/{survey_id}/template", response_model=ApiResponse[SurveyDetail])
def apply_survey_template(
    survey_id: str,
    payload: SurveyTemplateApplyRequest,
    user: UserRecord = Depends(current_user),
    store: SurveyStore = Depends(current_store),
) -> ApiResponse[SurveyDetail]:
    return ApiResponse(data=store.apply_template(user, survey_id, payload))


@router.post("/{survey_id}/template/reset", response_model=ApiResponse[SurveyDetail])
def reset_survey_template(
    survey_id: str,
    payload: SurveyTemplateResetRequest | None = None,
    user: UserRecord = Depends(current_user),
    store: SurveyStore = Depends(current_store),
) -> ApiResponse[SurveyDetail]:
    return ApiResponse(
        data=store.reset_template(
            user, survey_id, payload or SurveyTemplateResetRequest()
        )
    )


@router.get("/{survey_id}/qr.svg", response_class=Response)
def survey_qr_code(
    survey_id: str,
    user: UserRecord = Depends(current_user),
    store: SurveyStore = Depends(current_store),
) -> Response:
    survey = store.get_survey(user, survey_id)
    if not survey.public_url:
        raise ConflictError("설문을 확정한 후 QR 코드를 생성할 수 있습니다.")
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


@router.delete("/{survey_id}", response_model=ApiResponse[dict[str, bool]])
def delete_survey(
    survey_id: str,
    user: UserRecord = Depends(current_user),
    store: SurveyStore = Depends(current_store),
) -> ApiResponse[dict[str, bool]]:
    store.delete_survey(user, survey_id)
    return ApiResponse(data={"deleted": True})


@router.post("/{survey_id}/close", response_model=ApiResponse[SurveyDetail])
def close_survey(
    survey_id: str,
    user: UserRecord = Depends(current_user),
    store: SurveyStore = Depends(current_store),
) -> ApiResponse[SurveyDetail]:
    return ApiResponse(data=store.close_survey(user, survey_id))


@router.post("/{survey_id}/publish", response_model=ApiResponse[PublishResult])
def publish_survey(
    survey_id: str,
    payload: PublishRequest | None = None,
    user: UserRecord = Depends(current_user),
    store: SurveyStore = Depends(current_store),
) -> ApiResponse[PublishResult]:
    return ApiResponse(data=store.publish(user, survey_id, payload or PublishRequest()))


@router.get("/{survey_id}/public-links", response_model=ApiResponse[SurveyPublicLinks])
def survey_public_links(
    survey_id: str,
    user: UserRecord = Depends(current_user),
    store: SurveyStore = Depends(current_store),
) -> ApiResponse[SurveyPublicLinks]:
    detail = store.get_survey(user, survey_id)
    if not detail.slug or not detail.public_url:
        raise ConflictError("설문을 먼저 저장·확정한 뒤 대상별 URL을 확인해 주세요.")
    # Authorize the owner first, then use the active snapshot, never draft routes.
    return ApiResponse(data=public_links_view(store.public_survey(detail.slug)))


@router.post(
    "/{survey_id}/public-url/regenerate",
    response_model=ApiResponse[PublicUrlRegenerationResult],
)
def regenerate_public_url(
    survey_id: str,
    user: UserRecord = Depends(current_user),
    store: SurveyStore = Depends(current_store),
) -> ApiResponse[PublicUrlRegenerationResult]:
    return ApiResponse(data=store.regenerate_public_url(user, survey_id))


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


@router.get("/{survey_id}/report/export", response_class=Response)
def export_survey_report(
    survey_id: str,
    format: ExportFormat = Query(...),
    cutoff_date: date | None = Query(default=None, alias="cutoffDate"),
    status: Literal["all", "complete", "partial"] = Query(default="all"),
    response_status: str | None = Query(
        default=None,
        alias="responseStatus",
        pattern=r"^(?:ALL|COMPLETE|PARTIAL|all|complete|partial)$",
    ),
    user: UserRecord = Depends(current_user),
    store: SurveyStore = Depends(current_store),
) -> Response:
    selected_status = (response_status or status).lower()
    report = store.report(
        user,
        survey_id,
        cutoff_date=cutoff_date,
        response_status=selected_status,
    )
    if format == "xlsx":
        content = render_report_xlsx(
            report,
            cutoff_date=cutoff_date,
            response_status=selected_status,
        )
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    else:
        html_document = render_report_html(
            report,
            cutoff_date=cutoff_date,
            response_status=selected_status,
        )
        content = render_report_pdf(html_document)
        media_type = "application/pdf"
    filename = export_filename(report, format)
    safe_survey_id = re.sub(r"[^A-Za-z0-9_-]+", "", report.survey_id)[:24] or "survey"
    ascii_fallback = f"survey-report-{safe_survey_id}.{format}"
    return Response(
        content=content,
        media_type=media_type,
        headers={
            "Content-Disposition": (
                f'attachment; filename="{ascii_fallback}"; '
                f"filename*=UTF-8''{quote(filename)}"
            ),
            "Cache-Control": "no-store, no-cache, must-revalidate",
            "X-Content-Type-Options": "nosniff",
        },
    )
