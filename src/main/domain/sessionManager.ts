import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import { getAgentEntry } from '@shared/agentTable'
import type { SessionMeta } from '@shared/types/session'
import type { TranscriptAction, TranscriptEvent } from '@shared/types/transcript'
import { IpcChannel, type SessionEnvelope } from '@shared/ipc'
import { openAcpSession, type OpenedSession } from '../acp/connection'
import { projectsStore } from '../persistence/store'

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

export async function openTab(
  projectId: string,
  webContents: WebContents
): Promise<{ sessionId: string; meta: SessionMeta }> {
  if (tabCountForWindow(webContents) >= MAX_TABS_PER_WINDOW) {
    throw new Error('タブは最大10個までです。')
  }
  const project = projectsStore.list().find((p) => p.id === projectId)
  if (!project) throw new Error(`project not found: ${projectId}`)
  const agent = getAgentEntry(project.agentId)
  if (!agent) throw new Error(`unknown agent: ${project.agentId}`)

  const sessionId = randomUUID()
  const opened = await openAcpSession(sessionId, project, agent, {
    onEvent: (event) => sendEnvelope(sessionId, event),
    onMetaChanged: () => {},
    onFatalError: (message) => sendEnvelope(sessionId, { type: 'toast', text: message })
  })
  tabs.set(sessionId, { projectId, webContents, opened })

  webContents.once('destroyed', () => {
    closeTab(sessionId)
  })

  return { sessionId, meta: opened.meta }
}

export function closeTab(sessionId: string): void {
  const tab = tabs.get(sessionId)
  if (!tab) return
  tabs.delete(sessionId)
  tab.opened.close()
}

export async function refreshTab(sessionId: string): Promise<void> {
  const tab = requireTab(sessionId)
  sendEnvelope(sessionId, { type: 'reset', sessionId })
  const meta = tab.opened.meta
  sendEnvelope(sessionId, {
    type: 'sessionMeta',
    modes: meta.modes,
    currentModeId: meta.currentModeId,
    configOptions: meta.configOptions
  })
}

export async function promptSession(sessionId: string, text: string): Promise<void> {
  await requireTab(sessionId).opened.prompt(text)
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
      return
    case 'openUrl':
    case 'openFile':
    case 'openDiff':
    case 'openAttachment':
    case 'copyBlock':
    case 'copyText':
    case 'submitChoices':
      // ファイラー・エディタ・クリップボード連携は後続フェーズで実装する。
      // 現段階では黙って無視する（トランスクリプトの表示・対話・承認・
      // Mode/Model 切り替えまでが今回のスコープ）。
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
