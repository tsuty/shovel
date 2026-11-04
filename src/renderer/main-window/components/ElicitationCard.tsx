import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageCircleQuestion } from 'lucide-react'
import type { ElicitationField, ElicitationOption, ElicitationReply, ElicitationValue } from '@shared/types/transcript'
import type { RenderElicitation } from '../transcriptState'
import {
  buildElicitationContent,
  initialElicitationValues,
  validateElicitation,
  type ElicitationFieldError,
  type ElicitationFormValue,
  type ElicitationFormValues
} from '@shared/elicitationForm'
import { Markdown } from '../../shared/components/Markdown'
import { cn } from '../../shared/lib/utils'

/** 単一選択の選択肢がこの数を超えたら、ラジオの列ではなくドロップダウンで描く。 */
const MAX_RADIOS = 6

const INPUT_CLASS =
  'w-full rounded-md border border-input bg-background px-2 py-1 text-transcript-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60'

/**
 * 質問の文言（メッセージ・説明・選択肢の説明・preview）。Markdown として描くが、リンクはクリックできない
 * 文字のまま、画像は代替テキストだけにする。前後の段落の余白は詰める。
 */
export function QuestionMarkdown({
  text,
  className,
  preformatted = false
}: {
  text: string
  className?: string
  /** 段落の改行と空白をそのまま残す（preview の下書きや図のため）。 */
  preformatted?: boolean
}): React.JSX.Element {
  return (
    <Markdown
      text={text}
      inertLinks
      // cn（tailwind-merge）は text-transcript-* を色のクラスとみなして落とすので、文字列のまま繋ぐ。
      className={['[&>:first-child]:mt-0 [&>:last-child]:mb-0', preformatted && '[&_p]:whitespace-pre-wrap', className]
        .filter(Boolean)
        .join(' ')}
    />
  )
}

/**
 * エージェントからの質問（`elicitation/create` のフォームモード）。選択肢・項目の名前は
 * プレーンテキスト、それ以外の文言は `QuestionMarkdown` で描く。
 */
export function ElicitationCard({
  elicitation,
  onReply
}: {
  elicitation: RenderElicitation
  onReply: (elicitationId: string, reply: ElicitationReply) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [values, setValues] = useState<ElicitationFormValues>(() => initialElicitationValues(elicitation.fields))
  /** 送信を一度試みたか。誤りは送信を試みた後と、入力し始めた項目にだけ出す。 */
  const [attempted, setAttempted] = useState(false)
  const [touched, setTouched] = useState<Set<string>>(new Set())
  const errors = useMemo(() => validateElicitation(elicitation.fields, values), [elicitation.fields, values])
  const pending = elicitation.status === 'pending'

  function setValue(key: string, value: ElicitationFormValue): void {
    setValues((prev) => ({ ...prev, [key]: value }))
    setTouched((prev) => (prev.has(key) ? prev : new Set(prev).add(key)))
  }

  function submit(): void {
    setAttempted(true)
    if (Object.keys(errors).length > 0) return
    onReply(elicitation.id, { action: 'accept', content: buildElicitationContent(elicitation.fields, values) })
  }

  return (
    <div className="rounded-md border border-l-4 border-border border-l-primary px-3 py-2 text-transcript">
      <div className="mb-1 flex items-center gap-1 text-transcript-sm font-medium text-muted-foreground">
        <MessageCircleQuestion size={12} />
        {t('elicitation.heading')}
      </div>
      <QuestionMarkdown className="text-transcript font-medium" text={elicitation.message} />
      {elicitation.title && <QuestionMarkdown className="mt-1 text-transcript" text={elicitation.title} />}
      {elicitation.description && (
        <QuestionMarkdown className="mt-1 text-transcript-sm text-muted-foreground" text={elicitation.description} />
      )}
      <form
        className="mt-2 flex flex-col"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          if (pending) submit()
        }}
      >
        {elicitation.fields.map((field, index) => (
          <FieldView
            key={field.key}
            formId={elicitation.id}
            field={field}
            first={index === 0}
            attached={index > 0 && field.key === `${elicitation.fields[index - 1]!.key}_custom`}
            value={pending ? values[field.key] : resolvedValue(field, elicitation.content?.[field.key])}
            error={pending && (attempted || touched.has(field.key)) ? errors[field.key] : undefined}
            disabled={!pending}
            onChange={(value) => setValue(field.key, value)}
          />
        ))}
        {pending ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="submit"
              className="rounded-md border border-primary bg-primary px-2 py-1 text-transcript-sm text-primary-foreground"
            >
              {t('elicitation.submit')}
            </button>
            <button
              type="button"
              className="rounded-md border border-input bg-transparent px-2 py-1 text-transcript-sm"
              title={t('elicitation.declineHint')}
              onClick={() => onReply(elicitation.id, { action: 'decline' })}
            >
              {t('elicitation.decline')}
            </button>
            <button
              type="button"
              className="rounded-md border border-input bg-transparent px-2 py-1 text-transcript-sm"
              title={t('elicitation.cancelHint')}
              onClick={() => onReply(elicitation.id, { action: 'cancel' })}
            >
              {t('elicitation.cancel')}
            </button>
          </div>
        ) : (
          <div className="mt-3 text-transcript-sm text-muted-foreground">{t(`elicitation.status.${elicitation.status}`)}</div>
        )}
      </form>
    </div>
  )
}

