// API ルートを偽物の Claude（HASHI_FAKE=1）で最後まで通す。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXED_SUGGESTIONS, MAX_QUESTIONS } from "../lib/config";
import { FAKE_FINISH_AT, FAKE_QUESTIONS, FAKE_SUGGESTIONS } from "../server/claude";
import { GET as interviewGet, POST as interviewPost } from "../app/api/interview/route";
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
    expect(Object.keys(last).sort()).toEqual(["action", "answered", "max", "suggestions", "text"]);
    expect(last.suggestions).toEqual([]);

    const before = await (await summaryGet(new Request("http://x/api/summary?customerId=p1"))).json();
    expect(before.status).toBe("finished");

    const made = await (await summaryPost(post({ customerId: "p1" }))).json();
    expect(made.status).toBe("ready");
    expect(made.failed).toBe(false);
    expect(made.summary.hints.length).toBeGreaterThan(0);
    // 偽物でも最後まで通ると、keep（最後の問い④の答えの番号）が出る
    expect(made.summary.keep).toEqual({ from_answers: [FAKE_FINISH_AT - 1] });
    expect(made.turns).toHaveLength(FAKE_FINISH_AT);
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

  it("開き直しても会話は消えない：GET で今の会話が読め、続きから答えられる（start は押した時だけ上書き）", async () => {
    await interviewPost(post({ customerId: "p3", action: "start" }));
    const get = (id: string) => interviewGet(new Request(`http://x/api/interview?customerId=${id}`));
    const none = await (await get("p2")).json();
    // p2 は前のテストで始めただけ（答え0・問いは出している）
    expect(none.status).toBe("asking");
    expect(none.turns).toEqual([]);
    expect(none.pending).toBe("今日いちばん気になっていることは何ですか？");

    await interviewPost(post({ customerId: "p3", answer: "カラーがすぐ落ちる" }));
    const mid = await (await get("p3")).json();
    expect(mid.status).toBe("asking");
    expect(mid.turns).toHaveLength(1);
    expect(mid.turns[0].answer).toBe("カラーがすぐ落ちる");
    expect(typeof mid.pending).toBe("string");

    // 画面を開き直しても（GET を何度叩いても）答えは残る
    const again = await (await get("p3")).json();
    expect(again.turns).toHaveLength(1);

    // 終わった会話は、終わりの文つきで読める
    const done = await (await get("p1")).json();
    expect(done.status).toBe("finished");
    expect(done.finishText).toBeTruthy();
    expect(done.turns.length).toBeGreaterThan(0);
    expect(done.pending).toBeNull();

    expect((await get("zzz")).status).toBe(404);
  });
});

