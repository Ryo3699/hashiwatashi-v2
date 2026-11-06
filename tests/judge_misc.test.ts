// 審査用リンク：Redis の口・使った量の記録・モデルの上書き・画面のエラー文。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shownOr, ShownError, throwIfShown } from "../lib/api-error";
import { createRealClient, type MessagesApi, type Usage } from "../lib/claude";
import { MODELS } from "../lib/config";
import { costUsd, lastDays } from "../lib/usage";
import { recordUsage } from "../server/claude";
import { kv, memoryKvEntry, resetMemoryKv } from "../server/kv";
import { jstDay } from "../server/public";
import { clearJudgeEnv, restoreJudgeEnv } from "./judge_env";

beforeEach(() => {
  clearJudgeEnv();
  resetMemoryKv();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  restoreJudgeEnv();
});

describe("server/kv.ts", () => {
  it("REST：get / set / incrMany の送り方と読み方", async () => {
    process.env.KV_REST_API_URL = "https://r.example.invalid";
    process.env.KV_REST_API_TOKEN = "TKN";
    const calls: { url: string; body: unknown; auth: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as string[][];
        calls.push({ url, body, auth: (init.headers as Record<string, string>).Authorization });
        return Response.json(
          body.map((c) => (c[0] === "GET" ? { result: c[1] === "none" ? null : "値" } : c[0] === "INCRBY" ? { result: 42 } : c[0] === "INCR" ? { result: 7 } : { result: "OK" })),
        );
      }),
    );
    expect(await kv.get("k")).toBe("値");
    expect(await kv.get("none")).toBeNull();
    await kv.set("k", "v", 60);
    expect(await kv.incrMany([{ key: "a", ttlSec: 10 }, { key: "b", ttlSec: 20, by: 5 }])).toEqual([7, 42]);
    expect(calls.every((c) => c.url === "https://r.example.invalid/pipeline" && c.auth === "Bearer TKN")).toBe(true);
    expect(calls[2].body).toEqual([["SET", "k", "v", "EX", "60"]]);
    expect(calls[3].body).toEqual([
      ["SET", "a", "0", "EX", "10", "NX"],
      ["INCR", "a"],
      ["SET", "b", "0", "EX", "20", "NX"],
      ["INCRBY", "b", "5"],
    ]);
  });

  it("3秒の時間切れを付けて送る", async () => {
    process.env.KV_REST_API_URL = "https://r.example.invalid";
    process.env.KV_REST_API_TOKEN = "T";
    const fetchMock = vi.fn(async (_u: string, _i: RequestInit) => Response.json([{ result: null }]));
    vi.stubGlobal("fetch", fetchMock);
    await kv.get("k");
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("エラーの文に鍵が入らない", async () => {
    process.env.KV_REST_API_URL = "https://r.example.invalid";
    process.env.KV_REST_API_TOKEN = "TOKEN-SECRET-123";
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("connect https://r.example.invalid Bearer TOKEN-SECRET-123"); }));
    await expect(kv.get("k")).rejects.toThrow(/KV/);
    await kv.get("k").catch((e: Error) => expect(e.message).not.toContain("TOKEN-SECRET-123"));
  });

  it("memory：数える・期限で消える・同じ期限は最初に作った時だけ", async () => {
    process.env.HASHI_KV = "memory";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-08T00:00:00Z"));
    expect(await kv.incrMany([{ key: "c", ttlSec: 100 }])).toEqual([1]);
    vi.setSystemTime(new Date("2026-11-08T00:00:50Z"));
    expect(await kv.incrMany([{ key: "c", ttlSec: 100 }])).toEqual([2]);
    expect(memoryKvEntry("c")!.ttlSec).toBe(50); // 付け直さない
    vi.setSystemTime(new Date("2026-11-08T00:02:00Z"));
    expect(await kv.get("c")).toBeNull();
    expect(await kv.incrMany([{ key: "c", ttlSec: 100 }])).toEqual([1]);
  });

  it("設定が無い・Vercel 上の memory は投げる", async () => {
    await expect(kv.get("k")).rejects.toThrow("KV の設定");
    process.env.HASHI_KV = "memory";
    process.env.VERCEL = "1";
    await expect(kv.get("k")).rejects.toThrow("Vercel");
  });
});

