import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { emptyState, normalizePR, mergeSnapshot, STORE, HOST, HOST_STORE, storeKey, prKey } from "./model.js";

function element() {
  const target = { items: [], methods: {} };
  const proxy = new Proxy(target, { get(obj, key) {
    if (key === "child") return child => { obj.items.push(child); return proxy; };
    if (key === "children") return children => { obj.items.push(...children); return proxy; };
    if (key === "trigger" || key === "content") return child => { obj.items.push(child); return proxy; };
    if (key === "when") return (condition, fn) => condition ? fn(proxy) : proxy;
    if (key in obj) return obj[key];
    return (...args) => { obj.methods[key] = args; return proxy; };
  } });
  return proxy;
}
function input(options = {}) {
  let value = options.value ?? "";
  return { handlers: {}, value: () => value, set_value: next => { value = next; },
    on(event, handler) { this.handlers[event] = handler; }, focus() {} };
}
globalThis.prViewTest = { element, input };
const modules = {
  "gpui-kit": "export class View {}; export const div = globalThis.prViewTest.element; export const svg = div;",
  "gpui-base": `export const v_flex = globalThis.prViewTest.element; export const h_flex = v_flex;
    export const InputState = { new: globalThis.prViewTest.input }; export const Input = { new: v_flex };
    export const TextareaState = { new: options => Object.assign(globalThis.prViewTest.input(options), { set_auto_grow() {} }) };
    export const Textarea = { new: v_flex };
    export const Popover = { new: id => v_flex().id(id) };`,
  "herdr": `const mock = globalThis.prViewTest;
    export const theme = () => mock.palette ?? new Proxy({}, { get: () => "#556677" });
    export const shared = key => mock.shared[key];
    export const setShared = (key, value) => { mock.shared[key] = value; };
    export const exec = (...args) => mock.network(...args);
    export const nextCommand = () => new Promise(() => {});
    export const run = (...args) => { mock.runs.push(args); return null; };
    export const spaces = () => mock.spaces ?? [];
    export const home = () => "/Users/me";`
};
registerHooks({
  resolve(specifier, context, next) { return specifier in modules ? { url: `prs-test:${specifier}`, shortCircuit: true } : next(specifier, context); },
  load(url, context, next) { return url.startsWith("prs-test:") ? { format: "module", source: modules[url.slice(9)], shortCircuit: true } : next(url, context); }
});
const { default: PRs } = await import("./main.js");
const lookup = (node, id) => typeof node === "string" ? null : node.methods.id?.[0] === id ? node :
  node.items.map(child => lookup(child, id)).find(Boolean);
const hover = (view, key, cx, value = true) => lookup(view.render(), `pr-${key}`).methods.on_hover[0](value, cx);
const click = (view, id, cx) => {
  if (id.startsWith("move-")) {
    const key = id.slice(5);
    hover(view, key, cx);
    lookup(view.render(), `pr-actions-${key}`).methods.on_open_change[0](true, cx);
  }
  const node = lookup(view.render(), id); assert.ok(node, id); node.methods.on_click[0](null, cx); };
const date = "2026-11-05T22:00:00Z";
const node = (state = "OPEN") => ({ id: "P1", repository: { nameWithOwner: "Roblox/example" }, number: 1,
  title: "A useful PR", url: `https://${HOST}/Roblox/example/pull/1`, state, isDraft: false, updatedAt: date,
  closedAt: state === "OPEN" ? null : date, mergedAt: state === "MERGED" ? date : null });
const page = nodes => ({ code: 0, stdout: JSON.stringify({ data: { viewer: { login: "nbatchelder",
  pullRequests: { nodes, totalCount: nodes.length, pageInfo: { endCursor: null, hasNextPage: false } } } } }) });
