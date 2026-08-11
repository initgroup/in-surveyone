from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from backend.errors import NotFoundError
from backend.models import SubmitResponseRequest
import backend.stores as stores
from main import app, settings


def test_guest_capabilities_and_local_limits() -> None:
    with TestClient(app) as client:
        capabilities = client.get("/api/auth/guest/capabilities")
        assert capabilities.status_code == 200, capabilities.text
        modes = {
            item["mode"]: item for item in capabilities.json()["data"]["modes"]
        }
        assert modes["local"]["available"] is True
        assert modes["local"]["limits"]["maxProjects"] == settings.local_guest_max_projects
        assert modes["database"]["available"] is False
        assert modes["database"]["features"]["externalDelivery"] is False
        assert modes["database"]["features"]["customReportPersistence"] is False
        assert modes["database"]["limits"]["maxProjects"] == settings.db_guest_max_projects
        assert (
            modes["database"]["limits"]["maxQuestionsPerSurvey"]
            == settings.db_guest_max_questions
        )
        assert (
            modes["database"]["limits"]["maxResponsesPerSurvey"]
            == settings.db_guest_max_responses
        )

        guest = client.post(
            "/api/auth/guest",
            json={"mode": "local", "displayName": "Local tester"},
        )
        assert guest.status_code == 201, guest.text
        assert guest.json()["data"]["user"]["guestMode"] == "local"
        expires_at = datetime.fromisoformat(guest.json()["data"]["expiresAt"])
        remaining = (expires_at - datetime.now(timezone.utc)).total_seconds()
        assert settings.guest_project_ttl_hours * 3600 - 10 <= remaining
        cookie = guest.headers["set-cookie"].lower()
        assert f"max-age={settings.guest_project_ttl_hours * 3600}" in cookie or (
            f"max-age={settings.guest_project_ttl_hours * 3600 - 1}" in cookie
        )

        for index in range(settings.local_guest_max_projects):
            created = client.post(
                "/api/surveys",
                json={
                    "title": f"Local project {index}",
                    "questions": [
                        {
                            "id": f"q-{index}",
                            "type": "short_text",
                            "title": "Question",
                        }
                    ],
                },
            )
            assert created.status_code == 201, created.text

        rejected = client.post(
            "/api/surveys",
            json={
                "title": "Over limit",
                "questions": [
                    {"id": "q-over", "type": "short_text", "title": "Question"}
                ],
            },
        )
        assert rejected.status_code == 422
        assert "limit" in rejected.json()["detail"].lower()


def test_multilingual_snapshot_and_public_language_resolution() -> None:
    with TestClient(app) as client:
        assert client.post("/api/auth/guest", json={"mode": "local"}).status_code == 201
        slug = f"i18n-{uuid4().hex[:10]}"
        created = client.post(
            "/api/surveys",
            json={
                "title": "한국어 설문",
                "questions": [
                    {
                        "id": "choice-q",
                        "type": "single",
                        "title": "선택해 주세요",
                        "options": [{"id": "yes", "label": "예"}],
                    }
                ],
                "languages": {
                    "sourceLocale": "ko",
                    "defaultLocale": "ko",
                    "enabled": ["ko", "en"],
                },
                "translations": {
                    "en": {
                        "title": "English survey",
                        "confirmationMessage": "Thank you",
                        "sections": {
                            "ignored-section": {"title": "Ignored"},
                            "section": {
                                "questions": {
                                    "choice-q": {
                                        "title": "Choose one",
                                        "options": {"yes": "Yes"},
                                    }
                                }
                            },
                        },
                        "questionTitles": {"choice-q": "Choose one"},
                        "optionLabels": {"choice-q": {"yes": "Yes"}},
                    }
                },
            },
        )
        assert created.status_code == 201, created.text
        survey = created.json()["data"]
        assert survey["languages"]["sourceLocale"] == "ko"
        assert survey["languages"]["enabled"] == ["ko", "en"]

        unsafe_promotion = client.put(
            f"/api/surveys/{survey['id']}",
            json={
                "languages": {
                    "sourceLocale": "en",
                    "defaultLocale": "ko",
                    "enabled": ["ko", "en"],
                }
            },
        )
        assert unsafe_promotion.status_code == 422
        assert "sourcelocale" in unsafe_promotion.json()["detail"].lower()

        published = client.post(
            f"/api/surveys/{survey['id']}/publish", json={"slug": slug}
        )
        assert published.status_code == 200, published.text
        slug = published.json()["data"]["slug"]
        assert slug.startswith("local-guest-")
        english = client.get(f"/api/public/surveys/{slug}", params={"lang": "en"})
        assert english.status_code == 200, english.text
        payload = english.json()["data"]
        assert payload["title"] == "English survey"
        assert payload["requestedLocale"] == "en"
        assert payload["questions"][0]["title"] == "Choose one"
        assert payload["questions"][0]["options"][0]["label"] == "Yes"
        assert payload["translations"]["en"]["sections"]["section"]["questions"][
            "choice-q"
        ]["options"]["yes"] == "Yes"


