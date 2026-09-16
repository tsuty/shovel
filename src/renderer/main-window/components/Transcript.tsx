import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy } from 'lucide-react'
import type { ToolCallPayload } from '@shared/types/transcript'
import type { RenderBlock, RenderChoice, RenderPermission, TranscriptState } from '../transcriptState'
import { cn } from '../../shared/lib/utils'
import { Markdown } from '../../shared/components/Markdown'
import { TextDiffView } from '../../shared/components/DiffView'
import { Button } from '../../shared/components/ui/button'

export function Transcript({
  state,
  onPermission,
  onOpenFile,
  onSubmitChoices
}: {
  state: TranscriptState
  onPermission: (permissionId: string, optionId: string) => void
  onOpenFile: (relPath: string) => void
  onSubmitChoices: (markdown: string) => void
}): React.JSX.Element {
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [diffToolCall, setDiffToolCall] = useState<ToolCallPayload | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    // decisions.md N-1: 追記時のスクロール追従は「すでに最下部にいたときだけ」（閾値 24px）。
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 24
    if (nearBottom) bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [state])

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto px-4 py-3">
      <div className="flex flex-col gap-3">
        {state.order.map((entry) =>
          entry.kind === 'block' ? (
            <BlockView
              key={entry.id}
              block={state.blocks[entry.id]!}
              onOpenFile={onOpenFile}
              onSubmitChoices={onSubmitChoices}
            />
          ) : (
            <GroupView
              key={entry.id}
              closed={state.groups[entry.id]?.closed ?? false}
              toolCalls={state.toolCallsByGroup[entry.id] ?? []}
              permissions={state.permissions}
              onPermission={onPermission}
              onOpenFile={onOpenFile}
              onOpenDiff={setDiffToolCall}
            />
          )
        )}
      </div>
      <div ref={bottomRef} />
      {diffToolCall && <DiffModal toolCall={diffToolCall} onClose={() => setDiffToolCall(null)} />}
    </div>
  )
}

// main/acp/translate.ts の TASK_LIST_LINE と同じパターン。choices を抜き出した
// 元になった行は、地の文でも remark-gfm の非活性チェックボックスとして二重に
// 出てしまうため、prose 側からは取り除き ChoicesView だけに表示させる。
const TASK_LIST_LINE = /^\s*[-*]\s+\[([ xX])\]\s+(.+)$/

function stripChoiceLines(markdown: string): string {
  return markdown
    .split('\n')
    .filter((line) => !TASK_LIST_LINE.test(line))
    .join('\n')
    .trim()
}

/** クリップボードに書き込み、ボタンのアイコンを一時的にチェックマークへ切り替えて完了を示す。 */
function useCopyFeedback(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()
  function copy(text: string): void {
    void navigator.clipboard.writeText(text)
    setCopied(true)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setCopied(false), 1200)
  }
  return [copied, copy]
}

