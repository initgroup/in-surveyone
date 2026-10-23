from __future__ import annotations

from contextlib import contextmanager
from dataclasses import replace
from datetime import timedelta
import hashlib
import hmac
import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from backend.config import get_settings
from backend.delivery_service import render_jobs
from backend.delivery_security import encrypt_contact
from backend.errors import ConflictError, DomainValidationError, NotFoundError
from backend.memory_store import MemoryStore, utcnow
from backend.models import DeploymentExecuteRequest, DeploymentSendRequest, SurveyAudienceRoute
from backend.oracle_store import OracleStore
from backend.solapi import SolapiClient, SolapiTransportError

SURVEY = "survey_demo_social"


def settings(**kwargs):
    return replace(get_settings(), sms_provider="solapi", solapi_api_key="fake-key-only-for-tests",
                   solapi_api_secret="fake-secret-only-for-tests", solapi_default_sender="0212345678", **kwargs)


def plan(**overrides):
    value = {"recipients": [
        {"id": "target-a", "name": "대상자 A001", "countryCode": "KR", "preferredLanguage": "ko", "mobile": "01012345678", "channels": ["SMS"]},
        {"id": "target-b", "name": "대상자 A002", "countryCode": "KR", "preferredLanguage": "ko", "mobile": "01012345679", "channels": ["SMS"], "selected": False}],
        "channels": ["SMS"], "messagesByLanguage": {"ko": {"smsBody": "{{name}}님 {{surveyTitle}} 참여: {{surveyUrl}}"}}}
    value.update(overrides)
    return DeploymentExecuteRequest.model_validate(value)


def accepted_response(payload):
    return {"failedMessageList": [], "messageList": [
        {"messageId": "fake-" + item["customFields"]["surveyoneDeliveryId"], "statusCode": "2000", "customFields": item["customFields"]}
        for item in reversed(payload["messages"])]}


def test_hmac_auth_and_secrets_never_in_settings_repr():
    config = settings()
    header = SolapiClient(config).authorization(date="2026-10-23T00:00:00Z", salt="fixed-synthetic-salt")
    expected = hmac.new(config.solapi_api_secret.encode(), b"2026-10-23T00:00:00Zfixed-synthetic-salt", hashlib.sha256).hexdigest()
    assert header.endswith("signature=" + expected)
    assert config.solapi_api_key not in repr(config)
    assert config.solapi_api_secret not in repr(config)
    store = MemoryStore(replace(config, solapi_api_secret=None))
    assert not store.delivery_providers(store._users["user_demo"]).providers["sms"].enabled
    store.settings = replace(config, sms_provider="misspelled-provider")
    assert not store.delivery_providers(store._users["user_demo"]).providers["sms"].enabled


def test_provider_bulk_response_correlates_out_of_order_and_partial_failures(monkeypatch):
    messages = [{"to": "0101234567" + str(i), "text": "synthetic", "customFields": {"surveyoneDeliveryId": "job" + str(i)}} for i in range(3)]
    calls = []
    def request(self, method, path, payload):
        calls.append(payload)
        return {"messageList": [{"messageId": "accepted-2", "statusCode": "2000", "customFields": {"surveyoneDeliveryId": "job2"}}],
                "failedMessageList": [{"messageId": "rejected-0", "statusCode": "3040", "customFields": {"surveyoneDeliveryId": "job0"}}]}
    monkeypatch.setattr(SolapiClient, "request", request)
    result = SolapiClient(settings()).send_many(messages)
    assert [item.status for item in result] == ["FAILED", "UNKNOWN", "ACCEPTED"]
    assert calls[0]["strict"] is True and calls[0]["allowDuplicates"] is False
    assert "0101234567" not in repr(result)


def test_timeout_is_unknown_and_never_automatically_retried(monkeypatch):
    store = MemoryStore(settings())
    user = store._users["user_demo"]
    calls = []
    def request(self, method, path, payload):
        calls.append(payload)
        raise SolapiTransportError("SOLAPI_OUTCOME_UNKNOWN", uncertain=True)
    monkeypatch.setattr(SolapiClient, "request", request)
    staged = store.execute_deployment(user, SURVEY, plan())
    send = DeploymentSendRequest(revision=staged.deployment.revision, consentConfirmed=True)
    first = store.send_deployment(user, SURVEY, send)
    second = store.send_deployment(user, SURVEY, send)
    assert first.unknown == second.unknown == 1
    assert len(calls) == 1
    assert not first.accepted


