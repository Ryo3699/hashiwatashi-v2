// 審査用リンク：保存（手元のファイル／公開モードの暗号化 Redis）と暗号。
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryKvEntry, resetMemoryKv, kv } from "../server/kv";
import { newVisitorSecret, visitorId } from "../server/public";
import { open, seal } from "../server/seal";
import { readText, VisitorRequiredError, writeText } from "../server/storage";
import { saveKarteEntry, loadKarte } from "../server/karte";
import { emptySession, loadSession, saveSession } from "../server/store";
import { clearJudgeEnv, restoreJudgeEnv } from "./judge_env";

const h = vi.hoisted(() => ({ cookie: undefined as string | undefined, calls: 0 }));
vi.mock("next/headers", () => ({
  cookies: async () => {
    h.calls++;
    return { get: (name: string) => (name === "hv" && h.cookie !== undefined ? { name, value: h.cookie } : undefined) };
  },
}));

let dir: string;
beforeEach(() => {
  clearJudgeEnv();
  resetMemoryKv();
  h.cookie = undefined;
  h.calls = 0;
  dir = mkdtempSync(path.join(tmpdir(), "hashi-judge-"));
});
afterEach(() => {
  vi.useRealTimers();
  restoreJudgeEnv();
  rmSync(dir, { recursive: true, force: true });
});

function sessionWith(answer: string) {
  const s = emptySession("p1");
  s.turns = [{ question: "今日いちばん気になっていることは何ですか？", answer }];
  s.pending = "次の問い";
  return s;
}

describe("手元のモード（HASHI_PUBLIC なし）は今までと同じ", () => {
  it("会話は <id>.json・カルテは <id>.karte.json に出て、一時ファイルは残らず、クッキーは見ない", async () => {
    process.env.HASHI_RUNTIME_DIR = dir;
    const s = sessionWith("前髪が割れます");
    await saveSession(s);
    expect(existsSync(path.join(dir, "p1.json"))).toBe(true);
    const onDisk = JSON.parse(readFileSync(path.join(dir, "p1.json"), "utf8"));
    expect(onDisk.turns[0].answer).toBe("前髪が割れます");
    expect((await loadSession("p1"))?.turns[0].answer).toBe("前髪が割れます");

    await saveKarteEntry(s, { did: "整えた", next: "次回は量を見る" });
    expect(existsSync(path.join(dir, "p1.karte.json"))).toBe(true);
    expect((await loadKarte("p1")).entries[0].did).toBe("整えた");

    expect(readdirSync(dir).sort()).toEqual(["p1.json", "p1.karte.json"]);
    expect(h.calls).toBe(0);
  });

  it("無いファイルは null（会話は null・カルテは空）", async () => {
    process.env.HASHI_RUNTIME_DIR = dir;
    expect(await readText("p2.json")).toBeNull();
    expect(await loadSession("p2")).toBeNull();
    expect((await loadKarte("p2")).entries).toEqual([]);
  });

  it("保存の名前に ../ などは使えない", async () => {
    process.env.HASHI_RUNTIME_DIR = dir;
    await expect(writeText("../x.json", "a")).rejects.toThrow();
    await expect(readText("a/b.json")).rejects.toThrow();
  });
});

describe("暗号（seal / open）", () => {
  it("往復できる", () => {
    const secret = newVisitorSecret();
    const sealed = seal(secret, "前髪が割れる 🙂");
    expect(sealed).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(sealed).not.toContain("前髪");
    expect(open(secret, sealed)).toBe("前髪が割れる 🙂");
  });

  it("毎回 IV が違う", () => {
    const secret = newVisitorSecret();
    expect(seal(secret, "a")).not.toBe(seal(secret, "a"));
  });

  it("秘密が違うと読めない", () => {
    const sealed = seal(newVisitorSecret(), "ひみつ");
    expect(open(newVisitorSecret(), sealed)).toBeNull();
  });

  it("改ざんされたら読めない（無いと同じ）", () => {
    const secret = newVisitorSecret();
    const [v, iv, body] = seal(secret, "ひみつ").split(".");
    const flipped = (body[0] === "A" ? "B" : "A") + body.slice(1);
    expect(open(secret, [v, iv, flipped].join("."))).toBeNull();
    expect(open(secret, [v, iv, body.slice(0, -4)].join("."))).toBeNull();
    expect(open(secret, `v2.${iv}.${body}`)).toBeNull();
    expect(open(secret, "でたらめ")).toBeNull();
    expect(open(secret, "")).toBeNull();
  });
});

