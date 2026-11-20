// The Todo section: the Obsidian note (obsidian-view.js) or Todoist (todoist-view.js),
// whichever the picker's Source chose on this machine (backend.js).
import { View, div } from "gpui-kit";
import { props, setShared } from "herdr";
import ObsidianTodo from "./obsidian-view.js";
import TodoistTodo from "./todoist-view.js";
import { backend } from "./backend.js";

const LINK = "nic.sidebar.todo-link";
// The desktop app's own link, else the web app.
const TODOIST_LINK = { icon: "mods/nic-todo/todoist.svg", title: "Open Todoist",
  urls: ["todoist://", "https://app.todoist.com/app"] };

export default class Todo extends View {
  init(_props, cx) {
    this.mount(cx);
    // Views can only be made outside render, so follow the shared choice on a short timer.
    cx.timer.every(400, cx => this.mount(cx));
  }

  mount(cx) {
    const kind = backend();
    if (kind === this.kind) return;
    this.view?.release();
    this.kind = kind;
    // The Todo header's open-the-app button (nic-sidebar-section's `link` prop).
    setShared(LINK, kind === "todoist" ? TODOIST_LINK : null);
    this.view = cx.new(kind === "todoist" ? TodoistTodo : ObsidianTodo, props() ?? {});
    cx.notify();
  }

  render() {
    return div().id("todo-backend").size_full().min_h(0).flex().flex_col().child(this.view);
  }
}
