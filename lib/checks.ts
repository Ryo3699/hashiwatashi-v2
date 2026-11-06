// 機械の検査。AI の出力をコードで確かめる。語のリストは名前付きの定数にしてある（直す時はここだけ）。
import { HINT_KINDS, type Hint, type InterviewStep, type Summary } from "./types";

// ---------- 語のリスト ----------

/** お客様に向ける文で使ってはいけない「決めた言い方」（原因の見立ても含む） */
export const DECIDED_PHRASES: RegExp[] = [
  /あなたの(髪|毛|髪質|クセ|くせ|頭)/,
  /あなたは/,
  /にしましょう/,
  /ましょう/,
  /した方が(いい|よい|良い)/,
  /する方が(いい|よい|良い)/,
  /方が(いい|よい|良い)(です|でしょう)/,
  /べき/,
  /おすすめ|オススメ|お勧め/,
  /原因/,
  /(の|が)せい(で|だ|です)/,
  /診断/,
  /間違いなく|必ず|絶対|確実/,
  /違いありません|に決まっ/,
  /でしょう(?!か)/,
];

/** 美容師向けのまとめで使ってはいけない言い切り・決める言い方 */
export const ASSERTIVE_PHRASES: RegExp[] = [
  /必ず|絶対|間違いなく|確実|明らかに|断定|に違いな|に決まっ/,
  /(が|の)原因(です|だ|である|でしょう)/,
  /(の|が)せい(です|だ|である)/,
  /ましょう|べき|にしてください/,
  /(した|する)方が(いい|よい|良い)/,
  /診断/,
  /あなたの(髪|毛|髪質)は/,
];

/** 「推測」の言い方（ヒントには、このどれかが入る） */
export const HEDGE_PHRASES: RegExp[] = [
  /かもしれ/,
  /可能性/,
  /ではないか/,
  /のでは(ない|ありません)/,
  /考えられ/,
  /思われ/,
  /ような(気|印象)/,
  /推測/,
  /余地/,
  /[？?]/,
];

/** 医療に関わる語（原因として書かない） */
export const MEDICAL_WORDS: RegExp[] = [
  /脱毛/,
  /抜け毛/,
  /薄毛/,
  /円形/,
  /AGA/i,
  /病気|疾患|疾病/,
  /皮膚炎|湿疹|脂漏|乾癬|アトピー/,
  /炎症/,
  /頭皮の(病|炎症|トラブル|かゆみ|痒み|荒れ|異常)/,
  /ホルモン|更年期|貧血|甲状腺/,
  /病院|受診|治療|医師|医療/,
];

// ---------- 小道具 ----------

function hits(text: string, list: RegExp[]): string[] {
  const out: string[] = [];
  for (const re of list) {
    const m = text.match(re);
    if (m) out.push(m[0]);
  }
  return out;
}

function countQuestionMarks(text: string): number {
  return (text.match(/[？?]/g) ?? []).length;
}

export type CheckResult = { ok: boolean; reasons: string[] };

// ---------- お客様に出す文 ----------

/** お客様に聞く問い（または文）の検査：「？」2つ以上／決めた言い方 → NG */
export function checkQuestion(text: string): CheckResult {
  const reasons: string[] = [];
  const t = (text ?? "").trim();
  if (!t) reasons.push("空の文です");
  const q = countQuestionMarks(t);
  if (q >= 2) reasons.push(`「？」が${q}つあります（1回に聞くのは1問だけ）`);
  for (const w of hits(t, DECIDED_PHRASES)) {
    reasons.push(`決めた言い方（または原因の見立て）があります：「${w}」`);
  }
  return { ok: reasons.length === 0, reasons };
}

/** 終わりの文の検査：問いにしない／決めた言い方を使わない */
export function checkFinish(text: string): CheckResult {
  const base = checkQuestion(text);
  const reasons = [...base.reasons];
  if (countQuestionMarks(text ?? "") > 0) reasons.push("終わりの文に「？」があります（もう聞かない）");
  return { ok: reasons.length === 0, reasons };
}

// ---------- 形の確かめ（Claude の返事は信用しない） ----------

