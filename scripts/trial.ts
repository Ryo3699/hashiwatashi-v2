// 試しに通す台本：架空のお客様3人（data/personas.json）を、お客様役のAIが演じて
// lib/interview.ts と最後まで話し、lib/summarize.ts のまとめと検査の結果を runs/<日時>_<id>.json に残す。
//
//   npm run trial                  本物の Claude（ANTHROPIC_API_KEY を環境変数で渡す）
//   npm run trial -- --fake        偽物の Claude（お客様役も偽物・ネット不要）
//   npm run trial -- --only=p1     1人だけ
import fs from "node:fs";
import path from "node:path";
import { FakeClaude, createRealClient, type ClaudeClient, type JsonRequest } from "../lib/claude";
import { MAX_QUESTIONS, MODELS } from "../lib/config";
import { buildInterviewSystem, nextStep, type InterviewResult } from "../lib/interview";
import { buildSummarizeSystem, summarize } from "../lib/summarize";
import { checkSummary } from "../lib/checks";
import type { Turn } from "../lib/types";

type Persona = { id: string; first_words: string; facts: string[] };

// ---------- お客様役 ----------

const PERSONA_MARK = "あなたは美容室に来るお客様を演じます。";

const PERSONA_SCHEMA = {
  type: "object",
  properties: { answer: { type: "string" } },
  required: ["answer"],
  additionalProperties: false,
};

