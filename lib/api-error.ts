// 画面（お客様・美容師）から API を呼んだ時のエラー文。
// 公開モードの proxy が返す 401・429・503 は、error の文をそのまま画面に出す。それ以外は画面ごとの決まった文のまま。
export class ShownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShownError";
  }
}

const SHOWN_STATUSES = [401, 429, 503];

/** 応答が 401・429・503 で error の文がある時だけ ShownError を投げる。それ以外は何もしない */
export async function throwIfShown(res: Response): Promise<void> {
  if (!SHOWN_STATUSES.includes(res.status)) return;
  let message: unknown;
  try {
    message = ((await res.clone().json()) as { error?: unknown } | null)?.error;
  } catch {
    return;
  }
  if (typeof message === "string" && message.trim()) throw new ShownError(message);
}

/** catch で受けたものから出す文を選ぶ（ShownError ならその文・それ以外は決まった文） */
export function shownOr(e: unknown, fallback: string): string {
  return e instanceof ShownError ? e.message : fallback;
}
