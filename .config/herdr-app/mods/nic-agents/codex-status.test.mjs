import test from 'node:test';
import assert from 'node:assert/strict';
import { codexSession, hookStatus, newBindings } from './codex-status.js';
import { visibleAgents } from './visible-agents.js';

const terminal = { address: 't1', state: 'live', foreground: {
  name: 'declawd', argv: ['declawd', '--codex'], pid: 123, cwd: '/project' },
  labels: { 'herdr.codex.session': 'session-a', 'herdr.codex.pid': '123' } };
const record = { session_id: 'session-a', state: 'working', cwd: '/project', session_started_ms: 1000 };

test('a hook binds to its exact session and process, excluding stale shell and process reuse', () => {
  assert.equal(hookStatus(record, terminal), 'working');
  assert.equal(hookStatus({ ...record, ignored: true }, terminal), null);
  assert.equal(hookStatus({ ...record, session_id: 'other-session' }, terminal), null);
  assert.equal(hookStatus({ ...record, state: 'invalid' }, terminal), null);
  assert.equal(hookStatus(record, { ...terminal, address: 'remote/t1' }), null);
  for (const fg of [{ ...terminal.foreground, pid: 456 }, { name: 'zsh', pid: 123 },
    { name: 'declawd', argv: ['declawd'], pid: 123 }]) {
    assert.equal(codexSession({ ...terminal, foreground: fg }), null);
  }
  assert.equal(hookStatus({ session_id: 'session-a', event: 'Stop' }, terminal), 'done');
});

test('observer state appears in the sidebar, and real native reports retain priority', () => {
  const spaces = [{ id: 'space', name: 'Space', tabs: [{ id: 'tab' }] }];
  const panes = [{ pane: 'pane', tab: 'tab', terminal: 't1', program: {} }];
  const hook = { 'session-a': record };
  const rows = visibleAgents([], spaces, panes, [terminal], {}, 1000, hook);
  assert.equal(rows[0].status, 'working');
  assert.equal(rows[0].status_source, 'codex-hook');
  const native = { address: 't1', status: 'blocked' };
  assert.equal(visibleAgents([native], spaces, panes, [terminal], {}, 1000, hook)[0], native);
});

test('future launches bind only with a fresh, mutually unique startup and matching folder', () => {
  const unbound = { ...terminal, labels: {} };
  const starts = { t1: { pid: 123, seenAt: 1200 } };
  assert.deepEqual(newBindings([unbound], [record], starts, 2000), [{ terminal: 't1', pid: 123, session: 'session-a' }]);
  assert.deepEqual(newBindings([unbound], [record, { ...record, session_id: 'session-b' }], starts, 2000), []);
  assert.deepEqual(newBindings([unbound, { ...unbound, address: 't2' }], [record],
    { ...starts, t2: { pid: 123, seenAt: 1200 } }, 2000), []);
  assert.deepEqual(newBindings([unbound], [{ ...record, cwd: '/other' }], starts, 2000), []);
  assert.deepEqual(newBindings([unbound], [record], starts, 121000), []);
  assert.deepEqual(newBindings([terminal], [record], starts, 2000), []);
});

test('slow wrapper startup binds within a bounded window, without future or replacement matches', () => {
  const unbound = { ...terminal, labels: {} };
  const starts = { t1: { pid: 123, seenAt: 1000 } };
  const delayed = { ...record, session_started_ms: 75000 };
  assert.equal(newBindings([unbound], [delayed], starts, 80000).length, 1);
  assert.deepEqual(newBindings([unbound], [delayed], starts, 74000), []);
  assert.deepEqual(newBindings([unbound], [{ ...delayed, session_started_ms: 92000 }], starts, 93000), []);
  assert.deepEqual(newBindings([{ ...unbound, foreground: { ...unbound.foreground, pid: 456 } }], [delayed], starts, 80000), []);
  assert.deepEqual(newBindings([unbound], [delayed, { ...delayed, session_id: 'ambiguous' }], starts, 80000), []);
});
