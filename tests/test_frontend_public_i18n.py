from __future__ import annotations

import re
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
PUBLIC_HTML = (PROJECT_ROOT / "frontend" / "public.html").read_text(encoding="utf-8")
PUBLIC_SCRIPT = (PROJECT_ROOT / "frontend" / "js" / "public.js").read_text(encoding="utf-8")


def _catalog_body(locale: str) -> str:
    catalog = PUBLIC_SCRIPT.split("const PUBLIC_UI = Object.freeze({", 1)[1].split(
        "const PUBLIC_TYPE_LABELS", 1
    )[0]
    match = re.search(rf"\n\s*{re.escape(locale)}: \{{(.*?)\n\s*\}}(?:,|\n)", catalog, re.DOTALL)
    assert match, f"missing public UI catalog for {locale}"
    return match.group(1)


def test_public_shell_has_six_complete_locales() -> None:
    required_keys = {
        "surveyLanguage",
        "loadingTitle",
        "validationTitle",
        "previous",
        "next",
        "draftSaved",
        "draftRestored",
        "requiredError",
        "pageStatus",
        "submitting",
        "submitted",
        "submitFailed",
        "home",
    }
    for locale in ("ko", "en", "ja", "zh", "vi", "fil"):
        body = _catalog_body(locale)
        for key in required_keys:
            assert re.search(rf"\b{key}:\s*\"", body), f"{locale} is missing {key}"


def test_public_shell_markup_and_locale_resolution_are_accessible() -> None:
    assert 'data-public-i18n="skipToSurvey"' in PUBLIC_HTML
    assert 'data-public-i18n-aria-label="surveyLanguageAria"' in PUBLIC_HTML
    assert 'data-public-i18n-aria-label="pagerAria"' in PUBLIC_HTML
    assert 'data-public-i18n="submit"' in PUBLIC_HTML
    assert 'document.documentElement.lang = state.locale' in PUBLIC_SCRIPT
    assert (
        "const preferences = [requested, ...(navigator.languages || [navigator.language]), "
        "defaultLocale, sourceLocale];"
    ) in PUBLIC_SCRIPT
    assert 'return PUBLIC_UI[defaultLocale] ? defaultLocale : "ko";' in PUBLIC_SCRIPT


def test_public_generated_controls_use_localized_accessible_text() -> None:
    for fragment in (
        'text("selectPlaceholder")',
        'text("shortPlaceholder")',
        'text("rowInputAria"',
        'text("rowDeleteAria"',
        'text("requiredError")',
        'text("requiredToast"',
        'text("questionLink"',
        'text("pageStatus"',
    ):
        assert fragment in PUBLIC_SCRIPT
    assert "eval(" not in PUBLIC_SCRIPT
    assert "new Function" not in PUBLIC_SCRIPT


def test_public_dynamic_questions_converge_and_paged_view_tracks_active_cards() -> None:
    assert "function applyLogic(stabilizing = false)" in PUBLIC_SCRIPT
    assert "if (clearedAnswer && !stabilizing) applyLogic(true);" in PUBLIC_SCRIPT
    assert 'querySelectorAll("[data-section-id]:not([hidden]) [data-question-id]:not([hidden])")' in PUBLIC_SCRIPT
    on_input = PUBLIC_SCRIPT.split("function onInput(event)", 1)[1].split("function question(id)", 1)[0]
    assert on_input.index("applyLogic();") < on_input.index("updatePresentation();")
    assert 'required: ["fixed_required", "dynamic_required"].includes(behavior)' in PUBLIC_SCRIPT
