from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Request, Response

from backend.config import get_settings
from backend.stores import primary_store
from backend.models import (
    ApiResponse,
    AuthSessionView,
    LoginRequest,
    SignupRequest,
)


router = APIRouter()
SESSION_EXPIRES_HEADER = "X-SurveyOne-Session-Expires-At"
SESSION_COOKIE_PATH = "/api"


def _prevent_auth_caching(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


def _set_session_expiry_header(response: Response, session: AuthSessionView) -> None:
    response.headers[SESSION_EXPIRES_HEADER] = session.expires_at.isoformat()
    _prevent_auth_caching(response)


def _delete_session_cookies(response: Response) -> None:
    settings = get_settings()
    for path in (SESSION_COOKIE_PATH, "/"):
        response.delete_cookie(
            key=settings.session_cookie_name,
            path=path,
            secure=settings.cookie_secure,
            httponly=True,
            samesite=settings.cookie_samesite,
        )


def _set_session_cookie(
    response: Response,
    token: str,
    session: AuthSessionView,
    *,
    persistent: bool = False,
) -> None:
    settings = get_settings()
    remaining_seconds = max(
        1,
        int((session.expires_at - datetime.now(timezone.utc)).total_seconds()),
    )
    maximum_seconds = settings.session_ttl_seconds
    cookie_options: dict[str, object] = {}
    if persistent:
        cookie_options["max_age"] = min(remaining_seconds, maximum_seconds)
    # Remove a same-name cookie created by an earlier root-path version. If it
    # remains, browsers send both values and the stale root cookie can win.
    response.delete_cookie(
        key=settings.session_cookie_name,
        path="/",
        secure=settings.cookie_secure,
        httponly=True,
        samesite=settings.cookie_samesite,
    )
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        path=SESSION_COOKIE_PATH,
        **cookie_options,
    )
    _prevent_auth_caching(response)
    _set_session_expiry_header(response, session)


@router.post("/signup", response_model=ApiResponse[AuthSessionView], status_code=201)
def signup(
    payload: SignupRequest,
    response: Response,
) -> ApiResponse[AuthSessionView]:
    token, session = primary_store().signup(payload)
    _set_session_cookie(response, token, session)
    return ApiResponse(data=session)


@router.post("/login", response_model=ApiResponse[AuthSessionView])
def login(
    payload: LoginRequest,
    response: Response,
) -> ApiResponse[AuthSessionView]:
    token, session = primary_store().login(payload)
    _set_session_cookie(
        response,
        token,
        session,
        persistent=payload.keep_signed_in,
    )
    return ApiResponse(data=session)


@router.post("/logout", response_model=ApiResponse[dict[str, bool]])
def logout(request: Request, response: Response) -> ApiResponse[dict[str, bool]]:
    settings = get_settings()
    token = request.cookies.get(settings.session_cookie_name)
    primary_store().logout(token)
    _delete_session_cookies(response)
    _prevent_auth_caching(response)
    return ApiResponse(data={"loggedOut": True})


@router.get("/me", response_model=ApiResponse[AuthSessionView])
def me(request: Request, response: Response) -> ApiResponse[AuthSessionView]:
    token = request.cookies.get(get_settings().session_cookie_name)
    session = primary_store().auth_session(token)
    _set_session_expiry_header(response, session)
    return ApiResponse(data=session)


@router.post("/extend", response_model=ApiResponse[AuthSessionView])
def extend_session(
    request: Request,
    response: Response,
) -> ApiResponse[AuthSessionView]:
    token = request.cookies.get(get_settings().session_cookie_name)
    session = primary_store().extend_session(token)
    _set_session_expiry_header(response, session)
    return ApiResponse(data=session)
