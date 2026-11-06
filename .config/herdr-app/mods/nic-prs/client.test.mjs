import test from "node:test";
import assert from "node:assert/strict";
import { emptyState, normalizePR, mergeSnapshot, addFolder, movePR, prKey, HOST } from "./model.js";
import { discoverHosts, refreshPRs, olderPRs } from "./client.js";

const date = "2026-11-05T22:00:00Z";
const node = (number, state = "OPEN") => ({ id: `P${number}`, repository: { nameWithOwner: "Roblox/example" },
  number, title: `PR ${number}`, url: `https://${HOST}/Roblox/example/pull/${number}`, state, isDraft: false,
  updatedAt: date, closedAt: state === "OPEN" ? null : date, mergedAt: state === "MERGED" ? date : null,
  mergeable: "UNKNOWN", statusCheckRollup: null });
const page = (nodes, cursor = null, login = "nbatchelder") => ({ data: { viewer: { login,
  pullRequests: { nodes, totalCount: 300, pageInfo: { endCursor: cursor, hasNextPage: Boolean(cursor) } } } } });
function runner(responses, host = HOST) {
  const calls = [];
  const exec = async (program, args) => {
    calls.push([program, args]);
    assert.equal(program, "gh");
    assert.deepEqual(args.slice(0, 4), ["api", "--hostname", host, "graphql"]);
    assert.ok(args.find(arg => arg.startsWith("query=")).includes("query"));
    assert.ok(!args.find(arg => arg.startsWith("query=")).includes("mutation"));
    const result = responses.shift();
    assert.ok(result, "Unexpected API call");
    if (result instanceof Error) throw result;
    return result.code !== undefined ? result : { code: 0, stdout: JSON.stringify(result) };
  };
  return { exec, calls };
}

test("host discovery uses gh's explicit safe projection and offers only configured supported hosts", async () => {
  let calls = 0;
  const accounts = await discoverHosts(async (program, args) => {
    calls++;
    assert.equal(program, "gh");
    assert.deepEqual(args.slice(0, 7), ["auth", "status", "--active", "--json", "hosts", "--jq", '[.hosts | to_entries[] | {host: .key, login: (.value[] | select(.active == true) | .login)}]']);
    assert.ok(!args.includes("--show-token"));
    return { code: 0, stdout: JSON.stringify([{ host: "github.com", login: "nicbat" }, { host: "other.example", login: "other" }]) };
  });
  assert.deepEqual(accounts, [{ host: "github.com", login: "nicbat" }]);
  assert.equal(calls, 1);
  await assert.rejects(discoverHosts(async () => ({ code: 1, stdout: "" })), /gh accounts/);
});

test("personal refresh and history paging target github.com explicitly and reject an enterprise URL", async () => {
  const personalNode = { ...node(1), url: "https://github.com/Roblox/example/pull/1" };
  const { exec } = runner([page([personalNode], null, "nicbat"), page([], "older", "nicbat")], "github.com");
  const state = mergeSnapshot(emptyState("github.com"), await refreshPRs(exec, emptyState("github.com"), date));
  assert.equal(state.login, "nicbat");
  assert.ok(state.records[prKey("Roblox/example", 1, "github.com")]);
  const older = runner([page([], null, "nicbat")], "github.com");
  assert.equal((await olderPRs(older.exec, state)).host, "github.com");
  await assert.rejects(refreshPRs(runner([page([node(1)], null, "nicbat")], "github.com").exec, emptyState("github.com")), /invalid PR/);
});

test("discovers all authored open pages and recent merged/closed history through explicit enterprise queries", async () => {
  const { exec, calls } = runner([page([node(1)], "open-next"), page([node(2)]),
    page([node(3, "MERGED"), node(4, "CLOSED")], "history-next")]);
  const result = await refreshPRs(exec, emptyState(), date);
  assert.deepEqual(result.records.map(pr => pr.state), ["OPEN", "OPEN", "MERGED", "CLOSED"]);
  assert.ok(calls[1][1].includes("cursor=open-next"));
  assert.ok(calls[0][1].find(arg => arg.startsWith("query=")).includes("viewer"));
  assert.equal(result.history.cursor, "history-next");
});

test("disappearing open PR is explicitly confirmed merged while inaccessible PR stays open and marked unavailable", async () => {
  const state = emptyState(); state.login = "nbatchelder";
  for (const number of [1, 2]) { const pr = normalizePR(node(number), date); state.records[pr.key] = pr; }
  const { exec } = runner([page([]), page([]), { data: { nodes: [node(1, "MERGED"), null] } }]);
  const result = await refreshPRs(exec, state, date);
  const merged = mergeSnapshot(state, result);
  assert.equal(merged.records[prKey("Roblox/example", 1)].state, "MERGED");
  assert.equal(merged.records[prKey("Roblox/example", 2)].state, "OPEN");
  assert.equal(merged.records[prKey("Roblox/example", 2)].unavailable, true);
  assert.equal(state.records[prKey("Roblox/example", 2)].unavailable, false);
});

test("older pagination uses the saved cursor and deduplicates PRs without changing folders", async () => {
  const initial = { login: "nbatchelder", records: [normalizePR(node(1, "MERGED"), date)], observedAt: date,
    history: { cursor: "older", hasNext: true, total: 300 } };
  let state = mergeSnapshot(emptyState(), initial);
  state = movePR(addFolder(state, "Work", "work"), prKey("Roblox/example", 1), "work");
  const { exec, calls } = runner([page([node(1, "MERGED"), node(2, "CLOSED")])]);
  const next = mergeSnapshot(state, await olderPRs(exec, state, date), true);
  assert.equal(next.assignments[prKey("Roblox/example", 1)], "work");
  assert.equal(Object.keys(next.records).length, 2);
  assert.ok(calls[0][1].includes("cursor=older"));
  assert.equal(next.history.hasNext, false);
});

test("API failures, partial GraphQL errors and account changes leave saved data untouched", async () => {
  for (const response of [{ code: 1, stdout: "" }, { code: 0, stdout: "bad JSON" },
    { data: { viewer: {} }, errors: [{ message: "denied" }] }, page([], null, "different-login")]) {
    const state = { ...emptyState(), login: "nbatchelder" }, before = structuredClone(state);
    const { exec } = runner([response]);
    await assert.rejects(refreshPRs(exec, state, date));
    assert.deepEqual(state, before);
  }
});

test("pagination loops and mismatched identity responses fail without inventing PR state", async () => {
  const { exec } = runner([page([node(1)], "loop"), page([node(2)], "loop")]);
  await assert.rejects(refreshPRs(exec, emptyState(), date), /advance/);
  const state = emptyState(), pr = normalizePR(node(1), date); state.records[pr.key] = pr;
  const mismatch = runner([page([]), page([]), { data: { nodes: [node(2, "CLOSED")] } }]);
  await assert.rejects(refreshPRs(mismatch.exec, state, date), /different PR/);
  const stuck = { ...state, login: "nbatchelder", history: { initialized: true, cursor: "old", hasNext: true, total: 2 } };
  await assert.rejects(olderPRs(runner([page([], "old")]).exec, stuck, date), /advance/);
});
