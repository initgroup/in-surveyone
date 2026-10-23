from __future__ import annotations

from fastapi import APIRouter, Depends, File, UploadFile, Query
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
    DeploymentSendRequest,
    DeliverySendResult,
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


@router.get("/solapi/templates", response_model=ApiResponse[list[dict]])
def solapi_templates(pf_id: str = Query(alias="pfId", min_length=1, max_length=100),
                     user: UserRecord = Depends(current_user), store: SurveyStore = Depends(current_store)):
    from backend.errors import DomainValidationError
    from backend.solapi import SolapiClient
    if not store.delivery_providers(user).providers["kakao"].enabled:
        raise DomainValidationError("SOLAPI 카카오 발송 설정이 준비되지 않았습니다.")
    return ApiResponse(data=SolapiClient(store.settings).templates(pf_id))


@router.post("/by-survey/{survey_id}/preview", response_model=ApiResponse[dict])
def preview_deployment(survey_id: str, payload: DeploymentDraftRequest,
                       offset: int = Query(default=0, ge=0, le=8000),
                       recipient_id: str | None = Query(default=None, alias="recipientId", max_length=100),
                       user: UserRecord = Depends(current_user), store: SurveyStore = Depends(current_store)):
    return ApiResponse(data=store.preview_deployment(user, survey_id, payload, offset=offset, recipient_id=recipient_id))


@router.get("/by-survey/{survey_id}/delivery-status", response_model=ApiResponse[DeliverySendResult])
def delivery_status(survey_id: str, revision: int = Query(ge=1),
                    user: UserRecord = Depends(current_user), store: SurveyStore = Depends(current_store)):
    return ApiResponse(data=store.delivery_status(user, survey_id, revision))


@router.post("/by-survey/{survey_id}/send", response_model=ApiResponse[DeliverySendResult])
def send_deployment(survey_id: str, payload: DeploymentSendRequest,
                    user: UserRecord = Depends(current_user), store: SurveyStore = Depends(current_store)):
    return ApiResponse(data=store.send_deployment(user, survey_id, payload))


@router.get("/history", response_model=ApiResponse[dict])
def delivery_history(survey_id: str | None = Query(default=None, alias="surveyId", max_length=80),
                     status: str | None = Query(default=None, pattern="^(QUEUED|ACCEPTED|FAILED|UNKNOWN|DISABLED|SENT|CANCELLED)$"),
                     offset: int = Query(default=0, ge=0, le=1000000),
                     user: UserRecord = Depends(current_user), store: SurveyStore = Depends(current_store)):
    return ApiResponse(data=store.delivery_history(user, survey_id, offset=offset, status=status))
