// Shape Todoist tasks into the Todo section's groups: a project by its sections (subtasks
// indented under their parents), Today as Overdue/Today, Upcoming by day, other views flat.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Todoist content is light Markdown; show the words.
export const plainTitle = text => String(text ?? "")
  .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
  .replace(/(\*\*|__|~~|`)/g, "")
  .replace(/\s+/g, " ").trim();

const dayStart = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// "2026-11-19" or "2026-11-19T15:30:00(Z)" as a local Date, and whether it has a time.
export function dueMoment(due) {
  const raw = due?.datetime ?? due?.date;
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(raw);
  if (!m) return null;
  const timed = m[4] != null;
  const date = timed && /Z|[+-]\d{2}:?\d{2}$/.test(raw) ? new Date(raw)
    : new Date(+m[1], +m[2] - 1, +m[3], timed ? +m[4] : 0, timed ? +m[5] : 0);
  return Number.isNaN(date.getTime()) ? null : { date, timed };
}

const clock = d => {
  const h = d.getHours() % 12 || 12, min = d.getMinutes();
  return `${h}${min ? `:${String(min).padStart(2, "0")}` : ""}${d.getHours() < 12 ? "am" : "pm"}`;
};

// A day relative to now: Today, Tomorrow, Yesterday, a weekday this week, else "Nov 21".
export function dayName(date, now = new Date()) {
  const diff = Math.round((dayStart(date) - dayStart(now)) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff > 1 && diff < 7) return DAYS[date.getDay()];
  const year = date.getFullYear() === now.getFullYear() ? "" : ` ${date.getFullYear()}`;
  return `${MONTHS[date.getMonth()]} ${date.getDate()}${year}`;
}

export function dueLabel(due, now = new Date()) {
  const moment = dueMoment(due);
  if (!moment) return null;
  const overdue = moment.timed ? moment.date < now : dayStart(moment.date) < dayStart(now);
  const text = `${dayName(moment.date, now)}${moment.timed ? ` ${clock(moment.date)}` : ""}${due.is_recurring ? " ↻" : ""}`;
  return { text, overdue };
}

const order = (a, b) => (a.child_order ?? 0) - (b.child_order ?? 0);
const dueTime = task => dueMoment(task.due)?.date.getTime() ?? Infinity;
// Due first (soonest), then priority (4 is p1), then Todoist's own order.
const byDue = (a, b) => dueTime(a) - dueTime(b) || (b.priority ?? 1) - (a.priority ?? 1) || (a.day_order ?? 0) - (b.day_order ?? 0) || order(a, b);

function item(task, depth, projects, now, showProject) {
  return {
    id: task.id,
    title: plainTitle(task.content) || "(untitled)",
    depth,
    priority: task.priority ?? 1,
    due: dueLabel(task.due, now),
    labels: task.labels ?? [],
    project: showProject ? projects.get(task.project_id)?.name ?? null : null,
    description: task.description ?? "",
    // For the editor: the raw Markdown title and Todoist's own words for the date.
    content: task.content ?? "",
    dueString: task.due?.string ?? "",
    recurring: Boolean(task.due?.is_recurring),
    parentId: task.parent_id ?? null
  };
}

// Parents before their children, siblings in Todoist order.
function tree(tasks) {
  const ids = new Set(tasks.map(t => t.id));
  const children = new Map();
  const roots = [];
  for (const task of tasks) {
    if (task.parent_id && ids.has(task.parent_id)) {
      if (!children.has(task.parent_id)) children.set(task.parent_id, []);
      children.get(task.parent_id).push(task);
    } else roots.push(task);
  }
  const out = [];
  const walk = (list, depth) => {
    for (const task of [...list].sort(order)) {
      out.push([task, depth]);
      walk(children.get(task.id) ?? [], depth + 1);
    }
  };
  walk(roots, 0);
  return out;
}

// A task and everything under it, as Todoist completes them together.
export function withDescendants(tasks, id) {
  const out = new Set([id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const t of tasks) if (t.parent_id && out.has(t.parent_id) && !out.has(t.id)) { out.add(t.id); grew = true; }
  }
  return out;
}

export function buildView({ view, tasks = [], sections = [], projects = [], now = new Date(), hidden = new Set() }) {
  const live = tasks.filter(t => !t.checked && !t.is_deleted && !hidden.has(t.id));
  const projectMap = new Map(projects.map(p => [p.id, p]));
  let groups;
  if (view.kind === "project" || view.kind === "inbox") {
    const sorted = [...sections].sort((a, b) => (a.section_order ?? 0) - (b.section_order ?? 0));
    const known = new Set(sorted.map(s => s.id));
    const rows = tree(live);
    const rowsIn = id => rows.filter(([t]) => (known.has(t.section_id) ? t.section_id : null) === id)
      .map(([t, depth]) => item(t, depth, projectMap, now, false));
    groups = [{ label: null, items: rowsIn(null) }, ...sorted.map(s => ({ label: s.name, items: rowsIn(s.id) }))];
  } else if (view.kind === "today") {
    const today = dayStart(now);
    const late = live.filter(t => { const m = dueMoment(t.due); return m && dayStart(m.date) < today; }).sort(byDue);
    const rest = live.filter(t => !late.includes(t)).sort(byDue);
    groups = [
      ...(late.length ? [{ label: "Overdue", items: late.map(t => item(t, 0, projectMap, now, true)) }] : []),
      { label: late.length ? "Today" : null, items: rest.map(t => item(t, 0, projectMap, now, true)) }
    ];
  } else if (view.kind === "upcoming") {
    const today = dayStart(now);
    const byDay = new Map();
    for (const task of [...live].sort(byDue)) {
      const m = dueMoment(task.due);
      const label = !m ? "No date" : dayStart(m.date) < today ? "Overdue" : dayName(m.date, now);
      if (!byDay.has(label)) byDay.set(label, []);
      byDay.get(label).push(item(task, 0, projectMap, now, true));
    }
    groups = [...byDay].map(([label, items]) => ({ label, items }));
  } else {
    groups = [{ label: null, items: [...live].sort(byDue).map(t => item(t, 0, projectMap, now, true)) }];
  }
  groups = groups.filter((g, i) => g.items.length || (i === 0 && g.label === null));
  return { groups, open: groups.reduce((sum, g) => sum + g.items.length, 0) };
}

// Picker entries for projects, nested under their parents.
export function projectEntries(projects) {
  const ids = new Set(projects.map(p => p.id));
  const kids = new Map();
  const roots = [];
  for (const p of projects) {
    if (p.inbox_project) continue;
    if (p.parent_id && ids.has(p.parent_id)) {
      if (!kids.has(p.parent_id)) kids.set(p.parent_id, []);
      kids.get(p.parent_id).push(p);
    } else roots.push(p);
  }
  const out = [];
  const walk = (list, depth) => {
    for (const p of [...list].sort(order)) { out.push({ id: p.id, name: p.name, depth }); walk(kids.get(p.id) ?? [], depth + 1); }
  };
  walk(roots, 0);
  return out;
}

// Same view? Built-ins by kind; projects, labels and filters by id.
export const sameView = (a, b) => Boolean(a && b) && a.kind === b.kind &&
  (["today", "upcoming", "inbox"].includes(a.kind) || a.id === b.id);
