// Focused section folding and tab contrast regression; loopback server and synthetic API only.
// SURVEYONE_PLAYWRIGHT_MODULE points to an existing playwright-core installation.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const {chromium} = require(process.env.SURVEYONE_PLAYWRIGHT_MODULE || "playwright-core");
const root = path.resolve(__dirname,"..");
const output = path.join(root,".tmp","builder-section-review");
const question = {id:"q1",type:"single",title:"탭 전환 후에도 유지할 문항",options:[{id:"o1",label:"첫 번째"},{id:"o2",label:"두 번째"}],settings:{}};
const second = {id:"q2",type:"short_text",title:"두 번째 섹션 문항",settings:{}};
const fixture = {id:"builder-tab-fixture",title:"탭 배치 검증용 합성 설문",description:"실제 계정이나 응답이 없는 테스트",revision:1,status:"draft",questions:[question,second],
 sections:[{id:"sec1",title:"첫 섹션",questions:[question]},{id:"sec2",title:"둘째 섹션",questions:[second]}],
 settings:{showQuestionNumbers:true,presentationMode:"scroll",anonymous:true},
 logicRules:[{id:"r1",questionId:"q1",sourceQuestionId:"q1",operator:"equals",value:"o1",destination:"sec2",targetSectionId:"sec2"}],
 languages:{defaultLocale:"ko",sourceLocale:"ko",activeLocales:["ko"],translations:{}},skin:{preset:"ocean"},translations:{}};
