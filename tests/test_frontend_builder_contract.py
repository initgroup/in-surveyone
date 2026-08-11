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
