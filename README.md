# IN-SURVEYONE

IN-SURVEYONE은 인아이티가 독립적으로 개발·운영하는 멀티테넌트 온라인 설문 플랫폼입니다. 기관 회원은 템플릿 또는 문항 제작 도구로 설문을 만들고, 버전을 확정해 고유 URL로 배포하며, 이메일·문자·카카오 알림·QR·홈페이지 삽입 등으로 참여를 안내할 수 있습니다. 응답은 원자료와 재현 가능한 보고서로 관리합니다.

첨부된 기존 서비스 화면과 Google Forms는 기능 흐름을 이해하기 위한 참고 자료입니다. 화면이나 API를 복제하지 않으며 Google API에도 의존하지 않습니다. 이 저장소는 `initgroup-members`, `initgroup-homepage`, `data-editing-system` 등 다른 프로젝트의 파일이나 Python/JavaScript 모듈을 import하지 않는 독립 프로젝트입니다.

## 첫 실행

요구 환경은 Windows PowerShell 5.1 이상과 Python 3.12입니다.

```powershell
.\scripts\setup-venv.ps1
Copy-Item .env.example .env
.\scripts\run-server.ps1
```

로컬 주소는 `http://127.0.0.1:8300`입니다. VS Code에서 `Ctrl+Shift+B`를 누르면 기본 Build Task인 `IN-SURVEYONE: Run Server (8300)`이 실행되고, 프로젝트 `venv`가 활성화된 전용 터미널에 서버가 유지됩니다.

```powershell
.\scripts\validate-source.ps1
```

개발 도구가 필요 없는 운영용 환경만 만들 때는 `setup-venv.ps1 -ProductionOnly`를 사용합니다. `.env.example`에는 안전한 예시와 빈 자격정보만 있으며 실제 `.env`, Oracle 비밀번호, Wallet, 발송 사업자 키는 Git과 백업에서 제외됩니다.

## 현재 MVP 구현 범위

현재 소스는 회원가입·로그인, Oracle DB guest 계정 체험, 단계형 프로젝트 생성, 관리자 공용 템플릿, 문항/섹션·동적 문항·다국어 편집, 불변 버전 확정, 수신자별 다국어 배포 계획, `/s/{slug}` 모바일 응답, 원자료 조회·CSV, 기본형 집계·Excel/PDF 내보내기와 맞춤형 보고서 레이아웃 초안까지 한 흐름으로 실행할 수 있습니다.

- 이메일·문자·카카오·팩스 계획은 Oracle에 저장하며 현재 실행 API는 `QUEUED`/`DISABLED` 이력까지만 만듭니다. 실제 외부 전송 worker·adapter는 별도 운영 연동 대상입니다.
- M05001 기본형 보고서는 현재 조회한 기준일·응답 상태·배포 버전을 적용해 Excel 집계표와 A4 PDF를 생성합니다. 맞춤형 보고서 영구 저장은 아직 Beta/Demo입니다.
- Oracle 모드는 전역 lazy connection pool과 bind SQL repository를 사용합니다. 설정·연결·schema 검증이 실패하면 memory로 조용히 fallback하지 않고 오류를 명시합니다.

## 기술 구조

- Python 3.12, FastAPI, Uvicorn
- 외부 프런트엔드 프레임워크와 번들러를 필수 조건으로 두지 않는 Vanilla HTML/CSS/JavaScript SPA
- REST API와 정적 SPA를 동일 FastAPI 애플리케이션에서 제공
- runtime은 Oracle 저장소만 사용하며 `memory` 저장소는 자동화 테스트 fixture로만 유지
- Oracle thin mode 우선, 필요한 환경에서만 Instant Client/Wallet을 별도 설정
- 반응형 공개 설문, 키보드 접근성, reduced-motion, 모바일 safe area 기본 지원
- 새 설치용 DDL과 기존 설치 업그레이드용 ALT SQL을 함께 관리

```text
in-surveyone/
├─ main.py                    FastAPI 진입점
├─ backend/                   API, 도메인, 저장소, 서비스 계층
├─ database/                  독립 DDL/ALT SQL
├─ frontend/                  SPA HTML, CSS, JavaScript, 이미지
├─ tests/                     API·도메인·저장소 계약 테스트
├─ scripts/                   환경, 실행, 검증, 백업, 명시적 Git 배포
├─ .vscode/                   Python 3.12 및 Ctrl+Shift+B 작업
```

## 핵심 도메인과 URL

데이터 소유권과 배포 안정성은 다음 계층으로 고정합니다.

```text
Tenant(회원사)
└─ SurveyProject(설문 프로젝트)
   ├─ SurveyDraft(편집 중 작업본)
   ├─ SurveyVersion(확정된 불변 스냅샷)
   ├─ SurveyDeployment(공개 기간·활성 버전·스킨)
   ├─ Distribution/Recipient(발송과 수신자)
   ├─ Response(응답, 반드시 수집 당시 버전 참조)
   └─ ReportRun(보고서 실행 조건과 결과 스냅샷)
```

