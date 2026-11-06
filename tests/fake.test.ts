// HASHI_FAKE=1 の偽物：まとめが、お客様の答えと意味でつながり、機械の検査にも通る
import { describe, expect, it } from "vitest";
import { checkQuestion, checkSummary } from "../lib/checks";
import { FAKE_QUESTIONS, fakeSummary } from "../server/claude";

const msg = (answers: string[]) =>
  answers.map((a, i) => `問${i + 1}：q\n<answer index="${i}">${a}</answer>`).join("\n");

describe("偽物の問い", () => {
  it("検査に通る問いだけ", () => {
    for (const q of FAKE_QUESTIONS) expect(checkQuestion(q).ok, q).toBe(true);
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

  it("答えが1つだけでも番号は範囲内", () => {
    const s = fakeSummary(msg(["髪が気になる"]));
    expect(checkSummary(s as never, 1).ok).toBe(true);
  });
});
