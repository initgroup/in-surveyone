# IN-SURVEYONE 도메인 운영 안내

이 디렉터리는 운영 설정과 검증 절차의 참조 자료이며 애플리케이션 runtime에서 읽지 않습니다. 비밀번호, 토큰, 실제 `.env`와 Wallet을 보관하지 않습니다.

## 2026-10-22 운영 DB 기능 재검사

공식 주소와 Render 주소에서 공개 상태 조회 및 출처 검사를 수행하고, 실제 Oracle에 별도 만료형 체험 계정을 만들어 가짜 설문으로 업무 저장을 검사했습니다. 기존 회원 데이터·실제 연락처·기존 응답 원문은 검사 자료로 사용하지 않았습니다. 테스트 자격 증명과 세션 쿠키는 프로세스 메모리에서만 사용했으며 파일·출력에 기록하지 않았습니다.

- 두 서비스 주소의 `publicBaseUrl`은 `https://www.insurveyone.com`, 환경은 `production`입니다. 루트 도메인은 공식 www 주소로 이동합니다.
- 공식·루트·Render Origin은 OPTIONS 200, 필수 필드 없는 로그인 POST는 422로 출처 검사를 통과했습니다. 미등록 Origin은 OPTIONS 400·POST 403으로 차단됐습니다. 422는 로그인 성공을 뜻하지 않습니다.
- 운영 기능 검사 최종 54건이 모두 통과했습니다. 별도 검사 세션의 공식 주소 로그인, Render 주소 재로그인, 세션 조회·연장·로그아웃을 확인했습니다.
- 설문 생성, Render 주소에서 저장 후 공식 주소에서 재조회, 문항·설정·스킨 저장, 오래된 revision 충돌 차단, 목록 페이징이 정상입니다.
- 확정, 대상별 URL, QR, 공개 조회, 가짜 응답 제출, 같은 idempotency key 재전송 시 동일 접수 결과와 응답 1건 유지가 정상입니다.
- 원자료 조회·XLSX 내보내기, 보고서 집계·XLSX·PDF 내보내기, 배포 초안 저장 후 다른 접속 주소에서 재조회, 수신자 XLSX 양식 조회가 정상입니다. 실제 외부 발송은 수행하지 않았습니다.
- 초안 재저장·재확정 시 기존 URL 유지, 과거 응답 버전 보존, URL 재발급 후 이전 주소 404·새 주소 정상, 재로그인 후 저장 유지가 정상입니다.
- 검사 설문은 종료·삭제했고 재조회 404를 확인했습니다. 검사 세션은 모두 로그아웃했습니다. 임시 체험 계정은 서비스의 자동 만료 정책을 따릅니다.
- 로컬 전체 소스·API·도메인·Oracle 저장소 계약 검증은 346개 통과했습니다. Oracle 단위 검사는 fake pool/recording CRUD를 쓰며 실제 SQL 실행 검증을 대신하지 않습니다. 실제 Oracle 저장은 위 운영 체험 계정으로 별도 확인했습니다.

### 도메인 변경 시 저장 내용이 다르게 보이는 기능

| 화면/기능 | 저장 위치 및 검사 판단 |
|---|---|
| 설문·확정 버전·응답·배포 초안 | 서버 Oracle. 같은 계정으로 각 도메인에 로그인하면 같은 데이터를 조회합니다. |
| 맞춤형 보고서(M05002) 레이아웃 초안 | 현재 Beta 구현은 브라우저 localStorage입니다. DB 영구 저장 API가 없으며 도메인·브라우저·사용자별로 분리됩니다. Render 주소의 초안이 www 주소로 자동 이전되지는 않습니다. |
| 시스템 환경 설정(M06001) | 화면 밀도·움직임·시작 화면은 브라우저 localStorage입니다. 도메인이 바뀌면 해당 주소의 설정을 다시 저장합니다. |
| 로그인 | 호스트 전용 세션 쿠키입니다. 도메인마다 로그인해야 합니다. 세션 미존재·만료는 401이며 DB 장애와 구분합니다. |

