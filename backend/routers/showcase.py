from __future__ import annotations

from fastapi import APIRouter

from backend.memory_store import _seed_templates
from backend.models import ApiResponse, SurveyTemplate


router = APIRouter()


@router.get("/templates", response_model=ApiResponse[list[SurveyTemplate]])
def showcase_templates() -> ApiResponse[list[SurveyTemplate]]:
    """Public, curated examples only: no accounts, sessions or database writes."""
    return ApiResponse(data=_seed_templates())
