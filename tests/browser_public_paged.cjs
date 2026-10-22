// Paged public renderer regression with an 80-question synthetic survey; no live DB or recipients.
// SURVEYONE_PLAYWRIGHT_MODULE points to an existing playwright-core installation.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const {chromium} = require(process.env.SURVEYONE_PLAYWRIGHT_MODULE || "playwright-core");
const root = path.resolve(__dirname,"..");
const output = path.join(root,".tmp","public-paged-review");

const options=Array.from({length:60},(_,i)=>({id:`o${i+1}`,label:`보기 ${i+1} · 화면 높이보다 긴 선택지 목록의 이동과 응답 유지 확인`}));
const matrixRows=Array.from({length:30},(_,i)=>({id:`row${i+1}`,label:`검증 항목 ${i+1}`}));
const columns=[{id:"yes",label:"그렇다"},{id:"no",label:"아니다"}];
const questions=Array.from({length:80},(_,i)=>({id:`q${i+1}`,type:"short_text",title:`합성 설문 ${i+1}번 문항`,required:false}));
Object.assign(questions[0],{title:"시작 응답을 입력하세요",required:true});
Object.assign(questions[1],{type:"multiple",options,settings:{minSelections:1,maxSelections:2}});
Object.assign(questions[2],{type:"matrix_single",rows:matrixRows.map(row=>row.label),columns:columns.map(column=>column.label),settings:{rows:matrixRows,columns},required:true});
Object.assign(questions[3],{type:"long_text"});
Object.assign(questions[4],{type:"scale",min:0,max:10,minLabel:"낮음",maxLabel:"높음",settings:{scaleDisplay:"slider"}});
Object.assign(questions[5],{type:"table",rows:matrixRows.slice(0,15).map(row=>row.label),columns:columns.map(column=>column.label),settings:{rows:matrixRows.slice(0,15),columns}});
Object.assign(questions[6],{type:"repeat_table",columns:columns.map(column=>column.label),settings:{columns}});
Object.assign(questions[7],{type:"date"});
Object.assign(questions[8],{type:"number",min:0,max:100});
Object.assign(questions[9],{type:"dropdown",options});
Object.assign(questions[10],{type:"matrix_multiple",rows:matrixRows.slice(0,20).map(row=>row.label),columns:columns.map(column=>column.label),settings:{rows:matrixRows.slice(0,20),columns}});
Object.assign(questions[11],{type:"single",options});
Object.assign(questions[12],{type:"slider",min:0,max:100});
const fixture={id:"synthetic-paged",slug:"synthetic-paged",title:"80문항 화면 이동 검증용 설문",description:"합성 설문입니다. 실제 응답이나 연락처는 사용하지 않습니다.",sections:Array.from({length:4},(_,i)=>({id:`s${i+1}`,title:`섹션 ${i+1}`,questions:questions.slice(i*20,(i+1)*20)})),settings:{presentationMode:"one_at_a_time",showProgressBar:true,showQuestionNumbers:true},skin:{preset:"ocean"},languages:{sourceLocale:"ko",defaultLocale:"ko",enabled:["ko","en"]},guestDemo:true};
let survey=structuredClone(fixture),posts=[],checks=0;
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

 await page.emulateMedia({reducedMotion:"reduce"});
 await page.route("**/api/**",async route=>{
  const req=route.request();
  if(req.method()==="POST") {posts.push(req.postDataJSON());return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({ok:true})});}
  await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({survey})});
 });
 async function pagerVisible() {
  await page.waitForFunction(()=>{
   const header=document.querySelector(".public-header").getBoundingClientRect();
   const pager=document.querySelector("[data-public-pager]").getBoundingClientRect();
   return pager.height>=44&&pager.top>=header.bottom-1&&pager.top<header.bottom+35;
  });
 }
 async function advanceToLast() {
  await page.evaluate(()=>{for(let i=0;i<85;i++){
   const visible=[...document.querySelectorAll(".public-question-card")].filter(card=>card.getClientRects().length);
   if(visible.length!==1) throw new Error("Each page must show exactly one question");
   if(document.documentElement.scrollWidth>innerWidth+1) throw new Error("Question must not overflow the viewport: "+visible[0].dataset.questionId);
   const next=document.querySelector("[data-public-next]");if(next.hidden)break;next.click();
  }});
  await page.waitForFunction(()=>document.querySelector(".is-current-question")?.dataset.questionId==="q80");
 }
 try {
  for(const [width,height] of (process.env.SURVEYONE_PAGED_PREVIEW_ONLY === "1" ? [] : [[1440,900],[768,1024],[360,800]])) {
   survey=structuredClone(fixture);await page.setViewportSize({width,height});
   await page.goto(base+"/frontend/public.html?slug=synthetic-paged");
   await page.evaluate(()=>sessionStorage.clear());await page.reload();
   await page.locator('[data-question-id="q1"] input').waitFor();
   await check(`${width}: first page has introduction, navigation precedes content, and required input blocks next`,async()=>{
    assert.equal(await page.locator("h1").count(),1);
    assert.equal(await page.locator(".public-cover").evaluate(el=>el.classList.contains("public-visually-hidden")),false);
    assert.ok(await page.locator("[data-public-pager]").evaluate(el=>Boolean(el.compareDocumentPosition(document.querySelector(".public-cover"))&Node.DOCUMENT_POSITION_FOLLOWING)));
    assert.equal(await page.locator(".public-submit-row").isVisible(),false);
    await page.locator("[data-public-next]").click();
    assert.equal(await page.locator(".is-current-question").getAttribute("data-question-id"),"q1");
    assert.equal(await page.locator('[data-question-id="q1"] input').evaluate(el=>el===document.activeElement),true);
    await page.locator('[data-question-id="q1"] input').fill("합성 응답");
   });
   await check(`${width}: tall choices keep the pager visible and preserve answers across previous/next`,async()=>{
    await page.locator("[data-public-next]").click();
    assert.equal(await page.locator(".public-cover").evaluate(el=>el.classList.contains("public-visually-hidden")),true);
    assert.equal(await page.locator("[data-public-demo-banner]").isVisible(),true);
    await page.locator('[data-question-id="q2"] input[value="o60"]').check();
    await page.evaluate(()=>window.scrollTo({top:document.documentElement.scrollHeight,behavior:"instant"}));await pagerVisible();
    await page.screenshot({path:path.join(output,`choices-${width}.png`)});
    await page.locator("[data-public-previous]").click();
    assert.equal(await page.locator('[data-question-id="q1"] input').inputValue(),"합성 응답");
    assert.equal(await page.locator(".public-cover").evaluate(el=>el.classList.contains("public-visually-hidden")),false);
    await page.locator("[data-public-next]").click();
    assert.equal(await page.locator('[data-question-id="q2"] input[value="o60"]').isChecked(),true);
    await page.locator("[data-public-next]").click();
    await page.locator('[data-question-id="q3"]').evaluate(card=>[...card.querySelectorAll("[data-matrix-row-id]")].slice(0,-1).forEach(row=>{const input=row.querySelector("input");input.checked=true;input.dispatchEvent(new Event("change",{bubbles:true}));}));
   });
   await check(`${width}: all 80 pages remain single-question pages and errors reveal the missing matrix row below the pager`,async()=>{
    await advanceToLast();
    assert.equal(await page.locator(".public-question-card:visible").count(),1);
    assert.match(await page.locator("[data-public-page-status]").textContent(),/80.*80/);
    assert.equal(await page.locator(".public-submit-row").isVisible(),true);
    await page.locator(".public-submit").click();
    await page.waitForFunction(()=>document.querySelector(".is-current-question")?.dataset.questionId==="q3");
    const focused=await page.evaluate(()=>({row:document.activeElement.closest("[data-matrix-row-id]")?.dataset.matrixRowId,top:document.activeElement.getBoundingClientRect().top,pager:document.querySelector("[data-public-pager]").getBoundingClientRect().bottom}));
    assert.equal(focused.row,"row30");assert.ok(focused.top>=focused.pager);
    assert.equal(await page.locator(".public-submit-row").isVisible(),false);
    await page.locator('[data-question-id="q3"]').evaluate(card=>card.querySelectorAll("[data-matrix-row-id]").forEach(row=>{const input=row.querySelector("input");input.checked=true;input.dispatchEvent(new Event("change",{bubbles:true}));}));
    await advanceToLast();
    const before=posts.length;await page.locator(".public-submit").click();
    await page.locator("[data-public-state]:visible").waitFor();assert.equal(posts.length,before+1);
    assert.equal(posts.at(-1).answers.q1,"합성 응답");assert.deepEqual(posts.at(-1).answers.q2,["o60"]);
    assert.equal(Object.keys(posts.at(-1).answers.q3).length,30);
   });
   await check(`${width}: scroll mode keeps the whole survey and original submit behavior`,async()=>{
    survey=structuredClone(fixture);survey.settings.presentationMode="scroll";
    await page.goto(base+"/frontend/public.html?slug=synthetic-scroll");await page.locator('[data-question-id="q80"]').waitFor();
    assert.equal(await page.locator("[data-public-pager]").isVisible(),false);
    assert.equal(await page.locator(".public-question-card:visible").count(),80);
    assert.equal(await page.locator(".public-submit-row").isVisible(),true);
    assert.equal(await page.locator(".public-cover").evaluate(el=>el.classList.contains("public-visually-hidden")),false);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
   });
  }

  await check("preview iframe: same sticky paging and title behavior, with no submission",async()=>{
   survey=structuredClone(fixture);
   const token="12345678-1234-4234-8234-123456789abc";
   await page.route("**/fixture-preview",route=>route.fulfill({status:200,contentType:"text/html",body:`<!doctype html><html><head><title>Preview fixture</title></head><body style="margin:0"><iframe id="fixture-frame" title="합성 설문 미리보기" style="width:100%;height:700px;border:0" src="/frontend/public.html?preview=1&previewToken=${token}"></iframe></body></html>`}));
   await page.addInitScript(({draft,token})=>window.addEventListener("message",event=>{
    const frame=document.querySelector("#fixture-frame");
    if(event.origin===location.origin&&event.source===frame?.contentWindow&&event.data?.type==="surveyone-preview-ready"&&event.data.token===token) frame.contentWindow.postMessage({type:"surveyone-preview-draft",token,draft,locale:"ko"},location.origin);
   }),{draft:survey,token});
   await page.setViewportSize({width:400,height:800});await page.goto(base+"/fixture-preview");
   const frame=page.frameLocator("#fixture-frame");
   await frame.locator('[data-question-id="q1"] input').fill("합성 미리보기");
   await frame.locator("[data-public-next]").click();
   assert.equal(await frame.locator(".public-cover").evaluate(el=>el.classList.contains("public-visually-hidden")),true);
   await frame.locator('[data-question-id="q2"] input[value="o60"]').check();
   await frame.locator("[data-public-pager]").evaluate(()=>window.scrollTo({top:document.documentElement.scrollHeight,behavior:"instant"}));
   const bounds=await frame.locator("[data-public-pager]").evaluate(el=>({top:el.getBoundingClientRect().top,header:document.querySelector(".public-header").getBoundingClientRect().bottom}));
   assert.ok(Math.abs(bounds.top-bounds.header-5)<2);
   await frame.locator('[data-question-id="q3"]').evaluate(card=>card.querySelectorAll("[data-matrix-row-id]").forEach(row=>{const input=row.querySelector("input");input.checked=true;input.dispatchEvent(new Event("change",{bubbles:true}));}));
   await frame.locator("[data-public-next]").evaluate(()=>{for(let i=0;i<85;i++){const next=document.querySelector("[data-public-next]");if(next.hidden)break;next.click();}});
   const before=posts.length;await frame.locator(".public-submit").click();
   assert.match(await frame.locator("[data-public-demo-banner]").textContent(),/입력 검증 통과/);
   assert.equal(posts.length,before);
   const gap=await frame.locator('[data-question-id="q80"]').evaluate(card=>card.getBoundingClientRect().top-document.querySelector("[data-public-demo-banner]").getBoundingClientRect().bottom);
   assert.ok(gap<=32,"other sections must not leave empty grid rows above the current question");
   await page.screenshot({path:path.join(output,"preview-paged.png")});
  });
  assert.deepEqual(failures,[]);console.log(`Public paged audit passed: ${checks} scenarios; 80 questions, 60 options, 30 matrix rows.`);
 } catch(error) {await page.screenshot({path:path.join(output,"failure.png")});throw error;}
 finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
