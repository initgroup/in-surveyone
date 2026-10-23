# INIT 설문/업무시스템 — 아우토반 그룹웨어 HTTPS API 기반 메일·문자 발송 기능 구현 프롬프트

## 0. 역할

너는 현재 Visual Studio Code에서 열려 있는 INIT 웹 프로젝트를 직접 분석하고 수정하는 시니어 백엔드/풀스택 개발자다.

이번 작업의 목적은 **회사에서 사용 중인 아우토반(Autobahn) 그룹웨어의 메일 발송 및 문자(SMS/LMS) 발송 기능을 HTTPS API로 호출할 수 있도록 공통 알림(Notification) 모듈을 구현하는 것**이다.

현재 웹 서비스가 Render 등 외부 클라우드에서 운영될 수 있으므로, SMTP 25/465/587 포트를 직접 사용하는 방식을 기본안으로 사용하지 않는다.

기본 구조는 다음과 같다.

```text
[웹 애플리케이션 / 설문 시스템]
          |
          | HTTPS / 443
          v
[INIT Notification Service / Adapter]
          |
          | HTTPS API
          v
[회사 아우토반 그룹웨어]
      |              |
      v              v
 [메일 발송]      [SMS/LMS 발송]
      |              |
      v              v
   수신자          수신자
```

---

# 1. 매우 중요한 원칙

## 1.1 아우토반 API 사양을 절대로 임의로 만들지 말 것

현재 다음 정보는 아직 확정되지 않았을 수 있다.

- API Base URL
- 메일 발송 Endpoint
- SMS/LMS 발송 Endpoint
- 인증 방식
- API Key
- Bearer Token
- OAuth
- 세션/쿠키 기반 인증
- 사내 SSO 연동 여부
- 요청 JSON/XML/form-data 규격
- 응답 코드
- 발송 결과 ID
- 발신 메일 주소
- 발신 전화번호
- IP 허용 목록
- VPN/사내망 접근 제한
- HTTPS 인증서 정책

따라서 코드에 임의의 실제 URL이나 필드명을 확정하여 넣지 않는다.

API 문서 또는 실제 호출 사양을 찾을 수 없다면:

1. 아우토반 연동 Adapter 인터페이스를 먼저 구현한다.
2. API 관련 값은 환경변수 및 설정 파일로 분리한다.
3. Mock Provider를 만들어 로컬 개발이 가능하게 한다.
4. 실제 API 필드 매핑 부분을 한 파일에 집중시킨다.
5. `TODO: AUTOBAN_API_SPEC_REQUIRED`와 같이 명확하게 표시한다.
6. 사용자가 실제 API 규격을 제공하면 최소 수정으로 연결될 구조로 만든다.

---

# 2. 작업 시작 전에 현재 프로젝트를 먼저 분석할 것

바로 코드를 수정하지 말고 다음을 먼저 확인한다.

## 2.1 프로젝트 기술 스택

확인할 항목:

- Python / FastAPI 여부
- Flask / Django 여부
- Node.js / Express 여부
- React / Next.js 여부
- DB 종류
- Oracle DB 사용 여부
- SQLAlchemy 사용 여부
- 기존 DB 접근 모듈
- 기존 환경변수 관리 방식
- `.env`
- `settings.py`
- `config.py`
- Pydantic Settings
- 기존 API Router 구조
- Service / Repository 구조
- 인증/권한 구조
- 로깅 구조
- 배포 환경
- Render 설정
- requirements.txt / pyproject.toml / package.json
- 테스트 구조

분석 후 현재 프로젝트 스타일을 최대한 유지한다.

불필요하게 새로운 프레임워크나 거대한 라이브러리를 추가하지 않는다.

---

# 3. 구현 목표

최종적으로 애플리케이션 내부에서 아래처럼 사용할 수 있게 한다.

Python 예시:

