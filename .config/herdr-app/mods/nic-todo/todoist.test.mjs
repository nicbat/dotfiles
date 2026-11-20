// Todoist client and model, against a fake API: no network, no Keychain.
import test from "node:test";
import assert from "node:assert/strict";
import { readKey, saveKey, openTask, addText, updateTask, getAll, getFilters, loadCatalog, loadView, BUILT_IN, BASE } from "./todoist-client.js";
import { buildView, dueLabel, plainTitle, projectEntries, sameView } from "./todoist-model.js";

const KEY = "fake-key-123";
// A fake fetch: routes by path, records requests, pages /tasks when asked.
function api(routes) {
  const calls = [];
  const request = async (url, options = {}) => {
    calls.push({ url, options });
    assert.equal(options.headers.Authorization, `Bearer ${KEY}`);
    const u = new URL(url);
    const handler = routes[u.pathname.slice(BASE.length - "https://api.todoist.com".length)];
    if (!handler) return { status: 404, ok: false, text: async () => "nope" };
    const body = await handler(u.searchParams, options);
    if (body && body.status) return body;
    return { status: 200, ok: true, json: async () => body, text: async () => JSON.stringify(body) };
  };
  return { request, calls };
}
const page = results => ({ results, next_cursor: null });
const task = (id, extra = {}) => ({ id, content: `task ${id}`, project_id: "p1", section_id: null, parent_id: null,
  labels: [], priority: 1, child_order: Number(id.replace(/\D/g, "")) || 0, due: null, checked: false, is_deleted: false, ...extra });

test("macOS: the key comes from the Keychain; a missing item is null, other failures are errors", async () => {
  const seen = [];
  const exec = code => async (cmd, args) => { seen.push([cmd, ...args]); return { code, stdout: code ? "" : `${KEY}\n`, stderr: "" }; };
  assert.equal(await readKey(exec(0), "macos"), KEY);
  assert.equal(await readKey(exec(0), "darwin"), KEY);
  assert.deepEqual(seen[0], ["security", "find-generic-password", "-s", "herdr-todoist", "-w"]);
  assert.equal(await readKey(exec(44), "darwin"), null);
  await assert.rejects(readKey(exec(1), "darwin"), /Keychain/);
});

test("Linux: the key comes from secret-tool; a missing tool asks for libsecret", async () => {
  const seen = [];
  const exec = (code, stdout = "", stderr = "") => async (cmd, args) => { seen.push([cmd, ...args]); return { code, stdout, stderr }; };
  assert.equal(await readKey(exec(0, `${KEY}\n`), "linux"), KEY);
  assert.deepEqual(seen[0], ["secret-tool", "lookup", "service", "herdr-todoist", "account", "todoist"]);
  assert.equal(await readKey(exec(1), "linux"), null);
  await assert.rejects(readKey(exec(1, "", "Cannot autolaunch D-Bus without X11"), "linux"), /D-Bus/);
  await assert.rejects(readKey(async () => { throw new Error("ENOENT"); }, "linux"), e => e.kind === "nokeystore");
});

test("saving: macOS replaces the Keychain item; Linux hands the key over in a private file, never an argument", async () => {
  const seen = [];
  const ok = async (cmd, args) => { seen.push([cmd, ...args]); return { code: 0, stdout: "", stderr: "" }; };
  await saveKey(ok, "darwin", KEY, {});
  assert.deepEqual(seen[0].slice(0, 7), ["security", "add-generic-password", "-U", "-s", "herdr-todoist", "-a", "todoist"]);
  seen.length = 0;
  const files = new Map();
  await saveKey(ok, "linux", KEY, { folder: "/h/data/nic-todo-key", writeFile: async (path, text) => files.set(path, text) });
  assert.deepEqual(seen[0], ["install", "-d", "-m", "700", "/h/data/nic-todo-key"]);
  assert.equal(files.get("/h/data/nic-todo-key/key"), KEY);
  assert.equal(seen[1][0], "sh");
  assert.match(seen[1][2], /^secret-tool store --label="Herdr Todoist API key" service herdr-todoist account todoist < "\$1"$/);
  assert.ok(!seen.some(call => call.includes(KEY)), "the key is never a command argument on Linux");
  assert.deepEqual(seen.at(-1), ["rm", "-f", "/h/data/nic-todo-key/key"]);
  // No secret-tool: sh exits 127; the file is still removed.
  seen.length = 0;
  const missing = async (cmd, args) => { seen.push([cmd, ...args]); return { code: cmd === "sh" ? 127 : 0, stdout: "", stderr: "" }; };
  await assert.rejects(saveKey(missing, "linux", KEY, { folder: "/f", writeFile: async () => {} }), e => e.kind === "nokeystore");
  assert.deepEqual(seen.at(-1), ["rm", "-f", "/f/key"]);
});

