from __future__ import annotations

from datetime import date, datetime, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from conftest import signup_member

from backend.errors import DomainValidationError
from backend.memory_store import MemoryStore, report_cutoff_exclusive
from backend.models import (
    Question,
    QuestionOption,
    QuestionSettings,
    QuestionType,
    SurveyCreateRequest,
    SurveySection,
    SurveySettings,
    validate_publish_ready_sections,
)
from backend.oracle_store import OracleStore
from main import app


def _provision_and_login(client: TestClient) -> dict:
    return signup_member(client)


def test_survey_period_requires_timezone_and_normalizes_to_utc() -> None:
    with pytest.raises(ValueError, match="timezone"):
        SurveySettings(startsAt="2030-01-01T09:00:00")

    settings = SurveySettings(
        startsAt="2030-01-01T09:00:00+09:00",
        closesAt="2030-01-01T10:00:00+09:00",
    )
    assert settings.starts_at == datetime(2030, 1, 1, tzinfo=timezone.utc)
    assert settings.closes_at == datetime(2030, 1, 1, 1, tzinfo=timezone.utc)

    with pytest.raises(ValueError, match="earlier"):
        SurveySettings(
            startsAt="2030-01-01T10:00:00+09:00",
            closesAt="2030-01-01T09:00:00+09:00",
        )

    with TestClient(app) as client:
        _provision_and_login(client)
        response = client.post(
            "/api/surveys",
            json={
                "title": "Naive schedule",
                "settings": {"startsAt": "2030-01-01T09:00:00"},
            },
        )
        assert response.status_code == 422


@pytest.mark.parametrize("invalid_id", ["한글-id", "question:option", "x" * 81])
def test_oracle_stable_ids_are_ascii_and_byte_bounded(invalid_id: str) -> None:
    with pytest.raises(ValueError):
        QuestionOption(id=invalid_id, label="Option")
    with pytest.raises(ValueError):
        Question(id=invalid_id, type=QuestionType.SHORT_TEXT, title="Question")
    with pytest.raises(ValueError):
        SurveySection(id=invalid_id, title="Section")


def test_translations_cannot_reference_unknown_stable_ids() -> None:
    with pytest.raises(ValueError, match="unknown stable IDs"):
        SurveyCreateRequest.model_validate(
            {
                "title": "Translated survey",
                "languages": {
                    "sourceLocale": "ko",
                    "defaultLocale": "ko",
                    "enabled": ["ko", "en"],
                },
                "sections": [
                    {
                        "id": "section-1",
                        "title": "Section",
                        "questions": [
                            {
                                "id": "question-1",
                                "type": "single",
                                "title": "Question",
                                "options": [{"id": "yes", "label": "Yes"}],
                            }
                        ],
                    }
                ],
                "translations": {
                    "en": {"sectionTitles": {"missing-section": "Missing"}}
                },
            }
        )


def test_report_cutoff_rejects_unrepresentable_exclusive_date() -> None:
    with pytest.raises(DomainValidationError, match="cutoffDate"):
        report_cutoff_exclusive(date.max)


def test_question_top_level_and_settings_are_canonical_and_equal() -> None:
    synchronized = Question(
        id="range",
        type=QuestionType.SLIDER,
        title="Range",
        settings={"minValue": 1, "maxValue": 5},
    )
    assert synchronized.min == synchronized.settings.min_value == 1
    assert synchronized.max == synchronized.settings.max_value == 5

    matrix = Question(
        id="matrix",
        type="matrix_single",
        title="Matrix",
        rows=["Quality"],
        columns=["Good"],
        settings={
            "rows": [{"id": "quality", "label": "Quality"}],
            "columns": [{"id": "good", "label": "Good"}],
        },
    )
    assert matrix.rows == [item.label for item in matrix.settings.rows]
    assert matrix.columns == [item.label for item in matrix.settings.columns]

    with pytest.raises(ValueError, match="min"):
        Question(
            id="conflicting-range",
            type=QuestionType.NUMBER,
            title="Conflict",
            min=0,
            settings={"minValue": 1},
        )
    with pytest.raises(ValueError, match="rows"):
        Question(
            id="conflicting-axis",
            type="matrix_single",
            title="Conflict",
            rows=["Top-level"],
            columns=["Column"],
            settings={
                "rows": [{"id": "row", "label": "Settings"}],
                "columns": [{"id": "column", "label": "Column"}],
            },
        )
    incomplete_table = Question(
        id="invalid-table",
        type=QuestionType.TABLE,
        title="Missing shape",
    )
    with pytest.raises(ValueError, match="행과 열"):
        validate_publish_ready_sections(
            [SurveySection(title="Section", questions=[incomplete_table])]
        )

    repeat_table = Question(
        id="repeat-table",
        type=QuestionType.REPEAT_TABLE,
        title="Respondent-added rows",
        columns=["Name", "Value"],
    )
    validate_publish_ready_sections(
        [SurveySection(title="Section", questions=[repeat_table])]
    )


