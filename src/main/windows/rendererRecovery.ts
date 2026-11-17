import { app, BrowserWindow, dialog, powerMonitor } from 'electron'
import { logAppEvent } from '../log'
import { resolveLocale } from '../locale'
import { isQuitting } from './registry'

const labels = {
  en: {
    hungMessage: 'This window is not responding.',
    hungDetail:
      'You can keep waiting, or reload the window. Reloading reopens the tabs; chats are reopened from history.',
    crashMessage: 'This window keeps crashing.',
    crashDetail: 'It crashed several times in a short time. Reload it again, or close it.',
    wait: 'Wait',
    reload: 'Reload',
    close: 'Close'
  },
  ja: {
    hungMessage: 'このウィンドウが応答していません。',
    hungDetail: 'このまま待つか、ウィンドウを再読み込みできます。再読み込みするとタブを開き直し、チャットは履歴から開き直します。',
    crashMessage: 'このウィンドウが繰り返し異常終了しています。',
    crashDetail: '短い間に何度も異常終了しました。もう一度再読み込みするか、ウィンドウを閉じてください。',
    wait: '待つ',
    reload: '再読み込み',
    close: '閉じる'
  }
}

/** この時間内に `CRASH_LIMIT` 回異常終了したら、自動の再読み込みをやめて確認する。 */
const CRASH_WINDOW_MS = 60_000
const CRASH_LIMIT = 3

/**
 * レンダラが落ちた・応答しなくなったときに、真っ白のまま放置されないようにする。
 * - 落ちたら（`render-process-gone`）記録して再読み込みする。短時間に繰り返すときは確認する。
 * - 応答しなくなったら（`unresponsive`）記録して「待つ / 再読み込み」を尋ねる。応答が戻れば問いを閉じる。
 * `beforeReload` は再読み込みの直前に呼ぶ（そのウィンドウのセッションを閉じるなど）。
 */
export function installRendererRecovery(win: BrowserWindow, name: string, beforeReload?: () => void): void {
  const webContents = win.webContents
  const crashTimes: number[] = []
  let hungPrompt: AbortController | null = null

  function reload(): void {
    if (win.isDestroyed()) return
    try {
      beforeReload?.()
    } catch (err) {
      logAppEvent(`${name}: cleanup before reload failed: ${String(err)}`)
    }
    webContents.reload()
  }

  webContents.on('render-process-gone', (_event, details) => {
    hungPrompt?.abort()
    hungPrompt = null
    logAppEvent(`${name}: renderer gone (reason=${details.reason}, exitCode=${details.exitCode})`)
    if (win.isDestroyed() || isQuitting()) return

    const now = Date.now()
    crashTimes.push(now)
    while (crashTimes.length > 0 && now - crashTimes[0]! > CRASH_WINDOW_MS) crashTimes.shift()
    if (crashTimes.length < CRASH_LIMIT) {
      reload()
      return
    }
    crashTimes.length = 0
    const t = labels[resolveLocale()]
    void dialog
      .showMessageBox(win, {
        type: 'error',
        message: t.crashMessage,
        detail: t.crashDetail,
        buttons: [t.reload, t.close],
        defaultId: 0,
        cancelId: 1
      })
      .then(({ response }) => {
        if (win.isDestroyed()) return
        if (response === 0) reload()
        else win.close()
      })
  })

  webContents.on('unresponsive', () => {
    logAppEvent(`${name}: renderer unresponsive`)
    if (hungPrompt || win.isDestroyed() || isQuitting()) return
    const controller = new AbortController()
    hungPrompt = controller
    const t = labels[resolveLocale()]
    void dialog
      .showMessageBox(win, {
        type: 'warning',
        message: t.hungMessage,
        detail: t.hungDetail,
        buttons: [t.wait, t.reload],
        defaultId: 0,
        cancelId: 0,
        signal: controller.signal
      })
      .then(({ response }) => {
        if (hungPrompt === controller) hungPrompt = null
        if (controller.signal.aborted || win.isDestroyed()) return
        if (response !== 1) return
        logAppEvent(`${name}: reloading unresponsive renderer`)
        // 固まったレンダラは再読み込みの要求にも応えないので、先に落とす（落ちた後の再読み込みは上の処理が行う）。
        webContents.forcefullyCrashRenderer()
      })
      .catch(() => {
        if (hungPrompt === controller) hungPrompt = null
      })
  })

  webContents.on('responsive', () => {
    logAppEvent(`${name}: renderer responsive again`)
    hungPrompt?.abort()
    hungPrompt = null
  })
}

/**
 * アプリ全体の監視。GPU などの子プロセスの終了とスリープ・復帰を `app.log` に残し、
 * 復帰時は全ウィンドウの描き直しを要求する。`app.whenReady()` の後に呼ぶ。
 */
export function installAppHealthMonitor(): void {
  app.on('child-process-gone', (_event, details) => {
    logAppEvent(
      `child process gone (type=${details.type}, reason=${details.reason}, exitCode=${details.exitCode}` +
        `${details.name ? `, name=${details.name}` : ''})`
    )
  })

  const repaintAll = (): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.invalidate()
    }
  }
  powerMonitor.on('suspend', () => logAppEvent('system suspend'))
  powerMonitor.on('resume', () => {
    logAppEvent('system resume')
    repaintAll()
  })
  powerMonitor.on('unlock-screen', () => {
    logAppEvent('screen unlocked')
    repaintAll()
  })
}
