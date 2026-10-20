"""Public links derived from the immutable active survey version."""
from __future__ import annotations

from urllib.parse import urlencode

from backend.models import PublicSurvey, SurveyPublicLink, SurveyPublicLinks


def public_link_items(survey: PublicSurvey) -> list[SurveyPublicLink]:
    base = f"/s/{survey.slug}"
    if not survey.settings.audience_routes:
        return [SurveyPublicLink(label="전체 설문", url=base, is_default=True)]
    return [
        SurveyPublicLink(
            audience_code=route.code, label=route.label,
            url=f"{base}?{urlencode({'audience': route.code})}",
            is_default=route.code == survey.settings.default_audience,
        ) for route in survey.settings.audience_routes
    ]


def public_links_view(survey: PublicSurvey) -> SurveyPublicLinks:
    return SurveyPublicLinks(
        survey_id=survey.survey_id, title=survey.title, version=survey.version,
        slug=survey.slug, public_url=f"/s/{survey.slug}", links=public_link_items(survey),
    )
