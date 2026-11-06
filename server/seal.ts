// 公開モードの保存の暗号。訪問者のクッキーの秘密から鍵を作る（サーバー側に復号の鍵は残らない）。
// 形：v1.<iv>.<暗号文+tag>（base64url）。鍵＝HKDF-SHA256（salt "hashiwatashi"・info "store-v1"）→ AES-256-GCM。
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

function keyOf(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret, "base64url"), "hashiwatashi", "store-v1", 32));
}

/**
 * aad＝この暗号文が置かれる場所の名前（hv1:<訪問者>:<name>）。入れると、別の名前の場所へ差し替えた暗号文は開けなくなる。
 * 保存では必ず渡す。
 */
export function seal(secret: string, plain: string, aad?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyOf(secret), iv);
  if (aad !== undefined) cipher.setAAD(Buffer.from(aad, "utf8"));
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return `v1.${iv.toString("base64url")}.${body.toString("base64url")}`;
}

/** 開けない時（秘密が違う・改ざん・形が違う）は null。中身はログに出さない */
export function open(secret: string, sealed: string, aad?: string): string | null {
  try {
    const parts = sealed.split(".");
    if (parts.length !== 3 || parts[0] !== "v1") return null;
    const iv = Buffer.from(parts[1], "base64url");
    const body = Buffer.from(parts[2], "base64url");
    if (iv.length !== 12 || body.length < 16) return null;
    const decipher = createDecipheriv("aes-256-gcm", keyOf(secret), iv);
    if (aad !== undefined) decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(body.subarray(body.length - 16));
    return Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
