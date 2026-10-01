import { app, session } from 'electron'
import { registerIpc } from './ipc/registerIpc'
import { migrateFlatLogs } from './log'
import { migrateFlatSnapshots } from './persistence/snapshot'
import { openProjectManagerWindow } from './windows/projectManagerWindow'
import { anyProjectWindowOpen, getProjectManagerWindow } from './windows/registry'

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // architecture.md §2 / decisions.md G-1-1: 単一インスタンス + 複数ウィンドウ。
    // 2 回目の起動要求は既存 main に転送し、プロジェクトマネージャを前面に出す。
    const existing = getProjectManagerWindow()
    if (existing) existing.focus()
    else openProjectManagerWindow()
  })

  app.whenReady().then(async () => {
    installContentSecurityPolicy()
    // 以前の全プロジェクト共通の置き場から、プロジェクトごとのディレクトリへ
    // 移す。履歴一覧が旧ファイルを見落とさないよう、ウィンドウを開く前に済ませる。
    await Promise.all([migrateFlatSnapshots(), migrateFlatLogs()]).catch((err) =>
      console.warn('[startup] migration of local records failed', err)
    )
    registerIpc()
    openProjectManagerWindow()
  })

  app.on('window-all-closed', () => {
    // decisions.md N-2-3: アプリ終了時にサンドボックスを自動停止しない。
    // ここでは単にウィンドウが無くなった状態を許容するだけで、
    // プロセス自体を終了するかは OS の慣習に従う。
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('activate', () => {
    if (!anyProjectWindowOpen() && !getProjectManagerWindow()) openProjectManagerWindow()
  })
}

function installContentSecurityPolicy(): void {
  const isDev = !app.isPackaged
  // 'wasm-unsafe-eval': shiki（ファイルビューアのハイライト）が oniguruma の
  // WASM をコンパイルするのに要る。JS の eval は許可しない。
  const scriptSrc = isDev
    ? "'self' 'unsafe-inline' 'wasm-unsafe-eval' http://localhost:*"
    : "'self' 'wasm-unsafe-eval'"
  const connectSrc = isDev ? "'self' ws://localhost:* http://localhost:*" : "'self'"
  const csp = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    "object-src 'none'",
    "base-uri 'none'"
  ].join('; ')

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
      }
    })
  })
}
