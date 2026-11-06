// 美容師の画面のカルテの見た目を、ブラウザなしで HTML にして確かめる（11/7 のコード点検の直し）。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KarteField, PreviousKarte } from "../app/stylist/[id]/Board";

describe("美容師の画面：カルテの見た目", () => {
  it("前回のカルテ：美容師のメモの改行をそのまま出す・長い英数字でも横にはみ出さない", () => {
    const html = renderToStaticMarkup(
      <PreviousKarte
        entry={{
          visitId: "v1",
          savedAt: "2026-11-07T05:00:00.000Z",
          wish: "すいてほしい",
          keep: [],
          did: "カット：顔まわり5cm\nカラー：8トーン",
          next: "前髪は\n眉上",
        }}
      />,
    );
    // やったこと・次に確かめることの2つとも、改行を残す書き方（pre-wrap）で出る
    const memos = html.match(/<p style="[^"]*white-space:pre-wrap[^"]*">[^<]*<\/p>/g) ?? [];
    expect(memos).toHaveLength(2);
    expect(memos[0]).toContain("カット：顔まわり5cm\nカラー：8トーン");
    expect(memos[1]).toContain("前髪は\n眉上");
    for (const m of memos) expect(m).toContain("word-break:break-word");
  });

  it("カルテの入力欄の文字は 16px（16px 未満だと iPhone で入力時に画面が拡大される）", () => {
    const html = renderToStaticMarkup(<KarteField label="今日やったこと" value="" onChange={() => undefined} />);
    expect(html).toMatch(/<textarea[^>]*style="[^"]*font-size:16px/);
  });
});
