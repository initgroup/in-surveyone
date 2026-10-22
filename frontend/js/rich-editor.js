(function () {
    "use strict";
    const actions = [
        ["bold", "굵게", "toggleBold"], ["italic", "기울임", "toggleItalic"], ["underline", "밑줄", "toggleUnderline"],
        ["bulletList", "글머리 목록", "toggleBulletList"], ["orderedList", "번호 목록", "toggleOrderedList"], ["blockquote", "인용", "toggleBlockquote"],
        ["undo", "실행 취소", "undo"], ["redo", "다시 실행", "redo"]
    ];
    const tableActions = [["addRowAfter", "행 추가"], ["addColumnAfter", "열 추가"], ["deleteRow", "행 삭제"],
        ["deleteColumn", "열 삭제"], ["mergeCells", "셀 병합"], ["splitCell", "병합 해제"], ["toggleHeaderRow", "제목 행"], ["deleteTable", "표 삭제"]];
    function mount(host, { html, onChange, onError }) {
        host.innerHTML = `<div class="notice-toolbar" role="group" aria-label="안내문 서식 도구">
            <label>문단<select data-rich-heading aria-label="문단 스타일"><option value="0">본문</option><option value="2">제목 1</option><option value="3">제목 2</option><option value="4">제목 3</option></select></label>
            <label>크기<select data-rich-size aria-label="글자 크기"><option value="">기본</option>${[12,14,16,18,20,24,28,32].map(size => `<option value="${size}">${size}px</option>`).join("")}</select></label>
            <label>색상<select data-rich-color aria-label="글자 색상"><option value="">기본</option><option value="ink">진한 회색</option><option value="blue">파랑</option><option value="green">초록</option><option value="red">빨강</option><option value="purple">보라</option></select></label>
            <label>정렬<select data-rich-align aria-label="문단 정렬"><option value="">기본</option><option value="left">왼쪽</option><option value="center">가운데</option><option value="right">오른쪽</option><option value="justify">양쪽</option></select></label>
            ${actions.map(([name, label]) => `<button type="button" data-rich-action="${name}" aria-label="${label}" ${!["undo", "redo"].includes(name) ? 'aria-pressed="false"' : ""}>${label}</button>`).join("")}
            <button type="button" data-rich-clear>서식 지우기</button>
            <button type="button" data-rich-insert-table>표 삽입 (3×3)</button>
        </div><div class="notice-table-toolbar" role="group" aria-label="표 편집 도구" hidden>
            ${tableActions.map(([command, label]) => `<button type="button" data-rich-table="${command}">${label}</button>`).join("")}
            <label>표 제목<input type="text" maxlength="200" data-rich-caption aria-label="표 제목"></label><button type="button" data-rich-caption-apply>제목 적용</button>
        </div><div class="notice-rich-document" data-rich-document></div><small class="notice-rich-help">Tiptap · 문구를 선택해 서식을 지정하세요. 표 안에서 행·열을 편집합니다. Shift+클릭으로 여러 셀을 선택해 병합하세요. 모바일 도구 모음은 좌우로 스크롤하세요.</small>`;
        let syncing = false;
        let disposed = false;
        let lastHtml = html;
        const updateControls = () => {
            if (disposed) return;
            actions.forEach(([name, , command]) => {
                const button = host.querySelector(`[data-rich-action="${name}"]`);
                if (button.hasAttribute("aria-pressed")) button.setAttribute("aria-pressed", String(editor.isActive(name)));
                else button.disabled = !editor.can()[command]();
            });
            const insideTable = editor.isActive("table");
            host.querySelector(".notice-table-toolbar").hidden = !insideTable;
            tableActions.forEach(([command]) => { host.querySelector(`[data-rich-table="${command}"]`).disabled = !editor.can()[command](); });
            const heading = editor.getAttributes("heading");
            host.querySelector("[data-rich-heading]").value = heading.level || "0";
            const attrs = editor.getAttributes("noticeStyle");
            host.querySelector("[data-rich-size]").value = attrs["data-svy-size"] || "";
            host.querySelector("[data-rich-color]").value = attrs["data-svy-color"] || "";
            host.querySelector("[data-rich-align]").value = (editor.isActive("heading") ? heading : editor.getAttributes("paragraph"))["data-svy-align"] || "";
            const caption = host.querySelector("[data-rich-caption]");
            if (document.activeElement !== caption) {
                const text = document.createElement("div"); text.innerHTML = window.SurveyContent.render(editor.getAttributes("table").caption || ""); caption.value = text.textContent;
            }
        };
        const editor = window.SurveyTiptap.create({ element: host.querySelector("[data-rich-document]"), content: html,
            onUpdate: () => {
                if (syncing || disposed) return;
                try { const value = editor.getHTML(); lastHtml = value; onChange(value); }
                catch (error) { onError(error); }
            }, onSelectionUpdate: () => updateControls(), onTransaction: () => queueMicrotask(updateControls)
        });
        host.querySelectorAll("button").forEach(button => button.addEventListener("mousedown", event => event.preventDefault()));
        actions.forEach(([name, , command]) => host.querySelector(`[data-rich-action="${name}"]`).addEventListener("click", () => editor.chain().focus()[command]().run()));
        host.querySelector("[data-rich-heading]").addEventListener("change", event => {
            const level = Number(event.target.value); const chain = editor.chain().focus();
            (level ? chain.setHeading({ level }) : chain.setParagraph()).run();
        });
        for (const token of ["size", "color"]) host.querySelector(`[data-rich-${token}]`).addEventListener("change", event => editor.chain().focus().setMark("noticeStyle", { [`data-svy-${token}`]: event.target.value || null }).run());
        host.querySelector("[data-rich-align]").addEventListener("change", event => editor.chain().focus()
            .updateAttributes("paragraph", { "data-svy-align": event.target.value || null })
            .updateAttributes("heading", { "data-svy-align": event.target.value || null }).run());
        host.querySelector("[data-rich-clear]").addEventListener("click", () => editor.chain().focus().unsetAllMarks().clearNodes()
            .resetAttributes("paragraph", ["data-svy-align", "data-svy-size", "data-svy-color"]).run());
        host.querySelector("[data-rich-insert-table]").addEventListener("click", () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run());
        tableActions.forEach(([command]) => host.querySelector(`[data-rich-table="${command}"]`).addEventListener("click", () => editor.chain().focus()[command]().run()));
        host.querySelector("[data-rich-caption-apply]").addEventListener("click", () => {
            const text = host.querySelector("[data-rich-caption]").value;
            editor.chain().focus().updateAttributes("table", { caption: Common.escapeHtml(text) || null }).run();
        });
        updateControls();
        return { focus: () => editor.commands.focus(),
            setHtml(value) {
                if (value === lastHtml) return;
                syncing = true;
                try { editor.commands.setContent(window.SurveyContent.validate(value), { emitUpdate: false }); lastHtml = value; }
                finally { syncing = false; }
                updateControls();
            },
            destroy() { disposed = true; editor.destroy(); host.replaceChildren(); }
        };
    }
    window.SurveyRichEditor = Object.freeze({ mount });
})();
