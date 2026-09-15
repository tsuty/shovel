import path from 'node:path'
import { createSecureWindow } from './createSecureWindow'
import { getProjectWindow, registerProjectWindow } from './registry'
import { closeAllTabsForWindow } from '../domain/sessionManager'

/**
 * decisions.md G-1-6: プロジェクトは常に新しいウィンドウで開く。
 * すでに開いていれば、そのウィンドウを前面に出して終了する。
 */
export function openProjectWindow(projectId: string): void {
  const existing = getProjectWindow(projectId)
  if (existing) {
    existing.focus()
    return
  }

  const win = createSecureWindow({ width: 1200, height: 800, title: 'shovel' })
  registerProjectWindow(projectId, win)
  win.on('closed', () => closeAllTabsForWindow(win.webContents))

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  const query = `projectId=${encodeURIComponent(projectId)}`
  if (rendererUrl) {
    void win.loadURL(`${rendererUrl}/main-window.html?${query}`)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/main-window.html'), { search: query })
  }
}