test("tasks open in the desktop app, else on the web", async () => {
  const seen = [];
  const exec = appWorks => async (cmd, args) => { seen.push([cmd, ...args]);
    return { code: args[0].startsWith("todoist:") && !appWorks ? 1 : 0, stdout: "", stderr: "" }; };
  assert.equal(await openTask(exec(true), "macos", "6X7"), "app");
  assert.deepEqual(seen, [["open", "todoist://task?id=6X7"]]);
  seen.length = 0;
  assert.equal(await openTask(exec(false), "linux", "6X7"), "web");
  assert.deepEqual(seen, [["xdg-open", "todoist://task?id=6X7"], ["xdg-open", "https://app.todoist.com/app/task/6X7"]]);
});

test("paginated GETs follow next_cursor and send the limit", async () => {
  const { request, calls } = api({ "/tasks": params => params.get("cursor") === "a.b"
    ? { results: [task("t2")], next_cursor: null } : { results: [task("t1")], next_cursor: "a.b" } });
  const tasks = await getAll(request, KEY, "/tasks", { project_id: "p1" });
  assert.deepEqual(tasks.map(t => t.id), ["t1", "t2"]);
  assert.match(calls[0].url, /project_id=p1&limit=200$/);
  assert.match(calls[1].url, /cursor=a\.b/);
});

test("saved filters come through sync, ordered, without deleted ones", async () => {
  const { request, calls } = api({ "/sync": () => ({ filters: [
    { id: "f2", name: "Later", query: "no date", item_order: 2, is_deleted: false },
    { id: "f0", name: "Gone", query: "x", item_order: 0, is_deleted: true },
    { id: "f1", name: "Work today", query: "#Work & today", item_order: 1, is_deleted: false }] }) });
  const filters = await getFilters(request, KEY);
  assert.deepEqual(filters.map(f => f.name), ["Work today", "Later"]);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.body, `sync_token=*&resource_types=${encodeURIComponent('["filters"]')}`);
});

test("errors name what went wrong", async () => {
  const status = code => ({ request: async () => ({ status: code, ok: false, text: async () => "" }) });
  await assert.rejects(getAll(status(401).request, KEY, "/tasks"), e => e.kind === "auth");
  await assert.rejects(getAll(status(429).request, KEY, "/tasks"), e => e.kind === "rate");
  await assert.rejects(getAll(status(500).request, KEY, "/tasks"), e => e.kind === "http");
  await assert.rejects(getAll(async () => { throw new Error("offline"); }, KEY, "/tasks"), e => e.kind === "network");
});

test("views load from the right endpoint", async () => {
  const { request, calls } = api({
    "/projects": () => page([{ id: "inbox", name: "Inbox", inbox_project: true }, { id: "p1", name: "Work" },
      { id: "old", name: "Old", is_archived: true }]),
    "/labels": () => page([{ id: "l1", name: "office", item_order: 0 }]),
    "/sync": () => ({ filters: [] }),
    "/tasks": () => page([task("t1")]),
    "/sections": () => page([{ id: "s1", name: "Later", section_order: 1 }]),
    "/tasks/filter": () => page([task("t9")])
  });
  const catalog = await loadCatalog(request, KEY);
  assert.deepEqual(catalog.projects.map(p => p.id), ["inbox", "p1"]);
  calls.length = 0;
  await loadView(request, KEY, BUILT_IN.inbox, catalog);
  assert.ok(calls.some(c => /\/tasks\?project_id=inbox/.test(c.url)));
  calls.length = 0;
  await loadView(request, KEY, BUILT_IN.today, catalog);
  assert.match(calls[0].url, /\/tasks\/filter\?query=today%20%7C%20overdue/);
  calls.length = 0;
  await loadView(request, KEY, { kind: "label", id: "l1", name: "office" }, catalog);
  assert.match(calls[0].url, /\/tasks\?label=office/);
});

const NOW = new Date(2026, 10, 19, 12, 0); // Thu Nov 19 2026, noon

test("due dates read the way Todoist says them", () => {
  assert.deepEqual(dueLabel({ date: "2026-11-19" }, NOW), { text: "Today", overdue: false });
  assert.deepEqual(dueLabel({ date: "2026-11-18" }, NOW), { text: "Yesterday", overdue: true });
  assert.equal(dueLabel({ date: "2026-11-20" }, NOW).text, "Tomorrow");
  assert.equal(dueLabel({ date: "2026-11-23" }, NOW).text, "Mon");
  assert.equal(dueLabel({ date: "2026-12-25", is_recurring: true }, NOW).text, "Dec 25 ↻");
  assert.equal(dueLabel({ date: "2027-01-02" }, NOW).text, "Jan 2 2027");
  assert.deepEqual(dueLabel({ date: "2026-11-19T09:30:00" }, NOW), { text: "Today 9:30am", overdue: true });
  assert.equal(dueLabel({ date: "2026-11-19T15:00:00" }, NOW).text, "Today 3pm");
  assert.equal(dueLabel(null, NOW), null);
  assert.equal(plainTitle("Read [the doc](https://x.y) **now**"), "Read the doc now");
});

