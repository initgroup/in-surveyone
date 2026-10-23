"""The retired guest entry is replaced by a read-only showcase."""
from dataclasses import replace

from fastapi.testclient import TestClient

from backend.memory_store import memory_store
from backend.models import GuestMode, UserRole
from conftest import signup_member
from main import app


def test_retired_endpoints_cannot_create_accounts_or_sessions():
    with TestClient(app) as client:
        before = (len(memory_store._users), len(memory_store._sessions), len(memory_store._surveys))
        for response in (
            client.post("/api/auth/guest", json={"mode": "database"}),
            client.post("/api/auth/guest", json={"mode": "local"}),
            client.get("/api/auth/guest/capabilities"),
        ):
            assert response.status_code == 404
            assert "set-cookie" not in response.headers
        assert (len(memory_store._users), len(memory_store._sessions), len(memory_store._surveys)) == before


def test_showcase_uses_curated_examples_without_database_or_auth(monkeypatch):
    import backend.stores as stores

    def forbidden(*args, **kwargs):
        raise AssertionError("The showcase must not access an authenticated/database store")

    monkeypatch.setattr(stores, "oracle_store", forbidden)
    monkeypatch.setattr(stores, "primary_store", forbidden)
    with TestClient(app) as client:
        before = (len(memory_store._users), len(memory_store._sessions), len(memory_store._surveys))
        response = client.get("/api/showcase/templates")
        assert response.status_code == 200
        assert "set-cookie" not in response.headers
        items = response.json()["data"]
        assert len(items) >= 3
        assert all(item["sections"] for item in items)
        original_title = items[0]["title"]
        items[0]["title"] = "local mutation"
        assert client.get("/api/showcase/templates").json()["data"][0]["title"] == original_title
        assert (len(memory_store._users), len(memory_store._sessions), len(memory_store._surveys)) == before


def test_existing_guest_sessions_logins_and_public_urls_are_denied():
    with TestClient(app) as client:
        member = signup_member(client)
        user_id = member["user"]["id"]
        user = memory_store._users[user_id]
        created = client.post("/api/surveys", json={"title": "Retirement boundary", "questions": [{"id": "q1", "type": "short_text", "title": "Example"}]})
        assert created.status_code == 201
        survey_id = created.json()["data"]["id"]
        published = client.post(f"/api/surveys/{survey_id}/publish", json={})
        assert published.status_code == 200
        slug = published.json()["data"]["slug"]
        assert client.get(f"/api/public/surveys/{slug}").status_code == 200
        memory_store._users[user_id] = replace(user, is_guest=True, role=UserRole.GUEST, guest_mode=GuestMode.DATABASE)
        for path in ("/api/auth/me", "/api/surveys", "/api/dashboard"):
            assert client.get(path).status_code == 401
        assert client.post("/api/auth/extend", json={}).status_code == 401
        assert client.post("/api/auth/login", json={"loginId": user.login_id, "password": "SurveyOne!234"}).status_code == 401
        assert client.get(f"/api/public/surveys/{slug}").status_code == 404
        assert client.post(f"/api/public/surveys/{slug}/responses", json={"answers": {}}).status_code == 404


def test_anonymous_writes_still_require_member_authentication():
    with TestClient(app) as client:
        assert client.post("/api/surveys", json={"title": "Unauthorized"}).status_code == 401
        assert client.get("/api/surveys").status_code == 401
