// 審査用リンク（公開モード）の入口。Next.js 16 では middleware が proxy という名前になった。
// HASHI_PUBLIC=1 の時だけ働く：訪問者のクッキー・止める・回数の上限・検索に載せない。手元（HASHI_PUBLIC なし）は素通り。
// 仕様＝docs/judge_link.md
import { NextResponse, type NextRequest } from "next/server";
import { kv } from "./server/kv";
import {
  hashIp,
  isDemoOff,
  isFakeOnVercel,
  isMutating,
  isSummaryPath,
  isPublicMode,
  isVisitorSecret,
  jstDay,
  jstHour,
  limits,
  limitsMisconfigured,
  newVisitorSecret,
  routeKind,
  summaryLimits,
  visitorId,
  VISITOR_COOKIE,
  VISITOR_MAX_AGE_SEC,
} from "./server/public";

const MSG_NO_COOKIE = "最初の画面から、同じブラウザで開いてください。";
const MSG_LIMIT = "今日のお試しの上限に達しました。時間をおいてお試しください。";
const MSG_BUSY = "ただいま混み合っています。しばらくしてからお試しください。";
const MSG_PAUSED = "審査用のお試しは、いま止めています。";
const MSG_NOT_READY = "いま準備中です。しばらくしてからお試しください。";

const DAY_TTL = 2 * 24 * 3600;
const HOUR_TTL = 2 * 3600;

function finish<T extends NextResponse>(res: T): T {
  res.headers.set("X-Robots-Tag", "noindex");
  return res;
}

function jsonError(error: string, status: number): NextResponse {
  return finish(NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } }));
}

function pausedPage(): NextResponse {
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>審査用のお試し</title></head><body style="font-family:sans-serif;max-width:390px;margin:0 auto;padding:48px 20px;line-height:1.8"><p>${MSG_PAUSED}</p></body></html>`;
  return finish(
    new NextResponse(html, {
      status: 503,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    }),
  );
}

function clientIp(req: NextRequest): string {
  // Vercel 上は Vercel が付ける x-vercel-forwarded-for を先に見る（x-forwarded-for は客が足せる）。Vercel 以外では信用しない
  const vercel = process.env.VERCEL ? req.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() : undefined;
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return vercel || fwd || req.headers.get("x-real-ip")?.trim() || "unknown";
}

/** 回数を数えて、通してよいか。数えられない時は throw（呼び出し側が 503 にする） */
async function admit(request: NextRequest, secret: string): Promise<"ok" | "limit"> {
  const lim = limits();
  const ipKey = `rl:ip:${jstHour()}:${hashIp(clientIp(request))}`;
  const globalKey = `rl:g:${jstDay()}`;
  const counts = await kv.incrMany([
    { key: `rl:v:${jstDay()}:${visitorId(secret)}`, ttlSec: DAY_TTL },
    { key: ipKey, ttlSec: HOUR_TTL },
    { key: globalKey, ttlSec: DAY_TTL },
  ]);
  if (counts[0] > lim.visitorDay || counts[1] > lim.ipHour || counts[2] > lim.globalDay) {
    // 1つの IP が断られ続けても、全体の枠を食い潰さないよう、その IP の分は全体から戻す（戻せなくても断る）
    if (counts[1] > lim.ipHour) {
      await kv.incrMany([{ key: globalKey, ttlSec: DAY_TTL, by: -1 }]).catch(() => undefined);
    }
    return "limit";
  }
  // まとめ（Opus）は1回が重いので、別枠でも数える（interview と同じ1回にしない）
  if (isSummaryPath(request.nextUrl.pathname)) {
    const sl = summaryLimits();
    const sums = await kv.incrMany([
      { key: `rl:sum:g:${jstDay()}`, ttlSec: DAY_TTL },
      { key: `rl:sum:ip:${jstHour()}:${hashIp(clientIp(request))}`, ttlSec: HOUR_TTL },
    ]);
    if (sums[0] > sl.day || sums[1] > sl.ipHour) return "limit";
  }
  return "ok";
}

/** リクエストの Cookie ヘッダから hv を外して、新しい hv を足す（同じリクエストの中のサーバー側からも読めるように） */
function cookieHeaderWith(existing: string | null, secret: string): string {
  const kept = (existing ?? "")
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith(`${VISITOR_COOKIE}=`));
  kept.push(`${VISITOR_COOKIE}=${secret}`);
  return kept.join("; ");
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  // 画面でないもの、と、読むだけでない呼び出し（POST など）は、API と同じ扱い（クッキー必須・数える）
  const guarded = routeKind(pathname) === "api" || isMutating(request.method);

  if (!isPublicMode()) {
    // 手元は素通り。Vercel 上で HASHI_PUBLIC を付け忘れた時は、上限なしで Claude を呼ばせない
    if (process.env.VERCEL) return guarded ? jsonError(MSG_NOT_READY, 503) : pausedPage();
    return NextResponse.next();
  }

  if (isDemoOff()) return guarded ? jsonError(MSG_PAUSED, 503) : pausedPage();
  // 偽物の Claude を公開しない
  if (guarded && isFakeOnVercel()) return jsonError(MSG_NOT_READY, 503);

  const current = request.cookies.get(VISITOR_COOKIE)?.value;

  if (guarded) {
    if (!isVisitorSecret(current)) return jsonError(MSG_NO_COOKIE, 401);
    // 上限の設定が壊れている（0・誤記）時は、既定値に戻さず止める
    if (limitsMisconfigured()) return jsonError(MSG_NOT_READY, 503);
    if (isMutating(request.method)) {
      // 数えられない時は通さない（上限なしで通す道を作らない）
      let verdict: "ok" | "limit";
      try {
        verdict = await admit(request, current);
      } catch {
        return jsonError(MSG_BUSY, 503);
      }
      if (verdict === "limit") return jsonError(MSG_LIMIT, 429);
    }
    return finish(NextResponse.next());
  }

  if (isVisitorSecret(current)) return finish(NextResponse.next());

  // 画面：クッキーが無い・形が違う時は新しく作る
  const secret = newVisitorSecret();
  const headers = new Headers(request.headers);
  headers.set("cookie", cookieHeaderWith(request.headers.get("cookie"), secret));
  const res = NextResponse.next({ request: { headers } });
  res.cookies.set({
    name: VISITOR_COOKIE,
    value: secret,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: VISITOR_MAX_AGE_SEC,
  });
  return finish(res);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