function buildPersonaSystem(p: Persona): string {
  return [
    PERSONA_MARK,
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

function buildPersonaUser(turns: Turn[], question: string): string {
  const past = turns.map((t) => `美容室の人：${t.question}\nあなた：${t.answer}`);
  return [
    ...(past.length ? ["ここまでの会話：", ...past, ""] : []),
    `美容室の人：${question}`,
    "",
    "あなたの答えを JSON で返してください。",
  ].join("\n");
}

async function personaAnswer(p: Persona, turns: Turn[], question: string, claude: ClaudeClient): Promise<string> {
  const raw = (await claude.json({
    model: MODELS.persona,
    system: buildPersonaSystem(p),
    messages: [{ role: "user", content: buildPersonaUser(turns, question) }],
    schema: PERSONA_SCHEMA,
    maxTokens: 3000,
    effort: "low",
  })) as { answer?: unknown } | null;
  const a = raw && typeof raw.answer === "string" ? raw.answer.trim() : "";
  if (!a) throw new Error("お客様役の答えが空でした");
  return a;
}

// ---------- 偽物の Claude（--fake） ----------
// 聞き取り／まとめ／お客様役を、system の中身で見分けて返す。人ごとに1つ作る。

const FAKE_FINISH_AT = 4; // 答えが4つ集まったら終わる
const FAKE_QUESTIONS = [
  "そのお悩みは、普段どんな時に特に気になりますか？",
  "ご自宅では、普段どのようにお手入れされていますか？",
  "仕上がりで、これだけは避けたいということはありますか？",
];
const FAKE_FINISH_TEXT = "ありがとうございます。当日、担当の美容師が確かめます。";

type FakeSummary = { hidden_worry: { text: string; from_answers: number[] }; hints: { kind: string; text: string; from_answers: number[] }[] };

// 番号＝お客様の答えの番号（0＝最初の言葉・1〜3＝persona の facts の順）
const FAKE_SUMMARIES: Record<string, FakeSummary> = {
  p1: {
    hidden_worry: {
      text: "「すいてほしい」の裏に、乾かすと横が広がって顔が四角く見えることが気になっているのかもしれません。",
      from_answers: [0, 1],
    },
    hints: [
      { kind: "cause", text: "横の広がりは、毛量だけでなく毛先の重さや乾き方が関わっている可能性があります。", from_answers: [1, 2] },
      { kind: "home_care", text: "朝が自然乾燥のため、乾かし方でまとまりが変わる余地があるかもしれません。", from_answers: [3] },
      { kind: "hair_and_style", text: "毛先は薄くしたくないので、今の髪質と長さの組み合わせを確かめる必要があるかもしれません。", from_answers: [2] },
    ],
  },
  p2: {
    hidden_worry: {
      text: "「前髪をなんとかしたい」の裏に、夕方に前髪が割れて見た目が崩れることが気になっているのかもしれません。",
      from_answers: [0, 1],
    },
    hints: [
      { kind: "home_care", text: "毎朝アイロンで巻いているため、形のつき方が夕方までもたない可能性があります。", from_answers: [2] },
      { kind: "hair_and_style", text: "おでこを全部は出したくないので、前髪の量や幅が今の分け目と合っているか確かめる余地があるかもしれません。", from_answers: [3] },
      // 検査で外れるヒント（推測の言い方でなく言い切り）→ removed に残る
      { kind: "cause", text: "前髪が割れるのは湿気のせいです。", from_answers: [1] },
    ],
  },
  p3: {
    hidden_worry: {
      text: "「カラーがすぐ落ちる」の裏に、2週間で黄色っぽくなり、仕事柄きれいな色を保ちたいことが気になっているのかもしれません。",
      from_answers: [0, 1, 3],
    },
    hints: [
      { kind: "home_care", text: "毎晩熱めのお湯で洗っていることが、色の抜けに関わっている可能性があります。", from_answers: [2] },
      { kind: "hair_and_style", text: "暗すぎる色は避けたいので、今の明るさだと色味の変化が目立ちやすいのかもしれません。", from_answers: [3] },
      // 1回目だけ入れる NG のヒント（作り直しで消える）
      { kind: "cause", text: "色が落ちるのはシャンプーが合っていないからです。", from_answers: [2] },
    ],
  },
};

function countAnswers(content: string): number {
  return (content.match(/<answer index="/g) ?? []).length;
}

function makeFake(p: Persona): FakeClaude {
  const interviewSystem = buildInterviewSystem();
  const summarizeSystem = buildSummarizeSystem();
  let personaCalls = 0;
  return new FakeClaude((req: JsonRequest) => {
    const content = req.messages[0]?.content ?? "";
    const isRetry = content.includes("前回の返事は");

    if (req.system === interviewSystem) {
      const n = countAnswers(content);
      if (n >= FAKE_FINISH_AT) return { action: "finish", text: FAKE_FINISH_TEXT };
      // p1 の2つ目の問いだけ、1回目はわざと「？」2つ → 作り直される流れを見せる
      if (p.id === "p1" && n === 2 && !isRetry) {
        return { action: "ask", text: "どこが気になりますか？それとも、朝の時間のことですか？" };
      }
      return { action: "ask", text: FAKE_QUESTIONS[(n - 1) % FAKE_QUESTIONS.length] };
    }

    if (req.system === summarizeSystem) {
      const s = FAKE_SUMMARIES[p.id] ?? FAKE_SUMMARIES.p1;
      // p3 は作り直しの時に NG のヒントを抜く（p2 は抜かない＝外されて removed に残る）
      if (p.id === "p3" && isRetry) return { ...s, hints: s.hints.slice(0, 2) };
      return s;
    }

    // お客様役：最初の言葉のあと、facts を順に1つずつ答える
    const answer = p.facts[personaCalls % p.facts.length];
    personaCalls++;
    return { answer };
  });
}

// ---------- 1人ぶん ----------

type StepLog = { question_no: number; action: string; text: string; source: string; attempts: number; reasons: string[] };

async function runOne(p: Persona, claude: ClaudeClient, stamp: string, mode: "fake" | "real") {
  const turns: Turn[] = [];
  const steps: StepLog[] = [];
  const record = (r: InterviewResult) =>
    steps.push({ question_no: turns.length + 1, action: r.action, text: r.text, source: r.source, attempts: r.attempts, reasons: r.reasons });

  let step = await nextStep(turns, claude); // 最初は決まった問い
  record(step);
  let answer = p.first_words; // 最初の答えは persona の first_words
  for (let guard = 0; guard <= MAX_QUESTIONS; guard++) {
    if (step.action !== "ask") break;
    turns.push({ question: step.text, answer });
    step = await nextStep(turns, claude);
    record(step);
    if (step.action !== "ask") break;
    answer = await personaAnswer(p, turns, step.text, claude);
  }
  if (step.action !== "finish") throw new Error("聞き取りが終わりませんでした（lib の不具合）");

  const sum = await summarize(turns, claude);
  const check = checkSummary(sum.summary, turns.length);

  const out = {
    persona: p,
    mode,
    models: MODELS,
    turns,
    steps,
    questions_asked: turns.length,
    summary: sum.summary,
    removed: sum.removed,
    summarize_attempts: sum.attempts,
    summarize_failed: sum.failed,
    final_check: check,
  };
  const dir = path.resolve(process.cwd(), "runs");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${stamp}_${p.id}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");

  const kinds = sum.summary.hints.map((h) => h.kind).join("・") || "なし";
  const retried = steps.filter((s) => s.source === "retry").length;
  const fell = steps.filter((s) => s.source === "fallback").length;
  console.log(
    `${p.id}：${turns.length}問で終了／ヒント${sum.summary.hints.length}件（${kinds}）／検査で外した数 ${sum.removed.length}` +
      `／聞き取りの作り直し ${retried}・定型に落ちた ${fell}／まとめ呼び出し ${sum.attempts}回${sum.failed ? "（まとめ失敗）" : ""}` +
      `\n    → ${path.relative(process.cwd(), file)}`,
  );
  return out;
}

// ---------- 入口 ----------

async function main() {
  const args = process.argv.slice(2);
  const fake = args.includes("--fake");
  const onlyArg = args.find((a) => a.startsWith("--only="));
  const only = onlyArg ? onlyArg.slice("--only=".length) : null;

  const all = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "data/personas.json"), "utf8")) as Persona[];
  const list = only ? all.filter((p) => p.id === only) : all;
  if (list.length === 0) {
    console.error(`--only=${only} に合うお客様がいません（${all.map((p) => p.id).join("・")}）`);
    process.exit(2);
  }

  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

  console.log(`試し台本（${fake ? "偽物の Claude" : "本物の Claude"}・${list.length}人）`);
  const real = fake ? null : createRealClient();
  let failed = 0;
  for (const p of list) {
    try {
      await runOne(p, fake ? makeFake(p) : (real as ClaudeClient), stamp, fake ? "fake" : "real");
    } catch (e) {
      failed++;
      console.log(`${p.id}：失敗 — ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(failed === 0 ? "全員、最後まで通りました" : `${failed}人が最後まで通りませんでした`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
