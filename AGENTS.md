# AGENTS.md

이 문서는 Codex가 `in-surveyone` 저장소에서 작업할 때 적용하는 프로젝트 전용 지침입니다.

## 작업 원칙

- 작업 전 `git status --short`와 대상 파일을 확인하고 사용자의 기존 변경을 되돌리거나 덮어쓰지 않습니다.
- 새 코드와 문서는 UTF-8 BOM 없음, LF 줄바꿈으로 작성합니다.
- 검색은 `rg`와 `rg --files`를 우선 사용합니다.
- 요청 범위 밖 파일을 대량 정리하거나 generated file을 소스로 취급하지 않습니다.
- `.env`, 비밀번호, API token, Oracle Wallet, 인증서, 실제 연락처·응답 원문을 읽거나 출력하거나 커밋하지 않습니다.
- 운영 캡처나 샘플에는 직원명, 고객명, 계정, DB/스키마, 실제 응답자 정보를 넣지 않습니다.

## 독립 프로젝트 경계

- 이 저장소는 IN-SURVEYONE 전용 독립 프로젝트입니다.
- 다른 저장소는 구조와 아이디어를 읽기 전용으로 참고할 수 있지만 파일 복사, runtime import, symlink, 상대 경로 참조, 공용 환경변수 의존을 만들지 않습니다.
- `initgroup-members`, `initgroup-homepage`, `data-editing-system`의 모듈·정적 파일·DB loader·세션·설정을 import하지 않습니다.
- 필요한 패턴은 IN-SURVEYONE 이름, 도메인 모델, 테스트와 문서로 다시 구현합니다.
- 환경변수는 `SURVEYONE_` 접두사를 사용합니다.

## Git 절대 제한

- 사용자가 현재 요청에서 명시적으로 승인하지 않은 `git add`, `git commit`, `git push`, `git pull`, `git fetch`, `git merge`, `git rebase`, `git tag`를 실행하지 않습니다.
- 일반적인 “수정”, “완료”, “반영”, “배포 준비” 요청은 Git 게시 승인으로 해석하지 않습니다.
- `scripts/git-publish-main.ps1`도 사용자가 현재 요청에서 실행을 명시한 경우에만 실행합니다. 과거 대화의 승인을 재사용하지 않습니다.
- 검증이 성공해도 변경은 기본적으로 unstaged/uncommitted 상태로 남깁니다.
- 읽기 전용 `git status`, `git diff`, `git log`는 범위 확인에 사용할 수 있습니다.
- 게시 스크립트는 `origin`, `main`, `https://github.com/initgroup/in-surveyone.git`만 허용해야 합니다.

## 애플리케이션 구조

- Python 3.12 FastAPI가 `/api/`와 Vanilla HTML/CSS/JavaScript SPA를 서비스합니다.
- Python 진입점은 루트 `main.py`, 서버 포트는 8300입니다.
- VS Code `Ctrl+Shift+B`의 기본 Build Task는 프로젝트 venv로 8300 서버를 실행해야 합니다.
- backend의 API, domain/service, repository/storage 책임을 분리합니다.
- UI framework, Google API, 다른 프로젝트 runtime을 필수 조건으로 추가하지 않습니다.
- 브라우저 상태는 화면 편의를 위한 cache일 뿐 tenant 권한·버전·공개 상태의 기준이 아닙니다.
- 공개 설문 renderer는 관리자 SPA와 별도 shell로 유지합니다.

## 메뉴 ID와 파일 계약

`M` 다음 두 자리는 대분류, 다음 세 자리는 중분류입니다.

| 파일 | 메뉴 |
|---|---|
| `M01001.html` | 대시보드 |
| `M02001.html` | 설문 프로젝트 |
| `M02002.html` | 설문 템플릿 |
| `M02003.html` | 설문 제작기 |
| `M03001.html` | 배포·발송 |
| `M04001.html` | 원자료 응답 |
| `M05001.html` | 기본형 보고서 |
| `M05002.html` | 맞춤형 보고서 |
| `M06001.html` | 스킨·설정 |

