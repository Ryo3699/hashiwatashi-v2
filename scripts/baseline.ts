// 素の Claude との比べ：同じ架空のお客様（data/personas.json）を、決まりも検査も無い「ふつうの AI チャット」に通す。
// 聞き取り＝claude-sonnet-5-5（v2 と同じ）・美容師へのまとめ＝claude-opus-5-5（v2 と同じ）・お客様役＝v2 の trial.ts と同じ指示文。
// 違うのは「指示文が短い一言だけ」「構造化出力も検査も作り直しも無い」所だけ。
//
//   ANTHROPIC_API_KEY=... npx tsx scripts/baseline.ts runs/plain [p1,p2,p3]
//
// 出す物：<出力フォルダ>/<id>.json（会話・まとめ・v2 の検査で数えた数）と標準出力の表。
// 数え方は v2 の lib/checks.ts の物差し（＝v2 の決まりで素の Claude を測っている。中身の良さは測っていない）。
// README とデモ動画の数は、2026-11-07 0時台に1回ずつ通した結果（docs/baseline/runs_plain/・表は docs/baseline/RESULT.md）。
// 通し直すと答えが変わるので、出力先は docs/baseline/ にしない。
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { checkQuestion, DECIDED_PHRASES, HEDGE_PHRASES, MEDICAL_WORDS } from "../lib/checks";

type Persona = { id: string; first_words: string; facts: string[] };
type Turn = { question: string; answer: string };

const [outDir, onlyArg] = process.argv.slice(2);
if (!outDir) {
  console.error("使い方: npx tsx scripts/baseline.ts <出力フォルダ> [p1,p2,p3]");
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });
const personas = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "data/personas.json"), "utf8")) as Persona[];
const only = onlyArg ? onlyArg.split(",") : personas.map((p) => p.id);

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MAX_Q = 7;
const FIRST = "今日いちばん気になっていることは何ですか？"; // v2 と同じ最初の問い

// ---- 素の聞き取り（指示は一言だけ） ----
const PLAIN_INTERVIEW_SYSTEM =
  "あなたは美容室の来店前の聞き取りをするAIです。お客様の髪の悩みを聞いてください。聞き終わったら、最後のメッセージの先頭に【おわり】と書いてください。";
const PLAIN_SUMMARY_PROMPT = "上の会話を読んで、担当の美容師向けに、このお客様のカウンセリングに役立つまとめを書いてください。";

function text(res: { content: { type: string; text?: string }[] }): string {
  return res.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
}

async function plainNext(turns: Turn[]): Promise<string> {
  // 会話をふつうのチャットの形で渡す（AI の発言＝assistant、お客様＝user）
  const messages: { role: "user" | "assistant"; content: string }[] = [{ role: "user", content: "（お客様が聞き取りの画面を開きました）" }];
  for (const t of turns) {
    messages.push({ role: "assistant", content: t.question });
    messages.push({ role: "user", content: t.answer });
  }
  const res = await client.messages.create({ model: "claude-sonnet-5-5", max_tokens: 4000, system: PLAIN_INTERVIEW_SYSTEM, messages, output_config: { effort: "low" } } as never);
  return text(res as never);
}

async function plainSummary(turns: Turn[]): Promise<string> {
  const convo = turns.map((t) => `AI：${t.question}\nお客様：${t.answer}`).join("\n\n");
  const res = await client.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    messages: [{ role: "user", content: `${convo}\n\n${PLAIN_SUMMARY_PROMPT}` }],
  } as never);
  return text(res as never);
}

