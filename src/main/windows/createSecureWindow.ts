import { app, BrowserWindow, shell } from 'electron'
import path from 'node:path'

/**
 * すべての `BrowserWindow` に共通のセキュリティ設定。architecture.md §2:
 * `contextIsolation: true` / `nodeIntegration: false`、`will-navigate` と
 * `setWindowOpenHandler` を塞ぎリンクは外部ブラウザへ。
 */
export function createSecureWindow(options: {
  width: number
  height: number
  title: string
}): BrowserWindow {
  const win = new BrowserWindow({
    width: options.width,
    height: options.height,
    title: options.title,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  // ウィンドウ内の遷移・新規ウィンドウは一切許さない（アプリの画面が別の
  // ページに置き換わると状態がすべて失われる）。外へ渡すのは http(s) と mailto
  // だけ — `file://` や任意のスキームを OS に渡すと、ローカルのファイルや別の
  // アプリを開けてしまう。アプリ自身の origin への遷移は外へも渡さず捨てる。
  // 例外は開発時の同じページの再読み込み（Vite のフルリロード）だけ。
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!isSameOrigin(url, win.webContents.getURL())) openExternalIfSafe(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    const current = win.webContents.getURL()
    if (!app.isPackaged && isSamePage(url, current)) return
    event.preventDefault()
    if (!isSameOrigin(url, current)) openExternalIfSafe(url)
  })

  win.once('ready-to-show', () => win.show())

  return win
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

function isSameOrigin(a: string, b: string): boolean {
  const ua = parseUrl(a)
  const ub = parseUrl(b)
  if (!ua || !ub) return false
  // file: の origin は "null" になるので、プロトコルとホストで比べる。
  return ua.protocol === ub.protocol && ua.host === ub.host
}

/** パスまで同じ（クエリ・ハッシュは問わない）= 同じページの再読み込み。 */
function isSamePage(a: string, b: string): boolean {
  const ua = parseUrl(a)
  const ub = parseUrl(b)
  return !!ua && !!ub && isSameOrigin(a, b) && ua.pathname === ub.pathname
}

function openExternalIfSafe(url: string): void {
  let protocol: string
  try {
    protocol = new URL(url).protocol
  } catch {
    return
  }
  if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:') void shell.openExternal(url)
}
