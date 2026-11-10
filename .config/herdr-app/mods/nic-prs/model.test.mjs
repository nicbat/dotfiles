import test from "node:test";
import assert from "node:assert/strict";
import { HOST, STORE, storeKey, selectedHost, emptyState, loadState, normalizePR, prKey, mergeSnapshot, addFolder,
  updateFolder, deleteFolder, reorderFolder, movePR, visiblePRs, statusText, reviewLaunch } from "./model.js";

const date = "2026-11-05T22:00:00Z";
const node = (repo = "Roblox/example", number = 1, patch = {}) => ({ id: `${repo}:${number}`, repository: { nameWithOwner: repo },
  number, title: "Useful change", url: `https://${HOST}/${repo}/pull/${number}`, state: "OPEN", isDraft: false,
  updatedAt: date, mergedAt: null, closedAt: null, reviewDecision: "REVIEW_REQUIRED", statusCheckRollup: { state: "SUCCESS" }, ...patch });
const snapshot = nodes => ({ login: "nbatchelder", records: nodes.map(n => normalizePR(n, date)), observedAt: date,
  history: { cursor: "older", hasNext: true, total: 300 } });

test("enterprise storage remains compatible; personal identities and snapshots stay separate", () => {
  const enterprise = movePR(addFolder(mergeSnapshot(emptyState(), snapshot([node()])), "Model Routing", "routing"), prKey("Roblox/example", 1), "routing");
  assert.equal(storeKey(HOST), STORE);
  assert.deepEqual(loadState(enterprise, HOST), enterprise);
  const personalNode = node(undefined, undefined, { url: "https://github.com/Roblox/example/pull/1" });
  const personal = mergeSnapshot(emptyState("github.com"), {
    ...snapshot([]), host: "github.com", login: "nicbat", records: [normalizePR(personalNode, date, "github.com")]
  });
  assert.notEqual(storeKey("github.com"), STORE);
  assert.deepEqual(loadState(personal, "github.com").folders, []);
  assert.notEqual(Object.keys(personal.records)[0], Object.keys(enterprise.records)[0]);
  assert.throws(() => loadState(enterprise, "github.com"));
  assert.throws(() => mergeSnapshot(enterprise, { ...snapshot([]), host: "github.com" }), /host changed/);
});

test("host choice honors local preference and existing enterprise data but defaults to personal access", () => {
  assert.equal(selectedHost(null, ["github.com"], true), "github.com");
  assert.equal(selectedHost(HOST, ["github.com"], true), "github.com");
  assert.equal(selectedHost(null, [HOST, "github.com"], true), HOST);
  assert.equal(selectedHost(null, [HOST, "github.com"]), "github.com");
  assert.equal(selectedHost("github.com", [HOST, "github.com"], true), "github.com");
  assert.equal(selectedHost(null, []), null);
});

test("folder assignments survive merge, close, reopen and serialization; same numbers stay distinct", () => {
  let state = mergeSnapshot(emptyState(), snapshot([node(), node("Roblox/other")]));
  const first = prKey("Roblox/example", 1), other = prKey("Roblox/other", 1);
  state = addFolder(state, " RM3\nwork ", "rm3");
  state = movePR(state, first, "rm3");
  state = mergeSnapshot(state, snapshot([node(undefined, undefined, { state: "MERGED", mergedAt: date }),
    node("Roblox/other", 1, { state: "CLOSED", closedAt: date })]));
  state = loadState(JSON.parse(JSON.stringify(state)));
  assert.equal(state.assignments[first], "rm3");
  assert.equal(state.assignments[other], undefined);
  assert.equal(visiblePRs({ ...state, filter: "Merged" }, "rm3").length, 1);
  assert.equal(visiblePRs({ ...state, filter: "Closed" }, null).length, 1);
  assert.equal(visiblePRs(state, "rm3").length, 0);
  state = mergeSnapshot(state, snapshot([node()]));
  assert.equal(visiblePRs(state, "rm3").length, 1);
  assert.equal(state.folders[0].name, "RM3 work");
  assert.equal(state.records[other].state, "CLOSED");
});

