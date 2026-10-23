from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from conftest import signup_member

from backend.errors import DomainValidationError
from backend.memory_store import MemoryStore, submission_payload_hash
from backend.models import (
    PublicSurvey, Question, SubmitResponseRequest, SurveySection, SurveySettings,
    SurveyTheme, SurveyUpdateRequest,
)
from backend.oracle_store import OracleStore
from backend.survey_audience import audience_submission, resolve_audience
from main import app


def fixture_survey() -> PublicSurvey:
    options = [{"id": f"dept_{i}", "code": str(i), "label": f"Department {i}"} for i in range(1, 7)]
    return PublicSurvey(
        survey_id="audience-test", slug="audience-test", version=1,
        title="Test", category="test", published_at=datetime.now(timezone.utc),
        theme=SurveyTheme(), sections=[
            SurveySection(id="evaluation", title="Evaluation", questions=[
                Question(id="rating", type="scale", title="Rating", required=True, settings={"minValue": 1, "maxValue": 5}),
            ]),
            SurveySection(id="profile", title="Profile", questions=[
                Question(id="department", type="dropdown", title="Department", required=True, options=options),
            ]),
            SurveySection(id="cooperation", title="Cooperation", questions=[
                Question(id="excellent", type="multiple", title="Excellent", required=True, options=options,
                         settings={"choiceInput": "codes", "minSelections": 1, "maxSelections": 5, "excludeSelectedFrom": "department"}),
                Question(id="poor", type="multiple", title="Poor", required=True, options=options,
                         settings={"maxSelections": 5, "excludeSelectedFrom": "department"}),
            ]),
        ], settings=SurveySettings(audienceRoutes=[
            {"code": "evaluation", "label": "Evaluation", "sectionIds": ["evaluation"]},
            {"code": "cooperation", "label": "Cooperation", "sectionIds": ["profile", "cooperation"]},
            {"code": "all", "label": "All", "sectionIds": ["evaluation", "profile", "cooperation"]},
        ], defaultAudience="evaluation"),
    )


@pytest.mark.parametrize("store_class", [MemoryStore, OracleStore])
def test_route_required_fields_canonical_codes_and_exclusions(store_class) -> None:
    store = object.__new__(store_class)
    survey = fixture_survey()
    request = SubmitResponseRequest(audienceCode="cooperation", answers={
        "department": "dept_1", "excellent": ["02", 3], "poor": ["dept_4"],
    }, metadata={"audienceCode": "forged"})
    selected, canonical = audience_submission(survey, request)
    assert canonical.metadata["audienceCode"] == "cooperation"
    assert [s.id for s in selected.sections] == ["profile", "cooperation"]
    assert store._validate_answers(selected, request.answers)[1].value == ["dept_2", "dept_3"]
    assert len(survey.sections) == 3
    for bad in [["1"], ["2", "02"], ["999"], [True], ["2", "3", "4", "5", "6", "1"]]:
        invalid = SubmitResponseRequest(audienceCode="cooperation", answers={
            "department": "dept_1", "excellent": bad, "poor": ["dept_4"],
        })
        with pytest.raises(DomainValidationError):
            store._validate_answers(selected, invalid.answers)
    with pytest.raises(DomainValidationError):
        store._validate_answers(selected, SubmitResponseRequest(answers={"rating": 3}).answers)
    with pytest.raises(DomainValidationError):
        store._validate_answers(selected, [])
    evaluation, canonical = audience_submission(survey, SubmitResponseRequest(answers={"rating": 4}))
    assert canonical.audience_code == "evaluation"
    assert store._validate_answers(evaluation, canonical.answers)[0].value == 4
    assert resolve_audience(survey, "all") == "all"
    with pytest.raises(DomainValidationError):
        resolve_audience(survey, "unknown")


