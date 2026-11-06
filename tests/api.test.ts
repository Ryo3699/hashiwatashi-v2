// API ルートを偽物の Claude（HASHI_FAKE=1）で最後まで通す。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_QUESTIONS } from "../lib/config";
import { POST as interviewPost } from "../app/api/interview/route";
import { GET as summaryGet, POST as summaryPost } from "../app/api/summary/route";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "hashi-api-"));
  process.env.HASHI_FAKE = "1";
  process.env.HASHI_RUNTIME_DIR = dir;
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const post = (body: unknown) =>
  new Request("http://x/api", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

describe("api/interview + api/summary（偽物の Claude）", () => {
  it("最後まで通り、まとめにヒントが出る", async () => {
    const start = await (await interviewPost(post({ customerId: "p1", action: "start" }))).json();
    expect(start.action).toBe("ask");
    expect(start.text).toBe("今日いちばん気になっていることは何ですか？");

    let last = start;
    let n = 0;
    while (last.action === "ask") {
      n++;
      expect(n).toBeLessThanOrEqual(MAX_QUESTIONS);
      const res = await interviewPost(post({ customerId: "p1", answer: `答え${n}` }));
      expect(res.status).toBe(200);
      last = await res.json();
    }
    expect(last.action).toBe("finish");
    // 画面に返すのは文と数だけ（検査の理由などは含めない）
    expect(Object.keys(last).sort()).toEqual(["action", "answered", "max", "text"]);

    const before = await (await summaryGet(new Request("http://x/api/summary?customerId=p1"))).json();
    expect(before.status).toBe("finished");

    const made = await (await summaryPost(post({ customerId: "p1" }))).json();
    expect(made.status).toBe("ready");
    expect(made.failed).toBe(false);
    expect(made.summary.hints.length).toBeGreaterThan(0);
    for (const h of made.summary.hints) {
      expect(h.from_answers.every((i: number) => i >= 0 && i < made.turns.length)).toBe(true);
    }
    // 保存済み：GET でも同じ
    const got = await (await summaryGet(new Request("http://x/api/summary?customerId=p1"))).json();
    expect(got.status).toBe("ready");
    expect(got.turns[0].answer).toBe("答え1");
  });

  it("終わった後の答え・空の答え・知らないお客様・始める前の答えは拒否する", async () => {
    expect((await interviewPost(post({ customerId: "p1", answer: "もう一つ" }))).status).toBe(409);
    await interviewPost(post({ customerId: "p2", action: "start" }));
    expect((await interviewPost(post({ customerId: "p2", answer: "  " }))).status).toBe(400);
    expect((await interviewPost(post({ customerId: "zzz", action: "start" }))).status).toBe(404);
    expect((await interviewPost(post({ customerId: "../x", answer: "a" }))).status).toBe(404);
    expect((await interviewPost(post({ customerId: "p3", answer: "a" }))).status).toBe(409);
    expect((await summaryPost(post({ customerId: "p2" }))).status).toBe(409);
  });

  it("まだ何も無いお客様は status: none", async () => {
    const r = await (await summaryGet(new Request("http://x/api/summary?customerId=p3"))).json();
    expect(r.status).toBe("none");
  });
});
