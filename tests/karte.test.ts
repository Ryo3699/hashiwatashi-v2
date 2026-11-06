// カルテ（美容師のメモ）：来店の区切り・保存・API・写し。偽物の Claude（HASHI_FAKE=1）と一時フォルダだけを使う。
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { KARTE_MAX_LEN } from "../lib/types";
import { FAKE_FINISH_AT } from "../server/claude";
import { copyFromSession } from "../server/karte";
import { emptySession, loadSession, type Session } from "../server/store";
import { POST as interviewPost } from "../app/api/interview/route";
import { GET as summaryGet, POST as summaryPost } from "../app/api/summary/route";
import { POST as kartePost } from "../app/api/karte/route";

let dir: string;
let prev: string | undefined;
beforeAll(() => {
  prev = process.env.HASHI_RUNTIME_DIR;
  dir = mkdtempSync(path.join(tmpdir(), "hashi-karte-"));
  process.env.HASHI_FAKE = "1";
  process.env.HASHI_RUNTIME_DIR = dir;
});
afterAll(() => {
  process.env.HASHI_RUNTIME_DIR = prev;
  rmSync(dir, { recursive: true, force: true });
});

const post = (body: unknown) =>
  new Request("http://x/api", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const getSummary = async (id: string) => (await summaryGet(new Request(`http://x/api/summary?customerId=${id}`))).json();
const karte = (body: unknown) => kartePost(post(body));

/** 偽物の Claude で、聞き取りを最初から最後まで通す */
async function runInterview(customerId: string, prefix = "答え") {
  await interviewPost(post({ customerId, action: "start" }));
  for (let n = 1; n <= FAKE_FINISH_AT; n++) {
    const res = await interviewPost(post({ customerId, answer: `${prefix}${n}` }));
    expect(res.status).toBe(200);
  }
}

describe("来店の区切り（visitId）", () => {
  it("emptySession は毎回違う visitId", () => {
    const a = emptySession("p1");
    const b = emptySession("p1");
    expect(a.visitId).toBeTruthy();
    expect(a.visitId).not.toBe(b.visitId);
  });

  it("古い保存（visitId なし）が読め、2回読んでも同じ visitId", async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "p3.json"),
      JSON.stringify({
        customerId: "p3",
        turns: [{ question: "q？", answer: "前髪をなんとかしたい" }],
        pending: "次の問い？",
        finished: false,
        finishText: null,
        result: null,
        updatedAt: "2026-11-06T00:00:00.000Z",
      }),
    );
    const a = (await loadSession("p3")) as Session;
    const b = (await loadSession("p3")) as Session;
    expect(a.visitId).toBe("legacy-2026-11-06T00:00:00.000Z");
    expect(b.visitId).toBe(a.visitId);
  });

  it("「最初から」で来店が変わる", async () => {
    await interviewPost(post({ customerId: "p3", action: "start" }));
    const s1 = (await loadSession("p3")) as Session;
    await interviewPost(post({ customerId: "p3", action: "start" }));
    const s2 = (await loadSession("p3")) as Session;
    expect(s1.visitId).not.toBe(s2.visitId);
    expect(s1.visitId.startsWith("legacy-")).toBe(false);
  });
});

