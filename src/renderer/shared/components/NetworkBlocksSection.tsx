import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { BlockedHost } from '@shared/types/network'
import { friendlyErrorMessage } from '../friendlyError'
import { Button } from './ui/button'
import { InfoTip } from './InfoTip'

/**
 * プロジェクトの詳細の「ネットワーク」欄。サンドボックスで拒否された通信の宛先を並べ、
 * 宛先ごとに「許可」（このサンドボックスだけ）か「無視」を選ばせる。
 */
export function NetworkBlocksSection({
  projectId,
  sandboxName
}: {
  projectId: string
  sandboxName: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const [entries, setEntries] = useState<BlockedHost[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyHost, setBusyHost] = useState<string | null>(null)
  const [showIgnored, setShowIgnored] = useState(false)

  const toMessage = useCallback(
    (err: unknown) => friendlyErrorMessage(err instanceof Error ? err.message : String(err), t),
    [t]
  )

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      setEntries((await window.shovel.projects.networkBlocks(projectId)).entries)
    } catch (err) {
      setError(toMessage(err))
    } finally {
      setLoading(false)
    }
  }, [projectId, toMessage])

  useEffect(() => {
    setEntries(null)
    void load()
  }, [load])

  async function allow(host: string): Promise<void> {
    if (!confirm(t('network.confirmAllow', { host, sandbox: sandboxName }))) return
    setBusyHost(host)
    setError(null)
    try {
      await window.shovel.projects.allowNetworkHost(projectId, host)
      await load()
    } catch (err) {
      setError(toMessage(err))
    } finally {
      setBusyHost(null)
    }
  }

  async function setIgnored(host: string, ignored: boolean): Promise<void> {
    setError(null)
    try {
      await window.shovel.projects.setNetworkHostIgnored(projectId, host, ignored)
      setEntries((prev) => prev?.map((e) => (e.host === host ? { ...e, ignored } : e)) ?? prev)
    } catch (err) {
      setError(toMessage(err))
    }
  }

  const active = entries?.filter((e) => !e.ignored) ?? []
  const ignored = entries?.filter((e) => e.ignored) ?? []

  return (
    <div>
      <div className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
        <span>{t('network.title')}</span>
        <InfoTip text={t('network.info')} />
        <button
          className="ml-auto text-primary hover:underline disabled:opacity-50"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? t('common.loading') : t('network.refresh')}
        </button>
      </div>
      {error && <p className="mb-1 text-xs text-destructive">{error}</p>}
      {entries === null ? (
        !error && <p className="text-xs text-muted-foreground">{t('common.loading')}</p>
      ) : (
        <div className="flex flex-col gap-1">
          {active.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('network.empty')}</p>
          ) : (
            <ul className="flex max-h-48 flex-col gap-1 overflow-auto">
              {active.map((e) => (
                <BlockedHostRow key={e.host} entry={e}>
                  {e.allowable && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2"
                      disabled={busyHost !== null}
                      onClick={() => void allow(e.host)}
                    >
                      {busyHost === e.host ? t('network.allowing') : t('network.allow')}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2"
                    disabled={busyHost !== null}
                    onClick={() => void setIgnored(e.host, true)}
                  >
                    {t('network.ignore')}
                  </Button>
                </BlockedHostRow>
              ))}
            </ul>
          )}
          {ignored.length > 0 && (
            <div>
              <button
                className="text-xs text-muted-foreground hover:underline"
                onClick={() => setShowIgnored((v) => !v)}
              >
                {showIgnored ? '▾' : '▸'} {t('network.ignoredList', { count: ignored.length })}
              </button>
              {showIgnored && (
                <ul className="mt-1 flex max-h-32 flex-col gap-1 overflow-auto">
                  {ignored.map((e) => (
                    <BlockedHostRow key={e.host} entry={e}>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2"
                        onClick={() => void setIgnored(e.host, false)}
                      >
                        {t('network.unignore')}
                      </Button>
                    </BlockedHostRow>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** 宛先1行。回数・最終時刻と、許可できない拒否ならその理由を出す。 */
function BlockedHostRow({ entry, children }: { entry: BlockedHost; children: React.ReactNode }): React.JSX.Element {
  const { t } = useTranslation()
  const lastSeen = entry.lastSeen ? new Date(entry.lastSeen).toLocaleString() : null
  return (
    <li className="flex items-start gap-2 rounded-md bg-muted px-2 py-1 text-xs">
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono" title={entry.host}>
          {entry.host}
        </div>
        <div className="text-muted-foreground">
          {t('network.count', { count: entry.count })}
          {lastSeen && ` · ${t('network.lastSeen', { time: lastSeen })}`}
        </div>
        {!entry.allowable && (
          <div className="text-muted-foreground">{t('network.notAllowable', { reason: entry.reason ?? entry.rule ?? '' })}</div>
        )}
      </div>
      <div className="flex shrink-0 gap-1">{children}</div>
    </li>
  )
}
