# 변경 영향별 검증 운영 기준

2026-10-22 사용자 요청에 따라 적용합니다. 매 수정마다 전체 검사를 반복하는 대신, 변경 때문에 깨질 수 있는 동작을 가장 작은 검증 범위부터 확인합니다. 프로젝트의 필수 기능 계약과 배포 전 검증은 유지합니다.

## 현재 확인한 실행 구조

- `scripts/validate-source.ps1`: 전체 소스의 인코딩·문법·정책 검사, FastAPI import, Ruff와 전체 pytest를 실행합니다. `-SkipTests`는 pytest만 생략하며 나머지는 여전히 전체 검사입니다.
- `tests/browser_rich_editor.cjs`: 리치 편집·미리보기·문항 삽입·보기 코드·수동 저장 등 여러 동작을 묶어 검사합니다.
- `tests/browser_workflows.cjs`: 업무 화면·이동·오류 복구와 여러 화면 폭을 묶어 검사합니다.
- 이전 문항 삽입 작업에서 전체 pytest는 약 54초, 제작기 관련 35개 테스트는 약 1.5초가 걸렸습니다. 범위가 달라 보장하는 내용도 다르지만, 독립 수정의 피드백은 관련 테스트로 빠르게 받을 수 있습니다. 시간은 실행 환경에 따라 달라집니다.

## 선택 순서

1. 이번 요청에서 실제로 바꾼 함수·스타일·데이터를 확인합니다. 작업 시작 시 있던 다른 미커밋 변경 전체를 새 변경으로 취급하지 않습니다.
2. `rg`로 호출처·공유 모듈·API payload·버전 snapshot·renderer·serializer·export의 연결을 확인합니다. 파일 이름이 같거나 다르다는 사실만으로 독립성을 판단하지 않습니다.
3. 아래 표에서 가장 작은 충분한 검증을 선택합니다. 정상 동작 외에도 변경과 관련된 경계·실패 복구를 포함합니다.
4. 실패하면 재현 테스트로 원인을 고치고 그 테스트와 관련 경계를 다시 확인합니다. 실패 원인이 다른 기능까지 퍼지거나 영향이 불명확하면 범위를 넓힙니다.
5. 관련 검증이 통과하면 완료합니다. 새 변경·의존성/환경 변화·미해결 우려 없이 더 넓은 검사를 관성적으로 반복하지 않습니다.

## 변경별 기본 범위

| 변경 | 기본 검증 | 확대 조건 |
|---|---|---|
| 문서·주석 | 변경 부분 diff, UTF-8 BOM 없음/LF, 로컬 링크 확인 | 문서의 실행 예제·설치 계약을 바꿨으면 해당 명령/구성도 확인 |
| 한 화면의 문구·색상·간격 | 해당 화면의 변경 상태 확인 | 줄바꿈·반응형이면 desktop/360px, 바뀐 breakpoint가 있으면 해당 폭 추가 |
| 독립 JavaScript 기능 | 변경 파일 `node --check` + 관련 테스트 파일/개별 테스트 | DOM·포커스·iframe·이벤트 순서·레이아웃이면 해당 브라우저 동작 추가 |
| 독립 Python 기능/API | 변경 Python 문법 + 관련 단위/계약/API 테스트 | 초기화·라우팅·설정이면 앱 import와 관련 smoke 추가 |
| 저장·취소·이동 | 해당 저장/복원 테스트 + 저장 실패/수정 중 저장/이탈 중 관련 경계 | 여러 편집기의 공통 처리 변경이면 workflow 브라우저 묶음 추가 |
| 문항·응답 데이터 계약 | schema + 편집/저장 + 공개 응답 + 과거 버전/보고서/export 중 영향받는 경계 | 공유 모델/serializer 변경이 여러 업무로 확산되면 전체 검사 |
| 공통 CSS·SPA shell·공통 UI 모듈 | 호출처의 대표 업무 화면과 관련 계약/라이프사이클 테스트 | 전역 글꼴·레이아웃·내비게이션은 영향받는 메뉴/화면 폭을 넓게 확인 |
| 인증·tenant·세션·Origin·DB 저장소 | 관련 허용/차단·권한·트랜잭션·repository 계약 + 관련 API 흐름 | 공통 보안/영속성 계약이 광범위하게 바뀌거나 범위 불명확하면 전체 검사 |
| DDL/ALT·의존성·실행 환경 | schema fresh/upgrade 계약 또는 실제 바뀐 의존성의 빌드/import·사용처 | 공유 동작 영향에 따라 전체 검사. 실제 DB migration 실행은 별도 작업 |
| 배포 전 또는 영향 범위 불명확 | 누적 변경 전체에 `validate-source.ps1` + 영향 있는 브라우저 흐름 | 운영 DB/발송 검증은 별도 범위로 명시하고 자동화 테스트 통과와 구분 |