/** 応答後に、送った内容を入力欄の形へ戻す（送っていない項目は空）。 */
function resolvedValue(field: ElicitationField, value: ElicitationValue | undefined): ElicitationFormValue {
  switch (field.kind) {
    case 'boolean':
      return value === true
    case 'multiSelect':
      return Array.isArray(value) ? value : []
    case 'text':
    case 'select':
    case 'number':
      return value === undefined || Array.isArray(value) ? '' : String(value)
  }
}

/**
 * 1項目。項目どうしは点線で区切る。claude-agent-acp が各質問の後ろに足す自由記述欄
 * （`<key>_custom`）は直前の質問に属するので、区切らずに続ける（`attached`）。
 */
function FieldView({
  formId,
  field,
  first,
  attached,
  value,
  error,
  disabled,
  onChange
}: {
  formId: string
  field: ElicitationField
  first: boolean
  attached: boolean
  value: ElicitationFormValue | undefined
  error: ElicitationFieldError | undefined
  disabled: boolean
  onChange: (value: ElicitationFormValue) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const label = field.title ?? field.key
  const text = typeof value === 'string' ? value : ''

  let control: React.JSX.Element
  switch (field.kind) {
    case 'text':
      control = (
        <input
          className={INPUT_CLASS}
          type={field.format === 'email' ? 'email' : field.format === 'uri' ? 'url' : field.format === 'date' ? 'date' : 'text'}
          placeholder={field.format === 'date-time' ? '2026-01-31T09:00:00+09:00' : undefined}
          value={text}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      )
      break
    case 'number':
      control = (
        <input
          className={cn(INPUT_CLASS, 'max-w-48')}
          type="number"
          step={field.integer ? 1 : 'any'}
          min={field.minimum}
          max={field.maximum}
          value={text}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      )
      break
    case 'boolean':
      control = (
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={value === true} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
          <span>{label}</span>
          {field.required && <span className="text-destructive">*</span>}
        </label>
      )
      break
    case 'select': {
      const dropdown = field.options.length > MAX_RADIOS
      control = (
        <>
          {dropdown ? (
            <select className={INPUT_CLASS} value={text} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
              {(!field.required || text === '') && <option value="">{t('elicitation.unselected')}</option>}
              {field.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : (
            <div className="flex flex-col gap-1" role="radiogroup" aria-label={label}>
              {field.options.map((option) => (
                <OptionRow
                  key={option.value}
                  type="radio"
                  name={`${formId}:${field.key}`}
                  option={option}
                  checked={text === option.value}
                  disabled={disabled}
                  onChange={() => onChange(option.value)}
                />
              ))}
            </div>
          )}
          {!dropdown && !field.required && !disabled && text !== '' && (
            <button
              type="button"
              className="self-start text-transcript-xs text-muted-foreground hover:text-foreground hover:underline"
              onClick={() => onChange('')}
            >
              {t('elicitation.clear')}
            </button>
          )}
          <OptionPreview option={field.options.find((o) => o.value === text)} />
        </>
      )
      break
    }
    case 'multiSelect': {
      const picks = Array.isArray(value) ? value : []
      control = (
        <div className="flex flex-col gap-1">
          {field.options.map((option) => (
            <OptionRow
              key={option.value}
              type="checkbox"
              name={`${formId}:${field.key}`}
              option={option}
              checked={picks.includes(option.value)}
              disabled={disabled}
              onChange={() =>
                onChange(picks.includes(option.value) ? picks.filter((v) => v !== option.value) : [...picks, option.value])
              }
            />
          ))}
        </div>
      )
      break
    }
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-1',
        first ? '' : attached ? 'pt-2' : 'mt-3 border-t border-dotted border-border pt-3'
      )}
    >
      {field.kind !== 'boolean' && (
        <div className="text-transcript-sm font-medium">
          {label}
          {field.required && <span className="ml-1 text-destructive">*</span>}
        </div>
      )}
      {field.description && (
        <QuestionMarkdown className="text-transcript-sm text-muted-foreground" text={field.description} />
      )}
      {control}
      {error && <div className="text-transcript-xs text-destructive">{t(`elicitation.error.${error.code}`, error.params)}</div>}
    </div>
  )
}

function OptionRow({
  type,
  name,
  option,
  checked,
  disabled,
  onChange
}: {
  type: 'radio' | 'checkbox'
  name: string
  option: ElicitationOption
  checked: boolean
  disabled: boolean
  onChange: () => void
}): React.JSX.Element {
  return (
    <label
      className={cn(
        'flex items-start gap-2 rounded-md border px-2 py-1',
        checked ? 'border-primary ring-1 ring-primary' : 'border-border',
        !disabled && 'cursor-pointer hover:bg-accent/50'
      )}
    >
      {/* 入力欄は選択肢の1行目の高さの中で上下中央に置く。 */}
      <span className="flex h-[1lh] shrink-0 items-center">
        <input className="m-0" type={type} name={name} checked={checked} disabled={disabled} onChange={onChange} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span>{option.label}</span>
        {option.description && (
          <QuestionMarkdown className="text-transcript-sm text-muted-foreground" text={option.description} />
        )}
      </span>
    </label>
  )
}

/** 選んでいる選択肢の `preview`（コード片や画面の下書き）。等幅の枠の中に Markdown として描く。 */
function OptionPreview({ option }: { option: ElicitationOption | undefined }): React.JSX.Element | null {
  if (!option?.preview) return null
  return (
    <div className="max-h-64 overflow-auto rounded-md border border-border px-2 py-1">
      <QuestionMarkdown preformatted className="font-mono text-transcript-xs" text={option.preview} />
    </div>
  )
}
