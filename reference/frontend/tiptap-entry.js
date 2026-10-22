import { Editor, Extension, Mark, Node } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";

const tokenAttributes = () => Object.fromEntries(Object.keys(window.SurveyContent.FORMAT_VALUES).map(name => [name, {
    default: null,
    parseHTML: element => window.SurveyContent.FORMAT_VALUES[name].includes(element.getAttribute(name)) ? element.getAttribute(name) : null,
    renderHTML: attributes => attributes[name] ? { [name]: attributes[name] } : {}
}]));
const NoticeFormat = Extension.create({ name: "noticeFormat", addGlobalAttributes() {
    return [{ types: ["paragraph", "heading", "noticeDiv", "table", "tableRow", "tableCell", "tableHeader", "blockquote", "bulletList", "orderedList", "listItem"], attributes: tokenAttributes() }];
} });
const NoticeStyle = Mark.create({ name: "noticeStyle", addAttributes: tokenAttributes,
    parseHTML: () => [{ tag: "span" }], renderHTML: ({ HTMLAttributes }) => ["span", HTMLAttributes, 0] });
const NoticeDiv = Node.create({ name: "noticeDiv", group: "block", content: "block+",
    parseHTML: () => [{ tag: "div" }], renderHTML: ({ HTMLAttributes }) => ["div", HTMLAttributes, 0] });
const NoticeTable = Table.extend({
    addNodeView() {
        return ({ node, HTMLAttributes }) => {
            const dom = document.createElement("table");
            const caption = document.createElement("caption");
            const contentDOM = document.createElement("tbody");
            caption.contentEditable = "false";
            caption.title = "표 안을 선택한 뒤 표 제목 도구로 수정하세요.";
            dom.append(caption, contentDOM);
            const update = current => {
                if (current.type !== node.type) return false;
                for (const key of Object.keys(window.SurveyContent.FORMAT_VALUES)) {
                    if (current.attrs[key]) dom.setAttribute(key, current.attrs[key]); else dom.removeAttribute(key);
                }
                caption.hidden = !current.attrs.caption;
                caption.innerHTML = window.SurveyContent.render(current.attrs.caption || "");
                return true;
            };
            for (const [key, value] of Object.entries(HTMLAttributes)) if (key.startsWith("data-svy-") && value) dom.setAttribute(key, value);
            update(node);
            return { dom, contentDOM, update, ignoreMutation: mutation => mutation.type !== "selection" && !contentDOM.contains(mutation.target) };
        };
    },
    parseHTML() { return [{ tag: "table", contentElement: element => {
        const rows = element.cloneNode(true);
        rows.querySelectorAll(":scope > caption").forEach(caption => caption.remove());
        return rows;
    } }]; },
    addAttributes() { return { caption: { default: null, rendered: false,
        parseHTML: element => element.querySelector(":scope > caption")?.innerHTML || null } }; },
    renderHTML({ node, HTMLAttributes }) {
        const children = [];
        if (node.attrs.caption) {
            const caption = document.createElement("caption");
            caption.innerHTML = window.SurveyContent.render(node.attrs.caption);
            children.push(caption);
        }
        return ["table", HTMLAttributes, ...children, ["tbody", 0]];
    }
});
function cell(base, tag) {
    return base.extend({
        addAttributes() { return { ...this.parent?.(), scope: { default: null,
            parseHTML: element => ["row", "col", "rowgroup", "colgroup"].includes(element.getAttribute("scope")) ? element.getAttribute("scope") : null } }; },
        renderHTML({ node, HTMLAttributes }) {
            const attrs = Object.fromEntries(Object.entries(HTMLAttributes).filter(([key]) => key.startsWith("data-svy-")));
            for (const key of ["colspan", "rowspan"]) if (node.attrs[key] > 1) attrs[key] = node.attrs[key];
            if (tag === "th" && node.attrs.scope) attrs.scope = node.attrs.scope;
            return [tag, attrs, 0];
        }
    });
}
export function create(options) {
    return new Editor({ ...options, injectCSS: false,
        extensions: [StarterKit.configure({ code: false, codeBlock: false, strike: false, horizontalRule: false,
            link: false, heading: { levels: [2, 3, 4] }, trailingNode: false }), NoticeFormat, NoticeStyle, NoticeDiv,
            NoticeTable.configure({ resizable: false }), TableRow, cell(TableCell, "td"), cell(TableHeader, "th")],
        editorProps: { attributes: { class: "survey-document", role: "textbox", "aria-multiline": "true", "aria-label": "안내문 서식 편집 영역" },
            transformPastedHTML: html => window.SurveyContent.render(html) }
    });
}
