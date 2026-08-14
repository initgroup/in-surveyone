from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi.testclient import TestClient

from main import app, settings


def _signup(client: TestClient, prefix: str) -> dict:
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
        },
    )
    assert response.status_code == 201, response.text
    assert "httponly" in response.headers["set-cookie"].lower()
    return response.json()["data"]


def _provision_and_login(client: TestClient) -> dict:
    provisioned = client.post("/api/auth/guest")
    assert provisioned.status_code == 201, provisioned.text
    credential = provisioned.json()["data"]["guestCredential"]
    logged_in = client.post(
        "/api/auth/login",
        json={
            "loginId": credential["loginId"],
            "password": credential["initialPassword"],
        },
    )
    assert logged_in.status_code == 200, logged_in.text
    return provisioned.json()["data"]


def test_health_templates_and_seeded_public_demo() -> None:
    with TestClient(app) as client:
        health = client.get("/api/health")
        assert health.status_code == 200
        assert health.json()["status"] == "ok"
        assert health.json()["database"]["mode"] == "memory"

        templates = client.get("/api/templates")
        assert templates.status_code == 200
        codes = {item["code"] for item in templates.json()["data"]}
        assert {"social-research", "integrity-survey", "business-survey"} <= codes
        social = next(
            item for item in templates.json()["data"] if item["code"] == "social-research"
        )
        assert social["id"] == social["code"]
        assert social["questionCount"] == len(social["questions"])

        demo = client.get("/api/public/surveys/citizen-life-demo")
        assert demo.status_code == 200
        assert demo.json()["data"]["version"] == 1
        assert client.get("/s/citizen-life-demo").status_code == 200


def test_project_list_uses_server_paging_search_and_sort() -> None:
    with TestClient(app) as client:
        _signup(client, "project-page")
        for index in range(13):
            created = client.post(
                "/api/surveys",
                json={"title": f"페이지 설문 {index:02d}", "category": "사회조사"},
            )
            assert created.status_code == 201, created.text

        first = client.get(
            "/api/surveys/page",
            params={"page": 1, "pageSize": 10, "sort": "title"},
        )
        assert first.status_code == 200, first.text
        first_data = first.json()["data"]
        assert first_data["total"] == 13
        assert first_data["totalAll"] == 13
        assert first_data["hasNext"] is True
        assert len(first_data["items"]) == 10
        assert [item["title"] for item in first_data["items"]] == [
            f"페이지 설문 {index:02d}" for index in range(10)
        ]

        second = client.get(
            "/api/surveys/page",
            params={"page": 2, "pageSize": 10, "sort": "title"},
        ).json()["data"]
        assert second["hasNext"] is False
        assert len(second["items"]) == 3

        searched = client.get(
            "/api/surveys/page",
            params={"query": "설문 12", "pageSize": 10},
        ).json()["data"]
        assert searched["total"] == 1
        assert searched["items"][0]["title"] == "페이지 설문 12"


