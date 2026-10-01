import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import { getAgentEntry } from '@shared/agentTable'
import type { HistoryEntry, HistoryListing, SessionMeta } from '@shared/types/session'
import type { TranscriptAction, TranscriptEvent } from '@shared/types/transcript'
import { IpcChannel, type SessionEnvelope } from '@shared/ipc'
import { openAcpSession, type AgentSessionInfo, type OpenedSession, type RestoreRequest } from '../acp/connection'
import { projectsStore, sessionTitleStore } from '../persistence/store'
import {
  listSnapshotsForProject,
  loadSnapshot,
  readRecordsForProject,
  renameSnapshotTitle,
  softDeleteSnapshot
} from '../persistence/snapshot'
import { RESTORE_UNSUPPORTED_MARKER } from '@shared/restoreMarker'

/**
 * 1タブ = 1 ACP セッションのランタイム状態をプロジェクト横断で保持し、
 * イベントを sessionId で webContents へルーティングする。
 */
const tabs = new Map<string, { projectId: string; webContents: WebContents; opened: OpenedSession }>()

/** `openAcpSession` が返る前に出たイベントの一時置き場。開けたらまとめて送り、失敗したら捨てる。 */
const pendingEvents = new Map<string, TranscriptEvent[]>()

/** ウィンドウ（webContents）ごとに開いているタブ数。 */
function tabCountForWindow(webContents: WebContents): number {
  let count = 0
  for (const tab of tabs.values()) {
    if (tab.webContents === webContents) count++
  }
  return count
}

const MAX_TABS_PER_WINDOW = 10

export type OpenedTab = { sessionId: string; snapshotId: string; meta: SessionMeta }

async function startTab(
  projectId: string,
  webContents: WebContents,
  sessionId: string,
  restore?: RestoreRequest
): Promise<OpenedTab> {
  if (tabCountForWindow(webContents) >= MAX_TABS_PER_WINDOW) {
    throw new Error('タブは最大10個までです。')
  }
  const project = projectsStore.list().find((p) => p.id === projectId)
  if (!project) throw new Error(`project not found: ${projectId}`)
  const agent = getAgentEntry(project.agentId)
  if (!agent) throw new Error(`unknown agent: ${project.agentId}`)

  pendingEvents.set(sessionId, [])
  let opened: OpenedSession
  try {
    opened = await openAcpSession(
      sessionId,
      project,
      agent,
      {
        onEvent: (event) => sendEnvelope(sessionId, event),
        onMetaChanged: () => {},
        onFatalError: (message) => sendEnvelope(sessionId, { type: 'toast', text: message }),
        onLocalRecordsChanged: () => notifyHistoryChanged(webContents, projectId),
        onTurnSaved: () => notifyHistoryChanged(webContents, projectId)
      },
      restore
    )
  } catch (err) {
    pendingEvents.delete(sessionId)
    throw err
  }
  tabs.set(sessionId, { projectId, webContents, opened })
  const buffered = pendingEvents.get(sessionId) ?? []
  pendingEvents.delete(sessionId)
  for (const event of buffered) sendEnvelope(sessionId, event)

  webContents.once('destroyed', () => {
    closeTab(sessionId)
  })

  return { sessionId, snapshotId: opened.snapshotId, meta: opened.meta }
}

export async function openTab(projectId: string, webContents: WebContents): Promise<OpenedTab> {
  return startTab(projectId, webContents, randomUUID())
}

/**
 * スナップショットからエージェント側の id を取り出し、`session/load` か `session/resume` で
 * 過去のセッションを再開する。書き込み先は元のスナップショットの id。タブ id も同じ id にするが、
 * 既にライブタブが使っていれば新しい UUID を振る。
 */
export async function resumeTab(
  projectId: string,
  snapshotSessionId: string,
  webContents: WebContents
): Promise<OpenedTab> {
  for (const tab of tabs.values()) {
    if (tab.opened.snapshotId === snapshotSessionId) throw new Error('このセッションはすでに開いています。')
  }
  const snapshot = await loadSnapshot(projectId, snapshotSessionId)
  // エージェント側の id が無ければ再開できないので「非対応」として扱う。
  if (!snapshot?.acpSessionId) throw new Error(RESTORE_UNSUPPORTED_MARKER)
  requireNotOpen(snapshot.acpSessionId)

  const tabId = tabs.has(snapshot.sessionId) || pendingEvents.has(snapshot.sessionId) ? randomUUID() : snapshot.sessionId
  return startTab(projectId, webContents, tabId, {
    snapshotId: snapshot.sessionId,
    acpSessionId: snapshot.acpSessionId,
    entries: snapshot.entries,
    title: snapshot.title
  })
}

/**
 * ローカル記録が無い「エージェントのみ」のセッションを再開する。
 * スナップショット id とタブ id は新しく振る。
 */
export async function resumeAgentSession(
  projectId: string,
  acpSessionId: string,
  title: string | undefined,
  webContents: WebContents
): Promise<OpenedTab> {
  requireNotOpen(acpSessionId)
  const id = randomUUID()
  return startTab(projectId, webContents, id, { snapshotId: id, acpSessionId, entries: [], title })
}

function requireNotOpen(acpSessionId: string): void {
  for (const tab of tabs.values()) {
    if (tab.opened.acpSessionId === acpSessionId) throw new Error('このセッションはすでに開いています。')
  }
}

/** `session/list` や `session/delete` を送るために借りる、プロジェクトのライブタブ。 */
function liveTabFor(projectId: string): OpenedSession | null {
  for (const tab of tabs.values()) {
    if (tab.projectId === projectId && !tab.webContents.isDestroyed()) return tab.opened
  }
  return null
}