- 모든 업무 레코드는 `tenant_id` 경계를 가지며 서버가 현재 사용자 권한과 함께 검증합니다.
- 프로젝트 초안은 변경할 수 있지만, 배포된 `SurveyVersion`은 수정하지 않습니다. 변경 후 재배포하면 새 버전을 만듭니다.
- 공개 URL은 `/s/{slug}`를 기본 계약으로 사용합니다. 프로젝트 slug는 전체 서비스에서 유일하며 tenant 소유권은 서버가 별도 검증합니다. 예약어·대소문자·길이 규칙도 생성 시 검증합니다.
- 안정적인 공개 URL은 현재 활성 배포 버전을 가리키고, 각 응답은 실제 노출된 `survey_version_id`에 고정됩니다.
- 홈페이지 게시는 공개 URL 링크 또는 접근성 있는 `iframe` embed 코드로 지원합니다. 교차 출처와 frame 정책은 허용된 설문 origin 단위로 제한합니다.
- 공개·종료·일시정지·예약 상태, 시작/종료 시각, 중복 응답 정책, 실명/익명 정책을 배포 설정으로 분리합니다.

## 메뉴와 HTML 파일 규칙

`M` 뒤 두 자리는 대분류, 다음 세 자리는 중분류입니다. 표시 메뉴와 SPA 라우트는 아래 파일 ID를 단일 기준으로 사용합니다.

| 대분류 | 메뉴 ID / HTML | 메뉴 | 역할 |
|---|---|---|---|
| 01 | `M01001.html` | 대시보드 | 작성·진행·종료 현황, 최근 프로젝트, 빠른 시작 |
| 02 | `M02001.html` | 설문 프로젝트 | 목록과 STEP 01 프로젝트 기본정보 |
| 02 | `M02002.html` | 템플릿 선택(호환 경로) | 기존 링크를 STEP 04 설문 편집기의 템플릿 레이어로 연결 |
| 02 | `M02004.html` | 응답 UI 선택(내부 단계) | STEP 03 전체 스크롤 또는 한 문항씩 진행, 빠른 스킨 확인 |
| 02 | `M02005.html` | 스킨 설정(내부 단계) | STEP 02 프로젝트별 테마, 로고, 공개 문구와 응답 화면 미리보기 |
| 02 | `M02003.html` | 설문 제작기(내부 단계) | STEP 04 문항·동적 조건 편집, 템플릿 레이어 선택, 저장, 확정 |
| 03 | `M03001.html` | 배포·발송 | 확정 프로젝트 목록과 대상·채널·언어·검토 단계 |
| 04 | `M04001.html` | 원자료 응답 | 검색형 설문 선택, 섹션별 표시 열, 응답 상세, 복수응답 분석형·원본형 CSV |
| 05 | `M05001.html` | 기본형 보고서 | 빈도·교차·기술통계와 표준 차트 |
| 05 | `M05002.html` | 맞춤형 보고서 | 지표·필터·표·차트 배치와 보고서 실행 이력 |
| 06 | `M06001.html` | 시스템 환경 설정 | IN-SURVEYONE 작업 화면 기본값과 보안 값을 제외한 실행 환경 상태 |
| 07 | `M07001.html` | 공용 템플릿 관리 | 플랫폼 관리자의 템플릿 초안·불변 버전·공개 상태 관리 |
| 07 | `M07002.html` | 회원 관리 | 가입 회원 조회·비밀번호 초기화·이용 상태 관리 |

로그인·회원가입·계정 찾기와 공개 응답 화면은 업무 메뉴 ID와 별도의 인증/공개 라우트로 둡니다. 파일을 추가할 때 메뉴 정의, 접근 권한, 제목, breadcrumb, SPA route와 테스트를 함께 변경합니다.

프로젝트처럼 계속 증가하는 업무 데이터는 `select` 콤보박스에 전체 항목을 넣지 않습니다. 검색 가능한 카드·목록과 서버 페이징을 사용하고, 콤보박스는 상태·정렬·언어처럼 값의 수가 작고 안정적인 코드 목록에만 사용합니다. 설문 프로젝트 목록은 한 페이지 24개를 조회하며 검색·상태·정렬 조건도 Oracle 쿼리에 적용합니다. 새 프로젝트와 기존 프로젝트 모두 기본정보 → 스킨 설정 → 응답 UI → 설문 편집의 동일한 STEP 01~04 흐름을 표시합니다. 템플릿은 별도 단계가 아니라 STEP 04의 검색 가능한 카드형 레이어에서 선택하고, 적용 전 구조 교체 범위를 확인합니다.

## 설문 제작

### 템플릿 범주

초기 템플릿 카탈로그는 다음 범주를 포함하고 계속 확장할 수 있습니다.

