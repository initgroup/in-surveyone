from __future__ import annotations

from fastapi import APIRouter, Depends

from backend.dependencies import current_store, current_user
from backend.memory_store import UserRecord
from backend.stores import SurveyStore
from backend.models import ApiResponse, DashboardView


router = APIRouter()


@router.get("", response_model=ApiResponse[DashboardView])
def dashboard(
    user: UserRecord = Depends(current_user),
    store: SurveyStore = Depends(current_store),
) -> ApiResponse[DashboardView]:
    return ApiResponse(data=store.dashboard(user))
