import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AutoTitles, cleanTitle, titleFor } from './auto-title.js';

const home = '/home/nicbat';
const tab = { id: 'tab', index: 1, name: '1', named: false };
const pane = { pane: 'p1', terminal: 't1', tab: 'tab', cwd: `${home}/Projects/demo`, title: '⠋ Fix login | demo', program: { agent: true, name: 'Codex' } };
function setup(seed = {}) {
  const data = { ...seed }, calls = [];
  const storage = { getItem: (key) => data[key] ?? null, setItem: (key, value) => { data[key] = value; } };
  return { data, calls, controller: new AutoTitles(storage, (id, name) => calls.push({ id, name }), home) };
}
const sync = (controller, item, list = [pane]) => controller.sync([{ tabs: [item] }], list);

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

test('mod-only tabs are untouched and each split tab remembers its focused pane', () => {
  const x = setup();
  sync(x.controller, tab, [{ pane: 'mod', tab: 'tab', mod: 'files', terminal: null }]);
  assert.equal(x.calls.length, 0);
  const other = { ...pane, pane: 'p2', terminal: 't2', title: 'Other task | demo', focused: true };
  sync(x.controller, tab, [pane, other]);
  const named = { ...tab, named: true, name: x.calls[0].name };
  sync(x.controller, named, [pane, { ...other, focused: false }]);
  assert.equal(x.calls.length, 1);
  assert.equal(named.name, 'Other task');
});

test('a named split keeps its title when another pane is merged or focused and after unmerge', () => {
  const x = setup(); sync(x.controller, tab);
  const named = { ...tab, named: true, name: x.calls[0].name };
  sync(x.controller, named);
  const moved = { ...pane, pane: 'p2', terminal: 't2', title: 'Other task', focused: true };
  sync(x.controller, named, [pane, moved]);
  assert.equal(x.calls.length, 1);
  sync(x.controller, named, [{ ...pane, title: 'New title from the remaining pane' }]);
  assert.equal(x.calls.length, 1);
  const reloaded = setup(x.data);
  sync(reloaded.controller, named, [pane, moved]);
  assert.equal(reloaded.calls.length, 0);
});

test('a named mixed document group is stable and explicitly clearing it permits a new title', () => {
  const x = setup(); sync(x.controller, tab);
  const named = { ...tab, named: true, name: x.calls[0].name };
  const document = { pane:'notes', tab:'tab', terminal:null, mod:'notes' };
  sync(x.controller, named, [{ ...pane, title:'Different task' }, document]);
  assert.equal(x.calls.length, 1);
  sync(x.controller, tab, [{ ...pane, title:'Different task' }, document]);
  assert.equal(x.calls.at(-1).name, 'Different task');
});