export function parseInterviewStep(raw: unknown): InterviewStep | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if ((r.action !== "ask" && r.action !== "finish") || typeof r.text !== "string") return null;
  return { action: r.action, text: r.text };
}

/** 形だけ確かめる（中身の良し悪しは checkSummary）。kind の値や番号の範囲はここでは見ない */
export function parseSummary(raw: unknown): Summary | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const hw = r.hidden_worry as Record<string, unknown> | undefined;
  if (!hw || typeof hw !== "object" || typeof hw.text !== "string" || !Array.isArray(hw.from_answers)) {
    return null;
  }
  if (!Array.isArray(r.hints)) return null;
  const hints: Hint[] = [];
  for (const h of r.hints) {
    if (!h || typeof h !== "object") return null;
    const x = h as Record<string, unknown>;
    if (typeof x.kind !== "string" || typeof x.text !== "string" || !Array.isArray(x.from_answers)) {
      return null;
    }
    hints.push({ kind: x.kind as Hint["kind"], text: x.text, from_answers: x.from_answers as number[] });
  }
  return {
    hidden_worry: { text: hw.text, from_answers: hw.from_answers as number[] },
    hints,
  };
}

// ---------- 美容師向けのまとめ ----------

export type SummaryCheck = {
  ok: boolean;
  /** hidden_worry の NG の理由（無ければ空） */
  worry: string[];
  /** hints と同じ並び。各ヒントの NG の理由（無ければ空） */
  hints: string[][];
  /** 全部を平らにした理由（作り直しの指示に使う） */
  reasons: string[];
};

function checkFromAnswers(fa: unknown, answersCount: number): string[] {
  if (!Array.isArray(fa) || fa.length === 0) return ["from_answers が空です（根拠の無いものは出さない）"];
  const bad = fa.filter((n) => !Number.isInteger(n) || (n as number) < 0 || (n as number) >= answersCount);
  if (bad.length > 0) {
    return [`from_answers に存在しない番号があります：${JSON.stringify(bad)}（答えは0〜${answersCount - 1}番）`];
  }
  return [];
}

/**
 * まとめの検査。
 *  - from_answers が実在の番号か（hidden_worry も各ヒントも）
 *  - ヒント：kind が3つのどれか／推測の言い方が入るか／言い切りの語が無いか／医療の語が無いか
 *  - hidden_worry：空でない／言い切りの語・医療の語が無いか
 */
export function checkSummary(summary: Summary, answersCount: number): SummaryCheck {
  const worry: string[] = [];
  const hw = summary.hidden_worry;
  if (!hw.text.trim()) worry.push("隠れた悩みの文が空です");
  worry.push(...checkFromAnswers(hw.from_answers, answersCount));
  for (const w of hits(hw.text, ASSERTIVE_PHRASES)) worry.push(`言い切り・決める言い方：「${w}」`);
  for (const w of hits(hw.text, MEDICAL_WORDS)) worry.push(`医療に関わる語：「${w}」`);

  const hints = summary.hints.map((h) => {
    const rs: string[] = [];
    if (!(HINT_KINDS as readonly string[]).includes(h.kind)) {
      rs.push(`kind が3つのどれでもありません：「${String(h.kind)}」`);
    }
    if (!h.text.trim()) rs.push("ヒントの文が空です");
    rs.push(...checkFromAnswers(h.from_answers, answersCount));
    if (hits(h.text, HEDGE_PHRASES).length === 0) {
      rs.push("推測の言い方（〜かもしれない／〜の可能性）になっていません");
    }
    for (const w of hits(h.text, ASSERTIVE_PHRASES)) rs.push(`言い切り・決める言い方：「${w}」`);
    for (const w of hits(h.text, MEDICAL_WORDS)) rs.push(`医療に関わる語：「${w}」`);
    return rs;
  });

  const reasons = [
    ...worry.map((r) => `隠れた悩み：${r}`),
    ...hints.flatMap((rs, i) => rs.map((r) => `ヒント${i}：${r}`)),
  ];
  return { ok: reasons.length === 0, worry, hints, reasons };
}
