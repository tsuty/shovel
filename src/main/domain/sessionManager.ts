import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import { getAgentEntry } from '@shared/agentTable'
import type { SessionMeta } from '@shared/types/session'
import type { TranscriptAction, TranscriptEvent } from '@shared/types/transcript'
import { IpcChannel, type SessionEnvelope } from '@shared/ipc'
import { openAcpSession, type OpenedSession, type RestoreRequest } from '../acp/connection'
import { projectsStore, sessionTitleStore } from '../persistence/store'
import { deleteSnapshot, loadSnapshot, renameSnapshotTitle } from '../persistence/snapshot'
import { RESTORE_UNSUPPORTED_MARKER } from '@shared/restoreMarker'

/**
 * 1タブ = 1 ACP セッションのランタイム状態をプロジェクト横断で保持する。
 * architecture.md §5「main は sessionId → webContents のマップを持ち、
 * イベントを sessionId でルーティングする」の実装。
 */
const tabs = new Map<string, { projectId: string; webContents: WebContents; opened: OpenedSession }>()

/** ウィンドウ（webContents）ごとに開いているタブ数。G-1-3b: 最大10。 */
function tabCountForWindow(webContents: WebContents): number {
  let count = 0
  for (const tab of tabs.values()) {
    if (tab.webContents === webContents) count++
  }
  return count
}

const MAX_TABS_PER_WINDOW = 10

async function startTab(
  projectId: string,
  webContents: WebContents,
  sessionId: string,
  restore?: RestoreRequest
): Promise<{ sessionId: string; meta: SessionMeta }> {
  if (tabCountForWindow(webContents) >= MAX_TABS_PER_WINDOW) {
    throw new Error('タブは最大10個までです。')
  }
  const project = projectsStore.list().find((p) => p.id === projectId)
  if (!project) throw new Error(`project not found: ${projectId}`)
  const agent = getAgentEntry(project.agentId)
  if (!agent) throw new Error(`unknown agent: ${project.agentId}`)

  const opened = await openAcpSession(
    sessionId,
    project,
    agent,
    {
      onEvent: (event) => sendEnvelope(sessionId, event),
      onMetaChanged: () => {},
      onFatalError: (message) => sendEnvelope(sessionId, { type: 'toast', text: message })
    },
    restore
  )
  tabs.set(sessionId, { projectId, webContents, opened })

  webContents.once('destroyed', () => {
    closeTab(sessionId)
  })

  return { sessionId, meta: opened.meta }
}

export async function openTab(
  projectId: string,
  webContents: WebContents
): Promise<{ sessionId: string; meta: SessionMeta }> {
  return startTab(projectId, webContents, randomUUID())
}

/**
 * flows.md §6 / decisions.md C-1/C-2: 過去のセッションを「読むだけ」ではなく
 * 本当に再開する。エージェント側の id をスナップショットから取り出し、
 * `session/load` か `session/resume` で文脈ごと繋ぎ直す。
 *
 * タブ id には新しい UUID ではなく元のスナップショットの id をそのまま使う。
 * スナップショットのファイル名も、`sessionTitleStore` の名前の上書きも
 * この id に紐づいているため、新しい id を振ると同じ会話が履歴に二重に並ぶ。
 */
export async function resumeTab(
  projectId: string,
  snapshotSessionId: string,
  webContents: WebContents
): Promise<{ sessionId: string; meta: SessionMeta }> {
  if (tabs.has(snapshotSessionId)) {
    throw new Error('このセッションはすでに開いています。')
  }
  const snapshot = await loadSnapshot(snapshotSessionId)
  // エージェント側の id が無いのは shovel がそれを保存する前に作られた
  // 古いスナップショット。再開の手がかりが無いので「非対応」と同じ扱いにする。
  if (!snapshot?.acpSessionId) throw new Error(RESTORE_UNSUPPORTED_MARKER)

  return startTab(projectId, webContents, snapshot.sessionId, {
    acpSessionId: snapshot.acpSessionId,
    entries: snapshot.entries
  })
}

export function closeTab(sessionId: string): void {
  const tab = tabs.get(sessionId)
  if (!tab) return
  tabs.delete(sessionId)
  tab.opened.close()
}

export async function refreshTab(sessionId: string): Promise<void> {
  await requireTab(sessionId).opened.refresh()
}

/** flows.md §6「名前変更」: ACP に session/rename が無いため、ローカルに上書きを保存する。 */
export async function renameSession(sessionId: string, title: string): Promise<void> {
  sessionTitleStore.set(sessionId, title)
  await renameSnapshotTitle(sessionId, title)
}

/** flows.md §6「削除」: 常にローカルのスナップショットとメタデータを破棄する。 */
export async function deleteHistorySession(sessionId: string): Promise<void> {
  await deleteSnapshot(sessionId)
  sessionTitleStore.remove(sessionId)
}

export async function promptSession(sessionId: string, text: string, attachmentRelPaths?: string[]): Promise<void> {
  await requireTab(sessionId).opened.prompt(text, attachmentRelPaths)
}

export async function cancelSession(sessionId: string): Promise<void> {
  await requireTab(sessionId).opened.cancel()
}

export async function setSessionMode(sessionId: string, modeId: string): Promise<void> {
  await requireTab(sessionId).opened.setMode(modeId)
}

export async function setSessionConfigOption(
  sessionId: string,
  configId: string,
  value: string | boolean
): Promise<void> {
  await requireTab(sessionId).opened.setConfigOption(configId, value)
}

export function dispatchTranscriptAction(action: TranscriptAction): void {
  switch (action.type) {
    case 'permission': {
      const tab = tabs.get(action.sessionId)
      tab?.opened.resolvePermission(action.id, action.optionId)
      return
    }
    case 'ready':
      // SAC（JCEF の別ウェブビュー）は起動レースを避けるためにこのハンドシェイクを
      // 必要とするが、shovel の Transcript は main-window レンダラ内の通常の
      // React コンポーネントであり、同じ理由が存在しない。恒久的に no-op。
      return
    case 'openUrl':
    case 'openFile':
    case 'openDiff':
    case 'openAttachment':
    case 'copyBlock':
    case 'copyText':
    case 'submitChoices':
      // SAC は JCEF の別ウェブビューなので、これら全てをホスト(Kotlin)経由に
      // せざるを得なかった。shovel の Transcript は main-window レンダラ内の
      // 通常の React コンポーネントなので、この境界がそもそも無い:
      // openFile/openAttachment はコールバック props で App.tsx の
      // タブ管理へ、copyBlock/copyText は navigator.clipboard で直接、
      // submitChoices は既存の session.prompt で、openUrl は
      // createSecureWindow.ts の will-navigate/setWindowOpenHandler で、
      // それぞれ main を経由せず renderer 側だけで完結する。ここは今後も
      // 到達しない（TranscriptAction の網羅性のためだけに残す）。
      return
  }
}

export function closeAllTabsForWindow(webContents: WebContents): void {
  for (const [sessionId, tab] of tabs) {
    if (tab.webContents === webContents) closeTab(sessionId)
  }
}

function requireTab(sessionId: string): { projectId: string; webContents: WebContents; opened: OpenedSession } {
  const tab = tabs.get(sessionId)
  if (!tab) throw new Error(`session not found: ${sessionId}`)
  return tab
}

function sendEnvelope(sessionId: string, event: TranscriptEvent): void {
  const tab = tabs.get(sessionId)
  if (!tab || tab.webContents.isDestroyed()) return
  const envelope: SessionEnvelope = { sessionId, event }
  tab.webContents.send(IpcChannel.TranscriptEvent, envelope)
}
