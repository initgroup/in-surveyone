from __future__ import annotations

from dataclasses import replace
from uuid import uuid4

from fastapi.testclient import TestClient

from backend.memory_store import memory_store
from main import app


def _signup(
    client: TestClient, prefix: str, *, admin_key: str | None = None
) -> dict:
    suffix = uuid4().hex[:10]
    payload = {
        "loginId": f"{prefix}-{suffix}",
        "password": "SurveyOne!234",
        "name": f"{prefix} 담당자",
        "email": f"{prefix}-{suffix}@example.test",
        "organizationName": f"{prefix} 기관",
        "termsAccepted": True,
        "privacyAccepted": True,
    }
    if admin_key is not None:
        payload.update({"requestSystemAdmin": True, "adminKey": admin_key})
    response = client.post("/api/auth/signup", json=payload)
    assert response.status_code == 201, response.text
    return {**response.json()["data"], "password": payload["password"]}


def test_admin_member_list_reset_and_status_workflow(monkeypatch) -> None:
    admin_key = "test-only-member-admin-key"
    monkeypatch.setattr(
        memory_store,
        "settings",
        replace(memory_store.settings, admin_key=admin_key),
    )
    with (
        TestClient(app) as admin_client,
        TestClient(app) as member_client,
        TestClient(app) as login_client,
    ):
        admin = _signup(admin_client, "member-admin", admin_key=admin_key)
        member = _signup(member_client, "managed-member")
        member_id = member["user"]["id"]
        assert member_client.get("/api/admin/members").status_code == 403
        assert member_client.delete(f"/api/admin/members/{member_id}").status_code == 403
        for retired_type in ("guest", "guest_unused", "guest_expired", "unknown"):
            assert admin_client.get(f"/api/admin/members?memberType={retired_type}").status_code == 422
        page = admin_client.get("/api/admin/members?page=1&pageSize=1")
        assert page.status_code == 200, page.text
        page_data = page.json()["data"]
        assert page_data["total"] >= 2
        assert len(page_data["items"]) == 1
        assert page_data["hasNext"] is True

        search = admin_client.get(
            f"/api/admin/members?query={member['user']['loginId']}"
        )
        assert search.status_code == 200
        item = search.json()["data"]["items"][0]
        assert item["id"] == member_id
        assert item["email"].startswith("m***@")
        assert item["active"] is True

        reset = admin_client.post(
            f"/api/admin/members/{member_id}/password-reset"
        )
        assert reset.status_code == 200, reset.text
        assert reset.headers["cache-control"] == "no-store"
        temporary_password = reset.json()["data"]["temporaryPassword"]
        assert len(temporary_password) >= 16
        assert temporary_password not in str(memory_store._users[member_id])
        assert member_client.get("/api/auth/me").status_code == 401
        assert login_client.post(
            "/api/auth/login",
            json={"loginId": member["user"]["loginId"], "password": member["password"]},
        ).status_code == 401
        assert login_client.post(
            "/api/auth/login",
            json={"loginId": member["user"]["loginId"], "password": temporary_password},
        ).status_code == 200

        stopped = admin_client.patch(
            f"/api/admin/members/{member_id}/status", json={"active": False}
        )
        assert stopped.status_code == 200
        assert stopped.json()["data"]["active"] is False
        assert login_client.get("/api/auth/me").status_code == 401
        assert login_client.post(
            "/api/auth/login",
            json={"loginId": member["user"]["loginId"], "password": temporary_password},
        ).status_code == 401

        resumed = admin_client.patch(
            f"/api/admin/members/{member_id}/status", json={"active": True}
        )
        assert resumed.status_code == 200
        assert resumed.json()["data"]["active"] is True
        assert login_client.post(
            "/api/auth/login",
            json={"loginId": member["user"]["loginId"], "password": temporary_password},
        ).status_code == 200

        withdrawn = admin_client.delete(f"/api/admin/members/{member_id}")
        assert withdrawn.status_code == 200
        assert withdrawn.json()["data"]["withdrawn"] is True
        assert login_client.get("/api/auth/me").status_code == 401
        assert login_client.post(
            "/api/auth/login",
            json={"loginId": member["user"]["loginId"], "password": temporary_password},
        ).status_code == 401
        assert admin_client.patch(
            f"/api/admin/members/{member_id}/status", json={"active": True}
        ).status_code == 422
        assert admin_client.post(
            f"/api/admin/members/{member_id}/password-reset"
        ).status_code == 422
        withdrawn_item = next(
            item
            for item in admin_client.get(
                "/api/admin/members?memberType=member&query=탈퇴 회원"
            ).json()["data"]["items"]
            if item["id"] == member_id
        )
        assert withdrawn_item["name"] == "탈퇴 회원"
        assert withdrawn_item["email"] is None
        assert withdrawn_item["active"] is False
        assert withdrawn_item["withdrawnAt"] is not None
        assert withdrawn_item["loginId"] != member["user"]["loginId"]
        assert admin_client.delete(f"/api/admin/members/{member_id}").status_code == 200

        admin_id = admin["user"]["id"]
        assert admin_client.post(
            f"/api/admin/members/{admin_id}/password-reset"
        ).status_code == 422
        assert admin_client.patch(
            f"/api/admin/members/{admin_id}/status", json={"active": False}
        ).status_code == 422
        assert admin_client.delete(f"/api/admin/members/{admin_id}").status_code == 422
