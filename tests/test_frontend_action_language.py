import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
ACTION_KINDS = ("navigation", "function", "layer", "save", "batch", "delete")
LEGACY_MEANING_CLASSES = (
    "button-primary",
    "button-secondary",
    "button-success",
    "button-danger",
    "button-ghost",
)
ACTION_ELEMENT = re.compile(
    r"<(?:button|a)\b[^>]*\bclass=(?:\"([^\"]*)\"|'([^']*)')",
    re.IGNORECASE,
)


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def page_action_sources() -> list[Path]:
    return sorted((FRONTEND / "pages").glob("M*.html")) + sorted(
        (FRONTEND / "js").glob("M*.js")
    ) + [FRONTEND / "js" / "code-editor.js"]


def test_common_action_language_has_six_non_color_cues() -> None:
    css = read(FRONTEND / "css" / "app.css")

    for kind in ACTION_KINDS:
        assert f".button.button-{kind}" in css
        assert f".button.button-{kind}:not(.button-icon)::before" in css

    assert ".button.button-important" in css
    assert ".button.button-navigation-back" in css
    assert ".icon-button.icon-button-delete" in css
    assert "border-style:dashed" in read(FRONTEND / "css" / "public.css")


def test_page_actions_use_meaning_classes_instead_of_legacy_colors() -> None:
    for path in page_action_sources():
        source = read(path)
        for legacy_class in LEGACY_MEANING_CLASSES:
            assert legacy_class not in source, f"{path.name} still uses {legacy_class}"

        for match in ACTION_ELEMENT.finditer(source):
            classes = set((match.group(1) or match.group(2) or "").split())
            if "button" not in classes or "workspace-list-button" in classes:
                continue
            assert any(f"button-{kind}" in classes for kind in ACTION_KINDS), (
                f"{path.name} has an unclassified content action: {sorted(classes)}"
            )


def test_core_workflows_emphasize_save_batch_and_delete_results() -> None:
    builder = read(FRONTEND / "pages" / "M02003.html")
    distribution = read(FRONTEND / "pages" / "M03001.html")
    projects = read(FRONTEND / "js" / "M02001.js")
    reports = read(FRONTEND / "pages" / "M05001.html")

    assert 'button-save" type="button" data-builder-save' in builder
    assert "button-batch button-important" in builder
    assert "button-batch button-important" in distribution
    assert "button-delete button-important" in projects
    assert "report-button button-batch button-important" in reports


def test_action_colors_are_neutral_and_auth_entries_are_consistent() -> None:
    css = read(FRONTEND / "css" / "app.css")
    index = read(FRONTEND / "index.html")
    dashboard = read(FRONTEND / "pages" / "M01001.html")

    assert css.count("--action-navigation: #405168;") == 1
    for kind in ("function", "layer", "save", "batch"):
        assert f"--action-{kind}: #405168;" in css
        assert f"--action-{kind}-soft: #f7f9fb;" in css
        assert f"--action-{kind}-strong: #27384d;" in css
    signup_class = "button button-small button-layer button-important"
    assert signup_class in index
    assert "button button-layer button-important" in dashboard


def test_toasts_start_below_header_and_do_not_use_bottom_action_space() -> None:
    css = read(FRONTEND / "css" / "app.css")
    toast_rule = re.search(r"\.toast-region \{([^}]*)\}", css)

    assert toast_rule
    declarations = toast_rule.group(1)
    assert "top: calc(var(--header-height) + 12px)" in declarations
    assert "right: 22px" in declarations
    assert "bottom: auto" in declarations
    assert "background: #fff" in css
    assert "transform: translateY(-10px)" in css


def test_dashboard_entry_actions_use_compact_right_side_boxes() -> None:
    page = read(FRONTEND / "pages" / "M01001.html")
    css = read(FRONTEND / "css" / "pages" / "M01001.css")

    assert page.count('class="visitor-start-copy"') == 2
    assert page.count("visitor-start-action-box") == 2
    assert "grid-template-columns: minmax(0, 1fr) 154px" in css
    assert ".visitor-start-action-box {" in css
    assert "width: 154px" in css
    assert "min-height: 142px" in css
    assert ".visitor-start-action-box .button { width: 100%" in css
    assert ".visitor-start-action-box { justify-self: end; width: 154px; min-height: 112px" in css
