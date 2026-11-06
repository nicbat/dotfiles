import { HOST, HOSTS, normalizePR } from "./model.js";

export async function discoverHosts(exec) {
  // gh projects only host/login fields; never request tokens or read auth files.
  const result = await exec("gh", ["auth", "status", "--active", "--json", "hosts", "--jq",
    '[.hosts | to_entries[] | {host: .key, login: (.value[] | select(.active == true) | .login)}]']);
  if (result.code !== 0) throw new Error("Could not read gh accounts. Sign in with gh auth login, then refresh.");
  let accounts;
  try { accounts = JSON.parse(result.stdout); } catch (_) { throw new Error("Could not read gh accounts. Refresh to try again."); }
  if (!Array.isArray(accounts)) throw new Error("Could not read gh accounts. Refresh to try again.");
  return accounts.filter(account => HOSTS.includes(account?.host) && typeof account.login === "string" && account.login);
}

const FIELDS = `id number title url state isDraft updatedAt closedAt mergedAt
  repository { nameWithOwner } reviewDecision mergeable statusCheckRollup { state }`;
const query = (states, size) => `query($cursor: String) { viewer { login pullRequests(first: ${size},
  after: $cursor, states: ${states}, orderBy: {field: UPDATED_AT, direction: DESC}) {
  totalCount pageInfo { hasNextPage endCursor } nodes { ${FIELDS} } } } }`;

export async function api(exec, queryText, cursor, host = HOST) {
  if (!HOSTS.includes(host)) throw new Error("Unsupported GitHub host");
  const args = ["api", "--hostname", host, "graphql", "-f", `query=${queryText}`];
  if (cursor != null) args.push("-f", `cursor=${cursor}`);
  const result = await exec("gh", args);
  if (result.code !== 0) throw new Error(`GitHub refresh failed. Check gh access to ${host}; saved PRs are retained.`);
  let data;
  try { data = JSON.parse(result.stdout); } catch (_) { throw new Error("GitHub returned unreadable data; saved PRs are retained."); }
  if (data.errors?.length || !data.data) throw new Error("GitHub could not return PR data; saved PRs are retained.");
  return data.data;
}

function page(data, expectedLogin, observedAt, host) {
  const viewer = data.viewer, connection = viewer?.pullRequests;
  if (!viewer?.login || (expectedLogin && expectedLogin !== viewer.login))
    throw new Error("GitHub account changed; saved PR organization has been kept.");
  if (!Array.isArray(connection?.nodes) || typeof connection?.pageInfo?.hasNextPage !== "boolean" ||
      !Number.isInteger(connection.totalCount) ||
      (connection.pageInfo.hasNextPage && typeof connection.pageInfo.endCursor !== "string"))
    throw new Error("GitHub returned incomplete PR data; saved PRs are retained.");
  return { host, login: viewer.login, records: connection.nodes.map(node => normalizePR(node, observedAt, host)),
    history: { cursor: connection.pageInfo.endCursor ?? null, hasNext: connection.pageInfo.hasNextPage, total: connection.totalCount }, observedAt };
}

export async function refreshPRs(exec, state, observedAt = new Date().toISOString()) {
  let cursor = null, login = state.login;
  const records = [], seen = new Set();
  do {
    const result = page(await api(exec, query("[OPEN]", 100), cursor, state.host), login, observedAt, state.host);
    login = result.login;
    records.push(...result.records);
    const next = result.history.hasNext ? result.history.cursor : null;
    if (next && seen.has(next)) throw new Error("GitHub pagination did not advance; saved PRs are retained.");
    if (next) seen.add(next);
    cursor = next;
  } while (cursor);
  const recent = page(await api(exec, query("[MERGED, CLOSED]", 50), null, state.host), login, observedAt, state.host);
  records.push(...recent.records);
  const found = new Set(records.map(pr => pr.key));
  const missing = Object.values(state.records).filter(pr => pr.state === "OPEN" && !found.has(pr.key));
  const unavailable = [];
  // Read missing open PRs by identity: absence from a list never establishes a merge.
  for (let offset = 0; offset < missing.length; offset += 50) {
    const batch = missing.slice(offset, offset + 50);
    const data = await api(exec, `query { nodes(ids: ${JSON.stringify(batch.map(pr => pr.id))}) {
      ... on PullRequest { ${FIELDS} } } }`, null, state.host);
    if (!Array.isArray(data.nodes) || data.nodes.length !== batch.length) throw new Error("GitHub returned incomplete PR identities; saved PRs are retained.");
    data.nodes.forEach((node, i) => {
      if (node === null) unavailable.push(batch[i].key);
      else {
        const pr = normalizePR(node, observedAt, state.host);
        if (pr.key !== batch[i].key) throw new Error("GitHub returned a different PR identity; saved PRs are retained.");
        records.push(pr);
      }
    });
  }
  return { host: state.host, login, records, unavailable, history: recent.history, observedAt };
}

export async function olderPRs(exec, state, observedAt = new Date().toISOString()) {
  if (!state.history.hasNext) return null;
  const result = page(await api(exec, query("[MERGED, CLOSED]", 50), state.history.cursor, state.host), state.login, observedAt, state.host);
  if (result.history.hasNext && result.history.cursor === state.history.cursor)
    throw new Error("GitHub pagination did not advance; saved PRs are retained.");
  return result;
}
