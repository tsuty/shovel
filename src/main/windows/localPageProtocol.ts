import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, dialog, shell, webContents, type CustomScheme, type Session, type WebContents } from 'electron'
import { IpcChannel } from '@shared/ipc'
import { LOCAL_PAGE_SCHEME, parseLocalPageUrl } from '@shared/browserUrl'
import { projectsStore } from '../persistence/store'
import { projectIdOfWindow } from './registry'
import { resolveLocale } from '../locale'

const labels = {
  en: {
    message: 'Open this page in your external browser?',
    detail:
      'This file may have been written by the AI. In your external browser it runs without shovel\'s limits: it can connect to external sites, and it is opened as a file (file:).',
    open: 'Open',
    cancel: 'Cancel'
  },
  ja: {
    message: 'このページを外部のブラウザで開きますか？',
    detail:
      'このファイルは AI が書いたものかもしれません。外部のブラウザでは shovel の制限なしで動きます（外部への接続も遮断されず、ファイル（file:）として開かれます）。',
    open: '開く',
    cancel: 'キャンセル'
  }
} as const

/**
 * プロジェクトのフォルダ内のファイルを、ブラウザのタブへ `shovel-file://<projectId>/<relPath>` で配信する。
 * 配信するのはそのプロジェクトのフォルダの中（シンボリックリンクの先も含めて）だけで、
 * 要求できるのはそのプロジェクトのウィンドウの、同じプロジェクトのページだけ。
 */

/** `registerSchemesAsPrivileged` に渡す設定。ES モジュール・`fetch`・動画の読み込みに要る。 */
export const LOCAL_PAGE_SCHEME_PRIVILEGES: CustomScheme = {
  scheme: LOCAL_PAGE_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
}

const MIME_BY_EXT: Record<string, string> = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.xhtml': 'application/xhtml+xml',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
  '.md': 'text/plain',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg'
}

/** 同じページ（プロジェクト）からの読み込みと、インラインのスクリプト・スタイル、`data:` / `blob:` だけを許す。 */
const SELF_SOURCES = "'self' 'unsafe-inline' 'unsafe-eval' data: blob:"
const CSP_BLOCK_NETWORK = `default-src ${SELF_SOURCES}; form-action 'self'`
const CSP_ALLOW_NETWORK = `default-src ${SELF_SOURCES} http: https: ws: wss:; form-action 'self' http: https:`

/** 外部への接続を許したプロジェクト。アプリを終えると忘れる（既定は遮断）。 */
const networkAllowed = new Set<string>()

/** プロジェクトのページから外部への接続を許しているか。 */
export function isLocalPageNetworkAllowed(projectId: string): boolean {
  return networkAllowed.has(projectId)
}

/** プロジェクトのページから外部への接続を許すかを切り替え、全ウィンドウに知らせる。 */
export function setLocalPageNetworkAllowed(projectId: unknown, allowed: unknown): void {
  if (typeof projectId !== 'string' || typeof allowed !== 'boolean') return
  if (allowed) networkAllowed.add(projectId)
  else networkAllowed.delete(projectId)
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannel.BrowserLocalPageNetworkChanged, projectId, allowed)
  }
}

/** `url` と同じプロジェクトのページの origin。 */
function originOf(projectId: string): string {
  return `${LOCAL_PAGE_SCHEME}://${projectId}`
}

/** 2つの URL が同じプロジェクトのページなら true。 */
export function isSameLocalPage(a: string, b: string): boolean {
  const pa = parseLocalPageUrl(a)
  const pb = parseLocalPageUrl(b)
  return !!pa && !!pb && pa.projectId === pb.projectId
}

