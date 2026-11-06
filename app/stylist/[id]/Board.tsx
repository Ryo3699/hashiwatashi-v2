"use client";
// 美容師のスマホ画面。隠れた悩みと、3種類の「なぜ」のヒント。ヒントごとに、もとのお客様の答えを原文で小さく添える。
// カルテ：上に前回のメモ、ready の時は下に「カルテに残す」（美容師が書く。AI は書かない）。
import { useCallback, useEffect, useState } from "react";
import {
  HINT_KINDS,
  HINT_KIND_LABEL,
  KARTE_MAX_LEN,
  type KarteEntry,
  type KarteView,
  type Summary,
  type Turn,
  type Via,
} from "../../../lib/types";
import { COLORS, RADIUS } from "../../theme";

type View = { karte: KarteView } & (
  | { status: "none" }
  | { status: "interviewing"; turns: Turn[]; answered: number }
  | { status: "finished"; turns: Turn[]; answered: number }
  | { status: "ready"; turns: Turn[]; answered: number; summary: Summary; removedCount: number; failed: boolean }
);

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

        {view?.karte.previous && <PreviousKarte entry={view.karte.previous} />}

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

        {view?.status === "finished" &&
          (error ? (
            <Note>
              <button type="button" onClick={() => void make()} disabled={working} style={ghostButton}>
                {working ? "作り直しています…" : "作り直す"}
              </button>
            </Note>
          ) : (
            <Note>{working ? "まとめを作っています…（少し時間がかかります）" : "まとめを準備しています…"}</Note>
          ))}

        {view?.status === "ready" && (
          <Ready
            view={view}
            customerId={customerId}
            onRetry={() => void make()}
            working={working}
            onKarte={(karte) => setView({ ...view, karte })}
          />
        )}
      </div>
    </main>
  );
}

