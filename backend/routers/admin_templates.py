from __future__ import annotations

from fastapi import APIRouter, Depends

from backend.dependencies import current_store, current_user
from backend.memory_store import UserRecord
from backend.models import (
    AdminTemplateDraftRequest,
    AdminTemplateDraftView,
    AdminTemplatePatchRequest,
    AdminTemplatePublishRequest,
    AdminTemplateView,
    ApiResponse,
)
from backend.stores import SurveyStore


router = APIRouter()


@router.get("", response_model=ApiResponse[list[AdminTemplateView]])
def list_admin_templates(
    user: UserRecord = Depends(current_user),
    store: SurveyStore = Depends(current_store),
) -> ApiResponse[list[AdminTemplateView]]:
    return ApiResponse(data=store.admin_templates(user))


@router.post(
    "/drafts",
    response_model=ApiResponse[AdminTemplateDraftView],
    status_code=201,
)
def create_admin_template_draft(
    payload: AdminTemplateDraftRequest,
    user: UserRecord = Depends(current_user),
    store: SurveyStore = Depends(current_store),
) -> ApiResponse[AdminTemplateDraftView]:
    return ApiResponse(data=store.create_admin_template_draft(user, payload))


@router.delete("/drafts/{survey_id}", response_model=ApiResponse[dict[str, bool]])
def delete_admin_template_draft(
    survey_id: str,
    user: UserRecord = Depends(current_user),
    store: SurveyStore = Depends(current_store),
) -> ApiResponse[dict[str, bool]]:
    store.delete_admin_template_draft(user, survey_id)
    return ApiResponse(data={"deleted": True})


@router.post(
    "/{template_code}/publish",
    response_model=ApiResponse[AdminTemplateView],
    status_code=201,
)
def publish_admin_template(
    template_code: str,
    payload: AdminTemplatePublishRequest,
    user: UserRecord = Depends(current_user),
    store: SurveyStore = Depends(current_store),
) -> ApiResponse[AdminTemplateView]:
    return ApiResponse(
        data=store.publish_admin_template(user, template_code, payload)
    )


@router.patch("/{template_code}", response_model=ApiResponse[AdminTemplateView])
def patch_admin_template(
    template_code: str,
    payload: AdminTemplatePatchRequest,
    user: UserRecord = Depends(current_user),
    store: SurveyStore = Depends(current_store),
) -> ApiResponse[AdminTemplateView]:
    return ApiResponse(data=store.patch_admin_template(user, template_code, payload))


@router.delete("/{template_code}", response_model=ApiResponse[dict[str, bool]])
def delete_admin_template(
    template_code: str,
    user: UserRecord = Depends(current_user),
    store: SurveyStore = Depends(current_store),
) -> ApiResponse[dict[str, bool]]:
    store.delete_admin_template(user, template_code)
    return ApiResponse(data={"deleted": True})
