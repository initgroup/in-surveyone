from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Request, Response

from backend.config import get_settings
from backend.errors import AuthenticationError, ServiceUnavailableError
from backend.models import GuestCapabilitiesView, GuestMode
from backend.stores import (
    guest_capabilities,
    primary_store,
    resolve_authenticated_store,
)
from backend.models import (
    ApiResponse,
    AuthSessionView,
    GuestProvisionView,
    GuestSessionRequest,
    LoginRequest,
    SignupRequest,
)


router = APIRouter()


def _set_session_cookie(
    response: Response,
    token: str,
    session: AuthSessionView,
) -> None:
    settings = get_settings()
    remaining_seconds = max(
        1,
        int((session.expires_at - datetime.now(timezone.utc)).total_seconds()),
    )
    maximum_seconds = (
        settings.guest_project_ttl_hours * 60 * 60
        if session.user.is_guest
        else settings.session_ttl_seconds
    )
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        max_age=min(remaining_seconds, maximum_seconds),
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        path="/",
    )


@router.post("/guest", response_model=ApiResponse[GuestProvisionView], status_code=201)
def start_guest_session(
    response: Response,
    payload: GuestSessionRequest | None = None,
) -> ApiResponse[GuestProvisionView]:
    request_payload = payload or GuestSessionRequest()
    capabilities = guest_capabilities(GuestMode.DATABASE)
    database = capabilities.modes[0]
    if not database.available:
        raise ServiceUnavailableError(
            database.reason or "Database guest mode is unavailable."
        )
    store = primary_store()
    provisioned = store.create_guest(
        request_payload.display_name,
        request_payload.mode,
    )
    response.headers["Cache-Control"] = "no-store"
    return ApiResponse(data=provisioned)


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
    _set_session_cookie(response, token, session)
    return ApiResponse(data=session)


@router.post("/logout", response_model=ApiResponse[dict[str, bool]])
def logout(request: Request, response: Response) -> ApiResponse[dict[str, bool]]:
    settings = get_settings()
    token = request.cookies.get(settings.session_cookie_name)
    try:
        store, _ = resolve_authenticated_store(token)
    except AuthenticationError:
        store = None
    if store is not None:
        store.logout(token)
    response.delete_cookie(
        key=settings.session_cookie_name,
        path="/",
        secure=settings.cookie_secure,
        httponly=True,
        samesite=settings.cookie_samesite,
    )
    return ApiResponse(data={"loggedOut": True})


@router.get("/me", response_model=ApiResponse[AuthSessionView])
def me(request: Request) -> ApiResponse[AuthSessionView]:
    token = request.cookies.get(get_settings().session_cookie_name)
    store, _ = resolve_authenticated_store(token)
    return ApiResponse(data=store.auth_session(token))


@router.get(
    "/guest/capabilities",
    response_model=ApiResponse[GuestCapabilitiesView],
)
def capabilities(
) -> ApiResponse[GuestCapabilitiesView]:
    return ApiResponse(data=guest_capabilities(GuestMode.DATABASE))
