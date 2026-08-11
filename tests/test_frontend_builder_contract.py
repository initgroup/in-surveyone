from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_builder_explicit_save_precedes_distribution_navigation() -> None:
    page = (PROJECT_ROOT / "frontend" / "pages" / "M02003.html").read_text(encoding="utf-8")
    script = (PROJECT_ROOT / "frontend" / "js" / "M02003.js").read_text(encoding="utf-8")

    assert "data-builder-save" in page
    assert "data-builder-distribute" in page
    assert "data-builder-publish" not in page
    assert "async saveExplicit" in script
    assert "async prepareDistribution" in script
    assert "await this.saveExplicit({ notify: false })" in script
    assert "if (!saved || this.destroyed) return;" in script
    assert 'this.context.navigate("M03001", { surveyId: this.survey.id });' in script
    assert "/publish" not in script


def test_cross_section_reorder_moves_nested_translation_bucket() -> None:
    script = (PROJECT_ROOT / "frontend" / "js" / "M02003.js").read_text(encoding="utf-8")

    assert "this.moveQuestionTranslations(question.id, sourceSectionId, destinationSectionId)" in script
    assert "delete sourceQuestions[questionKey];" in script
    assert "destination.questions[questionKey] = translatedQuestion;" in script
    assert "questionTitles" in script  # flat compatibility maps remain independently keyed by question ID


def test_table_axes_are_configurable_and_previewed_by_question_semantics() -> None:
    page = (PROJECT_ROOT / "frontend" / "pages" / "M02003.html").read_text(
        encoding="utf-8"
    )
    script = (PROJECT_ROOT / "frontend" / "js" / "M02003.js").read_text(
        encoding="utf-8"
    )
    public_script = (PROJECT_ROOT / "frontend" / "js" / "public.js").read_text(
        encoding="utf-8"
    )

    assert 'data-prop-axis-field' in page
    assert 'data-axis-list="rows"' in page
    assert 'data-axis-list="columns"' in page
    assert 'data-axis-add="rows"' in page
    assert 'data-axis-add="columns"' in page
    assert "addAxisItem(field)" in script
    assert "deleteAxisItem(field, index)" in script
    assert "moveAxisItem(field, index, direction)" in script
    assert 'if (question.type === "table") return this.axisTableMarkup(question, "text")' in script
    assert 'if (choiceMatrixTypes.has(question.type))' in script
    assert 'if (question.type === "repeat_table") return this.repeatTableEditorMarkup(question)' in script
    assert "const questions = this.survey.questions;" in script
    assert "previewAxisTableMarkup(question, cellType)" in script
    assert "previewRepeatTableMarkup(question)" in script
    assert 'if (question.type === "table") return fixedTableMarkup(question, name, aria)' in public_script
    assert 'if (question.type === "repeat_table") return repeatTableMarkup(question, name, aria)' in public_script
    assert 'function axisItemId(question, field, index)' in public_script
    assert 'value[rowId] = currentQuestion.type === "matrix_single"' in public_script
