import { app, BrowserWindow, clipboard, Menu, session, type MenuItemConstructorOptions, type WebContents } from 'electron'
import { IpcChannel } from '@shared/ipc'
import { BLANK_PAGE, isWebUrl } from '@shared/browserUrl'
import { resolveLocale } from '../locale'
import { editMenuTemplate } from './editContextMenu'
import { openExternalIfSafe } from './createSecureWindow'

/** ブラウザのタブの保存領域（Cookie・ログイン状態）。全プロジェクトで共通にし、再起動しても残す。 */
export const BROWSER_PARTITION = 'persist:shovel-browser'

const labels = {
  en: {
    back: 'Back',
    forward: 'Forward',
    reload: 'Reload',
    openInNewTab: 'Open link in new tab',
    copyLink: 'Copy link',
    openExternal: 'Open link in external browser',
    copy: 'Copy'
  },
  ja: {
    back: '戻る',
    forward: '進む',
    reload: '再読み込み',
    openInNewTab: 'リンクを新しいタブで開く',
    copyLink: 'リンクをコピー',
    openExternal: 'リンクを外部のブラウザで開く',
    copy: 'コピー'
  }
} as const

/**
 * ブラウザのタブ（`<webview>`）の中身の設定を強制する。renderer が何を指定しても、preload なし・Node なし・
 * sandbox・専用の保存領域にし、`http:` / `https:` 以外のページは開かない。権限の要求はすべて断る。
 */
export function installBrowserGuestPolicy(): void {
  const browserSession = session.fromPartition(BROWSER_PARTITION)
  browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  browserSession.setPermissionCheckHandler(() => false)

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event, webPreferences, params) => {
      delete webPreferences.preload
      webPreferences.nodeIntegration = false
      webPreferences.nodeIntegrationInSubFrames = false
      webPreferences.contextIsolation = true
      webPreferences.sandbox = true
      webPreferences.webSecurity = true
      webPreferences.allowRunningInsecureContent = false
      webPreferences.partition = BROWSER_PARTITION
      if (params.src && params.src !== BLANK_PAGE && !isWebUrl(params.src)) event.preventDefault()
    })
    if (contents.getType() === 'webview') setupGuest(contents)
  })
}

function setupGuest(contents: WebContents): void {
  /** ページから新しいタブで開く URL を、そのタブのあるウィンドウへ渡す。`mailto:` などは OS へ。 */
  const openInNewTab = (url: string): void => {
    if (isWebUrl(url)) contents.hostWebContents?.send(IpcChannel.BrowserOpenUrl, url)
    else openExternalIfSafe(url)
  }

  contents.setWindowOpenHandler(({ url }) => {
    openInNewTab(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => {
    if (isWebUrl(url)) return
    event.preventDefault()
    openExternalIfSafe(url)
  })
  contents.on('will-redirect', (event, url) => {
    if (!isWebUrl(url)) event.preventDefault()
  })

  // ページを押してもホストのウィンドウにはイベントが来ないので、押したこと・フォーカスが移ったことを知らせる
  // （OS のウィンドウにフォーカスが無いときは `focus` が来ないので、押したことも拾う）。
  const notifyFocused = (): void => contents.hostWebContents?.send(IpcChannel.BrowserFocused, contents.id)
  contents.on('focus', notifyFocused)
  contents.on('before-mouse-event', (_event, mouse) => {
    if (mouse.type === 'mouseDown') notifyFocused()
  })

  // ページにフォーカスがあるときのキーはホストのウィンドウに届かないので、Cmd/Ctrl+F だけ拾って渡す。
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const modifier = process.platform === 'darwin' ? input.meta : input.control
    if (!modifier || input.alt || input.shift || input.key.toLowerCase() !== 'f') return
    event.preventDefault()
    contents.hostWebContents?.send(IpcChannel.BrowserFindRequested, contents.id)
  })

  contents.on('context-menu', (_event, params) => {
    const host = contents.hostWebContents
    const window = host ? BrowserWindow.fromWebContents(host) ?? undefined : undefined
    if (params.isEditable) {
      Menu.buildFromTemplate(editMenuTemplate(contents, params)).popup({ window })
      return
    }
    const t = labels[resolveLocale()]
    const history = contents.navigationHistory
    const template: MenuItemConstructorOptions[] = [
      { label: t.back, enabled: history.canGoBack(), click: () => history.goBack() },
      { label: t.forward, enabled: history.canGoForward(), click: () => history.goForward() },
      { label: t.reload, click: () => contents.reload() }
    ]
    if (params.linkURL && isWebUrl(params.linkURL)) {
      const link = params.linkURL
      template.push(
        { type: 'separator' },
        { label: t.openInNewTab, click: () => openInNewTab(link) },
        { label: t.copyLink, click: () => void clipboard.writeText(link) },
        { label: t.openExternal, click: () => openExternalIfSafe(link) }
      )
    }
    if (params.selectionText) {
      template.push({ type: 'separator' }, { label: t.copy, click: () => contents.copy() })
    }
    Menu.buildFromTemplate(template).popup({ window })
  })
}
