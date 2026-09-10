import { describe, expect, it } from "vitest";
import {
  formatSessionLetterMarkdown,
  isSessionLetterSalutation,
  splitSessionLetterParagraphs
} from "./sessionLetterText";

describe("session letter text", () => {
  it.each([
    "用户称呼：小满",
    "来访者称呼: 小满",
    "称呼：小满",
    "**用户称呼：** 小满",
    "### 来访者称呼：小满",
    "小满：\n\n用户称呼：小满",
    "小满：\n\n旧名字："
  ])("replaces leaked or duplicate opening %s with the configured name", (opening) => {
    const body = "我听见你今天说到疲惫。\n\n程灵";
    const formatted = formatSessionLetterMarkdown(`${opening}\n\n${body}`, "小满", "zh-CN");
    expect(formatted).toBe(`小满：\n\n${body}`);
    expect(formatSessionLetterMarkdown(formatted, "小满", "zh-CN")).toBe(formatted);
  });

  it("removes a label without a configured name and preserves the body after a single newline", () => {
    expect(formatSessionLetterMarkdown("用户称呼：小满\r\n我听见你今天说到疲惫。", undefined, "zh-CN"))
      .toBe("我听见你今天说到疲惫。");
  });

  it("preserves mentions of labels and names inside the body", () => {
    const body = "你提到，看到以下文字会感到陌生。\n\n用户称呼：小满\n\n我们停在了这里。";
    expect(formatSessionLetterMarkdown(body, undefined, "zh-CN")).toBe(body);
  });

  it("does not duplicate a saved English salutation on repeated formatting", () => {
    const body = "I remember the pause today.\n\nCheng Ling";
    const formatted = formatSessionLetterMarkdown(`Client's preferred form of address: Alex\n${body}`, "Alex", "en-US");
    expect(formatted).toBe(`Alex,\n\n${body}`);
    expect(formatSessionLetterMarkdown(formatted, "Alex", "en-US")).toBe(formatted);
  });

  it("removes a generic salutation when no profile name is set", () => {
    expect(formatSessionLetterMarkdown("亲爱的你：\n\n这次会谈里，你只说了短短一句。", "", "zh-CN"))
      .toBe("这次会谈里，你只说了短短一句。");
  });

  it("adds the configured form of address as a flush-left first line", () => {
    expect(splitSessionLetterParagraphs("这次会谈里，你只说了短短一句。", " 小满 ", "zh-CN"))
      .toEqual(["小满：", "这次会谈里，你只说了短短一句。"]);
    expect(isSessionLetterSalutation("小满：")).toBe(true);
  });

  it("uses English letter punctuation without an intimate greeting", () => {
    expect(formatSessionLetterMarkdown("Dear you,\n\nI remember the pause today.", "Alex", "en-US"))
      .toBe("Alex,\n\nI remember the pause today.");
  });
});
