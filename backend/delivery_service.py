"""Shared version-bound rendering for preview and SOLAPI queue preparation."""
from __future__ import annotations

import re
import json
from datetime import datetime, timezone
from urllib.parse import urlencode

from backend.delivery_security import mask_contact
from backend.errors import DomainValidationError
from backend.models import DeliveryChannel, DeliverySendItem, DeliverySendResult
from backend.survey_audience import resolve_audience
from backend.solapi import SolapiClient

CONTACT_FIELDS = {"EMAIL": "email", "SMS": "mobile", "KAKAO": "kakao_id", "FAX": "fax"}
COUNTRIES = {"KR": "82", "US": "1", "JP": "81", "CN": "86", "VN": "84", "PH": "63"}


def phone_number(value: str, country: str = "KR", *, sender: bool = False) -> str:
    if not value or not re.fullmatch(r"[+0-9 ()\-]+", value):
        raise DomainValidationError("발신·수신 전화번호는 전체 전화번호를 입력해 주세요.")
    number = re.sub(r"[^0-9]", "", value)
    if sender:
        if not re.fullmatch(r"[0-9]{8,12}", number):
            raise DomainValidationError("발신번호는 SOLAPI에 등록된 8~12자리 번호를 입력해 주세요.")
        return number
    if country not in COUNTRIES:
        raise DomainValidationError("SOLAPI 발송 국가를 확인해 주세요.")
    if value.startswith("+"):
        prefix = COUNTRIES[country]
        if not number.startswith(prefix):
            raise DomainValidationError("수신번호의 국가번호와 대상자 국가가 다릅니다.")
        number = number[len(prefix):]
        if country == "KR" and number.startswith("10"):
            number = "0" + number
    if country == "KR" and not re.fullmatch(r"01[0-9]{8,9}", number):
        raise DomainValidationError("수신 휴대전화 번호는 010 등으로 시작하는 전체 번호를 입력해 주세요.")
    if not 8 <= len(number) <= 15:
        raise DomainValidationError("수신번호의 자릿수를 확인해 주세요.")
    return number


def render_text(source: str, values: dict[str, str]) -> str:
    def replace(match):
        key = match.group(1).strip()
        if key not in values:
            raise DomainValidationError("지원하지 않는 메시지 변수입니다: " + key)
        return values[key]
    return re.sub(r"\{\{([^{}]+)\}\}", replace, source)


def chosen_channels(plan, recipient, providers):
    available = [channel for channel in plan.channels if channel in recipient.channels]
    if plan.schedule.strategy == "PRIORITY_FALLBACK" and available:
        ordered = [channel for channel in plan.schedule.priority if channel in available]
        ready = [channel for channel in ordered if providers[channel.value.lower()].enabled]
        return [ready[0] if ready else ordered[0]]
    return available


