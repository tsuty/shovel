/** ブラウザのタブで開けるページ（`http:` / `https:`）の URL なら true。 */
export function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/** プロジェクトのフォルダ内のファイルをブラウザのタブで開くための URL のスキーム。 */
export const LOCAL_PAGE_SCHEME = 'shovel-file'

/** プロジェクト内のファイル `relPath`（`/` 区切り）を開く URL。ホスト部分はプロジェクトの id。 */
export function localPageUrl(projectId: string, relPath: string): string {
  const encoded = relPath
    .split('/')
    .filter((segment) => segment !== '')
    .map(encodeURIComponent)
    .join('/')
  return `${LOCAL_PAGE_SCHEME}://${projectId}/${encoded}`
}

/** `shovel-file://<projectId>/<relPath>` を分解する。形が違えば null。`relPath` は `/` 区切りで先頭の `/` は無い。 */
export function parseLocalPageUrl(url: string): { projectId: string; relPath: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${LOCAL_PAGE_SCHEME}:` || !parsed.host) return null
  let relPath: string
  try {
    relPath = decodeURIComponent(parsed.pathname).replace(/^\/+/, '')
  } catch {
    return null
  }
  if (relPath.includes('\0')) return null
  return { projectId: parsed.host, relPath }
}

/** プロジェクト内のファイルを開く URL なら true。 */
export function isLocalPageUrl(url: string): boolean {
  return parseLocalPageUrl(url) !== null
}

/** ブラウザのタブで表示できる URL（`http:` / `https:` / `shovel-file:`）なら true。 */
export function isBrowsableUrl(url: string): boolean {
  return isWebUrl(url) || isLocalPageUrl(url)
}

/** アドレスバーで入力が空のときに開いておくページ。 */
export const BLANK_PAGE = 'about:blank'

const SEARCH_URL = 'https://www.google.com/search?q='

/** `localhost`・IPv4 アドレス・`.` を含むホスト名に、ポートとパス等が続いてもよい形。 */
const HOST_LIKE = /^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\]|[^\s/:?#]+\.[^\s/:?#]+)(:\d{1,5})?([/?#]\S*)?$/i
const LOCAL_HOST = /^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])(:\d{1,5})?([/?#]|$)/i

/**
 * アドレスバーの入力を開く URL にする。`http(s)://`・`shovel-file://` で始まればそのまま、ドメインらしい形なら
 * スキームを補い（`localhost` と IP アドレスは `http://`、それ以外は `https://`）、それ以外は検索する。
 * 空なら `null`。
 */
export function addressToUrl(input: string): string | null {
  const text = input.trim()
  if (!text) return null
  if (text.toLowerCase().startsWith(`${LOCAL_PAGE_SCHEME}://`) && isLocalPageUrl(text)) return text
  if (/^https?:\/\//i.test(text)) return isWebUrl(text) ? text : `${SEARCH_URL}${encodeURIComponent(text)}`
  if (HOST_LIKE.test(text)) {
    const url = `${LOCAL_HOST.test(text) ? 'http' : 'https'}://${text}`
    if (isWebUrl(url)) return url
  }
  return `${SEARCH_URL}${encodeURIComponent(text)}`
}