```python
result = await notification_service.send_email(
    to=["user@example.com"],
    subject="설문조사 참여 요청",
    html_body="<p>설문에 참여해주세요.</p>",
    text_body="설문에 참여해주세요.",
)

result = await notification_service.send_sms(
    to="01012345678",
    message="설문 참여 요청: https://example.com/s/ABC123"
)
```

또는 템플릿 기반:

```python
result = await notification_service.send_email_template(
    template_code="SURVEY_INVITE",
    to=["user@example.com"],
    variables={
        "name": "홍길동",
        "survey_title": "2026년 만족도 조사",
        "survey_url": "https://example.com/s/ABC123"
    }
)
```

SMS:

```python
result = await notification_service.send_sms_template(
    template_code="SURVEY_INVITE_SMS",
    to="01012345678",
    variables={
        "name": "홍길동",
        "survey_url": "https://example.com/s/ABC123"
    }
)
```

---

# 4. 권장 아키텍처

현재 프로젝트 구조에 맞게 이름은 변경할 수 있지만 개념적으로 다음과 같이 구성한다.

```text
app/
├─ api/
│  └─ notification_routes.py
│
├─ services/
│  └─ notification_service.py
│
├─ integrations/
│  └─ autobahn/
│     ├─ client.py
│     ├─ provider.py
│     ├─ schemas.py
│     ├─ auth.py
│     └─ exceptions.py
│
├─ repositories/
│  └─ notification_repository.py
│
├─ models/
│  └─ notification_log.py
│
├─ schemas/
│  └─ notification.py
│
├─ templates/
│  └─ notifications/
│     ├─ email/
│     └─ sms/
│
└─ core/
   └─ config.py
```

현재 프로젝트가 이미 다른 디렉터리 구조를 사용한다면 기존 규칙을 따른다.

---

# 5. Provider 추상화

아우토반 API에 애플리케이션 전체가 직접 의존하지 않도록 한다.

예:

```python
from typing import Protocol

class NotificationProvider(Protocol):

    async def send_email(self, request):
        ...

    async def send_sms(self, request):
        ...
```

구현체:

```text
NotificationProvider
        |
        +-- AutobahnNotificationProvider
        |
        +-- MockNotificationProvider
```

향후 필요하면 다음 Provider를 추가할 수 있도록 한다.

```text
AWS SES
SendGrid
Resend
Naver Cloud SENS
Aligo
사내 자체 Notification Gateway
```

즉, 설문 시스템의 업무 로직은 아우토반 API의 세부 규격을 알 필요가 없어야 한다.

---

# 6. HTTP Client

Python/FastAPI 프로젝트라면 기존 라이브러리가 없다면 `httpx`를 우선 검토한다.

예:

```python
async with httpx.AsyncClient(
    base_url=settings.AUTOBAN_BASE_URL,
    timeout=settings.AUTOBAN_TIMEOUT
) as client:
    response = await client.post(...)
```

단, 기존 프로젝트가 `requests`, `aiohttp` 등을 일관되게 사용한다면 기존 방식을 우선한다.

---

# 7. 환경변수

비밀번호, API Key, Token, 내부 URL을 소스에 하드코딩하지 않는다.

예:

```env
NOTIFICATION_PROVIDER=autobahn

AUTOBAN_BASE_URL=
AUTOBAN_MAIL_ENDPOINT=
AUTOBAN_SMS_ENDPOINT=

AUTOBAN_AUTH_TYPE=
AUTOBAN_API_KEY=
AUTOBAN_API_KEY_HEADER=
AUTOBAN_BEARER_TOKEN=

AUTOBAN_CONNECT_TIMEOUT=5
AUTOBAN_READ_TIMEOUT=20

AUTOBAN_MAIL_FROM=
AUTOBAN_SMS_FROM=

NOTIFICATION_MAX_RETRY=3
NOTIFICATION_MOCK_MODE=false
```

주의:

- `.env` 실제 값은 Git에 commit하지 않는다.
- `.env.example`에는 키 이름만 작성한다.
- 운영 Secret은 Render Environment Variables 등 배포 환경에서 관리한다.

---

