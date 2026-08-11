from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from backend.dependencies import current_store, current_user
from backend.memory_store import UserRecord
from backend.models import ApiResponse
from backend.stores import SurveyStore


router = APIRouter()


@router.get("/{menu_id}", response_model=ApiResponse[dict[str, object]])
def page_help(
    menu_id: str,
    language: str = Query(default="ko", alias="lang", max_length=20),
    _: UserRecord = Depends(current_user),
    store: SurveyStore = Depends(current_store),
) -> ApiResponse[dict[str, object]]:
    return ApiResponse(data=store.page_help(menu_id, language))
