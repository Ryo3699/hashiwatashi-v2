// Claude を呼ぶ口は ここ1つ。本物と偽物（テスト・--fake 用）を差し替えられる。
import Anthropic from "@anthropic-ai/sdk";
import { getApiKey } from "./config";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type JsonRequest = {
  model: string;
  system: string;
  messages: ChatMessage[];
  /** 返してほしい JSON の形（JSON Schema・additionalProperties:false を付ける） */
  schema: Record<string, unknown>;
  maxTokens?: number;
};

/** Claude の口。JSON（構造化出力）で受け取る。形の検証は呼ぶ側（checks.ts）がする。 */
export interface ClaudeClient {
  json(req: JsonRequest): Promise<unknown>;
}

// ---------- 本物 ----------

/** createRealClient に差し込める最小の SDK の形（テストでは偽物を渡す） */
export type MessagesApi = {
  messages: {
    create(params: Record<string, unknown>): Promise<{
      content: Array<{ type: string; text?: string }>;
      stop_reason?: string | null;
    }>;
  };
};

/**
 * 本物。SDK の構造化出力（output_config.format = json_schema）で JSON を受ける。
 * Anthropic のクライアントは最初の呼び出しまで作らない（import しただけでは env を読まない）。
 */
export function createRealClient(sdk?: MessagesApi): ClaudeClient {
  let cached: MessagesApi | undefined = sdk;
  const getSdk = (): MessagesApi => {
    if (!cached) cached = new Anthropic({ apiKey: getApiKey() }) as unknown as MessagesApi;
    return cached;
  };

  return {
    async json(req) {
      const res = await getSdk().messages.create({
        model: req.model,
        max_tokens: req.maxTokens ?? 1500,
        system: req.system,
        messages: req.messages,
        output_config: { format: { type: "json_schema", schema: req.schema } },
      });
      const text = res.content
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join("");
      if (!text.trim()) {
        throw new Error(`Claude の返事が空でした（stop_reason=${res.stop_reason ?? "?"}）`);
      }
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`Claude の返事が JSON になっていません: ${text.slice(0, 120)}`);
      }
    },
  };
}

// ---------- 偽物 ----------

/** 返事そのもの、または (依頼, 何回目か) => 返事 の関数（型の上では unknown と同じ） */
export type FakeReply = unknown;

/**
 * 偽物。決まった返事を順に返す。
 *  - new FakeClaude([a, b, c])  : 1回目は a、2回目は b …（足りなくなったら例外）
 *  - new FakeClaude([a], { repeatLast: true }) : 最後の返事を使い回す
 *  - new FakeClaude((req, i) => ...) : 呼ばれるたびに関数で作る（--fake の台本用）
 * 返事が関数なら (req, 何回目か) で呼んで、その戻り値を返す。
 * calls に、受け取った依頼を全部残す（再試行の回数・プロンプトの中身をテストで確かめる）。
 */
export class FakeClaude implements ClaudeClient {
  readonly calls: JsonRequest[] = [];
  private queue: FakeReply[] | null;
  private fn: ((req: JsonRequest, callIndex: number) => unknown) | null;
  private repeatLast: boolean;

  constructor(
    replies: FakeReply[] | ((req: JsonRequest, callIndex: number) => unknown),
    opts: { repeatLast?: boolean } = {},
  ) {
    if (typeof replies === "function") {
      this.fn = replies;
      this.queue = null;
    } else {
      this.fn = null;
      this.queue = [...replies];
    }
    this.repeatLast = opts.repeatLast ?? false;
  }

  async json(req: JsonRequest): Promise<unknown> {
    const i = this.calls.length;
    this.calls.push(req);
    if (this.fn) return this.fn(req, i);
    const q = this.queue as FakeReply[];
    let reply: FakeReply;
    if (i < q.length) reply = q[i];
    else if (this.repeatLast && q.length > 0) reply = q[q.length - 1];
    else throw new Error(`FakeClaude: 返事が足りません（${i + 1}回目の呼び出し）`);
    return typeof reply === "function"
      ? (reply as (r: JsonRequest, n: number) => unknown)(req, i)
      : reply;
  }
}
