"""Question insertion preserves stable records and the shared display numbering contract."""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from backend.models import SurveyUpdateRequest

ROOT = Path(__file__).resolve().parents[1]
HARNESS = r"""
const assert = require("node:assert/strict");
const fs = require("node:fs");
global.window = global;
global.matchMedia = () => ({matches:false});
for (const file of ["frontend/config/app.config.js", "frontend/js/question-numbering.js", "frontend/js/M02003.js"]) eval(fs.readFileSync(file,"utf8"));
const q = (id,title,type="short_text",settings={}) => ({id,title,type,settings});
function editor() {
 const page=Object.assign({}, Pages.M02003);
 page.survey={title:"Synthetic",revision:7,sections:[
  {id:"sec1",title:"First",questions:[q("notice","Notice","notice"),q("q1","1. First"),q("q2","7. Second")]},
  {id:"sec2",title:"Second",questions:[q("q3","(99) Third"),q("excluded","Exempt","short_text",{excludeFromNumbering:true})]},
  {id:"empty-last",title:"Empty last section",questions:[]}
 ],settings:{showQuestionNumbers:true},translations:{en:{questionTitles:{q1:"First translation"}}}};
 page.activeId="q1";page.activeSectionId="sec1";page.insertionMode="after";
 page.localizedQuestionField=(q,field)=>q[field];
 page.setLocalizedQuestionField=(q,field,value)=>{q[field]=value;};
 page.context={toast(){},api:{put(){throw Error("Insertion must not save");}}};
 page.setMode=page.openProperties=page.closeProperties=page.revealSelection=()=>{};
 page.renderQuestions=()=>page.survey.questions.forEach(q=>page.syncQuestionCompatibility(q));
 page.markDirty=()=>{page.dirty=true;};
 page.refreshQuestions();page.renderQuestions();return page;
}
"""


def run_node(source: str) -> str:
    node = shutil.which("node")
    if not node:
        pytest.skip("Node is an optional development tool")
    result = subprocess.run([node, "-e", HARNESS + source], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    assert result.returncode == 0, result.stdout + result.stderr
    return result.stdout


@pytest.mark.parametrize("mode", ["before", "after", "section-end", "survey-end"])
def test_each_question_type_inserts_at_the_requested_position_with_valid_api_payload(mode):
    output = run_node("const mode=" + json.dumps(mode) + r""";
const payloads=[];
for(const {code:type} of SURVEYONE_CONFIG.questionTypes) {
 const page=editor();
 const original=structuredClone(page.survey.questions), translations=structuredClone(page.survey.translations);
 const snapshot=structuredClone(page.survey), immutable=JSON.stringify(snapshot);
 page.addQuestion(type,{mode,questionId:"q1",sectionId:"sec1"});
 const added=page.question(page.activeId);
 assert.equal(added.type,type);assert.equal(page.dirty,true);
 const expectedSection=mode==="survey-end"?"empty-last":"sec1";
 const expectedIndex=({before:1,after:2,"section-end":3,"survey-end":0})[mode];
 assert.equal(page.activeSectionId,expectedSection);
 assert.equal(page.section(expectedSection).questions[expectedIndex].id,added.id);
 assert.equal(page.addedQuestionId,added.id);
 assert.equal(new Set(page.survey.questions.map(q=>q.id)).size,original.length+1);
 for(const q of original) assert.deepEqual(page.question(q.id),q);
 assert.deepEqual(page.survey.translations,translations);
 assert.equal(JSON.stringify(snapshot),immutable);
 const counts=SurveyQuestionNumbering.numbers(page.survey.sections);
 const increment=type==="notice"?0:1;
 assert.equal(counts.get("q1"),1+(mode==="before"?increment:0));
 assert.equal(counts.get("q2"),2+(["before","after"].includes(mode)?increment:0));
 assert.equal(counts.get("q3"),3+(mode!=="survey-end"?increment:0));
 assert.equal(counts.get("notice"),null);assert.equal(counts.get("excluded"),null);
 // Number rendering never rewrites stored titles, IDs or the snapshot.
 assert.equal(page.displayQuestionTitle(page.question("q2")),"Second");
 payloads.push({sections:page.survey.sections,settings:page.survey.settings,translations:page.survey.translations});
}
console.log(JSON.stringify(payloads));
""")
    payloads = json.loads(output)
    assert len(payloads) == 14
    for payload in payloads:
        SurveyUpdateRequest.model_validate(payload)


def test_palette_placement_uses_selection_and_explicit_anchor_survives_focus_changes():
    run_node(r"""
const page=editor();
page.insertionMode="before";
page.addQuestion("number");
assert.deepEqual(page.section("sec1").questions.map(q=>q.id),["notice",page.activeId,"q1","q2"]);
const fixed={mode:"after",questionId:"q2",sectionId:"sec1"};
page.activeId="q3";page.activeSectionId="sec2";
page.addQuestion("date",fixed);
assert.equal(page.questionLocation(page.activeId).questionIndex,4);
assert.equal(page.activeSectionId,"sec1");
// When only a section is selected, the palette appends to that section.
page.activeId=null;page.activeSectionId="sec2";page.insertionMode="section-end";
page.addQuestion("notice");
assert.equal(page.section("sec2").questions.at(-1).id,page.activeId);
assert.equal(page.section("empty-last").questions.length,0);
""")


def test_stale_explicit_question_or_section_anchor_never_silently_appends():
    run_node(r"""
for(const placement of [{mode:"before",questionId:"gone"},{mode:"after",questionId:"gone"},{mode:"section-end",sectionId:"gone"},{mode:"invalid"}]) {
 const page=editor(),before=JSON.stringify(page.survey);
 page.addQuestion("single",placement);
 assert.equal(JSON.stringify(page.survey),before);assert.equal(page.dirty,undefined);
}
""")


def test_display_title_edits_preserve_original_prefix_and_auto_number_off_setting():
    run_node(r"""
const page=editor(),first=page.question("q1"),third=page.question("q3");
assert.equal(page.displayQuestionTitle(first),"First");
page.setDisplayedQuestionTitle(first,"Updated first");
assert.equal(first.title,"1. Updated first");
page.setDisplayedQuestionTitle(third,"Updated third");
assert.equal(third.title,"(99) Updated third");
page.setDisplayedQuestionTitle(first,"12. Explicit number");
assert.equal(first.title,"12. Explicit number");
page.survey.settings.showQuestionNumbers=false;
assert.equal(page.displayQuestionTitle(first),"12. Explicit number");
page.setDisplayedQuestionTitle(first,"Unnumbered title");
assert.equal(first.title,"Unnumbered title");
assert.equal(page.displayQuestionTitle(q("year","2026. Annual survey")),"2026. Annual survey");
""")
