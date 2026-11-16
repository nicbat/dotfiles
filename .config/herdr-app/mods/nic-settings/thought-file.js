// The Thought Stream note: one `## <date> · Weekday` heading per day, and
// under it one task line per thought, appended at the bottom:
//   - [ ] 14:07 · the thought · herdr · work-mac
// Further lines of a multi-line thought are indented under its task line.

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const pad = n => String(n).padStart(2, "0");

export const SOURCE = "herdr";
export const DATE_FORMAT = "YYMMDD";

// YYYY, YY, MM and DD in the format become the date's parts; the rest is kept.
export function formatDate(d, format = DATE_FORMAT) {
  const parts = { YYYY: String(d.getFullYear()), YY: pad(d.getFullYear() % 100), MM: pad(d.getMonth() + 1), DD: pad(d.getDate()) };
  return (format?.trim() || DATE_FORMAT).replace(/YYYY|YY|MM|DD/g, token => parts[token]);
}

export const dayHeading = (d, format) => `## ${formatDate(d, format)} · ${WEEKDAYS[d.getDay()]}`;

export const clock = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

// What was typed, without trailing spaces or blank lines at either end.
export function thoughtText(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").split("\n")
    .map(line => line.replace(/\s+$/, "")).join("\n").replace(/^\n+|\n+$/g, "");
}

export function entry(thought, d, machine) {
  const [first, ...rest] = thoughtText(thought).split("\n");
  const fields = [clock(d), first, SOURCE, machine?.trim()].filter(Boolean).join(" · ");
  return [`- [ ] ${fields}`, ...rest.map(line => line ? `  ${line}` : "")].join("\n");
}

const lastHeading = text => text.split("\n").filter(line => /^## /.test(line)).pop()?.trimEnd() ?? null;

// The note with the thought added at the bottom, under today's heading; the
// heading is started when the note's last `##` heading is not today's.
export function appendThought(text, thought, d, machine, format) {
  if (!thoughtText(thought)) return text ?? "";
  const body = (text ?? "").replace(/\s+$/, "");
  const heading = dayHeading(d, format);
  const head = lastHeading(body) === heading ? [body] : body ? [body, "", heading] : [heading];
  return [...head, entry(thought, d, machine)].join("\n") + "\n";
}

// How many thoughts sit under today's heading.
export function countToday(text, d, format) {
  const heading = dayHeading(d, format);
  let inToday = false, count = 0;
  for (const line of (text ?? "").split("\n")) {
    if (/^#{1,2} /.test(line)) inToday = line.trimEnd() === heading;
    else if (inToday && /^- \[[ xX]\] /.test(line)) count++;
  }
  return count;
}
