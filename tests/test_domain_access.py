from __future__ import annotations

import os
import subprocess
import sys
import textwrap

from backend.config import PROJECT_ROOT


def test_deployment_origins_allow_login_session_and_survey_writes() -> None:
    # Import the real app with deployment settings in a fresh process so both
    # CORS and CSRF receive the startup configuration. No live DB or .env access.
    environment = {
        key: value for key, value in os.environ.items()
        if key.upper() in {"SYSTEMROOT", "WINDIR", "PATH", "TEMP", "TMP", "COMSPEC"}
    }
    environment.update({
        "SURVEYONE_LOAD_DOTENV": "false",
        "SURVEYONE_ENV": "test",
        "SURVEYONE_DB_MODE": "memory",
        "DB_MODE": "memory",
        "INIT_SECRET_KEY": "domain-access-regression-test-secret",
        "INIT_COOKIE_SECURE": "true",
        "INIT_COOKIE_SAMESITE": "lax",
        "SURVEYONE_BASE_URL": "https://www.insurveyone.com",
        # Reproduce the missing www origin in an older shared allowlist.
        "INIT_ALLOWED_ORIGINS": (
            "https://in-surveyone.onrender.com,https://insurveyone.com"
        ),
        "SURVEYONE_ADDITIONAL_ALLOWED_ORIGINS": "https://survey.insurveyone.com",
    })
    script = textwrap.dedent("""
        from fastapi.testclient import TestClient
        from main import app, settings

        for index, origin in enumerate(settings.allowed_origins):
            with TestClient(app, base_url=origin, headers={"Origin": origin}) as client:
                config = client.get("/api/runtime-config").json()["data"]
                assert config["publicBaseUrl"] == "https://www.insurveyone.com"
                preflight = client.options("/api/auth/login", headers={
                    "Access-Control-Request-Method": "POST",
                    "Access-Control-Request-Headers": "content-type",
                })
                assert preflight.status_code == 200, preflight.text
                assert preflight.headers["access-control-allow-origin"] == origin
                assert preflight.headers["access-control-allow-credentials"] == "true"

                login_id = f"domain-test-{index}"
                signup = client.post("/api/auth/signup", json={
                    "loginId": login_id, "password": "DomainTest!234",
                    "name": "Domain test", "email": f"domain-{index}@example.test",
                    "organizationName": "Test organization",
                    "termsAccepted": True, "privacyAccepted": True,
                })
                assert signup.status_code == 201, signup.text
                assert client.post("/api/auth/logout").status_code == 200
                assert client.get("/api/auth/me").status_code == 401
                login = client.post("/api/auth/login", json={
                    "loginId": login_id, "password": "DomainTest!234",
                })
                assert login.status_code == 200, login.text
                cookie = login.headers["set-cookie"].lower()
                assert "secure" in cookie and "httponly" in cookie
                assert "samesite=lax" in cookie and "path=/api" in cookie
                assert "domain=" not in cookie  # Each hostname has its own session.
                assert client.get("/api/auth/me").status_code == 200

                created = client.post("/api/surveys", json={"title": "Domain test"})
                assert created.status_code == 201, created.text
                survey_id = created.json()["data"]["id"]
                saved = client.patch(f"/api/surveys/{survey_id}", json={
                    "title": "Saved from custom domain",
                })
                assert saved.status_code == 200, saved.text
                assert saved.json()["data"]["title"] == "Saved from custom domain"
                assert client.get(f"/api/surveys/{survey_id}").json()["data"]["title"] == (
                    "Saved from custom domain"
                )

                for denied_origin in [
                    "https://untrusted.example", "https://www.insurveyone.com.evil.example",
                    "http://www.insurveyone.com", "https://www.insurveyone.com:444", "null",
                    "https://unregistered.insurveyone.com",
                    "https://survey.insurveyone.com.evil.example",
                ]:
                    for method, path in [
                        ("POST", "/api/auth/login"), ("POST", "/api/surveys"),
                        ("PUT", "/api/surveys/unknown"), ("PATCH", f"/api/surveys/{survey_id}"),
                        ("DELETE", f"/api/surveys/{survey_id}"),
                        ("POST", "/api/public/surveys/unknown/responses"),
                    ]:
                        blocked = client.request(method, path, json={}, headers={
                            "Origin": denied_origin,
                            "Host": "untrusted.example",
                            "X-Forwarded-Host": "untrusted.example",
                            "X-Forwarded-Proto": "https",
                        })
                        assert blocked.status_code == 403, (method, path, blocked.text)
                    blocked_preflight = client.options("/api/auth/login", headers={
                        "Origin": denied_origin, "Access-Control-Request-Method": "POST",
                    })
                    assert blocked_preflight.status_code == 400
                    assert "access-control-allow-origin" not in blocked_preflight.headers

                assert client.post("/api/auth/logout").status_code == 200
                assert client.get("/api/auth/me").status_code == 401
        print("Deployment domain regression passed")
    """)
    result = subprocess.run(
        [sys.executable, "-X", "utf8", "-c", script],
        cwd=PROJECT_ROOT, env=environment, capture_output=True, text=True,
        encoding="utf-8", timeout=90, check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
