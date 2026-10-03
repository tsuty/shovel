import { createSecureWindow } from './createSecureWindow'
import { rendererPageUrl } from './rendererProtocol'
import { getProjectManagerWindow, getProjectWindow, registerProjectWindow } from './registry'
import { closeAllTabsForWindow } from '../domain/sessionManager'
import { projectsStore } from '../persistence/store'

/** プロジェクトを新しいウィンドウで開く。すでに開いていれば、そのウィンドウを前面に出す。 */
export function openProjectWindow(projectId: string): void {
  const existing = getProjectWindow(projectId)
  if (existing) {
    existing.focus()
    closeProjectManager()
    return
  }

  const win = createSecureWindow({ width: 1200, height: 800, title: projectWindowTitle(projectId) })
  // macOS の Dock メニューなどはウィンドウタイトルで一覧するので、プロジェクト名を入れておき、
  // HTML の <title>（固定の "shovel"）で上書きされないようにする。
  win.on('page-title-updated', (event) => event.preventDefault())
  registerProjectWindow(projectId, win)
  // 'closed' の時点では win が破棄済みなので、webContents を先に確保しておく。
  const webContents = win.webContents
  win.on('closed', () => closeAllTabsForWindow(webContents))
  // プロジェクトのウィンドウが表示されたら、プロジェクト一覧を閉じる。
  win.once('ready-to-show', closeProjectManager)

  void win.loadURL(rendererPageUrl('main-window.html', `projectId=${encodeURIComponent(projectId)}`))
}

/** プロジェクト名の変更を、開いているウィンドウのタイトルに反映する。 */
export function refreshProjectWindowTitle(projectId: string): void {
  getProjectWindow(projectId)?.setTitle(projectWindowTitle(projectId))
}

function projectWindowTitle(projectId: string): string {
  const project = projectsStore.list().find((p) => p.id === projectId)
  return project ? `${project.displayName} — shovel` : 'shovel'
}

function closeProjectManager(): void {
  getProjectManagerWindow()?.close()
}
