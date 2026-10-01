import path from 'node:path'
import { createSecureWindow } from './createSecureWindow'
import { getProjectManagerWindow, getProjectWindow, registerProjectWindow } from './registry'
import { closeAllTabsForWindow } from '../domain/sessionManager'

/** プロジェクトを新しいウィンドウで開く。すでに開いていれば、そのウィンドウを前面に出す。 */
export function openProjectWindow(projectId: string): void {
  const existing = getProjectWindow(projectId)
  if (existing) {
    existing.focus()
    closeProjectManager()
    return
  }

  const win = createSecureWindow({ width: 1200, height: 800, title: 'shovel' })
  registerProjectWindow(projectId, win)
  // 'closed' の時点では win が破棄済みなので、webContents を先に確保しておく。
  const webContents = win.webContents
  win.on('closed', () => closeAllTabsForWindow(webContents))
  // プロジェクトのウィンドウが表示されたら、プロジェクト一覧を閉じる。
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