async function start(fresh = true) {
  const mock = globalThis.prViewTest;
  if (fresh) Object.assign(mock, { palette: null, shared: { [HOST_STORE]: HOST }, runs: [], spaces: [], jobs: [], opened: [], timers: [], network: async (_program, args) => args[0] === "auth" ? { code: 0, stdout: JSON.stringify([{ host: HOST, login: "nbatchelder" }, { host: "github.com", login: "nicbat" }]) } : page([]) });
  const cx = { notify() {}, stop_propagation() {}, focus_handle: () => ({ focus() {} }),
    open_url: url => mock.opened.push(url), spawn: job => mock.jobs.push(job), timer: { every: (_ms, job) => mock.timers.push(job) } };
  const view = new PRs(); view.init({}, cx);
  await mock.jobs.at(-2)(cx);
  return { view, cx, mock };
}
function seed(mock, state = "OPEN") {
  mock.shared[STORE] = mergeSnapshot(emptyState(), { login: "nbatchelder", records: [normalizePR(node(state), date)],
    observedAt: date, history: { cursor: "old", hasNext: true, total: 100 } });
}
function folder(view, cx, name) { view.newFolder.set_value(name); view.newFolder.handlers.submit({}, cx); return view.state.folders.at(-1).id; }

test("real input, folder and move callbacks persist organization across a new view", async () => {
  let { view, cx, mock } = await start(); seed(mock);
  const first = folder(view, cx, "RM3"), second = folder(view, cx, "Other");
  const key = prKey("Roblox/example", 1);
  click(view, `move-${key}`, cx); click(view, `assign-${key}-${first}`, cx);
  assert.equal(mock.shared[STORE].assignments[key], first);
  click(view, `options-${first}`, cx); click(view, `rename-${first}`, cx);
  view.renameInput.set_value("Réviser 工作"); view.renameInput.handlers.submit({}, cx);
  click(view, `down-${first}`, cx);
  assert.deepEqual(mock.shared[STORE].folders.map(f => f.id), [second, first]);
  click(view, `folder-${first}`, cx);
  assert.equal(lookup(view.render(), `pr-${key}`), undefined);
  click(view, `folder-${first}`, cx);
  click(view, `open-${key}`, cx);
  assert.deepEqual(mock.opened, [`https://${HOST}/Roblox/example/pull/1`]);
  ({ view, cx } = await start(false));
  assert.equal(view.state.folders.at(-1).name, "Réviser 工作");
  assert.equal(view.state.assignments[key], first);
  click(view, `options-${first}`, cx); click(view, `delete-${first}`, cx);
  assert.equal(mock.shared[STORE].assignments[key], undefined);
  assert.ok(lookup(view.render(), `pr-${key}`));
});

test("actual filter/search controls show retained history in the same folders", async () => {
  const { view, cx, mock } = await start(); seed(mock, "MERGED");
  const key = prKey("Roblox/example", 1);
  const id = folder(view, cx, "History");
  click(view, "filter-All", cx); click(view, `move-${key}`, cx); click(view, `assign-${key}-${id}`, cx);
  click(view, "filter-Open", cx); assert.equal(lookup(view.render(), `pr-${key}`), undefined);
  click(view, "filter-Merged", cx); assert.ok(lookup(view.render(), `pr-${key}`));
  assert.ok(lookup(view.render(), "load-older"));
  view.search.set_value("does not match"); view.search.handlers.change({}, cx);
  assert.equal(lookup(view.render(), `pr-${key}`), undefined);
  view.search.set_value("#1"); assert.ok(lookup(view.render(), `pr-${key}`));
  assert.equal(mock.shared[STORE].assignments[key], id);
});

test("folder edits made during a network refresh survive when its result is applied", async () => {
  const { view, cx, mock } = await start(); seed(mock);
  let resolve;
  mock.network = async (_program, args) => args.some(arg => arg.includes("states: [OPEN]")) ?
    new Promise(done => { resolve = done; }) : page([]);
  const job = mock.jobs.at(-1)(cx);
  const id = folder(view, cx, "While refreshing");
  const key = prKey("Roblox/example", 1);
  click(view, `move-${key}`, cx); click(view, `assign-${key}-${id}`, cx);
  resolve(page([node()])); await job;
  assert.equal(mock.shared[STORE].assignments[key], id);
  assert.equal(mock.shared[STORE].folders[0].name, "While refreshing");
  assert.equal(view.busy, false);
});

test("failed refresh displays an error and retains cache, folders and history cursor", async () => {
  const { view, cx, mock } = await start(); seed(mock);
  folder(view, cx, "Saved");
  const before = structuredClone(mock.shared[STORE]);
  mock.network = async () => ({ code: 1, stdout: "" });
  await mock.jobs.at(-1)(cx);
  assert.deepEqual(mock.shared[STORE], before);
  assert.match(view.error, /saved PRs are retained/);
  assert.ok(lookup(view.render(), `pr-${prKey("Roblox/example", 1)}`));
});