def test_guest_create_publish_respond_and_report_flow() -> None:
    with TestClient(app) as owner:
        guest = _provision_and_login(owner)
        assert guest["user"]["isGuest"] is True
        assert owner.get("/api/auth/me").status_code == 200

        created = owner.post(
            "/api/surveys",
            json={
                "templateId": "social-research",
                "title": "모바일 생활 만족도 조사",
            },
        )
        assert created.status_code == 201, created.text
        created_data = created.json()["data"]
        survey_id = created_data["id"]
        assert created_data["questionCount"] == len(created_data["questions"])
        assert created_data["questions"][0]["type"] == "single"

        published = owner.post(
            f"/api/surveys/{survey_id}/publish",
            json={"slug": f"mobile-life-{uuid4().hex[:8]}"},
        )
        assert published.status_code == 200, published.text
        publish_data = published.json()["data"]
        assert publish_data["version"] == 1
        assert publish_data["publicUrl"] == f"/s/{publish_data['slug']}"
        slug = publish_data["slug"]

        # Editing the working copy cannot mutate the immutable published snapshot.
        updated = owner.patch(
            f"/api/surveys/{survey_id}",
            json={
                "title": "수정 중인 설문 제목",
                "questions": created_data["questions"],
                "logicRules": [{"sourceQuestionId": "social-residence"}],
                "skin": {"preset": "ocean", "primary": "#2457D6"},
            },
        )
        assert updated.status_code == 200
        assert updated.json()["data"]["logicRules"][0]["sourceQuestionId"] == "social-residence"
        assert updated.json()["data"]["skin"]["preset"] == "ocean"
        tracking_skin = owner.patch(
            f"/api/surveys/{survey_id}",
            json={"skin": {"headerImageUrl": "https://tracker.example/pixel.png"}},
        )
        assert tracking_skin.status_code == 422
        public_before_republish = owner.get(f"/api/public/surveys/{slug}")
        assert public_before_republish.json()["data"]["title"] == "모바일 생활 만족도 조사"

        response = owner.post(
            f"/api/public/surveys/{slug}/responses",
            json={
                "answers": {
                    "social-residence": "center",
                    "social-score": "4",
                },
                "client": {"channel": "smoke-test", "viewport": "390x844"},
            },
        )
        assert response.status_code == 201, response.text
        assert response.json()["data"]["surveyVersion"] == 1

        raw = owner.get(f"/api/surveys/{survey_id}/responses")
        assert raw.status_code == 200
        assert len(raw.json()["data"]) == 1

        report = owner.get(f"/api/surveys/{survey_id}/report")
        assert report.status_code == 200
        assert report.json()["data"]["totalResponses"] == 1
        assert report.json()["data"]["completedResponses"] == 1
        assert report.json()["data"]["partialResponses"] == 0
        assert report.json()["data"]["completionRate"] == 1.0

        republished = owner.post(f"/api/surveys/{survey_id}/publish", json={})
        assert republished.status_code == 200
        assert republished.json()["data"]["version"] == 2
        public_after_republish = owner.get(f"/api/public/surveys/{slug}")
        assert public_after_republish.json()["data"]["title"] == "수정 중인 설문 제목"

        dashboard = owner.get("/api/dashboard")
        assert dashboard.status_code == 200
        assert dashboard.json()["data"]["totalSurveys"] == 1
        assert dashboard.json()["data"]["totalResponses"] == 1
        assert dashboard.json()["data"]["todayResponses"] == 1
        assert len(dashboard.json()["data"]["responseTrend"]) == 8
        assert sum(point["responses"] for point in dashboard.json()["data"]["responseTrend"]) == 1

        assert owner.post("/api/auth/logout").status_code == 200
        assert owner.get("/api/auth/me").status_code == 401


def test_public_survey_period_state_is_server_authoritative() -> None:
    with TestClient(app) as owner:
        _signup(owner, "survey-period")
        now = datetime.now(timezone.utc)

        korea_period = owner.post(
            "/api/surveys",
            json={
                "title": "Korea standard time normalization",
                "projectProfile": {
                    "startsAt": "2030-01-01T09:00:00+09:00",
                    "closesAt": "2030-01-01T18:00:00+09:00",
                },
            },
        )
        assert korea_period.status_code == 201, korea_period.text
        korea_profile = korea_period.json()["data"]["projectProfile"]
        assert datetime.fromisoformat(korea_profile["startsAt"].replace("Z", "+00:00")) == datetime(
            2030, 1, 1, 0, 0, tzinfo=timezone.utc
        )
        assert datetime.fromisoformat(korea_profile["closesAt"].replace("Z", "+00:00")) == datetime(
            2030, 1, 1, 9, 0, tzinfo=timezone.utc
        )

        def publish_with_period(
            label: str, starts_at: datetime | None, closes_at: datetime | None
        ) -> str:
            profile: dict[str, str] = {}
            if starts_at is not None:
                profile["startsAt"] = starts_at.isoformat()
            if closes_at is not None:
                profile["closesAt"] = closes_at.isoformat()
            created = owner.post(
                "/api/surveys",
                json={
                    "templateId": "social-research",
                    "title": f"Response period {label}",
                    "projectProfile": profile,
                },
            )
            assert created.status_code == 201, created.text
            survey_id = created.json()["data"]["id"]
            published = owner.post(f"/api/surveys/{survey_id}/publish", json={})
            assert published.status_code == 200, published.text
            return published.json()["data"]["slug"]

        scheduled_slug = publish_with_period(
            "scheduled", now + timedelta(days=1), now + timedelta(days=2)
        )
        closed_slug = publish_with_period(
            "closed", now - timedelta(days=2), now - timedelta(days=1)
        )
        open_slug = publish_with_period("open", None, None)

        summaries = owner.get("/api/surveys?status=published")
        assert summaries.status_code == 200, summaries.text
        scheduled_summary = next(
            item
            for item in summaries.json()["data"]
            if item["title"] == "Response period scheduled"
        )
        assert scheduled_summary["startsAt"] is not None
        assert scheduled_summary["closesAt"] is not None

        for slug, expected in (
            (scheduled_slug, "SCHEDULED"),
            (closed_slug, "CLOSED"),
            (open_slug, "OPEN"),
        ):
            response = owner.get(f"/api/public/surveys/{slug}")
            assert response.status_code == 200, response.text
            data = response.json()["data"]
            assert data["availabilityStatus"] == expected
            assert data["serverTime"] is not None

        valid_answers = {"social-residence": "center", "social-score": "4"}
        scheduled_submit = owner.post(
            f"/api/public/surveys/{scheduled_slug}/responses",
            json={"answers": valid_answers},
        )
        assert scheduled_submit.status_code == 409, scheduled_submit.text
        assert "시작" in scheduled_submit.json()["detail"]

        closed_submit = owner.post(
            f"/api/public/surveys/{closed_slug}/responses",
            json={"answers": valid_answers},
        )
        assert closed_submit.status_code == 409, closed_submit.text
        assert "종료" in closed_submit.json()["detail"]