test("a project groups by section with subtasks under their parents", () => {
  const view = buildView({ view: { kind: "project", id: "p1" }, now: NOW,
    sections: [{ id: "s2", name: "Later", section_order: 2 }, { id: "s1", name: "Soon", section_order: 1 }],
    tasks: [task("t3", { section_id: "s1" }), task("t1"), task("t4", { section_id: "s1", parent_id: "t3" }),
      task("t2", { section_id: "gone" }), task("t5", { checked: true }), task("t6", { section_id: "s2", priority: 4 })] });
  assert.deepEqual(view.groups.map(g => [g.label, g.items.map(i => `${i.id}:${i.depth}`)]),
    [[null, ["t1:0", "t2:0"]], ["Soon", ["t3:0", "t4:1"]], ["Later", ["t6:0"]]]);
  assert.equal(view.open, 5);
  assert.equal(view.groups[2].items[0].priority, 4);
  assert.equal(view.groups[0].items[0].project, null);
});

test("Today splits overdue from today and names each task's project", () => {
  const view = buildView({ view: BUILT_IN.today, now: NOW, projects: [{ id: "p1", name: "Work" }],
    tasks: [task("a", { due: { date: "2026-11-19" }, priority: 1 }), task("b", { due: { date: "2026-11-19" }, priority: 4 }),
      task("c", { due: { date: "2026-11-17" } })] });
  assert.deepEqual(view.groups.map(g => [g.label, g.items.map(i => i.id)]), [["Overdue", ["c"]], ["Today", ["b", "a"]]]);
  assert.equal(view.groups[1].items[0].project, "Work");
  const calm = buildView({ view: BUILT_IN.today, now: NOW, tasks: [task("a", { due: { date: "2026-11-19" } })] });
  assert.deepEqual(calm.groups.map(g => g.label), [null]);
});

test("Upcoming groups by day; empty views keep one unlabeled group", () => {
  const view = buildView({ view: BUILT_IN.upcoming, now: NOW,
    tasks: [task("x", { due: { date: "2026-11-21" } }), task("y", { due: { date: "2026-11-20" } }), task("z", { due: { date: "2026-11-21" } })] });
  assert.deepEqual(view.groups.map(g => [g.label, g.items.map(i => i.id)]), [["Tomorrow", ["y"]], ["Sat", ["x", "z"]]]);
  assert.deepEqual(buildView({ view: { kind: "filter", query: "x" }, tasks: [] }).groups, [{ label: null, items: [] }]);
});

test("the picker nests projects and skips the Inbox; views compare by kind and id", () => {
  assert.deepEqual(projectEntries([{ id: "i", name: "Inbox", inbox_project: true }, { id: "b", name: "B", child_order: 2 },
    { id: "a", name: "A", child_order: 1 }, { id: "a1", name: "A1", parent_id: "a" }]),
  [{ id: "a", name: "A", depth: 0 }, { id: "a1", name: "A1", depth: 1 }, { id: "b", name: "B", depth: 0 }]);
  assert.ok(sameView(BUILT_IN.today, { kind: "today" }));
  assert.ok(!sameView({ kind: "project", id: "1" }, { kind: "project", id: "2" }));
  assert.ok(!sameView(null, BUILT_IN.today));
});

test("Quick Add text gets the view's project, section or label unless it names its own", () => {
  const project = { kind: "project", id: "p", name: "Side Projects" };
  assert.equal(addText(" Call mom tomorrow p1 ", project, { project: "Side Projects", section: "This week" }),
    "Call mom tomorrow p1 #Side\\ Projects /This\\ week");
  assert.equal(addText("Buy milk #Home", project, { project: "Side Projects" }), "Buy milk #Home");
  assert.equal(addText("Read", { kind: "label", name: "deep" }), "Read @deep");
  assert.equal(addText("Read @deep", { kind: "label", name: "deep" }), "Read @deep");
  assert.equal(addText("Read @deeper", { kind: "label", name: "deep" }), "Read @deeper @deep");
  assert.equal(addText("Anything", { kind: "today" }), "Anything");
});

test("updates send JSON to the task", async () => {
  const { request, calls } = api({ "/tasks/t1": () => ({ id: "t1", content: "new" }) });
  assert.deepEqual(await updateTask(request, KEY, "t1", { content: "new", priority: 4 }), { id: "t1", content: "new" });
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers["Content-Type"], "application/json");
  assert.equal(calls[0].options.body, JSON.stringify({ content: "new", priority: 4 }));
});