- 새 메뉴는 같은 규칙으로 ID를 배정하고 내비게이션, route, 권한, title, breadcrumb와 테스트를 함께 변경합니다.
- 인증·회원가입·계정 찾기와 `/s/{slug}` 공개 응답은 업무 메뉴 ID와 분리합니다.
- 각 완성 HTML 문서는 viewport, 정확히 하나의 `main`과 `h1`, skip link와 의미 있는 title을 가집니다.
- 인라인 실행 JavaScript 대신 `frontend/js/`의 자체 호스팅 모듈을 사용합니다.

## 테넌트·프로젝트·버전·slug 불변조건

- 모든 회원 업무 데이터는 `tenant_id`를 가지며 API와 repository가 tenant 범위를 강제합니다.
- `SurveyProject`의 편집 초안과 확정 `SurveyVersion`을 분리합니다.
- 한 번 배포된 버전은 수정하지 않고 변경 시 새 버전을 생성합니다.
- `SurveyDeployment`는 현재 활성 버전, 공개 기간, 상태, 응답 정책과 스킨 snapshot을 가집니다.
- 공개 URL 계약은 `/s/{slug}`이며 normalized project slug는 서비스 전체에서 유일합니다. tenant 소유권은 별도 필드와 서버 권한 검증으로 강제합니다.
- 응답은 수집 시 노출된 `survey_version_id`를 반드시 참조합니다. 활성 버전 변경으로 과거 응답의 문항 해석이 바뀌면 안 됩니다.
- object ID만으로 조회하지 않고 현재 actor의 tenant, role, project permission을 함께 검증합니다.

## 설문 제작 계약

- 템플릿 범주는 사회조사, 청렴도, 사업체, 만족도, 교육·행사, 조직진단, 신청·수요, 기관 맞춤형을 포함합니다.
- 템플릿 사용 시 프로젝트 소유의 독립 초안으로 복제하며 원본 후속 변경을 전파하지 않습니다.
- 기본 문항 유형은 객관식, 주관식, 복수응답, 드롭다운, 척도, 메트릭스, 텍스트, 숫자, 슬라이더, 표, 반복표입니다.
- 각 유형은 schema, editor, public renderer, validator, response serializer와 report adapter의 계약을 함께 구현합니다.
- 조건 분기와 validation은 안정적인 section/question/option ID를 참조하고 화면 순번을 식별자로 쓰지 않습니다.
- rich text와 이미지 URL은 allowlist로 검증하며 사용자 실행 스크립트와 임의 CSS를 허용하지 않습니다.
- 기본 언어와 활성 언어 목록, 설문·섹션·문항·선택지 번역은 안정적인 ID를 기준으로 저장합니다. 번역 문구를 ID나 분기 기준으로 사용하지 않습니다.
- 공개 화면 언어는 명시적 `lang`, 브라우저 언어, 설문 기본 언어 순으로 해석하고 누락 문구는 기본 언어로 fallback합니다.
- 확정 버전에는 언어 설정과 번역 snapshot을 함께 고정하며 배포된 번역을 제자리 수정하지 않습니다.
- 모든 `Mxxxxx` 페이지는 해당 업무의 목적·순서·주의점을 담은 키보드 접근 가능한 `작성 요령` 도움말을 제공합니다.

## 모바일·접근성·스킨

- 공개 응답 화면은 360px 모바일 우선, 한 열, 최소 44px 터치 영역과 safe-area 하단 액션을 기본으로 합니다.
- keyboard, focus-visible, label, fieldset/legend, 오류 연결, reduced-motion과 색상 외 상태 표현을 유지합니다.
- 오류 제출 후 첫 오류에 포커스를 이동하고 오류 요약과 해당 문항을 연결합니다.
- 프로젝트 스킨은 semantic token과 검증된 로고/배경 자산만 덮고 관리자 UI와 분리합니다.
- 저장 시 WCAG AA 대비, 허용 글꼴, 파일 유형·크기, responsive 안정성을 검증합니다.

