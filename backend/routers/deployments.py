from __future__ import annotations

from fastapi import APIRouter, Depends

from backend.dependencies import current_store, current_user
from backend.memory_store import UserRecord
from backend.models import (
    ApiResponse,
    DeliveryProvidersView,
    DeploymentDraftRequest,
    DeploymentDraftView,
    DeploymentExecuteResult,
)
from backend.stores import SurveyStore


router = APIRouter()


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
    payload: DeploymentDraftRequest,
    user: UserRecord = Depends(current_user),
    store: SurveyStore = Depends(current_store),
) -> ApiResponse[DeploymentExecuteResult]:
    return ApiResponse(data=store.execute_deployment(user, survey_id, payload))
