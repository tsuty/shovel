import { app, session } from 'electron'
import { registerIpc } from './ipc/registerIpc'
import { migrateFlatLogs } from './log'
import { migrateFlatSnapshots } from './persistence/snapshot'
import { applyLoginShellPath } from './shellPath'
import { installAppMenu } from './windows/appMenu'
import { openProjectManagerWindow } from './windows/projectManagerWindow'
import { installRendererProtocol, registerRendererScheme } from './windows/rendererProtocol'
import { anyProjectWindowOpen, getProjectManagerWindow, markQuitting } from './windows/registry'

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  registerRendererScheme()

  // PATH の取り込みと IPC 登録が済むまでは、Dock クリックなどの `activate` でウィンドウを開かない。
  let startupDone = false

  app.on('second-instance', () => {
    // 単一インスタンス。2 回目の起動要求ではプロジェクトマネージャを前面に出す。
    if (!startupDone) return
    const existing = getProjectManagerWindow()
    if (existing) existing.focus()
    else openProjectManagerWindow()
  })

  app.whenReady().then(async () => {
    installContentSecurityPolicy()
    installRendererProtocol()
    await Promise.all([
      // GUI から起動するとログインシェルの PATH が無く `sbx` が見つからないため、先に取り込む。
      applyLoginShellPath(),
      // 旧形式のログをプロジェクトごとのディレクトリへ移す。
      Promise.all([migrateFlatSnapshots(), migrateFlatLogs()]).catch((err) =>
        console.warn('[startup] migration of local records failed', err)
      )
    ])
    registerIpc()
    installAppMenu()
    startupDone = true
    openProjectManagerWindow()
  }).catch((err: unknown) => console.error('[startup] failed', err))

  app.on('before-quit', markQuitting)

  app.on('window-all-closed', () => {
    // 最後のプロジェクトのウィンドウを閉じるとプロジェクトマネージャが開き直されるので、ここに来るのは
    // プロジェクトマネージャを閉じたときか終了処理中だけ。macOS でもウィンドウ無しで常駐させず終了する
    // （何もできない状態を残さない）。
    app.quit()
  })

  app.on('activate', () => {
    if (!startupDone) return
    if (!anyProjectWindowOpen() && !getProjectManagerWindow()) openProjectManagerWindow()
  })
}

function installContentSecurityPolicy(): void {
  const isDev = !app.isPackaged
  // 'wasm-unsafe-eval': shiki が oniguruma の WASM をコンパイルするのに要る。
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