function BlockView({
  block,
  onOpenFile,
  onSubmitChoices
}: {
  block: RenderBlock
  onOpenFile: (relPath: string) => void
  onSubmitChoices: (markdown: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [copied, copy] = useCopyFeedback()

  if (block.role === 'THOUGHT') {
    return (
      <details className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
        <summary className="cursor-pointer select-none">{t('transcript.thinking')}</summary>
        <div className="mt-2 whitespace-pre-wrap">{block.markdown}</div>
      </details>
    )
  }
  if (block.role === 'SYSTEM' || block.role === 'COMPLETION') {
    return <div className="text-center text-xs text-muted-foreground">{block.markdown}</div>
  }
  if (block.role === 'ERROR') {
    return (
      <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {block.markdown}
      </div>
    )
  }

  const label = block.role === 'USER' ? t('transcript.you') : block.role === 'PLAN' ? t('transcript.plan') : t('transcript.agent')

  return (
    <div
      className={cn(
        // 名前付き group: ネストした Markdown 内のコードブロックにも独自の
        // group/code があるため、無名の group だと外側を hover しただけで
        // 内側のコピー ボタンまで出てしまう（実機テストで確認済みの不具合）。
        'group/message rounded-md border px-3 py-2',
        block.role === 'PLAN' ? 'border-border bg-muted/20 text-sm' : 'border-border'
      )}
    >
      <div className="mb-1 flex items-center justify-between text-xs font-medium text-muted-foreground">
        <span>{label}</span>
        {!block.streaming && (
          <button
            className="opacity-0 transition-opacity hover:text-foreground group-hover/message:opacity-100"
            title={t('transcript.copy')}
            onClick={() => copy(block.markdown)}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
        )}
      </div>
      {block.chips && block.chips.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {block.chips.map((chip) => (
            <button
              key={chip.key}
              className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              title={chip.path}
              onClick={() => onOpenFile(chip.path)}
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}
      {block.streaming ? (
        <div className="whitespace-pre-wrap text-sm">{block.markdown}</div>
      ) : (
        <Markdown text={block.choices ? stripChoiceLines(block.markdown) : block.markdown} />
      )}
      {block.choices && block.choices.length > 0 && (
        <ChoicesView choices={block.choices} onSubmit={onSubmitChoices} />
      )}
    </div>
  )
}

function ChoicesView({
  choices,
  onSubmit
}: {
  choices: RenderChoice[]
  onSubmit: (markdown: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [submitted, setSubmitted] = useState(false)

  function toggle(id: string): void {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function submit(): void {
    const markdown = choices.map((c) => `- [${checked.has(c.id) ? 'x' : ' '}] ${c.label}`).join('\n')
    setSubmitted(true)
    onSubmit(markdown)
  }

  return (
    <div className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
      {choices.map((c) => (
        <label key={c.id} className="flex items-center gap-2 text-sm">
          <input type="checkbox" disabled={submitted} checked={checked.has(c.id)} onChange={() => toggle(c.id)} />
          {c.label}
        </label>
      ))}
      <div className="mt-1 flex justify-end">
        <Button size="sm" disabled={submitted} onClick={submit}>
          {t('transcript.sendChoices')}
        </Button>
      </div>
    </div>
  )
}

const KIND_VERBS: Record<string, string> = {
  read: 'Read',
  edit: 'Edit',
  delete: 'Delete',
  move: 'Move',
  search: 'Search',
  execute: 'Run',
  fetch: 'Fetch',
  switch_mode: 'Switch mode',
  think: 'Think',
  other: 'Tool'
}

function toolCallLine(tc: ToolCallPayload): string {
  const verb = KIND_VERBS[tc.kind] ?? 'Tool'
  return `${verb} ${tc.title}`
}

function GroupView({
  closed,
  toolCalls,
  permissions,
  onPermission,
  onOpenFile,
  onOpenDiff
}: {
  closed: boolean
  toolCalls: ToolCallPayload[]
  permissions: Record<string, RenderPermission>
  onPermission: (permissionId: string, optionId: string) => void
  onOpenFile: (relPath: string) => void
  onOpenDiff: (toolCall: ToolCallPayload) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const pendingByToolCall = new Map<string, RenderPermission>()
  for (const p of Object.values(permissions)) {
    if (p.status === 'pending') pendingByToolCall.set(p.toolCallId, p)
  }

  return (
    <div className="rounded-md border border-border">
      <div className="border-b border-border px-3 py-1.5 text-xs font-medium text-muted-foreground">
        {closed ? t('transcript.worked') : t('transcript.working')}
      </div>
      <ul className="divide-y divide-border">
        {toolCalls.map((tc) => {
          const permission = pendingByToolCall.get(tc.id)
          return (
            <li key={tc.id} className="px-3 py-1.5">
              <div className="truncate text-sm" title={toolCallLine(tc)}>
                {toolCallLine(tc)}
                {tc.diffs.length > 0 && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    +{tc.diffs.reduce((s, d) => s + d.added, 0)} -{tc.diffs.reduce((s, d) => s + d.removed, 0)}
                  </span>
                )}
              </div>
              {(tc.locations.length > 0 || tc.diffs.length > 0) && (
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  {tc.locations.map((loc, i) => (
                    <button
                      key={i}
                      className="truncate text-xs text-primary hover:underline"
                      onClick={() => onOpenFile(loc.path)}
                    >
                      {loc.path}
                      {loc.line ? `:${loc.line}` : ''}
                    </button>
                  ))}
                  {tc.diffs.length > 0 && (
                    <button className="text-xs text-primary hover:underline" onClick={() => onOpenDiff(tc)}>
                      {t('transcript.viewDiff')}
                    </button>
                  )}
                </div>
              )}
              {permission && <PermissionCard permission={permission} onPermission={onPermission} />}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function PermissionCard({
  permission,
  onPermission
}: {
  permission: RenderPermission
  onPermission: (permissionId: string, optionId: string) => void
}): React.JSX.Element {
  return (
    <div className="mt-2 rounded-md border border-primary/40 bg-primary/5 p-2">
      <div className="mb-1 text-sm font-medium">{permission.headline}</div>
      {permission.bodyMarkdown && <Markdown text={permission.bodyMarkdown} />}
      <div className="mt-2 flex flex-wrap gap-2">
        {permission.options.map((opt) => (
          <button
            key={opt.optionId}
            className={cn(
              'rounded-md border px-2 py-1 text-xs',
              opt.kind.startsWith('allow')
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-input bg-transparent'
            )}
            disabled={permission.status !== 'pending'}
            onClick={() => onPermission(permission.id, opt.optionId)}
          >
            {opt.name}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * decisions.md N-3-7「トランスクリプトのツールカード → その操作単体の diff」。
 * ui.md §5「チャット内に diff を展開しない。クリックで Diff ビューを開く」に
 * 従い、一覧の中では行数の増減だけを見せ、本文はこのビューアで開く。
 */
function DiffModal({ toolCall, onClose }: { toolCall: ToolCallPayload; onClose: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-[80vw] max-w-3xl flex-col rounded-lg border bg-card p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex shrink-0 items-center justify-between">
          <h3 className="truncate text-sm font-medium">{toolCall.title}</h3>
          <button className="shrink-0 text-xs text-muted-foreground hover:underline" onClick={onClose}>
            {t('common.dismiss')}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {toolCall.diffs.map((diff, i) => (
            <div key={i} className="mb-4 last:mb-0">
              <div className="mb-1 flex items-baseline gap-2 text-xs text-muted-foreground">
                <span className="truncate">{diff.path}</span>
                <span className="shrink-0">
                  +{diff.added} -{diff.removed}
                </span>
              </div>
              <TextDiffView
                oldText={diff.oldText ?? ''}
                newText={diff.newText ?? ''}
                className="rounded border border-border py-1"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