def test_period_edit_reaches_public_url_only_after_new_version_publish() -> None:
    with TestClient(app) as owner:
        _signup(owner, "period-version")
        now = datetime.now(timezone.utc)
        original_start = now + timedelta(days=2)
        original_close = now + timedelta(days=3)
        created = owner.post(
            "/api/surveys",
            json={
                "title": "Versioned response period",
                "templateId": "social-research",
                "projectProfile": {
                    "startsAt": original_start.isoformat(),
                    "closesAt": original_close.isoformat(),
                },
            },
        )
        assert created.status_code == 201, created.text
        survey_id = created.json()["data"]["id"]
        first_publish = owner.post(f"/api/surveys/{survey_id}/publish", json={})
        assert first_publish.status_code == 200, first_publish.text
        slug = first_publish.json()["data"]["slug"]
        assert owner.get(f"/api/public/surveys/{slug}").json()["data"]["availabilityStatus"] == "SCHEDULED"

        changed_start = now - timedelta(hours=1)
        changed_close = now + timedelta(days=1)
        edited = owner.patch(
            f"/api/surveys/{survey_id}",
            json={
                "projectProfile": {
                    "startsAt": changed_start.isoformat(),
                    "closesAt": changed_close.isoformat(),
                }
            },
        )
        assert edited.status_code == 200, edited.text
        assert owner.get(f"/api/public/surveys/{slug}").json()["data"]["availabilityStatus"] == "SCHEDULED"

        second_publish = owner.post(f"/api/surveys/{survey_id}/publish", json={})
        assert second_publish.status_code == 200, second_publish.text
        assert second_publish.json()["data"]["version"] == 2
        assert second_publish.json()["data"]["slug"] == slug
        assert owner.get(f"/api/public/surveys/{slug}").json()["data"]["availabilityStatus"] == "OPEN"


def test_project_profile_template_step_and_project_skin_are_persisted() -> None:
    with TestClient(app) as client:
        _signup(client, "project-step")
        starts_at = datetime.now(timezone.utc) + timedelta(days=1)
        closes_at = starts_at + timedelta(days=14)
        created = client.post(
            "/api/surveys",
            json={
                "title": "지역 서비스 이용 조사",
                "category": "사회조사",
                "description": "지역 서비스 개선을 위한 조사입니다.",
                "projectProfile": {
                    "startsAt": starts_at.isoformat(),
                    "closesAt": closes_at.isoformat(),
                    "identified": True,
                    "showProgress": False,
                    "targetAudience": "지역 서비스 이용자",
                    "populationMode": "known",
                    "populationSize": 1200,
                    "targetResponseCount": 291,
                },
            },
        )
        assert created.status_code == 201, created.text
        project = created.json()["data"]
        survey_id = project["id"]
        assert project["projectProfile"]["targetAudience"] == "지역 서비스 이용자"
        assert project["settings"]["anonymous"] is False
        assert project["settings"]["showProgressBar"] is False

        templated = client.post(
            f"/api/surveys/{survey_id}/template",
            json={"templateCode": "social-research"},
        )
        assert templated.status_code == 200, templated.text
        templated_data = templated.json()["data"]
        assert templated_data["templateCode"] == "social-research"
        assert templated_data["questionCount"] > 0
        assert templated_data["projectProfile"] == project["projectProfile"]
        assert templated_data["settings"]["anonymous"] is False

        skin = {"preset": "forest", "primary": "#176B55", "shareTitle": "지역 조사"}
        skinned = client.patch(
            f"/api/surveys/{survey_id}",
            json={"skin": skin},
        )
        assert skinned.status_code == 200, skinned.text
        assert skinned.json()["data"]["skin"] == skin
        assert skinned.json()["data"]["projectProfile"] == project["projectProfile"]

        revised = client.patch(
            f"/api/surveys/{survey_id}",
            json={
                "title": "지역 서비스 이용 조사(수정)",
                "projectProfile": {
                    **project["projectProfile"],
                    "targetAudience": "지역 서비스 이용 경험자",
                    "targetResponseCount": 300,
                },
            },
        )
        assert revised.status_code == 200, revised.text
        assert revised.json()["data"]["title"].endswith("(수정)")
        assert revised.json()["data"]["projectProfile"]["targetAudience"] == "지역 서비스 이용 경험자"

        second = client.post("/api/surveys", json={"title": "별도 스킨 프로젝트"})
        assert second.status_code == 201, second.text
        assert second.json()["data"]["skin"] != skin