def test_audience_and_code_schema_rejects_ambiguous_configuration() -> None:
    survey = fixture_survey()
    for routes, default in [
        ([{"code": "bad?", "label": "Bad", "sectionIds": ["evaluation"]}], "bad?"),
        ([{"code": "a", "label": "A", "sectionIds": ["evaluation"]}] * 2, "a"),
        ([{"code": "a", "label": "A", "sectionIds": []}], "a"),
        ([{"code": "a", "label": "A", "sectionIds": ["evaluation"]}], "missing"),
    ]:
        with pytest.raises(ValueError):
            SurveySettings(audienceRoutes=routes, defaultAudience=default)
    for ids in [["missing"], ["cooperation"]]:
        with pytest.raises(ValueError):
            SurveyUpdateRequest(sections=survey.sections, settings={
                "audienceRoutes": [{"code": "a", "label": "A", "sectionIds": ids}], "defaultAudience": "a",
            })
    original = survey.sections[2].questions[0].model_dump(by_alias=True)
    for change in ["duplicate", "missing", "zero", "unbounded", "single"]:
        data = {**original, "options": [dict(o) for o in original["options"]], "settings": dict(original["settings"])}
        if change == "duplicate":
            data["options"][1]["code"] = "1"
        if change == "missing":
            data["options"][1]["code"] = None
        if change == "zero":
            data["options"][1]["code"] = "0"
        if change == "unbounded":
            data["settings"]["maxSelections"] = 21
        if change == "single":
            data["type"] = "single"
        with pytest.raises(ValueError):
            Question.model_validate(data)


def test_idempotency_distinguishes_audiences_and_reports_keep_option_ids() -> None:
    survey = fixture_survey()
    first = SubmitResponseRequest(audienceCode="evaluation", answers={"rating": 3})
    second = SubmitResponseRequest(audienceCode="all", answers={"rating": 3})
    assert submission_payload_hash(survey, first.answers, first) != submission_payload_hash(survey, second.answers, second)
    question = survey.sections[2].questions[0]
    result = MemoryStore._question_report(question, [["dept_2", "dept_3"], ["dept_2"]])
    assert result.option_counts == {"Department 2": 2, "Department 3": 1}


def test_public_api_route_snapshot_and_partial_updates_are_atomic() -> None:
    with TestClient(app) as client:
        signup_member(client)
        fixture = fixture_survey()
        created = client.post("/api/surveys", json={"title": "Audience test", "sections": [s.model_dump(by_alias=True, mode="json") for s in fixture.sections], "settings": fixture.settings.model_dump(by_alias=True, mode="json")})
        assert created.status_code == 201, created.text
        survey_id = created.json()["data"]["id"]
        before = client.get(f"/api/surveys/{survey_id}").json()["data"]
        invalid = client.patch(f"/api/surveys/{survey_id}", json={"title": "Must not change", "sections": [fixture.sections[0].model_dump(by_alias=True, mode="json")]})
        assert invalid.status_code == 422, invalid.text
        after = client.get(f"/api/surveys/{survey_id}").json()["data"]
        assert after["title"] == before["title"] and after["revision"] == before["revision"]
        pub = client.post(f"/api/surveys/{survey_id}/publish", json={})
        assert pub.status_code == 200, pub.text
        slug = pub.json()["data"]["slug"]
        assert client.get(f"/api/public/surveys/{slug}").json()["data"]["audienceCode"] == "evaluation"
        assert client.get(f"/api/public/surveys/{slug}?audience=cooperation&lang=ko").json()["data"]["audienceCode"] == "cooperation"
        assert client.get(f"/api/public/surveys/{slug}?audience=bad").status_code == 422
        ok = client.post(f"/api/public/surveys/{slug}/responses", json={"audienceCode": "cooperation", "answers": {"department": "dept_1", "excellent": ["2"], "poor": ["dept_3"]}})
        assert ok.status_code == 201, ok.text
        assert client.post(f"/api/public/surveys/{slug}/responses", json={"audienceCode": "evaluation", "answers": {"department": "dept_1"}}).status_code == 422
        assert client.patch(f"/api/surveys/{survey_id}", json={"settings": {"audienceRoutes": [], "defaultAudience": None}}).status_code == 200
        assert client.get(f"/api/public/surveys/{slug}?audience=cooperation").json()["data"]["audienceCode"] == "cooperation"


def test_numeric_stable_ids_take_precedence_over_display_codes() -> None:
    question = Question(type="multiple", title="Numeric identifiers", options=[
        {"id": "1", "code": "2", "label": "First"},
        {"id": "2", "code": "1", "label": "Second"},
    ], settings={"choiceInput": "codes", "maxSelections": 2})
    assert MemoryStore._normalize_answer_value(question, ["1", "2"]) == ["1", "2"]
