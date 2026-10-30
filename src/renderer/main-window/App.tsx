import { useEffect, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AcpUpdateOffer, ProjectWithStatus } from '@shared/types/project'
import type {
  HistoryEntry,
  LocalRecordSummary,
  RestoredTab,
  SavedSplit,
  SavedTab,
  SessionMeta,
  SessionSnapshot
} from '@shared/types/session'
import { Header } from './components/Header'
import { Sidebar, type SidebarPanel } from './components/Sidebar'
import { TabBar, type TabInfo } from './components/TabBar'
import { SessionView } from './components/SessionView'
import { FileViewer } from './components/FileViewer'
import { TextFileEditor } from './components/TextFileEditor'
import { Commands } from './components/Commands'
import { HistoryView, type ReadOnlyKind } from './components/HistoryView'
import { useSettings } from '../shared/useSettings'
import { SettingsDialog } from '../shared/components/SettingsDialog'
import { AuthDialog } from './components/AuthDialog'
import { AcpUpdateDialog } from './components/AcpUpdateDialog'
import { ProjectDetailDialog } from '../shared/components/ProjectDetailDialog'
import { preloadMermaid } from '../shared/lib/mermaid'
import { isAuthRequiredMessage } from '@shared/authMarker'
import { useTabSwitchShortcuts } from './useTabShortcuts'
import { addAttachmentToSession } from './attachmentRegistry'
import { discardSessionEvents } from './sessionEvents'
import { ResizablePanel } from './components/ResizablePanel'
import { cn } from '../shared/lib/utils'
import { friendlyErrorMessage, needsSbxLogin } from '../shared/friendlyError'
import { editorLanguageFor, type EditorLanguage } from '@shared/fileKinds'
import { ConnectingView, type ConnectingStepRecord } from './components/ConnectingView'
import { FindBar } from './components/FindBar'
import type { FileReveal } from './revealMatch'
import {
  canSplitRight,
  groupOf,
  groupsFromSaved,
  moveTab as moveTabInLayout,
  neighborInGroup,
  normalizeGroups,
  replaceTabId,
  resizeAdjacent,
  savedSplitOf,
  setPaneWeights,
  splitRight,
  unsplit,
  type SplitGroup,
  type SplitLayout
} from './splitGroups'

const MAX_SESSION_TABS = 10
/** 分割ビューのペインの最小幅（px）。チャットはトランスクリプトを読める幅を残す。 */
const PANE_MIN_WIDTH = 240
const CHAT_PANE_MIN_WIDTH = 320
/** コンソール（下部ドロワー）の既定の高さ（px）。 */
const COMMANDS_DEFAULT_HEIGHT = 256

type Tab =
  | {
      kind: 'session'
      sessionId: string
      /** いま書き込んでいるスナップショットの id（↻ で変わる）。 */
      snapshotId: string
      title: string
      meta: SessionMeta
      initialAttachments: string[]
    }
  | {
      /**
       * 接続中の新しいタブ。「+」を押したらすぐ出し、接続できたらその場で `session` に差し替える。
       * `sessionId` は `connecting:<uuid>` の仮の id で、`openTab` の `requestId` にも使う。
       */
      kind: 'connecting'
      sessionId: string
      title: string
      steps: ConnectingStepRecord[]
      /** 失敗したときのエラー（表示用に整えたもの）。 */
      error?: string
      /** 失敗の原因が Docker への未サインインか（`sbx login` へ誘導する）。 */
      needsSbxLogin?: boolean
    }
  | { kind: 'file'; sessionId: string; title: string; relPath: string; editor: EditorLanguage | null }
  | {
      kind: 'history'
      sessionId: string
      title: string
      snapshot: SessionSnapshot
      /** バックアップ／削除済みを開いた Read Only タブ。 */
      readOnlyKind?: ReadOnlyKind
      recordTimestamp?: number
      /** Read Only タブで開いたローカル記録のファイル名。 */
      recordFileName?: string
      /** `session/list` にだけあってローカル記録が無い行。`snapshot` は中身の無い仮のもの。 */
      agentOnly?: boolean
    }

type ChatTab = Extract<Tab, { kind: 'session' | 'history' }>

/** チャットのタブ。再開していない履歴タブも含む。 */
function isChatTab(tab: Tab): tab is ChatTab {
  return tab.kind === 'session' || tab.kind === 'history'
}

/** タブ数の上限に数えるタブ。 */
function countsTowardTabLimit(tab: Tab): boolean {
  return tab.kind === 'session' || tab.kind === 'connecting' || (tab.kind === 'history' && tab.readOnlyKind !== undefined)
}

function fileTab(relPath: string): Tab {
  return { kind: 'file', sessionId: `file:${relPath}`, title: relPath.split('/').pop() ?? relPath, relPath, editor: editorLanguageFor(relPath) }
}

