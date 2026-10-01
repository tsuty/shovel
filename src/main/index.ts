import { app, session } from 'electron'
import { registerIpc } from './ipc/registerIpc'
import { migrateFlatLogs } from './log'
import { migrateFlatSnapshots } from './persistence/snapshot'
import { openProjectManagerWindow } from './windows/projectManagerWindow'
import { installRendererProtocol, registerRendererScheme } from './windows/rendererProtocol'
import { anyProjectWindowOpen, getProjectManagerWindow } from './windows/registry'

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  registerRendererScheme()

  app.on('second-instance', () => {
    // 単一インスタンス。2 回目の起動要求ではプロジェクトマネージャを前面に出す。
    const existing = getProjectManagerWindow()
    if (existing) existing.focus()
    else openProjectManagerWindow()
  })

  app.whenReady().then(async () => {
    installContentSecurityPolicy()
    installRendererProtocol()
    // 旧形式のログをプロジェクトごとのディレクトリへ移す。
    await Promise.all([migrateFlatSnapshots(), migrateFlatLogs()]).catch((err) =>
      console.warn('[startup] migration of local records failed', err)
    )
    registerIpc()
    openProjectManagerWindow()
  }).catch((err: unknown) => console.error('[startup] failed', err))

  app.on('window-all-closed', () => {
    // 全ウィンドウが閉じたときの終了は OS の慣習に従う。
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('activate', () => {
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
