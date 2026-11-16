// Thoughts: capture a line (or several) into an Obsidian note, under a heading
// for the day, with the time, "herdr" and this machine's name. The note and the
// machine name (and the date's format) are per-machine settings, set in Workspace settings (⌘⇧,).

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, TextareaState, Textarea } from "gpui-base";
import { theme, props, shared, setShared, home, run, readTextFile, writeTextFile, settings } from "herdr";
import { appendThought, countToday, clock, thoughtText, DATE_FORMAT } from "./thought-file.js";

const art = name => `mods/workspace-chrome/${name}.svg`;
// Kept in Herdr's shared.json, outside dotfiles, so each machine has its own.
const SOURCE = "nic.thoughts.source";
const COUNT = "nic.sidebar.thoughts-today";
const defaultPath = () => `${home()}/Documents/Obsidian Vault/Thought Stream.md`;
const fileName = path => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");

export default class Thoughts extends View {
  init(_props, cx) {
    this.queue = Promise.resolve();
    this.input = TextareaState.new({ placeholder: "A thought…", value: localStorage.getItem("draft") ?? "" });
    this.input.set_auto_grow(2, 8);
    this.input.on("change", () => localStorage.setItem("draft", this.input.value()));
    // Shift+Enter keeps the textarea's newline; Enter or Cmd+Enter saves.
    this.input.on("submit", (event, cx) => { if (!event?.shift) this.save(cx); });
    this.refresh(cx);
    // The day changes, and the note may change elsewhere: recount now and then.
    cx.timer.every(60000, cx => this.refresh(cx));
  }

  source() {
    const saved = shared(SOURCE);
    return { path: saved?.path || defaultPath(), machine: saved?.machine?.trim() || "", dateFormat: saved?.dateFormat || DATE_FORMAT };
  }

  publish(text) {
    const count = countToday(text, new Date(), this.source().dateFormat);
    if (shared(COUNT) !== count) setShared(COUNT, count);
  }

  refresh(cx) {
    cx.spawn(async cx => {
      const text = await readTextFile(this.source().path).catch(() => null);
      this.publish(text);
      cx.notify();
    });
  }

  // Saves run one at a time, in their own task so they can outlive the keypress.
  // A note edited meanwhile (Obsidian, Sync) is re-read and the thought added again.
  save(cx) {
    const thought = thoughtText(this.input.value());
    if (!thought) return;
    const prior = this.queue;
    let done;
    this.queue = new Promise(resolve => { done = resolve; });
    this.input.set_value("");
    localStorage.setItem("draft", "");
    cx.spawn(async cx => {
      try { await prior; await this.write(thought, cx); }
      finally { done(); }
    });
    return this.queue;
  }

  async write(thought, cx) {
    const { path, machine, dateFormat } = this.source();
    const when = new Date();
    try {
      for (let attempt = 0; ; attempt++) {
        const base = await readTextFile(path);
        const next = appendThought(base, thought, when, machine, dateFormat);
        try { await writeTextFile(path, next, base); this.publish(next); break; }
        catch (error) { if (attempt) throw error; }
      }
      this.error = null;
      this.saved = clock(when);
    } catch (error) {
      // Give the thought back rather than lose it.
      const draft = thoughtText(this.input.value());
      this.input.set_value(draft ? `${thought}\n${draft}` : thought);
      localStorage.setItem("draft", this.input.value());
      this.error = `Couldn't save to ${fileName(path)}: ${error.message}`;
      this.saved = null;
    }
    cx.notify();
  }

  render() {
    const t = theme();
    const narrow = (this.width ?? 268) < 160;
    const { path, machine } = this.source();
    return v_flex().id("thoughts-root").size_full().min_h(0).pl(narrow ? 4 : 9).pr(narrow ? 4 : 12).pb(8).gap(5).bg(t.chrome)
      .on_size_change((size, cx) => {
        const wasNarrow = (this.width ?? 268) < 160;
        this.width = size.width;
        const key = `nic.sidebar.height.${props()?.section ?? "thoughts-section"}`;
        const height = size.height / (Number(settings().zoom) || 1) + 30; // layout px are unzoomed
        if (shared(key) !== height) setShared(key, height);
        if (wasNarrow !== (size.width < 160)) cx.notify();
      })
      .when(!narrow, el => el
        .child(h_flex().id("thoughts-source").h(22).flex_none().min_w(0).gap(4).pl(5).pr(6).items_center()
          .rounded(4).cursor_pointer().text_size(11).text_color(t.muted).tooltip(`${path} — change in Workspace settings`)
          .hover(el => el.text_color(t.foreground))
          .on_click(() => run("mod.open", { name: "nic-settings" }))
          .child(div().min_w(0).truncate().child(`${fileName(path)} · ${machine || "name this machine…"}`))
          .child(svg(art("settings")).size(10).flex_none()))
        .child(Textarea.new(this.input).w_full().px(8).py(5).rounded(5).border_1()
          .border_color(t.input).bg(t.surface).text_color(t.foreground).text_size(12))
        .child(div().pl(3).text_size(10).whitespace_normal()
          .text_color(this.error ? t.foreground : t.muted)
          .child(this.error ?? (this.saved ? `Saved at ${this.saved}` : "Enter saves · Shift+Enter for a new line"))));
  }
}
