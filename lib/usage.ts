// 使ったトークンから目安の金額を出す（公開モードの使った量の記録用・scripts/demo_usage.ts が使う）。
// 単価は 100 万トークンあたりのドル。目安であって請求額ではない。
export const PRICES_PER_MTOK: { prefix: string; input: number; output: number }[] = [
  { prefix: "claude-sonnet-5-5", input: 2, output: 10 },
  { prefix: "claude-opus-5-5", input: 4, output: 20 },
];

export function priceOf(model: string): { input: number; output: number } | null {
  return PRICES_PER_MTOK.find((p) => model.startsWith(p.prefix)) ?? null;
}

/** 目安の金額（ドル）。単価が分からないモデルは null */
export function costUsd(model: string, inputTokens: number, outputTokens: number): number | null {
  const p = priceOf(model);
  if (!p) return null;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

/** 日本時間の今日から遡った N 日分の日付（今日が先頭） */
export function lastDays(n: number, now: number = Date.now()): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(new Date(now + 9 * 3600 * 1000 - i * 86400 * 1000).toISOString().slice(0, 10));
  return out;
}