@pytest.mark.parametrize(
    ("field_name", "value"),
    [
        ("minValue", float("nan")),
        ("maxValue", float("inf")),
        ("step", float("-inf")),
    ],
)
def test_question_settings_reject_non_finite_design_numbers(
    field_name: str, value: float
) -> None:
    with pytest.raises(ValueError, match="finite"):
        QuestionSettings.model_validate({field_name: value})


@pytest.mark.parametrize(
    ("minimum", "maximum", "message"),
    [
        (None, 5, "최솟값과 최댓값"),
        (0.5, 5, "정수"),
        (2, 5, "0 또는 1"),
        (1, 11, "2에서 10 사이"),
        (1, 1, "최댓값보다 작아야"),
    ],
)
def test_scale_design_contract_rejects_unsupported_ranges(
    minimum: float | None, maximum: float, message: str
) -> None:
    settings = {"maxValue": maximum}
    if minimum is not None:
        settings["minValue"] = minimum
    question = Question(
        id="invalid-scale",
        type=QuestionType.SCALE,
        title="Invalid scale",
        settings=settings,
    )
    with pytest.raises(ValueError, match=message):
        validate_publish_ready_sections(
            [SurveySection(title="Section", questions=[question])]
        )


def test_scale_design_requires_unit_step() -> None:
    question = Question(
        id="invalid-scale-step",
        type=QuestionType.SCALE,
        title="Invalid scale step",
        settings={"minValue": 1, "maxValue": 5, "step": 0.5},
    )
    with pytest.raises(ValueError, match="간격은 1"):
        validate_publish_ready_sections(
            [SurveySection(title="Section", questions=[question])]
        )


def test_scale_contract_is_enforced_by_survey_api() -> None:
    with TestClient(app) as client:
        _provision_and_login(client)
        response = client.post(
            "/api/surveys",
            json={
                "title": "Invalid scale",
                "questions": [
                    {
                        "id": "scale",
                        "type": "scale",
                        "title": "Score",
                        "min": 1,
                        "max": 100,
                    }
                ],
            },
        )
        assert response.status_code == 201, response.text
        invalid_publish = client.post(
            f"/api/surveys/{response.json()['data']['id']}/publish", json={}
        )
        assert invalid_publish.status_code == 422

        created = client.post(
            "/api/surveys",
            json={
                "title": "Valid scale design",
                "questions": [
                    {
                        "id": "scale",
                        "type": "scale",
                        "title": "Score",
                        "required": True,
                        "min": 1,
                        "max": 5,
                        "settings": {"minValue": 1, "maxValue": 5, "step": 1},
                    }
                ],
            },
        )
        assert created.status_code == 201, created.text
        published = client.post(
            f"/api/surveys/{created.json()['data']['id']}/publish",
            json={"slug": f"scale-value-{uuid4().hex[:8]}"},
        )
        assert published.status_code == 200, published.text
        slug = published.json()["data"]["slug"]

        fractional = client.post(
            f"/api/public/surveys/{slug}/responses",
            json={"answers": {"scale": 3.5}},
        )
        assert fractional.status_code == 422

        whole = client.post(
            f"/api/public/surveys/{slug}/responses",
            json={"answers": {"scale": 3}},
        )
        assert whole.status_code == 201, whole.text


def test_incomplete_draft_can_save_but_cannot_publish() -> None:
    with TestClient(app) as client:
        _provision_and_login(client)
        created = client.post(
            "/api/surveys",
            json={
                "title": "Working draft",
                "questions": [
                    {
                        "id": "draft-choice",
                        "type": "single",
                        "title": "Temporary",
                        "options": [{"id": "draft-option", "label": "Temporary"}],
                    }
                ],
            },
        )
        assert created.status_code == 201, created.text
        survey_id = created.json()["data"]["id"]

        saved = client.put(
            f"/api/surveys/{survey_id}",
            json={
                "title": "",
                "sections": [
                    {
                        "id": "draft-section",
                        "title": "",
                        "questions": [
                            {
                                "id": "draft-choice",
                                "type": "single",
                                "title": "",
                                "options": [
                                    {"id": "draft-option", "label": ""}
                                ],
                            }
                        ],
                    }
                ],
            },
        )
        assert saved.status_code == 200, saved.text
        assert saved.json()["data"]["title"] == ""
        assert saved.json()["data"]["sections"][0]["title"] == ""
        assert saved.json()["data"]["questions"][0]["title"] == ""

        rejected = client.post(f"/api/surveys/{survey_id}/publish", json={})
        assert rejected.status_code == 422
        assert "제목" in rejected.json()["detail"]


