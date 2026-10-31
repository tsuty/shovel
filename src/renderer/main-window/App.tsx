import { useEffect, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AcpUpdateOffer, ProjectWithStatus } from '@shared/types/project'
import type {
  HistoryEntry,
  LocalRecordSummary,
  RestoredTab,
  SavedPane,
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
import { friendlyErrorMessage, needsSbxLogin } from '../shared/friendlyError'
import { editorLanguageFor, type EditorLanguage } from '@shared/fileKinds'
import { ConnectingView, type ConnectingStepRecord } from './components/ConnectingView'
import { FindBar } from './components/FindBar'
import type { FileReveal } from './revealMatch'
import type { Bookmark } from '@shared/types/browser'
import { BrowserView } from './components/BrowserView'
import { BookmarkDialog } from './components/BookmarkDialog'
import {
  activateTab,
  canSplitRight,
  focusPane,
  focusedPane,
  focusedTabId,
  initialLayout,
  layoutFromSaved,
  moveTab as moveTabInLayout,
  normalizeLayout,
  paneOf,
  removeTab,
  replaceTabId,
  resizeAdjacent,
  savedPanesOf,
  setPaneWeights,
  splitRight,
  type Pane,
  type PaneLayout
} from './paneLayout'

const MAX_SESSION_TABS = 10
/** 分割ビューのペインの最小幅（px）。前面のタブがチャットならトランスクリプトを読める幅を残す。 */
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
      kind: 'browser'
      sessionId: string
      title: string
      /** 最初に開くページ。中身の `<webview>` はこれを最初の1回だけ使う。 */
      initialUrl: string
      /** 今表示しているページ（保存とブックマークの判定に使う）。まだ開いていなければ空。 */
      url: string
    }
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

function browserTab(url: string, title = ''): Tab {
  return { kind: 'browser', sessionId: `browser:${crypto.randomUUID()}`, title: title || url, initialUrl: url, url }
}

