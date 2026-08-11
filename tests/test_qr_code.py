from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient

from backend.qr_code import create_qr_svg
from main import app, settings


def _signup(client: TestClient, prefix: str) -> None:
    suffix = uuid4().hex[:10]
    response = client.post(
        "/api/auth/signup",
        json={
            "loginId": f"{prefix}-{suffix}",
            "password": "SurveyOne!234",
            "name": "QR 담당자",
            "email": f"{prefix}-{suffix}@example.test",
            "organizationName": "QR 테스트 기관",
        },
    )
    assert response.status_code == 201, response.text


def test_qr_svg_has_standard_quiet_zone_and_safe_vector_markup() -> None:
    target = "https://in-surveyone.onrender.com/s/public-survey"
    svg = create_qr_svg(target).decode("utf-8")

    assert svg.startswith('<?xml version="1.0" encoding="UTF-8"?>')
    assert "shape-rendering=\"crispEdges\"" in svg
    assert "<rect" in svg and 'fill="#ffffff"' in svg
    assert "<path" in svg and 'fill="#07162d"' in svg
    assert target in svg
    assert "<script" not in svg.lower()


def test_published_survey_qr_encodes_configured_public_base_and_is_owner_scoped() -> None:
    slug = f"qr-test-{uuid4().hex[:8]}"
    with TestClient(app) as owner:
        _signup(owner, "qr-owner")
        created = owner.post(
            "/api/surveys",
            json={"templateId": "social-research", "title": "QR 모바일 설문"},
        )
        assert created.status_code == 201, created.text
        survey_id = created.json()["data"]["id"]
        published = owner.post(
            f"/api/surveys/{survey_id}/publish", json={"slug": slug}
        )
        assert published.status_code == 200, published.text

        qr_response = owner.get(f"/api/surveys/{survey_id}/qr.svg")
        assert qr_response.status_code == 200, qr_response.text
        assert qr_response.headers["content-type"].startswith("image/svg+xml")
        assert "no-store" in qr_response.headers["cache-control"]
        assert qr_response.headers["x-qr-target"] == f"{settings.base_url}/s/{slug}"
        assert b"<svg" in qr_response.content

        with TestClient(app) as stranger:
            _signup(stranger, "qr-stranger")
            forbidden = stranger.get(f"/api/surveys/{survey_id}/qr.svg")
            assert forbidden.status_code == 404


def test_draft_survey_does_not_create_misleading_qr() -> None:
    with TestClient(app) as owner:
        _signup(owner, "qr-draft")
        created = owner.post(
            "/api/surveys",
            json={"templateId": "social-research", "title": "QR 작성 중 설문"},
        )
        survey_id = created.json()["data"]["id"]
        response = owner.get(f"/api/surveys/{survey_id}/qr.svg")

    assert response.status_code == 409
    assert "배포한 후" in response.json()["detail"]
