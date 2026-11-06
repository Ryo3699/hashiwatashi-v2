import customers from "../data/customers.json";
import { isPublicMode } from "../server/public";

// 公開モードかどうかを、ビルド時でなく開くたびに見る
export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <main style={{ maxWidth: 390, margin: "0 auto", padding: "32px 20px" }}>
      <h1 style={{ fontSize: 20 }}>来店前の聞き取り</h1>
      <p style={{ fontSize: 14, lineHeight: 1.8 }}>
        お客様の画面と、美容師の画面です。AIは決めません。推測・参考までです。（お客様は全員、架空の人です）
      </p>
      {isPublicMode() && <JudgeGuide />}
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 12 }}>
        {customers.map((c) => (
          <li key={c.id} style={{ display: "grid", gap: 6 }}>
            <a href={`/customer/${c.id}`}>お客様の画面（{c.name}）</a>
            <a href={`/stylist/${c.id}`}>美容師の画面（{c.name}）</a>
          </li>
        ))}
      </ul>
    </main>
  );
}

/** 審査用リンク（公開モード）の時だけ出す、手順と注意 */
function JudgeGuide() {
  const box = { background: "#f4f1ea", borderRadius: 12, padding: "14px 16px", margin: "0 0 20px", fontSize: 13, lineHeight: 1.8 } as const;
  return (
    <section style={box} aria-label="審査用のお試しの案内">
      <p style={{ margin: "0 0 6px", fontWeight: 700 }}>審査用のお試し</p>
      <ol style={{ margin: "0 0 8px", paddingLeft: 20 }}>
        <li>お客様の画面で、架空のお客様になって答えてください（5問ほど・2〜3分）。</li>
        <li>終わったら、<strong>同じブラウザで</strong>美容師の画面を開いてください。</li>
      </ol>
      <ul style={{ margin: 0, paddingLeft: 20 }}>
        <li>架空の内容で答えてください。</li>
        <li>答えは Anthropic の Claude に送られます。</li>
        <li>保存は暗号化して置き、最後に保存してから72時間で消えます。保存された物を運営が読むことはできません（処理の間だけ、サーバーが一時的に復号します）。</li>
        <li>別の端末やブラウザでは、別のお試しになります。</li>
      </ul>
      <p style={{ margin: "10px 0 0", fontSize: 12, color: "#666" }}>
        Judge demo: answer as a fictional customer, then open the stylist screen in the same browser. Answers are sent to
        Anthropic&apos;s Claude; saved data is encrypted and deleted 72 hours after the last save, and the operator cannot read it (the server decrypts it only while handling your request).
      </p>
    </section>
  );
}