fixture.sections=Array.from({length:4},(_,sectionIndex)=>({id:`sec${sectionIndex+1}`,title:`검증 섹션 ${sectionIndex+1}`,questions:Array.from({length:20},(_,index)=>{
 const n=sectionIndex*20+index+1;
 return n===1?{id:"q1",type:"scale",title:"선택 위치를 확인할 척도 문항",min:1,max:10,minLabel:"낮음",maxLabel:"높음",settings:{scaleDisplay:"slider"}}:{id:`q${n}`,type:"short_text",title:`긴 설문의 검증 문항 ${n}`,settings:{}};
})}));
fixture.questions=fixture.sections.flatMap(section=>section.questions);
fixture.logicRules=Array.from({length:12},(_,index)=>({id:`r${index}`,sourceQuestionId:"q2",questionId:"q2",operator:"equals",value:"test",destination:"sec4",targetSectionId:"sec4"}));
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
   await page.locator('[data-question-id="q80"]').waitFor({state:"attached"});
   const originalIds=await page.locator(".question-card").evaluateAll(cards=>cards.map(card=>card.dataset.questionId));
   const originalNumbers=await page.locator(".question-index").allTextContents();
   await check(`${width}: selected tab has strong contrast and keyboard switching remains available`,async()=>{
    const contrast=await page.locator('[data-builder-mode="questions"]').evaluate(el=>{
     const style=getComputedStyle(el),rgb=value=>value.match(/[\d.]+/g).slice(0,3).map(Number);
     const light=value=>rgb(value).map(c=>{c/=255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);
     const a=light(style.color),b=light(style.backgroundColor);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    });
    assert.ok(contrast>=4.5);
    await page.locator('[data-builder-mode="questions"]').focus();await page.keyboard.press("ArrowRight");
    assert.equal(await page.locator('[data-builder-mode="logic"]').getAttribute("aria-selected"),"true");
    await page.keyboard.press("Home");assert.equal(await page.locator('[data-mode-panel="questions"]').isVisible(),true);
   });
   await check(`${width}: all sections collapse without removing inputs changing numbers or saving`,async()=>{
    await page.locator('[data-question-id="q1"] [data-question-settings]').click();
    await page.locator("[data-properties-close]").click();
    await page.locator('[data-sections-fold="collapse"]').click();
    assert.equal(await page.locator('[data-section-body][hidden]').count(),4);
    assert.equal(await page.locator('.builder-section-heading [data-section-title]:visible').count(),4);
    assert.equal(await page.locator('[data-question-id="q1"]').isVisible(),false);
    assert.equal(await page.locator('[data-question-id="q1"]').getAttribute("aria-current"),"true");
    assert.match(await page.locator('[data-section-id="sec1"] [data-section-summary]').innerText(),/선택 문항 포함/);
    assert.equal(await page.locator('[data-sections-fold="collapse"]').isDisabled(),true);
    assert.deepEqual(await page.locator(".question-card").evaluateAll(cards=>cards.map(card=>card.dataset.questionId)),originalIds);
    assert.deepEqual(await page.locator(".question-index").allTextContents(),originalNumbers);
    assert.equal(writes,0);assert.equal(await page.locator("[data-builder-discard]").isDisabled(),true);
    if (width===360) {
     const first=await page.locator('.builder-section-heading[data-section-id="sec1"]').boundingBox();
     const tools=await page.locator(".builder-toolbox").boundingBox();
     assert.ok(first.y>=tools.y+tools.height);
    }
    await page.screenshot({path:path.join(output,`all-collapsed-${width}.png`)});
   });
   await check(`${width}: each section expands and collapses with native keyboard controls`,async()=>{
    const toggle=page.locator('[data-section-id="sec2"] [data-section-toggle]');
    await toggle.focus();await page.keyboard.press("Space");
    assert.equal(await toggle.getAttribute("aria-expanded"),"true");
    const controlled=await toggle.getAttribute("aria-controls");
    assert.equal(await page.locator(`[id="${controlled}"]`).isVisible(),true);
    assert.equal(await page.locator('[data-section-body][hidden]').count(),3);
    assert.equal(await page.locator('[data-question-id="q1"]').getAttribute("aria-current"),"true");
    await page.keyboard.press("Enter");assert.equal(await toggle.getAttribute("aria-expanded"),"false");
    await page.locator('[data-sections-fold="expand"]').click();
    assert.equal(await page.locator('[data-section-body][hidden]').count(),0);
    assert.equal(await page.locator('[data-sections-fold="expand"]').isDisabled(),true);
    assert.equal(writes,0);
   });
   await check(`${width}: folds survive rerender and tab changes; section jump and selection reveal open their targets`,async()=>{
    await page.locator('[data-section-id="sec3"] [data-section-toggle]').click();
    await page.locator('[data-question-id="q1"] [data-question-settings]').click();
    await page.locator('[data-prop-description-enabled]').check();
    await page.locator("[data-properties-close]").click();
    assert.equal(await page.locator('[data-section-body="sec3"]').isVisible(),false);
    await tab("logic");await tab("settings");await tab("questions");
    assert.equal(await page.locator('[data-section-body="sec3"]').isVisible(),false);
    await page.locator('[data-sections-fold="collapse"]').click();
    await page.selectOption("[data-canvas-section]","sec3");
    assert.equal(await page.locator('[data-section-body="sec3"]').isVisible(),true);
    assert.equal(await page.locator('[data-section-body][hidden]').count(),3);
    await page.locator('[data-builder-scroll="selection"]').click();
    await page.waitForFunction(()=>!document.querySelector('[data-section-body="sec1"]').hidden);
    assert.equal(await page.locator('[data-question-id="q1"]').isVisible(),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    assert.equal(writes,0);
   });
   await check(`${width}: insertion into a collapsed section reveals the new question and folding is excluded from the save payload`,async()=>{
    await page.locator('[data-section-id="sec4"] [data-section-select]').click();
    await page.locator('[data-insert-type="number"]').click();
    await page.waitForFunction(()=>document.querySelectorAll(".question-card").length===81 && !document.querySelector('[data-section-body="sec4"]').hidden);
    assert.equal(await page.locator('.question-card[aria-current="true"]').getAttribute("data-section-id"),"sec4");
    assert.equal(await page.locator('[data-section-body="sec2"]').isVisible(),false);
    await page.locator('[data-sections-fold="collapse"]').click();
    await page.locator("[data-builder-save]").click();
    await page.waitForFunction(()=>document.querySelector("[data-builder-save-label]").dataset.saveState==="saved");
    assert.equal(writes,1);assert.equal(survey.sections.flatMap(s=>s.questions).length,81);
    assert.deepEqual(survey.sections.flatMap(s=>s.questions).slice(0,80).map(q=>q.id),originalIds);
    assert.equal(JSON.stringify(survey).includes("collapsedSections"),false);
    assert.equal(await page.locator('[data-section-body][hidden]').count(),4);
   });
  }
  assert.deepEqual(failures,[]);console.log(`Builder section audit passed: ${checks} scenarios; 1440/360px.`);
 } catch(error) {await page.screenshot({path:path.join(output,"failure.png")});throw error;}
 finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
