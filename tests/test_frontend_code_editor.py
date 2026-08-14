from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_ace_editor_is_version_pinned_and_self_hosted() -> None:
    package = json.loads(_read("package.json"))
    assert package["dependencies"]["ace-builds"] == "1.44.0"
    vendor = ROOT / "frontend" / "vendor" / "ace"
    for name in (
        "ace.js",
        "mode-html.js",
        "mode-css.js",
        "mode-javascript.js",
        "worker-html.js",
        "worker-css.js",
        "worker-javascript.js",
        "LICENSE",
    ):
        assert (vendor / name).is_file(), name


def test_shared_editor_is_connected_to_design_builder_and_email() -> None:
    skin_page = _read("frontend/pages/M02005.html")
    skin_script = _read("frontend/js/M02005.js")
    builder_page = _read("frontend/pages/M02003.html")
    builder_script = _read("frontend/js/M02003.js")
    delivery_script = _read("frontend/js/M03001.js")

    assert "data-open-skin-code" in skin_page
    assert "SurveyCodeEditor.open" in skin_script
    assert "customCode:window.SurveyCodeEditor.normalize" in skin_script
    assert "data-builder-code" in builder_page
    assert "customCode: source" in builder_script
    assert "data-edit-email-html" in delivery_script
    assert 'tabs: ["html"]' in delivery_script
    assert "email: true" in delivery_script


def test_public_custom_code_uses_opaque_sandbox_and_scoped_css() -> None:
    public_page = _read("frontend/public.html")
    public_script = _read("frontend/js/public.js")
    editor = _read("frontend/js/code-editor.js")

    assert 'sandbox="allow-scripts"' in public_page
    assert "allow-same-origin" not in public_page
    assert 'connect-src \'none\'' in editor
    assert 'form-action \'none\'' in editor
    assert "event.source !== currentFrame?.contentWindow" in public_script
    assert "scopedCustomCss" in public_script
    assert "position\\s*:\\s*fixed" in public_script


def test_custom_source_reuses_existing_oracle_clob_json_contract() -> None:
    ddl = _read("database/SURVEYONE_SYSTEM_DDL.sql")
    surveys_sql = _read("database/surveys.sql")
    deployments_sql = _read("database/deployments.sql")

    assert '"DRAFT_JSON" CLOB NOT NULL ENABLE' in ddl
    assert '"SNAPSHOT_JSON" CLOB NOT NULL ENABLE' in ddl
    assert '"PLAN_JSON" CLOB NOT NULL ENABLE' in ddl
    assert ":draftJson" in surveys_sql
    assert ":snapshotJson" in surveys_sql
    assert ":planJson" in deployments_sql