test("invalid saved data remains intact and folder submissions cannot overwrite it", async () => {
  const { mock } = await start(); const raw = { version: 2, folders: [{ name: "keep me" }] }; mock.shared[STORE] = raw;
  const { view, cx } = await start(false);
  view.newFolder.set_value("Must not replace"); view.newFolder.handlers.submit({}, cx);
  assert.equal(mock.shared[STORE], raw);
  assert.ok(view.dataError);
  assert.equal(lookup(view.render(), "add-folder"), undefined);
});

test("host controls isolate folders and ignore an old refresh without clearing the new host's busy state", async () => {
  let { view, cx, mock } = await start(); seed(mock);
  const key = prKey("Roblox/example", 1), id = folder(view, cx, "Model Routing");
  click(view, `move-${key}`, cx); click(view, `assign-${key}-${id}`, cx);
  const enterprise = structuredClone(mock.shared[STORE]);
  let resolveOld, oldCalls = 0;
  mock.network = async (_program, args) => {
    if (args[2] === HOST) return oldCalls++ === 0 ? new Promise(resolve => { resolveOld = resolve; }) : page([]);
    assert.equal(args[2], "github.com");
    return { code: 0, stdout: JSON.stringify({ data: { viewer: { login: "nicbat", pullRequests: {
      nodes: [], totalCount: 0, pageInfo: { endCursor: null, hasNextPage: false }
    } } } }) };
  };
  const oldJob = mock.jobs.at(-1)(cx);
  click(view, "choose-host", cx); click(view, "host-github.com", cx);
  assert.equal(view.host, "github.com");
  assert.equal(mock.shared[HOST_STORE], "github.com");
  assert.deepEqual(view.state.folders, []);
  const personalId = folder(view, cx, "Personal");
  resolveOld(page([node()])); await oldJob;
  assert.equal(view.busy, true);
  assert.deepEqual(mock.shared[STORE], enterprise);
  await mock.jobs.at(-1)(cx);
  assert.equal(view.state.login, "nicbat");
  assert.equal(view.busy, false);
  assert.equal(mock.shared[storeKey("github.com")].folders[0].id, personalId);
  click(view, "choose-host", cx); click(view, `host-${HOST}`, cx);
  assert.deepEqual(view.state, enterprise);
  assert.equal(view.state.assignments[key], id);
  click(view, "choose-host", cx); click(view, "host-github.com", cx);
  mock.network = async (_program, args) => args[0] === "auth" ? { code: 0, stdout: JSON.stringify([
    { host: HOST, login: "nbatchelder" }, { host: "github.com", login: "nicbat" }
  ]) } : page([]);
  ({ view, cx } = await start(false));
  assert.equal(view.host, "github.com");
  assert.equal(view.state.folders[0].id, personalId);
});

test("personal-only machine discovers and fetches github.com without querying enterprise", async () => {
  const { mock } = await start();
  mock.shared = {};
  const calls = [];
  mock.network = async (_program, args) => {
    calls.push(args);
    if (args[0] === "auth") return { code: 0, stdout: '[{"host":"github.com","login":"nicbat"}]' };
    assert.equal(args[2], "github.com");
    return { code: 0, stdout: JSON.stringify({ data: { viewer: { login: "nicbat", pullRequests: {
      nodes: [], totalCount: 0, pageInfo: { endCursor: null, hasNextPage: false }
    } } } }) };
  };
  const { view, cx } = await start(false);
  await mock.jobs.at(-1)(cx);
  assert.equal(view.host, "github.com");
  assert.equal(view.state.login, "nicbat");
  assert.equal(calls.length, 3);
  assert.equal(mock.shared[STORE], undefined);
});

