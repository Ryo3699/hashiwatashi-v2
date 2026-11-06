// カルテの保存。お客様ごとに <runtimeDir>/<id>.karte.json へ、来店ごとの美容師のメモを残す。
// 会話のファイル（<id>.json）とは別＝聞き取りを「最初から」やり直しても消えない。AI は使わない。
import { promises as fs } from "node:fs";
import path from "node:path";
import { KARTE_MAX_LEN, type KarteEntry, type KarteView } from "../lib/types";
import { findCustomer, runtimeDir, withLock, type Session } from "./store";

type KarteFile = { customerId: string; entries: KarteEntry[] };

function fileOf(id: string): string {
  // id は customers.json にある物だけ通す（findCustomer 済み）。念のためここでも確かめる。
  if (!findCustomer(id)) throw new Error("知らないお客様の番号です");
  return path.join(runtimeDir(), `${id}.karte.json`);
}

function normalizeEntry(e: KarteEntry): KarteEntry {
  return { ...e, wish: e.wish ?? null, keep: Array.isArray(e.keep) ? e.keep : [] };
}

export async function loadKarte(id: string): Promise<KarteFile> {
  try {
    const f = JSON.parse(await fs.readFile(fileOf(id), "utf8")) as KarteFile;
    return { customerId: id, entries: (f.entries ?? []).map(normalizeEntry) };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { customerId: id, entries: [] };
    throw e;
  }
}

/** 今の来店のカルテと、それ以外で一番新しいカルテ。session が無ければ current は null */
export function karteView(entries: KarteEntry[], session: Session | null): KarteView {
  const visitId = session?.visitId ?? null;
  const current = visitId ? (entries.find((e) => e.visitId === visitId) ?? null) : null;
  let previous: KarteEntry | null = null;
  for (const e of entries) {
    if (e.visitId === visitId) continue;
    if (!previous || e.savedAt > previous.savedAt) previous = e;
  }
  return { current, previous };
}

/** お客様の言葉を、Session から原文のまま写す（参照しない＝やり直した後も残る） */
export function copyFromSession(s: Session): { wish: string | null; keep: string[] } {
  const wish = s.turns[0]?.answer ?? null;
  const keep: string[] = [];
  if (s.result && !s.result.failed) {
    const seen = new Set<number>();
    for (const n of s.result.summary.keep?.from_answers ?? []) {
      if (!Number.isInteger(n) || n < 0 || n >= s.turns.length || seen.has(n)) continue;
      seen.add(n);
      keep.push(s.turns[n].answer);
    }
  }
  return { wish, keep };
}

/** 今の来店のカルテを保存（同じ visitId があれば上書き）。did・next は呼び出し側で整える（前後の空白・字数） */
export async function saveKarteEntry(s: Session, input: { did: string; next: string }): Promise<KarteView> {
  return withLock(`karte:${s.customerId}`, async () => {
    const file = fileOf(s.customerId);
    const karte = await loadKarte(s.customerId);
    const entry: KarteEntry = {
      visitId: s.visitId,
      savedAt: new Date().toISOString(),
      ...copyFromSession(s),
      did: input.did,
      next: input.next,
    };
    const i = karte.entries.findIndex((e) => e.visitId === s.visitId);
    if (i >= 0) karte.entries[i] = entry;
    else karte.entries.push(entry);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(karte, null, 2), "utf8");
    await fs.rename(tmp, file);
    return karteView(karte.entries, s);
  });
}

/** 画面から来た文字を整える。形が違う・両方空・長すぎる時は null */
export function cleanKarteText(did: unknown, next: unknown): { did: string; next: string } | null {
  if (typeof did !== "string" || typeof next !== "string") return null;
  const d = did.trim();
  const n = next.trim();
  if (!d && !n) return null;
  if (d.length > KARTE_MAX_LEN || n.length > KARTE_MAX_LEN) return null;
  return { did: d, next: n };
}
