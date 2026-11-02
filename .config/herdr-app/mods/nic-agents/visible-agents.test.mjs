import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleAgents, legacyAttachment } from './visible-agents.js';

const spaces = [
  { id: 'space-a', name: 'A', tabs: [{ id: 'tab-a', index: 1, name: 'First task' }] },
  { id: 'space-b', name: 'B', tabs: [{ id: 'tab-b', index: 1, name: 'Second task' }] },
];
const pane = (address, tab = 'tab-a') => ({ pane: `pane-${address}`, terminal: address,
  tab, title: 'A task title', focused: address === 't1', program: { name: 'declawd', agent: false } });
const wrapped = (address, flag = '--codex') => ({ address, state: 'live', argv: ['/bin/zsh', '-l'],
  foreground: { name: 'declawd', argv: ['/Applications/declawd.app/Contents/MacOS/declawd', flag] } });

test('shell-hosted declawd sessions are visible in space order without inventing status', () => {
  const rows = visibleAgents([], spaces, [pane('t2', 'tab-b'), pane('t1')], [wrapped('t2'), wrapped('t1')]);
  assert.deepEqual(rows.map(r => [r.address, r.space, r.status, r.program.name]),
    [['t1', 'space-a', 'unknown', 'Codex'], ['t2', 'space-b', 'unknown', 'Codex']]);
  assert.equal(rows[0].focused, true);
  assert.equal(rows[0].app, null);
});

test('native reports replace the unknown row without duplication or altered state', () => {
  const native = { address: 't1', status: 'blocked', app: 'codex', seq: 5 };
  const rows = visibleAgents([native], spaces, [pane('t1')], [wrapped('t1')]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0], native);
  assert.deepEqual(visibleAgents([native], [], [], []), [native]);
});

test('normal shells, exited sessions and hidden background work do not become agent rows', () => {
  const shell = { ...wrapped('t1'), title: 'Codex task', foreground: { name: 'zsh', argv: ['zsh'] } };
  assert.deepEqual(visibleAgents([], spaces, [pane('t1')], [shell]), []);
  assert.deepEqual(visibleAgents([], spaces, [pane('t1')], [{ ...wrapped('t1'), state: 'finished' }]), []);
  assert.deepEqual(visibleAgents([], spaces, [], [wrapped('hidden')]), []);
});

test('declawd harness flags and native program identities choose the right agent', () => {
  const panes = [pane('t1'), pane('t2'), pane('t3'), { ...pane('t4'), program: { agent: true, name: 'Custom agent' } }];
  const rows = visibleAgents([], spaces, panes,
    [wrapped('t1'), wrapped('t2', '--pi'), wrapped('t3', '--model'),
      { address: 't4', state: 'live', foreground: { name: 'custom' } }]);
  assert.deepEqual(rows.map(r => r.program.name), ['Codex', 'Pi', 'Claude Code', 'Custom agent']);
  assert.equal(rows[0].program.icon, 'icons/codex.svg');
  assert.equal(rows[0].program.tint, false);
  assert.equal(rows[1].program.tint, true);
  assert.equal(rows[2].program.tint, false);
});

test('labeled live agent attachments retain their source title and unknown status', () => {
  const terminal = { address: 't1', state: 'live',
    foreground: { name: 'herdr', argv: ['herdr', '--session', 'default', 'agent', 'attach', 'w1:p1'] },
    labels: { 'herdr.legacy.agent': 'claude', 'herdr.legacy.pane': 'w1:p1', 'herdr.legacy.title': 'Existing task' } };
  const rows = visibleAgents([], spaces, [pane('t1')], [terminal]);
  assert.equal(rows[0].program.name, 'Claude Code');
  assert.equal(rows[0].title, 'Existing task');
  assert.equal(rows[0].status, 'unknown');
  const native = { address: 't1', status: 'working', app: 'claude' };
  assert.equal(visibleAgents([native], spaces, [pane('t1')], [terminal])[0], native);
});

test('shells, ordinary Herdr clients and editor attachments ignore stale migration labels', () => {
  const terminal = { address: 't1', state: 'live',
    labels: { 'herdr.legacy.agent': 'codex', 'herdr.legacy.pane': 'w1:p1' } };
  for (const foreground of [
    { name: 'zsh', argv: ['zsh'] },
    { name: 'herdr', argv: ['herdr', '--session', 'default'] },
    { name: 'herdr', argv: ['herdr', 'terminal', 'attach', 'term_1'] },
    { name: 'herdr', argv: ['herdr', 'agent', 'attach', 'w1:p2'] },
  ]) assert.deepEqual(visibleAgents([], spaces, [pane('t1')], [{ ...terminal, foreground }]), []);
  assert.deepEqual(visibleAgents([], spaces, [pane('t1')], [{ ...terminal, labels: {},
    foreground: { name: 'herdr', argv: ['herdr', 'agent', 'attach', 'w1:p1'] } }]), []);
});

test('attachments use only current matching source states, and native reports still win', () => {
  const terminal = { address: 't1', state: 'live',
    foreground: { name: 'herdr', argv: ['herdr', '--session', 'work', 'agent', 'attach', 'w1:p1'] },
    labels: { 'herdr.legacy.agent': 'claude', 'herdr.legacy.pane': 'w1:p1' } };
  const snapshot = { work: { checkedAt: 1000, agents: [
    { pane_id: 'w1:p1', agent: 'claude', agent_status: 'working' },
    { pane_id: 'w1:p2', agent: 'claude', agent_status: 'blocked' },
  ] } };
  const rows = (legacy = snapshot, now = 2000, native = []) =>
    visibleAgents(native, spaces, [pane('t1')], [terminal], legacy, now);
  assert.deepEqual(legacyAttachment(terminal), { session: 'work', pane: 'w1:p1' });
  assert.equal(rows()[0].status, 'working');
  assert.equal(rows()[0].status_source, 'legacy');
  assert.equal(rows(snapshot, 10000)[0].status, 'unknown');
  assert.equal(rows({})[0].status, 'unknown');
  const native = { address: 't1', status: 'blocked' };
  assert.equal(rows(snapshot, 2000, [native])[0], native);
  for (const agent of [{ pane_id: 'w1:p1', agent: 'codex', agent_status: 'idle' },
    { pane_id: 'w1:p2', agent: 'claude', agent_status: 'idle' },
    { pane_id: 'w1:p1', agent: 'claude', agent_status: 'unrecognized' }]) {
    assert.equal(rows({ work: { checkedAt: 1000, agents: [agent] } })[0].status, 'unknown');
  }
  snapshot.work.agents[0].agent_status = 'error';
  assert.equal(rows()[0].status, 'blocked');
});
