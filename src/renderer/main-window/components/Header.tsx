import { ChevronDown, FolderPlus, LayoutGrid, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ProjectWithStatus, SandboxStatus } from '@shared/types/project'
import { AppLogo } from '../../shared/components/AppLogo'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '../../shared/components/ui/dropdown-menu'

const STATUS_DOT_CLASSES: Record<SandboxStatus, string> = {
  running: 'bg-green-500',
  stopped: 'bg-muted-foreground',
  missing: 'bg-destructive',
  workspace_missing: 'bg-destructive'
}

const MAX_RECENT = 5

/** ui.md §3 Header / decisions.md G-1-6: 「プロジェクト名▾」の軽い切り替え。 */
export function Header({
  displayName,
  status,
  currentProjectId,
  recentProjects,
  onOpenSettings
}: {
  displayName: string
  status: SandboxStatus | null
  currentProjectId: string | null
  recentProjects: ProjectWithStatus[]
  onOpenSettings: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const recent = recentProjects
    .filter((p) => p.id !== currentProjectId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_RECENT)

  return (
    <header className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-card px-3">
      <div className="flex min-w-0 items-center gap-2">
        <AppLogo size={20} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex min-w-0 items-center gap-1 rounded px-1.5 py-1 text-sm font-medium hover:bg-accent">
              <span className="truncate">{displayName}</span>
              <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            {recent.length > 0 && (
              <>
                <DropdownMenuLabel>{t('header.recentProjects')}</DropdownMenuLabel>
                {recent.map((p) => (
                  <DropdownMenuItem key={p.id} onClick={() => void window.shovel.projects.open(p.id)}>
                    <span
                      className={`mr-2 h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT_CLASSES[p.status]}`}
                    />
                    <span className="truncate">{p.displayName}</span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onClick={() => void window.shovel.app.openProjectManager()}>
              <FolderPlus size={14} className="mr-2 shrink-0" />
              {t('header.newProject')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void window.shovel.app.openProjectManager()}>
              <LayoutGrid size={14} className="mr-2 shrink-0" />
              {t('header.allProjects')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex items-center gap-3">
        {status && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`h-2 w-2 rounded-full ${STATUS_DOT_CLASSES[status]}`} />
            {t(`projectManager.status.${status}`)}
          </div>
        )}
        <button
          className="text-muted-foreground hover:text-foreground"
          onClick={onOpenSettings}
          title={t('settings.title')}
        >
          <Settings size={16} />
        </button>
      </div>
    </header>
  )
}