def test_large_custom_source_and_email_html_round_trip_through_clob_json() -> None:
    with TestClient(app) as client:
        _signup(client, "custom-source")
        created = client.post(
            "/api/surveys",
            json={"title": "사용자 코드 설문", "templateId": "social-research"},
        )
        assert created.status_code == 201, created.text
        survey_id = created.json()["data"]["id"]
        long_html = f'<section class="tenant-guide"><p>{"안내문" * 5000}</p></section>'
        custom_code = {
            "enabled": True,
            "placement": "beforeQuestions",
            "html": long_html,
            "css": ".tenant-guide { padding: 24px; color: #173f82; }",
            "javascript": 'document.querySelector(".tenant-guide")?.setAttribute("data-ready", "true");',
        }
        assert len(long_html.encode("utf-8")) > 4000

        saved = client.patch(
            f"/api/surveys/{survey_id}",
            json={"skin": {"preset": "ocean", "customCode": custom_code}},
        )
        assert saved.status_code == 200, saved.text
        assert saved.json()["data"]["skin"]["customCode"] == custom_code

        published = client.post(f"/api/surveys/{survey_id}/publish", json={})
        assert published.status_code == 200, published.text
        slug = published.json()["data"]["slug"]
        assert re.fullmatch(r"svy-\d{8}-[0-9a-f]{32}", slug)
        public = client.get(f"/api/public/surveys/{slug}")
        assert public.status_code == 200, public.text
        assert public.json()["data"]["skin"]["customCode"]["html"] == long_html

        email_html = f'<main><h1>설문 참여 안내</h1><p>{"참여해 주세요. " * 1200}</p></main>'
        assert len(email_html.encode("utf-8")) > 4000
        plan = {
            "recipients": [
                {
                    "id": "recipient-code-001",
                    "name": "테스트 응답자",
                    "countryCode": "KR",
                    "preferredLanguage": "ko",
                    "email": "custom@example.test",
                    "channels": ["EMAIL"],
                }
            ],
            "channels": ["EMAIL"],
            "messagesByLanguage": {
                "ko": {"emailSubject": "설문 참여 안내", "emailBody": email_html}
            },
            "schedule": {"mode": "NOW", "strategy": "ALL_AVAILABLE", "priority": ["EMAIL"]},
            "status": "DRAFT",
        }
        deployment = client.put(f"/api/deployments/by-survey/{survey_id}", json=plan)
        assert deployment.status_code == 200, deployment.text
        assert deployment.json()["data"]["messagesByLanguage"]["ko"]["emailBody"] == email_html


