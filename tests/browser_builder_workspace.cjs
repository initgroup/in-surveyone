// Single compact layout and independent scrolling regression; loopback server and synthetic API only.
// SURVEYONE_PLAYWRIGHT_MODULE points to an existing playwright-core installation.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const {chromium} = require(process.env.SURVEYONE_PLAYWRIGHT_MODULE || "playwright-core");
const root = path.resolve(__dirname,"..");
const output = path.join(root,".tmp","builder-workspace-review");
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
  for(const [width,height] of [[1440,900],[1280,800],[1024,768],[360,900]]) {
   await page.goto("about:blank");survey=structuredClone(fixture);writes=0;
   await page.setViewportSize({width,height});await page.goto(base+"/#/M02003?surveyId="+survey.id);
   await page.locator('[data-question-id="q80"]').waitFor({state:"attached"});
   const region=page.locator("[data-builder-document-scroll]");
   if(width>960) await page.waitForFunction(()=>scrollY>10 && Math.abs(document.querySelector(".builder-workspace").getBoundingClientRect().top-document.querySelector(".builder-topbar").getBoundingClientRect().bottom)<4);
   let defaultHeight=0;
   await check(`${width}: outer scrolling can reveal instructions while the workbench keeps its full height`,async()=>{
    if(width>960) {
     defaultHeight=await region.evaluate(el=>el.clientHeight);
     assert.ok(defaultHeight>=280);
     assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight>innerHeight+40),true);
     await page.evaluate(()=>window.scrollTo({top:0,behavior:"instant"}));
     const step=await page.locator("[data-builder-flow]").boundingBox();assert.ok(step.y>=0 && step.y<height);
     assert.equal(await region.evaluate(el=>el.clientHeight),defaultHeight);
     await page.evaluate(()=>window.scrollTo({top:document.documentElement.scrollHeight,behavior:"instant"}));
     const baseline=await page.evaluate(()=>scrollY);
     await region.hover();await page.mouse.wheel(0,650);await page.waitForTimeout(80);
     assert.ok(await region.evaluate(el=>el.scrollTop)>400);
     assert.ok(Math.abs(await page.evaluate(()=>scrollY)-baseline)<3);
    } else assert.notEqual(await region.evaluate(el=>getComputedStyle(el).overflowY),"auto");
    assert.equal(writes,0);
    await page.screenshot({path:path.join(output,`default-${width}.png`)});
   });
   await check(`${width}: compact tools reclaim space and keyboard help does not move the document`,async()=>{
    const navigation=page.locator(".builder-document-navigation");
    const tools=page.locator(".builder-toolbox");
    if(width>960) {
     assert.ok(await navigation.evaluate(el=>el.getBoundingClientRect().height)<=54,"navigation must stay on one compact row");
     assert.ok(await tools.locator(".builder-insertion-guide").evaluate(el=>el.getBoundingClientRect().height)<=94,"insertion controls must take exactly two rows");
     assert.ok(await tools.evaluate(el=>el.querySelector(".question-tool-list").getBoundingClientRect().top-el.getBoundingClientRect().top)<=165,"top section action and insertion controls must stay compact");
     const combo=tools.locator("[data-insertion-position]");
     assert.equal(await combo.getAttribute("aria-describedby"),"builderInsertionStatus");
     assert.match(await combo.getAttribute("title"),/추가/);
     assert.ok(await tools.locator("[data-question-type]").evaluateAll(els=>els.every(el=>el.getBoundingClientRect().height<=60)),"type names and icons should share horizontal space");
     assert.ok(defaultHeight>=(width===1440?560:420),"document height must grow without enabling focus mode");
    }
    const help=page.locator('[popovertarget="builderCanvasHelp"]').first();
    await help.focus();await page.keyboard.press("Enter");
    assert.equal(await page.locator("#builderCanvasHelp").evaluate(el=>el.matches(":popover-open")),true);
    const position=await region.evaluate(el=>el.scrollTop);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#builderCanvasHelp").evaluate(el=>el.matches(":popover-open")),false);
    assert.equal(await region.evaluate(el=>el.scrollTop),position);
    assert.equal(await help.evaluate(el=>el===document.activeElement),true);
    if(width>960) {
     await page.locator('[data-builder-scroll="selection"]').click();
     await page.locator('[data-question-id="q1"] [data-question-title]').click();
     const banner=page.locator('[data-question-id="q1"] [data-question-selection]');
     assert.equal(await banner.isVisible(),true);
     assert.ok(await banner.evaluate(el=>el.getBoundingClientRect().height)<=60,"selection banner must use one compact row");
     await page.locator('.builder-help-button[popovertarget="builderPaletteHelp"]').click();
     assert.equal(await page.locator("#builderPaletteHelp").evaluate(el=>el.matches(":popover-open")),true);
     await page.locator('#builderPaletteHelp button').click();
    }
    assert.equal(writes,0);
    await page.screenshot({path:path.join(output,`compact-${width}.png`)});
   });
   await check(`${width}: one compact layout retains all editing and save controls`,async()=>{
    assert.equal(await page.locator("[data-builder-focus]").count(),0);
    for(const selector of ["[data-builder-save]","[data-builder-discard]","[data-builder-preview]","[data-builder-publish]"]) {
     assert.equal(await page.locator(selector).isVisible(),true);
     assert.equal(await page.locator(selector).evaluate(el=>el.getBoundingClientRect().height),44);
    }
    assert.equal(await page.locator("[data-builder-mode]").count(),3);
    assert.equal(await page.locator("[data-add-selected-question]").isVisible(),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    if(width>960) {
     const bounds=await region.boundingBox();assert.ok(bounds.y>=0 && bounds.y+bounds.height<=height+1);
     assert.ok(defaultHeight>=(width===1440?620:490),"compact workbench is the only layout");
     console.log(`HEIGHT ${width}: ${defaultHeight}px single layout`);
    }
    assert.equal(writes,0);
   });
   await check(`${width}: draft selection and folds survive tabs and window resizing`,async()=>{
    await page.locator('[data-question-id="q1"] [data-question-title]').fill("공간 전환 후에도 보존할 미저장 문항");
    await page.locator('[data-section-id="sec3"] [data-section-toggle]').click();
    await tab("logic");await tab("settings");await tab("questions");
    assert.equal(await page.locator('[data-section-body="sec3"]').isVisible(),false);
    await page.setViewportSize({width,height:height+40});
    await page.setViewportSize({width,height});
    assert.equal(await page.locator('[data-question-id="q1"] [data-question-title]').inputValue(),"공간 전환 후에도 보존할 미저장 문항");
    assert.equal(await page.locator('[data-question-id="q1"]').getAttribute("aria-current"),"true");
    assert.equal(await page.locator('[data-section-body="sec3"]').isVisible(),false);
    assert.equal(writes,0);assert.equal(survey.questions[0].title,fixture.questions[0].title);
   });
  }
  assert.deepEqual(failures,[]);console.log(`Builder workspace audit passed: ${checks} scenarios; 1440/1280/1024/360px.`);
 } catch(error) {
  console.log(await page.evaluate(()=>({width:innerWidth,height:innerHeight,y:scrollY,total:document.documentElement.scrollHeight,toolbar:document.querySelector(".builder-topbar")?.getBoundingClientRect().bottom,workspace:document.querySelector(".builder-workspace")?.getBoundingClientRect().top})));
  await page.screenshot({path:path.join(output,"failure.png")});throw error;
 }
 finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
