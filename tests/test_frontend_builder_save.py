"""Manual save must never capture edits made after the save click or save on teardown."""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
HARNESS = r"""
const assert=require("node:assert/strict"),fs=require("node:fs");
global.window=global;
eval(fs.readFileSync("frontend/js/M02003.js","utf8"));
function editor() {
    const page=Object.create(Pages.M02003);
    page.survey={id:"survey",revision:7,title:"Saved",sections:[],languages:{sourceLocale:"ko",defaultLocale:"ko",enabled:["ko"]}};
    page.savedDraft=page.draftSnapshot();
    page.dirty=false;page.destroyed=false;page.savingExplicit=false;page.savePromise=null;
    page.context={toast(){},api:{put(){throw Error("Unexpected write");}}};
    page.updateSaveControls=()=>{};
    page.setSaveLabel=message=>{page.saveLabel=message;};
    page.savePayload=()=>({...page.draftSnapshot(),expectedRevision:page.survey.revision});
    return page;
}
"""


def run_node(script):
    node = shutil.which("node")
    if not node:
        pytest.skip("Node is an optional development tool")
    result = subprocess.run([node, "-e", HARNESS + script], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    assert result.returncode == 0, result.stdout + result.stderr


def test_dirty_mark_and_teardown_never_schedule_or_write():
    run_node(r"""
(async()=>{
 const page=editor();
 global.setTimeout=()=>{throw Error("Background save timer must not be scheduled");};
 page.survey.title="Pending";page.markDirty();
 assert.equal(page.dirty,true);assert.equal(page.saveLabel,"저장 안 됨");
 global.document={removeEventListener(){}};global.removeEventListener=()=>{};
 page.root={removeEventListener(){}};
 await page.destroy();
 assert.equal(page.destroyed,true);
})().catch(error=>{console.error(error);process.exit(1)});
""")


def test_save_checkpoint_uses_the_click_time_payload_and_later_edits_remain_pending():
    run_node(r"""
(async()=>{
 const page=editor();let complete;const calls=[];
 page.context.api.put=(url,payload)=>{calls.push(structuredClone(payload));return new Promise(resolve=>{complete=resolve;});};
 page.survey.title="At click";page.markDirty();
 const saving=page.saveExplicit({notify:false});
 assert.equal(calls.length,1);assert.equal(calls[0].title,"At click");
 page.survey.title="Typed during save";page.markDirty();
 complete({survey:{...calls[0],revision:8,updatedAt:"2026-10-22T00:00:00Z"}});
 assert.equal(await saving,false);
 assert.equal(calls.length,1);
 assert.equal(page.survey.title,"Typed during save");
 assert.equal(page.survey.revision,8);
 assert.equal(page.savedDraft.title,"At click");
 assert.equal(page.dirty,true);assert.equal(page.saveLabel,"저장 안 됨");
})().catch(error=>{console.error(error);process.exit(1)});
""")


@pytest.mark.parametrize("failure", ["revision conflict", "network unavailable"])
def test_failed_save_keeps_last_saved_checkpoint_and_pending_edit(failure):
    run_node(r"""
(async()=>{
 const page=editor();const checkpoint=JSON.stringify(page.savedDraft);
 page.context.api.put=async()=>{throw Error(""" + repr(failure) + r""");};
 page.survey.title="Pending";page.markDirty();
 assert.equal(await page.saveExplicit({notify:false}),false);
 assert.equal(JSON.stringify(page.savedDraft),checkpoint);
 assert.equal(page.survey.title,"Pending");assert.equal(page.dirty,true);
 assert.equal(page.saveLabel,"저장 실패");assert.equal(page.savingExplicit,false);
})().catch(error=>{console.error(error);process.exit(1)});
""")
