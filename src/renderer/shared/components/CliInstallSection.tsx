import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CliInstallStatus } from '@shared/types/cli'
import { friendlyErrorMessage } from '../friendlyError'
import { Button } from './ui/button'
import { InfoTip } from './InfoTip'

/** 設定ダイアログの「コマンドラインツール」欄。状態の表示と、入れる・外すボタン。 */
export function CliInstallSection(): React.JSX.Element | null {
  const { t } = useTranslation()
  const [status, setStatus] = useState<CliInstallStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    window.shovel.cli
      .status()
      .then((s) => alive && setStatus(s))
      .catch((err: unknown) => alive && setError(friendlyErrorMessage(String(err instanceof Error ? err.message : err), t)))
    return () => {
      alive = false
    }
  }, [t])

  const run = useCallback(
    async (action: 'install' | 'uninstall') => {
      setBusy(true)
      setError(null)
      try {
        const result = await (action === 'install' ? window.shovel.cli.install() : window.shovel.cli.uninstall())
        setStatus(result.status)
      } catch (err) {
        setError(friendlyErrorMessage(err instanceof Error ? err.message : String(err), t))
      } finally {
        setBusy(false)
      }
    },
    [t]
  )

  if (status && !status.available && status.reason === 'unsupported') return null

  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-1 text-muted-foreground">
        {t('settings.cli.title')}
        <InfoTip text={t('settings.cli.hint')} />
      </span>
      {!status ? (
        !error && <span className="text-xs text-muted-foreground">{t('settings.cli.loading')}</span>
      ) : !status.available ? (
        <span className="text-xs text-muted-foreground">{t('settings.cli.dev')}</span>
      ) : (
        <>
          <span className="text-xs">{stateText(status, t)}</span>
          <span className="break-all font-mono text-xs text-muted-foreground">{status.location}</span>
          {status.dirNotOnPath && (
            <span className="text-xs text-amber-600 dark:text-amber-400">{t('settings.cli.dirNotOnPath')}</span>
          )}
          {status.shadowedBy && (
            <span className="break-all text-xs text-amber-600 dark:text-amber-400">
              {t('settings.cli.shadowed', { path: status.shadowedBy })}
            </span>
          )}
          <Actions status={status} busy={busy} onRun={(action) => void run(action)} />
        </>
      )}
      {error && <span className="whitespace-pre-wrap text-xs text-destructive">{error}</span>}
    </div>
  )
}

function Actions({
  status,
  busy,
  onRun
}: {
  status: Extract<CliInstallStatus, { available: true }>
  busy: boolean
  onRun: (action: 'install' | 'uninstall') => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  if (status.method === 'package' || status.state === 'foreign') return null
  if (status.method === 'windowsPath' && status.managedByInstaller) return null
  const labels = status.method === 'windowsPath' ? 'settings.cli.path' : 'settings.cli.command'
  return (
    <div className="mt-1 flex gap-2">
      {status.state !== 'installed' && (
        <Button size="sm" disabled={busy} onClick={() => onRun('install')}>
          {t(status.state === 'stale' ? `${labels}.reinstall` : `${labels}.install`)}
        </Button>
      )}
      {(status.state === 'installed' || status.state === 'stale') && (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => onRun('uninstall')}>
          {t(`${labels}.uninstall`)}
        </Button>
      )}
    </div>
  )
}

function stateText(
  status: Extract<CliInstallStatus, { available: true }>,
  t: (key: string) => string
): string {
  if (status.method === 'package') return t(`settings.cli.package.${status.state}`)
  if (status.method === 'windowsPath') {
    if (status.state === 'installed' && status.managedByInstaller) return t('settings.cli.path.byInstaller')
    return t(`settings.cli.path.${status.state}`)
  }
  return t(`settings.cli.command.${status.state}`)
}
