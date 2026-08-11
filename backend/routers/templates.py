from __future__ import annotations

from fastapi import APIRouter, Request

from backend.models import ApiResponse, SurveyTemplate
from backend.stores import request_store


router = APIRouter()


@router.get("", response_model=ApiResponse[list[SurveyTemplate]])
def list_templates(request: Request) -> ApiResponse[list[SurveyTemplate]]:
    return ApiResponse(data=request_store(request, authenticate=False).templates())


@router.get("/{template_code}", response_model=ApiResponse[SurveyTemplate])
def get_template(template_code: str, request: Request) -> ApiResponse[SurveyTemplate]:
    return ApiResponse(data=request_store(request, authenticate=False).template(template_code))
