import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentLabel } from './agent-title.js';

const home = '/home/nicbat';
const program = { name: 'Codex', key: 'codex' };
const a = { address: 't3', pane: 'p3', tab: 'tab', title: '⠹ Clarify worktree setup | rubiks-site', app: 'codex', program };
const b = { address: 't8', pane: 'p8', tab: 'tab', title: '⠙ Review PR #21 | review-checkout', app: 'codex', program };
const panes = [a, b].map(x => ({ pane: x.pane, terminal: x.address, tab: x.tab, title: x.title }));

test('split agents keep distinct titles when focus and the shared tab title change', () => {
  for (const name of ['Clarify worktree setup', 'Review PR #21']) {
    const tab = { name };
    for (const focused of ['p3', 'p8']) {
      const layout = panes.map(p => ({ ...p, focused: p.pane === focused }));
      assert.equal(agentLabel(a, tab, layout, home), 'Clarify worktree setup');
      assert.equal(agentLabel(b, tab, layout, home), 'Review PR #21');
    }
  }
});

test('single-pane custom tab names remain intact; a shell split uses the agent title', () => {
  const tab = { name: 'My project task' };
  assert.equal(agentLabel(a, tab, [panes[0]], home), 'My project task');
  assert.equal(agentLabel(a, tab, [panes[0], { terminal: 'shell', tab: 'tab' }], home), 'Clarify worktree setup');
});

test('missing titles identify the individual agent and never borrow another pane title', () => {
  assert.equal(agentLabel({ ...a, title: '' }, { name: 'Other task' }, panes.map(p => ({ ...p, title: '' })), home), 'Codex · t3');
});

test('status decoration is removed while pipes within task names are retained', () => {
  assert.equal(agentLabel({ ...a, title: '✳ Action Required | Fix | pipe parsing | repo' }, {}, panes, home), 'Fix | pipe parsing');
});
