from __future__ import annotations

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import Response

from backend.dependencies import current_store, current_user
from backend.memory_store import UserRecord
from backend.models import (
    ApiResponse,
    DeliveryProvidersView,
    DeliveryRecipientImportView,
    DeploymentDraftRequest,
    DeploymentDraftView,
    DeploymentExecuteRequest,
    DeploymentExecuteResult,
)
from backend.stores import SurveyStore
from backend.recipient_import import parse_recipient_file, recipient_xlsx_sample


router = APIRouter()


@router.get("/recipients/sample.xlsx", response_class=Response)
def recipient_sample_xlsx(
    user: UserRecord = Depends(current_user),
) -> Response:
    del user
    return Response(
        content=recipient_xlsx_sample(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": 'attachment; filename="in-surveyone-recipients.xlsx"',
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.post(
    "/recipients/import", response_model=ApiResponse[DeliveryRecipientImportView]
)
async def import_recipients(
    upload: UploadFile = File(...),
    user: UserRecord = Depends(current_user),
) -> ApiResponse[DeliveryRecipientImportView]:
    del user
    data = await upload.read()
    await upload.close()
    recipients, file_type, encoding = parse_recipient_file(upload.filename or "", data)
    return ApiResponse(
        data=DeliveryRecipientImportView(
            recipients=recipients,
            total=len(recipients),
            file_type=file_type,
            encoding=encoding,
        )
    )


@router.get("/providers", response_model=ApiResponse[DeliveryProvidersView])
def providers(
    user: UserRecord = Depends(current_user),
    store: SurveyStore = Depends(current_store),
) -> ApiResponse[DeliveryProvidersView]:
    return ApiResponse(data=store.delivery_providers(user))


@router.get(
    "/by-survey/{survey_id}", response_model=ApiResponse[DeploymentDraftView]
)
def deployment(
    survey_id: str,
    user: UserRecord = Depends(current_user),
    store: SurveyStore = Depends(current_store),
) -> ApiResponse[DeploymentDraftView]:
    return ApiResponse(data=store.deployment(user, survey_id))


@router.put(
    "/by-survey/{survey_id}", response_model=ApiResponse[DeploymentDraftView]
)
def save_deployment(
    survey_id: str,
    payload: DeploymentDraftRequest,
    user: UserRecord = Depends(current_user),
    store: SurveyStore = Depends(current_store),
) -> ApiResponse[DeploymentDraftView]:
    return ApiResponse(data=store.save_deployment(user, survey_id, payload))


@router.post(
    "/by-survey/{survey_id}/execute",
    response_model=ApiResponse[DeploymentExecuteResult],
)
def execute_deployment(
    survey_id: str,
    payload: DeploymentExecuteRequest,
    user: UserRecord = Depends(current_user),
    store: SurveyStore = Depends(current_store),
) -> ApiResponse[DeploymentExecuteResult]:
    return ApiResponse(data=store.execute_deployment(user, survey_id, payload))