## guest 정책

- runtime guest는 Oracle에 만료되는 `DB_GUEST` tenant/user/session으로만 저장합니다. 브라우저 또는 서버 memory에 guest 업무 데이터를 저장하거나 Oracle 장애를 memory로 fallback하지 않습니다.
- guest 신청마다 `quest001`처럼 최소 3자리 일련번호의 애플리케이션 로그인 아이디를 Oracle sequence로 발급합니다. 각 guest는 별도의 tenant와 user를 가지며 모든 업무 SQL은 tenant와 user 소유권을 함께 검증합니다.
- 초기 비밀번호 평문은 신청 응답에서 한 번만 표시하고 DB에는 강한 password hash만 저장합니다. 비밀번호를 브라우저 storage, 로그, URL, telemetry에 기록하지 않습니다.
- guest 재로그인은 아이디·비밀번호와 만료되지 않은 tenant를 검증해 일반 회원과 동일한 불투명 HttpOnly session cookie를 발급합니다. PC·모바일 식별자나 Windows local session은 인증 근거로 신뢰하지 않습니다.
- guest 신청은 Oracle pool과 schema가 정상일 때만 제공합니다. 사용할 수 없으면 이유를 명시하고 신청을 차단합니다.
- 메인 대시보드는 인증 없이 둘러볼 수 있으며, guest 신청·로그인·회원가입은 사용자가 작업을 시작할 때 선택합니다.
- DB guest가 모든 화면 흐름을 사용할 수 있어도 disabled provider를 우회해 실제 이메일·문자·카카오를 전송하지 않습니다.
- guest는 운영 기관을 사칭하는 공개 서비스가 아니며 만료와 데모 표시, 유한 quota를 적용합니다.
- guest 화면에는 데모와 민감정보 입력 금지를 명확히 표시합니다.
- 가입 전환은 사용자가 확인한 설문 구조만 새 tenant로 복사하며 수신자와 응답 개인정보를 자동 이전하지 않습니다.

## 저장소 모드와 Oracle

- `initgroup-members`와 동일한 `DB_MODE=local|cloud`, `DB_*` Oracle profile을 기본 계약으로 사용합니다.
- `local`과 `cloud` 모두 Oracle runtime입니다. memory repository는 자동화된 repository 계약 테스트에서만 사용하고 실제 guest/member 요청에는 사용하지 않습니다.
- 개발 환경의 세션 secret은 `INIT_SECRET_KEY`가 없을 때만 `runtime/.session-secret`에 무작위로 최초 생성합니다. 운영 환경은 Environment Group에 `INIT_SECRET_KEY`를 반드시 명시합니다.
- oracle 설정 오류나 연결 실패를 memory로 fallback하지 않습니다.
- Oracle thin mode를 우선하고 thick client/Wallet은 환경설정으로만 주입합니다.
- connection pool, acquire/call timeout, transaction boundary를 명시하고 request마다 새 전역 pool을 만들지 않습니다.
- SQL parameter binding을 사용하며 tenant filter를 문자열 조합으로 만들지 않습니다.

## DDL/ALT 정책

