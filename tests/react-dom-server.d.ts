// テスト（board.test.tsx）で使う react-dom/server の型だけ。@types/react-dom は入れていない（依存を足さないため）。
declare module "react-dom/server" {
  import type { ReactNode } from "react";
  export function renderToStaticMarkup(element: ReactNode): string;
}
