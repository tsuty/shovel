import path from 'node:path'
import { createSecureWindow } from './createSecureWindow'
import { getProjectManagerWindow, getProjectWindow, registerProjectWindow } from './registry'
import { closeAllTabsForWindow } from '../domain/sessionManager'

/**
 * decisions.md G-1-6: プロジェクトは常に新しいウィンドウで開く。
 * すでに開いていれば、そのウィンドウを前面に出して終了する。
 */
export function openProjectWindow(projectId: string): void {
  const existing = getProjectWindow(projectId)
  if (existing) {
    existing.focus()
    closeProjectManager()
    return
  }

  const win = createSecureWindow({ width: 1200, height: 800, title: 'shovel' })
  registerProjectWindow(projectId, win)
  // 'closed' が発火した時点で win は破棄済みのため、win.webContents に触れると
  // 「Object has been destroyed」で例外になる。破棄前に参照だけ確保しておく。
  const webContents = win.webContents
  win.on('closed', () => closeAllTabsForWindow(webContents))
  // プロジェクトのウィンドウが開いたら、プロジェクト一覧は閉じる（ヘッダーの
  // メニューからいつでも開き直せる）。表示されてから閉じ、ウィンドウが1つも
  // 無い瞬間を作らない。
  win.once('ready-to-show', closeProjectManager)

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  const query = `projectId=${encodeURIComponent(projectId)}`
  if (rendererUrl) {
    void win.loadURL(`${rendererUrl}/main-window.html?${query}`)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/main-window.html'), { search: query })
  }
}

function closeProjectManager(): void {
  getProjectManagerWindow()?.close()
}
