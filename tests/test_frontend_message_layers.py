from __future__ import annotations

from pathlib import Path
import re


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def _read(relative: str) -> str:
    return (PROJECT_ROOT / relative).read_text(encoding="utf-8")


def test_shell_provides_copyable_confirmation_and_notification_layers() -> None:
    index = _read("frontend/index.html")
    app = _read("frontend/js/app.js")
    common = _read("frontend/js/common.js")
    style = _read("frontend/css/app.css")

    assert "data-message-dialog" in index
    assert "data-message-drag-handle" in index
    assert "data-message-copy" in index
    assert "data-message-confirm" in index
    assert "data-message-cancel" in index
    assert "function confirmMessage(message, options = {})" in app
    assert "state.messageQueue.push" in app
    assert "Common.copyText(state.activeMessage.message)" in app
    assert "data-toast-copy" in app
    assert "data-toast-close" in app
    assert "while (dom.toastRegion.children.length >= 4)" in app
    assert "async function copyText(value)" in common
    assert ".message-dialog-header" in style
    assert ".toast-actions" in style


def test_application_does_not_use_native_browser_message_dialogs() -> None:
    violations: list[str] = []
    pattern = re.compile(r"(?:window\.)?(?:alert|confirm|prompt)\s*\(")
    for path in sorted((PROJECT_ROOT / "frontend" / "js").glob("*.js")):
        if pattern.search(path.read_text(encoding="utf-8")):
            violations.append(path.name)
    assert violations == []


def test_destructive_workflows_use_the_shared_async_confirmation_layer() -> None:
    for relative in (
        "frontend/js/M02002.js",
        "frontend/js/M03001.js",
        "frontend/js/M05002.js",
        "frontend/js/M07001.js",
        "frontend/js/M07002.js",
    ):
        source = _read(relative)
        assert "confirmMessage(" in source, relative
        assert "window.confirm" not in source


def test_public_response_notifications_are_copyable_and_dismissible() -> None:
    script = _read("frontend/js/public.js")
    style = _read("frontend/css/public.css")

    assert "data-public-toast-copy" in script
    assert "data-public-toast-close" in script
    assert "await Common.copyText(message)" in script
    assert ".public-toast-actions" in style