def test_selected_recipients_preview_save_roundtrip_and_one_shot_send(monkeypatch):
    store = MemoryStore(settings())
    user = store._users["user_demo"]
    payload = plan()
    preview = store.preview_deployment(user, SURVEY, payload)
    assert preview["total"] == 1
    assert preview["items"][0]["name"] == "대상자 A001"
    assert "payload" not in preview["items"][0]
    assert "01012345678" not in json.dumps(preview)
    assert SURVEY not in store._deployment_drafts
    saved = store.save_deployment(user, SURVEY, payload)
    assert saved.recipients[1].selected is False
    assert "*" in saved.recipients[0].mobile
    masked = DeploymentExecuteRequest.model_validate(saved.model_dump())
    assert store.preview_deployment(user, SURVEY, masked)["items"][0]["text"] == preview["items"][0]["text"]
    calls = []
    def request(self, method, path, value):
        calls.append(value)
        return accepted_response(value)
    monkeypatch.setattr(SolapiClient, "request", request)
    staged = store.execute_deployment(user, SURVEY, masked)
    send = DeploymentSendRequest(revision=staged.deployment.revision, consentConfirmed=True)
    result = store.send_deployment(user, SURVEY, send)
    assert result.accepted == 1 and len(calls[0]["messages"]) == 1
    assert calls[0]["messages"][0]["text"] == preview["items"][0]["text"]
    assert calls[0]["messages"][0]["to"] == payload.recipients[0].mobile
    assert calls[0]["messages"][0]["from"] == "0212345678"
    assert store.send_deployment(user, SURVEY, send).accepted == 1
    assert len(calls) == 1
    with pytest.raises(ConflictError):
        store.send_deployment(user, SURVEY, send.model_copy(update={"revision": 999}))
    foreign = replace(user, tenant_id="another-tenant", id="another-user")
    with pytest.raises(NotFoundError):
        store.delivery_status(foreign, SURVEY, send.revision)


def test_disabled_provider_has_no_external_calls(monkeypatch):
    store = MemoryStore(replace(settings(), sms_provider="disabled"))
    user = store._users["user_demo"]
    monkeypatch.setattr(SolapiClient, "request", lambda *args: pytest.fail("disabled provider made a network request"))
    staged = store.execute_deployment(user, SURVEY, plan())
    result = store.send_deployment(user, SURVEY, DeploymentSendRequest(revision=staged.deployment.revision, consentConfirmed=True))
    assert result.disabled == 1 and result.accepted == 0


def test_invalid_sender_and_empty_selection_do_not_record_execution():
    store = MemoryStore(replace(settings(), solapi_default_sender=""))
    user = store._users["user_demo"]
    with pytest.raises(DomainValidationError):
        store.execute_deployment(user, SURVEY, plan())
    assert SURVEY not in store._deployment_drafts
    empty = plan()
    for recipient in empty.recipients:
        recipient.selected = False
    with pytest.raises(DomainValidationError):
        store.execute_deployment(user, SURVEY, empty)
    assert SURVEY not in store._deployment_drafts


def test_published_audience_is_used_and_unknown_audience_rejected():
    store = MemoryStore(settings())
    user = store._users["user_demo"]
    _, public = store._published_survey_locked(user, SURVEY)
    public.settings.audience_routes = [SurveyAudienceRoute(code="evaluation", label="평가", sectionIds=[public.sections[0].id])]
    request = plan()
    request.recipients[0].audience_code = "evaluation"
    providers = store.delivery_providers(user).providers
    job = render_jobs(store.settings, public, request, providers, deployment_id="synthetic")[0]
    assert "audience=evaluation" in job["publicUrl"]
    assert job["publicUrl"] in job["text"]
    request.recipients[0].audience_code = "unknown"
    with pytest.raises(DomainValidationError):
        render_jobs(store.settings, public, request, providers, deployment_id="synthetic")


