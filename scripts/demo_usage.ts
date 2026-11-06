// 審査用リンクで使った量（トークン）と目安の金額を出す。
//   npx tsx scripts/demo_usage.ts [日数=7]
// 読むのは環境変数の REST（KV_REST_API_URL / KV_REST_API_TOKEN など）だけ。公開モードの server/claude.ts が足した usage:<日付>:<model>:in|out を読む。
import { MODELS } from "../lib/config";
import { costUsd, lastDays } from "../lib/usage";
import { kv } from "../server/kv";

async function readNum(key: string): Promise<number> {
  const v = await kv.get(key);
  const n = Number(v);
  return v !== null && Number.isFinite(n) ? n : 0;
}

async function main() {
  if (process.env.HASHI_PUBLIC !== "1" && (process.env.HASHI_INTERVIEW_MODEL || process.env.HASHI_SUMMARY_MODEL)) {
    console.error("注意：モデルの上書きは HASHI_PUBLIC=1 の時だけ効きます。配備と同じ環境変数（HASHI_PUBLIC=1 を含む）を付けて回してください。");
  }
  const days = Math.max(1, Math.min(40, Number(process.argv[2]) || 7));
  const models = [...new Set([MODELS.interview, MODELS.summarize])];
  let totalUsd = 0;
  let unknown = false;
  console.log(`直近 ${days} 日（日本時間）の使った量`);
  for (const day of lastDays(days)) {
    for (const model of models) {
      const input = await readNum(`usage:${day}:${model}:in`);
      const output = await readNum(`usage:${day}:${model}:out`);
      if (input === 0 && output === 0) continue;
      const usd = costUsd(model, input, output);
      if (usd === null) unknown = true;
      else totalUsd += usd;
      console.log(
        `${day}  ${model}  入力 ${input.toLocaleString("en-US")}  出力 ${output.toLocaleString("en-US")}  ${usd === null ? "単価不明" : `約 $${usd.toFixed(2)}`}`,
      );
    }
  }
  console.log("※記録は応答のあと最大1.5秒しか待たないので、少なめに出ることがあります。請求の実額は Anthropic のコンソールで見てください。");
  console.log(`合計（目安） 約 $${totalUsd.toFixed(2)}${unknown ? "（単価不明のモデルは含まない）" : ""}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : "失敗しました");
  process.exit(1);
});
