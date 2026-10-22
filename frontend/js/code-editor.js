(function () {
    "use strict";

    const ACE_BASE = "/frontend/vendor/ace";
    const SOURCE_LIMIT_BYTES = 512 * 1024;
    const TOTAL_LIMIT_BYTES = 1024 * 1024;
    const SOURCE_META = Object.freeze({
        html: { label: "HTML", mode: "html", placeholder: "HTML을 입력하세요. 예제는 아래 도움말에서 추가할 수 있습니다." },
        css: { label: "CSS", mode: "css", placeholder: "공개 설문에 적용할 CSS를 입력하세요." },
        javascript: { label: "JavaScript", mode: "javascript", placeholder: "격리 영역에서 실행할 JavaScript를 입력하세요." }
    });
    let acePromise = null;
    const EVENT_TYPES = Object.freeze(["load", "answerChange", "pageChange", "beforeSubmit"]);
    const EVENT_EXAMPLE = `SurveyOne.on("load", ({ survey }) => {
  const output = document.querySelector("[data-survey-event]");
  if (output) output.textContent = (survey?.title || "설문") + " 준비 완료";
});
SurveyOne.on("pageChange", ({ questionId }) => {
  const output = document.querySelector("[data-survey-event]");
  if (output) output.textContent = questionId ? "문항 이동: " + questionId : "설문 안내";
});
SurveyOne.on("answerChange", ({ questionId }) => {
  const output = document.querySelector("[data-survey-event]");
  if (output) output.textContent = "응답 변경: " + questionId;
});
SurveyOne.on("beforeSubmit", () => {
  const output = document.querySelector("[data-survey-event]");
  if (output) output.textContent = "제출 직전 알림";
});
// 이벤트는 알림만 제공하며 제출을 취소하거나 응답을 변경하지 않습니다.
// SurveyOne.on()은 등록 해제 함수를 반환합니다. DOM 편집은 이 격리 영역 안에서 합니다.`;

    function sendEvent(frame, type, detail = {}) {
        if (!EVENT_TYPES.includes(type) || !frame?.contentWindow) return;
        frame.contentWindow.postMessage({ type: "surveyone-lifecycle", event: type, detail }, "*");
    }

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
            script.addEventListener("error", () => { script.remove(); reject(new Error("코드 편집기를 불러오지 못했습니다. 창을 닫고 다시 열어 주세요.")); }, { once: true });
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
            }).catch((error) => { acePromise = null; throw error; });
        }
        return acePromise;
    }

    function escapeScriptEnd(value) {
        return String(value || "").replace(/<\/script/gi, "<\\/script");
    }

    function sandboxDocument(sources, { email = false, presentationStyles = "" } = {}) {
        const source = normalize(sources);
        const html = source.html.trim() || '<section class="custom-code-empty"><strong>미리보기할 HTML을 입력해 주세요.</strong></section>';
        const resizeScript = email ? "" : `<script>
            (() => {
                const allowed = new Set(["load", "answerChange", "pageChange", "beforeSubmit"]);
                const handlers = new Map();
                let context = Object.freeze({});
                const immutable = (value) => {
                    if (value && typeof value === "object") {
                        Object.values(value).forEach(immutable);
                        Object.freeze(value);
                    }
                    return value;
                };
                const showError = (error) => {
                    const output = document.querySelector("[data-custom-code-error]");
                    if (output) { output.hidden = false; output.textContent = "JavaScript 오류: " + (error?.message || String(error)); }
                };
                window.SurveyOne = Object.freeze({
                    on(type, callback) {
                        if (!allowed.has(type) || typeof callback !== "function") throw new TypeError("지원하는 설문 이벤트와 함수를 지정해 주세요.");
                        if (!handlers.has(type)) handlers.set(type, new Set());
                        handlers.get(type).add(callback);
                        return () => handlers.get(type)?.delete(callback);
                    },
                    off(type, callback) { handlers.get(type)?.delete(callback); },
                    getContext() { return context; }
                });
                addEventListener("message", (event) => {
                    if (event.source !== parent || event.origin !== ${JSON.stringify(globalThis.origin || location.origin)}) return;
                    const message = event.data;
                    if (message?.type !== "surveyone-lifecycle" || !allowed.has(message.event)) return;
                    const detail = immutable(structuredClone(message.detail || {}));
                    if (message.event === "load") context = detail;
                    for (const handler of handlers.get(message.event) || []) {
                        try { Promise.resolve(handler(detail)).catch(showError); }
                        catch (error) { showError(error); }
                    }
                });
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
        return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${localAssets}; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; font-src data:; media-src ${localAssets}; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"><style>html{color:#17233a;background:transparent;font-family:'Noto Sans KR','Malgun Gothic',system-ui,-apple-system,BlinkMacSystemFont,sans-serif}body{margin:0;padding:16px;line-height:1.6}.custom-code-empty{padding:32px;color:#687891;text-align:center;background:#f5f7fb;border:1px dashed #cad4e2;border-radius:12px}[data-custom-code-error]{padding:10px 12px;color:#a6192e;background:#fff0f2;border:1px solid #f1bdc5;border-radius:8px;white-space:pre-wrap}${presentationStyles}${source.css}</style></head><body><output data-custom-code-error hidden></output>${html}${resizeScript}${userScript}</body></html>`;
    }

    function editorMarkup({ title, description, tabs, allowEnable, allowPlacement, richHtml }) {
        const tabButtons = tabs.map((key, index) => `<button type="button" role="tab" id="source-tab-${key}" aria-controls="source-panel-${key}" tabindex="${index === 0 ? 0 : -1}" aria-selected="${index === 0}" data-code-tab="${key}">${SOURCE_META[key].label}</button>`).join("");
        const richModes = richHtml ? '<div class="notice-edit-modes" role="group" aria-label="HTML 편집 방식"><button type="button" data-html-mode="visual" aria-pressed="true">서식 편집</button><button type="button" data-html-mode="code" aria-pressed="false">HTML 코드</button><small>선택한 안내문</small></div><div class="notice-rich-editor" data-rich-editor></div>' : "";
        const panels = tabs.map((key, index) => `<section class="source-editor-panel" role="tabpanel" id="source-panel-${key}" aria-labelledby="source-tab-${key}" data-code-panel="${key}" ${index ? "hidden" : ""}>${key === "html" ? richModes : ""}<div class="source-editor-host" ${richHtml && key === "html" ? "hidden" : ""} data-code-editor="${key}" aria-label="${SOURCE_META[key].label} 코드 편집기"></div></section>`).join("");
        return `<section class="source-editor-shell">
            <header class="source-editor-heading"><div><span class="eyebrow">HTML · CSS · JAVASCRIPT</span><h2>${Common.escapeHtml(title)}</h2><p>${Common.escapeHtml(description)}</p></div><span class="source-editor-security">격리 미리보기</span></header>
            <div class="source-editor-options">
                ${allowEnable ? '<label class="source-editor-enable"><span><strong>확정 버전에 적용</strong><small>끄면 소스는 보존하지만 공개 설문에는 표시하지 않습니다.</small></span><span class="source-editor-switch"><input type="checkbox" role="switch" data-code-enabled aria-label="확정 버전에 사용자 코드 적용"><span data-code-enabled-label aria-hidden="true">사용 안 함</span></span></label>' : ""}
                ${allowPlacement ? '<label class="form-field">HTML 배치 위치<select data-code-placement><option value="beforeQuestions">설문 소개 다음</option><option value="afterQuestions">마지막 문항 다음</option></select></label>' : ""}
            </div>
            ${tabs.includes("javascript") ? `<details class="source-editor-event-help"><summary>설문 이벤트 함수 사용법</summary><p><code>SurveyOne.on("load", handler)</code>로 시작하고 <code>answerChange</code>, <code>pageChange</code>, <code>beforeSubmit</code> 알림을 받을 수 있습니다. HTML과 JavaScript는 격리 영역에서 동작하며 CSS는 설문 폼에도 범위를 제한해 적용됩니다. 문항 분기·필수 응답·선택 제한은 제작기의 문항 설정에서 지정하세요.</p><p><button type="button" class="button button-function" data-code-event-example>이벤트 예제 추가</button> HTML 표시 영역과 JavaScript 예제를 함께 추가합니다. 아래 버튼으로 알림 동작을 확인하세요.</p><p>미리보기 이벤트: ${EVENT_TYPES.map(type => `<button type="button" class="button button-function" data-code-event="${type}">${type}</button>`).join(" ")}</p></details>` : ""}
            <div class="source-editor-layout">
                <div class="source-editor-workbench"><div class="source-editor-tabs" role="tablist" aria-label="소스 종류">${tabButtons}</div>${panels}<footer><output data-code-metrics></output><output data-code-status role="status"></output></footer></div>
                <aside class="source-editor-preview"><header><strong>보안 미리보기</strong><small>외부 통신·쿠키·부모 화면 접근 차단</small></header><iframe title="사용자 코드 격리 미리보기" sandbox="allow-scripts" referrerpolicy="no-referrer" data-code-preview></iframe></aside>
            </div>
            <footer class="source-editor-actions"><small>코드 적용 후 원래 화면에서 저장해야 합니다.</small><button class="button button-function" type="button" data-code-cancel>취소</button><button class="button button-function button-important" type="button" data-code-apply disabled>코드 적용</button></footer>
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
            allowPlacement: options.allowPlacement !== false && tabs.length > 1,
            richHtml: Boolean(options.richHtml)
        }), { label: options.title || "사용자 코드 편집기", wide: true, initialFocus: "[data-code-tab]" });
        dialog.classList.add("modal-code-editor");
        const editors = new Map();
        let closed = false;
        let applying = false;
        let activeTab = tabs[0];
        let htmlMode = options.richHtml ? "visual" : "code";
        let richEditor = null;
        let richError = null;
        let syncingRich = false;
        const preview = dialog.querySelector("[data-code-preview]");
        const status = dialog.querySelector("[data-code-status]");
        const metrics = dialog.querySelector("[data-code-metrics]");
        const enabled = dialog.querySelector("[data-code-enabled]");
        const placement = dialog.querySelector("[data-code-placement]");
        const applyButton = dialog.querySelector("[data-code-apply]");
        if (enabled) enabled.checked = sources.enabled;
        if (placement) placement.value = sources.placement;
        if (options.richHtml) {
            dialog.classList.add("has-rich-editor");
            dialog.querySelector(".source-editor-enable strong").textContent = "설문 공통 코드 공개 적용";
            dialog.querySelector(".source-editor-enable small").textContent = "안내문 HTML은 항상 표시합니다. 이 스위치는 설문 공통 HTML·CSS·JavaScript의 공개 적용 여부입니다.";
            enabled.setAttribute("aria-label", "설문 공통 HTML·CSS·JavaScript 공개 적용");
            dialog.querySelector("[data-code-event-example]").closest("p").remove();
            const scopeHint = document.createElement("p");
            scopeHint.textContent = `이 안내문만 꾸미는 CSS 선택자: [data-notice-id="${options.noticeId}"] · JavaScript 탭에서는 기존 설문 공통 HTML을 미리 봅니다.`;
            dialog.querySelector(".source-editor-event-help").append(scopeHint);
            dialog.querySelector(".source-editor-actions small").textContent = "적용 후 초안으로 자동 저장됩니다. 공개 설문에는 다시 확정한 뒤 반영됩니다.";
            applyButton.textContent = "변경 적용";
        }

        preview.addEventListener("load", () => sendEvent(preview, "load", { survey: { title: "코드 편집기 미리보기" }, mode: "preview" }));
        dialog.querySelector("[data-code-event-example]")?.addEventListener("click", () => {
            const editor = editors.get("javascript");
            if (!editor) return;
            const htmlEditor = editors.get("html");
            if (htmlEditor && !/\bdata-survey-event\b/.test(htmlEditor.getValue())) {
                htmlEditor.setValue([htmlEditor.getValue(), '<p><output data-survey-event aria-live="polite"></output></p>'].filter(Boolean).join("\n"), -1);
            }
            if (!editor.getValue().includes(EVENT_EXAMPLE)) {
                editor.setValue([editor.getValue().trim(), EVENT_EXAMPLE].filter(Boolean).join("\n\n"), -1);
            }
            renderDebounced.cancel();
            render();
            dialog.querySelector('[data-code-tab="javascript"]')?.click();
        });
        dialog.querySelectorAll("[data-code-event]").forEach(button => button.addEventListener("click", () => {
            const examples = {
                load: { survey: { title: "예제 설문" }, mode: "preview" },
                answerChange: { questionId: "sample_question", answer: "sample_option" },
                pageChange: { sectionId: "sample_section", questionId: "sample_question" },
                beforeSubmit: { mode: "preview" }
            };
            sendEvent(preview, button.dataset.codeEvent, examples[button.dataset.codeEvent]);
        }));

        const currentSources = () => normalize({
            ...sources,
            enabled: enabled ? enabled.checked : true,
            placement: placement ? placement.value : sources.placement,
            ...Object.fromEntries([...editors].map(([key, editor]) => [key, editor.getValue()]))
        });
        const render = () => {
            if (closed || editors.size !== tabs.length) return;
            const current = currentSources();
            if (enabled) dialog.querySelector("[data-code-enabled-label]").textContent = enabled.checked ? "적용함" : "사용 안 함";
            const total = tabs.reduce((sum, key) => sum + byteLength(current[key]), 0);
            metrics.textContent = (options.richHtml ? `안내문 ${byteLength(current.html).toLocaleString("ko-KR")} / 65,536 · ` : "") + `전체 ${total.toLocaleString("ko-KR")} / ${TOTAL_LIMIT_BYTES.toLocaleString("ko-KR")} bytes`;
            try {
                validate(current, tabs);
                if (options.richHtml) window.SurveyContent.validate(current.html);
                if (richError) throw richError;
                applyButton.disabled = applying;
                status.textContent = "문법·크기 기본 검사 통과";
                status.classList.remove("is-error");
                let previewSource = current;
                const noticePreview = options.richHtml && activeTab !== "javascript";
                if (options.richHtml) {
                    dialog.querySelector(".source-editor-preview strong").textContent = noticePreview ? "안내문 미리보기" : "설문 공통 코드 미리보기";
                    previewSource = noticePreview ? { ...current,
                        html: `<div class="public-form"><aside class="survey-document" data-notice-id="${Common.escapeHtml(options.noticeId)}">${window.SurveyContent.render(current.html)}</aside></div>`,
                        css: current.enabled ? current.css.replaceAll(":scope", ".public-form") : "", javascript: ""
                    } : { ...current, html: options.sharedHtml || "" };
                }
                preview.srcdoc = sandboxDocument(previewSource, { email: noticePreview || Boolean(options.email),
                    presentationStyles: noticePreview ? window.SurveyContent.presentationStyles : "" });
            } catch (error) {
                applyButton.disabled = true;
                preview.srcdoc = sandboxDocument({ html: '<p role="status">코드 오류를 수정하면 미리보기가 다시 표시됩니다.</p>' });
                status.textContent = error.message;
                status.classList.add("is-error");
            }
        };
        const renderDebounced = Common.debounce(render, 220);

        const tabButtons = [...dialog.querySelectorAll("[data-code-tab]")];
        const activateTab = (button, focusEditor = true) => {
            activeTab = button.dataset.codeTab;
            tabButtons.forEach((item) => {
                item.setAttribute("aria-selected", String(item === button));
                item.tabIndex = item === button ? 0 : -1;
            });
            dialog.querySelectorAll("[data-code-panel]").forEach((panel) => { panel.hidden = panel.dataset.codePanel !== button.dataset.codeTab; });
            requestAnimationFrame(() => {
                if (closed) return;
                const editor = editors.get(button.dataset.codeTab);
                editor?.resize();
                if (focusEditor && activeTab === "html" && htmlMode === "visual") richEditor?.focus();
                else if (focusEditor) editor?.focus(); else button.focus();
            });
            render();
        };
        tabButtons.forEach((button, index) => {
            button.addEventListener("click", () => activateTab(button));
            button.addEventListener("keydown", (event) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === "Home" ? 0 : event.key === "End" ? tabButtons.length - 1
                    : (index + (event.key === "ArrowRight" ? 1 : -1) + tabButtons.length) % tabButtons.length;
                activateTab(tabButtons[next], false);
            });
        });
        dialog.querySelectorAll("[data-html-mode]").forEach(button => button.addEventListener("click", () => {
            if (!richEditor || !editors.has("html")) return;
            try {
                if (button.dataset.htmlMode === "visual") richEditor.setHtml(editors.get("html").getValue());
                htmlMode = button.dataset.htmlMode;
                richError = null;
                dialog.querySelector("[data-rich-editor]").hidden = htmlMode !== "visual";
                dialog.querySelector('[data-code-editor="html"]').hidden = htmlMode !== "code";
                dialog.querySelectorAll("[data-html-mode]").forEach(item => item.setAttribute("aria-pressed", String(item === button)));
                if (htmlMode === "visual") richEditor.focus();
                else { editors.get("html").resize(); editors.get("html").focus(); }
                render();
            } catch (error) { status.textContent = error.message; status.classList.add("is-error"); applyButton.disabled = true; }
        }));
        enabled?.addEventListener("change", render);
        placement?.addEventListener("change", render);
        dialog.querySelector("[data-code-cancel]").addEventListener("click", () => dialog.close());
        applyButton.addEventListener("click", async () => {
            if (closed || applying || editors.size !== tabs.length) return;
            try {
                const result = validate(currentSources(), tabs);
                if (options.richHtml) window.SurveyContent.validate(result.html);
                if (richError) throw richError;
                applying = true;
                applyButton.disabled = true;
                status.textContent = "적용 중…";
                status.classList.remove("is-error");
                await options.onApply?.(result);
                if (!closed) dialog.close();
            } catch (error) {
                status.textContent = error.message;
                status.classList.add("is-error");
            } finally {
                applying = false;
                if (!closed) applyButton.disabled = false;
            }
        });
        dialog.addEventListener("close", () => {
            closed = true;
            renderDebounced.cancel();
            richEditor?.destroy();
            editors.forEach((editor) => editor.destroy());
            editors.clear();
            dialog.classList.remove("modal-code-editor", "has-rich-editor");
        }, { once: true });
        status.textContent = "코드 편집기를 불러오고 있습니다…";
        try {
            const [ace] = await Promise.all([loadAce(), options.richHtml
                ? loadScript("/frontend/vendor/tiptap/tiptap.min.js?v=3.32.0.1", "tiptap-3.32.0.1")
                    .then(() => loadScript("/frontend/js/rich-editor.js?v=20261022.2", "rich-editor-20261022.2")) : null]);
            if (closed || !dialog.open) return null;
            for (const key of tabs) {
                const host = dialog.querySelector(`[data-code-editor="${key}"]`);
                const editor = ace.edit(host, {
                    mode: `ace/mode/${SOURCE_META[key].mode}`,
                    theme: "ace/theme/tomorrow",
                    value: sources[key],
                    fontSize: 14,
                    fontFamily: '"Cascadia Code", Consolas, "Malgun Gothic", monospace',
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
            if (options.richHtml) {
                const host = dialog.querySelector("[data-rich-editor]");
                richEditor = window.SurveyRichEditor.mount(host, {
                    html: window.SurveyContent.validate(sources.html),
                    onChange: html => {
                        richError = null; syncingRich = true;
                        try { editors.get("html").setValue(html, -1); } finally { syncingRich = false; }
                        renderDebounced();
                    },
                    onError: error => { richError = error; render(); }
                });
                editors.get("html").session.on("change", () => {
                    if (!syncingRich) richError = null;
                });
            }
            render();
        } catch (error) {
            if (closed) return null;
            status.textContent = error.message;
            status.classList.add("is-error");
            applyButton.disabled = true;
        }
        return dialog;
    }

    window.SurveyCodeEditor = Object.freeze({
        SOURCE_LIMIT_BYTES,
        TOTAL_LIMIT_BYTES,
        normalize,
        validate,
        sandboxDocument,
        sendEvent,
        EVENT_TYPES,
        open
    });
})();
