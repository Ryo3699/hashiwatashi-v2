import { describe, expect, it, vi } from "vitest";
import { ClaudeFatalError, ClaudeReplyError, createRealClient, FakeClaude, isFatalClaudeError, type JsonRequest, type MessagesApi } from "../lib/claude";
import { getApiKey } from "../lib/config";

const req = {
  model: "m",
  system: "s",
  messages: [{ role: "user" as const, content: "u" }],
  schema: { type: "object" },
};

describe("FakeClaude", () => {
  it("決まった返事を順に返し、依頼を記録する", async () => {
    const f = new FakeClaude([{ a: 1 }, { a: 2 }]);
    expect(await f.json(req)).toEqual({ a: 1 });
    expect(await f.json(req)).toEqual({ a: 2 });
    expect(f.calls).toHaveLength(2);
    await expect(f.json(req)).rejects.toThrow("返事が足りません");
  });

  it("返事が関数なら依頼を渡して作る／repeatLast／全体が関数", async () => {
    const f = new FakeClaude([(r: JsonRequest, i: number) => ({ echo: r.system, i })]);
    expect(await f.json(req)).toEqual({ echo: "s", i: 0 });
    const g = new FakeClaude([{ k: 1 }], { repeatLast: true });
    await g.json(req);
    expect(await g.json(req)).toEqual({ k: 1 });
    const h = new FakeClaude((_r, i) => ({ n: i }));
    expect(await h.json(req)).toEqual({ n: 0 });
    expect(await h.json(req)).toEqual({ n: 1 });
  });
});

describe("createRealClient（SDK は偽物を差し込む・本物は呼ばない）", () => {
  const sdkReturning = (text: string, seen: Record<string, unknown>[] = []): MessagesApi => ({
    messages: {
      async create(params) {
        seen.push(params);
        return { content: [{ type: "text", text }], stop_reason: "end_turn" };
      },
    },
  });

  it("構造化出力（json_schema）で依頼し、JSON を返す", async () => {
    const seen: Record<string, unknown>[] = [];
    const c = createRealClient(sdkReturning('{"action":"ask","text":"x"}', seen));
    expect(await c.json(req)).toEqual({ action: "ask", text: "x" });
    expect(seen[0]).toMatchObject({
      model: "m",
      system: "s",
      output_config: { format: { type: "json_schema", schema: { type: "object" } } },
    });
  });

  it("空・JSONでない返事は例外", async () => {
    await expect(createRealClient(sdkReturning("")).json(req)).rejects.toThrow("空");
    await expect(createRealClient(sdkReturning("はい")).json(req)).rejects.toThrow("JSON");
  });

  it("鍵は環境変数 ANTHROPIC_API_KEY だけ。無ければ例外（import しただけでは読まない）", () => {
    expect(() => getApiKey({} as NodeJS.ProcessEnv)).toThrow("ANTHROPIC_API_KEY");
    expect(getApiKey({ ANTHROPIC_API_KEY: "k" } as unknown as NodeJS.ProcessEnv)).toBe("k");
    expect(() => createRealClient()).not.toThrow();
  });

  it("effort を渡すと output_config に入る（format と同じ所）。thinking は送らない", async () => {
    const seen: Record<string, unknown>[] = [];
    const c = createRealClient(sdkReturning('{"a":1}', seen));
    await c.json({ ...req, effort: "low", maxTokens: 4000 });
    expect(seen[0]).toMatchObject({ max_tokens: 4000, output_config: { effort: "low", format: { type: "json_schema" } } });
    expect(seen[0]).not.toHaveProperty("thinking");
    await c.json(req);
    expect((seen[1].output_config as Record<string, unknown>).effort).toBeUndefined();
  });

  it("途中で切れた（max_tokens）・断られた（refusal）返事は、理由のわかる例外", async () => {
    const sdkStop = (stop: string, text: string): MessagesApi => ({
      messages: { create: async () => ({ content: [{ type: "text", text }], stop_reason: stop }) },
    });
    const cut = createRealClient(sdkStop("max_tokens", '{"action":"ask","text":"乾かした'));
    await expect(cut.json(req)).rejects.toThrow("max_tokens");
    await expect(cut.json(req)).rejects.toBeInstanceOf(ClaudeReplyError);
    const refused = createRealClient(sdkStop("refusal", ""));
    await expect(refused.json(req)).rejects.toThrow("refusal");
    await expect(refused.json(req)).rejects.toBeInstanceOf(ClaudeReplyError);
  });

  it("空・JSONでない返事も ClaudeReplyError。鍵が無いのは ClaudeFatalError（作り直しても直らない）", async () => {
    await expect(createRealClient(sdkReturning("")).json(req)).rejects.toBeInstanceOf(ClaudeReplyError);
    await expect(createRealClient(sdkReturning("はい")).json(req)).rejects.toBeInstanceOf(ClaudeReplyError);
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    try {
      await expect(createRealClient().json(req)).rejects.toBeInstanceOf(ClaudeFatalError);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("isFatalClaudeError：fatal と 400/401/403/404 だけ", () => {
    expect(isFatalClaudeError(new ClaudeFatalError("x"))).toBe(true);
    expect(isFatalClaudeError(Object.assign(new Error("x"), { status: 401 }))).toBe(true);
    expect(isFatalClaudeError(Object.assign(new Error("x"), { status: 529 }))).toBe(false);
    expect(isFatalClaudeError(new ClaudeReplyError("x"))).toBe(false);
    expect(isFatalClaudeError(new Error("x"))).toBe(false);
  });
});