/** 保存しておいたタブを、開き直すタブにする。 */
function tabFromRestored(restored: RestoredTab, untitled: string): Tab {
  if (restored.kind === 'file') return fileTab(restored.relPath)
  if (restored.kind === 'browser') return browserTab(restored.url, restored.title)
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
function savedFromTab(tab: Tab, pane: SavedPane | undefined): SavedTab[] {
  switch (tab.kind) {
    case 'file':
      return [{ kind: 'file', relPath: tab.relPath, pane }]
    case 'browser':
      return tab.url ? [{ kind: 'browser', url: tab.url, title: tab.title, pane }] : []
    case 'session':
      return [{ kind: 'record', fileName: `${tab.snapshotId}.json`, pane }]
    case 'history': {
      if (!tab.agentOnly) {
        const fileName = tab.recordFileName ?? `${tab.snapshot.sessionId}.json`
        return [{ kind: 'record', fileName, pane }]
      }
      const { sessionId: key, acpSessionId, title, savedAt } = tab.snapshot
      return acpSessionId ? [{ kind: 'agentOnly', key, acpSessionId, title, savedAt, pane }] : []
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
  /** 開いているタブ（並びは開いた順。タブバーの表示順はペインが持つ）。 */
  const [tabs, setTabs] = useState<Tab[]>([])
  /**
   * 分割ビューのペインと、各ペインのタブの並び・前面のタブ。閉じたタブが残っていたり、開いたばかりのタブが
   * まだ入っていなかったりするので、使うときは `normalizeLayout` を通す（`updateLayout`）。
   */
  const [layoutState, setLayout] = useState<PaneLayout>(initialLayout)
  /**
   * タブの中身を描く順（開いた順）。タブを並べ替えても中身の DOM を動かさない
   * （動かすと iframe が読み直しになる）よう、表示順とは別に持つ。
   */
  const mountOrderRef = useRef<string[]>([])
  /** 前回のタブを並べ終えたら true。それまではタブの控えを保存しない。 */
  const tabsRestoredRef = useRef(false)
  /** 最後に保存したタブの控え（JSON）。同じなら保存し直さない。 */
  const lastSavedTabsRef = useRef<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openPanels, setOpenPanels] = useState<Set<SidebarPanel>>(new Set(['tabs']))
  const [commandsOpen, setCommandsOpen] = useState(false)
  /** 前面のペインの前面のタブの中身の要素。ページ内検索の対象。 */
  const [activePaneEl, setActivePaneEl] = useState<HTMLDivElement | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  /** 認証画面でログインを確かめられたときにすること（新しいチャットを開く、など）。 */
  const authConfirmedRef = useRef<() => void>(() => {})
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [lastOpenedFilePath, setLastOpenedFilePath] = useState<string | null>(null)
  /** ウィンドウを開いたときに尋ねる ACP アダプタの更新。答えるまで最初のタブは開かない。 */
  const [acpUpdateOffer, setAcpUpdateOffer] = useState<AcpUpdateOffer | null>(null)
  /** このプロジェクトのブラウザのブックマーク。 */
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  /** ブックマークの追加・編集ダイアログ。`id` があれば編集。 */
  const [bookmarkDraft, setBookmarkDraft] = useState<{ id?: string; title: string; url: string } | null>(null)
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

  const tabIds = tabs.map((tab) => tab.sessionId)
  const layout = normalizeLayout(layoutState, tabIds)
  /** 前面のペインの前面のタブ。 */
  const activeSessionId = focusedTabId(layout)
  const tabIdsRef = useRef(tabIds)
  tabIdsRef.current = tabIds

  /** 今のタブの一覧に合わせて整えたレイアウトに、操作を当てる。 */
  function updateLayout(op: (current: PaneLayout) => PaneLayout): void {
    setLayout((prev) => op(normalizeLayout(prev, tabIdsRef.current)))
  }

  /** タブを前面に出す（そのペインが前面になる）。どのペインにも無ければ `paneId`（省略時は前面のペイン）に足す。 */
  function activate(tabId: string, paneId?: string): void {
    updateLayout((current) => activateTab(current, tabId, paneId))
  }

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

  /**
   * 接続中タブをすぐに出してから接続する。接続できたらその場でセッションタブに差し替える。
   * `paneId` のペイン（省略時は前面のペイン）に開く。
   */
  function openNewTab(paneId?: string): void {
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
    activate(id, paneId)
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
      updateLayout((current) => replaceTabId(current, id, sessionId))
    } catch (err) {
      if (abandonedConnectingIdsRef.current.delete(id)) return
      const message = err instanceof Error ? err.message : String(err)
      // 接続前の確認で未ログインと分かったとき・接続時の認証エラーのときは認証画面を出す。
      if (isAuthRequiredMessage(message)) {
        removeConnectingTab(id)
        openAuthDialog(() => openNewTab())
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
    updateLayout((current) => removeTab(current, id))
    setTabs((prev) => prev.filter((tab) => tab.sessionId !== id))
  }

  // StrictMode の二重発火でセッションが2つ開かないよう、ref で一度だけに絞る。
  // 前回開いていたタブを並べてから、新しいチャットを前面のペインの右端に開く。
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
   * 前回開いていたタブを、保存しておいたペインの構成・幅・前面のタブのとおりに並べ直す。並べたタブを返す。
   * 以前の形式でチャットの右に添えていたファイルは、チャットと同じペインのすぐ右に開く。
   */
  async function restoreTabs(id: string): Promise<Tab[]> {
    const restored = await window.shovel.tabs.restore(id).catch(() => [])
    const restoredTabs: Tab[] = []
    const panes = new Map<string, SavedPane>()
    // 同じタブが重複して保存されていたら、最初の1つだけを開く。
    const seen = new Set<string>()
    const push = (tab: Tab, pane: SavedPane | undefined): boolean => {
      if (seen.has(tab.sessionId)) return false
      seen.add(tab.sessionId)
      restoredTabs.push(tab)
      if (pane) panes.set(tab.sessionId, pane)
      return true
    }
    for (const r of restored) {
      const tab = tabFromRestored(r, t('history.untitled'))
      const legacyAttached = r.kind === 'history' ? r.attachedFile : undefined
      if (push(tab, r.pane) && legacyAttached) {
        push(fileTab(legacyAttached), r.pane ? { index: r.pane.index, weight: r.pane.weight } : undefined)
      }
    }
    tabsRestoredRef.current = true
    // 並べ終える前にファイラーなどから開いたタブは、前面のペインの右端に残す。
    setTabs((prev) => [
      ...restoredTabs.filter((tab) => !prev.some((p) => p.sessionId === tab.sessionId)),
      ...prev
    ])
    setLayout(layoutFromSaved(restoredTabs.map((tab) => tab.sessionId), panes))
    return restoredTabs
  }

  // タブの構成・並び・ペインが変わったら控えを保存する。タブはペインの左から順に並べる。
  useEffect(() => {
    if (!projectId || !tabsRestoredRef.current) return
    const panes = savedPanesOf(layout)
    const byId = new Map(tabs.map((tab) => [tab.sessionId, tab]))
    const saved = layout.panes
      .flatMap((pane) => pane.tabIds)
      .flatMap((tabId) => {
        const tab = byId.get(tabId)
        return tab ? savedFromTab(tab, panes.get(tabId)) : []
      })
    const json = JSON.stringify(saved)
    if (json === lastSavedTabsRef.current) return
    lastSavedTabsRef.current = json
    void window.shovel.tabs.save(projectId, saved).catch(() => {})
  }, [projectId, tabs, layout])

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

  /**
   * ファイルを前面のペインに開く。既にどこかのペインで開いていれば、そのペインのタブを前面に出す。
   * `at` があれば、開いた後にその位置（中身検索の一致箇所）へ移る。
   */
  function openFile(relPath: string, at?: Omit<FileReveal, 'nonce'>): void {
    setLastOpenedFilePath(relPath)
    // 位置なしで開き直したときに、前の移り先へまた飛ばないよう消しておく。
    setReveal(at ? { ...at, relPath, nonce: ++revealNonceRef.current } : null)
    const id = `file:${relPath}`
    // 重複判定は updater の中で行う。
    setTabs((prev) => (prev.some((tab) => tab.sessionId === id) ? prev : [...prev, fileTab(relPath)]))
    activate(id)
  }

  /** ブラウザのタブを開いて前面に出す。`url` が無ければ空のページで開く。 */
  function openBrowserTab(url = ''): void {
    const tab = browserTab(url, url ? undefined : t('browser.newTabTitle'))
    setTabs((prev) => [...prev, tab])
    activate(tab.sessionId)
  }

  // ページが新しいウィンドウを開こうとしたら、新しいブラウザのタブで開く。
  const openBrowserTabRef = useRef(openBrowserTab)
  openBrowserTabRef.current = openBrowserTab
  useEffect(() => window.shovel.browser.onOpenUrl((url) => openBrowserTabRef.current(url)), [])

  function updateBrowserTab(id: string, patch: { url?: string; title?: string }): void {
    setTabs((prev) =>
      prev.map((tab) => {
        if (tab.sessionId !== id || tab.kind !== 'browser') return tab
        const next = { ...tab, ...patch }
        return next.url === tab.url && next.title === tab.title ? tab : next
      })
    )
  }

  useEffect(() => {
    if (projectId) void window.shovel.bookmarks.list(projectId).then(setBookmarks).catch(() => {})
  }, [projectId])

  function saveBookmarks(next: Bookmark[]): void {
    setBookmarks(next)
    if (projectId) void window.shovel.bookmarks.save(projectId, next).then(setBookmarks).catch(() => {})
  }

  /** ブラウザのツールバーの ☆。今のページがブックマークにあれば外し、無ければ足す。 */
  function toggleBookmark(url: string, title: string): void {
    if (bookmarks.some((b) => b.url === url)) saveBookmarks(bookmarks.filter((b) => b.url !== url))
    else saveBookmarks([...bookmarks, { id: crypto.randomUUID(), title, url }])
  }

  /** ブックマークの追加ダイアログ。前面がブラウザのタブなら、そのページで埋めておく。 */
  function openAddBookmark(): void {
    const active = tabs.find((tab) => tab.sessionId === activeSessionId)
    setBookmarkDraft(active?.kind === 'browser' && active.url ? { title: active.title, url: active.url } : { title: '', url: '' })
  }

  function commitBookmark(title: string, url: string): void {
    const id = bookmarkDraft?.id
    saveBookmarks(
      id
        ? bookmarks.map((b) => (b.id === id ? { ...b, title, url } : b))
        : [...bookmarks, { id: crypto.randomUUID(), title, url }]
    )
    setBookmarkDraft(null)
  }

  /**
   * ファイラーの「コンテキストに追加」。前面のペインの前面のタブがセッションならそこへ、そうでなければ
   * 表示中の（各ペインの前面の）セッションのうち最も左のものへ渡す。
   */
  function addToContext(relPath: string): void {
    const candidates = [activeSessionId, ...layout.panes.map((pane) => pane.activeTabId)]
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
    activate(id)
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
        activate(openId)
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
    activate(id)
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
    updateLayout((current) => activateTab(replaceTabId(current, `history:${snapshot.sessionId}`, sessionId), sessionId))
  }

  // mermaid をウィンドウが開いた後の空き時間に読み込んでおく。
  useEffect(() => preloadMermaid(), [])

  useEffect(() => {
    void window.shovel.sidebar.getWidths().then((widths) => {
      if (widths.commandsHeight) setCommandsHeight(widths.commandsHeight)
    })
  }, [])

  /** タブのあるペインを半分に分け、そのタブを右の新しいペインへ移す。 */
  function splitTabRight(id: string): void {
    updateLayout((current) => splitRight(current, id))
  }

  async function closeTab(id: string): Promise<void> {
    const tab = tabs.find((t) => t.sessionId === id)
    if (tab?.kind === 'session') {
      await window.shovel.session.closeTab(id)
      discardSessionEvents(id)
    }
    // 接続の途中なら、接続が終わったところで後始末する（失敗済みなら何も残っていない）。
    if (tab?.kind === 'connecting' && !tab.error) abandonedConnectingIdsRef.current.add(id)
    updateLayout((current) => removeTab(current, id))
    setTabs((prev) => prev.filter((t) => t.sessionId !== id))
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
    const closing = tabs.filter((tab) => !remains(tab)).map((tab) => tab.sessionId)
    if (closing.length === 0) return
    updateLayout((current) => closing.reduce(removeTab, current))
    setTabs((prev) => prev.filter(remains))
  }

  /**
   * `pane` のファイルのタブをまとめて閉じる（チャット・履歴のタブと、他のペインのタブは残す）。`keepId` を
   * 渡すとそのタブは残して前面に出す。ファイルのタブは main 側に後始末がないので、`closeTab` を経由しない。
   */
  function closeFileTabs(pane: Pane, keepId: string | null): void {
    const closing = tabs
      .filter((tab) => tab.kind === 'file' && tab.sessionId !== keepId && pane.tabIds.includes(tab.sessionId))
      .map((tab) => tab.sessionId)
    updateLayout((current) => {
      const next = closing.reduce(removeTab, current)
      return keepId ? activateTab(next, keepId) : next
    })
    setTabs((prev) => prev.filter((tab) => !closing.includes(tab.sessionId)))
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

  /** タブバーでドラッグしたタブを、`toPaneId` のペインの `beforeId` のタブの左（`null` なら右端）へ動かす。 */
  function moveTab(id: string, toPaneId: string, beforeId: string | null): void {
    updateLayout((current) => moveTabInLayout(current, id, toPaneId, beforeId))
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

  useTabSwitchShortcuts(focusedPane(layout).tabIds, activeSessionId, activate)

  if (!projectId) {
    return <div className="p-4 text-sm text-muted-foreground">{t('mainWindow.noProject')}</div>
  }

  const tabsById = new Map(tabs.map((tab) => [tab.sessionId, tab]))
  const panes = layout.panes
  /** ペインの最小幅。前面のタブがチャットならチャットの最小幅。 */
  const paneMinWidth = (pane: Pane): number => {
    const tab = pane.activeTabId ? tabsById.get(pane.activeTabId) : undefined
    return tab && isChatTab(tab) ? CHAT_PANE_MIN_WIDTH : PANE_MIN_WIDTH
  }
  const gridColumns = (weights: number[]): string =>
    panes.flatMap((pane, i) => [`minmax(${paneMinWidth(pane)}px, ${weights[i] ?? 1}fr)`, ...(i < panes.length - 1 ? ['4px'] : [])]).join(' ')

  /**
   * ペインの境目のドラッグ。ドラッグ中は grid の列幅を DOM に直接書き、離したところで比率を保存する
   * （動かすたびにウィンドウ全体を描き直さないため）。
   */
  function startPaneResize(e: React.PointerEvent<HTMLDivElement>, leftIndex: number): void {
    if (e.button !== 0) return
    e.preventDefault()
    const handle = e.currentTarget
    const grid = handle.parentElement
    if (!grid) return
    const bars = panes.map((pane) => grid.querySelector<HTMLElement>(`[data-pane-col="${CSS.escape(pane.id)}"]`))
    if (bars.some((el) => !el)) return
    const widths = bars.map((el) => el!.getBoundingClientRect().width)
    const minWidths = panes.map(paneMinWidth)
    const startX = e.clientX
    handle.setPointerCapture(e.pointerId)
    const current = [...widths]
    const onMove = (ev: PointerEvent): void => {
      const next = resizeAdjacent(
        { width: widths[leftIndex]!, minWidth: minWidths[leftIndex]! },
        { width: widths[leftIndex + 1]!, minWidth: minWidths[leftIndex + 1]! },
        ev.clientX - startX
      )
      current[leftIndex] = next.left
      current[leftIndex + 1] = next.right
      grid.style.gridTemplateColumns = gridColumns(current)
    }
    const onUp = (): void => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
      const weights = Object.fromEntries(panes.map((pane, i) => [pane.id, current[i]!]))
      updateLayout((layoutNow) => setPaneWeights(layoutNow, weights))
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  }

  const tabInfoOf = (tab: Tab): TabInfo => ({
    sessionId: tab.sessionId,
    title: tab.title,
    tooltip: tab.kind === 'file' ? tab.relPath : tab.kind === 'browser' ? tab.url || undefined : undefined,
    kind: tab.kind,
    snapshotId: tab.kind === 'session' ? tab.snapshotId : undefined,
    failed: tab.kind === 'connecting' ? tab.error !== undefined : undefined,
    status: tab.kind === 'session' ? tabStatuses[tab.sessionId] : undefined,
    canSplitRight: canSplitRight(layout, tab.sessionId)
  })
  /** サイドバーのタブ一覧用。ペインの左から順に並べる。 */
  const tabInfos: TabInfo[] = panes.flatMap((pane) => pane.tabIds.flatMap((id) => {
    const tab = tabsById.get(id)
    return tab ? [tabInfoOf(tab)] : []
  }))
  const focusedIndex = panes.findIndex((pane) => pane.id === layout.focusedPaneId)

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
          onSelectTab={(id) => activate(id)}
          onOpenFile={openFile}
          onOpenHistory={(entry) => void openHistoryEntry(entry)}
          onOpenLocalRecord={(record) => void openLocalRecord(record)}
          onRenameTab={renameTab}
          onCloseTab={(id) => void closeTab(id)}
          onRecordsDeleted={closeRecordTabs}
          onAddToContext={addToContext}
          bookmarks={bookmarks}
          onNewBrowserTab={() => openBrowserTab()}
          onOpenBookmark={(bookmark) => openBrowserTab(bookmark.url)}
          onAddBookmark={openAddBookmark}
          onEditBookmark={(bookmark) => setBookmarkDraft({ ...bookmark })}
          onDeleteBookmark={(bookmark) => saveBookmarks(bookmarks.filter((b) => b.id !== bookmark.id))}
        />
        <div className="flex flex-1 flex-col overflow-hidden">
          {error && (
            <div className="flex items-start gap-2 border-b border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span className="flex-1">{error}</span>
            </div>
          )}
          {/*
            1行目に各ペインのタブバー、2行目にタブの中身を置く grid。タブの中身は開いた順に描いたまま、列の指定だけで
            ペインに置く（ペインをまたいで動かしても DOM を動かさないので、iframe・webview が読み直しにならない）。
          */}
          <div
            className="grid min-h-0 flex-1 overflow-x-auto overflow-y-hidden"
            style={{ gridTemplateColumns: gridColumns(panes.map((pane) => pane.weight)), gridTemplateRows: 'auto minmax(0, 1fr)' }}
          >
            {panes.map((pane, i) => (
              <div
                key={pane.id}
                data-pane-col={pane.id}
                className="min-w-0"
                style={{ gridColumn: i * 2 + 1, gridRow: 1 }}
                onPointerDownCapture={() => updateLayout((current) => focusPane(current, pane.id))}
              >
                <TabBar
                  paneId={pane.id}
                  tabs={pane.tabIds.flatMap((id) => {
                    const tab = tabsById.get(id)
                    return tab ? [tabInfoOf(tab)] : []
                  })}
                  activeId={pane.activeTabId}
                  focused={pane.id === layout.focusedPaneId}
                  showFocus={panes.length > 1}
                  onSelect={(id) => activate(id)}
                  onClose={(id) => void closeTab(id)}
                  onCloseFiles={(keepId) => closeFileTabs(pane, keepId)}
                  onMove={moveTab}
                  onSplitRight={splitTabRight}
                  onNew={() => openNewTab(pane.id)}
                  canAddTab={limitedTabCount < MAX_SESSION_TABS}
                />
              </div>
            ))}
            {panes.slice(0, -1).map((pane, i) => (
              <div
                key={`divider:${pane.id}`}
                className="cursor-col-resize bg-border hover:bg-primary/50"
                style={{ gridColumn: i * 2 + 2, gridRow: '1 / 3' }}
                onPointerDown={(e) => startPaneResize(e, i)}
              />
            ))}
            {tabsInMountOrder.map((tab) => {
              const pane = paneOf(layout, tab.sessionId)
              const column = pane ? panes.indexOf(pane) : -1
              const visible = !!pane && pane.activeTabId === tab.sessionId
              const inFocusedPane = pane?.id === layout.focusedPaneId
              return (
                <div
                  key={tab.sessionId}
                  ref={visible && inFocusedPane ? setActivePaneEl : undefined}
                  className={visible ? 'flex min-h-0 min-w-0 flex-col overflow-hidden' : 'hidden'}
                  style={visible ? { gridColumn: column * 2 + 1, gridRow: 2 } : undefined}
                  onPointerDownCapture={
                    visible && !inFocusedPane ? () => updateLayout((current) => focusPane(current, pane.id)) : undefined
                  }
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
                      onStartNew={() => openNewTab(pane?.id)}
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
                  ) : tab.kind === 'browser' ? (
                    <BrowserView
                      initialUrl={tab.initialUrl}
                      bookmarked={!!tab.url && bookmarks.some((b) => b.url === tab.url)}
                      onNavigate={(url) => updateBrowserTab(tab.sessionId, { url })}
                      onTitleChange={(title) => updateBrowserTab(tab.sessionId, { title })}
                      onToggleBookmark={toggleBookmark}
                      onFocus={() => activate(tab.sessionId)}
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
            {tabs.length === 0 && !error && (
              <div
                className="flex items-center justify-center text-sm text-muted-foreground"
                style={{ gridColumn: 1, gridRow: 2 }}
              >
                {t('mainWindow.connecting')}
              </div>
            )}
            {/* ページ内検索は前面のペインの右上に出す（高さ 0 の枠に絶対配置する）。 */}
            <div className="relative z-40 h-0 self-start" style={{ gridColumn: focusedIndex * 2 + 1, gridRow: 2 }}>
              <FindBar root={activePaneEl} />
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
      <BookmarkDialog
        initial={bookmarkDraft}
        editing={bookmarkDraft?.id !== undefined}
        onSave={commitBookmark}
        onCancel={() => setBookmarkDraft(null)}
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
