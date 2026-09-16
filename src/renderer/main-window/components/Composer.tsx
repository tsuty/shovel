import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SessionMeta, SessionUsage } from '@shared/types/session'
import type { AttachmentChip } from '@shared/types/transcript'
import { Button } from '../../shared/components/ui/button'
import { Textarea } from '../../shared/components/ui/input'

const compactNumberFormat = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })

/** ui.md §8「トークン使用量は usage_update を受け取ったときだけ表示する」。 */
function formatUsage(usage: SessionUsage): string {
  const tokens = `${compactNumberFormat.format(usage.used)} / ${compactNumberFormat.format(usage.size)}`
  if (usage.costAmount === undefined) return tokens
  const cost = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: usage.costCurrency ?? 'USD',
    maximumFractionDigits: 2
  }).format(usage.costAmount)
  return `${tokens} · ${cost}`
}

export function Composer({
  meta,
  sending,
  attachments,
  onRemoveAttachment,
  onSend,
  onStop,
  onSetMode,
  onSetConfigOption
}: {
  meta: SessionMeta
  sending: boolean
  attachments: AttachmentChip[]
  onRemoveAttachment: (key: string) => void
  onSend: (text: string) => void
  onStop: () => void
  onSetMode: (modeId: string) => void
  onSetConfigOption: (configId: string, value: string | boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const composingRef = useRef(false)

  function submit(): void {
    const trimmed = text.trim()
    if (!trimmed || sending) return
    onSend(trimmed)
    setText('')
  }

  return (
    <div className="border-t border-border p-3">
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {attachments.map((chip) => (
            <span
              key={chip.key}
              className="flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground"
              title={chip.path}
            >
              {chip.label}
              <button
                className="hover:text-foreground"
                onClick={() => onRemoveAttachment(chip.key)}
                aria-label={t('composer.removeAttachment')}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <Textarea
        rows={3}
        value={text}
        placeholder={t('composer.placeholder')}
        onChange={(e) => setText(e.target.value)}
        onCompositionStart={() => (composingRef.current = true)}
        onCompositionEnd={() => (composingRef.current = false)}
        onKeyDown={(e) => {
          // decisions.md G-1-5: IME 合成中の Enter で誤送信しない。
          if (e.key === 'Enter' && !e.shiftKey && !composingRef.current && !e.nativeEvent.isComposing) {
            e.preventDefault()
            submit()
          }
        }}
      />
      <div className="mt-2 flex items-center gap-2">
        {meta.modes.length > 0 && (
          <select
            className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
            value={meta.currentModeId ?? ''}
            onChange={(e) => onSetMode(e.target.value)}
          >
            {meta.modes.map((mode) => (
              <option key={mode.id} value={mode.id}>
                {mode.name}
              </option>
            ))}
          </select>
        )}
        {meta.configOptions.map((opt) =>
          opt.kind === 'select' ? (
            <select
              key={opt.configId}
              className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
              value={opt.currentValue}
              onChange={(e) => onSetConfigOption(opt.configId, e.target.value)}
              title={opt.label}
            >
              {(opt.options ?? []).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <label key={opt.configId} className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={opt.currentValue === 'true'}
                onChange={(e) => onSetConfigOption(opt.configId, e.target.checked)}
              />
              {opt.label}
            </label>
          )
        )}
        {meta.usage && (
          <span
            className="text-xs text-muted-foreground"
            title={t('composer.usageTitle', { used: meta.usage.used, size: meta.usage.size })}
          >
            {formatUsage(meta.usage)}
          </span>
        )}
        <div className="ml-auto">
          {sending ? (
            <Button variant="destructive" size="sm" onClick={onStop}>
              {t('composer.stop')}
            </Button>
          ) : (
            <Button size="sm" disabled={!text.trim()} onClick={submit}>
              {t('composer.send')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
