// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { LlmProvider } from "../../providers/llmProvider";
import {
  buildSessionLetterMessages,
  createSessionLetterDraft,
  parseSessionLetterOutput
} from "./sessionLetter";

describe("session letter", () => {
  it("parses a fenced JSON letter output", () => {
    expect(
      parseSessionLetterOutput(`\`\`\`json
{
  "letterMd": "亲爱的你：\\n\\n我记得你说，自己总是在照顾别人的情绪。\\n\\n程灵"
}
\`\`\``)
    ).toEqual({
      letterMd: "亲爱的你：\n\n我记得你说，自己总是在照顾别人的情绪。\n\n程灵"
    });
  });

  it("rejects an empty letter", () => {
    expect(() => parseSessionLetterOutput(JSON.stringify({ letterMd: "" }))).toThrow("session letter missing letterMd");
  });

  it("normalizes double-escaped newlines returned by a model", () => {
    expect(parseSessionLetterOutput(JSON.stringify({
      letterMd: String.raw`给你：\n\n谢谢你今天愿意停下来。\n\n程灵`
    }))).toEqual({
      letterMd: "给你：\n\n谢谢你今天愿意停下来。\n\n程灵"
    });
  });

  it("accepts a plain Markdown letter when the model omits the JSON wrapper", () => {
    expect(parseSessionLetterOutput("谢谢你愿意直接说出来。\n\n周舟")).toEqual({
      letterMd: "谢谢你愿意直接说出来。\n\n周舟"
    });
  });

  it("still rejects malformed output that starts like JSON", () => {
    expect(() => parseSessionLetterOutput('{"letterMd":"未完成')).toThrow();
  });

  it("combines the frozen counselor core with the letter task and keeps references in material", () => {
    const messages = buildSessionLetterMessages({
      counselorId: "chengling",
      counselorName: "程灵",
      counselorCorePrompt: "# 冻结的程灵核心\n\n程灵温柔、慢、重视主体性。",
      counselorVoicePrompt: "# 冻结的程灵语言风格\n\n自然、松弛、有关系感。",
      clientDisplayName: "小满",
      sessionConceptualization: {
        id: "conceptualization-s1",
        sessionId: "s1",
        counselorId: "chengling",
        modelName: "deepseek-v4-pro",
        fullMd: "# 后台个案概念化\n\n不要直接给用户看。",
        status: "ready",
        createdAt: "2026-07-06T10:00:00.000Z",
        updatedAt: "2026-07-06T10:00:00.000Z"
      },
      sessionMessages: [
        {
          id: "m1",
          sessionId: "s1",
          role: "user",
          content: "我好像总是先照顾别人。",
          createdAt: "2026-07-06T10:00:00.000Z",
          status: "sent"
        }
      ]
    });

    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("冻结的程灵核心");
    expect(messages[0].content).toContain("当前场景｜会谈后来信");
    expect(messages[0].content.indexOf("当前场景｜会谈后来信")).toBeLessThan(
      messages[0].content.indexOf("冻结的程灵语言风格")
    );
    expect(messages[0].content.trimEnd().endsWith("自然、松弛、有关系感。")).toBe(true);
    expect(messages[0].content).toContain("这些材料只是写信依据");
    expect(messages[0].content).toContain("不使用“展信安”");
    expect(messages[0].content).toContain("未给出称呼时");
    expect(messages[0].content).toContain("关系位置始终是咨询师与来访者");
    expect(messages[0].content).toContain("不使用“亲爱的”“宝贝”“抱抱”");
    expect(messages[1].content).toContain("来访者称呼：小满");
    expect(messages[1].content).not.toContain("程灵温柔、慢、重视主体性。");
    expect(messages[1].content).toContain("后台个案概念化");
    expect(messages[1].content).toContain("user: 我好像总是先照顾别人。");
    expect(messages[1].content).toContain("来信不能暴露其中的专业术语");
  });

  it("calls the provider and returns a ready letter draft", async () => {
    const provider: LlmProvider = {
      complete: async () => ({
        content: JSON.stringify({
          letterMd: "亲爱的你：\n\n我听见你今天说到疲惫。\n\n程灵"
        })
      }),
      stream: async function* () {
        yield { type: "status", status: "done" };
      }
    };

    await expect(
      createSessionLetterDraft({
        provider,
        sessionId: "s1",
        counselorId: "chengling",
        counselorName: "程灵",
        counselorCorePrompt: "冻结的程灵核心。",
        clientDisplayName: "小满",
        sessionMessages: [],
        modelName: "deepseek-v4-pro",
        now: "2026-07-06T10:10:00.000Z"
      })
    ).resolves.toEqual({
      id: "session-letter-s1",
      sessionId: "s1",
      counselorId: "chengling",
      modelName: "deepseek-v4-pro",
      letterMd: "小满：\n\n我听见你今天说到疲惫。\n\n程灵",
      status: "ready",
      createdAt: "2026-07-06T10:10:00.000Z",
      updatedAt: "2026-07-06T10:10:00.000Z"
    });
  });

  it("removes a model-generated generic salutation when no profile name is set", async () => {
    const provider: LlmProvider = {
      complete: async () => ({ content: JSON.stringify({ letterMd: "亲爱的你：\n\n我听见你今天说到疲惫。\n\n程灵" }) }),
      stream: async function* () { yield { type: "status", status: "done" }; }
    };

    const letter = await createSessionLetterDraft({
      provider,
      sessionId: "s2",
      counselorId: "chengling",
      counselorName: "程灵",
      sessionMessages: [],
      modelName: "deepseek-v4-pro",
      now: "2026-07-06T10:10:00.000Z"
    });

    expect(letter.letterMd).toBe("我听见你今天说到疲惫。\n\n程灵");
  });

  it.each(["小满", undefined])("cleans a model's leaked address label before saving (name: %s)", async (clientDisplayName) => {
    const provider: LlmProvider = {
      complete: async () => ({ content: JSON.stringify({ letterMd: "用户称呼：小满\n我听见你今天说到疲惫。\n\n程灵" }) }),
      stream: async function* () { yield { type: "status", status: "done" }; }
    };
    const letter = await createSessionLetterDraft({
      provider,
      sessionId: "s3",
      counselorId: "chengling",
      counselorName: "程灵",
      clientDisplayName,
      sessionMessages: [],
      modelName: "test-model"
    });
    expect(letter.letterMd).toBe(`${clientDisplayName ? "小满：\n\n" : ""}我听见你今天说到疲惫。\n\n程灵`);
  });
});
