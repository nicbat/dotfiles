// Todoist API v1 (https://developer.todoist.com/api/v1).
// The API key lives in the system keychain, never in dotfiles or Herdr's state:
// macOS Keychain (`security`) or, on Linux, the Secret Service keyring (`secret-tool`).
// Paste it into the Todo section once and Herdr saves it there; by hand it is
//   macOS: security add-generic-password -s herdr-todoist -a todoist -w
//   Linux: secret-tool store --label="Herdr Todoist API key" service herdr-todoist account todoist
// `request`/`exec`/`writeFile` are injected so tests run without the network or a keychain.

export const BASE = "https://api.todoist.com/api/v1";
export const KEYCHAIN_SERVICE = "herdr-todoist";
const ACCOUNT = "todoist";
const LABEL = "Herdr Todoist API key";
export const ADD_KEY_COMMAND = `security add-generic-password -s ${KEYCHAIN_SERVICE} -a ${ACCOUNT} -w`;
export const LINUX_ADD_KEY_COMMAND = `secret-tool store --label="${LABEL}" service ${KEYCHAIN_SERVICE} account ${ACCOUNT}`;
export const NO_SECRET_TOOL = "Saving the key needs secret-tool and a running keyring: install libsecret-tools " +
  "(Debian/Ubuntu) or libsecret (Fedora/Arch), with GNOME Keyring or KeePassXC's Secret Service.";
const MAX_PAGES = 25;

export class TodoistError extends Error {
  constructor(message, kind) { super(message); this.kind = kind; }
}

// Herdr reports "macos" (Rust's name); Node says "darwin".
export const isMac = os => os === "macos" || os === "darwin";
const firstLine = text => String(text ?? "").trim().split("\n")[0].slice(0, 160);

// The key, or null when none is saved. `security` exits 44 when the item is missing;
// `secret-tool lookup` exits 1 with no output.
export async function readKey(exec, os) {
  if (isMac(os)) {
    const result = await exec("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"], { timeout: 10000 });
    if (result.code === 0) return result.stdout.trim() || null;
    if (result.code === 44) return null;
    throw new TodoistError("Couldn't read the Todoist key from the Keychain.", "keychain");
  }
  let result;
  try { result = await exec("secret-tool", ["lookup", "service", KEYCHAIN_SERVICE, "account", ACCOUNT], { timeout: 10000 }); }
  catch (_) { throw new TodoistError(NO_SECRET_TOOL, "nokeystore"); }
  if (result.code === 0 && result.stdout.trim()) return result.stdout.trim();
  if (!result.stderr.trim()) return null;
  throw new TodoistError(`Couldn't read the keyring: ${firstLine(result.stderr)}`, "keychain");
}

// Saves (or replaces) the key. On Linux it reaches secret-tool through a file in a
// private (0700) folder, removed at once, so it never appears in a process list.
// macOS `security` only takes it as an argument; macOS shows a process's arguments
// only to the same user, and it exits immediately.
export async function saveKey(exec, os, key, { writeFile, folder }) {
  if (isMac(os)) {
    const result = await exec("security", ["add-generic-password", "-U", "-s", KEYCHAIN_SERVICE, "-a", ACCOUNT,
      "-l", LABEL, "-w", key], { timeout: 15000 });
    if (result.code !== 0) throw new TodoistError(`Couldn't save to the Keychain: ${firstLine(result.stderr)}`, "keychain");
    return;
  }
  const file = `${folder}/key`;
  const made = await exec("install", ["-d", "-m", "700", folder]);
  if (made.code !== 0) throw new TodoistError(`Couldn't prepare a private folder: ${firstLine(made.stderr)}`, "keychain");
  let result;
  try {
    await writeFile(file, key);
    result = await exec("sh", ["-c", `secret-tool store --label="${LABEL}" service ${KEYCHAIN_SERVICE} account ${ACCOUNT} < "$1"`,
      "sh", file], { timeout: 15000 });
  } catch (_) {
    throw new TodoistError(NO_SECRET_TOOL, "nokeystore");
  } finally {
    await exec("rm", ["-f", file]).catch(() => {});
  }
  if (result.code === 127) throw new TodoistError(NO_SECRET_TOOL, "nokeystore");
  if (result.code !== 0) throw new TodoistError(`Couldn't save to the keyring: ${firstLine(result.stderr)}`, "keychain");
}

