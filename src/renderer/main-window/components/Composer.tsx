import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SessionCommand, SessionMeta, SessionUsage } from '@shared/types/session'
import type { AttachmentChip } from '@shared/types/transcript'
import { Button } from '../../shared/components/ui/button'
import { Textarea } from '../../shared/components/ui/input'
import { cn } from '../../shared/lib/utils'

const compactNumberFormat = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })

/** トークン使用量の表示。usage_update を受け取ったときだけ表示する。 */
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
  onSetConfigOption,
  sendKey = 'enter'
}: {
  /** 送信キーの設定。`modEnter` は Cmd/Ctrl+Enter で送信し、Enter は改行。 */
  sendKey?: 'enter' | 'modEnter'
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
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // テキスト全体が「/」+ 空白を含まない語のとき、スラッシュコマンドの候補を出す。
  const slashMatch = /^\/(\S*)$/.exec(text)
  const [dismissed, setDismissed] = useState(false)
  const [commandIndex, setCommandIndex] = useState(0)
  const filteredCommands =
    slashMatch && !dismissed
      ? meta.commands.filter((c) => c.name.toLowerCase().startsWith(slashMatch[1]!.toLowerCase()))
      : []
  const showCommands = filteredCommands.length > 0

  useEffect(() => {
    setDismissed(false)
    setCommandIndex(0)
  }, [text])

  function applyCommand(cmd: SessionCommand): void {
    setText(`/${cmd.name} `)
    setDismissed(false)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

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
      <div className="relative">
        {showCommands && (
          <div className="absolute bottom-full left-0 z-10 mb-1 max-h-48 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-md">
            {filteredCommands.map((cmd, i) => (
              <button
                key={cmd.name}
                type="button"
                className={cn(
                  'flex w-full flex-col items-start px-2 py-1.5 text-left',
                  i === commandIndex && 'bg-accent'
                )}
                onMouseEnter={() => setCommandIndex(i)}
                onClick={() => applyCommand(cmd)}
              >
                <span className="text-xs font-medium">
                  /{cmd.name}
                  {cmd.inputHint && <span className="ml-1 font-normal text-muted-foreground">{cmd.inputHint}</span>}
                </span>
                {cmd.description && <span className="text-xs text-muted-foreground">{cmd.description}</span>}
              </button>
            ))}
          </div>
        )}
        <Textarea
          ref={textareaRef}
          rows={3}
          value={text}
          placeholder={t('composer.placeholder')}
          onChange={(e) => setText(e.target.value)}
          onCompositionStart={() => (composingRef.current = true)}
          onCompositionEnd={() => (composingRef.current = false)}
          onKeyDown={(e) => {
            if (showCommands && !composingRef.current && !e.nativeEvent.isComposing) {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setCommandIndex((i) => Math.min(i + 1, filteredCommands.length - 1))
                return
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setCommandIndex((i) => Math.max(i - 1, 0))
                return
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                applyCommand(filteredCommands[commandIndex]!)
                return
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                setDismissed(true)
                return
              }
            }
            // IME 合成中の Enter では送信しない。
            if (e.key !== 'Enter' || composingRef.current || e.nativeEvent.isComposing) return
            const modPressed = window.shovel.platform === 'darwin' ? e.metaKey : e.ctrlKey
            const shouldSend = sendKey === 'enter' ? !e.shiftKey && !modPressed : modPressed
            if (shouldSend) {
              e.preventDefault()
              submit()
            }
          }}
        />
      </div>
      {/* 幅が狭いときは折り返し、長いラベルのセレクタは省略表示にする。 */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {/* configOptions に category "mode" があればそちらを使い、`modes` は出さない。 */}
        {meta.modes.length > 0 && !meta.configOptions.some((opt) => opt.category === 'mode') && (
          <select
            className="h-8 min-w-0 max-w-[12rem] truncate rounded-md border border-input bg-transparent px-2 text-xs"
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
              className="h-8 min-w-0 max-w-[12rem] truncate rounded-md border border-input bg-transparent px-2 text-xs"
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
        {/* 無効化したボタンにもツールチップが出るよう、title は外側に付ける。 */}
        <div
          className="ml-auto"
          title={
            sending
              ? undefined
              : sendKey === 'enter'
                ? t('composer.sendHintEnter')
                : t('composer.sendHintModEnter', { mod: window.shovel.platform === 'darwin' ? '⌘' : 'Ctrl' })
          }
        >
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
