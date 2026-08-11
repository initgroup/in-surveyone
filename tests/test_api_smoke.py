from __future__ import annotations

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
        },
    )
    assert response.status_code == 201, response.text
    assert "httponly" in response.headers["set-cookie"].lower()
    return response.json()["data"]


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


def test_guest_create_publish_respond_and_report_flow() -> None:
    with TestClient(app) as owner:
        guest = owner.post("/api/auth/guest")
        assert guest.status_code == 201
        assert guest.json()["data"]["user"]["isGuest"] is True
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

        assert owner.post("/api/auth/logout").status_code == 200
        assert owner.get("/api/auth/me").status_code == 401


def test_report_uses_only_latest_published_version_responses_and_snapshot() -> None:
    with TestClient(app) as owner:
        assert owner.post("/api/auth/guest").status_code == 201

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
        assert owner.post("/api/auth/guest").status_code == 201
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