/** 保存しておいたタブを、開き直すタブにする。 */
function tabFromRestored(restored: RestoredTab, untitled: string): Tab {
  if (restored.kind === 'file') return fileTab(restored.relPath)
  const { snapshot, readOnly, agentOnly } = restored
  const title = snapshot.title || untitled
  if (readOnly) {
    return {
      kind: 'history',
      sessionId: `${snapshot.sessionId}::${readOnly.kind}::${readOnly.timestamp}`,
      title,
      snapshot,
      readOnlyKind: readOnly.kind,
      recordTimestamp: readOnly.timestamp,
      recordFileName: readOnly.fileName
    }
  }
  return { kind: 'history', sessionId: `history:${snapshot.sessionId}`, title, snapshot, agentOnly }
}

/** 次にウィンドウを開いたときに開き直すための、タブの控え。接続中のタブは残さない。 */
function savedFromTab(tab: Tab, split: SavedSplit | undefined): SavedTab[] {
  switch (tab.kind) {
    case 'file':
      return [{ kind: 'file', relPath: tab.relPath, split }]
    case 'session':
      return [{ kind: 'record', fileName: `${tab.snapshotId}.json`, split }]
    case 'history': {
      if (!tab.agentOnly) {
        const fileName = tab.recordFileName ?? `${tab.snapshot.sessionId}.json`
        return [{ kind: 'record', fileName, split }]
      }
      const { sessionId: key, acpSessionId, title, savedAt } = tab.snapshot
      return acpSessionId ? [{ kind: 'agentOnly', key, acpSessionId, title, savedAt, split }] : []
    }
    case 'connecting':
      return []
  }
}

function getProjectIdFromQuery(): string | null {
  return new URLSearchParams(window.location.search).get('projectId')
}

