/** ブラウザのタブで開けるページ（`http:` / `https:`）の URL なら true。 */
export function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/** アドレスバーで入力が空のときに開いておくページ。 */
export const BLANK_PAGE = 'about:blank'

const SEARCH_URL = 'https://www.google.com/search?q='

/** `localhost`・IPv4 アドレス・`.` を含むホスト名に、ポートとパス等が続いてもよい形。 */
const HOST_LIKE = /^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\]|[^\s/:?#]+\.[^\s/:?#]+)(:\d{1,5})?([/?#]\S*)?$/i
const LOCAL_HOST = /^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])(:\d{1,5})?([/?#]|$)/i

/**
 * アドレスバーの入力を開く URL にする。`http(s)://` で始まればそのまま、ドメインらしい形なら
 * スキームを補い（`localhost` と IP アドレスは `http://`、それ以外は `https://`）、それ以外は検索する。
 * 空なら `null`。
 */
export function addressToUrl(input: string): string | null {
  const text = input.trim()
  if (!text) return null
  if (/^https?:\/\//i.test(text)) return isWebUrl(text) ? text : `${SEARCH_URL}${encodeURIComponent(text)}`
  if (HOST_LIKE.test(text)) {
    const url = `${LOCAL_HOST.test(text) ? 'http' : 'https'}://${text}`
    if (isWebUrl(url)) return url
  }
  return `${SEARCH_URL}${encodeURIComponent(text)}`
}
