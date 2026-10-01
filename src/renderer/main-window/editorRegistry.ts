/**
 * flows.md §4 / decisions.md N-5: プロンプト送信時に、開いている Markdown
 * エディタの未保存編集を autosave のデバウンス待ちを飛ばしてディスクへ
 * フラッシュする。エージェントは IDE のバッファではなくディスクを読むため。
 * ウィンドウ内に複数のエディタタブが同時に存在しうるので、モジュール単位の
 * 簡易 pub-sub で束ねる。
 *
 * 送信側は書き込みの完了を待ってからプロンプトを送る。添付は `resource_link`
 * （パスのみ）で、エージェントはサンドボックス内でディスク上のファイルを読む
 * ので、書き込み前に送ると編集前の内容を読まれうる。
 */
const flushers = new Set<() => Promise<void>>()

export function registerFlush(fn: () => Promise<void>): () => void {
  flushers.add(fn)
  return () => flushers.delete(fn)
}

/** 書き込みに失敗しても送信は止めない（エディタ側の autosave と同じ扱い）。 */
export async function flushAllEditors(): Promise<void> {
  await Promise.allSettled([...flushers].map((fn) => fn()))
}