def test_approved_kakao_template_variables_and_buttons_match_preview(monkeypatch):
    store = MemoryStore(settings(kakao_provider="solapi", solapi_kakao_pf_id="PF_TEST"))
    user = store._users["user_demo"]
    template = {"templateId": "TP_TEST", "channelId": "PF_TEST", "status": "APPROVED", "content": "#{이름}님 참여 안내", "buttons": [{"buttonType": "WL", "buttonName": "설문 참여", "linkMo": "#{URL}"}], "messageType": "BA", "emphasizeType": "NONE"}
    monkeypatch.setattr(SolapiClient, "templates", lambda self, pf: [template])
    payload = plan(recipients=[{"id": "k1", "name": "대상자 A001", "countryCode": "KR", "preferredLanguage": "ko", "kakaoId": "01012345678", "channels": ["KAKAO"]}], channels=["KAKAO"],
                   messagesByLanguage={"ko": {"kakaoBody": template["content"], "kakaoTemplateId": "TP_TEST", "kakaoButtons": template["buttons"], "kakaoVariables": {"#{이름}": "{{name}}", "#{URL}": "{{surveyUrl}}"}}})
    calls = []
    def request(self, method, path, value):
        calls.append(value)
        return accepted_response(value)
    monkeypatch.setattr(SolapiClient, "request", request)
    preview = store.preview_deployment(user, SURVEY, payload, verify_templates=True)
    staged = store.execute_deployment(user, SURVEY, payload)
    result = store.send_deployment(user, SURVEY, DeploymentSendRequest(revision=staged.deployment.revision, consentConfirmed=True))
    assert result.accepted == 1
    sent = calls[0]["messages"][0]
    assert sent["type"] == "ATA"
    assert sent["text"] == preview["items"][0]["text"] == "대상자 A001님 참여 안내"
    assert sent["kakaoOptions"]["disableSms"] is True
    assert sent["kakaoOptions"]["buttons"][0]["linkMo"] == preview["items"][0]["publicUrl"]
    payload.messages_by_language["ko"].kakao_body = "승인 원문 변경"
    with pytest.raises(DomainValidationError, match="변경"):
        store.preview_deployment(user, SURVEY, payload, verify_templates=True)


def test_scheduled_date_is_passed_and_expired_request_is_not_sent(monkeypatch):
    calls = []
    monkeypatch.setattr(SolapiClient, "request", lambda self, method, path, value: calls.append(value) or accepted_response(value))
    message = {"to": "01012345678", "customFields": {"surveyoneDeliveryId": "scheduled-test"}}
    future = utcnow() + timedelta(hours=1)
    assert SolapiClient(settings()).send_many([message], future)[0].status == "ACCEPTED"
    assert calls[0]["scheduledDate"] == future.isoformat()
    assert SolapiClient(settings()).send_many([message], utcnow() - timedelta(minutes=1))[0].status == "FAILED"
    assert len(calls) == 1


def test_oracle_claim_commits_before_network_and_retries_do_not_send(monkeypatch):
    from test_oracle_repository import assert_exact_sql_binds
    class Pool:
        active = False
        commits = 0
        @contextmanager
        def connection(self):
            yield self
        @contextmanager
        def transaction(self):
            self.active = True
            try:
                yield self
                self.commits += 1
            finally:
                self.active = False
    pool = Pool()
    config = settings()
    row = {"delivery_id": "job-oracle", "channel_code": "SMS", "provider_code": "solapi", "status_code": "QUEUED", "provider_message_id": None,
           "last_error_code": None, "message_template_json": json.dumps({"solapiMessage": {"from": "0212345678", "text": "Synthetic", "country": "82"}}),
           "contact_value_encrypted": encrypt_contact(config.delivery_secret, "01012345678"), "country_code": "KR", "retention_until": utcnow() + timedelta(days=1), "target_retention_until": utcnow() + timedelta(days=1), "recipient_status": "READY", "target_status": "READY"}
    class Crud:
        executes = []
        def fetch_all(self, connection, sql_id, params):
            assert sql_id == "DELIVERY_SEND_LIST"
            assert params["tenantId"] == "tenant-synthetic" and params["ownerUserId"] == "user-synthetic"
            return [dict(row)]
        def execute(self, connection, sql_id, params):
            self.executes.append((sql_id, params))
            if sql_id == "DELIVERY_SEND_CLAIM":
                assert row["status_code"] == "QUEUED"
                row.update(status_code="SENDING", last_error_code="SOLAPI_OUTCOME_UNKNOWN")
            elif sql_id == "DELIVERY_SEND_OUTCOME":
                row.update(status_code=params["statusCode"], provider_message_id=params["providerMessageId"], last_error_code=params["lastErrorCode"])
            return 1
    class Store(OracleStore):
        def _send_batch(self, connection, user, survey_id, revision, *, lock=False):
            assert revision == 3
            return {"plan_json": '{"schedule":{"mode":"NOW"}}'}, {"tenantId": user.tenant_id, "ownerUserId": user.id,
                "surveyId": survey_id, "surveyVersionNo": 1, "deploymentId": "d-test", "batchId": "b-test"}
    calls = []
    def request(self, method, path, value):
        assert not pool.active and pool.commits == 1
        calls.append(value)
        return accepted_response(value)
    monkeypatch.setattr(SolapiClient, "request", request)
    crud = Crud()
    store = Store(settings=config, pool=pool, crud=crud)
    user = SimpleNamespace(id="user-synthetic", tenant_id="tenant-synthetic", is_guest=False)
    send = DeploymentSendRequest(revision=3, consentConfirmed=True)
    assert store.send_deployment(user, "survey-synthetic", send).accepted == 1
    assert store.send_deployment(user, "survey-synthetic", send).accepted == 1
    assert len(calls) == 1
    assert row["status_code"] == "SENDING"  # receipt, not handset delivery
    assert_exact_sql_binds(crud.executes)
    stored = next(params["messageTemplateJson"] for name, params in crud.executes if name == "DELIVERY_SEND_OUTCOME")
    assert json.loads(stored)["deliveryResult"]["statusCode"] == "2000"
    assert "01012345678" not in stored