describe("使った量の記録", () => {
  const sdkWith = (usage: unknown): MessagesApi => ({
    messages: { create: async () => ({ content: [{ type: "text", text: '{"a":1}' }], stop_reason: "end_turn", ...(usage ? { usage } : {}) }) },
  });
  const req = { model: "claude-sonnet-5-5", system: "s", messages: [{ role: "user" as const, content: "x" }], schema: {} };

  it("onUsage が呼ばれ、トークンが渡る。無ければ今と同じ", async () => {
    const seen: Usage[] = [];
    const c = createRealClient(sdkWith({ input_tokens: 120, output_tokens: 30 }), { onUsage: (u) => void seen.push(u) });
    expect(await c.json(req)).toEqual({ a: 1 });
    expect(seen).toEqual([{ model: "claude-sonnet-5-5", input_tokens: 120, output_tokens: 30 }]);
    expect(await createRealClient(sdkWith({ input_tokens: 1, output_tokens: 1 })).json(req)).toEqual({ a: 1 });
  });

  it("記録が失敗しても会話は止まらない", async () => {
    const c = createRealClient(sdkWith({ input_tokens: 1, output_tokens: 1 }), {
      onUsage: async () => {
        throw new Error("redis down");
      },
    });
    expect(await c.json(req)).toEqual({ a: 1 });
  });

  it("recordUsage：日付・モデルごとに in / out を足す。入れ物が落ちていても投げない", async () => {
    process.env.HASHI_KV = "memory";
    await recordUsage({ model: "claude-opus-5-5", input_tokens: 100, output_tokens: 20 });
    await recordUsage({ model: "claude-opus-5-5", input_tokens: 50, output_tokens: 5 });
    expect(memoryKvEntry(`usage:${jstDay()}:claude-opus-5-5:in`)?.value).toBe("150");
    expect(memoryKvEntry(`usage:${jstDay()}:claude-opus-5-5:out`)?.value).toBe("25");
    expect(memoryKvEntry(`usage:${jstDay()}:claude-opus-5-5:in`)!.ttlSec).toBeGreaterThan(39 * 86400);

    delete process.env.HASHI_KV; // 設定なし＝入れ物に届かない
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(recordUsage({ model: "m", input_tokens: 1, output_tokens: 1 })).resolves.toBeUndefined();
    err.mockRestore();
  });

  it("目安の金額：Sonnet 5.5 は入力$2・出力$10、Opus 5.5 は入力$4・出力$20（100万トークンあたり）", () => {
    expect(costUsd("claude-sonnet-5-5", 1_000_000, 1_000_000)).toBe(12);
    expect(costUsd("claude-opus-5-5", 1_000_000, 500_000)).toBe(14);
    expect(costUsd("unknown-model", 1, 1)).toBeNull();
    const days = lastDays(3, Date.parse("2026-11-08T00:00:00Z"));
    expect(days).toEqual(["2026-11-08", "2026-11-07", "2026-11-06"]);
  });
});

describe("モデルの上書き（公開モードだけ）", () => {
  it("既定は今の値。公開モードの時だけ環境変数で変えられる", () => {
    expect(MODELS.interview).toBe("claude-sonnet-5-5");
    expect(MODELS.summarize).toBe("claude-opus-5-5");
    process.env.HASHI_INTERVIEW_MODEL = "x-interview";
    process.env.HASHI_SUMMARY_MODEL = "x-summary";
    expect(MODELS.interview).toBe("claude-sonnet-5-5"); // 公開モードでなければ効かない
    process.env.HASHI_PUBLIC = "1";
    expect(MODELS.interview).toBe("x-interview");
    expect(MODELS.summarize).toBe("x-summary");
    process.env.HASHI_INTERVIEW_MODEL = "  ";
    expect(MODELS.interview).toBe("claude-sonnet-5-5");
  });
});

describe("画面のエラー文（401・429・503 だけ error の文を出す）", () => {
  it("401・429・503 で文があれば ShownError", async () => {
    for (const status of [401, 429, 503]) {
      const res = Response.json({ error: "この文を出す" }, { status });
      await expect(throwIfShown(res)).rejects.toBeInstanceOf(ShownError);
      await throwIfShown(Response.json({ error: "この文を出す" }, { status })).catch((e) => expect(shownOr(e, "決まった文")).toBe("この文を出す"));
    }
  });

  it("それ以外・文が無い・JSON でない時は何もしない（決まった文のまま）", async () => {
    await expect(throwIfShown(Response.json({ error: "x" }, { status: 500 }))).resolves.toBeUndefined();
    await expect(throwIfShown(Response.json({ error: "x" }, { status: 404 }))).resolves.toBeUndefined();
    await expect(throwIfShown(Response.json({}, { status: 503 }))).resolves.toBeUndefined();
    await expect(throwIfShown(Response.json({ error: "" }, { status: 429 }))).resolves.toBeUndefined();
    await expect(throwIfShown(new Response("<html>", { status: 503 }))).resolves.toBeUndefined();
    expect(shownOr(new Error("Failed to fetch"), "決まった文")).toBe("決まった文");
  });
});
