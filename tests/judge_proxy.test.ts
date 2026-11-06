// 審査用リンク：proxy.ts（クッキー・止める・回数の上限・検索に載せない）。
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { proxy } from "../proxy";
import { memoryKvEntry, resetMemoryKv } from "../server/kv";
import { hashIp, jstDay, jstHour, newVisitorSecret, visitorId } from "../server/public";
import { clearJudgeEnv, restoreJudgeEnv } from "./judge_env";

beforeEach(() => {
  clearJudgeEnv();
  resetMemoryKv();
});
afterEach(() => {
  vi.unstubAllGlobals();
  restoreJudgeEnv();
});

function req(path: string, opts: { method?: string; cookie?: string; ip?: string } = {}): NextRequest {
  const headers = new Headers();
  if (opts.cookie) headers.set("cookie", opts.cookie);
  if (opts.ip) headers.set("x-forwarded-for", opts.ip);
  return new NextRequest(`http://localhost${path}`, { method: opts.method ?? "GET", headers });
}

/** NextResponse.next() の印（素通り） */
const passed = (res: Response) => res.headers.get("x-middleware-next") === "1";

function publicMemory() {
  process.env.HASHI_PUBLIC = "1";
  process.env.HASHI_KV = "memory";
}

describe("手元のモード（HASHI_PUBLIC なし）は素通り", () => {
  it("画面もAPIも何も足さない・何も数えない", async () => {
    for (const r of [req("/"), req("/api/interview", { method: "POST" }), req("/stylist/p1")]) {
      const res = await proxy(r);
      expect(passed(res)).toBe(true);
      expect(res.status).toBe(200);
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(res.headers.get("x-robots-tag")).toBeNull();
    }
    process.env.HASHI_DEMO_OFF = "1"; // 公開モードでなければ、止める設定も効かない
    expect(passed(await proxy(req("/")))).toBe(true);
  });
});

describe("画面：訪問者のクッキー", () => {
  it("クッキーが無ければ作る（43文字・httpOnly・lax・72時間）。同じリクエストの中からも読める", async () => {
    publicMemory();
    const res = await proxy(req("/customer/p1"));
    expect(passed(res)).toBe(true);
    const setCookie = res.headers.get("set-cookie") ?? "";
    const m = setCookie.match(/hv=([A-Za-z0-9_-]+)/);
    expect(m).not.toBeNull();
    expect(m![1]).toHaveLength(43);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).toMatch(/Max-Age=259200/);
    expect(setCookie).not.toMatch(/Secure/i); // テストは production ではない
    expect(res.headers.get("x-middleware-request-cookie")).toContain(`hv=${m![1]}`);
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
  });

  it("本番では Secure が付く", async () => {
    publicMemory();
    vi.stubEnv("NODE_ENV", "production");
    const res = await proxy(req("/"));
    vi.unstubAllEnvs();
    expect(res.headers.get("set-cookie") ?? "").toMatch(/Secure/i);
  });

  it("形が違うクッキーは作り直し、ほかのクッキーは残す", async () => {
    publicMemory();
    const res = await proxy(req("/", { cookie: "a=1; hv=bad; b=2" }));
    const fwd = res.headers.get("x-middleware-request-cookie") ?? "";
    expect(fwd).toMatch(/^a=1; b=2; hv=[A-Za-z0-9_-]{43}$/);
    expect(res.headers.get("set-cookie")).toContain("hv=");
  });

  it("正しいクッキーがあれば作らない", async () => {
    publicMemory();
    const res = await proxy(req("/", { cookie: `hv=${newVisitorSecret()}` }));
    expect(passed(res)).toBe(true);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
  });

  it("画面ではRedisを呼ばない（設定が無くても通る）", async () => {
    process.env.HASHI_PUBLIC = "1"; // KV の設定なし
    expect(passed(await proxy(req("/stylist/p1")))).toBe(true);
  });
});

