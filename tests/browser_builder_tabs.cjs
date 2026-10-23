// Focused builder tab regression; loopback server and synthetic API only.
// SURVEYONE_PLAYWRIGHT_MODULE points to an existing playwright-core installation.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const {chromium} = require(process.env.SURVEYONE_PLAYWRIGHT_MODULE || "playwright-core");
const root = path.resolve(__dirname,"..");
const output = path.join(root,".tmp","builder-tab-review");
const question = {id:"q1",type:"single",title:"탭 전환 후에도 유지할 문항",options:[{id:"o1",label:"첫 번째"},{id:"o2",label:"두 번째"}],settings:{}};
const second = {id:"q2",type:"short_text",title:"두 번째 섹션 문항",settings:{}};
const fixture = {id:"builder-tab-fixture",title:"탭 배치 검증용 합성 설문",description:"실제 계정이나 응답이 없는 테스트",revision:1,status:"draft",questions:[question,second],
 sections:[{id:"sec1",title:"첫 섹션",questions:[question]},{id:"sec2",title:"둘째 섹션",questions:[second]}],
 settings:{showQuestionNumbers:true,presentationMode:"scroll",anonymous:true},
 logicRules:[{id:"r1",questionId:"q1",sourceQuestionId:"q1",operator:"equals",value:"o1",destination:"sec2",targetSectionId:"sec2"}],
 languages:{defaultLocale:"ko",sourceLocale:"ko",activeLocales:["ko"],translations:{}},skin:{preset:"ocean"},translations:{}};
