"""Runtime regression coverage for preferences and custom report data safety."""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def run_node(script: str) -> None:
    node = shutil.which("node")
    if not node:
        pytest.skip("Node is an optional development tool")
    result = subprocess.run([node, "-e", script], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    assert result.returncode == 0, result.stderr


def test_preferences_are_validated_restored_and_not_applied_on_storage_failure():
    run_node(r"""
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let stored = '{"density":"compact","motion":"reduced","startPage":"M02001"}';
const host = { window: {}, document: { documentElement: { dataset: {} } }, localStorage: {
  getItem() { return stored; }, setItem(key, value) { stored = value; }
}};
vm.createContext(host);
vm.runInContext(fs.readFileSync('frontend/js/common.js', 'utf8'), host);
const prefs = host.window.Common.preferences;
prefs.apply(prefs.read());
assert.equal(host.document.documentElement.dataset.uiDensity, 'compact');
assert.equal(prefs.read().startPage, 'M02001');
prefs.save({ density: 'invalid', motion: 'other', startPage: 'M07002' });
assert.equal(prefs.read().density, 'comfortable');
assert.equal(prefs.read().startPage, 'M01001');
stored = 'invalid json';
assert.equal(prefs.read().motion, 'system');
host.localStorage.setItem = () => { throw Error('storage blocked'); };
assert.throws(() => prefs.save({ density: 'compact', motion: 'reduced' }));
assert.equal(host.document.documentElement.dataset.uiDensity, 'comfortable');
host.localStorage.getItem = () => { throw Error('storage blocked'); };
assert.equal(prefs.read().startPage, 'M01001');
""")


REPORT_HARNESS = r"""
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const host = { window: { localStorage: {} }, console, Intl };
vm.createContext(host);
const source = fs.readFileSync('frontend/js/M05002.js', 'utf8').replace(
  '    window.Pages = window.Pages || {};',
  '    window.audit = { state, normalizeChoices, deriveKpis, saveDraft, deleteDraft };\n    window.Pages = window.Pages || {};'
);
vm.runInContext(source, host);
const { state, normalizeChoices, deriveKpis, saveDraft, deleteDraft } = host.window.audit;
"""


def test_report_small_percentages_are_not_scaled_twice():
    run_node(REPORT_HARNESS + r"""
let result = normalizeChoices({ distribution: { rare: 1, other: 199 } }, 200);
assert.equal(result[0].percent, 0.5);
assert.equal(result[1].percent, 99.5);
assert.equal(normalizeChoices({ distribution: { rare: 1 } }, 100)[0].percent, 1);
assert.equal(normalizeChoices({ options: [{ label: 'x', percent: 0.5 }] }, 200)[0].percent, 0.5);
assert.equal(normalizeChoices({ options: [{ label: 'x', rate: 0.005 }] }, 200)[0].percent, 0.5);
assert.equal(normalizeChoices({ distribution: { empty: 0 } }, 0)[0].percent, 0);
assert.equal(deriveKpis({ totalResponses: 1 })[3].value, '집계 없음');
""")


def test_failed_report_save_and_delete_preserve_previous_drafts():
    run_node(REPORT_HARNESS + r"""
state.drafts = [{ id: 'draft1', name: 'original', items: [] }];
state.activeDraftId = 'draft1';
state.templateName = 'edited';
state.items = [{ id: 'w1', type: 'questions', span: 6 }];
state.dirty = true;
state.toast = () => {};
state.confirmMessage = async () => true;
state.elements = { templateName: { value: 'edited' }, status: { textContent: '', classList: { toggle() {} } } };
host.window.localStorage.setItem = () => { throw Error('storage blocked'); };
saveDraft();
assert.equal(state.drafts[0].name, 'original');
assert.equal(state.dirty, true);
(async () => {
  await deleteDraft();
  assert.equal(state.drafts.length, 1);
  assert.equal(state.drafts[0].id, 'draft1');
  assert.equal(state.dirty, true);
})().catch(error => { console.error(error); process.exitCode = 1; });
""")


def test_public_font_switch_resets_previous_serif_font():
    run_node(r"""
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('frontend/js/public.js', 'utf8');
const body = source.slice(source.indexOf('    function applySkin()'), source.indexOf('    function splitSelectorList'));
const properties = {};
const host = {
 state: { survey: { skin: { font: 'serif' } } },
 window: { SURVEYONE_CONFIG: { skinPresets: [] } },
 document: { documentElement: { style: { setProperty(key, value) { properties[key] = value; } } },
   body: { classList: { toggle() {} } },
   querySelector() { return { classList: { toggle() {}, add() {} }, style: {} }; }
 },
 safeAssetUrl() { return ''; }
};
vm.createContext(host);
vm.runInContext(body, host);
host.applySkin(); assert.match(properties['--survey-font'], /Batang/);
host.state.survey.skin.font = 'system'; host.applySkin();
assert.doesNotMatch(properties['--survey-font'], /Batang/);
host.state.survey.skin.font = 'rounded'; host.applySkin();
assert.match(properties['--survey-font'], /Arial Rounded/);
""")
