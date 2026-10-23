from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from conftest import signup_member

from backend.errors import DomainValidationError
from backend.memory_store import MemoryStore
from backend.models import (
    AnswerItem, PublicSurvey, Question, QuestionSettings, SurveyCreateRequest,
    SurveyLanguages, SurveyProjectProfile, SurveySection, SurveySettings, SurveyTheme,
)
from backend.oracle_store import OracleStore
from main import app


SAFE_HTML = (
    '<h2 data-svy-align="center">Survey introduction</h2><p><strong>Purpose</strong> and <span data-svy-size="24" data-svy-color="blue"><em>guidance</em></span>.</p>'
    '<table><caption>Evaluation</caption><thead><tr><th scope="col">Topic</th>'
    '<th scope="col">Meaning</th></tr></thead><tbody><tr><th scope="row">Quality</th>'
    '<td colspan="1">Clear criteria<br>and examples</td></tr></tbody></table>'
)


def _survey(questions: list[dict]) -> PublicSurvey:
    return PublicSurvey(
        survey_id="survey-test", slug="survey-test", version=1, title="Test survey",
        category="test", sections=[SurveySection(title="Questions", questions=questions)],
        settings=SurveySettings(), theme=SurveyTheme(),
        published_at=datetime.now(timezone.utc),
    )


def _department_questions(source_type: str = "single") -> list[dict]:
    options = [{"id": f"dept-{index}", "label": f"Department {index}"} for index in range(4)]
    return [
        {"id": "department", "type": source_type, "title": "Own department", "required": True, "options": options},
        {
            "id": "partners", "type": "multiple", "title": "Partners", "required": True,
            "options": options,
            "settings": {"excludeSelectedFrom": "department", "minSelections": 1, "maxSelections": 2},
        },
    ]


def test_content_html_survives_draft_json_and_immutable_public_snapshot() -> None:
    with TestClient(app) as client:
        signup_member(client)
        created = client.post("/api/surveys", json={
            "title": "Document layout", "questions": [
                {"id": "cover", "type": "notice", "title": "Introduction", "settings": {"contentHtml": SAFE_HTML}},
                {"id": "rating", "type": "scale", "title": "Quality", "settings": {"minValue": 1, "maxValue": 10, "scaleOrder": "descending", "scaleDisplay": "slider"}},
            ],
        })
        assert created.status_code == 201, created.text
        detail = created.json()["data"]
        assert detail["questions"][0]["settings"]["contentHtml"] == SAFE_HTML
        published = client.post(f"/api/surveys/{detail['id']}/publish", json={})
        assert published.status_code == 200, published.text
        slug = published.json()["data"]["slug"]
        changed = client.patch(f"/api/surveys/{detail['id']}", json={"questions": [
            {"id": "cover", "type": "notice", "title": "Changed", "settings": {"contentHtml": "<p>Changed draft</p>"}},
            {"id": "rating", "type": "scale", "title": "Quality", "settings": {"minValue": 1, "maxValue": 10}},
        ]})
        assert changed.status_code == 200, changed.text
        snapshot = client.get(f"/api/public/surveys/{slug}").json()["data"]
        assert snapshot["questions"][0]["settings"]["contentHtml"] == SAFE_HTML
        assert snapshot["questions"][1]["settings"]["scaleOrder"] == "descending"
        assert snapshot["questions"][1]["settings"]["scaleDisplay"] == "slider"

    draft = OracleStore._draft_json(
        sections=[SurveySection(title="Cover", questions=[Question(type="notice", title="Cover", settings={"contentHtml": SAFE_HTML})])],
        settings=SurveySettings(), theme=SurveyTheme(), skin={},
        project_profile=SurveyProjectProfile(), logic_rules=[],
        languages=SurveyLanguages(), translations={},
    )
    assert json.loads(draft)["sections"][0]["questions"][0]["settings"]["contentHtml"] == SAFE_HTML


@pytest.mark.parametrize("html", [
    '<script>alert(1)</script>', '<p onclick="alert(1)">Text</p>',
    '<p style="position:fixed">Text</p>', '<p class="override">Text</p>',
    '<img src="https://example.test">', '<svg><script>alert(1)</script></svg>',
    '<iframe srcdoc="x"></iframe>', '<a href="javascript:alert(1)">Link</a>',
    '<td colspan="21">Wide</td>', '<th scope="invalid">Header</th>',
    '<td rowspan="1" rowspan="2">Repeated</td>', '<!DOCTYPE html>',
    '<?script test?>', '<style>body{display:none}</style>',
    '<!-- --!><script>alert(1)</script> -->', '<script', '< p>ambiguous',
])
def test_content_html_rejects_active_or_unapproved_markup(html: str) -> None:
    with pytest.raises(ValueError, match="contentHtml"):
        QuestionSettings(contentHtml=html)


