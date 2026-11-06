import { describe, expect, it } from "vitest";
import { ClaudeFatalError, ClaudeReplyError, FakeClaude } from "../lib/claude";
import { MODELS } from "../lib/config";
import { FALLBACK_WORRY_TEXT, summarize } from "../lib/summarize";
import type { Summary, Turn } from "../lib/types";

const turns: Turn[] = [
  { question: "今日いちばん気になっていることは何ですか？", answer: "すいてほしいです" },
  { question: "乾かした後はどうですか？", answer: "横が広がって顔が四角く見える" },
  { question: "朝はどうされていますか？", answer: "時間がなくて自然乾燥" },
];

const good = (): Summary => ({
  hidden_worry: { text: "軽さより、横の広がりで顔が四角く見えることが気になっているようです。", from_answers: [0, 1] },
  hints: [
    { kind: "cause", text: "毛量というより、乾かし方で横に膨らんでいるのかもしれません。", from_answers: [1, 2] },
    { kind: "home_care", text: "自然乾燥が広がりにつながっている可能性があります。", from_answers: [2] },
    { kind: "hair_and_style", text: "髪質に対して、今の形が合っていないのではないか。", from_answers: [1] },
  ],
});

describe("summarize", () => {
  it("合格なら1回で終わり、removed は空", async () => {
    const fake = new FakeClaude([good()]);
    const r = await summarize(turns, fake);
    expect(r.summary).toEqual(good());
    expect(r.removed).toEqual([]);
    expect(r.attempts).toBe(1);
    expect(fake.calls[0].model).toBe(MODELS.summarize);
    expect(fake.calls[0].messages[0].content).toContain('<answer index="2">時間がなくて自然乾燥</answer>');
  });

  it("from_answers の番号違いのヒントは、作り直しても直らなければ外されて removed に残る", async () => {
    const bad = good();
    bad.hints[0].from_answers = [9];
    const fake = new FakeClaude([bad], { repeatLast: true });
    const r = await summarize(turns, fake);
    expect(fake.calls.length).toBe(2);
    expect(fake.calls[1].messages[0].content).toContain("存在しない番号");
    expect(r.summary.hints.map((h) => h.kind)).toEqual(["home_care", "hair_and_style"]);
    expect(r.removed).toHaveLength(1);
    expect(r.removed[0]).toMatchObject({ where: "hint", kind: "cause" });
    expect(r.removed[0].reasons.join("")).toContain("存在しない番号");
  });

  it("推測でないヒントは外される", async () => {
    const bad = good();
    bad.hints[1].text = "自然乾燥が広がりの原因です。";
    const fake = new FakeClaude([bad], { repeatLast: true });
    const r = await summarize(turns, fake);
    expect(r.summary.hints.map((h) => h.kind)).toEqual(["cause", "hair_and_style"]);
    expect(r.removed[0].kind).toBe("home_care");
  });

  it("医療の語のヒントは外される", async () => {
    const bad = good();
    bad.hints[0].text = "頭皮の病気や脱毛症の可能性があります。";
    const fake = new FakeClaude([bad], { repeatLast: true });
    const r = await summarize(turns, fake);
    expect(r.summary.hints.map((h) => h.kind)).toEqual(["home_care", "hair_and_style"]);
    expect(r.removed[0].reasons.join("")).toContain("医療");
  });

  it("1回目がNGでも、作り直しで直れば removed は空・全部残る", async () => {
    const bad = good();
    bad.hints[2].text = "髪質に長さが合っていません。";
    const fake = new FakeClaude([bad, good()]);
    const r = await summarize(turns, fake);
    expect(r.attempts).toBe(2);
    expect(r.removed).toEqual([]);
    expect(r.summary.hints).toHaveLength(3);
    expect(fake.calls[1].messages[0].content).toContain("ヒント2");
  });

  it("隠れた悩みがNGのままなら、定型の文に差し替えて元の文を removed に残す", async () => {
    const bad = good();
    bad.hidden_worry.from_answers = [7];
    const fake = new FakeClaude([bad], { repeatLast: true });
    const r = await summarize(turns, fake);
    expect(r.summary.hidden_worry.text).toBe(FALLBACK_WORRY_TEXT);
    expect(r.summary.hidden_worry.from_answers).toEqual([0, 1, 2]);
    expect(r.removed[0]).toMatchObject({ where: "hidden_worry" });
    expect(r.summary.hints).toHaveLength(3);
  });

  it("形が壊れた返事が続くと failed。壊れたのは1回目だけなら作り直しで通る", async () => {
    const broken = new FakeClaude([{ x: 1 }], { repeatLast: true });
    const r1 = await summarize(turns, broken);
    expect(r1.failed).toBe(true);
    expect(r1.summary.hints).toEqual([]);

    const once = new FakeClaude([{ x: 1 }, good()]);
    const r2 = await summarize(turns, once);
    expect(r2.failed).toBe(false);
    expect(r2.summary.hints).toHaveLength(3);
  });

  it("答えが0個なら Claude を呼ばない", async () => {
    const fake = new FakeClaude([]);
    const r = await summarize([], fake);
    expect(r.failed).toBe(true);
    expect(fake.calls.length).toBe(0);
  });

  // ---- 本物の Claude でだけ起きる失敗（返事が空・途中で切れた・断られた）の道 ----
  it("1回目が例外 → 作り直しで合格すれば、そのまま使う", async () => {
    const fake = new FakeClaude([
      () => {
        throw new ClaudeReplyError("返事が途中で切れました（stop_reason=max_tokens）");
      },
      good(),
    ]);
    const r = await summarize(turns, fake);
    expect(fake.calls.length).toBe(2);
    expect(r).toMatchObject({ attempts: 2, failed: false, removed: [] });
    expect(r.summary).toEqual(good());
  });

  it("2回とも例外 → 例外を上に投げず、failed のまとめ", async () => {
    const fake = new FakeClaude(
      [
        () => {
          throw new ClaudeReplyError("断られました");
        },
      ],
      { repeatLast: true },
    );
    const r = await summarize(turns, fake);
    expect(fake.calls.length).toBe(2);
    expect(r).toMatchObject({ failed: true, attempts: 2 });
    expect(r.summary.hidden_worry.text).toBe(FALLBACK_WORRY_TEXT);
    expect(r.summary.hints).toEqual([]);
  });

  it("1回目はNG・2回目が例外 → 1回目のまとめからNGだけ外して出す", async () => {
    const bad = good();
    bad.hints[0].text = "乾かし方が原因です。";
    const fake = new FakeClaude([
      bad,
      () => {
        throw new ClaudeReplyError("空");
      },
    ]);
    const r = await summarize(turns, fake);
    expect(r.failed).toBe(false);
    expect(r.summary.hints.map((h) => h.kind)).toEqual(["home_care", "hair_and_style"]);
    expect(r.removed).toHaveLength(1);
  });

  it("鍵が無いなどの失敗は、failed にせず上へ伝える", async () => {
    const fake = new FakeClaude([
      () => {
        throw new ClaudeFatalError("ANTHROPIC_API_KEY が未設定です");
      },
    ]);
    await expect(summarize(turns, fake)).rejects.toThrow("ANTHROPIC_API_KEY");
  });

  it("まとめの呼び出しは、考えた分も入る大きさの上限（16000）", async () => {
    const fake = new FakeClaude([good()]);
    await summarize(turns, fake);
    expect(fake.calls[0].maxTokens).toBeGreaterThanOrEqual(16000);
  });
});
