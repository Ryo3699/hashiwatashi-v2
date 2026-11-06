// お客様の画面 → 次の問い or 終わりの文。会話はサーバー側（data/runtime/）に残す。
// POST { customerId, action: "start" }  … 最初から始める（最初の問いを返す）
// POST { customerId, answer }           … いまの問いへの答えを足して、次の1手を返す
import { MAX_QUESTIONS } from "../../../lib/config";
import { nextStep } from "../../../lib/interview";
import { getClaude } from "../../../server/claude";
import { emptySession, findCustomer, loadSession, saveSession, withLock } from "../../../server/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_ANSWER_INPUT = 1000;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request): Promise<Response> {
  let body: { customerId?: unknown; action?: unknown; answer?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "形が正しくありません" }, 400);
  }
  const customer = findCustomer(body.customerId);
  if (!customer) return json({ error: "お客様が見つかりません" }, 404);
  const id = customer.id;

  try {
    return await withLock(id, async () => {
      // 最初から
      if (body.action === "start") {
        const first = await nextStep([], getClaude());
        const s = emptySession(id);
        s.pending = first.text;
        await saveSession(s);
        return json({ action: "ask", text: first.text, answered: 0, max: MAX_QUESTIONS });
      }

      // 答えを足す
      if (typeof body.answer !== "string" || !body.answer.trim()) {
        return json({ error: "答えが空です" }, 400);
      }
      const answer = body.answer.trim().slice(0, MAX_ANSWER_INPUT);
      const s = await loadSession(id);
      if (!s || s.pending === null) return json({ error: "まだ始まっていません" }, 409);
      if (s.finished) return json({ error: "もう終わっています" }, 409);

      const turns = [...s.turns, { question: s.pending, answer }];
      const step = await nextStep(turns, getClaude());
      const next = {
        ...s,
        turns,
        pending: step.action === "ask" ? step.text : null,
        finished: step.action === "finish",
        finishText: step.action === "finish" ? step.text : null,
      };
      await saveSession(next);
      // 画面には、文と「終わりか」だけ返す（検査の理由などは返さない）
      return json({
        action: step.action,
        text: step.text,
        answered: turns.length,
        max: MAX_QUESTIONS,
      });
    });
  } catch (e) {
    console.error("[api/interview]", e instanceof Error ? e.message : "error");
    return json({ error: "うまく送れませんでした" }, 500);
  }
}
