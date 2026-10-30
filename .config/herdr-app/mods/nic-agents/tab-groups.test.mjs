import test from 'node:test';
import assert from 'node:assert/strict';
import { tabGroups } from './tab-groups.js';

test('interleaved agents join their tab in first-seen order', () => {
  const agents = [
    { address: 't1', tab: 'a' }, { address: 't2', tab: 'b' },
    { address: 't3', tab: 'a' }, { address: 'vps/t1', tab: 'vps/a' },
  ];
  assert.deepEqual(tabGroups(agents).map(group => group.map(a => a.address)),
    [['t1', 't3'], ['t2'], ['vps/t1']]);
});

test('agents without a tab remain separate', () => {
  assert.deepEqual(tabGroups([{ address: 't1' }, { address: 't2' }]).map(g => g.length), [1, 1]);
});