def test_content_html_preserves_whitespace_and_safe_character_references() -> None:
    html = "  <p>2 &lt; 3 &amp; 4 &gt; 1</p>\n"
    assert QuestionSettings(contentHtml=html).content_html == html


def test_content_html_is_byte_bounded_and_informational_only() -> None:
    with pytest.raises(ValueError, match="64KB"):
        QuestionSettings(contentHtml="\uac00" * 22000)
    with pytest.raises(ValueError, match="informational"):
        Question(type="short_text", settings={"contentHtml": SAFE_HTML})
    with pytest.raises(ValueError, match="minSelections"):
        QuestionSettings(minSelections=3, maxSelections=2)
    with pytest.raises(ValueError):
        QuestionSettings(scaleOrder="random")
    with pytest.raises(ValueError):
        QuestionSettings(scaleDisplay="unsupported")


@pytest.mark.parametrize("change, message", [
    ("missing", "unknown"), ("forward", "preceding"),
    ("nonchoice", "choice"), ("no-shared-options", "stable"),
])
def test_option_exclusion_rejects_invalid_dependency(change: str, message: str) -> None:
    questions = _department_questions()
    if change == "missing":
        questions[1]["settings"]["excludeSelectedFrom"] = "missing"
    elif change == "forward":
        questions.reverse()
    elif change == "nonchoice":
        questions[0]["type"] = "short_text"
    else:
        questions[1]["options"] = [{"id": "unrelated", "label": "Other"}]
    with pytest.raises(ValueError, match=message):
        SurveyCreateRequest(questions=questions)


@pytest.mark.parametrize("store_class", [MemoryStore, OracleStore])
@pytest.mark.parametrize("source_type", ["single", "dropdown", "multiple"])
def test_option_exclusion_is_enforced_by_both_repository_contracts(store_class, source_type: str) -> None:
    store = object.__new__(store_class)
    survey = _survey(_department_questions(source_type))
    own = ["dept-0", "dept-1"] if source_type == "multiple" else "dept-0"
    valid = [AnswerItem(questionId="department", value=own), AnswerItem(questionId="partners", value=["dept-2"])]
    assert store._validate_answers(survey, valid)[1].value == ["dept-2"]
    invalid = [valid[0], AnswerItem(questionId="partners", value=["dept-0", "dept-2"])]
    with pytest.raises(DomainValidationError, match="excludes"):
        store._validate_answers(survey, invalid)


@pytest.mark.parametrize("store_class", [MemoryStore, OracleStore])
def test_minimum_selection_count_is_enforced(store_class) -> None:
    store = object.__new__(store_class)
    questions = _department_questions()
    questions[1]["settings"]["minSelections"] = 2
    survey = _survey(questions)
    with pytest.raises(DomainValidationError, match="at least"):
        store._validate_answers(survey, [
            AnswerItem(questionId="department", value="dept-0"),
            AnswerItem(questionId="partners", value=["dept-1"]),
        ])


def _matrix(required: bool = True, multiple: bool = False) -> Question:
    return Question(
        id="matrix", title="Evaluation", type="matrix_multiple" if multiple else "matrix_single",
        required=required, settings={
            "rows": [{"id": "quality", "label": "Quality"}, {"id": "speed", "label": "Speed"}],
            "columns": [{"id": "good", "label": "Good"}, {"id": "bad", "label": "Bad"}],
        },
    )


@pytest.mark.parametrize("store_class", [MemoryStore, OracleStore])
def test_required_matrix_needs_each_row_and_unique_valid_choices(store_class) -> None:
    store = object.__new__(store_class)
    question = _matrix()
    store._validate_answer_value(question, {"quality": "good", "speed": "bad"})
    for invalid in [
        {"quality": "good"}, {"quality": "good", "speed": []},
        {"quality": "good", "speed": ["bad", "bad"]},
        {"quality": "good", "speed": {"invalid": "bad"}},
    ]:
        with pytest.raises(DomainValidationError):
            store._validate_answer_value(question, invalid)
    store._validate_answer_value(_matrix(required=False), {"quality": "good"})
    with pytest.raises(DomainValidationError):
        store._validate_answer_value(_matrix(multiple=True), {"quality": ["good", "good"], "speed": ["bad"]})


