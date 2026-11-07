// カルテ（美容師が施術の後に書く短いメモ）。AI は使わない。
// POST { customerId, did, next, visitId? } … 今の来店（Session.visitId）のカルテとして保存（同じ来店なら上書き）。
//   visitId＝画面が見ている来店（美容師の画面は必ず送る）。今の来店と違えば 409（画面が古い）＝別の来店に混ぜない
//   返り値 { karte: { current, previous } }
import { KARTE_MAX_LEN, KARTE_VISIT_CHANGED } from "../../../lib/types";
import { cleanKarteText, saveKarteEntry } from "../../../server/karte";
import { findCustomer, loadSession, withLock } from "../../../server/store";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request): Promise<Response> {
  let body: { customerId?: unknown; did?: unknown; next?: unknown; visitId?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "形が正しくありません" }, 400);
  }
  const customer = findCustomer(body?.customerId);
  if (!customer) return json({ error: "お客様が見つかりません" }, 404);
  if (body.visitId !== undefined && typeof body.visitId !== "string") return json({ error: "形が正しくありません" }, 400);
  const visitId = body.visitId;
  const text = cleanKarteText(body.did, body.next);
  if (!text) return json({ error: `「やったこと」「次に確かめること」のどちらかを${KARTE_MAX_LEN}字までで書いてください` }, 400);

  try {
    return await withLock(customer.id, async () => {
      const s = await loadSession(customer.id);
      // 画面を開いた後に、お客様が「最初から」をやり直した（＝画面の来店はもう無い）。今の来店に混ぜない
      if (visitId !== undefined && s?.visitId !== visitId) {
        return json(
          { error: "お客様の聞き取りが、最初からやり直されています。画面を読み込み直してください", code: KARTE_VISIT_CHANGED },
          409,
        );
      }
      if (!s || !s.finished) return json({ error: "聞き取りがまだ終わっていません" }, 409);
      return json({ karte: await saveKarteEntry(s, text) });
    });
  } catch (e) {
    console.error("[api/karte POST]", e instanceof Error ? e.message : "error");
    return json({ error: "カルテを残せませんでした" }, 500);
  }
}
