from __future__ import annotations

from datetime import date
from pathlib import Path
import re
import shutil
import subprocess

from fastapi.testclient import TestClient
import pytest

from backend.release import APPLICATION_VERSION, read_application_version

ROOT = Path(__file__).resolve().parents[1]


def test_deployment_version_is_public_fresh_and_independent_of_storage(monkeypatch):
    import main
    from backend.dependencies import current_store, current_user
    def forbidden():
        raise AssertionError("A version lookup must not access storage or require login")
    monkeypatch.setattr(main, "database_status", forbidden)
    main.app.dependency_overrides[current_store] = forbidden
    main.app.dependency_overrides[current_user] = forbidden
    try:
        with TestClient(main.app) as client:
            response = client.get("/api/version")
            assert response.status_code == 200
            assert response.json()["data"]["version"] == APPLICATION_VERSION
            assert response.headers["cache-control"] == "no-store"
        assert main.app.version == APPLICATION_VERSION
    finally:
        main.app.dependency_overrides.pop(current_store, None)
        main.app.dependency_overrides.pop(current_user, None)


@pytest.mark.parametrize("value", ["2026.02.30.1", "2026.10.23.0", "2026.1.23.1", "2026.10.23.1<script>"])
def test_release_version_rejects_invalid_dates_and_injected_content(tmp_path, value):
    path = tmp_path / "VERSION"
    path.write_text(value, encoding="utf-8")
    with pytest.raises(ValueError):
        read_application_version(path)


def test_frontend_cache_versions_match_the_deployment_artifact():
    config = (ROOT / "frontend/config/app.config.js").read_text(encoding="utf-8")
    assert re.search(r'assetVersion:\s*"([^\"]+)"', config).group(1) == APPLICATION_VERSION
    for file in ["frontend/index.html", "frontend/public.html"]:
        references = re.findall(r'[?&]v=([^"&]+)', (ROOT / file).read_text(encoding="utf-8"))
        assert references and set(references) == {APPLICATION_VERSION}


def test_version_update_is_location_independent_and_validates_before_writing(tmp_path):
    shell = shutil.which("powershell") or shutil.which("pwsh")
    if not shell:
        pytest.skip("PowerShell is required for the release update helper test")
    fixture = tmp_path / "release-source"
    (fixture / "scripts").mkdir(parents=True)
    (fixture / "frontend/config").mkdir(parents=True)
    (fixture / "scripts/set-version.ps1").write_text((ROOT / "scripts/set-version.ps1").read_text(encoding="utf-8"), encoding="utf-8")
    today = date.today().strftime("%Y.%m.%d")
    (fixture / "VERSION").write_text(f"{today}.12\n", encoding="utf-8")
    (fixture / "frontend/config/app.config.js").write_text('const config = {assetVersion: "old"};\n', encoding="utf-8")
    for file in ["frontend/index.html", "frontend/public.html"]:
        (fixture / file).write_text('<script src="/frontend/js/app.js?v=old"></script>\n', encoding="utf-8")
    elsewhere = tmp_path / "another-working-directory"
    elsewhere.mkdir()
    def run(*args):
        return subprocess.run([shell, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(fixture / "scripts/set-version.ps1"), *args], cwd=elsewhere, capture_output=True, text=True)
    result = run()
    assert result.returncode == 0, result.stdout + result.stderr
    assert (fixture / "VERSION").read_text(encoding="utf-8").strip() == f"{today}.13"
    result = run("-Version", "2027.01.02.1")
    assert result.returncode == 0, result.stdout + result.stderr
    targets = ["VERSION", "frontend/config/app.config.js", "frontend/index.html", "frontend/public.html"]
    before = {file: (fixture / file).read_bytes() for file in targets}
    for value in before.values():
        assert b"2027.01.02.1" in value and not value.startswith(b"\xef\xbb\xbf") and b"\r\n" not in value
    # Missing references must leave every source file unchanged.
    (fixture / "frontend/public.html").write_text("No asset version references", encoding="utf-8")
    before = {file: (fixture / file).read_bytes() for file in targets}
    assert run("-Version", "2027.01.02.2").returncode != 0
    assert {file: (fixture / file).read_bytes() for file in targets} == before
