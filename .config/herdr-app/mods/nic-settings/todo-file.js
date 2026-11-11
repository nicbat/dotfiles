// Read and edit an Obsidian todo note: `# Heading` sections, `## Label` groups and
// top-level `- [ ]` items. Every edit changes only the lines it is about; the rest
// of the note (notes, nested lines, other sections) is kept byte for byte.

export const ARCHIVE = "Archive";
const H1 = /^#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;
const H2 = /^##[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;
const ITEM = /^([-*+]) \[([ xX])\][ \t]+(.*?)[ \t]*$/;
const DONE_DATE = /[ \t]+✅[ \t]*\d{4}-\d{2}-\d{2}$/;
const FENCE = /^[ \t]*(```|~~~)/;

export const titleText = value => value.replace(/[\r\n]+/g, " ").trim();
const isArchive = name => name.toLowerCase() === ARCHIVE.toLowerCase();
const split = text => {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  return { eol, lines: text.split(eol) };
};

export function parseTodos(text) {
  const { lines } = split(text);
  const sections = [];
  let section = null, label = null, fenced = false, start = 0;
  if (lines[0] === "---") {
    const close = lines.indexOf("---", 1);
    if (close > 0) start = close + 1;
  }
  const closeLabel = end => { if (label) label.end = end; };
  const closeSection = end => { closeLabel(end); if (section) section.end = end; };
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    let match;
    if ((match = line.match(H1))) {
      closeSection(i);
      section = { name: match[1], line: i, end: lines.length, archive: isArchive(match[1]), labels: [], items: [] };
      label = null;
      sections.push(section);
    } else if (section && (match = line.match(H2))) {
      closeLabel(i);
      label = { name: match[1], line: i, end: lines.length };
      section.labels.push(label);
    } else if (section && (match = line.match(ITEM))) {
      let end = i + 1;
      while (end < lines.length && /^[ \t]+\S/.test(lines[end])) end++;
      section.items.push({ line: i, end, bullet: match[1], done: match[2] !== " ",
        title: match[3].replace(DONE_DATE, ""), raw: line, label: label?.name ?? null });
    }
  }
  closeSection(lines.length);
  for (const s of sections) {
    const seen = new Map();
    for (const item of s.items) {
      const base = `${s.name}\u0000${item.label ?? ""}\u0000${item.raw}`;
      const nth = seen.get(base) ?? 0;
      seen.set(base, nth + 1);
      Object.assign(item, { section: s.name, nth, key: `${base}\u0000${nth}` });
    }
  }
  return { sections };
}

export const headings = text => parseTodos(text).sections.filter(s => !s.archive).map(s => s.name)
  .filter((name, i, all) => all.indexOf(name) === i);

// What the Todo section shows for one heading.
export function viewOf(text, heading) {
  const { sections } = parseTodos(text);
  const section = sections.find(s => !s.archive && s.name === heading);
  const archive = sections.find(s => s.archive);
  const open = section?.items.filter(item => !item.done) ?? [];
  const groups = [{ label: null, items: open.filter(item => item.label === null) },
    ...(section?.labels ?? []).filter((l, i, all) => all.findIndex(o => o.name === l.name) === i)
      .map(l => ({ label: l.name, items: open.filter(item => item.label === l.name) }))];
  const archived = [...(section?.items.filter(item => item.done) ?? []),
    ...(archive?.items.filter(item => item.label === heading).reverse() ?? [])];
  return { found: Boolean(section), groups, archived, open: open.length };
}

function find(text, key) {
  for (const s of parseTodos(text).sections) for (const item of s.items) if (item.key === key) return item;
  throw new Error("That todo changed in the note. The list has been reloaded.");
}

const join = (lines, eol) => lines.join(eol);
function splice(text, at, remove, insert) {
  const { eol, lines } = split(text);
  lines.splice(at, remove, ...insert);
  return join(lines, eol);
}
// The last line of real content in [from, to), so additions sit with their group, not after blank lines.
function contentEnd(lines, from, to) {
  let end = to;
  while (end > from && !lines[end - 1].trim()) end--;
  return end;
}

function insertUnlabeled(text, heading, block) {
  const { eol, lines } = split(text);
  const section = parseTodos(text).sections.find(s => !s.archive && s.name === heading);
  if (!section) {
    const end = contentEnd(lines, 0, lines.length);
    const add = [...(end ? [""] : []), `# ${heading}`, ...block];
    lines.splice(end, 0, ...add);
    return join(lines, eol);
  }
  const limit = section.labels[0]?.line ?? section.end;
  const last = section.items.filter(item => item.line < limit).at(-1);
  lines.splice(last ? last.end : section.line + 1, 0, ...block);
  return join(lines, eol);
}

function insertArchived(text, heading, block) {
  const { eol, lines } = split(text);
  const archive = parseTodos(text).sections.find(s => s.archive);
  if (!archive) {
    const end = contentEnd(lines, 0, lines.length);
    lines.splice(end, 0, ...(end ? [""] : []), `# ${ARCHIVE}`, `## ${heading}`, ...block);
    return join(lines, eol);
  }
  const group = archive.labels.find(l => l.name === heading);
  if (group) lines.splice(contentEnd(lines, group.line + 1, group.end), 0, ...block);
  else {
    const end = contentEnd(lines, archive.line + 1, archive.end);
    lines.splice(end, 0, ...(end > archive.line + 1 ? [""] : []), `## ${heading}`, ...block);
  }
  return join(lines, eol);
}

const blockOf = (text, item) => split(text).lines.slice(item.line, item.end);
const removeBlock = (text, item) => splice(text, item.line, item.end - item.line, []);
const inArchive = item => isArchive(item.section);
// The heading an item belongs to: its own, or for an archived item the `##` it was filed under.
const homeOf = item => inArchive(item) ? item.label ?? "Inbox" : item.section;
const itemLine = (item, done, title) => `${item.bullet} [${done ? "x" : " "}] ${title}`;

export function addTodo(text, heading, title) {
  return insertUnlabeled(text, heading, [`- [ ] ${title}`]);
}

// Completing moves an item into `# Archive` → `## <heading>` with the date it was done.
// Reopening an archived item returns it to its heading, unlabeled. An item ticked
// in place (in Obsidian) is simply unticked where it is.
export function setDone(text, key, done, date) {
  const item = find(text, key);
  const [, ...children] = blockOf(text, item);
  const archived = inArchive(item);
  if (done) {
    if (item.done) return text;
    return insertArchived(removeBlock(text, item), item.section, [`${itemLine(item, true, item.title)} ✅ ${date}`, ...children]);
  }
  if (!item.done) return text;
  if (!archived) return splice(text, item.line, 1, [itemLine(item, false, item.title)]);
  return insertUnlabeled(removeBlock(text, item), homeOf(item), [itemLine(item, false, item.title), ...children]);
}

export function editTodo(text, key, title) {
  const item = find(text, key);
  const date = item.raw.match(DONE_DATE)?.[0] ?? "";
  return splice(text, item.line, 1, [`${itemLine(item, item.done, title)}${date}`]);
}

export function removeTodo(text, key) {
  const item = find(text, key);
  const next = removeBlock(text, item);
  return { text: next, undo: { after: next, line: item.line, block: blockOf(text, item), heading: homeOf(item) } };
}

// Put a deleted item back exactly where it was; if the note changed since, add it under its heading.
export function restoreTodo(text, undo) {
  if (text === undo.after) return splice(text, undo.line, 0, undo.block);
  return insertUnlabeled(text, undo.heading, undo.block);
}