/** ブラウザの保存領域に `shovel-file:` の配信と、要求元の確認を入れる。 */
export function installLocalPageProtocol(browserSession: Session): void {
  browserSession.protocol.handle(LOCAL_PAGE_SCHEME, async (request) => {
    const parsed = parseLocalPageUrl(request.url)
    const project = parsed ? projectsStore.find(parsed.projectId) : undefined
    if (!parsed || !project) return notFound()
    const filePath = await resolveLocalFile(project.hostPath, parsed.relPath)
    if (!filePath) return notFound()
    try {
      const body = await readFile(filePath)
      return new Response(body, {
        headers: {
          'Content-Type': MIME_BY_EXT[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
          'Content-Security-Policy': isLocalPageNetworkAllowed(parsed.projectId) ? CSP_ALLOW_NETWORK : CSP_BLOCK_NETWORK,
          'Cache-Control': 'no-store'
        }
      })
    } catch {
      return notFound()
    }
  })

  browserSession.webRequest.onBeforeRequest({ urls: [`${LOCAL_PAGE_SCHEME}://*/*`] }, (details, callback) => {
    callback({ cancel: !isAllowedRequest(details) })
  })
}

/**
 * プロジェクト内の HTML のページを、確認のダイアログを出してから外部のブラウザ（OS の既定のアプリ）で開く。
 * 開くのは `sender` のウィンドウのプロジェクトのフォルダ内の `.html` / `.htm` だけ。
 */
export async function openLocalPageExternally(sender: WebContents, url: string): Promise<void> {
  const parsed = parseLocalPageUrl(url)
  const window = BrowserWindow.fromWebContents(sender)
  if (!parsed || !window || projectIdOfWindow(window) !== parsed.projectId) return
  const project = projectsStore.find(parsed.projectId)
  const filePath = project ? await resolveLocalFile(project.hostPath, parsed.relPath) : null
  if (!filePath || !/\.html?$/i.test(filePath)) return
  const t = labels[resolveLocale()]
  const { response } = await dialog.showMessageBox(window, {
    type: 'warning',
    message: t.message,
    detail: `${t.detail}\n\n${path.relative(await realpath(project!.hostPath), filePath)}`,
    buttons: [t.open, t.cancel],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  })
  if (response !== 0) return
  const { search, hash } = new URL(url)
  const fileUrl = pathToFileURL(filePath)
  fileUrl.search = search
  fileUrl.hash = hash
  await shell.openExternal(fileUrl.toString())
}

function notFound(): Response {
  return new Response('404 Not Found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}

/**
 * 要求を通してよいか。そのプロジェクトのウィンドウのブラウザのタブからで、ページ全体の読み込みか、
 * 同じプロジェクトのページからの読み込みだけを通す（Web のページから `<img>`・`<iframe>` で読ませない）。
 */
function isAllowedRequest(details: Electron.OnBeforeRequestListenerDetails): boolean {
  const parsed = parseLocalPageUrl(details.url)
  if (!parsed) return false
  const guest = details.webContents ?? (details.webContentsId ? webContents.fromId(details.webContentsId) : undefined)
  const host = guest?.hostWebContents
  const window = host ? BrowserWindow.fromWebContents(host) : null
  if (!window || projectIdOfWindow(window) !== parsed.projectId) return false
  if (details.resourceType === 'mainFrame') return true
  let requester: string | undefined
  try {
    requester = details.frame?.origin
  } catch {
    requester = undefined
  }
  if (requester === undefined) requester = parseLocalPageUrl(guest!.getURL()) ? new URL(guest!.getURL()).origin : ''
  return requester === originOf(parsed.projectId)
}

/**
 * `root` の中の `relPath` を実際のファイルのパスにする。フォルダなら中の `index.html`。
 * シンボリックリンクをたどった先が `root` の外なら null。
 */
async function resolveLocalFile(root: string, relPath: string): Promise<string | null> {
  try {
    const realRoot = await realpath(root)
    const inside = (p: string): boolean => {
      const rel = path.relative(realRoot, p)
      return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
    }
    const joined = path.join(realRoot, relPath)
    if (!inside(joined)) return null
    let target = await realpath(joined)
    if (!inside(target)) return null
    if ((await stat(target)).isDirectory()) {
      target = await realpath(path.join(target, 'index.html'))
      if (!inside(target)) return null
    }
    return (await stat(target)).isFile() ? target : null
  } catch {
    return null
  }
}
