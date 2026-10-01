import { createSecureWindow } from './createSecureWindow'
import { rendererPageUrl } from './rendererProtocol'
import { getProjectManagerWindow, setProjectManagerWindow } from './registry'

export function openProjectManagerWindow(): void {
  const existing = getProjectManagerWindow()
  if (existing) {
    existing.focus()
    return
  }

  const win = createSecureWindow({ width: 760, height: 560, title: 'shovel' })
  setProjectManagerWindow(win)

  void win.loadURL(rendererPageUrl('project-manager.html'))
}