export function App(): React.JSX.Element {
  const { t } = useTranslation()
  const [projectId] = useState(getProjectIdFromQuery)
  const [allProjects, setAllProjects] = useState<ProjectWithStatus[]>([])
  const [project, setProject] = useState<ProjectWithStatus | null>(null)
  /** タブバーの表示順に並べたタブ。 */
  const [tabs, setTabs] = useState<Tab[]>([])
  /** 分割ビューのグループ。閉じたタブが残っていることがあるので、使うときは `normalizeGroups` を通す。 */
  const [splitGroupsState, setSplitGroups] = useState<SplitGroup[]>([])
  /**
   * タブの中身を描く順（開いた順）。タブを並べ替えても中身の DOM を動かさない
   * （動かすと iframe が読み直しになる）よう、表示順とは別に持つ。
   */
  const mountOrderRef = useRef<string[]>([])
  /** 前回のタブを並べ終えたら true。それまではタブの控えを保存しない。 */
  const tabsRestoredRef = useRef(false)
  /** 最後に保存したタブの控え（JSON）。同じなら保存し直さない。 */
  const lastSavedTabsRef = useRef<string | null>(null)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openPanels, setOpenPanels] = useState<Set<SidebarPanel>>(new Set(['tabs']))
  const [commandsOpen, setCommandsOpen] = useState(false)
  /** 前面のタブ（分割ビューでは前面のペイン）の中身の要素。ページ内検索の対象。 */
  const [activePaneEl, setActivePaneEl] = useState<HTMLDivElement | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  /** 認証画面でログインを確かめられたときにすること（新しいチャットを開く、など）。 */
  const authConfirmedRef = useRef<() => void>(() => {})
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [lastOpenedFilePath, setLastOpenedFilePath] = useState<string | null>(null)
  /** ウィンドウを開いたときに尋ねる ACP アダプタの更新。答えるまで最初のタブは開かない。 */
  const [acpUpdateOffer, setAcpUpdateOffer] = useState<AcpUpdateOffer | null>(null)
  const [commandsHeight, setCommandsHeight] = useState(COMMANDS_DEFAULT_HEIGHT)
  const [tabStatuses, setTabStatuses] = useState<
    Record<string, { sending: boolean; hasPendingPermission: boolean }>
  >({})
  const { settings, update: updateSettings } = useSettings()

  /**
   * プロジェクト一覧とサンドボックスの状態（`sbx ls`）を取り直す。タブの接続（`sbx exec`）で
   * サンドボックスが起動するので、接続の成功後とウィンドウへのフォーカス時に呼ぶ。
   */
  function refreshProjects(): void {
    if (!projectId) return
    void window.shovel.projects.list().then(({ projects }) => {
      setAllProjects(projects)
      setProject(projects.find((p) => p.id === projectId) ?? null)
    })
  }
  const refreshProjectsRef = useRef(refreshProjects)
  refreshProjectsRef.current = refreshProjects

  useEffect(() => {
    refreshProjectsRef.current()
    const onFocus = (): void => refreshProjectsRef.current()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [projectId])

  const sessionTabCount = tabs.filter((tab) => tab.kind === 'session' || tab.kind === 'connecting').length
  const limitedTabCount = tabs.filter(countsTowardTabLimit).length
  /** 接続の途中で閉じられた接続中タブの id。接続が終わったら後始末する。 */
  const abandonedConnectingIdsRef = useRef(new Set<string>())

  // main から届く接続の途中経過を、対応する接続中タブに積む。
  useEffect(
    () =>
      window.shovel.session.onOpenProgress(({ requestId, step, detail }) => {
        setTabs((prev) =>
          prev.map((tab) =>
            tab.sessionId === requestId && tab.kind === 'connecting'
              ? { ...tab, steps: [...tab.steps, { step, detail, startedAt: Date.now() }] }
              : tab
          )
        )
      }),
    []
  )

  /** 接続中タブをすぐに出してから接続する。接続できたらその場でセッションタブに差し替える。 */
  function openNewTab(): void {
    if (!projectId || limitedTabCount >= MAX_SESSION_TABS) return
    setError(null)
    const id = `connecting:${crypto.randomUUID()}`
    setTabs((prev) => [
      ...prev,
      {
        kind: 'connecting',
        sessionId: id,
        title: t('mainWindow.newChatTitle', { count: sessionTabCount + 1 }),
        steps: []
      }
    ])
    setActiveSessionId(id)
    void connectTab(id)
  }

  function updateConnectingTab(
    id: string,
    patch: { steps?: ConnectingStepRecord[]; error?: string; needsSbxLogin?: boolean }
  ): void {
    setTabs((prev) => prev.map((tab) => (tab.sessionId === id && tab.kind === 'connecting' ? { ...tab, ...patch } : tab)))
  }

  /** 接続中タブ（またはその再試行）の接続。 */
  async function connectTab(id: string): Promise<void> {
    if (!projectId) return
    updateConnectingTab(id, { steps: [], error: undefined, needsSbxLogin: false })

    try {
      const { sessionId, snapshotId, meta } = await window.shovel.session.openTab(projectId, id)
      // 接続の途中で閉じられていたら、開けたセッションをそのまま閉じる。
      if (abandonedConnectingIdsRef.current.delete(id)) {
        void window.shovel.session.closeTab(sessionId)
        discardSessionEvents(sessionId)
        return
      }
      refreshProjects()
      // 自動添付が有効なら、最後に開いていたファイルを初期チップにする。
      const initialAttachments = settings?.autoAttachActiveFile && lastOpenedFilePath ? [lastOpenedFilePath] : []
      setTabs((prev) =>
        prev.map((tab) =>
          tab.sessionId === id && tab.kind === 'connecting'
            ? { kind: 'session', sessionId, snapshotId, title: tab.title, meta, initialAttachments }
            : tab
        )
      )
      setSplitGroups((prev) => replaceTabId(prev, id, sessionId))
      setActiveSessionId((prev) => (prev === id ? sessionId : prev))
    } catch (err) {
      if (abandonedConnectingIdsRef.current.delete(id)) return
      const message = err instanceof Error ? err.message : String(err)
      // 接続前の確認で未ログインと分かったとき・接続時の認証エラーのときは認証画面を出す。
      if (isAuthRequiredMessage(message)) {
        removeConnectingTab(id)
        openAuthDialog(openNewTab)
        return
      }
      updateConnectingTab(id, { error: friendlyErrorMessage(message, t), needsSbxLogin: needsSbxLogin(message) })
    }
  }

  /** 認証画面を出す。`onConfirmed` はログインを確かめられたときに呼ぶ。 */
  function openAuthDialog(onConfirmed: () => void): void {
    authConfirmedRef.current = onConfirmed
    setAuthOpen(true)
  }

  function removeConnectingTab(id: string): void {
    setTabs((prev) => prev.filter((tab) => tab.sessionId !== id))
    setActiveSessionId((prev) => (prev === id ? null : prev))
  }

  // StrictMode の二重発火でセッションが2つ開かないよう、ref で一度だけに絞る。
  // 前回開いていたタブを並べてから、新しいチャットを一番右に開く。
  // ACP アダプタの新しい版が出ていれば、新しいチャットを開く前に更新するか尋ねる。
  const didOpenInitialTabRef = useRef(false)
  useEffect(() => {
    if (projectId && !didOpenInitialTabRef.current) {
      didOpenInitialTabRef.current = true
      void (async () => {
        const restored = await restoreTabs(projectId)
        // 復元した Read Only タブだけで上限に達していたら、新しいチャットは開かない。
        if (restored.filter(countsTowardTabLimit).length >= MAX_SESSION_TABS) {
          setError(t('mainWindow.tabLimitReached'))
          return
        }
        const offer = await window.shovel.agents.acpUpdateOffer(projectId).catch(() => null)
        if (offer) setAcpUpdateOffer(offer)
        else openNewTab()
      })()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  /**
   * 前回開いていたタブを左から並べ、最後のタブを前面に出す。並べたタブを返す。
   * 以前の形式でチャットの右に添えていたファイルは、チャットのすぐ右に開いて2つのグループにする。
   */
  async function restoreTabs(id: string): Promise<Tab[]> {
    const restored = await window.shovel.tabs.restore(id).catch(() => [])
    const restoredTabs: Tab[] = []
    const splits = new Map<string, SavedSplit>()
    // 同じタブが重複して保存されていたら、最初の1つだけを開く。
    const seen = new Set<string>()
    const push = (tab: Tab, split: SavedSplit | undefined): boolean => {
      if (seen.has(tab.sessionId)) return false
      seen.add(tab.sessionId)
      restoredTabs.push(tab)
      if (split) splits.set(tab.sessionId, split)
      return true
    }
    restored.forEach((r, i) => {
      const tab = tabFromRestored(r, t('history.untitled'))
      const legacyAttached = r.kind === 'history' && !r.split ? r.attachedFile : undefined
      // 以前の形式のグループは、保存された番号と重ならない負の番号にする。
      const legacySplit = legacyAttached ? { group: -1 - i, weight: 1 } : undefined
      if (push(tab, r.split ?? legacySplit) && legacyAttached && legacySplit) push(fileTab(legacyAttached), legacySplit)
    })
    tabsRestoredRef.current = true
    // 並べ終える前にファイラーなどから開いたタブは、復元したタブの右に残す。
    setTabs((prev) => [
      ...restoredTabs.filter((tab) => !prev.some((p) => p.sessionId === tab.sessionId)),
      ...prev
    ])
    setSplitGroups(groupsFromSaved(restoredTabs.map((tab) => tab.sessionId), splits))
    const last = restoredTabs[restoredTabs.length - 1]
    if (last) setActiveSessionId((prev) => prev ?? last.sessionId)
    return restoredTabs
  }

  // タブの構成・並び・分割が変わったら控えを保存する。
  useEffect(() => {
    if (!projectId || !tabsRestoredRef.current) return
    const splits = savedSplitOf(normalizeGroups(splitGroupsState, tabs.map((tab) => tab.sessionId)))
    const saved = tabs.flatMap((tab) => savedFromTab(tab, splits.get(tab.sessionId)))
    const json = JSON.stringify(saved)
    if (json === lastSavedTabsRef.current) return
    lastSavedTabsRef.current = json
    void window.shovel.tabs.save(projectId, saved).catch(() => {})
  }, [projectId, tabs, splitGroupsState])

  async function answerAcpUpdate(update: boolean | null): Promise<void> {
    setAcpUpdateOffer(null)
    if (projectId && update !== null) {
      await window.shovel.agents.resolveAcpUpdate(projectId, update).catch(() => {})
    }
    openNewTab()
  }

  /** ファイラーの中身検索から開いたときの移り先。そのファイルを表示しているエディタ／ビューアだけに渡す。 */
  const [reveal, setReveal] = useState<(FileReveal & { relPath: string }) | null>(null)
  const revealNonceRef = useRef(0)
  function revealFor(relPath: string): FileReveal | undefined {
    return reveal?.relPath === relPath ? reveal : undefined
  }

  /** `at` があれば、開いた後にその位置（中身検索の一致箇所）へ移る。 */
  function openFile(relPath: string, at?: Omit<FileReveal, 'nonce'>): void {
    setLastOpenedFilePath(relPath)
    // 位置なしで開き直したときに、前の移り先へまた飛ばないよう消しておく。
    setReveal(at ? { ...at, relPath, nonce: ++revealNonceRef.current } : null)
    const id = `file:${relPath}`
    // 重複判定は updater の中で行う。
    setTabs((prev) => (prev.some((tab) => tab.sessionId === id) ? prev : [...prev, fileTab(relPath)]))
    setActiveSessionId(id)
  }

  /**
   * ファイラーの「コンテキストに追加」。前面のタブがセッションならそこへ、そうでなければ
   * 表示中のグループで最も左のセッションへ渡す。
   */
  function addToContext(relPath: string): void {
    const shown = groupOf(splitGroups, activeSessionId)
    const candidates = shown ? [activeSessionId, ...shown.panes.map((pane) => pane.tabId)] : [activeSessionId]
    const target = candidates.find((id) => tabs.some((tab) => tab.sessionId === id && tab.kind === 'session'))
    if (target) addAttachmentToSession(target, relPath)
  }

  function openHistory(snapshot: SessionSnapshot, agentOnly = false): void {
    const id = `history:${snapshot.sessionId}`
    setTabs((prev) =>
      prev.some((tab) => tab.sessionId === id)
        ? prev
        : [...prev, { kind: 'history', sessionId: id, title: snapshot.title || t('history.untitled'), snapshot, agentOnly }]
    )
    setActiveSessionId(id)
  }

  /**
   * 履歴一覧の行を開く。ローカル記録があればそれを表示し、「エージェントのみ」の行は
   * 中身の無い仮のスナップショットで開く。どちらも接続は張らない。
   */
  async function openHistoryEntry(entry: HistoryEntry): Promise<void> {
    if (!projectId) return
    if (entry.snapshotId) {
      const snapshot = await window.shovel.session.readLocalRecord(projectId, `${entry.snapshotId}.json`)
      if (snapshot) openHistory(snapshot)
      return
    }
    if (!entry.acpSessionId) return
    openHistory(
      {
        schemaVersion: 1,
        sessionId: entry.key,
        acpSessionId: entry.acpSessionId,
        projectId,
        title: entry.title,
        savedAt: entry.updatedAt,
        entries: []
      },
      true
    )
  }

  /**
   * ローカル記録を開く。
   *   - 現行の記録（`.json`）: 過去セッションの行と同じ。既にタブで開いていればそのタブを前面に出す。
   *   - バックアップ／削除済み: Read Only タブで開く。タブ id は `{sessionId}::{kind}::{epochMillis}`
   *     （2つ目以降は連番を足す）。
   */
  async function openLocalRecord(record: LocalRecordSummary): Promise<void> {
    if (!projectId) return
    if (record.kind === 'current') {
      const openId = tabs.find(
        (tab) =>
          (tab.kind === 'session' && tab.snapshotId === record.sessionId) ||
          tab.sessionId === `history:${record.sessionId}`
      )?.sessionId
      if (openId) {
        setActiveSessionId(openId)
        return
      }
    } else if (limitedTabCount >= MAX_SESSION_TABS) {
      setError(t('mainWindow.tabLimitReached'))
      return
    }
    const snapshot = await window.shovel.session.readLocalRecord(projectId, record.fileName)
    if (!snapshot) return
    if (record.kind === 'current') {
      openHistory(snapshot)
      return
    }
    const readOnlyKind = record.kind
    const baseId = `${record.sessionId}::${readOnlyKind}::${record.timestamp}`
    let id = baseId
    for (let n = 2; tabs.some((tab) => tab.sessionId === id); n++) id = `${baseId}::${n}`
    setTabs((prev) => {
      if (prev.some((tab) => tab.sessionId === id)) return prev
      return [
        ...prev,
        {
          kind: 'history',
          sessionId: id,
          title: snapshot.title || t('history.untitled'),
          snapshot,
          readOnlyKind,
          recordTimestamp: record.timestamp,
          recordFileName: record.fileName
        }
      ]
    })
    setActiveSessionId(id)
  }

  /**
   * 履歴タブの「再開」。成功したら履歴タブをライブのセッションタブへ差し替える。
   * タブ id は元のスナップショットの id を引き継ぐ。
   */
  async function resumeHistory(snapshot: SessionSnapshot, agentOnly = false): Promise<void> {
    if (!projectId) return
    const { sessionId, snapshotId, meta } =
      agentOnly && snapshot.acpSessionId
        ? await window.shovel.session.resumeAgentSession(projectId, snapshot.acpSessionId, snapshot.title || undefined)
        : await window.shovel.session.resumeTab(projectId, snapshot.sessionId)
    refreshProjects()
    setTabs((prev) =>
      prev.map((tab) =>
        tab.sessionId === `history:${snapshot.sessionId}`
          ? {
              kind: 'session',
              sessionId,
              snapshotId,
              title: snapshot.title || t('history.untitled'),
              meta,
              initialAttachments: []
            }
          : tab
      )
    )
    setSplitGroups((prev) => replaceTabId(prev, `history:${snapshot.sessionId}`, sessionId))
    setActiveSessionId(sessionId)
  }

  // mermaid をウィンドウが開いた後の空き時間に読み込んでおく。
  useEffect(() => preloadMermaid(), [])

  useEffect(() => {
    void window.shovel.sidebar.getWidths().then((widths) => {
      if (widths.commandsHeight) setCommandsHeight(widths.commandsHeight)
    })
  }, [])

  const tabIds = tabs.map((tab) => tab.sessionId)
  const splitGroups = normalizeGroups(splitGroupsState, tabIds)

  /** 並べ替えた順にタブを並べ直し、グループを差し替える。 */
  function applyLayout(layout: SplitLayout): void {
    setTabs((prev) => {
      const byId = new Map(prev.map((tab) => [tab.sessionId, tab]))
      const ordered = layout.order.flatMap((id) => byId.get(id) ?? [])
      const rest = prev.filter((tab) => !layout.order.includes(tab.sessionId))
      const next = [...ordered, ...rest]
      return next.every((tab, i) => tab === prev[i]) ? prev : next
    })
    setSplitGroups(layout.groups)
  }

  /** タブを、いま表示しているタブ（グループならその右端）の右に分割して並べ、前面のペインにする。 */
  function splitTabRight(id: string): void {
    if (!activeSessionId || !canSplitRight(splitGroups, activeSessionId, id)) return
    applyLayout(splitRight({ order: tabIds, groups: splitGroups }, activeSessionId, id))
    setActiveSessionId(id)
  }

  function unsplitTab(id: string): void {
    applyLayout(unsplit({ order: tabIds, groups: splitGroups }, id))
    setActiveSessionId(id)
  }

  /** ファイラーの「右に分割して開く」: ファイルを開いて（無ければタブを作り）、表示中のタブの右に並べる。 */
  function openFileSplitRight(relPath: string): void {
    const id = `file:${relPath}`
    if (!activeSessionId || !canSplitRight(splitGroups, activeSessionId, id)) return
    setLastOpenedFilePath(relPath)
    setReveal(null)
    const order = tabIds.includes(id) ? tabIds : [...tabIds, id]
    if (!tabIds.includes(id)) setTabs((prev) => (prev.some((tab) => tab.sessionId === id) ? prev : [...prev, fileTab(relPath)]))
    applyLayout(splitRight({ order, groups: splitGroups }, activeSessionId, id))
    setActiveSessionId(id)
  }

  async function closeTab(id: string): Promise<void> {
    const tab = tabs.find((t) => t.sessionId === id)
    if (tab?.kind === 'session') {
      await window.shovel.session.closeTab(id)
      discardSessionEvents(id)
    }
    // 接続の途中なら、接続が終わったところで後始末する（失敗済みなら何も残っていない）。
    if (tab?.kind === 'connecting' && !tab.error) abandonedConnectingIdsRef.current.add(id)
    // 分割ビューのグループのタブなら、同じグループの隣のペインを前面にする。
    const neighbor = neighborInGroup(splitGroups, id)
    setTabs((prev) => {
      const next = prev.filter((t) => t.sessionId !== id)
      if (activeSessionId === id) {
        setActiveSessionId(neighbor ?? (next.length > 0 ? next[next.length - 1]!.sessionId : null))
      }
      return next
    })
    setTabStatuses((prev) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  /** ソフトデリートしたローカル記録を開いている Read Only タブを閉じる。 */
  function closeRecordTabs(fileNames: string[]): void {
    const deleted = new Set(fileNames)
    const remains = (tab: Tab): boolean =>
      !(tab.kind === 'history' && tab.recordFileName !== undefined && deleted.has(tab.recordFileName))
    const next = tabs.filter(remains)
    if (next.length === tabs.length) return
    setTabs((prev) => prev.filter(remains))
    if (!next.some((tab) => tab.sessionId === activeSessionId)) {
      setActiveSessionId(next.length > 0 ? next[next.length - 1]!.sessionId : null)
    }
  }

  /**
   * ファイルのタブをまとめて閉じる（チャット・履歴のタブは残す）。`keepId` を渡すとそのタブは残して
   * 前面に出す。ファイルのタブは main 側に後始末がないので、`closeTab` を経由しない。
   */
  function closeFileTabs(keepId: string | null): void {
    const remains = (tab: Tab): boolean => tab.kind !== 'file' || tab.sessionId === keepId
    const next = tabs.filter(remains)
    setTabs((prev) => prev.filter(remains))
    if (keepId) setActiveSessionId(keepId)
    else if (!next.some((tab) => tab.sessionId === activeSessionId)) {
      setActiveSessionId(next.length > 0 ? next[next.length - 1]!.sessionId : null)
    }
  }

  /** 背景タブの通知状態。変化がなければ同一参照を返す。 */
  function updateTabStatus(
    sessionId: string,
    status: { sending: boolean; hasPendingPermission: boolean }
  ): void {
    setTabStatuses((prev) => {
      const current = prev[sessionId]
      if (current && current.sending === status.sending && current.hasPendingPermission === status.hasPendingPermission) {
        return prev
      }
      return { ...prev, [sessionId]: status }
    })
  }

  /** ↻ で新しい会話に移ったタブの名前を既定名に戻す。 */
  function handleRefreshed(sessionId: string, snapshotId: string): void {
    setTabs((prev) =>
      prev.map((tab) =>
        tab.sessionId === sessionId && tab.kind === 'session'
          ? { ...tab, snapshotId, title: t('mainWindow.newChatTitle', { count: sessionTabCount }) }
          : tab
      )
    )
  }

  /** タブバーでドラッグしたタブを、`beforeId` のタブの左（`null` なら一番右）へ動かす。 */
  function moveTab(id: string, beforeId: string | null): void {
    const layout = { order: tabIds, groups: splitGroups }
    const next = moveTabInLayout(layout, id, beforeId)
    if (next !== layout) applyLayout(next)
  }

  function renameTab(sessionId: string, title: string): void {
    setTabs((prev) => prev.map((tab) => (tab.sessionId === sessionId ? { ...tab, title } : tab)))
  }

  function togglePanel(panel: SidebarPanel): void {
    setOpenPanels((prev) => {
      const next = new Set(prev)
      if (next.has(panel)) next.delete(panel)
      else next.add(panel)
      return next
    })
  }

  useTabSwitchShortcuts(tabIds, activeSessionId, setActiveSessionId)

  if (!projectId) {
    return <div className="p-4 text-sm text-muted-foreground">{t('mainWindow.noProject')}</div>
  }

  /** いま表示している分割ビューのグループ。前面のタブがグループに入っていなければ `undefined`。 */
  const shownGroup = groupOf(splitGroups, activeSessionId)
  const paneMinWidth = (tab: Tab): number => (isChatTab(tab) ? CHAT_PANE_MIN_WIDTH : PANE_MIN_WIDTH)

  /**
   * ペインの境目のドラッグ。ドラッグ中は DOM の flex-grow を直接書き換え、離したところで比率を保存する
   * （動かすたびにウィンドウ全体を描き直さないため）。
   */
  function startPaneResize(e: React.PointerEvent<HTMLDivElement>, group: SplitGroup, leftIndex: number): void {
    if (e.button !== 0) return
    e.preventDefault()
    const handle = e.currentTarget
    const container = handle.parentElement
    if (!container) return
    const els = group.panes.map((pane) => container.querySelector<HTMLElement>(`[data-pane-id="${CSS.escape(pane.tabId)}"]`))
    if (els.some((el) => !el)) return
    const widths = els.map((el) => el!.getBoundingClientRect().width)
    els.forEach((el, i) => (el!.style.flexGrow = String(widths[i])))
    const minWidths = group.panes.map((pane) => {
      const tab = tabsById.get(pane.tabId)
      return tab ? paneMinWidth(tab) : PANE_MIN_WIDTH
    })
    const startX = e.clientX
    handle.setPointerCapture(e.pointerId)
    const onMove = (ev: PointerEvent): void => {
      const next = resizeAdjacent(
        { width: widths[leftIndex]!, minWidth: minWidths[leftIndex]! },
        { width: widths[leftIndex + 1]!, minWidth: minWidths[leftIndex + 1]! },
        ev.clientX - startX
      )
      els[leftIndex]!.style.flexGrow = String(next.left)
      els[leftIndex + 1]!.style.flexGrow = String(next.right)
    }
    const onUp = (): void => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
      const finalWidths = Object.fromEntries(group.panes.map((pane, i) => [pane.tabId, Number(els[i]!.style.flexGrow)]))
      setSplitGroups((prev) => setPaneWeights(normalizeGroups(prev, tabIds), group.id, finalWidths))
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  }

  const tabInfos: TabInfo[] = tabs.map((tab) => ({
    sessionId: tab.sessionId,
    title: tab.title,
    tooltip: tab.kind === 'file' ? tab.relPath : undefined,
    kind: tab.kind,
    snapshotId: tab.kind === 'session' ? tab.snapshotId : undefined,
    failed: tab.kind === 'connecting' ? tab.error !== undefined : undefined,
    status: tab.kind === 'session' ? tabStatuses[tab.sessionId] : undefined,
    splitGroupId: groupOf(splitGroups, tab.sessionId)?.id,
    shown: tab.sessionId !== activeSessionId && shownGroup?.panes.some((pane) => pane.tabId === tab.sessionId),
    canSplitRight: canSplitRight(splitGroups, activeSessionId, tab.sessionId)
  }))
  const activeTab = tabs.find((tab) => tab.sessionId === activeSessionId) ?? null

  const tabsById = new Map(tabs.map((tab) => [tab.sessionId, tab]))
  const mountOrder = mountOrderRef.current.filter((id) => tabsById.has(id))
  for (const tab of tabs) if (!mountOrder.includes(tab.sessionId)) mountOrder.push(tab.sessionId)
  mountOrderRef.current = mountOrder
  const tabsInMountOrder = mountOrder.map((id) => tabsById.get(id)!)

  return (
    <div className="flex h-screen flex-col">
      <Header
        displayName={project?.displayName ?? '…'}
        status={project?.status ?? null}
        currentProjectId={projectId}
        recentProjects={allProjects}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenDetails={() => setDetailsOpen(true)}
      />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          projectId={projectId}
          openPanels={openPanels}
          onTogglePanel={togglePanel}
          commandsOpen={commandsOpen}
          onToggleCommands={() => setCommandsOpen((v) => !v)}
          tabs={tabInfos}
          activeSessionId={activeSessionId}
          onSelectTab={setActiveSessionId}
          onOpenFile={openFile}
          onOpenHistory={(entry) => void openHistoryEntry(entry)}
          onOpenLocalRecord={(record) => void openLocalRecord(record)}
          onRenameTab={renameTab}
          onCloseTab={(id) => void closeTab(id)}
          onRecordsDeleted={closeRecordTabs}
          onAddToContext={addToContext}
          onOpenSplitRight={openFileSplitRight}
          canOpenSplitRight={(relPath) => !!activeSessionId && canSplitRight(splitGroups, activeSessionId, `file:${relPath}`)}
        />
        <div className="flex flex-1 flex-col overflow-hidden">
          <TabBar
            tabs={tabInfos}
            activeSessionId={activeSessionId}
            onSelect={setActiveSessionId}
            onClose={(id) => void closeTab(id)}
            onCloseFiles={closeFileTabs}
            onMove={moveTab}
            onSplitRight={splitTabRight}
            onUnsplit={unsplitTab}
            onNew={openNewTab}
            canAddTab={limitedTabCount < MAX_SESSION_TABS}
          />
          {error && (
            <div className="flex items-start gap-2 border-b border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span className="flex-1">{error}</span>
            </div>
          )}
          <div className="relative flex flex-1 flex-col overflow-hidden">
            <FindBar root={activePaneEl} />
            <div className={cn('flex flex-1', shownGroup ? 'overflow-x-auto overflow-y-hidden' : 'overflow-hidden')}>
              {tabsInMountOrder.map((tab) => {
                const isActive = tab.sessionId === activeTab?.sessionId
                const paneIndex = shownGroup ? shownGroup.panes.findIndex((pane) => pane.tabId === tab.sessionId) : -1
                const pane = shownGroup?.panes[paneIndex]
                const visible = pane !== undefined || (!shownGroup && isActive)
                return (
                  <div
                    key={tab.sessionId}
                    ref={isActive ? setActivePaneEl : undefined}
                    data-pane-id={tab.sessionId}
                    className={
                      !visible
                        ? 'hidden'
                        : pane
                          ? cn('flex flex-col overflow-hidden border-t-2', isActive ? 'border-primary' : 'border-transparent')
                          : 'flex min-w-0 flex-1 flex-col overflow-hidden'
                    }
                    // 開いた順に描いたまま、表示するペインだけを `order` で並べる（DOM を動かすと iframe が読み直しになる）。
                    style={pane ? { order: paneIndex * 2, flexGrow: pane.weight, flexBasis: 0, minWidth: paneMinWidth(tab) } : undefined}
                    onPointerDownCapture={pane && !isActive ? () => setActiveSessionId(tab.sessionId) : undefined}
                  >
                    {tab.kind === 'session' ? (
                      <SessionView
                        sessionId={tab.sessionId}
                        initialMeta={tab.meta}
                        initialAttachments={tab.initialAttachments}
                        sendKey={settings?.sendKey ?? 'enter'}
                        diffLayout={settings?.diffLayout}
                        onOpenFile={openFile}
                        onStatusChange={(status) => updateTabStatus(tab.sessionId, status)}
                        onRefreshed={(snapshotId) => handleRefreshed(tab.sessionId, snapshotId)}
                        onTitleChange={(title) => renameTab(tab.sessionId, title)}
                      />
                    ) : tab.kind === 'history' ? (
                      <HistoryView
                        snapshot={tab.snapshot}
                        readOnlyKind={tab.readOnlyKind}
                        recordTimestamp={tab.recordTimestamp}
                        agentOnly={tab.agentOnly}
                        onResume={() => resumeHistory(tab.snapshot, tab.agentOnly)}
                        onAuthRequired={openAuthDialog}
                        onStartNew={openNewTab}
                        onOpenFile={openFile}
                        diffLayout={settings?.diffLayout}
                      />
                    ) : tab.kind === 'connecting' ? (
                      <ConnectingView
                        steps={tab.steps}
                        error={tab.error}
                        onSbxLogin={tab.needsSbxLogin ? () => void window.shovel.projects.openSbxLogin() : undefined}
                        onRetry={() => void connectTab(tab.sessionId)}
                        onClose={() => void closeTab(tab.sessionId)}
                      />
                    ) : tab.editor ? (
                      <TextFileEditor
                        projectId={projectId}
                        relPath={tab.relPath}
                        language={tab.editor}
                        reveal={revealFor(tab.relPath)}
                      />
                    ) : (
                      <FileViewer projectId={projectId} relPath={tab.relPath} reveal={revealFor(tab.relPath)} />
                    )}
                  </div>
                )
              })}
              {shownGroup?.panes.slice(0, -1).map((pane, i) => (
                <div
                  key={`divider:${pane.tabId}`}
                  className="w-1 shrink-0 cursor-col-resize bg-border hover:bg-primary/50"
                  style={{ order: i * 2 + 1 }}
                  onPointerDown={(e) => startPaneResize(e, shownGroup, i)}
                />
              ))}
              {tabs.length === 0 && !error && (
                <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                  {t('mainWindow.connecting')}
                </div>
              )}
            </div>
          </div>
          {commandsOpen && (
            <ResizablePanel
              edge="top"
              width={commandsHeight}
              minWidth={120}
              maxWidth={900}
              onResizeEnd={(height) => {
                setCommandsHeight(height)
                void window.shovel.sidebar.setWidth('commandsHeight', height)
              }}
            >
              <Commands projectId={projectId} onClose={() => setCommandsOpen(false)} />
            </ResizablePanel>
          )}
        </div>
      </div>
      {settings && (
        <SettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          settings={settings}
          onUpdate={(patch) => void updateSettings(patch)}
        />
      )}
      <ProjectDetailDialog projectId={projectId} open={detailsOpen} onOpenChange={setDetailsOpen} />
      <AcpUpdateDialog
        offer={acpUpdateOffer}
        onAnswer={(update) => void answerAcpUpdate(update)}
        onDismiss={() => void answerAcpUpdate(null)}
      />
      <AuthDialog
        open={authOpen}
        onOpenChange={setAuthOpen}
        projectId={projectId}
        onConfirmed={() => authConfirmedRef.current()}
      />
    </div>
  )
}