- 사회조사·시민 인식조사
- 청렴도·이해충돌·조직문화 조사
- 사업체·산업·고용 조사
- 고객·민원·서비스 만족도 조사
- 교육·행사·프로그램 평가
- 내부 임직원·조직 진단
- 신청·등록·사전 수요조사
- 빈 설문과 기관 전용 맞춤 템플릿

템플릿을 선택하면 선택 시점의 불변 템플릿 버전을 소유 프로젝트의 편집 가능한 초안으로 복제합니다. 원본 템플릿의 후속 변경이 회원사의 기존 설문을 바꾸지 않습니다. 편집기에서 STEP 02로 돌아가는 동작만으로는 구조가 바뀌지 않으며, 다른 템플릿 또는 빈 설문을 명시적으로 적용하고 교체 경고를 확인해야 문항·동적 조건·섹션 분기·번역이 교체됩니다. 프로젝트 기본정보·스킨·응답 UI 방식은 유지됩니다.

플랫폼 관리 권한은 tenant의 `OWNER`/`MEMBER`/`GUEST` 역할과 분리된 `INIT$SVY_TB_USER.SYSTEM_ADMIN_YN`으로 판정합니다. 회원가입에서 플랫폼 관리자 가입을 선택한 경우에만 서버의 `INIT_ADMIN_KEY`와 제출된 인증키를 상수 시간 비교하고, 일치할 때 `SYSTEM_ADMIN_YN='Y'`로 계정을 생성합니다. 인증키 원문은 사용자·세션·DB에 저장하지 않습니다. 일반 회원가입은 기존처럼 tenant `OWNER`이며 플랫폼 관리 권한은 부여되지 않습니다.

### 문항 유형

- 객관식 단일선택
- 주관식 단답형·장문형
- 복수응답
- 드롭다운
- 5점·7점 등 척도
- 메트릭스/그리드
- 설명용 텍스트·이미지
- 숫자 입력과 단위·범위 검증
- 슬라이더
- 표 입력
- 반복표/반복 그룹
- 날짜·시간·연락처 등 확장 필드

제작기는 섹션, 복제, 버튼·drag 기반 순서 변경, 고정필수·고정선택·동적필수·동적선택 문항, AND/OR 복합 선행조건, 응답 검증, 섹션 분기, 미리보기와 자동저장을 제공합니다. 동적 조건은 표시 순번이 아니라 안정적인 문항·선택지 ID를 참조하며, 브라우저의 초기 로딩과 `input`/`change` 이벤트 및 서버 제출 검증에서 동일하게 평가합니다. 숨겨진 문항의 위조 응답은 서버가 거부합니다.

### 다국어 설계

- 한 설문의 기본 언어와 사용 언어 목록을 먼저 정하고 한국어(`ko`), 영어(`en`), 일본어(`ja`), 중국어(`zh`), 베트남어(`vi`), 필리핀어(`fil`) 외 BCP 47 언어 코드도 확장할 수 있습니다.
- 설문·섹션·문항·선택지의 안정적인 ID는 언어가 달라도 공유합니다. 번역은 ID와 field 단위로 분리하므로 번역 편집이 분기, 응답, 보고서 열을 바꾸지 않습니다.
- 응답 화면은 `?lang=` 요청값, 브라우저 언어, 설문 기본 언어 순으로 선택하고, 번역이 비어 있으면 기본 언어 원문으로 fallback합니다.
- 배포 버전에는 언어 목록과 번역 snapshot을 함께 고정합니다. 배포 이후 번역을 고치면 새 버전을 만들어 과거 응답의 표시 문구를 재현할 수 있게 합니다.
- 언어 선택기는 키보드와 스크린리더로 조작 가능해야 하며, RTL 언어는 언어 메타데이터의 방향 값을 따릅니다.

Oracle에서는 `INIT$SVY_TB_LANGUAGE`가 언어 카탈로그와 LTR/RTL 방향을, `INIT$SVY_TB_SURVEY_LANG`가 설문별 사용·기본 언어를, `INIT$SVY_TB_SURVEY_I18N`이 버전·resource ID·field별 번역을 보관합니다. `INIT$SVY_FN_I18N_TEXT`는 요청 언어 → 배포 버전에 고정된 기본 언어 → 원문 fallback 순서로 문구를 조회합니다.

## 페이지 도움말

관리 SPA의 각 `Mxxxxx` 페이지에는 현재 페이지의 목적, 시작 순서, 주의점과 관련 기능을 설명하는 `작성 요령` 도움말을 제공합니다. 도움말 버튼은 키보드로 열고 `Escape`로 닫을 수 있어야 하며 닫은 뒤 원래 버튼으로 포커스를 돌려보냅니다. 기본 안내는 프런트엔드 설정에 포함하고, Oracle의 `INIT$SVY_TB_PAGE_HELP`가 제공되면 현재 언어의 운영 도움말을 우선 적용할 수 있습니다.

