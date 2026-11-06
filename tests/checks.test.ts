import { describe, expect, it } from "vitest";
import {
  checkFinish,
  checkQuestion,
  checkSummary,
  cleanKeep,
  cleanSuggestions,
  parseInterviewStep,
  parseSummary,
  readSuggestions,
} from "../lib/checks";
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
  keep: { from_answers: [2] },
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

  it("parseSummary：keep が無い・形が違う時は空にする（まとめ全体は不合格にしない）", () => {
    const { keep: _keep, ...noKeep } = base();
    expect(parseSummary(noKeep)?.keep).toEqual({ from_answers: [] });
    expect(parseSummary({ ...noKeep, keep: "x" })?.keep).toEqual({ from_answers: [] });
    expect(parseSummary({ ...noKeep, keep: { from_answers: "x" } })?.keep).toEqual({ from_answers: [] });
    expect(parseSummary({ ...noKeep, keep: { from_answers: [2, "a", 1.5, null] } })?.keep).toEqual({ from_answers: [2] });
  });

  it("readSuggestions：配列でなければ空・文字列以外は捨てる", () => {
    expect(readSuggestions({ action: "ask", text: "a", suggestions: ["朝", 3, null, "夜"] })).toEqual(["朝", "夜"]);
    expect(readSuggestions({ action: "ask", text: "a" })).toEqual([]);
    expect(readSuggestions({ suggestions: "朝" })).toEqual([]);
    expect(readSuggestions(null)).toEqual([]);
  });
});

describe("cleanKeep：keep の番号の検査", () => {
  it("実在する番号だけ残す（実在しない番号・負・小数・重なりは落とす）", () => {
    expect(cleanKeep({ from_answers: [2, 9, -1, 1.5, 2, 0] }, 3)).toEqual({ from_answers: [0, 2] });
  });
  it("実在しない番号だけなら空になってよい", () => {
    expect(cleanKeep({ from_answers: [7, 8] }, 3)).toEqual({ from_answers: [] });
  });
  it("keep が無い・形が違う時は空", () => {
    expect(cleanKeep(undefined, 3)).toEqual({ from_answers: [] });
    expect(cleanKeep({}, 3)).toEqual({ from_answers: [] });
    expect(cleanKeep({ from_answers: "0" }, 3)).toEqual({ from_answers: [] });
  });
  it("keep の不備では、まとめの検査（checkSummary）は落ちない", () => {
    const s = { ...base(), keep: { from_answers: [99] } };
    expect(checkSummary(s, 3).ok).toBe(true);
  });
});

describe("cleanSuggestions：答えの候補の検査", () => {
  const q = "乾かした後と朝の、どちらが特に気になりますか？";

  it("問いの中の言葉どおりの候補は残る", () => {
    expect(cleanSuggestions(q, ["乾かした後", "朝"])).toEqual(["乾かした後", "朝"]);
  });
  it("前後の空白と「」『』は外してから比べる（返すのは外した後の文）", () => {
    expect(cleanSuggestions(q, [" 「乾かした後」 ", "『朝』"])).toEqual(["乾かした後", "朝"]);
  });
  it("問いの文に無い候補は、黙って落とす", () => {
    expect(cleanSuggestions(q, ["乾かした後", "夜"])).toEqual(["乾かした後"]);
  });
  it("空・20文字を超える物は落とす（20文字ちょうどは残る）", () => {
    const long = "あ".repeat(20);
    expect(cleanSuggestions(`${long}と${long}1ですか？`, ["", "  ", long, `${long}1`])).toEqual([long]);
  });
  it("決めた言い方・原因の推測・施術の提案は落とす", () => {
    const qq = "広がるのは乾かし方のせいですか、それともカットをおすすめしますか、ボブにしましょうか？";
    expect(cleanSuggestions(qq, ["乾かし方のせいです", "おすすめ", "カットをおすすめします", "ボブにしましょう"])).toEqual([]);
    // 問いの文に入っていても、決めた言い方なら落ちる
    expect(cleanSuggestions("乾かし方のせいですか、朝ですか？", ["乾かし方のせいです", "朝"])).toEqual(["朝"]);
  });
  it("同じ物・含み合う物は先に残した方だけ", () => {
    expect(cleanSuggestions(q, ["朝", "朝", "乾かした後", "乾かした"])).toEqual(["朝", "乾かした後"]);
    expect(cleanSuggestions("朝のスタイリングと朝ですか？", ["朝", "朝のスタイリング"])).toEqual(["朝"]);
  });
  it("4つ以上あっても、多くて3つ", () => {
    const qq = "朝・昼・夜・夕方のどれですか？";
    expect(cleanSuggestions(qq, ["朝", "昼", "夜", "夕方"])).toEqual(["朝", "昼", "夜"]);
  });
  it("文字列でない物・配列でない物・記号入りは落とす", () => {
    expect(cleanSuggestions(q, ["朝", 1, null, { a: 1 }])).toEqual(["朝"]);
    expect(cleanSuggestions(q, "朝")).toEqual([]);
    expect(cleanSuggestions(q, undefined)).toEqual([]);
    expect(cleanSuggestions(q, ["？", "気になりますか？"])).toEqual([]);
  });
});

