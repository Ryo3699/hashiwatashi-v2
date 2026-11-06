# 審査用リンク（公開モード）の仕様

> 2026-11-07 作り手（Ryo）の依頼「今から作れない？」で作る。審査員がブラウザで実物を触れるようにする。
> 中身はこのリポの同じコード。違いは環境変数 `HASHI_PUBLIC=1` の時だけ働く部分だけ。

## 目的
- 審査員がリンクを開き、架空のお客様になって答え（5問ほど）、同じブラウザで美容師の画面を見られる
- 本物の Claude を使う（聞き取り＝`MODELS.interview`・まとめ＝`MODELS.summarize`。既定は今のまま）
- 置き場は Vercel。保存と回数の数えは Upstash Redis（REST）

## 動かしてはいけない所（不変条件）
1. **`HASHI_PUBLIC` が無い時（＝手元・録画・`npm run trial`・テスト）は、今と1バイトも同じ動き**。保存先 `data/runtime/<id>.json` と `<id>.karte.json`、一時ファイル→rename の書き方、エラー文、クッキーなし、回数制限なし。今あるテスト210本はそのまま全部通る（テストを書き換えて通すのは禁止）
2. **審査員どうしの会話が混ざらない**：公開モードの保存はすべて「訪問者」ごとに分ける。訪問者のクッキーが無い API の呼び出しは 401 で断る。**共有の保存先に落ちる道を作らない**
3. **保存された物は運営も読めない**：公開モードの保存は、訪問者のクッキーの秘密から作った鍵で暗号化してから Redis に置く。サーバー側に復号の鍵を持たない（ただし秘密はリクエストのたびにサーバーへ届き、処理の間だけサーバーが復号する。答えは Claude にも送られる＝「データベースを見ても読めない」までが言えること）。答えの文をログに出さない
4. **お金の上限は閉じる側に倒す**：回数を数えられない時（Redis が落ちた等）は通さない（503）。上限なしで通す道を作らない
5. **偽物の Claude を公開しない**：`process.env.VERCEL` があり `HASHI_FAKE=1` の時は、公開モードの API を 503 で止める
6. ルートのファイル（`app/api/*/route.ts`）は触らない（別の作業が同時に直しているため）。どうしても要る時は理由を報告に書く

## 環境変数（公開モードだけで読む）
| 名前 | 中身 | 既定 |
|---|---|---|
| `HASHI_PUBLIC` | `1` で公開モード | なし＝手元の動き |
| `HASHI_DEMO_OFF` | `1` で止める（画面も API も 503・やさしい文） | なし |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Upstash の REST（Vercel の Marketplace で作るとこの名前で入る） | — |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | 上の別名（どちらかあれば使う） | — |
| `HASHI_KV` | `memory` で手元の試し用の入れ物（**Vercel 上（`VERCEL` あり）では拒否**＝インスタンスごとに分かれて数えられないため） | なし |
| `HASHI_LIMIT_VISITOR_DAY` | 1人（訪問者）1日の POST 上限 | 80 |
| `HASHI_LIMIT_IP_HOUR` | 1つの IP の1時間の POST 上限 | 120 |
| `HASHI_LIMIT_GLOBAL_DAY` | 全体の1日の POST 上限 | 600 |
| `HASHI_LIMIT_SUMMARY_DAY` | まとめ（`/api/summary`・Opus）だけの全体1日の上限（別枠） | 150 |
| `HASHI_LIMIT_SUMMARY_IP_HOUR` | まとめだけの、1つの IP の1時間の上限（別枠） | 10 |
| `HASHI_IP_SALT` | IP のハッシュの鍵。無ければ Redis のトークンから作る | なし |
| `HASHI_INTERVIEW_MODEL` / `HASHI_SUMMARY_MODEL` | モデルの上書き（**既定は今の `lib/config.ts` の値のまま**） | なし |

