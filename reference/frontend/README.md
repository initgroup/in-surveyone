# 안내문 편집기 빌드 참조

- Tiptap 3.32.0 (MIT): https://github.com/ueberdosis/tiptap
- 공식 Vanilla JavaScript 설치: https://tiptap.dev/docs/editor/getting-started/install/vanilla-javascript
- 공식 표 확장: https://tiptap.dev/docs/editor/extensions/nodes/table
- esbuild 0.28.2는 정적 번들 생성 도구입니다. 앱 실행에는 Node나 외부 CDN이 필요하지 않습니다.
- `package.json`과 `package-lock.json`은 편집기 재빌드 환경의 기준입니다. 루트 패키지 파일은 기존 보고서·Ace 자산 용도입니다.

프로젝트 루트에서 Node 22 이상 환경으로 실행합니다. 다른 작업 폴더에서는 `--prefix` 뒤에 이 디렉터리의 절대 경로를 지정합니다.

```powershell
npm ci --prefix reference/frontend --ignore-scripts
npm run build --prefix reference/frontend
```

`build.mjs`는 자기 위치에서 경로를 계산합니다. `tiptap-entry.js`의 허용 노드·서식·표 계약으로 `frontend/vendor/tiptap/tiptap.min.js`와 실제 포함된 패키지들의 `LICENSES.txt`를 재생성합니다. 생성된 번들을 직접 수정하지 않습니다. 버전 변경 시 잠금 파일·번들·라이선스·`code-editor.js`의 자산 버전을 함께 갱신합니다. 패키지 감사는 `npm audit --prefix reference/frontend`로 실행합니다.

도구 모음과 화면 동기화 코드는 `frontend/js/rich-editor.js` 및 `code-editor.js`에 있습니다. 허용 서식과 표시 규칙은 `survey-content.js`, 서버 검증은 `backend/models.py`에 있습니다. 일반 안내문은 64KB 제한과 실행 코드 차단을 유지합니다. CSS·JavaScript는 기존 `skin.customCode`를 사용하고 별도 opaque iframe 계약을 유지합니다.

검증은 `scripts/validate-source.ps1`과 합성 데이터만 사용하는 `tests/browser_rich_editor.cjs`, `tests/browser_workflows.cjs`로 수행합니다. 선택적 브라우저 검증은 `SURVEYONE_PLAYWRIGHT_MODULE`을 설치한 `playwright-core` 경로로 지정한 뒤 Node로 실행합니다. DB에 접속하거나 사용자 설문을 수정하지 않습니다.