def test_matrix_translation_syncs_index_keys_to_both_axis_shapes() -> None:
    with TestClient(app) as client:
        assert client.post("/api/auth/guest", json={"mode": "local"}).status_code == 201
        slug = f"matrix-i18n-{uuid4().hex[:8]}"
        created = client.post(
            "/api/surveys",
            json={
                "title": "행렬 설문",
                "sections": [
                    {
                        "id": "matrix-section",
                        "title": "평가",
                        "questions": [
                            {
                                "id": "matrix-q",
                                "type": "matrix_single",
                                "title": "평가해 주세요",
                                "rows": ["품질", "가격"],
                                "columns": ["불만족", "만족"],
                            }
                        ],
                    }
                ],
                "languages": {
                    "sourceLocale": "ko",
                    "defaultLocale": "ko",
                    "enabled": ["ko", "en"],
                },
                "translations": {
                    "en": {
                        "sections": {
                            "matrix-section": {
                                "questions": {
                                    "matrix-q": {
                                        "title": "Rate each item",
                                        "rows": {"0": "Quality", "1": "Price"},
                                        "columns": {
                                            "0": "Dissatisfied",
                                            "1": "Satisfied",
                                        },
                                    }
                                }
                            }
                        }
                    }
                },
            },
        )
        assert created.status_code == 201, created.text
        survey_id = created.json()["data"]["id"]
        published = client.post(
            f"/api/surveys/{survey_id}/publish", json={"slug": slug}
        )
        assert published.status_code == 200, published.text
        slug = published.json()["data"]["slug"]
        assert slug.startswith("local-guest-")

        public = client.get(f"/api/public/surveys/{slug}", params={"lang": "en"})
        assert public.status_code == 200, public.text
        question = public.json()["data"]["questions"][0]
        assert question["rows"] == ["Quality", "Price"]
        assert question["columns"] == ["Dissatisfied", "Satisfied"]
        assert [item["label"] for item in question["settings"]["rows"]] == [
            "Quality",
            "Price",
        ]
        assert [item["label"] for item in question["settings"]["columns"]] == [
            "Dissatisfied",
            "Satisfied",
        ]


def test_public_store_uses_explicit_local_namespace_without_shadowing(
    monkeypatch,
) -> None:
    class FakeOracleStore:
        def __init__(self) -> None:
            self.lookups: list[str] = []

        def public_survey(self, slug: str, language: str | None = None):
            self.lookups.append(slug)
            return None

    fake_oracle = FakeOracleStore()
    original_mode = settings.db_mode
    object.__setattr__(settings, "db_mode", "oracle")
    monkeypatch.setattr(stores, "oracle_store", lambda: fake_oracle)
    try:
        with pytest.raises(NotFoundError):
            stores.public_store("local-guest-missing")
        assert fake_oracle.lookups == []

        selected = stores.public_store("citizen-life-demo")
        assert selected is fake_oracle
        assert fake_oracle.lookups == ["citizen-life-demo"]
    finally:
        object.__setattr__(settings, "db_mode", original_mode)


def test_local_one_response_policy_requires_respondent_key() -> None:
    with TestClient(app) as client:
        assert client.post("/api/auth/guest", json={"mode": "local"}).status_code == 201
        created = client.post(
            "/api/surveys",
            json={
                "title": "One response local",
                "questions": [
                    {"id": "q1", "type": "short_text", "title": "Optional"}
                ],
                "settings": {"oneResponsePerRespondent": True},
            },
        )
        assert created.status_code == 201, created.text
        published = client.post(
            f"/api/surveys/{created.json()['data']['id']}/publish", json={}
        )
        assert published.status_code == 200, published.text
        slug = published.json()["data"]["slug"]

        rejected = client.post(
            f"/api/public/surveys/{slug}/responses",
            json={"answers": {}},
        )
        assert rejected.status_code == 422
        assert "respondentkey" in rejected.json()["detail"].lower()


def test_local_response_idempotency_and_payload_limits() -> None:
    with TestClient(app) as client:
        assert client.post("/api/auth/guest", json={"mode": "local"}).status_code == 201
        created = client.post(
            "/api/surveys",
            json={
                "title": "Retry local",
                "questions": [
                    {"id": "q1", "type": "short_text", "title": "Optional"}
                ],
            },
        )
        assert created.status_code == 201, created.text
        published = client.post(
            f"/api/surveys/{created.json()['data']['id']}/publish", json={}
        )
        slug = published.json()["data"]["slug"]
        headers = {"Idempotency-Key": "browser-retry-1"}
        payload = {"answers": {"q1": "same"}, "metadata": {"channel": "test"}}

        first = client.post(
            f"/api/public/surveys/{slug}/responses",
            json=payload,
            headers=headers,
        )
        retried = client.post(
            f"/api/public/surveys/{slug}/responses",
            json=payload,
            headers=headers,
        )
        assert first.status_code == retried.status_code == 201
        assert first.json()["data"] == retried.json()["data"]

        changed = client.post(
            f"/api/public/surveys/{slug}/responses",
            json={"answers": {"q1": "changed"}},
            headers=headers,
        )
        assert changed.status_code == 409
        invalid_key = client.post(
            f"/api/public/surveys/{slug}/responses",
            json=payload,
            headers={"Idempotency-Key": "contains whitespace"},
        )
        assert invalid_key.status_code == 422

        oversized = client.post(
            f"/api/public/surveys/{slug}/responses",
            json={"answers": {"q1": "x" * (settings.public_submit_max_bytes + 1)}},
        )
        assert oversized.status_code == 422
        too_deep: object = "value"
        for _ in range(20):
            too_deep = [too_deep]
        nested = client.post(
            f"/api/public/surveys/{slug}/responses",
            json={"answers": {"q1": too_deep}},
        )
        assert nested.status_code == 422


