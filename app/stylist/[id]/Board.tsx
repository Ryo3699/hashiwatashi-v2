"use client";
// 美容師のスマホ画面。隠れた悩みと、3種類の「なぜ」のヒント。ヒントごとに、もとのお客様の答えを原文で小さく添える。
import { useCallback, useEffect, useState } from "react";
import { HINT_KINDS, HINT_KIND_LABEL, type Summary, type Turn } from "../../../lib/types";
import { COLORS, RADIUS } from "../../theme";

type View =
  | { status: "none" }
  | { status: "interviewing"; turns: Turn[]; answered: number }
  | { status: "finished"; turns: Turn[]; answered: number }
  | { status: "ready"; turns: Turn[]; answered: number; summary: Summary; removedCount: number; failed: boolean };

export default function Board({ customerId, name }: { customerId: string; name: string }) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await fetch(`/api/summary?customerId=${encodeURIComponent(customerId)}`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      setView((await res.json()) as View);
    } catch {
      setError("読み込めませんでした。");
    }
  }, [customerId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function make() {
    setWorking(true);
    setError("");
    try {
      const res = await fetch("/api/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId }),
      });
      if (!res.ok) throw new Error();
      setView((await res.json()) as View);
    } catch {
      setError("まとめを作れませんでした。もう一度お試しください。");
    } finally {
      setWorking(false);
    }
  }

  // 聞き取りが終わっていて、まとめがまだなら、自動で作る（お客様の画面から来た時に押さずに済むように）
  useEffect(() => {
    if (view?.status === "finished" && !working && !error) void make();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.status]);

  return (
    <main style={{ maxWidth: 430, margin: "0 auto", minHeight: "100dvh", background: COLORS.bg, paddingBottom: 40 }}>
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 1,
          background: COLORS.warnSoft,
          color: COLORS.warn,
          fontSize: 14,
          fontWeight: 700,
          textAlign: "center",
          padding: "11px 16px",
          borderBottom: `1px solid ${COLORS.line}`,
        }}
      >
        AI の推測です。決めるのは美容師です
      </div>

      <header style={{ padding: "22px 22px 6px" }}>
        <h1 style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>{name}の聞き取りメモ</h1>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: COLORS.sub, lineHeight: 1.7 }}>
          来店前にお客様が答えた内容から、カウンセリングの手がかりをまとめました。
        </p>
      </header>

      <div style={{ padding: "10px 18px", display: "grid", gap: 16 }}>
        {error && <Note tone="warn">{error}</Note>}
        {!view && !error && <Note>読み込み中…</Note>}

        {view?.status === "none" && (
          <Note>
            まだお客様の答えがありません。
            <br />
            <a href={`/customer/${customerId}`} style={linkStyle}>
              お客様の画面へ
            </a>
          </Note>
        )}

        {view?.status === "interviewing" && (
          <Note>
            お客様が回答中です（{view.answered}問に回答済み）。
            <br />
            <button type="button" onClick={() => void load()} style={ghostButton}>
              更新する
            </button>
          </Note>
        )}

        {view?.status === "finished" && <Note>{working ? "まとめを作っています…（少し時間がかかります）" : "まとめを準備しています…"}</Note>}

        {view?.status === "ready" && <Ready view={view} onRetry={() => void make()} working={working} />}
      </div>
    </main>
  );
}

function Ready({
  view,
  onRetry,
  working,
}: {
  view: Extract<View, { status: "ready" }>;
  onRetry: () => void;
  working: boolean;
}) {
  const { summary, turns } = view;
  return (
    <>
      {view.failed && (
        <Note tone="warn">
          うまくまとめられませんでした。下の「お客様の答え」をそのままご覧ください。
          <br />
          <button type="button" onClick={onRetry} disabled={working} style={ghostButton}>
            {working ? "作り直しています…" : "作り直す"}
          </button>
        </Note>
      )}

      <Card title="隠れた悩み（推測）">
        <p style={bodyText}>{summary.hidden_worry.text}</p>
        <Sources turns={turns} indexes={summary.hidden_worry.from_answers} />
      </Card>

      {!view.failed && (
        <section style={{ display: "grid", gap: 14 }}>
          <h2 style={{ margin: "4px 4px 0", fontSize: 15, color: COLORS.accent }}>なぜ？のヒント（推測・参考）</h2>
          {summary.hints.length === 0 && <Note>今回、出せるヒントはありませんでした。</Note>}
          {HINT_KINDS.map((kind) => {
            const hints = summary.hints.filter((h) => h.kind === kind);
            if (hints.length === 0) return null;
            return (
              <Card key={kind} title={HINT_KIND_LABEL[kind]}>
                <div style={{ display: "grid", gap: 16 }}>
                  {hints.map((h, i) => (
                    <div key={i}>
                      <p style={bodyText}>{h.text}</p>
                      <Sources turns={turns} indexes={h.from_answers} />
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}
          {view.removedCount > 0 && (
            <p style={{ margin: "0 4px", fontSize: 12, color: COLORS.sub }}>
              ※ 決めつけに聞こえる表現などがあった {view.removedCount} 件は、機械の検査で外しています。
            </p>
          )}
        </section>
      )}

      <details style={{ margin: "4px 4px 0" }}>
        <summary style={{ fontSize: 13, color: COLORS.sub, cursor: "pointer" }}>お客様の答え（全部・原文）</summary>
        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
          {turns.map((t, i) => (
            <div key={i} style={{ fontSize: 12.5, lineHeight: 1.7, color: COLORS.sub }}>
              <div>問{i + 1}：{t.question}</div>
              <div style={{ color: COLORS.text, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>答え{i + 1}：{t.answer}</div>
            </div>
          ))}
        </div>
      </details>
    </>
  );
}

/** もとになったお客様の答えを、原文のまま小さく */
function Sources({ turns, indexes }: { turns: Turn[]; indexes: number[] }) {
  const valid = indexes.filter((n) => Number.isInteger(n) && n >= 0 && n < turns.length);
  if (valid.length === 0) return null;
  return (
    <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
      {valid.map((n) => (
        <div
          key={n}
          style={{
            fontSize: 12,
            lineHeight: 1.7,
            color: COLORS.sub,
            borderLeft: `3px solid ${COLORS.line}`,
            paddingLeft: 10,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          お客様の答え{n + 1}：「{turns[n].answer}」
        </div>
      ))}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ background: COLORS.card, border: `1px solid ${COLORS.line}`, borderRadius: RADIUS, padding: "18px 18px 20px" }}>
      <h2 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 700, color: COLORS.accent }}>{title}</h2>
      {children}
    </section>
  );
}

function Note({ children, tone }: { children: React.ReactNode; tone?: "warn" }) {
  return (
    <div
      style={{
        fontSize: 14,
        lineHeight: 1.9,
        color: tone === "warn" ? COLORS.warn : COLORS.sub,
        background: tone === "warn" ? COLORS.warnSoft : COLORS.card,
        border: `1px solid ${COLORS.line}`,
        borderRadius: RADIUS,
        padding: "16px 18px",
      }}
    >
      {children}
    </div>
  );
}

const bodyText: React.CSSProperties = { margin: 0, fontSize: 15, lineHeight: 1.9, color: COLORS.text };
const linkStyle: React.CSSProperties = { color: COLORS.accent };
const ghostButton: React.CSSProperties = {
  marginTop: 8,
  background: "transparent",
  color: COLORS.accent,
  border: `1px solid ${COLORS.accent}`,
  borderRadius: 999,
  padding: "8px 18px",
  fontSize: 14,
  fontFamily: "inherit",
  cursor: "pointer",
};
