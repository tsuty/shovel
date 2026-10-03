import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import { settingsStore } from '../persistence/store'
import { openProjectManagerWindow } from './projectManagerWindow'

const labels = {
  en: { openProjectManager: 'Open Project Manager' },
  ja: { openProjectManager: 'プロジェクトマネージャを開く' }
} as const

/**
 * macOS のアプリメニューを組み立てる。既定のメニューに「プロジェクトマネージャを開く」を足したもの。
 * 他の OS は既定のメニューのまま（最後のウィンドウを閉じるとアプリが終わるので、メニューから開く必要が無い）。
 * 言語設定が変わったら呼び直す。
 */
export function installAppMenu(): void {
  if (process.platform !== 'darwin') return
  const t = labels[resolveLocale()]
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: t.openProjectManager,
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => openProjectManagerWindow()
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** renderer と同じく、設定が無ければ OS の言語から決める。 */
function resolveLocale(): 'en' | 'ja' {
  const locale = settingsStore.get().locale
  if (locale) return locale
  return app.getLocale().toLowerCase().startsWith('ja') ? 'ja' : 'en'
}