// ---- お客様役（v2 の scripts/trial.ts と同じ指示文） ----
function personaSystem(p: Persona): string {
  return [
    "あなたは美容室に来るお客様を演じます。",
    "あなたが知っている事実は次のものだけです。",
    ...p.facts.map((f) => `- ${f}`),
    "",
    "守ること：",
    "- 聞かれたことにだけ、1〜2文で短く答える。自分から全部は言わない。",
    "- 事実に無いことを聞かれたら、「うーん、特にないです」「あまり考えたことがないです」くらいで返す。作り話を足さない。",
    "- ふつうの話し言葉（です・ます）。美容の専門用語は使わない。",
    '- 返すのは JSON { "answer": お客様の答え } だけ。',
  ].join("\n");
}
async function personaAnswer(p: Persona, turns: Turn[], question: string): Promise<string> {
  const past = turns.map((t) => `美容室の人：${t.question}\nあなた：${t.answer}`);
  const user = [...(past.length ? ["ここまでの会話：", ...past, ""] : []), `美容室の人：${question}`, "", "あなたの答えを JSON で返してください。"].join("\n");
  const res = await client.messages.create({
    model: "claude-sonnet-5-5",
    max_tokens: 3000,
    system: personaSystem(p),
    messages: [{ role: "user", content: user }],
    output_config: { effort: "low", format: { type: "json_schema", schema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false } } },
  } as never);
  const a = JSON.parse(text(res as never)).answer as string;
  return a.trim();
}

// ---- 数える（v2 の物差し） ----
const count = (s: string, re: RegExp) => (s.match(new RegExp(re.source, "g")) ?? []).length;
function sentences(s: string): string[] {
  return s.split(/(?<=[。！？!?\n])/).map((x) => x.trim()).filter((x) => x.length > 0);
}
function measure(turns: Turn[], finalMsg: string, summary: string) {
  const asked = turns.map((t) => t.question);
  const qmarks = asked.map((q) => count(q, /[？?]/));
  const checkFails = asked.slice(1).map((q) => checkQuestion(q)).filter((r) => !r.ok); // 最初の問いは v2 と同じ決まった文なので除く
  const customerFacing = [...asked.slice(1), finalMsg].join("\n");
  const decidedToCustomer = DECIDED_PHRASES.filter((re) => re.test(customerFacing)).map((re) => re.source);
  const sumSents = sentences(summary);
  const decidedInSummary = sumSents.filter((s) => DECIDED_PHRASES.some((re) => re.test(s)));
  const hedgedInSummary = sumSents.filter((s) => HEDGE_PHRASES.some((re) => re.test(s)));
  const medicalInSummary = MEDICAL_WORDS.filter((re) => re.test(summary)).map((re) => re.source);
  // 引用：お客様の答え（8文字以上の部分）が、まとめにそのまま出てくるか
  const quoted = turns.filter((t) => {
    const a = t.answer.replace(/[。、\s]/g, "");
    for (let i = 0; i + 8 <= a.length; i++) if (summary.replace(/[。、\s]/g, "").includes(a.slice(i, i + 8))) return true;
    return false;
  }).length;
  return {
    questions: asked.length,
    multi_question_turns: qmarks.filter((n) => n >= 2).length,
    max_qmarks_in_one_turn: Math.max(...qmarks),
    v2_question_check_fails: checkFails.length,
    v2_question_check_reasons: checkFails.flatMap((r) => r.reasons).slice(0, 6),
    decided_phrases_to_customer: decidedToCustomer,
    summary_chars: summary.length,
    summary_sentences: sumSents.length,
    summary_decided_sentences: decidedInSummary.length,
    summary_decided_examples: decidedInSummary.slice(0, 3),
    summary_hedged_sentences: hedgedInSummary.length,
    summary_medical_words: medicalInSummary,
    answers_quoted_in_summary: `${quoted}/${turns.length}`,
  };
}

async function main() {
  for (const id of only) {
    const p = personas.find((x) => x.id === id);
    if (!p) continue;
    const turns: Turn[] = [];
    let question = FIRST;
    let answer = p.first_words;
    let finalMsg = "";
    for (let i = 0; i < MAX_Q; i++) {
      turns.push({ question, answer });
      const next = await plainNext(turns);
      if (next.startsWith("【おわり】") || turns.length >= MAX_Q) {
        finalMsg = next;
        break;
      }
      question = next;
      answer = await personaAnswer(p, turns, question);
    }
    const summary = await plainSummary(turns);
    const m = measure(turns, finalMsg, summary);
    fs.writeFileSync(path.join(outDir, `${id}.json`), JSON.stringify({ persona: p, mode: "plain", models: { interview: "claude-sonnet-5-5", summary: "claude-opus-5-5" }, system: PLAIN_INTERVIEW_SYSTEM, turns, finalMsg, summary, measure: m }, null, 1));
    console.log(id, JSON.stringify(m));
  }
}

main();