test("hover menu dismisses, opens the folder picker, and ignores a late exit from another row", async () => {
  const { view, cx, mock } = await start(); seed(mock);
  const key = prKey("Roblox/example", 1);
  assert.equal(lookup(view.render(), `more-${key}`), undefined);
  hover(view, key, cx);
  assert.ok(lookup(view.render(), `more-${key}`));
  assert.equal(lookup(view.render(), `move-${key}`), undefined);
  hover(view, key, cx, false);
  assert.equal(lookup(view.render(), `more-${key}`), undefined);
  hover(view, key, cx);
  lookup(view.render(), `pr-actions-${key}`).methods.on_open_change[0](true, cx);
  hover(view, key, cx, false);
  assert.ok(lookup(view.render(), `more-${key}`));
  assert.ok(lookup(view.render(), `move-${key}`));
  lookup(view.render(), `pr-actions-${key}`).methods.on_open_change[0](false, cx);
  assert.equal(lookup(view.render(), `more-${key}`), undefined);
  click(view, `move-${key}`, cx);
  hover(view, key, cx, false);
  assert.equal(view.prMenu, null);
  assert.ok(lookup(view.render(), `more-${key}`));
  assert.equal(lookup(view.render(), `move-${key}`), undefined);
  assert.ok(lookup(view.render(), `move-picker-${key}`));
  click(view, `cancel-move-${key}`, cx);
  assert.equal(lookup(view.render(), `more-${key}`), undefined);
  view.hoveredPR = "other-row";
  hover(view, key, cx, false);
  assert.equal(view.hoveredPR, "other-row");
});

test("theme changes repaint an existing populated PR view and popup without changing saved organization", async () => {
  const { view, cx, mock } = await start(); seed(mock, "MERGED");
  folder(view, cx, "Retained"); click(view, "filter-All", cx);
  const key = prKey("Roblox/example", 1);
  view.prMenu = view.hoveredPR = key;
  const saved = structuredClone(mock.shared);
  const roles = ["background", "surface", "popover", "raised", "hover", "selected", "border", "input",
    "foreground", "muted", "dim", "accent", "ansi5", "blocked"];
  for (const [paper, ink] of [["#17191d", "#eeeeef"], ["#c0c0c0", "#000000"]]) {
    mock.palette = { ...Object.fromEntries(roles.map(role => [role, paper])), background: "#010203", foreground: ink, muted: ink };
    const root = view.render();
    assert.deepEqual(root.methods.bg, [paper]);
    assert.deepEqual(lookup(root, `open-${key}`).methods.text_color, [ink]);
    assert.ok(lookup(root, `move-${key}`));
    const colors = [];
    const visit = node => {
      if (typeof node === "string") return;
      for (const method of ["bg", "text_color", "border_color"]) if (node.methods[method]) colors.push(...node.methods[method]);
      if (node.methods.hover) visit(node.methods.hover[0](element()));
      node.items.forEach(visit);
    };
    visit(root);
    assert.ok(colors.every(color => Object.values(mock.palette).includes(color)));
    assert.ok(!colors.includes(mock.palette.background), "terminal background must not paint UI surfaces");
    assert.deepEqual(mock.shared, saved);
  }
});

test("review box and PR menu run reviewpr in a pr-review tab without touching saved organization", async () => {
  const { view, cx, mock } = await start(); seed(mock);
  const key = prKey("Roblox/example", 1);
  const saved = structuredClone(mock.shared);
  view.review.set_value("  "); view.review.handlers.submit({}, cx);
  assert.deepEqual(mock.runs, []);
  view.review.set_value("first line\nsecond"); view.review.handlers.submit({ shift: true }, cx);
  assert.deepEqual(mock.runs, []);
  assert.equal(view.review.value(), "first line\nsecond");
  view.review.handlers.submit({}, cx);
  assert.equal(mock.runs.at(-1)[1].argv.at(-1), "first line\nsecond");
  view.review.set_value("look at the cache change"); click(view, "send-review", cx);
  assert.deepEqual(mock.runs.at(-1), ["space.new", { name: "pr-review", tab: "Review: look at the cache change",
    folder: "/Users/me/Planning/pr-review", argv: ["zsh", "-ic", 'reviewpr "$1"', "reviewpr", "look at the cache change"], machine: "" }]);
  assert.equal(view.review.value(), "");
  mock.spaces = [{ id: "sp1", name: "pr-review", machine: null }];
  hover(view, key, cx); lookup(view.render(), `pr-actions-${key}`).methods.on_open_change[0](true, cx);
  click(view, `review-${key}`, cx);
  assert.deepEqual(mock.runs.at(-1), ["tab.new", { space: "sp1", name: "Review example #1",
    folder: "/Users/me/Planning/pr-review", argv: ["zsh", "-ic", 'reviewpr "$1"', "reviewpr", `https://${HOST}/Roblox/example/pull/1`] }]);
  assert.equal(view.prMenu, null);
  assert.deepEqual(mock.shared, saved);
});
