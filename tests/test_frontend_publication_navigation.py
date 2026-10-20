from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def run_node(body: str) -> None:
    node = shutil.which("node")
    if not node:
        pytest.skip("Node is unavailable")
    source = r"""
const assert = require("node:assert/strict");
const fs = require("node:fs");
global.window = global;
global.location = {origin:"https://survey.example"};
global.localStorage = {getItem(){return null;}};
global.Common = {
    escapeHtml(value){return String(value ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");},
    formatNumber(value){return String(value);}, formatDate(){return "2026-10-20";}
};
eval(fs.readFileSync("frontend/js/M02001.js", "utf8"));
eval(fs.readFileSync("frontend/js/M03001.js", "utf8"));
""" + "\n(async()=>{\n" + body + "\n})().catch(error=>{console.error(error);process.exitCode=1;});"
    result = subprocess.run([node, "-e", source], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    assert result.returncode == 0, result.stdout + result.stderr


def test_project_card_and_publish_use_the_same_audience_url_manager() -> None:
    run_node(r"""
const page=Object.create(Pages.M02001);
const item={id:"survey-a",title:"URL test",status:"published",slug:"old",publicUrl:"/s/old"};
const other={id:"survey-b",title:"Other",status:"published",slug:"other",publicUrl:"/s/other"};
page.items=[item,other]; page.root={};
let renders=0, opened;
page.render=()=>renders++;
page.context={isCurrentRoute:()=>true, toast(){throw new Error("Unexpected error toast");}};
window.SurveyPublicationLinks={async open(options){opened=options;}};
const html=page.cardMarkup(item);
assert.match(html,/data-project-public-links="survey-a"/);
assert.match(html,/data-copy-public-url="survey-a"/);
assert(!page.cardMarkup({...item,status:"draft"}).includes("data-project-public-links"));
await page.openPublicLinks(item.id);
assert.equal(opened.surveyId,item.id);
opened.onRegenerate({slug:"new",publicUrl:"/s/new"});
assert.equal(item.publicUrl,"/s/new"); assert.equal(item.slug,"new");
assert.equal(other.publicUrl,"/s/other"); assert.equal(renders,1);
page.root=null;
opened.onRegenerate({slug:"late",publicUrl:"/s/late"});
assert.equal(item.publicUrl,"/s/new");
const calls=[];
page.page=2;
page.context={api:{async post(url,body){calls.push(["publish",url,body]);}},toast(message,tone){assert.equal(tone,"success");}};
page.loadPage=async number=>calls.push(["load",number]);
page.openPublicLinks=async id=>calls.push(["links",id]);
await page.publish("survey-a");
assert.deepEqual(calls,[["publish","/api/surveys/survey-a/publish",{}],["load",2],["links","survey-a"]]);
""")


def test_project_url_deep_link_does_not_require_item_on_current_list_page() -> None:
    run_node(r"""
const page=Object.create(Pages.M02001),calls=[];
window.SurveyOneApp={queryParams:()=>new URLSearchParams("urlId=survey-off-page")};
page.bind=()=>{}; page.load=async()=>calls.push("load");
page.openPublicLinks=async id=>calls.push(id);
await page.init({root:{},user:{role:"member"}});
assert.deepEqual(calls,["load","survey-off-page"]);
""")


def test_distribution_url_shortcut_navigates_and_respects_unsaved_changes() -> None:
    run_node(r"""
const page=Object.create(Pages.M03001),calls=[];
const draft={messagesByLanguage:{ko:{emailBody:"Keep draft"}},revision:2};
page.draft=draft;page.dirty=false;
page.context={api:{post(){throw new Error("URL mutation belongs to project");}},navigate(route,params){calls.push([route,params]);},confirmMessage(){throw new Error("Unexpected confirmation");}};
await page.openProjectUrls("survey-a");
assert.deepEqual(calls,[["M02001",{urlId:"survey-a"}]]);
page.dirty=true;let confirmed=0;
page.context.confirmMessage=async()=>{confirmed++;return false;};
await page.openProjectUrls("survey-a");
assert.equal(calls.length,1);assert.equal(page.dirty,true);assert.equal(page.draft,draft);
page.context.confirmMessage=async()=>{confirmed++;return true;};
await page.openProjectUrls("survey-a");
assert.equal(calls.length,2);assert.equal(confirmed,2);assert.equal(draft.messagesByLanguage.ko.emailBody,"Keep draft");
assert(!fs.readFileSync("frontend/js/M03001.js","utf8").includes("/public-url/regenerate"));
""")