def test_public_url_regeneration_retires_old_route_and_updates_delivery_draft() -> None:
    with TestClient(app) as client:
        _signup(client, "public-url-regeneration")
        created = client.post(
            "/api/surveys",
            json={"title": "URL 재발급 조사", "templateId": "social-research"},
        )
        assert created.status_code == 201, created.text
        survey_id = created.json()["data"]["id"]
        published = client.post(f"/api/surveys/{survey_id}/publish", json={})
        assert published.status_code == 200, published.text
        first_slug = published.json()["data"]["slug"]

        draft = {
            "recipients": [
                {
                    "id": "recipient-url-001",
                    "name": "URL 확인 대상자",
                    "countryCode": "KR",
                    "preferredLanguage": "ko",
                    "email": "url-check@example.test",
                    "channels": ["EMAIL"],
                }
            ],
            "channels": ["EMAIL"],
            "messagesByLanguage": {
                "ko": {
                    "emailSubject": "설문 URL 안내",
                    "emailBody": f"https://survey.example.test/s/{first_slug}?lang=ko",
                }
            },
            "schedule": {
                "mode": "NOW",
                "strategy": "ALL_AVAILABLE",
                "priority": ["EMAIL"],
            },
            "status": "DRAFT",
        }
        saved = client.put(f"/api/deployments/by-survey/{survey_id}", json=draft)
        assert saved.status_code == 200, saved.text
        assert saved.json()["data"]["revision"] == 1

        regenerated = client.post(
            f"/api/surveys/{survey_id}/public-url/regenerate", json={}
        )
        assert regenerated.status_code == 200, regenerated.text
        regenerated_data = regenerated.json()["data"]
        second_slug = regenerated_data["slug"]
        assert regenerated_data["previousSlug"] == first_slug
        assert regenerated_data["deploymentRevision"] == 2
        assert second_slug != first_slug
        assert re.fullmatch(r"svy-\d{8}-[0-9a-f]{32}", second_slug)
        assert client.get(f"/api/public/surveys/{first_slug}").status_code == 404
        current_public = client.get(f"/api/public/surveys/{second_slug}")
        assert current_public.status_code == 200, current_public.text
        assert current_public.json()["data"]["slug"] == second_slug

        loaded_draft = client.get(f"/api/deployments/by-survey/{survey_id}")
        assert loaded_draft.status_code == 200, loaded_draft.text
        loaded_data = loaded_draft.json()["data"]
        assert loaded_data["publicSlug"] == second_slug
        assert loaded_data["revision"] == 2
        email_body = loaded_data["messagesByLanguage"]["ko"]["emailBody"]
        assert f"/s/{second_slug}?lang=ko" in email_body
        assert f"/s/{first_slug}?lang=ko" not in email_body

        regenerated_again = client.post(
            f"/api/surveys/{survey_id}/public-url/regenerate", json={}
        )
        assert regenerated_again.status_code == 200, regenerated_again.text
        third_slug = regenerated_again.json()["data"]["slug"]
        assert third_slug not in {first_slug, second_slug}
        assert regenerated_again.json()["data"]["deploymentRevision"] == 3
        assert client.get(f"/api/public/surveys/{second_slug}").status_code == 404
        assert client.get(f"/api/public/surveys/{third_slug}").status_code == 200


def test_only_non_active_projects_can_be_deleted() -> None:
    with TestClient(app) as owner:
        _provision_and_login(owner)

        draft = owner.post("/api/surveys", json={"title": "삭제할 작성 중 프로젝트"})
        assert draft.status_code == 201, draft.text
        draft_id = draft.json()["data"]["id"]

        deleted = owner.delete(f"/api/surveys/{draft_id}")
        assert deleted.status_code == 200, deleted.text
        assert deleted.json()["data"]["deleted"] is True
        assert owner.get(f"/api/surveys/{draft_id}").status_code == 404
        assert draft_id not in {
            item["id"] for item in owner.get("/api/surveys").json()["data"]
        }

        active = owner.post(
            "/api/surveys",
            json={"title": "진행 중 삭제 차단", "templateId": "social-research"},
        )
        assert active.status_code == 201, active.text
        active_id = active.json()["data"]["id"]
        published = owner.post(f"/api/surveys/{active_id}/publish", json={})
        assert published.status_code == 200
        public_slug = published.json()["data"]["slug"]

        blocked = owner.delete(f"/api/surveys/{active_id}")
        assert blocked.status_code == 409
        assert "진행 중" in blocked.json()["detail"]
        assert owner.get(f"/api/surveys/{active_id}").status_code == 200

        closed = owner.post(f"/api/surveys/{active_id}/close", json={})
        assert closed.status_code == 200, closed.text
        assert closed.json()["data"]["status"] == "closed"
        assert owner.get(f"/api/public/surveys/{public_slug}").status_code == 404

        deleted_after_close = owner.delete(f"/api/surveys/{active_id}")
        assert deleted_after_close.status_code == 200, deleted_after_close.text
        assert owner.get(f"/api/surveys/{active_id}").status_code == 404


