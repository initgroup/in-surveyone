# IN-SURVEYONE 도메인 운영 안내

이 디렉터리는 운영 설정과 검증 절차의 참조 자료이며 애플리케이션 runtime에서 읽지 않습니다. 비밀번호, 토큰, 실제 `.env`와 Wallet을 보관하지 않습니다.

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