/**
 * `session/list` とローカル記録の和集合として履歴一覧を作る。開いているセッションと
 * ソフトデリート済み（`.deleted` の `acpSessionId`）は除く。`session/list` を取得できなければ、
 * ローカル記録だけを状態 `unknown` で返す。
 */
export async function listHistory(projectId: string): Promise<HistoryListing> {
  const openSnapshotIds = new Set<string>()
  const openAcpIds = new Set<string>()
  for (const tab of tabs.values()) {
    if (tab.projectId !== projectId) continue
    openSnapshotIds.add(tab.opened.snapshotId)
    if (tab.opened.acpSessionId) openAcpIds.add(tab.opened.acpSessionId)
  }

  const live = liveTabFor(projectId)
  let agentSessions: AgentSessionInfo[] | null = null
  if (live?.capabilities.list) {
    try {
      agentSessions = await live.listAgentSessions()
    } catch (err) {
      console.info('[acp] session/list failed; history falls back to local records', err)
    }
  }

  const deletedAcpIds = new Set<string>()
  for (const { snapshot } of await readRecordsForProject(projectId, () => true, new Set(['deleted']))) {
    if (snapshot.acpSessionId) deletedAcpIds.add(snapshot.acpSessionId)
  }
  const agentById = new Map((agentSessions ?? []).map((info) => [info.acpSessionId, info]))

  const entries: HistoryEntry[] = []
  const coveredAcpIds = new Set<string>()
  for (const snapshot of await listSnapshotsForProject(projectId)) {
    if (openSnapshotIds.has(snapshot.sessionId)) continue
    const agent = snapshot.acpSessionId ? agentById.get(snapshot.acpSessionId) : undefined
    if (snapshot.acpSessionId) coveredAcpIds.add(snapshot.acpSessionId)
    entries.push({
      key: snapshot.sessionId,
      snapshotId: snapshot.sessionId,
      acpSessionId: snapshot.acpSessionId,
      title: sessionTitleStore.get(snapshot.sessionId) ?? snapshot.title ?? agent?.title ?? '',
      updatedAt: Math.max(snapshot.savedAt, agent?.updatedAt ?? 0),
      state: agentSessions === null ? 'unknown' : agent ? 'both' : 'localOnly'
    })
  }
  for (const info of agentSessions ?? []) {
    const id = info.acpSessionId
    if (coveredAcpIds.has(id) || openAcpIds.has(id) || deletedAcpIds.has(id)) continue
    entries.push({
      key: `acp:${id}`,
      acpSessionId: id,
      title: info.title ?? '',
      updatedAt: info.updatedAt ?? 0,
      state: 'agentOnly'
    })
  }
  entries.sort((a, b) => b.updatedAt - a.updatedAt)
  return { entries, canDeleteAgentSessions: live?.capabilities.delete ?? false }
}

export function closeTab(sessionId: string): void {
  const tab = tabs.get(sessionId)
  if (!tab) return
  tabs.delete(sessionId)
  tab.opened.close()
}

/** ↻。新しい会話の書き込み先になるスナップショット id を返す。 */
export async function refreshTab(sessionId: string): Promise<string> {
  return requireTab(sessionId).opened.refresh()
}

/** セッション名の上書きをローカルに保存する。引数はスナップショット id。 */
export async function renameSession(projectId: string, sessionId: string, title: string): Promise<void> {
  sessionTitleStore.set(sessionId, title)
  await renameSnapshotTitle(projectId, sessionId, title)
}

/**
 * セッションを削除する。
 *   1. ライブタブがあり、エージェントが `delete` に対応していれば `session/delete` を送る（失敗しても続行）。
 *   2. ローカル記録はバックアップと一緒に `.deleted` へ退避する。
 * `snapshotId` が無く `session/delete` も送れない場合は失敗にする。名前の上書きは残す。
 */
export async function deleteHistorySession(
  projectId: string,
  target: { snapshotId?: string; acpSessionId?: string }
): Promise<void> {
  const live = liveTabFor(projectId)
  let deletedOnAgent = false
  if (target.acpSessionId && live?.capabilities.delete) {
    try {
      await live.deleteAgentSession(target.acpSessionId)
      deletedOnAgent = true
    } catch (err) {
      console.info(`[acp] session/delete failed for ${target.acpSessionId}; continuing with local deletion`, err)
    }
  }
  if (target.snapshotId) {
    await softDeleteSnapshot(projectId, target.snapshotId)
  } else if (!deletedOnAgent) {
    throw new Error('このセッションはエージェント側にしか無く、いまは削除できません。')
  }
}

/** 履歴一覧を取り直すよう renderer に知らせる。 */
function notifyHistoryChanged(webContents: WebContents, projectId: string): void {
  if (!webContents.isDestroyed()) webContents.send(IpcChannel.SessionLocalRecordsChanged, projectId)
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
      // 何もしない。
      return
    case 'openUrl':
    case 'openFile':
    case 'openDiff':
    case 'openAttachment':
    case 'copyBlock':
    case 'copyText':
    case 'submitChoices':
      // renderer 側で処理されるため main には届かない。
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
  const pending = pendingEvents.get(sessionId)
  if (pending) {
    pending.push(event)
    return
  }
  const tab = tabs.get(sessionId)
  if (!tab || tab.webContents.isDestroyed()) return
  const envelope: SessionEnvelope = { sessionId, event }
  tab.webContents.send(IpcChannel.TranscriptEvent, envelope)
}
