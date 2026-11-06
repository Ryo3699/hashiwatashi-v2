// 審査用リンク：公開モードで API ルートを最後まで通す（偽物の Claude・メモリの入れ物・クッキーは差し替え）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as interviewPost, GET as interviewGet } from "../app/api/interview/route";
import { GET as summaryGet, POST as summaryPost } from "../app/api/summary/route";
import { POST as kartePost } from "../app/api/karte/route";
import { FAKE_FINISH_AT } from "../server/claude";
import { resetMemoryKv } from "../server/kv";
import { newVisitorSecret } from "../server/public";
import { clearJudgeEnv, restoreJudgeEnv } from "./judge_env";

const h = vi.hoisted(() => ({ cookie: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "hv" && h.cookie ? { name, value: h.cookie } : undefined) }),
}));

beforeEach(() => {
  clearJudgeEnv();
  resetMemoryKv();
  process.env.HASHI_PUBLIC = "1";
  process.env.HASHI_KV = "memory";
  process.env.HASHI_FAKE = "1";
  h.cookie = undefined;
});
afterEach(() => restoreJudgeEnv());

const post = (body: unknown) =>
  new Request("http://x/api", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

async function runInterview(): Promise<void> {
  expect((await interviewPost(post({ customerId: "p1", action: "start" }))).status).toBe(200);
  for (let i = 0; i < FAKE_FINISH_AT; i++) {
    const res = await interviewPost(post({ customerId: "p1", answer: `答え${i}` }));
    expect(res.status).toBe(200);
  }
}

describe("公開モードで、訪問者ごとに最後まで通る", () => {
  it("聞き取り → まとめ → カルテが通り、別の訪問者には何も見えない", async () => {
    const a = newVisitorSecret();
    h.cookie = a;
    await runInterview();
    const made = await (await summaryPost(post({ customerId: "p1" }))).json();
    expect(made.status).toBe("ready");
    const saved = await (await kartePost(post({ customerId: "p1", did: "メモ", next: "" }))).json();
    expect(saved.karte.current.did).toBe("メモ");

    h.cookie = newVisitorSecret();
    const other = await (await interviewGet(new Request("http://x/api/interview?customerId=p1"))).json();
    expect(other.status).toBe("none");
    const otherSummary = await (await summaryGet(new Request("http://x/api/summary?customerId=p1"))).json();
    expect(otherSummary.status).toBe("none");
    expect(otherSummary.karte.current).toBeNull();
    expect(otherSummary.karte.previous).toBeNull();

    h.cookie = a;
    const again = await (await summaryGet(new Request("http://x/api/summary?customerId=p1"))).json();
    expect(again.status).toBe("ready");
    expect(again.karte.current.did).toBe("メモ");
  });

  it("クッキーが無いままルートが呼ばれても、共有の場所には書かず 500 で断る", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await interviewPost(post({ customerId: "p1", action: "start" }));
    expect(res.status).toBe(500);
    const logged = err.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).not.toContain("答え");
    err.mockRestore();
    h.cookie = newVisitorSecret();
    expect((await (await interviewGet(new Request("http://x/api/interview?customerId=p1"))).json()).status).toBe("none");
  });
});
