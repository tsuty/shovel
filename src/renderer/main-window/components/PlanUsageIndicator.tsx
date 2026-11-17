import { useEffect, useState } from 'react'
import { Gauge, Loader2, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { highestPercent, type PlanUsageMeter, type PlanUsageState } from '@shared/planUsage'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '../../shared/components/ui/dropdown-menu'
import { Button } from '../../shared/components/ui/button'

/** 取得からこれだけ経った値は古いとみなし、薄く表示する。 */
const STALE_DISPLAY_MS = 2 * 60 * 60 * 1000

const INITIAL_STATE: PlanUsageState = { loading: false, usage: null, fetchedAt: null, error: null }

function usePlanUsageState(): PlanUsageState {
  const [state, setState] = useState<PlanUsageState>(INITIAL_STATE)
  useEffect(() => {
    window.shovel.planUsage
      .get()
      .then(setState)
      .catch((err: unknown) => console.warn('[planUsage] get failed', err))
    return window.shovel.planUsage.onChanged(setState)
  }, [])
  return state
}

/** 使用率に応じた文字色。 */
function levelClass(percent: number): string {
  if (percent >= 95) return 'text-destructive'
  if (percent >= 80) return 'text-amber-500'
  return ''
}

function barClass(percent: number): string {
  if (percent >= 95) return 'bg-destructive'
  if (percent >= 80) return 'bg-amber-500'
  return 'bg-primary'
}

function meterLabel(meter: PlanUsageMeter, t: TFunction): string {
  if (meter.kind === 'session') return t('planUsage.session')
  if (meter.label === null || meter.label.toLowerCase() === 'all models') return t('planUsage.weekAllModels')
  return t('planUsage.weekModel', { model: meter.label })
}

/** Header に置く、プランの使用率のゲージ。クリックで詳細と更新ボタンを出す。 */
export function PlanUsageIndicator(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const state = usePlanUsageState()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60 * 1000)
    return () => clearInterval(timer)
  }, [])

  const { usage, fetchedAt, loading, error } = state
  const percent = usage ? highestPercent(usage) : null
  const stale = fetchedAt !== null && now - fetchedAt > STALE_DISPLAY_MS
  const dateTime = new Intl.DateTimeFormat(i18n.language, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
  const time = new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' })
  const title = usage
    ? usage.meters.map((m) => `${meterLabel(m, t)} ${m.percent}%`).join(' · ')
    : error
      ? t(`planUsage.error.${error}`)
      : t('planUsage.title')

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={`flex items-center gap-1 rounded px-1 py-0.5 text-xs tabular-nums hover:bg-accent ${
            percent === null || stale ? 'text-muted-foreground' : levelClass(percent)
          }`}
          title={title}
          aria-label={t('planUsage.title')}
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Gauge size={14} />}
          <span>{percent === null ? '—' : `${percent}%`}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 p-3">
        <div className="mb-2 text-sm font-medium">{t('planUsage.title')}</div>
        {usage ? (
          <div className="flex flex-col gap-2.5">
            {usage.meters.map((meter, i) => (
              <div key={i} className="text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <span>{meterLabel(meter, t)}</span>
                  <span className={`tabular-nums ${levelClass(meter.percent)}`}>{meter.percent}%</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${barClass(meter.percent)}`}
                    style={{ width: `${Math.min(100, Math.max(0, meter.percent))}%` }}
                  />
                </div>
                {meter.resetsAt !== null && (
                  <div className="mt-0.5 text-muted-foreground">
                    {t('planUsage.resets', { at: dateTime.format(meter.resetsAt) })}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          !error && <div className="text-xs text-muted-foreground">{t('planUsage.notYet')}</div>
        )}
        {error && <div className="mt-2 text-xs text-amber-600 dark:text-amber-400">{t(`planUsage.error.${error}`)}</div>}
        <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{fetchedAt !== null ? t('planUsage.fetchedAt', { at: time.format(fetchedAt) }) : ''}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => void window.shovel.planUsage.refresh()}
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : undefined} />
            {t('planUsage.refresh')}
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
