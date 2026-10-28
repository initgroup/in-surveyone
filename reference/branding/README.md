# IN-SURVEYONE 아이콘

전용 원본은 [surveyone-mark.svg](../../frontend/assets/images/surveyone-mark.svg)입니다. 기존 파랑·민트 설문 체크 마크를 탭, 홈 화면과 Windows 바로가기에 함께 사용합니다. 배포 파일은 `frontend/assets/images/`에, 재생성 도구와 안내는 이 디렉터리에 보관합니다.

## 재생성

프로젝트의 `scripts/setup-venv.ps1`로 환경을 구성한 뒤 Microsoft Edge가 설치된 Windows에서 실행합니다. 별도 이미지 패키지는 필요하지 않으며 Playwright 버전은 루트 `requirements.txt`에 고정되어 있습니다.

```powershell
.\venv\Scripts\python.exe -B -X utf8 reference/branding/build-icons.py
```

ICO에는 16/32/48/64/128/256px PNG 프레임, PNG에는 180px Apple touch icon과 192/512px 홈 화면 아이콘이 포함됩니다. 원본을 바꾸면 재생성 후 브라우저에서 모양을 확인합니다.

## Windows 바탕화면 바로가기

```powershell
.\scripts\install-desktop-shortcut.ps1
# 로컬 서버용 (서버가 실행 중이어야 합니다)
.\scripts\install-desktop-shortcut.ps1 -Url http://127.0.0.1:8300/
```

기본 주소는 `https://www.insurveyone.com/`입니다. 현재 사용자 바탕화면에 `IN-SURVEYONE.url`을 만들고 기본 브라우저로 엽니다. 아이콘은 `%LOCALAPPDATA%/IN-SURVEYONE/icons/`에 복사하므로 저장소 이동 후에도 유지됩니다. 같은 이름의 바로가기는 갱신하며 서비스 시작·로그인·Git 게시를 수행하지 않습니다. 다른 PC에서는 프로젝트를 옮긴 후 스크립트를 다시 실행합니다. `-DestinationDirectory`로 이미 존재하는 설치 대상 폴더를 지정할 수 있습니다.

관리자 홈은 web manifest도 제공하며 지원 브라우저의 앱/바로가기 만들기와 모바일 홈 화면 추가에 전용 PNG를 사용합니다. 공개 설문과 오류 화면에는 탭·Apple touch 아이콘만 연결합니다. 오프라인 서비스는 제공하지 않습니다.
