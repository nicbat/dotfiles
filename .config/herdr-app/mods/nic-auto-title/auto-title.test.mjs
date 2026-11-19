import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AutoTitles, cleanTitle, titleFor } from './auto-title.js';

const home = '/home/nicbat';
const tab = { id: 'tab', index: 1, name: '1', named: false };
const pane = { pane: 'p1', terminal: 't1', tab: 'tab', cwd: `${home}/Projects/demo`, title: '⠋ Fix login | demo', program: { agent: true, name: 'Codex' } };
function setup(seed = {}) {
  const data = { ...seed }, calls = [];
  const storage = { getItem: (key) => data[key] ?? null, setItem: (key, value) => { data[key] = value; } };
  const labels = [];
  return { data, calls, labels, controller: new AutoTitles(storage, (id, name) => calls.push({ id, name }), home,
    (terminal, name) => labels.push({ terminal, name })) };
}
const sync = (controller, item, list = [pane], names) => controller.sync([{ tabs: [item] }], list, names);

test('live agent titles exclude status decoration and repeated folder suffixes', () => {
  assert.equal(titleFor(tab, pane, home), 'Fix login');
  assert.equal(titleFor(tab, { ...pane, title: '✳ Action Required | Fix login | demo' }, home), 'Fix login');
  assert.equal(cleanTitle('\x1b[31m⠋ Task | nicbat\x1b[0m', 'nicbat'), 'Task');
});

test('shells use non-default branches, with bounded Unicode titles', () => {
  assert.equal(titleFor(tab, { ...pane, title: 'bash', branch: 'feature/login', program: { shell: true } }, home), 'feature/login');
  assert.equal(titleFor(tab, { ...pane, cwd: home, title: 'bash', program: { shell: true } }, home), 'Shell');
  assert.equal(Array.from(titleFor(tab, { ...pane, title: '漢'.repeat(100) }, home)).length, 76);
});

test('live updates retain ownership across reload and do not loop on acknowledgement', () => {
  const first = setup();
  sync(first.controller, tab);
  assert.equal(first.calls.length, 1);
  sync(first.controller, tab); // old snapshot while the command is pending
  assert.equal(first.calls.length, 1);
  const named = { ...tab, named: true, name: first.calls[0].name };
  sync(first.controller, named);
  assert.equal(first.calls.length, 1);
  const second = setup(first.data);
  sync(second.controller, named, [{ ...pane, title: 'Add tests | demo' }]);
  assert.equal(second.calls[0].name, 'Add tests');
});

test('existing and later manual names win; clearing a name reenables automatic titles', () => {
  const x = setup();
  sync(x.controller, { ...tab, named: true, name: 'My custom task' });
  assert.equal(x.calls.length, 0);
  sync(x.controller, tab);
  sync(x.controller, { ...tab, named: true, name: x.calls[0].name });
  sync(x.controller, { ...tab, named: true, name: 'Keep this name' });
  sync(x.controller, { ...tab, named: true, name: 'Keep this name' }, [{ ...pane, title: 'Different task' }]);
  assert.equal(x.calls.length, 1);
  sync(x.controller, tab);
  assert.equal(x.calls.length, 2);
});

test('mod-only tabs are untouched and an unnamed split stays numbered', () => {
  const x = setup();
  sync(x.controller, tab, [{ pane: 'mod', tab: 'tab', mod: 'files', terminal: null }]);
  const other = { ...pane, pane: 'p2', terminal: 't2', title: 'Other task | demo', focused: true };
  sync(x.controller, tab, [pane, other]);
  assert.equal(x.calls.length, 0);
});

test('splitting a tab with a chosen name gives that name to its agent and numbers the group', () => {
  const x = setup();
  const chosen = { ...tab, named: true, name: 'API review' };
  sync(x.controller, chosen);
  const shell = { pane: 'p2', terminal: 't2', tab: 'tab', title: 'zsh', program: { shell: true } };
  sync(x.controller, chosen, [pane, shell]);
  assert.deepEqual(x.labels, [{ terminal: 't1', name: 'API review' }]);
  assert.deepEqual(x.calls, [{ id: 'tab', name: '' }]);
  sync(x.controller, chosen, [pane, shell]); // the old name until the clear lands
  assert.equal(x.calls.length, 1);
  sync(x.controller, tab, [pane, shell]);
  assert.equal(x.calls.length, 1);
  // Survives a reload between seeing the single tab and the split.
  const y = setup(); sync(y.controller, chosen);
  const reloaded = setup(y.data); sync(reloaded.controller, chosen, [pane, shell]);
  assert.deepEqual(reloaded.labels, [{ terminal: 't1', name: 'API review' }]);
});

test('splitting an automatically titled tab clears the name without labelling the agent', () => {
  const x = setup(); sync(x.controller, tab);
  const named = { ...tab, named: true, name: x.calls[0].name };
  sync(x.controller, named);
  const moved = { ...pane, pane: 'p2', terminal: 't2', title: 'Other task', focused: true };
  sync(x.controller, named, [pane, moved]);
  assert.deepEqual(x.calls.at(-1), { id: 'tab', name: '' });
  assert.equal(x.labels.length, 0);
});

test('a group named by hand keeps its name; back to one pane, that pane\'s own name titles the tab', () => {
  const x = setup();
  const moved = { ...pane, pane: 'p2', terminal: 't2', title: 'Other task' };
  const group = { ...tab, named: true, name: 'Release work' };
  sync(x.controller, tab, [pane, moved]);
  sync(x.controller, group, [pane, moved]);
  assert.equal(x.calls.length, 0);
  sync(x.controller, tab, [pane], { t1: 'API review' });
  assert.equal(x.calls.at(-1).name, 'API review');
});

test('a mixed document group is numbered and explicitly naming it keeps that name', () => {
  const x = setup(); sync(x.controller, tab);
  const named = { ...tab, named: true, name: x.calls[0].name };
  sync(x.controller, named);
  const document = { pane:'notes', tab:'tab', terminal:null, mod:'notes' };
  sync(x.controller, named, [{ ...pane, title:'Different task' }, document]);
  assert.deepEqual(x.calls.at(-1), { id: 'tab', name: '' });
  sync(x.controller, tab, [{ ...pane, title:'Different task' }, document]);
  sync(x.controller, { ...tab, named: true, name: 'Notes and fix' }, [{ ...pane, title:'Different task' }, document]);
  assert.equal(x.calls.length, 2);
});