上限の環境変数は、設定したのに正の整数でない（0・誤記）と、既定値に戻さず API を 503 で止める（空・未設定は既定値）。

## 作る物

### 1. `proxy.ts`（Next.js 16 の名前。旧 middleware。仕様は `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md` を読んでから書く）
- `HASHI_PUBLIC !== "1"` なら `NextResponse.next()` を返す（手元の動きを変えない）。**ただし `VERCEL` がある時は 503**（Vercel 上で `HASHI_PUBLIC` を付け忘れても、上限なしで Claude を呼ばせない）
- matcher は `_next/static`・`_next/image`・`favicon.ico` を除く全部
- `HASHI_DEMO_OFF=1`：画面は「審査用のお試しは、いま止めています。」の短い HTML（503）、API は JSON `{ error }`（503）
- 訪問者のクッキー `hv`：値＝32バイトの乱数を base64url（43文字）。`httpOnly`・`sameSite: "lax"`・`path: "/"`・`secure`（本番）・`maxAge` 72時間
  - 「API か画面か」は、パスをデコードして `.`・`..`・`//`・`\` を畳み、小文字にしてから見る（`/%61pi/…`・`/api%2F…` でもすり抜けない）。画面と認めるのは `/`・`/customer/…`・`/stylist/…` だけで、それ以外は API 扱い。GET・HEAD・OPTIONS 以外の呼び出しは、画面のパスでも API と同じ扱い
  - 画面（API 以外）でクッキーが無い・形が違う時は新しく作って、応答に付ける。**同じリクエストの中のサーバー側からも読めるよう**、リクエストのヘッダの Cookie にも足して `NextResponse.next({ request: { headers } })` で渡す
  - API（`/api/*`）でクッキーが無い・形が違う時は **401** `{ error: "最初の画面から、同じブラウザで開いてください。" }`
- 回数制限（API の **POST など書き込みの呼び出しだけ**数える。GET は数えない）：
  - 訪問者×日（日本時間の日付）・IP×時・全体×日、の3つを Redis で数える。1つでも上限を超えたら **429** `{ error: "今日のお試しの上限に達しました。時間をおいてお試しください。" }`
  - 数え方：`SET key 0 EX <ttl> NX` → `INCR key`（どの Redis でも期限が付く）。パイプライン1回で3つまとめて送ってよい
  - 断った時の戻し：IP の上限で断った分は、全体の数から戻す（1つの IP が全体の枠を食い潰さない）。訪問者の上限だけで断った分は戻さない（その IP の上限で頭打ちになるため）
  - まとめ（`/api/summary`）は別枠も数える：全体/日 150・IP/時 10（通った後に数える）
  - IP は生のまま保存しない（HMAC-SHA256 の頭24文字。鍵は `HASHI_IP_SALT`、無ければ Redis のトークンから作る）。IP は Vercel 上なら `x-vercel-forwarded-for`、次に `x-forwarded-for` の先頭、無ければ `x-real-ip`、無ければ `unknown`
  - Redis に聞けない・時間切れ（3秒）は **503** `{ error: "ただいま混み合っています。しばらくしてからお試しください。" }`
- 公開モードでは全部の応答に `X-Robots-Tag: noindex`（検索に載せない）
- `VERCEL` があって `HASHI_FAKE=1` なら API を 503（不変条件5）

### 2. `server/kv.ts`（新規）
- 小さな入れ物の口：`get(key)`・`set(key, value, ttlSec)`・`incrMany([{ key, ttlSec }])`（数えた後の値の配列を返す）
- Upstash REST の実装：`fetch(url + "/pipeline", { method: "POST", headers: { Authorization: "Bearer " + token }, body: JSON.stringify([[...], ...]) })`、`AbortSignal.timeout(3000)`。返事は `[{ result }, ...]`、`error` があれば投げる。**新しい npm の道具は足さない**（fetch だけ）
- `HASHI_KV=memory` の実装（Map と期限）。`VERCEL` がある時は使えないよう投げる
- 鍵（トークン）を投げる文・ログに入れない

### 3. `server/storage.ts`（新規）＋ `store.ts`・`karte.ts` の差し替え
- `readText(name)`／`writeText(name, text)`（`name` は `p1.json`・`p1.karte.json` のような名前）
- 手元（公開モードでない）：今の `fs` の書き方をそのまま移す（`runtimeDir()` の下・`mkdir -p`・一時ファイル→rename・ENOENT は null）
- 公開モード：`cookies()`（`next/headers`）から `hv` を読む → 形を確かめる（無い・違うなら専用のエラーを投げる。**共有の名前に落とさない**）
  - 訪問者の名前＝`sha256("hashiwatashi:id:" + 秘密)` の頭32文字（16進）
  - 鍵＝HKDF-SHA256（材料＝秘密のバイト・salt＝`"hashiwatashi"`・info＝`"store-v1"`・32バイト）→ AES-256-GCM、IV は毎回12バイトの乱数。保存の形は `v1.<iv>.<暗号文+tag>`（base64url）
  - Redis の名前＝`hv1:<訪問者の名前>:<name>`、書くたびに `EX 259200`（72時間＝**最後に書いてから**）。暗号文には置き場の名前（`hv1:<訪問者>:<name>`）を AAD として結びつける（別の名前の場所へ差し替えても開けない）
  - 復号できない時は「無い」と同じに扱う（中身はログに出さない）
- `store.ts` の `loadSession`／`saveSession`、`karte.ts` の読み書きは、`fs` を直接呼ぶ所だけを `readText`／`writeText` に置き換える（ほかの中身は触らない。`karte.ts` は別の作業が今直しているので、差分は読み書きの数行に留める）

### 4. 画面（公開モードの時だけ）
- トップ（`app/page.tsx`・サーバー側で `process.env.HASHI_PUBLIC` を読む）に、短い手順と注意を出す：
  - 手順：①お客様の画面で、架空のお客様になって答える（5問ほど・2〜3分）②終わったら、**同じブラウザで**美容師の画面を開く
  - 注意：架空の内容で答えてください／答えは Anthropic の Claude に送られます／保存は暗号化して置き、最後に保存してから72時間で消える。保存された物を運営は読めない（処理の間だけサーバーが復号する）／別の端末やブラウザでは、別のお試しになります
  - 英語の短い版も下に（Judge demo: answer as a fictional customer, then open the stylist screen in the same browser. Answers are sent to Anthropic's Claude; saved data is encrypted and deleted 72 hours after the last save, and the operator cannot read it.）
- お客様の画面（`Chat`）：サーバー側のページから `notice` を渡し、見出しの下に1行（「架空の内容でお試しください。答えは Claude に送られます。」）。レイアウト（高さ 100dvh）を崩さない
- エラーの文：`Chat` と `Board` で、応答が 401・429・503 で `error` の文がある時は、その文を出す（今の決まった文の代わり）。それ以外は今の文のまま。`Board.tsx` は別の作業が直している最中なので、差分はエラーを出す所の数行に留める

### 5. 使った量の記録（公開モードのみ・小さく）
- `lib/claude.ts` の本物の口に、任意の `onUsage({ model, input_tokens, output_tokens })` を足す（無ければ今と同じ）
- `server/claude.ts` は公開モードの時だけ `onUsage` を渡し、Redis に `usage:<日付>:<model>:in|out` を INCRBY（40日の期限）。**待つのは最大1.5秒・失敗しても会話は止めない**
- `scripts/demo_usage.ts`：直近 N 日の数を読み、トークン数と目安の金額（Sonnet 5.5＝入力 $2・出力 $10／Opus 5.5＝入力 $4・出力 $20、100万トークンあたり）を出す。読むのは環境変数の REST だけ

### 6. 配る時のもの
- `.vercelignore`：`data/runtime`・`runs`・`.env*`・`.claude`・`.next`・`node_modules`・`.vercel` を除く（`data/runtime` には録画の会話がある）
- `lib/config.ts`：`HASHI_INTERVIEW_MODEL`／`HASHI_SUMMARY_MODEL` で上書きできるように（既定は今の値。型が string になってもよい）

### 7. テスト（足す。今の210本はそのまま）
- 手元モード：保存の読み書きが今と同じファイルに出る
- 暗号：往復できる／秘密が違うと読めない／改ざんは「無い」になる
- 公開モード（`HASHI_KV=memory`）：同じ `p1` でも訪問者が違えば混ざらない／書くたびに期限が付く
- proxy：手元モードは素通り／API にクッキー無し→401／上限超え→429（文つき）／Redis 失敗→503／止める→503／画面でクッキーが無ければ作る（形43文字・httpOnly）
- `npm test`・`npm run typecheck`・`NEXT_TELEMETRY_DISABLED=1 npx next build` が全部通ること

## 手元での試し方
```
HASHI_PUBLIC=1 HASHI_KV=memory ANTHROPIC_API_KEY=... npm run dev   # 本物の Claude・回数は手元の入れ物で数える
```

## わかっている小さな穴
- 美容師の画面とお客様の画面がほぼ同時にまとめを頼むと、別のサーバーで2回作ることがある（費用が1回分増えるだけ。中身は後の方で上書き）
- 訪問者はクッキーだけで決まる。別の端末・別のブラウザでは別のお試しになる（トップに書く）

## 費用と運用の注意（点検で出た分）
- **効く上限**：訪問者のクッキーは署名がなく客が自由に作れるので、「1人80回/日」は事故防止の目安で、金額の防御にならない。効くのは **IP/時** と **全体/日**（と、まとめの別枠）。審査員が少人数なら `HASHI_LIMIT_IP_HOUR` を下げる（30 程度）と、1つの IP が全体を使い切るのに時間がかかる。報告で「1人80回まで」を保証として書かない
- **1回の費用の見積もり（実測ではない）**：聞き取りの答え1回は普通 約 $0.014・最悪 約 $0.11（最大2回呼び）。まとめ1回は普通 約 $0.11・最悪 約 $0.70（Opus・最大2回呼び）。全体600/日が全部通る最悪の目安は、答えだけなら約 $67/日、悪意のある使い方（まとめを混ぜる）で約 $115/日。まとめの別枠（150/日）で絞っている。別々のサーバーが同時にまとめを作る穴は残る（上の「小さな穴」）
- **本当の天井は Anthropic のコンソール側**：審査用の鍵は専用のワークスペースで作り、そのワークスペースに月の利用上限（例 $50）を必ず置く（コードの数えが破れた時の最後の砦）。毎日 `HASHI_PUBLIC=1 npm run demo:usage` を見て、目安を超えたら `HASHI_DEMO_OFF=1` で止める
- 審査の当日は、`HASHI_LIMIT_GLOBAL_DAY` を余裕を持って上げる運用でよい（その分の費用の天井も上がる）。日本時間の0時をまたぐと、上限は2回分使える
- GET は数えない（Redis の読み出しと関数の呼び出しは無制限）。Upstash の月間コマンド数の枠を確認する。枠が尽きると数えが失敗して全員 503（閉じる側・仕様どおり）
- `demo_usage` の合計は「目安」：記録は応答のあと最大1.5秒しか待たないので少なめに出ることがある。モデルを環境変数で上書いているなら、配備と同じ `HASHI_PUBLIC=1` と環境変数を付けて回す。請求の実額は Anthropic のコンソール
- Vercel の Build Command は `vercel.json` で `npm run build`（＝`next build --webpack`・手元で確かめたのと同じ作り方）に決めてある
- IP のハッシュは Redis だけを盗み見られた場合の備えで、運営（トークンも Vercel のログも見られる）からは隠せない
