from __future__ import annotations

from pathlib import Path
import re


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def _read(relative: str) -> str:
    return (PROJECT_ROOT / relative).read_text(encoding="utf-8")


def test_menu_navigation_is_spa_and_has_bounded_assets() -> None:
    app = _read("frontend/js/app.js")
    menu = _read("frontend/config/menu.config.js")

    assert 'href="#/${item.code}"' in app
    assert 'window.addEventListener("hashchange", route)' in app
    assert 'fetch(page.html, { cache: "no-store", signal: controller.signal })' in app
    assert "location.reload(" not in app
    assert "window.location.reload(" not in app
    assert "loadedScripts: new Set()" in app
    assert "if (state.loadedScripts.has(src)) return Promise.resolve()" in app
    assert "if (previousStyle && previousStyle !== candidate.link) previousStyle.remove()" in app
    assert "hidden: true" in menu  # workflow routes remain SPA pages, not extra shell documents.


def test_every_spa_page_defines_a_destroy_lifecycle() -> None:
    page_scripts = sorted((PROJECT_ROOT / "frontend" / "js").glob("M*.js"))
    assert page_scripts
    missing = []
    for path in page_scripts:
        source = path.read_text(encoding="utf-8")
        if "window.Pages" in source and not re.search(r"\bdestroy\s*\(", source):
            missing.append(path.name)
    assert missing == []


def test_explicit_page_refresh_recreates_module_and_releases_runtime_state() -> None:
    index = _read("frontend/index.html")
    app = _read("frontend/js/app.js")
    style = _read("frontend/css/app.css")

    assert "data-page-refresh" in index
    assert "현재 화면 메모리를 초기화하고 새로고침" in index
    assert 'dom.pageRefresh.addEventListener("click", () => void refreshCurrentPage())' in app
    assert "await route({ refresh: true })" in app
    assert "await destroyPage(previousPage)" in app
    assert "if (refresh) unloadPageAssets(code, page)" in app
    assert "state.loadedScripts.delete(page.script)" in app
    assert "delete window.Pages[code]" in app
    assert "state.activeStyle = null" in app
    assert 'script.dataset.pageScript = src' in app
    assert 'if (key !== "destroyed") page[key] = null' in app
    assert ".header-page-refresh.is-refreshing" in style


def test_transient_modal_and_debounce_references_are_released() -> None:
    app = _read("frontend/js/app.js")
    common = _read("frontend/js/common.js")
    builder = _read("frontend/js/M02003.js")

    assert "dom.modalBody.replaceChildren()" in app
    assert "resetModalForPageTransition()" in app
    assert "debounced.cancel = () =>" in common
    assert 'dialog.addEventListener("close", () =>' in builder
    assert "}, { once: true });" in builder

    for relative, handler in (
        ("frontend/js/M02001.js", "this.onSearch?.cancel?.()"),
        ("frontend/js/M02002.js", "this.onSearch?.cancel?.()"),
        ("frontend/js/M03001.js", "this.searchDebounced?.cancel?.()"),
        ("frontend/js/M04001.js", "this.onInput?.cancel?.()"),
        ("frontend/js/M07002.js", "this.onSearch?.cancel?.()"),
    ):
        assert handler in _read(relative)


def test_refresh_warns_before_discarding_known_unsaved_work() -> None:
    app = _read("frontend/js/app.js")
    distribution = _read("frontend/js/M03001.js")
    custom_report = _read("frontend/js/M05002.js")

    assert "state.currentPage.beforeRefresh" in app
    assert "allowed === false" in app
    assert "beforeRefresh()" in distribution
    assert "저장하지 않은 배포 변경사항" in distribution
    assert "beforeRefresh()" in custom_report
    assert "저장하지 않은 맞춤형 보고서 변경사항" in custom_report


def test_builder_asks_before_saving_or_discarding_on_explicit_refresh() -> None:
    builder = _read("frontend/js/M02003.js")

    assert "async beforeRefresh()" in builder
    assert "data-builder-leave-stay" in builder
    assert "data-builder-leave-discard" in builder
    assert "data-builder-leave-save" in builder
