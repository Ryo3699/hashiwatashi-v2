// API ルートが使う Claude の口。HASHI_FAKE=1 なら偽物（録画の練習用・鍵なしで動く）。
// 鍵は lib/config.ts の getApiKey（process.env.ANTHROPIC_API_KEY）だけが読む。ここでは触らない。
import { createRealClient, type ClaudeClient, type JsonRequest } from "../lib/claude";
import { FINISH_TEXT } from "../lib/config";
import { buildSummarizeSystem } from "../lib/summarize";

export function isFake(): boolean {
  return process.env.HASHI_FAKE === "1";
}

let real: ClaudeClient | undefined;
let fake: ClaudeClient | undefined;

export function getClaude(): ClaudeClient {
  if (isFake()) return (fake ??= createFake());
  return (real ??= createRealClient());
}

/**
 * 聞き取り用の台本（答えの数で次の問い）。決めた言い方・「？」2つを含まない文だけ。
 * 4つの角度（①どこが・いつ ②家でのケア ③今の髪型 ④残したい所・避けたいこと）を1問ずつ聞く。
 */
export const FAKE_QUESTIONS = [
  "それは、乾かした後と朝の、どちらが特に気になりますか？",
  "ご自宅では、普段どのようにお手入れされていますか？",
  "今の髪型や長さで、いちばん困っていることは何ですか？",
  "仕上がりで、残したい所や避けたいことはありますか？",
];

/** FAKE_QUESTIONS と同じ並びの、答えの候補（問いの文の中の言葉）。選択肢を入れない問いは空 */
export const FAKE_SUGGESTIONS: string[][] = [["乾かした後", "朝"], [], [], []];

/** 最初の言葉＋4つの問いの答えが集まったら終わる（4つの角度を聞き終える数） */
export const FAKE_FINISH_AT = FAKE_QUESTIONS.length + 1;

function createFake(): ClaudeClient {
  const wait = () => new Promise((r) => setTimeout(r, 500));
  return {
    async json(req: JsonRequest) {
      await wait();
      const text = req.messages[req.messages.length - 1]?.content ?? "";
      if (req.system === buildSummarizeSystem()) return fakeSummary(text);
      const n = (text.match(/<answer index="/g) ?? []).length;
      if (n >= FAKE_FINISH_AT) return { action: "finish", text: FINISH_TEXT, suggestions: [] };
      const i = Math.max(n - 1, 0);
      return { action: "ask", text: FAKE_QUESTIONS[i], suggestions: FAKE_SUGGESTIONS[i] };
    },
  };
}

type FakeHint = { kind: "cause" | "home_care" | "hair_and_style"; text: string; from_answers: number[] };
type FakeBody = { worry: string; hints: FakeHint[] };

// 番号＝お客様の答えの番号（0＝最初の言葉・1＝どんな時に気になるか・2＝ご自宅での手入れ・3＝今の髪型・4＝残したい所・避けたいこと）。
// 録画の練習で映る画面なので、ヒントの文と、その下に出る「もとの答え」が意味でつながるようにしてある。
const FAKE_BODIES: Record<"volume" | "bangs" | "color" | "generic", FakeBody> = {
  volume: {
    worry: "「すいてほしい」の裏に、乾かした後の横の広がりや、朝の手間が気になっているのかもしれません。",
    hints: [
      { kind: "cause", text: "横の広がりは、毛量だけでなく毛先の重さや乾き方が関わっている可能性があります。", from_answers: [1] },
      { kind: "home_care", text: "ご自宅での乾かし方や手入れの手順が、広がりに影響しているかもしれません。", from_answers: [2] },
      { kind: "hair_and_style", text: "今の髪質と長さの組み合わせが、少し合っていないのではないかと考えられます。", from_answers: [1] },
    ],
  },
  bangs: {
    worry: "「前髪をなんとかしたい」の裏に、時間がたつと前髪が割れたり崩れたりして見えることが気になっているのかもしれません。",
    hints: [
      { kind: "cause", text: "前髪が割れるのは、生え方やクセ、湿気が関わっている可能性があります。", from_answers: [1] },
      { kind: "home_care", text: "朝のスタイリング（乾かし方やアイロン）が、夕方までの持ちに影響しているかもしれません。", from_answers: [2] },
      { kind: "hair_and_style", text: "前髪の量や幅が今の分け目と合っているか、確かめる余地があるかもしれません。", from_answers: [1] },
    ],
  },
  color: {
    worry: "「カラーがすぐ落ちる」の裏に、色味の変化や、きれいな色を保てないことが気になっているのかもしれません。",
    hints: [
      { kind: "cause", text: "色が落ちやすいのは、髪の傷み具合や色の入り方が関わっている可能性があります。", from_answers: [1] },
      { kind: "home_care", text: "洗う時のお湯の温度やシャンプーの選び方が、色持ちに影響しているかもしれません。", from_answers: [2] },
      { kind: "hair_and_style", text: "今の明るさだと、色味の変化が目立ちやすいのではないかと考えられます。", from_answers: [1] },
    ],
  },
  generic: {
    worry: "言葉にした手段の裏に、朝の手間や、仕上がりの見え方への不安があるのかもしれません。",
    hints: [
      { kind: "cause", text: "乾かし方や毛量のバランスで、形が崩れやすくなっている可能性があります。", from_answers: [1] },
      { kind: "home_care", text: "ご自宅での乾かし方や手入れの手順が、仕上がりに影響しているかもしれません。", from_answers: [2] },
      { kind: "hair_and_style", text: "今の髪質と髪型の組み合わせが、少し合っていないのではないかと考えられます。", from_answers: [1] },
    ],
  },
};

function fakeTopic(userMessage: string): keyof typeof FAKE_BODIES {
  const first = userMessage.match(/<answer index="0"[^>]*>([\s\S]*?)<\/answer>/)?.[1] ?? "";
  const all = userMessage.match(/<answer index="\d+"[^>]*>[\s\S]*?<\/answer>/g)?.join("\n") ?? "";
  for (const text of [first, all]) {
    if (/前髪/.test(text)) return "bangs";
    if (/カラー|染め|色落ち|色が落ち/.test(text)) return "color";
    if (/すい|量|ボリューム|広が/.test(text)) return "volume";
  }
  return "generic";
}

/** 最初の答えを見て、合うまとめを選ぶ。from_answers は、実際にある答えの番号に収める */
export function fakeSummary(userMessage: string) {
  const n = (userMessage.match(/<answer index="/g) ?? []).length;
  const last = Math.max(n - 1, 0);
  const body = FAKE_BODIES[fakeTopic(userMessage)];
  const clip = (xs: number[]) => [...new Set(xs.map((i) => Math.min(i, last)))];
  return {
    hidden_worry: { text: body.worry, from_answers: clip([0, 1]) },
    hints: body.hints.map((h) => ({ ...h, from_answers: clip(h.from_answers) })),
    // 最後の問い（④）の答えがある時だけ、その番号を入れる
    keep: { from_answers: n >= FAKE_FINISH_AT ? [FAKE_FINISH_AT - 1] : [] },
  };
}
