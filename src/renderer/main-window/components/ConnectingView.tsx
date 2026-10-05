import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Check, Circle, Loader2 } from 'lucide-react'
import type { SessionOpenStep } from '@shared/ipc'
import { cn } from '../../shared/lib/utils'

/** 表示する段階の順番。 */
export const SESSION_OPEN_STEPS: readonly SessionOpenStep[] = ['auth', 'sandbox', 'adapter', 'session']

/** 始まった段階1つ分。終わった時刻は次の段階が始まった時刻（または接続の完了）。 */
export interface ConnectingStepRecord {
  step: SessionOpenStep
  detail?: string
  startedAt: number
}

function formatSeconds(ms: number): string {
  return (Math.max(0, ms) / 1000).toFixed(1)
}

/**
 * 新しいタブの接続中の表示。いま何を実行しているか（コマンド・メソッド）と、各段階の経過時間を出す。
 * 失敗したら、どの段階で止まったかとエラーを出し、再試行・閉じるを選ばせる。
 */
export function ConnectingView({
  steps,
  authCommand,
  error,
  onRetry,
  onClose
}: {
  steps: ConnectingStepRecord[]
  /** 認証状態の確認に使うコマンド。プロジェクトを読み込む前は分からないので、表示のたびに渡す。 */
  authCommand?: string
  error?: string
  onRetry: () => void
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [now, setNow] = useState(() => Date.now())

  // 実行中の段階の経過時間を進める。
  useEffect(() => {
    if (error) return
    const timer = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(timer)
  }, [error])

  return (
    <div className="flex flex-1 items-center justify-center overflow-auto p-6">
      <div className="w-full max-w-lg">
        <div className="mb-3 text-sm font-medium">
          {error ? t('connecting.failedTitle') : t('connecting.title')}
        </div>
        <ol className="flex flex-col gap-2">
          {SESSION_OPEN_STEPS.map((step) => {
            const index = steps.findIndex((record) => record.step === step)
            const record = steps[index]
            const next = steps[index + 1]
            const isCurrent = record !== undefined && next === undefined
            const state = !record ? 'pending' : !isCurrent ? 'done' : error ? 'failed' : 'running'
            const elapsed = record ? (next?.startedAt ?? now) - record.startedAt : 0
            const detail = record?.detail ?? (step === 'auth' ? authCommand : undefined)
            return (
              <li key={step} className="flex items-start gap-2 text-sm">
                <span className="mt-0.5 shrink-0">
                  {state === 'done' && <Check size={14} className="text-muted-foreground" />}
                  {state === 'running' && <Loader2 size={14} className="animate-spin text-foreground" />}
                  {state === 'failed' && <AlertTriangle size={14} className="text-destructive" />}
                  {state === 'pending' && <Circle size={14} className="text-muted-foreground/40" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      'flex items-baseline justify-between gap-2',
                      state === 'pending' && 'text-muted-foreground/60',
                      state === 'done' && 'text-muted-foreground'
                    )}
                  >
                    <span>{t(`connecting.steps.${step}`)}</span>
                    {state !== 'pending' && state !== 'failed' && (
                      <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                        {t('connecting.seconds', { value: formatSeconds(elapsed) })}
                      </span>
                    )}
                  </div>
                  {detail && (
                    <div className="truncate font-mono text-xs text-muted-foreground" title={detail}>
                      {detail}
                    </div>
                  )}
                  {state === 'running' && step === 'adapter' && (
                    <div className="mt-0.5 text-xs text-muted-foreground">{t('connecting.adapterHint')}</div>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
        {error && (
          <div className="mt-4 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <div className="whitespace-pre-wrap break-words">{error}</div>
            <div className="mt-2 flex gap-3">
              <button className="font-medium hover:underline" onClick={onRetry}>
                {t('common.retry')}
              </button>
              <button className="font-medium hover:underline" onClick={onClose}>
                {t('common.close')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