test("rename, collapse, reorder, deletion and invalid moves preserve the PR records", () => {
  let state = mergeSnapshot(emptyState(), snapshot([node()]));
  state = addFolder(addFolder(state, "First", "a"), "Second", "b");
  state = movePR(state, prKey("Roblox/example", 1), "a");
  state = updateFolder(state, "a", { name: "Réviser 工作", collapsed: true });
  state = reorderFolder(state, "a", 1);
  assert.deepEqual(state.folders.map(f => f.id), ["b", "a"]);
  const records = structuredClone(state.records);
  assert.equal(movePR(state, "missing", "a"), state);
  assert.equal(movePR(state, prKey("Roblox/example", 1), "missing"), state);
  state = deleteFolder(state, "a");
  assert.deepEqual(state.records, records);
  assert.deepEqual(state.assignments, {});
  assert.equal(visiblePRs(state, null).length, 1);
});

test("history pagination is retained during refresh and empty results cannot erase retained PRs", () => {
  let state = mergeSnapshot(emptyState(), snapshot([node()]));
  state = mergeSnapshot(state, { ...snapshot([]), history: { cursor: "next-page", hasNext: true, total: 310 } }, true);
  state = mergeSnapshot(state, { ...snapshot([]), history: { cursor: "first-page", hasNext: true, total: 311 } });
  assert.equal(state.history.cursor, "next-page");
  assert.equal(Object.keys(state.records).length, 1);
  assert.throws(() => mergeSnapshot(state, { ...snapshot([]), login: "someone-else" }), /belong/);
});

test("filters and search operate within folders and empty folders survive", () => {
  let state = mergeSnapshot(emptyState(), snapshot([node(), node("Roblox/other", 2, { title: "Fix lint", state: "CLOSED", closedAt: date })]));
  state = addFolder(state, "Empty", "empty");
  assert.equal(visiblePRs({ ...state, filter: "All" }, null).length, 2);
  assert.equal(visiblePRs({ ...state, filter: "All" }, null, "OTHER #2").length, 1);
  assert.equal(visiblePRs({ ...state, filter: "Closed" }, null, "lint").length, 1);
  assert.equal(visiblePRs(state, "empty").length, 0);
  assert.equal(state.folders.length, 1);
});

test("invalid or future saved data and unexpected host URLs cannot be accepted", () => {
  for (const raw of [{}, { ...emptyState(), version: 2 }, { ...emptyState(), filter: "Ready" },
    { ...emptyState(), folders: [{ id: "x", name: "one", collapsed: false }, { id: "x", name: "two", collapsed: false }] },
    { ...emptyState(), assignments: { "github.rbx.com/roblox/example#1": "missing" } },
    { ...emptyState(), refreshedAt: 42 }]) assert.throws(() => loadState(raw));
  assert.throws(() => normalizePR(node(undefined, undefined, { url: "https://github.com/Roblox/example/pull/1" }), date));
});

test("status text preserves unknowns and distinguishes drafts, approvals, conflicts and historical outcomes", () => {
  const pr = normalizePR(node(), date);
  assert.equal(statusText(pr), "Waiting for review · Checks passed");
  assert.equal(statusText({ ...pr, review: "APPROVED", checks: "PENDING" }), "Approved · Checks pending");
  assert.equal(statusText({ ...pr, isDraft: true, review: null, checks: null }), "Draft · Checks unknown");
  assert.match(statusText({ ...pr, checks: "FAILURE", mergeable: "CONFLICTING" }), /Checks failed · Conflicts/);
  assert.equal(statusText(normalizePR(node(undefined, undefined, { state: "CLOSED", mergedAt: date }), date)), "Merged · 2026-11-05");
});

test("review launch reuses only the local pr-review space and quotes the prompt as one argument", () => {
  const prompt = "it's $HOME; `x`";
  assert.equal(reviewLaunch("   ", [], "/h"), null);
  assert.deepEqual(reviewLaunch(prompt, [{ id: "r", name: "pr-review", machine: "vps" }], "/h")[0], "space.new");
  const [command, args] = reviewLaunch(` ${prompt} `, [{ id: "a", name: "other" }, { id: "r", name: "pr-review", machine: null }], "/h");
  assert.equal(command, "tab.new");
  assert.equal(args.space, "r");
  assert.equal(args.folder, "/h/Planning/pr-review");
  assert.deepEqual(args.argv.slice(-1), [prompt]);
});
