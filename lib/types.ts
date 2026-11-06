// lib 全体で使う型と、小さな定数。

/**
 * 答えの印（サーバーが決める。画面からの申告は信じない）。
 * chip＝候補のボタンの文そのまま／chip_edited＝候補の文で始まり、お客様が書き足した。印が無い＝自分の言葉。
 */
export type Via = "chip" | "chip_edited";

/** 1往復＝AIの問い1つと、お客様の答え1つ。答えの番号（0始まり）は配列の添字と同じ。 */
export type Turn = { question: string; answer: string; via?: Via };

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

/** 残したい所・避けたいこと。AI の文は持たず、お客様が言った答えの番号だけ（美容師の画面に原文で出す） */
export type Keep = {
  from_answers: number[];
};

export type Summary = {
  hidden_worry: HiddenWorry;
  hints: Hint[];
  keep: Keep;
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

// ---------- カルテ（美容師が施術の後に書く、短いメモ。AI は書かない） ----------
/** カルテの「やったこと」「次に確かめること」の最大字数 */
export const KARTE_MAX_LEN = 200;

export type KarteEntry = {
  /** 来店の区切り（Session.visitId）。同じ来店は1件 */
  visitId: string;
  /** 残した時刻（ISO） */
  savedAt: string;
  /** その来店のお客様の答え1の原文（無ければ null）。保存の時に写す */
  wish: string | null;
  /** その来店の「残したい所・避けたいこと」＝keep が指す答えの原文。保存の時に写す */
  keep: string[];
  /** 今日やったこと（美容師） */
  did: string;
  /** 次に確かめること（美容師） */
  next: string;
};

/** 美容師の画面に渡す形：今の来店のカルテと、前回までで一番新しいカルテ */
export type KarteView = { current: KarteEntry | null; previous: KarteEntry | null };

/** カルテを残す時、画面が見ている来店（visitId）が今の来店と違う＝画面が古い（409 の印） */
export const KARTE_VISIT_CHANGED = "visit_changed";
