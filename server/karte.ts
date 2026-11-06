// カルテの保存。お客様ごとに <runtimeDir>/<id>.karte.json へ、来店ごとの美容師のメモを残す。
// 会話のファイル（<id>.json）とは別＝聞き取りを「最初から」やり直しても消えない。AI は使わない。
import { KARTE_MAX_LEN, type KarteEntry, type KarteView } from "../lib/types";
import { readText, writeText } from "./storage";
import { findCustomer, withLock, type Session } from "./store";

type KarteFile = { customerId: string; entries: KarteEntry[] };

function nameOf(id: string): string {
  // id は customers.json にある物だけ通す（findCustomer 済み）。念のためここでも確かめる。
  if (!findCustomer(id)) throw new Error("知らないお客様の番号です");
  return `${id}.karte.json`;
}

function normalizeEntry(e: KarteEntry): KarteEntry {
  return {
    ...e,
    wish: e.wish ?? null,
    keep: Array.isArray(e.keep) ? e.keep : [],
    did: typeof e.did === "string" ? e.did : "",
    next: typeof e.next === "string" ? e.next : "",
  };
}

/** 1件として読める形か（手で直して壊れた時に、変な日付や空のカードを出さない） */
function isEntryLike(e: unknown): e is KarteEntry {
  if (!e || typeof e !== "object") return false;
  const x = e as Record<string, unknown>;
  return typeof x.visitId === "string" && typeof x.savedAt === "string";
}

/**
 * カルテを読む。ファイルが無ければ空。壊れていたら（空・途中で切れた JSON・形が違う）ファイル名つきで投げる。
 * 投げる＝保存（saveKarteEntry）が壊れたファイルを1件だけの中身で上書きしない。画面側は karteOf で受け止める。
 */
export async function loadKarte(id: string): Promise<KarteFile> {
  // 無い＝空（ENOENT と、公開モードで開けない保存）。ENOENT 以外の読めない時は今まで通り投げる
  const text = await readText(nameOf(id));
  if (text === null) return { customerId: id, entries: [] };
  let f: unknown;
  try {
    f = JSON.parse(text);
  } catch (e) {
    throw new Error(`${id}.karte.json が読めません（${e instanceof Error ? e.message : "JSON ではない"}）`);
  }
  const entries = f && typeof f === "object" ? (f as { entries?: unknown }).entries ?? [] : null;
  if (!Array.isArray(entries) || !entries.every(isEntryLike)) {
    throw new Error(`${id}.karte.json の形が正しくありません`);
  }
  return { customerId: id, entries: entries.map(normalizeEntry) };
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
    const name = nameOf(s.customerId);
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
    await writeText(name, JSON.stringify(karte, null, 2));
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
