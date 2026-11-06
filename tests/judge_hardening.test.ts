// 審査用リンク：点検で出た穴の塞ぎ（パスの書き換えのすり抜け・Vercel の付け忘れ・全体の枠・まとめの別枠・暗号の置き場・順番待ち）。
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRealClient, type MessagesApi } from "../lib/claude";
import { proxy } from "../proxy";
import { getClaude } from "../server/claude";
import { kv, memoryKvEntry, resetMemoryKv } from "../server/kv";
import {
  canonicalPath,
  hashIp,
  isSummaryPath,
  jstDay,
  jstHour,
  limitsMisconfigured,
  newVisitorSecret,
  routeKind,
  summaryLimits,
  visitorId,
} from "../server/public";
import { open, seal } from "../server/seal";
import { readText, writeText } from "../server/storage";
import { withLock } from "../server/store";
import { clearJudgeEnv, restoreJudgeEnv } from "./judge_env";

const h = vi.hoisted(() => ({ cookie: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => {
    const v = h.cookie; // 呼んだ時点の値（リクエストごとのクッキーの代わり）
    return { get: (name: string) => (name === "hv" && v !== undefined ? { name, value: v } : undefined) };
  },
}));

beforeEach(() => {
  clearJudgeEnv();
  resetMemoryKv();
  h.cookie = undefined;
});
afterEach(() => {
  vi.unstubAllGlobals();
  restoreJudgeEnv();
});

function req(path: string, opts: { method?: string; cookie?: string; ip?: string; headers?: Record<string, string> } = {}): NextRequest {
  const headers = new Headers(opts.headers);
  if (opts.cookie) headers.set("cookie", opts.cookie);
  if (opts.ip) headers.set("x-forwarded-for", opts.ip);
  return new NextRequest(`http://localhost${path}`, { method: opts.method ?? "GET", headers });
}
const passed = (res: Response) => res.headers.get("x-middleware-next") === "1";
const post = (path: string, cookie = `hv=${newVisitorSecret()}`, ip = "203.0.113.50") => req(path, { method: "POST", cookie, ip });

function publicMemory() {
  process.env.HASHI_PUBLIC = "1";
  process.env.HASHI_KV = "memory";
}