def render_jobs(settings, public, plan, providers, *, deployment_id: str, verify_templates: bool = False):
    selected = plan.delivery_recipients()
    if not selected:
        raise DomainValidationError("발송할 대상자를 한 명 이상 선택해 주세요.")
    templates = {}
    pf_id = plan.delivery_options.kakao_pf_id or settings.solapi_kakao_pf_id
    if verify_templates and DeliveryChannel.KAKAO in plan.channels and providers["kakao"].enabled:
        templates = {item["templateId"]: item for item in SolapiClient(settings).templates(pf_id)}
    jobs = []
    destinations = set()
    for recipient in selected:
        if recipient.preferred_language not in public.supported_locales:
            raise DomainValidationError("대상자의 언어가 현재 확정 버전에 포함되지 않았습니다.")
        audience = resolve_audience(public, recipient.audience_code)
        query = {"lang": recipient.preferred_language}
        if audience:
            query["audience"] = audience
        # Encode query values once; keep the full clickable URL literal in UTF-8 JSON.
        url = settings.base_url.rstrip("/") + "/s/" + public.slug + "?" + urlencode(query)
        title = public.translations.get(recipient.preferred_language)
        title = title.title if title and title.title else public.title
        values = {"name": recipient.name, "surveyTitle": title, "surveyUrl": url,
                  "closingDate": public.settings.closes_at.strftime("%Y-%m-%d") if public.settings.closes_at else "별도 안내 시까지"}
        messages = plan.messages_by_language.get(recipient.preferred_language)
        if messages is None:
            raise DomainValidationError("선택한 대상자의 언어별 안내문을 작성해 주세요.")
        for channel in chosen_channels(plan, recipient, providers):
            code = channel.value
            provider = providers[code.lower()]
            source = getattr(messages, {"EMAIL": "email_body", "SMS": "sms_body", "KAKAO": "kakao_body", "FAX": "fax_body"}[code])
            text = render_text(source, values)
            payload = None
            message_type, message_bytes = None, None
            destination = getattr(recipient, CONTACT_FIELDS[code]) or ""
            if provider.enabled and provider.provider_code == "solapi" and code in {"SMS", "KAKAO"}:
                to = phone_number(destination, recipient.country_code)
                endpoint = (code, recipient.country_code, to)
                if endpoint in destinations:
                    raise DomainValidationError("선택한 대상자의 수신번호가 중복됩니다. 중복 행을 정리해 주세요.")
                destinations.add(endpoint)
                payload = {"to": to, "country": COUNTRIES[recipient.country_code]}
                if code == "SMS":
                    sender = plan.delivery_options.sender_number or settings.solapi_default_sender
                    payload.update({"from": phone_number(sender, sender=True), "text": text, "autoTypeDetect": True})
                    try:
                        size = len(text.encode("euc-kr"))
                    except UnicodeEncodeError:
                        raise DomainValidationError("문자에 지원되지 않는 문자가 있습니다. 이모지 등을 제거해 주세요.") from None
                    if size > 2000:
                        raise DomainValidationError("치환된 문자 안내문은 2,000바이트 이하여야 합니다.")
                    if recipient.country_code == "KR":
                        # Count after replacement: a survey URL can move SMS to LMS.
                        message_type, message_bytes = ("SMS" if size <= 90 else "LMS"), size
                        payload.update({"type": message_type, "autoTypeDetect": False})
                else:
                    if recipient.country_code != "KR":
                        raise DomainValidationError("알림톡 대상자는 대한민국 휴대전화 번호를 사용해 주세요.")
                    if not pf_id or not messages.kakao_template_id:
                        raise DomainValidationError("카카오 채널과 승인된 알림톡 템플릿을 선택해 주세요.")
                    if verify_templates:
                        approved = templates.get(messages.kakao_template_id)
                        if not approved or approved.get("content") != messages.kakao_body or (approved.get("buttons") or []) != messages.kakao_buttons:
                            raise DomainValidationError("승인된 알림톡 템플릿이 변경되었습니다. 다시 불러와 선택해 주세요.")
                        if approved.get("messageType") not in {None, "BA"} or approved.get("emphasizeType") not in {None, "NONE"}:
                            raise DomainValidationError("현재는 기본형 알림톡 템플릿을 지원합니다. 기본형 템플릿을 선택해 주세요.")
                    variables = {key if key.startswith("#{") else "#{" + key + "}": render_text(value, values) for key, value in messages.kakao_variables.items()}
                    required = set(re.findall(r"#\{[^{}]+\}", source + str(messages.kakao_buttons)))
                    if required - set(variables) or any(not value.strip() for value in variables.values()):
                        raise DomainValidationError("알림톡 변수에 대상자 항목 또는 고정 문구를 모두 연결해 주세요.")
                    for key, value in variables.items():
                        text = text.replace(key, value)
                    if len(text) > 1000:
                        raise DomainValidationError("치환된 알림톡은 1,000자 이하여야 합니다.")
                    buttons = []
                    for button in messages.kakao_buttons:
                        buttons.append({key: render_text(str(value), values) if isinstance(value, str) else value
                                        for key, value in button.items() if key in {"buttonName", "buttonType", "linkMo", "linkPc", "linkAnd", "linkIos", "chatExtra", "targetOut"} and value is not None})
                    for button in buttons:
                        for key, value in button.items():
                            if isinstance(value, str):
                                for variable, replacement in variables.items():
                                    value = value.replace(variable, replacement)
                                button[key] = value
                    payload.update({"type": "ATA", "text": text, "kakaoOptions": {"pfId": pf_id,
                                    "templateId": messages.kakao_template_id, "variables": variables,
                                    "disableSms": True, "buttons": buttons}})
            jobs.append({"recipientId": recipient.id, "name": recipient.name, "channel": code,
                         "destination": mask_contact(code, destination), "language": recipient.preferred_language,
                         "audienceCode": audience, "publicUrl": url, "text": text,
                          "subject": render_text(messages.email_subject if code == "EMAIL" else messages.fax_title, values) if code in {"EMAIL", "FAX"} else None,
                         "provider": provider.provider_code, "enabled": provider.enabled,
                         "messageType": message_type, "messageBytes": message_bytes,
                         "sender": (payload or {}).get("from") or (pf_id if code == "KAKAO" else (plan.delivery_options.sender_number or settings.solapi_default_sender) if code == "SMS" else None),
                         "buttons": (payload or {}).get("kakaoOptions", {}).get("buttons", []),
                         "payload": payload})
    return jobs


def preview_result(jobs, *, offset=0, recipient_id=None):
    """Filter only after tenant ownership and the entire send plan are validated."""
    items = [job for job in jobs if recipient_id is None or job["recipientId"] == recipient_id]
    return {"total": len(jobs), "filteredTotal": len(items), "offset": offset,
            "items": [{key: value for key, value in job.items() if key != "payload"}
                      for job in items[offset:offset + 25]]}


def outcome_metadata(outcome, attempted_at):
    return {"statusCode": outcome.status_code, "message": outcome.message, "groupId": outcome.group_id,
            "attemptedAt": attempted_at.isoformat(), "receivedAt": datetime.now(timezone.utc).isoformat()}


def send_result(rows) -> DeliverySendResult:
    items = []
    for row in rows:
        status = str(row["status_code"])
        if status == "SENDING":
            status = "ACCEPTED" if row.get("provider_message_id") and not row.get("last_error_code") else "UNKNOWN"
        template = row.get("message_template_json") or {}
        if hasattr(template, "read"):
            template = template.read()
        if isinstance(template, str):
            template = json.loads(template)
        detail = template.get("deliveryResult") or {}
        items.append(DeliverySendItem(delivery_id=str(row["delivery_id"]), channel=row["channel_code"], status=status,
                                      provider_message_id=row.get("provider_message_id"), error_code=row.get("last_error_code"),
                                      status_code=detail.get("statusCode"), message=detail.get("message"), group_id=detail.get("groupId"),
                                      created_at=row.get("created_at"), updated_at=row.get("updated_at"), attempted_at=detail.get("attemptedAt")))
    return DeliverySendResult(items=items, **{name: sum(item.status == name.upper() for item in items)
                                           for name in ("accepted", "failed", "unknown", "queued", "disabled")})
