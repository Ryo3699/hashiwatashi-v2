// lib 全体で使う型と、小さな定数。

/** 1往復＝AIの問い1つと、お客様の答え1つ。答えの番号（0始まり）は配列の添字と同じ。 */
export type Turn = { question: string; answer: string };

/** ヒントの種類（Ryo の3つ）：広がる等の原因／家でのケアの仕方／髪質と髪型が合っているか */
export const HINT_KINDS = ["cause", "home_care", "hair_and_style"] as const;
export type HintKind = (typeof HINT_KINDS)[number];

/** 画面の見出し用 */
export const HINT_KIND_LABEL: Record<HintKind, string> = {
  cause: "広がりなどの原因",
  home_care: "家でのケア",
  hair_and_style: "髪質と髪型が合っているか",
};

export type Hint = {
  kind: HintKind;
  /** 推測の言い方（〜かもしれない／〜の可能性） */
  text: string;
  /** もとになったお客様の答えの番号（0始まり） */
  from_answers: number[];
};

export type HiddenWorry = {
  text: string;
  from_answers: number[];
};

export type Summary = {
  hidden_worry: HiddenWorry;
  hints: Hint[];
};

/** 検査に落ちて外したもの */
export type Removed = {
  where: "hidden_worry" | "hint";
  /** 外した本文（kind があれば hint の kind も） */
  text: string;
  kind?: string;
  reasons: string[];
};

export type InterviewAction = "ask" | "finish";
export type InterviewStep = { action: InterviewAction; text: string };