## 모바일 우선 공개 설문

응답 화면은 관리자 SPA와 별도 shell을 사용하며 360px 모바일을 우선합니다.

- 한 열 흐름, 최소 44px 터치 영역, 모바일 키보드에 맞는 input mode
- 현재 섹션과 진행률, 명확한 이전/다음, safe-area를 반영한 하단 동작
- 네트워크 중단을 고려한 임시저장·재시도와 중복 제출 방지 idempotency key
- 오류 발생 시 첫 오류로 포커스 이동, 문항별 설명과 오류를 `aria-describedby`로 연결
- 스크린리더용 label/fieldset/legend, 키보드 완전 조작, 색상 외 상태 표현
- 공개 전 모바일·태블릿·데스크톱 미리보기와 접근성 점검

## 스킨

설문 스킨은 프로젝트/배포 단위로 적용합니다. 공통 semantic token 위에 로고, 대표색, 표면색, 글꼴, radius, 배경 이미지를 제한된 allowlist로 덮습니다. 관리자 UI의 브랜드와 응답자 스킨을 섞지 않으며, 대비 기준과 모바일 레이아웃을 깨는 값은 저장 단계에서 거부합니다. 사용자 입력 CSS나 실행 스크립트는 허용하지 않습니다.

## 배포와 안내 발송

배포 작업은 확정된 프로젝트만 대상으로 하며 대상자 → 복수 채널·예약 → 언어별 안내문 → 검토·실행 순으로 진행합니다. 수신자마다 국가, 선호 언어, 이메일·휴대전화·카카오 ID·팩스와 복수 허용 채널을 저장하고 `?lang=` 공개 URL을 언어별 안내문에 넣습니다.

- 수신자는 수집 목적과 보유 기간을 명확히 하고 tenant별로 격리합니다.
- 실제 발송은 명시적 provider 설정과 운영 승인이 있을 때만 활성화합니다.
- 메시지 템플릿, 예약 시각, provider message ID, 성공/실패/재시도 상태를 저장합니다.
- 로그에 연락처 본문이나 provider secret을 남기지 않고 화면에서도 마스킹합니다.
- guest는 외부 발송 대신 미리보기와 로컬 시뮬레이션만 사용할 수 있습니다.
- 연락처는 `SURVEYONE_DELIVERY_SECRET`으로 암호화하고 별도 HMAC 검색 hash를 저장합니다. 운영에서는 이 값을 안정적인 secret으로 반드시 지정하며 임의 회전하지 않습니다.

## 저장 모드

`.env`의 `DB_MODE`로 Oracle 연결 profile을 선택합니다. `initgroup-members`와 동일하게 `local`은 로컬 Oracle, `cloud`는 Oracle Cloud를 사용합니다. 두 모드 모두 회원·guest·설문·응답을 Oracle에 저장하며 runtime에서 memory repository로 전환하지 않습니다. memory repository는 자동화된 repository 계약 테스트 전용입니다.

| 모드 | 용도 | 특성 |
|---|---|---|
| `local` | 로컬 Oracle 개발 | `DB_USER_LOC`, `DB_PASSWORD_LOC`, host/port/service 사용 |
| `cloud` | Oracle Cloud 및 운영 서비스 | `DB_USER_CLD`, `DB_PASSWORD_CLD`, DSN/Wallet 사용 |

Oracle 연결이나 schema 검증이 실패하면 memory로 조용히 fallback하지 않고 시작을 중단합니다.

Oracle 설정은 공통 `DB_*` 키를 사용합니다. 비밀번호와 Wallet은 `.env` 또는 배포 플랫폼 secret으로만 주입하고 소스·DDL·로그·백업에 넣지 않습니다.

로그인 보안 설정도 공통 `INIT_SECRET_KEY`, `INIT_ALLOWED_ORIGINS`, `INIT_COOKIE_*`, `INIT_SESSION_*`를 사용합니다. 개발 환경에서 `INIT_SECRET_KEY`가 비어 있으면 `runtime/.session-secret`을 최초 한 번 생성하지만, 운영 환경은 Environment Group에 `INIT_SECRET_KEY`를 반드시 등록합니다.

설정 변경 뒤에는 8300 포트 프로세스를 완전히 재시작하고 `/api/health`의 `database.mode`가 `oracle`, schema readiness가 정상인지 확인합니다. 연결 정보·Wallet·필수 `INIT$SVY_` object가 잘못되면 시작을 중단하며 memory로 전환하지 않습니다.

### 운영 환경 필수 키

운영 Git 저장소에는 실제 `.env`나 Wallet을 커밋하지 않습니다. 배포 서비스의 Environment/Secret 설정에는 아래 값을 반드시 등록합니다.