// ---------- 答えの候補・keep・via（別の保存場所で、1人ずつ通す） ----------
describe("api：答えの候補・via・keep・古い保存", () => {
  let dir2: string;
  let prev: string | undefined;
  beforeAll(() => {
    prev = process.env.HASHI_RUNTIME_DIR;
    dir2 = mkdtempSync(path.join(tmpdir(), "hashi-api2-"));
    process.env.HASHI_RUNTIME_DIR = dir2;
  });
  afterAll(() => {
    process.env.HASHI_RUNTIME_DIR = prev;
    rmSync(dir2, { recursive: true, force: true });
  });

  const answer = async (customerId: string, text: string, extra: Record<string, unknown> = {}) => {
    const res = await interviewPost(post({ customerId, answer: text, ...extra }));
    expect(res.status).toBe(200);
    return res.json();
  };
  const getInterview = async (id: string) => (await interviewGet(new Request(`http://x/api/interview?customerId=${id}`))).json();
  const getSummary = async (id: string) => (await summaryGet(new Request(`http://x/api/summary?customerId=${id}`))).json();

  it("最初の問いに候補は無く、2問目以降は選択肢＋決まった候補が付く。GET でも戻る", async () => {
    const start = await (await interviewPost(post({ customerId: "p1", action: "start" }))).json();
    expect(start.suggestions).toEqual([]);
    expect((await getInterview("p1")).suggestions).toEqual([]);

    const second = await answer("p1", "すいてほしいです");
    expect(second.text).toBe(FAKE_QUESTIONS[0]);
    expect(second.suggestions).toEqual([...FAKE_SUGGESTIONS[0], ...FIXED_SUGGESTIONS]);
    // 開き直し（GET）でも同じ候補が出る
    const again = await getInterview("p1");
    expect(again.status).toBe("asking");
    expect(again.pending).toBe(FAKE_QUESTIONS[0]);
    expect(again.suggestions).toEqual(second.suggestions);

    // 選択肢の無い問いでも、決まった候補は付く
    const third = await answer("p1", "乾かした後");
    expect(third.text).toBe(FAKE_QUESTIONS[1]);
    expect(third.suggestions).toEqual(FIXED_SUGGESTIONS);
  });

  it("答えの印（via）はサーバーで決める：同じ=chip／書き足し=chip_edited／画面からの申告は無視", async () => {
    // 上のテストの続き（p1：答え0=すいてほしいです・答え1=乾かした後＝2問目の候補どおり）。
    // 3問目（ご自宅）の候補は決まった候補だけ。画面が via:"chip" と申告しても、候補でない答えには付かない
    await answer("p1", "朝は自然乾燥です", { via: "chip" });
    await answer("p1", "特にないです"); // 4問目の候補（決まった候補）と同じ
    // 最後の問い④への答え＝候補で始まって長い。これで4つの角度が揃うので終わる
    const last = await answer("p1", "特にないです、毛先は残したいです");
    expect(last.action).toBe("finish");
    const view = await getInterview("p1");
    expect(view.turns.map((t: { via?: string }) => t.via)).toEqual([undefined, "chip", undefined, "chip", "chip_edited"]);
  });

  it("終わると候補は空。まとめの turns に via が付き、keep が出る", async () => {
    const done = await getInterview("p1");
    expect(done.status).toBe("finished");
    expect(done.suggestions).toEqual([]);

    const made = await (await summaryPost(post({ customerId: "p1" }))).json();
    expect(made.status).toBe("ready");
    expect(made.turns[1].via).toBe("chip");
    expect(made.turns[4].via).toBe("chip_edited");
    expect(made.turns[0].via).toBeUndefined();
    expect(made.summary.keep.from_answers).toEqual([4]);
  });

  it("古い保存（pendingSuggestions・via が無い）を読めて、続きから答えられる", async () => {
    mkdirSync(dir2, { recursive: true });
    writeFileSync(
      path.join(dir2, "p2.json"),
      JSON.stringify({
        customerId: "p2",
        turns: [{ question: "今日いちばん気になっていることは何ですか？", answer: "前髪をなんとかしたい" }],
        pending: "それは、どんな時に特に気になりますか？",
        finished: false,
        finishText: null,
        result: null,
        updatedAt: "2026-11-06T00:00:00.000Z",
      }),
    );
    const old = await getInterview("p2");
    expect(old.status).toBe("asking");
    expect(old.suggestions).toEqual([]);
    const next = await answer("p2", "夕方");
    expect(next.action).toBe("ask");
    expect(next.suggestions).toEqual(FIXED_SUGGESTIONS);
    const view = await getInterview("p2");
    expect(view.turns[1]).toEqual({ question: "それは、どんな時に特に気になりますか？", answer: "夕方" });
  });

  it("古い保存のまとめ（keep が無い）は、keep が空として読める", async () => {
    writeFileSync(
      path.join(dir2, "p3.json"),
      JSON.stringify({
        customerId: "p3",
        turns: [
          { question: "q1？", answer: "カラーがすぐ落ちる" },
          { question: "q2？", answer: "2週間で黄色っぽい" },
        ],
        pending: null,
        finished: true,
        finishText: "ありがとうございました。",
        result: {
          summary: {
            hidden_worry: { text: "色味が気になっているのかもしれません。", from_answers: [0] },
            hints: [{ kind: "cause", text: "髪の傷みが関わっている可能性があります。", from_answers: [1] }],
          },
          removedCount: 0,
          failed: false,
        },
        updatedAt: "2026-11-06T00:00:00.000Z",
      }),
    );
    const r = await getSummary("p3");
    expect(r.status).toBe("ready");
    expect(r.summary.keep).toEqual({ from_answers: [] });
    expect(r.summary.hints).toHaveLength(1);
    expect((await getInterview("p3")).suggestions).toEqual([]);
  });
});
