import { describe, expect, it } from "vitest";
import { checkFinish, checkQuestion, checkSummary, parseInterviewStep, parseSummary } from "../lib/checks";
import { FINISH_TEXT, FIRST_QUESTION } from "../lib/config";
import { FALLBACK_QUESTIONS } from "../lib/interview";
import type { Summary } from "../lib/types";

describe("checkQuestion", () => {
  it("ふつうの問いは通る", () => {
    expect(checkQuestion("乾かした後、特にどの辺りが気になりますか？").ok).toBe(true);
    expect(checkQuestion(FIRST_QUESTION).ok).toBe(true);
  });

  it("「？」が2つ以上はNG（全角・半角とも）", () => {
    expect(checkQuestion("いつからですか？朝ですか？").ok).toBe(false);
    expect(checkQuestion("いつからですか?朝ですか?").ok).toBe(false);
  });

  it.each([
    "あなたの髪は広がりやすいタイプですね",
    "前髪は短めにしましょう",
    "毎日トリートメントした方がいいですか？",
    "ボブがおすすめです",
    "広がるのは乾かし方が原因ですか？",
    "あなたの髪質はくせ毛ですね",
    "間違いなくダメージです",
  ])("決めた言い方を見つける：%s", (t) => {
    const r = checkQuestion(t);
    expect(r.ok).toBe(false);
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it("空はNG", () => {
    expect(checkQuestion("  ").ok).toBe(false);
  });

  it("定型の問いと終わりの文は全部通る", () => {
    for (const q of FALLBACK_QUESTIONS) {
      expect(checkQuestion(q).ok, q).toBe(true);
      expect((q.match(/[？?]/g) ?? []).length, q).toBe(1);
    }
    expect(checkFinish(FINISH_TEXT).ok).toBe(true);
  });

  it("終わりの文に「？」があるとNG", () => {
    expect(checkFinish("ありがとうございました。他にありますか？").ok).toBe(false);
  });
});

const base = (): Summary => ({
  hidden_worry: { text: "毛先の軽さより、顔まわりの広がりが気になっているようです。", from_answers: [0, 1] },
  hints: [
    { kind: "cause", text: "乾かし方が影響しているかもしれません。", from_answers: [1] },
    { kind: "home_care", text: "自然乾燥が広がりにつながっている可能性があります。", from_answers: [2] },
    { kind: "hair_and_style", text: "髪質に対して今の長さが合っていないのではないか。", from_answers: [0, 1] },
  ],
});

describe("checkSummary", () => {
  it("正しいまとめは通る", () => {
    const r = checkSummary(base(), 3);
    expect(r.ok).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it("from_answers の番号違いを見つける（範囲外・負・小数・空）", () => {
    for (const fa of [[9], [-1], [0.5], []]) {
      const s = base();
      s.hints[0].from_answers = fa;
      const r = checkSummary(s, 3);
      expect(r.ok, JSON.stringify(fa)).toBe(false);
      expect(r.hints[0].length).toBeGreaterThan(0);
      expect(r.hints[1]).toEqual([]);
    }
  });

  it("隠れた悩みの from_answers の番号違いも見つける", () => {
    const s = base();
    s.hidden_worry.from_answers = [3];
    const r = checkSummary(s, 3);
    expect(r.ok).toBe(false);
    expect(r.worry.length).toBeGreaterThan(0);
  });

  it("推測でないヒント（言い切り）を見つける", () => {
    const s = base();
    s.hints[1].text = "自然乾燥が広がりの原因です。";
    const r = checkSummary(s, 3);
    expect(r.ok).toBe(false);
    expect(r.hints[1].length).toBeGreaterThan(0);
  });

  it("推測の言い方が無いだけでもNG", () => {
    const s = base();
    s.hints[2].text = "髪質に対して長さが重い。";
    const r = checkSummary(s, 3);
    expect(r.ok).toBe(false);
    expect(r.hints[2].some((x) => x.includes("推測"))).toBe(true);
  });

  it("推測の語があっても、決める言い方が混ざればNG", () => {
    const s = base();
    s.hints[0].text = "広がるかもしれないので、短めにしましょう。";
    expect(checkSummary(s, 3).ok).toBe(false);
  });

  it("医療の語を見つける", () => {
    for (const t of ["脱毛症の可能性があります。", "頭皮の炎症かもしれません。", "抜け毛が関わっているかもしれません。"]) {
      const s = base();
      s.hints[0].text = t;
      const r = checkSummary(s, 3);
      expect(r.ok, t).toBe(false);
      expect(r.hints[0].some((x) => x.includes("医療")), t).toBe(true);
    }
  });

  it("kind が3つ以外はNG", () => {
    const s = base();
    (s.hints[0] as { kind: string }).kind = "treatment";
    expect(checkSummary(s, 3).ok).toBe(false);
  });
});

describe("形の確かめ", () => {
  it("parseInterviewStep", () => {
    expect(parseInterviewStep({ action: "ask", text: "a" })).toEqual({ action: "ask", text: "a" });
    expect(parseInterviewStep({ action: "stop", text: "a" })).toBeNull();
    expect(parseInterviewStep({ action: "ask" })).toBeNull();
    expect(parseInterviewStep(null)).toBeNull();
    expect(parseInterviewStep("ask")).toBeNull();
  });

  it("parseSummary", () => {
    expect(parseSummary(base())).toEqual(base());
    expect(parseSummary({ hidden_worry: { text: "a", from_answers: [0] } })).toBeNull();
    expect(parseSummary({ hidden_worry: { text: "a" }, hints: [] })).toBeNull();
    expect(parseSummary({ hidden_worry: { text: "a", from_answers: [0] }, hints: [{ kind: "cause" }] })).toBeNull();
    expect(parseSummary(undefined)).toBeNull();
  });
});
