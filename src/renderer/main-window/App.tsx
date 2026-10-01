import { useEffect, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ProjectWithStatus } from '@shared/types/project'
import type { HistoryEntry, LocalRecordSummary, SessionMeta, SessionSnapshot } from '@shared/types/session'
import { Header } from './components/Header'
import { Sidebar, type SidebarPanel } from './components/Sidebar'
import { TabBar, type TabInfo } from './components/TabBar'
import { SessionView } from './components/SessionView'
import { FileViewer } from './components/FileViewer'
import { MarkdownEditor } from './components/MarkdownEditor'
import { Commands } from './components/Commands'
import { HistoryView, type ReadOnlyKind } from './components/HistoryView'
import { useSettings } from '../shared/useSettings'
import { SettingsDialog } from '../shared/components/SettingsDialog'
import { AuthDialog } from './components/AuthDialog'
import { AttachTargetDialog } from './components/AttachTargetDialog'
import { ProjectDetailDialog } from '../shared/components/ProjectDetailDialog'
import { preloadMermaid } from '../shared/lib/mermaid'
import { isAuthRequiredMessage } from '@shared/authMarker'
import { useTabSwitchShortcuts } from './useTabShortcuts'
import { addAttachmentToSession } from './attachmentRegistry'
import { discardSessionEvents } from './sessionEvents'
import { ResizablePanel } from './components/ResizablePanel'
import { cn } from '../shared/lib/utils'
import { friendlyErrorMessage } from '../shared/friendlyError'

const MAX_SESSION_TABS = 10
/** チャットの右に添えた Markdown ペインの既定幅（px）。 */
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
       * このチャットタブの右に添えた Markdown。添えている間はタブバーに出さず、タブ数にも数えない。
       * チャットタブを閉じると一緒に閉じる。
       */
      attachedMarkdown?: string
    }
  | { kind: 'file'; sessionId: string; title: string; relPath: string; isMarkdown: boolean }
  | {
      kind: 'history'
      sessionId: string
      title: string
      snapshot: SessionSnapshot
      /** バックアップ／削除済みを開いた Read Only タブ。 */
      readOnlyKind?: ReadOnlyKind
      recordTimestamp?: number
      /** `session/list` にだけあってローカル記録が無い行。`snapshot` は中身の無い仮のもの。 */
      agentOnly?: boolean
      /** 右に添えた Markdown。再開後も引き継ぐ。 */
      attachedMarkdown?: string
    }

type ChatTab = Extract<Tab, { kind: 'session' | 'history' }>

/** 「チャットの横に表示」の添え先になれるタブ。再開していない履歴タブも含む。 */
function isChatTab(tab: Tab): tab is ChatTab {
  return tab.kind === 'session' || tab.kind === 'history'
}

/** タブ数の上限に数えるタブ。 */
function countsTowardTabLimit(tab: Tab): boolean {
  return tab.kind === 'session' || (tab.kind === 'history' && tab.readOnlyKind !== undefined)
}

function getProjectIdFromQuery(): string | null {
  return new URLSearchParams(window.location.search).get('projectId')
}

