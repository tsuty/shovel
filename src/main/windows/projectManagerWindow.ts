import { createSecureWindow } from './createSecureWindow'
import { rendererPageUrl } from './rendererProtocol'
import { getProjectManagerWindow, setProjectManagerWindow } from './registry'
import { refreshLatestAcpVersions } from '../domain/acpVersionService'

export function openProjectManagerWindow(): void {
  const existing = getProjectManagerWindow()
  if (existing) {
    existing.focus()
    return
  }

  const win = createSecureWindow({ width: 760, height: 560, title: 'shovel' })
  setProjectManagerWindow(win)
  // ACP アダプタの最新版を控えておく。
  void refreshLatestAcpVersions()

  void win.loadURL(rendererPageUrl('project-manager.html'))
}
