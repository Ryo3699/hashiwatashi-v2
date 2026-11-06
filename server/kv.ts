// 小さな入れ物（公開モードの保存と回数の数え）。本物は Upstash Redis の REST（fetch だけ・新しい道具は足さない）。
// HASHI_KV=memory は手元の試し用（Vercel 上では使えない＝インスタンスごとに分かれて数えられないため）。
// 鍵（トークン）は、投げる文にもログにも入れない。
export type IncrItem = { key: string; ttlSec: number; by?: number };

export interface KvBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec: number): Promise<void>;
  /** 数えた後の値を、渡した順に返す。期限は最初に作った時に付く（SET 0 EX NX → INCR/INCRBY） */
  incrMany(items: IncrItem[]): Promise<number[]>;
}

const TIMEOUT_MS = 3000;

// ---------- Upstash REST ----------

type Cmd = string[];

function restBackend(url: string, token: string): KvBackend {
  const base = url.replace(/\/+$/, "");

  async function pipeline(cmds: Cmd[]): Promise<unknown[]> {
    let res: Response;
    try {
      res = await fetch(`${base}/pipeline`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(cmds),
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new Error("KV に届きませんでした");
    }
    if (!res.ok) throw new Error(`KV がエラーを返しました（HTTP ${res.status}）`);
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new Error("KV の返事が読めません");
    }
    if (!Array.isArray(body) || body.length !== cmds.length) throw new Error("KV の返事の形が違います");
    return body.map((item) => {
      if (!item || typeof item !== "object") throw new Error("KV の返事の形が違います");
      const r = item as { result?: unknown; error?: unknown };
      if (r.error) throw new Error("KV がコマンドを断りました");
      return r.result;
    });
  }

  return {
    async get(key) {
      const [r] = await pipeline([["GET", key]]);
      return typeof r === "string" ? r : null;
    },
    async set(key, value, ttlSec) {
      await pipeline([["SET", key, value, "EX", String(ttlSec)]]);
    },
    async incrMany(items) {
      if (items.length === 0) return [];
      const cmds: Cmd[] = [];
      for (const it of items) {
        cmds.push(["SET", it.key, "0", "EX", String(it.ttlSec), "NX"]);
        cmds.push(it.by === undefined || it.by === 1 ? ["INCR", it.key] : ["INCRBY", it.key, String(it.by)]);
      }
      const out = await pipeline(cmds);
      return items.map((_, i) => {
        const n = Number(out[i * 2 + 1]);
        if (!Number.isFinite(n)) throw new Error("KV の返事の形が違います");
        return n;
      });
    },
  };
}

// ---------- 手元の試し用（メモリ） ----------

type MemEntry = { value: string; expiresAt: number };
type MemGlobal = typeof globalThis & { __hashiMemKv?: Map<string, MemEntry> };

// API ルートや proxy でモジュールが分かれても同じ物を見るよう globalThis に置く
function memStore(): Map<string, MemEntry> {
  const g = globalThis as MemGlobal;
  return (g.__hashiMemKv ??= new Map());
}

function memLive(key: string): MemEntry | undefined {
  const m = memStore();
  const e = m.get(key);
  if (!e) return undefined;
  if (e.expiresAt <= Date.now()) {
    m.delete(key);
    return undefined;
  }
  return e;
}

const memoryBackend: KvBackend = {
  async get(key) {
    return memLive(key)?.value ?? null;
  },
  async set(key, value, ttlSec) {
    memStore().set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
  },
  async incrMany(items) {
    return items.map((it) => {
      let e = memLive(it.key);
      if (!e) {
        e = { value: "0", expiresAt: Date.now() + it.ttlSec * 1000 };
        memStore().set(it.key, e);
      }
      e.value = String(Number(e.value) + (it.by ?? 1));
      return Number(e.value);
    });
  },
};

/** テスト用：メモリの入れ物の中身と残り秒数 */
export function memoryKvEntry(key: string): { value: string; ttlSec: number } | null {
  const e = memLive(key);
  return e ? { value: e.value, ttlSec: Math.round((e.expiresAt - Date.now()) / 1000) } : null;
}

/** テスト用：メモリの入れ物を空にする */
export function resetMemoryKv(): void {
  memStore().clear();
}

// ---------- 入口 ----------

function backend(env: NodeJS.ProcessEnv = process.env): KvBackend {
  if (env.HASHI_KV === "memory") {
    if (env.VERCEL) throw new Error("HASHI_KV=memory は Vercel 上では使えません（数えが分かれるため）");
    return memoryBackend;
  }
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("KV の設定がありません（KV_REST_API_URL / KV_REST_API_TOKEN）");
  return restBackend(url, token);
}

/** 呼ぶたびに環境変数を見る（設定ミスは呼んだ所で投げる＝黙って別の保存先に落ちない） */
export const kv: KvBackend = {
  // async にして、設定ミスの例外も Promise の失敗として返す（同期で投げると呼び出し側の .catch をすり抜ける）
  get: async (key) => backend().get(key),
  set: async (key, value, ttlSec) => backend().set(key, value, ttlSec),
  incrMany: async (items) => backend().incrMany(items),
};
