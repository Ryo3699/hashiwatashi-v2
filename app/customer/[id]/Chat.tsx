"use client";
// お客様のスマホ画面。AI が1問ずつ聞く。原因の推測・型・検査の話はここには出さない。写真ボタンは置かない。
import { useCallback, useEffect, useRef, useState } from "react";
import { COLORS, RADIUS } from "../../theme";

type Msg = { role: "ai" | "me"; text: string };
type Phase = "starting" | "asking" | "sending" | "closed";
type Prep = "idle" | "working" | "done" | "error";

async function post(url: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data: Record<string, unknown> = {};
  try {
    data = await res.json();
  } catch {
    /* 空の返事 */
  }
  return { ok: res.ok, data };
}

export default function Chat({ customerId, name }: { customerId: string; name: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [phase, setPhase] = useState<Phase>("starting");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [prep, setPrep] = useState<Prep>("idle");
  const endRef = useRef<HTMLDivElement>(null);

  const start = useCallback(async () => {
    setError("");
    try {
      const r = await post("/api/interview", { customerId, action: "start" });
      if (!r.ok) throw new Error();
      setMsgs([{ role: "ai", text: String(r.data.text) }]);
      setPhase("asking");
    } catch {
      setError("うまく始められませんでした。もう一度お試しください。");
    }
  }, [customerId]);

  useEffect(() => {
    void start();
  }, [start]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs, phase, prep, error]);

  const makeSummary = useCallback(async () => {
    setPrep("working");
    try {
      const r = await post("/api/summary", { customerId });
      if (!r.ok) throw new Error();
      setPrep("done");
    } catch {
      setPrep("error");
    }
  }, [customerId]);

  async function send() {
    const answer = draft.trim();
    if (!answer || phase !== "asking") return;
    setError("");
    setPhase("sending");
    setMsgs((m) => [...m, { role: "me", text: answer }]);
    setDraft("");
    try {
      const r = await post("/api/interview", { customerId, answer });
      if (!r.ok) throw new Error();
      setMsgs((m) => [...m, { role: "ai", text: String(r.data.text) }]);
      if (r.data.action === "finish") {
        setPhase("closed");
        void makeSummary();
      } else {
        setPhase("asking");
      }
    } catch {
      // 送れなかった：自分の吹き出しを戻して、入力欄に答えを返す
      setMsgs((m) => m.slice(0, -1));
      setDraft(answer);
      setError("うまく送れませんでした。もう一度送ってください。");
      setPhase("asking");
    }
  }

  const canSend = phase === "asking" && draft.trim().length > 0;

  return (
    <main
      style={{
        maxWidth: 430,
        margin: "0 auto",
        height: "100dvh",
        display: "flex",
        flexDirection: "column",
        background: COLORS.bg,
      }}
    >
      <header style={{ padding: "22px 22px 14px", borderBottom: `1px solid ${COLORS.line}` }}>
        <h1 style={{ margin: 0, fontSize: 19, fontWeight: 700, letterSpacing: "0.02em" }}>
          来店前の質問（数分）
        </h1>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: COLORS.sub, lineHeight: 1.7 }}>
          {name}、ご来店前にいくつかお聞きします。分かる範囲で、思ったままで大丈夫です。
        </p>
      </header>

      <div style={{ flex: 1, overflowY: "auto", padding: "20px 18px", display: "grid", gap: 14, alignContent: "start" }}>
        {msgs.map((m, i) => (
          <Bubble key={i} msg={m} />
        ))}
        {(phase === "starting" || phase === "sending") && !error && (
          <Bubble msg={{ role: "ai", text: "…" }} muted />
        )}
        {phase === "closed" && (
          <div style={{ display: "grid", gap: 12, justifyItems: "center", padding: "10px 0 6px" }}>
            {prep === "working" && (
              <p style={{ margin: 0, fontSize: 13, color: COLORS.sub }}>少しお待ちください…</p>
            )}
            {prep === "error" && (
              <button type="button" onClick={() => void makeSummary()} style={ghostButton}>
                もう一度つなぐ
              </button>
            )}
            {prep === "done" && (
              <>
                <a href={`/stylist/${customerId}`} style={primaryButton}>
                  美容師の画面へ
                </a>
                <p style={{ margin: 0, fontSize: 12, color: COLORS.sub }}>（デモ用：美容師の側の画面に移ります）</p>
              </>
            )}
          </div>
        )}
        {error && (
          <p style={{ margin: 0, fontSize: 13, color: COLORS.warn, background: COLORS.warnSoft, padding: "10px 14px", borderRadius: 12 }}>
            {error}{" "}
            {phase === "starting" && (
              <button type="button" onClick={() => void start()} style={{ ...ghostButton, padding: "4px 10px", fontSize: 12 }}>
                やり直す
              </button>
            )}
          </p>
        )}
        <div ref={endRef} />
      </div>

      {phase !== "closed" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          style={{ padding: "12px 16px calc(14px + env(safe-area-inset-bottom))", borderTop: `1px solid ${COLORS.line}`, background: COLORS.card }}
        >
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="ここに入力してください"
              disabled={phase !== "asking"}
              aria-label="お答え"
              style={{
                flex: 1,
                resize: "none",
                fontSize: 16, // 16px 未満だと iPhone で入力時に画面が拡大される
                fontFamily: "inherit",
                lineHeight: 1.6,
                padding: "10px 14px",
                borderRadius: 14,
                border: `1px solid ${COLORS.line}`,
                background: COLORS.bg,
                color: COLORS.text,
                outline: "none",
              }}
            />
            <button
              type="submit"
              disabled={!canSend}
              style={{
                ...primaryButton,
                border: "none",
                cursor: canSend ? "pointer" : "default",
                opacity: canSend ? 1 : 0.4,
                padding: "12px 18px",
                fontSize: 15,
              }}
            >
              送る
            </button>
          </div>
        </form>
      )}
    </main>
  );
}

function Bubble({ msg, muted }: { msg: Msg; muted?: boolean }) {
  const mine = msg.role === "me";
  return (
    <div style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start" }}>
      <div
        style={{
          maxWidth: "82%",
          padding: "12px 16px",
          borderRadius: RADIUS,
          borderBottomRightRadius: mine ? 6 : RADIUS,
          borderBottomLeftRadius: mine ? RADIUS : 6,
          background: mine ? COLORS.accentSoft : COLORS.card,
          border: mine ? "none" : `1px solid ${COLORS.line}`,
          fontSize: 15,
          lineHeight: 1.8,
          color: muted ? COLORS.sub : COLORS.text,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {msg.text}
      </div>
    </div>
  );
}

const primaryButton: React.CSSProperties = {
  display: "inline-block",
  background: COLORS.accent,
  color: "#fff",
  borderRadius: 999,
  padding: "14px 28px",
  fontSize: 16,
  fontWeight: 500,
  textDecoration: "none",
  fontFamily: "inherit",
};

const ghostButton: React.CSSProperties = {
  background: "transparent",
  color: COLORS.accent,
  border: `1px solid ${COLORS.accent}`,
  borderRadius: 999,
  padding: "10px 20px",
  fontSize: 14,
  fontFamily: "inherit",
  cursor: "pointer",
};
