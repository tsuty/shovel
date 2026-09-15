import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SessionMeta } from '@shared/types/session'
import { Button } from '../../shared/components/ui/button'
import { Textarea } from '../../shared/components/ui/input'

export function Composer({
  meta,
  sending,
  onSend,
  onStop,
  onSetMode,
  onSetConfigOption
}: {
  meta: SessionMeta
  sending: boolean
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
