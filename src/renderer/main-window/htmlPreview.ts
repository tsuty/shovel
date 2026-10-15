const DOCTYPE_PATTERN = /^\s*<!doctype[^>]*>/i

const BASE_TARGET_BLANK = '<base target="_blank">'

/**
 * HTML の先頭（DOCTYPE があればその直後）に `<base target="_blank">` を差し込む。
 * プレビュー内のリンクが iframe の中で遷移せず、新しいウィンドウを開こうとする（= 外部ブラウザへ渡る）ようにする。
 * DOCTYPE より前に置くと互換モードになるので、DOCTYPE の後ろに入れる。
 */
export function withLinksInNewWindow(html: string): string {
  const doctype = DOCTYPE_PATTERN.exec(html)
  if (!doctype) return BASE_TARGET_BLANK + html
  const end = doctype[0].length
  return html.slice(0, end) + BASE_TARGET_BLANK + html.slice(end)
}
