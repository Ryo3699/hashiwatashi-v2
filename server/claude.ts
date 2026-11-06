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

/** 聞き取り用の台本（答えの数で次の問い）。決めた言い方・「？」2つを含まない文だけ。 */
const FAKE_QUESTIONS = [
  "それは、どんな時に特に気になりますか？",
  "ご自宅では、普段どのようにお手入れされていますか？",
  "仕上がりで、これだけは避けたいということはありますか？",
];

function createFake(): ClaudeClient {
  const wait = () => new Promise((r) => setTimeout(r, 500));
  return {
    async json(req: JsonRequest) {
      await wait();
      const text = req.messages[req.messages.length - 1]?.content ?? "";
      if (req.system === buildSummarizeSystem()) return fakeSummary(text);
      const n = (text.match(/<answer index="/g) ?? []).length;
      if (n >= 3) return { action: "finish", text: FINISH_TEXT };
      return { action: "ask", text: FAKE_QUESTIONS[Math.max(n - 1, 0)] };
    },
  };
}

function fakeSummary(userMessage: string) {
  const n = (userMessage.match(/<answer index="/g) ?? []).length;
  const last = Math.max(n - 1, 0);
  const pick = (i: number) => Math.min(i, last);
  return {
    hidden_worry: {
      text: "言葉にした手段の裏に、朝の手間や、仕上がりの見え方への不安があるのかもしれません。",
      from_answers: [0, pick(1)],
    },
    hints: [
      {
        kind: "cause",
        text: "乾かし方や毛量のバランスで、形が崩れやすくなっている可能性があります。",
        from_answers: [pick(1)],
      },
      {
        kind: "home_care",
        text: "ご自宅での乾かし方や手入れの手順が、仕上がりに影響しているかもしれません。",
        from_answers: [pick(1)],
      },
      {
        kind: "hair_and_style",
        text: "今の髪質と髪型の組み合わせが、少し合っていないのではないかと考えられます。",
        from_answers: [pick(2)],
      },
    ],
  };
}
