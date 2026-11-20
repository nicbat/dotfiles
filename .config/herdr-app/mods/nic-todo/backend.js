// Which list the Todo section shows on this machine: the Obsidian note or Todoist.
// Kept in Herdr's shared.json (per machine, outside dotfiles).
import { shared, setShared } from "herdr";
import { menuItem, menuRule, menuHeading } from "./menu-ui.js";

export const BACKEND = "nic.todo.backend";
export const backend = () => shared(BACKEND) === "todoist" ? "todoist" : "obsidian";

// The picker's Source rows, shared by both views.
export function sourceItems(t, done) {
  const pick = name => cx => { if (backend() !== name) setShared(BACKEND, name); done?.(cx); };
  return [
    menuHeading("Source", t),
    menuItem("source-obsidian", { label: "Obsidian note", checked: backend() === "obsidian" }, pick("obsidian"), t),
    menuItem("source-todoist", { label: "Todoist", checked: backend() === "todoist" }, pick("todoist"), t),
    menuRule(t)
  ];
}