def test_matrix_report_has_stable_row_and_column_counts() -> None:
    question = _matrix(multiple=True)
    report = MemoryStore._question_report(question, [
        {"quality": ["good", "bad"], "speed": ["good"]},
        {"quality": ["good"], "speed": ["bad"]},
    ])
    assert OracleStore._question_report is MemoryStore._question_report
    assert report.row_counts == {"quality": {"good": 2, "bad": 1}, "speed": {"good": 1, "bad": 1}}
    assert report.row_labels == {"quality": "Quality", "speed": "Speed"}
    assert report.column_labels == {"good": "Good", "bad": "Bad"}
    assert report.response_count == 2


def test_reference_packages_preserve_original_numbering_through_model_roundtrip():
    import json
    from pathlib import Path
    from backend.models import SurveyUpdateRequest

    root = Path(__file__).resolve().parents[1]
    for path in (root / "reference" / "surveys").glob("*.json"):
        package = json.loads(path.read_text(encoding="utf-8"))
        request = SurveyUpdateRequest.model_validate(package["draft"])
        saved = request.model_dump(by_alias=True, mode="json")
        assert saved["settings"]["showQuestionNumbers"] is False
        reloaded = SurveyUpdateRequest.model_validate(saved)
        assert reloaded.settings.show_question_numbers is False



@pytest.mark.parametrize("layout", ["vertical", "horizontal", "columns_2", "columns_3", "columns_4"])
def test_choice_layout_roundtrip_preserves_response_contract(layout: str) -> None:
    options = [{"id": "a", "label": "Alpha"}, {"id": "b", "label": "Beta"}]
    question = Question(id="choices", type="multiple", title="Choices", options=options,
                        settings={"choiceLayout": layout, "minSelections": 1, "maxSelections": 2})
    restored = Question.model_validate_json(question.model_dump_json(by_alias=True))
    assert restored.settings.choice_layout == layout
    survey = _survey([restored.model_dump(by_alias=True, mode="json")])
    for store_class in [MemoryStore, OracleStore]:
        result = object.__new__(store_class)._validate_answers(survey, [AnswerItem(questionId="choices", value=["a", "b"])])
        assert result[0].value == ["a", "b"]


def test_choice_layout_rejects_unknown_values_and_keeps_legacy_default() -> None:
    assert QuestionSettings().choice_layout == "vertical"
    with pytest.raises(ValueError):
        QuestionSettings(choiceLayout="custom-css")


def test_choice_layout_draft_and_published_snapshot_are_independent() -> None:
    with TestClient(app) as client:
        signup_member(client)
        created = client.post("/api/surveys", json={"title": "Choice layouts", "questions": [
            {"id": "choices", "type": "single", "title": "Choose", "options": [{"id": "a", "label": "Alpha"}, {"id": "b", "label": "Beta"}], "settings": {"choiceLayout": "columns_3"}},
        ]})
        assert created.status_code == 201, created.text
        detail = created.json()["data"]
        published = client.post(f"/api/surveys/{detail['id']}/publish", json={})
        assert published.status_code == 200, published.text
        changed = detail["questions"][0]
        changed["settings"]["choiceLayout"] = "columns_2"
        updated = client.patch(f"/api/surveys/{detail['id']}", json={"questions": [changed]})
        assert updated.status_code == 200, updated.text
        assert client.get(f"/api/surveys/{detail['id']}").json()["data"]["questions"][0]["settings"]["choiceLayout"] == "columns_2"
        slug = published.json()["data"]["slug"]
        assert client.get(f"/api/public/surveys/{slug}").json()["data"]["questions"][0]["settings"]["choiceLayout"] == "columns_3"


def test_numbering_exclusion_roundtrip_preserves_question_identity_and_source_title() -> None:
    question = Question(id="profile", type="short_text", title="1. Original title", settings={"excludeFromNumbering": True})
    restored = Question.model_validate_json(question.model_dump_json(by_alias=True))
    assert restored.settings.exclude_from_numbering is True
    assert restored.id == "profile"
    assert restored.title == "1. Original title"
    assert QuestionSettings().exclude_from_numbering is False


@pytest.mark.parametrize("attribute,value", [
    ("data-svy-align", "fixed"), ("data-svy-size", "999"),
    ("data-svy-color", "url(https://example.test)"), ("data-svy-unknown", "x"),
])
def test_notice_format_tokens_reject_unapproved_values(attribute: str, value: str) -> None:
    with pytest.raises(ValueError, match="contentHtml"):
        QuestionSettings(contentHtml=f'<p {attribute}="{value}">Bad format</p>')