# 8. 아우토반 인증 모듈

인증 방식을 하나로 하드코딩하지 않는다.

예를 들어 다음 방식을 지원 가능한 구조로 만든다.

```text
none
api_key
bearer
basic
custom_header
```

설정값:

```env
AUTOBAN_AUTH_TYPE=api_key
```

또는

```env
AUTOBAN_AUTH_TYPE=bearer
```

실제 API 사양 확인 후 필요한 방식만 활성화한다.

---

# 9. 메일 요청 모델

애플리케이션 내부 표준 모델은 아우토반 API 사양과 분리한다.

예:

```python
class EmailRequest:
    to: list[str]
    cc: list[str] = []
    bcc: list[str] = []
    subject: str
    text_body: str | None
    html_body: str | None
    reply_to: str | None
```

첨부파일이 실제 업무에서 필요하면 다음 단계에서 확장할 수 있도록 한다.

```python
attachments: list[Attachment]
```

---

# 10. SMS/LMS 요청 모델

```python
class SmsRequest:
    to: str
    message: str
    sender: str | None
```

아우토반이 SMS/LMS를 구분한다면 아래 구조를 검토한다.

```python
message_type: Literal["SMS", "LMS"]
```

권장 정책:

```text
90 bytes 이하 → SMS
90 bytes 초과 → LMS
```

단, 실제 전환 기준은 아우토반 API의 문자 인코딩 및 요금 정책을 확인하여 적용한다.

임의로 확정하지 않는다.

---

# 11. 전화번호 정규화

입력값:

```text
010-1234-5678
010 1234 5678
01012345678
```

등을 내부적으로 정규화한다.

예:

```text
01012345678
```

유효하지 않은 번호는 API 호출 전에 차단한다.

---

# 12. 이메일 주소 Validation

API 호출 전에 최소한 다음을 검증한다.

- 이메일 형식
- 빈 문자열
- 중복 수신자
- 최대 수신자 개수
- 제목 길이
- 본문 존재 여부

기존 Pydantic 등의 Validation 체계가 있다면 그것을 사용한다.

---

# 13. 응답 표준화

아우토반의 실제 응답값을 애플리케이션 전역에 그대로 노출하지 않는다.

내부 공통 결과 모델을 만든다.

예:

```python
class NotificationResult:
    success: bool
    provider: str
    channel: str
    provider_message_id: str | None
    status_code: str | None
    message: str | None
```

예:

```json
{
  "success": true,
  "provider": "autobahn",
  "channel": "EMAIL",
  "provider_message_id": "ABC123",
  "status_code": "SUCCESS",
  "message": "메일 발송 요청 완료"
}
```

---

# 14. 발송 이력

가능하면 발송 요청/결과를 DB에 기록한다.

기존 DB가 Oracle이라면 현재 프로젝트의 Oracle 접근 방식을 그대로 사용한다.

권장 필드:

```text
ID
CHANNEL
PROVIDER
TEMPLATE_CODE

RECIPIENT
SUBJECT

REQUEST_STATUS
PROVIDER_STATUS
PROVIDER_MESSAGE_ID

RETRY_COUNT

REQUESTED_AT
SENT_AT
FAILED_AT

ERROR_CODE
ERROR_MESSAGE

CREATED_BY
```

중요:

메일 본문 전체나 개인정보를 로그에 무조건 저장하지 않는다.

필요하다면:

```text
본문 요약
템플릿 코드
변수
수신자 마스킹
```

중심으로 저장한다.

---

# 15. 개인정보 보호

일반 로그에는 다음처럼 마스킹한다.

```text
hong***@example.com
010****5678
```

다음을 로그에 출력하지 않는다.

```text
API KEY
Bearer Token
Password
전체 Authorization Header
개인정보가 포함된 전체 request body
```

---

# 16. 재시도 정책

다음 오류는 제한적으로 재시도를 고려한다.

```text
HTTP 429
HTTP 500
HTTP 502
HTTP 503
HTTP 504
network timeout
temporary connection error
```