def test_distribution_execution_is_immutable_and_new_batch_keeps_masked_contacts() -> None:
    with TestClient(app) as owner:
        _signup(owner, "distribution-batch")
        created = owner.post(
            "/api/surveys",
            json={"title": "다국어 배포 이력 조사", "templateId": "social-research"},
        )
        assert created.status_code == 201, created.text
        survey_id = created.json()["data"]["id"]
        assert owner.post(f"/api/surveys/{survey_id}/publish", json={}).status_code == 200
        confirmed_page = owner.get(
            "/api/surveys/page?status=published&stage=confirmed&page=1&pageSize=24"
        )
        assert confirmed_page.status_code == 200, confirmed_page.text
        confirmed_item = next(
            item for item in confirmed_page.json()["data"]["items"] if item["id"] == survey_id
        )
        assert confirmed_item["deploymentStatus"] == "READY"

        plan = {
            "recipients": [
                {
                    "id": "recipient-001",
                    "name": "테스트 응답자",
                    "countryCode": "KR",
                    "preferredLanguage": "ko",
                    "email": "member@example.test",
                    "mobile": "01012345678",
                    "channels": ["EMAIL", "SMS"],
                }
            ],
            "channels": ["EMAIL", "SMS"],
            "messagesByLanguage": {
                "ko": {
                    "emailSubject": "설문 참여 안내",
                    "emailBody": "설문에 참여해 주세요.",
                    "smsBody": "설문 참여 안내",
                }
            },
            "schedule": {
                "mode": "NOW",
                "strategy": "ALL_AVAILABLE",
                "priority": ["EMAIL", "SMS"],
            },
            "status": "DRAFT",
        }
        saved = owner.put(f"/api/deployments/by-survey/{survey_id}", json=plan)
        assert saved.status_code == 200, saved.text
        first = saved.json()["data"]
        assert first["revision"] == 1
        assert "*" in first["recipients"][0]["email"]

        altered_mask = {**plan, "revision": first["revision"]}
        altered_mask["recipients"] = [
            {**plan["recipients"][0], "email": "x***@example.test"}
        ]
        rejected_mask_edit = owner.put(
            f"/api/deployments/by-survey/{survey_id}", json=altered_mask
        )
        assert rejected_mask_edit.status_code == 422
        assert "전체 값을 다시 입력" in rejected_mask_edit.json()["detail"]

        replacement_plan = {**plan, "revision": first["revision"]}
        replacement_plan["recipients"] = [
            {**plan["recipients"][0], "email": "updated@example.test"}
        ]
        replacement = owner.put(
            f"/api/deployments/by-survey/{survey_id}", json=replacement_plan
        )
        assert replacement.status_code == 200, replacement.text
        replacement_data = replacement.json()["data"]
        assert replacement_data["revision"] == 2
        assert replacement_data["recipients"][0]["email"] == "u***@example.test"

        executed_plan = {**replacement_plan, "revision": replacement_data["revision"]}
        executed = owner.post(
            f"/api/deployments/by-survey/{survey_id}/execute", json=executed_plan
        )
        assert executed.status_code == 200, executed.text
        executed_data = executed.json()["data"]
        assert executed_data["execution"]["executionStatus"] == "DISABLED"
        executed_deployment_id = executed_data["deployment"]["deploymentId"]
        active_page = owner.get(
            "/api/surveys/page?status=published&stage=active&page=1&pageSize=24"
        )
        assert active_page.status_code == 200, active_page.text
        active_item = next(
            item for item in active_page.json()["data"]["items"] if item["id"] == survey_id
        )
        assert active_item["deploymentStatus"] == "ACTIVE"

        immutable = owner.put(
            f"/api/deployments/by-survey/{survey_id}",
            json={**plan, "revision": executed_data["deployment"]["revision"]},
        )
        assert immutable.status_code == 409

        masked = owner.get(f"/api/deployments/by-survey/{survey_id}").json()["data"]
        masked.pop("deploymentId", None)
        masked.pop("surveyId", None)
        masked.pop("surveyVersion", None)
        masked.pop("publicSlug", None)
        masked.pop("updatedAt", None)
        masked.pop("executionStatus", None)
        masked["revision"] = None
        next_batch = owner.put(
            f"/api/deployments/by-survey/{survey_id}", json=masked
        )
        assert next_batch.status_code == 200, next_batch.text
        next_data = next_batch.json()["data"]
        assert next_data["deploymentId"] != executed_deployment_id
        assert next_data["revision"] == 1
        assert next_data["executionStatus"] is None
        assert "*" in next_data["recipients"][0]["email"]