| 키 | 운영 설정 |
|---|---|
| `SURVEYONE_ENV` | `production` |
| `SURVEYONE_BASE_URL` | 실제 HTTPS 서비스 주소 |
| `INIT_ALLOWED_ORIGINS` | 허용할 실제 HTTPS origin. 여러 개면 쉼표로 구분 |
| `INIT_SECRET_KEY` | 배포 서비스가 생성한 충분히 긴 무작위 secret |
| `INIT_ADMIN_KEY` | 플랫폼 관리자 가입 확인용 충분히 긴 무작위 secret. 가입 담당자에게만 별도 전달 |
| `INIT_COOKIE_SECURE` | `Y` |
| `INIT_COOKIE_SAMESITE` | 동일 도메인 서비스는 `lax` |
| `DB_MODE` | `cloud` |
| `DB_USER_CLD` | Oracle 전용 schema 계정 |
| `DB_PASSWORD_CLD` | Oracle 비밀번호 secret |
| `DB_DSN_CLD` | Wallet의 TNS alias 또는 Oracle DSN |
| `DB_ORACLE_MODE` | 기본 권장값 `thin` |
| `DB_WALLET_PATH` | 배포 secret files가 위치한 디렉터리. Render는 보통 `/etc/secrets` |
| `DB_WALLET_PASSWORD` | 해당 Wallet에서 요구할 때만 secret으로 설정 |

로컬 `http://127.0.0.1:8300` 실행에서는 `INIT_COOKIE_SECURE=false`를 사용합니다. Render와 같은 HTTPS 운영 환경에서는 `INIT_COOKIE_SECURE=true`가 필수이며, 애플리케이션은 운영 HTTP 또는 비보안 쿠키 설정을 시작 단계에서 거부합니다.

`SURVEYONE_LOAD_DOTENV=false`는 Render에서 로컬 파일 설정을 읽지 않도록 하는 선택적 방어 설정입니다. `DB_POOL_*`, timeout, rate limit, guest quota와 발송 provider 키는 `.env.example`의 기본값을 검토해 운영량에 맞게 선택적으로 조정합니다.

Wallet 파일(`tnsnames.ora`, `sqlnet.ora`, `cwallet.sso` 및 Wallet이 요구하는 인증 파일)은 Git이 아니라 배포 서비스의 Secret Files로 제공해야 합니다.

### QR 공개 주소

배포 센터의 QR은 임의 미리보기 패턴이 아니라 서버가 `qrcode` 라이브러리로 생성한 표준 SVG입니다. 오류 복원 수준 Q와 4모듈 여백을 적용하며, QR에 들어가는 주소는 `SURVEYONE_BASE_URL + /s/{slug}`입니다.

- Render에서는 `SURVEYONE_BASE_URL=https://in-surveyone.onrender.com`처럼 외부에서 접속 가능한 실제 HTTPS origin을 설정합니다.
- `127.0.0.1`과 `localhost`는 휴대폰 자기 자신을 가리키므로 휴대폰 QR 시험에 사용할 수 없습니다.
- 로컬 휴대폰 시험은 `SURVEYONE_HOST=0.0.0.0`, `SURVEYONE_BASE_URL=http://PC-LAN-IP:8300`으로 실행하고 같은 origin을 `INIT_ALLOWED_ORIGINS`에 추가합니다. PC와 휴대폰은 같은 Wi-Fi에 있어야 하며 Windows 방화벽에서 TCP 8300 접근을 허용해야 합니다.
- Git/Render 빌드는 `requirements.txt`의 `qrcode==8.2`를 설치하므로 별도 CDN이나 외부 QR API가 필요하지 않습니다.

## DDL/ALT 정책

현재 기준 파일은 `database/SURVEYONE_SYSTEM_DDL.sql`과 `database/SURVEYONE_SYSTEM_ALT.sql`입니다.

- IN-SURVEYONE이 생성하는 모든 Oracle object는 공유 schema의 다른 제품과 충돌하지 않도록 `INIT$SVY_`로 시작합니다.
- DDL은 빈 스키마에 현재 최종 구조를 생성하는 기준본이며 같은 파일을 다시 실행해도 이미 존재하는 object 때문에 실패하지 않습니다.
- ALT는 기존 schema를 최종 구조로 올리는 idempotent 이력입니다. ALT가 새로 만드는 테이블의 원문과 컬럼 순서는 DDL 기준본과 같습니다. 테이블 컬럼이 변경되는 migration은 Oracle 26ai에서 기존 데이터를 보존한 채 최종 `USER_TAB_COLUMNS.COLUMN_ID` 순서도 DDL과 일치시키고 불일치 시 성공으로 종료하지 않습니다.
- 테이블·컬럼·인덱스·제약조건 변경은 같은 작업에서 DDL 최종본과 ALT 증분을 함께 수정합니다.
- ALT에는 무조건적인 `DROP`, `TRUNCATE`, 데이터 초기화를 넣지 않습니다. 파괴적 변경은 별도 승인·백업·복구 계획이 필요합니다.
- `SURVEYONE_SYSTEM_DROP.sql`은 `INIT$SVY_` object만 제거하고 `SURVEYONE_SYSTEM_TRUC.sql`은 object를 유지한 채 프로젝트 테이블 데이터만 비웁니다. 둘 다 파괴적 관리 스크립트이므로 백업·대상 schema 확인 후 운영자가 명시적으로 실행해야 하며 애플리케이션이나 검증 스크립트가 자동 실행하지 않습니다. 다른 schema의 FK·의존 객체까지 사전 확인하도록 DBA catalog 읽기 권한이 없으면 안전하게 중단합니다.
- tenant/project/version/response/report의 외래키와 tenant 범위 인덱스를 명시합니다.
- Oracle 예약어, 이름 길이, UTC 시각, CLOB/JSON 저장 방식과 대량 응답 조회 계획을 검증합니다.
- SQL 변경 뒤 memory와 Oracle repository 계약 테스트, fresh install과 upgrade 시나리오를 모두 확인합니다.

