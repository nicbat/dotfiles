export const HOST = "github.rbx.com";
export const STORE = "nic.prs.v1";
export const HOSTS = ["github.com", HOST];
export const HOST_STORE = "nic.prs.host";
// Keep the original enterprise store in place, preserving all existing folders.
export const storeKey = host => host === HOST ? STORE : `${STORE}:${host}`;
export function selectedHost(saved, available, hasEnterpriseData = false) {
  if (available.includes(saved)) return saved;
  if (hasEnterpriseData && available.includes(HOST)) return HOST;
  return available.includes("github.com") ? "github.com" : available[0] ?? null;
}
export const FILTERS = ["Open", "Merged", "Closed", "All"];
export const cleanName = value => value.replace(/[\r\n]+/g, " ").trim().slice(0, 100);
export const prKey = (repo, number, host = HOST) => `${host}/${repo.toLowerCase()}#${number}`;

export function emptyState(host = HOST) {
  return { version: 1, host, login: null, folders: [], assignments: {}, records: {},
    filter: "Open", refreshedAt: null, history: { initialized: false, cursor: null, hasNext: false, total: 0 } };
}

export function loadState(raw, host = HOST) {
  if (!HOSTS.includes(host)) throw new Error("Unsupported GitHub host");
  if (raw == null) return emptyState(host);
  const state = JSON.parse(JSON.stringify(raw));
  if (state.version !== 1 || state.host !== host || !Array.isArray(state.folders) ||
      !state.assignments || !state.records || !state.history || !FILTERS.includes(state.filter) ||
      !(state.login === null || typeof state.login === "string") ||
      ![state.assignments, state.records, state.history].every(value => typeof value === "object" && !Array.isArray(value)))
    throw new Error("Unrecognized PR data");
  const ids = new Set();
  for (const folder of state.folders) {
    if (!folder || typeof folder.id !== "string" || !folder.id || ids.has(folder.id) ||
        typeof folder.name !== "string" || !folder.name.trim() || typeof folder.collapsed !== "boolean")
      throw new Error("Invalid folder data");
    ids.add(folder.id);
  }
  for (const [key, folder] of Object.entries(state.assignments)) {
    if (!key.startsWith(`${host}/`) || !ids.has(folder)) throw new Error("Invalid PR assignment");
  }
  for (const [key, pr] of Object.entries(state.records)) {
    if (!pr || typeof pr.repository !== "string" || !Number.isInteger(pr.number) || pr.number < 1 ||
        key !== prKey(pr.repository, pr.number, host) || pr.key !== key || typeof pr.title !== "string" ||
        typeof pr.id !== "string" || typeof pr.isDraft !== "boolean" || !["OPEN", "MERGED", "CLOSED"].includes(pr.state) ||
        ![pr.updatedAt, pr.closedAt, pr.mergedAt, pr.observedAt].every(value => value == null || typeof value === "string") ||
        pr.url !== `https://${host}/${pr.repository}/pull/${pr.number}`)
      throw new Error("Invalid PR record");
  }
  if (!(state.refreshedAt === null || typeof state.refreshedAt === "string") ||
      typeof state.history.initialized !== "boolean" || typeof state.history.hasNext !== "boolean" ||
      !(state.history.cursor === null || typeof state.history.cursor === "string") ||
      !Number.isInteger(state.history.total) || state.history.total < 0)
    throw new Error("Invalid history data");
  return state;
}

export function normalizePR(node, observedAt, host = HOST) {
  const repository = node?.repository?.nameWithOwner;
  if (typeof repository !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(repository) ||
      !Number.isInteger(node.number) || node.number < 1 || typeof node.id !== "string" ||
      typeof node.title !== "string" || !["OPEN", "MERGED", "CLOSED"].includes(node.state) ||
      !HOSTS.includes(host) || node.url !== `https://${host}/${repository}/pull/${node.number}`)
    throw new Error("GitHub returned an invalid PR");
  // A merge date is explicit evidence of merging, even if a host reports CLOSED.
  const state = node.mergedAt ? "MERGED" : node.state;
  return { key: prKey(repository, node.number, host), id: node.id, repository, number: node.number,
    title: node.title, url: node.url, state, isDraft: node.isDraft === true,
    updatedAt: node.updatedAt, closedAt: node.closedAt, mergedAt: node.mergedAt,
    review: node.reviewDecision ?? null, checks: node.statusCheckRollup?.state ?? null,
    mergeable: node.mergeable ?? "UNKNOWN", observedAt, unavailable: false };
}

