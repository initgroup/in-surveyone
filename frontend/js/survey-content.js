(function () {
    "use strict";
    const TAGS = new Set("p br strong em u h2 h3 h4 ul ol li blockquote table caption thead tbody tfoot tr th td div span".split(" "));
    // Rebuild from an allowlist, never insert arbitrary author HTML into an app shell.
    function render(source) {
        const parsed = new DOMParser().parseFromString(String(source || ""), "text/html");
        const output = document.createElement("div");
        const copy = (node, parent) => {
            if (node.nodeType === Node.TEXT_NODE) return parent.append(document.createTextNode(node.textContent));
            if (node.nodeType !== Node.ELEMENT_NODE || !TAGS.has(node.localName)) return;
            const element = document.createElement(node.localName);
            if (["td", "th"].includes(node.localName)) {
                for (const name of ["colspan", "rowspan"]) {
                    const value = Number(node.getAttribute(name));
                    if (Number.isInteger(value) && value >= 1 && value <= 20) element.setAttribute(name, String(value));
                }
                const scope = node.getAttribute("scope");
                if (node.localName === "th" && ["row", "col", "rowgroup", "colgroup"].includes(scope)) element.setAttribute("scope", scope);
            }
            for (const child of node.childNodes) copy(child, element);
            parent.append(element);
        };
        for (const node of parsed.body.childNodes) copy(node, output);
        return output.innerHTML;
    }
    function validate(source) {
        const html = String(source || "");
        if (new TextEncoder().encode(html).length > 65536) throw new Error("안내 서식은 64KB 이하로 작성해 주세요.");
        if (/<!--|<!|<\?/.test(html)) throw new Error("안내 서식에는 주석이나 문서 선언을 사용할 수 없습니다.");
        const parsed = new DOMParser().parseFromString(html, "text/html");
        for (const element of parsed.body.querySelectorAll("*")) {
            if (!TAGS.has(element.localName)) throw new Error(`안내 서식에는 ${element.localName} 태그를 사용할 수 없습니다.`);
            for (const attribute of element.attributes) {
                const cell = ["td", "th"].includes(element.localName);
                if (cell && ["colspan", "rowspan"].includes(attribute.name) && /^(?:[1-9]|1[0-9]|20)$/.test(attribute.value)) continue;
                if (element.localName === "th" && attribute.name === "scope" && ["row", "col", "rowgroup", "colgroup"].includes(attribute.value)) continue;
                throw new Error(`안내 서식에는 ${attribute.name} 속성을 사용할 수 없습니다.`);
            }
        }
        if (/<\s*(?:script|style|link|meta|base|iframe|object|embed)\b/i.test(html)) throw new Error("안내 서식에는 실행 태그를 사용할 수 없습니다.");
        return render(html);
    }
    const presets = Object.freeze({
        cover: "<p>안녕하십니까?</p>\n<p>본 조사는 <strong>조사 목적</strong>을 파악하고 개선 방향을 마련하기 위해 실시합니다.</p>\n<p>응답 내용은 통계 분석 목적으로만 활용됩니다. 다음 안내를 읽고 설문에 참여해 주세요.</p>\n<ul><li>조사 대상: 대상자를 입력하세요.</li><li>응답 방법: 해당하는 보기를 선택해 주세요.</li></ul>",
        table: '<table>\n<caption>응답 기준 안내</caption>\n<thead><tr><th scope="col">구분</th><th scope="col">설명</th></tr></thead>\n<tbody><tr><th scope="row">항목 1</th><td>첫 번째 내용을 입력하세요.</td></tr><tr><th scope="row">항목 2</th><td>두 번째 내용을 입력하세요.</td></tr></tbody>\n</table>'
    });
    window.SurveyContent = Object.freeze({ render, validate, presets });
})();
