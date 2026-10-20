from __future__ import annotations

from urllib.parse import parse_qs, urlsplit

from fastapi.testclient import TestClient

from main import app


def _login_guest(client: TestClient) -> None:
    created = client.post("/api/auth/guest", json={"mode": "database"})
    assert created.status_code == 201, created.text
    credential = created.json()["data"]["guestCredential"]
    logged_in = client.post("/api/auth/login", json={
        "loginId": credential["loginId"], "password": credential["initialPassword"],
    })
    assert logged_in.status_code == 200, logged_in.text


def _draft() -> dict:
    return {"title": "Audience links", "sections": [
        {"id": "evaluation", "title": "Evaluation", "questions": [{"id": "q_eval", "type": "short_text", "title": "Evaluation"}]},
        {"id": "cooperation", "title": "Cooperation", "questions": [{"id": "q_coop", "type": "short_text", "title": "Cooperation"}]},
    ], "settings": {"audienceRoutes": [
        {"code": "evaluation", "label": "Evaluation", "sectionIds": ["evaluation"]},
        {"code": "cooperation", "label": "Cooperation", "sectionIds": ["cooperation"]},
        {"code": "all", "label": "All", "sectionIds": ["evaluation", "cooperation"]},
    ], "defaultAudience": "evaluation"}}


def _assert_audiences(links: list[dict], slug: str) -> None:
    assert [item["audienceCode"] for item in links] == ["evaluation", "cooperation", "all"]
    assert [item["isDefault"] for item in links] == [True, False, False]
    for item in links:
        url = urlsplit(item["url"])
        assert url.path == f"/s/{slug}"
        assert parse_qs(url.query) == {"audience": [item["audienceCode"]]}


def test_publish_returns_all_audience_urls_and_get_uses_active_snapshot() -> None:
    with TestClient(app, client=("publication-links-test", 50000)) as client:
        _login_guest(client)
        created = client.post("/api/surveys", json=_draft())
        assert created.status_code == 201, created.text
        survey_id = created.json()["data"]["id"]
        assert client.get(f"/api/surveys/{survey_id}/public-links").status_code == 409
        published = client.post(f"/api/surveys/{survey_id}/publish", json={}).json()["data"]
        first_slug = published["slug"]
        _assert_audiences(published["links"], first_slug)
        revision = client.get(f"/api/surveys/{survey_id}").json()["data"]["revision"]
        view = client.get(f"/api/surveys/{survey_id}/public-links").json()["data"]
        assert view["version"] == 1
        assert view["links"] == published["links"]
        assert client.get(f"/api/surveys/{survey_id}").json()["data"]["revision"] == revision
        for item in view["links"]:
            public = client.get(f"/api/public/surveys/{first_slug}", params={"audience": item["audienceCode"]})
            assert public.status_code == 200, public.text
            assert public.json()["data"]["audienceCode"] == item["audienceCode"]
        changed = client.patch(f"/api/surveys/{survey_id}", json={"title": "Unpublished title", "settings": {}})
        assert changed.status_code == 200, changed.text
        unchanged = client.get(f"/api/surveys/{survey_id}/public-links").json()["data"]
        assert unchanged["title"] == "Audience links"
        assert unchanged["links"] == published["links"]
        regenerated = client.post(f"/api/surveys/{survey_id}/public-url/regenerate", json={})
        assert regenerated.status_code == 200, regenerated.text
        next_slug = regenerated.json()["data"]["slug"]
        rotated = client.get(f"/api/surveys/{survey_id}/public-links").json()["data"]
        assert rotated["version"] == 1 and rotated["slug"] == next_slug
        _assert_audiences(rotated["links"], next_slug)
        assert client.get(f"/api/public/surveys/{first_slug}").status_code == 404
        republished = client.post(f"/api/surveys/{survey_id}/publish", json={}).json()["data"]
        assert republished["slug"] == next_slug and republished["version"] == 2
        assert republished["links"] == [{"audienceCode": None, "label": "전체 설문", "url": f"/s/{next_slug}", "isDefault": True}]
        assert client.get(f"/api/surveys/{survey_id}/public-links").json()["data"]["links"] == republished["links"]


def test_audience_urls_stay_identical_when_republished_with_same_routes() -> None:
    with TestClient(app, client=("publication-links-test", 50000)) as client:
        _login_guest(client)
        created = client.post("/api/surveys", json=_draft()).json()["data"]
        survey_id = created["id"]
        first = client.post(f"/api/surveys/{survey_id}/publish", json={}).json()["data"]
        assert client.patch(f"/api/surveys/{survey_id}", json={"title": "Revised"}).status_code == 200
        second = client.post(f"/api/surveys/{survey_id}/publish", json={}).json()["data"]
        assert second["links"] == first["links"]
        assert second["version"] == first["version"] + 1


def test_public_link_listing_requires_project_owner() -> None:
    with TestClient(app, client=("publication-links-test", 50000)) as client:
        assert client.get("/api/surveys/unknown/public-links").status_code == 401
        _login_guest(client)
        created = client.post("/api/surveys", json=_draft()).json()["data"]
        survey_id = created["id"]
        assert client.post(f"/api/surveys/{survey_id}/publish", json={}).status_code == 200
        _login_guest(client)
        assert client.get(f"/api/surveys/{survey_id}/public-links").status_code == 404