// ---------- 抜け道が戻らないための表（レビューで実際にすり抜けた文） ----------

describe("checkQuestion：決めた言い方・原因の推測・施術の提案はお客様に出さない", () => {
  it.each([
    "お客様の髪は広がりやすい髪質ですね。",
    "それはくせ毛ですね。",
    "それは乾かし方の影響が大きいかもしれませんね。ご自宅ではどう乾かしていますか？",
    "広がりは自然乾燥によるものです。朝は何分くらいかけられますか？",
    "熱いお湯で洗っているから色が落ちるんですね。",
    "カラーが落ちるのはシャンプーのせいかもしれません。",
    "前髪は短めがいいと思います。",
    "その髪質ならショートが似合いますよ。",
    "縮毛矯正が必要かもしれません。",
    "毎朝ドライヤーで根元から乾かしてください。",
    "トリートメントを推奨します。",
    "パーマをかけるのがベストです。",
    "ドライヤーで根元から乾かすといいですよ。",
    "朝は軽く乾かしてみてください。",
    "短めにしてみませんか？",
    "一度ボブにするのもありですね。",
    "共感します。どのあたりが気になりますか？",
    "それはくせ毛ですね、どのあたりが気になりますか？",
    "広がりは乾かし方の影響ですね、ご自宅ではどう乾かしていますか？",
    "それは大変ですね、朝はどのくらい時間がありますか？",
  ])("NG：%s", (t) => {
    const r = checkQuestion(t);
    expect(r.ok, t).toBe(false);
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it.each([
    "これだけは絶対に避けたい、ということはありますか？",
    "毎朝必ずしているお手入れはありますか？",
    "広がる原因に、何か心当たりはありますか？",
    "湿気のせいで広がると感じる日はありますか？",
    "どんな仕上がりが理想でしょう？",
    "あなたは普段、どんな髪型が好きですか？",
    "どのあたりが気になりますか？",
    "どのあたりが一番気になりますか？",
    "乾かした後、横と後ろではどちらが気になりますか？",
    "朝のお手入れには、どのくらい時間をかけられますか？",
    "もう少し詳しく伺ってもよろしいでしょうか？",
    "前髪は、どのくらいの長さが落ち着きますか？",
    "髪質について、気になることはありますか？",
    "気になる所を教えてください？",
  ])("ふつうの問いは通る：%s", (t) => {
    const r = checkQuestion(t);
    expect(r.ok, `${t} ${r.reasons.join("/")}`).toBe(true);
  });

  it("問いは「？」で終わる1文だけ（「？」なしの文は問いにならない）", () => {
    expect(checkQuestion("乾かし方を教えてください。").ok).toBe(false);
    expect(checkQuestion("乾かし方を教えてください。").reasons.join("")).toContain("？");
  });
});

describe("checkFinish：お礼と「当日、美容師が確かめる」だけ", () => {
  it.each([
    "ありがとうございました。広がりは自然乾燥の影響が大きそうです。当日、担当の美容師が確かめます。",
    "ありがとうございました。当日は縮毛矯正をご提案します。",
    "ありがとうございました。",
    "当日、担当の美容師が確かめます。",
    "ありがとうございました。当日、担当の美容師が確かめます。ご自宅では毎日しっかりトリートメントしてください。",
    "ありがとうございました。いただいた内容をもとに、当日、担当の美容師が確かめます。" + "ご来店をお待ちしております。".repeat(8),
  ])("NG：%s", (t) => {
    expect(checkFinish(t).ok, t).toBe(false);
  });

  it("お礼と確かめるだけなら通る（美容師でもスタイリストでも）", () => {
    expect(checkFinish("ありがとうございます。当日、担当のスタイリストが確かめます。").ok).toBe(true);
    expect(checkFinish("ありがとうございます。当日、担当の美容師が確かめます。").ok).toBe(true);
  });
});

describe("checkSummary：推測の言い方", () => {
  const withHint = (text: string, kind: Summary["hints"][number]["kind"] = "cause"): Summary => ({
    hidden_worry: base().hidden_worry,
    hints: [{ kind, text, from_answers: [1] }],
    keep: { from_answers: [] },
  });
  const hintOk = (text: string) => checkSummary(withHint(text), 3).hints[0];

  it.each([
    "自然乾燥が原因である可能性があります。",
    "自然乾燥が広がりの原因だと考えられます。",
    "熱めのお湯が色落ちの原因だと思われます。",
    "乾かし方が影響しているようです。",
    "乾かし方が影響していると推察されます。",
    "自然乾燥で横が広がりやすくなっているようです。",
    "朝の自然乾燥が関わっているかも。",
    "毎朝必ずアイロンで巻いているため、熱が割れやすさにつながっているかもしれません。",
    "「毛先は絶対に薄くしたくない」とのことで、量より形で広がりを抑えたいのかもしれません。",
    "朝は自然乾燥とのことです。乾かし方が広がりに関わっている可能性があります。",
    "毛先を軽くすると広がりが目立つ余地があるかもしれません。",
    "色が抜けやすくなっている可能性があります。",
    "カラー薬剤が残っているのかもしれません。",
  ])("通る（推測の言い方）：%s", (t) => {
    expect(hintOk(t), t).toEqual([]);
  });

  it.each([
    "縮毛矯正がおすすめかもしれません。",
    "毎朝のアイロンは控えた方がいいかもしれません。",
    "毛先を軽くする余地があります。",
    "広がりの原因は自然乾燥です。乾かし方で変わるかもしれません。",
    "自然乾燥が広がりの元であることは、疑う余地がありません。",
    "自然乾燥以外は考えられません。",
    "推測するまでもなく、乾かし方の問題です。",
    "ほかの可能性はありません。広がりは自然乾燥によるものです。",
    "広がりの元は自然乾燥。カットだけで解決できる？",
    "縮毛矯正が必要です。広がりが収まる可能性があります。",
    "縮毛矯正をおすすめします。広がりが減る可能性があります。",
    "毛先は薄くしないでください。軽くすると広がる可能性があります。",
    "髪型はショートボブ一択。似合う可能性が高いです。",
    "原因は自然乾燥です。毛先の重さの可能性もあります。",
    "必ず広がります。",
    "ご希望に合うのは縮毛矯正です。広がりが減る可能性があります。",
    "ご回答の通り、原因は自然乾燥です。乾かし方で変わるかもしれません。",
  ])("NG（決める・言い切る）：%s", (t) => {
    const r = hintOk(t);
    expect(r.length, t).toBeGreaterThan(0);
  });

  it.each([
    "熱いお湯で頭皮が乾燥し、フケが出ている可能性があります。",
    "ストレスで髪が抜けやすくなっている可能性があります。",
    "産後の影響で髪が細くなっているのかもしれません。",
    "皮膚科で相談するのも一つかもしれません。",
    "抜毛症の可能性があります。",
    "ハゲてきている可能性があります。",
    "頭皮環境が悪化しているかもしれません。",
  ])("NG（医療に関わる語）：%s", (t) => {
    expect(hintOk(t).some((x) => x.includes("医療")), t).toBe(true);
  });

  it("隠れた悩みも同じ検査：医療の語・打ち消した推測の語・必ず/絶対の引用", () => {
    const w = (text: string) => {
      const s = base();
      s.hidden_worry.text = text;
      return checkSummary(s, 3).worry;
    };
    expect(w("頭皮の乾燥とフケが本当の悩みです。").length).toBeGreaterThan(0);
    expect(w("ほかの可能性はありません。").length).toBeGreaterThan(0);
    expect(w("広がりの原因は自然乾燥です。").length).toBeGreaterThan(0);
    expect(w("広がりの原因は自然乾燥である可能性があります。")).toEqual([]);
    expect(w("毛先は絶対に薄くしたくない、という気持ちが強いのかもしれません。")).toEqual([]);
  });
});