function Ready({
  view,
  customerId,
  onRetry,
  working,
  onKarte,
}: {
  view: Extract<View, { status: "ready" }>;
  customerId: string;
  onRetry: () => void;
  working: boolean;
  onKarte: (karte: KarteView) => void;
}) {
  const { summary, turns } = view;
  const keepIndexes = validIndexes(summary.keep?.from_answers ?? [], turns.length);
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
        <Card title="残したい所・避けたいこと（お客様の言葉）">
          {keepIndexes.length > 0 ? (
            <Sources turns={turns} indexes={keepIndexes} />
          ) : (
            <p style={bodyText}>聞き取りでは出ていません。当日確かめてください。</p>
          )}
        </Card>
      )}

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

      <KarteForm
        customerId={customerId}
        turns={turns}
        keepIndexes={view.failed ? [] : keepIndexes}
        current={view.karte.current}
        onSaved={onKarte}
      />

      <details style={{ margin: "4px 4px 0" }}>
        <summary style={{ fontSize: 13, color: COLORS.sub, cursor: "pointer" }}>お客様の答え（全部・原文）</summary>
        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
          {turns.map((t, i) => (
            <div key={i} style={{ fontSize: 12.5, lineHeight: 1.7, color: COLORS.sub }}>
              <div>問{i + 1}：{t.question}</div>
              <div style={{ color: COLORS.text, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                答え{i + 1}：{t.answer}
                <ViaMark via={t.via} />
              </div>
            </div>
          ))}
        </div>
      </details>
    </>
  );
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const fmtMD = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};
const fmtMDHM = (iso: string) => {
  const d = new Date(iso);
  return `${fmtMD(iso)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

/** 前回のカルテ（AI の文ではない＝お客様の言葉は原文、あとは美容師が書いたメモ） */
function PreviousKarte({ entry }: { entry: KarteEntry }) {
  return (
    <Card title={`前回のカルテ（美容師のメモ・${fmtMD(entry.savedAt)}）`}>
      <div style={{ display: "grid", gap: 14 }}>
        {entry.wish && (
          <KarteItem label="前回の要望（お客様の言葉）">
            <Quote>{entry.wish}</Quote>
          </KarteItem>
        )}
        {entry.keep.length > 0 && (
          <KarteItem label="残したい所・避けたいこと（お客様の言葉）">
            <div style={{ display: "grid", gap: 4 }}>
              {entry.keep.map((k, i) => (
                <Quote key={i}>{k}</Quote>
              ))}
            </div>
          </KarteItem>
        )}
        {entry.did && (
          <KarteItem label="やったこと（美容師）">
            <p style={bodyText}>{entry.did}</p>
          </KarteItem>
        )}
        {entry.next && (
          <KarteItem label="次に確かめること（美容師）">
            <p style={bodyText}>{entry.next}</p>
          </KarteItem>
        )}
      </div>
    </Card>
  );
}

function KarteItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: COLORS.sub, marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

function Quote({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 13,
        lineHeight: 1.7,
        color: COLORS.sub,
        borderLeft: `3px solid ${COLORS.line}`,
        paddingLeft: 10,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      「{children}」
    </div>
  );
}

/** 施術の後に、美容師が1〜3行で書く。お客様の言葉は自動で写す（AI は使わない） */
function KarteForm({
  customerId,
  turns,
  keepIndexes,
  current,
  onSaved,
}: {
  customerId: string;
  turns: Turn[];
  keepIndexes: number[];
  current: KarteEntry | null;
  onSaved: (karte: KarteView) => void;
}) {
  const [did, setDid] = useState(current?.did ?? "");
  const [next, setNext] = useState(current?.next ?? "");
  const [savedAt, setSavedAt] = useState<string | null>(current?.savedAt ?? null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const empty = !did.trim() && !next.trim();

  async function save() {
    setSaving(true);
    setErr("");
    try {
      const res = await fetch("/api/karte", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, did, next }),
      });
      if (!res.ok) throw new Error();
      const body = (await res.json()) as { karte: KarteView };
      setSavedAt(body.karte.current?.savedAt ?? new Date().toISOString());
      onSaved(body.karte);
    } catch {
      setErr("カルテを残せませんでした。もう一度お試しください。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="カルテに残す（施術の後に・美容師が書く）">
      <p style={{ margin: "0 0 8px", fontSize: 12.5, lineHeight: 1.7, color: COLORS.sub }}>
        お客様の言葉は自動で写します（AI は書きません）。
      </p>
      {turns.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <Sources turns={turns} indexes={[0, ...keepIndexes.filter((n) => n !== 0)]} />
        </div>
      )}
      <div style={{ display: "grid", gap: 14 }}>
        <KarteField label="今日やったこと" value={did} onChange={setDid} />
        <KarteField label="次に確かめること" value={next} onChange={setNext} />
      </div>
      {err && <p style={{ margin: "10px 0 0", fontSize: 13, color: COLORS.warn }}>{err}</p>}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14, flexWrap: "wrap" }}>
        <button type="button" onClick={() => void save()} disabled={saving || empty} style={{ ...primaryButton, opacity: saving || empty ? 0.5 : 1 }}>
          {saving ? "残しています…" : "カルテに残す"}
        </button>
        {savedAt && <span style={{ fontSize: 13, color: COLORS.accent }}>残しました（{fmtMDHM(savedAt)}）</span>}
      </div>
    </Card>
  );
}

function KarteField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: COLORS.text, marginBottom: 4 }}>
        <span>{label}</span>
        <span style={{ color: COLORS.sub, fontSize: 12 }}>残り{KARTE_MAX_LEN - value.length}字</span>
      </span>
      <textarea
        value={value}
        maxLength={KARTE_MAX_LEN}
        rows={3}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          boxSizing: "border-box",
          border: `1px solid ${COLORS.line}`,
          borderRadius: RADIUS,
          padding: "10px 14px",
          fontSize: 15,
          lineHeight: 1.7,
          fontFamily: "inherit",
          color: COLORS.text,
          background: COLORS.card,
          resize: "vertical",
        }}
      />
    </label>
  );
}

/** 答えの印（サーバーが決めた物）を、美容師に見える言葉にする */
const VIA_LABEL: Record<Via, string> = {
  chip: "（候補から選んだ）",
  chip_edited: "（候補に書き足した）",
};

/** 候補を使った答えにだけ、小さく印を付ける */
function ViaMark({ via }: { via?: Via }) {
  if (!via) return null;
  return <span style={{ marginLeft: 4, color: COLORS.sub }}>{VIA_LABEL[via]}</span>;
}

/** 実在するお客様の答えの番号だけ残す */
function validIndexes(indexes: number[], count: number): number[] {
  return indexes.filter((n) => Number.isInteger(n) && n >= 0 && n < count);
}

/** もとになったお客様の答えを、原文のまま小さく */
function Sources({ turns, indexes }: { turns: Turn[]; indexes: number[] }) {
  const valid = validIndexes(indexes, turns.length);
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
          <ViaMark via={turns[n].via} />
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
const primaryButton: React.CSSProperties = {
  background: COLORS.accent,
  color: "#fff",
  border: "none",
  borderRadius: 999,
  padding: "10px 22px",
  fontSize: 14,
  fontWeight: 700,
  fontFamily: "inherit",
  cursor: "pointer",
};
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
