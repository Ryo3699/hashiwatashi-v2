// 機械の検査。AI の出力をコードで確かめる。語のリストは名前付きの定数にしてある（直す時はここだけ）。
import { HINT_KINDS, type Hint, type InterviewStep, type Summary } from "./types";

// ---------- 語のリスト ----------

/**
 * お客様に向ける文で使ってはいけない「決めた言い方」（原因の見立て・施術のすすめも含む）。
 * 「髪質」「くせ毛」「影響」「必要」のような、ふつうの問いにも出る語は、ここには入れない。
 * 断定の文は checkQuestion の「問いの形」（「？」で終わる1文だけ）で止める。
 */
export const DECIDED_PHRASES: RegExp[] = [
  /あなたの(髪|毛|髪質|クセ|くせ|頭)/,
  /お客様の(髪|毛)(は|が|質)/,
  /ましょう/,
  /た方が(いい|よい|良い)/,
  /る方が(いい|よい|良い)/,
  /方が(いい|よい|良い)(です|でしょう)/,
  /べき/,
  /おすすめ|オススメ|お勧め|推奨|ご提案|提案します/,
  /原因(は|です|だ|でしょう)/,
  /(の|が)せい(だ|です|ではない|じゃない)/,
  /診断/,
  /間違いなく|確実|に決まっ/,
  /違いありません/,
  /でしょう(?![か？?])/,
  /ベスト|一択/,
  /似合(います|いそう|うと思)/,
  /(いい|良い|よい)と思います(?!か)/,
  /(いい|良い|よい)ですよ/,
  /といい(です|よ|と思)/,
  /てみません/,
  /のもあり/,
  /影響(が大き|して(い|る))/,
  /による(もの)?(です|だ)/,
];

/** 「〜ですね、」のように、読点でつないだ前置きの文（句点で切れていなくても別の文として数える） */
const SOFT_BREAK = /(ですね|ますね|ですよね|ましたね|でしたね|よね|ですよ)[、，,]/;

/** 「〜してください」のうち、問いとして使える言い方（「教えてください」など）。これ以外の「ください」は指示になる */
const ASK_FOR_INFO = /(教え|聞かせ|話し|伝え|知らせ|答え|記入|選ん)[^。]*ください/;

/** 終わりの文に入れてはいけない語（お礼と「当日、美容師が確かめる」だけにする） */
export const FINISH_EXTRA_PHRASES: RegExp[] = [
  /原因|影響|髪質|くせ毛|クセ毛|必要|似合|ダメージ|広がり/,
  /矯正|パーマ|縮毛|ブリーチ|トリートメント|カット|カラー/,
];

/** 終わりの文の長さの上限 */
const FINISH_MAX_CHARS = 100;

/** 否定された「推測の語」。実は一番強い言い切り（推測としては数えない） */
export const NEGATED_HEDGE_PHRASES: RegExp[] = [
  /疑う余地/,
  /(余地|可能性)(は|が|も)?(ありません|ない|ゼロ|皆無)/,
  /考えられ(ません|ない)/,
  /思われ(ません|ない)/,
  /推測するまでもな/,
];

/** 美容師向けのまとめで使ってはいけない言い切り・決める言い方（「」の中の、お客様の言葉は見ない） */
export const ASSERTIVE_PHRASES: RegExp[] = [
  /明らかに|断定|間違いなく|確実|に違いな|に決まっ/,
  // 必ず・絶対：お客様の習慣や「〜したくない」の気持ちを書き写す時は止めない
  /(必ず|絶対)(?!.{0,12}(たくない|避けたい|したい|嫌|いや|ほしくない|ている|ています|ていて|ており))/,
  // 原因の言い切り。「〜である可能性」「〜だと考えられます」のように推測が続く時は止めない
  /(が|の)原因(です|だ|である|でしょう)(?!.*(可能性|かもしれ|考えられ|思われ|ようです|のでは))/,
  /原因は.{0,20}(です|だ|である)(?!.*(可能性|かもしれ|考えられ|思われ|ようです|のでは))/,
  /(の|が)せい(です|だ|である)/,
  /ましょう|べき|ください/,
  /方が(いい|よい|良い|ベター)/,
  /おすすめ|オススメ|お勧め|推奨|ご提案|提案します/,
  /必要(です|だ|でしょう|があります|がある(?!かも|可能性|のでは|ように))/,
  /一択|ベスト/,
  /による(もの)?(です|だ|である)/,
  /診断/,
  /あなたの(髪|毛|髪質)は/,
  ...NEGATED_HEDGE_PHRASES,
];

