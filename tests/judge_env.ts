// 審査用リンクのテストで使う、環境変数の出し入れ。公開モードの設定だけを退避して、終わったら戻す。
const KEYS = [
  "HASHI_PUBLIC",
  "HASHI_DEMO_OFF",
  "HASHI_KV",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "VERCEL",
  "HASHI_FAKE",
  "HASHI_LIMIT_VISITOR_DAY",
  "HASHI_LIMIT_IP_HOUR",
  "HASHI_LIMIT_GLOBAL_DAY",
  "HASHI_INTERVIEW_MODEL",
  "HASHI_SUMMARY_MODEL",
  "HASHI_RUNTIME_DIR",
];

let saved: Record<string, string | undefined> = {};

export function clearJudgeEnv(): void {
  saved = {};
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
}

export function restoreJudgeEnv(): void {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}
