from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query, Response

from backend.dependencies import current_store, current_user
from backend.memory_store import UserRecord
from backend.models import (
    AdminMemberPage,
    AdminMemberStatusRequest,
    AdminMemberView,
    AdminPasswordResetView,
    ApiResponse,
)
from backend.stores import SurveyStore


router = APIRouter()


@router.get("", response_model=ApiResponse[AdminMemberPage])
def list_admin_members(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, alias="pageSize", ge=1, le=100),
    query: str = Query(default="", max_length=100),
    member_type: Literal["all", "member", "guest", "guest_unused", "guest_expired"] = Query(
        default="all", alias="memberType"
    ),
    user: UserRecord = Depends(current_user),
    store: SurveyStore = Depends(current_store),
) -> ApiResponse[AdminMemberPage]:
    return ApiResponse(
        data=store.admin_members(
            user,
            page=page,
            page_size=page_size,
            query=query,
            member_type=member_type,
        )
    )


@router.post(
    "/{member_id}/password-reset",
    response_model=ApiResponse[AdminPasswordResetView],
)
def reset_admin_member_password(
    member_id: str,
    response: Response,
    user: UserRecord = Depends(current_user),
    store: SurveyStore = Depends(current_store),
) -> ApiResponse[AdminPasswordResetView]:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    return ApiResponse(data=store.admin_reset_member_password(user, member_id))


@router.patch("/{member_id}/status", response_model=ApiResponse[AdminMemberView])
def update_admin_member_status(
    member_id: str,
    payload: AdminMemberStatusRequest,
    user: UserRecord = Depends(current_user),
    store: SurveyStore = Depends(current_store),
) -> ApiResponse[AdminMemberView]:
    return ApiResponse(data=store.admin_set_member_status(user, member_id, payload))


@router.delete("/{member_id}", response_model=ApiResponse[dict[str, bool]])
def withdraw_admin_member(
    member_id: str,
    user: UserRecord = Depends(current_user),
    store: SurveyStore = Depends(current_store),
) -> ApiResponse[dict[str, bool]]:
    store.admin_withdraw_member(user, member_id)
    return ApiResponse(data={"withdrawn": True})