def test_empty_distribution_draft_can_be_saved_but_not_executed() -> None:
    with TestClient(app) as owner:
        _signup(owner, "empty-distribution-draft")
        created = owner.post(
            "/api/surveys",
            json={"title": "대상자 입력 전 배포 초안", "templateId": "social-research"},
        )
        assert created.status_code == 201, created.text
        survey_id = created.json()["data"]["id"]
        assert owner.post(f"/api/surveys/{survey_id}/publish", json={}).status_code == 200

        draft = {
            "recipients": [],
            "channels": [],
            "messagesByLanguage": {},
            "status": "DRAFT",
        }
        saved = owner.put(f"/api/deployments/by-survey/{survey_id}", json=draft)
        assert saved.status_code == 200, saved.text
        saved_data = saved.json()["data"]
        assert saved_data["revision"] == 1
        assert saved_data["recipients"] == []
        assert saved_data["channels"] == []

        loaded = owner.get(f"/api/deployments/by-survey/{survey_id}")
        assert loaded.status_code == 200, loaded.text
        assert loaded.json()["data"]["recipients"] == []

        execution = owner.post(
            f"/api/deployments/by-survey/{survey_id}/execute",
            json={**draft, "revision": saved_data["revision"]},
        )
        assert execution.status_code == 422


def test_recipient_file_import_and_excel_sample_endpoints() -> None:
    with TestClient(app) as owner:
        _signup(owner, "recipient-import")
        text = (
            "name,countryCode,preferredLanguage,email,mobile,fax,kakaoId,channels\r\n"
            "응답자 A001,KR,ko,sample@example.test,,,,EMAIL\r\n"
        ).encode("cp949")
        imported = owner.post(
            "/api/deployments/recipients/import",
            files={"upload": ("recipients.txt", text, "text/plain")},
        )
        assert imported.status_code == 200, imported.text
        imported_data = imported.json()["data"]
        assert imported_data["total"] == 1
        assert imported_data["encoding"] == "cp949"
        assert imported_data["recipients"][0]["name"] == "응답자 A001"

        sample = owner.get("/api/deployments/recipients/sample.xlsx")
        assert sample.status_code == 200, sample.text
        assert sample.content.startswith(b"PK")
        assert "spreadsheetml.sheet" in sample.headers["content-type"]


def test_report_uses_only_latest_published_version_responses_and_snapshot() -> None:
    with TestClient(app) as owner:
        _provision_and_login(owner)

        created = owner.post(
            "/api/surveys",
            json={
                "templateId": "social-research",
                "title": "버전 1 생활 만족도 조사",
            },
        )
        assert created.status_code == 201, created.text
        created_data = created.json()["data"]
        survey_id = created_data["id"]

        published_v1 = owner.post(
            f"/api/surveys/{survey_id}/publish",
            json={"slug": f"version-report-{uuid4().hex[:8]}"},
        )
        assert published_v1.status_code == 200, published_v1.text
        slug = published_v1.json()["data"]["slug"]

        response_v1 = owner.post(
            f"/api/public/surveys/{slug}/responses",
            json={
                "answers": {
                    "social-residence": "center",
                    "social-score": 2,
                }
            },
        )
        assert response_v1.status_code == 201, response_v1.text
        assert response_v1.json()["data"]["surveyVersion"] == 1

        version_two_questions = created_data["questions"]
        score_question = next(
            question
            for question in version_two_questions
            if question["id"] == "social-score"
        )
        score_question["title"] = "버전 2 전용 만족도"
        updated = owner.patch(
            f"/api/surveys/{survey_id}",
            json={
                "title": "버전 2 생활 만족도 조사",
                "questions": version_two_questions,
            },
        )
        assert updated.status_code == 200, updated.text

        published_v2 = owner.post(f"/api/surveys/{survey_id}/publish", json={})
        assert published_v2.status_code == 200, published_v2.text
        assert published_v2.json()["data"]["version"] == 2

        response_v2 = owner.post(
            f"/api/public/surveys/{slug}/responses",
            json={
                "answers": {
                    "social-residence": "east",
                    "social-score": 5,
                }
            },
        )
        assert response_v2.status_code == 201, response_v2.text
        assert response_v2.json()["data"]["surveyVersion"] == 2

        report = owner.get(f"/api/surveys/{survey_id}/report")
        assert report.status_code == 200, report.text
        report_data = report.json()["data"]
        assert report_data["title"] == "버전 2 생활 만족도 조사"
        assert report_data["publishedVersion"] == 2
        assert report_data["totalResponses"] == 1
        assert report_data["completedResponses"] == 1
        assert report_data["partialResponses"] == 0
        assert report_data["completionRate"] == 1.0

        reports_by_id = {
            question["questionId"]: question for question in report_data["questions"]
        }
        residence_report = reports_by_id["social-residence"]
        assert residence_report["responseCount"] == 1
        assert residence_report["optionCounts"] == {"동부권": 1}

        score_report = reports_by_id["social-score"]
        assert score_report["title"] == "버전 2 전용 만족도"
        assert score_report["responseCount"] == 1
        assert score_report["average"] == 5.0

        report_timezone = timezone(timedelta(hours=9))
        today = datetime.now(report_timezone).date()
        completed = owner.get(
            f"/api/surveys/{survey_id}/report",
            params={"cutoffDate": today.isoformat(), "responseStatus": "COMPLETE"},
        )
        assert completed.status_code == 200, completed.text
        assert completed.json()["data"]["totalResponses"] == 1

        before_submission = owner.get(
            f"/api/surveys/{survey_id}/report",
            params={
                "cutoffDate": (today - timedelta(days=1)).isoformat(),
                "status": "all",
            },
        )
        assert before_submission.status_code == 200, before_submission.text
        assert before_submission.json()["data"]["totalResponses"] == 0

        partial = owner.get(
            f"/api/surveys/{survey_id}/report",
            params={"status": "partial"},
        )
        assert partial.status_code == 200, partial.text
        partial_data = partial.json()["data"]
        assert partial_data["totalResponses"] == 0
        assert partial_data["completedResponses"] == 0
        assert partial_data["partialResponses"] == 0
        assert partial_data["completionRate"] == 0.0