export function App(): React.JSX.Element {
  const { t } = useTranslation()
  const [projectId] = useState(getProjectIdFromQuery)
  const [allProjects, setAllProjects] = useState<ProjectWithStatus[]>([])
  const [project, setProject] = useState<ProjectWithStatus | null>(null)
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openPanels, setOpenPanels] = useState<Set<SidebarPanel>>(new Set(['tabs']))
  const [commandsOpen, setCommandsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [lastOpenedFilePath, setLastOpenedFilePath] = useState<string | null>(null)
  /** 添え先が1つに決まらなかったときに、どのチャットに添えるかを選ばせる対象ファイル。 */
  const [attachPickerPath, setAttachPickerPath] = useState<string | null>(null)
  const [attachedWidth, setAttachedWidth] = useState(ATTACHED_DEFAULT_WIDTH)
  const [commandsHeight, setCommandsHeight] = useState(COMMANDS_DEFAULT_HEIGHT)
  const [tabStatuses, setTabStatuses] = useState<
    Record<string, { sending: boolean; hasPendingPermission: boolean }>
  >({})
  const { settings, update: updateSettings } = useSettings()

  useEffect(() => {
    if (!projectId) return
    void window.shovel.projects.list().then((projects) => {
      setAllProjects(projects)
      setProject(projects.find((p) => p.id === projectId) ?? null)
    })
  }, [projectId])

  const sessionTabCount = tabs.filter((tab) => tab.kind === 'session').length
  const limitedTabCount = tabs.filter(countsTowardTabLimit).length

  async function openNewTab(): Promise<void> {
    if (!projectId || limitedTabCount >= MAX_SESSION_TABS) return
    setError(null)

    try {
      // 接続前に認証状態を確認し、未ログインなら認証画面を出す。
      const status = await window.shovel.auth.status(projectId)
      if (!status.checkFailed && !status.loggedIn) {
        setAuthOpen(true)
        return
      }

      const { sessionId, snapshotId, meta } = await window.shovel.session.openTab(projectId)
      // 自動添付が有効なら、最後に開いていたファイルを初期チップにする。
      const initialAttachments = settings?.autoAttachActiveFile && lastOpenedFilePath ? [lastOpenedFilePath] : []
      setTabs((prev) => [
        ...prev,
        {
          kind: 'session',
          sessionId,
          snapshotId,
          title: t('mainWindow.newChatTitle', { count: sessionTabCount + 1 }),
          meta,
          initialAttachments
        }
      ])
      setActiveSessionId(sessionId)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // 接続時の認証エラーでも認証画面を出す。
      if (isAuthRequiredMessage(message)) {
        setAuthOpen(true)
        return
      }
      setError(friendlyErrorMessage(message, t))
    }
  }

  // StrictMode の二重発火でセッションが2つ開かないよう、ref で一度だけに絞る。
  const didOpenInitialTabRef = useRef(false)
  useEffect(() => {
    if (projectId && !didOpenInitialTabRef.current) {
      didOpenInitialTabRef.current = true
      void openNewTab()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  function openFile(relPath: string, isMarkdown: boolean): void {
    setLastOpenedFilePath(relPath)
    // チャットの横に添えてあるなら、そのチャットタブを前に出す。
    const holder = tabs.find((tab) => isChatTab(tab) && tab.attachedMarkdown === relPath)
    if (holder) {
      setActiveSessionId(holder.sessionId)
      return
    }
    const id = `file:${relPath}`
    // 重複判定は updater の中で行う。
    setTabs((prev) =>
      prev.some((tab) => tab.sessionId === id)
        ? prev
        : [...prev, { kind: 'file', sessionId: id, title: relPath.split('/').pop() ?? relPath, relPath, isMarkdown }]
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
          recordTimestamp: record.timestamp
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
              attachedMarkdown: tab.kind === 'history' ? tab.attachedMarkdown : undefined
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
      if (widths.attachedMarkdown) setAttachedWidth(widths.attachedMarkdown)
      if (widths.commandsHeight) setCommandsHeight(widths.commandsHeight)
    })
  }, [])

  const chatTabs = tabs.filter(isChatTab)
  const canAttachMarkdown = chatTabs.length > 0

  /**
   * Markdown をチャットタブの右に添える。添え先は、今のタブがチャットならそれ、
   * チャットが1つしか無ければそれ。決まらなければ添え先を選ばせる。
   */
  function attachMarkdown(relPath: string): void {
    const active = tabs.find((tab) => tab.sessionId === activeSessionId)
    const target = active && isChatTab(active) ? active : chatTabs.length === 1 ? chatTabs[0] : undefined
    if (target) attachMarkdownTo(target.sessionId, relPath)
    else if (chatTabs.length > 1) setAttachPickerPath(relPath)
  }

  /** 同じファイルの独立したタブがあれば閉じ、既に別の Markdown を添えていれば置き換える。 */
  function attachMarkdownTo(targetId: string, relPath: string): void {
    setTabs((prev) =>
      prev
        .filter((tab) => tab.sessionId !== `file:${relPath}`)
        .map((tab) => (tab.sessionId === targetId && isChatTab(tab) ? { ...tab, attachedMarkdown: relPath } : tab))
    )
    setActiveSessionId(targetId)
  }

  function detachMarkdown(sessionId: string): void {
    setTabs((prev) =>
      prev.map((tab) => (tab.sessionId === sessionId && isChatTab(tab) ? { ...tab, attachedMarkdown: undefined } : tab))
    )
  }

  /**
   * Cmd/Ctrl+数字で選んだタブだけを表示する。チャットの横に Markdown を添えていれば分割を解除し、
   * Markdown はチャットのすぐ右の独立したタブに戻す。
   */
  function selectTabExclusively(id: string): void {
    setTabs((prev) => {
      const index = prev.findIndex((tab) => tab.sessionId === id)
      const tab = prev[index]
      if (!tab || !isChatTab(tab) || !tab.attachedMarkdown) return prev
      const relPath = tab.attachedMarkdown
      const next = [...prev]
      next[index] = { ...tab, attachedMarkdown: undefined }
      if (!next.some((t) => t.sessionId === `file:${relPath}`)) {
        next.splice(index + 1, 0, {
          kind: 'file',
          sessionId: `file:${relPath}`,
          title: relPath.split('/').pop() ?? relPath,
          relPath,
          isMarkdown: true
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
  useTabSwitchShortcuts(tabIds, selectTabExclusively)

  if (!projectId) {
    return <div className="p-4 text-sm text-muted-foreground">{t('mainWindow.noProject')}</div>
  }

  const tabInfos: TabInfo[] = tabs.map((tab) => ({
    sessionId: tab.sessionId,
    title: tab.title,
    kind: tab.kind,
    snapshotId: tab.kind === 'session' ? tab.snapshotId : undefined,
    status: tab.kind === 'session' ? tabStatuses[tab.sessionId] : undefined
  }))
  const activeTab = tabs.find((tab) => tab.sessionId === activeSessionId) ?? null

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
          onAttachMarkdown={attachMarkdown}
          canAttachMarkdown={canAttachMarkdown}
        />
        <div className="flex flex-1 flex-col overflow-hidden">
          <TabBar
            tabs={tabInfos}
            activeSessionId={activeSessionId}
            onSelect={setActiveSessionId}
            onClose={(id) => void closeTab(id)}
            onNew={() => void openNewTab()}
            canAddTab={limitedTabCount < MAX_SESSION_TABS}
          />
          {error && (
            <div className="flex items-start gap-2 border-b border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span className="flex-1">{error}</span>
              {error !== t('mainWindow.tabLimitReached') && (
                <button className="shrink-0 font-medium hover:underline" onClick={() => void openNewTab()}>
                  {t('common.retry')}
                </button>
              )}
            </div>
          )}
          <div className="flex flex-1 flex-col overflow-hidden">
            {tabs.map((tab) => (
              <div
                key={tab.sessionId}
                className={
                  tab.sessionId === activeTab?.sessionId ? 'flex flex-1 flex-col overflow-hidden' : 'hidden'
                }
              >
                {isChatTab(tab) ? (
                  <div className="flex flex-1 overflow-hidden">
                    {/* チャットの最小幅を保ち、足りなければ Markdown 側が縮む。 */}
                    <div className={cn('flex flex-1 flex-col overflow-hidden', tab.attachedMarkdown ? 'min-w-[320px]' : 'min-w-0')}>
                      {tab.kind === 'session' ? (
                        <SessionView
                          sessionId={tab.sessionId}
                          initialMeta={tab.meta}
                          initialAttachments={tab.initialAttachments}
                          sendKey={settings?.sendKey ?? 'enter'}
                          onOpenFile={(relPath) => openFile(relPath, relPath.toLowerCase().endsWith('.md'))}
                          onStatusChange={(status) => updateTabStatus(tab.sessionId, status)}
                          onRefreshed={(snapshotId) => handleRefreshed(tab.sessionId, snapshotId)}
                        />
                      ) : (
                        <HistoryView
                          snapshot={tab.snapshot}
                          readOnlyKind={tab.readOnlyKind}
                          recordTimestamp={tab.recordTimestamp}
                          agentOnly={tab.agentOnly}
                          onResume={() => resumeHistory(tab.snapshot, tab.agentOnly)}
                          onStartNew={() => void openNewTab()}
                          onOpenFile={(relPath) => openFile(relPath, relPath.toLowerCase().endsWith('.md'))}
                        />
                      )}
                    </div>
                    {tab.attachedMarkdown && (
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
                        <MarkdownEditor
                          key={tab.attachedMarkdown}
                          projectId={projectId}
                          relPath={tab.attachedMarkdown}
                          variant="attached"
                          onClose={() => detachMarkdown(tab.sessionId)}
                        />
                      </ResizablePanel>
                    )}
                  </div>
                ) : tab.isMarkdown ? (
                  <MarkdownEditor
                    projectId={projectId}
                    relPath={tab.relPath}
                    canAttachToChat={canAttachMarkdown}
                    onAttachToChat={() => attachMarkdown(tab.relPath)}
                  />
                ) : (
                  <FileViewer projectId={projectId} relPath={tab.relPath} />
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
      <AttachTargetDialog
        relPath={attachPickerPath}
        chatTabs={chatTabs}
        onPick={(targetId) => {
          if (attachPickerPath) attachMarkdownTo(targetId, attachPickerPath)
          setAttachPickerPath(null)
        }}
        onCancel={() => setAttachPickerPath(null)}
      />
      <AuthDialog
        open={authOpen}
        onOpenChange={setAuthOpen}
        projectId={projectId}
        onConfirmed={() => void openNewTab()}
      />
    </div>
  )
}
