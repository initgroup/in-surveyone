from __future__ import annotations

from fastapi import APIRouter, Depends, Response

from backend.dependencies import current_store, current_user
from backend.memory_store import UserRecord
from backend.models import ApiResponse, LoginPolicyUpdate, LoginPolicyView
from backend.stores import SurveyStore

router = APIRouter()


@router.get("/login-policy", response_model=ApiResponse[LoginPolicyView])
def login_policy(response: Response, user: UserRecord = Depends(current_user),
                 store: SurveyStore = Depends(current_store)) -> ApiResponse[LoginPolicyView]:
    response.headers["Cache-Control"] = "no-store"
    return ApiResponse(data=store.login_policy(user))


@router.put("/login-policy", response_model=ApiResponse[LoginPolicyView])
def update_login_policy(payload: LoginPolicyUpdate, response: Response,
                        user: UserRecord = Depends(current_user),
                        store: SurveyStore = Depends(current_store)) -> ApiResponse[LoginPolicyView]:
    response.headers["Cache-Control"] = "no-store"
    return ApiResponse(data=store.update_login_policy(user, payload))
