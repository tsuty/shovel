import { Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SandboxStatus } from '@shared/types/project'

export function Header({
  displayName,
  status,
  onOpenSettings
}: {
  displayName: string
  status: SandboxStatus | null
  onOpenSettings: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <header className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3">
      <button
        className="truncate text-sm font-medium hover:underline"
        onClick={() => void window.shovel.app.openProjectManager()}
        title={t('header.allProjects')}
      >
        {displayName}
      </button>
      <div className="flex items-center gap-3">
        {status && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className={`h-2 w-2 rounded-full ${status === 'running' ? 'bg-green-500' : 'bg-muted-foreground'}`}
            />
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
