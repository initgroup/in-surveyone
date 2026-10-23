"""Public links derived from the immutable active survey version."""
from __future__ import annotations

from urllib.parse import urlencode

from backend.models import PublicSurvey, SurveySettings, SurveyPublicLink, SurveyPublicLinks


def _link_items(slug: str, settings: SurveySettings) -> list[SurveyPublicLink]:
    base = f"/s/{slug}"
    if not settings.audience_routes:
        return [SurveyPublicLink(label="전체 설문", url=base, is_default=True)]
    return [
        SurveyPublicLink(
            audience_code=route.code, label=route.label,
            url=f"{base}?{urlencode({'audience': route.code})}",
            is_default=route.code == settings.default_audience,
        ) for route in settings.audience_routes
    ]


def public_link_items(survey: PublicSurvey) -> list[SurveyPublicLink]:
    return _link_items(survey.slug, survey.settings)


def public_links_metadata(
    *, survey_id: str, title: str, version: int, slug: str, settings: SurveySettings,
) -> SurveyPublicLinks:
    """URL listing requires no questions, translations, responses or draft."""
    return SurveyPublicLinks(
        survey_id=survey_id, title=title, version=version,
        slug=slug, public_url=f"/s/{slug}", links=_link_items(slug, settings),
    )
