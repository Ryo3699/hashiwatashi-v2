import type { ReactNode } from "react";

export const metadata = {
  title: "来店前の聞き取り",
  description: "来店前に髪の悩みを聞き、美容師へヒントを渡す（AIは決めない・推測参考まで）",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

// Noto Sans JP は <link> で読む（ビルド時にネットワークを使わないため）。読めない時は端末の日本語フォントに落ちる。
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap"
        />
      </head>
      <body
        style={{
          margin: 0,
          fontFamily: '"Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif',
          background: "#fbf8f3",
          color: "#2b2b2b",
        }}
      >
        {children}
      </body>
    </html>
  );
}