다음 오류는 기본적으로 즉시 실패한다.

```text
HTTP 400
HTTP 401
HTTP 403
잘못된 수신자
Validation Error
```

권장:

```text
1차: 즉시
2차: 1초 후
3차: 3초 후
```

또는 exponential backoff.

단, 동일 메시지가 중복 발송되지 않도록 주의한다.

---

# 17. 중복 발송 방지

설문 초대 메일/문자가 중복 발송되는 문제를 방지할 수 있도록 `idempotency_key` 개념을 검토한다.

예:

```text
SURVEY_INVITE:{survey_id}:{respondent_id}:EMAIL
```

API가 자체 Idempotency Key를 지원한다면 사용한다.

지원하지 않으면 DB 로그를 통해 단시간 중복 호출을 방지한다.

---

# 18. 동기/비동기 처리

HTTP 요청 도중 수백/수천 명에게 메일을 한꺼번에 발송하지 않는다.

단건 발송:

```text
Web Request
   ↓
Notification Service
   ↓
Autobahn
```

다량 발송:

```text
Web Request
   ↓
발송 작업 등록
   ↓
Queue / Worker
   ↓
Autobahn API
```

현재 프로젝트에 Queue가 없다면 처음부터 Redis/Celery 등을 무조건 도입하지 않는다.

1단계에서는:

```text
DB Outbox / BackgroundTasks / 기존 Scheduler
```

등 현재 프로젝트에 가장 가벼운 방식으로 구현한다.

대량 발송 규모가 커질 때 Queue로 확장 가능한 구조를 만든다.

---

# 19. 설문 시스템 연동

아래 시나리오를 지원할 수 있도록 한다.

## 이메일

```text
설문 초대
설문 재참여 요청
미응답자 독촉
설문 완료 안내
관리자 알림
```

## 문자

```text
설문 초대
미응답 알림
마감 임박 알림
인증번호
중요 공지
```

---

# 20. 템플릿 시스템

메일 내용을 코드에 직접 박아 넣지 않는다.

예:

```text
templates/notifications/email/survey_invite.html
templates/notifications/email/survey_reminder.html

templates/notifications/sms/survey_invite.txt
templates/notifications/sms/survey_reminder.txt
```

템플릿 변수:

```text
{{ name }}
{{ survey_title }}
{{ survey_url }}
{{ deadline }}
{{ company_name }}
```

현재 프로젝트가 Jinja2를 이미 사용하면 Jinja2를 활용한다.

그렇지 않다면 새로운 대형 템플릿 엔진을 추가하기 전에 가장 간단한 방식을 선택한다.

---

# 21. 보안

외부에서 다음 API가 임의 호출되지 않도록 한다.

예:

```text
POST /api/notifications/email
POST /api/notifications/sms
```

반드시 현재 프로젝트 인증/권한 체계를 적용한다.

가능하면 일반 사용자가 임의 주소로 메일/문자를 보내는 범용 Relay API가 되지 않게 한다.

예:

```text
ADMIN
SURVEY_MANAGER
SYSTEM
```

등 허용된 권한만 사용한다.

---

# 22. API 예시

내부 API가 필요한 경우 다음처럼 설계할 수 있다.

## Email

```http
POST /api/v1/notifications/email
```

```json
{
  "template_code": "SURVEY_INVITE",
  "to": ["user@example.com"],
  "variables": {
    "name": "홍길동",
    "survey_title": "2026 만족도 조사",
    "survey_url": "https://example.com/s/ABC123"
  }
}
```

## SMS

```http
POST /api/v1/notifications/sms
```

```json
{
  "template_code": "SURVEY_INVITE_SMS",
  "to": "01012345678",
  "variables": {
    "name": "홍길동",
    "survey_url": "https://example.com/s/ABC123"
  }
}
```

---

# 23. Mock Mode

실제 아우토반 API 정보가 없어도 개발과 UI 테스트가 가능해야 한다.

환경변수:

```env
NOTIFICATION_MOCK_MODE=true
```

Mock Mode에서는 실제 발송하지 않고:

```json
{
  "success": true,
  "provider": "mock",
  "channel": "EMAIL",
  "provider_message_id": "MOCK-123456"
}
```

형태의 결과를 반환한다.

로그에는:

```text
[MOCK EMAIL]
recipient=hong***@example.com
template=SURVEY_INVITE
```

정도만 남긴다.

---

# 24. Health Check

가능하다면 관리용 연결 상태 확인 기능을 구현한다.

예:

```http
GET /api/v1/admin/notifications/status
```

응답 예:

```json
{
  "provider": "autobahn",
  "configured": true,
  "mail_enabled": true,
  "sms_enabled": true
}
```

주의:

Health Check 때문에 실제 문자나 메일을 발송해서는 안 된다.

아우토반 API가 ping/status API를 지원하는 경우에만 연결 확인을 수행한다.

---

# 25. API 사양 조사 포인트

아우토반 API 문서 또는 기존 사내 소스가 제공되면 다음 키워드를 우선 검색한다.

```text
mail
email
sendMail
sendEmail
smtp
message

sms
lms
mms
sendSms
sendMessage

api
rest
openapi
swagger
webservice

token
apikey
authorization
bearer
oauth
sso
```

기존 사내 프로그램에서 아우토반을 호출하는 코드가 있다면 그것을 가장 신뢰할 수 있는 참고 자료로 사용한다.

브라우저 Network 탭 캡처나 API 문서가 제공되면 그 내용을 기반으로 Adapter를 완성한다.

---

# 26. 아우토반 Adapter의 책임

아우토반 관련 변환은 반드시 Adapter 내부에 한정한다.

예:

```python
def _to_autobahn_email_payload(request: EmailRequest) -> dict:
    ...
```

```python
def _parse_autobahn_response(response) -> NotificationResult:
    ...
```

따라서 나중에 아우토반 API 필드명이 다음처럼 달라도:

```text
receiver
recvEmail
toAddr
receiverMail
```

애플리케이션의 `EmailRequest.to`는 바뀌지 않아야 한다.

---

# 27. 오류 모델

다음과 같이 예외를 구분한다.

```text
NotificationError
├─ NotificationConfigurationError
├─ NotificationAuthenticationError
├─ NotificationValidationError
├─ NotificationProviderError
├─ NotificationTimeoutError
└─ NotificationRateLimitError
```

사용자에게 API Key나 내부 시스템 오류 메시지를 그대로 노출하지 않는다.

---

# 28. 테스트

최소 다음 테스트를 추가한다.

## Unit Test

```text
이메일 Validation
전화번호 정규화
전화번호 Validation
템플릿 Rendering
아우토반 Payload Mapping
응답 Mapping
에러 Mapping
Retry 판단
Masking
Idempotency
```

## Mock Integration Test

```text
메일 정상 요청
문자 정상 요청
인증 실패
Timeout
HTTP 429
HTTP 500
잘못된 수신자
```

실제 회사 사용자에게 테스트 메일/문자를 자동으로 보내지 않는다.

실제 발송 테스트는 명시적으로 허용된 테스트 계정/번호가 있을 때만 수행한다.

---

# 29. 관리 화면이 이미 있다면

현재 프로젝트에 관리자 화면이 있다면 다음 기능의 추가를 검토한다.

```text
알림 발송 이력
EMAIL / SMS 구분
수신자 마스킹
발송 시간
성공/실패
재시도 횟수
오류 요약
```

선택적으로:

```text
재발송
```

기능을 넣을 수 있으나 중복 발송 위험이 있으므로 권한 및 확인 절차를 둔다.

---

# 30. 대량 발송 시 주의

아우토반 API의 다음 제한을 반드시 확인한다.

```text
초당 호출 제한
분당 호출 제한
일 발송 한도
1회 최대 수신자
메일 최대 크기
SMS/LMS 길이
발신번호 제한
발신메일 제한
외부 수신자 제한
IP 화이트리스트
```

