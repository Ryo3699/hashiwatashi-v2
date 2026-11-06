// 保存の読み書きの口。名前（p1.json・p1.karte.json）で読み書きする。
//  - 手元（HASHI_PUBLIC なし）：<runtimeDir>/<name> のファイル。一時ファイル → rename。今までと同じ動き。
//  - 公開モード（HASHI_PUBLIC=1）：訪問者のクッキー（hv）ごとに分け、秘密から作った鍵で暗号化して Redis に置く。
//    クッキーが無い・形が違う時は専用のエラーを投げる（共有の名前に落とさない）。
import { promises as fs } from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { kv } from "./kv";
import { isPublicMode, isVisitorSecret, RECORD_TTL_SEC, visitorId, VISITOR_COOKIE } from "./public";
import { open, seal } from "./seal";

export function runtimeDir(): string {
  return process.env.HASHI_RUNTIME_DIR || path.join(process.cwd(), "data", "runtime");
}

/** 公開モードで、訪問者のクッキーが無い・形が違う */
export class VisitorRequiredError extends Error {
  readonly status = 401;
  constructor() {
    super("訪問者のクッキーがありません");
    this.name = "VisitorRequiredError";
  }
}

function checkName(name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || name.includes("..")) {
    throw new Error("保存の名前が正しくありません");
  }
}

async function visitorSecret(): Promise<string> {
  const v = (await cookies()).get(VISITOR_COOKIE)?.value;
  if (!isVisitorSecret(v)) throw new VisitorRequiredError();
  return v;
}

/**
 * 順番待ち（withLock）の仕切り。公開モードは訪問者ごと（別の審査員が同じ番号のお客様で待ち合わないように）。
 * 手元は空文字。クッキーが読めない時も投げない（そのあとの読み書きが専用のエラーを投げる）。
 */
export async function lockScope(): Promise<string> {
  if (!isPublicMode()) return "";
  try {
    return visitorId(await visitorSecret());
  } catch {
    return "novisitor";
  }
}

function redisKey(secret: string, name: string): string {
  return `hv1:${visitorId(secret)}:${name}`;
}

export async function readText(name: string): Promise<string | null> {
  checkName(name);
  if (isPublicMode()) {
    const secret = await visitorSecret();
    const sealed = await kv.get(redisKey(secret, name));
    if (sealed === null) return null;
    return open(secret, sealed, redisKey(secret, name)); // 開けない時は「無い」と同じ（置き場の名前も確かめる）
  }
  try {
    return await fs.readFile(path.join(runtimeDir(), name), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

export async function writeText(name: string, text: string): Promise<void> {
  checkName(name);
  if (isPublicMode()) {
    const secret = await visitorSecret();
    const key = redisKey(secret, name);
    await kv.set(key, seal(secret, text, key), RECORD_TTL_SEC);
    return;
  }
  const file = path.join(runtimeDir(), name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, text, "utf8");
  await fs.rename(tmp, file);
}