def test_preview_and_send_api_require_selection_revision_and_consent(monkeypatch):
    from backend.dependencies import current_store, current_user
    from main import app
    store = MemoryStore(settings())
    user = store._users["user_demo"]
    app.dependency_overrides[current_store] = lambda: store
    app.dependency_overrides[current_user] = lambda: user
    monkeypatch.setattr(SolapiClient, "request", lambda self, method, path, payload: accepted_response(payload))
    try:
        with TestClient(app) as client:
            body = plan().model_dump(by_alias=True, mode="json")
            response = client.post(f"/api/deployments/by-survey/{SURVEY}/preview", json=body)
            assert response.status_code == 200, response.text
            assert response.json()["data"]["total"] == 1
            selected_preview = client.post(f"/api/deployments/by-survey/{SURVEY}/preview?recipientId=target-a", json=body)
            assert selected_preview.json()["data"]["items"][0]["recipientId"] == "target-a"
            excluded_preview = client.post(f"/api/deployments/by-survey/{SURVEY}/preview?recipientId=target-b", json=body)
            assert excluded_preview.json()["data"]["items"] == []
            staged = client.post(f"/api/deployments/by-survey/{SURVEY}/execute", json=body)
            assert staged.status_code == 200, staged.text
            revision = staged.json()["data"]["deployment"]["revision"]
            assert client.post(f"/api/deployments/by-survey/{SURVEY}/send", json={"revision": revision, "consentConfirmed": False}).status_code == 422
            result = client.post(f"/api/deployments/by-survey/{SURVEY}/send", json={"revision": revision, "consentConfirmed": True})
            assert result.status_code == 200, result.text
            assert result.json()["data"]["accepted"] == 1
            assert "fake-key" not in result.text and "01012345678" not in result.text
    finally:
        app.dependency_overrides.pop(current_store, None)
        app.dependency_overrides.pop(current_user, None)


@pytest.mark.parametrize("response", [{"messageList": [{"statusCode": "2000", "customFields": {"surveyoneDeliveryId": "unknown-test"}}]},
                                       {"messageList": [{"customFields": "malformed"}]}])
def test_malformed_provider_acceptance_remains_unknown(monkeypatch, response):
    monkeypatch.setattr(SolapiClient, "request", lambda *args: response)
    result = SolapiClient(settings()).send_many([{"to": "01012345678", "customFields": {"surveyoneDeliveryId": "unknown-test"}}])
    assert result[0].status == "UNKNOWN"


def test_normalized_duplicate_numbers_are_rejected_before_execution():
    store = MemoryStore(settings())
    payload = plan()
    payload.recipients[1].selected = True
    payload.recipients[1].mobile = "+82 10-1234-5678"
    with pytest.raises(DomainValidationError, match="중복"):
        store.execute_deployment(store._users["user_demo"], SURVEY, payload)
    assert SURVEY not in store._deployment_drafts