function query(params) {
  const parts = Object.entries(params).filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

async function send(request, key, path, options = {}) {
  let response;
  try {
    response = await request(`${BASE}${path}`, { ...options,
      headers: { Authorization: `Bearer ${key}`, ...(options.headers ?? {}) } });
  } catch (error) { throw new TodoistError(`Couldn't reach Todoist: ${error.message}`, "network"); }
  if (response.status === 401 || response.status === 403)
    throw new TodoistError("Todoist rejected the saved API key. Paste a new one below.", "auth");
  if (response.status === 429) throw new TodoistError("Todoist is rate limiting; trying again shortly.", "rate");
  if (!response.ok) {
    let detail = "";
    try { detail = (await response.text()).slice(0, 160); } catch (_) {}
    throw new TodoistError(`Todoist answered ${response.status}${detail ? `: ${detail}` : ""}`, "http");
  }
  return response.status === 204 ? null : response.json();
}

const json = (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// Edits: only the fields given change. Todoist priority 4 is p1 (urgent), 1 is p4.
export const updateTask = (request, key, id, patch) => send(request, key, `/tasks/${encodeURIComponent(id)}`, json("POST", patch));
export const closeTask = (request, key, id) => send(request, key, `/tasks/${encodeURIComponent(id)}/close`, { method: "POST" });
export const reopenTask = (request, key, id) => send(request, key, `/tasks/${encodeURIComponent(id)}/reopen`, { method: "POST" });
// Quick Add parses dates, #project, /section, @labels and p1–p4 the way Todoist's apps do.
export const quickAdd = (request, key, text) => send(request, key, "/tasks/quick", json("POST", { text }));

const escapeName = name => String(name).replace(/\\/g, "\\\\").replace(/ /g, "\\ ");
// The typed text plus where the current view puts it: a project (and the chosen section)
// or a label, unless the text names its own project.
export function addText(text, view, { project, section } = {}) {
  const typed = text.trim();
  const tokens = [];
  if (view.kind === "project" && project && !/(^|\s)#\S/.test(typed)) {
    tokens.push(`#${escapeName(project)}`);
    if (section) tokens.push(`/${escapeName(section)}`);
  }
  if (view.kind === "label" && !new RegExp(`(^|\\s)@${view.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(typed))
    tokens.push(`@${view.name}`);
  return [typed, ...tokens].join(" ");
}

// Every page of a paginated GET.
export async function getAll(request, key, path, params = {}) {
  const results = [];
  let cursor = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await send(request, key, `${path}${query({ ...params, limit: 200, cursor })}`);
    results.push(...(body?.results ?? []));
    cursor = body?.next_cursor ?? null;
    if (!cursor) return results;
  }
  return results;
}

// Saved filters only come through the Sync endpoint.
export async function getFilters(request, key) {
  const body = await send(request, key, "/sync", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `sync_token=*&resource_types=${encodeURIComponent('["filters"]')}`
  });
  return (body?.filters ?? []).filter(f => !f.is_deleted)
    .sort((a, b) => (a.item_order ?? 0) - (b.item_order ?? 0));
}

// Projects, saved filters and labels for the picker.
export async function loadCatalog(request, key) {
  const [projects, filters, labels] = await Promise.all([
    getAll(request, key, "/projects"),
    getFilters(request, key),
    getAll(request, key, "/labels")
  ]);
  return {
    projects: projects.filter(p => !p.is_archived && !p.is_deleted),
    filters: filters.map(f => ({ id: f.id, name: f.name, query: f.query })),
    labels: labels.filter(l => !l.is_deleted).sort((a, b) => (a.item_order ?? 0) - (b.item_order ?? 0))
      .map(l => ({ id: l.id, name: l.name }))
  };
}

// Built-in views, as Todoist filter queries.
export const BUILT_IN = {
  today: { kind: "today", name: "Today", query: "today | overdue" },
  upcoming: { kind: "upcoming", name: "Upcoming", query: "overdue | next 7 days" },
  inbox: { kind: "inbox", name: "Inbox" }
};

// The tasks (and, for a project, its sections) one view shows.
export async function loadView(request, key, view, catalog) {
  if (view.kind === "inbox" || view.kind === "project") {
    const projectId = view.kind === "inbox" ? catalog?.projects.find(p => p.inbox_project)?.id : view.id;
    if (!projectId) throw new TodoistError("Couldn't find that project in Todoist.", "missing");
    const [tasks, sections] = await Promise.all([
      getAll(request, key, "/tasks", { project_id: projectId }),
      getAll(request, key, "/sections", { project_id: projectId })
    ]);
    return { tasks, sections: sections.filter(s => !s.is_archived && !s.is_deleted) };
  }
  if (view.kind === "label") return { tasks: await getAll(request, key, "/tasks", { label: view.name }), sections: [] };
  if (!view.query) throw new TodoistError("That view has no filter query.", "missing");
  return { tasks: await getAll(request, key, "/tasks/filter", { query: view.query }), sections: [] };
}

export const taskUrl = id => `https://app.todoist.com/app/task/${encodeURIComponent(id)}`;
export const appUrl = id => `todoist://task?id=${encodeURIComponent(id)}`;

// Opens a task in the Todoist desktop app, or the web app when no app takes todoist:// links.
export async function openTask(exec, os, id) {
  const opener = isMac(os) ? "open" : "xdg-open";
  try {
    const app = await exec(opener, [appUrl(id)], { timeout: 10000 });
    if (app.code === 0) return "app";
  } catch (_) { /* no opener: try the web below */ }
  const web = await exec(opener, [taskUrl(id)], { timeout: 10000 });
  if (web.code !== 0) throw new TodoistError(`Couldn't open the task: ${firstLine(web.stderr)}`, "open");
  return "web";
}