describe("パスの書き換えで API の判定をすり抜けられない", () => {
  const spellings = [
    "/api/interview",
    "/%61pi/interview",
    "/api/%69nterview",
    "/api%2Finterview",
    "/api%2finterview",
    "/%2561pi/interview", // 二重
    "/API/interview",
    "/api/interview/",
    "//api/interview",
    "/./api/interview",
    "/customer/x/../../api/interview",
    "/customer/x%2F..%2F..%2Fapi%2Finterview",
    "/api\\interview",
    "/api/interview%00",
    "/%E0%A4%A", // 読めない書き方
  ];

  it("どの書き方でもクッキー無しは 401（API 扱い）", async () => {
    publicMemory();
    for (const p of spellings) {
      const res = await proxy(req(p, { method: "POST" }));
      expect(res.status, p).toBe(401);
    }
  });

  it("どの書き方でも POST は数えられ、上限を超えたら 429", async () => {
    publicMemory();
    process.env.HASHI_LIMIT_IP_HOUR = "2";
    for (const p of spellings) {
      resetMemoryKv();
      expect(passed(await proxy(post(p))), p).toBe(true);
      expect(memoryKvEntry(`rl:g:${jstDay()}`)?.value, p).toBe("1");
      expect(passed(await proxy(post(p))), p).toBe(true);
      expect((await proxy(post(p))).status, p).toBe(429);
    }
  });

  it("画面は今まで通り（クッキーを作る）。画面でない道は 401", async () => {
    publicMemory();
    for (const p of ["/", "/customer/p1", "/stylist/p1", "/Customer/p1/"]) {
      const res = await proxy(req(p));
      expect(passed(res), p).toBe(true);
      expect(res.headers.get("set-cookie"), p).toContain("hv=");
    }
    for (const p of ["/foo", "/customer", "/_next/foo", "/api"]) {
      expect((await proxy(req(p))).status, p).toBe(401);
    }
  });

  it("GET 以外は、画面のパスでも API と同じ扱い（クッキー必須・数える）。PUT・DELETE も数える", async () => {
    publicMemory();
    expect((await proxy(req("/customer/p1", { method: "POST" }))).status).toBe(401);
    expect(passed(await proxy(post("/customer/p1")))).toBe(true);
    expect(memoryKvEntry(`rl:g:${jstDay()}`)?.value).toBe("1");
    for (const method of ["PUT", "DELETE", "PATCH"]) {
      expect(passed(await proxy(req("/api/interview", { method, cookie: `hv=${newVisitorSecret()}` })))).toBe(true);
    }
    expect(memoryKvEntry(`rl:g:${jstDay()}`)?.value).toBe("4");
    // 読むだけは数えない
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      await proxy(req("/api/summary", { method, cookie: `hv=${newVisitorSecret()}` }));
    }
    expect(memoryKvEntry(`rl:g:${jstDay()}`)?.value).toBe("4");
  });

  it("止めている時も、書き換えた API のパスは JSON の 503", async () => {
    publicMemory();
    process.env.HASHI_DEMO_OFF = "1";
    const res = await proxy(post("/%61pi/interview"));
    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("routeKind / canonicalPath の表", () => {
    expect(canonicalPath("/a/%2e%2e/api")).toEqual(["api"]);
    expect(canonicalPath("/%E0%A4%A")).toBeNull();
    expect(canonicalPath("/%25252525252561")).toBeNull(); // 安定しない
    expect(routeKind("/")).toBe("page");
    expect(routeKind("/customer/p1")).toBe("page");
    expect(routeKind("/stylist/p2/")).toBe("page");
    expect(routeKind("/customer")).toBe("api");
    expect(routeKind("/api")).toBe("api");
    expect(routeKind("/%61pi")).toBe("api");
    expect(isSummaryPath("/api/summary")).toBe(true);
    expect(isSummaryPath("/%61pi/%73ummary/")).toBe(true);
    expect(isSummaryPath("/api/interview")).toBe(false);
  });
});

describe("Vercel 上で HASHI_PUBLIC を付け忘れても、上限なしで通さない", () => {
  it("API も画面も 503（Redis も Claude も触らない）", async () => {
    process.env.VERCEL = "1";
    const api = await proxy(post("/api/interview"));
    expect(api.status).toBe(503);
    expect(api.headers.get("content-type")).toContain("application/json");
    const page = await proxy(req("/"));
    expect(page.status).toBe(503);
    expect(page.headers.get("set-cookie")).toBeNull();
    expect(memoryKvEntry(`rl:g:${jstDay()}`)).toBeNull();
  });

  it("手元（VERCEL なし）は今まで通り素通り", async () => {
    expect(passed(await proxy(post("/api/interview")))).toBe(true);
    expect(passed(await proxy(req("/")))).toBe(true);
  });

  it("偽物の Claude は Vercel 上では作れない（手元は作れる）", () => {
    process.env.HASHI_FAKE = "1";
    expect(() => getClaude()).not.toThrow();
    process.env.VERCEL = "1";
    expect(() => getClaude()).toThrow("Vercel");
  });
});

describe("全体の枠：断られた分は食い潰さない", () => {
  it("1つの IP が断られ続けても、全体の数は通った分だけ", async () => {
    publicMemory();
    process.env.HASHI_LIMIT_IP_HOUR = "2";
    for (let i = 0; i < 6; i++) await proxy(post("/api/interview", undefined, "198.51.100.7"));
    expect(memoryKvEntry(`rl:g:${jstDay()}`)?.value).toBe("2");
    // 別の IP の人はまだ通る
    expect(passed(await proxy(post("/api/interview", undefined, "198.51.100.8")))).toBe(true);
    expect(memoryKvEntry(`rl:g:${jstDay()}`)?.value).toBe("3");
  });

  it("全体の上限に達していれば、そのまま断る", async () => {
    publicMemory();
    process.env.HASHI_LIMIT_GLOBAL_DAY = "1";
    expect(passed(await proxy(post("/api/interview", undefined, "198.51.100.1")))).toBe(true);
    expect((await proxy(post("/api/interview", undefined, "198.51.100.2"))).status).toBe(429);
  });
});

describe("まとめ（Opus）の別枠", () => {
  it("既定は 全体150/日・IP10/時", () => {
    expect(summaryLimits()).toEqual({ day: 150, ipHour: 10 });
  });

  it("IP ごとの別枠を超えると 429。interview は数えない", async () => {
    publicMemory();
    process.env.HASHI_LIMIT_SUMMARY_IP_HOUR = "2";
    expect(passed(await proxy(post("/api/summary")))).toBe(true);
    expect(passed(await proxy(post("/api/%73ummary")))).toBe(true);
    expect((await proxy(post("/api/summary"))).status).toBe(429);
    // interview はまだ通る
    expect(passed(await proxy(post("/api/interview")))).toBe(true);
    expect(memoryKvEntry(`rl:sum:g:${jstDay()}`)?.value).toBe("3");
  });

  it("全体の別枠を超えると、別の IP でも 429", async () => {
    publicMemory();
    process.env.HASHI_LIMIT_SUMMARY_DAY = "1";
    expect(passed(await proxy(post("/api/summary", undefined, "198.51.100.1")))).toBe(true);
    expect((await proxy(post("/api/summary", undefined, "198.51.100.2"))).status).toBe(429);
    expect(passed(await proxy(post("/api/interview", undefined, "198.51.100.2")))).toBe(true);
  });
});

describe("上限の環境変数の誤記は、既定値に戻さず止める", () => {
  it("0・誤記なら API は 503（数えない）。画面は通る。空・未設定は既定値", async () => {
    publicMemory();
    for (const v of ["0", "300回", "-5", "1.5"]) {
      process.env.HASHI_LIMIT_GLOBAL_DAY = v;
      expect(limitsMisconfigured(), v).toBe(true);
      const res = await proxy(post("/api/interview"));
      expect(res.status, v).toBe(503);
    }
    expect(memoryKvEntry(`rl:g:${jstDay()}`)).toBeNull();
    process.env.HASHI_LIMIT_SUMMARY_IP_HOUR = "x";
    delete process.env.HASHI_LIMIT_GLOBAL_DAY;
    expect((await proxy(post("/api/interview"))).status).toBe(503);
    expect(passed(await proxy(req("/")))).toBe(true);
    process.env.HASHI_LIMIT_SUMMARY_IP_HOUR = "";
    expect(limitsMisconfigured()).toBe(false);
    expect(passed(await proxy(post("/api/interview")))).toBe(true);
  });
});

describe("IP の扱い", () => {
  it("鍵つきのハッシュ（24文字）。鍵が変わると別の値・素の sha256 とは一致しない", async () => {
    const { createHash } = await import("node:crypto");
    const plain = createHash("sha256").update("203.0.113.77").digest("hex").slice(0, 24);
    const a = hashIp("203.0.113.77", {} as NodeJS.ProcessEnv);
    expect(a).toMatch(/^[0-9a-f]{24}$/);
    expect(a).not.toBe(plain);
    expect(hashIp("203.0.113.77", { HASHI_IP_SALT: "s1" } as unknown as NodeJS.ProcessEnv)).not.toBe(a);
    expect(hashIp("203.0.113.77", { KV_REST_API_TOKEN: "t" } as unknown as NodeJS.ProcessEnv)).not.toBe(a);
    expect(hashIp("203.0.113.77", { HASHI_IP_SALT: "s1" } as unknown as NodeJS.ProcessEnv)).toBe(
      hashIp("203.0.113.77", { HASHI_IP_SALT: "s1" } as unknown as NodeJS.ProcessEnv),
    );
  });

  it("Vercel 上は x-vercel-forwarded-for を先に使う。Vercel 以外では客の書いた値を信用しない", async () => {
    process.env.HASHI_PUBLIC = "1";
    process.env.KV_REST_API_URL = "https://r.example.invalid";
    process.env.KV_REST_API_TOKEN = "T";
    const keys: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init: RequestInit) => {
        const cmds = JSON.parse(String(init.body)) as string[][];
        for (const c of cmds) if (c[0] === "INCR" && c[1].startsWith("rl:ip:")) keys.push(c[1]);
        return Response.json(cmds.map(() => ({ result: 1 })));
      }),
    );
    const headers = { "x-vercel-forwarded-for": "192.0.2.10" };
    process.env.VERCEL = "1";
    await proxy(req("/api/interview", { method: "POST", cookie: `hv=${newVisitorSecret()}`, ip: "6.6.6.6", headers }));
    expect(keys[0]).toBe(`rl:ip:${jstHour()}:${hashIp("192.0.2.10")}`);
    delete process.env.VERCEL;
    await proxy(req("/api/interview", { method: "POST", cookie: `hv=${newVisitorSecret()}`, ip: "6.6.6.6", headers }));
    expect(keys[1]).toBe(`rl:ip:${jstHour()}:${hashIp("6.6.6.6")}`);
  });
});

