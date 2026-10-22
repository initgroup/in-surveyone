// Focused long-document scroll regression; loopback server and synthetic API only.
// SURVEYONE_PLAYWRIGHT_MODULE points to an existing playwright-core installation.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const {chromium} = require(process.env.SURVEYONE_PLAYWRIGHT_MODULE || "playwright-core");
const root = path.resolve(__dirname,"..");
const output = path.join(root,".tmp","builder-scroll-review");
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
  for(const width of [1600,1024]) {
   await page.goto("about:blank");survey=structuredClone(fixture);writes=0;
   await page.setViewportSize({width,height:1000});
   await page.goto(base+"/#/M02003?surveyId="+survey.id);
   const region=page.locator("[data-builder-document-scroll]");
   await page.locator('[data-question-id="q80"]').waitFor({state:"attached"});
   await page.waitForFunction(()=>scrollY>10 && Math.abs(document.querySelector(".builder-workspace").getBoundingClientRect().top-document.querySelector(".builder-topbar").getBoundingClientRect().bottom)<4);
   const outerBaseline=await page.evaluate(()=>scrollY);
   await check(`${width}: long document has its own visible scrollbar`,async()=>{
    assert.equal(await region.evaluate(el=>getComputedStyle(el).overflowY),"auto");
    assert.equal(await region.evaluate(el=>el.scrollHeight>el.clientHeight*10 && el.clientHeight>200),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight>innerHeight+40),true);
    const center=await region.boundingBox(),toolbox=await page.locator(".builder-toolbox").boundingBox();
    assert.ok(center.x>=toolbox.x+toolbox.width-1);
    if(width===1600) {
     const inspector=await page.locator(".builder-properties").boundingBox();
     assert.ok(Math.abs(center.x+center.width-inspector.x)<2);
    }
    await region.hover();await page.mouse.wheel(0,1000);await page.waitForTimeout(100);
    assert.ok(await region.evaluate(el=>el.scrollTop)>500);
    assert.equal(await page.locator(".builder-toolbox").evaluate(el=>el.scrollTop),0);
    assert.ok(Math.abs(await page.evaluate(()=>scrollY)-outerBaseline)<4);
   });
   await check(`${width}: section jump and selected question navigation do not change the draft`,async()=>{
    await page.selectOption("[data-canvas-section]","sec3");
    const heading=page.locator('.builder-section-heading[data-section-id="sec3"]');
    const viewport=await region.boundingBox(),target=await heading.boundingBox();
    assert.ok(target.y>=viewport.y-1 && target.y<viewport.y+viewport.height);
    await page.locator('[data-builder-scroll="start"]').click();
    assert.equal(await region.evaluate(el=>el.scrollTop),0);
    await page.locator('[data-question-id="q1"] [data-question-settings]').click();
    if(width===1024) await page.locator("[data-properties-close]").click();
    await page.locator('[data-builder-scroll="end"]').click();
    assert.equal(await region.evaluate(el=>Math.abs(el.scrollHeight-el.clientHeight-el.scrollTop)<2),true);
    await page.locator('[data-builder-scroll="selection"]').click();
    await page.waitForFunction(()=>{
     const region=document.querySelector("[data-builder-document-scroll]").getBoundingClientRect(),card=document.querySelector('[data-question-id="q1"]').getBoundingClientRect();
     return card.top>=region.top-1 && card.top<region.bottom;
    });
    const selected=await page.locator('[data-question-id="q1"]').boundingBox();
    assert.ok(selected.y>=viewport.y-1 && selected.y<viewport.y+viewport.height);
    assert.equal(await page.locator('[data-question-id="q1"]').getAttribute("aria-current"),"true");
    assert.equal(writes,0);
    assert.equal(await page.locator("[data-builder-discard]").isDisabled(),true);
   });
   if(width===1600) await check("1600: inspector palette and body scroll independently",async()=>{
    const before=await region.evaluate(el=>el.scrollTop);
    const inspector=page.locator(".builder-properties");
    await inspector.hover();await page.mouse.wheel(0,600);await page.waitForTimeout(100);
    assert.ok(await inspector.evaluate(el=>el.scrollTop)>100);
    assert.equal(await region.evaluate(el=>el.scrollTop),before);
    const palette=page.locator(".builder-toolbox");
    await palette.hover();await page.mouse.wheel(0,500);await page.waitForTimeout(100);
    assert.ok(await palette.evaluate(el=>el.scrollTop)>0);
    assert.equal(await region.evaluate(el=>el.scrollTop),before);
    await page.screenshot({path:path.join(output,"independent-panels-1600.png")});
   });
   await check(`${width}: keyboard and per-tab positions stay inside the document`,async()=>{
    await region.focus();await page.keyboard.press("End");
    await page.waitForFunction(()=>{const el=document.querySelector("[data-builder-document-scroll]");return el.scrollTop>el.scrollHeight-el.clientHeight-3;});
    const questionPosition=await region.evaluate(el=>el.scrollTop);
    await tab("logic");assert.equal(await region.evaluate(el=>el.scrollTop),0);
    await region.evaluate(el=>{el.scrollTop=230;});
    await tab("settings");assert.equal(await region.evaluate(el=>el.scrollTop),0);
    await region.evaluate(el=>{el.scrollTop=100;});
    await tab("questions");assert.ok(Math.abs(await region.evaluate(el=>el.scrollTop)-questionPosition)<3);
    await tab("logic");assert.ok(Math.abs(await region.evaluate(el=>el.scrollTop)-230)<3);
    await tab("questions");
    assert.ok(Math.abs(await page.evaluate(()=>scrollY)-outerBaseline)<4);assert.equal(writes,0);
   });
   await check(`${width}: adding at the tail reveals and focuses the new question in the center`,async()=>{
    await page.locator('[data-question-type="number"]').click();
    await page.locator("[data-canvas-add]").click();
    await page.waitForFunction(()=>document.querySelectorAll(".question-card").length===81);
    await page.waitForFunction(()=>document.activeElement?.matches("[data-question-title]"));
    const card=page.locator('.question-card[aria-current="true"]');
    assert.equal(await card.getAttribute("data-section-id"),"sec4");
    const viewport=await region.boundingBox(),selected=await card.boundingBox();
    assert.ok(selected.y>=viewport.y-1 && selected.y<viewport.y+viewport.height);
    assert.ok(Math.abs(await page.evaluate(()=>scrollY)-outerBaseline)<4);assert.equal(writes,0);
    if(width===1600) await page.screenshot({path:path.join(output,"tail-question-1600.png")});
   });
  }
  for(const width of [768,360]) {
   await page.goto("about:blank");survey=structuredClone(fixture);writes=0;
   await page.setViewportSize({width,height:1000});await page.goto(base+"/#/M02003?surveyId="+survey.id);
   await page.locator('[data-question-id="q1"]').waitFor();
   await check(`${width}: touch layout keeps a single page scroll and navigation works`,async()=>{
    const region=page.locator("[data-builder-document-scroll]");
    assert.notEqual(await region.evaluate(el=>getComputedStyle(el).overflowY),"auto");
    await page.selectOption("[data-canvas-section]","sec3");
    assert.ok(await page.evaluate(()=>scrollY)>1000);
    await page.locator('[data-builder-scroll="start"]').click();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    assert.equal(writes,0);
    await page.screenshot({path:path.join(output,`touch-${width}.png`)});
   });
  }
  assert.deepEqual(failures,[]);console.log(`Builder scroll audit passed: ${checks} scenarios; independent desktop and single-scroll touch layouts.`);
 } catch(error) {await page.screenshot({path:path.join(output,"failure.png")});throw error;}
 finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