def test_optional_composite_answers_with_only_blank_cells_are_omitted() -> None:
    with TestClient(app) as owner:
        _provision_and_login(owner)
        created = owner.post(
            "/api/surveys",
            json={
                "title": "선택 문항 빈 값 처리",
                "questions": [
                    {
                        "id": "optional-matrix",
                        "type": "matrix_single",
                        "title": "선택 매트릭스",
                        "required": False,
                        "rows": ["항목 1", "항목 2"],
                        "columns": ["예", "아니오"],
                    },
                    {
                        "id": "optional-table",
                        "type": "table",
                        "title": "선택 표",
                        "required": False,
                        "rows": ["행 1", "행 2"],
                        "columns": ["열 1", "열 2"],
                    },
                ],
            },
        )
        assert created.status_code == 201, created.text
        survey_id = created.json()["data"]["id"]
        published = owner.post(
            f"/api/surveys/{survey_id}/publish",
            json={"slug": f"optional-empty-{uuid4().hex[:8]}"},
        )
        assert published.status_code == 200, published.text
        slug = published.json()["data"]["slug"]

        submitted = owner.post(
            f"/api/public/surveys/{slug}/responses",
            json={
                "answers": {
                    "optional-matrix": {"0": "", "1": ""},
                    "optional-table": [{"columnA": ""}, {"columnA": "   "}],
                }
            },
        )
        assert submitted.status_code == 201, submitted.text

        raw = owner.get(f"/api/surveys/{survey_id}/responses")
        assert raw.status_code == 200, raw.text
        assert raw.json()["data"][0]["answers"] == []


def test_oracle_mode_never_silently_uses_memory_repository() -> None:
    original_mode = settings.db_mode
    object.__setattr__(settings, "db_mode", "oracle")
    try:
        with TestClient(app) as client:
            health = client.get("/api/health")
            assert health.status_code == 200, health.text
            assert health.json()["database"]["mode"] == "oracle"

            blocked = client.get("/api/templates")
            assert blocked.status_code == 503, blocked.text
            assert "not implemented" in blocked.json()["detail"]
    finally:
        object.__setattr__(settings, "db_mode", original_mode)


def test_tenant_isolation_returns_not_found() -> None:
    with TestClient(app) as first, TestClient(app) as second:
        _signup(first, "alpha")
        _signup(second, "beta")
        created = first.post(
            "/api/surveys",
            json={"templateCode": "integrity-survey", "title": "기관 내부 설문"},
        )
        assert created.status_code == 201
        survey_id = created.json()["data"]["id"]

        hidden = second.get(f"/api/surveys/{survey_id}")
        assert hidden.status_code == 404
        assert second.get(f"/api/surveys/{survey_id}/responses").status_code == 404
        assert second.get(f"/api/surveys/{survey_id}/report").status_code == 404
