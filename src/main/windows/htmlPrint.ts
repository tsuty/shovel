import { randomUUID } from 'node:crypto'
import { BrowserWindow, session, type Session } from 'electron'

/**
 * HTML ファイルを、そのページだけを読み込んだ非表示のウィンドウで印刷する。
 * JavaScript は無効、ページは専用の（保存しない）セッションの `shovel-print://` から配信し、
 * CSP で外部の画像・CSS・フォントを読ませない。
 */

const PARTITION = 'shovel-html-print'
const SCHEME = 'shovel-print'
const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:"

/** 印刷待ちのページの中身。キーは URL のホスト部分。 */
const pendingPages = new Map<string, string>()

let printSession: Session | null = null

function getPrintSession(): Session {
  if (printSession) return printSession
  const ses = session.fromPartition(PARTITION)
  ses.protocol.handle(SCHEME, (request) => {
    const html = pendingPages.get(new URL(request.url).host)
    if (html === undefined) return new Response('Not Found', { status: 404 })
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP }
    })
  })
  ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  printSession = ses
  return ses
}

/** OS の印刷ダイアログを出す。キャンセル・失敗でも resolve する。 */
export async function printHtml(html: string): Promise<void> {
  const id = randomUUID()
  pendingPages.set(id, html)
  const win = new BrowserWindow({
    show: false,
    webPreferences: { session: getPrintSession(), javascript: false, sandbox: true, contextIsolation: true }
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  try {
    await win.loadURL(`${SCHEME}://${id}/`)
    await new Promise<void>((resolve) => {
      win.webContents.print({ printBackground: true }, (success, failureReason) => {
        if (!success && failureReason !== 'cancelled') console.warn('[print] failed:', failureReason)
        resolve()
      })
    })
  } catch (err) {
    console.warn('[print] failed to load the page:', err)
  } finally {
    pendingPages.delete(id)
    if (!win.isDestroyed()) win.destroy()
  }
}
