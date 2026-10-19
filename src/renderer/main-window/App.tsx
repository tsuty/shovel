import { useEffect, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AcpUpdateOffer, ProjectWithStatus } from '@shared/types/project'
import type {
  HistoryEntry,
  LocalRecordSummary,
  RestoredTab,
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
import { AttachTargetDialog } from './components/AttachTargetDialog'
import { AcpUpdateDialog } from './components/AcpUpdateDialog'
import { ProjectDetailDialog } from '../shared/components/ProjectDetailDialog'
import { preloadMermaid } from '../shared/lib/mermaid'
import { isAuthRequiredMessage } from '@shared/authMarker'
import { useTabSwitchShortcuts } from './useTabShortcuts'
import { addAttachmentToSession } from './attachmentRegistry'
import { discardSessionEvents } from './sessionEvents'
import { ResizablePanel } from './components/ResizablePanel'
import { cn } from '../shared/lib/utils'
import { friendlyErrorMessage } from '../shared/friendlyError'
import { editorLanguageFor, type EditorLanguage } from '@shared/fileKinds'
import { getAgentEntry } from '@shared/agentTable'
import { ConnectingView, type ConnectingStepRecord } from './components/ConnectingView'
import { FindBar } from './components/FindBar'
import type { FileReveal } from './revealMatch'

const MAX_SESSION_TABS = 10
/** チャットの右に添えたファイルのペインの既定幅（px）。 */
const ATTACHED_DEFAULT_WIDTH = 520
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
      /**
       * このチャットタブの右に添えたファイル。添えている間はタブバーに出さず、タブ数にも数えない。
       * チャットタブを閉じると一緒に閉じる。
       */
      attachedFile?: string
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
      /** 右に添えたファイル。再開後も引き継ぐ。 */
      attachedFile?: string
    }

type ChatTab = Extract<Tab, { kind: 'session' | 'history' }>

/** 「チャットの横に表示」の添え先になれるタブ。再開していない履歴タブも含む。 */
function isChatTab(tab: Tab): tab is ChatTab {
  return tab.kind === 'session' || tab.kind === 'history'
}

/** タブ数の上限に数えるタブ。 */
function countsTowardTabLimit(tab: Tab): boolean {
  return tab.kind === 'session' || tab.kind === 'connecting' || (tab.kind === 'history' && tab.readOnlyKind !== undefined)
}

/** 保存しておいたタブを、開き直すタブにする。 */
function tabFromRestored(restored: RestoredTab, untitled: string): Tab {
  if (restored.kind === 'file') {
    const { relPath } = restored
    return { kind: 'file', sessionId: `file:${relPath}`, title: relPath.split('/').pop() ?? relPath, relPath, editor: editorLanguageFor(relPath) }
  }
  const { snapshot, readOnly, agentOnly, attachedFile } = restored
  const title = snapshot.title || untitled
  if (readOnly) {
    return {
      kind: 'history',
      sessionId: `${snapshot.sessionId}::${readOnly.kind}::${readOnly.timestamp}`,
      title,
      snapshot,
      readOnlyKind: readOnly.kind,
      recordTimestamp: readOnly.timestamp,
      recordFileName: readOnly.fileName,
      attachedFile
    }
  }
  return { kind: 'history', sessionId: `history:${snapshot.sessionId}`, title, snapshot, agentOnly, attachedFile }
}