export function mergeSnapshot(state, snapshot, older = false) {
  if (snapshot.host && snapshot.host !== state.host) throw new Error("GitHub host changed; saved PR organization has been kept.");
  if (state.login && state.login !== snapshot.login) throw new Error(`Saved PRs belong to ${state.login}; GitHub is signed in as ${snapshot.login}.`);
  const next = loadState(state, state.host);
  next.login = snapshot.login;
  for (const pr of snapshot.records) next.records[pr.key] = pr;
  for (const key of snapshot.unavailable ?? []) {
    if (next.records[key]) next.records[key].unavailable = true;
  }
  if (older || !next.history.initialized) {
    next.history.cursor = snapshot.history.cursor;
    next.history.hasNext = snapshot.history.hasNext;
  }
  next.history.initialized = true;
  next.history.total = snapshot.history.total;
  if (!older) next.refreshedAt = snapshot.observedAt;
  return next;
}

export function addFolder(state, name, id) {
  name = cleanName(name);
  if (!name || !id || state.folders.some(folder => folder.id === id)) return state;
  return { ...state, folders: [...state.folders, { id, name, collapsed: false }] };
}
export function updateFolder(state, id, patch) {
  if (patch.name !== undefined && !cleanName(patch.name)) return state;
  return { ...state, folders: state.folders.map(folder => folder.id === id ?
    { ...folder, ...patch, ...(patch.name !== undefined ? { name: cleanName(patch.name) } : {}) } : folder) };
}
export function deleteFolder(state, id) {
  return { ...state, folders: state.folders.filter(folder => folder.id !== id),
    assignments: Object.fromEntries(Object.entries(state.assignments).filter(([, folder]) => folder !== id)) };
}
export function reorderFolder(state, id, direction) {
  const folders = [...state.folders], from = folders.findIndex(folder => folder.id === id), to = from + direction;
  if (from < 0 || to < 0 || to >= folders.length) return state;
  [folders[from], folders[to]] = [folders[to], folders[from]];
  return { ...state, folders };
}
export function movePR(state, key, folder) {
  if (!state.records[key] || (folder !== null && !state.folders.some(item => item.id === folder))) return state;
  const assignments = { ...state.assignments };
  if (folder === null) delete assignments[key]; else assignments[key] = folder;
  return { ...state, assignments };
}
export function visiblePRs(state, folder, query = "") {
  query = query.trim().toLowerCase();
  return Object.values(state.records).filter(pr =>
    (state.assignments[pr.key] ?? null) === folder &&
    (state.filter === "All" || pr.state === state.filter.toUpperCase()) &&
    (!query || `${pr.title} ${pr.repository} #${pr.number}`.toLowerCase().includes(query)))
    .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0) || a.key.localeCompare(b.key));
}
export function statusText(pr) {
  if (pr.state === "MERGED") return `Merged${pr.mergedAt ? ` · ${pr.mergedAt.slice(0, 10)}` : ""}`;
  if (pr.state === "CLOSED") return `Closed${pr.closedAt ? ` · ${pr.closedAt.slice(0, 10)}` : ""}`;
  const parts = [pr.isDraft ? "Draft" : pr.review === "APPROVED" ? "Approved" :
    pr.review === "CHANGES_REQUESTED" ? "Changes requested" : pr.review === "REVIEW_REQUIRED" ? "Waiting for review" : "Open"];
  parts.push(({ SUCCESS: "Checks passed", FAILURE: "Checks failed", ERROR: "Check error", PENDING: "Checks pending", EXPECTED: "Checks expected" })[pr.checks] ?? "Checks unknown");
  if (pr.mergeable === "CONFLICTING") parts.push("Conflicts");
  if (pr.unavailable) parts.push("Unavailable");
  return parts.join(" · ");
}