사양을 확인하기 전 임의의 병렬 수치를 설정하지 않는다.

---

# 31. Render 환경 고려

현재 서비스가 Render에서 운영되는 경우:

- 아우토반 API가 인터넷에서 HTTPS로 접근 가능한지 확인한다.
- 사내망에서만 접근 가능한 주소라면 Render에서 직접 호출할 수 없다.
- IP White List가 필요한 경우 Render outbound IP 정책을 확인해야 한다.
- VPN 또는 사내 Proxy가 필요한 경우 별도의 Gateway가 필요하다.
- SSL 인증서를 검증한다.
- `verify=False` 같은 TLS 검증 무시는 운영 코드에 넣지 않는다.

만약 아우토반이 사내망에서만 접근 가능하면 구조를 다음처럼 전환할 수 있도록 설계한다.

```text
Render
   |
   | HTTPS
   v
[회사 DMZ / Notification Gateway]
   |
   v
[아우토반 그룹웨어]
```

---

# 32. 절대 하지 말아야 할 것

다음을 하지 않는다.

1. 실제 아우토반 Endpoint를 추측해서 구현
2. API Key 하드코딩
3. Git에 `.env` 실제 값 저장
4. Authorization Header 전체 로그 출력
5. 수신자 개인정보 전체 로그 출력
6. API 오류 발생 시 무한 재시도
7. POST 요청에 무조건 재시도하여 중복 발송
8. 웹 요청 한 번에 수천 건 동기 발송
9. TLS 인증서 검증 비활성화
10. 기존 프로젝트 구조를 무시하고 전체를 재작성
11. 기존 기능이나 URL을 불필요하게 변경
12. 실제 API 정보가 없는데 구현 완료라고 보고

---

# 33. 구현 단계

다음 순서로 작업한다.

## STEP 1
현재 프로젝트 구조를 분석한다.

## STEP 2
기존 이메일/SMS 관련 코드가 있는지 검색한다.

검색어:

```text
mail
email
smtp
sms
message
notification
send
autobahn
groupware
```

## STEP 3
환경변수/설정 구조를 확인한다.

## STEP 4
Notification Provider 인터페이스를 만든다.

## STEP 5
Mock Provider를 구현한다.

## STEP 6
Autobahn Provider 골격을 구현한다.

## STEP 7
Email/SMS 내부 표준 Request/Result 모델을 구현한다.

## STEP 8
템플릿 기능을 구현한다.

## STEP 9
발송 로그 저장 기능을 구현한다.

## STEP 10
기존 설문/업무 흐름에 필요한 Service API를 연결한다.

## STEP 11
Unit Test 및 Mock Integration Test를 실행한다.

## STEP 12
실제 아우토반 API 정보가 없는 부분을 목록화한다.

## STEP 13
실제 API 문서가 있으면 Payload/Response Mapping을 완료한다.

## STEP 14
Build / Lint / Test를 모두 수행한다.

---

# 34. 작업 완료 후 반드시 보고할 내용

최종 답변은 다음 형식으로 작성한다.

## 1. 현재 프로젝트 분석

```text
Framework:
Backend:
Database:
Config:
Deployment:
```

## 2. 추가/수정 파일

파일별로:

```text
파일명
역할
주요 변경
```

## 3. 구현된 기능

```text
메일 발송
SMS 발송
템플릿
Mock Mode
발송 로그
재시도
Validation
Masking
```

각 기능의 완료 여부를 표시한다.

## 4. 아우토반 실제 연동을 위해 추가로 필요한 정보

정확하게 목록화한다.

예:

```text
MAIL API URL
SMS API URL
인증 방식
Request 샘플
Response 샘플
발신 메일주소
발신번호
IP 제한 여부
```

## 5. 환경변수

`.env.example`에 추가한 변수 목록을 보여준다.

## 6. 테스트 결과

```text
Unit:
Integration:
Build:
Lint:
```

