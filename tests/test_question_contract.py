from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend.memory_store import MemoryStore
from backend.models import Question, QuestionSettings, QuestionType
from backend.oracle_store import OracleStore
from main import app


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
    with pytest.raises(ValueError, match="rows and columns"):
        Question(
            id="invalid-table",
            type=QuestionType.TABLE,
            title="Missing shape",
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
        (None, 5, "require min and max"),
        (0.5, 5, "must be integers"),
        (2, 5, "min must be either"),
        (1, 11, "max must be between"),
        (1, 1, "min must be less"),
    ],
)
def test_scale_design_contract_rejects_unsupported_ranges(
    minimum: float | None, maximum: float, message: str
) -> None:
    settings = {"maxValue": maximum}
    if minimum is not None:
        settings["minValue"] = minimum
    with pytest.raises(ValueError, match=message):
        Question(
            id="invalid-scale",
            type=QuestionType.SCALE,
            title="Invalid scale",
            settings=settings,
        )


def test_scale_design_requires_unit_step() -> None:
    with pytest.raises(ValueError, match="step must be 1"):
        Question(
            id="invalid-scale-step",
            type=QuestionType.SCALE,
            title="Invalid scale step",
            settings={"minValue": 1, "maxValue": 5, "step": 0.5},
        )


def test_scale_contract_is_enforced_by_survey_api() -> None:
    with TestClient(app) as client:
        assert client.post("/api/auth/guest", json={"mode": "local"}).status_code == 201
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
        assert response.status_code == 422

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


def test_table_and_repeat_table_response_shapes_are_strict_and_shared() -> None:
    assert OracleStore._validate_answer_value is MemoryStore._validate_answer_value

    with TestClient(app) as client:
        assert client.post("/api/auth/guest", json={"mode": "local"}).status_code == 201
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