def test_dynamic_question_activation_is_enforced_on_client_contract_and_server() -> None:
    with TestClient(app) as client:
        _provision_and_login(client)
        created = client.post(
            "/api/surveys",
            json={
                "title": "Dynamic questions",
                "questions": [
                    {
                        "id": "consent",
                        "type": "single",
                        "title": "Continue?",
                        "behavior": "fixed_required",
                        "options": [
                            {"id": "yes", "label": "Yes"},
                            {"id": "no", "label": "No"},
                        ],
                    },
                    {
                        "id": "detail",
                        "type": "short_text",
                        "title": "Required detail",
                        "behavior": "dynamic_required",
                        "activationCondition": {
                            "combinator": "all",
                            "conditions": [
                                {
                                    "sourceQuestionId": "consent",
                                    "operator": "equals",
                                    "value": "yes",
                                }
                            ],
                        },
                    },
                    {
                        "id": "followup",
                        "type": "short_text",
                        "title": "Optional follow-up",
                        "behavior": "dynamic_optional",
                        "activationCondition": {
                            "combinator": "all",
                            "conditions": [
                                {
                                    "sourceQuestionId": "consent",
                                    "operator": "equals",
                                    "value": "yes",
                                },
                                {
                                    "sourceQuestionId": "detail",
                                    "operator": "exists",
                                },
                            ],
                        },
                    },
                ],
                "settings": {"presentationMode": "one_at_a_time"},
            },
        )
        assert created.status_code == 201, created.text
        published = client.post(
            f"/api/surveys/{created.json()['data']['id']}/publish",
            json={"slug": f"dynamic-{uuid4().hex[:8]}"},
        )
        assert published.status_code == 200, published.text
        slug = published.json()["data"]["slug"]
        public = client.get(f"/api/public/surveys/{slug}")
        assert public.json()["data"]["settings"]["presentationMode"] == "one_at_a_time"

        skipped = client.post(
            f"/api/public/surveys/{slug}/responses",
            json={"answers": {"consent": "no"}},
        )
        assert skipped.status_code == 201, skipped.text

        missing_dynamic_required = client.post(
            f"/api/public/surveys/{slug}/responses",
            json={"answers": {"consent": "yes"}},
        )
        assert missing_dynamic_required.status_code == 422
        assert "Required detail" in missing_dynamic_required.json()["detail"]

        accepted = client.post(
            f"/api/public/surveys/{slug}/responses",
            json={"answers": {"consent": "yes", "detail": "Provided"}},
        )
        assert accepted.status_code == 201, accepted.text

        tampered = client.post(
            f"/api/public/surveys/{slug}/responses",
            json={
                "answers": {
                    "consent": "no",
                    "detail": "Hidden answer",
                    "followup": "Must not be activated by a hidden answer",
                }
            },
        )
        assert tampered.status_code == 422
        assert "숨겨진 문항" in tampered.json()["detail"]


def test_dynamic_question_may_only_reference_a_preceding_question() -> None:
    with pytest.raises(ValueError, match="선행"):
        SurveyCreateRequest.model_validate(
            {
                "title": "Invalid forward reference",
                "questions": [
                    {
                        "id": "target",
                        "type": "short_text",
                        "title": "Target",
                        "behavior": "dynamic_optional",
                        "activationCondition": {
                            "conditions": [
                                {
                                    "sourceQuestionId": "later",
                                    "operator": "exists",
                                }
                            ]
                        },
                    },
                    {"id": "later", "type": "short_text", "title": "Later"},
                ],
            }
        )


def test_table_and_repeat_table_response_shapes_are_strict_and_shared() -> None:
    assert OracleStore._validate_answer_value is MemoryStore._validate_answer_value

    with TestClient(app) as client:
        _provision_and_login(client)
        created = client.post(
            "/api/surveys",
            json={
                "title": "Strict tables",
                "questions": [
                    {
                        "id": "fixed",
                        "type": "table",
                        "title": "Fixed table",
                        "rows": ["Row 1", "Row 2"],
                        "columns": ["Name", "Value"],
                    },
                    {
                        "id": "repeat",
                        "type": "repeat_table",
                        "title": "Repeat table",
                        "rows": ["Example row"],
                        "columns": ["Name", "Value"],
                    },
                ],
            },
        )
        assert created.status_code == 201, created.text
        published = client.post(
            f"/api/surveys/{created.json()['data']['id']}/publish",
            json={"slug": f"strict-table-{uuid4().hex[:8]}"},
        )
        slug = published.json()["data"]["slug"]

        invalid_fixed = client.post(
            f"/api/public/surveys/{slug}/responses",
            json={"answers": {"fixed": [["one", "row"]]}},
        )
        assert invalid_fixed.status_code == 422
        invalid_repeat = client.post(
            f"/api/public/surveys/{slug}/responses",
            json={"answers": {"repeat": [["missing second column"]]}},
        )
        assert invalid_repeat.status_code == 422

        accepted = client.post(
            f"/api/public/surveys/{slug}/responses",
            json={
                "answers": {
                    "fixed": [["A", "1"], ["B", "2"]],
                    "repeat": [["C", "3"], ["D", "4"]],
                }
            },
        )
        assert accepted.status_code == 201, accepted.text