## 현재 테스트 선택표

다음은 출발점이며, 호출처와 실제 변경 내용에 따라 필요한 항목을 더하거나 개별 테스트로 좁힙니다. 표의 모든 파일을 매번 실행하지 않습니다.

| 변경 대상 | 관련 테스트 후보 |
|---|---|
| 문항 위/아래/끝 삽입, 자동 표시 번호 | `test_frontend_builder_insertion.py`, `test_frontend_survey_authoring.py`의 해당 테스트 |
| 섹션 삭제·조건/대상 참조 정리 | `test_frontend_builder_sections.py`, `test_survey_audience_codes.py`의 관련 테스트 |
| 문항 유형 선택·명시적 추가 | `node tests/browser_builder_tools.cjs` (14유형 단일 클릭 무변경·더블클릭 1회·추가 버튼·키보드·선택 유형의 끝 추가) |
| 섹션 접기·펼치기·탭 구분 | `node tests/browser_builder_sections.cjs` (전체/개별 접기·키보드·재렌더·삽입·저장 데이터 보존) |
| 작업 공간·바깥 스크롤·단일 편집 화면 | `node tests/browser_builder_workspace.cjs` (상단 안내 복귀·본문 높이 확보·탭/창 크기 변경·초안/선택/접기 보존) |
| 제작기 독립 스크롤·본문 탐색 | `node tests/browser_builder_scroll.cjs` (합성 80문항, 중앙/좌우 독립·키보드·탭 위치·문항 추가·터치 화면) |
| 제작기 탭·양쪽 패널·설정 배치 | `node tests/browser_builder_tabs.cjs` (합성 API, 360/768/1440px의 탭·포커스·초안 유지) |
| 제작기 수동 저장·변경 취소 | `test_frontend_builder_save.py`, 이동이 바뀌면 `test_frontend_spa_lifecycle.py` |
| 공통 환경 설정·업무 이동 | `test_frontend_workflow_runtime.py`, `test_frontend_workspace_navigation.py` |
| HTML/CSS/JS 편집·격리 미리보기 | `test_frontend_code_editor.py`, `test_custom_code_events.py`, HTML 계약 변경 시 `test_survey_document_contract.py` |
| 표시 문구·결과 코드·내보내기 | `test_answer_codes.py`, `test_response_export.py`, `test_question_contract.py`의 관련 테스트 |
| 공개 URL·확정·배포 센터 | `test_publication_links.py`, `test_frontend_publication_navigation.py`, `test_frontend_distribution.py` |
| 도메인·CORS·로그인/쓰기 Origin | `test_config_compat.py`, `test_domain_access.py` |
| 공개 제출 제한·질문 검증 | `test_request_guard.py`, `test_question_contract.py`, `test_survey_audience_codes.py`의 관련 테스트 |
| Oracle SQL·pool·schema | `test_oracle_repository.py`, `test_database_pool.py`, `test_schema_contract.py`의 관련 테스트 |
| 검증 스크립트 자체 | `test_validation_script.py` |

## 실행 예시

프로젝트 루트에서 실행합니다. 환경은 이미 구성되어 있다는 전제이며, 매 수정마다 설치하거나 서버를 재시작하지 않습니다.

문항 삽입만 수정한 경우:

```powershell
node --check frontend/js/M02003.js
.\venv\Scripts\python.exe -B -m pytest -q -p no:cacheprovider tests/test_frontend_builder_insertion.py
```

제목 번호 표시만 바꿨고 삽입 처리에는 영향이 없는 경우:

```powershell
node --check frontend/js/M02003.js
.\venv\Scripts\python.exe -B -m pytest -q -p no:cacheprovider tests/test_frontend_builder_insertion.py::test_display_title_edits_preserve_original_prefix_and_auto_number_off_setting
```

저장 복원 로직만 수정한 경우:

```powershell
node --check frontend/js/M02003.js
.\venv\Scripts\python.exe -B -m pytest -q -p no:cacheprovider tests/test_frontend_builder_save.py
```

실제 DOM 동작을 바꿨으면 합성 데이터로 해당 동작을 브라우저에서 재현합니다. 기존 브라우저 스크립트는 여러 시나리오가 상태를 이어서 쓰므로 이름 필터로 무작정 건너뛰지 않습니다. 필요한 기능을 기존의 독립 fixture/reset으로 재현하거나, 반복 검증이 필요한 경우 그 기능을 독립 실행 가능한 테스트로 분리합니다. 광범위한 UI 흐름이 바뀌면 기존 묶음을 실행합니다. 운영 데이터에 접근하거나 임시 기능 테스트를 위해 실제 발송을 하지 않습니다.

전체 검사가 필요한 경우:

```powershell
$env:SURVEYONE_LOAD_DOTENV = 'false'
.\scripts\validate-source.ps1
```

pytest는 `tests/conftest.py`가 테스트 전용 memory 모드와 `.env` 로드 차단을 강제합니다. memory/가짜 Oracle 기반 테스트는 운영 Oracle 접속·저장 성공의 증거가 아닙니다. 운영 검증이 필요하면 AGENTS.md의 별도 절차를 적용합니다.

## 반복 실행과 결과 보고

- 같은 수정 작업에서는 한 동작을 구현할 때마다 전체 검사하지 않고, 의미 있는 변경 묶음이 완성된 뒤 관련 검사를 실행합니다.
- 앞서 성공한 검사에 영향을 주지 않는 후속 수정은 재실행 범위에서 제외합니다. 예: 문항 삽입을 검증한 뒤 설명 문구만 고쳤다면 그 문구·레이아웃을 확인합니다.
- 소스뿐 아니라 테스트·fixture·의존성·환경이 바뀌면 그 영향을 받는 검증 결과를 다시 확인합니다. 관련 실패가 남은 상태에서 성공했던 과거 결과로 완료하지 않습니다.
- 확인하지 않은 의존성을 추정하는 자동 캐시나 변경 파일명만으로 테스트를 고르는 플러그인은 기본으로 도입하지 않습니다. 현재 규모에서는 직접 선택하는 것이 단순하며 별도 도구 설치가 필요하지 않습니다.
- 최종 보고는 실제로 실행한 범위와 중요한 한계를 짧게 기록합니다. 전체·브라우저·운영 검증을 하지 않았다면 해당 검증까지 성공했다고 표현하지 않습니다. 매 수정마다 별도 결과 문서를 생성할 필요는 없습니다.
- 회귀 테스트는 재발 방지 가치가 있는 사용자 동작·데이터 계약에 추가합니다. 단순 문구·색상 변경에 테스트를 자동으로 늘리거나 기존 구현을 복제한 검사를 만들지 않습니다.

공개 한 문항씩 보기의 상단 이동·첫 소개·마지막 제출은 `node tests/browser_public_paged.cjs`로 점검합니다. 80문항·60개 보기·30행 매트릭스의 PC/태블릿/모바일과 별도 미리보기 iframe을 사용하며 운영 데이터에 접근하지 않습니다. 미리보기 fixture만 바꾼 경우 `$env:SURVEYONE_PAGED_PREVIEW_ONLY='1'`로 독립된 iframe 시나리오만 실행할 수 있습니다. 전체 묶음을 실행할 때는 해당 변수를 해제합니다.
