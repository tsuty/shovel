import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ToolCallPayload } from '@shared/types/transcript'
import type { RenderBlock, RenderPermission, TranscriptState } from '../transcriptState'
import { cn } from '../../shared/lib/utils'
import { Markdown } from '../../shared/components/Markdown'

export function Transcript({
  state,
  onPermission
}: {
  state: TranscriptState
  onPermission: (permissionId: string, optionId: string) => void
}): React.JSX.Element {
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

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
            <BlockView key={entry.id} block={state.blocks[entry.id]!} />
          ) : (
            <GroupView
              key={entry.id}
              closed={state.groups[entry.id]?.closed ?? false}
              toolCalls={state.toolCallsByGroup[entry.id] ?? []}
              permissions={state.permissions}
              onPermission={onPermission}
            />
          )
        )}
      </div>
      <div ref={bottomRef} />
    </div>
  )
}

function BlockView({ block }: { block: RenderBlock }): React.JSX.Element {
  const { t } = useTranslation()
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
        'rounded-md border px-3 py-2',
        block.role === 'PLAN' ? 'border-border bg-muted/20 text-sm' : 'border-border'
      )}
    >
      <div className="mb-1 text-xs font-medium text-muted-foreground">{label}</div>
      {block.streaming ? (
        <div className="whitespace-pre-wrap text-sm">{block.markdown}</div>
      ) : (
        <Markdown text={block.markdown} />
      )}
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
  onPermission
}: {
  closed: boolean
  toolCalls: ToolCallPayload[]
  permissions: Record<string, RenderPermission>
  onPermission: (permissionId: string, optionId: string) => void
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
              {permission && (
                <PermissionCard permission={permission} onPermission={onPermission} />
              )}
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
