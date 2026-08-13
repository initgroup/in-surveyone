from __future__ import annotations

import json
from dataclasses import replace
from uuid import uuid4

from fastapi.testclient import TestClient

from backend.memory_store import memory_store
from main import app


def _signup(client: TestClient, prefix: str, *, admin_key: str | None = None) -> dict:
    suffix = uuid4().hex[:10]
    response = client.post(
        "/api/auth/signup",
        json={
            "loginId": f"{prefix}-{suffix}",
            "password": "SurveyOne!234",
            "name": f"{prefix} 담당자",
            "email": f"{prefix}-{suffix}@example.test",
            "organizationName": f"{prefix} 기관",
            "termsAccepted": True,
            "privacyAccepted": True,
            **(
                {"requestSystemAdmin": True, "adminKey": admin_key}
                if admin_key is not None
                else {}
            ),
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


def _grant_system_admin(user_id: str) -> None:
    with memory_store._lock:
        memory_store._users[user_id] = replace(
            memory_store._users[user_id], system_admin=True
        )


def test_signup_requires_agreements_and_a_valid_admin_key(monkeypatch) -> None:
    admin_key = "test-only-signup-admin-key"
    monkeypatch.setattr(
        memory_store,
        "settings",
        replace(memory_store.settings, admin_key=admin_key),
    )
    suffix = uuid4().hex[:10]
    payload = {
        "loginId": f"admin-key-{suffix}",
        "password": "SurveyOne!234",
        "name": "플랫폼 담당자",
        "email": f"admin-key-{suffix}@example.test",
        "organizationName": "플랫폼 운영 기관",
        "termsAccepted": True,
        "privacyAccepted": True,
        "requestSystemAdmin": True,
    }
    with TestClient(app) as client:
        missing_consent = client.post(
            "/api/auth/signup",
            json={**payload, "privacyAccepted": False, "adminKey": admin_key},
        )
        assert missing_consent.status_code == 422

        invalid_key = client.post(
            "/api/auth/signup", json={**payload, "adminKey": "wrong-key"}
        )
        assert invalid_key.status_code == 422
        assert "관리자 인증키가 올바르지 않습니다." in invalid_key.text

        created = client.post(
            "/api/auth/signup", json={**payload, "adminKey": admin_key}
        )
        assert created.status_code == 201, created.text
        assert created.json()["data"]["user"]["systemAdmin"] is True
        assert admin_key not in created.text
        assert client.get("/api/admin/templates").status_code == 200


def test_global_template_admin_versions_visibility_and_independent_copy(monkeypatch) -> None:
    template_code = f"test-{uuid4().hex[:12]}"
    admin_key = "test-only-template-admin-key"
    monkeypatch.setattr(
        memory_store,
        "settings",
        replace(memory_store.settings, admin_key=admin_key),
    )
    with TestClient(app) as admin_client, TestClient(app) as member_client:
        admin_session = _signup(admin_client, "template-admin", admin_key=admin_key)
        assert admin_session["user"]["role"] == "OWNER"
        assert admin_session["user"]["systemAdmin"] is True
        assert admin_key not in str(memory_store._users[admin_session["user"]["id"]])
        me = admin_client.get("/api/auth/me")
        assert me.status_code == 200
        assert me.json()["data"]["user"]["systemAdmin"] is True
        assert me.json()["data"]["user"]["role"] == "OWNER"
        assert admin_client.get("/api/admin/templates").status_code == 200

        draft_response = admin_client.post(
            "/api/admin/templates/drafts",
            json={"title": "관리자 공용 템플릿 초안", "templateCode": "social-research"},
        )
        assert draft_response.status_code == 201, draft_response.text
        source_id = draft_response.json()["data"]["surveyId"]
        linked = next(
            item
            for item in admin_client.get("/api/admin/templates").json()["data"]
            if item["code"] == "social-research"
        )
        assert linked["sourceSurveyId"] == source_id
        assert all(
            item["id"] != source_id
            for item in admin_client.get("/api/surveys").json()["data"]
        )
        project_page = admin_client.get("/api/surveys/page").json()["data"]
        assert all(item["id"] != source_id for item in project_page["items"])
        assert project_page["total"] == 0
        assert admin_client.get("/api/dashboard").json()["data"]["totalSurveys"] == 0
        source = admin_client.get(f"/api/surveys/{source_id}").json()["data"]
        source["sections"][0]["questions"][0]["title"] = "원본 관리자 문항 v1"
        source_skin = {
            **source["skin"],
            "primary": "#123456",
            "accent": "#2A7F62",
            "radius": "18px",
        }
        saved = admin_client.put(
            f"/api/surveys/{source_id}",
            json={
                "expectedRevision": source["revision"],
                "sections": source["sections"],
                "skin": source_skin,
            },
        )
        assert saved.status_code == 200, saved.text
        resumed = admin_client.post(
            "/api/admin/templates/drafts",
            json={"title": "무시되는 새 제목", "templateCode": "social-research"},
        )
        assert resumed.status_code == 201, resumed.text
        assert resumed.json()["data"]["surveyId"] == source_id
        assert (
            admin_client.get(f"/api/surveys/{source_id}").json()["data"]
            ["sections"][0]["questions"][0]["title"]
            == "원본 관리자 문항 v1"
        )

        published = admin_client.post(
            f"/api/admin/templates/{template_code}/publish",
            json={
                "sourceSurveyId": source_id,
                "title": "다문화 가정 조사",
                "description": "관리자가 설계한 회원 공용 템플릿",
                "category": "사회조사",
            },
        )
        assert published.status_code == 201, published.text
        published_data = published.json()["data"]
        assert published_data["status"] == "active"
        assert published_data["versionNo"] == 1
        assert published_data["sourceSurveyId"] == source_id

        public_template = admin_client.get(f"/api/templates/{template_code}")
        assert public_template.status_code == 200
        template_data = public_template.json()["data"]
        assert template_data["skin"]["primary"] == "#123456"
        assert template_data["sections"][0]["questions"][0]["title"] == "원본 관리자 문항 v1"

        member_session = _signup(member_client, "template-member")
        assert member_session["user"]["systemAdmin"] is False
        assert member_client.get("/api/admin/templates").status_code == 403
        copied = member_client.post(
            "/api/surveys",
            json={"title": "회원 독립 설문", "templateCode": template_code},
        )
        assert copied.status_code == 201, copied.text
        copied_data = copied.json()["data"]
        copied_data["sections"][0]["questions"][0]["title"] = "회원이 바꾼 독립 문항"
        copied_saved = member_client.put(
            f"/api/surveys/{copied_data['id']}",
            json={
                "expectedRevision": copied_data["revision"],
                "sections": copied_data["sections"],
            },
        )
        assert copied_saved.status_code == 200, copied_saved.text
        assert (
            admin_client.get(f"/api/templates/{template_code}").json()["data"]
            ["sections"][0]["questions"][0]["title"]
            == "원본 관리자 문항 v1"
        )

        metadata = admin_client.patch(
            f"/api/admin/templates/{template_code}",
            json={
                "title": "다문화 조사 카탈로그 제목",
                "description": "문항 스냅샷과 분리된 카탈로그 설명",
                "category": "기관 맞춤형",
            },
        )
        assert metadata.status_code == 200, metadata.text
        assert metadata.json()["data"]["versionNo"] == 1
        assert metadata.json()["data"]["title"] == "다문화 조사 카탈로그 제목"

        current_source = admin_client.get(f"/api/surveys/{source_id}").json()["data"]
        current_source["sections"][0]["questions"][0]["title"] = "원본 관리자 문항 v2"
        source_v2 = admin_client.put(
            f"/api/surveys/{source_id}",
            json={
                "expectedRevision": current_source["revision"],
                "sections": current_source["sections"],
            },
        )
        assert source_v2.status_code == 200, source_v2.text
        republished = admin_client.post(
            f"/api/admin/templates/{template_code}/publish",
            json={
                "sourceSurveyId": source_id,
                "title": "다문화 가정 조사 2판",
                "description": "두 번째 불변 스냅샷",
                "category": "사회조사",
            },
        )
        assert republished.status_code == 201, republished.text
        assert republished.json()["data"]["versionNo"] == 2
        assert republished.json()["data"]["useCount"] == 1

        with memory_store._lock:
            versions = list(memory_store._admin_templates[template_code].versions)
        assert len(versions) == 2
        assert (
            json.loads(versions[0].snapshot_json)["sections"][0]["questions"][0]["title"]
            == "원본 관리자 문항 v1"
        )
        assert (
            json.loads(versions[1].snapshot_json)["sections"][0]["questions"][0]["title"]
            == "원본 관리자 문항 v2"
        )

        archived = admin_client.patch(
            f"/api/admin/templates/{template_code}",
            json={"status": "archived"},
        )
        assert archived.status_code == 200, archived.text
        assert archived.json()["data"]["status"] == "archived"
        catalog_codes = {
            item["code"] for item in admin_client.get("/api/templates").json()["data"]
        }
        assert template_code not in catalog_codes
        assert admin_client.get(f"/api/templates/{template_code}").status_code == 404
        assert member_client.get(f"/api/surveys/{copied_data['id']}").status_code == 200

        restored = admin_client.patch(
            f"/api/admin/templates/{template_code}",
            json={"status": "active"},
        )
        assert restored.status_code == 200, restored.text
        assert restored.json()["data"]["status"] == "active"

        patch_delete = admin_client.patch(
            f"/api/admin/templates/{template_code}",
            json={"status": "deleted"},
        )
        assert patch_delete.status_code == 422

        deleted = admin_client.delete(f"/api/admin/templates/{template_code}")
        assert deleted.status_code == 200, deleted.text
        assert deleted.json()["data"]["deleted"] is True
        assert template_code not in {
            item["code"]
            for item in admin_client.get("/api/admin/templates").json()["data"]
        }
        assert admin_client.get(f"/api/templates/{template_code}").status_code == 404
        assert admin_client.get(f"/api/surveys/{source_id}").status_code == 404
        assert member_client.get(f"/api/surveys/{copied_data['id']}").status_code == 200
        with memory_store._lock:
            assert len(memory_store._admin_templates[template_code].versions) == 2


def test_admin_template_publish_rejects_empty_or_cross_tenant_source() -> None:
    with TestClient(app) as admin_client, TestClient(app) as member_client:
        admin_session = _signup(admin_client, "template-admin-guard")
        _grant_system_admin(admin_session["user"]["id"])
        _signup(member_client, "template-member-guard")

        blank = admin_client.post(
            "/api/admin/templates/drafts", json={"title": "빈 관리자 초안"}
        )
        assert blank.status_code == 201, blank.text
        blank_id = blank.json()["data"]["surveyId"]
        draft_item = next(
            item
            for item in admin_client.get("/api/admin/templates").json()["data"]
            if item.get("sourceSurveyId") == blank_id
        )
        assert draft_item["draftOnly"] is True
        assert draft_item["versionNo"] == 0
        rejected = admin_client.post(
            f"/api/admin/templates/test-{uuid4().hex[:10]}/publish",
            json={
                "sourceSurveyId": blank.json()["data"]["surveyId"],
                "title": "빈 템플릿",
                "description": "",
                "category": "사회조사",
            },
        )
        assert rejected.status_code == 422

        foreign = member_client.post(
            "/api/surveys",
            json={"title": "다른 테넌트 설문", "templateCode": "social-research"},
        )
        assert foreign.status_code == 201, foreign.text
        hidden = admin_client.post(
            f"/api/admin/templates/test-{uuid4().hex[:10]}/publish",
            json={
                "sourceSurveyId": foreign.json()["data"]["id"],
                "title": "권한 없는 템플릿",
                "description": "",
                "category": "사회조사",
            },
        )
        assert hidden.status_code == 404

        removed = admin_client.delete(f"/api/admin/templates/drafts/{blank_id}")
        assert removed.status_code == 200, removed.text
        assert all(
            item.get("sourceSurveyId") != blank_id
            for item in admin_client.get("/api/admin/templates").json()["data"]
        )
        assert admin_client.get(f"/api/surveys/{blank_id}").status_code == 404