`/api/health`의 `database.state=configured`는 설정 모드를 표시하는 값이며 현재 DB 연결·저장의 성공 판정이 아닙니다. `/api/auth/guest/capabilities`는 Oracle 연결과 필수 구조 준비 검사를 수행하며 최대 30초의 캐시를 사용할 수 있습니다. 실제 저장의 성공은 저장 후 API 재조회로 확인해야 합니다.

이번 운영 검사에서 플랫폼 관리자 계정의 템플릿 변경·회원 변경, 기존 운영 설문별 데이터 내용, DDL/ALT 실행은 수행하지 않았습니다. 관리 기능은 자동화 계약 테스트와 체험 계정의 관리자 권한 차단(403)을 확인했습니다. 특정 화면·계정·기존 설문에서만 발생하는 오류는 해당 경로와 오류 상태로 별도 재현해야 합니다.

## 2026-10-21 원인 확인

- `www.insurveyone.com`의 DNS는 `in-surveyone.onrender.com`으로 연결되며 두 주소의 HTTPS와 `/api/health` 조회가 정상입니다. 루트 도메인 `insurveyone.com`은 `www.insurveyone.com`으로 이동합니다.
- 두 주소 모두 `/api/runtime-config`의 공개 주소를 `https://in-surveyone.onrender.com`으로 반환했습니다.
- 필수 필드가 없는 `{}` 로그인 요청으로 데이터 변경 없이 비교했습니다. Render Origin은 422(필수 필드 입력 검증), `https://www.insurveyone.com`과 `https://insurveyone.com` Origin은 403 `요청 출처가 허용되지 않았습니다.`를 반환했습니다. 요청을 보내는 호스트를 바꿔도 동일했습니다.
- 따라서 재현된 실패는 서버의 Origin 허용 목록 누락이며 인증·DB 처리 전에 차단됩니다. `/api/health` 성공만으로 실제 로그인·저장 성공을 판정하지 않습니다.

## 기존 운영 빌드에서도 즉시 적용할 설정

Render Dashboard에서 **in-surveyone 서비스 자체의 Environment**에 다음 비밀이 아닌 값을 입력합니다. 연결된 공용 Environment Group을 변경할 필요는 없습니다. 기존 secret·DB 설정은 그대로 유지합니다.

```text
SURVEYONE_BASE_URL=https://www.insurveyone.com
INIT_ALLOWED_ORIGINS=https://www.insurveyone.com,https://insurveyone.com,https://in-surveyone.onrender.com
INIT_COOKIE_SECURE=true
INIT_COOKIE_SAMESITE=lax
```

`Save and deploy`를 선택해 현재 빌드에 새 환경설정을 적용하고 Live 상태가 될 때까지 기다립니다. `Save only`는 실행 중인 서비스에 적용하지 않습니다. 이 설정 교정은 기존 코드에서도 동작합니다.

소스의 재발 방지 수정은 별도 배포 후 적용됩니다. 설정된 공식 공개 주소의 origin을 기존 허용 목록에 자동 포함하므로 이후 대표 도메인 변경 시 이전 허용 목록 때문에 대표 도메인이 차단되는 문제를 방지합니다. CORS와 쓰기 요청 검증은 동일한 목록을 사용하며 `*`, `null`, 미등록 도메인은 허용하지 않습니다. `INIT_ALLOWED_ORIGINS` 우선순위와 기존 호환 키 동작은 유지합니다.

## 서브도메인을 추가하는 서비스 전용 설정

새 코드를 배포하면 `SURVEYONE_ADDITIONAL_ALLOWED_ORIGINS`를 사용할 수 있습니다. 연결된 공용 Environment Group의 `INIT_ALLOWED_ORIGINS`를 변경하지 않고 in-surveyone 서비스에만 추가합니다.

```text
SURVEYONE_ADDITIONAL_ALLOWED_ORIGINS=https://survey.insurveyone.com,https://portal.insurveyone.com
```