### 원격 Oracle 적용 순서

애플리케이션 전용 일반 schema로 접속하고(공용 관리자 `SYS`/`SYSTEM` 계정에 만들지 않음) 빈 schema에는 DDL만 실행합니다. 비밀번호를 명령행이나 파일에 적지 말고 SQLcl/SQL*Plus의 비밀번호 prompt 또는 Wallet을 사용합니다.

```text
sql /nolog
CONNECT surveyone_app@service_name
@database/SURVEYONE_SYSTEM_DDL.sql
```

이미 이전 IN-SURVEYONE schema가 있으면 먼저 검증된 백업을 만든 뒤 DDL 대신 `SURVEYONE_SYSTEM_ALT.sql`을 실행합니다. 이번 guest 계정 구조에는 `questNNN` 발급용 `INIT$SVY_SQ_GUEST_LOGIN` sequence가 필요하므로 기존 schema도 ALT를 한 번 실행해야 합니다. 실행 후 `USER_OBJECTS`, `USER_TABLES`, `USER_TAB_COLUMNS`, `USER_CONSTRAINTS`에서 `INIT$SVY_` object와 invalid object를 확인하고 애플리케이션 health/API smoke test를 수행합니다. `DROP`과 `TRUC`는 설치·upgrade 순서에 포함되지 않습니다.

## 응답과 보고서 재현성

원자료는 수집 당시 설문 버전, 문항 ID, 제출 시각, 응답 상태와 함께 보존합니다. 화면 조회와 다운로드는 tenant/프로젝트 권한, 필터, 열 선택, 개인정보 마스킹을 동일하게 적용합니다.

- 기본형 보고서: 응답 수, 결측, 빈도, 비율, 기술통계, 교차표, 표준 차트
- 맞춤형 보고서: 필터, 파생 지표, 문항 묶음, 표/차트 레이아웃, 설명 문구, 내보내기

모든 `ReportRun`은 `survey_version_id`, 응답 cutoff, 필터 JSON, 지표/레이아웃 정의 버전, 집계 코드 버전, 실행자, 실행 시각과 결과 snapshot/hash를 기록합니다. 같은 입력과 정의로 다시 실행할 수 있어야 하며 보고서 정의 변경은 기존 실행 결과를 덮어쓰지 않습니다. 숫자 산식, 분모, 결측 처리, 다중응답 처리 규칙을 보고서 메타데이터에 표시합니다.

## 회원과 guest 체험

운영 목적의 기관 명의 서비스와 장기 보존은 회원가입과 tenant 소속이 필요합니다. 인증 전에도 메인 대시보드를 둘러볼 수 있고, 실제 작업을 시작할 때 Oracle guest 신청, 기존 계정 로그인 또는 회원가입을 선택합니다.

| 계정 | 저장 위치와 수명 | 사용 범위 | 안내 |
|---|---|---|---|
| Oracle guest (`questNNN`) | 신청할 때 Oracle에 독립 `DB_GUEST` tenant/user를 만들고 만료 시각과 capability를 기록 | 회원과 동일한 설문 작성·다국어·임시저장·배포·응답·원자료·기본 보고서 흐름을 유한 quota 안에서 체험 | `quest001` 형태의 아이디와 초기 비밀번호를 한 번만 표시합니다. 복사 후 일반 로그인 화면에서 다시 로그인할 수 있으며, 만료 이후에는 접근할 수 없습니다. 운영 회원이나 영구 보존 계정이 아니므로 민감정보를 입력하면 안 됩니다. |
| 기관 회원 | Oracle의 기관 tenant/user에 장기 저장 | 승인된 역할과 provider 설정 범위에서 운영 기능 사용 | 회원가입과 기관 정책을 적용하며 guest tenant의 응답·수신자 개인정보를 자동 승계하지 않습니다. |

