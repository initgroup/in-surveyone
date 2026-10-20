from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def _node(source: str) -> None:
    node = shutil.which("node")
    if not node:
        pytest.skip("Node is unavailable")
    result = subprocess.run([node, "-e", source], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    assert result.returncode == 0, result.stdout + result.stderr


HARNESS = r"""
const assert = require("node:assert/strict");
const fs = require("node:fs");
global.window = global;
global.document = { addEventListener() {}, querySelector() { return null; } };
global.CSS = { escape(value) { return String(value); } };
global.Common = { escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;"); }, api: { post() { throw new Error("Unexpected POST"); }, get() { throw new Error("Unexpected GET"); } } };
global.SURVEYONE_CONFIG = {};
eval(fs.readFileSync("frontend/js/question-numbering.js", "utf8"));
const source = fs.readFileSync("frontend/js/public.js", "utf8");
eval(source.replace(/\}\)\(\);\s*$/, "globalThis.runtime = {state, dom, answerMarkup, applyChoiceExclusions, filterChoiceOptions, scheduleDraft, submit, onClick, noticePageVisible, collectAnswers, populateDraft, updateRating};})();"));
runtime.state.survey = { settings: {} };
"""


def test_scale_preserves_descending_values_and_endpoint_labels() -> None:
    _node(HARNESS + r"""
const { state, answerMarkup } = runtime;
const q = { id: "scale_1", type: "scale", title: "Rating", min: 1, max: 10, minLabel: "LOW", maxLabel: "HIGH", settings: { scaleOrder: "descending" } };
state.sections = [{id:"s", questions:[q]}];
const html = answerMarkup(q, { titleId:"title", describedBy:"help" });
assert.deepEqual([...html.matchAll(/value="(\d+)"/g)].map(match => Number(match[1])), [10,9,8,7,6,5,4,3,2,1]);
assert(html.indexOf(">HIGH</span>") < html.indexOf(">LOW</span>"));
q.settings.scaleOrder = "ascending";
assert.deepEqual([...answerMarkup(q, {titleId:"title",describedBy:"help"}).matchAll(/value="(\d+)"/g)].map(match => Number(match[1])), [1,2,3,4,5,6,7,8,9,10]);
const css = fs.readFileSync("frontend/css/public.css", "utf8");
assert(css.includes("grid-template-columns:repeat(min(var(--scale-count,5),5),minmax(44px,1fr))"));
""")


def test_exclusion_clears_selected_department_and_restores_it_when_source_changes() -> None:
    _node(HARNESS + r"""
const option = { value: "dept_a", checked: true, disabled: false, matches() {return false;}, closest() {return { classList: {toggle(){}} };} };
const second = {...option, value:"dept_b", checked:true};
const card = { hidden:false, closest() {return {hidden:false};}, querySelectorAll() {return [option,second];}, querySelector() {return null;} };
runtime.dom.list = {querySelector() {return card;}};
runtime.state.questions = [{id:"cooperation",type:"multiple",settings:{excludeSelectedFrom:"department"}}];
runtime.state.answers = {department:"dept_a",cooperation:["dept_a","dept_b"]};
assert.equal(runtime.applyChoiceExclusions(),true);
assert.equal(option.checked,false);
assert.equal(option.disabled,true);
assert.deepEqual(runtime.state.answers.cooperation,["dept_b"]);
runtime.state.answers.department = "dept_b";
runtime.applyChoiceExclusions();
assert.equal(option.disabled,false);
assert.equal(second.checked,false);
assert.deepEqual(runtime.state.answers.cooperation,[]);
""")


def test_preview_never_persists_or_submits_responses() -> None:
    _node(HARNESS + r"""
(async () => {
global.sessionStorage = {setItem() {throw new Error("Unexpected storage");}};
runtime.state.preview = true;
runtime.state.sections = [];
runtime.state.questions = [];
runtime.dom.list = {querySelectorAll() {return [];}};
runtime.dom.summary = {querySelector() {return {};}};
runtime.dom.saveState = {};
runtime.dom.demoBanner = {scrollIntoView() {}};
runtime.scheduleDraft();
assert.equal(runtime.state.saveTimer,null);
await runtime.onClick({preventDefault() {}, target:{closest(selector) {return selector === ".public-submit" ? {} : null;}}});
assert(runtime.dom.demoBanner.textContent.includes("서버에 제출되지"));
assert(runtime.dom.saveState.textContent.includes("저장되지"));
})().catch(error => {console.error(error);process.exitCode=1;});
""")


def test_search_keeps_selected_choices_visible() -> None:
    _node(HARNESS + r"""
const make = (title,selected) => ({textContent:title,hidden:false,matches(){return false;},querySelector(){return {checked:selected,disabled:false};}});
const selected = make("Alpha",true), matching = make("Beta",false), other = make("Gamma",false);
const output = {};
const card = {querySelector(selector) {return selector === "[data-choice-search]" ? {value:"beta"} : selector === "[data-choice-search-status]" ? output : null;},querySelectorAll(){return [selected,matching,other];}};
runtime.filterChoiceOptions(card);
assert.equal(selected.hidden,false);
assert.equal(matching.hidden,false);
assert.equal(other.hidden,true);
assert(output.textContent.includes("2"));
""")


def test_import_preserves_project_schedule_policy_and_identity() -> None:
    _node(r"""
const assert = require("node:assert/strict");
const fs = require("node:fs");
global.window = global;
eval(fs.readFileSync("frontend/js/M02003.js", "utf8"));
const page = Pages.M02003;
page.survey = { id:"original", slug:"original-slug", revision:7, projectProfile:{startsAt:"2026-01-01T00:00:00Z",closesAt:"2026-12-31T00:00:00Z"}, settings:{anonymous:false,collectEmail:true,oneResponsePerRespondent:true,oneResponse:true,allowResponseEdit:true,allowEdit:true,startsAt:"2026-01-01T00:00:00Z",closesAt:"2026-12-31T00:00:00Z",retentionDays:10,presentationMode:"scroll",showProgressBar:true,showProgress:true} };
const source = { id:"injected",slug:"injected",projectProfile:{}, title:"Imported",sections:[],settings:{anonymous:true,collectEmail:false,oneResponsePerRespondent:false,allowResponseEdit:false,startsAt:null,closesAt:null,retentionDays:9999,presentationMode:"one_at_a_time",showProgressBar:false,showQuestionNumbers:false,confirmationMessage:"Done"} };
const result = page.draftImportPayload(source);
assert.equal(result.id,undefined);
assert.equal(result.slug,undefined);
assert.deepEqual(result.projectProfile,page.survey.projectProfile);
for (const key of ["anonymous","collectEmail","oneResponsePerRespondent","oneResponse","allowResponseEdit","allowEdit","startsAt","closesAt","retentionDays"]) assert.equal(result.settings[key],page.survey.settings[key],key);
assert.equal(result.settings.presentationMode,"one_at_a_time");
assert.equal(result.settings.showQuestionNumbers,false);
assert.equal(result.settings.showProgressBar,false);
assert.equal(result.settings.showProgress,undefined);
assert.equal(result.expectedRevision,7);
assert.equal(page.survey.settings.presentationMode,"scroll");
""")


def test_notice_only_cover_and_interstitial_remain_readable_in_paged_mode() -> None:
    _node(HARNESS + r"""
runtime.state.sections = [{id:"cover"},{id:"first"},{id:"instructions"},{id:"second"},{id:"finish"}];
const active = ["first","first","second"];
assert.equal(runtime.noticePageVisible("cover","first",active,0),true);
assert.equal(runtime.noticePageVisible("cover","first",active,1),false);
assert.equal(runtime.noticePageVisible("instructions","second",active,2),true);
assert.equal(runtime.noticePageVisible("instructions","first",active,0),false);
assert.equal(runtime.noticePageVisible("finish","second",active,2),true);
""")


def test_linked_choice_clone_preserves_source_option_ids() -> None:
    _node(r"""
const assert = require("node:assert/strict");
const fs = require("node:fs");
global.window = global;
global.crypto = require("node:crypto").webcrypto;
eval(fs.readFileSync("frontend/js/M02003.js", "utf8"));
const page = Pages.M02003;
const source = {id:"department",type:"single",options:[{id:"dept_a",label:"A"},{id:"dept_b",label:"B"}]};
const dependent = {id:"cooperation",type:"multiple",options:[{id:"old",label:"Old"}],settings:{}};
page.survey = {sections:[{id:"s",questions:[source,dependent]}],translations:{}};
page.renderQuestions = () => {};
page.openProperties = () => {};
page.scheduleSave = () => {};
page.applyExcludedSource(dependent,"department",true);
assert.deepEqual(dependent.options,source.options);
assert.notEqual(dependent.options,source.options);
assert.equal(dependent.settings.excludeSelectedFrom,"department");
page.duplicateQuestion("cooperation");
const copy = page.survey.sections[0].questions[2];
assert.notEqual(copy.id,dependent.id);
assert.deepEqual(copy.options.map(option => option.id),["dept_a","dept_b"]);
assert.equal(copy.settings.excludeSelectedFrom,"department");
""")


def test_opaque_preview_uses_explicit_button_activation_without_form_permission() -> None:
    script = (ROOT / "frontend/js/public.js").read_text(encoding="utf-8")
    builder = (ROOT / "frontend/js/M02003.js").read_text(encoding="utf-8")
    assert 'button.type = "button";' in script
    assert 'state.preview && event.target.closest(".public-submit")' in script
    assert 'state.preview && event.key === "Enter" && !event.isComposing' in script
    assert 'event.target.matches("input:not([type=search])")' in script
    assert 'sandbox="allow-scripts"' in builder
    assert "allow-forms" not in builder


def test_rating_keeps_unanswered_and_zero_distinct_through_collection_and_restore() -> None:
    _node(HARNESS + r"""
const q = {id:"rating",type:"scale",title:"Rating",min:0,max:10,minLabel:"Low",maxLabel:"High",settings:{scaleDisplay:"slider",scaleOrder:"descending"}};
runtime.state.sections = [{id:"s",questions:[q]}];
runtime.state.questions = [q];
const input = {value:""}, range = {value:"0",min:"0",max:"10",setAttribute(key,value){this[key]=value;}};
const output = {}, clear = {}, ticks = [{textContent:"0",classList:{toggle(name,selected){this.selected=selected;}}}];
const stops = [{dataset:{ratingStop:"0"},classList:{toggle(name,selected){this.selected=selected;}}}];
const group = {querySelector(selector){return {"[data-rating-input]":input,"[data-slider]":range,"[data-slider-value]":output,"[data-rating-clear]":clear}[selector];},querySelectorAll(selector){return selector === "[data-rating-stop]" ? stops : ticks;},classList:{toggle(name,value){this.unanswered=value;}}};
const card = {dataset:{questionId:"rating"},querySelector(selector){return selector === "[data-rating-input]" ? input : selector === "[data-rating]" ? group : null;}};
runtime.dom.list = {querySelectorAll(){return [card];},querySelector(){return card;}};
runtime.collectAnswers();
assert.equal(runtime.state.answers.rating,"");
runtime.updateRating(card);
assert.equal(clear.disabled,true);
assert.equal(group.classList.unanswered,true);
runtime.state.answers = {rating:0};
runtime.populateDraft();
assert.equal(input.value,"0");
assert.equal(range.value,"0");
assert.equal(group.classList.unanswered,false);
assert.equal(clear.disabled,false);
assert.equal(range["aria-valuetext"],"0 · Low");
assert.equal(output.textContent,"0 / 10 · Low");
assert.equal(stops[0].classList.selected,true);
assert.equal(ticks[0].classList.selected,true);
runtime.collectAnswers();
assert.equal(runtime.state.answers.rating,"0");
input.value="";
runtime.collectAnswers();runtime.updateRating(card);
assert.equal(runtime.state.answers.rating,"");
assert.equal(clear.disabled,true);
assert.equal(range["aria-valuetext"],"미응답");
assert.equal(output.textContent,"미응답");
assert.equal(stops[0].classList.selected,false);
assert.equal(ticks[0].classList.selected,false);
""")


def test_slider_markup_exposes_an_empty_direct_control_and_localized_endpoints() -> None:
    _node(HARNESS + r"""
const q = {id:"five",type:"scale",title:"Rating",min:1,max:5,minLabel:"LOW",maxLabel:"HIGH",settings:{scaleDisplay:"slider",scaleOrder:"descending"}};
runtime.state.sections = [{id:"s",questions:[q]}];
const html = runtime.answerMarkup(q,{titleId:"title",describedBy:"help error"});
assert.match(html,/<option value="">미응답<\/option>/);
assert.match(html,/dir="rtl"/);
assert.match(html,/data-rating-input/);
assert(html.indexOf(">HIGH</span>")<html.indexOf(">LOW</span>"));
assert.deepEqual([...html.matchAll(/<option value="(\d+)"/g)].map(x=>x[1]),["5","4","3","2","1"]);
assert.match(html,/aria-describedby="help error"/);
assert(html.indexOf("rating-endpoints")<html.indexOf("rating-rail"));
assert(html.indexOf("rating-ticks")<html.indexOf("rating-selection"));
assert(html.indexOf("rating-selection")<html.indexOf("rating-controls"));
assert.match(html,/<b>5<\/b><span>HIGH<\/span>/);
assert.match(html,/<b>1<\/b><span>LOW<\/span>/);
assert.match(html,/선택한 점수/);
const generic={id:"free",type:"slider",title:"Value",min:0,max:100,settings:{step:5}};
runtime.state.sections[0].questions.push(generic);
assert.match(runtime.answerMarkup(generic,{titleId:"title",describedBy:"error"}),/type="number"[^>]*step="5"/);
""")


def test_builder_scale_preview_preserves_zero_descending_and_slider_selection() -> None:
    _node(r"""
const assert=require("node:assert/strict"),fs=require("node:fs");
global.window=global;global.Common={escapeHtml:value=>String(value??"")};
eval(fs.readFileSync("frontend/js/M02003.js","utf8"));
const page=Pages.M02003;page.localizedQuestionField=(q,key)=>q[key]||"";
const q={type:"scale",min:0,max:10,minLabel:"LOW",maxLabel:"HIGH",settings:{scaleOrder:"descending"}};
let html=page.answerMarkup(q);
assert.deepEqual([...html.matchAll(/<span>(\d+)<\/span>/g)].map(x=>x[1]),["10","9","8","7","6","5","4","3","2","1","0"]);
q.settings.scaleDisplay="slider";html=page.answerMarkup(q);
assert.match(html,/rating-editor-track/);
assert(html.indexOf(">HIGH</span>")<html.indexOf(">LOW</span>"));
""")


def test_audience_selection_and_draft_cache_are_separate_per_target() -> None:
    _node(HARNESS.replace("updateRating};", "updateRating, normalizeSurvey, draftStorageKey, publicSurveyPath};") + r"""
global.location = {search:"?audience=team&lang=ko"};
const {state,normalizeSurvey,draftStorageKey,publicSurveyPath} = runtime;
state.slug = "audience-test";
state.survey = {settings:{defaultAudience:"general",audienceRoutes:[
 {code:"general",sectionIds:["general"]},{code:"team",sectionIds:["profile","team"]}
]}, sections:[
 {id:"general",questions:[{id:"a",type:"short_text"}]},
 {id:"profile",questions:[{id:"b",type:"single"}]},
 {id:"team",questions:[{id:"c",type:"multiple"}]}
]};
normalizeSurvey();
assert.deepEqual(state.questions.map(q=>q.id),["b","c"]);
assert.equal(state.audienceCode,"team");
assert.equal(draftStorageKey(),"surveyone:draft:audience-test:audience:team");
assert.match(publicSurveyPath("en"),/lang=en&audience=team/);
global.location.search = ""; normalizeSurvey();
assert.deepEqual(state.questions.map(q=>q.id),["a"]);
assert.equal(draftStorageKey(),"surveyone:draft:audience-test:audience:general");
global.location.search = "?audience=missing";
assert.throws(normalizeSurvey,/설문 대상/);
global.location.search = "";state.survey.settings = {};normalizeSurvey();
assert.equal(state.questions.length,3);
assert.equal(draftStorageKey(),"surveyone:draft:audience-test");
""")


def test_number_reference_maps_codes_and_validates_without_clickable_legend() -> None:
    _node(HARNESS.replace("updateRating};", "updateRating, codeEntries, codeEntryError};") + r"""
const {state,answerMarkup,codeEntries,codeEntryError} = runtime;
const q = {id:"team",type:"multiple",title:"Select teams",settings:{choiceInput:"codes",maxSelections:5,excludeSelectedFrom:"own"},options:[
 {id:"team-a",code:"1",label:"(1) Alpha"},{id:"team-b",code:"7",label:"(7) Beta"}
]};
const html = answerMarkup(q,{titleId:"title",describedBy:"help error"});
assert.equal([...html.matchAll(/data-code-option=/g)].length,2);
assert.equal([...html.matchAll(/data-choice-code-input/g)].length,5);
assert(!html.includes('type="checkbox"'));
assert(html.includes('inputmode="numeric"'));
assert(html.includes('<span>Alpha</span>'));
const inputs = [{value:"007"},{value:"7"},{value:"999"},{value:"1"},{value:""}];
const entries = codeEntries({querySelectorAll(){return inputs;}},q);
state.answers = {own:"team-a"};
assert.equal(entries[0].option.id,"team-b");
assert.match(codeEntryError(entries[0],entries,q),/중복/);
assert.match(codeEntryError(entries[2],entries,q),/보기에/);
assert.match(codeEntryError(entries[3],entries,q),/선행/);
assert.equal(codeEntryError(entries[4],entries,q),"");
inputs[1].value="";
const clean=codeEntries({querySelectorAll(){return inputs;}},q);
assert.equal(codeEntryError(clean[0],clean,q),"");
""")


def test_choice_columns_fall_back_for_narrow_cards_and_long_labels() -> None:
    _node(r"""
const assert=require("node:assert/strict"),fs=require("node:fs");global.window=global;
eval(fs.readFileSync("frontend/js/choice-layout.js","utf8"));
const {columnsFor,normalize}=SurveyChoiceLayout;
assert.equal(normalize("unknown"),"vertical");
assert.equal(columnsFor("columns_3",1000,260,85),3);
assert.equal(columnsFor("columns_3",760,260,85),1);
assert.equal(columnsFor("columns_2",760,260,85),2);
assert.equal(columnsFor("columns_4",1000,200,85),4);
assert.equal(columnsFor("columns_4",1000,300,85),1);
assert.equal(columnsFor("horizontal",1000,170,85),5);
assert.equal(columnsFor("horizontal",1000,600,85),1);
for(const layout of ["vertical","horizontal","columns_2","columns_3","columns_4"]){
 assert.equal(columnsFor(layout,360,170,85),1);
 assert.equal(columnsFor(layout,1280,170,1),1);
}
assert.equal(columnsFor("vertical",2000,170,85),1);
assert.equal(columnsFor("columns_4",1000,200,2),2);
""")


def test_choice_layout_uses_same_shared_module_without_changing_option_controls() -> None:
    _node(HARNESS + r"""
eval(fs.readFileSync("frontend/js/choice-layout.js","utf8"));
const q={id:"question",type:"multiple",title:"Question",settings:{choiceLayout:"columns_3"},options:[{id:"a",label:"Alpha"},{id:"b",label:"Beta"}]};
const html=runtime.answerMarkup(q,{titleId:"title",describedBy:"error"});
assert(html.includes('data-choice-layout="columns_3"'));
assert.deepEqual([...html.matchAll(/value="([ab])"/g)].map(m=>m[1]),["a","b"]);
assert.equal([...html.matchAll(/type="checkbox"/g)].length,2);
eval(fs.readFileSync("frontend/js/M02003.js","utf8"));
const page=Pages.M02003;page.localizedOptionLabel=(q,o)=>o.label;
assert(page.answerMarkup(q).includes('data-choice-layout="columns_3"'));
q.type="single";assert(runtime.answerMarkup(q,{titleId:"title",describedBy:"error"}).includes('type="radio"'));
q.type="multiple";q.settings.choiceInput="codes";q.settings.maxSelections=2;
q.options[0].code="1";q.options[1].code="2";
assert(!runtime.answerMarkup(q,{titleId:"title",describedBy:"error"}).includes('data-choice-layout='));
""")


def test_publication_dialog_displays_each_audience_and_escapes_labels() -> None:
    _node(HARNESS + r"""
eval(fs.readFileSync("frontend/js/publication-links.js","utf8"));
const links=["evaluation","cooperation","all"].map(code=>({audienceCode:code,label:code,url:`/s/test?audience=${code}`,isDefault:code==="evaluation"}));
links[1].label='<img src=x onerror=alert(1)>';
const html=SurveyPublicationLinks.linksMarkup({links},"https://survey.example.test");
assert.equal([...html.matchAll(/data-publication-link>/g)].length,3);
for(const code of ["evaluation","cooperation","all"])assert(html.includes(`https://survey.example.test/s/test?audience=${code}`));
assert(!html.includes('<img'));
assert(html.includes('&lt;img'));
assert.equal(SurveyPublicationLinks.absoluteUrl('/s/test?audience=all','https://survey.example.test'),'https://survey.example.test/s/test?audience=all');
assert.throws(()=>SurveyPublicationLinks.absoluteUrl('javascript:alert(1)','https://survey.example.test'));
""")


def test_publish_opens_audience_links_only_after_save_and_confirmation_success() -> None:
    _node(r"""
const assert=require("node:assert/strict"),fs=require("node:fs");global.window=global;
eval(fs.readFileSync("frontend/js/M02003.js","utf8"));
(async()=>{
 const page=Object.create(Pages.M02003),events=[],button={},status={},manage={};
 page.root={querySelector(selector){return selector==='[data-builder-publish]'?button:status},querySelectorAll(){return [manage]}};
 page.survey={id:'test',status:'draft',questions:[{type:'single'}]};page.publishing=false;page.destroyed=false;
 page.saveExplicit=async()=>{events.push('save');return true};
 page.context={api:{post:async()=>{events.push('publish');return {version:1,slug:'same-url',publicUrl:'/s/same-url'}}},toast(){}};
 page.openPublicLinks=async()=>{events.push('links');assert.equal(page.survey.publishedVersion,1)};
 await page.publishSurvey();assert.deepEqual(events,['save','publish','links']);assert.equal(manage.hidden,false);assert.equal(button.textContent,'재확정 · 기존 URL 유지');assert.equal(button.disabled,false);
 events.length=0;page.saveExplicit=async()=>false;await page.publishSurvey();assert.deepEqual(events,[]);
})().catch(error=>{console.error(error);process.exit(1)});
""")


def test_slider_stops_match_numeric_positions_in_both_directions_and_step_values() -> None:
    _node(HARNESS + r"""
for (const descending of [false,true]) {
    const q={id:"five",type:"scale",title:"Rating",min:1,max:5,settings:{scaleDisplay:"slider",scaleOrder:descending?"descending":"ascending"}};
    const html=runtime.answerMarkup(q,{titleId:"title",describedBy:"help"});
    const stops=[...html.matchAll(/data-rating-stop="([^"]+)" style="--rating-position:([^%]+)%"/g)].map(x=>[Number(x[1]),Number(x[2])]);
    assert.deepEqual(stops,descending?[[5,0],[4,25],[3,50],[2,75],[1,100]]:[[1,0],[2,25],[3,50],[4,75],[5,100]]);
    assert.match(html,/rating-stops" aria-hidden="true"/);
    assert.match(html,/class="slider-answer is-unanswered"/);
    assert.match(html,/선 위의 동그라미/);
}
const decimal={id:"decimal",type:"slider",title:"Fractional steps",min:0.1,max:0.3,settings:{step:0.1}};
const decimalHtml=runtime.answerMarkup(decimal,{titleId:"title",describedBy:"help"});
assert.deepEqual([...decimalHtml.matchAll(/data-rating-stop="([^"]+)"/g)].map(x=>Number(x[1])),[0.1,0.2,0.3]);
const many={id:"many",type:"slider",title:"Long range",min:0,max:100,settings:{step:5}};
const manyHtml=runtime.answerMarkup(many,{titleId:"title",describedBy:"help"});
const marks=[...manyHtml.matchAll(/data-rating-stop="([^"]+)"/g)].map(x=>Number(x[1]));
assert.equal(marks.length,11);assert.equal(marks[0],0);assert.equal(marks.at(-1),100);
assert(marks.every(value=>value%5===0));
""")


def test_error_navigation_focuses_visible_controls_and_resolves_stable_question_ids() -> None:
    _node(HARNESS.replace("updateRating};", "updateRating,focusQuestion};") + r"""
const events=[];
const control=(name,options={})=>({name,type:"text",disabled:false,closest(){return null;},getClientRects(){return [1];},focus(config){events.push(["focus",name,config]);},...options});
const controls=[control("hidden",{type:"hidden"}),control("disabled",{disabled:true}),control("invisible",{getClientRects(){return [];}}),control("answer")];
const card={dataset:{questionId:"stable-question"},hidden:false,closest(){return {hidden:false};},querySelectorAll(selector){return selector==="[data-matrix-row-id]"?[]:controls;},scrollIntoView(config){events.push(["scroll",config]);}};
assert.equal(runtime.focusQuestion(card),true);
assert.deepEqual(events,[["focus","answer",{preventScroll:true}],["scroll",{behavior:"instant",block:"start"}]]);
let removed=0,prevented=0;
runtime.dom.list={querySelectorAll(){return [card];}};
runtime.dom.toastStack={querySelectorAll(){return [{remove(){removed++;}}];}};
runtime.onClick({preventDefault(){prevented++;},target:{closest(selector){return selector==="[data-public-error-jump]"?{dataset:{publicErrorJump:"stable-question"}}:null;}}});
assert.equal(prevented,1);assert.equal(removed,1);assert.equal(events.length,4);
card.hidden=true;
assert.equal(runtime.focusQuestion(card),false);assert.equal(events.length,4);
""")


def test_error_navigation_focuses_first_unanswered_matrix_row() -> None:
    _node(HARNESS.replace("updateRating};", "updateRating,focusQuestion};") + r"""
let focused;
const control=name=>({type:"radio",disabled:false,closest(){return null;},getClientRects(){return [1];},focus(){focused=name;}});
const answered=control("answered"),missing=control("missing");
const rows=[{querySelector(selector){return selector==="input:checked"?answered:answered;},contains(item){return item===answered;}},{querySelector(selector){return selector==="input:checked"?null:missing;},contains(item){return item===missing;}}];
const card={hidden:false,closest(){return {hidden:false};},querySelectorAll(selector){return selector==="[data-matrix-row-id]"?rows:[answered,missing];},scrollIntoView(){}};
assert.equal(runtime.focusQuestion(card),true);assert.equal(focused,"missing");
""")


def test_continuous_numbers_skip_profile_and_notice_blocks_and_replace_source_prefixes() -> None:
    _node(HARNESS.replace("updateRating};", "updateRating,questionMarkup,displayQuestionLabel};") + r"""
const make=(id,title,extra={})=>({id,title,type:"short_text",settings:{},...extra});
const profile=make("grade","직급 확인",{settings:{excludeFromNumbering:true}});
const performance=Array.from({length:24},(_,i)=>make("performance_"+(i+1),(i+1)+". 평가 문항"));
const pay=Array.from({length:17},(_,i)=>make("pay_"+(i+1),(i+1)+". 보수 문항"));
const department=make("department","소속 확인",{settings:{excludeFromNumbering:true}});
const cooperation=[make("coop1","1. 우수 부서"),make("coop2","2. 미흡 부서")];
const sections=[{id:"cover",questions:[{id:"notice",type:"notice"},profile]},{id:"evaluation",questions:performance},{id:"pay",questions:pay},{id:"cooperation",questions:[department,...cooperation]}];
runtime.state.survey={settings:{showQuestionNumbers:true}};runtime.state.sections=sections;runtime.state.questions=sections.flatMap(s=>s.questions);
runtime.state.questionNumbers=SurveyQuestionNumbering.numbers(sections);
assert.equal(runtime.state.questionNumbers.get("performance_24"),24);
assert.equal(runtime.state.questionNumbers.get("pay_1"),25);
assert.equal(runtime.state.questionNumbers.get("pay_17"),41);
assert.equal(runtime.state.questionNumbers.get("coop1"),42);
assert.equal(runtime.state.questionNumbers.get("coop2"),43);
assert.equal(runtime.state.questionNumbers.get("grade"),null);
const html=runtime.questionMarkup(pay[0],25);
assert.match(html,/data-question-number="25"/);assert.match(html,/>25\. 보수 문항 /);assert(!html.includes("25. 1."));
assert.equal(runtime.displayQuestionLabel({dataset:{questionId:"pay_1",questionNumber:"25"}}),"25번 보수 문항");
assert.equal(runtime.displayQuestionLabel({dataset:{questionId:"grade",questionNumber:""}}),"직급 확인");
assert.equal(pay[0].title,"1. 보수 문항");
const cooperationOnly=SurveyQuestionNumbering.numbers([sections[3]]);
assert.equal(cooperationOnly.get("coop1"),1);assert.equal(cooperationOnly.get("coop2"),2);
const q=make("text","1. 원문");
assert.equal(SurveyQuestionNumbering.title(q,{showQuestionNumbers:false},q.title),"1. 원문");
for(const title of ["2026. 계획","1.5배 인상","제1항 내용"]){assert.equal(SurveyQuestionNumbering.title(q,{},title),title);}
assert.equal(SurveyQuestionNumbering.title(q,{},"(24) 문항"),"문항");
""")
