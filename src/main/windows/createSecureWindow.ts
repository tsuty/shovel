import { BrowserWindow, shell } from 'electron'
import path from 'node:path'

/**
 * すべての `BrowserWindow` に共通のセキュリティ設定。architecture.md §2:
 * `contextIsolation: true` / `nodeIntegration: false`、`will-navigate` と
 * `setWindowOpenHandler` を塞ぎリンクは外部ブラウザへ。
 */
export function createSecureWindow(options: {
  width: number
  height: number
  title: string
}): BrowserWindow {
  const win = new BrowserWindow({
    width: options.width,
    height: options.height,
    title: options.title,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!isDevServerUrl(url)) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })

  win.once('ready-to-show', () => win.show())

  return win
}

function isDevServerUrl(url: string): boolean {
  return url.startsWith('http://localhost:') || url.startsWith('file://')
}
