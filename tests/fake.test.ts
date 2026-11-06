// HASHI_FAKE=1 の偽物：まとめが、お客様の答えと意味でつながり、機械の検査にも通る
import { describe, expect, it } from "vitest";
import { checkQuestion, checkSummary, cleanKeep, cleanSuggestions } from "../lib/checks";
import { FAKE_FINISH_AT, FAKE_QUESTIONS, FAKE_SUGGESTIONS, fakeSummary } from "../server/claude";

const msg = (answers: string[]) =>
  answers.map((a, i) => `問${i + 1}：q\n<answer index="${i}">${a}</answer>`).join("\n");

describe("偽物の問い", () => {
  it("検査に通る問いだけ", () => {
    for (const q of FAKE_QUESTIONS) expect(checkQuestion(q).ok, q).toBe(true);
  });

  it("4つの角度を1問ずつ聞き終えた数で終わる（最後の問いが「残したい所・避けたいこと」）", () => {
    expect(FAKE_FINISH_AT).toBe(FAKE_QUESTIONS.length + 1);
    expect(FAKE_QUESTIONS[FAKE_QUESTIONS.length - 1]).toContain("残したい所");
  });

  it("少なくとも1つの問いに選択肢と候補があり、候補は検査をそのまま通る", () => {
    expect(FAKE_SUGGESTIONS).toHaveLength(FAKE_QUESTIONS.length);
    expect(FAKE_SUGGESTIONS.some((s) => s.length >= 2)).toBe(true);
    FAKE_QUESTIONS.forEach((q, i) => {
      expect(cleanSuggestions(q, FAKE_SUGGESTIONS[i]), q).toEqual(FAKE_SUGGESTIONS[i]);
    });
  });
});

describe("偽物のまとめ：最初の答えに合わせる", () => {
  const cases: [string, string[], string][] = [
    ["すいてほしい", ["すいてほしいです", "乾かすと横が広がる", "朝は自然乾燥"], "広がり"],
    ["前髪", ["前髪をなんとかしたい", "夕方には割れる", "毎朝アイロン"], "前髪"],
    ["カラー", ["カラーがすぐ落ちる", "2週間で黄色っぽい", "毎晩熱めのお湯"], "色"],
  ];
  it.each(cases)("%s：ヒントの話題が合い、検査に通る", (_n, answers, word) => {
    const s = fakeSummary(msg(answers));
    expect(checkSummary(s as never, answers.length).ok).toBe(true);
    expect(JSON.stringify(s)).toContain(word);
  });

  it("カラーの人に、広がりの話は出ない", () => {
    const s = fakeSummary(msg(["カラーがすぐ落ちる", "2週間で黄色っぽい", "毎晩熱めのお湯"]));
    expect(JSON.stringify(s)).not.toContain("広がり");
    expect(JSON.stringify(s)).not.toContain("毛量");
  });

  it("ヒントの根拠の番号は、実在する答えの番号。home_care は「ご自宅の手入れ」の答え（2番）", () => {
    const s = fakeSummary(msg(["前髪をなんとかしたい", "夕方には割れる", "毎朝アイロン"]));
    for (const h of s.hints) expect(h.from_answers.every((i) => i >= 0 && i < 3)).toBe(true);
    expect(s.hints.find((h) => h.kind === "home_care")?.from_answers).toEqual([2]);
  });

  it("最後の問いまで答えが揃った時、keep は最後の答えの番号（実在する番号）", () => {
    const answers = ["前髪をなんとかしたい", "夕方には割れる", "毎朝アイロン", "前髪の量が多い", "おでこは全部出したくない"];
    expect(answers).toHaveLength(FAKE_FINISH_AT);
    const s = fakeSummary(msg(answers));
    expect(s.keep).toEqual({ from_answers: [FAKE_FINISH_AT - 1] });
    expect(cleanKeep(s.keep, answers.length)).toEqual(s.keep);
    expect(checkSummary(s as never, answers.length).ok).toBe(true);
  });

  it("④を聞く前（答えが少ない）なら keep は空。via の印が付いた答えでも話題が合う", () => {
    expect(fakeSummary(msg(["前髪をなんとかしたい", "夕方には割れる", "毎朝アイロン"])).keep).toEqual({ from_answers: [] });
    const viaMsg = `問1：q\n<answer index="0">カラーがすぐ落ちる</answer>\n問2：q\n<answer index="1" via="chip">朝</answer>`;
    expect(JSON.stringify(fakeSummary(viaMsg))).toContain("色");
  });

  it("答えが1つだけでも番号は範囲内", () => {
    const s = fakeSummary(msg(["髪が気になる"]));
    expect(checkSummary(s as never, 1).ok).toBe(true);
  });
});