## 7. 남은 위험요소

예:

```text
사내망 접근 여부 미확인
IP White List 미확인
SMS 발신번호 정책 미확인
```

---

# 35. 사용자에게 질문해야 하는 시점

현재 프로젝트 분석과 Mock 기반 구조 구현까지는 가능한 범위에서 먼저 진행한다.

그러나 실제 아우토반 호출을 활성화하기 전에는 다음 정보가 없으면 임의로 추정하지 말고 사용자에게 요청한다.

```text
1. 아우토반 API 문서 또는 Swagger/OpenAPI 주소
2. 메일 발송 API 호출 예제
3. SMS/LMS 발송 API 호출 예제
4. 인증 방식
5. 테스트용 계정 또는 Token
6. 테스트용 이메일 주소
7. 테스트용 휴대전화 번호
8. Render 서버에서 아우토반 주소 접근 가능 여부
9. IP White List 필요 여부
```

---

# 36. 최종 목표

최종 구조는 다음과 같아야 한다.

```text
               ┌─────────────────┐
               │ Survey / Web App│
               └────────┬────────┘
                        │
                        v
              ┌────────────────────┐
              │ NotificationService│
              └─────────┬──────────┘
                        │
              ┌─────────▼──────────┐
              │ NotificationProvider│
              └─────────┬──────────┘
                        │
           ┌────────────┴────────────┐
           │                         │
           v                         v
┌────────────────────┐   ┌────────────────────┐
│ Autobahn Provider  │   │   Mock Provider    │
└─────────┬──────────┘   └────────────────────┘
          │
          │ HTTPS / 443
          v
┌──────────────────────────────┐
│ INIT Autobahn Groupware API  │
├──────────────────────────────┤
│ Email API                    │
│ SMS/LMS API                  │
└─────────────┬────────────────┘
              │
       ┌──────┴──────┐
       v             v
    Email           SMS
```

핵심 원칙은:

> **웹 애플리케이션은 아우토반 자체 규격이 아니라 NotificationService에만 의존해야 한다.**

그래야 향후 아우토반 API가 변경되거나 다른 메일/SMS 서비스로 교체하더라도 전체 시스템을 수정할 필요가 없다.

---

# 37. 지금 바로 실행

이 문서를 읽은 후 다음과 같이 작업을 시작한다.

1. 현재 저장소를 분석한다.
2. 기존 메일/SMS/Notification 관련 구현을 모두 찾는다.
3. 변경 계획과 대상 파일을 간단히 보고한다.
4. 치명적인 불확실성이 없다면 계획에서 멈추지 말고 실제 코드를 수정한다.
5. 아우토반 API 세부 규격이 없는 부분은 Provider Adapter 경계에 격리한다.
6. Mock Mode까지 동작하도록 완성한다.
7. 테스트를 수행한다.
8. 실제 아우토반 연동에 필요한 미확정 정보를 최종적으로 명확하게 보고한다.

**기존 기능을 최대한 보존하고, 최소 변경으로 확장 가능하고 안전한 공통 알림 구조를 구현하라.**



* 관리자로그인

initadmin / init2026!

* 메일, 카톡, 문자 발송
NHN Cloud Notification Hub

SOLAPI (솔라피) — 간편 연동형 : 카톡, 문자 발송
----------------------------------------------------------
const { SolapiMessageService } = require('solapi');
const messageService = new SolapiMessageService(
  "SOLAPI_API_KEY",
  "SOLAPI_API_SECRET"
);

messageService.send({
  'to': '01012345678',
  'from': '15771603',
  'text': '안녕하세요! SOLAPI 테스트 메시지입니다.'
});
----------------------------------------------------------



# 서버 실행
.\scripts\run-server.ps1

# GIT 배포
.\scripts\validate-source.ps1
.\scripts\git-publish-main.ps1

# 소스 백업
.\scripts\validate-source.ps1
.\scripts\backup-source.ps1 -Mode Working
.\scripts\backup-source.ps1 -Mode Git