/** 次にウィンドウを開いたときに開き直すための、タブの控え。接続中のタブは残さない。 */
function savedFromTab(tab: Tab): SavedTab[] {
  switch (tab.kind) {
    case 'file':
      return [{ kind: 'file', relPath: tab.relPath }]
    case 'session':
      return [{ kind: 'record', fileName: `${tab.snapshotId}.json`, attachedFile: tab.attachedFile }]
    case 'history': {
      if (!tab.agentOnly) {
        const fileName = tab.recordFileName ?? `${tab.snapshot.sessionId}.json`
        return [{ kind: 'record', fileName, attachedFile: tab.attachedFile }]
      }
      const { sessionId: key, acpSessionId, title, savedAt } = tab.snapshot
      return acpSessionId ? [{ kind: 'agentOnly', key, acpSessionId, title, savedAt, attachedFile: tab.attachedFile }] : []
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
  const tabContentRef = useRef<HTMLDivElement>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [lastOpenedFilePath, setLastOpenedFilePath] = useState<string | null>(null)
  /** 添え先が1つに決まらなかったときに、どのチャットに添えるかを選ばせる対象ファイル。 */
  const [attachPickerPath, setAttachPickerPath] = useState<string | null>(null)
  /** ウィンドウを開いたときに尋ねる ACP アダプタの更新。答えるまで最初のタブは開かない。 */
  const [acpUpdateOffer, setAcpUpdateOffer] = useState<AcpUpdateOffer | null>(null)
  const [attachedWidth, setAttachedWidth] = useState(ATTACHED_DEFAULT_WIDTH)
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

  function updateConnectingTab(id: string, patch: { steps?: ConnectingStepRecord[]; error?: string }): void {
    setTabs((prev) => prev.map((tab) => (tab.sessionId === id && tab.kind === 'connecting' ? { ...tab, ...patch } : tab)))
  }

  /** 接続中タブ（またはその再試行）の接続。 */
  async function connectTab(id: string): Promise<void> {
    if (!projectId) return
    // 認証状態の確認は renderer から呼ぶので、この段階だけはここで積む。
    updateConnectingTab(id, { steps: [{ step: 'auth', startedAt: Date.now() }], error: undefined })

    try {
      // 接続前に認証状態を確認し、未ログインなら認証画面を出す。
      const status = await window.shovel.auth.status(projectId)
      if (abandonedConnectingIdsRef.current.delete(id)) return
      if (!status.checkFailed && !status.loggedIn) {
        removeConnectingTab(id)
        setAuthOpen(true)
        return
      }

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
      setActiveSessionId((prev) => (prev === id ? sessionId : prev))
    } catch (err) {
      if (abandonedConnectingIdsRef.current.delete(id)) return
      const message = err instanceof Error ? err.message : String(err)
      // 接続時の認証エラーでも認証画面を出す。
      if (isAuthRequiredMessage(message)) {
        removeConnectingTab(id)
        setAuthOpen(true)
        return
      }
      updateConnectingTab(id, { error: friendlyErrorMessage(message, t) })
    }
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

  /** 前回開いていたタブを左から並べ、最後のタブを前面に出す。並べたタブを返す。 */
  async function restoreTabs(id: string): Promise<Tab[]> {
    const restored = await window.shovel.tabs.restore(id).catch(() => [])
    // 同じタブが重複して保存されていたら、最初の1つだけを開く。
    const seen = new Set<string>()
    const restoredTabs = restored
      .map((r) => tabFromRestored(r, t('history.untitled')))
      .filter((tab) => !seen.has(tab.sessionId) && seen.add(tab.sessionId))
    tabsRestoredRef.current = true
    // 並べ終える前にファイラーなどから開いたタブは、復元したタブの右に残す。
    setTabs((prev) => [
      ...restoredTabs.filter((tab) => !prev.some((p) => p.sessionId === tab.sessionId)),
      ...prev
    ])
    const last = restoredTabs[restoredTabs.length - 1]
    if (last) setActiveSessionId((prev) => prev ?? last.sessionId)
    return restoredTabs
  }

  // タブの構成・並びが変わったら控えを保存する。
  useEffect(() => {
    if (!projectId || !tabsRestoredRef.current) return
    const saved = tabs.flatMap(savedFromTab)
    const json = JSON.stringify(saved)
    if (json === lastSavedTabsRef.current) return
    lastSavedTabsRef.current = json
    void window.shovel.tabs.save(projectId, saved).catch(() => {})
  }, [projectId, tabs])

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
    // チャットの横に添えてあるなら、そのチャットタブを前に出す。
    const holder = tabs.find((tab) => isChatTab(tab) && tab.attachedFile === relPath)
    if (holder) {
      setActiveSessionId(holder.sessionId)
      return
    }
    const id = `file:${relPath}`
    // 重複判定は updater の中で行う。
    setTabs((prev) =>
      prev.some((tab) => tab.sessionId === id)
        ? prev
        : [
            ...prev,
            {
              kind: 'file',
              sessionId: id,
              title: relPath.split('/').pop() ?? relPath,
              relPath,
              editor: editorLanguageFor(relPath)
            }
          ]
    )
    setActiveSessionId(id)
  }

  /** ファイラーの「コンテキストに追加」。アクティブなセッションタブへ渡す。 */
  function addToContext(relPath: string): void {
    if (activeSessionId) addAttachmentToSession(activeSessionId, relPath)
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
              initialAttachments: [],
              attachedFile: tab.kind === 'history' ? tab.attachedFile : undefined
            }
          : tab
      )
    )
    setActiveSessionId(sessionId)
  }

  // mermaid をウィンドウが開いた後の空き時間に読み込んでおく。
  useEffect(() => preloadMermaid(), [])

  useEffect(() => {
    void window.shovel.sidebar.getWidths().then((widths) => {
      // 保存キーは Markdown だけを添えられた頃の名前のまま（記憶済みの幅を引き継ぐ）。
      if (widths.attachedMarkdown) setAttachedWidth(widths.attachedMarkdown)
      if (widths.commandsHeight) setCommandsHeight(widths.commandsHeight)
    })
  }, [])

  const chatTabs = tabs.filter(isChatTab)
  const canAttachFile = chatTabs.length > 0

  /**
   * 編集できるファイル（Markdown / Mermaid / HTML / JSON / YAML / テキスト）をチャットタブの右に添える。
   * 添え先は、今のタブがチャットならそれ、チャットが1つしか無ければそれ。決まらなければ添え先を選ばせる。
   */
  function attachFile(relPath: string): void {
    const active = tabs.find((tab) => tab.sessionId === activeSessionId)
    const target = active && isChatTab(active) ? active : chatTabs.length === 1 ? chatTabs[0] : undefined
    if (target) attachFileTo(target.sessionId, relPath)
    else if (chatTabs.length > 1) setAttachPickerPath(relPath)
  }

  /** 同じファイルの独立したタブがあれば閉じ、既に別のファイルを添えていれば置き換える。 */
  function attachFileTo(targetId: string, relPath: string): void {
    setTabs((prev) =>
      prev
        .filter((tab) => tab.sessionId !== `file:${relPath}`)
        .map((tab) => (tab.sessionId === targetId && isChatTab(tab) ? { ...tab, attachedFile: relPath } : tab))
    )
    setActiveSessionId(targetId)
  }

  function detachFile(sessionId: string): void {
    setTabs((prev) =>
      prev.map((tab) => (tab.sessionId === sessionId && isChatTab(tab) ? { ...tab, attachedFile: undefined } : tab))
    )
  }

  /**
   * Cmd/Ctrl+数字で選んだタブだけを表示する。チャットの横にファイルを添えていれば分割を解除し、
   * そのファイルはチャットのすぐ右の独立したタブに戻す。
   */
  function selectTabExclusively(id: string): void {
    setTabs((prev) => {
      const index = prev.findIndex((tab) => tab.sessionId === id)
      const tab = prev[index]
      if (!tab || !isChatTab(tab) || !tab.attachedFile) return prev
      const relPath = tab.attachedFile
      const next = [...prev]
      next[index] = { ...tab, attachedFile: undefined }
      if (!next.some((t) => t.sessionId === `file:${relPath}`)) {
        next.splice(index + 1, 0, {
          kind: 'file',
          sessionId: `file:${relPath}`,
          title: relPath.split('/').pop() ?? relPath,
          relPath,
          editor: editorLanguageFor(relPath)
        })
      }
      return next
    })
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
    setTabs((prev) => {
      const next = prev.filter((t) => t.sessionId !== id)
      if (activeSessionId === id) {
        setActiveSessionId(next.length > 0 ? next[next.length - 1]!.sessionId : null)
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
    if (id === beforeId) return
    setTabs((prev) => {
      const moving = prev.find((tab) => tab.sessionId === id)
      if (!moving) return prev
      const rest = prev.filter((tab) => tab.sessionId !== id)
      const at = beforeId === null ? rest.length : rest.findIndex((tab) => tab.sessionId === beforeId)
      if (at < 0) return prev
      rest.splice(at, 0, moving)
      return rest.every((tab, i) => tab === prev[i]) ? prev : rest
    })
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

  const tabIds = tabs.map((tab) => tab.sessionId)
  useTabSwitchShortcuts(tabIds, activeSessionId, selectTabExclusively)

  if (!projectId) {
    return <div className="p-4 text-sm text-muted-foreground">{t('mainWindow.noProject')}</div>
  }

  const tabInfos: TabInfo[] = tabs.map((tab) => ({
    sessionId: tab.sessionId,
    title: tab.title,
    tooltip: tab.kind === 'file' ? tab.relPath : undefined,
    kind: tab.kind,
    snapshotId: tab.kind === 'session' ? tab.snapshotId : undefined,
    failed: tab.kind === 'connecting' ? tab.error !== undefined : undefined,
    status: tab.kind === 'session' ? tabStatuses[tab.sessionId] : undefined
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
          onAddToContext={addToContext}
          onAttachFile={attachFile}
          canAttachFile={canAttachFile}
        />
        <div className="flex flex-1 flex-col overflow-hidden">
          <TabBar
            tabs={tabInfos}
            activeSessionId={activeSessionId}
            onSelect={setActiveSessionId}
            onClose={(id) => void closeTab(id)}
            onCloseFiles={closeFileTabs}
            onMove={moveTab}
            onNew={openNewTab}
            canAddTab={limitedTabCount < MAX_SESSION_TABS}
          />
          {error && (
            <div className="flex items-start gap-2 border-b border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span className="flex-1">{error}</span>
            </div>
          )}
          <div ref={tabContentRef} className="relative flex flex-1 flex-col overflow-hidden">
            <FindBar root={tabContentRef} />
            {tabsInMountOrder.map((tab) => (
              <div
                key={tab.sessionId}
                className={
                  tab.sessionId === activeTab?.sessionId ? 'flex flex-1 flex-col overflow-hidden' : 'hidden'
                }
              >
                {isChatTab(tab) ? (
                  <div className="flex flex-1 overflow-hidden">
                    {/* チャットの最小幅を保ち、足りなければ添えたファイル側が縮む。 */}
                    <div className={cn('flex flex-1 flex-col overflow-hidden', tab.attachedFile ? 'min-w-[320px]' : 'min-w-0')}>
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
                      ) : (
                        <HistoryView
                          snapshot={tab.snapshot}
                          readOnlyKind={tab.readOnlyKind}
                          recordTimestamp={tab.recordTimestamp}
                          agentOnly={tab.agentOnly}
                          onResume={() => resumeHistory(tab.snapshot, tab.agentOnly)}
                          onStartNew={openNewTab}
                          onOpenFile={openFile}
                          diffLayout={settings?.diffLayout}
                        />
                      )}
                    </div>
                    {tab.attachedFile && (
                      <ResizablePanel
                        edge="left"
                        shrinkable
                        width={attachedWidth}
                        minWidth={280}
                        maxWidth={1200}
                        onResizeEnd={(width) => {
                          setAttachedWidth(width)
                          void window.shovel.sidebar.setWidth('attachedMarkdown', width)
                        }}
                      >
                        <TextFileEditor
                          key={tab.attachedFile}
                          projectId={projectId}
                          relPath={tab.attachedFile}
                          language={editorLanguageFor(tab.attachedFile) ?? 'markdown'}
                          variant="attached"
                          onClose={() => detachFile(tab.sessionId)}
                          reveal={revealFor(tab.attachedFile)}
                        />
                      </ResizablePanel>
                    )}
                  </div>
                ) : tab.kind === 'connecting' ? (
                  <ConnectingView
                    steps={tab.steps}
                    authCommand={project ? getAgentEntry(project.agentId)?.auth.statusCommand.join(' ') : undefined}
                    error={tab.error}
                    onRetry={() => void connectTab(tab.sessionId)}
                    onClose={() => void closeTab(tab.sessionId)}
                  />
                ) : tab.editor ? (
                  <TextFileEditor
                    projectId={projectId}
                    relPath={tab.relPath}
                    language={tab.editor}
                    canAttachToChat={canAttachFile}
                    onAttachToChat={() => attachFile(tab.relPath)}
                    reveal={revealFor(tab.relPath)}
                  />
                ) : (
                  <FileViewer projectId={projectId} relPath={tab.relPath} reveal={revealFor(tab.relPath)} />
                )}
              </div>
            ))}
            {tabs.length === 0 && !error && (
              <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                {t('mainWindow.connecting')}
              </div>
            )}
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
      <AttachTargetDialog
        relPath={attachPickerPath}
        chatTabs={chatTabs}
        onPick={(targetId) => {
          if (attachPickerPath) attachFileTo(targetId, attachPickerPath)
          setAttachPickerPath(null)
        }}
        onCancel={() => setAttachPickerPath(null)}
      />
      <AuthDialog
        open={authOpen}
        onOpenChange={setAuthOpen}
        projectId={projectId}
        onConfirmed={openNewTab}
      />
    </div>
  )
}