describe("api/karte", () => {
  it("知らないお客様は 404", async () => {
    expect((await karte({ customerId: "zzz", did: "a", next: "b" })).status).toBe(404);
    expect((await karte({ customerId: "../x", did: "a", next: "b" })).status).toBe(404);
  });

  it("形が違う・did と next が両方空・200字超えは 400", async () => {
    expect((await karte({ customerId: "p1", did: "  ", next: "" })).status).toBe(400);
    expect((await karte({ customerId: "p1", did: 1, next: "b" })).status).toBe(400);
    expect((await karte({ customerId: "p1", did: "a" })).status).toBe(400);
    expect((await karte({ customerId: "p1", did: "あ".repeat(KARTE_MAX_LEN + 1), next: "" })).status).toBe(400);
    expect((await karte({ customerId: "p1", did: "", next: "あ".repeat(KARTE_MAX_LEN + 1) })).status).toBe(400);
    const bad = await kartePost(new Request("http://x/api", { method: "POST", body: "{" }));
    expect(bad.status).toBe(400);
  });

  it("聞き取りの前（Session が無い・回答中）は 409", async () => {
    expect((await karte({ customerId: "p1", did: "カット", next: "" })).status).toBe(409);
    await interviewPost(post({ customerId: "p2", action: "start" }));
    expect((await karte({ customerId: "p2", did: "カット", next: "" })).status).toBe(409);
    expect(existsSync(path.join(dir, "p1.karte.json"))).toBe(false);
  });

  it("同じ来店で2回残すと1件のまま上書き。前後の空白は落ちる。200字ちょうどは通る", async () => {
    await runInterview("p1");
    await summaryPost(post({ customerId: "p1" }));
    const first = await (await karte({ customerId: "p1", did: "  毛先をすいた \n", next: "乾かし方を聞く" })).json();
    expect(first.karte.previous).toBeNull();
    expect(first.karte.current.did).toBe("毛先をすいた");
    expect(first.karte.current.next).toBe("乾かし方を聞く");

    const exact = "あ".repeat(KARTE_MAX_LEN);
    const second = await karte({ customerId: "p1", did: exact, next: "" });
    expect(second.status).toBe(200);
    const body = await second.json();
    expect(body.karte.current.did).toBe(exact);
    expect(body.karte.current.next).toBe("");

    const saved = JSON.parse(readFileSync(path.join(dir, "p1.karte.json"), "utf8"));
    expect(saved.customerId).toBe("p1");
    expect(saved.entries).toHaveLength(1);
    expect(saved.entries[0].did).toBe(exact);
  });

  it("写し：wish＝答え1の原文・keep＝keep が指す答えの原文。美容師の入力には混ざらない", async () => {
    const saved = JSON.parse(readFileSync(path.join(dir, "p1.karte.json"), "utf8"));
    const e = saved.entries[0];
    expect(e.wish).toBe("答え1");
    expect(e.keep).toEqual([`答え${FAKE_FINISH_AT}`]);
    expect(new Date(e.savedAt).toString()).not.toBe("Invalid Date");
  });

  it("「最初から」で来店が変わる：カルテのファイルは残り、残すと2件になる。previous は前の来店", async () => {
    const before = JSON.parse(readFileSync(path.join(dir, "p1.karte.json"), "utf8")).entries[0];
    await interviewPost(post({ customerId: "p1", action: "start" }));
    // 会話は新しくなったが、カルテのファイルは残っている
    const afterStart = JSON.parse(readFileSync(path.join(dir, "p1.karte.json"), "utf8"));
    expect(afterStart.entries).toHaveLength(1);
    // 聞き取りの途中でも、前回は読める（status は interviewing）
    const mid = await getSummary("p1");
    expect(mid.status).toBe("none");
    expect(mid.karte.current).toBeNull();
    expect(mid.karte.previous.visitId).toBe(before.visitId);
    expect(mid.karte.previous.wish).toBe("答え1");

    await runInterview("p1", "二回目");
    await summaryPost(post({ customerId: "p1" }));
    const res = await (await karte({ customerId: "p1", did: "カラー", next: "色持ちを聞く" })).json();
    expect(res.karte.current.visitId).not.toBe(before.visitId);
    expect(res.karte.current.wish).toBe("二回目1");
    expect(res.karte.previous.visitId).toBe(before.visitId);
    expect(res.karte.previous.did).toBe("あ".repeat(KARTE_MAX_LEN));
    const saved = JSON.parse(readFileSync(path.join(dir, "p1.karte.json"), "utf8"));
    expect(saved.entries).toHaveLength(2);
  });
});

describe("GET /api/summary のカルテ", () => {
  it("status が none でも previous が出る／ready では current と previous が出る", async () => {
    // p1 は前のテストで 2 件。ここで「最初から」→ status none・previous は 2 件目（一番新しい）
    const cur = (await getSummary("p1")).karte.current;
    expect(cur.wish).toBe("二回目1");
    await interviewPost(post({ customerId: "p1", action: "start" }));
    const none = await getSummary("p1");
    expect(none.status).toBe("none");
    expect(none.karte.current).toBeNull();
    expect(none.karte.previous.wish).toBe("二回目1");

    // 途中（interviewing）にも付く
    await interviewPost(post({ customerId: "p1", answer: "三回目1" }));
    const mid = await getSummary("p1");
    expect(mid.status).toBe("interviewing");
    expect(mid.karte.previous.wish).toBe("二回目1");
  });

  it("karte が一つも無いお客様は current も previous も null", async () => {
    const r = await getSummary("p2");
    expect(r.karte).toEqual({ current: null, previous: null });
  });

  it("POST /api/summary（まとめを作る）の返り値にも karte が付く", async () => {
    await runInterview("p2", "p2の");
    const made = await (await summaryPost(post({ customerId: "p2" }))).json();
    expect(made.status).toBe("ready");
    expect(made.karte).toEqual({ current: null, previous: null });
    await karte({ customerId: "p2", did: "カット", next: "" });
    const again = await (await summaryPost(post({ customerId: "p2" }))).json();
    expect(again.karte.current.did).toBe("カット");
  });
});

describe("写し（copyFromSession）", () => {
  const base = (over: Partial<Session>): Session => ({
    ...emptySession("p1"),
    turns: [
      { question: "q1", answer: "すいてほしい" },
      { question: "q2", answer: "夕方" },
      { question: "q3", answer: "毛先は残したい" },
    ],
    finished: true,
    ...over,
  });
  const summary = (from: number[]) => ({
    hidden_worry: { text: "t", from_answers: [0] },
    hints: [],
    keep: { from_answers: from },
  });

  it("wish＝答え1の原文・keep＝keep.from_answers の原文（実在しない番号は落とす）", () => {
    const s = base({ result: { summary: summary([2, 7, -1, 1.5, 2]), removedCount: 0, failed: false } });
    expect(copyFromSession(s)).toEqual({ wish: "すいてほしい", keep: ["毛先は残したい"] });
  });

  it("result が null か failed の時は keep が空", () => {
    expect(copyFromSession(base({ result: null }))).toEqual({ wish: "すいてほしい", keep: [] });
    const failed = base({ result: { summary: summary([2]), removedCount: 0, failed: true } });
    expect(copyFromSession(failed)).toEqual({ wish: "すいてほしい", keep: [] });
  });

  it("答えが無ければ wish は null", () => {
    expect(copyFromSession(base({ turns: [] }))).toEqual({ wish: null, keep: [] });
  });
});