let survey=structuredClone(fixture), writes=0, checks=0;
const failures=[];
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,"http://localhost");
 const filename=path.resolve(root,"."+(url.pathname==="/"?"/frontend/index.html":url.pathname));
 if(!filename.startsWith(path.join(root,"frontend")+path.sep)) {res.writeHead(404).end();return;}
 const types={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".svg":"image/svg+xml",".woff2":"font/woff2",".png":"image/png"};
 fs.readFile(filename,(error,data)=>error?res.writeHead(404).end():res.writeHead(200,{"Content-Type":types[path.extname(filename)]||"application/octet-stream"}).end(data));
});
async function check(name,fn){await fn();checks++;console.log("PASS "+name);}
(async()=>{
 fs.mkdirSync(output,{recursive:true});
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({channel:process.env.SURVEYONE_BROWSER_CHANNEL||"msedge",headless:true});
 const page=await browser.newPage();page.setDefaultTimeout(7000);
 page.on("pageerror",error=>failures.push(error.message));
 page.on("dialog",dialog=>dialog.type()==="beforeunload"?dialog.accept():dialog.dismiss());
 await page.route("**/api/**",async route=>{
  const req=route.request(),url=new URL(req.url());let value,status=200;
  if(req.method()!=="GET") writes++;
  if(url.pathname==="/api/auth/me") value={user:{id:"test-user",tenantId:"test-tenant",displayName:"자동화 테스트",role:"OWNER"},expiresAt:new Date(Date.now()+3600000).toISOString()};
  else if (url.pathname === "/api/version") value = {version: fs.readFileSync(path.join(root, "VERSION"), "utf8").trim()};
  else if(url.pathname==="/api/runtime-config") value={publicBaseUrl:"https://www.insurveyone.com",environment:"test"};
  else if(url.pathname===`/api/surveys/${survey.id}`) {
   if(req.method()==="PUT") {Object.assign(survey,req.postDataJSON());survey.revision++;}
   value={survey};
  }
  else if(url.pathname.startsWith("/api/help/")) {status=404;value={detail:"정적 도움말"};}
  else {failures.push("Unexpected API: "+req.method()+" "+url.pathname);status=404;value={detail:"Unknown fixture route"};}
  await route.fulfill({status,contentType:"application/json",body:JSON.stringify(value)});
 });
 async function tab(mode){await page.locator(`[data-builder-mode="${mode}"]`).click();await page.waitForTimeout(80);}
 try {
  for(const width of [1440,768,360]) {
   await page.goto("about:blank");survey=structuredClone(fixture);writes=0;
   await page.setViewportSize({width,height:1000});
   await page.goto(base+"/#/M02003?surveyId="+survey.id);
   await page.locator('[data-question-id="q1"]').waitFor();
   await check(`${width}: question tools and inspector belong to question editing`,async()=>{
    await page.locator('[data-question-id="q1"] [data-question-settings]').click();
    assert.equal(await page.locator(".builder-toolbox").isVisible(),true);
    assert.equal(await page.locator(".survey-cover-card").isVisible(),true);
    assert.equal(await page.locator("[data-open-skins]").isVisible(),false);
    await page.locator("[data-properties-close]").click();
    await page.locator('[data-question-id="q1"] [data-question-title]').fill("유지할 미저장 제목");
    assert.equal(await page.locator('[data-question-id="q1"]').getAttribute("aria-current"),"true");
   });
   await check(`${width}: routing uses the full canvas and owns audience routing`,async()=>{
    await tab("logic");
    assert.equal(await page.locator(".builder-toolbox").isVisible(),false);
    assert.equal(await page.locator(".builder-properties").isVisible(),false);
    assert.equal(await page.locator(".survey-cover-card").isVisible(),false);
    assert.equal(await page.locator("[data-edit-audiences]").isVisible(),true);
    assert.equal(await page.locator("[data-rule-question]").isVisible(),true);
    assert.equal(await page.locator("[data-canvas-title]").innerText(),"분기 설계");
    assert.equal(await page.locator(".builder-workspace").evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(" ").length),1);
    assert.equal(await page.locator(".builder-canvas").evaluate(el=>el.getBoundingClientRect().width>=el.parentElement.clientWidth-100),true);
    await page.selectOption("[data-rule-operator]","notEquals");
    await page.locator("[data-edit-audiences]").click();
    await page.locator("[data-modal][open]").waitFor();
    await page.locator('[data-modal] button[aria-label="닫기"]').click();
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:path.join(output,`logic-${width}.png`)});
   });
   await check(`${width}: settings groups policy language and style without question panels`,async()=>{
    await tab("settings");
    assert.equal(await page.locator(".builder-toolbox").isVisible(),false);
    assert.equal(await page.locator(".builder-properties").isVisible(),false);
    assert.equal(await page.locator("[data-edit-audiences]").isVisible(),false);
    assert.equal(await page.locator("[data-setting=anonymous]").isVisible(),true);
    assert.equal(await page.locator("[data-source-locale]").isVisible(),true);
    assert.equal(await page.locator("[data-open-skins]").isVisible(),true);
    await page.selectOption('[data-setting="presentationMode"]',"one_at_a_time");
    await page.locator("[data-skin-code]").nth(1).click();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    assert.equal(await page.locator(".builder-settings-grid").evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(" ").length),width===1440?2:1);
    const activeTab=page.locator('[data-builder-mode="settings"]');
    assert.equal(await activeTab.getAttribute("aria-controls"),"builder-panel-settings");
    assert.equal(await page.locator('[data-mode-panel="settings"]').getAttribute("aria-labelledby"),await activeTab.getAttribute("id"));
    // Repeated keyboard traversal must not reach hidden palette or inspector controls.
    await activeTab.focus();
    for(let n=0;n<22;n++) {
     await page.keyboard.press("Tab");
     assert.equal(await page.evaluate(()=>Boolean(document.activeElement.closest(".builder-toolbox,.builder-properties"))),false);
    }
    await activeTab.focus();
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:path.join(output,`settings-${width}.png`)});
   });
   await check(`${width}: switching back preserves selection and every pending edit without saving`,async()=>{
    await tab("questions");
    assert.equal(await page.locator('[data-question-id="q1"] [data-question-title]').inputValue(),"유지할 미저장 제목");
    assert.equal(await page.locator('[data-question-id="q1"]').getAttribute("aria-current"),"true");
    assert.equal(await page.locator(".builder-toolbox").isVisible(),true);
    assert.equal(await page.locator(".builder-properties").evaluate(el=>el.hidden),false);
    if(width<1248) assert.equal(await page.locator(".builder-properties").evaluate(el=>el.classList.contains("is-open")),false);
    await tab("logic");assert.equal(await page.locator("[data-rule-operator]").inputValue(),"notEquals");
    await tab("settings");assert.equal(await page.locator('[data-setting="presentationMode"]').inputValue(),"one_at_a_time");
    assert.equal(await page.locator("[data-skin-code]").nth(1).evaluate(el=>el.classList.contains("is-active")),true);
    assert.equal(writes,0);assert.equal(survey.questions[0].title,fixture.questions[0].title);
    await page.locator('[data-builder-mode="settings"]').focus();await page.keyboard.press("Home");
    assert.equal(await page.locator('[data-mode-panel="questions"]').isVisible(),true);
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.locator('[data-mode-panel="logic"]').isVisible(),true);
    await page.locator("[data-builder-save]").click();
    await page.waitForFunction(()=>document.querySelector("[data-builder-save-label]").dataset.saveState==="saved");
    assert.equal(writes,1);assert.equal(survey.sections[0].questions[0].title,"유지할 미저장 제목");
    assert.equal(survey.logicRules[0].operator,"notEquals");assert.equal(survey.settings.presentationMode,"one_at_a_time");
   });
  }
  assert.deepEqual(failures,[]);console.log(`Builder tab audit passed: ${checks} scenarios; 360/768/1440px.`);
 } catch(error) {await page.screenshot({path:path.join(output,"failure.png")});throw error;}
 finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
