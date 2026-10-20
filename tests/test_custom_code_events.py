"""Exercise the sandbox bootstrap rather than matching implementation strings."""
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def test_custom_event_bridge_accepts_only_parent_and_preserves_read_only_context():
    node = shutil.which("node")
    if not node:
        pytest.skip("Node is an optional development tool")
    script = r"""
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const host = { window: {}, location: { origin: 'http://localhost:8300' }, TextEncoder };
vm.createContext(host);
vm.runInContext(fs.readFileSync('frontend/js/code-editor.js', 'utf8'), host);
const editor = host.window.SurveyCodeEditor;
const html = editor.sandboxDocument({ html: '<p>Example</p>', javascript: '' });
const bootstrap = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const listeners = {};
const parent = { postMessage() {} };
const output = { hidden: true, textContent: '' };
const frame = {
  window: {}, parent, structuredClone,
  addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
  document: { querySelector() { return output; }, documentElement: { scrollHeight: 100 } },
  ResizeObserver: class { observe() {} }
};
vm.createContext(frame);
vm.runInContext(bootstrap, frame);
const api = frame.window.SurveyOne;
const received = [];
const unsubscribe = api.on('load', data => received.push(data));
function dispatch(source, origin, type = 'load') {
  for (const fn of listeners.message) fn({ source, origin,
    data: { type: 'surveyone-lifecycle', event: type, detail: { survey: { title: 'Example' } } } });
}
dispatch({}, 'http://localhost:8300');
dispatch(parent, 'https://untrusted.example');
dispatch(parent, 'http://localhost:8300', 'unsupported');
assert.equal(received.length, 0);
dispatch(parent, 'http://localhost:8300');
assert.equal(received.length, 1);
assert.ok(Object.isFrozen(api.getContext()));
assert.ok(Object.isFrozen(api.getContext().survey));
assert.equal(api.getContext().survey.title, 'Example');
unsubscribe();
dispatch(parent, 'http://localhost:8300');
assert.equal(received.length, 1);
assert.throws(() => api.on('submitOverride', () => {}));
api.on('pageChange', () => { throw Error('sample failure'); });
dispatch(parent, 'http://localhost:8300', 'pageChange');
assert.equal(output.hidden, false);
assert.match(output.textContent, /sample failure/);
const messages = [];
const target = { contentWindow: { postMessage(message) { messages.push(message); } } };
editor.sendEvent(target, 'answerChange', { questionId: 'q1', answer: 'a1' });
editor.sendEvent(target, 'submitOverride', {});
assert.equal(messages.length, 1);
assert.equal(messages[0].event, 'answerChange');
assert.equal(messages[0].detail.questionId, 'q1');
"""
    result = subprocess.run([node, "-e", script], cwd=ROOT, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