위 주소는 예시입니다. 실제 소유·관리할 서브도메인을 카페24 DNS와 Render Custom Domains에 연결한 다음 정확한 HTTPS 주소를 쉼표로 나열합니다. 등록한 추가 주소를 빼려면 이 값에서 제거하고 재배포합니다. 기존 목록이나 공식 공개 주소에도 등록된 주소는 해당 설정에서도 제거해야 제외됩니다.

최종 목록은 기존 공용/호환 목록 + 공식 공개 주소의 origin + 추가 목록이며 대소문자·기본 포트를 정규화하고 중복을 제거합니다. 기존 `INIT_ALLOWED_ORIGINS` 우선순위는 유지됩니다. 빈 추가 목록은 동작을 바꾸지 않습니다. 경로·query·fragment·사용자정보·`null`·와일드카드는 시작 단계에서 거부하며, 미등록 형제 서브도메인과 유사 도메인은 차단됩니다. CORS와 쓰기 요청 검증 모두 최종 목록을 사용합니다.

Render는 `Save and deploy`, 로컬 환경은 서버 재시작으로 적용합니다. 이 새 키는 새 코드 배포가 필요하므로 기존 빌드를 즉시 복구할 때는 앞 절의 `INIT_ALLOWED_ORIGINS` 설정을 사용합니다.

## 데이터 변경 없는 운영 재확인

PowerShell에서 다음을 실행합니다. 빈 로그인 본문은 필수 입력 검증에서 종료하므로 계정 생성·로그인·DB 쓰기를 수행하지 않습니다.

```powershell
curl.exe -sS https://www.insurveyone.com/api/runtime-config
curl.exe -i -sS https://www.insurveyone.com/api/auth/login -H "Origin: https://www.insurveyone.com" -H "Content-Type: application/json" --data-raw "{}"
curl.exe -i -sS https://in-surveyone.onrender.com/api/auth/login -H "Origin: https://in-surveyone.onrender.com" -H "Content-Type: application/json" --data-raw "{}"
curl.exe -i -sS https://www.insurveyone.com/api/auth/login -H "Origin: https://untrusted.example" -H "Content-Type: application/json" --data-raw "{}"
```

기대 결과는 공개 주소 `https://www.insurveyone.com`, 정상 두 출처의 422, 미등록 출처의 403입니다. 422는 출처 검사 통과를 의미하며 실제 로그인 성공 판정은 아닙니다. 두 접속 주소에서 운영자가 테스트 계정으로 로그인하고 테스트 설문 저장·새로고침·로그아웃을 확인합니다. 실제 계정·연락처·설문 응답을 로그나 캡처에 남기지 않습니다.

브라우저 API 요청은 기존처럼 상대 `/api/` 주소를 사용하고 `Secure; HttpOnly; SameSite=Lax; Path=/api` 호스트 전용 쿠키를 유지합니다. Render와 공식 주소 사이에 로그인 쿠키를 공유할 수 없으므로 각 주소에서 따로 로그인합니다. `SameSite=None`이나 쿠키 Domain 확대는 이 문제의 해결책이 아닙니다.

## 자동 회귀 검증

```powershell
.\venv\Scripts\python.exe -m pytest -q -p no:cacheprovider tests/test_config_compat.py tests/test_domain_access.py
```

테스트는 `.env` 로딩과 실제 Oracle 접근을 차단한 별도 프로세스에서 실제 FastAPI 앱을 시작합니다. 공식 주소가 빠진 이전 허용 목록을 구성하고 기존 세 주소와 추가 등록한 서브도메인의 CORS·회원가입·로그인·세션 쿠키·설문 저장·로그아웃, 외부 출처의 POST/PUT/PATCH/DELETE·공개 응답 제출 차단을 확인합니다. 운영 완료 여부는 위 운영 재확인 결과로 별도 판정합니다.

참조: [Render 환경 변수](https://render.com/docs/configure-environment-variables), [Render Custom Domains](https://render.com/docs/custom-domains).
