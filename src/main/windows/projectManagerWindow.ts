import path from 'node:path'
import { createSecureWindow } from './createSecureWindow'
import { getProjectManagerWindow, setProjectManagerWindow } from './registry'

export function openProjectManagerWindow(): void {
  const existing = getProjectManagerWindow()
  if (existing) {
    existing.focus()
    return
  }

  const win = createSecureWindow({ width: 760, height: 560, title: 'shovel' })
  setProjectManagerWindow(win)

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) {
    void win.loadURL(`${rendererUrl}/project-manager.html`)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/project-manager.html'))
  }
}
