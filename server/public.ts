// 公開モード（審査用リンク）の共通の決まり。HASHI_PUBLIC=1 の時だけ働く。proxy.ts からも読むので、next/headers や fs は入れない。
// 仕様＝docs/judge_link.md
import { createHash, createHmac, randomBytes } from "node:crypto";

/** 訪問者のクッキー名。値は 32 バイトの乱数の base64url（43 文字） */
export const VISITOR_COOKIE = "hv";
/** クッキーの寿命（72 時間） */
export const VISITOR_MAX_AGE_SEC = 72 * 60 * 60;
/** Redis に置く保存の寿命（書くたびに付け直す・72 時間） */
export const RECORD_TTL_SEC = 259200;

export function isPublicMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.HASHI_PUBLIC === "1";
}

export function isDemoOff(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.HASHI_DEMO_OFF === "1";
}

/** Vercel 上で偽物の Claude になっている（公開してはいけない組み合わせ） */
export function isFakeOnVercel(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.VERCEL) && env.HASHI_FAKE === "1";
}

/** 訪問者の秘密の形（43 文字の base64url で、32 バイトに戻って、元の文字に戻るもの） */
export function isVisitorSecret(v: unknown): v is string {
  if (typeof v !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(v)) return false;
  const bytes = Buffer.from(v, "base64url");
  return bytes.length === 32 && bytes.toString("base64url") === v;
}

export function newVisitorSecret(): string {
  return randomBytes(32).toString("base64url");
}

/** 訪問者の名前（保存・回数の数え方に使う。秘密そのものは外に出さない） */
export function visitorId(secret: string): string {
  return createHash("sha256").update(`hashiwatashi:id:${secret}`).digest("hex").slice(0, 32);
}

/**
 * IP は生のまま保存しない。鍵つきのハッシュ（HMAC-SHA256）の頭 24 文字。
 * 鍵＝HASHI_IP_SALT、無ければ Redis のトークンから作る（IPv4 は総当たりできるので、鍵なしの sha256 にはしない）。
 * 手元の試し（HASHI_KV=memory）でトークンが無い時だけ決まった文字列。
 */
export function hashIp(ip: string, env: NodeJS.ProcessEnv = process.env): string {
  const material =
    env.HASHI_IP_SALT || env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || "local-only";
  return createHmac("sha256", `hashiwatashi:ip:${material}`).update(ip).digest("hex").slice(0, 24);
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** 読むだけの呼び出し（GET・HEAD・OPTIONS）以外か */
export function isMutating(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

/**
 * パスを、デコードして「.」「..」「//」「\\」を畳み、小文字にした部品に分ける。
 * %61pi や api%2F のような書き方でも Next 本体は API ルートに届けるので、生の文字列では判定しない。
 * デコードできない・何度デコードしても安定しないものは null（呼び出し側が閉じる側で扱う）。
 */
export function canonicalPath(pathname: string): string[] | null {
  let p = pathname;
  try {
    let stable = false;
    for (let i = 0; i < 5; i++) {
      const d = decodeURIComponent(p);
      if (d === p) {
        stable = true;
        break;
      }
      p = d;
    }
    if (!stable) return null;
  } catch {
    return null;
  }
  const out: string[] = [];
  for (const seg of p.replace(/\\/g, "/").toLowerCase().split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out;
}

/** 画面と認めるのは "/"・"/customer/…"・"/stylist/…" だけ。それ以外（読めない書き方も）は API 扱い */
export function routeKind(pathname: string): "page" | "api" {
  const segs = canonicalPath(pathname);
  if (!segs) return "api";
  if (segs.length === 0) return "page";
  return (segs[0] === "customer" || segs[0] === "stylist") && segs.length >= 2 ? "page" : "api";
}

/** /api/summary（Opus・1回が重い）か。読めない書き方は重い方として数える */
export function isSummaryPath(pathname: string): boolean {
  const segs = canonicalPath(pathname);
  return !segs || (segs.length === 2 && segs[0] === "api" && segs[1] === "summary");
}

/** 日本時間の日付（YYYY-MM-DD） */
export function jstDay(now: number = Date.now()): string {
  return new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 日本時間の日付＋時（YYYY-MM-DDTHH） */
export function jstHour(now: number = Date.now()): string {
  return new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 13);
}

function intEnv(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return v !== undefined && v.trim() !== "" && Number.isInteger(n) && n > 0 ? n : fallback;
}

const LIMIT_ENV_NAMES = [
  "HASHI_LIMIT_VISITOR_DAY",
  "HASHI_LIMIT_IP_HOUR",
  "HASHI_LIMIT_GLOBAL_DAY",
  "HASHI_LIMIT_SUMMARY_DAY",
  "HASHI_LIMIT_SUMMARY_IP_HOUR",
];

/** 上限の環境変数が「設定されているのに正の整数でない」（0・誤記）。止めたつもりで既定値に戻るのを防ぐため、proxy は 503 にする */
export function limitsMisconfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return LIMIT_ENV_NAMES.some((name) => {
    const v = env[name];
    if (v === undefined || v.trim() === "") return false;
    const n = Number(v);
    return !(Number.isInteger(n) && n > 0);
  });
}

/** まとめ（Opus・1回の費用が重い）だけの別枠。全体/日と、IP/時 */
export function summaryLimits(env: NodeJS.ProcessEnv = process.env) {
  return {
    day: intEnv(env.HASHI_LIMIT_SUMMARY_DAY, 150),
    ipHour: intEnv(env.HASHI_LIMIT_SUMMARY_IP_HOUR, 10),
  };
}

export function limits(env: NodeJS.ProcessEnv = process.env) {
  return {
    visitorDay: intEnv(env.HASHI_LIMIT_VISITOR_DAY, 80),
    ipHour: intEnv(env.HASHI_LIMIT_IP_HOUR, 120),
    globalDay: intEnv(env.HASHI_LIMIT_GLOBAL_DAY, 600),
  };
}
