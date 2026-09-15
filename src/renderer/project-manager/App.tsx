import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderPlus, Settings } from 'lucide-react'
import type { ProjectWithStatus, SandboxStatus } from '@shared/types/project'
import { Button } from '../shared/components/ui/button'
import { Badge } from '../shared/components/ui/badge'
import { CreateProjectDialog } from './CreateProjectDialog'
import { ProjectDetailDialog } from './ProjectDetailDialog'
import { useSettings } from '../shared/useSettings'
import { SettingsDialog } from '../shared/components/SettingsDialog'
import { AppLogo } from '../shared/components/AppLogo'
import { cn } from '../shared/lib/utils'

export function App(): React.JSX.Element {
  const { t } = useTranslation()
  const [projects, setProjects] = useState<ProjectWithStatus[] | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const { settings, update: updateSettings } = useSettings()

  const refresh = useCallback(() => {
    void window.shovel.projects.list().then(setProjects)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function open(id: string): Promise<void> {
    await window.shovel.projects.open(id)
  }

  async function remove(id: string): Promise<void> {
    const trash = confirm(t('projectManager.confirmRemove'))
    await window.shovel.projects.remove(id, trash)
    refresh()
  }

  async function commitRename(id: string): Promise<void> {
    if (renameValue.trim()) {
      await window.shovel.projects.rename(id, renameValue.trim())
    }
    setRenamingId(null)
    refresh()
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-border bg-card px-6 py-3.5">
        <div className="flex items-center gap-2.5">
          <AppLogo />
          <h1 className="text-base font-semibold tracking-tight">{t('projectManager.title')}</h1>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={() => setCreateOpen(true)}>
            <FolderPlus size={16} />
            {t('projectManager.newProject')}
          </Button>
          <button
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setSettingsOpen(true)}
            title={t('settings.title')}
          >
            <Settings size={18} />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        {projects === null && <p className="text-sm text-muted-foreground">{t('common.loading')}</p>}
        {projects?.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
              <FolderPlus size={28} className="text-muted-foreground" />
            </div>
            <p className="text-muted-foreground">{t('projectManager.empty')}</p>
            <Button size="lg" onClick={() => setCreateOpen(true)}>
              <FolderPlus size={16} />
              {t('projectManager.newProject')}
            </Button>
          </div>
        )}
        <ul className="mx-auto flex max-w-3xl flex-col gap-2">
          {projects?.map((project) => (
            <li
              key={project.id}
              className="group flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3.5 shadow-sm transition-colors hover:border-primary/30 hover:bg-accent/60"
            >
              <StatusDot status={project.status} />
              <button
                className="flex-1 text-left"
                onDoubleClick={() => void open(project.id)}
                onClick={() => void open(project.id)}
              >
                {renamingId === project.id ? (
                  <input
                    autoFocus
                    className="w-full rounded border border-input bg-transparent px-1 text-sm"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void commitRename(project.id)
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                    onBlur={() => void commitRename(project.id)}
                  />
                ) : (
                  <>
                    <div className="text-sm font-medium">{project.displayName}</div>
                    <div className="truncate text-xs text-muted-foreground">{project.hostPath}</div>
                  </>
                )}
              </button>
              <StatusBadge status={project.status} />
              <div className="hidden gap-1 group-hover:flex">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation()
                    setRenamingId(project.id)
                    setRenameValue(project.displayName)
                  }}
                >
                  {t('common.rename')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void remove(project.id)}>
                  {t('common.delete')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation()
                    setDetailId(project.id)
                  }}
                >
                  {t('detail.title')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </main>

      <CreateProjectDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          setCreateOpen(false)
          refresh()
        }}
      />
      {settings && (
        <SettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          settings={settings}
          onUpdate={(patch) => void updateSettings(patch)}
        />
      )}
      <ProjectDetailDialog
        projectId={detailId}
        open={detailId !== null}
        onOpenChange={(open) => !open && setDetailId(null)}
      />
    </div>
  )
}

// Tailwind の JIT は完全なクラス名文字列でないと拾えないため、
// 動的な文字列結合ではなくルックアップテーブルにする。
const STATUS_DOT_CLASSES: Record<SandboxStatus, string> = {
  running: 'bg-green-500 ring-green-500/15',
  stopped: 'bg-muted-foreground ring-muted-foreground/15',
  missing: 'bg-destructive ring-destructive/15',
  workspace_missing: 'bg-destructive ring-destructive/15'
}

function StatusDot({ status }: { status: SandboxStatus }): React.JSX.Element {
  return <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full ring-4', STATUS_DOT_CLASSES[status])} />
}

function StatusBadge({ status }: { status: SandboxStatus }): React.JSX.Element | null {
  const { t } = useTranslation()
  if (status === 'running' || status === 'stopped') {
    return <Badge variant="secondary">{t(`projectManager.status.${status}`)}</Badge>
  }
  return <Badge variant="destructive">{t(`projectManager.status.${status}`)}</Badge>
}