def test_history_keeps_old_batches_and_safe_provider_messages(monkeypatch):
    store = MemoryStore(settings())
    user = store._users["user_demo"]
    def reject(self, method, path, payload):
        raise SolapiTransportError("DailyLimitExceeded", uncertain=False, message="일일 50건 한도를 초과했습니다.")
    monkeypatch.setattr(SolapiClient, "request", reject)
    first = store.execute_deployment(user, SURVEY, plan())
    result = store.send_deployment(user, SURVEY, DeploymentSendRequest(revision=first.deployment.revision, consentConfirmed=True))
    assert result.items[0].message == "일일 50건 한도를 초과했습니다."
    store.execute_deployment(user, SURVEY, plan())
    logs = store.delivery_history(user, SURVEY, status="FAILED")
    assert len(logs["items"]) == 1
    assert logs["items"][0]["statusCode"] == "DailyLimitExceeded"
    assert logs["items"][0]["attemptedAt"]
    assert "01012345678" not in json.dumps(logs)
    assert store.delivery_history(user, SURVEY, offset=50)["items"] == []
    foreign = replace(user, id="foreign", tenant_id="foreign")
    assert store.delivery_history(foreign)["items"] == []
    with pytest.raises(NotFoundError):
        store.delivery_history(foreign, SURVEY)


def test_http_error_returns_sanitized_code_and_message(monkeypatch):
    import io
    from urllib.error import HTTPError
    config = settings()
    class Opener:
        def open(self, request, timeout):
            body = json.dumps({"errorCode": "DailyLimitExceeded", "errorMessage": "일일 50건 한도 초과 01012345678 " + config.solapi_api_key}).encode()
            raise HTTPError(request.full_url, 403, "forbidden", {}, io.BytesIO(body))
    monkeypatch.setattr("backend.solapi.build_opener", lambda *args: Opener())
    result = SolapiClient(config).send_many([{"to": "01012345678", "customFields": {"surveyoneDeliveryId": "synthetic"}}])
    assert result[0].status == "FAILED"
    assert result[0].status_code == "DailyLimitExceeded"
    assert "50건" in result[0].message
    assert "01012345678" not in repr(result) and config.solapi_api_key not in repr(result)


def test_oracle_history_owner_scope_and_persisted_result():
    from test_oracle_repository import FakePool
    class Crud:
        def fetch_all(self, connection, sql_id, params):
            assert sql_id == "DELIVERY_HISTORY_BY_OWNER"
            assert params == {"tenantId": "tenant-test", "ownerUserId": "owner-test", "surveyId": None, "offset": 0, "statusCode": "FAILED"}
            return [{"delivery_id": "delivery-test", "channel_code": "SMS", "status_code": "FAILED", "last_error_code": "DailyLimitExceeded", "provider_message_id": None,
                     "message_template_json": '{"deliveryResult":{"statusCode":"DailyLimitExceeded","message":"일일 50건 한도 초과"}}',
                     "survey_id": "old-project", "survey_title": "종료된 검증 설문", "survey_version_no": 1, "batch_id": "old-batch"}]
    store = OracleStore(settings=settings(), pool=FakePool(), crud=Crud())
    logs = store.delivery_history(SimpleNamespace(id="owner-test", tenant_id="tenant-test"), status="FAILED")
    assert logs["items"][0]["message"] == "일일 50건 한도 초과"
    assert logs["items"][0]["batchId"] == "old-batch"


@pytest.mark.parametrize("repository", ["memory", "oracle"])
def test_recipient_preview_filter_keeps_total_masks_contacts_and_validates_whole_plan(repository):
    memory = MemoryStore(settings())
    user = memory._users["user_demo"]
    request = plan()
    request.recipients[1].selected = True
    if repository == "memory":
        store = memory
    else:
        _, public = memory._published_survey_locked(user, SURVEY)
        class Pool:
            @contextmanager
            def connection(self):
                yield self
        class Crud:
            def fetch_one(self, connection, query, params):
                assert query == "DELIVERY_BATCH_LATEST"
                assert params["tenantId"] == user.tenant_id
                assert params["surveyId"] == SURVEY
                return None
        class Store(OracleStore):
            def _delivery_context(self, connection, actor, survey_id):
                assert actor.id == user.id and actor.tenant_id == user.tenant_id
                assert survey_id == SURVEY
                return {"deployment_id": "synthetic-deployment", "survey_version_no": 1}, public
        store = Store(settings=memory.settings, pool=Pool(), crud=Crud())
    result = store.preview_deployment(user, SURVEY, request, recipient_id="target-b")
    assert result["total"] == 2 and result["filteredTotal"] == 1
    assert result["items"][0]["recipientId"] == "target-b"
    assert "대상자 A002" in result["items"][0]["text"]
    assert "01012345679" not in json.dumps(result) and "payload" not in result["items"][0]
    request.recipients[1].selected = False
    assert store.preview_deployment(user, SURVEY, request, recipient_id="target-b")["items"] == []
    assert store.preview_deployment(user, SURVEY, request, recipient_id="unowned-recipient")["items"] == []
    # Filtering the valid recipient must not conceal a malformed selected recipient.
    request.recipients[1].selected = True
    request.recipients[1].mobile = "not-a-phone"
    with pytest.raises(DomainValidationError):
        store.preview_deployment(user, SURVEY, request, recipient_id="target-a")
    assert SURVEY not in memory._deployment_drafts


