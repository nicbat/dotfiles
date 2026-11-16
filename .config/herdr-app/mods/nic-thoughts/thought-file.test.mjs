import test from "node:test";
import assert from "node:assert/strict";
import { appendThought, countToday, dayHeading, entry, formatDate, thoughtText } from "./thought-file.js";

const wed = new Date(2026, 10, 11, 14, 7);
const wedLater = new Date(2026, 10, 11, 9, 5);
const thu = new Date(2026, 10, 12, 0, 3);

test("headings and lines carry the day, weekday, 24-hour time, source and machine", () => {
  assert.equal(dayHeading(wed), "## 261111 · Wednesday");
  assert.equal(entry("ask Markus", wed, "work-mac"), "- [ ] 14:07 · ask Markus · herdr · work-mac");
  assert.equal(entry("x", wedLater, ""), "- [ ] 09:05 · x · herdr");
});

test("an empty note starts with today's heading", () => {
  assert.equal(appendThought("", "first", wed, "work-mac"),
    "## 261111 · Wednesday\n- [ ] 14:07 · first · herdr · work-mac\n");
  assert.equal(appendThought(null, "first", wed, "work-mac"),
    "## 261111 · Wednesday\n- [ ] 14:07 · first · herdr · work-mac\n");
});

test("thoughts on the same day go under the existing heading, at the bottom", () => {
  const one = appendThought("", "first", wed, "work-mac");
  const two = appendThought(one + "\n\n", "second", wedLater, "home-mac");
  assert.equal(two, "## 261111 · Wednesday\n- [ ] 14:07 · first · herdr · work-mac\n"
    + "- [ ] 09:05 · second · herdr · home-mac\n");
});

test("a new day starts a new heading after a blank line, keeping what was there", () => {
  const note = "# Notes I wrote myself\n\n## 261111 · Wednesday\n- [x] 14:07 · done · herdr · work-mac\n  more";
  assert.equal(appendThought(note, "next", thu, "work-mac"), note
    + "\n\n## 261112 · Thursday\n- [ ] 00:03 · next · herdr · work-mac\n");
});

test("multi-line thoughts indent their later lines under the task", () => {
  assert.equal(entry("one\r\ntwo  \n\nfour\n\n", wed, "work-mac"),
    "- [ ] 14:07 · one · herdr · work-mac\n  two\n\n  four");
});

test("blank thoughts change nothing", () => {
  assert.equal(thoughtText("  \n \n"), "");
  assert.equal(appendThought("keep\n", " \n", wed, "work-mac"), "keep\n");
});

test("today's count covers only today's task lines", () => {
  let note = appendThought("", "a", wed, "m");
  note = appendThought(note, "b\nc", wed, "m");
  note = appendThought(note, "c", thu, "m");
  assert.equal(countToday(note, wed), 2);
  assert.equal(countToday(note, thu), 1);
  assert.equal(countToday(note + "\n# Other\n- [ ] not a thought\n", thu), 1);
});

test("the date format is YYMMDD unless set, and takes YYYY, YY, MM and DD", () => {
  assert.equal(formatDate(wed), "261111");
  assert.equal(formatDate(wed, "YYYY-MM-DD"), "2026-11-11");
  assert.equal(formatDate(new Date(2009, 0, 2), "DD/MM/YY"), "02/01/09");
  assert.equal(formatDate(wed, "  "), "261111");
  assert.equal(dayHeading(wed, "YYYY-MM-DD"), "## 2026-11-11 · Wednesday");
  const note = appendThought(appendThought("", "a", wed, "m", "YYYY-MM-DD"), "b", wed, "m", "YYYY-MM-DD");
  assert.equal(note, "## 2026-11-11 · Wednesday\n- [ ] 14:07 · a · herdr · m\n- [ ] 14:07 · b · herdr · m\n");
  assert.equal(countToday(note, wed, "YYYY-MM-DD"), 2);
});
