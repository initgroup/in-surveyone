from __future__ import annotations

from fastapi import Request

from backend.config import get_settings
from backend.memory_store import UserRecord
from backend.stores import SurveyStore, request_store, resolve_authenticated_store


def current_user(request: Request) -> UserRecord:
    token = request.cookies.get(get_settings().session_cookie_name)
    store, user = resolve_authenticated_store(token)
    request.state.surveyone_store = store
    request.state.surveyone_user = user
    return user


def current_store(request: Request) -> SurveyStore:
    return request_store(request)