describe("公開モード（HASHI_PUBLIC=1・HASHI_KV=memory）", () => {
  beforeEach(() => {
    process.env.HASHI_PUBLIC = "1";
    process.env.HASHI_KV = "memory";
    process.env.HASHI_RUNTIME_DIR = dir; // ここにファイルが出ないことも確かめる
  });

  it("同じ p1 でも、訪問者が違えば混ざらない", async () => {
    const a = newVisitorSecret();
    const b = newVisitorSecret();
    h.cookie = a;
    await saveSession(sessionWith("Aさんの答え"));
    h.cookie = b;
    expect(await loadSession("p1")).toBeNull();
    await saveSession(sessionWith("Bさんの答え"));
    h.cookie = a;
    expect((await loadSession("p1"))?.turns[0].answer).toBe("Aさんの答え");
    h.cookie = b;
    expect((await loadSession("p1"))?.turns[0].answer).toBe("Bさんの答え");
    // 手元のファイルには何も出ない
    expect(readdirSync(dir)).toEqual([]);
  });

  it("カルテも訪問者ごと", async () => {
    const a = newVisitorSecret();
    const b = newVisitorSecret();
    const s = sessionWith("x");
    h.cookie = a;
    await saveKarteEntry(s, { did: "Aのメモ", next: "" });
    h.cookie = b;
    expect((await loadKarte("p1")).entries).toEqual([]);
    h.cookie = a;
    expect((await loadKarte("p1")).entries[0].did).toBe("Aのメモ");
  });

  it("Redis に置かれるのは暗号文で、名前は hv1:<訪問者の名前>:<name>", async () => {
    const a = newVisitorSecret();
    h.cookie = a;
    await saveSession(sessionWith("とても個人的な答え"));
    const entry = memoryKvEntry(`hv1:${visitorId(a)}:p1.json`);
    expect(entry).not.toBeNull();
    expect(entry!.value.startsWith("v1.")).toBe(true);
    expect(entry!.value).not.toContain("個人的");
    expect(visitorId(a)).toMatch(/^[0-9a-f]{32}$/);
  });

  it("書くたびに 72 時間の期限が付く", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-08T00:00:00Z"));
    const a = newVisitorSecret();
    h.cookie = a;
    const key = `hv1:${visitorId(a)}:p1.json`;
    await saveSession(sessionWith("1回目"));
    expect(memoryKvEntry(key)!.ttlSec).toBe(259200);
    vi.setSystemTime(new Date("2026-11-08T10:00:00Z")); // 10時間後
    expect(memoryKvEntry(key)!.ttlSec).toBe(259200 - 36000);
    await saveSession(sessionWith("2回目"));
    expect(memoryKvEntry(key)!.ttlSec).toBe(259200); // 付け直された
    vi.setSystemTime(new Date("2026-11-11T10:00:01Z")); // 72時間と1秒後
    expect(await loadSession("p1")).toBeNull(); // 期限切れ
  });

  it("クッキーが無い・形が違う時は専用のエラー（共有の名前に落とさない）", async () => {
    await expect(loadSession("p1")).rejects.toBeInstanceOf(VisitorRequiredError);
    await expect(saveSession(sessionWith("x"))).rejects.toBeInstanceOf(VisitorRequiredError);
    h.cookie = "short";
    await expect(loadSession("p1")).rejects.toBeInstanceOf(VisitorRequiredError);
    h.cookie = "!".repeat(43);
    await expect(readText("p1.json")).rejects.toBeInstanceOf(VisitorRequiredError);
    // どの名前にも書かれていない
    expect(await kv.get("hv1:undefined:p1.json")).toBeNull();
    expect(readdirSync(dir)).toEqual([]);
  });

  it("復号できない保存は「無い」と同じ", async () => {
    const a = newVisitorSecret();
    h.cookie = a;
    await kv.set(`hv1:${visitorId(a)}:p1.json`, "v1.AAAA.BBBB", 100);
    expect(await loadSession("p1")).toBeNull();
    await kv.set(`hv1:${visitorId(a)}:p1.json`, seal(newVisitorSecret(), "{}"), 100); // 別の秘密で作った物
    expect(await loadSession("p1")).toBeNull();
  });

  it("Vercel 上では HASHI_KV=memory を拒否する（黙って別の入れ物に落ちない）", async () => {
    process.env.VERCEL = "1";
    h.cookie = newVisitorSecret();
    await expect(loadSession("p1")).rejects.toThrow("Vercel");
    await expect(saveSession(sessionWith("x"))).rejects.toThrow("Vercel");
  });
});
