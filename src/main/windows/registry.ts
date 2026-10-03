import { BrowserWindow } from 'electron'

/** プロジェクト id ごとに開いているウィンドウを管理する。 */
const windowsByProjectId = new Map<string, BrowserWindow>()
let projectManagerWindow: BrowserWindow | null = null
/** アプリの終了処理中か。終了でウィンドウが閉じていく途中に、プロジェクトマネージャを開き直さないために使う。 */
let quitting = false

export function markQuitting(): void {
  quitting = true
}

export function isQuitting(): boolean {
  return quitting
}

export function getProjectWindow(projectId: string): BrowserWindow | null {
  const win = windowsByProjectId.get(projectId)
  if (win && !win.isDestroyed()) return win
  windowsByProjectId.delete(projectId)
  return null
}

export function registerProjectWindow(projectId: string, win: BrowserWindow): void {
  windowsByProjectId.set(projectId, win)
  win.once('closed', () => {
    windowsByProjectId.delete(projectId)
  })
}

export function getProjectManagerWindow(): BrowserWindow | null {
  if (projectManagerWindow && !projectManagerWindow.isDestroyed()) return projectManagerWindow
  return null
}

export function setProjectManagerWindow(win: BrowserWindow): void {
  projectManagerWindow = win
  win.once('closed', () => {
    projectManagerWindow = null
  })
}

export function anyProjectWindowOpen(): boolean {
  for (const win of windowsByProjectId.values()) {
    if (!win.isDestroyed()) return true
  }
  return false
}