describe("暗号：置き場の名前も確かめる", () => {
  it("名前（aad）が違うと開けない。aad なしの暗号文とも混ざらない", () => {
    const secret = newVisitorSecret();
    const sealed = seal(secret, "ひみつ", "hv1:abc:p1.json");
    expect(open(secret, sealed, "hv1:abc:p1.json")).toBe("ひみつ");
    expect(open(secret, sealed, "hv1:abc:p1.karte.json")).toBeNull();
    expect(open(secret, sealed)).toBeNull();
    expect(open(secret, seal(secret, "x"), "hv1:abc:p1.json")).toBeNull();
  });

  it("Redis の中で別の名前の場所へ暗号文を差し替えても、読めない（無いのと同じ）", async () => {
    publicMemory();
    h.cookie = newVisitorSecret();
    await writeText("p1.karte.json", JSON.stringify({ k: 1 }));
    await writeText("p1.json", JSON.stringify({ s: 1 }));
    const raw = await kv.get(`hv1:${visitorId(h.cookie)}:p1.karte.json`);
    await kv.set(`hv1:${visitorId(h.cookie)}:p1.json`, raw!, 100);
    expect(await readText("p1.json")).toBeNull();
    expect(await readText("p1.karte.json")).toBe(JSON.stringify({ k: 1 }));
  });
});

