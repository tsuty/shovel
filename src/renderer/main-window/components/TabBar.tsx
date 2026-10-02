import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, Clock3, CopyX, File, FileX, Plus, X } from 'lucide-react'
import { cn } from '../../shared/lib/utils'
import { MenuItem } from './MenuItem'

export interface TabInfo {
  sessionId: string
  title: string
  kind: 'session' | 'file' | 'history'
  /**
   * セッションタブがいま書き込んでいるスナップショットの id。↻ で新しい会話を
   * 始めると変わる（タブ id の `sessionId` は変わらない）。
   */
  snapshotId?: string
  /** 背景タブの通知状態。`undefined` はセッション以外のタブ（ファイル/履歴）。 */
  status?: { sending: boolean; hasPendingPermission: boolean }
}

export function TabBar({
  tabs,
  activeSessionId,
  onSelect,
  onClose,
  onCloseFiles,
  onNew,
  canAddTab
}: {
  tabs: TabInfo[]
  activeSessionId: string | null
  onSelect: (sessionId: string) => void
  onClose: (sessionId: string) => void
  /** ファイルのタブをまとめて閉じる（チャット・履歴は残す）。`keepId` のタブだけは残す。 */
  onCloseFiles: (keepId: string | null) => void
  onNew: () => void
  canAddTab: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const [menu, setMenu] = useState<{ x: number; y: number; tab: TabInfo } | null>(null)
  const fileTabCount = tabs.filter((tab) => tab.kind === 'file').length

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('blur', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
      {tabs.map((tab) => {
        const isActive = tab.sessionId === activeSessionId
        // 通知は前面にないタブにだけ出す。
        const showPendingBadge = !isActive && tab.status?.hasPendingPermission
        const showPulse = !isActive && tab.status?.sending
        return (
          <div
            key={tab.sessionId}
            className={cn(
              'relative flex h-7 max-w-40 items-center gap-1.5 rounded-t-md border border-transparent px-2 text-xs',
              isActive
                ? 'border-border border-b-background bg-background text-foreground'
                : 'text-muted-foreground hover:bg-accent'
            )}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu({ x: e.clientX, y: e.clientY, tab })
            }}
          >
            {showPendingBadge && (
              <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-destructive" />
            )}
            <button
              className={cn('flex min-w-0 items-center gap-1.5 truncate', showPulse && 'animate-tab-pulse')}
              onClick={() => onSelect(tab.sessionId)}
            >
              {tab.kind === 'file' && <File size={12} className="shrink-0" />}
              {tab.kind === 'session' && <Bot size={12} className="shrink-0" />}
              {tab.kind === 'history' && <Clock3 size={12} className="shrink-0" />}
              <span className="truncate">{tab.title}</span>
            </button>
            <button
              className="opacity-60 hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation()
                onClose(tab.sessionId)
              }}
            >
              <X size={12} />
            </button>
          </div>
        )
      })}
      <button
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent disabled:opacity-40"
        onClick={onNew}
        disabled={!canAddTab}
      >
        <Plus size={14} />
      </button>
      {menu && (
        <>
          {/* メニューの外のクリック（右クリックも）で閉じる。 */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu(null)
            }}
          />
          <div
            className="fixed z-50 min-w-40 rounded-md border bg-popover p-1 text-sm shadow-md"
            style={{ left: menu.x, top: menu.y }}
          >
            <MenuItem
              icon={<X size={14} />}
              onClick={() => {
                onClose(menu.tab.sessionId)
                setMenu(null)
              }}
            >
              {t('tabBar.close')}
            </MenuItem>
            {/* チャット・履歴のタブでは「すべてのファイルを閉じる」と同じになるので出さない。 */}
            {menu.tab.kind === 'file' && (
              <MenuItem
                icon={<FileX size={14} />}
                disabled={fileTabCount <= 1}
                onClick={() => {
                  onCloseFiles(menu.tab.sessionId)
                  setMenu(null)
                }}
              >
                {t('tabBar.closeOtherFiles')}
              </MenuItem>
            )}
            <MenuItem
              icon={<CopyX size={14} />}
              disabled={fileTabCount === 0}
              onClick={() => {
                onCloseFiles(null)
                setMenu(null)
              }}
            >
              {t('tabBar.closeAllFiles')}
            </MenuItem>
          </div>
        </>
      )}
    </div>
  )
}
