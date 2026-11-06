// サーバー側の保存。お客様ごとに data/runtime/<id>.json へ会話とまとめを残す（.gitignore 済み）。
// 録画の練習で再起動しても残る／API ルートごとにモジュールが分かれても同じ物を見る、ためにファイルにしている。
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import customers from "../data/customers.json";
import type { Summary, Turn } from "../lib/types";

export type StoredResult = { summary: Summary; removedCount: number; failed: boolean };

export type Session = {
  customerId: string;
  /** 来店の区切り。「最初から」で新しくなる。カルテはこれごとに1件 */
  visitId: string;
  turns: Turn[];
  /** いまお客様に出している問い（次の答えは、この問いへの答え） */
  pending: string | null;
  /** いま出している問いの、答えの候補（決まった候補も含めた、画面に出す全部） */
  pendingSuggestions: string[];
  finished: boolean;
  finishText: string | null;
  result: StoredResult | null;
  updatedAt: string;
};

export function findCustomer(id: unknown): { id: string; name: string } | null {
  if (typeof id !== "string") return null;
  return customers.find((c) => c.id === id) ?? null;
}

export function runtimeDir(): string {
  return process.env.HASHI_RUNTIME_DIR || path.join(process.cwd(), "data", "runtime");
}

function fileOf(id: string): string {
  // id は customers.json にある物だけ通す（findCustomer 済み）。念のためここでも確かめる。
  if (!findCustomer(id)) throw new Error("知らないお客様の番号です");
  return path.join(runtimeDir(), `${id}.json`);
}

export function emptySession(customerId: string): Session {
  return {
    customerId,
    visitId: randomUUID(),
    turns: [],
    pending: null,
    pendingSuggestions: [],
    finished: false,
    finishText: null,
    result: null,
    updatedAt: new Date().toISOString(),
  };
}

/** 古い保存（visitId・pendingSuggestions・summary.keep・Turn.via が無い）を、今の形として読めるようにする */
function normalizeSession(s: Session): Session {
  const result = s.result && !s.result.summary.keep
    ? { ...s.result, summary: { ...s.result.summary, keep: { from_answers: [] } } }
    : s.result;
  // visitId が無い古い保存には、読むたびに同じ値を入れる（updatedAt は読むだけでは変わらない）
  const visitId = s.visitId || `legacy-${s.updatedAt}`;
  return { ...s, visitId, pendingSuggestions: s.pendingSuggestions ?? [], result };
}

export async function loadSession(id: string): Promise<Session | null> {
  try {
    const text = await fs.readFile(fileOf(id), "utf8");
    return normalizeSession(JSON.parse(text) as Session);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

export async function saveSession(s: Session): Promise<void> {
  const file = fileOf(s.customerId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ ...s, updatedAt: new Date().toISOString() }, null, 2), "utf8");
  await fs.rename(tmp, file);
}

// ---------- お客様ごとの順番待ち（連打・二重送信で会話が崩れないように） ----------
const chains = new Map<string, Promise<unknown>>();

export function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(id) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  chains.set(
    id,
    next.catch(() => undefined),
  );
  return next;
}
