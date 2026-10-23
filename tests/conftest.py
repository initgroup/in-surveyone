from __future__ import annotations

import os

import pytest


# Tests must never inherit deployment credentials or connect to a live Oracle DB.
os.environ["SURVEYONE_LOAD_DOTENV"] = "false"
os.environ["SURVEYONE_DB_MODE"] = "memory"
os.environ["DB_MODE"] = "memory"
os.environ["SURVEYONE_ENV"] = "test"
# A test must explicitly inject its fake transport to enable any adapter.
for _channel in ("EMAIL", "SMS", "KAKAO", "FAX"):
    os.environ[f"SURVEYONE_{_channel}_PROVIDER"] = "disabled"
os.environ.pop("SOLAPI_API_KEY", None)
os.environ.pop("SOLAPI_API_SECRET", None)


def signup_member(client):
    from uuid import uuid4

    suffix = uuid4().hex[:12]
    response = client.post("/api/auth/signup", json={
        "loginId": f"member-{suffix}", "password": "SurveyOne!234",
        "name": "검증 담당자", "email": f"member-{suffix}@example.test",
        "organizationName": "검증 기관", "termsAccepted": True, "privacyAccepted": True,
    })
    assert response.status_code == 201, response.text
    return response.json()["data"]


@pytest.fixture(autouse=True)
def isolate_request_rate_limits():
    # Requests within one test share limits; unrelated tests do not.
    from main import request_guard_limiter

    request_guard_limiter.reset()
    yield
    request_guard_limiter.reset()
