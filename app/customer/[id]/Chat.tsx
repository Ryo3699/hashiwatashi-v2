"use client";
// お客様のスマホ画面。AI が1問ずつ聞く。原因の推測・型・検査の話はここには出さない。写真ボタンは置かない。
import { useCallback, useEffect, useRef, useState } from "react";
import { FIXED_SUGGESTIONS } from "../../../lib/config";
import { COLORS, RADIUS } from "../../theme";

type Msg = { role: "ai" | "me"; text: string };
type Phase = "starting" | "asking" | "sending" | "closed";

type SavedTurn = { question: string; answer: string };
type Saved =
  | { status: "none" }
  | { status: "asking"; turns: SavedTurn[]; pending: string | null; suggestions?: string[] }
  | { status: "finished"; turns: SavedTurn[]; finishText: string | null };

/** サーバーの返事から候補だけ取り出す（無い・形が違う時は空） */
function readSuggestions(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

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
  // いま出している問いの、答えの候補（問いを待っている時だけ画面に出す）
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 美容師のまとめは裏で作っておく（投げっぱなし。失敗しても美容師の画面が自分で作り直せる）
  const prepareSummary = useCallback(() => {
    void post("/api/summary", { customerId }).catch(() => undefined);
  }, [customerId]);

  // 最初から始める（会話を空にして、最初の問いを出す）。開き直しでは呼ばない
  const start = useCallback(async () => {
    setError("");
    setPhase("starting");
    try {
      const r = await post("/api/interview", { customerId, action: "start" });
      if (!r.ok) throw new Error();
      setMsgs([{ role: "ai", text: String(r.data.text) }]);
      setSuggestions(readSuggestions(r.data.suggestions));
      setPhase("asking");
    } catch {
      setError("うまく始められませんでした。もう一度お試しください。");
    }
  }, [customerId]);

  // 開いた時：今の会話があれば続きから出す（再読み込み・「戻る」で答えを消さない）。無い時だけ始める
  const init = useCallback(async () => {
    setError("");
    setPhase("starting");
    let saved: Saved;
    try {
      const res = await fetch(`/api/interview?customerId=${encodeURIComponent(customerId)}`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      saved = (await res.json()) as Saved;
    } catch {
      setError("うまく始められませんでした。もう一度お試しください。");
      return;
    }
    if (saved.status === "none" || (saved.status === "asking" && saved.pending === null)) {
      await start();
      return;
    }
    const restored: Msg[] = saved.turns.flatMap((t): Msg[] => [
      { role: "ai", text: t.question },
      { role: "me", text: t.answer },
    ]);
    if (saved.status === "finished") {
      if (saved.finishText) restored.push({ role: "ai", text: saved.finishText });
      setMsgs(restored);
      setPhase("closed");
      prepareSummary();
    } else {
      restored.push({ role: "ai", text: String(saved.pending) });
      setMsgs(restored);
      setSuggestions(readSuggestions(saved.suggestions));
      setPhase("asking");
    }
  }, [customerId, start, prepareSummary]);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs, phase, error]);

  function restart() {
    if (!window.confirm("最初からやり直しますか？ これまでの答えは消えます。")) return;
    setDraft("");
    setMsgs([]);
    setSuggestions([]);
    void start();
  }

  // 候補を押す：入力欄にその文が入り（今の入力は置き換え）、カーソルが入力欄に移る＝書き足してから「送る」
  function pick(text: string) {
    if (phase !== "asking") return;
    inputRef.current?.focus(); // タップの中で同期的に（iPhone でキーボードが出るように）
    setDraft(text);
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(text.length, text.length));
  }

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
      setSuggestions(readSuggestions(r.data.suggestions));
      if (r.data.action === "finish") {
        setPhase("closed");
        prepareSummary();
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
            <a href={`/stylist/${customerId}`} style={primaryButton}>
              美容師の画面へ
            </a>
            <p style={{ margin: 0, fontSize: 12, color: COLORS.sub }}>（デモ用：美容師の側の画面に移ります）</p>
            <button type="button" onClick={restart} style={linkButton}>
              最初からやり直す
            </button>
          </div>
        )}
        {error && (
          <p style={{ margin: 0, fontSize: 13, color: COLORS.warn, background: COLORS.warnSoft, padding: "10px 14px", borderRadius: 12 }}>
            {error}{" "}
            {phase === "starting" && (
              <button type="button" onClick={() => void init()} style={{ ...ghostButton, padding: "4px 10px", fontSize: 12 }}>
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
          {phase === "asking" && suggestions.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }} aria-label="答えの候補">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => pick(s)}
                  style={FIXED_SUGGESTIONS.includes(s) ? fixedChip : chip}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
            <textarea
              ref={inputRef}
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
          {msgs.length > 2 && (
            <div style={{ textAlign: "center", marginTop: 8 }}>
              <button type="button" onClick={restart} disabled={phase !== "asking"} style={linkButton}>
                最初からやり直す
              </button>
            </div>
          )}
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

/** 答えの候補（AI の選択肢）：丸いボタン */
const chip: React.CSSProperties = {
  background: COLORS.accentSoft,
  color: COLORS.accent,
  border: `1px solid ${COLORS.accent}`,
  borderRadius: 999,
  padding: "8px 16px",
  fontSize: 14,
  fontFamily: "inherit",
  cursor: "pointer",
};

/** 決まった候補（特にないです・うまく言えないです）：小さく・薄く */
const fixedChip: React.CSSProperties = {
  background: "transparent",
  color: COLORS.sub,
  border: `1px solid ${COLORS.line}`,
  borderRadius: 999,
  padding: "5px 12px",
  fontSize: 12,
  fontFamily: "inherit",
  cursor: "pointer",
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

const linkButton: React.CSSProperties = {
  background: "transparent",
  color: COLORS.sub,
  border: "none",
  padding: "4px 8px",
  fontSize: 12,
  fontFamily: "inherit",
  textDecoration: "underline",
  cursor: "pointer",
};