describe("API：クッキーと回数の上限", () => {
  it("クッキーが無い・形が違う時は 401", async () => {
    publicMemory();
    for (const cookie of [undefined, "hv=short", "other=1"]) {
      const res = await proxy(req("/api/interview", { method: "POST", cookie }));
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe("最初の画面から、同じブラウザで開いてください。");
      expect(res.headers.get("x-robots-tag")).toBe("noindex");
      expect(res.headers.get("set-cookie")).toBeNull();
    }
    expect((await proxy(req("/api/summary?customerId=p1"))).status).toBe(401);
  });

  it("POST だけ数える（GET は数えない）。訪問者・IP・全体の3つ", async () => {
    publicMemory();
    const secret = newVisitorSecret();
    const cookie = `hv=${secret}`;
    const get = await proxy(req("/api/summary?customerId=p1", { cookie }));
    expect(passed(get)).toBe(true);
    expect(memoryKvEntry(`rl:g:${jstDay()}`)).toBeNull();

    const res = await proxy(req("/api/interview", { method: "POST", cookie, ip: "203.0.113.9, 10.0.0.1" }));
    expect(passed(res)).toBe(true);
    expect(memoryKvEntry(`rl:v:${jstDay()}:${visitorId(secret)}`)?.value).toBe("1");
    expect(memoryKvEntry(`rl:ip:${jstHour()}:${hashIp("203.0.113.9")}`)?.value).toBe("1");
    expect(memoryKvEntry(`rl:g:${jstDay()}`)?.value).toBe("1");
    // IP は生のまま入っていない
    expect(memoryKvEntry(`rl:ip:${jstHour()}:203.0.113.9`)).toBeNull();
    // 期限が付いている
    expect(memoryKvEntry(`rl:g:${jstDay()}`)!.ttlSec).toBeGreaterThan(0);
  });

  it("訪問者の上限を超えたら 429（文つき）", async () => {
    publicMemory();
    process.env.HASHI_LIMIT_VISITOR_DAY = "2";
    const cookie = `hv=${newVisitorSecret()}`;
    expect(passed(await proxy(req("/api/interview", { method: "POST", cookie })))).toBe(true);
    expect(passed(await proxy(req("/api/interview", { method: "POST", cookie })))).toBe(true);
    const res = await proxy(req("/api/interview", { method: "POST", cookie }));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("今日のお試しの上限に達しました。時間をおいてお試しください。");
    // 別の訪問者はまだ通る
    expect(passed(await proxy(req("/api/interview", { method: "POST", cookie: `hv=${newVisitorSecret()}` })))).toBe(true);
  });

  it("IP の上限・全体の上限も 429", async () => {
    publicMemory();
    process.env.HASHI_LIMIT_IP_HOUR = "1";
    const first = await proxy(req("/api/interview", { method: "POST", cookie: `hv=${newVisitorSecret()}`, ip: "198.51.100.1" }));
    expect(passed(first)).toBe(true);
    const second = await proxy(req("/api/interview", { method: "POST", cookie: `hv=${newVisitorSecret()}`, ip: "198.51.100.1" }));
    expect(second.status).toBe(429);

    resetMemoryKv();
    delete process.env.HASHI_LIMIT_IP_HOUR;
    process.env.HASHI_LIMIT_GLOBAL_DAY = "2";
    expect(passed(await proxy(req("/api/summary", { method: "POST", cookie: `hv=${newVisitorSecret()}`, ip: "198.51.100.2" })))).toBe(true);
    expect(passed(await proxy(req("/api/summary", { method: "POST", cookie: `hv=${newVisitorSecret()}`, ip: "198.51.100.3" })))).toBe(true);
    expect((await proxy(req("/api/summary", { method: "POST", cookie: `hv=${newVisitorSecret()}`, ip: "198.51.100.4" }))).status).toBe(429);
  });

  it("上限の既定は 訪問者80・IP120・全体600（環境変数が変な値なら既定）", async () => {
    publicMemory();
    process.env.HASHI_LIMIT_VISITOR_DAY = "abc";
    const { limits } = await import("../server/public");
    expect(limits()).toEqual({ visitorDay: 80, ipHour: 120, globalDay: 600 });
    process.env.HASHI_LIMIT_VISITOR_DAY = "0";
    expect(limits().visitorDay).toBe(80);
  });

  it("Redis に聞けない時は 503（通さない）。鍵は返事に出ない", async () => {
    process.env.HASHI_PUBLIC = "1";
    process.env.KV_REST_API_URL = "https://kv.example.invalid";
    process.env.KV_REST_API_TOKEN = "TOKEN-SECRET-123";
    const cookie = `hv=${newVisitorSecret()}`;

    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    let res = await proxy(req("/api/interview", { method: "POST", cookie }));
    expect(res.status).toBe(503);
    expect((await res.clone().json()).error).toBe("ただいま混み合っています。しばらくしてからお試しください。");
    expect(await res.text()).not.toContain("TOKEN-SECRET-123");

    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    res = await proxy(req("/api/interview", { method: "POST", cookie }));
    expect(res.status).toBe(503);

    vi.stubGlobal("fetch", vi.fn(async () => Response.json([{ error: "ERR nope" }, { error: "ERR nope" }, { error: "x" }, { error: "x" }, { error: "x" }, { error: "x" }])));
    res = await proxy(req("/api/interview", { method: "POST", cookie }));
    expect(res.status).toBe(503);
  });

  it("Redis の設定が無い時も 503（上限なしで通さない）", async () => {
    process.env.HASHI_PUBLIC = "1";
    const res = await proxy(req("/api/interview", { method: "POST", cookie: `hv=${newVisitorSecret()}` }));
    expect(res.status).toBe(503);
  });

  it("Vercel 上で HASHI_KV=memory の時も 503", async () => {
    publicMemory();
    process.env.VERCEL = "1";
    const res = await proxy(req("/api/interview", { method: "POST", cookie: `hv=${newVisitorSecret()}` }));
    expect(res.status).toBe(503);
  });

  it("本物の Redis（REST）に3つまとめて1回で送り、返った数で判定する", async () => {
    process.env.HASHI_PUBLIC = "1";
    process.env.UPSTASH_REDIS_REST_URL = "https://r.example.invalid/";
    process.env.UPSTASH_REDIS_REST_TOKEN = "T";
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json([{ result: "OK" }, { result: 81 }, { result: "OK" }, { result: 3 }, { result: "OK" }, { result: 3 }]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await proxy(req("/api/interview", { method: "POST", cookie: `hv=${newVisitorSecret()}` }));
    expect(res.status).toBe(429); // 訪問者 81 > 80
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://r.example.invalid/pipeline");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer T");
    const cmds = JSON.parse(String(init.body)) as string[][];
    expect(cmds).toHaveLength(6);
    expect(cmds.filter((c) => c[0] === "SET").every((c) => c[2] === "0" && c[3] === "EX" && c[5] === "NX")).toBe(true);
    expect(cmds.filter((c) => c[0] === "INCR")).toHaveLength(3);
  });
});

describe("止める・偽物を出さない", () => {
  it("HASHI_DEMO_OFF=1：画面は短い HTML の 503、API は JSON の 503", async () => {
    publicMemory();
    process.env.HASHI_DEMO_OFF = "1";
    const page = await proxy(req("/"));
    expect(page.status).toBe(503);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(await page.text()).toContain("審査用のお試しは、いま止めています。");
    expect(page.headers.get("x-robots-tag")).toBe("noindex");
    const api = await proxy(req("/api/interview", { method: "POST", cookie: `hv=${newVisitorSecret()}` }));
    expect(api.status).toBe(503);
    expect((await api.json()).error).toBe("審査用のお試しは、いま止めています。");
    expect(memoryKvEntry(`rl:g:${jstDay()}`)).toBeNull(); // 数えない
  });

  it("Vercel 上で HASHI_FAKE=1 の時は、公開モードの API を止める（画面は通る）", async () => {
    publicMemory();
    process.env.VERCEL = "1";
    process.env.HASHI_FAKE = "1";
    process.env.HASHI_KV = "";
    process.env.KV_REST_API_URL = "https://kv.example.invalid";
    process.env.KV_REST_API_TOKEN = "T";
    const api = await proxy(req("/api/interview", { method: "POST", cookie: `hv=${newVisitorSecret()}` }));
    expect(api.status).toBe(503);
    const get = await proxy(req("/api/summary?customerId=p1", { cookie: `hv=${newVisitorSecret()}` }));
    expect(get.status).toBe(503);
    expect(passed(await proxy(req("/")))).toBe(true);
  });

  it("手元（VERCEL なし）の HASHI_FAKE=1 は止めない", async () => {
    publicMemory();
    process.env.HASHI_FAKE = "1";
    const api = await proxy(req("/api/interview", { method: "POST", cookie: `hv=${newVisitorSecret()}` }));
    expect(passed(api)).toBe(true);
  });
});
