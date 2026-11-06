// カルテ（美容師が施術の後に書く短いメモ）。AI は使わない。
// POST { customerId, did, next } … 今の来店（Session.visitId）のカルテとして保存（同じ来店なら上書き）。
//   返り値 { karte: { current, previous } }
import { cleanKarteText, saveKarteEntry } from "../../../server/karte";
import { findCustomer, loadSession, withLock } from "../../../server/store";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request): Promise<Response> {
  let body: { customerId?: unknown; did?: unknown; next?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "形が正しくありません" }, 400);
  }
  const customer = findCustomer(body?.customerId);
  if (!customer) return json({ error: "お客様が見つかりません" }, 404);
  const text = cleanKarteText(body.did, body.next);
  if (!text) return json({ error: "「やったこと」「次に確かめること」のどちらかを200字までで書いてください" }, 400);

  try {
    return await withLock(customer.id, async () => {
      const s = await loadSession(customer.id);
      if (!s || !s.finished) return json({ error: "聞き取りがまだ終わっていません" }, 409);
      return json({ karte: await saveKarteEntry(s, text) });
    });
  } catch (e) {
    console.error("[api/karte POST]", e instanceof Error ? e.message : "error");
    return json({ error: "カルテを残せませんでした" }, 500);
  }
}
