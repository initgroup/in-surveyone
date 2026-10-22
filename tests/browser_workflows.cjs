// Optional browser regression: SURVEYONE_PLAYWRIGHT_MODULE points to playwright-core.
// Uses a loopback-only static server and synthetic API responses; no live DB or accounts.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require(process.env.SURVEYONE_PLAYWRIGHT_MODULE || "playwright-core");
const root = path.resolve(__dirname, "..");
const output = path.join(root, ".tmp", "editor-flow-review");
const failures = [];
let checks = 0;
const question = { id: "q1", type: "single", title: "확인 문항", required: true, options: [{ id: "o1", label: "선택 1" }, { id: "o2", label: "선택 2" }], settings: {} };
let survey = { id: "ui-audit-survey", title: "기능 검증용 합성 설문", description: "실제 응답자가 없는 자동화 테스트", category: "satisfaction", status: "draft", revision: 3, questions: [question], sections: [{ id: "sec1", title: "기본", questions: [question] }], settings: { presentationMode: "scroll" }, skin: { preset: "ocean", primary: "#2457d6", accent: "#4ed7bd", font: "system", radius: "18px" }, languages: { defaultLocale: "ko", sourceLocale: "ko", activeLocales: ["ko"], translations: {} }, responseCount: 0, createdAt: "2026-10-22T00:00:00Z", updatedAt: "2026-10-22T00:00:00Z" };
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
                    else { survey = { ...survey, ...lastPatch, revision: survey.revision + 1 }; value = { survey }; }
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
        await page.goto(base + "/#/M02005?surveyId=" + survey.id);
        await page.locator("[data-open-skin-code]:enabled").waitFor();
        await check("skin editor standalone styles and actual example", async () => {
            await page.click("[data-open-skin-code]");
            await page.locator("[data-code-apply]:enabled").waitFor();
            const size = await page.locator("[data-code-enabled]").boundingBox();
            assert.equal(size.width, 44); assert.equal(size.height, 26);
            assert.equal(await page.locator("[data-code-editor=html]").evaluate(el => getComputedStyle(el).fontSize), "14px");
            await page.locator(".source-editor-event-help summary").click();
            await page.click("[data-code-event-example]");
            const frame = page.frameLocator("[data-code-preview]");
            await frame.locator("[data-survey-event]").filter({ hasText: "준비 완료" }).waitFor();
            await page.click("[data-code-event=answerChange]");
            await frame.locator("[data-survey-event]").filter({ hasText: "응답 변경" }).waitFor();
            await page.click("[data-code-event=beforeSubmit]");
            await frame.locator("[data-survey-event]").filter({ hasText: "제출 직전" }).waitFor();
            await page.locator("[data-code-tab=html]").focus();
            await page.keyboard.press("ArrowRight");
            assert.equal(await page.locator("[data-code-tab=css]").getAttribute("aria-selected"), "true");
            await page.click("[data-code-tab=javascript]");
            await page.screenshot({ path: path.join(output, "editor-desktop.png") });
            for (const width of [360, 768]) {
                await page.setViewportSize({ width, height: 800 });
                await page.locator("[data-code-apply]").scrollIntoViewIfNeeded();
                assert.ok(await page.locator("[data-code-apply]").isVisible());
                assert.ok(await page.locator(".source-editor-shell").evaluate(el => el.scrollWidth <= el.clientWidth + 1));
                await page.screenshot({ path: path.join(output, `editor-${width}.png`) });
            }
            await page.setViewportSize({ width: 1440, height: 1000 });
            const validCode = await page.locator("[data-code-editor=javascript]").evaluate(el => ace.edit(el).getValue());
            await page.locator("[data-code-editor=javascript]").evaluate(el => ace.edit(el).setValue("const broken = ;"));
            await page.locator("[data-code-status].is-error").waitFor();
            assert.equal(await page.locator("[data-code-apply]").isDisabled(), true);
            await page.locator("[data-code-editor=javascript]").evaluate((el, source) => ace.edit(el).setValue(source), validCode);
            await page.locator("[data-code-apply]:enabled").waitFor();
            await page.click("[data-code-enabled]");
            await page.click("[data-code-apply]");
            await page.locator("[data-modal]").waitFor({ state: "hidden" });
        });
        await check("unsaved code blocks navigation and skin save sends revision", async () => {
            await page.evaluate(() => SurveyOneApp.navigate("M06001"));
            await page.locator("[data-message-dialog][open]").waitFor();
            await page.click("[data-message-cancel]");
            await page.waitForFunction(() => location.hash.startsWith("#/M02005"));
            rejectSave = true;
            await page.click("[data-save-skin]");
            await page.locator("[data-skin-save-state]").filter({ hasText: "저장하지 못했습니다" }).waitFor();
            assert.equal(lastPatch.expectedRevision, 3);
            rejectSave = false;
            await page.click("[data-save-skin]");
            await page.locator("[data-skin-save-state]").filter({ hasText: "프로젝트 스킨을 저장했습니다" }).waitFor();
            assert.ok(survey.skin.customCode.html.includes("data-survey-event"));
            await navigate("M06001");
        });
        await check("preferences persist after navigation and fresh entry", async () => {
            await page.selectOption("[name=density]", "compact");
            await page.selectOption("[name=motion]", "reduced");
            await page.selectOption("[name=startPage]", "M02001");
            await page.click("[data-system-settings-form] button[type=submit]");
            await page.selectOption("[name=density]", "comfortable");
            await page.evaluate(() => { window.originalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw Error("storage blocked"); }; });
            await page.click("[data-system-settings-form] button[type=submit]");
            await page.locator("[data-system-settings-state]").filter({ hasText: "저장하지 못했습니다" }).waitFor();
            await page.evaluate(() => { Storage.prototype.setItem = window.originalSetItem; });
            await navigate("M02001");
            assert.equal(await page.locator("html").getAttribute("data-ui-density"), "compact");
            await page.goto(base + "/");
            await page.waitForFunction(() => location.hash === "#/M02001");
            assert.equal(await page.locator("html").getAttribute("data-ui-motion"), "reduced");
        });
        await check("report fractions, draft switching, storage failure, print paper", async () => {
            await navigate("M05002", { surveyId: survey.id });
            assert.equal(await page.locator("[data-add-widget=trend]").isDisabled(), true);
            await page.locator("[data-add-widget=questions]").click();
            assert.ok((await page.locator(".custom-preview-bars").innerText()).includes("0.5%"));
            await page.locator("[data-role=template-name]").fill("저장된 레이아웃");
            await page.click("[data-role=save-draft]");
            await page.locator("[data-role=template-name]").fill("미저장 편집 유지");
            await page.click("[data-role=new-draft]");
            await page.locator("[data-message-dialog][open]").waitFor();
            await page.click("[data-message-cancel]");
            assert.equal(await page.locator("[data-role=template-name]").inputValue(), "미저장 편집 유지");
            await page.evaluate(() => { window.originalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw new DOMException("blocked", "QuotaExceededError"); }; });
            await page.click("[data-role=save-draft]");
            await page.locator("[data-role=status]").filter({ hasText: "저장하지 못했습니다" }).waitFor();
            await page.evaluate(() => { Storage.prototype.setItem = window.originalSetItem; });
            await page.selectOption("[data-role=paper-size]", "A3");
            await page.locator('label:has([name="m05002-orientation"][value="LANDSCAPE"])').click();
            assert.match(await page.locator("style[data-custom-report-print-size]").textContent(), /size: A3 landscape/);
            await page.click("[data-role=save-draft]");
            await page.evaluate(() => { window.print = () => { window.printCalled = true; }; });
            await page.click("[data-role=print-report]");
            assert.equal(await page.evaluate(() => window.printCalled), true);
            await page.emulateMedia({ media: "print" });
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            assert.equal(await page.locator(".custom-report-paper-shell").evaluate(el => getComputedStyle(el).padding), "0px");
            assert.equal(await page.locator(".custom-report-width-note").isVisible(), false);
            const pdf = await page.pdf({ path: path.join(output, "report-print.pdf"), preferCSSPageSize: true, printBackground: true });
            const mediaBox = pdf.toString("latin1").match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/);
            assert.ok(mediaBox && Number(mediaBox[1]) > 1100 && Number(mediaBox[2]) < 900, "A3 landscape PDF page");
            await page.screenshot({ path: path.join(output, "report-print.png"), fullPage: true });
            await page.emulateMedia({ media: "screen" });
        });
        await check("builder uses manual save and guards navigation through save discard and stay", async () => {
            await navigate("M02003", { surveyId: survey.id });
            await page.waitForFunction(title => document.querySelector("[data-builder-title]")?.value === title, survey.title);
            const originalTitle = survey.title;
            await page.locator("[data-builder-title]").fill("수동 저장 전의 수정 제목");
            await page.waitForTimeout(1000);
            assert.equal(survey.title, originalTitle);
            assert.equal(await page.locator("[data-builder-save-label]").innerText(), "저장 안 됨");
            await page.evaluate(() => SurveyOneApp.navigate("M06001"));
            await page.locator("[data-builder-leave-stay]").click();
            await page.waitForFunction(() => location.hash.startsWith("#/M02003"));
            assert.equal(await page.locator("[data-builder-title]").inputValue(), "수동 저장 전의 수정 제목");
            rejectSave = true;
            await page.evaluate(() => SurveyOneApp.navigate("M06001"));
            await page.locator("[data-builder-leave-save]").click();
            await page.locator("[data-builder-leave-error]").filter({hasText:"저장하지 못했습니다"}).waitFor();
            assert.equal(survey.title, originalTitle);
            await page.locator("[data-builder-leave-stay]").click();
            rejectSave = false;
            await page.evaluate(() => SurveyOneApp.navigate("M06001"));
            await page.locator("[data-builder-leave-save]").click();
            await page.waitForFunction(() => document.querySelector("[data-page-title]")?.textContent === PAGE_CONFIG.M06001.label);
            assert.equal(survey.title, "수동 저장 전의 수정 제목");
            await navigate("M02003", { surveyId: survey.id });
            await page.locator("[data-builder-title]").fill("버릴 수정 제목");
            await page.evaluate(() => SurveyOneApp.navigate("M06001"));
            await page.locator("[data-builder-leave-discard]").click();
            await page.waitForFunction(() => document.querySelector("[data-page-title]")?.textContent === PAGE_CONFIG.M06001.label);
            assert.equal(survey.title, "수동 저장 전의 수정 제목");
        });
        await check("response UI asks before discard and saves before next step", async () => {
            await navigate("M02004", { surveyId: survey.id });
            await page.click('[data-presentation-mode="one_at_a_time"]');
            await page.evaluate(() => SurveyOneApp.navigate("M06001"));
            await page.locator("[data-message-dialog][open]").waitFor();
            await page.click("[data-message-cancel]");
            await page.waitForFunction(() => location.hash.startsWith("#/M02004"));
            assert.equal(await page.locator('[data-presentation-mode="one_at_a_time"]').getAttribute("aria-checked"), "true");
            await page.click("[data-experience-next]");
            await page.locator("[data-builder-title]").waitFor();
            assert.equal(survey.settings.presentationMode, "one_at_a_time");
        });
        await check("page stylesheet failure offers a working retry", async () => {
            let failStyle = true;
            await page.route("**/frontend/css/pages/M06001.css*", async route => {
                if (failStyle) { failStyle = false; await route.abort("failed"); }
                else await route.continue();
            });
            await page.evaluate(() => SurveyOneApp.navigate("M06001"));
            await page.locator("[data-route-retry]").waitFor();
            await page.click("[data-route-retry]");
            await page.locator("[data-system-settings-form]").waitFor();
            await page.unroute("**/frontend/css/pages/M06001.css*");
        });
        const pages = ["M01001", "M02001", "M02002", "M02003", "M02004", "M02005", "M03001", "M04001", "M05001", "M05002", "M06001", "M07001", "M07002"];
        for (const code of pages) await check("menu " + code, async () => {
            await navigate(code, ["M02002", "M02003", "M02004", "M02005", "M05001", "M05002"].includes(code) ? { surveyId: survey.id } : {});
            for (const width of [1440, 768, 360]) {
                await page.setViewportSize({ width, height: 1000 });
                await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
                await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 1, null, { timeout: 1500 });
                const metrics = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, font: getComputedStyle(document.body).fontSize }));
                assert.equal(metrics.font, "16px", code);
                if (metrics.scroll > metrics.width + 1) {
                    console.log(await page.evaluate(() => [...document.querySelectorAll("body *")].map(el => ({tag:el.tagName,cls:el.className,rect:el.getBoundingClientRect()})).filter(item => item.rect.right > innerWidth + 1 && item.rect.width > 0).slice(0,12).map(item => ({tag:item.tag,cls:item.cls,x:item.rect.x,width:item.rect.width,right:item.rect.right}))));
                    await page.screenshot({ path: path.join(output, `overflow-${code}-${width}.png`) });
                }
                assert.ok(metrics.scroll <= metrics.width + 1, `${code} ${width}: ${metrics.scroll}`);
                if (["M01001", "M02001", "M03001", "M04001", "M06001"].includes(code)) await page.screenshot({ path: path.join(output, `readability-${code}-${width}.png`) });
            }
            await page.setViewportSize({ width: 1440, height: 1000 });
        });
        await check("editor load failure retries and slow loading can cancel", async () => {
            await navigate("M02005", { surveyId: survey.id });
            await page.reload();
            await page.locator("[data-open-skin-code]:enabled").waitFor();
            let first = true;
            await page.route("**/frontend/vendor/ace/ace.js*", async route => {
                if (first) { first = false; await route.abort("failed"); }
                else await route.continue();
            });
            await page.click("[data-open-skin-code]");
            await page.locator("[data-code-status].is-error").waitFor();
            await page.click("[data-code-cancel]");
            await page.click("[data-open-skin-code]");
            await page.locator("[data-code-apply]:enabled").waitFor();
            await page.click("[data-code-cancel]");
            await page.unroute("**/frontend/vendor/ace/ace.js*");
            await page.reload();
            await page.locator("[data-open-skin-code]:enabled").waitFor();
            let release;
            await page.route("**/frontend/vendor/ace/ace.js*", async route => { await new Promise(resolve => { release = resolve; }); await route.continue(); });
            await page.click("[data-open-skin-code]");
            await page.locator("[data-code-cancel]").click();
            assert.equal(await page.locator("[data-modal]").isVisible(), false);
            while (!release) await new Promise(resolve => setTimeout(resolve, 10));
            release();
            await page.waitForLoadState("networkidle");
            assert.equal(await page.locator("[data-modal]").isVisible(), false);
        });
        assert.deepEqual(failures, []);
        console.log(`Browser audit passed: ${checks} scenarios; 13 menus; widths 360/768/1440.`);
    } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
