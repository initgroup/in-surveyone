"""Result codes are resolved against the immutable version that collected an answer."""
from __future__ import annotations

from typing import Any

from backend.models import AnswerItem, PublicSurvey, Question


def _code(items, value):
    token = str(value)
    item = next((item for item in items if str(item.id) == token), None)
    if item is None and token.isdecimal() and 0 <= int(token) < len(items):
        item = items[int(token)]
    return (item.result_code if item.result_code is not None else item.id) if item is not None else value


def coded_value(question: Question, value: Any) -> Any:
    if value is None or value == "" or value == [] or value == {}:
        return value
    kind = question.type.value
    if kind in {"single", "single_choice", "dropdown"}:
        return _code(question.options, value)
    if kind in {"multiple", "multiple_choice"}:
        return [_code(question.options, item) for item in (value if isinstance(value, list) else [value])]
    if kind in {"matrix", "matrix_single", "matrix_multiple"} and isinstance(value, dict):
        return {str(_code(question.settings.rows, row)): [_code(question.settings.columns, item) for item in selected] if isinstance(selected, list) else _code(question.settings.columns, selected) for row, selected in value.items()}
    if kind in {"table", "repeat_table"} and isinstance(value, list):
        rows = [{str(item.result_code if item.result_code is not None else item.id): (row[index] if index < len(row) else "") for index, item in enumerate(question.settings.columns)} if isinstance(row, list) else {str(_code(question.settings.columns, key)): cell for key, cell in row.items()} if isinstance(row, dict) else row for row in value]
        return rows if kind == "repeat_table" else {str(item.result_code if item.result_code is not None else item.id): rows[index] for index, item in enumerate(question.settings.rows) if index < len(rows)}
    if kind == "scale":
        point = next((point for point in question.settings.scale_points if point.score == value), None)
        return point.result_code if point else value
    return value


def coded_answers(snapshot: PublicSurvey | None, answers: list[AnswerItem]) -> dict[str, Any]:
    if snapshot is None:
        return {}
    questions = {question.id: question for section in snapshot.sections for question in section.questions}
    return {answer.question_id: coded_value(questions[answer.question_id], answer.value) for answer in answers if answer.question_id in questions}
