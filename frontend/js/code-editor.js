(function () {
    "use strict";

    const ACE_BASE = "/frontend/vendor/ace";
    const SOURCE_LIMIT_BYTES = 512 * 1024;
    const TOTAL_LIMIT_BYTES = 1024 * 1024;
    const SOURCE_META = Object.freeze({
        html: { label: "HTML", mode: "html", placeholder: '<section class="custom-intro">\n  <h2>설문 안내</h2>\n  <p>응답자에게 보여 줄 내용을 작성하세요.</p>\n</section>' },
        css: { label: "CSS", mode: "css", placeholder: ".custom-intro {\n  padding: 24px;\n  border-radius: 16px;\n  background: #f3f7ff;\n}" },
        javascript: { label: "JavaScript", mode: "javascript", placeholder: 'document.querySelector(".custom-intro")?.classList.add("is-ready");' }
    });
    let acePromise = null;

    function byteLength(value) {
        return new TextEncoder().encode(String(value || "")).length;
    }

    function normalize(value = {}) {
        return {
            enabled: Boolean(value.enabled),
            placement: value.placement === "afterQuestions" ? "afterQuestions" : "beforeQuestions",
            html: String(value.html || ""),
            css: String(value.css || ""),
            javascript: String(value.javascript || "")
        };
    }

    function validate(sources, tabs = Object.keys(SOURCE_META)) {
        const normalized = normalize(sources);
        let total = 0;
        for (const key of tabs) {
            const size = byteLength(normalized[key]);
            total += size;
            if (size > SOURCE_LIMIT_BYTES) throw new Error(`${SOURCE_META[key].label} 소스는 512KB 이하로 작성해 주세요.`);
        }
        if (total > TOTAL_LIMIT_BYTES) throw new Error("HTML·CSS·JavaScript 전체 소스는 1MB 이하로 작성해 주세요.");
        if (tabs.includes("html") && /<\s*\/?\s*(?:script|style|link|base|iframe|object|embed|html|head|body)\b/i.test(normalized.html)) {
            throw new Error("HTML에는 script·style·iframe 같은 문서/실행 태그를 넣지 말고 CSS·JavaScript 탭을 사용해 주세요.");
        }
        if (tabs.includes("html") && /\son[a-z]+\s*=/i.test(normalized.html)) {
            throw new Error("HTML 인라인 이벤트 속성 대신 JavaScript 탭을 사용해 주세요.");
        }
        if (tabs.includes("css") && /@import|expression\s*\(|behavior\s*:|-moz-binding|javascript\s*:|position\s*:\s*fixed|url\s*\(/i.test(normalized.css)) {
            throw new Error("CSS에 외부 import 또는 실행 가능한 URL 표현식을 사용할 수 없습니다.");
        }
        if (tabs.includes("javascript") && normalized.javascript.trim()) {
            try { Function(`"use strict";\n${normalized.javascript}`); }
            catch (error) { throw new Error(`JavaScript 문법을 확인해 주세요. ${error.message}`); }
        }
        return normalized;
    }

    function loadScript(source, marker) {
        const existing = document.querySelector(`script[data-surveyone-library="${marker}"]`);
        if (existing) {
            if (existing.dataset.loaded === "true") return Promise.resolve();
            return new Promise((resolve, reject) => {
                existing.addEventListener("load", resolve, { once: true });
                existing.addEventListener("error", reject, { once: true });
            });
        }
        return new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = source;
            script.async = true;
            script.dataset.surveyoneLibrary = marker;
            script.addEventListener("load", () => { script.dataset.loaded = "true"; resolve(); }, { once: true });
            script.addEventListener("error", () => reject(new Error("코드 편집기 라이브러리를 불러오지 못했습니다.")), { once: true });
            document.head.append(script);
        });
    }

    function loadAce() {
        if (globalThis.ace) return Promise.resolve(globalThis.ace);
        if (!acePromise) {
            acePromise = loadScript(`${ACE_BASE}/ace.js?v=1.44.0`, "ace-1.44.0").then(() => {
                if (!globalThis.ace) throw new Error("Ace Editor를 초기화하지 못했습니다.");
                globalThis.ace.config.set("basePath", ACE_BASE);
                globalThis.ace.config.set("modePath", ACE_BASE);
                globalThis.ace.config.set("themePath", ACE_BASE);
                globalThis.ace.config.set("workerPath", ACE_BASE);
                return globalThis.ace;
            });
        }
        return acePromise;
    }

    function escapeScriptEnd(value) {
        return String(value || "").replace(/<\/script/gi, "<\\/script");
    }

    function sandboxDocument(sources, { email = false } = {}) {
        const source = normalize(sources);
        const html = source.html.trim() || '<section class="custom-code-empty"><strong>미리보기할 HTML을 입력해 주세요.</strong></section>';
        const resizeScript = email ? "" : `<script>
            (() => {
                const report = () => parent.postMessage({ type: "surveyone-custom-resize", height: Math.ceil(document.documentElement.scrollHeight) }, "*");
                addEventListener("load", report);
                new ResizeObserver(report).observe(document.documentElement);
                addEventListener("error", (event) => {
                    const output = document.querySelector("[data-custom-code-error]");
                    if (output) { output.hidden = false; output.textContent = "JavaScript 오류: " + event.message; }
                    report();
                });
            })();
        <\/script>`;
        const userScript = email || !source.javascript.trim() ? "" : `<script>"use strict";\n${escapeScriptEnd(source.javascript)}\n<\/script>`;
        const localAssets = `${location.origin}/frontend/assets/ ${location.origin}/uploads/ data: blob:`;
        return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${localAssets}; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; font-src data:; media-src ${localAssets}; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"><style>html{color:#17233a;background:transparent;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}body{margin:0;padding:16px;line-height:1.6}.custom-code-empty{padding:32px;color:#687891;text-align:center;background:#f5f7fb;border:1px dashed #cad4e2;border-radius:12px}[data-custom-code-error]{padding:10px 12px;color:#a6192e;background:#fff0f2;border:1px solid #f1bdc5;border-radius:8px;white-space:pre-wrap}${source.css}</style></head><body><output data-custom-code-error hidden></output>${html}${resizeScript}${userScript}</body></html>`;
    }

    function editorMarkup({ title, description, tabs, allowEnable, allowPlacement }) {
        const tabButtons = tabs.map((key, index) => `<button type="button" role="tab" aria-selected="${index === 0}" data-code-tab="${key}">${SOURCE_META[key].label}</button>`).join("");
        const panels = tabs.map((key, index) => `<section class="source-editor-panel" role="tabpanel" data-code-panel="${key}" ${index ? "hidden" : ""}><div class="source-editor-host" data-code-editor="${key}" aria-label="${SOURCE_META[key].label} 코드 편집기"></div></section>`).join("");
        return `<section class="source-editor-shell">
            <header class="source-editor-heading"><div><span class="eyebrow">OPEN SOURCE CODE EDITOR · ACE 1.44</span><h2>${Common.escapeHtml(title)}</h2><p>${Common.escapeHtml(description)}</p></div><span class="source-editor-security">격리 미리보기</span></header>
            <div class="source-editor-options">
                ${allowEnable ? '<label class="setting-row compact"><span><strong>확정 버전에 적용</strong><small>끄면 소스는 보존하지만 공개 설문에는 표시하지 않습니다.</small></span><input type="checkbox" data-code-enabled></label>' : ""}
                ${allowPlacement ? '<label class="form-field">HTML 배치 위치<select data-code-placement><option value="beforeQuestions">설문 소개 다음</option><option value="afterQuestions">마지막 문항 다음</option></select></label>' : ""}
            </div>
            <div class="source-editor-layout">
                <div class="source-editor-workbench"><div class="source-editor-tabs" role="tablist" aria-label="소스 종류">${tabButtons}</div>${panels}<footer><output data-code-metrics></output><output data-code-status role="status"></output></footer></div>
                <aside class="source-editor-preview"><header><strong>보안 미리보기</strong><small>외부 통신·쿠키·부모 화면 접근 차단</small></header><iframe title="사용자 코드 격리 미리보기" data-code-preview></iframe></aside>
            </div>
            <footer class="source-editor-actions"><button class="button" type="button" data-code-cancel>취소</button><button class="button button-primary" type="button" data-code-apply>코드 적용</button></footer>
        </section>`;
    }

    async function open(options) {
        const tabs = (options.tabs || Object.keys(SOURCE_META)).filter((key) => SOURCE_META[key]);
        const sources = normalize(options.sources);
        const dialog = options.context.openModal(editorMarkup({
            title: options.title || "HTML·CSS·JavaScript 편집",
            description: options.description || "직접 작성한 코드는 공개 응답 화면의 격리 영역에서 실행됩니다.",
            tabs,
            allowEnable: options.allowEnable !== false,
            allowPlacement: options.allowPlacement !== false && tabs.length > 1
        }), { label: options.title || "사용자 코드 편집기", wide: true, initialFocus: "[data-code-tab]" });
        dialog.classList.add("modal-code-editor");
        const editors = new Map();
        const preview = dialog.querySelector("[data-code-preview]");
        const status = dialog.querySelector("[data-code-status]");
        const metrics = dialog.querySelector("[data-code-metrics]");
        const enabled = dialog.querySelector("[data-code-enabled]");
        const placement = dialog.querySelector("[data-code-placement]");
        if (enabled) enabled.checked = sources.enabled;
        if (placement) placement.value = sources.placement;

        const currentSources = () => normalize({
            ...sources,
            enabled: enabled ? enabled.checked : true,
            placement: placement ? placement.value : "beforeQuestions",
            ...Object.fromEntries([...editors].map(([key, editor]) => [key, editor.getValue()]))
        });
        const render = () => {
            const current = currentSources();
            const total = tabs.reduce((sum, key) => sum + byteLength(current[key]), 0);
            metrics.textContent = `전체 ${total.toLocaleString("ko-KR")} / ${TOTAL_LIMIT_BYTES.toLocaleString("ko-KR")} bytes`;
            try {
                validate(current, tabs);
                status.textContent = "문법·크기 기본 검사 통과";
                status.classList.remove("is-error");
                preview.srcdoc = sandboxDocument(current, { email: Boolean(options.email) });
            } catch (error) {
                status.textContent = error.message;
                status.classList.add("is-error");
            }
        };
        const renderDebounced = Common.debounce(render, 220);

        try {
            const ace = await loadAce();
            if (!dialog.open) return null;
            for (const key of tabs) {
                const host = dialog.querySelector(`[data-code-editor="${key}"]`);
                const editor = ace.edit(host, {
                    mode: `ace/mode/${SOURCE_META[key].mode}`,
                    theme: "ace/theme/tomorrow",
                    value: sources[key],
                    fontSize: 14,
                    showPrintMargin: false,
                    tabSize: 2,
                    useSoftTabs: true,
                    wrap: true,
                    enableBasicAutocompletion: false,
                    enableLiveAutocompletion: false
                });
                editor.session.setUseWorker(true);
                editor.session.on("change", renderDebounced);
                editor.setOption("placeholder", SOURCE_META[key].placeholder);
                editors.set(key, editor);
            }
            render();
        } catch (error) {
            status.textContent = error.message;
            status.classList.add("is-error");
            dialog.querySelector("[data-code-apply]").disabled = true;
        }

        dialog.querySelectorAll("[data-code-tab]").forEach((button) => button.addEventListener("click", () => {
            dialog.querySelectorAll("[data-code-tab]").forEach((item) => item.setAttribute("aria-selected", String(item === button)));
            dialog.querySelectorAll("[data-code-panel]").forEach((panel) => { panel.hidden = panel.dataset.codePanel !== button.dataset.codeTab; });
            const editor = editors.get(button.dataset.codeTab);
            requestAnimationFrame(() => { editor?.resize(); editor?.focus(); });
        }));
        enabled?.addEventListener("change", render);
        placement?.addEventListener("change", render);
        dialog.querySelector("[data-code-cancel]").addEventListener("click", () => dialog.close());
        dialog.querySelector("[data-code-apply]").addEventListener("click", async () => {
            try {
                const result = validate(currentSources(), tabs);
                status.textContent = "적용 중…";
                status.classList.remove("is-error");
                await options.onApply?.(result);
                dialog.close();
            } catch (error) {
                status.textContent = error.message;
                status.classList.add("is-error");
            }
        });
        dialog.addEventListener("close", () => {
            renderDebounced.cancel?.();
            editors.forEach((editor) => editor.destroy());
            editors.clear();
            dialog.classList.remove("modal-code-editor");
        }, { once: true });
        return dialog;
    }

    window.SurveyCodeEditor = Object.freeze({
        SOURCE_LIMIT_BYTES,
        TOTAL_LIMIT_BYTES,
        normalize,
        validate,
        sandboxDocument,
        open
    });
})();
