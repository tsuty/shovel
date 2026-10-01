import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { protocol } from 'electron'

/**
 * ビルド済みの renderer を `file://` ではなく `app://renderer/...` で読み込む。
 * Electron 44 の `file://` は、多数のモジュールを同時に動的 import すると一部が
 * `net::ERR_FAILED` で失敗する（shiki の言語定義や Mermaid の図の遅延読み込みが壊れる）。
 * メインプロセスが `fs` で読んで返せば起きない（decisions.md F-1b）。
 * 開発時（`ELECTRON_RENDERER_URL`）は Vite の開発サーバーから読むので使わない。
 */

const SCHEME = 'app'
const HOST = 'renderer'
const RENDERER_ROOT = path.join(__dirname, '../renderer')

const MIME_BY_EXT: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2'
}

/** `app.whenReady()` より前に呼ぶ。 */
export function registerRendererScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
  ])
}

/** `app.whenReady()` の後に呼ぶ。 */
export function installRendererProtocol(): void {
  protocol.handle(SCHEME, async (request) => {
    const filePath = resolveRendererPath(request.url)
    if (!filePath) return new Response('Not Found', { status: 404 })
    try {
      const body = await readFile(filePath)
      const type = MIME_BY_EXT[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
      return new Response(body, { headers: { 'Content-Type': type } })
    } catch {
      return new Response('Not Found', { status: 404 })
    }
  })
}

/** `app://renderer/<path>` を `out/renderer` 配下の絶対パスにする。外を指すものは null。 */
function resolveRendererPath(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.host !== HOST) return null
  let pathname: string
  try {
    pathname = decodeURIComponent(parsed.pathname)
  } catch {
    return null
  }
  const filePath = path.join(RENDERER_ROOT, pathname)
  const rel = path.relative(RENDERER_ROOT, filePath)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null
  return filePath
}

/** renderer のページの URL。開発時は Vite の開発サーバー、それ以外は `app://`。 */
export function rendererPageUrl(page: string, query?: string): string {
  const base = process.env.ELECTRON_RENDERER_URL ?? `${SCHEME}://${HOST}`
  return `${base}/${page}${query ? `?${query}` : ''}`
}