- guest 신청은 Oracle pool과 필수 schema가 정상이고 관리자가 허용한 경우에만 사용할 수 있습니다. Oracle 장애를 memory 저장으로 우회하지 않습니다.
- guest 아이디는 `INIT$SVY_` sequence로 동시성 안전하게 발급하며 `quest001` 이후에도 최소 3자리 형식을 유지합니다. 실제 Oracle DB 사용자 계정을 생성하는 것이 아니라 애플리케이션 로그인 계정을 생성합니다.
- 초기 비밀번호는 신청 응답에서 한 번만 보여 주고 hash만 DB에 저장합니다. 인증은 아이디·비밀번호와 불투명 HttpOnly cookie를 사용하며 Windows session, device fingerprint 또는 예측 가능한 아이디만으로 사용자를 판별하지 않습니다.
- 각 guest는 별도 tenant/user를 가지며 설문·버전·배포·응답·보고서 CRUD는 항상 tenant 소유권을 조건으로 조회합니다. `quest001`은 `quest010`의 object ID를 알아도 조회하거나 변경할 수 없습니다.
- DB guest는 `INIT$SVY_TB_GUEST_CAP`의 만료·capability 정책으로 회원 tenant와 격리합니다.
- `INIT$SVY_FN_GUEST_CAN`은 tenant·user·기능 코드와 만료시각을 기준으로 DB guest 권한을 `Y/N`으로 판정합니다.
- 가입 전환 시 사용자가 확인한 설문 구조만 새 tenant로 복사하며 수신자와 응답 개인정보를 자동 이전하지 않습니다.

기본 guest 보존시간은 `SURVEYONE_GUEST_PROJECT_TTL_HOURS`로 조정합니다. 자원 남용을 막는 유한 quota는 `SURVEYONE_DB_GUEST_MAX_PROJECTS`(기본 10), `SURVEYONE_DB_GUEST_MAX_QUESTIONS`(설문당 기본 300), `SURVEYONE_DB_GUEST_MAX_RESPONSES`(설문당 기본 2,000)로 조정합니다. 실제 값은 신청 화면의 capability 안내에 표시됩니다. 로그인 쿠키는 공용 PC 안전을 위해 기본적으로 브라우저 세션 쿠키로 발급하며, 사용자가 `로그인 상태 유지`를 명시적으로 선택한 경우에만 만료 시간이 있는 영속 쿠키를 발급합니다. guest session cookie와 서버 session 만료는 tenant 만료시각을 넘지 않으며, 일반 회원 session은 `INIT_SESSION_TTL_SECONDS`를 따릅니다.

설문 편집기의 `저장`은 현재 미완성 초안을 Oracle에 보관하는 명시적 동작입니다. STEP 04의 `저장·확정 및 URL 발급`은 초안을 저장한 뒤 불변 `SurveyVersion`을 생성하고 공개 `/s/{slug}` URL을 발급합니다. M03001 배포 센터는 이미 발급된 URL을 사용해 대상자·채널·언어별 안내문을 저장하고, STEP 04에서 Oracle 발송 대기열에 `QUEUED` 또는 `DISABLED` 작업을 등록합니다. URL을 바꾸는 예외 동작은 명시적 `URL 재발급`뿐입니다.

M02001의 설문 시작·종료 입력은 접속 브라우저와 Oracle Cloud DB 지역 설정에 관계없이 `Asia/Seoul`(KST, UTC+9)로 해석한 뒤 UTC instant로 저장합니다. 공개 URL의 기간 판정은 애플리케이션 서버의 UTC 시각과 확정 버전에 저장된 UTC instant를 비교하며, 표시만 KST로 변환합니다.

공개 응답 JSON은 의미 데이터 기준 기본 256 KiB(`SURVEYONE_PUBLIC_SUBMIT_MAX_BYTES`), 전송 본문 기준 기본 512 KiB(`SURVEYONE_PUBLIC_BODY_MAX_BYTES`)로 제한합니다. guest·로그인·가입 본문은 각각 `SURVEYONE_GUEST_BODY_MAX_BYTES`, `SURVEYONE_AUTH_BODY_MAX_BYTES`로 JSON 파싱 전에 차단합니다. 서버는 전체 byte 크기뿐 아니라 중첩 깊이, 노드·문자열·컨테이너 수를 검증하고, 재시도는 `Idempotency-Key`로 같은 제출 결과를 재사용합니다.

## 보안·접근성·테스트 기준