def test_email_preview_has_personalized_subject_and_content_with_canonical_link():
    store = MemoryStore(settings())
    user = store._users["user_demo"]
    request = plan(recipients=[{"id": "target-a", "name": "대상자 A001", "countryCode": "KR", "preferredLanguage": "ko", "email": "synthetic@example.test", "channels": ["EMAIL"]}], channels=["EMAIL"], messagesByLanguage={"ko": {
        "emailSubject": "{{name}} 고객님 설문 안내", "emailBody": '<p>{{name}} 고객님</p><a href="{{surveyUrl}}">설문URL바로가기</a>'}})
    request.recipients[0].email = "synthetic@example.test"
    request.recipients[0].channels = ["EMAIL"]
    item = store.preview_deployment(user, SURVEY, request, recipient_id="target-a")["items"][0]
    assert item["subject"] == "대상자 A001 고객님 설문 안내"
    assert item["publicUrl"] in item["text"] and "{{" not in item["text"]
    assert item["enabled"] is False  # Previewing never pretends email is integrated.
    assert item["sender"] is None  # An SMS sender is not an email address.


@pytest.mark.parametrize("repository", ["memory", "oracle"])
def test_bulk_and_individual_send_scopes_preserve_registration_and_skip_other_contacts(repository):
    memory = MemoryStore(settings())
    user = memory._users["user_demo"]
    if repository == "memory":
        store = memory
    else:
        _, public = memory._published_survey_locked(user, SURVEY)
        class Pool:
            @contextmanager
            def connection(self):
                yield self
        class Crud:
            def fetch_one(self, connection, query, params):
                assert params["tenantId"] == user.tenant_id and params["surveyId"] == SURVEY
                return None
        class Store(OracleStore):
            def _delivery_context(self, connection, actor, survey_id):
                assert actor == user and survey_id == SURVEY
                return {"deployment_id": "scope-test", "survey_version_no": 1}, public
        store = Store(settings=memory.settings, pool=Pool(), crud=Crud())
    request = plan(deliveryOptions={"sendScope": "BULK"})
    request.recipients.append(type(request.recipients[0]).model_validate({
        "id": "email-only", "name": "이메일 수신자", "countryCode": "KR", "preferredLanguage": "ko",
        "email": "only@example.test", "channels": ["EMAIL"], "selected": True}))
    flags = [item.selected for item in request.recipients]
    bulk = store.preview_deployment(user, SURVEY, request)
    assert bulk["total"] == 1 and bulk["items"][0]["recipientId"] == "target-a"
    request.delivery_options.send_scope = "INDIVIDUAL"
    request.delivery_options.individual_recipient_id = "target-b"
    individual = store.preview_deployment(user, SURVEY, request)
    assert individual["total"] == 1 and individual["items"][0]["recipientId"] == "target-b"
    assert [item.selected for item in request.recipients] == flags
    assert "대상자 A002" in individual["items"][0]["text"]
    if repository == "memory":
        saved = store.save_deployment(user, SURVEY, request)
        assert saved.delivery_options.send_scope == "INDIVIDUAL"
        assert saved.delivery_options.individual_recipient_id == "target-b"
        assert [item.selected for item in saved.recipients] == flags
    else:
        stored = json.loads(store._delivery_plan_json(request))
        assert stored["deliveryOptions"]["individualRecipientId"] == "target-b"
    with pytest.raises(ValueError, match="개별 발송 대상자"):
        type(request).model_validate({**request.model_dump(by_alias=True), "deliveryOptions": {
            "sendScope": "INDIVIDUAL", "individualRecipientId": "another-tenant-target"}})


