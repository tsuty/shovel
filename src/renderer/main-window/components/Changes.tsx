import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChangedFile, ChangesSummary } from '@shared/types/changes'
import { Button } from '../../shared/components/ui/button'
import { UnifiedDiffView } from '../../shared/components/DiffView'
import { cn } from '../../shared/lib/utils'

const STATUS_MARK: Record<ChangedFile['status'], string> = { modified: 'M', added: '+', deleted: 'D' }

/**
 * ui.md §11 / decisions.md A-3-7, N-3-7: 「変更」サイドバー。
 * git の語彙を UI に出さない。非 git プロジェクトでは一覧のみ出し、
 * 「戻す」ボタンは出さない。
 */
export function Changes({ projectId }: { projectId: string }): React.JSX.Element {
  const { t } = useTranslation()
  const [summary, setSummary] = useState<ChangesSummary | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [diff, setDiff] = useState<string | null>(null)
  const [confirmAll, setConfirmAll] = useState(false)

  async function refresh(): Promise<void> {
    setSummary(await window.shovel.changes.list(projectId))
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  useEffect(() => {
    if (!selected) {
      setDiff(null)
      return
    }
    void window.shovel.changes.diff(projectId, selected).then(setDiff)
  }, [projectId, selected])

  async function restoreOne(relPath: string): Promise<void> {
    await window.shovel.changes.restoreOne(projectId, relPath)
    if (selected === relPath) setSelected(null)
    await refresh()
  }

  async function restoreAll(): Promise<void> {
    setConfirmAll(false)
    await window.shovel.changes.restoreAll(projectId)
    setSelected(null)
    await refresh()
  }

  if (!summary) return <div className="p-3 text-sm text-muted-foreground">{t('common.loading')}</div>

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-2 py-1.5 text-xs">
        <span className="font-medium text-muted-foreground">
          {t('sidebar.changes')} {summary.files.length > 0 && `(${summary.files.length})`}
        </span>
        {summary.gitAvailable && summary.files.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => setConfirmAll(true)}>
            {t('changes.restoreAll')}
          </Button>
        )}
      </div>

      {summary.files.length === 0 && (
        <p className="p-3 text-sm text-muted-foreground">{t('changes.empty')}</p>
      )}

      <ul className="flex-1 overflow-y-auto">
        {summary.files.map((file) => (
          <li key={file.relPath}>
            <div
              className={cn(
                'flex items-center gap-2 px-2 py-1 text-sm hover:bg-accent',
                selected === file.relPath && 'bg-accent'
              )}
            >
              <button className="flex flex-1 items-center gap-2 truncate text-left" onClick={() => setSelected(file.relPath)}>
                <span className="w-3 shrink-0 font-mono text-xs text-muted-foreground">
                  {STATUS_MARK[file.status]}
                </span>
                <span className="truncate">{file.relPath}</span>
              </button>
              {summary.gitAvailable && (
                <button
                  className="text-xs text-muted-foreground hover:underline"
                  onClick={() => void restoreOne(file.relPath)}
                >
                  {t('changes.restore')}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {selected && diff !== null && (
        <div className="flex h-1/2 shrink-0 flex-col border-t border-border">
          <div className="truncate border-b border-border px-2 py-1 text-xs text-muted-foreground" title={selected}>
            {selected}
          </div>
          <UnifiedDiffView diff={diff} className="min-h-0 flex-1 py-1" />
        </div>
      )}

      {confirmAll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-96 rounded-lg border bg-card p-4">
            <p className="mb-2 text-sm font-medium">{t('changes.confirmRestoreAll')}</p>
            <ul className="mb-3 max-h-40 overflow-y-auto text-xs text-muted-foreground">
              {summary.files.map((f) => (
                <li key={f.relPath}>{f.relPath}</li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setConfirmAll(false)}>
                {t('common.cancel')}
              </Button>
              <Button variant="destructive" size="sm" onClick={() => void restoreAll()}>
                {t('changes.restoreAll')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
