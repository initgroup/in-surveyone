// Focused readonly palette selection and explicit insertion regression; loopback server and synthetic API only.
// SURVEYONE_PLAYWRIGHT_MODULE points to an existing playwright-core installation.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const {chromium} = require(process.env.SURVEYONE_PLAYWRIGHT_MODULE || "playwright-core");
const root = path.resolve(__dirname,"..");
const output = path.join(root,".tmp","builder-tool-review");
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
  await page.emulateMedia({reducedMotion:"reduce"});
  for(const width of [1440,360]) {
   await page.goto("about:blank");survey=structuredClone(fixture);writes=0;
   await page.setViewportSize({width,height:1100});await page.goto(base+"/#/M02003?surveyId="+survey.id);
   await page.locator('[data-question-id="q1"]').waitFor();
   const order=()=>page.locator(".question-card").evaluateAll(cards=>cards.map(card=>card.dataset.questionId));
   const selectedId=()=>page.locator('.question-card[aria-current="true"]').getAttribute("data-question-id");
   const closeInspector=async()=>{if(await page.locator(".builder-properties").evaluate(el=>el.classList.contains("is-open"))) await page.locator("[data-properties-close]").click();};
   const count=()=>page.locator(".question-card").count();
   await check(`${width}: single clicks across all 14 types only select and update both insertion labels`,async()=>{
    assert.equal(await page.locator('[data-question-type="single"]').getAttribute("aria-pressed"),"true");
    await page.locator('[data-question-id="q1"] [data-question-title]').focus();
    const types=await page.locator("[data-question-type]").evaluateAll(tools=>tools.map(tool=>tool.dataset.questionType));
    assert.equal(types.length,14);
    for(const type of types) {
     const tool=page.locator(`[data-question-type="${type}"]`),label=await tool.locator("strong").innerText();
     await tool.click();
     assert.equal(await count(),2);assert.equal(await selectedId(),"q1");
     assert.equal(await tool.getAttribute("aria-pressed"),"true");
     assert.equal(await page.locator('[data-question-type][aria-pressed="true"]').count(),1);
     assert.ok((await page.locator("[data-add-selected-question]").innerText()).includes(label));
     assert.ok((await page.locator("[data-canvas-add]").innerText()).includes(label));
    }
    assert.equal(await page.locator("[data-builder-discard]").isDisabled(),true);assert.equal(writes,0);
   });
   await check(`${width}: bottom add inserts the selected type once at the end regardless of active question and placement`,async()=>{
    await page.selectOption("[data-insertion-position]","before");
    await page.locator('[data-question-type="short_text"]').click();
    await page.locator("[data-canvas-add]").click();
    await page.waitForFunction(()=>document.querySelectorAll(".question-card").length===3);
    assert.equal(await page.locator('[data-modal][open]').count(),0);
    const card=page.locator('.question-card[aria-current="true"]');
    assert.equal(await card.getAttribute("data-section-id"),"sec2");
    assert.equal(await card.locator(".question-type-badge").innerText(),"단답형");
    assert.equal((await order()).at(-1),await selectedId());assert.equal(writes,0);
    await closeInspector();
   });
   await check(`${width}: double click inserts exactly once after the selected question`,async()=>{
    await page.locator('[data-question-id="q1"] [data-question-title]').focus();
    await page.locator('[data-question-type="number"]').dblclick();
    await page.waitForFunction(()=>document.querySelectorAll(".question-card").length===4);
    const id=await selectedId();assert.equal((await order())[1],id);
    assert.equal(await page.locator('.question-card[aria-current="true"] .question-type-badge').innerText(),"숫자");
    assert.equal(await page.locator('[data-question-type="number"]').getAttribute("aria-pressed"),"true");
    await closeInspector();
   });
   await check(`${width}: the explicit add button honors before placement and Space/Enter alone never insert`,async()=>{
    const anchor=await selectedId();
    await page.selectOption("[data-insertion-position]","before");
    const tool=page.locator('[data-question-type="date"]');await tool.focus();await page.keyboard.press("Space");
    assert.equal(await count(),4);assert.equal(await tool.getAttribute("aria-pressed"),"true");
    await page.keyboard.press("Enter");assert.equal(await count(),4);
    await page.locator("[data-add-selected-question]").click();
    await page.waitForFunction(()=>document.querySelectorAll(".question-card").length===5);
    const added=await selectedId(),ids=await order();assert.equal(ids.indexOf(added)+1,ids.indexOf(anchor));
    assert.equal(await page.locator('.question-card[aria-current="true"] .question-type-badge').innerText(),"날짜");
    await closeInspector();
   });
   await check(`${width}: Ctrl+Enter provides a keyboard add action without duplicate native click`,async()=>{
    const tool=page.locator('[data-question-type="slider"]');await tool.focus();await page.keyboard.press("Control+Enter");
    await page.waitForFunction(()=>document.querySelectorAll(".question-card").length===6);
    await page.waitForTimeout(60);assert.equal(await count(),6);
    assert.equal(await page.locator('.question-card[aria-current="true"] .question-type-badge').innerText(),"슬라이더");
    await closeInspector();
   });
   await check(`${width}: middle picker synchronizes the palette and toolbar selection is readable`,async()=>{
    await page.locator('[data-question-id="q1"] [data-question-title]').focus();
    await page.locator('[data-question-id="q1"] [data-question-insert="before"]').click();
    await page.locator('[data-insert-type="dropdown"]').click();
    await page.waitForFunction(()=>document.querySelectorAll(".question-card").length===7);
    assert.equal(await page.locator('[data-question-type="dropdown"]').getAttribute("aria-pressed"),"true");
    assert.equal(await page.locator('[data-question-type][aria-pressed="true"]').count(),1);
    await closeInspector();
    await page.locator('[data-question-type="multiple"]').click();
    assert.equal(await count(),7);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    assert.equal(await page.locator("[data-add-selected-question]").evaluate(el=>el.getBoundingClientRect().height>=44 && el.scrollWidth<=el.clientWidth+1),true);
    await page.locator('[data-question-type="multiple"]').scrollIntoViewIfNeeded();
    if(width===360) assert.equal(await page.locator("[data-add-selected-question]").evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;}),true);
    await page.screenshot({path:path.join(output,`selected-type-${width}.png`)});
    assert.equal(writes,0);
    await page.locator("[data-builder-save]").click();
    await page.waitForFunction(()=>document.querySelector("[data-builder-save-label]").dataset.saveState==="saved");
    assert.equal(writes,1);assert.equal(survey.sections.flatMap(section=>section.questions).length,7);
    assert.equal(JSON.stringify(survey).includes("selectedQuestionType"),false);
   });
  }
  assert.deepEqual(failures,[]);console.log(`Builder tools audit passed: ${checks} scenarios; 1440/360px.`);
 } catch(error) {await page.screenshot({path:path.join(output,"failure.png")});throw error;}
 finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