def test_individual_execution_sends_only_the_explicit_contact_and_keeps_bulk_checks(monkeypatch):
    store = MemoryStore(settings())
    user = store._users["user_demo"]
    request = plan(deliveryOptions={"sendScope": "INDIVIDUAL", "individualRecipientId": "target-b"})
    calls = []
    def transport(self, method, path, payload):
        calls.append(payload)
        return accepted_response(payload)
    monkeypatch.setattr(SolapiClient, "request", transport)
    preview = store.preview_deployment(user, SURVEY, request)
    result = store.execute_deployment(user, SURVEY, request)
    store.send_deployment(user, SURVEY, DeploymentSendRequest(revision=result.deployment.revision, consentConfirmed=True))
    assert len(calls) == 1 and len(calls[0]["messages"]) == 1
    assert calls[0]["messages"][0]["to"] == "01012345679"
    assert calls[0]["messages"][0]["text"] == preview["items"][0]["text"]
    assert [item.selected for item in store.deployment(user, SURVEY).recipients] == [True, False]


@pytest.mark.parametrize(("body", "message_type", "size"), [
    ("가" * 45, "SMS", 90), ("가" * 45 + "a", "LMS", 91),
    ("가" * 1000, "LMS", 2000),
], ids=["sms-90-bytes", "lms-91-bytes", "lms-2000-bytes"])
def test_domestic_sms_type_uses_replaced_body_bytes(body, message_type, size):
    store = MemoryStore(settings())
    user = store._users["user_demo"]
    _, public = store._published_survey_locked(user, SURVEY)
    request = plan(messagesByLanguage={"ko": {"smsBody": body}})
    job = render_jobs(store.settings, public, request, store.delivery_providers(user).providers, deployment_id="test")[0]
    assert job["payload"]["type"] == job["messageType"] == message_type
    assert job["messageBytes"] == size
    assert job["payload"]["autoTypeDetect"] is False


def test_replaced_url_remains_clickable_in_actual_utf8_json_transport(monkeypatch):
    from urllib.parse import parse_qs, urlsplit
    import backend.solapi as transport

    store = MemoryStore(settings())
    user = store._users["user_demo"]
    _, public = store._published_survey_locked(user, SURVEY)
    public.settings.audience_routes = [SurveyAudienceRoute(code="evaluation", label="평가", sectionIds=[public.sections[0].id])]
    request = plan(messagesByLanguage={"ko": {"smsBody": '{{name}} 고객님\n설문URL바로가기 : {{surveyUrl}}\n참고: https://example.test/?q=%ED%95%9C%EA%B8%80&x=a%2Bb'}})
    request.recipients[0].audience_code = "evaluation"
    job = render_jobs(store.settings, public, request, store.delivery_providers(user).providers, deployment_id="test")[0]
    assert job["messageType"] == "LMS"
    assert parse_qs(urlsplit(job["publicUrl"]).query) == {"lang": ["ko"], "audience": ["evaluation"]}
    assert job["publicUrl"] in job["text"]
    message = {**job["payload"], "customFields": {"surveyoneDeliveryId": "url-test"}}
    captured = []

    class Opener:
        @contextmanager
        def open(self, http_request, timeout):
            assert http_request.get_header("Content-type") == "application/json; charset=utf-8"
            decoded = json.loads(http_request.data.decode("utf-8"))
            captured.append(decoded)
            assert decoded["messages"][0]["text"] == job["text"]
            assert "&audience=evaluation" in decoded["messages"][0]["text"]
            assert "&amp;" not in decoded["messages"][0]["text"]
            assert "q=%ED%95%9C%EA%B8%80&x=a%2Bb" in decoded["messages"][0]["text"]
            yield SimpleNamespace(read=lambda limit: json.dumps(accepted_response(decoded)).encode("utf-8"))

    monkeypatch.setattr(transport, "build_opener", lambda *args: Opener())
    assert SolapiClient(store.settings).send_many([message])[0].status == "ACCEPTED"
    assert len(captured) == 1


def test_url_replacement_exceeding_lms_limit_is_rejected_before_network():
    store = MemoryStore(settings())
    user = store._users["user_demo"]
    _, public = store._published_survey_locked(user, SURVEY)
    request = plan(messagesByLanguage={"ko": {"smsBody": "가" * 980 + "{{surveyUrl}}"}})
    with pytest.raises(DomainValidationError, match="2,000"):
        render_jobs(store.settings, public, request, store.delivery_providers(user).providers, deployment_id="test")