/** 「推測」の言い方（ヒントの文は、このどれかが入る。「？」は推測と数えない） */
export const HEDGE_PHRASES: RegExp[] = [
  /かもしれ/,
  /かも$/,
  /可能性/,
  /ではないか/,
  /のでは(ない|ありません)/,
  /考えられ/,
  /思われ/,
  /ような(気|印象)/,
  /推測/,
  /推察/,
  /(よう|そう)(です|だ|に見え|に思|に感じ)/,
  /ように(見え|思え|感じ)/,
  /おそらく|恐らく|もしかすると|もしかしたら|たぶん|多分/,
];

/** お客様が言ったことを書き写す文（推測の言い方が無くてもよい） */
export const RESTATE_PHRASES: RegExp[] = [
  /とのこと/,
  /と(答え|話し|言っ|おっしゃ|述べ|回答|伝え)/,
  /という(お話|ご回答|言葉|声|ご希望|ご要望|ご意見)/,
];

/** 医療に関わる語（原因として書かない） */
export const MEDICAL_WORDS: RegExp[] = [
  /脱毛/,
  /抜毛/,
  /抜け毛/,
  /(髪|毛)(が|の)?抜け/,
  /薄毛/,
  /はげ|ハゲ|禿/,
  /円形/,
  /AGA/i,
  /病気|疾患|疾病/,
  /皮膚炎|湿疹|脂漏|乾癬|アトピー/,
  /炎症/,
  /頭皮/,
  /フケ|ふけ/,
  /産後|妊娠|出産/,
  /ホルモン|更年期|貧血|甲状腺/,
  /病院|受診|治療|医師|医療|皮膚科|クリニック|副作用/,
  /薬(?!剤|液)/,
  /毛量(の)?減/,
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

/** 「。」「？」「！」と改行で文に分ける */
function splitSentences(text: string): string[] {
  return (text ?? "")
    .split(/[。．！!？?\n]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** 「」『』の中（お客様の言葉の引用）を外す */
function stripQuotes(text: string): string {
  return text.replace(/「[^」]*」|『[^』]*』/g, "");
}

function assertiveHits(text: string): string[] {
  const out = new Set<string>();
  for (const sentence of splitSentences(text)) {
    for (const w of hits(stripQuotes(sentence), ASSERTIVE_PHRASES)) out.add(w);
  }
  return [...out];
}

function hasHedge(plainSentence: string): boolean {
  let t = plainSentence;
  for (const re of NEGATED_HEDGE_PHRASES) t = t.replace(new RegExp(re.source, "g"), "");
  return hits(t, HEDGE_PHRASES).length > 0;
}

function isRestatement(sentence: string): boolean {
  const plain = stripQuotes(sentence).trim();
  return plain === "" || hits(plain, RESTATE_PHRASES).length > 0;
}

export type CheckResult = { ok: boolean; reasons: string[] };

// ---------- お客様に出す文 ----------

/** 決めた言い方（問いにも終わりの文にも共通） */
function checkDecided(t: string): string[] {
  const reasons: string[] = [];
  for (const w of hits(t, DECIDED_PHRASES)) {
    reasons.push(`決めた言い方（または原因の見立て）があります：「${w}」`);
  }
  if (/ください/.test(t) && !ASK_FOR_INFO.test(t)) {
    reasons.push("お願い・指示の言い方があります：「ください」");
  }
  return reasons;
}

/**
 * お客様に聞く問いの検査：
 *  - 「？」は1つだけで、文の終わりに置く。「？」の前に別の文（共感・見立て・提案）を置かない
 *  - 決めた言い方（原因の見立て・施術のすすめ）が無い
 */
export function checkQuestion(text: string): CheckResult {
  const reasons: string[] = [];
  const t = (text ?? "").trim();
  if (!t) reasons.push("空の文です");
  const q = countQuestionMarks(t);
  if (q >= 2) reasons.push(`「？」が${q}つあります（1回に聞くのは1問だけ）`);
  if (t && q === 1) {
    if (!/[？?]$/.test(t)) {
      reasons.push("問いは「？」で終わる1文だけにしてください");
    } else if (/[。．！!\n]/.test(t.slice(0, -1)) || SOFT_BREAK.test(t.slice(0, -1))) {
      reasons.push("「？」の前に別の文があります（共感・見立て・提案の前置きを置かない。問い1文だけ）");
    }
  } else if (t && q === 0) {
    reasons.push("問いになっていません（「？」で終わる1文にしてください）");
  }
  reasons.push(...checkDecided(t));
  return { ok: reasons.length === 0, reasons };
}

/** 終わりの文の検査：問いにしない／決めた言い方を使わない／お礼と「当日、美容師が確かめる」だけ */
export function checkFinish(text: string): CheckResult {
  const reasons: string[] = [];
  const t = (text ?? "").trim();
  if (!t) reasons.push("空の文です");
  reasons.push(...checkDecided(t));
  if (countQuestionMarks(t) > 0) reasons.push("終わりの文に「？」があります（もう聞かない）");
  if (t) {
    if (t.length > FINISH_MAX_CHARS) reasons.push(`終わりの文が長すぎます（${FINISH_MAX_CHARS}字まで）`);
    if (splitSentences(t).length > 3) reasons.push("終わりの文は3文までにしてください");
    if (!/ありがとう/.test(t) || !/美容師|スタイリスト/.test(t)) {
      reasons.push("終わりの文は、お礼と「当日、担当の美容師が確かめます」の意味だけにしてください");
    }
    for (const w of hits(t, FINISH_EXTRA_PHRASES)) {
      reasons.push(`終わりの文に入れない語があります：「${w}」`);
    }
  }
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
  for (const w of assertiveHits(hw.text)) worry.push(`言い切り・決める言い方：「${w}」`);
  for (const w of hits(hw.text, MEDICAL_WORDS)) worry.push(`医療に関わる語：「${w}」`);

  const hints = summary.hints.map((h) => {
    const rs: string[] = [];
    if (!(HINT_KINDS as readonly string[]).includes(h.kind)) {
      rs.push(`kind が3つのどれでもありません：「${String(h.kind)}」`);
    }
    if (!h.text.trim()) rs.push("ヒントの文が空です");
    rs.push(...checkFromAnswers(h.from_answers, answersCount));
    // 全部の文が推測の言い方か（お客様の言葉の書き写しの文は除く）。1つでも言い切りの文があれば NG
    const sentences = splitSentences(h.text);
    const plain = sentences.map((x) => stripQuotes(x));
    const unhedged = sentences.filter((x, i) => !hasHedge(plain[i]) && !isRestatement(x));
    if (!plain.some((x) => hasHedge(x))) {
      rs.push("推測の言い方（〜かもしれない／〜の可能性）になっていません");
    } else if (unhedged.length > 0) {
      rs.push(`推測の言い方になっていない文があります：「${unhedged[0].slice(0, 30)}」`);
    }
    for (const w of assertiveHits(h.text)) rs.push(`言い切り・決める言い方：「${w}」`);
    for (const w of hits(h.text, MEDICAL_WORDS)) rs.push(`医療に関わる語：「${w}」`);
    return rs;
  });

  const reasons = [
    ...worry.map((r) => `隠れた悩み：${r}`),
    ...hints.flatMap((rs, i) => rs.map((r) => `ヒント${i}：${r}`)),
  ];
  return { ok: reasons.length === 0, worry, hints, reasons };
}
