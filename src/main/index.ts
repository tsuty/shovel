import { app, session } from 'electron'
import { registerIpc } from './ipc/registerIpc'
import { migrateFlatLogs } from './log'
import { migrateFlatSnapshots } from './persistence/snapshot'
import { applyLoginShellPath } from './shellPath'
import { installAppMenu } from './windows/appMenu'
import { openProjectManagerWindow } from './windows/projectManagerWindow'
import { installRendererProtocol, registerRendererScheme } from './windows/rendererProtocol'
import { anyProjectWindowOpen, getProjectManagerWindow, markQuitting } from './windows/registry'
import { installBrowserGuestPolicy } from './windows/browserGuest'
import { LOCAL_PAGE_SCHEME_PRIVILEGES } from './windows/localPageProtocol'
import { installAppHealthMonitor } from './windows/rendererRecovery'
import { applyPlanUsageSetting, notePlanUsageActivity } from './domain/planUsageService'
import { CLI_OPEN_KEY, type CliOpenRequest, parseCliArgv, parseCliOpenData } from './domain/cliCommand'
import { openFromCli } from './domain/cliOpenService'

// コマンドラインツール（`shovel [path]`）から起動されたときの要求。すでに起動していれば、
// 1 つ目のプロセスへ `additionalData` で渡す（`second-instance` の argv は順序が変わりうるので使わない）。
const cliOpen = parseCliArgv(process.argv, process.cwd())
const gotLock = app.requestSingleInstanceLock(cliOpen ? { [CLI_OPEN_KEY]: cliOpen } : {})
if (!gotLock) {
  app.quit()
} else {
  registerRendererScheme([LOCAL_PAGE_SCHEME_PRIVILEGES])

  // PATH の取り込みと IPC 登録が済むまでは、Dock クリックなどの `activate` でウィンドウを開かない。
  let startupDone = false
  // 起動処理が終わる前に届いたコマンドラインツールの要求。
  const pendingCliOpens: CliOpenRequest[] = cliOpen ? [cliOpen] : []

  app.on('second-instance', (_event, _argv, _workingDirectory, additionalData) => {
    const request = parseCliOpenData(additionalData)
    if (request) {
      if (startupDone) void openFromCli(request)
      else pendingCliOpens.push(request)
      return
    }
    // 単一インスタンス。2 回目の起動要求ではプロジェクトマネージャを前面に出す。
    if (!startupDone) return
    const existing = getProjectManagerWindow()
    if (existing) existing.focus()
    else openProjectManagerWindow()
  })

  app.whenReady().then(async () => {
    installContentSecurityPolicy()
    installRendererProtocol()
    installBrowserGuestPolicy()
    installAppHealthMonitor()
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
    applyPlanUsageSetting()
    app.on('browser-window-focus', notePlanUsageActivity)
    startupDone = true
    // コマンドラインツールから起動されたら、プロジェクトマネージャを経ずにプロジェクトを開く
    // （開けなければ openFromCli がプロジェクトマネージャを開く）。
    if (pendingCliOpens.length === 0) openProjectManagerWindow()
    for (const request of pendingCliOpens.splice(0)) void openFromCli(request)
  }).catch((err: unknown) => console.error('[startup] failed', err))

  app.on('before-quit', markQuitting)

  app.on('window-all-closed', () => {
    // 最後のプロジェクトのウィンドウを閉じるとプロジェクトマネージャが開き直されるので、ここに来るのは
    // プロジェクトマネージャを閉じたときか終了処理中だけ。macOS でも終了する。
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
