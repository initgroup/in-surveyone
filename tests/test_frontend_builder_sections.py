"""Section removal must produce a valid draft without breaking stable references."""
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
eval(fs.readFileSync("frontend/js/M02003.js", "utf8"));
const q = (id) => ({ id, type: "short_text", title: id, settings: {} });
function editor() {
    const instance = Object.assign({}, Pages.M02003);
    instance.survey = { sections: [{ id: "keep", title: "Keep", questions: [q("q1")] }, { id: "remove", title: "Remove", questions: [q("q2"), q("q3")] }],
        settings: { audienceRoutes: [{ code: "all", label: "All", sectionIds: ["keep", "remove"] }], defaultAudience: "all" },
        translations: { en: { sections: { keep: { title: "Keep title", questions: { q1: { title: "Keep question" } } }, remove: { title: "Remove title", questions: { q2: { title: "Remove question" } } } },
            sectionTitles: { keep: "Keep flat", remove: "Remove flat" }, section_descriptions: { remove: "Remove description" },
            questionTitles: { q1: "Keep flat question", q2: "Remove flat question" }, option_labels: { q2: {} } } },
        logicRules: [{ id: "keep-rule", sourceQuestionId: "q1", destination: "next" }, { id: "outgoing", questionId: "q2", destination: "complete" }, { id: "incoming", sourceQuestionId: "q1", destinationSectionId: "remove" }]
    };
    instance.activeSectionId = "remove";
    instance.activeId = "q2";
    instance.localizedQuestionField = (question, field) => question[field];
    instance.context = { toast() {} };
    instance.selectSection = (id) => { instance.activeId = null; instance.activeSectionId = id; };
    instance.renderQuestions = instance.renderRules = instance.renderAudienceSummary = () => {};
    instance.markDirty = () => { instance.saved = true; };
    instance.refreshQuestions();
    return instance;
}
"""


def run_node(source: str) -> str:
    node = shutil.which("node")
    if not node:
        pytest.skip("Node is an optional development tool")
    result = subprocess.run([node, "-e", HARNESS + source], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    assert result.returncode == 0, result.stdout + result.stderr
    return result.stdout


def test_section_removal_prunes_translations_routes_and_rules_into_valid_draft():
    output = run_node(r"""
const page = editor();
// References wholly inside the removed section may be deleted together.
page.survey.sections[1].questions[1].settings.excludeSelectedFrom = "q2";
const published = structuredClone(page.survey);
const before = JSON.stringify(published);
const plan = page.sectionRemovalPlan("remove");
assert.equal(plan.ruleCount, 2);
assert.equal(plan.routeCount, 1);
assert.equal(page.removeSection("remove"), true);
assert.equal(page.saved, true);
assert.deepEqual(page.survey.sections.map(section => section.id), ["keep"]);
assert.deepEqual(page.survey.questions.map(question => question.id), ["q1"]);
assert.deepEqual(page.survey.logicRules.map(rule => rule.id), ["keep-rule"]);
assert.deepEqual(page.survey.settings.audienceRoutes[0].sectionIds, ["keep"]);
assert.equal(page.activeSectionId, "keep");
assert.equal(page.activeId, null);
assert.equal(page.survey.translations.en.sections.keep.questions.q1.title, "Keep question");
assert.equal(page.survey.translations.en.questionTitles.q1, "Keep flat question");
assert.equal(JSON.stringify(page.survey.translations).includes("Remove"), false);
assert.equal(JSON.stringify(published), before);
// The API schema checks all nested and flat translation IDs plus audience references.
console.log(JSON.stringify({ sections: page.survey.sections, settings: page.survey.settings, translations: page.survey.translations, logicRules: page.survey.logicRules }));
""")
    validated = SurveyUpdateRequest.model_validate(json.loads(output))
    assert [section.id for section in validated.sections] == ["keep"]


@pytest.mark.parametrize("dependency", ["condition", "choice-exclusion", "audience", "last-section"])
def test_section_removal_rejects_invalid_dependents_without_mutation(dependency):
    run_node("const dependency = " + json.dumps(dependency) + r""";
const page = editor();
if (dependency === "condition") page.survey.sections[1].questions[0].activationCondition = { conditions: [{ sourceQuestionId: "q1", operator: "exists" }] };
if (dependency === "choice-exclusion") page.survey.sections[1].questions[0].settings.excludeSelectedFrom = "q1";
if (dependency === "audience") page.survey.settings.audienceRoutes[0].sectionIds = ["keep"];
if (dependency === "last-section") page.survey.sections.splice(1, 1);
page.refreshQuestions();
const before = JSON.stringify(page.survey);
assert.ok(page.sectionRemovalPlan("keep").blocked);
assert.equal(page.removeSection("keep"), false);
assert.equal(JSON.stringify(page.survey), before);
assert.equal(page.saved, undefined);
""")
