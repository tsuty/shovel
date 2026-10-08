import type { BrowserWindow } from 'electron'
import { createSecureWindow } from './createSecureWindow'
import { rendererPageUrl } from './rendererProtocol'

/** 開いている印刷用表示のウィンドウ（ファイルごとに1枚）。中身は renderer がディスクから読んで描く。 */
const windowsByKey = new Map<string, { projectId: string; win: BrowserWindow }>()

function keyOf(projectId: string, relPath: string): string {
  return `${projectId}\0${relPath}`
}

/** すでに開いていれば、最新の内容で描き直して前面に出す。 */
export function openPrintPreviewWindow(projectId: string, relPath: string): void {
  const key = keyOf(projectId, relPath)
  const existing = windowsByKey.get(key)
  if (existing && !existing.win.isDestroyed()) {
    existing.win.webContents.reload()
    existing.win.focus()
    return
  }

  const win = createSecureWindow({ width: 900, height: 1000, title: relPath.split('/').pop() ?? relPath })
  windowsByKey.set(key, { projectId, win })
  win.once('closed', () => {
    if (windowsByKey.get(key)?.win === win) windowsByKey.delete(key)
  })

  const query = `projectId=${encodeURIComponent(projectId)}&relPath=${encodeURIComponent(relPath)}`
  void win.loadURL(rendererPageUrl('print-preview.html', query))
}

/** プロジェクトのウィンドウを閉じたら、そのプロジェクトの印刷用表示も閉じる。 */
export function closePrintPreviewWindows(projectId: string): void {
  for (const entry of windowsByKey.values()) {
    if (entry.projectId === projectId && !entry.win.isDestroyed()) entry.win.close()
  }
}
