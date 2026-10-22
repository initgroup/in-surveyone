// Optional browser regression: SURVEYONE_PLAYWRIGHT_MODULE points to playwright-core.
// Uses a loopback-only static server and synthetic API responses; no live DB or accounts.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require(process.env.SURVEYONE_PLAYWRIGHT_MODULE || "playwright-core");
const root = path.resolve(__dirname, "..");
const output = path.join(root, ".tmp", "rich-editor-review");
const failures = [];
let checks = 0;
const originalHtml = '<p>안내문 원문을 편집합니다.</p>\n<table><caption><strong>응답 기준</strong></caption><thead><tr><th scope="col">구분</th><th scope="col">내용</th></tr></thead><tbody><tr><th scope="row">안내</th><td>표 내용</td></tr><tr><td colspan="2">병합 셀</td></tr></tbody></table>';
const sharedHtml = '<p><output data-shared-output>설문 공통 영역</output></p>';
const originalCode = { enabled: true, placement: "afterQuestions", html: sharedHtml, css: '[data-notice-id="notice1"] { background-color: rgb(240, 248, 255); }', javascript: 'SurveyOne.on("load", () => { document.querySelector("[data-shared-output]").textContent = "기존 코드 실행"; });' };
const notice = { id: "notice1", type: "notice", title: "설문 안내", required: false, settings: { contentHtml: originalHtml } };
const scaleQuestion = { id: "scale1", type: "scale", title: "문항 내용을 이해하고 응답하는 데 필요한 안내가 충분하게 제공되고 있다고 생각하십니까?", min: 1, max: 10, minLabel: "전혀 그렇지 않다", maxLabel: "매우 그렇다", required: true, settings: { scaleDisplay: "slider", scaleOrder: "descending" } };
const question = { id: "q1", type: "single", title: "확인 문항", required: true, options: [{ id: "o1", label: "선택 1" }, { id: "o2", label: "선택 2" }], settings: {} };
let survey = { id: "ui-audit-survey", title: "기능 검증용 합성 설문", description: "실제 응답자가 없는 자동화 테스트", category: "satisfaction", status: "draft", revision: 3, questions: [notice, question, scaleQuestion], sections: [{ id: "sec1", title: "기본", questions: [notice, question, scaleQuestion] }], settings: { presentationMode: "scroll" }, skin: { customCode: originalCode, preset: "ocean", primary: "#2457d6", accent: "#4ed7bd", font: "system", radius: "18px" }, languages: { defaultLocale: "ko", sourceLocale: "ko", activeLocales: ["ko"], translations: {} }, responseCount: 0, createdAt: "2026-10-22T00:00:00Z", updatedAt: "2026-10-22T00:00:00Z" };
const builderFixture = structuredClone(survey);
const report = { surveyId: survey.id, title: survey.title, totalResponses: 200, completedResponses: 200, partialResponses: 0, completionRate: 1, generatedAt: survey.createdAt, questions: [{ questionId: "q1", title: "확인 문항", type: "single", responseCount: 200, optionCounts: { "선택 1": 1, "선택 2": 199 }, distribution: { "선택 1": 1, "선택 2": 199 } }] };
let rejectSave = false;
let lastPatch;
const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const requested = url.pathname === "/" ? "/frontend/index.html" : url.pathname;
    const filename = path.resolve(root, "." + requested);
    if (!filename.startsWith(path.join(root, "frontend") + path.sep)) { res.writeHead(404).end(); return; }
    const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
    fs.readFile(filename, (error, data) => { if (error) res.writeHead(404).end(); else res.writeHead(200, { "Content-Type": types[path.extname(filename)] || "application/octet-stream" }).end(data); });
});
async function check(name, fn) { await fn(); checks += 1; console.log("PASS " + name); }
(async () => {
    fs.mkdirSync(output, { recursive: true });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch({ channel: process.env.SURVEYONE_BROWSER_CHANNEL || "msedge", headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        page.setDefaultTimeout(10000);
        page.on("pageerror", error => failures.push(error.message));
        page.on("dialog", dialog => dialog.type() === "beforeunload" ? dialog.accept() : dialog.dismiss());
        await page.route("**/api/**", async route => {
            const req = route.request();
            const url = new URL(req.url());
            let value;
            let status = 200;
            if (url.pathname === "/api/auth/me") value = { user: { id: "ui-test-user", tenantId: "ui-test-tenant", displayName: "자동화 테스트", role: "OWNER", systemAdmin: true }, expiresAt: new Date(Date.now() + 3600000).toISOString() };
            else if (url.pathname === "/api/runtime-config") value = { publicBaseUrl: "https://www.insurveyone.com", environment: "test" };
            else if (url.pathname === "/api/surveys/page") value = { items: [survey], page: 1, total: 1, totalAll: 1 };
            else if (url.pathname === "/api/surveys") value = { surveys: url.searchParams.has("status") ? [] : [survey] };
            else if (url.pathname === `/api/surveys/${survey.id}`) {
                if (["PATCH", "PUT"].includes(req.method())) {
                    lastPatch = req.postDataJSON();
                    if (rejectSave) { status = 409; value = { detail: "다른 화면에서 수정되었습니다. 다시 불러와 주세요." }; }
                    else { survey = { ...survey, ...lastPatch, revision: survey.revision + 1 }; if (lastPatch.sections) survey.questions = survey.sections.flatMap(section => section.questions); value = { survey }; }
                } else value = { survey };
            }
            else if (url.pathname.endsWith("/report")) value = report;
            else if (url.pathname.endsWith("/responses")) value = { responses: [], items: [], total: 0, columns: [], survey };
            else if (url.pathname === "/api/dashboard") value = { summary: { drafts: 1, active: 0, closed: 0, responses: 0 }, recentSurveys: [survey], responseTrend: [] };
            else if (["/api/templates", "/api/admin/templates"].includes(url.pathname)) value = { items: [], templates: [] };
            else if (url.pathname === "/api/admin/members") value = { items: [], total: 0, page: 1 };
            else if (url.pathname === "/api/deployments/providers") value = { providers: [] };
            else if (url.pathname.startsWith("/api/help/")) { status = 404; value = { detail: "정적 도움말 사용" }; }
            else { failures.push("Unhandled API: " + req.method() + " " + url.pathname); status = 404; value = { detail: "Unknown fixture route" }; }
            await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
        });
        async function navigate(code, params = {}) {
            await page.evaluate(({ code, params }) => window.SurveyOneApp.navigate(code, params), { code, params });
            await page.waitForLoadState("networkidle");
            await page.waitForFunction(code => document.querySelector("[data-page-title]")?.textContent === window.PAGE_CONFIG[code]?.label, code);
            assert.equal(await page.locator(".error-state").filter({ hasText: "화면을 불러오지 못했습니다" }).count(), 0);
        }
        await page.goto(base + "/#/M02003?surveyId=" + survey.id);
        await page.locator("[data-builder-title]").waitFor();
        await check("editor toolbar has consistent controls without overlapping title or status", async () => {
            for (const width of [1920, 1440, 1280, 1024, 768, 360]) {
                await page.setViewportSize({ width, height: 1000 });
                await page.waitForTimeout(80);
                const result = await page.locator(".builder-topbar").evaluate(toolbar => {
                    const controls = [...toolbar.querySelectorAll(".button, .builder-edit-language, .builder-mode-tabs, summary")].filter(el => el.getClientRects().length);
                    const title = toolbar.querySelector("[data-builder-title]").getBoundingClientRect();
                    const actions = toolbar.querySelector(".builder-primary-actions").getBoundingClientRect();
                    return { heights: controls.map(el => [el.textContent.trim().slice(0, 20), el.getBoundingClientRect().height]),
                        overlap: title.left < actions.right && title.right > actions.left && title.top < actions.bottom && title.bottom > actions.top,
                        background: getComputedStyle(toolbar).backgroundColor,
                        overflow: document.documentElement.scrollWidth > innerWidth + 1 };
                });
                assert.equal(result.overlap, false, JSON.stringify({width, result}));
                assert.equal(result.background, "rgb(255, 255, 255)");
                for (const [label, height] of result.heights) assert.equal(height, 44, `${width}: ${label}`);
                assert.equal(result.overflow, false, `Page overflow at ${width}`);
                await page.screenshot({ path: path.join(output, `builder-workspace-${width}.png`) });
            }
            await page.setViewportSize({ width: 1440, height: 1000 });
        });
        await check("file commands are accessible and Escape or outside click closes the menu", async () => {
            await page.click("[data-builder-file-menu] summary");
            await page.locator(".builder-file-menu-panel").waitFor();
            assert.equal(await page.locator("[data-export-draft]").evaluate(el => {
                const rect = el.getBoundingClientRect(); return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest("button") === el;
            }), true);
            await page.keyboard.press("Escape");
            assert.equal(await page.locator("[data-builder-file-menu]").getAttribute("open"), null);
            await page.click("[data-builder-file-menu] summary");
            await page.click("[data-builder-title]");
            assert.equal(await page.locator("[data-builder-file-menu]").getAttribute("open"), null);
            await page.click("[data-builder-file-menu] summary");
            await page.setViewportSize({ width: 1024, height: 1000 });
            await page.waitForFunction(() => !document.querySelector("[data-builder-file-menu]").open);
            await page.setViewportSize({ width: 1440, height: 1000 });
        });
        await check("published controls and long titles stay usable on narrow screens", async () => {
            survey = { ...survey, status: "published", slug: "synthetic-preview" };
            await page.reload();
            await page.locator("[data-builder-public-links]:visible").waitFor();
            await page.evaluate(() => {
                document.querySelector("[data-builder-title]").value = "매우 긴 설문 프로젝트 제목으로 편집 도구의 겹침과 정렬을 확인합니다 ".repeat(4);
            });
            for (const width of [1440, 1024, 360]) {
                await page.setViewportSize({ width, height: 1000 });
                const publish = page.locator(".builder-primary-actions [data-builder-publish]");
                assert.equal(await publish.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
                assert.equal(await publish.evaluate(el => el.getBoundingClientRect().height), 44);
                assert.equal(await page.locator(".builder-topbar").evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
            }
            await page.locator("[data-builder-file-menu] summary").click();
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            assert.equal(await page.locator("[data-export-draft]").evaluate(el => {
                const rect = el.getBoundingClientRect(); return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest("button") === el;
            }), true);
            await page.keyboard.press("Escape");
            survey = { ...survey, status: "draft" }; delete survey.slug;
            await page.setViewportSize({ width: 1440, height: 1000 });
            await page.reload();
            await page.locator('[data-question-id="notice1"]').waitFor();
        });
        await check("editor tabs support keyboard navigation and the inspector clears the toolbar", async () => {
            await page.locator('[data-builder-mode="questions"]').focus();
            await page.keyboard.press("ArrowRight");
            assert.equal(await page.locator('[data-mode-panel="logic"]').isVisible(), true);
            await page.keyboard.press("End");
            assert.equal(await page.locator('[data-mode-panel="settings"]').isVisible(), true);
            await page.keyboard.press("Home");
            assert.equal(await page.locator('[data-mode-panel="questions"]').isVisible(), true);
            await page.setViewportSize({ width: 1024, height: 1000 });
            await page.locator('[data-question-id="notice1"] [data-question-settings]').click();
            await page.locator(".builder-properties.is-open").waitFor();
            await page.waitForTimeout(250);
            const measure = () => page.evaluate(() => ({ toolbar: document.querySelector(".builder-topbar").getBoundingClientRect().bottom, inspector: document.querySelector(".builder-properties").getBoundingClientRect().top,
                top: getComputedStyle(document.querySelector(".builder-properties")).top,
                variable: document.querySelector("[data-builder-shell]").style.getPropertyValue("--builder-toolbar-bottom"),
                scroll: scrollY, header: document.querySelector(".builder-topbar").getBoundingClientRect().top }));
            assert.equal(await page.locator("body").evaluate(el => getComputedStyle(el).fontSize), "16px");
            assert.equal(await page.locator("[data-prop-behavior]").evaluate(el => getComputedStyle(el).fontSize), "16px");
            const descriptions = await page.locator(".builder-properties small").evaluateAll(items => items.filter(el => el.getClientRects().length).map(el => parseFloat(getComputedStyle(el).fontSize)));
            assert.ok(descriptions.length > 0 && descriptions.every(size => size >= 14), descriptions.join(","));
            const title = page.locator('[data-question-id="q1"] [data-question-title]');
            assert.equal(await title.evaluate(el => el.tagName), "TEXTAREA");
            assert.equal(await title.evaluate(el => getComputedStyle(el).fontSize), "18px");
            const originalTitle = await title.inputValue();
            await title.fill("업무의 목표와 절차를 충분히 이해하고 필요한 지원을 받을 수 있는지 구체적인 경험을 기준으로 응답해 주세요. ".repeat(3));
            assert.equal(await title.evaluate(el => el.scrollHeight <= el.clientHeight + 2), true);
            assert.ok(await title.evaluate(el => el.getBoundingClientRect().height > 60));
            await title.fill(originalTitle);
            let rect = await measure();
            assert.ok(rect.inspector >= rect.toolbar - 1, JSON.stringify(rect));
            await page.evaluate(() => window.scrollTo(0, 550));
            await page.waitForTimeout(80);
            rect = await measure();
            assert.ok(rect.inspector >= rect.toolbar - 1, JSON.stringify(rect));
            await page.screenshot({ path: path.join(output, "builder-inspector-1024.png") });
            await page.click("[data-properties-close]");
            await page.evaluate(() => window.scrollTo(0, 0));
            await page.setViewportSize({ width: 1440, height: 1000 });
        });
        await check("scale settings use readable labels, values and help at 100 percent", async () => {
            await page.locator('[data-question-id="scale1"] [data-question-settings]').click();
            for (const width of [1440, 360]) {
                await page.setViewportSize({ width, height: 1000 });
                await page.waitForTimeout(220);
                for (const selector of ["[data-prop-min]", "[data-prop-max]", "[data-prop-scale-order]", "[data-prop-scale-display]"]) {
                    assert.equal(await page.locator(selector).evaluate(el => getComputedStyle(el).fontSize), "16px");
                }
                assert.equal(await page.locator("[data-prop-scale-range-help]").evaluate(el => getComputedStyle(el).fontSize), "14px");
                assert.equal(await page.locator('[data-question-id="scale1"] [data-question-title]').evaluate(el => el.scrollHeight <= el.clientHeight + 2), true);
                assert.equal(await page.locator(".builder-properties").evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
                await page.screenshot({ path: path.join(output, `builder-readable-${width}.png`) });
                if (width === 360) {
                    await page.locator(".builder-properties").evaluate(el => { el.scrollTop = el.scrollHeight; });
                    const last = await page.locator("[data-prop-validation]").boundingBox();
                    const navigation = await page.locator(".mobile-bottom-nav").boundingBox();
                    assert.ok(last.y + last.height <= navigation.y + 1);
                }
            }
            await page.setViewportSize({ width: 1440, height: 1000 });
        });
        await page.locator('[data-question-id="notice1"] [data-question-settings]').click();
        await page.locator("[data-edit-notice-html]").waitFor();
        const getCode = key => page.locator(`[data-code-editor="${key}"]`).evaluate(el => ace.edit(el).getValue());
        const setCode = (key, code) => page.locator(`[data-code-editor="${key}"]`).evaluate((el, value) => ace.edit(el).setValue(value, -1), code);
        async function openNotice() {
            await page.click("[data-edit-notice-html]");
            await page.locator("[data-code-apply]:enabled").waitFor();
            await page.locator(".notice-rich-document .tiptap").waitFor();
        }
        await check("library failure is visible and can retry", async () => {
            let failOnce = true;
            await page.route("**/frontend/vendor/tiptap/tiptap.min.js*", async route => {
                if (failOnce) { failOnce = false; await route.abort("failed"); } else await route.continue();
            });
            await page.click("[data-edit-notice-html]");
            await page.locator("[data-code-status].is-error").waitFor();
            assert.equal(await page.locator("[data-code-apply]").isDisabled(), true);
            await page.click("[data-code-cancel]");
            await openNotice();
            await page.unroute("**/frontend/vendor/tiptap/tiptap.min.js*");
        });
        await check("opening and switching preserve original HTML and shared sources", async () => {
            assert.equal(await getCode("html"), originalHtml);
            assert.equal(await getCode("css"), originalCode.css);
            assert.equal(await getCode("javascript"), originalCode.javascript);
            await page.click('[data-html-mode="code"]');
            await page.click('[data-html-mode="visual"]');
            assert.equal(await getCode("html"), originalHtml);
            assert.equal(await page.locator(".tiptap caption strong").innerText(), "응답 기준");
            assert.equal(await page.locator('.tiptap th[scope="row"]').innerText(), "안내");
            assert.equal(await page.locator('.tiptap td[colspan="2"]').innerText(), "병합 셀");
        });
        await check("toolbar edits fonts and lists while preserving table semantics", async () => {
            await page.locator(".tiptap > p").first().click();
            await page.locator(".tiptap > p").first().evaluate(element => {
                const range = document.createRange(); range.selectNodeContents(element);
                const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
            });
            await page.click('[data-rich-action="bold"]');
            await page.selectOption("[data-rich-size]", "24");
            await page.selectOption("[data-rich-color]", "blue");
            await page.selectOption("[data-rich-align]", "center");
            await page.waitForFunction(() => ace.edit(document.querySelector('[data-code-editor="html"]')).getValue().includes('data-svy-align="center"'));
            const value = await getCode("html");
            for (const token of ['<strong>', 'data-svy-size="24"', 'data-svy-color="blue"', '<caption><strong>응답 기준</strong></caption>', 'scope="row"', 'colspan="2"']) assert.ok(value.includes(token), token);
            const preview = page.frameLocator("[data-code-preview]");
            await preview.locator('[data-svy-size="24"]').first().waitFor();
            assert.equal(await preview.locator('[data-svy-size="24"]').first().evaluate(el => getComputedStyle(el).fontSize), "24px");
            await page.locator(".tiptap > p").first().click();
            await page.click('[data-rich-action="bulletList"]');
            assert.ok((await getCode("html")).includes("<ul>"));
            await page.click('[data-rich-action="undo"]');
            assert.ok(!(await getCode("html")).includes("<ul>"));
        });
        await check("table operations and caption editing serialize safe HTML", async () => {
            await page.locator(".tiptap td").first().click();
            const rows = await page.locator(".tiptap tr").count();
            assert.equal(rows, 3, "Caption must never become an extra table row");
            await page.click('[data-rich-table="addRowAfter"]');
            assert.equal(await page.locator(".tiptap tr").count(), rows + 1);
            await page.fill("[data-rich-caption]", "수정한 표 제목");
            await page.click("[data-rich-caption-apply]");
            assert.ok((await getCode("html")).includes('<caption>수정한 표 제목</caption>'));
            const value = await getCode("html");
            assert.equal(await page.evaluate(html => SurveyContent.validate(html), value), value);
        });
        await check("source sync and invalid markup prevent accidental apply", async () => {
            await page.click('[data-html-mode="code"]');
            const value = await getCode("html");
            await setCode("html", value + '<p>코드로 추가한 문단</p>');
            await page.click('[data-html-mode="visual"]');
            await page.locator(".tiptap p").filter({ hasText: "코드로 추가한 문단" }).waitFor();
            await page.click('[data-html-mode="code"]');
            await setCode("html", '<p onclick="window.injected=true">위험한 코드</p>');
            await page.locator("[data-code-status].is-error").waitFor();
            assert.equal(await page.locator("[data-code-apply]").isDisabled(), true);
            await page.click('[data-html-mode="visual"]');
            assert.equal(await page.locator('[data-html-mode="code"]').getAttribute("aria-pressed"), "true");
            assert.equal(await page.evaluate(() => window.injected), undefined);
            await setCode("html", value + '<p>코드로 추가한 문단</p>');
            await page.locator("[data-code-apply]:enabled").waitFor();
            await page.click('[data-html-mode="visual"]');
        });
        await check("pasted markup is sanitized before entering the editor", async () => {
            await page.locator(".tiptap > p").last().click();
            await page.keyboard.press("End");
            await page.locator(".tiptap").evaluate(element => {
                const clipboardData = new DataTransfer();
                clipboardData.setData("text/html", '<p onclick="window.injected=true">붙여넣기 확인<strong>굵은 문구</strong><script>window.injected=true</script><img src=x onerror="window.injected=true"></p>');
                element.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
            });
            assert.equal(await page.evaluate(() => window.injected), undefined);
            const html = await getCode("html");
            assert.ok(html.includes("붙여넣기 확인"));
            assert.ok(!/onclick|<script|<img/.test(html));
        });
        await check("insert table, merge selected cells and split them", async () => {
            await page.locator(".tiptap > p").last().click();
            await page.keyboard.press("Control+End");
            await page.keyboard.press("Enter");
            await page.click("[data-rich-insert-table]");
            assert.equal(await page.locator(".tiptap table").count(), 2);
            const cells = page.locator(".tiptap table").last().locator("tr").first().locator("th");
            await cells.nth(0).click();
            await cells.nth(1).click({ modifiers: ["Shift"] });
            await page.locator('[data-rich-table="mergeCells"]:enabled').click();
            assert.equal(await page.locator(".tiptap table").last().locator('th[colspan="2"]').count(), 1);
            await page.locator('[data-rich-table="splitCell"]:enabled').click();
            assert.equal(await page.locator(".tiptap table").last().locator('th[colspan="2"]').count(), 0);
            await page.click('[data-rich-table="deleteTable"]');
            assert.equal(await page.locator(".tiptap table").count(), 1);
        });
        await check("CSS notice preview and isolated shared JavaScript preview", async () => {
            await page.click('[data-code-tab="css"]');
            await setCode("css", '[data-notice-id="notice1"] { background-color: rgb(230, 240, 255); }');
            const frame = page.frameLocator("[data-code-preview]");
            await frame.locator('[data-notice-id="notice1"]').waitFor();
            await page.waitForTimeout(300);
            assert.equal(await frame.locator('[data-notice-id="notice1"]').evaluate(el => getComputedStyle(el).backgroundColor), "rgb(230, 240, 255)");
            await page.click('[data-code-tab="javascript"]');
            await frame.locator("[data-shared-output]").filter({ hasText: "기존 코드 실행" }).waitFor();
            await setCode("javascript", 'SurveyOne.on("load", () => { try { parent.document.body.dataset.unsafe = "true"; } catch { document.querySelector("[data-shared-output]").textContent = "격리 확인"; } });');
            await frame.locator("[data-shared-output]").filter({ hasText: "격리 확인" }).waitFor();
            assert.equal(await page.locator("body").getAttribute("data-unsafe"), null);
            assert.equal(await page.locator("[data-code-preview]").getAttribute("sandbox"), "allow-scripts");
        });
        await check("desktop tablet and mobile controls fit", async () => {
            await page.click('[data-code-tab="html"]');
            for (const width of [1440, 768, 360]) {
                await page.setViewportSize({ width, height: 1000 });
                await page.locator("[data-code-apply]").scrollIntoViewIfNeeded();
                assert.ok(await page.locator(".source-editor-shell").evaluate(el => el.scrollWidth <= el.clientWidth + 1));
                assert.ok(await page.locator("[data-code-apply]").isVisible());
                await page.locator("[data-html-mode=visual]").scrollIntoViewIfNeeded();
                await page.locator(".notice-rich-document").evaluate(el => { el.scrollTop = 0; });
                await page.screenshot({ path: path.join(output, `notice-${width}.png`) });
            }
            await page.setViewportSize({ width: 1440, height: 1000 });
        });
        await check("save and reopen preserve shared HTML placement and notice; cancel discards edits", async () => {
            await page.click("[data-code-apply]");
            await page.locator(".modal-code-editor").waitFor({ state: "hidden" });
            await page.click("[data-builder-save]");
            await page.waitForFunction(() => !window.Pages.M02003.hasUnsavedChanges());
            assert.equal(survey.skin.customCode.html, sharedHtml);
            assert.equal(survey.skin.customCode.placement, "afterQuestions");
            assert.equal(survey.skin.customCode.enabled, true);
            assert.match(survey.skin.customCode.css, /230, 240, 255/);
            assert.match(survey.skin.customCode.javascript, /격리 확인/);
            const saved = survey.questions.find(q => q.id === "notice1").settings.contentHtml;
            assert.match(saved, /data-svy-size="24"/); assert.match(saved, /코드로 추가한 문단/);
            await openNotice();
            assert.equal(await getCode("html"), saved);
            await page.click('[data-html-mode="code"]');
            await setCode("html", "<p>취소할 내용</p>");
            await page.click("[data-code-cancel]");
            await openNotice();
            assert.equal(await getCode("html"), saved);
            await page.click("[data-code-cancel]");
        });
        await check("closing notice editor restores the normal shared code editor", async () => {
            await page.click("[data-builder-code]");
            await page.locator("[data-code-apply]:enabled").waitFor();
            assert.equal(await getCode("html"), sharedHtml);
            assert.equal(await page.locator(".has-rich-editor").count(), 0);
            assert.equal(await page.locator("[data-html-mode]").count(), 0);
            await page.click("[data-code-cancel]");
        });
        await check("public renderer preserves saved formats, scoped CSS and isolated JavaScript", async () => {
            await page.click("[data-builder-preview]");
            const frame = page.frameLocator("[data-interactive-preview]");
            const noticeView = frame.locator('[data-notice-id="notice1"]');
            await noticeView.waitFor();
            assert.equal(await noticeView.locator('[data-svy-size="24"]').first().evaluate(el => getComputedStyle(el).fontSize), "24px");
            assert.equal(await noticeView.evaluate(el => getComputedStyle(el).backgroundColor), "rgb(230, 240, 255)");
            assert.equal(await noticeView.locator("caption").innerText(), "수정한 표 제목");
            await frame.frameLocator("[data-public-custom-code]").locator("[data-shared-output]").filter({ hasText: "격리 확인" }).waitFor();
            await page.locator('[data-modal] button[aria-label="닫기"]').click();
        });
        await check("preview defaults to readable unscaled device pixels and scrolls at desktop resolution", async () => {
            await page.click("[data-builder-preview]");
            const frame = page.frameLocator("[data-interactive-preview]");
            await frame.locator('[data-notice-id="notice1"]').waitFor();
            assert.equal(await page.locator("[data-preview-scale]").inputValue(), "actual");
            assert.equal(await page.locator("[data-preview-viewport]").evaluate(el => getComputedStyle(el).transform), "none");
            assert.equal(await frame.locator("html").evaluate(() => innerWidth), 390);
            await page.selectOption("[data-preview-device-size]", "desktop-1440");
            assert.equal(await frame.locator("html").evaluate(() => innerWidth), 1440);
            assert.equal(await frame.locator("html").evaluate(() => innerHeight), 900);
            assert.equal(await page.locator("[data-preview-viewport]").evaluate(el => el.getBoundingClientRect().width), 1440);
            const scroll = await page.locator("[data-preview-stage]").evaluate(el => {
                el.scrollLeft = el.scrollWidth; el.scrollTop = el.scrollHeight;
                return { x: el.scrollLeft, y: el.scrollTop, width: el.scrollWidth, height: el.scrollHeight };
            });
            assert.ok(scroll.x > 0 && scroll.y > 0, JSON.stringify(scroll));
            await frame.locator('input[type="radio"]').first().check();
        });
        await check("fit is optional and resizing or switching modes keeps preview answers", async () => {
            const frame = page.frameLocator("[data-interactive-preview]");
            await page.selectOption("[data-preview-scale]", "fit");
            assert.ok(await page.locator("[data-preview-size-status]").innerText().then(text => text.includes("화면 맞춤")));
            const width = await page.locator("[data-preview-viewport]").evaluate(el => el.getBoundingClientRect().width);
            assert.ok(width < 1440);
            assert.equal(await frame.locator("html").evaluate(() => innerWidth), 1440);
            assert.equal(await frame.locator('input[type="radio"]').first().isChecked(), true);
            await page.selectOption("[data-preview-scale]", "actual");
            for (const width of [1440, 768, 360]) {
                await page.setViewportSize({ width, height: 1000 });
                assert.equal(await page.locator("[data-preview-viewport]").evaluate(el => getComputedStyle(el).transform), "none");
                assert.equal(await frame.locator("html").evaluate(() => innerWidth), 1440);
                assert.equal(await frame.locator('input[type="radio"]').first().isChecked(), true);
                assert.ok(await page.locator(".builder-preview-simulator").evaluate(el => el.scrollWidth <= el.clientWidth + 1));
                await page.locator("[data-preview-stage]").evaluate(el => { el.scrollLeft = 0; el.scrollTop = 0; });
                await page.screenshot({ path: path.join(output, `preview-actual-${width}.png`) });
            }
            await page.setViewportSize({ width: 1440, height: 1000 });
            await page.selectOption("[data-preview-device-size]", "custom");
            await page.fill("[data-preview-custom-width]", "1024");
            await page.fill("[data-preview-custom-height]", "768");
            assert.equal(await frame.locator("html").evaluate(() => innerWidth), 1024);
            assert.equal(await frame.locator("html").evaluate(() => innerHeight), 768);
            assert.equal(await frame.locator('input[type="radio"]').first().isChecked(), true);
            await page.locator('[data-modal] button[aria-label="닫기"]').click();
        });
        await check("admin template registration stays visible in the unified desktop and mobile toolbar", async () => {
            await page.goto(base + "/#/M02003?surveyId=" + survey.id + "&templateAdmin=1");
            await page.locator('[data-question-id="notice1"]').waitFor();
            for (const width of [1440, 360]) {
                await page.setViewportSize({ width, height: 1000 });
                assert.equal(await page.locator("[data-template-admin-publish]").isVisible(), true);
                assert.equal(await page.locator("[data-builder-publish]").isVisible(), false);
                assert.equal(await page.locator("[data-template-admin-publish]").evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
                assert.equal(await page.locator("[data-template-admin-publish]").evaluate(el => el.getBoundingClientRect().height), 44);
            }
        });
        async function resetBuilder(overrides = {}) {
            await page.goto("about:blank");
            survey = { ...structuredClone(builderFixture), ...structuredClone(overrides) };
            await page.setViewportSize({ width: 1440, height: 1000 });
            await page.goto(base + "/#/M02003?surveyId=" + survey.id);
            await page.locator('[data-question-id="q1"]').waitFor();
        }
        async function saveBuilder() {
            await page.locator("[data-builder-save]").click();
            await page.waitForFunction(() => document.querySelector("[data-builder-save-label]")?.dataset.saveState === "saved");
        }
        function insertionFixture() {
            const first = {...structuredClone(question),title:"7. 첫 번째 기존 문항"};
            const last = {...structuredClone(scaleQuestion),title:"(99) 두 번째 기존 문항"};
            const exempt = {id:"exempt",type:"short_text",title:"번호 제외 항목",settings:{excludeFromNumbering:true}};
            return {sections:[{id:"sec1",title:"첫 섹션",questions:[structuredClone(notice),first]},{id:"sec2",title:"두 번째 섹션",questions:[last,exempt]},{id:"sec3",title:"비어 있는 마지막 섹션",questions:[]}],questions:[notice,first,last,exempt],settings:{presentationMode:"scroll",showQuestionNumbers:true}};
        }
        const cardOrder = () => page.locator(".question-card").evaluateAll(cards=>cards.map(card=>card.dataset.questionId));
        await check("question above and below insertion renumbers across sections and survives explicit save and reopening", async () => {
            await resetBuilder(insertionFixture());
            lastPatch=null;
            const first=page.locator('[data-question-id="q1"]');
            await first.locator("[data-question-title]").focus();
            assert.equal(await first.locator("[data-question-title]").inputValue(),"첫 번째 기존 문항");
            await first.locator('[data-question-insert="before"]').click();
            await page.locator("[data-insert-type]").first().waitFor();
            assert.equal(await page.locator("[data-insert-type]").count(),14);
            assert.match(await page.locator(".builder-insert-dialog header").innerText(),/1번 문항 바로 위/);
            await page.locator('[data-insert-type="short_text"]').click();
            await page.waitForFunction(()=>document.querySelector('.question-card[aria-current="true"]')?.dataset.questionId!=="q1");
            const beforeId=await page.locator('.question-card[aria-current="true"]').getAttribute("data-question-id");
            assert.deepEqual(await cardOrder(),["notice1",beforeId,"q1","scale1","exempt"]);
            assert.equal(await first.locator(".question-index").innerText(),"02");
            assert.equal(await page.locator('[data-question-id="scale1"] .question-index').innerText(),"03");
            await page.locator('[data-question-id="q1"] [data-question-title]').focus();
            await page.locator('[data-question-id="q1"] [data-question-insert="after"]').click();
            assert.match(await page.locator(".builder-insert-dialog header").innerText(),/2번 문항 바로 아래/);
            await page.locator('[data-insert-type="date"]').click();
            await page.waitForFunction(()=>document.querySelector('.question-card[aria-current="true"]')?.dataset.questionId!=="q1");
            const afterId=await page.locator('.question-card[aria-current="true"]').getAttribute("data-question-id");
            const order=["notice1",beforeId,"q1",afterId,"scale1","exempt"];
            assert.deepEqual(await cardOrder(),order);
            assert.deepEqual(await page.locator(".question-index").allTextContents(),["—","01","02","03","04","—"]);
            assert.equal(lastPatch,null);
            await saveBuilder();
            assert.equal(survey.sections[0].questions[1].type,"short_text");
            assert.equal(survey.sections[0].questions[3].type,"date");
            assert.equal(survey.questions.find(q=>q.id==="q1").title,"7. 첫 번째 기존 문항");
            assert.equal(survey.questions.find(q=>q.id==="scale1").title,"(99) 두 번째 기존 문항");
            await page.reload();await page.locator('[data-question-id="q1"]').waitFor();
            assert.deepEqual(await cardOrder(),order);
            assert.deepEqual(await page.locator(".question-index").allTextContents(),["—","01","02","03","04","—"]);
            await page.locator("[data-builder-preview]").click();
            const frame=page.frameLocator("[data-interactive-preview]");
            await frame.locator('[data-question-id="q1"] h2').waitFor();
            assert.match(await frame.locator('[data-question-id="q1"] h2').innerText(),/^2\. 첫 번째 기존 문항/);
            assert.match(await frame.locator('[data-question-id="scale1"] h2').innerText(),/^4\. 두 번째 기존 문항/);
            await page.locator('[data-modal] button[aria-label="닫기"]').click();
        });
        await check("bottom add uses the palette type at the survey tail while picker cancellation does not save", async () => {
            await resetBuilder(insertionFixture());lastPatch=null;
            await page.locator('[data-question-id="q1"] [data-question-title]').focus();
            await page.selectOption("[data-insertion-position]","before");
            assert.equal(await page.locator("[data-builder-discard]").isDisabled(),true);
            await page.locator('[data-question-id="q1"] [data-question-insert="before"]').click();
            assert.match(await page.locator(".builder-insert-dialog header").innerText(),/바로 위/);
            await page.keyboard.press("Escape");
            await page.locator("[data-modal]").waitFor({state:"hidden"});
            assert.deepEqual(await cardOrder(),["notice1","q1","scale1","exempt"]);
            assert.equal(await page.locator("[data-builder-discard]").isDisabled(),true);
            await page.locator('[data-question-type="number"]').click();
            await page.locator("[data-canvas-add]").click();
            await page.waitForFunction(()=>document.querySelector('.question-card[aria-current="true"]')?.dataset.sectionId==="sec3");
            const tailId=await page.locator('.question-card[aria-current="true"]').getAttribute("data-question-id");
            assert.deepEqual(await cardOrder(),["notice1","q1","scale1","exempt",tailId]);
            assert.equal(lastPatch,null);
            await page.locator("[data-properties-close]").click();
            await page.locator('.builder-section-heading[data-section-id="sec1"] [data-section-select]').click();
            assert.match(await page.locator(".builder-insert-dialog header").innerText(),/섹션 1의 맨 끝/);
            await page.locator('[data-insert-type="long_text"]').click();
            await page.waitForFunction(()=>document.querySelector('.question-card[aria-current="true"]')?.dataset.sectionId==="sec1");
            const sectionId=await page.locator('.question-card[aria-current="true"]').getAttribute("data-question-id");
            assert.deepEqual(await cardOrder(),["notice1","q1",sectionId,"scale1","exempt",tailId]);
            await saveBuilder();
            assert.deepEqual(survey.sections.map(s=>s.questions.map(q=>q.id)),[["notice1","q1",sectionId],["scale1","exempt"],[tailId]]);
        });
        await check("palette supports before after and both append positions with readable mobile insertion controls", async () => {
            for (const [mode,expectedSection,expectedIndex] of [["before","sec1",1],["after","sec1",2],["section-end","sec1",2],["survey-end","sec3",0]]) {
                await resetBuilder(insertionFixture());lastPatch=null;
                await page.locator('[data-question-id="q1"] [data-question-title]').focus();
                await page.selectOption("[data-insertion-position]",mode);
                assert.equal(await page.locator("[data-builder-discard]").isDisabled(),true);
                await page.locator('[data-question-type="dropdown"]').dblclick();
                await page.waitForFunction(()=>document.querySelector('.question-card[aria-current="true"]')?.dataset.questionId!=="q1");
                const added=await page.locator('.question-card[aria-current="true"]').getAttribute("data-question-id");
                assert.equal(await page.locator('.question-card[aria-current="true"]').getAttribute("data-section-id"),expectedSection);
                assert.equal((await page.locator(`.question-card[data-section-id="${expectedSection}"]`).evaluateAll(cards=>cards.map(c=>c.dataset.questionId)))[expectedIndex],added);
                assert.equal(lastPatch,null);
            }
            for (const width of [1440,768,360]) {
                await page.setViewportSize({width,height:1000});await page.waitForTimeout(300);
                if (await page.locator(".builder-properties").evaluate(el=>el.classList.contains("is-open"))) await page.locator("[data-properties-close]").click();
                await page.locator('[data-question-id="q1"] [data-question-title]').focus();
                if (width === 1440) assert.equal(await page.locator("[data-properties-type]").innerText(),"객관식");
                const controls=page.locator('[data-question-id="q1"] [data-question-insert]');
                assert.equal(await controls.count(),2);
                for (const button of await controls.all()) assert.equal(await button.evaluate(el=>el.getBoundingClientRect().height>=40 && el.scrollWidth<=el.clientWidth+1),true);
                assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
                await page.locator('[data-question-id="q1"]').scrollIntoViewIfNeeded();
                await page.screenshot({path:path.join(output,`question-insertion-${width}.png`)});
                await page.locator('[data-question-id="q1"] [data-question-insert="after"]').click();
                await page.waitForFunction(()=>document.activeElement?.matches("[data-insert-type]"));
                assert.equal(await page.locator(".builder-insert-dialog").evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
                await page.screenshot({path:path.join(output,`question-insertion-picker-${width}.png`)});
                await page.locator("[data-insert-cancel]").click();
                await page.locator("[data-modal]").waitFor({state:"hidden"});
            }
        });
        await check("selected questions are explicit and keyboard selection updates the open inspector", async () => {
            await resetBuilder();
            await page.locator('[data-question-id="scale1"] [data-question-settings]').click();
            await page.locator('[data-question-id="q1"] [data-question-title]').focus();
            assert.equal(await page.locator('[data-question-id="q1"]').getAttribute("aria-current"), "true");
            assert.equal(await page.locator('[data-question-id="q1"] [data-question-selection]').isVisible(), true);
            assert.equal(await page.locator("[data-properties-type]").innerText(), "객관식");
            assert.equal(await page.locator("[data-prop-range-field]").isVisible(), false);
            assert.equal(await page.locator("[data-insertion-status]").innerText(), "1번 문항 바로 아래에 추가");
            await page.locator('[data-question-id="scale1"] [data-question-title]').focus();
            assert.equal(await page.locator("[data-properties-type]").innerText(), "척도");
            assert.equal(await page.locator("[data-prop-range-field]").isVisible(), true);
            await page.locator('[data-question-id="q1"] [data-question-title]').focus();
            await page.locator("[data-properties-close]").click();
            for (const width of [1440, 360]) {
                await page.setViewportSize({ width, height: 1000 });
                await page.locator("[data-scroll-selection]").click();
                await page.waitForTimeout(350);
                const card = page.locator('[data-question-id="q1"]');
                const inactiveBorder = await page.locator('[data-question-id="scale1"]').evaluate(el => getComputedStyle(el).borderColor);
                assert.notEqual(await card.evaluate(el => getComputedStyle(el).borderColor), inactiveBorder);
                assert.equal(await card.locator("[data-question-selection]").isVisible(), true);
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
                await page.screenshot({ path: path.join(output, `builder-active-question-${width}.png`) });
            }
        });
        await check("new questions insert directly after the selection and stay visible on mobile", async () => {
            await page.emulateMedia({ reducedMotion: "reduce" });
            await page.locator('[data-question-type="short_text"]').dblclick();
            const active = page.locator('.question-card.is-active');
            await active.locator('[data-question-selection]').filter({ hasText: "추가한 문항" }).waitFor();
            const id = await active.getAttribute("data-question-id");
            assert.notEqual(id, "q1");
            assert.equal(await active.getAttribute("data-section-id"), "sec1");
            assert.equal(await active.locator("[data-question-title]").evaluate(el => document.activeElement === el), true);
            assert.equal(await page.locator(".builder-properties").evaluate(el => el.classList.contains("is-open")), false);
            await active.locator("[data-question-title]").fill("선택 문항 다음에 추가된 문항");
            await saveBuilder();
            assert.deepEqual(survey.sections[0].questions.map(q => q.id), ["notice1", "q1", id, "scale1"]);
            await page.screenshot({ path: path.join(output, "builder-added-question-360.png") });
            await page.emulateMedia({ reducedMotion: "no-preference" });
        });
        await check("new sections become the insertion target even when added from another editor tab", async () => {
            await resetBuilder();
            await page.locator('[data-question-id="q1"] [data-question-title]').focus();
            await page.locator('[data-builder-mode="logic"]').click();
            await page.locator("[data-add-section]").click();
            assert.equal(await page.locator('[data-mode-panel="questions"]').isVisible(), true);
            const section = page.locator('.builder-section-heading').last();
            const id = await section.getAttribute("data-section-id");
            assert.equal(await section.locator("[data-section-select]").getAttribute("aria-pressed"), "true");
            await section.locator("[data-section-title]").fill("추가 섹션");
            await page.locator('[data-question-type="short_text"]').dblclick();
            assert.equal(await page.locator(".question-card.is-active").getAttribute("data-section-id"), id);
            await saveBuilder();
            assert.equal(survey.sections[0].questions.length, 3);
            assert.equal(survey.sections[1].questions.length, 1);
            await section.locator("[data-section-delete]").click();
            assert.equal(await page.locator("[data-section-remove-confirm]").innerText(), "섹션과 문항 삭제");
            await page.locator("[data-section-remove-cancel]").click();
            assert.equal(await page.locator('.builder-section-heading').count(), 2);
            await section.locator("[data-section-delete]").click();
            await page.locator("[data-section-remove-confirm]").click();
            await saveBuilder();
            assert.equal(survey.sections.length, 1);
            assert.equal(survey.questions.length, 3);
            assert.equal(await page.locator("[data-section-delete]").isDisabled(), true);
        });
        await check("empty section deletion is discoverable and cancels without removing content", async () => {
            await page.locator("[data-add-section]").click();
            const section = page.locator('.builder-section-heading').last();
            const id = await section.getAttribute("data-section-id");
            for (const width of [1440, 360]) {
                await page.setViewportSize({ width, height: 1000 });
                await section.locator("[data-section-delete]").click();
                assert.equal(await page.locator("[data-section-remove-confirm]").innerText(), "빈 섹션 삭제");
                await page.waitForFunction(() => document.activeElement?.matches("[data-section-remove-cancel]"));
                assert.equal(await page.locator(".builder-section-removal").evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
                assert.equal(await page.locator("[data-section-remove-confirm]").evaluate(el => {
                    const rect = el.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= innerHeight && rect.height >= 44;
                }), true);
                await page.screenshot({ path: path.join(output, `builder-section-delete-${width}.png`) });
                await page.locator("[data-section-remove-cancel]").click();
            }
            assert.equal(await page.locator(`.builder-section-heading[data-section-id="${id}"]`).count(), 1);
            await section.locator("[data-section-delete]").click();
            await page.locator("[data-section-remove-confirm]").click();
            await saveBuilder();
            assert.equal(survey.sections.length, 1);
            assert.equal(survey.questions.length, 3);
            await page.setViewportSize({ width: 1440, height: 1000 });
        });
        await check("section deletion blocks external condition dependencies and empty audience routes", async () => {
            const dependent = { id: "dependent", type: "short_text", title: "연결된 문항", required: false, settings: { excludeSelectedFrom: "q1" } };
            const extra = { id: "sec2", title: "다음 섹션", questions: [dependent] };
            await resetBuilder({ sections: [...structuredClone(builderFixture.sections), extra], questions: [...structuredClone(builderFixture.questions), dependent] });
            await page.locator('.builder-section-heading[data-section-id="sec1"] [data-section-delete]').click();
            assert.equal(await page.locator("[data-section-remove-confirm]").isDisabled(), true);
            assert.ok((await page.locator(".builder-section-removal [role=alert]").innerText()).includes("연결된 문항"));
            await page.locator("[data-section-review-dependent]").click();
            await page.locator('.question-card.is-active[data-question-id="dependent"]').waitFor();
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            assert.equal(await page.locator('.question-card.is-active').getAttribute("data-question-id"), "dependent");
            await resetBuilder({ sections: [...structuredClone(builderFixture.sections), { id: "sec2", title: "다음 섹션", questions: [] }], settings: { audienceRoutes: [{ code: "only", label: "단독 대상", sectionIds: ["sec2"] }], defaultAudience: "only" } });
            await page.locator('.builder-section-heading[data-section-id="sec2"] [data-section-delete]').click();
            assert.equal(await page.locator("[data-section-remove-confirm]").isDisabled(), true);
            assert.ok((await page.locator(".builder-section-removal [role=alert]").innerText()).includes("단독 대상"));
            await page.screenshot({ path: path.join(output, "builder-section-delete-blocked.png") });
            await page.locator("[data-section-review-audiences]").click();
            await page.locator("[data-audience-rows]").waitFor();
            await page.locator('[data-modal] button[aria-label="닫기"]').click();
        });
        for (const kind of ["single", "multiple", "dropdown"]) {
            await check(`${kind} options expose independent labels and codes with stable middle insertion`, async () => {
                const choice = { ...structuredClone(question), type: kind, settings: { choiceLayout: "columns_3" } };
                await resetBuilder({ sections: [{ id: "sec1", title: "기본", questions: [choice] }], questions: [choice] });
                const card = page.locator('[data-question-id="q1"]');
                await card.locator('[data-option-result-code="o1"]').fill("BRANCH-A");
                await card.locator('[data-option-insert="o1"]').click();
                const inserted = card.locator("[data-option-id]").nth(1);
                const id = await inserted.getAttribute("data-option-id");
                await inserted.fill("중간에 추가한 표시 문구");
                await card.locator(`[data-option-result-code="${id}"]`).fill("BRANCH-C");
                await saveBuilder();
                assert.deepEqual(survey.questions[0].options.map(option => option.id), ["o1", id, "o2"]);
                assert.deepEqual(survey.questions[0].options.map(option => option.resultCode), ["BRANCH-A", "BRANCH-C", "2"]);
                await card.locator(`[data-option-move="${id}"][data-option-direction="-1"]`).click();
                await saveBuilder();
                assert.deepEqual(survey.questions[0].options.map(option => option.id), [id, "o1", "o2"]);
                assert.equal(survey.questions[0].options[0].resultCode, "BRANCH-C");
                await page.reload();
                await page.locator(`[data-option-result-code="${id}"]`).waitFor();
                assert.equal(await page.locator(`[data-option-result-code="${id}"]`).inputValue(), "BRANCH-C");
                assert.equal(await page.locator(`[data-option-id="${id}"]`).inputValue(), "중간에 추가한 표시 문구");
            });
        }
        await check("routing selects visible labels and result codes while retaining stable answer links", async () => {
            await resetBuilder();
            await page.locator('[data-option-result-code="o1"]').fill("ROUTE-A");
            await page.locator('[data-builder-mode="logic"]').click();
            await page.locator("[data-add-rule]").click();
            assert.ok((await page.locator("[data-rule-value]").innerText()).includes("결과 코드 ROUTE-A"));
            await page.selectOption("[data-rule-value]", "o1");
            await saveBuilder();
            assert.equal(survey.logicRules[0].value, "o1");
            await page.locator('[data-builder-mode="questions"]').click();
            await page.locator('[data-option-result-code="o1"]').fill("ROUTE-RENAMED");
            await saveBuilder();
            assert.equal(survey.logicRules[0].value, "o1");
            await page.locator('[data-builder-mode="logic"]').click();
            assert.ok((await page.locator("[data-rule-value]").innerText()).includes("결과 코드 ROUTE-RENAMED"));
        });
        await check("duplicate result codes block save while typed codes remain editable", async () => {
            await resetBuilder();
            lastPatch = null;
            await page.locator('[data-option-result-code="o2"]').fill("1");
            await page.locator("[data-builder-save]").click();
            await page.waitForFunction(() => document.querySelector("[data-builder-save-label]")?.dataset.saveState === "error");
            assert.equal(lastPatch, null);
            assert.equal(await page.locator('[data-option-result-code="o2"]').getAttribute("aria-invalid"), "true");
            await page.locator('[data-option-result-code="o1"]').fill("A10");
            assert.equal(await page.locator('[data-option-result-code="o2"]').getAttribute("aria-invalid"), "false");
            await page.locator('[data-option-result-code="o2"]').fill("B20");
            await saveBuilder();
            assert.equal(survey.questions.find(q => q.id === "q1").options[1].resultCode, "B20");
        });
        await check("number entry distinguishes input number from the result code", async () => {
            const choice = { ...structuredClone(question), type: "multiple", settings: { choiceInput: "codes", maxSelections: 2 }, options: [{id:"o1",label:"첫 번째 표시",code:"11",resultCode:"RESULT-A"},{id:"o2",label:"두 번째 표시",code:"22",resultCode:"RESULT-B"}] };
            await resetBuilder({ sections: [{id:"sec1",title:"기본",questions:[choice]}], questions:[choice] });
            await page.locator('[data-option-code="o1"]').fill("33");
            await saveBuilder();
            assert.equal(survey.questions[0].options[0].code, "33");
            assert.equal(survey.questions[0].options[0].resultCode, "RESULT-A");
            await page.locator("[data-builder-preview]").click();
            const frame = page.frameLocator("[data-interactive-preview]");
            await frame.locator(".choice-code-legend").waitFor();
            assert.ok((await frame.locator(".choice-code-legend").innerText()).includes("(33)"));
            assert.equal(await frame.locator(".choice-code-legend").innerText().then(text => text.includes("RESULT-A")), false);
            await page.locator('[data-modal] button[aria-label="닫기"]').click();
        });
        for (const kind of ["matrix_single", "matrix_multiple", "table", "repeat_table"]) {
            await check(`${kind} axes support middle insertion without renumbering stored codes`, async () => {
                const matrix = {id:"q1",type:kind,title:"행·열 코드 검증",required:false,rows:kind === "repeat_table" ? [] : ["행 하나","행 둘"],columns:["열 하나","열 둘"],settings:{}};
                await resetBuilder({sections:[{id:"sec1",title:"기본",questions:[matrix]}],questions:[matrix]});
                await page.locator('[data-question-id="q1"] [data-question-settings]').click();
                const originalColumn = await page.locator('[data-axis-list="columns"] [data-axis-result-code]').first().inputValue();
                await page.locator('[data-axis-insert="columns"][data-axis-index="0"]').click();
                await page.locator('[data-axis-result-code="columns"][data-axis-index="1"]').fill("MIDDLE-COL");
                if (kind !== "repeat_table") {
                    await page.locator('[data-axis-insert="rows"][data-axis-index="0"]').click();
                    await page.locator('[data-axis-result-code="rows"][data-axis-index="1"]').fill("MIDDLE-ROW");
                }
                await saveBuilder();
                const saved = survey.questions[0];
                assert.deepEqual(saved.settings.columns.map(item => item.resultCode), [originalColumn,"MIDDLE-COL","2"]);
                assert.equal(new Set(saved.settings.columns.map(item => item.id)).size, 3);
                if (kind !== "repeat_table") assert.deepEqual(saved.settings.rows.map(item => item.resultCode), ["1","MIDDLE-ROW","2"]);
                await page.setViewportSize({width:360,height:1000});
                await page.locator(".builder-properties.is-open").waitFor();
                await page.waitForTimeout(300);
                assert.equal(await page.locator(".builder-properties").evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
                await page.screenshot({path:path.join(output, `axis-codes-${kind}-360.png`)});
            });
        }
        await check("scale labels and result codes edit separately from the numeric response score", async () => {
            await resetBuilder();
            await page.locator('[data-question-id="scale1"] [data-question-settings]').click();
            await page.selectOption("[data-prop-scale-display]", "buttons");
            await page.locator('[data-scale-label="1"]').fill("하나 · 낮음");
            await page.locator('[data-scale-code="1"]').fill("LOW");
            await saveBuilder();
            const point = survey.questions.find(q => q.id === "scale1").settings.scalePoints.find(point => point.score === 1);
            assert.deepEqual(point, {score:1,label:"하나 · 낮음",resultCode:"LOW"});
            await page.locator("[data-builder-preview]").click();
            const frame = page.frameLocator("[data-interactive-preview]");
            const option = frame.locator('.public-scale label').filter({hasText:"하나 · 낮음"});
            await option.waitFor();
            assert.equal(await option.locator("input").getAttribute("value"), "1");
            await option.locator("input").check();
            await page.locator('[data-modal] button[aria-label="닫기"]').click();
        });
        await check("long option lists keep labels codes and actions readable on desktop and mobile", async () => {
            const choice = {...structuredClone(question),type:"multiple",settings:{choiceLayout:"columns_3"},options:Array.from({length:53},(_,index)=>({id:`synthetic-${index}`,label:`선택 보기 ${index+1}`}))};
            await resetBuilder({sections:[{id:"sec1",title:"기본",questions:[choice]}],questions:[choice]});
            for (const width of [1440,360]) {
                await page.setViewportSize({width,height:1000});
                const card = page.locator('[data-question-id="q1"]');
                await card.locator("[data-option-id]").first().scrollIntoViewIfNeeded();
                assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1), true);
                assert.equal(await card.locator("[data-option-result-code]").first().evaluate(el=>getComputedStyle(el).fontSize), "16px");
                assert.equal(await card.locator("[data-option-id]").count(),53);
                await page.screenshot({path:path.join(output,`option-codes-${width}.png`)});
            }
        });
        await check("manual save and discard restore the complete last-saved draft on desktop and mobile", async () => {
            await resetBuilder();
            const title = survey.title, description = survey.description, revision = survey.revision;
            lastPatch = null;
            await page.locator("[data-survey-heading]").fill("저장하지 않은 제목");
            await page.locator("[data-survey-description]").fill("저장하지 않은 설명");
            await page.locator('[data-option-result-code="o1"]').fill("TEMP-CODE");
            await page.locator("[data-add-section]").click();
            await page.locator('[data-question-type="short_text"]').dblclick();
            await page.waitForTimeout(1100);
            assert.equal(lastPatch, null);
            assert.equal(survey.title, title);
            assert.equal(survey.revision, revision);
            assert.equal(await page.locator("[data-builder-title]").inputValue(), "저장하지 않은 제목");
            await page.locator("[data-builder-discard]").click();
            await page.locator("[data-message-cancel]").click();
            assert.equal(await page.locator(".question-card").count(), 4);
            await page.locator("[data-builder-discard]").click();
            await page.locator("[data-message-confirm]").click();
            await page.waitForFunction(() => document.querySelector("[data-builder-discard]").disabled);
            assert.equal(await page.locator("[data-builder-title]").inputValue(), title);
            assert.equal(await page.locator("[data-survey-heading]").inputValue(), title);
            assert.equal(await page.locator("[data-survey-description]").inputValue(), description);
            assert.equal(await page.locator(".question-card").count(), 3);
            assert.equal(await page.locator(".builder-section-heading").count(), 1);
            assert.equal(await page.locator('[data-option-result-code="o1"]').inputValue(), "1");
            assert.equal(lastPatch, null);
            await page.locator("[data-builder-title]").fill("직접 저장한 새 기준");
            await saveBuilder();
            for (const width of [1440,360]) {
                await page.setViewportSize({width,height:1000});
                await page.locator("[data-builder-title]").fill("취소할 후속 수정");
                await page.waitForTimeout(300);
                await page.locator("[data-toast-close]").evaluateAll(buttons => buttons.forEach(button => button.click()));
                await page.waitForFunction(() => !document.querySelector("[data-toast-close]"));
                assert.equal(await page.locator("[data-builder-discard]").isEnabled(), true);
                assert.equal(await page.locator("[data-builder-discard]").evaluate(el => {
                    const rect=el.getBoundingClientRect();return rect.left>=0 && rect.right<=innerWidth && rect.height===44 && el.scrollWidth<=el.clientWidth+1;
                }),true);
                await page.screenshot({path:path.join(output,`manual-save-discard-${width}.png`)});
                await page.locator("[data-builder-discard]").click();
                await page.locator("[data-message-confirm]").click();
                await page.waitForFunction(() => document.querySelector("[data-builder-discard]").disabled);
                assert.equal(await page.locator("[data-builder-title]").inputValue(), "직접 저장한 새 기준");
                assert.equal(survey.title,"직접 저장한 새 기준");
            }
        });
        await check("failed saves do not advance the restore checkpoint", async () => {
            await resetBuilder();
            const title=survey.title, revision=survey.revision;
            rejectSave=true;
            await page.locator("[data-builder-title]").fill("저장 실패한 제목");
            await page.locator("[data-builder-save]").click();
            await page.waitForFunction(() => document.querySelector("[data-builder-save-label]").dataset.saveState === "error");
            rejectSave=false;
            await page.locator("[data-builder-discard]").click();
            await page.locator("[data-message-confirm]").click();
            await page.waitForFunction(() => document.querySelector("[data-builder-discard]").disabled);
            assert.equal(await page.locator("[data-builder-title]").inputValue(),title);
            assert.equal(survey.title,title);
            assert.equal(survey.revision,revision);
        });
        await check("preview shows pending edits without saving them", async () => {
            await resetBuilder();
            const title=survey.title;
            lastPatch=null;
            await page.locator("[data-builder-title]").fill("미저장 미리보기 제목");
            await page.locator("[data-builder-preview]").click();
            const frame=page.frameLocator("[data-interactive-preview]");
            await frame.locator("h1").filter({hasText:"미저장 미리보기 제목"}).waitFor();
            assert.equal(survey.title,title);
            assert.equal(lastPatch,null);
            await page.locator('[data-modal] button[aria-label="닫기"]').click();
            await page.locator("[data-builder-discard]").click();
            await page.locator("[data-message-confirm]").click();
        });
        assert.deepEqual(failures, []);
        console.log(`Rich editor audit passed: ${checks} scenarios.`);
    } catch (error) { for (const context of browser.contexts()) for (const openPage of context.pages()) await openPage.screenshot({ path: path.join(output, "failure.png") }); throw error; } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
