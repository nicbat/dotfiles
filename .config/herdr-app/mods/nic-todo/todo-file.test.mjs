import test from "node:test";
import assert from "node:assert/strict";
import { parseTodos, headings, viewOf, addTodo, setDone, editTodo, removeTodo, restoreTodo } from "./todo-file.js";

const NOTE = `# Work
- [ ] test 1
- [ ] test 2
## In Office
- [ ] test 5
- [ ] get tea

# Home
- [ ] test 3
- [ ] test 4`;
const key = (text, title) => parseTodos(text).sections.flatMap(s => s.items).find(item => item.title === title).key;
const titles = group => group.items.map(item => item.title);

test("the user's note parses into headings, unlabeled items and label groups", () => {
  assert.deepEqual(headings(NOTE), ["Work", "Home"]);
  const view = viewOf(NOTE, "Work");
  assert.equal(view.found, true);
  assert.equal(view.open, 4);
  assert.deepEqual(view.groups.map(g => [g.label, titles(g)]), [[null, ["test 1", "test 2"]], ["In Office", ["test 5", "get tea"]]]);
  assert.deepEqual(viewOf(NOTE, "Home").groups.map(titles), [["test 3", "test 4"]]);
  assert.equal(viewOf(NOTE, "Missing").found, false);
});

test("adding goes after the last unlabeled item, before any label, and changes nothing else", () => {
  assert.equal(addTodo(NOTE, "Work", "new one"), NOTE.replace("- [ ] test 2\n", "- [ ] test 2\n- [ ] new one\n"));
  const empty = "# Work\nNotes stay put.\n## In Office\n- [ ] tea\n";
  assert.equal(addTodo(empty, "Work", "first"), "# Work\n- [ ] first\nNotes stay put.\n## In Office\n- [ ] tea\n");
  assert.equal(addTodo("", "Work", "first"), "# Work\n- [ ] first\n");
  assert.equal(addTodo("# Home\n- [ ] a\n", "Work", "b"), "# Home\n- [ ] a\n\n# Work\n- [ ] b\n");
});

test("completing archives under the source heading with a date, and reopening returns it unlabeled", () => {
  const done = setDone(NOTE, key(NOTE, "get tea"), true, "2026-11-06");
  assert.equal(done, `# Work
- [ ] test 1
- [ ] test 2
## In Office
- [ ] test 5

# Home
- [ ] test 3
- [ ] test 4

# Archive
## Work
- [x] get tea ✅ 2026-11-06`);
  const view = viewOf(done, "Work");
  assert.equal(view.open, 3);
  assert.deepEqual(view.archived.map(item => item.title), ["get tea"]);
  assert.equal(viewOf(done, "Home").archived.length, 0);

  const twice = setDone(done, key(done, "test 3"), true, "2026-11-07");
  assert.ok(twice.endsWith("# Archive\n## Work\n- [x] get tea ✅ 2026-11-06\n\n## Home\n- [x] test 3 ✅ 2026-11-07"));
  const more = setDone(twice, key(twice, "test 1"), true, "2026-11-08");
  assert.ok(more.includes("## Work\n- [x] get tea ✅ 2026-11-06\n- [x] test 1 ✅ 2026-11-08\n\n## Home"));
  assert.deepEqual(viewOf(more, "Work").archived.map(item => item.title), ["test 1", "get tea"], "newest first");

  const reopened = setDone(more, key(more, "get tea"), false);
  assert.deepEqual(viewOf(reopened, "Work").groups[0].items.map(item => item.title), ["test 2", "get tea"]);
  assert.ok(!reopened.includes("get tea ✅"));
});

test("items ticked in Obsidian count as archived and untick in place", () => {
  const text = "# Work\n- [x] done here\n- [ ] open\n";
  assert.deepEqual(viewOf(text, "Work").archived.map(item => item.title), ["done here"]);
  assert.equal(setDone(text, key(text, "done here"), false), "# Work\n- [ ] done here\n- [ ] open\n");
});

test("nested lines travel with their item and other content is untouched", () => {
  const text = "---\ntags: [todo]\n---\n# Work\nSome notes\n* [ ] parent\n  - child\n\tmore\n- [ ] next\n```\n# not a heading\n- [ ] not an item\n```\n";
  assert.deepEqual(viewOf(text, "Work").groups[0].items.map(item => item.title), ["parent", "next"]);
  assert.deepEqual(headings(text), ["Work"]);
  const done = setDone(text, key(text, "parent"), true, "2026-11-06");
  assert.ok(done.startsWith("---\ntags: [todo]\n---\n# Work\nSome notes\n- [ ] next\n```"));
  assert.ok(done.endsWith("```\n\n# Archive\n## Work\n* [x] parent ✅ 2026-11-06\n  - child\n\tmore\n"));
});

test("editing keeps the bullet, completion and archive date; CRLF notes stay CRLF", () => {
  const text = "# Work\r\n* [ ] old\r\n# Archive\r\n## Work\r\n- [x] past ✅ 2026-11-01\r\n";
  const edited = editTodo(editTodo(text, key(text, "old"), "new"), key(text, "past"), "past, renamed");
  assert.equal(edited, "# Work\r\n* [ ] new\r\n# Archive\r\n## Work\r\n- [x] past, renamed ✅ 2026-11-01\r\n");
});

test("duplicate titles are told apart and a vanished item is reported rather than guessed", () => {
  const text = "# Work\n- [ ] same\n- [ ] same\n";
  const [first, second] = parseTodos(text).sections[0].items;
  assert.notEqual(first.key, second.key);
  assert.equal(editTodo(text, second.key, "other"), "# Work\n- [ ] same\n- [ ] other\n");
  assert.throws(() => editTodo("# Work\n- [ ] changed\n", first.key, "x"), /changed in the note/);
});

test("delete and undo restore the exact block, or re-add it under its heading if the note moved on", () => {
  const removed = removeTodo(NOTE, key(NOTE, "test 5"));
  assert.ok(!removed.text.includes("test 5"));
  assert.equal(restoreTodo(removed.text, removed.undo), NOTE);
  const changed = addTodo(removed.text, "Home", "elsewhere");
  assert.ok(viewOf(restoreTodo(changed, removed.undo), "Work").groups[0].items.some(item => item.title === "test 5"));
});
