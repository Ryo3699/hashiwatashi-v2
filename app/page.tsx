import customers from "../data/customers.json";

export default function Home() {
  return (
    <main style={{ maxWidth: 390, margin: "0 auto", padding: "32px 20px" }}>
      <h1 style={{ fontSize: 20 }}>来店前の聞き取り</h1>
      <p style={{ fontSize: 14, lineHeight: 1.8 }}>
        お客様の画面と、美容師の画面です。AIは決めません。推測・参考までです。（お客様は全員、架空の人です）
      </p>
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