describe("順番待ちは訪問者ごと", () => {
  const tick = () => new Promise<void>((r) => setTimeout(r, 5));

  it("公開モード：別の訪問者は同じお客様の番号でも待ち合わない。同じ訪問者は順番に", async () => {
    publicMemory();
    const events: string[] = [];
    let releaseA!: () => void;
    const gateA = new Promise<void>((r) => (releaseA = r));

    h.cookie = newVisitorSecret();
    const a = withLock("p1", async () => {
      events.push("A start");
      await gateA;
      events.push("A end");
    });
    const a2 = withLock("p1", async () => {
      events.push("A2 start");
    });
    h.cookie = newVisitorSecret();
    const b = withLock("p1", async () => {
      events.push("B start");
    });
    await b;
    await tick();
    expect(events).toEqual(["A start", "B start"]); // B は A を待たない・A2 は A を待つ
    releaseA();
    await Promise.all([a, a2]);
    expect(events).toEqual(["A start", "B start", "A end", "A2 start"]);
  });

  it("手元：同じ番号は順番に（今まで通り）", async () => {
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const a = withLock("p1", async () => {
      events.push("1 start");
      await gate;
      events.push("1 end");
    });
    const b = withLock("p1", async () => {
      events.push("2 start");
    });
    const c = withLock("p2", async () => {
      events.push("3 start");
    });
    await c;
    await tick();
    expect(events).toEqual(["1 start", "3 start"]);
    release();
    await Promise.all([a, b]);
    expect(events).toEqual(["1 start", "3 start", "1 end", "2 start"]);
  });

  it("失敗しても次の仕事は動く", async () => {
    publicMemory();
    h.cookie = newVisitorSecret();
    await expect(withLock("p1", async () => { throw new Error("x"); })).rejects.toThrow("x");
    expect(await withLock("p1", async () => 7)).toBe(7);
  });
});

describe("Claude の返事の中身をエラー文に入れない（公開モード）", () => {
  const sdk = (text: string): MessagesApi => ({
    messages: { async create() { return { content: [{ type: "text", text }], stop_reason: "end_turn" }; } },
  });
  const jsonReq = { model: "m", system: "s", messages: [{ role: "user" as const, content: "u" }], schema: { type: "object" } };

  it("公開モードでは文字数だけ・手元は今まで通り頭の部分", async () => {
    const secretText = "お客様の答えの一部ですこれは秘密";
    process.env.HASHI_PUBLIC = "1";
    const pub = await createRealClient(sdk(secretText)).json(jsonReq).catch((e: Error) => e.message);
    expect(pub).toContain("JSON");
    expect(pub).not.toContain("お客様");
    delete process.env.HASHI_PUBLIC;
    const local = await createRealClient(sdk(secretText)).json(jsonReq).catch((e: Error) => e.message);
    expect(local).toContain("お客様の答え");
  });
});
