from __future__ import annotations

import pytest
from pydantic import ValidationError

from backend.errors import DomainValidationError
from backend.delivery_security import (
    recipient_access_token,
    validate_recipient_access_token,
)
from backend.memory_store import MemoryStore
from backend.models import DeploymentDraftRequest, DeploymentExecuteRequest


def _request(**overrides) -> DeploymentDraftRequest:
    payload = {
        "recipients": [
            {
                "id": "respondent-ko",
                "name": "응답자 A",
                "countryCode": "KR",
                "preferredLanguage": "ko",
                "email": "alpha@example.test",
                "channels": ["EMAIL"],
            }
        ],
        "channels": ["EMAIL"],
        "messagesByLanguage": {
            "ko": {"emailSubject": "설문 안내", "emailBody": "참여해 주세요."}
        },
    }
    payload.update(overrides)
    return DeploymentDraftRequest.model_validate(payload)


def test_delivery_messages_are_required_only_for_locale_channel_pairs_in_use() -> None:
    request = _request(
        recipients=[
            {
                "id": "respondent-ko",
                "name": "응답자 A",
                "countryCode": "KR",
                "preferredLanguage": "ko",
                "email": "alpha@example.test",
                "channels": ["EMAIL"],
            },
            {
                "id": "respondent-vi",
                "name": "응답자 B",
                "countryCode": "VN",
                "preferredLanguage": "vi",
                "mobile": "010-1234-5678",
                "channels": ["SMS"],
            },
        ],
        channels=["EMAIL", "SMS"],
        messagesByLanguage={
            "ko": {"emailSubject": "설문 안내", "emailBody": "참여해 주세요."},
            "vi": {"smsBody": "Vui lòng tham gia khảo sát."},
        },
    )

    assert request.messages_by_language["ko"].sms_body == ""
    assert request.messages_by_language["vi"].email_subject == ""


def test_empty_delivery_plan_is_valid_only_as_a_draft() -> None:
    draft = DeploymentDraftRequest.model_validate(
        {"recipients": [], "channels": [], "messagesByLanguage": {}}
    )

    assert draft.recipients == []
    assert draft.channels == []

    with pytest.raises(ValidationError, match="at least 1 item"):
        DeploymentExecuteRequest.model_validate(
            {"recipients": [], "channels": [], "messagesByLanguage": {}}
        )


def test_recipient_access_token_is_opaque_scoped_and_tamper_evident() -> None:
    token = recipient_access_token(
        "delivery-secret",
        survey_id="survey-1",
        survey_version=3,
        deployment_id="deployment-1",
        recipient_id="respondent-1",
    )

    assert token.startswith("d1.")
    assert "respondent-1" not in token
    assert validate_recipient_access_token(
        "delivery-secret", token, survey_id="survey-1", survey_version=3
    )
    assert not validate_recipient_access_token(
        "delivery-secret", token, survey_id="survey-2", survey_version=3
    )
    assert not validate_recipient_access_token(
        "delivery-secret", token[:-1] + ("A" if token[-1] != "A" else "B"),
        survey_id="survey-1",
        survey_version=3,
    )


def test_delivery_rejects_unreachable_recipients_and_duplicate_priority() -> None:
    with pytest.raises(ValidationError, match="전송할 수 없는 대상자"):
        _request(
            recipients=[
                {
                    "id": "respondent-ko",
                    "name": "응답자 A",
                    "countryCode": "KR",
                    "preferredLanguage": "ko",
                    "mobile": "01012345678",
                    "channels": ["SMS"],
                }
            ]
        )

    with pytest.raises(ValidationError, match="같은 채널을 중복"):
        _request(schedule={"strategy": "ALL_AVAILABLE", "priority": ["EMAIL", "EMAIL"]})


def test_failed_new_memory_batch_does_not_archive_executed_history() -> None:
    store = MemoryStore()
    user = store._users["user_demo"]
    survey_id = "survey_demo_social"
    original = _request()

    store.execute_deployment(user, survey_id, original)
    original_deployment_id = store.deployment(user, survey_id).deployment_id
    assert store._deployment_history.get(survey_id, []) == []

    duplicated = _request(
        recipients=[
            original.recipients[0].model_dump(by_alias=True, mode="json"),
            {
                "id": "respondent-ko-2",
                "name": "응답자 B",
                "countryCode": "KR",
                "preferredLanguage": "ko",
                "email": "ALPHA@example.test",
                "channels": ["EMAIL"],
            },
        ]
    )
    with pytest.raises(DomainValidationError, match="중복 등록"):
        store.save_deployment(user, survey_id, duplicated)

    assert store._deployment_history.get(survey_id, []) == []
    assert store.deployment(user, survey_id).execution_status == "DISABLED"

    created = store.save_deployment(user, survey_id, original)
    assert created.revision == 1
    assert created.deployment_id != original_deployment_id
    assert len(store._deployment_history[survey_id]) == 1


def test_memory_priority_fallback_counts_only_the_selected_endpoint() -> None:
    store = MemoryStore()
    user = store._users["user_demo"]
    request = _request(
        recipients=[
            {
                "id": "respondent-ko",
                "name": "응답자 A",
                "countryCode": "KR",
                "preferredLanguage": "ko",
                "email": "alpha@example.test",
                "mobile": "01012345678",
                "channels": ["EMAIL", "SMS"],
            }
        ],
        channels=["EMAIL", "SMS"],
        messagesByLanguage={
            "ko": {
                "emailSubject": "설문 안내",
                "emailBody": "참여해 주세요.",
                "smsBody": "참여해 주세요.",
            }
        },
        schedule={
            "strategy": "PRIORITY_FALLBACK",
            "priority": ["EMAIL", "SMS"],
        },
    )

    result = store.execute_deployment(user, "survey_demo_social", request)

    assert result.execution.execution_status == "DISABLED"
    counts = {item.channel.value: item.count for item in result.execution.channel_results}
    assert counts == {"EMAIL": 1, "SMS": 0}
