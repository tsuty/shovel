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
 * 1タブ = 1 ACP セッションのランタイム状態をプロジェクト横断で保持する。
 * architecture.md §5「main は sessionId → webContents のマップを持ち、
 * イベントを sessionId でルーティングする」の実装。
 */
const tabs = new Map<string, { projectId: string; webContents: WebContents; opened: OpenedSession }>()

/**
 * 接続を開いている最中（`openAcpSession` が返る前）に出たイベントの一時置き場。
 * 復元時はローカル記録の描き起こしや `session/load` のライブ replay がこの
 * 段階で流れるが、まだ `tabs` に登録されていないので `sendEnvelope` が
 * 送り先を知らない。開けたらまとめて送り、失敗したら捨てる（開けなかった
 * タブのイベントを renderer に残さない）。
 */
const pendingEvents = new Map<string, TranscriptEvent[]>()

/** ウィンドウ（webContents）ごとに開いているタブ数。G-1-3b: 最大10。 */
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
 * flows.md §6 / decisions.md C-1/C-2: 過去のセッションを「読むだけ」ではなく
 * 本当に再開する。エージェント側の id をスナップショットから取り出し、
 * `session/load` か `session/resume` で文脈ごと繋ぎ直す。
 *
 * 書き込み先には元のスナップショットの id をそのまま使う（`RestoreRequest.snapshotId`）。
 * スナップショットのファイル名も、`sessionTitleStore` の名前の上書きも
 * この id に紐づいているため、新しい id を振ると同じ会話が履歴に二重に並ぶ。
 * タブ id も原則は同じ id にするが、↻ で別の会話に移ったタブがまだその id を
 * 使っている場合は、衝突を避けて新しい UUID を振る。
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
  // エージェント側の id が無いのは shovel がそれを保存する前に作られた
  // 古いスナップショット。再開の手がかりが無いので「非対応」と同じ扱いにする。
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
 * decisions.md C-1/C-2 補遺: 「エージェントのみ」の行（ローカル記録が無い）の
 * 「再開」。復元戦略表の「無し／空」の行に当たる（`load` ならライブ replay を
 * 描き、完了後に最初のスナップショットとして保存する）。書き込み先の
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
 * decisions.md C-1/C-2 補遺: 履歴一覧を `session/list` とローカル記録の和集合
 * として作る。今タブで開いているセッション（書き込み中のスナップショット・
 * 接続中の ACP セッション）と、ソフトデリート済み（`.deleted` の
 * `acpSessionId`）は一覧から除く。`session/list` を取得できなければ、ローカル
 * 記録だけを状態 `unknown` で返す。
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

/**
 * flows.md §6「名前変更」: ACP に session/rename が無いため、ローカルに上書きを保存する。
 * 引数はタブ id ではなくスナップショット id（開いているタブなら `snapshotId`）。
 */
export async function renameSession(projectId: string, sessionId: string, title: string): Promise<void> {
  sessionTitleStore.set(sessionId, title)
  await renameSnapshotTitle(projectId, sessionId, title)
}

/**
 * flows.md §6「削除」/ decisions.md C-5（追記を含む）:
 *   1. 同じプロジェクトにライブタブがあり、エージェントが `delete` に対応して
 *      いれば、その接続を借りて `session/delete` を送る（失敗しても続行）。
 *   2. ローカル記録は即座に消さず `.deleted` へ退避する（バックアップも一緒に）。
 *      送れなかった場合も、`.deleted` の `acpSessionId` が目印になって一覧から
 *      外れる（`listHistory`）。
 * 「エージェントのみ」の行（`snapshotId` が無い）は退避するファイルが無いので、
 * `session/delete` を送れないときは失敗にする（renderer は削除メニューを無効に
 * している）。
 *
 * 名前の上書きは残しておく — 削除済みを Read Only タブで開いたときに、
 * 利用者が付けた名前で見られるように。
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

/**
 * 履歴一覧を取り直す契機を renderer に知らせる（バックアップの作成、
 * ターンの保存）。
 */
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