- 인증은 세션 수명, Secure/HttpOnly/SameSite cookie와 Origin 기반 CSRF 방어를 적용합니다. 단일 프로세스 방어 한도는 `SURVEYONE_GUEST_CREATE_RATE_LIMIT`, `SURVEYONE_SIGNUP_RATE_LIMIT`, `SURVEYONE_LOGIN_RATE_LIMIT`, `SURVEYONE_RATE_LIMIT_WINDOW_SECONDS`로 조정합니다. 분산 rate limit는 운영 배포 전에 신뢰할 수 있는 proxy IP 설정과 공유 limiter(API gateway/Redis 등)로 추가해야 합니다.
- 모든 API는 object ID만 믿지 않고 tenant와 역할을 다시 검증합니다.
- 공개 제출에는 현재 요청 크기·구조·schema 검증, idempotency, guest quota와 `SURVEYONE_PUBLIC_SUBMIT_RATE_LIMIT` 단일 프로세스 방어를 적용합니다. 여러 worker에 일관된 IP/device abuse 제한은 운영 edge/shared limiter에서도 적용해야 합니다.
- HTML/리치 텍스트는 allowlist sanitization하며 메시지와 보고서 출력도 escape합니다.
- 연락처, 응답, 다운로드와 보고서 접근은 audit event를 남기되 원문 개인정보를 로그에 기록하지 않습니다.
- WCAG 2.2 AA를 목표로 landmark, heading, label, focus, 대비, 키보드, reduced-motion을 테스트합니다.
- Python domain/API 테스트, memory/Oracle repository 계약 테스트, DDL/ALT 검증, JavaScript 문법, 대표 모바일 viewport와 공개 제출 E2E를 단계적으로 자동화합니다.

## 단계별 로드맵

1. 기반: 독립 FastAPI/SPA shell, 메뉴, Oracle repository, tenant/project/version/slug 모델, guest 데모, 반응형 공개 설문.
2. 제작·배포: 템플릿, 전체 문항 renderer, 조건 분기, 자동저장, 버전 확정, URL/QR/embed, 기본 스킨.
3. 운영: Oracle repository, 회원/역할, 수신자 import, 이메일·문자·카카오 adapter, 발송 상태와 audit.
4. 분석: 원자료 조회·XLSX/CSV, 기본 보고서, 재현 가능한 custom report builder와 실행 snapshot.
5. 고도화: 조직별 템플릿/스킨, 협업·승인 workflow, 다국어, 고급 품질 규칙, 성능·보안·접근성 운영 점검.

각 단계는 이전 단계의 schema와 공개 URL 호환성을 유지하며, 기능 flag 없이 미완성 외부 발송이나 Oracle fallback을 운영에 노출하지 않습니다.

## 검증, 백업, Git 배포

```powershell
.\scripts\validate-source.ps1
.\scripts\backup-source.ps1 -Mode Working
.\scripts\backup-source.ps1 -Mode Git
```

백업 위치는 아래 두 폴더의 timestamp 하위로만 제한됩니다.

- `D:\work\backup\in-surveyone_WORKING_BACKUP`
- `D:\work\backup\in-surveyone_GIT_BACKUP`

Working 백업은 미커밋 파일을 포함하되 `.git`, venv, dependency, `.env`, 자격정보, Wallet, 업로드, 응답 runtime, export, cache와 캡처를 제외합니다. Git 백업은 commit 기준 `source.zip`과 복구용 `repository.bundle`을 만듭니다.

Git 배포는 자동 실행하지 않습니다. 사용자가 아래 스크립트 또는 명시적으로 이름 붙은 VS Code Publish Task를 직접 실행하는 행위만 add/commit/rebase/push 승인으로 봅니다.

```powershell
.\scripts\git-publish-main.ps1
```

스크립트는 `main` 브랜치와 `https://github.com/initgroup/in-surveyone.git`만 허용하며, 검증과 민감 경로 확인 후 배포합니다.

## Render 예시

Render 배포는 별도 `render.yaml` 없이 GitHub `main` 브랜치를 Web Service에 직접 연결합니다. PDF 보고서에 필요한 Chromium과 한글 글꼴까지 배포 산출물에 포함해야 하므로 Build Command는 반드시 `bash scripts/render-build.sh`, Start Command는 `uvicorn main:app --host 0.0.0.0 --port $PORT`, Health Check Path는 `/api/health`로 설정합니다. 빌드 스크립트는 Python 의존성, Noto Sans KR 글꼴, Playwright Chromium headless shell을 설치한 뒤 Excel/PDF 생성 스모크 테스트가 성공해야만 배포를 계속합니다. 로컬 `.env`는 배포되지 않으므로 Environment Group과 Secret Files를 Render 대시보드에서 연결해야 합니다. 외부 발송은 provider secret과 adapter가 모두 준비된 채널만 활성화합니다.

Excel은 집계표 생성과 셀 스타일·수식 주입 방어에 적합한 `openpyxl`을 사용합니다. PDF는 브라우저와 같은 CSS 출력 품질을 유지하기 위해 Python `playwright`와 Chromium을 사용하며, 외부 네트워크와 JavaScript를 차단한 자체 포함 HTML만 인쇄합니다. `@fontsource-variable/noto-sans-kr`는 빌드 시에만 설치하는 글꼴 자산이므로 PDF 생성 런타임에 시스템 한글 폰트나 외부 CDN이 필요하지 않습니다.

Copyright © iNIT. All rights reserved.