@pytest.mark.parametrize("non_finite", [float("nan"), float("inf"), float("-inf")])
def test_public_submission_model_rejects_non_finite_values(non_finite: float) -> None:
    with pytest.raises(ValueError, match="NaN or Infinity"):
        SubmitResponseRequest(
            answers=[
                {
                    "questionId": "q1",
                    "value": {"nested": [non_finite]},
                }
            ]
        )


def test_memory_public_numeric_submission_rejects_nan() -> None:
    with TestClient(app) as client:
        assert client.post("/api/auth/guest", json={"mode": "local"}).status_code == 201
        created = client.post(
            "/api/surveys",
            json={
                "title": "Finite numbers only",
                "questions": [
                    {
                        "id": "numeric",
                        "type": "number",
                        "title": "Number",
                        "required": True,
                    }
                ],
            },
        )
        published = client.post(
            f"/api/surveys/{created.json()['data']['id']}/publish", json={}
        )
        slug = published.json()["data"]["slug"]

        response = client.post(
            f"/api/public/surveys/{slug}/responses",
            content='{"answers":{"numeric":NaN}}',
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 422
        numeric_string = client.post(
            f"/api/public/surveys/{slug}/responses",
            json={"answers": {"numeric": "Infinity"}},
        )
        assert numeric_string.status_code == 422


def test_server_logic_allows_hidden_required_and_rejects_hidden_answer() -> None:
    with TestClient(app) as client:
        assert client.post("/api/auth/guest", json={"mode": "local"}).status_code == 201
        created = client.post(
            "/api/surveys",
            json={
                "title": "Branching",
                "sections": [
                    {
                        "id": "start",
                        "title": "Start",
                        "questions": [
                            {
                                "id": "route",
                                "type": "single",
                                "title": "Skip details?",
                                "required": True,
                                "options": [
                                    {"id": "yes", "label": "Yes"},
                                    {"id": "no", "label": "No"},
                                ],
                            }
                        ],
                    },
                    {
                        "id": "details",
                        "title": "Details",
                        "questions": [
                            {
                                "id": "hidden-required",
                                "type": "short_text",
                                "title": "Required details",
                                "required": True,
                            }
                        ],
                    },
                    {
                        "id": "finish",
                        "title": "Finish",
                        "questions": [
                            {
                                "id": "optional",
                                "type": "short_text",
                                "title": "Optional",
                            }
                        ],
                    },
                ],
                "logicRules": [
                    {
                        "id": "skip-details",
                        "sourceQuestionId": "route",
                        "operator": "equals",
                        "value": "yes",
                        "targetSectionId": "finish",
                    }
                ],
            },
        )
        assert created.status_code == 201, created.text
        published = client.post(
            f"/api/surveys/{created.json()['data']['id']}/publish", json={}
        )
        slug = published.json()["data"]["slug"]

        accepted = client.post(
            f"/api/public/surveys/{slug}/responses",
            json={"answers": {"route": "yes"}},
        )
        assert accepted.status_code == 201, accepted.text

        tampered = client.post(
            f"/api/public/surveys/{slug}/responses",
            json={
                "answers": {
                    "route": "yes",
                    "hidden-required": "forged hidden value",
                }
            },
        )
        assert tampered.status_code == 422
        assert "숨겨진" in tampered.json()["detail"]


def test_expired_local_guest_public_url_and_submission_are_blocked() -> None:
    with TestClient(app) as client:
        guest = client.post("/api/auth/guest", json={"mode": "local"})
        tenant_id = guest.json()["data"]["user"]["tenantId"]
        created = client.post(
            "/api/surveys",
            json={
                "title": "Expiring demo",
                "questions": [
                    {"id": "q1", "type": "short_text", "title": "Optional"}
                ],
            },
        )
        published = client.post(
            f"/api/surveys/{created.json()['data']['id']}/publish", json={}
        )
        slug = published.json()["data"]["slug"]
        before = client.get(f"/api/public/surveys/{slug}")
        assert before.status_code == 200
        assert before.json()["data"]["guestDemo"] is True
        assert before.json()["data"]["experienceExpiresAt"] is not None

        tenant = stores.memory_store._tenants[tenant_id]
        stores.memory_store._tenants[tenant_id] = replace(
            tenant,
            expires_at=datetime.now(timezone.utc) - timedelta(seconds=1),
        )

        assert client.get(f"/api/public/surveys/{slug}").status_code == 404
        assert (
            client.post(
                f"/api/public/surveys/{slug}/responses",
                json={"answers": {}},
            ).status_code
            == 404
        )
