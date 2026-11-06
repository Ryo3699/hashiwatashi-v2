// 設定はここ1か所。モデル名を変える時はここだけ直す。
// 公開モード（HASHI_PUBLIC=1）の時だけ、HASHI_INTERVIEW_MODEL / HASHI_SUMMARY_MODEL で上書きできる（既定は下の値）。
function modelOr(envName: string, fallback: string): string {
  if (process.env.HASHI_PUBLIC !== "1") return fallback;
  return process.env[envName]?.trim() || fallback;
}

export const MODELS = {
  /** 来店前の聞き取り（1問ずつ） */
  get interview(): string {
    return modelOr("HASHI_INTERVIEW_MODEL", "claude-sonnet-5-5");
  },
  /** 美容師向けのまとめ */
  get summarize(): string {
    return modelOr("HASHI_SUMMARY_MODEL", "claude-opus-5-5");
  },
  /** scripts/trial.ts のお客様役 */
  persona: "claude-sonnet-5-5",
};

/** 聞く問いの最大数。7問目の答えが来たら必ず終わる。 */
export const MAX_QUESTIONS = 7;

/** 最初の問い（決まった文。Claude は呼ばない）。画面も trial もこの定数を使う。 */
export const FIRST_QUESTION = "今日いちばん気になっていることは何ですか？";

/** 終わりの文（短いお礼＋当日美容師が確かめる）。AI の文が検査に落ちた時や7問目の後に使う。 */
export const FINISH_TEXT =
  "ありがとうございました。いただいた内容をもとに、当日、担当の美容師が確かめます。";

/** 決まった候補（最初の問い以外のすべての問いに、AI の候補の後ろに付ける） */
export const FIXED_SUGGESTIONS = ["特にないです", "うまく言えないです"];

/** お客様の答え1つの最大文字数（プロンプトに入れる前に切る） */
export const MAX_ANSWER_CHARS = 500;

/**
 * 鍵は process.env.ANTHROPIC_API_KEY だけから読む。
 * ここ以外で鍵を探さない・ファイルに書かない。
 */
export function getApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error("ANTHROPIC_API_KEY が未設定です（環境変数で渡してください）");
  }
  return key;
}