- `database/*_DDL.sql`은 빈 schema용 현재 최종 구조입니다.
- 같은 basename의 `*_ALT.sql`은 기존 schema용 idempotent 증분 이력입니다.
- 이 프로젝트가 생성하는 모든 영속 Oracle object 이름은 공유 schema 충돌 방지를 위해 `INIT$SVY_`로 시작하며 Oracle identifier 길이 제한을 지킵니다.
- DDL과 ALT는 재실행 가능해야 하며 ALT의 최종 테이블 원문과 컬럼 순서는 DDL과 일치해야 합니다.
- Oracle 26ai upgrade에서 컬럼을 추가하거나 순서를 바꾸면 ALT가 기존 데이터를 보존하면서 최종 `USER_TAB_COLUMNS.COLUMN_ID` 순서를 DDL과 같게 조정하고 실행 후 불일치를 검증해야 합니다.
- schema 변경은 DDL 최종본과 ALT 변경을 같은 작업에서 함께 반영합니다.
- ALT의 무조건적인 `DROP`, `TRUNCATE`, destructive data rewrite는 금지합니다. 불가피하면 사용자 승인, 백업, 영향 분석과 복구 절차를 별도 문서화합니다.
- `SURVEYONE_SYSTEM_DROP.sql`과 `SURVEYONE_SYSTEM_TRUC.sql`은 사용자가 명시적으로 요청한 별도 파괴 스크립트입니다. 자동 실행·테스트하지 않고 `INIT$SVY_` 범위 밖 object를 절대 대상으로 삼지 않습니다. 다른 schema의 FK·의존 객체를 DBA catalog에서 확인할 수 없으면 실행을 중단합니다.
- 테이블/컬럼/제약/인덱스 이름, 순서, 기본값과 nullability를 fresh install/upgrade 양쪽에서 검증합니다.
- tenant/project/version/response/report 외래키와 tenant 선두 인덱스를 누락하지 않습니다.

## 응답·보고서 재현성

- 원자료는 설문 버전, 안정적인 문항 ID, 제출 상태와 UTC 시각을 보존합니다.
- 조회와 export는 같은 권한·filter·마스킹 계약을 사용합니다.
- 기본형은 빈도, 비율, 결측, 기술통계, 교차표와 표준 차트를 제공합니다.
- 맞춤형은 versioned definition으로 filter, 파생 지표, 표·차트 layout을 저장합니다.
- `ReportRun`은 survey version, response cutoff, filter, definition version, aggregation code version, actor, 실행 시각과 결과 snapshot/hash를 기록합니다.
- 기존 실행 결과를 최신 정의로 덮어쓰지 않으며 같은 입력과 정의로 재실행 가능해야 합니다.
- 분모, 결측, 다중응답, 가중치와 반올림 규칙을 보고서 metadata와 테스트에 남깁니다.

## 발송과 개인정보

- email/SMS/Kakao는 공통 delivery port와 provider adapter로 분리합니다.
- provider가 `disabled`이면 실제 외부 전송을 시도하지 않습니다.
- 수신자 업로드는 tenant 경계, 목적, 보유 기간, 파일 크기·형식과 formula injection을 검증합니다.
- 화면·로그에서 연락처를 마스킹하고 provider secret이나 메시지 원문 개인정보를 기록하지 않습니다.
- 공개 제출에는 body size, rate limit, schema 검증과 idempotency key를 적용합니다.

## 테스트와 검증

변경 범위에 맞춰 다음을 실행합니다.

```powershell
.\scripts\setup-venv.ps1
.\scripts\validate-source.ps1
.\scripts\run-server.ps1
```

- Python 문법과 FastAPI import, API/domain 테스트를 확인합니다.
- memory와 Oracle repository는 같은 contract test를 공유합니다.
- DDL fresh install과 ALT upgrade를 함께 검증합니다.
- JavaScript는 Node가 있을 때 `node --check`를 사용하지만 Node는 runtime 필수 조건이 아닙니다.
- 공개 설문은 360px·tablet·desktop, keyboard, reduced-motion, 중단/재시도와 중복 제출을 점검합니다.
- 버그 수정에는 가능한 한 원인을 재현하는 회귀 테스트를 추가합니다.

## 백업과 개발환경

- Python은 시스템 명령보다 `venv\Scripts\python.exe`를 우선 사용합니다.
- `venv/`와 runtime/export/upload 결과는 수정·커밋하지 않습니다.
- Working 백업은 `D:\work\backup\in-surveyone_WORKING_BACKUP` 아래에만 생성합니다.
- Git 백업은 `D:\work\backup\in-surveyone_GIT_BACKUP` 아래에만 생성합니다.
- 백업 스크립트의 경로 검증, reparse point 거부, secret/generated 제외 규칙을 완화하지 않습니다.

최종 답변 마지막에는 `Usage 확인: VS Code Codex 입력창에서 /status` 문구를 추가합니다.
