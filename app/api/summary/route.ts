// 美容師の画面用のまとめ。
// GET  ?customerId=p1  … 今の状態（まだ／回答中／まとめ待ち／できた）と、もとの会話を返す
// POST { customerId }  … 聞き取りが終わっていれば、まとめを作って保存（作成済みならそれを返す）
import { summarize } from "../../../lib/summarize";
import { getClaude } from "../../../server/claude";
import { findCustomer, loadSession, saveSession, withLock, type Session } from "../../../server/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function view(s: Session | null) {
  if (!s || (s.turns.length === 0 && !s.finished)) return { status: "none" as const };
  const base = { turns: s.turns, answered: s.turns.length };
  if (!s.finished) return { status: "interviewing" as const, ...base };
  if (!s.result) return { status: "finished" as const, ...base };
  return {
    status: "ready" as const,
    ...base,
    summary: s.result.summary,
    removedCount: s.result.removedCount,
    failed: s.result.failed,
  };
}

export async function GET(req: Request): Promise<Response> {
  const customer = findCustomer(new URL(req.url).searchParams.get("customerId"));
  if (!customer) return json({ error: "お客様が見つかりません" }, 404);
  try {
    return json(view(await loadSession(customer.id)));
  } catch (e) {
    console.error("[api/summary GET]", e instanceof Error ? e.message : "error");
    return json({ error: "読めませんでした" }, 500);
  }
}

export async function POST(req: Request): Promise<Response> {
  let body: { customerId?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "形が正しくありません" }, 400);
  }
  const customer = findCustomer(body.customerId);
  if (!customer) return json({ error: "お客様が見つかりません" }, 404);

  try {
    return await withLock(customer.id, async () => {
      const s = await loadSession(customer.id);
      if (!s || !s.finished) return json({ error: "聞き取りがまだ終わっていません" }, 409);
      if (s.result) return json(view(s));
      const r = await summarize(s.turns, getClaude());
      const next: Session = {
        ...s,
        result: { summary: r.summary, removedCount: r.removed.length, failed: r.failed },
      };
      // 形が2回壊れて失敗した時は保存しない（「作り直す」でもう一度作れるように）
      if (!r.failed) await saveSession(next);
      return json(view(next));
    });
  } catch (e) {
    console.error("[api/summary POST]", e instanceof Error ? e.message : "error");
    return json({ error: "まとめを作れませんでした" }, 500);
  }
}
